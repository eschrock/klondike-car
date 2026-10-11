/**
 * Body: decks, captured-ply sides, shoulder panels, transoms with lift hand-holds, the bent-lam prow (and its
 * form), finger guards over the front-tire pinch zone, signs (D-22, D-35…D-37).
 *
 * Shapes follow the build: the okoume side web is an `extrusion` that enters a groove in the chine and the gunwale,
 * the decks are `extrusion` outlines that enter rabbets (chines) and dados (transoms), the transoms are full-width
 * `extrusion`s with a hand-hold slot, and the prow is a `sweep` of 1/8" strips. Every ply part lists an edge condition
 * for each outline edge (captured in oak, or edged with oak banding; none exposed). Joint records are added in
 * joinery.ts after all parts exist.
 */
import { SIDE_CONSTRUCTION } from '../params';
import { HULL_STEP, STEP, box, cylinder, roughOf, span, SIDES, IN3_PER_FT3, woodMassLb, type Ctx } from './build-utils';
import { handleGeometry } from './brake';
import { cabinSidePoint, sheerRise, type Layout } from './layout';
import { REFLECTOR_FRACS, REFLECTOR_SIZE } from './lighting';
import { compose } from './mat4';
import type { Dims, EdgeCondition, Mat4, Part, PartGroup, Vec2, Vec3 } from './types';

// ── Block-model placeholders (not design numbers: open-frame post pitch, sign fit gaps) ──
const POST_SPACING_IN = 12;
const POST_X_IN = 1.5;
const SIGN_MIN_LEN_IN = 4;
const SIGN_TIRE_GAP_IN = 0.25;
/** Prow leg: the oak kept between the lift slot and the leg foot (the leg itself is `prowLegMinIn` long and drops into a socket, D-43). */
const PROW_LEG_ABOVE_SLOT_IN = 0.25;
/** Running clearance of the prow leg in its socket slot (each side and in front). */
const PROW_SOCKET_CLEAR_IN = 0.015;
const PROW_BEZIER_CTRL = 0.6;
const PROW_SAMPLES = 24;
/** Prow form: base below the foot, and how far the form body extends past the inside face. */
const FORM_BASE_IN = 1;
const FORM_BODY_IN = 3;
const FORM_CHEEK_IN = 1;
const FORM_SIDE_OFFSET_IN = 4;
/** Finger guard: strap height on the gunwale and the margin past the hazard zone. */
const GUARD_STRAP_IN = 1.25;
/** Finger-guard inserts sit ABOVE the gunwale's web groove: oak left over the groove top, and the #10-32 insert's hole radius (build review M2, D-43). */
const GUARD_INSERT_CLEAR_IN = 0.25;
const GUARD_INSERT_RADIUS_IN = 0.16;
const GUARD_X_MARGIN_IN = 0.5;
const GUARD_OUT_MARGIN_IN = 0.25;
const LIFT_SLOT_SEGMENTS = 8;
/** Cosmetic sampling of the curved outlines (D-44): sheer curve, transom crown, rounded corners. */
const SHEER_SEGMENTS = 14;
const CROWN_SEGMENTS = 16;
const CORNER_SEGMENTS = 6;
/** Assembly order and hydraulic-lock relief shared by the notes of the hull parts (build review M4, D-43; HULL_STEP in build-utils.ts has the whole sequence). */
const DECK_ASSEMBLY_NOTE = 'Assembly (M4): epoxy-seal every face and edge first; the deck is glued to the frame (rails + joists) as one unit BEFORE the sides slide on, and the transom slides onto its edge last.';
const SIDE_ASSEMBLY_NOTE = 'Assembly (M4): glue the web into its chine and gunwale on the bench (a side assembly, wipe squeeze-out from the grooves), then slide the assembly inboard (Y) onto the deck edge so the chine rabbet closes over it; the transom goes on after, sliding in X.';
/** The hood flange is this many wall thicknesses (it cantilevers ~5" off a 1" strap, so it is thicker than the leg). */
const HOOD_FACTOR = 2;

// ── Small geometry helpers ──
export const frameMat = (ex: Vec3, ey: Vec3, ez: Vec3, o: Vec3): Mat4 => [...ex, 0, ...ey, 0, ...ez, 0, ...o, 1];
const rectCCW = (x0: number, x1: number, y0: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

export function polyAreaPerim(o: Vec2[]): { area: number; perim: number } {
  let a = 0, per = 0;
  for (let i = 0; i < o.length; i++) {
    const [x1, y1] = o[i];
    const [x2, y2] = o[(i + 1) % o.length];
    a += x1 * y2 - x2 * y1;
    per += Math.hypot(x2 - x1, y2 - y1);
  }
  return { area: Math.abs(a) / 2, perim: per };
}
const signedArea = (o: Vec2[]) => o.reduce((s, q, i) => s + (q[0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * q[1]), 0) / 2;
const ccw = (o: Vec2[]): Vec2[] => (signedArea(o) >= 0 ? o : [...o].reverse());
const cw = (o: Vec2[]): Vec2[] => (signedArea(o) <= 0 ? o : [...o].reverse());

/** Oak mass in lb for a volume in in³ (no finish): used for groove / dado / banding adjustments. */
const oakLb = (ctx: Ctx, vol: number) => (vol / IN3_PER_FT3) * ctx.p.oakDensityPcf;
/** Oak edge banding along `lenIn` of ply `plyIn` thick (glued strip, flush both faces). */
export const edgeBandLb = (ctx: Ctx, lenIn: number, plyIn: number) => oakLb(ctx, lenIn * ctx.p.edgeBandIn * plyIn);

/** Regular polygon (n-gon) loop in (y, z), CCW. */
function circleLoop(cy: number, cz: number, r: number, n: number): Vec2[] {
  return Array.from({ length: n }, (_, i) => [cy + r * Math.cos((2 * Math.PI * i) / n), cz + r * Math.sin((2 * Math.PI * i) / n)] as Vec2);
}

// ── Scuppers (build review M7, D-43) ──
const SCUPPER_MASS_LB = 0.03;
/** Hole bottom sits this far above the deck surface (so standing water drains to it); the nipple sticks out this far past the chine. */
const SCUPPER_BELOW_SURFACE_IN = 0.05;
const SCUPPER_STICKOUT_IN = 0.25;
const SCUPPER_END_INSET_IN = 0.5;

export interface ScupperSite { x: number; zone: 'cabin' | 'nose'; deckZ: number; hw: number; tagPos: string }
/** Where the drains go: rear corners (in the backer lane when there is a rear box), cabin shoulder corners, nose front corners. */
export function scupperSites(ctx: Ctx): ScupperSite[] {
  const { L } = ctx;
  const rearTx = L.xRear + L.transom, frontTx = L.xFront - L.transom;
  const r = ctx.p.scupperDiaIn / 2;
  return [
    { x: rearTx + Math.max(SCUPPER_END_INSET_IN, r + 0.1) * 0.75, zone: 'cabin', deckZ: L.deckTop, hw: L.hwC, tagPos: 'cabin-rear' },
    { x: L.xs - L.ply - 1, zone: 'cabin', deckZ: L.deckTop, hw: L.hwC, tagPos: 'cabin-front' },
    { x: frontTx - 1, zone: 'nose', deckZ: L.noseTop, hw: L.hwN, tagPos: 'nose-front' },
  ];
}

// ── Sheer and crown outlines (D-44) ──
/** x samples from `a` to `b` (inclusive) that include the start of the sheer curve and SHEER_SEGMENTS steps along it. */
function sheerSamples(L: Pick<Layout, 'sheer'>, a: number, b: number): number[] {
  const xs = new Set<number>([a, b]);
  const { x0, x1 } = L.sheer;
  if (x1 > x0) for (let i = 0; i <= SHEER_SEGMENTS; i++) {
    const x = x0 + ((x1 - x0) * i) / SHEER_SEGMENTS;
    if (x > a + 1e-9 && x < b - 1e-9) xs.add(x);
  }
  return [...xs].sort((u, v) => u - v);
}
const polyLen = (pts: Vec2[]) => pts.reduce((t, q, i) => (i ? t + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);

/**
 * Top of a transom (D-44), from the right corner over the crown to the left corner: a parabolic arc that is `crown` higher at the
 * center than at the corners (height `zt` at |y| = `wTop`), with each top corner rounded by `rc`. Starts at the foot of the right
 * corner arc (so the caller continues the right side up to it) and ends at the foot of the left one.
 */
export function transomTopOutline(wTop: number, zt: number, crown: number, rc: number): Vec2[] {
  const zc = (y: number) => zt + crown * (1 - (y / wTop) ** 2);
  const r = Math.max(0, Math.min(rc, wTop / 4));
  const right: Vec2[] = [];
  if (r > 1e-6) {
    const cy = wTop - r, cz = zc(cy) - r;
    for (let i = 0; i <= CORNER_SEGMENTS; i++) {
      const a = (Math.PI / 2) * (i / CORNER_SEGMENTS);
      right.push([cy + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  } else right.push([wTop, zt]);
  const yIn = right[right.length - 1][0];
  const mid: Vec2[] = [];
  for (let i = 1; i < CROWN_SEGMENTS; i++) {
    const y = yIn - (2 * yIn * i) / CROWN_SEGMENTS;
    mid.push([y, zc(y)]);
  }
  const left = [...right].reverse().map(([y, z]) => [-y, z] as Vec2);
  return [...right, ...mid, ...left];
}

// ── Generic extrusion part (transoms, decks, webs, guard, prow form) ──
interface ExtSpec {
  id: string;
  partNo?: string;
  name: string;
  group: PartGroup;
  mat: 'oak' | 'ply' | 'printed';
  outline: Vec2[];
  holes?: Vec2[][];
  depth: number;
  transform: Mat4;
  /** Model-frame point used only to pick the default exploded-view direction. */
  center: Vec3;
  step: number;
  grain?: 'x' | 'y' | 'z';
  edges?: EdgeCondition | EdgeCondition[];
  fab?: Part['fab'];
  removable?: boolean;
  /** Extra mass (edge banding, ...) added to the computed wood mass; negative for rabbets / dados / grooves. */
  extraLb?: number;
  notes?: string;
}

function extPart(ctx: Ctx, s: ExtSpec): Part {
  const { p } = ctx;
  const outer = polyAreaPerim(s.outline);
  const holes = (s.holes ?? []).map(polyAreaPerim);
  const area = outer.area - holes.reduce((a, h) => a + h.area, 0);
  const rimPerim = outer.perim + holes.reduce((a, h) => a + h.perim, 0);
  const vol = area * s.depth;
  const surf = 2 * area + rimPerim * s.depth;
  const density = s.mat === 'oak' ? p.oakDensityPcf : s.mat === 'ply' ? ctx.d.plyDensityPcf : p.printedDensityPcf;
  let mass = s.mat === 'printed' ? (vol / IN3_PER_FT3) * density : woodMassLb(p, vol, surf, density);
  mass += s.extraLb ?? 0;
  const xs = s.outline.map((q) => q[0]);
  const ys = s.outline.map((q) => q[1]);
  const dims = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), s.depth].sort((a, b) => a - b);
  const stock: Dims | undefined = s.mat === 'printed' ? undefined : { t: dims[0], w: dims[1], l: dims[2] };
  const out: Part = {
    id: s.id,
    name: s.name,
    group: s.group,
    kind: s.mat === 'oak' ? 'lumber' : s.mat === 'ply' ? 'sheet' : 'printed',
    material: s.mat === 'oak' ? 'white oak' : s.mat === 'ply' ? ctx.plyName : 'ASA',
    geometry: { type: 'extrusion', outline: s.outline, ...(s.holes ? { holes: s.holes } : {}), depth: s.depth },
    transform: s.transform,
    body: 'chassis',
    massLb: mass,
    fab: s.fab ?? (s.mat === 'printed' ? 'print' : 'cnc'),
    step: s.step,
    // Reuse the subsystem's default exploded-view direction through a throwaway box at the same place.
    explode: box(ctx, { id: s.id, name: s.name, group: s.group, mat: 'oak', size: [1, 1, 1], center: s.center, step: s.step }).explode,
  };
  if (s.partNo) out.partNo = s.partNo;
  if (stock) {
    out.stock = stock;
    if (s.mat === 'oak') out.rough = roughOf(p, stock);
  }
  if (s.grain) out.grain = s.grain;
  if (s.edges) out.edges = s.edges;
  if (s.removable) out.removable = true;
  if (s.notes) out.notes = s.notes;
  return out;
}

// ── Lift hand-holds (M9, D-37) ──
export interface LiftSlot {
  /** Slot z range (model frame) and the transom top it forces (a low crest if the slot pushes above the gunwale line). */
  zBot: number;
  zTop: number;
  transomTop: number;
  /** Oak above the slot, and the transom thickness (section of the grip bar). */
  barIn: number;
  thickIn: number;
  lengthIn: number;
}

/**
 * Hand-hold slot of the rear or front transom: bottom ≥ `liftSlotClearIn` above the deck and clear of an abutting storage box.
 * The rear transom may rise into a low crest if that pushes the slot above the gunwale line (the box top forces it); the
 * front transom keeps its top at the gunwale line (the lantern and flag clips straddle it, D-41; at the bow that line has risen by the sheer, D-44)
 * and lowers the slot instead. `transomTop` is the height of the transom's CORNERS; the crown (`transomCrownIn`) arcs above it at the center, so the oak above the slot only grows (D-37).
 */
export function liftSlot(ctx: Pick<Ctx, 'p' | 'L'>, end: 'rear' | 'front'): LiftSlot {
  const { p, L } = ctx;
  const deck = end === 'rear' ? L.deckTop : L.noseTop;
  let floor = deck + p.liftSlotClearIn;
  if (end === 'rear' && L.storage.x0 < L.xRear + L.transom + L.rearLane + 0.5 && L.storage.zTop > L.deckTop) floor = Math.max(floor, L.storage.zTop + 0.25);
  let zBot = floor;
  let zTop = zBot + p.liftSlotHeightIn;
  let transomTop = Math.max(deck + L.sideH, zTop + p.liftBarMinIn);
  if (end === 'front') {
    transomTop = deck + L.sideH + L.sheer.riseIn; // the front transom top follows the sheer line at the bow (D-44); the slot stays where it was
    zTop = Math.min(zTop, transomTop - p.liftBarMinIn);
    zBot = zTop - p.liftSlotHeightIn;
  }
  return { zBot, zTop, transomTop, barIn: p.liftBarMinIn, thickIn: L.transom, lengthIn: p.liftSlotLengthIn };
}

/** Stadium-shaped hand-hold outline (CW, for a hole) centered at (y0, zc), local x = model y, local y = model z. */
function slotHole(y0: number, zc: number, len: number, h: number): Vec2[] {
  const r = h / 2;
  const straight = Math.max(0, len - h) / 2;
  const pts: Vec2[] = [];
  for (let i = 0; i <= LIFT_SLOT_SEGMENTS; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / LIFT_SLOT_SEGMENTS;
    pts.push([y0 + straight + r * Math.cos(a), zc + r * Math.sin(a)]);
  }
  for (let i = 0; i <= LIFT_SLOT_SEGMENTS; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / LIFT_SLOT_SEGMENTS;
    pts.push([y0 - straight + r * Math.cos(a), zc + r * Math.sin(a)]);
  }
  return cw(pts);
}

/** Grip-bar bending stress above the slot for a lift of `loadLbf` through one slot (simply supported over the slot: conservative). */
export function liftBarStressPsi(s: LiftSlot, loadLbf: number): number {
  const M = (loadLbf * s.lengthIn) / 4;
  const S = (s.thickIn * s.barIn * s.barIn) / 6;
  return M / S;
}

// ── Prow (D-36): bent-lam sweep and its form ──
export interface ProwShape {
  /** Sweep centerline in the prow's local XZ (origin = foot center at the transom face, +x forward, +z up). */
  path: Vec2[];
  /** Model-frame origin of the prow part (foot center). */
  origin: Vec3;
  widthIn: number;
  thicknessIn: number;
  plies: number;
  lengthIn: number;
  /** Tightest bend radius of the centerline, and the limit (factor × strip thickness). */
  minRadiusIn: number;
  limitRadiusIn: number;
  legLenIn: number;
  /** Top of the tip's bounding box in the model frame, and the x of the tip. */
  tipTop: { x: number; z: number };
  /** Oak socket block on the front face of the front transom that the leg drops into (build review M3, D-43). */
  socket: { x0: number; depthIn: number; slotDepthIn: number; slotHalfIn: number; halfIn: number; z0: number; z1: number; heightIn: number };
  /** Centerline height of the tip above the leg foot (the lever arm of a grab, checked in analysis/hull.ts) and forward reach of the tip from the leg axis. */
  tipHeightIn: number;
  tipReachIn: number;
}

function minRadius(path: Vec2[]): number {
  let rMin = Infinity;
  for (let i = 1; i < path.length - 1; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i], [cx, cy] = path[i + 1];
    const ab = Math.hypot(bx - ax, by - ay), bc = Math.hypot(cx - bx, cy - by), ca = Math.hypot(ax - cx, ay - cy);
    const cross = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    if (cross < 1e-9) continue;
    rMin = Math.min(rMin, (ab * bc * ca) / (2 * cross));
  }
  return rMin;
}

export function prowShape(ctx: Pick<Ctx, 'p' | 'L'>): ProwShape {
  const { p, L } = ctx;
  const slot = liftSlot(ctx, 'front');
  const t = p.prowPlies * p.prowLamThicknessIn;
  // The leg stands just above the lift slot and is `prowLegMinIn` long (or longer, to the transom top): the socket block rises past the
  // transom top by whatever the leg needs, so the lift slot never has to move (D-43).
  const zFoot = slot.zTop + PROW_LEG_ABOVE_SLOT_IN;
  const gunTop = L.noseTop + L.sideH;
  // Measured to the FLAT side height (not the sheer-raised bow top, D-44): the leg length, tip height and bend are exactly the checked D-43 prow, so the sheer and crown are cosmetic to the grab analysis.
  const legLen = Math.max(p.prowLegMinIn, L.noseTop + L.sideH - zFoot);
  const xEnd = Math.max(0.5, p.prowReachIn - t / 2);
  const zEnd = Math.max(legLen + 1, gunTop + p.prowHeightIn - zFoot);
  const p0: Vec2 = [0, legLen];
  const p1: Vec2 = [0, legLen + PROW_BEZIER_CTRL * (zEnd - legLen)];
  const p2: Vec2 = [xEnd, zEnd];
  const path: Vec2[] = [[0, 0]];
  for (let i = 0; i <= PROW_SAMPLES; i++) {
    const s = i / PROW_SAMPLES, u = 1 - s;
    path.push([u * u * p0[0] + 2 * u * s * p1[0] + s * s * p2[0], u * u * p0[1] + 2 * u * s * p1[1] + s * s * p2[1]]);
  }
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  const origin: Vec3 = [L.xFront + t / 2, 0, zFoot];
  const slotHalf = p.prowWidthIn / 2 + PROW_SOCKET_CLEAR_IN;
  const slotDepth = t + PROW_SOCKET_CLEAR_IN;
  return {
    path, origin, widthIn: p.prowWidthIn, thicknessIn: t, plies: p.prowPlies, lengthIn: len,
    minRadiusIn: minRadius(path), limitRadiusIn: p.prowMinRadiusFactor * p.prowLamThicknessIn, legLenIn: legLen,
    tipTop: { x: origin[0] + xEnd, z: origin[2] + zEnd + t / 2 },
    socket: { x0: L.xFront, depthIn: slotDepth + p.prowSocketCheekIn, slotDepthIn: slotDepth, slotHalfIn: slotHalf, halfIn: slotHalf + p.prowSocketCheekIn, z0: zFoot, z1: zFoot + legLen, heightIn: legLen },
    tipHeightIn: zEnd,
    tipReachIn: xEnd,
  };
}

/** Top of the prow in model coordinates (for the lantern mount). */
export function prowTop(ctx: Ctx): { x: number; z: number } {
  return prowShape(ctx).tipTop;
}

/** Form profile (local x forward, y up), CCW: the spring-back-compensated inside face plus a backing body. Also its tightest radius. */
export function prowFormProfile(ctx: Ctx): { outline: Vec2[]; formMinRadiusIn: number; overbendDeg: number } {
  const { p } = ctx;
  const s = prowShape(ctx);
  const sb = p.prowSpringbackFrac;
  // Rebuild the centerline with every heading change scaled by (1 + spring-back): the strips relax back onto the true shape.
  const pts: Vec2[] = [[0, 0]];
  const normals: Vec2[] = [];
  let lastHeading = 0;
  for (let i = 1; i < s.path.length; i++) {
    const dx = s.path[i][0] - s.path[i - 1][0], dz = s.path[i][1] - s.path[i - 1][1];
    const seg = Math.hypot(dx, dz);
    const heading = Math.atan2(dx, dz); // from vertical toward +x
    lastHeading = heading * (1 + sb);
    const q = pts[i - 1];
    pts.push([q[0] + seg * Math.sin(lastHeading), q[1] + seg * Math.cos(lastHeading)]);
    normals.push([Math.cos(lastHeading), -Math.sin(lastHeading)]);
  }
  normals.push(normals[normals.length - 1]);
  const half = s.thicknessIn / 2;
  const inner = pts.map((q, i) => [q[0] + normals[i][0] * half, q[1] + normals[i][1] * half] as Vec2);
  const xMax = Math.max(...inner.map((q) => q[0])) + FORM_BODY_IN;
  const zTip = inner[inner.length - 1][1];
  const outline = ccw([...inner, [xMax, zTip], [xMax, -FORM_BASE_IN], [inner[0][0], -FORM_BASE_IN]]);
  return { outline, formMinRadiusIn: minRadius(inner), overbendDeg: (lastHeading - Math.atan2(s.path[s.path.length - 1][0] - s.path[s.path.length - 2][0], s.path[s.path.length - 1][1] - s.path[s.path.length - 2][1])) * (180 / Math.PI) };
}

// ── Front-tire pinch analysis and finger guard (M5, D-37) ──
type Seg = [Vec2, Vec2];

function segDist(a: Seg, b: Seg): number {
  const cross = (o: Vec2, p: Vec2, q: Vec2) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(b[0], b[1], a[0]), d2 = cross(b[0], b[1], a[1]), d3 = cross(a[0], a[1], b[0]), d4 = cross(a[0], a[1], b[1]);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  const ps = (pt: Vec2, s: Seg) => {
    const dx = s[1][0] - s[0][0], dy = s[1][1] - s[0][1];
    const l2 = dx * dx + dy * dy;
    const u = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((pt[0] - s[0][0]) * dx + (pt[1] - s[0][1]) * dy) / l2));
    return Math.hypot(pt[0] - (s[0][0] + u * dx), pt[1] - (s[0][1] + u * dy));
  };
  return Math.min(ps(a[0], b), ps(a[1], b), ps(b[0], a), ps(b[1], a));
}

export interface FingerAnalysis {
  /** Smallest plan-view distance between a front tire and the hull over the whole steering sweep. */
  minGapIn: number;
  /** True when that gap is below the no-pinch threshold. */
  guardNeeded: boolean;
  /** Plan zone (left side; the right mirrors it) that lies within the threshold of the tire at some angle; null when no guard is needed. */
  hazard: { x0: number; x1: number; outMax: number } | null;
  /** Top of the tire, and the hood height. */
  tireTopZ: number;
  hoodZ: number;
  /** Why no guard can be built (tire taller than the hull side), if so. */
  infeasible?: string;
}

/** Tire (plan rectangle) at steer angle `deg` for the left (s = 1) or right (s = −1) wheel. */
export function frontTirePlan(ctx: Ctx, s: 1 | -1, deg: number): Vec2[] {
  const { p, L } = ctx;
  const a = (deg * Math.PI) / 180, c = Math.cos(a), si = Math.sin(a);
  const r = p.wheelDiameterIn / 2, hw = p.tireWidthIn / 2;
  const cx = L.WB, cy = (s * p.frontTrackIn) / 2;
  return ([[-r, -hw], [r, -hw], [r, hw], [-r, hw]] as Vec2[]).map(([dx, dy]) => {
    const x = cx + dx - L.kx, y = cy + dy;
    return [L.kx + c * x - si * y, si * x + c * y] as Vec2;
  });
}

function hullSegments(L: Layout): Seg[] {
  const yoN = L.hwN + L.side, yoC = L.hwC + L.side + L.flare;
  return [
    [[L.xs, yoN], [L.xFront, yoN]],
    [[L.xs, yoN], [L.xs, yoC]],
    [[L.xRear, yoC], [L.xs, yoC]],
    [[L.xFront, yoN], [L.xFront, 0]],
  ];
}

const polyDist = (poly: Vec2[], seg: Seg): number => {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist([poly[i], poly[(i + 1) % poly.length]], seg));
  return d;
};
const polyPointDist = (poly: Vec2[], pt: Vec2): number => polyDist(poly, [pt, pt]);

const fingerCache = new Map<string, FingerAnalysis>();

/** Pinch analysis (cached on the numbers it depends on: the sweep is the costliest thing the hull builder does). */
export function fingerAnalysis(ctx: Ctx): FingerAnalysis {
  const { p, L } = ctx;
  const key = [p.wheelDiameterIn, p.tireWidthIn, p.frontTrackIn, p.steerLockDeg, p.fingerGapMinIn, p.fingerGuardClearIn, p.steeringClearanceIn, p.fingerGuardThickIn,
    L.WB, L.kx, L.xs, L.xFront, L.xRear, L.hwN, L.hwC, L.flare, L.side, L.railBand, L.noseTop, L.sideH].join('|');
  const hit = fingerCache.get(key);
  if (hit) return hit;
  const out = computeFinger(ctx);
  if (fingerCache.size > 2000) fingerCache.clear();
  fingerCache.set(key, out);
  return out;
}

function computeFinger(ctx: Ctx, stepDeg = 1): FingerAnalysis {
  const { p, L } = ctx;
  const lock = Math.abs(p.steerLockDeg);
  const tires: Vec2[][] = [];
  for (let d = -lock; d <= lock + 1e-9; d += stepDeg) tires.push(frontTirePlan(ctx, 1, d));
  tires.push(frontTirePlan(ctx, 1, lock));
  const segs = hullSegments(L);
  let minGap = Infinity;
  for (const t of tires) for (const sg of segs) minGap = Math.min(minGap, polyDist(t, sg));
  const tireTopZ = p.wheelDiameterIn;
  const hoodZ = tireTopZ + Math.max(p.fingerGuardClearIn, p.steeringClearanceIn);
  const out: FingerAnalysis = { minGapIn: minGap, guardNeeded: minGap < p.fingerGapMinIn - 1e-9, hazard: null, tireTopZ, hoodZ };
  if (!out.guardNeeded) return out;
  // Hazard zone: hull-boundary points that come within the threshold of a tire at some angle (the nose side and the shoulder face).
  const yoN = L.hwN + L.side;
  const gapMin = p.fingerGapMinIn;
  const boxes = tires.map((t) => [Math.min(...t.map((q) => q[0])), Math.max(...t.map((q) => q[0])), Math.min(...t.map((q) => q[1])), Math.max(...t.map((q) => q[1]))]);
  let x0 = Infinity, x1 = -Infinity, outMax = 0;
  for (const sg of segs.slice(0, 2)) {
    const len = Math.hypot(sg[1][0] - sg[0][0], sg[1][1] - sg[0][1]);
    const n = Math.max(2, Math.ceil(len / 0.25));
    for (let i = 0; i <= n; i++) {
      const q: Vec2 = [sg[0][0] + ((sg[1][0] - sg[0][0]) * i) / n, sg[0][1] + ((sg[1][1] - sg[0][1]) * i) / n];
      let near = false;
      for (let k = 0; k < tires.length && !near; k++) {
        const b = boxes[k];
        if (q[0] < b[0] - gapMin || q[0] > b[1] + gapMin || q[1] < b[2] - gapMin || q[1] > b[3] + gapMin) continue;
        near = polyPointDist(tires[k], q) < gapMin;
      }
      if (near) {
        x0 = Math.min(x0, q[0]);
        x1 = Math.max(x1, q[0]);
        outMax = Math.max(outMax, q[1] - yoN);
      }
    }
  }
  out.hazard = { x0: Math.max(L.xs, x0), x1: x1 + GUARD_X_MARGIN_IN, outMax: Math.max(p.fingerGapMinIn, outMax + GUARD_OUT_MARGIN_IN) };
  const zg = L.noseTop + L.sideH - L.railBand;
  if (hoodZ + (HOOD_FACTOR + 1) * p.fingerGuardThickIn > zg) out.infeasible = `the ${tireTopZ}" tire tops out too close to the nose gunwale for a hood (needs ≤ ${(zg - (HOOD_FACTOR + 1) * p.fingerGuardThickIn - Math.max(p.fingerGuardClearIn, p.steeringClearanceIn)).toFixed(2)}")`;
  return out;
}

/** Height (model z) of the finger-guard insert axis: above the gunwale's web groove, oak left over it, hole radius clear (build review M2, D-43). */
export function guardInsertZ(L: Layout, p: { grooveDepthIn: number }): number {
  const zg = L.noseTop + L.sideH - L.railBand;
  return zg + p.grooveDepthIn + GUARD_INSERT_CLEAR_IN + GUARD_INSERT_RADIUS_IN;
}

/**
 * Profile of the finger guard in (out from the hull face, z), CCW. Captured-ply sides: a joggled L whose leg lies in the
 * web recess (between the chine and gunwale faces) and whose strap lies on the gunwale face. Other constructions have a
 * flat outer face, so the leg stands outside it.
 */
function guardProfile(ctx: Ctx, g: number, hoodZ: number, strapTop: number): Vec2[] {
  const { p, L } = ctx;
  const tw = p.fingerGuardThickIn;
  const rc = (L.side - p.panelPlyIn) / 2; // web recess behind the oak faces
  const zg = L.noseTop + L.sideH - L.railBand;
  const z0 = L.noseBot + L.railBand;
  if (p.sideConstruction === SIDE_CONSTRUCTION.capturedPly && hoodZ >= z0) {
    return ccw([
      [-rc, hoodZ], [g, hoodZ], [g, hoodZ + HOOD_FACTOR * tw], [-rc + tw, hoodZ + HOOD_FACTOR * tw], [-rc + tw, zg - tw],
      [tw, zg - tw], [tw, strapTop], [0, strapTop], [0, zg], [-rc, zg],
    ]);
  }
  return ccw([[0, hoodZ], [g, hoodZ], [g, hoodZ + HOOD_FACTOR * tw], [tw, hoodZ + HOOD_FACTOR * tw], [tw, strapTop], [0, strapTop]]);
}

// ── Body ──
export function buildBody(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const pl = p.panelPlyIn;
  const H = L.sideH;
  const flare = L.flare;
  const g = p.grooveDepthIn;
  const dd = p.deckCaptureDepthIn;
  const slop = p.grooveSlopIn;
  const captured = p.sideConstruction === SIDE_CONSTRUCTION.capturedPly;
  const openFrame = p.sideConstruction === SIDE_CONSTRUCTION.openFrame;
  const sideCond: EdgeCondition = openFrame ? 'edged' : 'captured';
  const na = L.accessPanel; // kingpin-nut access opening in the nose deck (workstream A, M10, D-34); null without the crossbar
  const rearTx = L.xRear + L.transom; // inner face of the rear transom
  const frontTx = L.xFront - L.transom; // inner face of the front transom

  // ── Decks (extrusions in plan; capture: rabbets in the chines, dados in the transoms, banding on the step) ──
  {
    const x0 = rearTx - dd, x1 = L.xs, yH = L.hwC + (openFrame ? 0 : dd);
    const front = 2 * yH;
    parts.push(extPart(ctx, {
      id: 'deck-cabin', name: 'Cabin deck', group: 'body', mat: 'ply', step: HULL_STEP.deck, grain: 'x', center: [(x0 + x1) / 2, 0, L.deckTop],
      outline: rectCCW(x0, x1, -yH, yH), depth: L.ply, transform: compose([0, 0, L.deckBot]),
      // Outline edges in order: right side, front (the step), left side, rear.
      edges: [sideCond, 'edged', sideCond, 'captured'],
      extraLb: edgeBandLb(ctx, front, L.ply),
      notes: `Sits in a ${dd}" rabbet in each chine (D-35) and a ${dd}" dado in the rear transom; the front (step) edge is banded with ${p.edgeBandIn}" oak. ${DECK_ASSEMBLY_NOTE}`,
    }));
  }
  {
    const x0 = L.xs, x1 = frontTx + dd, yH = L.hwN + (openFrame ? 0 : dd);
    const outline = rectCCW(x0, x1, -yH, yH);
    const holes: Vec2[][] = [];
    if (na && na.x1 > na.x0 && na.hw > 0) holes.push(cw(rectCCW(na.x0, na.x1, -na.hw, na.hw)));
    // Edge conditions: the four outline edges, then (when there is a cutout) the four edges of its rim, all banded.
    const rim = holes.length ? 2 * (na!.x1 - na!.x0 + 2 * na!.hw) : 0;
    parts.push(extPart(ctx, {
      id: 'deck-nose', name: 'Nose deck', group: 'body', mat: 'ply', step: HULL_STEP.deck, grain: 'x', center: [(x0 + x1) / 2, 0, L.noseTop],
      outline, ...(holes.length ? { holes } : {}), depth: L.ply, transform: compose([0, 0, L.noseBot]),
      edges: [sideCond, 'captured', sideCond, 'edged', ...(holes.length ? (['edged', 'edged', 'edged', 'edged'] as EdgeCondition[]) : [])],
      extraLb: edgeBandLb(ctx, 2 * yH + rim, L.ply),
      notes: `Sits in rabbets in the nose chines and a dado in the front transom; the rear (step) edge is banded with ${p.edgeBandIn}" oak. ${DECK_ASSEMBLY_NOTE}`
        + (holes.length ? ' The kingpin-access opening (Layout.accessPanel, M10) is cut through it; the opening rim is banded with oak and the removable panel lies flush in it. Edge conditions: outline edges first, then the four rim edges.' : ' No kingpin-access opening without the kingpin crossbar (Layout.accessPanel is null).'),
    }));
  }

  // ── Sides ──
  const runs = [
    { zone: 'cabin', x0: rearTx, x1: L.xs, hw: L.hwC, bot: L.deckBot, top: L.deckTop },
    { zone: 'nose', x0: L.xs, x1: frontTx, hw: L.hwN, bot: L.noseBot, top: L.noseTop },
  ] as const;
  for (const run of runs) {
    const zTop = run.top + H;
    const runFlare = run.zone === 'cabin' ? flare : 0;
    for (const { s, tag } of SIDES) {
      const yc = s * (run.hw + L.side / 2);
      const id = `side-${run.zone}-${tag}`;
      const nm = `${run.zone === 'cabin' ? 'Cabin' : 'Nose'} ${tag === 'L' ? 'left' : 'right'}`;
      const yr = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];
      const len = run.x1 - run.x0;
      const rabbetLb = oakLb(ctx, len * dd * L.ply);
      if (p.sideConstruction === SIDE_CONSTRUCTION.solidOak) {
        const b = box(ctx, { id: `${id}-board`, partNo: `side-${run.zone}-board`, name: `${nm} side board`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
          ...span([run.x0, run.x1], yr(yc - L.side / 2, yc + L.side / 2), [run.bot, zTop]) });
        b.massLb -= rabbetLb;
        b.notes = `Deck edge sits in a ${dd}" rabbet on the inside bottom (D-35). ${SIDE_ASSEMBLY_NOTE}`;
        parts.push(b);
      } else if (captured) {
        const grooveLb = oakLb(ctx, len * (pl + slop) * g);
        const chine = box(ctx, { id: `${id}-chine`, partNo: `side-${run.zone}-chine`, name: `${nm} chine`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
          ...span([run.x0, run.x1], yr(yc - L.side / 2, yc + L.side / 2), [run.bot, run.bot + L.railBand]) });
        chine.massLb -= grooveLb + rabbetLb;
        chine.notes = `Top groove ${(pl + slop).toFixed(3)}" × ${g}" holds the web (cut at the measured ply + ~1 mm, D-43), ${((L.side - pl - slop) / 2).toFixed(3)}" oak walls each side; inside bottom rabbet ${dd}" × ${L.ply.toFixed(3)}" holds the deck (D-35); the chine rests on the rail below it and is Domino-tied to it (side-to-frame tie, D-43). Mill from quartersawn stock and cut the groove from the best face with a hold-down. ${SIDE_ASSEMBLY_NOTE}`;
        parts.push(chine);
        // The nose gunwale follows the sheer (D-44): an extrusion in the side (XZ) plane whose top AND underside climb with the curve; the web's top edge below it
        // climbs with it, so the web stays captured in the underside groove along its whole length. With no rise (or in the cabin) it is the straight box it always was.
        const curved = run.zone === 'nose' && L.sheer.riseIn > 1e-9;
        const sxs = curved ? sheerSamples(L, run.x0, run.x1) : [];
        const gunNote = `Underside groove ${(pl + slop).toFixed(3)}" × ${g}" holds the web (D-35, D-43). ${SIDE_ASSEMBLY_NOTE}`;
        if (curved) {
          const lo: Vec2[] = sxs.map((x): Vec2 => [x, zTop - L.railBand + sheerRise(L, x)]);
          const hi: Vec2[] = sxs.map((x): Vec2 => [x, zTop + sheerRise(L, x)]).reverse();
          const curveGrooveLb = oakLb(ctx, polyLen(lo) * (pl + slop) * g);
          parts.push(extPart(ctx, {
            id: `${id}-gunwale`, partNo: `side-${run.zone}-gunwale`, name: `${nm} gunwale`, group: 'body', mat: 'oak', step: HULL_STEP.sides, grain: 'x', fab: 'bandsaw',
            center: [(run.x0 + run.x1) / 2, yc, zTop + L.sheer.riseIn / 2],
            outline: [...lo, ...hi], depth: L.side,
            // local x → X, local y → Z, local z → −Y: the extrusion runs from the outboard face (origin) inboard.
            transform: frameMat([1, 0, 0], [0, 0, 1], [0, -1, 0], [0, yc + L.side / 2, 0]), extraLb: -curveGrooveLb,
            notes: `Sawn from a ${(L.railBand + L.sheer.riseIn).toFixed(2)}" wide board along the sheer curve (rises ${L.sheer.riseIn}" over the forward ${(L.sheer.x1 - L.sheer.x0).toFixed(1)}", flat before it; D-44); cut the groove with a template-guided router after sawing, or laminate two bent strips. ${gunNote}`,
          }));
        } else {
          const gun = box(ctx, { id: `${id}-gunwale`, partNo: `side-${run.zone}-gunwale`, name: `${nm} gunwale`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
            ...span([run.x0, run.x1], yr(yc + s * runFlare - L.side / 2, yc + s * runFlare + L.side / 2), [zTop - L.railBand, zTop]) });
          gun.massLb -= grooveLb;
          gun.notes = gunNote;
          parts.push(gun);
        }
        // Side web: an extrusion whose lower and upper ends enter the chine and gunwale grooves; its ends enter the transom dados.
        const z0 = run.bot + L.railBand;
        const z1 = zTop - L.railBand;
        const hW = Math.max(0.1, z1 - z0);
        const phi = Math.atan2(runFlare, hW);
        const rear = run.zone === 'cabin';
        const xw0 = rear ? run.x0 - dd : run.x0;
        const xw1 = rear ? run.x1 : run.x1 + dd;
        const wLen = xw1 - xw0;
        const slant = Math.hypot(hW, runFlare);
        const hTot = slant + 2 * g;
        const u: Vec3 = [0, s * Math.sin(phi), Math.cos(phi)];
        const ez: Vec3 = [0, -Math.cos(phi), s * Math.sin(phi)]; // ex × u, with ex = +X
        const c0: Vec3 = [xw0, yc, z0];
        const org: Vec3 = [c0[0] - g * u[0] - (pl / 2) * ez[0], c0[1] - g * u[1] - (pl / 2) * ez[1], c0[2] - g * u[2] - (pl / 2) * ez[2]];
        const frontCond: EdgeCondition = rear ? 'edged' : 'captured';
        const rearCond: EdgeCondition = rear ? 'captured' : 'edged';
        // Web outline: a rectangle, or (nose with sheer) one whose top edge climbs with the gunwale groove (D-44). Edges in outline order: bottom, front end, top edge(s), rear end.
        let webOutline = rectCCW(0, wLen, 0, hTot);
        let webEdges: EdgeCondition[] = ['captured', frontCond, 'captured', rearCond];
        if (curved) {
          const wx = sheerSamples(L, xw0, xw1);
          const top: Vec2[] = wx.map((x) => [x - xw0, hTot + sheerRise(L, x)] as Vec2).reverse();
          webOutline = [[0, 0], [wLen, 0], ...top];
          webEdges = ['captured', frontCond, ...top.slice(1).map(() => 'captured' as EdgeCondition), rearCond];
        }
        parts.push(extPart(ctx, {
          id: `${id}-web`, partNo: `side-${run.zone}-web`, name: `${nm} side panel`, group: 'body', mat: 'ply', step: HULL_STEP.sides, grain: 'x',
          center: [(xw0 + xw1) / 2, yc + (s * runFlare) / 2, (z0 + z1) / 2],
          outline: webOutline, depth: pl, transform: frameMat([1, 0, 0], u, ez, org),
          edges: webEdges,
          extraLb: edgeBandLb(ctx, hTot, pl),
          notes: `Captured in the chine and gunwale grooves (${g}" deep) and in a stopped dado in the ${rear ? 'rear' : 'front'} transom; the ${rear ? 'front' : 'rear'} end at the shoulder is banded with ${p.edgeBandIn}" oak (D-22, D-35). ${SIDE_ASSEMBLY_NOTE} The closed dado is vented: a ${p.ventHoleIn}" relief hole through the transom at its end lets air and epoxy escape as the transom slides on (hydraulic lock).`,
        }));
      } else {
        // Open frame: gunwale on posts every 12".
        parts.push(box(ctx, { id: `${id}-gunwale`, partNo: `side-${run.zone}-gunwale`, name: `${nm} gunwale`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
          ...span([run.x0, run.x1], yr(yc - L.side / 2, yc + L.side / 2), [zTop - L.railBand, zTop]) }));
        const n = Math.max(2, Math.ceil((run.x1 - run.x0) / POST_SPACING_IN) + 1);
        for (let i = 0; i < n; i++) {
          const x = run.x0 + POST_X_IN / 2 + ((run.x1 - run.x0 - POST_X_IN) * i) / (n - 1);
          parts.push(box(ctx, { id: `${id}-post-${i + 1}`, partNo: `side-${run.zone}-post`, name: `${nm} post ${i + 1}`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
            ...span([x - POST_X_IN / 2, x + POST_X_IN / 2], yr(yc - L.side / 2, yc + L.side / 2), [run.bot, zTop - L.railBand]), grain: 'z' }));
        }
      }
    }
  }

  // ── Shoulder panels closing the step from body width to nose width (all four edges banded) ──
  if (L.hwC > L.hwN + L.side + 0.01) {
    for (const { s, tag } of SIDES) {
      const ya = s * (L.hwN + L.side), yb = s * L.hwC;
      const sh = box(ctx, {
        id: `shoulder-${tag}`, partNo: 'shoulder', name: `Shoulder panel ${tag}`, group: 'body', mat: 'ply', edges: 'edged', step: HULL_STEP.shoulder,
        ...span([L.xs - pl, L.xs], [Math.min(ya, yb), Math.max(ya, yb)], [L.deckTop, L.deckTop + H]), grain: 'y',
      });
      const wy = Math.abs(yb - ya);
      sh.massLb += edgeBandLb(ctx, 2 * (wy + H), pl);
      sh.notes = `All four edges banded with ${p.edgeBandIn}" oak; epoxy fillets to the deck and both sides (not structural).`;
      parts.push(sh);
    }
  }

  // ── Transoms (full width, wrapping the side ends) with a lift hand-hold each (M9, D-37) ──
  const tT = L.transom;
  /** Vent hole (through the transom) at the closed end of a dado: air and epoxy escape as the transom slides on (build review M4, D-43). */
  const ventR = p.ventHoleIn / 2;
  const vent = (y: number, z: number): Vec2[] => cw(circleLoop(y, z, ventR, 8));
  {
    const rs = liftSlot(ctx, 'rear');
    const w0 = L.hwC + L.side;
    const zb = L.deckTop - p.crossmemberDepthIn, zt = rs.transomTop;
    const t0 = L.web.z0, t1 = L.web.z1;
    // Right side up to the foot of the top-corner arc, the crowned top (D-44), then the mirrored left side down.
    const wTopR = w0 + flare;
    const topR = transomTopOutline(wTopR, zt, p.transomCrownIn, Math.min(p.transomCornerRadiusIn, (zt - (flare > 1e-6 ? t1 : zb)) / 2));
    const sideR: Vec2[] = flare > 1e-6 ? [[w0, zb], [w0, t0], [w0 + flare, t1]] : [[w0, zb]];
    const outline = ccw([...sideR, ...topR, ...[...sideR].reverse().map(([y, z]) => [-y, z] as Vec2)]);
    const dadoLb = oakLb(ctx, 2 * (L.hwC + dd) * L.ply * dd) + 2 * oakLb(ctx, (pl + slop) * (L.web.z1 - L.web.z0 + 2 * g) * dd);
    // Vent holes: the web-end dados (mid height of the web, at the web's y) and the two ends of the deck dado.
    const webY = L.hwC + L.side / 2 + flare / 2, webZ = (L.web.z0 + L.web.z1) / 2, deckVentY = L.hwC + dd - 0.15;
    const ventHoles = [vent(webY, webZ), vent(-webY, webZ), vent(deckVentY, L.deckBot + L.ply / 2), vent(-deckVentY, L.deckBot + L.ply / 2)];
    parts.push(extPart(ctx, {
      id: 'transom-rear', name: 'Rear transom', group: 'body', mat: 'oak', step: HULL_STEP.transom, grain: 'x', center: [L.xRear, 0, (zb + zt) / 2],
      outline, holes: [slotHole(0, (rs.zBot + rs.zTop) / 2, rs.lengthIn, p.liftSlotHeightIn), ...ventHoles], depth: tT,
      transform: frameMat([0, 1, 0], [0, 0, 1], [1, 0, 0], [L.xRear, 0, 0]), extraLb: -dadoLb,
      notes: `${tT}" oak, glued up from two boards (no board is ${(w0 * 2).toFixed(0)}" wide; keep the glue line clear of the slot). Lift hand-hold ${rs.lengthIn}" × ${p.liftSlotHeightIn}" (gloved hand), ${rs.barIn}" of oak above it; routed 3/8" roundovers both faces. The top edge is a ${p.transomCrownIn}" crown (arc) with ${p.transomCornerRadiusIn}" rounded corners (D-44). Deck dado ${dd}" deep on the front face; stopped dados for the side panels (D-35, D-37); the closed dado ends are vented with ${p.ventHoleIn}" holes through the transom (4 holes: bung or epoxy-fill them after the glue-up). `
        + `THE TRANSOM GOES ON LAST (M4): it slides in X onto the deck edge, both web ends, the chine and gunwale tenons and the rail tenons in one glue-up (about 14 joints: use 120-minute slow epoxy, rehearse twice); the corner backers and the handle-socket holes are done on the bench first.`,
    }));
    // Backers behind the handle sockets and the ratchet bracket (build review S13, D-43): the bolts pull on them from the outside.
    const hg = handleGeometry(p, L);
    const bkT = p.blockingThickIn;
    for (const { s, tag } of SIDES) {
      const yHi = L.hwC, yLo = Math.max(0.5, hg.yPost - hg.socketY / 2 - 0.5);
      const bz0 = Math.max(L.deckTop + 0.5, hg.zBot - 0.5), bz1 = hg.zTop;
      parts.push(box(ctx, {
        id: `transom-backer-${tag}`, partNo: 'transom-backer', name: `Rear transom backer ${tag}`, group: 'body', mat: 'oak', step: HULL_STEP.transom, grain: 'z',
        ...span([rearTx, rearTx + bkT], [s * yLo, s * yHi].sort((x, y) => x - y) as [number, number], [bz0, bz1]),
        notes: `${bkT}" oak backer glued (epoxy, full face) to the INSIDE of the rear transom behind the push-handle socket${tag === 'L' ? ' and the ratchet bracket' : ''}: the socket bolts (1/4" carriage bolts, nuts and fender washers recessed in it) pull on ${tT + bkT}" of oak instead of ${tT}". Glue it on the bench before the transom goes on; a rear storage box starts ${bkT}" farther forward (Layout.rearLane).`,
      }));
    }
  }
  {
    const fs = liftSlot(ctx, 'front');
    const wN = L.hwN + L.side;
    const zbF = L.noseTop - p.crossmemberDepthIn, ztF = fs.transomTop;
    const dadoF = oakLb(ctx, 2 * (L.hwN + dd) * L.ply * dd) + 2 * oakLb(ctx, (pl + slop) * (L.noseTop + H - L.railBand - (L.noseBot + L.railBand) + 2 * g) * dd);
    const webY = L.hwN + L.side / 2, webZ = (L.noseBot + L.railBand + L.noseTop + H - L.railBand) / 2, deckVentY = L.hwN + dd - 0.15;
    const ventHoles = [vent(webY, webZ), vent(-webY, webZ), vent(deckVentY, L.noseBot + L.ply / 2), vent(-deckVentY, L.noseBot + L.ply / 2)];
    parts.push(extPart(ctx, {
      id: 'transom-front', name: 'Front transom', group: 'body', mat: 'oak', step: HULL_STEP.transom, grain: 'x', center: [L.xFront, 0, (zbF + ztF) / 2],
      outline: ccw([[wN, zbF], ...transomTopOutline(wN, ztF, p.transomCrownIn, Math.min(p.transomCornerRadiusIn, (ztF - zbF) / 2)), [-wN, zbF]]), holes: [slotHole(0, (fs.zBot + fs.zTop) / 2, fs.lengthIn, p.liftSlotHeightIn), ...ventHoles], depth: tT,
      transform: frameMat([0, 1, 0], [0, 0, 1], [1, 0, 0], [L.xFront - tT, 0, 0]), extraLb: -dadoF,
      notes: `${tT}" oak. Lift hand-hold ${fs.lengthIn}" × ${p.liftSlotHeightIn}" (gloved hand), ${fs.barIn}" of oak above it, routed 3/8" roundovers. The top follows the ${L.sheer.riseIn}" sheer rise at the bow, with a ${p.transomCrownIn}" crown and ${p.transomCornerRadiusIn}" rounded corners (D-44). The prow socket block is glued and screwed to its front face above the slot (D-9, D-36, D-43); the nose run mirrors the rear: the front transom goes on LAST, sliding in −X onto the deck edge, web ends and chine / gunwale / rail tenons (M4); its closed dado ends are vented with ${p.ventHoleIn}" holes.`,
    }));
  }

  // ── Scuppers: 3/8" epoxy-lined holes THROUGH THE CHINE at deck level, with stainless nipples (build review M7, D-43) ──
  // The deck is a closed tub (two full-width transoms, 7" sides): slush and rain drain out at the rear corners, the cabin shoulder corners
  // and the nose front corners. Through the chine (not the deck) because the bolster and joists fill the space under the nose deck.
  for (const { x, zone, deckZ, hw, tagPos } of openFrame ? [] : scupperSites(ctx)) {
    for (const { s, tag } of SIDES) {
      parts.push(cylinder(ctx, {
        id: `scupper-${tagPos}-${tag}`, partNo: 'scupper', name: `Deck scupper ${tagPos} ${tag}`, group: 'body', mat: 'fixed', kind: 'purchased', material: '316 stainless drain nipple', massLb: SCUPPER_MASS_LB,
        fab: 'buy', step: HULL_STEP.sides, center: [x, s * (hw + (L.side + SCUPPER_STICKOUT_IN) / 2), deckZ + SCUPPER_BELOW_SURFACE_IN + p.scupperDiaIn / 2], axis: 'y', radius: p.scupperDiaIn / 2, length: L.side + SCUPPER_STICKOUT_IN,
        explode: [0, s, 0], sourcing: { vendor: 'McMaster-Carr (316 stainless barbed / threaded drain nipple, 3/8" tube)' },
        notes: `${p.scupperDiaIn}" hole through the ${zone} chine at deck level (its lower edge just above the deck surface, epoxy-lined so no cut oak end is bare), a 316 nipple bedded in epoxy.`,
      }));
    }
  }

  // ── Prow: removable bent-lam sweep that drops into an oak socket on the front transom, and its form as a reference part ──
  {
    const pr = prowShape(ctx);
    const sk = pr.socket;
    // Socket block: a U in plan (open to the transom) extruded up; the leg bears on its front wall and cheeks, its back is the transom face.
    const sOutline: Vec2[] = [[0, -sk.halfIn], [sk.depthIn, -sk.halfIn], [sk.depthIn, sk.halfIn], [0, sk.halfIn], [0, sk.slotHalfIn], [sk.slotDepthIn, sk.slotHalfIn], [sk.slotDepthIn, -sk.slotHalfIn], [0, -sk.slotHalfIn]];
    parts.push(extPart(ctx, {
      id: 'prow-socket', name: 'Prow socket block', group: 'body', mat: 'oak', step: HULL_STEP.transom, grain: 'z', center: [sk.x0 + sk.depthIn / 2, 0, (sk.z0 + sk.z1) / 2],
      outline: sOutline, depth: sk.heightIn, transform: frameMat([1, 0, 0], [0, 1, 0], [0, 0, 1], [sk.x0, 0, sk.z0]),
      notes: `Oak (vertical grain) U-block, ${(2 * sk.halfIn).toFixed(2)}" wide × ${sk.depthIn.toFixed(2)}" deep × ${sk.heightIn.toFixed(1)}" tall, ${p.prowSocketCheekIn}" cheeks. The prow leg (${pr.widthIn}" × ${pr.thicknessIn}") drops in from above and bears on the cheeks and the front wall over its whole ${pr.legLenIn.toFixed(1)}" length; its back bears on the front-transom face. Glued (epoxy, cheek ends) and screwed from inside the hull (4 × 1/4-20 stainless flat-head screws into stainless inserts in the cheeks, nothing protrudes). ${sk.z1 >= liftSlot(ctx, 'front').transomTop ? `It rises ${(sk.z1 - liftSlot(ctx, 'front').transomTop).toFixed(1)}" above the transom top` : `Its top stands ${(liftSlot(ctx, 'front').transomTop - sk.z1).toFixed(1)}" below the transom top (the transom rises with the sheer, D-44)`}, beside the lantern and flag clips. Round every outside corner 3/8".`,
    }));
    const area = pr.widthIn * pr.thicknessIn;
    const vol = area * pr.lengthIn;
    const surf = 2 * pr.lengthIn * (pr.widthIn + pr.thicknessIn) + 2 * area;
    const dir = Math.hypot(0.3, 1);
    parts.push({
      id: 'prow', name: 'Prow (bent-lam stem)', group: 'body', kind: 'bentlam', material: 'white oak',
      geometry: { type: 'sweep', path: pr.path, width: pr.widthIn, thickness: pr.thicknessIn, plies: pr.plies },
      transform: compose(pr.origin), body: 'chassis', massLb: woodMassLb(p, vol, surf, p.oakDensityPcf),
      fab: 'bentlam', step: HULL_STEP.prow, removable: true, explode: [0.3 / dir, 0, 1 / dir],
      stock: { t: pr.thicknessIn, w: pr.widthIn, l: pr.lengthIn },
      rough: roughOf(p, { t: pr.thicknessIn, w: pr.widthIn, l: pr.lengthIn }),
      grain: 'z',
      notes: `${pr.plies} plies of ${p.prowLamThicknessIn}" white oak (${pr.thicknessIn}" total) × ${pr.widthIn}" wide, epoxy-laminated (slow hardener) on the prow form; ${pr.legLenIn.toFixed(2)}" straight leg that drops into the prow socket block on the front transom, then a Bezier sweep to ${p.prowHeightIn}" above the gunwale. Tightest radius ${pr.minRadiusIn.toFixed(1)}" (limit ${pr.limitRadiusIn.toFixed(1)}" = ${p.prowMinRadiusFactor}× strip). The leg BEARS in the socket; two 5/16-18 stainless inserts in its back and 5/16-18 stainless thumb-knob bolts through the transom (short bolts: knobs stand about 3/4" into the nose) only RETAIN it (D-9, D-36, D-43). Label it "not a handle": a grab is checked at ${p.prowGrabLbf} lbf at the tip (prow-grab). `
        + `Lay-up: resaw 5/32" strips from quartersawn or rift 4/4 stock and drum-sand to ${p.prowLamThicknessIn}" (yield about 40%): ${pr.plies} strips ${p.prowLamThicknessIn}" × ${(pr.widthIn + 0.25).toFixed(2)}" × ${(pr.lengthIn + 2).toFixed(0)}" plus 2 spares; trim after glue-up. Clamp with cauls and bar clamps every 2-3" or a vacuum bag, NOT ratchet straps (they do not clamp a convex form along its length); tape or wax the form (epoxy bonds to MDF); bend a 3-ply test strip first to measure spring-back.`,
    });
    const fp = prowFormProfile(ctx);
    const depth = pr.widthIn + 2 * FORM_CHEEK_IN;
    const yForm = L.hwC + L.side + flare + FORM_SIDE_OFFSET_IN + depth;
    parts.push({
      id: 'prow-form', name: 'Prow lamination form (shop jig)', group: 'reference', kind: 'reference', material: '3/4" MDF, glued stack',
      geometry: { type: 'extrusion', outline: fp.outline, depth },
      // local x → model x, local y → model z, local z → −Y; drawn beside the cart, foot at ground + base.
      transform: frameMat([1, 0, 0], [0, 0, 1], [0, -1, 0], [L.xFront - 6, yForm, FORM_BASE_IN]),
      body: 'chassis', massLb: 0, fab: 'cnc', step: STEP.payload, payload: true, explode: [0, 0, 0],
      notes: `CNC the profile out of 3/4" MDF sheets (${Math.ceil(depth / 0.75)} layers glued for ${depth.toFixed(2)}" depth); the strips wrap the convex edge. Spring-back allowance ${(p.prowSpringbackFrac * 100).toFixed(0)}%: every heading change is overbent by that fraction (${fp.overbendDeg.toFixed(1)}° extra at the tip); tightest form radius ${fp.formMinRadiusIn.toFixed(1)}". Verify with a test strip before cutting the form (spring-back is a placeholder, D-36). Clamp with cauls and bar clamps every 2-3" or a vacuum bag (not ratchet straps); wax or tape the form; 24 h cure. Shown beside the cart; not part of its mass.`,
    });
  }

  // ── Finger guards over the front-tire pinch zone (M5) ──
  const fa = fingerAnalysis(ctx);
  if (fa.guardNeeded && fa.hazard && !fa.infeasible) {
    const hz = fa.hazard;
    const gl = hz.x1 - hz.x0;
    const zg = L.noseTop + H - L.railBand;
    const strapTop = Math.min(zg + GUARD_STRAP_IN, L.noseTop + H - 0.25);
    const prof = guardProfile(ctx, hz.outMax, fa.hoodZ, strapTop);
    const yoN = L.hwN + L.side;
    for (const { s, tag } of SIDES) {
      // local x → s·Y (outboard), local y → Z, local z → s·X; origin at the forward-most or rear-most end accordingly.
      const org: Vec3 = [s > 0 ? hz.x0 : hz.x1, s * yoN, 0];
      parts.push(extPart(ctx, {
        id: `guard-${tag}`, partNo: 'finger-guard', name: `Finger guard ${tag}`, group: 'body', mat: 'printed', step: STEP.finish,
        center: [(hz.x0 + hz.x1) / 2, s * (yoN + hz.outMax / 2), fa.hoodZ],
        outline: prof, depth: gl, transform: frameMat([0, s, 0], [0, 0, 1], [s, 0, 0], org),
        notes: `Printed ASA (${p.fingerGuardThickIn}" leg and strap, ${HOOD_FACTOR * p.fingerGuardThickIn}" hood flange) hood ${fa.hoodZ.toFixed(2)}" above the ground, ${(fa.hoodZ - fa.tireTopZ).toFixed(2)}" over the ${fa.tireTopZ}" tire top, covering the plan zone where the tire comes within ${p.fingerGapMinIn}" of the hull at any steering angle (min gap ${fa.minGapIn.toFixed(2)}"); the leg sits in the web recess and the strap screws to threaded inserts in the nose gunwale. It shields the pocket from above and behind; the open front of the sweep stays as it is (M5, D-37).`,
      }));
    }
  }

  // ── Signs (leaning with the flared panel), hung on knobs into tee-nuts in the web ──
  // The sign sits between the rear tire's front edge and the forward reflector, so a flared side never pushes it into the tire.
  const signX0 = L.r + SIGN_TIRE_GAP_IN;
  const signX1 = L.xRear + (L.xs - L.xRear) * REFLECTOR_FRACS[1] - REFLECTOR_SIZE[0] / 2 - SIGN_TIRE_GAP_IN;
  const signLen = Math.max(SIGN_MIN_LEN_IN, Math.min(p.signLengthIn, signX1 - signX0));
  // Never taller than the side (a short side would push the sign above the gunwale and into the grab handles).
  const signH = Math.max(1, Math.min(p.signHeightIn, H - 0.25));
  const signX = signX0 + signLen / 2;
  const signZ = L.deckTop + H / 2;
  const signPt = cabinSidePoint(L, signZ, L.side / 2 + pl / 2, signH / 2);
  for (const { s, tag } of SIDES) {
    const sg = box(ctx, {
      id: `sign-${tag}`, partNo: 'sign', name: `Side sign ${tag}`, group: 'removable', mat: 'ply', removable: true, edges: 'edged', step: STEP.finish,
      size: [signLen, pl, signH], center: [signX, s * signPt.y, signPt.z], rot: { x: -s * signPt.phi },
    });
    sg.massLb += edgeBandLb(ctx, 2 * (signLen + signH), pl);
    sg.notes = `6 mm ply blank, all four edges banded with ${p.edgeBandIn}" oak, epoxy-sealed; hangs on four thumb-knob screws into tee-nuts (or brass inserts in a solid-oak board) in the side panel, so nothing protrudes inside the hull (D-9, D-35).`;
    parts.push(sg);
  }

  // Grab handles: the real ones are workstream D's `seat-grip-*` (seat.ts, D-40); the Phase 1 `grab-L/R` blocks sat on the gunwale and could not be gripped, so they were removed (Phase 3 integration).
  return parts;
}
