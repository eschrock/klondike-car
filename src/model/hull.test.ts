/** Phase 3 workstream B: hull shapes, captured ply, joinery, lift hand-holds, finger guard, prow, signs (D-35…D-37). */
import { describe, expect, it } from 'vitest';
import { defaultParams, derived, validateParams, type Params } from '../params';
import { buildModel } from './index';
import { makeCtx } from './build-utils';
import { buildBody, fingerAnalysis, frontTirePlan, liftBarStressPsi, liftSlot, prowFormProfile, prowShape } from './body';
import { chooseDomino, DOMINOS, endJoint, frac, joinerySummary } from './joinery';
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
  noseRaise2: { frontDeckRaiseIn: 2 },
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
      expect(ply.length).toBeGreaterThan(8);
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
    const deck = get(parts, 'deck-cabin');
    deck.edges = ['captured', 'exposed', 'captured', 'captured'];
    const bad = parts.filter((x) => flat(x.edges).includes('exposed')).map((x) => x.id);
    expect(bad).toEqual(['deck-cabin']);
  });
  it('captured vs edged is what the joinery says: captured edges have a groove, rabbet or dado joint on the neighbor', () => {
    const parts = buildModel(defaults);
    const web = get(parts, 'side-cabin-L-web');
    expect(web.edges).toEqual(['captured', 'edged', 'captured', 'captured']);
    expect(web.joints!.filter((j) => j.type === 'dado').map((j) => j.to).sort()).toEqual(['side-cabin-L-chine', 'side-cabin-L-gunwale', 'transom-rear']);
    const deck = get(parts, 'deck-cabin');
    expect(deck.joints!.filter((j) => j.type === 'rabbet').map((j) => j.to).sort()).toEqual(['side-cabin-L-chine', 'side-cabin-R-chine']);
    expect(deck.joints!.some((j) => j.type === 'dado' && j.to === 'transom-rear')).toBe(true);
  });
});

describe('captured-ply sides, decks and transoms (D-22, D-35)', () => {
  const parts = buildModel(defaults);
  const ctx = makeCtx(defaults);
  const { L } = ctx;
  const dd = defaults.deckCaptureDepthIn, g = defaults.grooveDepthIn;
  it('the web is an extrusion that enters the chine and gunwale grooves by the groove depth', () => {
    for (const id of ['side-cabin-L', 'side-cabin-R', 'side-nose-L', 'side-nose-R']) {
      const web = get(parts, `${id}-web`), chine = get(parts, `${id}-chine`), gun = get(parts, `${id}-gunwale`);
      expect(web.geometry.type).toBe('extrusion');
      const w = worldAABB(web), c = worldAABB(chine), q = worldAABB(gun);
      expect(c.max[2] - w.min[2]).toBeCloseTo(g, 6);
      expect(w.max[2] - q.min[2]).toBeCloseTo(g, 6);
      expect(web.geometry.type === 'extrusion' && web.geometry.depth).toBeCloseTo(defaults.panelPlyIn, 9);
    }
  });
  it('the groove leaves sturdy oak walls (≥ 0.1") and a ply that fits the groove', () => {
    expect((defaults.sideThicknessIn - defaults.panelPlyIn - defaults.grooveSlopIn) / 2).toBeGreaterThanOrEqual(0.1);
    expect(validateParams(defaults)).toEqual([]);
    const thin = validateParams({ ...defaults, sideThicknessIn: 0.375 });
    expect(thin.some((i) => i.severity === 'warn' && i.keys.includes('grooveSlopIn'))).toBe(true);
  });
  it('the web ends enter the transom dados (cabin) or the front transom dado (nose)', () => {
    const rear = worldAABB(get(parts, 'side-cabin-L-web'));
    expect(rear.min[0]).toBeCloseTo(L.xRear + L.side - dd, 6);
    expect(worldAABB(get(parts, 'side-nose-L-web')).max[0]).toBeCloseTo(L.xFront - L.side + dd, 6);
  });
  it('the decks are plan extrusions that enter the chine rabbets and transom dados', () => {
    const dc = get(parts, 'deck-cabin'), dn = get(parts, 'deck-nose');
    expect(dc.geometry.type).toBe('extrusion');
    const a = worldAABB(dc), b = worldAABB(dn);
    expect(a.max[1]).toBeCloseTo(L.hwC + dd, 6);
    expect(a.min[0]).toBeCloseTo(L.xRear + L.side - dd, 6);
    expect(b.max[1]).toBeCloseTo(L.hwN + dd, 6);
    expect(b.max[0]).toBeCloseTo(L.xFront - L.side + dd, 6);
    expect(a.max[2] - a.min[2]).toBeCloseTo(L.ply, 6);
  });
  it('the transoms span the full outside width and wrap the side ends', () => {
    const r = worldAABB(get(parts, 'transom-rear')), f = worldAABB(get(parts, 'transom-front'));
    expect(r.max[1]).toBeCloseTo(L.hwC + L.side, 6);
    expect(r.min[1]).toBeCloseTo(-(L.hwC + L.side), 6);
    expect(f.max[1]).toBeCloseTo(L.hwN + L.side, 6);
    expect(r.max[0] - r.min[0]).toBeCloseTo(L.side, 6);
    const side = worldAABB(get(parts, 'side-cabin-L-chine'));
    expect(side.min[0]).toBeCloseTo(L.xRear + L.side, 6);
  });
  it('the nose deck outline carries the kingpin-access opening from Layout.accessPanel, with its rim banded', () => {
    const plain = get(parts, 'deck-nose');
    const ap = L.accessPanel;
    expect(ap).not.toBeNull();
    if (plain.geometry.type !== 'extrusion' || !ap) return;
    expect(plain.geometry.holes).toHaveLength(1);
    const h = plain.geometry.holes![0];
    expect(Math.max(...h.map((q) => q[0])) - Math.min(...h.map((q) => q[0]))).toBeCloseTo(ap.x1 - ap.x0, 9);
    expect(Math.max(...h.map((q) => q[1]))).toBeCloseTo(ap.hw, 9);
    expect(plain.edges).toHaveLength(plain.geometry.outline.length + h.length);
    expect(flat(plain.edges).includes('exposed')).toBe(false);
    // Without the crossbar there is no opening and the deck is whole.
    const bare = buildModel({ ...defaults, kingpinThroughBolster: 0 }).find((x) => x.id === 'deck-nose')!;
    expect(bare.geometry.type === 'extrusion' && bare.geometry.holes).toBeUndefined();
    expect(bare.massLb).toBeGreaterThan(plain.massLb);
    // The opening grows with the panel the other workstream sets.
    const c = makeCtx(defaults);
    (c.L as { accessPanel: typeof ap }).accessPanel = { ...ap, x1: ap.x1 + 1 };
    const wide = buildBody(c).find((x) => x.id === 'deck-nose')!;
    expect(wide.massLb).toBeLessThan(plain.massLb);
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
    const rail = get(parts, 'rail-cabin-L');
    const tenon = rail.joints!.find((j) => j.to === 'transom-rear')!;
    expect(tenon.type).toBe('mortise-tenon');
    expect(tenon.at![0][0]).toBeCloseTo(-35.875 / 2, 3); // −x end of the 35.875" rail
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
  it('prow, signs and the finger guards come off with inserts and knobs (D-9)', () => {
    const prow = get(parts, 'prow');
    expect(prow.joints!.find((j) => j.type === 'threaded-insert')!.count).toBe(2);
    expect(get(parts, 'transom-front').joints!.find((j) => j.type === 'knob' && j.to === 'prow')!.count).toBe(2);
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
      expect(t.geometry.holes).toHaveLength(1);
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
    expect(liftSlot(ctx, 'front').zBot).toBeGreaterThanOrEqual(ctx.L.noseTop + 1);
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
    // M = P L / 4 = 174 × 4.5 / 4 = 195.75; S = t h² / 6 = 0.5 × 0.75² / 6 → σ = 4176 psi
    const s = liftBarStressPsi({ zBot: 0, zTop: 1, transomTop: 2, barIn: 0.75, thickIn: 0.5, lengthIn: 4.5 }, 174);
    expect(s).toBeCloseTo(4176, 0);
  });
  it('a storage box against the rear transom raises the slot; the transom crests rather than thinning the bar', () => {
    const r = liftSlot(ctx, 'rear');
    expect(r.zTop + defaults.liftBarMinIn).toBeLessThanOrEqual(r.transomTop + 1e-9);
    expect(r.transomTop).toBeGreaterThanOrEqual(ctx.L.deckTop + ctx.L.sideH);
    const f = liftSlot(ctx, 'front');
    expect(f.transomTop).toBeCloseTo(ctx.L.noseTop + ctx.L.sideH, 9); // the lantern / flag clips straddle this top (D-41)
  });
});

describe('finger guard (M5, D-37)', () => {
  const NO_PINCH = defaults.fingerGapMinIn;
  /** Independent check: smallest plan distance between the left tire and the nose side face over the sweep (sampled). */
  function sideGap(p: Params): number {
    const c = makeCtx(p);
    const yo = c.L.hwN + c.L.side;
    let g = Infinity;
    for (let d = -p.steerLockDeg; d <= p.steerLockDeg; d += 0.5) {
      for (const q of frontTirePlan(c, 1, d)) if (q[0] >= c.L.xs) g = Math.min(g, q[1] - yo);
    }
    return g;
  }
  it('at the defaults the bare gap is a pinch gap, so guards are built', () => {
    const a = fingerAnalysis(makeCtx(defaults));
    expect(a.minGapIn).toBeLessThan(NO_PINCH);
    expect(a.minGapIn).toBeCloseTo(0.76, 1); // the Phase 2 value (M5)
    expect(a.guardNeeded).toBe(true);
    expect(a.hazard).not.toBeNull();
    expect(sideGap(defaults)).toBeGreaterThan(0.7);
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
      expect(guard.joints!.some((j) => j.type === 'screw' && j.count === 2)).toBe(true);
    }
  });
  it('opening the gap is the other route: a wide-enough threshold-free gap builds no guard', () => {
    const p = { ...defaults, fingerGapMinIn: 0.5 };
    expect(buildModel(p).some((x) => x.id.startsWith('guard-'))).toBe(false);
  });
});

describe('bent-lam prow and its form (D-36)', () => {
  const ctx = makeCtx(defaults);
  const parts = buildModel(defaults);
  const prow = get(parts, 'prow');
  it('is a sweep: six 1/8" plies, 3/4" thick, bent-lam fab, removable', () => {
    expect(prow.geometry.type).toBe('sweep');
    if (prow.geometry.type !== 'sweep') return;
    expect(prow.geometry.plies).toBe(defaults.prowPlies);
    expect(prow.geometry.thickness).toBeCloseTo(defaults.prowPlies * defaults.prowLamThicknessIn, 9);
    expect(prow.geometry.thickness).toBeCloseTo(0.75, 9);
    expect(prow.geometry.width).toBe(defaults.prowWidthIn);
    expect(prow.geometry.path[0]).toEqual([0, 0]);
    expect(prow.kind).toBe('bentlam');
    expect(prow.fab).toBe('bentlam');
    expect(prow.removable).toBe(true);
    expect(buildModel(defaults, { removed: true }).some((x) => x.id === 'prow')).toBe(false);
  });
  it('the leg is straight and vertical against the transom, the centerline climbs and leans forward, tip reach and height as set', () => {
    const s = prowShape(ctx);
    const leg = s.path.filter((q) => q[1] <= s.legLenIn + 1e-9);
    expect(leg.every((q) => Math.abs(q[0]) < 1e-9)).toBe(true);
    for (let i = 1; i < s.path.length; i++) {
      expect(s.path[i][1]).toBeGreaterThanOrEqual(s.path[i - 1][1] - 1e-9);
      expect(s.path[i][0]).toBeGreaterThanOrEqual(s.path[i - 1][0] - 1e-9);
    }
    const end = s.path[s.path.length - 1];
    expect(end[0] + s.thicknessIn / 2).toBeCloseTo(defaults.prowReachIn, 6);
    expect(s.origin[2] + end[1]).toBeCloseTo(ctx.L.noseTop + ctx.L.sideH + defaults.prowHeightIn, 6);
    // The leg sits on the front face of the front transom, above the lift slot.
    expect(s.origin[0] - s.thicknessIn / 2).toBeCloseTo(ctx.L.xFront, 9);
    expect(s.origin[2]).toBeGreaterThan(liftSlot(ctx, 'front').zTop);
  });
  it('no bend is tighter than the laminating limit (40× the strip thickness = 5")', () => {
    const s = prowShape(ctx);
    expect(s.limitRadiusIn).toBeCloseTo(5, 9);
    expect(s.minRadiusIn).toBeGreaterThanOrEqual(s.limitRadiusIn);
  });
  it('is lighter than the old block stem and its mass follows the sweep volume', () => {
    expect(prow.massLb).toBeLessThan(1.0); // the Phase 1 extruded stem was 1.0 lb
    const s = prowShape(ctx);
    const vol = s.widthIn * s.thicknessIn * s.lengthIn;
    expect(prow.massLb).toBeGreaterThan((vol / 1728) * defaults.oakDensityPcf);
    expect(prow.massLb).toBeLessThan((vol / 1728) * defaults.oakDensityPcf * 1.5);
  });
  it('the form is a CNC reference part that adds no mass, with a closed CCW outline and spring-back overbend', () => {
    const form = get(parts, 'prow-form');
    expect(form.kind).toBe('reference');
    expect(form.fab).toBe('cnc');
    expect(form.payload).toBe(true);
    expect(form.group).toBe('reference');
    expect(form.massLb).toBe(0);
    expect(totalMass(parts) - totalMass(parts.filter((x) => x.id !== 'prow-form'))).toBe(0);
    expect(form.geometry.type).toBe('extrusion');
    expect(form.notes).toMatch(/[Ss]pring-back/);
    const fp = prowFormProfile(ctx);
    let a = 0;
    for (let i = 0; i < fp.outline.length; i++) {
      const [x1, y1] = fp.outline[i], [x2, y2] = fp.outline[(i + 1) % fp.outline.length];
      a += x1 * y2 - x2 * y1;
    }
    expect(a).toBeGreaterThan(0); // CCW, ready for extrusion
    expect(fp.overbendDeg).toBeGreaterThan(0);
    const zero = prowFormProfile(makeCtx({ ...defaults, prowSpringbackFrac: 0 }));
    expect(zero.overbendDeg).toBeCloseTo(0, 9);
    // Overbent form leans further forward at the tip than the zero-allowance one.
    const tip = (o: Vec2[]) => Math.max(...o.map((q) => q[0]));
    expect(tip(fp.outline)).toBeGreaterThan(tip(zero.outline));
    // Springback is compensated by tighter bends: the form's tightest radius is below the target's.
    expect(fp.formMinRadiusIn).toBeLessThan(prowShape(ctx).minRadiusIn);
  });
  it('the form does not count as part of the cart: not in the overlap set, mass, or the lantern mount position', () => {
    const tip = prowShape(ctx).tipTop;
    const lantern = parts.find((x) => x.id === 'lantern-mount');
    expect(tip.z).toBeGreaterThan(ctx.L.noseTop + ctx.L.sideH + 10);
    expect(lantern).toBeDefined();
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
  it('the hull and frame groups stay within a pound of the Phase 2 block model (body 29.7, frame 10.5, removable 4.7 lb)', () => {
    const parts = buildModel(defaults);
    const sum = (g: string) => parts.filter((x) => x.group === g && !x.payload).reduce((m, x) => m + x.massLb, 0);
    expect(Math.abs(sum('body') - 29.7)).toBeLessThan(1.5);
    expect(Math.abs(sum('frame') - 10.5)).toBeLessThan(0.5);
    expect(Math.abs(sum('removable') - 4.7)).toBeLessThan(0.6);
  });
});
