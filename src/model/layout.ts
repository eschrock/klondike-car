/**
 * Shared derived geometry for the block model: every builder reads positions from here so the
 * subsystems agree on where the deck, axle stack, seat and storage box are. Plain numbers only;
 * all design inputs come from Params (src/params.ts). Neutral (steer = 0) model frame.
 */
import {
  AXLE_BEAM_POSITION,
  STORAGE_LOCATION,
  derived,
  hullCurveSpec,
  hullPlanCurve,
  resolveParams,
  type Params,
} from '../params';
import { curveHeading, hazardRangeX, leftTirePolys, offsetY, sidePolyline, type PlanCurve } from './hull-curve';
import { beamLayout } from './brake-layout';
import { computeFrontLayout, type FrontLayout } from './front-layout';
import { riderLegTopZ } from './rider-geom';
import type { Vec2, Vec3 } from './types';

// Design numbers (chine height, seat depth, tongue section, ...) live in params.ts; only derived geometry here.
/** The Ackermann hull's sheer rise starts this far beyond the finger-pinch zone: the guard's end margin (0.5") plus sampling slack. */
const SHEER_AFTER_PINCH_IN = 0.75;
/** Air between the nose stringers and the center linkage corridor (in): the tongue link's box swings to within 0.04" of the corridor edge at the lock, and the steering-link running clearance is 0.25". */
const NOSE_STRINGER_GAP_IN = 0.3;
/** Air between the top of a rear storage box and the bottom of the grab-handle doublers it stands beside (D-53). */
export const GRIP_BOX_CLEAR_IN = 0.25;

export interface Layout {
  r: number;
  WB: number;
  /**
   * Start of the hull curve (the cabin side is straight and full width up to here; cabin-side furniture - grips, lash points, reflectors, signs - is behind it)
   * and its end `xn` (the straight bow run starts there, D-52).
   */
  xc0: number;
  xn: number;
  /** The plan curve of the hull side centerline: one convex taper from the cabin to the bow (D-52). */
  hull: PlanCurve;
  /** The side keeps converging along a STRAIGHT bow run from `xn` to the front transom at heading `bowHeading` (rad, the left side's; <= 0 means converging, the right side mirrors it). */
  bowHeading: number;
  /**
   * Chine bottom and rail top (D-45). Captured-ply sides: the chine, its rail and the side lines are at the NOSE deck level along the whole hull, so
   * the side profile never steps; the cabin deck (1" lower) sits on a ledge in the rail's inner face. Other constructions keep the cabin level.
   */
  chineBot: number;
  railTop: number;
  /** Chine height (= railBand). */
  chineH: number;
  /** Top of the side (gunwale top without the sheer): deckTop + sideH. The side lines are the same along the whole hull (D-45). */
  sideTop: number;
  xRear: number;
  xFront: number;
  /** Kingpin axis x: ahead of the front axle by kingpinLeadIn (D-25). */
  kx: number;
  /** Chine / gunwale section height and joist thickness (params). */
  railBand: number;
  joistT: number;
  /** Effective gunwale flare (cabin sides only, captured-ply construction only) and the cabin web plane (flare tilt φ). */
  flare: number;
  web: { z0: number; z1: number; phi: number };
  /** Chine / gunwale / side-board thickness (hwC and hwN are measured to its inner face). */
  side: number;
  /** Front and rear transom thickness (D-43): the sides run between the transom faces at xRear + transom and xFront − transom. Not the same as `side`. */
  transom: number;
  /** Oak backer lane between the rear transom and a rear storage box (D-43): corner backers behind the handle sockets and quadrant bracket fill it. */
  rearLane: number;
  ply: number;
  deckTop: number;
  deckBot: number;
  /** Inner half widths (between the side panels). */
  hwC: number;
  hwN: number;
  sideH: number;
  /**
   * Sheer line (D-44): the nose gunwale top climbs `riseIn` above the flat side height between x0 and x1 (the front transom's inner face),
   * on a smooth curve (zero slope at x0). `sideH` stays the LOWEST side height: cabin, seat, handles and the structural checks read it.
   */
  sheer: { x0: number; x1: number; riseIn: number };
  /** Top of the front transom's edges and the nose gunwale at the bow: noseTop + sideH + the full sheer rise. */
  noseGunTop: number;
  /** Rear axle beam. */
  beamR: Beam;
  /** The Ackermann front end (D-53): kingpins, spindles, beam, brackets, links, tongue (front-layout.ts). */
  front: FrontLayout;
  /** Nose rails/joists run to here: the front transom's inner face. */
  noseRailEnd: number;
  cabinJoistX: number[];
  noseJoistX: number[];
  /**
   * Nose stringers (D-52 integration): the center linkage corridor (`front.keepOut.center`) leaves no room under the nose deck for a joist, so the nose joists are
   * split at |y| = `y0` and two oak stringers (`joistT` thick, `y0`..`y1`, a joist deep) run fore-aft beside the corridor to carry the deck. Each stringer is cut
   * into the `runs` (x ranges) around the front beam's gap (the beam passes between the straddling joists).
   */
  noseStringers: { y0: number; y1: number; runs: Array<[number, number]> };
  seat: SeatLayout;
  storage: StorageLayout;
}

export interface Beam {
  x: number;
  len: number;
  thick: number;
  depth: number;
  top: number;
  bot: number;
}

export interface SeatLayout {
  /** Cushion underside (deck, box top or riser top) and the cushion top (H-point height). */
  cushionBottom: number;
  surface: number;
  /** Top of the deck or storage box under the cushion (riser starts here). */
  pan: number;
  xRear: number;
  xFront: number;
  width: number;
  /** Seat-back frame: P = back's front-bottom point (rear-bottom corner rests on the cushion level); col0 = back normal (forward), col2 = up the back. */
  P: Vec3;
  col0: Vec3;
  col2: Vec3;
  /** Rear-bottom corner of the back panel. */
  Pr: Vec3;
}

export interface StorageLayout {
  location: number;
  x0: number;
  x1: number;
  zBot: number;
  zTop: number;
  hw: number;
}

const len = (a: number, b: number) => Math.max(0.01, b - a);

function evenInterior(a: number, b: number, spacing: number, joistT: number): number[] {
  const L = b - a;
  if (L <= joistT * 2) return [];
  const n = Math.max(0, Math.ceil(L / spacing) - 1);
  return Array.from({ length: n }, (_, i) => a + (L * (i + 1)) / (n + 1));
}

export function computeLayout(input: Params): Layout {
  const p = resolveParams(input); // auto nose width / shoulder (A-4, D-26)
  const d = derived(p);
  const r = d.wheelRadiusIn;
  const WB = p.wheelbaseIn;
  const kx = WB + p.kingpinLeadIn;
  const hullCurve = hullPlanCurve(p); // the bow curve (D-52)
  const xn = hullCurve.x1;
  const xc0 = hullCurve.x0;
  const xRear = -p.rearOverhangIn;
  const xFront = WB + p.frontOverhangIn;
  const side = p.sideThicknessIn;
  const transom = p.transomThicknessIn;
  const rearLane = p.blockingThickIn;
  const ply = p.deckPlyIn;
  const deckTop = p.deckHeightIn;
  const hwC = p.bodyWidthIn / 2 - side;
  const hwN = p.noseWidthIn / 2 - side;
  const rodR = p.axleDiameterIn / 2;
  const joistT = p.crossmemberThickIn;

  const mkBeam = (x: number, track: number, thick: number): Beam => {
    const depth = p.axleBeamDepthIn;
    const top = p.axleBeamPosition === AXLE_BEAM_POSITION.underslung ? r + rodR : r - rodR + depth;
    return { x, len: Math.max(1, track - p.hubLengthIn - 0.25), thick, depth, top, bot: top - depth };
  };
  const beamR = mkBeam(0, p.rearTrackIn, p.axleBeamThicknessIn);
  // Nose rails and joists run to the front transom's inner face (D-52); the steel front beam sits in notches in the rails (front-mount.ts).
  const noseRailEnd = WB + p.frontOverhangIn - p.transomThicknessIn;
  // Joists skip the rear axle beam when it stands taller than their underside (overslung beam).
  const jD = p.crossmemberDepthIn;
  // They also skip the brake beam (D-53) when it runs through their depth.
  const bBeam = beamLayout(p, r, deckTop - ply - p.railDepthIn, xRear + transom);
  const beamThroughJoists = bBeam.zB + p.brakeBeamSizeIn / 2 > deckTop - ply - jD + 0.01 && bBeam.zB - p.brakeBeamSizeIn / 2 < deckTop - ply;
  // A joist that would hit the beam is replaced by one on each side of it (not pushed to one side only), so a thicker
  // deck ply never lengthens the panel span next to the beam (critic Phase 2 r1, D1 oddity).
  // ── Seat ──
  const baseW = Math.max(1, Math.min(p.seatWidthIn, 2 * hwC - 1));
  const pl = p.panelPlyIn;
  const underSeat = p.storageLocation === STORAGE_LOCATION.underSeat;
  const hCap = p.sideHeightIn + p.storageOverSideIn;
  const boxHeight = (lx: number, w: number, cap = hCap) =>
    Math.min(cap, p.storageVolumeIn3 / (Math.max(0.5, lx - 2 * pl) * Math.max(0.5, w - 2 * pl)) + 2 * pl);
  const hUnder = underSeat ? boxHeight(p.seatDepthIn, baseW) : 0;
  const pan = deckTop + hUnder;
  const cushionBottom = pan + p.seatRiserIn;
  const surface = cushionBottom + p.seatCushionIn;
  const seatRear = p.seatXIn - p.seatBehindHpointIn;
  const a = (p.seatBackAngleDeg * Math.PI) / 180;
  const col0: Vec3 = [Math.cos(a), 0, Math.sin(a)];
  const col2: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
  // The back leans, so its rear-bottom corner is the lowest point: lift P so that corner rests on the cushion level.
  const P: Vec3 = [seatRear, 0, cushionBottom + p.seatBackThickIn * col0[2]];
  const Pr: Vec3 = [P[0] - col0[0] * p.seatBackThickIn, 0, P[2] - col0[2] * p.seatBackThickIn];
  const seat: SeatLayout = {
    cushionBottom, pan, surface, xRear: seatRear, xFront: seatRear + p.seatDepthIn, width: baseW, P, col0, col2, Pr,
  };

  // ── Storage ──
  let storage: StorageLayout;
  if (p.storageLocation === STORAGE_LOCATION.underSeat) {
    storage = { location: p.storageLocation, x0: seat.xRear, x1: seat.xFront, zBot: deckTop, zTop: deckTop + hUnder, hw: baseW / 2 };
  } else if (p.storageLocation === STORAGE_LOCATION.forwardRaised) {
    const x0 = xn;
    const x1 = Math.max(x0 + 1, xFront - side - 1.5);
    const w = Math.max(1, 2 * (hwN - p.storageSideClearIn)); // clearance to the chine (r3 build S3, D-47)
    // Over the nose the box must clear the tires and also the rider's knees (the legs pass under it to the foot stop).
    const zBot = Math.max(2 * r + p.storageRaisedClearIn, riderLegTopZ(p, surface, deckTop) + p.storageRaisedClearIn);
    storage = { location: p.storageLocation, x0, x1, zBot, zTop: zBot + boxHeight(x1 - x0, w), hw: w / 2 };
  } else {
    // Behind the seat back: its rear face leans back as it rises, so the box end follows it.
    const x0 = xRear + transom + rearLane;
    const hwB = hwC - p.storageSideClearIn; // the box stands this far off the chine inner face (r3 build S3, D-47)
    const backX = (zTop: number) => Pr[0] - Math.max(0, zTop - Pr[2]) * (-col2[0] / col2[2]);
    const solveH = (cap: number) => {
      let h = Math.min(cap, p.storageVolumeIn3 / (Math.max(0.5, seatRear - x0) * Math.max(0.5, 2 * hwB)));
      for (let i = 0; i < 6; i++) h = boxHeight(Math.max(1, backX(deckTop + h) - x0), 2 * hwB, cap);
      return h;
    };
    let capEff = hCap;
    let h = solveH(capEff);
    // D-53: the seat moved forward so the seat kit lies flat in the box, and the box now reaches the grab handles' doublers (inboard of the gunwale, band tall). Where it does,
    // its lid stays under the bottom of the doubler band (GRIP_BOX_CLEAR_IN of air) instead of colliding with it.
    const gripLen = p.seatGripClearLengthIn + 2;
    const gripX0 = Math.min(p.seatXIn - 5, xc0 - side - gripLen - 0.25);
    if (backX(deckTop + h) > gripX0 - 0.05) {
      capEff = Math.min(hCap, p.sideHeightIn - p.railBandIn - GRIP_BOX_CLEAR_IN);
      h = solveH(capEff);
    }
    const x1 = Math.max(x0 + 1, backX(deckTop + h));
    storage = { location: p.storageLocation, x0, x1, zBot: deckTop, zTop: deckTop + boxHeight(x1 - x0, 2 * hwB, capEff), hw: hwB };
  }

  // D-45: the sides are vertical (the S-curve web is laminated around a plan-view form), so there is no flare; the chine bottom, the web
  // and the gunwale are the same height along the whole hull (captured-ply: at the nose deck level; the cabin rails stand 1" taller to meet the chine).
  const flare = 0;
  const chineH = p.railBandIn;
  const chineBot = deckTop - ply;
  const webZ0 = chineBot + chineH;
  const webZ1 = deckTop + p.sideHeightIn - p.railBandIn;
  const web = { z0: webZ0, z1: webZ1, phi: Math.atan2(flare, Math.max(0.1, webZ1 - webZ0)) };

  // Sheer (D-44): rises over the forward `sheerLengthIn` of the nose, never behind the shoulder; 0 = the old straight gunwale.
  const sheerX1 = xFront - transom;
  let sheerX0 = Math.max(xn, sheerX1 - p.sheerLengthIn);
  if (p.sheerRiseIn > 0) {
    // The finger guard's strap needs a FLAT gunwale: the sheer rise starts beyond the pinch zone (the tire sweep within fingerGapMinIn of the hull side) plus the guard's margin.
    const hz = hazardRangeX(sidePolyline(hullCurve, side / 2, xc0, sheerX1), leftTirePolys(hullCurveSpec(p)), p.fingerGapMinIn);
    if (hz) sheerX0 = Math.min(sheerX1 - 1, Math.max(sheerX0, hz[1] + SHEER_AFTER_PINCH_IN));
  }
  const sheer = { x0: sheerX0, x1: sheerX1, riseIn: Math.max(0, p.sheerRiseIn) };

  const front = computeFrontLayout(p, { r, WB, kx, hull: hullCurve, side, ply, deckTop });

  // ── Joists: skip the rear axle beam and the brake beam; with the Ackermann front end also the steel front beam (its top stands in their depth) ──
  const fb = front.beam;
  const straddle = (x: number, b: Beam): number[] | null => {
    const half = (b.thick + joistT) / 2 + 0.05;
    return Math.abs(x - b.x) < half ? [b.x - half, b.x + half] : null;
  };
  const joistsBetween = (a: number, b: number) => evenInterior(a, b, p.crossmemberSpacingIn, joistT).flatMap((x) => {
    // (Always, for an underslung beam: its hold-down angles stand on the beam top between the straddling joists, D-47.)
    if (beamR.top > deckTop - ply - jD + 0.01 || p.axleBeamPosition === AXLE_BEAM_POSITION.underslung) {
      const sr = straddle(x, beamR);
      if (sr) return sr;
    }
    if (fb.top > deckTop - ply - jD + 0.01) {
      const sf = straddle(x, fb);
      if (sf) return sf;
    }
    if (beamThroughJoists && x > bBeam.notch.x0 - joistT / 2 - 0.05 && x < bBeam.notch.x1 + joistT / 2 + 0.05) return [x < bBeam.xB ? bBeam.notch.x0 - joistT / 2 - 0.05 : bBeam.notch.x1 + joistT / 2 + 0.05];
    return [x];
  });
  const cabinJoistX = joistsBetween(xRear + transom, xn);
  const noseJoistX = joistsBetween(xn, noseRailEnd);
  // Nose stringers: just outboard of the center linkage corridor, from the last cabin joist (or the rear transom) to the front transom, split around the front beam.
  const strY0 = front.keepOut.center.y1 + NOSE_STRINGER_GAP_IN;
  const strX0 = cabinJoistX.length ? cabinJoistX[cabinJoistX.length - 1] + joistT / 2 : xRear + transom;
  const gapLo = front.beam.x - front.beam.thick / 2 - 0.05, gapHi = front.beam.x + front.beam.thick / 2 + 0.05;
  const noseStringers = { y0: strY0, y1: strY0 + joistT, runs: [[strX0, gapLo], [gapHi, noseRailEnd]] as Array<[number, number]> };

  return {
    r, WB, xc0, xn, hull: hullCurve, bowHeading: curveHeading(hullCurve, xFront), chineH, chineBot, railTop: chineBot, sideTop: deckTop + p.sideHeightIn, xRear, xFront, kx, railBand: p.railBandIn, joistT, flare, web, side, transom, rearLane, ply, deckTop, deckBot: deckTop - ply,
    hwC, hwN, sideH: p.sideHeightIn, sheer, noseGunTop: deckTop + p.sideHeightIn + sheer.riseIn, beamR, front,
    noseRailEnd, cabinJoistX, noseJoistX, noseStringers, seat, storage,
  };
}

export { len as spanLen };

/**
 * A point on the outside of a captured-ply cabin side panel: `off` inches out along the panel normal from its
 * centerline at height z (flare tilts the panel, so signs and reflectors lean with it). `halfH` is the half height of
 * the piece being mounted: its lower edge leans inward below the chine top, so the offset grows to keep it off the
 * chine's vertical face. Returns |y|, z and the lean φ.
 */
export function cabinSidePoint(L: Layout, z: number, off: number, halfH = 0): { y: number; z: number; phi: number } {
  const t = Math.max(0, Math.min(1, (z - L.web.z0) / Math.max(0.1, L.web.z1 - L.web.z0)));
  const yc = L.hwC + L.side / 2 + L.flare * t;
  const lean = Math.max(0, L.web.z0 - (z - halfH)) * Math.tan(L.web.phi);
  const o = off + lean;
  return { y: yc + o * Math.cos(L.web.phi), z: z - o * Math.sin(L.web.phi), phi: L.web.phi };
}

/**
 * Sheer rise (in) of the nose gunwale top above its flat height at model x (D-44): 0 behind `sheer.x0`, then a quadratic ease-in (flat
 * start, steepest at the bow, like a boat's sheer) to `sheer.riseIn` at `sheer.x1`; clamped beyond. Monotone non-decreasing in x.
 */
export function sheerRise(L: Pick<Layout, 'sheer'>, x: number): number {
  const { x0, x1, riseIn } = L.sheer;
  if (riseIn <= 0 || x1 <= x0) return 0;
  const u = Math.max(0, Math.min(1, (x - x0) / (x1 - x0)));
  return riseIn * u * u;
}

/** Centerline polyline of one hull side member offset `d` outward from the web plane (negative = inward), covering x in [xa, xb], as |y| (D-45). */
export function sidePath(L: Pick<Layout, 'hull'>, d: number, xa: number, xb: number): Vec2[] {
  return sidePolyline(L.hull, d, xa, xb);
}

/** Inside half width of the hull (the chine's inner face) at x: hwC in the cabin, hwN in the nose, the S-curve between (D-45). */
export function innerHalfWidth(L: Pick<Layout, 'hull' | 'side'>, x: number): number {
  return offsetY(L.hull, -L.side / 2, x);
}
