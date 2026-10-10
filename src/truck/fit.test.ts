import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { buildModel, type ViewState } from '../model';
import { translation } from '../model/mat4';
import type { Part } from '../model/types';
import { buildTruckBed } from './bed';
import { checkTruckFit, computeFeasibleWindows, configParts, type CartView } from './fit';

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
    expect(bed.length).toBe(8); // floor, bulkhead, cab, 2 walls, 2 wells, tailgate
    expect(bed.every((b) => b.payload && b.group === 'reference' && b.body === 'truck')).toBe(true);
    expect(buildTruckBed(defaultParams(), { ground: true }).length).toBe(9);
  });
  it('models the cab wall above the bulkhead and a real hinge gap', () => {
    const p = defaultParams();
    const bed = buildTruckBed(p);
    const cab = bed.find((b) => b.id === 'truck-cab')!;
    const top = cab.transform[14] + (cab.geometry as { size: number[] }).size[2] / 2;
    expect(top).toBeCloseTo(p.truckCabHeightIn, 6);
    const tg = bed.find((b) => b.id === 'truck-tailgate')!;
    const tgStart = tg.transform[12] - (tg.geometry as { size: number[] }).size[0] / 2;
    expect(tgStart).toBeCloseTo(p.truckBedLengthIn + p.truckTailgateGapIn, 6);
  });
});

describe('checkTruckFit with the stub model', () => {
  const p = defaultParams();
  const r = checkTruckFit(p, stub(p));
  it('returns all 12 cases and overall dimensions', () => {
    expect(r.cases.length).toBe(12);
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
    expect(r.cases.length).toBe(12);
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
    expect(r.cases.length).toBe(12);
    expect(r.evalMs).toBeLessThan(50);
    console.log('fit ms (154 parts):', r.evalMs.toFixed(1));
  });
});

describe('real cart (D-6, D-23)', () => {
  const p = defaultParams();
  const build = (q: ReturnType<typeof defaultParams>) => (v: CartView) => buildModel(q, v as ViewState);
  const find = (r: ReturnType<typeof checkTruckFit>, mode: string, config: string) =>
    r.cases.filter((c) => c.mode === mode && c.config === config);
  const r = checkTruckFit(p, build(p));

  it('has three configurations; the tongue-off cart is shorter than installed, removed shorter still', () => {
    expect(r.dims['tongue-off'].lengthIn).toBeLessThan(r.dims.installed.lengthIn);
    expect(r.dims.removed.lengthIn).toBeLessThanOrEqual(r.dims['tongue-off'].lengthIn);
    const names = configParts('tongue-off', build(p)).map((x) => x.id + x.name);
    expect(names.some((n) => /tongue|bridle/i.test(n))).toBe(false);
  });
  it('straddle fits (transport config) with wheel footprints wholly outside the well zone', () => {
    const c = find(r, 'straddle', 'removed').find((x) => x.fits)!;
    expect(c).toBeTruthy();
    const ws = p.truckWellStartIn, we = ws + p.truckWellLengthIn;
    const parts = configParts('removed', build(p));
    const M = c.placement!.transform;
    // wheel x-extent in truck frame = centre (via M) +- radius
    for (const w of parts.filter((x) => x.geometry.type === 'wheel')) {
      const cx = M[0] * w.transform[12] + M[4] * w.transform[13] + M[12];
      const rad = (w.geometry as { diameter: number }).diameter / 2;
      const outside = cx + rad <= ws - p.truckClearanceIn + 1e-6 || cx - rad >= we + p.truckClearanceIn - 1e-6;
      expect(outside).toBe(true);
    }
    expect(c.minClearanceIn).toBeGreaterThanOrEqual(p.truckClearanceIn - 1e-9);
  });
  it('straddle fails for a short wheelbase (44)', () => {
    const q = { ...p, wheelbaseIn: 44 };
    const rr = checkTruckFit(q, build(q));
    expect(find(rr, 'straddle', 'removed').some((x) => x.fits)).toBe(false);
  });
  it('beside fits only when the track fits the well gap', () => {
    const q = { ...p, rearTrackIn: 40, frontTrackIn: 40 };
    const rr = checkTruckFit(q, build(q));
    expect(find(rr, 'beside', 'removed').some((x) => x.fits)).toBe(false);
    expect(find(r, 'beside', 'removed').some((x) => x.fits)).toBe(true);
  });
  it('feasible windows: max track is monotone-consistent and contains the current fit', async () => {
    const w = await computeFeasibleWindows(p, (q, v) => buildModel(q, v as ViewState));
    expect(w).not.toBeNull();
    const beside = w!.windows.find((x) => x.mode === 'beside' && x.config === 'removed')!;
    expect(beside.fitsNow).toBe(true);
    expect(beside.maxTrackIn!).toBeGreaterThanOrEqual(p.rearTrackIn);
    const q = { ...p, rearTrackIn: beside.maxTrackIn!, frontTrackIn: beside.maxTrackIn! };
    expect(find(checkTruckFit(q, build(q)), 'beside', 'removed').some((x) => x.fits)).toBe(true);
    const wider = { ...p, rearTrackIn: beside.maxTrackIn! + 1, frontTrackIn: beside.maxTrackIn! + 1 };
    expect(find(checkTruckFit(wider, build(wider)), 'beside', 'removed').some((x) => x.fits)).toBe(false);
    const st = w!.windows.find((x) => x.mode === 'straddle' && x.config === 'removed')!;
    expect(st.wheelbaseMinIn!).toBeLessThanOrEqual(p.wheelbaseIn);
    expect(st.maxTrackIn!).toBeGreaterThan(beside.maxTrackIn!);
  }, 60000);
});

describe('cab and hinge gap', () => {
  it('a part above the bed walls collides with the cab wall, and does not when the cab is low', () => {
    const p = defaultParams();
    const hi = [box('long', [80.9, 4, 2], [0, 0, 28])];
    expect(checkTruckFit(p, () => hi).anyFits).toBe(false);
    const q = { ...p, truckCabHeightIn: 18 };
    expect(checkTruckFit(q, () => hi).anyFits).toBe(true);
  });
  it('a tire never rests over the tailgate hinge gap', () => {
    const p = { ...defaultParams(), truckTailgateGapIn: 3 };
    const wheel: Part = { ...box('wheel-x', [13, 4, 13], [0, 0, 6.5]), geometry: { type: 'wheel', diameter: 13, width: 4, hubDiameter: 4, hubLength: 4, bore: 1 } };
    const r = checkTruckFit(p, () => [wheel]);
    for (const c of r.cases.filter((x) => x.fits)) {
      const cx = c.placement!.transform[12] + (c.placement!.yawDeg === 0 ? 0 : 0);
      expect(Math.abs(cx - (p.truckBedLengthIn + 1.5))).toBeGreaterThan(1.5);
    }
  });
});

describe('fit timing', () => {
  it('real cart fit is fast when warm', () => {
    const p = defaultParams();
    checkTruckFit(p, stub(p));
    const r = checkTruckFit(p, stub(p));
    console.log('warm real-cart fit ms:', r.evalMs.toFixed(1));
    expect(r.evalMs).toBeLessThan(150);
  });
});
