/**
 * Ackermann front end kinematics (Phase 3b, D-51/D-53). Plain numbers, no params import, no three.js.
 *
 * Planar model, model frame (+X forward, +Y left), inches and degrees. Each knuckle rotates about a vertical axis through its kingpin point at hub height:
 * K_L = (kx, +kpHalf), K_R = (kx, -kpHalf). KPI and caster are NOT applied in the rotation (camber and lift change from KPI are neglected); they only
 * feed the geometry display, ground trail and the analysis rows.
 *
 * Linkage: two steering arms point rearward and inboard (neutral arm vector from the kingpin = (-A cos g, -/+ A sin g)); a tie rod joins the arm tips
 * (length derived so neutral is straight); a center bellcrank (pivot behind the rod) takes a drag link from its output pin to the tie-rod center, and a
 * tongue link from its input pin to the tongue ear. Stage 1 (WS-A) re-laid it: the output pin stands off to the left so the drag link runs ACROSS the car
 * (it must carry the rod center's sideways travel; a link along the car is a near toggle), the tongue ear is on a clevis cross-plate to the right of and
 * behind the hinge so the tongue's yaw moves it fore-aft along the tongue link. `solveSteer` solves ALL of it exactly (circle intersections, real link
 * lengths); the Stage 0 lateral-transfer shortcut is gone. Left and right turns are therefore NOT exact mirrors for the bellcrank/tongue (the 4-bar,
 * knuckles and wheel centers still are). Phase 3c-1 (D-53): the tongue is the ONLY steering input (no stick, cables, cross-bar or ride lock).
 *
 * The input scalar is the INNER wheel angle (+ = turn left); the outer angle comes from the 4-bar by exact circle intersection.
 */
import { multiply, rotationZ, translation } from './mat4';
import type { Mat4, Vec2 } from './types';

export interface AckSpec {
  wheelbase: number;
  /** Kingpin x = wheelbase + lead. */
  kx: number;
  /** Kingpin ahead of the stub axis (wheel center) at hub height. */
  lead: number;
  /** Kingpin inboard of the wheel-center plane at hub height. */
  scrub: number;
  /** Kingpin half spacing = frontTrack / 2 - scrub. */
  kpHalf: number;
  armLen: number;
  armAngleDeg: number;
  /** Derived: 2 (kpHalf - armLen sin armAngle), so neutral is straight. */
  tieLen: number;
  bellArm: number;
  /** Plan point. */
  bellPivot: [number, number];
  /** Plan point of the vertical tongue hinge pin. */
  tongueHinge: [number, number];
  /** Stage 0 meaning: ear distance ahead of the hinge. Stage 1: the ear is `tongueEar` when given (this is then just the lateral offset magnitude). */
  tongueLinkArm: number;
  towLockInnerDeg: number;
  /** Bellcrank output arm direction (deg from +x, CCW) and input arm length / direction. Defaults: output aft (180), input forward (0), same length (Stage 0 layout). */
  bellOutDeg?: number;
  bellInArm?: number;
  bellInDeg?: number;
  /** Tongue link ear relative to the hinge in the tongue frame: [ahead, left]. Default [tongueLinkArm, 0]. */
  tongueEar?: [number, number];
}

export interface SteerSolution {
  steerDeg: number;
  /** Magnitudes (deg). */
  innerDeg: number;
  outerDeg: number;
  /** Knuckle angles, + = CCW (turn left). */
  leftDeg: number;
  rightDeg: number;
  /** Tie rod rigid pose: displacement of its midpoint (in) and rotation (deg, about its midpoint). */
  rod: { dx: number; dy: number; rotDeg: number };
  bellcrankDeg: number;
  tongueDeg: number;
  /** False when the linkage binds (no circle intersection) or is not assembled straight at neutral. */
  ok: boolean;
}

export type SteerBodyId = 'steer-L' | 'steer-R' | 'tie-rod' | 'bellcrank' | 'tongue';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
type P2 = [number, number];

/** Neutral toe the tie rod length may leave at steerDeg = 0 before the linkage counts as mis-assembled (deg). */
const NEUTRAL_TOE_TOL_DEG = 0.5;

const rot = (v: P2, a: number): P2 => [Math.cos(a) * v[0] - Math.sin(a) * v[1], Math.sin(a) * v[0] + Math.cos(a) * v[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Intersections of circle (c0, r0) and circle (c1, r1); empty when they do not meet. */
function circleCircle(c0: P2, r0: number, c1: P2, r1: number): P2[] {
  const d = dist(c0, c1);
  if (d < 1e-12 || d > r0 + r1 + 1e-9 || d < Math.abs(r0 - r1) - 1e-9) return [];
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r0 * r0 - a * a));
  const ux = (c1[0] - c0[0]) / d, uy = (c1[1] - c0[1]) / d;
  const mx = c0[0] + a * ux, my = c0[1] + a * uy;
  return [[mx - h * uy, my + h * ux], [mx + h * uy, my - h * ux]];
}

const nearest = (pts: P2[], to: P2): P2 | null => (pts.length === 0 ? null : pts.reduce((b, q) => (dist(q, to) < dist(b, to) ? q : b)));

export const kpL = (s: AckSpec): P2 => [s.kx, s.kpHalf];
export const kpR = (s: AckSpec): P2 => [s.kx, -s.kpHalf];

/** Neutral steering-arm tip pins (left, right). */
function armTips0(s: AckSpec): { L: P2; R: P2 } {
  const g = s.armAngleDeg * RAD;
  return { L: add(kpL(s), [-s.armLen * Math.cos(g), -s.armLen * Math.sin(g)]), R: add(kpR(s), [-s.armLen * Math.cos(g), s.armLen * Math.sin(g)]) };
}

/** Neutral tie-rod length that makes straight ahead symmetric. */
export function neutralTieLen(s: AckSpec): number {
  return 2 * (s.kpHalf - s.armLen * Math.sin(s.armAngleDeg * RAD));
}

/** Arm tip of the left knuckle turned CCW by `a` (rad). */
function armTipL(s: AckSpec, a: number): P2 {
  const g = s.armAngleDeg * RAD;
  return add(kpL(s), rot([-s.armLen * Math.cos(g), -s.armLen * Math.sin(g)], a));
}
function armTipR(s: AckSpec, a: number): P2 {
  const g = s.armAngleDeg * RAD;
  return add(kpR(s), rot([-s.armLen * Math.cos(g), s.armLen * Math.sin(g)], a));
}

/** Outer (right) knuckle angle (deg, CCW) for a left (inner) knuckle angle `innerDeg` (CCW, >= 0), or null when the 4-bar binds. */
function outerFromInner(s: AckSpec, innerDeg: number): number | null {
  const pL = armTipL(s, innerDeg * RAD);
  const pts = circleCircle(pL, s.tieLen, kpR(s), s.armLen);
  // Continuation: the root nearest the ideal outer-wheel pose (the neutral tip rotated by the ideal angle), never the flipped assembly.
  const guess = armTipR(s, idealOuterDeg(s, innerDeg) * RAD);
  const q = nearest(pts, guess);
  if (!q || dist(q, guess) > s.armLen * 0.8) return null;
  const g = s.armAngleDeg * RAD;
  const v = sub(q, kpR(s));
  const a0 = Math.atan2(armTip0Vec(g)[1], armTip0Vec(g)[0]);
  let a = Math.atan2(v[1], v[0]) - a0;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a * DEG;
}
const armTip0Vec = (g: number): P2 => [-Math.cos(g), Math.sin(g)];

/** Ideal Ackermann outer angle for an inner angle (deg): cot(outer) - cot(inner) = kingpin spacing / kingpin x (arms meeting at the rear axle center). */
export function idealOuterDeg(s: AckSpec, innerDeg: number): number {
  const sign = innerDeg < 0 ? -1 : 1;
  const i = Math.abs(innerDeg) * RAD;
  if (i < 1e-12) return 0;
  const cotO = 1 / Math.tan(i) + (2 * s.kpHalf) / s.kx;
  return sign * Math.atan(1 / cotO) * DEG;
}

/** Actual outer angle minus ideal (abs, deg) for an inner angle (deg). Returns Infinity when the linkage binds. */
export function ackermannErrorDeg(s: AckSpec, innerDeg: number): number {
  const sol = solveSteer(s, innerDeg);
  if (!sol.ok) return Infinity;
  return Math.abs(sol.outerDeg - Math.abs(idealOuterDeg(s, innerDeg)));
}

/** The tow lock: the inner-wheel limit (deg) and the outer angle that goes with it (magnitudes). */
export function lockLimits(s: AckSpec): { innerDeg: number; outerDeg: number } {
  const o = outerFromInner(s, s.towLockInnerDeg);
  return { innerDeg: s.towLockInnerDeg, outerDeg: o ?? idealOuterDeg(s, s.towLockInnerDeg) };
}

/** Left-wheel angle range over the tow lock: -outer (turning right, left wheel outer) to +inner (turning left). */
export function leftWheelRange(s: AckSpec): { minDeg: number; maxDeg: number } {
  const l = lockLimits(s);
  return { minDeg: -l.outerDeg, maxDeg: l.innerDeg };
}

// ── Center linkage geometry (neutral) ──
/**
 * Neutral center-linkage pins (plan): the bellcrank output pin `out0` (drag link), input pin `in0` (tongue link), the tie-rod midpoint `mid0` (drag link far end),
 * the tongue ear `ear0` and the two derived link lengths.
 * Stage 1 (WS-A) re-lay: the arms/ear are placed by the spec's optional fields; without them the Stage 0 straight layout is used (out aft, in forward, ear straight ahead).
 */
function bellNeutral(s: AckSpec) {
  const pv = s.bellPivot;
  const polar = (r: number, deg: number): P2 => [pv[0] + r * Math.cos(deg * RAD), pv[1] + r * Math.sin(deg * RAD)];
  const outArm = s.bellArm;
  const inArm = s.bellInArm ?? s.bellArm;
  const out0 = polar(outArm, s.bellOutDeg ?? 180);
  const in0 = polar(inArm, s.bellInDeg ?? 0);
  const tips = armTips0(s);
  const mid0: P2 = [(tips.L[0] + tips.R[0]) / 2, (tips.L[1] + tips.R[1]) / 2];
  const earOff: P2 = s.tongueEar ?? [s.tongueLinkArm, 0];
  const ear0: P2 = [s.tongueHinge[0] + earOff[0], s.tongueHinge[1] + earOff[1]];
  return {
    out0, in0, mid0, ear0, outArm, inArm, earR: Math.hypot(earOff[0], earOff[1]),
    dragLen: dist(out0, mid0), tongueLinkLen: dist(ear0, in0),
  };
}

/** Neutral dimensions of the center linkage (plan): bellcrank pins, tie-rod midpoint, tongue ear and the two derived link lengths. */
export function centerLinkage(s: AckSpec) {
  return bellNeutral(s);
}

const norm180 = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

interface CenterSol { bell: number; tongue: number; out1: P2; in1: P2; ear1: P2; mid1: P2; minSin: number }

const sinBetween = (a: P2, b: P2) => Math.abs(a[0] * b[1] - a[1] * b[0]) / ((Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1])) || 1);

/**
 * EXACT center linkage (rigid links of their real lengths, circle intersections; Stage 1 replaced the Stage 0 lateral-transfer model, which was not
 * within 1 deg of the real thing): bellcrank angle and tongue yaw (rad) for the tie-rod midpoint `mid1`, with the pin positions and the worst link
 * transmission (the sine of the angle between each arm/link pair at the drag-link pin, the tongue-link pin and the tongue ear; 1 = perpendicular,
 * 0 = toggle). Null when a link binds.
 */
function solveCenter(s: AckSpec, mid1: P2): CenterSol | null {
  const b = bellNeutral(s);
  const pv = s.bellPivot;
  const out1 = nearest(circleCircle(pv, b.outArm, mid1, b.dragLen), b.out0);
  if (!out1) return null;
  const bell = norm180(Math.atan2(out1[1] - pv[1], out1[0] - pv[0]) - Math.atan2(b.out0[1] - pv[1], b.out0[0] - pv[0]));
  const in1 = add(pv, rot(sub(b.in0, pv), bell));
  const ear1 = nearest(circleCircle(s.tongueHinge, b.earR, in1, b.tongueLinkLen), b.ear0);
  if (!ear1) return null;
  const tongue = norm180(Math.atan2(ear1[1] - s.tongueHinge[1], ear1[0] - s.tongueHinge[0]) - Math.atan2(b.ear0[1] - s.tongueHinge[1], b.ear0[0] - s.tongueHinge[0]));
  const minSin = Math.min(
    sinBetween(sub(out1, pv), sub(mid1, out1)),
    sinBetween(sub(in1, pv), sub(ear1, in1)),
    sinBetween(sub(ear1, s.tongueHinge), sub(in1, ear1)),
  );
  return { bell, tongue, out1, in1, ear1, mid1, minSin };
}

/** Knuckle angles (deg, signed, + = CCW) for a signed inner-wheel input, or null when the 4-bar binds. */
function knuckles(s: AckSpec, steerDeg: number): { left: number; right: number; inner: number; outer: number } | null {
  const sign = steerDeg < 0 ? -1 : 1;
  const inner = Math.abs(steerDeg);
  const outer = outerFromInner(s, inner);
  if (outer === null) return null;
  return { left: sign * (sign > 0 ? inner : outer), right: sign * (sign > 0 ? outer : inner), inner, outer };
}

function midOf(s: AckSpec, leftDeg: number, rightDeg: number): P2 {
  const pL = armTipL(s, leftDeg * RAD), pR = armTipR(s, rightDeg * RAD);
  return [(pL[0] + pR[0]) / 2, (pL[1] + pR[1]) / 2];
}

/** Exact bellcrank and tongue angles for a signed inner angle: see `solveCenter`. Null when the 4-bar or a link binds. (Left and right turns are NOT mirror images: the drag link slants.) */
export function solveCenterExact(s: AckSpec, steerDeg: number): { bellcrankDeg: number; tongueDeg: number } | null {
  const k = knuckles(s, steerDeg);
  if (!k) return null;
  const c = solveCenter(s, midOf(s, k.left, k.right));
  return c ? { bellcrankDeg: c.bell * DEG, tongueDeg: c.tongue * DEG } : null;
}

/**
 * Current positions (plan) of every center-linkage pin for a solution: drag-link pin on the bellcrank, tie-rod midpoint, tongue-link pin on the bellcrank and
 * the tongue ear. Null when the linkage binds.
 */
export function centerPins(s: AckSpec, sol: SteerSolution) {
  const c = solveCenter(s, midOf(s, sol.leftDeg, sol.rightDeg));
  if (!c) return null;
  return { out: c.out1, mid: c.mid1, in: c.in1, ear: c.ear1 };
}

/**
 * Worst link transmission (sine of the arm/link angle, 1 = perpendicular, 0 = toggle) over the whole tow range, both directions. The re-laid linkage
 * keeps this >= 0.8 at the defaults; the Stage 0 straight layout was near 0 (a near toggle).
 */
export function linkageConditioning(s: AckSpec, stepDeg = 1): number {
  let worst = 1;
  const lock = lockLimits(s).innerDeg;
  for (let d = -lock; d <= lock + 1e-9; d += stepDeg) {
    const k = knuckles(s, d);
    if (!k) return 0;
    const c = solveCenter(s, midOf(s, k.left, k.right));
    if (!c) return 0;
    worst = Math.min(worst, c.minSin);
  }
  return worst;
}

/** Transmission below this counts as a near toggle and clears `ok`. */
const MIN_TRANSMISSION_SIN = 0.15;

/** Solve everything for the inner-wheel angle (signed, + = turn left). */
export function solveSteer(s: AckSpec, steerDeg: number): SteerSolution {
  const sign = steerDeg < 0 ? -1 : 1;
  const inner = Math.abs(steerDeg);
  // A binding linkage returns the ideal Ackermann pose (finite, so poses never carry NaN) with ok = false.
  const bad = (): SteerSolution => {
    const o = Math.abs(idealOuterDeg(s, inner));
    return { steerDeg, innerDeg: inner, outerDeg: o, leftDeg: sign * (sign > 0 ? inner : o), rightDeg: sign * (sign > 0 ? o : inner), rod: { dx: 0, dy: 0, rotDeg: 0 }, bellcrankDeg: 0, tongueDeg: 0, ok: false };
  };
  const k = knuckles(s, steerDeg);
  if (k === null) return bad();
  // Neutral assembly: with the left knuckle straight, the right one must be straight too.
  const toe = outerFromInner(s, 0);
  const assembled = toe !== null && Math.abs(toe) <= NEUTRAL_TOE_TOL_DEG;
  const pL = armTipL(s, k.left * RAD), pR = armTipR(s, k.right * RAD);
  const tips0 = armTips0(s);
  const mid0: P2 = [(tips0.L[0] + tips0.R[0]) / 2, 0];
  const mid1: P2 = [(pL[0] + pR[0]) / 2, (pL[1] + pR[1]) / 2];
  // Rod direction R -> L is +y at neutral.
  const rotDeg = (Math.atan2(pL[1] - pR[1], pL[0] - pR[0]) - Math.PI / 2) * DEG;
  const center = solveCenter(s, mid1);
  return {
    steerDeg,
    innerDeg: k.inner,
    outerDeg: k.outer,
    leftDeg: k.left,
    rightDeg: k.right,
    rod: { dx: mid1[0] - mid0[0], dy: mid1[1] - mid0[1], rotDeg },
    bellcrankDeg: center ? center.bell * DEG : 0,
    tongueDeg: center ? center.tongue * DEG : 0,
    ok: center !== null && assembled && center.minSin >= MIN_TRANSMISSION_SIN,
  };
}

/** Solve from the tongue yaw (deg, + = left) by inverting the monotone tongue-vs-steer map. */
export function solveFromTongue(s: AckSpec, tongueDeg: number): SteerSolution {
  let hi = 50;
  while (hi > 5 && !solveSteer(s, hi).ok) hi -= 5;
  const tMax = solveSteer(s, hi).tongueDeg;
  if (Math.abs(tongueDeg) >= tMax) {
    const sol = solveSteer(s, Math.sign(tongueDeg || 1) * hi);
    return { ...sol, ok: sol.ok && Math.abs(tongueDeg) <= tMax + 1e-9 };
  }
  const sign = tongueDeg < 0 ? -1 : 1;
  const target = Math.abs(tongueDeg);
  let lo = 0, up = hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + up) / 2;
    if (solveSteer(s, mid).tongueDeg < target) lo = mid; else up = mid;
  }
  return solveSteer(s, sign * (lo + up) / 2);
}

/** Ground-plane wheel-center positions (hub height) for a solution. */
export function wheelCenters(s: AckSpec, sol: SteerSolution): { L: [number, number]; R: [number, number] } {
  const L = add(kpL(s), rot([-s.lead, s.scrub], sol.leftDeg * RAD));
  const R = add(kpR(s), rot([-s.lead, -s.scrub], sol.rightDeg * RAD));
  return { L, R };
}

/**
 * y of the instantaneous center on the rear axle line (x = 0), from each front wheel's axle line (through its wheel center, perpendicular to its heading)
 * and their mean. Signed (+ = to the left); null when the wheel is straight (no finite center).
 */
export function instantCenters(s: AckSpec, sol: SteerSolution): { fromLeft: number | null; fromRight: number | null; mean: number | null } {
  const c = wheelCenters(s, sol);
  const ic = (p: P2, deg: number) => (Math.abs(deg) < 1e-9 ? null : p[1] + p[0] / Math.tan(deg * RAD));
  const a = ic(c.L, sol.leftDeg), b = ic(c.R, sol.rightDeg);
  return { fromLeft: a, fromRight: b, mean: a !== null && b !== null ? (a + b) / 2 : null };
}

/** Rigid-body poses (neutral frame to steered pose) as model-frame Mat4s, about the vertical axes through the pivots. */
export type LinkBodyId = 'drag-link' | 'tongue-link';
export type PoseId = SteerBodyId | LinkBodyId;

export function poseMatrices(s: AckSpec, sol: SteerSolution): Record<PoseId, Mat4> {
  const about = (p: P2, deg: number): Mat4 => multiply(translation(p[0], p[1], 0), multiply(rotationZ(deg * RAD), translation(-p[0], -p[1], 0)));
  const tips0 = armTips0(s);
  const mid0: P2 = [(tips0.L[0] + tips0.R[0]) / 2, 0];
  const rodPose = multiply(translation(mid0[0] + sol.rod.dx, mid0[1] + sol.rod.dy, 0), multiply(rotationZ(sol.rod.rotDeg * RAD), translation(-mid0[0], -mid0[1], 0)));
  // A link is a rigid segment: carry its neutral end A0 to A1 and rotate it to point at B1.
  const link = (a0: P2, b0: P2, a1: P2, b1: P2): Mat4 => {
    const d = Math.atan2(b1[1] - a1[1], b1[0] - a1[0]) - Math.atan2(b0[1] - a0[1], b0[0] - a0[0]);
    return multiply(translation(a1[0], a1[1], 0), multiply(rotationZ(d), translation(-a0[0], -a0[1], 0)));
  };
  const b = bellNeutral(s);
  const pins = sol.ok ? centerPins(s, sol) : null;
  return {
    'steer-L': about(kpL(s), sol.leftDeg),
    'steer-R': about(kpR(s), sol.rightDeg),
    'tie-rod': rodPose,
    bellcrank: about(s.bellPivot, sol.bellcrankDeg),
    tongue: about(s.tongueHinge, sol.tongueDeg),
    'drag-link': pins ? link(b.out0, b.mid0, pins.out, pins.mid) : identityPose(),
    'tongue-link': pins ? link(b.ear0, b.in0, pins.ear, pins.in) : identityPose(),
  };
}

const identityPose = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Apply a Mat4 to a plan point (x, y, z = 0). */
export function applyPlan(m: Mat4, p: Vec2): Vec2 {
  return [m[0] * p[0] + m[4] * p[1] + m[12], m[1] * p[0] + m[5] * p[1] + m[13]];
}
