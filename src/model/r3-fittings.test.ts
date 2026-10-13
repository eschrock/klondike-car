/** Phase 3 round 3, fittings fixes (D-47): lash plate pattern, storage clearance, build order. (The turntable-era kingpin, stop-block and access-opening tests went with those parts at the Phase 3b flip; the Ackermann build order and the finger guard went at D-54.) */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, validateParams } from '../params';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { worldAABB } from './bounds';
import { STEP, HULL_STEP } from './build-utils';
import { storageGeometry } from './storage';
import { LASH_HOLE_DX_IN, LASH_HOLE_DZ_IN, LASH_PLATE } from './side-ribs';
import { packEssentials, storageInterior } from './storage';

const p = resolveParams(defaultParams());
const L = computeLayout(p);
const parts = buildModel(p);
const get = (id: string) => parts.find((x) => x.id === id)!;

describe('S8 / D-76: lash plate pattern fits the rib head and is drawn', () => {
  it('each plate sits on its rib head with 4 bolts at +-0.5625 x +-0.25, inside the 2" x band-tall head (the old 1" doubler is gone)', () => {
    const pl = get('lash-L1'), rib = get('side-rib-L1');
    const sp = pl.joints!.find((j) => j.type === 'bolt')!;
    expect(sp.at).toHaveLength(4);
    for (const a of sp.at!) { expect(Math.abs(a[0])).toBeCloseTo(LASH_HOLE_DX_IN, 9); expect(Math.abs(a[1])).toBeCloseTo(LASH_HOLE_DZ_IN, 9); expect(a[2]).toBeCloseTo(-LASH_PLATE.folded / 2, 9); } // local: x along the gunwale, y up, z off the head face
    // the holes stay 3/16 in or more inside the head's ends and the band's edges
    expect(p.sideRibHeadLengthIn / 2 - LASH_HOLE_DX_IN).toBeGreaterThanOrEqual(0.375);
    expect(p.railBandIn / 2 - LASH_HOLE_DZ_IN).toBeGreaterThanOrEqual(0.375);
    expect(LASH_PLATE.len).toBeLessThanOrEqual(p.sideRibHeadLengthIn);
    expect(rib.joints!.find((j) => j.type === 'hole' && j.to === 'lash-L1')!.at).toHaveLength(4);
    expect(get('doubler-lash-L1')).toBeUndefined();
    // the plate's footprint lies over the head, fore and aft
    const a = worldAABB(pl), d = worldAABB(rib);
    expect(a.min[0]).toBeGreaterThanOrEqual(d.min[0] - 1e-6);
    expect(a.max[0]).toBeLessThanOrEqual(d.max[0] + 1e-6);
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
    for (const id of ['king-beam', 'joist-5', 'joist-8']) expect(get(id).step, id).toBe(STEP.frame);
    for (const id of ['axle-R', 'beam-F', 'axle-FL', 'axle-FR', 'kingpin', 'steer-eye-L', 'steer-anchor-L', 'roll-pad-L']) expect(get(id).step, id).toBeGreaterThan(transom);
    // Phase 4: the hangers go in with the frame (joist-1's end Dominos are in them); both axles and the kingpin go on before the tongue and the bridle are bolted on with the hull upright
    expect(get('axle-hanger-L').step).toBe(STEP.frame);
    expect(get('axle-R').step).toBe(STEP.gear);
    for (const id of ['beam-F', 'axle-FL', 'kingpin', 'king-thrust', 'wheel-FL', 'wheel-FR']) expect(get(id).step, id).toBe(STEP.gear);
    for (const id of ['bridle-tongue', 'bridle']) expect(get(id).step, id).toBe(STEP.spindles);
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
