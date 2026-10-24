/**
 * Nesting (Phase 4): okoume plywood onto 4 x 8 sheets, and the oak board feet with a suggested board list.
 * Plain TS, no three.js; pure functions of (parts, params).
 *
 * Plywood: every sheet part's true flat outline (`flatPattern`, so the plan-curved side webs are unrolled) is packed with a MaxRects
 * best-short-side-fit packer on the outline's bounding box, rotated 0 or 90 degrees. Face grain stays along the 96" sheet length where the
 * part fits that way; a part that had to turn is reported. The result carries the transformed outlines, so a drawing shows the true shapes.
 * Parts pack onto ONE sheet per thickness (4 mm, 12 mm) as long as they fit; an overflow opens another sheet, and a part that fits none is `unplaced`.
 *
 * Oak: board feet on NOMINAL thickness x rough width x rough length / 144, times (1 + oakWasteAllowance), plus a greedy cut plan onto 6" wide boards.
 */
import { THIN_PLY_MAX_IN } from '../model/sheets';
import type { Part, Vec2 } from '../model/types';
import { PLY_SPECIES, thinSheet, type Params } from '../params';
import { flatPattern, type FlatPattern } from './flat';
import {
  BOARD_LENGTHS_IN, BOARD_WIDTH_IN, boardByNominal, isBuilt, partKey, planResaw, sheetClass,
  BOARD_THICKNESSES, boardFinishedIn, planOakPart, type Lamination, type ResawPool,
} from './cutlist';

export const SHEET_WIDTH_IN = 48;
export const SHEET_LENGTH_IN = 96;

export interface Placement {
  partId: string;
  partNo: string;
  name: string;
  /** Lower-left of the rotated bounding box on the sheet (sheet x along the 96" length, y along the 48" width). */
  x: number;
  y: number;
  rotation: 0 | 90;
  /** Rotated bounding box (in). */
  widthIn: number;
  heightIn: number;
  /** Outline and holes in sheet inches. */
  outer: Vec2[];
  holes: Vec2[][];
  /** The part's own grain axis, if known, and whether it ends up along the sheet length. */
  grain?: 'u' | 'v';
  grainAlongLength?: boolean;
  /** The part's grain is known and had to be turned across the sheet. */
  turned: boolean;
  /** Net area (outline minus holes), in². */
  areaIn2: number;
}

export interface FreeRect { x: number; y: number; widthIn: number; heightIn: number }

export interface NestedSheet {
  /** e.g. '4 mm okoume marine plywood', '1/4 in white oak plywood', '12 mm okoume' (D-73). */
  label: string;
  thicknessMm: number;
  thicknessIn: number;
  /** 1-based index among the sheets of this thickness. */
  index: number;
  widthIn: number;
  lengthIn: number;
  placements: Placement[];
  usedAreaIn2: number;
  utilizationPct: number;
  offcut: { areaIn2: number; largest: FreeRect };
}

export interface NestResult {
  sheets: NestedSheet[];
  /** Part ids that fit no sheet (none at the defaults). */
  unplaced: string[];
  /** Placements whose grain had to turn across the sheet. */
  grainTurned: Array<{ partId: string; name: string }>;
  kerfIn: number;
}

// ── MaxRects packer ───────────────────────────────────────────────────────────

interface Rect { x: number; y: number; w: number; h: number }

class MaxRects {
  free: Rect[];
  constructor(w: number, h: number) { this.free = [{ x: 0, y: 0, w, h }]; }

  find(w: number, h: number): { rect: Rect; score: [number, number] } | null {
    let best: { rect: Rect; score: [number, number] } | null = null;
    for (const f of this.free) {
      if (w > f.w + 1e-9 || h > f.h + 1e-9) continue;
      const short = Math.min(f.w - w, f.h - h), long = Math.max(f.w - w, f.h - h);
      if (!best || short < best.score[0] - 1e-9 || (Math.abs(short - best.score[0]) < 1e-9 && long < best.score[1])) {
        best = { rect: { x: f.x, y: f.y, w, h }, score: [short, long] };
      }
    }
    return best;
  }

  place(r: Rect): void {
    const next: Rect[] = [];
    for (const f of this.free) {
      if (r.x >= f.x + f.w - 1e-9 || r.x + r.w <= f.x + 1e-9 || r.y >= f.y + f.h - 1e-9 || r.y + r.h <= f.y + 1e-9) { next.push(f); continue; }
      if (r.x > f.x + 1e-9) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w - 1e-9) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - (r.x + r.w), h: f.h });
      if (r.y > f.y + 1e-9) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h - 1e-9) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - (r.y + r.h) });
    }
    // drop free rectangles contained in another (the first of two identical ones stays)
    const inside = (a: Rect, b: Rect): boolean => a.x >= b.x - 1e-9 && a.y >= b.y - 1e-9 && a.x + a.w <= b.x + b.w + 1e-9 && a.y + a.h <= b.y + b.h + 1e-9;
    this.free = next.filter((a, i) => !next.some((b, j) => j !== i && inside(a, b) && (!inside(b, a) || j < i)));
  }
}

const polyArea = (o: Vec2[]): number => {
  let a = 0;
  for (let i = 0; i < o.length; i++) { const [x0, y0] = o[i], [x1, y1] = o[(i + 1) % o.length]; a += x0 * y1 - x1 * y0; }
  return Math.abs(a) / 2;
};

/** The pattern in sheet inches for a rotation and a lower-left corner. Rotation by 90 deg CCW maps (u, v) to (H - v, u). */
function transform(f: FlatPattern, rot: 0 | 90, x: number, y: number): { outer: Vec2[]; holes: Vec2[][] } {
  const m = (q: Vec2): Vec2 => (rot === 0 ? [q[0] + x, q[1] + y] : [f.heightIn - q[1] + x, q[0] + y]);
  return { outer: f.outer.map(m), holes: f.holes.map((h) => h.map(m)) };
}

export function nestPlywood(parts: Part[], p: Params): NestResult {
  const k = p.nestKerfIn;
  const unplaced: string[] = [];
  const turned: NestResult['grainTurned'] = [];
  const byClass = new Map<number, Array<{ part: Part; flat: FlatPattern }>>();
  for (const x of parts.filter((q) => isBuilt(q) && q.kind === 'sheet')) {
    const f = flatPattern(x);
    if (!f) { unplaced.push(x.id); continue; }
    const mm = sheetClass(f.thicknessIn).mm;
    const arr = byClass.get(mm) ?? [];
    arr.push({ part: x, flat: f });
    byClass.set(mm, arr);
  }

  const sheets: NestedSheet[] = [];
  const thinCls = sheetClass(thinSheet(p).thicknessIn).mm; // D-73: the thin-sheet class sits on the sheet its material comes in (48 x 96, or the 60 x 60 Baltic birch)
  for (const [mm, items] of [...byClass.entries()].sort((a, b) => a[0] - b[0])) {
    const isThin = mm === thinCls && items[0].flat.thicknessIn <= THIN_PLY_MAX_IN;
    const SHEET_L = isThin ? thinSheet(p).sheetLengthIn : SHEET_LENGTH_IN, SHEET_W = isThin ? thinSheet(p).sheetWidthIn : SHEET_WIDTH_IN;
    const label = isThin ? thinSheet(p).name : `${mm} mm ${p.plySpecies === PLY_SPECIES.okoumeMarine ? 'okoume' : 'Baltic birch'}`;
    // biggest first; the long webs and the deck go in before the small pieces
    items.sort((a, b) => b.flat.widthIn * b.flat.heightIn - a.flat.widthIn * a.flat.heightIn);
    type Open = { packer: MaxRects; placements: Placement[] };
    const open: Open[] = [];
    const newSheet = (): Open => { const s = { packer: new MaxRects(SHEET_L - k, SHEET_W - k), placements: [] as Placement[] }; open.push(s); return s; };
    newSheet();
    for (const { part, flat: f } of items) {
      // orientations: grain along the sheet length first, then (if nothing else fits) the turned ones
      const orients = ([0, 90] as const).map((rot) => ({
        rot, w: rot === 0 ? f.widthIn : f.heightIn, h: rot === 0 ? f.heightIn : f.widthIn,
        along: f.grain === undefined ? undefined : (f.grain === 'u') === (rot === 0),
      }));
      const ordered = [...orients.filter((o) => o.along !== false), ...orients.filter((o) => o.along === false)];
      const area = polyArea(f.outer) - f.holes.reduce((a, h) => a + polyArea(h), 0);
      const tryPlace = (sheet: Open): boolean => {
        for (const o of ordered) {
          const hit = sheet.packer.find(o.w + k, o.h + k);
          if (!hit) continue;
          sheet.packer.place(hit.rect);
          const x = hit.rect.x + k, y = hit.rect.y + k;
          const t = transform(f, o.rot, x, y);
          sheet.placements.push({
            partId: part.id, partNo: partKey(part), name: part.name, x, y, rotation: o.rot, widthIn: o.w, heightIn: o.h, outer: t.outer, holes: t.holes,
            grain: f.grain, grainAlongLength: o.along, turned: o.along === false, areaIn2: area,
          });
          if (o.along === false) turned.push({ partId: part.id, name: part.name });
          return true;
        }
        return false;
      };
      if (open.some(tryPlace)) continue;
      // another sheet only helps when the part fits an empty one
      if (ordered.some((o) => new MaxRects(SHEET_L - k, SHEET_W - k).find(o.w + k, o.h + k))) tryPlace(newSheet());
      else unplaced.push(part.id);
    }
    open.forEach((s, i) => {
      const used = s.placements.reduce((a, q) => a + q.areaIn2, 0);
      const total = SHEET_L * SHEET_W;
      const frees = s.packer.free.map((r): FreeRect => ({ x: r.x + k, y: r.y + k, widthIn: Math.max(0, r.w - k), heightIn: Math.max(0, r.h - k) }));
      const largest = frees.sort((a, b) => b.widthIn * b.heightIn - a.widthIn * a.heightIn)[0] ?? { x: 0, y: 0, widthIn: 0, heightIn: 0 };
      sheets.push({
        label, thicknessMm: mm, thicknessIn: items[0].flat.thicknessIn, index: i + 1, widthIn: SHEET_W, lengthIn: SHEET_L,
        placements: s.placements, usedAreaIn2: used, utilizationPct: (100 * used) / total, offcut: { areaIn2: total - used, largest },
      });
    });
  }
  return { sheets, unplaced, grainTurned: turned, kerfIn: k };
}

// ── Oak board feet and the board list ─────────────────────────────────────────

export interface BoardCut {
  partNo: string; id: string; widthIn: number; lengthIn: number;
  /** Part is wider than a board: this is one of several pieces to edge-glue. */
  glueUp?: boolean;
  /** The thickness this piece would be bought as; set when it is cut from the free lane space of a thicker board instead (`foldBoards`). */
  fromBoard?: string;
  /** This piece is a layer of a face-laminated part (D-70): layer number from 1 and the number of layers. The part id is the laminated part. */
  layer?: number;
  layers?: number;
  /** Which cut of its part this is (1-based among `of`; a board of an edge-glued panel, a layer, or the single solid piece), matching `CutList.cuts`. */
  piece?: 'board' | 'layer' | 'solid' | 'strip';
  index?: number;
  of?: number;
}
export interface BoardLane { widthIn: number; usedIn: number; cuts: BoardCut[] }
export interface Board { nominal: string; lengthIn: number; lanes: BoardLane[]; usedWidthIn: number }

export interface OakThickness {
  /** '4/4' ... */
  board: string;
  nominalIn: number;
  usableIn: number;
  /** Reliable finished thickness of this board (in, Eric 2026-10-13): what a part bought from it can be milled to at most. */
  finishedIn: number;
  /** Solid pieces and laminate strips milled from this thickness. */
  pieces: number;
  /** Solid pieces' board feet at rough size on nominal thickness; the share of the laminate strips (each a 1/k share of its board). */
  solidNetBf: number;
  stripNetBf: number;
  netBf: number;
  /** netBf x (1 + oakWasteAllowance). */
  allowanceBf: number;
  /** Board feet of the suggested boards (solid cut plan plus the resaw boards). */
  plannedBf: number;
  /** What the BOM prices: the suggested whole boards (`plannedBf`), since a yard sells boards, not net board feet. `allowanceBf` (net + waste allowance) is kept as the spec figure to compare against. */
  purchaseBf: number;
  /** Small solid bucket cut from offcuts of this (next thicker) board instead of its own: the parts, and the thickness they would have been bought as. */
  movedIn?: { from: string; partNos: string[]; netBf: number };
  /** This thickness's own solid pieces went to the next thicker board's offcuts (see `OakPlan.consolidated`). */
  movedOut?: string;
  /** Cut plan of the solid pieces onto boards. */
  boards: Board[];
  /** Dedicated boards that are resawn into laminate strips (from planResaw): the boards to buy, how many strips the pool needs, the spares the boards leave and the strips each board yields. */
  resawBoards: Array<{ lengthIn: number; widthIn: number; count: number; pool: number; strips: number; spares: number; yieldPerBoard: number }>;
  /** Pieces of thinner boards cut from the free lane space of this board's plan (see `OakPlan.folded`). */
  foldedIn?: Array<{ from: string; partNos: string[]; netBf: number }>;
  /** Layer pieces of face-laminated parts that are cut from this thickness's boards (pieces, the parts, and their rough board feet on this thickness). */
  layersIn?: { pieces: number; partNos: string[] };
  /** Human-readable board list, e.g. '2 x 6" x 8 ft'. */
  summary: string[];
  /** The shopping list by width: each piece's rough width rounded UP to a whole inch, its length (plus a kerf) summed per width and rounded up to 1/2 ft. A wider board rips down to any narrower width. Resaw boards count at their width. */
  byWidth: WidthLine[];
}

/** Linear feet of lumber at one whole-inch width (see `OakThickness.byWidth`). */
export interface WidthLine { widthIn: number; linearFt: number; pieces: number; /** The longest single piece (ft, rounded up to 1/2 ft): a board shorter than this cannot supply it, whatever its width. */ longestFt: number }

export interface OakPlan {
  thicknesses: OakThickness[];
  wasteAllowance: number;
  netBf: number;
  allowanceBf: number;
  purchaseBf: number;
  resaw: ResawPool[];
  /** Wide pieces split into glued-up boards (part ids). A laminated part wider than a board is edge-glued within each layer, so it is listed here too. */
  glueUps: string[];
  /** Parts too thick for any stocked board (12/4 is not bought, D-70): glued up face to face from layers of stocked boards, BEFORE they are milled to size, notched, bored or slotted. */
  laminated: Array<{ id: string; partNo: string; lamination: Lamination }>;
  /** Thin solid buckets (under `SMALL_BUCKET_BF`) that are cut from offcuts of the next thicker board instead of buying a whole thin board. */
  consolidated: Array<{ from: string; to: string; partNos: string[]; netBf: number }>;
  /** Pieces of a thin board's lightly loaded board that moved into the free lane space of a thicker board, which shortens or removes that thin board (`foldBoards`). */
  folded: Array<{ from: string; to: string; partNos: string[]; /** Ids of the pieces that moved (the part numbers are shared by identical parts). */ ids: string[]; netBf: number }>;
}

/** A thickness whose SOLID pieces total less than this many board feet is not worth a whole board of its own when a thicker board's offcuts can hold them (bf). */
export const SMALL_BUCKET_BF = 1;

/** "3\" wide: 14 ft" per width, narrowest first (the shopping list; `OakThickness.byWidth`). */
export const widthListText = (t: Pick<OakThickness, 'byWidth'>): string[] => t.byWidth.map((w) => `${w.widthIn}" wide: ${w.linearFt} ft in all, longest piece ${w.longestFt} ft`);

const lenFt = (inches: number): string => `${inches / 12} ft`;
/** A cut shares a lane with others only when the lane is at most this much wider than the cut (in); otherwise it opens a lane of its own on a board with width left. */
const LANE_TIGHT_IN = 0.75;

/** Greedy plan: items sorted by width then length, lanes opened across a 6" board, boards trimmed to the shortest of 6, 8 and 10 ft that holds them. */
function planBoards(cuts: BoardCut[], nominal: string, kerf: number): Board[] {
  const maxLen = BOARD_LENGTHS_IN[BOARD_LENGTHS_IN.length - 1];
  const boards: Board[] = [];
  const sorted = [...cuts].sort((a, b) => b.widthIn - a.widthIn || b.lengthIn - a.lengthIn);
  for (const c of sorted) {
    // 1. a lane that is about as wide as the cut (little width wasted) with length to spare; 2. a new lane on a board with width left; 3. any wider lane that fits; 4. a new board.
    const room = (l: BoardLane) => l.usedIn + c.lengthIn + kerf <= maxLen + 1e-9;
    let lane: BoardLane | undefined;
    for (const b of boards) { const l = b.lanes.find((q) => c.widthIn <= q.widthIn + 1e-9 && q.widthIn - c.widthIn <= LANE_TIGHT_IN && room(q)); if (l) { lane = l; break; } }
    if (lane) { lane.cuts.push(c); lane.usedIn += c.lengthIn + kerf; continue; }
    const wide = boards.find((b) => b.usedWidthIn + c.widthIn + kerf <= BOARD_WIDTH_IN + kerf + 1e-9 && c.lengthIn <= maxLen);
    if (wide) { wide.lanes.push({ widthIn: c.widthIn, usedIn: c.lengthIn + kerf, cuts: [c] }); wide.usedWidthIn += c.widthIn + kerf; continue; }
    for (const b of boards) { const l = b.lanes.find((q) => c.widthIn <= q.widthIn + 1e-9 && room(q)); if (l) { lane = l; break; } }
    if (lane) { lane.cuts.push(c); lane.usedIn += c.lengthIn + kerf; continue; }
    boards.push({ nominal, lengthIn: maxLen, lanes: [{ widthIn: c.widthIn, usedIn: c.lengthIn + kerf, cuts: [c] }], usedWidthIn: c.widthIn + kerf });
  }
  for (const b of boards) {
    const longest = Math.max(...b.lanes.map((l) => l.usedIn - kerf));
    b.lengthIn = BOARD_LENGTHS_IN.find((l) => l >= longest - 1e-9) ?? maxLen;
  }
  return boards;
}

const boardBf = (b: { nominal: string; lengthIn: number }): number => (boardByNominal(b.nominal).nominalIn * BOARD_WIDTH_IN * b.lengthIn) / 144;

/** Shortest stock length (in) that holds a board's longest lane. */
function trimLength(b: Board, kerf: number): number {
  const longest = Math.max(0, ...b.lanes.map((l) => l.usedIn - kerf));
  return BOARD_LENGTHS_IN.find((l) => l >= longest - 1e-9) ?? BOARD_LENGTHS_IN[BOARD_LENGTHS_IN.length - 1];
}

/**
 * Cross-thickness fill. A last, lightly used board of a thin thickness (the third 4/4 board with a single 1.25" lane) is bought whole for a few short pieces while the thicker boards
 * carry free lane space. Move what fits into that space (a lane at least as wide with length to spare, or a new lane in the width left) and keep the move when the thin board gets
 * shorter or disappears. The piece is then milled down from the thicker board, so it is marked `fromBoard`. Returns what moved, per source and host thickness.
 */
function foldBoards(plans: Map<string, Board[]>, kerf: number): Array<{ from: string; to: string; cuts: BoardCut[] }> {
  const moved: Array<{ from: string; to: string; cuts: BoardCut[] }> = [];
  const order = BOARD_THICKNESSES.map((b) => b.nominal);
  const util = (b: Board): number => b.lanes.reduce((a, l) => a + l.widthIn * l.usedIn, 0) / (BOARD_WIDTH_IN * b.lengthIn);
  for (let guard = 0; guard < 20; guard++) {
    let improved = false;
    for (let i = 0; i < order.length - 1 && !improved; i++) {
      const thin = plans.get(order[i]) ?? [];
      for (const src of [...thin].sort((a, b) => util(a) - util(b))) {
        const before = boardBf(src);
        // work on copies of the lane state so a failed attempt changes nothing
        const hosts: Array<{ nominal: string; board: Board; lanes: BoardLane[]; usedWidthIn: number }> = [];
        for (let j = i; j < order.length; j++) for (const b of plans.get(order[j]) ?? []) if (b !== src) hosts.push({ nominal: order[j], board: b, lanes: b.lanes.map((l) => ({ ...l, cuts: [...l.cuts] })), usedWidthIn: b.usedWidthIn });
        const placed: Array<{ cut: BoardCut; host: (typeof hosts)[number] }> = [];
        const stay: BoardCut[] = [];
        for (const c of src.lanes.flatMap((l) => l.cuts).sort((a, b) => b.lengthIn - a.lengthIn)) {
          let lane: BoardLane | undefined, host: (typeof hosts)[number] | undefined;
          for (const h of hosts) {
            for (const l of h.lanes) if (c.widthIn <= l.widthIn + 1e-9 && l.usedIn + c.lengthIn + kerf <= h.board.lengthIn + kerf + 1e-9 && (!lane || l.widthIn < lane.widthIn)) { lane = l; host = h; }
          }
          if (lane && host) { lane.cuts.push(c); lane.usedIn += c.lengthIn + kerf; placed.push({ cut: c, host }); continue; }
          const room = hosts.find((h) => h.usedWidthIn + c.widthIn + kerf <= BOARD_WIDTH_IN + kerf + 1e-9 && c.lengthIn <= h.board.lengthIn + 1e-9);
          if (room) { room.lanes.push({ widthIn: c.widthIn, usedIn: c.lengthIn + kerf, cuts: [c] }); room.usedWidthIn += c.widthIn + kerf; placed.push({ cut: c, host: room }); continue; }
          stay.push(c);
        }
        if (!placed.length || stay.length) continue; // all or nothing: a half-emptied board only scatters pieces over the other boards
        // the source with only what stayed
        const rest: Board = { ...src, lanes: [] };
        for (const l of src.lanes) {
          const cuts = l.cuts.filter((c) => stay.includes(c));
          if (cuts.length) rest.lanes.push({ widthIn: l.widthIn, usedIn: cuts.reduce((a, c) => a + c.lengthIn + kerf, 0), cuts });
        }
        rest.lengthIn = rest.lanes.length ? trimLength(rest, kerf) : 0;
        const after = rest.lanes.length ? boardBf(rest) : 0;
        if (after >= before - 1e-9) continue;
        // commit
        for (const h of hosts) { h.board.lanes = h.lanes; h.board.usedWidthIn = h.usedWidthIn; }
        const list = plans.get(order[i])!;
        if (rest.lanes.length) { src.lanes = rest.lanes; src.lengthIn = rest.lengthIn; src.usedWidthIn = rest.lanes.reduce((a, l) => a + l.widthIn + kerf, 0); }
        else list.splice(list.indexOf(src), 1);
        for (const { cut, host } of placed) {
          if (host.nominal !== order[i]) cut.fromBoard = order[i]; // a move to another board of the SAME thickness is not milled down: nothing to say
          const rec = moved.find((m) => m.from === order[i] && m.to === host.nominal) ?? (moved[moved.push({ from: order[i], to: host.nominal, cuts: [] }) - 1]);
          rec.cuts.push(cut);
        }
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }
  return moved;
}

/** Oak board feet by nominal thickness, with the waste allowance and a suggested board list. */
export function oakBoardFeet(parts: Part[], p: Params): OakPlan {
  const kerf = p.resawKerfIn;
  const solid = parts.filter((x) => isBuilt(x) && /oak/i.test(x.material) && x.kind === 'lumber' && x.plies === undefined);
  const cutsBy = new Map<string, BoardCut[]>();
  const glueUps: string[] = [];
  const laminated: OakPlan['laminated'] = [];
  const netSolid = new Map<string, number>();
  const pieces = new Map<string, number>();
  for (const x of solid) {
    // The cuts are the pieces sawn from boards (Eric 2026-10-12): the boards of an edge-glued panel and the layers of a face-laminated part are separate cuts, each at its rough size
    // rounded UP to 1/8 with the laminate allowances; a plain solid part is one cut with the plain allowances.
    const plan = planOakPart(x, p);
    if (plan.edgeN > 1) glueUps.push(x.id);
    if (plan.lamination) laminated.push({ id: x.id, partNo: partKey(x), lamination: plan.lamination });
    const seenLayer = new Set<string>();
    for (const pc of plan.pieces) {
      const arr = cutsBy.get(pc.board) ?? [];
      arr.push({
        partNo: partKey(x), id: x.id, widthIn: pc.rough.w, lengthIn: pc.rough.l, ...((plan.part.layerGrain ? !!pc.acrossOf : plan.edgeN > 1) ? { glueUp: true } : {}),
        ...(pc.layer ? { layer: pc.layer, layers: pc.layers } : {}), piece: pc.piece, index: pc.index, of: pc.of,
      });
      cutsBy.set(pc.board, arr);
      netSolid.set(pc.board, (netSolid.get(pc.board) ?? 0) + (boardByNominal(pc.board).nominalIn * pc.rough.w * pc.rough.l) / 144);
      const k = `${pc.board}|${pc.layer ?? 0}`;
      if (!seenLayer.has(k)) { seenLayer.add(k); pieces.set(pc.board, (pieces.get(pc.board) ?? 0) + 1); }
    }
  }
  // Consolidate: a thickness whose solid pieces total under SMALL_BUCKET_BF is cut from the offcuts of the next thicker board, when they fit in that board's free lanes (no extra board).
  const consolidated: OakPlan['consolidated'] = [];
  const movedInTo = new Map<string, { from: string; partNos: string[]; netBf: number }>();
  const movedOutOf = new Map<string, string>();
  for (let i = 0; i < BOARD_THICKNESSES.length - 1; i++) {
    const b = BOARD_THICKNESSES[i];
    const cuts = cutsBy.get(b.nominal) ?? [];
    if (!cuts.length || (netSolid.get(b.nominal) ?? 0) >= SMALL_BUCKET_BF) continue;
    const sumBf = (bs: Board[]): number => bs.reduce((a, q) => a + boardBf(q), 0);
    const ownBf = sumBf(planBoards(cuts, b.nominal, kerf));
    // The first thicker board whose plan takes the pieces for fewer board feet than a board of their own (they fill its free lanes, or lengthen it by one step at most).
    const nb = BOARD_THICKNESSES.slice(i + 1).find((t) => {
      const h = cutsBy.get(t.nominal) ?? [];
      return h.length > 0 && sumBf(planBoards([...h, ...cuts], t.nominal, kerf)) - sumBf(planBoards(h, t.nominal, kerf)) < ownBf - 1e-9;
    });
    if (!nb) continue;
    const host = cutsBy.get(nb.nominal)!;
    const movedNet = cuts.reduce((a, c) => a + (nb.nominalIn * c.widthIn * c.lengthIn) / 144, 0);
    const partNos = [...new Set(cuts.map((c) => c.partNo))];
    host.push(...cuts);
    cutsBy.delete(b.nominal);
    netSolid.set(nb.nominal, (netSolid.get(nb.nominal) ?? 0) + movedNet);
    pieces.set(nb.nominal, (pieces.get(nb.nominal) ?? 0) + (pieces.get(b.nominal) ?? 0));
    netSolid.set(b.nominal, 0);
    pieces.set(b.nominal, 0);
    consolidated.push({ from: b.nominal, to: nb.nominal, partNos, netBf: movedNet });
    movedInTo.set(nb.nominal, { from: b.nominal, partNos, netBf: movedNet });
    movedOutOf.set(b.nominal, nb.nominal);
  }
  const resaw = planResaw(parts, p);
  const stripNet = new Map<string, number>();
  const resawBoards = new Map<string, OakThickness['resawBoards']>();
  const resawBf = new Map<string, number>();
  const stripCount = new Map<string, number>();
  resaw.forEach((pool, i) => {
    const b = boardByNominal(pool.board);
    for (const lane of pool.laneStrips) {
      for (const s of lane) stripNet.set(pool.board, (stripNet.get(pool.board) ?? 0) + (b.nominalIn / pool.stripsPerBoard * s.widthIn * s.lengthIn) / 144);
    }
    stripCount.set(pool.board, (stripCount.get(pool.board) ?? 0) + pool.strips);
    (resawBoards.get(pool.board) ?? resawBoards.set(pool.board, []).get(pool.board)!).push({
      lengthIn: pool.boardLengthIn, widthIn: pool.boardWidthIn, count: pool.boards, pool: i, strips: pool.strips, spares: pool.spares, yieldPerBoard: pool.yieldPerBoard,
    });
    resawBf.set(pool.board, (resawBf.get(pool.board) ?? 0) + pool.boardFeet);
  });

  // The solid plan per thickness, then the fold: lightly used thin boards give their pieces to the free lane space of thicker ones.
  const plans = new Map<string, Board[]>();
  for (const b of BOARD_THICKNESSES) plans.set(b.nominal, planBoards(cutsBy.get(b.nominal) ?? [], b.nominal, kerf));
  const folds = foldBoards(plans, kerf);
  const folded: OakPlan['folded'] = [];
  const foldedInTo = new Map<string, NonNullable<OakThickness['foldedIn']>>();
  for (const f of folds) {
    if (f.from === f.to) continue; // pieces moved between boards of one thickness (a shorter or fewer boards): net board feet, pieces and the summary are unchanged
    const to = boardByNominal(f.to), from = boardByNominal(f.from);
    const netTo = f.cuts.reduce((a, c) => a + (to.nominalIn * c.widthIn * c.lengthIn) / 144, 0);
    const netFrom = f.cuts.reduce((a, c) => a + (from.nominalIn * c.widthIn * c.lengthIn) / 144, 0);
    const ids = [...new Set(f.cuts.map((c) => c.id))];
    const partNos = [...new Set(f.cuts.map((c) => c.partNo))];
    netSolid.set(to.nominal, (netSolid.get(to.nominal) ?? 0) + netTo);
    netSolid.set(from.nominal, Math.max(0, (netSolid.get(from.nominal) ?? 0) - netFrom));
    // a part moves as a piece when none of its cuts is left behind
    const whole = ids.filter((id) => !(plans.get(from.nominal) ?? []).some((q) => q.lanes.some((l) => l.cuts.some((c) => c.id === id))));
    pieces.set(to.nominal, (pieces.get(to.nominal) ?? 0) + whole.length);
    pieces.set(from.nominal, Math.max(0, (pieces.get(from.nominal) ?? 0) - whole.length));
    folded.push({ from: from.nominal, to: to.nominal, partNos, ids, netBf: netTo });
    (foldedInTo.get(to.nominal) ?? foldedInTo.set(to.nominal, []).get(to.nominal)!).push({ from: from.nominal, partNos, netBf: netTo });
  }

  const thicknesses: OakThickness[] = [];
  for (const b of BOARD_THICKNESSES) {
    const rb = resawBoards.get(b.nominal) ?? [];
    const boards = plans.get(b.nominal) ?? [];
    if (!boards.length && !rb.length) continue;
    const solidNetBf = netSolid.get(b.nominal) ?? 0, stripNetBf = stripNet.get(b.nominal) ?? 0;
    const netBf = solidNetBf + stripNetBf;
    const plannedBf = boards.reduce((a, q) => a + boardBf(q), 0) + (resawBf.get(b.nominal) ?? 0);
    const allowanceBf = netBf * (1 + p.oakWasteAllowance);
    const tally = new Map<number, number>();
    for (const q of boards) tally.set(q.lengthIn, (tally.get(q.lengthIn) ?? 0) + 1);
    const summary = [...tally.entries()].sort((a, c) => a[0] - c[0]).map(([l, n]) => `${n} x ${b.nominal} x ${BOARD_WIDTH_IN}" x ${lenFt(l)}`);
    for (const r of rb) summary.push(`${r.count} x ${b.nominal} x ${r.widthIn}" wide x ${lenFt(r.lengthIn)} (resaw into laminate strips: ${r.strips} needed, ${r.yieldPerBoard} per board, ${r.spares} spare${r.spares === 1 ? '' : 's'})`);
    const byW = new Map<number, { in: number; pieces: number; longest: number }>();
    const addW = (w: number, len: number, n: number, cut = len): void => {
      const k = Math.ceil(w - 1e-9), e = byW.get(k) ?? byW.set(k, { in: 0, pieces: 0, longest: 0 }).get(k)!;
      e.in += len * n; e.pieces += n; e.longest = Math.max(e.longest, cut);
    };
    for (const c of boards.flatMap((q) => q.lanes.flatMap((l) => l.cuts))) addW(c.widthIn, c.lengthIn + kerf, 1, c.lengthIn);
    for (const r of rb) addW(r.widthIn, r.lengthIn, r.count);
    const halfFt = (inches: number): number => Math.ceil((inches / 12) * 2 - 1e-9) / 2;
    const byWidth: WidthLine[] = [...byW.entries()].sort((a, c) => a[0] - c[0]).map(([widthIn, e]) => ({ widthIn, linearFt: halfFt(e.in), pieces: e.pieces, longestFt: halfFt(e.longest) }));
    const layerCuts = boards.flatMap((q) => q.lanes.flatMap((l) => l.cuts)).filter((c) => c.layer !== undefined);
    const layersIn = layerCuts.length ? { pieces: layerCuts.length, partNos: [...new Set(layerCuts.map((c) => c.partNo))] } : undefined;
    if (layersIn) summary.push(`includes ${layersIn.pieces} layer pieces for the face-laminated parts (glue the layers face to face, then mill)`);
    const mi = movedInTo.get(b.nominal);
    if (mi) summary.push(`also cut the ${mi.from} parts (${mi.netBf.toFixed(1)} bf) from the offcuts of these boards: no ${mi.from} board to buy for them`);
    const fi = foldedInTo.get(b.nominal);
    for (const f of fi ?? []) summary.push(`also cut the ${f.from} parts (${f.netBf.toFixed(1)} bf) from the free lanes of these boards: it saves ${f.from} board length`);
    thicknesses.push({
      board: b.nominal, nominalIn: b.nominalIn, usableIn: b.usableIn, finishedIn: boardFinishedIn(b, p), pieces: (pieces.get(b.nominal) ?? 0) + (stripCount.get(b.nominal) ?? 0),
      solidNetBf, stripNetBf, netBf, allowanceBf, plannedBf, purchaseBf: plannedBf, boards, resawBoards: rb, summary, byWidth,
      ...(layersIn ? { layersIn } : {}), ...(mi ? { movedIn: mi } : {}), ...(movedOutOf.has(b.nominal) ? { movedOut: movedOutOf.get(b.nominal) } : {}), ...(fi ? { foldedIn: fi } : {}),
    });
  }
  const sum = (f: (t: OakThickness) => number): number => thicknesses.reduce((a, t) => a + f(t), 0);
  return {
    thicknesses, wasteAllowance: p.oakWasteAllowance, netBf: sum((t) => t.netBf), allowanceBf: sum((t) => t.allowanceBf),
    purchaseBf: sum((t) => t.purchaseBf), resaw, glueUps, laminated, consolidated, folded,
  };
}
