/**
 * Stability rows for the pivoting-front-axle cart (D-56): tip-straight (worst over the steering range), tip-lock, slide-before-tip, v-rollover, turn-radius (pass/fail against the
 * relaxed A-2 limit), pitch-fwd and pitch-rear. Every number is re-derived by hand from the params and the load cases (mass and CG come from `ctx.loads`; the contact geometry is
 * written out literally):
 *
 *   rear contacts (0, +-17.75)                    (rear track 35.5 in)
 *   front contacts, axle straight (44, +-17.75)   (front track 35.5 in, on the kingpin line x = wheelbase = 44 in)
 *   front contacts at steer d (+ = left turn):    FL = (44 - 17.75 sin d, 17.75 cos d), FR = (44 + 17.75 sin d, -17.75 cos d)
 *
 * so the support polygon is a rectangle straight ahead and a parallelogram-like quadrilateral at lock; the side edge from the rear tire (0, a) to the front contact (xf, b) is
 * d = |xf (y - a) - (b - a) x| / hypot(xf, b - a) from a CG at (x, y).
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext, type Ctx } from './context';
import { runChecks, type AnalysisCheck } from './index';
import { contactsAt, contactsWorstTip } from './geometry';
import { liftPull, pitchForward, pullPoint, rearNormalNoseDown, slideBeforeTip, tipBackAngle, tipLock, tipStraight, turnRadius } from './stability';
import { cornerWeightLb } from './bump';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const defaults = defaultParams();
const mkCtx = (q: Partial<Params> = {}): Ctx => {
  const p = resolveParams({ ...defaults, ...q } as Params);
  return makeContext(p, buildModel(p, { rider: 'goal', cargo: true }), buildModel(p, { rider: 'none', cargo: false, seat: 'stowed' }));
};
const ctx = mkCtx();
const cs = runChecks(defaults, { includeTruck: false });
const byId = (id: string): AnalysisCheck => cs.find((c) => c.id === id)!;

/** Distance from a CG at (x, y) to the side edge through the rear tire (0, a) and the front contact (xf, b): |xf (y - a) - (b - a) x| / hypot(xf, b - a). */
const edgeD = (x: number, y: number, a: number, xf: number, b: number) => Math.abs(xf * (y - a) - (b - a) * x) / Math.hypot(xf, b - a);
/** Nearest side edge for the axle turned by `deg` degrees (+ = left): the left edge (a = 17.75) and the right edge (a = -17.75). */
const dSide = (cg: number[], deg: number) => {
  const s = deg * RAD;
  return Math.min(
    edgeD(cg[0], cg[1], 17.75, 44 - 17.75 * Math.sin(s), 17.75 * Math.cos(s)),
    edgeD(cg[0], cg[1], -17.75, 44 + 17.75 * Math.sin(s), -17.75 * Math.cos(s)),
  );
};
const tipDeg = (cg: number[], deg: number) => Math.atan2(dSide(cg, deg), cg[2]) * DEG;
const worstTip = (cg: number[]) => {
  let w = Infinity;
  for (let a = -20; a <= 20; a += 1) w = Math.min(w, tipDeg(cg, a));
  return w;
};

describe('the contact inputs the context passes on', () => {
  it('44 in wheelbase, 35.5 in rear and front tracks', () => {
    expect(ctx.contact).toEqual({ wheelbaseIn: 44, rearTrackIn: 35.5, frontTrackIn: 35.5 });
  });
  it('straight and full-lock contacts (the whole axle turns about the kingpin)', () => {
    const s = contactsAt(ctx.contact, 0);
    expect([s.FL[0], s.FL[1], s.FR[0], s.FR[1]].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([44, 17.75, 44, -17.75]);
    const l = contactsAt(ctx.contact, 20 * RAD);
    expect(l.FL[0]).toBeCloseTo(44 - 17.75 * Math.sin(20 * RAD), 9);
    expect(l.FL[0]).toBeCloseTo(37.929, 3);
    expect(l.FR[0]).toBeCloseTo(50.071, 3);
    expect(l.FL[1]).toBeCloseTo(16.6795, 3);
    expect(l.FR[1]).toBeCloseTo(-16.6795, 3);
    const w = contactsWorstTip(ctx.contact, [17, 0], 14.3, 20 * RAD);
    expect(Math.abs(w.steer)).toBeCloseTo(20 * RAD, 9);
  });
});

describe('tip-straight (worst steer) and tip-lock (D-56)', () => {
  const kinds = [['operating', ctx.loads.operating], ['goal', ctx.loads.goal]] as const;
  for (const [name, c] of kinds) {
    it(`${name} rider: tip = atan(d / h) with d to the nearer side edge, the worst of -20..+20 degrees steer (it is at full lock); tip-lock is the same at +-20 degrees`, () => {
      expect(byId('tip-straight').cases![name]!.value).toBeCloseTo(worstTip(c.cg), 6);
      expect(byId('tip-lock').cases![name]!.value).toBeCloseTo(Math.min(tipDeg(c.cg, 20), tipDeg(c.cg, -20)), 6);
      expect(byId('tip-straight').cases![name]!.value).toBeLessThan(tipDeg(c.cg, 0) + 1e-9); // turning the axle always shortens the nearer side edge
      expect(byId('tip-straight').cases![name]!.limit).toBe(40);
      expect(byId('tip-lock').cases![name]!.limit).toBe(35);
    });
  }
  it('the CG height is 14.3 in (operating) and 15.0 in (goal): the deck is only 8 in up, so the goal rider tips earlier but both pass the 40 degree limit by a wide margin', () => {
    expect(Math.abs(ctx.loads.operating.cg[2] - 14.3)).toBeLessThan(0.5);
    expect(Math.abs(ctx.loads.goal.cg[2] - 15.0)).toBeLessThan(0.5);
    expect(byId('tip-straight').cases!.goal!.value).toBeLessThan(byId('tip-straight').cases!.operating!.value);
    expect(byId('tip-straight').load).toBe('operating');
    expect(byId('tip-lock').load).toBe('operating');
    for (const id of ['tip-straight', 'tip-lock']) expect(byId(id).status).toBe('pass');
    expect(byId('tip-straight').cases!.operating!.value).toBeCloseTo(50.3, 0);
    expect(byId('tip-straight').cases!.goal!.value).toBeCloseTo(48.9, 0);
  });
  it('the cargo case is the worse of its two placements: the payload piled at the nose end of the full-width bed (x about 31 in, 16.2 in up, 1.95 in left) tips at 42.6 degrees: marginal against the 40 degree limit, but it never moves the rider status', () => {
    const [aft, fore] = ctx.loads.cargoCases;
    expect(worstTip(fore.cg)).toBeLessThan(worstTip(aft.cg));
    expect(byId('tip-straight').cases!.cargo!.value).toBeCloseTo(Math.min(worstTip(aft.cg), worstTip(fore.cg)), 6);
    expect(byId('tip-straight').cases!.cargo!.value).toBeCloseTo(42.6, 0);
    expect(byId('tip-straight').statusCargo).toBe('marginal');
    expect(byId('tip-straight').how).toMatch(/fore, at the nose end/); // the cargo line names the governing placement
    expect(byId('tip-straight').statusGoal).toBe('pass');
  });
  it('a CG exactly over the centerline: d is symmetric; moving the CG 3 in left shortens the left edge distance by 3 cos(atan(0 / 44)) = 3 in with the axle straight', () => {
    expect(edgeD(20, 0, 17.75, 44, 17.75)).toBeCloseTo(17.75, 12);
    expect(edgeD(20, 3, 17.75, 44, 17.75)).toBeCloseTo(14.75, 12);
  });
  it('the rows read the params: a wider front track, a wider rear track and a lower deck all raise the tip angle; the tip limits are the locked 40 / 35 deg params', () => {
    const v = (q: Partial<Params>, id = 'tip-straight') => runChecks({ ...defaults, ...q }, { includeTruck: false }).find((c) => c.id === id)!.cases!.operating!.value;
    const base = v({});
    expect(v({ frontTrackIn: 40 })).toBeGreaterThan(base);
    expect(v({ rearTrackIn: 40 })).toBeGreaterThan(base);
    expect(v({ deckHeightIn: 7.5 })).toBeGreaterThan(base);
    expect(v({ steerLockDeg: 30 })).toBeLessThan(base); // more lock, a shorter side edge
    expect(defaults.tipStraightMinDeg).toBe(40);
    expect(defaults.tipLockMinDeg).toBe(35);
  });
  it('the dual-check wrappers carry the steering text', () => {
    expect(tipStraight(ctx).how).toMatch(/front axle turns about the kingpin/);
    expect(tipStraight(ctx).label).toBe('Lateral tip (worst steer, +/- lock)');
    expect(tipLock(ctx).how).toMatch(/both wheels parallel/);
  });
});

describe('slide-before-tip (A-1)', () => {
  it('SSF = d_outer / h with the outer edge at +20 (turning left, RR-FR) or -20 (FL-RL): the goal rider 1.21 / 14.3; required 1.5 x mu 0.5 = 0.75', () => {
    for (const [name, c] of [['operating', ctx.loads.operating], ['goal', ctx.loads.goal]] as const) {
      const r = byId('slide-before-tip').cases![name]!;
      // outer edge in a left turn: RR (0, -17.75) to FR (44 + 17.75 sin20, -17.75 cos20); in a right turn FL-RL, mirrored
      const s = 20 * RAD;
      const dR = edgeD(c.cg[0], c.cg[1], -17.75, 44 + 17.75 * Math.sin(s), -17.75 * Math.cos(s));
      const dL = edgeD(c.cg[0], c.cg[1], 17.75, 44 + 17.75 * Math.sin(s), 17.75 * Math.cos(s)); // the right turn (-20): FL is at (44 + 17.75 sin20, 17.75 cos20)
      // turning left (+20) the right edge is outer, turning right (-20) the left edge: the sweep has both ends, so the worst is the smaller
      expect(r.value).toBeCloseTo(Math.min(dR, dL) / c.cg[2], 3);
      expect(r.limit).toBeCloseTo(1.5 * 0.5, 9);
    }
    expect(byId('slide-before-tip').cases!.operating!.value).toBeCloseTo(1.21, 1);
    expect(slideBeforeTip(ctx).cases!.operating!.limit).toBeCloseTo(0.75, 9);
  });
  it('passes at the defaults (1.21 vs 0.75), also for the cargo case; the limit tracks the ground: a sticky mu 1.0 surface needs 1.5 and the operating rider fails', () => {
    expect(byId('slide-before-tip').status).toBe('pass');
    expect(byId('slide-before-tip').statusCargo).toBe('pass');
    const c = runChecks({ ...defaults, tireGroundMu: 1.0 }, { includeTruck: false }).find((x) => x.id === 'slide-before-tip')!;
    expect(c.cases!.operating!.limit).toBeCloseTo(1.5, 9);
    expect(c.cases!.operating!.status).toBe('fail');
  });
});

describe('v-rollover (A-1, info)', () => {
  it('v = sqrt(g r SSF): the turn center is on the rear axle line WB / tan(20 deg) = 120.9 in to the side; r_cg = hypot(x, y - 120.9); at the operating rider SSF 1.21 and r = 122 in: 13.6 mph, 2.3x a 6 mph jog', () => {
    const c = ctx.loads.operating;
    const s = 20 * RAD;
    const ssf = Math.min(
      edgeD(c.cg[0], c.cg[1], -17.75, 44 + 17.75 * Math.sin(s), -17.75 * Math.cos(s)),
      edgeD(c.cg[0], c.cg[1], 17.75, 44 + 17.75 * Math.sin(s), 17.75 * Math.cos(s)),
    ) / c.cg[2];
    const R0 = 44 / Math.tan(s);
    expect(R0).toBeCloseTo(120.89, 2);
    const rCg = Math.hypot(c.cg[0], c.cg[1] - R0); // the sign of the turn does not matter for a CG this close to the centerline
    const v = Math.sqrt(386.1 * rCg * ssf) / 17.6;
    const r = byId('v-rollover').cases!.operating!;
    expect(r.value).toBeCloseTo(v, 1);
    expect(v).toBeCloseTo(13.6, 0);
    expect(r.limit).toBeCloseTo(defaults.rolloverSpeedFactor * defaults.jogSpeedMph, 9);
    expect(r.status).toBe('info');
    expect(byId('v-rollover').status).toBe('info');
    expect(byId('v-rollover').how).toMatch(/At 2× r/);
  });
});

describe('turn-radius (A-2 relaxed to 12.5 ft, D-56): pass/fail on the outer tire edge', () => {
  it('outer edge radius = WB / sin(lock) + track/2 + tire/2 = 128.64 + 17.75 + 1.75 = 148.15 in against 150 in: marginal; center radius WB / tan(lock) = 120.9 in, inner edge 109.1 in', () => {
    const t = turnRadius(ctx);
    expect(t.value).toBeCloseTo(44 / Math.sin(20 * RAD) + 17.75 + 1.75, 9);
    expect(t.value).toBeCloseTo(148.15, 2);
    expect(t.limit).toBe(150);
    expect(t.sense).toBe('<=');
    expect(t.status).toBe('marginal');
    expect(t.cases).toBeUndefined();
    expect(t.how).toMatch(/120\.9"/);
    expect(t.how).toMatch(/109\.1"/);
    expect(t.how).toMatch(/turning circle about 20\.1 ft/);
    expect(ctx.L.steer.centerRadiusIn).toBeCloseTo(44 / Math.tan(20 * RAD), 9);
    expect(ctx.L.steer.innerEdgeRadiusIn).toBeCloseTo(44 / Math.sin(20 * RAD) - 17.75 - 1.75, 9);
  });
  it('depends on the geometry, not the rider: a smaller lock (15 deg) turns wider and fails; a longer wheelbase turns wider', () => {
    const a = runChecks({ ...defaults, steerLockDeg: 15 }, { includeTruck: false }).find((c) => c.id === 'turn-radius')!;
    expect(a.value).toBeCloseTo(44 / Math.sin(15 * RAD) + 19.5, 6);
    expect(a.status).toBe('fail');
    expect(a.cases).toBeUndefined();
    const b = runChecks({ ...defaults, wheelbaseIn: 50 }, { includeTruck: false }).find((c) => c.id === 'turn-radius')!;
    expect(b.value).toBeCloseTo(50 / Math.sin(20 * RAD) + 19.5, 6);
  });
});

describe('pitch rows (L1, H3)', () => {
  it('rearNormalNoseDown: W (cos(th) (L - x)/L - sin(th) h/L): 300 lb, x 16, h 20, 15 deg on a 42 in base = 300 (0.9659 x 0.6190 - 0.2588 x 0.4762) = 142.4 lb', () => {
    const th = (15 * Math.PI) / 180;
    expect(rearNormalNoseDown(300, 16, 20, th, 42)).toBeCloseTo(300 * (Math.cos(th) * (26 / 42) - Math.sin(th) * (20 / 42)), 9);
    expect(rearNormalNoseDown(300, 16, 20, th, 42)).toBeCloseTo(142.4, 1);
  });
  it('pitch-fwd by hand (operating rider): the front contacts are at x = 44; N_r/W = 0.9659 (44 - x)/44 - 0.2588 h/44; F_b/W = 0.5 N_r/W; angle = acos((F_b/W)/geo) - 15 deg, geo = (44 - x)/h', () => {
    const c = ctx.loads.operating;
    const th = (15 * Math.PI) / 180;
    const nr = Math.cos(th) * (44 - c.cg[0]) / 44 - (Math.sin(th) * c.cg[2]) / 44;
    const aOverG = 0.5 * nr;
    const geo = (44 - c.cg[0]) / c.cg[2];
    const deg = Math.acos(aOverG / geo) * DEG - 15;
    expect(pitchForward(ctx).cases!.operating!.value).toBeCloseTo(deg, 6);
    expect(deg).toBeCloseTo(67.2, 0);
    expect(byId('pitch-fwd').status).toBe('pass');
    expect(pitchForward(ctx).cases!.operating!.limit).toBe(0);
  });
  it('pitch-fwd text names the front-end rows that carry the front-wheel bump hits', () => {
    expect(pitchForward(ctx).how).toMatch(/kingpin, king-bearing, front-beam, front-stub and bridle-eye rows/);
  });
  it('liftPull and tipBackAngle (pure): T = W (x cos - h sin) / (x_p sin a - z_p cos a); with no pull the tip-back slope is atan(x/h)', () => {
    expect(liftPull(100, 20, 10, 0, 60, 0, Math.PI / 6)).toBeCloseTo(66.67, 1);
    expect(liftPull(100, 20, 10, 0, 56.4, 17.25, 0)).toBe(Infinity); // a horizontal pull above the ground has no lift moment arm
    expect(tipBackAngle(300, 17.5, 15, 0, 56, 17, 0.1).deg).toBeCloseTo(Math.atan2(17.5, 15) * DEG, 9);
  });
  it('the pull point is the tongue tie hole (x 59, z 5.91, D-56): the rope rises 14.1 deg to the hands at 30 in over a 96 in run; x_p sin(a) - z_p cos(a) = 8.63 > 0, so the pull can lift the front', () => {
    const pt = pullPoint(ctx);
    expect(pt.x).toBeCloseTo(59, 9);
    expect(pt.z).toBeCloseTo(5.9125, 4);
    const alpha = Math.atan2(30 - pt.z, 96);
    expect(alpha * DEG).toBeCloseTo(14.09, 1);
    expect(pt.x * Math.sin(alpha) - pt.z * Math.cos(alpha)).toBeCloseTo(8.63, 1);
  });
  it('pitch-rear by hand: T_lift = W (x cos th - h sin th) / 8.63 for 15 deg, as a multiple of the 150 lbf peak: 3.0x for the operating rider, limit 1.25x', () => {
    const pt = pullPoint(ctx);
    const alpha = Math.atan2(30 - pt.z, 96);
    const den = pt.x * Math.sin(alpha) - pt.z * Math.cos(alpha);
    const th = 15 * RAD;
    for (const k of ['operating', 'goal', 'light'] as const) {
      const w = ctx.loads[k];
      const ratio = (w.massLb * (w.cg[0] * Math.cos(th) - w.cg[2] * Math.sin(th))) / den / 150;
      expect(byId('pitch-rear').cases![k]!.value, k).toBeCloseTo(ratio, 2);
      expect(byId('pitch-rear').cases![k]!.limit).toBe(1.25);
    }
    expect(byId('pitch-rear').cases!.operating!.value).toBeCloseTo(3.0, 0);
    expect(byId('pitch-rear').status).toBe('pass');
  });
});

describe('corner mass used by the bump rows is consistent with the contacts', () => {
  it('the rigid-body corner weights are positive and below the cart weight; the rear wheel is closer to the CG and gets the larger one', () => {
    for (const w of ['front', 'rear'] as const) {
      const wc = cornerWeightLb(ctx, ctx.loads.goal, w);
      expect(wc).toBeGreaterThan(0);
      expect(wc).toBeLessThan(ctx.loads.goal.massLb);
    }
    expect(cornerWeightLb(ctx, ctx.loads.goal, 'rear')).toBeGreaterThan(cornerWeightLb(ctx, ctx.loads.goal, 'front'));
  });
});
