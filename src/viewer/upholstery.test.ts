import { describe, expect, it } from 'vitest';
import { dashedLoop, densify, insetLoop, polyArea, roundedLoop, tubeAlong } from './upholstery';

describe('upholstery trims (review r1 MUST 5)', () => {
  it('insets a rounded rectangle uniformly, whichever way it winds', () => {
    const loop = roundedLoop(10, 5, 2);
    const inner = insetLoop(loop, 1);
    expect(Math.abs(polyArea(inner))).toBeLessThan(Math.abs(polyArea(loop)));
    for (const [x, y] of inner) {
      expect(Math.abs(x)).toBeLessThanOrEqual(9.0001);
      expect(Math.abs(y)).toBeLessThanOrEqual(4.0001);
    }
    const cw = insetLoop([...loop].reverse(), 1);
    expect(Math.abs(polyArea(cw))).toBeCloseTo(Math.abs(polyArea(inner)), 1);
  });

  it('builds a closed tube with matching vertex attributes', () => {
    const path = roundedLoop(5, 3, 1).map(([x, y]) => [x, y, 0] as [number, number, number]);
    const t = tubeAlong(path, 0.1, 0xffffff, true, 6);
    expect(t.positions.length).toBe(path.length * 6 * 3);
    expect(t.colors.length).toBe(t.positions.length);
    expect(t.normals.length).toBe(t.positions.length);
    expect(Math.max(...t.indices)).toBeLessThan(path.length * 6);
  });

  it('splits a loop into dashes', () => {
    const loop = roundedLoop(5, 3, 1, 8).map(([x, y]) => [x, y, 0] as [number, number, number]);
    const dashes = dashedLoop(densify(loop, 0.25), 2); // dashes need a finely sampled loop, as the viewer does
    expect(dashes.length).toBeGreaterThan(6);
    for (const d of dashes) expect(d.length).toBeGreaterThanOrEqual(2);
  });
});
