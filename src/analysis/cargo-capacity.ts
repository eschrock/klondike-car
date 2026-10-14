/**
 * Cargo capacity (D-53): "how much can it haul after the race?" Pure TypeScript, no DOM. The cargo case runs next to the rider cases and never changes the rider range,
 * so this is a separate sweep over the PAYLOAD (the rider sweep is over the rider weight): the checks run at a ladder of payloads with the seat stowed and no rider, and
 * each row's cargo utilization is followed up the ladder.
 *
 * A row that already fails with nothing on the bed (for example the front caster rows, D-54) is not limited by the cargo, so it is
 * reported separately (`alwaysFailing`) and does not set the capacity. The capacity is where the first cargo-limited row reaches its limit (linear interpolation of its
 * utilization between ladder points); the "comfortable" payload is where the first one comes within 10% of its limit.
 */
import type { Params } from '../params';
import { cargoBed, type CargoBed } from '../model/bed';
import { buildModel } from '../model';
import { computeLayout } from '../model/layout';
import { seatStowPlan } from '../model/seat-stow';
import { runChecks } from './index';
import { SEVERITY, type AnalysisCheck, type Status } from './types';

/** Ladder of payloads (lb), plus the design payload. The cargoPayloadLb param itself is capped at 600. */
const LADDER = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600];
export const CARGO_SWEEP_MAX_LB = LADDER[LADDER.length - 1];

export interface CargoRowTrend {
  id: string;
  label: string;
  /** Cargo utilization at the design payload (1 = at the limit). */
  utilAtPayload: number;
  statusAtPayload: Status;
  /** Payload (lb) at which the row reaches its limit / comes within 10% of it; null = not within the ladder. */
  failAtLb: number | null;
  marginalAtLb: number | null;
  /** True when the row fails with an empty bed (not limited by the cargo). */
  fixed: boolean;
}

export interface CargoCapacity {
  /** The design payload (param) and the worst status of any cargo row at it. */
  payloadLb: number;
  statusAtPayload: Status;
  counts: { pass: number; marginal: number; fail: number };
  /** Largest payload at which no cargo-limited row has failed; null = none fails up to `maxLb`. */
  capacityLb: number | null;
  /** Largest payload at which no cargo-limited row is within 10% of its limit; null = none up to `maxLb`. */
  comfortableLb: number | null;
  maxLb: number;
  /** The cargo-limited row that sets the capacity (null when the ladder ends first). */
  limiter: CargoRowTrend | null;
  /**
   * The same, leaving out the rows that already fail for the riders at this design (the front-end and rear-axle-seat rows that 3c-3 sizes): what limits the load once those
   * are fixed. Null capacity = none of the remaining rows fails up to `maxLb`.
   */
  openIds: string[];
  capacityOtherLb: number | null;
  limiterOther: CargoRowTrend | null;
  /** Rows that fail even with an empty bed: not cargo-limited, fixed by 3c-3. */
  alwaysFailing: CargoRowTrend[];
  /** Rows failing at the design payload that the cargo causes (they pass with an empty bed). */
  cargoFailsAtPayload: CargoRowTrend[];
  rows: CargoRowTrend[];
  /** The flat bed (derived from the layout) and the seat-in-the-box fit at the design: the numbers the Simple view quotes. */
  bed: CargoBed;
  stow: { applicable: boolean; fits: boolean; status: Status; marginIn: { length: number; width: number; height: number } };
  /** Rear-only brake traction at the design payload, parked nose-down on the design slope (1 = just holds; the pullers or a chock hold the rest below that). Null when not evaluated. */
  rearTraction: number | null;
  /** The load-height rule (eng 3c S-5): the cargo center height the design assumes, where the tip limit is reached and where slide-before-tip is lost (in above the deck). Null when not evaluated. */
  heightRule: { designIn: number; tipLimitIn: number; slideLimitIn: number } | null;
}

function interpolate(w0: number, u0: number, w1: number, u1: number, level: number): number {
  if (u1 <= u0) return w1;
  return w0 + ((level - u0) / (u1 - u0)) * (w1 - w0);
}

const cache = new Map<string, CargoCapacity>();
const MAX_CACHE = 8;

/** Params JSON without the rider masses and the design payload: the ladder overrides the payload and the cargo case has no rider. */
function designKey(p: Params): string {
  const q: Partial<Params> = { ...p };
  delete q.riderMassLb; delete q.riderGoalMassLb; delete q.riderMinMassLb; delete q.cargoPayloadLb;
  return JSON.stringify(q);
}

/** The cache key of the sweep for this design: equal keys mean `cargoCapacity` returns at once. */
export function cargoCapacityKey(p: Params): string {
  return `${designKey(p)}|${p.cargoPayloadLb}`;
}

/** True when the sweep for this design is already cached, so `cargoCapacity` returns at once. */
export function isCargoCapacityCached(p: Params): boolean {
  return cache.has(cargoCapacityKey(p));
}

export function clearCargoCapacityCache(): void {
  cache.clear();
}

/** The capacity sweep for a design at its design payload. About a dozen runs of the checks (truck fit excluded); cached by the design. */
export function cargoCapacity(p: Params): CargoCapacity {
  const key = `${designKey(p)}|${p.cargoPayloadLb}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const ladder = [...new Set([...LADDER, p.cargoPayloadLb])].sort((a, b) => a - b);
  const runs = ladder.map((w) => ({ w, rows: runChecks({ ...p, cargoPayloadLb: w }, { includeTruck: false }) }));
  const ids = runs[0].rows.filter((c) => c.statusCargo !== undefined && c.statusCargo !== 'info').map((c) => c.id);
  const at = runs.find((r) => r.w === p.cargoPayloadLb)!;
  const rows: CargoRowTrend[] = ids.map((id) => {
    const series = runs.map((r) => ({ w: r.w, c: r.rows.find((c) => c.id === id) as AnalysisCheck }));
    const u = (s: { c: AnalysisCheck }) => s.c.utilCargo ?? 0;
    const fixed = (u(series[0]) > 1 + 1e-9) || series[0].c.statusCargo === 'fail';
    let failAt: number | null = null, margAt: number | null = null;
    for (let i = 1; i < series.length; i++) {
      if (margAt === null && u(series[i]) > 0.9) margAt = interpolate(series[i - 1].w, u(series[i - 1]), series[i].w, u(series[i]), 0.9);
      if (failAt === null && u(series[i]) > 1) failAt = interpolate(series[i - 1].w, u(series[i - 1]), series[i].w, u(series[i]), 1);
    }
    const here = series.find((s) => s.w === p.cargoPayloadLb)!.c;
    return { id, label: here.label, utilAtPayload: here.utilCargo ?? 0, statusAtPayload: here.statusCargo ?? 'info', failAtLb: failAt, marginalAtLb: margAt, fixed };
  });
  const limited = rows.filter((r) => !r.fixed);
  const first = (k: 'failAtLb' | 'marginalAtLb') => limited.filter((r) => r[k] !== null).sort((a, b) => (a[k] as number) - (b[k] as number))[0] ?? null;
  const open = new Set(at.rows.filter((c) => c.statusOperating === 'fail' || c.statusGoal === 'fail').map((c) => c.id));
  const firstOf = (list: CargoRowTrend[], k: 'failAtLb' | 'marginalAtLb') => list.filter((r) => r[k] !== null).sort((a, b) => (a[k] as number) - (b[k] as number))[0] ?? null;
  const fl = first('failAtLb');
  const mg = first('marginalAtLb');
  const flOther = firstOf(limited.filter((r) => !open.has(r.id)), 'failAtLb');
  const worstStatus = rows.reduce<Status>((a, r) => (SEVERITY[r.statusAtPayload] > SEVERITY[a] ? r.statusAtPayload : a), 'info');
  const L = computeLayout(p);
  const plan = seatStowPlan(p, L, buildModel(p, { rider: 'none', cargo: false }));
  const stowRow = at.rows.find((c) => c.id === 'seat-stow');
  const trac = at.rows.find((c) => c.id === 'brake-traction')?.cases?.cargo;
  const hr = at.rows.find((c) => c.id === 'cargo-height');
  const out: CargoCapacity = {
    bed: cargoBed(p, L),
    stow: { applicable: plan.applicable, fits: plan.fits, status: stowRow?.status ?? 'info', marginIn: { length: plan.margin.lengthIn, width: plan.margin.widthIn, height: plan.margin.heightIn } },
    rearTraction: trac ? trac.value : null,
    heightRule: hr && hr.detailsCargo && hr.detailsCargo.length > 1 ? { designIn: p.cargoCgHeightIn, tipLimitIn: hr.detailsCargo[0].value, slideLimitIn: hr.detailsCargo[1].value } : null,
    payloadLb: p.cargoPayloadLb, statusAtPayload: worstStatus,
    counts: { pass: rows.filter((r) => r.statusAtPayload === 'pass').length, marginal: rows.filter((r) => r.statusAtPayload === 'marginal').length, fail: rows.filter((r) => r.statusAtPayload === 'fail').length },
    capacityLb: fl ? Math.max(0, Math.floor(fl.failAtLb as number)) : null,
    comfortableLb: mg ? Math.max(0, Math.floor(mg.marginalAtLb as number)) : null,
    maxLb: CARGO_SWEEP_MAX_LB, limiter: fl,
    openIds: [...open], capacityOtherLb: flOther ? Math.max(0, Math.floor(flOther.failAtLb as number)) : null, limiterOther: flOther,
    alwaysFailing: rows.filter((r) => r.fixed),
    cargoFailsAtPayload: rows.filter((r) => !r.fixed && r.statusAtPayload === 'fail'),
    rows,
  };
  cache.set(key, out);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  return out;
}
