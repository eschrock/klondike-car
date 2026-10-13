/**
 * runChecks: Params → engineering checks (DESIGN.md). Pure TypeScript, no three.js.
 *
 * Builds the model once (goal rider, steer 0), derives the empty / operating / goal load cases from it, then runs the
 * stability, steering, braking, structure and mass/transport checks. The truck-fit call is the expensive one, so it is
 * optional: pass `{ includeTruck: false }` for the fast path, or a precomputed `fit` to reuse the Truck tab's result.
 */
import { resolveParams, type Params } from '../params';
import { buildModel } from '../model';
import { checkTruckFit, type FitResult } from '../truck/fit';
import { brakeChecks } from './brake';
import { makeContext, type Ctx } from './context';
import { rearBeamSeat, wheelRating } from './rear';
import { frontChecks } from './front';
import { cargoHeightCheck, pitchForward, pitchRear, slideBeforeTip, tipLock, tipStraight, turnRadius, vRollover } from './stability';
import { axleStress, bearingGroove, beamRear, deckCheck, railsCheck } from './structure';
import { bridleChecks } from './bridle';
import { seatChecks } from './seat';
import { hullChecks } from './hull';
import { cgCheck, massEmpty, truckFit, truckSkipped } from './transport';
import { cargoChecks } from './cargo';
import { restLoadCheck } from './rest';
import type { AnalysisCheck } from './types';

export * from './types';
export type { CaseData } from './loads';

export interface RunOptions {
  /** Run the truck-fit collision search (tens to hundreds of ms). Default true. */
  includeTruck?: boolean;
  /** Reuse an existing truck-fit result instead of computing one. */
  fit?: FitResult;
  /** Evaluate the cargo case (D-53) next to the rider cases. Default true; the rider sweeps pass false (they never read it). */
  cargo?: boolean;
}

/** Replace any non-finite number by a large sentinel so the UI never shows NaN (and the row fails). */
function sanitize(c: AnalysisCheck): AnalysisCheck {
  const fin = (x: number) => (Number.isFinite(x) ? x : 1e9);
  c.value = fin(c.value);
  c.limit = fin(c.limit);
  if (c.cases) for (const k of ['operating', 'goal'] as const) {
    const r = c.cases[k];
    if (r) { r.value = fin(r.value); r.limit = fin(r.limit); }
  }
  return c;
}

/**
 * The check list (D-50, D-53, D-54, D-56): the wheel contacts, the pivoting front axle rows (front.ts), the bump load basis (bridle tie, rear axle and
 * wheel rows) at walking and jogging pace, and the foot-operated rear brake rows (`brake.ts`).
 */
function allRows(ctx: Ctx, truck: AnalysisCheck): AnalysisCheck[] {
  return [
    massEmpty(ctx),
    cgCheck(ctx),
    tipStraight(ctx),
    tipLock(ctx),
    slideBeforeTip(ctx),
    cargoHeightCheck(ctx),
    vRollover(ctx),
    turnRadius(ctx),
    ...frontChecks(ctx),
    pitchForward(ctx),
    pitchRear(ctx),
    ...brakeChecks(ctx),
    wheelRating(ctx),
    rearBeamSeat(ctx),
    axleStress(ctx),
    beamRear(ctx),
    bearingGroove(ctx),
    railsCheck(ctx),
    deckCheck(ctx),
    ...bridleChecks(ctx),
    ...seatChecks(ctx),
    ...hullChecks(ctx),
    ...cargoChecks(ctx),
    restLoadCheck(ctx),
    truck,
  ];
}

export function runChecks(input: Params, opts: RunOptions = {}): AnalysisCheck[] {
  const p = resolveParams(input);
  const parts = buildModel(p, { rider: 'goal', cargo: true });
  const cargo = opts.cargo ?? true;
  const ctx = makeContext(p, parts, cargo ? buildModel(p, { rider: 'none', cargo: false, seat: 'stowed' }) : undefined);
  const includeTruck = opts.includeTruck ?? true;
  const truck = includeTruck ? truckFit(opts.fit ?? checkTruckFit(p, (v) => buildModel(p, v))) : truckSkipped();
  return allRows(ctx, truck).map(sanitize);
}
