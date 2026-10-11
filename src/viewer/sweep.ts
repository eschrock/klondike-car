import type { Vec2 } from '../model/types';

/** Plain-array mesh for a bent lamination (kept free of three.js so it runs headless under vitest). */
export interface SweepMesh {
  positions: number[];
  indices: number[];
  /** Segment end points (x,y,z pairs) for the ply lines drawn on both side faces; empty when plies <= 1. */
  plyLines: number[];
}

/**
 * Sweep a rectangular section along a centerline in local XZ: `thickness` is measured normal to the path in the XZ plane,
 * `width` along local Y (matches `localBounds` in model/bounds.ts: path ± thickness/2, ± width/2). Each of the four faces has
 * its own vertices so normals are smooth along the path but crisp across the edges; the ends are flat caps.
 */
export function buildSweepMesh(path: Vec2[], width: number, thickness: number, plies: number): SweepMesh {
  const pts = path.filter((p, i) => i === 0 || Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) > 1e-9);
  const out: SweepMesh = { positions: [], indices: [], plyLines: [] };
  const n = pts.length;
  if (n < 2) return out;

  // Unit normal at each vertex (XZ plane): the average of the adjacent segment normals.
  const seg: Vec2[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dz = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dz);
    seg.push([-dz / l, dx / l]);
  }
  const nrm: Vec2[] = pts.map((_, i) => {
    const a = seg[Math.max(0, i - 1)];
    const b = seg[Math.min(n - 2, i)];
    const x = a[0] + b[0];
    const z = a[1] + b[1];
    const l = Math.hypot(x, z) || 1;
    return [x / l, z / l];
  });

  const ht = thickness / 2;
  const hw = width / 2;
  // Section corners in order around the loop: (offset along the normal, y).
  const pos = (i: number, off: number, y: number): [number, number, number] => [pts[i][0] + nrm[i][0] * off, y, pts[i][1] + nrm[i][1] * off];
  const faces: Array<[number, number, number, number]> = [
    [-ht, -hw, ht, -hw], // -Y side (spans the thickness)
    [ht, -hw, ht, hw], // outer face (+normal)
    [ht, hw, -ht, hw], // +Y side
    [-ht, hw, -ht, -hw], // inner face
  ];
  for (const [o0, y0, o1, y1] of faces) {
    const base = out.positions.length / 3;
    for (let i = 0; i < n; i++) {
      out.positions.push(...pos(i, o0, y0), ...pos(i, o1, y1));
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      out.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  // End caps (duplicated vertices so they stay flat).
  for (const [i, flip] of [[0, true], [n - 1, false]] as const) {
    const b = out.positions.length / 3;
    out.positions.push(...pos(i, -ht, -hw), ...pos(i, ht, -hw), ...pos(i, ht, hw), ...pos(i, -ht, hw));
    if (flip) out.indices.push(b, b + 2, b + 1, b, b + 3, b + 2);
    else out.indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  // Ply lines on both side faces, nudged outward so they do not z-fight.
  if (plies > 1) {
    const eps = 0.01;
    for (let k = 1; k < plies; k++) {
      const off = -ht + (thickness * k) / plies;
      for (const y of [-hw - eps, hw + eps]) {
        for (let i = 0; i < n - 1; i++) out.plyLines.push(...pos(i, off, y), ...pos(i + 1, off, y));
      }
    }
  }
  return out;
}
