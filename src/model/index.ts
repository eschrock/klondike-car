import type { Params } from '../params';
import { makeCtx, type ViewState } from './build-utils';
import { buildBody, prowTop } from './body';
import { buildBrake } from './brake';
import { applyFinish } from './finish';
import { buildFrame } from './frame';
import { applyJoinery } from './joinery';
import { applyHardwareMass, buildHardware, buildLighting } from './lighting';
import { buildPayload } from './rider';
import { buildRunningGear } from './running-gear';
import { buildSeat } from './seat';
import { buildSteering } from './steering';
import { buildStorage } from './storage';
import type { Part } from './types';

export type { ViewState } from './build-utils';

/**
 * Phase 1 block model: Params -> Part[] at real dimensions. Pure and deterministic; no three.js.
 * Front steer-body parts rotate about the kingpin by view.steerDeg (clamped to ± lock).
 * `removed: true` omits `removable` parts (transport configuration, D-9).
 */
export function buildModel(input: Params, view: ViewState = {}): Part[] {
  const ctx = makeCtx(input, view); // resolves auto nose geometry (resolveParams) so every part and ctx.p agree
  const tip = prowTop(ctx);
  const parts = [
    ...buildRunningGear(ctx),
    ...buildSteering(ctx),
    ...buildFrame(ctx),
    ...buildBody(ctx),
    ...buildSeat(ctx),
    ...buildStorage(ctx),
    ...buildBrake(ctx),
    ...buildLighting(ctx, tip.x - 1, tip.z),
    ...buildHardware(ctx),
    ...buildPayload(ctx),
  ];
  applyJoinery(ctx, parts); // structured joints for the hull and frame (D-35)
  const out = ctx.view.removed ? parts.filter((x) => !x.removable) : parts;
  applyHardwareMass(out); // the fastener remainder, from the joints of the parts actually present
  applyFinish(out, ctx.p); // display finishing for the viewer (D-44): cosmetic, never read by the analysis
  return out;
}
