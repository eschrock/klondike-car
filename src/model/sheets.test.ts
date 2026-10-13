/**
 * Ply sheets (D-62, D-68; Eric 2026-10-12): one FULL 4 x 8 ft sheet each of 4 mm and 12 mm okoume from a local supplier. Each side web is one piece; every ply blank fits its sheet.
 */
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams } from '../params';
import { buildModel } from '.';
import { NEST_KERF_IN, allPlyBlanks, isPly, isThinPly, plySheets, thinPlyBlanks } from './sheets';

const defaults = defaultParams();

describe('full 4 x 8 ft sheets of 4 mm and 12 mm okoume (local supplier), one-piece side webs', () => {
  const parts = buildModel(defaults);
  const get = (id: string) => parts.find((x) => x.id === id)!;
  it('the sheet goods name the local supplier and D-68; the 2 x 4 sheet and web-scarf params are gone', () => {
    for (const k of ['plySpecies', 'deckPlyIn', 'panelPlyIn', 'seatBackPlyIn'] as const) expect(PARAM_DEFS[k].note, k).toMatch(/local supplier/);
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
  it('rough sheet count at the default: one sheet of 4 mm and ONE 12 mm sheet (the deck, with the 12 mm frameless seat back cut from its offcut); no 6 mm sheet at all (D-62)', () => {
    const n = plySheets(allPlyBlanks(parts));
    expect(n).toEqual({ 5: 1, 12: 1 }); // D-73: the thin sheet is the 1/4 in white oak plywood (5.3 mm) by default; { 4: 1, 12: 1 } with the okoume, { 3: 1, 12: 1 } with the Baltic birch
    expect(isThinPly(parts.find((x) => x.id === 'seat-back-panel')!)).toBe(false);
    expect(NEST_KERF_IN).toBeGreaterThan(0);
  });
});
