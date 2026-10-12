/** Visual finishing geometry (D-44, D-54): the crowned rear transom, rounded seat back, handlebow and finish tags. (The sheer line went with the curved hull and the front transom at D-54; the sled side profile is tested in body.test.ts.) */
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams } from '../params';
import { buildModel } from './index';
import { liftSlot, transomTopOutline } from './body';
import { makeCtx } from './build-utils';
import { worldAABB } from './bounds';
import { computeLayout } from './layout';
import { seatBackSupport } from './seat';
import { ROUNDOVER_MAX_FRACTION, minSection } from './finish';
import type { Part, Vec2 } from './types';

const defaults = defaultParams();
const get = (parts: Part[], id: string) => {
  const x = parts.find((q) => q.id === id);
  if (!x) throw new Error(`no part ${id}`);
  return x;
};
const outlineOf = (x: Part): Vec2[] => {
  if (x.geometry.type !== 'extrusion') throw new Error(`${x.id} is not an extrusion`);
  return x.geometry.outline;
};
/** Linear interpolation of a polyline's z at x (the polyline is sorted by x ascending). */
const zAt = (pts: Vec2[], x: number) => {
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0] + 1e-9) {
      const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
      return x1 === x0 ? z1 : z0 + ((z1 - z0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
};

describe('shaped rear transom (D-44, D-54)', () => {
  const parts = buildModel(defaults);
  const { L } = makeCtx(defaults);

  it('the top edge is an arc: the center is the crown above the corners, and the corners are rounded', () => {
    const ol = outlineOf(get(parts, 'transom-rear'));
    const zt = liftSlot(makeCtx(defaults), 'rear').transomTop;
    expect(zt).toBeCloseTo(L.deckTop + defaults.sideHeightRearIn, 9); // as tall as the rear side of the sled profile
    const maxZ = Math.max(...ol.map((q) => q[1]));
    expect(maxZ).toBeCloseTo(zt + defaults.transomCrownIn, 6);
    // the point at the side wall's top is below the corner height (it is rounded off)
    const wTop = Math.max(...ol.map((q) => q[0]));
    const atWall = ol.filter((q) => Math.abs(q[0] - wTop) < 1e-9).map((q) => q[1]);
    expect(Math.max(...atWall)).toBeLessThan(zt - 0.05);
    // the crown is symmetric: the highest point is at the middle
    const top = ol.find((q) => Math.abs(q[1] - maxZ) < 1e-9)!;
    expect(Math.abs(top[0])).toBeLessThan(1);
    // the top is the only crowned edge: the bottom is flat at the joist bottom
    const bottom = ol.filter((q) => q[1] < L.deckTop).map((q) => q[1]);
    expect(new Set(bottom.map((z) => z.toFixed(6))).size).toBe(1);
  });

  it('the lift-slot oak rule still holds along the crowned top (D-37): every top point over the slot is at least liftBarMinIn above it', () => {
    const t = get(parts, 'transom-rear');
    const ol = outlineOf(t);
    const s = liftSlot(makeCtx(defaults), 'rear');
    const top = ol.filter((q) => q[1] > s.transomTop - 0.7).sort((a, b) => a[0] - b[0]);
    for (const y of [-s.lengthIn / 2, 0, s.lengthIn / 2]) expect(zAt(top, y) - s.zTop).toBeGreaterThanOrEqual(defaults.liftBarMinIn - 1e-9);
    // the slot itself did not move
    if (t.geometry.type === 'extrusion') {
      const h = t.geometry.holes![0];
      expect(Math.max(...h.map((q) => q[1]))).toBeCloseTo(s.zTop, 6);
    }
  });

  it('crown 0 and corner radius 0 give back the flat-topped transom', () => {
    const flat = buildModel({ ...defaults, transomCrownIn: 0, transomCornerRadiusIn: 0 });
    const ol = outlineOf(get(flat, 'transom-rear'));
    expect(new Set(ol.filter((q) => q[1] > L.deckTop).map((q) => q[1].toFixed(6))).size).toBe(1);
  });

  it('a lower rear side gives a lower transom, but never lower than the slot plus its oak (the rule wins over the profile)', () => {
    const p = { ...defaults, sideHeightRearIn: 10 };
    const t = worldAABB(get(buildModel(p), 'transom-rear'));
    expect(t.max[2]).toBeCloseTo(Math.max(L.deckTop + 10, liftSlot(makeCtx(p), 'rear').zTop + defaults.liftBarMinIn) + defaults.transomCrownIn, 6);
  });

  it('transomTopOutline is symmetric and CCW-continuable', () => {
    const o = transomTopOutline(8, 20, 0.5, 0.75);
    for (const [y, z] of o) expect(o.some(([y2, z2]) => Math.abs(y2 + y) < 1e-9 && Math.abs(z2 - z) < 1e-9)).toBe(true);
    expect(o[0][0]).toBeCloseTo(8, 9);
    expect(o[o.length - 1][0]).toBeCloseTo(-8, 9);
  });

  it('there is no front transom and no D-44 sheer rise: the bow is the shaped oak bulkhead (D-57), an extrusion with a curved top', () => {
    expect(parts.some((x) => x.id === 'transom-front')).toBe(false);
    expect(Object.keys(PARAM_DEFS)).not.toContain('sheerRiseIn');
    const b = get(parts, 'bow-bulkhead');
    expect(b.geometry.type).toBe('extrusion');
    expect(outlineOf(b).length).toBeGreaterThan(20); // crowned top, rounded corners
  });
});

describe('seat back, handle and finish tags (D-44)', () => {
  const parts = buildModel(defaults);

  it('the seat back pad is a rounded-rectangle extrusion, soft, with more than 4 outline points', () => {
    const pad = get(parts, 'seat-back-pad');
    expect(pad.geometry.type).toBe('extrusion');
    expect(outlineOf(pad).length).toBeGreaterThan(8);
    expect(pad.finish?.soft).toBe(true);
    expect(pad.finish?.surface).toBe('vinyl');
    expect(pad.massLb).toBeGreaterThan(0);
  });

  it('the pad lies on the back: its width across matches the back frame', () => {
    const o = outlineOf(get(parts, 'seat-back-pad'));
    const xs = o.map((q) => q[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(seatBackSupport(defaults, computeLayout(defaults)).W, 6);
  });

  it('the push handle is a gently crowned handlebow (D-53, D-57): one bandsawn board whose top edge is highest in the middle, crown 7/8 in above the post tops', () => {
    const bar = get(parts, 'handle-bar');
    expect(bar.geometry.type).toBe('extrusion');
    expect(bar.kind).toBe('lumber');
    expect(bar.grain).toBeDefined();
    const o = outlineOf(bar);
    const top = Math.max(...o.map((q) => q[1]));
    const atMid = o.filter((q) => Math.abs(q[0]) < 1e-9).map((q) => q[1]);
    expect(Math.max(...atMid)).toBeCloseTo(top, 9); // highest in the middle
    expect(top - (defaults.rearHandleHeightIn + defaults.handleBarDiameterIn / 2)).toBeCloseTo(defaults.handleBowCrownIn, 6);
  });

  it('every oak lumber part has a roundover of at most a third of its smallest section; okoume ply, vinyl and wheels are tagged', () => {
    const oak = parts.filter((x) => x.material === 'white oak' && !x.payload);
    expect(oak.length).toBeGreaterThan(40);
    for (const x of oak) {
      expect(x.finish?.surface, x.id).toBe('oak');
      expect(x.finish?.roundoverIn, x.id).toBeGreaterThan(0);
      expect(x.finish!.roundoverIn!, x.id).toBeLessThanOrEqual(defaults.roundoverIn + 1e-12);
      expect(x.finish!.roundoverIn!, x.id).toBeLessThanOrEqual(minSection(x.geometry) * ROUNDOVER_MAX_FRACTION + 1e-9);
    }
    // the 0.234" sandwich gunwale band is capped at a third of its thickness (0.078"); a 3/4" rail takes a third of 1/4"
    expect(get(parts, 'side-L-gunwale').finish?.roundoverIn).toBeCloseTo(computeLayout(defaults).sideBand / 3, 9);
    expect(get(parts, 'rail-L').finish?.roundoverIn).toBeCloseTo(defaults.railThicknessIn / 3, 9);
    expect(parts.some((x) => x.finish?.roundoverIn === defaults.roundoverIn)).toBe(true);
    for (const x of parts.filter((q) => q.material.includes('plywood'))) expect(x.finish?.surface, x.id).toBe('okoume');
    for (const id of ['seat-cushion', 'seat-back-pad']) expect(get(parts, id).finish).toMatchObject({ soft: true, surface: 'vinyl' });
    for (const w of parts.filter((q) => q.geometry.type === 'wheel')) expect(w.finish).toMatchObject({ tread: 'lug', surface: 'rubber' });
    expect(parts.filter((q) => q.geometry.type === 'wheel')).toHaveLength(4);
    expect(get(parts, 'handle-socket-L').finish?.surface).toBe('aluminum');
    // the pivoting front axle (D-56): the tongue plate and kingpin are blackened steel; the beam, king beam and stops are oak; the thrust washer is UHMW; the shackle is steel
    expect(get(parts, 'kingpin').finish?.surface).toBe('blackened');
    expect(get(parts, 'bridle-tongue').finish?.surface).not.toBe('blackened'); // the oak tongue (D-58) is finished like the rest of the oak
    expect(get(parts, 'bridle-sleeve').finish?.surface).toBe('steel'); // bronze sleeve (D-62: no shackle)
    expect(get(parts, 'king-thrust').finish?.surface).toBe('asa');
    for (const id of ['axle-hanger-L', 'beam-F', 'king-beam', 'bridle-tongue']) expect(get(parts, id).finish?.surface, id).toBe('oak');
    expect(get(parts, 'bow-bulkhead').finish?.surface).toBe('oak');
    expect(get(parts, 'bow-bulkhead').finish?.roundoverIn).toBeGreaterThan(0);
    expect(get(parts, 'sign-L').finish?.surface).toBe('okoume');
    expect(parts.some((x) => /^(stick-cable|cable-crossbar|lap-belt|belt-anchor|guard-)/.test(x.id))).toBe(false);
    expect(parts.find((x) => x.material.includes('rope'))!.finish?.surface).toBe('rope');
  });

  it('roundover 0 leaves oak untagged for edges but still tags the surface', () => {
    const flat = buildModel({ ...defaults, roundoverIn: 0 });
    const x = get(flat, 'side-L-gunwale');
    expect(x.finish?.roundoverIn).toBeUndefined();
    expect(x.finish?.surface).toBe('oak');
  });

  it('finish never changes the mass or the geometry: the same model with roundover 0 weighs the same', () => {
    const a = buildModel(defaults), b = buildModel({ ...defaults, roundoverIn: 0 });
    expect(b.reduce((s, x) => s + x.massLb, 0)).toBeCloseTo(a.reduce((s, x) => s + x.massLb, 0), 9);
  });
});
