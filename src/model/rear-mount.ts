/**
 * Rear axle beam seat in the cabin rails (build review r2 MUST-4, D-48) and the shared fastener helpers. ONE source of geometry for the rear axle beam's seat in
 * the rails and its hold-down angles, read by the model (frame.ts, running-gear.ts), the analysis and the tests. (The brake bearing plates of D-48 went with the
 * cross-shaft brake at Phase 3c-1; the brake beam's notch is in brake-layout.ts.)
 *
 * Plain TS, no three.js. Model frame: +X forward, +Y left, +Z up, inches. Positions are for the LEFT rail; the right is the mirror.
 *
 * The rail at the rear end is a 0.75" x 4" oak bar (z from the rail bottom to the chine) whose inner face carries the deck ledge from `deckBot`
 * up; only the part below the ledge is full thickness. The beam is seated in a notch where the rail meets the rear axle beam.
 */
import { AXLE_BEAM_POSITION, FRAME_STYLE, type Params } from '../params';
import type { Layout } from './layout';
import type { Mat4, Vec3 } from './types';

export type V2 = [number, number];

/** Hex-head height as a multiple of the bolt diameter (3/8" hex bolt: 0.25"). */
export const HEAD_HEIGHT_D = 0.65;

/** Local-frame location of a model point on a part (rigid transform: inverse rotation of the point relative to the part origin). */
export function localPoint(m: Mat4, pt: Vec3): Vec3 {
  const d = [pt[0] - m[12], pt[1] - m[13], pt[2] - m[14]];
  const col = (c: number): Vec3 => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return [0, 1, 2].map((c) => dot(d, col(c)) / dot(col(c), col(c))) as Vec3;
}

/** The rail (ladder) or side girder (hull-beam frame) at the rear end. */
export interface RailSection {
  ladder: boolean;
  /** Thickness across (y), the |y| of its inner and outer faces. */
  t: number;
  yIn: number;
  yOut: number;
  /** Bottom, top of the full-thickness part (below the deck ledge), x of the rear end (the rear transom's inner face). */
  zBot: number;
  zSolidTop: number;
  zTop: number;
  xEnd: number;
}

export function railSection(p: Params, L: Layout): RailSection {
  const ladder = p.frameStyle === FRAME_STYLE.ladder;
  const t = ladder ? p.railThicknessIn : L.side;
  const yOut = L.hwC + L.side;
  return { ladder, t, yIn: yOut - t, yOut, zBot: L.deckBot - p.railDepthIn, zSolidTop: L.deckBot, zTop: L.railTop, xEnd: L.xRear + L.transom };
}

/** The rear axle beam's seat in the cabin rails and its hold-down brackets (MUST-4). Null when the beam does not reach into the rail (overslung beams are above the deck). */
export interface BeamSeat {
  /** Notch x range (beam width + clearance each side), bottom (rail bottom) and ceiling (beam top), in the rail. */
  x0: number;
  x1: number;
  zBot: number;
  zTop: number;
  depth: number;
  /** Oak left above the notch (rail height − depth). */
  remain: number;
  railT: number;
  /** Notch volume per rail (in³). */
  volume: number;
  /** Hold-down angle (inside the rail, left; mirror right): x range, the inner-face y, y of the free end of the leg on the beam, z range of the upright leg. */
  hd: { x0: number; x1: number; yRail: number; yFree: number; zBeam: number; zTop: number; t: number; leg: number; boltD: number; /** (x, z) of the bolts through the upright leg and the rail. */ railBolts: V2[]; /** (x, |y|) of the bolts down through the horizontal leg and the beam, either side of the axle rod. */ beamBolts: V2[] };
}

export function beamSeat(p: Params, L: Layout): BeamSeat | null {
  if (p.axleBeamPosition !== AXLE_BEAM_POSITION.underslung) return null;
  const rail = railSection(p, L);
  const b = L.beamR;
  const depth = b.top - rail.zBot;
  if (depth <= 0.05) return null;
  const w = b.thick + 2 * p.beamNotchClearIn;
  const x0 = b.x - w / 2, x1 = b.x + w / 2;
  const t = p.beamHoldDownThickIn, leg = Math.min(p.beamHoldDownLegIn, Math.max(0.75, rail.zSolidTop - b.top - 0.15));
  const bd = p.beamHoldDownBoltDiameterIn;
  const hdw = Math.min(b.thick - 0.25, 2.6);
  const hx0 = b.x - hdw / 2, hx1 = b.x + hdw / 2;
  const zRail = b.top + Math.min(leg - 0.4, 1.1);
  const px = hdw / 4;
  return {
    x0, x1, zBot: rail.zBot, zTop: b.top, depth, remain: rail.zTop - b.top, railT: rail.t, volume: w * depth * rail.t,
    hd: {
      x0: hx0, x1: hx1, yRail: rail.yIn, yFree: rail.yIn - leg, zBeam: b.top, zTop: b.top + leg, t, leg, boltD: bd,
      railBolts: [[b.x - px, zRail], [b.x + px, zRail]],
      beamBolts: [-1, 1].map((k): V2 => [b.x + k * (p.axleDiameterIn / 2 + 0.1 + bd / 2 + 0.1), rail.yIn - leg / 2 - t / 2]),
    },
  };
}

/** Height of a nylon-insert lock nut for a bolt of diameter `d` (in). */
export const nutHeight = (d: number): number => (d <= 0.25 ? 0.32 : d <= 0.3125 ? 0.38 : d <= 0.375 ? 0.5 : d <= 0.4375 ? 0.56 : 0.64);
/** Fender washer thickness (about d/6, min 1/16"). */
export const washerThick = (d: number): number => Math.max(0.0625, d / 6);

/**
 * Bolt length (in, next 1/4") for a stack of total `grip` clamped between a head (or a plate) and a nylock nut: grip + the washer(s) + the nut +
 * two threads showing (0.1"), rounded UP to the next 1/4" (bolts are sold in 1/4" steps above 1"). Build review r2 S2.
 */
export function boltLength(grip: number, d: number, washers = 1): number {
  const need = grip + washers * washerThick(d) + nutHeight(d) + 0.1;
  return Math.ceil(need * 4 - 1e-9) / 4;
}

/** 1/4"-step fractional-inch text, e.g. 1.75 -> "1-3/4", 2.25 -> "2-1/4", 3 -> "3". */
export function inchesText(x: number): string {
  const whole = Math.floor(x + 1e-9);
  const q = Math.round((x - whole) * 8); // eighths
  const fr = q === 0 ? '' : q === 8 ? '' : q % 4 === 0 ? `${q / 4}/2` : q % 2 === 0 ? `${q / 2}/4` : `${q}/8`;
  return fr ? `${whole > 0 ? `${whole}-` : ''}${fr}` : `${q === 8 ? whole + 1 : whole}`;
}
