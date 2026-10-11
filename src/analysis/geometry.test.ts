import { describe, expect, it } from 'vitest';
import { buildLoadModel } from './loads';
import {
  axleLoads, contactsAt, instantCenterY, lateralTip, outerEdgeDistance, RAD, sideEdges, tipAngleDeg, turnGeometry,
  type ContactInputs,
} from './geometry';
import { ackSpec, defaultParams } from '../params';
import { translation } from '../model/mat4';
import type { Part } from '../model/types';
import { rearNormalNoseDown, tipBackAngle } from './stability';

const s3 = (x: number) => Number(x.toPrecision(3));

/** The default Ackermann cart: 44" wheelbase, 35.5" tracks, kingpin 1.25" ahead of the axle, scrub 3", tow lock 35.5 deg inner. */
const P0 = defaultParams();
const ACK = ackSpec(P0);
const G: ContactInputs = { wheelbaseIn: P0.wheelbaseIn, rearTrackIn: P0.rearTrackIn, frontTrackIn: P0.frontTrackIn, ack: ACK };

describe('support polygon with the Ackermann contacts (hand calc)', () => {
  it('straight: contacts under the axles, a CG on the centerline 12" up is 17.75" from each side edge -> atan(17.75/12) = 55.9 deg', () => {
    const c = contactsAt(G, 0);
    expect(c.FL).toEqual([44, 17.75]);
    expect(c.FR).toEqual([44, -17.75]);
    expect(c.kx).toBeCloseTo(45.25, 9);
    const lat = lateralTip(c, [22, 0], 12);
    expect(s3(lat.d)).toBe(17.8);
    expect(s3(lat.deg)).toBe(55.9);
    expect(sideEdges(c, [22, 0])).toHaveLength(2);
  });
  it('tow lock (35.5 deg inner, left turn): the wheel centers come from the 4-bar, (42.49, 16.47) and (45.44, -17.99)', () => {
    const c = contactsAt(G, 35.5 * RAD);
    expect(c.FL[0]).toBeCloseTo(42.49, 2);
    expect(c.FL[1]).toBeCloseTo(16.47, 2);
    expect(c.FR[0]).toBeCloseTo(45.44, 2);
    expect(c.FR[1]).toBeCloseTo(-17.99, 2);
    // Outer edge for a left turn is the right edge RR-FR. By hand: the line through (0, -17.75) and (45.44, -17.99); the distance from (22, 0) is
    // |22 (-0.24) - 17.75 (45.44)| / 45.4406 = 17.87".
    expect(s3(outerEdgeDistance(c, [22, 0], 35.5 * RAD))).toBe(17.9);
    // A right lock is the mirror: the left edge is outer and the distance is the same.
    const m = contactsAt(G, -35.5 * RAD);
    expect(outerEdgeDistance(m, [22, 0], -35.5 * RAD)).toBeCloseTo(outerEdgeDistance(c, [22, 0], 35.5 * RAD), 6);
  });
  it('turning geometry: the mean instant center is 75.6" off the rear axle at the tow lock; the outer front tire center is farther', () => {
    const t = turnGeometry(G, 35.5 * RAD)!;
    expect(t.icY).toBeCloseTo(75.6, 0);
    expect(t.rearCenter).toBeCloseTo(75.6, 0);
    expect(t.outerFront).toBeGreaterThan(t.rearCenter);
    expect(t.innerFront).toBeLessThan(t.rearCenter);
    expect(instantCenterY(G, 0)).toBeNull();
  });
  it('a CG outside the polygon gives a negative distance and angle', () => {
    expect(lateralTip(contactsAt(G, 0), [22, 30], 12).deg).toBeLessThan(0);
  });
  it('static axle loads: W x/x_front to the front', () => {
    const a = axleLoads(300, 16, 48);
    expect(a.front).toBeCloseTo(100, 12);
    expect(a.rear).toBeCloseTo(200, 12);
  });
});

describe('load model hand calc (119 lb cart, 150 lb rider, 25 lb cargo)', () => {
  // Cart 119 lb at (24, 8); rider 150 lb at (16, 20.5); cargo 25 lb at (-2, 13).
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
  const lm = buildLoadModel(p, parts, ACK);
  const c = lm.operating;
  it('reproduces the table CG: W = 294, x = 17.7, h = 14.8', () => {
    expect(c.massLb).toBeCloseTo(294, 9);
    expect(s3(c.cg[0])).toBe(17.7);
    expect(s3(c.cg[2])).toBe(14.8);
    expect(lm.empty.massLb).toBeCloseTo(119, 9);
    expect(lm.goal.massLb).toBeCloseTo(119 + 200 + 25, 9);
  });
  it('straight tip: atan(17.75 / 14.8) = 50.2 deg', () => {
    const [x, y, h] = c.cg;
    expect(s3(lateralTip(contactsAt(G, 0), [x, y], h).deg)).toBe(50.2);
  });
  it('rear-only hold on 15 deg nose-down: mu N_r = 78 lbf against 76 lbf downslope (44" wheelbase hand calc re-done at 48")', () => {
    const [x, , h] = c.cg;
    const th = 15 * RAD;
    const Nr = rearNormalNoseDown(c.massLb, x, h, th, 48);
    expect(Math.round(0.5 * Nr)).toBe(78);
    expect(Math.round(c.massLb * Math.sin(th))).toBe(76);
  });
  it('the CG moves with the steered parts but not when the cart has none', () => {
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
