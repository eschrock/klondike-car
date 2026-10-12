import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { signOvalGeometry } from './partMesh';
import { signOutline } from './textures';

/** Signed volume of a non-indexed triangle soup (positive when the faces wind outward). */
function volume(g: THREE.BufferGeometry): number {
  const g2 = g.index ? g.toNonIndexed() : g;
  const a = g2.getAttribute('position').array;
  let v = 0;
  for (let i = 0; i < a.length; i += 9) {
    const [x0, y0, z0, x1, y1, z1, x2, y2, z2] = [a[i], a[i + 1], a[i + 2], a[i + 3], a[i + 4], a[i + 5], a[i + 6], a[i + 7], a[i + 8]];
    v += (x0 * (y1 * z2 - z1 * y2) - y0 * (x1 * z2 - z1 * x2) + z0 * (x1 * y2 - y1 * x2)) / 6;
  }
  return v;
}

describe('sign drawn as a rounded-oval plank (Sign v2)', () => {
  it('outline is a closed superellipse spanning the blank', () => {
    const o = signOutline(20, 6);
    const xs = o.map((p) => p[0]), ys = o.map((p) => p[1]);
    expect(Math.max(...xs)).toBeCloseTo(10, 6);
    expect(Math.min(...ys)).toBeCloseTo(-3, 6);
  });

  it('rounded-rectangle outline spans the blank, stays inside it and is counter-clockwise', () => {
    for (const [w, h] of [[24, 6], [12, 6], [8, 8]] as const) {
      const o = signOutline(w, h, 120, 'rounded');
      expect(Math.max(...o.map((p) => p[0]))).toBeCloseTo(w / 2, 6);
      expect(Math.min(...o.map((p) => p[1]))).toBeCloseTo(-h / 2, 6);
      let area = 0;
      o.forEach((p, i) => { const q = o[(i + 1) % o.length]; area += p[0] * q[1] - q[0] * p[1]; });
      expect(area).toBeGreaterThan(0);
      expect(area / 2).toBeLessThan(w * h);
    }
  });

  it('rounded-rectangle board fits the blank and winds outward', () => {
    const { geometry } = signOvalGeometry([24, 0.236, 6], 1, 0, 2, [0, 0, 0], 'rounded');
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.x).toBeCloseTo(12, 3);
    expect(volume(geometry)).toBeGreaterThan(0);
  });

  // The blank may be thin along any local axis; every permutation must stay inside the box and wind outward.
  const cases: [string, [number, number, number], 0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2][] = [
    ['thin Y', [20, 0.236, 6], 1, 0, 2],
    ['thin Z', [20, 6, 0.236], 2, 0, 1],
    ['thin X', [0.236, 20, 6], 0, 1, 2],
  ];
  for (const [name, size, thin, ua, va] of cases) {
    it(`fits the blank bounds and winds outward (${name})`, () => {
      const { geometry, edges } = signOvalGeometry(size, thin, ua, va, [0, 0, 0]);
      geometry.computeBoundingBox();
      const b = geometry.boundingBox!;
      const mx = [b.max.x, b.max.y, b.max.z], mn = [b.min.x, b.min.y, b.min.z];
      for (let a = 0; a < 3; a++) {
        expect(mx[a]).toBeLessThanOrEqual(size[a] / 2 + 1e-4);
        expect(mn[a]).toBeGreaterThanOrEqual(-size[a] / 2 - 1e-4);
      }
      expect(mx[ua] - mn[ua]).toBeCloseTo(size[ua], 3);
      expect(mx[thin] - mn[thin]).toBeCloseTo(size[thin], 3);
      expect(volume(geometry)).toBeGreaterThan(0);
      expect(edges.getAttribute('position').count % 2).toBe(0);
    });
  }
});
