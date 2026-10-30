/**
 * The body (D-54, D-57): a 24 in sled hull with the sheer and the bow turn-in. Captured ply, joinery records, the rear lift hand-hold, scuppers, the bow bulkhead, the sheer and the
 * signs. The old tapering curved hull, finger guards, front transom, sheer and bow curl are gone; the lift check and foot-stop numbers belong to src/analysis/hull.test.ts.
 * Expected numbers are re-derived by hand from the params (deck 8, ply 0.472, side 0.625, rear 14 in, bow 4 in, rear face at x = -9.25).
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, derived, STORAGE_LOCATION, thinSheet, validateParams, type Params } from '../params';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { liftBarStressPsi, liftSlot, scupperSites, sheerBlank, sideBandLengths, transomBackerBlocks, TRANSOM_BACKER_BAND_CLEAR_IN } from './body';
import { handleGeometry, socketScrewZ } from './handle';
import { chooseDomino, DOMINOS, endJoint, frac, joinerySummary } from './joinery';
import { SIGN_PROUD_IN, HULL_STEP, box, makeCtx } from './build-utils';
import { localBounds, transformPoint, worldAABB } from './bounds';
import { totalMass } from './mass';
import { joistId } from './frame';
import type { EdgeCondition, Part, Vec2 } from './types';

const defaults = defaultParams();
const errorsOf = (p: Params) => validateParams(p).filter((i) => i.severity === 'error');
const get = (parts: Part[], id: string) => {
  const x = parts.find((q) => q.id === id);
  if (!x) throw new Error(`no part ${id}`);
  return x;
};

/** Variants of the body: deck ply, storage location, side profile, width, bow curl, lift slot. Rejected ones (validator errors) are skipped. */
const PATCHES: Record<string, Partial<Params>> = {
  defaults: {},
  deck9mm: { deckPlyIn: 0.354, thinSheetMaterial: 2, panelPlyIn: 0.354 }, // D-73: the okoume option, so panelPlyIn is the thin sheet
  storageForward: { storageLocation: 1 },
  storageUnderSeat: { storageLocation: 2 },
  sheer0: { sheerCurveIn: 0 },
  sheer4: { sheerCurveIn: 4 },
  bowSide5: { sideHeightBowIn: 5 },
  rearSide12: { sideHeightRearIn: 12 },
  wide26: { bodyWidthIn: 26 },
  narrow23: { bodyWidthIn: 23 },
  bulkhead3: { bowBulkheadThickIn: 3, frontOverhangIn: 8 },
  turn0: { bowWidthIn: 24 },
  turn25: { bowWidthIn: 19, bowTaperStartIn: 14 },
  bigLiftSlot: { liftSlotLengthIn: 5, liftSlotHeightIn: 1.5 },
  signsOff: { showSideSigns: 0 },
  wideTire: { tireWidthIn: 4.5 },
};
const VARIANTS = Object.entries(PATCHES)
  .map(([name, patch]) => ({ name, p: { ...defaults, ...patch } as Params }))
  .filter((v) => !errorsOf(v.p).length);

const flat = (e: Part['edges']): EdgeCondition[] => (e === undefined ? [] : Array.isArray(e) ? e : [e]);
/** The straight sled line by hand (D-54): height above the deck of the gunwale top at x, from the rear transom's inner face to the end of the sides. */
const sledLine = (p: Params, x: number, xFrom: number, xTo: number) => {
  const u = Math.max(0, Math.min(1, (x - xFrom) / (xTo - xFrom)));
  return p.sideHeightRearIn + (p.sideHeightBowIn - p.sideHeightRearIn) * u - 4 * p.sheerCurveIn * u * (1 - u);
};

describe('what D-54 removed', () => {
  it('has no front transom, finger guards, sheer, nose members, cabin/nose split or steering parts; the part ids are the plain ones', () => {
    const ids = buildModel(defaults).map((x) => x.id);
    for (const gone of [/^transom-front$/, /^guard-/, /nose/, /cabin/, /^stringer/, /^beam-front$/, /^tongue/, /^tie-rod$/, /^bow-curl$/, /^foot-stop/, /^flag-(mount|socket)$/])
      expect(ids.filter((i) => gone.test(i)), String(gone)).toEqual([]);
    for (const id of ['deck', 'bow-bulkhead', 'side-L-chine', 'side-L-gunwale', 'side-L-web', 'side-R-chine', 'side-R-gunwale', 'side-R-web', 'rail-L', 'rail-R', 'axle-hanger-L', 'axle-hanger-R', 'joist-1', 'transom-rear'])
      expect(ids, id).toContain(id);
  });
});

describe('no exposed plywood edges (acceptance, D-35)', () => {
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
    const parts = buildModel(defaults).map((x) => (x.id === 'deck' ? { ...x, edges: ['captured', 'exposed', 'captured', 'captured'] as Part['edges'] } : x)); // a copy: built models are shared through the build cache
    const bad = parts.filter((x) => flat(x.edges).includes('exposed')).map((x) => x.id);
    expect(bad).toEqual(['deck']);
  });
  it('captured vs edged is what the joinery says: captured edges have a groove, rabbet or dado on the neighbor; the bulkhead takes the deck edge and the web end in dados', () => {
    const parts = buildModel(defaults);
    const web = get(parts, 'side-L-web');
    expect(web.edges).toBe('captured'); // the full-height panel: the rear end in the transom dado, the front end in the bulkhead's dado, top and bottom covered by the oak bands glued on both faces (D-62)
    expect(web.joints!.filter((j) => j.type === 'dado').map((j) => j.to).sort()).toEqual(['bow-bulkhead', 'transom-rear']);
    expect(web.joints!.filter((j) => j.type === 'glue' && /^side-[LR]-/.test(j.to)).map((j) => j.to).sort()).toEqual(['side-L-chine', 'side-L-chine-in', 'side-L-gunwale', 'side-L-gunwale-cap', 'side-L-gunwale-in']); // (2026-10-24: gunwale cap strip) the cap bedded on its top edge
    expect(web.joints!.filter((j) => j.type === 'glue' && /^side-rib-/.test(j.to)).map((j) => j.to).sort()).toEqual(['side-rib-L1', 'side-rib-L2', 'side-rib-L3', 'side-rib-L4']); // D-76, D-85: the ribs glued to its inside face
    const deck = get(parts, 'deck');
    // D-52/D-57: one deck, in the chine rabbets all the way along, in a dado in the rear transom and in a dado in the bow bulkhead.
    expect(deck.joints!.filter((j) => j.type === 'rabbet').map((j) => j.to).sort()).toEqual(['side-L-chine-in', 'side-R-chine-in']); // the gap under the inner chine band
    expect(deck.joints!.some((j) => j.type === 'dado' && j.to === 'transom-rear')).toBe(true);
    expect(deck.joints!.some((j) => j.type === 'dado' && j.to === 'bow-bulkhead')).toBe(true);
    expect(deck.joints!.some((j) => j.type === 'scarf')).toBe(false);
    // The deck is carried by the rails and every joist (glue); the king beam (D-56) replaces the sixth joist and the end joist keeps its index (joist-8, 3c-5: 8.5 in spacing).
    expect(deck.joints!.filter((j) => j.type === 'glue').map((j) => j.to).sort()).toEqual(['joist-1', 'joist-2', 'joist-3', 'joist-4', 'joist-5', 'joist-6', 'joist-8', 'king-beam', 'rail-L', 'rail-R']);
    // The bulkhead is oak: no ply edge to show; its rail, chine and gunwale ends are Domino or loose-tenon joints.
    expect(get(parts, 'bow-bulkhead').material).toBe('white oak');
    expect(get(parts, 'bow-bulkhead').joints!.filter((j) => /^(rail|side)-/.test(j.to) && j.type !== 'dado').length).toBeGreaterThanOrEqual(6); // D-62: the rail ends are tenons, the four band ends a side butt with an epoxy fillet (0.234 in strips take no Domino)
  });
});

describe('captured-ply sides, deck and rear transom (D-22, D-35, D-54)', () => {
  const parts = buildModel(defaults);
  const ctx = makeCtx(defaults);
  const { L } = ctx;
  const dd = defaults.deckCaptureDepthIn;
  const rearTx = -10 + 0.5; // the rear transom's inner face: x = -rearOverhang + 1/2 (D-60; was 3/4)
  it('the layout agrees with the hand numbers (24 in body, 22.75 in inside, deck 8, ply 0.512, rear face -9.5, side bar 1.5 in)', () => {
    expect(L.xSideStart).toBeCloseTo(rearTx, 9);
    expect(L.hwC).toBeCloseTo(24 / 2 - 0.625, 9);
    expect(L.deckBot).toBeCloseTo(8 - 0.512, 9); // (2026-10-24: 13 mm deck, 5 mm combi-core white oak sides as bought)
    expect(L.chineBot).toBeCloseTo(L.deckBot, 9); // one deck level: the chine bottom is the deck underside
    expect(L.web.z0).toBeCloseTo(8 - 0.512 + 1.5, 9); // the chine top
    expect(L.sideTop).toBeCloseTo(8 + 14, 9);
    expect(L.sideH).toBe(4);
  });
  it('the web (a plan-bent sheet, FULL height, D-62) runs from the chine bottom to sideWebCapIn under the gunwale top, all along the sheer, with the oak bands on both faces', () => {
    const cap = defaults.sideWebCapIn;
    for (const tag of ['L', 'R']) {
      const web = get(parts, `side-${tag}-web`), chine = get(parts, `side-${tag}-chine`), gun = get(parts, `side-${tag}-gunwale`);
      expect(web.geometry.type).toBe('mesh');
      const w = worldAABB(web), c = worldAABB(chine);
      expect(w.min[2]).toBeCloseTo(L.chineBot, 6); // bottom: flush with the outer chine band, on the rail
      expect(c.min[2]).toBeCloseTo(w.min[2], 6);
      const wpos = (web.geometry as { positions: number[] }).positions;
      for (let i = 0; i < wpos.length; i += 3) {
        const x = wpos[i];
        if (x < L.xSideStart || x > L.xSideEnd) continue;
        if (wpos[i + 2] < 10) continue; // bottom edge
        const top = L.deckTop + sledLine(defaults, x, L.xSideStart, L.xSideEnd);
        if (wpos[i + 2] < top - cap - 0.5) continue;
        expect(top - wpos[i + 2], `${tag} x ${x.toFixed(1)}`).toBeCloseTo(cap, 5);
      }
      // the bands: outer and inner thickness = (side - ply) / 2, either side of the web
      for (const id of [`side-${tag}-chine`, `side-${tag}-chine-in`, `side-${tag}-gunwale`, `side-${tag}-gunwale-in`]) expect(get(parts, id).stock!.t).toBeCloseTo(L.sideBand, 9);
      expect(2 * L.sideBand + thinSheet(defaults).thicknessIn).toBeCloseTo(L.side, 9);
      expect(worldAABB(gun).max[2]).toBeCloseTo(L.deckTop + 14, 6);
    }
  });
  it('the sandwich leaves 0.234 in bands (≥ 0.15 in) and the inner chine band is 0.512 in short of the bottom, which makes the deck rabbet without routing', () => {
    expect(L.sideBand).toBeGreaterThanOrEqual(0.15);
    expect(validateParams(defaults).filter((i) => i.severity !== 'info')).toEqual([]);
    const ci = worldAABB(get(parts, 'side-L-chine-in')), co = worldAABB(get(parts, 'side-L-chine'));
    expect(ci.min[2] - co.min[2]).toBeCloseTo(defaults.deckPlyIn + defaults.deckSlopIn, 6);
    expect(ci.max[2]).toBeCloseTo(co.max[2], 6);
    const thin = validateParams({ ...defaults, sideThicknessIn: 0.375 });
    expect(thin.some((i) => i.severity === 'warn' && i.keys.includes('sideThicknessIn'))).toBe(true);
  });
  it('the web enters the rear transom dado at its rear end and the bow bulkhead dado at its front end', () => {
    for (const tag of ['L', 'R']) {
      const b = worldAABB(get(parts, `side-${tag}-web`));
      expect(b.min[0]).toBeCloseTo(rearTx - dd, 6);
      expect(b.max[0]).toBeCloseTo(L.xSideEnd + dd, 6); // the front end is in the bulkhead's rear-face dado, as the rear end is in the transom's (Phase 4 round 2)
    }
  });
  it('the deck is ONE flat sheet that enters the chine rabbets, the transom dado and the bulkhead dado, and follows the bow turn-in', () => {
    const d = get(parts, 'deck');
    expect(d.geometry.type).toBe('extrusion');
    const a = worldAABB(d);
    expect(a.max[1]).toBeCloseTo(L.hwC + L.deckEdge, 6); // full width behind the turn-in; the edge rises into the gap under the inner chine band, against the web (D-62)
    expect(a.min[1]).toBeCloseTo(-(L.hwC + L.deckEdge), 6);
    expect(a.min[0]).toBeCloseTo(rearTx - dd, 6);
    expect(a.max[0]).toBeCloseTo(L.xFlatEnd + dd, 6);
    expect(a.min[2]).toBeCloseTo(L.deckBot, 6);
    expect(a.max[2]).toBeCloseTo(8, 6);
    // 58.6 in long × 23.25 wide: fits one 4 x 8 sheet (96 x 48) with the width across the 48.
    expect(a.max[0] - a.min[0]).toBeLessThan(96);
    expect(a.max[1] - a.min[1]).toBeLessThan(48);
    if (d.geometry.type !== 'extrusion') return;
    expect(d.geometry.holes ?? []).toHaveLength(0);
    const front = d.geometry.outline.filter((q) => q[0] > L.xFlatEnd - 1e-9);
    expect(Math.max(...front.map((q) => Math.abs(q[1])))).toBeCloseTo(L.hwC + L.deckEdge - L.taper.turnIn, 6); // narrower at the bulkhead (D-66: 18.5 in outside)
    expect(d.edges).toBe('captured');
  });
  it('the rear transom spans the full outside width, is as tall as the rear side plus a crown, and wraps the side ends', () => {
    const r = worldAABB(get(parts, 'transom-rear'));
    expect(r.max[1]).toBeCloseTo(L.hwC + L.side, 6);
    expect(r.min[1]).toBeCloseTo(-(L.hwC + L.side), 6);
    expect(r.max[1] - r.min[1]).toBeCloseTo(defaults.bodyWidthIn, 6);
    expect(r.max[0] - r.min[0]).toBeCloseTo(L.transom, 6);
    expect(r.min[0]).toBeCloseTo(-10, 6);
    expect(L.transom).toBe(0.5); // D-43: the transom was ¾", D-60: ½"; the chine and gunwale ⅝"
    expect(L.side).toBe(0.625);
    // The corners are at the rear gunwale height (deck + 14 in); the crown arcs above them at the center (D-44).
    expect(r.max[2]).toBeCloseTo(8 + defaults.sideHeightRearIn + defaults.transomCrownIn, 6);
    expect(r.min[2]).toBeCloseTo(8 - defaults.crossmemberDepthIn, 6); // it hangs as far below the deck as the joists
    const side = worldAABB(get(parts, 'side-L-chine'));
    expect(side.min[0]).toBeCloseTo(rearTx, 6); // the sides butt the transom's inner face
  });
});

describe('the plan-curved sheer sides (D-54, D-57)', () => {
  const parts = buildModel(defaults);
  const { L } = makeCtx(defaults);
  const xs = L.xSideStart, xe = L.xSideEnd;
  it('behind the turn-in the sides are parallel: a constant 24 in outside, 22.75 in inside, the same section all the way back; the bounds span the rear transom to the bulkhead', () => {
    for (const tag of ['L', 'R'] as const) {
      const s = tag === 'L' ? 1 : -1;
      for (const m of ['chine', 'gunwale'] as const) {
        const b = worldAABB(get(parts, `side-${tag}-${m}`));
        expect(s * (s > 0 ? b.max[1] : b.min[1]), `${tag} ${m} outer face`).toBeCloseTo(12, 6);
        expect(b.min[0]).toBeCloseTo(xs, 6);
        expect(b.max[0]).toBeCloseTo(xe, 6);
        expect(get(parts, `side-${tag}-${m}`).geometry.type).toBe('mesh'); // plan-curved walls (D-57)
      }
      // D-93: the chine strip is cut as long as the plan S it is bent to (like the rail), a little over the x extent
      expect(get(parts, `side-${tag}-chine`).stock!.l).toBeCloseTo(sideBandLengths(L, defaults).chineIn, 6);
      expect(get(parts, `side-${tag}-chine`).stock!.l).toBeGreaterThan(xe - xs + 0.2);
    }
    expect(2 * (L.hwC + L.side)).toBeCloseTo(24, 9);
    expect(2 * L.hwC).toBeCloseTo(22.75, 9);
    expect(xe - xs).toBeCloseTo(58.75, 6); // from the 1/2 in transom's inner face (-9.5) to the bulkhead face (49.25), D-60
  });
  it('the gunwale and chine bands are strips bent cold on the web (D-62): the notes say so and give the bend radius and the real sheer slope; the cut list shows strips', () => {
    const gun = get(parts, 'side-L-gunwale'), chine = get(parts, 'side-L-chine');
    expect(gun.fab).toBe('bentlam');
    expect(gun.notes).toMatch(/OUTER gunwale band/);
    expect(gun.notes).toMatch(/18\.[89]° at the rear transom/); // build review M1: the slope at the transom, not the mid-length figure
    expect(gun.notes).toMatch(/tightest radius/);
    expect(gun.notes).toMatch(/SAWN to the sheer/); // D-105: not bent on edge, sawn from a flat blank with the sheer template
    expect(gun.notes).toMatch(/bent only across its thickness/);
    expect(gun.stock!.t).toBeCloseTo(L.sideBand, 9); // the finished band
    expect(gun.stock!.w).toBeCloseTo(defaults.railBandIn, 9);
    expect(gun.stock!.l).toBeGreaterThan(58); // the 59 in side along its sheer
    expect(gun.blank!.t).toBeCloseTo(L.sideBand, 9); // the blank is the same thickness, wide enough for the sheer's dip, long enough for the ends
    expect(gun.blank!.w).toBeGreaterThan(defaults.railBandIn + defaults.sheerCurveIn);
    expect(gun.blank!.w).toBeLessThan(defaults.bandsawResawCapacityIn - defaults.laminateWidthAllowanceIn); // it must still resaw on the 6 in bandsaw
    expect(chine.fab).toBe('bentlam');
    expect(chine.kind).toBe('bentlam');
    const rMin = L.taper.minRadiusIn; // D-66: the derived taper's tightest bend (31 in)
    expect(rMin).toBeGreaterThan(defaults.hullLamMinRadiusFactor * L.sideBand);
  });
  it('the gunwale is a constant 1.5 in band under the sheer (every vertical pair of vertices on the mesh), top at 14 in at the rear and 4 in at the bulkhead', () => {
    const gun = get(parts, 'side-L-gunwale');
    const pos = (gun.geometry as { positions: number[] }).positions;
    const byX = new Map<string, number[]>();
    for (let i = 0; i < pos.length; i += 3) { const k = pos[i].toFixed(6); (byX.get(k) ?? byX.set(k, []).get(k)!).push(pos[i + 2]); }
    let n = 0;
    for (const zs of byX.values()) { const hi = Math.max(...zs), lo = Math.min(...zs); expect(hi - lo, 'a 1.5 in band').toBeCloseTo(1.5, 6); n++; }
    expect(n).toBeGreaterThan(40);
    const b = worldAABB(gun);
    expect(b.max[2]).toBeCloseTo(8 + 14, 6);
    expect(b.min[2]).toBeCloseTo(8 + 4 - 1.5, 6);
  });
  it('the sheer is the concave curve from 14 in down to 4 in; sheerCurveIn bends the straight line down by 4 * sag * u * (1 - u)', () => {
    for (const sag of [0, 2.5, 4]) {
      const p = { ...defaults, sheerCurveIn: sag } as Params;
      expect(errorsOf(p).filter((i) => !/tongue|brake|steering stops|flap/i.test(i.message))).toEqual([]);
      const gun = get(buildModel(p), 'side-L-gunwale');
      const pos = (gun.geometry as { positions: number[] }).positions;
      for (let i = 0; i < pos.length; i += 3) {
        if (pos[i + 2] < 8 + 4 - 1.5 - 1e-9) continue;
        const x = pos[i];
        const top = 8 + sledLine(p, x, xs, xe);
        // vertices are either on the top edge or the bottom edge (1.5 below)
        const d = Math.min(Math.abs(pos[i + 2] - top), Math.abs(pos[i + 2] - (top - 1.5)));
        expect(d, `sag ${sag} x ${x.toFixed(2)}`).toBeLessThan(1e-6);
      }
    }
  });
});

describe('every wood part has a grain direction and rough stock', () => {
  it.each(VARIANTS.map((v) => [v.name, v.p] as const))('%s', (_n, p) => {
    for (const x of buildModel(p).filter((q) => q.kind === 'lumber' || q.kind === 'sheet' || q.kind === 'bentlam')) {
      expect(x.grain, `${x.id} grain`).toMatch(/^[xyz]$/);
      expect(x.stock, `${x.id} stock`).toBeDefined();
      if (x.kind === 'lumber' || x.kind === 'bentlam') {
        if (x.kind === 'bentlam' && /ply/i.test(x.material)) continue; // the bow curl is laminated from sheets (a ply lamination has no rough lumber)
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
  const mine = (q: Part) => q.group === 'body' || q.group === 'frame' || q.id.startsWith('sign-');
  it('every joint names a real mating part, has finite local locations matching its count, and is reciprocal', () => {
    for (const v of VARIANTS) {
      const ps = buildModel(v.p);
      const idSet = new Set(ps.map((x) => x.id));
      for (const x of ps) for (const j of x.joints ?? []) {
        expect(idSet.has(j.to), `${v.name}: ${x.id} -> ${j.to} names a real part`).toBe(true);
        if (j.at) {
          expect(j.at.length, `${v.name} ${x.id}→${j.to}`).toBe(j.count);
          for (const a of j.at) expect(a.every(Number.isFinite), `${v.name} ${x.id}→${j.to}`).toBe(true);
        }
        const other = ps.find((q) => q.id === j.to)!;
        // Pairs inside the hull and frame (and the signs) are listed on both sides; other builders list their own.
        // FINDING: the axle hanger lists its glue and bolts to the rail (frame.ts) but the rail has no record back; skipped here until frame.ts adds it.
        if (/^axle-hanger-/.test(x.id) && /^rail-/.test(j.to)) continue;
        if (mine(x) && mine(other)) expect(other.joints?.some((k) => k.to === x.id), `${v.name}: ${x.id}→${j.to} reciprocal`).toBe(true);
      }
    }
  });
  it('joint locations are in the part local frame: the rail-end tenon sits at the rail\'s rear end face (the transom\'s inner face), a joist\'s Dominos at its two ends', () => {
    const L0 = makeCtx(defaults).L;
    const rail = get(parts, 'rail-L');
    const tenon = rail.joints!.find((j) => j.to === 'transom-rear')!;
    expect(tenon.type).toBe('mortise-tenon');
    const w = transformPoint(rail.transform, tenon.at![0]);
    expect(w[0]).toBeCloseTo(L0.xRear + L0.transom, 6); // the rail's rear end: x = -9.25
    expect(w[1]).toBeCloseTo(L0.hwC + L0.side - defaults.railThicknessIn / 2, 6); // mid-thickness of the rail
    const joist = get(parts, 'joist-2');
    const d = joist.joints!.filter((j) => j.type === 'domino');
    expect(d.map((j) => j.to).sort()).toEqual(['rail-L', 'rail-R']);
    // At 8.5 in spacing (3c-5) joist-2 stands ahead of the rear wheel brake's oak backers (x = 5.5 against the backer from x = 6.2), so it runs the full width: Dominos at y = +-11.25.
    expect(d.map((j) => Math.round(transformPoint(joist.transform, j.at![0])[1] * 100) / 100).sort((a, b) => a - b)).toEqual([-11.25, 11.25]);
    // At 10 in spacing the joist at x = 8 meets the backers (D-57): cut back 0.75 in each end (D-60: 3/4 in backers, were 1-1/4 in), so its two Dominos are at y = +-10.5.
    const m10 = buildModel({ ...defaults, crossmemberSpacingIn: 10 });
    const j10 = m10.find((q) => q.id === 'joist-2')!;
    expect(j10.joints!.filter((j) => j.type === 'domino').map((j) => Math.round(transformPoint(j10.transform, j.at![0])[1] * 100) / 100).sort((a, b) => a - b)).toEqual([-10.5, 10.5]);
    expect(transformPoint(joist.transform, d[0].at![0])[0]).toBeCloseTo(L0.joistX[1], 6);
  });
  it('a joist at the rear axle is cut back for the hanger and Domino-tied to the hanger instead of the rail', () => {
    const j1 = get(parts, 'joist-1');
    expect(j1.joints!.filter((j) => j.type === 'domino').map((j) => j.to).sort()).toEqual(['axle-hanger-L', 'axle-hanger-R']);
    expect(j1.stock!.l).toBeCloseTo(2 * (11.25 - defaults.axleHangerThickIn), 6); // 21 in: 10.5 in each side
    expect(worldAABB(j1).max[1]).toBeCloseTo(11.25 - defaults.axleHangerThickIn, 6);
    expect(get(parts, 'joist-2').stock!.l).toBeCloseTo(22.5, 6); // the rails' full inner width (3c-5: no brake backer meets it at 8.5 in spacing; at 10 in it is cut to 20 in between them)
  });
  it('Domino size follows the stock (D-81): thin rails get a DF 500 5×30; thick stock gets a DF 500 10×50 and never an XL size; a tenon is at most 0.34 of its stock; 1/2" hosts get a loose tenon', () => {
    expect(chooseDomino(defaults, { stockIn: 0.75, hostIn: 0.75, widthIn: 1.75 })?.name).toBe('5×30');
    expect(chooseDomino(defaults, { stockIn: 0.75, hostIn: 1.5, widthIn: 3 })?.name).toBe('6×40'); // the rail end into the bow bulkhead: 6 mm is 0.31 of the 3/4 in rail (8 mm was 0.42)
    const thick = chooseDomino(defaults, { stockIn: 1.5, hostIn: 1.5, widthIn: 3 });
    expect(thick?.tool).toBe('DF 500');
    expect(thick!.tMm).toBeGreaterThanOrEqual(10);
    expect(chooseDomino(defaults, { stockIn: 3, hostIn: 3, widthIn: 5 })?.tool).toBe('DF 500'); // Eric has no DF 700 XL: the XL sizes stay in the table and are never picked
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
  // built outside the hull/frame joinery from the contact region of the mated parts. A new joint without `at` fails here. Payload parts have no joinery.
  it('every structured joint on a non-payload part has `at` with `count` finite positions near the part', () => {
    for (const v of VARIANTS) {
      const ps = buildModel(v.p, { rider: 'goal', cargo: true, steerDeg: 0 });
      const ids = new Set(ps.map((x) => x.id));
      for (const part of ps.filter((x) => !x.payload)) {
        const b = localBounds(part.geometry);
        const loose = !!(part.geometry as { slabs?: number }).slabs;
        for (const j of part.joints ?? []) {
          const tag = `${v.name}: ${part.id} -> ${j.to} (${j.type})`;
          const looseJ = loose || !!(ps.find((x) => x.id === j.to)?.geometry as { slabs?: number } | undefined)?.slabs; // plan-curved bow walls (D-57) are boxed by their bounds only
          expect(ids.has(j.to), `${tag} mates a part that exists`).toBe(true);
          expect(j.at?.length, `${tag} has ${j.count} locations`).toBe(j.count);
          for (const a of j.at!) {
            expect(a.every(Number.isFinite), tag).toBe(true);
            // Within 1 1/2" of the part's own bounds (tilted webs, sloped members and the plan-curved bow walls of D-57 are boxed loosely by their axis-aligned contact region).
            for (let k = 0; k < 3; k++) if (!looseJ) expect(a[k], `${tag} axis ${k}`).toBeGreaterThanOrEqual(b.min[k] - 1.5);
            for (let k = 0; k < 3; k++) if (!looseJ) expect(a[k], `${tag} axis ${k}`).toBeLessThanOrEqual(b.max[k] + 1.5);
          }
        }
      }
    }
  });
  it('summary counts each physical joint once, by type (default model)', () => {
    const s = joinerySummary(parts.filter(mine));
    expect(s.total).toBeGreaterThan(40);
    for (const k of ['domino', 'mortise-tenon', 'dado', 'rabbet', 'glue', 'bolt']) expect(s.byType[k] ?? 0, k).toBeGreaterThan(0);
    // Doubled lists (both parts) would give at least twice the once-counted total.
    const both = parts.filter(mine)
      .reduce((m, x) => m + (x.joints ?? []).reduce((a, j) => a + j.count, 0), 0);
    expect(both).toBeGreaterThan(s.total);
  });
  it('the signs hang on knobs into threaded inserts in the box rib and the rear rib inside the 4 mm web (D-85; backing strips only in an under-seat design), never into the ply alone (D-62); on by default (D-57); not a removable part (D-65)', () => {
    expect(parts.some((x) => x.id.startsWith('sign-'))).toBe(true);
    const ps = parts;
    const sign = get(ps, 'sign-L');
    expect(sign.removable).toBeFalsy();
    expect(sign.joints!.filter((j) => j.type === 'knob').reduce((m, j) => m + j.count, 0)).toBe(4);
    expect(sign.joints!.every((j) => !/web/.test(j.to))).toBe(true); // no joint to the ply web: the knobs go into the strips
    expect(ps.some((x) => x.id.startsWith('sign-backer'))).toBe(false); // D-85: the ribs take the knobs
    for (const k of [4, 1]) {
      const rib = get(ps, `side-rib-L${k}`);
      expect(rib.material).toBe('white oak');
      expect(rib.joints!.filter((j) => j.type === 'threaded-insert' && j.to === 'sign-L').reduce((m, j) => m + j.count, 0)).toBe(2);
      expect(rib.joints!.some((j) => j.type === 'glue' && /^side-L-web/.test(j.to))).toBe(true);
    }
    // an under-seat design has no rear box, so the sign keeps its two backing strips
    const under = buildModel({ ...defaults, storageLocation: STORAGE_LOCATION.underSeat });
    for (const k of [1, 2]) expect(get(under, `sign-backer-L${k}`).joints!.filter((j) => j.type === 'threaded-insert' && j.to === 'sign-L').reduce((m, j) => m + j.count, 0)).toBe(2);
    // nothing in the model screws into a side web
    for (const x of ps) for (const j of x.joints ?? []) if (/^side-[LR]-web/.test(j.to)) expect(['screw', 'knob', 'threaded-insert', 'bolt'], `${x.id} -> ${j.to}`).not.toContain(j.type);
  });
});

describe('rails: flush under the chines, tied to them (D-43, D-54)', () => {
  const parts = buildModel(defaults);
  const { L } = makeCtx(defaults);
  it('the rail is a straight 3/4 x 3 in oak bar under each chine, its outer face flush with the chine\'s, its top the chine bottom and the deck underside', () => {
    for (const tag of ['L', 'R']) {
      const rail = worldAABB(get(parts, `rail-${tag}`)), chine = worldAABB(get(parts, `side-${tag}-chine`));
      const s = tag === 'L' ? 1 : -1;
      expect(s > 0 ? rail.max[1] : -rail.min[1], 'outer faces flush').toBeCloseTo(s > 0 ? chine.max[1] : -chine.min[1], 9);
      const rp = (get(parts, `rail-${tag}`).geometry as { positions: number[] }).positions;
      const yAt0 = rp.filter((_, i) => i % 3 === 1 && Math.abs(rp[i - 1] - 0) < 0.8).map(Math.abs);
      expect(Math.max(...yAt0) - Math.min(...yAt0)).toBeCloseTo(defaults.railThicknessIn, 9); // the rail's thickness behind the turn-in
      expect(rail.max[2]).toBeCloseTo(chine.min[2], 9); // the chine bears on the rail top
      expect(rail.max[2]).toBeCloseTo(L.deckBot, 9);
      expect(rail.max[2] - rail.min[2]).toBeCloseTo(defaults.railDepthIn, 9);
      expect(rail.min[0]).toBeCloseTo(-9.5, 6); // rear transom inner face (1/2 in transom, D-60)
      expect(rail.max[0]).toBeCloseTo(L.xFlatEnd, 6); // the end of the flat deck
    }
    expect(L.railTop).toBeCloseTo(L.deckBot, 9);
  });
  it('the chine is tied to the rail by a thickened-epoxy bed and screws every 6 in, with NO Dominos (D-81)', () => {
    const chine = get(parts, 'side-L-chine');
    const tie = chine.joints!.find((j) => j.to === 'rail-L' && j.type === 'glue')!;
    expect(tie.size).toMatch(/thickened epoxy bed/);
    expect(chine.joints!.some((j) => j.type === 'domino')).toBe(false);
    const n = Math.floor((L.xFlatEnd - (-9.25)) / defaults.chineTieSpacingIn); // 58.36 / 6 = 9 stations
    const screws = chine.joints!.filter((j) => j.to === 'rail-L' && j.type === 'screw');
    expect(screws.reduce((m, j) => m + j.count, 0)).toBe(n - 1); // a screw in EVERY gap (they locate the side as the frame is lowered)
    expect(get(parts, 'rail-L').joints!.some((j) => j.to === 'side-L-chine')).toBe(true);
  });
});

describe('lift hand-hold (M9, D-37): the rear transom only', () => {
  const ctx = makeCtx(defaults);
  const parts = buildModel(defaults);
  it('the rear transom has a stadium slot through it, ≥ 4.5" × 1.25", above the deck and clear of the box; there is no front transom to cut', () => {
    const t = get(parts, 'transom-rear');
    expect(t.geometry.type).toBe('extrusion');
    if (t.geometry.type !== 'extrusion') return;
    expect(t.geometry.holes).toHaveLength(5); // the lift slot + 4 dado vent holes (M4, D-43)
    const h = t.geometry.holes![0] as Vec2[];
    const w = Math.max(...h.map((q) => q[0])) - Math.min(...h.map((q) => q[0]));
    const ht = Math.max(...h.map((q) => q[1])) - Math.min(...h.map((q) => q[1]));
    expect(w).toBeCloseTo(defaults.liftSlotLengthIn, 3);
    expect(ht).toBeCloseTo(defaults.liftSlotHeightIn, 3);
    expect(w).toBeGreaterThanOrEqual(4.5 - 1e-9);
    expect(ht).toBeGreaterThanOrEqual(1.25 - 1e-9);
    const rear = liftSlot(ctx);
    expect(rear.zBot).toBeGreaterThanOrEqual(ctx.L.deckTop + defaults.liftSlotClearIn - 1e-9);
    expect(rear.zBot).toBeGreaterThanOrEqual(ctx.L.storage.zTop); // a box against the transom does not block the hand
    expect(parts.some((x) => x.id === 'transom-front')).toBe(false);
  });
  it('the slot sits above the box lid: the box top (15 in) + 1/4 in, with at least the minimum oak bar left above it under the 22 in transom corners', () => {
    const r = liftSlot(ctx);
    expect(r.zBot).toBeCloseTo(ctx.L.storage.zTop + 0.25, 9);
    expect(r.zTop).toBeCloseTo(r.zBot + 1.25, 9);
    expect(r.zTop + defaults.liftBarMinIn).toBeLessThanOrEqual(r.transomTop + 1e-9);
    expect(r.transomTop).toBeCloseTo(8 + 14, 9); // the transom corners are as tall as the rear side; the crown arcs above them
    expect(r.transomTop - r.zTop).toBeGreaterThan(defaults.liftBarMinIn);
  });
  it('the grip bar carries the per-person transport lift × the dynamic factor (one hand, simply supported over the slot)', () => {
    const perPerson = totalMass(buildModel(defaults, { removed: true })) / 2;
    const load = perPerson * defaults.dynamicFactor;
    const allow = derived(defaults).oakDesignMorPsi;
    const s = liftBarStressPsi(liftSlot(ctx), load);
    expect(s, `rear bar ${s.toFixed(0)} psi vs ${allow.toFixed(0)}`).toBeLessThan(allow);
    expect(perPerson).toBeGreaterThan(30);
  });
  it('the stress function is the beam formula', () => {
    // M = P L / 4 = 174 × 4.5 / 4 = 195.75; S = t h² / 6 = 0.75 × 0.75² / 6 = 0.0703125 → σ = 2784 psi (the ¾" transom, D-43)
    const s = liftBarStressPsi({ zBot: 0, zTop: 1, transomTop: 2, barIn: 0.75, thickIn: 0.75, lengthIn: 4.5 }, 174);
    expect(s).toBeCloseTo(2784, 0);
  });
  it('a taller slot raises the bar floor but the transom keeps its height until the oak above the slot would be too thin', () => {
    const big = makeCtx({ ...defaults, liftSlotHeightIn: 1.5 } as Params);
    const r = liftSlot(big);
    expect(r.zTop - r.zBot).toBeCloseTo(1.5, 9);
    expect(r.transomTop).toBeGreaterThanOrEqual(r.zTop + defaults.liftBarMinIn - 1e-9);
    const low = makeCtx({ ...defaults, sideHeightRearIn: 12 } as Params); // a shorter rear: the crest must lift above the corners rather than thin the bar
    const rl = liftSlot(low);
    expect(rl.transomTop).toBeGreaterThanOrEqual(rl.zTop + defaults.liftBarMinIn - 1e-9);
  });
});

describe('signs (D-9, D-35, D-57)', () => {
  const parts = buildModel(defaults);
  it('two 6 mm blanks (not removable, D-65), banded on all edges, with four knob screws each, on the outside of the tall rear part of the side and turned to its slope', () => {
    const { L } = makeCtx(defaults);
    for (const tag of ['L', 'R']) {
      const s = get(parts, `sign-${tag}`);
      expect(s.removable).toBeFalsy();
      expect(s.edges).toBe('edged');
      expect(s.geometry.type === 'box' && s.geometry.size[1]).toBeCloseTo(thinSheet(defaults).thicknessIn, 9);
      expect(s.group).toBe('body');
      expect(s.notes).toMatch(/banded/);
      const c = transformPoint(s.transform, [0, 0, 0]);
      expect(Math.abs(c[1])).toBeCloseTo(L.hwC + L.side + SIGN_PROUD_IN + thinSheet(defaults).thicknessIn / 2, 6); // D-63: 1/16 in proud of the band faces, 
      expect(c[2]).toBeGreaterThan(L.web.z0); // level with the free web
      expect(c[2]).toBeLessThan(8 + 14 - defaults.railBandIn);
      expect(s.transform[2]).toBeCloseTo(0, 9); // 3c-5: LEVEL, its length axis is not tilted to follow the sheer
    }
    expect(buildModel(defaults, { removed: true }).filter((x) => /^sign-[LR]$/.test(x.id))).toHaveLength(2); // D-65: they stay on in Transport mode
  });
  it('banding adds oak mass over the bare ply', () => {
    const s = get(parts, 'sign-L');
    if (s.geometry.type !== 'box') return;
    const [l, t, h] = s.geometry.size;
    const bare = (l * t * h / 1728) * derived(defaults).plyDensityPcf + (2 * (l * t + t * h + l * h) / 144) * defaults.finishLbPerFt2;
    expect(s.massLb).toBeGreaterThan(bare + 0.03);
  });
});

describe('mass bookkeeping (D-35…D-37, D-54)', () => {
  const BODY_LB = 37.9;
  it('the body and frame groups stay near the build numbers (body about 36 lb and frame about 13.4 lb after the D-60 weight package: 4 mm ply, 1/2 in transom, 1-1/2 in bulkhead, 5/8 in joists, no foot-block cleats; pinned from the build)', () => {
    const parts = buildModel(defaults);
    const sum = (g: string) => parts.filter((x) => x.group === g && !x.payload).reduce((m, x) => m + x.massLb, 0);
    // Hand: deck 58.6 x 23.25 x 0.472 in of ply (about 13.9 lb with finish), the 24 in x 22 in rear transom (about 9 lb), the 1-1/2 in bow bulkhead (about 6 lb), two webs (1.9 lb each),
    // two chines (1.3), two gunwales (1.5), backers and scuppers (1.1), the two signs (1.1): about 44 lb.
    expect(Math.abs(sum('body') - BODY_LB)).toBeLessThan(1.5); // D-80: +1.9 lb for the 6 mm Baltic birch webs, box, lid and signs (36.1 on the 1/4 in white oak ply of D-73); 40.5 before D-60 (4 mm ply, 1/2 in transom, 1-1/2 in bulkhead); 3c-5: the bulkhead is lower (a 5.75 in crown peak, not 9 in)
    // Rails 2 x 3.5 (extrusions with the step), hangers 2 x 1.05, six joists (0.82 to 0.88; the king beam is in the front-end group): about 13 lb.
    expect(Math.abs(sum('frame') - 13.4)).toBeLessThan(1); // eight joists since 3c-5 (8.5 in spacing, +0.84 lb); D-60: 5/8 in joists (-0.8 lb), 14.4 before
  });
});

describe('round 2 hull (build M2-M8, D-43)', () => {
  const parts = buildModel(defaults);
  const ctx = makeCtx(defaults);
  const { L } = ctx;
  const p = defaults;

  it('transoms are 1/2" (D-60; was 3/4"), chines and gunwales 5/8" thick as a sandwich of two 0.214" bands and the 5 mm white oak plywood web (D-62, D-73, D-80; 0.1945" on the 6 mm Baltic birch, 0.2075" on a 0.21 in white oak sheet, 0.234" on the 4 mm okoume)', () => {
    expect(L.transom).toBe(0.5);
    expect(L.side).toBe(0.625);
    // D-61/D-62: no grooves; a band of (0.625 - web) / 2 on each face of the web: the default web is the 0.197 in (5 mm) white oak plywood (2026-10-24: 13 mm deck, 5 mm combi-core white oak sides as bought)
    expect(thinSheet(p).thicknessIn).toBeCloseTo(0.197, 9);
    expect(L.sideBand).toBeCloseTo(0.214, 4);
    expect(get(parts, 'side-L-chine').joints!.find((j) => j.to === 'side-L-web')!.size).toMatch(/0\.214" oak strip/);
    // D-80's follow-the-weather web is the 0.236 in (6 mm) Baltic birch: bands of 0.1945"
    const fw = { ...p, thinSheetMaterial: 0 };
    expect(thinSheet(fw).thicknessIn).toBeCloseTo(0.236, 9);
    expect(computeLayout(fw).sideBand).toBeCloseTo(0.1945, 4);
    expect(get(buildModel(fw), 'side-L-chine').joints!.find((j) => j.to === 'side-L-web')!.size).toMatch(/0\.19[45]" oak strip/);
    // a nominal 1/4 in white oak plywood sheet (0.21 in, D-73): bands of 0.2075"
    expect(computeLayout({ ...p, thinSheetMaterial: 1, whiteOakPlyThickIn: 0.21 }).sideBand).toBeCloseTo(0.2075, 4);
    // the okoume option at 4 mm (panelPlyIn 0.157): the D-62 bands of 0.234"
    const ok = { ...p, thinSheetMaterial: 2, panelPlyIn: 0.157 };
    expect(computeLayout(ok).sideBand).toBeCloseTo(0.2338, 3);
    expect(get(buildModel(ok), 'side-L-chine').joints!.find((j) => j.to === 'side-L-web')!.size).toMatch(/0\.234" oak strip/);
  });

  it('rough length gets its allowance (M8; Eric 2026-10-12): +1 in plain, +2 in for a bent strip, and 1/8" in t', () => {
    const c = get(parts, 'side-L-chine');
    expect(c.stock!.l).toBeCloseTo(sideBandLengths(L, p).chineIn, 6); // the developed plan S (D-93), not the x extent
    expect(c.rough!.l).toBeCloseTo(c.stock!.l + p.laminateLengthAllowanceIn, 6); // a bent strip: the laminate allowance (Eric 2026-10-12)
    expect(c.rough!.t).toBeCloseTo(L.sideBand + p.millingAllowanceIn, 6); // a strip, not a 5/8 block (S2)
    // The gunwale bands are sawn from a blank that stands past each web end (the end stops) and is tilted along the chord of the sheer (D-105, body.ts sheerBlank).
    expect(get(parts, 'side-L-gunwale').rough!.l).toBeCloseTo(sheerBlank(L, p, L.sideBand).stock.l + p.laminateLengthAllowanceIn, 6);
    for (const x of parts.filter((q) => q.rough && q.stock && (q.group === 'body' || q.group === 'frame') && !/-gunwale/.test(q.id))) expect(x.rough!.l - x.stock!.l, x.id).toBeCloseTo(x.kind === 'bentlam' || x.plies !== undefined ? p.laminateLengthAllowanceIn : p.roughLengthAllowanceIn, 6);
  });

  it('a steel box with no stock gets the bar section x cut length and a McMaster-class source (M9 net)', () => {
    const b = box(ctx, { id: 'x', name: 'x', group: 'hardware', center: [0, 0, 0], mat: 'steel', size: [0.25, 1, 6], step: 1 });
    expect(b.stock).toEqual({ t: 0.25, w: 1, l: 6 });
    expect(b.sourcing?.vendor).toMatch(/McMaster/);
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

  it('scuppers (Extreme spec; Standard drills plain holes, D-83): four 3/8" stainless nipples through the chines at deck level (M7; the rear corners and just behind the bow bulkhead), each with a joint and `at`', () => {
    const parts = buildModel({ ...defaults, weatherSpec: 1 });
    const ctx = makeCtx({ ...defaults, weatherSpec: 1 });
    const sc = parts.filter((x) => x.id.startsWith('scupper-'));
    expect(sc.map((x) => x.id).sort()).toEqual(['scupper-bow-L', 'scupper-bow-R', 'scupper-rear-L', 'scupper-rear-R']);
    const sites = scupperSites(ctx);
    expect(sites.map((s) => s.zone)).toEqual(['rear', 'bow']);
    expect(sites[0].x).toBeCloseTo(-9.5 + 0.5 * 0.75, 6); // inside the rear transom (its inner face is -9.5, D-60), 3/8 in in
    expect(sites[1].x).toBeCloseTo(L.xFlatEnd - 1, 6); // 1 in behind the end of the flat deck
    for (const x of sc) {
      expect(x.joints![0].at).toHaveLength(1);
      expect(x.sourcing?.vendor).toMatch(/stainless/i);
      const bb = worldAABB(x);
      // lower edge of the hole 0.05" over the deck surface
      expect(bb.min[2]).toBeCloseTo(L.deckTop + 0.05, 3);
      // through the whole 5/8" chine and 1/4" proud outside
      const hwHere = L.hwC - L.turnIn(x.id.includes('bow') ? L.xFlatEnd - 1 : 0);
      expect(Math.abs(x.id.endsWith('L') ? bb.min[1] : bb.max[1])).toBeCloseTo(hwHere, 6);
      expect(Math.abs(x.id.endsWith('L') ? bb.max[1] : bb.min[1])).toBeCloseTo(hwHere + L.side + 0.25, 6);
    }
  });

  it('rear transom backers sit inside the transom behind the sockets, and the rear box starts behind them (S13)', () => {
    for (const tag of ['L', 'R']) for (const n of [1, 2]) {
      const bk = get(parts, `transom-backer-${tag}${n}`);
      const b = worldAABB(bk);
      expect(b.min[0]).toBeCloseTo(L.xRear + L.transom, 6);
      expect(b.max[0] - b.min[0]).toBeCloseTo(p.blockingThickIn, 6);
      expect(b.max[1] <= L.hwC + 1e-9 || b.min[1] >= -L.hwC - 1e-9).toBe(true);
      expect(bk.joints!.some((j) => j.to === 'transom-rear')).toBe(true);
    }
    expect(L.storage.x0).toBeCloseTo(L.xRear + L.transom + L.rearLane, 6);
  });

  it('each side has two backer blocks, grain across the sled like the transom, each sized to its socket screw T-nut and brake-cord eye (Eric 2026-10-24)', () => {
    const tr = get(parts, 'transom-rear');
    expect(tr.grain).toBe('x'); // the transom's local x runs across the sled
    const blocks = transomBackerBlocks(p, L);
    expect(blocks.map((b) => b.pos)).toEqual(['low', 'high']);
    const h = handleGeometry(p, L);
    const [zLo, zHi] = socketScrewZ(h);
    const rT = p.handleTNutFlangeDiaIn / 2 + p.transomBackerMarginIn;
    for (const b of blocks) {
      const zT = b.pos === 'low' ? zLo : zHi;
      expect(b.tnut[1]).toBeCloseTo(zT, 9);
      expect(b.tnut[0] - b.y[0]).toBeGreaterThanOrEqual(rT - 1e-9); // 1/2 in of oak inboard of the T-nut counterbore
      expect(b.z[1] - zT).toBeGreaterThanOrEqual(b.pos === 'high' ? Math.min(rT, h.zTop - zT) - 1e-9 : rT - 1e-9);
      if (b.pos === 'high') expect(zT - b.z[0]).toBeGreaterThanOrEqual(rT - 1e-9);
      else expect(b.z[0]).toBeCloseTo(L.deckTop + 0.5, 9); // the lower block stays 1/2 in over the deck
      expect(b.eye[1]).toBeGreaterThan(b.z[0]); // the cord eye's pilot lands in the block
      expect(b.eye[1]).toBeLessThan(b.z[1]);
      expect(b.y[1]).toBeCloseTo(L.hwC - TRANSOM_BACKER_BAND_CLEAR_IN, 9);
      // edges on the 1/16 in grid
      for (const v of [...b.y, ...b.z]) expect(Math.abs(v * 16 - Math.round(v * 16))).toBeLessThan(1e-6);
    }
    for (const tag of ['L', 'R']) for (const n of [1, 2]) expect(get(parts, `transom-backer-${tag}${n}`).grain).toBe('y');
    // the defaults: lower 1-5/8 in tall, upper 2-13/16 in, both 2-13/16 in across the sled; nothing between them
    expect(blocks[0].z[1] - blocks[0].z[0]).toBeCloseTo(1.625, 9);
    expect(blocks[1].z[1] - blocks[1].z[0]).toBeCloseTo(2.8125, 9);
    expect(blocks[0].y[1] - blocks[0].y[0]).toBeCloseTo(2.8125, 9);
    expect(blocks[1].z[0] - blocks[0].z[1]).toBeGreaterThan(8);
    // the flag tube still bears on a backer block level with each of its two holding blocks
    const tube = worldAABB(get(parts, 'flag-tube'));
    const bl = [1, 2].map((n) => worldAABB(get(parts, `transom-backer-L${n}`)));
    expect(tube.min[0]).toBeCloseTo(bl[0].max[0], 6);
    for (const id of ['flag-block-bottom', 'flag-block-top']) {
      const f = worldAABB(get(parts, id));
      expect(bl.some((b) => Math.min(b.max[2], f.max[2]) - Math.max(b.min[2], f.min[2]) > 1 && b.max[1] > tube.min[1]), id).toBe(true);
    }
  });

  it('assembly order is data (M4, D-45): deck 4 < sides 4.2 < transom 4.4, and every closed dado is vented', () => {
    const st = (id: string) => get(parts, id).step;
    expect(st('deck')).toBe(HULL_STEP.deck);
    expect(st('side-L-web')).toBe(HULL_STEP.sides);
    expect(st('side-L-chine')).toBe(HULL_STEP.sides);
    expect(st('bow-bulkhead')).toBe(HULL_STEP.transom);
    expect(st('transom-rear')).toBe(HULL_STEP.transom);
    expect(HULL_STEP.deck < HULL_STEP.sides && HULL_STEP.sides < HULL_STEP.transom).toBe(true);
    expect(get(parts, 'transom-rear').notes).toMatch(/CLOSED FIRST/);
    expect(get(parts, 'side-L-web').notes).toMatch(/hydraulic lock/);
    for (const j of get(parts, 'transom-rear').joints!.filter((q) => q.type === 'dado')) expect(j.size, j.to).toMatch(/vent/);
  });

  it('no joint says "CNC blind tenon": thin members get a loose tenon (S2)', () => {
    for (const x of parts) for (const j of x.joints ?? []) if (x.group === 'body' || x.group === 'frame') expect(j.size ?? '', `${x.id}->${j.to}`).not.toMatch(/CNC blind/i);
    const lt = parts.flatMap((x) => (x.group === 'body' || x.group === 'frame' ? x.joints ?? [] : [])).filter((j) => j.type === 'mortise-tenon');
    expect(lt.length).toBeGreaterThan(0);
    for (const j of lt) expect(j.size).toMatch(/loose tenon/);
  });

  it('8.5" joists (3c-5): six evenly spaced crossmembers (bays under 8.5 in) from the rear transom to the king beam (D-56), the king beam itself at the kingpin, and an end joist under the scarf of the deck to the bow bulkhead', () => {
    expect(L.joistX).toHaveLength(8);
    expect(p.crossmemberSpacingIn).toBe(8.5);
    // Even spacing from the rear transom face (-9.5, D-60) to the king beam's rear face (44 - 3/2 = 42.5): 52 in / 7 bays = 7.43 in.
    const even = L.joistX.slice(0, 6);
    for (let i = 0; i < 6; i++) expect(even[i]).toBeCloseTo(-9.5 + (52 * (i + 1)) / 7, 6);
    expect(L.joistX[6]).toBe(L.king.x);
    expect(L.joistX[7]).toBeCloseTo(L.xFlatEnd - L.joistT / 2 - 0.05, 9);
    expect(joistId(L, 6)).toBe('king-beam');
    expect([0, 1, 2, 3, 4, 5, 7].map((i) => joistId(L, i))).toEqual(['joist-1', 'joist-2', 'joist-3', 'joist-4', 'joist-5', 'joist-6', 'joist-8']);
    for (let i = 0; i < L.joistX.length; i++) expect(parts.some((x) => x.id === joistId(L, i)), joistId(L, i)).toBe(true);
    const edges = [L.xRear + L.transom, ...L.joistX.flatMap((x) => [x - (x === L.king.x ? L.king.len : L.joistT) / 2, x + (x === L.king.x ? L.king.len : L.joistT) / 2]), L.xFlatEnd];
    let bay = 0;
    for (let i = 0; i + 1 < edges.length; i += 2) bay = Math.max(bay, edges[i + 1] - edges[i]);
    expect(bay).toBeLessThan(8.5);
    expect(bay).toBeGreaterThan(5.5); // 6.6 between the joists; the long bay is the 5.8 in from the king beam to the end joist, 6.5 at the rear
    expect(get(parts, 'joist-8').notes).toMatch(/last crossmember, under the scarf/);
    expect(get(parts, 'joist-6').notes).toMatch(/chain crossmember/); // the crossmember behind the king beam anchors the steering chains (D-58)
  });
});
