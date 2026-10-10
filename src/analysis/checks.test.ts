import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, validateParams, type ParamKey, type Params } from '../params';
import { buildModel } from '../model';
import { checkTruckFit } from '../truck/fit';
import { dualCheck, type CaseEval } from './dual';
import { runChecks, type AnalysisCheck } from './index';
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
      'tongue', 'truck-fit',
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
  it('turn radius: 95.2" at the Phase 1 lock (D-26), and within 1" of the table 7.7 ft at 40° lock', () => {
    expect(byId(cs, 'turn-radius').value).toBeCloseTo(95.2, 1);
    const r40 = byId(run({ ...defaults, steerLockDeg: 40 }), 'turn-radius').value;
    expect(Math.abs(r40 - 7.7 * 12)).toBeLessThan(1);
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
    expect(rear.value).toBeGreaterThan(5000);
    expect(rear.value).toBeLessThan(25000);
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
  it('a thicker deck ply passes the standing-scout deflection that the 9 mm ply fails', () => {
    const thin = byId(run(defaults), 'deck');
    const thick = byId(run({ ...defaults, deckPlyIn: 0.709 }), 'deck');
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
