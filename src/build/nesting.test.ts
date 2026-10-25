import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { BOARD_THICKNESSES, BOARD_WIDTH_IN, boardByNominal, isBuilt, partKey, planOakPart } from './cutlist';
import { nestPlywood, oakBoardFeet, SHEET_LENGTH_IN, SHEET_WIDTH_IN } from './nesting';
import { OAK_STOCKED } from './prices';

const p = defaultParams();
const parts = buildModel(p);
const nest = nestPlywood(parts, p);

const bbox = (pts: Array<[number, number]>) => ({
  x0: Math.min(...pts.map((q) => q[0])), x1: Math.max(...pts.map((q) => q[0])),
  y0: Math.min(...pts.map((q) => q[1])), y1: Math.max(...pts.map((q) => q[1])),
});

describe('nestPlywood', () => {
  it('places every sheet part on one sheet per thickness', () => {
    expect(nest.unplaced).toEqual([]);
    expect(nest.sheets.map((s) => s.label)).toEqual(['5 mm white oak plywood', '13 mm okoume']); // (2026-10-24: 13 mm deck, 5 mm combi-core white oak sides as bought.) D-73, D-80: on follow-the-weather the thin sheet is the 6 mm Baltic birch (Standard) or '6 mm okoume' (Extreme)
    const ply = parts.filter((x) => isBuilt(x) && x.kind === 'sheet').map((x) => x.id).sort();
    expect(nest.sheets.flatMap((s) => s.placements.map((q) => q.partId)).sort()).toEqual(ply);
    for (const s of nest.sheets) { expect(s.widthIn).toBe(SHEET_WIDTH_IN); expect(s.lengthIn).toBe(SHEET_LENGTH_IN); }
  });

  it('puts the seat back on the deck sheet beside the deck', () => {
    const deckSheet = nest.sheets.find((s) => s.placements.some((q) => q.partId === 'deck'))!; // (2026-10-24: the 13 mm deck as bought; it was the 12 mm sheet)
    const ids = deckSheet.placements.map((q) => q.partId);
    expect(ids).toContain('seat-back-panel');
    expect(ids).toContain('deck');
    expect(nest.sheets.find((s) => s.thicknessMm === 5)!.placements.map((q) => q.partId)).not.toContain('seat-back-panel');
  });

  it('keeps every outline inside the sheet margin and every pair of parts a kerf apart', () => {
    const k = nest.kerfIn;
    for (const s of nest.sheets) {
      const boxes = s.placements.map((q) => ({ id: q.partId, ...bbox(q.outer) }));
      for (const b of boxes) {
        expect(b.x0, b.id).toBeGreaterThanOrEqual(k - 1e-6);
        expect(b.y0, b.id).toBeGreaterThanOrEqual(k - 1e-6);
        expect(b.x1, b.id).toBeLessThanOrEqual(SHEET_LENGTH_IN - k + 1e-6);
        expect(b.y1, b.id).toBeLessThanOrEqual(SHEET_WIDTH_IN - k + 1e-6);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const gapX = Math.max(a.x0 - b.x1, b.x0 - a.x1), gapY = Math.max(a.y0 - b.y1, b.y0 - a.y1);
          expect(Math.max(gapX, gapY), `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(k - 1e-6);
        }
      }
      // holes stay inside their outline's box
      for (const q of s.placements) {
        const o = bbox(q.outer);
        for (const h of q.holes) { const hb = bbox(h); expect(hb.x0).toBeGreaterThan(o.x0); expect(hb.x1).toBeLessThan(o.x1); }
      }
    }
  });

  it('runs the long webs and the deck lengthwise and reports no turned grain at the defaults', () => {
    const s4 = nest.sheets.find((s) => s.thicknessMm === 5)!; // the 5 mm white oak plywood sheet (2026-10-24: as bought; the 6 mm class on follow-the-weather)
    for (const id of ['side-L-web', 'side-R-web']) {
      const q = s4.placements.find((x) => x.partId === id)!;
      expect(q.widthIn).toBeGreaterThan(q.heightIn * 3);
      expect(q.turned).toBe(false);
    }
    expect(nest.grainTurned).toEqual([]);
  });

  it('reports a utilization and an offcut for each sheet', () => {
    for (const s of nest.sheets) {
      expect(s.utilizationPct).toBeGreaterThan(5);
      expect(s.utilizationPct).toBeLessThan(100);
      expect(s.offcut.areaIn2 + s.usedAreaIn2).toBeCloseTo(SHEET_LENGTH_IN * SHEET_WIDTH_IN, 3);
      expect(s.offcut.largest.widthIn * s.offcut.largest.heightIn).toBeGreaterThan(500);
    }
  });

  it('follows the nest kerf param', () => {
    const wide = nestPlywood(parts, { ...p, nestKerfIn: 1 });
    expect(wide.unplaced).toEqual([]);
    const b = bbox(wide.sheets[0].placements[0].outer);
    expect(b.x0).toBeGreaterThanOrEqual(1 - 1e-6);
  });
});

describe('oakBoardFeet', () => {
  const oak = oakBoardFeet(parts, p);

  it('is positive and equals the rough volumes on nominal thickness', () => {
    let solid = 0;
    for (const x of parts.filter((q) => isBuilt(q) && /oak/i.test(q.material) && q.kind === 'lumber' && q.plies === undefined)) {
      // the cuts are the boards of an edge-glued panel and the layers of a laminated part, each at its own rough size (rounded UP to 1/8)
      const plan = planOakPart(x, p);
      for (const pc of plan.pieces) {
        // a part no stocked board finishes to (12/4 is not bought, D-70) is face-laminated: each layer counts at its own board's nominal thickness
        const b0 = boardByNominal(pc.board);
        // a thin bucket cut from the offcuts of a thicker board counts at the thicker board's nominal thickness
        const to = oak.consolidated.find((c) => c.from === b0.nominal && c.partNos.includes(partKey(x)))?.to ?? oak.folded.find((c) => c.from === b0.nominal && c.ids.includes(x.id))?.to;
        const b = to ? boardByNominal(to) : b0;
        solid += (b.nominalIn * pc.rough.w * pc.rough.l) / 144;
      }
    }
    expect(oak.netBf).toBeGreaterThan(10);
    expect(oak.thicknesses.reduce((a, t) => a + t.solidNetBf, 0)).toBeCloseTo(solid, 6);
    expect(oak.allowanceBf).toBeCloseTo(oak.netBf * (1 + p.oakWasteAllowance), 6);
    for (const t of oak.thicknesses) expect(t.netBf).toBeGreaterThan(0);
  });

  it('plans every solid piece onto a board at most 6" wide and 10 ft long', () => {
    const planned = new Set<string>();
    for (const t of oak.thicknesses) {
      for (const b of t.boards) {
        expect(b.lanes.reduce((a, l) => a + l.widthIn, 0)).toBeLessThanOrEqual(BOARD_WIDTH_IN + 1e-6);
        for (const l of b.lanes) {
          expect(l.usedIn - p.resawKerfIn).toBeLessThanOrEqual(b.lengthIn + 1e-6);
          for (const c of l.cuts) { planned.add(c.id); expect(c.widthIn).toBeLessThanOrEqual(l.widthIn + 1e-9); }
        }
        expect([72, 96, 120]).toContain(b.lengthIn);
      }
    }
    const solid = parts.filter((x) => isBuilt(x) && /oak/i.test(x.material) && x.kind === 'lumber' && x.plies === undefined).map((x) => x.id);
    expect([...planned].sort()).toEqual([...solid].sort());
    expect(oak.glueUps).toContain('transom-rear');
  });

  it('buys at least the net volume and includes the 6 ft board for the 60" bands', () => {
    for (const t of oak.thicknesses) { expect(t.plannedBf).toBeGreaterThan(0); expect(t.purchaseBf).toBeGreaterThanOrEqual(t.netBf); }
    expect(oak.resaw.every((r) => r.boardLengthIn >= 72)).toBe(true);
    expect(BOARD_THICKNESSES.map((b) => b.nominal)).toContain(oak.resaw[0].board);
  });

  it('cuts a solid bucket under 1 bf from the offcuts of a thicker board instead of buying a thin board for it (and says so)', () => {
    // Only 4/4 and 5/4 are bought (D-79) and no bucket is under 1 bf at the defaults, so stock 8/4 again and keep a few oak parts: the 4/4 joists are then a small bucket cut from a thicker board's offcuts.
    const saved = { ...OAK_STOCKED };
    OAK_STOCKED['8/4'] = true;
    try {
      const isOak = (x: { material: string; kind: string; plies?: number }): boolean => /oak/i.test(x.material) && x.kind === 'lumber' && x.plies === undefined;
      const keep = new Set(['king-beam', 'bridle-tongue', 'joist-2', 'joist-3', 'joist-4', 'seat-hinge-backer-L']);
      const small = parts.filter((x) => !isBuilt(x) || !isOak(x) || keep.has(x.id));
      const o = oakBoardFeet(small, p);
      expect(o.consolidated.length).toBeGreaterThan(0);
      for (const c of o.consolidated) {
        const from = o.thicknesses.find((t) => t.board === c.from);
        expect(c.netBf).toBeLessThan(1.5); // about a board foot (counted on the thicker board's nominal thickness)
        expect(from?.boards ?? []).toEqual([]); // no solid board of the thin thickness is planned
        if (from) expect(from.movedOut).toBe(c.to); // a thickness left with nothing (no solids, no resaw) has no row at all
        const to = o.thicknesses.find((t) => t.board === c.to);
        if (to) {
          expect(to.movedIn?.partNos).toEqual(c.partNos);
          expect(to.summary.join(' ')).toMatch(new RegExp(`cut the ${c.from} parts`));
        }
      }
    } finally {
      Object.assign(OAK_STOCKED, saved);
    }
    // the BOM buys whole boards: the lumber is the planned board feet
    for (const t of oak.thicknesses) expect(t.purchaseBf).toBeCloseTo(t.plannedBf, 9);
  });

  it('leaves no nearly empty board: a last board with a single short lane is folded into the free lanes of thicker boards (build review: the third 4/4 board)', () => {
    const util = (b: { lengthIn: number; lanes: Array<{ widthIn: number; usedIn: number }> }): number => b.lanes.reduce((a, l) => a + l.widthIn * (l.usedIn - p.resawKerfIn), 0) / (BOARD_WIDTH_IN * b.lengthIn);
    // (8/4 is exempt: D-95 puts the two small blocks, the seat back stops and crossmember 6, on a short 6 ft board of their own)
    for (const t of oak.thicknesses) if (t.board !== '8/4') for (const b of t.boards) expect(util(b), `${t.board} ${b.lengthIn / 12} ft`).toBeGreaterThan(0.4);
    const t44 = oak.thicknesses.find((t) => t.board === '4/4')!;
    expect(t44.boards.length).toBeLessThanOrEqual(5); // D-79: with only 4/4 and 5/4 bought, the layers of the face-laminated parts (D-70) take most of the 4/4 boards (5 of 10 ft at the defaults)
    // (at the defaults the +1 in / +2 in length allowances leave nothing to fold; the checks below run on whatever did fold)
    // each folded piece is planned once, in a lane of a thicker board that is at least as wide, and marked with the thickness it would have been bought as
    const seen = new Map<string, number>();
    for (const t of oak.thicknesses) for (const b of t.boards) for (const l of b.lanes) for (const c of l.cuts) if (!c.glueUp) seen.set(`${c.id}#${c.layer ?? 0}`, (seen.get(`${c.id}#${c.layer ?? 0}`) ?? 0) + 1);
    for (const n of seen.values()) expect(n).toBe(1);
    for (const f of oak.folded) {
      const host = oak.thicknesses.find((t) => t.board === f.to)!;
      expect(boardByNominal(f.to).nominalIn).toBeGreaterThan(boardByNominal(f.from).nominalIn);
      const placed = host.boards.flatMap((b) => b.lanes.flatMap((l) => l.cuts.map((c) => ({ c, l }))));
      for (const id of f.ids) {
        // a laminated part has cuts of several boards (the beam: an 8/4 layer and a 4/4 layer), so look for the moved one by its mark
        const hit = placed.find((q) => q.c.id === id && q.c.fromBoard === f.from);
        expect(hit, id).toBeDefined();
        expect(hit!.c.widthIn).toBeLessThanOrEqual(hit!.l.widthIn + 1e-9);
      }
      expect(host.foldedIn?.some((q) => q.from === f.from && q.partNos.join() === f.partNos.join())).toBe(true);
      expect(host.summary.join(' ')).toMatch(new RegExp(`also cut the ${f.from} parts`));
    }
  });

  it('reports the resaw boards with the strips each yields and the spares', () => {
    for (const pool of oak.resaw) {
      const t = oak.thicknesses.find((q) => q.board === pool.board)!;
      const r = t.resawBoards.find((q) => q.pool === oak.resaw.indexOf(pool))!;
      expect(r.count).toBe(pool.boards);
      expect(r.widthIn).toBe(pool.boardWidthIn);
      expect(r.strips).toBe(pool.strips);
      expect(r.spares).toBe(pool.spares);
      expect(r.yieldPerBoard).toBe(pool.yieldPerBoard);
      expect(t.summary.join(' ')).toContain(`${pool.strips} needed, ${pool.yieldPerBoard} per board, ${pool.spares} spare`);
      expect(t.plannedBf).toBeGreaterThanOrEqual(pool.boardFeet - 1e-9);
    }
  });

  it('scales the allowance with the waste param', () => {
    const more = oakBoardFeet(parts, { ...p, oakWasteAllowance: 0.5 });
    expect(more.allowanceBf).toBeGreaterThan(oak.allowanceBf);
  });
});

describe('oakBoardFeet: face-laminated parts (D-70)', () => {
  const oak = oakBoardFeet(parts, p);

  it('buys no 6/4 or 12/4 (D-79, D-95): the axle beams, brake knees and chocks take their layers from the 4/4 boards (D-74: 3 x 3/4), and the solid blocks up to 1-3/4" come from 8/4', () => {
    expect(oak.thicknesses.map((t) => t.board)).toEqual(['4/4', '5/4', '8/4']);
    expect(oak.laminated.map((q) => q.id).sort()).toEqual(['beam-F', 'beam-R', 'brake-chock-L', 'brake-chock-R', 'brake-knee-L', 'brake-knee-R']);
    const layerCuts = oak.thicknesses.flatMap((t) => t.boards.flatMap((b) => b.lanes.flatMap((l) => l.cuts.map((c) => ({ c, board: t.board })))))
      .filter((q) => q.c.layer !== undefined);
    // every part 3 layers of 4/4 (D-74); knees 1 + 2 + 1 pieces (the upright layers are one piece each); chocks 3 layers x 1 piece (a 3.5" wide chock fits a board)
    expect(layerCuts.filter((q) => q.c.id === 'beam-F')).toHaveLength(3);
    expect(layerCuts.filter((q) => q.c.id === 'beam-R')).toHaveLength(3);
    expect(layerCuts.filter((q) => q.c.id === 'brake-knee-L')).toHaveLength(4); // D-77: upright / across / upright = 1 + 2 + 1 pieces
    for (const q of layerCuts) expect(q.c.layers, q.c.id).toBe(oak.laminated.find((l) => l.id === q.c.id)!.lamination.layers.length);
    // every layer is cut from its own board (or from the free lane of a thicker board it was folded into)
    for (const q of layerCuts) {
      const lam = oak.laminated.find((l) => l.id === q.c.id)!.lamination;
      const want = lam.layers[q.c.layer! - 1].board;
      expect(q.board === want || q.c.fromBoard === want, `${q.c.id} layer ${q.c.layer}`).toBe(true);
    }
    const t44 = oak.thicknesses.find((t) => t.board === '4/4')!;
    for (const no of ['brake-chock', 'brake-knee', 'beam-F', 'beam-R']) expect(t44.layersIn!.partNos).toContain(no);
    expect(t44.summary.join(' ')).toMatch(/layer pieces for the face-laminated parts/);
    expect(oak.thicknesses.some((t) => t.board === '8/4' && t.layersIn?.partNos.includes('beam-F'))).toBe(false); // the beams are 3 x 4/4 now
  });

  it('counts the layers in the board feet at the nominal thickness of each layer\'s board', () => {
    const beam = parts.find((x) => x.id === 'beam-R')!;
    const lam = oak.laminated.find((q) => q.id === 'beam-R')!.lamination;
    expect(lam.layers.map((l) => l.board)).toEqual(['4/4', '4/4', '4/4']);
    // three 4/4 layers, each the stock width + 3/8 (rounded up to 1/8) by the stock length + 2 in (rounded up to 1/8)
    const w = Math.ceil((beam.stock!.w + p.laminateWidthAllowanceIn) * 8 - 1e-9) / 8, l = Math.ceil((beam.stock!.l + p.laminateLengthAllowanceIn) * 8 - 1e-9) / 8;
    const cuts = oak.thicknesses.flatMap((t) => t.boards.flatMap((b) => b.lanes.flatMap((ln) => ln.cuts))).filter((c) => c.id === 'beam-R');
    expect(cuts).toHaveLength(3);
    for (const c of cuts) { expect(c.widthIn).toBeCloseTo(w, 9); expect(c.lengthIn).toBeCloseTo(l, 9); }
    const nominal = lam.layers.reduce((a, q) => a + boardByNominal(q.board).nominalIn, 0);
    expect(nominal * w * l / 144).toBeCloseTo(3 * 2.625 * 29.5 / 144, 6); // 1 + 1 + 1 inches of nominal thickness
  });

  it('keeps a laminated part wider than a board in the glue-up list', () => {
    expect(oak.glueUps).toContain('brake-knee-L');
    expect(oak.glueUps).not.toContain('beam-F');
  });
});

describe('oakBoardFeet: the board plan uses the actual cuts (Eric 2026-10-12)', () => {
  const oak = oakBoardFeet(parts, p);
  const cuts = oak.thicknesses.flatMap((t) => t.boards.flatMap((b) => b.lanes.flatMap((l) => l.cuts)));
  const eighth = (v: number): boolean => Math.abs(v * 8 - Math.round(v * 8)) < 1e-9;

  it('plans the boards of an edge-glued panel as separate cuts, not the glued width', () => {
    const t = cuts.filter((c) => c.id === 'transom-rear');
    expect(t).toHaveLength(3);
    expect(t.map((c) => c.index).sort()).toEqual([1, 2, 3]);
    for (const c of t) { expect(c.of).toBe(3); expect(c.piece).toBe('board'); expect(c.glueUp).toBe(true); expect(c.widthIn).toBeLessThanOrEqual(BOARD_WIDTH_IN); }
    expect(t[0].widthIn).toBeCloseTo(5.875, 9); // 16-3/8 / 3 = 5.458 + 3/8, rounded up to 1/8
  });

  it('cuts every board and layer at a rough width and length rounded UP to 1/8', () => {
    expect(cuts.length).toBeGreaterThan(40);
    for (const c of cuts) { expect(eighth(c.widthIn), `${c.id} w ${c.widthIn}`).toBe(true); expect(eighth(c.lengthIn), `${c.id} l ${c.lengthIn}`).toBe(true); }
  });
});

describe('oakBoardFeet: the shopping list by width (linear feet at a whole-inch width)', () => {
  const o = oakBoardFeet(parts, p);
  it('lists whole-inch widths, narrowest first, in half-foot lengths', () => {
    for (const t of o.thicknesses) {
      expect(t.byWidth.length, t.board).toBeGreaterThan(0);
      const w = t.byWidth.map((q) => q.widthIn);
      expect(w, t.board).toEqual([...w].sort((a, b) => a - b));
      for (const q of t.byWidth) { expect(Number.isInteger(q.widthIn), `${t.board} ${q.widthIn}`).toBe(true); expect(q.linearFt * 2, `${t.board} ${q.widthIn}`).toBeCloseTo(Math.round(q.linearFt * 2), 9); }
    }
  });
  it('rounds each piece up to the next whole inch and counts every cut and every resaw board once', () => {
    for (const t of o.thicknesses) {
      const cuts = t.boards.flatMap((b) => b.lanes.flatMap((l) => l.cuts));
      for (const c of cuts) expect(t.byWidth.some((q) => q.widthIn === Math.ceil(c.widthIn - 1e-9)), `${t.board} ${c.partNo} ${c.widthIn}`).toBe(true);
      expect(t.byWidth.reduce((a, q) => a + q.pieces, 0), t.board).toBe(cuts.length + t.resawBoards.reduce((a, r) => a + r.count, 0));
      // never less than the cut lengths themselves
      const need = cuts.reduce((a, c) => a + c.lengthIn, 0) / 12 + t.resawBoards.reduce((a, r) => a + (r.lengthIn * r.count) / 12, 0);
      expect(t.byWidth.reduce((a, q) => a + q.linearFt, 0), t.board).toBeGreaterThanOrEqual(need - 1e-9);
    }
  });
  it('gives the longest piece at each width, never more than the total and at least as long as every piece in the line', () => {
    for (const t of o.thicknesses) {
      const cuts = t.boards.flatMap((b) => b.lanes.flatMap((l) => l.cuts));
      for (const q of t.byWidth) {
        expect(q.longestFt, `${t.board} ${q.widthIn}`).toBeLessThanOrEqual(q.linearFt);
        const lens = [...cuts.filter((c) => Math.ceil(c.widthIn - 1e-9) === q.widthIn).map((c) => c.lengthIn), ...t.resawBoards.filter((r) => r.widthIn === q.widthIn).map((r) => r.lengthIn)];
        expect(q.longestFt * 12, `${t.board} ${q.widthIn}`).toBeGreaterThanOrEqual(Math.max(...lens) - 1e-9);
      }
    }
  });
  it('rounds 2-1/2" and 2-3/4" pieces up to a 3" line', () => {
    const t = o.thicknesses.find((q) => q.board === '4/4')!;
    const ws = t.boards.flatMap((b) => b.lanes.flatMap((l) => l.cuts.map((c) => c.widthIn))).filter((w) => w > 2 && w <= 3);
    expect(ws.length).toBeGreaterThan(0);
    expect(t.byWidth.find((q) => q.widthIn === 3)).toBeDefined();
    expect(t.byWidth.find((q) => q.widthIn === 2.5)).toBeUndefined();
  });
});
