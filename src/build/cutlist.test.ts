import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { PRE_D72 } from '../test-fixtures';
import { isOakStocked } from './prices';
import { assemblySteps } from './assembly';
import { BOARD_THICKNESSES, MAX_LAMINATION_LAYERS, boardFinishedIn, finalFrac, roughFrac, RESAW_BOARD_WIDTHS_IN, RESAW_MIN_SPARES, boardByNominal, boardForThickness, cutList, fabText, isBuilt, laminationText, makeLanes, packLanes, planLamination, stepMapOf, resawUsableIn, spareSlots, stripsPerBoard, toCsv } from './cutlist';

// D-72/D-73: this file's resaw and sheet numbers (0.234 in bands in 0.359 -> 3/8 in rough pools, the 4 mm sheet, the tube) are the 4 mm okoume design: PRE_D72. The white oak / rod cut list is in d72.test.ts.
const p = { ...defaultParams(), ...PRE_D72 };
const parts = buildModel(p);
const cl = cutList(parts, p);

describe('toCsv', () => {
  it('quotes per RFC 4180', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"', 'x\ny', 3, undefined]])).toBe('a,"b,c","say ""hi""","x\ny",3,\r\n');
  });
});

describe('board thickness map', () => {
  it('maps a FINAL thickness to the smallest STOCKED board whose reliable finished thickness holds it (D-79: only 4/4 gives 3/4" and 5/4 gives 1" are bought)', () => {
    expect(boardForThickness(0.5)!.nominal).toBe('4/4');
    expect(boardForThickness(0.75)!.nominal).toBe('4/4');
    expect(boardForThickness(0.7501 + 0.0625)!.nominal).toBe('5/4'); // a 7/8" part needs 5/4: 4/4 gives 3/4"
    expect(boardForThickness(0.875)!.nominal).toBe('5/4');
    expect(boardForThickness(1)!.nominal).toBe('5/4');
    expect(boardForThickness(1.25)).toBeNull(); // 6/4 is not on Peach State's list and 8/4 is not bought: thicker than 5/4 means face-laminated (D-70)
    expect(boardForThickness(1.746)).toBeNull(); // the king beam: two 5/4 layers
    expect(boardForThickness(1.76)).toBeNull();
    expect(boardForThickness(2.25)).toBeNull();
    expect(boardForThickness(9)).toBeNull();
  });
  it('reads the yields from the params (the live value wins over the default)', () => {
    expect(boardForThickness(0.8, { ...p, boardYield44In: 0.8125 })!.nominal).toBe('4/4');
    expect(boardForThickness(0.8, p)!.nominal).toBe('5/4');
    expect(Object.fromEntries(BOARD_THICKNESSES.map((b) => [b.nominal, boardFinishedIn(b, p)]))).toEqual({ '4/4': 0.75, '5/4': 1, '6/4': 1.25, '8/4': 1.75, '12/4': 2.75, '16/4': 3.75 });
  });
  it('lists the spec thicknesses', () => {
    const usable = Object.fromEntries(BOARD_THICKNESSES.map((b) => [b.nominal, b.usableIn]));
    // the legacy "rough part a board yields" figure is kept for the data shape
    expect(usable['4/4']).toBeCloseTo(13 / 16 + 1 / 8);
    expect(usable['8/4']).toBeCloseTo(1.75 + 1 / 8);
    expect(usable['12/4']).toBeCloseTo(2.75 + 1 / 8);
    for (const b of BOARD_THICKNESSES) expect(b.usableIn).toBeLessThanOrEqual(b.nominalIn - 1 / 16 + 1e-9);
    // the finished yield is always a quarter inch under the nominal and on the 1/16 grid
    for (const b of BOARD_THICKNESSES) { expect(boardFinishedIn(b, p)).toBeCloseTo(b.nominalIn - 0.25, 9); expect(Math.abs(boardFinishedIn(b, p) * 16 - Math.round(boardFinishedIn(b, p) * 16))).toBeLessThan(1e-9); }
  });
});

describe('cutList', () => {
  const ids = (xs: Array<{ ids: string[] }>): string[] => xs.flatMap((x) => x.ids);

  it('puts every solid oak part in exactly one oak row, in a board whose reliable finished thickness holds its FINAL thickness', () => {
    const oakIds = parts.filter((x) => isBuilt(x) && /oak/i.test(x.material) && (x.kind === 'lumber' || x.kind === 'bentlam')).map((x) => x.id).sort();
    const listed = cl.oak.flatMap((g) => ids(g.rows)).sort();
    expect(listed).toEqual(oakIds);
    expect(oakIds.length).toBeGreaterThanOrEqual(60);
    for (const g of cl.oak) {
      if (g.board === 'resawn' || g.board === 'laminated') continue;
      for (const r of g.rows) { expect(r.stock.t, r.partNo).toBeLessThanOrEqual(g.finishedIn + 1e-6); expect(r.rough.t, r.partNo).toBeLessThanOrEqual(g.nominalIn + 1e-6); }
    }
  });

  it('aggregates identical pieces by part number', () => {
    const joist = cl.oak.flatMap((g) => g.rows).filter((r) => r.partNo === 'joist');
    expect(joist.reduce((a, r) => a + r.qty, 0)).toBe(6);
    const qty = cl.oak.flatMap((g) => g.rows).reduce((a, r) => a + r.qty, 0);
    expect(qty).toBe(cl.oak.reduce((a, g) => a + g.pieces, 0));
  });

  it('lists 4 rail strips and 8 band strips, with a resaw board that yields at least one', () => {
    const rail = cl.strips.find((r) => r.partNo === 'rail')!;
    expect(rail.plies).toBe(2);
    expect(rail.strips).toBe(4);
    const bands = cl.strips.filter((r) => /^side-(chine|gunwale)/.test(r.partNo));
    expect(bands.reduce((a, r) => a + r.strips, 0)).toBe(8);
    expect(bands[0].stock.t).toBeCloseTo(0.234, 3);
    expect(cl.resaw.length).toBe(2);
    for (const pool of cl.resaw) {
      expect(pool.stripsPerBoard).toBeGreaterThanOrEqual(1);
      expect(pool.lanes * pool.stripsPerBoard).toBeGreaterThanOrEqual(pool.strips);
      expect(pool.laneStrips.flat().length).toBe(pool.strips);
      for (const lane of pool.laneStrips) expect(lane.length).toBeLessThanOrEqual(pool.stripsPerBoard);
      // rip first: the lanes (each as wide as its widest strip, plus a kerf) fit across the bought boards
      const laneW = pool.laneStrips.map((l) => Math.max(...l.map((s) => s.widthIn)) + p.resawKerfIn);
      expect(laneW.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(pool.boards * (pool.boardWidthIn + p.resawKerfIn) + 1e-9);
    }
  });

  it('counts resaw yield with the kerf', () => {
    expect(stripsPerBoard(0.375, 1.75, 0.125)).toBe(3);
    expect(stripsPerBoard(0.375, 13 / 16, 0.125)).toBe(1);
    expect(stripsPerBoard(0.375, 1.75, 0.0625)).toBeGreaterThanOrEqual(4);
  });

  it('resaws from the ROUGH board: the 0.5 in rail strips come two to a 5/4 board (2 x 0.5 + kerf in 1.25), not four to a 12/4', () => {
    const b54 = boardByNominal('5/4');
    expect(resawUsableIn(b54, p)).toBeCloseTo(1.25 - p.millingAllowanceIn, 9);
    // the realistic rough board: the reliable finished thickness plus the planing allowance (Eric 2026-10-13), never the full nominal
    for (const b of BOARD_THICKNESSES) expect(resawUsableIn(b, p)).toBeLessThanOrEqual(boardFinishedIn(b, p) + p.millingAllowanceIn + 1e-9);
    expect(resawUsableIn(b54, { ...p, boardYield54In: 0.875 })).toBeCloseTo(0.875 + p.millingAllowanceIn, 9);
    expect(stripsPerBoard(0.5, resawUsableIn(b54, p), p.resawKerfIn)).toBe(2);
    expect(stripsPerBoard(0.5, resawUsableIn(boardByNominal('12/4'), p), p.resawKerfIn)).toBe(4);
    const rails = cl.resaw.find((r) => Math.abs(r.roughT - 0.5) < 1e-6)!;
    expect(rails.strips).toBe(4);
    expect(rails.boardFeet).toBeLessThan(9); // the 12/4 route was 9 bf
    expect(cl.strips.find((r) => r.partNo === 'rail')!.resawFrom).toBe(rails.board);
    // no resaw pool is sawn from a board that yields fewer strips than a thinner board would for fewer board feet
    for (const pool of cl.resaw) expect(pool.yieldByBoard[pool.board]).toBe(pool.stripsPerBoard);
  });

  it('keeps the strip counts honest against the realistic rough board: every slab plus its kerf fits, and each strip has its planing allowance inside its slab', () => {
    for (const pool of cl.resaw) {
      const b = boardByNominal(pool.board), k = pool.stripsPerBoard;
      expect(k * pool.roughT + (k - 1) * p.resawKerfIn, pool.board).toBeLessThanOrEqual(resawUsableIn(b, p) + 1e-9);
      expect(k * pool.roughT + (k - 1) * p.resawKerfIn, pool.board).toBeLessThanOrEqual(boardFinishedIn(b, p) + p.millingAllowanceIn + 1e-9);
    }
    for (const r of cl.strips) expect(r.rough.t - r.stock.t, r.partNo).toBeGreaterThanOrEqual(p.millingAllowanceIn - 1e-9);
    expect(cl.resaw.find((r) => Math.abs(r.roughT - 0.375) < 1e-3)!.strips).toBe(8); // the 8 band strips: unchanged by the new yields
    expect(cl.resaw.find((r) => Math.abs(r.roughT - 0.5) < 1e-3)!.strips).toBe(4); // the 4 rail strips
  });

  it('buys at least one spare strip per pool and reports what each board yields (the assembly steps quote these numbers)', () => {
    for (const pool of cl.resaw) {
      expect(pool.spares, `${pool.roughT} spares`).toBeGreaterThanOrEqual(RESAW_MIN_SPARES);
      expect(pool.stripSlots).toBe(pool.strips + pool.spares);
      expect(pool.yieldPerBoard).toBe(Math.floor(pool.stripSlots / pool.boards));
      expect(RESAW_BOARD_WIDTHS_IN).toContain(pool.boardWidthIn);
      expect(pool.boardFeet).toBeCloseTo((pool.boards * boardByNominal(pool.board).nominalIn * pool.boardWidthIn * pool.boardLengthIn) / 144, 9);
    }
    // 8 band strips and 4 rail strips: more than that is bought, and the spares are real room (a strip of the widest width fits in each)
    expect(cl.resaw.find((r) => Math.abs(r.roughT - 0.375) < 1e-3)!.strips).toBe(8); // 0.234 + 1/8 = 0.359, rounded UP to 3/8
    expect(cl.resaw.find((r) => Math.abs(r.roughT - 0.5) < 1e-3)!.stripSlots).toBeGreaterThanOrEqual(5);
  });

  it('chooses the cheapest board in board feet that leaves the spare, over every thickness and width', () => {
    for (const pool of cl.resaw) {
      const items = pool.laneStrips.flat();
      const stripW = Math.max(...items.map((s) => s.widthIn));
      for (const b of BOARD_THICKNESSES) {
        const k = stripsPerBoard(pool.roughT, resawUsableIn(b, p), p.resawKerfIn);
        if (k < 1 || !isOakStocked(b.nominal)) continue;
        const lanes = makeLanes(items, k);
        for (const w of RESAW_BOARD_WIDTHS_IN) {
          if (stripW > w + 1e-9) continue;
          // the planner's own accounting: rip-first lanes packed first-fit across the boards, spares counted as whole lanes the width left can still take plus the empty slots of full-width lanes
          for (let boards = 1; boards <= lanes.length + 6; boards++) {
            const packed = packLanes(lanes, boards, p.resawKerfIn, w);
            if (!packed || spareSlots(packed, k, stripW, p.resawKerfIn, w) < RESAW_MIN_SPARES) continue;
            const bf = (boards * b.nominalIn * w * pool.boardLengthIn) / 144;
            if (bf < pool.boardFeet - 1e-9) throw new Error(`${pool.roughT}: ${b.nominal} x ${w}" needs ${bf} bf < ${pool.boardFeet}`);
            break;
          }
        }
      }
    }
  });

  it("rips first, then resaws (round 3 MUST-C): the critic's numbers, 4/4 x 8\" gives 8 band strips and no spare; a wider board or a second board adds the spare", () => {
    const kerf = p.resawKerfIn;
    const t = 0.375, wide = 1.625, narrow = 1.113;
    const k = stripsPerBoard(t, resawUsableIn(boardByNominal('4/4'), p), kerf);
    expect(k).toBe(2); // 2 x 0.375 + 0.125 = 0.875 <= 0.875
    const item = (widthIn: number, i: number) => ({ partNo: 'b', id: `b${i}`, widthIn, lengthIn: 72 });
    const strips = [...Array(6)].map((_, i) => item(wide, i)).concat([item(narrow, 6), item(narrow, 7)]);
    const lanes = makeLanes(strips, k);
    expect(lanes.length).toBe(4); // 3 wide lanes + 1 narrow lane
    const laneWidths = lanes.map((l) => Math.max(...l.map((s) => s.widthIn)));
    expect(laneWidths).toEqual([wide, wide, wide, narrow]);
    const used = laneWidths.reduce((a, w) => a + w + kerf, 0); // 6.488
    // the critic's own arithmetic: four 1.625 lanes take 4 x 1.625 + 3 x 0.125 = 6.875, leaving 1.125 in on an 8 in board, which holds no 1.113 lane (it needs a kerf too)
    expect(4 * wide + 3 * kerf).toBeCloseTo(6.875, 9);
    expect(8 - (4 * wide + 3 * kerf)).toBeLessThan(narrow + kerf);
    // 8 in: no room for another lane (1.637 < 1.75), so 0 spares; 9 in and 10 in leave one and two more lanes
    expect(spareSlots([lanes.map((l) => l)], k, wide, kerf, 8)).toBe(0);
    expect(8 + kerf - used).toBeLessThan(wide + kerf);
    expect(spareSlots([lanes], k, wide, kerf, 9)).toBe(2);
    expect(spareSlots([lanes], k, wide, kerf, 10)).toBe(4);
    // so the planner does not pick 4/4 x 8 in with 0 spares; it meets the spare with the fewest board feet
    const pool = cl.resaw.find((r) => Math.abs(r.roughT - 0.375) < 1e-3)!;
    expect(pool.spares).toBeGreaterThanOrEqual(RESAW_MIN_SPARES);
    expect(pool.strips).toBe(8);
    expect(pool.board === '4/4' && pool.boardWidthIn <= 8 && pool.boards === 1).toBe(false);
    // the cost of the one-board 4/4 x 10 in and the two-board 4/4 x 6 in options are both at least the pick
    const bf = (boards: number, w: number): number => (boards * 1 * w * pool.boardLengthIn) / 144;
    expect(pool.boardFeet).toBeLessThanOrEqual(Math.min(bf(1, 10), bf(2, 6)) + 1e-9);
  });

  it('splits plywood into the 4 mm and 12 mm sheets', () => {
    expect(cl.sheets.map((s) => s.label)).toEqual(['4 mm', '12 mm']);
    const thick = cl.sheets[1].rows.map((r) => r.partNo).sort();
    expect(thick).toEqual(['deck', 'seat-back-panel']);
    const thin = cl.sheets[0].rows.map((r) => r.partNo);
    for (const n of ['side-web', 'storage-lid', 'sign']) expect(thin).toContain(n);
    const sheetIds = parts.filter((x) => isBuilt(x) && x.kind === 'sheet').map((x) => x.id).sort();
    expect(cl.sheets.flatMap((s) => ids(s.rows)).sort()).toEqual(sheetIds);
  });

  it('lists every metal part as a cut length', () => {
    const metalIds = parts.filter((x) => isBuilt(x) && x.kind === 'metal').map((x) => x.id).sort();
    expect(ids(cl.metal).sort()).toEqual(metalIds);
    expect(new Set(cl.metal.map((r) => r.family))).toEqual(new Set(['DOM tube', 'Flat bar', 'Angle', 'Aluminum tube']));
    for (const r of cl.metal) expect(r.cutLengthIn, r.partNo).toBeGreaterThan(0);
  });

  it('writes a CSV per table with a header and one row per line', () => {
    expect(cl.csv.cuts.split('\r\n').length).toBe(1 + cl.cuts.length + 1);
    expect(cl.csv.glueUps.split('\r\n').length).toBe(1 + cl.glueUps.length + 1);
    expect(cl.csv.finished.split('\r\n').length).toBe(1 + cl.finished.length + 1);
    expect(cl.csv.resaw.split('\r\n').length).toBe(1 + cl.resaw.length + 1);
    expect(cl.csv.sheets).toContain('Seat back panel');
    expect(cl.csv.metal).toContain('DOM tube');
    // D-77 (no fabrication): nothing is tapped, so the model's legacy 'drill-tap' id reads "cut on the metal bandsaw and drill" in the CSV and every table
    expect(fabText('drill-tap')).toBe('cut on the metal bandsaw and drill');
    expect(cl.csv.metal).toContain('cut on the metal bandsaw and drill');
    expect(cl.csv.metal + cl.csv.finished + cl.csv.cuts).not.toMatch(/\btap\b/i);
    // the old final-size, layer and strip tables are gone, and no CSV holds a part key or a decimal length
    expect(Object.keys(cl.csv).sort()).toEqual(['cuts', 'finished', 'glueUps', 'metal', 'resaw', 'sheets']);
    for (const [k, csv] of Object.entries(cl.csv)) {
      expect(csv, k).not.toMatch(/Part no|\bD-\d+|\bS1\b/);
      expect(csv.replace(/\d\.\d+"+ wall/g, '').replace(k === 'resaw' ? /,\d+\.\d+(?=\r?\n|$)/g : /(?!)/g, ''), k).not.toMatch(/\d\.\d+/); // a tube's wall gauge is the one catalog decimal; the board feet at the end of a resaw row are a quantity, not a length
    }
  });
});

describe('round 3: bench words, assembly steps, net web, no data warnings', () => {
  it('has no data warnings (the transposed brake-shoe / brake-chock stock is fixed in the model; the backing strip has its stock)', () => {
    expect(cl.warnings).toEqual([]);
  });
  it('cuts the brake shoe from 5/4 and face-laminates the chock (no 12/4) with T the thickness', () => {
    const row = (no: string) => cl.oak.flatMap((g) => g.rows.map((r) => ({ r, board: g.board }))).find((x) => x.r.partNo === no)!;
    const shoe = row('brake-shoe'), chock = row('brake-chock');
    expect(shoe.board).toBe('5/4');
    expect(chock.board).toBe('laminated');
    expect(chock.r.lamination!.text).toBe('3 layers: 3 \u00d7 3/4" from 4/4, glue up, then mill the block to 2-1/8"'); // D-74: 3 x 3/4 - 1/8 cleanup = 2-1/8 exactly (4 layers, 2-1/2, before)
    for (const x of [shoe, chock]) { expect(x.r.stock.t).toBeLessThanOrEqual(x.r.stock.w); expect(x.r.stock.t).toBeLessThanOrEqual(x.r.stock.l); }
  });
  it('writes the grain in words, not as a local axis', () => {
    const rows = [...cl.oak.flatMap((g) => g.rows), ...cl.sheets.flatMap((g) => g.rows)];
    for (const r of rows) if (r.grain) expect(r.grainWord, r.partNo).toMatch(/^(along L|along W|vertical \(T\))$/);
    const bulk = rows.find((r) => r.partNo === 'bow-bulkhead')!;
    expect(bulk.grainWord).toBe('along L'); // the 18.5 in length
    expect(cl.csv.finished).not.toMatch(/,[xyz],/);
    expect(cl.csv.finished.split('\r\n')[0]).toContain('Assembly step');
  });
  it('joins the ASSEMBLY step number (0 to 29) through the map the caller passes', () => {
    const steps = assemblySteps(parts, p);
    const withSteps = cutList(parts, p, stepMapOf(steps));
    const rows = [...withSteps.oak.flatMap((g) => g.rows), ...withSteps.sheets.flatMap((g) => g.rows)];
    const nMax = Math.max(...steps.map((s) => s.n));
    for (const r of rows) for (const n of r.assemblySteps) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(nMax); }
    for (const r of rows) for (const id of r.ids) { const n = stepMapOf(steps).get(id); if (n !== undefined) expect(r.assemblySteps).toContain(n); }
    expect(rows.filter((r) => r.assemblySteps.length).length).toBeGreaterThan(rows.length * 0.8);
    // without the map the column is empty rather than the model step
    expect(cutList(parts, p).oak[0].rows[0].assemblySteps).toEqual([]);
  });
  it('labels the Shaper file as net and the blank as longer for the side web, in fractions with no internal tags', () => {
    const web = cl.sheets.flatMap((g) => g.rows).find((r) => r.partNo === 'side-web')!;
    expect(web.note).toBe('the Shaper file cuts it to 59-1/2"; start from a 59-5/8" blank (+1/8" trim)');
    expect(web.stock.l).toBeCloseTo(59.59, 2);
    expect(cl.csv.sheets).toContain('start from a 59-5/8"');
    expect(web.note).not.toMatch(/S1|\d\.\d/);
    // a part whose file equals its blank has no note
    expect(cl.sheets.flatMap((g) => g.rows).find((r) => r.partNo === 'storage-lid')!.note).toBeUndefined();
  });
});

describe('face lamination (D-70: no 12/4)', () => {
  const rows = cl.oak.flatMap((g) => g.rows);
  const lam = rows.filter((r) => r.lamination);

  it('laminates every part thicker than a 5/4 board finishes to (D-79: 6/4 and 8/4 are not bought): the axle beams, brake knees and chocks, and the thick blocks that used 6/4 and 8/4', () => {
    expect(lam.map((r) => r.partNo).sort()).toEqual(['beam-F', 'beam-R', 'bow-bulkhead', 'brake-chock', 'brake-knee', 'bridle-tongue', 'chain-joist', 'handle-bar', 'king-beam', 'seat-wedge', 'storage-hinge-backer']);
    expect(cl.oak.find((g) => g.board === 'laminated')!.title).toMatch(/^Face-laminated parts \(15 pieces/);
    expect(cl.oak.some((g) => g.board === '12/4')).toBe(false);
  });

  it('picks 3 layers of 4/4 for the axle beam (D-74: 3 x 3/4 = 2-1/4 less the 1/8 cleanup is exactly 2-1/8)', () => {
    const beam = lam.find((r) => r.partNo === 'beam-F')!;
    const l = beam.lamination!;
    expect(l.layers.map((q) => q.board)).toEqual(['4/4', '4/4', '4/4']);
    expect(l.layers.map((q) => q.roughT)).toEqual([0.75, 0.75, 0.75]);
    expect(l.text).toBe('3 layers: 3 \u00d7 3/4" from 4/4, glue up, then mill the block to 2-1/8"');
    expect(beam.note).toMatch(/^face-laminated: 3 layers of 4\/4, each planed to 3\/4";/);
    expect(l.costPerFt2).toBeCloseTo(3 * 8.25, 6); // D-74: 3 layers of 4/4 (Peach State $8.25/bf, D-79); 3 x 3/4 is 2-1/8 once the cleanup comes off
    // the layers add up to the glued block, which loses the cleanup and still holds the part
    expect(l.layers.reduce((a, q) => a + q.roughT, 0)).toBeCloseTo(l.roughT, 6);
    expect(beam.roughExact.t).toBeCloseTo(l.roughT, 6);
    expect(beam.rough.t).toBeCloseTo(l.roughT, 9);
    expect(l.cleanupIn).toBeCloseTo(p.laminationCleanupIn, 9);
    expect(l.roughT - l.cleanupIn).toBeGreaterThanOrEqual(l.finalT - 1e-9);
    for (const q of l.layers) expect(q.roughT).toBeLessThanOrEqual(boardFinishedIn(boardByNominal(q.board), p) + 1e-9);
  });

  it('every lamination: layers minus the cleanup hold the final thickness, every layer fits its board, on the 1/16 grid, and no odd fractions appear', () => {
    expect(lam.length).toBe(11);
    for (const r of lam) {
      const l = r.lamination!;
      expect(l.layers.reduce((a, q) => a + q.roughT, 0) - p.laminationCleanupIn, r.partNo).toBeGreaterThanOrEqual(r.stock.t - 1e-9);
      for (const q of l.layers) {
        expect(q.roughT, `${r.partNo} ${q.board}`).toBeLessThanOrEqual(boardFinishedIn(boardByNominal(q.board), p) + 1e-9);
        expect(Math.abs(q.roughT * 16 - Math.round(q.roughT * 16)), r.partNo).toBeLessThan(1e-9);
      }
      for (const text of [l.text, r.note ?? '']) expect(text, r.partNo).not.toMatch(/27\/32|25\/32|\d+\/32/);
    }
    for (const q of cl.layers) {
      expect(q.roughT).toBeLessThanOrEqual(boardFinishedIn(boardByNominal(q.board), p) + 1e-9);
      expect(Math.abs(q.roughT * 16 - Math.round(q.roughT * 16))).toBeLessThan(1e-9);
    }
    const layerCuts = cl.cuts.filter((c) => c.piece === 'layer');
    const all = [cl.csv.cuts, ...lam.map((r) => `${r.lamination!.text} ${r.note}`), ...layerCuts.map((c) => `${c.roughText} ${c.note ?? ''}`), ...cl.glueUps.filter((g) => g.layers > 1).map((g) => g.note)].join('\n');
    expect(all).not.toMatch(/(?<![-\d])(?:27|25)\/32/); // (a part's FINAL length may end in 32nds: 17-27/32 is not a layer thickness)
  });

  it('lists the layer pieces: N layers per part, a wide layer edge-glued from pieces, the right boards', () => {
    expect(cl.layers.length).toBe(lam.reduce((a, r) => a + r.lamination!.layers.length, 0));
    const knee = cl.layers.filter((q) => q.row.partNo === 'brake-knee');
    expect(knee.length).toBe(3); // D-74: 3 layers of 4/4 (4 before)
    // D-77: the knee is cross-laminated upright / across / upright. The outer layers run up the leg, only 4-1/8" across their grain (the 3-11/16" reach plus the allowance): ONE piece each
    // from a 6" board (2 knees x 1 = 2). The center layer runs ACROSS the sled and is as wide as the knee is tall: two pieces, joined off center (2 knees x 2 = 4).
    expect(knee.map((q) => q.edgeGlued)).toEqual([1, 2, 1]);
    expect(knee.map((q) => q.qty)).toEqual([2, 4, 2]);
    expect(knee.map((q) => q.grainWord)).toEqual(['upright', 'across the sled', 'upright']);
    for (const q of knee) { expect(q.widthIn).toBeLessThanOrEqual(6); expect(q.board).toBe('4/4'); expect(q.roughT).toBe(0.75); }
    expect(knee[0].widthIn).toBeCloseTo(4.125, 6); // the upright layer is the 3-11/16" reach plus the allowance, rounded up to 1/8, across its grain
    expect(knee[0].lengthIn).toBeGreaterThan(knee[1].lengthIn); // and it is the long one: it runs the full 9-1/2" height of the knee (plus the allowance)
    expect(knee[1].widthIn).toBeCloseTo(5.625, 6); // the wider piece of the across layer: the edge joint is 5-1/4" up (3/4" above the shoulder), so the pieces are 4-3/4 and 5-5/8, not two halves
    const beam = cl.layers.filter((q) => q.row.partNo === 'beam-R');
    expect(beam.length).toBe(3);
    expect(beam.map((q) => q.board)).toEqual(['4/4', '4/4', '4/4']);
    for (const q of beam) expect(q.edgeGlued).toBe(1);
    expect(cl.csv.cuts).toContain('layer 1 of 3'); // the layers are cuts in the CSV, then a glue-up
    expect(cl.csv.glueUps).toContain('glue the 3 layers face to face');
  });

  it('chooses the cheapest valid mix per square foot of face, mixed boards allowed, and respects the cleanup and each board\'s reliable finish', () => {
    const beam = planLamination(2.25, undefined, p)!;
    expect(beam.layers.length).toBeLessThanOrEqual(MAX_LAMINATION_LAYERS);
    // a whole multiple of a layer minus the cleanup: 3 x 3/4 - 1/8 = 2-1/8
    const t2125 = planLamination(2.125, undefined, p)!;
    expect(t2125.layers.map((q) => q.board)).toEqual(['4/4', '4/4', '4/4']);
    expect(t2125.costPerFt2).toBeCloseTo(24.75, 6);
    expect(t2125.text).toBe('3 layers: 3 \u00d7 3/4" from 4/4, glue up, then mill the block to 2-1/8"');
    // one 32nd over that needs a thicker mix
    expect(planLamination(2.126, undefined, p)!.roughT - p.laminationCleanupIn).toBeGreaterThanOrEqual(2.126);
    // only 4/4 and 5/4 are stocked (D-79): 5/4 + 4/4 + 4/4 ($29) beats four 4/4 layers ($33) and 5/4 + 5/4 + 4/4 ($33.25)
    expect(planLamination(2.25, undefined, p)!.layers.map((q) => q.board)).toEqual(['5/4', '4/4', '4/4']);
    expect(planLamination(2.25, undefined, { ...p, boardYield54In: 0.75 })!.layers.map((q) => q.board)).toEqual(['4/4', '4/4', '4/4', '4/4']); // 5/4 no better than 4/4: four 3/4 layers, 3 - 1/8 = 2-7/8
    // mixed boards: 5/4 + 4/4 for 1-1/2
    const mixed = planLamination(1.5, undefined, p)!;
    expect(mixed.layers.map((q) => q.board)).toEqual(['5/4', '4/4']);
    expect(mixed.text).toBe('2 layers: 1" from 5/4 + 3/4" from 4/4, glue up, then mill the block to 1-1/2"');
    // a part a stocked board finishes to is not laminated
    expect(planLamination(1, undefined, p)).toBeNull();
    expect(planLamination(0.75, undefined, p)).toBeNull();
    // a thicker cleanup allowance needs a thicker block
    const fat = planLamination(2.125, undefined, { ...p, laminationCleanupIn: 0.25 })!;
    expect(fat.roughT - 0.25).toBeGreaterThanOrEqual(2.125 - 1e-9);
    expect(fat.cleanupIn).toBe(0.25);
    expect(fat.layers.map((q) => q.board)).toEqual(['5/4', '4/4', '4/4']); // 3 x 3/4 - 1/4 = 2 is too thin
    expect(laminationText([{ board: '4/4', roughT: 0.75, finalT: 0.75 }, { board: '4/4', roughT: 0.75, finalT: 0.75 }])).toBe('2 layers: 2 \u00d7 3/4" from 4/4');
    expect(laminationText([{ board: '8/4', roughT: 1.75, finalT: 1.75 }, { board: '4/4', roughT: 0.75, finalT: 0.75 }], 2.25)).toBe('2 layers: 1-3/4" from 8/4 + 3/4" from 4/4, glue up, then mill the block to 2-1/4"'); // the text helper still reads any board mix
  });

  it('has no data warnings and still puts every oak part in one row', () => {
    expect(cl.warnings).toEqual([]);
    const ids = rows.flatMap((r) => r.ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── Eric 2026-10-12: actual cuts, rounded rough sizes, laminate allowances, bandsaw capacity ─────────────────────────
describe('display helpers', () => {
  it('rounds ROUGH sizes UP to 1/8 and FINAL sizes to the nearest 1/32, always as fractions', () => {
    expect(roughFrac(15.65625)).toBe('15-3/4"'); // 15 21/32 is not a rough cut
    expect(roughFrac(15.625)).toBe('15-5/8"');
    expect(roughFrac(15.626)).toBe('15-3/4"');
    expect(roughFrac(6)).toBe('6"');
    expect(roughFrac(0.333)).toBe('3/8"');
    expect(finalFrac(15.65625)).toBe('15-21/32"');
    expect(finalFrac(0.234)).toBe('7/32"');
    expect(finalFrac(24)).toBe('24"');
  });
});

describe('rough allowances (Eric 2026-10-12)', () => {
  const q = defaultParams();
  const dparts = buildModel(q);
  const dcl = cutList(dparts, q);
  const isEighth = (v: number): boolean => Math.abs(v * 8 - Math.round(v * 8)) < 1e-9;

  it('has the allowances as params: plain solid +1/4 w, +1 l; glued and bent pieces +3/8 w, +2 l; thickness +1/8', () => {
    expect(q.millingAllowanceIn).toBe(0.125);
    expect(q.roughWidthAllowanceIn).toBe(0.25);
    expect(q.roughLengthAllowanceIn).toBe(1);
    expect(q.laminateWidthAllowanceIn).toBe(0.375);
    expect(q.laminateLengthAllowanceIn).toBe(2);
    expect(q.bandsawResawCapacityIn).toBe(6);
  });

  it('gives a plain solid part the plain allowances, rounded UP to 1/8, and a bent strip the laminate ones', () => {
    const joist = dparts.find((x) => x.id === 'joist-2')!;
    const row = dcl.oak.flatMap((g) => g.rows).find((r) => r.ids.includes('joist-2'))!;
    expect(row.roughExact.w).toBeCloseTo(joist.stock!.w + 0.25, 9);
    expect(row.roughExact.l).toBeCloseTo(joist.stock!.l + 1, 9);
    expect(row.rough.l).toBeCloseTo(Math.ceil((joist.stock!.l + 1) * 8 - 1e-9) / 8, 9);
    const rail = dcl.strips.find((r) => r.partNo === 'rail')!;
    expect(rail.rough.w).toBeCloseTo(Math.ceil((rail.stock.w + 0.375) * 8 - 1e-9) / 8, 9);
    expect(rail.rough.l).toBeCloseTo(Math.ceil((rail.stock.l + 2) * 8 - 1e-9) / 8, 9);
    expect(rail.rough.t).toBeCloseTo(0.5, 9);
  });

  it('rounds EVERY rough dimension in the cut list UP to 1/8 (cuts, rows, strips, layers, glue-ups), never below the exact size', () => {
    for (const c of dcl.cuts) {
      for (const k of ['t', 'w', 'l'] as const) {
        expect(isEighth(c.rough[k]) || k === 't', `${c.label} ${k}`).toBe(true);
        expect(c.rough[k], `${c.label} ${k}`).toBeGreaterThanOrEqual(c.roughExact[k] - 1e-9);
        expect(c.rough[k], `${c.label} ${k}`).toBeLessThan(c.roughExact[k] + 1 / 8 + 1e-9);
      }
      expect(c.roughText, c.label).toMatch(/^[\d\-/]+ \u00d7 [\d\-/]+ \u00d7 [\d\-/]+$/); // fractions, no decimals
    }
    for (const r of dcl.oak.flatMap((g) => g.rows)) for (const k of ['w', 'l'] as const) expect(isEighth(r.rough[k]), `${r.partNo} ${k}`).toBe(true);
    for (const g of dcl.glueUps) for (const k of ['t', 'w', 'l'] as const) expect(isEighth(g.roughBlock[k]), `${g.label} ${k}`).toBe(true);
    for (const l of dcl.layers) { expect(isEighth(l.widthIn)).toBe(true); expect(isEighth(l.lengthIn)).toBe(true); }
    expect(dcl.csv.finished + dcl.csv.cuts).not.toMatch(/\d\.\d/); // the final and rough columns are fractions
  });

  it('leaves the board choice and the lamination on the EXACT thickness, so rounding never moves a part to a thicker board', () => {
    for (const g of dcl.oak) {
      if (g.board === 'resawn' || g.board === 'laminated') continue;
      for (const r of g.rows) { expect(r.stock.t, r.partNo).toBeLessThanOrEqual(g.finishedIn + 1e-9); expect(r.rough.t, r.partNo).toBeLessThanOrEqual(g.nominalIn + 1e-9); }
    }
    const king = dcl.cuts.find((c) => c.partNo === 'king-beam')!;
    expect(king.board).toBe('5/4'); // D-79: no 8/4 is bought; the 1.746 in king beam is two 5/4 layers, each planed to 1"
    expect(king.rough.t).toBeLessThanOrEqual(boardByNominal('5/4').nominalIn + 1e-9);
  });

  it('does not change the mass: the mass reads stock, never rough', () => {
    const lb = (pp: typeof dparts): number => pp.reduce((a, x) => a + (x.payload || x.group === 'reference' ? 0 : x.massLb), 0);
    const big = { ...q, roughWidthAllowanceIn: 0.5, roughLengthAllowanceIn: 3, laminateWidthAllowanceIn: 0.75, laminateLengthAllowanceIn: 4 };
    expect(lb(buildModel(big))).toBeCloseTo(lb(dparts), 9);
  });
});

describe('actual cuts (Eric 2026-10-12: the cut list lists the cuts, not the glued-up parts)', () => {
  const q = defaultParams();
  const dparts = buildModel(q);
  const dcl = cutList(dparts, q);

  it('lists an edge-glued panel as its boards, each its share of the width plus the laminate allowance, and a glue-up row', () => {
    const boards = dcl.cuts.filter((c) => c.partNo === 'transom-rear');
    expect(boards).toHaveLength(3);
    expect(boards.map((c) => c.label)).toEqual(['Rear transom, board 1 of 3', 'Rear transom, board 2 of 3', 'Rear transom, board 3 of 3']);
    const transom = dparts.find((x) => x.id === 'transom-rear')!;
    for (const c of boards) {
      expect(c.piece).toBe('board');
      expect(c.of).toBe(3);
      expect(c.roughExact.w).toBeCloseTo(transom.stock!.w / 3 + 0.375, 9);
      expect(c.rough.w).toBeLessThanOrEqual(6);
      expect(c.glueUp).toBe('Rear transom panel');
      expect(c.roughText).toMatch(/^5\/8 \u00d7 5-7\/8 \u00d7 26$/);
    }
    const g = dcl.glueUps.find((x) => x.partNo === 'transom-rear')!;
    expect(g.label).toBe('Rear transom panel');
    expect(g.from).toBe(3);
    expect(g.kind).toBe('edge');
    expect(g.roughBlock.w).toBeCloseTo(boards.reduce((a, c) => a + c.rough.w, 0), 9);
    expect(g.finalText).toBe(`${finalFrac(transom.stock!.t).replace('"', '')} \u00d7 ${finalFrac(transom.stock!.w).replace('"', '')} \u00d7 ${finalFrac(transom.stock!.l).replace('"', '')}`);
    expect(g.note).toMatch(/then mill to final/);
  });

  it('lists the layers of a face-laminated part as the cuts, with the laminated block as the glue-up', () => {
    const layers = dcl.cuts.filter((c) => c.partNo === 'beam-R');
    expect(layers).toHaveLength(3);
    for (const c of layers) { expect(c.piece).toBe('layer'); expect(c.layers).toBe(3); expect(c.board).toBe('4/4'); expect(c.glueUp).toBe('rear axle beam block'); }
    expect(layers.map((c) => c.label).sort()).toEqual(['rear axle beam, layer 1 of 3', 'rear axle beam, layer 2 of 3', 'rear axle beam, layer 3 of 3']);
    const g = dcl.glueUps.find((x) => x.partNo === 'beam-R')!;
    expect(g.kind).toBe('face');
    expect(g.from).toBe(3);
    // a laminated knee is both: edge-glue the boards of each layer, then the layers
    const knee = dcl.glueUps.find((x) => x.partNo === 'brake-knee')!;
    expect(knee.kind).toBe('both');
    expect(knee.from).toBe(4); // D-77: layers upright / across / upright = 1 + 2 + 1 pieces (the upright layers are one piece each from a 6" board)
    expect(knee.note).toMatch(/layer 2: 2 boards/);
    const kneeCuts = dcl.cuts.filter((c) => c.partNo === 'brake-knee');
    expect(kneeCuts.map((c) => c.label).sort()).toEqual([
      'Brake pivot knee, layer 1 of 3 (grain upright)',
      'Brake pivot knee, layer 2 of 3, board 1 of 2 (grain across the sled)', 'Brake pivot knee, layer 2 of 3, board 2 of 2 (grain across the sled)',
      'Brake pivot knee, layer 3 of 3 (grain upright)',
    ].sort());
    expect(kneeCuts.find((c) => c.layer === 1)!.note).toMatch(/one piece/);
    expect(kneeCuts.find((c) => c.layer === 2 && c.index === 2)!.roughText).toBe('3/4 × 5-5/8 × 5-3/4'); // the lower piece of the off-center joint
    expect(kneeCuts.find((c) => c.layer === 1)!.roughText).toBe('3/4 × 4-1/8 × 11-5/8'); // the upright layer: 4-1/8 across its grain, 11-5/8 along it
    expect(kneeCuts.find((c) => c.layer === 2 && c.index === 3)!.note).toMatch(/NOT equal/);
    expect(knee.qty).toBe(2);
    expect(dcl.cuts.filter((c) => c.partNo === 'brake-knee').reduce((a, c) => a + c.qty, 0)).toBe(8); // 2 knees x (1 + 2 + 1) pieces
  });

  it('lists the resaw strips as the strip blanks with the rip-first note, from the pool board', () => {
    const rail = dcl.cuts.filter((c) => c.partNo === 'rail');
    expect(rail.reduce((a, c) => a + c.qty, 0)).toBe(4);
    for (const c of rail) { expect(c.piece).toBe('strip'); expect(c.board).toBe(dcl.strips.find((r) => r.partNo === 'rail')!.resawFrom); expect(c.note).toMatch(/rip the lane first/); }
    expect(rail.map((c) => c.label)).toEqual(['Rail, strip 1 of 2', 'Rail, strip 2 of 2']);
  });

  it('accounts for every oak part exactly once: ids in cuts equal the oak parts, and every piece has a rough size', () => {
    const oakIds = dparts.filter((x) => isBuilt(x) && /oak/i.test(x.material) && (x.kind === 'lumber' || x.kind === 'bentlam')).map((x) => x.id).sort();
    expect([...new Set(dcl.cuts.flatMap((c) => c.ids))].sort()).toEqual(oakIds);
    expect(dcl.cuts.every((c) => c.partId === c.ids[0] && c.qty === c.ids.length && c.rough.t > 0 && c.rough.w > 0 && c.rough.l > 0)).toBe(true);
    expect(dcl.cuts.some((c) => c.piece === 'solid')).toBe(true);
  });

  it('keeps the finished sizes in a Finished parts table: exact in final, the nearest 1/32 in the text', () => {
    const t = dcl.finished.find((f) => f.partNo === 'transom-rear')!;
    expect(t.from).toBe('glue-up');
    expect(t.final.w).toBeCloseTo(dparts.find((x) => x.id === 'transom-rear')!.stock!.w, 9);
    expect(t.finalText).toBe('1/2 \u00d7 16-3/8 \u00d7 24');
    expect(dcl.finished.find((f) => f.partNo === 'joist')!.from).toBe('board');
    expect(dcl.finished.find((f) => f.partNo === 'rail')!.final.t).toBeCloseTo(0.75, 9); // two 3/8 plies
    expect(dcl.csv.cuts.split('\r\n')[0]).toContain('Glued into');
    expect(dcl.csv.glueUps.split('\r\n')[0]).toContain('Then mill to');
    expect(dcl.csv.finished).toContain('Final T x W x L');
  });
});

describe('bandsaw capacity (Eric 2026-10-12: my bandsaw has 6" capacity)', () => {
  const q = defaultParams();
  const dparts = buildModel(q);
  const dcl = cutList(dparts, q);

  it('has a resaw height on every pool: the strip WIDTH (rip first), at most the 6" capacity, never the width of the board', () => {
    expect(dcl.resaw.length).toBeGreaterThan(0);
    for (const pool of dcl.resaw) {
      expect(pool.bandsawCapacityIn).toBe(6);
      expect(pool.resawHeightIn).toBeLessThanOrEqual(6);
      expect(pool.withinCapacity).toBe(true);
      expect(pool.resawHeightIn).toBeCloseTo(Math.max(...pool.laneStrips.flat().map((s) => s.widthIn)), 9);
      expect(pool.resawHeightIn).toBeLessThan(pool.boardWidthIn); // a 9" or 10" board is ripped first
      expect(pool.laneWidthsIn.length).toBe(pool.lanes);
    }
    expect(dcl.warnings.filter((w) => /bandsaw/.test(w))).toEqual([]);
  });

  it('says so in the text: the resaw height against the saw, and which board to rip the lanes from first', () => {
    const rail = dcl.resaw.find((r) => Math.abs(r.roughT - 0.5) < 1e-6)!;
    expect(rail.resawHeightText).toBe('resaw height 3-3/8" (your bandsaw: 6")');
    expect(rail.ripText).toBe(`rip the lanes from a ${rail.boardWidthIn}"-wide board first`);
    expect(rail.text).toContain(rail.ripText[0].toUpperCase() + rail.ripText.slice(1));
    expect(rail.text).toContain(rail.resawHeightText);
  });

  it('flags a strip taller than the saw (here a 3" saw) instead of silently planning a cut it cannot make', () => {
    const tall = cutList(dparts, { ...q, bandsawResawCapacityIn: 3 });
    const bad = tall.resaw.filter((r) => !r.withinCapacity);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0].text).toMatch(/TOO TALL/);
    expect(tall.warnings.some((w) => /taller than your bandsaw/.test(w))).toBe(true);
    // rip-first never needs a cut taller than the widest strip, whatever the board width
    for (const r of tall.resaw) expect(r.resawHeightIn).toBeCloseTo(Math.max(...r.laneStrips.flat().map((s) => s.widthIn)), 9);
  });
});

describe('readability round 2: one lane count for the steps, the book and the cut list', () => {
  it('every pool carries its lane count and the lanes to rip (planned lanes plus the spare lanes)', () => {
    expect(cl.resaw.length).toBeGreaterThan(0);
    for (const pool of cl.resaw) {
      expect(pool.ripLanes, pool.board).toBeGreaterThanOrEqual(pool.lanes);
      expect(pool.laneCountText, pool.board).toMatch(new RegExp(`^${pool.ripLanes} lanes?, `));
      expect(pool.laneCountText, pool.board).not.toMatch(/\d\.\d|D-\d/); // widths are fractions
      // each lane yields stripsPerBoard strips, so the lanes to rip hold every strip needed plus the spares
      expect(pool.ripLanes * pool.stripsPerBoard).toBeGreaterThanOrEqual(pool.strips);
    }
  });
  it('the cuts, the glue-ups and the finished parts say nothing about keys, D-numbers or decimals', () => {
    const text = [...cl.cuts.map((c) => `${c.label} ${c.roughText} ${c.note ?? ''}`), ...cl.glueUps.map((g) => `${g.label} ${g.roughBlockText} ${g.finalText} ${g.note}`), ...cl.finished.map((f) => `${f.name} ${f.finalText}`), ...cl.oak.map((g) => g.title)].join('\n');
    expect(text).not.toMatch(/\bD-\d+|\d\.\d/);
  });
});
