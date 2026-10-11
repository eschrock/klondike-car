/**
 * Rear mounts on the cabin rails (build review r2 MUST-3 and MUST-4, D-48): ONE source of geometry for the brake bearing plates (shaft bearing + lever
 * pivot) and for the rear axle beam's seat in the rails, read by the model (brake.ts, frame.ts, running-gear.ts), the analysis and the tests.
 *
 * Plain TS, no three.js. Model frame: +X forward, +Y left, +Z up, inches. Positions are for the LEFT rail; the right is the mirror.
 *
 * The rail at the rear end is a 0.75" × 4" oak bar (z from the rail bottom to the chine) whose inner face carries the deck ledge from `deckBot`
 * up; only the part below the ledge is full thickness. The brake shaft crosses it at wheel-center height (0.97" above the rail bottom), so the
 * rail is NOTCHED from below for the shaft (open at the bottom, 1/4" wider than the bushing) and the bearing plates are bolted to the OUTSIDE of
 * the rail in the solid wood FORWARD of the notch; the lever pivot is on the left plate's ear that reaches behind the rail end. The beam is seated
 * in a second notch where the rail meets the rear axle beam.
 */
import { AXLE_BEAM_POSITION, FRAME_STYLE, type Params } from '../params';
import type { Layout } from './layout';
import type { Mat4, Vec3 } from './types';

export type V2 = [number, number];

/** Outside diameter of the bronze flanged bearing pressed into each bearing plate: shaft + this. */
export const BEARING_WALL_IN = 0.25;
/** Edge distance (plate edge to a hole edge) kept around every steel-plate hole, as a multiple of the hole diameter (AISC J3.4: 1.5d for cut edges). */
export const PLATE_EDGE_D = 1.5;
/** Bearing length of the flanged bronze bearing in the plate and notch: plate + this inboard (it stands into the shaft notch). */
export const BEARING_STANDOFF_IN = 0.5;
/** Notch width over the shaft: bearing OD + this; top: shaft top + this. */
export const SHAFT_NOTCH_CLEAR_IN = 0.25;
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

export interface BearingMount {
  rail: RailSection;
  /** Shaft centre (x, z), lever pivot (x, z). */
  S: V2;
  Q: V2;
  D: number;
  plateT: number;
  boltD: number;
  /** Bearing-plate bolts (x, z), the same on both sides. Rows are `zRows`, columns `xCols`. */
  bolts: V2[];
  xCols: number[];
  zRows: [number, number];
  /** Shaft notch in the underside of the rail: x range and the z of its top. */
  notch: { x0: number; x1: number; top: number };
  /** Plate outlines (x, z), counter-clockwise: left carries the pivot ear, right the shaft bearing only. */
  outlineL: V2[];
  outlineR: V2[];
  /** Bearing OD, pivot hole, bolt hole diameters in the plate. */
  bearingOd: number;
  pivotHole: number;
  boltHole: number;
  /** Oak doubler glued inside the rail behind the bolt grid (x, z range, thickness; t = 0: none). */
  doubler: { x0: number; x1: number; z0: number; z1: number; t: number; /** All bolts lie in the doubler's length (joists crossing the grid can cut it short). */ covers: boolean };
  /** Bolt-to-boundary distances in the rail (center to the rail end, bottom, deck-ledge top, shaft notch), the smallest over the pattern. */
  dist: { end: number; bottom: number; top: number; notch: number };
}

const rectDist = (pt: V2, x0: number, x1: number, z0: number, z1: number): number => {
  const dx = Math.max(x0 - pt[0], 0, pt[0] - x1), dz = Math.max(z0 - pt[1], 0, pt[1] - z1);
  return Math.hypot(dx, dz);
};

/** Bearing-plate and notch layout. `S` is the shaft centre, `Q` the lever pivot (both from brakeGeometry's inputs). */
export function bearingMount(p: Params, L: Layout, S: V2, Q: V2): BearingMount {
  const rail = railSection(p, L);
  const D = p.brakeShaftDiameterIn;
  const boltD = p.brakeBearingBoltDiameterIn;
  const bearingOd = D + BEARING_WALL_IN;
  const nHalf = (bearingOd + SHAFT_NOTCH_CLEAR_IN) / 2;
  const notch = { x0: S[0] - nHalf, x1: S[0] + nHalf, top: S[1] + D / 2 + SHAFT_NOTCH_CLEAR_IN / 2 };
  // Lower row above the rail bottom, upper row one row-gap higher.
  const zLo = rail.zBot + p.brakeBoltEdgeIn;
  const zHi = zLo + p.brakeBearingBoltRowGapIn;
  // First column: at least `brakeBoltEndIn` from the rail end and 2.5D past the notch's front wall.
  const x1 = Math.max(rail.xEnd + p.brakeBoltEndIn, notch.x1 + 2.5 * boltD);
  const nCol = Math.max(2, Math.round(p.brakeBearingBoltCols));
  const xCols = Array.from({ length: nCol }, (_, i) => x1 + i * p.brakeBearingBoltSpacingIn);
  const bolts: V2[] = [];
  for (const z of [zLo, zHi]) for (const x of xCols) bolts.push([x, z]);
  const boltHole = boltD + 1 / 32;
  const pivotHole = p.brakePivotBoltDiameterIn; // the post is welded on, no hole: this is the weld footprint
  const eB = PLATE_EDGE_D * boltHole + boltHole / 2; // plate edge to a bolt center
  const ePv = pivotHole / 2 + 0.5; // plate edge to the post center: post radius + weld + edge
  const eBr = bearingOd / 2 + PLATE_EDGE_D * 0.3; // plate edge to the bearing center
  const xMaxCol = xCols[xCols.length - 1];
  const xMax = xMaxCol + eB;
  const zTop = zHi + eB;
  const zBotMain = Math.min(zLo - eB, S[1] - eBr);
  const outline = (xMin: number, ear: boolean): V2[] => {
    if (!ear) return [[xMin, zBotMain], [xMax, zBotMain], [xMax, zTop], [xMin, zTop]];
    const zBotEar = Math.min(zBotMain, Q[1] - ePv);
    const xEarEnd = Q[0] + ePv;
    return [[xMin, zBotEar], [xEarEnd, zBotEar], [xEarEnd, zBotMain], [xMax, zBotMain], [xMax, zTop], [xMin, zTop]];
  };
  const outlineL = outline(Math.min(Q[0] - ePv, S[0] - eBr), true);
  const outlineR = outline(S[0] - eBr, false);
  let dEnd = Infinity, dBot = Infinity, dTop = Infinity, dNotch = Infinity;
  for (const b of bolts) {
    dEnd = Math.min(dEnd, b[0] - rail.xEnd);
    dBot = Math.min(dBot, b[1] - rail.zBot);
    dTop = Math.min(dTop, rail.zSolidTop - b[1]);
    dNotch = Math.min(dNotch, rectDist(b, notch.x0, notch.x1, rail.zBot, notch.top));
  }
  const dT = p.brakeDoublerThickIn;
  // The doubler runs 0.9" past the outer bolt columns, clear of the shaft path, and stops short of any deck joist that crosses it (a joist butts the rail, so it
  // cannot also cross the doubler): the widest free interval is kept.
  let iv: Array<[number, number]> = [[Math.max(xCols[0] - 0.9, notch.x1 + 0.1), xMaxCol + 0.9]];
  for (const jx of L.cabinJoistX) {
    const j0 = jx - L.joistT / 2 - 0.05, j1 = jx + L.joistT / 2 + 0.05;
    iv = iv.flatMap(([a, b]) => (j1 <= a || j0 >= b ? [[a, b] as [number, number]] : [[a, Math.min(b, j0)], [Math.max(a, j1), b]].filter(([u, v]) => v - u > 0.1) as Array<[number, number]>));
  }
  const best = iv.reduce((m, c) => (c[1] - c[0] > m[1] - m[0] ? c : m), iv[0] ?? [xCols[0], xCols[0]]);
  const doubler = { x0: best[0], x1: best[1], z0: rail.zBot, z1: rail.zSolidTop, t: dT, covers: bolts.every((b) => b[0] >= best[0] - 1e-9 && b[0] <= best[1] + 1e-9) };
  return { rail, doubler, S, Q, D, plateT: p.brakePlateThickIn, boltD, bolts, xCols, zRows: [zLo, zHi], notch, outlineL, outlineR, bearingOd, pivotHole, boltHole, dist: { end: dEnd, bottom: dBot, top: dTop, notch: dNotch } };
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
