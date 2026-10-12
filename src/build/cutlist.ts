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
import { OAK_PRICE_PER_BF, isOakStocked } from './prices';
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

// ── Face lamination (D-70) ────────────────────────────────────────────────────

/** One layer of a face-laminated part: cut from a stocked board, planed to `roughT`, glued face to face. */
export interface LaminationLayer {
  /** Stocked board it comes from ('4/4' ...). */
  board: string;
  /** Thickness the layer is planed to BEFORE the glue-up (in): its share of the glued block's rough thickness. */
  roughT: number;
  /** The layer's share of the part's finished thickness (in): what is left of it after the glued block is milled to size. */
  finalT: number;
}

/** How a part too thick for any stocked board is built up: layers glued face to face, then milled to size. */
export interface Lamination {
  layers: LaminationLayer[];
  /** Finished thickness of the part (in) and rough thickness of the glued block (in): `roughT` = finished + the planing allowance, taken ONCE on the glued block. */
  finalT: number;
  roughT: number;
  /** Cost of one square foot of face (USD): the sum over layers of nominal thickness x $/bf. The measure the layer mix is chosen by. */
  costPerFt2: number;
  /** "3 x 3/4\" from 4/4": the layers grouped by board. */
  text: string;
}

/** The most layers a lamination may use (each is a glue line and a pass through the planer). */
export const MAX_LAMINATION_LAYERS = 6;
/** The thinnest layer worth planing and gluing (in). */
export const MIN_LAYER_ROUGH_IN = 0.5;

/**
 * Face lamination for a part whose rough thickness no stocked board yields. Chooses the mix of STOCKED boards (any number from 2 to `MAX_LAMINATION_LAYERS`) that is cheapest
 * per square foot of face, the sum over layers of nominal thickness x $/bf, and fits: every layer's rough thickness must be at most its board's `usableIn`, and the layers must add up to
 * the glued block (`roughT` = finished thickness + the planing allowance, ONCE for the block: the layers are planed to their shares of it, and the block is milled to the finished size
 * after the glue-up, which also takes off the glue squeeze-out and any slip between layers). Each layer's finished share is `finalT` x its share of `roughT`, so the shares sum to the
 * part's finished thickness. The layers are scaled to the boards' usable thicknesses, so a mix of boards gives each layer a thickness in proportion to its board.
 * For the axle beams (2.375" rough) three 4/4 layers ($30 per ft2) beat 6/4 + 4/4 ($30.25), 5/4 + 5/4 ($31.25) and 8/4 + 4/4 ($40). Ties go to fewer layers, then the thinner boards.
 * Null when `roughT` is no more than the thickest stocked board yields (the part is not laminated) or nothing stocked can make it.
 */
/** A lamination mix of quoted boards is preferred when it costs at most this fraction more than the cheapest mix (which may rest on an estimated price). */
export const LAMINATION_QUOTED_TOLERANCE = 0.05;

export function planLamination(finalT: number, roughT: number): Lamination | null {
  const boards = BOARD_THICKNESSES.filter((b) => isOakStocked(b.nominal));
  if (!boards.length || boardForThickness(roughT)) return null;
  const price = (b: BoardThickness): number => b.nominalIn * (OAK_PRICE_PER_BF[b.nominal]?.usd ?? Infinity);
  let best: { mix: BoardThickness[]; cost: number } | null = null;
  const walk = (start: number, mix: BoardThickness[]): void => {
    if (mix.length >= 2) {
      const usable = mix.reduce((a, b) => a + b.usableIn, 0);
      if (usable >= roughT - 1e-6 && mix.every((b) => (roughT * b.usableIn) / usable >= MIN_LAYER_ROUGH_IN - 1e-9)) {
        const cost = mix.reduce((a, b) => a + price(b), 0);
        const nom = mix.reduce((a, b) => a + b.nominalIn, 0), bestNom = best ? best.mix.reduce((a, b) => a + b.nominalIn, 0) : Infinity;
        if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) < 1e-9 && (mix.length < best.mix.length || (mix.length === best.mix.length && nom < bestNom - 1e-9)))) best = { mix: [...mix], cost };
      }
    }
    if (mix.length >= MAX_LAMINATION_LAYERS) return;
    for (let i = start; i < boards.length; i++) { mix.push(boards[i]); walk(i, mix); mix.pop(); }
  };
  walk(0, []);
  if (!best) return null;
  // Near-tie (within LAMINATION_QUOTED_TOLERANCE of the cheapest): prefer a mix whose every board has a QUOTED price, so an estimated price cannot flip the plan by a few
  // cents (Eric 2026-10-12: the estimated 5/4 came out $0.25/ft2 under the quoted 4/4 for the axle beams).
  const cheapest = (best as { cost: number }).cost;
  const quotedMix = (mix: BoardThickness[]): boolean => mix.every((b) => OAK_PRICE_PER_BF[b.nominal]?.basis === 'quoted');
  if (!quotedMix((best as { mix: BoardThickness[] }).mix)) {
    let alt: { mix: BoardThickness[]; cost: number } | null = null;
    const walkQ = (start: number, mix: BoardThickness[]): void => {
      if (mix.length >= 2 && quotedMix(mix)) {
        const usable = mix.reduce((a, b) => a + b.usableIn, 0);
        if (usable >= roughT - 1e-6 && mix.every((b) => (roughT * b.usableIn) / usable >= MIN_LAYER_ROUGH_IN - 1e-9)) {
          const cost = mix.reduce((a, b) => a + price(b), 0);
          if (cost <= cheapest * (1 + LAMINATION_QUOTED_TOLERANCE) + 1e-9 && (!alt || cost < alt.cost - 1e-9 || (Math.abs(cost - alt.cost) < 1e-9 && mix.length < alt.mix.length))) alt = { mix: [...mix], cost };
        }
      }
      if (mix.length >= MAX_LAMINATION_LAYERS) return;
      for (let i = start; i < boards.length; i++) { mix.push(boards[i]); walkQ(i, mix); mix.pop(); }
    };
    walkQ(0, []);
    if (alt) best = alt;
  }
  const { mix, cost } = best as { mix: BoardThickness[]; cost: number };
  const usable = mix.reduce((a, b) => a + b.usableIn, 0);
  // thickest layers first, so the face layers are the thick ones
  const layers: LaminationLayer[] = [...mix].sort((a, b) => b.nominalIn - a.nominalIn).map((b) => {
    const share = b.usableIn / usable;
    return { board: b.nominal, roughT: roughT * share, finalT: finalT * share };
  });
  return { layers, finalT, roughT, costPerFt2: cost, text: laminationText(layers) };
}

/** "3 x 3/4\" from 4/4" (several groups: "1 x 1-1/4\" from 8/4 + 1 x 5/8\" from 4/4"). */
export function laminationText(layers: LaminationLayer[]): string {
  const groups: Array<{ board: string; n: number; finalT: number }> = [];
  for (const l of layers) {
    const g = groups.find((q) => q.board === l.board && Math.abs(q.finalT - l.finalT) < 1e-6);
    if (g) g.n += 1; else groups.push({ board: l.board, n: 1, finalT: l.finalT });
  }
  return groups.map((g) => `${g.n} \u00d7 ${fracIn(g.finalT)}" from ${g.board}`).join(' + ');
}

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
  /** Nominal board the piece is milled from ('4/4' ...), 'resawn' for laminate members (see the strip list), or 'laminated' for a part built up from face-glued layers (see `lamination`). */
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
  /** Sizing notes for the bench (a Shaper file cuts net, the blank is longer). For a laminated part: "face-laminated: 3 x 3/4" from 4/4 ...". */
  note?: string;
  plies?: number;
  /** Set when no stocked board yields the rough thickness (D-70): the part is glued up face to face from `lamination.layers`; `board` is then 'laminated' and `rough` is the glued block. */
  lamination?: Lamination;
  /** The layer pieces of a laminated part (one set per physical part, each `edgeGlued` times across when wider than a board). Empty for other rows. */
  layerPieces: LayerPiece[];
  warnings: string[];
}

/** One layer of a laminated row: `qty` identical pieces (the row's quantity x the layer's edge-glue pieces), cut from `board`, planed to `roughT` before the glue-up. */
export interface LayerPiece {
  /** 1-based layer number, from the face layer. */
  layer: number;
  layers: number;
  board: string;
  /** Rough size of one piece (in): thickness the layer is planed to x width (the whole layer, or its share when `edgeGlued` > 1) x length. */
  roughT: number;
  widthIn: number;
  lengthIn: number;
  /** The layer's share of the finished thickness (in). */
  finalT: number;
  /** Pieces this layer is edge-glued from when it is wider than a board. 1 = one piece. */
  edgeGlued: number;
  /** Physical pieces in the whole row: row qty x `edgeGlued`. */
  qty: number;
}

export interface OakGroup {
  /** Heading for the group: '4/4 (usable 15/16"), 20 pieces', 'Face-laminated parts', 'Resawn strips'. */
  title: string;
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
  /** Layer pieces of every face-laminated part (D-70), flat: empty when no part is laminated. Each carries its parent row. */
  layers: Array<LayerPiece & { row: OakRow }>;
  strips: StripRow[];
  resaw: ResawPool[];
  sheets: SheetGroup[];
  metal: MetalRow[];
  /** Data problems found in the model (transposed stock, missing stock). */
  warnings: string[];
  csv: { oak: string; layers: string; strips: string; sheets: string; metal: string };
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
    let lamination: Lamination | undefined;
    const w: string[] = [];
    if (strip) board = 'resawn';
    else {
      const b = boardForThickness(rough.t);
      board = b ? b.nominal : '16/4';
      if (!b) {
        // No stocked board is thick enough (12/4 is not bought, D-70): glue the part up face to face from layers of stocked boards.
        lamination = planLamination(stock.t, rough.t) ?? undefined;
        if (lamination) board = 'laminated';
        else w.push(`${partKey(x)}: rough thickness ${r3(rough.t)}" is thicker than any stocked board and no stocked mix of layers makes it`);
      } else if (b.nominal === '16/4') w.push(`${partKey(x)}: needs 16/4 (3-3/4" usable); if the yard has none, glue up two 8/4`);
    }
    const key = `${partKey(x)}|${dimKey(rough)}|${board}`;
    const row = map.get(key);
    if (row) { row.qty += 1; row.ids.push(x.id); row.step = Math.min(row.step, x.step); row.assemblySteps = stepsOf(row.ids, stepOf); continue; }
    const gw = grainInWords(x);
    map.set(key, {
      partNo: partKey(x), name: x.name, qty: 1, ids: [x.id], stock, rough, board, grain: x.grain, ...(gw ? { grainWord: gw } : {}), fab: x.fab, step: x.step, assemblySteps: stepsOf([x.id], stepOf),
      ...(x.plies !== undefined ? { plies: x.plies } : {}), ...(lamination ? { lamination, note: laminationNote(lamination) } : {}), layerPieces: [], warnings: w,
    });
  }
  const out = [...map.values()];
  for (const r of out) if (r.lamination) r.layerPieces = layerPiecesOf(r.lamination, r.rough, r.qty);
  return out;
}

/** The note a laminated row carries into the cut list, the CSV and the build book. */
export function laminationNote(l: Lamination): string {
  const planed = [...new Set(l.layers.map((q) => fracIn(Math.round(q.roughT * 1000) / 1000)))].join(', ');
  return `face-laminated: ${l.text} (D-70). Plane each layer to ${planed}" (the ${r3(l.roughT - l.finalT)}" planing allowance is taken once, on the glued block), epoxy the layers face to face, then mill the block to ${fracIn(l.finalT)}" thick.`;
}

/** Layer pieces of a laminated part: each layer is rough width x length, edge-glued from several pieces when wider than a board. `qty` is the number of parts. */
export function layerPiecesOf(l: Lamination, rough: Dims, qty: number): LayerPiece[] {
  const n = Math.max(1, Math.ceil(rough.w / BOARD_WIDTH_IN - 1e-9));
  return l.layers.map((q, i) => ({ layer: i + 1, layers: l.layers.length, board: q.board, roughT: q.roughT, widthIn: rough.w / n, lengthIn: rough.l, finalT: q.finalT, edgeGlued: n, qty: qty * n }));
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
    const b = r.board === 'resawn' || r.board === 'laminated' ? null : boardByNominal(r.board);
    const g = groupMap.get(r.board) ?? { title: '', board: r.board, nominalIn: b?.nominalIn ?? 0, usableIn: b?.usableIn ?? 0, rows: [], pieces: 0 };
    groupMap.set(r.board, g);
    g.rows.push(r);
    g.pieces += r.qty;
  }
  const order = (g: OakGroup): number => (g.board === 'resawn' ? 1000 : g.board === 'laminated' ? 500 : g.nominalIn);
  const oak = [...groupMap.values()].sort((a, b) => order(a) - order(b));
  for (const g of oak) {
    g.rows.sort((a, b) => b.rough.l - a.rough.l);
    g.title = g.board === 'resawn' ? `Resawn strips (${g.pieces} pieces: see the strip list)`
      : g.board === 'laminated' ? `Face-laminated parts (${g.pieces} pieces: glued from stocked boards, D-70; see the layers)`
        : `${g.board} (usable ${fracIn(g.usableIn)}"), ${g.pieces} pieces`;
  }
  const layers = oak.flatMap((g) => g.rows.flatMap((r) => r.layerPieces.map((q) => ({ row: r, ...q }))));
  const strips = stripRows(parts, p, pools, warnings);
  const sheets = sheetGroups(parts, warnings, stepOf);
  const metal = metalRows(parts, warnings, stepOf);
  for (const r of rows) warnings.push(...r.warnings);

  const d = (x: Dims): string => `${r3(x.t)} x ${r3(x.w)} x ${r3(x.l)}`;
  const csv = {
    oak: toCsv([
      ['Board', 'Part no', 'Name', 'Qty', 'Final T x W x L (in)', 'Rough T x W x L (in)', 'Grain', 'Fab', 'Assembly step', 'Plies', 'Lamination'],
      ...oak.flatMap((g) => g.rows.map((r) => [g.board, r.partNo, r.name, r.qty, d(r.stock), d(r.rough), r.grainWord, r.fab, stepText(r.assemblySteps), r.plies, r.lamination ? `face-laminated: ${r.lamination.text}` : undefined])),
    ]),
    layers: toCsv([
      ['Part no', 'Name', 'Layer', 'Of', 'Board', 'Pieces', 'Rough layer T x W x L (in)', 'Layer share of final T (in)', 'Edge-glued from', 'Glued block rough T (in)', 'Final T (in)', 'Lamination'],
      ...layers.map((q) => [q.row.partNo, q.row.name, q.layer, q.layers, q.board, q.qty, `${r3(q.roughT)} x ${r3(q.widthIn)} x ${r3(q.lengthIn)}`, q.finalT, q.edgeGlued, q.row.lamination!.roughT, q.row.lamination!.finalT, q.row.lamination!.text]),
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
  return { oak, layers, strips, resaw: pools, sheets, metal, warnings: [...new Set(warnings)], csv };
}
