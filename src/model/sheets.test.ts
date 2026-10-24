/**
 * Ply sheets (D-62, D-68, D-80; Eric 2026-10-12): one FULL 4 x 8 ft sheet each of the 6 mm thin sheet and 12 mm okoume. Each side web is one piece; every ply blank fits its sheet.
 */
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, THIN_SHEET, defaultParams } from '../params';
import { buildModel } from '.';
import { NEST_KERF_IN, allPlyBlanks, isPly, isThinPly, plySheets, thinPlyBlanks } from './sheets';

const defaults = defaultParams();

describe('full 4 x 8 ft sheets of 4 mm and 12 mm okoume (local supplier), one-piece side webs', () => {
  const parts = buildModel(defaults);
  const get = (id: string) => parts.find((x) => x.id === id)!;
  it('the sheet goods name the local supplier and D-68; the 2 x 4 sheet and web-scarf params are gone', () => {
    for (const k of ['plySpecies', 'deckPlyIn', 'seatBackPlyIn'] as const) expect(PARAM_DEFS[k].note, k).toMatch(/local supplier/);
    expect(PARAM_DEFS.panelPlyIn.note).toMatch(/D-80/); // the okoume option of the thin sheet is 6 mm BS 1088 now
    for (const k of ['thinSheetWidthIn', 'thinSheetLengthIn', 'sideWebScarf', 'plyScarfRatio', 'sideWebScarfXIn']) expect(k in PARAM_DEFS, k).toBe(false);
  });
  it('each side web is ONE piece with no scarf, its blank the flat development along the plan curve', () => {
    for (const tag of ['L', 'R']) {
      expect(get(`side-${tag}-web`).joints!.some((q) => q.type === 'scarf')).toBe(false);
      expect(parts.some((x) => x.id === `side-${tag}-web-1` || x.id === `side-${tag}-web-2`)).toBe(false);
      expect(get(`side-${tag}-web`).stock!.l).toBeGreaterThan(58);
    }
  });
  it('every ply blank fits a full 4 x 8 sheet', () => {
    const blanks = allPlyBlanks(parts);
    expect(blanks.map((b) => b.id)).toEqual(expect.arrayContaining(['deck', 'side-L-web', 'side-R-web', 'sign-L', 'storage-lid', 'seat-back-panel']));
    expect(isThinPly(get('deck'))).toBe(false);
    expect(isPly(get('deck'))).toBe(true);
    for (const b of blanks) expect(b.fits, `${b.id} ${b.l.toFixed(2)} x ${b.w.toFixed(2)}`).toBe(true);
    expect(thinPlyBlanks(parts).length).toBe(blanks.length - 2); // not the deck, not the 12 mm seat back
  });
  it('rough sheet count at the default: one thin sheet and ONE deck sheet (the deck, with the frameless seat back cut from its offcut, D-62)', () => {
    const n = plySheets(allPlyBlanks(parts));
    expect(n).toEqual({ 5: 1, 13: 1 }); // (2026-10-24: 13 mm deck, 5 mm combi-core white oak sides as bought; the seat back comes from the deck offcut, so it is 13 mm too.) D-80: { 6: 1, 12: 1 } on the follow-the-weather 6 mm sheet and the 12 mm deck, { 3: 1, ... } with the 3 mm Baltic birch
    expect(plySheets(allPlyBlanks(buildModel({ ...defaults, thinSheetMaterial: THIN_SHEET.followWeather, deckPlyIn: 0.472, seatBackPlyIn: 0.472, seatBackThickIn: 0.472 })))).toEqual({ 6: 1, 12: 1 }); // (2026-10-24: D-96/97/98) the old sheets set explicitly
    expect(isThinPly(parts.find((x) => x.id === 'seat-back-panel')!)).toBe(false);
    expect(NEST_KERF_IN).toBeGreaterThan(0);
  });
});
