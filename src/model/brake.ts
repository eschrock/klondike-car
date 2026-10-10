/** Brake (D-13) and rear push handle (D-9). */
import { BRAKE_TYPE } from '../params';
import { STEP, box, cylinder, span, SIDES, type Ctx } from './build-utils';
import type { Part } from './types';

// ── Block-model placeholders (spec) ──
/** Tire-tread brake shoe (radial, y, tangential) and its angle ahead of / above the axle. */
const SHOE_SIZE = [1.5, 3, 2] as const;
const SHOE_ANGLE_DEG = 45;
/** Cross shaft: ½" steel rod, this far behind the tire. */
const SHAFT_DIAMETER_IN = 0.5;
const SHAFT_BEHIND_TIRE_IN = 1.5;
/** Lever section (x, y) and how far below the handle height its top ends. */
const LEVER_X_IN = 1;
const LEVER_Y_IN = 1.5;
const LEVER_BELOW_HANDLE_IN = 4;
/** Push-handle uprights (x, y), crossbar section, inset of the uprights from the body edge. */
const UPRIGHT_X_IN = 1;
const UPRIGHT_Y_IN = 1.5;
const CROSSBAR_IN = 1.25;
const UPRIGHT_INSET_IN = 2;
/** Wood drum alternative (D-13): width and diameter as a fraction of the wheel. */
const DRUM_WIDTH_IN = 1;
const DRUM_DIA_FRAC = 0.5;

export function buildBrake(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const r = L.r;
  const ry = p.rearTrackIn / 2;

  if (p.brakeType === BRAKE_TYPE.tireTread) {
    const a = (SHOE_ANGLE_DEG * Math.PI) / 180;
    const rad = r + SHOE_SIZE[0] / 2;
    for (const { s, tag } of SIDES) {
      parts.push(box(ctx, {
        id: `brake-shoe-${tag}`, partNo: 'brake-shoe', name: `Brake shoe ${tag}`, group: 'brake', mat: 'oak', step: STEP.brake,
        size: [...SHOE_SIZE], center: [rad * Math.cos(a), s * ry, r + rad * Math.sin(a)], rot: { y: -a },
        notes: 'Touches the front-upper tread at 45° (D-13). The shoe arm to the cross shaft is Phase 3.',
      }));
    }
  } else {
    for (const { s, tag } of SIDES) {
      const dia = p.wheelDiameterIn * DRUM_DIA_FRAC;
      parts.push(cylinder(ctx, {
        id: `brake-drum-${tag}`, partNo: 'brake-drum', name: `Brake drum ${tag}`, group: 'brake', mat: 'oak', step: STEP.brake,
        center: [0, s * (ry + p.tireWidthIn / 2 + DRUM_WIDTH_IN / 2), r], axis: 'y', radius: dia / 2, length: DRUM_WIDTH_IN,
        notes: 'Wooden drum on the live axle (D-13); band geometry is Phase 3.',
      }));
    }
  }

  const sx = -(r + SHAFT_BEHIND_TIRE_IN);
  parts.push(cylinder(ctx, {
    id: 'brake-shaft', name: 'Brake cross shaft', group: 'brake', mat: 'steel', step: STEP.brake,
    center: [sx, 0, r], axis: 'y', radius: SHAFT_DIAMETER_IN / 2, length: p.rearTrackIn, notes: 'Pivots in the frame rails.',
  }));

  // Lever stands in the gap between the body side and the left tire.
  const tireInner = ry - p.tireWidthIn / 2;
  const leverY = (p.bodyWidthIn / 2 + tireInner) / 2;
  const leverTop = p.rearHandleHeightIn - LEVER_BELOW_HANDLE_IN;
  const leverBot = r + SHAFT_DIAMETER_IN / 2;
  parts.push(box(ctx, {
    id: 'brake-lever', name: 'Brake lever', group: 'brake', mat: 'oak', step: STEP.brake, grain: 'z',
    ...span([sx - LEVER_X_IN / 2, sx + LEVER_X_IN / 2], [leverY - LEVER_Y_IN / 2, leverY + LEVER_Y_IN / 2], [leverBot, Math.max(leverBot + 1, leverTop)]),
    notes: `Lever ratio ${p.brakeLeverRatio}:1 is set in the analysis, not drawn here (D-13).`,
  }));

  // Rear push handle (removable): two uprights behind the transom and a crossbar.
  const ux = L.xRear - UPRIGHT_X_IN / 2;
  const jD = p.crossmemberDepthIn;
  const barZ = p.rearHandleHeightIn;
  for (const { s, tag } of SIDES) {
    parts.push(box(ctx, {
      id: `handle-post-${tag}`, partNo: 'handle-post', name: `Push handle upright ${tag}`, group: 'removable', mat: 'oak', removable: true, step: STEP.brake, grain: 'z',
      ...span([ux - UPRIGHT_X_IN / 2, ux + UPRIGHT_X_IN / 2], [s * (L.hwC - UPRIGHT_INSET_IN) - UPRIGHT_Y_IN / 2, s * (L.hwC - UPRIGHT_INSET_IN) + UPRIGHT_Y_IN / 2],
        [L.deckTop - jD, barZ - CROSSBAR_IN / 2]),
    }));
  }
  parts.push(box(ctx, {
    id: 'handle-bar', name: 'Push handle crossbar', group: 'removable', mat: 'oak', removable: true, step: STEP.brake, grain: 'y',
    ...span([ux - CROSSBAR_IN / 2, ux + CROSSBAR_IN / 2], [-(L.hwC + L.side), L.hwC + L.side], [barZ - CROSSBAR_IN / 2, barZ + CROSSBAR_IN / 2]),
    notes: 'Square block stands in for a 1.25" round.',
  }));
  return parts;
}
