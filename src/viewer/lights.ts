/**
 * Phase 3c-5: the lamps and reflectors, drawn as the real things instead of boxes. Each builder returns one merged geometry (one group per material, in the order of
 * `materials`) that stays inside the part's bounding box (the model part is only a box; mass, BOM and overlap tests are unchanged).
 *
 *  - Front headlight (`front-light`): a rounded housing (a lathe about the forward axis, a little wider than tall), a chrome bezel ring and a domed warm-white lens that glows faintly
 *    (emissive), on a small rear bracket where it sits on the lamp clip. Faces +x.
 *  - Rear light (`rear-light`): a small dark housing and a red lens with a slight glow, facing -x.
 *  - Side reflectors (`reflector`): a colored housing with a faceted prism face (cube-corner hexagons, drawn on a canvas) and a little clear-coat sheen. Amber at the front, red at
 *    the rear, picked from the part name; the face looks outward.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Part, Vec3 } from '../model/types';
import { roundedBoxMesh, type RawMesh } from './shapes';

export interface LightBuild {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
}

/** Looks that get a custom mesh. */
export type LightKind = 'lamp' | 'taillight' | 'reflector-amber' | 'reflector-red' | 'socket';

/** Which custom mesh (if any) a part gets. */
export function lightKindOf(part: Part): LightKind | null {
  if (part.geometry.type !== 'box') return null;
  if (part.id === 'front-light') return 'lamp';
  if (part.id === 'rear-light') return 'taillight';
  if (part.partNo === 'reflector') return /\bred\b/i.test(part.name) ? 'reflector-red' : 'reflector-amber';
  if (part.partNo === 'handle-socket') return 'socket';
  return null;
}

const rawGeo = (m: RawMesh, at: Vec3 = [0, 0, 0]): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry();
  const pos = m.positions.slice();
  for (let i = 0; i < pos.length; i += 3) { pos[i] += at[0]; pos[i + 1] += at[1]; pos[i + 2] += at[2]; }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(m.indices);
  return g;
};

/** Lathe about local +x (profile points are (radius, position along x)); the cross-section is stretched by `ySquash` across y. */
function latheX(profile: [number, number][], segments: number, yScale = 1): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), segments);
  g.rotateZ(-Math.PI / 2); // lathe axis y -> x
  g.scale(1, yScale, 1);
  g.computeVertexNormals();
  return g;
}

/** One geometry from several; with `groups` each input becomes a group (material index = its position in the list). */
function merge(list: THREE.BufferGeometry[], groups = true): THREE.BufferGeometry {
  const out = mergeGeometries(list, groups);
  for (const g of list) g.dispose();
  if (!out) throw new Error('lights: geometry merge failed');
  return out;
}

const SOLID = { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } as const;

const cache = new Map<string, THREE.Material>();
const textures = new Map<string, THREE.CanvasTexture>();
function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = cache.get(key);
  if (!m) { m = make(); cache.set(key, m); }
  return m;
}

// ── front headlight ──
const lampHousing = () => mat('lamp:housing', () => new THREE.MeshStandardMaterial({ color: 0x24282d, roughness: 0.42, metalness: 0.55, ...SOLID }));
const lampBracket = () => mat('lamp:bracket', () => new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.55, ...SOLID }));
const chrome = () => mat('lamp:chrome', () => new THREE.MeshStandardMaterial({ color: 0xe6e9ee, roughness: 0.1, metalness: 1, ...SOLID }));
/** Lens face: warm white in the middle, a touch more amber toward the rim, with faint concentric lens rings (v runs from the lens center out along the lathe profile). */
function lensTexture(): THREE.CanvasTexture {
  let t = textures.get('lamp');
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 128, 0, 0); // canvas bottom = v 0 = the lens center
  grad.addColorStop(0, '#fffaf0'); grad.addColorStop(0.45, '#ffeec6'); grad.addColorStop(0.8, '#ffd98c'); grad.addColorStop(1, '#e0a850');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  g.fillStyle = 'rgba(160,110,40,0.18)';
  for (const y of [40, 62, 84, 106]) g.fillRect(0, y, 4, 2);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  textures.set('lamp', t);
  return t;
}
const warmLens = () => mat('lamp:lens', () => {
  const tex = lensTexture();
  return new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: tex, emissive: 0xffd48a, emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, ...SOLID });
});

/** `size` is the part's box: x forward (the lens end), y across, z up. */
export function lampMesh(size: Vec3): LightBuild {
  const [L, W, H] = size;
  const hx = L / 2;
  const R = Math.min(H, W) / 2 * 0.96; // housing radius (z); y is stretched to the box width
  const yScale = W / H;
  const bR = R * 1.045; // bezel ring, a hair wider than the housing
  const rearBracket = Math.min(0.32, L * 0.1);
  // Housing: a rounded rear dome, then straight to the bezel.
  const prof: [number, number][] = [];
  const domeFrom = -hx + rearBracket, domeTo = -hx + rearBracket + R * 0.62;
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2);
    prof.push([R * Math.sin(a), domeFrom + (domeTo - domeFrom) * (1 - Math.cos(a))]);
  }
  prof.push([R, hx - L * 0.14]);
  const housing = latheX(prof, 40, yScale);
  // Chrome bezel: a ring around the lens.
  const bz0 = hx - L * 0.17, bz1 = hx - 0.05;
  const bezel = latheX([[bR * 0.78, bz0], [bR, bz0 + 0.02], [bR, bz1 - 0.05], [bR * 0.94, bz1], [bR * 0.76, bz1], [bR * 0.72, bz1 - 0.07], [bR * 0.72, bz0 + 0.04]], 40, yScale);
  // Lens: a shallow dome inside the bezel.
  const lens = latheX([[0, hx], [bR * 0.3, hx - 0.012], [bR * 0.58, hx - 0.045], [bR * 0.72, hx - 0.1], [bR * 0.72, hx - 0.17], [0, hx - 0.17]], 40, yScale);
  // Rear bracket plate (where the clip's lip meets the lamp).
  const bracket = rawGeo(roundedBoxMesh([rearBracket, Math.min(W * 0.55, R * 1.2 * yScale), Math.min(H * 0.5, R)], 0.05, 3), [-hx + rearBracket / 2, 0, 0]);
  return { geometry: merge([housing, bezel, lens, bracket]), materials: [lampHousing(), chrome(), warmLens(), lampBracket()] };
}

// ── rear light ──
const tailHousing = () => mat('tail:housing', () => new THREE.MeshStandardMaterial({ color: 0x26292d, roughness: 0.5, ...SOLID }));
const redLens = () => mat('tail:lens', () => new THREE.MeshPhysicalMaterial({
  color: 0x8c0a10, emissive: 0xe01208, emissiveIntensity: 0.4, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.08, ...SOLID,
}));

/** `size` is the part's box: the lens faces -x. */
export function tailLightMesh(size: Vec3): LightBuild {
  const [L, W, H] = size;
  const lensT = L * 0.4;
  const housingL = L - lensT + Math.min(0.06, lensT * 0.2); // overlaps the lens a hair so no seam shows
  const housing = rawGeo(roundedBoxMesh([housingL, W, H], Math.min(0.16, H * 0.25), 4), [L / 2 - housingL / 2, 0, 0]);
  const lens = rawGeo(roundedBoxMesh([lensT, W * 0.86, H * 0.82], Math.min(0.12, lensT * 0.45), 4), [-L / 2 + lensT / 2, 0, 0]);
  // Two shallow ribs across the lens read as a molded tail-light lens.
  const ribs: THREE.BufferGeometry[] = [];
  for (const z of [-H * 0.14, H * 0.14]) ribs.push(rawGeo(roundedBoxMesh([0.03, W * 0.8, 0.04], 0.012, 2), [-L / 2 + 0.012, 0, z]));
  return { geometry: merge([merge([housing, ...ribs], false), lens]), materials: [tailHousing(), redLens()] };
}

// ── side reflectors ──
const REFLECTOR_COLORS = { amber: [0.95, 0.55, 0.05], red: [0.95, 0.1, 0.12] } as const;

/** Cube-corner prism pattern: hexagons split into three rhombi of different brightness, dark seams, and a diagonal sheen. */
export function reflectorTexture(kind: 'amber' | 'red'): THREE.CanvasTexture {
  const hit = textures.get(kind);
  if (hit) return hit;
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const [r, gr, b] = REFLECTOR_COLORS[kind];
  const shade = (f: number): string => `rgb(${Math.min(255, Math.round(r * f * 255))},${Math.min(255, Math.round(gr * f * 255))},${Math.min(255, Math.round(b * f * 255))})`;
  g.fillStyle = shade(0.4);
  g.fillRect(0, 0, W, H);
  const R = 9, w = Math.sqrt(3) * R;
  const factors = [1.22, 0.82, 0.5];
  for (let row = -1; row * 1.5 * R < H + R; row++) {
    for (let col = -1; col * w < W + w; col++) {
      const cx = col * w + (row & 1 ? w / 2 : 0), cy = row * 1.5 * R;
      const v = Array.from({ length: 6 }, (_, k) => {
        const a = ((-90 + 60 * k) * Math.PI) / 180;
        return [cx + R * Math.cos(a), cy + R * Math.sin(a)] as const;
      });
      for (let k = 0; k < 3; k++) {
        const a = v[(2 * k) % 6], bb = v[(2 * k + 1) % 6], cc = v[(2 * k + 2) % 6];
        g.beginPath();
        g.moveTo(cx, cy); g.lineTo(a[0], a[1]); g.lineTo(bb[0], bb[1]); g.lineTo(cc[0], cc[1]); g.closePath();
        g.fillStyle = shade(factors[k] * (0.92 + 0.16 * (((row * 7 + col * 13) & 3) / 3)));
        g.fill();
        g.strokeStyle = 'rgba(30,8,0,0.45)';
        g.lineWidth = 0.7;
        g.stroke();
      }
    }
  }
  const sheen = g.createLinearGradient(0, 0, W, H);
  sheen.addColorStop(0, 'rgba(255,255,255,0.34)');
  sheen.addColorStop(0.38, 'rgba(255,255,255,0.0)');
  sheen.addColorStop(0.78, 'rgba(255,255,255,0.08)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.0)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textures.set(kind, t);
  return t;
}

// Round 2 (review SHOULD 5): the housing is a light cream-gray satin bezel, so the colored prism face reads as a reflector (a lit rim around a red or amber window) from Iso.
const reflectorBody = (_kind: 'amber' | 'red') => mat('reflector:body', () => new THREE.MeshPhysicalMaterial({
  color: 0xe2dccd, roughness: 0.34, metalness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, ...SOLID,
}));
const reflectorFace = (kind: 'amber' | 'red') => mat(`reflector:face:${kind}`, () => {
  const tex = reflectorTexture(kind);
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: tex, emissive: kind === 'amber' ? 0xff9a10 : 0xff2a30, emissiveMap: tex, emissiveIntensity: 0.45, roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.12, ...SOLID,
  });
});

/** `size` is the part's box (long x, thin y, short z); `outward` is +1 when the face looks toward local +y. */
export function reflectorMesh(size: Vec3, kind: 'amber' | 'red', outward: 1 | -1): LightBuild {
  const [L, T, H] = size;
  const body = rawGeo(roundedBoxMesh([L, T, H], Math.min(0.07, T * 0.3), 4));
  const margin = Math.min(0.08, H * 0.09); // thin cream bezel; the face fills the rest of the part box
  const face = new THREE.PlaneGeometry(L - 2 * margin, H - 2 * margin);
  face.rotateX(-outward * Math.PI / 2); // +z normal -> +y (outward = 1) or -y
  face.translate(0, outward * (T / 2 + 0.004), 0);
  if (!face.getAttribute('normal')) face.computeVertexNormals();
  return { geometry: merge([body, face]), materials: [reflectorBody(kind), reflectorFace(kind)] };
}

// ── aluminum handle socket (3c visual round 2, review SHOULD 7) ──
let brushed: THREE.CanvasTexture | undefined;
/** Fine streaks along the tube (v runs along the length): a brushed-aluminum bump. Drawn with plain fills, so a stub canvas context is enough. */
function brushedBump(): THREE.CanvasTexture {
  if (brushed) return brushed;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 128, 32);
  let a = 12345;
  const rnd = (): number => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  for (let x = 0; x < 128; x++) {
    const v = Math.round(110 + rnd() * 70);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x, 0, 1, 32);
  }
  brushed = new THREE.CanvasTexture(c);
  brushed.wrapS = brushed.wrapT = THREE.RepeatWrapping;
  return brushed;
}
const brushedAlu = () => mat('socket:alu', () => new THREE.MeshStandardMaterial({ color: 0xa4a9b0, roughness: 0.38, metalness: 0.85, bumpMap: brushedBump(), bumpScale: 0.35, ...SOLID }));
const clampSteel = () => mat('socket:steel', () => new THREE.MeshStandardMaterial({ color: 0x25282c, roughness: 0.45, metalness: 0.8, ...SOLID }));

/**
 * `size` is the socket's box: x fore-aft (the transom face is +x), y across, z the tube's length. A brushed tube body, two dark clamp rings near its ends and two dark button-head bolts on
 * the rear face. The rings and heads stand proud of the tube body but stay inside the box (the body is inset by the ring thickness).
 */
export function socketMesh(size: Vec3): LightBuild {
  const [X, Y, Z] = size;
  const inset = Math.min(0.1, X * 0.08);
  const body = rawGeo(roundedBoxMesh([X - inset, Y - 2 * inset * 0.3, Z], Math.min(0.06, X * 0.05), 4), [inset / 2, 0, 0]);
  // brush UVs: u across the section, v along the tube
  const pos = body.getAttribute('position');
  const uv = body.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + pos.getY(i)) * 1.5, pos.getZ(i) * 0.5);
  const dark: THREE.BufferGeometry[] = [];
  const ringH = Math.min(0.22, Z * 0.05);
  for (const z of [-Z / 2 + 0.45, Z / 2 - 0.45]) dark.push(rawGeo(roundedBoxMesh([X, Y, ringH], Math.min(0.05, ringH * 0.4), 3), [0, 0, z]));
  const headR = Math.min(0.2, X * 0.2, Y * 0.14);
  for (const z of [-Z / 2 + 1.2, Z / 2 - 1.2]) {
    const h = new THREE.CylinderGeometry(headR, headR * 1.05, inset * 0.9, 16);
    h.rotateZ(Math.PI / 2); // axis y -> x
    h.translate(-X / 2 + inset * 0.45, 0, z);
    dark.push(h);
  }
  const darkAll = merge(dark.map((g) => { if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2)); return g; }), false);
  return { geometry: merge([body, darkAll]), materials: [brushedAlu(), clampSteel()] };
}
