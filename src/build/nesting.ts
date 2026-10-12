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
import type { Part, Vec2 } from '../model/types';
import type { Params } from '../params';
import { flatPattern, type FlatPattern } from './flat';
import {
  BOARD_LENGTHS_IN, BOARD_WIDTH_IN, boardByNominal, boardForThickness, isBuilt, partKey, planResaw, sheetClass,
  BOARD_THICKNESSES, type ResawPool,
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
  /** e.g. '4 mm okoume'. */
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
  for (const [mm, items] of [...byClass.entries()].sort((a, b) => a[0] - b[0])) {
    // biggest first; the long webs and the deck go in before the small pieces
    items.sort((a, b) => b.flat.widthIn * b.flat.heightIn - a.flat.widthIn * a.flat.heightIn);
    type Open = { packer: MaxRects; placements: Placement[] };
    const open: Open[] = [];
    const newSheet = (): Open => { const s = { packer: new MaxRects(SHEET_LENGTH_IN - k, SHEET_WIDTH_IN - k), placements: [] as Placement[] }; open.push(s); return s; };
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
      if (ordered.some((o) => new MaxRects(SHEET_LENGTH_IN - k, SHEET_WIDTH_IN - k).find(o.w + k, o.h + k))) tryPlace(newSheet());
      else unplaced.push(part.id);
    }
    open.forEach((s, i) => {
      const used = s.placements.reduce((a, q) => a + q.areaIn2, 0);
      const total = SHEET_LENGTH_IN * SHEET_WIDTH_IN;
      const frees = s.packer.free.map((r): FreeRect => ({ x: r.x + k, y: r.y + k, widthIn: Math.max(0, r.w - k), heightIn: Math.max(0, r.h - k) }));
      const largest = frees.sort((a, b) => b.widthIn * b.heightIn - a.widthIn * a.heightIn)[0] ?? { x: 0, y: 0, widthIn: 0, heightIn: 0 };
      sheets.push({
        label: `${mm} mm okoume`, thicknessMm: mm, thicknessIn: items[0].flat.thicknessIn, index: i + 1, widthIn: SHEET_WIDTH_IN, lengthIn: SHEET_LENGTH_IN,
        placements: s.placements, usedAreaIn2: used, utilizationPct: (100 * used) / total, offcut: { areaIn2: total - used, largest },
      });
    });
  }
  return { sheets, unplaced, grainTurned: turned, kerfIn: k };
}

// ── Oak board feet and the board list ─────────────────────────────────────────

export interface BoardCut { partNo: string; id: string; widthIn: number; lengthIn: number; /** Part is wider than a board: this is one of several pieces to edge-glue. */ glueUp?: boolean }
export interface BoardLane { widthIn: number; usedIn: number; cuts: BoardCut[] }
export interface Board { nominal: string; lengthIn: number; lanes: BoardLane[]; usedWidthIn: number }

export interface OakThickness {
  /** '4/4' ... */
  board: string;
  nominalIn: number;
  usableIn: number;
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
  /** What the BOM prices: the board feet with the waste allowance (the spec). The suggested boards (`plannedBf`) are whole boards and run higher. */
  purchaseBf: number;
  /** Cut plan of the solid pieces onto boards. */
  boards: Board[];
  /** Dedicated boards that are resawn into laminate strips (from planResaw). */
  resawBoards: Array<{ lengthIn: number; count: number; pool: number }>;
  /** Human-readable board list, e.g. '2 x 6" x 8 ft'. */
  summary: string[];
}

export interface OakPlan {
  thicknesses: OakThickness[];
  wasteAllowance: number;
  netBf: number;
  allowanceBf: number;
  purchaseBf: number;
  resaw: ResawPool[];
  /** Wide pieces split into glued-up boards (part ids). */
  glueUps: string[];
}

const lenFt = (inches: number): string => `${inches / 12} ft`;

/** Greedy plan: items sorted by width then length, lanes opened across a 6" board, boards trimmed to the shortest of 6, 8 and 10 ft that holds them. */
function planBoards(cuts: BoardCut[], nominal: string, kerf: number): Board[] {
  const maxLen = BOARD_LENGTHS_IN[BOARD_LENGTHS_IN.length - 1];
  const boards: Board[] = [];
  const sorted = [...cuts].sort((a, b) => b.widthIn - a.widthIn || b.lengthIn - a.lengthIn);
  for (const c of sorted) {
    let done = false;
    for (const b of boards) {
      // an existing lane of enough width with length to spare
      const lane = b.lanes.find((l) => c.widthIn <= l.widthIn + 1e-9 && l.usedIn + c.lengthIn + kerf <= maxLen + 1e-9);
      if (lane) { lane.cuts.push(c); lane.usedIn += c.lengthIn + kerf; done = true; break; }
      if (b.usedWidthIn + c.widthIn + kerf <= BOARD_WIDTH_IN + kerf + 1e-9 && c.lengthIn <= maxLen) {
        b.lanes.push({ widthIn: c.widthIn, usedIn: c.lengthIn + kerf, cuts: [c] });
        b.usedWidthIn += c.widthIn + kerf;
        done = true;
        break;
      }
    }
    if (!done) boards.push({ nominal, lengthIn: maxLen, lanes: [{ widthIn: c.widthIn, usedIn: c.lengthIn + kerf, cuts: [c] }], usedWidthIn: c.widthIn + kerf });
  }
  for (const b of boards) {
    const longest = Math.max(...b.lanes.map((l) => l.usedIn - kerf));
    b.lengthIn = BOARD_LENGTHS_IN.find((l) => l >= longest - 1e-9) ?? maxLen;
  }
  return boards;
}

const boardBf = (b: { nominal: string; lengthIn: number }): number => (boardByNominal(b.nominal).nominalIn * BOARD_WIDTH_IN * b.lengthIn) / 144;

/** Oak board feet by nominal thickness, with the waste allowance and a suggested board list. */
export function oakBoardFeet(parts: Part[], p: Params): OakPlan {
  const kerf = p.resawKerfIn;
  const solid = parts.filter((x) => isBuilt(x) && /oak/i.test(x.material) && x.kind === 'lumber' && x.plies === undefined);
  const cutsBy = new Map<string, BoardCut[]>();
  const glueUps: string[] = [];
  const netSolid = new Map<string, number>();
  const pieces = new Map<string, number>();
  for (const x of solid) {
    const rough = x.rough ?? { t: (x.stock?.t ?? 0) + p.millingAllowanceIn, w: (x.stock?.w ?? 0) + p.millingAllowanceIn, l: (x.stock?.l ?? 0) + 4 * p.millingAllowanceIn };
    const sorted = [rough.t, rough.w, rough.l].sort((a, b) => a - b);
    const d = rough.t <= rough.w && rough.t <= rough.l ? rough : { t: sorted[0], w: sorted[1], l: sorted[2] }; // transposed model data (seat-crest-strip)
    const b = boardForThickness(d.t) ?? BOARD_THICKNESSES[BOARD_THICKNESSES.length - 1];
    netSolid.set(b.nominal, (netSolid.get(b.nominal) ?? 0) + (b.nominalIn * d.w * d.l) / 144);
    pieces.set(b.nominal, (pieces.get(b.nominal) ?? 0) + 1);
    const n = Math.max(1, Math.ceil(d.w / BOARD_WIDTH_IN - 1e-9));
    if (n > 1) glueUps.push(x.id);
    const arr = cutsBy.get(b.nominal) ?? [];
    for (let i = 0; i < n; i++) arr.push({ partNo: partKey(x), id: x.id, widthIn: d.w / n, lengthIn: d.l, ...(n > 1 ? { glueUp: true } : {}) });
    cutsBy.set(b.nominal, arr);
  }
  const resaw = planResaw(parts, p);
  const stripNet = new Map<string, number>();
  const resawBoards = new Map<string, OakThickness['resawBoards']>();
  const resawBf = new Map<string, number>();
  const stripCount = new Map<string, number>();
  resaw.forEach((pool, i) => {
    const b = boardByNominal(pool.board);
    for (const layer of pool.layerStrips) {
      for (const s of layer) stripNet.set(pool.board, (stripNet.get(pool.board) ?? 0) + (b.nominalIn / pool.stripsPerBoard * s.widthIn * s.lengthIn) / 144);
    }
    stripCount.set(pool.board, (stripCount.get(pool.board) ?? 0) + pool.strips);
    (resawBoards.get(pool.board) ?? resawBoards.set(pool.board, []).get(pool.board)!).push({ lengthIn: pool.boardLengthIn, count: pool.boards, pool: i });
    resawBf.set(pool.board, (resawBf.get(pool.board) ?? 0) + pool.boardFeet);
  });

  const thicknesses: OakThickness[] = [];
  for (const b of BOARD_THICKNESSES) {
    const cuts = cutsBy.get(b.nominal) ?? [];
    const rb = resawBoards.get(b.nominal) ?? [];
    if (!cuts.length && !rb.length) continue;
    const boards = planBoards(cuts, b.nominal, kerf);
    const solidNetBf = netSolid.get(b.nominal) ?? 0, stripNetBf = stripNet.get(b.nominal) ?? 0;
    const netBf = solidNetBf + stripNetBf;
    const plannedBf = boards.reduce((a, q) => a + boardBf(q), 0) + (resawBf.get(b.nominal) ?? 0);
    const allowanceBf = netBf * (1 + p.oakWasteAllowance);
    const tally = new Map<number, number>();
    for (const q of boards) tally.set(q.lengthIn, (tally.get(q.lengthIn) ?? 0) + 1);
    const summary = [...tally.entries()].sort((a, c) => a[0] - c[0]).map(([l, n]) => `${n} x ${b.nominal} x ${BOARD_WIDTH_IN}" x ${lenFt(l)}`);
    for (const r of rb) summary.push(`${r.count} x ${b.nominal} x ${BOARD_WIDTH_IN}" x ${lenFt(r.lengthIn)} (resaw into laminate strips)`);
    thicknesses.push({
      board: b.nominal, nominalIn: b.nominalIn, usableIn: b.usableIn, pieces: (pieces.get(b.nominal) ?? 0) + (stripCount.get(b.nominal) ?? 0),
      solidNetBf, stripNetBf, netBf, allowanceBf, plannedBf, purchaseBf: allowanceBf, boards, resawBoards: rb, summary,
    });
  }
  const sum = (f: (t: OakThickness) => number): number => thicknesses.reduce((a, t) => a + f(t), 0);
  return {
    thicknesses, wasteAllowance: p.oakWasteAllowance, netBf: sum((t) => t.netBf), allowanceBf: sum((t) => t.allowanceBf),
    purchaseBf: sum((t) => t.purchaseBf), resaw, glueUps,
  };
}
