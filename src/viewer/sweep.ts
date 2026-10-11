import type { Vec2 } from '../model/types';

/** Plain-array mesh for a bent lamination (kept free of three.js so it runs headless under vitest). */
export interface SweepMesh {
  positions: number[];
  indices: number[];
  /** Segment end points (x,y,z pairs) for the ply lines drawn on both side faces; empty when plies <= 1. */
  plyLines: number[];
  /** Per-vertex UVs in inches: u = arc length along the path (the grain direction), v = across the face. */
  uvs: number[];
  /**
   * Index ranges [start, count] that are end grain / ply edge (flat end caps; for `edgeTopBottom` also the two faces normal to
   * the local y axis). Vertices are never shared with the long-grain range, so the caller can scale their UVs separately.
   */
  edgeRanges: Array<[number, number]>;
}

/**
 * Sweep a rectangular section along a centerline in local XZ: `thickness` is measured normal to the path in the XZ plane,
 * `width` along local Y (matches `localBounds` in model/bounds.ts: path ± thickness/2, ± width/2). Each of the four faces has
 * its own vertices so normals are smooth along the path but crisp across the edges; the ends are flat caps.
 */
export function buildSweepMesh(path: Vec2[], width: number, thickness: number, plies: number, edgeTopBottom = false): SweepMesh {
  const pts = path.filter((p, i) => i === 0 || Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) > 1e-9);
  const out: SweepMesh = { positions: [], indices: [], plyLines: [], uvs: [], edgeRanges: [] };
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
  const arc: number[] = [0];
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  faces.forEach(([o0, y0, o1, y1], f) => {
    const base = out.positions.length / 3;
    for (let i = 0; i < n; i++) {
      out.positions.push(...pos(i, o0, y0), ...pos(i, o1, y1));
      // Side faces (0, 2) span the thickness, outer / inner faces (1, 3) span the width.
      if (f % 2 === 0) out.uvs.push(arc[i], o0, arc[i], o1);
      else out.uvs.push(arc[i], y0, arc[i], y1);
    }
    const i0 = out.indices.length;
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      out.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    if (edgeTopBottom && f % 2 === 0) out.edgeRanges.push([i0, out.indices.length - i0]);
  });
  // End caps (duplicated vertices so they stay flat).
  for (const [i, flip] of [[0, true], [n - 1, false]] as const) {
    const b = out.positions.length / 3;
    const i0 = out.indices.length;
    out.positions.push(...pos(i, -ht, -hw), ...pos(i, ht, -hw), ...pos(i, ht, hw), ...pos(i, -ht, hw));
    out.uvs.push(-hw, -ht, -hw, ht, hw, ht, hw, -ht);
    if (flip) out.indices.push(b, b + 2, b + 1, b, b + 3, b + 2);
    else out.indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    out.edgeRanges.push([i0, 6]);
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

/** Sweep mesh with analytic normals (the rounded-section sweep returns them, so no `computeVertexNormals` is needed). */
export interface RoundedSweepMesh extends SweepMesh {
  normals: number[];
}

/**
 * The same bent lamination with every long edge rolled over by `radius` (round 3, review r2 MUST 4: a laminated stem, not a
 * stick) and a domed end cap at the tip. The section is a rounded rectangle (`thickness` along the path normal in XZ, `width`
 * along Y), so the outer bounds match `localBounds`. UVs follow the grain: u = arc length, v = distance around the section,
 * so the long-grain texture runs along the curve and wraps over the roundovers. Both ends are flat end-grain caps (round 4:
 * hull members butt a transom). `dome` > 0 still makes the old stem tip (the last `dome` of the path closes to a point).
 */
export function buildRoundedSweepMesh(path: Vec2[], width: number, thickness: number, plies: number, radius: number, dome = 0, corner = 4): RoundedSweepMesh {
  const out: RoundedSweepMesh = { positions: [], indices: [], plyLines: [], uvs: [], normals: [], edgeRanges: [] };
  const pts = path.filter((p, i) => i === 0 || Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) > 1e-9);
  const n0 = pts.length;
  if (n0 < 2) return out;
  const ht = thickness / 2, hw = width / 2;
  const r = Math.max(1e-3, Math.min(radius, ht * 0.98, hw * 0.98));

  // Rounded-rectangle section loop in (offset, y), counter-clockwise, with outward unit normals and the distance around.
  interface Sec { o: number; y: number; no: number; ny: number; s: number }
  const sec: Sec[] = [];
  const centers: Array<[number, number, number]> = [[ht - r, hw - r, 0], [-(ht - r), hw - r, Math.PI / 2], [-(ht - r), -(hw - r), Math.PI], [ht - r, -(hw - r), 1.5 * Math.PI]];
  for (const [co, cy, a0] of centers) {
    for (let k = 0; k <= corner; k++) {
      const a = a0 + (k / corner) * (Math.PI / 2);
      sec.push({ o: co + r * Math.cos(a), y: cy + r * Math.sin(a), no: Math.cos(a), ny: Math.sin(a), s: 0 });
    }
  }
  sec.push({ ...sec[0] });
  for (let j = 1; j < sec.length; j++) sec[j].s = sec[j - 1].s + Math.hypot(sec[j].o - sec[j - 1].o, sec[j].y - sec[j - 1].y);
  const M = sec.length;

  // Rings: the path up to `L - dome`, then the dome rings.
  const segLen = (i: number): number => Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  let L = 0;
  for (let i = 0; i < n0 - 1; i++) L += segLen(i);
  const d = Math.min(dome, L * 0.4);
  interface Ring { px: number; pz: number; nx: number; nz: number; tx: number; tz: number; scale: number; tilt: number; arc: number }
  const segN: Vec2[] = [];
  const segT: Vec2[] = [];
  for (let i = 0; i < n0 - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dz);
    segT.push([dx / l, dz / l]);
    segN.push([-dz / l, dx / l]);
  }
  const unit = (x: number, z: number): Vec2 => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
  const rings: Ring[] = [];
  let acc = 0;
  for (let i = 0; i < n0; i++) {
    if (i > 0) acc += segLen(i - 1);
    if (d > 0 && acc > L - d - 1e-9) break;
    const nn = i === 0 ? segN[0] : unit(segN[i - 1][0] + segN[Math.min(n0 - 2, i)][0], segN[i - 1][1] + segN[Math.min(n0 - 2, i)][1]);
    const tt = i === 0 ? segT[0] : unit(segT[i - 1][0] + segT[Math.min(n0 - 2, i)][0], segT[i - 1][1] + segT[Math.min(n0 - 2, i)][1]);
    rings.push({ px: pts[i][0], pz: pts[i][1], nx: nn[0], nz: nn[1], tx: tt[0], tz: tt[1], scale: 1, tilt: 0, arc: acc });
  }
  // Point on the path at arc length L - d, then the dome rings straight out along its tangent.
  if (d > 0) {
    let a = 0;
    const target = L - d;
    let i = 0;
    while (i < n0 - 2 && a + segLen(i) < target) { a += segLen(i); i++; }
    const f = (target - a) / segLen(i);
    const px = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pz = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
    const nn = segN[i], tt = segT[i];
    const D = 6;
    for (let k = 0; k <= D; k++) {
      const th = (k / D) * (Math.PI / 2);
      rings.push({ px: px + tt[0] * d * Math.sin(th), pz: pz + tt[1] * d * Math.sin(th), nx: nn[0], nz: nn[1], tx: tt[0], tz: tt[1], scale: Math.cos(th), tilt: Math.sin(th), arc: target + d * Math.sin(th) });
    }
  }

  const base0 = 0;
  rings.forEach((g) => {
    for (let j = 0; j < M; j++) {
      const s = sec[j];
      const o = s.o * g.scale, y = s.y * g.scale;
      out.positions.push(g.px + g.nx * o, y, g.pz + g.nz * o);
      // Normal: the section normal, tilted toward the tangent over the dome (analytic, so seams stay smooth).
      const c = Math.sqrt(Math.max(0, 1 - g.tilt * g.tilt));
      const nxw = g.nx * s.no * c + g.tx * g.tilt, nyw = s.ny * c, nzw = g.nz * s.no * c + g.tz * g.tilt;
      const l = Math.hypot(nxw, nyw, nzw) || 1;
      out.normals.push(nxw / l, nyw / l, nzw / l);
      out.uvs.push(g.arc, s.s);
    }
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < M - 1; j++) {
      const a = base0 + i * M + j, b = a + M;
      out.indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  // Flat end-grain caps (duplicated vertices so they stay flat); the far one only when the end is not domed.
  const addCap = (g: Ring, sign: 1 | -1): void => {
    const b = out.positions.length / 3;
    const i0 = out.indices.length;
    out.positions.push(g.px, 0, g.pz);
    out.normals.push(sign * g.tx, 0, sign * g.tz);
    out.uvs.push(0, 0);
    for (let j = 0; j < M; j++) {
      const s = sec[j];
      out.positions.push(g.px + g.nx * s.o, s.y, g.pz + g.nz * s.o);
      out.normals.push(sign * g.tx, 0, sign * g.tz);
      out.uvs.push(s.y, s.o);
    }
    for (let j = 0; j < M - 1; j++) {
      if (sign > 0) out.indices.push(b, b + 2 + j, b + 1 + j);
      else out.indices.push(b, b + 1 + j, b + 2 + j);
    }
    out.edgeRanges.push([i0, out.indices.length - i0]);
  };
  addCap(rings[0], -1);
  if (d === 0) addCap(rings[rings.length - 1], 1);
  // Ply lines on both side faces, riding the rounded surface.
  if (plies > 1) {
    const eps = 0.01;
    for (let k = 1; k < plies; k++) {
      const off = -ht + (thickness * k) / plies;
      const e = Math.abs(off) - (ht - r);
      const yy = e <= 0 ? hw : hw - r + Math.sqrt(Math.max(0, r * r - e * e));
      for (const y of [-yy - eps, yy + eps]) {
        for (let i = 0; i < n0 - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const na = i === 0 ? segN[0] : unit(segN[i - 1][0] + segN[i][0], segN[i - 1][1] + segN[i][1]);
          const nb = i + 1 === n0 - 1 ? segN[n0 - 2] : unit(segN[i][0] + segN[i + 1][0], segN[i][1] + segN[i + 1][1]);
          out.plyLines.push(a[0] + na[0] * off, y, a[1] + na[1] * off, b[0] + nb[0] * off, y, b[1] + nb[1] * off);
        }
      }
    }
  }
  return out;
}
