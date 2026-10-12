/**
 * Ply sheets (D-62, Eric 2026-10-12): 4 mm and 6 mm okoume come as FULL 4 x 8 ft sheets from Aircraft Spruce (Peachtree City GA, will-call), the 12 mm deck from a local dealer; the
 * alternative source ships only 2 x 4 ft sheets, and then the side webs split into two scarfed halves. Every ply blank fits its sheet either way.
 */
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, type Params } from '../params';
import { buildModel } from '.';
import { computeLayout } from './layout';
import { signBackerPlan, signPlacement, sideWebSplit } from './body';
import { NEST_KERF_IN, allPlyBlanks, isPly, isThinPly, plySheets, thinPlyBlanks } from './sheets';
import { makeCtx } from './build-utils';

const defaults = defaultParams();
const twoByFour: Params = { ...defaults, thinSheetWidthIn: 23.5, thinSheetLengthIn: 47.5 };

describe('the default: full 4 x 8 ft sheets of 4 mm and 6 mm okoume (Aircraft Spruce, will-call), one-piece side webs', () => {
  const parts = buildModel(defaults);
  const get = (id: string) => parts.find((x) => x.id === id)!;
  it('the sheet size params are locked, cite D-62 and name the sources', () => {
    for (const k of ['thinSheetWidthIn', 'thinSheetLengthIn'] as const) {
      expect(PARAM_DEFS[k].status).toBe('locked');
      expect(PARAM_DEFS[k].ref).toMatch(/D-62/);
    }
    expect(PARAM_DEFS.thinSheetWidthIn.note).toMatch(/Aircraft Spruce \(Peachtree City, GA\)/);
    expect(PARAM_DEFS.thinSheetWidthIn.note).toMatch(/local dealer/);
    expect(defaults.thinSheetWidthIn).toBe(48);
    expect(defaults.thinSheetLengthIn).toBe(96);
    for (const k of ['plySpecies', 'deckPlyIn', 'panelPlyIn', 'seatBackPlyIn'] as const) expect(PARAM_DEFS[k].note, k).toMatch(/Aircraft Spruce|local dealer/);
  });
  it('each side web is ONE piece by default (no scarf), the scarf is an option (default off) with an 8:1 ratio', () => {
    expect(defaults.sideWebScarf).toBe(0);
    expect(PARAM_DEFS.sideWebScarf.default).toBe(0);
    expect(defaults.plyScarfRatio).toBe(8);
    expect(sideWebSplit(makeCtx(defaults))).toBe(false);
    for (const tag of ['L', 'R']) {
      expect(get(`side-${tag}-web`).joints!.some((q) => q.type === 'scarf')).toBe(false);
      expect(parts.some((x) => x.id === `side-${tag}-web-1`)).toBe(false);
      expect(get(`side-${tag}-web`).stock!.l).toBeGreaterThan(58);
    }
  });
  it('every ply blank fits its sheet: the thin parts the 48 x 96 sheet, the deck a full 4 x 8', () => {
    const blanks = allPlyBlanks(parts, defaults);
    expect(blanks.map((b) => b.id)).toEqual(expect.arrayContaining(['deck', 'side-L-web', 'side-R-web', 'sign-L', 'storage-lid', 'seat-back-panel']));
    expect(isThinPly(get('deck'))).toBe(false);
    expect(isPly(get('deck'))).toBe(true);
    for (const b of blanks) expect(b.fits, `${b.id} ${b.l.toFixed(2)} x ${b.w.toFixed(2)}`).toBe(true);
    expect(thinPlyBlanks(parts, defaults).length).toBe(blanks.length - 2); // not the deck, not the 12 mm seat back
  });
  it('rough sheet count at the default: one sheet of 4 mm and ONE 12 mm sheet (the deck, with the 12 mm frameless seat back cut from its offcut); no 6 mm sheet at all (D-62)', () => {
    const n = plySheets(allPlyBlanks(parts, defaults), defaults);
    expect(n).toEqual({ 4: 1, 12: 1 });
    expect(isThinPly(parts.find((x) => x.id === 'seat-back-panel')!)).toBe(false);
    expect(NEST_KERF_IN).toBeGreaterThan(0);
  });
});

describe('the other source: thin okoume only as 2 x 4 ft sheets (23.5 x 47.5 in usable)', () => {
  const parts = buildModel(twoByFour);
  const get = (id: string) => parts.find((x) => x.id === id)!;
  it('the 59 in web does not fit, so it splits into two scarfed halves automatically', () => {
    const L = computeLayout(twoByFour);
    expect(L.xSideEnd - (L.xRear + L.transom - twoByFour.deckCaptureDepthIn)).toBeGreaterThan(twoByFour.thinSheetLengthIn);
    expect(sideWebSplit(makeCtx(twoByFour))).toBe(true);
    for (const tag of ['L', 'R']) {
      expect(parts.some((x) => x.id === `side-${tag}-web`)).toBe(false);
      const longest = Math.max(get(`side-${tag}-web-1`).stock!.l, get(`side-${tag}-web-2`).stock!.l);
      expect(longest).toBeLessThanOrEqual(twoByFour.thinSheetLengthIn);
      expect(longest).toBeGreaterThan(40);
    }
  });
  it('every thin-ply blank fits 23.5 x 47.5; the deck still fits a 4 x 8', () => {
    for (const b of allPlyBlanks(parts, twoByFour)) expect(b.fits, `${b.id} ${b.l.toFixed(2)} x ${b.w.toFixed(2)}`).toBe(true);
  });
  it('each side has one scarf joint between the halves: 8:1, 1.26 in long in 4 mm, at sideWebScarfXIn, bridged by all four oak bands', () => {
    for (const tag of ['L', 'R']) {
      const j = get(`side-${tag}-web-1`).joints!.find((q) => q.to === `side-${tag}-web-2`)!;
      expect(j.type).toBe('scarf');
      expect(j.size).toMatch(/8:1/);
      expect(j.size).toMatch(/1\.26"/);
      expect(get(`side-${tag}-web-2`).joints!.some((q) => q.to === `side-${tag}-web-1` && q.type === 'scarf')).toBe(true);
      expect(get(`side-${tag}-web-1`).joints!.some((q) => q.type === 'dado' && q.to === 'transom-rear')).toBe(true);
      expect(get(`side-${tag}-web-2`).joints!.some((q) => q.type === 'dado' && q.to === 'bow-bulkhead')).toBe(true);
      for (const band of ['chine', 'chine-in', 'gunwale', 'gunwale-in']) {
        const b = get(`side-${tag}-${band}`);
        expect(b.joints!.some((q) => q.to === `side-${tag}-web-1`)).toBe(true);
        expect(b.joints!.some((q) => q.to === `side-${tag}-web-2`)).toBe(true);
      }
    }
  });
  it('the scarf is hidden: inside the sign on the outside, and within 1.5 in of a sign backing strip inside', () => {
    const ctx = makeCtx(twoByFour);
    const sg = signPlacement(ctx), bk = signBackerPlan(ctx);
    const sc = twoByFour.plyScarfRatio * twoByFour.panelPlyIn;
    const x0 = twoByFour.sideWebScarfXIn - sc / 2, x1 = twoByFour.sideWebScarfXIn + sc / 2;
    expect(x0).toBeGreaterThanOrEqual(sg.xc - sg.length / 2);
    expect(x1).toBeLessThanOrEqual(sg.xc + sg.length / 2);
    expect(Math.min(...bk.xs.map((bx) => Math.abs(bx - twoByFour.sideWebScarfXIn)))).toBeLessThan(1.5);
  });
  it('rough sheet count: 4 mm needs 3 of the 2 x 4 sheets, the 12 mm panel and deck one 4 x 8 (Phase 4 does the real nesting)', () => {
    const n = plySheets(allPlyBlanks(parts, twoByFour), twoByFour);
    expect(n[4]).toBe(3);
    expect(n[6]).toBeUndefined();
    expect(n[12]).toBe(1);
  });
  it('a scarf moved too far back leaves a front half longer than the sheet and the check says so', () => {
    const big = buildModel({ ...twoByFour, sideWebScarfXIn: -5 });
    expect(allPlyBlanks(big, twoByFour).filter((b) => !b.fits).some((b) => /web-2/.test(b.id))).toBe(true);
  });
  it('sideWebScarf = 1 splits the webs even on 4 x 8 sheets (the option), and the halves still fit', () => {
    const opt = { ...defaults, sideWebScarf: 1 } as Params;
    const ps = buildModel(opt);
    expect(ps.some((x) => x.id === 'side-L-web-1')).toBe(true);
    for (const b of allPlyBlanks(ps, opt)) expect(b.fits, b.id).toBe(true);
  });
});
