import { describe, expect, it } from 'vitest';
import { buildLoadModel } from './loads';
import {
  axleLoads, contactsAt, instantCenterY, lateralTip, outerEdgeDistance, RAD, sideEdges, tipAngleDeg, turnGeometry,
  type ContactInputs,
} from './geometry';
import { defaultParams } from '../params';
import { translation } from '../model/mat4';
import type { Part } from '../model/types';
import { rearNormalNoseDown, tipBackAngle } from './stability';

const s3 = (x: number) => Number(x.toPrecision(3));

/** Geometry of the DECISIONS hand-calc table: 48" wheelbase, 35.5" track, no kingpin lead. */
const TABLE: ContactInputs = { wheelbaseIn: 48, rearTrackIn: 35.5, frontTrackIn: 35.5, kingpinLeadIn: 0 };

describe('symmetric support polygon (hand calc)', () => {
  const box: ContactInputs = { wheelbaseIn: 48, rearTrackIn: 36, frontTrackIn: 36, kingpinLeadIn: 0 };
  it('straight: CG on the centerline 12" up is 18" from each side edge → atan(18/12) = 56.3°', () => {
    const lat = lateralTip(contactsAt(box, 0), [24, 0], 12);
    expect(s3(lat.d)).toBe(18);
    expect(s3(lat.deg)).toBe(56.3);
    expect(sideEdges(contactsAt(box, 0), [24, 0])).toHaveLength(2);
  });
  it('is unchanged by the kingpin lead when straight (contacts stay under the axle)', () => {
    const lead = contactsAt({ ...box, kingpinLeadIn: 1 }, 0);
    expect(lead.FL[0]).toBeCloseTo(48, 12);
    expect(lead.FR[1]).toBeCloseTo(-18, 12);
  });
  it('30° lock, no lead: nearest side edge is the left (inner-turn) edge, d = 16.5", tip 53.9°', () => {
    const c = contactsAt(box, 30 * RAD);
    // FL = (48 − 18 sin30, 18 cos30) = (39, 15.59); FR = (57, −15.59)
    expect(c.FL[0]).toBeCloseTo(39, 9);
    expect(c.FR[0]).toBeCloseTo(57, 9);
    const lat = lateralTip(c, [24, 0], 12);
    expect(s3(lat.d)).toBe(16.5);
    expect(s3(lat.deg)).toBe(53.9);
    // Outer edge for a left turn is the right edge RR–FR: 17.0".
    expect(s3(outerEdgeDistance(c, [24, 0], 30 * RAD))).toBe(17);
  });
  it('turning geometry: IC at WB/tanδ, outer front tire at WB/sinδ + T/2', () => {
    const t = turnGeometry(box, 30 * RAD)!;
    expect(s3(t.icY)).toBe(83.1); // 48 / tan 30°
    expect(s3(t.rearCenter)).toBe(83.1);
    expect(s3(t.outerFront)).toBe(114); // 48 / sin 30° + 18
    expect(s3(t.innerFront)).toBe(78); // 96 − 18
  });
  it('a CG outside the polygon gives a negative distance and angle', () => {
    expect(lateralTip(contactsAt(box, 0), [24, 30], 12).deg).toBeLessThan(0);
  });
  it('static axle loads: W·x/x_front to the front', () => {
    const a = axleLoads(300, 16, 48);
    expect(a.front).toBeCloseTo(100, 12);
    expect(a.rear).toBeCloseTo(200, 12);
  });
});

describe('DECISIONS hand-calc table (119 lb cart, 150 lb rider, 40° lock)', () => {
  // Cart 119 lb at (24, 8); rider 150 lb at (16, 20.5); cargo 25 lb at (−2, 13).
  const p = { ...defaultParams(), riderMassLb: 150, cargoMassLb: 25 };
  const mk = (id: string, mass: number, cg: [number, number, number], extra: Partial<Part> = {}): Part => ({
    id, name: id, group: extra.payload ? 'reference' : 'frame', kind: 'lumber', material: 'x', geometry: { type: 'box', size: [1, 1, 1] },
    transform: translation(...cg), body: 'chassis', massLb: mass, cgIn: cg, fab: 'none', step: 1, ...extra,
  });
  const parts = [
    mk('cart', 119, [24, 0, 8]),
    mk('rider-torso', 150, [16, 0, 20.5], { payload: true, body: 'rider' }),
    mk('cargo', 25, [-2, 0, 13], { payload: true, body: 'cargo' }),
  ];
  const lm = buildLoadModel(p, parts, 48);
  const c = lm.operating;
  it('load model reproduces the table CG: W = 294, x = 17.7, h = 14.8', () => {
    expect(c.massLb).toBeCloseTo(294, 9);
    expect(s3(c.cg[0])).toBe(17.7);
    expect(s3(c.cg[2])).toBe(14.8);
    expect(lm.empty.massLb).toBeCloseTo(119, 9);
    expect(lm.goal.massLb).toBeCloseTo(119 + 200 + 25, 9);
  });
  it('straight tip 50.2° (table) and lock tip 46.6° (table)', () => {
    const [x, y, h] = c.cg;
    expect(s3(lateralTip(contactsAt(TABLE, 0), [x, y], h).deg)).toBe(50.2);
    expect(s3(lateralTip(contactsAt(TABLE, 40 * RAD), [x, y], h).deg)).toBe(46.6);
  });
  it('SSF at the outer edge 1.11 and v_roll 9.1 mph (table)', () => {
    const [x, y, h] = c.cg;
    const ct = contactsAt(TABLE, 40 * RAD);
    const ssf = outerEdgeDistance(ct, [x, y], 40 * RAD) / h;
    expect(s3(ssf)).toBe(1.11);
    const ic = instantCenterY(TABLE, 40 * RAD)!;
    const v = Math.sqrt(386.1 * Math.hypot(x, y - ic) * ssf) / 17.6;
    expect(v).toBeGreaterThan(9.05);
    expect(v).toBeLessThan(9.15);
  });
  it('turning radius: 4.8 ft at the rear center, 7.7 ft at the outer front tire', () => {
    const t = turnGeometry(TABLE, 40 * RAD)!;
    expect(t.rearCenter / 12).toBeCloseTo(4.77, 2);
    expect(t.outerFront / 12).toBeCloseTo(7.7, 1);
    expect(Math.abs(t.outerFront - 92.4)).toBeLessThan(1);
  });
  it('rear-only hold on 15° nose-down: μ·N_r = 78 lbf against 76 lbf downslope', () => {
    const [x, , h] = c.cg;
    const th = 15 * RAD;
    const Nr = rearNormalNoseDown(c.massLb, x, h, th, 48);
    expect(Math.round(0.5 * Nr)).toBe(78);
    expect(Math.round(c.massLb * Math.sin(th))).toBe(76);
  });
  it('the CG moves with the steer body (kingpin pivot) but not with no steer mass', () => {
    expect(c.cgAt(0.3)[0]).toBeCloseTo(c.cg[0], 12); // no steer parts in this synthetic cart
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
