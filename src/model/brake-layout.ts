/**
 * Plan of the scooter-style STEP BRAKE (Phase 3c-4b, D-57 item 8; pull-pin pivot, D-65): ONE pure source for where the oak flap, its pivot, the pad on the tread, the bungee, the outrigger
 * (knee) and its backer, and the wheel chock sit, shared by `model/brake.ts` (the parts), `analysis/brake.ts` (the checks) and the tests. Plain TS, no three.js.
 * Model frame: +X forward, +Y left, +Z up, origin on the ground under the rear-axle center; inches. Planar numbers are (x, z) in the vertical plane of one wheel;
 * the right side mirrors the left. Every y position follows the wheels (`rearTrackIn`, `tireWidthIn`), the hull (`hwC + side`) and the rail, never a typed number.
 *
 * The mechanism (a kick-scooter fender brake, no welding, no custom steel):
 *   • An oak FLAP lies over each rear tire, a Shaper-cut tapered fender: its front end narrows to a TONGUE that carries a small oak PIVOT BLOCK and enters a slot in the
 *     rear of an oak OUTRIGGER ("knee") AHEAD of the tire (pin at x = r + brakePivotAheadIn); a 3/8" 316 stainless clevis pin through the knee ears, the tongue and the
 *     block (double shear, held by a hitch-pin clip) is the pivot, and PULLING IT lets the flap come off (D-65). The knee is bolted through the hull rail into an oak BACKER
 *     glued to the inside of the rail. The flap reaches back over the tire to a foot tread that ENDS at the rear transom face (D-65; the handler stands behind the transom
 *     and steps on it with one foot while pushing with the handlebow).
 *   • Under the flap a wedge-shaped oak SHOE BLOCK carries a rubber / leather PAD on the tread, `brakePadAngleDeg` behind the top of the tire. Stepping down swings the
 *     flap about the pivot pin and presses the pad on the tread. Lever ratio = (pin to foot) / (pin to the pad, measured on the line of action of the pad force).
 *   • A BUNGEE cord from the flap to an eye screw in the rear transom lifts the flap (a stop cord limits the lift); the model default is the released pose.
 *   • Two oak wedge CHOCKS hang on cords from the knees and park the sled (a ramp the tire has to climb, `brakeChockAngleDeg`).
 *
 * Pose s ∈ [0, 1]: 1 is APPLIED (the pad on the tread), 0 is RELEASED (the model default). The geometry below is built in the applied pose and the released pose
 * is the whole flap group turned clockwise (seen with +x right, +z up) by `theta` about the pivot pin, so the pad hangs `brakePadGapIn` above the tread.
 */
import { KNEE_MOUNT, type Params } from '../params';
import type { Layout } from './layout';
import { LASH_HOLE_DZ_IN, LASH_WASHER, ribBlockWidth, ribBlockZ0, sideRibStations, topPinZ, boxTieGeometry } from './side-ribs';

export type V2 = [number, number];

const RAD = Math.PI / 180;
/** The side sign ends at this x (in) and the brake knee starts at or ahead of it (D-57 item 9). */
export const SIGN_X_MAX_IN = 6;
/** Where the flap's plan flare starts, measured behind the knee's rear face (in): the widening shoulder stays this far clear of the knee while the flap swings (a fabrication rule). */
export const SHOULDER_CLEAR_IN = 0.5;
/** Lift of a screw eye's ring above its face (in): a purchased-part size. */
export const EYE_LIFT_IN = 0.35;
/** The bungee eye is a screw eye in the flap's rear END face, this far in from the flap's inboard edge (in): a fabrication rule. Its ring reaches EYE_LIFT_IN behind the end, which lets the cord clear the hull's rear corner. */
export const EYE_INSET_IN = 0.8;
/** Corner radii of the Shaper-cut flap outline (in): the foot end and the pivot tongue's nose. */
export const FLAP_REAR_CORNER_IN = 0.5;
export const FLAP_NOSE_CORNER_IN = 0.25;
/** Pivot-block screws (#10) stay this much clear of the pin's cross hole edge (screw body to hole edge, in) and this far from the block's end and the tongue's edges (screw center): fabrication rules. */
export const PIVOT_SCREW_WOOD_IN = 0.375;
export const PIVOT_SCREW_EDGE_IN = 0.25;
/** Nominal finished layer of the face-laminated knee (D-74: 3/4 in from 4/4); the layer count is the knee depth over this, rounded. */
export const KNEE_LAYER_NOMINAL_IN = 0.75;
/** Head height of a 3/8 in hex nylock nut's bearing face, as a radius: half the 9/16 in across-flats (the plate's overhang past it is checked, D-75). */
export const KNEE_NUT_FLAT_R_IN = 0.28125;

/** One face-glued layer of the knee (D-75): its x range (rear to front) and the axis its grain runs along ('y' along the arm, 'z' up the bolted leg). */
export interface KneeLayer { x0: number; x1: number; grain: 'y' | 'z' }

/**
 * Cross-lamination of the brake knee (D-75, CLT style, balanced; flipped by D-77). The layers alternate starting UPRIGHT ('z') at the rear, so with 3 layers it is z / y / z: the two
 * outer layers run long grain from the leg bottom up through the shoulder to the top (the leg cannot split off) and take the pivot strap's screws in SIDE grain; the center layer runs
 * long grain along the arm ('y') and carries the arm and the pocket's roof and floor out to the strap. D-75 had y / z / y because its FRONT layer alone carried the outboard ear across
 * the slot; D-77 removed the ear.
 */
export function kneeLayers(x0: number, x1: number): KneeLayer[] {
  const n = Math.max(1, Math.round((x1 - x0) / KNEE_LAYER_NOMINAL_IN));
  const t = (x1 - x0) / n;
  return Array.from({ length: n }, (_, i): KneeLayer => ({ x0: x0 + i * t, x1: x0 + (i + 1) * t, grain: i % 2 === 0 ? 'z' : 'y' }));
}
/** The stocked 4/4 board's width (in): a knee layer wider than this across its grain is edge-glued from two pieces (mirrors the cut list's board width). */
export const KNEE_BOARD_WIDTH_IN = 6;
/** The across layer's edge joint stays this far from the shoulder and the top bolt hole (in, D-75). */
export const KNEE_JOINT_CLEAR_IN = 0.75;
/** D-77: the strap's #8 screw holes (3/16 in) stay this far from its ends: 1.6 hole diameters of metal (a fabrication rule). */
export const STRAP_SCREW_EDGE_IN = 0.3;
/** The cross hole for the clevis pin is drilled this much over the pin (in). */
export const PIVOT_HOLE_CLEAR_IN = 1 / 32;
/** The pin enters the knee's inboard ear this deep (blind hole) and its cross hole for the clip sits this far beyond the strap's outboard face (in, D-77): a purchased-pin size. */
export const PIN_BLIND_IN = 1;
export const PIN_STICKOUT_IN = 0.55;
/** NDS wet-service factor C_M on screw withdrawal (Table 11.3.3): a code constant, not a design number. */
export const WITHDRAWAL_WET_CM = 0.7;
/** Small tolerance when two faces are meant to touch (in). */
export const TOUCH_IN = 0.02;

export const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
export const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
export const dot2 = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
/** Moment about the +y axis of a force (fx, fz) at the point r (x, z), taking z → x as positive: M = rz·fx − rx·fz. Positive M raises a point behind the pivot (rx < 0). */
export const momentY = (r: V2, f: V2) => r[1] * f[0] - r[0] * f[1];
export const norm2 = (a: V2) => Math.hypot(a[0], a[1]);

/** Rotate `p` counter-clockwise (seen with +x right, +z up) by `th` about `c`. */
export function rot2(p: V2, c: V2, th: number): V2 {
  const x = p[0] - c[0], z = p[1] - c[1];
  const co = Math.cos(th), si = Math.sin(th);
  return [c[0] + x * co - z * si, c[1] + x * si + z * co];
}

export const rectPts = (c: V2, w: number, h: number): V2[] => [[c[0] - w / 2, c[1] - h / 2], [c[0] + w / 2, c[1] - h / 2], [c[0] + w / 2, c[1] + h / 2], [c[0] - w / 2, c[1] + h / 2]];

export function polyArea(poly: V2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; a += x1 * y2 - x2 * y1; }
  return a / 2;
}

/** Convex hull, counter-clockwise (Andrew's monotone chain). */
export function hull2(pts: V2[]): V2[] {
  const q = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: V2[] = [];
  for (const v of q) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], v) <= 0) lo.pop(); lo.push(v); }
  const hi: V2[] = [];
  for (const v of [...q].reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], v) <= 0) hi.pop(); hi.push(v); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/** Signed separation of two CONVEX polygons (separating-axis test): positive = the gap along the best axis (a lower bound of the true distance), negative = penetration depth. */
export function convexGap(A: V2[], B: V2[]): number {
  let best = -Infinity;
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const nx = b[1] - a[1], nz = a[0] - b[0];
      const n = Math.hypot(nx, nz);
      if (n < 1e-12) continue;
      const proj = (q: V2) => (q[0] * nx + q[1] * nz) / n;
      const pa = A.map(proj), pb = B.map(proj);
      best = Math.max(best, Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
    }
  }
  return best;
}

/** [low, high] of a polygon's section along the line x = `x` (null when the line misses it); for a non-convex shape this is the hull of the cut. */
export function polyZAt(poly: V2[], x: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[0] - x) * (b[0] - x) > 0) continue;
    if (Math.abs(b[0] - a[0]) < 1e-12) { lo = Math.min(lo, a[1], b[1]); hi = Math.max(hi, a[1], b[1]); continue; }
    const z = a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    lo = Math.min(lo, z); hi = Math.max(hi, z);
  }
  return Number.isFinite(lo) ? [lo, hi] : null;
}

/** Distance from a point to a polygon's boundary (positive outside, negative inside) for a CONVEX polygon. */
export function pointPolyGap(pt: V2, poly: V2[]): number {
  let best = -Infinity;
  const area = polyArea(poly);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const n = Math.hypot(ex, ez) || 1;
    // outward normal for a CCW polygon is (ez, -ex)
    const sgn = area >= 0 ? 1 : -1;
    best = Math.max(best, (sgn * ((pt[0] - a[0]) * ez - (pt[1] - a[1]) * ex)) / n);
  }
  return best;
}

/** Positions across the sled (|y|, left side; the right side mirrors). */
export interface BrakeY {
  /** Wheel center, tire inner and outer faces. */
  wheel: number; tireIn: number; tireOut: number;
  /** Flap |y| range, tongue |y| range, pad |y| range. */
  flap: [number, number]; tongue: [number, number]; pad: [number, number];
  /** Hull outer face (the rail's and chine's outer face), rail inner face, backer inner face. */
  face: number; railIn: number; backerIn: number;
  /** Bungee eye on the flap, eye screw on the rear transom's aft face. */
  eye: number; anchor: number;
}

/** One pin site of the removable knee (D-78): the pin axis runs along y at (x, z); every y is |y| on the left side (the right mirrors). */
export interface PinSite {
  /** Pin axis (x, z) in the model frame. */
  x: number;
  z: number;
  /** Inboard end of the pin (the locking balls, `tipIn` past the last member), the outboard end of the handle, the modeled pin length between them, and the usable grip (the members it passes through). */
  yTip: number;
  yHead: number;
  len: number;
  grip: number;
  /** The sleeve in the HULL (stays on the sled): |y| from its inner end to its outer end, and its length. */
  hullSleeve: { y0: number; y1: number; len: number };
  /** The sleeve in the KNEE side (comes off with the knee: in the knee leg at B, in the tab at T). */
  kneeSleeve: { y0: number; y1: number; len: number };
}

/**
 * D-78 (optional setting `kneeMount` = pins): the removable knee on two 3/8 in ball-lock pins per side. Present only when the pins are on AND the rear box rib exists; absent otherwise
 * (the knee stays bolted, D-75). Pin B passes through the knee leg and the rail; pin T through the knee TAB, the side web, the filler and the box rib. Everything here is derived from the
 * hull (rail, web recess, box tie, D-ring washers) and params, never typed. All y are |y| for the left side.
 */
export interface BrakePins {
  /** Pin and sleeve diameters, the locking-ball tip past the last member and the handle height proud of the sleeve end. */
  dia: number;
  sleeveOd: number;
  sleeveId: number;
  tipIn: number;
  headIn: number;
  /** Web recess: how far the free web's outer face is inboard of the hull face (= the sandwich band thickness), and the web's outer face |y|. */
  webRecess: number;
  yWebOut: number;
  /** Thickness of each hull member the pin passes: the web, the band-strip filler and the box rib at T, and the rail at B. */
  hull: { web: number; filler: number; rib: number; rail: number };
  /** Bottom pin B: x = the knee's center, z = the rail's mid-height; distances from the rail's rear end (the rear transom's inner face) and from its top edge. */
  B: PinSite & { fromRailRear: number; belowRailTop: number; fromKneeRear: number; fromKneeBottom: number };
  /** Top pin T: x = the box rib's center line, z = the box tie's top plus `brakeTopPinClearIn`; distances from the rib's bottom end and the gunwale top, and from the rib's center to the knee's rear face. */
  T: PinSite & { fromRibFoot: number; belowRibTop: number; ahead: number };
  /** The box rib at T: center x, shaft width `w`, the FULL-WIDTH BLOCK that carries pin T (width `blockW` = the head length, x center `x`, from `blockZ0` up to the head), z range (foot to gunwale top), and the box tie spacer's top and the D-ring fender washers' bottom z. */
  rib: { x: number; w: number; blockW: number; blockZ0: number; z0: number; z1: number; tieTopZ: number; washerBotZ: number };
  /**
   * The knee TAB (oak, grain vertical): x from `brakeTabEndIn` behind pin T to the knee's rear face; z from `brakeTabAbovePinIn` over pin T DOWN `brakeTabHeightIn` (it hangs mostly below the pin, so it lies against the knee's
   * rear face); y from the web's outer face outboard by `brakeTabThickIn`. `patch` is the glue patch on the knee's rear face: the z overlap of the tab and the knee (the knee top is below the pin) by the y overlap from the hull face
   * to the tab's outer face; `zc` its center z, `ePin` the distance from pin T up to that center, `eTab` from the tab's own center. `bearing` is where the tab's inboard face lies on the web BACKED BY THE BOX RIB
   * (x over the rib block, z over the block, so the web is held by the rib and the filler there); `bearing.area` in^2. (The knee leg itself bears on the rail and chine band only, 0.21 in off the web above the chine.)
   */
  tab: { x0: number; x1: number; z0: number; z1: number; t: number; yIn: number; yOut: number; glueArea: number;
    patch: { y0: number; y1: number; z0: number; z1: number; area: number; zc: number; ePin: number; eTab: number };
    bearing: { x0: number; x1: number; z0: number; z1: number; area: number } };
  /** Clearances (in): the top of the tab to the bottom of the D-ring fender washers, and pin T's ball tip to the storage box side. (The side sign's forward end is cut back to keep `brakeTabClearIn` behind the tab, body.ts.) */
  clear: { tabTopToWasher: number; ballTipToBox: number };
  /** Problems found with the geometry (empty when it is sound); validateParams cannot see them. */
  issues: string[];
}

export interface BrakeGeom {
  /** D-78: how the knee is held on ('pins' only when `pins` is present). */
  mount: 'bolted' | 'pins';
  /** D-78 removable knee on pins; see `BrakePins`. When present the knee has NO bolts, backer or backing plate (`backer` and `bolts` below are then the bolted pattern it would have had, kept for reference only). */
  pins?: BrakePins;
  ok: boolean;
  why: string;
  /** Wheel radius and center (x, z). */
  r: number;
  O: V2;
  y: BrakeY;
  /** Pad: angle behind the top of the tire (rad) and half length angle; contact point on the tread, outward normal, forward tangent (applied pose, all fixed on the sled). */
  alpha: number;
  delta: number;
  C: V2;
  n: V2;
  t: V2;
  pad: { w: number; thick: number; length: number; top: V2[]; bot: V2[] };
  /** Board (flap) direction from the pivot toward the foot end (descending), its up normal, the underside offset (plane p·v = c) and its slope (rad). */
  sigma: number;
  u: V2;
  v: V2;
  c: number;
  /** Pivot pin axis (applied pose; in the middle of the tongue + pivot block stack, D-65), its x, the point on the flap's TOP surface above it, the foot point on the top surface and the flap's rear end x. */
  H: V2;
  xh: number;
  P: V2;
  F: V2;
  xEnd: number;
  /** Board: start/end distance along u from the pin, length, thickness, width (full), and its center in the applied pose. */
  board: { s0: number; s1: number; len: number; thick: number; w: number; c: V2 };
  /** Plan of the Shaper-cut flap: tongue width, the stations (along u from the pin) where the flare starts and the full width is reached, and the pivot block. */
  plan: { wTongue: number; sShoulder: number; sFull: number; blockT: number; blockLen: number; hPin: number };
  /** Shoe block outline (applied pose, x–z) and its width across. */
  shoe: { outline: V2[]; w: number; area: number };
  /** Swing from released to applied (rad, CCW), the drop of the foot point over the stroke (in) and the horizontal foot arm (pin to foot). */
  theta: number;
  footDrop: number;
  aF: number;
  /** Moment of a unit pad normal force and of a unit friction force (along the forward tangent) about the pin, M_y convention. */
  mN: number;
  mT: number;
  /** Lever ratios N_flap / F_foot (before efficiency), sled rolling forward / backward, the smaller (critical) one. */
  ratioFwd: number;
  ratioRev: number;
  ratioCrit: number;
  critical: 'forward' | 'reverse';
  /** Pull-pin pivot: pin diameter and length, the slot / pocket (y range of the tongue and the pocket, the inboard ear's thickness), edge distances of the pin hole (to the tongue stack's top
   *  and bottom, to the inboard ear's top and bottom), the pocket's front end and the blind depth. D-77: no outboard ear; the strap carries the pin's outboard end. */
  pivot: { dia: number; len: number; yTongue: [number, number]; ySlot: [number, number]; earIn: number; zTongueTop: number; zTongueBot: number; edgeTongueUp: number; edgeTongueDown: number; edgeEarUp: number; edgeEarDown: number; slotEndX: number; blind: number;
    /** D-77: the pocket's floor and ceiling (z): it clears the tongue and block through the whole swing by the slot clearance. */
    zPocketBot: number; zPocketTop: number };
  /** D-77 pivot STRAP: a straight stainless flat bar (t thick, w fore-aft, len tall) on the knee's outboard face across the pocket's open side, |y| y0 (inner face) to y1 (outer face),
   *  x0..x1, z0..z1; the pin hole (pin + 1/32) and the #8 screws at cols x rows (side grain of the outer layers, the roof above the pocket and the floor below it). */
  strap: { t: number; w: number; len: number; x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; pinHole: number; screwDia: number; screwHole: number; xs: number[]; zs: number[]; count: number };
  /** Bungee: eye on the flap (surface point, applied), transom anchor (x, y, z), cord lengths released / applied (3-D), cord tension released / applied, and the moment arm data. */
  bungee: { sEye: number; E: V2; Erel: V2; A: [number, number, number]; lenRel: number; lenApp: number; tRel: number; tApp: number; rate: number; fRel: V2; fApp: V2; mRel: number; mApp: number };
  /** Outrigger (knee), plan outline in (y, z) for the left side, x range, leg, arm; the rail, the backer and the bolt pattern. */
  knee: { x0: number; x1: number; poly: V2[]; legT: number; armT: number; zLeg: number; zArmBot: number; zTop: number; zBot: number; yOut: number; area: number;
    /** D-75: the face-glued layers, rear to front, with their grain. */
    layers: KneeLayer[];
    /** D-75: height (z) of the edge-glue line of each 'y'-grain layer (wider across its grain than a board): midway between the top bolt hole and the shoulder, along that layer's grain;
     *  D-77: 3/4 in above the shoulder when the taller knee's upper piece would not fit a board there. */
    zEdgeGlue: number;
    /** D-77: oak above the pocket (the knee top is zPocketTop + roof) and under it at the outboard face (zArmBot = zPocketBot - floor). */
    roof: number; floor: number };
  rail: { zb: number; zt: number; t: number };
  backer: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; t: number };
  bolts: { dia: number; xs: number[]; zs: number[]; count: number; stack: number; cx: number; cz: number;
    /** D-75: the clamped length (head washer on the knee leg, the leg, rail, backer less the plate recess, the backing plate) and the nut-side backing plate (x and z extents, thickness). */
    grip: number; plate: { x0: number; x1: number; z0: number; z1: number; t: number; recess: number } };
  /** Chock: ramp angle, tangent point on the tire, toe and back x, height, polygon for the FRONT chock (x–z, applied); the rear chock mirrors in x. Cord eye on the knee and on the chock. */
  chock: { psi: number; tangent: V2; xToe: number; xBack: number; height: number; width: number; poly: V2[]; eyeX: number; kneeEye: V2; chockEye: V2; heelAngle: number };
}

/** Released-to-pose helper: a point `q` given in the APPLIED pose moved to pose s ∈ [0, 1] (s = 0 released, 1 applied) by turning about the pin. */
export const atPose = (g: Pick<BrakeGeom, 'H' | 'theta'>, s: number, q: V2): V2 => rot2(q, g.H, -(1 - s) * g.theta);

export function brakeGeometry(p: Params, L: Layout): BrakeGeom {
  const r = L.r;
  const O: V2 = [0, r];
  const yW = p.rearTrackIn / 2;
  const tw = p.tireWidthIn;
  const alpha = p.brakePadAngleDeg * RAD;
  const tp = p.brakePadThickIn;
  const padW = Math.max(0.5, Math.min(p.brakePadWidthIn, tw - 0.3));
  const delta = p.brakePadLengthIn / (2 * r);
  const nAt = (a: number): V2 => [-Math.sin(a), Math.cos(a)];
  const tAt = (a: number): V2 => [Math.cos(a), Math.sin(a)];
  const onCircle = (a: number, rad: number): V2 => [O[0] + rad * nAt(a)[0], O[1] + rad * nAt(a)[1]];
  const C = onCircle(alpha, r);
  const n = nAt(alpha), t = tAt(alpha);

  // Pad: an arc strip from the tread (radius r) out to r + thickness, from the rear end of the pad to its front end.
  const N = 8;
  const aSamples = Array.from({ length: N + 1 }, (_, i) => alpha + delta - (2 * delta * i) / N);
  const bot = aSamples.map((a) => onCircle(a, r));
  const top = aSamples.map((a) => onCircle(a, r + tp));

  // Flap: a straight board whose underside plane (p·v = c) clears the top of the pad by `brakeShoeBlockIn` at its highest point.
  const sigma = p.brakeFlapSlopeDeg * RAD;
  const u: V2 = [-Math.cos(sigma), -Math.sin(sigma)];
  const v: V2 = [-Math.sin(sigma), Math.cos(sigma)];
  const tf = p.brakeFlapThickIn;
  const c = Math.max(...top.map((q) => dot2(q, v))) + p.brakeShoeBlockIn;
  const topZ = (x: number) => (c + tf - v[0] * x) / v[1];
  // Pivot (D-65): the pin axis lies in the middle of the stack (flap tongue + pivot block on it), so it sits `hPin` below the flap's top surface.
  const kneeRearX = Math.max(r + p.brakePivotAheadIn, SIGN_X_MAX_IN); // the knee's rear face: ahead of the tire and of the sign zone
  const xp = kneeRearX + p.brakePivotEndIn; // the pin axis, `brakePivotEndIn` of oak ahead of the knee's rear face
  const P: V2 = [xp, topZ(xp)];
  const blockT = p.brakePivotBlockIn;
  const hPin = (tf - blockT) / 2;
  const H: V2 = [P[0] - hPin * v[0], P[1] - hPin * v[1]];
  const xh = H[0];
  const xEnd = L.xRear - p.brakeFlapEndBehindTransomIn; // the foot tread ends at the transom face (D-65)
  const xf = xEnd + p.brakeFootPadLengthIn / 2; // the foot point: the middle of the tread
  const F: V2 = [xf, topZ(xf)];
  const s0 = -p.brakePivotEndIn / Math.cos(sigma); // the tongue reaches this far past the pin
  const s1 = (P[0] - xEnd) / Math.cos(sigma);
  const bw = p.brakeFlapWidthIn;
  const sMid = (s0 + s1) / 2;
  const bc: V2 = [P[0] + sMid * u[0] - (tf / 2) * v[0], P[1] + sMid * u[1] - (tf / 2) * v[1]];
  const board = { s0, s1, len: s1 - s0, thick: tf, w: bw, c: bc };
  const wTongue = Math.min(bw, p.brakePivotTongueIn);
  const sShoulder = (xp - kneeRearX) / Math.cos(sigma) + SHOULDER_CLEAR_IN;
  const sPadC = dot2(sub(C, P), u);
  const sFull = Math.max(sShoulder + 2, sPadC - p.brakePadLengthIn / 2 - 0.5);
  const plan = { wTongue, sShoulder, sFull, blockT, blockLen: p.brakePivotEndIn + sShoulder, hPin };

  // Shoe block: between the pad's top arc and the board's underside plane, with vertical ends.
  const underZ = (x: number) => (c - v[0] * x) / v[1];
  const xTopR = Math.min(...top.map((q) => q[0])), xTopF = Math.max(...top.map((q) => q[0]));
  const shoePts: V2[] = [...top, [xTopF, underZ(xTopF)], [xTopR, underZ(xTopR)]];
  const shoeOutline = hull2(shoePts);
  const shoe = { outline: shoeOutline, w: padW, area: polyArea(shoeOutline) };

  // Moments about the pin of the pad normal and of friction along the forward tangent (a unit force each).
  const rC = sub(C, H);
  const mN = momentY(rC, n);
  const mT = momentY(rC, t);
  const aF = H[0] - F[0];
  const mu = p.brakePadMu;
  const kF = mN + mu * mT, kR = mN - mu * mT;
  const ratioFwd = kF > 1e-6 ? aF / kF : 0;
  const ratioRev = kR > 1e-6 ? aF / kR : 0;
  const ratioCrit = Math.min(ratioFwd, ratioRev);

  // Swing: turn the pad's contact point clockwise about the pin until it hangs `brakePadGapIn` off the tread.
  const gapAt = (th: number) => norm2(sub(rot2(C, H, -th), O)) - r;
  let lo = 0, hi = 0.6;
  let why = '';
  if (gapAt(hi) < p.brakePadGapIn) why = 'the flap cannot swing far enough to lift the pad off the tread by the pad gap';
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (gapAt(m) < p.brakePadGapIn) lo = m; else hi = m; }
  const theta = (lo + hi) / 2;
  const footDrop = rot2(F, H, -theta)[1] - F[1];

  // ── y layers ──
  const yFace = L.hwC + L.side;
  const railT = p.railThicknessIn;
  const yRailIn = yFace - railT;
  const y: BrakeY = {
    wheel: yW, tireIn: yW - tw / 2, tireOut: yW + tw / 2,
    flap: [yW - bw / 2, yW + bw / 2], tongue: [yW - wTongue / 2, yW + wTongue / 2], pad: [yW - padW / 2, yW + padW / 2],
    face: yFace, railIn: yRailIn, backerIn: yRailIn - p.brakeBackerThickIn,
    eye: yW - bw / 2 + EYE_INSET_IN, anchor: yFace - p.brakeBungeeAnchorInsetIn,
  };


  // ── Bungee: eye on the flap's rear end (inboard edge), cord up to an eye screw in the rear transom's aft face near its outer corner. (The gunwale's outer face is the
  //    sign zone, D-57 item 9, and the knee stays ahead of it, so nothing of the brake is on the side above the rail.) ──
  const xe = xEnd - EYE_LIFT_IN; // the ring of the eye in the flap's rear end face (D-65: the flap itself ends at the transom face)
  const sEye = (xh - xe) / Math.cos(sigma);
  const E: V2 = [xe, topZ(xEnd) - tf / 2];
  const Erel = rot2(E, H, -theta);
  const A: [number, number, number] = [L.xRear - EYE_LIFT_IN, y.anchor, L.sideTop - p.brakeBungeeAnchorBelowTopIn];
  const len3 = (e: V2) => Math.hypot(A[0] - e[0], A[1] - y.eye, A[2] - e[1]);
  const lenRel = len3(Erel), lenApp = len3(E);
  const rate = p.brakeBungeeRateLbfPerIn;
  const tRel = p.brakeBungeeTensionLbf;
  const tApp = tRel + rate * (lenApp - lenRel);
  const fOf = (e: V2, tension: number, len: number): V2 => [(tension * (A[0] - e[0])) / len, (tension * (A[2] - e[1])) / len];
  const fRel = fOf(Erel, tRel, lenRel), fApp = fOf(E, tApp, lenApp);
  // moment about the pin at each pose (cord force on the flap; applied-pose frame for E, released-pose frame for Erel — each about its own pin position, which is fixed)
  const mRel = momentY(sub(Erel, H), fRel), mApp = momentY(sub(E, H), fApp);
  const bungee = { sEye, E, Erel, A, lenRel, lenApp, tRel, tApp, rate, fRel, fApp, mRel, mApp };

  // ── Mount: knee on the hull's outer face over the rail, bolted through the rail into the backer ──
  const zt = L.railTop;
  const zb = L.railTop - p.railDepthIn;
  const kx0 = kneeRearX, kx1 = kneeRearX + p.brakeKneeDepthIn;
  const legT = p.brakeKneeLegIn;
  const zLeg = L.railTop + L.chineH;
  const kneeLay = kneeLayers(kx0, kx1);
  // ── Pull-pin pivot (D-65, D-77): the flap's tongue (with the pivot block on it) enters a POCKET in the rear of the knee arm, open at the rear and (D-77: the outboard ear is cut away) at the
  //    outboard side, with oak above it (the roof) and below it (the floor). The pin goes through the stainless strap on the open side, the tongue and block, and blind into the inboard ear. ──
  const slotHalf = wTongue / 2 + p.brakePivotSlotClearIn;
  const ySlot: [number, number] = [yW - slotHalf, yW + slotHalf];
  const yOut = Math.max(ySlot[1], yFace + legT + 0.25); // D-77: the arm ends at the pocket's outboard face (no ear, no stub ahead of it); kept outboard of the leg on a body wider than the track
  const earIn = ySlot[0] - yFace;
  // The pocket is deep enough for the tongue's nose to clear its end through the WHOLE swing (D-66): the nose end face is square to the board (tilted by the flap slope), so its top corner (on the
  // pivot block) is the farthest forward; turn the four corners of the tongue + block stack about the pin from the applied pose to the released one and add the slot clearance to the farthest.
  const stackPt = (sc: number, h: number): V2 => [P[0] + sc * u[0] - h * v[0], P[1] + sc * u[1] - h * v[1]];
  const stackCorners: V2[] = [[s0, -blockT], [s0, tf]].map(([sc, h]) => stackPt(sc, h));
  let noseMaxX = -Infinity;
  for (let k = 0; k <= 20; k++) for (const q of stackCorners) noseMaxX = Math.max(noseMaxX, rot2(q, H, -(k / 20) * theta)[0]);
  const slotEndX = noseMaxX + p.brakePivotSlotClearIn;
  // D-77: the pocket's ceiling and floor clear the block top and the flap underside over the length inside the knee (nose to the knee's rear face) through the whole swing, by the slot clearance.
  const sRear = (xp - kx0) / Math.cos(sigma);
  let topMax = -Infinity, botMin = Infinity;
  for (let k = 0; k <= 20; k++) for (let j = 0; j <= 10; j++) {
    const sc = s0 + ((sRear - s0) * j) / 10;
    topMax = Math.max(topMax, rot2(stackPt(sc, -blockT), H, -(k / 20) * theta)[1]);
    botMin = Math.min(botMin, rot2(stackPt(sc, tf), H, -(k / 20) * theta)[1]);
  }
  const zPocketTop = topMax + p.brakePivotSlotClearIn, zPocketBot = botMin - p.brakePivotSlotClearIn;
  const zTop = zPocketTop + p.brakeKneeRoofIn; // D-77: the roof stands over the pocket (D-65 had the knee top flush with the block top, the slot open above)
  const zArmBot = Math.min(zPocketBot - p.brakeKneeFloorIn, zTop - 0.5);
  const armT = zTop - zArmBot;
  const poly: V2[] = [[yFace, zb], [yFace + legT, zb], [yFace + legT, zLeg], [yOut, zArmBot], [yOut, zTop], [yFace, zTop]];
  const zUnderAt = (yy: number) => (yy <= yFace + legT ? zb : zLeg + ((zArmBot - zLeg) * (yy - (yFace + legT))) / Math.max(1e-9, yOut - (yFace + legT)));
  const pinDia = p.brakePivotPinDiaIn;
  // ── D-77 strap: straight flat bar on the outboard face, its rear edge flush with the knee's rear face (the pin sits 0.76 in ahead of it, so the pin has the most metal behind it);
  //    four #8 screws in the outer layers (at their middles, kept STRAP_SCREW_EDGE_IN inside the strap's ends), at the middle of the roof and of the floor ──
  const sT = p.brakeStrapThickIn;
  const sW = Math.min(p.brakeStrapWidthIn, kx1 - kx0 - 0.125);
  const sx0 = kx0, sx1 = sx0 + sW;
  const outer = [kneeLay[0], kneeLay[kneeLay.length - 1]];
  const sXs = [...new Set(outer.map((q) => (q.x0 + q.x1) / 2))].map((x) => Math.min(sx1 - STRAP_SCREW_EDGE_IN, Math.max(sx0 + STRAP_SCREW_EDGE_IN, x)));
  const sZs = [zPocketBot - p.brakeKneeFloorIn / 2, zPocketTop + p.brakeKneeRoofIn / 2];
  const STRAP_END_IN = 0.375; // metal past the screw-hole centers at the strap's ends (2 hole diameters)
  const up16 = (q: number) => Math.ceil(q * 16 - 1e-9) / 16;
  const sLen = up16(sZs[1] - sZs[0] + 2 * STRAP_END_IN);
  const sz0 = (sZs[0] + sZs[1]) / 2 - sLen / 2;
  const strap = {
    t: sT, w: sW, len: sLen, x0: sx0, x1: sx1, z0: sz0, z1: sz0 + sLen, y0: yOut, y1: yOut + sT, pinHole: pinDia + PIVOT_HOLE_CLEAR_IN,
    screwDia: 0.164, screwHole: 0.1875, xs: sXs, zs: sZs, count: sXs.length * sZs.length,
  };
  const pivot = {
    dia: pinDia, len: sT + (ySlot[1] - ySlot[0]) + PIN_BLIND_IN + PIN_STICKOUT_IN, yTongue: y.tongue, ySlot, earIn,
    zTongueTop: P[1] + blockT, zTongueBot: P[1] - tf, edgeTongueUp: blockT + hPin, edgeTongueDown: tf - hPin, edgeEarUp: zTop - H[1], edgeEarDown: H[1] - zUnderAt(ySlot[0]),
    slotEndX, blind: PIN_BLIND_IN, zPocketBot, zPocketTop,
  };
  const rail = { zb, zt, t: railT };
  const bd = p.brakeMountBoltDiaIn;
  const cols = Math.max(1, Math.round(p.brakeMountBoltColumns)), rows = Math.max(1, Math.round(p.brakeMountBoltRows));
  const xs = Array.from({ length: cols }, (_, i) => kx0 + ((i + 0.5) * (kx1 - kx0)) / cols);
  const zs = Array.from({ length: rows }, (_, j) => zb + ((j + 0.5) * (zt - zb)) / rows);
  const stack = legT + railT + p.brakeBackerThickIn;
  // D-75: the nut-side backing plate covers the bolt pattern with the same margin all round as the knee depth leaves fore and aft (1/16 in in from each knee face), rounded up to 1/8 in.
  const up8 = (v: number) => Math.ceil(v * 8 - 1e-9) / 8;
  const pw = Math.min(kx1 - kx0 - 0.125, up8(xs[xs.length - 1] - xs[0] + 2 * 0.5));
  const margin = (pw - (xs[xs.length - 1] - xs[0])) / 2;
  const ph = up8(zs[zs.length - 1] - zs[0] + 2 * margin);
  const pcx = (xs[0] + xs[xs.length - 1]) / 2, pcz = (zs[0] + zs[zs.length - 1]) / 2;
  const recess = Math.min(p.brakeBackerCboreDeepIn, p.brakeBackPlateThickIn);
  const plate = { x0: pcx - pw / 2, x1: pcx + pw / 2, z0: pcz - ph / 2, z1: pcz + ph / 2, t: p.brakeBackPlateThickIn, recess };
  const grip = stack - recess + plate.t;
  const bolts = { dia: bd, xs, zs, count: cols * rows, stack, cx: xs.reduce((a, b) => a + b, 0) / cols, cz: zs.reduce((a, b) => a + b, 0) / rows, grip, plate };
  // D-75: the 'y'-grain layers are as wide across their grain as the knee is tall, so each is edge-glued from two pieces; the joint runs along their grain midway between the top bolt hole
  // and the shoulder (the review found the old even split landing on the shoulder); the 'z' layer crosses it with long grain.
  // D-77: the knee is taller (the roof over the pocket), so the D-75 joint (midway between the top bolt hole and the shoulder) leaves an upper piece wider than a board; the joint then moves
  // 3/4 in ABOVE the shoulder, where both pieces fit a board. It runs along the across layer's grain and both UPRIGHT layers are glued over it.
  const fits = (zj: number) => Math.max(zj - zb, zTop - zj) + p.laminateWidthAllowanceIn <= KNEE_BOARD_WIDTH_IN + 1e-9;
  const zMidD75 = (zs[zs.length - 1] + bd / 2 + zLeg) / 2, zAbove = zLeg + KNEE_JOINT_CLEAR_IN;
  const zEdgeGlue = fits(zMidD75) ? zMidD75 : fits(zAbove) ? zAbove : (zb + zTop) / 2;
  const knee = { x0: kx0, x1: kx1, poly, legT, armT, zLeg, zArmBot, zTop, zBot: zb, yOut, area: polyArea(poly), layers: kneeLay, zEdgeGlue, roof: p.brakeKneeRoofIn, floor: p.brakeKneeFloorIn };
  // The backer runs from behind the first bolt column to ahead of the last, clear of the axle hanger behind it (joists in the way are cut back in frame.ts).
  const hangerFace = L.beamR.x + p.axleHangerWidthIn / 2;
  const bx0 = Math.max(hangerFace + 0.1, xs[0] - 1.5 * bd - 0.5 * (kx1 - kx0) / cols);
  const bx1 = xs[xs.length - 1] + 1.5 * bd + 0.5 * (kx1 - kx0) / cols;
  const backer = { x0: bx0, x1: bx1, y0: y.backerIn, y1: yRailIn, z0: zb, z1: zt, t: p.brakeBackerThickIn };

  // ── Chock: a ramp the tire climbs; the face is tangent to the tire at the contact, rising away from it ──
  const psi = p.brakeChockAngleDeg * RAD;
  const tangent: V2 = [r * Math.sin(psi), r - r * Math.cos(psi)];
  const xToe = tangent[0] - tangent[1] / Math.tan(psi);
  const hC = p.brakeChockHeightIn;
  const xBack = xToe + hC / Math.tan(psi);
  const cpoly: V2[] = [[xToe, 0], [xBack, 0], [xBack, hC]];
  const eyeX = Math.max(kx0 + 0.5, Math.min(kx1 - 0.5, xBack));
  const chock = { psi, tangent, xToe, xBack, height: hC, width: p.brakeChockWidthIn, poly: cpoly, eyeX, kneeEye: [eyeX, zb] as V2, chockEye: [xBack, hC] as V2, heelAngle: Math.atan2(hC, xBack - xToe) };

  // ── D-78: the removable knee on two ball-lock pins (an option; the knee is then not bolted) ──
  let pins: BrakePins | undefined;
  if (p.kneeMount === KNEE_MOUNT.pins) {
    const st = sideRibStations(p, L)[0];
    if (st.kind === 'box') {
      const tg = boxTieGeometry(p, L, st);
      const recess = L.sideBand;
      const yWebOut = yFace - recess;
      const webT = L.side - 2 * L.sideBand, fillerT = L.sideBand, ribT = p.sideRibDepthIn;
      const sOd = p.brakeSleeveOdIn, tip = p.brakePinTipIn, head = p.brakePinHeadIn;
      // pin B: through the knee leg and the rail only, at the knee's center and the rail's mid-height
      const bx = (kx0 + kx1) / 2, bz = (zb + zt) / 2;
      const bTip = yRailIn - tip, bHead = yFace + legT + head;
      const B = {
        x: bx, z: bz, yTip: bTip, yHead: bHead, len: bHead - bTip, grip: railT + legT,
        hullSleeve: { y0: yRailIn, y1: yFace, len: railT }, kneeSleeve: { y0: yFace, y1: yFace + legT, len: legT },
        fromRailRear: bx - (L.xRear + L.transom), belowRailTop: zt - bz, fromKneeRear: bx - kx0, fromKneeBottom: bz - zb,
      };
      // pin T: through the tab, the web, the filler and the box rib, above the box tie spacer
      const tx = st.x, tz = topPinZ(p, L, st);
      const tabT = p.brakeTabThickIn, tabH = p.brakeTabHeightIn;
      const yTIn = yWebOut - webT - fillerT - ribT; // the rib's inner face
      const tYOut = yWebOut + tabT;
      const tTip = yTIn - tip, tHead = tYOut + head;
      const T = {
        x: tx, z: tz, yTip: tTip, yHead: tHead, len: tHead - tTip, grip: ribT + fillerT + webT + tabT,
        hullSleeve: { y0: yTIn, y1: yWebOut, len: ribT + fillerT + webT }, kneeSleeve: { y0: yWebOut, y1: tYOut, len: tabT },
        fromRibFoot: tz - tg.z0, belowRibTop: st.top - tz, ahead: kx0 - tx,
      };
      const washerBotZ = st.top - L.railBand / 2 - LASH_HOLE_DZ_IN - LASH_WASHER.od / 2;
      const tabZ1 = tz + p.brakeTabAbovePinIn;
      const tab = { x0: tx - p.brakeTabEndIn, x1: kx0, z0: tabZ1 - tabH, z1: tabZ1, t: tabT, yIn: yWebOut, yOut: tYOut, glueArea: 0,
        patch: { y0: yFace, y1: Math.min(tYOut, yFace + legT), z0: 0, z1: 0, area: 0, zc: 0, ePin: 0, eTab: 0 },
        bearing: { x0: 0, x1: 0, z0: 0, z1: 0, area: 0 } };
      const ph = tab.patch;
      ph.z0 = Math.max(tab.z0, zb); ph.z1 = Math.min(tab.z1, zTop);
      ph.area = Math.max(0, ph.z1 - ph.z0) * Math.max(0, ph.y1 - ph.y0);
      ph.zc = (ph.z0 + ph.z1) / 2; ph.ePin = tz - ph.zc; ph.eTab = (tab.z0 + tab.z1) / 2 - ph.zc;
      tab.glueArea = ph.area;
      const bw = ribBlockWidth(p), bz0 = ribBlockZ0(p, L, st);
      const bear = tab.bearing;
      bear.x0 = Math.max(tab.x0, tx - bw / 2); bear.x1 = Math.min(tab.x1, tx + bw / 2);
      bear.z0 = Math.max(tab.z0, bz0); bear.z1 = Math.min(tab.z1, st.top - L.railBand);
      bear.area = Math.max(0, bear.x1 - bear.x0) * Math.max(0, bear.z1 - bear.z0);
      const gBox = tg.yBox; // the storage box side's |y|
      const issues: string[] = [];
      if (tz - sOd / 2 < tg.z0 + p.brakePinEdgeIn) issues.push('pin T is too close to the foot of the box rib');
      if (tz + sOd / 2 > st.top - L.railBand) issues.push('pin T is in the rib head, among the D-ring bolts (it belongs in the shaft, under the head)');
      if (bw < sOd + 2 * p.brakePinEdgeIn - 1e-9) issues.push('the box rib block is too narrow for the sleeve');
      if (tz - bz0 < sOd / 2 + p.brakePinEdgeIn - 1e-9) issues.push('the box rib block starts too close under pin T');
      if (tab.z0 < zLeg) issues.push('the knee tab reaches down into the chine band');
      if (ph.area < 1.5) issues.push(`the glue patch of the knee tab is only ${ph.area.toFixed(2)} in2`);
      if (tab.z1 > washerBotZ - p.brakeTabClearIn + 1e-9) issues.push(`the knee tab top (${tab.z1.toFixed(2)}") is within ${p.brakeTabClearIn}" of the D-ring washers (bottom ${washerBotZ.toFixed(2)}")`);
      if (kx0 - tx < sOd / 2 + p.brakePinEdgeIn - 1e-9) issues.push('the knee is too close to pin T: no oak ahead of the sleeve in the tab');
      if (tYOut > y.tireIn - 0.1 && tab.x0 < r) issues.push('the knee tab runs into the rear tire');
      if (tTip < gBox + 0.1) issues.push('the top pin\'s ball tip would touch the storage box side');
      if (bz - sOd / 2 < zb + 0.5 || bz + sOd / 2 > zt - 0.5) issues.push('pin B is too close to the rail edges');
      pins = {
        dia: p.brakePinDiaIn, sleeveOd: sOd, sleeveId: p.brakeSleeveIdIn, tipIn: tip, headIn: head, webRecess: recess, yWebOut,
        hull: { web: webT, filler: fillerT, rib: ribT, rail: railT }, B, T,
        rib: { x: st.x, w: p.sideRibWidthIn, blockW: bw, blockZ0: bz0, z0: tg.z0, z1: st.top, tieTopZ: tg.z1, washerBotZ },
        tab, clear: { tabTopToWasher: washerBotZ - tab.z1, ballTipToBox: tTip - gBox }, issues,
      };
    }
  }

  if (!why && !(ratioCrit > 0)) why = 'no lever ratio';
  if (!why && !(H[0] > r + 0.2)) why = 'the pivot pin is not ahead of the tire';
  if (!why && !(xEnd < H[0] - 4)) why = 'the flap is too short';
  const ok = !why;
  return {
    mount: pins ? 'pins' : 'bolted', pins, ok, why, r, O, y, alpha, delta, C, n, t, pad: { w: padW, thick: tp, length: p.brakePadLengthIn, top, bot },
    sigma, u, v, c, H, xh, P, F, xEnd, board, plan, shoe, theta, footDrop, aF, mN, mT, ratioFwd, ratioRev, ratioCrit, critical: ratioFwd <= ratioRev ? 'forward' : 'reverse',
    pivot, strap, bungee, knee, rail, backer, bolts, chock,
  };
}

/** Half-width (in) of the Shaper-cut flap at station `s` (along the board from the pin, toward the foot): the tongue, then a smooth S-curved flare to the full width over the tire. */
export function flapHalfWidth(g: Pick<BrakeGeom, 'plan' | 'board'>, s: number): number {
  const { wTongue, sShoulder, sFull } = g.plan;
  const full = g.board.w / 2, tongue = wTongue / 2;
  if (s <= sShoulder) return tongue;
  if (s >= sFull) return full;
  const t = (s - sShoulder) / (sFull - sShoulder);
  return tongue + (full - tongue) * t * t * (3 - 2 * t);
}

/**
 * The flap's plan outline in the board's own frame (x forward along the board, centered on the board's middle; y across, 0 on the tire's center line; CCW): the tongue nose with small
 * corner radii, the S-curved flare, the full width over the tire and the foot end with larger corner radii. This is the Shaper Origin cut line (D-65); the thickness is the board thickness.
 */
export function flapOutline(g: Pick<BrakeGeom, 'plan' | 'board'>): V2[] {
  const { s0, s1, len } = g.board;
  const sMid = (s0 + s1) / 2;
  const X = (s: number) => -(s - sMid); // station -> local x (forward = toward the pivot)
  const rn = Math.min(FLAP_NOSE_CORNER_IN, g.plan.wTongue / 2 - 0.01), rr = Math.min(FLAP_REAR_CORNER_IN, g.board.w / 2 - 0.01);
  const N = 24;
  const sides: Array<{ s: number; w: number }> = [];
  // stations along one side from the rear straight edge to the nose straight edge
  const sEdgeR = s1 - rr, sEdgeN = s0 + rn;
  // The stations are even along the side PLUS the two where the flare starts and ends, so the outline has a vertex exactly where the tongue ends (the overlap boxes of D-66 then cut the tongue from the flare).
  const stations = [...Array.from({ length: N + 1 }, (_, i) => sEdgeR + ((sEdgeN - sEdgeR) * i) / N), g.plan.sShoulder, g.plan.sFull].filter((s) => s <= sEdgeR + 1e-9 && s >= sEdgeN - 1e-9).sort((a, b) => b - a).filter((s, i, a) => i === 0 || Math.abs(s - a[i - 1]) > 1e-6);
  for (const s of stations) sides.push({ s, w: flapHalfWidth(g, s) });
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 6): V2[] => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as V2; });
  const pts: V2[] = [];
  const wR = flapHalfWidth(g, s1), wN = flapHalfWidth(g, s0);
  // right side (y < 0) rear -> front, CCW starts at the rear-right corner
  pts.push(...arc(X(s1 - rr) , -(wR - rr), rr, Math.PI, 1.5 * Math.PI)); // rear-right corner: from the rear edge (x = rear) to the right side
  for (const q of sides) pts.push([X(q.s), -q.w]);
  pts.push(...arc(X(s0 + rn), -(wN - rn), rn, 1.5 * Math.PI, 2 * Math.PI)); // nose-right corner
  pts.push(...arc(X(s0 + rn), wN - rn, rn, 0, 0.5 * Math.PI)); // nose-left corner
  for (const q of [...sides].reverse()) pts.push([X(q.s), q.w]);
  pts.push(...arc(X(s1 - rr), wR - rr, rr, 0.5 * Math.PI, Math.PI)); // rear-left corner
  void len;
  return pts.filter((q, i) => { const o = pts[(i + pts.length - 1) % pts.length]; return Math.hypot(q[0] - o[0], q[1] - o[1]) > 1e-6; });
}

/** The flap's local x of a station `s` along its top surface (station 0 is the pin axis; the nose is at s0, the foot end at s1). */
export const flapLocalX = (g: Pick<BrakeGeom, 'board'>, s: number): number => -(s - (g.board.s0 + g.board.s1) / 2);

/**
 * Where the `n` pivot-block screws go, as (x, y) in the flap's local frame (x forward to the nose, y across from the tire's center line; D-65). They sit on the block, which runs from the
 * nose back to the shoulder, but BEHIND the pin: the pin's cross hole (pin + `PIVOT_HOLE_CLEAR_IN`) is in the nose end, so each screw keeps `PIVOT_SCREW_WOOD_IN` of oak between its body and
 * the hole's edge, and `PIVOT_SCREW_EDGE_IN` from the block's rear end and the tongue's edges. That leaves a short band along the flap (about 1/3 in at the defaults), so the screws
 * are spread across the tongue, alternating between the forward and the rearward edge of the band.
 */
export function pivotBlockScrewPoints(g: Pick<BrakeGeom, 'board' | 'plan'>, n: number, pinDiaIn: number, screwDiaIn: number): V2[] {
  const xPin = flapLocalX(g, 0);
  const xFwd = xPin - (pinDiaIn / 2 + PIVOT_HOLE_CLEAR_IN / 2 + PIVOT_SCREW_WOOD_IN + screwDiaIn / 2);
  const xRear = Math.min(xFwd, flapLocalX(g, g.plan.sShoulder) + PIVOT_SCREW_EDGE_IN);
  const yMax = Math.max(0, g.plan.wTongue / 2 - PIVOT_SCREW_EDGE_IN - 0.05);
  return Array.from({ length: n }, (_, i): V2 => [i % 2 === 0 ? xFwd : xRear, n === 1 ? 0 : -yMax + (2 * yMax * i) / (n - 1)]);
}

/** D-78: problems with the removable knee's pin geometry at these params (empty when the pins are off or the geometry is sound). validateParams only sees numbers; this sees the hull. */
export function brakePinIssues(p: Params, L: Layout): string[] {
  if (p.kneeMount !== KNEE_MOUNT.pins) return [];
  const g = brakeGeometry(p, L);
  return g.pins ? g.pins.issues : ['the removable knee (D-78) needs the box rib beside the rear storage box; without it the knee stays bolted'];
}
