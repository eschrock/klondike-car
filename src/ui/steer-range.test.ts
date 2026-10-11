import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { steerRange } from './steer-range';

describe('steer slider range', () => {
  const p = defaultParams();
  it('is the tow lock (inner wheel); the tongue is the only input', () => {
    expect(steerRange(p)).toBe(p.steerLockDeg);
    expect(steerRange({ ...p, steerLockDeg: 30 })).toBe(30);
  });
});
