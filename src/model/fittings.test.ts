/**
 * Workstream D (D-40, D-41, D-54, D-57): seat, storage box, grab boards, lash points and light-mount details. Complements the shared overlap / mass tests in model.test.ts.
 * D-57: the gunwale follows the sheer (14 in over the deck at the rear, 4 in at the bow, a concave curve), so the grab boards and the lash points are built along its local
 * slope; the front lamp rides on a clip in the bow bulkhead's hand-hold (3c-5) and the flag stands in a plain tube in a rear corner.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, validateParams, type Params } from '../params';
import { buildModel } from './index';
import { computeLayout, sideSlopeAt } from './layout';
import { obbOverlap, partOBB, transformPoint, worldAABB } from './bounds';
import { ESSENTIALS, packEssentials, storageInterior, lashPositions, interiorOf, storageGeometry, type StorageGeometry } from './storage';
import { seatBackSupport, frameJoint } from './seat';
import { DOMINOS } from './joinery';
import { signedArea } from './profile';
import type { Part, Vec3 } from './types';

const defaults = defaultParams();
const parts = buildModel(defaults);
const byId = new Map(parts.map((x) => [x.id, x]));
const mine = (x: Part) => ['seat', 'storage', 'lighting'].includes(x.group) || x.id.startsWith('lash-');
const L0 = computeLayout(defaults);
/** The straight sled line by hand (D-54): the gunwale top z at x (deck 8 + 16 in at the rear transom's inner face, 4 in where the sides end at the bow curl). */
const gunwaleTopZ = (p: Params, L: ReturnType<typeof computeLayout>, x: number) => {
  const u = Math.max(0, Math.min(1, (x - L.xSideStart) / (L.xSideEnd - L.xSideStart)));
  return p.deckHeightIn + p.sideHeightRearIn + (p.sideHeightBowIn - p.sideHeightRearIn) * u - 4 * p.sheerCurveIn * u * (1 - u);
};
/** Unit axes of a part's local frame in the model frame: u along its x (turned to the slope), n along its z (the normal to the sloped top). */
const axes = (x: Part) => ({ u: [x.transform[0], x.transform[1], x.transform[2]] as Vec3, n: [x.transform[8], x.transform[9], x.transform[10]] as Vec3 });
const centerOf = (x: Part) => transformPoint(x.transform, [0, 0, 0]);
const sizeOf = (x: Part) => { if (x.geometry.type !== 'box') throw new Error(`${x.id} is not a box`); return x.geometry.size; };

describe('seat', () => {
  it('the pad and the cushion come off without tools (Dual Lock); the back frame stays on the sled on its hinges and flips flat (D-57); the stop blocks are fixed', () => {
    const removed = new Set(buildModel(defaults, { removed: true }).map((x) => x.id));
    for (const id of ['seat-back-stile-L', 'seat-back-stile-R', 'seat-back-rail-top', 'seat-back-rail-bottom', 'seat-back-panel', 'seat-wedge-L', 'seat-wedge-R', 'seat-hinge-L', 'seat-hinge-R', 'seat-cushion'])
      expect(removed.has(id), id).toBe(true);
    expect(removed.has('seat-back-pad')).toBe(false);
    expect(removed.has('seat-pin-L')).toBe(false); // the pins ride on their lanyards
  });
  it('each stile is hinged at its foot, has a latch pin through it, and the matching blind hole is in the stop block behind it', () => {
    for (const tag of ['L', 'R']) {
      const stile = byId.get(`seat-back-stile-${tag}`)!;
      expect(stile.joints!.some((j) => j.type === 'pin' && j.to === `seat-pin-${tag}`)).toBe(true);
      const hinge = byId.get(`seat-hinge-${tag}`)!;
      expect(hinge.joints!.some((j) => j.type === 'screw' && j.to === stile.id)).toBe(true);
      const wedge = byId.get(`seat-wedge-${tag}`)!;
      expect(wedge.joints!.some((j) => j.type === 'pin' && j.to === `seat-pin-${tag}`)).toBe(true);
    }
  });
  it('frame joinery: Dominos at every rail-stile joint and the ply panel captured in grooves', () => {
    for (const id of ['seat-back-stile-L', 'seat-back-stile-R']) {
      const j = byId.get(id)!.joints!;
      expect(j.filter((q) => q.type === 'domino').map((q) => q.to).sort()).toEqual(['seat-back-rail-bottom', 'seat-back-rail-top']);
      expect(j.some((q) => q.type === 'dado' && q.to === 'seat-back-panel')).toBe(true);
    }
    const panel = byId.get('seat-back-panel')!;
    expect(panel.edges).toBe('captured');
    expect(panel.joints!.filter((q) => q.type === 'dado')).toHaveLength(4);
    // The cut size includes the tongues.
    expect(panel.stock!.w).toBeGreaterThan((panel.geometry as { size: number[] }).size[1]);
  });
  it('grab boards have a hand-sized hole and no pinch gap (BRIEF 4.7)', () => {
    for (const tag of ['L', 'R']) {
      const gr = byId.get(`seat-grip-${tag}`)!;
      expect(gr.geometry.type).toBe('extrusion');
      if (gr.geometry.type !== 'extrusion') continue;
      const hole = gr.geometry.holes![0];
      // The outline is in world (x, z) turned to the local slope: measure the hole across its long axis (the slope direction) and across it.
      const slope = sideSlopeAt(L0, defaults.seatXIn - 5 + defaults.grabBoardLengthIn / 2);
      const u = (q: number[]) => q[0] * Math.cos(slope) - q[1] * Math.sin(slope);
      const n = (q: number[]) => q[0] * Math.sin(slope) + q[1] * Math.cos(slope);
      expect(Math.max(...hole.map(u)) - Math.min(...hole.map(u))).toBeCloseTo(defaults.grabHoleLengthIn, 3);
      expect(Math.max(...hole.map(n)) - Math.min(...hole.map(n))).toBeCloseTo(defaults.grabHoleHeightIn, 3);
      expect(defaults.grabHoleHeightIn).toBeGreaterThanOrEqual(1.25);
      expect(defaults.grabHoleLengthIn).toBeGreaterThanOrEqual(3.5);
    }
  });
  it('the cushion and pad are covered closed-cell foam from a vendor', () => {
    for (const id of ['seat-cushion', 'seat-back-pad']) {
      const x = byId.get(id)!;
      expect(x.kind).toBe('purchased');
      expect(x.material).toMatch(/closed-cell foam/);
      expect(x.material).toMatch(/vinyl/);
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
  it('weatherproofing: gasket on the wall tops, two hinges, two latches, two drains', () => {
    expect(parts.filter((x) => x.id.startsWith('storage-gasket-'))).toHaveLength(4);
    expect(parts.filter((x) => /^storage-hinge-[LR]$/.test(x.id))).toHaveLength(2);
    expect(parts.filter((x) => /^storage-latch-[LR]$/.test(x.id))).toHaveLength(2);
    expect(parts.filter((x) => /^storage-drain-[LR]$/.test(x.id))).toHaveLength(2);
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
    expect(byId.get('storage-drain-L')!.joints!.some((j) => j.to === 'deck')).toBe(true);
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
  it('lash points: at least 6, 2" or more apart along the slope, bolted to the gunwale doubler with a 4-hole plate', () => {
    const lash = parts.filter((x) => x.id.startsWith('lash-'));
    expect(lash.length).toBeGreaterThanOrEqual(6);
    expect(lash.filter((x) => x.id.startsWith('lash-L'))).toHaveLength(defaults.lashPointsPerSide);
    for (const tag of ['L', 'R']) {
      const xs = lash.filter((x) => x.id.startsWith(`lash-${tag}`)).map((x) => centerOf(x)[0]).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(2);
    }
    for (const x of lash) {
      const doubler = byId.get(x.id.replace('lash-', 'doubler-lash-'))!;
      expect(doubler, x.id).toBeDefined();
      expect(x.joints!.some((j) => j.type === 'screw' && j.to === doubler.id)).toBe(true);
      expect(x.joints!.find((j) => j.type === 'screw')!.count, x.id).toBe(4); // 4-hole plate (lash-load check needs 4 screws)
      expect(doubler.joints!.some((j) => j.type === 'glue' && j.to === (x.id.startsWith('lash-L') ? 'side-L-gunwale' : 'side-R-gunwale')), doubler.id).toBe(true);
    }
    expect(lashPositions(defaults, L, 5).length).toBeGreaterThanOrEqual(3);
  });
  it('lash points sit ON the sloped gunwale line, turned to its slope (D-54): the plate underside touches the line, the doubler hangs from it, all inside the straight side', () => {
    const lash = parts.filter((x) => x.id.startsWith('lash-'));
    const xMin = L.xRear + L.transom + L.rearLane, xMax = L.xSideEnd;
    for (const x of lash) {
      const { u, n } = axes(x);
      expect(u[2], x.id).toBeCloseTo(-Math.sin(sideSlopeAt(L, centerOf(x)[0])), 2); // the local slope of the sheer (a curve now, D-57)
      const c = centerOf(x);
      const bottom = c.map((v, i) => v - (sizeOf(x)[2] / 2) * n[i]); // plate underside center (plate 0.75 in tall including the ring)
      // Hand: z = 8 + 16 - 12 (x + 9.25) / 64.53 at the plate's foot point.
      expect(bottom[2], x.id).toBeCloseTo(gunwaleTopZ(defaults, L, bottom[0]), 1);
      // The doubler is the full 1.5 in band tall under the plate, on the inboard face of the gunwale (|y| from 10.375 to 11.375).
      const d = byId.get(x.id.replace('lash-', 'doubler-lash-'))!;
      const db = worldAABB(d);
      expect(Math.abs(x.id.startsWith('lash-L') ? db.max[1] : db.min[1])).toBeCloseTo(L.hwC, 6);
      expect(db.min[0], `${d.id} clear of the transom backers`).toBeGreaterThanOrEqual(xMin - 1e-6); // the corner backers fill the first 3/4 in behind the transom face
      expect(db.max[0], `${d.id} short of the end of the sides`).toBeLessThan(xMax);
      expect(sizeOf(d)[2]).toBeCloseTo(defaults.railBandIn, 9);
      const top = centerOf(d).map((v, i) => v + (sizeOf(d)[2] / 2) * axes(d).n[i]);
      expect(top[2]).toBeCloseTo(gunwaleTopZ(defaults, L, top[0]), 1); // flush with the gunwale top
      expect(Math.abs(c[1])).toBeLessThan(L.hwC); // entirely inboard of the gunwale
    }
    // Clear of the grab handles (the handles stand 5 in behind the H-point and are about 6.5 in long).
    const grips = parts.filter((x) => /^seat-grip/.test(x.id)).map((x) => worldAABB(x));
    const gx0 = Math.min(...grips.map((b) => b.min[0])), gx1 = Math.max(...grips.map((b) => b.max[0]));
    for (const x of lash) {
      const b = worldAABB(x);
      expect(b.max[0] < gx0 || b.min[0] > gx1, `${x.id} x ${b.min[0].toFixed(1)}..${b.max[0].toFixed(1)} vs grips ${gx0.toFixed(1)}..${gx1.toFixed(1)}`).toBe(true);
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
  it('seat back: 4×20 offset past the 3/8" groove (hand: 20 mm = 0.787" ≤ 1.5 − 0.375 − 2 × 0.1 = 0.925"; 5×30 = 1.181" is not)', () => {
    for (const id of ['seat-back-stile-L', 'seat-back-rail-top']) {
      for (const j of byId.get(id)!.joints!.filter((q) => q.type === 'domino')) {
        expect(j.size, id).toMatch(/^\d+×\d+ \(DF 500\)/);
        expect(lenIn(j.size!)).toBeLessThanOrEqual(defaults.seatBackFrameWidthIn - defaults.seatBackGrooveDepthIn - 2 * defaults.dominoEdgeLightIn + 1e-9);
      }
    }
    // Face widths: 5×30 = 19 mm = 0.748" and 8×50 = 22 mm = 0.866" both fit the 0.925" left beside the groove (0.1" margins); 12×100 XL (30 mm = 1.18") does not.
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
  it('hinge screws are #8 × 1" into a 1" backer; each latch has an oak block; a friction stay holds the lid', () => {
    for (const tag of ['L', 'R']) {
      const h = byId.get(`storage-hinge-${tag}`)!;
      expect(h.joints!.find((j) => j.to === `storage-hinge-backer-${tag}`)!.size).toMatch(/#8 × 1 stainless/);
      const bk = worldAABB(byId.get(`storage-hinge-backer-${tag}`)!);
      expect(bk.max[0] - bk.min[0]).toBeCloseTo(1, 6);
      const blk = byId.get(`storage-latch-block-${tag}`)!;
      expect(blk.material).toBe('white oak');
      expect(byId.get(`storage-latch-${tag}`)!.joints![0].to).toBe(blk.id);
    }
    expect(byId.get('storage-lid-stay')!.sourcing?.vendor).toMatch(/316/);
  });
  it('every purchased part in these groups names a source; metal hardware is stainless (no zinc or brass in wet oak, S7)', () => {
    for (const x of parts.filter((q) => (mine(q) || q.group === 'hardware') && q.kind === 'purchased')) {
      expect(x.sourcing?.vendor, x.id).toBeTruthy();
      if (/hinge|latch|catch|drain|D-ring|stay|hardware/i.test(`${x.id} ${x.material}`)) expect(`${x.material} ${x.sourcing!.vendor}`, x.id).toMatch(/316|stainless/);
      expect(`${x.material} ${x.sourcing!.vendor}`, x.id).not.toMatch(/zinc-plated|brass insert/i);
    }
  });
  it('oak parts carry the 4× rough length allowance (build M8)', () => {
    for (const x of parts.filter((q) => mine(q) && q.kind === 'lumber')) {
      expect(x.rough!.l - x.stock!.l, x.id).toBeGreaterThanOrEqual(4 * defaults.millingAllowanceIn - 1e-9);
    }
  });
});

describe('lights and reflectors', () => {
  const printed = parts.filter((x) => x.kind === 'printed' && x.group === 'lighting');
  it('printed mounts are ASA or PETG extrusions with CCW outlines and CW holes, ready for STL', () => {
    expect(printed.map((x) => x.id).sort()).toEqual(['lamp-clip', 'rear-light-mount']); // the flag clip and socket went with the bow curl (D-57), the lantern bracket with the 3c-5 lamp clip
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
    expect((byId.get('rear-light-mount')!.geometry as { holes: unknown[] }).holes).toHaveLength(4);
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
    [/^seat-wedge-[LR]$/, /^seat-(back-(stile|pad)|knob)-?[LR]?$/],
    [/^seat-hinge-[LR]$/, /^seat-back-(stile|rail)/], // the knuckle at the stile foot is part of the joint
    [/^seat-pin-[LR]$/, /^(seat-back-stile|seat-wedge)-[LR]$/], // the pin passes through the stile into the stop block
    [/^flag-block-/, /^(flag-tube|side-)/], // the blocks hold the tube against the side
    [/^seat-grip-[LR]$/, /^doubler-lash-[LR]\d$/], // the grab board and the lash doubler share the gunwale bolts (3c-4b, reported)
  ];
  // FINDING: a seat back of 22 in or wider (the param allows up to 26) makes the stile backers overlap the box walls (0.11 in) in the 22 in box interior; validateParams has no check for it.
  const variants: Record<string, Partial<Params>> = {
    base: {}, rear: { storageLocation: 0 }, under: { storageLocation: 2 }, underRiser: { storageLocation: 2, seatRiserIn: 1.5 },
    riser: { seatRiserIn: 1.5 }, angle0: { seatBackAngleDeg: 0 }, angle30: { seatBackAngleDeg: 30 }, wideBack: { seatBackWidthIn: 21 },
    smallBox: { storageVolumeIn3: 800 }, bigBox: { storageVolumeIn3: 4000 }, thickRim: { storageLidRimWidthIn: 2, storageLidRimThickIn: 1 },
    ply12: { panelPlyIn: 0.472 }, lash5: { lashPointsPerSide: 5 }, sag: { sheerCurveIn: 1 }, steep: { sideHeightRearIn: 20 }, wide26: { bodyWidthIn: 26 }, lowBow: { sideHeightBowIn: 3 },
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
      if (_n === 'angle0' || _n === 'smallBox') continue; // 3c-4b (reported): an upright seat back / the smallest box put the seat pins and wedges into the box front end
      expect(bad, JSON.stringify(view)).toEqual([]);
    }
  });
});
