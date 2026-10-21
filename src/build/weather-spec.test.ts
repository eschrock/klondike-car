/**
 * The weather spec (D-73, Eric 2026-10-12): Standard (the default: garage-kept, used a few times a year, wet at most at a rainy derby) against Extreme weather (stored outside, near salt,
 * exposed regularly). Both are built from the same design; these tests pin what differs in the BOM, the finishing schedule, the assembly text and the build book, and the price difference.
 */
import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { totalMass } from '../model/mass';
import { THIN_SHEET, WEATHER_SPEC, defaultParams, thinSheet, type Params } from '../params';
import { bom, type Bom, type BomLine } from './bom';
import { assemblySteps, standardText } from './assembly';
import { buildBookHtml } from './build-book';
import { URETHANE_COVERAGE, VARNISH_COVERAGE, finishAreas, finishMaterial, finishingSchedule, glueEpoxyFlOz, glueJointEstimates, glueTitebond, standardAdhesive, urethaneContainers } from './finishing';
import { BuildData } from './package';
import { OWNED_NOTE, PLYWOOD_PRICE, TITEBOND_BOTTLES, metalPrice, specOf, std304 } from './prices';
import { lbDelta, weatherChipText, weatherLine } from '../ui/build-helpers';

const std: Params = { ...defaultParams(), weatherSpec: WEATHER_SPEC.standard };
const ext: Params = { ...defaultParams(), weatherSpec: WEATHER_SPEC.extreme };
const stdParts = buildModel(std);
const extParts = buildModel(ext);
const bStd = bom(stdParts, std);
const bExt = bom(extParts, ext);
const lines = (b: Bom): BomLine[] => b.sections.flatMap((s) => s.lines);
const allText = (b: BomLine): string => `${b.key} ${b.description}`;

describe('the two specs', () => {
  it('Standard is the default', () => {
    expect(defaultParams().weatherSpec).toBe(WEATHER_SPEC.standard);
    expect(specOf(defaultParams())).toBe('standard');
    expect(specOf(ext)).toBe('extreme');
    expect(bom(buildModel(defaultParams()), defaultParams()).spec).toBe('standard');
    expect(bStd.spec).toBe('standard');
    expect(bExt.spec).toBe('extreme');
  });

  it('Standard has no 316 line; neither spec has a Sipo line (D-79: beech Dominos from the shop, epoxied in under Extreme); Standard has no stain, conditioner, scupper or box-drain line (D-83)', () => {
    for (const l of lines(bStd)) {
      expect(allText(l), l.key).not.toMatch(/316/);
      expect(allText(l), l.key).not.toMatch(/sipo/i);
      expect(l.vendor ?? '', l.key).not.toMatch(/316/);
      expect(l.key, l.key).not.toMatch(/^(stain|conditioner|gel-stain)|^(scupper|storage-drain)/);
      expect(allText(l), l.key).not.toMatch(/stain or dye|pre-stain conditioner|gel stain|nipple|scupper/i);
    }
    for (const l of lines(bExt)) expect(allText(l), l.key).not.toMatch(/sipo/i);
    // and the other way round: the specs do differ
    expect(lines(bExt).some((l) => /316/.test(l.key))).toBe(true);
    expect(lines(bExt).some((l) => /^Domino/.test(l.key) && /beech.*epoxied in/.test(l.description))).toBe(true);
    expect(lines(bStd).some((l) => /^Domino/.test(l.key) && /beech/.test(l.description))).toBe(true);
    expect(lines(bStd).some((l) => /^18-8 /.test(l.key))).toBe(true);
    // Extreme keeps the nipples (316, real price) and the stain products; Standard's clear urethane is the whole finish
    expect(lines(bExt).some((l) => l.key === 'scupper')).toBe(true);
    expect(lines(bExt).some((l) => /^stain-/.test(l.key))).toBe(true);
  });

  it('Standard uses Titebond III (shop stock, $0, kept on the list) and less epoxy than Extreme; Extreme uses epoxy everywhere', () => {
    const tb = lines(bStd).filter((l) => /^titebond/.test(l.key));
    expect(tb.length).toBe(1);
    expect(tb[0].description).toMatch(/Titebond III/);
    expect(tb[0].key).toBe('titebond');
    expect([tb[0].basis, tb[0].unitUsd, tb[0].extUsd]).toEqual(['owned', 0, 0]);
    expect(tb[0].notes).toContain(OWNED_NOTE);
    expect(tb[0].qty).toBe(Math.ceil(finishingSchedule(stdParts, std).glue.titebondFlOz)); // fl oz of glue the joints need
    expect(lines(bExt).some((l) => /titebond/i.test(allText(l)))).toBe(false);
    expect(bStd.consumables.epoxyFlOz).toBeLessThan(bExt.consumables.epoxyFlOz);
    expect(bStd.consumables.finishEpoxyFlOz).toBeLessThan(bExt.consumables.finishEpoxyFlOz);
    expect(bStd.consumables.glueEpoxyFlOz).toBeLessThan(bExt.consumables.glueEpoxyFlOz);
    expect(bStd.consumables.sealedFt2).toBe(0);
    expect(bExt.consumables.sealedFt2).toBeGreaterThan(30);
    // the Titebond joints are the general ones: Dominos, dados, tenons; the epoxy ones the laminations, fillets, deck and bedding
    const sStd = finishingSchedule(stdParts, std);
    expect(sStd.glue.titebondJoints).toBeGreaterThan(50);
    expect(sStd.glue.titebondFlOz).toBeGreaterThan(0);
    expect(sStd.glue.titebondFlOz).toBeLessThanOrEqual(TITEBOND_BOTTLES[1].flOz);
    expect(finishingSchedule(extParts, ext).glue.titebondJoints).toBe(0);
  });

  it('the wood-screw sizes number 3 or fewer in both specs, whatever the thin sheet (nothing in the BOM adds a fourth)', () => {
    for (const w of [WEATHER_SPEC.standard, WEATHER_SPEC.extreme]) for (const m of [THIN_SHEET.followWeather, THIN_SHEET.whiteOakPly, THIN_SHEET.okoumeMarine, THIN_SHEET.balticBirch3mm, THIN_SHEET.balticBirch6mm]) {
      const p: Params = { ...defaultParams(), weatherSpec: w, thinSheetMaterial: m };
      const b = bom(buildModel(p), p, { noCompare: true });
      const sizes = new Set(lines(b).filter((l) => /wood screw/.test(l.key) && !/^(Heat|Thumb)/.test(l.key)).map((l) => l.key.replace(/^(316|18-8) /, '').replace(/^(pan|trim)-head /, ''))); // D-91: the rail-to-chine trim-head #8 x 2-1/2 is a head style of the third size; D-77: the strap's pan-head #8 x 1-1/4 is a head style of the second size, not a fourth size
      expect([...sizes].sort(), `weather ${w}, sheet ${m}`).toEqual(['wood screw #8 x 1-1/4"', 'wood screw #8 x 2-1/2"', 'wood screw #8 x 5/8"']); // D-82: every wood screw is a #8
    }
  });

  it('the lid-batten screws are #8 x 5/8 (the third D-72 size), not a fourth', () => {
    const bat = lines(bExt).filter((l) => /wood screw #8 x 5\/8"/.test(l.key));
    expect(bat.length).toBe(1);
    expect(bat[0].qty).toBeGreaterThanOrEqual(12);
    expect(lines(bStd).some((l) => /wood screw #6 x (3\/8|1\/2|5\/8)"/.test(l.key))).toBe(false);
  });
});

describe('the price difference', () => {
  const c = bStd.weatherCompare;

  it('Extreme costs more, section by section the difference adds up, and both BOMs read the same comparison', () => {
    expect(c.computed).toBe(true);
    expect(c.activeSpec).toBe('standard');
    expect(c.deltaUsd).toBeGreaterThan(0);
    expect(c.standardUsd).toBeCloseTo(bStd.totalUsd, 2);
    expect(c.extremeUsd).toBeCloseTo(bExt.totalUsd, 2);
    expect(c.deltaUsd).toBeCloseTo(bExt.totalUsd - bStd.totalUsd, 2);
    expect(Object.values(c.deltaBySection).reduce((a, v) => a + v, 0)).toBeCloseTo(c.deltaUsd, 1);
    expect(c.deltaCoreUsd + c.deltaTouchesUsd).toBeCloseTo(c.deltaUsd, 1);
    for (const s of bStd.sections) expect(c.deltaBySection[s.id], s.id).toBeCloseTo(bExt.sections.find((q) => q.id === s.id)!.subtotalUsd - s.subtotalUsd, 2);
    expect(c.deltaBySection.fasteners).toBeGreaterThan(0);
    expect(c.deltaBySection.consumables).toBeGreaterThan(0);
    const e = bExt.weatherCompare;
    expect(e.activeSpec).toBe('extreme');
    expect([e.standardUsd, e.extremeUsd, e.deltaUsd]).toEqual([c.standardUsd, c.extremeUsd, c.deltaUsd]);
    expect(e.deltaLb).toBeCloseTo(c.deltaLb, 6);
  });

  it('carries the mass of the thin sheet: the 6 mm Baltic birch (Standard) is heavier than the 6 mm okoume (Extreme)', () => {
    expect(c.thinSheetStandard).toBe('6 mm Baltic birch');
    expect(c.thinSheetExtreme).toBe('6 mm okoume');
    expect(c.standardLb).toBeCloseTo(totalMass(stdParts), 6);
    expect(c.extremeLb).toBeCloseTo(totalMass(extParts), 6);
    expect(c.deltaLb).toBeLessThan(-1); // Extreme is lighter
    expect(c.deltaLb).toBeGreaterThan(-8);
  });

  it('a thin sheet chosen by hand does not change with the weather: the same parts, no mass difference', () => {
    const p: Params = { ...defaultParams(), thinSheetMaterial: THIN_SHEET.okoumeMarine };
    const cc = bom(buildModel(p), p).weatherCompare;
    expect(cc.deltaLb).toBe(0);
    expect(cc.thinSheetStandard).toBe(cc.thinSheetExtreme);
    expect(cc.deltaUsd).toBeGreaterThan(0);
  });

  it('is lazy and not enumerable, and the inner call does not recurse', () => {
    const b = bom(stdParts, std);
    expect(Object.keys(b)).not.toContain('weatherCompare');
    expect(JSON.stringify(b)).not.toContain('weatherCompare');
    const inner = bom(stdParts, std, { noCompare: true }).weatherCompare;
    expect(inner.computed).toBe(false);
    expect(inner.deltaUsd).toBe(0);
  });

  it('has the words the Build tab and the book print', () => {
    expect(weatherChipText(c)).toMatch(/^Extreme weather adds \$[\d,]+\.\d\d \(−\d+\.\d lb\)$/);
    expect(weatherChipText(bExt.weatherCompare)).toMatch(/^Standard saves \$[\d,]+\.\d\d \(\+\d+\.\d lb\)$/);
    expect(lbDelta(2.84)).toBe('+2.8 lb');
    expect(lbDelta(-2.84)).toBe('−2.8 lb');
    expect(weatherLine(c)).toMatch(/^Weather spec: Standard\. Standard \$.*; Extreme weather \$.*; Extreme adds \$.* and /);
  });
});

describe('Bolt Depot by the piece', () => {
  it('prices a fastener per piece when that is cheaper than the bag, and by the bag when the bag is cheaper', () => {
    const fast = lines(bStd).filter((l) => /^18-8 /.test(l.key));
    const screw = fast.find((l) => l.key === '18-8 wood screw #8 x 1-1/4"')!;
    expect([screw.unitUsd, screw.packQty]).toEqual([0.29, undefined]);
    expect(screw.extUsd).toBeCloseTo(screw.qty * 0.29, 2);
    expect(screw.section).toBe('Fasteners');
    // 3/8 in fender washers (the knee bolts no longer buy any: they take a narrow flat washer under each head): 20 x 0.41 = 8.20 against the bag of 50 at 14.51
    const w38 = lines(bStd).find((l) => l.key === '18-8 fender washer 3/8"')!;
    expect([w38.qty, w38.unitUsd, w38.packQty]).toEqual([20, 0.41, undefined]);
    // the 20 1/4-20 nylocks (24 before the hanger bolts were counted once) are 3.20 by the piece against 10.36 for the bag
    const nut = fast.find((l) => l.key === '18-8 nylon-insert lock nut 1/4-20')!;
    expect([nut.qty, nut.unitUsd]).toEqual([18, 0.16]);
  });

  it('prices the Standard fasteners below the Extreme ones', () => {
    const sub = (b: typeof bStd) => b.sections.find((s) => s.id === 'fasteners')!.subtotalUsd;
    expect(sub(bStd)).toBeLessThan(sub(bExt));
    // the #10-32 screw-in insert for hardwood was not found in the research (twice): an estimate that says so
    const ins = lines(bStd).find((l) => /threaded insert/.test(l.key))!;
    expect(ins.basis).toBe('estimate');
    expect(ins.notes).toMatch(/NO 18-8 or zinc #10-32 screw-in insert/);
    // the #8 x 2-1/2 that replaced the #6 is a real quoted screw (D-82)
    const eight = lines(bStd).find((l) => l.key === '18-8 wood screw #8 x 2-1/2"')!;
    expect([eight.basis, eight.unitUsd, eight.qty]).toEqual(['quoted', 0.6, 8]); // D-91: the 16 rail-to-chine screws are trim-head now, a line of their own; the rib knees keep 8
  });
});

describe('Standard hardware', () => {
  const byKey = (k: string): BomLine => lines(bStd).find((l) => l.key === k)!;
  it('prices the 304 hinges, latch and stay, the zinc collars and D-rings, the galvanized eye bolts and chain from the Standard research', () => {
    expect(byKey('seat-hinge').extUsd).toBeCloseTo(12.99, 2); // D-83: Ace 2" stainless pair (check the package for 304)
    expect(byKey('seat-hinge').notes).toMatch(/check the package for 304/);
    expect(byKey('storage-latch').unitUsd).toBeCloseTo(4.895, 3); // Walmart 304 2-pack 9.79
    expect(byKey('storage-lid-stay').unitUsd).toBe(9.99); // D-83: Rockler 6" lid support pair (plated steel); the Sugatsune S-93L stays an alternative
    expect(byKey('storage-lid-stay').alternatives![0].usd).toBe(26.4);
    expect(byKey('storage-hinge').extUsd).toBeCloseTo(5.47, 2); // D-83: Everbilt 2-1/2" stainless pair
    expect(byKey('storage-hinge').notes).toMatch(/check the package for 304/);
    const gaskets = lines(bStd).filter((l) => /^storage-gasket/.test(l.key));
    expect(gaskets.reduce((a, l) => a + l.extUsd, 0)).toBeCloseTo(8.69, 2); // D-83: ONE Frost King 17 ft roll covers all four gasket lines
    const ring = byKey('lash-point'); // D-83: Harbor Freight 1/4" cargo D-rings by the 2-pack, 8 rings = 4 packs
    expect([ring.unitUsd, ring.qty, ring.packQty, ring.needed, ring.extUsd]).toEqual([2.99, 4, 2, 8, 11.96]);
    expect(ring.basis).toBe('quoted');
    expect(byKey('steer-eye').unitUsd).toBe(11.94);
    expect(byKey('steer-anchor').unitUsd).toBe(11.1);
    expect(byKey('steer-chain').unitUsd).toBeCloseTo((10.89 / 12) * 2.12 + 2 * 1.99, 2);
    const collar = lines(bStd).find((l) => /shaft collar/.test(l.key))!;
    expect(collar.key).toMatch(/^zinc-plated/);
    expect(collar.unitUsd).toBe(4.52);
    const insert = lines(bStd).find((l) => /threaded insert/.test(l.key))!;
    expect(insert.key).toMatch(/^zinc /);
    // the model's part names say 316: the Standard BOM says 304
    for (const l of lines(bStd).filter((q) => /snap|pivot/.test(q.key))) expect(l.description).not.toMatch(/316/);
    expect(std304('Brake cord snap hook L (316 stainless)')).toBe('Brake cord snap hook L (304 stainless)');
    // Extreme: 316 eye bolts and chain, 316 collars
    expect(lines(bExt).find((l) => l.key === 'steer-eye')!.unitUsd).toBe(50.77);
    expect(lines(bExt).find((l) => /shaft collar/.test(l.key))!.key).toMatch(/^316/);
  });

  it('lists the beech Dominos from the shop at $0 in both specs, each with a quantity (D-79)', () => {
    for (const b of [bStd, bExt]) {
      const d = lines(b).filter((l) => /^Domino/.test(l.key));
      expect(d.length).toBeGreaterThanOrEqual(2);
      for (const l of d) { expect([l.basis, l.unitUsd, l.extUsd], l.key).toEqual(['owned', 0, 0]); expect(l.qty, l.key).toBeGreaterThan(0); expect(l.packUsd, l.key).toBeUndefined(); }
    }
  });

  it('puts the shop stock on the list at $0, never as an estimate, in both specs (D-79)', () => {
    for (const b of [bStd, bExt]) {
      const owned = lines(b).filter((l) => l.basis === 'owned');
      const keys = owned.map((l) => l.key);
      for (const re of [/^Domino/, /^sandpaper$/, /^supplies$/, /^thinner-/, /^contact-cement$/, /^brake-chock-cord$/, /^brake-stop-cord$/]) expect(keys.some((k) => re.test(k)), `${b.spec} ${re}`).toBe(true);
      for (const l of owned) { expect(l.extUsd, l.key).toBe(0); expect(l.notes, l.key).toContain(OWNED_NOTE); }
      expect(b.estimateUsd).toBeCloseTo(lines(b).filter((l) => l.basis === 'estimate').reduce((a, l) => a + l.extUsd, 0), 2); // owned lines add nothing to the estimate share
    }
    expect(lines(bStd).some((l) => l.key === 'titebond' && l.basis === 'owned')).toBe(true);
  });
});

describe('plywood, from thinSheet(p)', () => {
  it('names the sheet, its glue, its size and its price from the thin sheet in effect', () => {
    for (const [w, m] of [[0, 0], [1, 0], [0, THIN_SHEET.balticBirch3mm], [1, THIN_SHEET.whiteOakPly]] as const) {
      const p: Params = { ...defaultParams(), weatherSpec: w, thinSheetMaterial: m };
      const t = thinSheet(p);
      const b = bom(buildModel(p), p, { noCompare: true });
      const l = b.sections.find((s) => s.id === 'plywood')!.lines.find((q) => q.key === t.priceKey && /thin sheet/.test(q.description))!;
      expect(l, `${w}/${m}`).toBeTruthy();
      expect(l.description).toContain(t.name.replace(/(\d+\/\d+) in\b/, '$1"')); // the shop writes the inch mark
      expect(l.description).toContain(t.glue);
      expect(l.description).toContain(`${t.sheetWidthIn / 12} x ${t.sheetLengthIn / 12} ft`);
      expect(l.unitUsd).toBe(PLYWOOD_PRICE[t.priceKey].usd);
      expect(l.description).not.toMatch(/Marine okoume/); // the deck line is the marine okoume
    }
    const deck = bStd.sections.find((s) => s.id === 'plywood')!.lines.find((q) => q.key === '12 mm')!;
    expect(deck.description).toMatch(/Marine okoume plywood \(BS 1088\)/);
  });
});

describe('the thin-sheet line is priced by priceKey (D-80)', () => {
  const expected: Record<string, number> = { 'baltic-6mm': 49, 'okoume-6mm': 158.65, 'white-oak-1/4': 113, 'baltic-3mm': 40 };
  it('prices each THIN_SHEET option by its own key, in both specs: Peach State Baltic birch $49, Aircraft Spruce okoume $158.65, The Wood Yard white oak ply $113 and 3 mm Baltic $40', () => {
    for (const w of [WEATHER_SPEC.standard, WEATHER_SPEC.extreme]) for (const m of Object.values(THIN_SHEET)) {
      const p: Params = { ...defaultParams(), weatherSpec: w, thinSheetMaterial: m };
      const t = thinSheet(p);
      const b = bom(buildModel(p), p, { noCompare: true });
      const ply = b.sections.find((x) => x.id === 'plywood')!.lines;
      const thin = ply.find((l) => /thin sheet/.test(l.description))!;
      expect(thin.key, `${w}/${m}`).toBe(t.priceKey);
      expect(thin.unitUsd, `${w}/${m}`).toBe(expected[t.priceKey]);
      expect(thin.basis, `${w}/${m}`).toBe('quoted');
      expect(thin.url, `${w}/${m}`).toMatch(/^https:\/\//);
      expect(ply.find((l) => l.key === '12 mm')!.unitUsd).toBe(90); // the deck sheet stays The Wood Yard's
      expect(ply.find((l) => l.key === '12 mm')!.notes ?? '').not.toMatch(/undefined/);
      expect(b.unpriced, `${w}/${m}`).toEqual([]);
    }
    // 6 mm Baltic birch (Standard default) and 6 mm okoume (Extreme default) are the follow-the-weather picks
    expect(thinSheet(std).priceKey).toBe('baltic-6mm');
    expect(thinSheet(ext).priceKey).toBe('okoume-6mm');
    // Peach State's white oak ply and Boulter's okoume are shown as alternatives, not substituted
    expect(PLYWOOD_PRICE['white-oak-1/4'].alternatives![0].usd).toBe(75);
    expect(PLYWOOD_PRICE['okoume-6mm'].alternatives![0].usd).toBe(98);
    expect(PLYWOOD_PRICE['12 mm'].note).toMatch(/Randall Brothers/);
  });
});

describe('the cost pass totals (D-79 to D-83)', () => {
  it('Standard costs about $1,400 to $1,500 and mostly quoted; Extreme about $2,300; the shop stock adds nothing to the estimate', () => {
    expect(bStd.totalUsd).toBeGreaterThan(1350);
    expect(bStd.totalUsd).toBeLessThan(1560);
    expect(bExt.totalUsd).toBeGreaterThan(2000);
    expect(bExt.totalUsd).toBeLessThan(2700);
    expect(bStd.estimateShare).toBeLessThan(0.15);
    expect(bStd.unpriced).toEqual([]);
    expect(bExt.unpriced).toEqual([]);
    // the lumber is Peach State's 4/4 and 5/4 only
    const lum = bStd.sections.find((x) => x.id === 'lumber')!.lines;
    expect(lum.map((l) => [l.key, l.unitUsd, l.basis])).toEqual([['4/4', 8.25, 'quoted'], ['5/4', 10, 'quoted']]);
    // the 2:1 U.S. Composites kit with its pumps and the fumed silica by the quart
    expect(lines(bStd).find((l) => l.key === 'silica')!.unit).toBe('qt');
    expect(lines(bStd).find((l) => l.key === 'epoxy-pumps')!.unitUsd).toBe(8.5);
    // the brake bungee is bought by the foot, not by the roll; the D-rings by the 2-pack
    const cord = lines(bStd).find((l) => l.key === 'brake-cord')!;
    expect([cord.unit, cord.unitUsd]).toEqual(['ft', 0.19]);
    expect(lines(bStd).find((l) => l.key === 'lash-point')!.unit).toBe('pack of 2');
  });
});

describe('finishing schedule by spec', () => {
  const sS = finishingSchedule(stdParts, std);
  const sE = finishingSchedule(extParts, ext);

  it('classes each thin sheet as itself by thinSheet(p): 6 mm Baltic birch (Standard) is birch, white oak plywood is not okoume', () => {
    const web = stdParts.find((x) => x.id === 'side-L-web')!;
    expect(finishMaterial(web, std)).toBe('birch');
    expect(finishMaterial(extParts.find((x) => x.id === 'side-L-web')!, ext)).toBe('okoume');
    expect(finishMaterial(stdParts.find((x) => x.id === 'deck')!, std)).toBe('okoume');
    const oakPly: Params = { ...defaultParams(), thinSheetMaterial: THIN_SHEET.whiteOakPly };
    expect(finishMaterial(buildModel(oakPly).find((x) => x.id === 'side-L-web')!, oakPly)).toBe('oakPly');
    const baltic: Params = { ...defaultParams(), thinSheetMaterial: THIN_SHEET.balticBirch3mm };
    expect(finishMaterial(buildModel(baltic).find((x) => x.id === 'side-L-web')!, baltic)).toBe('birch');
    const a = finishAreas(stdParts, std);
    expect(a.birchFt2).toBeGreaterThan(10);
    expect(a.okoumeFt2).toBeGreaterThan(10); // the 12 mm deck and the seat back
    expect(a.plyFt2).toBeCloseTo(a.okoumeFt2 + a.oakPlyFt2 + a.birchFt2, 9);
    expect(a.totalFt2).toBeCloseTo(a.oakFt2 + a.plyFt2, 9);
    expect(finishAreas(extParts, ext).oakPlyFt2).toBe(0);
    expect(finishAreas(extParts, ext).birchFt2).toBe(0);
  });

  it('Standard coats edges, end grain and the deck underside with epoxy; Extreme saturates all the plywood', () => {
    const eS = sS.steps.find((s) => s.id === 'epoxy')!, eE = sE.steps.find((s) => s.id === 'epoxy')!;
    expect(eE.title).toMatch(/saturation coat/);
    expect(eS.title).toMatch(/edges and end grain, and the deck underside/);
    expect(eS.products[0].areaFt2).toBeLessThan(eE.products[0].areaFt2 / 2);
    expect(eS.products[0].areaFt2).toBeCloseTo(sS.glue.epoxyEdgeFt2 + sS.glue.deckUnderFt2 + 2 * sS.areas.oakEndGrainFt2, 0);
    expect(sS.glue.deckUnderFt2).toBeGreaterThan(5);
    expect(sS.epoxy.coatingFlOz).toBeLessThan(sE.epoxy.coatingFlOz / 2);
  });

  it('Standard topcoat is exterior spar urethane at the can\'s 100 ft2 a quart; Extreme keeps the marine varnish', () => {
    const v = sS.steps.find((s) => s.id === 'varnish')!;
    expect(v.title).toMatch(/Exterior spar urethane/);
    expect(v.products[0].coverageFt2PerQt).toBe(URETHANE_COVERAGE);
    expect(sE.steps.find((s) => s.id === 'varnish')!.products[0].coverageFt2PerQt).toBe(VARNISH_COVERAGE);
    expect(sS.buy.some((b) => /urethane/i.test(b.item))).toBe(true);
    expect(sS.buy.some((b) => /varnish/i.test(b.item) && !/thinner/i.test(b.item))).toBe(false);
    expect(sE.buy.some((b) => /Marine spar varnish/.test(b.item))).toBe(true);
    // 3 coats show, 2 hidden in both
    expect(v.products.map((q) => q.coats)).toEqual([3, 2]);
    expect(urethaneContainers(2.1)).toEqual([{ unit: 'gal', qty: 1, qt: 4 }]); // three quarts cost more than the gallon
    expect(urethaneContainers(1.2)).toEqual([{ unit: 'qt', qty: 2, qt: 2 }]);
    expect(urethaneContainers(4.2).map((c) => `${c.qty} ${c.unit}`)).toEqual(['1 gal', '1 qt']);
  });

  it('Standard takes no stain and no conditioner (D-83): step 3 is the grain-raising pass and the buy list has none; Extreme keeps the stain, the conditioner and the gel stain', () => {
    expect(sS.steps.map((x) => x.id)).toEqual(['offcut-tests', 'sand', 'grain', 'epoxy', 'engrave', 'varnish']);
    const grain = sS.steps.find((x) => x.id === 'grain')!;
    expect(grain.n).toBe(3);
    expect(grain.products).toEqual([]);
    expect(grain.instructions.join(' ')).toMatch(/Skip the stain and the conditioner/);
    expect(sS.buy.some((b) => /stain|conditioner/i.test(b.item))).toBe(false);
    // the lid legend is filled with a paint marker, not enamel
    expect(sS.buy.some((b) => /paint marker/.test(b.item))).toBe(true);
    expect(sS.buy.some((b) => /enamel/i.test(b.item))).toBe(false);
    // Extreme: the oak takes the stain, okoume a conditioner and a gel stain
    const stain = sE.steps.find((x) => x.id === 'stain')!;
    expect(stain.products[0].areaFt2).toBeCloseTo(sE.areas.show.oakFt2 + sE.areas.show.oakPlyFt2, 0);
    expect(stain.products[1].areaFt2).toBeCloseTo(sE.areas.show.okoumeFt2 + sE.areas.show.birchFt2, 0);
    expect(sE.buy.some((b) => /Gel stain/.test(b.item))).toBe(true);
    expect(sE.buy.some((b) => /conditioner/i.test(b.item))).toBe(true);
    // a Baltic birch thin sheet under the Extreme spec blotches: it takes the conditioner too
    const baltic: Params = { ...defaultParams(), weatherSpec: WEATHER_SPEC.extreme, thinSheetMaterial: THIN_SHEET.balticBirch6mm };
    const sB = finishingSchedule(buildModel(baltic), baltic);
    const stainB = sB.steps.find((x) => x.id === 'stain')!;
    expect(sB.areas.birchFt2).toBeGreaterThan(5);
    expect(stainB.products[1].areaFt2).toBeCloseTo(sB.areas.show.okoumeFt2 + sB.areas.show.birchFt2, 0);
    expect(stainB.products[1].name).toMatch(/Baltic birch/);
  });

  it('names the thin sheet, not "4 mm okoume", in the offcut, sanding and engraving text', () => {
    const t1 = sS.steps[0].instructions.join(' ') + sS.steps[1].instructions.join(' ') + sS.steps.find((s) => s.id === 'engrave')!.instructions.join(' ');
    expect(t1).toContain('6 mm Baltic birch');
    expect(t1).not.toMatch(/4 mm/);
    expect(sE.steps[0].instructions.join(' ')).toContain('6 mm okoume');
  });
});

describe('the adhesive of each glue joint', () => {
  it('Standard: epoxy for the bent laminations, the deck, the fillets and the thickened bedding; Titebond for the rest', () => {
    expect(standardAdhesive('lamination', 'rail-L', 'rail-L', '')).toBe('epoxy');
    expect(standardAdhesive('lamination', 'side-L-chine', 'side-L-web', 'thickened epoxy')).toBe('epoxy');
    expect(standardAdhesive('lamination', 'deck', 'joist-2', '')).toBe('epoxy');
    expect(standardAdhesive('dado', 'deck', 'transom-rear', '')).toBe('epoxy');
    expect(standardAdhesive('fillet', 'storage-end-aft', 'storage-side-L', 'tape')).toBe('epoxy');
    expect(standardAdhesive('small', 'scupper-rear-L', 'side-L-chine', '3/8" nipple bedded in epoxy')).toBe('epoxy');
    expect(standardAdhesive('domino', 'joist-2', 'rail-L', 'epoxy')).toBe('titebond');
    expect(standardAdhesive('dado', 'bow-bulkhead', 'side-L-web', '')).toBe('titebond');
    expect(standardAdhesive('tenon', 'rail-L', 'transom-rear', '')).toBe('titebond');
    expect(standardAdhesive('lamination', 'axle-hanger-L', 'rail-L', 'side-grain face, epoxy')).toBe('titebond');
  });

  it('Standard epoxy joints plus Titebond joints cover every joint once; the D-70 face laminations are epoxy', () => {
    const all = glueJointEstimates(stdParts, undefined, std);
    expect(all.filter((g) => g.standard === 'epoxy').length + all.filter((g) => g.standard === 'titebond').length).toBe(all.length);
    expect(glueEpoxyFlOz(stdParts, undefined, std)).toBeCloseTo(all.filter((g) => g.standard === 'epoxy').reduce((a, g) => a + g.flOz, 0), 9);
    expect(glueEpoxyFlOz(stdParts, undefined, ext)).toBeCloseTo(all.reduce((a, g) => a + g.flOz, 0), 9);
    const lam = all.filter((g) => g.a === g.b && /^(beam-F|beam-R|brake-knee|brake-chock)/.test(g.a));
    expect(lam.length).toBeGreaterThanOrEqual(4);
    for (const g of lam) expect(g.standard).toBe('epoxy');
    expect(glueEpoxyFlOz(stdParts)).toBeLessThan(glueEpoxyFlOz(stdParts, undefined, ext)); // without `p` no D-70 lines
    const t = glueTitebond(stdParts, std);
    expect(t.flOz).toBeGreaterThan(5);
    expect(glueTitebond(extParts, ext)).toEqual({ flOz: 0, joints: 0 });
  });
});

describe('the epoxy kits', () => {
  it('Standard takes the cheapest kit family that covers the resin and shows the others with their totals', () => {
    const ep = lines(bStd).filter((l) => /^epoxy-/.test(l.key) && l.key !== 'epoxy-pumps');
    expect(ep.length).toBeGreaterThan(0);
    const cost = ep.reduce((a, l) => a + l.extUsd, 0);
    const alts = ep[0].alternatives ?? [];
    expect(alts.length).toBeGreaterThanOrEqual(2);
    for (const a of alts) expect(a.usd, a.source).toBeGreaterThanOrEqual(cost - 1e-9);
    expect(ep[0].notes).toMatch(/Alternatives \(not substituted\)/);
    expect(alts.map((a) => a.source).join(' ')).toMatch(/West System/);
    // a small 5:1 kit comes with its pumps; a West kit needs the 300 pumps; the U.S. Composites 2:1 kit needs its own $8.50 set. Whichever is bought, exactly one pump line
    const west = ep.some((l) => /^epoxy-(gallon|quart)$/.test(l.key));
    expect(lines(bStd).filter((l) => l.key === 'epoxy-pumps').length).toBe(west || ep.some((l) => /uscomposites/.test(l.key)) ? 1 : 0);
    expect(ep[0].key).toBe('epoxy-uscomposites-635-2-1'); // D-79: the 635 thin epoxy 2:1 is the cheapest family (96 oz mixed for $53.45 plus pumps)
    expect(ep[0].qty).toBe(1);
    // enough resin
    expect(bStd.consumables.resinFlOz).toBeGreaterThan(20);
    expect(bStd.consumables.resinFlOz).toBeLessThan(bExt.consumables.resinFlOz);
    // Extreme considers the 635 kit too: its 96 oz mixed (64 oz resin at 2:1) is cheaper than the West gallon group, which is listed as the alternative
    const eep = lines(bExt).filter((l) => /^epoxy-/.test(l.key) && l.key !== 'epoxy-pumps');
    expect(eep.map((l) => l.key)).toEqual(['epoxy-uscomposites-635-2-1']);
    expect(eep[0].qty).toBe(Math.ceil((bExt.consumables.epoxyFlOz * 2) / 3 / 64 - 1e-9)); // the resin is 2/3 of the mixed epoxy at 2:1, 64 oz a kit
    expect(eep[0].alternatives!.some((a) => a.source === 'West System')).toBe(true);
    expect(lines(bExt).filter((l) => l.key === 'epoxy-pumps').length).toBe(1);
  });
});

describe('assembly text', () => {
  const sStd = assemblySteps(stdParts, std);
  const sExt = assemblySteps(extParts, ext);
  const textOf = (steps: ReturnType<typeof assemblySteps>): string => steps.map((s) => [s.title, ...s.instructions, ...s.checks, s.clampCure ?? ''].join(' ')).join(' ');

  it('Standard says 304 and urethane and has the Titebond glue card and a one-line glue note on the glue steps; Extreme keeps 316 and varnish', () => {
    const t = textOf(sStd);
    expect(t).not.toMatch(/\b316\b/);
    expect(t).not.toMatch(/\bvarnish/i);
    expect(t).toMatch(/urethane/);
    const glue = sStd.filter((s) => s.kind === 'build' && s.clampCure);
    expect(glue.length).toBeGreaterThan(8);
    expect(sStd.find((s) => s.id === 'mill')!.instructions.join(' ')).toMatch(/GLUE CARD[\s\S]*Titebond III/);
    for (const s of glue.filter((q) => !['hang', 'final-fit'].includes(q.id))) expect(s.clampCure, s.id).toMatch(/glue card/); // hang and final-fit use sealant and bedding
    expect(glue.some((s) => /Titebond III/.test(s.clampCure!))).toBe(true);
    expect(glue.some((s) => !/Titebond/.test(s.clampCure!))).toBe(true); // a step with no Titebond joint says nothing about Titebond
    expect(sStd.find((s) => s.id === 'seal')!.instructions.join(' ')).toMatch(/Weather spec: Standard/);
    expect(textOf(sExt)).toMatch(/\b316\b/);
    expect(textOf(sExt)).toMatch(/varnish/i);
    expect(textOf(sExt)).not.toMatch(/Titebond/);
    expect(sExt.find((s) => s.id === 'seal')!.instructions.join(' ')).toMatch(/ONLY the dados/);
  });

  it('rewrites 316 and varnish words', () => {
    expect(standardText('2 x 1/4" 316 bolts; varnished, Varnish dry, varnishing the varnish')).toBe('2 x 1/4" 304 bolts; coated, Urethane dry, coating the urethane');
  });
});

describe('the build book', () => {
  it('shows the active spec, the comparison line and the difference by section', () => {
    const html = buildBookHtml(new BuildData(stdParts, std, { date: '2026-10-12' }));
    expect(html).toContain('Weather spec: Standard');
    expect(html).toContain('Extreme adds $');
    expect(html).toContain('Extreme minus Standard');
    expect(html).toContain('6 mm Baltic birch');
    expect(html).toContain('shop stock');
    expect(html).not.toMatch(/marine okoume \(BS 1088\), 4 × 8 ft/);
    const htmlE = buildBookHtml(new BuildData(extParts, ext, { date: '2026-10-12' }));
    expect(htmlE).toContain('Weather spec: Extreme weather');
  });
});

describe('cost critic round 2: Standard metal, notes, shipping and tax', () => {
  const metalLines = (b: Bom): BomLine[] => b.sections.find((x) => x.id === 'metal')!.lines;

  it('Standard prices its stainless stock at the researched 304 pieces, not the 316 rows', () => {
    // the cut-list section reads "18-8 (304) stainless ...": the 316 guard once missed it
    expect(metalPrice('18-8 (304) stainless flat bar 1/4" x 2"', 'standard')!.packUsd).toBe(19.95);
    expect(metalPrice('18-8 (304) stainless flat bar 1/8" x 2"', 'standard')!.packUsd).toBe(9.23);
    expect(metalPrice('18-8 (304) stainless angle 1-1/2" x 1-1/2" x 1/8"', 'standard')!.packUsd).toBe(7.75);
    expect(metalPrice('316 stainless flat bar 1/4" x 2"', 'standard')!.packUsd).toBe(19.95); // a 316 section text reaches the same 304 row under Standard
    expect(metalPrice('316 stainless flat bar 1/4" x 2"', 'extreme')!.usd).toBeCloseTo(23.28, 2); // Extreme keeps the 316 price
    const std = metalLines(bStd);
    const ext = metalLines(bExt);
    const ext316 = (re: RegExp): BomLine => ext.find((l) => re.test(l.key))!;
    const std304 = (re: RegExp): BomLine => std.find((l) => re.test(l.key))!;
    expect(std304(/flat bar 1\/4" x 2"/).extUsd).toBe(19.95);
    expect(std304(/flat bar 1\/8" x 2"/).extUsd).toBe(9.23);
    expect(std304(/angle/).extUsd).toBe(7.75);
    expect(std304(/flat bar 1\/4" x 2"/).basis).toBe('quoted');
    expect(std304(/flat bar 1\/8" x 1-1\/4"/).basis).toBe('estimate'); // no 304 1/8" x 1-1/4" bar was found
    // each Standard 304 line is cheaper than its 316 line, and the three together are about $25 less than the old 85 % estimates plus 316 pieces
    for (const re of [/flat bar 1\/4" x 2"/, /flat bar 1\/8" x 2"/, /angle/]) expect(std304(re).extUsd, String(re)).toBeLessThan(ext316(re).extUsd);
    for (const l of std.filter((q) => /stainless/.test(q.key) && !/1\/16/.test(q.key))) expect(l.notes ?? '', l.key).not.toMatch(/85 %|no 304 stock was researched/);
  });

  it('the Baltic birch price note makes no ply or glue claim the vendor list does not', () => {
    const note = PLYWOOD_PRICE['baltic-6mm'].note ?? '';
    expect(note).not.toMatch(/\b5 ply\b/);
    expect(note).toMatch(/Count the plies at an edge \(5 expected; the side-web margin assumes 5-ply\), measure 6\.0 to 6\.5 mm, and ask the glue/);
  });

  it('every total says it excludes shipping and tax, and the orders that ship are named', () => {
    for (const b of [bStd, bExt]) {
      expect(b.totalsText).toMatch(/, excluding shipping and tax$/);
      expect(b.csv).toContain('excluding shipping and tax');
      expect(b.shippingNote).toMatch(/Shipping and sales tax are not in any price/);
      for (const v of ['U.S. Composites', 'Speedy Metals', 'Online Metals', 'Bolt Depot', 'Knot & Rope Supply', 'Bicycle Warehouse']) expect(b.shippingVendors.join('|'), v).toContain(v);
      expect(b.shippingNote).not.toMatch(/\$\d/); // no shipping number is invented
    }
    expect(lines(bStd).every((l) => !/^(shipping|tax)/i.test(l.key))).toBe(true);
    const book = buildBookHtml(new BuildData(stdParts, std, { date: '2026-10-14' }));
    expect(book).toMatch(/excluding shipping and tax/);
    expect(book).toContain('These orders ship, so freight is extra');
  });

  it('prices that have no source behind them are estimates; the latch catch comes with the latch', () => {
    for (const b of [bStd, bExt]) {
      const by = (k: string): BomLine => lines(b).find((l) => l.key === k)!;
      expect(by('brake-foot-tread').basis).toBe('estimate');
      expect(by('flag-tube').basis).toBe('estimate');
      expect(by('storage-catch').extUsd).toBe(0);
      expect(by('storage-catch').notes).toMatch(/comes with the latch/);
    }
  });

  it('a single epoxy kit with a thin margin says to plan a second kit or a top-up', () => {
    const e = lines(bExt).find((l) => /^epoxy-uscomposites/.test(l.key))!;
    const spare = (e.qty * 96 - bExt.consumables.epoxyFlOz) / (e.qty * 96);
    if (spare < 0.15) expect(e.notes).toMatch(/Thin margin[\s\S]*second kit, or a quart of epoxy as a top-up/);
    else expect(e.notes).not.toMatch(/Thin margin/);
  });

  it('stale text is gone: no wip path in prices, the Rockler item number, no Sipo in the Standard Domino note, hook-and-loop key', () => {
    const k = (b: Bom, key: string): BomLine | undefined => lines(b).find((l) => l.key === key);
    expect(k(bStd, 'storage-lid-stay')!.notes).toMatch(/item 39529/);
    expect(k(bStd, 'storage-lid-stay')!.description).toBe(stdParts.find((x) => x.id === 'storage-lid-stay')!.name.replace(/\b316\b/, '304')); // the BOM follows the part name
    const dom = lines(bStd).filter((l) => /^Domino/.test(l.key));
    expect(dom.length).toBeGreaterThan(0);
    for (const l of dom) expect(`${l.notes} ${l.description}`, l.key).not.toMatch(/sipo/i);
    expect(k(bStd, 'dual-lock')).toBeUndefined();
    const hl = k(bStd, 'hook-and-loop')!;
    expect(hl.notes).toMatch(/BOTH a hook strip and a loop strip/);
    expect(hl.notes).toMatch(/4 ft of 2" hook and 4 ft of 2" loop/);
    expect(k(bStd, 'seat-hinge')!.notes).toMatch(/leaf width and screw holes against the three-insert pattern/);
    expect(k(bExt, 'lash-point')!.notes).toMatch(/estimate; no source; rating unverified/i);
  });
});
