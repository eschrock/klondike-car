import type { Params } from '../params';
import { makeCtx, unitDir, type ViewState } from './build-utils';
import { buildBody } from './body';
import { addTransomEyeJoints, buildBrake } from './brake';
import { applyFinish } from './finish';
import { buildFrame } from './frame';
import { applyJoinery } from './joinery';
import { applyHardwareMass, buildHardware, buildLighting } from './lighting';
import { buildPayload } from './rider';
import { buildRunningGear } from './running-gear';
import { addGripBandJoints, buildSeat } from './seat';
import { addFlatPinDeckHoles, applySeatStow } from './seat-stow';
import { isBrakeKit, isChockKit, isLightKit } from './removable';
import { buildBridle } from './bridle';
import { buildPivot } from './pivot';
import { multiply, rotationZ, translation } from './mat4';
import { buildStorage } from './storage';
import { addSideRibJoints, buildSideRibs } from './side-ribs';
import type { Part } from './types';

export type { ViewState } from './build-utils';

/**
 * Phase 1 block model: Params -> Part[] at real dimensions. Pure and deterministic; no three.js.
 * The front axle parts (beam, stubs, kingpin, tongue, bridle) and the front wheels sit at the steering pose for view.steerDeg, turned about the kingpin (D-56).
 * `removed: true` omits `removable` parts (transport configuration, D-9, D-65); `brakes: false` / `lights: false` / `chocks: false` omit just that kit (D-65).
 */
export function buildModel(input: Params, view: ViewState = {}): Part[] {
  // One design change asks for the same (params, view) build several times (the viewer, the four summary cases, the truck fit and every analysis pass),
  // so the last few builds are kept. Callers get a fresh array over the shared Part objects, which they only read.
  const key = JSON.stringify(input) + JSON.stringify(view);
  const hit = buildCache.get(key);
  if (hit) {
    buildCache.delete(key);
    buildCache.set(key, hit); // most recent last
    return [...hit];
  }
  const out = buildModelUncached(input, view);
  buildCache.set(key, out);
  if (buildCache.size > BUILD_CACHE_MAX) buildCache.delete(buildCache.keys().next().value as string);
  return [...out];
}

const buildCache = new Map<string, Part[]>();
const BUILD_CACHE_MAX = 24;

function buildModelUncached(input: Params, view: ViewState): Part[] {
  const ctx = makeCtx(input, view); // resolves auto nose geometry (resolveParams) so every part and ctx.p agree
  const parts = [
    ...buildRunningGear(ctx),
    ...buildPivot(ctx),
    ...buildBridle(ctx),
    ...buildFrame(ctx),
    ...buildBody(ctx),
    ...buildSeat(ctx),
    ...buildStorage(ctx),
    ...buildSideRibs(ctx), // D-76: the side ribs, their knees and box ties, and the D-rings on their heads
    ...buildBrake(ctx),
    ...buildLighting(ctx),
    ...buildHardware(ctx),
    ...buildPayload(ctx),
  ];
  applyJoinery(ctx, parts); // structured joints for the hull and frame (D-35)
  addSideRibJoints(ctx, parts); // D-76: the web's and the joists' own ends of the rib glue and knee screws
  addGripBandJoints(ctx.L, parts); // the gunwale bands' own ends of the grab-board screws and their backing-strip holes
  addTransomEyeJoints(parts); // the transom's own end of the return-cord eye and snap-hook joints (the ring stands off its face)
  addFlatPinDeckHoles(ctx.p, ctx.L, parts); // the flat-position seat-pin clearance holes through the deck
  applySteerPose(ctx, parts); // the front axle turned about the kingpin (D-56); after the joinery so every joint location stays in the part's own frame
  if (ctx.view.seat === 'stowed') applySeatStow(ctx.p, ctx.L, parts); // cargo mode (D-53): the seat kit lies flat in the storage box
  const v = ctx.view;
  const out = parts.filter((x) => !(v.removed && x.removable) && !(!v.brakes && isBrakeKit(x, ctx.p)) && !(!v.lights && isLightKit(x)) && !(!v.chocks && isChockKit(x)));
  applyHardwareMass(out); // the fastener remainder, from the joints of the parts actually present
  applyFinish(out, ctx.p); // display finishing for the viewer (D-44): cosmetic, never read by the analysis
  for (const x of out) if (x.explode) x.explode = unitDir(x.explode)!; // the exploded view moves a part along a UNIT direction; builders pass rough directions
  return out;
}

/** Turn the front axle body (and the front wheels) about the vertical kingpin axis at (x = wheelbase, y = 0) by the displayed steering angle. */
function applySteerPose(ctx: ReturnType<typeof makeCtx>, parts: Part[]): void {
  if (Math.abs(ctx.steerRad) < 1e-12) return;
  const kx = ctx.L.king.x;
  const pose = multiply(translation(kx, 0, 0), multiply(rotationZ(ctx.steerRad), translation(-kx, 0, 0)));
  for (const x of parts) if (x.body === 'front-axle' || x.body === 'wheel-FL' || x.body === 'wheel-FR') x.transform = multiply(pose, x.transform);
}
