/**
 * Braking and handle checks for the FOOT brake (Phase 3c-3, D-55; handle D-9/D-39): each number below is re-derived by hand from the params, the derived pedal geometry and
 * the model's load cases, independently of the check code, then compared with the check's details. The numbers follow the layout (they are computed from `brakeGeometry`
 * and the model, not typed from a particular deck height).
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, validateParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeCtx } from '../model/build-utils';
import { atPose, brakeGeometry, rot2, type V2 } from '../model/brake';
import { handleGeometry } from '../model/handle';
import { makeContext } from './context';
import { brakeSweep } from './brake';
import { runChecks, type AnalysisCheck } from './index';

const defaults = defaultParams();
const RAD = Math.PI / 180;
const cs = runChecks(defaults, { includeTruck: false });
const byId = (c: AnalysisCheck[], id: string) => c.find((x) => x.id === id)!;
const det = (c: AnalysisCheck[], id: string, name: string) => byId(c, id).details!.find((d) => d.name.includes(name))!;
const mass = (p: Params, view: Parameters<typeof buildModel>[1]) => buildModel(p, view).reduce((s, x) => s + x.massLb, 0);
const run = (q: Partial<Params>) => runChecks({ ...defaults, ...q } as Params, { includeTruck: false });

const g = (() => { const c = makeCtx(defaults); return brakeGeometry(c.p, c.L); })();
const L0 = makeCtx(defaults).L;
const W = mass(defaults, { rider: 'goal', cargo: true });
const muH = Math.min(defaults.brakePadMu, defaults.brakePadMuFouled); // members are sized at the LOWER lining μ (0.35)
const beta = g.beta;
const kF = (mu: number) => Math.cos(beta) + mu * Math.sin(beta);
const circle = (d: number) => (Math.PI / 4) * d * d;
const alAllow = defaults.brakeAluminumYieldPsi / defaults.steelSafetyFactor;
const sin15 = Math.sin(defaults.designSlopeDeg * RAD);

/** Foot force by hand for a cart of weight w at lining friction mu: F = N d (cos β + μ sin β) / (a_app η) + F_spring, N = w sin15° / μ. */
const footByHand = (w: number, mu: number) => ((w * sin15 / mu) * g.d * kF(mu)) / g.aApp / defaults.brakeEfficiency + defaults.brakeSpringForceLbf;

/** The pivot reaction on one arm for a total shoe normal force n, direction sigma, by statics, with the moment balance asserted. */
function reaction(n: number, mu: number, sigma: 1 | -1) {
  const Ns = n / 2;
  const Fs: V2 = [Ns * (-Math.cos(beta) - sigma * mu * Math.sin(beta)), Ns * (-Math.sin(beta) + sigma * mu * Math.cos(beta))];
  const A = atPose(g, 1, g.spring.a);
  const u: V2 = [g.spring.e[0] - A[0], g.spring.e[1] - A[1]];
  const un = Math.hypot(u[0], u[1]);
  const Fsp: V2 = [(g.spring.fApp * u[0]) / un, (g.spring.fApp * u[1]) / un];
  const mom = (pt: V2, F: V2) => (pt[0] - g.P[0]) * F[1] - (pt[1] - g.P[1]) * F[0];
  // foot force per arm from the moment balance about the pivot: mom(shoe) + mom(spring) + mom(bar, foot) = 0
  const foot = -(mom(g.C, Fs) + mom(A, Fsp)) / (g.barApp[0] - g.P[0]) ; // vertical force at the bar, positive up for the arm: solve and flip sign below
  const footDown = Math.abs(foot);
  const Rx = -(Fs[0] + Fsp[0]), Rz = -(Fs[1] + Fsp[1] - footDown);
  const residual = mom(g.C, Fs) + mom(A, Fsp) + mom(g.barApp, [0, -footDown]);
  return { Fs, Fsp, footDown, R: [Rx, Rz] as V2, Rmag: Math.hypot(Rx, Rz), residual };
}

describe('brake ratio and foot force', () => {
  it('brake-ratio is the derived critical-direction ratio, above the 5:1 target with room, and passes; the pedal travel is checked', () => {
    const c = byId(cs, 'brake-ratio');
    expect(c.value).toBeCloseTo(g.ratioCrit, 9);
    expect(c.value).toBeGreaterThan(defaults.brakeLeverRatio);
    expect(c.limit).toBe(defaults.brakeLeverRatio);
    expect(c.status).toBe('pass');
    expect(det(cs, 'brake-ratio', 'rolling forward').value).toBeCloseTo(g.ratioFwd, 9);
    expect(det(cs, 'brake-ratio', 'rolling backward').value).toBeCloseTo(g.ratioRev, 9);
    expect(det(cs, 'brake-ratio', 'pedal travel').value).toBeCloseTo(g.barDrop, 9);
    expect(det(cs, 'brake-ratio', 'pedal travel').limit).toBe(defaults.brakePedalTravelMaxIn);
    expect(c.how).toMatch(/Derived from the pedal geometry/);
  });
  it('the ratio is geometry, not an input: a lower reach lowers it until brake-ratio fails (target not met), and a short travel limit is enforced', () => {
    expect(byId(run({ brakePedalReachIn: 4.5 }), 'brake-ratio').status).not.toBe('pass');
    expect(byId(run({ brakePedalReachIn: 10 }), 'brake-ratio').value).toBeGreaterThan(byId(cs, 'brake-ratio').value);
    expect(byId(run({ brakePedalTravelMaxIn: 1.5 }), 'brake-ratio').status).toBe('fail');
  });
  it('hand calc: F = N d (cos β + μ sin β) / (a_app η) + F_spring at BOTH the wet lining μ 0.45 and the mud-fouled μ 0.35 (pass/fail), for the rider and cargo cases', () => {
    const f = byId(cs, 'brake-force');
    for (const [kind, w] of [['operating', mass(defaults, { rider: 'operating', cargo: true })], ['goal', W]] as const) {
      const fouled = footByHand(w, defaults.brakePadMuFouled);
      const wet = footByHand(w, defaults.brakePadMu);
      expect(f.cases![kind]!.value, kind).toBeCloseTo(Math.max(fouled, wet), 6);
      expect(fouled, kind).toBeGreaterThan(wet);
    }
    const wCargo = mass(defaults, { seat: 'stowed', cargo: true });
    expect(f.cases!.cargo).toBeDefined();
    // the cargo payload is 250 lb on top of the stowed cart: within 3% of the hand figure (the load model may place the payload slightly differently)
    expect(f.cases!.cargo!.value / footByHand(wCargo, defaults.brakePadMuFouled)).toBeGreaterThan(0.97);
    expect(f.cases!.cargo!.value / footByHand(wCargo, defaults.brakePadMuFouled)).toBeLessThan(1.03);
  });
  it('THE REQUIREMENT (D-55): the loaded cart (150 lb rider, 200 lb goal rider, 250 lb cargo case) holds on 15° with at most 60 lbf of FOOT force, at the mud-fouled lining too', () => {
    const f = byId(cs, 'brake-force');
    expect(f.cases!.operating!.limit).toBe(60);
    for (const k of ['operating', 'goal', 'cargo'] as const) {
      expect(f.cases![k]!.value, k).toBeLessThan(60);
      expect(f.cases![k]!.status, k).toBe('pass');
    }
    expect(f.cases!.cargo!.value / 60).toBeLessThan(0.9); // room: the heaviest case is about 50 lbf
    expect(f.status).toBe('pass');
    expect(f.group).toBe('Braking');
    expect(f.how).toMatch(/Only the rear wheels brake/);
    expect(f.how).toMatch(/a foot, not a hand/);
  });
  it('the foot-force limit and the lining μ are enforced: a 40 lbf limit fails the cargo case; a mud-fouled μ of 0.2 fails', () => {
    expect(byId(run({ brakeFootForceLimitLbf: 40 }), 'brake-force').statusCargo).toBe('fail');
    expect(byId(run({ brakePadMuFouled: 0.2 }), 'brake-force').status).toBe('fail');
  });
  it('brake-traction (info): rear-only locked, parked nose-down: μ_ground N_r / (W sinθ)', () => {
    const c = byId(cs, 'brake-traction');
    expect(c.status).toBe('info');
    expect(c.cases!.goal!.value).toBeGreaterThan(0.5);
    expect(c.how).toMatch(/no front brakes/i);
  });
});

describe('brake members (hand calculations at the goal rider, load factor 2)', () => {
  const lam = defaults.brakeLoadFactor;
  const nTot = (lam * W * sin15) / muH;
  const Rf = reaction(nTot, muH, 1), Rr = reaction(nTot, muH, -1);
  const R = Math.max(Rf.Rmag, Rr.Rmag);
  const Ns = nTot / 2;
  it('statics: the moment of the shoe, spring and foot forces about the pivot is zero, and the reaction is mostly the shoe thrust (the foot and spring nearly cancel)', () => {
    expect(Math.abs(Rf.residual)).toBeLessThan(1e-6);
    expect(Math.abs(Rr.residual)).toBeLessThan(1e-6);
    expect(Rf.R[0]).toBeGreaterThan(0.9 * Ns * Math.cos(beta));
    expect(Rf.footDown * 2).toBeGreaterThan(0);
    // both rolling directions: the foot force is the larger rolling forward
    expect(Rf.footDown).toBeGreaterThan(Rr.footDown);
    const f = byId(cs, 'brake-lever');
    expect(f.how).toContain(`N ${nTot.toFixed(1)} lbf`);
    expect(f.how).toContain(`${(2 * Rf.footDown).toFixed(1)} lbf (${Rf.footDown.toFixed(1)} per arm`);
  });
  it('pedal and arms: oak bar bending F L / 4 over S = w h² / 6 between the arm slots; bearing of the arm edge across the grain; the arm net sections', () => {
    const F = 2 * Rf.footDown;
    const span = g.y.arm[0] + g.y.arm[1];
    const S = (defaults.brakePedalDepthIn * defaults.brakePedalHeightIn ** 2) / 6;
    expect(det(cs, 'brake-lever', 'pedal bar bending').value).toBeCloseTo(((F * span) / 4) / S, 0);
    expect(det(cs, 'brake-lever', 'pedal bar bearing').value).toBeCloseTo((F / 2) / (defaults.brakePedalDepthIn * defaults.brakePlateThickIn), 0);
    expect(det(cs, 'brake-lever', 'pivot hole bearing').value).toBeCloseTo(R / (defaults.brakePivotBoltDiameterIn * defaults.brakePlateThickIn), 0);
    expect(byId(cs, 'brake-lever').status).toBe('pass');
    expect(byId(cs, 'brake-lever').group).toBe('Structure');
  });
  it('pivot, bracket and beam bolts: the 3/8" bolt in single shear R / A; the two flange bolts through the axle beam share the thrust; the closed loop in the axle is checked', () => {
    const d = defaults.brakePivotBoltDiameterIn;
    expect(det(cs, 'brake-links', 'pivot bolt single shear').value).toBeCloseTo(R / circle(d), 0);
    expect(det(cs, 'brake-links', 'pivot bolt single shear').limit).toBeCloseTo((0.577 * defaults.ss316BoltYieldPsi) / defaults.steelSafetyFactor, 6);
    // flange bolts: direct share plus the plan couple of the thrust line off their centroid
    const fl = g.tongue.flange;
    const yb = fl.bolts.map((q) => q[1]);
    const yBar = (yb[0] + yb[1]) / 2;
    const yPlane = (g.y.tongue[0] + g.y.tongue[1]) / 2;
    const Rx = Math.abs(Rf.Rmag > Rr.Rmag ? Rf.R[0] : Rr.R[0]);
    const dy = Math.abs(yb[1] - yb[0]) / 2;
    const worst = Rx / 2 + (Rx * (yBar - yPlane)) / (2 * dy);
    expect(det(cs, 'brake-links', 'flange bolts shear').value).toBeCloseTo(worst / circle(defaults.brakeBracketBoltDiameterIn), -1);
    // end distance to the beam rear face is over 4 D, so the bearing is not reduced: R / (d × beam depth)
    const endD = (fl.bolts[0][0] - (L0.beamR.x - L0.beamR.thick / 2)) / defaults.brakeBracketBoltDiameterIn;
    expect(endD).toBeGreaterThan(4);
    expect(det(cs, 'brake-links', 'flange bolt bearing in the oak axle beam').value).toBeCloseTo(worst / (defaults.brakeBracketBoltDiameterIn * L0.beamR.depth), -1);
    // the thrust comes back through the beam: the rod bears sideways on the groove wall and the beam bends in plan, both small
    expect(det(cs, 'brake-links', 'axle rod bearing').value).toBeLessThan(det(cs, 'brake-links', 'axle rod bearing').limit);
    expect(det(cs, 'brake-links', 'axle beam plan bending').util).toBeLessThan(0.2);
    expect(byId(cs, 'brake-links').status).toBe('pass');
  });
  it('beam: plan bending N_s × (shoe y − arm y) over S = (h b³ − (h − 2t)(b − 2t)³) / (6b), plus the vertical friction over its own S; torsion and slot bearing too', () => {
    const b = defaults.brakeBeamSizeIn, h = defaults.brakeBeamHeightIn, t = defaults.brakeBeamWallIn;
    const Sz = (h * b ** 3 - (h - 2 * t) * (b - 2 * t) ** 3) / (6 * b);
    const Sy = (b * h ** 3 - (b - 2 * t) * (h - 2 * t) ** 3) / (6 * h);
    const lever = g.y.shoeC - (g.y.arm[0] + g.y.arm[1]) / 2;
    // the chain uses the worse rolling direction for R only: the beam rows follow the pick, so check against either direction's friction
    const lo = (Ns * lever) / Sz + (muH * Ns * lever) / Sy;
    expect(det(cs, 'brake-beam', 'beam plan bending').value).toBeCloseTo(lo, 0);
    expect(det(cs, 'brake-beam', 'beam plan bending').limit).toBeCloseTo(alAllow, 6);
    expect(det(cs, 'brake-beam', 'beam wall bearing').value).toBeCloseTo(Ns / (defaults.brakePlateThickIn * h), 0);
    expect(byId(cs, 'brake-beam').status).toBe('pass');
  });
  it('shoes: lining pressure N_shoe / (length × width) against the lining limit; a small shoe raises it and fails against a lower limit', () => {
    const len = defaults.brakeLinedShoeLengthIn, wd = defaults.brakeLinedShoeWidthIn;
    expect(det(cs, 'brake-shoes', 'lining contact pressure').value).toBeCloseTo(Ns / (len * wd), 1);
    expect(byId(run({ brakeLinedShoeLengthIn: 2, brakeLinedShoeWidthIn: 1.5 }), 'brake-shoes').util!).toBeGreaterThan(byId(cs, 'brake-shoes').util!);
    expect(byId(run({ brakeLinedShoeLengthIn: 2, brakeLinedShoeWidthIn: 1.5, brakeLiningMaxPsi: 60 }), 'brake-shoes').status).toBe('fail');
  });
  it('parking hold: the hook pulls the stud with F = (N d (cos β + μ sin β) + F_spring a_app) / l, l = pivot to the hook plane; the stud, tooth and hook bolt are checked', () => {
    const hookMid = (g.hook.x0 + g.hook.x1) / 2;
    const lL = g.P[0] - hookMid;
    const FL = (nTot * g.d * kF(muH) + defaults.brakeSpringForceLbf * g.aApp) / lL;
    const ds0 = defaults.brakeLatchPinDiameterIn;
    expect(det(cs, 'park-hold', 'stud shear').value).toBeCloseTo(FL / circle(ds0), 0);
    expect(det(cs, 'park-hold', 'stud bearing on the tooth').value).toBeCloseTo(FL / (ds0 * defaults.brakePlateThickIn), 0);
    expect(det(cs, 'park-hold', 'hook bolt shear').value).toBeCloseTo(FL / circle(defaults.brakeBracketBoltDiameterIn), 0);
    expect(byId(cs, 'park-hold').status).toBe('pass');
    expect(byId(cs, 'park-hold').group).toBe('Structure');
    expect(byId(cs, 'park-hold').how).toMatch(/kick the strap sideways/);
  });
  it('abuse: a 150 lbf stomp is held to yield (design allowable × the steel safety factor) for the pedal, pivot, beam and shoes; it passes or is marginal, not fail', () => {
    const c = byId(cs, 'brake-abuse');
    expect(c.group).toBe('Structure');
    expect(c.status).not.toBe('fail');
    for (const part of ['pedal:', 'pivot:', 'beam:', 'shoes:']) expect(c.details!.some((d) => d.name.startsWith(part)), part).toBe(true);
    const bar = c.details!.find((d) => d.name === 'pedal: pedal bar bending at the foot (oak, between the arms)')!;
    const S = (defaults.brakePedalDepthIn * defaults.brakePedalHeightIn ** 2) / 6;
    expect(bar.value).toBeCloseTo((150 * (g.y.arm[0] + g.y.arm[1])) / 4 / S, 0);
    expect(bar.limit).toBeCloseTo(defaults.steelSafetyFactor * 6460, -1); // oak: the design MOR with the safety factor removed
    expect(c.how).toMatch(/150(\.0)? lbf stomp/);
    // N from the foot: (F a_app − spring) / (d (cos β − μ sin β)) with the design μ
    const mu = defaults.brakePadMu;
    const N = (150 * g.aApp - defaults.brakeSpringForceLbf * g.aApp) / (g.d * (Math.cos(beta) - mu * Math.sin(beta)));
    expect(c.how).toContain(`N = (F a_app − spring) / (d (cos β − μ sin β)) = ${N.toFixed(1)} lbf total`);
  });
  it('abuse is monotone in the stomp: 300 lbf fails, 100 lbf is easier', () => {
    expect(byId(run({ brakeFootAbuseLbf: 300 }), 'brake-abuse').status).toBe('fail');
    const bar = (q: Partial<Params>) => byId(run(q), 'brake-abuse').details!.find((d) => d.name.startsWith('pedal: pedal bar bending'))!.value;
    expect(bar({ brakeFootAbuseLbf: 100 })).toBeLessThan(bar({}));
  });
  it('the load factor drives the member rows but not the foot-force row', () => {
    const a = run({ brakeLoadFactor: 1 }), b = run({ brakeLoadFactor: 3 });
    expect(byId(a, 'brake-force').cases!.goal!.value).toBeCloseTo(byId(b, 'brake-force').cases!.goal!.value, 9);
    expect(byId(b, 'brake-beam').util!).toBeGreaterThan(byId(a, 'brake-beam').util! * 2.5);
  });
  it('dual rows: operating passes and the goal case carries the larger load', () => {
    for (const id of ['brake-lever', 'brake-links', 'brake-beam', 'brake-shoes', 'park-hold']) {
      const c = byId(cs, id);
      expect(c.cases!.goal!.util, id).toBeGreaterThanOrEqual(c.cases!.operating!.util);
      expect(c.statusOperating, id).toBe('pass');
      expect(c.governingLoad, id).toBe('goal');
    }
  });
});

describe('push-handle sockets (50 lbf hold-back pull)', () => {
  it('hand calc: 25 lbf per post, M = 25 × (grip − socket top), σ = M/S on the 15/16" × 1-7/16" post', () => {
    const h = handleGeometry(defaults, L0);
    const c = byId(cs, 'handle-sockets');
    const M = 25 * (defaults.rearHandleHeightIn - h.zTop);
    const S = (defaults.handlePostWidthIn * defaults.handlePostThickIn ** 2) / 6;
    expect(det(cs, 'handle-sockets', 'post bending').value).toBeCloseTo(M / S, 0);
    expect(det(cs, 'handle-sockets', 'post bending').limit).toBeCloseTo(6460, -1);
    const wall = defaults.handleSocketWallIn;
    const tubeS = ((h.socketY * h.socketX ** 3 - (h.socketY - 2 * wall) * (h.socketX - 2 * wall) ** 3) / 12) / (h.socketX / 2);
    expect(det(cs, 'handle-sockets', 'tube bending').value).toBeCloseTo(M / tubeS, 0);
    expect(det(cs, 'handle-sockets', 'tube bending').limit).toBeCloseTo(17500, 0);
    expect(det(cs, 'handle-sockets', 'retaining pin bearing').value).toBeCloseTo(25 / (defaults.handlePinDiameterIn * wall), 0);
    expect(c.status).toBe('pass');
    expect(c.group).toBe('Structure');
    expect(c.load).toBeUndefined();
  });
  it('a bigger pull or a shallower socket raises the stresses; a hold-back that is too big fails', () => {
    const u = (q: Partial<Params>) => byId(runChecks({ ...defaults, ...q }, { includeTruck: false }), 'handle-sockets').util!;
    expect(u({ handleHoldbackLbf: 100 })).toBeGreaterThan(u({}) * 1.9);
    expect(u({ handleSocketDepthIn: 3 })).toBeGreaterThanOrEqual(u({}));
    expect(byId(runChecks({ ...defaults, handleHoldbackLbf: 100, handlePostThickIn: 0.75, handlePostWidthIn: 1, rearHandleHeightIn: 42, handleSocketDepthIn: 3 }, { includeTruck: false }), 'handle-sockets').status).toBe('fail');
  });
});

describe('brake clearance sweep and foot safety', () => {
  const p = resolveParams(defaults);
  const parts = buildModel(p, { rider: 'goal', cargo: true });
  const ctx = makeContext(p, parts);
  const s = brakeSweep(ctx, 10);
  it('FINDING (D-56, deck at 8 in): over 11 poses nothing touches anything, but the shoe beam passes only 1/16 in under the rail (brake-beam vs rail-L), short of the 0.1 in limit: brake-clear FAILS at the defaults', () => {
    expect(s.poses).toBe(11);
    expect(s.minClearanceIn).toBeGreaterThan(0);
    expect(s.minClearanceIn).toBeCloseTo(0.0625, 3);
    expect(s.minClearanceIn).toBeLessThan(defaults.brakeClearanceIn);
    const c = byId(cs, 'brake-clear');
    expect(c.status).toBe('fail');
    expect(c.value).toBeCloseTo(s.minClearanceIn, 6);
    expect(c.how).toMatch(/brake-beam vs rail-L/);
    expect(c.group).toBe('Braking');
  });
  it('the shoes stand a stroke off the tread released (the nearest corner at least 3/4 of it) and touch it applied', () => {
    expect(s.padGapReleasedIn).toBeGreaterThan(0.75 * defaults.brakeShoeTravelIn);
    expect(s.padGapReleasedIn).toBeLessThan(defaults.brakeShoeTravelIn + 0.01);
    expect(Math.abs(s.padGapAppliedIn)).toBeLessThan(1e-6);
  });
  it('ground clearance: the bar assembly is brakeBarClearIn off the ground released (at least the 3 in minimum), the lowest lining corner is above the minimum, the parked bar clears its limit', () => {
    expect(s.armMinZ).toBeGreaterThanOrEqual(defaults.brakeBarClearIn - 1e-6);
    expect(s.armMinZ).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn);
    expect(s.groundMinZ).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn);
    expect(s.groundAppliedZ).toBeGreaterThanOrEqual(defaults.brakeParkedClearIn);
    expect(det(cs, 'brake-clear', 'parked').value).toBeCloseTo(s.groundAppliedZ, 9);
  });
  it('foot safety: the toe guard stands above the bar, and the open gap in front of it to the tire is wide (≥ 3.5") over the whole stroke', () => {
    expect(det(cs, 'brake-clear', 'toe guard height').value).toBe(defaults.brakeToeGuardHeightIn);
    expect(det(cs, 'brake-clear', 'toe guard height').value).toBeGreaterThanOrEqual(defaults.brakeToeGuardMinIn);
    expect(s.guardTireGapIn).toBeGreaterThanOrEqual(defaults.brakeFootGapMinIn);
    expect(byId(run({ brakeToeGuardHeightIn: 1.5 }), 'brake-clear').status).toBe('fail');
    expect(byId(run({ brakeFootGapMinIn: 12 }), 'brake-clear').status).toBe('fail');
  });
  it('the latch stud clears above the hook tooth released and the springs lift the swinging parts (torque over weight torque ≥ 1)', () => {
    expect(det(cs, 'brake-clear', 'stud above the hook tooth').value).toBeGreaterThanOrEqual(0.25);
    expect(det(cs, 'brake-clear', 'return spring torque').value).toBeGreaterThanOrEqual(1);
    expect(byId(run({ brakeSpringForceLbf: 3 }), 'brake-clear').details!.find((d) => d.name.includes('return spring'))!.value).toBeLessThan(det(cs, 'brake-clear', 'return spring torque').value);
  });
  it('the sweep has teeth: a minimum ground clearance above the lining corner is reported (and the validator warns)', () => {
    const low = { ...defaults, minGroundClearanceIn: 3.5 } as Params;
    expect(byId(runChecks(low, { includeTruck: false }), 'brake-clear').status).toBe('fail');
    expect(validateParams(low).some((i) => i.keys.includes('minGroundClearanceIn'))).toBe(true);
    expect(rot2([1, 0], [0, 0], Math.PI / 2)[1]).toBeCloseTo(1, 12);
  });
  it('the sweep is cached by design (rider masses excluded) and fast', () => {
    const t = performance.now();
    const p2 = resolveParams({ ...defaults, riderMassLb: 120 });
    brakeSweep(makeContext(p2, buildModel(p2, { rider: 'goal', cargo: true })), 10);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe('the defaults', () => {
  it('every brake row passes except brake-clear (FINDING: 1/16 in under the rail, see above); the abuse row does not fail', () => {
    const all = runChecks(defaults, { includeTruck: false });
    expect(byId(all, 'brake-clear').status).toBe('fail');
    for (const id of ['brake-ratio', 'brake-force', 'brake-lever', 'brake-links', 'brake-beam', 'brake-shoes', 'park-hold', 'handle-sockets']) expect(byId(all, id).status, id).toBe('pass');
    expect(byId(all, 'brake-abuse').status).not.toBe('fail');
    expect(all.filter((c) => /^(brake|park-hold|handle-sockets)/.test(c.id)).map((c) => c.id).sort()).toEqual(
      ['brake-abuse', 'brake-beam', 'brake-clear', 'brake-force', 'brake-lever', 'brake-links', 'brake-ratio', 'brake-shoes', 'brake-traction', 'handle-sockets', 'park-hold'],
    );
  });
  it('the removed rows are gone: no stop, emergency, bias, heat, front-brake, hip-cable, belt-anchor, stick-cable or ride rows, and no hand-force row', () => {
    const ids = new Set(cs.map((c) => c.id));
    for (const id of ['brake-stop', 'brake-emergency', 'brake-bias', 'brake-heat', 'brake-front', 'hip-cable', 'belt-anchor', 'stick-cable', 'ride-rollover', 'steer-centering', 'ride-steer-effort', 'ride-envelope', 'brake-shaft', 'brake-ratchet'])
      expect(ids.has(id), id).toBe(false);
  });
});
