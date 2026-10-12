import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import type { Part, Vec2 } from '../model/types';
import { MM_PER_IN, lampClipStls, stlFromExtrusion, stlStats, triangulate } from './stl';

const parts = buildModel(defaultParams());
const clips = parts.filter((x) => x.fab === 'print');

const areaOf = (o: Vec2[]): number => Math.abs(o.reduce((a, q, i) => a + q[0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * q[1], 0) / 2);
const extrusion = (outline: Vec2[], depth: number, holes?: Vec2[][]): Part => ({ id: 't', name: 'test', group: 'lighting', kind: 'printed', material: 'ASA', geometry: { type: 'extrusion', outline, depth, ...(holes ? { holes } : {}) }, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], body: 'chassis', massLb: 0, fab: 'print', step: 1 });

describe('stlFromExtrusion', () => {
  it('finds the two printed lamp clips, without holes', () => {
    expect(clips.map((c) => c.id).sort()).toEqual(['lamp-clip', 'rear-lamp-clip']);
    for (const c of clips) expect((c.geometry as { holes?: unknown }).holes).toBeUndefined();
    expect(lampClipStls(parts).length).toBe(2);
  });

  it('writes a consistent binary STL: header, count, 50 bytes a triangle', () => {
    for (const c of clips) {
      const g = c.geometry as { type: 'extrusion'; outline: Vec2[]; depth: number };
      const bytes = stlFromExtrusion(c);
      const st = stlStats(bytes);
      const n = g.outline.length;
      expect(st.triangles).toBe(2 * (n - 2) + 2 * n); // two caps of n - 2 ear-clipped triangles and two wall triangles an edge
      expect(bytes.length).toBe(84 + 50 * st.triangles);
      expect(st.normalsMatchWinding).toBe(true);
    }
  });

  it('encloses the part volume (outline area x depth) to within 2 %, in mm, outward wound', () => {
    for (const c of clips) {
      const g = c.geometry as { type: 'extrusion'; outline: Vec2[]; depth: number };
      const st = stlStats(stlFromExtrusion(c));
      const expected = areaOf(g.outline) * g.depth * MM_PER_IN ** 3;
      expect(st.volumeMm3).toBeGreaterThan(0);
      expect(Math.abs(st.volumeMm3 - expected) / expected).toBeLessThan(0.02);
      expect(st.bounds.min[2]).toBeCloseTo(0, 6);
      expect(st.bounds.max[2]).toBeCloseTo(g.depth * MM_PER_IN, 3);
    }
  });

  it('triangulates a concave outline with a hole, and keeps the hole open', () => {
    const outline: Vec2[] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]]; // an L
    const hole: Vec2[] = [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]];
    const tris = triangulate(outline, [hole]);
    const area = tris.reduce((a, t) => a + Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2, 0);
    expect(area).toBeCloseTo(areaOf(outline) - areaOf(hole), 9);
    const part = extrusion(outline, 0.5, [hole]);
    const st = stlStats(stlFromExtrusion(part));
    const expected = (areaOf(outline) - areaOf(hole)) * 0.5 * MM_PER_IN ** 3;
    expect(Math.abs(st.volumeMm3 - expected) / expected).toBeLessThan(1e-4);
    expect(st.normalsMatchWinding).toBe(true);
  });

  it('refuses a part that is not an extrusion', () => {
    expect(() => stlFromExtrusion(parts.find((x) => x.geometry.type === 'box')!)).toThrow();
  });
});
