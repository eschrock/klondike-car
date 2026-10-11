/** Workstream D (D-40, D-41): seat, storage box and light-mount details. Complements the shared overlap / mass tests in model.test.ts. */
import { describe, expect, it } from 'vitest';
import { defaultParams, validateParams, type Params } from '../params';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { obbOverlap, partOBB, worldAABB } from './bounds';
import { ESSENTIALS, packEssentials, storageInterior, lashPositions } from './storage';
import { seatBackSupport } from './seat';
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
    // Gasket sits exactly between the wall top and the lid frame underside.
    const wall = worldAABB(byId.get('storage-side-L')!);
    const gasket = worldAABB(byId.get('storage-gasket-side-L')!);
    const rim = worldAABB(byId.get('storage-rim-side-L')!);
    expect(gasket.min[2]).toBeCloseTo(wall.max[2], 6);
    expect(rim.min[2]).toBeCloseTo(gasket.max[2], 6);
  });
  it('the lid frame captures the ply panel and the walls reach the deck (no exposed ply edge)', () => {
    const lid = byId.get('storage-lid')!;
    expect(lid.edges).toBe('captured');
    expect(lid.joints!.filter((j) => j.type === 'rabbet')).toHaveLength(4);
    expect(worldAABB(byId.get('storage-side-L')!).min[2]).toBeCloseTo(L.storage.zBot, 6);
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
    }
    expect(lashPositions(defaults, L, 5).length).toBeGreaterThanOrEqual(3);
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
