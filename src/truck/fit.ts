/**
 * Truck-fit check (BRIEF §4.5, D-6, D-9, D-23). Pure TS, no three.js.
 *
 * Tries both stowage modes (wheels 'beside' = between the wheel wells, 'straddle' = one axle ahead of
 * the wells and one behind them) x both orientations x both configurations (all parts installed /
 * removable parts removed, D-9), steer at 0. The cart sits with its wheel contacts on the bed floor /
 * tailgate (the two are coplanar) and is slid fore-aft in 0.25" steps. Collision = OBB separation
 * (SAT, model/bounds.ts) of every non-payload cart part against every bed solid must be at least
 * truckClearanceIn; the floor and tailgate are contact surfaces (touching is fine). The cart must also
 * end before the tailgate edge.
 *
 * Assumptions: the cart is centred on the bed centreline (no lateral search); wheels are boxes
 * (conservative for the round tire); the tailgate hinge gap is ignored; the bridle rope is excluded.
 */
import type { Params } from '../params';
import { obbOverlap, partOBB, type OBB } from '../model/bounds';
import { multiply, rotationZ, translation } from '../model/mat4';
import type { Mat4, Part, Vec3 } from '../model/types';
import { buildTruckBed, FLOOR_IDS } from './bed';

export type Stowage = 'beside' | 'straddle';
export type Orientation = 'nose-tailgate' | 'nose-bulkhead';
export type Config = 'installed' | 'removed';

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
  note?: string;
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
const FLOOR_PENETRATION_IN = 0.01;

interface Item {
  id: string;
  obb: OBB;
  min: Vec3;
  max: Vec3;
  isWheel: boolean;
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

function prepare(parts: Part[], yaw: number): Item[] {
  const rot = rotationZ(yaw);
  const items: Item[] = [];
  for (const part of parts) {
    if (part.payload || part.group === 'reference' || isBridle(part)) continue;
    const obb = partOBB({ ...part, transform: multiply(rot, part.transform) });
    const { min, max } = aabbOf(obb);
    items.push({ id: part.id, obb, min, max, isWheel: part.geometry.type === 'wheel' });
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

/** Clearance of one cart item (shifted +tx in x) from one solid. Infinity = harmless contact with a floor. */
function pairClearance(it: Item, s: SolidItem, tx: number, scratch: OBB): number {
  scratch.center[0] = it.obb.center[0] + tx;
  scratch.center[1] = it.obb.center[1];
  scratch.center[2] = it.obb.center[2];
  scratch.axes = it.obb.axes;
  scratch.half = it.obb.half;
  const ov = obbOverlap(scratch, s.obb);
  if (s.floor) return ov <= FLOOR_PENETRATION_IN ? Infinity : -ov;
  return -ov;
}

/** Cheap axis-aligned lower bound on the separation (inches). */
function aabbGap(it: Item, s: SolidItem, tx: number): number {
  const gx = Math.max(it.min[0] + tx - s.max[0], s.min[0] - (it.max[0] + tx));
  const gy = Math.max(it.min[1] - s.max[1], s.min[1] - it.max[1]);
  const gz = Math.max(it.min[2] - s.max[2], s.min[2] - it.max[2]);
  return Math.max(gx, gy, gz);
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

function evaluate(p: Params, items: Item[], solids: SolidItem[], mode: Stowage, orientation: Orientation, config: Config, usable: number): FitCase {
  const req = p.truckClearanceIn;
  const cap = req + 2;
  const key = caseKey(mode, orientation, config);
  const yaw = orientation === 'nose-bulkhead' ? Math.PI : 0;
  if (!items.length) {
    return { key, mode, orientation, config, fits: false, placement: null, minClearanceIn: 0, limiting: [], colliding: [], modeFeasible: false, note: 'No cart parts.' };
  }
  let a = Infinity, b = -Infinity;
  for (const it of items) {
    a = Math.min(a, it.min[0]);
    b = Math.max(b, it.max[0]);
  }
  const lo = Math.ceil((-a - 1) / STEP_IN) * STEP_IN;
  const hi = usable - b + 1;
  const txs: number[] = [];
  if (lo > hi) txs.push((usable - (a + b)) / 2);
  else for (let t = lo; t <= hi + 1e-9; t += STEP_IN) txs.push(t);

  // Stowage-mode rule (D-6). 'beside': every wheel sits laterally between the wells (so the track is limited
  // by the well gap); fore-aft position is free and collisions decide. 'straddle': one axle ahead of the wells
  // and the other behind them (wheel centres either side of the well span), so the track is limited only by
  // the bed width.
  const wheelItems = items.filter((i) => i.isWheel);
  const ws = p.truckWellStartIn;
  const we = p.truckWellStartIn + p.truckWellLengthIn;
  const wheels = wheelItems.map((i) => i.obb.center[0]);
  const wmid = wheels.length ? (Math.min(...wheels) + Math.max(...wheels)) / 2 : 0;
  // Straddle: the whole of the low-x axle's wheels ahead of the wells, the whole of the high-x axle's behind them.
  const lowEdge = Math.max(-Infinity, ...wheelItems.filter((i) => i.obb.center[0] <= wmid).map((i) => i.max[0]));
  const highEdge = Math.min(Infinity, ...wheelItems.filter((i) => i.obb.center[0] > wmid).map((i) => i.min[0]));
  const besideOk = wheelItems.every((i) => Math.max(Math.abs(i.min[1]), Math.abs(i.max[1])) <= p.truckWellGapIn / 2);
  const okMode = (tx: number) => {
    if (!wheels.length) return true;
    return mode === 'beside' ? besideOk : lowEdge + tx <= ws && highEdge + tx >= we;
  };
  let cands = txs.filter(okMode);
  const modeFeasible = cands.length > 0;
  if (!modeFeasible) cands = txs;

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
  return {
    key, mode, orientation, config, fits,
    placement: { txIn: bestTx, yawDeg: (yaw * 180) / Math.PI, transform: multiply(translation(bestTx, 0, 0), rotationZ(yaw)) },
    minClearanceIn: Math.min(minClr, 50),
    limiting: pairs.slice(0, 4),
    colliding,
    modeFeasible,
    note: modeFeasible ? undefined : mode === 'beside' ? 'Track is wider than the gap between the wheel wells; showing the least-bad placement.' : 'Wheelbase is too short to straddle the wheel wells (front axle ahead, rear axle behind); showing the least-bad placement.',
  };
}

export function checkTruckFit(p: Params, buildParts: (view: CartView) => Part[]): FitResult {
  const t0 = performance.now();
  const usable = p.truckBedLengthIn + p.truckTailgateLengthIn;
  const solids: SolidItem[] = buildTruckBed(p).map((part) => {
    const obb = partOBB(part);
    const { min, max } = aabbOf(obb);
    return { id: part.id, obb, min, max, floor: FLOOR_IDS.has(part.id) };
  });
  const cases: FitCase[] = [];
  const dims = {} as Record<Config, Overall>;
  for (const config of ['installed', 'removed'] as Config[]) {
    const parts = buildParts({ steerDeg: 0, rider: 'none', cargo: false, removed: config === 'removed' });
    dims[config] = overallOf(prepare(parts, 0));
    for (const orientation of ['nose-tailgate', 'nose-bulkhead'] as Orientation[]) {
      const items = prepare(parts, orientation === 'nose-bulkhead' ? Math.PI : 0);
      for (const mode of ['beside', 'straddle'] as Stowage[]) cases.push(evaluate(p, items, solids, mode, orientation, config, usable));
    }
  }
  const fitting = cases.filter((c) => c.fits).sort((x, y) => y.minClearanceIn - x.minClearanceIn);
  const best = fitting[0] ?? [...cases].sort((x, y) => y.minClearanceIn - x.minClearanceIn)[0] ?? null;
  return {
    cases,
    dims,
    requiredClearanceIn: p.truckClearanceIn,
    usableLengthIn: usable,
    anyFits: fitting.length > 0,
    best,
    evalMs: performance.now() - t0,
  };
}
