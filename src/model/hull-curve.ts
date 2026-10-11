/**
 * Plan-view curve of the hull side (D-45, D-52): one convex bow taper from the cabin side to the front transom, fitted to the Ackermann tire sweep.
 *
 * Plain numbers only (no params, no three.js), so params.ts (auto curve start / validation), layout.ts, body.ts and the tests all share it.
 *
 * The curve is defined on the side's CENTERLINE (the plane of the okoume web, the middle of the 5/8" chine and gunwale). It is built from a curvature
 * profile (trapezoid ramps, so heading AND curvature are continuous at both ends), followed by a straight bow run (see the bow section below).
 */
import { solveSteer, type AckSpec } from './ackermann';
import type { Vec2 } from './types';

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
  /** Slope dy/dx of the straight bow run that continues past x1 (negative = converging toward the front, D-52). Absent or 0: the nose side is parallel to the axis. */
  endSlope?: number;
  /** Bow curves only: peak curvature of the reverse (straightening) part as a fraction of the convergent part; 0 = fully convex. */
  reverseFrac?: number;
}

// ── Bow taper (D-52): one long curve that keeps converging toward the front transom ──
//
// The old D-45 curve ended PARALLEL to the axis (a reverse curve: a waist with an inflection). The Ackermann front end leaves room ahead of the tire pinch
// (the sweep envelope rises again past x = 40"), and the rider's feet only need ~12" inside, so the hull can keep converging toward a bow. The family:
// a convergent curvature pulse (peak K, trapezoid ramps), optionally followed by an equal-peak REVERSE pulse of relative length `lam` (0 = no reverse curvature,
// 1 = the D-45 S-curve), then a straight bow run of fixed x extent that ends at the front transom with heading -tau. For a fixed bow width the one free
// parameter `lam` is the smallest value for which the outer face still clears the tire sweep, which is the smallest peak curvature (largest radius) that works.

/** Ramp fraction of each curvature pulse: curvature ramps over the first and last quarter of the pulse (same trapezoid as the D-45 curve). */
const BOW_RAMP = 0.25;
const BOW_N = 240;
/** Largest peak heading the bow family searches (rad). */
const MAX_HEADING = (80 * Math.PI) / 180;
/** Heading integral of a unit-peak trapezoid curvature pulse on [0, 1]. */
function pulseHeading(u: number): number {
  const r = BOW_RAMP;
  if (u <= r) return (u * u) / (2 * r);
  if (u <= 1 - r) return r / 2 + (u - r);
  return 1 - r - ((1 - u) * (1 - u)) / (2 * r);
}
const HMID: number[] = Array.from({ length: BOW_N }, (_, i) => pulseHeading((i + 0.5) / BOW_N));

/** Mean cos / sin of the heading theta0 + sign * phi * h(u) over u in [0, 1]. */
function pulseSums(theta0: number, sign: 1 | -1, phi: number): { c: number; s: number } {
  let c = 0, s = 0;
  for (let i = 0; i < BOW_N; i++) {
    const th = theta0 + sign * phi * HMID[i];
    c += Math.cos(th);
    s += Math.sin(th);
  }
  return { c: c / BOW_N, s: s / BOW_N };
}

export interface BowSpec {
  /** Start of the curve (tangent to the cabin side) and the centerline half width there. */
  x0: number;
  yA: number;
  /** Where the side ends (the front transom's inner face) and the centerline half width there. */
  xT: number;
  yT: number;
  /** Horizontal extent of the straight bow run before xT (the scarf zone: the curved part ends xT - straightIn). */
  straightIn: number;
}

interface BowSolution {
  phi: number;
  S1: number;
  tau: number;
  /** Horizontal and narrowing extent of the curved part. */
  X: number;
  Y: number;
}

/** Solve the bow family for a reverse-pulse length `lam` (null when the narrowing cannot be reached below the heading limit). */
function bowSolve(spec: BowSpec, lam: number): BowSolution | null {
  const dx = spec.xT - spec.x0, dy = spec.yA - spec.yT;
  const Xt = dx - spec.straightIn;
  if (Xt <= 1e-6 || dy <= 1e-9) return null;
  const R = BOW_RAMP;
  const ev = (phi: number) => {
    const a = pulseSums(0, 1, phi);
    const th1 = phi * (1 - R);
    const b = lam > 0 ? pulseSums(th1, -1, lam * phi) : { c: 0, s: 0 };
    const S1 = Xt / (a.c + lam * b.c);
    const tau = th1 * (1 - lam);
    const Yc = S1 * (a.s + lam * b.s);
    return { S1, tau, Yc, Y: Yc + spec.straightIn * Math.tan(tau) };
  };
  const phiMax = MAX_HEADING / (1 - R);
  if (ev(phiMax).Y < dy) return null;
  let lo = 1e-9, hi = phiMax;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (ev(mid).Y < dy) lo = mid; else hi = mid;
  }
  const phi = (lo + hi) / 2;
  const e = ev(phi);
  return { phi, S1: e.S1, tau: e.tau, X: Xt, Y: e.Yc };
}

/** The bow curve for a given reverse-pulse length (0 = fully convex, toward 1 = the D-45 S-curve); null when it cannot be built. */
export function bowCurveWithLambda(spec: BowSpec, lam: number): PlanCurve | null {
  const sol = bowSolve(spec, lam);
  if (!sol) return null;
  const R = BOW_RAMP;
  const { phi, S1, tau } = sol;
  const S2 = lam * S1;
  const th1 = phi * (1 - R);
  const pts: Vec2[] = [[spec.x0, spec.yA]];
  let x = spec.x0, y = spec.yA;
  const chords = (S: number) => Math.max(6, Math.round((BOW_SAMPLES * S) / (S1 + S2)));
  const run = (S: number, theta0: number, sign: 1 | -1, ph: number, n: number) => {
    const SUB = 16;
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < SUB; k++) {
        const u = (j + (k + 0.5) / SUB) / n;
        const th = theta0 + sign * ph * pulseHeading(u);
        x += (Math.cos(th) * S) / (n * SUB);
        y -= (Math.sin(th) * S) / (n * SUB);
      }
      pts.push([x, y]);
    }
  };
  run(S1, 0, 1, phi, chords(S1));
  if (lam > 1e-6) run(S2, th1, -1, lam * phi, Math.max(4, chords(S2)));
  // Exact end of the curved part (the integration drifts by rounding only).
  const x1 = spec.xT - spec.straightIn;
  pts[pts.length - 1] = [x1, spec.yT + spec.straightIn * Math.tan(tau)];
  return {
    x0: spec.x0, x1, yA: spec.yA, yB: pts[pts.length - 1][1], pts, minRadius: S1 / phi, length: S1 + S2, peakHeading: th1,
    endSlope: -Math.tan(tau), reverseFrac: lam,
  };
}
const BOW_SAMPLES = 40;

export interface BowFit {
  curve: PlanCurve;
  /** Reverse-pulse length that was needed (0 = the bow never turns back). */
  lambda: number;
  /** False when even the most reversed curve the family allows does not clear the tire sweep (the curve returned is that best effort). */
  feasible: boolean;
}

const bowFitCache = new Map<string, BowFit>();
const BOW_FIT_MARGIN_IN = 0.005;

/**
 * The gentlest bow curve whose OUTER face (centerline + side/2) clears the left tire sweep by `clearance` at every steering angle: the smallest reverse-pulse
 * length that works (a scan, then bisection), which is the largest bend radius. The hull outline is tested from the curve start to the front transom.
 */
export function fitBowCurve(spec: BowSpec, tires: TireSweepSpec, side: number, clearance: number): BowFit {
  const clearanceIn = clearance;
  const a = tires.ack;
  const key = [spec.x0, spec.yA, spec.xT, spec.yT, spec.straightIn, side, clearanceIn, tires.tireWidth, tires.wheelDiameter,
    [a.kx, a.lead, a.scrub, a.kpHalf, a.armLen, a.armAngleDeg, a.tieLen, a.towLockInnerDeg].join(',')].join('|');
  const hit = bowFitCache.get(key);
  if (hit) return hit;
  const polys = leftTirePolys(tires);
  const gapOf = (lam: number): { c: PlanCurve; gap: number } | null => {
    const c = bowCurveWithLambda(spec, lam);
    if (!c) return null;
    const outline = sidePolyline(c, side / 2, spec.x0 - 0.5, spec.xT);
    return { c, gap: minGapToTires(outline, polys) };
  };
  // The outline is sampled (every 0.2"), the finger analysis measures exact segment distances: a few thousandths of margin keeps the two rules consistent.
  clearance += BOW_FIT_MARGIN_IN;
  const N = 40, LAM_MAX = 0.98;
  let prev = -1;
  let best: BowFit | null = null;
  let lastOk: { lam: number; c: PlanCurve } | null = null;
  for (let i = 0; i <= N; i++) {
    const lam = (LAM_MAX * i) / N;
    const g = gapOf(lam);
    if (!g) continue;
    lastOk = { lam, c: g.c };
    if (g.gap >= clearance - 1e-9) {
      let lo = prev >= 0 ? (LAM_MAX * prev) / N : lam, hi = lam;
      let cur = g.c;
      if (prev >= 0) {
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2;
          const gm = gapOf(mid);
          if (gm && gm.gap >= clearance - 1e-9) { hi = mid; cur = gm.c; } else lo = mid;
        }
      }
      best = { curve: cur, lambda: hi, feasible: true };
      break;
    }
    prev = i;
  }
  if (!best) {
    const fb = lastOk ?? (() => { const c = bowCurveWithLambda(spec, 0); return c ? { lam: 0, c } : null; })();
    best = fb
      ? { curve: fb.c, lambda: fb.lam, feasible: false }
      : { curve: { x0: spec.x0, x1: spec.xT - spec.straightIn, yA: spec.yA, yB: spec.yT, pts: [[spec.x0, spec.yA], [spec.xT - spec.straightIn, spec.yT]], minRadius: Infinity, length: spec.xT - spec.x0, peakHeading: 0 }, lambda: 0, feasible: false };
  }
  if (bowFitCache.size > 1500) bowFitCache.clear();
  bowFitCache.set(key, best);
  return best;
}

/**
 * Polyline of the side offset `d` inches OUTWARD from the centerline (negative = inward), covering x in [xa, xb]: the straight cabin
 * side before the curve, the curve, and the straight nose side after it. Ends are clipped exactly at xa and xb.
 */
export function sidePolyline(c: PlanCurve, d: number, xa: number, xb: number): Vec2[] {
  const lead = Math.min(xa, c.x0) - 1;
  const tail = Math.max(xb, c.x1) + 1;
  const center: Vec2[] = [[lead, c.yA], ...c.pts, [tail, c.yB + (c.endSlope ?? 0) * (tail - c.x1)]];
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

/** Centerline half width at x (constant before the start; after the end constant, or the straight bow run when `endSlope` is set). */
export function curveCenterY(c: PlanCurve, x: number): number {
  if (x <= c.x0) return c.yA;
  if (x >= c.x1) return c.yB + (c.endSlope ?? 0) * (x - c.x1);
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

/** Heading (rad from +x) of the centerline at x; 0 before the curve, the bow run's heading after it. */
export function curveHeading(c: PlanCurve, x: number): number {
  if (x >= c.x1) return Math.atan(c.endSlope ?? 0);
  if (x <= c.x0) return 0;
  for (let i = 1; i < c.pts.length; i++) {
    if (c.pts[i][0] >= x) return Math.atan2(c.pts[i][1] - c.pts[i - 1][1], c.pts[i][0] - c.pts[i - 1][0]);
  }
  return 0;
}

// ── Front-tire sweep and clearance ──

export interface TireSweepSpec {
  tireWidth: number;
  wheelDiameter: number;
  /**
   * Ackermann spec (D-53): the sweep is per wheel - the left tire rectangle is rotated about the LEFT kingpin by the solved left-knuckle angle (wheel center at
   * (-lead, +scrub) in the knuckle frame) for the inner-wheel input from -tow lock to +tow lock.
   */
  ack: AckSpec;
}

/** Plan rectangles of the LEFT front tire at every degree of steering from −lock to +lock (rotated about its own kingpin by the solved knuckle angle). */
const polyCache = new Map<string, Vec2[][]>();
export function leftTirePolys(t: TireSweepSpec, stepDeg = 1): Vec2[][] {
  const a = t.ack;
  const key = [t.tireWidth, t.wheelDiameter, stepDeg, a.kx, a.lead, a.scrub, a.kpHalf, a.armLen, a.armAngleDeg, a.tieLen, a.towLockInnerDeg].join('|');
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
  const a = t.ack;
  const lock = a.towLockInnerDeg;
  // Input d runs -inner..+inner, so the left-knuckle angle covers leftWheelRange(a) = -outer..+inner at the tow lock.
  for (let d = -lock; d <= lock + 1e-9; d += stepDeg) {
    const sol = solveSteer(a, d);
    const th = (sol.leftDeg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    out.push(([[-r, -hw], [r, -hw], [r, hw], [-r, hw]] as Vec2[]).map(([dx, dy]) => {
      const x = -a.lead + dx, y = a.scrub + dy;
      return [a.kx + c * x - s * y, a.kpHalf + s * x + c * y] as Vec2;
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

/**
 * x range of the hull outline (a polyline sampled every `ds` inches) that lies within `gapMin` of a tire rectangle at some steering angle, or null
 * when nothing does. This is the finger-pinch zone (D-37); the Ackermann hull starts its sheer rise beyond it.
 */
export function hazardRangeX(outline: Vec2[], polys: Vec2[][], gapMin: number, ds = 0.25): [number, number] | null {
  const bbs = polys.map((q) => [Math.min(...q.map((v) => v[0])), Math.max(...q.map((v) => v[0])), Math.min(...q.map((v) => v[1])), Math.max(...q.map((v) => v[1]))]);
  let x0 = Infinity, x1 = -Infinity;
  const near = (x: number, y: number): boolean => {
    for (let k = 0; k < polys.length; k++) {
      const b = bbs[k];
      if (x < b[0] - gapMin || x > b[1] + gapMin || y < b[2] - gapMin || y > b[3] + gapMin) continue;
      const q = polys[k];
      let inside = true;
      for (let i = 0; i < 4 && inside; i++) {
        const a = q[i], bb = q[(i + 1) % 4];
        if ((bb[0] - a[0]) * (y - a[1]) - (bb[1] - a[1]) * (x - a[0]) < 0) inside = false;
      }
      if (inside) return true;
      for (let i = 0; i < 4; i++) if (pointSegDist(x, y, q[i], q[(i + 1) % 4]) < gapMin) return true;
    }
    return false;
  };
  for (let i = 0; i + 1 < outline.length; i++) {
    const a = outline[i], b = outline[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / ds));
    for (let j = 0; j <= n; j++) {
      const x = a[0] + ((b[0] - a[0]) * j) / n, y = a[1] + ((b[1] - a[1]) * j) / n;
      if (near(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    }
  }
  return x1 >= x0 ? [x0, x1] : null;
}

/** The innermost point of the tire sweep (smallest |y| over all the rectangles): where the hull has to squeeze past, and the rule width there is 2 x (y - clearance). */
export function sweepPinch(polys: Vec2[][]): { x: number; y: number } {
  let best = { x: 0, y: Infinity };
  for (const q of polys) for (const [x, y] of q) if (y < best.y) best = { x, y };
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
