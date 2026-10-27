import { describe, expect, it } from 'vitest';
import { Fig } from './kit';
import { Solids } from './solid';

describe('the headless solid renderer (D-103 figures)', () => {
  const draw = (S: Solids, yaw = 30, pitch = 30): string => { const F = new Fig(400, 300); S.render(F, { at: [200, 150], scale: 10, yaw, pitch }); return F.svg('test'); };
  const fills = (svg: string): string[] => [...svg.matchAll(/<(?:polygon|path)[^>]*fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  const polys = (svg: string): number => fills(svg).length;

  it('draws the three faces of a box that face the viewer, not the three that face away', () => {
    // three faces show (the long ones are cut into two tiles each, which share a shade)
    expect(new Set(fills(draw(new Solids().box(0, 10, 0, 5, -4, 0, { color: '#c0a060' })))).size).toBe(3);
  });

  it('draws a lower rank first, so a slab on another slab covers it whatever the depth sort says', () => {
    const S = new Solids().box(0, 20, 0, 1, -10, 0, { color: '#ff0000', layer: 0 }).box(0, 20, 1, 1.2, -10, 0, { color: '#00ff00', layer: 1 });
    const f = fills(draw(S));
    const red = (h: string): boolean => parseInt(h.slice(1, 3), 16) > parseInt(h.slice(3, 5), 16);
    const lastRed = f.map(red).lastIndexOf(true), firstGreen = f.map(red).indexOf(false);
    expect(lastRed).toBeGreaterThanOrEqual(0);
    expect(firstGreen).toBeGreaterThan(lastRed);
  });

  it('cuts a long flat face into tiles and still fills it', () => {
    expect(polys(draw(new Solids().box(0, 40, 0, 1, -12, 0, { color: '#808080' })))).toBeGreaterThan(8);
  });
});
