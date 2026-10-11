import { describe, expect, it } from 'vitest';
import { localBounds } from '../model/bounds';
import { buildSweepMesh } from './sweep';
import type { Geometry, Vec2 } from '../model/types';

function arc(): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * (Math.PI / 3);
    pts.push([30 * Math.sin(a), 30 - 30 * Math.cos(a)]);
  }
  return pts;
}

describe('buildSweepMesh', () => {
  const g: Geometry = { type: 'sweep', path: arc(), width: 1.5, thickness: 0.75, plies: 6 };
  const m = buildSweepMesh(g.path, g.width, g.thickness, g.plies);

  it('stays within localBounds (path ± thickness/2, width/2)', () => {
    const b = localBounds(g);
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], m.positions[i + k]);
        mx[k] = Math.max(mx[k], m.positions[i + k]);
      }
    }
    for (let k = 0; k < 3; k++) {
      expect(mn[k]).toBeGreaterThanOrEqual(b.min[k] - 1e-6);
      expect(mx[k]).toBeLessThanOrEqual(b.max[k] + 1e-6);
    }
    // Y extent is exact.
    expect(mx[1] - mn[1]).toBeCloseTo(1.5, 6);
  });

  it('has valid indices and ply lines', () => {
    expect(m.indices.length % 3).toBe(0);
    expect(Math.max(...m.indices)).toBeLessThan(m.positions.length / 3);
    expect(m.plyLines.length).toBe(5 * 2 * 24 * 6);
  });

  it('is empty for a degenerate path', () => {
    expect(buildSweepMesh([[0, 0]], 1, 1, 1).positions.length).toBe(0);
  });

  it('has flat end caps in edge ranges, and top/bottom faces as edge for okoume', () => {
    expect(m.edgeRanges.length).toBe(2);
    const web = buildSweepMesh(g.path, g.width, g.thickness, 2, true);
    expect(web.edgeRanges.length).toBe(4);
  });

  it('works for a path in plan (local y is up): width stays along y', () => {
    const plan: Vec2[] = [];
    for (let i = 0; i <= 20; i++) plan.push([i * 2, 3 * Math.sin(i / 3)]);
    const p = buildSweepMesh(plan, 4.2, 0.236, 2, true);
    let lo = Infinity, hi = -Infinity;
    for (let i = 1; i < p.positions.length; i += 3) { lo = Math.min(lo, p.positions[i]); hi = Math.max(hi, p.positions[i]); }
    expect(hi - lo).toBeCloseTo(4.2, 6);
  });
});
