/**
 * Ackermann front end kinematics (Phase 3b, D-51/D-53). Plain numbers, no params import, no three.js.
 *
 * Planar model, model frame (+X forward, +Y left), inches and degrees. Each knuckle rotates about a vertical axis through its kingpin point at hub height:
 * K_L = (kx, +kpHalf), K_R = (kx, -kpHalf). KPI and caster are NOT applied in the rotation (camber and lift change from KPI are neglected); they only
 * feed the geometry display, ground trail and the analysis rows.
 *
 * Linkage: two steering arms point rearward and inboard (neutral arm vector from the kingpin = (-A cos g, -/+ A sin g)); a tie rod joins the arm tips
 * (length derived so neutral is straight); a center bellcrank (pivot behind the rod, output arm AFT, input arm FORWARD, a straight lever) takes a drag link
 * from its output pin to the tie-rod center, and a tongue link from its input pin to the tongue ear. The bellcrank/tongue/stick angles in `solveSteer` use the
 * spec's lateral-transfer model; `solveCenterExact` gives the real-link-length answer (see its notes). Ride-mode cables act on a cross-arm of the same length.
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
  tongueLinkArm: number;
  towLockInnerDeg: number;
  rideLockOuterDeg: number;
  /** Stick cable arm (in), default 1.5. The stick angle = (bellArm x bellcrank angle) / stickCableArm. */
  stickCableArm?: number;
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
  stickDeg: number;
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

/** Inner angle (deg) that gives the outer angle `outerDeg`, by bisection on the (monotone) 4-bar. */
function innerFromOuter(s: AckSpec, outerDeg: number): number {
  let lo = 0, hi = 60;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const o = outerFromInner(s, mid);
    if (o === null || o > outerDeg) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Stops: the inner limit of a mode and the outer angle that goes with it (deg, magnitudes). Ride is stated at the outer wheel. */
export function lockLimits(s: AckSpec, mode: 'tow' | 'ride'): { innerDeg: number; outerDeg: number } {
  if (mode === 'tow') {
    const o = outerFromInner(s, s.towLockInnerDeg);
    return { innerDeg: s.towLockInnerDeg, outerDeg: o ?? idealOuterDeg(s, s.towLockInnerDeg) };
  }
  return { innerDeg: innerFromOuter(s, s.rideLockOuterDeg), outerDeg: s.rideLockOuterDeg };
}

/** Left-wheel angle range over the tow lock: -outer (turning right, left wheel outer) to +inner (turning left). */
export function leftWheelRange(s: AckSpec): { minDeg: number; maxDeg: number } {
  const l = lockLimits(s, 'tow');
  return { minDeg: -l.outerDeg, maxDeg: l.innerDeg };
}

// ── Center linkage geometry (neutral) ──
function bellNeutral(s: AckSpec) {
  const out0: P2 = [s.bellPivot[0] - s.bellArm, s.bellPivot[1]]; // output arm aft
  const in0: P2 = [s.bellPivot[0] + s.bellArm, s.bellPivot[1]]; // input arm forward
  const rodMid0 = armTips0(s);
  const mid0: P2 = [(rodMid0.L[0] + rodMid0.R[0]) / 2, (rodMid0.L[1] + rodMid0.R[1]) / 2];
  const ear0: P2 = [s.tongueHinge[0] + s.tongueLinkArm, s.tongueHinge[1]];
  return { out0, in0, mid0, ear0, dragLen: dist(out0, mid0), tongueLinkLen: dist(ear0, in0) };
}

/** Neutral dimensions of the center linkage (plan): bellcrank pins, tie-rod midpoint, tongue ear, and the two derived link lengths. */
export function centerLinkage(s: AckSpec) {
  return bellNeutral(s);
}

const norm180 = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

/**
 * Exact bellcrank and tongue angles (deg, for a non-negative inner angle) from the rod midpoint by circle intersection with the REAL link lengths (the
 * drag link and tongue link are rigid; the straight-lever layout above). Null when the center linkage binds.
 *
 * `solveSteer` does NOT use this: it uses the spec's lateral-transfer model (below), which is what §0.1 quotes. The two differ because the drag link is
 * short (6.76") and nearly parallel to the lever arm, so the fore-aft shortening of the arm is not negligible: at the defaults the exact bellcrank turns
 * about 33 deg and the tongue about 31.8 deg at the tow lock (the lateral model gives 26.6 and 24.4). Stage 1 must either re-lay the arms so the links are
 * near-orthogonal to them, or live with the exact numbers (the 25 deg tongue stop would then be reached early).
 */
function centerFromRodExact(s: AckSpec, mid1: P2): { bell: number; tongue: number } | null {
  const b = bellNeutral(s);
  const pv = s.bellPivot;
  const outPts = circleCircle(pv, s.bellArm, mid1, b.dragLen);
  const out1 = nearest(outPts, b.out0);
  if (!out1) return null;
  const bell = norm180(Math.atan2(out1[1] - pv[1], out1[0] - pv[0]) - Math.atan2(b.out0[1] - pv[1], b.out0[0] - pv[0]));
  const in1: P2 = add(pv, rot([s.bellArm, 0], bell));
  const earPts = circleCircle(s.tongueHinge, s.tongueLinkArm, in1, b.tongueLinkLen);
  const ear1 = nearest(earPts, b.ear0);
  if (!ear1) return null;
  const tongue = norm180(Math.atan2(ear1[1] - s.tongueHinge[1], ear1[0] - s.tongueHinge[0]));
  return { bell: bell * DEG, tongue: tongue * DEG };
}

/**
 * Lateral-transfer model of the center linkage (the spec's model, §0.1/§1.2): the bellcrank output arm follows the rod midpoint's lateral travel Y
 * (bellArm sin(bell) = Y, 1:1 at the default 3.0" arms), and the tongue ear follows the input arm's lateral travel (tongueLinkArm sin(tongue) = Y).
 * Fore-aft arc effects of the arms are neglected (links long against the travel). Null when |Y| exceeds either arm.
 */
function centerFromRod(s: AckSpec, mid1: P2): { bell: number; tongue: number } | null {
  const Y = -mid1[1]; // rod midpoint moves to the right (-y) when the cart turns left
  const sb = Y / s.bellArm, st = Y / s.tongueLinkArm;
  if (Math.abs(sb) > 1 || Math.abs(st) > 1) return null;
  return { bell: Math.asin(sb) * DEG, tongue: Math.asin(st) * DEG };
}

/** Exact (real link length) bellcrank and tongue angles for a signed inner angle: see `centerFromRodExact`. Null when the 4-bar or a link binds. */
export function solveCenterExact(s: AckSpec, steerDeg: number): { bellcrankDeg: number; tongueDeg: number } | null {
  const sign = steerDeg < 0 ? -1 : 1;
  const outer = outerFromInner(s, Math.abs(steerDeg));
  if (outer === null) return null;
  const pL = armTipL(s, Math.abs(steerDeg) * RAD), pR = armTipR(s, outer * RAD);
  const c = centerFromRodExact(s, [(pL[0] + pR[0]) / 2, (pL[1] + pR[1]) / 2]);
  return c ? { bellcrankDeg: sign * c.bell, tongueDeg: sign * c.tongue } : null;
}

/** Solve everything for the inner-wheel angle (signed, + = turn left). */
export function solveSteer(s: AckSpec, steerDeg: number): SteerSolution {
  const sign = steerDeg < 0 ? -1 : 1;
  const inner = Math.abs(steerDeg);
  // A binding linkage returns the ideal Ackermann pose (finite, so poses never carry NaN) with ok = false.
  const bad = (): SteerSolution => {
    const o = Math.abs(idealOuterDeg(s, inner));
    return { steerDeg, innerDeg: inner, outerDeg: o, leftDeg: sign * (sign > 0 ? inner : o), rightDeg: sign * (sign > 0 ? o : inner), rod: { dx: 0, dy: 0, rotDeg: 0 }, bellcrankDeg: 0, tongueDeg: 0, stickDeg: 0, ok: false };
  };
  const outer = outerFromInner(s, inner);
  if (outer === null) return bad();
  // Neutral assembly: with the left knuckle straight, the right one must be straight too.
  const toe = outerFromInner(s, 0);
  const assembled = toe !== null && Math.abs(toe) <= NEUTRAL_TOE_TOL_DEG;
  const pL = armTipL(s, inner * RAD), pR = armTipR(s, outer * RAD);
  const tips0 = armTips0(s);
  const mid0: P2 = [(tips0.L[0] + tips0.R[0]) / 2, 0];
  const mid1: P2 = [(pL[0] + pR[0]) / 2, (pL[1] + pR[1]) / 2];
  // Rod direction R -> L is +y at neutral.
  const rotDeg = (Math.atan2(pL[1] - pR[1], pL[0] - pR[0]) - Math.PI / 2) * DEG;
  const center = centerFromRod(s, mid1);
  const stickArm = s.stickCableArm ?? 1.5;
  const bellDeg = center ? center.bell : 0;
  const stickDeg = ((s.bellArm * bellDeg * RAD) / stickArm) * DEG;
  return {
    steerDeg,
    innerDeg: inner,
    outerDeg: outer,
    leftDeg: sign * (sign > 0 ? inner : outer),
    rightDeg: sign * (sign > 0 ? outer : inner),
    rod: { dx: mid1[0] - mid0[0], dy: sign * (mid1[1] - mid0[1]), rotDeg: sign * rotDeg },
    bellcrankDeg: sign * bellDeg,
    tongueDeg: sign * (center ? center.tongue : 0),
    stickDeg: sign * stickDeg,
    ok: center !== null && assembled,
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
export function poseMatrices(s: AckSpec, sol: SteerSolution): Record<SteerBodyId, Mat4> {
  const about = (p: P2, deg: number): Mat4 => multiply(translation(p[0], p[1], 0), multiply(rotationZ(deg * RAD), translation(-p[0], -p[1], 0)));
  const tips0 = armTips0(s);
  const mid0: P2 = [(tips0.L[0] + tips0.R[0]) / 2, 0];
  const rodPose = multiply(translation(mid0[0] + sol.rod.dx, mid0[1] + sol.rod.dy, 0), multiply(rotationZ(sol.rod.rotDeg * RAD), translation(-mid0[0], -mid0[1], 0)));
  return {
    'steer-L': about(kpL(s), sol.leftDeg),
    'steer-R': about(kpR(s), sol.rightDeg),
    'tie-rod': rodPose,
    bellcrank: about(s.bellPivot, sol.bellcrankDeg),
    tongue: about(s.tongueHinge, sol.tongueDeg),
  };
}

/** Apply a Mat4 to a plan point (x, y, z = 0). */
export function applyPlan(m: Mat4, p: Vec2): Vec2 {
  return [m[0] * p[0] + m[4] * p[1] + m[12], m[1] * p[0] + m[5] * p[1] + m[13]];
}
