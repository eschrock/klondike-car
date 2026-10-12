/**
 * The body (D-54): a straight-sided 24 in sled hull. Captured ply, joinery records, the rear lift hand-hold, scuppers, the bow curl, the sled profile and the (provisional)
 * signs. The old tapering curved hull, finger guards, front transom and sheer are gone; the lift check and foot-stop numbers belong to src/analysis/hull.test.ts.
 * Expected numbers are re-derived by hand from the params (deck 8, ply 0.472, side 0.625, rear 16 in, bow 4 in, rear face at x = -9.25).
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, derived, validateParams, type Params } from '../params';
import { buildModel } from './index';
import { liftBarStressPsi, liftSlot, scupperSites } from './body';
import { chooseDomino, DOMINOS, endJoint, frac, joinerySummary } from './joinery';
import { HULL_STEP, box, makeCtx } from './build-utils';
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
  deck9mm: { deckPlyIn: 0.354, panelPlyIn: 0.354 },
  storageForward: { storageLocation: 1 },
  storageUnderSeat: { storageLocation: 2 },
  sag1: { sideProfileSagIn: 1 },
  bulge1: { sideProfileSagIn: -1 },
  bowSide5: { sideHeightBowIn: 5 },
  rearSide12: { sideHeightRearIn: 12 },
  wide26: { bodyWidthIn: 26 },
  narrow23: { bodyWidthIn: 23 },
  curl9: { bowCurlRadiusIn: 9 },
  curl60: { bowCurlAngleDeg: 60, sideHeightBowIn: 3 },
  bigLiftSlot: { liftSlotLengthIn: 5, liftSlotHeightIn: 1.5 },
  signsOn: { showSideSigns: 1 },
  wideTire: { tireWidthIn: 4.5 },
};
const VARIANTS = Object.entries(PATCHES)
  .map(([name, patch]) => ({ name, p: { ...defaults, ...patch } as Params }))
  .filter((v) => !errorsOf(v.p).length);

const flat = (e: Part['edges']): EdgeCondition[] => (e === undefined ? [] : Array.isArray(e) ? e : [e]);
/** The straight sled line by hand (D-54): height above the deck of the gunwale top at x, from the rear transom's inner face to the end of the sides. */
const sledLine = (p: Params, x: number, xFrom: number, xTo: number) => {
  const u = Math.max(0, Math.min(1, (x - xFrom) / (xTo - xFrom)));
  return p.sideHeightRearIn + (p.sideHeightBowIn - p.sideHeightRearIn) * u - 4 * p.sideProfileSagIn * u * (1 - u);
};

describe('what D-54 removed', () => {
  it('has no front transom, finger guards, sheer, nose members, cabin/nose split or steering parts; the part ids are the plain ones', () => {
    const ids = buildModel(defaults).map((x) => x.id);
    for (const gone of [/^transom-front$/, /^guard-/, /nose/, /cabin/, /^stringer/, /^beam-front$/, /^tongue/, /^tie-rod$/, /^sign-/])
      expect(ids.filter((i) => gone.test(i)), String(gone)).toEqual([]);
    for (const id of ['deck', 'bow-curl', 'side-L-chine', 'side-L-gunwale', 'side-L-web', 'side-R-chine', 'side-R-gunwale', 'side-R-web', 'rail-L', 'rail-R', 'axle-hanger-L', 'axle-hanger-R', 'joist-1', 'transom-rear'])
      expect(ids, id).toContain(id);
  });
});

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
  it('captured vs edged is what the joinery says: captured edges have a groove, rabbet, dado or scarf on the neighbor; the bow curl is edged', () => {
    const parts = buildModel(defaults);
    const web = get(parts, 'side-L-web');
    expect(web.edges).toBe('captured'); // the flat panel: the rear end in the transom dado, top and bottom in the grooves, the front end bonded to the curl
    expect(web.joints!.filter((j) => j.type === 'dado').map((j) => j.to).sort()).toEqual(['side-L-chine', 'side-L-gunwale', 'transom-rear']);
    expect(web.joints!.filter((j) => j.to === 'bow-curl').map((j) => j.type)).toEqual(['glue']);
    const deck = get(parts, 'deck');
    // D-52/D-54: one flat deck, in the chine rabbets all the way along, in a dado in the rear transom, and scarfed to the bow curl at its front edge.
    expect(deck.joints!.filter((j) => j.type === 'rabbet').map((j) => j.to).sort()).toEqual(['side-L-chine', 'side-R-chine']);
    expect(deck.joints!.some((j) => j.type === 'dado' && j.to === 'transom-rear')).toBe(true);
    expect(deck.joints!.some((j) => j.type === 'scarf' && j.to === 'bow-curl')).toBe(true);
    // The deck is carried by the rails and every joist (glue); the king beam (D-56) replaces the sixth joist and the end joist keeps its index (joist-7).
    expect(deck.joints!.filter((j) => j.type === 'glue').map((j) => j.to).sort()).toEqual(['joist-1', 'joist-2', 'joist-3', 'joist-4', 'joist-5', 'joist-7', 'king-beam', 'rail-L', 'rail-R']);
    // The curl has no ply edge showing: banded oak on the top edge and the exposed side edges (its mass includes the banding, below).
    expect(get(parts, 'bow-curl').edges).toBe('edged');
    // FINDING: the deck-to-curl scarf is recorded twice on the bow curl (once in body.ts, once by applyJoinery's deck/bow-curl pair); the deck has it once.
    expect(get(parts, 'bow-curl').joints!.filter((j) => j.type === 'scarf' && j.to === 'deck').length).toBeGreaterThanOrEqual(1);
    expect(deck.joints!.filter((j) => j.type === 'scarf').length).toBe(1);
  });
});

describe('captured-ply sides, deck and rear transom (D-22, D-35, D-54)', () => {
  const parts = buildModel(defaults);
  const ctx = makeCtx(defaults);
  const { L } = ctx;
  const dd = defaults.deckCaptureDepthIn, g = defaults.grooveDepthIn;
  const rearTx = -10 + 0.75; // the rear transom's inner face: x = -rearOverhang + 3/4
  it('the layout agrees with the hand numbers (24 in body, 22.75 in inside, deck 8, ply 0.472, rear face -9.25, side bar 1.5 in)', () => {
    expect(L.xSideStart).toBeCloseTo(rearTx, 9);
    expect(L.hwC).toBeCloseTo(24 / 2 - 0.625, 9);
    expect(L.deckBot).toBeCloseTo(8 - 0.472, 9);
    expect(L.chineBot).toBeCloseTo(L.deckBot, 9); // one deck level: the chine bottom is the deck underside
    expect(L.web.z0).toBeCloseTo(8 - 0.472 + 1.5, 9); // the chine top
    expect(L.sideTop).toBeCloseTo(8 + 16, 9);
    expect(L.sideH).toBe(4);
  });
  it('the web (a flat trapezoid) enters the chine groove at the bottom and the gunwale groove at the top by the groove depth, all along the sled line', () => {
    for (const tag of ['L', 'R']) {
      const web = get(parts, `side-${tag}-web`), chine = get(parts, `side-${tag}-chine`), gun = get(parts, `side-${tag}-gunwale`);
      expect(web.geometry.type).toBe('extrusion');
      const w = worldAABB(web), c = worldAABB(chine), q = worldAABB(gun);
      expect(c.max[2] - w.min[2]).toBeCloseTo(g, 6); // bottom: the chine top is g above the web bottom
      expect(w.max[2] - (q.max[2] - defaults.railBandIn)).toBeCloseTo(g, 6); // top at the rear: g above the gunwale underside there
      expect(web.geometry.type === 'extrusion' ? web.geometry.depth : -1).toBeCloseTo(defaults.panelPlyIn, 9);
      // Along the whole slope: every top vertex of the web is g above the gunwale underside (the straight sled line, by hand).
      if (web.geometry.type !== 'extrusion') continue;
      const n = web.geometry.outline.length / 2;
      for (const [x, z] of web.geometry.outline.slice(n)) {
        const under = L.deckTop + sledLine(defaults, x, L.xSideStart, L.xSideEnd) - defaults.railBandIn;
        expect(z - under, `${tag} x ${x.toFixed(1)}`).toBeCloseTo(g, 6);
      }
    }
  });
  it('the groove leaves sturdy oak walls (≥ 0.1") and a ply that fits the groove', () => {
    expect((defaults.sideThicknessIn - defaults.panelPlyIn - defaults.grooveSlopIn) / 2).toBeGreaterThanOrEqual(0.1);
    expect(validateParams(defaults).filter((i) => i.severity !== 'info')).toEqual([]);
    const thin = validateParams({ ...defaults, sideThicknessIn: 0.375 });
    expect(thin.some((i) => i.severity === 'warn' && i.keys.includes('grooveSlopIn'))).toBe(true);
  });
  it('the web enters the rear transom dado at its rear end and ends against the bow curl at its front end', () => {
    for (const tag of ['L', 'R']) {
      const b = worldAABB(get(parts, `side-${tag}-web`));
      expect(b.min[0]).toBeCloseTo(rearTx - dd, 6);
      expect(b.max[0]).toBeCloseTo(L.xSideEnd, 6);
    }
  });
  it('the deck is ONE flat sheet that enters the chine rabbets and the transom dado, and ends where the bow curl starts', () => {
    const d = get(parts, 'deck');
    expect(d.geometry.type).toBe('extrusion');
    const a = worldAABB(d);
    expect(a.max[1]).toBeCloseTo(L.hwC + dd, 6);
    expect(a.min[1]).toBeCloseTo(-(L.hwC + dd), 6);
    expect(a.min[0]).toBeCloseTo(rearTx - dd, 6);
    expect(a.max[0]).toBeCloseTo(L.xFlatEnd, 6);
    expect(a.min[2]).toBeCloseTo(L.deckBot, 6);
    expect(a.max[2]).toBeCloseTo(8, 6);
    // 58.6 in long × 23.25 wide: fits one 4 x 8 sheet (96 x 48) with the width across the 48.
    expect(a.max[0] - a.min[0]).toBeLessThan(96);
    expect(a.max[1] - a.min[1]).toBeLessThan(48);
    if (d.geometry.type !== 'extrusion') return;
    expect(d.geometry.outline).toHaveLength(4); // a plain rectangle: no steering corridor, no cable slot, no taper
    expect(d.geometry.holes ?? []).toHaveLength(0);
    expect(d.edges).toHaveLength(4);
    expect(flat(d.edges).every((e) => e === 'captured')).toBe(true);
  });
  it('the rear transom spans the full outside width, is as tall as the rear side plus a crown, and wraps the side ends', () => {
    const r = worldAABB(get(parts, 'transom-rear'));
    expect(r.max[1]).toBeCloseTo(L.hwC + L.side, 6);
    expect(r.min[1]).toBeCloseTo(-(L.hwC + L.side), 6);
    expect(r.max[1] - r.min[1]).toBeCloseTo(defaults.bodyWidthIn, 6);
    expect(r.max[0] - r.min[0]).toBeCloseTo(L.transom, 6);
    expect(r.min[0]).toBeCloseTo(-10, 6);
    expect(L.transom).toBe(0.75); // D-43: the transom is ¾", the chine and gunwale ⅝"
    expect(L.side).toBe(0.625);
    // The corners are at the rear gunwale height (deck + 16 in); the crown arcs above them at the center (D-44).
    expect(r.max[2]).toBeCloseTo(8 + defaults.sideHeightRearIn + defaults.transomCrownIn, 6);
    expect(r.min[2]).toBeCloseTo(8 - defaults.crossmemberDepthIn, 6); // it hangs as far below the deck as the joists
    const side = worldAABB(get(parts, 'side-L-chine'));
    expect(side.min[0]).toBeCloseTo(rearTx, 6); // the sides butt the transom's inner face
  });
});

describe('the straight sled sides (D-54)', () => {
  const parts = buildModel(defaults);
  const { L } = makeCtx(defaults);
  const xs = L.xSideStart, xe = L.xSideEnd;
  it('the sides are straight and parallel: a constant 24 in outside, 22.75 in inside, the same section all the way', () => {
    for (const tag of ['L', 'R'] as const) {
      const s = tag === 'L' ? 1 : -1;
      for (const m of ['chine', 'gunwale'] as const) {
        const b = worldAABB(get(parts, `side-${tag}-${m}`));
        expect(s * (s > 0 ? b.min[1] : b.max[1]), `${tag} ${m} inner face`).toBeCloseTo(11.375, 6);
        expect(s * (s > 0 ? b.max[1] : b.min[1]), `${tag} ${m} outer face`).toBeCloseTo(12, 6);
        expect(b.min[0]).toBeCloseTo(xs, 6);
        expect(b.max[0]).toBeCloseTo(xe, 6);
      }
      const chine = get(parts, `side-${tag}-chine`);
      expect(chine.geometry.type).toBe('box'); // a plain straight bar: no sweep, no curve
      expect(chine.stock!.l).toBeCloseTo(xe - xs, 6);
    }
    expect(2 * (L.hwC + L.side)).toBeCloseTo(24, 9);
    expect(2 * L.hwC).toBeCloseTo(22.75, 9);
  });
  it('the gunwale top is a straight line from 16 in over the deck at the rear transom to 4 in at the end of the sides; its slope is 12 in over 64.53 in (about 10.5 degrees)', () => {
    expect(xe - xs).toBeCloseTo(64.5298, 3);
    for (const tag of ['L', 'R']) {
      const gun = get(parts, `side-${tag}-gunwale`);
      expect(gun.geometry.type).toBe('extrusion');
      if (gun.geometry.type !== 'extrusion') continue;
      const n = gun.geometry.outline.length / 2;
      const bottom = gun.geometry.outline.slice(0, n), top = gun.geometry.outline.slice(n);
      expect(Math.min(...top.map((q) => q[0]))).toBeCloseTo(xs, 6);
      expect(Math.max(...top.map((q) => q[0]))).toBeCloseTo(xe, 6);
      for (const [x, z] of top) expect(z - 8, `x ${x.toFixed(1)}`).toBeCloseTo(16 + (4 - 16) * ((x - xs) / (xe - xs)), 6);
      for (let i = 0; i < n; i++) expect(top.find((q) => Math.abs(q[0] - bottom[i][0]) < 1e-9)![1] - bottom[i][1], 'a 1.5 in band').toBeCloseTo(1.5, 6);
      const b = worldAABB(gun);
      expect(b.max[2]).toBeCloseTo(8 + 16, 6);
      expect(b.min[2]).toBeCloseTo(8 + 4 - 1.5, 6);
    }
    expect((Math.atan2(12, xe - xs) * 180) / Math.PI).toBeCloseTo(10.53, 1);
  });
  it('the sag option bends the line down by sideProfileSagIn at mid-length (a parabola), and a negative sag bulges up; the ends do not move', () => {
    for (const sag of [1, -1]) {
      const p = { ...defaults, sideProfileSagIn: sag } as Params;
      expect(errorsOf(p)).toEqual([]);
      const gun = get(buildModel(p), 'side-L-gunwale');
      if (gun.geometry.type !== 'extrusion') throw new Error('gunwale is not an extrusion');
      const n = gun.geometry.outline.length / 2;
      const top = gun.geometry.outline.slice(n);
      const mid = top.reduce((m, q) => (Math.abs(q[0] - (xs + xe) / 2) < Math.abs(m[0] - (xs + xe) / 2) ? q : m));
      const straight = 8 + 16 + (4 - 16) * ((mid[0] - xs) / (xe - xs));
      expect(straight - mid[1]).toBeCloseTo(4 * sag * 0.25 * (1 - Math.pow(2 * ((mid[0] - xs) / (xe - xs)) - 1, 2)), 6);
      expect(Math.abs(straight - mid[1])).toBeGreaterThan(0.9 * Math.abs(sag));
      const first = top.reduce((m, q) => (q[0] < m[0] ? q : m)), last = top.reduce((m, q) => (q[0] > m[0] ? q : m));
      expect(first[1]).toBeCloseTo(8 + 16, 6); // the ends of the line do not move
      expect(last[1]).toBeCloseTo(8 + 4, 6);
    }
  });
  it('the sides end against the bow curl where its inside face has risen to the bow side height (4 in): a bigger side height moves the end forward', () => {
    const ri = defaults.bowCurlRadiusIn - (defaults.bowCurlPlies * defaults.bowCurlPlyIn) / 2; // inside radius 6.764
    const inside = (x: number) => ri - Math.sqrt(ri * ri - (x - L.xFlatEnd) ** 2);
    expect(inside(xe)).toBeCloseTo(4, 6);
    expect(L.curl.heightAt(xe)).toBeCloseTo(4, 6);
    expect(L.curl.heightAt(L.xFlatEnd)).toBe(0);
    expect(L.curl.angleAt(L.xFlatEnd)).toBe(0);
    const taller = makeCtx({ ...defaults, sideHeightBowIn: 5 } as Params).L;
    expect(taller.xSideEnd).toBeGreaterThan(xe);
    expect(taller.curl.heightAt(taller.xSideEnd)).toBeCloseTo(5, 6);
  });
});

describe('the bow curl (D-54)', () => {
  const parts = buildModel(defaults);
  const { L } = makeCtx(defaults);
  const curl = get(parts, 'bow-curl');
  it('is a 4-ply bent lamination of 3 mm okoume (0.472 in, the deck\'s thickness), 22.75 in wide (the inside width), scarfed 8:1 to the deck', () => {
    expect(curl.kind).toBe('bentlam');
    expect(curl.fab).toBe('bentlam');
    expect(curl.geometry.type).toBe('sweep');
    if (curl.geometry.type !== 'sweep') return;
    expect(curl.geometry.plies).toBe(4);
    expect(curl.geometry.thickness).toBeCloseTo(4 * 0.118, 6);
    expect(curl.geometry.thickness).toBeCloseTo(defaults.deckPlyIn, 2);
    expect(curl.geometry.width).toBeCloseTo(2 * L.hwC, 9);
    const sc = curl.joints!.find((j) => j.type === 'scarf' && j.to === 'deck')!;
    expect(sc.size).toMatch(/^8:1 scarf, 3\.8" long/); // 8 × 0.472 = 3.78 in
  });
  it('runs flat from the end of the flat deck and curls up on a 7 in centerline radius through 80 degrees to the tip at x = 56', () => {
    if (curl.geometry.type !== 'sweep') throw new Error('not a sweep');
    const path = curl.geometry.path;
    const th = curl.geometry.thickness;
    expect(path[0][0]).toBeCloseTo(L.xFlatEnd, 6);
    expect(path[0][1]).toBeCloseTo(8 - th / 2, 6); // the deck's centerline: the curl continues the deck
    const tip = path[path.length - 1];
    expect(tip[0]).toBeCloseTo(44 + 12, 6); // wheelbase + front overhang
    expect(tip[0]).toBeCloseTo(L.xFlatEnd + 7 * Math.sin((80 * Math.PI) / 180), 6);
    expect(tip[1]).toBeCloseTo(8 - th / 2 + 7 * (1 - Math.cos((80 * Math.PI) / 180)), 6);
    expect(L.xFlatEnd).toBeCloseTo(49.106, 3);
    // Every sampled point is 7 in from the arc center (the circle), so the path really is an arc.
    const cz = 8 - th / 2 + 7;
    for (const [x, z] of path) expect(Math.hypot(x - L.xFlatEnd, z - cz)).toBeCloseTo(7, 6);
    // Inside radius against the cold-bend limit: 6.76 in vs 40 × one ply (0.118) = 4.72 in.
    expect(7 - th / 2).toBeGreaterThan(defaults.hullLamMinRadiusFactor * 0.118);
    expect(errorsOf({ ...defaults, bowCurlRadiusIn: 3 } as Params).some((i) => i.keys.includes('bowCurlRadiusIn'))).toBe(true);
  });
  it('sits inside the hull width and above the end joist, with its tip well ahead of the king beam; mass includes the edge banding', () => {
    const b = worldAABB(curl);
    expect(b.max[1]).toBeCloseTo(L.hwC, 6);
    expect(b.min[1]).toBeCloseTo(-L.hwC, 6);
    expect(b.min[0]).toBeLessThan(L.xFlatEnd); // the flat run starts under the deck's front edge
    expect(b.max[0]).toBeGreaterThan(L.xFront);
    expect(b.min[0]).toBeGreaterThan(L.king.x + L.king.len / 2);
    // Volume by hand: arc length 7 × 80 degrees = 9.77 in × 22.75 × 0.472 = 104.9 in³ of okoume (about 1.9 lb) plus finish and banding.
    expect(curl.stock!.l).toBeCloseTo(7 * (80 * Math.PI) / 180, 1);
    expect(curl.massLb).toBeGreaterThan(1.8);
    expect(curl.massLb).toBeLessThan(3);
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
    // The 22.5 in joist: its two Dominos are at y = +-11.25 (the rails' inner faces), at the joist's x.
    expect(d.map((j) => Math.round(transformPoint(joist.transform, j.at![0])[1] * 100) / 100).sort((a, b) => a - b)).toEqual([-11.25, 11.25]);
    expect(transformPoint(joist.transform, d[0].at![0])[0]).toBeCloseTo(L0.joistX[1], 6);
  });
  it('a joist at the rear axle is cut back for the hanger and Domino-tied to the hanger instead of the rail', () => {
    const j1 = get(parts, 'joist-1');
    expect(j1.joints!.filter((j) => j.type === 'domino').map((j) => j.to).sort()).toEqual(['axle-hanger-L', 'axle-hanger-R']);
    expect(j1.stock!.l).toBeCloseTo(2 * (11.25 - defaults.axleHangerThickIn), 6); // 21 in: 10.5 in each side
    expect(worldAABB(j1).max[1]).toBeCloseTo(11.25 - defaults.axleHangerThickIn, 6);
    expect(get(parts, 'joist-2').stock!.l).toBeCloseTo(22.5, 6); // between the rails' inner faces
  });
  it('Domino size follows the stock: thin rails get a DF 500 5×30; thick stock gets XL; 1/2" hosts get a loose tenon', () => {
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
  // built outside the hull/frame joinery from the contact region of the mated parts. A new joint without `at` fails here. Payload parts have no joinery.
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
            // Within 1" of the part's own bounds (tilted webs and sloped members are boxed loosely by their axis-aligned contact region).
            for (let k = 0; k < 3; k++) expect(a[k], `${tag} axis ${k}`).toBeGreaterThanOrEqual(b.min[k] - 1);
            for (let k = 0; k < 3; k++) expect(a[k], `${tag} axis ${k}`).toBeLessThanOrEqual(b.max[k] + 1);
          }
        }
      }
    }
  });
  it('summary counts each physical joint once, by type (default model)', () => {
    const s = joinerySummary(parts.filter(mine));
    expect(s.total).toBeGreaterThan(40);
    for (const k of ['domino', 'mortise-tenon', 'dado', 'rabbet', 'glue', 'scarf', 'bolt']) expect(s.byType[k] ?? 0, k).toBeGreaterThan(0);
    // Doubled lists (both parts) would give at least twice the once-counted total.
    const both = parts.filter(mine)
      .reduce((m, x) => m + (x.joints ?? []).reduce((a, j) => a + j.count, 0), 0);
    expect(both).toBeGreaterThan(s.total);
  });
  it('the signs come off with tee-nuts and knobs (D-9); off by default (D-54: design the shape first)', () => {
    expect(parts.some((x) => x.id.startsWith('sign-'))).toBe(false);
    const ps = buildModel({ ...defaults, showSideSigns: 1 });
    const sign = get(ps, 'sign-L');
    expect(sign.removable).toBe(true);
    expect(sign.joints!.find((j) => j.type === 'knob')!.count).toBe(4);
    expect(get(ps, 'side-L-web').joints!.find((j) => j.type === 'threaded-insert' && j.to === 'sign-L')!.count).toBe(4);
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
      expect(rail.max[1] - rail.min[1]).toBeCloseTo(defaults.railThicknessIn, 9);
      expect(rail.max[2]).toBeCloseTo(chine.min[2], 9); // the chine bears on the rail top
      expect(rail.max[2]).toBeCloseTo(L.deckBot, 9);
      expect(rail.max[2] - rail.min[2]).toBeCloseTo(defaults.railDepthIn, 9);
      expect(rail.min[0]).toBeCloseTo(-9.25, 6); // rear transom inner face
      expect(rail.max[0]).toBeCloseTo(L.xFlatEnd, 6); // the end of the flat deck
    }
    expect(L.railTop).toBeCloseTo(L.deckBot, 9);
  });
  it('the chine is Domino-tied to the rail every 6 in with vertical Dominos', () => {
    const chine = get(parts, 'side-L-chine');
    const tie = chine.joints!.find((j) => j.to === 'rail-L')!;
    expect(tie.type).toBe('domino');
    expect(tie.count).toBe(Math.floor((L.xFlatEnd - (-9.25)) / defaults.chineTieSpacingIn)); // 58.36 / 6 = 9
    expect(tie.count).toBe(9);
    expect(tie.size).toMatch(/DF 500/);
    expect(tie.note).toMatch(/VERTICAL/);
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
  it('the slot sits above the box lid: the box top (15 in) + 1/4 in, with at least the minimum oak bar left above it under the 24 in transom corners', () => {
    const r = liftSlot(ctx);
    expect(r.zBot).toBeCloseTo(ctx.L.storage.zTop + 0.25, 9);
    expect(r.zTop).toBeCloseTo(r.zBot + 1.25, 9);
    expect(r.zTop + defaults.liftBarMinIn).toBeLessThanOrEqual(r.transomTop + 1e-9);
    expect(r.transomTop).toBeCloseTo(8 + 16, 9); // the transom corners are as tall as the rear side; the crown arcs above them
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

describe('signs (D-9, D-35; provisional, off by default in D-54)', () => {
  const parts = buildModel({ ...defaults, showSideSigns: 1 });
  it('two removable 6 mm blanks, banded on all edges, with four knob screws each, on the outside of the sloped side and turned to its slope', () => {
    const { L } = makeCtx(defaults);
    for (const tag of ['L', 'R']) {
      const s = get(parts, `sign-${tag}`);
      expect(s.removable).toBe(true);
      expect(s.edges).toBe('edged');
      expect(s.geometry.type === 'box' && s.geometry.size[1]).toBeCloseTo(defaults.panelPlyIn, 9);
      expect(s.group).toBe('removable');
      expect(s.notes).toMatch(/banded/);
      // It hangs just outside the outer face of the side members (|y| from 12 in out), centered in the web's height band at mid-length, and turned to the 10.5 degree slope.
      const c = transformPoint(s.transform, [0, 0, 0]);
      expect(Math.abs(c[1])).toBeCloseTo(L.hwC + L.side + defaults.panelPlyIn / 2, 6);
      expect(c[2]).toBeGreaterThan(L.web.z0);
      expect(c[2]).toBeLessThan(8 + 16 - defaults.railBandIn);
      expect(s.transform[2]).toBeCloseTo(-Math.sin(Math.atan2(12, L.xSideEnd - L.xSideStart)), 6); // its length axis descends toward the bow with the gunwale
    }
    expect(buildModel({ ...defaults, showSideSigns: 1 }, { removed: true }).some((x) => x.id.startsWith('sign-'))).toBe(false);
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
  it('the body and frame groups stay near the D-54 build numbers (body about 39 lb, frame about 13 lb; pinned from the build)', () => {
    const parts = buildModel(defaults);
    const sum = (g: string) => parts.filter((x) => x.group === g && !x.payload).reduce((m, x) => m + x.massLb, 0);
    // Hand: deck 58.6 x 23.25 x 0.472 in of ply (about 14 lb with finish), the 24 in x 31 in rear transom (9.2 lb), two webs (3.1 lb each), two chines
    // (1.4), two gunwales (1.6), the curl (2.4), backers and scuppers (1.1): about 39 lb.
    expect(Math.abs(sum('body') - 39)).toBeLessThan(1.5);
    // Rails 2 x 3.5 (extrusions with the step), hangers 2 x 1.05, six joists (0.82 to 0.88; the king beam is in the front-end group): about 13 lb.
    expect(Math.abs(sum('frame') - 13)).toBeLessThan(1);
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
    expect(get(parts, 'side-L-chine').joints!.find((j) => j.to === 'side-L-web')!.size).toMatch(/0\.276/);
  });

  it('rough length gets 4× the milling allowance (M8): the straight 64.53" chine is 65.03" rough, 1/8" more each way in t and w', () => {
    const c = get(parts, 'side-L-chine');
    expect(c.stock!.l).toBeCloseTo(L.xSideEnd - L.xSideStart, 6);
    expect(c.rough!.l).toBeCloseTo(c.stock!.l + 0.5, 6);
    expect(c.rough!.t).toBeCloseTo(0.75, 6);
    for (const x of parts.filter((q) => q.rough && q.stock && (q.group === 'body' || q.group === 'frame'))) expect(x.rough!.l - x.stock!.l, x.id).toBeCloseTo(4 * p.millingAllowanceIn, 6);
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

  it('scuppers: four 3/8" stainless nipples through the chines at deck level (M7; the rear corners and just behind the bow curl), each with a joint and `at`', () => {
    const sc = parts.filter((x) => x.id.startsWith('scupper-'));
    expect(sc.map((x) => x.id).sort()).toEqual(['scupper-bow-L', 'scupper-bow-R', 'scupper-rear-L', 'scupper-rear-R']);
    const sites = scupperSites(ctx);
    expect(sites.map((s) => s.zone)).toEqual(['rear', 'bow']);
    expect(sites[0].x).toBeCloseTo(-9.25 + 0.5 * 0.75, 6); // inside the rear transom, 3/8 in in
    expect(sites[1].x).toBeCloseTo(L.xFlatEnd - 1, 6); // 1 in behind the end of the flat deck
    for (const x of sc) {
      expect(x.joints![0].at).toHaveLength(1);
      expect(x.sourcing?.vendor).toMatch(/stainless/i);
      const bb = worldAABB(x);
      // lower edge of the hole 0.05" over the deck surface
      expect(bb.min[2]).toBeCloseTo(L.deckTop + 0.05, 3);
      // through the whole 5/8" chine and 1/4" proud outside
      expect(Math.abs(x.id.endsWith('L') ? bb.min[1] : bb.max[1])).toBeCloseTo(L.hwC, 6);
      expect(Math.abs(x.id.endsWith('L') ? bb.max[1] : bb.min[1])).toBeCloseTo(L.hwC + L.side + 0.25, 6);
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

  it('assembly order is data (M4, D-45): deck 4 < sides 4.2 < transom 4.4, and every closed dado is vented', () => {
    const st = (id: string) => get(parts, id).step;
    expect(st('deck')).toBe(HULL_STEP.deck);
    expect(st('side-L-web')).toBe(HULL_STEP.sides);
    expect(st('side-L-chine')).toBe(HULL_STEP.sides);
    expect(st('bow-curl')).toBe(HULL_STEP.sides);
    expect(st('transom-rear')).toBe(HULL_STEP.transom);
    expect(HULL_STEP.deck < HULL_STEP.sides && HULL_STEP.sides < HULL_STEP.transom).toBe(true);
    expect(get(parts, 'transom-rear').notes).toMatch(/GOES ON LAST/);
    expect(get(parts, 'side-L-web').notes).toMatch(/hydraulic lock/);
    for (const j of get(parts, 'transom-rear').joints!.filter((q) => q.type === 'dado')) expect(j.size, j.to).toMatch(/vent/);
  });

  it('no joint says "CNC blind tenon": thin members get a loose tenon (S2)', () => {
    for (const x of parts) for (const j of x.joints ?? []) if (x.group === 'body' || x.group === 'frame') expect(j.size ?? '', `${x.id}->${j.to}`).not.toMatch(/CNC blind/i);
    const lt = parts.flatMap((x) => (x.group === 'body' || x.group === 'frame' ? x.joints ?? [] : [])).filter((j) => j.type === 'mortise-tenon');
    expect(lt.length).toBeGreaterThan(0);
    for (const j of lt) expect(j.size).toMatch(/loose tenon/);
  });

  it('10" joists: five evenly spaced crossmembers (bays under 10 in) from the rear transom to the king beam (D-56), the king beam itself at the kingpin, and an end joist under the scarf of the deck to the bow curl', () => {
    expect(L.joistX).toHaveLength(7);
    expect(p.crossmemberSpacingIn).toBe(10);
    // Even spacing from the rear transom face (-9.25) to the king beam's rear face (44 - 3/2 = 42.5): 51.75 in / 6 bays = 8.625 in.
    const even = L.joistX.slice(0, 5);
    for (let i = 0; i < 5; i++) expect(even[i]).toBeCloseTo(-9.25 + (51.75 * (i + 1)) / 6, 6);
    expect(L.joistX[5]).toBe(L.king.x);
    expect(L.joistX[6]).toBeCloseTo(L.xFlatEnd - L.joistT / 2 - 0.05, 9);
    expect(joistId(L, 5)).toBe('king-beam');
    expect([0, 1, 2, 3, 4, 6].map((i) => joistId(L, i))).toEqual(['joist-1', 'joist-2', 'joist-3', 'joist-4', 'joist-5', 'joist-7']);
    for (let i = 0; i < L.joistX.length; i++) expect(parts.some((x) => x.id === joistId(L, i)), joistId(L, i)).toBe(true);
    const edges = [L.xRear + L.transom, ...L.joistX.flatMap((x) => [x - (x === L.king.x ? L.king.len : L.joistT) / 2, x + (x === L.king.x ? L.king.len : L.joistT) / 2]), L.xFlatEnd];
    let bay = 0;
    for (let i = 0; i + 1 < edges.length; i += 2) bay = Math.max(bay, edges[i + 1] - edges[i]);
    expect(bay).toBeLessThan(10);
    expect(bay).toBeGreaterThan(7); // 8.0 between the joists; the long bay is the 5.8 in from the king beam to the end joist, 7.1 at the rear
    expect(get(parts, 'joist-7').notes).toMatch(/steering stop blocks hang under its ends/);
  });
});
