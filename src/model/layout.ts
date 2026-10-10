/**
 * Shared derived geometry for the block model: every builder reads positions from here so the
 * subsystems agree on where the deck, axle stack, seat and storage box are. Plain numbers only;
 * all design inputs come from Params (src/params.ts). Neutral (steer = 0) model frame.
 */
import {
  AXLE_BEAM_POSITION,
  STORAGE_LOCATION,
  derived,
  type Params,
} from '../params';
import type { Vec3 } from './types';

// ── Block-model placeholder dimensions (Phase 1 only; the real joinery arrives in Phase 3) ──
/** Chine and gunwale cross-section height (spec: sideThickness × 1.5). */
export const RAIL_BAND_IN = 1.5;
/** Seat base frame: fore-aft length and thickness (spec). */
export const SEAT_BASE_LEN_IN = 16;
export const SEAT_BASE_THICK_IN = 1.5;
/** Seat back panel thickness (spec). */
export const SEAT_BACK_THICK_IN = 0.75;
/** Seat base rear edge sits this far behind the H-point (spec). */
export const SEAT_BASE_BEHIND_HPOINT_IN = 4;
/** Minimum bolster depth (spec). */
export const BOLSTER_MIN_DEPTH_IN = 0.75;
/** Storage box may not be taller than the side height plus this (spec). */
export const STORAGE_OVER_SIDE_IN = 2;
/** Raised (forwardRaised) storage box bottom = 2r + this (spec). */
export const STORAGE_RAISED_CLEAR_IN = 0.75;
/** Joist thickness (spec: ¾). */
export const JOIST_THICK_IN = 0.75;

export interface Layout {
  r: number;
  WB: number;
  /** Cabin shoulder x (full width ends, nose begins). */
  xs: number;
  xRear: number;
  xFront: number;
  side: number;
  ply: number;
  deckTop: number;
  deckBot: number;
  noseTop: number;
  noseBot: number;
  /** Inner half widths (between the side panels). */
  hwC: number;
  hwN: number;
  sideH: number;
  /** Rear axle beam and front axle beam. */
  beamR: Beam;
  beamF: Beam;
  turntable: { z0: number; z1: number };
  bolster: { x0: number; x1: number; z0: number; z1: number };
  kingpin: { z0: number; z1: number };
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
  /** Seat base z range and the cushion top (H-point height). */
  baseBottom: number;
  baseTop: number;
  surface: number;
  xRear: number;
  xFront: number;
  width: number;
  /** Seat-back frame: P = back's front-bottom point; col0 = back normal (forward), col2 = up the back. */
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

function evenInterior(a: number, b: number, spacing: number): number[] {
  const L = b - a;
  if (L <= JOIST_THICK_IN * 2) return [];
  const n = Math.max(0, Math.ceil(L / spacing) - 1);
  return Array.from({ length: n }, (_, i) => a + (L * (i + 1)) / (n + 1));
}

export function computeLayout(p: Params): Layout {
  const d = derived(p);
  const r = d.wheelRadiusIn;
  const WB = p.wheelbaseIn;
  const xs = WB - p.noseTaperStartIn;
  const xRear = -p.rearOverhangIn;
  const xFront = WB + p.frontOverhangIn;
  const side = p.sideThicknessIn;
  const ply = p.deckPlyIn;
  const deckTop = p.deckHeightIn;
  const noseTop = deckTop + p.frontDeckRaiseIn;
  const hwC = p.bodyWidthIn / 2 - side;
  const hwN = p.noseWidthIn / 2 - side;
  const rodR = p.axleDiameterIn / 2;

  const mkBeam = (x: number, track: number): Beam => {
    const depth = p.axleBeamDepthIn;
    const top = p.axleBeamPosition === AXLE_BEAM_POSITION.underslung ? r + rodR : r - rodR + depth;
    return { x, len: Math.max(1, track - p.hubLengthIn - 0.25), thick: p.axleBeamThicknessIn, depth, top, bot: top - depth };
  };
  const beamR = mkBeam(0, p.rearTrackIn);
  const beamF = mkBeam(WB, p.frontTrackIn);

  // Turntable on the front beam; bolster fills up to the nose deck (min 0.75").
  const tz0 = beamF.top;
  const tz1 = tz0 + p.turntableThicknessIn;
  const bolsterTop = Math.max(noseTop - ply, tz1 + BOLSTER_MIN_DEPTH_IN);
  const bolster = { x0: WB - p.turntableSizeIn / 2, x1: WB + p.turntableSizeIn / 2, z0: tz1, z1: bolsterTop };

  // Rotated square turntable reaches ts/2·(cos+sin) fore-aft at lock (peaks at 45°).
  const lk = (Math.min(Math.abs(p.steerLockDeg), 45) * Math.PI) / 180;
  const swingX = (p.turntableSizeIn / 2) * (Math.cos(lk) + Math.sin(lk));
  const noseRailEnd = WB - swingX - p.steeringClearanceIn;

  const cabinJoistX = evenInterior(xRear + side, xs, p.crossmemberSpacingIn);
  const noseJoistX = evenInterior(xs, noseRailEnd, p.crossmemberSpacingIn);

  // ── Seat ──
  const baseW = Math.max(1, 2 * hwC - 2);
  const pl = p.panelPlyIn;
  const underSeat = p.storageLocation === STORAGE_LOCATION.underSeat;
  const hCap = p.sideHeightIn + STORAGE_OVER_SIDE_IN;
  const boxHeight = (lx: number, w: number) =>
    Math.min(hCap, p.storageVolumeIn3 / (Math.max(0.5, lx - 2 * pl) * Math.max(0.5, w - 2 * pl)) + 2 * pl);
  const hUnder = underSeat ? boxHeight(SEAT_BASE_LEN_IN, baseW) : 0;
  const baseBottom = deckTop + hUnder;
  const baseTop = baseBottom + SEAT_BASE_THICK_IN;
  const surface = baseTop + p.seatCushionIn;
  const seatRear = p.seatXIn - SEAT_BASE_BEHIND_HPOINT_IN;
  const a = (p.seatBackAngleDeg * Math.PI) / 180;
  const col0: Vec3 = [Math.cos(a), 0, Math.sin(a)];
  const col2: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
  const P: Vec3 = [seatRear, 0, baseTop];
  const Pr: Vec3 = [P[0] - col0[0] * SEAT_BACK_THICK_IN, 0, P[2] - col0[2] * SEAT_BACK_THICK_IN];
  const seat: SeatLayout = {
    baseBottom, baseTop, surface, xRear: seatRear, xFront: seatRear + SEAT_BASE_LEN_IN, width: baseW, P, col0, col2, Pr,
  };

  // ── Storage ──
  let storage: StorageLayout;
  if (p.storageLocation === STORAGE_LOCATION.underSeat) {
    storage = { location: p.storageLocation, x0: seat.xRear, x1: seat.xFront, zBot: deckTop, zTop: deckTop + hUnder, hw: baseW / 2 };
  } else if (p.storageLocation === STORAGE_LOCATION.forwardRaised) {
    const x0 = xs;
    const x1 = Math.max(x0 + 1, xFront - side - 1.5);
    const w = Math.max(1, 2 * hwN);
    const zBot = 2 * r + STORAGE_RAISED_CLEAR_IN;
    storage = { location: p.storageLocation, x0, x1, zBot, zTop: zBot + boxHeight(x1 - x0, w), hw: w / 2 };
  } else {
    // Behind the seat back: its rear face leans back as it rises, so the box end follows it.
    const x0 = xRear + side;
    const backX = (zTop: number) => Pr[0] - Math.max(0, zTop - Pr[2]) * (-col2[0] / col2[2]);
    let h = Math.min(hCap, p.storageVolumeIn3 / (Math.max(0.5, seatRear - x0) * Math.max(0.5, 2 * hwC)));
    for (let i = 0; i < 6; i++) h = boxHeight(Math.max(1, backX(deckTop + h) - x0), 2 * hwC);
    const x1 = Math.max(x0 + 1, backX(deckTop + h));
    storage = { location: p.storageLocation, x0, x1, zBot: deckTop, zTop: deckTop + boxHeight(x1 - x0, 2 * hwC), hw: hwC };
  }

  return {
    r, WB, xs, xRear, xFront, side, ply, deckTop, deckBot: deckTop - ply, noseTop, noseBot: noseTop - ply,
    hwC, hwN, sideH: p.sideHeightIn, beamR, beamF,
    turntable: { z0: tz0, z1: tz1 },
    bolster, kingpin: { z0: beamF.bot, z1: bolsterTop },
    noseRailEnd, cabinJoistX, noseJoistX, seat, storage,
  };
}

export { len as spanLen };
