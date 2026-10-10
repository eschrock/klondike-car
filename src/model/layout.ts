/**
 * Shared derived geometry for the block model: every builder reads positions from here so the
 * subsystems agree on where the deck, axle stack, seat and storage box are. Plain numbers only;
 * all design inputs come from Params (src/params.ts). Neutral (steer = 0) model frame.
 */
import {
  AXLE_BEAM_POSITION,
  SIDE_CONSTRUCTION,
  STORAGE_LOCATION,
  derived,
  type Params,
} from '../params';
import { riderLegTopZ } from './rider-geom';
import type { Vec3 } from './types';

// Design numbers (chine height, seat depth, tongue section, ...) live in params.ts; only derived geometry here.

export interface Layout {
  r: number;
  WB: number;
  /** Cabin shoulder x (full width ends, nose begins). */
  xs: number;
  xRear: number;
  xFront: number;
  /** Kingpin (steer pivot, turntable centre) x: ahead of the front axle by kingpinLeadIn (D-25). */
  kx: number;
  /** Chine / gunwale section height and joist thickness (params). */
  railBand: number;
  joistT: number;
  /** Effective gunwale flare (cabin sides only, captured-ply construction only) and the cabin web plane (flare tilt φ). */
  flare: number;
  web: { z0: number; z1: number; phi: number };
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
  /** Bolster ring: x0..x1 fore-aft, ±halfY across, z0..z1 depth, rail width rw. */
  bolster: { x0: number; x1: number; z0: number; z1: number; halfY: number; rw: number };
  /** Side-bearer rub blocks: y range [y0, y1] each side, z range. Steer body, on the beam top. */
  sideBearer: { y0: number; y1: number; z0: number; z1: number };
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

export function computeLayout(p: Params): Layout {
  const d = derived(p);
  const r = d.wheelRadiusIn;
  const WB = p.wheelbaseIn;
  const kx = WB + p.kingpinLeadIn;
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
  const joistT = p.crossmemberThickIn;
  const clr = p.sideBearerClearanceIn;

  const mkBeam = (x: number, track: number): Beam => {
    const depth = p.axleBeamDepthIn;
    const top = p.axleBeamPosition === AXLE_BEAM_POSITION.underslung ? r + rodR : r - rodR + depth;
    return { x, len: Math.max(1, track - p.hubLengthIn - 0.25), thick: p.axleBeamThicknessIn, depth, top, bot: top - depth };
  };
  const beamR = mkBeam(0, p.rearTrackIn);
  // The front beam spans the axle (x = WB) and the kingpin (x = WB + lead): centred between them (D-25), so the
  // kingpin runs through solid wood and the rod lies in its groove behind it.
  const beamF = mkBeam(WB + p.kingpinLeadIn / 2, p.frontTrackIn);

  // Turntable on the front beam, centred on the kingpin; bolster fills up to the nose deck (min depth).
  const ts = p.turntableSizeIn;
  const tz0 = beamF.top;
  const tz1 = tz0 + p.turntableThicknessIn;
  const bolsterTop = Math.max(noseTop - ply, tz1 + p.bolsterMinDepthIn);
  const sbY0 = ts / 2 + clr;
  const sbY1 = sbY0 + p.sideBearerWidthIn;
  const bolster = { x0: kx - ts / 2, x1: kx + ts / 2, z0: tz1, z1: bolsterTop, halfY: sbY1, rw: Math.min(p.bolsterRailWidthIn, ts / 2 - 0.25) };
  const sideBearer = { y0: sbY0, y1: sbY1, z0: tz0, z1: Math.max(tz0 + clr, tz1 - clr) };

  // Rotated square turntable reaches ts/2·(cos+sin) fore-aft at lock (peaks at 45°).
  const lk = (Math.min(Math.abs(p.steerLockDeg), 45) * Math.PI) / 180;
  const swingX = (ts / 2) * (Math.cos(lk) + Math.sin(lk));
  const noseRailEnd = kx - swingX - p.steeringClearanceIn;

  // Joists skip the rear axle beam when it stands taller than their underside (overslung beam).
  const jD = p.crossmemberDepthIn;
  const cabinJoistX = evenInterior(xRear + side, xs, p.crossmemberSpacingIn, joistT).map((x) => {
    const half = (beamR.thick + joistT) / 2 + 0.05;
    if (beamR.top > deckTop - ply - jD + 0.01 && Math.abs(x - beamR.x) < half) return x < beamR.x ? beamR.x - half : beamR.x + half;
    return x;
  });
  const noseJoistX = evenInterior(xs, noseRailEnd, p.crossmemberSpacingIn, joistT);

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
    const x0 = xs;
    const x1 = Math.max(x0 + 1, xFront - side - 1.5);
    const w = Math.max(1, 2 * hwN);
    // Over the nose the box must clear the tires and also the rider's knees (the legs pass under it to the foot stop).
    const footDeck = p.seatXIn + p.riderLegReachIn >= xs ? noseTop : deckTop;
    const zBot = Math.max(2 * r + p.storageRaisedClearIn, riderLegTopZ(p, surface, footDeck) + p.storageRaisedClearIn);
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

  // Flare only exists on captured-ply cabin sides: the nose has the front tires beside it and the other constructions are straight.
  const flare = p.sideConstruction === SIDE_CONSTRUCTION.capturedPly ? p.gunwaleFlareIn : 0;
  const webZ0 = deckTop - ply + p.railBandIn;
  const webZ1 = deckTop + p.sideHeightIn - p.railBandIn;
  const web = { z0: webZ0, z1: webZ1, phi: Math.atan2(flare, Math.max(0.1, webZ1 - webZ0)) };

  return {
    r, WB, xs, xRear, xFront, kx, railBand: p.railBandIn, joistT, flare, web, side, ply, deckTop, deckBot: deckTop - ply, noseTop, noseBot: noseTop - ply,
    hwC, hwN, sideH: p.sideHeightIn, beamR, beamF,
    turntable: { z0: tz0, z1: tz1 },
    bolster, sideBearer, kingpin: { z0: beamF.bot, z1: tz1 },
    noseRailEnd, cabinJoistX, noseJoistX, seat, storage,
  };
}

export { len as spanLen };

/**
 * A point on the outside of a captured-ply cabin side panel: `off` inches out along the panel normal from its
 * centreline at height z (flare tilts the panel, so signs and reflectors lean with it). `halfH` is the half height of
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
