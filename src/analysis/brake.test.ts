/**
 * Braking and handle checks for the handler's basic rear brake (Phase 3c-1, D-53; handle D-9/D-39): each number below is re-derived by hand from the params, the
 * derived linkage geometry and the model's load cases, independently of the check code, then compared with the check's details.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, validateParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeCtx } from '../model/build-utils';
import { brakeGeometry } from '../model/brake';
import { makeContext } from './context';
import { brakeSweep } from './brake';
import { runChecks, type AnalysisCheck } from './index';

const defaults = defaultParams();
const RAD = Math.PI / 180;
const cs = runChecks(defaults, { includeTruck: false });
const byId = (c: AnalysisCheck[], id: string) => c.find((x) => x.id === id)!;
const det = (c: AnalysisCheck[], id: string, name: string) => byId(c, id).details!.find((d) => d.name.includes(name))!;
const massOf = (p: Params, rider: 'operating' | 'goal') => buildModel(p, { rider, cargo: true }).reduce((s, x) => s + x.massLb, 0);
const run = (q: Partial<Params>) => runChecks({ ...defaults, ...q } as Params, { includeTruck: false });

// Independent copy of the load chain (docs: analysis/brake.ts header).
const g = (() => { const c = makeCtx(defaults); return brakeGeometry(c.p, c.L); })();
const W = massOf(defaults, 'goal');
// Members are sized at the LOWER of the wet-lining μ (0.45) and the mud-fouled μ (0.35), i.e. at 0.35.
const nHold = (W * Math.sin(defaults.designSlopeDeg * RAD)) / defaults.brakePadMuFouled;
const nTot = defaults.brakeLoadFactor * nHold;
const Fc = nTot * (Math.cos(g.bl.beta) + defaults.brakePadMu * Math.sin(g.bl.beta));
const flink = Fc / g.ux;
const ml = flink * g.dQ;
const feq = ml / g.lGrip;
const circle = (d: number) => (Math.PI / 4) * d * d;
const alAllow = defaults.brakeAluminumYieldPsi / defaults.steelSafetyFactor;

describe('brake ratio and handle force', () => {
  it('brake-ratio is the derived critical-direction ratio, above the 10:1 target with room, and passes', () => {
    const c = byId(cs, 'brake-ratio');
    expect(c.value).toBeCloseTo(g.ratioCrit, 9);
    expect(c.value).toBeGreaterThan(defaults.brakeLeverRatio);
    expect(c.limit).toBe(defaults.brakeLeverRatio);
    expect(c.status).toBe('pass');
    expect(det(cs, 'brake-ratio', 'rolling forward').value).toBeCloseTo(g.ratioFwd, 9);
    expect(det(cs, 'brake-ratio', 'rolling backward').value).toBeCloseTo(g.ratioRev, 9);
    expect(det(cs, 'brake-ratio', 'grip travel').value).toBeCloseTo(g.gripTravelIn, 9);
    expect(det(cs, 'brake-ratio', 'grip travel').limit).toBe(defaults.brakeGripTravelMaxIn);
    expect(c.how).toMatch(/DERIVED|Derived from the lever \/ link \/ beam geometry/);
  });
  it('the ratio is geometry, not an input: a longer lever tail lowers it until brake-ratio fails (target not met), and a longer grip travel limit is enforced', () => {
    expect(byId(run({ brakeLeverTailIn: 4 }), 'brake-ratio').status).toBe('fail');
    expect(byId(run({ brakeLeverTailIn: 1.25 }), 'brake-ratio').value).toBeGreaterThan(byId(cs, 'brake-ratio').value);
    expect(byId(run({ brakeGripTravelMaxIn: 4 }), 'brake-ratio').status).not.toBe('pass');
  });
  it('hand calc: F = W sinθ / μ / (ratio η) at BOTH the wet lining μ 0.45 and the mud-fouled μ 0.35 (pass/fail), with the derived ratio and η 0.8', () => {
    const f = byId(cs, 'brake-force');
    for (const [kind, mass] of [['operating', massOf(defaults, 'operating')], ['goal', W]] as const) {
      const down = mass * Math.sin(defaults.designSlopeDeg * RAD);
      const eta = g.ratioCrit * defaults.brakeEfficiency;
      const fouled = down / defaults.brakePadMuFouled / eta;
      const wet = down / defaults.brakePadMu / eta;
      expect(f.cases![kind]!.value, kind).toBeCloseTo(Math.max(fouled, wet), 6);
      expect(fouled, kind).toBeGreaterThan(wet);
    }
  });
  it('THE REQUIREMENT (D-53): the loaded cart (150 lb rider and the 200 lb goal) holds on 15° with at most 30 lbf at the handle, at the mud-fouled lining too', () => {
    const f = byId(cs, 'brake-force');
    expect(f.cases!.operating!.limit).toBe(30);
    expect(f.cases!.operating!.value).toBeLessThan(30);
    expect(f.cases!.goal!.value).toBeLessThan(30);
    expect(f.cases!.goal!.value / 30).toBeLessThan(0.85); // room: about 20 lbf
    expect(f.status).toBe('pass');
    expect(f.group).toBe('Braking');
    expect(f.how).toMatch(/Only the rear wheels brake/);
  });
  it('bare wet oak (no lining, μ 0.25) is shown for information only', () => {
    const bare = det(cs, 'brake-force', 'bare wet oak');
    expect(bare.value).toBeGreaterThan(det(cs, 'brake-force', 'mud / slush-fouled').value);
  });
  it('wet is pass/fail: a mud-fouled μ of 0.25 (no lining) pushes the handle force up (it would still hold within 30 lbf only with the lining)', () => {
    const bad = byId(run({ brakePadMuFouled: 0.2 }), 'brake-force');
    expect(bad.status).toBe('fail');
  });
  it('brake-traction (info): rear-only locked, parked nose-down: μ_ground N_r / (W sinθ)', () => {
    const c = byId(cs, 'brake-traction');
    expect(c.status).toBe('info');
    expect(c.cases!.goal!.value).toBeGreaterThan(0.5);
    expect(c.how).toMatch(/no front brakes/i);
  });
});

describe('brake members (hand calculations at the goal rider, load factor 2)', () => {
  it('load chain: N = 2·W sin15°/0.35, F_c = N (cos β + μ sin β), F_link = F_c/u_x, M_L = F_link·d_Q, F_eq = M_L / l_grip', () => {
    const c = byId(cs, 'brake-lever');
    expect(c.how).toContain(`${nHold.toFixed(1)} lbf total shoe normal force`);
    expect(c.how).toContain(`N ${nTot.toFixed(1)} lbf`);
    expect(c.how).toContain(`F_link = F_c / u_x = ${Fc.toFixed(1)} / ${g.ux.toFixed(3)} = ${flink.toFixed(1)} lbf`);
    expect(c.how).toContain(`${feq.toFixed(1)} lbf`);
    expect(c.how).toContain(`${ml.toFixed(1)} lbf·in`);
    // The hand-equivalent force at the λ = 2 hold (about 40 lbf) is well above the plain-hold 20 lbf.
    expect(feq).toBeGreaterThan(30);
    expect(feq).toBeLessThan(60);
  });
  it('lever: bar bending with the pivot hole, M_L / S_net, S_net = t(w³ − d³)/(6w); the pivot reaction is the hand plus the link force, pushed forward into the transom', () => {
    const t = defaults.brakeBarThickIn, w = defaults.brakeLeverWidthIn, d = defaults.brakePivotBoltDiameterIn;
    const Snet = (t * (w ** 3 - d ** 3)) / (6 * w);
    expect(det(cs, 'brake-lever', 'lever bar bending').value).toBeCloseTo(ml / Snet, 0);
    expect(det(cs, 'brake-lever', 'lever bar bending').limit).toBeCloseTo(alAllow, 6);
    const Rx = feq + flink * g.ux;
    const Rz = flink * ((g.B1[1] - g.T1[1]) / g.linkLen);
    const R = Math.hypot(Rx, Rz);
    expect(det(cs, 'brake-lever', 'pivot bolt double shear').value).toBeCloseTo(R / (2 * circle(d)), 0);
    expect(det(cs, 'brake-lever', 'pivot bolt bearing on the lever bar').value).toBeCloseTo(R / (d * t), 0);
    const area = 2 * (g.y.ear[1] + 0.5) * (g.base.z1 - g.base.z0);
    expect(det(cs, 'brake-lever', 'bracket plate bearing on the transom').value).toBeCloseTo(Rx / area, 0);
    expect(byId(cs, 'brake-lever').status).toBe('pass');
  });
  it('links: two bars share F_link in compression (net section), the pins are in double shear, the bars do not buckle (Johnson, K = 1)', () => {
    const t = defaults.brakeBarThickIn, w = defaults.brakeBarWidthIn, d = defaults.brakeClevisPinDiameterIn;
    expect(det(cs, 'brake-links', 'link bars, net section').value).toBeCloseTo(flink / (2 * (w - d) * t), 0);
    expect(det(cs, 'brake-links', 'link pins double shear').value).toBeCloseTo(flink / (2 * circle(d)), 0);
    expect(det(cs, 'brake-links', 'buckling').value).toBeLessThan(0.2);
    expect(byId(cs, 'brake-links').status).toBe('pass');
  });
  it('beam: plan bending at the center = (F_c/2)·(shoe center y), S = (b⁴ − (b − 2t)⁴)/(6b); the keeper strap and its screws are checked too', () => {
    const b = defaults.brakeBeamSizeIn, t = defaults.brakeBeamWallIn;
    const S = (b ** 4 - (b - 2 * t) ** 4) / (6 * b);
    const ry = defaults.rearTrackIn / 2;
    expect(det(cs, 'brake-beam', 'beam bending at the center').value).toBeCloseTo(((Fc / 2) * ry) / S, 0);
    expect(det(cs, 'brake-beam', 'beam bending at the center').limit).toBeCloseTo(alAllow, 6);
    expect(det(cs, 'brake-beam', 'keeper screws').value).toBeLessThan(1);
    expect(det(cs, 'brake-beam', 'keeper strap bending').value).toBeLessThan(det(cs, 'brake-beam', 'keeper strap bending').limit);
    expect(byId(cs, 'brake-beam').status).toBe('pass');
  });
  it('shoes: lining pressure N_shoe / (length × width) against the lining limit; a small shoe raises it and fails against a lower limit', () => {
    const len = defaults.brakeLinedShoeLengthIn, wd = defaults.brakeLinedShoeWidthIn;
    expect(det(cs, 'brake-shoes', 'lining contact pressure').value).toBeCloseTo((nTot / 2) / (len * wd), 1);
    expect(byId(run({ brakeLinedShoeLengthIn: 2, brakeLinedShoeWidthIn: 1.5 }), 'brake-shoes').util!).toBeGreaterThan(byId(cs, 'brake-shoes').util!);
    expect(byId(run({ brakeLinedShoeLengthIn: 2, brakeLinedShoeWidthIn: 1.5, brakeLiningMaxPsi: 60 }), 'brake-shoes').status).toBe('fail');
  });
  it('parking hold: the hitch pin carries F_link·d_Q / R_p in single shear, with holes past the design one to take up wear', () => {
    const Fpin = (flink * g.dQ) / defaults.brakeParkRadiusIn;
    expect(det(cs, 'park-hold', 'parking pin single shear').value).toBeCloseTo(Fpin / circle(defaults.brakeClevisPinDiameterIn), 0);
    expect(det(cs, 'park-hold', 'wear take-up').value).toBeCloseTo(3 * (defaults.brakeParkPitchIn / defaults.brakeParkRadiusIn) / RAD, 6);
    expect(byId(cs, 'park-hold').status).toBe('pass');
    expect(byId(cs, 'park-hold').group).toBe('Structure');
  });
  it('abuse: a 100 lbf pull at the grip is held to yield (design allowable × the steel safety factor) for the lever, link, beam and shoes; it passes or is marginal, not fail', () => {
    const c = byId(cs, 'brake-abuse');
    expect(c.group).toBe('Structure');
    expect(c.status).not.toBe('fail');
    for (const part of ['lever:', 'link:', 'beam:', 'shoes:']) expect(c.details!.some((d) => d.name.startsWith(part)), part).toBe(true);
    const lv = c.details!.find((d) => d.name === 'lever: lever bar bending at the pivot (net of the bolt hole)')!;
    expect(lv.limit).toBeCloseTo(defaults.brakeAluminumYieldPsi, 0);
    const t = defaults.brakeBarThickIn, w = defaults.brakeLeverWidthIn, d = defaults.brakePivotBoltDiameterIn;
    expect(lv.value).toBeCloseTo((100 * g.lGrip) / ((t * (w ** 3 - d ** 3)) / (6 * w)), 0);
    expect(c.how).toMatch(/100(\.0)? lbf/);
  });
  it('abuse is monotone in the pull: 200 lbf fails, 50 lbf is easier', () => {
    expect(byId(run({ brakeAbuseLbf: 200 }), 'brake-abuse').status).toBe('fail');
    expect(byId(run({ brakeAbuseLbf: 50 }), 'brake-abuse').util!).toBeLessThan(byId(cs, 'brake-abuse').util!);
  });
  it('the load factor drives the member rows but not the hand-force row', () => {
    const a = run({ brakeLoadFactor: 1 }), b = run({ brakeLoadFactor: 3 });
    expect(byId(a, 'brake-force').cases!.goal!.value).toBeCloseTo(byId(b, 'brake-force').cases!.goal!.value, 9);
    expect(byId(b, 'brake-lever').util!).toBeGreaterThan(byId(a, 'brake-lever').util! * 2.5);
  });
  it('dual rows: operating passes and the goal case carries the larger load', () => {
    for (const id of ['brake-lever', 'brake-links', 'brake-beam', 'brake-shoes', 'park-hold']) {
      const c = byId(cs, id);
      expect(c.cases!.goal!.util, id).toBeGreaterThanOrEqual(c.cases!.operating!.util); // park-hold's governing detail (wear take-up) does not depend on the rider
      expect(c.statusOperating, id).toBe('pass');
      expect(c.governingLoad, id).toBe('goal');
    }
  });
});

describe('push-handle sockets (50 lbf hold-back pull)', () => {
  it('hand calc: 25 lbf per post, M = 25 × (34 − 16) = 450 lbf·in, σ = M/S = 450 / (1.4375 × 0.9375²/6) = 2137 psi vs 6460', () => {
    const c = byId(cs, 'handle-sockets');
    expect(det(cs, 'handle-sockets', 'post bending').value).toBeCloseTo(450 / ((1.4375 * 0.9375 ** 2) / 6), 0);
    expect(det(cs, 'handle-sockets', 'post bending').limit).toBeCloseTo(6460, -1);
    expect(det(cs, 'handle-sockets', 'tube bending').value).toBeCloseTo(1759.7, 0);
    expect(det(cs, 'handle-sockets', 'tube bending').limit).toBeCloseTo(17500, 0);
    expect(det(cs, 'handle-sockets', 'wall bearing').value).toBeCloseTo(1708.8, 0);
    expect(det(cs, 'handle-sockets', 'retaining pin bearing').value).toBeCloseTo(640, 0);
    expect(det(cs, 'handle-sockets', 'pull-through').value).toBeCloseTo(147.6, 0);
    expect(c.how).toMatch(/106\.8 lbf/);
    expect(c.status).toBe('pass');
    expect(c.group).toBe('Structure');
    expect(c.load).toBeUndefined();
  });
  it('a bigger pull or a shallower socket raises the stresses; a hold-back that is too big fails', () => {
    const u = (q: Partial<Params>) => byId(runChecks({ ...defaults, ...q }, { includeTruck: false }), 'handle-sockets').util!;
    expect(u({ handleHoldbackLbf: 100 })).toBeGreaterThan(u({}) * 1.9);
    expect(u({ handleSocketDepthIn: 3 })).toBeGreaterThanOrEqual(u({}));
    expect(byId(runChecks({ ...defaults, handleHoldbackLbf: 100, handlePostThickIn: 0.75, handlePostWidthIn: 1 }, { includeTruck: false }), 'handle-sockets').status).toBe('fail');
  });
});

describe('brake clearance sweep', () => {
  const p = resolveParams(defaults);
  const parts = buildModel(p, { rider: 'goal', cargo: true, steerDeg: 0 });
  const ctx = makeContext(p, parts);
  const s = brakeSweep(ctx, 10);
  it('over 11 poses nothing moving touches the cart (outside the rail notch it rides in), the tires or the ground: clearance ≥ 0.1"', () => {
    expect(s.poses).toBe(11);
    expect(s.minClearanceIn).toBeGreaterThanOrEqual(defaults.brakeClearanceIn);
    const c = byId(cs, 'brake-clear');
    expect(c.status).not.toBe('fail');
    expect(c.value).toBeGreaterThanOrEqual(defaults.brakeClearanceIn - 1e-9);
    expect(c.group).toBe('Braking');
  });
  it('the shoes stand the stroke off the tread released (0.3125") and touch it applied; the lowest brake part is the keeper strap, above 3.5"', () => {
    expect(s.padGapReleasedIn).toBeGreaterThan(defaults.brakeShoeTravelIn - 0.03);
    expect(s.padGapReleasedIn).toBeLessThan(defaults.brakeShoeTravelIn + 0.03);
    expect(Math.abs(s.padGapAppliedIn)).toBeLessThan(1e-6);
    expect(s.groundMinZ).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn);
  });
  it('the beam has running clearance in its notch at both ends of the stroke', () => {
    const rear = det(cs, 'brake-clear', 'notch rear wall');
    const front = det(cs, 'brake-clear', 'notch front wall');
    expect(rear.value).toBeGreaterThanOrEqual(0.06);
    expect(front.value).toBeGreaterThanOrEqual(0.06);
    expect(rear.value).toBeCloseTo(0.125, 2);
  });
  it('the lever bar stays outside the 3/16"–1/2" finger band to the bracket plate; a standoff of 1/4" is flagged', () => {
    expect(det(cs, 'brake-clear', 'lever bar edge').value).toBeGreaterThanOrEqual(0.5);
    const tight = byId(run({ brakeLeverStandoffIn: 0.25 }), 'brake-clear');
    expect(tight.status).toBe('fail');
  });
  it('the sweep has teeth: a keeper strap under the ground clearance is reported', () => {
    const low = { ...defaults, minGroundClearanceIn: 5.6 } as Params;
    expect(byId(runChecks(low, { includeTruck: false }), 'brake-clear').status).toBe('fail');
    expect(validateParams(low).some((i) => i.keys.includes('minGroundClearanceIn'))).toBe(true);
  });
  it('the sweep is cached by design (rider masses excluded) and fast', () => {
    const t = performance.now();
    brakeSweep(makeContext(resolveParams({ ...defaults, riderMassLb: 120 }), buildModel(resolveParams({ ...defaults, riderMassLb: 120 }), { rider: 'goal', cargo: true, steerDeg: 0 })), 10);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe('the defaults', () => {
  it('every brake row passes; the failing rows are the bump-basis front and rear end rows (3c-3 sizes them), none of them a brake row', () => {
    const all = runChecks(defaults, { includeTruck: false });
    const failing = all.filter((c) => [c.status, c.statusOperating, c.statusGoal].includes('fail')).map((c) => c.id).sort();
    expect(failing).toEqual(['axle-stress', 'bearing-groove', 'bellcrank', 'kingpin-bolt', 'kingpin-bracket', 'rear-beam-seat', 'tongue-tie', 'wheel-rating']);
    for (const id of ['brake-ratio', 'brake-force', 'brake-clear', 'brake-lever', 'brake-links', 'brake-beam', 'brake-shoes', 'park-hold', 'handle-sockets']) expect(byId(all, id).status, id).toBe('pass');
    expect(byId(all, 'brake-abuse').status).not.toBe('fail');
  });
  it('the removed rows are gone: no stop, emergency, bias, heat, front-brake, hip-cable, belt-anchor, stick-cable or ride rows', () => {
    const ids = new Set(cs.map((c) => c.id));
    for (const id of ['brake-stop', 'brake-emergency', 'brake-bias', 'brake-heat', 'brake-front', 'hip-cable', 'belt-anchor', 'stick-cable', 'ride-rollover', 'steer-centering', 'ride-steer-effort', 'ride-envelope', 'brake-shaft', 'brake-ratchet'])
      expect(ids.has(id), id).toBe(false);
  });
});
