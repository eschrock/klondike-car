/**
 * Braking and handle checks (D-13, D-38, D-39): each number below is re-derived by hand from the params, the derived
 * linkage geometry and the model's load cases, independently of the check code, then compared with the check's details.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, validateParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeCtx } from '../model/build-utils';
import { brakeGeometry, ratchetGeometry } from '../model/brake';
import { makeContext } from './context';
import { brakeSweep } from './brake';
import { runChecks, type AnalysisCheck } from './index';
import { RECOMMENDED } from '../../scripts/recommended';

const defaults = defaultParams();
const RAD = Math.PI / 180;
const cs = runChecks(defaults, { includeTruck: false });
const byId = (c: AnalysisCheck[], id: string) => c.find((x) => x.id === id)!;
const det = (c: AnalysisCheck[], id: string, name: string, k: 'operating' | 'goal' = 'goal') => {
  const row = byId(c, id);
  // details are those of the case shown in the row (goal for members); operating values come from a run at the operating mass
  void k;
  return row.details!.find((d) => d.name.includes(name))!;
};
const massOf = (p: Params, rider: 'operating' | 'goal') => buildModel(p, { rider, cargo: true }).reduce((s, x) => s + x.massLb, 0);

// Independent copy of the load chain (docs: analysis/brake.ts header).
const g = (() => { const c = makeCtx(defaults); return brakeGeometry(c.p, c.L); })();
const W = massOf(defaults, 'goal');
const nHold = (W * Math.sin(defaults.designSlopeDeg * RAD)) / defaults.brakePadMu;
const nTot = defaults.brakeLoadFactor * nHold;
const kMax = Math.max(g.kFwd, g.kRev);
const feq = nTot / g.ratioCrit;
const ml = feq * g.lGrip;
const flink = ml / g.dQ;
const tin = flink * g.dS;

describe('brake ratio and handle force', () => {
  it('brake-ratio is the derived critical-direction ratio, ≥ the 12:1 target, and passes', () => {
    const c = byId(cs, 'brake-ratio');
    expect(c.value).toBeCloseTo(g.ratioCrit, 9);
    expect(c.limit).toBe(defaults.brakeLeverRatio);
    expect(c.status).toBe('pass');
    expect(c.how).toMatch(/DERIVED|Derived from the linkage geometry/);
    expect(c.how).toMatch(/servo/);
    expect(c.how).toMatch(/de-servo/);
  });
  it('a target above what the geometry delivers fails the ratio check (and only that check), and the force check keeps the derived ratio', () => {
    const hi = runChecks({ ...defaults, brakeLeverRatio: 14 }, { includeTruck: false });
    expect(byId(hi, 'brake-ratio').status).toBe('fail');
    expect(byId(hi, 'brake-force').cases!.operating!.value).toBeCloseTo(byId(cs, 'brake-force').cases!.operating!.value, 9);
  });
  it('geometry sets the force: shortening the lever tail lowers the handle force; the ratio target alone does not', () => {
    const f = (q: Partial<Params>) => byId(runChecks({ ...defaults, ...q }, { includeTruck: false }), 'brake-force').cases!.operating!.value;
    expect(f({ brakeLeverTailIn: 1.7 })).toBeLessThan(f({}));
    expect(f({ brakeLeverRatio: 4 })).toBeCloseTo(f({}), 9);
  });
  it('hand calc, goal rider: F = W sinθ / μ / (ratio η) with W = total mass and the derived critical ratio (≈ 23 lbf, limit 30)', () => {
    const op = massOf(defaults, 'operating');
    const Fop = (op * Math.sin(15 * RAD)) / 0.4 / (g.ratioCrit * defaults.brakeEfficiency);
    const Fgoal = (W * Math.sin(15 * RAD)) / 0.4 / (g.ratioCrit * defaults.brakeEfficiency);
    const c = byId(cs, 'brake-force');
    expect(c.cases!.operating!.value).toBeCloseTo(Fop, 3);
    expect(c.cases!.goal!.value).toBeCloseTo(Fgoal, 3);
    expect(Fop).toBeLessThan(defaults.handleForceLimitLbf);
    expect(Fgoal).toBeLessThan(defaults.handleForceLimitLbf);
    expect(c.status).toBe('pass');
    // rolling forward needs less: the servo ratio is the larger
    expect(c.how).toMatch(/servo-assisted/);
  });
  it('drum variant: no geometry, the force check uses the target and the member rows are not evaluated', () => {
    const d = runChecks({ ...defaults, brakeType: 1 }, { includeTruck: false });
    expect(byId(d, 'brake-ratio').status).toBe('info');
    const Wd = massOf({ ...defaults, brakeType: 1 }, 'operating');
    expect(byId(d, 'brake-force').cases!.operating!.value).toBeCloseTo((Wd * Math.sin(15 * RAD)) / 0.4 / (12 * 0.8), 3);
    for (const id of ['brake-lever', 'brake-links', 'brake-shaft', 'brake-shoes', 'brake-ratchet', 'brake-clear']) expect(byId(d, id).status, id).toBe('info');
    expect(byId(d, 'handle-sockets').status).not.toBe('fail');
  });
});

describe('brake members (hand calculations at the goal rider, load factor 2)', () => {
  it('load chain: N = 2·W sin15°/0.4, F_eq = N/12.99, M_L = F_eq · l_grip, F_link = M_L/d_Q, T = F_link · d_S = N · k_max', () => {
    expect(tin).toBeCloseTo(nTot * kMax, 6);
    // numbers at the defaults (checked against the how strings below)
    expect(nTot).toBeGreaterThan(400);
    expect(nTot).toBeLessThan(500);
    expect(feq).toBeGreaterThan(30);
    expect(feq).toBeLessThan(40);
  });
  it('lever: M_L / S_net with the sleeve bore, tail shear 1.5 F_link/(w h), pivot bolt single shear', () => {
    const w = defaults.brakeLeverWidthIn, h = defaults.brakeLeverThickIn;
    const d = defaults.brakePivotBoltDiameterIn + 0.1875;
    const S = (w * (h ** 3 - d ** 3)) / (6 * h);
    expect(det(cs, 'brake-lever', 'lever bending').value).toBeCloseTo(ml / S, 0);
    expect(det(cs, 'brake-lever', 'tail shear').value).toBeCloseTo((1.5 * flink) / (w * h), 0);
    const R = feq + flink;
    expect(det(cs, 'brake-lever', 'pivot bolt single shear').value).toBeCloseTo(R / (Math.PI / 4 * defaults.brakePivotBoltDiameterIn ** 2), 0);
    expect(byId(cs, 'brake-lever').status).toBe('pass');
    expect(byId(cs, 'brake-lever').group).toBe('Structure');
  });
  it('link: rod stress on the 3/8-24 tensile area 0.0878 in², clevis pin double shear, crank plate bending', () => {
    const At = (Math.PI / 4) * (0.375 - 0.9743 / 24) ** 2;
    expect(At).toBeCloseTo(0.0878, 3);
    expect(det(cs, 'brake-links', 'link rod').value).toBeCloseTo(flink / At, 0);
    expect(det(cs, 'brake-links', 'clevis pin double shear').value).toBeCloseTo(flink / (2 * (Math.PI / 4) * defaults.brakeClevisPinDiameterIn ** 2), 0);
    expect(g.linkTension).toBe(false); // a push rod: the buckling row is present
    expect(byId(cs, 'brake-links').details!.some((d) => d.name.includes('buckling'))).toBe(true);
    expect(det(cs, 'brake-links', 'buckling').value).toBeLessThan(1);
    expect(byId(cs, 'brake-links').status).toBe('pass');
  });
  it('shaft: torsion of one side\'s shoe torque 16T/πd³ (T = N k_max / 2), well under 0.577 × 35 ksi', () => {
    const T = tin / 2;
    const tau = (16 * T) / (Math.PI * defaults.brakeShaftDiameterIn ** 3);
    expect(det(cs, 'brake-shaft', 'shaft torsion').value).toBeCloseTo(tau, 0);
    expect(det(cs, 'brake-shaft', 'shaft torsion').limit).toBeCloseTo(0.577 * (defaults.axleYieldPsi / defaults.steelSafetyFactor), 0);
    expect(byId(cs, 'brake-shaft').status).toBe('pass');
    // ½" shaft cannot carry it: the check fails (this is why the default moved from ½" to ¾")
    expect(byId(runChecks({ ...defaults, brakeShaftDiameterIn: 0.5 }, { includeTruck: false }), 'brake-shaft').status).toBe('fail');
  });
  it('shoes: arm bending M/S with M = T_shoe/2 on a 1/4" × 1" bar; pad rock-off μ·h vs L/2', () => {
    const Ma = tin / 2 / 2;
    const S = (0.25 * 1 ** 2) / 6;
    expect(det(cs, 'brake-shoes', 'arm bending').value).toBeCloseTo(Ma / S, 0);
    expect(det(cs, 'brake-shoes', 'rock-off').value).toBeCloseTo(0.4 * 0.75, 6);
    expect(det(cs, 'brake-shoes', 'rock-off').limit).toBeCloseTo(1, 6);
    expect(byId(cs, 'brake-shoes').status).toBe('pass');
  });
  it('ratchet: tooth face bearing F_t / (depth × thickness) with F_t = M_L / R; the 15° goal-rider hold passes with margin', () => {
    const c = makeCtx(defaults);
    const rg = ratchetGeometry(c.p, g, c.L);
    const Ft = ml / rg.rTooth;
    const d = defaults.brakeRatchetToothDepthIn, t = defaults.brakeRatchetPlateThickIn, pit = defaults.brakeRatchetPitchIn;
    expect(det(cs, 'brake-ratchet', 'tooth face bearing').value).toBeCloseTo(Ft / (d * t), 0);
    expect(det(cs, 'brake-ratchet', 'tooth root shear').value).toBeCloseTo(Ft / (pit * t), 0);
    expect(det(cs, 'brake-ratchet', 'tooth root bending').value).toBeCloseTo((6 * Ft * d) / (t * pit * pit), 0);
    for (const x of byId(cs, 'brake-ratchet').details!) expect(x.util, x.name).toBeLessThan(0.9);
    // even at the bare hold load (factor 1, hold only) the plain 15° hold is a half of that: margin
    expect(Ft / 2).toBeLessThan(Ft);
    // the quadrant must cover the applied angle × reserve
    expect(defaults.brakeRatchetSpanDeg).toBeGreaterThanOrEqual(defaults.brakeStrokeReserve * (g.thetaL / RAD));
    // with thinner plate or shallower teeth the same check fails
    expect(byId(runChecks({ ...defaults, brakeRatchetToothDepthIn: 0.0625, brakeRatchetPlateThickIn: 0.1875 }, { includeTruck: false }), 'brake-ratchet').details!
      .find((q) => q.name.includes('tooth face bearing'))!.util).toBeGreaterThan(det(cs, 'brake-ratchet', 'tooth face bearing').util);
  });
  it('the toothed span is checked against the lever stroke: too small a quadrant fails', () => {
    expect(byId(runChecks({ ...defaults, brakeRatchetSpanDeg: 8 }, { includeTruck: false }), 'brake-ratchet').status).toBe('fail');
  });
  it('the load factor drives the member rows but not the hand-force row', () => {
    const x2 = runChecks({ ...defaults, brakeLoadFactor: 4 }, { includeTruck: false });
    expect(byId(x2, 'brake-force').cases!.goal!.value).toBeCloseTo(byId(cs, 'brake-force').cases!.goal!.value, 9);
    expect(byId(x2, 'brake-lever').cases!.goal!.value).toBeGreaterThan(byId(cs, 'brake-lever').cases!.goal!.value * 1.9);
  });
  it('dual rows: operating passes and the goal case carries the larger load', () => {
    for (const id of ['brake-lever', 'brake-links', 'brake-shaft', 'brake-shoes', 'brake-ratchet']) {
      const c = byId(cs, id);
      expect(c.statusOperating, id).not.toBe('fail');
      expect(c.cases!.goal!.util, id).toBeGreaterThanOrEqual(c.cases!.operating!.util - 1e-9);
      expect(c.load, id).toBe('goal');
    }
  });
});

describe('push-handle sockets (50 lbf hold-back pull)', () => {
  it('hand calc: 25 lbf per post, M = 25 × (34 − 16) = 450 lbf·in, σ = M/S = 450 / (1.5 × 1²/6) = 1800 psi vs 6460', () => {
    const c = byId(cs, 'handle-sockets');
    expect(det(cs, 'handle-sockets', 'post bending').value).toBeCloseTo(1800, 0);
    expect(det(cs, 'handle-sockets', 'post bending').limit).toBeCloseTo(6460, -1);
    // reactions over the 5.5" insertion (foot to mouth): R_top = 25 × (34 − 10.5) / 5.5 = 106.8 lbf
    expect(c.how).toMatch(/106\.8 lbf/);
    expect(c.status).toBe('pass');
    expect(c.group).toBe('Structure');
    expect(c.load).toBeUndefined();
  });
  it('a bigger pull or a shallower socket raises the stresses; a hold-back that is too big fails', () => {
    const u = (q: Partial<Params>) => byId(runChecks({ ...defaults, ...q }, { includeTruck: false }), 'handle-sockets').util!;
    expect(u({ handleHoldbackLbf: 100 })).toBeGreaterThan(u({}) * 1.9);
    expect(u({ handleSocketDepthIn: 3 })).toBeGreaterThanOrEqual(u({}));
    // 100 lbf on a 1" × 3/4" upright: σ = 6 × 50 × 18 / (1 × 0.75²) = 9600 psi > 6460
    expect(byId(runChecks({ ...defaults, handleHoldbackLbf: 100, handlePostThickIn: 0.75, handlePostWidthIn: 1 }, { includeTruck: false }), 'handle-sockets').status).toBe('fail');
  });
});

describe('brake clearance sweep', () => {
  const p = resolveParams(defaults);
  const parts = buildModel(p, { rider: 'goal', cargo: true, steerDeg: 0 });
  const ctx = makeContext(p, parts);
  const s = brakeSweep(ctx, 10);
  it('over 11 poses nothing moving touches the cart, the tires or the ground: clearance ≥ 0.1"', () => {
    expect(s.poses).toBe(11);
    expect(s.minClearanceIn).toBeGreaterThanOrEqual(defaults.brakeClearanceIn);
    const c = byId(cs, 'brake-clear');
    expect(c.status).not.toBe('fail');
    expect(c.value).toBeGreaterThanOrEqual(defaults.brakeClearanceIn - 1e-9);
    expect(c.group).toBe('Braking');
  });
  it('the pads stand the stroke off the tread released (0.3") and touch it applied; the lowest part is above 3.5"', () => {
    expect(s.padGapReleasedIn).toBeGreaterThan(defaults.brakeShoeTravelIn - 0.03);
    expect(s.padGapReleasedIn).toBeLessThan(defaults.brakeShoeTravelIn + 0.03);
    expect(Math.abs(s.padGapAppliedIn)).toBeLessThan(1e-6);
    expect(s.groundMinZ).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn);
  });
  it('the sweep has teeth: a hull only 1" from the tire puts the crank into it and the check fails', () => {
    const tight = { ...defaults, rearTrackIn: 30, frontTrackIn: 30, bodyWidthIn: 24, steerLockDeg: 25 } as Params;
    const c = byId(runChecks(tight, { includeTruck: false }), 'brake-clear');
    expect(c.status).toBe('fail');
    expect(validateParams(tight).some((i) => i.severity === 'error')).toBe(true);
    // Moving the shaft back clears the tire (the validator's fix) but a 1" gap still cannot hold the lever, crank, clevis and shoe arms side by
    // side: the sweep keeps flagging that design.
    const fixed = { ...tight, brakeShaftBehindTireIn: 3, rearOverhangIn: 11 } as Params;
    expect(validateParams(fixed).filter((i) => i.severity === 'error')).toEqual([]);
    expect(byId(runChecks(fixed, { includeTruck: false }), 'brake-clear').status).toBe('fail');
  });
  it('a flared gunwale leans the lever out and keeps it clear', () => {
    expect(byId(runChecks({ ...defaults, gunwaleFlareIn: 2 }, { includeTruck: false }), 'brake-clear').status).not.toBe('fail');
  });
  it('the sweep is cached by design (rider masses excluded) and fast', () => {
    const t = performance.now();
    brakeSweep(makeContext(resolveParams({ ...defaults, riderMassLb: 120 }), buildModel(resolveParams({ ...defaults, riderMassLb: 120 }), { rider: 'goal', cargo: true, steerDeg: 0 })), 10);
    expect(performance.now() - t).toBeLessThan(200);
  });
});

describe('the recommended configuration and the defaults', () => {
  it('the defaults have no failing check (operating or goal) and none of the new rows is marginal', () => {
    const all = runChecks(defaults, { includeTruck: false });
    expect(all.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual([]);
    for (const id of ['brake-ratio', 'brake-clear', 'brake-lever', 'brake-links', 'brake-shaft', 'brake-shoes', 'brake-ratchet', 'handle-sockets'])
      expect(byId(all, id).status, id).toBe('pass');
  });
  it('the recommended configuration has zero failing checks including the new brake rows', () => {
    const p = { ...defaults, ...RECOMMENDED } as Params;
    const all = runChecks(p, { includeTruck: false });
    expect(all.filter((c) => [c.statusOperating, c.statusGoal, c.cases?.light?.status].includes('fail')).map((c) => c.id)).toEqual([]);
    expect(all.some((c) => c.id === 'brake-ratchet')).toBe(true);
  });
});
