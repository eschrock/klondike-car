/**
 * Shared derived geometry for the block model: every builder reads positions from here so the
 * subsystems agree on where the deck, axle stack, seat and storage box are. Plain numbers only;
 * all design inputs come from Params (src/params.ts).
 *
 * D-54 body, D-57 character: a sled side profile (the sheer sweeps up in a concave curve from `sideHeightBowIn` at the bow to `sideHeightRearIn` at the rear transom,
 * `sheerCurveIn`), sides that draw in toward the bow in a long derived taper (D-66, `bowTaper`, shared with the frame and the front axle through `Layout.turnIn`), one flat deck level that ends
 * at the rear face of the shaped oak BOW BULKHEAD (the rider's foot brace and the lift hand-hold, D-57), and the pivoting soapbox front axle at the wheelbase (D-56).
 */
import {
  STORAGE_LOCATION,
  bowBulkhead,
  bowTaper,
  taperTurnIn,
  type BowTaper,
  derived,
  resolveParams,
  sideHeightAt,
  steerGeometry,
  type Params,
} from '../params';
import type { Vec3 } from './types';

// Design numbers (chine height, seat depth, kingpin size, ...) live in params.ts; only derived geometry here.
const DEG = Math.PI / 180;

export interface Layout {
  r: number;
  WB: number;
  /** Rear transom outer face (the body's rear end) and the bow tip (front-most point of the curl). */
  xRear: number;
  xFront: number;
  /** The flat deck and the sides end here: the rear face of the bow bulkhead (the foot brace, D-57). */
  xFlatEnd: number;
  /** The sides end against the bulkhead here (= xFlatEnd). */
  xSideEnd: number;
  /** How far the hull's outer face has turned in at x, per side (D-57): 0 behind the taper start (`bowTaperStartIn`), the full (bodyWidthIn - bowWidthIn) / 2 from the taper end on (D-66). The inner faces, the deck edge and the front rails follow it. */
  turnIn: (x: number) => number;
  /** The derived bow taper (D-66): where the S starts and ends, the turn-in per side at the bow and its tightest radius. */
  taper: BowTaper;
  /** The shaped oak bow bulkhead (D-57): rear face `x0` (= the foot brace), front face `x1` (the bow tip), bottom z, the top z at the corners (the sheer height at the bow) and at the center, and its half width. */
  bulkhead: { x0: number; x1: number; thick: number; bot: number; zCorner: number; zCenter: number; halfW: number };
  /** The lift hand-hold through the bulkhead (D-57; the nose is lifted by the body, not the tongue): slot x range (the bulkhead thickness), half length across, z range and its center. */
  hold: { x0: number; x1: number; halfLen: number; zBot: number; zTop: number; zMid: number };
  /** Chine bottom, chine height (= railBand), and the rail top (the deck underside level). */
  chineBot: number;
  railTop: number;
  chineH: number;
  /** Top of the side at the REAR transom's inner face (deckTop + sideHeightRearIn): the gunwale line is lower further forward. */
  sideTop: number;
  /** The lowest side height above the deck (at the bow end) and the highest (rear). `sideH` is what the structural checks read (the lowest section). */
  sideH: number;
  sideRear: number;
  /** Side-profile sag (in) and the x where the straight gunwale line starts (rear transom inner face). */
  sag: number;
  xSideStart: number;
  /** Chine / gunwale / rail band height and joist thickness (params). */
  railBand: number;
  joistT: number;
  /** Chine / gunwale / side-board thickness: the whole sandwich (outer band + web + inner band; hwC is measured to its inner face). */
  side: number;
  /** Thickness of each oak band laminated onto a face of the thin web, (side - web) / 2 (D-61, D-62), and the depth the deck edge enters the chine rabbet (the inner band's thickness at most). */
  sideBand: number;
  /** How far the deck edge reaches past hwC under the inner chine band: the band thickness (or the dado depth) less `deckSideClearIn` (D-63), so the deck is that much narrower than the web gap (the web's inner face is at hwC + sideBand). */
  deckEdge: number;
  /** Rear transom thickness (D-43). */
  transom: number;
  /** Oak backer lane between the rear transom and a rear storage box. */
  rearLane: number;
  ply: number;
  deckTop: number;
  deckBot: number;
  /** Inner half width (between the side panels): the whole hull, front to back. */
  hwC: number;
  /** The FREE web between the chine band and the gunwale band: its bottom z (the chine top); its top is the gunwale line minus the gunwale band. The web itself runs the full height of the side, from the chine bottom to `webCap` under the gunwale top (D-62). */
  web: { z0: number };
  /** The web stops this far under the top of the gunwale bands; an oak cap strip bedded in thickened epoxy fills the slot over it, so no ply edge shows (D-62; 2026-10-24). */
  webCap: number;
  /** Rear axle beam, and the pivoting front axle beam (center at the kingpin, x = wheelbase). */
  beamR: Beam;
  beamF: Beam;
  /** Front pivot (D-56): the steer geometry (lock, stack heights, swath, stops) and the pieces placed from it. */
  steer: ReturnType<typeof steerGeometry>;
  king: { x: number; len: number; bot: number; top: number; depth: number };
  /** The two steering check chains (D-58), described for the RIGHT chain (the left is the mirror): the anchor eye ring on the front face of the chain joist behind the king beam (x, y < 0, z), the beam eye ring's standoff behind the axle beam's trailing face (u < 0, in the beam frame), its distance from the kingpin along the beam (v), its z, the stand-off of both rings, and the chain length between the eye rings (taut at +lock). */
  chain: { anchor: [number, number, number]; joistX: number; joistT: number; beamU: number; beamV: number; beamZ: number; lenIn: number; stand: number };
  /** Tongue plate: tip x, bottom and top z; the bridle tie hole is `holeX` from the tip and the shackle/rope height is `tieZ`. */
  tongue: { tipX: number; z0: number; z1: number; holeX: number; tieZ: number };
  /** Rails run to the end of the flat deck; ahead of `railStepX` they are only `railDepthF` deep so the swinging axle beam passes under them. Joists (the king beam included) carry the deck. */
  railEnd: number;
  railStepX: number;
  railDepthF: number;
  joistX: number[];
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
  const p = resolveParams(input);
  const d = derived(p);
  const r = d.wheelRadiusIn;
  const WB = p.wheelbaseIn;
  const bh = bowBulkhead(p);
  const xRear = -p.rearOverhangIn;
  const xFront = bh.xTip;
  const side = p.sideThicknessIn;
  const transom = p.transomThicknessIn;
  const rearLane = p.blockingThickIn;
  const ply = p.deckPlyIn;
  const deckTop = p.deckHeightIn;
  const hwC = p.bodyWidthIn / 2 - side;
  const sideBand = Math.max(0.05, (side - d.thinPlyIn) / 2);
  const deckEdge = Math.max(0, Math.min(p.deckCaptureDepthIn, sideBand) - p.deckSideClearIn); // D-63: the deck is cut deckSideClearIn narrower than the web gap on each side (R2-M3)
  const rodR = p.axleDiameterIn / 2;
  const joistT = p.crossmemberThickIn;

  // ── Bow end (D-57): the sides end against the bulkhead's rear face ──
  const sideBow = p.sideHeightBowIn;
  const xSideEnd = bh.xFlatEnd;
  const taper = bowTaper(p);
  const turnIn = (x: number) => taperTurnIn(taper, x);

  // `position` 0 = underslung (rod on top of the beam), 1 = overslung. The pivoting front beam is ALWAYS underslung (the king stack in steerGeometry assumes it, D-56).
  const mkBeam = (x: number, track: number, thick: number, position = p.axleBeamPosition): Beam => {
    const depth = p.axleBeamDepthIn;
    const top = position === 0 ? r + rodR - p.axleProudIn : r - rodR + p.axleProudIn + depth; // the tube stands axleProudIn proud of the groove (D-62)
    return { x, len: Math.max(1, track - p.hubLengthIn - 0.25), thick, depth, top, bot: top - depth };
  };
  const beamR = mkBeam(0, p.rearTrackIn, p.axleBeamThicknessIn);
  const beamF = mkBeam(WB, p.frontTrackIn, p.frontBeamThicknessIn, 0);

  // ── Seat ──
  const baseW = Math.max(1, Math.min(p.seatWidthIn, 2 * hwC - 1));
  const pl = d.thinPlyIn;
  const underSeat = p.storageLocation === STORAGE_LOCATION.underSeat;
  const hCap = p.sideHeightRearIn + p.storageOverSideIn;
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
  if (underSeat) {
    storage = { location: p.storageLocation, x0: seat.xRear, x1: seat.xFront, zBot: deckTop, zTop: deckTop + hUnder, hw: baseW / 2 };
  } else {
    // Behind the seat back: its rear face leans back as it rises, so the box end follows it. The box sits in the tall rear section of the sled sides (D-54).
    const x0 = xRear + transom + rearLane;
    const hwB = hwC - p.storageSideClearIn; // the box stands this far off the chine inner face (r3 build S3, D-47)
    const backX = (zTop: number) => Pr[0] - Math.max(0, zTop - Pr[2]) * (-col2[0] / col2[2]);
    const solveH = (cap: number) => {
      let h = Math.min(cap, p.storageVolumeIn3 / (Math.max(0.5, seatRear - x0) * Math.max(0.5, 2 * hwB)));
      for (let i = 0; i < 6; i++) h = boxHeight(Math.max(1, backX(deckTop + h) - x0), 2 * hwB, cap);
      return h;
    };
    const h = solveH(hCap);
    const x1 = Math.max(x0 + 1, backX(deckTop + h));
    storage = { location: p.storageLocation, x0, x1, zBot: deckTop, zTop: deckTop + boxHeight(x1 - x0, 2 * hwB, hCap), hw: hwB };
  }

  // The chine bottom, the web and the gunwale: the chine and the rail top are at the deck underside level (one deck level, D-52).
  const chineH = p.railBandIn;
  const chineBot = deckTop - ply;
  const web = { z0: chineBot + chineH };

  // ── Front pivot (D-56) ──
  const steer = steerGeometry(p);
  const kingX = steer.kingX;
  const king = { x: kingX, len: p.kingBeamLengthIn, bot: steer.kingBot, top: deckTop - ply, depth: steer.kingDepth };
  // D-58: the tongue is white oak set on edge, its top flush with the beam top and `tongueDepthIn` deep; the shackle hole (a sleeve, tongueHoleDiaIn) is tongueTipEdgeIn behind the tip, at mid depth.
  const tipX = xFront + p.tongueTieAheadIn;
  const tongueTop = beamF.top - p.tongueTopDropIn;
  const tongue = { tipX, z0: tongueTop - p.tongueDepthIn, z1: tongueTop, holeX: tipX - p.tongueTipEdgeIn, tieZ: tongueTop - p.tongueDepthIn / 2 };

  // ── Joists: even spacing from the rear transom to the king beam, the king beam itself, and a last joist under the scarf of the deck to the bow curl ──
  const xSideStart = xRear + transom;
  const xEndJoist = steer.endJoistX;
  const joistX = [...evenInterior(xSideStart, kingX - king.len / 2, p.crossmemberSpacingIn, joistT), kingX, xEndJoist];

  // D-58: the steering lock is set by two check chains: eye bolts through the ends of the axle beam (trailing face) and through the crossmember just behind the king beam (`chainJoistX`, thickened
  // to chainJoistThickIn; its front face carries the eyes). The RIGHT chain is described (taut at +lock); the left is the mirror.
  const kIdx = joistX.indexOf(kingX);
  const chainJoistX = kIdx > 0 ? joistX[kIdx - 1] : kingX - king.len / 2 - 8;
  const chainJoistT = p.chainJoistThickIn;
  const anchorY = Math.min(p.steerChainAnchorYIn, steer.railYIn - turnIn(chainJoistX) - 1.15); // the 2 in washer on the joist's rear face must clear the rail (a narrow body pulls the eye in)
  const anchor: Vec3 = [chainJoistX + chainJoistT / 2 + steer.stand, -anchorY, deckTop - ply - p.crossmemberDepthIn / 2 - 0.25];
  const eyeLock = steer.beamEyeAt(steer.lock);
  const chain = { anchor, joistX: chainJoistX, joistT: chainJoistT, beamU: steer.beamU, beamV: p.steerChainBeamYIn, beamZ: steer.beamZ, stand: steer.stand, lenIn: Math.hypot(eyeLock[0] - anchor[0], eyeLock[1] - anchor[1], eyeLock[2] - anchor[2]) };

  // ── Bow bulkhead and its lift hand-hold (D-57) ──
  const bulkhead = {
    x0: bh.xFlatEnd, x1: bh.xTip, thick: bh.thick, bot: deckTop - ply - steer.railDepthFront, // D-69: bottom at the bottom of the stepped front rail (the visible bottom of the side), corners at the side top at the bow, crown = the handlebow's
    zCorner: deckTop + p.sideHeightBowIn, zCenter: deckTop + p.sideHeightBowIn + p.handleBowCrownIn, halfW: p.bodyWidthIn / 2 - turnIn(bh.xFlatEnd),
  };
  // D-69: the hand-hold hangs under the crown with `liftBarMinIn` of oak above it; the bow has no box behind it, so the hand room is whatever is left above the deck (bowHoldMinClearIn is the floor).
  const holdTop = bulkhead.zCenter - p.liftBarMinIn;
  const holdBot = holdTop - p.liftSlotHeightIn;
  const hold = { x0: bulkhead.x0, x1: bulkhead.x1, halfLen: p.liftSlotLengthIn / 2, zBot: holdBot, zTop: holdTop, zMid: holdBot + p.liftSlotHeightIn / 2 };

  void len;
  return {
    r, WB, xRear, xFront, xFlatEnd: bh.xFlatEnd, xSideEnd, turnIn, taper, bulkhead, hold, chineBot, railTop: chineBot, chineH,
    sideTop: deckTop + p.sideHeightRearIn, sideH: sideBow, sideRear: p.sideHeightRearIn, sag: p.sheerCurveIn, xSideStart,
    railBand: p.railBandIn, joistT, side, sideBand, deckEdge, webCap: p.sideWebCapIn, transom, rearLane, ply, deckTop, deckBot: deckTop - ply, hwC, web, beamR, beamF, steer, king, chain, tongue,
    railEnd: bh.xFlatEnd, railStepX: steer.railStepX, railDepthF: steer.railDepthFront, joistX, seat, storage,
  };
}

export { len as spanLen };

/** Height of the gunwale top above the deck top at x (the sheer: from the rear transom's inner face to the end of the sides, sagging `sheerCurveIn` below the straight line, D-54, D-57). */
export function sideHeightAtX(L: Layout, x: number): number {
  const u = Math.max(0, Math.min(1, (x - L.xSideStart) / Math.max(1e-6, L.xSideEnd - L.xSideStart)));
  const bow = L.sideH;
  return L.sideRear + (bow - L.sideRear) * u - 4 * L.sag * u * (1 - u);
}

/** Gunwale top z at x. */
export const sideTopAt = (L: Layout, x: number): number => L.deckTop + sideHeightAtX(L, x);

/** Slope of the gunwale line at x (rad, positive = descending toward the bow). */
export function sideSlopeAt(L: Layout, x: number): number {
  const h = 0.05;
  const a = sideTopAt(L, x - h), b = sideTopAt(L, x + h);
  return Math.atan2(a - b, 2 * h);
}

/** Top z of the side web at x: the gunwale top minus the gunwale band. */
export const webTopAt = (L: Layout, x: number): number => sideTopAt(L, x) - L.railBand;

/** Inside half width at x: constant behind the bow turn-in, narrowing toward the bow after it (D-57). */
export function innerHalfWidth(L: Pick<Layout, 'hwC' | 'turnIn'>, x?: number): number {
  return L.hwC - (x === undefined ? 0 : L.turnIn(x));
}

/** Outer half width of the hull at x (the chine, gunwale and rail outer faces): `bodyWidthIn / 2` less the bow turn-in (D-57). */
export function outerHalfWidth(L: Pick<Layout, 'hwC' | 'side' | 'turnIn'>, x: number): number {
  return L.hwC + L.side - L.turnIn(x);
}

/** x samples from `a` to `b` inclusive, `n` segments. */
export function samples(a: number, b: number, n: number): number[] {
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}

export { DEG as DEG_PER_RAD_INV, sideHeightAt as sideHeightLine };
