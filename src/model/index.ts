import type { Params } from '../params';
import { makeCtx, unitDir, type ViewState } from './build-utils';
import { buildBody } from './body';
import { buildBrake } from './brake';
import { applyFinish } from './finish';
import { buildFrame } from './frame';
import { applyJoinery } from './joinery';
import { applyHardwareMass, buildHardware, buildLighting } from './lighting';
import { buildPayload } from './rider';
import { buildRunningGear } from './running-gear';
import { buildSeat } from './seat';
import { buildFrontEnd } from './front-end';
import { buildStorage } from './storage';
import type { Part } from './types';

export type { ViewState } from './build-utils';

/**
 * Phase 1 block model: Params -> Part[] at real dimensions. Pure and deterministic; no three.js.
 * The steered parts (knuckles, wheels, tie rod, bellcrank, links, tongue) sit at the Ackermann pose for view.steerDeg (the inner wheel, clamped to the mode's lock).
 * `removed: true` omits `removable` parts (transport configuration, D-9).
 */
export function buildModel(input: Params, view: ViewState = {}): Part[] {
  const ctx = makeCtx(input, view); // resolves auto nose geometry (resolveParams) so every part and ctx.p agree
  const parts = [
    ...buildRunningGear(ctx),
    ...buildFrontEnd(ctx),
    ...buildFrame(ctx),
    ...buildBody(ctx),
    ...buildSeat(ctx),
    ...buildStorage(ctx),
    ...buildBrake(ctx),
    ...buildLighting(ctx),
    ...buildHardware(ctx),
    ...buildPayload(ctx),
  ];
  applyJoinery(ctx, parts); // structured joints for the hull and frame (D-35)
  const out = ctx.view.removed ? parts.filter((x) => !x.removable) : parts;
  applyHardwareMass(out); // the fastener remainder, from the joints of the parts actually present
  applyFinish(out, ctx.p); // display finishing for the viewer (D-44): cosmetic, never read by the analysis
  for (const x of out) if (x.explode) x.explode = unitDir(x.explode)!; // the exploded view moves a part along a UNIT direction; builders pass rough directions
  return out;
}
