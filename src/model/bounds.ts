/**
 * Oriented bounding boxes for Parts, plus a separating-axis overlap test.
 * Used by the overlap/clearance tests, the truck-fit check and mass.ts.
 * Plain math, no three.js.
 */
import type { Geometry, Mat4, Part, Vec3 } from './types';

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
