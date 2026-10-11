/**
 * Steering clearance sweep: OBBs of the steer body (front tires, axle beam, clamps, tongue, ...) against the chassis
 * at δ = −lock … +lock in 1° steps. The steer parts are rotated analytically about the kingpin (no model rebuild).
 */
import { obbOverlap, partOBBs, type OBB } from '../model/bounds';
import type { Part, Vec3 } from '../model/types';
import type { Ctx } from './context';
import { singleCheck } from './dual';
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
