/**
 * Plan-curved walls (D-57) and the 3c-5 fix of their triangulation. The earlier ear-clipping cut a long thin member (a 50 in chine, a rail with a notch) into skinny fans that ran the
 * whole length of the part, so the triangles left the curved face (twisted facets, wrong normals, grain mapped as end grain: the "diagonal band" across the side). The trapezoid
 * decomposition keeps every face triangle within one outline column (at most the subdivision length in x) and on the face.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { buildModel } from './index';
import { outlineArea, planWallGeometry, subdivide, trapezoidTriangles } from './plan-wall';
import type { Part, Vec2 } from './types';

const triArea = (t: Vec2[]) => ((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2;

describe('trapezoidTriangles', () => {
  const cases: Record<string, Vec2[]> = {
    rectangle: [[0, 0], [50, 0], [50, 1.5], [0, 1.5]],
    sloped: [[0, 0], [30, 0], [30, 8], [20, 6.5], [10, 8.5], [0, 14]],
    'notched rail': [[0, 0], [10, 0], [10, 1], [12, 1], [12, 0], [40, 0], [40, 3.5], [0, 3.5]],
    'stepped rail': [[0, 0], [30, 0], [31.5, 1.5], [45, 1.5], [45, 3.5], [0, 3.5]],
  };
  for (const [name, poly] of Object.entries(cases)) {
    it(`${name}: the triangles are counter-clockwise, tile the polygon exactly and are no wider than the subdivision`, () => {
      const o = subdivide(poly, 1.5);
      const tris = trapezoidTriangles(o);
      expect(tris.length).toBeGreaterThan(0);
      let sum = 0;
      for (const t of tris) {
        expect(triArea(t)).toBeGreaterThan(0);
        sum += triArea(t);
        expect(Math.max(...t.map((q) => q[0])) - Math.min(...t.map((q) => q[0]))).toBeLessThanOrEqual(1.5 + 1e-9);
      }
      expect(sum).toBeCloseTo(outlineArea(poly), 6);
    });
  }
});

describe('planWallGeometry', () => {
  const t = 0.625;
  const yc = (x: number) => 12 - 1.25 * Math.max(0, Math.min(1, (x - 35) / 14)) ** 2 * (3 - 2 * Math.max(0, Math.min(1, (x - 35) / 14)));
  const g = planWallGeometry([[-9, 0], [49, 0], [49, 1.5], [-9, 1.5]], t, yc);
  it('is a closed mesh: two faces and a rim, every index valid', () => {
    expect(g.type).toBe('mesh');
    if (g.type !== 'mesh') return;
    const n = g.positions.length / 3;
    for (const i of g.indices!) expect(i).toBeLessThan(n);
    expect(g.indices!.length % 3).toBe(0);
  });
  it('every triangle of the two faces lies on the curved face: its normal follows the face (up to about 13 degrees of tilt in x where the bow taper is steepest), and none spans more than one subdivision in x', () => {
    if (g.type !== 'mesh') return;
    const P = g.positions, I = g.indices!;
    let faces = 0;
    for (let k = 0; k < I.length; k += 3) {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(n[0], n[1], n[2]);
      if (Math.abs(n[1]) / len < 0.5) continue; // the rim
      faces++;
      expect(Math.abs(n[0]) / len, 'normal tilt toward x').toBeLessThan(Math.sin((14 * Math.PI) / 180)); // D-66: the curved face turns up to about 13 degrees (the steepest part of the long bow taper)
      expect(Math.abs(n[2]) / len, 'normal tilt toward z').toBeLessThan(0.02);
      expect(Math.max(P[a], P[b], P[c]) - Math.min(P[a], P[b], P[c])).toBeLessThanOrEqual(1.5 + 1e-6);
    }
    expect(faces).toBeGreaterThan(2 * 38); // 2 faces x about 39 columns x 2 triangles
  });
  it('face area is the outline area on each side (the faces are not folded over)', () => {
    if (g.type !== 'mesh') return;
    const P = g.positions, I = g.indices!;
    let plus = 0, minus = 0;
    for (let k = 0; k < I.length; k += 3) {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      const ay = P[a + 1] - yc(P[a]), by = P[b + 1] - yc(P[b]), cy = P[c + 1] - yc(P[c]);
      const area = Math.abs(((P[b] - P[a]) * (P[c + 2] - P[a + 2]) - (P[c] - P[a]) * (P[b + 2] - P[a + 2])) / 2);
      if (Math.abs(ay - t / 2) < 1e-9 && Math.abs(by - t / 2) < 1e-9 && Math.abs(cy - t / 2) < 1e-9) plus += area;
      if (Math.abs(ay + t / 2) < 1e-9 && Math.abs(by + t / 2) < 1e-9 && Math.abs(cy + t / 2) < 1e-9) minus += area;
    }
    expect(plus).toBeCloseTo(58 * 1.5, 6);
    expect(minus).toBeCloseTo(58 * 1.5, 6);
  });
});

describe('the real side members (chine, gunwale, web) and rails', () => {
  const parts = buildModel(defaultParams());
  const get = (id: string): Part => parts.find((p) => p.id === id)!;
  for (const id of ['side-L-chine', 'side-L-gunwale', 'side-L-web', 'side-R-web', 'rail-L', 'rail-R']) {
    it(`${id}: no face triangle is longer than 1.6 in in x and none tilts away from the curved face`, () => {
      const g = get(id).geometry;
      expect(g.type).toBe('mesh');
      if (g.type !== 'mesh') return;
      const P = g.positions, I = g.indices!;
      let faces = 0;
      for (let k = 0; k < I.length; k += 3) {
        const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
        const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const len = Math.hypot(n[0], n[1], n[2]);
        if (len < 1e-12) continue;
        if (Math.abs(n[1]) / len < 0.5) continue;
        faces++;
        expect(Math.max(P[a], P[b], P[c]) - Math.min(P[a], P[b], P[c]), `${id} triangle ${k / 3}`).toBeLessThanOrEqual(1.6);
        expect(Math.abs(n[0]) / len).toBeLessThan(Math.sin((14 * Math.PI) / 180));
      }
      expect(faces).toBeGreaterThan(40);
    });
  }
});
