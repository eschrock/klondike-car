import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { centerOfGravity } from '../model/mass';
import { partCentroid, worldAABB } from '../model/bounds';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Mat4, Part, PartGroup, RigidBody, Vec3 } from '../model/types';
import { buildPart } from './partMesh';
import { isShopAid, lookOf } from './materials';
import { EDGE_MAT, EXPOSED_MAT, PLY_LINE_MAT, type SurfaceMats } from './materials';
import { blobTexture, setMaxAnisotropy } from './textures';
import { JOINERY_LEGEND, jointColor, joineryMarkers } from './joinery';

/** Part-group checkbox labels (the ids stay the values). */
const GROUP_LABEL: Record<PartGroup, string> = {
  frame: 'Frame', body: 'Body', 'front-end': 'Front end', 'running-gear': 'Running gear', seat: 'Seat', brake: 'Brake', storage: 'Storage',
  lighting: 'Lighting', removable: 'Push handle', hardware: 'Hardware', reference: 'Reference',
};

export type ViewName = 'iso' | 'top' | 'side' | 'front' | 'under';

const VIEW_DIRS: Record<ViewName, [number, number, number]> = {
  iso: [1, -1.1, 0.75],
  top: [-0.001, 0, 1], // tiny offset avoids the degenerate lookAt with up = +Z
  side: [0, -1, 0.02],
  front: [1, 0, 0.05],
  under: [0.9, -1, -0.8], // the build step-through's running-gear steps (Phase 4): looking up at the deck underside; the ground planes are one-sided, so they don't block it
};

const VIEW_LABELS: Record<ViewName, string> = { iso: 'Iso', top: 'Top', side: 'Side', front: 'Front', under: 'Under' };
/** The toolbar's camera buttons; 'under' is reached only from the build step-through. */
const TOOLBAR_VIEWS: ViewName[] = ['iso', 'top', 'side', 'front'];

const JOINT_BOX = new THREE.BoxGeometry(1, 1, 1);
const JOINT_CYL = new THREE.CylinderGeometry(1, 1, 1, 16).rotateX(Math.PI / 2);
const JOINT_MATS = new Map<string, THREE.Material>();
let exposedWarned = false;

function hasExposedEdge(part: Part): boolean {
  const e = part.edges;
  return part.kind === 'sheet' && (Array.isArray(e) ? e.includes('exposed') : e === 'exposed');
}

const HIGHLIGHT_CACHE = new Map<string, THREE.Material>();

function highlightMaterial(base: SurfaceMats, key: string, color: string): SurfaceMats {
  if (Array.isArray(base)) return base.map((b, i) => highlightMaterial(b, `${key}#${i}`, color) as THREE.Material);
  const k = `${key}|${color}`;
  let m = HIGHLIGHT_CACHE.get(k);
  if (!m) {
    const c = base.clone() as THREE.MeshStandardMaterial;
    c.color = new THREE.Color(color);
    c.emissive = new THREE.Color(color);
    c.emissiveIntensity = 0.45;
    c.side = THREE.DoubleSide;
    HIGHLIGHT_CACHE.set(k, c);
    m = c;
  }
  return m;
}

const GHOST_CACHE = new Map<string, THREE.Material>();

/** A see-through copy of a part's material, for the parts around one that "Show in 3D" is pointing at (a knee behind the rail would otherwise barely show). */
function ghostMaterial(base: SurfaceMats, key: string): SurfaceMats {
  if (Array.isArray(base)) return base.map((b, i) => ghostMaterial(b, `${key}#${i}`) as THREE.Material);
  const k = `${key}|ghost`;
  let m = GHOST_CACHE.get(k);
  if (!m) {
    const c = base.clone() as THREE.MeshStandardMaterial;
    c.transparent = true;
    c.opacity = 0.16;
    c.depthWrite = false;
    GHOST_CACHE.set(k, c);
    m = c;
  }
  return m;
}

interface MeshInfo {
  mesh: THREE.Mesh;
  part: Part;
  dir: Vec3;
  baseMat: SurfaceMats;
  key: string;
  normalMat: SurfaceMats;
  /** Sheet part with an exposed ply edge. */
  exposed: boolean;
}

export type SectionAxis = 'off' | 'x' | 'y' | 'z';

/** A static piece of the simulation scene, in the ground frame (inches): the slab, a root or a curb. */
export interface SimSceneShape {
  id: string;
  kind: 'box' | 'cylinder';
  /** Box: half extents. Cylinder (axis Y): [radius, halfLength, radius]. */
  half: Vec3;
  center: Vec3;
}

/** How long the viewer keeps drawing every frame after a change, and the longest it goes without a frame while idle. */
const ACTIVE_MS = 1500;
const IDLE_FRAME_MS = 500;

export class Viewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 1, 5000);
  private readonly controls: OrbitControls;
  /** Sled meshes. In truck view its matrix is the cart-to-truck transform. */
  private readonly partsGroup = new THREE.Group();
  private readonly truckGroup = new THREE.Group();
  private readonly envObjects: THREE.Object3D[] = [];
  private readonly canvasHost: HTMLElement;
  private readonly toggleHost: HTMLElement;
  private readonly hidden = new Set<PartGroup>();
  private infos: MeshInfo[] = [];
  private framed = false;
  private lastGroups: PartGroup[] = [];
  private explodeAmount = 0;
  private highlighted = new Set<string>();
  /** While a part is pointed at ("Show in 3D"), every other part is drawn see-through so the part is seen even behind a rail or a deck. */
  private ghostOthers = false;
  private highlightColor = '#ff3b30';
  private readonly sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  private sectionOut!: HTMLOutputElement;
  private readonly overlay = new THREE.Group();
  private readonly labelRenderer = new CSS2DRenderer();
  private showCg = false; // off until the CG checkbox is ticked (review r2 SHOULD 9)
  private showDims = false;
  private showJoinery = false;
  private simple = false;
  private readonly joineryGroup = new THREE.Group();
  private legendEl!: HTMLElement;
  private lastParts: Part[] = [];
  // Controls the Simple view hides (the `adv-only` class); kept so simple mode can reset them.
  private sectionSel?: HTMLSelectElement;
  private cgCb?: HTMLInputElement;
  private dimsCb?: HTMLInputElement;
  private truckFrameKey: string | null = null;
  private inTruck = false;
  /** Physics sim: per-rigid-body pose (relative to the build pose), the posed ground group and the camera follow point. */
  private bodyPoses: Map<RigidBody, Mat4> | null = null;
  private readonly simGroup = new THREE.Group();
  private simGrid: THREE.GridHelper | null = null;
  private simActive = false;
  private lastFollow: Vec3 | null = null;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private gridMat?: THREE.Material;
  private groundPool?: THREE.Mesh;
  private shadowPlane?: THREE.Mesh;
  private contactGroup = new THREE.Group();
  private edgeLines: THREE.LineSegments[] = [];
  private showEdges = true;
  /** Shop aids (jigs and forms such as a lamination form) are hidden until the Advanced "Shop aids" toggle asks for them. */
  private showShopAids = false;
  private edgesCb?: HTMLInputElement;
  private sunDir = new THREE.Vector3(-10, -90, 150).normalize();
  private currentView: ViewName = 'iso';
  /** The user orbited / zoomed since the last view button or auto-frame; until then a resize re-frames the sled. */
  private userMoved = false;
  /** Part ids the camera was last framed on (`frameParts`); an automatic re-fit (resize, explode) keeps framing them until a view button or an orbit. */
  private focusIds: string[] = [];
  private sunCenter = new THREE.Vector3(30, 0, 10);
  private sunRadius = 60;
  private readonly tmpA = new THREE.Matrix4();
  private readonly tmpB = new THREE.Matrix4();

  /** Where the secondary controls live: inline on wide screens, in a "More" panel on phones (M7). */
  private moreHost!: HTMLElement;
  private moreBtn!: HTMLButtonElement;
  private explodeLabel?: HTMLElement;
  private toolbarEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  /** The canvas was clicked, so the mouse wheel zooms it (otherwise the wheel scrolls the page; M2). */
  private canvasActive = false;

  /** Append a control (e.g. the view-only steer slider) to the toolbar. */
  addToolbarControl(node: HTMLElement): void {
    this.moreHost.append(node);
  }

  constructor(container: HTMLElement) {
    container.classList.add('viewer-host');
    this.canvasHost = el('div', 'viewer-canvas');
    const toolbar = el('div', 'viewer-toolbar');
    this.toggleHost = el('div', 'viewer-toggles');
    // The controls live in their own bar above the canvas (never overlaying the sled).
    const bar = el('div', 'viewer-bar');
    bar.append(toolbar, this.toggleHost);
    const stage = el('div', 'viewer-stage');
    stage.append(this.canvasHost);
    this.hintEl = el('div', 'viewer-hint');
    this.hintEl.setAttribute('aria-hidden', 'true');
    stage.append(this.hintEl);
    this.legendEl = el('div', 'joinery-legend');
    this.legendEl.hidden = true;
    this.legendEl.setAttribute('aria-label', 'Joinery legend');
    Object.assign(this.legendEl.style, {
      position: 'absolute', left: '8px', bottom: '8px', padding: '4px 8px', font: '12px system-ui, sans-serif',
      background: 'color-mix(in srgb, var(--panel, #fff) 85%, transparent)', color: 'var(--text, #222)', borderRadius: '4px', pointerEvents: 'none', zIndex: '2',
    });
    for (const l of JOINERY_LEGEND) {
      const row = el('div', '');
      const sw = el('span', '');
      Object.assign(sw.style, { display: 'inline-block', width: '10px', height: '10px', marginRight: '6px', background: l.color, borderRadius: '2px' });
      row.append(sw, l.label);
      this.legendEl.append(row);
    }
    stage.append(this.legendEl);
    container.append(bar, stage);

    // Row 1: the four camera views. Everything else goes in `moreHost` (inline on wide screens, a "More" panel on phones).
    const views = el('div', 'viewer-views');
    views.setAttribute('role', 'group');
    views.setAttribute('aria-label', 'Camera view');
    for (const name of TOOLBAR_VIEWS) {
      const b = el('button', '');
      b.type = 'button';
      b.textContent = VIEW_LABELS[name];
      b.addEventListener('click', () => this.setView(name));
      views.append(b);
    }
    this.moreHost = el('div', 'viewer-more');
    this.moreHost.id = 'viewer-more';
    const moreBtn = el('button', 'viewer-more-btn');
    moreBtn.type = 'button';
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.setAttribute('aria-controls', 'viewer-more');
    moreBtn.textContent = 'More ▾';
    moreBtn.addEventListener('click', () => {
      const open = !this.moreHost.classList.contains('open');
      this.moreHost.classList.toggle('open', open);
      moreBtn.setAttribute('aria-expanded', String(open));
      moreBtn.textContent = open ? 'More ▴' : 'More ▾';
    });
    this.moreBtn = moreBtn;
    this.toolbarEl = toolbar;
    toolbar.append(views, moreBtn, this.moreHost);
    // Phone: a tap on the 3D view folds the "More" sheet away so the sled is never hidden behind it.
    this.canvasHost.addEventListener('pointerdown', () => {
      if (!this.moreHost.classList.contains('open')) return;
      this.moreHost.classList.remove('open');
      moreBtn.setAttribute('aria-expanded', 'false');
      moreBtn.textContent = 'More ▾';
    });
    this.buildExplodeControl();
    this.buildSectionControl();
    this.buildOverlayControls();

    // alpha: the soft gradient behind the sled is CSS (`.viewer-canvas`), so it follows the app theme with no re-render.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed from three; shadow.radius softens the edge
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    this.canvasHost.append(this.renderer.domElement);
    const ld = this.labelRenderer.domElement;
    ld.className = 'viewer-labels';
    this.canvasHost.append(ld);

    // Model frame is Z-up: +X forward, +Y left.
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // Reduced motion: no inertia (N6).
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.controls.enableDamping = !reduceMotion.matches;
    reduceMotion.addEventListener('change', () => (this.controls.enableDamping = !reduceMotion.matches));
    this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('start', () => (this.userMoved = true));
    this.setupScrollCapture();

    this.buildScene();
    this.applyTheme();
    // Follow the app theme (html[data-theme], set by src/theme.ts) for the 3D background.
    new MutationObserver(() => this.applyTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    new ResizeObserver(() => this.resize()).observe(this.canvasHost);
    this.resize();
    this.setView('iso', new THREE.Box3(new THREE.Vector3(-10, -24, 0), new THREE.Vector3(60, 24, 30)));

    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.renderNow(); });
    (window as unknown as { __klondikeViewer?: Viewer }).__klondikeViewer = this; // debug hook: benchmark(), perf checks
    // Draw only while something is changing (a full 60-120 fps render of a 300-draw-call scene with shadows, forever, kept a laptop fan and a browser busy
    // when nothing moved). Orbit damping, any change through the public methods, and any pointer/wheel/key/form event on the viewer keep it drawing for a moment; an
    // occasional frame in between is the safety net for anything that slipped past.
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'input', 'change', 'click', 'touchstart', 'touchmove'])
      container.addEventListener(ev, () => this.touch(), { passive: true, capture: true });
    const loop = () => {
      requestAnimationFrame(loop);
      const moved = this.controls.update();
      const now = performance.now();
      if (moved || now < this.activeUntil || now - this.lastRender > IDLE_FRAME_MS) this.renderNow();
    };
    loop();
  }

  private activeUntil = 0;
  private lastRender = 0;
  /** Keep drawing at full rate for a moment: something changed. */
  private touch(): void {
    this.activeUntil = performance.now() + ACTIVE_MS;
  }

  /** Debug: average milliseconds per `renderer.render` over `frames` frames (GPU-synchronized with a 1-pixel readback). */
  benchmark(frames = 60): number {
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      this.renderer.render(this.scene, this.camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    return (performance.now() - t0) / frames;
  }

  /** Show a short hint over the canvas; it fades by itself. */
  private showHint(text: string): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hintEl.classList.remove('show'), 1800);
  }

  /**
   * The canvas must not trap page scrolling (M2). Touch: one finger scrolls the page, two fingers orbit and pinch-zoom.
   * Mouse / trackpad: the wheel scrolls the page, and zooms only while Ctrl or Cmd is held (a trackpad pinch already sets
   * ctrlKey) or after the canvas was clicked ("activated"; clicking elsewhere or leaving the canvas deactivates it).
   */
  private setupScrollCapture(): void {
    const dom = this.renderer.domElement;
    // OrbitControls sets touch-action:none; 'pan-y' hands single-finger vertical swipes back to the page.
    dom.style.touchAction = 'pan-y';
    this.controls.touches = { ONE: null as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };
    // Once two fingers are down the gesture is ours: stop the browser from also scrolling.
    dom.addEventListener('touchmove', (e) => { if (e.touches.length >= 2 && e.cancelable) e.preventDefault(); }, { passive: false });
    dom.addEventListener('touchstart', (e) => { if (e.touches.length === 1) this.showHint('Two fingers to rotate and zoom'); }, { passive: true });

    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    // Capture phase on the parent runs before OrbitControls' own wheel handler (which calls preventDefault when zoom is on).
    this.canvasHost.addEventListener('wheel', (e) => {
      const allow = e.ctrlKey || e.metaKey || this.canvasActive;
      this.controls.enableZoom = allow;
      setTimeout(() => (this.controls.enableZoom = true)); // only gate the wheel; pinch (touch) zoom stays available
      if (!allow) this.showHint(isMac ? '⌘ + scroll to zoom (or click the sled first)' : 'Ctrl + scroll to zoom (or click the sled first)');
    }, { capture: true, passive: true });
    dom.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') this.canvasActive = true; });
    dom.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.canvasActive = false; });
    window.addEventListener('pointerdown', (e) => { if (!this.canvasHost.contains(e.target as Node)) this.canvasActive = false; });
  }

  private buildExplodeControl(): void {
    const out = el('output', 'steer-out');
    out.textContent = '0"';
    const r = el('input', '');
    r.type = 'range';
    r.min = '0';
    r.max = '36';
    r.step = '0.5';
    r.value = '0';
    r.setAttribute('aria-label', 'Exploded view distance');
    r.addEventListener('input', () => {
      this.setExplode(Number(r.value));
      out.textContent = `${r.value}"`;
    });
    const label = el('label', 'steer-ctl'); // shown in Simple too (D-30)
    label.title = 'Exploded view: each part moves along its own explode vector (radially from the center of gravity if it has none), farther the farther it is from the CG. The CG marker and dimensions are hidden while exploded';
    label.append('Explode', r, out);
    this.explodeLabel = label;
    this.moreHost.append(label);
  }

  private buildSectionControl(): void {
    const sel = el('select', '');
    sel.setAttribute('aria-label', 'Section plane axis');
    for (const [v, t] of [['off', 'Off'], ['x', 'X'], ['y', 'Y'], ['z', 'Z']]) {
      const o = el('option', '');
      o.value = v;
      o.textContent = t;
      sel.append(o);
    }
    const r = el('input', '');
    r.type = 'range';
    r.step = '0.5';
    r.disabled = true;
    r.setAttribute('aria-label', 'Section plane position');
    const out = (this.sectionOut = el('output', 'steer-out'));
    sel.addEventListener('change', () => {
      const axis = sel.value as SectionAxis;
      if (axis !== 'off') {
        const k = 'xyz'.indexOf(axis);
        const box = this.modelBox();
        r.min = String(Math.floor(box.min.getComponent(k)));
        r.max = String(Math.ceil(box.max.getComponent(k)));
        r.value = r.max;
      }
      r.disabled = axis === 'off';
      this.setSection(axis, Number(r.value));
    });
    r.addEventListener('input', () => this.setSection(sel.value as SectionAxis, Number(r.value)));
    const label = el('label', 'steer-ctl adv-only');
    this.sectionSel = sel;
    label.title = 'Section plane: hides everything beyond the plane (keeps the low side)';
    label.append('Section', sel, r, out);
    this.moreHost.append(label);
  }

  private buildOverlayControls(): void {
    const mk = (text: string, title: string, checked: boolean, on: (v: boolean) => void, simpleToo = false) => {
      const cb = el('input', '');
      cb.type = 'checkbox';
      cb.checked = checked;
      cb.addEventListener('change', () => on(cb.checked));
      const label = el('label', simpleToo ? 'steer-ctl' : 'steer-ctl adv-only');
      label.title = title;
      label.append(cb, text);
      this.moreHost.append(label);
      return cb;
    };
    this.cgCb = mk('CG', 'Center-of-gravity marker and drop line for what is shown (empty, or with rider and cargo)', false, (v) => {
      this.showCg = v;
      this.rebuildOverlay();
    });
    this.dimsCb = mk('Dimensions', 'Overall length, width and height, wheelbase, track and deck height', false, (v) => {
      this.showDims = v;
      this.rebuildOverlay();
    }, true); // also offered in the Simple view
    // Advanced only (Eric, D-65): in Simple the outlines are always on.
    this.edgesCb = mk('Outline edges', 'Draws thin dark outlines along the sharp edges of every part, so you can see where one piece ends and the next begins. Turn it off to see the finish and the shading only.', true, (v) => {
      this.showEdges = v;
      for (const l of this.edgeLines) l.visible = v;
    });
    mk('Shop aids', 'Show shop jigs and forms (for example a lamination form) as faint gray wireframes', false, (v) => {
      this.showShopAids = v;
      this.refreshVisibility();
    });
    mk('Joinery', 'Mark each Domino, tenon, insert, bolt, screw and knob location (each physical joint once)', false, (v) => {
      this.showJoinery = v;
      this.rebuildOverlay();
    });
  }

  /** Joint markers (Advanced, Joinery checkbox): drawn once per physical joint, hidden while exploded. */
  private rebuildJoinery(): void {
    this.touch();
    for (const c of [...this.joineryGroup.children]) {
      this.joineryGroup.remove(c); // geometries and materials are shared; nothing to dispose
    }
    const on = this.showJoinery && !this.simple && this.explodeAmount === 0 && this.lastParts.length > 0;
    this.legendEl.hidden = !on;
    if (!on) return;
    const { markers, missingAt } = joineryMarkers(this.lastParts);
    if (missingAt.length) console.warn(`viewer: ${missingAt.length} structured joint(s) have no \`at\`; not drawn`, missingAt);
    const tmp = new THREE.Vector3();
    for (const m of markers) {
      const color = jointColor(m.type);
      if (!color) continue;
      const mat = JOINT_MATS.get(color) ?? JOINT_MATS.set(color, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false })).get(color)!;
      const mesh = new THREE.Mesh(m.shape === 'box' ? JOINT_BOX : JOINT_CYL, mat);
      mesh.renderOrder = 998;
      mesh.name = `joint:${m.type}${m.size ? ' ' + m.size : ''}`;
      // Box: l along the insertion axis, the long width perpendicular to it (world Z, or Y when inserting along Z).
      // Cylinder (unit, along local Z): radius w, length l, axis along the insertion axis.
      const ax = tmp.set(...m.axis);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax);
      mesh.quaternion.copy(q);
      if (m.shape === 'box') {
        // Local Z = insertion axis; make local Y (the width) vertical when possible.
        const wAxis = Math.abs(m.axis[2]) > 0.5 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
        const zl = ax.clone();
        const xl = new THREE.Vector3().crossVectors(wAxis, zl).normalize();
        const yl = new THREE.Vector3().crossVectors(zl, xl);
        mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xl, yl, zl));
        mesh.scale.set(m.sizeIn.t, m.sizeIn.w, m.sizeIn.l);
      } else {
        mesh.scale.set(m.sizeIn.w, m.sizeIn.t, m.sizeIn.l);
      }
      mesh.position.set(...m.at);
      this.joineryGroup.add(mesh);
    }
  }

  /** CG marker + drop line and the dimension lines, in the (possibly truck-placed) model frame. */
  private rebuildOverlay(): void {
    this.touch();
    this.rebuildJoinery();
    for (const c of [...this.overlay.children]) {
      if (c === this.joineryGroup) continue;
      this.overlay.remove(c);
      const o = c as THREE.Mesh;
      o.geometry?.dispose();
    }
    const parts = this.lastParts;
    if (!parts.length || this.explodeAmount > 0) return;
    const hot = new THREE.LineBasicMaterial({ color: 0xe5322d, depthTest: false });
    const dimMat = new THREE.LineBasicMaterial({ color: 0x1f6feb, depthTest: false });
    const label = (text: string, at: Vec3, cls: string) => {
      const d = document.createElement('div');
      d.className = cls;
      d.textContent = text;
      const o = new CSS2DObject(d);
      o.position.set(...at);
      this.overlay.add(o);
    };
    const line = (pts: Vec3[], mat: THREE.Material) => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p))), mat);
      l.renderOrder = 999;
      this.overlay.add(l);
    };

    if (this.showCg) {
      const cg = centerOfGravity(parts, { includePayload: true });
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 12), new THREE.MeshBasicMaterial({ color: 0xe5322d, depthTest: false }));
      ball.position.set(...cg);
      ball.renderOrder = 1000;
      this.overlay.add(ball);
      line([cg, [cg[0], cg[1], 0]], hot);
      label(`CG ${cg[0].toFixed(1)}, ${cg[1].toFixed(1)}, ${cg[2].toFixed(1)}`, [cg[0], cg[1], cg[2] + 3], 'dim-label cg-label');
    }

    if (this.showDims) {
      const sled = parts.filter((x) => !x.payload && x.group !== 'reference' && x.id !== 'bridle' && !/rope/i.test(x.name)); // ropes are not drawn; the tongue plate and shackle are, and count in the overall length
      if (!sled.length) return;
      const bb = worldAABB(sled);
      const [x0, y0, z0] = bb.min;
      const [x1, y1, z1] = bb.max;
      const o = 5; // offset of the dimension lines from the sled
      const dim = (a: Vec3, b: Vec3, text: string) => {
        line([a, b], dimMat);
        const ticks = 1.2;
        for (const e of [a, b]) line([[e[0] - ticks, e[1] - ticks, e[2]], [e[0] + ticks, e[1] + ticks, e[2]]], dimMat);
        label(text, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], 'dim-label');
      };
      const f = (v: number) => `${v.toFixed(1)}"`;
      dim([x0, y0 - o, 0], [x1, y0 - o, 0], `Length ${f(x1 - x0)} overall`);
      dim([x1 + o, y0, 0], [x1 + o, y1, 0], `Width ${f(y1 - y0)}`);
      dim([x0 - o, y1 + o, 0], [x0 - o, y1 + o, z1], `Height ${f(z1 - 0)} overall`);
      const wheels = sled.filter((x) => x.geometry.type === 'wheel').map((x) => partCentroid(x));
      if (wheels.length >= 2) {
        const xs = wheels.map((c) => c[0]);
        const rearX = Math.min(...xs), frontX = Math.max(...xs);
        const ys = wheels.filter((c) => Math.abs(c[0] - rearX) < 3).map((c) => c[1]);
        const wz = wheels[0][2];
        if (frontX - rearX > 1) dim([rearX, y1 + o + 6, wz], [frontX, y1 + o + 6, wz], `Wheelbase ${f(frontX - rearX)}`);
        if (ys.length >= 2) dim([rearX, Math.min(...ys), 0], [rearX, Math.max(...ys), 0], `Track ${f(Math.max(...ys) - Math.min(...ys))}`);
      }
      const deck = sled.filter((x) => /deck/i.test(x.id));
      if (deck.length) {
        const db = worldAABB(deck);
        const cx = (db.min[0] + db.max[0]) / 2;
        dim([cx, y1 + o, 0], [cx, y1 + o, db.max[2]], `Deck ${f(db.max[2])}`);
      }
      void z0;
    }
  }

  /**
   * Build mode (the Assembly step-through): the toolbar is the four view buttons and Explode, at every width; everything else (Dimensions,
   * Outline edges, Shop aids, Joinery, CG, Section, the layer toggles) sits behind the "More" sheet, so the toolbar does not eat the viewer.
   * The layout itself is CSS (`#app[data-mode='build']` in build-panel.css); this only moves Explode out of the sheet and back, and folds the sheet.
   */
  setBuildMode(on: boolean): void {
    this.touch();
    if (!this.explodeLabel) return;
    this.moreHost.classList.remove('open');
    this.moreBtn.setAttribute('aria-expanded', 'false');
    this.moreBtn.textContent = 'More ▾';
    if (on) this.toolbarEl.insertBefore(this.explodeLabel, this.moreBtn);
    else this.moreHost.prepend(this.explodeLabel);
  }

  /**
   * Simple view (D-30): the explode, section, CG, dimension and group controls are hidden by CSS (`adv-only`, the
   * `viewer-toggles` bar), so reset what they drive: no explode, no section, no CG marker, no dimensions, every group
   * visible. Leaving simple mode restores the CG / dimension overlays to their checkboxes.
   */
  setSimpleMode(simple: boolean): void {
    this.touch();
    this.simple = simple;
    this.showEdges = simple ? true : this.edgesCb?.checked ?? true; // the outline toggle is Advanced only; Simple always draws them
    for (const l of this.edgeLines) l.visible = this.showEdges;
    this.applyBaseMaterials();
    this.applyHighlight();
    if (simple) {
      if (this.sectionSel) this.sectionSel.value = 'off';
      this.setSection('off', 0);
      this.hidden.clear();
      this.refreshVisibility(); // no shop jigs in Simple (UX r2)
      this.lastGroups = []; // rebuild the (hidden) group checkboxes so they read "shown" again
      this.showCg = false;
      this.showDims = this.dimsCb?.checked ?? false; // Dimensions stays available in Simple
    } else {
      this.showCg = this.cgCb?.checked ?? false;
      this.showDims = this.dimsCb?.checked ?? false;
    }
    this.rebuildOverlay();
    if (simple && this.lastParts.length) this.refreshToggles(this.lastParts);
  }

  /** Exploded distance in inches (part.explode × amount). */
  setExplode(amount: number): void {
    this.touch();
    const was = this.explodeAmount > 0;
    this.explodeAmount = amount;
    this.applyMatrices();
    if (was !== amount > 0) this.rebuildOverlay(); // the CG / dimension overlay is hidden while exploded
    if (this.framed && !this.userMoved && !this.simActive && !this.inTruck) this.setView(this.currentView, undefined, true); // re-fit to the exploded bounds
  }

  setSection(axis: SectionAxis, pos: number): void {
    this.touch();
    this.sectionOut.textContent = axis === 'off' ? '' : `${pos}"`;
    if (axis === 'off') {
      this.renderer.clippingPlanes = [];
      return;
    }
    const n = new THREE.Vector3();
    n.setComponent('xyz'.indexOf(axis), -1);
    this.sectionPlane.set(n, pos); // keeps points with coordinate <= pos
    this.renderer.clippingPlanes = [this.sectionPlane];
  }

  /** Tint the given part ids (sled parts). Pass [] to clear. `ghostOthers` draws every other part see-through while the tint is on. */
  highlight(ids: string[], color = '#ff3b30', ghostOthers = false): void {
    this.touch();
    this.highlighted = new Set(ids);
    this.highlightColor = color;
    this.ghostOthers = ghostOthers && ids.length > 0;
    this.applyHighlight();
  }

  /** Exposed-edge parts are red in Advanced (the Simple view keeps the normal ply color). */
  private applyBaseMaterials(): void {
    for (const i of this.infos) i.baseMat = i.exposed && !this.simple ? EXPOSED_MAT : i.normalMat;
  }

  private applyHighlight(): void {
    for (const i of this.infos) {
      i.mesh.material = this.highlighted.has(i.part.id) ? highlightMaterial(i.baseMat, i.key, this.highlightColor) : this.ghostOthers ? ghostMaterial(i.baseMat, i.key) : i.baseMat;
    }
  }

  private applyMatrices(): void {
    this.touch();
    for (const i of this.infos) {
      const pose = this.bodyPoses?.get(i.part.body);
      if (pose) {
        // Simulation: world = body pose (relative to its build pose) · the part's build transform; no explode.
        i.mesh.matrix.multiplyMatrices(this.tmpA.fromArray(pose), this.tmpB.fromArray(i.part.transform));
        i.mesh.matrixWorldNeedsUpdate = true;
        continue;
      }
      i.mesh.matrix.fromArray(i.part.transform);
      i.mesh.matrix.elements[12] += i.dir[0] * this.explodeAmount;
      i.mesh.matrix.elements[13] += i.dir[1] * this.explodeAmount;
      i.mesh.matrix.elements[14] += i.dir[2] * this.explodeAmount;
      i.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  private buildScene(): void {
    // Units are inches. 20 ft grid in 1 ft squares, rotated from three's XZ default into the XY plane.
    const grid = new THREE.GridHelper(240, 20, 0x8a8f98, 0x8a8f98);
    grid.rotation.x = Math.PI / 2;
    const gm = grid.material as THREE.Material;
    gm.transparent = true;
    gm.opacity = 0.3;
    // Fade the grid with distance from the sled (review r2 SHOULD 7): full strength near it, gone by about 115".
    gm.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vGp;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vGp;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(50.0, 115.0, length(vGp.xy - vec2(25.0, 0.0)));');
    };
    this.gridMat = gm;
    this.scene.add(grid);

    // A soft ground pool under the sled so it never floats on the dark background (lit warm gray, fading to nothing).
    const gc = document.createElement('canvas');
    gc.width = gc.height = 256;
    const gx = gc.getContext('2d')!;
    const gr = gx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    gx.fillStyle = gr;
    gx.fillRect(0, 0, 256, 256);
    const gtex = new THREE.CanvasTexture(gc);
    gtex.colorSpace = THREE.SRGBColorSpace;
    this.groundPool = new THREE.Mesh(new THREE.CircleGeometry(100, 48), new THREE.MeshBasicMaterial({ map: gtex, color: 0x7a6e5e, transparent: true, opacity: 0.4, depthWrite: false }));
    (this.groundPool.geometry as THREE.CircleGeometry).scale(1, 0.62, 1);
    this.groundPool.position.set(25, 0, -0.1);
    this.groundPool.renderOrder = -2;
    this.scene.add(this.groundPool);
    this.envObjects.push(this.groundPool);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.ShadowMaterial({ opacity: 0.3 }));
    ground.position.z = -0.05;
    ground.receiveShadow = true;
    this.shadowPlane = ground;
    this.scene.add(ground);
    this.contactGroup.renderOrder = 1;
    this.scene.add(this.contactGroup);
    this.envObjects.push(grid, ground, this.contactGroup);

    // Soft daylight: a room-style environment map for ambient light and reflections (metals, vinyl sheen), a weak
    // hemisphere fill, and one key sun that casts the shadows.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.7;
    pmrem.dispose();
    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x6b5a46, 0.5);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    sun.shadow.radius = 3;
    this.sun = sun;
    this.placeSun(this.sunCenter, this.sunRadius);
    this.scene.add(sun, sun.target);

    this.partsGroup.matrixAutoUpdate = false;
    this.overlay.matrixAutoUpdate = false;
    this.overlay.add(this.joineryGroup);
    this.truckGroup.visible = false;
    this.simGroup.matrixAutoUpdate = false;
    this.simGroup.visible = false;
    this.scene.add(this.partsGroup, this.truckGroup, this.overlay, this.simGroup);
  }

  /** Key light from the front-left and above; the shadow box is a tight fit around a sphere (the model bounds). */
  private placeSun(center: THREE.Vector3, radius: number): void {
    this.sunCenter.copy(center);
    this.sunRadius = radius;
    this.sun.position.copy(center).addScaledVector(this.sunDir, radius * 3);
    this.sun.target.position.copy(center);
    this.sun.target.updateMatrixWorld();
    const sc = this.sun.shadow.camera;
    const r = radius * 1.15;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = radius * 0.5; sc.far = radius * 6;
    sc.updateProjectionMatrix();
  }

  /** The 3D background is a CSS gradient on the canvas host (see `.viewer-canvas`); here only the grid / shadow follow the theme. */
  private applyTheme(): void {
    this.touch();
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    this.scene.background = null;
    const gm = this.gridMat as THREE.LineBasicMaterial | undefined;
    if (gm) {
      gm.color.set(dark ? 0x59606c : 0x8a8f98);
      gm.opacity = dark ? 0.35 : 0.3;
    }
    if (this.groundPool) {
      const m = this.groundPool.material as THREE.MeshBasicMaterial;
      m.color.set(dark ? 0x8c7d68 : 0xb9ad98);
      m.opacity = dark ? 0.5 : 0.28;
    }
    if (this.shadowPlane) (this.shadowPlane.material as THREE.ShadowMaterial).opacity = dark ? 0.5 : 0.3;
    this.hemi.intensity = dark ? 0.4 : 0.5;
    this.scene.environmentIntensity = dark ? 0.6 : 0.7;
    for (const m of this.contactGroup.children) ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = dark ? 0.8 : 0.5;
  }

  /** Soft blobs under the body and each wheel: a cheap contact shadow / ambient occlusion. */
  private rebuildContactShadows(parts: Part[]): void {
    for (const c of [...this.contactGroup.children]) {
      this.contactGroup.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    const sled = parts.filter((p) => !p.payload && p.group !== 'reference' && lookOf(p) !== 'rope'); // the rope is not drawn (owner, round 3)
    if (!sled.length) return;
    const bb = worldAABB(sled);
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const mat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: dark ? 0.8 : 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const blob = (cx: number, cy: number, w: number, h: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(cx, cy, 0.04);
      this.contactGroup.add(m);
    };
    blob((bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.max[0] - bb.min[0]) * 1.2, (bb.max[1] - bb.min[1]) * 1.3);
    for (const w of sled) {
      if (w.geometry.type !== 'wheel') continue;
      const c = partCentroid(w);
      const g = w.geometry;
      blob(c[0], c[1], g.diameter * 0.55, Math.max(g.width, g.hubLength) * 2.2);
    }
  }

  private resize(): void {
    const w = this.canvasHost.clientWidth || 1;
    const h = this.canvasHost.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // First-load bug fix: the initial frame was computed before the layout settled (a tiny or zero-size canvas gives a
    // wild aspect ratio and camera distance), and nothing re-framed it until a view button was clicked. Until the user
    // moves the camera, every resize re-frames the same view.
    if (this.framed && !this.userMoved && !this.simActive) this.setView(this.currentView, undefined, true);
    // setSize clears the canvas: draw right away so a resize never shows an empty frame (the old "black until a click").
    this.renderNow();
  }

  private renderNow(): void {
    this.lastRender = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  private clearGroup(g: THREE.Group): void {
    for (const child of [...g.children]) {
      const mesh = child as THREE.Mesh;
      if (!mesh.geometry?.userData.shared) mesh.geometry?.dispose();
      (mesh.geometry?.userData.plyLines as THREE.BufferGeometry | undefined)?.dispose();
      for (const c of mesh.children) (c as THREE.LineSegments).geometry?.dispose();
      g.remove(child);
    }
  }

  /** Rebuild meshes from the part list; disposes old geometry. Frames the model on first call. */
  update(parts: Part[]): void {
    this.touch();
    this.clearGroup(this.partsGroup);
    this.infos = [];
    const cg = centerOfGravity(parts);
    this.edgeLines = [];
    for (const part of parts) {
      const built = buildPart(part);
      if (!built) continue;
      const geo = built.geometry;
      const key = built.look;
      const baseMat = built.material;
      const mesh = new THREE.Mesh(geo, baseMat);
      mesh.name = part.id;
      mesh.userData.partId = part.id;
      mesh.userData.group = part.group;
      // Shop aids (e.g. a bent-lam form): reference parts that are fabricated, unlike the rider/cargo figures.
      mesh.userData.shopAid = isShopAid(part);
      mesh.castShadow = !mesh.userData.shopAid && built.look !== 'mannequin' || part.id === 'cargo'; // the rider is a translucent ghost: no shadow; the cargo crate is solid
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.visible = this.shouldShow(mesh);
      const plyGeo = geo.userData.plyLines as THREE.BufferGeometry | undefined;
      if (plyGeo) mesh.add(new THREE.LineSegments(plyGeo, PLY_LINE_MAT)); // identity local matrix, follows the mesh
      if (built.edges) {
        const lines = new THREE.LineSegments(built.edges, EDGE_MAT);
        lines.visible = this.showEdges;
        this.edgeLines.push(lines);
        mesh.add(lines);
      }
      this.partsGroup.add(mesh);
      const exposed = hasExposedEdge(part);
      if (exposed && !exposedWarned) {
        exposedWarned = true;
        console.warn(`viewer: sheet part(s) with an exposed ply edge (e.g. ${part.id}); tinted red in Advanced.`);
      }
      this.infos.push({ mesh, part, dir: explodeDir(part, cg), baseMat, key, normalMat: baseMat, exposed });
    }
    this.applyBaseMaterials();
    this.applyMatrices();
    this.applyHighlight();
    this.refreshToggles(parts);
    this.lastParts = parts;
    this.rebuildOverlay();
    this.rebuildContactShadows(parts);
    this.fitSun();
    if (!this.framed && parts.length) {
      this.framed = true;
      // Wait a frame so the canvas has its laid-out size (aspect) before framing (resize() re-frames if it still moves).
      requestAnimationFrame(() => { this.resize(); this.setView('iso', undefined, true); });
    }
  }

  /**
   * Truck view: show the bed parts (TRUCK frame) and place the sled with `cartTransform` (sled frame -> truck
   * frame). `frameKey` re-frames the camera when it changes. Pass null to return to the normal view.
   */
  setTruck(bed: Part[] | null, cartTransform?: Mat4, frameKey = ''): void {
    this.touch();
    this.clearGroup(this.truckGroup);
    if (!bed) {
      if (this.inTruck) {
        this.inTruck = false;
        this.truckFrameKey = null;
        this.partsGroup.matrix.identity();
        this.overlay.matrix.identity();
        this.overlay.matrixWorldNeedsUpdate = true;
        this.truckGroup.visible = false;
        for (const o of this.envObjects) o.visible = true;
        this.setView('iso');
      }
      return;
    }
    for (const part of bed) {
      const built = buildPart(part);
      if (!built) continue;
      const mesh = new THREE.Mesh(built.geometry, built.material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.fromArray(part.transform);
      mesh.receiveShadow = true;
      mesh.matrixWorldNeedsUpdate = true;
      this.truckGroup.add(mesh);
    }
    this.partsGroup.matrix.fromArray(cartTransform ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    this.partsGroup.matrixWorldNeedsUpdate = true;
    this.overlay.matrix.copy(this.partsGroup.matrix);
    this.overlay.matrixWorldNeedsUpdate = true;
    this.truckGroup.visible = true;
    for (const o of this.envObjects) o.visible = false;
    const entering = !this.inTruck;
    this.inTruck = true;
    if (entering || frameKey !== this.truckFrameKey) {
      this.truckFrameKey = frameKey;
      this.setView('iso', this.truckBox());
    }
  }

  /**
   * Physics sim: pose each rendered part by its rigid body's transform (a column-major 4x4 relative to the part's build
   * pose, inches). Pass null to return to the static model. Parts must have been built with the neutral steer angle.
   */
  setBodyPoses(poses: Map<RigidBody, Mat4> | null): void {
    this.touch();
    this.bodyPoses = poses;
    this.applyMatrices();
  }

  /**
   * Show (or, with null, remove) the simulation ground and obstacles. While shown, the static grid, axes, shadow plane
   * and the CG / dimension overlay are hidden; the shapes live in the ground frame set by `setSimGroundPose`.
   */
  setSimEnvironment(shapes: SimSceneShape[] | null): void {
    this.touch();
    for (const c of [...this.simGroup.children]) {
      this.simGroup.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    this.simGrid = null;
    this.simActive = shapes !== null;
    this.simGroup.visible = this.simActive;
    this.overlay.visible = !this.simActive;
    for (const o of this.envObjects) o.visible = !this.simActive;
    if (!shapes) {
      this.lastFollow = null;
      this.fitSun();
      return;
    }
    this.placeSun(new THREE.Vector3(0, 0, 0), 60); // the sim sun then follows the sled (followPoint)
    const mat = (color: number) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 1 });
      m.side = THREE.DoubleSide;
      return m;
    };
    for (const s of shapes) {
      let mesh: THREE.Mesh;
      if (s.kind === 'box') {
        // The slab is huge; clamp the drawn size so depth precision holds, the physics slab stays large.
        const hx = Math.min(s.half[0], 3000), hy = Math.min(s.half[1], 3000);
        mesh = new THREE.Mesh(new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * s.half[2]), mat(s.id === 'ground' ? 0xa79a78 : 0x8d8f94));
        const cx = s.id === 'ground' ? 0 : Math.min(s.center[0], 3000 - hx + s.center[0]);
        mesh.position.set(cx, s.center[1], s.center[2]);
        if (s.id === 'curb') {
          // The curb is an endless step: draw only 3000" of it from its face.
          mesh.geometry.dispose();
          mesh.geometry = new THREE.BoxGeometry(3000, 2 * hy, 2 * s.half[2]);
          mesh.position.set(s.center[0] - s.half[0] + 1500, s.center[1], s.center[2]);
        }
      } else {
        const g = new THREE.CylinderGeometry(s.half[0], s.half[0], 2 * Math.min(s.half[1], 3000), 24); // axis Y
        mesh = new THREE.Mesh(g, mat(0x6b4a2b));
        mesh.position.set(...s.center);
      }
      mesh.receiveShadow = true;
      mesh.castShadow = s.id !== 'ground';
      this.simGroup.add(mesh);
    }
    const grid = new THREE.GridHelper(4800, 100, 0x5b5f55, 0x7b7e73);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0.06;
    const gm = grid.material as THREE.Material;
    gm.transparent = true;
    gm.opacity = 0.5;
    this.simGroup.add(grid);
    this.simGrid = grid;
  }

  /**
   * Orientation of the sim ground (a column-major 4x4 about the origin, inches). `focus` is the sled's world position:
   * the grid is re-centerd under it (snapped to its 48" cells) and the sun's shadow box follows it.
   */
  setSimGroundPose(pose: Mat4, focus?: Vec3): void {
    this.touch();
    this.simGroup.matrix.fromArray(pose);
    this.simGroup.matrixWorldNeedsUpdate = true;
    if (focus && this.simGrid) {
      const local = new THREE.Vector3(...focus).applyMatrix4(this.tmpA.fromArray(pose).invert());
      this.simGrid.position.x = Math.round(local.x / 48) * 48;
      this.simGrid.position.y = Math.round(local.y / 48) * 48;
    }
  }

  /**
   * Keep the orbit camera on a moving point (e.g. the sled in the sim) while leaving the user's view angle alone.
   * `snap` first jumps the orbit target onto the point (a new run).
   */
  followPoint(p: Vec3 | null, snap = false): void {
    this.touch();
    if (!p) {
      this.lastFollow = null;
      return;
    }
    if (snap) {
      // Jump the orbit target to the point, keeping the viewing direction and distance.
      const d = new THREE.Vector3(p[0], p[1], p[2]).sub(this.controls.target);
      this.controls.target.add(d);
      this.camera.position.add(d);
    } else if (this.lastFollow) {
      const d = new THREE.Vector3(p[0] - this.lastFollow[0], p[1] - this.lastFollow[1], p[2] - this.lastFollow[2]);
      this.controls.target.add(d);
      this.camera.position.add(d);
    }
    this.lastFollow = [...p];
    this.placeSun(new THREE.Vector3(p[0], p[1], 0), 60);
  }

  private refreshToggles(parts: Part[]): void {
    const groups = [...new Set(parts.map((p) => p.group))].sort();
    if (groups.join() === this.lastGroups.join()) return;
    this.lastGroups = groups;
    this.toggleHost.replaceChildren();
    for (const g of groups) {
      const label = el('label', '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !this.hidden.has(g);
      cb.addEventListener('change', () => {
        if (cb.checked) this.hidden.delete(g); else this.hidden.add(g);
        this.refreshVisibility();
      });
      label.append(cb, document.createTextNode(' ' + (GROUP_LABEL[g] ?? g)));
      this.toggleHost.append(label);
    }
  }

  private shouldShow(m: THREE.Object3D): boolean {
    return !this.hidden.has(m.userData.group as PartGroup) && !(m.userData.shopAid && (this.simple || !this.showShopAids));
  }

  private refreshVisibility(): void {
    this.touch();
    for (const m of this.partsGroup.children) m.visible = this.shouldShow(m);
  }

  private modelBox(): THREE.Box3 {
    const box = new THREE.Box3();
    this.scene.updateMatrixWorld(true);
    for (const m of this.partsGroup.children) if (m.visible) box.expandByObject(m);
    if (box.isEmpty()) box.set(new THREE.Vector3(-10, -24, 0), new THREE.Vector3(60, 24, 30));
    return box;
  }

  /** Fit the key light's shadow box to the model. */
  private fitSun(): void {
    if (this.simActive) return;
    const sphere = this.modelBox().getBoundingSphere(new THREE.Sphere());
    this.placeSun(sphere.center, Math.max(sphere.radius, 20));
  }

  /** Fraction of the canvas (each axis, half-extent in NDC) the model may fill when a view is framed (~80% with a margin). */
  private static readonly FILL = 0.86;

  /** The world box of the named parts that are on screen (null when none of them is). */
  private partsBox(ids: string[]): THREE.Box3 | null {
    const want = new Set(ids);
    const box = new THREE.Box3();
    this.scene.updateMatrixWorld(true);
    for (const i of this.infos) if (want.has(i.part.id) && i.mesh.visible) box.expandByObject(i.mesh);
    return box.isEmpty() ? null : box;
  }

  /**
   * Frame the camera on the given parts (Build mode's "Show in 3D"): the current view direction, the parts' box padded so a washer is not a blur.
   * Later automatic re-fits (a resize, Explode) keep this framing; a view button or an orbit ends it.
   */
  frameParts(ids: string[]): void {
    this.touch();
    if (this.inTruck || this.simActive) return;
    const box = this.partsBox(ids);
    if (!box) return;
    this.focusIds = ids.slice();
    this.setView(this.currentView, this.padFocus(box));
  }

  /** Margin around a framed part: 4 % of its span (at least 3/4 in), and never a view closer than a 14 in span. */
  private padFocus(box: THREE.Box3): THREE.Box3 {
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z);
    const pad = Math.max(0.75, 0.04 * span);
    return box.expandByScalar(pad).expandByScalar(Math.max(0, 14 - span - 2 * pad) / 2);
  }

  setView(name: ViewName, box?: THREE.Box3, auto = false): void {
    this.touch();
    if (!auto) {
      this.userMoved = false;
      if (!box) this.focusIds = [];
    }
    this.currentView = name;
    const raw = !box && auto && !this.inTruck && this.focusIds.length ? this.partsBox(this.focusIds) : null;
    const focus = raw ? this.padFocus(raw) : null;
    const b = box ?? focus ?? (this.inTruck ? this.truckBox() : this.modelBox());
    // Light from near the camera in the Top view, so the shadow falls under the sled instead of a detached ghost up and left.
    if (name === 'top') this.sunDir.set(-0.12, -0.2, 1).normalize(); else this.sunDir.set(-10, -90, 150).normalize();
    this.placeSun(this.sunCenter, this.sunRadius);
    const dir = new THREE.Vector3(...VIEW_DIRS[name]).normalize();
    const sphere = b.getBoundingSphere(new THREE.Sphere());
    const corners: THREE.Vector3[] = [];
    const addCorners = (bb: THREE.Box3): void => {
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) corners.push(new THREE.Vector3(x, y, z));
    };
    if (box || focus || this.inTruck) addCorners(b);
    else {
      // Per-part boxes hug the silhouette far better than one big box (the rear handle would otherwise shrink the sled).
      this.scene.updateMatrixWorld(true);
      const pb = new THREE.Box3();
      for (const m of this.partsGroup.children) if (m.visible) addCorners(pb.setFromObject(m));
      if (!corners.length) addCorners(b);
    }
    const target = sphere.center.clone();
    let dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    this.camera.up.set(0, 0, 1);
    // Fit the box's projection (not its bounding sphere) to FILL of the canvas: re-center on the projected extents, then
    // rescale the distance, a few times (perspective makes it not exactly linear).
    const ndc = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    for (let it = 0; it < 6; it++) {
      this.camera.position.copy(target).addScaledVector(dir, dist);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld(true);
      this.camera.updateProjectionMatrix();
      let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const c of corners) {
        ndc.copy(c).project(this.camera);
        x0 = Math.min(x0, ndc.x); x1 = Math.max(x1, ndc.x); y0 = Math.min(y0, ndc.y); y1 = Math.max(y1, ndc.y);
      }
      const ex = (x1 - x0) / 2, ey = (y1 - y0) / 2;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      right.setFromMatrixColumn(this.camera.matrixWorld, 0);
      up.setFromMatrixColumn(this.camera.matrixWorld, 1);
      // NDC offset -> world offset at the target's depth.
      target.addScaledVector(right, cx * dist * tanV * this.camera.aspect).addScaledVector(up, cy * dist * tanV);
      dist *= Math.max(ex, ey) / Viewer.FILL;
      dist = Math.max(dist, 1);
    }
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.target.copy(target);
    this.camera.lookAt(target);
    this.controls.update();
    this.renderNow();
  }

  /** Bed (without the big ground plane) plus the sled. */
  private truckBox(): THREE.Box3 {
    const box = this.modelBox();
    for (const m of this.truckGroup.children) if (m.matrix.elements[14] > -5) box.expandByObject(m);
    return box;
  }
}

/** Explode distance scaling: a part moves in proportion to its distance from the CG, clamped (so small parts near
 * the middle do not fly as far as big, far-flung assemblies). */
const EXPLODE_REF_IN = 30;
const EXPLODE_MIN_SCALE = 0.25;
const EXPLODE_MAX_SCALE = 1.5;
export function explodeScale(distFromCgIn: number): number {
  return Math.min(EXPLODE_MAX_SCALE, Math.max(EXPLODE_MIN_SCALE, distFromCgIn / EXPLODE_REF_IN));
}

/**
 * Explode vector (inches per unit of the slider). A part's own `explode` wins as the direction, including the zero
 * vector (= does not move); only when it is undefined does the part move radially away from the center of gravity.
 * The length is scaled by the part's distance from the CG (`explodeScale`).
 */
function explodeDir(part: Part, cg: Vec3): Vec3 {
  const c = part.cgIn ?? partCentroid(part);
  const d: Vec3 = [c[0] - cg[0], c[1] - cg[1], c[2] - cg[2]];
  const n = Math.hypot(...d);
  const k = explodeScale(n);
  if (part.explode !== undefined) return [part.explode[0] * k, part.explode[1] * k, part.explode[2] * k];
  return n < 1e-6 ? [0, 0, k] : [(d[0] / n) * k, (d[1] / n) * k, (d[2] / n) * k];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
