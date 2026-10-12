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
import type { Dims, Part } from '../model/types';
import type { Params } from '../params';

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
  return BOARD_THICKNESSES.find((b) => b.usableIn >= roughT - 1e-6) ?? null;
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
  grain?: string;
  fab: string;
  /** Assembly step (lowest, when pieces differ). */
  step: number;
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
  /** Strips one board yields through its thickness, per candidate board (kerf and planing allowance included). */
  yieldByBoard: Record<string, number>;
  /** Strips per board thickness for the chosen board. */
  stripsPerBoard: number;
  /** Resawn layers (6" wide slabs) needed, each carrying several strips side by side. */
  layers: number;
  /** Boards to buy for the pool, and their board feet. */
  boards: number;
  boardFeet: number;
  /** Strip to layer assignment: index into the pool's strip list. */
  layerStrips: Array<Array<{ partNo: string; id: string; widthIn: number; lengthIn: number }>>;
}

export interface SheetRow {
  partNo: string;
  name: string;
  qty: number;
  ids: string[];
  stock: Dims;
  grain?: string;
  fab: string;
  step: number;
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

function oakRows(parts: Part[], p: Params, warnings: string[]): OakRow[] {
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
    if (row) { row.qty += 1; row.ids.push(x.id); row.step = Math.min(row.step, x.step); continue; }
    map.set(key, {
      partNo: partKey(x), name: x.name, qty: 1, ids: [x.id], stock, rough, board, grain: x.grain, fab: x.fab, step: x.step,
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

/** First-fit decreasing: pack strips side by side into 6"-wide layers (a rip kerf between them). */
function packLayers(items: StripItem[], kerfIn: number): StripItem[][] {
  const sorted = [...items].sort((a, b) => b.widthIn - a.widthIn || b.lengthIn - a.lengthIn);
  const layers: Array<{ items: StripItem[]; used: number }> = [];
  for (const it of sorted) {
    const need = it.widthIn + kerfIn;
    let layer = layers.find((l) => l.used + need <= BOARD_WIDTH_IN + kerfIn + 1e-9);
    if (!layer) layers.push((layer = { items: [], used: 0 }));
    layer.items.push(it);
    layer.used += need;
  }
  return layers.map((l) => l.items);
}

const boardLengthFor = (longest: number): number => BOARD_LENGTHS_IN.find((l) => l >= longest - 1e-9) ?? BOARD_LENGTHS_IN[BOARD_LENGTHS_IN.length - 1];

/** Choose, for each pool of equal-thickness strips, the board thickness that costs the fewest board feet (then the fewest boards, then the thinnest). */
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
    const layers = packLayers(items, p.resawKerfIn);
    const boardLengthIn = boardLengthFor(Math.max(...items.map((i) => i.lengthIn)));
    const yieldByBoard: Record<string, number> = {};
    let best: { b: BoardThickness; k: number; boards: number; bf: number } | null = null;
    for (const b of BOARD_THICKNESSES) {
      const k = stripsPerBoard(roughT, resawUsableIn(b, p), p.resawKerfIn);
      yieldByBoard[b.nominal] = k;
      if (k < 1) continue;
      const boards = Math.ceil(layers.length / k);
      const bf = (boards * b.nominalIn * BOARD_WIDTH_IN * boardLengthIn) / 144;
      if (!best || bf < best.bf - 1e-9 || (Math.abs(bf - best.bf) < 1e-9 && boards < best.boards)) best = { b, k, boards, bf };
    }
    const chosen = best ?? { b: BOARD_THICKNESSES[BOARD_THICKNESSES.length - 1], k: 1, boards: layers.length, bf: 0 };
    pools.push({
      roughT, strips: items.length, board: chosen.b.nominal, boardLengthIn, yieldByBoard, stripsPerBoard: chosen.k,
      layers: layers.length, boards: chosen.boards, boardFeet: chosen.bf, layerStrips: layers,
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

function sheetGroups(parts: Part[], warnings: string[]): SheetGroup[] {
  const groups = new Map<number, SheetGroup>();
  for (const x of parts.filter((q) => isBuilt(q) && q.kind === 'sheet')) {
    const stock = sanitize(x.stock ?? { t: 0, w: 0, l: 0 }, warnings, `${partKey(x)} stock`);
    const c = sheetClass(stock.t);
    const g = groups.get(c.mm) ?? { label: c.label, thicknessMm: c.mm, thicknessIn: stock.t, rows: [], pieces: 0 };
    groups.set(c.mm, g);
    g.pieces += 1;
    const key = `${partKey(x)}|${dimKey(stock)}`;
    const row = g.rows.find((r) => `${r.partNo}|${dimKey(r.stock)}` === key);
    if (row) { row.qty += 1; row.ids.push(x.id); row.step = Math.min(row.step, x.step); }
    else g.rows.push({ partNo: partKey(x), name: x.name, qty: 1, ids: [x.id], stock, grain: x.grain, fab: x.fab, step: x.step });
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

function metalRows(parts: Part[], warnings: string[]): MetalRow[] {
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
    if (row) { row.qty += 1; row.ids.push(x.id); row.step = Math.min(row.step, x.step); continue; }
    map.set(key, { partNo: partKey(x), name: x.name, qty: 1, ids: [x.id], family, section, material: x.material, cutLengthIn: d.l, stock: d, fab: x.fab, step: x.step, warnings: w });
  }
  return [...map.values()].sort((a, b) => a.family.localeCompare(b.family) || b.cutLengthIn - a.cutLengthIn);
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function cutList(parts: Part[], p: Params): CutList {
  const warnings: string[] = [];
  const pools = planResaw(parts, p);
  const rows = oakRows(parts, p, warnings);
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
  const sheets = sheetGroups(parts, warnings);
  const metal = metalRows(parts, warnings);
  for (const r of rows) warnings.push(...r.warnings);

  const d = (x: Dims): string => `${r3(x.t)} x ${r3(x.w)} x ${r3(x.l)}`;
  const csv = {
    oak: toCsv([
      ['Board', 'Part no', 'Name', 'Qty', 'Final T x W x L (in)', 'Rough T x W x L (in)', 'Grain', 'Fab', 'Step', 'Plies'],
      ...oak.flatMap((g) => g.rows.map((r) => [g.board, r.partNo, r.name, r.qty, d(r.stock), d(r.rough), r.grain, r.fab, r.step, r.plies])),
    ]),
    strips: toCsv([
      ['Part no', 'Name', 'Parts', 'Plies', 'Strips', 'Final strip T x W x L (in)', 'Rough strip T x W x L (in)', 'Resaw from'],
      ...strips.map((r) => [r.partNo, r.name, r.parts, r.plies, r.strips, d(r.stock), d(r.rough), r.resawFrom]),
    ]),
    sheets: toCsv([
      ['Sheet', 'Part no', 'Name', 'Qty', 'Final T x W x L (in)', 'Grain', 'Fab', 'Step'],
      ...sheets.flatMap((g) => g.rows.map((r) => [g.label, r.partNo, r.name, r.qty, d(r.stock), r.grain, r.fab, r.step])),
    ]),
    metal: toCsv([
      ['Stock', 'Part no', 'Name', 'Qty', 'Cut length (in)', 'Fab', 'Step'],
      ...metal.map((r) => [r.section, r.partNo, r.name, r.qty, r.cutLengthIn, r.fab, r.step]),
    ]),
  };
  return { oak, strips, resaw: pools, sheets, metal, warnings: [...new Set(warnings)], csv };
}
