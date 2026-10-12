/**
 * Binary STL for the printed parts (Phase 4, output 9): the two ASA lamp clips (`lamp-clip`, `rear-lamp-clip`), which are `fab: 'print'` extrusions. Plain TS, no three.js.
 *
 * The part's local frame is kept: the outline lies in XY and is extruded along +Z from 0 to `depth`; units are millimeters (the model is in inches). The clips have no holes (the heat-set
 * insert holes are drilled by the printer's own pilot geometry or by hand, and are not in the model), but holes are supported: they are bridged into the outline before ear clipping.
 * Every triangle is wound counter-clockwise seen from outside, and its stored normal is the cross product of its edges (so the two always agree).
 */
import type { Part, Vec2 } from '../model/types';

export const MM_PER_IN = 25.4;

const signedArea = (o: Vec2[]): number => {
  let a = 0;
  for (let i = 0; i < o.length; i++) { const [x0, y0] = o[i], [x1, y1] = o[(i + 1) % o.length]; a += x0 * y1 - x1 * y0; }
  return a / 2;
};
const ccw = (o: Vec2[]): Vec2[] => (signedArea(o) < 0 ? [...o].reverse() : [...o]);
const cw = (o: Vec2[]): Vec2[] => (signedArea(o) > 0 ? [...o].reverse() : [...o]);
const cross = (a: Vec2, b: Vec2, c: Vec2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const EPS = 1e-12;

/** Drop repeated points and (near) collinear vertices from a closed loop. */
function clean(loop: Vec2[]): Vec2[] {
  let pts = loop.filter((q, i) => { const n = loop[(i + 1) % loop.length]; return Math.hypot(q[0] - n[0], q[1] - n[1]) > 1e-9; });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      if (Math.abs(cross(a, b, c)) < EPS && (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) > 0) { pts = pts.filter((_, k) => k !== i); changed = true; break; }
    }
  }
  return pts;
}

const properlyCross = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean => {
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
};

function insideLoop(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Bridge a hole (CW) into the polygon (CCW): the closest pair of vertices whose connecting segment crosses no edge and runs inside the polygon. */
function bridge(poly: Vec2[], hole: Vec2[]): Vec2[] {
  const edges: Array<[Vec2, Vec2]> = [];
  for (const loop of [poly, hole]) for (let i = 0; i < loop.length; i++) edges.push([loop[i], loop[(i + 1) % loop.length]]);
  let best: { d: number; i: number; k: number } | null = null;
  for (let k = 0; k < hole.length; k++) for (let i = 0; i < poly.length; i++) {
    const d = Math.hypot(hole[k][0] - poly[i][0], hole[k][1] - poly[i][1]);
    if (best && d >= best.d) continue;
    const m: Vec2 = [(hole[k][0] + poly[i][0]) / 2, (hole[k][1] + poly[i][1]) / 2];
    if (!insideLoop(m, poly) || insideLoop(m, hole)) continue;
    if (edges.some(([a, b]) => properlyCross(hole[k], poly[i], a, b))) continue;
    best = { d, i, k };
  }
  if (!best) throw new Error('stl: cannot bridge a hole into the outline');
  const { i, k } = best;
  const around = [...hole.slice(k), ...hole.slice(0, k), hole[k]];
  return [...poly.slice(0, i + 1), ...around, ...poly.slice(i)];
}

/** Ear-clip a simple CCW polygon (it may repeat vertices where holes were bridged): triangles as triples of points. */
function earClip(poly: Vec2[]): Array<[Vec2, Vec2, Vec2]> {
  const idx = poly.map((_, i) => i);
  const out: Array<[Vec2, Vec2, Vec2]> = [];
  const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12;
  const inTri = (p: Vec2, a: Vec2, b: Vec2, c: Vec2) => cross(a, b, p) >= -EPS && cross(b, c, p) >= -EPS && cross(c, a, p) >= -EPS;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    const n = idx.length;
    let clipped = false;
    for (let pass = 0; pass < 2 && !clipped; pass++) {
      for (let k = 0; k < n; k++) {
        const ia = idx[(k + n - 1) % n], ib = idx[k], ic = idx[(k + 1) % n];
        const a = poly[ia], b = poly[ib], c = poly[ic];
        const area = cross(a, b, c);
        if (area < (pass === 0 ? EPS : -EPS)) continue; // reflex (pass 0) or worse than flat (pass 1: clip degenerate slivers to make progress)
        if (pass === 0 && idx.some((j) => j !== ia && j !== ib && j !== ic && !same(poly[j], a) && !same(poly[j], b) && !same(poly[j], c) && inTri(poly[j], a, b, c))) continue;
        if (area > EPS) out.push([a, b, c]);
        idx.splice(k, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) throw new Error('stl: ear clipping stalled (the outline is not a simple polygon)');
  }
  if (idx.length === 3 && cross(poly[idx[0]], poly[idx[1]], poly[idx[2]]) > EPS) out.push([poly[idx[0]], poly[idx[1]], poly[idx[2]]]);
  return out;
}

/** Triangulate an outline with optional holes (any orientation in, triangles CCW out). */
export function triangulate(outline: Vec2[], holes: Vec2[][] = []): Array<[Vec2, Vec2, Vec2]> {
  let poly = ccw(clean(outline));
  const hs = holes.map((h) => cw(clean(h))).sort((a, b) => Math.max(...b.map((q) => q[0])) - Math.max(...a.map((q) => q[0])));
  for (const h of hs) poly = bridge(poly, h);
  return earClip(poly);
}

/** The triangles (each three [x, y, z] in mm, CCW seen from outside) of the extruded part: the bottom cap at z = 0, the top cap at z = depth, and the walls of the outline and the holes. */
export function extrusionTriangles(part: Part): number[][][] {
  const g = part.geometry;
  if (g.type !== 'extrusion') throw new Error(`stl: ${part.id} is not an extrusion`);
  const k = MM_PER_IN;
  const z1 = g.depth * k;
  const tris: number[][][] = [];
  for (const [a, b, c] of triangulate(g.outline, g.holes ?? [])) {
    const p = [a, b, c].map(([x, y]) => [x * k, y * k]);
    tris.push([[p[0][0], p[0][1], z1], [p[1][0], p[1][1], z1], [p[2][0], p[2][1], z1]]); // top: CCW seen from +z
    tris.push([[p[0][0], p[0][1], 0], [p[2][0], p[2][1], 0], [p[1][0], p[1][1], 0]]); // bottom: reversed
  }
  const loops = [ccw(clean(g.outline)), ...(g.holes ?? []).map((h) => cw(clean(h)))];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const [ax, ay] = loop[i], [bx, by] = loop[(i + 1) % loop.length];
      const a0 = [ax * k, ay * k, 0], b0 = [bx * k, by * k, 0], b1 = [bx * k, by * k, z1], a1 = [ax * k, ay * k, z1];
      tris.push([a0, b0, b1], [a0, b1, a1]);
    }
  }
  return tris;
}

const sub = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossV = (a: number[], b: number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Binary STL (little endian): 80 byte header, triangle count, then normal, three vertices and a zero attribute per triangle. Millimeters. */
export function stlFromExtrusion(part: Part): Uint8Array {
  const tris = extrusionTriangles(part);
  const out = new Uint8Array(84 + 50 * tris.length);
  const dv = new DataView(out.buffer);
  const header = `Klondike sled ${part.id} (${part.name}), mm, local frame`;
  for (let i = 0; i < Math.min(80, header.length); i++) out[i] = header.charCodeAt(i) & 0x7f;
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const [a, b, c] of tris) {
    const n = crossV(sub(b, a), sub(c, a));
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const v of [[n[0] / l, n[1] / l, n[2] / l], a, b, c]) for (const x of v) { dv.setFloat32(o, x, true); o += 4; }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return out;
}

/** Read a binary STL back: the triangle count, the enclosed volume (mm3, positive when outward-wound) and whether every stored normal agrees with its winding. */
export function stlStats(bytes: Uint8Array): { triangles: number; volumeMm3: number; normalsMatchWinding: boolean; bounds: { min: number[]; max: number[] } } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  let vol = 0, ok = true;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) {
    const o = 84 + 50 * t;
    const f = (i: number) => dv.getFloat32(o + 4 * i, true);
    const nrm = [f(0), f(1), f(2)], a = [f(3), f(4), f(5)], b = [f(6), f(7), f(8)], c = [f(9), f(10), f(11)];
    for (const v of [a, b, c]) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]); }
    const cr = crossV(sub(b, a), sub(c, a));
    if (cr[0] * nrm[0] + cr[1] * nrm[1] + cr[2] * nrm[2] <= 0) ok = false;
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return { triangles: n, volumeMm3: vol, normalsMatchWinding: ok, bounds: { min, max } };
}

/** The two printed lamp clips of the model, as `[part, binary STL]` pairs (ids `lamp-clip` and `rear-lamp-clip`). */
export function lampClipStls(parts: Part[]): Array<{ part: Part; fileName: string; stl: Uint8Array }> {
  return parts.filter((x) => x.fab === 'print' && x.geometry.type === 'extrusion').map((part) => ({ part, fileName: `${part.id}.stl`, stl: stlFromExtrusion(part) }));
}
