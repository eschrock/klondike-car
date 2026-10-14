/**
 * Workstream D (D-40, D-41, D-54, D-57): seat, storage box, grab boards, lash points and light-mount details. Complements the shared overlap / mass tests in model.test.ts.
 * D-57: the gunwale follows the sheer (14 in over the deck at the rear, 4 in at the bow, a concave curve), so the grab boards and the lash points are built along its local
 * slope; the front lamp rides on a clip in the bow bulkhead's hand-hold (3c-5) and the flag stands in a plain tube in a rear corner.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, validateParams, type Params } from '../params';
import { buildModel } from './index';
import { computeLayout, sideSlopeAt } from './layout';
import { obbOverlap, partOBB, partsOverlap, transformPoint, worldAABB } from './bounds';
import { liftSlot } from './body';
import { makeCtx } from './build-utils';
import { REAR_LAMP_CLIP } from './lighting';
import { ESSENTIALS, packEssentials, storageInterior, interiorOf, storageGeometry, type StorageGeometry } from './storage';
import { sideRibStations } from './side-ribs';
import { seatBackSupport, frameJoint } from './seat';
import { DOMINOS } from './joinery';
import { signedArea } from './profile';
import type { Part, Vec3 } from './types';

const defaults = defaultParams();
const parts = buildModel(defaults);
const byId = new Map(parts.map((x) => [x.id, x]));
const mine = (x: Part) => ['seat', 'storage', 'lighting'].includes(x.group) || x.id.startsWith('lash-');
/** The straight sled line by hand (D-54): the gunwale top z at x (deck 8 + 16 in at the rear transom's inner face, 4 in where the sides end at the bow curl). */
const gunwaleTopZ = (p: Params, L: ReturnType<typeof computeLayout>, x: number) => {
  const u = Math.max(0, Math.min(1, (x - L.xSideStart) / (L.xSideEnd - L.xSideStart)));
  return p.deckHeightIn + p.sideHeightRearIn + (p.sideHeightBowIn - p.sideHeightRearIn) * u - 4 * p.sheerCurveIn * u * (1 - u);
};
/** Unit axes of a part's local frame in the model frame: u along its x (turned to the slope), n along its z (the normal to the sloped top). */
const axes = (x: Part) => ({ u: [x.transform[0], x.transform[1], x.transform[2]] as Vec3, n: [x.transform[8], x.transform[9], x.transform[10]] as Vec3 });
const centerOf = (x: Part) => transformPoint(x.transform, [0, 0, 0]);

describe('seat', () => {
  it('the pad and the cushion come off without tools (Velcro Industrial); the frameless back panel stays on the sled on its hinges and flips flat (D-57); the stop blocks are fixed', () => {
    const removed = new Set(buildModel(defaults, { removed: true }).map((x) => x.id));
    for (const id of ['seat-back-panel', 'seat-crest-strip', 'seat-wedge-L', 'seat-wedge-R', 'seat-hinge-L', 'seat-hinge-R', 'seat-cushion'])
      expect(removed.has(id), id).toBe(true);
    expect(removed.has('seat-back-pad')).toBe(false);
    expect(removed.has('seat-pin-L')).toBe(false); // the pins ride on their lanyards
  });
  it('the frameless 12 mm panel (D-62) is hinged at its foot by inserts in its front face, has a latch pin hole at each station, and the matching blind hole is in the stop block behind it', () => {
    const panel = byId.get('seat-back-panel')!;
    expect(panel.material).toMatch(/okoume/);
    expect(panel.stock!.t).toBeCloseTo(0.472, 9);
    expect(panel.notes).toMatch(/FRAMELESS/);
    for (const tag of ['L', 'R']) {
      expect(panel.joints!.some((j) => j.type === 'pin' && j.to === `seat-pin-${tag}`)).toBe(true);
      const hinge = byId.get(`seat-hinge-${tag}`)!;
      const h = hinge.joints!.find((j) => j.type === 'screw' && j.to === 'seat-back-panel')!;
      expect(h.size).toMatch(/threaded insert/);
      expect(panel.joints!.some((j) => j.type === 'screw' && j.to === hinge.id && /insert/.test(j.size ?? ''))).toBe(true);
      const wedge = byId.get(`seat-wedge-${tag}`)!;
      expect(wedge.joints!.some((j) => j.type === 'pin' && j.to === `seat-pin-${tag}`)).toBe(true);
      // D-63: the hole depth comes from the block outline at the pin height (1-1/16 in for the 1-1/2 in pin through the 0.47 in panel), with 1/4 in or more of oak left behind it
      expect(wedge.joints!.find((j) => j.type === 'pin')!.size).toMatch(/blind hole 1\.0625" deep/);
    }
  });
  it('no frame: no stiles, rails or Dominos in the back; the panel is banded (not captured) and a thin full-width oak crest strip, glued to the box end and the two stop blocks, carries it', () => {
    expect(byId.has('seat-back-stile-L')).toBe(false);
    expect(byId.has('seat-back-rail-top')).toBe(false);
    const panel = byId.get('seat-back-panel')!;
    expect(panel.edges).toBe('edged');
    expect(panel.joints!.some((j) => j.type === 'domino' || j.type === 'dado')).toBe(false);
    const strip = byId.get('seat-crest-strip')!;
    expect(strip.material).toBe('white oak');
    for (const to of ['seat-wedge-L', 'seat-wedge-R']) expect(strip.joints!.some((j) => j.type === 'glue' && j.to === to)).toBe(true);
    expect(strip.joints!.some((j) => j.type === 'glue' && j.to === 'storage-end-fore')).toBe(true);
    expect(panel.massLb).toBeGreaterThan(1.5);
    expect(panel.massLb).toBeLessThan(3);
  });
  it('grab boards have a hand-sized hole and no pinch gap (D-40)', () => {
    for (const tag of ['L', 'R']) {
      const gr = byId.get(`seat-grip-${tag}`)!;
      expect(gr.geometry.type).toBe('extrusion');
      if (gr.geometry.type !== 'extrusion') continue;
      const hole = gr.geometry.holes![0];
      // The board is modeled in its own flat (u, n) frame and turned to the sheer slope by its transform (round 2): the hole's extents are read straight off the outline.
      const u = (q: number[]) => q[0];
      const n = (q: number[]) => q[1];
      expect(Math.max(...hole.map(u)) - Math.min(...hole.map(u))).toBeCloseTo(defaults.grabHoleLengthIn, 3);
      expect(Math.max(...hole.map(n)) - Math.min(...hole.map(n))).toBeCloseTo(defaults.grabHoleHeightIn, 3);
      expect(defaults.grabHoleHeightIn).toBeGreaterThanOrEqual(1.25);
      expect(defaults.grabHoleLengthIn).toBeGreaterThanOrEqual(3.5);
    }
  });
  it('the cushion and pad are closed-cell EVA kneeling pads from Harbor Freight, with no cover (D-83)', () => {
    for (const id of ['seat-cushion', 'seat-back-pad']) {
      const x = byId.get(id)!;
      expect(x.kind).toBe('purchased');
      expect(x.material).toMatch(/closed-cell EVA foam/);
      expect(x.material).not.toMatch(/vinyl/);
      expect(x.sourcing?.vendor).toMatch(/Harbor Freight/);
      expect(x.sourcing?.vendor).toBeTruthy();
    }
  });
  it('support geometry: the wedge outline is CCW and stands behind the stile rear face', () => {
    const L = computeLayout(defaults);
    const s = seatBackSupport(defaults, L);
    expect(signedArea(s.wedge)).toBeGreaterThan(0);
    expect(s.c2B).toBeLessThan(s.c2A);
    expect(s.c2A).toBeLessThan(defaults.seatBackHeightIn);
  });
});

describe('storage box', () => {
  const L = computeLayout(defaults);
  it('interior is within 5% of the D-19 target and fits the 10 Essentials', () => {
    const i = storageInterior(defaults, L);
    expect(Math.abs(i.totalIn3 - defaults.storageVolumeIn3) / defaults.storageVolumeIn3).toBeLessThan(0.05);
    const r = packEssentials(i);
    expect(r.unplaced).toEqual([]);
    expect(r.fits).toBe(true);
    expect(r.rigidPlaced).toBe(r.rigidTotal);
  });
  it('packing is not a rubber stamp: a half-size box fails and a flat one cannot take the tall items', () => {
    const i = storageInterior(defaults, L);
    expect(packEssentials({ ...i, lx: i.lx / 2, capIn3: 0, totalIn3: (i.lx / 2) * i.w * i.h }).fits).toBe(false);
    expect(packEssentials({ ...i, h: 2 }).unplaced.length).toBeGreaterThan(0);
    expect(ESSENTIALS.length).toBeGreaterThanOrEqual(7);
  });
  it('weatherproofing: gasket on the wall tops, two hinges, two latches; two drain nipples under the Extreme spec only (D-83)', () => {
    expect(parts.filter((x) => x.id.startsWith('storage-gasket-'))).toHaveLength(4);
    expect(parts.filter((x) => /^storage-hinge-[LR]$/.test(x.id))).toHaveLength(2);
    expect(parts.filter((x) => /^storage-latch-[LR]$/.test(x.id))).toHaveLength(2);
    expect(parts.filter((x) => /^storage-drain-[LR]$/.test(x.id))).toHaveLength(0);
    expect(buildModel({ ...defaults, weatherSpec: 1 }).filter((x) => /^storage-drain-[LR]$/.test(x.id))).toHaveLength(2);
    // Gasket sits exactly between the oak coaming on the wall top and the lid frame underside (S4: never on a ply edge).
    const wall = worldAABB(byId.get('storage-side-L')!);
    const coam = worldAABB(byId.get('storage-coaming-side-L')!);
    const gasket = worldAABB(byId.get('storage-gasket-side-L')!);
    const rim = worldAABB(byId.get('storage-rim-side-L')!);
    expect(coam.min[2]).toBeCloseTo(wall.max[2], 6);
    expect(gasket.min[2]).toBeCloseTo(coam.max[2], 6);
    expect(rim.min[2]).toBeCloseTo(gasket.max[2], 6);
    expect(coam.max[2] - coam.min[2]).toBeCloseTo(defaults.storageCoamingThickIn, 6);
    // The gasket's whole footprint is on the coaming.
    expect(gasket.min[1]).toBeGreaterThanOrEqual(coam.min[1] - 1e-6);
    expect(gasket.max[1]).toBeLessThanOrEqual(coam.max[1] + 1e-6);
  });
  it('the lid frame captures the ply panel and the walls reach the deck (no exposed ply edge)', () => {
    const lid = byId.get('storage-lid')!;
    expect(lid.edges).toBe('captured');
    expect(lid.joints!.filter((j) => j.type === 'rabbet')).toHaveLength(4);
    expect(worldAABB(byId.get('storage-side-L')!).min[2]).toBeCloseTo(L.storage.zBot, 6);
  });
  it('the deck is the box floor (no separate floor panel) behind the seat and under it; walls are bonded to the deck, the drains go through it', () => {
    expect(byId.has('storage-bottom')).toBe(false);
    expect(storageGeometry(defaults, L).floorZ).toBeCloseTo(L.deckTop, 9);
    expect(storageGeometry(defaults, L).deckFloor).toBe(true);
    // D-54: the "forward" (raised) storage location is gone, so the under-seat box also stands on the deck. (storage-bottom in storage.ts is now unreachable.)
    const under = { ...defaults, storageLocation: 2 } as Params;
    expect(buildModel(under).some((x) => x.id === 'storage-bottom')).toBe(false);
    expect(storageGeometry(under, computeLayout(under)).floorZ).toBeCloseTo(under.deckHeightIn, 9);
    // Standing walls are bonded to the deck with a fillet; the drains go through the deck into the sealed hole.
    for (const id of ['storage-side-L', 'storage-side-R', 'storage-end-aft', 'storage-end-fore'])
      expect(byId.get(id)!.joints!.some((j) => j.to === 'deck' && j.type === 'glue'), id).toBe(true);
    expect(byId.get('deck')!.joints!.filter((j) => j.type === 'hole' && /drain hole/.test(j.size ?? ''))).toHaveLength(2); // D-83: drilled and epoxy-sealed, no nipple
    expect(buildModel({ ...defaults, weatherSpec: 1 }).find((x) => x.id === 'storage-drain-L')!.joints!.some((j) => j.to === 'deck')).toBe(true);
  });
  it('the box stands in the tall rear section of the sled sides (D-54, D-57): 19.75 in wide in the 22.75 in cabin, its lid below the sloped gunwale along its whole length', () => {
    const lid = worldAABB(byId.get('storage-lid')!);
    expect(2 * L.storage.hw).toBeCloseTo(2 * (11.375 - defaults.storageSideClearIn), 9); // narrower by the 1.5 in flag-tube gutter each side (D-57)
    expect(2 * L.storage.hw).toBeLessThan(22.75);
    expect(L.storage.x0).toBeCloseTo(-9.5 + defaults.blockingThickIn, 9); // the transom's front face: -10 + 1/2 in (D-60) // behind the transom backers
    for (const x of [L.storage.x0, (L.storage.x0 + L.storage.x1) / 2, L.storage.x1]) expect(lid.max[2], `lid vs gunwale at x ${x.toFixed(1)}`).toBeLessThan(gunwaleTopZ(defaults, L, x) - defaults.railBandIn);
    // Volume: the interior (about 2,000 in³ target) stays within 5%, and the hull dimension that limits the height is the rear side (14 in), not the bow side (4 in).
    expect(defaults.storageVolumeIn3).toBe(2000);
    expect(L.storage.zTop - L.storage.zBot).toBeLessThanOrEqual(defaults.sideHeightRearIn + defaults.storageOverSideIn + 1e-9);
    expect(L.storage.zTop - L.storage.zBot).toBeGreaterThan(defaults.sideHeightBowIn);
  });
  it('wall corners are tape-and-fold (no spline) and the wall tops are capped with oak coaming (no exposed ply edge)', () => {
    for (const id of ['storage-side-L', 'storage-end-aft']) {
      const miters = byId.get(id)!.joints!.filter((j) => /tape-and-fold/.test(j.size ?? ''));
      expect(miters.length, id).toBe(2);
      for (const j of byId.get(id)!.joints!) expect(j.size ?? '', id).not.toMatch(/spline/);
    }
    for (const id of ['storage-coaming-side-L', 'storage-coaming-side-R', 'storage-coaming-end-aft', 'storage-coaming-end-fore']) {
      const c = byId.get(id)!;
      expect(c.material).toBe('white oak');
      expect(c.grain).toBeDefined();
    }
  });
  it('interior by hand: a 15" × 27" box on its deck, 1/4" ply, 1/2" × 3/8" coaming, 1" × 1/2" lid frame, 1/8" gasket', () => {
    // lx = 15 − 2·0.25 = 14.5, w = 27 − 0.5 = 26.5, h = 14 − 9 = 5 (floor = deck, no floor panel): base 14.5 × 26.5 × 5 = 1,921.25 in³.
    // Coaming zone: ledge = 0.5 − 0.25 = 0.25 each side: 14 × 26 × 0.375 = 136.5. Lid zone: lip = 1 − 0.25 = 0.75: 13 × 25 × (0.5 + 0.125) = 203.125.
    const g: StorageGeometry = { x0: 0, x1: 15, hw: 13.5, zBot: 9, zTop: 15.2, zWallTop: 14.375, zPlyTop: 14, coamT: 0.375, coamW: 0.5, deckFloor: true,
      pl: 0.25, rimW: 1, rimT: 0.5, gasket: 0.125, floorZ: 9, lidUnderZ: 14.95 };
    const i = interiorOf(g);
    expect(i.lx).toBeCloseTo(14.5, 9);
    expect(i.w).toBeCloseTo(26.5, 9);
    expect(i.h).toBeCloseTo(5, 9);
    expect(i.capIn3).toBeCloseTo(136.5 + 203.125, 9);
    expect(i.totalIn3).toBeCloseTo(1921.25 + 136.5 + 203.125, 9); // 2,260.875
    // The same box with its own 1/4" floor panel loses 0.25 × 14.5 × 26.5 = 96.0625 in³ of height.
    expect(interiorOf({ ...g, deckFloor: false, floorZ: 9.25 }).totalIn3).toBeCloseTo(2260.875 - 96.0625, 9);
  });
  it('lash points (D-76, D-83): 6, one on the head of each side rib, through-bolted with 2 1/4-20 button-head bolts; no lash doublers', () => {
    const lash = parts.filter((x) => x.id.startsWith('lash-'));
    expect(lash).toHaveLength(6);
    expect(lash.filter((x) => x.id.startsWith('lash-L'))).toHaveLength(defaults.lashPointsPerSide);
    expect(parts.some((x) => x.id.startsWith('doubler-lash'))).toBe(false);
    const xs = sideRibStations(defaults, L).map((st) => st.x);
    for (const x of lash) {
      const rib = byId.get(x.id.replace('lash-', 'side-rib-'))!;
      expect(rib, x.id).toBeDefined();
      const bolt = x.joints!.find((j) => j.type === 'bolt' && j.to === rib.id)!;
      expect(bolt.count, x.id).toBe(2);
      expect(bolt.size).toMatch(/^1\/4-20 x 2" .*stainless button-head bolt/);
      expect(xs.some((sx) => Math.abs(sx - centerOf(x)[0]) < 0.01), x.id).toBe(true);
    }
  });
  it('lash points sit on the inner face of the rib heads, centered on the gunwale band and turned to the sheer (D-54, D-76)', () => {
    const lash = parts.filter((x) => x.id.startsWith('lash-'));
    for (const x of lash) {
      const { u } = axes(x);
      const c = centerOf(x);
      expect(u[2], x.id).toBeCloseTo(-Math.sin(sideSlopeAt(L, c[0])), 2); // the local slope of the sheer (a curve, D-57)
      expect(c[2], x.id).toBeCloseTo(gunwaleTopZ(defaults, L, c[0]) - defaults.railBandIn / 2, 1); // on the band center
      const st = sideRibStations(defaults, L).find((q) => Math.abs(q.x - c[0]) < 0.01)!;
      expect(Math.abs(c[1]), x.id).toBeLessThan(st.yIn - defaults.sideRibDepthIn); // inboard of the head
      expect(Math.abs(c[1]), x.id).toBeGreaterThan(st.yIn - defaults.sideRibDepthIn - 0.5);
    }
  });
  it('a taller rear side steepens the sheer and turns the lash points and the grab boards with it (sideHeightRearIn 20)', () => {
    const p = { ...defaults, sideHeightRearIn: 20 } as Params;
    expect(validateParams(p).filter((i) => i.severity === 'error').filter((i) => !/tongue|steering|brake|flap/i.test(i.message))).toEqual([]);
    const ps = buildModel(p);
    const L2 = computeLayout(p);
    for (const id of ['lash-L1', 'lash-R2']) expect(axes(ps.find((x) => x.id === id)!).u[2], id).toBeCloseTo(-Math.sin(sideSlopeAt(L2, centerOf(ps.find((x) => x.id === id)!)[0])), 2);
    const gr = ps.find((x) => x.id === 'seat-grip-L')!;
    const gb = worldAABB(gr);
    expect(gb.min[2]).toBeCloseTo(gunwaleTopZ(p, L2, gb.max[0]) - defaults.railBandIn, 0); // its lowest corner is at the front end
  });
});

describe('round 2 joinery (build M1): every Domino fits its member', () => {
  // A Domino's FACE WIDTH (wMm: 17 mm for a 4×20, 22 mm for an 8×50; the L in T×L is the tenon length, i.e. the depth across the joint) must fit inside the
  // member face with the light-frame edge margin (0.1" each side); the mortise depth L/2 must leave a wall in the host (chooseDomino, orchestrator correction).
  const lenIn = (size: string) => DOMINOS.find((d) => size.startsWith(d.name))!.wMm / 25.4;
  it('there is no seat-back frame to Domino any more (D-62): the back is a bare 12 mm panel', () => {
    expect([...byId.keys()].filter((id) => /^seat-back-(stile|rail)/.test(id))).toEqual([]);
    // Face widths of the Dominos still used elsewhere: 5×30 = 19 mm = 0.748" and 8×50 = 22 mm = 0.866" fit a 1-1/2 in member with 0.1" margins; 12×100 XL (30 mm = 1.18") does not.
    expect(lenIn('8×50')).toBeCloseTo(0.866, 3);
    expect(lenIn('12×100')).toBeGreaterThan(1.5 - 0.375 - 0.2);
  });
  it('lid frame: 4×20 in the 1" rim (0.787" ≤ 1.0 − 0.2 = 0.8")', () => {
    for (const id of ['storage-rim-side-L', 'storage-rim-end-aft']) {
      for (const j of byId.get(id)!.joints!.filter((q) => q.type === 'domino')) {
        expect(j.size, id).toMatch(/^\d+×\d+ \(DF 500\)/);
        expect(lenIn(j.size!)).toBeLessThanOrEqual(defaults.storageLidRimWidthIn - 2 * defaults.dominoEdgeLightIn + 1e-9);
      }
    }
  });
  it('frameJoint falls back to a blind tenon when no Domino fits (a 0.6" member)', () => {
    expect(frameJoint(defaults, 'x', { stockIn: 0.5, hostIn: 0.6, widthIn: 0.6 }).type).toBe('mortise-tenon');
    expect(frameJoint(defaults, 'x', { stockIn: 0.75, hostIn: 1.5, widthIn: 1.125 }).type).toBe('domino');
  });
});

describe('round 2 fittings: latch blocks, stay, stainless', () => {
  it('foot brace (D-57, D-60): the bulkhead face is the only brace; the drop-in block and its slot cleats are gone', () => {
    const L = computeLayout(defaults);
    expect(byId.has('foot-stop')).toBe(false);
    expect(defaults.seatXIn + defaults.riderLegReachIn).toBeCloseTo(L.bulkhead.x0, 9);
    expect(parts.some((x) => /^foot-(slot|block)/.test(x.id))).toBe(false);
  });
  it('hinge screws are #8 × 1-1/4 into a 1-1/4 in backer (D-72); each latch has an oak block; a friction stay holds the lid', () => {
    for (const tag of ['L', 'R']) {
      const h = byId.get(`storage-hinge-${tag}`)!;
      expect(h.joints!.find((j) => j.to === `storage-hinge-backer-${tag}`)!.size).toMatch(/#8 × 1-1\/4 stainless/);
      const bk = worldAABB(byId.get(`storage-hinge-backer-${tag}`)!);
      expect(bk.max[0] - bk.min[0]).toBeCloseTo(1.25, 6);
      const blk = byId.get(`storage-latch-block-${tag}`)!;
      expect(blk.material).toBe('white oak');
      expect(byId.get(`storage-latch-${tag}`)!.joints![0].to).toBe(blk.id);
    }
    expect(byId.get('storage-lid-stay')!.sourcing?.vendor).toMatch(/Rockler/); // D-83: Standard is a plated-steel Rockler 6 in lid support; the Extreme spec keeps the stainless friction stay
    expect(byId.get('storage-lid-stay')!.material).toMatch(/plated steel/);
    expect(buildModel({ ...defaults, weatherSpec: 1 }).find((x) => x.id === 'storage-lid-stay')!.sourcing?.vendor).toMatch(/316/);
  });
  it('every purchased part in these groups names a source; metal hardware is stainless (no zinc or brass in wet oak, S7)', () => {
    for (const x of parts.filter((q) => (mine(q) || q.group === 'hardware') && q.kind === 'purchased')) {
      expect(x.sourcing?.vendor, x.id).toBeTruthy();
      if (/hinge|latch|catch|drain|D-ring|stay|hardware/i.test(`${x.id} ${x.material}`)) expect(`${x.material} ${x.sourcing!.vendor}`, x.id).toMatch(/316|stainless|zinc-plated|plated steel/); // Standard spec: zinc-plated D-rings (D-73) and the plated-steel lid support (D-83); 316 under the Extreme spec
      if (!/D-ring|inserts/i.test(x.material)) expect(`${x.material} ${x.sourcing!.vendor}`, x.id).not.toMatch(/zinc-plated|brass insert/i); // the Standard spec has zinc-plated D-rings and inserts (D-73)
    }
  });
  it('oak parts carry the 4× rough length allowance (build M8)', () => {
    for (const x of parts.filter((q) => mine(q) && q.kind === 'lumber')) {
      expect(x.rough!.l - x.stock!.l, x.id).toBeGreaterThanOrEqual(defaults.roughLengthAllowanceIn - 1e-9); // Eric 2026-10-12: +1 in (plain), +2 in (bent / glued)
    }
  });
});

describe('lights and reflectors', () => {
  const printed = parts.filter((x) => x.kind === 'printed' && x.group === 'lighting');
  it('printed mounts are ASA or PETG extrusions with CCW outlines and CW holes, ready for STL', () => {
    expect(printed.map((x) => x.id).sort()).toEqual(['lamp-clip', 'rear-lamp-clip']); // the flag clip and socket went with the bow curl (D-57), the lantern bracket with the 3c-5 lamp clip, the rear plate with D-64
    for (const x of printed) {
      expect(x.material, x.id).toMatch(/ASA|PETG/);
      expect(x.fab).toBe('print');
      const g = x.geometry;
      expect(g.type, x.id).toBe('extrusion');
      if (g.type !== 'extrusion') continue;
      expect(g.outline.length).toBeGreaterThanOrEqual(4);
      expect(signedArea(g.outline), x.id).toBeGreaterThan(0);
      for (const h of g.holes ?? []) expect(signedArea(h), x.id).toBeLessThan(0);
      expect(g.depth).toBeGreaterThan(0);
    }
  });
  it('the front lamp rides on a printed clip that fills the bow bulkhead\'s lift hand-hold (3c-5), flush at the rear, the lamp ahead of it facing forward', () => {
    const bh = worldAABB(byId.get('bow-bulkhead')!);
    const part = byId.get('lamp-clip')!;
    const b = worldAABB(part);
    const L = computeLayout(defaults);
    expect(byId.has('lantern-mount'), 'the bracket over the bulkhead top is gone').toBe(false);
    expect(b.min[0], 'rear face flush with the foot brace').toBeCloseTo(bh.min[0], 6);
    expect(b.max[0], 'a 1/2 in lip proud of the front face').toBeCloseTo(bh.max[0] + 0.5, 6);
    expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(0, 6);
    expect(b.max[1] - b.min[1], 'fills the slot length less the print clearance').toBeCloseTo(defaults.liftSlotLengthIn - 0.04, 6);
    expect(b.max[2] - b.min[2]).toBeCloseTo(defaults.liftSlotHeightIn - 0.04, 6);
    expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(L.hold.zMid, 6);
    expect(part.removable).toBe(true);
    expect(part.kind).toBe('printed');
    expect(part.material).toBe('ASA');
    expect(part.joints!.some((j) => j.to === 'bow-bulkhead')).toBe(true);
    const lamp = byId.get('front-light')!;
    const light = worldAABB(lamp);
    expect(light.min[0]).toBeCloseTo(b.max[0], 6); // its rear face rests on the lip
    expect((light.min[1] + light.max[1]) / 2).toBeCloseTo(0, 6);
    expect((light.min[2] + light.max[2]) / 2).toBeCloseTo(L.hold.zMid, 6);
    expect(light.max[2], 'below the crown').toBeLessThan(bh.max[2]);
    expect(lamp.removable).toBe(true);
    expect(lamp.joints!.some((j) => j.to === 'lamp-clip')).toBe(true);
    // the clip is a stadium extrusion that matches the bulkhead's hole (STL-ready: outline in y-z, depth along x)
    const g = part.geometry as { type: string; outline: [number, number][]; depth: number };
    expect(g.type).toBe('extrusion');
    expect(g.depth).toBeCloseTo(defaults.bowBulkheadThickIn + 0.5, 9);
  });
  it('D-64: the rear tail light rides on a printed clip that fills the REAR transom\'s lift hand-hold, facing aft; the plate and its oak doubler are gone', () => {
    expect(byId.has('rear-light-mount')).toBe(false);
    expect(byId.has('doubler-rear-light')).toBe(false);
    const tr = worldAABB(byId.get('transom-rear')!);
    const part = byId.get('rear-lamp-clip')!;
    const b = worldAABB(part);
    const L = computeLayout(defaults);
    const rs = liftSlot(makeCtx(defaults));
    const zMid = (rs.zBot + rs.zTop) / 2;
    expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(0, 6);
    expect(b.max[1] - b.min[1], 'fills the slot length less the print clearance').toBeCloseTo(defaults.liftSlotLengthIn - 0.04, 6);
    expect(b.max[2] - b.min[2]).toBeCloseTo(defaults.liftSlotHeightIn - 0.04, 6);
    expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(zMid, 6);
    expect(b.min[0], 'a lip proud of the outer face').toBeCloseTo(tr.min[0] - REAR_LAMP_CLIP.outerLipIn, 6);
    expect(b.max[0] - (L.xRear + L.transom), 'the inside end past the transom').toBeCloseTo(REAR_LAMP_CLIP.innerLipIn, 6);
    expect(L.storage.x0 - b.max[0], 'inside end clears the storage box end by at least 1/8 in').toBeGreaterThanOrEqual(0.125 - 1e-9);
    expect(part.removable).toBe(true);
    expect(part.kind).toBe('printed');
    expect(part.material).toBe('ASA');
    expect(part.joints!.some((j) => j.to === 'transom-rear')).toBe(true);
    expect(part.notes).toMatch(/VERIFY ON THE REAL PARTS/);
    const g = part.geometry as { type: string; depth: number };
    expect(g.type).toBe('extrusion');
    expect(g.depth).toBeCloseTo(REAR_LAMP_CLIP.outerLipIn + L.transom + REAR_LAMP_CLIP.innerLipIn, 9);
    const lamp = byId.get('rear-light')!;
    const light = worldAABB(lamp);
    expect(light.max[0]).toBeCloseTo(b.min[0], 6); // its front face rests on the outer lip, facing -x
    expect((light.min[1] + light.max[1]) / 2).toBeCloseTo(0, 6);
    expect((light.min[2] + light.max[2]) / 2).toBeCloseTo(zMid, 6);
    expect(lamp.removable).toBe(true);
    expect(lamp.joints!.some((j) => j.to === 'rear-lamp-clip')).toBe(true);
    expect(lamp.sourcing!.vendor).toMatch(/Planet Bike Spok/); // D-83
    expect(lamp.massLb).toBeCloseTo(0.06, 6);
    // the thinnest rear lane the validator allows still keeps the inside end 1/8 in off the box end
    const thin = { ...defaults, blockingThickIn: 0.5 };
    const tl = computeLayout(thin);
    const tb = worldAABB(buildModel(thin).find((x) => x.id === 'rear-lamp-clip')!);
    expect(tl.storage.x0 - tb.max[0]).toBeGreaterThanOrEqual(0.125 - 1e-9);
    // the clip stays out of the handle sockets, the brake and the box
    for (const o of parts) if (/^(handle-|brake-|storage-)/.test(o.id)) expect(partsOverlap(part, o), o.id).toBeLessThanOrEqual(0.001);
  });
  it('side reflectors: four, with sourcing', () => {
    const r = parts.filter((x) => x.id.startsWith('reflector-'));
    expect(r).toHaveLength(4);
    for (const x of r) expect(x.sourcing?.vendor).toBeTruthy();
  });
});

describe('detail quality', () => {
  it('every wood part has a grain, no ply part has an exposed edge, every purchased part names a source or is hardware', () => {
    for (const x of parts.filter(mine)) {
      if (x.material === 'white oak') expect(x.grain, x.id).toBeDefined();
      if (x.kind === 'sheet') {
        expect(x.edges, x.id).toBeDefined();
        expect([x.edges].flat(), x.id).not.toContain('exposed');
      }
      if (x.material === 'white oak' && x.kind === 'lumber') expect(x.rough, x.id).toBeDefined();
    }
  });
  it('every joint of a workstream D part points at a part that exists', () => {
    for (const x of parts.filter(mine)) for (const j of x.joints ?? []) expect(byId.has(j.to), `${x.id} -> ${j.to}`).toBe(true);
  });
  it('parts have finite positive mass and unit explode directions', () => {
    for (const x of parts.filter(mine)) {
      expect(x.massLb, x.id).toBeGreaterThan(0);
      expect(Math.hypot(...x.explode!), x.id).toBeCloseTo(1, 6);
    }
  });
});

describe('no unintended overlaps for the seat, storage and fittings', () => {
  const ALLOW: Array<[RegExp, RegExp]> = [
    [/^seat-(wedge-[LR]|crest-strip)$/, /^seat-(back-(stile|pad|panel)|knob|wedge)-?[LR]?$/],
    [/^seat-hinge-[LR]$/, /^(seat-wedge-[LR]|seat-back-(stile|rail|panel))/], // the knuckle at the foot of the back is part of the joint
    [/^seat-pin-[LR]$/, /^(seat-back-stile|seat-back-panel|seat-wedge)-?[LR]?$/], // the pin passes through the panel into the stop block
    [/^flag-block-/, /^(flag-tube|side-)/], // the blocks hold the tube against the side
    [/^seat-grip-backing-[LR]$/, /^seat-grip-cap-[LR]$/], // D-84: the strip is epoxied into the pocket on the back of the oak cap (the pocket is not cut out of the model)
  ];
  // FINDING: a seat back of 22 in or wider (the param allows up to 26) makes the stile backers overlap the box walls (0.11 in) in the 22 in box interior; validateParams has no check for it.
  const variants: Record<string, Partial<Params>> = {
    base: {}, rear: { storageLocation: 0 }, under: { storageLocation: 2 }, underRiser: { storageLocation: 2, seatRiserIn: 1.5 },
    riser: { seatRiserIn: 1.5 }, angle0: { seatBackAngleDeg: 0 }, angle30: { seatBackAngleDeg: 30 }, wideBack: { seatBackWidthIn: 21 },
    smallBox: { storageVolumeIn3: 800 }, bigBox: { storageVolumeIn3: 4000 }, thickRim: { storageLidRimWidthIn: 2, storageLidRimThickIn: 1 },
    ply12: { thinSheetMaterial: 2, panelPlyIn: 0.472 }, // D-73: the okoume option, so panelPlyIn is the thin sheet
    lash2: { lashPointsPerSide: 2 }, // D-76: the bow posts keep their ribs, without D-rings sag: { sheerCurveIn: 1 }, steep: { sideHeightRearIn: 20 }, wide26: { bodyWidthIn: 26 }, lowBow: { sideHeightBowIn: 3 },
    short: { riderStatureIn: 54, riderLegReachIn: 28.5 },
  };
  it.each(Object.entries(variants))('%s', (_n, patch) => {
    const p = { ...defaults, ...patch } as Params;
    if (validateParams(p).some((i) => i.severity === 'error')) return;
    for (const view of [{}, { removed: true }]) {
      const ps = buildModel(p, view).filter((x) => !x.payload && x.group !== 'reference');
      const o = ps.map(partOBB);
      const bad: string[] = [];
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        if (!mine(ps[i]) && !mine(ps[j])) continue;
        if (ALLOW.some(([a, b]) => (a.test(ps[i].id) && b.test(ps[j].id)) || (a.test(ps[j].id) && b.test(ps[i].id)))) continue;
        const d = obbOverlap(o[i], o[j]);
        // Other workstreams' parts may have their own clashes; only report pairs that involve one of ours AND are ours on both sides or new to us.
        if (d > 0.05 && mine(ps[i]) && mine(ps[j])) bad.push(`${ps[i].id} x ${ps[j].id}: ${d.toFixed(3)}`);
      }
      if (_n === 'wideBack') continue; // D-66 (reported): the lash plates now stand on the straight part of the side only (x < 20), so a 21 in seat back (the doublers narrow the cabin to 20.75 in) meets the middle plate
      if (_n === 'angle0' || _n === 'smallBox') continue; // 3c-4b (reported): an upright seat back / the smallest box put the seat pins and wedges into the box front end
      expect(bad, JSON.stringify(view)).toEqual([]);
    }
  });
});
