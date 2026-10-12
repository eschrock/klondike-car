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

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const inTri = (p: Vec2, a: Vec2, b: Vec2, c: Vec2) => cross(a, b, p) > 1e-9 && cross(b, c, p) > 1e-9 && cross(c, a, p) > 1e-9;

/** Ear-clipping triangulation of a simple polygon given counter-clockwise; returns triangle index triples into `poly`. Handles collinear vertices (zero-area ears are clipped). */
export function earClip(poly: Vec2[]): number[] {
  const n = poly.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  const tris: number[] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10 * n * n) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      const cr = cross(a, b, c);
      if (cr < -1e-12) continue; // reflex
      let ok = true;
      if (cr > 1e-12) for (const j of idx) { if (j === i0 || j === i1 || j === i2) continue; if (inTri(poly[j], a, b, c)) { ok = false; break; } }
      if (!ok) continue;
      if (cr > 1e-12) tris.push(i0, i1, i2);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) idx.splice(0, 1); // degenerate input: drop a vertex rather than loop forever
  }
  if (idx.length === 3 && cross(poly[idx[0]], poly[idx[1]], poly[idx[2]]) > 1e-12) tris.push(idx[0], idx[1], idx[2]);
  return tris;
}

const signedArea = (o: Vec2[]) => o.reduce((s, q, i) => s + (q[0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * q[1]), 0) / 2;

/** Area (in²) of a polygon. */
export const outlineArea = (o: Vec2[]): number => Math.abs(signedArea(o));

/**
 * A wall of thickness `t` whose centerline is at y = `yc(x)` (model frame) on the outline `outline` (x, z). The outer face (y = yc + t/2 for a left member) faces +y; pass a
 * `yc` that already includes the side sign. `maxSeg` is the finest edge subdivision (in).
 */
export function planWallGeometry(outline: Vec2[], t: number, yc: (x: number) => number, maxSeg = 1.5): Geometry {
  let o = subdivide(outline, maxSeg);
  if (signedArea(o) < 0) o = [...o].reverse();
  const n = o.length;
  const positions: number[] = [];
  for (const [x, z] of o) positions.push(x, yc(x) + t / 2, z); // face +y: 0..n-1
  for (const [x, z] of o) positions.push(x, yc(x) - t / 2, z); // face -y: n..2n-1
  const tris = earClip(o);
  const indices: number[] = [];
  // CCW in (x, z) faces -y (see the cross product of (1,0,0) and (0,0,1)); the +y face is reversed.
  for (let k = 0; k < tris.length; k += 3) {
    indices.push(n + tris[k], n + tris[k + 1], n + tris[k + 2]);
    indices.push(tris[k], tris[k + 2], tris[k + 1]);
  }
  // Rim: one quad per outline edge, outward normal (in the x-z plane, the outline is CCW so outward is to the right of the edge).
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, n + j, n + i, i, j, n + j);
  }
  return { type: 'mesh', positions, indices, slabs: 1.25, thickness: t, profile: o };
}
