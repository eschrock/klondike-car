import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Geometry, Part, PartGroup } from '../model/types';

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
  if (part.group === 'reference' || part.kind === 'reference') return 'reference';
  if (part.geometry.type === 'wheel') return 'tire';
  if (part.kind === 'printed') return 'printed';
  const mat = part.material.toLowerCase();
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
      // TODO(Phase 1): sweep a rectangular section along the XZ centreline (bent laminations).
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

export class Viewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
  private readonly controls: OrbitControls;
  private readonly partsGroup = new THREE.Group();
  private readonly canvasHost: HTMLElement;
  private readonly toggleHost: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly hidden = new Set<PartGroup>();
  private framed = false;
  private lastGroups: PartGroup[] = [];

  /** Append a control (e.g. the view-only steer slider) to the toolbar. */
  addToolbarControl(node: HTMLElement): void {
    this.toolbar.append(node);
  }

  constructor(container: HTMLElement) {
    container.classList.add('viewer-host');
    this.canvasHost = el('div', 'viewer-canvas');
    const toolbar = (this.toolbar = el('div', 'viewer-toolbar'));
    this.toggleHost = el('div', 'viewer-toggles');
    container.append(this.canvasHost, toolbar, this.toggleHost);

    for (const name of Object.keys(VIEW_DIRS) as ViewName[]) {
      const b = el('button', '');
      b.type = 'button';
      b.textContent = VIEW_LABELS[name];
      b.addEventListener('click', () => this.setView(name));
      toolbar.append(b);
    }

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvasHost.append(this.renderer.domElement);

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
      requestAnimationFrame(loop);
    };
    loop();
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

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x666a73, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(90, -70, 160);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 10; sc.far = 500;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    this.scene.add(this.partsGroup);
  }

  private applyTheme(): void {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg').trim() || '#e9ecf1';
    this.scene.background = new THREE.Color(bg);
  }

  private resize(): void {
    const w = this.canvasHost.clientWidth || 1;
    const h = this.canvasHost.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Rebuild meshes from the part list; disposes old geometry. Frames the model on first call. */
  update(parts: Part[]): void {
    for (const child of [...this.partsGroup.children]) {
      (child as THREE.Mesh).geometry?.dispose();
      this.partsGroup.remove(child);
    }
    for (const part of parts) {
      const geo = buildGeometry(part.geometry);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, materialFor(part));
      mesh.name = part.id;
      mesh.userData.partId = part.id;
      mesh.userData.group = part.group;
      mesh.castShadow = part.group !== 'reference';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.fromArray(part.transform);
      mesh.matrixWorldNeedsUpdate = true;
      mesh.visible = !this.hidden.has(part.group);
      this.partsGroup.add(mesh);
    }
    this.refreshToggles(parts);
    if (!this.framed && parts.length) {
      this.framed = true;
      this.setView('iso');
    }
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
    for (const m of this.partsGroup.children) if (m.visible) box.expandByObject(m);
    if (box.isEmpty()) box.set(new THREE.Vector3(-10, -24, 0), new THREE.Vector3(60, 24, 30));
    return box;
  }

  setView(name: ViewName, box: THREE.Box3 = this.modelBox()): void {
    const sphere = box.getBoundingSphere(new THREE.Sphere());
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
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
