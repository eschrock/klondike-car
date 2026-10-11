/**
 * Rear and brake-headroom checks, round 3 (eng N-7, N-8; build MUST-3/4): wheel rating, rear beam seat, the closed-linkage statics of the bearing plates, the
 * 100 lbf lever abuse row and the grip-travel limit. Hand numbers are re-derived from params and the layout, not read back from the check code.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, type Params } from '../params';
import { makeCtx } from '../model/build-utils';
import { brakeGeometry } from '../model/brake';
import { beamSeat } from '../model/rear-mount';
import { boltGroup, mountStatics, uncTensileArea } from './brake-mount';
import { runChecks, type AnalysisCheck } from './index';
import { riderSweep } from './rider-sweep';

const defaults = defaultParams();
const cs = runChecks(defaults, { includeTruck: false });
const byId = (c: AnalysisCheck[], id: string) => c.find((x) => x.id === id)!;
const det = (c: AnalysisCheck[], id: string, name: string) => byId(c, id).details!.find((d) => d.name.includes(name))!;
const run = (q: Partial<Params>) => runChecks({ ...defaults, ...q } as Params, { includeTruck: false });
const ctx = makeCtx(defaults);
const g = brakeGeometry(ctx.p, ctx.L);

describe('wheel / hub rating (N-7)', () => {
  const c = byId(cs, 'wheel-rating');
  it('is a Structure row with the assumed 300 lb rating, three details, and passes at the defaults', () => {
    expect(c.group).toBe('Structure');
    expect(defaults.wheelRatingLb).toBe(300);
    expect(c.status).not.toBe('fail');
    expect(c.details!.length).toBe(3);
    expect(c.how).toMatch(/READ IT OFF THE VENDOR LISTING/);
  });
  it('static load on the heavier wheel, peak = static x dynamic factor vs 2 x rating, skid = mu P vs half the rating', () => {
    const stat = det(cs, 'wheel-rating', 'static load');
    const peak = det(cs, 'wheel-rating', 'dynamic peak');
    const side = det(cs, 'wheel-rating', 'lateral skid');
    expect(stat.limit).toBe(300);
    expect(peak.value).toBeCloseTo(stat.value * defaults.dynamicFactor, 6);
    expect(peak.limit).toBe(300 * defaults.wheelRatingPeakMult);
    expect(side.value).toBeCloseTo(defaults.tireGroundMu * stat.value, 6);
    expect(side.limit).toBeCloseTo(300 * defaults.wheelSideRatingFrac, 9);
    // the goal-rider rear wheel is about 120-135 lb static (eng review: about 120 + the CG offset)
    expect(stat.value).toBeGreaterThan(100);
    expect(stat.value).toBeLessThan(160);
  });
  it('a 100 lb rating fails (static), a 400 lb rating passes with room', () => {
    expect(byId(run({ wheelRatingLb: 100 }), 'wheel-rating').status).toBe('fail');
    expect(byId(run({ wheelRatingLb: 400 }), 'wheel-rating').util).toBeLessThan(byId(cs, 'wheel-rating').util!);
  });
});

describe('rear axle beam seat (MUST-4)', () => {
  const seat = beamSeat(ctx.p, ctx.L)!;
  it('passes at the defaults with the notch ceiling bearing worked by hand', () => {
    const c = byId(cs, 'rear-beam-seat');
    expect(c.status).not.toBe('fail');
    const w = ctx.L.beamR.thick;
    const bear = det(cs, 'rear-beam-seat', 'notch ceiling');
    // V = rear axle load x dynamic factor / 2 per rail on beam.thick x rail thickness
    expect(bear.value).toBeCloseTo((bear.value * w * seat.railT) / (w * seat.railT), 9);
    expect(bear.value * w * seat.railT * 2).toBeGreaterThan(300); // axle load x 3 is several hundred lbf
    expect(bear.limit).toBeGreaterThan(300);
    expect(c.how).toMatch(/NOTCHED/);
  });
  it('the rail net-section shear above the notch is the tightest detail, below its limit', () => {
    const v = det(cs, 'rear-beam-seat', 'rail shear');
    expect(v.util).toBeLessThan(0.95);
  });
  it('the hold-down bolts carry rebound and the side skid in 316 tension, with washers on oak', () => {
    const t = det(cs, 'rear-beam-seat', 'rebound tension');
    expect(t.util).toBeLessThan(0.2);
    expect(det(cs, 'rear-beam-seat', 'side skid pull').util).toBeLessThan(0.3);
    expect(det(cs, 'rear-beam-seat', 'washer').util).toBeLessThan(1);
  });
  it('an overslung beam has no notch or hold-down and the row is info', () => {
    expect(byId(run({ axleBeamPosition: 1 }), 'rear-beam-seat').status).toBe('info');
  });
});

describe('closed-linkage statics of the bearing plates (MUST-3)', () => {
  const feq = 40;
  it('the lever and the shaft are in equilibrium: moments about the pivot cancel, the shaft torque from the shoes equals the crank torque', () => {
    for (const sg of [1, -1] as const) {
      const s = mountStatics(ctx.p, g, feq, sg);
      const M = feq * g.lGrip;
      expect(Math.abs(s.leverResidual) / M, `lever ${sg}`).toBeLessThan(0.08);
      // |F_c| = F_link = M_L/d_Q
      expect(Math.hypot(...s.Fc)).toBeCloseTo((M / g.dQ), 0);
      // total shoe force N = F_hand x ratio of that direction
      expect(s.N).toBeCloseTo(feq * (sg > 0 ? g.ratioFwd : g.ratioRev), 6);
    }
  });
  it('the net load on a plate is far below the sum of magnitudes the round-2 check used (link and shoe forces oppose)', () => {
    const s = mountStatics(ctx.p, g, feq, -1);
    const net = Math.hypot(s.PL[0] + s.Qp[0], s.PL[1] + s.Qp[1]);
    const sum = Math.hypot(...s.PL) + Math.hypot(...s.Qp);
    expect(net).toBeLessThan(0.6 * sum);
    // force balance of the whole mount: bearings + pivot post = shoe forces + hand force
    const tot = [s.PL[0] + s.PR[0] + s.Qp[0], s.PL[1] + s.PR[1] + s.Qp[1]];
    const dir = [g.n[0] - ctx.p.brakePadMu * g.tFwd[0], g.n[1] - ctx.p.brakePadMu * g.tFwd[1]]; // sigma = -1: reverse roll
    expect(tot[0]).toBeCloseTo(s.N * dir[0] - feq, 4); // shoes' force on the shaft, plus the hand force on the lever
    expect(tot[1]).toBeCloseTo(s.N * dir[1], 4);
  });
  it('boltGroup: a pure shear on a symmetric 2 x 2 group splits equally; a tilt moment loads the outer bolts in tension M r / sum r^2', () => {
    const bolts: Array<[number, number]> = [[0, 0], [2, 0], [0, 1], [2, 1]];
    const a = boltGroup(bolts, [{ pos: [1, 0.5], F: [100, 0], e: 0 }]);
    expect(a.Vmax).toBeCloseTo(25, 6);
    expect(a.Tmax).toBeCloseTo(0, 9);
    const b = boltGroup(bolts, [{ pos: [1, 0.5], F: [0, 0], e: 0 }]);
    expect(b.Vmax).toBe(0);
    const c = boltGroup(bolts, [{ pos: [1, 0.5], F: [100, 0], e: 2 }]); // Mz = -200: x-spread +-1, sum x^2 = 4 -> T = 200 x 1 / 4 = 50
    expect(c.Tmax).toBeCloseTo(50, 6);
  });
  it('uncTensileArea: 3/8-16 = 0.0775 in^2, 1/4-20 = 0.0318', () => {
    expect(uncTensileArea(0.375)).toBeCloseTo(0.0775, 3);
    expect(uncTensileArea(0.25)).toBeCloseTo(0.0318, 3);
  });
  it('the shaft row now carries the plate bolt group, the distances and the cleavage limit; it passes without a marginal', () => {
    const c = byId(cs, 'brake-shaft');
    expect(c.status).toBe('pass');
    for (const key of ['bearing-plate bolt shear', 'bearing-plate bolt tension', 'shear-tension interaction', 'washer pull-through', 'hole tear-out', 'rail cleavage toward the bottom', 'rail cleavage toward the deck-ledge', 'bearing bushing pressure', 'bolt end distance', 'edge distance to the rail bottom', 'edge distance to the deck ledge', 'shaft notch', 'bolt pitch'])
      expect(det(cs, 'brake-shaft', key), key).toBeDefined();
    for (const d of c.details!) expect(d.util, d.name).toBeLessThan(0.9);
    expect(c.how).toMatch(/vector statics/);
  });
  it('dropping the oak doubler fails the cleavage limit; the end distance row is the 7D rule', () => {
    expect(det(cs, 'brake-shaft', 'bolt end distance').limit).toBeCloseTo(7 * defaults.brakeBearingBoltDiameterIn, 9);
    expect(byId(run({ brakeDoublerThickIn: 0 }), 'brake-shaft').status).toBe('fail');
  });
});

describe('brake abuse and headroom (N-8)', () => {
  it('brake-abuse is a Structure row at yield level, the governing detail is named, and it passes (no marginal) at 100 lbf', () => {
    const c = byId(cs, 'brake-abuse');
    expect(c.group).toBe('Structure');
    expect(c.status).toBe('pass');
    expect(c.details!.some((d) => d.name.startsWith('lever:'))).toBe(true);
    expect(c.details!.some((d) => d.name.startsWith('shaft/mounts:'))).toBe(true);
    expect(c.details!.some((d) => d.name.startsWith('ratchet:'))).toBe(true);
    expect(c.details!.some((d) => d.name.startsWith('link/crank:'))).toBe(true);
    expect(c.how).toMatch(/100(\.0)? lbf/);
  });
  it('is monotone in the pull: 200 lbf fails, 50 lbf is easy; and at yield-level limits (design allowable x steel SF)', () => {
    expect(byId(run({ brakeAbuseLbf: 200 }), 'brake-abuse').status).toBe('fail');
    expect(byId(run({ brakeAbuseLbf: 50 }), 'brake-abuse').util!).toBeLessThan(byId(cs, 'brake-abuse').util!);
    const shaft = det(cs, 'brake-abuse', 'shaft bending + torsion');
    expect(shaft.limit).toBeCloseTo(defaults.brakeShaftYieldPsi, 0); // 50,000 x SF 2 = the 100 ksi yield
  });
  it('the shaft is what the abuse case sizes: the 3/4" shaft of round 2 would exceed its yield at 100 lbf (eng: about 90-140 ksi)', () => {
    const d = det(run({ brakeShaftDiameterIn: 0.75 }), 'brake-abuse', 'shaft bending + torsion');
    expect(d.value).toBeGreaterThan(d.limit);
  });
  it('the headroom 1.2 trades travel for force: the goal-rider handle force is at most 0.87 of the limit, grip travel inside the 6.5" limit', () => {
    const f = byId(cs, 'brake-force');
    expect(f.cases!.goal!.value / defaults.handleForceLimitLbf).toBeLessThan(0.87);
    expect(f.status).toBe('pass');
    expect(g.gripTravelIn).toBeLessThan(defaults.brakeGripTravelMaxIn);
    const r = byId(cs, 'brake-ratio');
    expect(r.details!.some((d) => d.name.includes('grip travel'))).toBe(true);
    expect(r.how).toMatch(/Grip travel/);
    // the travel limit is enforced: a 5" limit turns the row from pass to fail/marginal
    expect(byId(run({ brakeGripTravelMaxIn: 5 }), 'brake-ratio').status).not.toBe('pass');
    // and the old 1.1 headroom at the 3/8" stroke would have been 6.4" of travel with the goal case at 0.92 of the limit
    const old = run({ brakeRatioHeadroom: 1.1, brakeShoeTravelIn: 0.375 });
    expect(byId(old, 'brake-force').cases!.goal!.util).toBeGreaterThan(byId(cs, 'brake-force').cases!.goal!.util);
  });
  it('the Simple view safe range is reported by riderSweep (the limit is the front steer-stops row, not the brake or rear mounts)', () => {
    const r = riderSweep(defaults);
    expect(r.safe).not.toBeNull();
    expect(r.safe!.hiLb).toBeGreaterThanOrEqual(190);
    for (const id of ['brake-abuse', 'wheel-rating', 'rear-beam-seat', 'brake-shaft', 'brake-lever']) {
      expect(r.points.every((p) => !p.fails.includes(id)), id).toBe(true);
    }
  });
});
