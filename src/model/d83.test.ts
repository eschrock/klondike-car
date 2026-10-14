/**
 * The cost pass (D-79 to D-83), model half: the thin sheet (D-80), the Domino rules (D-81), the #8 screws (D-82) and the Standard-spec simplifications (D-83: drilled drains, the Rockler
 * lid support, EVA seat pads, bolt-on D-rings, 2 in clamp plates, the lighter lights).
 */
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, THIN_SHEET, WEATHER_SPEC, defaultParams, thinSheet, thinSheetKey, validateParams, type Params } from '../params';
import { buildModel } from '.';
import { runChecks } from '../analysis';
import { totalMass } from './mass';
import { DOMINOS, chooseDomino } from './joinery';
import { STD_WOOD_SCREWS } from './rear-mount';
import { LASH_BOLTS, LASH_BOLT_AR_IN2, LASH_BOLT_AT_IN2, LASH_BOLT_DIA_IN } from './side-ribs';
import { worldAABB } from './bounds';
import type { Part } from './types';

const std = defaultParams();
const ext: Params = { ...std, weatherSpec: WEATHER_SPEC.extreme };
const SPECS: [string, Params][] = [['Standard', std], ['Extreme', ext]];
const MM = 25.4;
const get = (parts: Part[], id: string) => parts.find((x) => x.id === id)!;
/** A part's thickness in the direction of a Domino tenon: its stock thickness times its plies (a rail is two strips). */
const thick = (x: Part): number => (x.stock?.t ?? Infinity) * (x.plies ?? 1);

describe('D-80: the thin sheet follows the weather (6 mm)', () => {
  it('follow-the-weather picks 6 mm Baltic birch (Standard) and 6 mm okoume (Extreme)', () => {
    expect(thinSheetKey(std)).toBe(THIN_SHEET.balticBirch6mm);
    expect(thinSheetKey(ext)).toBe(THIN_SHEET.okoumeMarine);
    const a = thinSheet(std), b = thinSheet(ext);
    expect(a).toMatchObject({ name: '6 mm Baltic birch', nominal: '1/4 in (6 mm)', priceKey: 'baltic-6mm', sheetWidthIn: 48, sheetLengthIn: 96 });
    expect(a.thicknessIn).toBeCloseTo(0.236, 9);
    expect(a.moePerpPsi).toBe(486000);
    expect(a.morPerpPsi).toBe(3990);
    expect(a.glue).toMatch(/interior/);
    expect(b).toMatchObject({ name: '6 mm okoume', nominal: '6 mm', priceKey: 'okoume-6mm' });
    expect(b.thicknessIn).toBeCloseTo(0.236, 9);
    expect(b.moePerpPsi).toBe(315000);
    expect(b.morPerpPsi).toBe(3000);
    expect(thinSheet({ ...std, thinSheetMaterial: THIN_SHEET.whiteOakPly }).priceKey).toBe('white-oak-1/4');
    expect(thinSheet({ ...std, thinSheetMaterial: THIN_SHEET.balticBirch3mm }).priceKey).toBe('baltic-3mm');
    expect(PARAM_DEFS.balticSixThickIn.status).toBe('verify');
  });
  it('the sandwich bands are 0.195 in and the defaults validate clean in both specs', () => {
    for (const [name, p] of SPECS) {
      expect(validateParams(p).filter((i) => i.severity !== 'info'), name).toEqual([]);
      const web = get(buildModel(p), 'side-L-web');
      expect(web.material, name).toMatch(/Baltic birch|okoume/);
    }
    expect((0.625 - 0.236) / 2).toBeCloseTo(0.1945, 4);
  });
  it('side-web and side-lateral pass in both specs (4 mm okoume failed the web at 2.0)', () => {
    for (const [name, p] of SPECS) {
      const cs = runChecks(p, { includeTruck: false });
      for (const id of ['side-web', 'side-lateral']) {
        const c = cs.find((q) => q.id === id)!;
        expect(c.status, `${name} ${id}`).toBe('pass');
        expect(c.util!, `${name} ${id}`).toBeLessThan(0.7);
      }
    }
  });
});

describe('D-81: Domino rules', () => {
  it('chooseDomino never picks a DF 700 XL size and never a tenon thicker than 0.34 of its stock', () => {
    let picked = 0;
    for (let stock = 0.375; stock <= 4; stock += 0.125) for (const host of [0.5, 0.75, 1, 1.5, 2, 3, 4]) for (const width of [1, 1.75, 3, 6]) {
      const d = chooseDomino(std, { stockIn: stock, hostIn: host, widthIn: width });
      if (!d) continue;
      picked++;
      expect(d.tool, `${stock} ${host} ${width}`).toBe('DF 500');
      expect(d.tMm / MM, `${d.name} in ${stock} in stock`).toBeLessThanOrEqual(stock * 0.34 + 1e-9);
    }
    expect(picked).toBeGreaterThan(50);
    expect(DOMINOS.some((d) => d.tool === 'DF 700 XL')).toBe(true); // the table keeps the XL sizes; nothing picks them
  });
  it('no Domino tenon in the model is thicker than 0.34 of the thinner piece it joins; the rail end into the bulkhead is a 6×40', () => {
    for (const [name, p] of SPECS) {
      const parts = buildModel(p);
      let n = 0;
      for (const x of parts) for (const j of x.joints ?? []) {
        if (j.type !== 'domino') continue;
        n++;
        const m = /^(\d+)×(\d+)/.exec(j.size ?? '')!;
        expect(m, `${name} ${x.id} -> ${j.to}: ${j.size}`).not.toBeNull();
        const other = get(parts, j.to);
        expect(Number(m[1]) / MM, `${name} ${x.id} -> ${j.to} ${j.size}`).toBeLessThanOrEqual(0.34 * Math.min(thick(x), thick(other)) + 1e-9);
      }
      expect(n, name).toBeGreaterThan(20);
      const bow = get(parts, 'rail-L').joints!.find((j) => j.to === 'bow-bulkhead')!;
      expect(bow.type).toBe('domino');
      expect(bow.size).toMatch(/^6×40 \(DF 500\)/);
    }
  });
  it('no joint uses a DF 700 XL size, and the chine-to-rail tie has no Domino (epoxy bed plus a screw in every gap)', () => {
    for (const [name, p] of SPECS) {
      const parts = buildModel(p);
      for (const x of parts) for (const j of x.joints ?? []) expect(`${j.size ?? ''}`, `${name} ${x.id} -> ${j.to}`).not.toMatch(/XL|700/);
      for (const tag of ['L', 'R']) {
        const chine = get(parts, `side-${tag}-chine`), rail = get(parts, `rail-${tag}`);
        for (const x of [chine, rail]) expect(x.joints!.some((j) => j.type === 'domino' && (j.to === rail.id || j.to === chine.id)), `${name} ${x.id}`).toBe(false);
        const glue = chine.joints!.find((j) => j.type === 'glue' && j.to === rail.id)!;
        expect(glue.size).toMatch(/thickened epoxy bed/);
        const screws = chine.joints!.filter((j) => j.type === 'screw' && j.to === rail.id);
        expect(screws.reduce((m, j) => m + j.count, 0), name).toBeGreaterThanOrEqual(7);
      }
    }
  });
});

describe('D-82: every wood screw is a #8', () => {
  it('no "#6 ×" wood screw anywhere in the model, and the standard list has no #6', () => {
    expect(STD_WOOD_SCREWS.every((s) => s.gauge === 8)).toBe(true);
    for (const [name, p] of SPECS) {
      for (const x of buildModel(p)) for (const j of x.joints ?? []) {
        expect(j.size ?? '', `${name} ${x.id} -> ${j.to}`).not.toMatch(/#6 ×|#6 x/);
        if (j.fit) expect(j.fit.gauge, `${name} ${x.id} -> ${j.to}`).toBe(8);
      }
    }
  });
  it('the rail-to-chine and rib-knee screws are #8 × 2-1/2 with the pilot written down', () => {
    const parts = buildModel(std);
    const rs = get(parts, 'rail-L').joints!.filter((j) => j.type === 'screw' && j.to === 'side-L-chine');
    expect(rs.length).toBeGreaterThan(0);
    for (const j of rs) { expect(j.size).toMatch(/^#8 × 2-1\/2 /); expect(j.size).toMatch(/PILOT.*11\/64" clearance.*1\/8" pilot/); }
    const ks = get(parts, 'side-rib-knee-L2').joints!.find((j) => j.type === 'screw')!;
    expect(ks.size).toMatch(/^#8 × 2-1\/2 /);
    expect(ks.diaIn).toBeCloseTo(0.164, 9);
  });
});

describe('D-83: drains', () => {
  it('Standard has no scupper or box-drain parts; the drains are epoxy-sealed 3/8 in holes through the same sites', () => {
    const parts = buildModel(std);
    expect(parts.filter((x) => /^(scupper|storage-drain)-/.test(x.id))).toEqual([]);
    for (const tag of ['L', 'R']) for (const host of ['chine-in', 'web', 'chine']) {
      const holes = get(parts, `side-${tag}-${host}`).joints!.filter((j) => j.type === 'hole' && /drain hole/.test(j.size ?? ''));
      expect(holes, `${tag} ${host}`).toHaveLength(2); // rear and bow
      for (const h of holes) {
        expect(h.diaIn).toBeCloseTo(std.scupperDiaIn, 9);
        expect(h.size).toMatch(/3\/8" drain hole/);
        expect(h.size).toMatch(/epoxy/);
        expect(h.at).toHaveLength(1);
      }
    }
    const deckHoles = get(parts, 'deck').joints!.filter((j) => j.type === 'hole' && /drain hole/.test(j.size ?? ''));
    expect(deckHoles).toHaveLength(2);
    for (const h of deckHoles) { expect(h.diaIn).toBeCloseTo(std.storageDrainDiaIn, 9); expect(h.size).toMatch(/sealed with epoxy/); }
  });
  it('Extreme keeps the four nipples and the two box drains', () => {
    const parts = buildModel(ext);
    expect(parts.filter((x) => /^scupper-/.test(x.id))).toHaveLength(4);
    expect(parts.filter((x) => /^storage-drain-/.test(x.id))).toHaveLength(2);
    expect(get(parts, 'side-L-web').joints!.some((j) => j.type === 'hole' && /drain hole/.test(j.size ?? ''))).toBe(false);
  });
});

describe('D-83: lid support, seat pads, D-rings, clamp plates, lights', () => {
  it('the lid stay is a Rockler 6 in plated-steel support (Standard) and the stainless friction stay (Extreme), clear of the packed items', () => {
    const a = get(buildModel(std), 'storage-lid-stay'), b = get(buildModel(ext), 'storage-lid-stay');
    expect(a.material).toMatch(/plated steel lid support \(Rockler 6"/);
    expect(a.sourcing!.vendor).toMatch(/Rockler/);
    expect(a.massLb).toBeCloseTo(0.15, 9);
    const bb = worldAABB(a);
    expect(bb.max[0] - bb.min[0]).toBeGreaterThan(5);
    expect(b.material).toMatch(/316 stainless friction stay/);
    expect(b.massLb).toBeCloseTo(0.12, 9);
    expect(runChecks(std, { includeTruck: false }).find((c) => c.id === 'storage-pack')!.status).toBe('pass');
  });
  it('the seat is EVA kneeling pads 1-1/2 in thick, no cover: about 1 lb per 11 x 18 pad', () => {
    expect(std.seatCushionIn).toBe(1.5);
    const parts = buildModel(std);
    const cushion = get(parts, 'seat-cushion'), back = get(parts, 'seat-back-pad');
    for (const x of [cushion, back]) { expect(x.material).toMatch(/EVA/); expect(x.sourcing!.vendor).toMatch(/Harbor Freight/); }
    expect(cushion.notes).toMatch(/one whole pad plus a .* strip/);
    const b = worldAABB(cushion);
    const padLb = (11 * 18 * 1.5 / 1728) * std.evaFoamDensityPcf;
    expect(padLb).toBeCloseTo(1, 1);
    expect(cushion.massLb).toBeCloseTo(((b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * 1.5 / 1728) * std.evaFoamDensityPcf, 6);
    expect(cushion.massLb).toBeLessThan(2 * padLb);
    expect(back.massLb).toBeLessThan(padLb + 1e-6); // the third pad, trimmed
  });
  it('the D-rings are bolt-on cargo rings on two 1/4-20 button-head bolts, rated 233 lbf', () => {
    expect(std.lashLoadLbf).toBe(233);
    expect(LASH_BOLTS).toBe(2);
    expect(LASH_BOLT_DIA_IN).toBe(0.25);
    expect(LASH_BOLT_AT_IN2).toBe(0.0318);
    expect(LASH_BOLT_AR_IN2).toBe(0.0269);
    for (const [, p] of SPECS) {
      const cs = runChecks(p, { includeTruck: false });
      for (const id of ['lash-load', 'side-lateral', 'cargo-strap']) expect(cs.find((c) => c.id === id)!.status, id).not.toBe('fail');
      expect(cs.find((c) => c.id === 'lash-load')!.util!).toBeLessThan(0.8);
    }
  });
  it('the clamp plates are 2 in (cut from 1/4 x 2 bar) and the rear groove bearing improved', () => {
    expect(std.clampPlateWidthIn).toBe(2);
    expect(std.clampPlateOuterWidthIn).toBe(2);
    expect(validateParams(std).filter((i) => i.severity !== 'info')).toEqual([]);
    expect(runChecks(std, { includeTruck: false }).find((c) => c.id === 'bearing-groove')!.util!).toBeLessThan(0.8); // 0.86 at 1.75 in
  });
  it('the lights are the Giant Recon 600 (0.19 lb) and the Planet Bike Spok (0.06 lb), and the clips are to be re-measured', () => {
    const parts = buildModel(std);
    expect(get(parts, 'front-light').massLb).toBeCloseTo(0.19, 9);
    expect(get(parts, 'front-light').notes).toMatch(/RE-MEASURE/);
    expect(get(parts, 'rear-light').massLb).toBeCloseTo(0.06, 9);
    expect(get(parts, 'rear-light').notes).toMatch(/RE-MEASURE/);
  });
  it('the handle sockets are bedded in thickened epoxy under Standard (not sealant)', () => {
    expect(get(buildModel(std), 'handle-socket-L').notes).toMatch(/thickened epoxy/);
    expect(get(buildModel(std), 'handle-socket-L').notes).toMatch(/not sealant/);
    expect(get(buildModel(ext), 'handle-socket-L').notes).toMatch(/epoxy or polysulfide sealant/);
  });
  it('the empty sled stays near 122 lb (Standard) and 120 lb (Extreme)', () => {
    expect(totalMass(buildModel(std))).toBeGreaterThan(120);
    expect(totalMass(buildModel(std))).toBeLessThan(123);
    expect(totalMass(buildModel(ext))).toBeGreaterThan(118);
    expect(totalMass(buildModel(ext))).toBeLessThan(121.5);
  });
});
