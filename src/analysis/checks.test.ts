import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, validateParams, type ParamKey, type Params } from '../params';
import { buildModel } from '../model';
import { checkTruckFit } from '../truck/fit';
import { dualCheck, type CaseEval } from './dual';
import { computeLayout } from '../model/layout';
import { runChecks, type AnalysisCheck } from './index';
import { liftPull, pullPoint } from './stability';
import { effectiveStripWidth, maxDeckSpan, obstacleForce, rollBalance } from './structure';
import { judge } from './types';
import { phase1Params } from '../test-baselines';
import { makeContext } from './context';
import { resolveParams } from '../params';
import { worldAABB } from '../model/bounds';

const defaults = defaultParams();
const phase1 = phase1Params(); // the Phase 1 configuration: for tests whose purpose is a hand calculation worked at it

/**
 * Independent closed form for the turning radius (A-2): the instant center lies on the rear axle line; the front axle center
 * trails the kingpin by `lead` and swings through the lock angle θ, so (rear-axle line at x = 0, kingpin at wheelbase + lead)
 * the outer front tire centerline radius = (wheelbase + lead − lead·cosθ)/sinθ + frontTrack/2, and the outer EDGE adds tire width/2.
 */
const turnEdgeIn = (p: Params, lockDeg: number) => {
  const th = (lockDeg * Math.PI) / 180;
  return (p.wheelbaseIn + p.kingpinLeadIn - p.kingpinLeadIn * Math.cos(th)) / Math.sin(th) + p.frontTrackIn / 2 + p.tireWidthIn / 2;
};
const byId = (cs: AnalysisCheck[], id: string) => cs.find((c) => c.id === id)!;
const run = (p: Params) => runChecks(p, { includeTruck: false });

/**
 * Hand calculation of the through-rod axle stress (M5) from a load case, so no mass is hard-coded and the test survives parts-list changes.
 * Static wheel load: rear axle share M (WB - x_cg)/WB of the total, split 1/2 + |y_cg|/track between the wheels; design load = static x dynamic factor;
 * cantilever arm a = wheel centerline - clamp plate outer edge; the tire friction force H = mu P_static adds H cos(psi) r to the vertical moment and
 * H sin(psi) a in the fore-aft plane; sigma = sqrt(Mv^2 + Mh^2) c/I + H cos(psi)/A, worst psi over 0..90 deg.
 */
const rearAxleStressHand = (p: Params, parts: ReturnType<typeof buildModel>, c: { massLb: number; cg: number[] }) => {
  const WB = p.wheelbaseIn;
  const rearAxle = (c.massLb * (WB - c.cg[0])) / WB;
  const P = rearAxle * (0.5 + Math.abs(c.cg[1]) / p.rearTrackIn); // static, worst wheel
  const wheel = parts.find((x) => x.id === 'wheel-RL')!;
  const outer = Math.max(...['clamp-RL1', 'clamp-RL2'].map((id) => worldAABB(parts.find((x) => x.id === id)!).max[1]));
  const a = Math.abs(wheel.transform[13]) - outer;
  const d = p.axleDiameterIn, I = (Math.PI * d ** 4) / 64, A = (Math.PI * d * d) / 4;
  const r = p.wheelDiameterIn / 2;
  const H = p.tireGroundMu * P;
  let sigma = 0;
  for (let psi = 0; psi <= 90; psi += 1) {
    const rad = (psi * Math.PI) / 180;
    const Mv = P * p.dynamicFactor * a + H * Math.cos(rad) * r, Mh = H * Math.sin(rad) * a;
    sigma = Math.max(sigma, (Math.hypot(Mv, Mh) * (d / 2)) / I + (H * Math.cos(rad)) / A);
  }
  return { P, a, sigma };
};

describe('runChecks at the defaults', () => {
  const cs = run(defaults);
  it('returns the full spec table, grouped, each with a formula-bearing `how`', () => {
    const ids = cs.map((c) => c.id);
    for (const id of [
      'mass-empty', 'cg', 'tip-straight', 'tip-lock', 'slide-before-tip', 'v-rollover', 'turn-radius', 'steer-clear', 'pitch-fwd', 'pitch-rear',
      'brake-force', 'brake-traction', 'axle-stress', 'beam-front', 'beam-rear', 'bearing-groove', 'rails', 'deck', 'kingpin', 'turntable',
      'tongue', 'truck-fit', 'kingpin-strike', 'roll-side-bearer', 'roll-kingpin-uplift', 'roll-bolster-attach',
    ]) expect(ids, id).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of cs) {
      expect(c.how.length, c.id).toBeGreaterThan(30);
      expect(['Stability', 'Steering', 'Braking', 'Structure', 'Mass & transport']).toContain(c.group);
      expect(Number.isFinite(c.value) && Number.isFinite(c.limit), c.id).toBe(true);
    }
  });
  it('cross-checks the DECISIONS hand-calc table (straight tip within 1° of its 47.1–50.2° range)', () => {
    const t = byId(cs, 'tip-straight').cases!.operating!.value;
    expect(t).toBeGreaterThan(47.1 - 1);
    expect(t).toBeLessThan(50.2 + 1);
    // lock tip table range 43.7–46.6; slide-before-tip SSF 1.00–1.11
    const l = byId(cs, 'tip-lock').cases!.operating!.value;
    expect(l).toBeGreaterThan(43.7 - 1);
    expect(l).toBeLessThan(46.6 + 1);
    const ssf = byId(cs, 'slide-before-tip').cases!.operating!.value;
    expect(ssf).toBeGreaterThan(0.95);
    expect(ssf).toBeLessThan(1.2);
  });
  it('turn radius (A-2, M1): tire-centerline 95.2" at the Phase 1 lock (D-26), the pass/fail value is the outer EDGE = centerline + w/2 = 97.2"', () => {
    const t = byId(run(phase1), 'turn-radius'); // hand calculation at the Phase 1 configuration (48" wheelbase, 38.5° lock)
    const center = t.details!.find((d) => d.name.includes('centerline'))!.value;
    expect(center).toBeCloseTo(95.25, 1);
    expect(t.value).toBeCloseTo(center + phase1.tireWidthIn / 2, 6);
    expect(t.value).toBeCloseTo(97.25, 1);
    expect(t.status).toBe('fail'); // 97.25" > 96"
    const r40 = byId(run({ ...phase1, steerLockDeg: 40 }), 'turn-radius').details!.find((d) => d.name.includes('centerline'))!.value;
    expect(Math.abs(r40 - 7.7 * 12)).toBeLessThan(1); // DECISIONS hand-calc table, tire center
  });
  it('turn radius at the current defaults (44" wheelbase, 37° lock, 1.5" lead) matches the closed form and passes (marginally) the 96" limit (D-27)', () => {
    const t = byId(cs, 'turn-radius');
    expect(t.value).toBeCloseTo(turnEdgeIn(defaults, defaults.steerLockDeg), 6); // 93.36"
    expect(t.value).toBeCloseTo(93.36, 1);
    expect(t.status).toBe('marginal'); // passes with a 2.7% margin (< 10% of the limit): docs/phase2-recommendation.md
    expect(t.value).toBeLessThan(defaults.turnRadiusMaxIn);
  });
  it('goal rider is heavier and tips earlier than the operating rider', () => {
    const t = byId(cs, 'tip-straight').cases!;
    expect(t.goal!.value).toBeLessThan(t.operating!.value);
    expect(byId(cs, 'tip-straight').load).toBe('operating');
    expect(byId(cs, 'rails').load).toBe('goal'); // structure: D-2
  });
  it('the info rows never fail', () => {
    for (const id of ['mass-empty', 'cg', 'v-rollover', 'brake-traction']) expect(byId(cs, id).status, id).toBe('info');
  });
  it('brake force follows F = W sinθ / μ / (ratio · η) at the operating mass', () => {
    const W = buildModel(defaults, { rider: 'operating', cargo: true }).reduce((s, x) => s + x.massLb, 0);
    // Phase 3 (D-38): the ratio is DERIVED from the linkage geometry (brake-ratio), not the free `brakeLeverRatio` param (now a target).
    // Phase 3 r2: pass/fail at the lower of the wet-lining μ (0.45) and the mud-fouled μ (0.35); the derived ratio is 13.2:1 (12 × 1.1 headroom).
    const F = (W * Math.sin((defaults.designSlopeDeg * Math.PI) / 180)) / defaults.brakePadMuFouled / (byId(cs, 'brake-ratio').value * defaults.brakeEfficiency);
    expect(byId(cs, 'brake-force').cases!.operating!.value).toBeCloseTo(F, 3);
  });
  it('through-rod axle stress matches the closed-form cantilever for the rear wheel', () => {
    const c = byId(cs, 'axle-stress');
    const rear = c.details!.find((d) => d.name.startsWith('rear axle bending'))!;
    // Hand calculation from the goal load case (see rearAxleStressHand): the same formulas as the check, with no pinned masses.
    // At the Phase 3 defaults, P = 124 lb static and sigma is about 27 ksi (it was 26.9 ksi before the Phase 3 integration).
    const ctx = makeContext(resolveParams(defaults), buildModel(resolveParams(defaults), { rider: 'goal', cargo: true, steerDeg: 0 }));
    const hand = rearAxleStressHand(resolveParams(defaults), ctx.parts, ctx.loads.goal);
    expect(rear.value).toBeCloseTo(hand.sigma, -1); // within 5 psi
    expect(Math.abs(rear.value / hand.sigma - 1)).toBeLessThan(2e-3);
    expect(c.details!.some((d) => d.name.includes('deflection'))).toBe(true);
  });
});

describe('operating / goal flagging', () => {
  const ev = (value: number): CaseEval => ({ value, unit: 'x', limit: 10, sense: '<=', how: `v=${value}` });
  const mk = (op: number, goal: number) =>
    dualCheck({ id: 't', label: 'T', group: 'Stability', primary: 'operating', operating: ev(op), goal: ev(goal), operatingLabel: 'Operating', goalLabel: 'Goal' });
  it('judge: pass / marginal (< 10% of the limit) / fail', () => {
    expect(judge(8, 10, '<=')).toBe('pass');
    expect(judge(9.5, 10, '<=')).toBe('marginal');
    expect(judge(10.5, 10, '<=')).toBe('fail');
    expect(judge(45, 40, '>=')).toBe('pass');
    expect(judge(42, 40, '>=')).toBe('marginal');
    expect(judge(39, 40, '>=')).toBe('fail');
    expect(judge(Number.NaN, 1, '<=')).toBe('fail');
  });
  it('both pass → pass, no flag', () => {
    const c = mk(5, 6);
    expect([c.status, c.statusOperating, c.statusGoal, c.goalFlag]).toEqual(['pass', 'pass', 'pass', false]);
  });
  it('operating passes, goal fails → fail with a goal-rider flag in `how`', () => {
    const c = mk(5, 12);
    expect(c.status).toBe('fail');
    expect(c.statusOperating).toBe('pass');
    expect(c.statusGoal).toBe('fail');
    expect(c.goalFlag).toBe(true);
    expect(c.how).toMatch(/GOAL RIDER FLAG/);
    expect(c.value).toBe(5); // the row shows the operating value
  });
  it('operating fails → fail, not a goal flag', () => {
    const c = mk(12, 13);
    expect([c.status, c.goalFlag]).toEqual(['fail', false]);
    expect(c.how).not.toMatch(/GOAL RIDER FLAG/);
  });
  it('marginal at either rider makes the row marginal', () => {
    expect(mk(5, 9.5).status).toBe('marginal');
    expect(mk(9.5, 5).status).toBe('marginal');
  });
  it('real run: a handle-force limit between the 150 lb and 200 lb loads flags the goal rider', () => {
    const base = byId(run(defaults), 'brake-force').cases!;
    // Midpoint of the two loads (20.3 / 23.7 lbf at the Phase 2 defaults, ratio 12:1). The old "+ 2" nudge assumed a wider gap
    // (the 10:1 ratio) and would now put the limit above the goal value, i.e. into 'marginal' instead of 'fail'.
    const limit = Math.round((base.operating!.value + base.goal!.value) / 2);
    expect(limit).toBeGreaterThan(base.operating!.value);
    expect(limit).toBeLessThan(base.goal!.value);
    const c = byId(run({ ...defaults, handleForceLimitLbf: limit }), 'brake-force');
    expect(c.statusOperating).not.toBe('fail');
    expect(c.statusGoal).toBe('fail');
    expect(c.status).toBe('fail');
    expect(c.goalFlag).toBe(true);
  });
  it('structural rows show the goal case and still report the operating status', () => {
    const c = byId(run(defaults), 'axle-stress');
    expect(c.load).toBe('goal');
    expect(c.cases!.goal!.value).toBeGreaterThan(c.cases!.operating!.value);
  });
});

describe('parameter response', () => {
  it('a wider track raises the lateral tip angle; a higher deck lowers it', () => {
    const base = byId(run(defaults), 'tip-straight').value;
    expect(byId(run({ ...defaults, rearTrackIn: 33, frontTrackIn: 33 }), 'tip-straight').value).toBeLessThan(base);
    expect(byId(run({ ...defaults, deckHeightIn: 12 }), 'tip-straight').value).toBeLessThan(base);
  });
  it('a 12 mm deck ply passes the standing-scout deflection that the 9 mm ply fails (D1)', () => {
    // Phase 1 configuration (9 mm ply, 12" joist spacing): the Phase 2 defaults already use 12 mm at 8" spacing.
    const thin = byId(run(phase1), 'deck');
    const thick = byId(run({ ...phase1, deckPlyIn: 0.472 }), 'deck');
    expect(thin.details!.find((d) => d.name.includes('deflection'))!.util).toBeGreaterThan(1);
    expect(thick.status).not.toBe('fail');
  });
  it('a nose wider than the swing allows (auto geometry off) fails the steering clearance sweep', () => {
    const p = { ...defaults, autoNoseGeometry: 0, noseWidthIn: 18, bodyWidthIn: 28 };
    const c = byId(run(p), 'steer-clear');
    expect(c.status).toBe('fail');
    expect(c.value).toBeLessThan(0.7);
  });
  it('the hull-beam frame builds an I-section for the side girders', () => {
    const c = byId(run({ ...defaults, frameStyle: 1 }), 'rails');
    expect(c.label).toMatch(/girder/i);
    expect(c.how).toMatch(/transformed I-section/);
    expect(c.details!.some((d) => d.name.includes('ply web'))).toBe(true);
  });
  it('stub axles use the beam face as the cantilever root', () => {
    const c = byId(run({ ...defaults, axleStyle: 1 }), 'axle-stress');
    expect(c.how).toMatch(/stub axle/);
  });
  it('rope-bridle-only has no tongue to check', () => {
    expect(byId(run({ ...defaults, drawbar: 0 }), 'tongue').status).toBe('info');
  });
});

describe('truck fit option and performance', () => {
  it('skips the truck by option, reuses a supplied FitResult, or computes it', () => {
    expect(byId(run(defaults), 'truck-fit').status).toBe('info');
    const fit = checkTruckFit(defaults, (v) => buildModel(defaults, v));
    const reused = byId(runChecks(defaults, { fit }), 'truck-fit');
    expect(reused.status).toBe(fit.cases.some((c) => c.config === 'removed' && c.fits) ? 'pass' : 'fail');
    expect(byId(runChecks(defaults), 'truck-fit').value).toBe(reused.value);
    expect(reused.how).toMatch(/Tongue off/);
  });
  it('runChecks takes well under 30 ms at the defaults without the truck call', () => {
    run(defaults); // warm up
    const t0 = performance.now();
    const N = 10;
    for (let i = 0; i < N; i++) run(defaults);
    const per = (performance.now() - t0) / N;
    console.log(`runChecks (no truck): ${per.toFixed(1)} ms`);
    expect(per).toBeLessThan(30);
    const t1 = performance.now();
    runChecks(defaults);
    const withTruck = performance.now() - t1;
    console.log(`runChecks (with truck): ${withTruck.toFixed(1)} ms`);
    expect(withTruck).toBeLessThan(250);
  });
});

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe('every variant the validator accepts yields finite checks', () => {
  const KEYS: ParamKey[] = [
    'wheelbaseIn', 'rearTrackIn', 'frontTrackIn', 'deckHeightIn', 'frontDeckRaiseIn', 'bodyWidthIn', 'seatXIn', 'wheelDiameterIn', 'steerLockDeg',
    'kingpinLeadIn', 'rearOverhangIn', 'frontOverhangIn', 'sideHeightIn', 'tireWidthIn', 'axleBeamThicknessIn', 'frontAxleBeamThicknessIn',
    'axleBeamDepthIn', 'railDepthIn', 'railThicknessIn', 'crossmemberDepthIn', 'crossmemberSpacingIn', 'turntableSizeIn', 'deckPlyIn', 'seatDepthIn',
    'tongueLengthIn', 'pullerHandHeightIn', 'brakeLeverRatio', 'riderMassLb', 'riderGoalMassLb', 'cargoMassLb', 'axleDiameterIn', 'designSlopeDeg',
    'tireGroundMu', 'dynamicFactor', 'sideThicknessIn', 'panelPlyIn',
  ];
  const OPTIONS: ParamKey[] = ['frameStyle', 'sideConstruction', 'storageLocation', 'axleBeamPosition', 'axleStyle', 'drawbar', 'plySpecies'];
  const samples = (() => {
    const rnd = mulberry32(2026);
    const out: Params[] = [];
    for (let i = 0; i < 260; i++) {
      const p = { ...defaults };
      for (const k of KEYS) {
        if (rnd() > 0.3) continue;
        const d = PARAM_DEFS[k];
        const v = d.default + (rnd() * 2 - 1) * 0.25 * (d.max - d.min);
        p[k] = Math.min(d.max, Math.max(d.min, Math.round(v / d.step) * d.step));
      }
      if (p.riderGoalMassLb < p.riderMassLb) p.riderGoalMassLb = p.riderMassLb;
      for (const k of OPTIONS) if (rnd() < 0.35) p[k] = PARAM_DEFS[k].options![Math.floor(rnd() * PARAM_DEFS[k].options!.length)].value;
      out.push(p);
    }
    return out;
  })();
  it('260 seeded designs: validator-clean ones give finite values, limits and details', () => {
    let clean = 0;
    const bad: string[] = [];
    for (const p of samples) {
      if (validateParams(p).some((i) => i.severity === 'error')) continue;
      clean++;
      for (const c of run(p)) {
        const nums = [c.value, c.limit, ...(c.details ?? []).flatMap((d) => [d.value, d.limit]), ...Object.values(c.cases ?? {}).flatMap((r) => (r ? [r.value, r.limit] : []))];
        if (nums.some((n) => !Number.isFinite(n) || Math.abs(n) >= 1e8)) bad.push(`${c.id}: ${nums.join(',')}`);
        if (!['pass', 'marginal', 'fail', 'info'].includes(c.status)) bad.push(`${c.id}: status ${c.status}`);
        if (/NaN|Infinity|undefined/.test(c.how)) bad.push(`${c.id}: how has ${c.how.match(/NaN|Infinity|undefined/)![0]}`);
      }
    }
    console.log(`analysis sweep: ${clean}/${samples.length} validator-clean designs checked`);
    expect(bad.slice(0, 5)).toEqual([]);
    expect(clean).toBeGreaterThanOrEqual(30);
  });
});

describe('critic round 1 fixes: hand-calculated numbers at the defaults', () => {
  // The hand calcs below were done for the original steering layout (kingpin ending at the turntable top, D-12); the crossbar
  // option adds ~1.5 lb and moves the CG, so they pin that configuration (kingpinThroughBolster = 0). The crossbar has its own tests below.
  // They also pin the Phase 1 design values (phase1Params(): 48" wheelbase, ½" pin, 9 mm deck, 12" joists, 72" rope run, ...).
  // The mass- and CG-dependent rows (H1, H2, M3, M4, H3) recompute their expected values from the model's own load case with the same
  // hand formulas as the titles (axle loads from the CG, front load = worse of level and nose-down, ...), so they stay valid as the
  // parts list changes (Phase 3 added front hardware, a heavier brake, seat and storage). Titles quote the numbers at the time of writing.
  const legacy = { ...phase1, kingpinThroughBolster: 0 };
  const cs = run(legacy);
  const lctx = makeContext(resolveParams(legacy), buildModel(resolveParams(legacy), { rider: 'goal', cargo: true, steerDeg: 0 }));
  const hand = (c: { massLb: number; cg: number[] }) => {
    const th = (legacy.designSlopeDeg * Math.PI) / 180, WB = legacy.wheelbaseIn;
    const level = (c.massLb * c.cg[0]) / WB; // rear contacts at x = 0, front at x = WB
    const slope = c.massLb * (Math.cos(th) * (c.cg[0] / WB) + Math.sin(th) * (c.cg[2] / WB)); // nose-down on 15°: W (cosθ·x/L + sinθ·h/L)
    return { level, slope, front: Math.max(level, slope) };
  };
  const goal = (id: string) => byId(cs, id).cases!.goal!;
  const op = (id: string) => byId(cs, id).cases!.operating!;
  const det = (id: string, name: string, k: 'goal' | 'operating' = 'goal') => {
    const c = byId(cs, id);
    const d = (k === 'goal' ? c : byId(run(legacy), id)).details!.find((x) => x.name.includes(name))!;
    return d;
  };

  it('obstacleForce: r = 6.5", 3" curb: cos φ = 3.5/6.5, tan φ = 1.565, H = 156.5 lbf per 100 lbf', () => {
    const o = obstacleForce(6.5, 3, 100);
    expect(o.phi * (180 / Math.PI)).toBeCloseTo(57.4, 1);
    expect(o.tan).toBeCloseTo(1.5647, 3);
    expect(o.H).toBeCloseTo(156.47, 1);
    expect(obstacleForce(6.5, 2, 100).H).toBeCloseTo(103.9, 0); // root: cos φ = 4.5/6.5, tan = 1.039
  });
  it('H1 kingpin-strike: goal front axle ≈ 148 lb (nose-down governs, M4) → both wheels over a 3" curb H = front × 3 × 1.565 ≈ 697 lbf; σ = H·s/S = H × 2.875 / 0.012272 ≈ 163 ksi → FAIL; ¾"–⅞" needed', () => {
    const c = byId(cs, 'kingpin-strike');
    expect(c.status).toBe('fail');
    expect(c.statusOperating).toBe('fail'); // fails at the 150 lb rider too, so not a goal-only flag
    const front = hand(lctx.loads.goal).front;
    expect(hand(lctx.loads.goal).slope).toBeGreaterThan(hand(lctx.loads.goal).level); // nose-down governs
    const H = front * legacy.dynamicFactor * obstacleForce(6.5, 3, 1).tan; // two wheels at half the axle each: H = 2 × (front/2 × 3) × tanφ
    const sigma = det('kingpin-strike', 'kingpin bending').value;
    expect(sigma).toBeCloseTo((H * 2.875) / 0.012272, -3); // within ~1 ksi of 160 ksi
    expect(det('kingpin-strike', 'kingpin shear').value).toBeCloseTo(H / (Math.PI * 0.25 * 0.25), -1); // τ = H/A ≈ 3.5 ksi
    expect(c.how).toMatch(/0\.875" bolt/); // minimum bolt text
    expect(c.how).toMatch(/curb both wheels/);
  });
  it('H1: a ¾" kingpin passes the strike bending (σ = 697 × 2.875 / 0.04141 = 48 ksi < 65)', () => {
    const c = byId(run({ ...legacy, kingpinDiameterIn: 0.75 }), 'kingpin-strike');
    expect(c.details!.find((d) => d.name.includes('kingpin bending'))!.util).toBeLessThan(1);
  });
  it('rollBalance: P = 100 lbf at y = 17.75" with the bearer at 6.8": F_sb = 261.0, uplift 161.0 lbf', () => {
    const r = rollBalance(100, 17.75, 6.8);
    expect(r.Fsb).toBeCloseTo(261.03, 1);
    expect(r.U).toBeCloseTo(161.03, 1);
    expect(rollBalance(100, 5, 6.8).U).toBe(0);
  });
  it('H2 roll path at the defaults (goal): P = front wheel × 3 ≈ 223 lbf, F_sb = P·17.75/6.81 ≈ 582 lbf on 2.25 in² ≈ 258 psi, uplift F_sb − P ≈ 358 lbf on a 1.25" washer (1.03 in²) ≈ 348 psi vs 358', () => {
    const g = lctx.loads.goal;
    const front = hand(g).front;
    const P = front * (0.5 + Math.abs(g.cg[1]) / legacy.frontTrackIn) * legacy.dynamicFactor;
    const sb = computeLayout(legacy).sideBearer;
    const ysb = (sb.y0 + sb.y1) / 2;
    const Fsb = (P * legacy.frontTrackIn) / 2 / ysb;
    const U = Fsb - P;
    expect(ysb).toBeCloseTo(6.8125, 9);
    const area = (sb.y1 - sb.y0) * (sb.x1 - sb.x0);
    expect(area).toBeCloseTo(2.25, 9);
    expect(det('roll-side-bearer', 'bearer oak').value).toBeCloseTo(Fsb / area, 0);
    expect(det('roll-side-bearer', 'UHMW').value).toBeCloseTo(Fsb / area, 0);
    const wOd = Math.max(legacy.kingpinWasherDiameterIn, 2.25 * legacy.kingpinDiameterIn);
    expect((Math.PI / 4) * (wOd ** 2 - legacy.kingpinDiameterIn ** 2)).toBeCloseTo(1.03, 2);
    expect(det('roll-kingpin-uplift', 'washer').value).toBeCloseTo(U / ((Math.PI / 4) * (wOd ** 2 - legacy.kingpinDiameterIn ** 2)), 0);
    expect(byId(cs, 'roll-bolster-attach').how).toMatch(/4 × 0\.250" bolts/);
    const H = front * legacy.dynamicFactor * obstacleForce(6.5, 3, 1).tan;
    expect(det('roll-bolster-attach', 'fastener shear').value).toBeCloseTo(H / (4 * 0.0490874), -1); // ≈ 3.5 ksi
  });
  it('M2: compression ⊥ allowable is 1070 × 0.67 / 2 = 358.45 psi', () => {
    expect(goal('bearing-groove').limit).toBeCloseTo(358.45, 2);
    // Worst wheel (front: worse of level and nose-down, or rear) x 3 over the rod diameter x the clamp-plate length along the rod; the numbers come from the
    // goal load case (about 149 lb front axle, 124 lb static rear wheel and 327 psi at the Phase 3 mass).
    const g = lctx.loads.goal, WB = legacy.wheelbaseIn;
    const frontWheel = hand(g).front * (0.5 + Math.abs(g.cg[1]) / legacy.frontTrackIn);
    const rearWheel = ((g.massLb * (WB - g.cg[0])) / WB) * (0.5 + Math.abs(g.cg[1]) / legacy.rearTrackIn);
    const tag = rearWheel >= frontWheel ? 'R' : 'F';
    const cl = [`clamp-${tag}L1`, `clamp-${tag}L2`].map((id) => worldAABB(lctx.parts.find((x) => x.id === id)!));
    const widthY = Math.max(...cl.map((b) => b.max[1])) - Math.min(...cl.map((b) => Math.max(0, b.min[1])));
    const stress = (Math.max(frontWheel, rearWheel) * legacy.dynamicFactor) / (legacy.axleDiameterIn * widthY);
    expect(goal('bearing-groove').value).toBeCloseTo(stress, 0);
    expect(goal('bearing-groove').util).toBeCloseTo(stress / 358.45, 3);
    expect(byId(run({ ...defaults, wetServiceFactorCompPerp: 0.85 }), 'bearing-groove').cases!.goal!.limit).toBeCloseTo(454.75, 2);
  });
  it('M3 rails: M = P·L/4 + w·L²/8 = 337.5 × 49.125 / 4 + (3 × chassis self-weight / 2) × 49.125 / 8 ≈ 4145 + 634 lb·in → σ = M/S = M / 1.125 ≈ 4.2 ksi', () => {
    const selfLb = lctx.parts.reduce((m, x) => (x.body === 'chassis' && !x.payload && x.group !== 'reference' && x.group !== 'running-gear' ? m + x.massLb : m), 0);
    const span = computeLayout(legacy).kx; // rear beam to kingpin
    const M = (337.5 * span) / 4 + (((selfLb * legacy.dynamicFactor) / 2) * span) / 8;
    expect(span).toBeCloseTo(49.125, 3);
    expect(det('rails', 'bending').value).toBeCloseTo(M / 1.125, -1);
    expect(byId(cs, 'rails').how).toMatch(/self-weight/);
  });
  it('M4: turntable load = worse of level (≈ 123 lb) and nose-down on 15° (≈ 148 lb) × 3 ≈ 445 lbf (goal)', () => {
    const g = hand(lctx.loads.goal);
    expect(g.slope).toBeGreaterThan(g.level);
    expect(goal('turntable').value).toBeCloseTo(legacy.dynamicFactor * g.front, 0);
    // hand: W (cos15 · x/L + sin15 · h/L) with W, x, h from the goal load case
    expect(byId(cs, 'turntable').how).toMatch(/nose-down/);
  });
  it('M5 axle: rear wheel, operating: P = rear-axle share x (1/2 + |y|/track) x 3; M = P a + mu P r (vertical plane) with H sin(psi) a fore-aft; sigma = resultant c/I + H/A (about 23 ksi at the Phase 1 mass)', () => {
    const rear = byId(cs, 'axle-stress').cases!.operating!;
    const hand = rearAxleStressHand(resolveParams(legacy), lctx.parts, lctx.loads.operating);
    expect(Math.abs(rear.value / hand.sigma - 1)).toBeLessThan(2e-3);
    expect(byId(cs, 'axle-stress').how).toMatch(/resultant/);
  });
  it('D1 deck: b_eff = 10 + 0.625 × 9.44 = 15.9"; 200 lb on 4" at midspan of 9.44" (the ¾" transom, D-43, moves the joists and trims the first bay): δ = 0.068" (fails L/300 = 0.032"); 12 mm gives 0.029" (passes); needed ≥ 11.6 mm', () => {
    expect(effectiveStripWidth(10, 9.44)).toBeCloseTo(15.9, 2);
    const c = byId(cs, 'deck');
    expect(c.details!.find((d) => d.name.includes('deflection'))!.value).toBeCloseTo(0.068, 3);
    expect(c.how).toMatch(/≥ 11\.6 mm/);
    expect(c.how).toMatch(/12 mm: 0\.02[89]/);
    const t12 = byId(run({ ...legacy, deckPlyIn: 0.472 }), 'deck').details!.find((d) => d.name.includes('deflection'))!.value;
    expect(t12).toBeCloseTo(0.0285, 3);
  });
  it('layout: a thicker deck ply no longer lengthens the span next to the rear beam (D1 oddity)', () => {
    const span = (t: number) => maxDeckSpan({ L: computeLayout({ ...defaults, deckPlyIn: t }) } as never);
    expect(span(0.472)).toBeLessThan(span(0.354) + 0.1);
  });
  it('liftPull: W = 100 lb, x = 20", h = 10", θ = 0, pull point 60" ahead at ground level at α = 30°: T = 100 × 20 / (60 × 0.5) = 66.7 lbf', () => {
    expect(liftPull(100, 20, 10, 0, 60, 0, Math.PI / 6)).toBeCloseTo(66.67, 1);
    expect(liftPull(100, 20, 10, 0, 0, 0, 0)).toBe(Infinity);
  });
  it('H3 pitch-rear: T_lift = W(x·cosθ − h·sinθ)/(x_p·sinα − z_p·cosα); T_lift/T_peak ≈ 1.4 (operating), 1.6 (goal), 1.1 (80 lb rider) → FAIL at the lightest rider only', () => {
    const c = byId(cs, 'pitch-rear');
    const pt = pullPoint(lctx);
    const alpha = Math.atan2(legacy.pullerHandHeightIn - pt.z, legacy.bridleRopeRunIn);
    const th = (legacy.designSlopeDeg * Math.PI) / 180;
    const ratio = (k: 'operating' | 'goal' | 'light') => {
      const q = lctx.loads[k];
      return (q.massLb * (q.cg[0] * Math.cos(th) - q.cg[2] * Math.sin(th))) / (pt.x * Math.sin(alpha) - pt.z * Math.cos(alpha)) / legacy.pullForceLbf;
    };
    expect(c.cases!.operating!.value).toBeCloseTo(ratio('operating'), 2);
    expect(c.cases!.goal!.value).toBeCloseTo(ratio('goal'), 2);
    expect(c.cases!.light!.value).toBeCloseTo(ratio('light'), 2);
    expect(ratio('operating')).toBeGreaterThan(1.25); // passes at the operating rider alone ...
    expect(ratio('light')).toBeLessThan(1.25); // ... and fails only for the 80 lb rider
    expect(c.cases!.light!.limit).toBe(legacy.pitchPullMarginMin);
    expect(c.statusOperating).toBe('fail'); // the 80 lb rider is part of the operating envelope
    expect(c.status).toBe('fail');
    expect(c.governingLoad).toBe('light');
    expect(c.how).toMatch(/Lightest rider/);
    expect(c.how).toMatch(/72" rope run/);
  });
  it('H3: a lower design slope or a heavier lightest rider raises the lift ratio; the rope run is a param', () => {
    const v = (q: Partial<Params>) => byId(run({ ...defaults, ...q }), 'pitch-rear').cases!.light!.value;
    expect(v({ riderMinMassLb: 100 })).toBeGreaterThan(v({}));
    expect(v({ designSlopeDeg: 10 })).toBeGreaterThan(v({}));
    expect(v({ bridleRopeRunIn: 120 })).not.toBeCloseTo(v({}), 2);
    expect(byId(run({ ...defaults, riderMinMassLb: 150 }), 'pitch-rear').status).not.toBe('fail');
  });
  it('L1 pitch-fwd: F_b/W = 0.5 × 164.8 / 297.2 = 0.277 vs tip threshold (31.6/15.08) cos15° = 2.02; equivalent angle acos(0.277/2.095) − 15° = 67.4°', () => {
    // Hand calculation from the operating load case (about 67 deg at the Phase 3 mass): N_r = W (cos th (WB - x)/WB - sin th h/WB), a/g = mu N_r / W,
    // tip threshold (WB - x)/h cos th, equivalent angle acos((a/g) / ((WB - x)/h)) - design slope.
    const q = lctx.loads.operating, WB = legacy.wheelbaseIn, th = (legacy.designSlopeDeg * Math.PI) / 180;
    const Nr = q.massLb * (Math.cos(th) * (WB - q.cg[0]) / WB - Math.sin(th) * q.cg[2] / WB);
    const geo = (WB - q.cg[0]) / q.cg[2];
    const handDeg = (Math.acos(Math.min(1, (legacy.tireGroundMu * Nr / q.massLb) / geo)) * 180) / Math.PI - legacy.designSlopeDeg;
    expect(op('pitch-fwd').value).toBeCloseTo(handDeg, 1);
    expect(byId(cs, 'pitch-fwd').how).not.toMatch(/tanθ \+ a/);
  });
  it('L2 brake: the mud-fouled case (μ 0.35) is pass/fail and bare wet oak (μ 0.25) is info only: F_fouled = F_wet × 0.45 / 0.35, F_bare = F_wet × 0.45 / 0.25', () => {
    const c = byId(cs, 'brake-force');
    const wet = c.details!.find((d) => d.name.includes('wet bonded lining'))!;
    const fouled = c.details!.find((d) => d.name.includes('fouled'))!;
    const bare = c.details!.find((d) => d.name.includes('bare wet oak'))!;
    // ratio-independent, so it survives the Phase 3 derived ratio (D-38): 0.45/0.35 = 1.2857, 0.45/0.25 = 1.8
    expect(fouled.value / wet.value).toBeCloseTo(0.45 / 0.35, 3);
    expect(bare.value / wet.value).toBeCloseTo(0.45 / 0.25, 3);
    expect(c.cases!.operating!.value).toBeCloseTo(fouled.value, 6); // the row value is the larger of wet and fouled
    expect(c.how).toMatch(/TOTAL shoe normal force/);
    expect(c.statusOperating).not.toBe('fail');
  });
});

describe('status chips and per-case results (P1/P2)', () => {
  const cs = run(defaults);
  it('every dual row carries per-case value/limit/util and a governing case; singles carry util', () => {
    for (const c of cs) {
      if (c.cases) {
        for (const r of Object.values(c.cases)) expect(Number.isFinite(r!.util) || r!.util === Infinity, c.id).toBe(true);
        expect(c.governingLoad, c.id).toBeDefined();
        expect(c.util, c.id).toBeGreaterThanOrEqual(0);
      }
    }
    expect(byId(cs, 'turn-radius').util).toBeCloseTo(turnEdgeIn(defaults, defaults.steerLockDeg) / defaults.turnRadiusMaxIn, 6);
  });
  it('the governing case of a failing row is the failing case (so the chip matches the value shown)', () => {
    // pitch-rear passes every rider at the Phase 2 defaults (rope tied low at the axle ends, 96" run), so the "failing row"
    // case is exercised on the Phase 1 configuration, where the 80 lb rider fails it (H3). The kingpin steel plates (D-35, +5 lb on the front axle) move the
    // CG forward enough to lift that rider to marginal, so the failing configuration is the Phase 1 pin without the crossbar and its plates.
    const c = byId(run({ ...phase1, kingpinThroughBolster: 0 }), 'pitch-rear');
    expect(c.status).toBe('fail');
    expect(c.cases![c.governingLoad as 'light']!.status).toBe('fail');
    expect(byId(cs, 'pitch-rear').status).toBe('pass'); // and the chip matches at the defaults too
    const a = byId(cs, 'axle-stress');
    expect(a.cases![a.governingLoad as 'goal']!.status).toBe(a.status);
  });
});

describe('kingpin through the bolster: single shear, steel plates and sleeve, washer rule (D-12, D-35)', () => {
  const det = (cs: AnalysisCheck[], id: string, name: string) => byId(cs, id).details!.find((x) => x.name.includes(name))!;
  it('crossbar + plates: τ = H/A, M = H·b with b = crossbar-plate mid − carrier mid, pin on the crossbar plate hole = H/(d·t) (hand arithmetic at the ½" Phase 1 pin)', () => {
    // ½" pin: A = π·0.25² = 0.19635 in², Z = π·0.5³/32 = 0.012272 in³. Phase 1 front end: carrier 6.875…7.25, ½" turntable? no: 3/8" bearing 7.25…7.625,
    // crossbar plate 7.625…7.8125 (3/16"), beam plate under the 2.5" beam 4.1875…4.375. Plate mid heights 7.71875 (crossbar), 7.0625 (carrier), 4.28125 (beam plate):
    // b = 7.71875 − 7.0625 = 0.65625", a = 7.0625 − 4.28125 = 2.78125".
    const cs = run(phase1);
    const kp = byId(cs, 'kingpin');
    const H = phase1.pullForceLbf; // 150 lbf
    expect(det(cs, 'kingpin', 'shear').value).toBeCloseTo(150 / 0.19635, 0); // 764 psi
    expect(det(cs, 'kingpin', 'bending').value).toBeCloseTo((150 * 0.65625) / 0.012272, -1); // M = 98.4 lb·in → 8,022 psi
    expect(det(cs, 'kingpin', 'crossbar plate hole').value).toBeCloseTo(150 / (0.5 * 0.1875), 0); // 1,600 psi
    expect(det(cs, 'kingpin', 'steel sleeve').value).toBeCloseTo((150 * (1 + 0.65625 / 2.78125)) / 0.25, 0); // R_top = 185.4 lbf over one pin diameter: 742 psi
    expect(kp.details!.some((d) => d.name.includes('(oak ⊥)') && /in the beam|in the crossbar/.test(d.name))).toBe(false); // the pin touches no oak
    expect(kp.how).toMatch(/overhanging pin/);
    expect(H).toBe(150);
  });
  it('with the plates the oak bore bearing rows are gone; without the crossbar (the Phase 1 single-shear pin) they are back', () => {
    const cs = run(defaults);
    const s = byId(cs, 'kingpin-strike');
    expect(s.details!.some((d) => /bore bearing in the beam|bore bearing in the crossbar/.test(d.name))).toBe(false);
    const legacy = run({ ...phase1, kingpinThroughBolster: 0 });
    expect(byId(legacy, 'kingpin-strike').details!.some((d) => /bore bearing in the beam/.test(d.name))).toBe(true);
  });
  it('steel limits: pin on the sleeve and on the plate hole are held to 0.9·36 ksi / 2 = 16.2 ksi; the sleeve peak is R_top/d² with R_top = H(1 + b/a), b = 0.78125", a = 2.78125" at the defaults', () => {
    const p = { ...defaults };
    expect(p.kingpinSleeveOdIn).toBe(1.25);
    const cs = run(p);
    const s = byId(cs, 'kingpin-strike');
    const sl = s.details!.find((d) => d.name.includes('steel sleeve'))!;
    const pl = s.details!.find((d) => d.name.includes('crossbar plate hole'))!;
    expect(sl.limit).toBeCloseTo((0.9 * 36000) / p.steelSafetyFactor, 6);
    expect(pl.limit).toBeCloseTo((0.9 * p.kingpinPlateYieldPsi) / p.steelSafetyFactor, 6);
    // crossbar plate mid (7.75 + 7.9375)/2 = 7.84375; carrier mid (6.875 + 7.25)/2 = 7.0625; beam plate mid (4.1875 + 4.375)/2 = 4.28125 → b = 0.78125, a = 2.78125
    const H = Number(s.how.match(/Governing: [^,]+, H = (\d+)/)![1]);
    expect(sl.value).toBeCloseTo((H * (1 + 0.78125 / 2.78125)) / 0.75 ** 2, -1);
    expect(pl.value).toBeCloseTo(H / (0.75 * 0.1875), -1);
    expect(s.cases!.goal!.util).toBeLessThan(1);
    expect(s.status).not.toBe('fail');
    expect(run({ ...p, sleeveYieldPsi: 20000 }).find((c) => c.id === 'kingpin-strike')!.details!.find((d) => d.name.includes('steel sleeve'))!.limit).toBeCloseTo(9000, 6);
  });
  it('the washer is at least 2.25 × the pin: a 1" pin gets a 2.25" washer even with the 1.25" param', () => {
    const p = { ...defaults, kingpinDiameterIn: 1, kingpinLeadIn: 1.375, frontAxleBeamThicknessIn: 3.75 };
    const cs = run(p);
    const w = det(cs, 'roll-kingpin-uplift', 'washer bearing');
    const U = byId(cs, 'roll-kingpin-uplift').how.match(/leaves ([\d.]+) lbf of UPLIFT/)![1];
    const area = (Math.PI / 4) * (2.25 ** 2 - 1);
    expect(w.value).toBeCloseTo(Number(U) / area, -1);
    expect(byId(cs, 'roll-kingpin-uplift').how).toMatch(/2\.25 × the 1\.000" pin/);
  });
});
