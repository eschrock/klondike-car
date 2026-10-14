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
import type { Params } from '../params';
import type { Beam, Layout } from './layout';
import type { Mat4, ScrewFit, Vec3 } from './types';

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

/**
 * The rear axle hanger (D-54): an oak plate glued and bolted to the INSIDE face of each rail at the axle. The deck is 14.7 in up, so the rail no longer reaches the
 * beam; the hanger drops from the rail top to `axleSeatNotchIn` below the beam top and carries the old D-48 notch. Dimensions here are for the hanger; `railT` is the rail.
 */
export interface RailSection {
  /** Thickness across (y) of the hanger, and the |y| of its inner and outer faces (its outer face is the rail's inner face). */
  t: number;
  yIn: number;
  yOut: number;
  /** Hanger bottom, top of the full-thickness part (= the rail top, the deck underside), the rail top, and x of the rear end (the rear transom's inner face). */
  zBot: number;
  zSolidTop: number;
  zTop: number;
  xEnd: number;
  /** The rail itself: its thickness and inner-face |y|. */
  railT: number;
  railYIn: number;
}

export function railSection(p: Params, L: Layout, beam: Beam = L.beamR): RailSection {
  const railT = p.railThicknessIn;
  const railYIn = L.hwC + L.side - railT;
  const t = p.axleHangerThickIn;
  return { t, yIn: railYIn - t, yOut: railYIn, zBot: beam.top - p.axleSeatNotchIn, zSolidTop: L.deckBot, zTop: L.railTop, xEnd: L.xRear + L.transom, railT, railYIn };
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

export function beamSeat(p: Params, L: Layout, beam: Beam = L.beamR): BeamSeat | null {
  const rail = railSection(p, L, beam);
  const b = beam;
  const depth = b.top - rail.zBot;
  if (depth <= 0.05) return null;
  const w = b.thick + 2 * p.beamNotchClearIn;
  const x0 = b.x - w / 2, x1 = b.x + w / 2;
  const t = p.beamHoldDownThickIn, leg = Math.min(p.beamHoldDownLegIn, Math.max(0.75, rail.zSolidTop - b.top - 0.15));
  const bd = p.beamHoldDownBoltDiameterIn;
  const hdw = Math.min(b.thick - 0.25, 2.6);
  const hx0 = b.x - hdw / 2, hx1 = b.x + hdw / 2;
  const zB = b.top + p.axleProudIn; // the hold-down's flat leg bears on the tube, which stands axleProudIn proud of the beam (D-62)
  const zRail = zB + Math.min(leg - 0.4, 1.1);
  const px = hdw / 4;
  return {
    x0, x1, zBot: rail.zBot, zTop: b.top, depth, remain: rail.zTop - b.top, railT: rail.t, volume: w * depth * rail.t,
    hd: {
      x0: hx0, x1: hx1, yRail: rail.yIn, yFree: rail.yIn - leg, zBeam: zB, zTop: zB + leg, t, leg, boltD: bd,
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

/** Threads showing past a nylon-insert nut: the tip must clear the insert by at least this many threads (the usual 1.5 to 2). */
export const MIN_THREADS_PAST_NUT = 1.5;

/** Stock lengths (in, measured from under the shoulder) of 3/8-16 forged shoulder eye bolts, hot-dip galvanized (Bolt Depot; docs/price-research/price-research-2026-10.md): D-72. */
export const EYE_BOLT_STOCK_IN: readonly number[] = [2.5, 4.5, 6];
/** Stock lengths (in) of 3/8-16 carriage bolts (Bolt Depot 316, 18-8): 1/2 in steps from 4 in up. */
export const CARRIAGE_STOCK_IN: readonly number[] = [4, 4.5, 5, 5.5, 6, 6.5, 7, 8];

/** A shoulder eye bolt or carriage bolt against its real stack (D-72). */
export interface StockBoltFit {
  /** What the stack needs: the stack + the washers + the nut + `MIN_THREADS_PAST_NUT` threads. */
  needIn: number;
  /** The stock length bought (the next one up from `needIn`). */
  stockIn: number;
  /** Thread showing past the nut when the stock length is fitted (in). */
  pastNutIn: number;
  /** Length to cut the stock bolt to (1/8 in up from `needIn`), or null when the stock length is already within `maxPastNutIn` of the need. */
  cutToIn: number | null;
}

/** The stock bolt for a stack of `stackIn` clamped between a head (or shoulder) and a nylon-insert nut, with `washers` washers; 3/8-16 unless `d` says otherwise. */
export function stockBoltFit(stackIn: number, d: number, washers: number, stock: readonly number[], maxPastNutIn = 0.5): StockBoltFit {
  const threadPitch = d >= 0.3125 ? 1 / 16 : 1 / 20; // 3/8-16, else 1/4-20
  const base = stackIn + washers * washerThick(d) + nutHeight(d);
  const needIn = base + MIN_THREADS_PAST_NUT * threadPitch;
  const stockIn = stock.find((l) => l >= needIn - 1e-9) ?? Math.ceil(needIn * 2) / 2;
  const pastNutIn = stockIn - base;
  const cut = Math.ceil(needIn * 8 - 1e-9) / 8;
  return { needIn, stockIn, pastNutIn, cutToIn: pastNutIn > maxPastNutIn + 1e-9 ? cut : null };
}

/**
 * Wood-screw length (in) for a stack of `grip` (the pieces the screw passes through) plus `embed` into the last piece, rounded UP to a stocked length: 1/8" steps to 1", 1/4" steps above it
 * (Phase 4 round 2: the BOM must be able to order the screw).
 */
export function screwLength(grip: number, embed: number): number {
  const need = grip + embed;
  return need <= 1 + 1e-9 ? Math.ceil(need * 8 - 1e-9) / 8 : Math.ceil(need * 4 - 1e-9) / 4;
}

/**
 * The wood screws the whole sled uses (D-72, Eric: "reduce the variety of screws"): three sizes in 316 stainless. #8 x 5/8 is for hardware into thin stock (latches, catches, the stay,
 * hinge leaves into the lid frame), #8 x 1-1/4 for everything else, and #8 x 2-1/2 for the piloted rail-to-chine and rib-knee screws (D-82: no stainless #6 that long exists, so every wood screw is a #8; pilot the long one). A joint picks the
 * SHORTEST standard length that gives its bite without poking through its receiving member.
 */
export const STD_WOOD_SCREWS: ReadonlyArray<{ gauge: 6 | 8 | 10; lenIn: number }> = [
  { gauge: 8, lenIn: 5 / 8 },
  { gauge: 8, lenIn: 1.25 },
  { gauge: 8, lenIn: 2.5 },
];
/** Engagement a wood screw needs in oak (in): half an inch, or two thirds of a thinner receiving member. */
export const SCREW_MIN_BITE_IN = 0.5;
/** Wood left past the tip of a screw (in): it never reaches the far face of the receiving member. */
export const SCREW_TIP_WOOD_IN = 1 / 16;
export const screwMinBite = (receivingIn: number): number => Math.min(SCREW_MIN_BITE_IN, (2 / 3) * receivingIn);
/** Shank diameter (in) by gauge. */
export const SCREW_DIA_IN: Record<6 | 8 | 10, number> = { 6: 0.138, 8: 0.164, 10: 0.19 };

/** Does this fit meet its bite and stay inside its receiving member? */
export function screwFitOk(x: ScrewFit): boolean {
  const bite = x.lenIn - x.gripIn;
  return bite >= x.minBiteIn - 1e-6 && bite <= x.receivingIn - SCREW_TIP_WOOD_IN + 1e-6;
}

/** The shortest standard screw of `gauge` for a stack: `gripIn` crossed, then `receivingIn` of wood to bite (`needBiteIn` replaces the default bite when an analysis row sets it). The fit is returned even if none satisfies it (a test then reports it). */
export function pickWoodScrew(gauge: 6 | 8 | 10, gripIn: number, receivingIn: number, needBiteIn?: number): ScrewFit {
  const minBiteIn = needBiteIn ?? screwMinBite(receivingIn);
  const mk = (lenIn: number): ScrewFit => ({ gauge, lenIn, gripIn, receivingIn, minBiteIn });
  const std = STD_WOOD_SCREWS.filter((s) => s.gauge === gauge);
  const ok = std.map((s) => mk(s.lenIn)).find(screwFitOk);
  return ok ?? mk((std.find((s) => s.lenIn - gripIn >= minBiteIn - 1e-6) ?? std[std.length - 1]).lenIn);
}

/** "#8 × 1-1/4" for joint text; the BOM reads the first "#N × L" in a screw joint's size. */
export const screwText = (x: Pick<ScrewFit, 'gauge' | 'lenIn'>): string => `#${x.gauge} × ${inchesText(x.lenIn)}`;

/** 1/4"-step fractional-inch text, e.g. 1.75 -> "1-3/4", 2.25 -> "2-1/4", 3 -> "3". */
export function inchesText(x: number): string {
  const whole = Math.floor(x + 1e-9);
  const q = Math.round((x - whole) * 8); // eighths
  const fr = q === 0 ? '' : q === 8 ? '' : q % 4 === 0 ? `${q / 4}/2` : q % 2 === 0 ? `${q / 2}/4` : `${q}/8`;
  return fr ? `${whole > 0 ? `${whole}-` : ''}${fr}` : `${q === 8 ? whole + 1 : whole}`;
}
