/**
 * Seat (D-3, D-9, D-18, D-40, D-57, D-62, D-63): a closed-cell EVA foam cushion (kneeling pads, no cover) on the deck, a full-size reclined back (D-62: a frameless 12 mm okoume panel on an oak crest
 * strip, with an EVA foam pad that comes off with Velcro Industrial), a pair of grab boards bolted to the side tops. (D-60: the drop-in foot block and its slot cleats were dropped; the bow bulkhead is the foot brace.)
 *
 * D-57: the back is HINGED at its front foot (two 316 butt hinges screwed through the deck into oak backer pads) and FLIPS FORWARD onto the deck for cargo; it never goes in the box.
 * Upright it leans back onto two fixed oak stop blocks ("wedges") glued against the storage box end; a 3/8" spring-detent quick-release pin per side (D-63: 2 in up the panel) goes through the panel
 * into a blind hole in the stop block and holds it up, and the same pin through the same hole and the deck into a blind hole in the backer pad holds it flat. The pad and the cushion are the "cushions" that lie in the box in cargo mode.
 */
import { gripHoleX, RIDER_PELVIS_Z_FRAC, STORAGE_LOCATION, thinSheet, type Params } from '../params';
import { GRIP_BACKING_T_IN, STEP, box, cylinder, span, SIDES, type Ctx, stainless, insertMat, INSERT_DRILL_IN } from './build-utils';
import { innerHalfWidth, sideSlopeAt, sideTopAt, type Layout } from './layout';
import { chooseDomino, DOMINOS, frac, toLocal, type DominoQuery } from './joinery';
import { joistId } from './frame';
import { profilePart, signedArea } from './profile';
import { boltLength, inchesText, localPoint, pickWoodScrew, SCREW_DIA_IN, screwText } from './rear-mount';

const f2 = (v: number): string => String(Math.round(v * 100) / 100);
import type { Joint, Part, Vec2, Vec3 } from './types';

// ── Detail dimensions and purchased-part estimates (D-18, D-40) ──
/** D-83: the seat back pad is the third Harbor Freight EVA kneeling pad (11 x 18 x 1-1/2 in), trimmed to size: 1-1/2 in thick (the cushion's thickness is `seatCushionIn`). */
export const BACK_PAD_THICK_IN = 1.5;
/** The Harbor Freight EVA kneeling pad (#56572) blank, in: the cushion is one whole pad plus a strip of a second (edge-glued). */
const EVA_PAD_LEN_IN = 11;
/** Gap between the pelvis top and the start of the back pad. */
const PAD_GAP_IN = 0.25;
/** Riser runner width (across). */
const RISER_RUNNER_IN = 1.5;
/** The cushion's rear edge is set back this far from the stile front so the knob heads clear it. */
export const CUSHION_CLEAR_IN = 0.375;
/**
 * Quick-release pin (3/8 in, 316 stainless, with lanyard): radius, usable length (under the head to the tip), head height, mass; one per side. D-63 (build 3c-8, owner-approved: pin stations 2 in up the
 * panel): 1-1/2 in usable. It is a SPRING-DETENT pin in BOTH positions, because a ball-lock pin only retains where its balls clear the far side of a THROUGH hole and both holes are blind (the stop
 * block is glued to the box end; the hinge backer is oak under the deck): the ball seats in a 1/16 in annular groove cut in each blind hole. UPRIGHT it passes the 0.47 in panel and goes 1.03 in into the
 * stop block (the block is 1.53 in thick along the pin at 2 in up, with the thin box end behind it); FLAT it passes the panel and the 12 mm deck and goes 0.56 in into the 1 in backer. The older 2-1/4 in pin
 * could not be used upright: it would have run 0.3 in into the box.
 */
export const PIN_R_IN = 0.1875;
export const PIN_LEN_IN = 1.5;
/** Height of the pin's button head above the surface it seats on (modeled as part of the pin cylinder). */
export const PIN_HEAD_IN = 0.3;
/** Oak hinge/pin backer pad under the 12 mm deck (D-63): thick enough for the blind flat-position pin hole, and 3 in wide at each station (4 pin diameters each side of the pin). */
export const HINGE_BACKER_THICK_IN = 1;
/** A butt hinge leaf (the model's 316 hinges, 1/16 in; the BOM's HINGE_LEAF_IN). */
export const HINGE_LEAF_THICK_IN = 1 / 16;
/** Oak that must be left behind the bottom of a blind latch hole (the stop block against the box end, the backer under the deck), in. */
export const LATCH_HOLE_WALL_MIN_IN = 0.25;
/** The lid hinges (storage.ts) stand this far proud of the box end; the crest strip is bedded 0.01 in off them. */
const LID_HINGE_STANDOFF_IN = 0.12;
/** The panel must keep at least this much back veneer behind a threaded-insert blind hole (D-63). */
export const INSERT_VENEER_MIN_IN = 0.125;
/** Height (along the back) of the full-width oak crest strip the frameless seat back leans on (D-62). */
export const CREST_STRIP_IN = 1.5;
const PIN_MASS_LB = 0.06;
/** 316 butt hinge (leaves screwed to the back's front face and, through the deck, to a backer): knuckle length across, knuckle radius, mass. */
export const HINGE_LEN_IN = 2;
export const HINGE_R_IN = 0.125;
/** Leaf width (in) and the pitch (in) of its three screw holes along the knuckle; the holes are the same on both leaves, so the inserts in the panel and the deck screws match. */
export const HINGE_LEAF_IN = 1;
export const HINGE_HOLE_PITCH_IN = 0.5;
/** Outermost hinge insert to the panel's side edge (in): at least the 1/2 in the insert text asks for. */
export const INSERT_EDGE_IN = 0.6;
export { INSERT_DRILL_IN } from './build-utils';
const HINGE_MASS_LB = 0.1;
/** Height of the support (oak post) behind the back when the box is not behind it, along the back; and its crest thickness. */
export const SEAT_POST_HEIGHT_IN = 4.5;
const POST_CREST_IN = 0.75;
/** The wedge crest sits this far below the lid top so the stile never touches the lid frame. */
const WEDGE_BELOW_LID_IN = 1;
/** A rear box is never lower than this (top above the deck), so the seat-back backers and the hinge backers fit inside it. */
export const MIN_REAR_BOX_H_IN = 3.4;
/** Grab board (D-57, D-84): bolts through the gunwale (1/4" button-head screws); its hole sits `grabHoleAheadOfHpointIn` ahead of the H-point, its ends are vertical, its top corners rounded (`grabBoardCornerIn`). */
export const GRIP_BOLT_DIA_IN = 0.25;
/** Fender washer under each nut, on the oak board (the bearing check of the grab board). */
export const GRIP_WASHER_OD_IN = 1.5;
export const GRIP_BOLT_COLS = 3;
/**
 * Backing strip under the bolt heads, on the outer face of the outer gunwale band (D-63, D-84): the pull turns the board about its lower edge, so the heads pull about 1,400 lbf out of a 0.236 in oak
 * band over 6 mm ply; oak across the grain allows 358 psi, and a 1/4-20 button head (0.5 in) or any washer that fits the 1-1/2 in band cannot spread that. A continuous 1/8 x 1-1/4 in flat bar does
 * (1/8 in is the thinnest 316 flat bar sold; the old 1/16 in bar was too limber to spread the load evenly). Under an oak cap (D-84) it does not show.
 */
export { GRIP_BACKING_T_IN };
export const GRIP_BACKING_H_IN = 1.25;
/** The strip stops this far in from each end of the board (the end columns sit bLen/6 in from the ends; 0.58 in of strip is left past each end screw). */
export const GRIP_BACKING_END_IN = 0.75;
/** Length of the backing strip for a board of length `bLen`. */
export const gripBackingLen = (bLen: number): number => Math.max(1, bLen - 2 * GRIP_BACKING_END_IN);
/** Oak cap over the strip (D-84): 1/2 in thick, glued on over the bolt heads after the screws are set; its back face has a 1/8 in recess for the strip and a 5/8 in x 5/32 in pocket over each head, leaving 7/32 in of oak over the heads; as tall as the gunwale band and as long as the board (its plumb ends line up with the board's). */
export const GRIP_CAP_T_IN = 0.5;
export const GRIP_CAP_POCKET_IN = GRIP_BACKING_T_IN;
/** Head pockets in the cap's back (diameter, extra depth below the strip recess): a 1/2 in button head stands 0.14 in off the strip. */
export const GRIP_CAP_HEAD_DIA_IN = 0.625;
export const GRIP_CAP_HEAD_DEPTH_IN = 0.15625;
/** Radius of the cap's four corners (in): the vertical ends meet the sheer at 82 and 98 degrees. */
export const GRIP_CAP_CORNER_IN = 0.25;
export const gripCapLen = (bLen: number): number => bLen; // the cap is as long as the board and its plumb ends line up with the board's
/** The two bolt rows, this far below the gunwale top (the lower stays inside the 1.5 in gunwale band, the heads clear the strip edges by 1/16 in): the pull is resisted by the couple between them (grab-board row). */
export const GRIP_BOLT_ROWS_IN = [0.40625, 1.0625] as const;
/** The screws are STAGGERED (D-84): three in the upper row, two in the lower row between them, so the fender washers on the board do not collide (rows are only 0.65 in apart). */
export const GRIP_BOLTS = GRIP_BOLT_COLS + (GRIP_BOLT_COLS - 1);
/** Fender washer OD (in) under the lower row's nuts (7/8 in so it stays on the board: the row is 1.05 in below the gunwale top and the board ends 1.5 in below it) (those screws take less). */
export const GRIP_WASHER_LOW_OD_IN = 0.875;
/** Screw positions along the board, measured from the hole center: [along the sheer (in), below the gunwale top (in)]. */
export const gripBolts = (bLen: number): Array<[number, number]> => [
  ...Array.from({ length: GRIP_BOLT_COLS }, (_, i): [number, number] => [(i - (GRIP_BOLT_COLS - 1) / 2) * (bLen / GRIP_BOLT_COLS), GRIP_BOLT_ROWS_IN[0]]),
  ...Array.from({ length: GRIP_BOLT_COLS - 1 }, (_, i): [number, number] => [(i - (GRIP_BOLT_COLS - 2) / 2) * (bLen / GRIP_BOLT_COLS), GRIP_BOLT_ROWS_IN[1]]),
];

/**
 * Where the grab board stands (D-84), in its own flat frame turned to the sheer slope: u along the sheer, n up from the gunwale top, origin at world x = `gxA` on the sheer line through `z0g`.
 * The hole center is `grabHoleAheadOfHpointIn` ahead of the H-point. The ends are VERTICAL in the world, so in the flat frame they lean aft going up by tan(slope): `uRear(n)` and `uFront(n)`.
 */
export function gripFrame(p: Params, L: Layout) {
  const bLen = p.grabBoardLengthIn, foot = p.grabBoardFootIn, hh = p.grabHoleHeightIn;
  const nMid = foot + hh / 2, nTop = foot + hh + p.grabBoardBarIn, nBot = -L.railBand;
  const xh = gripHoleX(p);
  const slope = sideSlopeAt(L, xh);
  const cs = Math.cos(slope), sn = Math.sin(slope), tn = Math.tan(slope);
  const uShift = bLen / 2 + (nTop - nMid) * tn; // so the rear edge at the top of the board is at u >= 0
  const ox = xh - nMid * sn;
  const gxA = ox - uShift * cs;
  const z0g = sideTopAt(L, ox) + uShift * sn;
  const uRear = (n: number, half = bLen / 2) => uShift - half - (n - nMid) * tn;
  const uFront = (n: number, half = bLen / 2) => uShift + half - (n - nMid) * tn;
  const W = (u: number, n: number): Vec2 => [gxA + u * cs + n * sn, z0g - u * sn + n * cs];
  /** World x of the rear and front edges (vertical). */
  const xRear = xh - (bLen / 2) * cs, xFront = xh + (bLen / 2) * cs;
  return { bLen, foot, hh, nMid, nTop, nBot, xh, slope, cs, sn, tn, uShift, gxA, z0g, uRear, uFront, W, xRear, xFront };
}

/** The flat board and cap stand on the face 1 in back from their front end (the side's plan curve is under 1/16 in off the plane there, the validator's limit). */
const GRIP_PLANE_SETBACK_IN = 1;

/** Round the corner `i` of a convex CCW polygon with radius `r` (clamped to fit the shorter neighbor edge). */
function roundCorners(poly: Vec2[], which: number[], r: number): Vec2[] {
  const out: Vec2[] = [];
  poly.forEach((c, i) => {
    if (!which.includes(i)) { out.push(c); return; }
    const prev = poly[(i + poly.length - 1) % poly.length], next = poly[(i + 1) % poly.length];
    const a: Vec2 = [prev[0] - c[0], prev[1] - c[1]], b: Vec2 = [next[0] - c[0], next[1] - c[1]];
    const la = Math.hypot(a[0], a[1]), lb = Math.hypot(b[0], b[1]);
    const ua: Vec2 = [a[0] / la, a[1] / la], ub: Vec2 = [b[0] / lb, b[1] / lb];
    const th = Math.acos(Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1])));
    const rr = Math.min(r, (Math.min(la, lb) / 2) * Math.tan(th / 2));
    const d = rr / Math.tan(th / 2);
    const t1: Vec2 = [c[0] + ua[0] * d, c[1] + ua[1] * d];
    const bis: Vec2 = [ua[0] + ub[0], ua[1] + ub[1]]; const lbis = Math.hypot(bis[0], bis[1]);
    const cen: Vec2 = [c[0] + (bis[0] / lbis) * (rr / Math.sin(th / 2)), c[1] + (bis[1] / lbis) * (rr / Math.sin(th / 2))];
    const a1 = Math.atan2(t1[1] - cen[1], t1[0] - cen[0]);
    const t2: Vec2 = [c[0] + ub[0] * d, c[1] + ub[1] * d];
    let a2 = Math.atan2(t2[1] - cen[1], t2[0] - cen[0]); while (a2 < a1) a2 += 2 * Math.PI;
    const n = 8;
    for (let k = 0; k <= n; k++) { const q = a1 + ((a2 - a1) * k) / n; out.push([cen[0] + rr * Math.cos(q), cen[1] + rr * Math.sin(q)]); }
  });
  return out;
}

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

/** Gunwale member name the grips / lash doublers sit on: the INNER gunwale band, whose inboard face is the cabin side of the sandwich (D-61, D-62; body.ts ids). The outer band is `side-X-gunwale`. */
export function gunwaleId(_p: Params, tag: 'L' | 'R'): string {
  return `side-${tag}-gunwale-in`;
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

const up16 = (v: number) => Math.ceil(v * 16 - 1e-9) / 16;
/** Seat basis the latch geometry needs (Layout.seat). */
type SeatBasis = Pick<Layout['seat'], 'Pr' | 'col0' | 'col2'>;
/**
 * The upright latch hole at `c2` up the panel (D-63): the stop block's thickness along the pin axis (rear face of the panel to the box end `xv`, a vertical face, or to the floor `zb`, whichever the
 * axis meets first), the blind-hole depth for a seated pin (tip depth plus 0.03 in, rounded up to 1/16 in), and the oak left behind the bottom of the hole, measured horizontally to the box end
 * allowing for the hole radius on the tilted bottom.
 */
function uprightHole(s: SeatBasis, a: number, t: number, xv: number, zb: number, c2: number) {
  const x0 = s.Pr[0] + s.col2[0] * c2, z0 = s.Pr[2] + s.col2[2] * c2; // pin axis on the panel's rear face; it runs aft along -col0
  const cx = s.col0[0], cz = s.col0[2];
  const blockIn = Math.max(0, Math.min(cx > 1e-6 ? (x0 - xv) / cx : Infinity, cz > 1e-6 ? (z0 - zb) / cz : Infinity));
  const tipIn = Math.max(0, PIN_LEN_IN - t);
  const holeIn = up16(tipIn + 0.03);
  return { blockIn, tipIn, holeIn, leftIn: (blockIn - holeIn) * Math.max(cx, 1e-6) - PIN_R_IN * Math.sin(a) };
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
  const boxZTop = Math.max(st.zTop, st.zBot + 3 * thinSheet(p).thicknessIn + p.storageLidRimThickIn + p.storageGasketIn, rear ? st.zBot + MIN_REAR_BOX_H_IN : 0);
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
  const zb = s.pan;
  const c2b = (zb - s.Pr[2]) / c2z;
  const zA = s.Pr[2] + c2z * c2A;
  const xA = xf(c2A);
  // Aft face is the box end (rear) or a vertical face POST_CREST behind the crest (post).
  const xv = rear ? Math.min(boxX1, xA - 0.02) : xA - POST_CREST_IN;
  const wedge: Vec2[] = [[xv, zb], [xf(c2b), zb], [xA, zA], [xv, zA]];
  // The latch pin station: `seatBackLatchHeightIn` up the panel, but no higher than 3/4 in under the crest and no higher than the stop block can take the blind hole (a block thins as the pin rises
  // up the leaning back; the 4 mm box end is behind it): step down a quarter inch at a time until at least LATCH_HOLE_WALL_MIN_IN of oak is left behind the hole (D-63). A back that is too
  // upright for any station fails the seat-back row (oak left behind the pin hole).
  let c2L = Math.min(p.seatBackLatchHeightIn, c2A - 0.75);
  while (c2L > 0.75 + 1e-9 && uprightHole(s, a, t, xv, zb, c2L).leftIn < LATCH_HOLE_WALL_MIN_IN) c2L = Math.max(0.75, c2L - 0.25);
  return { rear, a, W, H, t, fw, stileY, c2A, c2B, c2L, wedge, xv, zb, boxZTop, boxX1 };
}

/**
 * Latch-pin hole geometry (D-63, build 3c-8), from the real stop-block outline at the pin height `c2L` and the real stack under the flat back. UPRIGHT: the hole axis is the back's normal through
 * the panel's rear face at `c2L`; the stop block is bounded aft by the box end (`xv`, a vertical face) and below by the deck, so `blockIn` is the distance along the axis to whichever it meets first.
 * The pin seats with its head on the panel's front face, so its tip is `PIN_LEN_IN - t` into the block; the blind hole is that plus a little, rounded up to 1/16 in, and `upLeftIn` is the oak left
 * behind its bottom (measured horizontally to the box end, allowing for the hole radius on the tilted bottom). FLAT: the pin goes down through the panel and the deck, `flatTipIn` into the backer.
 */
export interface LatchGeometry {
  /** Stop block thickness along the pin axis at the pin station (rear face of the panel to the box end or the floor). */
  blockIn: number;
  upTipIn: number;
  upHoleIn: number;
  /** Where the 1/16 in detent groove is cut, measured from the mouth of the hole (the ball sits `LATCH_BALL_FROM_TIP_IN` behind the tip: verify on the real pin). */
  upGrooveIn: number;
  upLeftIn: number;
  flatTipIn: number;
  flatHoleIn: number;
  flatGrooveIn: number;
  flatLeftIn: number;
}
/** Distance from the tip of a 3/8 in spring-detent pin to its ball (assumed; read it off the real pin before cutting the grooves). */
export const LATCH_BALL_FROM_TIP_IN = 0.3;
export function latchGeometry(p: Params, L: Layout): LatchGeometry {
  const s = L.seat;
  const sup = seatBackSupport(p, L);
  const t = sup.t;
  const { blockIn, tipIn: upTipIn, holeIn: upHoleIn, leftIn: upLeftIn } = uprightHole(s, sup.a, t, sup.xv, sup.zb, sup.c2L);
  const deckIn = L.deckTop - L.deckBot;
  const flatTipIn = Math.max(0, PIN_LEN_IN - t - deckIn);
  const flatHoleIn = up16(flatTipIn + 0.03);
  return {
    blockIn, upTipIn, upHoleIn, upGrooveIn: Math.max(0.25, upTipIn - LATCH_BALL_FROM_TIP_IN), upLeftIn,
    flatTipIn, flatHoleIn, flatGrooveIn: Math.max(0.25, flatTipIn - LATCH_BALL_FROM_TIP_IN), flatLeftIn: HINGE_BACKER_THICK_IN - flatHoleIn,
  };
}

/**
 * Where the seat-back hinge and pin backers sit (D-57, D-63): the x interval under the deck, found between the joists, that holds the hinge screws AND the flat-position pin hole. It starts a
 * half inch behind the hinge axis P and runs forward past the flat pin (the c2 axis lies along +x when the back is flipped) to 4 pin diameters beyond it, or BUTTS the next joist if that is nearer
 * (glued to its face, so the joist is wood behind the pin). Slides in half-inch steps to clear a joist, as before.
 */
export function hingeBacker(p: Params, L: Layout): { x0: number; x1: number } {
  const w = 3;
  const px = L.seat.P[0];
  const pinX = px + seatBackSupport(p, L).c2L;
  const clash = (a: number) => L.joistX.some((jx) => jx + L.joistT / 2 + 0.2 > a && jx - L.joistT / 2 - 0.2 < a + w);
  const faces = L.joistX.map((jx) => jx - L.joistT / 2).sort((u, v) => u - v);
  // Try a window centered a little ahead of P, then slide it by half-inches either way until it clears every joist.
  for (let d = 0; d <= 8; d += 0.5) for (const sgn of [1, -1]) {
    const a = px - 0.5 + sgn * d;
    if (clash(a)) continue;
    const want = Math.max(a + w, pinX + 4 * 2 * PIN_R_IN);
    const next = faces.find((fc) => fc >= a + w - 1e-9);
    return { x0: a, x1: next !== undefined && next < want + 0.2 ? Math.max(next, a + w) : want };
  }
  return { x0: px - 0.5, x1: px - 0.5 + w };
}

export function buildSeat(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const s = L.seat;
  const parts: Part[] = [];
  const hw = s.width / 2;
  const foam = (volIn3: number) => (volIn3 / 1728) * p.evaFoamDensityPcf;
  const sup = seatBackSupport(p, L);
  const lg = latchGeometry(p, L);
  const { a, H, t, fw, W } = sup;
  const plyT = Math.min(p.seatBackPlyIn, t); // the seat-back panel keeps its own ply setting (`seatBackPlyIn`, the 12 mm deck offcut, D-62/D-68) when the sides, box and lid go to 4 mm

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

  // Cushion (D-83): EVA kneeling pads, no cover. One whole pad plus a strip of a second, edge-glued with contact cement; held by Velcro strips so it lifts off for hauling.
  const cx0 = s.xRear + CUSHION_CLEAR_IN;
  const cushionLen = s.xFront - cx0;
  const cushionVol = cushionLen * s.width * p.seatCushionIn;
  const stripLen = Math.max(0, cushionLen - EVA_PAD_LEN_IN);
  const frac8 = (v: number) => { const n = Math.round(v * 8); const w = Math.floor(n / 8), r = n % 8; if (r === 0) return `${w}`; let a = r, b = 8; while (a % 2 === 0) { a /= 2; b /= 2; } return w > 0 ? `${w}-${a}/${b}` : `${a}/${b}`; };
  parts.push(box(ctx, {
    id: 'seat-cushion', name: 'Seat cushion', group: 'seat', mat: 'fixed', massLb: foam(cushionVol), kind: 'purchased',
    material: 'closed-cell EVA foam (kneeling pads), no cover', fab: 'buy', step: STEP.seatStorage, ...span([cx0, s.xFront], [-hw, hw], [s.cushionBottom, s.surface]),
    sourcing: { vendor: 'Harbor Freight (EVA kneeling pad #56572, 11 x 18 x 1-1/2 in): 2 pads for the cushion, 1 for the back pad', costUsd: 15.98 },
    notes: `D-83: ${frac8(cushionLen)}" x ${frac8(s.width)}" x ${frac8(p.seatCushionIn)}" of closed-cell EVA, with no cover (it sheds rain and wipes clean). Cut it from two Harbor Freight kneeling pads (11" x 18" x 1-1/2"): one whole pad${stripLen > 0.05 ? ` plus a ${frac8(stripLen)}" strip cut from the second`  : ''}, edge-glued with contact cement (the strip goes at the rear; the offcut is spare). Sits directly on the deck (or the storage lid / riser) on Velcro Industrial strips. Set back 3/8" from the back so the hinge knuckles clear it (D-40, D-57). Mass is from the pad (about 1 lb for 297 in³). Cargo mode (D-57): peel it off the strips by hand and lay it flat in the storage box with the back pad (the strips stay on the deck, 0.1" proud: the bed is flat).`,
  }));

  // Seat back (D-62, Eric 2026-10-12): a FRAMELESS 1/2 in (12 mm) okoume panel cut from the deck sheet's offcut, no oak stiles or rails. Its front face passes through P and it leans back by
  // seatBackAngleDeg. The two quick-release pin holes sit at the stile stations (`stileY`), the hinges a little inboard of them (`hingeY`), fastened directly to the panel with epoxied threaded inserts and
  // clearance holes; the edge is banded with 1/16 in oak veneer (no exposed ply edge). A thin full-width oak CREST STRIP between the two stop blocks lets the bare panel lean on a
  // continuous line instead of spanning 14.75 in between two blocks (the seat-back row checks both).
  const at = (c0: number, c2: number, y = 0): Vec3 => [s.P[0] + s.col0[0] * c0 + s.col2[0] * c2, y, s.P[2] + s.col0[2] * c0 + s.col2[2] * c2];
  const pinZ = sup.c2L;
  // Hinge stations (D-62, D-63): the 2 in knuckle sits at the foot, inboard of the pin station so that the outer insert is INSERT_EDGE_IN from the panel's side edge (centered on the pin it would stick out of the
  // 16 in panel by 3/8 in). The leaf's three screw holes run along the knuckle at HINGE_HOLE_PITCH_IN, on the leaf's centerline (the leaf starts at the knuckle edge, so that is v from the foot edge).
  const hingeY = Math.max(HINGE_HOLE_PITCH_IN + 0.1, Math.min(sup.stileY, W / 2 - INSERT_EDGE_IN - HINGE_HOLE_PITCH_IN));
  const leafV = HINGE_R_IN + (HINGE_LEAF_IN - HINGE_R_IN) / 2; // 0.5625 in up the panel from the hinge axis
  const holeK = [-1, 0, 1];
  /** Panel-local insert points on the front face (local z = thickness), ascending across, for one side. */
  const insertAt = (sg: 1 | -1): Vec3[] => holeK.map((k) => sg * (hingeY + k * HINGE_HOLE_PITCH_IN)).sort((u, v) => u - v).map((y): Vec3 => [y, leafV, plyT]);
  // D-63 (build 3c-8): the hinge inserts go in blind holes in the front face; at least INSERT_VENEER_MIN_IN of back veneer must remain, so the hole is the panel less 1/8 in (rounded down to 1/32 in)
  // and the insert is 1/32 in shorter than the hole: 5/16 in in a 12 mm panel (a 3/8 in insert would leave 0.10 in).
  const insertHoleIn = Math.floor((plyT - INSERT_VENEER_MIN_IN) * 32 + 1e-9) / 32;
  const insertLenIn = insertHoleIn - 1 / 32;
  const insertTxt = `#10-32 × ${insertLenIn >= 0.3 ? '5/16' : String(insertLenIn.toFixed(2))} ${insertMat(p)} threaded inserts (hex-drive, epoxied) in blind ${frac(INSERT_DRILL_IN)} in holes ${(insertHoleIn).toFixed(3)}" deep (a drill stop on the bit; verify the hole size against the insert maker's sheet) from the front face, leaving ${(plyT - insertHoleIn).toFixed(3)}" of back veneer, 1/2 in or more from every edge`;
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
      body: 'chassis', massLb: mass, edges: 'edged', grain: 'y', fab: 'shaper-origin', step: STEP.seatStorage, explode: unit(-0.5, 0, 0.6),
      stock: { t: plyT, w: Math.min(W, H), l: Math.max(W, H) }, // the Shaper cut size (round 2: the cut list said +0.25, the file and the notes said 16 in); the 1/16 in banding goes on after the cut
      joints: [
        { type: 'screw', to: 'seat-hinge-L', count: 3, diaIn: 0.19, size: `3 × ${insertTxt}`, note: `D-75: ONE face for both: the inserts are set from the FRONT face (the forward face, where the rider leans and the hinge leaf lies) and the #10-32 screws go in from the FRONT through the leaf; nothing is drilled from the back face, which keeps its veneer. Hinge leaf on the front face at the foot (no screw into a ply edge); at = the insert mouths on the front face, ${leafV} in up the panel on the leaf centerline, ${HINGE_HOLE_PITCH_IN} in apart, centered ${hingeY.toFixed(2)} in off the center line`, at: insertAt(1) },
        { type: 'screw', to: 'seat-hinge-R', count: 3, diaIn: 0.19, size: `3 × ${insertTxt}`, note: `D-75: ONE face for both: the inserts are set from the FRONT face (the forward face, where the rider leans and the hinge leaf lies) and the #10-32 screws go in from the FRONT through the leaf; nothing is drilled from the back face, which keeps its veneer. Hinge leaf on the front face at the foot (no screw into a ply edge); at = the insert mouths on the front face, ${leafV} in up the panel on the leaf centerline, ${HINGE_HOLE_PITCH_IN} in apart, centered ${hingeY.toFixed(2)} in off the center line`, at: insertAt(-1) },
        { type: 'pin', to: 'seat-pin-L', count: 1, diaIn: 2 * PIN_R_IN, size: '13/32 clearance hole through the panel, bored square to the face; epoxy-sealed bore', note: `${pinZ.toFixed(2)}" up the panel from the hinge axis, at station y = ±${sup.stileY.toFixed(2)}" (${(W / 2 - sup.stileY - 0.203).toFixed(2)}" of panel from the hole edge to the side edge): upright into the blind hole in the stop block (${lg.upHoleIn.toFixed(4).replace(/0+$/, '')}" deep), flat through the deck into the blind hole in the backer pad (${lg.flatHoleIn.toFixed(4).replace(/0+$/, '')}" deep)`, at: [[sup.stileY, pinZ, plyT / 2]] },
        { type: 'pin', to: 'seat-pin-R', count: 1, diaIn: 2 * PIN_R_IN, size: '13/32 clearance hole through the panel, bored square to the face; epoxy-sealed bore', note: `${pinZ.toFixed(2)}" up the panel from the hinge axis, at station y = ±${sup.stileY.toFixed(2)}" (${(W / 2 - sup.stileY - 0.203).toFixed(2)}" of panel from the hole edge to the side edge): upright into the blind hole in the stop block (${lg.upHoleIn.toFixed(4).replace(/0+$/, '')}" deep), flat through the deck into the blind hole in the backer pad (${lg.flatHoleIn.toFixed(4).replace(/0+$/, '')}" deep)`, at: [[-sup.stileY, pinZ, plyT / 2]] },
        { type: 'glue', to: 'seat-back-pad', count: 1, size: 'Velcro Industrial strips on the face', note: 'the pad peels off by hand (D-57)' },
      ],
      notes: `FRAMELESS seat back (D-62, Eric 2026-10-12): a ${(plyT * 25.4).toFixed(0)} mm (1/2 in) okoume panel, ${W}" × ${H}", cut from the offcut of the deck sheet on the Shaper Origin (no 6 mm sheet is bought), top corners ${rTop.toFixed(2)}" radius, bottom corners 1/2". It replaces the oak stiles, rails and 6 mm panel (3/4 in thick frame). Edge: 1/16" oak veneer banding all round (contact cement or iron-on), ironed and flush-trimmed, then epoxy-sealed with the rest, so no ply edge shows. The two latch pins sit at stations ${sup.stileY.toFixed(2)}" either side of the center line and the hinge knuckles are centered ${hingeY.toFixed(2)}" either side (so the outer insert is ${INSERT_EDGE_IN}" from the side edge; the inserts are ${leafV}" up the panel, ${HINGE_HOLE_PITCH_IN}" apart): the hinge leaves are held by 3 stainless ${insertTxt} each, in the FRONT face (never into a ply edge); put a bucket pull-out test on a scrap before drilling the real panel. The pin holes are 13/32" clearance holes bored square to the face, ${pinZ.toFixed(2)}" up the panel from the hinge axis (D-63, Eric: 2 in), sealed with epoxy. The Velcro Industrial strips for the pad go on the front face above the pin holes. It leans on the oak crest strip and the two stop blocks behind it (the strip spans the whole ${(2 * (sup.stileY - fw / 2)).toFixed(1)} in between the blocks, so the panel bends only as a strip above the crest line); flat it lies ${plyT.toFixed(3)}" proud of the deck (it was 3/4").`,
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
  const padO = at(0, h0);
  parts.push({
    id: 'seat-back-pad', name: 'Seat back pad', group: 'seat', kind: 'purchased', material: 'closed-cell EVA foam (kneeling pad), no cover',
    geometry: { type: 'extrusion', outline: padOutline, depth: BACK_PAD_THICK_IN },
    transform: [0, 1, 0, 0, s.col2[0], 0, s.col2[2], 0, s.col0[0], 0, s.col0[2], 0, padO[0], padO[1], padO[2], 1],
    body: 'chassis', massLb: foam(BACK_PAD_THICK_IN * padArea),
    fab: 'buy', step: STEP.seatStorage, removable: true, explode: unit(-0.7, 0, 1), finish: { soft: true, surface: 'vinyl' },
    sourcing: { vendor: 'Harbor Freight (EVA kneeling pad #56572, 11 x 18 x 1-1/2 in; the third pad)', costUsd: 7.99 },
    joints: [{ type: 'glue', to: 'seat-back-panel', count: 1, size: 'Velcro Industrial strips (adhesive back) on the panel and the pad: peels off by hand', note: 'D-57: the pad is the second "cushion" that lies in the storage box in cargo mode, so the back can flip flat' }],
    notes: `D-83: the third Harbor Freight EVA kneeling pad (11" x 18" x 1-1/2"), trimmed to size, no cover; mass from the pad. Rounded-rectangle pad, ${padRadius(W, padH, p.seatBackCornerRadiusIn).toFixed(2)}" corner radius, crowned by the viewer's soft finish (D-44). Held to the back panel by Velcro Industrial strips (D-57), so it comes off with no tools and lies in the box with the seat cushion; the back then flips flat.`,
  });

  // The Velcro Industrial bond is on the panel's front face (local z = plyT) and the pad's back face (its local z = 0), at the pad's center.
  const panelGlue = parts.find((q) => q.id === 'seat-back-panel')?.joints?.find((j) => j.to === 'seat-back-pad');
  if (panelGlue) panelGlue.at = [[0, h0 + padH / 2, plyT]];
  const padGlue = parts.find((q) => q.id === 'seat-back-pad')?.joints?.find((j) => j.to === 'seat-back-panel');
  if (padGlue) padGlue.at = [[0, padH / 2, 0]];

  // Hinges (D-57): two 316 butt hinges, knuckle at the stile's front foot P along y, leaves screwed to the front face and, through the deck, into an oak backer pad under it.
  const hb = hingeBacker(p, L);
  const f4 = (v: number) => v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  const buttIdx = L.joistX.findIndex((jx) => Math.abs(jx - L.joistT / 2 - hb.x1) < 1e-6); // the joist the pad is butted against, if any
  // D-72: the hinge screw crosses the 1/16 in leaf and the deck, then bites the backer pad.
  const hingeFit = pickWoodScrew(8, HINGE_LEAF_THICK_IN + L.ply, HINGE_BACKER_THICK_IN);
  const pinPadHalfIn = 4 * 2 * PIN_R_IN; // 4 pin diameters (1.5 in) from the pin to the end of the pad (the pin hole is the closest thing to an edge)
  for (const { s: sg, tag } of SIDES) {
    parts.push(cylinder(ctx, {
      id: `seat-hinge-${tag}`, partNo: 'seat-hinge', name: `Seat-back hinge ${tag}`, group: 'seat', mat: 'fixed', massLb: HINGE_MASS_LB, kind: 'purchased',
      material: `${stainless(p)} butt hinge, 2" × 2" open`, fab: 'buy', step: STEP.seatStorage, axis: 'y', radius: HINGE_R_IN, length: HINGE_LEN_IN,
      center: [s.P[0], sg * hingeY, s.P[2]], explode: unit(0, sg, 0.4),
      sourcing: { vendor: `McMaster-Carr (${stainless(p)} butt hinge, 2" knuckle, 1" leaves)`, costUsd: 9 },
      joints: [
        { type: 'screw', to: 'seat-back-panel', count: 3, diaIn: 0.19, size: `#10-32 × 3/8 ${stainless(p)} flat-head machine screws into the epoxied 5/16 stainless threaded inserts in the front face of the panel (3/8 in, not 1/2 in: the leaf is about 1/16 in, so the screw bites 5/16 in and cannot bottom in the 11/32 in hole)`, note: 'D-75: leaf on the seat back\'s FRONT face; the screws go in from the front, through the leaf, into the inserts set in that same front face (not the back)', at: holeK.map((k): Vec3 => [s.col2[0] * leafV, s.col2[2] * leafV, -sg * k * HINGE_HOLE_PITCH_IN]) },
        { type: 'screw', to: `seat-hinge-backer-${tag}`, count: 3, diaIn: SCREW_DIA_IN[8], fit: hingeFit, size: `${screwText(hingeFit)} ${stainless(p)} flat head, through the deck into the ${f2(HINGE_BACKER_THICK_IN)} in backer pad (${f2(hingeFit.lenIn - hingeFit.gripIn)} in of bite)`, note: 'leaf on the deck (the cushion\'s rear margin lies over it)', at: holeK.map((k): Vec3 => [leafV, -HINGE_R_IN, -sg * k * HINGE_HOLE_PITCH_IN]) },
      ],
      notes: 'The back flips forward 105° about this knuckle onto the deck (D-57). The leaf on the deck is under the 3/8" gap behind the cushion (a 1/16" proud leaf does not show in the cargo bed).',
    }));
  }
  // One oak pad per side (D-63, build 3c-8; it was one 16.5 in strip 3 in wide and 3/4 in thick): 1 in thick for the blind flat-position pin hole, from 9 in forward to BUTTED against the next joist
  // so the flat pin lands in solid oak (the joist is glued behind the pad), 3 in wide across (1.5 in each side of the pin = 4 pin diameters, the hinge's 2 in knuckle inside it).
  // D-75 (readability review MUST-15c): the backer's holes are placed from the real fasteners, not by the bounding-box locator (the pin is modeled UPRIGHT, so the locator put the flat-pin hole
  // 5/32 in from the pad's rear end, where a 3/8 in hole would break out). The hinge screws are the hinge's own deck-leaf points; the flat pin is at P + c2L, 4 pin diameters from the sides.
  const colMul = (m: number[], v: Vec3): Vec3 => [0, 1, 2].map((k) => m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k]) as Vec3;
  for (const { s: sg, tag } of SIDES) {
    const yc = sg * sup.stileY;
    const hinge = parts.find((q) => q.id === `seat-hinge-${tag}`);
    const hingeWorld = (hinge?.joints?.find((j) => j.to === `seat-hinge-backer-${tag}`)?.at ?? []).map((q) => colMul(hinge!.transform, q));
    const pinWorld: Vec3 = [s.P[0] + sup.c2L, yc, L.deckBot];
    const bk = box(ctx, {
      id: `seat-hinge-backer-${tag}`, partNo: 'seat-hinge-backer', name: `Seat-back hinge and pin backer ${tag}`, group: 'seat', mat: 'oak', step: STEP.frame, grain: 'y',
      ...span([hb.x0, hb.x1], [yc - pinPadHalfIn, yc + pinPadHalfIn], [L.deckBot - HINGE_BACKER_THICK_IN, L.deckBot]),
      joints: [
        { type: 'glue', to: 'deck', count: 1, note: 'epoxy to the underside of the deck, before the frame goes on' },
        ...(buttIdx >= 0 ? [{ type: 'glue' as const, to: joistId(L, buttIdx), count: 1, note: 'butt the pad to the crossmember face (the pin sits in solid oak across the glue line)' }] : []),
        { type: 'screw', to: `seat-hinge-${tag}`, count: 3, diaIn: SCREW_DIA_IN[8], fit: hingeFit, size: `${screwText(hingeFit)} ${stainless(p)}, from the hinge leaf down through the deck` },
        { type: 'pin', to: `seat-pin-${tag}`, count: 1, diaIn: 2 * PIN_R_IN, size: `3/8" blind hole ${f4(lg.flatHoleIn)}" deep (flat latch), through the 12 mm deck first, with a 1/16" annular detent groove ${f4(lg.flatGrooveIn)}" below the deck`, note: `leaves ${f4(lg.flatLeftIn)}" of oak under the hole` },
      ],
      notes: `Holes (D-75): the 3 hinge screws ${f2(hingeWorld.length ? hingeWorld[0][0] - hb.x0 : 0)}" from the rear end; the 3/8" flat-pin hole ${f2(pinWorld[0] - hb.x0)}" from the rear end (${f2(hb.x1 - pinWorld[0] - PIN_R_IN)}" of oak from the hole to the front end), centered across. Oak pad ${HINGE_BACKER_THICK_IN}" thick, glued under the 12 mm deck at each hinge so the hinge screws AND the flat-position pin hole bite oak, not ply (D-57, D-63). It runs from ${hb.x0.toFixed(2)}" (a half inch behind the hinge axis) forward to ${hb.x1.toFixed(2)}", where it BUTTS the face of the next crossmember, so the flat pin (${(s.P[0] + sup.c2L).toFixed(2)}", ${(hb.x1 - (s.P[0] + sup.c2L)).toFixed(2)}" from the pad end and in line with the crossmember behind it) lands in solid oak; it is ${(2 * pinPadHalfIn).toFixed(0)}" across, ${pinPadHalfIn}" (4 pin diameters) each side of the pin station. Grain across the sled. Drill the pin hole through the deck and ${f4(lg.flatHoleIn)}" into the pad (a drill stop), 1/16" groove for the detent ball ${f4(lg.flatGrooveIn)}" below the deck, epoxy-lined, when the seat is installed: ${f4(lg.flatLeftIn)}" of oak is left under the hole. Replaces the one-piece 3/4 in strip (lighter by about 0.4 lb).`,
    });
    for (const j of bk.joints ?? []) {
      if (j.to === `seat-hinge-${tag}` && hingeWorld.length === j.count) j.at = hingeWorld.map((w): Vec3 => toLocal(bk.transform, [w[0], w[1], L.deckBot]));
      if (j.to === `seat-pin-${tag}`) j.at = [toLocal(bk.transform, pinWorld)];
    }
    parts.push(bk);
  }

  // Quick-release pins: ride in the panel holes. Upright: through the panel into the stop block (modeled here, head on the front face); flat: see seat-stow.ts.
  for (const { s: sg, tag } of SIDES) {
    parts.push(cylinder(ctx, {
      id: `seat-pin-${tag}`, partNo: 'seat-pin', name: `Seat-back latch pin ${tag}`, group: 'seat', mat: 'fixed', massLb: PIN_MASS_LB, kind: 'purchased',
      material: `${stainless(p)} quick-release spring-detent pin, 3/8" × 1-1/2" usable length, lanyard`, fab: 'buy', step: STEP.seatStorage, removable: true,
      // The cylinder is the usable length (the tip at c0 = -PIN_LEN) plus the button head (to c0 = +PIN_HEAD): head seated on the panel's front face (c0 = 0).
      axis: 'x', radius: PIN_R_IN, length: PIN_LEN_IN + PIN_HEAD_IN, rot: { y: -a }, center: at((PIN_HEAD_IN - PIN_LEN_IN) / 2, pinZ, sg * sup.stileY), explode: unit(0.6, sg * 0.3, 0.8),
      sourcing: { vendor: 'McMaster-Carr (quick-release pin, 3/8" diameter, 1-1/2" usable length, with lanyard; SPRING-DETENT ball, because both holes are blind and a ball-lock pin does not retain in a blind hole): VERIFY the exact part, the distance from its tip to the ball and the head height, and prove it in a scrap block before drilling the real ones', costUsd: 9 },
      notes: `No tools: push the button and slide it out or in (D-57). UPRIGHT (head on the panel face): through the ${(t * 25.4).toFixed(0)} mm panel and ${f4(lg.upTipIn)}" into the stop block, in a BLIND hole ${f4(lg.upHoleIn)}" deep (the block is ${lg.blockIn.toFixed(2)}" thick along the pin there, so ${f4(lg.upLeftIn)}" of oak is left behind the hole and the thin box end is never reached; the detent ball seats in a 1/16" groove ${f4(lg.upGrooveIn)}" from the mouth), so the back cannot flip forward. FLAT (back flipped forward, head up on the panel's rear face): through the same hole, the 12 mm deck and ${f4(lg.flatTipIn)}" into the oak backer pad, in a blind hole ${f4(lg.flatHoleIn)}" deep (groove ${f4(lg.flatGrooveIn)}" below the deck). Both grooves are 1/16" wide and about 1/32" deep, cut with a small hook tool or a ground-down Allen key; measure where the ball sits on the real pin first. The pin head stands about ${PIN_HEAD_IN}" proud of the panel face at cushion-top height: if it touches the cushion (the cushion is set 3/8" back), notch the foam's rear corners. The lanyard clips to the panel when the pin is out.`,
    }));
  }

  // Stop blocks behind each stile ("wedges", D-40, D-57): fixed oak blocks glued to the deck against the storage box end. The rider's aft load bears on the crest; the pin holds the back against them.
  const wedgeW = fw;
  const depthX = Math.max(...sup.wedge.map((q) => q[0])) - Math.min(...sup.wedge.map((q) => q[0]));
  const zA = Math.max(...sup.wedge.map((q) => q[1]));
  const wedgeFit = pickWoodScrew(8, L.ply, zA - sup.zb); // the clamping screws cross the deck and bite the block
  for (const { s: sg, tag } of SIDES) {
    const j: Joint[] = [{ type: 'glue', to: 'deck', count: 1, note: 'epoxy to the deck (and screwed from below)' },
      { type: 'screw', to: 'deck', count: 2, diaIn: SCREW_DIA_IN[8], fit: wedgeFit, size: `2 × ${screwText(wedgeFit)} ${stainless(p)} flat-head screws up from below through the deck and ${f2(wedgeFit.lenIn - wedgeFit.gripIn)} in into the block`, note: 'clamping screws for the epoxy bed; countersink the heads in the deck underside' }];
    if (sup.rear) j.push({ type: 'glue', to: 'storage-end-fore', count: 1, note: 'epoxy to the box end; the push of the rider goes into the box through it' });
    j.push({ type: 'pin', to: `seat-pin-${tag}`, count: 1, diaIn: 2 * PIN_R_IN, size: `3/8" blind hole ${f4(lg.upHoleIn)}" deep (upright latch), with a 1/16" annular detent groove ${f4(lg.upGrooveIn)}" from the mouth`, note: `drilled square to the back's rear face ${pinZ.toFixed(2)}" up from the hinge axis; the block is ${lg.blockIn.toFixed(2)}" thick along the hole there, so ${f4(lg.upLeftIn)}" of oak is left behind it (set from the block outline, never into the box end); a ball-lock pin does not retain in a blind hole (build 3c S4)` });
    parts.push(profilePart(ctx, {
      id: `seat-wedge-${tag}`, partNo: 'seat-wedge', name: sup.rear ? `Seat back stop block ${tag}` : `Seat back post ${tag}`, group: 'seat', mat: 'oak',
      outline: sup.wedge, depth: wedgeW, basis: 'xz', origin: [0, sg * sup.stileY + wedgeW / 2, 0], grain: 'y', // local y is the vertical (the wedge is drawn in xz): vertical grain
        step: STEP.seatStorage,
      stock: { t: wedgeW, w: depthX, l: zA - sup.zb }, explode: [0, 0, -1], joints: j,
      notes: `Shaped to the back angle (bandsaw + plane) and FIXED (D-57): glued against the box end and the deck, so nothing is loose in the bed. The back leans on its crest; the latch pin goes into a blind 3/8" hole in its sloped face, ${pinZ.toFixed(2)}" up from the hinge axis (D-63): ${lg.blockIn.toFixed(2)}" of block along the pin there, hole ${f4(lg.upHoleIn)}" deep with a drill stop, ${f4(lg.upLeftIn)}" of oak behind it. In cargo mode the back flips forward and this block is a 1" wedge of oak at the box end.`,
    }));
  }

  // Crest strip (D-62, D-63): the bare panel needs a continuous line to lean on; a thin full-width oak strip between the two stop blocks, the top slice of the same wedge, bedded on the box end.
  // D-63 (build 3c-8): it now spans the WHOLE gap between the blocks (13.5 in, it was a 6.7 in center piece). The lid hinges (storage.ts: 2.5 in leaves, 3/4 in inboard of the stop blocks) stand
  // LID_HINGE_STANDOFF_IN proud of the same box end at the same height, so the strip's glue face is held that far off the end: a 1/8 in bed of thickened epoxy over the box end and the hinge leaves
  // (the leaves are screwed on before the strip goes on). The panel still leans on the same sloped crest line.
  {
    const yIn = sup.stileY - fw / 2; // half width of the strip: out to the inner faces of the stop blocks
    if (yIn > 0.5) {
      const c2x = s.col2[0], c2z = s.col2[2];
      const zAt = (c2: number) => s.Pr[2] + c2z * c2;
      const xAt = (c2: number) => s.Pr[0] + c2x * c2;
      const c2lo = Math.max(0, sup.c2A - CREST_STRIP_IN);
      const xAft = sup.rear ? sup.xv + LID_HINGE_STANDOFF_IN + 0.01 : sup.xv; // clear of the lid hinge leaves on a box end
      const outline: Vec2[] = [[xAft, zAt(c2lo)], [xAt(c2lo), zAt(c2lo)], [xAt(sup.c2A), zAt(sup.c2A)], [xAft, zAt(sup.c2A)]];
      parts.push(profilePart(ctx, {
        id: 'seat-crest-strip', partNo: 'seat-crest-strip', name: 'Seat back crest strip', group: 'seat', mat: 'oak', outline, depth: 2 * yIn, basis: 'xz', origin: [0, yIn, 0], grain: 'z', step: STEP.seatStorage, // local z (the extrusion depth) runs across the sled: grain across, along the 13.5 in strip
       
        stock: { t: Math.max(0.25, xAt(sup.c2A) - xAft), w: CREST_STRIP_IN, l: 2 * yIn }, explode: [0, 0, -1],
        joints: [
          { type: 'glue', to: 'seat-wedge-L', count: 1, note: 'epoxy, end to end with the stop block' }, { type: 'glue', to: 'seat-wedge-R', count: 1, note: 'epoxy, end to end with the stop block' },
          ...(sup.rear ? [{ type: 'glue' as const, to: 'storage-end-fore', count: 1, note: `epoxy bed (thickened, about ${LID_HINGE_STANDOFF_IN + 0.01} in thick over the lid-hinge leaves) to the box end across the whole width (the rider's push goes into the box through it)` }] : []),
        ],
        notes: `D-62, D-63: the bare 12 mm seat-back panel leans on this ${(2 * yIn).toFixed(1)}" × ${CREST_STRIP_IN}" oak strip, which is the top slice of the stop-block wedge continued between the two blocks, so the panel is supported along the whole crest line and bends only as a strip above it (without it the panel would span ${(2 * sup.stileY).toFixed(1)}" between the blocks and overstress). It spans the full ${(2 * yIn).toFixed(1)}" gap between the blocks (13.5 in at the defaults; buy 6/4 stock ${CREST_STRIP_IN}" wide, a 15 in board), end to end with each block. ${sup.rear ? `On a box end the lid hinges (2.5 in leaves, ${LID_HINGE_STANDOFF_IN} in proud) are in its way: screw the hinges on first, then bed the strip in a ${(LID_HINGE_STANDOFF_IN + 0.01).toFixed(2)}" layer of thickened epoxy over the box end and the leaves (the strip's sloped crest face is where the panel leans, unchanged), clamp it with a caul from the front. ` : ''}Glued to the box end and to the blocks.`,
      }));
    }
  }

  // Grab boards (D-57, D-84): one oak board per side, standing on the gunwale top and bolted through the gunwale, with a Shaper Origin-routed hand hole (replaces the pad, two posts and bar).
  {
    const F = gripFrame(p, L);
    const { bLen, nTop, nBot, nMid, slope, uShift, gxA, z0g, W, tn } = F;
    const holeBot = p.grabBoardFootIn;
    // The board in its own flat (u, n) frame, turned to the slope by its transform (Phase 4 round 2). Vertical ends: a parallelogram in this frame; the two top corners are rounded.
    const rr = Math.min(p.grabBoardCornerIn, p.grabBoardBarIn);
    const rect: Vec2[] = [[F.uRear(nBot), nBot], [F.uFront(nBot), nBot], [F.uFront(nTop), nTop], [F.uRear(nTop), nTop]];
    const outline = roundCorners(rect, [2, 3], rr);
    const stockL = Math.max(...outline.map((q) => q[0])) - Math.min(...outline.map((q) => q[0]));
    // CCW in world (x, z)
    const hl = p.grabHoleLengthIn, hh = p.grabHoleHeightIn;
    const hole: Vec2[] = [];
    const cu0 = uShift, cn0 = nMid;
    const rh = hh / 2, straight = Math.max(0, hl - hh) / 2;
    for (let i = 0; i <= 8; i++) { const aa = -Math.PI / 2 + (Math.PI * i) / 8; hole.push([cu0 + straight + rh * Math.cos(aa), cn0 + rh * Math.sin(aa)]); }
    for (let i = 0; i <= 8; i++) { const aa = Math.PI / 2 + (Math.PI * i) / 8; hole.push([cu0 - straight + rh * Math.cos(aa), cn0 + rh * Math.sin(aa)]); }
    const bt = p.grabBoardThickIn;
    // Through the board, the inner band, the web, the outer band and the strip (the head bears on the strip, in the cap's hole); a fender washer and a nylock nut on the board: stocked bolt length, rounded up.
    const gripStack = bt + 2 * L.sideBand + thinSheet(p).thicknessIn + GRIP_BACKING_T_IN;
    const gripBoltLen = boltLength(gripStack, GRIP_BOLT_DIA_IN, 1);
    // Columns: bLen/3 apart, centered on the hole and slid so each column's distance to the leaning ends is the same at the bolt rows.
    const colShift = (nMid + (GRIP_BOLT_ROWS_IN[0] + GRIP_BOLT_ROWS_IN[1]) / 2) * tn;
    const bolts: Vec2[] = gripBolts(bLen).map(([e, d]): Vec2 => [uShift + colShift + e, -d]);
    // Strip (in the sloped frame, square ends) and cap (vertical ends), centered on the bolt columns on the band: n from the cap's top at the gunwale top down to the band's bottom.
    const sLen = gripBackingLen(bLen), cLen = gripCapLen(bLen);
    const sc = uShift + colShift; // u of the bolt-pattern center
    const sn0 = -(GRIP_BOLT_ROWS_IN[0] + GRIP_BOLT_ROWS_IN[1]) / 2 - GRIP_BACKING_H_IN / 2, sn1 = sn0 + GRIP_BACKING_H_IN;
    const capOutlineU: Vec2[] = roundCorners([[F.uRear(nBot), nBot], [F.uFront(nBot), nBot], [F.uFront(0), 0], [F.uRear(0), 0]], [0, 1, 2, 3], GRIP_CAP_CORNER_IN); // the cap in the board's flat frame (vertical ends, corners eased)
    for (const { s: sg, tag } of SIDES) {
      const gid = gunwaleId(p, tag);
      // The board and the cap are flat; the side turns in toward the bow past x = 20 in, so they stand on the face at the board's FRONT end (the farthest in) and the rear is bedded (a gap of 1/16 in at most; the validator warns past that).
      const yIn = sg * (innerHalfWidth(L, F.xFront - GRIP_PLANE_SETBACK_IN)); // inner face of the gunwale at the board
      // basis 'xz' extrudes toward -y from origin.y: the +y face of the board is the one nearer the gunwale for the left side
      const originY = sg > 0 ? yIn : yIn + bt;
      parts.push(profilePart(ctx, {
        id: `seat-grip-${tag}`, partNo: 'seat-grip', name: `Grab board ${tag}`, group: 'seat', mat: 'oak', outline, holes: [cw2(hole)], depth: bt, basis: 'xz', origin: [gxA, originY, z0g], rotation: -slope,
        grain: 'x', step: STEP.finish, stock: { t: bt, w: nTop - nBot, l: stockL }, fab: 'shaper-origin',
        joints: [{ type: 'bolt', to: gid, count: GRIP_BOLTS, diaIn: GRIP_BOLT_DIA_IN, size: `1/4" × ${inchesText(gripBoltLen)} ${stainless(p)} button-head cap screws (the stack is ${frac(gripStack)}": board ${frac(bt)}", inner band ${frac(L.sideBand)}", web ${frac(p.panelPlyIn)}", outer band ${frac(L.sideBand)}", strip ${frac(GRIP_BACKING_T_IN)}"), ${GRIP_BOLT_COLS} in the upper row (${frac(GRIP_BOLT_ROWS_IN[0])}" below the gunwale top) and ${GRIP_BOLT_COLS - 1} in the lower row between them (${frac(GRIP_BOLT_ROWS_IN[1])}" below it), through the board, the inner band, the web, the outer band and the ${frac(GRIP_BACKING_T_IN)}" ${stainless(p)} backing strip (the head bears on the strip, under the oak cap; a nylock nut and a fender washer on the inside of the board: 1-1/2" under the upper three, 7/8" under the lower two; hold the nut, turn the hex key)`, at: bolts.map(([bu, bn]): Vec3 => [bu, bn, bt / 2]), note: `the board laps the inboard face of the inner gunwale band; the screws pass through the inner band, the web and the outer band inside the ${frac(L.railBand)}" gunwale band; the heads bear on the backing strip, not on the ${frac(L.sideBand)}" outer band` }],
        notes: `Grab board: ${frac(bt)}" oak, ${frac(bLen)}" long along the sheer and ${frac(nTop - nBot)}" tall (${frac(stockL)}" overall at the cut). The lower ${frac(L.railBand)}" laps the inboard face of the gunwale and ${frac(nTop)}" stands above its top; the board is square to the gunwale, so its bottom edge follows the ${((slope * 180) / Math.PI).toFixed(0)}° fall of the sheer. Both ends are plumb (straight up and down, like the ribs and the transom), so the board is a parallelogram on the sheer. Round the two top corners to a ${frac(rr)}" radius. The hand hole is ${frac(hl)}" × ${frac(hh)}" with full-round ends, Shaper Origin-routed, centered along the board (${frac((bLen - hl) / 2)}" of oak at each end of the hole, measured along the sheer at the hole's mid-height) with ${frac(holeBot)}" of oak between the gunwale top and the hole and ${frac(p.grabBoardBarIn)}" above it. The hole's center is ${frac(F.xh - p.seatXIn)}" ahead of the hip point, which is ${frac(p.seatBehindHpointIn)}" ahead of the rear edge of the seat cushion, and ${frac(F.xh - L.xSideStart)}" from the rear end of the side. Screws (all measured down from the top edge of the gunwale, the board's ${frac(L.railBand)}" lap): three in an upper row ${frac(GRIP_BOLT_ROWS_IN[0])}" down and ${frac(bLen / GRIP_BOLT_COLS)}" apart, centered on the hole, and two in a lower row ${frac(GRIP_BOLT_ROWS_IN[1])}" down, ${frac(bLen / GRIP_BOLT_COLS)}" apart and centered between the upper ones. Ease every edge and the hole with a ¼" roundover. `,
      }));
      const yOut = sg * (L.hwC + L.side - L.turnIn(F.xFront - GRIP_PLANE_SETBACK_IN));
      // Strip: 316 flat bar 1/8 x 1-1/4, square ends along the sheer, bedded on the outer band, hidden under the cap.
      const bu0 = sc - sLen / 2, bu1 = sc + sLen / 2;
      const strip = profilePart(ctx, {
        id: `seat-grip-backing-${tag}`, partNo: 'seat-grip-backing', name: `Grab board bolt backing strip ${tag}`, group: 'seat', mat: 'print',
        outline: [W(bu0, sn0), W(bu1, sn0), W(bu1, sn1), W(bu0, sn1)], depth: GRIP_BACKING_T_IN, basis: 'xz', origin: [0, sg > 0 ? yOut + GRIP_BACKING_T_IN : yOut, 0], step: STEP.finish, fab: 'bandsaw',
        joints: [
          { type: 'glue', to: `side-${tag}-gunwale`, count: 1, size: 'epoxied to the outer face of the outer gunwale band', note: 'spreads the five screw heads over the band' },
          { type: 'glue', to: `seat-grip-cap-${tag}`, count: 1, size: 'epoxied into the pocket on the back of the oak cap', note: 'the strip and the cap are one piece when bedded on the band' },
          // the screw holes, one on each screw line of the board (local frame = model x, z; mid-thickness)
          { type: 'hole', to: `side-${tag}-gunwale`, count: bolts.length, diaIn: GRIP_BOLT_DIA_IN + 1 / 32, size: `${bolts.length} holes 9/32" (a clearance for the 1/4" screws) through the strip, on the screw lines of the grab board; drill them with the board clamped on, one bit through every layer`,
            at: bolts.map(([bu, bn]): Vec3 => { const w = W(bu, bn); return [w[0], w[1], GRIP_BACKING_T_IN / 2]; }) },
        ],
        sourcing: { vendor: `McMaster-Carr or Speedy Metals (${stainless(p)} flat bar ${frac(GRIP_BACKING_T_IN)}" × ${frac(GRIP_BACKING_H_IN)}", a ${frac(sLen)}" piece, cut square on the metal bandsaw and deburred; cut and drill only)` },
        notes: `Backing strip for the ${GRIP_BOLTS} grab-board screw heads: ${stainless(p)} flat bar ${frac(GRIP_BACKING_T_IN)}" × ${frac(GRIP_BACKING_H_IN)}" × ${frac(sLen)}" that goes on the outside of the outer gunwale band, under the oak cap. It spreads the pull of the screw heads over the band, which is too thin to take them. Cut it square on the metal bandsaw and deburr the cut edges (cut and drill only, no bending or filing to shape). Drill it with the board clamped on, one bit through all the layers. It is epoxied to the band, and the oak cap is glued over it.`,
      });
      strip.kind = 'metal';
      strip.stock = { t: GRIP_BACKING_T_IN, w: GRIP_BACKING_H_IN, l: sLen }; // the cut list reads the flat-bar stock from here, not from the sourcing text
      strip.material = `${stainless(p)} flat bar`;
      strip.massLb = (GRIP_BACKING_T_IN * GRIP_BACKING_H_IN * sLen * p.steelDensityPcf) / 1728;
      parts.push(strip);
      // Oak cap over the strip (D-84): hides the strip and the screw heads; glued on after the screws are set.
      const headPts = gripBolts(bLen).map(([e, d]) => ({ e, d })).sort((x, y) => x.d - y.d || x.e - y.e);
      const headList = (row: number) => headPts.filter((h) => h.d === row).map((h) => `${frac(sc + h.e - F.uRear(-row))}"`).join(', ');
      const cap = profilePart(ctx, {
        id: `seat-grip-cap-${tag}`, partNo: 'seat-grip-cap', name: `Grab board oak cap ${tag}`, group: 'seat', mat: 'oak',
        outline: capOutlineU, depth: GRIP_CAP_T_IN, basis: 'xz', origin: [gxA, sg > 0 ? yOut + GRIP_CAP_T_IN : yOut, z0g], rotation: -slope, grain: 'x', step: STEP.finish,
        stock: { t: GRIP_CAP_T_IN, w: L.railBand, l: Math.max(...capOutlineU.map((q) => q[0])) - Math.min(...capOutlineU.map((q) => q[0])) }, fab: 'shaper-origin',
        joints: [
          { type: 'glue', to: `side-${tag}-gunwale`, count: 1, size: 'glued to the outer face of the outer gunwale band over the strip and the screw heads, after the screws are set (epoxy)', note: 'it is permanent: the heads and the strip are hidden under it' },
        ],
        notes: `Oak cap over the backing strip: ${frac(GRIP_CAP_T_IN)}" oak, ${frac(cLen)}" long along the sheer and ${frac(L.railBand)}" tall (the height of the gunwale band). Both ends are plumb and line up with the ends of the board; round the four corners to ${frac(GRIP_CAP_CORNER_IN)}". It is glued on after the screws are set and tightened, and it hides the strip and the five screw heads from outside. Rout these recesses in its back face on the Shaper (set the depth stop for each): (1) a recess for the strip, ${frac(GRIP_CAP_POCKET_IN)}" deep, ${frac(GRIP_BACKING_H_IN + 1 / 16)}" × ${frac(sLen + 1 / 16)}" (1/32" bigger than the strip all round), set ${frac(Math.max(0, sc - sLen / 2 - F.uRear(-0.75)))}" in from the rear end and ${frac(Math.max(0, F.uFront(-0.75) - (sc + sLen / 2)))}" in from the front end (measured along the sheer at its mid-height) and ${frac((L.railBand - GRIP_BACKING_H_IN) / 2)}" down from the top edge; (2) a ${frac(GRIP_CAP_HEAD_DIA_IN)}" round pocket for each screw head, a further ${frac(GRIP_CAP_HEAD_DEPTH_IN)}" deep inside the strip recess (${frac(GRIP_CAP_T_IN - GRIP_CAP_POCKET_IN - GRIP_CAP_HEAD_DEPTH_IN)}" of oak is left over each head), centered ${frac(GRIP_BOLT_ROWS_IN[0])}" down from the top edge for the upper three, at ${headList(GRIP_BOLT_ROWS_IN[0])} from the rear end, and ${frac(GRIP_BOLT_ROWS_IN[1])}" down for the lower two, at ${headList(GRIP_BOLT_ROWS_IN[1])} from the rear end (all measured along the sheer). Cut it from straight-grained stock.`,
      });
      cap.massLb = Math.max(0, cap.massLb - (((GRIP_CAP_POCKET_IN * (GRIP_BACKING_H_IN + 1 / 16) * (sLen + 1 / 16)) + GRIP_BOLTS * Math.PI / 4 * GRIP_CAP_HEAD_DIA_IN ** 2 * GRIP_CAP_HEAD_DEPTH_IN) * p.oakDensityPcf) / 1728);
      parts.push(cap);
    }
  }

  // D-60: the drop-in foot block and its four slot cleats are gone; the bow bulkhead is the only foot brace (D-57).
  return parts;
}

/** A hole loop must run clockwise. */
function cw2(o: Vec2[]): Vec2[] {
  return signedArea(o) <= 0 ? o : [...o].reverse();
}

/**
 * The gunwale bands' own ends of the grab-board screw joints (D-75 geometry audit). The screws are recorded on the board (and the steel backing strip) at their mid-thickness, which lies 5/16 in
 * inboard of the inner band (and 1/32 in outboard of the outer band), so the points the board and strip carry are not in the bands. Each band records its own end, at its own mid-thickness on the
 * same screw lines, so the drawings drill the bands from points that lie in them. The joint count matches the board's, so the screws are still counted once. Call after the model is built.
 */
export function addGripBandJoints(L: Layout, parts: Part[]): void {
  const worldPt = (q: Part, l: Vec3): Vec3 => { const m = q.transform; return [0, 1, 2].map((k) => m[k] * l[0] + m[4 + k] * l[1] + m[8 + k] * l[2] + m[12 + k]) as Vec3; };
  for (const { s: sg, tag } of SIDES) {
    const board = parts.find((x) => x.id === `seat-grip-${tag}`), strip = parts.find((x) => x.id === `seat-grip-backing-${tag}`);
    const inner = parts.find((x) => x.id === `side-${tag}-gunwale-in`), outer = parts.find((x) => x.id === `side-${tag}-gunwale`);
    const bj = board?.joints?.find((j) => j.to === inner?.id && j.type === 'bolt');
    if (board && inner && bj?.at) {
      const at = bj.at.map((l): Vec3 => { const w = worldPt(board, l); return localPoint(inner.transform, [w[0], sg * (innerHalfWidth(L, w[0]) + L.sideBand / 2), w[2]]); });
      (inner.joints ??= []).push({ ...bj, to: board.id, at });
    }
    const hj = strip?.joints?.find((j) => j.to === outer?.id && j.type === 'hole');
    if (strip && outer && hj?.at) {
      const at = hj.at.map((l): Vec3 => { const w = worldPt(strip, l); return localPoint(outer.transform, [w[0], sg * (L.hwC + L.side - L.turnIn(w[0]) - L.sideBand / 2), w[2]]); });
      (outer.joints ??= []).push({ ...hj, to: strip.id, at });
    }
  }
}
