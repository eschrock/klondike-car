import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildModel } from '../model/index';
import { defaultParams } from '../params';
import { localBounds } from '../model/bounds';
import type { Geometry } from '../model/types';
import { bevelledExtrusion, clampRound } from './partMesh';
import { buildWheelGeometry } from './wheel';

function bbox(g: THREE.BufferGeometry): { min: number[]; max: number[] } {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
}

describe('roundover keeps the model dimensions exact (D-44)', () => {
  const parts = buildModel(defaultParams());
  const ext = parts.filter((p) => p.geometry.type === 'extrusion');

  it('bevelledExtrusion stays inside the plain extrusion bounds for every extrusion in the model', () => {
    expect(ext.length).toBeGreaterThan(0);
    for (const p of ext) {
      const g = p.geometry as Extract<Geometry, { type: 'extrusion' }>;
      const lb = localBounds(g);
      const geo = bevelledExtrusion(g, 0.12);
      const b = bbox(geo);
      for (let a = 0; a < 3; a++) {
        expect(b.min[a], `${p.id} min ${a}`).toBeGreaterThanOrEqual(lb.min[a] - 1e-4);
        expect(b.max[a], `${p.id} max ${a}`).toBeLessThanOrEqual(lb.max[a] + 1e-4);
      }
      // ...and reaches the bounds (the roundover is cut from the face, the outline is not shrunk).
      expect(b.max[2] - b.min[2], p.id).toBeCloseTo(g.depth, 4);
      for (const v of geo.getAttribute('position').array) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('clamps the roundover to under half the thinnest dimension', () => {
    expect(clampRound(1, [10, 10, 0.5])).toBeCloseTo(0.245, 6);
    expect(clampRound(0.1, [10, 10, 5])).toBe(0.1);
  });

  it('wheel geometry matches localBounds and has six material groups', () => {
    const w = parts.find((p) => p.geometry.type === 'wheel')!;
    const g = w.geometry as Extract<Geometry, { type: 'wheel' }>;
    for (const tread of ['lug', 'rib'] as const) {
      const geo = buildWheelGeometry(g, tread);
      const b = bbox(geo);
      const lb = localBounds(g);
      for (let a = 0; a < 3; a++) {
        expect(b.max[a]).toBeLessThanOrEqual(lb.max[a] + 1e-3);
        expect(b.min[a]).toBeGreaterThanOrEqual(lb.min[a] - 1e-3);
      }
      expect(b.max[0]).toBeGreaterThan(lb.max[0] - 0.2); // tread / lug tips reach the diameter
      expect(geo.groups.map((x) => x.materialIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });
});

describe('the grab board screw heads (D-84)', () => {
  it('the backing strip draws its screw heads on the outboard face, 0.14 in proud, inside the cap holes', async () => {
    const { buildModel } = await import('../model');
    const { defaultParams } = await import('../params');
    const { buildPart, BUTTON_HEAD_H_IN } = await import('./partMesh');
    const parts = buildModel(defaultParams());
    for (const tag of ['L', 'R']) {
      const strip = parts.find((q) => q.id === `seat-grip-backing-${tag}`)!;
      const built = buildPart(strip)!;
      built.geometry.computeBoundingBox();
      const bb = built.geometry.boundingBox!;
      const depth = (strip.geometry as { depth: number }).depth;
      const out = tag === 'L' ? -bb.min.z : bb.max.z - depth; // local z=0 is the outboard face on the left, z=depth on the right
      expect(out).toBeCloseTo(BUTTON_HEAD_H_IN, 3);
      expect(built.geometry.getAttribute('position').count).toBeGreaterThan(5 * 20 * 3);
      expect(BUTTON_HEAD_H_IN + depth).toBeLessThan(0.375); // under the cap face
    }
  });
});
