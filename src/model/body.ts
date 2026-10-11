/**
 * Body: decks, captured-ply sides, the shoulder step, transoms with lift hand-holds, finger guards over the front-tire pinch
 * zone, signs (D-22, D-35…D-37, D-45).
 *
 * D-45: the hull is ONE shape in plan. The cabin side, an S-curve and the nose side are one continuous run per member. From the rear
 * transom to the end of the S-curve (x = xn) the chine, gunwale and side panel are `sweep`s whose path is the plan curve (bent
 * laminations: the oak is strips on a plan form, the 6 mm okoume web is 2 x 3 mm sheets); from xn to the front transom they are the
 * straight boxes / sheer extrusions they were, scarfed to the curved run at xn. The decks are `extrusion` outlines that follow the
 * plan shape and enter rabbets (chines) and dados (transoms); the transoms are full-width `extrusion`s with a hand-hold slot.
 * Every ply part lists an edge condition for each outline edge (captured in oak, or edged with oak banding; none exposed). Joint
 * records are added in joinery.ts after all parts exist.
 */
import { FRAME_STYLE, SIDE_CONSTRUCTION, hullCurveSpec, lamPly } from '../params';
import { HULL_STEP, STEP, bandPart, box, cylinder, roughOf, span, SIDES, IN3_PER_FT3, woodMassLb, type Ctx } from './build-utils';
import { handleGeometry } from './brake';
import { transformPoint } from './bounds';
import { leftTirePolys } from './hull-curve';
import { cabinSidePoint, innerHalfWidth, sheerRise, sidePath, type Layout } from './layout';
import { REFLECTOR_FRACS, REFLECTOR_SIZE } from './lighting';
import { compose } from './mat4';
import { customPart } from './mesh-utils';
import { roundedRectCCW } from './steering';
import type { Dims, EdgeCondition, Mat4, Part, PartGroup, Vec2, Vec3 } from './types';

// ── Block-model placeholders (not design numbers: open-frame post pitch, sign fit gaps) ──
const POST_SPACING_IN = 12;
const POST_X_IN = 1.5;
const SIGN_MIN_LEN_IN = 4;
const SIGN_TIRE_GAP_IN = 0.25;
/** Finger guard: strap height on the gunwale and the margin past the hazard zone. */
const GUARD_STRAP_IN = 1.25;
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
const DECK_ASSEMBLY_NOTE = 'Assembly (M4, D-45): epoxy-seal every face and edge first; the deck is glued to the frame (rails + joists + shoulder beam) as one unit; the hull is built UPSIDE DOWN, so this unit is turned over and lowered into the inverted side assemblies (the deck edge rises into the chine rabbets, the Dominos engage vertically), and the transom slides onto its edge last.';
const SIDE_ASSEMBLY_NOTE = 'Assembly (M4, D-45): laminate the chine and gunwale around the plan-view form, glue the web into its chine and gunwale on the bench (a side assembly, wipe squeeze-out from the grooves), stand the two assemblies inverted in the jig, and lower the frame + deck unit into them; the transom goes on after, sliding in X.';
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
  const rear: ScupperSite = { x: rearTx + Math.max(SCUPPER_END_INSET_IN, r + 0.1) * 0.75, zone: 'cabin', deckZ: L.deckTop, hw: L.hwC, tagPos: 'cabin-rear' };
  const front: ScupperSite = { x: frontTx - 1, zone: 'nose', deckZ: L.noseTop, hw: innerHalfWidth(L, frontTx - 1), tagPos: 'nose-front' };
  // One deck level (Ackermann hull, D-52): the drains are at the two ends; the old mid drain sat at the deck step.
  if (L.ackHull) return [rear, front];
  return [rear, { x: L.xs - 0.5, zone: 'cabin', deckZ: L.deckTop, hw: innerHalfWidth(L, L.xs - 0.5), tagPos: 'cabin-front' }, front];
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

// ── Generic extrusion part (transoms, decks, webs, guard) ──
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
  if (s.outline.length > 8 && (s.id === 'deck' || s.id.startsWith('deck-'))) {
    // A tapering deck: the area centroid of the outline (the bounding-box center is off by ~1" in x), D-45.
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < s.outline.length; i++) {
      const [x1, y1] = s.outline[i], [x2, y2] = s.outline[(i + 1) % s.outline.length];
      const cr = x1 * y2 - x2 * y1;
      A += cr; cx += (x1 + x2) * cr; cy += (y1 + y2) * cr;
    }
    if (Math.abs(A) > 1e-9) out.cgIn = transformPoint(s.transform, [cx / (3 * A), cy / (3 * A), s.depth / 2]);
  }
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
  let transomTop = Math.max(end === 'rear' ? deck + L.sideH : L.sideTop, zTop + p.liftBarMinIn);
  if (end === 'front') {
    transomTop = L.sideTop + L.sheer.riseIn; // the front transom top follows the sheer line at the bow (D-44); the sides are at cabin height all along (D-45); the slot stays where it was
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
  const q = leftTirePolys({ wheelbase: L.WB, kx: L.kx, frontTrack: p.frontTrackIn, tireWidth: p.tireWidthIn, wheelDiameter: p.wheelDiameterIn, lockDeg: 0 }, 1)[0];
  void q;
  const a = (deg * Math.PI) / 180, c = Math.cos(a), si = Math.sin(a);
  const r = p.wheelDiameterIn / 2, hw = p.tireWidthIn / 2;
  const cx = L.WB, cy = (s * p.frontTrackIn) / 2;
  return ([[-r, -hw], [r, -hw], [r, hw], [-r, hw]] as Vec2[]).map(([dx, dy]) => {
    const x = cx + dx - L.kx, y = cy + dy;
    return [L.kx + c * x - si * y, si * x + c * y] as Vec2;
  });
}

/** Plan outline of the LEFT hull side (D-45): the outer face of the chine from the rear transom to the front transom along the real S-curve, then across the front end. */
export function hullSegments(L: Layout): Seg[] {
  const side = sidePath(L, L.side / 2, L.xRear, L.xFront);
  const segs: Seg[] = [];
  for (let i = 1; i < side.length; i++) segs.push([side[i - 1], side[i]]);
  segs.push([side[side.length - 1], [L.xFront, 0]]);
  return segs;
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
    L.WB, L.kx, L.xs, L.xc0, L.xn, L.xFront, L.xRear, L.hwN, L.hwC, L.side, L.railBand, L.sideTop, L.sheer.x0, L.sheer.riseIn, L.web.z0,
    L.ackHull ? [p.scrubRadiusIn, p.steerArmLengthIn, p.ackermannAngleDeg, L.hull.minRadius, L.hull.endSlope].join(',') : ''].join('|');
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
  if (L.ackHull) {
    // Ackermann front end: the left tire at every degree of the solved left-knuckle angle, tow lock both ways (D-52); the right mirrors it.
    tires.push(...leftTirePolys(hullCurveSpec(p), stepDeg));
  } else {
    for (let d = -lock; d <= lock + 1e-9; d += stepDeg) tires.push(frontTirePlan(ctx, 1, d));
    tires.push(frontTirePlan(ctx, 1, lock));
  }
  const segs = hullSegments(L);
  let minGap = Infinity;
  for (const t of tires) for (const sg of segs) minGap = Math.min(minGap, polyDist(t, sg));
  const tireTopZ = p.wheelDiameterIn;
  const hoodZ = tireTopZ + Math.max(p.fingerGuardClearIn, p.steeringClearanceIn);
  const out: FingerAnalysis = { minGapIn: minGap, guardNeeded: minGap < p.fingerGapMinIn - 1e-9, hazard: null, tireTopZ, hoodZ };
  if (!out.guardNeeded) return out;
  // Hazard zone (r3 fittings, eng N-9): EVERY point of the hull outline, curved or straight, that comes within the no-pinch gap of a tire at some steering
  // angle. At the defaults the tire's rear inner corner sweeps in at x = 28-31, half on the S-curve and half on the straight nose side, so the guard
  // follows the real outline across xn (hazard.path in buildBody) instead of stopping at the straight part.
  const gapMin = p.fingerGapMinIn;
  const boxes = tires.map((t) => [Math.min(...t.map((q) => q[0])), Math.max(...t.map((q) => q[0])), Math.min(...t.map((q) => q[1])), Math.max(...t.map((q) => q[1]))]);
  let x0 = Infinity, x1 = -Infinity, outMax = 0;
  for (const sg of segs) {
    const len = Math.hypot(sg[1][0] - sg[0][0], sg[1][1] - sg[0][1]);
    const n = Math.max(2, Math.ceil(len / 0.25));
    for (let i = 0; i <= n; i++) {
      const q: Vec2 = [sg[0][0] + ((sg[1][0] - sg[0][0]) * i) / n, sg[0][1] + ((sg[1][1] - sg[0][1]) * i) / n];
      if (q[1] < 1) continue; // the front transom edge across the end
      let near = false;
      for (let k = 0; k < tires.length && !near; k++) {
        const b = boxes[k];
        if (q[0] < b[0] - gapMin || q[0] > b[1] + gapMin || q[1] < b[2] - gapMin || q[1] > b[3] + gapMin) continue;
        near = polyPointDist(tires[k], q) < gapMin;
      }
      if (near) {
        x0 = Math.min(x0, q[0]);
        x1 = Math.max(x1, q[0]);
      }
    }
  }
  if (!(x1 >= x0)) { x0 = L.xn; x1 = L.xn; }
  out.hazard = { x0: x0 - GUARD_X_MARGIN_IN, x1: x1 + GUARD_X_MARGIN_IN, outMax: Math.max(p.fingerGapMinIn, outMax + GUARD_OUT_MARGIN_IN) };
  const zg = L.sideTop - L.railBand;
  if (L.sheer.riseIn > 1e-9 && out.hazard.x1 > L.sheer.x0 + 1e-9) out.infeasible = `the pinch zone (to x = ${out.hazard.x1.toFixed(1)}") reaches the start of the sheer rise (x = ${L.sheer.x0.toFixed(1)}"), where the gunwale is no longer flat under the guard strap: shorten sheerLengthIn or move the curve (r3 N-9)`;
  else if (hoodZ < L.web.z0 + 1e-9) out.infeasible = `the ${tireTopZ}" tire tops out below the web recess (z = ${L.web.z0.toFixed(2)}"): the hood would sit against the chine, the rail and the scuppers instead of in the recess; raise the deck or use a smaller wheel (r3 N-9)`;
  else if (hoodZ + (HOOD_FACTOR + 1) * p.fingerGuardThickIn > zg) out.infeasible = `the ${tireTopZ}" tire tops out too close to the gunwale for a hood (needs ≤ ${(zg - (HOOD_FACTOR + 1) * p.fingerGuardThickIn - Math.max(p.fingerGuardClearIn, p.steeringClearanceIn)).toFixed(2)}")`;
  return out;
}

/** Height (model z) of the finger-guard insert axis: above the gunwale's web groove, oak left over it, hole radius clear (build review M2, D-43). */
export function guardInsertZ(L: Layout, p: { grooveDepthIn: number }): number {
  const zg = L.sideTop - L.railBand;
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
  const zg = L.sideTop - L.railBand;
  const z0 = L.web.z0;
  if (p.sideConstruction === SIDE_CONSTRUCTION.capturedPly && hoodZ >= z0) {
    return ccw([
      [-rc, hoodZ], [g, hoodZ], [g, hoodZ + HOOD_FACTOR * tw], [-rc + tw, hoodZ + HOOD_FACTOR * tw], [-rc + tw, zg - tw],
      [tw, zg - tw], [tw, strapTop], [0, strapTop], [0, zg], [-rc, zg],
    ]);
  }
  return ccw([[0, hoodZ], [g, hoodZ], [g, hoodZ + HOOD_FACTOR * tw], [tw, hoodZ + HOOD_FACTOR * tw], [tw, strapTop], [0, strapTop]]);
}

/** Ear-clipping triangulation of a simple counter-clockwise polygon: index triples. */
function earClip(poly: Vec2[]): number[] {
  const idx = poly.map((_, i) => i);
  const out: number[] = [];
  const cross = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTri = (p: Vec2, a: Vec2, b: Vec2, c: Vec2) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < 1000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      if (cross(a, b, c) <= 1e-12) continue;
      if (idx.some((k) => k !== ia && k !== ib && k !== ic && inTri(poly[k], a, b, c))) continue;
      out.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

/**
 * The finger guard as ONE printed part that follows the hull outline (r3 fittings, eng N-9): the (out from the hull face, z) profile of `guardProfile`
 * is swept along the outer face of the chine from x0 to x1 (the S-curve and then the straight nose side), each ring offset along the local outward normal.
 * Left side, then mirrored for the right (winding flipped). Returns the mesh and the swept volume (profile area x face length).
 */
export function guardMesh(prof: Vec2[], face: Vec2[], s: 1 | -1): { positions: number[]; indices: number[]; volIn3: number; lengthIn: number } {
  const n = face.length, m = prof.length;
  const tan = (i: number): Vec2 => {
    const a = face[Math.max(0, i - 1)], b = face[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const positions: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = tan(i);
    const nx = -t[1], ny = t[0]; // outward (+y side for the left hull)
    for (const [u, z] of prof) positions.push(face[i][0] + u * nx, s * (face[i][1] + u * ny), z);
  }
  const idx: number[] = [];
  const tri = (a: number, b: number, c: number) => (s > 0 ? idx.push(a, b, c) : idx.push(a, c, b));
  for (let i = 0; i + 1 < n; i++) {
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      const A = i * m + k, A2 = i * m + k2, B = (i + 1) * m + k, B2 = (i + 1) * m + k2;
      tri(A, B2, B);
      tri(A, A2, B2);
    }
  }
  const cap = earClip(prof);
  for (let q = 0; q < cap.length; q += 3) {
    tri((n - 1) * m + cap[q], (n - 1) * m + cap[q + 1], (n - 1) * m + cap[q + 2]); // front cap, normal +t
    tri(cap[q], cap[q + 2], cap[q + 1]); // rear cap, normal −t
  }
  let area = 0;
  for (let k = 0; k < m; k++) { const a = prof[k], b = prof[(k + 1) % m]; area += a[0] * b[1] - b[0] * a[1]; }
  let len = 0;
  for (let i = 1; i < n; i++) len += Math.hypot(face[i][0] - face[i - 1][0], face[i][1] - face[i - 1][1]);
  return { positions, indices: idx, volIn3: (Math.abs(area) / 2) * len, lengthIn: len };
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

  const ds = p.deckSlopIn;
  const rabbetH = (top: number, bot: number) => top - bot + ds; // deck + clearance (build review MUST-2)
  /** |y| polyline of the deck edge (inner face of the chine + the capture depth) over [xa, xb], and the closed CCW outline of a deck between two x. */
  const ladder = p.frameStyle === FRAME_STYLE.ladder;
  /** Offset from the web plane of the deck edge: nose = chine inner face + capture depth; cabin (captured ply) = the rail's inner face + capture depth (the ledge in the rail, D-45). */
  const dNose = (openFrame ? 0 : dd) - L.side / 2;
  const dCabin = captured ? (ladder ? L.side / 2 - p.railThicknessIn : -L.side / 2) + dd : dNose;
  const deckOutline = (xa: number, xb: number, d: number): { outline: Vec2[]; edges: EdgeCondition[] } => {
    const e = sidePath(L, d, xa, xb);
    const right: Vec2[] = e.map(([x, y]) => [x, -y]);
    const left: Vec2[] = [...e].reverse().map(([x, y]) => [x, y]);
    const outline = [...right, ...left];
    // Edges in order: n-1 right-side edges, the front, n-1 left-side edges, the rear.
    const edges: EdgeCondition[] = [...right.slice(1).map(() => sideCond), 'edged', ...left.slice(1).map(() => sideCond), 'captured'];
    return { outline, edges };
  };

  // ── Decks (extrusions in plan, following the S-curve; capture: rabbets in the chines, dados in the transoms, banding on the step) ──
  if (L.ackHull) {
    // ONE deck level (D-52): a single polygon from the rear transom to the front transom, captured in the chine rabbet all the way round (one joint type),
    // a dado in each transom; no step, no riser, no banded edge.
    const x0 = rearTx - dd, x1 = frontTx + dd;
    const { outline, edges } = deckOutline(x0, x1, dNose);
    parts.push(extPart(ctx, {
      id: 'deck', name: 'Deck', group: 'body', mat: 'ply', step: HULL_STEP.deck, grain: 'x', center: [(x0 + x1) / 2, 0, L.deckTop],
      outline, depth: L.ply, transform: compose([0, 0, L.deckBot]),
      edges: edges.map((c) => (c === 'edged' ? 'captured' : c)),
      notes: `One sheet, ${(x1 - x0).toFixed(1)}" long (fits a 4 x 8 sheet), with the outline of the plan shape (D-52): ${dd}" into a ${dd}" × ${rabbetH(L.deckTop, L.deckBot).toFixed(3)}" rabbet in the underside of each chine all the way round (deck + ${ds}" clearance, thickened epoxy fills it; the rail top is flush with the deck underside) and into a dado in each transom. No exposed ply edge, no step. ${DECK_ASSEMBLY_NOTE}`,
    }));
  } else {
  {
    const x0 = rearTx - dd, x1 = L.xs;
    const { outline, edges } = deckOutline(x0, x1, dCabin);
    const front = 2 * Math.abs(outline[outline.length / 2 - 1][1]);
    parts.push(extPart(ctx, {
      id: 'deck-cabin', name: 'Cabin deck', group: 'body', mat: 'ply', step: HULL_STEP.deck, grain: 'x', center: [(x0 + x1) / 2, 0, L.deckTop],
      outline, depth: L.ply, transform: compose([0, 0, L.deckBot]),
      edges,
      extraLb: edgeBandLb(ctx, front, L.ply),
      notes: `Outline follows the plan S-curve (D-45). Sits on a ${dd}" ledge notched into the inner face of each rail (open at the top, ${ds}" clearance, thickened epoxy fills it; the ply edge is against oak) and in a dado in the rear transom; the front (step) edge butts the rear face of the shoulder beam and is banded with ${p.edgeBandIn}" oak. ${DECK_ASSEMBLY_NOTE}`,
    }));
  }
  {
    const x0 = L.xs, x1 = frontTx + dd;
    const { outline: o0, edges: e0 } = deckOutline(x0, x1, dNose);
    // deckOutline puts the 'edged' (banded) edge at the FRONT of the first deck; for the nose deck the banded edge is the REAR (step) one and the front is captured.
    const outline = o0;
    const nR = Math.floor(e0.length / 2);
    const edges = e0.map((c, k) => (k === nR ? 'captured' : k === e0.length - 1 ? 'edged' : c)) as EdgeCondition[];
    const holes: Vec2[][] = [];
    if (na && na.x1 > na.x0 && na.hw > 0) holes.push(cw(roundedRectCCW(na.x0, na.x1, -na.hw, na.hw, p.accessOpeningCornerRadiusIn))); // corner radius: r3 build S12, D-47
    const rim = holes.length ? polyAreaPerim(holes[0]).perim : 0;
    const rearW = 2 * Math.abs(outline[0][1]);
    parts.push(extPart(ctx, {
      id: 'deck-nose', name: 'Nose deck', group: 'body', mat: 'ply', step: HULL_STEP.deck, grain: 'x', center: [(x0 + x1) / 2, 0, L.noseTop],
      outline, ...(holes.length ? { holes } : {}), depth: L.ply, transform: compose([0, 0, L.noseBot]),
      edges: [...edges, ...holes.flatMap((h) => h.map((): EdgeCondition => 'edged'))],
      extraLb: edgeBandLb(ctx, rearW + rim, L.ply),
      notes: `Sits on the shoulder beam and the nose joists, 1" above the cabin deck, in a ${dd}" × ${rabbetH(L.noseTop, L.noseBot).toFixed(3)}" rabbet in the underside of the chines (the chine bottom is at the nose deck level all along, D-45) and a dado in the front transom; the rear (step) edge is banded with ${p.edgeBandIn}" oak. ${DECK_ASSEMBLY_NOTE}`
        + (holes.length ? ` The kingpin-access opening (Layout.accessPanel, M10) is cut through it with ${p.accessOpeningCornerRadiusIn}" corner radii (router template with a 1/2" bit, D-47); the opening rim is banded with 1/16" oak edge veneer (the straight rear edge with ${p.edgeBandIn}" oak strips, 5/16" wide, epoxied, flush-trimmed) and the removable panel lies flush in it. Edge conditions: outline edges first, then the rim edges.` : ' No kingpin-access opening without the kingpin crossbar (Layout.accessPanel is null).'),
    }));
  }
  }

  // ── Sides (D-45): the curved run (rear transom → xn) is one bent-lam sweep per member; the nose run is straight, scarfed on at xn ──
  const zTop = L.sideTop;
  const zChine0 = L.chineBot, zChine1 = L.chineBot + L.chineH;
  const strip = p.hullLamThicknessIn;
  const lamPlies = (t: number) => Math.max(1, Math.round(t / strip));
  const plyLen = (path: Vec2[]) => polyLen(path);
  const noseLen = frontTx - L.xn;
  const nm = (zone: 'cabin' | 'nose', tag: 'L' | 'R') => `${zone === 'cabin' ? 'Cabin' : 'Nose'} ${tag === 'L' ? 'left' : 'right'}`;
  /**
   * The straight bow run of the Ackermann hull (D-52): from xn to the front transom, converging at heading `L.bowHeading`, scarfed to the bent cabin run at xn
   * (in the straight, never in the bend). Members are cut straight and set at the heading (rotated about z); the ply panels and the sheer gunwale are extrusions in
   * the vertical plane of the run.
   */
  const bowRun = (s: 1 | -1, tag: 'L' | 'R'): Part[] => {
    const out: Part[] = [];
    const id = `side-nose-${tag}`;
    const name = nm('nose', tag);
    const a = s * L.bowHeading; // heading of this side's centerline (rad)
    const ca = Math.cos(a), sa = Math.sin(a);
    const run = sidePath(L, 0, L.xn, frontTx); // |y| of the web plane; a straight line
    const P0 = run[0], P1 = run[run.length - 1];
    // The square-cut end of a member set at the heading pokes (t/2) sin a past the transom face with one corner: the model trims the run by that (the real end is
    // cut at the bevel so it seats flat on the transom face).
    const trim = (t: number) => (t / 2) * Math.abs(sa);
    const runLen0 = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
    const runLen = runLen0 - trim(L.side);
    const mid: Vec3 = [P0[0] + (P1[0] - P0[0]) * (runLen / runLen0 / 2), s * (P0[1] + (P1[1] - P0[1]) * (runLen / runLen0 / 2)), 0];
    const rot = { z: a };
    const deg = ((Math.abs(L.bowHeading) * 180) / Math.PI).toFixed(1);
    const rabbetLb = oakLb(ctx, runLen * dd * rabbetH(L.noseTop, L.noseBot));
    const grooveLb = oakLb(ctx, runLen * (pl + slop) * g);
    const scarfNote = (t: number, what: string) => `Scarfed (1:8, ${(8 * t).toFixed(1)}" long) to the bent ${what} at x = ${L.xn.toFixed(1)}", where the curve has ended: the scarf lies in the straight bow run, never in the bend.`;
    const cutNote = `Straight, ${runLen.toFixed(1)}" long, set at ${deg}° to the axis (the bow keeps converging, D-52); the end at the front transom is cut at ${deg}° so it seats square on the transom face.`;
    // Local frame of an extrusion in the vertical plane of the run: x along the run from its start, y up, z across (from the outer face inward).
    const ex: Vec3 = [ca, sa, 0], ez: Vec3 = [sa, -ca, 0];
    const frameAt = (thick: number, z0: number): Mat4 => frameMat(ex, [0, 0, 1], ez, [s * 0 + P0[0] - (thick / 2) * ez[0], s * P0[1] - (thick / 2) * ez[1], z0]);
    const zSolid = captured ? 0 : zTop - L.noseBot;
    if (p.sideConstruction === SIDE_CONSTRUCTION.solidOak) {
      const bd = box(ctx, { id: `${id}-board`, partNo: 'side-nose-board', name: `${name} side board`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
        size: [runLen, L.side, zSolid], center: [mid[0], mid[1], (zTop + L.noseBot) / 2], rot });
      bd.massLb -= rabbetLb;
      bd.notes = `${scarfNote(L.side, 'board')} ${cutNote} Deck edge in a ${dd}" rabbet. ${SIDE_ASSEMBLY_NOTE}`;
      out.push(bd);
    } else if (captured) {
      const chine = box(ctx, { id: `${id}-chine`, partNo: 'side-nose-chine', name: `${name} chine`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
        size: [runLen, L.side, L.chineH], center: [mid[0], mid[1], (zChine0 + zChine1) / 2], rot });
      chine.massLb -= grooveLb + rabbetLb;
      chine.notes = `${cutNote} Same ${L.chineH}" section and height as the bent chine (the side line does not step). ${scarfNote(L.side, 'chine')} Top groove ${(pl + p.grooveSlopIn).toFixed(3)}" × ${g}" holds the web; underside rabbet ${dd}" × ${rabbetH(L.noseTop, L.noseBot).toFixed(3)}" holds the deck. The chine rests on the rail and is Domino-tied to it. ${SIDE_ASSEMBLY_NOTE}`;
      out.push(chine);
      const curved = L.sheer.riseIn > 1e-9;
      const gunNote = `Underside groove ${(pl + p.grooveSlopIn).toFixed(3)}" × ${g}" holds the web (D-35, D-43). ${scarfNote(L.side, 'gunwale')} ${SIDE_ASSEMBLY_NOTE}`;
      if (curved) {
        const sxs = sheerSamples(L, L.xn, frontTx);
        const uEnd = (frontTx - L.xn) / ca - trim(L.side);
        const lo: Vec2[] = sxs.map((x): Vec2 => [Math.min(uEnd, (x - L.xn) / ca), zTop - L.railBand + sheerRise(L, x)]);
        const hi: Vec2[] = sxs.map((x): Vec2 => [Math.min(uEnd, (x - L.xn) / ca), zTop + sheerRise(L, x)]).reverse();
        const curveGrooveLb = oakLb(ctx, polyLen(lo) * (pl + slop) * g);
        const nLam = 3;
        const rMin = (() => { // smallest radius of curvature of the sheer line (three-point circles)
          let r = Infinity;
          for (let i = 1; i + 1 < lo.length; i++) {
            const [ax, ay] = lo[i - 1], [bx, by] = lo[i], [cx, cy] = lo[i + 1];
            const ab = Math.hypot(bx - ax, by - ay), bc = Math.hypot(cx - bx, cy - by), ca2 = Math.hypot(ax - cx, ay - cy);
            const area2 = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
            if (area2 > 1e-9) r = Math.min(r, (ab * bc * ca2) / (2 * area2));
          }
          return Number.isFinite(r) ? r : Infinity;
        })();
        out.push(extPart(ctx, {
          id: `${id}-gunwale`, partNo: 'side-nose-gunwale', name: `${name} gunwale`, group: 'body', mat: 'oak', step: HULL_STEP.sides, grain: 'x', fab: 'bentlam',
          center: [(L.xn + frontTx) / 2, mid[1], zTop + L.sheer.riseIn / 2],
          outline: [...lo, ...hi], depth: L.side, transform: frameAt(L.side, 0), extraLb: -curveGrooveLb,
          notes: `LAMINATED, not sawn from a board (build review S4, D-47): ${nLam} flat layers of ${(L.railBand / nLam).toFixed(2)}" × ${L.side}" oak, each cut from straight-grain stock, glued up around a simple plywood sheer form (the rise is ${L.sheer.riseIn}" over the forward ${(L.sheer.x1 - L.sheer.x0).toFixed(1)}", flat before it, D-44; it starts beyond the finger-guard zone so the guard strap sits on the flat gunwale). The member is straight in plan, set at ${deg}° to the axis (D-52). The tightest radius of the sheer is ${rMin.toFixed(0)}" (the layer is ${(L.railBand / nLam).toFixed(2)}" thick: R/t = ${(rMin / (L.railBand / nLam)).toFixed(0)}, cold bend, no steaming), so the grain follows the rise everywhere. GROOVE METHOD: plow the ${(pl + slop).toFixed(3)}" × ${g}" web groove in the face of the BOTTOM layer while it is still a straight strip (router table, fence, 1/4" straight bit, two passes), then laminate: the groove follows the curve with no template, and the layers above close it. ${gunNote}`,
        }));
      } else {
        const gun = box(ctx, { id: `${id}-gunwale`, partNo: 'side-nose-gunwale', name: `${name} gunwale`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
          size: [runLen, L.side, L.railBand], center: [mid[0], mid[1], zTop - L.railBand / 2], rot });
        gun.massLb -= grooveLb;
        gun.notes = `${cutNote} ${gunNote}`;
        out.push(gun);
      }
      const z0 = L.web.z0, z1 = L.web.z1;
      const hTot = Math.max(0.1, z1 - z0) + 2 * g;
      const xw0 = L.xn, xw1 = frontTx + dd;
      const wLen = (xw1 - xw0) / ca;
      let webOutline = rectCCW(0, wLen, 0, hTot);
      let webEdges: EdgeCondition[] = ['captured', 'captured', 'captured', 'captured'];
      if (curved) {
        const wx = sheerSamples(L, xw0, xw1);
        const top: Vec2[] = wx.map((x) => [(x - xw0) / ca, hTot + sheerRise(L, x)] as Vec2).reverse();
        webOutline = [[0, 0], [wLen, 0], ...top];
        webEdges = ['captured', 'captured', ...top.slice(1).map(() => 'captured' as EdgeCondition), 'captured'];
      }
      out.push(extPart(ctx, {
        id: `${id}-web`, partNo: 'side-nose-web', name: `${name} side panel`, group: 'body', mat: 'ply', step: HULL_STEP.sides, grain: 'x',
        center: [(xw0 + xw1) / 2, mid[1], (z0 + z1) / 2],
        outline: webOutline, depth: pl, transform: frameAt(pl, z0 - g),
        edges: webEdges,
        notes: `Straight 6 mm okoume panel set at ${deg}° to the axis, captured in the chine and gunwale grooves (${g}" deep) and in a stopped dado in the front transom; scarfed (8:1, ${(8 * pl).toFixed(1)}") to the bent panel at x = ${L.xn.toFixed(1)}" in the straight run (glued, no banding needed). ${SIDE_ASSEMBLY_NOTE} The closed dado is vented: a ${p.ventHoleIn}" relief hole through the transom at its end lets air and epoxy escape as the transom slides on (hydraulic lock).`,
      }));
    } else {
      out.push(box(ctx, { id: `${id}-gunwale`, partNo: 'side-nose-gunwale', name: `${name} gunwale`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
        size: [runLen, L.side, L.railBand], center: [mid[0], mid[1], zTop - L.railBand / 2], rot, notes: `${cutNote} ${scarfNote(L.side, 'gunwale')}` }));
      const n = Math.max(2, Math.ceil(runLen / POST_SPACING_IN) + 1);
      for (let i = 0; i < n; i++) {
        const x = L.xn + POST_X_IN / 2 + ((noseLen - POST_X_IN) * i) / (n - 1);
        const yIn = Math.max(...sidePath(L, -L.side / 2, x - POST_X_IN / 2, x + POST_X_IN / 2).map((q) => q[1]));
        out.push(box(ctx, { id: `${id}-post-${i + 1}`, partNo: 'side-nose-post', name: `${name} post ${i + 1}`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
          ...span([x - POST_X_IN / 2, x + POST_X_IN / 2], [s * yIn, s * (yIn + L.side)].sort((u, v) => u - v) as [number, number], [L.noseBot, zTop - L.railBand]), grain: 'z' }));
      }
    }
    return out;
  };
  for (const { s, tag } of SIDES) {
    // ---- cabin run (curved) ----
    {
      const id = `side-cabin-${tag}`;
      const name = nm('cabin', tag);
      const cPath = sidePath(L, 0, rearTx, L.xn); // web plane = member centerline
      const len = plyLen(cPath);
      const kindNote = `Bent lamination: ${lamPlies(L.side)} plies of ${strip}" white oak on the plan-view form (epoxy, slow hardener), min bend radius ${(L.hull.minRadius - L.side / 2).toFixed(1)}" on the inside face vs ${(p.hullLamMinRadiusFactor * strip).toFixed(1)}" cold limit (${p.hullLamMinRadiusFactor}× strip, D-45); straight from the rear transom to x = ${L.xc0.toFixed(1)}", curving to x = ${L.xn.toFixed(1)}", where it is scarfed (1:8) to the straight nose ${s > 0 ? 'left' : 'right'} member.`;
      if (p.sideConstruction === SIDE_CONSTRUCTION.solidOak) {
        const b = bandPart(ctx, { id: `${id}-board`, partNo: 'side-cabin-board', name: `${name} side board`, group: 'body', mat: 'oak', s, path: cPath, t: L.side, h: zTop - L.deckBot, zc: (zTop + L.deckBot) / 2, plies: lamPlies(L.side), step: HULL_STEP.sides,
          extraLb: -oakLb(ctx, len * dd * rabbetH(L.deckTop, L.deckBot)),
          notes: `Deck edge sits in a ${dd}" rabbet on the inside bottom. ${kindNote} ${SIDE_ASSEMBLY_NOTE}` });
        parts.push(b);
      } else if (captured) {
        const grooveLb = oakLb(ctx, len * (pl + slop) * g);
        const rabbetLb = oakLb(ctx, (L.ackHull ? len : plyLen(sidePath(L, 0, L.xs, L.xn))) * dd * rabbetH(L.noseTop, L.noseBot)); // the nose-deck rabbet starts at the deck step (Ackermann hull: the rabbet runs the whole hull, one deck)
        parts.push(bandPart(ctx, { id: `${id}-chine`, partNo: 'side-cabin-chine', name: `${name} chine`, group: 'body', mat: 'oak', s, path: cPath, t: L.side, h: L.chineH, zc: (zChine0 + zChine1) / 2, plies: lamPlies(L.side), step: HULL_STEP.sides,
          extraLb: -(grooveLb + rabbetLb),
          notes: L.ackHull
            ? `${kindNote} Its bottom is at the deck underside level (${L.chineBot.toFixed(2)}") along the whole hull (one deck level, D-52). Top groove ${(pl + p.grooveSlopIn).toFixed(3)}" × ${g}" holds the web, route it with a template after the lamination; an underside rabbet ${dd}" × ${rabbetH(L.noseTop, L.noseBot).toFixed(3)}" (deck + ${ds}" clearance) the whole length holds the deck edge; the chine rests on the rail and is Domino-tied to it (vertical Dominos, D-43). Build it on the one plan-view form: ${lamPlies(L.side)} plies of ${lamPly(L.side, strip).toFixed(4)}" cut on the bandsaw from 5/4 stock, ripped to ${L.chineH}". ${SIDE_ASSEMBLY_NOTE}`
            : `${kindNote} Its bottom is at the nose deck level (${L.chineBot.toFixed(2)}") along the whole hull, so the side line never steps (D-45). Top groove ${(pl + slop).toFixed(3)}" × ${g}" holds the web, route it with a template after the lamination; from the deck step (x = ${L.xs.toFixed(1)}") forward an underside rabbet ${dd}" × ${rabbetH(L.noseTop, L.noseBot).toFixed(3)}" (deck + ${ds}" clearance) holds the nose deck (D-35, MUST-2); the chine rests on the rail below it and is Domino-tied to it (vertical Dominos, D-43). ${SIDE_ASSEMBLY_NOTE}` }));
        const gunNote = `Underside groove ${(pl + slop).toFixed(3)}" × ${g}" holds the web (D-35, D-43), routed with a bearing-guided slot cutter riding the plan form template. ${SIDE_ASSEMBLY_NOTE}`;
        parts.push(bandPart(ctx, { id: `${id}-gunwale`, partNo: 'side-cabin-gunwale', name: `${name} gunwale`, group: 'body', mat: 'oak', s, path: cPath, t: L.side, h: L.railBand, zc: zTop - L.railBand / 2, plies: lamPlies(L.side), step: HULL_STEP.sides,
          extraLb: -oakLb(ctx, len * (pl + slop) * g),
          notes: `${kindNote} ${gunNote}` }));
        // Side web: a curved sheet whose lower and upper edges enter the chine and gunwale grooves; its rear end enters the transom dado.
        const z0 = L.web.z0, z1 = L.web.z1;
        const xw0 = rearTx - dd;
        const wPath = sidePath(L, 0, xw0, L.xn);
        const webSheet = pl / Math.max(1, p.hullWebPlies);
        parts.push(bandPart(ctx, { id: `${id}-web`, partNo: 'side-cabin-web', name: `${name} side panel`, group: 'body', mat: 'ply', s, path: wPath, t: pl, h: z1 - z0 + 2 * g, zc: (z0 + z1) / 2, plies: p.hullWebPlies, step: HULL_STEP.sides, grain: 'x',
          edges: 'captured',
          notes: `Curved okoume panel: ${p.hullWebPlies} sheet(s) of ${(webSheet * 25.4).toFixed(1)} mm laminated (epoxy) around the same plan form as the chine, so it takes the ${(L.hull.minRadius - pl / 2).toFixed(1)}" inside radius (limit ${(p.hullLamMinRadiusFactor * webSheet).toFixed(1)}", ${p.hullLamMinRadiusFactor}× one sheet, D-45). Captured in the chine and gunwale grooves (${g}" deep) and in a stopped dado in the rear transom; its front end at x = ${L.xn.toFixed(1)}" is scarfed (8:1, ${(8 * pl).toFixed(1)}") to the straight nose panel, in the tangent (straight) zone so the scarf never bends. ${SIDE_ASSEMBLY_NOTE} The closed dado is vented: a ${p.ventHoleIn}" relief hole through the transom at its end lets air and epoxy escape as the transom slides on (hydraulic lock).` }));
      } else {
        parts.push(bandPart(ctx, { id: `${id}-gunwale`, partNo: 'side-cabin-gunwale', name: `${name} gunwale`, group: 'body', mat: 'oak', s, path: cPath, t: L.side, h: L.railBand, zc: zTop - L.railBand / 2, plies: lamPlies(L.side), step: HULL_STEP.sides, notes: kindNote }));
        const n = Math.max(2, Math.ceil((L.xn - rearTx) / POST_SPACING_IN) + 1);
        for (let i = 0; i < n; i++) {
          const x = rearTx + POST_X_IN / 2 + ((L.xn - rearTx - POST_X_IN) * i) / (n - 1);
          // In the S-curve the post box sits outside the widest inner face under it, so it never pokes through the deck edge.
          const yIn = Math.max(...sidePath(L, -L.side / 2, x - POST_X_IN / 2, x + POST_X_IN / 2).map((q) => q[1]));
          parts.push(box(ctx, { id: `${id}-post-${i + 1}`, partNo: 'side-cabin-post', name: `${name} post ${i + 1}`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
            ...span([x - POST_X_IN / 2, x + POST_X_IN / 2], [s * yIn, s * (yIn + L.side)].sort((a, c) => a - c) as [number, number], [L.deckBot, zTop - L.railBand]), grain: 'z' }));
        }
      }
    }
    // ---- nose run (straight, scarfed on at xn) ----
    if (L.ackHull) {
      parts.push(...bowRun(s, tag));
    } else {
      const id = `side-nose-${tag}`;
      const name = nm('nose', tag);
      const yc = s * (L.hwN + L.side / 2);
      const yr = (a: number, c: number): [number, number] => [Math.min(a, c), Math.max(a, c)];
      const rabbetLb = oakLb(ctx, noseLen * dd * rabbetH(L.noseTop, L.noseBot));
      if (p.sideConstruction === SIDE_CONSTRUCTION.solidOak) {
        const bd = box(ctx, { id: `${id}-board`, partNo: 'side-nose-board', name: `${name} side board`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
          ...span([L.xn, frontTx], yr(yc - L.side / 2, yc + L.side / 2), [L.noseBot, zTop]) }); // solid boards keep the old stepped bottom line: the bolster ring sits under the nose deck
        bd.massLb -= rabbetLb;
        bd.notes = `Scarfed (1:8) to the curved cabin run at x = ${L.xn.toFixed(1)}"; deck edge in a ${dd}" rabbet. ${SIDE_ASSEMBLY_NOTE}`;
        parts.push(bd);
      } else if (captured) {
        const grooveLb = oakLb(ctx, noseLen * (pl + slop) * g);
        const chine = box(ctx, { id: `${id}-chine`, partNo: 'side-nose-chine', name: `${name} chine`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
          ...span([L.xn, frontTx], yr(yc - L.side / 2, yc + L.side / 2), [zChine0, zChine1]) });
        chine.massLb -= grooveLb + rabbetLb;
        chine.notes = `Straight, same ${L.chineH}" section and height as the cabin chine (the side line does not step, D-45); scarfed (1:8, ${(8 * L.side).toFixed(1)}" long, in the straight run) to the bent cabin chine at x = ${L.xn.toFixed(1)}". Top groove ${(pl + slop).toFixed(3)}" × ${g}" holds the web; underside rabbet ${dd}" × ${rabbetH(L.noseTop, L.noseBot).toFixed(3)}" holds the nose deck (D-35). The chine rests on the rail and is Domino-tied to it. ${SIDE_ASSEMBLY_NOTE}`;
        parts.push(chine);
        const curved = L.sheer.riseIn > 1e-9;
        const sxs = curved ? sheerSamples(L, L.xn, frontTx) : [];
        const gunNote = `Underside groove ${(pl + slop).toFixed(3)}" × ${g}" holds the web (D-35, D-43). Scarfed (1:8) to the cabin gunwale at x = ${L.xn.toFixed(1)}". ${SIDE_ASSEMBLY_NOTE}`;
        if (curved) {
          const lo: Vec2[] = sxs.map((x): Vec2 => [x, zTop - L.railBand + sheerRise(L, x)]);
          const hi: Vec2[] = sxs.map((x): Vec2 => [x, zTop + sheerRise(L, x)]).reverse();
          const curveGrooveLb = oakLb(ctx, polyLen(lo) * (pl + slop) * g);
          const nLam = 3;
          const rMin = (() => { // smallest radius of curvature of the sheer line (three-point circles)
            let r = Infinity;
            for (let i = 1; i + 1 < lo.length; i++) {
              const [ax, ay] = lo[i - 1], [bx, by] = lo[i], [cx, cy] = lo[i + 1];
              const ab = Math.hypot(bx - ax, by - ay), bc = Math.hypot(cx - bx, cy - by), ca = Math.hypot(ax - cx, ay - cy);
              const area2 = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
              if (area2 > 1e-9) r = Math.min(r, (ab * bc * ca) / (2 * area2));
            }
            return Number.isFinite(r) ? r : Infinity;
          })();
          parts.push(extPart(ctx, {
            id: `${id}-gunwale`, partNo: 'side-nose-gunwale', name: `${name} gunwale`, group: 'body', mat: 'oak', step: HULL_STEP.sides, grain: 'x', fab: 'bentlam',
            center: [(L.xn + frontTx) / 2, yc, zTop + L.sheer.riseIn / 2],
            outline: [...lo, ...hi], depth: L.side,
            transform: frameMat([1, 0, 0], [0, 0, 1], [0, -1, 0], [0, yc + L.side / 2, 0]), extraLb: -curveGrooveLb,
            notes: `LAMINATED, not sawn from a board (build review S4, D-47): ${nLam} flat layers of ${(L.railBand / nLam).toFixed(2)}" × ${L.side}" oak, each cut from straight-grain stock, glued up around a simple plywood sheer form (the same form for the web: the rise is ${L.sheer.riseIn}" over the forward ${(L.sheer.x1 - L.sheer.x0).toFixed(1)}", flat before it, D-44). The tightest radius of the sheer is ${rMin.toFixed(0)}" (the layer is ${(L.railBand / nLam).toFixed(2)}" thick: R/t = ${(rMin / (L.railBand / nLam)).toFixed(0)}, cold bend, no steaming), so the grain follows the rise everywhere and there is no short grain at the bow. GROOVE METHOD: plow the ${(pl + slop).toFixed(3)}" × ${g}" web groove in the face of the BOTTOM layer while it is still a straight strip (router table, fence, 1/4" straight bit, two passes with the fence moved ${(pl + slop - 0.25).toFixed(3)}"; the layer is ${(L.railBand / nLam).toFixed(2)}" thick, so a ${g}" groove leaves ${(L.railBand / nLam - g).toFixed(3)}"), then laminate: the groove follows the curve with no template and no curved-edge routing, and the layers above close it. ${gunNote}`
          }));
        } else {
          const gun = box(ctx, { id: `${id}-gunwale`, partNo: 'side-nose-gunwale', name: `${name} gunwale`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
            ...span([L.xn, frontTx], yr(yc - L.side / 2, yc + L.side / 2), [zTop - L.railBand, zTop]) });
          gun.massLb -= grooveLb;
          gun.notes = gunNote;
          parts.push(gun);
        }
        const z0 = L.web.z0, z1 = L.web.z1;
        const hW = Math.max(0.1, z1 - z0);
        const hTot = hW + 2 * g;
        const xw0 = L.xn, xw1 = frontTx + dd;
        const wLen = xw1 - xw0;
        const u: Vec3 = [0, 0, 1];
        const ez: Vec3 = [0, -1, 0];
        const org: Vec3 = [xw0, yc - (pl / 2) * ez[1], z0 - g];
        let webOutline = rectCCW(0, wLen, 0, hTot);
        let webEdges: EdgeCondition[] = ['captured', 'captured', 'captured', 'captured'];
        if (curved) {
          const wx = sheerSamples(L, xw0, xw1);
          const top: Vec2[] = wx.map((x) => [x - xw0, hTot + sheerRise(L, x)] as Vec2).reverse();
          webOutline = [[0, 0], [wLen, 0], ...top];
          webEdges = ['captured', 'captured', ...top.slice(1).map(() => 'captured' as EdgeCondition), 'captured'];
        }
        parts.push(extPart(ctx, {
          id: `${id}-web`, partNo: 'side-nose-web', name: `${name} side panel`, group: 'body', mat: 'ply', step: HULL_STEP.sides, grain: 'x',
          center: [(xw0 + xw1) / 2, yc, (z0 + z1) / 2],
          outline: webOutline, depth: pl, transform: frameMat([1, 0, 0], u, ez, org),
          edges: webEdges,
          notes: `Straight 6 mm okoume panel, captured in the chine and gunwale grooves (${g}" deep) and in a stopped dado in the front transom; scarfed (8:1, ${(8 * pl).toFixed(1)}") to the curved cabin panel at x = ${L.xn.toFixed(1)}" (glued, no banding needed). ${SIDE_ASSEMBLY_NOTE} The closed dado is vented: a ${p.ventHoleIn}" relief hole through the transom at its end lets air and epoxy escape as the transom slides on (hydraulic lock).`,
        }));
      } else {
        parts.push(box(ctx, { id: `${id}-gunwale`, partNo: 'side-nose-gunwale', name: `${name} gunwale`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
          ...span([L.xn, frontTx], yr(yc - L.side / 2, yc + L.side / 2), [zTop - L.railBand, zTop]) }));
        const n = Math.max(2, Math.ceil(noseLen / POST_SPACING_IN) + 1);
        for (let i = 0; i < n; i++) {
          const x = L.xn + POST_X_IN / 2 + ((noseLen - POST_X_IN) * i) / (n - 1);
          parts.push(box(ctx, { id: `${id}-post-${i + 1}`, partNo: 'side-nose-post', name: `${name} post ${i + 1}`, group: 'body', mat: 'oak', step: HULL_STEP.sides,
            ...span([x - POST_X_IN / 2, x + POST_X_IN / 2], yr(yc - L.side / 2, yc + L.side / 2), [L.noseBot, zTop - L.railBand]), grain: 'z' }));
        }
      }
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
    const dadoLb = oakLb(ctx, 2 * (L.hwC + dd) * (L.ply + ds) * dd) + 2 * oakLb(ctx, (pl + slop) * (L.web.z1 - L.web.z0 + 2 * g) * dd);
    // Vent holes: the web-end dados (mid height of the web, at the web's y) and the two ends of the deck dado.
    const webY = L.hwC + L.side / 2 + flare / 2, webZ = (L.web.z0 + L.web.z1) / 2, deckVentY = L.hwC + dd - 0.15;
    const ventHoles = [vent(webY, webZ), vent(-webY, webZ), vent(deckVentY, L.deckBot + L.ply / 2), vent(-deckVentY, L.deckBot + L.ply / 2)];
    parts.push(extPart(ctx, {
      id: 'transom-rear', name: 'Rear transom', group: 'body', mat: 'oak', step: HULL_STEP.transom, grain: 'x', center: [L.xRear, 0, (zb + zt) / 2],
      outline, holes: [slotHole(0, (rs.zBot + rs.zTop) / 2, rs.lengthIn, p.liftSlotHeightIn), ...ventHoles], depth: tT,
      transform: frameMat([0, 1, 0], [0, 0, 1], [1, 0, 0], [L.xRear, 0, 0]), extraLb: -dadoLb,
      notes: `${tT}" oak, glued up from two boards (no board is ${(w0 * 2).toFixed(0)}" wide; keep the glue line clear of the slot). Lift hand-hold ${rs.lengthIn}" × ${p.liftSlotHeightIn}" (gloved hand), ${rs.barIn}" of oak above it; routed 3/8" roundovers both faces. The top edge is a ${p.transomCrownIn}" crown (arc) with ${p.transomCornerRadiusIn}" rounded corners (D-44). Deck dado ${dd}" deep × ${(L.ply + ds).toFixed(3)}" (deck + ${ds}" clearance) on the front face; stopped dados for the side panels (D-35, D-37); the closed dado ends are vented with ${p.ventHoleIn}" holes through the transom (4 holes: bung or epoxy-fill them after the glue-up). `
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
    const dadoF = oakLb(ctx, 2 * (L.hwN + dd) * (L.ply + ds) * dd) + 2 * oakLb(ctx, (pl + slop) * (L.web.z1 - L.web.z0 + 2 * g) * dd);
    const webY = L.hwN + L.side / 2, webZ = (L.web.z0 + L.web.z1) / 2, deckVentY = L.hwN + dd - 0.15;
    const ventHoles = [vent(webY, webZ), vent(-webY, webZ), vent(deckVentY, L.noseBot + L.ply / 2), vent(-deckVentY, L.noseBot + L.ply / 2)];
    parts.push(extPart(ctx, {
      id: 'transom-front', name: 'Front transom', group: 'body', mat: 'oak', step: HULL_STEP.transom, grain: 'x', center: [L.xFront, 0, (zbF + ztF) / 2],
      outline: ccw([[wN, zbF], ...transomTopOutline(wN, ztF, p.transomCrownIn, Math.min(p.transomCornerRadiusIn, (ztF - zbF) / 2)), [-wN, zbF]]), holes: [slotHole(0, (fs.zBot + fs.zTop) / 2, fs.lengthIn, p.liftSlotHeightIn), ...ventHoles], depth: tT,
      transform: frameMat([0, 1, 0], [0, 0, 1], [1, 0, 0], [L.xFront - tT, 0, 0]), extraLb: -dadoF,
      notes: `${tT}" oak. Lift hand-hold ${fs.lengthIn}" × ${p.liftSlotHeightIn}" (gloved hand), ${fs.barIn}" of oak above it, routed 3/8" roundovers. The top follows the ${L.sheer.riseIn}" sheer rise at the bow, with a ${p.transomCrownIn}" crown and ${p.transomCornerRadiusIn}" rounded corners (D-44). The nose run mirrors the rear: the front transom goes on LAST, sliding in −X onto the deck edge, web ends and chine / gunwale / rail tenons (M4); its closed dado ends are vented with ${p.ventHoleIn}" holes.`,
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

  // ── Finger guards over the front-tire pinch zone (M5, r3 N-9): one printed piece per side following the hull outline (S-curve, then the straight nose side) ──
  const fa = fingerAnalysis(ctx);
  if (fa.guardNeeded && fa.hazard && !fa.infeasible) {
    const hz = fa.hazard;
    const zg = L.sideTop - L.railBand;
    const strapTop = Math.min(zg + GUARD_STRAP_IN, L.sideTop - 0.25);
    const prof = guardProfile(ctx, hz.outMax, fa.hoodZ, strapTop);
    const face = sidePath(L, L.side / 2, hz.x0, hz.x1); // outer face of the chine / gunwale, left side, |y|
    for (const { s, tag } of SIDES) {
      const m = guardMesh(prof, face, s);
      const mass = (m.volIn3 / IN3_PER_FT3) * p.printedDensityPcf;
      const yMid = s * face[Math.floor(face.length / 2)][1];
      parts.push(customPart(ctx, {
        id: `guard-${tag}`, partNo: 'finger-guard', name: `Finger guard ${tag}`, group: 'body', kind: 'printed', material: 'ASA', fab: 'print', step: STEP.finish,
        geometry: { type: 'mesh', positions: m.positions, indices: m.indices }, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        massLb: mass, explode: [0, s * 0.8, 0.6],
        cgIn: [(hz.x0 + hz.x1) / 2, yMid + s * hz.outMax / 3, fa.hoodZ],
        notes: `Printed ASA in one piece, ${m.lengthIn.toFixed(1)}" long along the hull face (x ${hz.x0.toFixed(1)}…${hz.x1.toFixed(1)}", the S-curve and then the straight nose side: the tire's rear inner corner sweeps in at the end of the curve, so the zone straddles x = ${L.xn.toFixed(1)}"): ${p.fingerGuardThickIn}" leg and strap, ${HOOD_FACTOR * p.fingerGuardThickIn}" hood flange ${hz.outMax.toFixed(2)}" wide at ${fa.hoodZ.toFixed(2)}" above the ground, ${(fa.hoodZ - fa.tireTopZ).toFixed(2)}" over the ${fa.tireTopZ}" tire top, covering every hull point that comes within ${p.fingerGapMinIn}" of the tire at any steering angle (min gap ${fa.minGapIn.toFixed(2)}"); the leg sits in the web recess and the strap screws to threaded inserts in the gunwale (cabin gunwale on the curve, nose gunwale on the straight). It shields the pocket from above and behind; the front of the sweep is open, but the neck there is wider than the pinch limit (D-37, D-47). PRINT: the part is only ${m.lengthIn.toFixed(1)}" long and fits any bed; hood face down on the bed (layers parallel to the hood, strong in bending), 4+ perimeters, ribs under the hood flange.`,
      }));
    }
  }

  // ── Signs (leaning with the flared panel), hung on knobs into tee-nuts in the web ──
  // The sign sits between the rear tire's front edge and the forward reflector, so a flared side never pushes it into the tire.
  const signX0 = L.r + SIGN_TIRE_GAP_IN;
  const signX1 = L.xRear + (L.xc0 - L.xRear) * REFLECTOR_FRACS[1] - REFLECTOR_SIZE[0] / 2 - SIGN_TIRE_GAP_IN;
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
