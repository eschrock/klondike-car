import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { flatPattern } from './flat';

const parts = buildModel(defaultParams());
const shaper = parts.filter((x) => x.fab === 'shaper-origin');

describe('flatPattern', () => {
  it('gives every Shaper part a closed outline at its stock thickness', () => {
    expect(shaper.length).toBeGreaterThanOrEqual(17);
    for (const x of shaper) {
      const f = flatPattern(x);
      expect(f, x.id).not.toBeNull();
      expect(f!.outer.length, x.id).toBeGreaterThanOrEqual(4);
      expect(f!.thicknessIn, x.id).toBeCloseTo(x.stock!.t, 2);
    }
  });
  it('unrolls the plan-curved side web a little longer than its projection', () => {
    const web = parts.find((x) => x.id === 'side-L-web')!;
    const f = flatPattern(web)!;
    const prof = (web.geometry as { profile: [number, number][] }).profile;
    const projected = Math.max(...prof.map((q) => q[0])) - Math.min(...prof.map((q) => q[0]));
    expect(f.widthIn).toBeGreaterThan(projected);
    expect(f.widthIn - projected).toBeLessThan(1);
    expect(f.widthIn).toBeLessThanOrEqual(web.stock!.l + 1e-6);
  });
});
