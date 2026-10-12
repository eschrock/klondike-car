import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { BOARD_THICKNESSES, BOARD_WIDTH_IN, boardByNominal, boardForThickness, isBuilt, partKey } from './cutlist';
import { nestPlywood, oakBoardFeet, SHEET_LENGTH_IN, SHEET_WIDTH_IN } from './nesting';

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
    expect(nest.sheets.map((s) => s.label)).toEqual(['4 mm okoume', '12 mm okoume']);
    const ply = parts.filter((x) => isBuilt(x) && x.kind === 'sheet').map((x) => x.id).sort();
    expect(nest.sheets.flatMap((s) => s.placements.map((q) => q.partId)).sort()).toEqual(ply);
    for (const s of nest.sheets) { expect(s.widthIn).toBe(SHEET_WIDTH_IN); expect(s.lengthIn).toBe(SHEET_LENGTH_IN); }
  });

  it('puts the seat back on the 12 mm sheet beside the deck', () => {
    const s12 = nest.sheets.find((s) => s.thicknessMm === 12)!;
    const ids = s12.placements.map((q) => q.partId);
    expect(ids).toContain('seat-back-panel');
    expect(ids).toContain('deck');
    expect(nest.sheets.find((s) => s.thicknessMm === 4)!.placements.map((q) => q.partId)).not.toContain('seat-back-panel');
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
    const s4 = nest.sheets.find((s) => s.thicknessMm === 4)!;
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
      const r = x.rough!;
      const d = [r.t, r.w, r.l].sort((a, b) => a - b);
      const b0 = boardForThickness(d[0])!;
      // a thin bucket cut from the offcuts of a thicker board counts at the thicker board's nominal thickness
      const to = oak.consolidated.find((c) => c.from === b0.nominal && c.partNos.includes(partKey(x)))?.to ?? oak.folded.find((c) => c.from === b0.nominal && c.ids.includes(x.id))?.to;
      const b = to ? boardByNominal(to) : b0;
      solid += (b.nominalIn * d[1] * d[2]) / 144;
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
    // At the defaults every bucket is over 1 bf; thin the 8/4 bucket down to the king beam alone (about 0.6 bf) by dropping the bulkhead and the tongue.
    const thin = parts.filter((x) => !/^(bow-bulkhead|bridle-tongue)$/.test(x.id));
    const oakThin = oakBoardFeet(thin, p);
    expect(oakThin.consolidated.length).toBeGreaterThan(0);
    for (const o of [oak, oakThin]) for (const c of o.consolidated) {
      const oak = o;
      const from = oak.thicknesses.find((t) => t.board === c.from);
      const to = oak.thicknesses.find((t) => t.board === c.to)!;
      expect(c.netBf).toBeLessThan(1.5); // about a board foot (counted on the thicker board's nominal thickness)
      expect(from?.boards ?? []).toEqual([]); // no solid board of the thin thickness is planned
      if (from) expect(from.movedOut).toBe(c.to); // a thickness left with nothing (no solids, no resaw) has no row at all
      expect(to.movedIn?.partNos).toEqual(c.partNos);
      expect(to.summary.join(' ')).toMatch(new RegExp(`cut the ${c.from} parts`));
      const planned = to.boards.flatMap((b) => b.lanes.flatMap((l) => l.cuts.map((q) => q.partNo)));
      for (const no of c.partNos) expect(planned, no).toContain(no);
    }
    // the BOM buys whole boards: the lumber is the planned board feet
    for (const t of oak.thicknesses) expect(t.purchaseBf).toBeCloseTo(t.plannedBf, 9);
  });

  it('leaves no nearly empty board: a last board with a single short lane is folded into the free lanes of thicker boards (build review: the third 4/4 board)', () => {
    const util = (b: { lengthIn: number; lanes: Array<{ widthIn: number; usedIn: number }> }): number => b.lanes.reduce((a, l) => a + l.widthIn * (l.usedIn - p.resawKerfIn), 0) / (BOARD_WIDTH_IN * b.lengthIn);
    for (const t of oak.thicknesses) for (const b of t.boards) expect(util(b), `${t.board} ${b.lengthIn / 12} ft`).toBeGreaterThan(0.4);
    const t44 = oak.thicknesses.find((t) => t.board === '4/4')!;
    expect(t44.boards.length).toBeLessThanOrEqual(2);
    expect(oak.folded.length).toBeGreaterThan(0);
    // each folded piece is planned once, in a lane of a thicker board that is at least as wide, and marked with the thickness it would have been bought as
    const seen = new Map<string, number>();
    for (const t of oak.thicknesses) for (const b of t.boards) for (const l of b.lanes) for (const c of l.cuts) if (!c.glueUp) seen.set(c.id, (seen.get(c.id) ?? 0) + 1);
    for (const n of seen.values()) expect(n).toBe(1);
    for (const f of oak.folded) {
      const host = oak.thicknesses.find((t) => t.board === f.to)!;
      expect(boardByNominal(f.to).nominalIn).toBeGreaterThan(boardByNominal(f.from).nominalIn);
      const placed = host.boards.flatMap((b) => b.lanes.flatMap((l) => l.cuts.map((c) => ({ c, l }))));
      for (const id of f.ids) {
        const hit = placed.find((q) => q.c.id === id);
        expect(hit, id).toBeDefined();
        expect(hit!.c.fromBoard).toBe(f.from);
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
