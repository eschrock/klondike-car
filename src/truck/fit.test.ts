import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { buildModel, type ViewState } from '../model';
import { translation } from '../model/mat4';
import type { Part } from '../model/types';
import { buildTruckBed } from './bed';
import { checkTruckFit, type CartView } from './fit';

const stub = (p = defaultParams()) => (v: CartView) => buildModel(p, v as ViewState);

function box(id: string, size: [number, number, number], at: [number, number, number], extra: Partial<Part> = {}): Part {
  return {
    id, name: id, group: 'body', kind: 'lumber', material: 'oak', geometry: { type: 'box', size },
    transform: translation(...at), body: 'chassis', massLb: 1, fab: 'none', step: 1, ...extra,
  };
}

describe('truck bed', () => {
  it('is all payload reference parts in the truck frame', () => {
    const bed = buildTruckBed(defaultParams());
    expect(bed.length).toBe(7);
    expect(bed.every((b) => b.payload && b.group === 'reference' && b.body === 'truck')).toBe(true);
    expect(buildTruckBed(defaultParams(), { ground: true }).length).toBe(8);
  });
});

describe('checkTruckFit with the stub model', () => {
  const p = defaultParams();
  const r = checkTruckFit(p, stub(p));
  it('returns all 8 cases and overall dimensions', () => {
    expect(r.cases.length).toBe(8);
    expect(r.dims.installed.lengthIn).toBeGreaterThan(0);
    expect(r.evalMs).toBeLessThan(500);
  });
  it('every case has a placement and consistent verdict', () => {
    for (const c of r.cases) {
      expect(c.placement).not.toBeNull();
      expect(c.fits).toBe(c.colliding.length === 0 && c.modeFeasible);
    }
  });
  it('beside fits at default track in transport config (D-8: tongue/handle must come off)', () => {
    const c = r.cases.find((x) => x.mode === 'beside' && x.config === 'removed')!;
    expect(c.fits).toBe(true);
    expect(c.minClearanceIn).toBeGreaterThanOrEqual(p.truckClearanceIn - 1e-9);
  });
});

describe('checkTruckFit synthetic parts', () => {
  const p = defaultParams();
  it('a small box fits; an over-wide box collides with walls', () => {
    const small = [box('a', [20, 20, 6], [0, 0, 3])];
    expect(checkTruckFit(p, () => small).anyFits).toBe(true);
    const wide = [box('wide', [30, p.truckBedWidthIn + 6, 4], [0, 0, 20])];
    const r = checkTruckFit(p, () => wide);
    expect(r.anyFits).toBe(false);
    const c = r.best!;
    expect(c.colliding.some((q) => q.partId === 'wide' && q.solidId.startsWith('truck-wall'))).toBe(true);
  });
  it('a low slab wider than the well gap fits only ahead of / behind the wells', () => {
    const lowWide = [box('slab', [10, p.truckWellGapIn + 6, 4], [0, 0, 2])];
    const r = checkTruckFit(p, () => lowWide);
    expect(r.anyFits).toBe(true);
    const tx = r.best!.placement!.txIn;
    expect(tx + 5 <= p.truckWellStartIn - p.truckClearanceIn + 1e-9 || tx - 5 >= p.truckWellStartIn + p.truckWellLengthIn).toBe(true);
  });
  it('too long for bed + tailgate does not fit', () => {
    const long = [box('long', [p.truckBedLengthIn + p.truckTailgateLengthIn + 5, 10, 4], [0, 0, 2])];
    const r = checkTruckFit(p, () => long);
    expect(r.anyFits).toBe(false);
    expect(r.best!.colliding.length).toBeGreaterThan(0);
  });
  it('ignores the bridle and payload parts', () => {
    const parts = [box('a', [20, 20, 6], [0, 0, 3]), box('bridle', [500, 2, 2], [0, 0, 1]), box('rider', [500, 99, 99], [0, 0, 0], { payload: true })];
    expect(checkTruckFit(p, () => parts).anyFits).toBe(true);
  });
  it('removed config can fit when installed does not', () => {
    const parts = (v: CartView) => [box('a', [20, 20, 6], [0, 0, 3]), ...(v.removed ? [] : [box('tall', [10, 10, 80], [0, 0, 40], { removable: true })])];
    const r = checkTruckFit(p, parts);
    // tall box fits in bed (no roof), so make it too long instead
    expect(r.cases.length).toBe(8);
    const long = (v: CartView) => [box('a', [20, 20, 6], [0, 0, 3]), ...(v.removed ? [] : [box('tongue', [100, 2, 2], [40, 0, 3], { removable: true })])];
    const r2 = checkTruckFit(p, long);
    expect(r2.cases.filter((c) => c.config === 'installed').some((c) => c.fits)).toBe(false);
    expect(r2.cases.filter((c) => c.config === 'removed').some((c) => c.fits)).toBe(true);
  });
});

describe('fit performance', () => {
  it('stays fast with a ~150-part cart', () => {
    const p = defaultParams();
    const base = buildModel(p, {});
    const many: Part[] = [...base];
    for (let i = 0; i < 150; i++) many.push(box(`s${i}`, [3, 2, 1], [(i % 30) * 2, ((i % 7) - 3) * 4, 8 + (i % 5)]));
    const r = checkTruckFit(p, () => many);
    expect(r.cases.length).toBe(8);
    expect(r.evalMs).toBeLessThan(50);
    console.log('fit ms (154 parts):', r.evalMs.toFixed(1));
  });
});
