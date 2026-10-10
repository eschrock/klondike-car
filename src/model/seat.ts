/**
 * Seat: cushion straight on the deck (or box top / optional riser), a reclined oak-frame back with a ply panel and
 * foam pad, and a foot stop (D-3, D-18). The old solid base ring and solid back slab were block-model artefacts (critic H2).
 */
import { RIDER_PELVIS_Z_FRAC } from '../params';
import { STEP, box, span, SIDES, type Ctx } from './build-utils';
import type { Part, Vec3 } from './types';

// ── Block-model placeholders (estimates; spec) ──
/** Closed-cell foam density used for the cushion and the back pad (estimate, D-18). */
const FOAM_DENSITY_PCF = 4.5;
export const BACK_PAD_THICK_IN = 1;
/** Gap between the pelvis top and the start of the back pad. */
const PAD_GAP_IN = 0.25;
/** Riser runner width (across). */
const RISER_RUNNER_IN = 1.5;

export function buildSeat(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const s = L.seat;
  const parts: Part[] = [];
  const hw = s.width / 2;
  const foam = (volIn3: number) => (volIn3 / 1728) * FOAM_DENSITY_PCF;

  // Optional riser: two oak runners under the cushion (default 0 = cushion on the deck).
  const riser = s.cushionBottom - s.pan;
  if (riser > 0.01) {
    for (const { s: sg, tag } of SIDES) {
      const y = sg * (hw - RISER_RUNNER_IN / 2);
      parts.push(box(ctx, {
        id: `seat-riser-${tag}`, partNo: 'seat-riser', name: `Seat riser runner ${tag}`, group: 'seat', mat: 'oak', step: STEP.seatStorage, grain: 'x',
        ...span([s.xRear, s.xFront], [y - RISER_RUNNER_IN / 2, y + RISER_RUNNER_IN / 2], [s.pan, s.cushionBottom]),
      }));
    }
  }
  const cushionVol = (s.xFront - s.xRear) * s.width * p.seatCushionIn;
  parts.push(box(ctx, {
    id: 'seat-cushion', name: 'Seat cushion', group: 'seat', mat: 'fixed', massLb: foam(cushionVol), kind: 'purchased', material: 'closed-cell foam',
    fab: 'buy', step: STEP.seatStorage, ...span([s.xRear, s.xFront], [-hw, hw], [s.cushionBottom, s.surface]),
    notes: 'Sits directly on the deck (or the storage lid / riser). Mass is an estimate (D-18).',
  }));

  // Seat back: front face passes through P and leans back by seatBackAngleDeg. Oak frame (2 stiles + 2 rails)
  // with a captured ply panel; all parts share the lean.
  const a = (p.seatBackAngleDeg * Math.PI) / 180;
  const H = p.seatBackHeightIn;
  const t = p.seatBackThickIn;
  const fw = p.seatBackFrameWidthIn;
  const W = Math.max(2 * fw + 0.5, Math.min(p.seatBackWidthIn, 2 * L.hwC - 1));
  const at = (c0: number, c2: number, y = 0): Vec3 => [s.P[0] + s.col0[0] * c0 + s.col2[0] * c2, y, s.P[2] + s.col0[2] * c0 + s.col2[2] * c2];
  const backCommon = { group: 'seat', removable: true, step: STEP.seatStorage, rot: { y: -a } } as const;
  for (const { s: sg, tag } of SIDES) {
    parts.push(box(ctx, {
      ...backCommon, id: `seat-back-stile-${tag}`, partNo: 'seat-back-stile', name: `Seat back stile ${tag}`, mat: 'oak', grain: 'z',
      size: [t, fw, H], center: at(-t / 2, H / 2, sg * (W / 2 - fw / 2)), notes: 'Knob-mounted for transport (D-9).',
    }));
  }
  for (const [tag, c2] of [['top', H - fw / 2], ['bottom', fw / 2]] as const) {
    parts.push(box(ctx, {
      ...backCommon, id: `seat-back-rail-${tag}`, partNo: 'seat-back-rail', name: `Seat back ${tag} rail`, mat: 'oak', grain: 'y',
      size: [t, W - 2 * fw, fw], center: at(-t / 2, c2),
    }));
  }
  parts.push(box(ctx, {
    ...backCommon, id: 'seat-back-panel', name: 'Seat back panel', mat: 'ply', edges: 'captured', grain: 'z',
    size: [Math.min(p.panelPlyIn, t), W - 2 * fw, H - 2 * fw], center: at(-t / 2, H / 2),
    notes: 'Ply (or fabric) panel captured in the frame grooves; groove depth is Phase 3.',
  }));
  // The pad starts above the pelvis (and the cushion), so it supports the lumbar region and never overlaps either.
  const pelvisTopAlongBack = (s.surface + RIDER_PELVIS_Z_FRAC * p.riderStatureIn - s.P[2]) / s.col2[2];
  const h0 = Math.min(H - 0.5, Math.max(0.5, p.seatCushionIn / Math.cos(a) + 0.3, pelvisTopAlongBack + PAD_GAP_IN));
  const padH = Math.max(0.5, H - h0);
  parts.push(box(ctx, {
    ...backCommon, id: 'seat-back-pad', name: 'Seat back pad', mat: 'fixed', massLb: foam(BACK_PAD_THICK_IN * W * padH), kind: 'purchased', material: 'closed-cell foam',
    fab: 'buy', size: [BACK_PAD_THICK_IN, W, padH], center: at(BACK_PAD_THICK_IN / 2, h0 + padH / 2),
    notes: 'Mass is an estimate.',
  }));

  // Foot stop: an oak board across the nose at x = seatX + leg reach, standing on its deck.
  const fx = p.seatXIn + p.riderLegReachIn;
  const onNose = fx >= L.xs;
  const deckZ = onNose ? L.noseTop : L.deckTop;
  const fhw = onNose ? L.hwN : L.hwC;
  parts.push(box(ctx, {
    id: 'foot-stop', name: 'Foot stop', group: 'seat', mat: 'oak', step: STEP.seatStorage, grain: 'y',
    ...span([fx - p.footStopThickIn / 2, fx + p.footStopThickIn / 2], [-fhw, fhw], [deckZ, deckZ + p.footStopHeightIn]),
    notes: 'Board between the nose sides; braced by them.',
  }));
  return parts;
}
