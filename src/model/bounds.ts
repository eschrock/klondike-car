/**
 * Oriented bounding boxes for Parts, plus a separating-axis overlap test.
 * Used by the overlap/clearance tests, the truck-fit check and mass.ts.
 * Plain math, no three.js.
 */
import type { Geometry, Mat4, Part, Vec2, Vec3 } from './types';

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface OBB {
  center: Vec3;
  /** Unit axes (world), columns of the part's rotation. */
  axes: [Vec3, Vec3, Vec3];
  /** Half extents along each axis. */
  half: Vec3;
}

/** Axis-aligned bounds of a geometry in its own local frame. */
export function localBounds(g: Geometry): Bounds {
  switch (g.type) {
    case 'box':
      return { min: [-g.size[0] / 2, -g.size[1] / 2, -g.size[2] / 2], max: [g.size[0] / 2, g.size[1] / 2, g.size[2] / 2] };
    case 'cylinder':
      return { min: [-g.radius, -g.radius, -g.length / 2], max: [g.radius, g.radius, g.length / 2] };
    case 'wheel': {
      const r = g.diameter / 2;
      const w = Math.max(g.width, g.hubLength) / 2;
      return { min: [-r, -w, -r], max: [r, w, r] };
    }
    case 'extrusion': {
      const xs = g.outline.map((p) => p[0]);
      const ys = g.outline.map((p) => p[1]);
      return { min: [Math.min(...xs), Math.min(...ys), 0], max: [Math.max(...xs), Math.max(...ys), g.depth] };
    }
    case 'sweep': {
      const t = g.thickness / 2;
      const xs = g.path.map((p) => p[0]);
      const zs = g.path.map((p) => p[1]);
      return { min: [Math.min(...xs) - t, -g.width / 2, Math.min(...zs) - t], max: [Math.max(...xs) + t, g.width / 2, Math.max(...zs) + t] };
    }
    case 'mesh': {
      const min: Vec3 = [Infinity, Infinity, Infinity];
      const max: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < g.positions.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], g.positions[i + k]);
          max[k] = Math.max(max[k], g.positions[i + k]);
        }
      }
      return { min, max };
    }
  }
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function column(m: Mat4, c: number): Vec3 {
  const v: Vec3 = [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
  const n = Math.hypot(...v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

export function partOBB(part: Part): OBB {
  const b = localBounds(part.geometry);
  const localCenter: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  return {
    center: transformPoint(part.transform, localCenter),
    axes: [column(part.transform, 0), column(part.transform, 1), column(part.transform, 2)],
    half: [(b.max[0] - b.min[0]) / 2, (b.max[1] - b.min[1]) / 2, (b.max[2] - b.min[2]) / 2],
  };
}

const SLAB_IN = 1.25;
/** Horizontal bands a tire is cut into for the tight box list (`partOBBs`). */
const WHEEL_BANDS = 12;
const MAX_SLABS = 40;

/** Clip a polygon to the vertical strip xa <= x <= xb (Sutherland–Hodgman, two passes). */
function clipStrip(poly: Vec2[], xa: number, xb: number): Vec2[] {
  const pass = (pts: Vec2[], keep: (q: Vec2) => boolean, cut: (a: Vec2, b: Vec2) => Vec2): Vec2[] => {
    const out: Vec2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      if (keep(a)) { out.push(a); if (!keep(c)) out.push(cut(a, c)); } else if (keep(c)) out.push(cut(a, c));
    }
    return out;
  };
  const at = (x: number) => (a: Vec2, c: Vec2): Vec2 => [x, a[1] + ((c[1] - a[1]) * (x - a[0])) / (c[0] - a[0])];
  return pass(pass(poly, (q) => q[0] >= xa, at(xa)), (q) => q[0] <= xb, at(xb));
}

/**
 * Tight oriented boxes covering a part, for overlap tests. A bent sweep (plan or elevation curve) becomes one box per path segment; an
 * extrusion whose outline fills well under its bounding rectangle (a tapering deck, a crowned transom) becomes a row of narrow slabs;
 * everything else is the single `partOBB` box. A list of boxes is always a subset of the single box's volume, so it never creates a
 * false overlap and removes the ones a curved part's bounding box would cause (D-45).
 */
const obbsCache = new WeakMap<Part, { t: Mat4; g: Geometry; v: OBB[] }>();
export function partOBBs(part: Part): OBB[] {
  const hit = obbsCache.get(part);
  if (hit && hit.t === part.transform && hit.g === part.geometry) return hit.v;
  const v = computeOBBs(part);
  obbsCache.set(part, { t: part.transform, g: part.geometry, v });
  return v;
}

function computeOBBs(part: Part): OBB[] {
  const g = part.geometry;
  const m = part.transform;
  if (g.type === 'sweep' && g.path.length > 2) {
    const axes: Vec3[] = [column(m, 0), column(m, 1), column(m, 2)];
    const out: OBB[] = [];
    for (let i = 1; i < g.path.length; i++) {
      const [ax, az] = g.path[i - 1], [bx, bz] = g.path[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-9) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const dir: Vec3 = [axes[0][0] * dx + axes[2][0] * dz, axes[0][1] * dx + axes[2][1] * dz, axes[0][2] * dx + axes[2][2] * dz];
      const nrm: Vec3 = [-axes[0][0] * dz + axes[2][0] * dx, -axes[0][1] * dz + axes[2][1] * dx, -axes[0][2] * dz + axes[2][2] * dx];
      out.push({ center: transformPoint(m, [(ax + bx) / 2, 0, (az + bz) / 2]), axes: [dir, axes[1], nrm], half: [len / 2, g.width / 2, g.thickness / 2] });
    }
    return out.length ? out : [partOBB(part)];
  }
  if (g.type === 'mesh' && g.slabs) {
    // A long, thin, plan-curved wall (a hull side member): one box per `slabs` inches of x over the vertices in that stretch.
    const b = localBounds(g);
    const n = Math.max(1, Math.ceil((b.max[0] - b.min[0]) / g.slabs));
    // Slab edges: the even split plus every x where the outline has a vertex, so a notch or a step is resolved exactly (a rail with relief notches).
    const cuts = [...Array.from({ length: n + 1 }, (_, k) => b.min[0] + ((b.max[0] - b.min[0]) * k) / n), ...(g.profile ?? []).map((q) => q[0])].sort((u, v) => u - v).filter((v, i, a) => i === 0 || v - a[i - 1] > 1e-7);
    const out: OBB[] = [];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const xa = cuts[k], xb = cuts[k + 1];
      // y: the wall's face extent over the vertices in the slab (a slab edge vertex belongs to both neighbors)
      let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < g.positions.length; i += 3) {
        const x = g.positions[i];
        if (x < xa - 1e-6 || x > xb + 1e-6) continue;
        y0 = Math.min(y0, g.positions[i + 1]); y1 = Math.max(y1, g.positions[i + 1]);
        z0 = Math.min(z0, g.positions[i + 2]); z1 = Math.max(z1, g.positions[i + 2]);
      }
      if (!Number.isFinite(y0)) continue;
      if (g.profile) {
        const c = clipStrip(g.profile, xa + 1e-6, xb - 1e-6); // a hair inside, so a vertical edge ON a slab edge belongs to neither slab's vertex set
        if (c.length < 3) continue;
        z0 = Math.min(...c.map((q) => q[1])); z1 = Math.max(...c.map((q) => q[1]));
      }
      out.push({ center: transformPoint(m, [(xa + xb) / 2, (y0 + y1) / 2, (z0 + z1) / 2]), axes: [column(m, 0), column(m, 1), column(m, 2)], half: [(xb - xa) / 2, (y1 - y0) / 2, (z1 - z0) / 2] });
    }
    if (out.length) return out;
  }
  if (g.type === 'wheel') {
    // A tire is a disc in its local x-z plane, not the box of its bounding square: its corners are not there. Horizontal bands (local z), each as wide as the disc is at
    // the band's nearest edge to the axle (a superset of the disc), so a hull panel or bracket that is above the axle line is not charged for the square corner (D-45 style).
    const r = g.diameter / 2, w = Math.max(g.width, g.hubLength) / 2;
    const n = WHEEL_BANDS;
    const out: OBB[] = [];
    for (let k = 0; k < n; k++) {
      const z0 = -r + (2 * r * k) / n, z1 = -r + (2 * r * (k + 1)) / n;
      const near = z0 <= 0 && z1 >= 0 ? 0 : Math.min(Math.abs(z0), Math.abs(z1));
      const xh = Math.sqrt(Math.max(0, r * r - near * near));
      out.push({ center: transformPoint(m, [0, 0, (z0 + z1) / 2]), axes: [column(m, 0), column(m, 1), column(m, 2)], half: [xh, w, (z1 - z0) / 2] });
    }
    return out;
  }
  if (g.type === 'extrusion') {
    const b = localBounds(g);
    const bw = b.max[0] - b.min[0], bh = b.max[1] - b.min[1];
    let area = 0;
    for (let i = 0; i < g.outline.length; i++) { const [x1, y1] = g.outline[i], [x2, y2] = g.outline[(i + 1) % g.outline.length]; area += x1 * y2 - x2 * y1; }
    area = Math.abs(area) / 2;
    // A rectilinear outline (all edges along the axes: C and L sections, stepped plates) is covered EXACTLY by a few rectangles, however small: split it by scanlines so a
    // bent bracket is its web and leaves, not the solid block of its bounding rectangle.
    if (!g.holes && g.outline.length > 4 && area < 0.995 * bw * bh) {
      const rects = rectilinearRects(g.outline);
      if (rects) {
        return rects.map((r) => ({ center: transformPoint(m, [(r[0] + r[1]) / 2, (r[2] + r[3]) / 2, g.depth / 2]), axes: [column(m, 0), column(m, 1), column(m, 2)] as [Vec3, Vec3, Vec3], half: [(r[1] - r[0]) / 2, (r[3] - r[2]) / 2, g.depth / 2] as Vec3 }));
      }
    }
    if (bw > 2 * SLAB_IN && (g.outline.length > 4 || g.holes) && area < 0.995 * bw * bh) {
      const n = Math.min(MAX_SLABS, Math.max(2, Math.ceil(bw / SLAB_IN)));
      const out: OBB[] = [];
      // Slab edges: the even split plus every x where the outline has a vertex, so a notch or a step with vertical sides is resolved exactly (a rail with relief notches).
      const cuts = [...Array.from({ length: n + 1 }, (_, k) => b.min[0] + (bw * k) / n), ...g.outline.map((q) => q[0])].sort((u, v) => u - v).filter((v, i, a) => i === 0 || v - a[i - 1] > 1e-7);
      for (let k = 0; k + 1 < cuts.length; k++) {
        const xa = cuts[k], xb = cuts[k + 1];
        const c = clipStrip(g.outline, xa + 1e-6, xb - 1e-6); // a hair inside, so a vertical outline edge ON a slab edge belongs to neither slab's vertex set
        if (c.length < 3) continue;
        const x0 = Math.min(...c.map((q) => q[0])), x1 = Math.max(...c.map((q) => q[0]));
        const y0 = Math.min(...c.map((q) => q[1])), y1 = Math.max(...c.map((q) => q[1]));
        out.push({ center: transformPoint(m, [(x0 + x1) / 2, (y0 + y1) / 2, g.depth / 2]), axes: [column(m, 0), column(m, 1), column(m, 2)], half: [(x1 - x0) / 2, (y1 - y0) / 2, g.depth / 2] });
      }
      if (out.length) return out;
    }
  }
  return [partOBB(part)];
}


/**
 * Exact rectangle cover of a rectilinear polygon (every edge axis-parallel), as [x0, x1, y0, y1] rectangles: scanlines between consecutive distinct y values, even-odd
 * x intervals, then vertically adjacent rectangles with the same x interval merged. Null for any other outline.
 */
export function rectilinearRects(poly: Vec2[]): Array<[number, number, number, number]> | null {
  const n = poly.length;
  const EPS = 1e-9;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if (Math.abs(a[0] - b[0]) > EPS && Math.abs(a[1] - b[1]) > EPS) return null;
  }
  const ys = [...new Set(poly.map((q) => Math.round(q[1] * 1e6) / 1e6))].sort((u, v) => u - v);
  const out: Array<[number, number, number, number]> = [];
  for (let k = 0; k + 1 < ys.length; k++) {
    const ym = (ys[k] + ys[k + 1]) / 2;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      if (Math.abs(a[0] - b[0]) < EPS && (a[1] - ym) * (b[1] - ym) < 0) xs.push(a[0]);
    }
    xs.sort((u, v) => u - v);
    for (let j = 0; j + 1 < xs.length; j += 2) {
      if (xs[j + 1] - xs[j] < EPS) continue;
      const prev = out.find((r) => Math.abs(r[3] - ys[k]) < EPS && Math.abs(r[0] - xs[j]) < EPS && Math.abs(r[1] - xs[j + 1]) < EPS);
      if (prev) prev[3] = ys[k + 1]; else out.push([xs[j], xs[j + 1], ys[k], ys[k + 1]]);
    }
  }
  return out.length ? out : null;
}

/** Deepest interpenetration between two parts over their tight box lists (≤ 0 when separated). */
const aabbCache = new WeakMap<Part, { t: Mat4; g: Geometry; v: Bounds }>();
function cachedAABB(part: Part): Bounds {
  const hit = aabbCache.get(part);
  if (hit && hit.t === part.transform && hit.g === part.geometry) return hit.v;
  const v = worldAABB(part);
  aabbCache.set(part, { t: part.transform, g: part.geometry, v });
  return v;
}

export function partsOverlap(a: Part, b: Part): number {
  // Cheap reject: separated world bounding boxes (returns the gap as a negative overlap, an upper bound of the true separating-axis value).
  const ba = cachedAABB(a), bb = cachedAABB(b);
  let gap = -Infinity;
  for (let k = 0; k < 3; k++) gap = Math.max(gap, ba.min[k] - bb.max[k], bb.min[k] - ba.max[k]);
  if (gap > 0) return -gap;
  const A = partOBBs(a), B = partOBBs(b);
  let worst = -Infinity;
  for (const x of A) for (const y of B) worst = Math.max(worst, obbOverlap(x, y));
  return worst;
}

/** World-space centroid of the part's bounding box (fallback CG). */
export function partCentroid(part: Part): Vec3 {
  return partOBB(part).center;
}

/** World axis-aligned bounds of a part (or of several parts). */
export function worldAABB(parts: Part | Part[]): Bounds {
  const list = Array.isArray(parts) ? parts : [parts];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of list) {
    const o = partOBB(p);
    for (let k = 0; k < 3; k++) {
      const ext = Math.abs(o.axes[0][k]) * o.half[0] + Math.abs(o.axes[1][k]) * o.half[1] + Math.abs(o.axes[2][k]) * o.half[2];
      min[k] = Math.min(min[k], o.center[k] - ext);
      max[k] = Math.max(max[k], o.center[k] + ext);
    }
  }
  return { min, max };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Separating-axis test. Returns the minimum overlap depth (inches) over all
 * 15 candidate axes: > 0 means the boxes interpenetrate by that much, ≤ 0
 * means they are separated by at least |value| along some axis.
 */
export function obbOverlap(a: OBB, b: OBB): number {
  const d: Vec3 = [b.center[0] - a.center[0], b.center[1] - a.center[1], b.center[2] - a.center[2]];
  const candidates: Vec3[] = [...a.axes, ...b.axes];
  for (const u of a.axes) for (const v of b.axes) {
    const c = cross(u, v);
    const n = Math.hypot(...c);
    if (n > 1e-6) candidates.push([c[0] / n, c[1] / n, c[2] / n]);
  }
  let minOverlap = Infinity;
  for (const L of candidates) {
    const ra = a.half[0] * Math.abs(dot(a.axes[0], L)) + a.half[1] * Math.abs(dot(a.axes[1], L)) + a.half[2] * Math.abs(dot(a.axes[2], L));
    const rb = b.half[0] * Math.abs(dot(b.axes[0], L)) + b.half[1] * Math.abs(dot(b.axes[1], L)) + b.half[2] * Math.abs(dot(b.axes[2], L));
    const overlap = ra + rb - Math.abs(dot(d, L));
    if (overlap < minOverlap) minOverlap = overlap;
  }
  return minOverlap;
}
