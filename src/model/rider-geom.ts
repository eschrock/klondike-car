/**
 * Rider mannequin proportions and the two-link leg solution, shared by the payload builder and the layout (forward
 * storage must clear the rider's knees). Segment sizes are fractions of stature (D-3, anthropometric approximations).
 */
import { RIDER_FOOT_Y_FRAC, RIDER_LEG_Y_FRAC, RIDER_PELVIS_Z_FRAC, type Params } from '../params';
import type { Vec3 } from './types';

export const PELVIS = { x: 0.115, y: 0.18, z: RIDER_PELVIS_Z_FRAC } as const;
export const TORSO = { len: 0.28, x: 0.115, y: 0.19 } as const;
export const HEAD = { x: 0.1, y: 0.09, z: 0.13 } as const;
export const THIGH = { len: 0.26, y: 0.09, z: 0.085 } as const;
export const SHIN = { len: 0.24, y: 0.07, z: 0.065 } as const;
export const FOOT = { len: 0.14, y: RIDER_FOOT_Y_FRAC, z: 0.05 } as const;
/** Hip separation (each leg's y offset) as a fraction of stature. */
export const LEG_Y_FRAC = RIDER_LEG_Y_FRAC;
/** Ankle placement on the foot (toe-to-ankle inset, ankle height drop); anthropometric approximations. */
export const ANKLE_INSET_IN = 2;
export const ANKLE_DROP_IN = 0.5;

/** Knee position for a two-link leg (hip → knee → ankle) in the XZ plane, knee above the hip–ankle line. */
export function knee(h: Vec3, a: Vec3, l1: number, l2: number): Vec3 {
  const dx = a[0] - h[0], dz = a[2] - h[2];
  const D = Math.hypot(dx, dz) || 1e-6;
  const ux = dx / D, uz = dz / D;
  if (D >= l1 + l2) return [h[0] + ux * l1, 0, h[2] + uz * l1];
  const along = (l1 * l1 - l2 * l2 + D * D) / (2 * D);
  const up = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  return [h[0] + ux * along - uz * up, 0, h[2] + uz * along + ux * up];
}

/** Hip and ankle of one leg (y = the leg's lateral offset), given the seat surface, the foot stop and its deck height. */
export function legEnds(p: Params, surface: number, deckZ: number, y: number): { hip: Vec3; ankle: Vec3; stopRear: number } {
  const S = p.riderStatureIn;
  const stopRear = p.seatXIn + p.riderLegReachIn; // the foot brace: the bulkhead's rear face (D-57; the foot block was dropped at D-60)
  return {
    hip: [p.seatXIn, y, surface + (THIGH.z * S) / 2],
    ankle: [stopRear - FOOT.len * S + ANKLE_INSET_IN, y, deckZ + FOOT.z * S - ANKLE_DROP_IN],
    stopRear,
  };
}

/** Highest point of the legs (top of the thigh/shin boxes at the knee), so a box over the nose can clear them. */
export function riderLegTopZ(p: Params, surface: number, deckZ: number): number {
  const S = p.riderStatureIn;
  const { hip, ankle } = legEnds(p, surface, deckZ, 0);
  const k = knee(hip, ankle, THIGH.len * S, SHIN.len * S);
  return Math.max(k[2], hip[2]) + (Math.max(THIGH.z, SHIN.z) * S) / 2;
}
