/**
 * Rear end checks, round 3 (eng N-7; build MUST-4), re-derived for the pivoting-front-axle sled (D-56): `wheel-rating` covers the front AND rear wheels (the heavier / harder-struck
 * one sets the row; at the defaults that is the rear wheel) and `rear-beam-seat` is the notch in the oak axle HANGER on each rail (the deck is 8 in up, so only 2.15 in of hanger is
 * left above the notch). Bump loads at the split speeds of D-55 (normal 1 in at 3 mph, hard 2 in at 5 mph). Hand numbers are re-derived from params and the layout, not read back
 * from the check code.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, type Params } from '../params';
import { buildModel } from '../model';
import { beamSeat, railSection } from '../model/rear-mount';
import { makeContext } from './context';
import { runChecks, type AnalysisCheck } from './index';
import { bumpCases, cornerWeightLb, peakVertical } from './bump';
import { PRE_D71, PRE_D60, PRE_D66 } from '../test-fixtures';

const defaults = { ...defaultParams(), ...PRE_D71, ...PRE_D66, ...PRE_D60, frontTrackIn: 35.5, rearTrackIn: 35.5 }; // the hand-calc fixture keeps the 35.5 in tracks of 3c-3 (D-58 narrowed them to 34 1/2 front, 32 rear; the new tracks are tested in track-d58.test.ts); the 7/8 in hangers are the D-58 default
const cs = runChecks(defaults, { includeTruck: false });
const byId = (c: AnalysisCheck[], id: string) => c.find((x) => x.id === id)!;
const det = (c: AnalysisCheck[], id: string, name: string) => byId(c, id).details!.find((d) => d.name.includes(name))!;
const run = (q: Partial<Params>) => runChecks({ ...defaults, ...q } as Params, { includeTruck: false });
const mkCtx = (q: Partial<Params> = {}) => {
  const p = resolveParams({ ...defaults, ...q } as Params);
  return makeContext(p, buildModel(p, { rider: 'goal', cargo: true }));
};
const ctx = mkCtx();

describe('wheel / hub rating (N-7), front and rear wheels', () => {
  const c = byId(cs, 'wheel-rating');
  it('is a Structure row with the assumed 300 lb rating and three details; the goal rider passes it at the defaults (util 0.56)', () => {
    expect(c.group).toBe('Structure');
    expect(defaults.wheelRatingLb).toBe(300);
    expect(c.status).toBe('pass');
    expect(c.statusOperating).toBe('pass');
    expect(c.details!.length).toBe(3);
    expect(c.how).toMatch(/vendor listing/);
    expect(c.how).toMatch(/front 1" bump/); // both axles are evaluated; the rear wheel governs
    expect(c.how).toMatch(/rear 1" bump/);
    expect(c.label).toMatch(/Wheel and hub/);
    expect(c.util! / 0.583).toBeCloseTo(1, 1);
  });
  it('hand calc (goal rider, 3 mph normal strike): static rear wheel = W (1 - x/44) (0.5 + |y|/35.5) = 108.3 lb; V = F_n sin(beta) = 225 lbf; peak = V + static = 333.5 lbf vs 2 x 300; skid = mu P = 0.5 x 108.3 = 54.1 lbf vs 0.5 x 300', () => {
    const g = ctx.loads.goal;
    // static: rear axle takes W (1 - x/x_front), x_front = 44 in (the kingpin line), split by 0.5 + |y|/track
    const stat = g.massLb * (1 - g.cg[0] / 44) * (0.5 + Math.abs(g.cg[1]) / 35.5);
    expect(stat / 116.4).toBeCloseTo(1, 1);
    const d = det(cs, 'wheel-rating', 'static load on the heavier wheel');
    expect(d.value).toBeCloseTo(stat, 6);
    expect(d.limit).toBe(300);
    // corner mass 61 lb: F_n = v_n sqrt(k m_e) with v_n = 3 x 17.6 x cos(beta) = 31.68 in/s (r = 5, h = 1: sin beta = 0.8)
    const wc = cornerWeightLb(ctx, g, 'rear');
    expect(wc / 63.5).toBeCloseTo(1, 1);
    const Fn = 31.68 * Math.sqrt((500 * wc) / 386.1);
    expect(Fn / 281.6).toBeCloseTo(1, 1);
    const peak = det(cs, 'wheel-rating', 'peak vertical');
    expect(peak.value).toBeCloseTo(Fn * 0.8 + stat, 6);
    expect(peak.value).toBeCloseTo(peakVertical(bumpCases(ctx, g, 'rear').normal), 9);
    expect(peak.value / 349.8).toBeCloseTo(1, 1);
    expect(peak.limit).toBe(300 * defaults.wheelRatingPeakMult);
    expect(peak.limit).toBe(600);
    const side = det(cs, 'wheel-rating', 'lateral skid');
    expect(side.value).toBeCloseTo(defaults.tireGroundMu * stat, 6);
    expect(side.value / 58.2).toBeCloseTo(1, 1);
    expect(side.limit).toBeCloseTo(300 * defaults.wheelSideRatingFrac, 9);
    expect(side.limit).toBe(150);
    // the bump pulse alone (V = 225 lbf, 2.1x the static load at walking pace) is smaller than the old static x dynamicFactor 3 rule
    expect(peak.value - stat).toBeLessThan(stat * defaults.dynamicFactor);
  });
  it('the peak governs the row: 333.5 / 600 = 0.556 beats the static 108.3 / 300 = 0.36', () => {
    expect(det(cs, 'wheel-rating', 'peak vertical').util / (349.8 / 600)).toBeCloseTo(1, 1);
    expect(det(cs, 'wheel-rating', 'static load').util / (116.4 / 300)).toBeCloseTo(1, 1);
    expect(c.cases!.goal!.util).toBeCloseTo(det(cs, 'wheel-rating', 'peak vertical').util, 9);
  });
  it('rows for the 150 lb operating rider and the 200 lb cargo case (the payload piled at the nose end loads a FRONT wheel with 147.5 lb static, peak 402 lbf, util 0.67) are lighter than the goal rider except the cargo', () => {
    expect(c.cases!.operating!.util).toBeLessThan(c.cases!.goal!.util);
    expect(c.statusCargo).toBe('pass');
    expect(c.utilCargo! / 0.670).toBeCloseTo(1, 1);
    expect(c.detailsCargo!.find((d) => d.name.includes('static load'))!.value / 147.5).toBeCloseTo(1, 1);
    // the cargo case never moves the rider status
    expect(c.status).toBe(c.statusGoal);
  });
  it('a 100 lb rating fails (static 108 lb); a 120 lb rating fails on the 333 lbf peak (limit 240); a 650 lb wheel passes with room; the util falls with a bigger rating', () => {
    expect(byId(run({ wheelRatingLb: 100 }), 'wheel-rating').status).toBe('fail');
    expect(byId(run({ wheelRatingLb: 120 }), 'wheel-rating').status).toBe('fail');
    const r650 = byId(run({ wheelRatingLb: 650 }), 'wheel-rating');
    expect(r650.status).toBe('pass');
    expect(r650.util).toBeLessThan(0.3);
    expect(byId(run({ wheelRatingLb: 400 }), 'wheel-rating').util).toBeLessThan(c.util!);
  });
});

describe('rear axle beam seat in the oak axle hangers (MUST-4, D-54)', () => {
  const seat = beamSeat(ctx.p, ctx.L)!;
  const rail = railSection(ctx.p, ctx.L);
  it('the notch is in the HANGER: 7/8 in thick, 1.35 in deep (axleSeatNotchIn) under the beam top, 2.5 in beam + 2 x 1/16 in clearance = 2.625 in wide, only 2.15 in of hanger left above it (the deck is 8 in up)', () => {
    expect(seat.railT).toBe(defaults.axleHangerThickIn);
    expect(seat.railT).toBe(0.875); // D-58: 7/8 in hanger
    expect(rail.t).toBe(0.875);
    expect(seat.depth).toBeCloseTo(defaults.axleSeatNotchIn, 9);
    expect(seat.x1 - seat.x0).toBeCloseTo(ctx.L.beamR.thick + 2 * defaults.beamNotchClearIn, 9);
    expect(seat.x1 - seat.x0).toBeCloseTo(2.625, 9);
    // the hanger hangs from the rail top (the deck underside, 7.528 in) to 1.35 in below the beam top (5.375 in)
    expect(rail.zTop).toBeCloseTo(7.528, 3);
    expect(ctx.L.beamR.top).toBeCloseTo(5.375, 3);
    expect(rail.zBot).toBeCloseTo(ctx.L.beamR.top - 1.35, 9);
    expect(seat.remain).toBeCloseTo(7.528 - 5.375, 3); // 2.15 in
  });
  it('D-58: the row PASSES at the defaults for the goal rider (util 0.875 with the 7/8 in hanger; the 3/4 in hanger fails the 200 lb cargo case at 1.05): on the 1 in / 3 mph basis the struck wheel V + static = 333.5 lbf bears on 2.5 x 0.875 in of notch ceiling = 160 psi vs 358 psi, but only 2.15 in of hanger is left above the notch', () => {
    const c = byId(cs, 'rear-beam-seat');
    expect(c.status).toBe('pass');
    expect(c.statusOperating).toBe('pass');
    expect(c.util! / 0.869).toBeCloseTo(1, 2); // 0.869 at D-74 (the 2-1/8 in beam is lighter: 0.875 before)
    expect(c.how).toMatch(/NOTCHED/);
    const bear = det(cs, 'rear-beam-seat', 'notch ceiling');
    const V = peakVertical(bumpCases(ctx, ctx.loads.goal, 'rear').normal);
    expect(V / 349.8).toBeCloseTo(1, 1);
    expect(bear.value).toBeCloseTo(V / (ctx.L.beamR.thick * seat.railT), 6);
    expect(bear.value / 159.8).toBeCloseTo(1, 1); // 349.7 lbf on 2.5 x 0.875 in2
    expect(bear.limit).toBeCloseTo((1070 * 0.67) / 2, 6); // 358.45
    // hard 2 in / 5 mph hit, no wood safety factor: 483.6 lbf / 1.875 = 258 psi vs 716.9
    const hard = det(cs, 'rear-beam-seat', 'HARD 2" rear hit: notch ceiling');
    expect(hard.value).toBeCloseTo(peakVertical(bumpCases(ctx, ctx.loads.goal, 'rear').hard) / (2.5 * defaults.axleHangerThickIn), 6);
    expect(hard.value / 231).toBeCloseTo(1, 1);
    expect(hard.limit).toBeCloseTo(716.9, 1);
  });
  it('the hanger net-section shear is V_r = 2/3 Fv b d_n = 2/3 x 318.2 x 0.875 x 2.153 = 399.6 lbf: the 349.7 lbf bump leaves 12% (util 0.875): this is the governing detail', () => {
    const Fv = defaults.oakNdsShearPsi * defaults.ndsWetFactorShear * defaults.ndsLoadDurationFactor;
    const Vr = (2 / 3) * Fv * defaults.axleHangerThickIn * seat.remain;
    const v = det(cs, 'rear-beam-seat', 'NORMAL: rail shear');
    expect(v.limit).toBeCloseTo(Vr, 6);
    expect(v.limit).toBeCloseTo(399.6, 0);
    expect(v.value / 347.2).toBeCloseTo(1, 2); // 347.2 lbf at D-74 (349.8 before: the lighter beam)
    expect(v.util / 0.869).toBeCloseTo(1, 2);
    expect(seat.remain).toBeCloseTo(2.153, 2);
  });
  it('the rail shear above the notch is the tightest detail; the hold-down bolts carry the 28 lbf rebound (18.7 lb axle assembly x 3 / 2) in 316 tension, far from their limit', () => {
    const rows = byId(cs, 'rear-beam-seat').details!;
    const gov = rows.reduce((a, b) => (b.util > a.util ? b : a));
    expect(gov.name).toMatch(/rail shear/);
    expect(gov.name).toMatch(/NORMAL/);
    const unsprung = ctx.parts.filter((x) => /^(beam-R|axle-R|clamp-R|wheel-R)/.test(x.id)).reduce((a, x) => a + x.massLb, 0);
    const rebound = (unsprung * defaults.dynamicFactor) / 2;
    expect(rebound / 28.1).toBeCloseTo(1, 1);
    const t = det(cs, 'rear-beam-seat', 'hold-down tension on each vertical bolt');
    expect(t.value).toBeCloseTo(rebound / 2, 6); // two bolts through the beam
    expect(t.util).toBeLessThan(0.05);
    expect(det(cs, 'rear-beam-seat', 'side skid pull').util).toBeLessThan(0.1);
    expect(det(cs, 'rear-beam-seat', 'washer').util).toBeLessThan(1);
  });
  it('D-58: the cargo case (the payload piled against the box) FAILED the rail shear above the notch with the 3/4 in hanger (util 1.05 at the 200 lb payload); the 7/8 in hanger passes it (util 0.90, marginal)', () => {
    const c = byId(cs, 'rear-beam-seat');
    expect(c.statusCargo).not.toBe('fail');
    expect(c.utilCargo! / 0.899).toBeCloseTo(1, 1);
    expect(c.utilCargo!).toBeGreaterThan(c.util!);
    expect(byId(run({ axleHangerThickIn: 0.75 }), 'rear-beam-seat').statusCargo).toBe('fail'); // the old 3/4 in hanger
  });
  it('a thinner hanger raises the bearing and shear stress in proportion (b = 0.5 in against 7/8 in: 1.75 times)', () => {
    const t = byId(run({ axleHangerThickIn: 0.5 }), 'rear-beam-seat');
    const b = t.details!.find((d) => d.name.includes('notch ceiling'))!.value;
    const b1 = byId(run({}), 'rear-beam-seat').details!.find((d) => d.name.includes('notch ceiling'))!.value;
    expect(b / b1).toBeGreaterThan(1.7); // a 1/2 in hanger bears at 1.75 times the stress of the 7/8 in one, less a hair: it also lowers the sled's mass a little
    expect(b / b1).toBeLessThan(1.77);
  });
  it('an overslung beam still sits in the hanger notch (it is always evaluated since the notch depth is at least 0.5 in): the row is a pass/fail row, not info', () => {
    const o = byId(run({ axleBeamPosition: 1 }), 'rear-beam-seat');
    expect(o.status).not.toBe('info');
    expect(o.details!.length).toBeGreaterThan(5);
  });
});
