/**
 * Steering clearance sweep: OBBs of the steer body (front tyres, axle beam, clamps, tongue, ...) against the chassis
 * at δ = −lock … +lock in 1° steps. The steer parts are rotated analytically about the kingpin (no model rebuild).
 */
import { obbOverlap, partOBB, type OBB } from '../model/bounds';
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

interface Body { id: string; obb: OBB; r: number }

export interface SweepResult {
  minClearanceIn: number;
  steerPart: string;
  chassisPart: string;
  deltaDeg: number;
}

export function steerSweep(ctx: Ctx, stepDeg = 1): SweepResult {
  const { p, L, parts } = ctx;
  const solid = parts.filter((x) => !x.payload && x.group !== 'reference');
  const mk = (x: Part): Body => {
    const obb = partOBB(x);
    return { id: x.id, obb, r: Math.hypot(...obb.half) };
  };
  const steer = solid.filter((x) => isSteer(x) && !INTENDED_CLOSE.test(x.id)).map(mk);
  const fixed = solid.filter((x) => !isSteer(x) && x.group !== 'steering' && x.id !== 'kingpin').map(mk);
  const lock = Math.abs(p.steerLockDeg);
  const K = L.kx;
  const angles: number[] = [];
  for (let d = 0; d < lock; d += stepDeg) angles.push(d);
  angles.push(lock);
  const all = [...new Set([...angles, ...angles.map((a) => -a)])];
  let best: SweepResult = { minClearanceIn: CAP_IN, steerPart: '–', chassisPart: '–', deltaDeg: 0 };
  for (const deg of all) {
    const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
    for (const sb of steer) {
      const cx = sb.obb.center[0] - K, cy = sb.obb.center[1];
      const centre: Vec3 = [K + c * cx - s * cy, s * cx + c * cy, sb.obb.center[2]];
      let moved: OBB | null = null;
      for (const fb of fixed) {
        const dx = centre[0] - fb.obb.center[0], dy = centre[1] - fb.obb.center[1], dz = centre[2] - fb.obb.center[2];
        if (Math.hypot(dx, dy, dz) - sb.r - fb.r > best.minClearanceIn) continue;
        moved ??= {
          center: centre,
          axes: [rotZ(sb.obb.axes[0], c, s), rotZ(sb.obb.axes[1], c, s), rotZ(sb.obb.axes[2], c, s)],
          half: sb.obb.half,
        };
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
    how: `OBB sweep of the steer body (front tyres as full-radius boxes, beam, clamps, tongue) against every chassis part for δ = −${f(p.steerLockDeg)}° … +${f(p.steerLockDeg)}° in 1° steps, parts rotated about the kingpin. ${capped ? `Everything stays > ${CAP_IN}" apart.` : `Minimum clearance ${f(sweep.minClearanceIn, 2)}" between ${sweep.steerPart} and ${sweep.chassisPart} at δ = ${f(sweep.deltaDeg)}°.`} Limit ≥ steering clearance ${f(p.steeringClearanceIn, 2)}" − 0.05" tolerance = ${f(limit, 2)}". Turntable, kingpin, steering stops and side-bearers are excluded: they sit 1/16" from the bolster by design (D-12).`,
  });
}
