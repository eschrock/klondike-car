import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, validateParams, type ParamKey, type Params } from '../params';
import { buildModel } from '../model';
import { checkTruckFit } from '../truck/fit';
import { dualCheck, type CaseEval } from './dual';
import { computeLayout } from '../model/layout';
import { runChecks, type AnalysisCheck } from './index';
import { liftPull } from './stability';
import { effectiveStripWidth, maxDeckSpan, obstacleForce, rollBalance } from './structure';
import { judge } from './types';

const defaults = defaultParams();
const byId = (cs: AnalysisCheck[], id: string) => cs.find((c) => c.id === id)!;
const run = (p: Params) => runChecks(p, { includeTruck: false });

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
  it('turn radius (A-2, M1): tyre-centreline 95.2" at the Phase 1 lock (D-26), the pass/fail value is the outer EDGE = centreline + w/2 = 97.2"', () => {
    const t = byId(cs, 'turn-radius');
    const centre = t.details!.find((d) => d.name.includes('centreline'))!.value;
    expect(centre).toBeCloseTo(95.25, 1);
    expect(t.value).toBeCloseTo(centre + defaults.tireWidthIn / 2, 6);
    expect(t.value).toBeCloseTo(97.25, 1);
    expect(t.status).toBe('fail'); // 97.25" > 96"
    const r40 = byId(run({ ...defaults, steerLockDeg: 40 }), 'turn-radius').details!.find((d) => d.name.includes('centreline'))!.value;
    expect(Math.abs(r40 - 7.7 * 12)).toBeLessThan(1); // DECISIONS hand-calc table, tyre centre
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
    const F = (W * Math.sin((defaults.designSlopeDeg * Math.PI) / 180)) / defaults.brakePadMu / (defaults.brakeLeverRatio * defaults.brakeEfficiency);
    expect(byId(cs, 'brake-force').cases!.operating!.value).toBeCloseTo(F, 3);
  });
  it('through-rod axle stress matches the closed-form cantilever for the rear wheel', () => {
    const c = byId(cs, 'axle-stress');
    const rear = c.details!.find((d) => d.name.startsWith('rear axle bending'))!;
    // hand (goal, rear): P = 114.7 lb × 3 = 344.1 lbf, a = 2.0", M = 688.3 lb·in → 16.6 ksi vertical; with the tyre friction force
    // (0.5 × 114.7 lb at r = 6.5") M = 1061 lb·in → σ = 1061 × 0.375 / 0.015531 + 57.4/0.4418 = 25.75 ksi
    expect(rear.value).toBeGreaterThan(25000);
    expect(rear.value).toBeLessThan(26500);
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
    const limit = Math.round((base.operating!.value + base.goal!.value) / 2 + 2);
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
    const thin = byId(run(defaults), 'deck');
    const thick = byId(run({ ...defaults, deckPlyIn: 0.472 }), 'deck');
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
  const legacy = { ...defaults, kingpinThroughBolster: 0 };
  const cs = run(legacy);
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
  it('H1 kingpin-strike: goal front axle 144 lb (nose-down governs, M4) → both wheels over a 3" curb H = 144 × 3 × 1.565 = 676 lbf; σ = H·s/S = 676 × 2.875 / 0.012272 = 158 ksi → FAIL; ¾"–⅞" needed', () => {
    const c = byId(cs, 'kingpin-strike');
    expect(c.status).toBe('fail');
    expect(c.statusOperating).toBe('fail'); // fails at the 150 lb rider too, so not a goal-only flag
    const sigma = det('kingpin-strike', 'kingpin bending').value;
    expect(sigma).toBeGreaterThan(155000);
    expect(sigma).toBeLessThan(162000);
    expect(det('kingpin-strike', 'kingpin shear').value).toBeCloseTo(676 / (Math.PI * 0.25 * 0.25), -2); // τ = H/A = 3443 psi
    expect(c.how).toMatch(/0\.875" bolt/); // minimum bolt text
    expect(c.how).toMatch(/curb both wheels/);
  });
  it('H1: a ¾" kingpin passes the strike bending (σ = 676 × 2.875 / 0.04141 = 47 ksi < 65)', () => {
    const c = byId(run({ ...legacy, kingpinDiameterIn: 0.75 }), 'kingpin-strike');
    expect(c.details!.find((d) => d.name.includes('kingpin bending'))!.util).toBeLessThan(1);
  });
  it('rollBalance: P = 100 lbf at y = 17.75" with the bearer at 6.8": F_sb = 261.0, uplift 161.0 lbf', () => {
    const r = rollBalance(100, 17.75, 6.8);
    expect(r.Fsb).toBeCloseTo(261.03, 1);
    expect(r.U).toBeCloseTo(161.03, 1);
    expect(rollBalance(100, 5, 6.8).U).toBe(0);
  });
  it('H2 roll path at the defaults (goal): P = 72.2 × 3 = 216.6 lbf, F_sb = 564 lbf on 2.25 in² = 251 psi, uplift 348 lbf on a 1.25" washer (1.03 in²) = 337 psi vs 358', () => {
    expect(det('roll-side-bearer', 'bearer oak').value).toBeCloseTo(250.8, 0);
    expect(det('roll-side-bearer', 'UHMW').value).toBeCloseTo(250.8, 0);
    expect(det('roll-kingpin-uplift', 'washer').value).toBeCloseTo(337.3, 0);
    expect(byId(cs, 'roll-bolster-attach').how).toMatch(/4 × 0\.250" bolts/);
    expect(det('roll-bolster-attach', 'fastener shear').value).toBeCloseTo(676.1 / (4 * 0.0490874), -1); // 3443 psi
  });
  it('M2: compression ⊥ allowable is 1070 × 0.67 / 2 = 358.45 psi', () => {
    expect(goal('bearing-groove').limit).toBeCloseTo(358.45, 2);
    // 144 lb front axle × share → rear heavier: groove stress 306 psi → 85% utilised
    expect(goal('bearing-groove').util).toBeCloseTo(306 / 358.45, 1);
    expect(byId(run({ ...defaults, wetServiceFactorCompPerp: 0.85 }), 'bearing-groove').cases!.goal!.limit).toBeCloseTo(454.75, 2);
  });
  it('M3 rails: M = P·L/4 + w·L²/8 = 337.5 × 49.125 / 4 + 100.9 × 49.125 / 8 = 4145 + 620 = 4765 lb·in → σ = M/S = 4765 / 1.125 = 4235 psi', () => {
    expect(det('rails', 'bending').value).toBeCloseTo(4235, -1);
    expect(byId(cs, 'rails').how).toMatch(/self-weight/);
  });
  it('M4: turntable load = worse of level (118.3 lb) and nose-down on 15° (144.0 lb) × 3 = 432 lbf (goal)', () => {
    expect(goal('turntable').value).toBeCloseTo(432, 0);
    // hand: W = 347.2, x = 16.4, h = 15.86, L = 48: W (cos15 · x/L + sin15 · h/L) = 144.3
    expect(byId(cs, 'turntable').how).toMatch(/nose-down/);
  });
  it('M5 axle: rear wheel, operating: P = 98.0 lb × 3 = 294.1; vertical M = 588 lb·in; + μP·r = 0.5 × 98.0 × 6.5 = 318.5 → 906.8 lb·in; σ = 906.8 × 0.375 / 0.015531 + 49.0/0.4418 = 22.0 ksi', () => {
    const rear = byId(cs, 'axle-stress').cases!.operating!;
    expect(rear.value).toBeGreaterThan(21500);
    expect(rear.value).toBeLessThan(22500);
    expect(byId(cs, 'axle-stress').how).toMatch(/resultant/);
  });
  it('D1 deck: b_eff = 10 + 0.625 × 9.5 = 15.94"; 200 lb on 4" at midspan of 9.5": δ = 0.069" (fails L/300 = 0.032"); 12 mm gives 0.029" (passes); needed ≥ 11.7 mm', () => {
    expect(effectiveStripWidth(10, 9.5)).toBeCloseTo(15.94, 2);
    const c = byId(cs, 'deck');
    expect(c.details!.find((d) => d.name.includes('deflection'))!.value).toBeCloseTo(0.069, 3);
    expect(c.how).toMatch(/≥ 11\.7 mm/);
    expect(c.how).toMatch(/12 mm: 0\.029/);
    const t12 = byId(run({ ...defaults, deckPlyIn: 0.472 }), 'deck').details!.find((d) => d.name.includes('deflection'))!.value;
    expect(t12).toBeCloseTo(0.029, 3);
  });
  it('layout: a thicker deck ply no longer lengthens the span next to the rear beam (D1 oddity)', () => {
    const span = (t: number) => maxDeckSpan({ L: computeLayout({ ...defaults, deckPlyIn: t }) } as never);
    expect(span(0.472)).toBeLessThan(span(0.354) + 0.1);
  });
  it('liftPull: W = 100 lb, x = 20", h = 10", θ = 0, pull point 60" ahead at ground level at α = 30°: T = 100 × 20 / (60 × 0.5) = 66.7 lbf', () => {
    expect(liftPull(100, 20, 10, 0, 60, 0, Math.PI / 6)).toBeCloseTo(66.67, 1);
    expect(liftPull(100, 20, 10, 0, 0, 0, 0)).toBe(Infinity);
  });
  it('H3 pitch-rear: T_lift/T_peak = 200 / 150 = 1.33 (operating), 1.52 (goal), 160 / 150 = 1.07 (80 lb rider) → FAIL at the lightest rider only', () => {
    const c = byId(cs, 'pitch-rear');
    expect(c.cases!.operating!.value).toBeCloseTo(1.334, 2);
    expect(c.cases!.goal!.value).toBeCloseTo(1.525, 2);
    expect(c.cases!.light!.value).toBeCloseTo(1.067, 2);
    expect(c.cases!.light!.limit).toBe(defaults.pitchPullMarginMin);
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
    expect(op('pitch-fwd').value).toBeCloseTo(67.4, 0);
    expect(byId(cs, 'pitch-fwd').how).not.toMatch(/tanθ \+ a/);
  });
  it('L2 brake: wet shoes μ 0.25 give 24.04 × 0.4 / 0.25 = 38.5 lbf (sensitivity only; status follows the design μ)', () => {
    const c = byId(cs, 'brake-force');
    const wet = c.details!.find((d) => d.name.includes('wet'))!;
    expect(wet.value).toBeCloseTo(38.46, 1);
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
    expect(byId(cs, 'turn-radius').util).toBeCloseTo(97.25 / 96, 2);
  });
  it('the governing case of a failing row is the failing case (so the chip matches the value shown)', () => {
    const c = byId(cs, 'pitch-rear');
    expect(c.cases![c.governingLoad as 'light']!.status).toBe('fail');
    const a = byId(cs, 'axle-stress');
    expect(a.cases![a.governingLoad as 'goal']!.status).toBe(a.status);
  });
});

describe('kingpin through the bolster: single shear with two bearing members, sleeve, washer rule (D-12)', () => {
  const det = (cs: AnalysisCheck[], id: string, name: string) => byId(cs, id).details!.find((x) => x.name.includes(name))!;
  it('crossbar: τ = H/A (one shear plane at the turntable), M = H·(g/2 + D_min/2), bearing in beam and crossbar', () => {
    const cs = run(defaults);
    const L = computeLayout(defaults);
    const kp = byId(cs, 'kingpin');
    const H = defaults.pullForceLbf;
    const A = Math.PI * 0.25 * 0.25;
    const g = L.turntable.z1 - L.turntable.z0, D2 = L.crossbar!.z1 - L.crossbar!.z0;
    expect(det(cs, 'kingpin', 'shear').value).toBeCloseTo(H / A, 0);
    const arm = g / 2 + Math.min(L.beamF.depth, D2) / 2;
    expect(det(cs, 'kingpin', 'bending').value).toBeCloseTo((H * arm) / (Math.PI * 0.5 ** 3 / 32), -1);
    expect(det(cs, 'kingpin', 'beam').value).toBeCloseTo(H / (0.5 * L.beamF.depth), 0);
    expect(det(cs, 'kingpin', 'crossbar (oak').value).toBeCloseTo(H / (0.5 * D2), 0);
    expect(kp.how).toMatch(/single shear/);
  });
  it('the crossbar bore (bolster depth) is shallower than the beam, so it governs the oak bearing without a sleeve', () => {
    const p = { ...defaults, kingpinDiameterIn: 0.75, kingpinLeadIn: 1.25 };
    const cs = run(p);
    expect(det(cs, 'kingpin-strike', 'crossbar (oak').util!).toBeGreaterThan(det(cs, 'kingpin-strike', 'in the beam').util!);
  });
  it('a sleeve moves the oak bearing to its OD and adds a pin-on-sleeve steel bearing row (0.9·36 ksi / 2 = 16.2 ksi)', () => {
    const p = { ...defaults, kingpinDiameterIn: 0.625, kingpinSleeveOdIn: 1.25, kingpinLeadIn: 1.5, frontAxleBeamThicknessIn: 4 };
    const cs = run(p);
    const L = computeLayout(p);
    const s = byId(cs, 'kingpin-strike');
    const sl = s.details!.find((d) => d.name.includes('steel sleeve'))!;
    expect(sl.limit).toBeCloseTo((0.9 * 36000) / p.steelSafetyFactor, 6);
    const H = byId(cs, 'kingpin-strike').how.match(/Governing: [^,]+, H = (\d+)/)![1];
    const brgBeam = s.details!.find((d) => d.name.includes('in the beam'))!;
    expect(brgBeam.value).toBeCloseTo(Number(H) / (1.25 * L.beamF.depth), -1);
    expect(s.cases!.goal!.util).toBeLessThan(0.9); // ≥ 10% margin at the goal rider
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
