/**
 * Front beam seat in the nose rails (Phase 3b, D-52; the D-48 pattern of rear-mount.ts for the steel front beam `beam-F`): ONE source of geometry for the notch in
 * each nose rail and the 316 angle hold-down inside it, read by the model (frame.ts), the analysis and the tests. Plain TS, no three.js.
 *
 * The nose rail runs along the straight bow run, converging at `L.bowHeading` to the axis, with its outer face flush under the chine (D-43). The steel tube front
 * beam passes under it (its top stands `remain` below the rail top), so the rail is NOTCHED from below: a slot a beam width plus clearance wide across the rail,
 * whose ceiling bears on the beam top. The angle bracket lies against the rail's inner face with its flat leg on the beam top, bolted through the rail and
 * down through the beam. Positions are for the LEFT rail; the right is the mirror. Only the ladder frame has nose rails.
 */
import { FRAME_STYLE, type Params } from '../params';
import { offsetY } from './hull-curve';
import type { Layout } from './layout';

export interface FrontBeamSeat {
  /** Notch x range (beam fore-aft width plus clearance each side), bottom (rail bottom) and ceiling (beam top). */
  x0: number;
  x1: number;
  zBot: number;
  zTop: number;
  depth: number;
  /** Oak left above the notch (rail top minus beam top); the acceptance floor is `FRONT_RAIL_REMAIN_MIN_IN`. */
  remain: number;
  /** Rail thickness across the rail and the rail height. */
  railT: number;
  railH: number;
  /** Heading of this (left) rail at the crossing, rad (<= 0: converging), and |y| of its inner and outer faces on the line x = beam.x. */
  heading: number;
  yIn: number;
  yOut: number;
  /** Notch volume per rail (in3): the slot width times the notch depth times the rail's width along x at the angle. */
  volume: number;
  /** True when the rail keeps at least `FRONT_RAIL_REMAIN_MIN_IN` above the notch. */
  ok: boolean;
  /** Hold-down angle (left): width along the rail, leg length, thickness, bolt diameter, flat leg z, upright top z; (u along the rail from the crossing, z) of the two rail bolts. */
  hd: { w: number; leg: number; t: number; boltD: number; zBeam: number; zTop: number; railBolts: Array<[number, number]>; beamBolts: Array<[number, number]> };
}

/** The rail must keep this much oak over the notch (acceptance, spec section 10 WS-B). */
export const FRONT_RAIL_REMAIN_MIN_IN = 1;

/** Null unless the hull has a ladder frame with a nose rail that the beam crosses under. */
export function frontBeamSeat(p: Params, L: Layout): FrontBeamSeat | null {
  if (p.frameStyle !== FRAME_STYLE.ladder) return null;
  const b = L.front.beam;
  const railT = p.railThicknessIn;
  const zBot = L.deckBot - p.railDepthIn;
  const zRailTop = L.railTop;
  if (b.x < L.xn + 1 || b.x > L.noseRailEnd - 1) return null; // the beam is not under the nose rail
  const depth = b.top - zBot;
  if (depth <= 0.05) return null;
  const heading = L.bowHeading;
  const dIn = L.side / 2 - railT; // inner face offset from the web plane
  const yIn = offsetY(L.hull, dIn, b.x);
  const yOut = offsetY(L.hull, L.side / 2, b.x);
  const w = b.thick + 2 * p.beamNotchClearIn;
  const t = p.beamHoldDownThickIn;
  const remain = zRailTop - b.top;
  const leg = Math.min(p.beamHoldDownLegIn, Math.max(0.75, zRailTop - b.top - 0.15));
  const bd = p.beamHoldDownBoltDiameterIn;
  const hdw = Math.min(b.thick - 0.25, 2.6);
  const zRail = b.top + Math.min(leg - 0.4, 1.1);
  const px = hdw / 4;
  return {
    x0: b.x - w / 2, x1: b.x + w / 2, zBot, zTop: b.top, depth, remain, railT, railH: zRailTop - zBot, heading, yIn, yOut,
    volume: w * depth * (railT / Math.cos(heading)), ok: remain >= FRONT_RAIL_REMAIN_MIN_IN - 1e-9,
    hd: {
      w: hdw, leg, t, boltD: bd, zBeam: b.top, zTop: b.top + leg,
      railBolts: [[-px, zRail], [px, zRail]],
      // Down through the flat leg and the tube, either side of the center line of the beam's top wall (the rod of the old oak beam is gone).
      beamBolts: [[-px, leg / 2], [px, leg / 2]],
    },
  };
}
