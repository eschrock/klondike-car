/**
 * Steering clearance sweep: OBBs of the steer body (front tires, axle beam, clamps, tongue, ...) against the chassis
 * at δ = −lock … +lock in 1° steps. The steer parts are rotated analytically about the kingpin (no model rebuild).
 */
import { obbOverlap, partOBBs, type OBB } from '../model/bounds';
import { leftWheelRange, lockLimits, poseMatrices, solveSteer, ackermannErrorDeg, type PoseId } from '../model/ackermann';
import type { Mat4, Part, Vec3 } from '../model/types';
import type { Ctx } from './context';
import { singleCheck, detail } from './dual';
import { RAD } from './geometry';
import { f } from './format';
import type { AnalysisCheck } from './types';

/**
 * Steer-body parts that are *meant* to sit within a fraction of an inch of the chassis (D-12): the turntable on its bolster,
 * the steering stops and side-bearers (1/16" running clearance), and the kingpin that joins them.
 */
const INTENDED_CLOSE = /^(turntable|kingpin|steer-stop|side-bearer)/;
const CAP_IN = 3;

const isSteer = (x: Part) => x.body === 'steer' || x.body === 'wheel-FL' || x.body === 'wheel-FR';

function rotZ(v: Vec3, c: number, s: number): Vec3 {
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}

interface Body { id: string; obb: OBB; r: number; ext: Vec3 }

/** World-axis half extents of an oriented box. */
const extentOf = (o: OBB): Vec3 => [0, 1, 2].map((k) => Math.abs(o.axes[0][k]) * o.half[0] + Math.abs(o.axes[1][k]) * o.half[1] + Math.abs(o.axes[2][k]) * o.half[2]) as Vec3;

export interface SweepResult {
  minClearanceIn: number;
  steerPart: string;
  chassisPart: string;
  deltaDeg: number;
}

export function steerSweep(ctx: Ctx, stepDeg = 1): SweepResult {
  const { p, L, parts } = ctx;
  const solid = parts.filter((x) => !x.payload && x.group !== 'reference');
  // Tight boxes (D-45): a curved member (the S-curve chine, rail, deck) is a row of boxes, not one bounding box over half the hull.
  const mk = (x: Part): Body[] => partOBBs(x).map((obb) => ({ id: x.id, obb, r: Math.hypot(...obb.half), ext: extentOf(obb) }));
  const steer = solid.filter((x) => isSteer(x) && !INTENDED_CLOSE.test(x.id)).flatMap(mk);
  const lock = Math.abs(p.steerLockDeg);
  const K = L.kx;
  // Everything the steer body can reach lies within this radius of the kingpin (broad phase: far chassis boxes are never tested).
  const reach = Math.max(...steer.map((s) => Math.hypot(s.obb.center[0] - K, s.obb.center[1]) + s.r)) + CAP_IN;
  const fixed = solid.filter((x) => !isSteer(x) && x.group !== 'steering' && x.id !== 'kingpin').flatMap(mk)
    .filter((fb) => Math.hypot(fb.obb.center[0] - K, fb.obb.center[1]) - fb.r <= reach);
  const angles: number[] = [];
  for (let d = 0; d < lock; d += stepDeg) angles.push(d);
  angles.push(lock);
  const all = [...new Set([...angles, ...angles.map((a) => -a)])];
  // Candidate chassis boxes per steer box (order preserved, so ties report the same pair): those whose center lies within the box of centers the
  // steer box visits over the whole sweep, grown by both radii and the cap. Most of the hull (the rear half, the S-curve slabs) is never in reach.
  const cands = new Map<Body, Body[]>();
  for (const sb of steer) {
    const cx = sb.obb.center[0] - K, cy = sb.obb.center[1];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const deg of all) {
      const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
      const x = K + c * cx - s * cy, y = s * cx + c * cy;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    cands.set(sb, fixed.filter((fb) => {
      const m = sb.r + fb.r + CAP_IN;
      const o = fb.obb.center;
      return o[0] >= x0 - m && o[0] <= x1 + m && o[1] >= y0 - m && o[1] <= y1 + m;
    }));
  }
  let best: SweepResult = { minClearanceIn: CAP_IN, steerPart: '–', chassisPart: '–', deltaDeg: 0 };
  for (const deg of all) {
    const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
    for (const sb of steer) {
      const cx = sb.obb.center[0] - K, cy = sb.obb.center[1];
      const center: Vec3 = [K + c * cx - s * cy, s * cx + c * cy, sb.obb.center[2]];
      let moved: OBB | null = null;
      let movedExt: Vec3 | null = null;
      for (const fb of cands.get(sb)!) {
        const dx = center[0] - fb.obb.center[0], dy = center[1] - fb.obb.center[1], dz = center[2] - fb.obb.center[2];
        const thr = best.minClearanceIn + sb.r + fb.r;
        if (thr > 0 && dx * dx + dy * dy + dz * dz > thr * thr) continue;
        moved ??= {
          center: center,
          axes: [rotZ(sb.obb.axes[0], c, s), rotZ(sb.obb.axes[1], c, s), rotZ(sb.obb.axes[2], c, s)],
          half: sb.obb.half,
        };
        movedExt ??= extentOf(moved);
        // World-axis boxes apart by more than the best so far: the oriented boxes are too (a cheap reject before the 15-axis test).
        if (Math.abs(dx) - movedExt[0] - fb.ext[0] > best.minClearanceIn || Math.abs(dy) - movedExt[1] - fb.ext[1] > best.minClearanceIn || Math.abs(dz) - movedExt[2] - fb.ext[2] > best.minClearanceIn) continue;
        const clr = -obbOverlap(moved, fb.obb);
        if (clr < best.minClearanceIn) best = { minClearanceIn: clr, steerPart: sb.id, chassisPart: fb.id, deltaDeg: deg };
      }
    }
  }
  return best;
}

export function steerClearance(ctx: Ctx, sweep: SweepResult): AnalysisCheck {
  const { p } = ctx;
  const limit = p.steeringClearanceIn - 0.05;
  const capped = sweep.minClearanceIn >= CAP_IN;
  return singleCheck({
    id: 'steer-clear', label: 'Steering clearance', group: 'Steering', refs: ['A-4', 'D-26'],
    value: sweep.minClearanceIn, unit: 'in', limit, sense: '>=',
    how: `OBB sweep of the steer body (front tires as full-radius boxes, beam, clamps, tongue) against every chassis part for δ = −${f(p.steerLockDeg)}° … +${f(p.steerLockDeg)}° in 1° steps, parts rotated about the kingpin. ${capped ? `Everything stays > ${CAP_IN}" apart.` : `Minimum clearance ${f(sweep.minClearanceIn, 2)}" between ${sweep.steerPart} and ${sweep.chassisPart} at δ = ${f(sweep.deltaDeg)}°.`} Limit ≥ steering clearance ${f(p.steeringClearanceIn, 2)}" − 0.05" tolerance = ${f(limit, 2)}". Turntable, kingpin, steering stops and side-bearers are excluded: they sit 1/16" from the bolster by design (D-12).`,
  });
}

// ── Ackermann sweep (Phase 3b, spec 7): every moving rigid body at its own pose ───────────────────────────────

const ACK_POSE_OF: Record<string, PoseId> = {
  'steer-L': 'steer-L', 'steer-R': 'steer-R', 'wheel-FL': 'steer-L', 'wheel-FR': 'steer-R', 'tie-rod': 'tie-rod', bellcrank: 'bellcrank', tongue: 'tongue',
};
const ACK_LINK_IDS = new Set(['drag-link', 'tongue-link']);

/** The pose key a part follows during the steering sweep, or null for fixed (chassis) parts. */
export function ackPoseKey(x: Part): PoseId | null {
  if (ACK_LINK_IDS.has(x.id)) return x.id as PoseId;
  return ACK_POSE_OF[x.body] ?? null;
}

const applyRigid = (m: Mat4, o: OBB): OBB => {
  const pt = (v: Vec3): Vec3 => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
  const dir = (v: Vec3): Vec3 => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
  return { center: pt(o.center), axes: [dir(o.axes[0]), dir(o.axes[1]), dir(o.axes[2])], half: o.half };
};

interface AckBody { id: string; key: PoseId; obb: OBB; r: number; steering: boolean; wheel: boolean }

/**
 * Steering clearance sweep for the Ackermann front end: for the input (inner wheel angle, + = left) from -lock to +lock in `stepDeg` steps, solve the linkage
 * and move each rigid body by its OWN pose (knuckles, spindles, wheels and front shoes with the left or right knuckle; tie rod, bellcrank, tongue, links
 * separately) against every chassis OBB. A pair is skipped only when both are steering hardware (the brackets, stops, beam, mode plate and the
 * knuckle metal are designed to be adjacent and are checked by the model tests); tires, shoes, the tongue and the tie rod are always counted.
 */
export function steerSweepAck(ctx: Ctx, stepDeg = 1): SweepResult {
  const { p, L, parts } = ctx;
  const ack = L.front.ack;
  const solid = parts.filter((x) => !x.payload && x.group !== 'reference');
  const mk = (x: Part): OBB[] => partOBBs(x);
  const movingParts = solid.filter((x) => ackPoseKey(x));
  const fixedParts = solid.filter((x) => !ackPoseKey(x));
  const moving: AckBody[] = movingParts.flatMap((x) => mk(x).map((obb) => ({ id: x.id, key: ackPoseKey(x)!, obb, r: Math.hypot(...obb.half), steering: x.group === 'steering', wheel: x.body === 'wheel-FL' || x.body === 'wheel-FR' })));
  const fixed = fixedParts.flatMap((x) => mk(x).map((obb) => ({ id: x.id, obb, r: Math.hypot(...obb.half), steering: x.group === 'steering', ext: extentOf(obb) })));
  const lock = Math.abs(p.steerLockDeg);
  const angles: number[] = [];
  for (let d = 0; d < lock; d += stepDeg) angles.push(d);
  angles.push(lock);
  const all = [...new Set([...angles, ...angles.map((a) => -a)])];
  const CAP = CAP_IN;
  let best: SweepResult = { minClearanceIn: CAP, steerPart: '–', chassisPart: '–', deltaDeg: 0 };
  for (const deg of all) {
    const sol = solveSteer(ack, deg);
    const poses = poseMatrices(ack, sol);
    for (const mb of moving) {
      const pm = poses[mb.key];
      if (!pm) continue;
      const mv = applyRigid(pm, mb.obb);
      const mext = extentOf(mv);
      for (const fb of fixed) {
        if (mb.steering && !mb.wheel && fb.steering) continue;
        const dx = mv.center[0] - fb.obb.center[0], dy = mv.center[1] - fb.obb.center[1], dz = mv.center[2] - fb.obb.center[2];
        const thr = best.minClearanceIn + mb.r + fb.r;
        if (thr > 0 && dx * dx + dy * dy + dz * dz > thr * thr) continue;
        if (Math.abs(dx) - mext[0] - fb.ext[0] > best.minClearanceIn || Math.abs(dy) - mext[1] - fb.ext[1] > best.minClearanceIn || Math.abs(dz) - mext[2] - fb.ext[2] > best.minClearanceIn) continue;
        const clr = -obbOverlap(mv, fb.obb);
        if (clr < best.minClearanceIn) best = { minClearanceIn: clr, steerPart: mb.id, chassisPart: fb.id, deltaDeg: deg };
      }
    }
  }
  return best;
}

export function steerClearanceAck(ctx: Ctx, sweep: SweepResult): AnalysisCheck {
  const { p } = ctx;
  const limit = p.steeringClearanceIn - 0.05;
  const capped = sweep.minClearanceIn >= CAP_IN;
  return singleCheck({
    id: 'steer-clear', label: 'Steering clearance', group: 'Steering', refs: ['A-4', 'D-26', 'D-53'],
    value: sweep.minClearanceIn, unit: 'in', limit, sense: '>=',
    how: `OBB sweep of every moving rigid body at its own pose (knuckles, spindles, wheels and front shoes about their own kingpins; tie rod, bellcrank, tongue and links) against every chassis part, input -${f(p.steerLockDeg)} to +${f(p.steerLockDeg)} deg inner wheel in 1 deg steps (the Ackermann linkage solved at each). ${capped ? `Everything stays > ${CAP_IN}" apart.` : `Minimum clearance ${f(sweep.minClearanceIn, 2)}" between ${sweep.steerPart} and ${sweep.chassisPart} at ${f(sweep.deltaDeg)} deg.`} Limit >= steering clearance ${f(p.steeringClearanceIn, 2)}" - 0.05" tolerance = ${f(limit, 2)}". Pairs of two steering hardware parts (brackets, stops, beam, mode plate, knuckle metal) are skipped: they are designed adjacent.`,
  });
}

// ── steer-kin and steer-lock (spec 7) ──────────────────────────────────────────────────────────────────────

export function steerKinCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const ack = ctx.L.front.ack;
  const lock = Math.abs(p.steerLockDeg);
  let worst = 0, worstAt = 0;
  for (let d = 0; d <= lock + 1e-9; d += 0.5) {
    const e = Math.abs(ackermannErrorDeg(ack, d));
    if (e > worst) { worst = e; worstAt = d; }
  }
  const eLock = Math.abs(ackermannErrorDeg(ack, lock));
  const rideIn = lockLimits(ack, 'ride').innerDeg;
  const okAt = [0, lock, -lock, rideIn, -rideIn].map((d) => solveSteer(ack, d).ok);
  const assembled = okAt.every(Boolean);
  const value = assembled ? worst : 99;
  return singleCheck({
    id: 'steer-kin', label: 'Ackermann error and linkage assembly', group: 'Steering', refs: ['D-53'],
    value, unit: 'deg', limit: p.ackermannErrorMaxDeg, sense: '<=',
    details: [detail('worst Ackermann error over 0..tow lock', worst, 'deg', p.ackermannErrorMaxDeg, '<='), detail('error at the tow lock', eLock, 'deg', p.ackermannErrorMaxDeg, '<=')],
    how: `Error = actual outer wheel angle minus the ideal (both axle lines meeting on the rear axle line), swept 0 to ${f(lock)} deg inner in 0.5 deg steps: worst ${f(worst, 2)} deg at ${f(worstAt)} deg inner, ${f(eLock, 2)} deg at the tow lock. Arms ${f(ack.armLen, 2)}" at ${f(ack.armAngleDeg, 0)} deg; the 4-bar is tuned for the lock, so the middle of the range is worst. Linkage assembled (solver ok) at neutral, both tow locks and both ride locks: ${assembled ? 'yes' : 'NO (binds)'}. Limit <= ${p.ackermannErrorMaxDeg} deg.`,
  });
}

export function steerLockCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const ack = ctx.L.front.ack;
  const tow = lockLimits(ack, 'tow'), ride = lockLimits(ack, 'ride');
  const sol = solveSteer(ack, p.steerLockDeg);
  const yaw = Math.abs(sol.tongueDeg);
  const lr = leftWheelRange(ack);
  const innerErr = Math.abs(tow.innerDeg - p.steerLockDeg);
  const rideErr = Math.abs(ride.outerDeg - p.steerRideLockDeg);
  const margin = p.tongueMaxYawDeg - yaw;
  const ds = [
    detail('tow lock reached (inner wheel, tolerance 0.1 deg)', innerErr, 'deg', 0.1, '<='),
    detail('ride lock window (outer wheel, tolerance 0.1 deg)', rideErr, 'deg', 0.1, '<='),
    detail('tongue yaw at the tow lock vs the yaw stop', yaw, 'deg', p.tongueMaxYawDeg, '<='),
  ];
  const worstUtil = Math.max(...ds.map((x) => x.util));
  return singleCheck({
    id: 'steer-lock', label: 'Steering lock stops and tongue yaw', group: 'Steering', refs: ['D-53', 'D-51'],
    value: yaw, unit: 'deg', limit: p.tongueMaxYawDeg, sense: '<=', details: ds, marginalAbs: 0.5,
    status: worstUtil > 1 + 1e-9 ? 'fail' : margin < 0.5 ? 'marginal' : 'pass',
    how: `Tow stops (bracket tabs on the steering arm) at ${f(p.steerLockDeg)} deg inner: the linkage gives inner ${f(tow.innerDeg, 2)} / outer ${f(tow.outerDeg, 2)} deg (left wheel range ${f(lr.minDeg, 1)} to ${f(lr.maxDeg, 1)}). Ride window (narrow bellcrank slot) at ${f(p.steerRideLockDeg)} deg outer: outer ${f(ride.outerDeg, 2)}, inner ${f(ride.innerDeg, 2)} deg. Tongue yaw at the tow lock ${f(yaw, 1)} deg against the ${f(p.tongueMaxYawDeg, 0)} deg stops (margin ${f(margin, 1)} deg); bellcrank turn ${f(sol.bellcrankDeg, 1)} deg at the tow lock. The tow tab is the first stop; the bellcrank window in TOW is wide enough never to be.`,
  });
}
