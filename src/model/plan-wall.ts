/**
 * Plan-curved vertical members (D-57): the chine, web, gunwale and front rails stand on a vertical outline in the x-z plane (the sheer, the step of a rail, ...) but their
 * face follows the hull's plan curve, so the part is a wall of constant thickness `t` whose centerline is at y = `yc(x)`. This builds that wall as a triangle mesh in the
 * MODEL frame (the part transform is the identity): two faces from an ear-clipped outline and a ring of side walls. Plain math, no three.js.
 */
import type { Geometry, Vec2 } from './types';

/** Split every outline edge into pieces no longer than `maxLen` so the faces can follow a plan curve between the original vertices. */
export function subdivide(outline: Vec2[], maxLen = 1.5): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxLen));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

const signedArea = (o: Vec2[]) => o.reduce((s, q, i) => s + (q[0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * q[1]), 0) / 2;

/** Area (in²) of a polygon. */
export const outlineArea = (o: Vec2[]): number => Math.abs(signedArea(o));

/**
 * Triangulate a simple polygon (x, z) as vertical trapezoids: cut at every distinct vertex x, and between two neighboring cuts pair up the edges that span the whole strip
 * (even-odd) so each pair bounds one trapezoid. Every corner is a point on an outline edge, so the triangles are short in x (at most the subdivision length) and, because the wall
 * face is y = yc(x), they stay on the curved face to within a few thousandths of an inch. (The earlier ear-clipping produced long skinny fans across the whole side: twisted
 * facets and wrong normals in the viewer, Phase 3c-5.) Returns counter-clockwise triangles, each three (x, z) points.
 */
export function trapezoidTriangles(poly: Vec2[]): Vec2[][] {
  const n = poly.length;
  const xs = [...new Set(poly.map((q) => q[0]))].sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > 1e-9);
  const out: Vec2[][] = [];
  for (let k = 0; k + 1 < xs.length; k++) {
    const xa = xs[k], xb = xs[k + 1], xm = (xa + xb) / 2;
    const zAt = (a: Vec2, b: Vec2, x: number) => a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    const spans: { m: number; za: number; zb: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      if (Math.abs(b[0] - a[0]) < 1e-9 || Math.min(a[0], b[0]) > xm || Math.max(a[0], b[0]) < xm) continue;
      spans.push({ m: zAt(a, b, xm), za: zAt(a, b, xa), zb: zAt(a, b, xb) });
    }
    spans.sort((u, v) => u.m - v.m);
    for (let j = 0; j + 1 < spans.length; j += 2) {
      const lo = spans[j], hi = spans[j + 1];
      const A: Vec2 = [xa, lo.za], B: Vec2 = [xb, lo.zb], C: Vec2 = [xb, hi.zb], D: Vec2 = [xa, hi.za];
      const hL = hi.za - lo.za, hR = hi.zb - lo.zb; // an end of zero height makes the trapezoid a triangle
      if (hL > 1e-9 && hR > 1e-9) out.push([A, B, C], [A, C, D]);
      else if (hR > 1e-9) out.push([A, B, C]);
      else if (hL > 1e-9) out.push([A, B, D]);
    }
  }
  return out;
}

/**
 * A wall of thickness `t` whose centerline is at y = `yc(x)` (model frame) on the outline `outline` (x, z). The outer face (y = yc + t/2 for a left member) faces +y; pass a
 * `yc` that already includes the side sign. `maxSeg` is the finest edge subdivision (in).
 */
export function planWallGeometry(outline: Vec2[], t: number, yc: (x: number) => number, maxSeg = 1.5, grainFollowsTop = false): Geometry {
  let o = subdivide(outline, maxSeg);
  if (signedArea(o) < 0) o = [...o].reverse();
  const n = o.length;
  const positions: number[] = [];
  const indices: number[] = [];
  // Face vertices are shared by (x, z) so neighboring trapezoids join without cracks.
  const index = new Map<string, number>();
  const faceVert = (x: number, z: number, sgn: 1 | -1): number => {
    const key = `${sgn}|${x.toFixed(6)}|${z.toFixed(6)}`;
    let i = index.get(key);
    if (i === undefined) { i = positions.length / 3; positions.push(x, yc(x) + (sgn * t) / 2, z); index.set(key, i); }
    return i;
  };
  // CCW in (x, z) faces -y (see the cross product of (1,0,0) and (0,0,1)); the +y face is reversed.
  for (const [a, b, c] of trapezoidTriangles(o)) {
    indices.push(faceVert(a[0], a[1], -1), faceVert(b[0], b[1], -1), faceVert(c[0], c[1], -1));
    indices.push(faceVert(a[0], a[1], 1), faceVert(c[0], c[1], 1), faceVert(b[0], b[1], 1));
  }
  // Rim: one quad per outline edge, outward normal (in the x-z plane, the outline is CCW so outward is to the right of the edge).
  const rim0 = positions.length / 3;
  for (const [x, z] of o) positions.push(x, yc(x) + t / 2, z); // rim +y: rim0 .. rim0+n-1
  for (const [x, z] of o) positions.push(x, yc(x) - t / 2, z); // rim -y: rim0+n .. rim0+2n-1
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(rim0 + i, rim0 + n + j, rim0 + n + i, rim0 + i, rim0 + j, rim0 + n + j);
  }
  return { type: 'mesh', positions, indices, slabs: 0.4, thickness: t, profile: o, ...(grainFollowsTop ? { grainFollowsTop } : {}) };
}
