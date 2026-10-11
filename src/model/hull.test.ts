/** Phase 3 workstream B: hull shapes, captured ply, joinery, lift hand-holds, finger guard, signs (D-35…D-37, D-45: the prow is gone). */
import { describe, expect, it } from 'vitest';
import { defaultParams, derived, hullCurveSpec, validateParams, type Params } from '../params';
import { leftTirePolys } from './hull-curve';
import { buildModel } from './index';
import { fingerAnalysis, guardInsertZ, liftBarStressPsi, liftSlot, scupperSites } from './body';
import { chooseDomino, DOMINOS, endJoint, frac, joinerySummary } from './joinery';
import { HULL_STEP, box, makeCtx } from './build-utils';
import { sidePath } from './layout';
import { localBounds, worldAABB } from './bounds';
import { totalMass } from './mass';
import type { EdgeCondition, Part, Vec2 } from './types';

const defaults = defaultParams();
const errorsOf = (p: Params) => validateParams(p).filter((i) => i.severity === 'error');
const get = (parts: Part[], id: string) => {
  const x = parts.find((q) => q.id === id);
  if (!x) throw new Error(`no part ${id}`);
  return x;
};

/** Variants of the hull: construction, frame, flare, wheel size, storage, deck, nose. Rejected ones are skipped. */
const PATCHES: Record<string, Partial<Params>> = {
  defaults: {},
  solidOak: { sideConstruction: 0 },
  openFrame: { sideConstruction: 2 },
  hullBeam: { frameStyle: 1 },
  'hullBeam+solid': { frameStyle: 1, sideConstruction: 0 },
  flare1: { gunwaleFlareIn: 1 },
  wheel11_5: { wheelDiameterIn: 11.5 },
  deck9mm: { deckPlyIn: 0.354, panelPlyIn: 0.354 },
  storageForward: { storageLocation: 1 },
  storageUnderSeat: { storageLocation: 2 },
  sideHeight5: { sideHeightIn: 5 },
  wideTire: { tireWidthIn: 4.5 },
  noGuardNeeded: { fingerGapMinIn: 0.5 },
  bigLiftSlot: { liftSlotLengthIn: 5, liftSlotHeightIn: 1.5 },
};
const VARIANTS = Object.entries(PATCHES)
  .map(([name, patch]) => ({ name, p: { ...defaults, ...patch } as Params }))
  .filter((v) => !errorsOf(v.p).length);

const flat = (e: Part['edges']): EdgeCondition[] => (e === undefined ? [] : Array.isArray(e) ? e : [e]);

describe('no exposed plywood edges (acceptance, BRIEF §5.2)', () => {
  it('the variant set is real (most variants build)', () => {
    expect(VARIANTS.length).toBeGreaterThanOrEqual(11);
    expect(VARIANTS.some((v) => v.name === 'defaults')).toBe(true);
  });
  it.each(VARIANTS.map((v) => [v.name, v.p] as const))('%s: every ply part sets edges and none is exposed', (_n, p) => {
    for (const view of [{}, { removed: true }]) {
      const parts = buildModel(p, view);
      const ply = parts.filter((x) => !x.payload && (x.kind === 'sheet' || /ply/i.test(x.material)));
      expect(ply.length).toBeGreaterThanOrEqual(6);
      for (const x of ply) {
        const e = flat(x.edges);
        expect(e.length, `${x.id} has edges`).toBeGreaterThan(0);
        expect(e.filter((c) => c === 'exposed'), `${x.id} exposed edges`).toEqual([]);
        if (Array.isArray(x.edges) && x.geometry.type === 'extrusion') expect(x.edges.length, `${x.id} one entry per outline edge (then per hole edge)`).toBe(x.geometry.outline.length + (x.geometry.holes ?? []).reduce((m, h) => m + h.length, 0));
      }
    }
  });
  it('the check really fails if an edge is exposed', () => {
    const parts = buildModel(defaults);
    const deck = get(parts, 'deck');
    deck.edges = ['captured', 'exposed', 'captured', 'captured'];
    const bad = parts.filter((x) => flat(x.edges).includes('exposed')).map((x) => x.id);
    expect(bad).toEqual(['deck']);
  });
  it('captured vs edged is what the joinery says: captured edges have a groove, rabbet or dado joint on the neighbor', () => {
    const parts = buildModel(defaults);
    const web = get(parts, 'side-cabin-L-web');
    expect(web.edges).toBe('captured'); // the curved panel: both ends captured (transom dado, scarf to the nose panel)
    expect(web.joints!.filter((j) => j.type === 'dado').map((j) => j.to).sort()).toEqual(['side-cabin-L-chine', 'side-cabin-L-gunwale', 'transom-rear']);
    expect(web.joints!.filter((j) => j.type === 'scarf').map((j) => j.to)).toEqual(['side-nose-L-web']);
    const deck = get(parts, 'deck');
    // D-52: one deck, in the chine rabbets all the way round (cabin and bow chines), and in a dado in each transom.
    expect(deck.joints!.filter((j) => j.type === 'rabbet').map((j) => j.to).sort()).toEqual(['side-cabin-L-chine', 'side-cabin-R-chine', 'side-nose-L-chine', 'side-nose-R-chine']);
    expect(deck.joints!.some((j) => j.type === 'dado' && j.to === 'transom-rear')).toBe(true);
    expect(deck.joints!.some((j) => j.type === 'dado' && j.to === 'transom-front')).toBe(true);
    // The deck is carried by the rails (glue), the cabin joists and the nose stringers and joist halves.
    expect(deck.joints!.filter((j) => j.type === 'glue').map((j) => j.to)).toEqual(expect.arrayContaining(['rail-cabin-L', 'joist-cabin-1', 'stringer-nose-L1', 'joist-nose-1-L']));
    // The nose stringer / joist halves hold the deck across the steering-linkage corridor.
    expect(get(parts, 'joist-nose-1-L').joints!.some((j) => j.to === 'stringer-nose-L1' || j.to === 'stringer-nose-L2')).toBe(true);
  });
});

describe('captured-ply sides, decks and transoms (D-22, D-35)', () => {
  const parts = buildModel(defaults);
  const ctx = makeCtx(defaults);
  const { L } = ctx;
  const dd = defaults.deckCaptureDepthIn, g = defaults.grooveDepthIn;
  it('the web (a curved sweep in the cabin run, a straight extrusion in the nose) enters the chine and gunwale grooves by the groove depth', () => {
    for (const id of ['side-cabin-L', 'side-cabin-R', 'side-nose-L', 'side-nose-R']) {
      const web = get(parts, `${id}-web`), chine = get(parts, `${id}-chine`), gun = get(parts, `${id}-gunwale`);
      expect(web.geometry.type).toBe(id.includes('cabin') ? 'sweep' : 'extrusion');
      const w = worldAABB(web), c = worldAABB(chine), q = worldAABB(gun);
      expect(c.max[2] - w.min[2]).toBeCloseTo(g, 6);
      // The nose gunwale and web follow the sheer curve (D-44): their boxes differ by the rise, and visual-geometry.test.ts checks the capture along the curve.
      expect(w.max[2] - q.min[2]).toBeCloseTo(g + (id.includes('nose') ? L.sheer.riseIn : 0), 6);
      expect(web.geometry.type === 'extrusion' ? web.geometry.depth : web.geometry.type === 'sweep' ? web.geometry.thickness : -1).toBeCloseTo(defaults.panelPlyIn, 9);
    }
  });
  it('the groove leaves sturdy oak walls (≥ 0.1") and a ply that fits the groove', () => {
    expect((defaults.sideThicknessIn - defaults.panelPlyIn - defaults.grooveSlopIn) / 2).toBeGreaterThanOrEqual(0.1);
    expect(validateParams(defaults).filter((i) => i.severity !== 'info')).toEqual([]);
    const thin = validateParams({ ...defaults, sideThicknessIn: 0.375 });
    expect(thin.some((i) => i.severity === 'warn' && i.keys.includes('grooveSlopIn'))).toBe(true);
  });
  it('the web ends enter the transom dados (cabin) or the front transom dado (nose)', () => {
    const rw = get(parts, 'side-cabin-L-web').geometry;
    expect(rw.type === 'sweep' && rw.path[0][0]).toBeCloseTo(L.xRear + L.transom - dd, 6);
    // The bow web is set at the bow heading, so its square end corner pokes (pl/2) sin(heading) past the dado depth.
    expect(worldAABB(get(parts, 'side-nose-L-web')).max[0]).toBeCloseTo(L.xFront - L.transom + dd, 1);
  });
  it('the deck is one plan extrusion that enters the chine rabbets and both transom dados', () => {
    const d = get(parts, 'deck');
    expect(d.geometry.type).toBe('extrusion');
    const a = worldAABB(d);
    expect(a.max[1]).toBeCloseTo(L.hwC + dd, 6);
    expect(a.min[0]).toBeCloseTo(L.xRear + L.transom - dd, 6);
    expect(a.max[0]).toBeCloseTo(L.xFront - L.transom + dd, 6);
    const nf = (d.geometry as { outline: Vec2[] }).outline.filter((q) => q[0] > L.xFront - 2);
    expect(Math.max(...nf.map((q) => q[1]))).toBeCloseTo(L.hwN + dd, 0); // the bow edge is the converging chine inner face + the capture depth (about 6.1 at the front transom)
    expect(a.max[2] - a.min[2]).toBeCloseTo(L.ply, 6);
  });
  it('the transoms span the full outside width and wrap the side ends', () => {
    const r = worldAABB(get(parts, 'transom-rear')), f = worldAABB(get(parts, 'transom-front'));
    expect(r.max[1]).toBeCloseTo(L.hwC + L.side, 6);
    expect(r.min[1]).toBeCloseTo(-(L.hwC + L.side), 6);
    expect(f.max[1]).toBeCloseTo(L.hwN + L.side, 6);
    expect(r.max[0] - r.min[0]).toBeCloseTo(L.transom, 6);
    expect(L.transom).toBe(0.75); // D-43: the transoms are ¾", the chine and gunwale ⅝"
    expect(L.side).toBe(0.625);
    const side = get(parts, 'side-cabin-L-chine').geometry;
    expect(side.type === 'sweep' && side.path[0][0]).toBeCloseTo(L.xRear + L.transom, 6);
  });
  it('the deck is one uncut sheet: the ride stick cable slot is gone (D-53) and its edges are all captured', () => {
    const d = get(parts, 'deck');
    if (d.geometry.type !== 'extrusion') throw new Error('deck is not an extrusion');
    expect(d.geometry.holes ?? []).toHaveLength(0);
    expect(d.edges).toHaveLength(d.geometry.outline.length);
    expect(flat(d.edges).includes('exposed')).toBe(false);
  });
});

describe('every wood part has a grain direction and rough stock', () => {
  it.each(VARIANTS.map((v) => [v.name, v.p] as const))('%s', (_n, p) => {
    for (const x of buildModel(p).filter((q) => q.kind === 'lumber' || q.kind === 'sheet' || q.kind === 'bentlam')) {
      expect(x.grain, `${x.id} grain`).toMatch(/^[xyz]$/);
      expect(x.stock, `${x.id} stock`).toBeDefined();
      if (x.kind === 'lumber' || x.kind === 'bentlam') {
        expect(x.rough, `${x.id} rough`).toBeDefined();
        expect(x.rough!.t, x.id).toBeGreaterThan(x.stock!.t);
        expect(x.rough!.w, x.id).toBeGreaterThan(x.stock!.w);
        expect(x.rough!.l, x.id).toBeGreaterThan(x.stock!.l);
      }
    }
  });
});

describe('joinery: structured joints', () => {
  const parts = buildModel(defaults);
  const ids = new Set(parts.map((x) => x.id));
  it('every joint names a real mating part, has finite local locations matching its count, and is reciprocal', () => {
    for (const v of VARIANTS) {
      const ps = buildModel(v.p);
      const idSet = new Set(ps.map((x) => x.id));
      for (const x of ps) for (const j of x.joints ?? []) {
        if (!idSet.has(j.to)) continue; // other workstreams' joints may name parts they own
        if (j.at) {
          expect(j.at.length, `${v.name} ${x.id}→${j.to}`).toBe(j.count);
          for (const a of j.at) expect(a.every(Number.isFinite), `${v.name} ${x.id}→${j.to}`).toBe(true);
        }
        const other = ps.find((q) => q.id === j.to)!;
        // Pairs inside this workstream's parts (hull, frame, signs) are listed on both sides; other workstreams list their own.
        const mine = (q: Part) => q.group === 'body' || q.group === 'frame' || q.id.startsWith('sign-');
        if (mine(x) && mine(other)) expect(other.joints?.some((k) => k.to === x.id), `${v.name}: ${x.id}→${j.to} reciprocal`).toBe(true);
      }
    }
    expect(ids.has('transom-front')).toBe(true);
  });
  it('joint locations are in the part local frame: a box rail-end joint sits at its end face', () => {
    const L0 = makeCtx(defaults).L;
    const rail = get(parts, 'rail-cabin-L');
    const tenon = rail.joints!.find((j) => j.to === 'transom-rear')!;
    expect(tenon.type).toBe('mortise-tenon');
    expect(tenon.at![0][0]).toBeCloseTo(L0.xRear + L0.transom, 3); // the bent rail's local x is model x: the joint sits at its rear end, the transom face at −10 + 0.75
    const joist = get(parts, 'joist-cabin-1');
    const d = joist.joints!.filter((j) => j.type === 'domino');
    expect(d.map((j) => j.to).sort()).toEqual(['rail-cabin-L', 'rail-cabin-R']);
    expect(d.map((j) => Math.round(j.at![0][1])).sort((a, b) => a - b)).toEqual([-13, 13]); // the two ends of the 25.5" joist
  });
  it('Domino size follows the stock: thin rails get a DF 500 5×30; thick stock gets XL; 1/2" hosts get a CNC blind tenon', () => {
    expect(chooseDomino(defaults, { stockIn: 0.75, hostIn: 0.75, widthIn: 1.75 })?.name).toBe('5×30');
    const thick = chooseDomino(defaults, { stockIn: 1.5, hostIn: 1.5, widthIn: 3 });
    expect(thick?.tool).toBe('DF 500');
    expect(thick!.tMm).toBeGreaterThanOrEqual(10);
    expect(chooseDomino(defaults, { stockIn: 3, hostIn: 3, widthIn: 5 })?.tool).toBe('DF 700 XL');
    expect(chooseDomino(defaults, { stockIn: 0.5, hostIn: 0.5, widthIn: 1.5 })).toBeNull();
    expect(endJoint(defaults, 0.5, 0.5, 1.5).type).toBe('mortise-tenon');
    expect(endJoint(defaults, 0.75, 0.75, 1.75).type).toBe('domino');
    expect(DOMINOS.every((d) => d.tMm < d.lMm)).toBe(true);
    // The wall left behind a mortise never drops below the minimum.
    for (const [s, h, w] of [[0.75, 0.75, 1.75], [1, 1, 2], [1.5, 1.5, 3], [2, 2, 4]] as const) {
      const d = chooseDomino(defaults, { stockIn: s, hostIn: h, widthIn: w });
      if (d) expect(h - d.lMm / 2 / 25.4).toBeGreaterThanOrEqual(defaults.dominoMinWallIn - 1e-9);
    }
    expect(frac(0.1875)).toBe('3/16');
    expect(frac(1.5)).toBe('1-1/2');
  });
  // Every structured joint says where it is (DXF holes, viewer cut previews). `locateJoints` derives positions for the parts
  // built outside the hull/frame joinery from the contact region of the mated parts. No exceptions are allowed: a new joint
  // without `at` fails here. Payload parts (rider, cargo, truck) have no joinery.
  it('every structured joint on a non-payload part has `at` with `count` finite positions near the part', () => {
    for (const v of VARIANTS) {
      const ps = buildModel(v.p, { rider: 'goal', cargo: true, steerDeg: 0 });
      const ids = new Set(ps.map((x) => x.id));
      for (const part of ps.filter((x) => !x.payload)) {
        const b = localBounds(part.geometry);
        for (const j of part.joints ?? []) {
          const tag = `${v.name}: ${part.id} -> ${j.to} (${j.type})`;
          expect(ids.has(j.to), `${tag} mates a part that exists`).toBe(true);
          expect(j.at?.length, `${tag} has ${j.count} locations`).toBe(j.count);
          for (const a of j.at!) {
            expect(a.every(Number.isFinite), tag).toBe(true);
            // Within 1" of the part's own bounds (the stop wedges and tilted webs are boxed loosely by their axis-aligned contact region).
            for (let k = 0; k < 3; k++) expect(a[k], `${tag} axis ${k}`).toBeGreaterThanOrEqual(b.min[k] - 1);
            for (let k = 0; k < 3; k++) expect(a[k], `${tag} axis ${k}`).toBeLessThanOrEqual(b.max[k] + 1);
          }
        }
      }
    }
  });
  it('summary counts each physical joint once, by type (default model)', () => {
    const mine = (x: Part) => x.group === 'body' || x.group === 'frame' || x.id.startsWith('sign-');
    const s = joinerySummary(parts.filter(mine));
    expect(s.total).toBeGreaterThan(40);
    for (const k of ['domino', 'mortise-tenon', 'dado', 'rabbet', 'glue', 'threaded-insert', 'knob', 'screw']) expect(s.byType[k] ?? 0, k).toBeGreaterThan(0);
    // Doubled lists (both parts) would give at least twice the once-counted total.
    const both = parts.filter(mine)
      .reduce((m, x) => m + (x.joints ?? []).reduce((a, j) => a + j.count, 0), 0);
    expect(both).toBeGreaterThan(s.total);
  });
  it('signs and the finger guards come off with inserts and knobs (D-9)', () => {
    const sign = get(parts, 'sign-L');
    expect(sign.removable).toBe(true);
    expect(sign.joints!.find((j) => j.type === 'knob')!.count).toBe(4);
    expect(get(parts, 'side-cabin-L-web').joints!.find((j) => j.type === 'threaded-insert' && j.to === 'sign-L')!.count).toBe(4);
  });
});

describe('lift hand-holds (M9, D-37)', () => {
  const ctx = makeCtx(defaults);
  const parts = buildModel(defaults);
  it('both transoms have a stadium slot through them, ≥ 4.5" × 1.25", above the deck and clear of the box', () => {
    for (const id of ['transom-rear', 'transom-front']) {
      const t = get(parts, id);
      expect(t.geometry.type).toBe('extrusion');
      if (t.geometry.type !== 'extrusion') continue;
      expect(t.geometry.holes).toHaveLength(5); // the lift slot + 4 dado vent holes (M4, D-43)
      const h = t.geometry.holes![0] as Vec2[];
      const w = Math.max(...h.map((q) => q[0])) - Math.min(...h.map((q) => q[0]));
      const ht = Math.max(...h.map((q) => q[1])) - Math.min(...h.map((q) => q[1]));
      expect(w).toBeCloseTo(defaults.liftSlotLengthIn, 3);
      expect(ht).toBeCloseTo(defaults.liftSlotHeightIn, 3);
      expect(w).toBeGreaterThanOrEqual(4.5 - 1e-9);
      expect(ht).toBeGreaterThanOrEqual(1.25 - 1e-9);
    }
    const rear = liftSlot(ctx, 'rear');
    expect(rear.zBot).toBeGreaterThanOrEqual(ctx.L.deckTop + defaults.liftSlotClearIn - 1e-9);
    expect(rear.zBot).toBeGreaterThanOrEqual(ctx.L.storage.zTop); // a box against the transom does not block the hand
    expect(liftSlot(ctx, 'front').zBot).toBeGreaterThanOrEqual(ctx.L.deckTop + 1);
  });
  it('the grip bar carries the per-person transport lift × 3 (one hand, simply supported over the slot)', () => {
    const perPerson = totalMass(buildModel(defaults, { removed: true })) / 2;
    const load = perPerson * defaults.dynamicFactor;
    const allow = derived(defaults).oakDesignMorPsi;
    for (const end of ['rear', 'front'] as const) {
      const s = liftBarStressPsi(liftSlot(ctx, end), load);
      expect(s, `${end} bar ${s.toFixed(0)} psi vs ${allow.toFixed(0)}`).toBeLessThan(allow);
    }
    expect(perPerson).toBeGreaterThan(40);
  });
  it('the stress function is the beam formula', () => {
    // M = P L / 4 = 174 × 4.5 / 4 = 195.75; S = t h² / 6 = 0.75 × 0.75² / 6 = 0.0703125 → σ = 2784 psi (the ¾" transom, D-43)
    const s = liftBarStressPsi({ zBot: 0, zTop: 1, transomTop: 2, barIn: 0.75, thickIn: 0.75, lengthIn: 4.5 }, 174);
    expect(s).toBeCloseTo(2784, 0);
  });
  it('a storage box against the rear transom raises the slot; the transom crests rather than thinning the bar', () => {
    const r = liftSlot(ctx, 'rear');
    expect(r.zTop + defaults.liftBarMinIn).toBeLessThanOrEqual(r.transomTop + 1e-9);
    expect(r.transomTop).toBeGreaterThanOrEqual(ctx.L.deckTop + ctx.L.sideH);
    const f = liftSlot(ctx, 'front');
    expect(f.transomTop).toBeCloseTo(ctx.L.sideTop + ctx.L.sheer.riseIn, 9); // the lantern / flag clips straddle this top (D-41); it rises with the sheer at the bow (D-44)
  });
});

describe('finger guard (M5, D-37)', () => {
  const NO_PINCH = defaults.fingerGapMinIn;
  /** Independent check: smallest plan distance between the left tire (the Ackermann sweep, 1 degree steps) and the bow's outer face from the end of the curve forward. */
  function sideGap(p: Params): number {
    const c = makeCtx(p);
    const face = sidePath(c.L, c.L.side / 2, c.L.xn, c.L.xFront - c.L.transom);
    let g = Infinity;
    for (const t of leftTirePolys(hullCurveSpec(c.p), 1)) {
      for (let i = 0; i + 1 < face.length; i++) for (let k = 0; k <= 10; k++) {
        const q: [number, number] = [face[i][0] + ((face[i + 1][0] - face[i][0]) * k) / 10, face[i][1] + ((face[i + 1][1] - face[i][1]) * k) / 10];
        g = Math.min(g, distToPoly(t, q));
      }
    }
    return g;
  }
  /** Distance from a point to a polygon's boundary (0 inside). */
  function distToPoly(poly: Vec2[], q: Vec2): number {
    let m = Infinity;
    for (let j = 0; j < poly.length; j++) {
      const A = poly[j], B = poly[(j + 1) % poly.length];
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const u = Math.max(0, Math.min(1, ((q[0] - A[0]) * dx + (q[1] - A[1]) * dy) / (dx * dx + dy * dy)));
      m = Math.min(m, Math.hypot(q[0] - A[0] - u * dx, q[1] - A[1] - u * dy));
    }
    return m;
  }
  it('at the defaults the bare gap is a pinch gap, so guards are built', () => {
    const a = fingerAnalysis(makeCtx(defaults));
    expect(a.minGapIn).toBeLessThan(NO_PINCH);
    expect(a.minGapIn).toBeCloseTo(0.76, 1); // the hull is fitted 0.75 + 0.005 from the Ackermann tire sweep (D-52)
    expect(a.guardNeeded).toBe(true);
    expect(a.hazard).not.toBeNull();
    expect(sideGap(defaults)).toBeGreaterThan(0.7);
  });
  it('r3 N-9: the hazard zone sits at the pinch (x about 36-40) and the guard (one mesh per side) spans it; it is on the bow run, beyond the curve (x >= xn - 0.5)', () => {
    const c = makeCtx(defaults);
    const a = fingerAnalysis(c);
    const hz = a.hazard!;
    expect(hz.x0).toBeGreaterThan(c.L.xn - 1); // the Ackermann pinch zone starts at the end of the curve (x about 36)
    expect(hz.x0).toBeLessThan(hz.x1);
    expect(hz.x1 - hz.x0).toBeLessThan(6); // short: the hull angles away from the tire on both sides of the pinch
    // independent brute force: every sampled hull-face point within the no-pinch gap of a swept tire lies inside the guard's x range
    const face = sidePath(c.L, c.L.side / 2, c.L.xn - 2, c.L.xn + 8);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i + 1 < face.length; i++) for (let k = 0; k <= 10; k++) {
      const q: [number, number] = [face[i][0] + ((face[i + 1][0] - face[i][0]) * k) / 10, face[i][1] + ((face[i + 1][1] - face[i][1]) * k) / 10];
      for (const t of leftTirePolys(hullCurveSpec(c.p), 1)) {
        const m = distToPoly(t, q);
        if (m < defaults.fingerGapMinIn - 1e-9) { lo = Math.min(lo, q[0]); hi = Math.max(hi, q[0]); }
      }
    }
    expect(hi).toBeGreaterThan(lo);
    for (const tag of ['L', 'R'] as const) {
      const g = get(buildModel(defaults), `guard-${tag}`);
      const b = worldAABB(g);
      expect(b.min[0], tag).toBeLessThanOrEqual(lo + 1e-6);
      expect(b.max[0], tag).toBeGreaterThanOrEqual(hi - 1e-6);
      expect(g.geometry.type).toBe('mesh'); // one printed piece that follows the outline
      expect(g.kind).toBe('printed');
      const ys = b.max[1] - b.min[1];
      expect(ys).toBeGreaterThan(defaults.fingerGapMinIn + 0.3);
    }
  });
  it.each(VARIANTS.map((v) => [v.name, v.p] as const))('%s: min tire-to-hull gap ≥ no-pinch OR a guard covers the pinch zone', (_n, p) => {
    const parts = buildModel(p);
    const c = makeCtx(p);
    const a = fingerAnalysis(c);
    if (a.minGapIn >= NO_PINCH && p.fingerGapMinIn === defaults.fingerGapMinIn) return; // open gap: nothing to guard
    if (!a.guardNeeded) {
      expect(parts.some((x) => x.id.startsWith('guard-'))).toBe(false);
      expect(a.minGapIn).toBeGreaterThanOrEqual(p.fingerGapMinIn - 1e-9);
      return;
    }
    if (a.infeasible) return; // tire taller than the hull side: reported by the analysis, no guard possible
    for (const tag of ['L', 'R'] as const) {
      const guard = get(parts, `guard-${tag}`);
      const b = worldAABB(guard);
      const hz = a.hazard!;
      expect(b.min[0], `${tag} covers the pinch zone aft`).toBeLessThanOrEqual(hz.x0 + 1e-6);
      expect(b.max[0], `${tag} covers the pinch zone fore`).toBeGreaterThanOrEqual(hz.x1 - 1e-6);
      const yo = c.L.hwN + c.L.side;
      const out = tag === 'L' ? b.max[1] - yo : -b.min[1] - yo;
      expect(out, `${tag} reaches over the zone`).toBeGreaterThanOrEqual(hz.outMax - 1e-6);
      expect(out).toBeGreaterThanOrEqual(p.fingerGapMinIn - 1e-6);
      // Above the tire top by at least the steering clearance, so the sweep cannot touch it.
      expect(b.min[2] - p.wheelDiameterIn, `${tag} clear of the tire`).toBeGreaterThanOrEqual(p.steeringClearanceIn - 1e-6);
      expect(guard.kind).toBe('printed');
      expect(guard.joints!.filter((j) => j.type === 'screw').reduce((n, j) => n + j.count, 0)).toBeGreaterThanOrEqual(3); // strap inserts: cabin gunwale on the curve, nose gunwale on the straight
    }
  });
  it('opening the gap is the other route: a wide-enough threshold-free gap builds no guard', () => {
    const p = { ...defaults, fingerGapMinIn: 0.5 };
    expect(buildModel(p).some((x) => x.id.startsWith('guard-'))).toBe(false);
  });
});

describe('signs (D-9, D-35)', () => {
  const parts = buildModel(defaults);
  it('two removable 6 mm blanks, banded on all edges, with four knob screws each', () => {
    for (const tag of ['L', 'R']) {
      const s = get(parts, `sign-${tag}`);
      expect(s.removable).toBe(true);
      expect(s.edges).toBe('edged');
      expect(s.geometry.type === 'box' && s.geometry.size[1]).toBeCloseTo(defaults.panelPlyIn, 9);
      expect(s.group).toBe('removable');
      expect(s.notes).toMatch(/banded/);
    }
    expect(buildModel(defaults, { removed: true }).some((x) => x.id.startsWith('sign-'))).toBe(false);
  });
  it('banding adds oak mass over the bare ply', () => {
    const s = get(parts, 'sign-L');
    if (s.geometry.type !== 'box') return;
    const [l, t, h] = s.geometry.size;
    const bare = (l * t * h / 1728) * derived(defaults).plyDensityPcf + (2 * (l * t + t * h + l * h) / 144) * defaults.finishLbPerFt2;
    expect(s.massLb).toBeGreaterThan(bare + 0.03);
  });
});

describe('mass bookkeeping (D-35…D-37)', () => {
  it('the hull and frame groups stay near the flip numbers (body 35.4, frame 15.4 with the stringers and joist halves, removable 3.4 lb)', () => {
    const parts = buildModel(defaults);
    const sum = (g: string) => parts.filter((x) => x.group === g && !x.payload).reduce((m, x) => m + x.massLb, 0);
    // D-44 visual pass: sheer (front transom +0.9 lb, nose webs +0.2), crowned rear transom +0.25 → body ≈ 36.5 (was 35.2).
    // D-45: the prow, its socket and the shoulder panels are gone (−3.2 lb body, −0.9 lb removable); the 4" rails and the shoulder beam add to the frame.
    // D-52 (Phase 3b flip): one deck level, the bow taper with straight bow members, the cable slot, the nose stringers and joist halves; the sheer starts beyond the pinch.
    expect(Math.abs(sum('body') - 35.4)).toBeLessThan(1);
    expect(Math.abs(sum('frame') - 15.4)).toBeLessThan(0.7);
    expect(Math.abs(sum('removable') - 3.4)).toBeLessThan(0.6);
  });
});


describe('round 2 hull (build M2-M8, D-43)', () => {
  const parts = buildModel(defaults);
  const ctx = makeCtx(defaults);
  const { L } = ctx;
  const p = defaults;

  it('transoms are 3/4", chines and gunwales 5/8", the groove is 0.276" (6 mm ply + 1 mm), leaving 0.17" walls', () => {
    expect(L.transom).toBe(0.75);
    expect(L.side).toBe(0.625);
    // groove = 0.236 + 0.04 = 0.276"; wall each side = (0.625 − 0.276) / 2 = 0.1745"
    expect(p.panelPlyIn + p.grooveSlopIn).toBeCloseTo(0.276, 9);
    expect((p.sideThicknessIn - p.panelPlyIn - p.grooveSlopIn) / 2).toBeCloseTo(0.1745, 4);
    expect(get(parts, 'side-cabin-L-chine').joints!.find((j) => j.to === 'side-cabin-L-web')!.size).toMatch(/0\.276/);
  });

  it('rough length gets 4× the milling allowance (M8): the 35.625" chine is 36.125" rough, 1/8" more each way in t and w', () => {
    const c = get(parts, 'side-nose-L-chine');
    // The straight bow chine is set at the bow heading: its length is the run along the heading, less the square-end trim at the transom.
    expect(c.stock!.l).toBeCloseTo((L.xFront - L.transom - L.xn) / Math.cos(L.bowHeading) - (L.side / 2) * Math.abs(Math.sin(L.bowHeading)), 6);
    expect(c.rough!.l).toBeCloseTo(c.stock!.l + 0.5, 6);
    expect(c.rough!.t).toBeCloseTo(0.75, 6);
    const bent = get(parts, 'side-cabin-L-chine');
    expect(bent.stock!.l).toBeGreaterThan(L.xn - (L.xRear + L.transom)); // longer than the straight distance: it follows the curve
    expect(bent.stock!.l).toBeLessThan(1.1 * (L.xn - (L.xRear + L.transom)));
    for (const x of parts.filter((q) => q.rough && q.stock && (q.group === 'body' || q.group === 'frame'))) expect(x.rough!.l - x.stock!.l, x.id).toBeCloseTo(4 * p.millingAllowanceIn, 6);
  });

  it('a steel box with no stock gets the bar section x cut length and a McMaster-class source (M9 net)', () => {
    const b = box(ctx, { id: 'x', name: 'x', group: 'hardware', center: [0, 0, 0], mat: 'steel', size: [0.25, 1, 6], step: 1 });
    expect(b.stock).toEqual({ t: 0.25, w: 1, l: 6 });
    expect(b.sourcing?.vendor).toMatch(/McMaster/);
  });

  it('the ladder rail runs flush under the chine and the chine is Domino-tied to it (M6, D-45): rail outer face = chine outer face all along the S-curve', () => {
    const rail = get(parts, 'rail-cabin-L'), chine = get(parts, 'side-cabin-L-chine');
    expect(rail.geometry.type).toBe('sweep');
    if (rail.geometry.type !== 'sweep' || chine.geometry.type !== 'sweep') return;
    // Path z = −|y|; the outer face is the centerline + half the thickness. The rail centerline is 13.375 + 0.625 − 0.75/2 = 13.625; the chine's 13.6875.
    expect(-rail.geometry.path[0][1] + rail.geometry.thickness / 2).toBeCloseTo(14, 6);
    expect(-chine.geometry.path[0][1] + chine.geometry.thickness / 2).toBeCloseTo(14, 6);
    for (let i = 0; i < rail.geometry.path.length; i += 3) {
      const [x, z] = rail.geometry.path[i];
      const q = chine.geometry.path.reduce((m, r) => (Math.abs(r[0] - x) < Math.abs(m[0] - x) ? r : m));
      // outer faces agree to the sampling error of two polylines (the chine centerline is 1/16" off the rail's; compare outer offsets along the same x)
      expect(Math.abs(-z + rail.geometry.thickness / 2 - (-q[1] + chine.geometry.thickness / 2)), `x ${x.toFixed(1)}`).toBeLessThan(0.25);
    }
    expect(worldAABB(rail).max[2]).toBeCloseTo(worldAABB(chine).min[2], 6); // the chine bears on the rail top
    expect(L.railTop).toBeCloseTo(L.deckBot, 9);
    const tie = chine.joints!.find((j) => j.to === 'rail-cabin-L')!;
    expect(tie.type).toBe('domino');
    expect(tie.count).toBe(Math.floor((L.xn - (L.xRear + L.transom)) / defaults.chineTieSpacingIn));
    expect(tie.size).toMatch(/DF 500/);
    expect(tie.note).toMatch(/VERTICAL/);
    expect(get(parts, 'rail-cabin-L').joints!.some((j) => j.to === 'side-cabin-L-chine')).toBe(true);
    const hb = buildModel({ ...defaults, frameStyle: 1 });
    expect(hb.find((x) => x.id === 'side-cabin-L-chine')!.joints!.some((j) => j.to === 'girder-cabin-L' && j.type === 'domino')).toBe(true);
  });

  it('chooseDomino fits the FACE WIDTH, not the length (hand: 1.2" face − 2 × 0.25" = 0.7" = 17.8 mm takes a 17 mm-wide 4×20, not the 19 mm 5×30)', () => {
    const d = chooseDomino(p, { stockIn: 1.5, hostIn: 1.5, widthIn: 1.2 });
    expect(d?.name).toBe('4×20');
    expect(chooseDomino(p, { stockIn: 1.5, hostIn: 1.5, widthIn: 1.0 })).toBeNull(); // 0.5" = 12.7 mm < 17 mm
    // Depth: the receiving member must keep a wall behind the L/2 mortise: a 4×20 (0.394" deep) into a 0.5" host leaves 0.106" < 0.15".
    expect(chooseDomino(p, { stockIn: 1.5, hostIn: 0.5, widthIn: 3 })).toBeNull();
    expect(chooseDomino(p, { stockIn: 1.5, hostIn: 3, widthIn: 3, stockAlongIn: 0.5 })).toBeNull();
    expect(DOMINOS.find((x) => x.name === '6×40')!.wMm).toBe(20);
  });

  it('finger-guard inserts sit above the web groove, not in it (M2): axis 0.785" over the gunwale bottom, hole spans 0.625..0.945 vs groove top 0.375 + 0.25 wall', () => {
    const zg = L.sideTop - L.railBand; // D-45: the sides (and the gunwale the guard screws to) are at the cabin height along the whole hull
    const z = guardInsertZ(L, p);
    expect(z - zg).toBeCloseTo(0.375 + 0.25 + 0.16, 6);
    expect(z - 0.16).toBeGreaterThanOrEqual(zg + p.grooveDepthIn + 0.25 - 1e-9);
    const j = get(parts, 'guard-L').joints!.find((q) => q.type === 'screw')!;
    for (const a of get(parts, 'guard-L').joints![0].at!) void a;
    expect(j.size).toMatch(/button-head/);
    const ins = get(parts, 'side-nose-L-gunwale').joints!.find((q) => q.to === 'guard-L')!;
    expect(ins.size).toMatch(/stainless/);
    expect(ins.size).not.toMatch(/brass/);
  });

  it('scuppers: four 3/8" stainless nipples through the chines at deck level (M7; one deck level, so only the two ends drain), each with a joint and `at`', () => {
    const sc = parts.filter((x) => x.id.startsWith('scupper-'));
    expect(sc).toHaveLength(4);
    expect(scupperSites(ctx)).toHaveLength(2);
    for (const x of sc) {
      expect(x.joints![0].at).toHaveLength(1);
      expect(x.sourcing?.vendor).toMatch(/stainless/i);
      const bb = worldAABB(x);
      // lower edge of the hole 0.05" over the deck surface: z = deck + 0.05 + 3/16 − 3/16
      const deckZ = /nose/.test(x.id) ? L.deckTop : L.deckTop;
      expect(bb.min[2]).toBeCloseTo(deckZ + 0.05, 3);
    }
  });

  it('rear transom backers sit inside the transom behind the sockets, and the rear box starts behind them (S13)', () => {
    for (const tag of ['L', 'R']) {
      const b = worldAABB(get(parts, `transom-backer-${tag}`));
      expect(b.min[0]).toBeCloseTo(L.xRear + L.transom, 6);
      expect(b.max[0] - b.min[0]).toBeCloseTo(p.blockingThickIn, 6);
      expect(b.max[1] <= L.hwC + 1e-9 || b.min[1] >= -L.hwC - 1e-9).toBe(true);
      expect(get(parts, `transom-backer-${tag}`).joints!.some((j) => j.to === 'transom-rear')).toBe(true);
    }
    expect(L.storage.x0).toBeCloseTo(L.xRear + L.transom + L.rearLane, 6);
  });

  it('assembly order is data (M4, D-45): deck 4 < sides 4.2 < transoms 4.4, and every closed dado is vented', () => {
    const st = (id: string) => get(parts, id).step;
    expect(st('deck')).toBe(HULL_STEP.deck);
    expect(st('side-cabin-L-web')).toBe(HULL_STEP.sides);
    expect(st('side-cabin-L-chine')).toBe(HULL_STEP.sides);
    expect(st('transom-rear')).toBe(HULL_STEP.transom);
    expect(st('transom-front')).toBe(HULL_STEP.transom);
    expect(HULL_STEP.deck < HULL_STEP.sides && HULL_STEP.sides < HULL_STEP.transom).toBe(true);
    expect(get(parts, 'transom-rear').notes).toMatch(/GOES ON LAST/);
    expect(get(parts, 'side-cabin-L-web').notes).toMatch(/hydraulic lock/);
    for (const j of get(parts, 'transom-rear').joints!.filter((q) => q.type === 'dado')) expect(j.size, j.to).toMatch(/vent/);
  });

  it('no joint says "CNC blind tenon": thin members get a loose tenon (S2)', () => {
    for (const x of parts) for (const j of x.joints ?? []) if (x.group === 'body' || x.group === 'frame') expect(j.size ?? '', `${x.id}->${j.to}`).not.toMatch(/CNC blind/i);
    const lt = parts.flatMap((x) => (x.group === 'body' || x.group === 'frame' ? x.joints ?? [] : [])).filter((j) => j.type === 'mortise-tenon');
    expect(lt.length).toBeGreaterThan(0);
    for (const j of lt) expect(j.size).toMatch(/loose tenon/);
  });

  it('10" joists: the cabin deck has 5 crossmembers (4 at 10" spacing, the one on the rear beam becomes a straddling pair), the largest bay is about 8.25"', () => {
    expect(L.cabinJoistX).toHaveLength(5);
    expect(p.crossmemberSpacingIn).toBe(10);
    const edges = [L.xRear + L.transom, ...L.cabinJoistX.flatMap((x) => [x - L.joistT / 2, x + L.joistT / 2]), L.xn];
    let bay = 0;
    for (let i = 0; i + 1 < edges.length; i += 2) bay = Math.max(bay, edges[i + 1] - edges[i]);
    expect(bay).toBeLessThan(10);
    expect(bay).toBeGreaterThan(8);
  });
});
