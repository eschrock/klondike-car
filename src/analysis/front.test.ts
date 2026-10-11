/**
 * Phase 3 workstream A checks (D-31…D-34): steer-stops, kingpin-peak, pitch-path, kingpin-split, bridle-tie, and the
 * roll-bolster-attach row that now reads the fasteners from the model's joints. Every expected value is recomputed here
 * from the part geometry and the formulas in the `how` strings, not copied from the code.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, steerStopPlan, type Params } from '../params';
import { buildModel } from '../model';
import { computeLayout } from '../model/layout';
import { toothThickness } from '../model/stops';
import { BRIDLE_APEX_AHEAD_IN } from '../model/steering';
import { makeContext } from './context';
import { runChecks, type AnalysisCheck } from './index';
import { bridleTieCheck, kingpinPeakCheck, kingpinSplitCheck, pitchPathCheck, rigidPinMoment, rigidPinPeaks, steerStopsCheck } from './front';
import { allowables, obstacleForce, strikeCases, wheelLoads, yawTorque } from './structure';

const defaults = defaultParams();
const run = (p: Params) => runChecks(p, { includeTruck: false });
const byId = (cs: AnalysisCheck[], id: string) => cs.find((c) => c.id === id)!;
const det = (c: AnalysisCheck, name: string) => c.details!.find((d) => d.name.includes(name))!;
const ctxOf = (p: Params, parts = buildModel(resolveParams(p), { rider: 'goal', cargo: true, steerDeg: 0 })) => makeContext(resolveParams(p), parts);

describe('the new front-end checks at the defaults', () => {
  const cs = run(defaults);
  it('exist, are Structure rows with hand arithmetic in `how`, and none fails at any rider case', () => {
    for (const id of ['steer-stops', 'kingpin-peak', 'pitch-path', 'kingpin-split', 'bridle-tie']) {
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
  });
});

describe('steer-stops (M1)', () => {
  const p = resolveParams(defaults);
  const plan = steerStopPlan(p);
  const ctx = ctxOf(p);
  const goal = ctx.loads.goal;
  const c = steerStopsCheck(ctx);
  const al = allowables(ctx);
  const L = computeLayout(p);
  const ringDepth = L.bolster.z1 - L.bolster.z0;
  const h = Math.min(p.steerStopHeightIn, ringDepth - p.sideBearerClearanceIn);
  it('yaw torque: a one-wheel 3" curb strike H_w = V_w·tanφ at the wheel lateral position y_w = 17.75", T = H_w·y_w (6.5k lb·in at the goal rider)', () => {
    const w = wheelLoads(ctx, goal);
    const Vw = w.frontWheel * p.dynamicFactor;
    const hw = obstacleForce(ctx.d.wheelRadiusIn, p.curbHeightIn, Vw).H;
    const y = yawTorque(ctx, goal);
    expect(y.Hw).toBeCloseTo(hw, 6);
    expect(y.yw).toBeCloseTo(17.75, 9);
    expect(y.strike).toBeCloseTo(hw * 17.75, 6);
    expect(y.T).toBeGreaterThan(6000);
    expect(y.T).toBeLessThan(7200);
    expect(y.governing).toBe('one-wheel curb strike');
    // the rope pull at one tie: 150 lbf × the tie's lateral position (13.25") = 1,988 lb·in, well below the strike
    expect(y.rope).toBeCloseTo(p.pullForceLbf * y.yTie, 9);
    expect(y.yTie).toBeCloseTo(13.25, 6);
  });
  it('bearing: F = T₁/r_eff, peak p = 3·T₁·s₂/(h(s₂³−s₁³)) with T₁ = 0.6·T, s = ra…rb, h = the dog height; allowable oak ⊥ 358.45', () => {
    const y = yawTorque(ctx, goal);
    const T1 = p.steerStopLoadShare * y.T;
    const rEff = ((2 / 3) * (plan.rb ** 3 - plan.ra ** 3)) / (plan.rb ** 2 - plan.ra ** 2);
    const F = T1 / rEff;
    const pMax = (3 * T1 * plan.rb) / (h * (plan.rb ** 3 - plan.ra ** 3));
    expect(det(c, 'stop face bearing').value).toBeCloseTo(pMax, 6);
    expect(det(c, 'stop face bearing').limit).toBeCloseTo(358.45, 2);
    expect(pMax).toBeLessThan(al.oakPerp);
    // the wedge splits the force along its two support normals
    const al0 = plan.teeth.find((t) => t.id === 'AL')!;
    expect(det(c, 'rail face').value).toBeCloseTo((F * Math.abs(al0.n.x)) / (al0.railLen * ringDepth), 6);
    expect(det(c, 'crossbar side').value).toBeCloseTo((F * Math.abs(al0.n.y)) / (al0.barLen * ringDepth), 6);
    // bolts: 2 × 3/8" through the dog; shear F/(n·A), tipping about the loaded toe W from the bolt line
    const Ab = (Math.PI * 0.375 ** 2) / 4;
    expect(det(c, 'bolt shear').value).toBeCloseTo(F / (2 * Ab), 6);
    const Tb = (F * (h / 2)) / (plan.W * 2);
    expect(det(c, 'interaction').value).toBeCloseTo(Math.sqrt((F / (2 * Ab) / al.fastShear) ** 2 + (Tb / (0.75 * Ab) / al.fastTens) ** 2), 6);
    const Aw = (Math.PI / 4) * (1.5 ** 2 - (0.375 + 1 / 16) ** 2);
    expect(det(c, 'washer').value).toBeCloseTo(Tb / Aw, 6);
    expect(det(c, 'shear-out').value).toBeCloseTo(F / 2 / (2 * (p.steerStopSizeIn / 2 - 0.375 / 2) * h), 6);
    expect(c.how).toMatch(/r_eff = ⅔/);
  });
  it('the kingpin sees H_w + (2·share − 1)·T/r_eff: with the 60/40 split it stays under the two-wheel strike that governs the kingpin, with equal shares it is just H_w, and with one stop taking all it is not', () => {
    const ctxOp = ctx;
    const y = yawTorque(ctxOp, goal);
    const rEff = ((2 / 3) * (plan.rb ** 3 - plan.ra ** 3)) / (plan.rb ** 2 - plan.ra ** 2);
    const Hgov = Math.max(...strikeCases(ctxOp, goal).map((s) => s.H));
    const K60 = y.Hw + 0.2 * (y.T / rEff);
    // With the 60/40 split the pair stays under the governing strike, so the row does not list it (governs-only detail).
    expect(K60).toBeLessThan(Hgov);
    expect(c.details?.some((d) => d.name.startsWith('net kingpin load'))).toBe(false);
    const half = steerStopsCheck(ctxOf({ ...defaults, steerStopLoadShare: 0.5 }));
    expect(half.details?.some((d) => d.name.startsWith('net kingpin load'))).toBe(false);
    // One stop alone: H_w + T/r_eff exceeds the governing strike, so the detail appears and fails the row.
    const single = steerStopsCheck(ctxOf({ ...defaults, steerStopLoadShare: 1 }));
    expect(det(single, 'net kingpin load').value).toBeCloseTo(y.Hw + y.T / rEff, 6);
    expect(det(single, 'net kingpin load').limit).toBeCloseTo(Hgov, 6);
    expect(single.status).toBe('fail'); // one stop alone would overload the kingpin: the stops must be fitted so that both close
  });
  it('the check reads the dog bolts from the part joints: one bolt instead of two doubles the shear and the tension per bolt', () => {
    const parts = buildModel(p, { rider: 'goal', cargo: true, steerDeg: 0 });
    const dog = parts.find((x) => x.id === 'steer-stop-L')!;
    const j = dog.joints!.find((q) => q.type === 'bolt')!;
    const two = det(steerStopsCheck(makeContext(p, parts)), 'bolt shear').value;
    j.count = 1;
    const one = det(steerStopsCheck(makeContext(p, parts)), 'bolt shear').value;
    expect(one).toBeCloseTo(2 * two, 6);
    j.count = 2;
    j.diaIn = 0.25;
    const thin = det(steerStopsCheck(makeContext(p, parts)), 'bolt shear').value;
    expect(thin).toBeCloseTo(two * (0.375 / 0.25) ** 2, 4);
  });
  it('the rope pull governs the torque when the curb is low and the pull is hard: curb 1", pull 250 lbf → T = 250 × 13.25" = 3,313 lb·in', () => {
    const q = { ...defaults, curbHeightIn: 1, rootHeightIn: 1, pullForceLbf: 250 };
    const x = ctxOf(q);
    const y = yawTorque(x, x.loads.goal);
    expect(y.strike).toBeLessThan(250 * 13.25);
    expect(y.governing).toBe('rope pull at one tie');
    expect(y.T).toBeCloseTo(250 * 13.25, 6);
  });
  it('a stop face that is steel on a thin oak wedge: the thinnest wood behind the face is the 1/2" trim limit', () => {
    expect(toothThickness(plan.a, plan.cb, plan.W, plan.lock, plan.ra)).toBeCloseTo(0.5, 9);
    expect(c.how).toMatch(/Thinnest wood behind the face where the block is trimmed: 0\.50"/);
  });
  it('passes at the operating and the goal rider at the defaults (marginal only through the 60/40 kingpin detail)', () => {
    expect(c.statusOperating).not.toBe('fail');
    expect(c.statusGoal).not.toBe('fail');
    expect(c.details!.filter((d) => d.util > 1)).toEqual([]);
  });
  it('a design whose stops do not fit reports a failing row with the reason instead of throwing', () => {
    const bad = { ...defaults, steerStopSizeIn: 3, steerStopFacePlateIn: 0.25 };
    const row = steerStopsCheck(ctxOf(bad, buildModel(resolveParams(bad), { rider: 'goal', cargo: true, steerDeg: 0 })));
    expect(row.status).toBe('fail');
    expect(row.how).toMatch(/do not fit/);
  });
});

describe('kingpin-peak (M2): rigid pin in the beam and the crossbar', () => {
  const p = resolveParams(defaults);
  const ctx = ctxOf(p);
  const goal = ctx.loads.goal;
  const L = computeLayout(p);
  const D1 = L.beamF.depth, D2 = L.crossbar!.z1 - L.crossbar!.z0, g = L.turntable.z1 - L.turntable.z0;
  it('closed form: a_c = g + (D1 + D2)/2, Σ = D1³ + D2³, peak line load q = (H/D)(1 + 6·a_c·D²/Σ); at D1 = 2.5, D2 = 1.778, g = 0.375: factors 5.43 and 3.25', () => {
    const pk = rigidPinPeaks(100, D1, D2, g);
    expect(pk.ac).toBeCloseTo(0.375 + (2.5 + 1.778) / 2, 3);
    expect(pk.S).toBeCloseTo(2.5 ** 3 + 1.778 ** 3, 2);
    expect(pk.fA).toBeCloseTo(1 + (6 * pk.ac * 2.5 ** 2) / pk.S, 9);
    expect(pk.fA).toBeCloseTo(5.43, 1);
    expect(pk.fB).toBeCloseTo(3.25, 1);
    expect(pk.qA).toBeCloseTo((100 / 2.5) * pk.fA, 9);
    // the peak is more than the average, and the thinner member peaks relatively less
    expect(pk.fA).toBeGreaterThan(pk.fB);
    expect(pk.fB).toBeGreaterThan(1);
  });
  it('equilibrium of the model: each zone carries ±H, the pin moment closes to zero at the far end, and the zone resultants are colinear (no net moment on the pin)', () => {
    const H = 735;
    const zA = -(g / 2 + D1 / 2), zB = g / 2 + D2 / 2;
    const { ac, S } = rigidPinPeaks(H, D1, D2, g);
    // numerical integrals of the two linear distributions
    const integ = (f: (z: number) => number, z0: number, z1: number, n = 2000) => { let s = 0; const dz = (z1 - z0) / n; for (let i = 0; i < n; i++) s += f(z0 + (i + 0.5) * dz) * dz; return s; };
    const qA = (z: number) => H / D1 + (12 * H * ac * (z - zA)) / S;
    const qB = (z: number) => -H / D2 + (12 * H * ac * (z - zB)) / S;
    const FA = integ(qA, -g / 2 - D1, -g / 2), FB = integ(qB, g / 2, g / 2 + D2);
    expect(FA).toBeCloseTo(H, 4);
    expect(FB).toBeCloseTo(-H, 4);
    const MA = integ((z) => qA(z) * z, -g / 2 - D1, -g / 2), MB = integ((z) => qB(z) * z, g / 2, g / 2 + D2);
    expect(MA + MB).toBeCloseTo(0, 3);
    const mom = rigidPinMoment(H, D1, D2, g);
    expect(mom.closure).toBeLessThan(1e-3 * H);
    expect(mom.Mmax).toBeGreaterThan(0);
    // the maximum moment is well below the cantilever H·(stack) and of the order of H × the gap plus a fraction of a member depth
    expect(mom.Mmax).toBeLessThan(H * (g + D1));
  });
  it('rows: peak = q/w on the 1.25" sleeve OD against the dowel-bearing allowable 1,700 psi, pin on the sleeve = q/d against 16.2 ksi, pin bending M/Z', () => {
    const c = kingpinPeakCheck(ctx);
    const cases = strikeCases(ctx, goal);
    const H = Math.max(Math.max(...cases.map((s) => s.H)), p.pullForceLbf);
    const pk = rigidPinPeaks(H, D1, D2, g);
    expect(det(c, 'beam peak').value).toBeCloseTo(pk.qA / 1.25, 6);
    expect(det(c, 'crossbar peak').value).toBeCloseTo(pk.qB / 1.25, 6);
    expect(det(c, 'beam peak').limit).toBeCloseTo((4000 * 0.85) / 2, 6);
    expect(det(c, 'pin on steel sleeve').value).toBeCloseTo(Math.max(pk.qA, pk.qB) / 0.75, 6);
    expect(det(c, 'pin on steel sleeve').limit).toBeCloseTo((0.9 * 36000) / 2, 6);
    const mom = rigidPinMoment(H, D1, D2, g);
    expect(det(c, 'pin bending').value).toBeCloseTo(mom.Mmax / ((Math.PI * 0.75 ** 3) / 32), 4);
    expect(c.statusGoal).not.toBe('fail');
    // the peak is several times the average the 'kingpin-strike' rows report, and that is the honest margin
    const ks = byId(run(defaults), 'kingpin-strike');
    const avg = ks.details!.find((d) => d.name.includes('in the beam'))!.value;
    expect(det(c, 'beam peak').value / avg).toBeCloseTo(pk.fA, 1);
    expect(c.how).toMatch(/peak is 5\.\d+× and 3\.\d+× the average/);
    expect(c.how).toMatch(/over, and the fix is a deeper crossbar/);
  });
  it('without a sleeve the pin bears on the oak directly (w = pin diameter) and there is no pin-on-sleeve row; without the crossbar the row is info only', () => {
    const noSleeve = kingpinPeakCheck(ctxOf({ ...defaults, kingpinSleeveOdIn: 0 }));
    expect(noSleeve.details!.some((d) => d.name.includes('steel sleeve'))).toBe(false);
    const pk = rigidPinPeaks(Math.max(...strikeCases(ctxOf({ ...defaults, kingpinSleeveOdIn: 0 }), ctxOf({ ...defaults, kingpinSleeveOdIn: 0 }).loads.goal).map((s) => s.H)), D1, D2, g);
    expect(det(noSleeve, 'beam peak').value).toBeCloseTo(pk.qA / 0.75, 3);
    const none = kingpinPeakCheck(ctxOf({ ...defaults, kingpinThroughBolster: 0 }));
    expect(none.status).toBe('info');
  });
});

describe('pitch-path (M3)', () => {
  const p = resolveParams(defaults);
  const ctx = ctxOf(p);
  const goal = ctx.loads.goal;
  const L = computeLayout(p);
  const c = pitchPathCheck(ctx);
  it('pitch couple M_p = H·|z_axle − z_beam mid| goes to the fore / aft bolster rails 10.5" apart; trail moment V·1.5" to the U-bolt legs', () => {
    const w = wheelLoads(ctx, goal);
    const H = Math.max(...strikeCases(ctx, goal).map((s) => s.H));
    const Mp = H * Math.abs(L.r - (L.beamF.top + L.beamF.bot) / 2);
    const lever = p.turntableSizeIn - L.bolster.rw;
    expect(lever).toBeCloseTo(10.5, 9);
    expect(det(c, 'bolster rails').value).toBeCloseTo(Mp / lever / (L.bolster.rw * p.turntableSizeIn), 6);
    const V = w.frontAxle * p.dynamicFactor;
    const Mtr = V * p.kingpinLeadIn;
    const legC = L.beamF.thick + 2 * p.uboltBeamClearIn + p.uboltRodDiameterIn; // leg centers
    const Tleg = Mtr / 2 / legC;
    const Aleg = 0.75 * ((Math.PI * 0.375 ** 2) / 4);
    expect(det(c, 'U-bolt leg tension').value).toBeCloseTo(Tleg / Aleg, 0);
    expect(det(c, 'plate bearing').value).toBeCloseTo((2 * Tleg) / (p.clampPlateWidthIn * L.beamF.thick), 1);
    expect(c.statusGoal).toBe('pass');
    expect(c.how).toMatch(/lazy-susan bearing ring and the kingpin carry no moment/);
  });
});

describe('kingpin-split (M4): ligament shear-out', () => {
  const p = resolveParams(defaults);
  const ctx = ctxOf(p);
  const goal = ctx.loads.goal;
  const L = computeLayout(p);
  const c = kingpinSplitCheck(ctx);
  it('beam front ligament 0.75" and web 0.5", crossbar side ligaments (3 − 1.25)/2 = 0.875": τ = F/(2·e·D)', () => {
    const H = Math.max(...strikeCases(ctx, goal).map((s) => s.H));
    const eFront = (p.frontAxleBeamThicknessIn - p.kingpinLeadIn - p.axleDiameterIn / 2 - 1.25 / 2) / 2;
    expect(eFront).toBeCloseTo(0.75, 9);
    expect(det(c, 'beam front').value).toBeCloseTo(H / (2 * eFront * L.beamF.depth), 6);
    const eWeb = p.kingpinLeadIn - p.axleDiameterIn / 2 - 1.25 / 2;
    expect(eWeb).toBeCloseTo(0.5, 9);
    expect(det(c, 'web').value).toBeCloseTo(150 / (2 * eWeb * p.axleDiameterIn), 6);
    const D2 = L.crossbar!.z1 - L.crossbar!.z0;
    const Fy = p.tireGroundMu * wheelLoads(ctx, goal).frontAxle * p.dynamicFactor;
    expect(det(c, 'side ligament').value).toBeCloseTo(Fy / (2 * 0.875 * D2), 6);
    expect(det(c, 'end ligament').value).toBeCloseTo(H / (2 * (L.crossbar!.x1 - L.kx - 0.625) * D2), 6);
    expect(det(c, 'beam front').limit).toBeCloseTo((2000 * 0.85) / 2, 6);
    expect(c.statusGoal).not.toBe('fail');
  });
  it('a narrower crossbar raises the side-ligament shear-out; without the crossbar the row has only the beam ligaments', () => {
    const narrow = kingpinSplitCheck(ctxOf({ ...defaults, kingpinCrossbarWidthIn: 2.25 }));
    expect(det(narrow, 'side ligament').value).toBeGreaterThan(det(c, 'side ligament').value * 1.5);
    const none = kingpinSplitCheck(ctxOf({ ...defaults, kingpinThroughBolster: 0 }));
    expect(none.details!.some((d) => d.name.includes('crossbar'))).toBe(false);
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
