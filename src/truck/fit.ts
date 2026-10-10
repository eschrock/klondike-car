/**
 * Truck-fit check (BRIEF §4.5, D-6, D-9, D-23). Pure TS, no three.js.
 *
 * Tries both stowage modes x both orientations x three configurations (installed / tongue off / all
 * removables off, D-9), steer at 0. The cart sits with its wheel contacts on the bed floor / tailgate
 * (coplanar) and is slid fore-aft in 0.25" steps; it is centred on the bed centreline (no lateral search).
 *
 * Modes (D-6, D-23):
 *  - 'beside'   : wheels pass beside the wells. Every wheel's lateral extent (+ clearance) lies inside the
 *                 gap between the wells; the fore-aft position is searched freely.
 *  - 'straddle' : the axle nearer the bulkhead has its whole wheel footprints ahead of the well zone and the
 *                 other axle's entirely behind it (clearance margin both sides), so track is limited only by the
 *                 bed width.
 * In both modes no wheel's contact patch may rest over the tailgate hinge gap (truckTailgateGapIn).
 *
 * Clearance is the true minimum separation of any non-payload cart part from any bed solid (walls, wells,
 * bulkhead, cab back wall, tailgate end): exact Euclidean for axis-aligned boxes, SAT (a lower bound) for
 * rotated ones. Floor/tailgate are contact surfaces. The bridle rope is excluded. Wheels are boxes
 * (conservative laterally, exact fore-aft).
 *
 * `computeFeasibleWindows` finds, per mode and configuration, the largest track at the current wheelbase and
 * the wheelbase range at the current track that still fit, by rebuilding the model with modified params.
 */
import { PARAM_DEFS, derived, validateParams, type Params } from '../params';
import { centerOfGravity } from '../model/mass';
import { obbOverlap, partOBB, type OBB } from '../model/bounds';
import { multiply, rotationZ, translation } from '../model/mat4';
import type { Mat4, Part, Vec3 } from '../model/types';
import { buildTruckBed, FLOOR_IDS, truckUsableLength } from './bed';

export type Stowage = 'beside' | 'straddle';
export type Orientation = 'nose-tailgate' | 'nose-bulkhead';
export type Config = 'installed' | 'tongue-off' | 'removed';
export const CONFIGS: Config[] = ['installed', 'tongue-off', 'removed'];
/** Parts removed in the 'tongue off' configuration (only the tongue/bridle, D-9). */
const TONGUE_RE = /tongue|bridle/i;

/** Cart parts for a configuration, built through `build` (which must honour `removed`). */
export function configParts(config: Config, build: (view: CartView) => Part[]): Part[] {
  const base = { steerDeg: 0, rider: 'none', cargo: false } as const;
  if (config === 'removed') return build({ ...base, removed: true });
  const parts = build({ ...base, removed: false });
  return config === 'tongue-off' ? parts.filter((x) => !TONGUE_RE.test(x.id) && !TONGUE_RE.test(x.name)) : parts;
}

/** View options the fit check passes to the model builder (a superset of the model's ViewState). */
export interface CartView {
  steerDeg?: number;
  rider?: 'none' | 'operating' | 'goal';
  cargo?: boolean;
  removed?: boolean;
}

export interface PairInfo {
  partId: string;
  solidId: string;
  /** Separation in inches (negative = interpenetration). */
  clearanceIn: number;
}

/** Fore-aft position of one axle's wheels relative to the well zone and the tailgate hinge gap (truck frame). */
export interface AxleMargin {
  /** 'bulkhead' = the axle nearer the bulkhead, 'tailgate' = the other one. */
  side: 'bulkhead' | 'tailgate';
  /** Which cart axle that is at this placement (depends on the orientation). */
  cartAxle: 'front' | 'rear';
  /** Fore-aft extent of the tire footprints, truck frame. */
  wheelX: [number, number];
  /** Fore-aft gap of the tires to the well zone (>= 0: wholly ahead of / behind it; < 0: overlaps its span). */
  wheelWellGapIn: number;
  /** Fore-aft length of the tire/well-span overlap (0 when the tires are clear of the wells fore-aft). */
  wheelWellOverlapIn: number;
  /** Same for the axle rod / stub ends (narrower fore-aft than the tires; they are wider laterally, D-6). */
  rodWellGapIn: number;
  /** Fore-aft gap of the tire contact patch to the tailgate hinge gap (< 0: rests over it). */
  hingeGapIn: number;
  relation: 'ahead' | 'behind' | 'beside';
}

export interface Slack {
  /** How far the cart can slide toward the bulkhead from the placement and still fit, inches (to the search step). */
  toBulkheadIn: number;
  /** ... toward the tailgate. */
  toTailgateIn: number;
  totalIn: number;
}

export interface Placement {
  /** Cart x-shift along the bed after the yaw, inches. */
  txIn: number;
  yawDeg: number;
  /** Cart frame -> truck frame. */
  transform: Mat4;
}

export interface FitCase {
  key: string;
  mode: Stowage;
  orientation: Orientation;
  config: Config;
  fits: boolean;
  /** Best placement = max of the min clearance. Null only if the cart has no parts. */
  placement: Placement | null;
  /** Min clearance at the placement (excluding floor contact), capped for display purposes at +50. */
  minClearanceIn: number;
  /** Closest pairs at the placement. */
  limiting: PairInfo[];
  /** Pairs closer than the required clearance (empty when it fits). */
  colliding: PairInfo[];
  /** False when no placement can put the wheels where the mode needs them (wheelbase vs. wells). */
  modeFeasible: boolean;
  /** Fore-aft slack: contiguous range of positions around the placement that still fit. Null when the case does not fit
   * (or in the window search, which skips it). */
  slack: Slack | null;
  /** Per-axle fore-aft margins to the well zone / hinge gap at the placement (two entries; empty without wheels). */
  axles: AxleMargin[];
  /** True when no axle (rod ends included) sits fore-aft over the well span: the wells only limit the wheelbase/zone,
   * not the track (D-6). Null without wheels. */
  axlesClearWells: boolean | null;
  note?: string;
  /** Short reason when the mode is infeasible (for compact lists). */
  modeIssue?: string;
}

export interface Overall {
  lengthIn: number;
  widthIn: number;
  heightIn: number;
}

export interface FitResult {
  cases: FitCase[];
  dims: Record<Config, Overall>;
  requiredClearanceIn: number;
  usableLengthIn: number;
  anyFits: boolean;
  /** Fitting case with the largest clearance, else the least-bad case. */
  best: FitCase | null;
  evalMs: number;
}

export const caseKey = (mode: Stowage, orientation: Orientation, config: Config) => `${mode}|${orientation}|${config}`;

const STEP_IN = 0.25;
const TIRE_PATCH_HALF_IN = 1; // half-width of a tire's contact patch along the bed, for the hinge-gap rule
const FLOOR_PENETRATION_IN = 0.01;

interface Item {
  id: string;
  obb: OBB;
  min: Vec3;
  max: Vec3;
  isWheel: boolean;
  /** Box axes coincide with the world axes, so exact Euclidean separation can be used. */
  aligned: boolean;
}

function aabbOf(o: OBB): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [0, 0, 0];
  const max: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const ext = Math.abs(o.axes[0][k]) * o.half[0] + Math.abs(o.axes[1][k]) * o.half[1] + Math.abs(o.axes[2][k]) * o.half[2];
    min[k] = o.center[k] - ext;
    max[k] = o.center[k] + ext;
  }
  return { min, max };
}

const isBridle = (p: Part) => /bridle|rope/i.test(p.id) || /bridle|rope/i.test(p.name);

function isAligned(o: OBB): boolean {
  return o.axes.every((a) => a.some((c) => Math.abs(c) > 1 - 1e-6));
}

function prepare(parts: Part[], yaw: number): Item[] {
  const rot = rotationZ(yaw);
  const items: Item[] = [];
  for (const part of parts) {
    if (part.payload || part.group === 'reference' || isBridle(part)) continue;
    const obb = partOBB({ ...part, transform: multiply(rot, part.transform) });
    const { min, max } = aabbOf(obb);
    items.push({ id: part.id, obb, min, max, isWheel: part.geometry.type === 'wheel', aligned: isAligned(obb) });
  }
  return items;
}

interface SolidItem {
  id: string;
  obb: OBB;
  min: Vec3;
  max: Vec3;
  floor: boolean;
}

function makeSolids(p: Params): SolidItem[] {
  return buildTruckBed(p).map((part) => {
    const obb = partOBB(part);
    const { min, max } = aabbOf(obb);
    return { id: part.id, obb, min, max, floor: FLOOR_IDS.has(part.id) };
  });
}

/** Cheap axis-aligned lower bound on the separation (inches). */
function aabbGap(it: Item, s: SolidItem, tx: number): number {
  const gx = Math.max(it.min[0] + tx - s.max[0], s.min[0] - (it.max[0] + tx));
  const gy = Math.max(it.min[1] - s.max[1], s.min[1] - it.max[1]);
  const gz = Math.max(it.min[2] - s.max[2], s.min[2] - it.max[2]);
  return Math.max(gx, gy, gz);
}

/** Separation of box pair (negative = penetration depth). Exact Euclidean when the cart box is axis-aligned. */
function separation(it: Item, s: SolidItem, tx: number, scratch: OBB): number {
  if (it.aligned) {
    const gx = Math.max(it.min[0] + tx - s.max[0], s.min[0] - (it.max[0] + tx));
    const gy = Math.max(it.min[1] - s.max[1], s.min[1] - it.max[1]);
    const gz = Math.max(it.min[2] - s.max[2], s.min[2] - it.max[2]);
    const m = Math.max(gx, gy, gz);
    if (m <= 0) return m;
    return Math.hypot(Math.max(gx, 0), Math.max(gy, 0), Math.max(gz, 0));
  }
  scratch.center[0] = it.obb.center[0] + tx;
  scratch.center[1] = it.obb.center[1];
  scratch.center[2] = it.obb.center[2];
  scratch.axes = it.obb.axes;
  scratch.half = it.obb.half;
  return -obbOverlap(scratch, s.obb);
}

/** Clearance of one cart item from one solid. Infinity = harmless contact with / hovering over a floor. */
function pairClearance(it: Item, s: SolidItem, tx: number, scratch: OBB): number {
  const c = separation(it, s, tx, scratch);
  if (s.floor) return c >= -FLOOR_PENETRATION_IN ? Infinity : c;
  return c;
}

function overallOf(items: Item[]): Overall {
  if (!items.length) return { lengthIn: 0, widthIn: 0, heightIn: 0 };
  const mn: Vec3 = [Infinity, Infinity, Infinity];
  const mx: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const it of items) for (let k = 0; k < 3; k++) {
    mn[k] = Math.min(mn[k], it.min[k]);
    mx[k] = Math.max(mx[k], it.max[k]);
  }
  return { lengthIn: mx[0] - mn[0], widthIn: mx[1] - mn[1], heightIn: mx[2] - mn[2] };
}

function evaluate(p: Params, items: Item[], solids: SolidItem[], mode: Stowage, orientation: Orientation, config: Config, usable: number, step: number, detail: boolean): FitCase {
  const req = p.truckClearanceIn;
  const cap = req + 2;
  const key = caseKey(mode, orientation, config);
  const yaw = orientation === 'nose-bulkhead' ? Math.PI : 0;
  if (!items.length) {
    return { key, mode, orientation, config, fits: false, placement: null, minClearanceIn: 0, limiting: [], colliding: [], modeFeasible: false, slack: null, axles: [], axlesClearWells: null, note: 'No cart parts.' };
  }
  let a = Infinity, b = -Infinity;
  for (const it of items) {
    a = Math.min(a, it.min[0]);
    b = Math.max(b, it.max[0]);
  }
  const lo = Math.ceil((-a - 1) / step) * step;
  const hi = usable - b + 1;
  const txs: number[] = [];
  if (lo > hi) txs.push((usable - (a + b)) / 2);
  else for (let t = lo; t <= hi + 1e-9; t += step) txs.push(t);

  const wheelItems = items.filter((i) => i.isWheel);
  const ws = p.truckWellStartIn;
  const we = p.truckWellStartIn + p.truckWellLengthIn;
  const gapLo = p.truckBedLengthIn;
  const gapHi = p.truckBedLengthIn + p.truckTailgateGapIn;
  const centres = wheelItems.map((i) => i.obb.center[0]);
  const wmid = centres.length ? (Math.min(...centres) + Math.max(...centres)) / 2 : 0;
  // The axle nearer the bulkhead ('low') must sit wholly ahead of the wells, the other wholly behind them.
  const lowEdge = Math.max(-Infinity, ...wheelItems.filter((i) => i.obb.center[0] <= wmid).map((i) => i.max[0]));
  const highEdge = Math.min(Infinity, ...wheelItems.filter((i) => i.obb.center[0] > wmid).map((i) => i.min[0]));
  const besideOk = wheelItems.every((i) => Math.max(Math.abs(i.min[1]), Math.abs(i.max[1])) + req <= p.truckWellGapIn / 2 + 1e-9);
  let modeNote = '';
  let modeIssue = '';
  const okMode = (tx: number) => {
    if (!wheelItems.length) return true;
    if (p.truckTailgateGapIn > 0 && centres.some((c) => c + tx > gapLo - TIRE_PATCH_HALF_IN && c + tx < gapHi + TIRE_PATCH_HALF_IN)) return false;
    if (mode === 'beside') return besideOk;
    return lowEdge + tx + req <= ws + 1e-9 && highEdge + tx - req >= we - 1e-9;
  };
  let cands = txs.filter(okMode);
  const modeFeasible = cands.length > 0;
  if (!modeFeasible) {
    cands = txs;
    if (mode === 'beside' && !besideOk) modeIssue = 'wheels wider than well gap';
    else if (mode === 'straddle') modeIssue = 'wheelbase vs. wells / hinge gap';
    else modeIssue = 'tire over hinge gap';
    if (mode === 'beside' && !besideOk) modeNote = 'Wheels are wider than the gap between the wheel wells (track too wide for beside); least-bad placement shown.';
    else if (mode === 'straddle') modeNote = 'The wheelbase cannot put the front wheels wholly ahead of the wells and the rear wheels wholly behind them (or a tire would rest on the tailgate hinge gap); least-bad placement shown.';
    else modeNote = 'A tire would rest on the tailgate hinge gap in every position; least-bad placement shown.';
  }

  const scratch: OBB = { center: [0, 0, 0], axes: items[0].obb.axes, half: items[0].obb.half };
  const mid = (usable - (a + b)) / 2;
  let bestTx = cands[0];
  let bestMin = -Infinity;
  let bestDist = Infinity;
  for (const tx of cands) {
    let m = Math.min(cap, usable - (b + tx)); // clearance to the tailgate end
    let dead = false;
    for (const it of items) {
      for (const s of solids) {
        const gap = aabbGap(it, s, tx);
        if (gap >= cap || (s.floor && gap >= FLOOR_PENETRATION_IN)) continue;
        const c = pairClearance(it, s, tx, scratch);
        if (c < m) m = c;
      }
      if (m < bestMin - 1e-9) { dead = true; break; } // cannot beat the best so far
    }
    if (dead) continue;
    const dist = Math.abs(tx - mid);
    if (m > bestMin + 1e-9 || (Math.abs(m - bestMin) <= 1e-9 && dist < bestDist)) {
      bestMin = m;
      bestTx = tx;
      bestDist = dist;
    }
  }

  /** Min clearance of the whole cart at a shift (no early exit). */
  const clearanceAt = (tx: number) => {
    let m = Math.min(cap, usable - (b + tx));
    for (const it of items) {
      for (const s of solids) {
        const gap = aabbGap(it, s, tx);
        if (gap >= cap || (s.floor && gap >= FLOOR_PENETRATION_IN)) continue;
        const c = pairClearance(it, s, tx, scratch);
        if (c < m) m = c;
      }
    }
    return m;
  };

  // Exact detail at the chosen placement.
  const pairs: PairInfo[] = [];
  for (const it of items) {
    for (const s of solids) {
      const c = pairClearance(it, s, bestTx, scratch);
      if (Number.isFinite(c)) pairs.push({ partId: it.id, solidId: s.id, clearanceIn: c });
    }
    pairs.push({ partId: it.id, solidId: 'tailgate-end', clearanceIn: usable - (it.max[0] + bestTx) });
  }
  pairs.sort((x, y) => x.clearanceIn - y.clearanceIn);
  const minClr = pairs.length ? pairs[0].clearanceIn : 0;
  const fits = modeFeasible && minClr >= req - 1e-9;
  const colliding = fits ? [] : pairs.filter((q) => q.clearanceIn < req - 1e-9).slice(0, 12);

  // True fore-aft slack: slide the cart each way from the placement while it still fits.
  let slack: Slack | null = null;
  if (fits && detail) {
    const walk = (dir: 1 | -1) => {
      let n = 0;
      for (let k = 1; k * step <= usable; k++) {
        const tx = bestTx + dir * k * step;
        if (!okMode(tx) || clearanceAt(tx) < req - 1e-9) break;
        n = k;
      }
      return n * step;
    };
    const toBulkheadIn = walk(-1), toTailgateIn = walk(1);
    slack = { toBulkheadIn, toTailgateIn, totalIn: toBulkheadIn + toTailgateIn };
  }

  // Per-axle fore-aft margins (truck frame) at the placement.
  const axles: AxleMargin[] = [];
  let axlesClearWells: boolean | null = null;
  if (wheelItems.length) {
    const rods = items.filter((i) => !i.isWheel && /^axle/i.test(i.id));
    axlesClearWells = true;
    for (const side of ['bulkhead', 'tailgate'] as const) {
      const ws_ = wheelItems.filter((i) => (side === 'bulkhead') === (i.obb.center[0] <= wmid));
      if (!ws_.length) continue;
      const x0 = Math.min(...ws_.map((i) => i.min[0])) + bestTx;
      const x1 = Math.max(...ws_.map((i) => i.max[0])) + bestTx;
      const cx = ws_.reduce((t, i) => t + i.obb.center[0], 0) / ws_.length + bestTx;
      const mine = rods.filter((i) => (side === 'bulkhead') === (i.obb.center[0] <= wmid));
      const r0 = mine.length ? Math.min(...mine.map((i) => i.min[0])) + bestTx : cx;
      const r1 = mine.length ? Math.max(...mine.map((i) => i.max[0])) + bestTx : cx;
      const gap = Math.max(ws - x1, x0 - we);
      const rodGap = Math.max(ws - r1, r0 - we);
      if (rodGap < 0) axlesClearWells = false;
      axles.push({
        side,
        cartAxle: (side === 'bulkhead') === (orientation === 'nose-tailgate') ? 'rear' : 'front',
        wheelX: [x0, x1],
        wheelWellGapIn: gap,
        wheelWellOverlapIn: Math.max(0, Math.min(x1, we) - Math.max(x0, ws)),
        rodWellGapIn: rodGap,
        hingeGapIn: Math.max(gapLo - (cx + TIRE_PATCH_HALF_IN), cx - TIRE_PATCH_HALF_IN - gapHi),
        relation: gap < 0 ? 'beside' : x1 <= ws ? 'ahead' : 'behind',
      });
    }
  }
  return {
    key, mode, orientation, config, fits,
    placement: { txIn: bestTx, yawDeg: (yaw * 180) / Math.PI, transform: multiply(translation(bestTx, 0, 0), rotationZ(yaw)) },
    minClearanceIn: Math.min(minClr, 50),
    limiting: pairs.slice(0, 4),
    colliding,
    modeFeasible,
    slack,
    axles,
    axlesClearWells,
    note: modeFeasible ? undefined : modeNote,
    modeIssue: modeFeasible ? undefined : modeIssue,
  };
}

/** All 12 cases for one parameter set (cheap path used by the window search too). */
function evaluateAll(p: Params, buildParts: (view: CartView) => Part[], step: number, detail: boolean): { cases: FitCase[]; dims: Record<Config, Overall> } {
  const usable = truckUsableLength(p);
  const solids = makeSolids(p);
  const cases: FitCase[] = [];
  const dims = {} as Record<Config, Overall>;
  for (const config of CONFIGS) {
    const parts = configParts(config, buildParts);
    dims[config] = overallOf(prepare(parts, 0));
    for (const orientation of ['nose-tailgate', 'nose-bulkhead'] as Orientation[]) {
      const items = prepare(parts, orientation === 'nose-bulkhead' ? Math.PI : 0);
      for (const mode of ['beside', 'straddle'] as Stowage[]) cases.push(evaluate(p, items, solids, mode, orientation, config, usable, step, detail));
    }
  }
  return { cases, dims };
}

export function checkTruckFit(p: Params, buildParts: (view: CartView) => Part[]): FitResult {
  const t0 = performance.now();
  const { cases, dims } = evaluateAll(p, buildParts, STEP_IN, true);
  const fitting = cases.filter((c) => c.fits).sort((x, y) => y.minClearanceIn - x.minClearanceIn);
  const best = fitting[0] ?? [...cases].sort((x, y) => y.minClearanceIn - x.minClearanceIn)[0] ?? null;
  return {
    cases,
    dims,
    requiredClearanceIn: p.truckClearanceIn,
    usableLengthIn: truckUsableLength(p),
    anyFits: fitting.length > 0,
    best,
    evalMs: performance.now() - t0,
  };
}

// ── Feasible windows (D-23) ─────────────────────────────────────────────────

export interface FitWindow {
  mode: Stowage;
  config: Config;
  /** Does the current design fit (any orientation)? */
  fitsNow: boolean;
  /** Largest track (front = rear) that fits at the current wheelbase; null if none does. */
  maxTrackIn: number | null;
  /** What stops the next-wider track (part / solid, or the mode note). */
  trackLimitedBy?: string;
  /** Wheelbase range that fits at the current track; null if none does. */
  wheelbaseMinIn: number | null;
  wheelbaseMaxIn: number | null;
  wheelbaseLimitedBy?: string;
  /** Largest track the bed alone would accept if the validator were ignored (null = none). */
  maxTrackBedOnlyIn: number | null;
  /** Set when the validator (not the bed) bounds the window on that axis. */
  trackBoundedByValidator: boolean;
  wheelbaseBoundedByValidator: boolean;
  /** Set when the current design itself fails `validateParams` (no window can be reported). */
  invalidNow?: string;
  /** Beside mode: at the max track, do the axle ends also clear the wells fore-aft (so only the tires are beside)? */
  axlesClearWellsAtMax: boolean | null;
  /** Purely lateral beside limit, `derived().maxTrackBesideWells` (the validator's number). */
  lateralLimitIn: number;
  /** Static stability factor preview (D-23): (track / 2) / loaded CG height, operating rider + cargo. Phase 2 does the full check. */
  ssfNow: number;
  ssfAtMax: number | null;
  /** SSF at the bed-only max track; reaching it needs nose width and shoulder re-derived (Phase 2). */
  ssfAtBedMax: number | null;
  cgHeightNowIn: number;
  cgHeightAtMaxIn: number | null;
}

export interface FitWindows {
  windows: FitWindow[];
  evals: number;
  ms: number;
}

type Build = (p: Params, view: CartView) => Part[];
interface VerdictEntry {
  fits: boolean;
  limiter: string;
  /** `validateParams` rejects the design (not buildable), so it was not evaluated against the bed. */
  invalid: boolean;
  /** Would the bed accept it if the validator were ignored? (Shows what the validator, not the truck, is costing.) */
  bedFits: boolean;
  axlesClear: boolean | null;
}
type Verdict = Map<string, VerdictEntry>;

const WINDOW_STEP_IN = 0.5; // fore-aft search step inside the window scan
const verdictKey = (mode: Stowage, config: Config) => `${mode}|${config}`;

/** First validator error for a parameter set, or null (M1: designs the validator rejects are not buildable). */
export function validatorError(p: Params): string | null {
  const e = validateParams(p).find((i) => i.severity === 'error');
  return e ? e.message : null;
}

function verdicts(p: Params, build: Build): Verdict {
  const out: Verdict = new Map();
  const bad = validatorError(p);
  let cases: FitCase[];
  try {
    cases = evaluateAll(p, (v) => build(p, v), WINDOW_STEP_IN, false).cases;
  } catch {
    cases = [];
  }
  for (const mode of ['beside', 'straddle'] as Stowage[]) {
    for (const config of CONFIGS) {
      const cs = cases.filter((c) => c.mode === mode && c.config === config);
      const fitting = cs.filter((c) => c.fits).sort((x, y) => y.minClearanceIn - x.minClearanceIn);
      const worst = [...cs].sort((x, y) => y.minClearanceIn - x.minClearanceIn)[0];
      const q = worst?.colliding[0];
      const limiter = bad ? `${bad} (validator)` : !worst ? 'model invalid' : q ? `${q.partId} / ${q.solidId.replace('truck-', '')}` : worst.modeIssue ?? '';
      out.set(verdictKey(mode, config), {
        fits: !bad && fitting.length > 0, limiter, invalid: !!bad, bedFits: fitting.length > 0, axlesClear: fitting[0]?.axlesClearWells ?? null,
      });
    }
  }
  return out;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Per mode and configuration: the max track at the current wheelbase and the wheelbase window at the current
 * track. Scans at 1" steps then refines the edges to 0.25", rebuilding the model per point. Yields to the event
 * loop between evaluations; `cancelled()` aborts (returns null).
 */
export async function computeFeasibleWindows(p: Params, build: Build, cancelled: () => boolean = () => false): Promise<FitWindows | null> {
  const t0 = performance.now();
  // Loaded CG height (operating rider + cargo) at a given track, from the model's own mass functions.
  const cgCache = new Map<number, number>();
  const cgHeight = (track: number) => {
    const k = Math.round(track * 1000);
    let h = cgCache.get(k);
    if (h === undefined) {
      const q = { ...p, rearTrackIn: track, frontTrackIn: track };
      h = centerOfGravity(build(q, { steerDeg: 0, rider: 'operating', cargo: true, removed: false }), { includePayload: true })[2];
      cgCache.set(k, h);
    }
    return h;
  };
  const ssf = (track: number) => track / 2 / cgHeight(track);
  const invalidNow = validatorError(p);
  const lateralLimitIn = derived(p).maxTrackBesideWells;
  let evals = 0;
  const run = async (q: Params): Promise<Verdict | null> => {
    await tick();
    if (cancelled()) return null;
    evals++;
    return verdicts(q, build);
  };
  const scan = async (keyNames: (keyof Params)[], base: number, def: { min: number; max: number }, coarse: number, fine: number) => {
    const cache = new Map<number, Verdict>();
    const at = async (v: number) => {
      const k = Math.round(v * 1000);
      let r = cache.get(k);
      if (!r) {
        const q = { ...p };
        for (const n of keyNames) q[n] = v;
        const got = await run(q);
        if (!got) return null;
        cache.set(k, got);
        r = got;
      }
      return r;
    };
    const values: number[] = [];
    for (let v = def.min; v <= def.max + 1e-9; v += coarse) values.push(v);
    values.push(base);
    const sorted = [...new Set(values.map((v) => Math.round(v * 1000) / 1000))].sort((x, y) => x - y);
    for (const v of sorted) if (!(await at(v))) return null;
    // Refine the edges of each (mode, config) feasible set.
    const keys = [...cache.values()][0]?.keys() ?? [];
    for (const k of keys) {
      const fitsAt = (v: number) => cache.get(Math.round(v * 1000))?.get(k)?.fits ?? false;
      const feas = sorted.filter(fitsAt);
      if (!feas.length) continue;
      const lo = feas[0], hi = feas[feas.length - 1];
      for (let v = lo - fine; v > lo - coarse + 1e-9 && v >= def.min - 1e-9; v -= fine) if (!(await at(v))) return null;
      for (let v = hi + fine; v < hi + coarse - 1e-9 && v <= def.max + 1e-9; v += fine) if (!(await at(v))) return null;
    }
    return cache;
  };

  const trackDef = PARAM_DEFS.rearTrackIn;
  const wbDef = PARAM_DEFS.wheelbaseIn;
  const trackScan = await scan(['rearTrackIn', 'frontTrackIn'], p.rearTrackIn, trackDef, 1, 0.25);
  if (!trackScan) return null;
  const wbScan = await scan(['wheelbaseIn'], p.wheelbaseIn, wbDef, 1, 0.25);
  if (!wbScan) return null;

  const windows: FitWindow[] = [];
  for (const mode of ['beside', 'straddle'] as Stowage[]) {
    for (const config of CONFIGS) {
      const k = verdictKey(mode, config);
      const ts = [...trackScan.entries()].map(([v, r]) => ({ v: v / 1000, r: r.get(k)! }));
      const ws = [...wbScan.entries()].map(([v, r]) => ({ v: v / 1000, r: r.get(k)! }));
      ts.sort((x, y) => x.v - y.v);
      ws.sort((x, y) => x.v - y.v);
      const fitT = ts.filter((x) => x.r.fits);
      const fitW = ws.filter((x) => x.r.fits);
      const maxT = fitT.length ? fitT[fitT.length - 1].v : null;
      const nextT = maxT === null ? null : ts.find((x) => x.v > maxT && !x.r.fits);
      const wmin = fitW.length ? fitW[0].v : null;
      const wmax = fitW.length ? fitW[fitW.length - 1].v : null;
      const wLimit = wmax === null ? null : ws.find((x) => x.v > wmax && !x.r.fits);
      const wLimitLo = wmin === null ? null : [...ws].reverse().find((x) => x.v < wmin && !x.r.fits);
      const what = (e: VerdictEntry | undefined) => e?.limiter;
      const trackLimit = nextT && maxT !== null
        ? nextT.r.invalid ? `track > ${maxT.toFixed(2)}": ${nextT.r.limiter}` : nextT.r.limiter
        : undefined;
      const wbLimits = [
        wLimitLo && (wLimitLo.r.invalid ? `wheelbase < ${wmin!.toFixed(2)}": ${what(wLimitLo.r)}` : `shorter: ${wLimitLo.r.limiter}`),
        wLimit && (wLimit.r.invalid ? `wheelbase > ${wmax!.toFixed(2)}": ${what(wLimit.r)}` : `longer: ${wLimit.r.limiter}`),
      ].filter(Boolean);
      windows.push({
        mode, config,
        fitsNow: ts.find((x) => Math.abs(x.v - p.rearTrackIn) < 1e-6)?.r.fits ?? false,
        maxTrackIn: maxT,
        trackLimitedBy: trackLimit,
        wheelbaseMinIn: wmin,
        wheelbaseMaxIn: wmax,
        wheelbaseLimitedBy: wbLimits.join('; ') || undefined,
        maxTrackBedOnlyIn: ts.filter((x) => x.r.bedFits).pop()?.v ?? null,
        trackBoundedByValidator: !!nextT?.r.invalid,
        wheelbaseBoundedByValidator: !!(wLimit?.r.invalid || wLimitLo?.r.invalid),
        invalidNow: invalidNow ?? undefined,
        axlesClearWellsAtMax: maxT === null ? null : fitT[fitT.length - 1].r.axlesClear,
        lateralLimitIn,
        ssfNow: ssf(p.rearTrackIn),
        ssfAtMax: maxT === null ? null : ssf(maxT),
        ssfAtBedMax: (() => { const b = ts.filter((x) => x.r.bedFits).pop()?.v; return b === undefined ? null : ssf(b); })(),
        cgHeightNowIn: cgHeight(p.rearTrackIn),
        cgHeightAtMaxIn: maxT === null ? null : cgHeight(maxT),
      });
    }
  }
  return { windows, evals, ms: performance.now() - t0 };
}
