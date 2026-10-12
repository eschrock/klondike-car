/**
 * Flat patterns (Phase 4): the 2-D shape of every flat-cut part, in its own sheet plane, for the Shaper Origin files (`shaper-svg.ts`) and the plywood nesting (`nesting.ts`).
 * Plain TS, no three.js.
 *
 * - Extrusion: the outline and holes as modeled (local XY is the cut face; depth is the thickness).
 * - Box: a rectangle of the two larger dimensions; the smallest is the thickness.
 * - Plan-curved wall (mesh with a `profile`, the side webs, D-57/D-61): the (x, z) profile with x replaced by the arc length along the wall's plan
 *   centerline, so the cut pattern is the true flat development of the bent sheet, not its projection.
 *
 * Coordinates are shifted so the pattern's bounding box starts at (0, 0). `u` is the pattern's horizontal axis, `v` vertical.
 */
import type { Part, Vec2 } from '../model/types';

export interface FlatPattern {
  partId: string;
  partNo: string;
  name: string;
  material: string;
  /** Cut thickness (in). */
  thicknessIn: number;
  /** Outer loop, CCW, inches, bounding box min at (0, 0). */
  outer: Vec2[];
  /** Through-cut inner loops (hand holes, vent holes), CW. */
  holes: Vec2[][];
  /** Bounding box of `outer` (in). */
  widthIn: number;
  heightIn: number;
  /** The pattern axis the grain (or ply face grain) runs along, when the part says. */
  grain?: 'u' | 'v';
  /**
   * Map a point in the part's LOCAL frame onto the pattern (u, v), or null if the point is off the cut face's plane mapping (used to place joint
   * holes and pockets from `Joint.at`). For a plan-curved wall the local frame is the model frame.
   */
  toPattern: (local: [number, number, number]) => Vec2;
  /** Which local axis is the thickness (normal to the cut face): 'z' for extrusions; the smallest box axis; 'y' for plan-curved walls. */
  normalAxis: 'x' | 'y' | 'z';
}

const signedArea = (o: Vec2[]): number => {
  let a = 0;
  for (let i = 0; i < o.length; i++) {
    const [x0, y0] = o[i], [x1, y1] = o[(i + 1) % o.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
};
const ccw = (o: Vec2[]): Vec2[] => (signedArea(o) < 0 ? [...o].reverse() : o);
const cw = (o: Vec2[]): Vec2[] => (signedArea(o) > 0 ? [...o].reverse() : o);

/** The flat pattern of a Shaper / sheet part, or null when the part is not flat-cut (a bent band, a turned or purchased part). */
export function flatPattern(part: Part): FlatPattern | null {
  const g = part.geometry;
  const base = { partId: part.id, partNo: part.partNo ?? part.id, name: part.name, material: part.material };
  if (g.type === 'extrusion') {
    return finish(base, g.depth, g.outline, g.holes ?? [], (q) => [q[0], q[1]], 'z', grainUV(part.grain, 'x', 'y'));
  }
  if (g.type === 'box') {
    const s = g.size;
    const order = [0, 1, 2].sort((a, b) => s[a] - s[b]); // ascending: thickness, then the shorter and the longer in-plane axes
    const uAx = order[2], vAx = order[1];
    const hu = s[uAx] / 2, hv = s[vAx] / 2;
    const outline: Vec2[] = [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]];
    const axes = ['x', 'y', 'z'] as const;
    return finish(base, s[order[0]], outline, [], (q) => [q[uAx], q[vAx]], axes[order[0]], grainUV(part.grain, axes[uAx], axes[vAx]));
  }
  if (g.type === 'mesh' && g.profile && g.thickness && g.positions.length) {
    // planWallGeometry (plan-wall.ts) writes the +y rim (x, yc(x) + t/2, z) for each profile vertex in order, then the -y rim, as the last 2n vertices.
    const n = g.profile.length, nv = g.positions.length / 3, rim0 = nv - 2 * n;
    const xs: number[] = [], yc = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const k = 3 * (rim0 + i);
      const x = g.positions[k], y = g.positions[k + 1] - g.thickness / 2;
      if (!yc.has(x)) { yc.set(x, y); xs.push(x); }
    }
    xs.sort((a, b) => a - b);
    const sAt = new Map<number, number>();
    let s = 0;
    for (let i = 0; i < xs.length; i++) {
      if (i > 0) s += Math.hypot(xs[i] - xs[i - 1], yc.get(xs[i])! - yc.get(xs[i - 1])!);
      sAt.set(xs[i], s);
    }
    const arc = (x: number): number => {
      if (sAt.has(x)) return sAt.get(x)!;
      let i = xs.findIndex((v) => v > x);
      if (i <= 0) i = i === 0 ? 1 : xs.length - 1;
      const a = xs[i - 1], b = xs[i], f = (x - a) / (b - a || 1);
      return sAt.get(a)! + f * (sAt.get(b)! - sAt.get(a)!);
    };
    const outline = g.profile.map(([x, z]) => [arc(x), z] as Vec2);
    return finish(base, g.thickness, outline, [], (q) => [arc(q[0]), q[2]], 'y', grainUV(part.grain, 'x', 'z'));
  }
  return null;
}

function grainUV(grain: Part['grain'], uAxis: string, vAxis: string): 'u' | 'v' | undefined {
  return grain === uAxis ? 'u' : grain === vAxis ? 'v' : undefined;
}

function finish(
  base: Pick<FlatPattern, 'partId' | 'partNo' | 'name' | 'material'>, t: number, outline: Vec2[], holes: Vec2[][],
  map: (q: [number, number, number]) => Vec2, normalAxis: 'x' | 'y' | 'z', grain: 'u' | 'v' | undefined,
): FlatPattern {
  const minU = Math.min(...outline.map((o) => o[0])), minV = Math.min(...outline.map((o) => o[1]));
  const maxU = Math.max(...outline.map((o) => o[0])), maxV = Math.max(...outline.map((o) => o[1]));
  const sh = (o: Vec2): Vec2 => [o[0] - minU, o[1] - minV];
  return {
    ...base, thicknessIn: t,
    outer: ccw(outline.map(sh)), holes: holes.map((h) => cw(h.map(sh))),
    widthIn: maxU - minU, heightIn: maxV - minV,
    ...(grain ? { grain } : {}),
    toPattern: (q) => sh(map(q)), normalAxis,
  };
}
