/**
 * A tiny headless 3D drawing for the step figures: boxes and lofted solids, shaded flat and drawn back to front (the painter's algorithm), in a parallel
 * projection. Plain TS, no DOM, no three.js, so the build book can print a picture of a jig the way the 3D view shows it. Big flat faces are cut into tiles
 * so a long rib and a short cleat sort sensibly; the tiles are filled seamlessly. Coordinates are inches: x along the web (rear to bow), y up, z toward the viewer.
 */
import type { Vec2 } from '../../model/types';
import { Fig } from './kit';

export type V3 = [number, number, number];

interface Face { p: V3[]; n: V3; color: string; opacity: number; edge: boolean }

/** How a solid is drawn. */
export interface SolidStyle {
  /** Base color, `#rrggbb`. */
  color: string;
  /** 1 (default) is opaque; a lower value lets what is behind show through (a cap drawn over its ribs). */
  opacity?: number;
  /** Draw a thin outline on the small faces (default true). */
  edge?: boolean;
}

/** A solid swept along x: at each x the section is the rectangle z in [zLo, zHi], y in [yb, yt]. */
export interface Sweep {
  xs: number[];
  zLo: (x: number) => number;
  zHi: (x: number) => number;
  yb: (x: number) => number;
  yt: (x: number) => number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mean = (ps: V3[]): V3 => [ps.reduce((s, q) => s + q[0], 0) / ps.length, ps.reduce((s, q) => s + q[1], 0) / ps.length, ps.reduce((s, q) => s + q[2], 0) / ps.length];

/** The light, from above, the viewer's side and the rear. */
const LIGHT = norm([-0.45, 0.8, 0.4]);
/** The longest edge (in) a face may have before it is cut into tiles. */
const TILE_IN = 5;

function shade(hex: string, b: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * b)));
  return `#${[c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export class Solids {
  private faces: Face[] = [];

  /** An outward face: `ref` is a point inside the solid, to orient the normal. */
  private quad(a: V3, b: V3, c: V3, d: V3, ref: V3, st: SolidStyle): void {
    let n = norm(cross(sub(b, a), sub(d, a)));
    if (dot(n, sub(mean([a, b, c, d]), ref)) < 0) n = [-n[0], -n[1], -n[2]];
    const opacity = st.opacity ?? 1;
    const longest = Math.max(Math.hypot(...sub(b, a)), Math.hypot(...sub(c, b)), Math.hypot(...sub(d, c)), Math.hypot(...sub(a, d)));
    if (longest <= TILE_IN) { this.faces.push({ p: [a, b, c, d], n, color: st.color, opacity, edge: st.edge !== false }); return; }
    const nu = Math.max(1, Math.ceil(Math.max(Math.hypot(...sub(b, a)), Math.hypot(...sub(c, d))) / TILE_IN));
    const nv = Math.max(1, Math.ceil(Math.max(Math.hypot(...sub(d, a)), Math.hypot(...sub(c, b))) / TILE_IN));
    const at = (u: number, v: number): V3 => {
      const lo: V3 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
      const hi: V3 = [d[0] + (c[0] - d[0]) * u, d[1] + (c[1] - d[1]) * u, d[2] + (c[2] - d[2]) * u];
      return [lo[0] + (hi[0] - lo[0]) * v, lo[1] + (hi[1] - lo[1]) * v, lo[2] + (hi[2] - lo[2]) * v];
    };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      this.faces.push({ p: [at(i / nu, j / nv), at((i + 1) / nu, j / nv), at((i + 1) / nu, (j + 1) / nv), at(i / nu, (j + 1) / nv)], n, color: st.color, opacity, edge: false });
    }
  }

  /** A box between two corners. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, st: SolidStyle): this {
    return this.sweep({ xs: [x0, x1], zLo: () => Math.min(z0, z1), zHi: () => Math.max(z0, z1), yb: () => y0, yt: () => y1 }, st);
  }

  /** A solid swept along x. */
  sweep(s: Sweep, st: SolidStyle): this {
    const ring = (x: number): V3[] => { const a = s.zLo(x), b = s.zHi(x), y0 = s.yb(x), y1 = s.yt(x); return [[x, y0, a], [x, y1, a], [x, y1, b], [x, y0, b]]; };
    const rings = s.xs.map(ring);
    const centers = rings.map(mean);
    for (let i = 0; i < rings.length - 1; i++) {
      const ref = mean([centers[i], centers[i + 1]]);
      for (let k = 0; k < 4; k++) this.quad(rings[i][k], rings[i][(k + 1) % 4], rings[i + 1][(k + 1) % 4], rings[i + 1][k], ref, st);
    }
    const first = rings[0], last = rings[rings.length - 1];
    this.quad(first[0], first[1], first[2], first[3], centers[1] ?? centers[0], st);
    this.quad(last[0], last[1], last[2], last[3], centers[rings.length - 2] ?? centers[0], st);
    return this;
  }

  /** A vertical prism: the convex outline (x, z pairs) from y0 up to y1 (a cleat standing along the sheer). */
  prism(outline: Vec2[], y0: number, y1: number, st: SolidStyle): this {
    const n = outline.length;
    const cx = outline.reduce((s, q) => s + q[0], 0) / n, cz = outline.reduce((s, q) => s + q[1], 0) / n;
    const ref: V3 = [cx, (y0 + y1) / 2, cz];
    for (let i = 0; i < n; i++) {
      const [ax, az] = outline[i], [bx, bz] = outline[(i + 1) % n];
      this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], ref, st);
    }
    this.quad(...(outline.map(([x, z]): V3 => [x, y1, z]) as [V3, V3, V3, V3]), ref, st);
    this.quad(...(outline.map(([x, z]): V3 => [x, y0, z]) as [V3, V3, V3, V3]), ref, st);
    return this;
  }

  /** The bounds of everything added, for framing. */
  bounds(): { min: V3; max: V3 } {
    const pts = this.faces.flatMap((f) => f.p);
    return { min: [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.min(...pts.map((q) => q[2]))], max: [Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[2]))] };
  }

  /**
   * Draw into `fig`, the scene scaled by `scale` px per inch about its center `at` (px). `yaw` turns the scene about the vertical (0 looks along -z, the web's
   * near side), `pitch` is the camera's height above the horizon, both in degrees. Returns the projection, so a figure can label a point.
   */
  render(fig: Fig, cam: { at: Vec2; scale: number; yaw?: number; pitch?: number; center?: V3; stretchY?: number }): (p: V3) => Vec2 {
    const yaw = ((cam.yaw ?? 28) * Math.PI) / 180, pitch = ((cam.pitch ?? 32) * Math.PI) / 180;
    const bnd = this.bounds();
    const c: V3 = cam.center ?? [(bnd.min[0] + bnd.max[0]) / 2, (bnd.min[1] + bnd.max[1]) / 2, (bnd.min[2] + bnd.max[2]) / 2];
    const sy = cam.stretchY ?? 1;
    const view: V3 = [-Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
    const proj = (p: V3): { s: Vec2; d: number } => {
      const dx = p[0] - c[0], dy = (p[1] - c[1]) * sy, dz = p[2] - c[2];
      const x1 = dx * Math.cos(yaw) + dz * Math.sin(yaw), z1 = -dx * Math.sin(yaw) + dz * Math.cos(yaw);
      return { s: [cam.at[0] + cam.scale * x1, cam.at[1] - cam.scale * (dy * Math.cos(pitch) - z1 * Math.sin(pitch))], d: z1 * Math.cos(pitch) + dy * Math.sin(pitch) };
    };
    const seen = this.faces.filter((f) => dot(f.n, view) > 0.0005).map((f) => ({ f, d: f.p.reduce((s, q) => s + proj(q).d, 0) / f.p.length }));
    seen.sort((a, b) => a.d - b.d);
    for (const { f } of seen) {
      const b = 0.58 + 0.42 * Math.max(0, dot(f.n, LIGHT));
      const fill = shade(f.color, b);
      fig.poly(f.p.map((q) => proj(q).s), { fill, stroke: f.edge ? shade(f.color, b * 0.62) : fill, width: f.edge ? 0.6 : 0.8, ...(f.opacity < 1 ? { opacity: f.opacity } : {}) });
    }
    return (p) => proj(p).s;
  }
}
