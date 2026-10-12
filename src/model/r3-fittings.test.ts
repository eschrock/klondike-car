/** Phase 3 round 3, fittings fixes (D-47): lash plate pattern, storage clearance, build order. (The turntable-era kingpin, stop-block and access-opening tests went with those parts at the Phase 3b flip; the Ackermann build order and the finger guard went at D-54.) */
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
    expect(p.storageSideClearIn).toBeGreaterThan(0); // 3c-4b widened the side clearance (the box stands off the chine by this much)
    const fit = packEssentials(storageInterior(p, L));
    expect(fit.fits).toBe(true);
  });
});

describe('S10: build order', () => {
  it('hull first (with the king beam and the chain joist in the frame), then the axles and wheels on the inverted hull, then (hull upright) the tongue plate, the bridle and the seat (D-56)', () => {
    expect(STEP.frame).toBeLessThan(STEP.body);
    expect(HULL_STEP.transom).toBeLessThan(STEP.steering);
    expect(STEP.steering).toBeLessThan(STEP.gear);
    expect(STEP.gear).toBeLessThan(STEP.linkage);
    expect(STEP.linkage).toBeLessThan(STEP.spindles);
    expect(STEP.spindles).toBeLessThan(STEP.seatStorage);
    const transom = get('transom-rear').step;
    // the king beam and the stops are part of the frame glue-up with the deck (before the sides and the transom)
    for (const id of ['king-beam', 'joist-5', 'joist-7']) expect(get(id).step, id).toBe(STEP.frame);
    for (const id of ['axle-R', 'axle-hanger-L', 'beam-F', 'axle-FL', 'axle-FR', 'kingpin', 'steer-eye-L', 'steer-anchor-L', 'roll-pad-L']) expect(get(id).step, id).toBeGreaterThan(transom);
    // the hangers, both axles and the kingpin go on before the tongue and the bridle are bolted on with the hull upright
    expect(get('axle-hanger-L').step).toBe(STEP.gear);
    expect(get('axle-R').step).toBe(STEP.gear);
    for (const id of ['beam-F', 'axle-FL', 'kingpin', 'king-thrust', 'wheel-FL', 'wheel-FR']) expect(get(id).step, id).toBe(STEP.gear);
    for (const id of ['bridle-tongue', 'bridle-eye', 'bridle']) expect(get(id).step, id).toBe(STEP.spindles);
    expect(get('king-beam').step).toBeLessThan(get('bridle-tongue').step);
    expect(get('axle-R').step).toBeLessThanOrEqual(get('wheel-FL').step);
    // the deck is glued to the frame and the sides before the transom slides on last (HULL_STEP)
    expect(get('deck').step).toBe(HULL_STEP.deck);
    expect(get('side-L-chine').step).toBe(HULL_STEP.sides);
    expect(HULL_STEP.deck).toBeLessThan(HULL_STEP.sides);
    expect(HULL_STEP.sides).toBeLessThan(HULL_STEP.transom);
    expect(get('bow-bulkhead').step).toBe(HULL_STEP.transom);
  });
});

describe('N-9 (D-54): the finger guards went with the curved bow', () => {
  it('there are none, and the defaults still validate', () => {
    expect(parts.some((x) => /^guard-/.test(x.id))).toBe(false);
    expect(validateParams(defaultParams()).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
