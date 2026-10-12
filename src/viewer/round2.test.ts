/** Phase 3c visual round 2: grain axis, mannequin and crate, flap outline, tread and socket meshes. */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { localBounds } from '../model/bounds';
import { displayGrainAxis } from './grainUv';
import { figureGeometry, figureKindOf, figureMaterial, MANNEQUIN_OPACITY } from './mannequin';
import { socketMesh } from './lights';
import { treadMesh, rawBounds } from './hardware';
import { buildPart } from './partMesh';

beforeAll(() => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => undefined), set: () => true });
  (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
});

const parts = buildModel(defaultParams(), { rider: 'operating', cargo: true, seat: 'stowed' });
const get = (id: string) => parts.find((p) => p.id === id)!;
const sizeOf = (id: string): [number, number, number] => {
  const b = localBounds(get(id).geometry);
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
};

describe('display grain axis', () => {
  it('runs along the long axis: the bulkhead (model says y) and the handle posts (model says z, their thickness) are corrected', () => {
    expect(displayGrainAxis(1, [21.5, 7.2, 1.8], true)).toBe(0);
    expect(displayGrainAxis(2, [1.4, 17.2, 0.9], true)).toBe(1);
    expect(displayGrainAxis(0, [24, 16.4, 0.8], true)).toBe(0); // already right
    expect(displayGrainAxis(2, [0.8, 3.4, 13.5], false)).toBe(2); // a stile keeps its z grain
    expect(displayGrainAxis(1, [10, 9, 1], false)).toBe(1); // near-square: the model's axis is kept
  });
  it('every oak board in the model ends up with grain along (about) its longest axis', () => {
    for (const p of parts) {
      if (p.geometry.type !== 'box' && p.geometry.type !== 'extrusion') continue;
      if (!/oak/i.test(p.material)) continue;
      const s = sizeOf(p.id);
      const planar = p.geometry.type === 'extrusion';
      const dims = planar ? [s[0], s[1], -1] : s;
      const model = p.grain ? ('xyz'.indexOf(p.grain) as 0 | 1 | 2) : undefined;
      const a = displayGrainAxis(model, s, planar);
      expect(dims[a], p.id).toBeGreaterThanOrEqual(Math.max(...dims) * 0.85);
    }
  });
});

describe('rider mannequin and cargo crate', () => {
  it('maps part ids to figures', () => {
    expect(figureKindOf('rider-head')).toBe('head');
    expect(figureKindOf('rider-thigh-L')).toBe('limb');
    expect(figureKindOf('rider-torso')).toBe('block');
    expect(figureKindOf('cargo')).toBe('cargo');
  });
  it('the rider is a dark translucent navy (about 0.55) with no depth write; the cargo is opaque tan', () => {
    const m = figureMaterial('limb') as THREE.MeshStandardMaterial;
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBeCloseTo(MANNEQUIN_OPACITY, 2);
    expect(m.depthWrite).toBe(false);
    expect(m.color.b).toBeGreaterThan(m.color.r);
    const c = figureMaterial('cargo') as THREE.MeshStandardMaterial[];
    expect(c[0].transparent).toBe(false);
    expect(c[0].color.r).toBeGreaterThan(c[0].color.b);
  });
  it('every rider part and the cargo are drawn inside their model boxes', () => {
    const payload = parts.filter((x) => x.payload);
    expect(payload.length).toBeGreaterThan(0);
    for (const p of payload) {
      const built = buildPart(p)!;
      built.geometry.computeBoundingBox();
      const bb = built.geometry.boundingBox!;
      const b = localBounds(p.geometry);
      for (let a = 0; a < 3; a++) {
        expect(bb.min.getComponent(a), `${p.id} min ${a}`).toBeGreaterThanOrEqual(b.min[a] - 0.02);
        expect(bb.max.getComponent(a), `${p.id} max ${a}`).toBeLessThanOrEqual(b.max[a] + 0.02);
      }
    }
  });
  it('a capsule limb keeps the box along its long axis', () => {
    const g = figureGeometry('limb', [2, 2.4, 18], [0, 0, 0]);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.z - g.boundingBox!.min.z).toBeCloseTo(18, 1);
    expect(g.boundingBox!.max.y - g.boundingBox!.min.y).toBeCloseTo(2.4, 1);
    expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeCloseTo(2, 1);
  });
});

describe('brake flap and foot tread', () => {
  it('the foot tread is a few ounces of rubber and its ribbed mesh stays inside its box', () => {
    for (const tag of ['L', 'R']) {
      const t = get(`brake-foot-tread-${tag}`);
      expect(t.massLb).toBeGreaterThan(0.03);
      expect(t.massLb).toBeLessThan(0.25);
      expect(t.finish?.surface).toBe('rubber');
      const s = sizeOf(t.id);
      const [lo, hi] = rawBounds(treadMesh(s));
      for (let a = 0; a < 3; a++) { expect(lo[a]).toBeGreaterThanOrEqual(-s[a] / 2 - 1e-6); expect(hi[a]).toBeLessThanOrEqual(s[a] / 2 + 1e-6); }
    }
  });
  it('the tread sits on the flap top at its foot end', () => {
    const f = get('brake-flap-L'), t = get('brake-foot-tread-L');
    expect(t.transform[12]).toBeLessThan(f.transform[12]); // aft of the flap center
    expect(t.transform[14]).toBeGreaterThan(f.transform[14] - 0.1);
  });
});

describe('aluminum socket', () => {
  it('has a brushed body plus dark rings and bolt heads, all inside the box', () => {
    const s = sizeOf('handle-socket-L');
    const b = socketMesh(s);
    expect(b.materials.length).toBe(2);
    expect((b.materials[1] as THREE.MeshStandardMaterial).color.r).toBeLessThan(0.1);
    expect((b.materials[0] as THREE.MeshStandardMaterial).metalness).toBeGreaterThan(0.7);
    b.geometry.computeBoundingBox();
    for (let a = 0; a < 3; a++) {
      expect(b.geometry.boundingBox!.min.getComponent(a)).toBeGreaterThanOrEqual(-s[a] / 2 - 0.02);
      expect(b.geometry.boundingBox!.max.getComponent(a)).toBeLessThanOrEqual(s[a] / 2 + 0.02);
    }
  });
});
