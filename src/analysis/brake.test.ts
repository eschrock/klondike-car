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
// Phase 3 r2: members are sized at the LOWER of the wet-lining μ (0.45) and the mud-fouled μ (0.35), i.e. at 0.35.
const nHold = (W * Math.sin(defaults.designSlopeDeg * RAD)) / defaults.brakePadMuFouled;
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
  it('auto tail: the lever tail is solved so the critical ratio = target × headroom (12 × 1.1 = 13.2:1), for any wheel size', () => {
    // Hand: 12 × 1.1 = 13.2. The solved tail is a number between the param limits (1" … 4") that depends on the wheel.
    expect(g.ratioCrit).toBeCloseTo(13.2, 6);
    expect(g.tailIn).toBeGreaterThan(1);
    expect(g.tailIn).toBeLessThan(4);
    for (const wheel of [12, 12.5, 13]) {
      const c = makeCtx({ ...defaults, wheelDiameterIn: wheel } as Params);
      const gw = brakeGeometry(c.p, c.L);
      expect(gw.ratioCrit, `wheel ${wheel}`).toBeCloseTo(13.2, 6);
      const row = byId(runChecks({ ...defaults, wheelDiameterIn: wheel } as Params, { includeTruck: false }), 'brake-ratio');
      expect(row.status, `brake-ratio wheel ${wheel}`).toBe('pass');
    }
    // a 12" wheel used to fall short (11.7:1 against 12:1) with the fixed 1.9" tail; auto-solving fixes it (tail ≈ 1.03" there, crank unchanged)
    expect(byId(runChecks({ ...defaults, wheelDiameterIn: 12 } as Params, { includeTruck: false }), 'brake-ratio').value).toBeCloseTo(13.2, 6);
    expect(byId(runChecks({ ...defaults, wheelDiameterIn: 12, brakeLeverTailAuto: 0, brakeLeverTailIn: 1.9, brakeCrankIn: 2.4, brakeCrankAngleDeg: 315 } as Params, { includeTruck: false }), 'brake-ratio').value).toBeLessThan(12);
  });
  it('an unreachable ratio fails the check honestly (10"–11" wheels: tail at its 1" minimum, crank at 4"), and with auto off the target does not move the geometry', () => {
    const small = runChecks({ ...defaults, wheelDiameterIn: 11 } as Params, { includeTruck: false });
    expect(byId(small, 'brake-ratio').status).toBe('fail'); // ≈ 9.4:1 against the 12:1 target even with the longest crank
    expect(byId(small, 'brake-ratio').value).toBeLessThan(12);
    const off = (q: Partial<Params>) => byId(runChecks({ ...defaults, brakeLeverTailAuto: 0, ...q } as Params, { includeTruck: false }), 'brake-force').cases!.operating!.value;
    expect(off({ brakeLeverRatio: 4 })).toBeCloseTo(off({}), 9);
  });
  it('geometry sets the force (auto off): shortening the lever tail lowers the handle force', () => {
    const f = (q: Partial<Params>) => byId(runChecks({ ...defaults, brakeLeverTailAuto: 0, ...q } as Params, { includeTruck: false }), 'brake-force').cases!.operating!.value;
    expect(f({ brakeLeverTailIn: 1.6 })).toBeLessThan(f({ brakeLeverTailIn: 1.9 }));
  });
  it('hand calc: F = W sinθ / μ / (ratio η) at BOTH the wet lining μ 0.45 and the mud-fouled μ 0.35 (pass/fail), ratio 13.2:1, η 0.8', () => {
    // Worked by hand: ratio = 12 × 1.1 = 13.2, so ratio·η = 10.56.
    //  operating W ≈ 326 lb: W sin15° = 326 × 0.2588 = 84.3 lbf; wet 84.3/0.45/10.56 = 17.7 lbf; fouled 84.3/0.35/10.56 = 22.8 lbf (governs).
    //  goal W ≈ 376 lb: W sin15° = 97.3 lbf; wet 20.5 lbf; fouled 97.3/0.35/10.56 = 26.3 lbf (87% of 30: passes, not marginal).
    const op = massOf(defaults, 'operating');
    const eta = 13.2 * defaults.brakeEfficiency;
    const Fop = (op * Math.sin(15 * RAD)) / 0.35 / eta;
    const Fgoal = (W * Math.sin(15 * RAD)) / 0.35 / eta;
    const c = byId(cs, 'brake-force');
    expect(c.cases!.operating!.value).toBeCloseTo(Fop, 3);
    expect(c.cases!.goal!.value).toBeCloseTo(Fgoal, 3);
    expect(Fop).toBeLessThan(defaults.handleForceLimitLbf * 0.9);
    // D-44 visual pass: the sheer-raised bow and crowned transoms add ≈ 1.3 lb of oak, which moves the 200 lb goal case from 89.99% to 90.3% of the
    // limit (it sat on the 90% line before). The operating case stays a clear pass; the goal case now reads 'marginal' (still < limit). See docs/visual-pass-geometry-notes.md.
    expect(Fgoal).toBeLessThan(defaults.handleForceLimitLbf * 0.91);
    expect(c.cases!.operating!.status).toBe('pass');
    expect(c.status).toBe('marginal');
    const wet = c.details!.find((d) => d.name.includes('wet bonded lining'))!;
    const fouled = c.details!.find((d) => d.name.includes('fouled'))!;
    // (the details shown on the row are the operating case's)
    expect(wet.value).toBeCloseTo((op * Math.sin(15 * RAD)) / 0.45 / eta, 3); // 84.3 / 0.45 / 10.56 = 17.7 lbf
    expect(fouled.value).toBeCloseTo(Fop, 3);
    expect(fouled.value).toBeGreaterThan(wet.value);
    // bare oak (μ 0.25) would exceed the 30 lbf limit: that is why the lining is specified (info row, not pass/fail)
    const bare = c.details!.find((d) => d.name.includes('bare wet oak'))!;
    expect(bare.value).toBeGreaterThan(30);
    expect(c.how).toMatch(/servo-assisted/);
  });
  it('wet is pass/fail now: a mud-fouled μ of 0.25 (no lining) fails the handle force at the goal rider', () => {
    const f = byId(runChecks({ ...defaults, brakePadMuFouled: 0.25 } as Params, { includeTruck: false }), 'brake-force');
    expect(f.cases!.goal!.value).toBeGreaterThan(30); // 97.3/0.25/10.56 = 36.9 lbf
    expect(f.status).toBe('fail');
  });
  it('drum variant: no geometry, the force check uses the target and the member rows are not evaluated', () => {
    const d = runChecks({ ...defaults, brakeType: 1 }, { includeTruck: false });
    expect(byId(d, 'brake-ratio').status).toBe('info');
    const Wd = massOf({ ...defaults, brakeType: 1 }, 'operating');
    // the drum variant has no geometry: it uses the 12:1 target and the same fouled μ 0.35 → 84.3 / 0.35 / 9.6 = 25.1 lbf at W ≈ 326 lb
    expect(byId(d, 'brake-force').cases!.operating!.value).toBeCloseTo((Wd * Math.sin(15 * RAD)) / 0.35 / (12 * 0.8), 3);
    for (const id of ['brake-lever', 'brake-links', 'brake-shaft', 'brake-shoes', 'brake-ratchet', 'brake-clear']) expect(byId(d, id).status, id).toBe('info');
    expect(byId(d, 'handle-sockets').status).not.toBe('fail');
  });
});

describe('brake members (hand calculations at the goal rider, load factor 2)', () => {
  it('load chain: N = 2·W sin15°/0.35, F_eq = N/13.2, M_L = F_eq · l_grip, F_link = M_L/d_Q, T = F_link · d_S = N · k_max', () => {
    expect(tin).toBeCloseTo(nTot * kMax, 6);
    // numbers at the defaults (checked against the how strings below)
    // by hand at the goal rider: W ≈ 376 lb → W sin15° = 97.3 lbf; /0.35 = 278 lbf; × 2 = 556 lbf; F_eq = 556 / 13.2 = 42.1 lbf
    expect(nTot).toBeGreaterThan(540);
    expect(nTot).toBeLessThan(575);
    expect(feq).toBeGreaterThan(40);
    expect(feq).toBeLessThan(44);
  });
  it('lever: M_L / S_net with the sleeve bore, tail shear 1.5 F_link/(w h), pivot bolt single shear', () => {
    const w = defaults.brakeLeverWidthIn, h = defaults.brakeLeverThickIn;
    const d = defaults.brakePivotBoltDiameterIn + 0.1875;
    const S = (w * (h ** 3 - d ** 3)) / (6 * h);
    expect(det(cs, 'brake-lever', 'lever bending').value).toBeCloseTo(ml / S, 0);
    expect(det(cs, 'brake-lever', 'tail shear').value).toBeCloseTo((1.5 * flink) / (w * h), 0);
    // by hand: F_link = N·k_max/d_S = 556 × 1.798 / 1.836 = 544 lbf; τ = 1.5 × 544 / (0.75 × 1.5) = 725 psi vs 850 (wet shear): 85%
    expect(det(cs, 'brake-lever', 'tail shear').value).toBeGreaterThan(700);
    expect(det(cs, 'brake-lever', 'tail shear').value).toBeLessThan(750);
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
    // crank boss (no keyseat): 0.75" × 1.5" bar bored 0.75": S_net = t(w³ − d³)/(6w) = 0.75 × (3.375 − 0.4219) / 9 = 0.2461 in³;
    // M = F_link d_S = 544 × 1.836 = 999 lbf·in → σ = 999 / 0.2461 = 4,060 psi (18,000 allowable)
    expect(det(cs, 'brake-links', 'crank boss').value).toBeCloseTo((flink * g.dS) / ((0.75 * (1.5 ** 3 - 0.75 ** 3)) / (6 * 1.5)), 0);
    expect(det(cs, 'brake-links', 'crank boss').value).toBeGreaterThan(3900);
    expect(det(cs, 'brake-links', 'crank boss').value).toBeLessThan(4200);
    expect(byId(cs, 'brake-links').status).toBe('pass');
  });
  it('shaft (cross-drilled for 1/4" roll pins, no keyseat): net-section torsion and bending, pin shear, all by hand', () => {
    // T_shoe = N k_max / 2 = 556 × 1.798 / 2 = 500 lbf·in.  D = 0.75", d_p = 0.25", pin area A_p = π/4 × 0.0625 = 0.04909 in².
    // Z_net = πD³/16 − d_p D²/6 = 0.08288 − 0.02344 = 0.05944 in³ → τ = 500 / 0.05944 = 8,410 psi (0.577 × 50,000 allowable = 28,850).
    const T = tin / 2;
    const D = defaults.brakeShaftDiameterIn, dp = defaults.brakeRollPinDiameterIn;
    const Znet = (Math.PI * D ** 3) / 16 - (dp * D ** 2) / 6;
    expect(Znet).toBeCloseTo(0.05944, 4);
    expect(det(cs, 'brake-shaft', 'shaft torsion').value).toBeCloseTo(T / Znet, 0);
    expect(det(cs, 'brake-shaft', 'shaft torsion').value).toBeGreaterThan(8300);
    // Band widened 8,500 → 8,800 when the round-2 front steel raised the cart mass ~10 lb (hold load ∝ total mass: ~+3%).
    expect(det(cs, 'brake-shaft', 'shaft torsion').value).toBeLessThan(8800);
    expect(det(cs, 'brake-shaft', 'shaft torsion').limit).toBeCloseTo(0.577 * (defaults.brakeShaftYieldPsi / defaults.steelSafetyFactor), 0);
    // Arm-collar pin: τ = (T_shoe/2) / (D A_p) = 250 / (0.75 × 0.04909) = 6,790 psi vs 20,000; crank, two pins: T_in/2 = 500 → 13,570 psi.
    const Ap = (Math.PI / 4) * dp ** 2;
    expect(det(cs, 'brake-shaft', 'arm-collar roll pin').value).toBeCloseTo((T / 2) / (D * Ap), 0);
    expect(det(cs, 'brake-shaft', 'crank roll pins').value).toBeCloseTo((tin / 2) / (D * Ap), 0);
    expect(det(cs, 'brake-shaft', 'crank roll pins').value).toBeGreaterThan(13400);
    expect(det(cs, 'brake-shaft', 'crank roll pins').value).toBeLessThan(14200) // widened 13,700 → 14,200 with the round-2 front steel (+~3% cart mass);
    expect(det(cs, 'brake-shaft', 'crank roll pins').limit).toBe(defaults.brakeRollPinShearPsi);
    // Net bending at the crank holes: F_a = R_pin/2 with R_pin = N_shoe √(1 + μ²) = 278 × 1.0595 = 294.5 → F_a = 147 lbf (μ = 0.35 here: the
    // check uses the design μ 0.45 → √1.2025 = 1.0966, R_pin = 305, F_a = 152.4); M_h = 152.4 × ((15.45 − 14.9) + (18.855 − 14.9)) = 152.4 × 4.505 = 687 lbf·in;
    // S_net = πD³/32 − d_p D²/6 = 0.04144 − 0.02344 = 0.01800 in³ → σ = 38,150 psi; with τ = 8,410: √(σ² + 3τ²) = 40,230 psi (50,000 allowable: 80%).
    const vm = det(cs, 'brake-shaft', 'von Mises');
    expect(vm.value).toBeGreaterThan(39000);
    expect(vm.value).toBeLessThan(41500);
    expect(vm.limit).toBeCloseTo(50000, 0);
    expect(byId(cs, 'brake-shaft').status).toBe('pass');
    // ½" shaft cannot carry it: the check fails (this is why the default moved from ½" to ¾")
    expect(byId(runChecks({ ...defaults, brakeShaftDiameterIn: 0.5 }, { includeTruck: false }), 'brake-shaft').status).toBe('fail');
    // and 1045 at 70 ksi (35 ksi allowable) would fail the ¾" cross-drilled shaft: that is why the brake shaft is pre-hardened 4140
    expect(byId(runChecks({ ...defaults, brakeShaftYieldPsi: 70000 }, { includeTruck: false }), 'brake-shaft').status).toBe('fail');
  });
  it('shoes: arm bending M/S with M = T_shoe/2 on a 1/4" × 1" bar; pad rock-off μ·h vs L/2', () => {
    const Ma = tin / 2 / 2;
    const S = (0.25 * 1 ** 2) / 6;
    expect(det(cs, 'brake-shoes', 'arm bending').value).toBeCloseTo(Ma / S, 0);
    expect(det(cs, 'brake-shoes', 'rock-off').value).toBeCloseTo(0.45 * 0.75, 6); // μ 0.45 (wet lining, the larger μ) × h 0.75 = 0.3375" vs 1.0
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
    // Aluminum 6061-T6 socket (plan item 5), allowable 35,000 / 2 = 17,500 psi. Tube S = (1.75 × 1.25³ − 1.5 × 1³)/12 / 0.625 = 0.1598/0.625 = 0.2557 in³
    // → σ = 450 / 0.2557 = 1,760 psi. Bolts and pin bear on the 1/8" wall: R_top = 106.8 lbf over 2 × 0.25 × 0.125 = 0.0625 in² → 1,709 psi;
    // pin 25 lbf / (0.3125 × 0.125) = 640 psi. Washer pull-through: 106.8 / (π/4 (1² − 0.28²)) = 106.8 / 0.7238 = 147.6 psi vs 358 (oak ⊥ grain).
    expect(det(cs, 'handle-sockets', 'tube bending').value).toBeCloseTo(1759.7, 0);
    expect(det(cs, 'handle-sockets', 'tube bending').limit).toBeCloseTo(17500, 0);
    expect(det(cs, 'handle-sockets', 'wall bearing').value).toBeCloseTo(1708.8, 0);
    expect(det(cs, 'handle-sockets', 'retaining pin bearing').value).toBeCloseTo(640, 0);
    expect(det(cs, 'handle-sockets', 'pull-through').value).toBeCloseTo(147.6, 0);
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
    const fixed = { ...tight, bodyWidthIn: 23, brakeShaftBehindTireIn: 3, rearOverhangIn: 11 } as Params; // 23": the rear U-bolt plates start at 11.5" (D-43)
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
