/** Brake (D-13) and rear push handle (D-9). */
import { BRAKE_TYPE } from '../params';
import { STEP, box, cylinder, span, SIDES, type Ctx } from './build-utils';
import type { Part } from './types';

// ── Block-model placeholders (spec) ──
/** Cross shaft: ½" steel rod, this far behind the tire. */
const SHAFT_DIAMETER_IN = 0.5;
const SHAFT_BEHIND_TIRE_IN = 1.5;
/** Lever clearance outboard of the hull; how far below the handle height the lever top ends. */
const LEVER_HULL_GAP_IN = 0.5;
const LEVER_BELOW_HANDLE_IN = 4;
/** Push-handle uprights (x, y section). */
const UPRIGHT_X_IN = 1;
const UPRIGHT_Y_IN = 1.5;

export function buildBrake(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const r = L.r;
  const ry = p.rearTrackIn / 2;

  if (p.brakeType === BRAKE_TYPE.tireTread) {
    const a = (p.brakeShoeAngleDeg * Math.PI) / 180;
    const shoe = [p.brakeShoeThickIn, p.brakeShoeWidthIn, p.brakeShoeLengthIn] as const;
    const rad = r + shoe[0] / 2;
    for (const { s, tag } of SIDES) {
      parts.push(box(ctx, {
        id: `brake-shoe-${tag}`, partNo: 'brake-shoe', name: `Brake shoe ${tag}`, group: 'brake', mat: 'oak', step: STEP.brake,
        size: [...shoe], center: [rad * Math.cos(a), s * ry, r + rad * Math.sin(a)], rot: { y: -a },
        notes: 'Touches the front-upper tread at the shoe angle (D-13). The shoe arm to the cross shaft is Phase 3.',
      }));
    }
  } else {
    for (const { s, tag } of SIDES) {
      const dia = p.wheelDiameterIn * p.brakeDrumDiameterFrac;
      parts.push(cylinder(ctx, {
        id: `brake-drum-${tag}`, partNo: 'brake-drum', name: `Brake drum ${tag}`, group: 'brake', mat: 'oak', step: STEP.brake,
        center: [0, s * (ry + p.tireWidthIn / 2 + p.brakeDrumWidthIn / 2), r], axis: 'y', radius: dia / 2, length: p.brakeDrumWidthIn,
        notes: 'Wooden drum on the live axle (D-13); band geometry is Phase 3.',
      }));
    }
  }

  const sx = -(r + SHAFT_BEHIND_TIRE_IN);
  parts.push(cylinder(ctx, {
    id: 'brake-shaft', name: 'Brake cross shaft', group: 'brake', mat: 'steel', step: STEP.brake,
    center: [sx, 0, r], axis: 'y', radius: SHAFT_DIAMETER_IN / 2, length: p.rearTrackIn, notes: 'Pivots in the frame rails.',
  }));

  // Lever stands just outboard of the (possibly flared) hull; the shaft is behind the tire (x = -(r + 1.5)), so the tire
  // does not limit how far out it can stand.
  const leverY = L.hwC + L.side + L.flare + LEVER_HULL_GAP_IN + p.brakeLeverWidthIn / 2;
  const leverTop = p.rearHandleHeightIn - LEVER_BELOW_HANDLE_IN;
  const leverBot = r + SHAFT_DIAMETER_IN / 2;
  parts.push(box(ctx, {
    id: 'brake-lever', name: 'Brake lever', group: 'brake', mat: 'oak', step: STEP.brake, grain: 'z',
    ...span([sx - p.brakeLeverThickIn / 2, sx + p.brakeLeverThickIn / 2], [leverY - p.brakeLeverWidthIn / 2, leverY + p.brakeLeverWidthIn / 2], [leverBot, Math.max(leverBot + 1, leverTop)]),
    notes: `Lever ratio ${p.brakeLeverRatio}:1 is set in the analysis, not drawn here (D-13).`,
  }));

  // Rear push handle (removable): two uprights behind the transom and a crossbar.
  const ux = L.xRear - UPRIGHT_X_IN / 2;
  const jD = p.crossmemberDepthIn;
  const barZ = p.rearHandleHeightIn;
  for (const { s, tag } of SIDES) {
    parts.push(box(ctx, {
      id: `handle-post-${tag}`, partNo: 'handle-post', name: `Push handle upright ${tag}`, group: 'removable', mat: 'oak', removable: true, step: STEP.brake, grain: 'z',
      ...span([ux - UPRIGHT_X_IN / 2, ux + UPRIGHT_X_IN / 2], [s * (L.hwC - p.handleUprightInsetIn) - UPRIGHT_Y_IN / 2, s * (L.hwC - p.handleUprightInsetIn) + UPRIGHT_Y_IN / 2],
        [L.deckTop - jD, barZ - p.handleBarDiameterIn / 2]),
    }));
  }
  parts.push(box(ctx, {
    id: 'handle-bar', name: 'Push handle crossbar', group: 'removable', mat: 'oak', removable: true, step: STEP.brake, grain: 'y',
    ...span([ux - p.handleBarDiameterIn / 2, ux + p.handleBarDiameterIn / 2], [-(L.hwC + L.side), L.hwC + L.side], [barZ - p.handleBarDiameterIn / 2, barZ + p.handleBarDiameterIn / 2]),
    notes: 'Square block stands in for a 1.25" round.',
  }));
  return parts;
}
