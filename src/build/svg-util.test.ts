import { describe, expect, it } from 'vitest';
import { roundEndSlot, bbox } from './svg-util';
import { unionRects } from './forms';

describe('template slot shapes', () => {
  it('a round-ended slot keeps its box and has a half-width radius at each end', () => {
    const l = roundEndSlot({ u0: 0, v0: 0, u1: 0.25, v1: 1 });
    const b = bbox(l);
    expect([b.u0, b.v0, b.u1, b.v1].map((x) => +x.toFixed(9))).toEqual([0, 0, 0.25, 1]);
    // every point is within 1/8" of the slot's center line (the ends are half circles)
    for (const [u, v] of l) {
      const vc = Math.min(Math.max(v, 0.125), 0.875);
      expect(Math.hypot(u - 0.125, v - vc)).toBeLessThan(0.125 + 1e-9);
    }
  });
  it('the union of a U of dados (two webs and the deck between them) is one loop with 8 corners', () => {
    const loops = unionRects([
      { u0: 0.3, v0: 1.82, u1: 0.59, v1: 6.5 }, { u0: 17.9, v0: 1.82, u1: 18.2, v1: 6.5 }, { u0: 0.3, v0: 1.8, u1: 18.2, v1: 2.36 },
    ]);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(8); // the deck dado spans both webs' outer walls, so its bottom is one straight edge
    const b = bbox(loops[0]);
    expect([b.u0, b.v0, b.u1, b.v1]).toEqual([0.3, 1.8, 18.2, 6.5]);
  });
  it('rectangles that do not touch stay separate loops', () => {
    expect(unionRects([{ u0: 0, v0: 0, u1: 1, v1: 1 }, { u0: 2, v0: 0, u1: 3, v1: 1 }]).length).toBe(2);
  });
});
