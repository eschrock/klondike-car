/**
 * Plan-view S-curve of the hull side (D-45): a smooth reverse curve from the cabin side to the nose side.
 *
 * Plain numbers only (no params, no three.js), so params.ts (auto nose / validation), layout.ts, body.ts and the tests all share it.
 *
 * The curve is defined on the side's CENTERLINE (the plane of the okoume web, the middle of the 5/8" chine and gunwale). It is built
 * from a curvature profile: curvature ramps up linearly from 0 (tangent to the cabin side), holds, and ramps back to 0 at the middle
 * of the curve (the inflection), then the mirror image bends it back to parallel (tangent to the nose side). So heading AND curvature
 * are continuous at both ends and at the inflection (no kinks, no curvature jumps), and for a given length the tightest radius is
 * much larger than a quintic "smootherstep" would give (a bent lamination cares about the tightest radius).
 */
import type { Vec2 } from './types';

/** Fraction of each half over which curvature ramps (the rest holds constant). 1 = triangle profile, small = nearly two arcs. */
const RAMP_FRAC = 0.25;
const FINE = 480;
const SAMPLES = 24;
/** Largest heading the curve may reach (rad) before the shape falls back to a smootherstep. */
const MAX_HEADING = (80 * Math.PI) / 180;

export interface PlanCurve {
  /** x of the start (tangent to the cabin side) and end (tangent to the nose side), and the centerline half widths there. */
  x0: number;
  x1: number;
  yA: number;
  yB: number;
  /** Centerline samples from (x0, yA) to (x1, yB), uniform in arc length. */
  pts: Vec2[];
  /** Tightest radius of curvature of the centerline (Infinity when straight). */
  minRadius: number;
  /** Arc length of the curve. */
  length: number;
  /** Peak heading change from the cabin side direction (rad). */
  peakHeading: number;
}

/** Heading integral G(v) of the curvature profile g on [0, 1] (g ramps up over RAMP_FRAC of the first half, mirrored negative in the second). */
function gProfile(v: number): number {
  const h = v <= 0.5 ? v : 1 - v;
  const gv = Math.min(1, h / (0.5 * RAMP_FRAC));
  return v <= 0.5 ? gv : -gv;
}

const GTAB: number[] = (() => {
  const t = [0];
  for (let i = 1; i <= FINE; i++) {
    const v0 = (i - 1) / FINE, v1 = i / FINE;
    t.push(t[i - 1] + ((gProfile(v0) + gProfile((v0 + v1) / 2) * 4 + gProfile(v1)) / 6) * (1 / FINE));
  }
  return t;
})();
const G_MAX = Math.max(...GTAB);

function integrals(phi: number): { C: number; S: number } {
  let C = 0, S = 0;
  for (let i = 0; i < FINE; i++) {
    const th = phi * (GTAB[i] + GTAB[i + 1]) / 2;
    C += Math.cos(th);
    S += Math.sin(th);
  }
  return { C: C / FINE, S: S / FINE };
}

const cache = new Map<string, PlanCurve>();

const smootherstep = (u: number) => u * u * u * (10 - 15 * u + 6 * u * u);

/** Build (and cache) the curve from (x0, yA) to (x1, yB), both ends parallel to the x axis. */
export function buildPlanCurve(x0: number, x1: number, yA: number, yB: number): PlanCurve {
  const key = `${x0}|${x1}|${yA}|${yB}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = computeCurve(x0, x1, yA, yB);
  if (cache.size > 4000) cache.clear();
  cache.set(key, c);
  return c;
}

function computeCurve(x0: number, x1: number, yA: number, yB: number): PlanCurve {
  const Lc = Math.max(1e-6, x1 - x0);
  const dy = yB - yA;
  const D = Math.abs(dy);
  const sgn = dy < 0 ? -1 : 1;
  if (D < 1e-9) {
    return { x0, x1, yA, yB, pts: [[x0, yA], [x1, yB]], minRadius: Infinity, length: Lc, peakHeading: 0 };
  }
  const target = D / Lc;
  // Solve S(phi)/C(phi) = D / Lc by bisection on the heading scale phi (monotone while the peak heading < 90 degrees).
  const phiMax = MAX_HEADING / G_MAX;
  const rMax = (() => { const q = integrals(phiMax); return q.S / q.C; })();
  if (target <= rMax) {
    let lo = 0, hi = phiMax;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const q = integrals(mid);
      if (q.S / q.C < target) lo = mid; else hi = mid;
    }
    const phi = (lo + hi) / 2;
    const q = integrals(phi);
    const S = Lc / q.C;
    const kappa = phi / S;
    const pts: Vec2[] = [];
    const step = FINE / SAMPLES;
    let cx = 0, cy = 0;
    pts.push([x0, yA]);
    for (let i = 0; i < FINE; i++) {
      const th = phi * (GTAB[i] + GTAB[i + 1]) / 2;
      cx += Math.cos(th) / FINE;
      cy += Math.sin(th) / FINE;
      if ((i + 1) % step === 0) pts.push([x0 + S * cx, yA + sgn * S * cy]);
    }
    pts[pts.length - 1] = [x1, yB];
    return { x0, x1, yA, yB, pts, minRadius: 1 / kappa, length: S, peakHeading: phi * G_MAX };
  }
  // Too steep for the profile: fall back to a smootherstep (exact end points, tangent, curvature-continuous).
  const pts: Vec2[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const u = i / SAMPLES;
    pts.push([x0 + Lc * u, yA + dy * smootherstep(u)]);
  }
  let rMin = Infinity, len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  for (let i = 1; i < 1000; i++) {
    const u = i / 1000, h = 1e-4;
    const f = (v: number) => D * smootherstep(v);
    const yp = (f(u + h) - f(u - h)) / (2 * h * Lc);
    const ypp = (f(u + h) - 2 * f(u) + f(u - h)) / (h * h * Lc * Lc);
    const k = Math.abs(ypp) / (1 + yp * yp) ** 1.5;
    if (k > 1e-12) rMin = Math.min(rMin, 1 / k);
  }
  return { x0, x1, yA, yB, pts, minRadius: rMin, length: len, peakHeading: Math.atan((1.875 * D) / Lc) };
}

/**
 * Polyline of the side offset `d` inches OUTWARD from the centerline (negative = inward), covering x in [xa, xb]: the straight cabin
 * side before the curve, the curve, and the straight nose side after it. Ends are clipped exactly at xa and xb.
 */
export function sidePolyline(c: PlanCurve, d: number, xa: number, xb: number): Vec2[] {
  const lead = Math.min(xa, c.x0) - 1;
  const tail = Math.max(xb, c.x1) + 1;
  const center: Vec2[] = [[lead, c.yA], ...c.pts, [tail, c.yB]];
  // Drop duplicates (a zero-length lead or tail).
  const cl = center.filter((q, i) => i === 0 || Math.hypot(q[0] - center[i - 1][0], q[1] - center[i - 1][1]) > 1e-9);
  const off: Vec2[] = cl.map((q, i) => {
    const a = cl[Math.max(0, i - 1)], b = cl[Math.min(cl.length - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1];
    const n = Math.hypot(tx, ty) || 1;
    return [q[0] + (d * -ty) / n, q[1] + (d * tx) / n];
  });
  // Clip to [xa, xb] (x increases along the polyline for any sane curve).
  const out: Vec2[] = [];
  const at = (x: number): Vec2 => {
    for (let i = 1; i < off.length; i++) {
      if (off[i][0] >= x) {
        const u = (x - off[i - 1][0]) / Math.max(1e-12, off[i][0] - off[i - 1][0]);
        return [x, off[i - 1][1] + u * (off[i][1] - off[i - 1][1])];
      }
    }
    return [x, off[off.length - 1][1]];
  };
  out.push(at(xa));
  for (const q of off) if (q[0] > xa + 1e-9 && q[0] < xb - 1e-9) out.push(q);
  out.push(at(xb));
  return out;
}

/** Centerline half width at x (constant before the start and after the end). */
export function curveCenterY(c: PlanCurve, x: number): number {
  if (x <= c.x0) return c.yA;
  if (x >= c.x1) return c.yB;
  for (let i = 1; i < c.pts.length; i++) {
    if (c.pts[i][0] >= x) {
      const u = (x - c.pts[i - 1][0]) / Math.max(1e-12, c.pts[i][0] - c.pts[i - 1][0]);
      return c.pts[i - 1][1] + u * (c.pts[i][1] - c.pts[i - 1][1]);
    }
  }
  return c.yB;
}

/** Half width of the side offset `d` outward from the centerline, at x (via the offset polyline). */
export function offsetY(c: PlanCurve, d: number, x: number): number {
  const pl = sidePolyline(c, d, x - 1e-6, x + 1e-6);
  return (pl[0][1] + pl[pl.length - 1][1]) / 2;
}

/** Heading (rad from +x) of the centerline at x; 0 outside the curve. */
export function curveHeading(c: PlanCurve, x: number): number {
  if (x <= c.x0 || x >= c.x1) return 0;
  for (let i = 1; i < c.pts.length; i++) {
    if (c.pts[i][0] >= x) return Math.atan2(c.pts[i][1] - c.pts[i - 1][1], c.pts[i][0] - c.pts[i - 1][0]);
  }
  return 0;
}

// ── Front-tire sweep and clearance ──

export interface TireSweepSpec {
  wheelbase: number;
  /** Kingpin x. */
  kx: number;
  frontTrack: number;
  tireWidth: number;
  wheelDiameter: number;
  lockDeg: number;
}

/** Plan rectangles of the LEFT front tire at every degree of steering from −lock to +lock (rotated about the kingpin). */
const polyCache = new Map<string, Vec2[][]>();
export function leftTirePolys(t: TireSweepSpec, stepDeg = 1): Vec2[][] {
  const key = [t.wheelbase, t.kx, t.frontTrack, t.tireWidth, t.wheelDiameter, t.lockDeg, stepDeg].join('|');
  const hit = polyCache.get(key);
  if (hit) return hit;
  const out = leftTirePolysUncached(t, stepDeg);
  if (polyCache.size > 500) polyCache.clear();
  polyCache.set(key, out);
  return out;
}

function leftTirePolysUncached(t: TireSweepSpec, stepDeg: number): Vec2[][] {
  const r = t.wheelDiameter / 2, hw = t.tireWidth / 2;
  const out: Vec2[][] = [];
  const lock = Math.abs(t.lockDeg);
  for (let d = -lock; d <= lock + 1e-9; d += stepDeg) {
    const a = (d * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    out.push(([[-r, -hw], [r, -hw], [r, hw], [-r, hw]] as Vec2[]).map(([dx, dy]) => {
      const x = t.wheelbase + dx - t.kx, y = t.frontTrack / 2 + dy;
      return [t.kx + c * x - s * y, s * x + c * y] as Vec2;
    }));
  }
  return out;
}

function pointSegDist(px: number, py: number, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const u = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - (a[0] + u * dx), py - (a[1] + u * dy));
}

/** `minGapToTires` reports at most this (inches). */
const GAP_CAP_IN = 8;

/** Smallest distance from a polyline (sampled every `ds` inches) to any of the tire rectangles (0 when a sample is inside one). */
export function minGapToTires(outline: Vec2[], polys: Vec2[][], ds = 0.2): number {
  let best = GAP_CAP_IN; // gaps beyond this are not interesting (and are skipped for speed)
  const gb = [Math.min(...polys.map((q) => Math.min(...q.map((v) => v[0])))), Math.max(...polys.map((q) => Math.max(...q.map((v) => v[0])))), Math.min(...polys.map((q) => Math.min(...q.map((v) => v[1])))), Math.max(...polys.map((q) => Math.max(...q.map((v) => v[1]))))];
  const bbs = polys.map((q) => [Math.min(...q.map((v) => v[0])), Math.max(...q.map((v) => v[0])), Math.min(...q.map((v) => v[1])), Math.max(...q.map((v) => v[1]))]);
  const test = (x: number, y: number) => {
    if (Math.hypot(Math.max(gb[0] - x, 0, x - gb[1]), Math.max(gb[2] - y, 0, y - gb[3])) >= best) return;
    for (let k = 0; k < polys.length; k++) {
      const b = bbs[k];
      const dxb = Math.max(b[0] - x, 0, x - b[1]), dyb = Math.max(b[2] - y, 0, y - b[3]);
      if (Math.hypot(dxb, dyb) >= best) continue;
      const q = polys[k];
      // inside test (convex rectangle)
      let inside = true;
      for (let i = 0; i < 4 && inside; i++) {
        const a = q[i], bb = q[(i + 1) % 4];
        if ((bb[0] - a[0]) * (y - a[1]) - (bb[1] - a[1]) * (x - a[0]) < 0) inside = false;
      }
      if (inside) { best = 0; return; }
      for (let i = 0; i < 4; i++) best = Math.min(best, pointSegDist(x, y, q[i], q[(i + 1) % 4]));
    }
  };
  for (let i = 0; i + 1 < outline.length; i++) {
    const a = outline[i], b = outline[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / ds));
    for (let j = 0; j <= n; j++) {
      test(a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n);
      if (best === 0) return 0;
    }
  }
  return best;
}

export interface CurveClearanceSpec extends TireSweepSpec {
  /** Centerline half widths of the cabin and nose sides and the side thickness (outer face = centerline + side/2). */
  yA: number;
  yB: number;
  side: number;
  /** Length of straight nose side tested after the curve end. */
  tailIn?: number;
}

/** Smallest distance from the OUTER face of the hull side (cabin + curve + nose) to the left front tire over the whole steering sweep. */
export function curveTireGap(x0: number, x1: number, spec: CurveClearanceSpec, polys?: Vec2[][]): number {
  const c = buildPlanCurve(x0, x1, spec.yA, spec.yB);
  const outline = sidePolyline(c, spec.side / 2, Math.min(x0, x1) - 0.5, x1 + (spec.tailIn ?? 10));
  return minGapToTires(outline, polys ?? leftTirePolys(spec));
}

/**
 * Latest curve end x1 (≥ x0 + minLen) whose outer face still clears the tire sweep by `clearance`: the S-curve may finish as late as that.
 * Returns x0 + minLen when even the shortest curve does not clear (the validator then reports it).
 */
export function latestCurveEnd(x0: number, spec: CurveClearanceSpec, clearance: number, minLen = 3, maxLen = 40): number {
  const polys = leftTirePolys(spec);
  const ok = (x1: number) => curveTireGap(x0, x1, spec, polys) >= clearance - 1e-9;
  const lo0 = x0 + minLen;
  if (!ok(lo0)) return lo0;
  let lo = lo0, hi = x0 + maxLen;
  if (ok(hi)) return hi;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid; else hi = mid;
  }
  return lo;
}
