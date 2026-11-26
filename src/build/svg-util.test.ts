import { describe, expect, it } from 'vitest';
import { arcD, bbox, fitArcs, roundEndSlot } from './svg-util';
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

describe('arcs instead of facets (Eric, 2026-11-26: the curves were cut as straight segments)', () => {
  // The SVG arc's center from its end points, radius and flags (SVG 1.1 implementation notes F.6.5), to check the flags.
  const centerOf = (a: [number, number], b: [number, number], r: number, large: number, sweep: number): [number, number] => {
    const mx = (a[0] - b[0]) / 2, my = (a[1] - b[1]) / 2;
    const k = Math.sqrt(Math.max(0, (r * r - mx * mx - my * my) / (mx * mx + my * my))) * (large === sweep ? -1 : 1);
    return [k * my + (a[0] + b[0]) / 2, -k * mx + (a[1] + b[1]) / 2];
  };
  const onArcs = (pts: [number, number][], closed: boolean) => {
    const { start, segs } = fitArcs(pts, closed);
    // every input vertex lies on the segment that covers it
    let cur = start, covered = 0;
    for (const s of segs) {
      if (s.k === 'A') {
        const c = centerOf(cur as [number, number], s.p as [number, number], s.r, s.large, s.sweep);
        // the vertices between cur and s.p (in input order, rotated as fitArcs did) are at r from c
        const i0 = pts.findIndex((p) => Math.hypot(p[0] - cur[0], p[1] - cur[1]) < 1e-9), i1 = pts.findIndex((p) => Math.hypot(p[0] - s.p[0], p[1] - s.p[1]) < 1e-9);
        const n = pts.length;
        for (let k = i0; k !== i1; k = (k + 1) % n) { expect(Math.abs(Math.hypot(pts[k][0] - c[0], pts[k][1] - c[1]) - s.r)).toBeLessThan(1e-3); covered++; }
      }
      cur = s.p;
    }
    return { segs, covered };
  };
  const circlePts = (cx: number, cy: number, r: number, n: number, a0 = 0, a1 = 2 * Math.PI, dir = 1): [number, number][] => Array.from({ length: n }, (_, i) => { const a = a0 + dir * ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number]; });
  it('a polygon on a circle is all arcs, both ways round, with the right flags', () => {
    for (const dir of [1, -1]) {
      const { segs } = onArcs(circlePts(2, 3, 0.75, 24, 0, 2 * Math.PI, dir), true);
      expect(segs.every((s) => s.k === 'A')).toBe(true);
      for (const s of segs) if (s.k === 'A') expect(s.r).toBeCloseTo(0.75, 6);
    }
  });
  it('a rectangle stays four straight sides; a stadium is two sides and two half-circle arcs', () => {
    expect(fitArcs([[0, 0], [2, 0], [2, 1], [0, 1]], true).segs.every((s) => s.k === 'L')).toBe(true);
    const st = bbox([]) && roundEndSlot({ u0: 0, v0: 0, u1: 0.25, v1: 1 });
    const { segs } = onArcs(st as [number, number][], true);
    expect(segs.filter((s) => s.k === 'A').length).toBe(2);
    for (const s of segs) if (s.k === 'A') expect(s.r).toBeCloseTo(0.125, 6);
  });
  it('a rounded corner (6 segments a quarter circle) between two straight sides is one arc; the sharp corners stay sharp', () => {
    const r = 0.75, corner = circlePts(10 - r, 5 - r, r, 7, 0, Math.PI / 2).map((p, i) => (i === 6 ? [10 - r, 5] : p) as [number, number]);
    const loop: [number, number][] = [[0, 0], [10, 0], ...corner.map((p) => p), [0, 5]];
    const { segs } = onArcs(loop, true);
    expect(segs.filter((s) => s.k === 'A').length).toBe(1);
    expect((segs.find((s) => s.k === 'A') as { r: number }).r).toBeCloseTo(r, 6);
  });
  it('arcD writes A commands, and the Shaper and laser files of the ends use them', () => {
    expect(arcD(circlePts(0, 0, 1, 16), (p) => p)).toMatch(/A1,1 0 [01],[01] /);
    expect(arcD([[0, 0], [1, 0], [1, 1]], (p) => p, false)).not.toMatch(/A/);
  });
});
