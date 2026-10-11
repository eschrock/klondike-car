import type { Params } from '../params';

/** Half-range of the steer preview slider (inner-wheel angle, degrees): the tow lock (D-53: the tongue is the only steering input). */
export function steerRange(p: Params): number {
  return p.steerLockDeg;
}
