/**
 * Wheel contacts, support polygon and turning geometry (spec "Wheel contacts"; A-1, A-2, A-3).
 * Ground plane, model frame (+X forward, +Y left), inches and degrees. Pure math.
 */
export type P2 = [number, number];

export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

export interface ContactInputs {
  wheelbaseIn: number;
  rearTrackIn: number;
  /** Front track (wheel center to center). The front axle pivots about the kingpin at x = wheelbase (D-56), so both front wheels keep this track at any steer angle. */
  frontTrackIn: number;
}

export interface Contacts {
  RL: P2;
  RR: P2;
  FL: P2;
  FR: P2;
}

export function rot2(p: P2, a: number, about: P2 = [0, 0]): P2 {
  const c = Math.cos(a), s = Math.sin(a);
  const x = p[0] - about[0], y = p[1] - about[1];
  return [about[0] + c * x - s * y, about[1] + s * x + c * y];
}

/**
 * Tire center-plane contact points of the four wheels at steer angle `steerRad` (D-56; + = left turn). The whole front axle turns about the kingpin at (wheelbase, 0), so
 * both front wheels stay parallel (no Ackermann): left (WB - (T/2) sin d, +(T/2) cos d), right (WB + (T/2) sin d, -(T/2) cos d). The rear contacts do not move.
 */
export function contactsAt(g: ContactInputs, steerRad = 0): Contacts {
  const h = g.frontTrackIn / 2, s = Math.sin(steerRad), c = Math.cos(steerRad);
  return {
    RL: [0, g.rearTrackIn / 2], RR: [0, -g.rearTrackIn / 2],
    FL: [g.wheelbaseIn - h * s, h * c], FR: [g.wheelbaseIn + h * s, -h * c],
  };
}

/** Steer angles (rad) swept from -lock to +lock: every `stepDeg` plus both endpoints and zero. */
export function steerSweep(lockRad: number, stepDeg = 2): number[] {
  const lock = Math.abs(lockRad);
  const out = new Set<number>([0, -lock, lock]);
  for (let a = stepDeg * RAD; a < lock - 1e-9; a += stepDeg * RAD) { out.add(a); out.add(-a); }
  return [...out].sort((a, b) => a - b);
}

type Named = { id: keyof Contacts; p: P2 };

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

export interface WorstTip { steer: number; contacts: Contacts; d: number; deg: number; edge: string }

/**
 * Worst lateral tip over the whole steering range (D-56): the front axle turns, so the side edges of the support polygon change with the steer angle. Sweeps the steer
 * angle from -lock to +lock (every 2 degrees plus the endpoints) and returns the angle, the contacts and the edge with the smallest tip angle atan(d / h).
 */
export function contactsWorstTip(g: ContactInputs, cgXY: P2, h: number, lockRad: number): WorstTip {
  let best: WorstTip | null = null;
  for (const st of steerSweep(lockRad)) {
    const ct = contactsAt(g, st);
    const lat = lateralTip(ct, cgXY, h);
    if (!best || lat.deg < best.deg - 1e-12) best = { steer: st, contacts: ct, d: lat.d, deg: lat.deg, edge: lat.edge };
  }
  return best!;
}

/**
 * Smallest static stability factor at the OUTER support edge in a turn, over the whole steering range: turning left (steer > 0) the outer edge is RR-FR, turning right FL-RL;
 * straight, the nearer of the two. Returns the distance, the angle and the edge of the worst case.
 */
export function worstOuterEdge(g: ContactInputs, cgXY: P2, lockRad: number): { d: number; steer: number; edge: string } {
  let best = { d: Infinity, steer: 0, edge: '' };
  for (const st of steerSweep(lockRad)) {
    const ct = contactsAt(g, st);
    const dR = distToLine(cgXY, ct.RR, ct.FR), dL = distToLine(cgXY, ct.FL, ct.RL);
    const d = st > 1e-12 ? dR : st < -1e-12 ? dL : Math.min(dR, dL);
    const edge = st > 1e-12 ? 'RR-FR' : st < -1e-12 ? 'FL-RL' : dR <= dL ? 'RR-FR' : 'FL-RL';
    if (d < best.d) best = { d, steer: st, edge };
  }
  return best;
}

/**
 * Outer support edge in a turn: turning left (δ > 0) the right side is outer, i.e. the line through RR and FR.
 * Returns the CG distance to it (positive when the CG is inside).
 */
export function outerEdgeDistance(c: Contacts, cgXY: P2, deltaRad: number): number {
  return deltaRad >= 0 ? distToLine(cgXY, c.RR, c.FR) : distToLine(cgXY, c.FL, c.RL);
}

/**
 * Static axle loads for a CG `x` ahead of the rear axle line (rear contacts at x = 0) and front contacts at `xFront`
 * (their mean x). W·x / xFront goes to the front axle.
 */
export function axleLoads(weightLb: number, cgX: number, xFront: number): { front: number; rear: number } {
  const front = (weightLb * cgX) / xFront;
  return { front, rear: weightLb - front };
}
