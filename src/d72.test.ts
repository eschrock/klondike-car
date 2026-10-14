/**
 * D-72 (fewer fastener sizes, stock bolt lengths), D-73 (the thin-sheet material and the weather spec) and the D-71 follow-ups (Eric chose the solid 5/8 in rod). Each block pins one change:
 * the wood-screw list (three sizes, every screw inside its stack with its bite), the bolt lengths, the three thin sheets end to end (thickness, bands, dados, box, lid, signs, mass, the web row,
 * the nesting sheet, the cut list, the price), the weather mapping, the rod, and the numbers at the defaults.
 */
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, THIN_SHEET, WEATHER_SPEC, defaultParams, derived, thinSheet, thinSheetKey, validateParams, type Params } from './params';
import { buildModel } from './model';
import { computeLayout } from './model/layout';
import { totalMass } from './model/mass';
import { worldAABB } from './model/bounds';
import { allPlyBlanks, plySheets } from './model/sheets';
import { CARRIAGE_STOCK_IN, EYE_BOLT_STOCK_IN, STD_WOOD_SCREWS, pickWoodScrew, screwFitOk, stockBoltFit } from './model/rear-mount';
import { signKnobPlan } from './model/body';
import { makeCtx } from './model/build-utils';
import { runChecks } from './analysis';
import { cargoCapacity } from './analysis/cargo-capacity';
import { riderSweep } from './analysis/rider-sweep';
import { nestPlywood } from './build/nesting';
import { cutList } from './build/cutlist';
import { bom } from './build/bom';
import { PLYWOOD_PRICE, METAL_PRICE_PER_FT } from './build/prices';
import { verifyChecklist } from './build/verify';
import { assemblySteps } from './build/assembly';
import { PRE_D72 } from './test-fixtures';

const defaults = defaultParams();
const withMat = (m: number): Params => ({ ...defaults, thinSheetMaterial: m });
const OAK = THIN_SHEET.whiteOakPly, OKOUME = THIN_SHEET.okoumeMarine, BALTIC = THIN_SHEET.balticBirch3mm, BALTIC6 = THIN_SHEET.balticBirch6mm; // D-80: the default (Standard) thin sheet is the 6 mm Baltic birch
const sizeKey = (s: string): string | null => /^(?:\d+ [x×] )?(#\d+) [×x] ([\d-/]+)/.exec(s)?.slice(1, 3).join(' x ') ?? null;

describe('D-72: three wood-screw sizes, every screw inside its stack with its bite', () => {
  for (const [name, p] of [['6 mm Baltic birch (the default, D-80)', defaults], ['white oak ply', withMat(OAK)], ['6 mm okoume', withMat(OKOUME)], ['3 mm Baltic', withMat(BALTIC)]] as const) {
    const parts = buildModel(p);
    const screws = parts.flatMap((x) => (x.joints ?? []).filter((j) => j.type === 'screw' && j.fit).map((j) => ({ id: x.id, j })));
    it(`${name}: the wood screws are #8 x 5/8, #8 x 1-1/4 and #8 x 2-1/2 only (D-82: all #8; at most 4 sizes), none longer than its stack, none shorter than its bite`, () => {
      expect(screws.length).toBeGreaterThan(30);
      const sizes = new Set(screws.map(({ j }) => `#${j.fit!.gauge} x ${j.fit!.lenIn}`));
      expect(sizes.size).toBeLessThanOrEqual(4);
      expect([...sizes].sort()).toEqual(['#8 x 0.625', '#8 x 1.25', '#8 x 2.5']);
      for (const { id, j } of screws) {
        const x = j.fit!;
        expect(STD_WOOD_SCREWS.some((s) => s.gauge === x.gauge && s.lenIn === x.lenIn), `${id} -> ${j.to}`).toBe(true);
        expect(x.lenIn, `${id} -> ${j.to} is no longer than its stack`).toBeLessThanOrEqual(x.gripIn + x.receivingIn + 1e-9);
        expect(x.lenIn - x.gripIn, `${id} -> ${j.to} bites at least ${x.minBiteIn}`).toBeGreaterThanOrEqual(x.minBiteIn - 1e-6);
        expect(x.lenIn - x.gripIn, `${id} -> ${j.to} stops short of the far face`).toBeLessThanOrEqual(x.receivingIn - 1 / 16 + 1e-6);
        expect(screwFitOk(x), `${id} -> ${j.to}`).toBe(true);
        expect(sizeKey(j.size ?? ''), `${id} -> ${j.to}: the joint text names the size the BOM reads`).toBe(`#${x.gauge} x ${x.lenIn === 0.625 ? '5/8' : x.lenIn === 1.25 ? '1-1/4' : '2-1/2'}`);
      }
    });
  }
  it('the BOM wood-screw lines: #8 x 5/8, #8 x 1-1/4, #8 x 2-1/2 (D-82) and the lid-batten screw (bom.ts) are all there is; the old 12 sizes are gone', () => {
    const parts = buildModel(defaults);
    const b = bom(parts, defaults);
    const woods = b.sections.flatMap((s) => s.lines).filter((l) => /wood screw/.test(l.key)).map((l) => /#\d+ x [\d-/]+/.exec(l.key)![0]);
    expect(new Set(woods).size).toBeLessThanOrEqual(4);
    for (const w of ['#8 x 5/8', '#8 x 1-1/4', '#8 x 2-1/2']) expect(woods, w).toContain(w);
    for (const gone of ['#10 x 1', '#10 x 2', '#8 x 3/8', '#8 x 1/2', '#8 x 1', '#6 x 3/8', '#6 x 3-1/2', '#10 x 1-1/4', '#6 x 2-1/2' /* D-82: the #8 x 2-1/2 replaces it */]) expect(woods.filter((w) => w === gone), gone).toEqual([]);
  });
  it('the rail-to-chine screw is ONE length (#8 x 2-1/2, D-82); the head is counterbored 1 in up the 3 in rail so the tip still bites 1/2 in, and the forward 1.87 in rail bites 5/8 in', () => {
    const rail = buildModel(defaults).find((x) => x.id === 'rail-L')!;
    const js = rail.joints!.filter((j) => j.type === 'screw');
    expect(js.length).toBe(2);
    expect(new Set(js.map((j) => j.fit!.lenIn))).toEqual(new Set([2.5]));
    const deep = js.find((j) => /counterbore the head 1" up the rail/.test(j.size!))!;
    expect(deep.fit!.lenIn - deep.fit!.gripIn).toBeCloseTo(0.5, 6);
    expect(deep.count).toBe(7); // D-81: a screw in every gap between the tie stations (there are no Dominos to skip); it was 4 in every other gap
    const shallow = js.find((j) => /no counterbore needed/.test(j.size!))!;
    expect(shallow.fit!.lenIn - shallow.fit!.gripIn).toBeCloseTo(0.6345, 3);
  });
  it('pickWoodScrew takes the shortest standard length of the gauge that bites and stays inside', () => {
    expect(pickWoodScrew(8, 0.06, 0.75).lenIn).toBe(0.625); // a hinge leaf into a 3/4 in lid frame
    expect(pickWoodScrew(8, 0.27, 1).lenIn).toBe(1.25); // a leaf and a plywood end into a 1 in backer: 5/8 bites only 0.35 (and 1-1/4 pokes through a 1 in backer: the backer is 1-1/4)
    expect(pickWoodScrew(8, 0.27, 1.25).lenIn).toBe(1.25);
    expect(screwFitOk(pickWoodScrew(8, 0.27, 1.25))).toBe(true);
    expect(screwFitOk(pickWoodScrew(8, 0.27, 1))).toBe(false);
    expect(pickWoodScrew(8, 0.125, 1.5, 0.875).lenIn).toBe(1.25); // the lash plate: the lash-load row counts 0.875 in of thread
  });
  it('hardware into thin stock is #8 x 5/8; the hinge backer is 1-1/4 in so the hinge screw cannot poke into the box; the flag tube takes no screws', () => {
    const parts = buildModel(defaults);
    const get = (id: string) => parts.find((x) => x.id === id)!;
    const bk = worldAABB(get('storage-hinge-backer-L'));
    expect(bk.max[0] - bk.min[0]).toBeCloseTo(1.25, 6);
    expect(get('storage-hinge-L').joints!.find((j) => j.to === 'storage-rim-end-fore')!.size).toMatch(/^#8 × 5\/8 /);
    expect(get('storage-hinge-L').joints!.find((j) => /hinge-backer/.test(j.to))!.size).toMatch(/^#8 × 1-1\/4 /);
    expect(get('storage-latch-L').joints![0].size).toMatch(/^#8 × 5\/8 /);
    expect(get('storage-catch-L').joints![0].size).toMatch(/^#8 × 5\/8 /);
    expect(get('storage-lid-stay').joints!.every((j) => /^#8 × 5\/8 /.test(j.size!))).toBe(true);
    expect(get('flag-tube').joints!.some((j) => j.type === 'screw')).toBe(false);
    expect(get('flag-block-top').joints!.some((j) => j.type === 'screw')).toBe(false);
    // the brake: pivot block, shoe and pad all take the #8 x 1-1/4 (the old #10 x 2 shoe screw ran 0.37 in through the 7/8 in flap)
    for (const id of ['brake-pivot-block-L', 'brake-shoe-L', 'brake-pad-L']) for (const j of get(id).joints!.filter((q) => q.type === 'screw' && q.fit)) expect(j.size, id).toMatch(/#8 × 1-1\/4/);
    // the lash plates (D-76: through-bolted, no wood screws; D-83: 1/4-20 bolts) and the roll pads; the rib knees take the #8 x 2-1/2 (D-82)
    expect(get('lash-L1').joints![0].size).toMatch(/^1\/4-20 x 2" /); // D-83: two 1/4-20 button-head bolts a D-ring (it was #8-32)
    expect(get('side-rib-knee-L2').joints!.find((j) => j.type === 'screw')!.size).toMatch(/^#8 × 2-1\/2 /);
    expect(get('roll-pad-L').joints![0].size).toMatch(/2 × #8 × 1-1\/4 /);
    expect(get('king-thrust').joints!.find((j) => j.type === 'screw')!.size).toMatch(/3 × #8 × 1-1\/4 /);
  });
  it('the lash row passes (D-76: through-bolts; D-83: 0.61 at the 233 lbf D-ring rating, 0.77 at 300 lbf), and the brake pivot-block row too', () => {
    const cs = runChecks(defaults, { includeTruck: false });
    expect(cs.find((c) => c.id === 'lash-load')!.util!).toBeCloseTo(0.605, 2); // D-83: 0.605 with the 233 lbf D-ring load (0.767 at 300 lbf)
    expect(cs.find((c) => c.id === 'lash-load')!.status).toBe('pass');
    expect(cs.find((c) => c.id === 'brake-pivot')!.status).toBe('pass');
    expect(cs.find((c) => c.id === 'brake-flap')!.status).toBe('pass');
  });
  it('one #10-32 insert: 5/16 in for the seat back and the sign backers; the sign knob screw is the 1 in thumb-knob (a stocked length) with the white oak web', () => {
    const j = buildModel(defaults).find((x) => x.id === 'sign-L')!.joints!.find((q) => q.type === 'knob')!;
    expect(j.size).toMatch(/#10-32 × 1 in thumb-knob/);
    const kn = signKnobPlan(makeCtx(defaults));
    expect(kn.insertLenIn).toBeCloseTo(5 / 16, 9);
    expect(kn.lenIn).toBe(1);
    expect(kn.engagedIn).toBeLessThanOrEqual(kn.insertLenIn + 1e-9);
    expect(kn.tipShortIn).toBeGreaterThanOrEqual(0.125);
    expect(signKnobPlan(makeCtx(withMat(OKOUME))).lenIn).toBe(1); // D-80: the 6 mm okoume web is as thick as the Baltic: the same 1 in knob
    expect(signKnobPlan(makeCtx({ ...defaults, ...PRE_D72 } as Params)).lenIn).toBe(0.875); // the 4 mm okoume (PRE_D72) takes the shorter 7/8 in knob
  });
});

describe('D-72: bolts and eye bolts at stock lengths', () => {
  const parts = buildModel(defaults);
  const boltSizes = (re: RegExp): Set<string> => new Set(parts.flatMap((x) => (x.joints ?? []).filter((j) => j.type === 'bolt' && re.test(j.size ?? '')).map((j) => /(?:0\.\d+"|\d\/\d+-\d+) [×x] ([\d-/]+)/.exec(j.size!)?.[1] ?? '?')));
  it('1/4-20: the hanger and the hold-down upright bolts are the same 2-1/4 (leg + hanger + rail); the others are the T-nut 1-1/4, the grips 2, the beam 3', () => {
    const hd = parts.find((x) => x.id === 'beam-hold-down-L')!;
    expect(hd.joints!.find((j) => /axle-hanger/.test(j.to))!.size).toMatch(/^0\.25" × 2-1\/4 .*through the upright leg, the hanger and the rail/);
    expect(hd.joints!.find((j) => j.to === 'beam-R')!.size).toMatch(/^0\.25" × 2-3\/4 /); // D-74: 2-3/4 through the 2-1/8 in beam (3 through the 2-1/4 in beam before)
    // one bolt per position, recorded once (on the angle): the hanger carries no bolt joint of its own, so the BOM does not count the pair twice
    expect(parts.find((x) => x.id === 'axle-hanger-L')!.joints!.some((j) => j.type === 'bolt')).toBe(false);
    expect([...boltSizes(/^0\.25"|1\/4-20/)].sort()).toEqual(['1-1/4', '2', '2-1/4', '2-3/4']); // 5 lengths before (1-1/4, 1-1/2, 2, 2-1/4, 3): four is what the stacks allow
  });
  it('3/8-16 hex bolts: two lengths (the clamp plates 3-1/4, the brake knees 4); the carriage bolt is the stock 6-1/2 (6 stops 1/16 in short of the top of the nylock nut)', () => {
    expect([...boltSizes(/0\.38" [×x] [\d-/]+ (?:316|18-8 \(304\) stainless) hex bolts|0\.38" x [\d-/]+" (?:316|18-8 \(304\) stainless) hex bolts/)].filter((s) => s !== '?').sort()).toEqual(['3-1/4', '4']);
    const fit = stockBoltFit(3 + 2.5, 0.375, 1, CARRIAGE_STOCK_IN);
    expect(fit.needIn).toBeCloseTo(5.5 + 0.0625 + 0.5 + 1.5 / 16, 6);
    expect(fit.stockIn).toBe(6.5);
    expect(fit.pastNutIn).toBeLessThan(0.5);
    expect(6 - 5.5 - 0.0625).toBeLessThan(0.5); // the 6 in bolt: the tip is below the top of the 0.5 in nut
    const tongue = parts.find((x) => x.id === 'bridle-tongue')!.joints!.find((j) => j.type === 'bolt' && j.to === 'beam-F')!;
    expect(tongue.size).toMatch(/0\.38" × 6-1\/2 (?:316|18-8 \(304\) stainless) carriage bolts/);
    expect(parts.find((x) => x.id === 'beam-F')!.joints!.filter((j) => /carriage/.test(j.size ?? '')).every((j) => /6-1\/2/.test(j.size!))).toBe(true);
  });
  it('shoulder eye bolts: 4-1/2 for the axle beam (it needs 3.16: cut to 3-1/4 after fitting), 2-1/2 for the chain joist (it needs 1.97)', () => {
    const beam = stockBoltFit(defaults.frontBeamThicknessIn, defaults.steerEyeBoltDiaIn, 1, EYE_BOLT_STOCK_IN);
    const anchor = stockBoltFit(defaults.chainJoistThickIn, defaults.steerEyeBoltDiaIn, 2, EYE_BOLT_STOCK_IN);
    expect(beam.needIn).toBeCloseTo(2.5 + 0.0625 + 0.5 + 1.5 / 16, 6); // 3.16
    expect(beam.stockIn).toBe(4.5);
    expect(beam.pastNutIn).toBeCloseTo(4.5 - 3.0625, 6); // 1.44 in of thread: too long
    expect(beam.cutToIn).toBe(3.25);
    expect(anchor.needIn).toBeCloseTo(1.25 + 0.125 + 0.5 + 1.5 / 16, 6); // 1.97
    expect(anchor.stockIn).toBe(2.5);
    expect(anchor.cutToIn).toBe(2);
    expect(parts.find((x) => x.id === 'steer-eye-L')!.sourcing!.vendor).toMatch(/3\/8" x 4-1\/2" stock, cut to 3-1\/4" under the shoulder after fitting \(1\.44" of thread/);
    expect(parts.find((x) => x.id === 'steer-anchor-L')!.sourcing!.vendor).toMatch(/3\/8" x 2-1\/2" stock/);
    // neither bolt reaches the wheel (the inner tire face is at 13.25 in, the eyes at 8 in), and the cut bolt stands 0.09 in past the nut
    expect(defaults.steerChainBeamYIn + 0.5).toBeLessThan(defaults.frontTrackIn / 2 - defaults.tireWidthIn / 2);
  });
  it('the verify items carry the stock lengths', () => {
    const v = verifyChecklist(parts, defaults);
    expect(v.find((c) => c.id === 'steering-parts')!.whatToDo).toMatch(/buy the stock 4-1\/2" and CUT it to 3-1\/4"/);
    expect(v.find((c) => c.id === 'steering-parts')!.whatToDo).toMatch(/buy the stock 2-1\/2"/);
    expect(v.find((c) => c.id === 'bridle')!.whatToDo).toMatch(/stock length is 6-1\/2"/);
  });
});

describe('D-73: the thin-sheet material and the weather spec', () => {
  it('the params: weatherSpec (Standard 0, Extreme 1) and thinSheetMaterial (follow the weather setting, white oak, okoume, 3 mm Baltic, 6 mm Baltic) with their notes and statuses', () => {
    expect(defaults.weatherSpec).toBe(WEATHER_SPEC.standard);
    expect(defaults.thinSheetMaterial).toBe(THIN_SHEET.followWeather);
    expect(PARAM_DEFS.weatherSpec.options!.map((o) => o.value)).toEqual([0, 1]);
    expect(PARAM_DEFS.weatherSpec.note).toMatch(/garage-kept, used a few times a year, gets wet at most at a rainy derby \(Eric, 2026-10-12\)/);
    expect(PARAM_DEFS.weatherSpec.note).toMatch(/stored outside or near salt/);
    expect(PARAM_DEFS.thinSheetMaterial.options!.map((o) => o.label)).toEqual(['Follow the weather setting', '1/4" white oak plywood', '6 mm okoume marine', '1/8" (3 mm) Baltic birch', '6 mm (1/4") Baltic birch']); // D-80: the okoume option and the new 6 mm Baltic
    expect(PARAM_DEFS.whiteOakPlyThickIn.default).toBe(0.21);
    expect(PARAM_DEFS.whiteOakPlyThickIn.status).toBe('verify');
    expect(PARAM_DEFS.whiteOakPlyThickIn.note).toMatch(/measure the sheet/i);
    expect(PARAM_DEFS.whiteOakPlyDensityPcf.default).toBe(40);
    expect(PARAM_DEFS.whiteOakPlyDensityPcf.note).toMatch(/core varies/);
    expect(PARAM_DEFS.whiteOakPlyMoePsi.status).toBe('assumed');
    expect(PARAM_DEFS.whiteOakPlyMoePsi.note).toMatch(/ESTIMATE/);
    expect(PARAM_DEFS.whiteOakPlyMorPsi.note).toMatch(/ESTIMATE/);
    expect(PARAM_DEFS.balticThinThickIn.default).toBe(0.118);
    // D-80: the note names the sheets and the follow-the-weather rule; the prices live in prices.ts (PLYWOOD_PRICE)
    expect(PARAM_DEFS.thinSheetMaterial.note).toMatch(/Standard is 6 mm \(1\/4 in\) Baltic birch/);
    expect(PARAM_DEFS.thinSheetMaterial.note).toMatch(/Extreme is 6 mm okoume BS 1088/);
    expect(PARAM_DEFS.thinSheetMaterial.note).toMatch(/1\/4 in white oak plywood \(about 0\.21 in real, interior glue\)/);
    expect(PARAM_DEFS.thinSheetMaterial.note).toMatch(/3 mm Baltic birch \(0\.118 in, 5 x 5 ft sheet\)/);
    expect(PARAM_DEFS.balticSixThickIn.default).toBe(0.236);
    expect(PARAM_DEFS.balticSixThickIn.status).toBe('verify');
    expect(PARAM_DEFS.balticSixThickIn.note).toMatch(/MEASURE THE SHEET/);
    expect(defaults.birchDensityPcf).toBe(42);
  });
  it('"follow the weather setting": Standard is 6 mm Baltic birch (D-80; it was white oak plywood), Extreme weather is 6 mm okoume; an explicit choice wins', () => {
    expect(thinSheetKey(defaults)).toBe(BALTIC6);
    expect(thinSheetKey({ ...defaults, weatherSpec: WEATHER_SPEC.extreme })).toBe(OKOUME);
    expect(thinSheetKey({ ...defaults, weatherSpec: WEATHER_SPEC.extreme, thinSheetMaterial: BALTIC })).toBe(BALTIC);
    expect(thinSheetKey({ ...defaults, thinSheetMaterial: OAK, weatherSpec: WEATHER_SPEC.extreme })).toBe(OAK);
    expect(thinSheet({ ...defaults, weatherSpec: WEATHER_SPEC.extreme }).thicknessIn).toBe(0.236);
    expect(thinSheet(defaults)).toMatchObject({ thicknessIn: 0.236, densityPcf: 42, sheetWidthIn: 48, sheetLengthIn: 96, priceKey: 'baltic-6mm' });
    expect(thinSheet(withMat(OAK))).toMatchObject({ thicknessIn: 0.21, densityPcf: 40, sheetWidthIn: 48, sheetLengthIn: 96, priceKey: 'white-oak-1/4' });
    expect(thinSheet(withMat(BALTIC))).toMatchObject({ thicknessIn: 0.118, densityPcf: 42, sheetWidthIn: 60, sheetLengthIn: 60, priceKey: 'baltic-3mm' });
    expect(thinSheet(withMat(OKOUME))).toMatchObject({ thicknessIn: 0.236, densityPcf: 33, sheetWidthIn: 48, sheetLengthIn: 96, priceKey: 'okoume-6mm' });
    expect(thinSheet({ ...defaults, ...PRE_D72 } as Params)).toMatchObject({ thicknessIn: 0.157, nominal: '4 mm', priceKey: 'okoume-6mm' }); // the 4 mm okoume (PRE_D72) is still built; the BOM prices it as 'okoume-4mm' (bom.ts)
    expect(derived(defaults).thinPlyIn).toBe(0.236);
    expect(derived(defaults).plyDensityPcf).toBe(33); // the 12 mm deck and seat back stay marine okoume
  });

  for (const [name, m, t, dens, band] of [['white oak plywood', OAK, 0.21, 40, 0.2075], ['6 mm okoume', OKOUME, 0.236, 33, 0.1945], ['3 mm Baltic birch', BALTIC, 0.118, 42, 0.2535], ['6 mm Baltic birch (the Standard default, D-80)', BALTIC6, 0.236, 42, 0.1945]] as const) {
    describe(name, () => {
      const p = withMat(m);
      const parts = buildModel(p);
      const get = (id: string) => parts.find((x) => x.id === id)!;
      it('the web, the dados, the bands, the box, the lid and the signs all follow the thickness', () => {
        const L = computeLayout(p);
        expect(L.sideBand).toBeCloseTo(band, 4); // (side - web) / 2
        expect(2 * L.sideBand + t).toBeCloseTo(L.side, 9);
        for (const tag of ['L', 'R']) {
          for (const id of [`side-${tag}-chine`, `side-${tag}-chine-in`, `side-${tag}-gunwale`, `side-${tag}-gunwale-in`]) expect(get(id).stock!.t).toBeCloseTo(band, 4);
          expect(get(`side-${tag}-web`).stock!.t).toBeCloseTo(t, 6);
        }
        const lid = worldAABB(get('storage-lid'));
        expect(lid.max[2] - lid.min[2]).toBeCloseTo(t, 6);
        const sign = get('sign-L').geometry;
        expect(sign.type === 'box' && sign.size[1]).toBeCloseTo(t, 6);
        for (const id of ['storage-side-L', 'storage-end-fore']) expect(get(id).stock!.t).toBeCloseTo(t, 6);
        expect(get('deck').stock!.t).toBeCloseTo(0.472, 6); // the 12 mm deck stays marine
        expect(get('seat-back-panel').stock!.t).toBeCloseTo(0.472, 6);
        // the web dado is the thin sheet + the slop
        const dado = get('side-L-chine').joints!.concat(get('transom-rear').joints!).find((j) => j.type === 'dado' && /web|panel/i.test(`${j.to} ${j.size}`));
        expect(dado).toBeDefined();
      });
      it('the thin parts weigh their density: 9 pieces, the web, box, lid and signs', () => {
        const thin = parts.filter((x) => x.kind === 'sheet' && x.stock && x.stock.t < 0.3);
        expect(thin.length).toBe(9);
        for (const x of thin) {
          expect(x.material).toBe(thinSheet(p).material);
          const area = x.stock!.w * x.stock!.l; // the blank, in²: an upper bound of the part
          expect(x.massLb).toBeLessThan((area * t * dens) / 1728 + 0.5);
        }
        const lidMass = get('storage-lid').massLb;
        const lb = worldAABB(get('storage-lid'));
        const vol = (lb.max[0] - lb.min[0]) * (lb.max[1] - lb.min[1]) * (lb.max[2] - lb.min[2]);
        expect(lidMass).toBeCloseTo((vol / 1728) * dens + (2 * (lb.max[0] - lb.min[0]) * (lb.max[1] - lb.min[1]) + 2 * (lb.max[2] - lb.min[2]) * ((lb.max[0] - lb.min[0]) + (lb.max[1] - lb.min[1]))) / 144 * p.finishLbPerFt2, 3);
        expect(get('deck').material).toBe('okoume marine plywood');
      });
      it('the side-web row uses the material ACROSS its face grain (D-76): kick / lean on the bare web; everything but the 3 mm Baltic passes (D-80: the 6 mm sheets pass; the 4 mm okoume failed)', () => {
        const row = runChecks(p, { includeTruck: false }).find((c) => c.id === 'side-web')!;
        expect(row.status).toBe(m === BALTIC ? 'fail' : 'pass'); // D-76 finding: the 3-ply webs are weak across the grain; D-80: the 5-ply 6 mm sheets are not
        expect(row.label).toContain(thinSheet(p).nominal);
        expect(row.how).toContain(`${(t * 25.4).toFixed(1)} mm`);
        expect(row.details![0].limit).toBeCloseTo(((m === OAK ? p.whiteOakPlyMorPerpPsi : m === OKOUME ? p.okoumeMorPerpPsi : m === BALTIC6 ? p.balticSixMorPerpPsi : p.balticThinMorPerpPsi) * p.wetServiceFactorStrength) / p.woodSafetyFactor, 6);
      });
      it('validates clean; nests on one sheet of its own size with no grain turned; the cut list and the BOM name the sheet and its price', () => {
        expect(validateParams(p).filter((i) => i.severity !== 'info')).toEqual([]);
        const nest = nestPlywood(parts, p);
        expect(nest.unplaced).toEqual([]);
        expect(nest.grainTurned).toEqual([]);
        const thinSheetNested = nest.sheets.find((s) => s.label === thinSheet(p).name)!;
        expect(thinSheetNested).toBeDefined();
        expect([thinSheetNested.widthIn, thinSheetNested.lengthIn]).toEqual([thinSheet(p).sheetWidthIn, thinSheet(p).sheetLengthIn]);
        expect(nest.sheets.filter((s) => s.thicknessMm === thinSheetNested.thicknessMm).length).toBe(1);
        expect(thinSheetNested.placements.length).toBe(9);
        const blanks = allPlyBlanks(parts, p);
        for (const b of blanks) expect(b.fits, b.id).toBe(true);
        expect(plySheets(blanks)).toEqual({ [Math.round(t * 25.4)]: 1, 12: 1 });
        const cl = cutList(parts, p);
        expect(cl.sheets.map((s) => s.label)).toEqual([`${Math.round(t * 25.4)} mm`, '12 mm']);
        const price = PLYWOOD_PRICE[thinSheet(p).priceKey];
        expect(price.usd).toBe(m === OAK ? 113 : m === OKOUME ? 158.65 : m === BALTIC6 ? 49 : 40); // D-79/D-80 prices: Aircraft Spruce 6 mm okoume, Peach State 6 mm Baltic
        const b = bom(parts, p);
        const ply = b.sections.find((s) => s.id === 'plywood')!.lines;
        expect(ply[0].unitUsd).toBe(price.usd);
        expect(ply.reduce((a, l) => a + l.extUsd, 0)).toBeCloseTo(price.usd + 90, 6);
      });
    });
  }

  it('the Baltic birch web blank (about 59.6 in) nests on the 60 x 60 sheet, two webs plus the box and signs', () => {
    const p = withMat(BALTIC);
    const web = buildModel(p).find((x) => x.id === 'side-L-web')!;
    expect(web.stock!.l).toBeGreaterThan(59);
    expect(web.stock!.l).toBeLessThan(59.9);
    const nest = nestPlywood(buildModel(p), p);
    const s = nest.sheets.find((q) => q.label === '3 mm Baltic birch')!;
    expect(s.utilizationPct).toBeGreaterThan(40);
    for (const q of s.placements) expect(Math.max(...q.outer.map((o) => o[0]))).toBeLessThanOrEqual(60 - nest.kerfIn + 1e-6);
  });

  it('the four materials side by side (empty mass, thin parts, web row): 6 mm Baltic (the default, D-80) 121.64 lb, white oak 120.31 lb, 6 mm okoume 119.55 lb, 3 mm Baltic 117.54 lb (D-83 removed the cushion vinyl and cover, the 2 in clamp plates added a little; D-77: +0.87 lb the pivot straps and the knee roofs; D-76: +0.96 lb the ribs)', () => {
    const rows = [BALTIC6, OAK, OKOUME, BALTIC].map((m) => {
      const p = withMat(m);
      const parts = buildModel(p);
      const thin = parts.filter((x) => x.kind === 'sheet' && x.stock && x.stock.t < 0.3).reduce((a, x) => a + x.massLb, 0);
      return { total: totalMass(parts), thin, web: runChecks(p, { includeTruck: false }).find((c) => c.id === 'side-web')!.util! };
    });
    expect(rows[0].total).toBeCloseTo(121.64, 1);
    expect(rows[1].total).toBeCloseTo(120.31, 1); // D-77: 121.09 with the old seat pads and 1.75 in plates
    expect(rows[2].total).toBeCloseTo(119.55, 1); // the 6 mm okoume (118.28 for the 4 mm before D-80)
    expect(rows[3].total).toBeCloseTo(117.54, 1);
    expect(rows[0].thin).toBeCloseTo(11.70, 1);
    expect(rows[1].thin).toBeCloseTo(10.16, 1);
    expect(rows[2].thin).toBeCloseTo(9.60, 1);
    expect(rows[3].thin).toBeCloseTo(6.64, 1);
    // D-76: the web row reads the across-grain strength (the face grain runs along the side). D-80: the 6 mm 5-ply sheets pass with room (the 4 mm okoume was 2.01 and the 3 mm Baltic is still 4.84)
    expect(rows[0].web).toBeCloseTo(0.33, 2);
    expect(rows[1].web).toBeCloseTo(0.61, 2);
    expect(rows[2].web).toBeCloseTo(0.44, 2);
    expect(rows[3].web).toBeCloseTo(4.84, 2);
  });

  it('a thick custom okoume sheet (the old panelPlyIn) still works through the okoume option, and panelPlyIn is ignored by the others', () => {
    expect(thinSheet({ ...defaults, thinSheetMaterial: OKOUME, panelPlyIn: 0.354 }).thicknessIn).toBe(0.354);
    expect(thinSheet({ ...defaults, panelPlyIn: 0.354 }).thicknessIn).toBe(0.236); // the Standard default is the 6 mm Baltic birch (D-80), whatever panelPlyIn says
  });
});

describe('D-71: the solid 5/8 in rod (Eric)', () => {
  const parts = buildModel(defaults);
  it('axleWallIn is 0; the axle parts are named for the rod; the cut list and the price say "5/8 solid 1045 / CDS steel rod (cut to length)"', () => {
    expect(defaults.axleWallIn).toBe(0);
    for (const id of ['axle-R', 'axle-FL', 'axle-FR']) {
      const x = parts.find((q) => q.id === id)!;
      expect(x.material).toBe('1045 / CDS steel rod');
      expect(x.sourcing!.vendor).toMatch(/5\/8" solid 1045 \/ CDS steel rod \(cut to length\)/);
      expect(x.sourcing!.vendor).toMatch(/NOT hot-rolled A36/);
      expect(x.notes).toMatch(/solid 1045 \/ CDS steel rod, cut to length \(no end plugs/);
      expect(x.notes).not.toMatch(/plug or cap the ends/);
    }
    const cl = cutList(parts, defaults);
    const axles = cl.metal.filter((r) => /^(axle-R|stub-axle)/.test(r.partNo));
    expect(axles.length).toBeGreaterThan(0);
    for (const r of axles) {
      expect(r.family).toBe('Steel rod');
      expect(r.section).toBe('5/8" solid 1045 / CDS steel rod (cut to length)');
    }
    const price = METAL_PRICE_PER_FT.find((q) => q.match.test('5/8" solid 1045 / CDS steel rod (cut to length)'))!.price;
    expect(price.basis).toBe('quoted'); // D-79: Speedy Metals 60 in piece, read in the cost-pass research (it was an estimate)
    expect(price.note).toMatch(/1045 mill cert/);
    expect(price.note).not.toMatch(/ESTIMATE/);
    const b = bom(parts, defaults);
    expect(b.sections.find((s) => s.id === 'metal')!.lines.some((l) => /solid 1045/.test(l.description) && l.basis === 'quoted')).toBe(true);
    expect(b.sections.flatMap((s) => s.lines).some((l) => /end plug/i.test(l.key))).toBe(false); // no end plugs for a solid rod
  });
  it('the verify item is the light rod check, not the tube yield; the tube item appears only with a tube', () => {
    const v = verifyChecklist(parts, defaults);
    const rod = v.find((c) => c.id === 'axle-rod')!;
    expect(rod.title).toBe('Axle rod: 5/8" 1045 or cold-drawn steel (not hot-rolled A36)');
    expect(v.some((c) => c.id === 'axle-tube')).toBe(false);
    expect(rod.paramKeys).toEqual(['axleYieldPsi', 'axleUltimatePsi']);
    expect(PARAM_DEFS.axleYieldPsi.status).toBe('verify');
    const tubeList = verifyChecklist(buildModel({ ...defaults, ...PRE_D72 }), { ...defaults, ...PRE_D72 });
    expect(tubeList.find((c) => c.id === 'axle-tube')!.title).toMatch(/Axle tube: DOM A513 Type 5, 5\/8" × 0\.12" \(not ERW\)/);
  });
  it('the wheel verify item measures the hub length and confirms the 5/8 in bore and the 300 lb rating', () => {
    const w = verifyChecklist(parts, defaults).find((c) => c.id === 'wheel')!;
    expect(w.title).toMatch(/Harbor Freight/);
    expect(w.whatToDo).toMatch(/MEASURE THE HUB LENGTH/);
    expect(w.whatToDo).toMatch(/2-1\/4" is assumed/);
    expect(w.pass).toMatch(/Bore = 5\/8"/);
    expect(w.pass).toMatch(/Rating ≥ 300 lb/);
    expect(w.pass).not.toMatch(/does not fit/);
  });
  it('the assembly steps say 5/8" and rod, and the groove and the proud are the params (0.595 in = 19/32, 0.03 in = 1/32)', () => {
    const steps = assemblySteps(parts, defaults);
    const text = steps.flatMap((s) => s.instructions).join(' ');
    expect(text).toMatch(/5\/8" wide × 19\/32" deep, so the 5\/8" rod stands 1\/32" proud/);
    expect(text).toMatch(/shimmed 1\/32" off the beam/);
    expect(text).toMatch(/5\/8" bore on the 5\/8" rod/);
    expect(text).not.toMatch(/0\.63" bore/);
    expect(text).not.toMatch(/DOM tube/);
    expect(text).toMatch(/5\/8 solid 1045|5\/8" solid 1045/);
  });
});

describe('the numbers at the defaults (weatherSpec Standard: 6 mm Baltic birch, the solid rod, the 3 wood-screw sizes)', () => {
  it('empty mass 121.62 lb (D-80/D-83: the 6 mm Baltic sides, box and lid and the 2 in clamp plates, less the lighter EVA seat pads and lights; 121.09 lb with the 1/4 in white oak ply at D-77, +0.87 lb the pivot straps and knee roofs; D-76: +0.96 lb the side ribs; 115.95 lb at D-71)', () => {
    const m = totalMass(buildModel(defaults, { rider: 'none', cargo: false }));
    expect(m).toBeCloseTo(121.617, 2); // merged with the final review of the build outputs (121.639 before: 13/32 knee holes, 7/8 narrow washers and the rib-knee shift)
    const oak = totalMass(buildModel({ ...defaults, thinSheetMaterial: OAK }, { rider: 'none', cargo: false }));
    expect(oak).toBeCloseTo(120.293, 2);
    expect(m - oak).toBeCloseTo(1.33, 1); // the 6 mm Baltic over the 1/4 in white oak ply
    const ok = totalMass(buildModel({ ...defaults, thinSheetMaterial: OKOUME }, { rider: 'none', cargo: false }));
    expect(ok).toBeCloseTo(119.523, 2); // D-80: the 6 mm okoume (Extreme)
    const tubeOk = totalMass(buildModel({ ...defaults, ...PRE_D72 }, { rider: 'none', cargo: false }));
    expect(tubeOk).toBeCloseTo(115.600, 2); // the D-71 tube and the 4 mm okoume (PRE_D72)
    const rodOk4 = totalMass(buildModel({ ...defaults, ...PRE_D72, axleWallIn: 0 }, { rider: 'none', cargo: false }));
    expect(rodOk4 - tubeOk).toBeCloseTo(1.88, 1); // the rod over the tube
  });
  it('riders safe 50-250+ lb, green 50-240 lb (also 240 with the 6 mm okoume); cargo capacity 286 lb; nothing fails', () => {
    const sw = riderSweep(defaults);
    expect(sw.safe).toEqual({ loLb: 50, hiLb: 250, openLow: true, openHigh: true });
    expect(sw.green).toMatchObject({ loLb: 50, hiLb: 240, openLow: true, openHigh: false }); // D-83: 220 lb (230 with the 4 mm okoume) before the 2 in clamp plates added groove bearing area
    expect(riderSweep(withMat(OKOUME)).green).toMatchObject({ loLb: 50, hiLb: 240 });
    const cap = cargoCapacity(defaults);
    expect(cap.capacityLb).toBe(286); // D-83: 254 before the 2 in clamp plates (the groove bearing limited it)
    expect(cap.comfortableLb).toBe(232);
    expect(cap.limiter!.id).toBe('rear-beam-seat'); // was 'bearing-groove'
    const cs = runChecks(defaults, { includeTruck: false });
    expect(cs.filter((c) => c.status === 'fail')).toEqual([]);
    expect(cs.find((c) => c.id === 'axle-stress')!.util!).toBeCloseTo(0.787, 2);
  });
  it('the chine-to-rail tie has NO Dominos in either spec (D-81): a thickened-epoxy bed along the whole bearing face plus a screw in every gap', () => {
    for (const p of [defaults, withMat(OKOUME), { ...defaults, weatherSpec: WEATHER_SPEC.extreme } as Params]) {
      const rail = buildModel(p).find((x) => x.id === 'rail-L')!;
      expect(rail.joints!.some((j) => j.type === 'domino' && j.to === 'side-L-chine')).toBe(false);
      const tie = rail.joints!.find((j) => j.type === 'glue' && j.to === 'side-L-chine')!;
      expect(tie.size).toMatch(/^thickened epoxy bed, full length of the .* bearing face .* screwed every 6" \(no Dominos, D-81\)/);
    }
  });
});
