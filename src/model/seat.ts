/** Seat: base frame, cushion, reclined back with pad, foot stop (D-3, D-18). */
import { STEP, box, span, woodMassLb, type Ctx } from './build-utils';
import { SEAT_BACK_THICK_IN } from './layout';
import type { Part, Vec3 } from './types';

// ── Block-model placeholders (estimates; spec) ──
const CUSHION_MASS_LB = 1.5;
export const BACK_PAD_THICK_IN = 1;
const BACK_PAD_MASS_LB = 0.4;
/** The base is drawn as a solid block but built as a perimeter frame this many inches wide (spec: "frame"). */
const SEAT_FRAME_STRIP_IN = 2;
/** Foot stop (x thickness, z height). */
export const FOOT_STOP_X_IN = 1.5;
const FOOT_STOP_Z_IN = 4;

export function buildSeat(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const s = L.seat;
  const parts: Part[] = [];
  const hw = s.width / 2;

  // Mass is the perimeter-frame ring, not the solid block drawn for the viewer.
  const bl = s.xFront - s.xRear, bt = s.baseTop - s.baseBottom, k = SEAT_FRAME_STRIP_IN;
  const ringFrac = 1 - (Math.max(0, bl - 2 * k) * Math.max(0, s.width - 2 * k)) / (bl * s.width);
  const ringVol = bl * s.width * bt * ringFrac;
  const ringArea = 2 * bl * s.width * ringFrac + 2 * (bl + s.width) * bt * 2;
  parts.push(box(ctx, {
    id: 'seat-base', name: 'Seat base frame', group: 'seat', mat: 'fixed', massLb: woodMassLb(p, ringVol, ringArea, p.oakDensityPcf),
    kind: 'lumber', material: 'white oak', fab: 'table-saw', step: STEP.seatStorage, grain: 'y',
    stock: { t: bt, w: k, l: bl },
    ...span([s.xRear, s.xFront], [-hw, hw], [s.baseBottom, s.baseTop]),
    notes: `Drawn as a solid block; mass is a ${k}" perimeter frame (spec: oak frame block).`,
  }));
  parts.push(box(ctx, {
    id: 'seat-cushion', name: 'Seat cushion', group: 'seat', mat: 'fixed', massLb: CUSHION_MASS_LB, kind: 'purchased', material: 'closed-cell foam',
    fab: 'buy', step: STEP.seatStorage, ...span([s.xRear, s.xFront], [-hw, hw], [s.baseTop, s.surface]), notes: 'Mass is an estimate (D-18).',
  }));

  // Seat back: front face passes through P and leans back by seatBackAngleDeg.
  const a = (p.seatBackAngleDeg * Math.PI) / 180;
  const H = p.seatBackHeightIn;
  const at = (c0: number, c2: number): Vec3 => [s.P[0] + s.col0[0] * c0 + s.col2[0] * c2, 0, s.P[2] + s.col0[2] * c0 + s.col2[2] * c2];
  const backC = at(-SEAT_BACK_THICK_IN / 2, H / 2);
  parts.push(box(ctx, {
    id: 'seat-back', name: 'Seat back', group: 'seat', mat: 'oak', removable: true, step: STEP.seatStorage, grain: 'z',
    size: [SEAT_BACK_THICK_IN, s.width, H], center: backC, rot: { y: -a },
    notes: 'Knob-mounted for transport (D-9).',
  }));
  // Pad starts above the cushion so it never overlaps it.
  const h0 = Math.min(H - 0.5, Math.max(0.5, p.seatCushionIn / Math.cos(a) + 0.3));
  const padH = Math.max(0.5, H - h0);
  parts.push(box(ctx, {
    id: 'seat-back-pad', name: 'Seat back pad', group: 'seat', mat: 'fixed', massLb: BACK_PAD_MASS_LB, kind: 'purchased', material: 'closed-cell foam',
    fab: 'buy', removable: true, step: STEP.seatStorage,
    size: [BACK_PAD_THICK_IN, s.width, padH], center: at(BACK_PAD_THICK_IN / 2, h0 + padH / 2), rot: { y: -a },
    notes: 'Mass is an estimate.',
  }));

  // Foot stop on the deck at x = seatX + leg reach.
  const fx = p.seatXIn + p.riderLegReachIn;
  const onNose = fx >= L.xs;
  const deckZ = onNose ? L.noseTop : L.deckTop;
  const fhw = onNose ? L.hwN : L.hwC;
  parts.push(box(ctx, {
    id: 'foot-stop', name: 'Foot stop', group: 'seat', mat: 'oak', step: STEP.seatStorage, grain: 'y',
    ...span([fx - FOOT_STOP_X_IN / 2, fx + FOOT_STOP_X_IN / 2], [-fhw, fhw], [deckZ, deckZ + FOOT_STOP_Z_IN]),
  }));
  return parts;
}
