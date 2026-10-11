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
import { defaultParams, derived, DRAWBAR, kingpinBoreIn, resolveParams, validateParams, type Params } from '../src/params';
import { buildModel } from '../src/model';
import { totalMass } from '../src/model/mass';
import { runChecks, type AnalysisCheck } from '../src/analysis';
import { checkTruckFit, type Config, type FitResult, type Stowage } from '../src/truck/fit';

const T0 = Date.now();
/** EXPLORE_OUT overrides the output path (a smoke run must not overwrite docs/phase2-exploration.md); EXPLORE_SMOKE=1 shrinks the stage-2 grid. */
const OUT = process.env.EXPLORE_OUT ?? new URL('../docs/phase2-exploration.md', import.meta.url).pathname;
const SMOKE = process.env.EXPLORE_SMOKE === '1';
const log = (s: string) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}`);

// ── evaluation ──────────────────────────────────────────────────────────────────────────────────────────────

type Over = Partial<Params>;
const BASE = (): Params => ({ ...defaultParams(), autoNoseGeometry: 1 });
const mk = (o: Over): Params => ({ ...BASE(), ...o });

const ceilTo = (x: number, q: number) => Math.ceil(x / q - 1e-9) * q;
const LIG = defaultParams().beamLigamentMinIn;
const WEB = defaultParams().rodKingpinWebMinIn;
/** Kingpin + axle-rod combination with the kingpin lead (rod-kingpin web rule, 1/16") and front beam width (ligament rule, 1/8", never below the default) at their minimum valid values. */
function hw(kp: number, axle: number): Over {
  // Phase 3 (M11): the oak is bored for the kingpin SLEEVE (1-1/4" OD by default), not the pin, so both rules use the bore.
  const bore = kingpinBoreIn({ ...defaultParams(), kingpinDiameterIn: kp });
  const lead = ceilTo(axle / 2 + bore / 2 + WEB, 1 / 16);
  const beam = Math.max(defaultParams().frontAxleBeamThicknessIn, ceilTo(lead + axle / 2 + bore / 2 + 2 * LIG, 1 / 8));
  // Washer under the beam sized for >= 1.3 in^2 of annulus so the bump-roll uplift (about 360 lbf, goal) stays under the oak bearing limit.
  const washer = Math.max(defaultParams().kingpinWasherDiameterIn, ceilTo(Math.sqrt(kp * kp + (4 * 1.3) / Math.PI), 1 / 8));
  return { kingpinDiameterIn: kp, axleDiameterIn: axle, kingpinLeadIn: lead, frontAxleBeamThicknessIn: beam, kingpinWasherDiameterIn: washer };
}
const MARGIN_IDS = ['tip-straight', 'tip-lock', 'slide-before-tip', 'v-rollover', 'turn-radius', 'steer-clear', 'pitch-fwd', 'pitch-rear',
  'brake-force', 'axle-stress', 'beams', 'groove', 'rails', 'deck', 'kingpin', 'kingpin-strike', 'roll', 'tongue'] as const;
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

/** A margin column may fold several check rows (worst of them). */
const FOLD: Partial<Record<MarginId, string[]>> = {
  beams: ['beam-front', 'beam-rear'], groove: ['bearing-groove'], roll: ['roll-side-bearer', 'roll-kingpin-uplift', 'roll-bolster-attach'],
};
function marginOf(cs: AnalysisCheck[], ids: string[], p: Params, which: 'both' | 'op'): number {
  let best = Infinity;
  for (const c of cs) {
    if (!ids.includes(c.id)) continue;
    // The lightest-rider case (80 lb) counts toward the operating envelope (D-1), so it is in both readings.
    const list = c.cases
      ? (which === 'op' ? [c.cases.operating!] : [c.cases.operating!, c.cases.goal!]).concat(c.cases.light ? [c.cases.light] : [])
      : [{ value: c.value, limit: c.limit }];
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
    const ids = FOLD[id] ?? [id];
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
  ['axle', 'axle-stress'], ['beams', 'beams'], ['groove', 'groove'], ['rails', 'rails'], ['deck', 'deck'], ['kingpin', 'kingpin'], ['kp-strike', 'kingpin-strike'], ['roll', 'roll'], ['tongue', 'tongue']];

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
  { key: 'kp', label: 'Kingpin diameter (lead and front beam co-varied to their minimum; 3/4 in rod)', unit: 'in', values: [0.5, 0.625, 0.75, 0.875, 1], apply: (v) => hw(v, 0.75) },
  { key: 'axle', label: 'Axle rod diameter (1/2 in kingpin; lead and beam co-varied)', unit: 'in', values: [0.625, 0.75, 0.875, 1], apply: (v) => hw(0.5, v) },
  { key: 'beamt', label: 'Front axle beam width (fore-aft), 1 in kingpin + 3/4 in rod', unit: 'in', values: [3.5, 4, 4.5, 5], apply: (v) => ({ ...hw(1, 0.75), frontAxleBeamThicknessIn: v }) },
  { key: 'ply', label: 'Deck ply (6/9/12/18 mm)', unit: 'in', values: [0.236, 0.354, 0.472, 0.709], apply: (v) => ({ deckPlyIn: v }) },
  { key: 'xmem', label: 'Crossmember spacing', unit: 'in', values: [6, 8, 10, 12, 14], apply: (v) => ({ crossmemberSpacingIn: v }) },
  { key: 'tongue', label: 'Tongue length (drawbar = tongue)', unit: 'in', values: [12, 18, 24, 30, 36], apply: (v) => ({ drawbar: DRAWBAR.woodTongue, tongueLengthIn: v }) },
  // The brake ratio is derived from the linkage geometry since Phase 3 (D-38); the free input is the lever tail length (shorter = more mechanical advantage).
  { key: 'brake', label: 'Brake lever tail length (extra)', unit: 'in', values: [1.2, 1.5, 1.9, 2.4, 3], apply: (v) => ({ brakeLeverTailIn: v }) },
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
const deckPick0 = deckOk[0] ?? deckChoices.sort((a, b) => b.d.m.deck - a.d.m.deck)[0];
log(`Deck fix: lightest with deck margin >= +10%: ply ${deckPick0.ply}, spacing ${deckPick0.sp}, mass ${deckPick0.d.mass.toFixed(1)}`);

// Stage 1c: hardware (kingpin x axle x deck ply x spacing) at the default layout -----------------------------------
log('Stage 1c: hardware combinations');
const STRUCT_IDS = ['axle-stress', 'beam-front', 'beam-rear', 'bearing-groove', 'rails', 'deck', 'kingpin', 'kingpin-strike', 'roll-side-bearer', 'roll-kingpin-uplift', 'roll-bolster-attach', 'turntable', 'tongue'];
const structFails = (d: Design) => d.checks.filter((c) => STRUCT_IDS.includes(c.id) && (c.statusOperating === 'fail' || c.statusGoal === 'fail')).map((c) => c.id);
interface HwSet { kp: number; axle: number; ply: number; sp: number; d: Design; fails: string[] }
const hwAll: HwSet[] = [];
let s1c = '| kingpin | axle | lead | washer OD | beam W | ply mm | spacing | mass | structure fails (op or goal) | kp-strike | roll | deck | axle |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const kp of [0.5, 0.625, 0.75, 0.875, 1]) for (const axle of [0.625, 0.75, 0.875, 1]) for (const [mm, ply] of [[9, 0.354], [12, 0.472]] as const) for (const sp of [6, 8, 10, 12]) {
  const d = evaluate({ ...hw(kp, axle), deckPlyIn: ply, crossmemberSpacingIn: sp }, false);
  if (!d) { s1c += `| ${kp} | ${axle} | - | - | - | ${mm} | ${sp} | invalid | | | | | |\n`; continue; }
  const fails = structFails(d);
  hwAll.push({ kp, axle, ply, sp, d, fails });
  if (!([[9, 6], [12, 8], [12, 10]] as number[][]).some(([a, b]) => a === mm && b === sp)) continue;
  s1c += `| ${kp} | ${axle} | ${d.p.kingpinLeadIn} | ${d.p.kingpinWasherDiameterIn} | ${d.p.frontAxleBeamThicknessIn} | ${mm} | ${sp} | ${d.mass.toFixed(1)} | ${fails.join(', ') || 'none'} | ${mc(d.m['kingpin-strike'])} | ${mc(d.m.roll)} | ${mc(d.m.deck)} | ${mc(d.m['axle-stress'])} |\n`;
}
const hwOk = hwAll.filter((h) => h.fails.length === 0).sort((a, b) => a.d.mass - b.d.mass);
// Grid hardware sets: lightest passing set for each distinct (kingpin, axle) pair, up to 4 of them.
const hwPicks: HwSet[] = [];
for (const h of hwOk) if (!hwPicks.some((x) => x.kp === h.kp && x.axle === h.axle) && hwPicks.length < 4) hwPicks.push(h);
log(`  ${hwOk.length}/${hwAll.length} hardware sets pass every structural check at the default layout; picks: ${hwPicks.map((h) => `kp ${h.kp} axle ${h.axle} ply ${Math.round(h.ply * 25.4)} sp ${h.sp} (${h.d.mass.toFixed(1)} lb)`).join('; ')}`);
const deckPick = { ply: hwPicks[0]?.ply ?? 0.472, sp: hwPicks[0]?.sp ?? 8, d: hwPicks[0]?.d ?? defD };
const hwOvers: Over[] = hwPicks.map((h) => ({ ...hw(h.kp, h.axle), deckPlyIn: h.ply, crossmemberSpacingIn: h.sp }));
const hwName = (o: Over) => `kp ${o.kingpinDiameterIn} / axle ${o.axleDiameterIn} / ${Math.round((o.deckPlyIn as number) * 25.4)} mm @ ${o.crossmemberSpacingIn}`;

// Stage 1d: cheapest fix (fewest changed parameters from the defaults) ---------------------------------------------
log('Stage 1d: cheapest fix near the defaults');
const dp = defaultParams();
interface Lever { name: string; values: { label: string; over: Over }[] }
const LAYOUT_LEVERS: Lever[] = [
  { name: 'pull', values: [{ label: 'tongue 18 in', over: { tongueLengthIn: 18 } }, { label: 'tongue 12 in', over: { tongueLengthIn: 12 } }, { label: 'rope only', over: { drawbar: DRAWBAR.ropeBridleOnly } }] },
  { name: 'lock', values: [38, 37, 36].map((v) => ({ label: `lock ${v}`, over: { steerLockDeg: v } })) },
  { name: 'wheelbase', values: [46, 44, 42].map((v) => ({ label: `wheelbase ${v}`, over: { wheelbaseIn: v } })) },
  { name: 'seat', values: [14, 16].map((v) => ({ label: `seat ${v}`, over: { seatXIn: v } })) },
  { name: 'track', values: [34.5, 34, 36].map((v) => ({ label: `track ${v}`, over: { frontTrackIn: v, rearTrackIn: v } })) },
];
interface Fix { labels: string[]; d: Design; n: number }
const cheapAll: Fix[] = [];
function combos(start: number, k: number, over: Over, labels: string[], out: { over: Over; labels: string[] }[]) {
  if (k === 0) { out.push({ over, labels }); return; }
  for (let i = start; i < LAYOUT_LEVERS.length; i++) for (const v of LAYOUT_LEVERS[i].values) combos(i + 1, k - 1, { ...over, ...v.over }, [...labels, v.label], out);
}
// Hardware changes count as: kingpin/axle pair (lead, beam width, washer follow), deck ply, spacing. Layout levers: pull, lock, wheelbase, seat, track.
const layoutCombos: { over: Over; labels: string[] }[] = [];
for (let k = 0; k <= 3; k++) combos(0, k, {}, [], layoutCombos);
for (const h of hwOk) {
  const hwLabels = [
    ...(h.kp !== dp.kingpinDiameterIn || h.axle !== dp.axleDiameterIn ? [`kingpin ${h.kp} / axle ${h.axle} (lead ${h.d.p.kingpinLeadIn}, washer ${h.d.p.kingpinWasherDiameterIn}, beam ${h.d.p.frontAxleBeamThicknessIn})`] : []),
    ...(h.ply !== dp.deckPlyIn ? [`ply ${Math.round(h.ply * 25.4)} mm`] : []),
    ...(h.sp !== dp.crossmemberSpacingIn ? [`spacing ${h.sp} in`] : []),
  ];
  const hOver = { ...hw(h.kp, h.axle), deckPlyIn: h.ply, crossmemberSpacingIn: h.sp };
  for (const c of layoutCombos) {
    const over = { ...hOver, ...c.over };
    const d = evaluate(over, false);
    if (!d || !allPass(d)) continue;
    const e = evaluate(over, true);
    if (e && allPass(e) && e.intendedFits) cheapAll.push({ labels: [...hwLabels, ...c.labels], d: e, n: hwLabels.length + c.labels.length });
  }
}
const cheapK = cheapAll.length ? Math.min(...cheapAll.map((x) => x.n)) : 0;
const cheap = cheapAll.filter((x) => x.n === cheapK);
log(`  ${hwOk.length} hardware sets x ${layoutCombos.length} layout combos tried; ${cheapAll.length} all-pass; minimum ${cheapK} changes (${cheap.length} solutions)`);
cheap.sort((a, b) => a.d.mass - b.d.mass);
const cheapTxt = cheap.length
  ? `Fewest changes from the defaults that make every check pass at operating, goal and lightest rider and keep the removed cart fitting the truck: **${cheapK} change(s)** (counted levers: kingpin/axle pair with lead, front beam width and washer following, deck ply, spacing, pull, lock, wheelbase, seat, track; ${cheap.length} solutions at that count, lightest first).\n\n${table(cheap.slice(0, 8).map((c) => ({ label: c.labels.join(' + '), d: c.d })), 'changes')}`
  : 'No combination (hardware sets that pass structurally x up to 3 layout changes) made everything pass.';

// Stage 2 -------------------------------------------------------------------------------------------------------
log('Stage 2: focused grid (fast path, truck fit only for survivors)');
const trackLevels = SMOKE ? [34.5, 36.5] : [33.5, 34.5, 35.5, 36.5, 38, 40];
const wbLevels = SMOKE ? [44, 48] : [42, 44, 46, 48, 50];
const deckLevels = SMOKE ? [9] : [8, 9, 10]; // nose deck raised to keep >= 9 in (see stage 1)
const lockLevels = SMOKE ? [36] : [33, 36, 38.5];
const wheelLevels = SMOKE ? [11.5] : [10, 11.5, 13];
const seatLevels = SMOKE ? [14] : [12, 14, 16];
// pull: rope bridle only, or tongue 12 / 18 / 24
const pullLevels: Over[] = [{ drawbar: DRAWBAR.ropeBridleOnly }, ...[12, 18, 24].map((l) => ({ drawbar: DRAWBAR.woodTongue, tongueLengthIn: l }))];
const gridDims = `track ${trackLevels.length} x wheelbase ${wbLevels.length} x wheel ${wheelLevels.length} x deck height ${deckLevels.length} x lock ${lockLevels.length} x seat ${seatLevels.length} x pull ${pullLevels.length} x hardware ${hwOvers.length}`;
const gridTotal = trackLevels.length * wbLevels.length * wheelLevels.length * deckLevels.length * lockLevels.length * seatLevels.length * pullLevels.length * hwOvers.length;
const grid: Design[] = [];
let gi = 0;
const invalidBefore = nInvalid;
for (const t of trackLevels) for (const wb of wbLevels) for (const wd of wheelLevels) for (const dk of deckLevels) for (const lk of lockLevels) for (const st of seatLevels) for (const pl of pullLevels) for (const hv of hwOvers) {
  const d = evaluate({ ...hv, frontTrackIn: t, rearTrackIn: t, wheelbaseIn: wb, wheelDiameterIn: wd, deckHeightIn: dk, frontDeckRaiseIn: Math.max(0.5, 9 - dk), steerLockDeg: lk, seatXIn: st, ...pl }, false);
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
const goalOnly: Record<string, number> = {};
for (const d of grid) if (opPass(d) && !allPass(d)) for (const c of d.checks) if (CHECK_COUNT_IDS(c) && c.statusGoal === 'fail') goalOnly[c.id] = (goalOnly[c.id] ?? 0) + 1;
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
let bestStraddle: Design | null = straddleSet[0] ? polish(straddleSet[0], [MAXB + 0.25, 52]) : null;
const bestTongue = withTongue[0] ? polish(withTongue[0], [33, 50]) : null;
log(`  best beside score ${bestBeside ? pct(bestBeside.score) : 'none'}, best straddle ${bestStraddle ? pct(bestStraddle.score) : 'none'}`);

const failIds = (d: Design) => d.checks.filter((c) => CHECK_COUNT_IDS(c) && (c.statusOperating === 'fail' || c.statusGoal === 'fail')).map((c) => c.id);
// Stage 3b: targeted straddle search (wide track, wheelbase long enough for the well span, lock up to its 40 deg limit).
const stradList: Design[] = [];
let stradTried = 0;
for (const hv of hwOvers) for (const t of [37, 38, 40, 42]) for (const wb of [47, 48, 49, 50, 52]) for (const wd of [10, 11.5, 13]) for (const lk of [36, 38.5, 40]) for (const st of [10, 12, 14]) for (const pl of [pullLevels[0], pullLevels[1]]) for (const dk of [8, 9, 10]) {
  stradTried++;
  const d = evaluate({ ...hv, frontTrackIn: t, rearTrackIn: t, wheelbaseIn: wb, wheelDiameterIn: wd, deckHeightIn: dk, frontDeckRaiseIn: Math.max(0.5, 9 - dk), steerLockDeg: lk, seatXIn: st, ...pl }, false);
  if (d) stradList.push(d);
}
const stradFail: Record<string, number> = {};
for (const d of stradList) for (const id of failIds(d)) stradFail[id] = (stradFail[id] ?? 0) + 1;
const stradClean = stradList.filter(allPass);
const stradFits = stradClean.map((d) => evaluate(d.over, true)).filter((d): d is Design => !!d);
const stradOk = stradFits.filter((d) => d.intendedFits && d.intended === 'straddle').sort(byGate);
const wide = stradList;
const wideFail = stradFail;
const wideBest = [...stradList].sort((a, b) => failIds(a).length - failIds(b).length || b.gateScore - a.gateScore).slice(0, 3);
if (!bestStraddle && stradOk[0]) bestStraddle = stradOk[0];
log(`  targeted straddle search: ${stradTried} tried, ${stradList.length} valid, ${stradClean.length} analysis-clean, ${stradOk.length} also straddle-fit`);
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
if (cheap[0]) cands.push({ name: `B: cheapest fix near the defaults (${cheapK} change${cheapK > 1 ? 's' : ''}: ${cheap[0].labels.join(', ')})`, why: `fewest parameter changes from the current defaults that pass everything (lightest of ${cheap.length} solutions with that many changes)`, d: cheap[0].d });
if (bestStraddle) cands.push({ name: 'C: best straddle', why: 'best gate margin with a wide track that straddles the wells (the removed cart fits only straddling)', d: bestStraddle });
if (bestTongue) cands.push({ name: 'D: best with a wood tongue', why: 'best gate margin among designs that keep the oak tongue (D-14)', d: bestTongue });
const lightPool = fullPass.filter((d) => d.score >= 0.1).sort((a, b) => a.mass - b.mass || b.score - a.score);
const bestLight = lightPool[0];
if (bestLight && !cands.some((c) => c.d.mass <= bestLight.mass + 1e-6)) cands.push({ name: 'E: lightest all-pass', why: 'lowest empty mass among all-pass designs whose stability score is at least +10% (no stability check marginal)', d: bestLight });

// ── doc assembly ────────────────────────────────────────────────────────────────────────────────────────────

const checkTable = (d: Design) => {
  const rows = d.checks.map((c) => {
    const lim = c.limit === 0 && c.id === 'pitch-fwd' ? '0 (slope margin)' : `${c.sense} ${c.limit.toFixed(c.limit >= 100 ? 0 : 2)}`;
    const val = c.value >= 1000 ? c.value.toFixed(0) : c.value.toFixed(2);
    return `| ${c.id} | ${val} ${c.unit} | ${lim} | ${c.statusOperating} | ${c.statusGoal} | ${c.cases?.light ? c.cases.light.status : '-'} |`;
  });
  return `| check | value (primary case) | limit | operating | goal | 80 lb rider |\n|---|---|---|---|---|---|\n${rows.join('\n')}`;
};
const paramLine = (d: Design) => {
  const p = d.p;
  return `kingpin ${p.kingpinDiameterIn} in (lead ${p.kingpinLeadIn}, washer ${p.kingpinWasherDiameterIn} in, front beam ${p.frontAxleBeamThicknessIn} in), axle rod ${p.axleDiameterIn} in, track ${p.frontTrackIn}/${p.rearTrackIn} in, wheelbase ${p.wheelbaseIn} in, wheel ${p.wheelDiameterIn} in, deck height ${p.deckHeightIn} in (nose raise ${p.frontDeckRaiseIn} in), seat H-point ${p.seatXIn} in ahead of the rear axle, lock ${p.steerLockDeg} deg, ` +
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
- **Counts** are pass/marginal/fail over every pass/fail check row (stability, steering, braking and all structure rows including kingpin-strike and the three roll rows) excluding mass, cg and truck-fit; info rows (v-rollover, brake-traction) count as nothing. The operating column includes the 80 lb lightest-rider case (pitch-rear, D-1); margins are the worst of the operating, goal and light cases. "op" = 150 lb, "goal" = 200 lb.
- **Truck fit** column: "B" beside-wells, "S" straddle; two letters = removed config, tongue-off config; Y = some orientation fits. A design's **intended mode** is beside whenever its removed config fits beside the wells, otherwise straddle; it must fit in that mode with the removables off (D-9) to count as feasible. Note derived().maxTrackBesideWells = ${MAXB.toFixed(2)} in is the conservative bound (wheels fore-aft over the wells); the fit check accepts wider tracks beside the wells when both axles sit clear of the well span fore-aft (D-6, D-23).
- **Score** (the Pareto ordering): the minimum margin over the five stability checks (tip-straight, tip-lock, slide-before-tip, pitch-fwd, pitch-rear), worst of both riders. Mass is the tiebreak (lighter first). "All-pass" = zero fails at both operating and goal for every check, **and** the removed configuration fits the truck in the intended mode.
- Stages: (1) one-at-a-time around the defaults, (2) a ${gridDims} = ${gridTotal} grid (nose deck raise = max(0.5, 9 - deck height), because the validator needs the nose deck underside at about 9 in for the turntable stack), (3) beside vs straddle, polished by coordinate descent. The hardware (kingpin and axle diameters with the lead and front beam width co-varied to their minimum valid values, deck ply, spacing) is a dimension of the grid with the ${hwOvers.length} lightest hardware sets that pass every structural check at the default layout (stage 1c), one per distinct kingpin/axle pair.
- Evaluations: ${nEval} valid designs evaluated, ${nInvalid} skipped as validator-invalid (${gridInvalid} of them in the grid). Run time ${((Date.now() - T0) / 1000).toFixed(0)} s. Run with \`node scripts/run-ts.mjs scripts/explore.ts\`.

Defaults for reference (150/200 lb): empty mass ${defD.mass.toFixed(1)} lb, transport ${defD.transport.toFixed(1)} lb, CG ${defD.cg.toFixed(1)} in. Failing at default: ${defD.checks.filter((c) => CHECK_COUNT_IDS(c) && (c.statusOperating === 'fail' || c.statusGoal === 'fail')).map((c) => c.id).join(', ') || 'none'}.

## Stage 1: one-at-a-time sensitivities

${s1}Influence ranking (range of the stability score over the variable's swept values):

${influence.map((x, i) => `${i + 1}. ${x.label}: ${(x.range * 100).toFixed(0)} points`).join('\n')}

#### Deck ply x crossmember spacing (deck check, structure only)

${s1b}
Lightest combination with deck margin >= +10% (deck check only, other defaults): **${Math.round(deckPick0.ply * 25.4)} mm ply at ${deckPick0.sp} in spacing** (empty ${deckPick0.d.mass.toFixed(1)} lb).\n\n#### Stage 1c: hardware at the default layout\n\nKingpin x axle rod x deck ply x spacing, lead and front beam co-varied to the minimum valid (lead = rod radius + kingpin radius + 0.5 in web, rounded up to 1/16 in; beam width = lead + radii + 2 x ligament, rounded up to 1/8 in, never below 3.5 in). Passing sets: ${hwOk.length} of ${hwAll.length} valid.\n\n${s1c}\nGrid hardware picks: ${hwOvers.map(hwName).join('; ')}.\n\n#### Cheapest fix closest to the defaults\n\n${cheapTxt}

## Stage 2: focused grid

Grid: ${gridDims}, other parameters at default. ${grid.length} valid designs, ${gridInvalid} invalid.

- Zero fails at operating and goal (truck ignored): **${survivors.length}**; operating-only passes (the 200 lb goal rider fails something, D-1 goal flag): ${opOnly}, by check: ${Object.entries(goalOnly).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.
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

${table(trRows, 'track')}` : `No all-pass design found in the straddle mode (beside: ${bestBeside ? 'found' : 'none'}). Targeted straddle search (hardware picks x track 37-42 x wheelbase 47-52 x wheel x lock 36-40 x seat x rope/tongue 12 x deck height; ${stradTried} tried): ${wide.length} valid, ${stradClean.length} pass every analysis check, ${stradOk.length} of those also straddle-fit the removed cart. Failing checks across the valid designs (operating or goal): ${Object.entries(wideFail).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}. Closest designs:\n\n${wideBest.map((d) => `- ${paramLine(d)}; fails: ${failIds(d).join(', ')}`).join('\n')}`}

## Candidate configurations

${cands.map((c) => `### ${c.name}\n\n${c.why}. ${paramLine(c.d)}.\n\nEmpty mass ${c.d.mass.toFixed(1)} lb, transport (removables off) ${c.d.transport.toFixed(1)} lb, CG height ${c.d.cg.toFixed(1)} in. Operating ${cnt(c.d.op)} (P/M/F), goal ${cnt(c.d.goal)}. Truck: ${fitStr(c.d)}.\n\n${checkTable(c.d)}\n\nMargins: ${COLS.map(([n, id]) => `${n} ${pct(c.d.m[id])}`).join(', ')}.\n`).join('\n')}
## Observations

<!-- obs:start -->${prior || '\n(Observations are added after the first run.)\n'}<!-- obs:end -->
`;
writeFileSync(OUT, doc);
log(`Wrote ${OUT} (${doc.length} chars). Total ${((Date.now() - T0) / 1000).toFixed(0)} s`);
