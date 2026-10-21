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
import { PARAM_DEFS, type Params } from '../params';
import { localBounds } from '../model/bounds';
import { computeLayout, sideTopAt } from '../model/layout';
import { boxTieGeometry, sideRibStations } from '../model/side-ribs';
import { flatPattern } from './flat';
import { laserVerdict, type LaserVerdict } from './laser-svg';
import { finalDimsText, finalFrac, fractionText, fractionizeInches, nearest32, roughDimsText, roughFrac, roughUp8 } from './units';

export { finalFrac, roughFrac, finalDimsText, roughDimsText, roughUp8 };

/**
 * True for a cross-laminated block (the brake knee) whose W is its tall side and whose L is the short one: "T x W x L" misleads there (the 9-1/2" side is not a "width" and the 3-11/16" side
 * is not a "length"), so the sizes are written "2-1/8" thick x 9-1/2" tall x 3-11/16" across".
 */
export const isTallBlock = (x: Pick<Part, 'layerGrain'>, d: Dims): boolean => !!x.layerGrain && d.w > d.l + 1e-6;
/** A size as the shop reads it: "3/4 x 5-7/8 x 25-1/2" (T x W x L), or for a tall cross-laminated block `2-1/8" thick x 9-1/2" tall x 3-11/16" across`. `rough` rounds up to 1/8, else to the nearest 1/32. */
export function sizeText(d: Dims, rough: boolean, tall = false): string {
  if (!tall) return rough ? roughDimsText(d) : finalDimsText(d);
  const f = rough ? roughFrac : finalFrac;
  return `${f(d.t)} thick \u00d7 ${f(d.w)} tall \u00d7 ${f(d.l)} across`;
}

// ── Board thickness map ───────────────────────────────────────────────────────

export interface BoardThickness {
  /** Quarters-notation name, e.g. '8/4'. */
  nominal: string;
  /** Nominal thickness in inches (4/4 = 1"): what board feet are computed on and what the yard prices. */
  nominalIn: number;
  /** Legacy "rough part this board yields" figure (rough sizes are no longer compared with it; see `finishedIn`). Kept for the group headings' history and the data shape. */
  usableIn: number;
  /**
   * The RELIABLE FINISHED thickness of the board (in), after jointing and planing both faces (Eric 2026-10-13: "4/4 stock is often actually closer to 3/4"). This is the default of the
   * `yieldParam` param; pass `p` to `boardFinishedIn` for the live value. A solid part's FINAL thickness must be at most this; a face-laminated layer is planed to at most this.
   */
  finishedIn: number;
  /** The params.ts key that holds `finishedIn`. */
  yieldParam: 'boardYield44In' | 'boardYield54In' | 'boardYield64In' | 'boardYield84In' | 'boardYield124In' | 'boardYield164In';
}

/**
 * Board thickness table. A part is bought from the thinnest STOCKED board whose reliable finished thickness (`finishedIn`: 4/4 3/4", 5/4 1", 6/4 1-1/4", 8/4 1-3/4", 12/4 2-3/4",
 * the `boardYield*` params, Eric 2026-10-13) is at least the part's FINAL thickness. The rough piece is still the final thickness plus `millingAllowanceIn`. The resaw math uses the
 * board's rough thickness (`resawUsableIn`). 16/4 is here only for the brake chock and shoe blocks; yards stock it less often, so those rows carry a note (or glue up two 8/4).
 */
export const BOARD_THICKNESSES: readonly BoardThickness[] = [
  { nominal: '4/4', nominalIn: 1, usableIn: 15 / 16, finishedIn: PARAM_DEFS.boardYield44In.default, yieldParam: 'boardYield44In' },
  { nominal: '5/4', nominalIn: 1.25, usableIn: 1 + 3 / 16, finishedIn: PARAM_DEFS.boardYield54In.default, yieldParam: 'boardYield54In' },
  { nominal: '6/4', nominalIn: 1.5, usableIn: 1 + 7 / 16, finishedIn: PARAM_DEFS.boardYield64In.default, yieldParam: 'boardYield64In' },
  { nominal: '8/4', nominalIn: 2, usableIn: 1 + 7 / 8, finishedIn: PARAM_DEFS.boardYield84In.default, yieldParam: 'boardYield84In' },
  { nominal: '12/4', nominalIn: 3, usableIn: 2 + 7 / 8, finishedIn: PARAM_DEFS.boardYield124In.default, yieldParam: 'boardYield124In' },
  { nominal: '16/4', nominalIn: 4, usableIn: 3 + 7 / 8, finishedIn: PARAM_DEFS.boardYield164In.default, yieldParam: 'boardYield164In' },
];

/** The reliable finished thickness of a board (in): the live param when `p` is given, else the default. */
export const boardFinishedIn = (b: BoardThickness, p?: Pick<Params, BoardThickness['yieldParam']>): number => (p ? p[b.yieldParam] : b.finishedIn);

/** Smallest STOCKED board whose reliable finished thickness is at least the part's FINAL thickness `finalT`, or null when none is (the part is face-laminated). */
export function boardForThickness(finalT: number, p?: Pick<Params, BoardThickness['yieldParam']>): BoardThickness | null {
  return BOARD_THICKNESSES.find((b) => isOakStocked(b.nominal) && boardFinishedIn(b, p) >= finalT - 1e-6) ?? null;
}
export const boardByNominal = (nominal: string): BoardThickness => BOARD_THICKNESSES.find((b) => b.nominal === nominal)!;

// ── Face lamination (D-70) ────────────────────────────────────────────────────

/** One layer of a face-laminated part: cut from a stocked board, planed to `roughT`, glued face to face. */
export interface LaminationLayer {
  /** Stocked board it comes from ('4/4' ...). */
  board: string;
  /** Thickness the layer is planed to BEFORE the glue-up (in): the board's reliable finished thickness rounded DOWN to 1/16. */
  roughT: number;
  /** The same planed layer thickness (in). Kept for compatibility: it used to be the layer's proportional share of the part's finished thickness, which gave odd fractions (27/32"). */
  finalT: number;
}

/** How a part too thick for any stocked board is built up: layers glued face to face, then milled to size. */
export interface Lamination {
  layers: LaminationLayer[];
  /** Finished thickness of the part (in). */
  finalT: number;
  /** Thickness of the glued block (in): the sum of the planed layers. It is jointed and planed down by `cleanupIn` at least, then milled to `finalT`. */
  roughT: number;
  /** Post-glue-up cleanup allowance (in, `laminationCleanupIn`): `roughT - cleanupIn >= finalT`. */
  cleanupIn: number;
  /** Cost of one square foot of face (USD): the sum over layers of nominal thickness x $/bf. The measure the layer mix is chosen by. */
  costPerFt2: number;
  /** "2 layers: 1-3/4\" from 8/4 + 3/4\" from 4/4, glue up, then mill the block to 2-1/4\"": the planed layer thicknesses. */
  text: string;
}

/** The most layers a lamination may use (each is a glue line and a pass through the planer). */
export const MAX_LAMINATION_LAYERS = 6;
/** The thinnest layer worth planing and gluing (in). */
export const MIN_LAYER_ROUGH_IN = 0.5;
/**
 * A lamination mix of QUOTED boards is preferred when it costs at most this fraction more per square foot than the cheapest mix (which may rest on an estimated price). It is also the
 * "near-tie" within which fewer layers win. 15 %, not 5 %: a price can easily be off by that much, and a mix that
 * leans on one 5/4 layer per beam buys a whole 6 ft 5/4 board for a single 30 in piece (Eric 2026-10-13 review: the whole-board lumber came out $4 DEARER than 8/4 + 4/4, which is quoted).
 */
export const LAMINATION_QUOTED_TOLERANCE = 0.15;

/** The thickness (in) a layer of this board is planed to: its reliable finished thickness rounded DOWN to 1/16. */
export const layerThicknessOf = (b: BoardThickness, p?: Pick<Params, BoardThickness['yieldParam']>): number => Math.floor(boardFinishedIn(b, p) * 16 + 1e-6) / 16;

/**
 * Face lamination for a part whose FINAL thickness no stocked board reliably finishes to (Eric 2026-10-13). Every layer is planed to its board's reliable finished thickness
 * (`layerThicknessOf`, rounded down to 1/16), the layers are glued face to face, and the glued block loses `laminationCleanupIn` jointing and planing it flat and square, so a VALID mix has
 * sum(layer thicknesses) - cleanup >= `finalT`. Among the valid mixes of 2 to `MAX_LAMINATION_LAYERS` stocked boards (mixed boards are allowed: 8/4 + 4/4) the cheapest per square foot of face
 * wins (sum over layers of nominal thickness x $/bf). Near-ties (within `LAMINATION_QUOTED_TOLERANCE` of the cheapest) go first to a mix of QUOTED prices only (Eric 2026-10-12: an estimated
 * price must not flip the plan by a few cents), then to fewer layers, then to the lower cost, then the thinner boards.
 * Null when `finalT` is no more than the thickest stocked board finishes to (the part is not laminated) or nothing stocked can make it. `_roughT` is ignored (kept so older callers compile).
 */
export function planLamination(finalT: number, _roughT?: number, p?: Params): Lamination | null {
  const boards = BOARD_THICKNESSES.filter((b) => isOakStocked(b.nominal));
  if (!boards.length || boardForThickness(finalT, p)) return null;
  const cleanup = p ? p.laminationCleanupIn : PARAM_DEFS.laminationCleanupIn.default;
  const price = (b: BoardThickness): number => b.nominalIn * (OAK_PRICE_PER_BF[b.nominal]?.usd ?? Infinity);
  const quoted = (mix: BoardThickness[]): boolean => mix.every((b) => OAK_PRICE_PER_BF[b.nominal]?.basis === 'quoted');
  const valid: Array<{ mix: BoardThickness[]; cost: number; nom: number }> = [];
  const walk = (start: number, mix: BoardThickness[]): void => {
    if (mix.length >= 2) {
      const sum = mix.reduce((a, b) => a + layerThicknessOf(b, p), 0);
      if (sum - cleanup >= finalT - 1e-6 && mix.every((b) => layerThicknessOf(b, p) >= MIN_LAYER_ROUGH_IN - 1e-9)) {
        valid.push({ mix: [...mix], cost: mix.reduce((a, b) => a + price(b), 0), nom: mix.reduce((a, b) => a + b.nominalIn, 0) });
      }
    }
    if (mix.length >= MAX_LAMINATION_LAYERS) return;
    for (let i = start; i < boards.length; i++) { mix.push(boards[i]); walk(i, mix); mix.pop(); }
  };
  walk(0, []);
  if (!valid.length) return null;
  const cheapest = Math.min(...valid.map((v) => v.cost));
  let near = valid.filter((v) => v.cost <= cheapest * (1 + LAMINATION_QUOTED_TOLERANCE) + 1e-9);
  if (near.some((v) => quoted(v.mix))) near = near.filter((v) => quoted(v.mix));
  near.sort((a, b) => a.mix.length - b.mix.length || a.cost - b.cost || a.nom - b.nom);
  const { mix, cost } = near[0];
  // thickest layers first, so the face layers are the thick ones
  const layers: LaminationLayer[] = [...mix].sort((a, b) => b.nominalIn - a.nominalIn).map((b) => ({ board: b.nominal, roughT: layerThicknessOf(b, p), finalT: layerThicknessOf(b, p) }));
  return { layers, finalT, roughT: layers.reduce((a, l) => a + l.roughT, 0), cleanupIn: cleanup, costPerFt2: cost, text: laminationText(layers, finalT) };
}

/** "2 layers: 1-3/4\" from 8/4 + 3/4\" from 4/4" (equal layers grouped: "4 layers: 4 × 3/4\" from 4/4"); with `finalT` it ends ", glue up, then mill the block to 2-1/4\"". The thicknesses are the PLANED layers (1/16 grid). */
export function laminationText(layers: LaminationLayer[], finalT?: number): string {
  const groups: Array<{ board: string; n: number; t: number }> = [];
  for (const l of layers) {
    const g = groups.find((q) => q.board === l.board && Math.abs(q.t - l.roughT) < 1e-6);
    if (g) g.n += 1; else groups.push({ board: l.board, n: 1, t: l.roughT });
  }
  const mix = groups.map((g) => `${g.n > 1 ? `${g.n} × ` : ''}${fractionText(g.t, 16)}" from ${g.board}`).join(' + ');
  return `${layers.length} layers: ${mix}${finalT === undefined ? '' : `, glue up, then mill the block to ${finalFrac(finalT)}`}`;
}

/** Assumed width of the rough boards bought (in) and the lengths they come in (in): 6, 8 and 10 ft. */
export const BOARD_WIDTH_IN = 6;
/**
 * Edge-glued layers of a face-laminated part (not cross-laminated): the seam of each layer sits this far from the seam of the layer next to it (the boards of a layer are unequal, mirrored from one
 * layer to the next), so two seams never stack. A stacked seam is a weak line through the whole thickness: the bridle pull would load the tongue's, the hand-hold sits on the bulkhead's.
 */
export const LAMINATION_SEAM_OFFSET_IN = 2;
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
  // A cross-laminated part has no single grain: say the face layers' and the center layer's (`Part.grain` is the center layer's there, which would contradict the face layers).
  if (x.layerGrain && x.layerGrain.length > 1) return crossGrainWords(x);
  if (!x.grain || !x.stock) return undefined;
  const b = localBounds(x.geometry);
  const k = x.grain === 'x' ? 0 : x.grain === 'y' ? 1 : 2;
  const e = b.max[k] - b.min[k];
  const cands: Array<[string, number]> = [['along L', x.stock.l], ['along W', x.stock.w], ['vertical (T)', x.stock.t]];
  let best = cands[0], bestD = Infinity;
  for (const c of cands) { const d = Math.abs(c[1] - e) / Math.max(c[1], 1e-6); if (d < bestD - 1e-9) { best = c; bestD = d; } }
  return best[0];
}

/**
 * The grain of a cross-laminated part, layer by layer: "face layers: grain upright; center layer: across the sled". The face layers are the first and last, the center layers the ones between.
 * Undefined when the model does not say.
 */
export function crossGrainWords(x: Part): string | undefined {
  const n = x.layerGrain?.length ?? 0;
  const words = Array.from({ length: n }, (_, i) => layerGrainWord(x, i + 1));
  if (n < 2 || words.some((w) => !w)) return undefined;
  const face = words[0], inner = [...new Set(words.slice(1, -1))];
  return inner.length ? `face layers: grain ${face}; center layer${words.length > 3 ? 's' : ''}: ${inner.join(' / ')}` : `grain ${face}`;
}

/** Assembly step numbers (`BuildStep.n`) of each part id, from the step list (structural type: `cutlist.ts` cannot import `assembly.ts`, which imports it). */
export function stepMapOf(steps: ReadonlyArray<{ n: number; partIds: readonly string[] }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of steps) for (const id of s.partIds) if (!m.has(id)) m.set(id, s.n);
  return m;
}
/**
 * Parts that are cut and drilled at another part's step than the one that names them: the D-ring bearing plate is cut from flat bar and drilled with the D-ring plate as the template at the
 * rib-fitting step (the plate's rib is `side-rib-<side><n>`), and bolted on at the hardware step. Both steps are listed.
 */
const cutWith = (id: string): string | undefined => { const m = /^dring-plate-(.+)$/.exec(id); return m ? `side-rib-${m[1]}` : undefined; };
const stepsOf = (ids: string[], m?: ReadonlyMap<string, number>): number[] =>
  m ? [...new Set(ids.flatMap((i) => [m.get(i), (() => { const w = cutWith(i); return w ? m.get(w) : undefined; })()]).filter((v): v is number => v !== undefined))].sort((a, b) => a - b) : [];
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

// ── Display words ─────────────────────────────────────────────────────────────

/** How a fabrication tag reads at the bench: 'shaper-origin' -> 'Shaper Origin', 'table-saw' -> 'table saw', 'bentlam' -> 'bent laminate'; the model's legacy metal id 'drill-tap' is "cut on the metal bandsaw and drill" (D-77: nothing is tapped). */
export function fabText(fab: string): string {
  const words: Record<string, string> = { 'shaper-origin': 'Shaper Origin', bentlam: 'bent laminate', 'drill-tap': 'cut on the metal bandsaw and drill', bandsaw: 'bandsaw' };
  return words[fab] ?? fab.replace(/-/g, ' ');
}
/** 'board 2 of 3', 'layer 1 of 3', 'resawn strip', 'one piece': which piece of its part a cut is (the same words as the UI). */
export function pieceText(c: Pick<Cut, 'piece' | 'index' | 'of' | 'layer' | 'layers'>): string {
  switch (c.piece) {
    case 'board': return c.of > 1 ? `board ${c.index} of ${c.of}` : 'one board';
    case 'layer': return `layer ${c.layer ?? c.index} of ${c.layers ?? c.of}`;
    case 'strip': return 'resawn strip';
    default: return 'one piece';
  }
}
/** Where a finished part comes from, in words. */
export const FROM_TEXT: Record<FinishedPart['from'], string> = { board: 'one board', 'glue-up': 'glue-up', strips: 'strips' };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OakRow {
  partNo: string;
  name: string;
  qty: number;
  /** Ids of every physical piece in the row. */
  ids: string[];
  /** Final T x W x L (in). */
  stock: Dims;
  /**
   * Rough T x W x L (in), each ROUNDED UP to 1/8. For a glued-up part (edge-glued panel, face-laminated block) this is the glue-up as it comes off the clamps (`glueUps`), which is then milled to `stock`;
   * the pieces actually cut from boards are in `CutList.cuts`.
   */
  rough: Dims;
  /** `rough` before the 1/8 rounding. */
  roughExact: Dims;
  /** Boards glued edge to edge across the width (1 = one board). */
  edgeBoards: number;
  /** Nominal board the piece is milled from ('4/4' ...), 'resawn' for laminate members (see the strip list), or 'laminated' for a part built up from face-glued layers (see `lamination`). */
  board: string;
  /** Grain as a LOCAL axis ('x' | 'y' | 'z'), as the model gives it. */
  grain?: string;
  /** Grain in words for the bench: 'along L', 'along W' or 'vertical (T)'. For a cross-laminated part this is the FACE layers' grain ("face layers up the leg, center layer across"), never one axis. */
  grainWord?: string;
  /** A cross-laminated block whose W is its tall side (the brake knee): its sizes read "thick x tall x across" (see `isTallBlock`). */
  tall?: boolean;
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
  /** Rough size of one piece (in), each ROUNDED UP to 1/8: thickness the layer is planed to x width (the whole layer, or its share when `edgeGlued` > 1, plus the laminate allowance) x length (plus the laminate allowance). */
  roughT: number;
  widthIn: number;
  lengthIn: number;
  /** The layer's exact planing thickness before rounding (in). */
  roughTExact: number;
  /** The layer's share of the finished thickness (in). */
  finalT: number;
  /** Pieces this layer is edge-glued from when it is wider than a board. 1 = one piece. */
  edgeGlued: number;
  /** Physical pieces in the whole row: row qty x `edgeGlued`. */
  qty: number;
  /** Which way this layer's grain runs, for a cross-laminated part: "across the sled", "upright", "lengthwise (front to back)". */
  grainWord?: string;
}

export interface OakGroup {
  /** Heading for the group: '4/4 (finishes to 3/4"), 20 pieces', 'Face-laminated parts', 'Resawn strips'. */
  title: string;
  board: string;
  nominalIn: number;
  usableIn: number;
  /** Reliable finished thickness of the board (in, Eric 2026-10-13): the thickest FINAL part it is bought for. 0 for the laminated and resawn groups. */
  finishedIn: number;
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
  /**
   * RESAW HEIGHT (in): the height of the cut on the bandsaw. The board is ripped into lanes FIRST, so a lane stands on edge and the saw cuts through its WIDTH: the height is the widest
   * lane (the strip width, rounded up to 1/8), never the width of the board the lanes were ripped from (`boardWidthIn`).
   */
  resawHeightIn: number;
  /** Eric's bandsaw (`bandsawResawCapacityIn`, 6 in). */
  bandsawCapacityIn: number;
  /** `resawHeightIn` is at most the bandsaw capacity. False only when a strip is wider than the saw can cut (the cut list warns). */
  withinCapacity: boolean;
  /** Width of each lane to rip (in), widest first. */
  laneWidthsIn: number[];
  /** Lanes to rip in all: `lanes` plus the whole lanes the spare strips need. The number step 1 of the assembly and the build book both quote. */
  ripLanes: number;
  /** `5 lanes, 3 at 1-7/8" and 2 at 1-3/8" (one is the spare)`: the lane count, their widths and the spare lanes. One text for the steps, the book and the cut list. */
  laneCountText: string;
  /** `resaw height 1-5/8" (your bandsaw: 6")`. */
  resawHeightText: string;
  /** `rip the lanes from a 9"-wide board first`, or `from 2 boards, each 7" wide, first`. */
  ripText: string;
  /** The sentence for the bench: rip, then resaw, with the height against the capacity. */
  text: string;
}

export interface SheetRow {
  partNo: string;
  name: string;
  qty: number;
  ids: string[];
  /** The blank to cut (the model's stock). */
  stock: Dims;
  /** The FINAL size: what the Shaper file cuts. It is the blank except where the file cuts a net length shorter than the blank (the side web: the flat development), where the length is that net. The tables print this. */
  final: Dims;
  grain?: string;
  grainWord?: string;
  fab: string;
  /** Can the XTool S1 laser cut it (D-86)? `text` is "yes" or why not. */
  laser: LaserVerdict;
  /** MODEL step; see `OakRow.step`. */
  step: number;
  assemblySteps: number[];
  /** E.g. "the Shaper file cuts it to 59-1/2"; start from a 59-5/8" blank (+1/8" trim)". */
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
  /** 'Steel rod' | 'DOM tube' | 'Flat bar' | 'Angle' | 'Aluminum tube'. */
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
  /** Data problems found in the model (transposed stock, missing stock) and a resaw that exceeds the bandsaw. */
  warnings: string[];
  /**
   * The ACTUAL CUTS (Eric 2026-10-12): the pieces sawn from boards, not the glued-up parts. An edge-glued panel is N `board` cuts, a face-laminated part is its `layer` cuts, a resawn laminate is its `strip` blanks,
   * everything else is one `solid` cut. Identical pieces of identical parts are one entry with `qty`. Rough sizes are rounded UP to 1/8.
   */
  cuts: Cut[];
  /** The glue-up steps after the cuts: panels edge-glued, blocks face-laminated; each is then milled to its finished size (`finalText`). */
  glueUps: GlueUp[];
  /** The finished parts: what each part is milled to (after any glue-up), to the nearest 1/32 for display, exact in `final`. */
  finished: FinishedPart[];
  /** The CSV tables of `cutlist.csv`, in the order the UI shows them: cuts, resaw pools, glue-ups, finished parts, plywood, metal. All sizes are shop fractions. */
  csv: { cuts: string; resaw: string; glueUps: string; finished: string; sheets: string; metal: string };
}

/** One kind of piece cut from a board (`CutList.cuts`). */
export interface Cut {
  /** First part id of the identical parts this entry covers (`ids` lists all of them). */
  partId: string;
  ids: string[];
  /** Identical parts covered: the number of pieces to cut of this entry. */
  qty: number;
  partNo: string;
  name: string;
  /** "Rear transom, board 1 of 3". */
  label: string;
  piece: 'board' | 'layer' | 'strip' | 'solid';
  /** 1-based position among the part's cuts, and the number of cuts the part has. */
  index: number;
  of: number;
  /** Layer pieces: the layer and the number of layers. */
  layer?: number;
  layers?: number;
  /** Board it is sawn from ('4/4'); for a strip, the board its pool is resawn from. */
  board: string;
  /** Rough T x W x L (in), each rounded UP to 1/8. */
  rough: Dims;
  /** The same before the rounding. */
  roughExact: Dims;
  /** `3/4 \u00d7 5-7/8 \u00d7 25-1/2`. */
  roughText: string;
  /** The glue-up this piece goes into (a `GlueUp.label`), when it has one. */
  glueUp?: string;
  note?: string;
}

/** A glue-up (`CutList.glueUps`): `from` pieces glued into a block that is then milled to the finished size. */
export interface GlueUp {
  partId: string;
  ids: string[];
  qty: number;
  partNo: string;
  /** "Rear transom panel". */
  label: string;
  /** Pieces glued together (boards across x layers). */
  from: number;
  edgeBoards: number;
  layers: number;
  kind: 'edge' | 'face' | 'both';
  /** The glued block before milling (rounded UP to 1/8) and its text. */
  roughBlock: Dims;
  roughBlockText: string;
  /** Finished size the block is milled to, to the nearest 1/32 for display (exact in `final`). */
  final: Dims;
  finalText: string;
  note: string;
}

/** A finished part (`CutList.finished`): the size it is milled to. */
export interface FinishedPart {
  partNo: string;
  name: string;
  qty: number;
  ids: string[];
  /** Exact finished T x W x L (in), and the nearest-1/32 text. */
  final: Dims;
  finalText: string;
  /** Where it comes from: one board ('board'), a glue-up of boards or layers ('glue-up'), or resawn strips ('strips'). */
  from: 'board' | 'glue-up' | 'strips';
  board: string;
  grainWord?: string;
  fab: string;
  assemblySteps: number[];
}

// ── Solid oak ─────────────────────────────────────────────────────────────────

/** A rough thickness rounded UP to 1/8, but never past the board's nominal thickness (`capIn`): a part cannot be sawn thicker than the board it comes from. */
function roughThickness(exact: number, capIn: number | null): number {
  const up = roughUp8(exact);
  if (capIn === null || up <= capIn + 1e-9) return up;
  return Math.min(Math.ceil(exact * 16 - 1e-6) / 16, capIn);
}

/** One piece sawn from a board (a plan entry; `Cut` is the aggregated list entry). */
export interface PlannedPiece {
  piece: 'board' | 'layer' | 'strip' | 'solid';
  /** 1-based among the part's pieces. */
  index: number;
  of: number;
  layer?: number;
  layers?: number;
  /** 1-based board across the width, and the boards across (edge-glued pieces). */
  across?: number;
  acrossOf?: number;
  /** A cross-laminated layer whose grain runs the other way from the part's (D-75): its length is the part's width. */
  turned?: boolean;
  /** Nominal board it is sawn from ('4/4'); 'resawn' for a laminate strip (the pool decides). */
  board: string;
  /** Rough T x W x L, each ROUNDED UP to 1/8 (thickness capped at what the board yields). */
  rough: Dims;
  roughExact: Dims;
}

/** How one oak part is built from boards: the cuts, the glue-up and the rough block (the allowances of Eric 2026-10-12 live here, in `params.ts`). */
export interface OakPartPlan {
  part: Part;
  partNo: string;
  stock: Dims;
  /** Laminate strip (rail ply, sandwich band): bought through the resaw pools. */
  strip: boolean;
  /** 'resawn' | 'laminated' | the nominal board ('4/4' ...). */
  board: string;
  lamination?: Lamination;
  /** Boards glued edge to edge across the width (1 = one board). */
  edgeN: number;
  pieces: PlannedPiece[];
  /** The rough part as it comes off the clamps (or the single piece), rounded UP to 1/8, and unrounded. */
  block: Dims;
  blockExact: Dims;
  warnings: string[];
}

/**
 * Plan the cuts of one oak part (Eric 2026-10-12).
 *   plain solid part  : thickness + `millingAllowanceIn`, width + `roughWidthAllowanceIn`, length + `roughLengthAllowanceIn`;
 *   laminate piece    : the boards of an edge-glued panel, the layers of a face-laminated part (D-70) and the resaw strips get `laminateWidthAllowanceIn` and `laminateLengthAllowanceIn`
 *                       instead, because glued pieces end up slightly askew and are jointed after the glue-up.
 * A part wider than a board (`BOARD_WIDTH_IN`) is edge-glued from the fewest boards whose share of the width plus the allowance fits a board. Every rough size is then rounded UP to 1/8.
 * The board is chosen on the part's FINAL thickness against the board's reliable finished thickness (Eric 2026-10-13: 4/4 gives 3/4", not 27/32"), and so is the lamination: its layers are
 * planed to their boards' reliable finished thicknesses and the glued block loses `laminationCleanupIn`, so the rough thickness never moves a part to a thicker board.
 */
export function planOakPart(x: Part, p: Params, warnings: string[] = []): OakPartPlan {
  const partNo = partKey(x);
  const stock = sanitize(x.stock ?? x.rough ?? { t: 0, w: 0, l: 0 }, warnings, `${partNo} stock`);
  const tExact = stock.t + p.millingAllowanceIn;
  const w: string[] = [];
  // `layerT`: a laminate layer is planed to exactly its thickness (a 1/16 multiple at or under its board's reliable finish): never rounded up to 1/8.
  const mk = (exact: Dims, cap: number | null, layerT = false): { rough: Dims; roughExact: Dims } => ({
    roughExact: exact, rough: { t: layerT ? exact.t : roughThickness(exact.t, cap), w: roughUp8(exact.w), l: roughUp8(exact.l) },
  });
  if (isStripPart(x)) {
    const plies = x.plies ?? 1;
    const { rough, roughExact } = mk({ t: tExact, w: stock.w + p.laminateWidthAllowanceIn, l: stock.l + p.laminateLengthAllowanceIn }, null);
    const pieces: PlannedPiece[] = [...Array(plies)].map((_, i) => ({ piece: 'strip' as const, index: i + 1, of: plies, board: 'resawn', rough, roughExact }));
    return { part: x, partNo, stock, strip: true, board: 'resawn', edgeN: 1, pieces, block: rough, blockExact: roughExact, warnings: w };
  }
  const b = boardForThickness(stock.t, p);
  // No stocked board finishes thick enough (12/4 is not bought, D-70): glue the part up face to face from layers of stocked boards.
  const lamination = b ? undefined : planLamination(stock.t, undefined, p) ?? undefined;
  if (!b && !lamination) w.push(`${partNo}: final thickness ${r3(stock.t)}" is thicker than any stocked board finishes to and no stocked mix of layers makes it`);
  else if (b && b.nominal === '16/4') w.push(`${partNo}: needs 16/4 (3-3/4" usable); if the yard has none, glue up two 8/4`);
  const board = lamination ? 'laminated' : (b ? b.nominal : '16/4');
  const needsGlue = roughUp8(stock.w + p.roughWidthAllowanceIn) > BOARD_WIDTH_IN + 1e-9;
  const across = (min: number): number => Math.max(min, Math.ceil(stock.w / (BOARD_WIDTH_IN - p.laminateWidthAllowanceIn) - 1e-9));
  const edgeN = lamination ? across(1) : needsGlue ? across(2) : 1;
  const layerSpecs: Array<{ board: string; t: number; layer?: number }> = lamination
    ? lamination.layers.map((l, i) => ({ board: l.board, t: l.roughT, layer: i + 1 }))
    : [{ board, t: tExact }];
  // Cross-laminated part (D-75): a layer whose grain differs from the part's grain runs the other way, so its LENGTH is the part's width and its WIDTH (across its grain) the part's length.
  // It is edge-glued only if THAT width exceeds a board (the brake knee's upright layer is 4-1/2" across its grain: one piece from a 6" board).
  const lg = lamination && x.layerGrain && x.layerGrain.length === lamination.layers.length ? x.layerGrain : undefined;
  const turned = (layer?: number): boolean => !!lg && !!layer && lg[layer - 1] !== x.grain;
  const edgeOf = (layer?: number): number => (lg ? Math.max(1, Math.ceil((turned(layer) ? stock.l : stock.w) / (BOARD_WIDTH_IN - p.laminateWidthAllowanceIn) - 1e-9)) : edgeN);
  const glued = edgeN > 1 || !!lamination;
  const pieces: PlannedPiece[] = [];
  const total = layerSpecs.reduce((a, ls) => a + edgeOf(ls.layer), 0);
  for (const ls of layerSpecs) {
    const eN = edgeOf(ls.layer), tn = turned(ls.layer);
    const lenDim = tn ? stock.w : stock.l, widDim = tn ? stock.l : stock.w;
    // The model may place the edge joint off center (the brake knee's, clear of the bolt holes and the shoulder): its notes say how far up from the bottom edge it is.
    const split = lg && !tn && eN === 2 ? edgeJointUp(x, stock.w) : undefined;
    // Plain face laminate of two boards a layer: odd layers put the seam half the offset one way of the middle, even layers the other (capped so the wider board still fits a board).
    const half = lamination && !lg && eN === 2 && ls.layer
      ? (ls.layer % 2 === 1 ? -1 : 1) * Math.max(0, Math.min(LAMINATION_SEAM_OFFSET_IN / 2, BOARD_WIDTH_IN - p.laminateWidthAllowanceIn - widDim / 2))
      : 0;
    for (let a = 0; a < eN; a++) {
      const exact: Dims = glued
        ? { t: ls.t, w: (split !== undefined ? (a === 0 ? split : widDim - split) : widDim / eN + (a === 0 ? half : -half)) + p.laminateWidthAllowanceIn, l: lenDim + p.laminateLengthAllowanceIn }
        : { t: ls.t, w: stock.w + p.roughWidthAllowanceIn, l: stock.l + p.roughLengthAllowanceIn };
      const cap = BOARD_THICKNESSES.find((q) => q.nominal === ls.board)?.nominalIn ?? null;
      const piece: PlannedPiece['piece'] = lamination ? 'layer' : eN > 1 ? 'board' : 'solid';
      pieces.push({
        piece, index: pieces.length + 1, of: total, ...(ls.layer ? { layer: ls.layer, layers: layerSpecs.length } : {}),
        ...(eN > 1 ? { across: a + 1, acrossOf: eN } : {}), ...(tn ? { turned: true } : {}), board: ls.board, ...mk(exact, cap, !!ls.layer),
      });
    }
  }
  // the rough part as glued: the layers' thicknesses add up, the boards' widths add up. A turned layer lies the other way: its width is along the part's length.
  const blockT = lamination ? layerSpecs.reduce((a, ls) => a + pieces.find((q) => q.layer === ls.layer)!.rough.t, 0) : pieces[0].rough.t;
  const blockTExact = lamination ? lamination.roughT : pieces[0].roughExact.t;
  const extentOf = (ls: { layer?: number }, dir: 'w' | 'l'): { r: number; e: number } => {
    const mine = pieces.filter((q) => q.layer === ls.layer);
    const sumW = (k: 'rough' | 'roughExact'): number => mine.reduce((a, q) => a + q[k].w, 0);
    const oneL = (k: 'rough' | 'roughExact'): number => mine[0][k].l;
    const alongW = turned(ls.layer) ? dir === 'l' : dir === 'w';
    return alongW ? { r: sumW('rough'), e: sumW('roughExact') } : { r: oneL('rough'), e: oneL('roughExact') };
  };
  const dimOf = (dir: 'w' | 'l'): { r: number; e: number } => layerSpecs.map((ls) => extentOf(ls, dir)).reduce((a, b) => ({ r: Math.max(a.r, b.r), e: Math.max(a.e, b.e) }));
  const bw = dimOf('w'), bl = dimOf('l');
  const edgeMax = Math.max(...layerSpecs.map((ls) => edgeOf(ls.layer)));
  return {
    part: x, partNo, stock, strip: false, board, ...(lamination ? { lamination } : {}), edgeN: edgeMax, pieces,
    block: { t: blockT, w: bw.r, l: bl.r }, blockExact: { t: blockTExact, w: bw.e, l: bl.e }, warnings: w,
  };
}

const rowKeyDims = (d: Dims): string => `${d.t.toFixed(3)}x${d.w.toFixed(3)}x${d.l.toFixed(3)}`;

function oakRows(plans: OakPartPlan[], stepOf?: ReadonlyMap<string, number>): OakRow[] {
  const map = new Map<string, OakRow>();
  const planOf = new Map<string, OakPartPlan>();
  const names = nameByIdentity(plans);
  for (const pl of plans) {
    const x = pl.part;
    const key = `${pl.partNo}|${rowKeyDims(pl.block)}|${pl.board}`;
    const row = map.get(key);
    if (row) { row.qty += 1; row.ids.push(x.id); row.step = Math.min(row.step, x.step); row.assemblySteps = stepsOf(row.ids, stepOf); continue; }
    const gw = grainInWords(x);
    map.set(key, {
      partNo: pl.partNo, name: names.get(identityOf(pl)) ?? x.name, qty: 1, ids: [x.id], stock: pl.stock, rough: pl.block, roughExact: pl.blockExact, edgeBoards: pl.edgeN, board: pl.board, grain: x.grain,
      ...(isTallBlock(x, pl.stock) ? { tall: true } : {}),
      ...(gw ? { grainWord: gw } : {}), fab: x.fab, step: x.step, assemblySteps: stepsOf([x.id], stepOf),
      ...(x.plies !== undefined ? { plies: x.plies } : {}), ...(pl.lamination ? { lamination: pl.lamination, note: laminationNote(pl.lamination, pl.pieces) } : {}),
      layerPieces: [], warnings: pl.warnings,
    });
    planOf.set(key, pl);
  }
  for (const [key, r] of map) if (r.lamination) r.layerPieces = layerPiecesOf(planOf.get(key)!, r.qty);
  return [...map.values()];
}

/** The note a laminated row carries into the cut list, the CSV and the build book (each layer is planed to its board's reliable finished thickness, on the 1/16 grid). */
export function laminationNote(l: Lamination, pieces?: PlannedPiece[]): string {
  // "3 layers of 4/4, each planed to 3/4": grouped by board and planed thickness, in the order the work happens.
  const groups: Array<{ board: string; n: number; t: number }> = [];
  l.layers.forEach((q, i) => {
    const rt = pieces?.find((pc) => pc.layer === i + 1)?.rough.t ?? roughUp8(q.roughT);
    const g = groups.find((x) => x.board === q.board && Math.abs(x.t - rt) < 1e-9);
    if (g) g.n += 1; else groups.push({ board: q.board, n: 1, t: rt });
  });
  const planed = groups.map((g) => `${g.n} layer${g.n === 1 ? '' : 's'} of ${g.board}, ${g.n === 1 ? '' : 'each '}planed to ${fractionText(g.t, 16)}"`).join('; ');
  return `face-laminated: ${planed}; epoxy the layers face to face, joint and plane the glued block flat and square (${fractionText(l.cleanupIn, 16)}" cleanup allowance), then mill it to ${finalFrac(l.finalT)} thick.`;
}

/** Where the model puts the edge joint of a cross-laminated layer, in inches from the bottom edge ("the joint along its grain 3.47" up from the bottom"); undefined if it says nothing or the number is not inside the width. */
export function edgeJointUp(x: Part, width: number): number | undefined {
  const m = /joint along its grain (\d+(?:\.\d+)?)"\s+up from the bottom/.exec(x.notes ?? '');
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > 0.5 && v < width - 0.5 ? v : undefined;
}

/**
 * The grain direction of one layer of a cross-laminated part (`Part.layerGrain`, local axis), in the sled's own words: "across the sled", "upright" or "lengthwise" (front to back),
 * read off the part's placement so it means something at the bench. Undefined when the model does not say.
 */
export function layerGrainWord(x: Part, layer: number): string | undefined {
  const ax = x.layerGrain?.[layer - 1];
  if (!ax) return undefined;
  const k = ax === 'x' ? 0 : ax === 'y' ? 1 : 2, m = x.transform;
  const d = [m[4 * k], m[4 * k + 1], m[4 * k + 2]].map(Math.abs);
  const w = d.indexOf(Math.max(...d));
  return w === 0 ? 'lengthwise (front to back)' : w === 1 ? 'across the sled' : 'upright';
}

/** Layer pieces of a laminated part: each layer is the rough width x length, edge-glued from several pieces only when ITS width across its grain is wider than a board. `qty` is the number of parts. */
export function layerPiecesOf(plan: OakPartPlan, qty = 1): LayerPiece[] {
  const l = plan.lamination!;
  return l.layers.map((q, i) => {
    const mine = plan.pieces.filter((c) => c.layer === i + 1);
    const pc = mine.reduce((a, c) => (c.rough.w > a.rough.w ? c : a)), eN = mine.length; // the widest piece when the joint is off center
    const gw = layerGrainWord(plan.part, i + 1);
    return { layer: i + 1, layers: l.layers.length, board: q.board, roughT: pc.rough.t, roughTExact: q.roughT, widthIn: pc.rough.w, lengthIn: pc.rough.l, finalT: q.finalT, edgeGlued: eN, qty: qty * eN, ...(gw ? { grainWord: gw } : {}) };
  });
}

// ── Resaw ─────────────────────────────────────────────────────────────────────

/**
 * Thickness (in) of a ROUGH board that a resaw can use: the nominal thickness less one jointed face (`millingAllowanceIn`), and never more than the board's reliable finished thickness
 * plus that same planing allowance (Eric 2026-10-13: the board is not as thick as its name, so the slabs cannot count on the full nominal). A resawn strip is cut from the rough board
 * BEFORE any planing; its rough thickness already includes its own planing allowance (the strip's final thickness + `millingAllowanceIn`, rounded up to 1/8), so every slab has its
 * planing allowance inside it. With the default yields the two figures agree (4/4 7/8", 5/4 1-1/8", 6/4 1-3/8", 8/4 1-7/8", 12/4 2-7/8").
 */
export const resawUsableIn = (b: BoardThickness, p: Params): number => Math.min(b.nominalIn - p.millingAllowanceIn, boardFinishedIn(b, p) + p.millingAllowanceIn);

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
export function packLanes(lanes: StripItem[][], boards: number, kerfIn: number, widthIn: number): StripItem[][][] | null {
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

/**
 * The lanes to rip for a pool, in words (the single source of the lane count). The spare strips are whole extra lanes of the widest strip (plus any empty slot in a full-width lane),
 * so the lanes to rip are the planned lanes plus the spare lanes: `5 lanes, 3 at 1-7/8" and 2 at 1-3/8" (one is the spare)`.
 */
export function laneCount(laneStrips: StripItem[][], k: number, spares: number): { total: number; spareLanes: number; text: string } {
  const kk = Math.max(1, k);
  const widest = Math.max(...laneStrips.flat().map((q) => q.widthIn));
  const emptySlots = laneStrips.reduce((a, l) => a + (laneWidth(l) >= widest - 1e-9 ? kk - l.length : 0), 0);
  const spareLanes = Math.ceil(Math.max(0, spares - emptySlots) / kk);
  const by = new Map<string, number>();
  for (const lane of laneStrips) { const w = roughFrac(laneWidth(lane)); by.set(w, (by.get(w) ?? 0) + 1); }
  if (spareLanes) by.set(roughFrac(widest), (by.get(roughFrac(widest)) ?? 0) + spareLanes);
  const total = laneStrips.length + spareLanes;
  const widths = [...by.entries()].map(([w, n]) => `${n} at ${w}`).join(' and ');
  const spareText = spareLanes ? ` (${spareLanes === 1 ? 'one is the spare' : `${spareLanes} are spares`})` : '';
  return { total, spareLanes, text: `${total} lane${total === 1 ? '' : 's'}, ${widths}${spareText}` };
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
export function planResaw(parts: Part[], p: Params, plans?: OakPartPlan[]): ResawPool[] {
  const stripPlans = plans ? plans.filter((q) => q.strip) : parts.filter((q) => isBuilt(q) && isStripPart(q)).map((q) => planOakPart(q, p));
  const byT = new Map<number, StripItem[]>();
  for (const pl of stripPlans) {
    const rough = pl.pieces[0].rough;
    const t = r3(rough.t);
    const arr = byT.get(t) ?? [];
    for (let i = 0; i < pl.pieces.length; i++) arr.push({ partNo: pl.partNo, id: pl.part.id, widthIn: rough.w, lengthIn: rough.l });
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
    const resawHeightIn = Math.max(...c.lanes.map(laneWidth));
    const cap = p.bandsawResawCapacityIn;
    const withinCapacity = resawHeightIn <= cap + 1e-9;
    const resawHeightText = `resaw height ${roughFrac(resawHeightIn)} (your bandsaw: ${fractionText(cap, 8)}")`;
    const ripText = c.boards > 1 ? `rip the lanes from ${c.boards} boards, each ${fractionText(c.widthIn, 8)}" wide, first` : `rip the lanes from a ${fractionText(c.widthIn, 8)}"-wide board first`;
    const spares = c.slots - items.length;
    const lc = laneCount(c.lanes, c.k, spares);
    pools.push({
      roughT, strips: items.length, board: c.b.nominal, boardLengthIn, boardWidthIn: c.widthIn, yieldByBoard, stripsPerBoard: c.k,
      lanes: c.lanes.length, boards: c.boards, boardFeet: c.bf, laneStrips: c.lanes,
      stripSlots: c.slots, spares, yieldPerBoard: Math.floor(c.slots / c.boards),
      resawHeightIn, bandsawCapacityIn: cap, withinCapacity, laneWidthsIn: c.lanes.map(laneWidth), ripLanes: lc.total, laneCountText: lc.text, resawHeightText, ripText,
      text: `${ripText[0].toUpperCase()}${ripText.slice(1)}, then resaw each lane into ${c.k} slab${c.k === 1 ? '' : 's'} on edge (${resawHeightText})${withinCapacity ? '' : `: TOO TALL for your bandsaw, the strip is wider than its ${fractionText(cap, 8)}" capacity`}.`,
    });
  }
  return pools;
}

function stripRows(plans: OakPartPlan[], pools: ResawPool[]): StripRow[] {
  const map = new Map<string, StripRow>();
  const names = nameByIdentity(plans);
  for (const pl of plans.filter((q) => q.strip)) {
    const x = pl.part;
    const rough = pl.pieces[0].rough;
    const plies = pl.pieces.length;
    const key = `${pl.partNo}|${rowKeyDims(rough)}`;
    const row = map.get(key);
    if (row) { row.parts += 1; row.strips += plies; row.ids.push(x.id); continue; }
    const pool = pools.find((q) => Math.abs(q.roughT - r3(rough.t)) < 1e-6);
    map.set(key, { partNo: pl.partNo, name: names.get(identityOf(pl)) ?? x.name, parts: 1, plies, strips: plies, ids: [x.id], stock: pl.stock, rough, resawFrom: pool?.board ?? '?' });
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
 * A sheet whose Shaper file cuts a NET length shorter than the blank (the side web: the file is the flat development, the blank carries the trim): say both numbers on the row, as fractions.
 * Null when the file and the blank agree (within 0.02 in).
 */
function shaperNetNote(x: Part, stock: Dims): { net: number; note: string } | null {
  const f = flatPattern(x);
  if (!f) return null;
  const net = Math.max(f.widthIn, f.heightIn);
  if (stock.l - net < 0.02) return null;
  return { net, note: `the Shaper file cuts it to ${finalFrac(net)}; start from a ${roughFrac(stock.l)} blank (+${roughFrac(stock.l - net)} trim)` };
}

/** Can the XTool S1 laser cut this sheet part (D-86)? Judged on its flat pattern: thickness, material and the short side against the bed. */
function laserOf(x: Part): LaserVerdict {
  const f = flatPattern(x);
  return f ? laserVerdict({ thicknessIn: f.thicknessIn, material: x.material, widthIn: f.widthIn, heightIn: f.heightIn }) : { ok: false, text: 'no: not a flat part' };
}

function sheetGroups(parts: Part[], warnings: string[], stepOf?: ReadonlyMap<string, number>): SheetGroup[] {
  const groups = new Map<number, SheetGroup>();
  const members = new Map<SheetRow, string[]>();
  for (const x of parts.filter((q) => isBuilt(q) && q.kind === 'sheet')) {
    const stock = sanitize(x.stock ?? { t: 0, w: 0, l: 0 }, warnings, `${partKey(x)} stock`);
    const c = sheetClass(stock.t);
    const g = groups.get(c.mm) ?? { label: c.label, thicknessMm: c.mm, thicknessIn: stock.t, rows: [], pieces: 0 };
    groups.set(c.mm, g);
    g.pieces += 1;
    const key = `${partKey(x)}|${dimKey(stock)}`;
    const row = g.rows.find((r) => `${r.partNo}|${dimKey(r.stock)}` === key);
    if (row) { row.qty += 1; row.ids.push(x.id); row.step = Math.min(row.step, x.step); row.assemblySteps = stepsOf(row.ids, stepOf); members.get(row)!.push(x.name); }
    else {
      const gw = grainInWords(x);
      const net = shaperNetNote(x, stock);
      const note = net?.note;
      const nr: SheetRow = { partNo: partKey(x), name: x.name, qty: 1, ids: [x.id], stock, final: net ? { ...stock, l: net.net } : stock, grain: x.grain, ...(gw ? { grainWord: gw } : {}), fab: x.fab, laser: laserOf(x), step: x.step, assemblySteps: stepsOf([x.id], stepOf), ...(note ? { note } : {}) };
      members.set(nr, [x.name]);
      g.rows.push(nr);
    }
  }
  for (const [r, names] of members) r.name = groupedName(names);
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
  if (/steel rod/.test(m) && !/stainless/.test(m)) return 'Steel rod';
  if (/steel/.test(m) && !/stainless/.test(m)) return 'DOM tube';
  return null;
}

function metalSection(x: Part, family: string, d: Dims): string {
  const v = x.sourcing?.vendor ?? '';
  const grade = /316/.test(x.material) ? '316 stainless' : '18-8 (304) stainless'; // the model's own words for the weather spec (build-utils `stainless`)
  const wall = (): number | undefined => { const m = /(\d*\.\d+)"\s*wall/.exec(v); return m ? Number(m[1]) : x.geometry.type === 'cylinder' ? x.geometry.wall : undefined; };
  switch (family) {
    case 'Steel rod': return `${fracIn(d.t)}" solid 1045 / CDS steel rod (cut to length)`;
    case 'DOM tube': return `${fracIn(d.t)}" OD x ${(wall() ?? 0.12).toFixed(3)}" wall DOM tube (ASTM A513 Type 5)`;
    case 'Aluminum tube': return fractionizeInches(`6061-T6 ${fracIn(d.t)}" x ${fracIn(d.w)}" x ${(wall() ?? 0.125).toFixed(3)}" wall rectangular tube`); // a shop fraction, 1/8", not 0.130"
    case 'Angle': return `${grade} angle ${fracIn(d.w)}" x ${fracIn(d.w)}" x ${fracIn(d.t)}"`;
    default: return `${grade} flat bar ${fracIn(d.t)}" x ${fracIn(d.w)}"`;
  }
}

function metalRows(parts: Part[], warnings: string[], stepOf?: ReadonlyMap<string, number>): MetalRow[] {
  const map = new Map<string, MetalRow>();
  const members = new Map<MetalRow, string[]>();
  for (const x of parts.filter((q) => isBuilt(q) && q.kind === 'metal')) {
    const family = metalFamily(x);
    if (!family) { warnings.push(`${partKey(x)}: unrecognized metal material '${x.material}'`); continue; }
    const w: string[] = [];
    const d = metalDims(x, w);
    warnings.push(...w);
    const section = metalSection(x, family, d);
    const key = `${partKey(x)}|${dimKey(d)}`;
    const row = map.get(key);
    if (row) { row.qty += 1; row.ids.push(x.id); row.step = Math.min(row.step, x.step); row.assemblySteps = stepsOf(row.ids, stepOf); members.get(row)!.push(x.name); continue; }
    const nr: MetalRow = { partNo: partKey(x), name: x.name, qty: 1, ids: [x.id], family, section, material: x.material, cutLengthIn: d.l, stock: d, fab: x.fab, step: x.step, assemblySteps: stepsOf([x.id], stepOf), warnings: w };
    members.set(nr, [x.name]);
    map.set(key, nr);
  }
  for (const [r, names] of members) r.name = groupedName(names);
  return [...map.values()].sort((a, b) => a.family.localeCompare(b.family) || b.cutLengthIn - a.cutLengthIn);
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * @param stepOf part id -> ASSEMBLY step number (`stepMapOf(assemblySteps(...))`). Optional: `assembly.ts` imports this module, so the join is done by the caller (`BuildData`).
 */
export function cutList(parts: Part[], p: Params, stepOf?: ReadonlyMap<string, number>): CutList {
  const warnings: string[] = [];
  const plans = parts.filter((q) => isBuilt(q) && isOak(q)).map((q) => planOakPart(q, p, warnings));
  const pools = planResaw(parts, p, plans);
  const rows = oakRows(plans, stepOf);
  const groupMap = new Map<string, OakGroup>();
  for (const r of rows) {
    const b = r.board === 'resawn' || r.board === 'laminated' ? null : boardByNominal(r.board);
    const g = groupMap.get(r.board) ?? { title: '', board: r.board, nominalIn: b?.nominalIn ?? 0, usableIn: b?.usableIn ?? 0, finishedIn: b ? boardFinishedIn(b, p) : 0, rows: [], pieces: 0 };
    groupMap.set(r.board, g);
    g.rows.push(r);
    g.pieces += r.qty;
  }
  const order = (g: OakGroup): number => (g.board === 'resawn' ? 1000 : g.board === 'laminated' ? 500 : g.nominalIn);
  const oak = [...groupMap.values()].sort((a, b) => order(a) - order(b));
  for (const g of oak) {
    g.rows.sort((a, b) => b.rough.l - a.rough.l);
    g.title = g.board === 'resawn' ? `Resawn strips (${g.pieces} pieces: see the resaw plan)`
      : g.board === 'laminated' ? `Face-laminated parts (${g.pieces} pieces: glued up from stocked boards)`
        : `${g.board} (finishes to ${fracIn(g.finishedIn)}"), ${g.pieces} pieces`;
  }
  const layers = oak.flatMap((g) => g.rows.flatMap((r) => r.layerPieces.map((q) => ({ row: r, ...q }))));
  const strips = stripRows(plans, pools);
  const sheets = sheetGroups(parts, warnings, stepOf);
  const metal = metalRows(parts, warnings, stepOf);
  for (const r of rows) warnings.push(...r.warnings);
  for (const pool of pools) {
    if (!pool.withinCapacity) warnings.push(`Resaw: the ${roughFrac(pool.roughT)}-thick strips are ${roughFrac(pool.resawHeightIn)} wide, which is taller than your bandsaw can resaw (${fractionText(pool.bandsawCapacityIn, 8)}" capacity): a thinner or narrower strip, a planer sled on thicker boards, or a different build is needed`);
  }
  const cuts = cutsOf(plans, pools, p);
  const glueUps = glueUpsOf(plans);
  const finished = finishedOf(oak);

  // The CSV mirrors the UI cut list: cuts, resaw, glue-ups, finished parts, plywood, metal. Sizes are shop fractions and the columns hold names, never part keys.
  const csv = {
    cuts: toCsv([
      ['Board', 'Cut', 'Qty', 'Rough T x W x L (in)', 'Piece', 'Glued into', 'Note'],
      ...cuts.map((c) => [c.board, c.label, c.qty, c.roughText, pieceText(c), c.glueUp, c.note]),
    ]),
    resaw: toCsv([
      ['Rough strip thickness (in)', 'Strips needed', 'Buy', 'Rip first', 'Then resaw', 'Spare strips', 'Board feet'],
      ...pools.map((r) => [
        fractionText(roughUp8(r.roughT), 8), r.strips, `${r.boards} x ${r.board}, ${fractionText(r.boardWidthIn, 8)} in wide x ${r.boardLengthIn / 12} ft`,
        `${r.ripText[0].toUpperCase()}${r.ripText.slice(1)}: ${r.laneCountText}`, `each lane into ${r.stripsPerBoard} slab${r.stripsPerBoard === 1 ? '' : 's'} on edge (${r.resawHeightText})`, r.spares, +r.boardFeet.toFixed(1),
      ]),
    ]),
    glueUps: toCsv([
      ['Glue-up', 'Qty', 'From pieces', 'Rough T x W x L (in)', 'Then mill to T x W x L (in)', 'Note'],
      ...glueUps.map((g) => [g.label, g.qty, g.from, g.roughBlockText, g.finalText, g.note]),
    ]),
    finished: toCsv([
      ['Part', 'Qty', 'Final T x W x L (in)', 'From', 'Board', 'Grain', 'Fabrication', 'Assembly step'],
      ...finished.map((f) => [f.name, f.qty, f.finalText, FROM_TEXT[f.from], f.board, f.grainWord, fabText(f.fab), stepText(f.assemblySteps)]),
    ]),
    sheets: toCsv([
      ['Sheet', 'Part', 'Qty', 'Final T x W x L (in)', 'Grain', 'Fabrication', 'Laser', 'Assembly step', 'Note'],
      ...sheets.flatMap((g) => g.rows.map((r) => [g.label, r.name, r.qty, finalDimsText(r.final), r.grainWord, fabText(r.fab), r.laser.text, stepText(r.assemblySteps), r.note])),
    ]),
    metal: toCsv([
      ['Stock', 'Part', 'Qty', 'Cut length (in)', 'Fabrication', 'Assembly step'],
      ...metal.map((r) => [r.section, r.name, r.qty, fractionText(nearest32(r.cutLengthIn), 32), fabText(r.fab), stepText(r.assemblySteps)]),
    ]),
  };
  return { oak, layers, strips, resaw: pools, sheets, metal, warnings: [...new Set(warnings)], cuts, glueUps, finished, csv };
}

// ── Actual cuts, glue-ups and finished parts ──────────────────────────────────

/** A part name without its material parenthetical ("Brake knee backer L (white oak)" -> "Brake knee backer L"). */
const stripName = (name: string): string => name.replace(/\s*\((?:oak|white oak|(?:18-8 )?\d+ stainless)[^)]*\)\s*$/i, '').trim();
const cap1 = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * One name for a row of identical parts (a cut-list row, a BOM cut line): what its members share, without one instance's side or number. "Side box rib, left" + "Side box rib, right" -> "Side box rib";
 * "Sign backing strip L1" ... "R2" -> "Sign backing strip"; "rear left axle clamp plate" + "Front right axle clamp plate 1" -> "Axle clamp plate" (the words the names end with in common).
 * Members that carry a plain number keep them, so a reviewer can find them in the drawings: "Crossmember 2", "Crossmember 3", "Crossmember 4" -> "Crossmembers 2, 3, 4". With `keepPosition` an
 * "L2" / "R2" keeps its digit ("Rib knee 2"): the caller asks for it when two different rows would otherwise get the same name.
 */
export function groupedName(names: readonly string[], keepPosition = false): string {
  const uniq = [...new Set(names.map(stripName))];
  if (uniq.length === 1) return cap1(uniq[0]);
  const norm = (n: string): { base: string; num?: number } => {
    let b = n.replace(/^(?:left|right)\s+/i, '').replace(/,\s*(?:left|right)\b/gi, '').replace(/\s+(?:left|right)\b/gi, '');
    const pos = /\s+[LR](\d*)(?=\s*(?:\(|,|$))/.exec(b);
    if (pos) b = b.replace(pos[0], keepPosition && pos[1] ? ` ${pos[1]}` : '');
    const m = /\s+(\d+)$/.exec(b);
    return m ? { base: b.slice(0, m.index).trim(), num: Number(m[1]) } : { base: b.trim() };
  };
  const parts = uniq.map(norm);
  const lc = parts.map((q) => q.base.toLowerCase());
  if (lc.every((b) => b === lc[0])) {
    const base = cap1(parts[0].base);
    if (parts.some((q) => q.num === undefined)) return base;
    const nums = [...new Set(parts.map((q) => q.num as number))].sort((x, y) => x - y);
    return `${nums.length > 1 && !/s$/i.test(base) ? `${base}s` : base} ${nums.join(', ')}`;
  }
  // bases that differ only by a position word ("Storage coaming aft end" / "fore end", "rear" / "Front axle clamp plate"): drop it
  const noPos = (b: string): string => b.replace(/\s*\((?:fore|aft|front|rear|top|bottom|upper|lower)\)/gi, '').replace(/\b(?:fore|aft|front|rear|top|bottom|upper|lower)\b/gi, '').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
  const stripped = parts.map((q) => noPos(q.base));
  if (stripped[0] && stripped.every((b) => b.toLowerCase() === stripped[0].toLowerCase())) return cap1(stripped[0]);
  // different bases: the words they end with in common ("rear axle clamp plate" / "Front axle clamp plate" -> "axle clamp plate")
  const words = lc.map((b) => b.split(/\s+/));
  const common: string[] = [];
  for (let i = 1; i <= Math.min(...words.map((w) => w.length)); i++) {
    const w = words[0][words[0].length - i];
    if (words.every((q) => q[q.length - i] === w)) common.unshift(w); else break;
  }
  if (common.length >= 2 || (common.length === 1 && words.every((q) => q.length <= 2))) return cap1(common.join(' '));
  const lead: string[] = [];
  for (let i = 0; i < Math.min(...words.map((w) => w.length)) && words.every((q) => q[i] === words[0][i]); i++) lead.push(words[0][i]);
  if (lead.length >= 2) return cap1(lead.join(' ').replace(/,$/, ''));
  return cap1(parts[0].base);
}

/** A row's identity in the oak tables: the part number and the rough block, the same key `oakRows`, the cuts and the glue-ups group on. */
const identityOf = (pl: OakPartPlan): string => `${pl.partNo}|${rowKeyDims(pl.block)}`;

/** One display name per row of identical oak parts (see `groupedName`); two different rows that would share a name keep their position digits ("Rib knee 2" and "Rib knee 3"). */
function nameByIdentity(plans: OakPartPlan[]): Map<string, string> {
  const by = new Map<string, string[]>();
  for (const pl of plans) (by.get(identityOf(pl)) ?? by.set(identityOf(pl), []).get(identityOf(pl))!).push(pl.part.name);
  const out = new Map<string, string>();
  for (const [k, names] of by) out.set(k, groupedName(names));
  const count = new Map<string, number>();
  for (const n of out.values()) count.set(n, (count.get(n) ?? 0) + 1);
  for (const [k, n] of out) if ((count.get(n) ?? 0) > 1) out.set(k, groupedName(by.get(k)!, true));
  return out;
}

/** The name a glue-up and its layer cuts go by: "Seat back stop block" is "Seat back stop" (the glue-up is then "Seat back stop block", the cuts "Seat back stop, layer 1 of 2"), so the kind is never said twice. */
export function glueBaseName(name: string, laminated: boolean): string {
  const kind = laminated ? 'block' : 'panel';
  return name.trim().replace(new RegExp(`\\s+${kind}$`, 'i'), '');
}
/** The label of a glue-up: "Hinge backer block", "Rear transom panel". */
export function glueUpName(name: string, laminated: boolean): string {
  return `${glueBaseName(name, laminated)} ${laminated ? 'block' : 'panel'}`;
}

/** The pieces sawn from boards: identical pieces of identical parts are one entry with a quantity. */
function cutsOf(plans: OakPartPlan[], pools: ResawPool[], p: Params): Cut[] {
  const map = new Map<string, Cut>();
  const names = nameByIdentity(plans);
  for (const pl of plans) {
    const name = names.get(identityOf(pl))!;
    const glued = pl.edgeN > 1 || !!pl.lamination;
    const glueLabel = glued ? glueUpName(name, !!pl.lamination) : undefined;
    const cutName = glued ? glueBaseName(name, !!pl.lamination) : name;
    const unequal = (pc: PlannedPiece): boolean => !!pc.layer && pl.pieces.some((q) => q.layer === pc.layer && Math.abs(q.rough.w - pc.rough.w) > 1e-9);
    const lgw = (pc: PlannedPiece): string | undefined => (pc.layer ? layerGrainWord(pl.part, pc.layer) : undefined);
    const crossLam = !!pl.part.layerGrain;
    for (const pc of pl.pieces) {
      const board = pc.piece === 'strip' ? (pools.find((q) => Math.abs(q.roughT - r3(pc.rough.t)) < 1e-6)?.board ?? '?') : pc.board;
      const label = pc.piece === 'solid' ? name
        : pc.piece === 'strip' ? (pc.of > 1 ? `${name}, strip ${pc.index} of ${pc.of}` : `${name}, strip`)
          : pc.piece === 'board' ? `${cutName}, board ${pc.across} of ${pc.acrossOf}`
            : `${cutName}, layer ${pc.layer} of ${pc.layers}${pc.acrossOf ? `, board ${pc.across} of ${pc.acrossOf}` : ''}${lgw(pc) ? ` (grain ${lgw(pc)})` : ''}`;
      const note = pc.piece === 'board' ? 'joint the glue edges, then glue the boards edge to edge'
        : pc.piece === 'layer' ? `plane to ${fractionText(pc.rough.t, 16)}" before the glue-up${lgw(pc) ? `; grain ${lgw(pc)}` : ''}${pc.acrossOf ? `; edge-glue its boards first${unequal(pc) ? (crossLam ? ' (the two are NOT equal: board 1 is the bottom edge, board 2 the top)' : ` (the two are NOT equal: the seam sits ${fractionText(LAMINATION_SEAM_OFFSET_IN, 8)}" off the seam of the next layer)`) : ''}` : lgw(pc) ? `; one piece, ${fractionText(pc.rough.w, 8)}" wide across its grain` : ''}`
          : pc.piece === 'strip' ? 'rip the lane first, then resaw it on edge; plane to thickness after the resaw' : undefined;
      const key = `${pl.partNo}|${pc.piece}|${pc.index}|${pc.of}|${board}|${rowKeyDims(pc.rough)}`;
      const hit = map.get(key);
      if (hit) { hit.qty += 1; hit.ids.push(pl.part.id); continue; }
      map.set(key, {
        partId: pl.part.id, ids: [pl.part.id], qty: 1, partNo: pl.partNo, name, label, piece: pc.piece, index: pc.index, of: pc.of,
        ...(pc.layer ? { layer: pc.layer, layers: pc.layers } : {}), board, rough: pc.rough, roughExact: pc.roughExact, roughText: roughDimsText(pc.rough),
        ...(glueLabel ? { glueUp: glueLabel } : {}), ...(note ? { note } : {}),
      });
    }
  }
  return sortCuts([...map.values(), ...ribFillerCuts(plans, pools, p)]);
}

const sortCuts = (cuts: Cut[]): Cut[] => {
  const boardOrder = (b: string): number => (b === 'resawn' ? 1000 : BOARD_THICKNESSES.findIndex((q) => q.nominal === b));
  return cuts.sort((a, b) => boardOrder(a.board) - boardOrder(b.board) || b.rough.l - a.rough.l || a.partNo.localeCompare(b.partNo) || a.index - b.index);
};

/** One filler behind a side rib (D-76): a piece of band strip, `widthIn` wide, glued to the web between the inner chine and gunwale bands so the rib's back sits flat. */
export interface RibFiller {
  /** Rib station (1 box rib, 2 mid rib, 3 bow post, 4 rear rib), and its role in words. */
  n: 1 | 2 | 3 | 4;
  role: string;
  /** Fillers of this station (one per side). */
  count: number;
  /** Length of the gap to fill (in, up the web), the width (the rib shaft) and the thickness (the band, `sideBand`). */
  lengthIn: number;
  widthIn: number;
  thickIn: number;
}

/** The side-rib fillers, per station, derived from the layout the way the assembly step is (the gap between the inner chine band's top and the gunwale band's underside, or from the box tie's foot). Empty when the model has no ribs. */
export function ribFillers(parts: ReadonlyArray<Pick<Part, 'id'>>, p: Params): RibFiller[] {
  const ribs = parts.filter((x) => /^side-rib-[LR]\d$/.test(x.id));
  if (!ribs.length) return [];
  const L = computeLayout(p);
  const zChineTop = L.chineBot + L.chineH;
  const roles: Record<number, string> = { 1: 'box rib', 2: 'mid rib', 3: 'bow post', 4: 'rear rib' };
  return sideRibStations(p, L).map((st) => {
    const foot = st.kind === 'box' ? boxTieGeometry(p, L, st).z0 : L.deckTop;
    return {
      n: st.n, role: roles[st.n], count: ribs.filter((x) => x.id.endsWith(String(st.n))).length,
      lengthIn: Math.max(0, sideTopAt(L, st.x) - L.railBand - Math.max(zChineTop, foot)), widthIn: p.sideRibWidthIn, thickIn: L.sideBand,
    };
  }).filter((f) => f.count > 0);
}

/**
 * The rib fillers as rows of the cuts table. They are spare band strips (the strip purchase carries spares): each filler is the band's own plies glued face to face (the band thickness),
 * cut to fit its gap, so a station's row is `count x plies` pieces. Sizes follow the strip allowances; the length is "about" because the filler is fitted to the gap.
 */
function ribFillerCuts(plans: OakPartPlan[], pools: ResawPool[], p: Params): Cut[] {
  const band = plans.find((q) => q.strip && /^side-[LR]-gunwale-in$/.test(q.part.id));
  if (!band) return [];
  const plies = band.pieces.length;
  const pool = pools.find((q) => Math.abs(q.roughT - r3(band.pieces[0].rough.t)) < 1e-6);
  return ribFillers(plans.map((q) => q.part), p).map((f, i): Cut => {
    const roughExact: Dims = { t: band.pieces[0].roughExact.t, w: f.widthIn + p.laminateWidthAllowanceIn, l: f.lengthIn + 1 / 8 }; // cut to fit its gap: a hair over, not the allowance of a bent part
    const rough: Dims = { t: band.pieces[0].rough.t, w: roughUp8(roughExact.w), l: roughUp8(roughExact.l) };
    return {
      partId: `rib-filler-${f.n}`, ids: [], qty: f.count * plies, partNo: 'side-rib-filler', name: `Rib filler, ${f.role}`, label: `Rib filler, ${f.role} (spare band strip)`,
      piece: 'strip', index: i + 1, of: 3, board: pool?.board ?? band.pieces[0].board, rough, roughExact, roughText: roughDimsText(rough),
      note: `a spare band strip, grain up the web${plies > 1 ? `, ${plies} layers glued face to face` : ''}, planed to ${finalFrac(band.stock.t * plies)} thick like the bands; ${f.count} of them, one per side; cut each to fit its gap, about ${fractionText(roughUp8(f.lengthIn), 8)}" long`,
    };
  });
}

/** Each layer of a laminated part as it lies in the block: the width across ITS grain (the boards edge-glued, added up) and its length along its grain. */
function layerExtents(pl: OakPartPlan): Array<{ layer: number; across: number; along: number }> {
  const out: Array<{ layer: number; across: number; along: number }> = [];
  for (const pc of pl.pieces) {
    if (!pc.layer) continue;
    const hit = out.find((q) => q.layer === pc.layer);
    if (hit) hit.across += pc.rough.w; else out.push({ layer: pc.layer, across: pc.rough.w, along: pc.rough.l });
  }
  return out;
}

/** "layers 1 and 3: 9-1/2 wide across its grain \u00d7 6-1/2 long; layer 2: 4-7/8 wide across its grain \u00d7 10-5/8 long": layers of the same size said once. */
function layerSizesText(lyr: Array<{ layer: number; across: number; along: number }>): string {
  const groups: Array<{ ids: number[]; across: number; along: number }> = [];
  for (const q of lyr) {
    const g = groups.find((z) => Math.abs(z.across - q.across) < 1e-9 && Math.abs(z.along - q.along) < 1e-9);
    if (g) g.ids.push(q.layer); else groups.push({ ids: [q.layer], across: q.across, along: q.along });
  }
  return groups.map((g) => `${g.ids.length > 1 ? 'layers' : 'layer'} ${g.ids.join(' and ')}: ${fractionText(roughUp8(g.across), 8)} wide across its grain \u00d7 ${fractionText(roughUp8(g.along), 8)} long`).join('; ');
}

/** The glue-ups that follow the cuts: each panel or laminated block, with the finished size it is milled to. */
function glueUpsOf(plans: OakPartPlan[]): GlueUp[] {
  const map = new Map<string, GlueUp>();
  const names = nameByIdentity(plans);
  for (const pl of plans) {
    if (pl.strip || (pl.edgeN <= 1 && !pl.lamination)) continue;
    const name = names.get(identityOf(pl))!;
    const layers = pl.lamination ? pl.lamination.layers.length : 1;
    const kind: GlueUp['kind'] = pl.lamination ? (pl.edgeN > 1 ? 'both' : 'face') : 'edge';
    const label = glueUpName(name, !!pl.lamination);
    const key = `${pl.partNo}|${rowKeyDims(pl.block)}`;
    const hit = map.get(key);
    if (hit) { hit.qty += 1; hit.ids.push(pl.part.id); continue; }
    const how = kind === 'edge' ? `joint the glue edges and glue the ${pl.edgeN} boards edge to edge`
      : kind === 'face' ? `glue the ${layers} layers face to face`
        : pl.part.layerGrain
          ? `edge-glue the wider layers (${pl.pieces.filter((q) => q.across === 1).map((q) => `layer ${q.layer}: ${q.acrossOf} boards`).join(', ')}), then glue the ${layers} layers face to face`
          : `edge-glue the ${pl.edgeN} boards of each layer, then glue the ${layers} layers face to face`;
    // A cross-laminated block (D-75) is NOT a rectangle: its layers differ in size, so `roughBlock` is the box that holds them all. Say what each layer measures.
    const tall = isTallBlock(pl.part, pl.stock);
    const lyr = pl.lamination ? layerExtents(pl) : [];
    const sizes = new Set(lyr.map((q) => `${q.across}x${q.along}`));
    const shape = sizes.size > 1
      ? `the layers are not the same size (${layerSizesText(lyr)}), so the block is not a rectangle until it is milled; it fits in `
      : 'glued block rough ';
    map.set(key, {
      partId: pl.part.id, ids: [pl.part.id], qty: 1, partNo: pl.partNo, label, from: pl.pieces.length, edgeBoards: pl.edgeN, layers, kind,
      roughBlock: pl.block, roughBlockText: sizeText(pl.block, true, tall), final: pl.stock, finalText: sizeText(pl.stock, false, tall),
      note: `${how}; ${shape}${sizeText(pl.block, true, tall)}${pl.lamination ? `, joint and plane it flat and square (${fractionText(pl.lamination.cleanupIn, 16)}" cleanup)` : ''}, then mill to final ${sizeText(pl.stock, false, tall)}`,
    });
  }
  return [...map.values()];
}

/** The finished-parts table: one row per oak part number and size, in the order of the oak groups. */
function finishedOf(oak: OakGroup[]): FinishedPart[] {
  const out: FinishedPart[] = [];
  for (const g of oak) {
    for (const r of g.rows) {
      const final: Dims = r.plies && r.plies > 1 ? { t: r.stock.t * r.plies, w: r.stock.w, l: r.stock.l } : r.stock;
      const from: FinishedPart['from'] = g.board === 'resawn' ? 'strips' : r.edgeBoards > 1 || r.lamination ? 'glue-up' : 'board';
      out.push({
        partNo: r.partNo, name: r.name, qty: r.qty, ids: r.ids, final, finalText: sizeText(final, false, r.tall), from, board: r.board,
        ...(r.grainWord ? { grainWord: r.grainWord } : {}), fab: r.fab, assemblySteps: r.assemblySteps,
      });
    }
  }
  return out;
}
