import { describe, expect, it } from 'vitest';
import { buildLoadModel } from './loads';
import {
  axleLoads, contactsAt, contactsWorstTip, distToLine, hull, lateralTip, outerEdgeDistance, RAD, sideEdges, steerSweep, tipAngleDeg, worstOuterEdge,
  type ContactInputs,
} from './geometry';
import { defaultParams } from '../params';
import { translation } from '../model/mat4';
import type { Part } from '../model/types';
import { rearNormalNoseDown, tipBackAngle } from './stability';

const s3 = (x: number) => Number(x.toPrecision(3));

/** The default sled with the pivoting front axle (D-56) straight ahead: 44" wheelbase, 35.5" rear and front tracks. */
const P0 = { ...defaultParams(), frontTrackIn: 35.5, rearTrackIn: 35.5, axleHangerThickIn: 0.75, clampPlateWidthIn: 1.5, clampPlateOuterWidthIn: 1.5 }; // the 3c-3 hand-calc fixture (35.5 in tracks; D-58 narrowed them)
const G: ContactInputs = { wheelbaseIn: P0.wheelbaseIn, rearTrackIn: P0.rearTrackIn, frontTrackIn: P0.frontTrackIn };

describe('contact inputs at the defaults', () => {
  it('44 in wheelbase, 35.5 in rear track, 35.5 in front track', () => {
    expect(G).toEqual({ wheelbaseIn: 44, rearTrackIn: 35.5, frontTrackIn: 35.5 });
  });
});

describe('support polygon with the fixed contacts (hand calc)', () => {
  it('contacts are under the axles at x = 0 and x = 44, y = +-17.75; the hull is the 44 x 35.5 rectangle', () => {
    const c = contactsAt(G);
    expect(c.RL).toEqual([0, 17.75]);
    expect(c.RR).toEqual([0, -17.75]);
    expect(c.FL).toEqual([44, 17.75]);
    expect(c.FR).toEqual([44, -17.75]);
    expect(hull(c)).toHaveLength(4);
  });
  it('steer angle (D-56, + = left turn): the front axle turns about the kingpin (44, 0): FL = (44 - 17.75 sin d, 17.75 cos d), FR = (44 + 17.75 sin d, -17.75 cos d); the rear does not move', () => {
    const d = 20 * RAD;
    const c = contactsAt(G, d);
    expect(c.FL[0]).toBeCloseTo(44 - 17.75 * Math.sin(d), 12);
    expect(c.FL[1]).toBeCloseTo(17.75 * Math.cos(d), 12);
    expect(c.FR[0]).toBeCloseTo(44 + 17.75 * Math.sin(d), 12);
    expect(c.FR[1]).toBeCloseTo(-17.75 * Math.cos(d), 12);
    expect(c.FL[0]).toBeCloseTo(37.9289, 3);
    expect(c.FR[1]).toBeCloseTo(-16.6794, 3);
    expect(c.RL).toEqual([0, 17.75]);
    expect(c.RR).toEqual([0, -17.75]);
    // the track between the two front contacts stays 35.5 in at any angle (both wheels stay parallel)
    expect(Math.hypot(c.FL[0] - c.FR[0], c.FL[1] - c.FR[1])).toBeCloseTo(35.5, 12);
    expect(contactsAt(G)).toEqual(contactsAt(G, 0));
    // turning right mirrors the left turn
    const m = contactsAt(G, -d);
    expect(m.FL[0]).toBeCloseTo(c.FR[0], 12);
    expect(m.FL[1]).toBeCloseTo(-c.FR[1], 12);
  });
  it('steerSweep covers -lock..+lock every 2 degrees with both endpoints and zero', () => {
    const sw = steerSweep(20 * RAD);
    expect(sw[0]).toBeCloseTo(-20 * RAD, 12);
    expect(sw[sw.length - 1]).toBeCloseTo(20 * RAD, 12);
    expect(sw.some((a) => Math.abs(a) < 1e-12)).toBe(true);
    expect(sw).toHaveLength(21);
    expect(steerSweep(19 * RAD)).toHaveLength(21); // 0, +-2 .. +-18 and +-19
  });
  it('contactsWorstTip: the smallest tip angle over the steering range; for a CG at (17.5, 0, 14.3) the worst case is full lock and the shorter side edge is the one from the rear tire to the TRAILING front wheel (17.249 in), by hand', () => {
    const lock = 20 * RAD;
    const w = contactsWorstTip(G, [17.5, 0], 14.3, lock);
    expect(Math.abs(w.steer)).toBeCloseTo(lock, 12);
    // steer +20: FL = (37.9289, 16.6794), FR = (50.0711, -16.6794). Left edge (0, 17.75) -> FL: d = |37.9289 (0 - 17.75) - (16.6794 - 17.75)(17.5 - 0)| / hypot(37.9289, 1.0706)
    const dLeft = Math.abs(37.9289 * (0 - 17.75) - (16.6794 - 17.75) * 17.5) / Math.hypot(37.9289, 16.6794 - 17.75);
    // Right edge (0, -17.75) -> FR: d = |50.0711 (0 + 17.75) - (-16.6794 + 17.75)(17.5)| / hypot(50.0711, 1.0706)
    const dRight = Math.abs(50.0711 * 17.75 - (-16.6794 + 17.75) * 17.5) / Math.hypot(50.0711, 17.75 - 16.6794);
    expect(dLeft).toBeCloseTo(17.2492, 3);
    expect(dRight).toBeCloseTo(17.3719, 3);
    expect(w.d).toBeCloseTo(Math.min(dLeft, dRight), 3);
    expect(w.deg).toBeCloseTo((Math.atan2(17.2492, 14.3) * 180) / Math.PI, 2);
    expect(w.deg).toBeLessThan(lateralTip(contactsAt(G), [17.5, 0], 14.3).deg); // straight ahead: atan(17.75 / 14.3) = 51.1 deg
  });
  it('worstOuterEdge: turning left (steer > 0) the outer edge is RR-FR, turning right FL-RL; the worst of the sweep is at full lock', () => {
    const lock = 20 * RAD;
    const o = worstOuterEdge(G, [17.5, 0], lock);
    expect(Math.abs(o.steer)).toBeCloseTo(lock, 12);
    expect(o.d).toBeLessThan(17.75);
    expect(o.d).toBeGreaterThan(17.3);
    expect(['RR-FR', 'FL-RL']).toContain(o.edge);
  });
  it('a CG on the centerline 12 in up is 17.75 in from each side edge -> atan(17.75 / 12) = 55.9 deg', () => {
    const c = contactsAt(G);
    const lat = lateralTip(c, [22, 0], 12);
    expect(s3(lat.d)).toBe(17.8);
    expect(lat.deg).toBeCloseTo((Math.atan2(17.75, 12) * 180) / Math.PI, 9);
    expect(s3(lat.deg)).toBe(55.9);
    expect(sideEdges(c, [22, 0])).toHaveLength(2);
  });
  it('the side edges are parallel to x, so the distance is 17.75 - |y| anywhere along the wheelbase; the CG 3 in left of center shortens the left distance to 14.75', () => {
    const c = contactsAt(G);
    const e = sideEdges(c, [10, 3]).map((x) => Math.round(x.dist * 1e9) / 1e9).sort((a, b) => a - b);
    expect(e).toEqual([14.75, 20.75]);
    expect(lateralTip(c, [30, 3], 12).d).toBeCloseTo(14.75, 9);
    expect(lateralTip(c, [10, 3], 12).d).toBeCloseTo(14.75, 9);
  });
  it('a different front track gives a trapezoid: front track 25 in -> the edge from (0, 17.75) to (44, 12.5) is 17.75 - 5.25 x/44 away at x = 22: d = (44 x 15.25 - ... ) hand value 14.6 in for a CG at (22, 0)', () => {
    const c = contactsAt({ ...G, frontTrackIn: 25 });
    // line through (0, 17.75) and (44, 12.5): direction (44, -5.25), length 44.31; d = |44 (0 - 17.75) + 5.25 x 22| / 44.31 = |-781 + 115.5| / 44.31 = 15.02
    const len = Math.hypot(44, 5.25);
    expect(lateralTip(c, [22, 0], 12).d).toBeCloseTo(Math.abs(44 * -17.75 + 5.25 * 22) / len, 9);
    expect(lateralTip(c, [22, 0], 12).d).toBeCloseTo(15.02, 2);
  });
  it('outer edge in a turn: turning left the right edge RR-FR is outer; for the rectangle it is 17.75 from the centerline either way', () => {
    const c = contactsAt(G);
    expect(outerEdgeDistance(c, [22, 0], 0.3)).toBeCloseTo(17.75, 9);
    expect(outerEdgeDistance(c, [22, 0], -0.3)).toBeCloseTo(17.75, 9);
    expect(distToLine([22, 0], c.RR, c.FR)).toBeCloseTo(17.75, 9);
  });
  it('a CG outside the polygon gives a negative distance and angle', () => {
    expect(lateralTip(contactsAt(G), [22, 30], 12).deg).toBeLessThan(0);
  });
  it('static axle loads: W x/x_front to the front', () => {
    const a = axleLoads(300, 16, 48);
    expect(a.front).toBeCloseTo(100, 12);
    expect(a.rear).toBeCloseTo(200, 12);
  });
});

describe('load model hand calc (119 lb sled, 150 lb rider, 25 lb cargo)', () => {
  // Sled 119 lb at (24, 8); rider 150 lb at (16, 20.5); cargo 25 lb at (-2, 13).
  const p = { ...P0, riderMassLb: 150, cargoMassLb: 25 };
  const mk = (id: string, mass: number, cg: [number, number, number], extra: Partial<Part> = {}): Part => ({
    id, name: id, group: extra.payload ? 'reference' : 'frame', kind: 'lumber', material: 'x', geometry: { type: 'box', size: [1, 1, 1] },
    transform: translation(...cg), body: 'chassis', massLb: mass, cgIn: cg, fab: 'none', step: 1, ...extra,
  });
  const parts = [
    mk('cart', 119, [24, 0, 8]),
    mk('rider-torso', 150, [16, 0, 20.5], { payload: true, body: 'rider' }),
    mk('cargo', 25, [-2, 0, 13], { payload: true, body: 'cargo' }),
  ];
  const lm = buildLoadModel(p, parts);
  const c = lm.operating;
  it('reproduces the table CG: W = 294, x = 17.7, h = 14.8', () => {
    expect(c.massLb).toBeCloseTo(294, 9);
    expect(s3(c.cg[0])).toBe(17.7);
    expect(s3(c.cg[2])).toBe(14.8);
    expect(lm.empty.massLb).toBeCloseTo(119, 9);
    expect(lm.goal.massLb).toBeCloseTo(119 + 200 + 25, 9);
    expect(lm.cargoCases).toEqual([]); // no cargo input -> no cargo case
  });
  it('lateral tip: the CG is 17.75 in from each side edge -> atan(17.75 / 14.8) = 50.2 deg', () => {
    const [x, y, h] = c.cg;
    expect(lateralTip(contactsAt(G), [x, y], h).d).toBeCloseTo(17.75, 9);
    expect(s3(lateralTip(contactsAt(G), [x, y], h).deg)).toBe(50.2);
  });
  it('cargo mode: a 250 lb payload at (30, 2, 22) on the 119 lb stowed sled gives W = 369, CG (28.07, 1.36, 17.49)', () => {
    const stowed = [mk('cart', 119, [24, 0, 8])];
    const p250 = { ...p, cargoPayloadLb: 250 }; // the hand calc keeps 250 lb; the D-58 default is 200 lb
    const cm = buildLoadModel(p250, parts, { stowedParts: stowed, placements: [{ name: 'test', cg: [30, 2, 22] }] });
    expect(cm.cargoCases).toHaveLength(1);
    const k = cm.cargoCases[0];
    expect(k.kind).toBe('cargo');
    expect(k.riderLb).toBe(0);
    expect(k.cargoLb).toBe(p250.cargoPayloadLb);
    expect(k.cargoLb).toBe(250);
    expect(k.massLb).toBeCloseTo(369, 9);
    expect(k.cg[0]).toBeCloseTo((119 * 24 + 250 * 30) / 369, 9);
    expect(s3(k.cg[0])).toBe(28.1);
    expect(s3(k.cg[1])).toBe(1.36);
    expect(s3(k.cg[2])).toBe(17.5);
    expect(k.placement).toBe('test');
  });
  it('rear-only hold on 15 deg nose-down: mu N_r = 78 lbf against 76 lbf downslope (44" wheelbase hand calc re-done at 48")', () => {
    const [x, , h] = c.cg;
    const th = 15 * RAD;
    const Nr = rearNormalNoseDown(c.massLb, x, h, th, 48);
    expect(Math.round(0.5 * Nr)).toBe(78);
    expect(Math.round(c.massLb * Math.sin(th))).toBe(76);
  });
});

describe('tip angle and pull geometry helpers', () => {
  it('tipAngleDeg = atan(d/h)', () => expect(s3(tipAngleDeg(17.75, 15))).toBe(49.8));
  it('tip-back with no pull is atan(x/h)', () => {
    const r = tipBackAngle(300, 17.5, 15, 0, 72, 5, 0.3);
    expect(s3(r.deg)).toBe(49.4);
  });
  it('tip-back with a pull satisfies the moment balance W(x cosθ − h sinθ) = lift moment', () => {
    const W = 300, x = 16, h = 15, T = 150, xp = 72, zp = 5.6, a = 18.7 * RAD;
    const r = tipBackAngle(W, x, h, T, xp, zp, a);
    const th = r.deg * RAD;
    expect(W * (x * Math.cos(th) - h * Math.sin(th))).toBeCloseTo(r.liftMoment, 6);
    expect(r.deg).toBeLessThan(Math.atan2(x, h) / RAD); // the pull lifts the nose, so it tips earlier
    expect(r.liftMoment).toBeCloseTo(T * (xp * Math.sin(a) - zp * Math.cos(a)), 9);
  });
});
