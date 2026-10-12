/**
 * Cut list (Phase 4): everything derived from `buildModel(params)`, as plain data a UI renders as tables and a CSV.
 * Plain TS, no three.js; pure functions of (parts, params).
 *
 *   (a) solid white oak, grouped by the board thickness it is milled from;
 *   (b) the resaw / laminate strip list (bent rails, sandwich bands) and the board each strip pool is sawn from;
 *   (c) okoume plywood parts by sheet (4 mm and 12 mm);
 *   (d) metal stock as cut-to-length lists.
 *
 * Identical pieces (same `partNo`, same dimensions) are one row with a quantity; every row lists the part ids it covers.
 */
import { isOakStocked } from './prices';
import type { Dims, Part } from '../model/types';
import type { Params } from '../params';
import { localBounds } from '../model/bounds';
import { flatPattern } from './flat';

// ── Board thickness map ───────────────────────────────────────────────────────

export interface BoardThickness {
  /** Quarters-notation name, e.g. '8/4'. */
  nominal: string;
  /** Nominal thickness in inches (4/4 = 1"): what board feet are computed on and what the yard prices. */
  nominalIn: number;
  /** Thickness left after surfacing both faces of a typical rough board (the most a part can be milled to). */
  usableIn: number;
}

/**
 * Rough-board thickness table. `usableIn` is the thickest ROUGH part (finished + milling allowance, `millingAllowanceIn`) that a rough board of that nominal
 * thickness yields: the part's rough size already carries its own planing allowance, so this is the board's after-surfacing thickness (4/4 about 13/16",
 * 5/4 1-1/16", 6/4 1-5/16", 8/4 1-3/4", 12/4 2-3/4") plus that 1/8" default allowance, never more than the nominal less a 1/16" skim.
 * (Phase 4 fix: comparing the rough part to the after-surfacing figure counted the allowance twice and pushed 1.70"-1.75" parts such as the king beam
 * and the bridle tongue off 8/4 onto 12/4.) 16/4 is here only for the brake chock and shoe blocks; yards stock it less often, so those rows carry a note
 * (or glue up two 8/4).
 */
export const BOARD_THICKNESSES: readonly BoardThickness[] = [
  { nominal: '4/4', nominalIn: 1, usableIn: 15 / 16 },
  { nominal: '5/4', nominalIn: 1.25, usableIn: 1 + 3 / 16 },
  { nominal: '6/4', nominalIn: 1.5, usableIn: 1 + 7 / 16 },
  { nominal: '8/4', nominalIn: 2, usableIn: 1 + 7 / 8 },
  { nominal: '12/4', nominalIn: 3, usableIn: 2 + 7 / 8 },
  { nominal: '16/4', nominalIn: 4, usableIn: 3 + 7 / 8 },
];

/** Smallest nominal board that yields a rough thickness, or null when none does. */
export function boardForThickness(roughT: number): BoardThickness | null {
  return BOARD_THICKNESSES.find((b) => isOakStocked(b.nominal) && b.usableIn >= roughT - 1e-6) ?? null;
}
export const boardByNominal = (nominal: string): BoardThickness => BOARD_THICKNESSES.find((b) => b.nominal === nominal)!;

/** Assumed width of the rough boards bought (in) and the lengths they come in (in): 6, 8 and 10 ft. */
export const BOARD_WIDTH_IN = 6;
export const BOARD_LENGTHS_IN: readonly number[] = [72, 96, 120];

// ── Part selection ────────────────────────────────────────────────────────────

/** A part that is built (not rider, cargo, truck) and is not the fastener mass allowance (the BOM expands that one). */
export const isBuilt = (x: Part): boolean => x.group !== 'reference' && !x.payload && x.id !== 'hardware';
export const partKey = (x: Part): string => x.partNo ?? x.id;
const isOak = (x: Part): boolean => /oak/i.test(x.material) && (x.kind === 'lumber' || x.kind === 'bentlam');
/** A laminate member: bought as strips (bent rails with `plies`, and the sandwich bands, kind bentlam). */
const isStripPart = (x: Part): boolean => isOak(x) && (x.plies !== undefined || x.kind === 'bentlam');

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const dimKey = (d: Dims): string => `${d.t.toFixed(2)}x${d.w.toFixed(2)}x${d.l.toFixed(2)}`;

/**
 * The grain in words, for the bench: "along L", "along W" or "vertical (T)". `Part.grain` is a LOCAL axis (x, y or z), which means nothing at the bench, so this reads the part's extent along
 * that axis and matches it to the stock length, width or thickness (a tie goes to L, then W).
 */
export function grainInWords(x: Part): string | undefined {
  if (!x.grain || !x.stock) return undefined;
  const b = localBounds(x.geometry);
  const k = x.grain === 'x' ? 0 : x.grain === 'y' ? 1 : 2;
  const e = b.max[k] - b.min[k];
  const cands: Array<[string, number]> = [['along L', x.stock.l], ['along W', x.stock.w], ['vertical (T)', x.stock.t]];
  let best = cands[0], bestD = Infinity;
  for (const c of cands) { const d = Math.abs(c[1] - e) / Math.max(c[1], 1e-6); if (d < bestD - 1e-9) { best = c; bestD = d; } }
  return best[0];
}

/** Assembly step numbers (`BuildStep.n`) of each part id, from the step list (structural type: `cutlist.ts` cannot import `assembly.ts`, which imports it). */
export function stepMapOf(steps: ReadonlyArray<{ n: number; partIds: readonly string[] }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of steps) for (const id of s.partIds) if (!m.has(id)) m.set(id, s.n);
  return m;
}
const stepsOf = (ids: string[], m?: ReadonlyMap<string, number>): number[] =>
  m ? [...new Set(ids.map((i) => m.get(i)).filter((v): v is number => v !== undefined))].sort((a, b) => a - b) : [];
const stepText = (n: number[]): string => n.join(', ');

/** Put a T x W x L into ascending-thickness order when the model gave a long or wide "thickness" (seat-crest-strip has T 13.5 in), and say so. */
function sanitize(d: Dims, warnings: string[], what: string): Dims {
  if (d.t <= d.w + 1e-9 && d.t <= d.l + 1e-9) return d;
  const s = [d.t, d.w, d.l].sort((a, b) => a - b);
  warnings.push(`${what}: model gives T ${r3(d.t)} x W ${r3(d.w)} x L ${r3(d.l)}, which looks transposed; treated as ${r3(s[0])} x ${r3(s[1])} x ${r3(s[2])}`);
  return { t: s[0], w: s[1], l: s[2] };
}

// ── CSV ───────────────────────────────────────────────────────────────────────

export type CsvCell = string | number | boolean | null | undefined;

/** RFC 4180: CRLF line ends; a field with a comma, quote, CR or LF is quoted, with quotes doubled. */
export function toCsv(rows: CsvCell[][]): string {
  const cell = (v: CsvCell): string => {
    const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(r3(v)) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OakRow {
  partNo: string;
  name: string;
  qty: number;
  /** Ids of every physical piece in the row. */
  ids: string[];
  /** Final T x W x L (in). */
  stock: Dims;
  /** Rough T x W x L (in). */
  rough: Dims;
  /** Nominal board the piece is milled from ('4/4' ...), or 'resawn' for laminate members (see the strip list). */
  board: string;
  /** Grain as a LOCAL axis ('x' | 'y' | 'z'), as the model gives it. */
  grain?: string;
  /** Grain in words for the bench: 'along L', 'along W' or 'vertical (T)'. */
  grainWord?: string;
  fab: string;
  /** MODEL step (`Part.step`, e.g. 4.2; lowest, when pieces differ). Not the assembly step. */
  step: number;
  /** ASSEMBLY step numbers (0 to 29: the numbers in the build book) of the pieces, when the caller passed the step list. */
  assemblySteps: number[];
  /** Sizing notes for the bench (a Shaper file cuts net, the blank is longer). */
  note?: string;
  plies?: number;
  warnings: string[];
}

export interface OakGroup {
  board: string;
  nominalIn: number;
  usableIn: number;
  rows: OakRow[];
  /** Pieces (sum of qty). */
  pieces: number;
}

export interface StripRow {
  /** Part number of the parent member (rail, side band). */
  partNo: string;
  name: string;
  /** Parent pieces. */
  parts: number;
  /** Strips per parent piece (the laminate plies). */
  plies: number;
  /** Strips to cut = parts x plies. */
  strips: number;
  ids: string[];
  /** One strip, finished (in). */
  stock: Dims;
  /** One strip, rough, including the planing allowance (in). */
  rough: Dims;
  /** Board chosen for this strip's thickness pool. */
  resawFrom: string;
}

/** The strips of one rough thickness, and the board thickness they are sawn from. */
export interface ResawPool {
  roughT: number;
  /** Strips in the pool. */
  strips: number;
  /** Chosen nominal board. */
  board: string;
  boardLengthIn: number;
  /** Width of the board to buy (in): 6, 7 or 8, whichever costs the fewest board feet while leaving a spare strip. */
  boardWidthIn: number;
  /** Slabs one lane yields through the board thickness, per candidate board (kerf and planing allowance included). */
  yieldByBoard: Record<string, number>;
  /** Slabs one lane yields through the thickness of the chosen board = strips per lane (the old name `stripsPerBoard` is kept). */
  stripsPerBoard: number;
  /** Lanes to rip (RIP FIRST, then resaw each lane into `stripsPerBoard` slabs); a lane is as wide as its widest strip. */
  lanes: number;
  /** Boards to buy for the pool, and their board feet. */
  boards: number;
  boardFeet: number;
  /** Strips (of the widest width in the pool) the bought boards can hold: the strips needed plus the spares. */
  stripSlots: number;
  /** `stripSlots - strips`: extra strips the purchase yields (insurance for a bend that fails). The assembly steps quote this number. */
  spares: number;
  /** Strips each bought board yields (`stripSlots / boards`, rounded down). */
  yieldPerBoard: number;
  /** Strips of each lane (up to `stripsPerBoard`), widest lane first. */
  laneStrips: Array<Array<{ partNo: string; id: string; widthIn: number; lengthIn: number }>>;
}

export interface SheetRow {
  partNo: string;
  name: string;
  qty: number;
  ids: string[];
  stock: Dims;
  grain?: string;
  grainWord?: string;
  fab: string;
  /** MODEL step; see `OakRow.step`. */
  step: number;
  assemblySteps: number[];
  /** E.g. "cut net 59.49 from the Shaper file; blank 59.59". */
  note?: string;
}
export interface SheetGroup {
  /** '4 mm' or '12 mm'. */
  label: string;
  thicknessMm: number;
  thicknessIn: number;
  rows: SheetRow[];
  pieces: number;
}

export interface MetalRow {
  partNo: string;
  name: string;
  qty: number;
  ids: string[];
  /** 'DOM tube' | 'Flat bar' | 'Angle' | 'Aluminum tube'. */
  family: string;
  /** Stock description, e.g. '3/4" OD x 0.120" wall DOM tube'. */
  section: string;
  material: string;
  /** Cut length of one piece (in). */
  cutLengthIn: number;
  stock: Dims;
  fab: string;
  step: number;
  assemblySteps: number[];
  warnings: string[];
}

export interface CutList {
  oak: OakGroup[];
  strips: StripRow[];
  resaw: ResawPool[];
  sheets: SheetGroup[];
  metal: MetalRow[];
  /** Data problems found in the model (transposed stock, missing stock). */
  warnings: string[];
  csv: { oak: string; strips: string; sheets: string; metal: string };
}

// ── Solid oak ─────────────────────────────────────────────────────────────────

const roughOf = (x: Part, p: Params, warnings: string[]): Dims => {
  if (x.rough) return sanitize(x.rough, warnings, `${partKey(x)} rough`);
  const s = sanitize(x.stock ?? { t: 1, w: 1, l: 1 }, warnings, `${partKey(x)} stock`);
  const a = p.millingAllowanceIn;
  return { t: s.t + a, w: s.w + a, l: s.l + 4 * a };
};

function oakRows(parts: Part[], p: Params, warnings: string[], stepOf?: ReadonlyMap<string, number>): OakRow[] {
  const map = new Map<string, OakRow>();
  for (const x of parts.filter((q) => isBuilt(q) && isOak(q))) {
    const stock = sanitize(x.stock ?? { t: 0, w: 0, l: 0 }, [], `${partKey(x)} stock`);
    const rough = roughOf(x, p, warnings);
    const strip = isStripPart(x);
    let board: string;
    const w: string[] = [];
    if (strip) board = 'resawn';
    else {
      const b = boardForThickness(rough.t);
      board = b ? b.nominal : '16/4';
      if (!b) w.push(`${partKey(x)}: rough thickness ${r3(rough.t)}" is thicker than any stocked board; glue up two`);
      else if (b.nominal === '16/4') w.push(`${partKey(x)}: needs 16/4 (3-3/4" usable); if the yard has none, glue up two 8/4`);
    }
    const key = `${partKey(x)}|${dimKey(rough)}|${board}`;
    const row = map.get(key);
    if (row) { row.qty += 1; row.ids.push(x.id); row.step = Math.min(row.step, x.step); row.assemblySteps = stepsOf(row.ids, stepOf); continue; }
    const gw = grainInWords(x);
    map.set(key, {
      partNo: partKey(x), name: x.name, qty: 1, ids: [x.id], stock, rough, board, grain: x.grain, ...(gw ? { grainWord: gw } : {}), fab: x.fab, step: x.step, assemblySteps: stepsOf([x.id], stepOf),
      ...(x.plies !== undefined ? { plies: x.plies } : {}), warnings: w,
    });
  }
  return [...map.values()];
}

// ── Resaw ─────────────────────────────────────────────────────────────────────

/**
 * Thickness (in) of a ROUGH board that a resaw can use: the nominal thickness less one jointed face (`millingAllowanceIn`). A resawn strip is cut from the rough board BEFORE any planing
 * (its rough thickness already includes its own planing allowance), so the "usable after surfacing both faces" in `BOARD_THICKNESSES` would throw away a strip: from a 5/4 rough board
 * (1.25") two 0.5" rough strips plus a kerf fit (1.125"), where the surfaced 1.0625" holds only one. That made the rails come out of 12/4 (4 strips) instead of two 5/4 boards.
 */
export const resawUsableIn = (b: BoardThickness, p: Params): number => b.nominalIn - p.millingAllowanceIn;

/** Strips of rough thickness `stripT` that one board of usable thickness `usableIn` yields: each cut costs a kerf, the last strip needs none after it. */
export function stripsPerBoard(stripT: number, usableIn: number, kerfIn: number): number {
  return Math.max(0, Math.floor((usableIn + kerfIn + 1e-9) / (stripT + kerfIn)));
}

interface StripItem { partNo: string; id: string; widthIn: number; lengthIn: number }

/**
 * RIP FIRST, then resaw (the standard way, and it needs no resaw height above one lane): the board is ripped into LANES across its width (a lane is as wide as its widest strip, plus a kerf),
 * then each lane is resawn through the thickness into `k` slabs, one strip each. So a lane holds up to `k` strips, all cut from the same lane width (a narrower strip may come from a wider lane).
 * Sorting by width and taking `k` at a time minimizes the total lane width.
 */
export function makeLanes(items: StripItem[], k: number): StripItem[][] {
  const sorted = [...items].sort((a, b) => b.widthIn - a.widthIn || b.lengthIn - a.lengthIn);
  const lanes: StripItem[][] = [];
  for (let i = 0; i < sorted.length; i += Math.max(1, k)) lanes.push(sorted.slice(i, i + Math.max(1, k)));
  return lanes;
}
const laneWidth = (lane: StripItem[]): number => Math.max(...lane.map((s) => s.widthIn));

/** First-fit decreasing: put lanes (each `laneWidth` + a rip kerf) into exactly `boards` boards `widthIn` wide; null when they do not fit. */
function packLanes(lanes: StripItem[][], boards: number, kerfIn: number, widthIn: number): StripItem[][][] | null {
  const bins: Array<{ lanes: StripItem[][]; used: number }> = Array.from({ length: boards }, () => ({ lanes: [], used: 0 }));
  for (const lane of [...lanes].sort((a, b) => laneWidth(b) - laneWidth(a))) {
    const need = laneWidth(lane) + kerfIn;
    const bin = bins.find((q) => q.used + need <= widthIn + kerfIn + 1e-9);
    if (!bin) return null;
    bin.lanes.push(lane);
    bin.used += need;
  }
  return bins.map((q) => q.lanes);
}

const boardLengthFor = (longest: number): number => BOARD_LENGTHS_IN.find((l) => l >= longest - 1e-9) ?? BOARD_LENGTHS_IN[BOARD_LENGTHS_IN.length - 1];

/** Widths of the strip boards to ask for (in): random-width rough stock. A wider board takes more lanes, so a wide pool needs fewer boards and leaves a spare. */
export const RESAW_BOARD_WIDTHS_IN: readonly number[] = [BOARD_WIDTH_IN, 7, 8, 9, 10];
/** The purchase must leave at least this many spare strips per pool (the strip bend test can fail one; a second trip to the yard costs more than a board). */
export const RESAW_MIN_SPARES = 1;

/**
 * Spare strips (of the pool's widest width `stripW`) in a rip-first plan: whole lanes the unused width of each board can still take (`k` strips each),
 * plus the empty slots of lanes that are wide enough for a full-width strip.
 */
export function spareSlots(boardLanes: StripItem[][][], k: number, stripW: number, kerfIn: number, widthIn: number): number {
  let n = 0;
  for (const lanes of boardLanes) {
    const used = lanes.reduce((a, l) => a + laneWidth(l) + kerfIn, 0);
    n += Math.floor((widthIn + kerfIn - used + 1e-9) / (stripW + kerfIn)) * k;
    for (const l of lanes) if (laneWidth(l) >= stripW - 1e-9) n += k - l.length;
  }
  return n;
}

/**
 * Choose, for each pool of equal-thickness strips, the board (thickness and width) that costs the fewest board feet while leaving `RESAW_MIN_SPARES` spare strips
 * (then the fewest boards, the narrowest, the thinnest). The cut order is RIP FIRST (lanes across the width), then resaw each lane (see `makeLanes`).
 */
export function planResaw(parts: Part[], p: Params): ResawPool[] {
  const byT = new Map<number, StripItem[]>();
  for (const x of parts.filter((q) => isBuilt(q) && isStripPart(q))) {
    const rough = x.rough ?? { t: (x.stock?.t ?? 0) + p.millingAllowanceIn, w: (x.stock?.w ?? 0) + p.millingAllowanceIn, l: (x.stock?.l ?? 0) + 4 * p.millingAllowanceIn };
    const t = r3(rough.t);
    const arr = byT.get(t) ?? [];
    for (let i = 0; i < (x.plies ?? 1); i++) arr.push({ partNo: partKey(x), id: x.id, widthIn: rough.w, lengthIn: rough.l });
    byT.set(t, arr);
  }
  const pools: ResawPool[] = [];
  for (const [roughT, items] of [...byT.entries()].sort((a, b) => a[0] - b[0])) {
    const boardLengthIn = boardLengthFor(Math.max(...items.map((i) => i.lengthIn)));
    const stripW = Math.max(...items.map((i) => i.widthIn));
    const yieldByBoard: Record<string, number> = {};
    type Pick = { b: BoardThickness; k: number; boards: number; bf: number; widthIn: number; lanes: StripItem[][]; slots: number };
    let best: Pick | null = null;
    for (const b of BOARD_THICKNESSES) {
      if (!isOakStocked(b.nominal)) continue; // resaw only from a thickness the yard stocks (prices.ts OAK_STOCKED)
      const k = stripsPerBoard(roughT, resawUsableIn(b, p), p.resawKerfIn);
      yieldByBoard[b.nominal] = k;
      if (k < 1) continue;
      const lanes = makeLanes(items, k);
      for (const widthIn of RESAW_BOARD_WIDTHS_IN) {
        if (stripW > widthIn + 1e-9) continue;
        let boards = 1, spares = 0, packed: StripItem[][][] | null = null;
        for (; boards <= lanes.length + 6; boards++) {
          packed = packLanes(lanes, boards, p.resawKerfIn, widthIn);
          if (!packed) continue;
          spares = spareSlots(packed, k, stripW, p.resawKerfIn, widthIn);
          if (spares >= RESAW_MIN_SPARES) break;
        }
        if (!packed) continue;
        const bf = (boards * b.nominalIn * widthIn * boardLengthIn) / 144;
        const better = !best || bf < best.bf - 1e-9 || (Math.abs(bf - best.bf) < 1e-9 && (boards < best.boards || (boards === best.boards && widthIn < best.widthIn)));
        if (better) best = { b, k, boards, bf, widthIn, lanes, slots: items.length + spares };
      }
    }
    const fallbackLanes = makeLanes(items, 1);
    const c: Pick = best ?? { b: BOARD_THICKNESSES[BOARD_THICKNESSES.length - 1], k: 1, boards: fallbackLanes.length, bf: 0, widthIn: BOARD_WIDTH_IN, lanes: fallbackLanes, slots: items.length };
    pools.push({
      roughT, strips: items.length, board: c.b.nominal, boardLengthIn, boardWidthIn: c.widthIn, yieldByBoard, stripsPerBoard: c.k,
      lanes: c.lanes.length, boards: c.boards, boardFeet: c.bf, laneStrips: c.lanes,
      stripSlots: c.slots, spares: c.slots - items.length, yieldPerBoard: Math.floor(c.slots / c.boards),
    });
  }
  return pools;
}

function stripRows(parts: Part[], p: Params, pools: ResawPool[], warnings: string[]): StripRow[] {
  const map = new Map<string, StripRow>();
  for (const x of parts.filter((q) => isBuilt(q) && isStripPart(q))) {
    const stock = sanitize(x.stock ?? { t: 0, w: 0, l: 0 }, [], `${partKey(x)} stock`);
    const rough = roughOf(x, p, warnings);
    const plies = x.plies ?? 1;
    const key = `${partKey(x)}|${dimKey(rough)}`;
    const row = map.get(key);
    if (row) { row.parts += 1; row.strips += plies; row.ids.push(x.id); continue; }
    const pool = pools.find((q) => Math.abs(q.roughT - r3(rough.t)) < 1e-6);
    map.set(key, { partNo: partKey(x), name: x.name, parts: 1, plies, strips: plies, ids: [x.id], stock, rough, resawFrom: pool?.board ?? '?' });
  }
  return [...map.values()];
}

// ── Plywood ───────────────────────────────────────────────────────────────────

/** Sheet class of a plywood thickness: 4 mm (0.157") and 12 mm (0.472") are the two sheets bought. */
export const sheetClass = (thicknessIn: number): { label: string; mm: number } => {
  const mm = Math.round(thicknessIn * 25.4);
  return { label: `${mm} mm`, mm };
};

/**
 * A sheet whose Shaper file cuts a NET length shorter than the blank (the side web: the file is the flat development, the blank carries the S1 trim): say both numbers on the row.
 * Null when the file and the blank agree (within 0.02 in).
 */
function shaperNetNote(x: Part, stock: Dims): string | null {
  const f = flatPattern(x);
  if (!f) return null;
  const net = Math.max(f.widthIn, f.heightIn);
  if (stock.l - net < 0.02) return null;
  return `cut net ${r3(net)}" from the Shaper file; blank ${r3(stock.l)}" (+${r3(stock.l - net)}" trim, S1)`;
}

function sheetGroups(parts: Part[], warnings: string[], stepOf?: ReadonlyMap<string, number>): SheetGroup[] {
  const groups = new Map<number, SheetGroup>();
  for (const x of parts.filter((q) => isBuilt(q) && q.kind === 'sheet')) {
    const stock = sanitize(x.stock ?? { t: 0, w: 0, l: 0 }, warnings, `${partKey(x)} stock`);
    const c = sheetClass(stock.t);
    const g = groups.get(c.mm) ?? { label: c.label, thicknessMm: c.mm, thicknessIn: stock.t, rows: [], pieces: 0 };
    groups.set(c.mm, g);
    g.pieces += 1;
    const key = `${partKey(x)}|${dimKey(stock)}`;
    const row = g.rows.find((r) => `${r.partNo}|${dimKey(r.stock)}` === key);
    if (row) { row.qty += 1; row.ids.push(x.id); row.step = Math.min(row.step, x.step); row.assemblySteps = stepsOf(row.ids, stepOf); }
    else {
      const gw = grainInWords(x);
      const note = shaperNetNote(x, stock);
      g.rows.push({ partNo: partKey(x), name: x.name, qty: 1, ids: [x.id], stock, grain: x.grain, ...(gw ? { grainWord: gw } : {}), fab: x.fab, step: x.step, assemblySteps: stepsOf([x.id], stepOf), ...(note ? { note } : {}) });
    }
  }
  return [...groups.values()].sort((a, b) => a.thicknessMm - b.thicknessMm);
}

// ── Metal ─────────────────────────────────────────────────────────────────────

export const fracIn = (v: number): string => {
  const sixteenths = Math.round(v * 16);
  if (Math.abs(v - sixteenths / 16) > 0.006 || sixteenths === 0) return String(r3(v));
  let n = sixteenths, d = 16;
  while (n % 2 === 0 && d > 1) { n /= 2; d /= 2; }
  const whole = Math.floor(n / d), rem = n - whole * d;
  return rem === 0 ? String(whole) : whole ? `${whole}-${rem}/${d}` : `${rem}/${d}`;
};

/** Stock dimensions for a metal part: the model's `stock`, else parsed from the sourcing text ('flat bar 0.0625" x 1", 6" piece'). */
function metalDims(x: Part, warnings: string[]): Dims {
  if (x.stock) return x.stock;
  const v = x.sourcing?.vendor ?? '';
  const m = /(\d*\.?\d+)"\s*[×x]\s*(\d*\.?\d+)"[^0-9]*?(\d*\.?\d+)"\s*piece/.exec(v);
  warnings.push(`${partKey(x)}: metal part has no stock dimensions; ${m ? `read ${m[1]}" x ${m[2]}" x ${m[3]}" from its sourcing text` : 'cut length unknown'}`);
  return m ? { t: Number(m[1]), w: Number(m[2]), l: Number(m[3]) } : { t: 0, w: 0, l: 0 };
}

export function metalFamily(x: Part): string | null {
  const m = x.material.toLowerCase();
  if (/aluminum/.test(m)) return 'Aluminum tube';
  if (/angle/.test(m)) return 'Angle';
  if (/flat bar/.test(m)) return 'Flat bar';
  if (/steel/.test(m) && !/stainless/.test(m)) return 'DOM tube';
  return null;
}

function metalSection(x: Part, family: string, d: Dims): string {
  const v = x.sourcing?.vendor ?? '';
  const wall = (): number | undefined => { const m = /(\d*\.\d+)"\s*wall/.exec(v); return m ? Number(m[1]) : x.geometry.type === 'cylinder' ? x.geometry.wall : undefined; };
  switch (family) {
    case 'DOM tube': return `${fracIn(d.t)}" OD x ${(wall() ?? 0.12).toFixed(3)}" wall DOM tube (ASTM A513 Type 5)`;
    case 'Aluminum tube': return `6061-T6 ${fracIn(d.t)}" x ${fracIn(d.w)}" x ${(wall() ?? 0.125).toFixed(3)}" wall rectangular tube`;
    case 'Angle': return `316 stainless angle ${fracIn(d.w)}" x ${fracIn(d.w)}" x ${(d.t).toFixed(3)}"`;
    default: return `316 stainless flat bar ${fracIn(d.t)}" x ${fracIn(d.w)}"`;
  }
}

function metalRows(parts: Part[], warnings: string[], stepOf?: ReadonlyMap<string, number>): MetalRow[] {
  const map = new Map<string, MetalRow>();
  for (const x of parts.filter((q) => isBuilt(q) && q.kind === 'metal')) {
    const family = metalFamily(x);
    if (!family) { warnings.push(`${partKey(x)}: unrecognized metal material '${x.material}'`); continue; }
    const w: string[] = [];
    const d = metalDims(x, w);
    warnings.push(...w);
    const section = metalSection(x, family, d);
    const key = `${partKey(x)}|${dimKey(d)}`;
    const row = map.get(key);
    if (row) { row.qty += 1; row.ids.push(x.id); row.step = Math.min(row.step, x.step); row.assemblySteps = stepsOf(row.ids, stepOf); continue; }
    map.set(key, { partNo: partKey(x), name: x.name, qty: 1, ids: [x.id], family, section, material: x.material, cutLengthIn: d.l, stock: d, fab: x.fab, step: x.step, assemblySteps: stepsOf([x.id], stepOf), warnings: w });
  }
  return [...map.values()].sort((a, b) => a.family.localeCompare(b.family) || b.cutLengthIn - a.cutLengthIn);
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * @param stepOf part id -> ASSEMBLY step number (`stepMapOf(assemblySteps(...))`). Optional: `assembly.ts` imports this module, so the join is done by the caller (`BuildData`).
 */
export function cutList(parts: Part[], p: Params, stepOf?: ReadonlyMap<string, number>): CutList {
  const warnings: string[] = [];
  const pools = planResaw(parts, p);
  const rows = oakRows(parts, p, warnings, stepOf);
  const groupMap = new Map<string, OakGroup>();
  for (const r of rows) {
    const b = r.board === 'resawn' ? null : boardByNominal(r.board);
    const g = groupMap.get(r.board) ?? { board: r.board, nominalIn: b?.nominalIn ?? 0, usableIn: b?.usableIn ?? 0, rows: [], pieces: 0 };
    groupMap.set(r.board, g);
    g.rows.push(r);
    g.pieces += r.qty;
  }
  const order = (g: OakGroup): number => (g.board === 'resawn' ? 1000 : g.nominalIn);
  const oak = [...groupMap.values()].sort((a, b) => order(a) - order(b));
  for (const g of oak) g.rows.sort((a, b) => b.rough.l - a.rough.l);
  const strips = stripRows(parts, p, pools, warnings);
  const sheets = sheetGroups(parts, warnings, stepOf);
  const metal = metalRows(parts, warnings, stepOf);
  for (const r of rows) warnings.push(...r.warnings);

  const d = (x: Dims): string => `${r3(x.t)} x ${r3(x.w)} x ${r3(x.l)}`;
  const csv = {
    oak: toCsv([
      ['Board', 'Part no', 'Name', 'Qty', 'Final T x W x L (in)', 'Rough T x W x L (in)', 'Grain', 'Fab', 'Assembly step', 'Plies'],
      ...oak.flatMap((g) => g.rows.map((r) => [g.board, r.partNo, r.name, r.qty, d(r.stock), d(r.rough), r.grainWord, r.fab, stepText(r.assemblySteps), r.plies])),
    ]),
    strips: toCsv([
      ['Part no', 'Name', 'Parts', 'Plies', 'Strips', 'Final strip T x W x L (in)', 'Rough strip T x W x L (in)', 'Resaw from'],
      ...strips.map((r) => [r.partNo, r.name, r.parts, r.plies, r.strips, d(r.stock), d(r.rough), r.resawFrom]),
    ]),
    sheets: toCsv([
      ['Sheet', 'Part no', 'Name', 'Qty', 'Final T x W x L (in)', 'Grain', 'Fab', 'Assembly step', 'Note'],
      ...sheets.flatMap((g) => g.rows.map((r) => [g.label, r.partNo, r.name, r.qty, d(r.stock), r.grainWord, r.fab, stepText(r.assemblySteps), r.note])),
    ]),
    metal: toCsv([
      ['Stock', 'Part no', 'Name', 'Qty', 'Cut length (in)', 'Fab', 'Assembly step'],
      ...metal.map((r) => [r.section, r.partNo, r.name, r.qty, r.cutLengthIn, r.fab, stepText(r.assemblySteps)]),
    ]),
  };
  return { oak, strips, resaw: pools, sheets, metal, warnings: [...new Set(warnings)], csv };
}
