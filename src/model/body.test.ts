/**
 * The D-54 body: straight parallel sides, the sled side profile, the curled bow, the rear transom with its lift slot, the scuppers and the provisional signs.
 * Expected numbers are re-derived from the params (docs/phase3c-3a-notes.md), not read back from the builder.
 */
import { describe, expect, it } from 'vitest';
import { bowCurl, defaultParams, sideHeightAt, validateParams, type Params } from '../params';
import { buildModel } from './index';
import { computeLayout, sideHeightAtX, sideSlopeAt, sideTopAt, webTopAt } from './layout';
import { curlPath, liftBarStressPsi, liftSlot, scupperSites } from './body';
import { makeCtx } from './build-utils';
import { worldAABB } from './bounds';
import type { Part, Vec2 } from './types';

const defaults = defaultParams();
const L = computeLayout(defaults);
const parts = buildModel(defaults);
const get = (ps: Part[], id: string) => {
  const x = ps.find((q) => q.id === id);
  if (!x) throw new Error(`no part ${id}`);
  return x;
};
const outlineOf = (x: Part): Vec2[] => {
  if (x.geometry.type !== 'extrusion') throw new Error(`${x.id} is not an extrusion`);
  return x.geometry.outline;
};
const errorsOf = (p: Params) => validateParams(p).filter((i) => i.severity === 'error');
/** World (x, z) of an extrusion outline point whose frame is [ex = x, ey = z]: the side members and webs. */
const sideXZ = (x: Part, q: Vec2): Vec2 => [x.transform[12] + q[0] * x.transform[0], x.transform[14] + q[1] * x.transform[5 + 1]];
/** Gunwale top edge (the second half of its outline) as world (x, z). */
const topEdge = (g: Part): Vec2[] => {
  const o = outlineOf(g);
  return o.slice(o.length / 2).map((q) => sideXZ(g, q)).sort((a, b) => a[0] - b[0]);
};
const bottomEdge = (g: Part): Vec2[] => {
  const o = outlineOf(g);
  return o.slice(0, o.length / 2).map((q) => sideXZ(g, q)).sort((a, b) => a[0] - b[0]);
};

// The same numbers by hand, from the defaults: rear transom outer face x = -10, 3/4 in thick; the bow tip at 44 + 12 = 56 in.
const xRear = -defaults.rearOverhangIn;
const xSideStart = xRear + defaults.transomThicknessIn; // -9.25
const R = defaults.bowCurlRadiusIn;
const thick = defaults.bowCurlPlies * defaults.bowCurlPlyIn; // 0.472
const rIn = R - thick / 2; // inside radius 6.764
const angle = (defaults.bowCurlAngleDeg * Math.PI) / 180;
const xTip = defaults.wheelbaseIn + defaults.frontOverhangIn; // 56
const xFlatEnd = xTip - R * Math.sin(angle); // 49.106
const xSideEnd = xFlatEnd + Math.sqrt(rIn * rIn - (rIn - defaults.sideHeightBowIn) ** 2); // where the inside face has risen to 4 in
const hw = defaults.bodyWidthIn / 2 - defaults.sideThicknessIn; // inside half width 11.375

describe('layout numbers (D-54)', () => {
  it('the hand-derived flat deck end, side end and tip match the layout', () => {
    expect(L.xRear).toBe(xRear);
    expect(L.xSideStart).toBeCloseTo(xSideStart, 12);
    expect(L.xFront).toBeCloseTo(xTip, 12);
    expect(L.xFlatEnd).toBeCloseTo(xFlatEnd, 9);
    expect(L.xSideEnd).toBeCloseTo(xSideEnd, 9);
    expect(L.xFlatEnd).toBeCloseTo(49.1, 1);
    expect(L.xSideEnd).toBeCloseTo(55.3, 1);
    expect(L.hwC).toBeCloseTo(hw, 12);
    expect(L.deckTop).toBe(8); // D-56
    expect(L.deckTop).toBe(defaults.deckHeightIn);
    expect(L.sideRear).toBe(16);
    expect(L.sideH).toBe(4);
    expect(L.sideTop).toBe(24);
  });
});

describe('straight parallel sides', () => {
  it('the outer faces of chine, gunwale and rail are at +/- bodyWidth / 2 and the web is captured between the inner and outer faces', () => {
    for (const [tag, s] of [['L', 1], ['R', -1]] as const) {
      for (const part of ['chine', 'gunwale']) {
        const b = worldAABB(get(parts, `side-${tag}-${part}`));
        expect(s > 0 ? b.max[1] : -b.min[1], `${tag} ${part} outer`).toBeCloseTo(12, 9);
        expect(s > 0 ? b.min[1] : -b.max[1], `${tag} ${part} inner`).toBeCloseTo(12 - defaults.sideThicknessIn, 9);
      }
      const w = worldAABB(get(parts, `side-${tag}-web`));
      expect(Math.min(Math.abs(w.min[1]), Math.abs(w.max[1]))).toBeGreaterThan(hw);
      expect(Math.max(Math.abs(w.min[1]), Math.abs(w.max[1]))).toBeLessThan(12);
      expect(w.max[1] - w.min[1]).toBeCloseTo(defaults.panelPlyIn, 9);
      // the rail runs flush under the chine: same outer face
      const r = worldAABB(get(parts, `rail-${tag}`));
      expect(s > 0 ? r.max[1] : -r.min[1]).toBeCloseTo(12, 9);
    }
  });
  it('parallel: every side member has one constant y range (extrusions across y) and the two sides mirror exactly', () => {
    for (const part of ['chine', 'gunwale', 'web']) {
      const a = worldAABB(get(parts, `side-L-${part}`)), b = worldAABB(get(parts, `side-R-${part}`));
      expect(a.min[1]).toBeCloseTo(-b.max[1], 12);
      expect(a.max[1]).toBeCloseTo(-b.min[1], 12);
      expect(a.min[0]).toBeCloseTo(b.min[0], 12);
      expect(a.max[0]).toBeCloseTo(b.max[0], 12);
      expect(a.max[2]).toBeCloseTo(b.max[2], 12);
    }
    // the deck is a plain rectangle: no taper
    const d = outlineOf(get(parts, 'deck'));
    expect(d).toHaveLength(4);
    expect(d[0][1]).toBeCloseTo(-d[3][1], 12);
    expect(d[1][1]).toBeCloseTo(d[0][1], 12); // the front edge is square to the sides
    const ys = new Set(d.map((q) => Math.abs(q[1]).toFixed(9)));
    expect(ys.size).toBe(1);
    expect([...ys][0]).toBe((hw + defaults.deckCaptureDepthIn).toFixed(9));
  });
  it('the width follows bodyWidthIn (22 and 28 in) with no change of shape', () => {
    for (const w of [22, 28]) {
      const p = { ...defaults, bodyWidthIn: w, frontTrackIn: 40 }; // the wider body needs the wider front track for the steering lock (D-56)
      expect(errorsOf(p), `${w}`).toEqual([]);
      const m = buildModel(p);
      expect(worldAABB(get(m, 'side-L-gunwale')).max[1]).toBeCloseTo(w / 2, 9);
      expect(worldAABB(get(m, 'side-R-chine')).min[1]).toBeCloseTo(-w / 2, 9);
      expect(worldAABB(get(m, 'transom-rear')).max[1]).toBeCloseTo(w / 2, 9);
      const d = outlineOf(get(m, 'deck'));
      expect(d.every((q) => Math.abs(Math.abs(q[1]) - (w / 2 - defaults.sideThicknessIn + defaults.deckCaptureDepthIn)) < 1e-9)).toBe(true);
    }
  });
  it('the chine is a straight bar from the rear transom to the end of the sides at deck level; the rail runs to the end of the flat deck', () => {
    const c = worldAABB(get(parts, 'side-L-chine'));
    expect(c.min[0]).toBeCloseTo(xSideStart, 9);
    expect(c.max[0]).toBeCloseTo(xSideEnd, 9);
    expect(c.min[2]).toBeCloseTo(L.deckBot, 9);
    expect(c.max[2] - c.min[2]).toBeCloseTo(defaults.railBandIn, 9);
    expect(get(parts, 'side-L-chine').geometry.type).toBe('box');
    const r = worldAABB(get(parts, 'rail-L'));
    expect(r.min[0]).toBeCloseTo(xSideStart, 9);
    expect(r.max[0]).toBeCloseTo(xFlatEnd, 9);
    expect(r.max[2]).toBeCloseTo(L.deckBot, 9);
    expect(r.max[2] - r.min[2]).toBeCloseTo(defaults.railDepthIn, 9);
  });
  it('the deck is one flat sheet that ends where the curl starts: x from the transom dado to xFlatEnd, one ply thick, fits a 4 x 8 sheet', () => {
    const d = get(parts, 'deck');
    const b = worldAABB(d);
    expect(b.min[0]).toBeCloseTo(xSideStart - defaults.deckCaptureDepthIn, 9);
    expect(b.max[0]).toBeCloseTo(xFlatEnd, 9);
    expect(b.min[2]).toBeCloseTo(L.deckBot, 9);
    expect(b.max[2]).toBeCloseTo(L.deckTop, 9);
    expect(b.max[0] - b.min[0]).toBeLessThanOrEqual(96);
    expect(b.max[1] - b.min[1]).toBeLessThanOrEqual(48);
    expect(d.edges).toEqual(['captured', 'captured', 'captured', 'captured']);
  });
});

describe('sled side profile', () => {
  const sag = (s: number) => ({ ...defaults, sideProfileSagIn: s });
  const u = (x: number) => (x - xSideStart) / (xSideEnd - xSideStart);

  it('a straight line from 16 in above the deck at the rear transom inner face to 4 in at the end of the sides: gunwale top at sampled x', () => {
    for (const tag of ['L', 'R']) {
      const top = topEdge(get(parts, `side-${tag}-gunwale`));
      expect(top.length).toBeGreaterThan(10);
      expect(top[0][0]).toBeCloseTo(xSideStart, 9);
      expect(top[top.length - 1][0]).toBeCloseTo(xSideEnd, 9);
      for (const [x, z] of top) expect(z - L.deckTop, `${tag} x=${x.toFixed(2)}`).toBeCloseTo(16 + (4 - 16) * u(x), 9);
      expect(top[0][1] - L.deckTop).toBeCloseTo(16, 9);
      expect(top[top.length - 1][1] - L.deckTop).toBeCloseTo(4, 9);
    }
  });
  it('is the same line in the layout helpers (sideHeightAtX, sideTopAt) and in params.sideHeightAt', () => {
    for (const x of [-9.25, -3, 0, 10, 25, 40, 55.2]) {
      const h = 16 - 12 * u(x);
      expect(sideHeightAtX(L, x), `${x}`).toBeCloseTo(h, 9);
      expect(sideTopAt(L, x)).toBeCloseTo(L.deckTop + h, 9);
      expect(sideHeightAt(defaults, x, xSideStart, xSideEnd)).toBeCloseTo(h, 9);
      expect(webTopAt(L, x)).toBeCloseTo(L.deckTop + h - defaults.railBandIn, 9);
    }
    // clamped beyond the ends
    expect(sideHeightAtX(L, -40)).toBeCloseTo(16, 9);
    expect(sideHeightAtX(L, 80)).toBeCloseTo(4, 9);
    // the slope: 12 in down over the 64.5 in run, the same everywhere (straight), descending toward the bow
    const run = xSideEnd - xSideStart;
    for (const x of [-5, 20, 50]) expect(sideSlopeAt(L, x)).toBeCloseTo(Math.atan2(12, run), 6);
  });
  it('the gunwale is a constant 1.5 in band under that line, and the web top is the gunwale underside plus the groove depth (captured)', () => {
    const g = defaults.grooveDepthIn;
    for (const tag of ['L', 'R']) {
      const gun = get(parts, `side-${tag}-gunwale`);
      const top = topEdge(gun), bot = bottomEdge(gun);
      expect(bot).toHaveLength(top.length);
      top.forEach((q, i) => {
        expect(q[0]).toBeCloseTo(bot[i][0], 9);
        expect(q[1] - bot[i][1]).toBeCloseTo(defaults.railBandIn, 9);
      });
      const web = get(parts, `side-${tag}-web`);
      const wo = outlineOf(web).map((q) => sideXZ(web, q));
      // The web's top edge is the second half of the outline; each top point (inside the gunwale's x range) sits `g` into the gunwale groove
      const wTop = wo.slice(wo.length / 2);
      let n = 0;
      for (const [x, z] of wTop) {
        if (x < xSideStart || x > xSideEnd + 1e-9) continue;
        n++;
        expect(z, `${tag} web top x=${x.toFixed(2)}`).toBeCloseTo(L.deckTop + 16 - 12 * u(x) - defaults.railBandIn + g, 9);
      }
      expect(n).toBeGreaterThan(10);
      // the web bottom is flat, g below the chine top
      const wBot = wo.slice(0, wo.length / 2);
      for (const [, z] of wBot) expect(z).toBeCloseTo(L.chineBot + defaults.railBandIn - g, 9);
      // one edge condition per outline edge, none exposed
      expect(web.edges).toBe('captured');
      const wb = worldAABB(web);
      expect(wb.max[0]).toBeCloseTo(xSideEnd, 9);
      expect(wb.min[0]).toBeCloseTo(xSideStart - defaults.deckCaptureDepthIn, 9);
    }
  });
  it('the optional sag bends the line by exactly 4 * sag * u * (1 - u): half the sag at a quarter, the full sag at the middle, and none at either end', () => {
    for (const s of [2, -1, 3]) {
      const p = sag(s);
      const m = buildModel(p);
      const Lp = computeLayout(p);
      for (const tag of ['L', 'R']) {
        for (const [x, z] of topEdge(get(m, `side-${tag}-gunwale`))) {
          const uu = u(x);
          expect(z - Lp.deckTop, `sag ${s} x=${x.toFixed(2)}`).toBeCloseTo(16 - 12 * uu - 4 * s * uu * (1 - uu), 9);
        }
      }
      const mid = xSideStart + (xSideEnd - xSideStart) / 2;
      expect(sideHeightAtX(Lp, mid)).toBeCloseTo(10 - s, 9); // the line gives 10 in at the middle
      expect(sideHeightAtX(Lp, xSideStart + (xSideEnd - xSideStart) / 4)).toBeCloseTo(13 - 0.75 * s, 9);
      expect(sideHeightAtX(Lp, xSideStart)).toBeCloseTo(16, 9);
      expect(sideHeightAtX(Lp, xSideEnd)).toBeCloseTo(4, 9);
      expect(sideHeightAt(p, mid, xSideStart, xSideEnd)).toBeCloseTo(10 - s, 9);
    }
  });
  it('the rear transom is as tall as the rear side (16 in above the deck at its corners, a crown more at the middle)', () => {
    const t = worldAABB(get(parts, 'transom-rear'));
    expect(t.max[2]).toBeCloseTo(L.deckTop + 16 + defaults.transomCrownIn, 9);
    expect(t.min[2]).toBeCloseTo(L.deckBot - defaults.crossmemberDepthIn + defaults.deckPlyIn, 9); // down to the joist bottom
    const o = outlineOf(get(parts, 'transom-rear'));
    const wTop = Math.max(...o.map((q) => q[0]));
    expect(wTop).toBeCloseTo(12, 9);
    const atWall = o.filter((q) => Math.abs(q[0] - wTop) < 1e-9).map((q) => q[1]);
    expect(Math.max(...atWall)).toBeLessThan(L.deckTop + 16 - 0.05); // the corner is rounded off below the corner height
    expect(liftSlot(makeCtx(defaults)).transomTop).toBeCloseTo(L.deckTop + 16, 9);
    // and the gunwale at the rear transom is the same height as the transom's corner line
    expect(topEdge(get(parts, 'side-L-gunwale'))[0][1]).toBeCloseTo(L.deckTop + 16, 9);
  });
  it('lowering or raising the two heights moves the profile (sideHeightBowIn 5, sideHeightRearIn 12)', () => {
    const p = { ...defaults, sideHeightBowIn: 5, sideHeightRearIn: 12 };
    expect(errorsOf(p)).toEqual([]);
    const m = buildModel(p);
    const top = topEdge(get(m, 'side-L-gunwale'));
    expect(top[0][1] - defaults.deckHeightIn).toBeCloseTo(12, 9);
    expect(top[top.length - 1][1] - defaults.deckHeightIn).toBeCloseTo(5, 9);
    expect(worldAABB(get(m, 'transom-rear')).max[2]).toBeCloseTo(defaults.deckHeightIn + 12 + defaults.transomCrownIn, 9);
  });
});

describe('bow curl', () => {
  const curl = get(parts, 'bow-curl');
  const path = (curl.geometry as { type: 'sweep'; path: Vec2[]; width: number; thickness: number; plies: number }).path;
  const c = bowCurl(defaults);
  const N = path.length - 1;
  // arc center: directly above the tangent point, one centerline radius up
  const zFlat = defaults.deckHeightIn - thick / 2; // the centerline of the flat part (the curl is as thick as the deck, flush with the deck top)
  const center: Vec2 = [xFlatEnd, zFlat + R];

  it('a 4-ply, 12 mm bent lamination as wide as the inside of the hull, flush with the deck top at the tangent point', () => {
    expect(curl.kind).toBe('bentlam');
    expect(curl.geometry.type).toBe('sweep');
    expect(thick).toBeCloseTo(0.472, 9);
    expect(thick).toBeCloseTo(defaults.deckPlyIn, 2); // the same thickness as the deck, which it is scarfed to
    const g = curl.geometry as { width: number; thickness: number; plies: number };
    expect(g.plies).toBe(4);
    expect(g.thickness).toBeCloseTo(thick, 12);
    expect(g.width).toBeCloseTo(2 * hw, 12);
    expect(curl.joints!.some((j) => j.type === 'scarf' && j.to === 'deck')).toBe(true);
    expect(curl.edges).toBe('edged');
  });
  it('tangent to the deck at xFlatEnd: the path starts there at the deck centerline and every point is exactly one centerline radius from the arc center directly above it', () => {
    expect(path[0][0]).toBeCloseTo(xFlatEnd, 9);
    expect(path[0][1]).toBeCloseTo(zFlat, 9);
    expect(curlPath(defaults, L)).toEqual(path);
    for (const q of path) expect(Math.hypot(q[0] - center[0], q[1] - center[1])).toBeCloseTo(R, 9);
    // the tangent at the first point is horizontal: the first chord's heading is half a step, 80 / 12 / 2 = 3.33 deg
    const step = defaults.bowCurlAngleDeg / N;
    const h0 = Math.atan2(path[1][1] - path[0][1], path[1][0] - path[0][0]);
    expect((h0 * 180) / Math.PI).toBeCloseTo(step / 2, 6);
    // the layout agrees
    expect(L.curl.xFlatEnd).toBeCloseTo(xFlatEnd, 9);
    expect(L.curl.heightAt(xFlatEnd)).toBe(0);
    expect(L.curl.angleAt(xFlatEnd)).toBe(0);
  });
  it('radius 7 in, angle 80 deg, tip at x = 56 in (the end of the body) and 5.78 in up the centerline', () => {
    expect(c.radius).toBe(7);
    expect(defaults.bowCurlAngleDeg).toBe(80);
    const tip = path[path.length - 1];
    expect(tip[0]).toBeCloseTo(xTip, 9);
    expect(tip[0]).toBeCloseTo(L.xFront, 12);
    expect(tip[1] - zFlat).toBeCloseTo(R * (1 - Math.cos(angle)), 9); // 5.78 in
    expect(tip[1] - zFlat).toBeCloseTo(5.78, 2);
    // the tip tangent direction is 80 deg minus half a step from horizontal
    const last = Math.atan2(tip[1] - path[N - 1][1], tip[0] - path[N - 1][0]);
    expect((last * 180) / Math.PI).toBeCloseTo(defaults.bowCurlAngleDeg - defaults.bowCurlAngleDeg / N / 2, 6);
    // 90 deg gives a vertical tip, 45 a gentle upturn
    const v = curlPath({ ...defaults, bowCurlAngleDeg: 90 }, computeLayout({ ...defaults, bowCurlAngleDeg: 90 }));
    expect(v[v.length - 1][0] - bowCurl({ ...defaults, bowCurlAngleDeg: 90 }).xFlatEnd).toBeCloseTo(R, 9);
    expect(bowCurl({ ...defaults, bowCurlAngleDeg: 45 }).rise).toBeCloseTo(R * (1 - Math.SQRT1_2), 9);
    // the world box of the sweep reaches the tip (plus half the thickness)
    const b = worldAABB(curl);
    expect(b.max[0]).toBeGreaterThanOrEqual(xTip - 1e-9);
  });
  it('inside radius 6.76 in against the cold-bend limit of 40 plies (4.72 in): OK, and a tighter curl is rejected', () => {
    const ply = defaults.bowCurlPlyIn; // 4 plies of 0.118 are 0.472 (lamPly agrees to within rounding)
    expect(rIn).toBeCloseTo(6.764, 3);
    expect(c.rIn).toBeCloseTo(rIn, 12);
    const limit = defaults.hullLamMinRadiusFactor * ply;
    expect(limit).toBeCloseTo(4.72, 2);
    expect(rIn).toBeGreaterThan(limit);
    expect(errorsOf(defaults)).toEqual([]);
    // a 5 in centerline radius is 4.76 inside: still OK; 4.5 would be 4.26 inside, below the 4.72 limit
    expect(errorsOf({ ...defaults, bowCurlRadiusIn: 5 }).filter((i) => i.keys.includes('hullLamMinRadiusFactor'))).toEqual([]);
    const tight = errorsOf({ ...defaults, bowCurlRadiusIn: 4.5, sideHeightBowIn: 2 }).filter((i) => i.keys.includes('hullLamMinRadiusFactor'));
    expect(tight).toHaveLength(1);
    expect(tight[0].message).toMatch(/cold-bend limit/);
    // thicker plies move the limit up with them
    expect(errorsOf({ ...defaults, bowCurlPlyIn: 0.2, bowCurlPlies: 2 }).some((i) => i.keys.includes('hullLamMinRadiusFactor'))).toBe(true);
  });
  it('the sides end where the curl inside face has risen to the bow side height (4 in): the member ends, the curl height there and the inside circle agree', () => {
    expect(L.curl.heightAt(xSideEnd)).toBeCloseTo(defaults.sideHeightBowIn, 9);
    // the inside-face point at the end of the sides is on the inside circle of the curl
    expect(Math.hypot(xSideEnd - center[0], L.deckTop + defaults.sideHeightBowIn - (L.deckTop + rIn))).toBeCloseTo(rIn, 9);
    for (const tag of ['L', 'R']) {
      for (const part of ['chine', 'gunwale', 'web']) expect(worldAABB(get(parts, `side-${tag}-${part}`)).max[0], `${tag} ${part}`).toBeCloseTo(xSideEnd, 9);
    }
    // a taller bow side meets the curl later; one taller than the curl rises is rejected
    const p6 = { ...defaults, sideHeightBowIn: 5 };
    expect(computeLayout(p6).xSideEnd).toBeGreaterThan(xSideEnd);
    expect(computeLayout(p6).curl.heightAt(computeLayout(p6).xSideEnd)).toBeCloseTo(5, 9);
    const err = errorsOf({ ...defaults, sideHeightBowIn: 8, bowCurlAngleDeg: 45 });
    expect(err.some((i) => i.keys.includes('sideHeightBowIn') && /only rises/.test(i.message))).toBe(true);
  });
  it('the curl is epoxied to the deck by a scarf; the bridle no longer ties to it (the tongue plate reaches under the bow, D-56); its notes record the bend radius', () => {
    expect(curl.notes).toMatch(/cold-bend limit/);
    expect((curl.joints ?? []).some((j) => j.to === 'bow-block' || j.to === 'bridle-eye')).toBe(false);
    expect(curl.notes).not.toMatch(/eye bolt|backing block|caster/);
    expect(curl.notes).toMatch(/tongue plate/);
    expect(curl.sourcing!.vendor).toMatch(/bending ply/);
    expect(curl.massLb).toBeGreaterThan(1);
    expect(curl.massLb).toBeLessThan(4);
  });
});

describe('rear transom and lift slot', () => {
  const ctx = makeCtx(defaults);
  const rs = liftSlot(ctx);
  const t = get(parts, 'transom-rear');
  const hole = (t.geometry as { holes?: Vec2[][] }).holes![0];
  it('the slot is a 4.5 x 1.25 in stadium centered on the centerline, clear of the rear box (1/4 in over its top) and at least 3 in above the deck, with 3/4 in of oak above it', () => {
    // the default rear storage box abuts the transom, so the slot sits above the box top; with the storage under the seat it is 3 in above the deck
    expect(L.storage.zTop).toBeGreaterThan(L.deckTop + defaults.liftSlotClearIn);
    expect(rs.zBot).toBeCloseTo(L.storage.zTop + 0.25, 9);
    const under = liftSlot(makeCtx({ ...defaults, storageLocation: 2 }));
    expect(under.zBot).toBeCloseTo(L.deckTop + defaults.liftSlotClearIn, 9);
    expect(rs.zTop - rs.zBot).toBeCloseTo(defaults.liftSlotHeightIn, 9);
    expect(rs.lengthIn).toBe(defaults.liftSlotLengthIn);
    expect(rs.zBot - L.deckTop).toBeGreaterThanOrEqual(3);
    const ys = hole.map((q) => q[0]), zs = hole.map((q) => q[1]);
    expect(Math.min(...ys)).toBeCloseTo(-defaults.liftSlotLengthIn / 2, 9);
    expect(Math.max(...ys)).toBeCloseTo(defaults.liftSlotLengthIn / 2, 9);
    expect(Math.min(...zs)).toBeCloseTo(rs.zBot, 9);
    expect(Math.max(...zs)).toBeCloseTo(rs.zTop, 9);
    // oak above the slot at the slot's ends and the middle, along the crowned top
    const top = Math.max(...outlineOf(t).map((q) => q[1]));
    expect(top - rs.zTop).toBeGreaterThanOrEqual(defaults.liftBarMinIn);
    expect(rs.barIn).toBe(defaults.liftBarMinIn);
    expect(rs.thickIn).toBe(defaults.transomThicknessIn);
    expect(liftBarStressPsi(rs, 100)).toBeGreaterThan(0);
    expect(liftBarStressPsi(rs, 200)).toBeCloseTo(2 * liftBarStressPsi(rs, 100), 9);
  });
  it('the transom is 3/4 in oak, full width over the side ends, from the joist bottom to 16 in above the deck; four 1/4 in vent holes', () => {
    expect(t.material).toBe('white oak');
    const b = worldAABB(t);
    expect(b.min[0]).toBeCloseTo(xRear, 9);
    expect(b.max[0]).toBeCloseTo(xSideStart, 9);
    expect(b.max[1]).toBeCloseTo(12, 9);
    expect(b.min[1]).toBeCloseTo(-12, 9);
    expect((t.geometry as { holes?: Vec2[][] }).holes).toHaveLength(5); // slot + four vents
    expect(t.massLb).toBeGreaterThan(5);
  });
  it('a taller rear side pushes the transom up with it; a short one is lifted over the slot so the oak rule holds (D-37)', () => {
    const tall = liftSlot(makeCtx({ ...defaults, sideHeightRearIn: 20 }));
    expect(tall.transomTop).toBeCloseTo(L.deckTop + 20, 9);
    const short = liftSlot(makeCtx({ ...defaults, sideHeightRearIn: 8 }));
    expect(short.transomTop).toBeCloseTo(short.zTop + defaults.liftBarMinIn, 9);
    expect(short.transomTop).toBeGreaterThan(L.deckTop + 8);
  });
});

describe('scuppers', () => {
  const ctx = makeCtx(defaults);
  const sites = scupperSites(ctx);
  it('four drains: two at the rear and two at the bow, through the chines at deck level, a hair above the deck surface', () => {
    expect(sites.map((s) => s.zone)).toEqual(['rear', 'bow']);
    const ids = parts.filter((x) => x.id.startsWith('scupper-')).map((x) => x.id).sort();
    expect(ids).toEqual(['scupper-bow-L', 'scupper-bow-R', 'scupper-rear-L', 'scupper-rear-R']);
    const rearX = xSideStart + Math.max(0.5, defaults.scupperDiaIn / 2 + 0.1) * 0.75;
    const rear = worldAABB(get(parts, 'scupper-rear-L')), bow = worldAABB(get(parts, 'scupper-bow-L'));
    const cx = (b: { min: number[]; max: number[] }) => (b.min[0] + b.max[0]) / 2;
    expect(cx(rear)).toBeCloseTo(rearX, 9); // in the rear corner, just ahead of the rear transom
    expect(cx(bow)).toBeCloseTo(xFlatEnd - 1, 9); // just behind the curl
    expect(cx(rear) - xSideStart).toBeLessThan(1);
    for (const id of ['scupper-rear-L', 'scupper-bow-L', 'scupper-rear-R', 'scupper-bow-R']) {
      const b = worldAABB(get(parts, id));
      expect((b.min[2] + b.max[2]) / 2, id).toBeCloseTo(L.deckTop + 0.05 + defaults.scupperDiaIn / 2, 9);
      expect(b.min[2], id).toBeGreaterThan(L.deckTop); // hole bottom above the deck surface: standing water drains out
      // across the chine: from inside the inner face to 1/4 in beyond the outer face
      expect(Math.abs(b.max[1] - b.min[1])).toBeCloseTo(L.side + 0.25, 9);
    }
    expect(worldAABB(get(parts, 'scupper-rear-R')).max[1]).toBeLessThan(0);
    expect(worldAABB(get(parts, 'scupper-rear-L')).min[1]).toBeGreaterThan(0);
  });
  it('are inside the chines in height (deck level) and ahead of / behind the rails\' ends', () => {
    const chine = worldAABB(get(parts, 'side-L-chine'));
    for (const id of ['scupper-rear-L', 'scupper-bow-L']) {
      const b = worldAABB(get(parts, id));
      expect(b.max[2]).toBeLessThan(chine.max[2]);
      expect(b.min[0]).toBeGreaterThan(chine.min[0]);
      expect(b.max[0]).toBeLessThan(chine.max[0]);
    }
  });
});

describe('signs are provisional (D-54: design the shape first)', () => {
  it('off by default', () => {
    expect(defaults.showSideSigns).toBe(0);
    expect(parts.some((x) => /^sign/.test(x.id))).toBe(false);
  });
  it('on: two removable blanks on the side webs, marked provisional, and the body is unchanged', () => {
    const p = { ...defaults, showSideSigns: 1 };
    expect(errorsOf(p)).toEqual([]);
    const m = buildModel(p);
    const signs = m.filter((x) => /^sign/.test(x.id));
    expect(signs.map((x) => x.id).sort()).toEqual(['sign-L', 'sign-R']);
    for (const s of signs) {
      expect(s.removable).toBe(true);
      expect(s.group).toBe('removable');
      expect(s.name).toMatch(/provisional/i);
      expect(s.notes).toMatch(/PROVISIONAL/);
      expect(s.massLb).toBeGreaterThan(0);
      expect(s.edges).toBe('edged');
    }
    // hung on the OUTER face of the side stack (chine, web and gunwale are flush there), parallel to the gunwale line, between the chine bottom and the rear gunwale top
    const w = worldAABB(get(m, 'side-L-web')), sg = worldAABB(get(m, 'sign-L'));
    expect(sg.min[1]).toBeGreaterThanOrEqual(w.max[1] - 1e-9);
    expect(sg.max[1]).toBeGreaterThan(12);
    expect(sg.max[1]).toBeLessThan(12 + 2 * defaults.panelPlyIn);
    expect(sg.min[2]).toBeGreaterThan(L.chineBot);
    expect(sg.max[2]).toBeLessThan(L.sideTop);
    expect(buildModel(p, { removed: true }).some((x) => /^sign/.test(x.id))).toBe(false);
    // nothing else in the body knows about the sign
    for (const x of parts.filter((q) => q.id !== 'hardware')) expect(get(m, x.id).massLb, x.id).toBeCloseTo(x.massLb, 9); // (the fastener remainder, 'hardware', grows with the sign screws)
    expect(get(m, 'hardware').massLb).toBeGreaterThan(get(parts, 'hardware').massLb);
    expect(m.length).toBe(parts.length + 2);
  });
});

describe('what is gone with the old hull, the Ackermann front end and the swivel casters', () => {
  it('no part id starts with side-cabin, side-nose, rail-cabin, rail-nose, guard-, transom-front, tongue, kp-, spindle, caster-, tip-swivel, bow-block, front-hanger- (or any other removed steering part)', () => {
    const gone = /^(side-cabin|side-nose|rail-cabin|rail-nose|guard-|transom-front|tongue|kp-|spindle|tie-rod|drag-link|bellcrank|steer-(?!stop-|rope-)|stringer|girder|front-beam|turntable|bolster|eyebolt-|caster-|tip-swivel|bow-block|front-hanger-)/;
    expect(parts.filter((x) => gone.test(x.id)).map((x) => x.id)).toEqual([]);
    for (const v of [{ steerDeg: 15 }, { removed: true }, { rider: 'goal' as const }]) expect(buildModel(defaults, v).filter((x) => gone.test(x.id)).map((x) => x.id)).toEqual([]);
  });
  it('the front end is the pivoting soapbox axle (D-56): beam-F, its stubs and clamps, the kingpin, king beam, thrust washer, tongue, stops and bridle are present', () => {
    for (const id of ['beam-F', 'axle-FL', 'axle-FR', 'clamp-FL1', 'clamp-FR4', 'kingpin', 'king-beam', 'king-thrust', 'bridle-tongue', 'steer-stop-L', 'steer-stop-R', 'bridle-eye', 'bridle']) expect(parts.some((x) => x.id === id), id).toBe(true);
  });
  it('the sides are the new straight set: one chine, one gunwale and one web per side, ids side-L-* and side-R-*', () => {
    expect(parts.filter((x) => x.id.startsWith('side-')).map((x) => x.id).sort()).toEqual(
      ['side-L-chine', 'side-L-gunwale', 'side-L-web', 'side-R-chine', 'side-R-gunwale', 'side-R-web'],
    );
    expect(parts.filter((x) => x.id.startsWith('rail-')).map((x) => x.id).sort()).toEqual(['rail-L', 'rail-R']);
    expect(parts.filter((x) => x.id.startsWith('transom-')).map((x) => x.id).sort()).toEqual(['transom-backer-L', 'transom-backer-R', 'transom-rear']);
  });
  it('the structural side height the checks read is the lowest section (the bow end)', () => {
    expect(L.sideH).toBe(defaults.sideHeightBowIn);
    expect(L.sideRear).toBe(defaults.sideHeightRearIn);
    expect(L.sideH).toBeLessThan(L.sideRear);
  });
});
