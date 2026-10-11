/**
 * Steering clearance sweep: every moving rigid body (knuckles, wheels, tie rod, bellcrank, links, tongue) at its own Ackermann pose against the chassis,
 * input -lock … +lock in 1° steps. The poses are applied analytically (no model rebuild).
 */
import { obbOverlap, partOBBs, type OBB } from '../model/bounds';
import { leftWheelRange, lockLimits, poseMatrices, solveSteer, ackermannErrorDeg, type PoseId } from '../model/ackermann';
import type { Mat4, Part, Vec3 } from '../model/types';
import type { Ctx } from './context';
import { singleCheck, detail } from './dual';
import { f } from './format';
import type { AnalysisCheck } from './types';

const CAP_IN = 3;

/** World-axis half extents of an oriented box. */
const extentOf = (o: OBB): Vec3 => [0, 1, 2].map((k) => Math.abs(o.axes[0][k]) * o.half[0] + Math.abs(o.axes[1][k]) * o.half[1] + Math.abs(o.axes[2][k]) * o.half[2]) as Vec3;

export interface SweepResult {
  /** Least clearance of the front wheels (tires) to any chassis part, and the pair. */
  minClearanceIn: number;
  steerPart: string;
  chassisPart: string;
  deltaDeg: number;
  /** Least clearance of everything else that moves (knuckles, spindles, shoes and brake horns, tie rod, bellcrank, drag and tongue links, tongue) to any chassis part, and the pair. */
  link: { minClearanceIn: number; steerPart: string; chassisPart: string; deltaDeg: number };
}

// ── Steering sweep (spec 7): every moving rigid body at its own pose ───────────────────────────────

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
 * Steering clearance sweep: for the input (inner wheel angle, + = left) from -lock to +lock in `stepDeg` steps, solve the linkage
 * and move each rigid body by its OWN pose (knuckles, spindles, wheels and front shoes with the left or right knuckle; tie rod, bellcrank, tongue, links
 * separately) against every chassis OBB. A pair is skipped only when both are steering hardware (the brackets, stops, beam and the
 * knuckle metal are designed to be adjacent and are checked by the model tests); tires, shoes, the tongue and the tie rod are always counted.
 */
export function steerSweep(ctx: Ctx, stepDeg = 1): SweepResult {
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
  const none = { minClearanceIn: CAP, steerPart: '–', chassisPart: '–', deltaDeg: 0 };
  let best: SweepResult = { ...none, link: { ...none } };
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
        // The tire against its own kingpin bracket: the leaf disc stands off the HUB by the scrub rule (validateParams: scrub >= hub/2 + leaf radius + 0.5) and is tangent to the
        // tire's flat face plane by design; the tire is a full-width box here but a rounded tire at the leaf's radius (hub flange, sidewall near the rim), so this pair is
        // judged by that rule and the model test, not by the box.
        if (mb.wheel && /^kp-bracket-/.test(fb.id)) continue;
        const dx = mv.center[0] - fb.obb.center[0], dy = mv.center[1] - fb.obb.center[1], dz = mv.center[2] - fb.obb.center[2];
        const cur = mb.wheel ? best : best.link;
        const thr = cur.minClearanceIn + mb.r + fb.r;
        if (thr > 0 && dx * dx + dy * dy + dz * dz > thr * thr) continue;
        if (Math.abs(dx) - mext[0] - fb.ext[0] > cur.minClearanceIn || Math.abs(dy) - mext[1] - fb.ext[1] > cur.minClearanceIn || Math.abs(dz) - mext[2] - fb.ext[2] > cur.minClearanceIn) continue;
        const clr = -obbOverlap(mv, fb.obb);
        if (clr < cur.minClearanceIn) {
          const hit = { minClearanceIn: clr, steerPart: mb.id, chassisPart: fb.id, deltaDeg: deg };
          if (mb.wheel) best = { ...hit, link: best.link }; else best.link = hit;
        }
      }
    }
  }
  return best;
}

export function steerClearance(ctx: Ctx, sweep: SweepResult): AnalysisCheck {
  const { p } = ctx;
  const limit = p.steeringClearanceIn - 0.05;
  const linkLimit = p.steeringLinkClearIn;
  const capped = sweep.minClearanceIn >= CAP_IN;
  const lk = sweep.link;
  const ds = [
    detail('front tires to the chassis', sweep.minClearanceIn, 'in', limit, '>='),
    detail('knuckles, shoes, tie rod, bellcrank, links and tongue to the chassis', lk.minClearanceIn, 'in', linkLimit, '>='),
  ];
  const worstUtil = Math.max(...ds.map((x) => x.util));
  return singleCheck({
    id: 'steer-clear', label: 'Steering clearance', group: 'Steering', refs: ['A-4', 'D-26', 'D-53'],
    value: sweep.minClearanceIn, unit: 'in', limit, sense: '>=', details: ds,
    status: worstUtil > 1 + 1e-9 ? 'fail' : worstUtil > 0.9 ? 'marginal' : 'pass',
    how: `OBB sweep of every moving rigid body at its own pose (knuckles, spindles and wheels about their own kingpins; tie rod, bellcrank, tongue and links) against every chassis part, input -${f(p.steerLockDeg)} to +${f(p.steerLockDeg)} deg inner wheel in 1 deg steps (the Ackermann linkage solved at each). Front tires: ${capped ? `everything stays > ${CAP_IN}" apart` : `minimum ${f(sweep.minClearanceIn, 2)}" between ${sweep.steerPart} and ${sweep.chassisPart} at ${f(sweep.deltaDeg)} deg`}, limit >= steering clearance ${f(p.steeringClearanceIn, 2)}" - 0.05" tolerance = ${f(limit, 2)}" (tire bulge, mud, play). Everything else that moves: ${lk.minClearanceIn >= CAP_IN ? `everything stays > ${CAP_IN}" apart` : `minimum ${f(lk.minClearanceIn, 2)}" between ${lk.steerPart} and ${lk.chassisPart} at ${f(lk.deltaDeg)} deg`}, limit >= the running clearance ${f(linkLimit, 2)}". Pairs of two steering hardware parts (brackets, stops, beam, mode plate, knuckle metal) are skipped: they are designed adjacent; a front tire against its kingpin bracket is skipped too (the leaf clears the hub by the scrub rule, validateParams).`,
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
  const okAt = [0, lock, -lock].map((d) => solveSteer(ack, d).ok);
  const assembled = okAt.every(Boolean);
  const value = assembled ? worst : 99;
  return singleCheck({
    id: 'steer-kin', label: 'Ackermann error and linkage assembly', group: 'Steering', refs: ['D-53'],
    value, unit: 'deg', limit: p.ackermannErrorMaxDeg, sense: '<=',
    details: [detail('worst Ackermann error over 0..tow lock', worst, 'deg', p.ackermannErrorMaxDeg, '<='), detail('error at the tow lock', eLock, 'deg', p.ackermannErrorMaxDeg, '<=')],
    how: `Error = actual outer wheel angle minus the ideal (both axle lines meeting on the rear axle line), swept 0 to ${f(lock)} deg inner in 0.5 deg steps: worst ${f(worst, 2)} deg at ${f(worstAt)} deg inner, ${f(eLock, 2)} deg at the tow lock. Arms ${f(ack.armLen, 2)}" at ${f(ack.armAngleDeg, 0)} deg; the 4-bar is tuned for the lock, so the middle of the range is worst. Linkage assembled (solver ok) at neutral and both tow locks: ${assembled ? 'yes' : 'NO (binds)'}. Limit <= ${p.ackermannErrorMaxDeg} deg.`,
  });
}

export function steerLockCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const ack = ctx.L.front.ack;
  const tow = lockLimits(ack);
  const sol = solveSteer(ack, p.steerLockDeg);
  const yaw = Math.abs(sol.tongueDeg);
  const lr = leftWheelRange(ack);
  const innerErr = Math.abs(tow.innerDeg - p.steerLockDeg);
  const margin = p.tongueMaxYawDeg - yaw;
  const ds = [
    detail('tow lock reached (inner wheel, tolerance 0.1 deg)', innerErr, 'deg', 0.1, '<='),
    detail('tongue yaw at the tow lock vs the yaw stop', yaw, 'deg', p.tongueMaxYawDeg, '<='),
  ];
  const worstUtil = Math.max(...ds.map((x) => x.util));
  return singleCheck({
    id: 'steer-lock', label: 'Steering lock stops and tongue yaw', group: 'Steering', refs: ['D-53', 'D-51'],
    value: yaw, unit: 'deg', limit: p.tongueMaxYawDeg, sense: '<=', details: ds, marginalAbs: 0.5,
    status: worstUtil > 1 + 1e-9 ? 'fail' : margin < 0.5 ? 'marginal' : 'pass',
    how: `Tow-lock stops (blocks under the beam, against the steering arm) at ${f(p.steerLockDeg)} deg inner: the linkage gives inner ${f(tow.innerDeg, 2)} / outer ${f(tow.outerDeg, 2)} deg (left wheel range ${f(lr.minDeg, 1)} to ${f(lr.maxDeg, 1)}). Tongue yaw at the tow lock ${f(yaw, 1)} deg against the ${f(p.tongueMaxYawDeg, 0)} deg stops (margin ${f(margin, 1)} deg); bellcrank turn ${f(sol.bellcrankDeg, 1)} deg at the tow lock. The tow-lock block is the first stop; the tongue yaw stop is the second.`,
  });
}
