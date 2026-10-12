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

const defaults = { ...defaultParams(), frontTrackIn: 35.5, rearTrackIn: 35.5, axleHangerThickIn: 0.75, clampPlateWidthIn: 1.5 }; // the 3c-3 hand-calc fixture: the 35.5 in tracks (D-58 narrowed them to 34 1/2 / 32 in; the new defaults are in track-d58.test.ts)

const byId = (cs: AnalysisCheck[], id: string) => cs.find((c) => c.id === id)!;
const run = (p: Params) => runChecks(p, { includeTruck: false });
/** The same context `runChecks` builds (goal rider and cargo parts, front axle straight) for hand calculations from the load cases. */
const ctx = makeContext(resolveParams(defaults), buildModel(resolveParams(defaults), { rider: 'goal', cargo: true }));

describe('runChecks at the defaults', () => {
  const cs = run(defaults);
  it('returns the full spec table, grouped, each with a formula-bearing `how`', () => {
    const ids = cs.map((c) => c.id);
    for (const id of [
      'mass-empty', 'cg', 'tip-straight', 'tip-lock', 'slide-before-tip', 'v-rollover', 'turn-radius', 'steer-clear', 'pitch-fwd', 'pitch-rear',
      'axle-stress', 'beam-rear', 'bearing-groove', 'rails', 'deck', 'truck-fit',
      // the pivoting front axle (D-56), the tongue tie and the bump-basis rear rows
      'kingpin', 'king-bearing', 'front-beam', 'front-stub', 'steer-stops', 'king-beam', 'bridle-eye', 'wheel-rating', 'rear-beam-seat',
    ]) expect(ids, id).toContain(id);
    // (the foot-operated rear brake rows, D-55, are covered in brake.test.ts and are not listed here)
    // the old turntable / bolster / side-bearer / kingpin-strike rows, the Ackermann rows and the caster rows are gone
    for (const id of ['turntable', 'kingpin-strike', 'roll-side-bearer', 'roll-kingpin-uplift', 'roll-bolster-attach',
      // Phase 3c-1 (D-53): ride mode, front brakes, hip lever and lap belt
      'stick-cable', 'ride-rollover', 'ride-envelope', 'steer-centering', 'ride-steer-effort', 'brake-stop', 'brake-emergency', 'brake-bias', 'brake-heat', 'brake-front', 'hip-cable', 'belt-anchor', 'brake-shaft', 'brake-ratchet',
      // Phase 3c-3a (D-54): the Ackermann front end, its tongue and the full-lock rows; the swivel casters
      'spindle-stub', 'spindle-fatigue', 'kingpin-bolt', 'kingpin-bracket', 'wheel-retention', 'beam-front', 'tie-rod', 'drag-link', 'bellcrank', 'steer-stop-load', 'tongue', 'tongue-tie', 'steer-kin', 'steer-lock',
      'tip-swivel', 'caster-clear', 'caster-rating', 'caster-mount']) expect(ids, id).not.toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of cs) {
      expect(c.how.length, c.id).toBeGreaterThan(30);
      expect(['Stability', 'Steering', 'Braking', 'Structure', 'Mass & transport']).toContain(c.group);
      expect(Number.isFinite(c.value) && Number.isFinite(c.limit), c.id).toBe(true);
    }
  });
  it('the front-end rows belong to the groups the UI expects: the pivot rows and the bridle tie are Structure, the clearances and turning are Steering, the tips are Stability', () => {
    for (const id of ['kingpin', 'king-bearing', 'front-beam', 'front-stub', 'steer-stops', 'king-beam', 'bridle-eye', 'wheel-rating', 'rear-beam-seat']) expect(byId(cs, id).group, id).toBe('Structure');
    for (const id of ['turn-radius', 'steer-clear']) expect(byId(cs, id).group, id).toBe('Steering');
    for (const id of ['tip-straight', 'tip-lock', 'slide-before-tip', 'v-rollover', 'pitch-fwd', 'pitch-rear']) expect(byId(cs, id).group, id).toBe('Stability');
  });
  /** Hand calc of the lateral tip: the front axle turned by `a` degrees about the kingpin (44, 0); the side edges run from each rear tire (0, +-17.75) to the front tire on that side. */
  const tipAt = (cg: number[], a: number) => {
    const s = (a * Math.PI) / 180;
    const fl = [44 - 17.75 * Math.sin(s), 17.75 * Math.cos(s)], fr = [44 + 17.75 * Math.sin(s), -17.75 * Math.cos(s)];
    const dL = Math.abs(fl[0] * (cg[1] - 17.75) - (fl[1] - 17.75) * cg[0]) / Math.hypot(fl[0], fl[1] - 17.75);
    const dR = Math.abs(fr[0] * (cg[1] + 17.75) - (fr[1] + 17.75) * cg[0]) / Math.hypot(fr[0], fr[1] + 17.75);
    return Math.min(dL, dR);
  };
  it('lateral tip by hand (operating rider, about 308 lb, CG about (16.2, 0, 14.1)): straight ahead d = 17.75 - ~0.0 -> atan(17.75 / 14.1) = 51.6 deg; at full lock the side edge to the trailing front tire is 17.25 in away: atan(17.25 / 14.1) = 50.9 deg', () => {
    const c = ctx.loads.operating;
    const [x, , h] = c.cg;
    expect(Math.abs(x - 16.2)).toBeLessThan(1); // the CG moves as parts change (D-58: the heavier front end moves it forward 0.7 in); the hand calc below is from the case itself
    expect(Math.abs(h - 14.1)).toBeLessThan(0.5);
    let worst = Infinity;
    for (let a = -20; a <= 20; a += 1) worst = Math.min(worst, (Math.atan2(tipAt(c.cg, a), h) * 180) / Math.PI);
    expect(byId(cs, 'tip-straight').cases!.operating!.value).toBeCloseTo(worst, 2);
    expect(worst).toBeCloseTo(50.9, 0);
    expect((Math.atan2(tipAt(c.cg, 0), h) * 180) / Math.PI).toBeCloseTo(51.6, 0); // straight ahead is the better case
    // tip-lock is the same at exactly +-20 degrees (the worst case of the sweep is at full lock)
    expect(byId(cs, 'tip-lock').cases!.operating!.value).toBeCloseTo(Math.min((Math.atan2(tipAt(c.cg, 20), h) * 180) / Math.PI, (Math.atan2(tipAt(c.cg, -20), h) * 180) / Math.PI), 6);
    expect(byId(cs, 'tip-straight').cases!.operating!.limit).toBe(40);
    expect(byId(cs, 'tip-lock').cases!.operating!.limit).toBe(35);
    // slide-before-tip: SSF = d_outer / h with the outer edge RR-FR at +20 (d = (50.071 x 17.75 - 1.0706 x x) / 50.08 for y = 0)
    const ssf = byId(cs, 'slide-before-tip').cases!.operating!;
    const dOut = (50.0711 * 17.75 - 1.0706 * x) / Math.hypot(50.0711, 1.0706);
    expect(ssf.value).toBeCloseTo(dOut / h, 2);
    expect(ssf.limit).toBeCloseTo(0.75, 9); // 1.5 x mu 0.5
  });
  it('the stability rows PASS at the defaults with the wide 35.5 in track and the 14 in CG: tip 50.3 deg vs 40, at lock 50.3 vs 35, SSF 1.21 vs 0.75', () => {
    for (const id of ['tip-straight', 'tip-lock', 'slide-before-tip']) {
      const r = byId(cs, id);
      expect(r.status, id).toBe('pass');
      expect(r.statusOperating, id).toBe('pass');
      expect(r.statusGoal, id).toBe('pass');
    }
    expect(byId(cs, 'tip-straight').util).toBeLessThan(1);
    expect(byId(cs, 'tip-straight').label).toMatch(/worst steer/);
  });
  it('D-58: the front-end rows that failed in 3c-3 (king-bearing 11x, steer-stops 2.5x, bridle-eye 3.7x, steer-clear) all pass at the defaults, with the roll pads, the check chains, the oak tongue and the 1/8 in clearances', () => {
    for (const id of ['king-bearing', 'steer-stops', 'bridle-eye', 'steer-clear', 'kingpin', 'front-beam', 'front-stub', 'king-beam', 'lift']) expect(byId(cs, id).status, id).not.toBe('fail');
    expect(byId(cs, 'king-bearing').util!).toBeLessThan(1);
    expect(byId(cs, 'bridle-eye').util!).toBeLessThan(1);
  });
  it('turn radius (A-2, D-56): the outer tire edge radius WB / sin(20 deg) + track/2 + tire/2 = 128.6 + 17.75 + 1.75 = 148.1 in against the relaxed 150 in (12.5 ft) limit: marginal', () => {
    const t = byId(cs, 'turn-radius');
    const hand = 44 / Math.sin((20 * Math.PI) / 180) + 17.75 + 3.5 / 2;
    expect(hand).toBeCloseTo(148.15, 2);
    expect(t.value).toBeCloseTo(hand, 6);
    expect(defaults.turnRadiusMaxIn).toBe(150);
    expect(t.limit).toBe(150);
    expect(t.status).toBe('marginal');
    expect(t.util).toBeCloseTo(hand / 150, 6);
    expect(t.group).toBe('Steering');
    // the center radius WB / tan(lock) = 120.9 in (turning circle about 20 ft) is in the text
    expect(t.how).toMatch(/120\.9/);
    // a smaller lock turns wider and fails the limit: 15 deg -> 44 / sin 15 + 19.5 = 189.5 in
    expect(byId(run({ ...defaults, steerLockDeg: 15 }), 'turn-radius').value).toBeCloseTo(44 / Math.sin((15 * Math.PI) / 180) + 19.5, 1);
    expect(byId(run({ ...defaults, steerLockDeg: 15 }), 'turn-radius').status).toBe('fail');
  });
  it('goal rider is heavier and tips earlier than the operating rider', () => {
    const t = byId(cs, 'tip-straight').cases!;
    expect(t.goal!.value).toBeLessThan(t.operating!.value);
    expect(byId(cs, 'tip-straight').load).toBe('operating');
    expect(byId(cs, 'rails').load).toBe('goal'); // structure: D-2
  });
  it('the info rows never fail', () => {
    for (const id of ['mass-empty', 'cg', 'v-rollover']) expect(byId(cs, id).status, id).toBe('info');
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
  it('real run: a wheel rating between the 150 lb and 200 lb peak loads flags the goal rider (rear wheel, 2 x rating vs the 1 in / 3 mph peak: 305 lbf operating, 333.5 lbf goal)', () => {
    const base = byId(run(defaults), 'wheel-rating').cases!;
    expect(base.operating!.value).toBeLessThan(base.goal!.value);
    // peak limit = 2 x rating = 320 lbf (rating 160): the 150 lb rider's 305 lbf is within 10% (marginal), the 200 lb rider's 333.5 lbf fails
    const c = byId(run({ ...defaults, wheelRatingLb: 160 }), 'wheel-rating');
    expect(c.statusOperating).toBe('marginal');
    expect(c.statusGoal).toBe('fail');
    expect(c.status).toBe('fail');
    expect(c.goalFlag).toBe(true);
    expect(c.how).toMatch(/GOAL RIDER FLAG/);
  });
  it('structural rows show the goal case and still report the operating status', () => {
    const c = byId(run(defaults), 'axle-stress');
    expect(c.load).toBe('goal');
    expect(c.cases!.goal!.value).toBeGreaterThan(c.cases!.operating!.value);
  });
});
describe('parameter response', () => {
  it('a narrower rear track lowers the lateral tip angle; a wider front track raises it; a lower deck raises it (a lower CG)', () => {
    const base = byId(run(defaults), 'tip-straight').value;
    expect(byId(run({ ...defaults, rearTrackIn: 33 }), 'tip-straight').value).toBeLessThan(base);
    expect(byId(run({ ...defaults, frontTrackIn: 40 }), 'tip-straight').value).toBeGreaterThan(base);
    expect(byId(run({ ...defaults, deckHeightIn: 7.5 }), 'tip-straight').value).toBeGreaterThan(base);
    expect(byId(run({ ...defaults, deckHeightIn: 12 }), 'tip-straight').value).toBeLessThan(base);
  });
  it('a thinner deck ply deflects more under the standing scout (D1): 9 mm is worse than the 12 mm default', () => {
    const defl = (p: Params) => byId(run(p), 'deck').details!.find((d) => d.name.includes('deflection'))!.value;
    expect(defl({ ...defaults, deckPlyIn: 0.354 })).toBeGreaterThan(defl(defaults));
    expect(defl({ ...defaults, deckPlyIn: 0.709 })).toBeLessThan(defl(defaults));
  });
  it('the rails row is the straight oak ladder rail (the hull-beam / girder frame option is gone, D-54)', () => {
    const c = byId(run(defaults), 'rails');
    expect(c.label).not.toMatch(/girder/i);
    expect(c.how).not.toMatch(/transformed I-section/);
    expect(c.details!.some((d) => d.name.includes('ply web'))).toBe(false);
    // an old shared link with frameStyle = 1 loads but changes nothing
    expect(byId(run({ ...defaults, frameStyle: 1 } as unknown as Params), 'rails').value).toBeCloseTo(c.value, 9);
  });
  it('stub axles use the beam face as the cantilever root', () => {
    const c = byId(run({ ...defaults, axleStyle: 1 }), 'axle-stress');
    expect(c.how).toMatch(/stub axle/);
  });
  it('a bigger thrust washer lowers the king-bearing util, and a bigger bridle pull raises the bridle-eye util', () => {
    const u = (q: Partial<Params>, id: string) => byId(run({ ...defaults, ...q }), id).util!;
    const disc = (q: Partial<Params>) => byId(run({ ...defaults, ...q }), 'king-bearing').details!.find((d) => /^static front axle load on the UHMW disc/.test(d.name))!.util;
    expect(disc({ kingThrustOdIn: 3.5 })).toBeLessThan(disc({})); // the bigger disc has more area under the same load
    expect(u({ pullForceLbf: 200 }, 'bridle-eye')).toBeGreaterThan(u({}, 'bridle-eye'));
  });
});

describe('truck fit option and performance', () => {
  it('skips the truck by option, reuses a supplied FitResult, or computes it', () => {
    expect(byId(run(defaults), 'truck-fit').status).toBe('info');
    const fit = checkTruckFit(defaults, (v) => buildModel(defaults, v));
    const reused = byId(runChecks(defaults, { fit }), 'truck-fit');
    expect(reused.status).toBe(fit.cases.some((c) => c.config === 'removed' && c.fits) ? 'pass' : 'fail');
    expect(byId(runChecks(defaults), 'truck-fit').value).toBe(reused.value);
    expect(reused.how).toMatch(/off only/);
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
    'wheelbaseIn', 'rearTrackIn', 'frontTrackIn', 'steerLockDeg', 'kingThrustOdIn', 'deckHeightIn', 'bodyWidthIn', 'seatXIn', 'wheelDiameterIn',
    'tongueDepthIn', 'rearOverhangIn', 'frontOverhangIn', 'sideHeightBowIn', 'sideHeightRearIn', 'tireWidthIn', 'axleBeamThicknessIn',
    'axleBeamDepthIn', 'railDepthIn', 'railThicknessIn', 'crossmemberDepthIn', 'crossmemberSpacingIn', 'deckPlyIn', 'seatDepthIn',
    'pullerHandHeightIn', 'bumpSpeedNormalMph', 'bumpSpeedHardMph', 'riderMassLb', 'riderGoalMassLb', 'cargoMassLb', 'axleDiameterIn', 'designSlopeDeg',
    'tireGroundMu', 'dynamicFactor', 'sideThicknessIn', 'sheerCurveIn', 'bowTurnInIn', 'bowBulkheadThickIn', 'bowBulkheadHeightIn', 'handleBowCrownIn', 'footBlockSlot', 'seatDepthIn',
  ];
  const OPTIONS: ParamKey[] = ['storageLocation', 'axleBeamPosition', 'axleStyle', 'plySpecies'];
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
        if (c.id.startsWith('brake-') || c.id === 'park-hold') continue; // the foot-brake rows (D-55) are replaced by another agent and have their own tests (brake.test.ts)
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
  it('H3 pitch-rear at the defaults: the rope runs from the shackle in the oak tongue (x 54.25, z 4.19) up to the hands at 30 in over a 96 in run, 15.05 deg; x_p sin(a) - z_p cos(a) = 54.25 x 0.2597 - 4.19 x 0.9657 = 10.04 > 0, so the pull has a lift moment arm: T_lift = W (x cos th - h sin th) / 8.63, about 3x the 150 lbf peak', () => {
    const c = byId(cs, 'pitch-rear');
    const pt = pullPoint(ctx);
    expect(pt.x).toBeCloseTo(54.25, 9); // the tie hole of the oak tongue (tipX 55.75 - the 1.5 in tip edge, D-58)
    expect(pt.z).toBeCloseTo(4.1875, 4); // mid-depth of the tongue (beam top 5.375 - 3/16 drop - 1 in)
    const alpha = Math.atan2(defaults.pullerHandHeightIn - pt.z, defaults.bridleRopeRunIn);
    expect(alpha * 180 / Math.PI).toBeCloseTo(15.05, 1);
    const den = pt.x * Math.sin(alpha) - pt.z * Math.cos(alpha);
    expect(den).toBeCloseTo(10.04, 1);
    const th = (defaults.designSlopeDeg * Math.PI) / 180;
    for (const k of ['operating', 'goal', 'light'] as const) {
      const w = ctx.loads[k];
      const ratio = (w.massLb * (w.cg[0] * Math.cos(th) - w.cg[2] * Math.sin(th))) / den / defaults.pullForceLbf;
      expect(c.cases![k]!.value, k).toBeCloseTo(ratio, 2);
      expect(c.cases![k]!.limit, k).toBe(defaults.pitchPullMarginMin);
    }
    expect(c.cases!.operating!.value).toBeGreaterThan(defaults.pitchPullMarginMin);
    expect(c.cases!.light!.value).toBeLessThan(c.cases!.goal!.value); // the lighter rider lifts sooner
    expect(c.status).toBe('pass');
    expect(liftPull(ctx.loads.goal.massLb, ctx.loads.goal.cg[0], ctx.loads.goal.cg[2], th, pt.x, pt.z, alpha)).toBeCloseTo(c.cases!.goal!.value * defaults.pullForceLbf, 6);
    expect(c.how).toMatch(/Lightest rider/);
  });
  it('H3 pitch-rear in the regime where the pull can lift (hands 40 in up, only 36 in ahead: 43 deg above the tie): T_lift = W (x cos(th) - h sin(th)) / (x_p sin(a) - z_p cos(a)); the ratio to the 150 lbf pull is reported for every rider', () => {
    const q = { pullerHandHeightIn: 40, bridleRopeRunIn: 36 };
    const p2 = resolveParams({ ...defaults, ...q });
    const ctx2 = makeContext(p2, buildModel(p2, { rider: 'goal', cargo: true }));
    const c = byId(run({ ...defaults, ...q }), 'pitch-rear');
    const pt = pullPoint(ctx2);
    const alpha = Math.atan2(40 - pt.z, 36);
    expect(alpha * 180 / Math.PI).toBeCloseTo(44.85, 1);
    const den = pt.x * Math.sin(alpha) - pt.z * Math.cos(alpha);
    expect(den).toBeCloseTo(35.3, 0);
    const th = (defaults.designSlopeDeg * Math.PI) / 180;
    const ratio = (k: 'operating' | 'goal' | 'light') => {
      const w = ctx2.loads[k];
      return (w.massLb * (w.cg[0] * Math.cos(th) - w.cg[2] * Math.sin(th))) / den / defaults.pullForceLbf;
    };
    expect(c.cases!.operating!.value).toBeCloseTo(ratio('operating'), 2);
    expect(c.cases!.goal!.value).toBeCloseTo(ratio('goal'), 2);
    expect(c.cases!.light!.value).toBeCloseTo(ratio('light'), 2);
    expect(c.cases!.light!.value).toBeLessThan(c.cases!.goal!.value); // the lighter rider lifts sooner
    expect(c.cases!.light!.limit).toBe(defaults.pitchPullMarginMin);
  });
  it('H3: in the lifting regime a lower design slope or a heavier lightest rider raises the lift ratio; the rope run is a param', () => {
    const q0 = { pullerHandHeightIn: 40, bridleRopeRunIn: 36 };
    const v = (q: Partial<Params>) => byId(run({ ...defaults, ...q0, ...q }), 'pitch-rear').cases!.light!.value;
    expect(v({ riderMinMassLb: 100 })).toBeGreaterThan(v({}));
    expect(v({ designSlopeDeg: 10 })).toBeGreaterThan(v({}));
    expect(v({ bridleRopeRunIn: 60 })).not.toBeCloseTo(v({}), 2);
  });
  it('L1 pitch-fwd (front contacts on the kingpin line, WB = 44 in): N_r = W (cos(th) (WB - x)/WB - sin(th) h/WB), a/g = mu N_r / W, equivalent angle acos((a/g) / ((WB - x)/h)) - design slope', () => {
    const q = ctx.loads.operating, WB = defaults.wheelbaseIn, th = (defaults.designSlopeDeg * Math.PI) / 180;
    const Nr = q.massLb * (Math.cos(th) * (WB - q.cg[0]) / WB - Math.sin(th) * q.cg[2] / WB);
    const geo = (WB - q.cg[0]) / q.cg[2];
    const handDeg = (Math.acos(Math.min(1, (defaults.tireGroundMu * Nr / q.massLb) / geo)) * 180) / Math.PI - defaults.designSlopeDeg;
    expect(op('pitch-fwd').value).toBeCloseTo(handDeg, 1);
  });
  // (the brake force / lining rows of the old hand lever are replaced by the foot drag brake, D-55; they are tested in brake.test.ts)
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

describe('3c-5: the rows say sled, not cart', () => {
  it('no check label, how-text or detail name says "cart" (hand cart and billy-cart aside)', () => {
    const strip = (s: string | undefined) => (s ?? '').replace(/hand cart|billy-cart/gi, '');
    for (const c of runChecks(defaultParams(), { includeTruck: false })) {
      expect(strip(c.label), c.id).not.toMatch(/\bcarts?\b/i);
      expect(strip(c.how), c.id).not.toMatch(/\bcarts?\b/i);
      for (const d of c.details ?? []) expect(strip(d.name), `${c.id}: ${d.name}`).not.toMatch(/\bcarts?\b/i);
    }
  });
});
