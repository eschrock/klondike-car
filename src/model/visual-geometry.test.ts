/** Visual finishing geometry (D-44): sheer line, crowned transoms, rounded seat back, finish tags. */
import { describe, expect, it } from 'vitest';
import { defaultParams, type Params } from '../params';
import { buildModel } from './index';
import { liftSlot, transomTopOutline } from './body';
import { makeCtx } from './build-utils';
import { worldAABB } from './bounds';
import { computeLayout, sheerRise } from './layout';
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

describe('sheer line (D-44)', () => {
  const ctx = makeCtx(defaults);
  const { L } = ctx;

  it('the rise is 0 behind the start, monotone, and reaches the full rise at the front transom', () => {
    expect(L.sheer.riseIn).toBe(defaults.sheerRiseIn);
    expect(sheerRise(L, L.sheer.x0)).toBe(0);
    expect(sheerRise(L, L.xn)).toBe(0);
    expect(sheerRise(L, L.sheer.x1)).toBeCloseTo(defaults.sheerRiseIn, 9);
    let prev = -1;
    for (let x = L.xRear; x <= L.xFront; x += 0.25) {
      const r = sheerRise(L, x);
      expect(r).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = r;
    }
    // the curve starts flat (zero slope) and is steepest at the bow
    expect(sheerRise(L, L.sheer.x0 + 0.5) - sheerRise(L, L.sheer.x0)).toBeLessThan(sheerRise(L, L.sheer.x1) - sheerRise(L, L.sheer.x1 - 0.5));
  });

  it('the finger-guard zone and the whole cabin stay on the flat gunwale (hazard end is behind the start of the rise)', () => {
    const ctx2 = makeCtx(defaults);
    expect(ctx2.L.sheer.x0).toBeGreaterThan(ctx2.L.xn);
    expect(sheerRise(ctx2.L, ctx2.L.xn + 3)).toBe(0); // the guard hazard zone spans xn .. xn + ~2" at the defaults (D-45)
  });

  it('sheer 0 reproduces the straight gunwale: a box, a 4-point rectangular web, top at the old height', () => {
    const p: Params = { ...defaults, sheerRiseIn: 0 };
    const parts = buildModel(p);
    const c = makeCtx(p).L;
    for (const tag of ['L', 'R']) {
      const gun = get(parts, `side-nose-${tag}-gunwale`);
      expect(gun.geometry.type).toBe('box');
      expect(worldAABB(gun).max[2]).toBeCloseTo(c.sideTop, 9);
      expect(outlineOf(get(parts, `side-nose-${tag}-web`))).toHaveLength(4);
    }
    expect(liftSlot(makeCtx(p), 'front').transomTop).toBeCloseTo(c.sideTop, 9);
  });

  it('with the default sheer the nose gunwale top rises monotonically forward and ends at the full rise', () => {
    const parts = buildModel(defaults);
    for (const tag of ['L', 'R']) {
      const gun = get(parts, `side-nose-${tag}-gunwale`);
      expect(gun.geometry.type).toBe('extrusion');
      const ol = outlineOf(gun);
      const top = ol.filter((q) => q[1] > L.sideTop - L.railBand + 1e-9 && q[1] >= zAt(ol.slice(0, ol.length / 2), q[0]) + L.railBand - 1e-9).sort((a, b) => a[0] - b[0]);
      expect(top.length).toBeGreaterThan(8);
      for (let i = 1; i < top.length; i++) expect(top[i][1]).toBeGreaterThanOrEqual(top[i - 1][1] - 1e-9);
      const bb = worldAABB(gun);
      expect(bb.max[2]).toBeCloseTo(L.sideTop + defaults.sheerRiseIn, 6);
      expect(bb.min[2]).toBeCloseTo(L.sideTop - L.railBand, 6); // the underside is flat at the back, so the chine-to-gunwale gap is the old one there
      // the section stays one rail band tall everywhere
      const half = ol.length / 2;
      for (let i = 0; i < half; i++) expect(ol[2 * half - 1 - i][1] - ol[i][1]).toBeCloseTo(L.railBand, 9);
    }
  });

  it('the web stays captured: its top edge is the gunwale underside plus the groove depth at every sample', () => {
    const parts = buildModel(defaults);
    const g = defaults.grooveDepthIn;
    for (const tag of ['L', 'R']) {
      const gun = get(parts, `side-nose-${tag}-gunwale`), web = get(parts, `side-nose-${tag}-web`);
      const gl = outlineOf(gun);
      // The bow run is set at the bow heading: local x runs along the run, so model x = origin x + local x cos(heading) (ey is straight up, model z = origin z + local y).
      const gunX = (lx: number) => gun.transform[12] + lx * gun.transform[0];
      const under = gl.slice(0, gl.length / 2).map(([lx, ly]) => [gunX(lx), gun.transform[14] + ly] as Vec2); // bottom edge, model x ascending
      const wl = outlineOf(web);
      const wz0 = web.transform[14];
      const top = wl.slice(2);
      for (const [lx, ly] of top) {
        const x = web.transform[12] + lx * web.transform[0];
        if (x > under[under.length - 1][0] + 1e-9) continue; // the web's tail inside the transom dado runs on to the full rise past the (bevel-trimmed) gunwale end
        expect(wz0 + ly, `${tag} x=${x.toFixed(2)}`).toBeCloseTo(zAt(under, x) + g, 6);
      }
      // the web enters the front transom dado at the full rise
      // set at the bow heading: the square end corner pokes about (thickness / 2) sin(heading) further into the dado (0.25" deep), never out of it
      const dadoEnd = L.xFront - L.transom + defaults.deckCaptureDepthIn;
      expect(worldAABB(web).max[0]).toBeGreaterThanOrEqual(dadoEnd - 0.05);
      expect(worldAABB(web).max[0]).toBeLessThan(dadoEnd + 0.1);
      // one edge condition per outline edge, none exposed
      expect(web.edges).toHaveLength(wl.length);
      expect((web.edges as string[]).includes('exposed')).toBe(false);
      // the chine still caps the web from below by the groove depth
      expect(worldAABB(get(parts, `side-nose-${tag}-chine`)).max[2] - worldAABB(web).min[2]).toBeCloseTo(g, 6);
    }
  });

  it('the front transom top follows the sheer at its x; the rear stays at the old height', () => {
    const parts = buildModel(defaults);
    const f = worldAABB(get(parts, 'transom-front'));
    const crown = defaults.transomCrownIn;
    expect(f.max[2]).toBeCloseTo(L.sideTop + defaults.sheerRiseIn + crown, 6);
    const r = worldAABB(get(parts, 'transom-rear'));
    expect(r.max[2]).toBeCloseTo(liftSlot(ctx, 'rear').transomTop + crown, 6);
  });

  it('the structural side section is the lowest one: Layout.sideH is unchanged by the sheer', () => {
    expect(L.sideH).toBe(defaults.sideHeightIn);
    expect(makeCtx({ ...defaults, sheerRiseIn: 0 }).L.sideH).toBe(L.sideH);
  });

  it('mass is computed from the real outline: the sheer adds oak to the nose webs and the front transom', () => {
    const flat = buildModel({ ...defaults, sheerRiseIn: 0 });
    const curved = buildModel(defaults);
    for (const id of ['side-nose-L-web', 'transom-front']) expect(get(curved, id).massLb).toBeGreaterThan(get(flat, id).massLb);
    expect(get(curved, 'side-nose-L-gunwale').massLb).toBeCloseTo(get(flat, 'side-nose-L-gunwale').massLb, 2);
  });
});

describe('shaped transoms (D-44)', () => {
  const parts = buildModel(defaults);
  const { L } = makeCtx(defaults);

  it('the top edge is an arc: the center is the crown above the corners, and the corners are rounded', () => {
    for (const [id, end] of [['transom-rear', 'rear'], ['transom-front', 'front']] as const) {
      const ol = outlineOf(get(parts, id));
      const zt = liftSlot(makeCtx(defaults), end).transomTop;
      const maxZ = Math.max(...ol.map((q) => q[1]));
      expect(maxZ).toBeCloseTo(zt + defaults.transomCrownIn, 6);
      // the point at the side wall's top is below the corner height (it is rounded off)
      const wTop = Math.max(...ol.map((q) => q[0]));
      const atWall = ol.filter((q) => Math.abs(q[0] - wTop) < 1e-9).map((q) => q[1]);
      expect(Math.max(...atWall)).toBeLessThan(zt - 0.05);
    }
  });

  it('the lift-slot oak rule still holds along the crowned top (D-37): every top point over the slot is at least liftBarMinIn above it', () => {
    for (const [id, end] of [['transom-rear', 'rear'], ['transom-front', 'front']] as const) {
      const t = get(parts, id);
      const ol = outlineOf(t);
      const s = liftSlot(makeCtx(defaults), end);
      const top = ol.filter((q) => q[1] > s.transomTop - 0.7).sort((a, b) => a[0] - b[0]);
      for (const y of [-s.lengthIn / 2, 0, s.lengthIn / 2]) expect(zAt(top, y) - s.zTop).toBeGreaterThanOrEqual(defaults.liftBarMinIn - 1e-9);
      // the slot itself did not move
      if (t.geometry.type === 'extrusion') {
        const h = t.geometry.holes![0];
        expect(Math.max(...h.map((q) => q[1]))).toBeCloseTo(s.zTop, 6);
      }
    }
  });

  it('crown 0 and corner radius 0 give back the flat-topped transom', () => {
    const flat = buildModel({ ...defaults, transomCrownIn: 0, transomCornerRadiusIn: 0 });
    const ol = outlineOf(get(flat, 'transom-front'));
    expect(new Set(ol.filter((q) => q[1] > L.deckTop).map((q) => q[1].toFixed(6))).size).toBe(1);
  });

  it('transomTopOutline is symmetric and CCW-continuable', () => {
    const o = transomTopOutline(8, 20, 0.5, 0.75);
    for (const [y, z] of o) expect(o.some(([y2, z2]) => Math.abs(y2 + y) < 1e-9 && Math.abs(z2 - z) < 1e-9)).toBe(true);
    expect(o[0][0]).toBeCloseTo(8, 9);
    expect(o[o.length - 1][0]).toBeCloseTo(-8, 9);
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

  it('the push handle crossbar is a round bar', () => {
    const bar = get(parts, 'handle-bar');
    expect(bar.geometry.type).toBe('cylinder');
    expect(bar.grain).toBeDefined();
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
    // the 5/8" gunwale is capped at a third of its thickness (0.208"); a 1-1/2" rail takes the full 1/4"
    expect(get(parts, 'side-nose-L-gunwale').finish?.roundoverIn).toBeCloseTo(0.625 / 3, 9);
    expect(parts.some((x) => x.finish?.roundoverIn === defaults.roundoverIn)).toBe(true);
    for (const x of parts.filter((q) => q.material.includes('plywood'))) expect(x.finish?.surface, x.id).toBe('okoume');
    for (const id of ['seat-cushion', 'seat-back-pad']) expect(get(parts, id).finish).toMatchObject({ soft: true, surface: 'vinyl' });
    for (const w of parts.filter((q) => q.geometry.type === 'wheel')) expect(w.finish).toMatchObject({ tread: 'lug', surface: 'rubber' });
    expect(parts.filter((q) => q.geometry.type === 'wheel')).toHaveLength(4);
    expect(get(parts, 'handle-socket-L').finish?.surface).toBe('aluminum');
    expect(get(parts, 'kp-bracket-L').finish?.surface).toBe('steel');
    expect(get(parts, 'spindle-L').finish?.surface).toBe('blackened');
    expect(get(parts, 'brake-beam').finish?.surface).toBe('aluminum');
    expect(get(parts, 'brake-lever').finish?.surface).toBe('aluminum');
    expect(get(parts, 'brake-keeper-L').finish?.surface).toBe('steel');
    expect(get(parts, 'brake-lever-grip').finish?.surface).toBe('oak');
    expect(parts.some((x) => /^(stick-cable|cable-crossbar|lap-belt|belt-anchor)/.test(x.id))).toBe(false);
    expect(parts.find((x) => x.material.includes('rope'))!.finish?.surface).toBe('rope');
    expect(get(parts, 'guard-L').finish?.surface).toBe('asa');
  });

  it('roundover 0 leaves oak untagged for edges but still tags the surface', () => {
    const flat = buildModel({ ...defaults, roundoverIn: 0 });
    const x = get(flat, 'side-nose-L-gunwale');
    expect(x.finish?.roundoverIn).toBeUndefined();
    expect(x.finish?.surface).toBe('oak');
  });

  it('finish never changes the mass or the geometry: the same model with roundover 0 weighs the same', () => {
    const a = buildModel(defaults), b = buildModel({ ...defaults, roundoverIn: 0 });
    expect(b.reduce((s, x) => s + x.massLb, 0)).toBeCloseTo(a.reduce((s, x) => s + x.massLb, 0), 9);
  });
});
