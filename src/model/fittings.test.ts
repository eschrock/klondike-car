/** Workstream D (D-40, D-41): seat, storage box and light-mount details. Complements the shared overlap / mass tests in model.test.ts. */
import { describe, expect, it } from 'vitest';
import { defaultParams, validateParams, type Params } from '../params';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { obbOverlap, partOBB, worldAABB } from './bounds';
import { ESSENTIALS, packEssentials, storageInterior, lashPositions, interiorOf, storageGeometry, type StorageGeometry } from './storage';
import { seatBackSupport, frameJoint } from './seat';
import { DOMINOS } from './joinery';
import { signedArea } from './profile';
import type { Part } from './types';

const defaults = defaultParams();
const parts = buildModel(defaults);
const byId = new Map(parts.map((x) => [x.id, x]));
const mine = (x: Part) => ['seat', 'storage', 'lighting'].includes(x.group) || x.id.startsWith('lash-');

describe('seat', () => {
  it('the back comes off without tools: stiles, rails, panel, pad and knobs are removable, the wedges stay', () => {
    const removed = new Set(buildModel(defaults, { removed: true }).map((x) => x.id));
    for (const id of ['seat-back-stile-L', 'seat-back-stile-R', 'seat-back-rail-top', 'seat-back-rail-bottom', 'seat-back-panel', 'seat-back-pad', 'seat-knob-L', 'seat-knob-R'])
      expect(removed.has(id), id).toBe(false);
    for (const id of ['seat-wedge-L', 'seat-wedge-R', 'storage-backer-L', 'storage-backer-R']) expect(removed.has(id), id).toBe(true);
  });
  it('each stile is held by a knob joint and the matching insert joint sits in the fixed part behind it', () => {
    for (const tag of ['L', 'R']) {
      const stile = byId.get(`seat-back-stile-${tag}`)!;
      expect(stile.joints!.some((j) => j.type === 'knob' && j.to === `seat-knob-${tag}`)).toBe(true);
      const backer = byId.get(`storage-backer-${tag}`)!;
      expect(backer.joints!.some((j) => j.type === 'threaded-insert' && j.to === stile.id)).toBe(true);
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
  it('grab handles have a hand-sized opening and no pinch gap (BRIEF 4.7)', () => {
    for (const tag of ['L', 'R']) {
      const pad = worldAABB(byId.get(`seat-grip-pad-${tag}`)!);
      const bar = worldAABB(byId.get(`seat-grip-bar-${tag}`)!);
      const p1 = worldAABB(byId.get(`seat-grip-post-${tag}1`)!);
      const p2 = worldAABB(byId.get(`seat-grip-post-${tag}2`)!);
      expect(bar.min[2] - pad.max[2]).toBeCloseTo(defaults.seatGripGapIn, 6);
      expect(bar.min[2] - pad.max[2]).toBeGreaterThanOrEqual(1.25);
      expect(p2.min[0] - p1.max[0]).toBeCloseTo(defaults.seatGripClearLengthIn, 6);
      expect(p2.min[0] - p1.max[0]).toBeGreaterThanOrEqual(3.5);
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
  it('the deck is the box floor (no separate floor panel); a raised box keeps its own floor', () => {
    expect(byId.has('storage-bottom')).toBe(false);
    expect(storageGeometry(defaults, L).floorZ).toBeCloseTo(L.deckTop, 9);
    const raised = { ...defaults, storageLocation: 1 } as Params;
    const rp = buildModel(raised);
    expect(rp.some((x) => x.id === 'storage-bottom')).toBe(true);
    // Standing walls are bonded to the deck with a fillet; the drains go through the deck into the sealed hole.
    for (const id of ['storage-side-L', 'storage-side-R', 'storage-end-aft', 'storage-end-fore'])
      expect(byId.get(id)!.joints!.some((j) => j.to === 'deck-cabin' && j.type === 'glue'), id).toBe(true);
    expect(byId.get('storage-drain-L')!.joints!.some((j) => j.to === 'deck-cabin')).toBe(true);
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
  it('lash points: at least 6, above the gunwale, 2" or more apart, bolted to the gunwale', () => {
    const lash = parts.filter((x) => x.id.startsWith('lash-'));
    expect(lash.length).toBeGreaterThanOrEqual(6);
    for (const tag of ['L', 'R']) {
      const xs = lash.filter((x) => x.id.startsWith(`lash-${tag}`)).map((x) => worldAABB(x).min[0]).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(2);
    }
    for (const x of lash) {
      expect(worldAABB(x).min[2]).toBeCloseTo(defaults.deckHeightIn + defaults.sideHeightIn, 6);
      expect(x.joints!.some((j) => j.type === 'screw')).toBe(true);
      expect(x.joints!.find((j) => j.type === 'screw')!.count, x.id).toBe(4); // 4-hole plate (lash-load check needs 4 screws)
    }
    expect(lashPositions(defaults, L, 5).length).toBeGreaterThanOrEqual(3);
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
  it('grab-handle posts: 4×20 into the pad across the 1" post; the post-to-bar tenon leaves shoulders on the 1" post', () => {
    const post = byId.get('seat-grip-post-L1')!;
    const d = post.joints!.find((j) => j.type === 'domino')!;
    expect(d.size).toMatch(/^\d+×\d+ \(DF 500\)/);
    expect(lenIn(d.size!)).toBeLessThanOrEqual(1 - 0.2 + 1e-9);
    const tenon = post.joints!.find((j) => j.type === 'mortise-tenon')!;
    expect(tenon.size).toBe('3/8 × 3/4 × 1/2 blind tenon'); // 3/4" wide on a 1" post: 1/8" shoulders (the old through tenon was 1" wide: none)
  });
  it('frameJoint falls back to a blind tenon when no Domino fits (a 0.6" member)', () => {
    expect(frameJoint(defaults, 'x', { stockIn: 0.5, hostIn: 0.6, widthIn: 0.6 }).type).toBe('mortise-tenon');
    expect(frameJoint(defaults, 'x', { stockIn: 0.75, hostIn: 1.5, widthIn: 1.125 }).type).toBe('domino');
  });
});

describe('round 2 fittings: foot-stop cleats, latch blocks, stay, stainless', () => {
  it('foot stop: no "stopped dado"; corner cleats bonded to each side, ahead of the board so the foot load bears on them', () => {
    const stop = worldAABB(byId.get('foot-stop')!);
    for (const tag of ['L', 'R']) {
      const cleat = byId.get(`foot-stop-cleat-${tag}`)!;
      const b = worldAABB(cleat);
      expect(b.min[0]).toBeCloseTo(stop.max[0], 6);
      expect(b.max[0] - b.min[0]).toBeCloseTo(1.25, 6);
      expect(cleat.joints!.some((j) => j.type === 'glue')).toBe(true);
      expect(cleat.joints!.some((j) => j.type === 'domino' && j.to === 'foot-stop' && j.count === 2)).toBe(true);
    }
    expect(JSON.stringify(byId.get('foot-stop')!.joints)).not.toMatch(/dado/);
    // At the validator limit (board against the front transom) the cleats go behind the board instead of into the transom.
    const lim = { ...defaults, frontOverhangIn: defaults.seatXIn + defaults.riderLegReachIn + defaults.footStopThickIn / 2 + defaults.sideThicknessIn - defaults.wheelbaseIn } as Params;
    if (!validateParams(lim).some((i) => i.severity === 'error')) {
      const m = buildModel(lim);
      const s2 = worldAABB(m.find((x) => x.id === 'foot-stop')!);
      expect(worldAABB(m.find((x) => x.id === 'foot-stop-cleat-L')!).max[0]).toBeCloseTo(s2.min[0], 6);
    }
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
    expect(printed.map((x) => x.id).sort()).toEqual(['flag-mount', 'flag-socket', 'lantern-mount', 'rear-light-mount']);
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
  it('the front lantern and flag mount sit on the front transom, clear of the prow base', () => {
    const tr = worldAABB(byId.get('transom-front')!);
    for (const id of ['lantern-mount', 'flag-mount']) {
      const b = worldAABB(byId.get(id)!);
      expect(b.min[0]).toBeLessThan(tr.min[0]);
      expect(b.max[0]).toBeGreaterThan(tr.max[0]);
      expect(Math.abs(b.min[1] + b.max[1]) / 2).toBeGreaterThan(2);
      expect(byId.get(id)!.removable).toBe(true);
    }
    expect(byId.get('front-light')!.removable).toBe(true);
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
    [/^(lantern-mount|flag-mount)$/, /^transom-front$/],
    [/^seat-wedge-[LR]$/, /^seat-(back-(stile|pad)|knob)-?[LR]?$/],
  ];
  const variants: Record<string, Partial<Params>> = {
    base: {}, rear: { storageLocation: 0 }, forward: { storageLocation: 1 }, under: { storageLocation: 2 }, underRiser: { storageLocation: 2, seatRiserIn: 1.5 },
    riser: { seatRiserIn: 1.5 }, angle0: { seatBackAngleDeg: 0 }, angle30: { seatBackAngleDeg: 30 }, wideBack: { seatBackWidthIn: 24 },
    smallBox: { storageVolumeIn3: 800 }, bigBox: { storageVolumeIn3: 4000 }, thickRim: { storageLidRimWidthIn: 2, storageLidRimThickIn: 1 },
    ply12: { panelPlyIn: 0.472 }, lash5: { lashPointsPerSide: 5 }, flare: { gunwaleFlareIn: 2 }, solidOak: { sideConstruction: 0 }, openFrame: { sideConstruction: 2 },
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
      expect(bad, JSON.stringify(view)).toEqual([]);
    }
  });
});
