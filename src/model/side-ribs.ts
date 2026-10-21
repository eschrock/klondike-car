/**
 * Side ribs and the tie-downs on them (D-76; docs/studies/side-stiffness-study.md, option E with option D at the rear station).
 *
 * Three oak ribs per side (four with the rear rib, D-85) stand on the inside face of the sandwich side, glued to the web between the inner chine and gunwale bands and to the
 * inner bands, and stand `sideRibDepthIn` proud of the inner band faces. Each widens at the top to a head `sideRibHeadLengthIn` long, as tall as the
 * gunwale band and cut to the sheer, and the head carries a bolt-on cargo D-ring (D-83: a 2-hole strap bracket), through-bolted with two 1/4-20 button-head
 * bolts (head, inner band, web, outer band; a fender washer outside, a nylock nut on the bracket inside). The bases tie the side to the structure:
 *   1. the box rib (E1): an oak spacer epoxied between it and the storage box side, near the box's fore corner (the box is its base, study option D);
 *   (D-85: a fourth, the rear rib, stands beside the flag tube with the same spacer. The box rib moved aft to match. The sign's four knobs screw into these two ribs.)
 *   2. the mid rib (E2): a knee on the joist nearest `sideRibMidXIn`, screwed down through the deck into it;
 *   3. the bow post (E3): a knee on the member nearest `sideRibFrontXIn` (the king beam at the defaults; the chain joist is the fallback, a verify item).
 * Between the bands the rib's back sits on a filler of band strip (it fills the band thickness down to the web), so the rib blank is one 3/4 in board.
 * They replace the six screwed lash doublers (D-41, D-47). Everything here is bandsawn from 4/4 offcuts and epoxied in after the deck is in.
 */
import { STORAGE_LOCATION, WEATHER_SPEC, thinSheet } from '../params';
import { STEP, box, frac16 as frac, SIDES, SIGN_PROUD_IN, stainless, dRingMat, insertMat, INSERT_DRILL_IN, type Ctx } from './build-utils';
/** A drill size to the nearest 1/64 in (the D-ring holes are 17/64 in: a 1/4-20 clearance), no inch mark. */
const frac64 = (x: number): string => { const n = Math.round(x * 64); let num = n % 64, den = 64; const whole = Math.floor(n / 64); while (num > 0 && num % 2 === 0) { num /= 2; den /= 2; } return num === 0 ? `${whole}` : whole > 0 ? `${whole}-${num}/${den}` : `${num}/${den}`; };
import { extPart, frameMat, SIGN_INSERT_LEN_IN, signBackerPlan, signKnobPlan, signPlacement } from './body';
import { transformPoint } from './bounds';
import { joistId } from './frame';
import { innerHalfWidth, sideSlopeAt, sideTopAt, type Layout } from './layout';
import { pickWoodScrew, SCREW_DIA_IN, screwText } from './rear-mount';

import { storageGeometry } from './storage';
import type { Params } from '../params';
import type { Part, Vec2, Vec3 } from './types';

// ── The D-ring bracket and its bolts (bought hardware, D-83: a bolt-on cargo D-ring with a 2-hole strap bracket, rated 233 lb working load) ──
/** The D-ring bracket (VERIFY against the real part's holes): length along the gunwale, height, thickness, and how far the folded ring stands off the head. */
export const LASH_PLATE = { len: 1.75, tall: 0.75, thick: 0.125, folded: 0.4 } as const;
/** Half the bolt spacing of the 2-hole bracket along the gunwale (holes 1-1/4" apart), and up it (both holes at the head's mid height). */
export const LASH_HOLE_DX_IN = 0.625;
export const LASH_HOLE_DZ_IN = 0;
export const LASH_BOLTS = 2;
/** 1/4-20 button-head bolt: shank diameter, tensile stress area and root (minor-diameter) area (ASME B1.1: 0.0318 and 0.0269 in²). */
export const LASH_BOLT_DIA_IN = 0.25;
export const LASH_BOLT_AT_IN2 = 0.0318;
export const LASH_BOLT_AR_IN2 = 0.0269;
/** 1/4 fender washer, 3/4 in OD (OD, hole, thickness) under the bolt head on the outer band; the 1/4-20 nylock nut's height; threads to show past it. */
export const LASH_WASHER = { od: 0.75, id: 0.281, t: 0.063 } as const;
export const LASH_NYLOCK_IN = 0.3125;
const LASH_THREADS_PAST_IN = 2 / 32;
/** Stock lengths of 1/4-20 button-head bolts (in). */
const MACHINE_SCREW_LENGTHS = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];
const LASH_MASS_LB = 0.11;

/** Knee screws: gauge, how far each sits from the rib face along the knee's foot (fraction of the foot), and the oak left under the head in the counterbore. */
export const KNEE_SCREW_GAUGE = 8 as const; // D-82: #8 x 2-1/2, piloted
export const KNEE_SCREW_AT = [0.35, 0.7] as const;
export const KNEE_SCREW_SEAT_IN = 0.5;
const KNEE_CBORE_DIA_IN = 0.375;

export type RibKind = 'box' | 'knee';

export interface RibStation {
  /** 1 = box rib (E1), 2 = mid rib (E2), 3 = bow post (E3), 4 = rear rib (E0, D-85: beside the flag tube, behind the sign's rear knobs). */
  n: 1 | 2 | 3 | 4;
  kind: RibKind;
  x: number;
  /** The member under the knee (joist id or 'king-beam') and its fore-aft thickness; null for the box rib. */
  member: string | null;
  memberT: number;
  /** The member's centerline x (null for the box rib). `x` is the rib's own center; they differ where the side is turned in the bow taper (see `placeKnee`). */
  memberX: number | null;
  /** Gunwale top z at the station, side height above the deck there, and the inner band face |y|. */
  top: number;
  h: number;
  yIn: number;
  /** The thickness of the whole side sandwich here (outer band + web + inner band). */
  sideT: number;
  /** Plan slope of the side here (d turn-in / dx) and the sheer slope (rad). */
  dTurn: number;
  slope: number;
}

/** Nearest framing member (joist or king beam) to x: its x, id and fore-aft thickness. Members inside `avoid` (an x range: an under-seat box the knee would hit) are skipped. */
function nearestMember(L: Layout, x: number, avoid?: [number, number]): { x: number; id: string; t: number } {
  const ok = (i: number) => !avoid || L.joistX[i] < avoid[0] || L.joistX[i] > avoid[1];
  let best = -1;
  for (let i = 0; i < L.joistX.length; i++) if (ok(i) && (best < 0 || Math.abs(L.joistX[i] - x) < Math.abs(L.joistX[best] - x))) best = i;
  if (best < 0) best = 0;
  const jx = L.joistX[best];
  const t = jx === L.king.x ? L.king.len : jx === L.chain.joistX ? L.chain.joistT : L.joistT;
  return { x: jx, id: joistId(L, best), t };
}

/** Wood left between a knee screw's shank and each face of the member it screws into (in). */
export const KNEE_MIN_WOOD_IN = 0.125;
/** How far a knee screw's axis may stand from the member's centerline (fore-aft) and still leave `KNEE_MIN_WOOD_IN` of wood to each face. */
export const kneeScrewDriftLimitIn = (memberT: number): number => memberT / 2 - KNEE_MIN_WOOD_IN - SCREW_DIA_IN[KNEE_SCREW_GAUGE] / 2;

/**
 * Where a knee rib stands so its two screws land on the member's centerline (D-76). The knee is square to the side, and where the side is turned in the bow taper (about 11 degrees
 * at the mid rib) the foot, which runs square to the side, drifts fore-aft as it goes inboard: sin(turn) x the distance from the band face, 0.28 in at the first screw and 0.40 in at
 * the second, against a 5/8" crossmember that leaves only 0.12" either side of its centerline. So when the screws would drift past that, the rib (and its knee) stands forward of
 * the member by the drift at the middle of the foot, and the two screws then sit within 1/16" of the member's centerline, centered across the knee. Squarer sides (the king beam
 * at the bow post, 3" thick, 0 degrees) and thick members keep the rib on the member's own x.
 */
export function kneeRibX(p: Params, L: Layout, xm: number, memberT: number): number {
  const dep = p.sideRibDepthIn, d = KNEE_SCREW_AT.map((f) => f * p.sideRibKneeLengthIn);
  const yawAt = (x: number) => Math.atan((L.turnIn(x + 0.25) - L.turnIn(x - 0.25)) / 0.5);
  const drift = (x: number) => d.map((di) => Math.abs(x - Math.sin(yawAt(x)) * (dep + di) - xm));
  if (Math.max(...drift(xm)) <= kneeScrewDriftLimitIn(memberT)) return xm;
  const dMid = d.reduce((a, b) => a + b, 0) / d.length;
  let x = xm;
  for (let i = 0; i < 8; i++) x = xm + Math.sin(yawAt(x)) * (dep + dMid);
  return x;
}

/** True when a rear storage box stands beside the gunwale at x with room for the rib and a spacer between them. */
function boxBeside(p: Params, L: Layout, x: number): boolean {
  if (p.storageLocation !== STORAGE_LOCATION.rearOverAxle) return false;
  const g = storageGeometry(p, L);
  return x > g.x0 + 1 && x < g.x1 && innerHalfWidth(L, x) - p.sideRibDepthIn - g.hw > 0.25;
}

/** The rib stations (D-76, D-85): box, mid, bow post, and the rear rib when a rear box stands beside it. The box rib falls back to a knee on the nearest joist when there is no rear box beside it (an under-seat box). */
export function sideRibStations(p: Params, L: Layout): RibStation[] {
  const g = storageGeometry(p, L);
  const make = (n: 1 | 2 | 3 | 4, kind: RibKind, x: number, member: string | null, memberT: number, memberX: number | null = null): RibStation => ({
    n, kind, x, member, memberT, memberX, top: sideTopAt(L, x), h: sideTopAt(L, x) - L.deckTop, yIn: innerHalfWidth(L, x), sideT: L.side,
    dTurn: (L.turnIn(x + 0.25) - L.turnIn(x - 0.25)) / 0.5, slope: sideSlopeAt(L, x),
  });
  const x1 = g.x1 - p.sideRibBoxInsetIn;
  const out: RibStation[] = [];
  if (boxBeside(p, L, x1)) out.push(make(1, 'box', x1, null, 0));
  else {
    // No rear box beside it (an under-seat box): a knee rib on the joist nearest the box's rear end, clear of the box (the knee reaches inboard over the deck).
    const avoid: [number, number] = [g.x0 - p.sideRibWidthIn - 0.5, g.x1 + p.sideRibWidthIn + 0.5];
    const m = nearestMember(L, Math.min(x1, g.x0 - 1), avoid);
    out.push(make(1, 'knee', kneeRibX(p, L, m.x, m.t), m.id, m.t, m.x));
  }
  const m2 = nearestMember(L, p.sideRibMidXIn, [-Infinity, L.seat.xFront + p.sideRibWidthIn / 2 + 0.125]); // ahead of the seat cushion: the knee reaches over the deck beside it
  out.push(make(2, 'knee', kneeRibX(p, L, m2.x, m2.t), m2.id, m2.t, m2.x));
  const m3 = nearestMember(L, p.sideRibFrontXIn);
  out.push(make(3, 'knee', kneeRibX(p, L, m3.x, m3.t), m3.id, m3.t, m3.x));
  // D-85: the rear rib, a box rib with the same spacer tie, a box-aft-end inset ahead of the flag tube's blocks. Last in the list so the other three keep their indexes; none in an under-seat design.
  const xr = g.x0 + p.sideRibRearInsetIn;
  if (boxBeside(p, L, xr) && x1 - xr >= p.sideRibHeadLengthIn + 0.25) out.push(make(4, 'box', xr, null, 0)); // heads at least 1/4 in apart (a short box)
  return out;
}

/** The box-tie spacer's z range (its top 1/8 in under the coaming, so it is glued to the box side, never to the lid frame, and under the rib head), and its y range. */
export function boxTieGeometry(p: Params, L: Layout, st: RibStation): { z0: number; z1: number; yBox: number; yRib: number } {
  const g = storageGeometry(p, L);
  const z1 = Math.min(g.zPlyTop - 0.125, sideTopAt(L, st.x) - L.railBand - 0.125); // under the coaming and under the rib head (the D-ring plate is on the head)
  return { z0: Math.max(L.deckTop + 0.5, z1 - p.boxTieHeightIn), z1, yBox: g.hw, yRib: st.yIn - p.sideRibDepthIn };
}

/**
 * The x range of the outside fender washers at a station (the reflectors and signs stay clear of it). The bolts are drilled square to the side, so where the side is turned the washers stand
 * a little forward of the rib: the bolts leave the outer face `sideT x cos(turn)` out along the normal, which moves x by that times sin(turn); the washer's own thickness adds to it.
 */
export function ribWasherSpan(st: RibStation): [number, number] {
  const yaw = Math.atan(st.dTurn), c = Math.cos(yaw);
  const shift = Math.sin(yaw) * (st.sideT * c + LASH_WASHER.t);
  const half = (LASH_HOLE_DX_IN + LASH_WASHER.od / 2) * c;
  return [st.x + shift - half, st.x + shift + half];
}

/** The bolt length for the D-ring stack: washer + side sandwich + head + plate + nylock + 2 threads, rounded up to a stock length (ONE fender washer a bolt, under the head; the nylock nut bears on the bracket). */
export function lashBoltLength(p: Params): { need: number; len: number } {
  const need = LASH_WASHER.t + p.sideThicknessIn + p.sideRibDepthIn + LASH_PLATE.thick + LASH_NYLOCK_IN + LASH_THREADS_PAST_IN;
  return { need, len: MACHINE_SCREW_LENGTHS.find((l) => l >= need - 1e-9) ?? MACHINE_SCREW_LENGTHS[MACHINE_SCREW_LENGTHS.length - 1] };
}

/** Knee screw fits and their distances from the rib face (D-72 standard sizes): through the counterbored knee and the deck into the member's top edge. */
export function kneeScrews(p: Params, L: Layout) {
  const d = KNEE_SCREW_AT.map((f) => f * p.sideRibKneeLengthIn);
  const fit = pickWoodScrew(KNEE_SCREW_GAUGE, KNEE_SCREW_SEAT_IN + L.ply, p.crossmemberDepthIn);
  return { d, fit, dia: SCREW_DIA_IN[KNEE_SCREW_GAUGE] };
}

/** A framing member in shop words: 'joist-5' -> 'joist 5', 'king-beam' -> 'the king beam'. */
const memberText = (id: string | null): string => (id === 'king-beam' ? 'the king beam' : id ? id.replace('-', ' ') : 'the deck');

const RIB_PART_NO: Record<1 | 2 | 3 | 4, string> = { 1: 'side-rib-box', 2: 'side-rib', 3: 'side-rib-bow', 4: 'side-rib-rear' };
const RIB_NAME: Record<1 | 2 | 3 | 4, string> = { 1: 'box rib', 2: 'mid rib', 3: 'bow post', 4: 'rear rib' };
/** The role of each station in a part name: "Rib knee, bow post, left" (so the cut list and the drawings group and read by role and side). */
const RIB_ROLE: Record<1 | 2 | 3 | 4, string> = { 1: 'box', 2: 'mid', 3: 'bow post', 4: 'rear' };

/** D-85: true when the sign's knobs screw into the box rib and the rear rib (a rear box beside both); otherwise the sign keeps its own two backing strips (an under-seat design). */
export function signKnobsInRibs(p: Params, L: Layout): boolean {
  const st = sideRibStations(p, L);
  return st.some((q) => q.n === 1 && q.kind === 'box') && st.some((q) => q.n === 4);
}

/** D-85: the sign backing strips go when the knobs are in the ribs. Called on the whole part list after the body and the ribs are built. */
export function dropSignBackers(p: Params, L: Layout, parts: Part[]): Part[] {
  return signKnobsInRibs(p, L) ? parts.filter((x) => !x.id.startsWith('sign-backer-')) : parts;
}

export function buildSideRibs(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const stations = sideRibStations(p, L);
  const w = p.sideRibWidthIn, dep = p.sideRibDepthIn, hl = p.sideRibHeadLengthIn, band = L.sideBand;
  const bolt = lashBoltLength(p);
  const ks = kneeScrews(p, L);
  const nRings = Math.max(0, Math.min(4, Math.round(p.lashPointsPerSide)));
  const zChineTop = L.chineBot + L.chineH;
  for (const { s, tag } of SIDES) {
    for (const st of stations) {
      const ribId = `side-rib-${tag}${st.n}`;
      const yaw = Math.atan(st.dTurn);
      // Local frame: ex along the side (forward on the left, aft on the right, so the frame stays right-handed), ey up, ez inboard.
      const sgnU = s; // +1 left, -1 right
      const ex: Vec3 = [sgnU * Math.cos(yaw), -Math.sin(yaw), 0];
      const ey: Vec3 = [0, 0, 1];
      const ez: Vec3 = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
      const o: Vec3 = [st.x, s * st.yIn, 0]; // on the inner band face at the station
      const xAt = (u: number) => st.x + ex[0] * u;
      const topAt = (u: number) => sideTopAt(L, xAt(u));
      const hbAt = (u: number) => topAt(u) - L.railBand;
      const nTop = 6;
      // The box rib is short (study option D): it starts at the bottom of its spacer, which is its base; the knee ribs run down to the deck.
      const zFoot = st.kind === 'box' ? boxTieGeometry(p, L, st).z0 : L.deckTop;
      const outline: Vec2[] = [
        [-w / 2, zFoot], [w / 2, zFoot], [w / 2, hbAt(w / 2)], [hl / 2, hbAt(hl / 2)],
        ...Array.from({ length: nTop + 1 }, (_, i): Vec2 => { const u = hl / 2 - (hl * i) / nTop; return [u, topAt(u)]; }),
        [-hl / 2, hbAt(-hl / 2)], [-w / 2, hbAt(-w / 2)],
      ];
      const freeWeb = Math.max(0, hbAt(0) - Math.max(zChineTop, zFoot));
      const fillerVol = w * band * freeWeb; // the band-strip filler behind the shaft between the bands (glued faces: no finish)
      const fillerLb = (fillerVol / 1728) * p.oakDensityPcf;
      // The back face is glued (to the bands and the filler), so it takes no finish (D-20).
      let backArea = 0;
      for (let i = 0; i < outline.length; i++) { const [a1, b1] = outline[i], [a2, b2] = outline[(i + 1) % outline.length]; backArea += a1 * b2 - a2 * b1; }
      const finishCredit = -(Math.abs(backArea) / 2 / 144) * p.finishLbPerFt2;
      // The D-ring bracket lies along the gunwale (it is tilted to the sheer, below), and it is the drilling template: its two holes follow the sheer slope, not the level.
      const sheerPhi = Math.atan2(topAt(0.5) - topAt(-0.5), 1);
      const holeAt: Vec3[] = [-1, 1].map((a): Vec3 => [a * LASH_HOLE_DX_IN * Math.cos(sheerPhi), topAt(0) - L.railBand / 2 + a * LASH_HOLE_DX_IN * Math.sin(sheerPhi), 0]);
      const hasRing = st.n === 2 ? nRings >= 1 : st.n === 1 ? nRings >= 2 : st.n === 3 ? nRings >= 3 : nRings >= 4;
      const baseText = st.kind === 'box'
        ? `Its base is the storage box: the box tie spacer is epoxied between its inner face and the box side${st.n === 4 ? ' near the aft corner, just ahead of the flag tube blocks' : ' near the fore corner (study option D)'}.${signKnobsInRibs(p, L) ? ' It also carries two of the sign\'s four knob inserts (D-85): bore them from its back, through the filler, with the web as the template, at the sign-fitting step.' : ''}`
        : `A knee is glued to its inner face and to the deck and screwed down through the deck into ${memberText(st.member)}.`;
      const rib = extPart(ctx, {
        id: ribId, partNo: RIB_PART_NO[st.n], name: `Side rib, ${RIB_ROLE[st.n]}, ${s > 0 ? 'left' : 'right'}`, group: 'body', mat: 'oak', step: STEP.seatStorage, grain: 'y', fab: 'bandsaw',
        outline, depth: dep, transform: frameMat(ex, ey, ez, o), center: [st.x, s * (st.yIn - dep / 2), (L.deckTop + st.top) / 2], extraLb: fillerLb + finishCredit,
        notes: `D-76: oak rib on the inside face of the ${s > 0 ? 'left' : 'right'} side at x = ${st.x.toFixed(1)}", ${frac(st.top - zFoot)}" tall (${st.kind === 'box' ? 'from the bottom of its box tie spacer' : 'from the deck'} to the gunwale top), bandsawn from a 4/4 offcut planed to ${frac(dep)}" (grain up the rib): a ${frac(w)}" wide shaft that widens to a ${frac(hl)}" head as tall as the gunwale band, its top cut to the sheer${Math.abs(st.dTurn) > 0.01 ? ` (the side draws in ${(yaw * 180 / Math.PI).toFixed(1)}° here; the rib stands square to it)` : ''}. It stands ${frac(dep)}" proud of the inner bands: its back sits on the inner chine and gunwale bands, and between them on a ${frac(w)}" wide filler of band strip (${frac(band)}" thick, grain up) glued to the web first, so the back is flat. Epoxy, full face, to the bands and the filler after the deck is in. ${baseText}${hasRing ? ' The head carries a D-ring bracket: at this step, before the finish, drill the two holes through the head and the side with the bracket as the template and seal the bores with epoxy; the bracket is bolted on at the hardware step.' : ''}`,
      });
      rib.joints = [
        { type: 'glue', to: `side-${tag}-web`, count: 1, at: [[0, (zFoot + st.top) / 2, 0]], size: `${frac(w)}" back face, epoxy`, note: `epoxy, full face: the head to the inner gunwale band${st.kind === 'box' ? '' : ', the foot to the inner chine band (and a fillet to the deck)'}, and between the bands to a ${frac(band)}" filler of band strip glued to the web first` },
      ];
      if (st.kind === 'knee') rib.joints.push({ type: 'glue', to: `side-rib-knee-${tag}${st.n}`, count: 1, at: [[0, L.deckTop + Math.min(p.sideRibKneeHeightIn, st.h - L.railBand - 0.25) / 2, dep]], size: `${frac(Math.min(p.sideRibKneeHeightIn, st.h - L.railBand - 0.25))}" x ${frac(w)}" knee face, epoxy` });
      if (hasRing) rib.joints.push({ type: 'hole', to: `lash-${tag}${st.n}`, count: LASH_BOLTS, size: `${frac64(LASH_BOLT_DIA_IN + 1 / 64)}" (1/4-20 clearance) through the head, the inner band, the web and the outer band`, at: holeAt.map((q) => [q[0], q[1], dep / 2] as Vec3), note: 'drilled at the rib-fitting step (before the finish), with the D-ring bracket clamped on as the template, square to the side; seal the bores with epoxy before the finish. The bracket is bolted on later, at the hardware step' });
      parts.push(rib);

      // ── The base: the box tie, or a knee on the member under it ──
      if (st.kind === 'box') {
        const tg = boxTieGeometry(p, L, st);
        const tie = box(ctx, {
          id: `box-tie-${tag}${st.n === 4 ? '4' : ''}`, partNo: 'box-tie', name: `Box tie spacer, ${st.n === 4 ? 'rear, ' : ''}${s > 0 ? 'left' : 'right'}`, group: 'body', mat: 'oak', step: STEP.seatStorage, grain: 'z', fab: 'bandsaw',
          size: [p.boxTieWidthIn, tg.yRib - tg.yBox, tg.z1 - tg.z0], center: [st.x, s * ((tg.yRib + tg.yBox) / 2), (tg.z0 + tg.z1) / 2],
          notes: `D-76 (study option D): an oak spacer ${frac(p.boxTieWidthIn)}" x ${frac(tg.yRib - tg.yBox)}" x ${frac(tg.z1 - tg.z0)}" (grain up) filling the gap between the box rib and the storage box side, ${frac(tg.z1 - L.deckTop)}" above the deck at its top: 1/8" under the coaming, so it is glued to the box side and never to the lid frame, which moves. Epoxy both faces when the box goes in (thickened epoxy takes up the fit). It makes the box the rib's base: a push on the gunwale here goes into the box's fore corner, in the plane of the box end.${st.n === 4 ? ' (The rear rib\'s spacer does the same at the aft end, in the plane of the aft box end.)' : ''}`,
          joints: [
            { type: 'glue', to: `storage-side-${tag}`, count: 1, at: [[0, 0, 0]], size: `${frac(p.boxTieWidthIn)}" x ${frac(tg.z1 - tg.z0)}" faces, thickened epoxy`, note: 'both faces: to the box side and to the box rib' },
          ],
        });
        tie.massLb -= (2 * p.boxTieWidthIn * (tg.z1 - tg.z0) / 144) * p.finishLbPerFt2; // both faces glued
        parts.push(tie);
      } else {
        const kh = Math.min(p.sideRibKneeHeightIn, st.h - L.railBand - 0.25), kl = p.sideRibKneeLengthIn;
        // Knee: a right triangle in (inboard, up), extruded fore-aft. Local frame: ex inboard, ey up, ez = ex x ey (fore-aft); centered on the member.
        const kx: Vec3 = ez, ky: Vec3 = [0, 0, 1];
        const kz: Vec3 = [kx[1] * ky[2] - kx[2] * ky[1], kx[2] * ky[0] - kx[0] * ky[2], kx[0] * ky[1] - kx[1] * ky[0]];
        const ko: Vec3 = [o[0] + ez[0] * dep - kz[0] * (w / 2), o[1] + ez[1] * dep - kz[1] * (w / 2), 0];
        const kOutline: Vec2[] = [[0, L.deckTop], [kl, L.deckTop], [0, L.deckTop + kh]];
        const kneeId = `side-rib-knee-${tag}${st.n}`;
        const memberName = memberText(st.member);
        const screwAt: Vec3[] = ks.d.map((d): Vec3 => [d, L.deckTop + KNEE_SCREW_SEAT_IN, w / 2]);
        const knee = extPart(ctx, {
          id: kneeId, partNo: 'side-rib-knee', name: `Rib knee, ${RIB_ROLE[st.n]}, ${s > 0 ? 'left' : 'right'}`, group: 'body', mat: 'oak', step: STEP.seatStorage, grain: 'y', fab: 'bandsaw',
          outline: kOutline, depth: w, transform: frameMat(kx, ky, kz, ko), center: [st.x, s * (st.yIn - dep - kl / 2), L.deckTop + kh / 3],
          notes: `D-76: a ${frac(w)}" oak knee, ${frac(kh)}" up the rib and ${frac(kl)}" along the deck (grain up), ${st.memberX !== null && Math.abs(st.x - st.memberX) > 1e-3 ? `its two screws on the centerline of ${memberName} under the deck (the side is turned ${(yaw * 180 / Math.PI).toFixed(1)}° here and the knee is square to it, so the rib stands ${frac(Math.abs(st.x - st.memberX))}" ${st.x > st.memberX ? 'ahead of' : 'behind'} the member's centerline; the screws fall within ${frac(Math.max(...ks.d.map((d) => Math.abs(st.x - Math.sin(yaw) * (dep + d) - (st.memberX as number)))))}" of it)` : `centered on ${memberName} under the deck`}. Epoxy it to the rib's inner face and to the deck, then drive ${ks.d.length} ${screwText(ks.fit)} stainless screws straight down through it and the deck into the top edge of ${memberName}, ${ks.d.map((d) => frac(d)).join('" and ')}" from the rib face, each in a ${frac(KNEE_CBORE_DIA_IN)}" counterbore from the sloped face that leaves ${frac(KNEE_SCREW_SEAT_IN)}" of oak under the head. The toe screws hold the knee down when the gunwale is pushed outward (side-lateral row).`,
        });
        knee.massLb -= ((kh + kl) * w / 144) * p.finishLbPerFt2; // the two glued faces take no finish
        knee.joints = [
          { type: 'glue', to: ribId, count: 1, at: [[0, L.deckTop + kh / 2, w / 2]], size: `${frac(kh)}" x ${frac(w)}" face to the rib and ${frac(kl)}" x ${frac(w)}" foot to the deck, epoxy` },
          { type: 'screw', to: st.member!, count: ks.d.length, size: `${screwText(ks.fit)} stainless, down through the knee and the deck into ${memberName}`, diaIn: ks.dia, fit: ks.fit, at: screwAt },
          { type: 'hole', to: st.member!, count: ks.d.length, at: ks.d.map((d): Vec3 => [d, L.deckTop + kh * (1 - d / kl), w / 2]), cut: { kind: 'counterbore', dia: KNEE_CBORE_DIA_IN, depth: Math.max(0, kh * (1 - ks.d[0] / kl) - KNEE_SCREW_SEAT_IN), what: 'the screw heads, leaving 1/2" of oak under each (the deeper one is the nearer screw)' } },
        ];
        parts.push(knee);
      }

      // ── The D-ring plate on the head's inner face ──
      if (!hasRing) continue;
      const zc = st.top - L.railBand / 2;
      const T = LASH_PLATE.folded;
      const cyIn = st.yIn - dep - T / 2;
      const side = s > 0 ? 'left' : 'right';
      const role = RIB_ROLE[st.n];
      // Local frame (the viewer's lash-plate convention): x along the gunwale, y up the head, z inboard off the head face (the plate lies at -z, the ring stands at +z).
      const rot = { z: -s * yaw, ...(Math.abs(st.slope) > 1e-9 ? { y: st.slope } : {}), x: (s * Math.PI) / 2 };
      const ring = box(ctx, {
        id: `lash-${tag}${st.n}`, partNo: 'lash-point', name: `Lash point, ${role}, ${side}`, group: 'hardware', mat: 'fixed', massLb: LASH_MASS_LB, kind: 'purchased',
        material: `${dRingMat(p)} cargo D-ring on a 2-hole strap bracket`, fab: 'buy', step: STEP.finish, size: [LASH_PLATE.len, LASH_PLATE.tall, T], center: [st.x, s * cyIn, zc], rot,
        sourcing: p.weatherSpec === WEATHER_SPEC.extreme
          ? { vendor: `ESTIMATE: ${dRingMat(p)} bolt-on D-ring, 2-hole bracket, about the same working load (marine hardware supplier)`, costUsd: 12 }
          : { vendor: `Harbor Freight (1/4" cargo D-ring, 2-pack #60319, zinc-plated, 233 lbf working load)`, costUsd: 1.5 },
        notes: `D-76, D-83: on the inner face of the ${RIB_NAME[st.n]}'s head, through-bolted: ${LASH_BOLTS} 1/4-20 x ${frac(bolt.len)}" ${stainless(p)} button-head bolts from OUTSIDE (a ${frac(LASH_WASHER.od)}" fender washer under each head on the outer band), through the side sandwich and the head, with a nylock nut on the bracket inside, no washer under the nut (one fender washer a bolt: 12 for the six D-rings; stack ${bolt.need.toFixed(2)}" with the nut and two threads). The bracket (about ${LASH_PLATE.len}" x ${LASH_PLATE.tall}", holes ${2 * LASH_HOLE_DX_IN}" apart) is the drilling template: VERIFY the real bracket's holes before drilling. At the rib-fitting step, before the finish, clamp it on and drill the two holes through the head and the side, then seal the bores; it is bolted on at the hardware step. Rated ${p.lashLoadLbf} lbf working load for tie-down straps on coolers, duffels and firewood (D-76); the lash-load row pulls it at ${p.lashLoadLbf} lbf and ${p.lashPullAngleDeg}°. In race mode the ring folds flat against the head.`,
        joints: [{
          type: 'bolt', to: ribId, count: LASH_BOLTS, size: `1/4-20 x ${frac(bolt.len)}" ${stainless(p)} button-head bolt, ${frac(LASH_WASHER.od)}" fender washer under the head outside (one washer a bolt), nylock nut on the bracket inside with no washer under the nut`, diaIn: LASH_BOLT_DIA_IN,
          at: [-1, 1].map((a): Vec3 => [a * LASH_HOLE_DX_IN, 0, -T / 2]), // on the bracket face against the head
          note: `through the head, the inner gunwale band, the web and the outer gunwale band (${side} side, x = ${st.x.toFixed(1)}"); drill with the bracket as the template`,
        }],
      });
      parts.push(ring);
    }
  }
  return parts;
}

/**
 * The other ends of the rib joints (D-76), after the joinery pass so nothing overwrites them: the web lists its glued ribs, and each joist or king beam under a knee
 * records its own end of the knee screws, at points in its own top edge (so the drawings never draw another part's points, D-75 audit).
 */
export function addSideRibJoints(ctx: Ctx, parts: Part[]): void {
  const { p, L } = ctx;
  const byId = new Map(parts.map((x) => [x.id, x]));
  addSignKnobJoints(ctx, byId);
  for (const { tag } of SIDES) {
    for (const st of sideRibStations(p, L)) {
      const ribId = `side-rib-${tag}${st.n}`;
      const web = byId.get(`side-${tag}-web`);
      const rib = byId.get(ribId);
      if (web && rib) (web.joints ??= []).push({ type: 'glue', to: ribId, count: 1, at: [localOf(web.transform, transformPoint(rib.transform, rib.joints![0].at![0]))], size: `${frac(p.sideRibWidthIn)}" rib back, epoxy`, note: 'through the band-strip filler (D-76)' });
      if (st.kind !== 'knee' || !st.member) continue;
      const mem = byId.get(st.member), kneeId = `side-rib-knee-${tag}${st.n}`;
      if (!mem || !byId.has(kneeId)) continue;
      const knee = byId.get(kneeId)!;
      const kj = knee.joints!.find((j) => j.type === 'screw')!;
      const at: Vec3[] = kj.at!.map((a) => { const w = transformPoint(knee.transform, a); return localOf(mem.transform, [w[0], w[1], L.deckBot - 0.25]); });
      (mem.joints ??= []).push({ ...kj, to: kneeId, at, cut: undefined, note: `the knee's screws, driven down through the deck into this member's top edge (D-76)` });
    }
  }
}

/** Model point -> a part's local frame (the inverse of its rigid transform). */
function localOf(m: number[], q: Vec3): Vec3 {
  const d = [q[0] - m[12], q[1] - m[13], q[2] - m[14]];
  return [0, 1, 2].map((c) => (d[0] * m[c * 4] + d[1] * m[c * 4 + 1] + d[2] * m[c * 4 + 2]) / (m[c * 4] ** 2 + m[c * 4 + 1] ** 2 + m[c * 4 + 2] ** 2)) as Vec3;
}

/**
 * D-85: the sign's four knobs screw through the thin web into threaded inserts in the rear rib (the two rear knobs) and the box rib (the two front ones), at the ribs' own x. The insert hole is bored
 * from OUTSIDE, through the web, into the band-strip filler and the rib behind it, and the insert's top sits flush with the web's INSIDE face: its threads are all in oak (filler and rib, glued),
 * and the knob screw engages it over `signKnobPlan().engagedIn` (about 0.27 in, 8 threads of #10-32). (With no rear box the sign keeps its backing strips and joinery.ts writes these joints.)
 */
function addSignKnobJoints(ctx: Ctx, byId: Map<string, Part>): void {
  const { p, L } = ctx;
  if (!signKnobsInRibs(p, L)) return;
  const st = sideRibStations(p, L);
  const colRear = st.find((q) => q.n === 4)!.x, colFront = st.find((q) => q.n === 1)!.x;
  const sg = signPlacement(ctx), { dz } = signBackerPlan(ctx), kn = signKnobPlan(ctx);
  const ribDepth = (rib: Part): number => (rib.geometry.type === 'extrusion' ? rib.geometry.depth : 0.75);
  const sizeA = (rib: Part) => `#10-32 × ${kn.lenIn} in thumb-knob screw through a 7/32 clearance hole (0.219) in the sign, a ${kn.standoffIn.toFixed(3)}" oak standoff disc (epoxied to the sign back) and the ${thinSheet(p).nominal} web: ${kn.engagedIn.toFixed(2)}" into the insert, tip ${(L.sideBand + ribDepth(rib) - kn.engagedIn).toFixed(2)}" short of the back of the rib`;
  const sizeB = `#10-32 × 5/16 ${insertMat(p)} threaded insert (epoxied) in a blind ${frac(INSERT_DRILL_IN)} in hole bored from outside through the web into the band-strip filler and the oak rib, the insert's top flush with the web's inside face (its threads all in oak), so the hole runs ${frac(Math.max(1 / 16, SIGN_INSERT_LEN_IN + 1 / 16 - L.sideBand))}" deep in the rib behind the filler`;
  for (const { s, tag } of SIDES) {
    const sign = byId.get(`sign-${tag}`);
    if (!sign) continue;
    for (const [col, ribN] of [[colRear, 4], [colFront, 1]] as const) {
      const rib = byId.get(`side-rib-${tag}${ribN}`);
      if (!rib) continue;
      const world: Vec3[] = [-dz, dz].map((dzi): Vec3 => [col, s * (L.hwC + L.side + SIGN_PROUD_IN + thinSheet(p).thicknessIn / 2), sg.zc + dzi]);
      const mouth: Vec3[] = world.map((q): Vec3 => [q[0], s * (st.find((r) => r.n === ribN)!.yIn + L.sideBand), q[2]]); // the web's inside face: the rib's back face plus the band-strip filler
      (sign.joints ??= []).push({ type: 'knob', to: rib.id, count: 2, size: sizeA(rib), at: world.map((q) => localOf(sign.transform, q)), note: 'Sign comes off for transport (D-9). The screw goes through the web into the oak rib; nothing grips the thin ply alone (D-62, D-85).' });
      (rib.joints ??= []).push({ type: 'threaded-insert', to: sign.id, count: 2, size: sizeB, at: mouth.map((q) => localOf(rib.transform, q)), note: 'Sign comes off for transport (D-9). The screw goes through the web into the oak rib; nothing grips the thin ply alone (D-62, D-85).' });
    }
  }
}
