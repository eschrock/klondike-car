/**
 * Body: decks, captured-ply sides, shoulder panels, transoms with lift hand-holds, the bent-lam prow (and its
 * form), finger guards over the front-tire pinch zone, signs and grab handles (D-22, D-35…D-37).
 *
 * Shapes follow the build: the okoume side web is an `extrusion` that enters a groove in the chine and the gunwale,
 * the decks are `extrusion` outlines that enter rabbets (chines) and dados (transoms), the transoms are full-width
 * `extrusion`s with a hand-hold slot, and the prow is a `sweep` of 1/8" strips. Every ply part lists an edge condition
 * for each outline edge (captured in oak, or edged with oak banding; none exposed). Joint records are added in
 * joinery.ts after all parts exist.
 */
import { SIDE_CONSTRUCTION } from '../params';
import { STEP, box, span, SIDES, IN3_PER_FT3, woodMassLb, type Ctx } from './build-utils';
import { cabinSidePoint, type Layout } from './layout';
import { REFLECTOR_FRACS, REFLECTOR_SIZE } from './lighting';
import { compose } from './mat4';
import type { Dims, EdgeCondition, Mat4, Part, PartGroup, Vec2, Vec3 } from './types';

// ── Block-model placeholders (not design numbers: open-frame post pitch, grab handle block, sign fit gaps) ──
const POST_SPACING_IN = 12;
const POST_X_IN = 1.5;
const SIGN_MIN_LEN_IN = 4;
const SIGN_TIRE_GAP_IN = 0.25;
/** Grab handle (spec: 1 × 1.5 × 8): along x, y, z. */
const GRAB_SIZE = [8, 1.5, 1] as const;
const GRAB_AHEAD_OF_SEAT_IN = 6;
/** Prow leg: how far the foot hugs the front transom, and the oak kept between the slot and the leg. */
const PROW_LEG_MAX_IN = 3;
const PROW_LEG_ABOVE_SLOT_IN = 0.25;
const PROW_BEZIER_CTRL = 0.6;
const PROW_SAMPLES = 24;
/** Prow form: base below the foot, and how far the form body extends past the inside face. */
const FORM_BASE_IN = 1;
const FORM_BODY_IN = 3;
const FORM_CHEEK_IN = 1;
const FORM_SIDE_OFFSET_IN = 4;
/** Finger guard: strap height on the gunwale and the margin past the hazard zone. */
const GUARD_STRAP_IN = 1;
const GUARD_X_MARGIN_IN = 0.5;
const GUARD_OUT_MARGIN_IN = 0.25;
const LIFT_SLOT_SEGMENTS = 8;
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
    if (s.mat === 'oak') out.rough = { t: stock.t + p.millingAllowanceIn, w: stock.w + p.millingAllowanceIn, l: stock.l + p.millingAllowanceIn };
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
 * front transom keeps its top at the gunwale line (the lantern and flag clips straddle it, D-41) and lowers the slot instead.
 */
export function liftSlot(ctx: Ctx, end: 'rear' | 'front'): LiftSlot {
  const { p, L } = ctx;
  const deck = end === 'rear' ? L.deckTop : L.noseTop;
  let floor = deck + p.liftSlotClearIn;
  if (end === 'rear' && L.storage.x0 < L.xRear + L.side + 0.5 && L.storage.zTop > L.deckTop) floor = Math.max(floor, L.storage.zTop + 0.25);
  let zBot = floor;
  let zTop = zBot + p.liftSlotHeightIn;
  let transomTop = Math.max(deck + L.sideH, zTop + p.liftBarMinIn);
  if (end === 'front') {
    transomTop = deck + L.sideH;
    zTop = Math.min(zTop, transomTop - p.liftBarMinIn);
    zBot = zTop - p.liftSlotHeightIn;
  }
  return { zBot, zTop, transomTop, barIn: p.liftBarMinIn, thickIn: L.side, lengthIn: p.liftSlotLengthIn };
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

export function prowShape(ctx: Ctx): ProwShape {
  const { p, L } = ctx;
  const slot = liftSlot(ctx, 'front');
  const t = p.prowPlies * p.prowLamThicknessIn;
  const zFoot = Math.max(slot.zTop + PROW_LEG_ABOVE_SLOT_IN, slot.transomTop - PROW_LEG_MAX_IN);
  const gunTop = L.noseTop + L.sideH;
  const legLen = Math.max(0.5, slot.transomTop - zFoot);
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
  return {
    path, origin, widthIn: p.prowWidthIn, thicknessIn: t, plies: p.prowPlies, lengthIn: len,
    minRadiusIn: minRadius(path), limitRadiusIn: p.prowMinRadiusFactor * p.prowLamThicknessIn, legLenIn: legLen,
    tipTop: { x: origin[0] + xEnd, z: origin[2] + zEnd + t / 2 },
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
  const rearTx = L.xRear + L.side; // inner face of the rear transom
  const frontTx = L.xFront - L.side; // inner face of the front transom

  // ── Decks (extrusions in plan; capture: rabbets in the chines, dados in the transoms, banding on the step) ──
  {
    const x0 = rearTx - dd, x1 = L.xs, yH = L.hwC + (openFrame ? 0 : dd);
    const front = 2 * yH;
    parts.push(extPart(ctx, {
      id: 'deck-cabin', name: 'Cabin deck', group: 'body', mat: 'ply', step: STEP.body, grain: 'x', center: [(x0 + x1) / 2, 0, L.deckTop],
      outline: rectCCW(x0, x1, -yH, yH), depth: L.ply, transform: compose([0, 0, L.deckBot]),
      // Outline edges in order: right side, front (the step), left side, rear.
      edges: [sideCond, 'edged', sideCond, 'captured'],
      extraLb: edgeBandLb(ctx, front, L.ply),
      notes: `Sits in a ${dd}" rabbet in each chine (D-35) and a ${dd}" dado in the rear transom; the front (step) edge is banded with ${p.edgeBandIn}" oak.`,
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
      id: 'deck-nose', name: 'Nose deck', group: 'body', mat: 'ply', step: STEP.body, grain: 'x', center: [(x0 + x1) / 2, 0, L.noseTop],
      outline, ...(holes.length ? { holes } : {}), depth: L.ply, transform: compose([0, 0, L.noseBot]),
      edges: [sideCond, 'captured', sideCond, 'edged', ...(holes.length ? (['edged', 'edged', 'edged', 'edged'] as EdgeCondition[]) : [])],
      extraLb: edgeBandLb(ctx, 2 * yH + rim, L.ply),
      notes: `Sits in rabbets in the nose chines and a dado in the front transom; the rear (step) edge is banded with ${p.edgeBandIn}" oak.`
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
        const b = box(ctx, { id: `${id}-board`, partNo: `side-${run.zone}-board`, name: `${nm} side board`, group: 'body', mat: 'oak', step: STEP.body,
          ...span([run.x0, run.x1], yr(yc - L.side / 2, yc + L.side / 2), [run.bot, zTop]) });
        b.massLb -= rabbetLb;
        b.notes = `Deck edge sits in a ${dd}" rabbet on the inside bottom (D-35).`;
        parts.push(b);
      } else if (captured) {
        const grooveLb = oakLb(ctx, len * (pl + slop) * g);
        const chine = box(ctx, { id: `${id}-chine`, partNo: `side-${run.zone}-chine`, name: `${nm} chine`, group: 'body', mat: 'oak', step: STEP.body,
          ...span([run.x0, run.x1], yr(yc - L.side / 2, yc + L.side / 2), [run.bot, run.bot + L.railBand]) });
        chine.massLb -= grooveLb + rabbetLb;
        chine.notes = `Top groove ${(pl + slop).toFixed(3)}" × ${g}" holds the web; inside bottom rabbet ${dd}" × ${L.ply.toFixed(3)}" holds the deck (D-35).`;
        parts.push(chine);
        const gun = box(ctx, { id: `${id}-gunwale`, partNo: `side-${run.zone}-gunwale`, name: `${nm} gunwale`, group: 'body', mat: 'oak', step: STEP.body,
          ...span([run.x0, run.x1], yr(yc + s * runFlare - L.side / 2, yc + s * runFlare + L.side / 2), [zTop - L.railBand, zTop]) });
        gun.massLb -= grooveLb;
        gun.notes = `Underside groove ${(pl + slop).toFixed(3)}" × ${g}" holds the web (D-35).`;
        parts.push(gun);
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
        parts.push(extPart(ctx, {
          id: `${id}-web`, partNo: `side-${run.zone}-web`, name: `${nm} side panel`, group: 'body', mat: 'ply', step: STEP.body, grain: 'x',
          center: [(xw0 + xw1) / 2, yc + (s * runFlare) / 2, (z0 + z1) / 2],
          outline: rectCCW(0, wLen, 0, hTot), depth: pl, transform: frameMat([1, 0, 0], u, ez, org),
          // Outline edges in order: bottom, front end, top, rear end.
          edges: ['captured', frontCond, 'captured', rearCond],
          extraLb: edgeBandLb(ctx, hTot, pl),
          notes: `Captured in the chine and gunwale grooves (${g}" deep) and in a stopped dado in the ${rear ? 'rear' : 'front'} transom; the ${rear ? 'front' : 'rear'} end at the shoulder is banded with ${p.edgeBandIn}" oak (D-22, D-35).`,
        }));
      } else {
        // Open frame: gunwale on posts every 12".
        parts.push(box(ctx, { id: `${id}-gunwale`, partNo: `side-${run.zone}-gunwale`, name: `${nm} gunwale`, group: 'body', mat: 'oak', step: STEP.body,
          ...span([run.x0, run.x1], yr(yc - L.side / 2, yc + L.side / 2), [zTop - L.railBand, zTop]) }));
        const n = Math.max(2, Math.ceil((run.x1 - run.x0) / POST_SPACING_IN) + 1);
        for (let i = 0; i < n; i++) {
          const x = run.x0 + POST_X_IN / 2 + ((run.x1 - run.x0 - POST_X_IN) * i) / (n - 1);
          parts.push(box(ctx, { id: `${id}-post-${i + 1}`, partNo: `side-${run.zone}-post`, name: `${nm} post ${i + 1}`, group: 'body', mat: 'oak', step: STEP.body,
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
        id: `shoulder-${tag}`, partNo: 'shoulder', name: `Shoulder panel ${tag}`, group: 'body', mat: 'ply', edges: 'edged', step: STEP.body,
        ...span([L.xs - pl, L.xs], [Math.min(ya, yb), Math.max(ya, yb)], [L.deckTop, L.deckTop + H]), grain: 'y',
      });
      const wy = Math.abs(yb - ya);
      sh.massLb += edgeBandLb(ctx, 2 * (wy + H), pl);
      sh.notes = `All four edges banded with ${p.edgeBandIn}" oak; epoxy fillets to the deck and both sides (not structural).`;
      parts.push(sh);
    }
  }

  // ── Transoms (full width, wrapping the side ends) with a lift hand-hold each (M9, D-37) ──
  {
    const rs = liftSlot(ctx, 'rear');
    const w0 = L.hwC + L.side;
    const zb = L.deckTop - p.crossmemberDepthIn, zt = rs.transomTop;
    const t0 = L.web.z0, t1 = L.web.z1;
    const right: Vec2[] = flare > 1e-6 ? [[w0, zb], [w0, t0], [w0 + flare, t1], [w0 + flare, zt]] : [[w0, zb], [w0, zt]];
    const outline = ccw([...right, ...[...right].reverse().map(([y, z]) => [-y, z] as Vec2)]);
    const dadoLb = oakLb(ctx, 2 * (L.hwC + dd) * L.ply * dd) + 2 * oakLb(ctx, (pl + slop) * (L.web.z1 - L.web.z0 + 2 * g) * dd);
    parts.push(extPart(ctx, {
      id: 'transom-rear', name: 'Rear transom', group: 'body', mat: 'oak', step: STEP.body, grain: 'x', center: [L.xRear, 0, (zb + zt) / 2],
      outline, holes: [slotHole(0, (rs.zBot + rs.zTop) / 2, rs.lengthIn, p.liftSlotHeightIn)], depth: L.side,
      transform: frameMat([0, 1, 0], [0, 0, 1], [1, 0, 0], [L.xRear, 0, 0]), extraLb: -dadoLb,
      notes: `Lift hand-hold ${rs.lengthIn}" × ${p.liftSlotHeightIn}" (gloved hand), ${rs.barIn}" of oak above it; routed 1/4" roundovers both faces. Deck dado ${dd}" deep on the front face; stopped dados for the side panels (D-35, D-37).`,
    }));
    const fs = liftSlot(ctx, 'front');
    const wN = L.hwN + L.side;
    const zbF = L.noseTop - p.crossmemberDepthIn, ztF = fs.transomTop;
    const dadoF = oakLb(ctx, 2 * (L.hwN + dd) * L.ply * dd) + 2 * oakLb(ctx, (pl + slop) * (L.noseTop + H - L.railBand - (L.noseBot + L.railBand) + 2 * g) * dd);
    parts.push(extPart(ctx, {
      id: 'transom-front', name: 'Front transom', group: 'body', mat: 'oak', step: STEP.body, grain: 'x', center: [L.xFront, 0, (zbF + ztF) / 2],
      outline: ccw(rectCCW(-wN, wN, zbF, ztF)), holes: [slotHole(0, (fs.zBot + fs.zTop) / 2, fs.lengthIn, p.liftSlotHeightIn)], depth: L.side,
      transform: frameMat([0, 1, 0], [0, 0, 1], [1, 0, 0], [L.xFront - L.side, 0, 0]), extraLb: -dadoF,
      notes: `Lift hand-hold ${fs.lengthIn}" × ${p.liftSlotHeightIn}" (gloved hand), ${fs.barIn}" of oak above it. The prow leg bolts to its front face above the slot (D-9, D-36).`,
    }));
  }

  // ── Prow: removable bent-lam sweep on the front transom, and its form as a reference part ──
  {
    const pr = prowShape(ctx);
    const area = pr.widthIn * pr.thicknessIn;
    const vol = area * pr.lengthIn;
    const surf = 2 * pr.lengthIn * (pr.widthIn + pr.thicknessIn) + 2 * area;
    const dir = Math.hypot(0.3, 1);
    parts.push({
      id: 'prow', name: 'Prow (bent-lam stem)', group: 'body', kind: 'bentlam', material: 'white oak',
      geometry: { type: 'sweep', path: pr.path, width: pr.widthIn, thickness: pr.thicknessIn, plies: pr.plies },
      transform: compose(pr.origin), body: 'chassis', massLb: woodMassLb(p, vol, surf, p.oakDensityPcf),
      fab: 'bentlam', step: STEP.body, removable: true, explode: [0.3 / dir, 0, 1 / dir],
      stock: { t: pr.thicknessIn, w: pr.widthIn, l: pr.lengthIn },
      rough: { t: pr.thicknessIn + p.millingAllowanceIn, w: pr.widthIn + p.millingAllowanceIn, l: pr.lengthIn + p.millingAllowanceIn },
      grain: 'z',
      notes: `${pr.plies} plies of ${p.prowLamThicknessIn}" white oak (${pr.thicknessIn}" total) × ${pr.widthIn}" wide, epoxy-laminated on the prow form; ${pr.legLenIn.toFixed(2)}" straight leg against the front transom face, then a Bezier sweep to ${p.prowHeightIn}" above the gunwale. Tightest radius ${pr.minRadiusIn.toFixed(1)}" (limit ${pr.limitRadiusIn.toFixed(1)}" = ${p.prowMinRadiusFactor}× strip). Removable for transport: two 1/4-20 threaded inserts in the leg take thumb-knob bolts through the transom (D-9, D-36). Strips: ${pr.plies} × ${p.prowLamThicknessIn}" × ${(pr.widthIn + 0.25).toFixed(2)}" × ${(pr.lengthIn + 2).toFixed(0)}" (trim after glue-up).`,
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
      notes: `CNC the profile out of 3/4" MDF sheets (${Math.ceil(depth / 0.75)} layers glued for ${depth.toFixed(2)}" depth); the strips wrap the convex edge. Spring-back allowance ${(p.prowSpringbackFrac * 100).toFixed(0)}%: every heading change is overbent by that fraction (${fp.overbendDeg.toFixed(1)}° extra at the tip); tightest form radius ${fp.formMinRadiusIn.toFixed(1)}". Verify with a test strip before cutting the form (spring-back is a placeholder, D-36). Clamp with ratchet straps and 1" cauls; wax the form; 24 h cure. Shown beside the cart; not part of its mass.`,
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

  // ── Grab handles on the gunwales ──
  const gx = p.seatXIn + GRAB_AHEAD_OF_SEAT_IN;
  const nose = gx >= L.xs;
  const gw = nose ? L.hwN : L.hwC;
  const gTop = (nose ? L.noseTop : L.deckTop) + H;
  for (const { s, tag } of SIDES) {
    parts.push(box(ctx, {
      id: `grab-${tag}`, partNo: 'grab-handle', name: `Grab handle ${tag}`, group: 'body', mat: 'oak', step: STEP.finish,
      size: [...GRAB_SIZE], center: [gx, s * (gw + L.side / 2 + (nose ? 0 : flare)), gTop + GRAB_SIZE[2] / 2],
      notes: 'Bolted through the gunwale with two 1/4" bolts and fender washers (D-35).',
    }));
  }
  return parts;
}
