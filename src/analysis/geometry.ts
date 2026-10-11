/**
 * Wheel contacts, support polygon and turning geometry (spec "Wheel contacts"; A-1, A-2, A-3).
 * Ground plane, model frame (+X forward, +Y left), inches and degrees. Pure math.
 */
import { instantCenters, solveSteer, wheelCenters, type AckSpec } from '../model/ackermann';

export type P2 = [number, number];

export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

export interface ContactInputs {
  wheelbaseIn: number;
  rearTrackIn: number;
  frontTrackIn: number;
  kingpinLeadIn: number;
  /**
   * Phase 3b Ackermann spec (optional, additive). When present, `contactsAt(g, innerRad)` takes the INNER wheel angle (+ = left) and puts each front contact at
   * its solved wheel center (4-bar, per-wheel kingpin and scrub), and `instantCenterY` uses the mean of the two axle-line centers. Absent: the old single-pivot rotation.
   */
  ack?: AckSpec;
}

export interface Contacts {
  RL: P2;
  RR: P2;
  FL: P2;
  FR: P2;
  /** Kingpin x (steer pivot). */
  kx: number;
}

export function rot2(p: P2, a: number, about: P2 = [0, 0]): P2 {
  const c = Math.cos(a), s = Math.sin(a);
  const x = p[0] - about[0], y = p[1] - about[1];
  return [about[0] + c * x - s * y, about[1] + s * x + c * y];
}

/** Tire center-plane contact points at steer angle `deltaRad` (+ = left). Front contacts rotate about the kingpin. */
export function contactsAt(g: ContactInputs, deltaRad: number): Contacts {
  if (g.ack) {
    const w = wheelCenters(g.ack, solveSteer(g.ack, deltaRad * DEG));
    return { RL: [0, g.rearTrackIn / 2], RR: [0, -g.rearTrackIn / 2], FL: w.L, FR: w.R, kx: g.ack.kx };
  }
  const kx = g.wheelbaseIn + g.kingpinLeadIn;
  const K: P2 = [kx, 0];
  const f = (sy: number): P2 => {
    const q = rot2([-g.kingpinLeadIn, (sy * g.frontTrackIn) / 2], deltaRad);
    return [K[0] + q[0], K[1] + q[1]];
  };
  return { RL: [0, g.rearTrackIn / 2], RR: [0, -g.rearTrackIn / 2], FL: f(1), FR: f(-1), kx };
}

type Named = { id: keyof Omit<Contacts, 'kx'>; p: P2 };

const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Convex hull (counter-clockwise), keeping the contact ids. */
export function hull(c: Contacts): Named[] {
  const pts: Named[] = [
    { id: 'RL', p: c.RL }, { id: 'RR', p: c.RR }, { id: 'FL', p: c.FL }, { id: 'FR', p: c.FR },
  ].sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1]) as Named[];
  const lower: Named[] = [];
  for (const q of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2].p, lower[lower.length - 1].p, q.p) <= 1e-12) lower.pop();
    lower.push(q);
  }
  const upper: Named[] = [];
  for (const q of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2].p, upper[upper.length - 1].p, q.p) <= 1e-12) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export interface Edge {
  a: Named['id'];
  b: Named['id'];
  /** Distance from the point to the edge line, positive when the point is on the inside of the polygon. */
  dist: number;
}

/** Distances from `pt` to every hull edge (positive inside). */
export function edgeDistances(c: Contacts, pt: P2): Edge[] {
  const h = hull(c);
  const out: Edge[] = [];
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const len = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]);
    out.push({ a: a.id, b: b.id, dist: len < 1e-12 ? 0 : cross(a.p, b.p, pt) / len });
  }
  return out;
}

/** Side edges: every hull edge except the rear pair (RL-RR) and the front pair (FL-FR). */
export function sideEdges(c: Contacts, pt: P2): Edge[] {
  return edgeDistances(c, pt).filter((e) => {
    const s = [e.a, e.b].sort().join('');
    return s !== 'RLRR' && s !== 'FLFR';
  });
}

/** Signed distance from `pt` to the line through `a` and `b`, positive on the polygon-interior (left of a to b when CCW). */
export function distToLine(pt: P2, a: P2, b: P2): number {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return len < 1e-12 ? 0 : cross(a, b, pt) / len;
}

/** Lateral tip angle (deg) about an edge at distance `d` for a CG at height `h`. */
export const tipAngleDeg = (d: number, h: number): number => Math.atan2(d, h) * DEG;

/**
 * Lateral tip about the nearest side edge: min over the side edges of atan(d / h).
 * Returns the distance, the angle and which edge governs.
 */
export function lateralTip(c: Contacts, cgXY: P2, h: number): { d: number; deg: number; edge: string } {
  const es = sideEdges(c, cgXY);
  let best = es[0];
  for (const e of es) if (e.dist < best.dist) best = e;
  return { d: best.dist, deg: tipAngleDeg(best.dist, h), edge: `${best.a}-${best.b}` };
}

/**
 * Outer support edge in a turn: turning left (δ > 0) the right side is outer, i.e. the line through RR and FR.
 * Returns the CG distance to it (positive when the CG is inside).
 */
export function outerEdgeDistance(c: Contacts, cgXY: P2, deltaRad: number): number {
  return deltaRad >= 0 ? distToLine(cgXY, c.RR, c.FR) : distToLine(cgXY, c.FL, c.RL);
}

/**
 * Instantaneous center of the cart in a steady turn at steer angle δ (rolling without slip): the front axle line
 * (through the axle center, which trails the kingpin by `lead`) meets the rear axle line (x = 0). Returns y of the center
 * (x = 0), or null when going straight.
 */
export function instantCenterY(g: ContactInputs, deltaRad: number): number | null {
  if (Math.abs(deltaRad) < 1e-9) return null;
  if (g.ack) return instantCenters(g.ack, solveSteer(g.ack, deltaRad * DEG)).mean;
  const lead = g.kingpinLeadIn;
  const ax = g.wheelbaseIn + lead - lead * Math.cos(deltaRad);
  return ax / Math.tan(deltaRad) - lead * Math.sin(deltaRad);
}

export interface TurnGeometry {
  /** y of the instantaneous center. */
  icY: number;
  /** Radius of the rear-axle center (A-2 reports it too). */
  rearCenter: number;
  /** Outer / inner front tire center radius. */
  outerFront: number;
  innerFront: number;
}

export function turnGeometry(g: ContactInputs, deltaRad: number): TurnGeometry | null {
  const ic = instantCenterY(g, deltaRad);
  if (ic === null) return null;
  const c = contactsAt(g, deltaRad);
  const rad = (q: P2) => Math.hypot(q[0], q[1] - ic);
  const [a, b] = [rad(c.FL), rad(c.FR)];
  return { icY: ic, rearCenter: Math.abs(ic), outerFront: Math.max(a, b), innerFront: Math.min(a, b) };
}

/**
 * Static axle loads for a CG `x` ahead of the rear axle line (rear contacts at x = 0) and front contacts at `xFront`
 * (their mean x). W·x / xFront goes to the front axle.
 */
export function axleLoads(weightLb: number, cgX: number, xFront: number): { front: number; rear: number } {
  const front = (weightLb * cgX) / xFront;
  return { front, rear: weightLb - front };
}
