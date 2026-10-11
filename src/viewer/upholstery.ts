import type { Vec3 } from '../model/types';

/**
 * Welt (piping) and stitching for upholstered parts (review r1 MUST 5). Plain arrays, no three.js, so it runs headless.
 * A tube is swept along a polyline; every vertex carries a color so one vinyl material can show a darker thread / groove
 * (vertex color multiplies the material color) and the pillow itself stays white.
 */
export interface TubeMesh {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

export type Vec2 = [number, number];

/** Signed area of a polygon (positive = counter-clockwise). */
export function polyArea(pts: ArrayLike<Vec2>): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Offsets a closed polygon inward by `d` (miter at each vertex; fine for the rounded rectangles used here). */
export function insetLoop(pts: Vec2[], d: number): Vec2[] {
  const n = pts.length;
  const ccw = polyArea(pts) > 0;
  const out: Vec2[] = [];
  const edgeN = (a: Vec2, b: Vec2): Vec2 => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return ccw ? [dy / l, -dx / l] : [-dy / l, dx / l]; // outward
  };
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const n1 = edgeN(pts[(i + n - 1) % n], p);
    const n2 = edgeN(p, pts[(i + 1) % n]);
    const mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    if (k < 1e-6) { out.push([p[0] - n1[0] * d, p[1] - n1[1] * d]); continue; }
    out.push([p[0] - (mx / k) * d, p[1] - (my / k) * d]);
  }
  return out;
}

/** Rounded rectangle (counter-clockwise), `seg` segments per corner. */
export function roundedLoop(hx: number, hy: number, r: number, seg = 6): Vec2[] {
  const rr = Math.max(1e-3, Math.min(r, hx, hy));
  const out: Vec2[] = [];
  const corners: [number, number, number][] = [[hx - rr, hy - rr, 0], [-hx + rr, hy - rr, Math.PI / 2], [-hx + rr, -hy + rr, Math.PI], [hx - rr, -hy + rr, 1.5 * Math.PI]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  }
  return out;
}

/** A tube of `radius` along a polyline; `closed` joins the last point to the first. Open ends are left uncapped. */
export function tubeAlong(path: Vec3[], radius: number, color: number, closed: boolean, radial = 6): TubeMesh {
  const out: TubeMesh = { positions: [], normals: [], colors: [], indices: [] };
  const n = path.length;
  if (n < 2) return out;
  const rings = closed ? n : n;
  // Frame: tangent from neighbors; a fixed reference vector keeps the cross-section from twisting.
  const tangent = (i: number): Vec3 => {
    const a = path[closed ? (i + n - 1) % n : Math.max(0, i - 1)];
    const b = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const t: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...t) || 1;
    return [t[0] / l, t[1] / l, t[2] / l];
  };
  for (let i = 0; i < rings; i++) {
    const t = tangent(i);
    const ref: Vec3 = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u: Vec3 = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]];
    const ul = Math.hypot(...u) || 1;
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const v: Vec3 = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const nrm: Vec3 = [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s];
      out.positions.push(path[i][0] + nrm[0] * radius, path[i][1] + nrm[1] * radius, path[i][2] + nrm[2] * radius);
      out.normals.push(...nrm);
      out.colors.push((color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255);
    }
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const i1 = (i + 1) % n;
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      const a = i * radial + j, b = i1 * radial + j, c = i1 * radial + j1, d = i * radial + j1;
      out.indices.push(a, b, c, a, c, d);
    }
  }
  return out;
}

/** Splits a closed loop into dashes of about `dash` length separated by gaps of the same size (a stitched seam). */
export function dashedLoop(loop: Vec3[], dash: number): Vec3[][] {
  const out: Vec3[][] = [];
  const n = loop.length;
  let acc = 0;
  let cur: Vec3[] = [];
  let on = true;
  for (let i = 0; i <= n; i++) {
    const p = loop[i % n];
    const q = loop[(i + 1) % n];
    if (on) cur.push(p);
    acc += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    if (acc >= dash) {
      if (on && cur.length >= 1) {
        cur.push(q);
        out.push(cur);
      }
      cur = [];
      on = !on;
      acc = 0;
    }
  }
  return out;
}

/** Resamples a closed polyline so no segment is longer than `maxLen` (keeps dashes from skipping long edges). */
export function densify(loop: Vec3[], maxLen: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    const k = Math.max(1, Math.ceil(l / maxLen));
    for (let j = 0; j < k; j++) out.push([p[0] + ((q[0] - p[0]) * j) / k, p[1] + ((q[1] - p[1]) * j) / k, p[2] + ((q[2] - p[2]) * j) / k]);
  }
  return out;
}

export function mergeTubes(list: TubeMesh[]): TubeMesh {
  const out: TubeMesh = { positions: [], normals: [], colors: [], indices: [] };
  for (const t of list) {
    const base = out.positions.length / 3;
    for (const x of t.positions) out.positions.push(x);
    for (const x of t.normals) out.normals.push(x);
    for (const x of t.colors) out.colors.push(x);
    for (const i of t.indices) out.indices.push(i + base);
  }
  return out;
}
