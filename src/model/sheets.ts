/**
 * Ply sheet check (D-62, Eric 2026-10-12): thin okoume (4 mm sides, box, lid and signs; 6 mm seat back) comes in FULL 4 x 8 ft sheets from Aircraft Spruce (Peachtree City, GA, will-call;
 * `thinSheetWidthIn` x `thinSheetLengthIn` = 48 x 96, or 23.5 x 47.5 for the 2 x 4 ft source), so every thin-ply part's raw blank must fit it; the 12 mm deck is a full 4 x 8 sheet
 * from a local dealer. `plySheets` also gives a ROUGH nesting count of sheets per thickness (4, 6 and 12 mm) (shelf packing of the bounding blanks, with a kerf between pieces): the curved side webs are packed as
 * rectangles, which is conservative; Phase 4 does the real nesting. Plain TS, no three.js.
 */
import type { Params } from '../params';
import type { Part } from './types';

/** A ply sheet part is "thin" up to this thickness (in): 6 mm = 0.236. The 12 mm deck is 0.472. */
export const THIN_PLY_MAX_IN = 0.26;
/** Saw kerf allowed between nested blanks (in). */
export const NEST_KERF_IN = 0.125;

export interface PlyBlank {
  id: string;
  mm: number;
  /** Blank size: the long and short side (in). */
  l: number;
  w: number;
  fits: boolean;
  /** Thin (4 / 6 mm, the thin-sheet size) or the deck (a dealer's full 4 x 8). */
  thin: boolean;
}

/** A full 4 x 8 ft sheet (in): the deck's sheet, from a local dealer. */
export const FULL_SHEET_IN = { w: 48, l: 96 } as const;

export const isPly = (x: Part): boolean => x.kind === 'sheet' && !x.payload && !!x.stock && /ply|okoume|birch/i.test(x.material);
export const isThinPly = (x: Part): boolean => isPly(x) && x.stock!.t <= THIN_PLY_MAX_IN;

/** The raw blank of every thin-ply part, and whether it fits the thin sheet (either way round). */
export function thinPlyBlanks(parts: Part[], p: Pick<Params, 'thinSheetWidthIn' | 'thinSheetLengthIn'>): PlyBlank[] {
  return parts.filter(isThinPly).map((x) => blankOf(x, p));
}

/** Every ply part (thin ones against the thin sheet, the deck against a full 4 x 8). */
export function allPlyBlanks(parts: Part[], p: Pick<Params, 'thinSheetWidthIn' | 'thinSheetLengthIn'>): PlyBlank[] {
  return parts.filter(isPly).map((x) => blankOf(x, p));
}

function blankOf(x: Part, p: Pick<Params, 'thinSheetWidthIn' | 'thinSheetLengthIn'>): PlyBlank {
  const s = x.stock!;
  const thin = s.t <= THIN_PLY_MAX_IN;
  const sheetL = thin ? Math.max(p.thinSheetLengthIn, p.thinSheetWidthIn) : FULL_SHEET_IN.l, sheetW = thin ? Math.min(p.thinSheetLengthIn, p.thinSheetWidthIn) : FULL_SHEET_IN.w;
  const l = Math.max(s.w, s.l), w = Math.min(s.w, s.l);
  return { id: x.id, mm: Math.round(s.t * 25.4), l, w, thin, fits: l <= sheetL + 1e-9 && w <= sheetW + 1e-9 };
}

/** Rough count of sheets per thickness (mm): first-fit-decreasing shelf packing of the bounding blanks. */
export function plySheets(blanks: PlyBlank[], p: Pick<Params, 'thinSheetWidthIn' | 'thinSheetLengthIn'>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const mm of [...new Set(blanks.map((b) => b.mm))]) {
    const thin = blanks.find((b) => b.mm === mm)!.thin;
    const sheetL = thin ? Math.max(p.thinSheetLengthIn, p.thinSheetWidthIn) : FULL_SHEET_IN.l, sheetW = thin ? Math.min(p.thinSheetLengthIn, p.thinSheetWidthIn) : FULL_SHEET_IN.w;
    const items = blanks.filter((b) => b.mm === mm).map((b) => ({ l: b.l + NEST_KERF_IN, w: b.w + NEST_KERF_IN })).sort((a, b) => b.w - a.w || b.l - a.l);
    type Shelf = { h: number; used: number };
    const sheets: { shelves: Shelf[]; hUsed: number }[] = [];
    for (const it of items) {
      let placed = false;
      for (const sh of sheets) {
        const shelf = sh.shelves.find((q) => it.w <= q.h + 1e-9 && q.used + it.l <= sheetL + NEST_KERF_IN + 1e-9);
        if (shelf) { shelf.used += it.l; placed = true; break; }
        if (sh.hUsed + it.w <= sheetW + NEST_KERF_IN + 1e-9) { sh.shelves.push({ h: it.w, used: it.l }); sh.hUsed += it.w; placed = true; break; }
      }
      if (!placed) sheets.push({ shelves: [{ h: it.w, used: it.l }], hUsed: it.w });
    }
    out[mm] = sheets.length;
  }
  return out;
}
