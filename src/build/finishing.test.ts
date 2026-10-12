import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import type { Part } from '../model/types';
import { containers, DOMINO_FLOZ, endGrainAreaIn2, EPOXY_RESIN_PARTS, epoxyTimeFactor, finishAreas, finishMaterial, finishingSchedule, glueEpoxyFlOz, glueJointEstimates, HARDENER_MARGIN, surfaceAreaIn2 } from './finishing';

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
    // 105 with 207 is 3:1 by volume: the resin and hardener bought each cover their share of the mixed volume.
    expect(hardener).toBeGreaterThanOrEqual(mixed / 4 - 1e-9);
    expect(resin).toBeGreaterThanOrEqual((mixed * 3) / 4 - 1e-9);
    for (const b of sched.buy) {
      expect(['gal', 'qt', 'pt']).toContain(b.unit);
      expect(Number.isInteger(b.qty)).toBe(true);
    }
  });
});

describe('build review round 1: hardener, 209 and the pumps (MUST-10)', () => {
  const buy = (re: RegExp) => sched.buy.filter((b) => re.test(b.item));

  it('mixes 105 with 207 and 209 at 3:1, not 5:1', () => {
    expect(EPOXY_RESIN_PARTS).toBe(3);
    const text = sched.steps.map((s) => s.instructions.join(' ')).join(' ') + sched.assumptions.join(' ');
    expect(text).toMatch(/3:1/);
    expect(text).not.toMatch(/5:1 by volume, pumps/);
    // About a quarter of the mixed volume is hardener: 0.46 qt at the defaults.
    const mixed = sched.steps.find((s) => s.id === 'epoxy')!.products.reduce((a, q) => a + q.qtNeeded, 0);
    expect(buy(/207/).reduce((a, b) => a + b.qt, 0)).toBeGreaterThanOrEqual(mixed / 4 - 1e-9);
  });

  it('buys 207 with at least 25 % to spare: a pint that leaves less becomes a quart (round 2, SHOULD 5)', () => {
    const mixed = sched.steps.find((s) => s.id === 'epoxy')!.products.reduce((a, q) => a + q.qtNeeded, 0);
    const need = mixed / (EPOXY_RESIN_PARTS + 1);
    const bought = buy(/207/).reduce((a, b) => a + b.qt, 0);
    expect(bought).toBeGreaterThanOrEqual(need * (1 + HARDENER_MARGIN) - 1e-9);
    // The defaults need 0.46 qt: a pint is only 9 % over, so the line is one quart.
    expect(need).toBeGreaterThan(0.4);
    expect(buy(/207/).map((b) => `${b.qty} ${b.unit}`)).toEqual(['1 qt']);
  });

  it('buys 209 extra-slow hardener for the transom and bulkhead closes, sized from their joints at 3:1', () => {
    const l209 = buy(/209/);
    expect(l209.length).toBeGreaterThan(0);
    expect(l209[0].item).toMatch(/extra slow/);
    expect(sched.closeEpoxyFlOz).toBeGreaterThan(5);
    expect(l209.reduce((a, b) => a + b.qt, 0) * 32).toBeGreaterThanOrEqual(sched.closeEpoxyFlOz / (EPOXY_RESIN_PARTS + 1) - 1e-9);
    expect(l209[0].note).toMatch(/transom and bulkhead/);
  });

  it('lists the 303 mini pump set for the 3:1 hardeners', () => {
    expect(sched.supplies).toHaveLength(1);
    expect(sched.supplies[0].item).toMatch(/303/);
    expect(sched.supplies[0].unit).toBe('ea');
    expect(sched.supplies[0].qty).toBeGreaterThanOrEqual(1);
  });
});

describe('build review round 1: glue epoxy by joint type (MUST-10)', () => {
  const est = glueJointEstimates(parts);
  const sum = (kind: string): number => est.filter((g) => g.kind === kind).reduce((a, g) => a + g.flOz, 0);
  const n = (kind: string): number => est.filter((g) => g.kind === kind).reduce((a, g) => a + g.count, 0);

  it('is a realistic total, far above the old 0.12 fl oz a joint', () => {
    const total = glueEpoxyFlOz(parts);
    const joints = est.reduce((a, g) => a + g.count, 0);
    expect(joints).toBeGreaterThan(100);
    expect(total).toBeGreaterThan(joints * 0.12 * 2);
    expect(total).toBeGreaterThan(30);
    expect(total).toBeLessThan(90);
    expect(total).toBeCloseTo(est.reduce((a, g) => a + g.flOz, 0), 9);
  });

  it('puts a Domino at 0.1-0.2 fl oz and counts a joint listed on both parts once', () => {
    for (const k of ['4×20', '5×30']) {
      expect(DOMINO_FLOZ[k]).toBeGreaterThanOrEqual(0.1);
      expect(DOMINO_FLOZ[k]).toBeLessThanOrEqual(0.2);
    }
    // 18 chine Dominos 4×20 (rail-L / side-L-chine appear on both parts), 16 of 5×30 in the frame, 2 of 8×50 and so on.
    expect(n('domino')).toBeGreaterThan(30);
    expect(n('domino')).toBeLessThan(60);
    const chine = est.filter((g) => g.kind === 'domino' && [g.a, g.b].sort().join('|') === 'rail-L|side-L-chine');
    expect(chine).toHaveLength(1);
    expect(chine[0].count).toBe(9);
    expect(chine[0].flOz).toBeCloseTo(9 * DOMINO_FLOZ['4×20'], 9);
    expect(sum('domino') / n('domino')).toBeGreaterThanOrEqual(0.1);
    expect(sum('domino') / n('domino')).toBeLessThanOrEqual(0.25);
  });

  it('prices a full-face lamination by area (0.5-1 fl oz per ft2) and a fillet joint higher than a Domino', () => {
    const band = est.find((g) => g.kind === 'lamination' && /side-L-chine/.test(g.a + g.b) && /side-L-web/.test(g.a + g.b))!;
    const bandFt2 = (1.5 * 58.75) / 144;
    expect(band.flOz).toBeGreaterThan(0.5 * bandFt2 - 1e-9);
    expect(band.flOz).toBeLessThanOrEqual(1 * bandFt2 + 0.01);
    expect(sum('fillet') / n('fillet')).toBeGreaterThan(DOMINO_FLOZ['5×30']);
  });

  it('can be limited to the joints that touch some parts (the end closes)', () => {
    const closes = glueEpoxyFlOz(parts, (x) => x.step === 4.4);
    expect(closes).toBeGreaterThan(5);
    expect(closes).toBeLessThan(glueEpoxyFlOz(parts));
    expect(glueEpoxyFlOz([])).toBe(0);
  });
});

describe('build review round 1: stain, then seal (MUST-2)', () => {
  it('stains the show faces, then epoxy-seals them, with water-based dye as the safe route', () => {
    const ids = sched.steps.map((s) => s.id);
    expect(ids.indexOf('stain')).toBeLessThan(ids.indexOf('epoxy'));
    const stain = sched.steps.find((s) => s.id === 'stain')!;
    const epoxy = sched.steps.find((s) => s.id === 'epoxy')!;
    expect(stain.title).toMatch(/show faces/);
    expect(stain.instructions.join(' ')).toMatch(/Water-based dye under epoxy is the safe route/);
    expect(stain.instructions.join(' ')).toMatch(/THEN seal/);
    expect(epoxy.title).toMatch(/show faces/);
    expect(epoxy.instructions.join(' ')).toMatch(/dados, edges and hidden faces were already sealed/);
    expect(epoxy.instructions.join(' ')).not.toMatch(/Seal ALL faces/);
    expect(sched.steps[0].instructions.join(' ')).toMatch(/BEFORE any show face is sealed/);
  });
  it('runs in two sessions and leaves the hardware off', () => {
    expect(sched.steps[1].instructions.join(' ')).toMatch(/underside while the hull is still inverted/);
    expect(sched.steps[5].instructions.join(' ')).toMatch(/Hardware, hinges and the running gear stay off/);
  });
});
