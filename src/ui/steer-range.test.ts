import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { steerRange } from './steer-range';

describe('steer slider range follows the control mode', () => {
  const p = defaultParams();
  it('tow and both: the tow lock (inner wheel)', () => {
    expect(steerRange(p, 'tow')).toBe(p.steerLockDeg);
    expect(steerRange(p, 'both')).toBe(p.steerLockDeg);
  });
  it('ride: the inner wheel angle that goes with the 8 deg outer ride lock', () => {
    expect(steerRange(p, 'ride')).toBeCloseTo(8.55, 1);
    expect(steerRange({ ...p, steerRideLockDeg: 6 }, 'ride')).toBeLessThan(steerRange(p, 'ride'));
    expect(steerRange(p, 'ride')).toBeLessThan(steerRange(p, 'tow'));
  });
});
