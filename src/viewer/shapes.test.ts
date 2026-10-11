import { describe, expect, it } from 'vitest';
import { crownFace, roundedBoxMesh, signedVolume } from './shapes';
import { projectGrainUVs } from './grainUv';
import { hashString, TileNoise } from './noise';

function bounds(p: ArrayLike<number>): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[i + a]); max[a] = Math.max(max[a], p[i + a]); }
  return { min, max };
}

describe('roundedBoxMesh (D-44 roundovers keep the real bounds)', () => {
  it('keeps the outer bounds exact and the winding outward', () => {
    const size: [number, number, number] = [30, 5.5, 0.75];
    const m = roundedBoxMesh(size, 0.2, 4);
    const b = bounds(m.positions);
    for (let a = 0; a < 3; a++) {
      expect(b.min[a]).toBeCloseTo(-size[a] / 2, 6);
      expect(b.max[a]).toBeCloseTo(size[a] / 2, 6);
    }
    const vol = signedVolume(m);
    expect(vol).toBeGreaterThan(0);
    expect(vol).toBeLessThan(size[0] * size[1] * size[2]); // corners are cut away
    expect(vol).toBeGreaterThan(size[0] * size[1] * size[2] * 0.95);
    for (const v of m.normals) expect(Number.isFinite(v)).toBe(true);
  });
  it('clamps an oversized radius instead of breaking', () => {
    const m = roundedBoxMesh([1, 1, 0.1], 5, 4);
    const b = bounds(m.positions);
    expect(b.max[2]).toBeCloseTo(0.05, 6);
    expect(signedVolume(m)).toBeGreaterThan(0);
  });
  it('crowns a face without leaving the bounds', () => {
    const size: [number, number, number] = [24, 20, 3];
    const m = roundedBoxMesh(size, 0.9, 4, [7, 7, 2]);
    crownFace(m.positions, size, 2, 1, 0.4);
    const b = bounds(m.positions);
    expect(b.max[2]).toBeCloseTo(1.5, 6); // the middle keeps the bounds
    expect(b.min[0]).toBeGreaterThanOrEqual(-12 - 1e-9);
    // an edge vertex of the top face sagged
    let sag = 0;
    for (let i = 0; i < m.positions.length; i += 3) if (Math.abs(m.positions[i]) > 11 && m.positions[i + 2] > 0.5) sag = Math.max(sag, 1.5 - m.positions[i + 2]);
    expect(sag).toBeGreaterThan(0.2);
  });
});

describe('projectGrainUVs', () => {
  const size: [number, number, number] = [10, 4, 1];
  const m = roundedBoxMesh(size, 0.01, 2);
  // non-indexed soup from the indexed mesh
  const pos: number[] = [], nrm: number[] = [];
  for (const i of m.indices) for (let a = 0; a < 3; a++) { pos.push(m.positions[i * 3 + a]); nrm.push(m.normals[i * 3 + a]); }
  const opts = { grain: 0 as const, mode: 'solid' as const, tile: { along: 36, across: 9, end: 6, ply: 0.5 }, offset: [0, 0] as [number, number] };
  const r = projectGrainUVs(pos, nrm, opts);

  it('puts the end faces last and keeps every vertex', () => {
    expect(r.positions.length).toBe(pos.length);
    expect(r.longVerts).toBeGreaterThan(0);
    expect(r.longVerts).toBeLessThan(pos.length / 3);
    for (const v of r.uv) expect(Number.isFinite(v)).toBe(true);
  });
  it('runs u along the grain on the long faces (no smear across the width)', () => {
    // A long top-face triangle: u spans along x, v spans y.
    let found = false;
    for (let v = 0; v < r.longVerts; v += 3) {
      const nz = (r.normals[v * 3 + 2] + r.normals[v * 3 + 5] + r.normals[v * 3 + 8]) / 3;
      if (nz < 0.99) continue;
      const du = Math.abs(r.uv[v * 2] - r.uv[v * 2 + 2]);
      const dx = Math.abs(r.positions[v * 3] - r.positions[v * 3 + 3]);
      expect(du).toBeCloseTo(dx / 36, 5);
      found = true;
    }
    expect(found).toBe(true);
  });
  it('ply mode keeps only the two big faces as veneer', () => {
    const p = projectGrainUVs(pos, nrm, { ...opts, mode: 'ply', thicknessAxis: 2 });
    for (let v = 0; v < p.longVerts; v += 3) expect(Math.abs(p.normals[v * 3 + 2])).toBeGreaterThan(0.5);
  });
});

describe('noise', () => {
  it('is deterministic and tiles', () => {
    const n = new TileNoise(3, 5, 4);
    expect(n.at(0.123, 0.456)).toBe(new TileNoise(3, 5, 4).at(0.123, 0.456));
    expect(n.at(0, 0.3)).toBeCloseTo(n.at(0.999999, 0.3), 3);
    expect(hashString('deck-1')).not.toBe(hashString('deck-2'));
  });
});
