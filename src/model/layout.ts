/**
 * Shared derived geometry for the block model: every builder reads positions from here so the
 * subsystems agree on where the deck, axle stack, seat and storage box are. Plain numbers only;
 * all design inputs come from Params (src/params.ts). Neutral (steer = 0) model frame.
 */
import {
  AXLE_BEAM_POSITION,
  bolsterPlan,
  SIDE_CONSTRUCTION,
  STORAGE_LOCATION,
  derived,
  hullCurveSpec,
  hullPlanCurve,
  resolveParams,
  type Params,
} from '../params';
import { curveHeading, hazardRangeX, leftTirePolys, offsetY, sidePolyline, type PlanCurve } from './hull-curve';
import { computeFrontLayout, type FrontLayout } from './front-layout';
import { riderLegTopZ } from './rider-geom';
import type { Vec2, Vec3 } from './types';

// Design numbers (chine height, seat depth, tongue section, ...) live in params.ts; only derived geometry here.
/** The Ackermann hull's sheer rise starts this far beyond the finger-pinch zone: the guard's end margin (0.5") plus sampling slack. */
const SHEER_AFTER_PINCH_IN = 0.75;

export interface Layout {
  r: number;
  WB: number;
  /**
   * Deck step x (D-45): the rear face of the shoulder beam; the cabin deck ends here and the nose deck begins (1" up). Just behind `xn`.
   * Cabin-side furniture (grips, lash points, reflectors, signs) is behind `xc0`, the start of the plan S-curve.
   */
  xs: number;
  /** Start of the plan S-curve (the cabin side is straight and full width up to here) and its end (the nose side is straight from here). */
  xc0: number;
  xn: number;
  /** The plan S-curve of the hull side centerline (D-45). */
  hull: PlanCurve;
  /**
   * Ackermann hull (frontEndType 1, D-52): one deck level and no step (`xs` = `xn`, `noseTop` = `deckTop`, `shoulderBeam` = 0 are kept as aliases until Stage 3), and the
   * side keeps converging along a STRAIGHT bow run from `xn` to the front transom at heading `bowHeading` (rad, the left side's; <= 0 means converging, the right side mirrors it).
   */
  ackHull: boolean;
  bowHeading: number;
  /**
   * Chine bottom and rail top (D-45). Captured-ply sides: the chine, its rail and the side lines are at the NOSE deck level along the whole hull, so
   * the side profile never steps; the cabin deck (1" lower) sits on a ledge in the rail's inner face. Other constructions keep the cabin level.
   */
  chineBot: number;
  railTop: number;
  /** Chine height (= railBand). */
  chineH: number;
  /** Shoulder beam thickness (x), under the deck step, between the rail pairs. */
  shoulderBeam: number;
  /** Top of the side (gunwale top without the sheer): deckTop + sideH. The side lines are the same along the whole hull (D-45). */
  sideTop: number;
  xRear: number;
  xFront: number;
  /** Kingpin (steer pivot, turntable center) x: ahead of the front axle by kingpinLeadIn (D-25). */
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
  noseTop: number;
  noseBot: number;
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
  /** Rear axle beam and front axle beam. */
  beamR: Beam;
  beamF: Beam;
  /** Phase 3b Ackermann front end (additive in Stage 0; the old front-end fields above stay until the flip). */
  front: FrontLayout;
  turntable: { z0: number; z1: number };
  /** Bolster ring: x0..x1 fore-aft, ±halfY across, z0..z1 depth, rail width rw. */
  bolster: { x0: number; x1: number; z0: number; z1: number; halfY: number; rw: number };
  /**
   * Side-bearer blocks (steer body, D-12): |y| range [y0, y1] each side; oak z range [z0, z1] (housed `embed` into the beam
   * top), UHMW wear strip [z1, zw]; x range [x0, x1] ahead of the front rod groove. The chassis-side bearer face is the
   * bolster rail underside at turntable.z1, `clr` above the wear strip.
   */
  sideBearer: { y0: number; y1: number; z0: number; z1: number; zw: number; x0: number; x1: number };
  /** Kingpin ends: beam underside (washer) to the turntable top, or to the crossbar top when kingpinThroughBolster = 1. */
  kingpin: { z0: number; z1: number };
  /**
   * Kingpin steel plates (D-35, the crossbar configuration): the carrier plate on the beam top (the turntable stands on it), the plate
   * under the beam, and the plate under the crossbar (on the turntable top plate). Null without the crossbar. z ranges, inches.
   */
  kpPlates: { carrier: { z0: number; z1: number }; under: { z0: number; z1: number }; bar: { z0: number; z1: number } } | null;
  /** Chassis-side oak crossbar over the turntable center (kingpinThroughBolster = 1), fore-aft across the bolster opening: x range, half width |y|, z range (flush with the bolster rails). Null when off. */
  crossbar: { x0: number; x1: number; hw: number; z0: number; z1: number } | null;
  /** Removable access panel in the nose deck over the kingpin nut (D-34): x range, half width |y|, z range (crossbar top to the deck top). Null without the crossbar. Workstream B cuts this opening in the nose deck. */
  accessPanel: { x0: number; x1: number; hw: number; z0: number; z1: number } | null;
  /** Nose rails/joists stop here so the swinging turntable corners clear them. */
  noseRailEnd: number;
  cabinJoistX: number[];
  noseJoistX: number[];
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
  const ackHull = p.frontEndType === 1;
  const hullCurve = hullPlanCurve(p); // D-45 reverse curve, or the Ackermann bow curve (D-52)
  const xn = ackHull ? hullCurve.x1 : WB - p.noseTaperStartIn;
  const xc0 = ackHull ? hullCurve.x0 : Math.min(p.hullCurveStartIn, xn - 1);
  const xs = xn - p.shoulderBeamIn;
  const xRear = -p.rearOverhangIn;
  const xFront = WB + p.frontOverhangIn;
  const side = p.sideThicknessIn;
  const transom = p.transomThicknessIn;
  const rearLane = p.blockingThickIn;
  const ply = p.deckPlyIn;
  const deckTop = p.deckHeightIn;
  const noseTop = deckTop + p.frontDeckRaiseIn;
  const hwC = p.bodyWidthIn / 2 - side;
  const hwN = p.noseWidthIn / 2 - side;
  const rodR = p.axleDiameterIn / 2;
  const joistT = p.crossmemberThickIn;
  const clr = p.sideBearerClearanceIn;

  const mkBeam = (x: number, track: number, thick: number): Beam => {
    const depth = p.axleBeamDepthIn;
    const top = p.axleBeamPosition === AXLE_BEAM_POSITION.underslung ? r + rodR : r - rodR + depth;
    return { x, len: Math.max(1, track - p.hubLengthIn - 0.25), thick, depth, top, bot: top - depth };
  };
  const beamR = mkBeam(0, p.rearTrackIn, p.axleBeamThicknessIn);
  // The front beam is centerd on the rod + kingpin pair (D-25, critic r2 H2): from the rod's rear edge (WB − rodR) to the
  // kingpin's front edge (WB + lead + kpR), so both holes keep ≥ beamLigamentMinIn of wood on their outer side.
  const beamF = mkBeam(WB + d.frontBeamOffsetIn, p.frontTrackIn, p.frontAxleBeamThicknessIn);

  // Turntable on the front beam, centerd on the kingpin; bolster fills up to the nose deck (min depth).
  const ts = p.turntableSizeIn;
  const plates = p.kingpinThroughBolster === 1; // the steel kingpin plates exist whenever the pin runs up through the crossbar (D-35)
  const carrierT = plates ? p.carrierPlateThickIn : 0;
  const plateT = plates ? p.kingpinPlateThickIn : 0;
  const tz0 = beamF.top + carrierT;
  const tz1 = tz0 + p.turntableThicknessIn;
  const bolsterTop = Math.max(noseTop - ply, tz1 + p.bolsterMinDepthIn);
  const bp = bolsterPlan(p);
  const sbY0 = ts / 2 + clr;
  const sbY1 = bp.halfY;
  const bolster = { x0: kx - ts / 2, x1: kx + ts / 2, z0: tz1, z1: bolsterTop, halfY: sbY1, rw: bp.rw };
  // Kingpin crossbar (kingpinThroughBolster): fore-aft bar across the opening over the pin, ends let into the bolster rails,
  // top flush with the rails; the kingpin ends here (nut + washer on the crossbar top).
  const through = p.kingpinThroughBolster === 1;
  const crossbar = through
    ? { x0: bolster.x0 + bolster.rw - p.kingpinCrossbarLetInIn, x1: bolster.x1 - bolster.rw + p.kingpinCrossbarLetInIn, hw: p.kingpinCrossbarWidthIn / 2, z0: tz1 + plateT, z1: bolsterTop }
    : null;
  const accessPanel = crossbar && noseTop - bolsterTop > 0.05
    ? { x0: kx - p.accessPanelLengthIn / 2, x1: kx + p.accessPanelLengthIn / 2, hw: p.accessPanelWidthIn / 2, z0: bolsterTop, z1: noseTop }
    : null;
  // Oak block housed in the beam top; UHMW strip on it; running clearance `clr` to the bolster rail underside (tz1).
  const sbZw = tz1 - clr;
  const sbZ1 = sbZw - p.sideBearerWearIn;
  const sbX0 = WB + rodR + p.sideBearerSetbackIn;
  const sideBearer = { y0: sbY0, y1: sbY1, z0: beamF.top - p.sideBearerEmbedIn, z1: sbZ1, zw: sbZw, x0: sbX0, x1: sbX0 + p.sideBearerLengthIn };

  // Rotated square turntable reaches ts/2·(cos+sin) fore-aft at lock (peaks at 45°). The swinging axle beam's aft face
  // also sweeps under the rail y-band: at |y| = hwN it reaches |xa|/cos + hwN·tan behind the kingpin (xa = beam aft face, kingpin-relative).
  const lk = (Math.min(Math.abs(p.steerLockDeg), 45) * Math.PI) / 180;
  const plateSwingX = (ts / 2) * (Math.cos(lk) + Math.sin(lk));
  const beamAft = Math.abs(beamF.x - beamF.thick / 2 - kx);
  const beamSwingX = beamAft / Math.cos(lk) + (hwN + side) * Math.tan(lk); // ladder rails run flush under the chine (D-43): their end corner is at |y| = hwN + side
  // The beam's aft face is TILTED by the lock angle, so the perpendicular distance from the rail's end corner to it is the
  // fore-aft gap × cos(lock): the gap must be clearance / cos(lock), not the clearance itself (the exploration found beam-F
  // 0.75·cos 38.5° = 0.59" from the nose rail at track ≥ 36.5" or wider beams, where the beam rather than the plate governs).
  // The U-bolt clamps sit at |y| beyond the rails' y-band, so they cannot reach the rail end; the nose side panels are covered
  // by the auto shoulder rule (resolveParams). Moving the rail end back (rather than narrowing the nose) is the physical fix:
  // the beam corner at |y| = hwN is what sweeps aft, and the nose width is already the widest the tires allow (A-4).
  // Ackermann hull: no turntable to swing, the nose rails run to the front transom's inner face (D-52).
  const noseRailEnd = ackHull ? WB + p.frontOverhangIn - p.transomThicknessIn : kx - Math.max(plateSwingX + p.steeringClearanceIn, beamSwingX + p.steeringClearanceIn / Math.cos(lk));

  // Joists skip the rear axle beam when it stands taller than their underside (overslung beam).
  const jD = p.crossmemberDepthIn;
  // They also skip the brake cross shaft when it runs through their depth.
  const shaftX = -(r + p.brakeShaftBehindTireIn);
  const shaftThroughJoists = r + p.brakeShaftDiameterIn / 2 > deckTop - ply - jD + 0.01 && r - p.brakeShaftDiameterIn / 2 < deckTop - ply;
  // A joist that would hit the beam is replaced by one on each side of it (not pushed to one side only), so a thicker
  // deck ply never lengthens the panel span next to the beam (critic Phase 2 r1, D1 oddity).
  // ── Seat ──
  const baseW = Math.max(1, Math.min(p.seatWidthIn, 2 * hwC - 1));
  const pl = p.panelPlyIn;
  const underSeat = p.storageLocation === STORAGE_LOCATION.underSeat;
  const hCap = p.sideHeightIn + p.storageOverSideIn;
  const boxHeight = (lx: number, w: number) =>
    Math.min(hCap, p.storageVolumeIn3 / (Math.max(0.5, lx - 2 * pl) * Math.max(0.5, w - 2 * pl)) + 2 * pl);
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
    const footDeck = p.seatXIn + p.riderLegReachIn >= xs ? noseTop : deckTop;
    const zBot = Math.max(2 * r + p.storageRaisedClearIn, riderLegTopZ(p, surface, footDeck) + p.storageRaisedClearIn);
    storage = { location: p.storageLocation, x0, x1, zBot, zTop: zBot + boxHeight(x1 - x0, w), hw: w / 2 };
  } else {
    // Behind the seat back: its rear face leans back as it rises, so the box end follows it.
    const x0 = xRear + transom + rearLane;
    const hwB = hwC - p.storageSideClearIn; // the box stands this far off the chine inner face (r3 build S3, D-47)
    const backX = (zTop: number) => Pr[0] - Math.max(0, zTop - Pr[2]) * (-col2[0] / col2[2]);
    let h = Math.min(hCap, p.storageVolumeIn3 / (Math.max(0.5, seatRear - x0) * Math.max(0.5, 2 * hwB)));
    for (let i = 0; i < 6; i++) h = boxHeight(Math.max(1, backX(deckTop + h) - x0), 2 * hwB);
    const x1 = Math.max(x0 + 1, backX(deckTop + h));
    storage = { location: p.storageLocation, x0, x1, zBot: deckTop, zTop: deckTop + boxHeight(x1 - x0, 2 * hwB), hw: hwB };
  }

  // D-45: the sides are vertical (the S-curve web is laminated around a plan-view form), so there is no flare; the chine bottom, the web
  // and the gunwale are the same height along the whole hull (captured-ply: at the nose deck level; the cabin rails stand 1" taller to meet the chine).
  const flare = 0;
  const chineH = p.railBandIn;
  const chineBot = p.sideConstruction === SIDE_CONSTRUCTION.capturedPly ? noseTop - ply : deckTop - ply;
  const webZ0 = chineBot + chineH;
  const webZ1 = deckTop + p.sideHeightIn - p.railBandIn;
  const web = { z0: webZ0, z1: webZ1, phi: Math.atan2(flare, Math.max(0.1, webZ1 - webZ0)) };

  // Sheer (D-44): rises over the forward `sheerLengthIn` of the nose, never behind the shoulder; 0 = the old straight gunwale.
  const sheerX1 = xFront - transom;
  let sheerX0 = Math.max(xn, sheerX1 - p.sheerLengthIn);
  if (ackHull && p.sheerRiseIn > 0) {
    // The finger guard's strap needs a FLAT gunwale: the sheer rise starts beyond the pinch zone (the tire sweep within fingerGapMinIn of the hull side) plus the guard's margin.
    const hz = hazardRangeX(sidePolyline(hullCurve, side / 2, xc0, sheerX1), leftTirePolys(hullCurveSpec(p)), p.fingerGapMinIn);
    if (hz) sheerX0 = Math.min(sheerX1 - 1, Math.max(sheerX0, hz[1] + SHEER_AFTER_PINCH_IN));
  }
  const sheer = { x0: sheerX0, x1: sheerX1, riseIn: Math.max(0, p.sheerRiseIn) };

  const front = computeFrontLayout(p, { r, WB, kx, seat, hull: hullCurve, side, ply, deckTop, noseTop }, (x) => offsetY(hullCurve, -side / 2, x));

  // ── Joists: skip the rear axle beam and the brake shaft; with the Ackermann front end also the steel front beam (its top stands in their depth) ──
  const fb = ackHull ? front.beam : null;
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
    if (fb && fb.top > deckTop - ply - jD + 0.01) {
      const sf = straddle(x, fb);
      if (sf) return sf;
    }
    const sh = (p.brakeShaftDiameterIn + joistT) / 2 + 0.05;
    if (shaftThroughJoists && Math.abs(x - shaftX) < sh) return [x < shaftX ? shaftX - sh : shaftX + sh];
    return [x];
  });
  const cabinJoistX = joistsBetween(xRear + transom, xs);
  const noseJoistX = ackHull ? joistsBetween(xn, noseRailEnd) : evenInterior(xn, noseRailEnd, p.crossmemberSpacingIn, joistT);

  return {
    r, WB, xs, xc0, xn, hull: hullCurve, ackHull, bowHeading: curveHeading(hullCurve, xFront), chineH, chineBot, railTop: chineBot, shoulderBeam: p.shoulderBeamIn, sideTop: deckTop + p.sideHeightIn, xRear, xFront, kx, railBand: p.railBandIn, joistT, flare, web, side, transom, rearLane, ply, deckTop, deckBot: deckTop - ply, noseTop, noseBot: noseTop - ply,
    hwC, hwN, sideH: p.sideHeightIn, sheer, noseGunTop: deckTop + p.sideHeightIn + sheer.riseIn, beamR, beamF, front,
    turntable: { z0: tz0, z1: tz1 },
    bolster, sideBearer, kingpin: { z0: beamF.bot - plateT, z1: through ? bolsterTop : tz1 }, crossbar, accessPanel,
    kpPlates: plates ? { carrier: { z0: beamF.top, z1: tz0 }, under: { z0: beamF.bot - plateT, z1: beamF.bot }, bar: { z0: tz1, z1: tz1 + plateT } } : null,
    noseRailEnd, cabinJoistX, noseJoistX, seat, storage,
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
