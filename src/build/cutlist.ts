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
import { finalDimsText, finalFrac, fractionText, roughDimsText, roughFrac, roughUp8 } from './units';

export { finalFrac, roughFrac, finalDimsText, roughDimsText, roughUp8 };

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
  return groups.map((g) => `${g.n} \u00d7 ${finalFrac(g.finalT)} from ${g.board}`).join(' + ');
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
  /** `resaw height 1-5/8" (your bandsaw: 6")`. */
  resawHeightText: string;
  /** `rip the lanes from a 9"-wide board first`. */
  ripText: string;
  /** The sentence for the bench: rip, then resaw, with the height against the capacity. */
  text: string;
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
  csv: { oak: string; layers: string; strips: string; sheets: string; metal: string; cuts: string; glueUps: string; finished: string };
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

/** A rough thickness rounded UP to 1/8, but never past what the board yields (`usableIn`, on the 1/16 grid): a 1.871 in part from 8/4 is 1-7/8, not 2. */
function roughThickness(exact: number, usableIn: number | null): number {
  const up = roughUp8(exact);
  if (usableIn === null || up <= usableIn + 1e-9) return up;
  return Math.min(Math.ceil(exact * 16 - 1e-6) / 16, usableIn);
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
 * The board and the lamination are chosen on the EXACT rough thickness, so the rounding never moves a part to a thicker board.
 */
export function planOakPart(x: Part, p: Params, warnings: string[] = []): OakPartPlan {
  const partNo = partKey(x);
  const stock = sanitize(x.stock ?? x.rough ?? { t: 0, w: 0, l: 0 }, warnings, `${partNo} stock`);
  const tExact = stock.t + p.millingAllowanceIn;
  const w: string[] = [];
  const mk = (exact: Dims, usable: number | null): { rough: Dims; roughExact: Dims } => ({
    roughExact: exact, rough: { t: roughThickness(exact.t, usable), w: roughUp8(exact.w), l: roughUp8(exact.l) },
  });
  if (isStripPart(x)) {
    const plies = x.plies ?? 1;
    const { rough, roughExact } = mk({ t: tExact, w: stock.w + p.laminateWidthAllowanceIn, l: stock.l + p.laminateLengthAllowanceIn }, null);
    const pieces: PlannedPiece[] = [...Array(plies)].map((_, i) => ({ piece: 'strip' as const, index: i + 1, of: plies, board: 'resawn', rough, roughExact }));
    return { part: x, partNo, stock, strip: true, board: 'resawn', edgeN: 1, pieces, block: rough, blockExact: roughExact, warnings: w };
  }
  const b = boardForThickness(tExact);
  // No stocked board is thick enough (12/4 is not bought, D-70): glue the part up face to face from layers of stocked boards.
  const lamination = b ? undefined : planLamination(stock.t, tExact) ?? undefined;
  if (!b && !lamination) w.push(`${partNo}: rough thickness ${r3(tExact)}" is thicker than any stocked board and no stocked mix of layers makes it`);
  else if (b && b.nominal === '16/4') w.push(`${partNo}: needs 16/4 (3-3/4" usable); if the yard has none, glue up two 8/4`);
  const board = lamination ? 'laminated' : (b ? b.nominal : '16/4');
  const needsGlue = roughUp8(stock.w + p.roughWidthAllowanceIn) > BOARD_WIDTH_IN + 1e-9;
  const across = (min: number): number => Math.max(min, Math.ceil(stock.w / (BOARD_WIDTH_IN - p.laminateWidthAllowanceIn) - 1e-9));
  const edgeN = lamination ? across(1) : needsGlue ? across(2) : 1;
  const glued = edgeN > 1 || !!lamination;
  const layerSpecs: Array<{ board: string; t: number; layer?: number }> = lamination
    ? lamination.layers.map((l, i) => ({ board: l.board, t: l.roughT, layer: i + 1 }))
    : [{ board, t: tExact }];
  const pieces: PlannedPiece[] = [];
  const total = layerSpecs.length * edgeN;
  for (const ls of layerSpecs) {
    for (let a = 0; a < edgeN; a++) {
      const exact: Dims = glued
        ? { t: ls.t, w: stock.w / edgeN + p.laminateWidthAllowanceIn, l: stock.l + p.laminateLengthAllowanceIn }
        : { t: ls.t, w: stock.w + p.roughWidthAllowanceIn, l: stock.l + p.roughLengthAllowanceIn };
      const usable = BOARD_THICKNESSES.find((q) => q.nominal === ls.board)?.usableIn ?? null;
      const piece: PlannedPiece['piece'] = lamination ? 'layer' : edgeN > 1 ? 'board' : 'solid';
      pieces.push({
        piece, index: pieces.length + 1, of: total, ...(ls.layer ? { layer: ls.layer, layers: layerSpecs.length } : {}),
        ...(edgeN > 1 ? { across: a + 1, acrossOf: edgeN } : {}), board: ls.board, ...mk(exact, usable),
      });
    }
  }
  // the rough part as glued: the layers' thicknesses add up, the boards' widths add up
  const first = pieces.filter((q) => q.across === undefined || q.across === 1);
  const blockT = lamination ? first.reduce((a, q) => a + q.rough.t, 0) : pieces[0].rough.t;
  const blockTExact = lamination ? lamination.roughT : pieces[0].roughExact.t;
  const blockW = pieces.slice(0, edgeN).reduce((a, q) => a + q.rough.w, 0), blockWExact = pieces.slice(0, edgeN).reduce((a, q) => a + q.roughExact.w, 0);
  return {
    part: x, partNo, stock, strip: false, board, ...(lamination ? { lamination } : {}), edgeN, pieces,
    block: { t: blockT, w: blockW, l: pieces[0].rough.l }, blockExact: { t: blockTExact, w: blockWExact, l: pieces[0].roughExact.l }, warnings: w,
  };
}

const rowKeyDims = (d: Dims): string => `${d.t.toFixed(3)}x${d.w.toFixed(3)}x${d.l.toFixed(3)}`;

function oakRows(plans: OakPartPlan[], stepOf?: ReadonlyMap<string, number>): OakRow[] {
  const map = new Map<string, OakRow>();
  const planOf = new Map<string, OakPartPlan>();
  for (const pl of plans) {
    const x = pl.part;
    const key = `${pl.partNo}|${rowKeyDims(pl.block)}|${pl.board}`;
    const row = map.get(key);
    if (row) { row.qty += 1; row.ids.push(x.id); row.step = Math.min(row.step, x.step); row.assemblySteps = stepsOf(row.ids, stepOf); continue; }
    const gw = grainInWords(x);
    map.set(key, {
      partNo: pl.partNo, name: x.name, qty: 1, ids: [x.id], stock: pl.stock, rough: pl.block, roughExact: pl.blockExact, edgeBoards: pl.edgeN, board: pl.board, grain: x.grain,
      ...(gw ? { grainWord: gw } : {}), fab: x.fab, step: x.step, assemblySteps: stepsOf([x.id], stepOf),
      ...(x.plies !== undefined ? { plies: x.plies } : {}), ...(pl.lamination ? { lamination: pl.lamination, note: laminationNote(pl.lamination, pl.pieces) } : {}),
      layerPieces: [], warnings: pl.warnings,
    });
    planOf.set(key, pl);
  }
  for (const [key, r] of map) if (r.lamination) r.layerPieces = layerPiecesOf(planOf.get(key)!, r.qty);
  return [...map.values()];
}

/** The note a laminated row carries into the cut list, the CSV and the build book (layers planed to the ROUNDED thickness, 7/8, not the exact 25/32). */
export function laminationNote(l: Lamination, pieces?: PlannedPiece[]): string {
  // "3 layers of 4/4, each planed to 7/8": grouped by board and planed thickness, in the order the work happens.
  const groups: Array<{ board: string; n: number; t: number }> = [];
  l.layers.forEach((q, i) => {
    const rt = pieces?.find((pc) => pc.layer === i + 1)?.rough.t ?? roughUp8(q.roughT);
    const g = groups.find((x) => x.board === q.board && Math.abs(x.t - rt) < 1e-9);
    if (g) g.n += 1; else groups.push({ board: q.board, n: 1, t: rt });
  });
  const planed = groups.map((g) => `${g.n} layer${g.n === 1 ? '' : 's'} of ${g.board}, ${g.n === 1 ? '' : 'each '}planed to ${fractionText(g.t, 16)}"`).join('; ');
  return `face-laminated (D-70): ${planed}; epoxy the layers face to face, then mill the block to ${finalFrac(l.finalT)} thick (the planing allowance comes off once, on the glued block).`;
}

/** Layer pieces of a laminated part: each layer is the rough width x length, edge-glued from several pieces when wider than a board. `qty` is the number of parts. */
export function layerPiecesOf(plan: OakPartPlan, qty = 1): LayerPiece[] {
  const l = plan.lamination!;
  return l.layers.map((q, i) => {
    const pc = plan.pieces.find((c) => c.layer === i + 1)!;
    return { layer: i + 1, layers: l.layers.length, board: q.board, roughT: pc.rough.t, roughTExact: q.roughT, widthIn: pc.rough.w, lengthIn: pc.rough.l, finalT: q.finalT, edgeGlued: plan.edgeN, qty: qty * plan.edgeN };
  });
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
    const ripText = `rip the lanes from a ${fractionText(c.widthIn, 8)}"-wide board first`;
    pools.push({
      roughT, strips: items.length, board: c.b.nominal, boardLengthIn, boardWidthIn: c.widthIn, yieldByBoard, stripsPerBoard: c.k,
      lanes: c.lanes.length, boards: c.boards, boardFeet: c.bf, laneStrips: c.lanes,
      stripSlots: c.slots, spares: c.slots - items.length, yieldPerBoard: Math.floor(c.slots / c.boards),
      resawHeightIn, bandsawCapacityIn: cap, withinCapacity, laneWidthsIn: c.lanes.map(laneWidth), resawHeightText, ripText,
      text: `${ripText[0].toUpperCase()}${ripText.slice(1)}, then resaw each lane into ${c.k} slab${c.k === 1 ? '' : 's'} on edge (${resawHeightText})${withinCapacity ? '' : `: TOO TALL for your bandsaw, the strip is wider than its ${fractionText(cap, 8)}" capacity`}.`,
    });
  }
  return pools;
}

function stripRows(plans: OakPartPlan[], pools: ResawPool[]): StripRow[] {
  const map = new Map<string, StripRow>();
  for (const pl of plans.filter((q) => q.strip)) {
    const x = pl.part;
    const rough = pl.pieces[0].rough;
    const plies = pl.pieces.length;
    const key = `${pl.partNo}|${rowKeyDims(rough)}`;
    const row = map.get(key);
    if (row) { row.parts += 1; row.strips += plies; row.ids.push(x.id); continue; }
    const pool = pools.find((q) => Math.abs(q.roughT - r3(rough.t)) < 1e-6);
    map.set(key, { partNo: pl.partNo, name: x.name, parts: 1, plies, strips: plies, ids: [x.id], stock: pl.stock, rough, resawFrom: pool?.board ?? '?' });
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
  if (/steel rod/.test(m) && !/stainless/.test(m)) return 'Steel rod';
  if (/steel/.test(m) && !/stainless/.test(m)) return 'DOM tube';
  return null;
}

function metalSection(x: Part, family: string, d: Dims): string {
  const v = x.sourcing?.vendor ?? '';
  const wall = (): number | undefined => { const m = /(\d*\.\d+)"\s*wall/.exec(v); return m ? Number(m[1]) : x.geometry.type === 'cylinder' ? x.geometry.wall : undefined; };
  switch (family) {
    case 'Steel rod': return `${fracIn(d.t)}" solid 1045 / CDS steel rod (cut to length)`;
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
  const plans = parts.filter((q) => isBuilt(q) && isOak(q)).map((q) => planOakPart(q, p, warnings));
  const pools = planResaw(parts, p, plans);
  const rows = oakRows(plans, stepOf);
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
  const strips = stripRows(plans, pools);
  const sheets = sheetGroups(parts, warnings, stepOf);
  const metal = metalRows(parts, warnings, stepOf);
  for (const r of rows) warnings.push(...r.warnings);
  for (const pool of pools) {
    if (!pool.withinCapacity) warnings.push(`Resaw: the ${roughFrac(pool.roughT)}-thick strips are ${roughFrac(pool.resawHeightIn)} wide, which is taller than your bandsaw can resaw (${fractionText(pool.bandsawCapacityIn, 8)}" capacity): a thinner or narrower strip, a planer sled on thicker boards, or a different build is needed`);
  }
  const cuts = cutsOf(plans, pools);
  const glueUps = glueUpsOf(plans);
  const finished = finishedOf(oak);

  const d = (x: Dims): string => `${r3(x.t)} x ${r3(x.w)} x ${r3(x.l)}`;
  const csv = {
    oak: toCsv([
      ['Board', 'Part no', 'Name', 'Qty', 'Final T x W x L (in)', 'Rough T x W x L (in)', 'Grain', 'Fab', 'Assembly step', 'Plies', 'Lamination'],
      ...oak.flatMap((g) => g.rows.map((r) => [g.board, r.partNo, r.name, r.qty, finalDimsText(r.stock), roughDimsText(r.rough), r.grainWord, r.fab, stepText(r.assemblySteps), r.plies, r.lamination ? `face-laminated: ${r.lamination.text}` : undefined])),
    ]),
    layers: toCsv([
      ['Part no', 'Name', 'Layer', 'Of', 'Board', 'Pieces', 'Rough layer T x W x L (in)', 'Layer share of final T (in)', 'Edge-glued from', 'Glued block rough T (in)', 'Final T (in)', 'Lamination'],
      ...layers.map((q) => [q.row.partNo, q.row.name, q.layer, q.layers, q.board, q.qty, roughDimsText({ t: q.roughT, w: q.widthIn, l: q.lengthIn }), finalFrac(q.finalT), q.edgeGlued, fractionText(roughUp8(q.row.rough.t), 8), finalFrac(q.row.lamination!.finalT), q.row.lamination!.text]),
    ]),
    strips: toCsv([
      ['Part no', 'Name', 'Parts', 'Plies', 'Strips', 'Final strip T x W x L (in)', 'Rough strip T x W x L (in)', 'Resaw from'],
      ...strips.map((r) => [r.partNo, r.name, r.parts, r.plies, r.strips, finalDimsText(r.stock), roughDimsText(r.rough), r.resawFrom]),
    ]),
    sheets: toCsv([
      ['Sheet', 'Part no', 'Name', 'Qty', 'Final T x W x L (in)', 'Grain', 'Fab', 'Assembly step', 'Note'],
      ...sheets.flatMap((g) => g.rows.map((r) => [g.label, r.partNo, r.name, r.qty, d(r.stock), r.grainWord, r.fab, stepText(r.assemblySteps), r.note])),
    ]),
    metal: toCsv([
      ['Stock', 'Part no', 'Name', 'Qty', 'Cut length (in)', 'Fab', 'Assembly step'],
      ...metal.map((r) => [r.section, r.partNo, r.name, r.qty, r.cutLengthIn, r.fab, stepText(r.assemblySteps)]),
    ]),
    cuts: toCsv([
      ['Board', 'Part no', 'Cut', 'Qty', 'Rough T x W x L (in)', 'Glue-up', 'Note'],
      ...cuts.map((c) => [c.board, c.partNo, c.label, c.qty, c.roughText, c.glueUp, c.note]),
    ]),
    glueUps: toCsv([
      ['Part no', 'Glue-up', 'Qty', 'From pieces', 'Rough T x W x L (in)', 'Mill to final T x W x L (in)', 'Note'],
      ...glueUps.map((g) => [g.partNo, g.label, g.qty, g.from, g.roughBlockText, g.finalText, g.note]),
    ]),
    finished: toCsv([
      ['Part no', 'Name', 'Qty', 'Final T x W x L (in)', 'From', 'Board', 'Grain', 'Fab', 'Assembly step'],
      ...finished.map((f) => [f.partNo, f.name, f.qty, f.finalText, f.from, f.board, f.grainWord, f.fab, stepText(f.assemblySteps)]),
    ]),
  };
  return { oak, layers, strips, resaw: pools, sheets, metal, warnings: [...new Set(warnings)], cuts, glueUps, finished, csv };
}

// ── Actual cuts, glue-ups and finished parts ──────────────────────────────────

const stripName = (name: string): string => name.replace(/\s*\((?:oak|white oak)[^)]*\)\s*$/i, '').trim();

/** The name shared by the identical parts of one part number: the name itself when they agree, else the first name without its side or number ('Wheel chock L' -> 'Wheel chock', 'Left chine band' -> 'chine band'). */
function sharedNames(plans: OakPartPlan[]): Map<string, string> {
  const by = new Map<string, string[]>();
  for (const pl of plans) (by.get(pl.partNo) ?? by.set(pl.partNo, []).get(pl.partNo)!).push(stripName(pl.part.name));
  const out = new Map<string, string>();
  for (const [no, names] of by) {
    if (names.every((n) => n === names[0])) { out.set(no, names[0]); continue; }
    const base = names[0].replace(/^(?:left|right)\s+/i, '').replace(/\s+(?:\d+|[LR])(?=\s*(?:\(|$))/, '').trim();
    out.set(no, base.charAt(0).toUpperCase() + base.slice(1));
  }
  return out;
}

/** The pieces sawn from boards: identical pieces of identical parts are one entry with a quantity. */
function cutsOf(plans: OakPartPlan[], pools: ResawPool[]): Cut[] {
  const map = new Map<string, Cut>();
  const names = sharedNames(plans);
  for (const pl of plans) {
    const name = names.get(pl.partNo)!;
    const glued = pl.edgeN > 1 || !!pl.lamination;
    const glueLabel = glued ? `${name} ${pl.lamination ? 'block' : 'panel'}` : undefined;
    for (const pc of pl.pieces) {
      const board = pc.piece === 'strip' ? (pools.find((q) => Math.abs(q.roughT - r3(pc.rough.t)) < 1e-6)?.board ?? '?') : pc.board;
      const label = pc.piece === 'solid' ? name
        : pc.piece === 'strip' ? (pc.of > 1 ? `${name}, strip ${pc.index} of ${pc.of}` : `${name}, strip`)
          : pc.piece === 'board' ? `${name}, board ${pc.across} of ${pc.acrossOf}`
            : `${name}, layer ${pc.layer} of ${pc.layers}${pc.acrossOf ? `, board ${pc.across} of ${pc.acrossOf}` : ''}`;
      const note = pc.piece === 'board' ? 'joint the glue edges, then glue the boards edge to edge'
        : pc.piece === 'layer' ? `plane to ${fractionText(pc.rough.t, 16)}" before the glue-up${pc.acrossOf ? '; edge-glue its boards first' : ''}`
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
  const boardOrder = (b: string): number => (b === 'resawn' ? 1000 : BOARD_THICKNESSES.findIndex((q) => q.nominal === b));
  return [...map.values()].sort((a, b) => boardOrder(a.board) - boardOrder(b.board) || b.rough.l - a.rough.l || a.partNo.localeCompare(b.partNo) || a.index - b.index);
}

/** The glue-ups that follow the cuts: each panel or laminated block, with the finished size it is milled to. */
function glueUpsOf(plans: OakPartPlan[]): GlueUp[] {
  const map = new Map<string, GlueUp>();
  const names = sharedNames(plans);
  for (const pl of plans) {
    if (pl.strip || (pl.edgeN <= 1 && !pl.lamination)) continue;
    const name = names.get(pl.partNo)!;
    const layers = pl.lamination ? pl.lamination.layers.length : 1;
    const kind: GlueUp['kind'] = pl.lamination ? (pl.edgeN > 1 ? 'both' : 'face') : 'edge';
    const label = `${name} ${pl.lamination ? 'block' : 'panel'}`;
    const key = `${pl.partNo}|${rowKeyDims(pl.block)}`;
    const hit = map.get(key);
    if (hit) { hit.qty += 1; hit.ids.push(pl.part.id); continue; }
    const how = kind === 'edge' ? `joint the glue edges and glue the ${pl.edgeN} boards edge to edge`
      : kind === 'face' ? `glue the ${layers} layers face to face`
        : `edge-glue the ${pl.edgeN} boards of each layer, then glue the ${layers} layers face to face`;
    map.set(key, {
      partId: pl.part.id, ids: [pl.part.id], qty: 1, partNo: pl.partNo, label, from: pl.pieces.length, edgeBoards: pl.edgeN, layers, kind,
      roughBlock: pl.block, roughBlockText: roughDimsText(pl.block), final: pl.stock, finalText: finalDimsText(pl.stock),
      note: `${how}; glued block rough ${roughDimsText(pl.block)}, then mill to final ${finalDimsText(pl.stock)}`,
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
        partNo: r.partNo, name: r.name, qty: r.qty, ids: r.ids, final, finalText: finalDimsText(final), from, board: r.board,
        ...(r.grainWord ? { grainWord: r.grainWord } : {}), fab: r.fab, assemblySteps: r.assemblySteps,
      });
    }
  }
  return out;
}
