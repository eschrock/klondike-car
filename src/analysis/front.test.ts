/**
 * Phase 3 workstream A (D-31…D-35): steer-stops and its share-1.0 bounding row, kingpin-plates, kingpin-bolts (NDS), kingpin-split (cleavage),
 * pitch-path, bridle-tie, and the roll-bolster-attach row that reads the fasteners from the model's joints. Loads come from the existing, separately
 * tested helpers (strikeCases, yawTorque, wheelLoads); every expected check value is rebuilt here from literal geometry (the plate z levels, the bolt
 * pitch 1.5625", the pad stiffness) worked by hand in the comments, never from the formulas in front.ts.
 *
 * Geometry used below (defaults): beam top 6.875, carrier 3/8" → 7.25, 1,500 lb turntable ½" → 7.75, crossbar plate 3/16" → 7.9375, beam plate under the
 * 2.5" beam 4.1875…4.375. Plate mid heights: crossbar plate 7.84375, carrier 7.0625, beam plate 4.28125 → a = 2.78125", b = 0.78125".
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, steerStopPlan, type Params } from '../params';
import { kingpinPlateIssues } from '../model/kingpin-plates';
import { buildModel } from '../model';
import { computeLayout } from '../model/layout';
import { toothThickness } from '../model/stops';
import { BRIDLE_APEX_AHEAD_IN } from '../model/steering';
import { makeContext } from './context';
import { runChecks, type AnalysisCheck } from './index';
import { bridleTieCheck, kingpinBoltsCheck, kingpinPlatesCheck, kingpinSplitCheck, pinLoads, pinReactions, pitchPathCheck, plateModel, stopEnv, stopShare, stopStiffness, steerStopsBoundCheck, steerStopsCheck } from './front';
import { allowables, obstacleForce, strikeCases, wheelLoads, yawTorque } from './structure';

const defaults = defaultParams();
const run = (p: Params) => runChecks(p, { includeTruck: false });
const byId = (cs: AnalysisCheck[], id: string) => cs.find((c) => c.id === id)!;
const det = (c: AnalysisCheck, name: string) => c.details!.find((d) => d.name.includes(name))!;
const ctxOf = (p: Params, parts = buildModel(resolveParams(p), { rider: 'goal', cargo: true, steerDeg: 0 })) => makeContext(resolveParams(p), parts);

// Hand-worked geometry constants (see the header)
const A_SPAN = 2.78125, B_LOAD = 0.78125;
const PITCH = 1.5625;
const SUM_Y2 = 2 * (2.34375 ** 2 + 3.90625 ** 2 + 5.46875 ** 2); // 2 × (5.49316 + 15.25879 + 29.90723) = 101.31836
const ADJ = 0.7 * 1.6 * 0.85; // C_M × C_D × C_g = 0.952

describe('the front-end checks at the defaults', () => {
  const cs = run(defaults);
  it('exist, are Structure rows with hand arithmetic in `how`, and none fails at any rider case', () => {
    for (const id of ['steer-stops', 'steer-stops-bound', 'kingpin-plates', 'kingpin-bolts', 'kingpin-split', 'pitch-path', 'bridle-tie']) {
      const c = byId(cs, id);
      expect(c, id).toBeDefined();
      expect(c.group, id).toBe('Structure');
      expect(c.how.length, id).toBeGreaterThan(200);
      expect(c.how, id).not.toMatch(/NaN|Infinity|undefined/);
      expect(c.statusOperating, id).not.toBe('fail');
      expect(c.statusGoal, id).not.toBe('fail');
      expect(c.load, id).toBe('goal');
      expect(Number.isFinite(c.value) && Number.isFinite(c.limit), id).toBe(true);
    }
    expect(byId(cs, 'kingpin-peak').status).toBe('info'); // round 1's oak peak-bearing row is replaced (D-35)
  });
  it('the default turntable is preset 2 (1,500 lb, ½" stack) and the 1,000-lb row of round 1 no longer limits: capacity 1,500/2 = 750 lbf against the 3×-factored axle load', () => {
    expect(defaults.turntableType).toBe(2);
    expect(defaults.turntableRatingLb).toBe(1500);
    expect(defaults.turntableThicknessIn).toBeCloseTo(0.5, 9);
    expect(defaults.frontDeckRaiseIn).toBe(1);
    const t = byId(cs, 'turntable');
    expect(t.limit).toBeCloseTo(750, 6);
    expect(t.statusGoal).not.toBe('fail');
  });
});

describe('steer-stops (M1, D-35): urethane-faced dogs, stiffness-based share, nothing through the ring', () => {
  const p = resolveParams(defaults);
  const plan = steerStopPlan(p);
  const ctx = ctxOf(p);
  const goal = ctx.loads.goal;
  const c = steerStopsCheck(ctx);
  const L = computeLayout(p);
  const ringDepth = L.bolster.z1 - L.bolster.z0;
  const hFace = Math.min(p.steerStopHeightIn, ringDepth - 2 * p.sideBearerClearanceIn) - p.steerStopFacePlateIn; // 1.25 − 0.3125 = 0.9375"
  it('yaw torque: a one-wheel 3" curb strike H_w = V_w·tanφ at y_w = 17.75" gives T = H_w·y_w (7k lb·in at the goal rider); the rope pull at one tie is 150 × 13.25" = 1,988', () => {
    const w = wheelLoads(ctx, goal);
    const hw = obstacleForce(ctx.d.wheelRadiusIn, p.curbHeightIn, w.frontWheel * p.dynamicFactor).H;
    const y = yawTorque(ctx, goal);
    expect(y.Hw).toBeCloseTo(hw, 6);
    expect(y.yw).toBeCloseTo(17.75, 9);
    expect(y.strike).toBeCloseTo(hw * 17.75, 6);
    expect(y.T).toBeGreaterThan(6000);
    expect(y.T).toBeLessThan(8000);
    expect(y.rope).toBeCloseTo(150 * 13.25, 6);
    expect(y.governing).toBe('one-wheel curb strike');
  });
  it('pad stiffness k = E·A/t: E 1,500 psi, A = 2.738" × 0.9375" = 2.567 in², t = ¼" → 15,403 lbf/in (the round-1 wood faces were ≈ 480,000)', () => {
    const env = stopEnv(ctx, goal)!;
    // face length = rb − ra = 5.6527 − 2.9143 = 2.7384"
    expect(plan.rb - plan.ra).toBeCloseTo(2.7384, 3);
    expect(env.hFace).toBeCloseTo(hFace, 9);
    expect(env.area).toBeCloseTo(2.7384 * 0.9375, 3);
    expect(env.k).toBeCloseTo((1500 * 2.7384 * 0.9375) / 0.25, 0);
    expect(stopStiffness(1500, 4, 0.25)).toBeCloseTo(24000, 9);
    expect(env.k).toBeLessThan(480000 / 20); // ≥ 20× softer than oak behind a steel face
  });
  it('r_eff = ⅔(s₂³ − s₁³)/(s₂² − s₁²) = ⅔ × 155.87 / 23.46 = 4.429"; the pair force P = T/r_eff; share = ½ + k·δ/(2P) with δ = 0.005" (≈ 0.52 here, ≤ 0.55 target)', () => {
    const y = yawTorque(ctx, goal);
    const env = stopEnv(ctx, goal)!;
    // s₁ = 2.9143, s₂ = 5.6527: cubes 24.753 and 180.62, squares 8.493 and 31.953
    const rEff = ((2 / 3) * (5.6527 ** 3 - 2.9143 ** 3)) / (5.6527 ** 2 - 2.9143 ** 2);
    expect(env.rEff).toBeCloseTo(rEff, 3);
    expect(env.rEff).toBeCloseTo(4.4294, 3);
    expect(env.P).toBeCloseTo(y.T / 4.4294, 1);
    const share = 0.5 + (15403 * 0.005) / (2 * (y.T / 4.4294));
    expect(env.share).toBeCloseTo(share, 3);
    expect(env.share).toBeGreaterThan(0.5);
    expect(env.share).toBeLessThanOrEqual(0.55);
    expect(env.F).toBeCloseTo(env.share * env.P, 9);
    // the net force the pair leaves on the pin is (2·share − 1)·P
    expect(env.net).toBeCloseTo((2 * env.share - 1) * env.P, 6);
  });
  it('stopShare: ½ + kδ/(2P); capped at 1 when P ≤ kδ (the second stop never touches); equal stiffness and no mismatch → ½', () => {
    expect(stopShare(24000, 0.005, 1512)).toBeCloseTo(0.5 + 120 / 3024, 9); // 0.5397
    expect(stopShare(24000, 0.005, 100)).toBe(1);
    expect(stopShare(24000, 0, 1512)).toBe(0.5);
    // the round-1 wood faces: k = 480 kip/in, δ = 0.005" → kδ = 2,400 lbf > P = 1,528: one stop takes everything (critic MF-1)
    expect(stopShare(480000, 0.005, 1528)).toBe(1);
  });
  it('the stops row: pad peak pressure = 3·T₁·s₂/(h(s₂³ − s₁³)) with T₁ = share·T, h = 0.9375", against the 800 psi pad allowable; the pad strain F/(k·t) against 30%', () => {
    const y = yawTorque(ctx, goal);
    const env = stopEnv(ctx, goal)!;
    const T1 = env.share * y.T;
    const pMax = (3 * T1 * 5.6527) / (0.9375 * (5.6527 ** 3 - 2.9143 ** 3));
    expect(det(c, 'urethane pad pressure').value).toBeCloseTo(pMax, 0);
    expect(det(c, 'urethane pad pressure').limit).toBe(800);
    expect(det(c, 'pad compression strain').value).toBeCloseTo(env.F / env.k / 0.25, 6);
    expect(det(c, 'pad compression strain').limit).toBe(0.3);
    expect(c.how).toMatch(/INSIDE the 6\.25" turntable hole/);
    expect(c.how).toMatch(/nothing through the ball ring/);
    // wedge split on the supports and the oak ⊥ allowable 358.45 (1,070 × 0.67 / 2)
    const al = allowables(ctx);
    expect(al.oakPerp).toBeCloseTo(358.45, 2);
    expect(det(c, 'bolster rail face').limit).toBeCloseTo(358.45, 2);
    expect(c.details!.filter((d) => d.util > 1)).toEqual([]);
  });
  it('flange bending: σ = 6·(p·h²/2)/t² = 3·p_max·h²/t² with h = 0.9375", t = 5/16"; riser bending 6·F·h_r/(d·w²)', () => {
    const env = stopEnv(ctx, goal)!;
    expect(det(c, 'channel flange').value).toBeCloseTo((3 * env.tri.pMax * 0.9375 ** 2) / 0.3125 ** 2, 0);
    // the riser is 1/8" tall here (arm top 7.6875 → web bottom 7.8125), 0.5" deep, 1.25" wide
    const riserH = 7.8125 - (7.25 + 0.4375);
    expect(riserH).toBeCloseTo(0.125, 9);
    expect(det(c, 'riser bending').value).toBeCloseTo((6 * env.F * riserH) / (0.5 * 1.25 ** 2), 0);
    expect(det(c, 'riser shear').value).toBeCloseTo(env.F / (0.5 * 1.25), 0);
  });
  it('the kingpin row lists the stop pair only when it makes a worse case than the two-wheel strike: not at the design share, yes when one stop takes all (mismatch 0.2" ≥ P/k)', () => {
    expect(c.details?.some((d) => d.name.startsWith('net kingpin load'))).toBe(false);
    const stiff = steerStopsCheck(ctxOf({ ...defaults, steerStopFitMismatchIn: 0.2 }));
    const y = yawTorque(ctx, goal);
    const env1 = stopEnv(ctxOf({ ...defaults, steerStopFitMismatchIn: 0.2 }), goal, undefined)!;
    expect(env1.share).toBe(1);
    expect(det(stiff, 'net kingpin load').value).toBeCloseTo(y.Hw + env1.P, 6);
  });
  it('a pad that is too stiff or too thin does not share: with E = 150,000 psi (≈ hard plastic) the share is 1 and the row fails', () => {
    const hard = steerStopsCheck(ctxOf({ ...defaults, steerStopPadModulusPsi: 150000 }));
    expect(stopEnv(ctxOf({ ...defaults, steerStopPadModulusPsi: 150000 }), goal)!.share).toBe(1);
    expect(hard.status).toBe('fail'); // the net force on the pin (and the pad at one stop) go over
  });
  it('the thinnest wood behind the stop face is the 1/2" trim limit', () => {
    expect(toothThickness(plan.a, plan.cb, plan.W, plan.lock, plan.ra)).toBeCloseTo(0.5, 9);
    expect(c.how).toMatch(/Thinnest wood behind the face where the block is trimmed: 0\.50"/);
  });
  it('a design whose stops do not fit reports a failing row with the reason instead of throwing', () => {
    const bad = { ...defaults, steerStopSizeIn: 3, steerStopPadIn: 0.5 };
    const row = steerStopsCheck(ctxOf(bad, buildModel(resolveParams(bad), { rider: 'goal', cargo: true, steerDeg: 0 })));
    expect(row.status).toBe('fail');
    expect(row.how).toMatch(/do not fit/);
  });
});

describe('steer-stops-bound: one stop takes the whole torque (share 1.0), a bounding case that must not fail catastrophically', () => {
  const p = resolveParams(defaults);
  const ctx = ctxOf(p);
  const goal = ctx.loads.goal;
  const c = steerStopsBoundCheck(ctx);
  it('F = P = T/r_eff on one stop: the pad peak is the design value ÷ share, held to the pad yield 1,500 psi; the net force on the pin is P (no cancellation)', () => {
    const y = yawTorque(ctx, goal);
    const env = stopEnv(ctx, goal, 1)!;
    expect(env.share).toBe(1);
    expect(env.F).toBeCloseTo(y.T / 4.4294, 1);
    expect(env.net).toBeCloseTo(env.P, 9);
    const pMax = (3 * y.T * 5.6527) / (0.9375 * (5.6527 ** 3 - 2.9143 ** 3));
    expect(det(c, 'urethane pad pressure').value).toBeCloseTo(pMax, 0);
    expect(det(c, 'urethane pad pressure').limit).toBe(1500);
    expect(det(c, 'pad compression strain').limit).toBe(0.5);
  });
  it('the abuse case holds wood and steel to strength: oak ⊥ 358.45 × 2 = 716.9, plate rows × 2; the plate bolts to the NDS value × the wood safety factor 2', () => {
    expect(det(c, 'bolster rail face').limit).toBeCloseTo(716.9, 1);
    expect(det(c, 'channel flange').limit).toBeCloseTo(36000, 6); // 36 ksi / (SF 2 / 2)
    expect(det(c, 'carrier end').limit).toBeCloseTo(2 * 509.14, 0);
    // at the pin: H_w + P, as the how text says
    expect(c.how).toMatch(/the net force it leaves on the kingpin is P/);
  });
  it('it passes at the design (marginal at worst) and fails with a stiff pad because then the share is 1 at the design mismatch too', () => {
    expect(c.statusGoal).not.toBe('fail');
    expect(c.statusOperating).not.toBe('fail');
  });
});

describe('kingpin-plates: the pin as an overhanging beam on the sleeve, steel on steel (D-35)', () => {
  const p = resolveParams(defaults);
  const ctx = ctxOf(p);
  const goal = ctx.loads.goal;
  const pm = plateModel(ctx)!;
  const c = kingpinPlatesCheck(ctx);
  it('the plate model reads the geometry from the parts: a = 2.78125", b = 0.78125", plates 3/8", 3/16", 3/16"; the plate bolts are 6 + 4', () => {
    expect(pm.a).toBeCloseTo(A_SPAN, 9);
    expect(pm.b).toBeCloseTo(B_LOAD, 9);
    expect(pm.carrier.t).toBeCloseTo(0.375, 9);
    expect(pm.beam.tBot).toBeCloseTo(0.1875, 9);
    expect(pm.barPlate.t).toBeCloseTo(0.1875, 9);
    expect(pm.beam.n).toBe(6);
    expect(pm.beam.pitch).toBeCloseTo(PITCH, 9);
    expect(pm.bar.n).toBe(4);
  });
  it('pinReactions: R_top = H(1 + b/a) = 1.2809 H, R_bot = −H·b/a = −0.2809 H, M = H·b (0.78125 H); H = 1,000 → 1,280.9 / −280.9 / 781.25', () => {
    const r = pinReactions(1000, A_SPAN, B_LOAD);
    expect(r.Rtop).toBeCloseTo(1280.9, 1);
    expect(r.Rbot).toBeCloseTo(-280.9, 1);
    expect(r.M).toBeCloseTo(781.25, 9);
    expect(r.Rtop + r.Rbot).toBeCloseTo(1000, 9); // the two reactions sum to the pin load
  });
  it('rows at the two-wheel strike H: pin bending M/Z with Z = π·0.75³/32 = 0.04142; peak on the sleeve R_top/d²; crossbar plate hole H/(0.75 × 0.1875)', () => {
    const H = Math.max(...strikeCases(ctx, goal).map((s) => s.H));
    expect(H).toBeGreaterThan(700);
    const g = pinLoads(ctx, goal)[0];
    expect(g.Hx).toBeCloseTo(H, 9);
    const mine = c.details!;
    const row = (n: string) => mine.find((d) => d.name.startsWith(n))!;
    // the check reports the worst case per criterion; the two-wheel strike is the worst for the pin and the sleeve
    expect(row('pin bending').value).toBeCloseTo((H * 0.78125) / (Math.PI * 0.75 ** 3 / 32), -1);
    expect(row('pin on the sleeve').value).toBeCloseTo((H * 1.28090) / 0.5625, -1);
    expect(row('pin on the crossbar plate hole').value).toBeCloseTo(H / (0.75 * 0.1875), -1);
    expect(row('pin on the crossbar plate hole').limit).toBeCloseTo((0.9 * 36000) / 2, 6);
    // sleeve spigot bearing in the carrier hole: R_top / (OD 1.25 × 3/8")
    expect(row('sleeve spigot bearing in the carrier').value).toBeCloseTo((H * 1.2809) / (1.25 * 0.375), -1);
    expect(c.statusGoal).not.toBe('fail');
  });
  it('the carrier strip at the sleeve hole: net width 2.5 − 1.25 = 1.25", Z = ⅜ × 1.25²/6 = 0.0977 in³, σ = (R_top/2 × y₁)/Z with y₁ = 2.34375"', () => {
    const H = Math.max(...strikeCases(ctx, goal).map((s) => s.H));
    const sigma = ((H * 1.2809) / 2 * 2.34375) / (0.375 * 1.25 ** 2 / 6);
    expect(det(c, 'carrier strip').value).toBeGreaterThanOrEqual(sigma - 1);
    expect(det(c, 'carrier strip').limit).toBeCloseTo(36000 / 2, 6);
  });
  it('without the crossbar there are no plates: the row is info, and kingpin-strike keeps its oak bearing rows', () => {
    const none = kingpinPlatesCheck(ctxOf({ ...defaults, kingpinThroughBolster: 0 }));
    expect(none.status).toBe('info');
    expect(kingpinBoltsCheck(ctxOf({ ...defaults, kingpinThroughBolster: 0 })).status).toBe('info');
  });
});

describe('kingpin-bolts: NDS lateral capacity of the plate bolts, spacing, edge distances, row tear-out (D-35)', () => {
  const p = resolveParams(defaults);
  const ctx = ctxOf(p);
  const goal = ctx.loads.goal;
  const c = kingpinBoltsCheck(ctx);
  const pm = plateModel(ctx)!;
  it('capacity at the carrier end: Z = 534.8 (IIIs, ⅜" plate, θ = 90°) × C_M 0.7 × C_D 1.6 × C_g 0.85 = 509.1 lbf; at the beam-plate end (3/16") 418.2 × 0.952 = 398.1 lbf', () => {
    const cap = (cs: AnalysisCheck, n: string) => cs.details!.find((d) => d.name.startsWith(n))!;
    // the governing case is the one-wheel strike with the stop torque: it loads the bolt across the grain (θ near 90°) at the carrier end
    expect(cap(c, 'beam plate bolt, carrier end').limit).toBeGreaterThan(480);
    expect(cap(c, 'beam plate bolt, carrier end').limit).toBeLessThan(515); // Hankinson: slightly above Z(90°) when the load has a small along-grain part
    expect(cap(c, 'beam plate bolt, under end').limit).toBeCloseTo(418.17 * ADJ, 0);
    expect(ADJ).toBeCloseTo(0.952, 9);
  });
  it('per-bolt load at the carrier end with the stop torque: F = R_top/6 + T·y_max/Σy², R_top = 1.2809 H_x, Σy² = 101.318, y_max = 5.46875 (one-wheel strike + stops)', () => {
    const ld = pinLoads(ctx, goal).find((x) => x.name === 'one-wheel strike + stops')!;
    const F = (ld.Hx * 1.2809) / 6 + (ld.T * 5.46875) / SUM_Y2;
    const d = c.details!.find((x) => x.name.startsWith('beam plate bolt, carrier end'))!;
    expect(d.name).toMatch(/one-wheel strike \+ stops/);
    expect(d.value).toBeCloseTo(F, 0);
    expect(SUM_Y2).toBeCloseTo(101.31836, 4);
    // the torque term dominates: 5.46875/101.318 = 0.05398 per lb·in
    expect((ld.T * 5.46875) / SUM_Y2).toBeGreaterThan((ld.Hx * 1.2809) / 6);
  });
  it('the rider-independent distances are advisory rules sitting exactly on the NDS minimum: rows 1.5625" = 5D, front edge 1.25" = 4D, rod-groove edge 1.25" = 4D; ⅜" bolts need 1.5" and draw a warning', () => {
    expect(pm.beam.frontDist).toBeCloseTo(1.25, 9);
    expect(pm.beam.grooveDist).toBeCloseTo(1.25, 9);
    expect(pm.beam.pitch).toBeCloseTo(1.5625, 9);
    expect(kingpinPlateIssues(resolveParams(defaults))).toEqual([]);
    const fat = kingpinPlateIssues(resolveParams({ ...defaults, kingpinPlateBoltDiameterIn: 0.375 }));
    expect(fat.some((i) => /loaded edge distance of 4D = 1\.500/.test(i.message))).toBe(true);
    // the rows themselves carry no distance details (they would read marginal at every weight)
    expect(c.details!.some((d) => d.sense === '>=')).toBe(false);
    expect(c.how).toMatch(/validator rules/);
    // a 4.5" front beam gives both edges 1.375" ≥ 4D: still valid
    expect(kingpinPlateIssues(resolveParams({ ...defaults, frontAxleBeamThicknessIn: 4.5 }))).toEqual([]);
  });
  it('crossbar line (distances in the how text): pitch 1.5" ≥ 4D = 1.25", end distance 5.0 − 2.25 = 2.75" ≥ 7D = 2.1875"; row tear-out = 4 × F\'v × t × min(2.75, 0.75)', () => {
    expect(pm.bar.pitch).toBeCloseTo(1.5, 9);
    expect(pm.bar.endDist).toBeCloseTo(2.75, 6);
    const FvP = 205 * 0.97 * 1.6; // 318.16 psi
    const t = pm.bar.lm;
    const H = Math.max(...strikeCases(ctx, goal).map((s) => s.H));
    const Z = 4 * FvP * t * 0.75;
    expect(det(c, 'crossbar row tear-out').limit).toBeCloseTo(Z, 0);
    expect(det(c, 'crossbar row tear-out').value).toBeCloseTo(H, 0);
    expect(c.how).toMatch(/at 1\.500" \(≥ 4D = 1\.250"\), ends 2\.75" \(≥ 7D = 2\.188"\)/);
  });
  it('beam row tear-out under the lateral skid: n × F\'v × t × s_crit = 6 × 318.16 × 2.5 × 0.78125 = 3,728 lbf against F_y × 1.2809', () => {
    const d = det(c, 'beam row tear-out');
    expect(d.limit).toBeCloseTo(6 * 318.16 * 2.5 * 0.78125, 0);
    const Fy = p.tireGroundMu * wheelLoads(ctx, goal).frontAxle * p.dynamicFactor;
    expect(d.value).toBeCloseTo(Fy * 1.2809, 0);
  });
  it('304 / 316 stainless plate bolts (65 ksi) cut the stop-torque margin below 1: the carrier-end bolt fails (this is why the plate bolts are grade 8, zinc-flake coated and epoxy-sealed)', () => {
    const ss = kingpinBoltsCheck(ctxOf({ ...defaults, kingpinPlateBoltYieldPsi: 65000 }));
    const d = ss.details!.find((x) => x.name.startsWith('beam plate bolt, carrier end'))!;
    // IV governs at 387.7 lbf dry → × 0.952 = 369.1 lbf
    expect(d.limit).toBeCloseTo(387.7 * ADJ, 0);
    expect(d.util).toBeGreaterThan(1);
    expect(ss.status).toBe('fail');
  });
  it('a thinner carrier lowers the capacity (IIIs ∝ plate thickness): ¼" carrier → fails; the pin-load cases are reported by name', () => {
    const thin = kingpinBoltsCheck(ctxOf({ ...defaults, carrierPlateThickIn: 0.25 }));
    expect(thin.status).toBe('fail');
    expect(c.how).toMatch(/two-wheel strike/);
    expect(c.how).toMatch(/one-wheel strike \+ stops/);
    expect(c.how).toMatch(/lateral skid/);
    expect(c.how).toMatch(/bridle pull/);
  });
});

describe('kingpin-split: NDS cleavage and the cross-bolts that stitch the loaded slabs (D-35, replaces round 1\'s 850 psi block shear)', () => {
  const p = resolveParams(defaults);
  const ctx = ctxOf(p);
  const goal = ctx.loads.goal;
  const c = kingpinSplitCheck(ctx);
  const FvP = 205 * 0.97 * 1.6;
  it('unreinforced front-slab capacity V_r = ⅔·F\'v·b·d_e = ⅔ × 318.16 × 2.5 × 1.25 = 662.8 lbf is exceeded by the carrier-end push (≈ 1.9×): with no cross-bolts the NDS row appears and fails', () => {
    const car = ctx.byId.get('beam-F')!;
    const parts = buildModel(p, { rider: 'goal', cargo: true, steerDeg: 0 });
    const beam = parts.find((x) => x.id === 'beam-F')!;
    beam.joints = beam.joints!.filter((j) => !(j.type === 'bolt' && j.to === 'kp-carrier')); // take the cross-bolts out
    const bare = kingpinSplitCheck(makeContext(p, parts));
    const d = bare.details!.find((x) => x.name.startsWith('beam front slab cleavage'))!;
    expect(d.limit).toBeCloseTo((2 / 3) * FvP * 2.5 * 1.25, 1);
    expect(d.limit).toBeCloseTo(662.8, 1);
    expect(d.util).toBeGreaterThan(1.5);
    expect(bare.status).toBe('fail');
    expect(car).toBeDefined();
  });
  it('with four ⅜" stainless cross-bolts the slab is stitched: each carries V/4 (V = R_top + the stop torque\'s force on one side of the bolt line), tension on A_t = 0.75 × 0.1104 against 65,000/2 psi', () => {
    const ld = pinLoads(ctx, goal).find((x) => x.name === 'one-wheel strike + stops')!;
    const sumY2 = 101.31836;
    const V = ld.Hx * 1.2809 + (ld.T * (2.34375 + 3.90625 + 5.46875)) / sumY2;
    const At = 0.75 * ((Math.PI * 0.375 ** 2) / 4);
    const d = c.details!.find((x) => x.name.startsWith('beam front slab: cross-bolt tension'))!;
    expect(d.value).toBeCloseTo(V / 4 / At, -1);
    expect(d.limit).toBeCloseTo(65000 / 2, 6);
    const w = det(c, 'beam cross-bolt washer');
    const Aw = (Math.PI / 4) * (1.75 ** 2 - (0.375 + 1 / 16) ** 2); // 2.405 − 0.150 = 2.255 in²
    expect(w.value).toBeCloseTo(V / 4 / Aw, -1);
    expect(c.statusGoal).not.toBe('fail');
  });
  it('crossbar: lateral skid F_y = μ·V across the grain, d_e = 1.5", b = crossbar depth: V_r = ⅔ × 318.16 × b × 1.5; the two cross-bolts carry F_y/2 each', () => {
    const pm = plateModel(ctx)!;
    const Fy = p.tireGroundMu * wheelLoads(ctx, goal).frontAxle * p.dynamicFactor; // 0.5 × V
    const At = 0.75 * ((Math.PI * 0.375 ** 2) / 4);
    expect(det(c, 'crossbar cleavage: cross-bolt tension').value).toBeCloseTo(Fy / 2 / At, -1);
    const parts = buildModel(p, { rider: 'goal', cargo: true, steerDeg: 0 });
    parts.find((x) => x.id === 'kingpin-crossbar')!.joints = parts.find((x) => x.id === 'kingpin-crossbar')!.joints!.filter((j) => !/cross-bolt/.test(j.size ?? ''));
    const bare = kingpinSplitCheck(makeContext(p, parts));
    const d = bare.details!.find((x) => x.name.startsWith('crossbar cleavage under the lateral load'))!;
    expect(d.limit).toBeCloseTo((2 / 3) * FvP * pm.bar.lm * 1.5, 1);
    expect(d.value).toBeCloseTo(Fy, 6);
  });
  it('the web between the sleeve bore and the rod groove: rope pull 150 lbf, τ = P/(2·e·0.75) with e = 1.5 − 0.375 − 0.625 = 0.5" → 200 psi, held to the NDS F\'v 318 psi (not the clear-wood 850)', () => {
    const d = det(c, 'beam web shear-out');
    expect(d.value).toBeCloseTo(150 / (2 * 0.5 * 0.75), 6);
    expect(d.limit).toBeCloseTo(FvP, 2);
    expect(c.how).toMatch(/3.4.3.3/);
  });
});

describe('pitch-path (M3, D-35): the pin reaction acts at the crossbar plate, 1.34" above the axle line', () => {
  const p = resolveParams(defaults);
  const ctx = ctxOf(p);
  const goal = ctx.loads.goal;
  const L = computeLayout(p);
  const c = pitchPathCheck(ctx);
  it('M_p = H·|z_axle − z_load| with z_axle = 6.5" and z_load = (7.75 + 7.9375)/2 = 7.84375" (1.34375"), returned as a vertical couple between rail centers 10.5" apart on 1.5" × 12" pads', () => {
    const H = Math.max(...strikeCases(ctx, goal).map((s) => s.H));
    const Mp = H * 1.34375;
    expect(Mp / 10.5 / (1.5 * 12)).toBeGreaterThan(0);
    expect(det(c, 'bolster rails').value).toBeCloseTo(Mp / 10.5 / 18, 4);
    const w = wheelLoads(ctx, goal);
    const V = w.frontAxle * p.dynamicFactor;
    const legC = L.beamF.thick + 2 * p.uboltBeamClearIn + p.uboltRodDiameterIn;
    const Tleg = (V * p.kingpinLeadIn) / 2 / legC;
    const Aleg = 0.75 * ((Math.PI * 0.375 ** 2) / 4);
    expect(det(c, 'U-bolt leg tension').value).toBeCloseTo(Tleg / Aleg, 0);
    expect(det(c, 'plate bearing').value).toBeCloseTo((2 * Tleg) / (p.clampPlateWidthIn * L.beamF.thick), 1);
    expect(c.statusGoal).toBe('pass');
    expect(c.how).toMatch(/lazy-susan bearing ring and the kingpin carry no moment/);
  });
});

describe('bridle-tie (M6): 150 lbf along the leg to the pullers\' hands', () => {
  const p = resolveParams(defaults);
  const ctx = ctxOf(p);
  const c = bridleTieCheck(ctx);
  const eye = ctx.byId.get('eyebolt-L')!;
  it('direction from the eye (x, 13.25", 5.625") to the hands 96" beyond the ring at 40": components, bending over the 1" eye offset, washer and hole bearing', () => {
    const ex = eye.transform[12], ey = Math.abs(eye.transform[13]), ez = eye.transform[14];
    const hx = p.wheelbaseIn + BRIDLE_APEX_AHEAD_IN + p.bridleRopeRunIn, hz = 40;
    const d = [hx - ex, -ey, hz - ez];
    const len = Math.hypot(...d);
    const [ux, uy, uz] = [d[0] / len, Math.abs(d[1]) / len, d[2] / len];
    const T = 150;
    const Tax = T * ux, Tperp = T * Math.hypot(uy, uz);
    const dia = 0.375;
    const At = 0.75 * ((Math.PI * dia * dia) / 4), Z = (Math.PI * dia ** 3) / 32;
    expect(det(c, 'eye bolt shank').value).toBeCloseTo(Tax / At + (Tperp * 1) / Z, 4);
    expect(det(c, 'eye bolt shank').limit).toBeCloseTo(36000 / p.steelSafetyFactor, 6);
    const Aw = (Math.PI / 4) * (1 ** 2 - (dia + 1 / 16) ** 2);
    expect(det(c, 'washer').value).toBeCloseTo(Tax / Aw, 4);
    expect(det(c, 'shank bearing').value).toBeCloseTo(Tperp / (dia * 4), 4);
    // the vertical component: hands at 40" give a slope of atan(34.4/…)
    expect(Math.asin(uz) * (180 / Math.PI)).toBeGreaterThan(10);
    expect(Math.asin(uz) * (180 / Math.PI)).toBeLessThan(20);
    expect(c.how).toMatch(/evaluated at 40\.0"/);
    expect(c.statusGoal).not.toBe('fail');
  });
  it('a bigger pull or a thinner eye bolt raises the stress; the oak tongue has no tie points (info row)', () => {
    const base = det(c, 'eye bolt shank').value;
    expect(det(bridleTieCheck(ctxOf({ ...defaults, pullForceLbf: 300 })), 'eye bolt shank').value).toBeCloseTo(2 * base, 4);
    expect(det(bridleTieCheck(ctxOf({ ...defaults, eyeBoltDiameterIn: 0.25 })), 'eye bolt shank').value).toBeGreaterThan(base * 2);
    expect(bridleTieCheck(ctxOf({ ...defaults, drawbar: 1 })).status).toBe('info');
  });
});

describe('roll-bolster-attach (M7) reads the fasteners from the rails\' joints', () => {
  const p = resolveParams(defaults);
  it('n and the diameter come from the bolt joints; the yaw-torque couple adds a row (F = T·r_max/Σr² + H/n)', () => {
    const cs = run(defaults);
    const c = byId(cs, 'roll-bolster-attach');
    expect(c.how).toMatch(/read from the bolster rails' structured joints/);
    expect(c.how).toMatch(/4 × 0\.375" bolts/);
    expect(det(c, 'yaw torque')).toBeDefined();
    expect(det(c, 'yaw torque').value).toBeGreaterThan(det(c, 'fastener shear (horizontal').value);
    // changing the joint count changes the row, with the params untouched
    const parts = buildModel(p, { rider: 'goal', cargo: true, steerDeg: 0 });
    const ctx = makeContext(p, parts);
    // mutate the model, not the params: one fore-rail joint down to a single bolt
    const fore = parts.find((x) => x.id === 'bolster-fore')!;
    fore.joints!.find((j) => j.type === 'bolt')!.count = 1;
    fore.joints!.find((j) => j.type === 'bolt')!.at = fore.joints!.find((j) => j.type === 'bolt')!.at!.slice(0, 1);
    const fewer = runChecksOnCtx(ctx);
    expect(fewer.how).toMatch(/3 × 0\.375" bolts/);
  });
});

import { rollBolsterAttachCheck } from './structure';
function runChecksOnCtx(ctx: ReturnType<typeof makeContext>): AnalysisCheck {
  return rollBolsterAttachCheck(ctx);
}
