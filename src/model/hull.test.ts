/** Phase 3 workstream B: hull shapes, captured ply, joinery, lift hand-holds, finger guard, signs (D-35…D-37, D-45: the prow is gone). */
import { describe, expect, it } from 'vitest';
import { defaultParams, derived, validateParams, type Params } from '../params';
import { buildModel } from './index';
import { buildBody, fingerAnalysis, frontTirePlan, guardInsertZ, liftBarStressPsi, liftSlot, scupperSites } from './body';
import { chooseDomino, DOMINOS, endJoint, frac, joinerySummary } from './joinery';
import { HULL_STEP, box, makeCtx } from './build-utils';
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
    const deck = get(parts, 'deck-cabin');
    deck.edges = ['captured', 'exposed', 'captured', 'captured'];
    const bad = parts.filter((x) => flat(x.edges).includes('exposed')).map((x) => x.id);
    expect(bad).toEqual(['deck-cabin']);
  });
  it('captured vs edged is what the joinery says: captured edges have a groove, rabbet or dado joint on the neighbor', () => {
    const parts = buildModel(defaults);
    const web = get(parts, 'side-cabin-L-web');
    expect(web.edges).toBe('captured'); // the curved panel: both ends captured (transom dado, scarf to the nose panel)
    expect(web.joints!.filter((j) => j.type === 'dado').map((j) => j.to).sort()).toEqual(['side-cabin-L-chine', 'side-cabin-L-gunwale', 'transom-rear']);
    expect(web.joints!.filter((j) => j.type === 'scarf').map((j) => j.to)).toEqual(['side-nose-L-web']);
    const deck = get(parts, 'deck-cabin');
    // D-45: the cabin deck sits on a ledge in the rail (the chine bottom is at the nose deck level); the nose deck is in the chine rabbets.
    expect(deck.joints!.filter((j) => j.type === 'rabbet').map((j) => j.to).sort()).toEqual(['rail-cabin-L', 'rail-cabin-R']);
    expect(get(parts, 'deck-nose').joints!.filter((j) => j.type === 'rabbet').map((j) => j.to).sort()).toEqual(['side-cabin-L-chine', 'side-cabin-R-chine', 'side-nose-L-chine', 'side-nose-R-chine']);
    expect(deck.joints!.some((j) => j.type === 'dado' && j.to === 'transom-rear')).toBe(true);
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
    expect(validateParams(defaults)).toEqual([]);
    const thin = validateParams({ ...defaults, sideThicknessIn: 0.375 });
    expect(thin.some((i) => i.severity === 'warn' && i.keys.includes('grooveSlopIn'))).toBe(true);
  });
  it('the web ends enter the transom dados (cabin) or the front transom dado (nose)', () => {
    const rw = get(parts, 'side-cabin-L-web').geometry;
    expect(rw.type === 'sweep' && rw.path[0][0]).toBeCloseTo(L.xRear + L.transom - dd, 6);
    expect(worldAABB(get(parts, 'side-nose-L-web')).max[0]).toBeCloseTo(L.xFront - L.transom + dd, 6);
  });
  it('the decks are plan extrusions that enter the chine rabbets and transom dados', () => {
    const dc = get(parts, 'deck-cabin'), dn = get(parts, 'deck-nose');
    expect(dc.geometry.type).toBe('extrusion');
    const a = worldAABB(dc), b = worldAABB(dn);
    expect(a.max[1]).toBeCloseTo(L.hwC + L.side - defaults.railThicknessIn + dd, 6); // the cabin deck sits on a ledge in the rail's inner face (D-45)
    expect(a.min[0]).toBeCloseTo(L.xRear + L.transom - dd, 6);
    const nf = (dn.geometry as { outline: Vec2[] }).outline.filter((q) => q[0] > L.xFront - 2);
    expect(Math.max(...nf.map((q) => q[1]))).toBeCloseTo(L.hwN + dd, 6);
    expect(b.max[0]).toBeCloseTo(L.xFront - L.transom + dd, 6);
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
  it('the hull and frame groups stay near the Phase 3 round-2 numbers (body 35.1 after the ¾" transoms, ⅝" chines, backers, prow socket and scuppers, D-43; frame 10.1 with 10" joists; removable 4.7 lb)', () => {
    const parts = buildModel(defaults);
    const sum = (g: string) => parts.filter((x) => x.group === g && !x.payload).reduce((m, x) => m + x.massLb, 0);
    // D-44 visual pass: sheer (front transom +0.9 lb, nose webs +0.2), crowned rear transom +0.25 → body ≈ 36.5 (was 35.2).
    // D-45: the prow, its socket and the shoulder panels are gone (−3.2 lb body, −0.9 lb removable); the 4" rails and the shoulder beam add to the frame.
    expect(Math.abs(sum('body') - 33.3)).toBeLessThan(1);
    expect(Math.abs(sum('frame') - 13.5)).toBeLessThan(0.7);
    expect(Math.abs(sum('removable') - 3.8)).toBeLessThan(0.6);
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
    expect(c.stock!.l).toBeCloseTo(L.xFront - L.transom - L.xn, 6); // the straight nose chine (the cabin chine is a bent lamination along the S-curve)
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
    expect(L.railTop).toBeCloseTo(L.noseBot, 9);
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

  it('scuppers: six 3/8" stainless nipples through the chines at deck level (M7), each with a joint and `at`', () => {
    const sc = parts.filter((x) => x.id.startsWith('scupper-'));
    expect(sc).toHaveLength(6);
    expect(scupperSites(ctx)).toHaveLength(3);
    for (const x of sc) {
      expect(x.joints![0].at).toHaveLength(1);
      expect(x.sourcing?.vendor).toMatch(/stainless/i);
      const bb = worldAABB(x);
      // lower edge of the hole 0.05" over the deck surface: z = deck + 0.05 + 3/16 − 3/16
      const deckZ = /nose/.test(x.id) ? L.noseTop : L.deckTop;
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

  it('assembly order is data (M4, D-45): deck 4 < sides 4.2 < shoulder beam 4.3 < transoms 4.4, and every closed dado is vented', () => {
    const st = (id: string) => get(parts, id).step;
    expect(st('deck-cabin')).toBe(HULL_STEP.deck);
    expect(st('side-cabin-L-web')).toBe(HULL_STEP.sides);
    expect(st('side-cabin-L-chine')).toBe(HULL_STEP.sides);
    expect(st('transom-rear')).toBe(HULL_STEP.transom);
    expect(st('transom-front')).toBe(HULL_STEP.transom);
    expect(HULL_STEP.deck < HULL_STEP.sides && HULL_STEP.sides < HULL_STEP.shoulder && HULL_STEP.shoulder < HULL_STEP.transom).toBe(true);
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

  it('10" joists: the cabin deck has 4 crossmembers (was 5 at 8"), largest bay 9.44"', () => {
    expect(L.cabinJoistX).toHaveLength(4);
    expect(p.crossmemberSpacingIn).toBe(10);
  });
});
