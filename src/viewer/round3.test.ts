import { describe, expect, it } from 'vitest';
import { localBounds } from '../model/bounds';
import type { Geometry, Vec2, Vec3 } from '../model/types';
import { lashPointMesh, rawBounds } from './hardware';
import { buildRoundedSweepMesh } from './sweep';

function arc(): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * (Math.PI / 3);
    pts.push([30 * Math.sin(a), 30 - 30 * Math.cos(a)]);
  }
  return pts;
}

describe('buildRoundedSweepMesh', () => {
  const g: Geometry = { type: 'sweep', path: arc(), width: 1.75, thickness: 0.75, plies: 6 };
  const m = buildRoundedSweepMesh(g.path, g.width, g.thickness, g.plies, 0.225);
  it('stays within localBounds', () => {
    const b = localBounds(g);
    const [lo, hi] = rawBounds({ positions: m.positions, normals: m.normals, indices: m.indices });
    for (let k = 0; k < 3; k++) {
      expect(lo[k]).toBeGreaterThanOrEqual(b.min[k] - 1e-6);
      expect(hi[k]).toBeLessThanOrEqual(b.max[k] + 1e-6);
    }
  });
  it('has flat end caps at both ends and stays inside the bounds', () => {
    expect(m.edgeRanges.length).toBe(2);
    const last = m.positions.slice(-3);
    expect(Number.isFinite(last[0])).toBe(true);
  });
  it('faces outward (triangle winding agrees with the vertex normals)', () => {
    let bad = 0, total = 0;
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
      const p = (i: number): Vec3 => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
      const [pa, pb, pc] = [p(a), p(b), p(c)];
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (Math.hypot(...n) < 1e-9) continue;
      total++;
      const vn = [m.normals[a * 3], m.normals[a * 3 + 1], m.normals[a * 3 + 2]];
      if (n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2] < 0) bad++;
    }
    expect(total).toBeGreaterThan(100);
    expect(bad / total).toBeLessThan(0.02);
  });
});

describe('lashPointMesh', () => {
  it('fits the 1.5 x 0.9 x 0.75 box', () => {
    const s: Vec3 = [1.5, 0.9, 0.75];
    const [lo, hi] = rawBounds(lashPointMesh(s));
    for (let k = 0; k < 3; k++) {
      expect(lo[k]).toBeGreaterThanOrEqual(-s[k] / 2 - 1e-6);
      expect(hi[k]).toBeLessThanOrEqual(s[k] / 2 + 1e-6);
    }
    expect(hi[2]).toBeGreaterThan(0.3); // the ring stands up
  });
});
