/**
 * Shared derived geometry for the block model: every builder reads positions from here so the
 * subsystems agree on where the deck, axle stack, seat and storage box are. Plain numbers only;
 * all design inputs come from Params (src/params.ts).
 *
 * D-54 body: straight parallel sides (a constant width, no taper), a sled side profile (a straight line from `sideHeightRearIn` at the rear transom to
 * `sideHeightBowIn` where the sides end against the curled bow), one flat deck level, and the pivoting soapbox front axle at the wheelbase (D-56; the swivel casters were rejected).
 */
import {
  STORAGE_LOCATION,
  bowCurl,
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
  /** The flat deck ends here; the bow curl carries on and curls up (D-54). */
  xFlatEnd: number;
  /** The sides end against the curl here, where its inside face has risen to the bow side height. */
  xSideEnd: number;
  curl: ReturnType<typeof bowCurl> & {
    /** Inside-face height above the deck top at x (0 at xFlatEnd), and the tangent angle (rad) there. */
    heightAt: (x: number) => number;
    angleAt: (x: number) => number;
  };
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
  /** Chine / gunwale / side-board thickness (hwC is measured to its inner face). */
  side: number;
  /** Rear transom thickness (D-43). */
  transom: number;
  /** Oak backer lane between the rear transom and a rear storage box. */
  rearLane: number;
  ply: number;
  deckTop: number;
  deckBot: number;
  /** Inner half width (between the side panels): the whole hull, front to back. */
  hwC: number;
  /** Web (side panel) bottom z; its top is the gunwale line minus the gunwale band. */
  web: { z0: number };
  /** Rear axle beam, and the pivoting front axle beam (center at the kingpin, x = wheelbase). */
  beamR: Beam;
  beamF: Beam;
  /** Front pivot (D-56): the steer geometry (lock, stack heights, swath, stops) and the pieces placed from it. */
  steer: ReturnType<typeof steerGeometry>;
  king: { x: number; len: number; bot: number; top: number; depth: number };
  stops: { faceX: number; y1: number; y2: number; bot: number; top: number; thick: number };
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
  const curl0 = bowCurl(p);
  const xRear = -p.rearOverhangIn;
  const xFront = curl0.xTip;
  const side = p.sideThicknessIn;
  const transom = p.transomThicknessIn;
  const rearLane = p.blockingThickIn;
  const ply = p.deckPlyIn;
  const deckTop = p.deckHeightIn;
  const hwC = p.bodyWidthIn / 2 - side;
  const rodR = p.axleDiameterIn / 2;
  const joistT = p.crossmemberThickIn;

  // ── Bow curl: inside-face height above the deck top at x (0 at the tangent point) ──
  const Ri = curl0.rIn;
  const heightAt = (x: number) => {
    const dd = Math.max(0, Math.min(curl0.run, x - curl0.xFlatEnd));
    return Ri - Math.sqrt(Math.max(0, Ri * Ri - dd * dd));
  };
  const angleAt = (x: number) => Math.asin(Math.max(0, Math.min(1, (x - curl0.xFlatEnd) / Ri)));
  const sideBow = Math.min(p.sideHeightBowIn, curl0.riseInner - 0.2);
  const dEnd = Math.sqrt(Math.max(0, Ri * Ri - (Ri - sideBow) ** 2));
  const xSideEnd = curl0.xFlatEnd + dEnd;
  const curl = { ...curl0, heightAt, angleAt };

  // `position` 0 = underslung (rod on top of the beam), 1 = overslung. The pivoting front beam is ALWAYS underslung (the king stack in steerGeometry assumes it, D-56).
  const mkBeam = (x: number, track: number, thick: number, position = p.axleBeamPosition): Beam => {
    const depth = p.axleBeamDepthIn;
    const top = position === 0 ? r + rodR : r - rodR + depth;
    return { x, len: Math.max(1, track - p.hubLengthIn - 0.25), thick, depth, top, bot: top - depth };
  };
  const beamR = mkBeam(0, p.rearTrackIn, p.axleBeamThicknessIn);
  const beamF = mkBeam(WB, p.frontTrackIn, p.axleBeamThicknessIn, 0);

  // ── Seat ──
  const baseW = Math.max(1, Math.min(p.seatWidthIn, 2 * hwC - 1));
  const pl = p.panelPlyIn;
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
  const stopThick = joistT;
  // The beam's leading face (a plane `axleBeamThickness / 2` ahead of its axis) crosses the stop's rear face at beam distance `steer.stopY1` from the kingpin, i.e. at world |y| =
  // stopY1 cos(lock) - (thickness / 2) sin(lock). Beyond that point the swinging face is AHEAD of the stop face, so a block there would be run through by the beam: the block
  // ENDS at the contact point (it spans the old stop width inboard of it), and the beam touches its outer end at full lock.
  const stopContactY = steer.stopY1 * Math.cos(steer.lock) - (p.axleBeamThicknessIn / 2) * Math.sin(steer.lock);
  const stops = { faceX: steer.stopFaceX, y1: stopContactY - Math.min(steer.railYIn - steer.stopY1, 3 * stopThick), y2: stopContactY, bot: beamF.top - 1.0, top: deckTop - ply - p.crossmemberDepthIn, thick: stopThick };
  const tipX = xFront + p.tongueTieAheadIn;
  const tongue = { tipX, z0: beamF.top, z1: beamF.top + p.tongueThickIn, holeX: tipX - 1, tieZ: beamF.top + p.tongueThickIn + 0.35 };

  // ── Joists: even spacing from the rear transom to the king beam, the king beam itself, and a last joist under the scarf of the deck to the bow curl ──
  const xSideStart = xRear + transom;
  const xEndJoist = steer.endJoistX;
  const joistX = [...evenInterior(xSideStart, kingX - king.len / 2, p.crossmemberSpacingIn, joistT), kingX, xEndJoist];

  void len;
  return {
    r, WB, xRear, xFront, xFlatEnd: curl.xFlatEnd, xSideEnd, curl, chineBot, railTop: chineBot, chineH,
    sideTop: deckTop + p.sideHeightRearIn, sideH: sideBow, sideRear: p.sideHeightRearIn, sag: p.sideProfileSagIn, xSideStart,
    railBand: p.railBandIn, joistT, side, transom, rearLane, ply, deckTop, deckBot: deckTop - ply, hwC, web, beamR, beamF, steer, king, stops, tongue,
    railEnd: curl.xFlatEnd, railStepX: steer.railStepX, railDepthF: steer.railDepthFront, joistX, seat, storage,
  };
}

export { len as spanLen };

/** Height of the gunwale top above the deck top at x (the straight sled profile from the rear transom's inner face to the end of the sides, plus the optional sag, D-54). */
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

/** Inside half width: constant (straight sides). Kept as a function so call sites read the same as before. */
export function innerHalfWidth(L: Pick<Layout, 'hwC'>, _x?: number): number {
  void _x;
  return L.hwC;
}

/** x samples from `a` to `b` inclusive, `n` segments. */
export function samples(a: number, b: number, n: number): number[] {
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}

export { DEG as DEG_PER_RAD_INV, sideHeightAt as sideHeightLine };
