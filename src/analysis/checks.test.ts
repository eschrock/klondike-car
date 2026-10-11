import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, validateParams, type ParamKey, type Params } from '../params';
import { buildModel } from '../model';
import { checkTruckFit } from '../truck/fit';
import { dualCheck, type CaseEval } from './dual';
import { computeLayout } from '../model/layout';
import { runChecks, type AnalysisCheck } from './index';
import { liftPull, pullPoint } from './stability';
import { effectiveStripWidth, maxDeckSpan } from './structure';
import { judge } from './types';
import { makeContext } from './context';
import { resolveParams } from '../params';

const defaults = defaultParams();

const byId = (cs: AnalysisCheck[], id: string) => cs.find((c) => c.id === id)!;
const run = (p: Params) => runChecks(p, { includeTruck: false });

describe('runChecks at the defaults', () => {
  const cs = run(defaults);
  it('returns the full spec table, grouped, each with a formula-bearing `how`', () => {
    const ids = cs.map((c) => c.id);
    for (const id of [
      'mass-empty', 'cg', 'tip-straight', 'tip-lock', 'slide-before-tip', 'v-rollover', 'turn-radius', 'steer-clear', 'pitch-fwd', 'pitch-rear',
      'brake-force', 'brake-traction', 'axle-stress', 'beam-rear', 'bearing-groove', 'rails', 'deck', 'tongue', 'truck-fit',
      // the Phase 3b front end (D-50..D-56): bump-basis rows
      'spindle-stub', 'kingpin-bolt', 'kingpin-bracket', 'beam-front', 'tie-rod', 'bellcrank', 'tongue-tie', 'stick-cable', 'wheel-rating', 'rear-beam-seat',
    ]) expect(ids, id).toContain(id);
    // the old turntable / bolster / side-bearer / kingpin-strike rows are gone with the old design
    for (const id of ['kingpin', 'turntable', 'kingpin-strike', 'roll-side-bearer', 'roll-kingpin-uplift', 'roll-bolster-attach']) expect(ids, id).not.toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of cs) {
      expect(c.how.length, c.id).toBeGreaterThan(30);
      expect(['Stability', 'Steering', 'Braking', 'Structure', 'Mass & transport']).toContain(c.group);
      expect(Number.isFinite(c.value) && Number.isFinite(c.limit), c.id).toBe(true);
    }
  });
  it('cross-checks the DECISIONS hand-calc table (straight tip within 1.5 deg of its 47.1-50.2 deg range)', () => {
    const t = byId(cs, 'tip-straight').cases!.operating!.value;
    expect(t).toBeGreaterThan(47.1 - 1);
    expect(t).toBeLessThan(50.2 + 1.5);
    const l = byId(cs, 'tip-lock').cases!.operating!.value;
    expect(l).toBeGreaterThan(43.7 - 1);
    expect(l).toBeLessThan(46.6 + 4);
    const ssf = byId(cs, 'slide-before-tip').cases!.operating!.value;
    expect(ssf).toBeGreaterThan(0.95);
    expect(ssf).toBeLessThan(1.3);
  });
  it('turn radius (A-2, D-53): the pass/fail value is the outer tire EDGE from the mean Ackermann instant center, within the 108 in limit', () => {
    const t = byId(cs, 'turn-radius');
    const mean = t.details!.find((d) => d.name.includes('mean instant center'))!.value;
    expect(t.value).toBeCloseTo(mean, 9);
    expect(t.value).toBeLessThan(defaults.turnRadiusMaxIn);
    expect(t.value).toBeGreaterThan(80);
    // a sharper lock turns tighter
    expect(byId(run({ ...defaults, steerLockDeg: 40 }), 'turn-radius').value).toBeLessThan(t.value);
    expect(t.util).toBeCloseTo(t.value / defaults.turnRadiusMaxIn, 6);
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
  it('brake force follows F = W sin(theta) / mu / (ratio x eta) at the operating mass', () => {
    const W = buildModel(defaults, { rider: 'operating', cargo: true }).reduce((s, x) => s + x.massLb, 0);
    const F = (W * Math.sin((defaults.designSlopeDeg * Math.PI) / 180)) / defaults.brakePadMuFouled / (byId(cs, 'brake-ratio').details!.find((d) => d.name.includes('TOTAL ratio'))!.value * defaults.brakeEfficiency);
    const c = byId(cs, 'brake-force');
    expect(c.details!.find((d) => d.name.includes('mud / slush-fouled'))!.value).toBeCloseTo(F, 3);
    // the row value is the larger of the main-grip force and the hip-lever force (D-56): the hip lever is the harder one to pull
    const hip = c.details!.find((d) => d.name.includes('hip lever grip force'))!.value;
    expect(c.cases!.operating!.value).toBeCloseTo(Math.max(F, hip), 3);
  });
  it('rear axle stress is on the bump basis (D-50): normal and hard cases plus the skid case, goal case governing', () => {
    const c = byId(cs, 'axle-stress');
    expect(c.load).toBe('goal');
    expect(c.details!.some((d) => d.name.includes('NORMAL 1" rear bump'))).toBe(true);
    expect(c.details!.some((d) => d.name.includes('HARD 2" rear hit'))).toBe(true);
    expect(c.details!.some((d) => d.name.includes('deflection'))).toBe(true);
    expect(c.cases!.goal!.value).toBeGreaterThan(c.cases!.operating!.value);
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
  it('a thinner deck ply deflects more under the standing scout (D1): 9 mm is worse than the 12 mm default', () => {
    const defl = (p: Params) => byId(run(p), 'deck').details!.find((d) => d.name.includes('deflection'))!.value;
    expect(defl({ ...defaults, deckPlyIn: 0.354 })).toBeGreaterThan(defl(defaults));
    expect(defl({ ...defaults, deckPlyIn: 0.709 })).toBeLessThan(defl(defaults));
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
  it('a longer tongue lowers the tongue row margin (longer lever arm)', () => {
    const u = (p: Params) => byId(run(p), 'tongue').util;
    expect(u({ ...defaults, tongueLengthIn: 30 })!).toBeGreaterThanOrEqual(u(defaults)!);
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
  it('runChecks takes under 100 ms at the defaults without the truck call (the bump-basis rows cost about 60 ms)', () => {
    run(defaults); // warm up
    const t0 = performance.now();
    const N = 10;
    for (let i = 0; i < N; i++) run(defaults);
    const per = (performance.now() - t0) / N;
    console.log(`runChecks (no truck): ${per.toFixed(1)} ms`);
    expect(per).toBeLessThan((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CI ? 300 : 100);
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
    'wheelbaseIn', 'rearTrackIn', 'frontTrackIn', 'deckHeightIn', 'bodyWidthIn', 'seatXIn', 'wheelDiameterIn', 'steerLockDeg',
    'kingpinLeadIn', 'rearOverhangIn', 'frontOverhangIn', 'sideHeightIn', 'tireWidthIn', 'axleBeamThicknessIn',
    'axleBeamDepthIn', 'railDepthIn', 'railThicknessIn', 'crossmemberDepthIn', 'crossmemberSpacingIn', 'deckPlyIn', 'seatDepthIn',
    'tongueLengthIn', 'pullerHandHeightIn', 'brakeLeverRatio', 'riderMassLb', 'riderGoalMassLb', 'cargoMassLb', 'axleDiameterIn', 'designSlopeDeg',
    'tireGroundMu', 'dynamicFactor', 'sideThicknessIn', 'panelPlyIn',
  ];
  const OPTIONS: ParamKey[] = ['frameStyle', 'sideConstruction', 'storageLocation', 'axleBeamPosition', 'axleStyle', 'plySpecies'];
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
  }, 60000); // heavy sweep (front-end bounding cases); shared CI runners are 2-3x slower
});

describe('hand-calculated numbers at the defaults', () => {
  const cs = run(defaults);
  const ctx = makeContext(resolveParams(defaults), buildModel(resolveParams(defaults), { rider: 'goal', cargo: true, steerDeg: 0 }));
  const goal = (id: string) => byId(cs, id).cases!.goal!;
  const op = (id: string) => byId(cs, id).cases!.operating!;

  it('M2: compression perpendicular allowable is 1070 x 0.67 / 2 = 358.45 psi', () => {
    expect(goal('bearing-groove').limit).toBeCloseTo(358.45, 2);
    expect(byId(run({ ...defaults, wetServiceFactorCompPerp: 0.85 }), 'bearing-groove').cases!.goal!.limit).toBeCloseTo(454.75, 2);
  });
  it('D1 deck: effective strip width b_eff = patch + 0.625 x span', () => {
    expect(effectiveStripWidth(10, 10.16)).toBeCloseTo(16.35, 2);
    const c = byId(cs, 'deck');
    expect(c.details!.some((d) => d.name.includes('deflection'))).toBe(true);
  });
  it('layout: a thicker deck ply no longer lengthens the span next to the rear beam (D1 oddity)', () => {
    const span = (t: number) => maxDeckSpan({ L: computeLayout({ ...defaults, deckPlyIn: t }) } as never);
    expect(span(0.472)).toBeLessThan(span(0.354) + 0.1);
  });
  it('liftPull: W = 100 lb, x = 20", h = 10", theta = 0, pull point 60" ahead at ground level at alpha = 30 deg: T = 100 x 20 / (60 x 0.5) = 66.7 lbf', () => {
    expect(liftPull(100, 20, 10, 0, 60, 0, Math.PI / 6)).toBeCloseTo(66.67, 1);
    expect(liftPull(100, 20, 10, 0, 0, 0, 0)).toBe(Infinity);
  });
  it('H3 pitch-rear: T_lift = W(x cos(th) - h sin(th)) / (x_p sin(a) - z_p cos(a)); the ratio to the pull is reported for every rider', () => {
    const c = byId(cs, 'pitch-rear');
    const pt = pullPoint(ctx);
    const alpha = Math.atan2(defaults.pullerHandHeightIn - pt.z, defaults.bridleRopeRunIn);
    const th = (defaults.designSlopeDeg * Math.PI) / 180;
    const ratio = (k: 'operating' | 'goal' | 'light') => {
      const q = ctx.loads[k];
      return (q.massLb * (q.cg[0] * Math.cos(th) - q.cg[2] * Math.sin(th))) / (pt.x * Math.sin(alpha) - pt.z * Math.cos(alpha)) / defaults.pullForceLbf;
    };
    expect(c.cases!.operating!.value).toBeCloseTo(ratio('operating'), 2);
    expect(c.cases!.goal!.value).toBeCloseTo(ratio('goal'), 2);
    expect(c.cases!.light!.value).toBeCloseTo(ratio('light'), 2);
    expect(c.cases!.light!.limit).toBe(defaults.pitchPullMarginMin);
    expect(c.how).toMatch(/Lightest rider/);
  });
  it('H3: a lower design slope or a heavier lightest rider raises the lift ratio; the rope run is a param', () => {
    const v = (q: Partial<Params>) => byId(run({ ...defaults, ...q }), 'pitch-rear').cases!.light!.value;
    expect(v({ riderMinMassLb: 100 })).toBeGreaterThan(v({}));
    expect(v({ designSlopeDeg: 10 })).toBeGreaterThan(v({}));
    expect(v({ bridleRopeRunIn: 120 })).not.toBeCloseTo(v({}), 2);
  });
  it('L1 pitch-fwd: N_r = W (cos(th) (WB - x)/WB - sin(th) h/WB), a/g = mu N_r / W, equivalent angle acos((a/g) / ((WB - x)/h)) - design slope', () => {
    const q = ctx.loads.operating, WB = defaults.wheelbaseIn, th = (defaults.designSlopeDeg * Math.PI) / 180;
    const Nr = q.massLb * (Math.cos(th) * (WB - q.cg[0]) / WB - Math.sin(th) * q.cg[2] / WB);
    const geo = (WB - q.cg[0]) / q.cg[2];
    const handDeg = (Math.acos(Math.min(1, (defaults.tireGroundMu * Nr / q.massLb) / geo)) * 180) / Math.PI - defaults.designSlopeDeg;
    expect(op('pitch-fwd').value).toBeCloseTo(handDeg, 1);
  });
  it('L2 brake: the mud-fouled case (mu 0.35) is pass/fail and bare wet oak (mu 0.25) is info only: F_fouled = F_wet x 0.45 / 0.35, F_bare = F_wet x 0.45 / 0.25', () => {
    const c = byId(cs, 'brake-force');
    const wet = c.details!.find((d) => d.name.includes('wet bonded lining'))!;
    const fouled = c.details!.find((d) => d.name.includes('fouled'))!;
    const bare = c.details!.find((d) => d.name.includes('bare wet oak'))!;
    expect(fouled.value / wet.value).toBeCloseTo(0.45 / 0.35, 3);
    expect(bare.value / wet.value).toBeCloseTo(0.45 / 0.25, 3);
    const hip = c.details!.find((d) => d.name.includes('hip lever grip force'))!.value;
    expect(c.cases!.operating!.value).toBeCloseTo(Math.max(fouled.value, hip), 6); // the larger of the main grip and the hip lever (D-56)
    expect(c.how).toMatch(/TOTAL shoe normal force/);
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
  });
  it('the governing case of a failing row is the failing case (so the chip matches the value shown)', () => {
    const a = byId(cs, 'axle-stress');
    expect(a.cases![a.governingLoad as 'goal']!.status).toBe(a.status);
    for (const c of cs) if (c.cases && c.status === 'fail') expect(c.cases[c.governingLoad as 'goal']!.status, c.id).toBe('fail');
  });
});
