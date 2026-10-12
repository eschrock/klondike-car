import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import type { Part } from '../model/types';
import { containers, endGrainAreaIn2, epoxyTimeFactor, finishAreas, finishMaterial, finishingSchedule, surfaceAreaIn2 } from './finishing';

const p = defaultParams();
const parts = buildModel(p);
const sched = finishingSchedule(parts, p);

describe('surface area of a geometry', () => {
  it('box: 2(ab + bc + ca)', () => {
    expect(surfaceAreaIn2({ type: 'box', size: [1, 2, 3] })).toBeCloseTo(22, 9);
  });
  it('extrusion: 2 x outline area + perimeter x depth, less the holes', () => {
    const sq: [number, number][] = [[0, 0], [2, 0], [2, 2], [0, 2]];
    expect(surfaceAreaIn2({ type: 'extrusion', outline: sq, depth: 3 })).toBeCloseTo(2 * 4 + 8 * 3, 9);
    const hole: [number, number][] = [[0.5, 0.5], [0.5, 1.5], [1.5, 1.5], [1.5, 0.5]];
    // The hole removes 2 x 1 of face and adds 4 x 3 of wall.
    expect(surfaceAreaIn2({ type: 'extrusion', outline: sq, holes: [hole], depth: 3 })).toBeCloseTo(2 * 3 + 12 * 3, 9);
  });
  it('mesh: sum of the triangle areas (indexed or not)', () => {
    const positions = [0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0];
    expect(surfaceAreaIn2({ type: 'mesh', positions, indices: [0, 1, 2, 0, 2, 3] })).toBeCloseTo(4, 9);
    expect(surfaceAreaIn2({ type: 'mesh', positions: [0, 0, 0, 3, 0, 0, 0, 4, 0] })).toBeCloseTo(6, 9);
  });
  it('sweep: the strip around its centerline', () => {
    // A 10" straight strip 2" wide, 0.5" thick.
    expect(surfaceAreaIn2({ type: 'sweep', path: [[0, 0], [10, 0]], width: 2, thickness: 0.5, plies: 1 })).toBeCloseTo(2 * 10 * 2.5 + 2 * 2 * 0.5, 9);
  });
});

describe('finishing areas', () => {
  const a = sched.areas;
  it('are positive and cover only oak and okoume', () => {
    expect(a.oakFt2).toBeGreaterThan(20);
    expect(a.okoumeFt2).toBeGreaterThan(20);
    expect(a.oakEndGrainFt2).toBeGreaterThan(0);
    expect(a.oakEndGrainFt2).toBeLessThan(a.oakFt2 / 4);
    expect(a.totalFt2).toBeCloseTo(a.oakFt2 + a.okoumeFt2, 9);
    const byId = new Map(parts.map((x) => [x.id, x]));
    for (const id of Object.keys(a.byPart)) {
      const x = byId.get(id)!;
      expect(['lumber', 'bentlam', 'sheet'], id).toContain(x.kind);
      expect(x.material.toLowerCase(), id).toMatch(/oak|okoume/);
    }
  });

  it('leave out purchased, metal, printed and reference parts', () => {
    for (const x of parts) {
      if (x.kind === 'purchased' || x.kind === 'metal' || x.kind === 'printed' || x.group === 'reference') expect(finishMaterial(x), x.id).toBeUndefined();
    }
    expect(a.byPart['wheel-FL']).toBeUndefined();
    expect(a.byPart['axle-R']).toBeUndefined();
    expect(a.byPart['lamp-clip']).toBeUndefined();
    expect(a.byPart['storage-hinge-L']).toBeUndefined();
  });

  it('okoume area is roughly twice the sheet-part face areas (two faces plus the thin edges)', () => {
    const sheets = parts.filter((x) => x.kind === 'sheet' && /okoume|plywood/i.test(x.material));
    expect(sheets.length).toBeGreaterThanOrEqual(10);
    const faces = sheets.reduce((s, x) => s + (x.stock!.w * x.stock!.l) / 144, 0);
    // The bounding-box face over-states the curved webs (sheer), so the real area sits somewhat under 2x.
    expect(a.okoumeFt2 / (2 * faces)).toBeGreaterThan(0.6);
    expect(a.okoumeFt2 / (2 * faces)).toBeLessThan(1.05);
    // Exact for the deck: two faces + the edge band.
    const deck = parts.find((x) => x.id === 'deck')!;
    expect(a.byPart['deck'] * 144).toBeGreaterThan(2 * deck.stock!.w * deck.stock!.l * 0.9);
    expect(a.byPart['deck'] * 144).toBeLessThan(2 * deck.stock!.w * deck.stock!.l * 1.06);
  });

  it('total wood surface is plausible for a 24 x 60 inch sled (D-20 guessed 60-70 ft2; gross incl. glued faces is higher)', () => {
    expect(a.totalFt2).toBeGreaterThan(60);
    expect(a.totalFt2).toBeLessThan(130);
  });

  it('end grain of a box follows its grain axis', () => {
    const part = { geometry: { type: 'box', size: [10, 2, 3] }, grain: 'x' } as unknown as Part;
    expect(endGrainAreaIn2(part)).toBeCloseTo(2 * 2 * 3, 9);
    expect(finishAreas([]).totalFt2).toBe(0);
  });
});

describe('finishing schedule', () => {
  it('has the six steps in order', () => {
    expect(sched.steps.map((s) => s.id)).toEqual(['offcut-tests', 'sand', 'stain', 'epoxy', 'engrave', 'varnish']);
    expect(sched.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const s of sched.steps) {
      expect(s.instructions.length, s.id).toBeGreaterThanOrEqual(3);
      expect(s.recoat.length, s.id).toBeGreaterThan(0);
      expect(s.cure.length, s.id).toBeGreaterThan(0);
      expect(s.winter.length, s.id).toBeGreaterThan(10);
    }
  });

  it('tests okoume with conditioner or gel stain on offcuts first', () => {
    const t = sched.steps[0];
    expect(t.instructions.join(' ')).toMatch(/conditioner/);
    expect(t.instructions.join(' ')).toMatch(/gel stain/);
    expect(t.instructions.join(' ')).toMatch(/blotch/);
  });

  it('sands 120 then 150 and eases edges to the roundover param', () => {
    const s = sched.steps[1].instructions.join(' ');
    expect(s).toMatch(/120/);
    expect(s).toMatch(/150/);
    expect(s).toContain(`${p.roundoverIn}" roundover`);
  });

  it('epoxy seals the okoume and oak end grain with 2 coats of 105/207 and warns about oil-based stain', () => {
    const e = sched.steps[3];
    expect(e.coats).toBe(2);
    expect(e.title).toMatch(/okoume/i);
    expect(e.title).toMatch(/end grain/i);
    expect(e.instructions.join(' ')).toMatch(/105/);
    expect(e.instructions.join(' ')).toMatch(/207/);
    expect(e.instructions.join(' ')).toMatch(/oil-based stain needs the stain fully cured/);
    expect(e.instructions.join(' ')).toMatch(/water-based/);
    expect(e.products).toHaveLength(2);
    // Quantity = area x coats / coverage x (1 + waste): check coat 1 by hand.
    const a = sched.areas;
    const area = a.okoumeFt2 + 2 * a.oakEndGrainFt2;
    expect(e.products[0].coverageFt2PerQt).toBe(60);
    expect(e.products[0].qtNeeded).toBeCloseTo((area / 60) * 1.15, 1);
  });

  it('engraves the legend from the lid part', () => {
    const lid = parts.find((x) => x.id === 'storage-lid')!;
    const s = sched.steps[4];
    expect(lid.legend?.text).toBe('DO NOT STEP');
    expect(s.title).toContain('DO NOT STEP');
    expect(s.instructions.join(' ')).toContain(`${lid.legend!.letterHeightIn}"`);
    expect(s.instructions.join(' ')).toMatch(/storage-lid/);
  });

  it('varnish: 3-4 coats, 320 between coats, with coverage cited', () => {
    const v = sched.steps[5];
    expect(v.coats).toBeGreaterThanOrEqual(3);
    expect(v.coats).toBeLessThanOrEqual(4);
    expect(v.instructions.join(' ')).toMatch(/320/);
    expect(v.instructions.join(' ')).toMatch(/UV/);
    expect(v.products[0].coverageFt2PerQt).toBeGreaterThan(50);
    expect(v.products[0].areaFt2).toBeCloseTo(sched.areas.totalFt2, 0);
  });

  it('gives winter temperature notes with an epoxy time factor', () => {
    expect(epoxyTimeFactor(70)).toBeCloseTo(1, 9);
    expect(epoxyTimeFactor(52)).toBeCloseTo(2, 9);
    expect(sched.steps[3].winter).toMatch(/60 °F/);
    expect(sched.steps[5].winter).toMatch(/60 °F/);
  });

  it('every product with a coverage cites it in ft2 per quart, and every quantity is positive', () => {
    for (const s of sched.steps) for (const pr of s.products) {
      expect(pr.qtNeeded, pr.name).toBeGreaterThan(0);
      if (s.id !== 'engrave') expect(pr.coverageFt2PerQt, pr.name).toBeGreaterThan(0);
    }
  });
});

describe('buy list', () => {
  it('rounds to gallons, quarts and pints', () => {
    expect(containers(0.2)).toEqual([{ unit: 'pt', qty: 1, qt: 0.5 }]);
    expect(containers(1.2)).toEqual([{ unit: 'qt', qty: 1, qt: 1 }, { unit: 'pt', qty: 1, qt: 0.5 }]);
    expect(containers(3.59)).toEqual([{ unit: 'gal', qty: 1, qt: 4 }]);
    expect(containers(4.5)).toEqual([{ unit: 'gal', qty: 1, qt: 4 }, { unit: 'pt', qty: 1, qt: 0.5 }]);
    expect(containers(7.5)).toEqual([{ unit: 'gal', qty: 2, qt: 8 }]);
  });

  it('covers the quantity the schedule computes', () => {
    const total = (re: RegExp): number => sched.buy.filter((b) => re.test(b.item)).reduce((s, b) => s + b.qt, 0);
    const need = (id: string, i = 0): number => sched.steps.find((s) => s.id === id)!.products[i].qtNeeded;
    expect(total(/spar varnish/i)).toBeGreaterThanOrEqual(need('varnish'));
    expect(total(/conditioner/i)).toBeGreaterThanOrEqual(need('stain', 1));
    expect(total(/gel stain/i)).toBeGreaterThanOrEqual(need('stain', 2));
    expect(total(/wood stain/i)).toBeGreaterThanOrEqual(need('stain', 0));
    const mixed = need('epoxy', 0) + need('epoxy', 1);
    const resin = total(/105 epoxy resin/);
    const hardener = total(/207/);
    expect(resin + hardener).toBeGreaterThanOrEqual(mixed);
    // 5:1 by volume: the resin and hardener bought each cover their share of the mixed volume.
    expect(hardener).toBeGreaterThanOrEqual(mixed / 6 - 1e-9);
    expect(resin).toBeGreaterThanOrEqual((mixed * 5) / 6 - 1e-9);
    for (const b of sched.buy) {
      expect(['gal', 'qt', 'pt']).toContain(b.unit);
      expect(Number.isInteger(b.qty)).toBe(true);
    }
  });
});
