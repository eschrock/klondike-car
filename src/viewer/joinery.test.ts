import { describe, expect, it } from 'vitest';
import { buildModel } from '../model/index';
import { defaultParams } from '../params';
import { joineryMarkers, parseDominoSize } from './joinery';

describe('joineryMarkers', () => {
  it('parses domino sizes', () => {
    const [t, w] = parseDominoSize('10×50')!;
    expect(t).toBeCloseTo(10 / 25.4, 6);
    expect(w).toBeCloseTo(50 / 25.4, 6);
  });
  it('draws each physical joint once in the default model', () => {
    const parts = buildModel(defaultParams());
    const { markers } = joineryMarkers(parts);
    expect(markers.length).toBeGreaterThan(0);
    const all = parts.reduce((n, p) => n + (p.joints ?? []).reduce((m, j) => m + (j.at?.length ?? 0), 0), 0);
    expect(markers.length).toBeLessThan(all);
  });
});
