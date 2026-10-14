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

  // Pattern equals stock: the file is the cut. Documented exceptions only.
  const STOCK_EXCEPTIONS: Record<string, string> = {
    'side-L-web': 'the stock carries the 0.1 in S1 trim allowance (cut long, trim at the dry fit); the Shaper file is the net development',
    'side-R-web': 'the stock carries the 0.1 in S1 trim allowance (cut long, trim at the dry fit); the Shaper file is the net development',
  };
  it('makes the flat pattern the stock size (w x l within 0.02 in) of every Shaper part, except the documented web trim allowance', () => {
    for (const x of shaper) {
      const f = flatPattern(x)!;
      const pat = [f.widthIn, f.heightIn].sort((a, b) => b - a);
      const stock = [x.stock!.w, x.stock!.l].sort((a, b) => b - a);
      if (STOCK_EXCEPTIONS[x.id]) {
        expect(stock[0] - pat[0], x.id).toBeGreaterThan(0.05); // the allowance is in the stock only...
        expect(stock[0] - pat[0], x.id).toBeLessThan(0.15); // ...and is the 0.1 in, nothing else
        expect(stock[1], x.id).toBeCloseTo(pat[1], 2);
        continue;
      }
      expect(pat[0], `${x.id} long side`).toBeCloseTo(stock[0], 1);
      expect(Math.abs(pat[0] - stock[0]), `${x.id} long side`).toBeLessThanOrEqual(0.02);
      expect(Math.abs(pat[1] - stock[1]), `${x.id} short side`).toBeLessThanOrEqual(0.02);
    }
  });
  it('cuts the storage lid at its stock size, tongues included, without changing the model geometry', () => {
    const lid = parts.find((x) => x.id === 'storage-lid')!;
    const f = flatPattern(lid)!;
    expect(f.tongueIn).toBeCloseTo(0.25, 6);
    expect(Math.max(f.widthIn, f.heightIn)).toBeCloseTo(18.75, 6);
    expect(Math.min(f.widthIn, f.heightIn)).toBeCloseTo(lid.stock!.l, 6);
    const g = lid.geometry as { size: [number, number, number] };
    expect(Math.max(g.size[0], g.size[1])).toBeCloseTo(18.25, 6); // the visible panel: the mass and the clearances are unchanged
  });
  it('turns a model grain letter (a local axis) into the pattern axis it runs along, and every Shaper part has one along its long side', () => {
    for (const x of shaper) {
      const f = flatPattern(x)!;
      expect(f.grain, x.id).toBeDefined();
      const along = f.grain === 'u' ? f.widthIn : f.heightIn, across = f.grain === 'u' ? f.heightIn : f.widthIn;
      expect(along, `${x.id}: grain runs along the longer side`).toBeGreaterThanOrEqual(across - 1e-6);
    }
  });
  it('flattens the grab board in its own frame: a parallelogram 5 in tall and about 8-2/3 in long, whatever the slope of the sheer (D-84)', () => {
    for (const tag of ['L', 'R']) {
      const f = flatPattern(parts.find((x) => x.id === `seat-grip-${tag}`)!)!;
      expect(f.widthIn).toBeGreaterThan(8.2);
      expect(f.widthIn).toBeLessThan(9.2);
      expect(f.heightIn).toBeCloseTo(5, 6);
    }
  });
});
