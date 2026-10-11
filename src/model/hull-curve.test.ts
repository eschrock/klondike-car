/** D-45, D-52: the one-piece hull in plan: the bow curve, its clearance to the front-tire sweep, the bent members, the side profile and the cabin-to-bow load path. */
import { describe, expect, it } from 'vitest';
import { defaultParams, hullCurveSpec, hullPlanCurve, hullTireGap, resolveParams, sanitizeParams, validateParams, type Params } from '../params';
import { hullLayers } from '../analysis/structure';
import { makeContext } from '../analysis/context';
import { buildModel } from './index';
import { fingerAnalysis } from './body';
import { makeCtx } from './build-utils';
import { curveHeading } from './hull-curve';
import { computeLayout, innerHalfWidth, sidePath } from './layout';
import { partsOverlap, worldAABB } from './bounds';
void hullCurveSpec;
import type { Part, Vec2 } from './types';

const defaults = defaultParams();
const errorsOf = (p: Params) => validateParams(p).filter((i) => i.severity === 'error');
const get = (parts: Part[], id: string) => {
  const x = parts.find((q) => q.id === id);
  if (!x) throw new Error(`no part ${id}`);
  return x;
};
/** Smallest radius of a polyline (three-point circles). */
function minRadius(path: Vec2[]): number {
  let r = Infinity;
  for (let i = 1; i < path.length - 1; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i], [cx, cy] = path[i + 1];
    const ab = Math.hypot(bx - ax, by - ay), bc = Math.hypot(cx - bx, cy - by), ca = Math.hypot(ax - cx, ay - cy);
    const cross = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    if (cross > 1e-9) r = Math.min(r, (ab * bc * ca) / (2 * cross));
  }
  return r;
}

describe('plan bow curve (D-45, D-52)', () => {
  const L = computeLayout(defaults);
  const c = L.hull;

  it('is tangent to the cabin side at its start, ends at xn in the straight bow run, and the run reaches the bow width at the front transom', () => {
    expect(c.x0).toBe(L.xc0);
    expect(c.x1).toBe(L.xn);
    expect(c.pts[0]).toEqual([L.xc0, L.hwC + L.side / 2]);
    // Heading of the first segment is (nearly) the side direction: tangent continuity, no kink.
    const h0 = Math.atan2(c.pts[1][1] - c.pts[0][1], c.pts[1][0] - c.pts[0][0]);
    expect(Math.abs(h0)).toBeLessThan((3 * Math.PI) / 180); // the first chord is on the rising curvature ramp
    expect(curveHeading(c, c.x0)).toBe(0);
    // The bow run keeps converging at the bow heading all the way to the transom (never turns back).
    expect(L.bowHeading).toBeLessThan(0);
    expect(innerHalfWidth(L, L.xFront - L.transom)).toBeCloseTo(L.hwN, 1);
    // R_min is the tightest radius of the centerline (D-52: 57 inches at the defaults, 10 times the old S-curve).
    expect(c.minRadius).toBeGreaterThan(50);
  });

  it('is monotone in x and y (the hull only narrows) and never turns back (no inflection)', () => {
    for (let i = 1; i < c.pts.length; i++) {
      expect(c.pts[i][0]).toBeGreaterThan(c.pts[i - 1][0]);
      expect(c.pts[i][1]).toBeLessThanOrEqual(c.pts[i - 1][1] + 1e-12);
    }
    const turn = (i: number) => Math.atan2(c.pts[i + 1][1] - c.pts[i][1], c.pts[i + 1][0] - c.pts[i][0]) - Math.atan2(c.pts[i][1] - c.pts[i - 1][1], c.pts[i][0] - c.pts[i - 1][0]);
    for (let i = 1; i < c.pts.length - 1; i++) expect(turn(i), `vertex ${i}`).toBeLessThanOrEqual(0.005); // convex: it only bends toward the centerline (the fit allows 0.14 degrees of reverse turn at most)
  });

  it('stays outside the seat, grab handles and storage box: the cabin is full width and straight up to the start', () => {
    const parts = buildModel(defaults);
    for (const id of ['seat-cushion', 'seat-grip-bar-L', 'seat-grip-bar-R', 'storage-lid', 'storage-side-L', 'storage-end-fore']) {
      const b = worldAABB(get(parts, id));
      expect(b.max[0], id).toBeLessThanOrEqual(Math.max(L.xc0, L.seat.xFront) + 1e-9);
    }
    for (const id of ['seat-grip-bar-L', 'storage-lid', 'storage-side-L', 'reflector-L2']) expect(worldAABB(get(parts, id)).max[0], id).toBeLessThanOrEqual(L.xc0 + 1e-9);
    // The lash points sit on the gunwale; the front one may stand a little ahead of the curve start (the gunwale there is still within 1 inch of full width).
    expect(worldAABB(get(parts, 'lash-L1')).max[0]).toBeLessThanOrEqual(L.xc0 + 1);
    for (let x = L.xRear; x <= L.xc0; x += 0.5) expect(innerHalfWidth(L, x), `x ${x}`).toBeCloseTo(L.hwC, 4);
    // The cushion front corners stay inside the narrowing hull with ¼" to spare.
    expect(innerHalfWidth(L, L.seat.xFront)).toBeGreaterThanOrEqual(L.seat.width / 2 + 0.25 - 1e-9);
    // And the validator enforces it: a seat too far forward runs into the narrowing hull or the grab handles.
    expect(errorsOf({ ...defaults, seatXIn: 14 }).some((i) => i.message.includes('narrowing hull') || i.message.includes('grab handles'))).toBe(true);
  });

  it('the bow side is a straight line from the end of the curve to the front transom', () => {
    const xa = L.xn, xb = L.xFront - L.transom;
    const ya = innerHalfWidth(L, xa), yb = innerHalfWidth(L, xb);
    for (let x = xa; x <= xb; x += 1) expect(innerHalfWidth(L, x)).toBeCloseTo(ya + ((yb - ya) * (x - xa)) / (xb - xa), 4);
  });
});

describe('the hull outline clears the whole front-tire sweep + steering clearance (D-45)', () => {
  const variants: Record<string, Partial<Params>> = {
    defaults: {},
    track40: { frontTrackIn: 40, rearTrackIn: 40 },
    track33: { frontTrackIn: 33 },
    lock30: { steerLockDeg: 30 },
    lock34: { steerLockDeg: 34 },
    wheel11_5: { wheelDiameterIn: 11.5 },
    wheel10: { wheelDiameterIn: 10 },
    lead1_5: { kingpinLeadIn: 1.5 },
    start16: { hullCurveStartIn: 16 },
    start17: { hullCurveStartIn: 17 },
    start19: { hullCurveStartIn: 19 }, // auto moves it earlier for the bend radius
    clearance1: { steeringClearanceIn: 1 },
    tire3_5: { tireWidthIn: 3.5 },
  };
  it.each(Object.entries(variants))('%s', (_n, patch) => {
    const p = { ...defaults, ...patch };
    if (errorsOf(p).length) return; // an impossible combination: the validator already says so
    const ctx = makeCtx(p);
    const r = ctx.p;
    // (1) the curve alone (analytic outline vs the Ackermann tire rectangles)
    const gap = hullTireGap(r, hullPlanCurve(r));
    expect(gap).toBeGreaterThanOrEqual(r.steeringClearanceIn - 1e-6);
    // (2) the real model outline (hullSegments, via fingerAnalysis, which the finger guard uses) agrees
    const fa = fingerAnalysis(ctx);
    expect(fa.minGapIn).toBeGreaterThanOrEqual(r.steeringClearanceIn - 0.02);
    // (3) the built parts: every steered front tire clears every body part at both locks
    for (const deg of [r.steerLockDeg, -r.steerLockDeg, 0]) {
      const parts = buildModel(p, { steerDeg: deg });
      const tires = parts.filter((x) => x.id === 'wheel-FL' || x.id === 'wheel-FR');
      const body = parts.filter((x) => !x.payload && /^(side-|deck|transom|rail-|girder-|joist-|stringer-|foot-stop|storage|seat-|sign|reflector)/.test(x.id));
      for (const t of tires) for (const b of body) expect(partsOverlap(t, b), `${deg} ${t.id} x ${b.id}`).toBeLessThanOrEqual(0);
    }
  });
  it('a manual bow that is too wide for the curve start is an error with the gap in the message', () => {
    const bad = { ...defaults, autoNoseGeometry: 0, noseWidthIn: 24, hullCurveStartIn: 30 };
    const e = errorsOf(bad).find((i) => i.message.startsWith('The hull side comes within'));
    expect(e).toBeDefined();
    expect(e!.keys).toContain('noseWidthIn');
  });
});

describe('bent laminations: bend radius vs the cold-bend limit (D-45)', () => {
  const ctx = makeCtx(defaults);
  const { L, p } = ctx;
  const parts = buildModel(defaults);
  it('the chine, gunwale, rail and web are plan sweeps whose real minimum radius meets 40x the strip', () => {
    const strip = p.hullLamThicknessIn;
    const web = p.panelPlyIn / p.hullWebPlies;
    for (const [id, t, s1] of [['side-cabin-L-chine', L.side, strip], ['side-cabin-L-gunwale', L.side, strip], ['rail-cabin-L', p.railThicknessIn, strip], ['side-cabin-L-web', p.panelPlyIn, web]] as const) {
      const g = get(parts, id);
      expect(g.geometry.type, id).toBe('sweep');
      if (g.geometry.type !== 'sweep') continue;
      const r = minRadius(g.geometry.path) - g.geometry.thickness / 2; // inside face of the lamination
      expect(r, `${id} inside radius ${r.toFixed(2)}"`).toBeGreaterThanOrEqual(p.hullLamMinRadiusFactor * s1 - 1e-6);
      expect(g.geometry.plies, id).toBe(Math.max(1, Math.round(t / s1)));
      expect(g.kind, id).toBe(id.endsWith('web') ? 'sheet' : 'bentlam');
      expect(g.fab, id).toBe('bentlam');
    }
    // The model's centerline radius is the polyline's (to the sampling error of 24 chords)
    expect(minRadius(L.hull.pts)).toBeGreaterThan(0.9 * L.hull.minRadius);
  });
  it('a lamination that is too thick, or a web of one 6 mm sheet, is rejected with the limit in the message', () => {
    // A late curve start is a short, tight curve: the laminations (and the single web sheet) cannot take it.
    const tight = errorsOf({ ...defaults, hullLamThicknessIn: 0.375, autoNoseGeometry: 0, hullCurveStartIn: 28 });
    expect(tight.some((i) => /bend radius/.test(i.message) && i.keys.includes('hullLamThicknessIn'))).toBe(true);
    const thickWeb = errorsOf({ ...defaults, hullWebPlies: 1, panelPlyIn: 0.472, autoNoseGeometry: 0, hullCurveStartIn: 28 });
    expect(thickWeb.some((i) => /side panel bend radius/.test(i.message))).toBe(true);
    // The defaults (5/16 strips, one 6 mm web sheet) meet the limits.
    expect(errorsOf(defaults)).toEqual([]);
    // Auto moves the start earlier (never later) until the radius is met
    const r = resolveParams({ ...defaults, hullLamThicknessIn: 0.375, hullCurveStartIn: 28 });
    expect(r.hullCurveStartIn).toBeLessThan(28);
    expect(resolveParams(r)).toEqual(r);
    expect(errorsOf({ ...defaults, hullLamThicknessIn: 0.375, hullCurveStartIn: 28 }).some((i) => /bend radius/.test(i.message))).toBe(false);
  });
});

describe('decks follow the plan shape and stay captured (D-45)', () => {
  const ctx = makeCtx(defaults);
  const { L, p } = ctx;
  const parts = buildModel(defaults);
  const dd = p.deckCaptureDepthIn;
  /** Distance from a point to a polyline. */
  const distTo = (pt: Vec2, path: Vec2[]) => {
    let d = Infinity;
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1], [bx, by] = path[i];
      const dx = bx - ax, dy = by - ay;
      if (dx * dx + dy * dy < 1e-12) continue;
      const u = Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / (dx * dx + dy * dy)));
      d = Math.min(d, Math.hypot(pt[0] - ax - u * dx, pt[1] - ay - u * dy));
    }
    return d;
  };
  it('the deck edge enters the chine rabbet by the capture depth all along (distance to the chine centerline = side/2 - dd)', () => {
    const outline = (get(parts, 'deck').geometry as { outline: Vec2[] }).outline.filter((q) => q[1] > 0 && q[0] > L.xRear + L.transom && q[0] < L.xFront - L.transom - 1);
    const path = sidePath(L, 0, L.xRear + L.transom - 1, L.xFront - L.transom);
    expect(outline.length).toBeGreaterThan(20);
    for (const q of outline) expect(distTo(q, path), `x ${q[0].toFixed(2)}`).toBeCloseTo(L.side / 2 - dd, 1);
  });
  it('the deck narrows with the hull: wide in the cabin, narrow at the bow, not a rectangle, at one level', () => {
    const a = (get(parts, 'deck').geometry as { outline: Vec2[] }).outline;
    expect(a.length).toBeGreaterThan(20);
    expect(Math.max(...a.map((q) => q[1]))).toBeGreaterThan(L.hwN + 5);
    expect(Math.max(...a.filter((q) => q[0] > L.xFront - 2).map((q) => q[1]))).toBeLessThan(L.hwN + 1);
    expect(p.deckPlyIn).toBeCloseTo(L.ply, 9);
  });
  it('the deck rabbets and dados are the deck + a clearance (deckSlopIn), not the bare deck (build MUST-2)', () => {
    expect(p.deckSlopIn).toBeGreaterThan(0);
    const dado = get(parts, 'transom-rear').joints!.find((j) => j.type === 'dado' && j.to === 'deck')!;
    expect(dado.size).toContain((L.ply + p.deckSlopIn).toFixed(3));
    expect(get(parts, 'side-cabin-L-chine').joints!.find((j) => j.to === 'deck')!.size).toContain((L.ply + p.deckSlopIn).toFixed(3));
    expect(get(parts, 'side-nose-L-chine').joints!.find((j) => j.to === 'deck')!.size).toContain((L.ply + p.deckSlopIn).toFixed(3));
  });
});

describe('the side profile does not step (D-45) and combines with the sheer (D-44)', () => {
  const parts = buildModel(defaults);
  const { L, p } = makeCtx(defaults);
  const zr = (id: string) => { const b = worldAABB(get(parts, id)); return [b.min[2], b.max[2]]; };
  it('chine, rail and gunwale are at the same height in the cabin run and the bow run: no step', () => {
    for (const tag of ['L', 'R']) {
      expect(zr(`side-cabin-${tag}-chine`)).toEqual(zr(`side-nose-${tag}-chine`));
      expect(zr(`rail-cabin-${tag}`)[0]).toBeCloseTo(zr(`rail-nose-${tag}`)[0], 9);
      expect(zr(`rail-cabin-${tag}`)[1]).toBeCloseTo(zr(`rail-nose-${tag}`)[1], 9);
      expect(zr(`side-cabin-${tag}-gunwale`)[0]).toBeCloseTo(zr(`side-nose-${tag}-gunwale`)[0], 9); // gunwale underside (the nose one rises only past the sheer start)
      expect(zr(`side-cabin-${tag}-gunwale`)[1]).toBeCloseTo(L.sideTop, 9);
      expect(zr(`side-cabin-${tag}-web`)[0]).toBeCloseTo(zr(`side-nose-${tag}-web`)[0], 9);
    }
    expect(zr('side-cabin-L-chine')[0]).toBeCloseTo(L.deckTop - L.ply, 9); // at the nose deck level, along the whole hull
    expect(zr('side-cabin-L-chine')[1] - zr('side-cabin-L-chine')[0]).toBeCloseTo(p.railBandIn, 9);
  });
  it('there is no deck step: one deck level, the rail top, the chine bottom and the deck underside are the same height, and there is no shoulder beam', () => {
    expect(L.railTop).toBeCloseTo(L.deckBot, 9);
    expect(L.chineBot).toBeCloseTo(L.deckBot, 9);
    expect(parts.some((x) => x.id === 'shoulder-beam' || x.id === 'deck-cabin' || x.id === 'deck-nose')).toBe(false);
    const d = worldAABB(get(parts, 'deck'));
    expect(d.min[0]).toBeCloseTo(L.xRear + L.transom - p.deckCaptureDepthIn, 6);
    expect(d.max[2] - d.min[2]).toBeCloseTo(L.ply, 9);
  });
  it('the sheer starts flat beyond the end of the curve and rises smoothly to the bow on top of the constant side line', () => {
    expect(L.sheer.x0).toBeGreaterThanOrEqual(L.xn);
    const g = worldAABB(get(parts, 'side-nose-L-gunwale'));
    expect(g.max[2]).toBeCloseTo(L.sideTop + p.sheerRiseIn, 6);
    expect(L.noseGunTop).toBeCloseTo(L.sideTop + p.sheerRiseIn, 9);
  });
});

describe('the cabin and bow are one structure (build review MUST-1, D-45, D-52)', () => {
  const parts = buildModel(defaults);
  const { L } = makeCtx(defaults);
  it('a member of every side line crosses the cabin/bow boundary: rail, chine, gunwale and web run through the curve in one piece and are scarfed to the bow run', () => {
    for (const id of ['side-cabin-L-chine', 'side-cabin-L-gunwale', 'side-cabin-L-web', 'rail-cabin-L']) {
      const b = worldAABB(get(parts, id));
      expect(b.min[0], id).toBeLessThan(L.xc0 - 1);
      expect(b.max[0], id).toBeGreaterThanOrEqual(L.xn - 0.31);
      expect(get(parts, id).joints!.some((j) => j.type === 'scarf'), id).toBe(true);
    }
    const bb = worldAABB(get(parts, 'side-cabin-L-chine'));
    expect(bb.max[1] - bb.min[1]).toBeGreaterThan(3); // it really spans the curve (14" down to about 10.7" at xn)
  });
  it('the cabin rails reach the scarf and the joist halves and stringers tie the bow rails to the deck', () => {
    const r = worldAABB(get(parts, 'rail-cabin-L'));
    expect(r.max[0]).toBeGreaterThanOrEqual(L.xn - 0.4); // the rail runs on to the scarf
    for (const j of get(parts, 'rail-cabin-L').joints!) expect(j.at!.length).toBe(j.count);
    expect(get(parts, 'stringer-nose-L1').joints!.some((j) => j.to === 'deck' && j.type === 'glue')).toBe(true);
  });
  it('the frame group is joined end to end: the bow rail is scarfed to the cabin rail', () => {
    const ids = parts.map((x) => x.id);
    expect(ids).toContain('rail-nose-L');
    expect(get(parts, 'rail-nose-L').joints!.some((j) => j.to === 'rail-cabin-L' && j.type === 'scarf')).toBe(true);
  });
  it('the prow, its socket, its form and the shoulder panels are gone (D-45)', () => {
    const ids = buildModel(defaults).map((x) => x.id);
    for (const gone of ['prow', 'prow-socket', 'prow-form', 'shoulder-L', 'shoulder-R']) expect(ids).not.toContain(gone);
    // old shared links that carry prow params still load: unknown keys are ignored
    const old = sanitizeParams({ ...defaults, prowHeightIn: 18, prowPlies: 6, prowGrabLbf: 25 } as Partial<Params>);
    expect(old).toEqual(defaults);
  });
});

describe('the structural section of a curved member is its real section, not its bounding box (eng N-4)', () => {
  it('hullLayers uses 5/8" x railBand for the chine and gunwale, whatever the sheer rise or the curve', () => {
    for (const patch of [{}, { sheerRiseIn: 0 }, { sheerRiseIn: 4 }, { hullCurveStartIn: 16 }]) {
      const p = { ...defaults, frameStyle: 1, ...patch } as Params;
      const ctx = makeContext(p, buildModel(p, { rider: 'goal' }));
      for (const zone of ['cabin', 'nose'] as const) {
        const lay = hullLayers(ctx, zone)!;
        const oak = lay.filter((l) => l.kind === 'oak');
        for (const l of oak) {
          expect(l.b, JSON.stringify(patch)).toBeCloseTo(ctx.L.side, 9);
          expect(l.z1 - l.z0).toBeLessThanOrEqual(ctx.p.railDepthIn + (ctx.L.railTop - ctx.L.deckBot) + 1e-9);
        }
        const gun = oak.find((l) => Math.abs(l.z1 - ctx.L.sideTop) < 1e-9)!;
        expect(gun.z1 - gun.z0).toBeCloseTo(ctx.p.railBandIn, 9);
      }
    }
    // The nose section is the same with or without the sheer: the unconservative 4" bounding-box section is gone.
    const a = hullLayers((() => { const q = { ...defaults, frameStyle: 1, sheerRiseIn: 0 } as Params; return makeContext(q, buildModel(q, { rider: 'goal' })); })(), 'nose')!;
    const b = hullLayers((() => { const q = { ...defaults, frameStyle: 1, sheerRiseIn: 2.5 } as Params; return makeContext(q, buildModel(q, { rider: 'goal' })); })(), 'nose')!;
    expect(b).toEqual(a);
  });
});

describe('layout accessors', () => {
  it('sidePath offsets are consistent with the layout widths', () => {
    const L = computeLayout(defaults);
    expect(sidePath(L, L.side / 2, 0, 0.001)[0][1]).toBeCloseTo(L.hwC + L.side, 9);
    expect(sidePath(L, -L.side / 2, L.xFront - L.transom, L.xFront)[0][1]).toBeCloseTo(L.hwN, 1); // the bow side converges: its inner face at the front transom is hwN
  });
});
