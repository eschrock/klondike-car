/**
 * Phase 2 parameter-space exploration (docs/phase2-spec.md "Exploration"). Writes docs/phase2-exploration.md.
 *
 * Run:  node scripts/run-ts.mjs scripts/explore.ts      (vite-node is not installed; run-ts.mjs is a 5-line stand-in
 *       built on vite's ssrLoadModule. `npx vite-node scripts/explore.ts` works too when vite-node is available.)
 *
 * Stages: (1) one-at-a-time sensitivities around the defaults, (2) a focused grid over the most influential
 * variables, (3) beside-wells vs straddle at the best setting of each. autoNoseGeometry is always on (D-26).
 * Hand-written prose lives between <!-- obs:start --> and <!-- obs:end --> in the output and is preserved on re-runs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { defaultParams, derived, DRAWBAR, resolveParams, validateParams, type Params } from '../src/params';
import { buildModel } from '../src/model';
import { totalMass } from '../src/model/mass';
import { runChecks, type AnalysisCheck } from '../src/analysis';
import { checkTruckFit, type Config, type FitResult, type Stowage } from '../src/truck/fit';

const T0 = Date.now();
const OUT = new URL('../docs/phase2-exploration.md', import.meta.url).pathname;
const log = (s: string) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}`);

// ── evaluation ──────────────────────────────────────────────────────────────────────────────────────────────

type Over = Partial<Params>;
const BASE = (): Params => ({ ...defaultParams(), autoNoseGeometry: 1 });
const mk = (o: Over): Params => ({ ...BASE(), ...o });

const MARGIN_IDS = ['tip-straight', 'tip-lock', 'slide-before-tip', 'v-rollover', 'turn-radius', 'steer-clear', 'pitch-fwd', 'pitch-rear',
  'brake-force', 'axle-stress', 'beams', 'rails', 'deck', 'tongue'] as const;
type MarginId = (typeof MARGIN_IDS)[number];
const STABILITY_IDS: MarginId[] = ['tip-straight', 'tip-lock', 'slide-before-tip', 'pitch-fwd', 'pitch-rear'];
const GATE_IDS: MarginId[] = ['tip-straight', 'tip-lock', 'slide-before-tip', 'pitch-fwd', 'pitch-rear', 'turn-radius', 'steer-clear', 'brake-force'];

interface Counts { pass: number; marginal: number; fail: number }
interface Fit { beside: { removed: boolean; tongueOff: boolean; axlesClear: boolean | null }; straddle: { removed: boolean; tongueOff: boolean; axlesClear: boolean | null } }

interface Design {
  over: Over;
  p: Params;
  mass: number;
  transport: number;
  cg: number;
  op: Counts;
  goal: Counts;
  /** Fractional margin per check, worst of the operating and goal cases: (v-l)/l for >=, (l-v)/l for <=; negative fails. */
  m: Record<MarginId, number>;
  /** Margin at the operating case only (for the 150 lb "must pass" reading). */
  mOp: Record<MarginId, number>;
  fit: Fit | null;
  intended: Stowage;
  intendedFits: boolean | null;
  /** min margin over the stability checks (the Pareto score) and over stability + steering + braking. */
  score: number;
  gateScore: number;
  checks: AnalysisCheck[];
}

const CHECK_COUNT_IDS = (c: AnalysisCheck) => c.id !== 'truck-fit' && c.id !== 'mass-empty' && c.id !== 'cg';

function frac(v: number, l: number, sense: '>=' | '<=', designSlope: number): number {
  if (!Number.isFinite(v)) return -9.99;
  if (l === 0) return sense === '>=' ? v / designSlope : -v / designSlope; // pitch-fwd: degrees above zero ÷ design slope
  const m = sense === '>=' ? (v - l) / Math.abs(l) : (l - v) / Math.abs(l);
  return Math.max(-9.99, Math.min(9.99, m));
}

function marginOf(cs: AnalysisCheck[], ids: string[], p: Params, which: 'both' | 'op'): number {
  let best = Infinity;
  for (const c of cs) {
    if (!ids.includes(c.id)) continue;
    const list = c.cases ? (which === 'op' ? [c.cases.operating!] : [c.cases.operating!, c.cases.goal!]) : [{ value: c.value, limit: c.limit }];
    for (const k of list) best = Math.min(best, frac(k.value, k.limit, c.sense, p.designSlopeDeg));
  }
  return best;
}

function counts(cs: AnalysisCheck[], key: 'statusOperating' | 'statusGoal'): Counts {
  const r = { pass: 0, marginal: 0, fail: 0 };
  for (const c of cs) {
    if (!CHECK_COUNT_IDS(c)) continue;
    const s = c[key];
    if (s === 'pass') r.pass++;
    else if (s === 'marginal') r.marginal++;
    else if (s === 'fail') r.fail++;
  }
  return r;
}

function fitSummary(fit: FitResult): Fit {
  const ok = (mode: Stowage, config: Config) => fit.cases.some((c) => c.mode === mode && c.config === config && c.fits);
  const clear = (mode: Stowage) => fit.cases.filter((c) => c.mode === mode && c.config === 'removed' && c.fits).map((c) => c.axlesClearWells).find((x) => x !== undefined) ?? null;
  return {
    beside: { removed: ok('beside', 'removed'), tongueOff: ok('beside', 'tongue-off'), axlesClear: clear('beside') },
    straddle: { removed: ok('straddle', 'removed'), tongueOff: ok('straddle', 'tongue-off'), axlesClear: clear('straddle') },
  };
}

let nInvalid = 0;
const invalidWhy: Record<string, number> = {};
let nEval = 0;

/** Evaluate one design. Returns null (and counts it) when the validator reports an error. */
function evaluate(over: Over, withTruck: boolean): Design | null {
  const p = mk(over);
  const errs = validateParams(p).filter((i) => i.severity === 'error');
  if (errs.length) {
    nInvalid++;
    for (const e of errs) { const k = e.message.replace(/[0-9.]+/g, '#').split(/[.;(]/)[0].trim(); invalidWhy[k] = (invalidWhy[k] ?? 0) + 1; }
    return null;
  }
  nEval++;
  const rp = resolveParams(p);
  const build = (v: Parameters<typeof buildModel>[1]) => buildModel(rp, v);
  let fitRes: FitResult | undefined;
  if (withTruck) fitRes = checkTruckFit(rp, build);
  const cs = runChecks(p, withTruck ? { fit: fitRes } : { includeTruck: false });
  const get = (id: string) => cs.find((c) => c.id === id)!;
  const m = {} as Record<MarginId, number>;
  const mOp = {} as Record<MarginId, number>;
  for (const id of MARGIN_IDS) {
    const ids = id === 'beams' ? ['beam-front', 'beam-rear'] : [id];
    m[id] = marginOf(cs, ids, rp, 'both');
    mOp[id] = marginOf(cs, ids, rp, 'op');
  }
  const d = derived(rp);
  const fit = fitRes ? fitSummary(fitRes) : null;
  // Intended mode = beside whenever the removed config fits beside the wells, else straddle (D-6, D-23).
  const intended: Stowage = fit ? (fit.beside.removed ? 'beside' : 'straddle') : Math.max(rp.frontTrackIn, rp.rearTrackIn) <= d.maxTrackBesideWells + 1e-9 ? 'beside' : 'straddle';
  const transport = totalMass(buildModel(rp, { removed: true, rider: 'none', cargo: false, steerDeg: 0 }));
  const mn = (ids: MarginId[]) => Math.min(...ids.map((i) => m[i]));
  return {
    over, p: rp, mass: get('mass-empty').value, transport, cg: get('cg').value,
    op: counts(cs, 'statusOperating'), goal: counts(cs, 'statusGoal'), m, mOp, fit,
    intended, intendedFits: fit ? fit[intended].removed : null,
    score: mn(STABILITY_IDS), gateScore: mn(GATE_IDS), checks: cs,
  };
}

const allPass = (d: Design) => d.op.fail === 0 && d.goal.fail === 0;
const opPass = (d: Design) => d.op.fail === 0;

// ── formatting ──────────────────────────────────────────────────────────────────────────────────────────────

const f1 = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const pct = (x: number) => (x >= 9.99 ? '>999%' : x <= -9.99 ? '<-999%' : `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`);
/** Markdown cell: margin in %, bold when negative (a fail). */
const mc = (x: number) => (x < 0 ? `**${pct(x)}**` : pct(x));
const cnt = (c: Counts) => `${c.pass}/${c.marginal}/${c.fail}`;
const fitStr = (d: Design) => {
  if (!d.fit) return '-';
  const t = (b: boolean) => (b ? 'Y' : 'n');
  return `B ${t(d.fit.beside.removed)}${t(d.fit.beside.tongueOff)} / S ${t(d.fit.straddle.removed)}${t(d.fit.straddle.tongueOff)}`;
};
const COLS: [string, MarginId][] = [['tip-str', 'tip-straight'], ['tip-lock', 'tip-lock'], ['slide', 'slide-before-tip'], ['v-roll', 'v-rollover'],
  ['turn-R', 'turn-radius'], ['steer-clr', 'steer-clear'], ['pitch-F', 'pitch-fwd'], ['pitch-R', 'pitch-rear'], ['brake', 'brake-force'],
  ['axle', 'axle-stress'], ['beams', 'beams'], ['rails', 'rails'], ['deck', 'deck'], ['tongue', 'tongue']];

function table(rows: { label: string; d: Design | null }[], first: string): string {
  const head = [first, 'mass', 'transp', 'op P/M/F', 'goal P/M/F', ...COLS.map((c) => c[0]), 'fit rem/tOff (B=beside S=straddle)'];
  const out = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const r of rows) {
    if (!r.d) { out.push(`| ${r.label} | invalid (validator) |${' |'.repeat(head.length - 2)}`); continue; }
    const d = r.d;
    out.push(`| ${[r.label, f1(Math.round(d.mass * 10) / 10), f1(Math.round(d.transport * 10) / 10), cnt(d.op), cnt(d.goal),
      ...COLS.map(([, id]) => mc(d.m[id])), fitStr(d)].join(' | ')} |`);
  }
  return out.join('\n');
}

// ── sweeps ──────────────────────────────────────────────────────────────────────────────────────────────────

interface Var { key: string; label: string; unit: string; values: number[]; apply: (v: number) => Over }
const dB = derived(BASE());
const MAXB = dB.maxTrackBesideWells;
log(`max track beside the wells: ${MAXB.toFixed(2)} in`);

const VARS: Var[] = [
  { key: 'track', label: 'Front = rear track', unit: 'in', values: [32, 33, 34, 35, 35.5, 36, 36.5, 37, 38, 40, 42, 44, 46, 48, 50], apply: (v) => ({ frontTrackIn: v, rearTrackIn: v }) },
  { key: 'wheelbase', label: 'Wheelbase', unit: 'in', values: [40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60], apply: (v) => ({ wheelbaseIn: v }) },
  { key: 'wheel', label: 'Wheel diameter', unit: 'in', values: [10, 11.5, 13], apply: (v) => ({ wheelDiameterIn: v }) },
  { key: 'deck', label: 'Deck height (nose deck raised to keep it >= 9 in)', unit: 'in', values: [7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11], apply: (v) => ({ deckHeightIn: v, frontDeckRaiseIn: Math.max(0.5, 9 - v) }) },
  { key: 'lock', label: 'Steer lock', unit: 'deg', values: [30, 32, 34, 36, 37, 38, 38.5, 39], apply: (v) => ({ steerLockDeg: v }) },
  { key: 'ply', label: 'Deck ply (6/9/12/18 mm)', unit: 'in', values: [0.236, 0.354, 0.472, 0.709], apply: (v) => ({ deckPlyIn: v }) },
  { key: 'xmem', label: 'Crossmember spacing', unit: 'in', values: [6, 8, 10, 12, 14], apply: (v) => ({ crossmemberSpacingIn: v }) },
  { key: 'tongue', label: 'Tongue length (drawbar = tongue)', unit: 'in', values: [12, 18, 24, 30, 36, 42, 48], apply: (v) => ({ drawbar: DRAWBAR.woodTongue, tongueLengthIn: v }) },
  { key: 'brake', label: 'Brake lever ratio (extra)', unit: ':1', values: [6, 8, 10, 12, 14], apply: (v) => ({ brakeLeverRatio: v }) },
  { key: 'seat', label: 'Seat H-point ahead of rear axle (extra)', unit: 'in', values: [4, 6, 8, 10, 12, 14, 16], apply: (v) => ({ seatXIn: v }) },
  { key: 'body', label: 'Cabin width (extra)', unit: 'in', values: [24, 26, 28, 30, 32], apply: (v) => ({ bodyWidthIn: v }) },
];

const sections: string[] = [];

// Stage 1 -------------------------------------------------------------------------------------------------------
log('Stage 1: one-at-a-time sensitivities');
const defD = evaluate({}, true)!;
const stage1: Record<string, (Design | null)[]> = {};
const influence: { key: string; range: number; label: string }[] = [];
let s1 = '';
s1 += `Default design (autoNose on): ${table([{ label: 'default', d: defD }], 'case')}\n\n`;
{
  const rows = [
    { label: 'drawbar = rope bridle only', d: evaluate({ drawbar: DRAWBAR.ropeBridleOnly }, true) },
  ];
  stage1['rope'] = rows.map((r) => r.d);
  s1 += `${table(rows, 'case')}\n\n`;
}
for (const v of VARS) {
  const ds = v.values.map((x) => evaluate(v.apply(x), true));
  stage1[v.key] = ds;
  const rows = v.values.map((x, i) => ({ label: `${x}`, d: ds[i] }));
  s1 += `#### ${v.label} (${v.unit})\n\n${table(rows, v.key)}\n\n`;
  const ok = ds.filter((d): d is Design => !!d);
  influence.push({ key: v.key, label: v.label, range: ok.length ? Math.max(...ok.map((d) => d.score)) - Math.min(...ok.map((d) => d.score)) : 0 });
  log(`  ${v.key}: ${ok.length}/${ds.length} valid; stability score ${ok.length ? pct(Math.min(...ok.map((d) => d.score))) : '-'} .. ${ok.length ? pct(Math.max(...ok.map((d) => d.score))) : '-'}`);
}
influence.sort((a, b) => b.range - a.range);

// Deck fix: plies x spacing (deck check does not depend on the other variables; confirm by also running at one other layout).
let s1b = '| ply (mm) | spacing (in) | deck margin | mass | transp | op fails | goal fails |\n|---|---|---|---|---|---|---|\n';
const deckChoices: { ply: number; sp: number; d: Design }[] = [];
for (const [mm, ply] of [[6, 0.236], [9, 0.354], [12, 0.472], [18, 0.709]] as const) {
  for (const sp of [6, 8, 10, 12]) {
    const d = evaluate({ deckPlyIn: ply, crossmemberSpacingIn: sp }, false);
    if (!d) continue;
    deckChoices.push({ ply, sp, d });
    s1b += `| ${mm} | ${sp} | ${mc(d.m.deck)} | ${f1(Math.round(d.mass * 10) / 10)} | ${f1(Math.round(d.transport * 10) / 10)} | ${d.op.fail} | ${d.goal.fail} |\n`;
  }
}
const deckOk = deckChoices.filter((c) => c.d.m.deck >= 0.1).sort((a, b) => a.d.mass - b.d.mass);
const deckPick = deckOk[0] ?? deckChoices.sort((a, b) => b.d.m.deck - a.d.m.deck)[0];
log(`Deck fix: lightest with deck margin >= +10%: ply ${deckPick.ply}, spacing ${deckPick.sp}, mass ${deckPick.d.mass.toFixed(1)}`);

// Stage 2 -------------------------------------------------------------------------------------------------------
log('Stage 2: focused grid (fast path, truck fit only for survivors)');
const FIX: Over = { deckPlyIn: deckPick.ply, crossmemberSpacingIn: deckPick.sp };
const trackLevels = [33.5, 34.5, 35.5, 36.5, 38, 40, 44, 50];
const wbLevels = [44, 48, 52, 56, 60];
const deckLevels = [8, 9, 10, 11]; // nose deck raised to keep >= 9 in (see stage 1)
const lockLevels = [33, 36, 39];
const wheelLevels = [10, 11.5, 13];
const seatLevels = [10, 12, 14, 16];
// pull: rope bridle only, or tongue 12 / 18 / 24 / 36
const pullLevels: Over[] = [{ drawbar: DRAWBAR.ropeBridleOnly }, ...[12, 18, 24, 36].map((l) => ({ drawbar: DRAWBAR.woodTongue, tongueLengthIn: l }))];
const gridDims = `track ${trackLevels.length} x wheelbase ${wbLevels.length} x wheel ${wheelLevels.length} x deck height ${deckLevels.length} x lock ${lockLevels.length} x seat ${seatLevels.length} x pull ${pullLevels.length}`;
const gridTotal = trackLevels.length * wbLevels.length * wheelLevels.length * deckLevels.length * lockLevels.length * seatLevels.length * pullLevels.length;
const grid: Design[] = [];
let gi = 0;
const invalidBefore = nInvalid;
for (const t of trackLevels) for (const wb of wbLevels) for (const wd of wheelLevels) for (const dk of deckLevels) for (const lk of lockLevels) for (const st of seatLevels) for (const pl of pullLevels) {
  const d = evaluate({ ...FIX, frontTrackIn: t, rearTrackIn: t, wheelbaseIn: wb, wheelDiameterIn: wd, deckHeightIn: dk, frontDeckRaiseIn: Math.max(0.5, 9 - dk), steerLockDeg: lk, seatXIn: st, ...pl }, false);
  if (d) grid.push(d);
  if (++gi % 3000 === 0) log(`  ${gi}/${gridTotal}`);
}
const gridInvalid = nInvalid - invalidBefore;
log(`Grid: ${grid.length} valid, ${gridInvalid} invalid of ${gridTotal}`);
const survivors = grid.filter(allPass);
const opOnly = grid.filter((d) => opPass(d) && !allPass(d)).length;
log(`  all-pass (0 fails operating and goal, truck ignored): ${survivors.length}; operating-only pass: ${opOnly}`);
// Truck fit for survivors.
const withFit: Design[] = [];
for (const d of survivors) {
  const e = evaluate(d.over, true);
  if (e) withFit.push(e);
}
const fullPass = withFit.filter((d) => allPass(d) && d.intendedFits);
log(`  all-pass AND intended-mode removed config fits the truck: ${fullPass.length}`);
const sortFn = (a: Design, b: Design) => b.score - a.score || a.mass - b.mass;
fullPass.sort(sortFn);

const pullName = (d: Design) => (d.p.drawbar === DRAWBAR.woodTongue ? `tongue ${d.p.tongueLengthIn}` : 'rope only');
const pullCensus: Record<string, [number, number]> = {};
for (const d of grid) { const k = pullName(d); pullCensus[k] ??= [0, 0]; pullCensus[k][0]++; if (allPass(d)) pullCensus[k][1]++; }
// failure census: which check kills how many grid points
const failBy: Record<string, number> = {};
for (const d of grid) for (const c of d.checks) if (CHECK_COUNT_IDS(c) && (c.statusOperating === 'fail' || c.statusGoal === 'fail')) failBy[c.id] = (failBy[c.id] ?? 0) + 1;

/** Candidate objective: broad gate margin (stability + turn radius + steer clearance + brake) first, then stability score, then lighter. */
const better = (a: Design, b: Design) =>
  a.gateScore > b.gateScore + 1e-6 || (Math.abs(a.gateScore - b.gateScore) <= 1e-6 && (a.score > b.score + 1e-6 || (Math.abs(a.score - b.score) <= 1e-6 && a.mass < b.mass - 0.05)));
const byGate = (a: Design, b: Design) => (better(a, b) ? -1 : better(b, a) ? 1 : 0);
// Stage 3 -------------------------------------------------------------------------------------------------------
log('Stage 3: beside vs straddle');
const gated = [...fullPass].sort(byGate);
const besideSet = gated.filter((d) => d.intended === 'beside');
const withTongue = gated.filter((d) => d.p.drawbar === DRAWBAR.woodTongue);
const straddleSet = gated.filter((d) => d.intended === 'straddle');

/** Coordinate-descent polish of the score (then mass) over fine steps of the continuous variables. */
function polish(start: Design, trackRange: [number, number]): Design {
  let best = start;
  const steps: { k: (v: number) => Over; get: (o: Over) => number; step: number; lo: number; hi: number }[] = [
    { k: (v) => ({ frontTrackIn: v, rearTrackIn: v }), get: (o) => o.frontTrackIn as number, step: 0.5, lo: trackRange[0], hi: trackRange[1] },
    { k: (v) => ({ wheelbaseIn: v }), get: (o) => o.wheelbaseIn as number, step: 1, lo: 40, hi: 60 },
    { k: (v) => ({ deckHeightIn: v, frontDeckRaiseIn: Math.max(0.5, 9 - v) }), get: (o) => o.deckHeightIn as number, step: 0.5, lo: 7.5, hi: 11 },
    { k: (v) => ({ seatXIn: v }), get: (o) => o.seatXIn as number, step: 0.5, lo: 8, hi: 17 },
    { k: (v) => ({ steerLockDeg: v }), get: (o) => o.steerLockDeg as number, step: 1, lo: 30, hi: 39 },
  ];
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (const s of steps) for (const dir of [-1, 1]) {
      for (let n = 1; n <= 4; n++) {
        const v = s.get(best.over) + dir * s.step * n;
        if (v < s.lo - 1e-9 || v > s.hi + 1e-9) break;
        const d = evaluate({ ...best.over, ...s.k(v) }, true);
        if (d && allPass(d) && d.intendedFits && d.intended === start.intended && better(d, best)) { best = d; improved = true; }
      }
    }
    if (!improved) break;
  }
  return best;
}
const bestBeside = besideSet[0] ? polish(besideSet[0], [33, MAXB]) : null;
const bestStraddle = straddleSet[0] ? polish(straddleSet[0], [MAXB + 0.25, 52]) : null;
const bestTongue = withTongue[0] ? polish(withTongue[0], [33, 50]) : null;
log(`  best beside score ${bestBeside ? pct(bestBeside.score) : 'none'}, best straddle ${bestStraddle ? pct(bestStraddle.score) : 'none'}`);

// Straddle wheelbase requirement and track vs. truck fit at the best straddle design.
let s3 = '';
const wbRows: { label: string; d: Design | null }[] = [];
const trRows: { label: string; d: Design | null }[] = [];
if (bestStraddle) {
  for (let wb = 44; wb <= 60; wb += wb < 52 ? 1 : 2) wbRows.push({ label: `${wb}`, d: evaluate({ ...bestStraddle.over, wheelbaseIn: wb }, true) });
  for (const t of [MAXB, 38, 40, 42, 44, 46, 48, 50]) trRows.push({ label: `${f1(Math.round(t * 100) / 100)}`, d: evaluate({ ...bestStraddle.over, frontTrackIn: t, rearTrackIn: t }, true) });
}

// Candidates: best beside, best straddle, and best overall low-mass design among all-pass (mass-weighted).
const cands: { name: string; why: string; d: Design }[] = [];
if (bestBeside) cands.push({ name: 'A: best beside-the-wells', why: 'best gate margin (min over stability, turn radius, steer clearance, brake force; stability score, then mass, break ties) with wheels beside the wells (no straddling, simplest loading)', d: bestBeside });
if (bestStraddle) cands.push({ name: 'B: best straddle', why: 'best gate margin with a wide track that straddles the wells (the removed cart fits only straddling)', d: bestStraddle });
if (bestTongue) cands.push({ name: 'C: best with a wood tongue', why: 'best gate margin among designs that keep the oak tongue (D-14)', d: bestTongue });
const lightPool = fullPass.filter((d) => d.score >= 0.1).sort((a, b) => a.mass - b.mass || b.score - a.score);
const bestLight = lightPool[0];
if (bestLight && !cands.some((c) => c.d.mass <= bestLight.mass + 1e-6)) cands.push({ name: 'D: lightest all-pass', why: 'lowest empty mass among all-pass designs whose stability score is at least +10% (no stability check marginal)', d: bestLight });

// ── doc assembly ────────────────────────────────────────────────────────────────────────────────────────────

const checkTable = (d: Design) => {
  const rows = d.checks.map((c) => {
    const lim = c.limit === 0 && c.id === 'pitch-fwd' ? '0 (slope margin)' : `${c.sense} ${c.limit.toFixed(c.limit >= 100 ? 0 : 2)}`;
    const val = c.value >= 1000 ? c.value.toFixed(0) : c.value.toFixed(2);
    return `| ${c.id} | ${val} ${c.unit} | ${lim} | ${c.statusOperating} | ${c.statusGoal} |`;
  });
  return `| check | value (primary case) | limit | operating | goal |\n|---|---|---|---|---|\n${rows.join('\n')}`;
};
const paramLine = (d: Design) => {
  const p = d.p;
  return `track ${p.frontTrackIn}/${p.rearTrackIn} in, wheelbase ${p.wheelbaseIn} in, wheel ${p.wheelDiameterIn} in, deck height ${p.deckHeightIn} in (nose raise ${p.frontDeckRaiseIn} in), seat H-point ${p.seatXIn} in ahead of the rear axle, lock ${p.steerLockDeg} deg, ` +
    `${p.drawbar === DRAWBAR.woodTongue ? `tongue ${p.tongueLengthIn} in` : 'rope bridle only'}, deck ply ${Math.round(p.deckPlyIn * 25.4)} mm @ ${p.crossmemberSpacingIn} in spacing; ` +
    `auto nose ${p.noseWidthIn} in wide, shoulder ${p.noseTaperStartIn} in behind the front axle`;
};

let prior = '';
if (existsSync(OUT)) {
  const txt = readFileSync(OUT, 'utf8');
  const i = txt.indexOf('<!-- obs:start -->'), j = txt.indexOf('<!-- obs:end -->');
  if (i >= 0 && j > i) prior = txt.slice(i + '<!-- obs:start -->'.length, j);
}

const lab = (d: Design) => `${d.intended[0].toUpperCase()}: tr ${d.p.frontTrackIn} wb ${d.p.wheelbaseIn} w ${d.p.wheelDiameterIn} dk ${d.p.deckHeightIn} lk ${d.p.steerLockDeg} seat ${d.p.seatXIn} ${d.p.drawbar === DRAWBAR.woodTongue ? `t${d.p.tongueLengthIn}` : 'rope'}`;
const topRows = fullPass.slice(0, 15).map((d, i) => ({ label: `#${i + 1} ${lab(d)}`, d }));
const gateRows = [...fullPass].sort(byGate).slice(0, 10).map((d, i) => ({ label: `#${i + 1} ${lab(d)}`, d }));
const lightRows = [...fullPass].sort((a, b) => a.mass - b.mass).slice(0, 8).map((d) => ({ label: lab(d), d }));

let doc = `# Phase 2 parameter-space exploration

Generated by \`scripts/explore.ts\` (see Method). Numbers below are reproducible; the Observations section is hand-written and preserved on re-runs.

## Method

- Everything runs with **autoNoseGeometry on** (D-26): nose width and shoulder are derived per design from front track, lock and lead, so the Phase 1 coupling (C1) does not cap the sweep. All designs go through \`validateParams\`; designs with a validator **error** are skipped and counted ("invalid").
- Each design is evaluated with \`runChecks\` (resolved params, goal-rider model, both rider cases) plus \`checkTruckFit\` (all modes and configs, 0.25 in search step) computed once and reused.
- **Margins** are fractional: (value - limit)/limit for ">=" checks, (limit - value)/limit for "<=" checks, taken at the **worse of the 150 lb operating and 200 lb goal case**. Negative (bold) means a fail in at least one case; under +10% is "marginal". pitch-fwd has a limit of 0 deg, so its margin is degrees of slope headroom divided by the 15 deg design slope. v-roll is info only (A-1), shown for reference. beams = worse of front/rear axle beam. The deck/rails/axle/tongue rows use the structural "primary" criterion (governing detail).
- **Counts** are pass/marginal/fail over the 19 pass/fail-or-reported checks excluding mass, cg and truck-fit; info rows (v-rollover, brake-traction, bearing...) count as nothing. "op" = 150 lb, "goal" = 200 lb.
- **Truck fit** column: "B" beside-wells, "S" straddle; two letters = removed config, tongue-off config; Y = some orientation fits. A design's **intended mode** is beside whenever its removed config fits beside the wells, otherwise straddle; it must fit in that mode with the removables off (D-9) to count as feasible. Note derived().maxTrackBesideWells = ${MAXB.toFixed(2)} in is the conservative bound (wheels fore-aft over the wells); the fit check accepts wider tracks beside the wells when both axles sit clear of the well span fore-aft (D-6, D-23).
- **Score** (the Pareto ordering): the minimum margin over the five stability checks (tip-straight, tip-lock, slide-before-tip, pitch-fwd, pitch-rear), worst of both riders. Mass is the tiebreak (lighter first). "All-pass" = zero fails at both operating and goal for every check, **and** the removed configuration fits the truck in the intended mode.
- Stages: (1) one-at-a-time around the defaults, (2) a ${gridDims} = ${gridTotal} grid (nose deck raise = max(0.5, 9 - deck height), because the validator needs the nose deck underside at about 9 in for the turntable stack), (3) beside vs straddle, polished by coordinate descent. The deck ply and crossmember spacing are fixed in stage 2 at the lightest combination that clears the deck check by >= 10% (${Math.round(deckPick.ply * 25.4)} mm, ${deckPick.sp} in spacing) because the deck check depends on nothing else.
- Evaluations: ${nEval} valid designs evaluated, ${nInvalid} skipped as validator-invalid (${gridInvalid} of them in the grid). Run time ${((Date.now() - T0) / 1000).toFixed(0)} s. Run with \`node scripts/run-ts.mjs scripts/explore.ts\`.

Defaults for reference (150/200 lb): empty mass ${defD.mass.toFixed(1)} lb, transport ${defD.transport.toFixed(1)} lb, CG ${defD.cg.toFixed(1)} in. Failing at default: ${defD.checks.filter((c) => CHECK_COUNT_IDS(c) && (c.statusOperating === 'fail' || c.statusGoal === 'fail')).map((c) => c.id).join(', ') || 'none'}.

## Stage 1: one-at-a-time sensitivities

${s1}Influence ranking (range of the stability score over the variable's swept values):

${influence.map((x, i) => `${i + 1}. ${x.label}: ${(x.range * 100).toFixed(0)} points`).join('\n')}

#### Deck ply x crossmember spacing (deck check, structure only)

${s1b}
Lightest combination with deck margin >= +10%: **${Math.round(deckPick.ply * 25.4)} mm ply at ${deckPick.sp} in spacing** (empty ${deckPick.d.mass.toFixed(1)} lb).

## Stage 2: focused grid

Grid: ${gridDims}, other parameters at default, ${Math.round(deckPick.ply * 25.4)} mm deck ply at ${deckPick.sp} in spacing. ${grid.length} valid designs, ${gridInvalid} invalid.

- Zero fails at operating and goal (truck ignored): **${survivors.length}**; operating-only passes (goal rider fails something): ${opOnly}.
- All-pass and the intended-mode removed config fits the truck: **${fullPass.length}** (${besideSet.length} beside, ${straddleSet.length} straddle).
- Why designs were skipped as invalid (stage 1 + grid + stage 3, a design can have several reasons): ${Object.entries(invalidWhy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join('; ')}.\n- All-pass (truck ignored) by pull option, as survivors/valid: ${Object.entries(pullCensus).map(([k, v]) => `${k} ${v[1]}/${v[0]}`).join(', ')}.\n- Grid points with at least one failing case, by check: ${Object.entries(failBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.

Pareto-ish front: top 15 all-pass designs by the stability score (min margin over tip-straight, tip-lock, slide-before-tip, pitch-fwd, pitch-rear), mass tiebreak. Label: B/S = intended mode, tr = track, wb = wheelbase, w = wheel, dk = deck height, lk = lock, seat = seat H-point, tN = tongue length, rope = rope bridle only.

${table(topRows, 'design')}

Same survivors ordered by the broader gate score (min margin over stability + turn radius + steer clearance + brake force; this is the objective the candidates below are polished against, because the stability score alone rewards designs that sit on the edge of the 96 in turning radius or the steering clearance), top 10:\n\n${table(gateRows, 'design')}\n\nLightest 8 all-pass designs (for the mass tradeoff):

${table(lightRows, 'design')}

## Stage 3: beside wells vs straddle

${bestBeside && bestStraddle ? `${table([{ label: 'best beside', d: bestBeside }, { label: 'best straddle', d: bestStraddle }], 'design')}

- Beside: ${paramLine(bestBeside)}
- Straddle: ${paramLine(bestStraddle)}

Straddle wheelbase window at the best straddle design (track ${bestStraddle.p.frontTrackIn} in; B/S fit columns show where the well-zone requirement bites):

${table(wbRows, 'wheelbase')}

Straddle track vs fit and stability at that wheelbase (${bestStraddle.p.wheelbaseIn} in):

${table(trRows, 'track')}` : 'No all-pass design found in one of the modes; see the grid census above.'}

## Candidate configurations

${cands.map((c) => `### ${c.name}\n\n${c.why}. ${paramLine(c.d)}.\n\nEmpty mass ${c.d.mass.toFixed(1)} lb, transport (removables off) ${c.d.transport.toFixed(1)} lb, CG height ${c.d.cg.toFixed(1)} in. Operating ${cnt(c.d.op)} (P/M/F), goal ${cnt(c.d.goal)}. Truck: ${fitStr(c.d)}.\n\n${checkTable(c.d)}\n\nMargins: ${COLS.map(([n, id]) => `${n} ${pct(c.d.m[id])}`).join(', ')}.\n`).join('\n')}
## Observations

<!-- obs:start -->${prior || '\n(Observations are added after the first run.)\n'}<!-- obs:end -->
`;
writeFileSync(OUT, doc);
log(`Wrote ${OUT} (${doc.length} chars). Total ${((Date.now() - T0) / 1000).toFixed(0)} s`);
