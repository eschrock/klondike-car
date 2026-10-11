/**
 * Steering-stop geometry (Phase 3, D-31). Plain numbers only; no model or three.js imports, and only a TYPE import from
 * params, so params.ts can call it from its validator without a runtime cycle.
 *
 * Layout (kingpin-relative plan, +x forward, +y left; the bolster opening is the rectangle |x| ≤ a, |y| ≤ b with the
 * kingpin crossbar |y| ≤ cb across it):
 *
 *  - Two STEER-side dogs, one on the +y axis (left) and one on the −y axis (right), each an oak block t thick, faced with
 *    steel plates tf thick, standing radially. Each dog has a face on both sides, so the same dog stops both locks.
 *  - Four chassis-side STOP BLOCKS (teeth) in the corners of the opening, glued and screwed against the crossbar side and
 *    the aft / fore bolster rail. Each tooth's face is the plane the dog's face reaches at EXACTLY ±lock: for the left
 *    dog's aft-facing face that is n·p = W with n = (−cos L, −sin L) (the face plane rotated by L about the kingpin), so the
 *    contact is flat, face on face, at lock and the gap before lock closes smoothly with no earlier contact.
 *  - The right dog and the right-hand teeth are the 180° rotation of the left ones about the kingpin, so at either lock
 *    TWO stops close at once (a couple): the yaw torque of a one-wheel strike does not become a net force on the kingpin.
 *
 * A stop face is a plane at offset W from the kingpin axis, loaded along its normal. The lever arm of the force at a point
 * of the face is its coordinate s along the face (measured from the foot of the perpendicular from the kingpin), whatever
 * the offset W. Rigid rotation about the kingpin presses point s in by δ·s, so the contact pressure is proportional to s
 * (triangular), which the analysis uses (src/analysis/front.ts).
 */
import type { Params } from '../params';

export interface Pt { x: number; y: number }

/** Bolster ring numbers the plan needs (the same quantities as params.bolsterPlan). */
export interface OpeningLite { aftFaceX: number; foreFaceX: number; openHalfY: number; rw: number; halfY: number }

export type ToothId = 'AL' | 'FL' | 'AR' | 'FR';

export interface StopTooth {
  id: ToothId;
  /** +1 = left (y > 0), −1 = right. */
  side: 1 | -1;
  /** Which dog face it meets: the 'aft' face closes at +lock for the left dog (the right dog's mirror closes on the 'fore' tooth). */
  lockSign: 1 | -1;
  /** Polygon in kingpin-relative plan coordinates, counter-clockwise. */
  poly: Pt[];
  /** Unit normal of the face, pointing INTO the tooth, and the plane offset: n·p = d (p kingpin-relative). */
  n: Pt;
  d: number;
  /** Foot of the perpendicular from the kingpin to the face plane (= d·n). */
  foot: Pt;
  /** Rotation about +z of the right-handed face frame (u = (n.y, −n.x), v = n): world = foot + R(theta)·(u_l, v_l). */
  theta: number;
  /** Polygon in the face frame (u_l, v_l), v_l ≥ 0, the same winding as `poly`. */
  local: Pt[];
  /** Bounding rectangle of `local`: [uMin, uMax] along the face, [0, vMax] behind it (the part's OBB). */
  uMin: number;
  uMax: number;
  vMax: number;
  /** Length of the polygon edge lying on the aft/fore bolster rail face and on the crossbar side. */
  railLen: number;
  barLen: number;
  /** Direction along the face in which the dog's face coordinate s increases (unit, kingpin-relative). */
  sDir: Pt;
}

export interface StopPlan {
  /** Opening half length (x) and half width (y), crossbar half width, lock (rad). */
  a: number;
  b: number;
  cb: number;
  lock: number;
  /** Dog width across the steel flange faces (channel, D-35), urethane pad thickness, half width over the pads W = t/2 + tf. */
  t: number;
  tf: number;
  W: number;
  /** Radial extent of the dog / face along ±y (kingpin-relative), and the face coordinate range s1 = ra … s2 = rb. */
  ra: number;
  rb: number;
  /** Tooth minimum thickness used to trim the thin ends, and the end margin of the tooth beyond the dog face. */
  minThick: number;
  margin: number;
  teeth: StopTooth[];
  ok: boolean;
  why: string;
}

const GAP = 1 / 32;
const MIN_FACE_LEN_IN = 1;
const TOOTH_END_MARGIN_IN = 0.25;
const NO_BAR_HALF_WIDTH_IN = 1.25;

/** Keep the part of `poly` with ax + by ≥ c (Sutherland–Hodgman against one half-plane). */
export function clipHalfPlane(poly: Pt[], ax: number, ay: number, c: number): Pt[] {
  const out: Pt[] = [];
  const f = (p: Pt) => ax * p.x + ay * p.y - c;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp > 0 && fq < 0) || (fp < 0 && fq > 0)) {
      const t = fp / (fp - fq);
      out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  }
  return out;
}

export function polyArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

/** Length of the polygon edges that lie on the line a·x + b·y = c (unit normal) within 1e-6. */
function edgeLenOnLine(poly: Pt[], ax: number, ay: number, c: number): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    if (Math.abs(ax * p.x + ay * p.y - c) < 1e-6 && Math.abs(ax * q.x + ay * q.y - c) < 1e-6) sum += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return sum;
}

const rect = (x0: number, x1: number, y0: number, y1: number): Pt[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

interface Seed { id: ToothId; side: 1 | -1; lockSign: 1 | -1; n: Pt; sDir: Pt }

/** The four tooth frames: the left dog's two faces (aft closes at +lock, fore at −lock) and their 180° images on the right. */
function seeds(lock: number): Seed[] {
  const c = Math.cos(lock), s = Math.sin(lock);
  return [
    { id: 'AL', side: 1, lockSign: 1, n: { x: -c, y: -s }, sDir: { x: -s, y: c } },
    { id: 'FL', side: 1, lockSign: -1, n: { x: c, y: -s }, sDir: { x: s, y: c } },
    { id: 'FR', side: -1, lockSign: 1, n: { x: c, y: s }, sDir: { x: s, y: -c } },
    { id: 'AR', side: -1, lockSign: -1, n: { x: -c, y: s }, sDir: { x: -s, y: -c } },
  ];
}

/** Thickness of wood behind the face of the left-aft tooth at face coordinate s: the chord along n to the rail face or the crossbar. */
export function toothThickness(a: number, cb: number, W: number, L: number, s: number): number {
  const c = Math.cos(L), sn = Math.sin(L);
  const px = -W * c - s * sn, py = -W * sn + s * c; // the face point at s
  const tx = (a + px) / c; // along n = (−cos, −sin) until x = −a
  const ty = (py - cb) / sn; // until y = cb
  return Math.min(tx, ty);
}

export function planStops(p: Params, op: OpeningLite): StopPlan {
  const a = -op.aftFaceX;
  const b = op.openHalfY;
  const hasBar = p.kingpinThroughBolster === 1;
  // Without the crossbar the blocks keep clear of the kingpin by this much, so the left and right blocks never meet.
  const cb = hasBar ? p.kingpinCrossbarWidthIn / 2 : Math.max(Math.max(p.kingpinDiameterIn, p.kingpinSleeveOdIn) / 2 + 0.5, NO_BAR_HALF_WIDTH_IN);
  const L = (Math.min(Math.abs(p.steerLockDeg), 60) * Math.PI) / 180;
  const t = p.steerStopSizeIn;
  const tf = p.steerStopPadIn; // the stop face is the bonded urethane pad on the steel flange (D-35)
  const W = t / 2 + tf;
  const minThick = p.stopBlockMinIn;
  const c = Math.cos(L), sn = Math.sin(L);
  const fail = (why: string): StopPlan => ({ a, b, cb, lock: L, t, tf, W, ra: 0, rb: 0, minThick, margin: TOOTH_END_MARGIN_IN, teeth: [], ok: false, why });
  if (L < 0.1) return fail('the steering lock is too small for stops');
  if (a <= 0 || b <= cb) return fail('the bolster opening is too small');

  // Dog extent. Outer end: every corner (±W, rb) swept through ±L stays inside the opening (x ≤ a, y ≤ b, a 1/32" gap).
  const yMaxAt = (rb: number) => (Math.atan2(W, rb) <= L ? Math.hypot(rb, W) : rb * Math.cos(L) + W * sn);
  const xMaxAt = (rb: number) => W * c + rb * sn;
  let lo = 0, hi = b;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (yMaxAt(mid) <= b - GAP && xMaxAt(mid) <= a - GAP) lo = mid; else hi = mid;
  }
  let rb = lo;
  // Inner end: the near corners (±W, ra) at ±L clear the crossbar side (y ≥ cb + gap) and the kingpin.
  let ra = (cb + GAP + W * sn) / c;
  // Trim both ends where the tooth would be thinner than `minThick` (a thin wedge is not a bearing block).
  const sLo = (cb + sn * (W + minThick)) / c; // thickness to the crossbar ≥ minThick
  const sHi = (a - W * c - minThick * c) / sn; // thickness to the rail face ≥ minThick
  ra = Math.max(ra, sLo);
  // The channel web and its riser reach `p.steerStopRiserDepthIn` in from the stop face (D-35): their steel corner (half width t/2) must clear the crossbar side at lock too.
  ra = Math.max(ra, (cb + GAP + (t / 2) * sn) / c + p.steerStopRiserDepthIn);
  rb = Math.min(rb, sHi);
  if (rb - ra < MIN_FACE_LEN_IN) return fail(`the stop face would be only ${(rb - ra).toFixed(2)}" long (needs ≥ ${MIN_FACE_LEN_IN}"): the dog, the crossbar and the opening leave no room; enlarge the turntable, narrow the crossbar or thin the stop dog`);
  const kpR = Math.max(p.kingpinDiameterIn, p.kingpinSleeveOdIn) / 2;
  if (Math.hypot(W, ra) < kpR + GAP) return fail('the stop dog would touch the kingpin');

  const teeth: StopTooth[] = seeds(L).map((sd) => {
    const y0 = sd.side > 0 ? cb : -b, y1 = sd.side > 0 ? b : -cb;
    let poly = rect(-a, a, y0, y1);
    const d = W;
    poly = clipHalfPlane(poly, sd.n.x, sd.n.y, d);
    const foot: Pt = { x: d * sd.n.x, y: d * sd.n.y };
    const su = foot.x * sd.sDir.x + foot.y * sd.sDir.y;
    poly = clipHalfPlane(poly, sd.sDir.x, sd.sDir.y, su + ra - TOOTH_END_MARGIN_IN);
    poly = clipHalfPlane(poly, -sd.sDir.x, -sd.sDir.y, -(su + rb + TOOTH_END_MARGIN_IN));
    if (polyArea(poly) < 0) poly = [...poly].reverse();
    const u: Pt = { x: sd.n.y, y: -sd.n.x };
    const theta = Math.atan2(u.y, u.x);
    const local = poly.map((q) => ({ x: u.x * (q.x - foot.x) + u.y * (q.y - foot.y), y: sd.n.x * (q.x - foot.x) + sd.n.y * (q.y - foot.y) }));
    const us = local.map((q) => q.x), vs = local.map((q) => q.y);
    return {
      id: sd.id, side: sd.side, lockSign: sd.lockSign, poly, n: sd.n, d, foot, theta, local,
      uMin: Math.min(...us), uMax: Math.max(...us), vMax: Math.max(...vs),
      railLen: edgeLenOnLine(poly, 1, 0, sd.n.x < 0 ? -a : a),
      barLen: hasBar ? edgeLenOnLine(poly, 0, 1, sd.side > 0 ? cb : -cb) : 0,
      sDir: sd.sDir,
    };
  });
  if (teeth.some((q) => q.poly.length < 3 || polyArea(q.poly) < 0.5)) return fail('a stop block has no room in the corner of the bolster opening');
  // The bounding rectangle of each block (its OBB in the model) must stay inside the bolster ring and on its own side of the centerline.
  const ringX = a + op.rw;
  for (const q of teeth) {
    const c = Math.cos(q.theta), sn2 = Math.sin(q.theta);
    for (const [u, v] of [[q.uMin, 0], [q.uMax, 0], [q.uMax, q.vMax], [q.uMin, q.vMax]]) {
      const x = q.foot.x + c * u - sn2 * v, y = q.foot.y + sn2 * u + c * v;
      if (Math.abs(x) > ringX + 1e-9 || Math.abs(y) > op.halfY + 1e-9) return fail('the stop blocks would reach out of the bolster ring: shorten the stop face (thicker dog or face plate) or widen the rails');
      if (y * q.side < -1e-9) return fail('the stop blocks would cross the centerline: widen the crossbar or thicken the stop dog');
    }
  }
  return { a, b, cb, lock: L, t, tf, W, ra, rb, minThick, margin: TOOTH_END_MARGIN_IN, teeth, ok: true, why: '' };
}

/**
 * Triangular contact pressure on a face spanning s1 … s2 (pressure ∝ s, rigid rotation about the kingpin) of height h that
 * must carry torque M: effective lever r_eff = M/F = (2/3)(s2³ − s1³)/(s2² − s1²), peak pressure p_max = 3·M·s2/(h(s2³ − s1³)).
 */
export function triangularFace(s1: number, s2: number, h: number, M: number): { rEff: number; F: number; pMax: number; pAvg: number } {
  const rEff = ((2 / 3) * (s2 ** 3 - s1 ** 3)) / (s2 ** 2 - s1 ** 2);
  const F = M / rEff;
  const pMax = (3 * M * s2) / (h * (s2 ** 3 - s1 ** 3));
  return { rEff, F, pMax, pAvg: F / (h * (s2 - s1)) };
}
