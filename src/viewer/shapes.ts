import type { Vec3 } from '../model/types';

/** Plain-array indexed mesh with analytic normals (no three.js, so the bounds can be tested headless). */
export interface RawMesh {
  positions: number[];
  normals: number[];
  indices: number[];
}

/**
 * Axis-aligned box of exactly `size`, centered on the origin, with every edge rounded over by `radius` (D-44). The outer
 * bounds stay exact: the rounding is applied to the surface of the full-size box by pulling each point onto a sphere of
 * `radius` around the inner (inset) box. `arcSegs` quads span each 90-degree corner (per face half: arcSegs / 2);
 * `interior` adds evenly spaced grid lines across the flat middle of each axis (needed to crown an upholstered face).
 */
export function roundedBoxMesh(size: Vec3, radius: number, arcSegs = 4, interior: Vec3 = [0, 0, 0]): RawMesh {
  const half = size.map((s) => s / 2) as Vec3;
  const r = Math.max(1e-4, Math.min(radius, Math.min(...half) * 0.98));
  const m = Math.max(1, Math.round(arcSegs / 2));
  const grids = half.map((h, a) => {
    const core = h - r;
    const g: number[] = [];
    // Arc part on each side: core + r * tan(alpha), alpha = 0..45 degrees (the neighboring face covers the other half).
    for (let j = m; j >= 0; j--) g.push(-(core + r * Math.tan((j / m) * (Math.PI / 4))));
    for (let k = 1; k <= interior[a]; k++) g.push(-core + (2 * core * k) / (interior[a] + 1));
    for (let j = 0; j <= m; j++) g.push(core + r * Math.tan((j / m) * (Math.PI / 4)));
    return g;
  });
  const [gx, gy, gz] = grids;
  const N = [gx.length, gy.length, gz.length];
  const core = half.map((h) => h - r);
  const ids = new Map<number, number>();
  const out: RawMesh = { positions: [], normals: [], indices: [] };
  const vid = (i: number, j: number, k: number): number => {
    const key = (i * N[1] + j) * N[2] + k;
    let id = ids.get(key);
    if (id !== undefined) return id;
    id = out.positions.length / 3;
    ids.set(key, id);
    const p = [gx[i], gy[j], gz[k]];
    const d = p.map((v, a) => v - Math.max(-core[a], Math.min(core[a], v)));
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    for (let a = 0; a < 3; a++) {
      const n = d[a] / len;
      out.normals.push(n);
      out.positions.push(Math.max(-core[a], Math.min(core[a], p[a])) + n * r);
    }
    return id;
  };
  // Six faces; (u, v) are the two other axes, ordered so the quad winding faces outward.
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    for (const side of [0, 1]) {
      const fixed = side === 0 ? 0 : N[axis] - 1;
      for (let a = 0; a < N[u] - 1; a++) {
        for (let b = 0; b < N[v] - 1; b++) {
          const q = (da: number, db: number): number => {
            const idx = [0, 0, 0];
            idx[axis] = fixed;
            idx[u] = a + da;
            idx[v] = b + db;
            return vid(idx[0], idx[1], idx[2]);
          };
          const p00 = q(0, 0), p10 = q(1, 0), p11 = q(1, 1), p01 = q(0, 1);
          // axis = x: u = y, v = z; (u x v) = +axis, so +side is counter-clockwise as listed.
          if (side === 1) out.indices.push(p00, p10, p11, p00, p11, p01);
          else out.indices.push(p00, p11, p10, p00, p01, p11);
        }
      }
    }
  }
  return out;
}

/**
 * Crown one face of a (rounded) box in place: the face stays at the box bounds in its middle and sags toward the edges by
 * `crown` inches, so it reads as a stuffed pillow without leaving the bounds. `axis` / `sign` pick the face (+/- local axis).
 */
export function crownFace(positions: number[], size: Vec3, axis: 0 | 1 | 2, sign: 1 | -1, crown: number): void {
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  const hA = size[axis] / 2;
  const hu = size[u] / 2;
  const hv = size[v] / 2;
  for (let i = 0; i < positions.length; i += 3) {
    const pa = positions[i + axis] * sign;
    if (pa <= 0) continue;
    const fu = Math.min(1, Math.abs(positions[i + u]) / hu);
    const fv = Math.min(1, Math.abs(positions[i + v]) / hv);
    const bump = (1 - fu * fu) * (1 - fv * fv); // 1 in the middle, 0 at the edges
    const w = Math.min(1, pa / hA); // the lower part of the walls barely moves
    positions[i + axis] -= sign * crown * (1 - Math.pow(bump, 0.7)) * w * w;
  }
}

/** Signed volume of an indexed mesh (positive when the winding faces outward). */
export function signedVolume(m: { positions: ArrayLike<number>; indices: ArrayLike<number> }): number {
  let v = 0;
  const p = m.positions;
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = m.indices[i] * 3, b = m.indices[i + 1] * 3, c = m.indices[i + 2] * 3;
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return v;
}
