/**
 * Joint-point audit (shop-readability round 2, MUST 1): a fastener's `at` points must lie in the part that carries them, so the part drawings never have to say "the model puts N points outside
 * this part". Four cases were off: the brake-knee bolts (the backer carried them at its mid-thickness, 3/8 in inside the rail's inner face), the grab-board screws (the board carried them at its own
 * mid-thickness, 5/16 in inboard of the inner gunwale band), the lid-stay arm-end screws (the stay lies 1/2 in below the lid frame, so the locator put them on the stay) and the return-cord eyes on the transom
 * (the ring stands 11/32 in aft of the transom face). Also the knee-bolt head washers keep real clearance from the knee's face edges.
 */
import { describe, expect, it } from 'vitest';
import { buildModel } from '.';
import { defaultParams } from '../params';
import { makeCtx } from './build-utils';
import { localBounds, worldAABB } from './bounds';
import { brakeGeometry } from './brake-layout';
import { innerHalfWidth } from './layout';
import { localPoint } from './rear-mount';
import { partDrawings } from '../build/part-drawings';
import { runChecks } from '../analysis/index';
import type { Mat4, Part, Vec3 } from './types';

const TOL = 1 / 64 + 1e-9;
const p = defaultParams();
const parts = buildModel(p);
const get = (id: string): Part => parts.find((x) => x.id === id)!;
const ctx = makeCtx(p);
const g = brakeGeometry(ctx.p, ctx.L);
const toWorld = (m: Mat4, v: Vec3): Vec3 => [0, 1, 2].map((k) => m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k]) as Vec3;
/** How far (in) a local point lies outside the part's bounding box (0 when inside). */
const outside = (part: Part, q: Vec3): number => {
  const b = localBounds(part.geometry);
  return Math.max(0, ...[0, 1, 2].map((k) => Math.max(b.min[k] - q[k], q[k] - b.max[k])));
};
/** A joint's points as model coordinates. */
const worldOf = (part: Part, j: { at?: Vec3[] }): Vec3[] => (j.at ?? []).map((a) => toWorld(part.transform, a));
const jointTo = (part: Part, to: string, type?: string) => part.joints!.find((j) => j.to === to && (!type || j.type === type))!;

describe('every point the drawings draw lies in its part', () => {
  it('no part drawing carries a "the model puts N points outside this part" note', () => {
    const bad = partDrawings(parts, p, { includeShaper: true }).filter((s) => /The model puts/.test(s.svg)).map((s) => s.partId);
    expect(bad).toEqual([]);
  });
});

describe('brake-knee bolts: rail and backer', () => {
  for (const [tag, sgn] of [['L', 1], ['R', -1]] as const) {
    it(`${tag}: the rail's hole points, the backer's hole points and the backer's points seen from the rail all lie in the rail's thickness and the backer, on the same four holes`, () => {
      const rail = get(`rail-${tag}`), backer = get(`brake-backer-${tag}`);
      const own = jointTo(rail, `brake-knee-${tag}`, 'hole'), theirs = jointTo(backer, `rail-${tag}`, 'hole');
      expect(own.at).toHaveLength(g.bolts.count);
      expect(theirs.at).toHaveLength(g.bolts.count);
      for (const a of own.at!) expect(outside(rail, a)).toBeLessThanOrEqual(TOL);
      for (const a of theirs.at!) expect(outside(backer, a)).toBeLessThanOrEqual(TOL);
      for (const w of worldOf(backer, theirs)) {
        expect(outside(rail, localPoint(rail.transform, w))).toBeLessThanOrEqual(TOL); // the backer's end of the hole, mapped into the rail
        // in the rail's own thickness (its bounding box is wider than the bar along the bow curve), and on the knee-bolt layout
        expect(sgn * w[1]).toBeGreaterThanOrEqual(g.y.railIn - TOL);
        expect(sgn * w[1]).toBeLessThanOrEqual(g.y.face + TOL);
        expect(g.bolts.xs.some((x) => Math.abs(x - w[0]) < 1e-6)).toBe(true);
        expect(g.bolts.zs.some((z) => Math.abs(z - w[2]) < 1e-6)).toBe(true);
      }
      // and the rail's own points sit on the same holes
      const a = worldOf(rail, own).map((w) => `${w[0].toFixed(4)},${w[2].toFixed(4)}`).sort();
      const b = worldOf(backer, theirs).map((w) => `${w[0].toFixed(4)},${w[2].toFixed(4)}`).sort();
      expect(a).toEqual(b);
    });
  }
});

describe('grab-board screws: board, inner band, outer band and backing strip', () => {
  for (const [tag, sgn] of [['L', 1], ['R', -1]] as const) {
    it(`${tag}: the inner band carries its own end of the six screws inside its thickness; the outer band the strip's six holes inside its`, () => {
      const board = get(`seat-grip-${tag}`), inner = get(`side-${tag}-gunwale-in`), outer = get(`side-${tag}-gunwale`), strip = get(`seat-grip-backing-${tag}`);
      const bj = jointTo(board, inner.id, 'bolt'), ij = jointTo(inner, board.id, 'bolt');
      expect(ij.count).toBe(bj.count); // the screws are still counted once
      expect(ij.at).toHaveLength(bj.count);
      const L = ctx.L;
      for (const w of worldOf(inner, ij)) {
        expect(outside(inner, localPoint(inner.transform, w))).toBeLessThanOrEqual(TOL);
        const y = sgn * w[1], yIn = innerHalfWidth(L, w[0]);
        expect(y).toBeGreaterThanOrEqual(yIn - TOL);
        expect(y).toBeLessThanOrEqual(yIn + L.sideBand + TOL);
      }
      const sj = jointTo(strip, outer.id, 'hole'), oj = jointTo(outer, strip.id, 'hole');
      expect(oj.at).toHaveLength(sj.at!.length);
      for (const w of worldOf(outer, oj)) {
        expect(outside(outer, localPoint(outer.transform, w))).toBeLessThanOrEqual(TOL);
        const y = sgn * w[1], yOut = L.hwC + L.side - L.turnIn(w[0]);
        expect(y).toBeGreaterThanOrEqual(yOut - L.sideBand - TOL);
        expect(y).toBeLessThanOrEqual(yOut + TOL);
      }
      // the same screw lines on the board, the inner band and the strip (x and z)
      const key = (ws: Vec3[]) => ws.map((w) => `${w[0].toFixed(3)},${w[2].toFixed(3)}`).sort();
      expect(key(worldOf(inner, ij))).toEqual(key(worldOf(board, bj)));
      expect(key(worldOf(outer, oj))).toEqual(key(worldOf(strip, sj)));
    });
  }
});

describe('lid-stay arm-end screws land in the left lid frame side (D-89: not on the hinge line)', () => {
  it('the frame side carries its own two points on its inboard face, level with the stay\'s along the side', () => {
    const stay = get('storage-lid-stay'), rim = get('storage-rim-side-L');
    const rj = jointTo(rim, stay.id, 'screw'), sj = jointTo(stay, rim.id, 'screw');
    expect(rj.count).toBe(sj.count);
    expect(rj.at).toHaveLength(2);
    for (const a of rj.at!) expect(outside(rim, a)).toBeLessThanOrEqual(TOL);
    for (const a of sj.at!) expect(outside(stay, a)).toBeLessThanOrEqual(TOL);
    const rw = worldOf(rim, rj), sw = worldOf(stay, sj);
    const rb = worldAABB(rim);
    for (let i = 0; i < 2; i++) {
      expect(rw[i][0]).toBeCloseTo(sw[i][0], 9); // the same station along the side
      expect(rw[i][1]).toBeCloseTo(rb.min[1], 9); // on the frame side's inboard face (the left side is at +y)
      expect(rw[i][2]).toBeGreaterThan(sw[i][2]); // the stay folds flat below the frame (gasket + coaming gap)
    }
  });
});

describe('lid-support arm-end screws keep real wood around each pilot', () => {
  it('every pilot keeps oak above and below it on the frame side\'s inboard face (between its bottom face and the rabbet floor), and stays well in from the ends', () => {
    const stay = get('storage-lid-stay'), rim = get('storage-rim-side-L');
    const b = localBounds(rim.geometry);
    const rabbetFloor = b.max[2] - 0.25;
    for (const a of jointTo(rim, stay.id, 'screw').at!) {
      // across the face (z): the face is only the frame height less the 1/4 in rabbet tall, so the pilot sits centered in it; 11/64 in of oak each side
      // (1/128 in under the 3/16 in wanted at the corners of other parts: noted in the D-89 hand-off)
      expect(Math.min(a[2] - b.min[2], rabbetFloor - a[2]) - 1 / 16, 'z').toBeGreaterThanOrEqual(11 / 64 - 1e-9);
      expect(Math.min(a[0] - b.min[0], b.max[0] - a[0]), 'x').toBeGreaterThanOrEqual(1);
    }
    expect(stay.name).toBe('Lid support');
  });
});

describe('return-cord eyes on the rear transom', () => {
  for (const tag of ['L', 'R']) {
    it(`${tag}: the transom records its own end of the cord eye and the snap hook on its aft face, under the ring`, () => {
      const tr = get('transom-rear'), cord = get(`brake-cord-${tag}`), snap = get(`brake-snap-${tag}`);
      const cj = jointTo(tr, cord.id), sj = jointTo(tr, snap.id);
      expect(jointTo(cord, tr.id).count).toBe(cj.count);
      expect(jointTo(snap, tr.id).count).toBe(sj.count);
      for (const j of [cj, sj]) for (const a of j.at!) expect(outside(tr, a)).toBeLessThanOrEqual(TOL);
      const ring = worldOf(cord, jointTo(cord, tr.id))[0], eye = worldOf(tr, cj)[0];
      expect(eye[1]).toBeCloseTo(ring[1], 9);
      expect(eye[2]).toBeCloseTo(ring[2], 9);
      expect(ring[0] - eye[0]).toBeCloseTo(-0.35, 6); // the ring stands EYE_LIFT_IN aft of the face the eye is screwed into
    });
  }
});

describe('knee-bolt head washers have real clearance', () => {
  it('each washer stands at least 1/16 in inside the knee faces and at least 1/16 in from its neighbor', () => {
    const od = p.brakeMountWasherOdIn, xs = g.bolts.xs;
    expect(od).toBeLessThan(1); // not the 1 in washer, which left 1/32 in at the face
    for (const x of xs) {
      expect(x - od / 2 - g.knee.x0).toBeGreaterThanOrEqual(1 / 16);
      expect(g.knee.x1 - (x + od / 2)).toBeGreaterThanOrEqual(1 / 16);
    }
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1] - od).toBeGreaterThanOrEqual(1 / 16);
    for (let i = 1; i < g.bolts.zs.length; i++) expect(g.bolts.zs[i] - g.bolts.zs[i - 1] - od).toBeGreaterThanOrEqual(1 / 16);
    // the washer still clears the bolt hole and the head
    expect(od).toBeGreaterThan(g.bolts.dia + 1 / 32 + 2 * 0.0625);
  });
  it('the knee joint text and the head-washer bearing row follow the 7/8 in washer', () => {
    expect(get('brake-knee-L').joints!.find((j) => j.type === 'bolt')!.size).toMatch(/7\/8" OD 3\/8 narrow flat washer/);
    const row = runChecks(p, { includeTruck: false }).find((c) => c.id === 'brake-mount')!.details!.find((d) => /head washer bearing/.test(d.name))!;
    expect(row.util).toBeLessThan(0.5);
  });
});
