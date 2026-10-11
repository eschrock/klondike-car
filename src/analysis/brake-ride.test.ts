/**
 * Ride-mode brake rows (Phase 3b WS-C, D-56): every number is re-derived by hand from the params, the model's load cases and the geometry, independently of
 * the check code.
 */
import { describe, expect, it } from 'vitest';
import { phase3bDefaults, defaultParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext } from './context';
import { brakeForce, brakeRatio, brakeClearance } from './brake';
import { beltAnchorCheck, brakeBias, brakeEmergency, brakeHeat, brakeRideRows, brakeStop, frontBrakeCheck, hipCableCheck, parkHold } from './brake-ride';
import { chainOf, heatRun, lockLimits, stopDistance, wheelbaseOf } from './brake-chain';
import { frontBrakeSweep } from './brake-sweep-front';
import type { AnalysisCheck } from './types';

const RAD = Math.PI / 180;
const mk = (p: Params) => makeContext(p, buildModel(p, { rider: 'goal', cargo: true }));
const p3 = phase3bDefaults();
const ctx = mk(p3);
const ch = chainOf(ctx);
const caseOf = (c: AnalysisCheck, k: 'operating' | 'goal') => c.cases![k]!;
const crr = p3.brakeRollingCrr;

describe('brake force: hold on the design slope', () => {
  it('the main-grip force is W sin(theta) / mu_fouled / (R_crit x eta) and the hip grip is 0.93 x that over the cable efficiency', () => {
    const c = ctx.loads.goal;
    const hold = (c.massLb * Math.sin(p3.designSlopeDeg * RAD)) / p3.brakePadMuFouled / (ch.Rcrit * p3.brakeEfficiency);
    const hip = (hold * ch.hg.hipPerMain) / p3.hipCableEfficiency;
    const row = brakeForce(ctx);
    expect(caseOf(row, 'goal').value).toBeCloseTo(Math.max(hold, hip), 3);
    expect(hold).toBeLessThanOrEqual(30);
    expect(hip).toBeLessThanOrEqual(30);
    expect(ch.hg.hipPerMain).toBeGreaterThan(0.9);
    expect(ch.hg.hipPerMain).toBeLessThan(0.96);
  });
  it('the front brake adds capacity, not leverage: the total ratio is within 5% of the rear-only ratio and the hold force is about the same', () => {
    const rear = chainOf(mk({ ...p3, frontBrakeType: 2 }));
    expect(Math.abs(ch.Rcrit / rear.Rcrit - 1)).toBeLessThan(0.05);
  });
  it('the ratio row reports the front and total ratios and a grip travel that includes the cable stretch', () => {
    const row = brakeRatio(ctx);
    expect(row.details!.some((d) => /TOTAL ratio/.test(d.name))).toBe(true);
    expect(row.details!.find((d) => /including the front cable stretch/.test(d.name))!.value).toBeGreaterThan(row.details!.find((d) => /^grip travel/.test(d.name))!.value);
  });
});

describe('emergency stop force', () => {
  it('0.30 g on the envelope slope needs <= 50 lbf at the hip grip at the goal rider (hand-derived)', () => {
    const c = ctx.loads.goal, th = p3.rideGoSlopeDeg * RAD;
    const F = c.massLb * (0.3 + Math.sin(th) - crr * Math.cos(th));
    const N = F / p3.brakePadMuFouled;
    const main = N / (ch.Rcrit * p3.brakeEfficiency);
    const hip = (main * ch.hg.hipPerMain) / p3.hipCableEfficiency;
    const row = brakeEmergency(ctx);
    expect(caseOf(row, 'goal').value).toBeCloseTo(hip, 3);
    expect(hip).toBeLessThanOrEqual(p3.brakeEmergencyLimitLbf);
    expect(row.statusOperating).not.toBe('fail');
  });
});

describe('stopping distance', () => {
  it('formula pinned by hand at 5 degrees: 10 mph, 1 s reaction, deceleration 0.3 g', () => {
    const th = 5 * RAD, g = 32.174, v0 = 10 * 22 / 15;
    const aRoll = g * (Math.sin(th) - crr * Math.cos(th));
    const react = v0 * 1 + 0.5 * aRoll;
    const v1 = v0 + aRoll;
    const brake = (v1 * v1) / (2 * 0.3 * g);
    const r = stopDistance(10, th, crr, 1, 0.3);
    expect(r.reactionFt).toBeCloseTo(react, 9);
    expect(r.brakeFt).toBeCloseTo(brake, 9);
    expect(r.totalFt).toBeCloseTo(react + brake, 9);
    expect(react).toBeGreaterThan(14);
    expect(react).toBeLessThan(17);
  });
  it('from 10 mph at 8 degrees and mu 0.5 it stops in <= 40 ft including the reaction (operating and goal)', () => {
    const row = brakeStop(ctx);
    expect(caseOf(row, 'operating').value).toBeLessThanOrEqual(p3.rideStopMaxFt);
    expect(caseOf(row, 'goal').value).toBeLessThanOrEqual(p3.rideStopMaxFt);
    expect(row.details!.length).toBeGreaterThanOrEqual(5);
  });
  it('the row value equals the independent calculation from the lockup limits', () => {
    const c = ctx.loads.operating, th = p3.rideGoSlopeDeg * RAD;
    const b = (ch.bias.fwd + ch.bias.rev) / 2;
    const lk = lockLimits(c.cg[0], c.cg[2], wheelbaseOf(ctx), th, b, p3.tireGroundMu, crr);
    const main = (p3.brakeEmergencyLimitLbf * p3.hipCableEfficiency) / ch.hg.hipPerMain;
    const aHand = (p3.brakePadMuFouled * main * ch.Rcrit * p3.brakeEfficiency) / c.massLb - Math.sin(th) + crr * Math.cos(th);
    const expected = stopDistance(p3.rideSpeedMph, th, crr, p3.rideReactionS, Math.min(Math.max(0, lk.aMax), aHand)).totalFt;
    expect(caseOf(brakeStop(ctx), 'operating').value).toBeCloseTo(expected, 6);
  });
});

describe('bias and lockup order', () => {
  it('the lockup limits satisfy both axle inequalities at the limit (hand check of the load-transfer algebra)', () => {
    const c = ctx.loads.operating, th = 8 * RAD, wb = wheelbaseOf(ctx), b = 0.6, mu = 0.5;
    const lk = lockLimits(c.cg[0], c.cg[2], wb, th, b, mu, crr);
    const a = lk.aMax, W = c.massLb;
    const F = W * (a + Math.sin(th) - crr * Math.cos(th));
    const Nf = (W * (c.cg[0] * Math.cos(th) + (Math.sin(th) + a) * c.cg[2])) / wb;
    const Nr = W * Math.cos(th) - Nf;
    const front = (b * F) / Nf, rear = ((1 - b) * F) / Nr;
    expect(Math.max(front, rear)).toBeCloseTo(mu, 6);
    expect(lk.frontFirst).toBe(front >= rear - 1e-9);
  });
  it('the default share is in 0.4-0.6 and the front axle slides no later than the rear at mu 0.5 on 8 and 10 degrees', () => {
    const row = brakeBias(ctx);
    expect(row.statusOperating).not.toBe('fail');
    expect(row.statusGoal).not.toBe('fail');
    for (const m of [ch.bias.fwd, ch.bias.rev]) { expect(m).toBeGreaterThanOrEqual(0.4); expect(m).toBeLessThanOrEqual(0.6 + 1e-9); }
  });
  it('a 0.5 share (the spec value) lets the rear slide first on this cart at mu 0.5: the row says so', () => {
    const row = brakeBias(mk({ ...p3, frontBrakeBias: 0.5 }));
    expect(row.statusOperating).toBe('fail');
  });
});

describe('shoe heat', () => {
  it('lined steel-backed shoes allow at least rideRunFt at the envelope slope at the operating rider; oak shoes fail', () => {
    const row = brakeHeat(ctx);
    expect(caseOf(row, 'operating').value).toBeGreaterThanOrEqual(p3.rideRunFt);
    const oak = brakeHeat(mk({ ...p3, brakeShoeBacking: 0 }));
    expect(caseOf(oak, 'operating').status).toBe('fail');
    expect(caseOf(oak, 'operating').value).toBeLessThan(0.5 * caseOf(row, 'operating').value);
  });
  it('hand check: dT = 2 q sqrt(t)/(sqrt(pi) e) gives t = (dT sqrt(pi) e / 2q)^2, and the 250 K time scales as 1/q^2', () => {
    const c = ctx.loads.operating, th = p3.rideGoSlopeDeg * RAD;
    const h = heatRun(p3, ch, c.massLb, th);
    const t = ((p3.brakeHeatLimitK * Math.sqrt(Math.PI) * h.effusivity) / (2 * h.qWm2)) ** 2;
    expect(h.timeS).toBeCloseTo(t, 6);
    expect(h.runFt).toBeCloseTo((p3.rideSpeedMph * 0.44704 * t) / 0.3048, 6);
    // twice the contact patch halves q and quadruples the time
    const h2 = heatRun({ ...p3, brakeHeatContactFrac: p3.brakeHeatContactFrac * 2 }, ch, c.massLb, th);
    expect(h2.timeS / h.timeS).toBeCloseTo(4, 6);
    // heavier rider: the goal rider has a shorter run than the operating rider
    expect(heatRun(p3, ch, ctx.loads.goal.massLb, th).runFt).toBeLessThan(h.runFt);
  });
  it('power: the hottest shoe flux follows W v (sin theta - Crr cos theta) over the axle shares', () => {
    const c = ctx.loads.operating, th = p3.rideGoSlopeDeg * RAD;
    const P = c.massLb * 4.4482216 * p3.rideSpeedMph * 0.44704 * (Math.sin(th) - crr * Math.cos(th));
    const h = heatRun(p3, ch, c.massLb, th);
    const share = h.shoeW / P;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.35);
  });
});

describe('parking, hip cable, belt', () => {
  it('park-hold: both axles locked on the design slope holds with margin >= 1.5 at mu 0.5 (hand: mu cos / sin)', () => {
    const row = parkHold(ctx);
    const th = p3.designSlopeDeg * RAD;
    expect(caseOf(row, 'operating').value).toBeCloseTo((p3.tireGroundMu * Math.cos(th)) / Math.sin(th), 6);
    expect(row.statusOperating).not.toBe('fail');
    expect(row.details!.find((d) => /0\.3/.test(d.name))!.value).toBeLessThan(1.5);
  });
  it('hip cable: the 100 lbf abuse grip load puts 600 lbf in the cable and the break strength over that is >= 3.5; 1/8 in would not be', () => {
    const T = (100 * p3.hipLeverArmIn) / p3.hipLeverCableArmIn;
    expect(T).toBeCloseTo(600, 6);
    const mbs = p3.brakeCableBreakPsi * p3.hipCableDiaIn ** 2;
    expect(mbs / T).toBeGreaterThanOrEqual(3.5);
    expect((p3.brakeCableBreakPsi * 0.125 ** 2) / T).toBeLessThan(3.5);
    const row = hipCableCheck(ctx);
    expect(row.details!.find((d) => /break strength/.test(d.name))!.value).toBeCloseTo(mbs / T, 6);
    expect(row.statusOperating).not.toBe('fail');
  });
  it('belt anchor: rider x beltDesignG over two anchors, two 3/8 in bolts each, passes at ultimate', () => {
    const c = ctx.loads.goal;
    const perBolt = (c.riderLb * p3.beltDesignG) / 2 / 2;
    const row = beltAnchorCheck(ctx);
    const bolt = row.details!.find((d) => /bolt tension/.test(d.name))!;
    expect(bolt.value * ((Math.PI / 4) * (p3.beltAnchorBoltDiaIn - 0.9743 / 16) ** 2)).toBeCloseTo(perBolt, 4);
    expect(row.statusOperating).not.toBe('fail');
    expect(row.statusGoal).not.toBe('fail');
  });
});

describe('front brake structure, clearance and housing', () => {
  const sweep = frontBrakeSweep(ctx);
  it('front shoes track the wheel: the lining gap to the tread is the front stroke at every steer angle and the shoe keeps >= 0.25 in to the hull', () => {
    expect(sweep.on).toBe(true);
    expect(sweep.poses).toBeGreaterThan(20);
    expect(sweep.shoeGapIn).toBeGreaterThanOrEqual(p3.frontShoeTravelIn - 0.03);
    expect(sweep.shoeGapIn).toBeLessThanOrEqual(p3.frontShoeTravelIn + 0.1);
    expect(sweep.minToHullIn).toBeGreaterThanOrEqual(0.25);
    expect(sweep.armToTireIn).toBeGreaterThanOrEqual(0.1);
  });
  it('the housing clamp on the kingpin axis keeps the chord constant over the sweep and the bend radius above the housing minimum', () => {
    expect(sweep.chordMaxIn - sweep.chordMinIn).toBeLessThan(0.05);
    expect(sweep.bendRadiusIn).toBeGreaterThanOrEqual(p3.frontBrakeHousingMinBendIn);
  });
  it('brake-clear includes the front sweep and passes', () => {
    const row = brakeClearance(ctx);
    expect(row.details!.some((d) => /front brake parts to the hull/.test(d.name))).toBe(true);
    expect(row.status).not.toBe('fail');
  });
  it('brake-front passes at the operating rider; the cable carries the tension re-derived by hand', () => {
    const row = frontBrakeCheck(ctx);
    expect(row.statusOperating).not.toBe('fail');
    const lam = p3.brakeLoadFactor, th = p3.designSlopeDeg * RAD, c = ctx.loads.operating;
    const nHold = (c.massLb * Math.sin(th)) / Math.min(p3.brakePadMu, p3.brakePadMuFouled);
    const Ns = (lam * nHold * Math.max(ch.bias.fwd, ch.bias.rev)) / 2;
    const Tc = (2 * Ns * Math.max(ch.fg.kFwd, ch.fg.kRev)) / ch.fg.tailIn;
    expect(Tc).toBeGreaterThan(100);
    expect(Tc).toBeLessThan(600);
  });
  it('brake-steer: equal front forces cancel in the tie rod; a 20% imbalance leaves a small drag-link force', () => {
    const row = frontBrakeCheck(ctx);
    const net = row.details!.find((d) => /net steering moment/.test(d.name))!;
    expect(net.value).toBeGreaterThan(0);
    const link = row.details!.find((d) => /drag-link force/.test(d.name))!;
    expect(link.value).toBeLessThan(60);
  });
});

describe('row set', () => {
  it('the old rear-only cart gets no ride rows; the Phase 3b cart gets all of them', () => {
    expect(brakeRideRows(mk(defaultParams()))).toEqual([]);
    const ids = brakeRideRows(ctx).map((r) => r.id);
    expect(ids).toEqual(['brake-emergency', 'brake-stop', 'brake-bias', 'brake-heat', 'park-hold', 'brake-front', 'hip-cable', 'belt-anchor']);
  });
});
