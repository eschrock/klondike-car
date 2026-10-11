/** Phase 3 round 3, front / fittings fixes (D-47): kingpin bolt, stop-block stock, access opening radius, lash plate pattern, storage clearance, build order, finger guard. */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, validateParams } from '../params';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { worldAABB } from './bounds';
import { STEP, HULL_STEP } from './build-utils';
import { KINGPIN_FLOOR_OAK_IN, hexBoltThreadIn, kingpinBolt, roundUp32, roundedRectCCW } from './steering';
import { storageGeometry, LASH_HOLE_DX_IN, LASH_HOLE_DY_IN } from './storage';
import { packEssentials, storageInterior } from './storage';

const p = resolveParams(defaultParams());
const L = computeLayout(p);
const parts = buildModel(p);
const get = (id: string) => parts.find((x) => x.id === id)!;

describe('S5: the kingpin is a real grade-8 hex bolt with the shear planes on the shank', () => {
  it('ASME B18.2.1 thread length: 2D + 1/4" up to 6", 2D + 1/2" over', () => {
    expect(hexBoltThreadIn(0.75, 6)).toBeCloseTo(1.75, 9);
    expect(hexBoltThreadIn(0.75, 6.5)).toBeCloseTo(2, 9);
  });
  it('3/4-10 x 6" (shank 4.25") reaches 1/4" past the top of the crossbar plate; cut to 5-1/8" at the nut', () => {
    const kp = L.kpPlates!;
    const b = kingpinBolt(0.75, kp.under.z0, kp.bar.z1, kp.bar.z1 + KINGPIN_FLOOR_OAK_IN);
    expect(b.buyIn).toBe(6);
    expect(b.shankIn).toBeCloseTo(4.25, 9);
    expect(b.zHead + b.shankIn).toBeGreaterThanOrEqual(kp.bar.z1 + 0.25 - 1e-9); // thread starts above every bearing plane
    expect(b.cutIn).toBeLessThan(b.buyIn);
    expect(b.threadLeftIn).toBeGreaterThanOrEqual(b.nutIn + 2 * b.pitchIn - 1e-9);
    expect(b.zTail).toBeLessThan(L.kingpin.z1); // the tail ends inside the counterbore, below the access panel
    const pin = get('kingpin');
    expect(pin.sourcing!.vendor).toMatch(/unthreaded shank 4\.25"/);
    expect(pin.sourcing!.vendor).toMatch(/5-1\/8"/);
    expect(worldAABB(pin).max[2]).toBeCloseTo(b.zTail, 6);
  });
  it('the sleeve is reamed to pin + 0.006" (0.756"), not a zero-clearance 0.750"', () => {
    expect(get('kingpin-sleeve-beam').sourcing!.vendor).toMatch(/0\.756"/);
  });
});

describe('S12: stop blocks are cut from rounded stock with a fit plan', () => {
  it('stock is rounded up to 1/32", the blank is stock + 1/8", and the joint note carries the proud-and-plane procedure', () => {
    for (const id of ['AL', 'AR', 'FL', 'FR']) {
      const b = get(`stop-block-${id}`);
      for (const k of ['t', 'w', 'l'] as const) {
        expect(Math.abs(b.stock![k] * 32 - Math.round(b.stock![k] * 32)), `${id} ${k}`).toBeLessThan(1e-9);
        expect(b.rough![k] - b.stock![k]).toBeCloseTo(p.stopBlockRoughAllowIn, 9);
      }
      expect(b.joints!.some((j) => /PROUD/.test(j.note ?? ''))).toBe(true);
    }
    expect(roundUp32(3.238)).toBeCloseTo(3.25, 9);
  });
});

describe('S12: kingpin-access opening corner radius', () => {
  it('the opening in the nose deck and the panel are rounded to accessOpeningCornerRadiusIn (1")', () => {
    const o = roundedRectCCW(-2.25, 2.25, -1.375, 1.375, 1);
    expect(o.length).toBe(28);
    const deck = get('deck-nose');
    expect(deck.geometry.type === 'extrusion' && deck.geometry.holes![0].length).toBe(28);
    const panel = get('nose-access-panel');
    expect(panel.geometry.type).toBe('extrusion');
    expect(panel.notes).toMatch(/1" corner radii/);
    const bb = worldAABB(panel);
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(p.accessPanelLengthIn, 6);
    expect(p.edgeBandIn).toBeCloseTo(0.25, 9);
  });
});

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
  it('hull first, then the front stack and axles on the inverted hull, then the kingpin from below after turning upright', () => {
    expect(STEP.frame).toBeLessThan(STEP.body);
    expect(HULL_STEP.transom).toBeLessThan(STEP.steering);
    expect(STEP.steering).toBeLessThan(STEP.gear);
    expect(STEP.gear).toBeLessThan(STEP.kingpin);
    expect(STEP.kingpin).toBeLessThan(STEP.seatStorage);
    for (const id of ['turntable', 'bolster-fore', 'beam-F', 'axle-F']) expect(get(id).step, id).toBeGreaterThan(get('transom-rear').step);
    expect(get('kingpin').step).toBe(STEP.kingpin);
  });
});

describe('N-9: finger guard follows the hull outline', () => {
  it('is one mesh per side with positive mass, and the defaults still validate', () => {
    for (const t of ['L', 'R']) { const g = get(`guard-${t}`); expect(g.geometry.type).toBe('mesh'); expect(g.massLb).toBeGreaterThan(0.02); }
    expect(validateParams(defaultParams()).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
