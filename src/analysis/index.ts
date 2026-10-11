/**
 * runChecks: Params → engineering checks (BRIEF §7, docs/phase2-spec.md). Pure TypeScript, no three.js.
 *
 * Builds the model once (goal rider, steer 0), derives the empty / operating / goal load cases from it, then runs the
 * stability, steering, braking, structure and mass/transport checks. The truck-fit call is the expensive one, so it is
 * optional: pass `{ includeTruck: false }` for the fast path, or a precomputed `fit` to reuse the Truck tab's result.
 */
import { resolveParams, type Params } from '../params';
import { buildModel } from '../model';
import { checkTruckFit, type FitResult } from '../truck/fit';
import { brakeClearance, brakeForce, brakeLever, brakeLinks, brakeRatchet, brakeRatio, brakeShaft, brakeShoes, brakeTraction, handleSockets } from './brake';
import { makeContext } from './context';
import { steerClearance, steerSweep } from './steering';
import { pitchForward, pitchRear, slideBeforeTip, tipLock, tipStraight, turnRadius, vRollover } from './stability';
import { axleStress, bearingGroove, beamFront, beamRear, deckCheck, kingpinCheck, kingpinStrikeCheck, railsCheck, rollBolsterAttachCheck, rollKingpinUpliftCheck, rollSideBearerCheck, tongueCheck, turntableCheck } from './structure';
import { bridleTieCheck, kingpinPeakCheck, kingpinSplitCheck, pitchPathCheck, steerStopsCheck } from './front';
import { cgCheck, massEmpty, truckFit, truckSkipped } from './transport';
import type { AnalysisCheck } from './types';

export * from './types';
export type { CaseData } from './loads';

export interface RunOptions {
  /** Run the truck-fit collision search (tens to hundreds of ms). Default true. */
  includeTruck?: boolean;
  /** Reuse an existing truck-fit result instead of computing one. */
  fit?: FitResult;
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

export function runChecks(input: Params, opts: RunOptions = {}): AnalysisCheck[] {
  const p = resolveParams(input); // auto nose width / shoulder (A-4, D-26)
  const parts = buildModel(p, { rider: 'goal', cargo: true, steerDeg: 0 });
  const ctx = makeContext(p, parts);
  const includeTruck = opts.includeTruck ?? true;
  const out: AnalysisCheck[] = [
    massEmpty(ctx),
    cgCheck(ctx),
    tipStraight(ctx),
    tipLock(ctx),
    slideBeforeTip(ctx),
    vRollover(ctx),
    turnRadius(ctx),
    steerClearance(ctx, steerSweep(ctx)),
    pitchForward(ctx),
    pitchRear(ctx),
    brakeRatio(ctx),
    brakeForce(ctx),
    brakeTraction(ctx),
    brakeClearance(ctx),
    brakeLever(ctx),
    brakeLinks(ctx),
    brakeShaft(ctx),
    brakeShoes(ctx),
    brakeRatchet(ctx),
    handleSockets(ctx),
    axleStress(ctx),
    beamFront(ctx),
    beamRear(ctx),
    bearingGroove(ctx),
    railsCheck(ctx),
    deckCheck(ctx),
    kingpinCheck(ctx),
    kingpinStrikeCheck(ctx),
    rollSideBearerCheck(ctx),
    rollKingpinUpliftCheck(ctx),
    rollBolsterAttachCheck(ctx),
    steerStopsCheck(ctx),
    kingpinPeakCheck(ctx),
    pitchPathCheck(ctx),
    kingpinSplitCheck(ctx),
    bridleTieCheck(ctx),
    turntableCheck(ctx),
    tongueCheck(ctx),
    includeTruck ? truckFit(opts.fit ?? checkTruckFit(p, (v) => buildModel(p, v))) : truckSkipped(),
  ];
  return out.map(sanitize);
}
