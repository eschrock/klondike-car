/**
 * The seat-back hinge-insert pads (Eric 2026-10-24, build book review): an oak pad epoxied to the panel's BACK face behind each hinge leaf, so the 0.512 in flush #10-32 insert fits in a
 * blind hole that runs from the front face through the panel into the pad. The pad sits in a relief at the foot of the stop block; the slab boxes of the overlap tests fill that relief, so this
 * file checks the real outline, the deck clearance, the hole depths and the insert margins.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { worldAABB } from './bounds';
import { INSERT_PAD_EDGE_MIN_IN, INSERT_VENEER_MIN_IN, PIN_CLEAR_HOLE_IN, PIN_R_IN, seatBackSupport } from './seat';
import { applySeatStow } from './seat-stow';
import type { Part, Vec2, Vec3 } from './types';

const p = defaultParams();
const L = computeLayout(p);
const parts = buildModel(p);
const get = (id: string) => parts.find((x) => x.id === id)!;
const toModel = (m: number[], a: Vec3): Vec3 => [0, 1, 2].map((k) => m[k] * a[0] + m[4 + k] * a[1] + m[8 + k] * a[2] + m[12 + k]) as Vec3;
const corners = (q: Part): Vec3[] => {
  const s = (q.geometry as { size: Vec3 }).size;
  const out: Vec3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push(toModel(q.transform, [x * s[0] / 2, y * s[1] / 2, z * s[2] / 2]));
  return out;
};
/** Signed distance from a point to a polygon edge set (positive outside, negative inside). */
function polyDist(pt: Vec2, poly: Vec2[]): number {
  let inside = false, d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi, dy = yj - yi, t = Math.max(0, Math.min(1, ((pt[0] - xi) * dx + (pt[1] - yi) * dy) / (dx * dx + dy * dy)));
    d = Math.min(d, Math.hypot(pt[0] - xi - t * dx, pt[1] - yi - t * dy));
  }
  return inside ? -d : d;
}

describe('seat-back insert pads (Eric 2026-10-24)', () => {
  const panel = get('seat-back-panel');
  const plyT = (panel.geometry as { depth: number }).depth;
  it('one oak pad per hinge, on the panel BACK face, grain across, light', () => {
    for (const tag of ['L', 'R']) {
      const pad = get(`seat-back-panel-pad-${tag}`);
      expect(pad.material).toMatch(/oak/);
      expect(pad.grain).toBe('x');
      expect((pad.geometry as { size: Vec3 }).size).toEqual([p.seatBackInsertPadLenIn, expect.closeTo(1, 6), p.seatBackInsertPadThickIn]);
      expect(pad.massLb).toBeLessThan(0.03);
      // the pad's glued (+z) face lies on the panel's back face (panel local z = 0)
      const glued = toModel(pad.transform, [0, 0, p.seatBackInsertPadThickIn / 2]);
      const back = toModel(panel.transform, [glued[1], 0, 0]);
      const n: Vec3 = [panel.transform[8], panel.transform[9], panel.transform[10]];
      expect((glued[0] - back[0]) * n[0] + (glued[2] - back[2]) * n[2]).toBeCloseTo(0, 6);
      expect(pad.joints!.some((j) => j.type === 'glue' && j.to === 'seat-back-panel')).toBe(true);
    }
  });
  it('covers its three inserts with 3/8 in of oak or more to every edge, and the holes leave 1/8 in or more of oak behind', () => {
    for (const tag of ['L', 'R']) {
      const pad = get(`seat-back-panel-pad-${tag}`);
      const s = (pad.geometry as { size: Vec3 }).size;
      const h = pad.joints!.find((j) => j.type === 'hole' && j.to === `seat-hinge-${tag}`)!;
      expect(h.at!.length).toBe(3);
      // the pad's hole points coincide with the panel's insert mouths, seen along the panel normal
      const ins = panel.joints!.find((j) => j.to === `seat-hinge-${tag}`)!.at!.map((a) => toModel(panel.transform, [a[0], a[1], 0]));
      const pts = h.at!.map((a) => toModel(pad.transform, a));
      for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) expect(pts[i][k]).toBeCloseTo(ins[i][k], 6);
      for (const a of h.at!) {
        expect(s[0] / 2 - Math.abs(a[0])).toBeGreaterThanOrEqual(INSERT_PAD_EDGE_MIN_IN - 1e-9);
        expect(s[1] / 2 - Math.abs(a[1])).toBeGreaterThanOrEqual(INSERT_PAD_EDGE_MIN_IN - 1e-9);
      }
    }
    const hole = Math.ceil((p.seatBackInsertLenIn + 1 / 16) * 32) / 32;
    expect(hole).toBeGreaterThan(plyT); // through the panel, into the pad
    expect(plyT + p.seatBackInsertPadThickIn - hole).toBeGreaterThanOrEqual(INSERT_VENEER_MIN_IN);
  });
  it('upright, clears the deck by 1/16 in and the stop block (in its relief) by 1/32 in or more, and stays below the latch-pin hole', () => {
    const sup = seatBackSupport(p, L);
    for (const tag of ['L', 'R']) {
      const pad = get(`seat-back-panel-pad-${tag}`);
      const cs = corners(pad);
      expect(Math.min(...cs.map((c) => c[2])) - L.deckTop).toBeGreaterThanOrEqual(1 / 16 - 1e-6);
      // the stop block is a prism along y: each pad corner (in x, z) is out of its outline, or inside the notch at its front foot with 1/32 in or more to the notch's cuts
      const block = get(`seat-wedge-${tag}`);
      const outline = (block.geometry as { outline: Vec2[] }).outline;
      const relief = block.joints!.find((j) => j.cut?.kind === 'relief' && j.to === `seat-back-panel-pad-${tag}`)!;
      const a = toModel(block.transform, relief.cut!.lo!), b = toModel(block.transform, relief.cut!.hi!);
      const x0 = Math.min(a[0], b[0]), z1 = Math.max(a[2], b[2]);
      expect(Math.min(a[2], b[2])).toBeCloseTo(L.deckTop, 6); // open at the bottom end
      for (const c of cs) {
        const out = polyDist([c[0], c[2]], outline) >= 1 / 32;
        const inNotch = c[0] >= x0 + 1 / 32 && c[2] <= z1 - 1 / 32;
        expect(out || inNotch, JSON.stringify(c)).toBe(true);
      }
      // the notch's level cut is under the upright latch hole (its mouth on the sloped face, 3/8 in across), with 1/4 in or more of oak between
      const mouthZ = L.seat.Pr[2] + L.seat.col2[2] * sup.c2L;
      expect(mouthZ - PIN_R_IN - z1).toBeGreaterThanOrEqual(0.25);
      // the clamping screws are behind the notch's plumb cut
      for (const q of block.joints!.find((j) => j.type === 'screw' && j.to === 'deck')!.at!) expect(toModel(block.transform, q)[0]).toBeLessThan(x0 - 0.25);
      // the pad top is under the 13/32 in pin hole
      const c2 = L.seat.col2, P = L.seat.P, m = pad.transform;
      const top = (m[12] - P[0]) * c2[0] + (m[14] - P[2]) * c2[2] + (pad.geometry as { size: Vec3 }).size[1] / 2; // up the panel from the hinge axis
      expect(sup.c2L - PIN_CLEAR_HOLE_IN / 2).toBeGreaterThan(top);
      expect(pad.joints!.some((j) => j.type === 'pin')).toBe(false);
    }
  });
  it('flips with the panel: flat, the pads are on top at the hinge end, and the flat panel still lies on the deck', () => {
    const flat = buildModel(p);
    applySeatStow(p, L, flat);
    const pnl = flat.find((x) => x.id === 'seat-back-panel')!;
    for (const tag of ['L', 'R']) {
      const pad = flat.find((x) => x.id === `seat-back-panel-pad-${tag}`)!;
      const cs = corners(pad);
      expect(Math.min(...cs.map((c) => c[2]))).toBeCloseTo(L.deckTop + plyT, 6);
      expect(Math.max(...cs.map((c) => c[2]))).toBeCloseTo(L.deckTop + plyT + p.seatBackInsertPadThickIn, 6);
      expect(Math.max(...cs.map((c) => c[0]))).toBeLessThan(L.seat.P[0] + 2);
    }
    expect(worldAABB(pnl).min[2]).toBeCloseTo(L.deckTop, 6);
  });
});
