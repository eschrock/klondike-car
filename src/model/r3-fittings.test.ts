/** Phase 3 round 3, fittings fixes (D-47): lash plate pattern, storage clearance, build order, finger guard. (The turntable-era kingpin, stop-block and access-opening tests went with those parts at the Phase 3b flip.) */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, validateParams } from '../params';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { worldAABB } from './bounds';
import { STEP, HULL_STEP } from './build-utils';
import { storageGeometry, LASH_HOLE_DX_IN, LASH_HOLE_DY_IN } from './storage';
import { packEssentials, storageInterior } from './storage';

const p = resolveParams(defaultParams());
const L = computeLayout(p);
const parts = buildModel(p);
const get = (id: string) => parts.find((x) => x.id === id)!;

describe('S8: lash plate pattern fits and is drawn', () => {
  it('each plate sits on a 1" doubler with 4 screws at +-0.5625 x +-0.25 that stay 0.25" inside the doubler faces', () => {
    const pl = get('lash-L1'), dbl = get('doubler-lash-L1');
    const sp = pl.joints!.find((j) => j.type === 'screw')!;
    expect(sp.at).toHaveLength(4);
    for (const a of sp.at!) { expect(Math.abs(a[0])).toBeCloseTo(LASH_HOLE_DX_IN, 9); expect(Math.abs(a[1])).toBeCloseTo(LASH_HOLE_DY_IN, 9); }
    expect(dbl.geometry.type === 'box' && dbl.geometry.size[1]).toBeCloseTo(p.lashDoublerThickIn, 9);
    expect(p.lashDoublerThickIn / 2 - LASH_HOLE_DY_IN).toBeGreaterThanOrEqual(0.25 - 1e-9);
    expect(dbl.joints!.find((j) => j.type === 'screw')!.at).toHaveLength(4);
    // plate footprint lies wholly over the doubler, inboard of the gunwale inner face
    const a = worldAABB(pl), d = worldAABB(dbl);
    expect(a.min[1]).toBeGreaterThanOrEqual(d.min[1] - 1e-6);
    expect(a.max[1]).toBeLessThanOrEqual(d.max[1] + 1e-6);
  });
});

describe('S3: storage box clearance to the chine', () => {
  it('the box is 2 x 1/8" narrower than the chine inner width and still holds the 10 Essentials', () => {
    const g = storageGeometry(p, L);
    expect(g.hw).toBeCloseTo(L.hwC - p.storageSideClearIn, 9);
    expect(p.storageSideClearIn).toBeCloseTo(0.125, 9);
    const fit = packEssentials(storageInterior(p, L));
    expect(fit.fits).toBe(true);
  });
});

describe('S10: build order', () => {
  it('hull first, then the front beam and axles on the inverted hull, then the spindles, linkage and tongue after turning upright', () => {
    expect(STEP.frame).toBeLessThan(STEP.body);
    expect(HULL_STEP.transom).toBeLessThan(STEP.steering);
    expect(STEP.steering).toBeLessThan(STEP.gear);
    expect(STEP.gear).toBeLessThan(STEP.linkage);
    expect(STEP.linkage).toBeLessThan(STEP.spindles);
    expect(STEP.spindles).toBeLessThan(STEP.seatStorage);
    for (const id of ['beam-F', 'kp-bracket-L', 'axle-R']) expect(get(id).step, id).toBeGreaterThan(get('transom-rear').step);
    expect(get('spindle-L').step).toBe(STEP.spindles);
    expect(get('tie-rod').step).toBe(STEP.linkage);
    expect(get('beam-F').step).toBeLessThan(get('spindle-L').step);
  });
});

describe('N-9: finger guard follows the hull outline', () => {
  it('is one mesh per side with positive mass, and the defaults still validate', () => {
    for (const t of ['L', 'R']) { const g = get(`guard-${t}`); expect(g.geometry.type).toBe('mesh'); expect(g.massLb).toBeGreaterThan(0.02); }
    expect(validateParams(defaultParams()).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
