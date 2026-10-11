/**
 * Plan of the rear brake beam (Phase 3c-1, D-53): ONE pure source for where the beam, its shoes and its rail notches sit, shared by `params.ts` (the validator),
 * `model/brake.ts`, `model/frame.ts` (the notches) and the analysis. Plain TS, no three.js. Model frame: +X forward, +Z up, origin under the rear-axle center; inches.
 *
 * The brake is a classic wagon brake: a square aluminum tube (the beam) across the tail BEHIND the rear tires, a lined steel-backed shoe at each end facing the
 * rear of the tread, pushed forward into the tires by the hand lever (through a short link) and pulled back by a spring. The beam passes through a notch in each
 * cabin rail (open at the bottom), which guides it; a keeper strap screwed across the bottom of each notch carries its weight. The shoe sits a few degrees below
 * the axle line (wherever the beam falls), so the normal force is nearly horizontal and the friction nearly vertical: no servo, the ratio is the same either way
 * the cart rolls (to within a few percent).
 */
import type { Params } from '../params';

export interface BeamLayout {
  /** Beam center z and the shoe back's angle below the axle line (rad), measured at the shoe center. */
  zB: number;
  beta: number;
  /** Radius of the shoe back at its center (r + lining + back plate). */
  rBack: number;
  /** Beam stroke along x (shoe travel / cos beta). */
  stroke: number;
  /** x of the beam center, front face and rear face, RELEASED (the notch's rear wall rests against the rear face + a clearance). */
  xB: number;
  xFront: number;
  xRear: number;
  /** Rail notch: x range (rear wall to front wall, front wall at the APPLIED front face + a clearance) and the z of its roof. */
  notch: { x0: number; x1: number; top: number };
  /** Air between the beam's rear face and the rear transom's inner face (in; the notch is open-ended when its rear wall would fall behind the rail end), and the keeper strap's bottom z. */
  railEndWall: number;
  keeperBottom: number;
}

/** Running clearance between the beam and the notch walls and roof (in): a tolerance, not a design number. */
export const BEAM_NOTCH_CLEAR_IN = 0.125;

/** Half height of the clevis foot on the beam's rear face (in): the link zone stands this far (or half the link bar width, if more) above the beam center. */
export const CLEVIS_HALF_IN = 0.6;

/** Top of the link zone (clevis foot and link bars) at the beam center height `zB` (in); the rear transom's bottom edge must stay above it. */
export const linkTopZ = (p: Pick<Params, 'brakeBarWidthIn'>, zB: number): number => zB + Math.max(p.brakeBarWidthIn / 2, CLEVIS_HALF_IN);

export function beamLayout(p: Params, r: number, railZBot: number, xRailEnd: number): BeamLayout {
  const size = p.brakeBeamSizeIn;
  const rBack = r + p.brakeLiningThickIn + p.brakeShoeBackThickIn;
  const zB = railZBot + size / 2; // the beam rests on the keeper strap, whose top is the rail bottom plane
  const beta = Math.asin(Math.max(-1, Math.min(1, (r - zB) / rBack)));
  const stroke = p.brakeShoeTravelIn / Math.cos(beta);
  const xFront = -rBack * Math.cos(beta) - stroke;
  const xB = xFront - size / 2;
  const xRear = xB - size / 2;
  const notch = { x0: Math.max(xRear - BEAM_NOTCH_CLEAR_IN, xRailEnd), x1: xFront + stroke + BEAM_NOTCH_CLEAR_IN, top: zB + size / 2 + BEAM_NOTCH_CLEAR_IN };
  return { zB, beta, rBack, stroke, xB, xFront, xRear, notch, railEndWall: xRear - xRailEnd, keeperBottom: railZBot - p.brakeKeeperThickIn };
}
