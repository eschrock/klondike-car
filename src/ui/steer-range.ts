import { ackSpec, type Params } from '../params';
import { lockLimits } from '../model/ackermann';

/** Control mode of the viewer (ViewState.mode): 'both' shows the tongue and the ride stick, 'tow' the tongue, 'ride' the stick. */
export type ControlMode = 'both' | 'tow' | 'ride';

/**
 * Half-range of the steer preview slider (inner-wheel angle, degrees) for a control mode (spec 8.1): the tow lock for 'tow' and 'both',
 * the inner wheel angle that goes with the 8 deg outer ride lock for 'ride' (8.55 at the defaults).
 */
export function steerRange(p: Params, mode: ControlMode): number {
  return mode === 'ride' ? Math.round(lockLimits(ackSpec(p), 'ride').innerDeg * 100) / 100 : p.steerLockDeg;
}
