/**
 * Small mesh builders for bought hardware (Phase 3 workstream A): a round rod swept along a polyline path (U-bolts, eye bolts).
 * Plain TypeScript, no three.js. Geometry is a `mesh` Geometry (positions + triangle indices) in the part's local frame.
 */
import type { Ctx } from './build-utils';
import { multiply } from './mat4';
import type { Dims, Fab, Geometry, Joint, Mat4, Part, PartGroup, PartKind, Vec3 } from './types';

export interface MeshData { positions: number[]; indices: number[] }

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const n = Math.hypot(...a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

/** A circle of the given radius swept along `path` (round rod), with parallel-transported frames; closed = ring (eye). */
export function tubeAlong(path: Vec3[], radius: number, segments = 10, closed = false): MeshData {
  const n = path.length;
  const tangent = (i: number): Vec3 => {
    const a = path[Math.max(0, closed ? (i + n - 1) % n : i - 1)];
    const b = path[Math.min(n - 1, closed ? (i + 1) % n : i + 1)];
    return norm(sub(b, a));
  };
  const positions: number[] = [];
  const indices: number[] = [];
  const t0 = tangent(0);
  const ref: Vec3 = Math.abs(t0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let nrm = norm(cross(cross(t0, ref), t0));
  for (let i = 0; i < n; i++) {
    const t = tangent(i);
    // Parallel transport: remove the component of the previous normal along the new tangent.
    const d = dot(nrm, t);
    nrm = norm([nrm[0] - d * t[0], nrm[1] - d * t[1], nrm[2] - d * t[2]]);
    const bin = cross(t, nrm);
    for (let k = 0; k < segments; k++) {
      const a = (2 * Math.PI * k) / segments;
      const c = Math.cos(a) * radius, s = Math.sin(a) * radius;
      positions.push(path[i][0] + c * nrm[0] + s * bin[0], path[i][1] + c * nrm[1] + s * bin[1], path[i][2] + c * nrm[2] + s * bin[2]);
    }
  }
  const rings = closed ? n : n - 1;
  for (let i = 0; i < rings; i++) {
    const j = (i + 1) % n;
    for (let k = 0; k < segments; k++) {
      const k2 = (k + 1) % segments;
      const a = i * segments + k, b = i * segments + k2, c = j * segments + k, d = j * segments + k2;
      indices.push(a, b, c, b, d, c); // counter-clockwise seen from outside (outward normals)
    }
  }
  return { positions, indices };
}

/** A polyline with each interior corner rounded by an arc of `bendRadius` (≥ the rod radius), `arcPts` points per corner. */
export function filletPath(points: Vec3[], bendRadius: number, arcPts = 5): Vec3[] {
  const out: Vec3[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1], p1 = points[i], p2 = points[i + 1];
    const u = norm(sub(p0, p1)), v = norm(sub(p2, p1));
    const cosA = Math.max(-1, Math.min(1, dot(u, v)));
    const ang = Math.acos(cosA);
    if (ang < 1e-3 || Math.abs(Math.PI - ang) < 1e-3) { out.push(p1); continue; }
    const tan = bendRadius / Math.tan(ang / 2);
    const l1 = Math.hypot(...sub(p0, p1)), l2 = Math.hypot(...sub(p2, p1));
    const t = Math.min(tan, l1 * 0.49, l2 * 0.49);
    const rEff = t * Math.tan(ang / 2);
    const a: Vec3 = [p1[0] + u[0] * t, p1[1] + u[1] * t, p1[2] + u[2] * t];
    const b: Vec3 = [p1[0] + v[0] * t, p1[1] + v[1] * t, p1[2] + v[2] * t];
    const bis = norm([u[0] + v[0], u[1] + v[1], u[2] + v[2]]);
    const cDist = rEff / Math.sin(ang / 2);
    const center: Vec3 = [p1[0] + bis[0] * cDist, p1[1] + bis[1] * cDist, p1[2] + bis[2] * cDist];
    const ra = sub(a, center), rb = sub(b, center);
    for (let k = 0; k <= arcPts; k++) {
      const f = k / arcPts;
      const m = norm([ra[0] * (1 - f) + rb[0] * f, ra[1] * (1 - f) + rb[1] * f, ra[2] * (1 - f) + rb[2] * f]);
      out.push([center[0] + m[0] * rEff, center[1] + m[1] * rEff, center[2] + m[2] * rEff]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export function mergeMeshes(...meshes: MeshData[]): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const m of meshes) {
    const base = positions.length / 3;
    positions.push(...m.positions);
    for (const i of m.indices) indices.push(i + base);
  }
  return { positions, indices };
}

/** Length of a polyline (in). */
export function pathLength(path: Vec3[], closed = false): number {
  let s = 0;
  for (let i = 0; i + 1 < path.length; i++) s += Math.hypot(...sub(path[i + 1], path[i]));
  if (closed && path.length > 2) s += Math.hypot(...sub(path[0], path[path.length - 1]));
  return s;
}

/** A circle of `radius` in the plane with unit normal `normal`, centered at `center`, as a closed polyline. */
export function circlePath(center: Vec3, normal: Vec3, radius: number, pts = 16): Vec3[] {
  const n = norm(normal);
  const ref: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(n, ref));
  const v = cross(n, u);
  const out: Vec3[] = [];
  for (let k = 0; k < pts; k++) {
    const a = (2 * Math.PI * k) / pts;
    out.push([center[0] + radius * (Math.cos(a) * u[0] + Math.sin(a) * v[0]), center[1] + radius * (Math.cos(a) * u[1] + Math.sin(a) * v[1]), center[2] + radius * (Math.cos(a) * u[2] + Math.sin(a) * v[2])]);
  }
  return out;
}

// ── Part assembly for custom geometry (extrusions and meshes) ──

export interface CustomPartSpec {
  id: string;
  partNo?: string;
  name: string;
  group: PartGroup;
  kind: PartKind;
  material: string;
  geometry: Geometry;
  /** Placement before the steer pivot (neutral frame). */
  transform: Mat4;
  steer?: boolean;
  massLb: number;
  fab: Fab;
  step: number;
  explode?: Vec3;
  grain?: 'x' | 'y' | 'z';
  stock?: Dims;
  rough?: Dims;
  removable?: boolean;
  joints?: Joint[];
  sourcing?: Part['sourcing'];
  cgIn?: Vec3;
  notes?: string;
}

/** Build a Part for geometry the box / cylinder factories cannot express; the steer pivot is applied here. */
export function customPart(ctx: Ctx, s: CustomPartSpec): Part {
  const out: Part = {
    id: s.id,
    name: s.name,
    group: s.group,
    kind: s.kind,
    material: s.material,
    geometry: s.geometry,
    transform: s.steer ? multiply(ctx.pivot, s.transform) : s.transform,
    body: s.steer ? 'steer' : 'chassis',
    massLb: s.massLb,
    fab: s.fab,
    step: s.step,
    explode: s.explode ?? [0, 0, 0],
  };
  if (s.partNo) out.partNo = s.partNo;
  if (s.grain) out.grain = s.grain;
  if (s.stock) out.stock = s.stock;
  if (s.rough) out.rough = s.rough;
  if (s.removable) out.removable = true;
  if (s.joints) out.joints = s.joints;
  if (s.sourcing) out.sourcing = s.sourcing;
  if (s.cgIn) out.cgIn = s.cgIn;
  if (s.notes) out.notes = s.notes;
  return out;
}
