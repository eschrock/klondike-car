/** Lighting (D-9) and the hardware allowance. */
import { STEP, box, SIDES, type Ctx } from './build-utils';
import { cabinSidePoint } from './layout';
import type { Part } from './types';

// ── Estimates / placeholders (spec) ──
const LANTERN_MOUNT_MASS_LB = 0.2;
const LANTERN_MOUNT_SIZE = [2, 1.5, 1.5] as const;
const REAR_LIGHT_MASS_LB = 0.3;
const REAR_LIGHT_SIZE = [0.75, 2, 1.5] as const;
const REFLECTOR_MASS_LB = 0.05;
export const REFLECTOR_SIZE = [2, 0.25, 1] as const;
const HARDWARE_MASS_LB = 2.5;
const HARDWARE_SIZE = [2, 2, 1.25] as const;
/** Cabin reflectors at these fore-aft fractions of the cabin length (clear of the signs and the nose). */
export const REFLECTOR_FRACS = [0.1, 0.95] as const;

export function buildLighting(ctx: Ctx, prowTipX: number, prowTipZ: number): Part[] {
  const { L } = ctx;
  const parts: Part[] = [];
  parts.push(box(ctx, {
    id: 'lantern-mount', name: 'Front lantern mount', group: 'lighting', mat: 'fixed', massLb: LANTERN_MOUNT_MASS_LB, kind: 'printed', material: 'PETG',
    fab: 'print', removable: true, step: STEP.finish, size: [...LANTERN_MOUNT_SIZE],
    center: [prowTipX, 0, prowTipZ + LANTERN_MOUNT_SIZE[2] / 2], notes: 'Printed; rides on the prow so it comes off with it.',
  }));
  parts.push(box(ctx, {
    id: 'rear-light', name: 'Rear red light', group: 'lighting', mat: 'fixed', massLb: REAR_LIGHT_MASS_LB, kind: 'purchased', material: 'LED light',
    fab: 'buy', step: STEP.finish, size: [...REAR_LIGHT_SIZE],
    center: [L.xRear - REAR_LIGHT_SIZE[0] / 2, 0, L.deckTop + L.sideH - REAR_LIGHT_SIZE[2] / 2], notes: 'On the rear transom; mass includes the light (estimate).',
  }));
  const cabinLen = L.xs - L.xRear;
  const rp = cabinSidePoint(L, L.deckTop + L.sideH / 2, L.side / 2 + REFLECTOR_SIZE[1] / 2, REFLECTOR_SIZE[2] / 2);
  for (const { s, tag } of SIDES) {
    REFLECTOR_FRACS.forEach((f, i) => {
      parts.push(box(ctx, {
        id: `reflector-${tag}${i + 1}`, partNo: 'reflector', name: `Side reflector ${tag}${i + 1}`, group: 'lighting', mat: 'fixed', massLb: REFLECTOR_MASS_LB,
        kind: 'purchased', material: 'reflector', fab: 'buy', step: STEP.finish, size: [...REFLECTOR_SIZE],
        center: [L.xRear + cabinLen * f, s * rp.y, rp.z], rot: { x: -s * rp.phi },
      }));
    });
  }
  return parts;
}

export function buildHardware(ctx: Ctx): Part[] {
  const { L } = ctx;
  // Under the deck, centerd in the widest gap between cabin crossmembers (and clear of a tall rear axle beam).
  const zBot = L.deckBot - HARDWARE_SIZE[2];
  const blockers: Array<[number, number]> = L.cabinJoistX.map((x) => [x - L.joistT / 2, x + L.joistT / 2]);
  const p = ctx.p;
  if (L.r + p.brakeShaftDiameterIn / 2 > zBot && L.r - p.brakeShaftDiameterIn / 2 < L.deckBot) {
    const sx = -(L.r + p.brakeShaftBehindTireIn);
    blockers.push([sx - p.brakeShaftDiameterIn / 2, sx + p.brakeShaftDiameterIn / 2]);
  }
  if (L.beamR.top > zBot) blockers.push([L.beamR.x - L.beamR.thick / 2, L.beamR.x + L.beamR.thick / 2]);
  blockers.sort((a, b) => a[0] - b[0]);
  let lo = L.xRear + L.side, bestLo = lo, bestHi = lo;
  for (const [b0, b1] of [...blockers, [L.xs, L.xs] as [number, number]]) {
    if (b0 - lo > bestHi - bestLo) { bestLo = lo; bestHi = b0; }
    lo = Math.max(lo, b1);
  }
  const gap = Math.max(0.1, bestHi - bestLo);
  const sx = Math.min(HARDWARE_SIZE[0], gap);
  return [box(ctx, {
    id: 'hardware', name: 'Fasteners, inserts & misc', group: 'hardware', mat: 'fixed', massLb: HARDWARE_MASS_LB, kind: 'purchased', fab: 'buy',
    step: STEP.finish, size: [sx, HARDWARE_SIZE[1], HARDWARE_SIZE[2]], center: [(bestLo + bestHi) / 2, 0, L.deckBot - HARDWARE_SIZE[2] / 2],
    notes: 'Allowance (estimate): bolts, nuts, washers, threaded inserts, glue. Parked under the deck center.',
  })];
}
