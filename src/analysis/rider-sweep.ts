/**
 * Rider sweep (D-30): "for what rider weights is this sled safe?" Pure TypeScript, no DOM.
 *
 * For each weight w the checks run with the operating, goal and lightest rider all set to w, so every load case is the
 * same rider. Truck fit does not depend on the rider and is evaluated once (or taken from `opts.fit`). A design is a plain
 * `Params` object throughout, so scenario A vs. B is just two sweeps (spec "Scenario A/B readiness").
 */
import type { Params } from '../params';
import { checkTruckFit, type FitResult } from '../truck/fit';
import { buildModel } from '../model';
import { runChecks } from './index';
import { truckFit } from './transport';
import { SEVERITY, worst, type AnalysisCheck, type Status } from './types';

/** The six plain-English groups the Simple view reports on. */
export type Light = 'tipping' | 'turns' | 'hills' | 'steering' | 'strength' | 'truck';
export const LIGHTS: Light[] = ['tipping', 'turns', 'hills', 'steering', 'strength', 'truck'];

/**
 * Which light each check id belongs to. 'info' rows never color a light (they are reported only): the empty mass and CG
 * live on the spec card, and the turn rollover speed (v-rollover) and rear-only traction are quoted in sentences.
 */
export const LIGHT_OF_ID: Record<string, Light | 'info'> = {
  'tip-straight': 'tipping', 'tip-lock': 'tipping', 'cargo-height': 'info',
  'slide-before-tip': 'turns', 'v-rollover': 'turns',
  'pitch-fwd': 'hills', 'pitch-rear': 'hills', 'brake-force': 'info', 'brake-slow': 'hills', 'brake-traction': 'hills', 'brake-ratio': 'hills', 'brake-clear': 'hills', 'park-hold': 'hills',
  'turn-radius': 'steering', 'steer-clear': 'steering',
  // D-56: the bridle tie (shackle, tongue plate, tongue bolts); the handler's step brake (D-57): its braking rows (and the chock parking hold) color Hills, its member rows Strength.
  'bridle-eye': 'strength',
  // The pivoting front axle (D-56): kingpin, thrust washer, front beam and stubs, steering stops and the king beam carry the rider's weight and the bumps.
  kingpin: 'strength', 'king-bearing': 'strength', 'front-beam': 'strength', 'front-stub': 'strength', 'steer-stops': 'strength', 'king-beam': 'strength',
  'truck-fit': 'truck',
  'mass-empty': 'info', cg: 'info',
  // Strength = every `group === 'Structure'` check (kept explicit so the mapping test can see them).
  'brake-flap': 'strength', 'brake-pivot': 'strength', 'brake-mount': 'strength', 'brake-return': 'strength', 'handle-sockets': 'strength',
  'brake-abuse': 'strength', 'wheel-rating': 'strength', 'rear-beam-seat': 'strength', 'axle-stress': 'strength', 'beam-rear': 'strength', 'bearing-groove': 'strength', rails: 'strength', deck: 'strength',
  // Seat and fittings (D-40, D-41): the seat back and grips carry a rider, so they color Strength; packing, lid swing and
  // lash-point count are build-fit facts that do not change with rider weight and are reported only.
  'seat-back': 'strength', 'seat-grip': 'strength', 'storage-pack': 'info', 'storage-lid-open': 'info', 'lash-points': 'info',
  // Hull (D-43): the lift does not depend on the rider; the foot stop carries the rider's restraint load. Both color Strength.
  lift: 'strength', 'foot-stop': 'strength', 'side-web': 'strength', 'lash-load': 'info',
  // D-76: the side pushed in or out (a 50 lbf push, the D-ring rating): a strength row that does not change with the rider (RIDER_INDEPENDENT).
  'side-lateral': 'strength',
  // Cargo mode (D-53): the joists carry the seat and the cargo, the handlebow the handler; the stow fit, the lid and the tie-downs are cargo facts and color no light.
  'rest-load': 'strength', joists: 'strength', 'handle-bow': 'strength', 'seat-stow': 'info', 'lid-load': 'info', 'cargo-strap': 'info',
};

export function lightOf(c: Pick<AnalysisCheck, 'id' | 'group'>): Light | 'info' {
  return LIGHT_OF_ID[c.id] ?? (c.group === 'Structure' ? 'strength' : 'info');
}

export interface Limiter { id: string; label: string; util: number; status: Status }

export interface SweepPoint {
  w: number;
  /** Worst status over the rider-dependent checks (truck fit excluded). */
  status: Status;
  /** The check closest to (or past) its limit at this weight. */
  worst: Limiter | null;
  byLight: Record<Light, Status>;
  /** Ids of the failing checks at this weight. */
  fails: string[];
}

export interface SweepOptions {
  fromLb?: number;
  toLb?: number;
  stepLb?: number;
  /** A precomputed truck-fit result (the app already has one); otherwise it is computed once. */
  fit?: FitResult;
}

export interface SafeRange {
  loLb: number;
  hiLb: number;
  /** The run reaches the end of the swept range, so there is no limit on that side. */
  openLow: boolean;
  openHigh: boolean;
}

export interface SweepResult {
  points: SweepPoint[];
  fromLb: number;
  toLb: number;
  stepLb: number;
  /** The evaluation at the operating weight (`p.riderMassLb`) and its checks, all riders set to that weight. */
  operating: SweepPoint;
  operatingChecks: AnalysisCheck[];
  /** Widest run of weights with no fail that contains the operating weight; null when the operating weight fails. */
  safe: SafeRange | null;
  /** Widest all-green run (no "close to the limit" weights) that contains the operating weight; null when that weight is yellow or red. */
  green: SafeRange | null;
  /** What fails just below / just above the safe range (null when the range is open on that side). */
  lowLimit: Limiter | null;
  highLimit: Limiter | null;
  truckStatus: Status;
}

const RIDER_KEYS = ['riderMassLb', 'riderGoalMassLb', 'riderMinMassLb'] as const;

/** Geometry-only checks: they don't change with rider weight, so they color their light but not the rider bar. */
// D-76: side-lateral and side-web load the side with a push, a kick and the D-ring rating, none of which changes with the rider: a fail colors Strength, not the rider bar.
export const RIDER_INDEPENDENT = new Set(['turn-radius', 'steer-clear', 'truck-fit', 'rest-load', 'side-lateral', 'side-web']);

/** Every rider case set to the same weight. */
export const withRider = (p: Params, w: number): Params => ({ ...p, riderMassLb: w, riderGoalMassLb: w, riderMinMassLb: w });

function pointFrom(w: number, checks: AnalysisCheck[], truckStatus: Status): SweepPoint {
  const byLight: Record<Light, Status> = { tipping: 'info', turns: 'info', hills: 'info', steering: 'info', strength: 'info', truck: truckStatus };
  let status: Status = 'info';
  let wc: AnalysisCheck | null = null;
  const fails: string[] = [];
  for (const c of checks) {
    const l = lightOf(c);
    if (l === 'info' || l === 'truck') continue;
    byLight[l] = worst(byLight[l], c.status);
    if (c.status === 'info' || RIDER_INDEPENDENT.has(c.id)) continue;
    status = worst(status, c.status);
    if (c.status === 'fail') fails.push(c.id);
    if (!wc || SEVERITY[c.status] > SEVERITY[wc.status] || (c.status === wc.status && (c.util ?? 0) > (wc.util ?? 0))) wc = c;
  }
  return { w, status, worst: wc ? { id: wc.id, label: wc.label, util: wc.util ?? 0, status: wc.status } : null, byLight, fails };
}

/** Run the checks at one rider weight (truck fit excluded). */
export function evaluateRider(p: Params, w: number, truckStatus: Status = 'info'): { point: SweepPoint; checks: AnalysisCheck[] } {
  const checks = runChecks(withRider(p, w), { includeTruck: false, cargo: false });
  return { point: pointFrom(w, checks, truckStatus), checks };
}

/**
 * The widest run of grid weights around `at` that all satisfy `ok`, and what stops it on each side. Pure; exported for tests.
 * Returns `run: null` when `at` itself does not satisfy `ok`.
 */
export function runAround(points: SweepPoint[], at: SweepPoint, ok: (s: Status) => boolean): { run: SafeRange | null; lowStop: SweepPoint | null; highStop: SweepPoint | null } {
  if (!ok(at.status)) return { run: null, lowStop: null, highStop: null };
  const w = at.w;
  const below = points.filter((x) => x.w <= w).sort((a, b) => b.w - a.w);
  const above = points.filter((x) => x.w >= w).sort((a, b) => a.w - b.w);
  let lo = w, hi = w;
  let lowStop: SweepPoint | null = null, highStop: SweepPoint | null = null;
  for (const x of below) { if (!ok(x.status)) { lowStop = x; break; } lo = Math.min(lo, x.w); }
  for (const x of above) { if (!ok(x.status)) { highStop = x; break; } hi = Math.max(hi, x.w); }
  return { run: { loLb: lo, hiLb: hi, openLow: !lowStop, openHigh: !highStop }, lowStop, highStop };
}

/** The widest no-fail run of grid weights around `w`, and what stops it on each side. Pure; exported for tests. */
export function safeRange(points: SweepPoint[], at: SweepPoint): Pick<SweepResult, 'safe' | 'lowLimit' | 'highLimit' | 'green'> {
  if (at.status === 'fail') return { safe: null, green: null, lowLimit: at.worst, highLimit: at.worst };
  const { run, lowStop, highStop } = runAround(points, at, (s) => s !== 'fail');
  // The comfortable tier: only the all-green run around the weight (a 'marginal' weight has none).
  const green = runAround(points, at, (s) => s !== 'fail' && s !== 'marginal').run;
  return { safe: run, green, lowLimit: lowStop?.worst ?? null, highLimit: highStop?.worst ?? null };
}

interface Core { points: SweepPoint[]; truckStatus: Status; fromLb: number; toLb: number; stepLb: number }
const coreCache = new Map<string, Core>();
const atCache = new Map<string, { point: SweepPoint; checks: AnalysisCheck[] }>();
const MAX_CACHE = 12;
const remember = <V>(m: Map<string, V>, k: string, v: V) => {
  m.set(k, v);
  if (m.size > MAX_CACHE) m.delete(m.keys().next().value as string);
};

/** Params JSON with the rider masses removed: the sweep overrides them, so dragging the rider slider never invalidates it. */
function designKey(p: Params): string {
  const q: Partial<Params> = { ...p };
  for (const k of RIDER_KEYS) delete q[k];
  return JSON.stringify(q);
}

export function clearRiderSweepCache(): void {
  coreCache.clear();
  atCache.clear();
}

function core(p: Params, o: Required<Omit<SweepOptions, 'fit'>>, fit: FitResult | undefined, key: string): Core {
  const ck = `${key}|${o.fromLb}|${o.toLb}|${o.stepLb}`;
  const hit = coreCache.get(ck);
  if (hit) return hit;
  const truckStatus = truckFit(fit ?? checkTruckFit(p, (v) => buildModel(p, v))).status;
  const points: SweepPoint[] = [];
  for (let w = o.fromLb; w <= o.toLb + 1e-9; w += o.stepLb) points.push(evaluateRider(p, w, truckStatus).point);
  const c = { points, truckStatus, ...o };
  remember(coreCache, ck, c);
  return c;
}

/** Cached by the design's params JSON (rider masses excluded). Target: well under 150 ms for the 21-point default sweep. */
export function riderSweep(p: Params, opts: SweepOptions = {}): SweepResult {
  const o = { fromLb: opts.fromLb ?? 50, toLb: opts.toLb ?? 250, stepLb: opts.stepLb ?? 10 };
  const key = designKey(p);
  const c = core(p, o, opts.fit, key);
  const w = p.riderMassLb;
  const grid = c.points.find((x) => Math.abs(x.w - w) < 1e-9);
  const atKey = `${key}|${w}`;
  let at = atCache.get(atKey);
  if (!at) {
    at = grid ? { point: grid, checks: runChecks(withRider(p, w), { includeTruck: false, cargo: false }) } : evaluateRider(p, w, c.truckStatus);
    remember(atCache, atKey, at);
  }
  return { ...c, operating: at.point, operatingChecks: at.checks, ...safeRange(c.points, at.point) };
}

/** The cache key of the sweep for this design (rider masses ignored): equal keys mean `riderSweep` returns at once. */
export function riderSweepKey(p: Params, opts: SweepOptions = {}): string {
  return `${designKey(p)}|${opts.fromLb ?? 50}|${opts.toLb ?? 250}|${opts.stepLb ?? 10}`;
}

/** True when a sweep for this design (rider masses ignored) is already cached, so `riderSweep` returns at once. */
export function isRiderSweepCached(p: Params, opts: SweepOptions = {}): boolean {
  return coreCache.has(riderSweepKey(p, opts));
}
