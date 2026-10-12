/**
 * Seat (D-3, D-9, D-18, D-40, D-57): a closed-cell foam cushion with a marine-vinyl cover on the deck, a full-size reclined back (oak stiles and rails joined with Dominos, a ply
 * panel captured in grooves, a covered foam pad that comes off with Dual Lock), a pair of grab boards bolted to the side tops. (D-60: the drop-in foot block and its slot cleats were dropped; the bow bulkhead is the foot brace.)
 *
 * D-57: the back is HINGED at its front foot (two 316 butt hinges screwed through the deck into a backer) and FLIPS FORWARD onto the deck for cargo; it never goes in the box.
 * Upright it leans back onto two fixed oak stop blocks ("wedges") glued against the storage box end; a 3/8" quick-release pin per stile through the stile into the stop block
 * holds it up, and the same pin through the same hole into the deck holds it flat. The pad and the cushion are the "cushions" that lie in the box in cargo mode.
 */
import { RIDER_PELVIS_Z_FRAC, STORAGE_LOCATION, type Params } from '../params';
import { STEP, box, cylinder, span, SIDES, type Ctx } from './build-utils';
import { innerHalfWidth, sideSlopeAt, sideTopAt, type Layout } from './layout';
import { chooseDomino, DOMINOS, type DominoQuery } from './joinery';
import { profilePart, signedArea } from './profile';
import type { Joint, Part, Vec2, Vec3 } from './types';

// ── Detail dimensions and purchased-part estimates (D-18, D-40) ──
/** Closed-cell foam density used for the cushion and the back pad (estimate, D-18). */
const FOAM_DENSITY_PCF = 4.5;
export const BACK_PAD_THICK_IN = 1;
/** Marine vinyl cover: 24 oz per 54" yard ≈ 0.11 lb/ft² (estimate). */
const VINYL_LB_PER_FT2 = 0.11;
/** Gap between the pelvis top and the start of the back pad. */
const PAD_GAP_IN = 0.25;
/** Riser runner width (across). */
const RISER_RUNNER_IN = 1.5;
/** The cushion's rear edge is set back this far from the stile front so the knob heads clear it. */
export const CUSHION_CLEAR_IN = 0.375;
/**
 * Quick-release pin (3/8 in, 316 stainless, with lanyard): radius, usable length, mass; one per stile. Build 3c S4: 2-1/4 in usable (the flat position needs stile 0.75 + deck 0.472 + backer 0.75 = 1.97 in,
 * the 1-3/4 in pin did not reach through); it is a spring-detent pin, because a ball-lock pin only retains where its balls clear the far side of a THROUGH hole and the upright hole in the stop
 * block is blind (the block is glued to the box end): the ball seats in a 1/16 in annular groove cut in the blind hole.
 */
export const PIN_R_IN = 0.1875;
export const PIN_LEN_IN = 2.25;
/** Height (along the back) of the full-width oak crest strip the frameless seat back leans on (D-62). */
export const CREST_STRIP_IN = 1.5;
const PIN_MASS_LB = 0.06;
/** 316 butt hinge (leaves screwed to the back's front face and, through the deck, to a backer): knuckle length across, knuckle radius, mass. */
export const HINGE_LEN_IN = 2;
export const HINGE_R_IN = 0.125;
const HINGE_MASS_LB = 0.1;
/** Height of the support (oak post) behind the back when the box is not behind it, along the back; and its crest thickness. */
export const SEAT_POST_HEIGHT_IN = 4.5;
const POST_CREST_IN = 0.75;
/** The wedge crest sits this far below the lid top so the stile never touches the lid frame. */
const WEDGE_BELOW_LID_IN = 1;
/** A rear box is never lower than this (top above the deck), so the seat-back backers and the hinge backers fit inside it. */
export const MIN_REAR_BOX_H_IN = 3.4;
/** Grab board (D-57): starts this far behind the H-point (hands rest at the hips), bolts through the gunwale (two 1/4" carriage bolts), top corners rounded. */
export const GRIP_BEHIND_HPOINT_IN = 5;
export const GRIP_BOLT_DIA_IN = 0.25;
/** Fender washer under each nut, on the oak board (the bearing check of the grab board). */
export const GRIP_WASHER_OD_IN = 1.25;
export const GRIP_BOLT_COLS = 3;
/** The two bolt rows, this far below the gunwale top (the lower stays above the web groove): the pull is resisted by the couple between them (grab-board row). */
export const GRIP_BOLT_ROWS_IN = [0.4, 1] as const;
export const GRIP_BOLTS = GRIP_BOLT_COLS * GRIP_BOLT_ROWS_IN.length;
const GRIP_CORNER_IN = 0.75;

/**
 * Joint for a light, non-structural-path frame member (seat-back frame, lid frame, grip posts): the largest Domino that chooseDomino
 * accepts with the light-frame edge margin (`dominoEdgeLightIn`), else a blind stub tenon. Single source for those joints (build M1).
 */
export function frameJoint(p: Params, to: string, q: DominoQuery, opts: { count?: number; note?: string } = {}): Joint {
  const d = chooseDomino({ ...p, dominoEdgeIn: p.dominoEdgeLightIn }, q);
  const count = opts.count ?? 1;
  if (d) return { type: 'domino', to, count, size: `${d.name} (${d.tool})`, note: opts.note };
  return { type: 'mortise-tenon', to, count, size: '3/8 × 3/4 × 1/2 deep blind tenon (routed mortise, shaped tenon)', note: opts.note };
}
/** Longest Domino length (mm) in the catalog, for the tests that confirm a joint's Domino really fits its member. */
export const DOMINO_LENGTH_MM: Readonly<Record<string, number>> = Object.fromEntries(DOMINOS.map((d) => [d.name, d.lMm]));

/** Corner radius actually used for a rounded rectangle `w` × `h` (D-44): capped at a third of the smaller side. */
const padRadius = (w: number, h: number, r: number) => Math.max(0, Math.min(r, w / 3, h / 3));
const PAD_CORNER_SEGMENTS = 6;
/** Rounded rectangle centered on x = 0, spanning y = 0..h, CCW (D-44). */
function roundedRect(w: number, h: number, r: number): Vec2[] {
  const rr = padRadius(w, h, r);
  if (rr < 1e-6) return [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]];
  const out: Vec2[] = [];
  const corners: Array<[number, number, number]> = [[w / 2 - rr, rr, -Math.PI / 2], [w / 2 - rr, h - rr, 0], [-w / 2 + rr, h - rr, Math.PI / 2], [-w / 2 + rr, rr, Math.PI]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= PAD_CORNER_SEGMENTS; i++) {
    const a = a0 + (Math.PI / 2) * (i / PAD_CORNER_SEGMENTS);
    out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return out;
}

const unit = (x: number, y: number, z: number): Vec3 => {
  const n = Math.hypot(x, y, z) || 1;
  return [x / n, y / n, z / n];
};

/** Gunwale member name the grips / lash points bolt to (cabin side), by construction (body.ts ids). */
export function gunwaleId(_p: Params, tag: 'L' | 'R'): string {
  return `side-${tag}-gunwale`;
}

/** Y of the gunwale centerline (|y|). */
export const gunwaleY = (L: Layout): number => L.hwC + L.side / 2;
/** Sorted y range (for `span`) of a block of thickness `t` against the inboard face of a gunwale whose inner face is at |y| = `yInner` on side `sg`. */
export const inboardOf = (sg: 1 | -1, yInner: number, t: number): [number, number] => (sg > 0 ? [yInner - t, yInner] : [-yInner, -yInner + t]);

export interface SeatBackSupport {
  /** True when the storage box sits behind the back (rear over axle): the stop blocks bear against the box end. */
  rear: boolean;
  a: number;
  W: number;
  H: number;
  t: number;
  fw: number;
  /** |y| of each stile centerline (the hinge, the pin and the stop block of a side are on it). */
  stileY: number;
  /** Distances along the back from the stile foot (rear-bottom corner): the stop-block crest, the hinge (the front foot: 0) and the latch pin. */
  c2A: number;
  c2B: number;
  c2L: number;
  /** Stop-block outline in world (x, z), CCW: bottom-aft, bottom-front, crest-front, crest-aft. */
  wedge: Vec2[];
  xv: number;
  zb: number;
  /** Rear box only: the box top (lid top) and its fore end, cut back so the box never meets the leaning back above the layout height. */
  boxZTop: number;
  boxX1: number;
}

/** Support geometry behind the seat back, shared by the model (seat, storage), the stow and the seat-back check. */
export function seatBackSupport(p: Params, L: Layout): SeatBackSupport {
  const s = L.seat;
  const a = (p.seatBackAngleDeg * Math.PI) / 180;
  const t = p.seatBackThickIn;
  const fw = p.seatBackFrameWidthIn;
  const H = p.seatBackHeightIn;
  const W = Math.max(2 * fw + 0.5, Math.min(p.seatBackWidthIn, 2 * L.hwC - 1));
  const stileY = W / 2 - fw / 2;
  const rear = p.storageLocation === STORAGE_LOCATION.rearOverAxle;
  const [, , c2z] = s.col2;
  const c2x = s.col2[0];
  const xf = (c2: number) => s.Pr[0] + c2x * c2;
  const st = L.storage;
  const boxZTop = Math.max(st.zTop, st.zBot + 3 * p.panelPlyIn + p.storageLidRimThickIn + p.storageGasketIn, rear ? st.zBot + MIN_REAR_BOX_H_IN : 0);
  const faceXAt = (z: number) => xf((z - s.Pr[2]) / c2z);
  const boxX1 = rear ? Math.min(Math.max(st.x0 + 0.5, st.x1), faceXAt(boxZTop) - 0.15) : st.x1; // 0.15 in off the leaning panel: the lid hinges stand 0.12 in proud of the box end and the frameless panel (D-62) now passes over them
  // The hinge is the stile's front foot (c2 = 0 along the back); the latch pin sits `seatBackLatchHeightIn` up.
  const c2B = 0;
  let c2A = SEAT_POST_HEIGHT_IN;
  if (rear) c2A = (boxZTop - WEDGE_BELOW_LID_IN - s.Pr[2]) / c2z;
  c2A = Math.min(Math.max(c2A, p.seatBackLatchHeightIn + 1), p.seatBackHeightIn - 2);
  // Rear box: the crest must stand at least 0.15" off the box end (the stile face meets the end at the lid top), so lower it if the lean is small.
  if (rear && Math.abs(c2x) > 0.05 && xf(c2A) - boxX1 < 0.15) {
    c2A = Math.min(Math.max((boxX1 + 0.15 - s.Pr[0]) / c2x, p.seatBackLatchHeightIn + 1), c2A);
  }
  const c2L = Math.min(p.seatBackLatchHeightIn, c2A - 0.75);
  const zb = s.pan;
  const c2b = (zb - s.Pr[2]) / c2z;
  const zA = s.Pr[2] + c2z * c2A;
  const xA = xf(c2A);
  // Aft face is the box end (rear) or a vertical face POST_CREST behind the crest (post).
  const xv = rear ? Math.min(boxX1, xA - 0.02) : xA - POST_CREST_IN;
  const wedge: Vec2[] = [[xv, zb], [xf(c2b), zb], [xA, zA], [xv, zA]];
  return { rear, a, W, H, t, fw, stileY, c2A, c2B, c2L, wedge, xv, zb, boxZTop, boxX1 };
}

/** Where the seat-back hinges sit: the knuckle axis is the stile's front foot P, along y. Returns the x interval under the deck that is free of joists for the screw backer (D-57). */
export function hingeBacker(_p: Params, L: Layout): { x0: number; x1: number } {
  const w = 3;
  const px = L.seat.P[0];
  const clash = (a: number) => L.joistX.some((jx) => jx + L.joistT / 2 + 0.2 > a && jx - L.joistT / 2 - 0.2 < a + w);
  // Try a window centered a little ahead of P, then slide it by half-inches either way until it clears every joist.
  for (let d = 0; d <= 8; d += 0.5) for (const sgn of [1, -1]) {
    const a = px - 0.5 + sgn * d;
    if (!clash(a)) return { x0: a, x1: a + w };
  }
  return { x0: px - 0.5, x1: px - 0.5 + w };
}

export function buildSeat(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const s = L.seat;
  const parts: Part[] = [];
  const hw = s.width / 2;
  const foam = (volIn3: number) => (volIn3 / 1728) * FOAM_DENSITY_PCF;
  const vinyl = (areaIn2: number) => (areaIn2 / 144) * VINYL_LB_PER_FT2;
  const sup = seatBackSupport(p, L);
  const { a, H, t, fw, W } = sup;
  const plyT = Math.min(p.seatBackPlyIn, t); // D-60: the seat-back panel keeps its own ply (6 mm) when the sides, box and lid go to 4 mm

  // Optional riser: two oak runners under the cushion (default 0 = cushion on the deck).
  const riser = s.cushionBottom - s.pan;
  if (riser > 0.01) {
    for (const { s: sg, tag } of SIDES) {
      const y = sg * (hw - RISER_RUNNER_IN / 2);
      parts.push(box(ctx, {
        id: `seat-riser-${tag}`, partNo: 'seat-riser', name: `Seat riser runner ${tag}`, group: 'seat', mat: 'oak', step: STEP.seatStorage, grain: 'x',
        ...span([s.xRear, s.xFront], [y - RISER_RUNNER_IN / 2, y + RISER_RUNNER_IN / 2], [s.pan, s.cushionBottom]),
        joints: [{ type: 'glue', to: s.pan > L.deckTop + 0.01 ? 'storage-lid' : 'deck', count: 1, note: 'epoxy + 3 × #8 stainless screws up through the deck' }],
      }));
    }
  }

  // Cushion: 2" closed-cell foam, marine-vinyl cover with four drain grommets (D-18). Held by Dual Lock strips so it lifts off for hauling.
  const cx0 = s.xRear + CUSHION_CLEAR_IN;
  const cushionVol = (s.xFront - cx0) * s.width * p.seatCushionIn;
  const cushionCover = 2 * (s.xFront - cx0) * s.width + 2 * (s.xFront - cx0 + s.width) * p.seatCushionIn;
  parts.push(box(ctx, {
    id: 'seat-cushion', name: 'Seat cushion', group: 'seat', mat: 'fixed', massLb: foam(cushionVol) + vinyl(cushionCover), kind: 'purchased',
    material: 'closed-cell foam, marine-vinyl cover', fab: 'buy', step: STEP.seatStorage, ...span([cx0, s.xFront], [-hw, hw], [s.cushionBottom, s.surface]),
    sourcing: { vendor: 'Closed-cell polyethylene foam (McMaster-Carr / Foam Factory); marine vinyl (Sailrite / Hancock); sewn in-house', costUsd: 55 },
    notes: 'Sits directly on the deck (or the storage lid / riser) on Dual Lock strips. Four drain grommets in the cover. Set back 3/8" from the back so the hinge knuckles clear it (D-40, D-57). Mass is an estimate (foam + cover, D-18). Cargo mode (D-57): peel it off the Dual Lock by hand and lay it flat in the storage box with the back pad (the strips stay on the deck, 0.1" proud: the bed is flat).',
  }));

  // Seat back (D-62, Eric 2026-10-12): a FRAMELESS 1/2 in (12 mm) okoume panel cut from the deck sheet's offcut, no oak stiles or rails. Its front face passes through P and it leans back by
  // seatBackAngleDeg. The hinges and the two quick-release pin holes sit at the same two stations (`stileY`) as before, fastened directly to the panel with epoxied threaded inserts and
  // clearance holes; the edge is banded with 1/16 in oak veneer (no exposed ply edge). A thin full-width oak CREST STRIP between the two stop blocks lets the bare panel lean on a
  // continuous line instead of spanning 14.75 in between two blocks (the seat-back row checks both).
  const at = (c0: number, c2: number, y = 0): Vec3 => [s.P[0] + s.col0[0] * c0 + s.col2[0] * c2, y, s.P[2] + s.col0[2] * c0 + s.col2[2] * c2];
  const pinZ = sup.c2L;
  {
    const rTop = Math.min(p.seatBackCornerRadiusIn, W / 3, H / 3);
    const rBot = 0.5; // small bottom corners: the hinge leaf and the pin station sit near them
    const corners: Array<[number, number, number, number]> = [[W / 2 - rBot, rBot, -Math.PI / 2, rBot], [W / 2 - rTop, H - rTop, 0, rTop], [-W / 2 + rTop, H - rTop, Math.PI / 2, rTop], [-W / 2 + rBot, rBot, Math.PI, rBot]];
    const outline: Vec2[] = [];
    for (const [cx, cy, a0, rr] of corners) for (let i = 0; i <= PAD_CORNER_SEGMENTS; i++) {
      const ang = a0 + (Math.PI / 2) * (i / PAD_CORNER_SEGMENTS);
      outline.push([cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)]);
    }
    const area = signedArea(outline);
    const perim = outline.reduce((m, q, i) => m + Math.hypot(outline[(i + 1) % outline.length][0] - q[0], outline[(i + 1) % outline.length][1] - q[1]), 0);
    const o = at(-plyT, 0);
    const bandLb = (perim * 0.0625 * plyT / 1728) * p.oakDensityPcf; // 1/16 in oak edge veneer
    const mass = (area * plyT / 1728) * ctx.d.plyDensityPcf + (2 * area / 144) * p.finishLbPerFt2 + bandLb;
    parts.push({
      id: 'seat-back-panel', partNo: 'seat-back-panel', name: 'Seat back panel (frameless, 12 mm okoume)', group: 'seat', kind: 'sheet', material: ctx.plyName,
      geometry: { type: 'extrusion', outline, depth: plyT },
      transform: [0, 1, 0, 0, s.col2[0], 0, s.col2[2], 0, s.col0[0], 0, s.col0[2], 0, o[0], o[1], o[2], 1],
      body: 'chassis', massLb: mass, edges: 'edged', grain: 'z', fab: 'shaper-origin', step: STEP.seatStorage, explode: unit(-0.5, 0, 0.6),
      stock: { t: plyT, w: Math.min(W, H) + 0.25, l: Math.max(W, H) + 0.25 },
      joints: [
        { type: 'screw', to: 'seat-hinge-L', count: 3, diaIn: 0.19, size: '3 × #10-32 × 3/8 316 threaded inserts (hex-drive, epoxied) in blind holes from the front face, 1/2 in or more from every edge', note: 'hinge leaf on the front face at the foot (no screw into a ply edge)' },
        { type: 'screw', to: 'seat-hinge-R', count: 3, diaIn: 0.19, size: '3 × #10-32 × 3/8 316 threaded inserts (hex-drive, epoxied) in blind holes from the front face, 1/2 in or more from every edge', note: 'hinge leaf on the front face at the foot (no screw into a ply edge)' },
        { type: 'pin', to: 'seat-pin-L', count: 1, diaIn: 2 * PIN_R_IN, size: '13/32 clearance hole through the panel, square to the face; epoxy-sealed bore', note: `${pinZ.toFixed(2)}" up from the foot at station y = ±${sup.stileY.toFixed(2)}": upright into the stop block, flat into the deck` },
        { type: 'pin', to: 'seat-pin-R', count: 1, diaIn: 2 * PIN_R_IN, size: '13/32 clearance hole through the panel, square to the face; epoxy-sealed bore', note: `${pinZ.toFixed(2)}" up from the foot at station y = ±${sup.stileY.toFixed(2)}": upright into the stop block, flat into the deck` },
        { type: 'glue', to: 'seat-back-pad', count: 1, size: 'Dual Lock strips on the face', note: 'the pad peels off by hand (D-57)' },
      ],
      notes: `FRAMELESS seat back (D-62, Eric 2026-10-12): a ${(plyT * 25.4).toFixed(0)} mm (1/2 in) okoume panel, ${W}" × ${H}", cut from the offcut of the deck sheet on the Shaper Origin (no 6 mm sheet is bought), top corners ${rTop.toFixed(2)}" radius, bottom corners 1/2". It replaces the oak stiles, rails and 6 mm panel (3/4 in thick frame). Edge: 1/16" oak veneer banding all round (contact cement or iron-on), ironed and flush-trimmed, then epoxy-sealed with the rest, so no ply edge shows. The hinges and the two latch pins sit at stations ${sup.stileY.toFixed(2)}" either side of the center line: the hinge leaves are held by 3 stainless #10-32 threaded inserts each, epoxied into blind holes in the FRONT face (never into a ply edge), the pin holes are 13/32" clearance holes bored square to the face, sealed with epoxy. The Dual Lock strips for the pad go on the front face above the pin holes. It leans on the oak crest strip and the two stop blocks behind it (the strip spans the 14.75 in between the blocks, so the panel bends only as a strip above the crest line); flat it lies ${plyT.toFixed(3)}" proud of the deck (it was 3/4").`,
    });
  }
  // The pad starts above the pelvis (and the cushion and the pins), so it supports the lumbar region and never overlaps them.
  const pelvisTopAlongBack = (s.surface + RIDER_PELVIS_Z_FRAC * p.riderStatureIn - s.P[2]) / s.col2[2];
  const pinTop = pinZ + PIN_R_IN + 0.1;
  const h0 = Math.min(H - 0.5, Math.max(0.5, p.seatCushionIn / Math.cos(a) + 0.3, pelvisTopAlongBack + PAD_GAP_IN, pinTop));
  const padH = Math.max(0.5, H - h0);
  // The pad is a padded backrest with rounded corners (D-44): a rounded-rectangle extrusion along the back's normal. Local x → across (Y), local y → up the back, local z → forward (the back's normal).
  const padOutline = roundedRect(W, padH, Math.min(p.seatBackCornerRadiusIn, W / 3, padH / 3));
  const padArea = signedArea(padOutline);
  const padPerim = padOutline.reduce((m, q, i) => m + Math.hypot(padOutline[(i + 1) % padOutline.length][0] - q[0], padOutline[(i + 1) % padOutline.length][1] - q[1]), 0);
  const padO = at(0, h0);
  parts.push({
    id: 'seat-back-pad', name: 'Seat back pad', group: 'seat', kind: 'purchased', material: 'closed-cell foam, marine-vinyl cover',
    geometry: { type: 'extrusion', outline: padOutline, depth: BACK_PAD_THICK_IN },
    transform: [0, 1, 0, 0, s.col2[0], 0, s.col2[2], 0, s.col0[0], 0, s.col0[2], 0, padO[0], padO[1], padO[2], 1],
    body: 'chassis', massLb: foam(BACK_PAD_THICK_IN * padArea) + vinyl(2 * padArea + padPerim * BACK_PAD_THICK_IN),
    fab: 'buy', step: STEP.seatStorage, removable: true, explode: unit(-0.7, 0, 1), finish: { soft: true, surface: 'vinyl' },
    sourcing: { vendor: 'Closed-cell polyethylene foam and marine vinyl (as the cushion); sewn in-house', costUsd: 25 },
    joints: [{ type: 'glue', to: 'seat-back-panel', count: 1, size: 'Dual Lock strips (adhesive back) on the panel and the pad: peels off by hand', note: 'D-57: the pad is the second "cushion" that lies in the storage box in cargo mode, so the back can flip flat' }],
    notes: `Mass is an estimate (foam + cover). Rounded-rectangle pad, ${padRadius(W, padH, p.seatBackCornerRadiusIn).toFixed(2)}" corner radius, crowned by the viewer's soft finish (D-44). Held to the back panel by Dual Lock (D-57), so it comes off with no tools and lies in the box with the seat cushion; the back then flips flat.`,
  });

  // Hinges (D-57): two 316 butt hinges, knuckle at the stile's front foot P along y, leaves screwed to the front face and, through the deck, into an oak backer under it.
  const hb = hingeBacker(p, L);
  for (const { s: sg, tag } of SIDES) {
    parts.push(cylinder(ctx, {
      id: `seat-hinge-${tag}`, partNo: 'seat-hinge', name: `Seat-back hinge ${tag}`, group: 'seat', mat: 'fixed', massLb: HINGE_MASS_LB, kind: 'purchased',
      material: '316 stainless butt hinge, 2" × 2" open', fab: 'buy', step: STEP.seatStorage, axis: 'y', radius: HINGE_R_IN, length: HINGE_LEN_IN,
      center: [s.P[0], sg * sup.stileY, s.P[2]], explode: unit(0, sg, 0.4),
      sourcing: { vendor: 'McMaster-Carr (316 stainless butt hinge, 2" knuckle, 1" leaves)', costUsd: 9 },
      joints: [
        { type: 'screw', to: 'seat-back-panel', count: 3, diaIn: 0.19, size: '#10-32 × 1/2 316 flat-head machine screws into epoxied 3/8 stainless threaded inserts in the front face of the panel', note: 'leaf on the back\'s front face, flush with the frame' },
        { type: 'screw', to: 'seat-hinge-backer', count: 3, diaIn: 0.16, size: '#8 × 1-1/4 316 flat head, through the deck into the backer', note: 'leaf on the deck (the cushion\'s rear margin lies over it)' },
      ],
      notes: 'The back flips forward 105° about this knuckle onto the deck (D-57). The leaf on the deck is under the 3/8" gap behind the cushion (a 1/16" proud leaf does not show in the cargo bed).',
    }));
  }
  parts.push(box(ctx, {
    id: 'seat-hinge-backer', name: 'Seat-back hinge backer', group: 'seat', mat: 'oak', step: STEP.frame, grain: 'y',
    ...span([hb.x0, hb.x1], [-(W / 2 + 0.25), W / 2 + 0.25], [L.deckBot - 0.75, L.deckBot]),
    joints: [{ type: 'glue', to: 'deck', count: 1, note: 'epoxy to the underside of the deck, between the joists, before the frame goes on' }, { type: 'screw', to: 'seat-hinge-L', count: 3, size: '#8 × 1-1/4 316, from the hinge leaf down through the deck' }, { type: 'screw', to: 'seat-hinge-R', count: 3, size: '#8 × 1-1/4 316, from the hinge leaf down through the deck' }],
    notes: 'Oak strip glued under the 12 mm deck so the hinge screws and the flat-position pin sockets bite oak, not ply (D-57). It sits between two joists. Drill the two pin holes through it and the deck (THROUGH holes, so the pin tip clears below the backer in the flat position, build 3c S4), epoxy-lined, when the seat is installed.',
  }));

  // Quick-release pins: ride in the stile holes. Upright: through the stile into the stop block (modeled here); flat: see seat-stow.ts.
  for (const { s: sg, tag } of SIDES) {
    parts.push(cylinder(ctx, {
      id: `seat-pin-${tag}`, partNo: 'seat-pin', name: `Seat-back latch pin ${tag}`, group: 'seat', mat: 'fixed', massLb: PIN_MASS_LB, kind: 'purchased',
      material: '316 stainless quick-release spring-detent pin, 3/8" × 2-1/4" usable length, lanyard', fab: 'buy', step: STEP.seatStorage, removable: true,
      axis: 'x', radius: PIN_R_IN, length: PIN_LEN_IN, rot: { y: -a }, center: at(-t + PIN_LEN_IN / 2 - 0.75 + 0.5, pinZ, sg * sup.stileY), explode: unit(0.6, sg * 0.3, 0.8),
      sourcing: { vendor: 'McMaster-Carr (quick-release pin, 3/8" diameter, 2-1/4" usable length, with lanyard; spring-loaded detent ball for the blind hole in the stop block (a ball-lock pin does not retain in a blind hole): VERIFY the exact part and prove it in a scrap block before drilling the real ones)', costUsd: 9 },
      notes: 'No tools: push the button and slide it out or in (D-57). UPRIGHT: through the stile and 1-1/2" into the stop block behind it (a BLIND hole: the detent ball seats in a 1/16" annular groove cut in it, with a ball-lock pin the balls would only press the wall), so the back cannot flip forward. FLAT (back flipped forward): through the same hole in the stile and down through the deck and its backer, 1.97" of stack against the 2-1/4" usable length, with a THROUGH hole in the backer so the pin\'s tip clears below it and retains. The lanyard clips to the stile when the pin is out.',
    }));
  }

  // Stop blocks behind each stile ("wedges", D-40, D-57): fixed oak blocks glued to the deck against the storage box end. The rider's aft load bears on the crest; the pin holds the back against them.
  const wedgeW = fw;
  const depthX = Math.max(...sup.wedge.map((q) => q[0])) - Math.min(...sup.wedge.map((q) => q[0]));
  const zA = Math.max(...sup.wedge.map((q) => q[1]));
  for (const { s: sg, tag } of SIDES) {
    const j: Joint[] = [{ type: 'glue', to: 'deck', count: 1, note: 'epoxy to the deck (and screwed from below)' }];
    if (sup.rear) j.push({ type: 'glue', to: 'storage-end-fore', count: 1, note: 'epoxy to the box end; the push of the rider goes into the box through it' });
    j.push({ type: 'pin', to: `seat-pin-${tag}`, count: 1, diaIn: 2 * PIN_R_IN, size: '3/8" blind hole 1-1/2" deep (upright latch), with a 1/16" annular detent groove at 1"', note: 'drilled square to the back\'s rear face at the pin height; a ball-lock pin does not retain in a blind hole (build 3c S4)' });
    parts.push(profilePart(ctx, {
      id: `seat-wedge-${tag}`, partNo: 'seat-wedge', name: sup.rear ? `Seat back stop block ${tag}` : `Seat back post ${tag}`, group: 'seat', mat: 'oak',
      outline: sup.wedge, depth: wedgeW, basis: 'xz', origin: [0, sg * sup.stileY + wedgeW / 2, 0], grain: 'z', step: STEP.seatStorage,
      stock: { t: wedgeW, w: depthX, l: zA - sup.zb }, explode: [0, 0, -1], joints: j,
      notes: 'Shaped to the back angle (bandsaw + plane) and FIXED (D-57): glued against the box end and the deck, so nothing is loose in the bed. The back leans on its crest; the latch pin goes into a blind 3/8" hole in its face. In cargo mode the back flips forward and this block is a 1" wedge of oak at the box end.',
    }));
  }

  // Crest strip (D-62): the bare panel needs a continuous line to lean on; a thin full-width oak strip between the two stop blocks, the top slice of the same wedge, glued to the box end.
  {
    const blockHalf = fw / 2;
    // The lid hinges (storage.ts: 2.5 in leaves, 3/4 in inboard of the stop blocks) lie on the same box end, so the strip stops short of them: it is the CENTER strip, and the panel spans the
    // short gap (about 3 in) from its end to each stop block, which is only a few lb.in of bending.
    const hingeInner = sup.W / 2 - sup.fw - 0.75 - 2.5;
    const yIn = sup.rear ? Math.min(sup.stileY - blockHalf, hingeInner - 0.15) : sup.stileY - blockHalf; // half width of the strip
    if (yIn > 0.5) {
      const c2x = s.col2[0], c2z = s.col2[2];
      const zAt = (c2: number) => s.Pr[2] + c2z * c2;
      const xAt = (c2: number) => s.Pr[0] + c2x * c2;
      const c2lo = Math.max(0, sup.c2A - CREST_STRIP_IN);
      const outline: Vec2[] = [[sup.xv, zAt(c2lo)], [xAt(c2lo), zAt(c2lo)], [xAt(sup.c2A), zAt(sup.c2A)], [sup.xv, zAt(sup.c2A)]];
      parts.push(profilePart(ctx, {
        id: 'seat-crest-strip', partNo: 'seat-crest-strip', name: 'Seat back crest strip', group: 'seat', mat: 'oak', outline, depth: 2 * yIn, basis: 'xz', origin: [0, yIn, 0], grain: 'y', step: STEP.seatStorage,
        stock: { t: 2 * yIn, w: Math.max(0.25, xAt(sup.c2A) - sup.xv), l: CREST_STRIP_IN }, explode: [0, 0, -1],
        joints: [
          { type: 'glue', to: 'seat-wedge-L', count: 1, note: 'epoxy, end to end with the stop block' }, { type: 'glue', to: 'seat-wedge-R', count: 1, note: 'epoxy, end to end with the stop block' },
          ...(sup.rear ? [{ type: 'glue' as const, to: 'storage-end-fore', count: 1, note: 'epoxy to the box end across the whole width (the rider\'s push goes into the box through it)' }] : []),
        ],
        notes: `D-62: the bare 12 mm seat-back panel leans on this ${(2 * yIn).toFixed(1)}" × ${CREST_STRIP_IN}" oak strip, which is the top slice of the stop-block wedge continued between the two blocks, so the panel is supported along the whole crest line and bends only as a strip above it (without it the panel would span ${(2 * sup.stileY).toFixed(1)}" between the blocks and overstress). Glued to the box end and to the blocks.`,
      }));
    }
  }

  // Grab boards (D-57): one oak board per side, standing on the gunwale top and bolted through the gunwale, with a Shaper Origin-routed hand hole (replaces the pad, two posts and bar).
  {
    const bLen = p.grabBoardLengthIn;
    const gxA = p.seatXIn - GRIP_BEHIND_HPOINT_IN;
    const gxMid = gxA + bLen / 2;
    const slope = sideSlopeAt(L, gxMid);
    const cs = Math.cos(slope), sn = Math.sin(slope);
    const z0g = sideTopAt(L, gxA);
    const holeBot = p.grabBoardFootIn;
    const nTop = holeBot + p.grabHoleHeightIn + p.grabBoardBarIn; // above the gunwale top
    const nBot = -L.railBand; // down to the gunwale bottom (the foot laps the gunwale's inboard face)
    // (u along the gunwale, n up from its top) -> world (x, z), turned to the slope
    const W2 = (u: number, n: number): Vec2 => [gxA + u * cs + n * sn, z0g - u * sn + n * cs];
    const rr = Math.min(GRIP_CORNER_IN, bLen / 4, (nTop - nBot) / 4);
    const outline: Vec2[] = [];
    const arc = (cu: number, cn: number, a0: number) => { for (let i = 0; i <= 6; i++) { const aa = a0 + (Math.PI / 2) * (i / 6); outline.push(W2(cu + rr * Math.cos(aa), cn + rr * Math.sin(aa))); } };
    outline.push(W2(0, nBot), W2(bLen, nBot));
    arc(bLen - rr, nTop - rr, 0);
    arc(rr, nTop - rr, Math.PI / 2);
    // CCW in world (x, z)
    const hl = p.grabHoleLengthIn, hh = p.grabHoleHeightIn;
    const hole: Vec2[] = [];
    const cu0 = bLen / 2, cn0 = holeBot + hh / 2;
    const rh = hh / 2, straight = Math.max(0, hl - hh) / 2;
    for (let i = 0; i <= 8; i++) { const aa = -Math.PI / 2 + (Math.PI * i) / 8; hole.push(W2(cu0 + straight + rh * Math.cos(aa), cn0 + rh * Math.sin(aa))); }
    for (let i = 0; i <= 8; i++) { const aa = Math.PI / 2 + (Math.PI * i) / 8; hole.push(W2(cu0 - straight + rh * Math.cos(aa), cn0 + rh * Math.sin(aa))); }
    const bt = p.grabBoardThickIn;
    for (const { s: sg, tag } of SIDES) {
      const gid = gunwaleId(p, tag);
      const yIn = sg * (innerHalfWidth(L, gxMid)); // inner face of the gunwale at the board
      // basis 'xz' extrudes toward -y from origin.y: the +y face of the board is the one nearer the gunwale for the left side
      const originY = sg > 0 ? yIn : yIn + bt;
      const bolts = GRIP_BOLT_ROWS_IN.flatMap((d) => Array.from({ length: GRIP_BOLT_COLS }, (_, i) => W2(((i + 0.5) * bLen) / GRIP_BOLT_COLS, -d)));
      parts.push(profilePart(ctx, {
        id: `seat-grip-${tag}`, partNo: 'seat-grip', name: `Grab board ${tag}`, group: 'seat', mat: 'oak', outline: sg > 0 ? outline : outline, holes: [cw2(hole)], depth: bt, basis: 'xz', origin: [0, originY, 0],
        grain: 'x', step: STEP.finish, stock: { t: bt, w: nTop - nBot, l: bLen }, fab: 'shaper-origin',
        joints: [{ type: 'bolt', to: gid, count: GRIP_BOLTS, diaIn: GRIP_BOLT_DIA_IN, size: `${GRIP_BOLT_DIA_IN}" 316 carriage bolts, ${GRIP_BOLT_COLS} columns × ${GRIP_BOLT_ROWS_IN.length} rows (${GRIP_BOLT_ROWS_IN.join('" and ')}" below the gunwale top), through the board and the gunwale (round head outside, a 1-1/4" fender washer and nylock nut on the inside of the board)`, at: bolts.map(([bx, bz]): Vec3 => [bx, sg * yIn, bz]), note: 'the board laps the inboard face of the gunwale; the bolts pass through the oak band above the web groove' }],
        notes: `Grab board (D-57): ${bt}" oak, ${f1(bLen)}" long and ${f1(nTop - nBot)}" tall, its lower ${L.railBand}" lapping the inboard face of the gunwale and standing ${f1(nTop)}" above the gunwale top, turned to the sheer's ${((slope * 180) / Math.PI).toFixed(1)}° slope. A ${hl}" × ${hh}" hand hole is Shaper Origin-routed ${f1(holeBot)}" above the gunwale top (finger gap ${hh}" ≥ 1.25", clear length ${hl}" ≥ 3.5": no pinch point, BRIEF 4.7), ${p.grabBoardBarIn}" of oak above it; top corners ${GRIP_CORNER_IN}" radius, ¼" roundovers on every edge and the hole. Bolted, never glued, so a splintered board can be replaced. It replaces the D-40 pad, two posts and bar.`,
      }));
    }
  }

  // D-60: the drop-in foot block and its four slot cleats are gone; the bow bulkhead is the only foot brace (D-57).
  return parts;
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
/** A hole loop must run clockwise. */
function cw2(o: Vec2[]): Vec2[] {
  return signedArea(o) <= 0 ? o : [...o].reverse();
}
