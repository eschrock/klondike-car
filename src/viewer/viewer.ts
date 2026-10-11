import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { centerOfGravity } from '../model/mass';
import { partCentroid, worldAABB } from '../model/bounds';
import type { Geometry, Mat4, Part, PartGroup, RigidBody, Vec3 } from '../model/types';

type ViewName = 'iso' | 'top' | 'side' | 'front';

const VIEW_DIRS: Record<ViewName, [number, number, number]> = {
  iso: [1, -1.1, 0.75],
  top: [-0.001, 0, 1], // tiny offset avoids the degenerate lookAt with up = +Z
  side: [0, -1, 0.02],
  front: [1, 0, 0.05],
};

const VIEW_LABELS: Record<ViewName, string> = { iso: 'Iso', top: 'Top', side: 'Side', front: 'Front' };

function materialFor(part: Part): THREE.Material {
  const key = materialKey(part);
  let m = materialCache.get(key);
  if (m) return m;
  switch (key) {
    case 'oak': m = new THREE.MeshStandardMaterial({ color: 0xb98a52, roughness: 0.7 }); break;
    case 'ply': m = new THREE.MeshStandardMaterial({ color: 0xdcc08a, roughness: 0.75 }); break;
    case 'metal': m = new THREE.MeshStandardMaterial({ color: 0x8c9199, roughness: 0.35, metalness: 0.8 }); break;
    case 'tire': m = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.9 }); break;
    case 'printed': m = new THREE.MeshStandardMaterial({ color: 0xf26a1b, roughness: 0.5 }); break;
    case 'rope': m = new THREE.MeshStandardMaterial({ color: 0xc9b07a, roughness: 0.95 }); break;
    case 'truck':
      m = new THREE.MeshStandardMaterial({ color: 0x8f9bb0, transparent: true, opacity: 0.35, roughness: 0.7, depthWrite: false });
      break;
    case 'ground':
      m = new THREE.MeshStandardMaterial({ color: 0x7f8a7a, roughness: 1 });
      break;
    case 'reference':
      m = new THREE.MeshStandardMaterial({ color: 0x4d8dff, transparent: true, opacity: 0.25, roughness: 0.6, depthWrite: false });
      break;
    default: m = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.6 });
  }
  m.side = THREE.DoubleSide;
  materialCache.set(key, m);
  return m;
}

const materialCache = new Map<string, THREE.Material>();

function materialKey(part: Part): string {
  if (part.id === 'truck-ground') return 'ground';
  if (part.body === 'truck') return 'truck';
  if (part.group === 'reference' || part.kind === 'reference') return 'reference';
  if (part.geometry.type === 'wheel') return 'tire';
  if (part.kind === 'printed') return 'printed';
  const mat = part.material.toLowerCase();
  if (mat.includes('rope')) return 'rope';
  if (mat.includes('oak')) return 'oak';
  if (mat.includes('ply') || part.kind === 'sheet') return 'ply';
  if (part.kind === 'metal' || part.group === 'hardware' || mat.includes('steel')) return 'metal';
  return 'other';
}

let sweepWarned = false;

function buildGeometry(g: Geometry): THREE.BufferGeometry | null {
  switch (g.type) {
    case 'box':
      return new THREE.BoxGeometry(g.size[0], g.size[1], g.size[2]);
    case 'cylinder': {
      const c = new THREE.CylinderGeometry(g.radius, g.radius, g.length, 32);
      c.rotateX(Math.PI / 2); // Three cylinders run along Y; ours run along Z.
      return c;
    }
    case 'wheel': {
      // Lathe about local Y (the axle): profile points are (radius, axial position).
      const R = g.diameter / 2;
      const hw = g.width / 2;
      const hub = Math.min(g.hubDiameter / 2, R * 0.9);
      const s = Math.min(hw, R - hub) * 0.45; // shoulder radius
      const pts: THREE.Vector2[] = [new THREE.Vector2(hub, -hw), new THREE.Vector2(R - s, -hw)];
      for (let i = 1; i <= 6; i++) {
        const a = (i / 6) * (Math.PI / 2);
        pts.push(new THREE.Vector2(R - s + s * Math.sin(a), -hw + s - s * Math.cos(a)));
      }
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * (Math.PI / 2);
        pts.push(new THREE.Vector2(R - s + s * Math.cos(a), hw - s + s * Math.sin(a)));
      }
      pts.push(new THREE.Vector2(R - s, hw), new THREE.Vector2(hub, hw), new THREE.Vector2(hub, -hw));
      return new THREE.LatheGeometry(pts, 48);
    }
    case 'extrusion': {
      const shape = new THREE.Shape(g.outline.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const h of g.holes ?? []) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
      return new THREE.ExtrudeGeometry(shape, { depth: g.depth, bevelEnabled: false });
    }
    case 'sweep':
      // TODO(Phase 1): sweep a rectangular section along the XZ centerline (bent laminations).
      if (!sweepWarned) {
        sweepWarned = true;
        console.warn('viewer: sweep geometry is not implemented yet; rendering nothing.');
      }
      return null;
    case 'mesh': {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.positions, 3));
      if (g.indices) geo.setIndex(g.indices);
      geo.computeVertexNormals();
      return geo;
    }
  }
}

const HIGHLIGHT_CACHE = new Map<string, THREE.Material>();

function highlightMaterial(base: THREE.Material, key: string, color: string): THREE.Material {
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

interface MeshInfo {
  mesh: THREE.Mesh;
  part: Part;
  dir: Vec3;
  baseMat: THREE.Material;
  key: string;
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

export class Viewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
  private readonly controls: OrbitControls;
  /** Cart meshes. In truck view its matrix is the cart-to-truck transform. */
  private readonly partsGroup = new THREE.Group();
  private readonly truckGroup = new THREE.Group();
  private readonly envObjects: THREE.Object3D[] = [];
  private readonly canvasHost: HTMLElement;
  private readonly toggleHost: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly hidden = new Set<PartGroup>();
  private infos: MeshInfo[] = [];
  private framed = false;
  private lastGroups: PartGroup[] = [];
  private explodeAmount = 0;
  private highlighted = new Set<string>();
  private highlightColor = '#ff3b30';
  private readonly sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  private sectionOut!: HTMLOutputElement;
  private readonly overlay = new THREE.Group();
  private readonly labelRenderer = new CSS2DRenderer();
  private showCg = true;
  private showDims = false;
  private lastParts: Part[] = [];
  // Controls the Simple view hides (the `adv-only` class); kept so simple mode can reset them.
  private explodeInput?: HTMLInputElement;
  private explodeOut?: HTMLOutputElement;
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
  private readonly tmpA = new THREE.Matrix4();
  private readonly tmpB = new THREE.Matrix4();

  /** Append a control (e.g. the view-only steer slider) to the toolbar. */
  addToolbarControl(node: HTMLElement): void {
    this.toolbar.append(node);
  }

  constructor(container: HTMLElement) {
    container.classList.add('viewer-host');
    this.canvasHost = el('div', 'viewer-canvas');
    const toolbar = (this.toolbar = el('div', 'viewer-toolbar'));
    this.toggleHost = el('div', 'viewer-toggles');
    // The controls live in their own bar above the canvas (never overlaying the cart).
    const bar = el('div', 'viewer-bar');
    bar.append(toolbar, this.toggleHost);
    const stage = el('div', 'viewer-stage');
    stage.append(this.canvasHost);
    container.append(bar, stage);

    for (const name of Object.keys(VIEW_DIRS) as ViewName[]) {
      const b = el('button', '');
      b.type = 'button';
      b.textContent = VIEW_LABELS[name];
      b.addEventListener('click', () => this.setView(name));
      toolbar.append(b);
    }
    this.buildExplodeControl();
    this.buildSectionControl();
    this.buildOverlayControls();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvasHost.append(this.renderer.domElement);
    const ld = this.labelRenderer.domElement;
    ld.className = 'viewer-labels';
    this.canvasHost.append(ld);

    // Model frame is Z-up: +X forward, +Y left.
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    this.buildScene();
    this.applyTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());

    new ResizeObserver(() => this.resize()).observe(this.canvasHost);
    this.resize();
    this.setView('iso', new THREE.Box3(new THREE.Vector3(-10, -24, 0), new THREE.Vector3(60, 24, 30)));

    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
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
    const label = el('label', 'steer-ctl adv-only');
    this.explodeInput = r;
    this.explodeOut = out;
    label.title = 'Exploded view: each part moves along its own explode vector (radially from the center of gravity if it has none), farther the farther it is from the CG. The CG marker and dimensions are hidden while exploded';
    label.append('Explode', r, out);
    this.toolbar.append(label);
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
    this.toolbar.append(label);
  }

  private buildOverlayControls(): void {
    const mk = (text: string, title: string, checked: boolean, on: (v: boolean) => void) => {
      const cb = el('input', '');
      cb.type = 'checkbox';
      cb.checked = checked;
      cb.addEventListener('change', () => on(cb.checked));
      const label = el('label', 'steer-ctl adv-only');
      label.title = title;
      label.append(cb, text);
      this.toolbar.append(label);
      return cb;
    };
    this.cgCb = mk('CG', 'Center-of-gravity marker and drop line for what is shown (empty, or with rider and cargo)', true, (v) => {
      this.showCg = v;
      this.rebuildOverlay();
    });
    this.dimsCb = mk('Dimensions', 'Overall length, width and height, wheelbase, track and deck height', false, (v) => {
      this.showDims = v;
      this.rebuildOverlay();
    });
  }

  /** CG marker + drop line and the dimension lines, in the (possibly truck-placed) model frame. */
  private rebuildOverlay(): void {
    for (const c of [...this.overlay.children]) {
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
      const cart = parts.filter((x) => !x.payload && x.group !== 'reference' && !/bridle|rope/i.test(x.id + x.name));
      if (!cart.length) return;
      const bb = worldAABB(cart);
      const [x0, y0, z0] = bb.min;
      const [x1, y1, z1] = bb.max;
      const o = 5; // offset of the dimension lines from the cart
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
      const wheels = cart.filter((x) => x.geometry.type === 'wheel').map((x) => partCentroid(x));
      if (wheels.length >= 2) {
        const xs = wheels.map((c) => c[0]);
        const rearX = Math.min(...xs), frontX = Math.max(...xs);
        const ys = wheels.filter((c) => Math.abs(c[0] - rearX) < 3).map((c) => c[1]);
        const wz = wheels[0][2];
        if (frontX - rearX > 1) dim([rearX, y1 + o + 6, wz], [frontX, y1 + o + 6, wz], `Wheelbase ${f(frontX - rearX)}`);
        if (ys.length >= 2) dim([rearX, Math.min(...ys), 0], [rearX, Math.max(...ys), 0], `Track ${f(Math.max(...ys) - Math.min(...ys))}`);
      }
      const deck = cart.filter((x) => /deck/i.test(x.id));
      if (deck.length) {
        const db = worldAABB(deck);
        const cx = (db.min[0] + db.max[0]) / 2;
        dim([cx, y1 + o, 0], [cx, y1 + o, db.max[2]], `Deck ${f(db.max[2])}`);
      }
      void z0;
    }
  }

  /**
   * Simple view (D-30): the explode, section, CG, dimension and group controls are hidden by CSS (`adv-only`, the
   * `viewer-toggles` bar), so reset what they drive: no explode, no section, no CG marker, no dimensions, every group
   * visible. Leaving simple mode restores the CG / dimension overlays to their checkboxes.
   */
  setSimpleMode(simple: boolean): void {
    if (simple) {
      if (this.explodeInput) this.explodeInput.value = '0';
      if (this.explodeOut) this.explodeOut.textContent = '0"';
      this.setExplode(0);
      if (this.sectionSel) this.sectionSel.value = 'off';
      this.setSection('off', 0);
      this.hidden.clear();
      for (const m of this.partsGroup.children) m.visible = true;
      this.lastGroups = []; // rebuild the (hidden) group checkboxes so they read "shown" again
      this.showCg = false;
      this.showDims = false;
    } else {
      this.showCg = this.cgCb?.checked ?? true;
      this.showDims = this.dimsCb?.checked ?? false;
    }
    this.rebuildOverlay();
    if (simple && this.lastParts.length) this.refreshToggles(this.lastParts);
  }

  /** Exploded distance in inches (part.explode × amount). */
  setExplode(amount: number): void {
    const was = this.explodeAmount > 0;
    this.explodeAmount = amount;
    this.applyMatrices();
    if (was !== amount > 0) this.rebuildOverlay(); // the CG / dimension overlay is hidden while exploded
  }

  setSection(axis: SectionAxis, pos: number): void {
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

  /** Tint the given part ids (cart parts). Pass [] to clear. */
  highlight(ids: string[], color = '#ff3b30'): void {
    this.highlighted = new Set(ids);
    this.highlightColor = color;
    this.applyHighlight();
  }

  private applyHighlight(): void {
    for (const i of this.infos) {
      i.mesh.material = this.highlighted.has(i.part.id) ? highlightMaterial(i.baseMat, i.key, this.highlightColor) : i.baseMat;
    }
  }

  private applyMatrices(): void {
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
    gm.opacity = 0.35;
    this.scene.add(grid);

    const axes = new THREE.AxesHelper(24); // X red, Y green, Z blue
    this.scene.add(axes);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.ShadowMaterial({ opacity: 0.25 }));
    ground.position.z = -0.05;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.envObjects.push(grid, axes, ground);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x666a73, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(90, -70, 160);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 10; sc.far = 500;
    sun.shadow.bias = -0.0005;
    this.sun = sun;
    this.scene.add(sun, sun.target);

    this.partsGroup.matrixAutoUpdate = false;
    this.overlay.matrixAutoUpdate = false;
    this.truckGroup.visible = false;
    this.simGroup.matrixAutoUpdate = false;
    this.simGroup.visible = false;
    this.scene.add(this.partsGroup, this.truckGroup, this.overlay, this.simGroup);
  }

  private applyTheme(): void {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg').trim() || '#e9ecf1';
    this.scene.background = new THREE.Color(bg);
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
  }

  private clearGroup(g: THREE.Group): void {
    for (const child of [...g.children]) {
      (child as THREE.Mesh).geometry?.dispose();
      g.remove(child);
    }
  }

  /** Rebuild meshes from the part list; disposes old geometry. Frames the model on first call. */
  update(parts: Part[]): void {
    this.clearGroup(this.partsGroup);
    this.infos = [];
    const cg = centerOfGravity(parts);
    for (const part of parts) {
      const geo = buildGeometry(part.geometry);
      if (!geo) continue;
      const key = materialKey(part);
      const baseMat = materialFor(part);
      const mesh = new THREE.Mesh(geo, baseMat);
      mesh.name = part.id;
      mesh.userData.partId = part.id;
      mesh.userData.group = part.group;
      mesh.castShadow = part.group !== 'reference';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.visible = !this.hidden.has(part.group);
      this.partsGroup.add(mesh);
      this.infos.push({ mesh, part, dir: explodeDir(part, cg), baseMat, key });
    }
    this.applyMatrices();
    this.applyHighlight();
    this.refreshToggles(parts);
    this.lastParts = parts;
    this.rebuildOverlay();
    if (!this.framed && parts.length) {
      this.framed = true;
      // Wait a frame so the canvas has its laid-out size (aspect) before framing.
      requestAnimationFrame(() => this.setView('iso'));
    }
  }

  /**
   * Truck view: show the bed parts (TRUCK frame) and place the cart with `cartTransform` (cart frame -> truck
   * frame). `frameKey` re-frames the camera when it changes. Pass null to return to the normal view.
   */
  setTruck(bed: Part[] | null, cartTransform?: Mat4, frameKey = ''): void {
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
      const geo = buildGeometry(part.geometry);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, materialFor(part));
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
    this.bodyPoses = poses;
    this.applyMatrices();
  }

  /**
   * Show (or, with null, remove) the simulation ground and obstacles. While shown, the static grid, axes, shadow plane
   * and the CG / dimension overlay are hidden; the shapes live in the ground frame set by `setSimGroundPose`.
   */
  setSimEnvironment(shapes: SimSceneShape[] | null): void {
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
      this.sun.position.set(90, -70, 160);
      this.sun.target.position.set(0, 0, 0);
      this.sun.target.updateMatrixWorld();
      return;
    }
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
   * Orientation of the sim ground (a column-major 4x4 about the origin, inches). `focus` is the cart's world position:
   * the grid is re-centerd under it (snapped to its 48" cells) and the sun's shadow box follows it.
   */
  setSimGroundPose(pose: Mat4, focus?: Vec3): void {
    this.simGroup.matrix.fromArray(pose);
    this.simGroup.matrixWorldNeedsUpdate = true;
    if (focus && this.simGrid) {
      const local = new THREE.Vector3(...focus).applyMatrix4(this.tmpA.fromArray(pose).invert());
      this.simGrid.position.x = Math.round(local.x / 48) * 48;
      this.simGrid.position.y = Math.round(local.y / 48) * 48;
    }
  }

  /**
   * Keep the orbit camera on a moving point (e.g. the cart in the sim) while leaving the user's view angle alone.
   * `snap` first jumps the orbit target onto the point (a new run).
   */
  followPoint(p: Vec3 | null, snap = false): void {
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
    this.sun.position.set(p[0] + 90, p[1] - 70, p[2] + 160);
    this.sun.target.position.set(p[0], p[1], 0);
    this.sun.target.updateMatrixWorld();
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
        for (const m of this.partsGroup.children) m.visible = !this.hidden.has(m.userData.group as PartGroup);
      });
      label.append(cb, document.createTextNode(' ' + g));
      this.toggleHost.append(label);
    }
  }

  private modelBox(): THREE.Box3 {
    const box = new THREE.Box3();
    this.scene.updateMatrixWorld(true);
    for (const m of this.partsGroup.children) if (m.visible) box.expandByObject(m);
    if (box.isEmpty()) box.set(new THREE.Vector3(-10, -24, 0), new THREE.Vector3(60, 24, 30));
    return box;
  }

  setView(name: ViewName, box?: THREE.Box3): void {
    const b = box ?? (this.inTruck ? this.truckBox() : this.modelBox());
    const sphere = b.getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3(...VIEW_DIRS[name]).normalize();
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = this.camera.aspect;
    const hfov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    const dist = (sphere.radius / Math.sin(Math.min(fov, hfov) / 2)) * 1.05;
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(sphere.center);
    this.controls.update();
  }

  /** Bed (without the big ground plane) plus the cart. */
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
