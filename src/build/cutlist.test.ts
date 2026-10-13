import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { PRE_D72 } from '../test-fixtures';
import { assemblySteps } from './assembly';
import { BOARD_THICKNESSES, MAX_LAMINATION_LAYERS, RESAW_BOARD_WIDTHS_IN, RESAW_MIN_SPARES, boardByNominal, boardForThickness, cutList, isBuilt, laminationText, makeLanes, planLamination, stepMapOf, resawUsableIn, spareSlots, stripsPerBoard, toCsv } from './cutlist';

// D-72/D-73: this file's resaw and sheet numbers (0.234 in bands in 0.359 in rough pools, the 4 mm sheet, the tube) are the 4 mm okoume design: PRE_D72. The white oak / rod cut list is in d72.test.ts.
const p = { ...defaultParams(), ...PRE_D72 };
const parts = buildModel(p);
const cl = cutList(parts, p);

describe('toCsv', () => {
  it('quotes per RFC 4180', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"', 'x\ny', 3, undefined]])).toBe('a,"b,c","say ""hi""","x\ny",3,\r\n');
  });
});

describe('board thickness map', () => {
  it('maps a rough thickness to the smallest board that yields it', () => {
    expect(boardForThickness(0.75)!.nominal).toBe('4/4');
    expect(boardForThickness(0.8125)!.nominal).toBe('4/4');
    expect(boardForThickness(1)!.nominal).toBe('5/4');
    expect(boardForThickness(1.828)!.nominal).toBe('8/4'); // the king beam (1.703 finished): 8/4, not 12/4
    expect(boardForThickness(1.3)!.nominal).toBe('6/4');
    expect(boardForThickness(1.625)!.nominal).toBe('8/4');
    expect(boardForThickness(2.375)).toBeNull(); // 12/4 is not stocked (D-70): thicker than 8/4 means face-laminated
    expect(boardForThickness(1.9)).toBeNull();
    expect(boardForThickness(9)).toBeNull();
  });
  it('lists the spec thicknesses', () => {
    const usable = Object.fromEntries(BOARD_THICKNESSES.map((b) => [b.nominal, b.usableIn]));
    // the thickest ROUGH part each board yields: after-surfacing thickness + the 1/8" planing allowance the part already carries
    expect(usable['4/4']).toBeCloseTo(13 / 16 + 1 / 8);
    expect(usable['8/4']).toBeCloseTo(1.75 + 1 / 8);
    expect(usable['12/4']).toBeCloseTo(2.75 + 1 / 8);
    for (const b of BOARD_THICKNESSES) expect(b.usableIn).toBeLessThanOrEqual(b.nominalIn - 1 / 16 + 1e-9);
  });
});

describe('cutList', () => {
  const ids = (xs: Array<{ ids: string[] }>): string[] => xs.flatMap((x) => x.ids);

  it('puts every solid oak part in exactly one oak row, in a board that can yield its rough thickness', () => {
    const oakIds = parts.filter((x) => isBuilt(x) && /oak/i.test(x.material) && (x.kind === 'lumber' || x.kind === 'bentlam')).map((x) => x.id).sort();
    const listed = cl.oak.flatMap((g) => ids(g.rows)).sort();
    expect(listed).toEqual(oakIds);
    expect(oakIds.length).toBeGreaterThanOrEqual(60);
    for (const g of cl.oak) {
      if (g.board === 'resawn' || g.board === 'laminated') continue;
      for (const r of g.rows) expect(r.rough.t, r.partNo).toBeLessThanOrEqual(g.usableIn + 1e-6);
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
    expect(stripsPerBoard(0.359, 1.75, 0.125)).toBe(3);
    expect(stripsPerBoard(0.359, 13 / 16, 0.125)).toBe(1);
    expect(stripsPerBoard(0.359, 1.75, 0.0625)).toBeGreaterThanOrEqual(4);
  });

  it('resaws from the ROUGH board: the 0.5 in rail strips come two to a 5/4 board (2 x 0.5 + kerf in 1.25), not four to a 12/4', () => {
    const b54 = boardByNominal('5/4');
    expect(resawUsableIn(b54, p)).toBeCloseTo(1.25 - p.millingAllowanceIn, 9);
    expect(stripsPerBoard(0.5, resawUsableIn(b54, p), p.resawKerfIn)).toBe(2);
    expect(stripsPerBoard(0.5, resawUsableIn(boardByNominal('12/4'), p), p.resawKerfIn)).toBe(4);
    const rails = cl.resaw.find((r) => Math.abs(r.roughT - 0.5) < 1e-6)!;
    expect(rails.strips).toBe(4);
    expect(rails.boardFeet).toBeLessThan(9); // the 12/4 route was 9 bf
    expect(cl.strips.find((r) => r.partNo === 'rail')!.resawFrom).toBe(rails.board);
    // no resaw pool is sawn from a board that yields fewer strips than a thinner board would for fewer board feet
    for (const pool of cl.resaw) expect(pool.yieldByBoard[pool.board]).toBe(pool.stripsPerBoard);
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
    expect(cl.resaw.find((r) => Math.abs(r.roughT - 0.359) < 1e-3)!.strips).toBe(8);
    expect(cl.resaw.find((r) => Math.abs(r.roughT - 0.5) < 1e-3)!.stripSlots).toBeGreaterThanOrEqual(5);
  });

  it('chooses the cheapest board in board feet that leaves the spare, over every thickness and width', () => {
    for (const pool of cl.resaw) {
      const stripW = Math.max(...pool.laneStrips.flat().map((s) => s.widthIn));
      for (const b of BOARD_THICKNESSES) {
        const k = stripsPerBoard(pool.roughT, resawUsableIn(b, p), p.resawKerfIn);
        if (k < 1) continue;
        for (const w of RESAW_BOARD_WIDTHS_IN) {
          // a plan that cuts every lane at the widest strip width is feasible (an upper bound on the room needed): no cheaper candidate may satisfy it
          const perBoard = Math.floor((w + p.resawKerfIn) / (stripW + p.resawKerfIn)) * k;
          if (perBoard < 1) continue;
          const boards = Math.ceil((pool.strips + RESAW_MIN_SPARES) / perBoard);
          const bf = (boards * b.nominalIn * w * pool.boardLengthIn) / 144;
          if (bf < pool.boardFeet - 1e-9) throw new Error(`${pool.roughT}: ${b.nominal} x ${w}" needs ${bf} bf < ${pool.boardFeet}`);
        }
      }
    }
  });

  it("rips first, then resaws (round 3 MUST-C): the critic's numbers, 4/4 x 8\" gives 8 band strips and no spare; a wider board or a second board adds the spare", () => {
    const kerf = p.resawKerfIn;
    const t = 0.359, wide = 1.625, narrow = 1.113;
    const k = stripsPerBoard(t, resawUsableIn(boardByNominal('4/4'), p), kerf);
    expect(k).toBe(2); // 2 x 0.359 + 0.125 = 0.843 <= 0.875
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
    const pool = cl.resaw.find((r) => Math.abs(r.roughT - 0.359) < 1e-3)!;
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
    expect(cl.csv.oak.split('\r\n').length).toBe(1 + cl.oak.reduce((a, g) => a + g.rows.length, 0) + 1);
    expect(cl.csv.strips.startsWith('Part no,')).toBe(true);
    expect(cl.csv.sheets).toContain('seat-back-panel');
    expect(cl.csv.metal).toContain('DOM tube');
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
    expect(chock.r.lamination!.text).toBe('3 \u00d7 0.833" from 4/4'); // 2.5 / 3: not a sixteenth, so the decimal
    for (const x of [shoe, chock]) { expect(x.r.stock.t).toBeLessThanOrEqual(x.r.stock.w); expect(x.r.stock.t).toBeLessThanOrEqual(x.r.stock.l); }
  });
  it('writes the grain in words, not as a local axis', () => {
    const rows = [...cl.oak.flatMap((g) => g.rows), ...cl.sheets.flatMap((g) => g.rows)];
    for (const r of rows) if (r.grain) expect(r.grainWord, r.partNo).toMatch(/^(along L|along W|vertical \(T\))$/);
    const bulk = rows.find((r) => r.partNo === 'bow-bulkhead')!;
    expect(bulk.grainWord).toBe('along L'); // the 18.5 in length
    expect(cl.csv.oak).not.toMatch(/,[xyz],/);
    expect(cl.csv.oak.split('\r\n')[0]).toContain('Assembly step');
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
  it('labels the Shaper file as net and the blank as longer for the side web (59.49 / 59.59)', () => {
    const web = cl.sheets.flatMap((g) => g.rows).find((r) => r.partNo === 'side-web')!;
    expect(web.note).toMatch(/cut net 59\.49" from the Shaper file; blank 59\.59/);
    expect(web.stock.l).toBeCloseTo(59.59, 2);
    expect(cl.csv.sheets).toContain('cut net 59.49');
    // a part whose file equals its blank has no note
    expect(cl.sheets.flatMap((g) => g.rows).find((r) => r.partNo === 'storage-lid')!.note).toBeUndefined();
  });
});

describe('face lamination (D-70: no 12/4)', () => {
  const rows = cl.oak.flatMap((g) => g.rows);
  const lam = rows.filter((r) => r.lamination);

  it('laminates exactly the four parts that needed 12/4: the two axle beams, the brake knees and the chocks', () => {
    expect(lam.map((r) => r.partNo).sort()).toEqual(['beam-F', 'beam-R', 'brake-chock', 'brake-knee']);
    expect(cl.oak.find((g) => g.board === 'laminated')!.title).toMatch(/^Face-laminated parts \(6 pieces/);
    expect(cl.oak.some((g) => g.board === '12/4')).toBe(false);
  });

  it('picks three 4/4 layers for the axle beam: the cheapest mix per square foot that fits', () => {
    const beam = lam.find((r) => r.partNo === 'beam-F')!;
    expect(beam.lamination!.layers.map((l) => l.board)).toEqual(['4/4', '4/4', '4/4']);
    expect(beam.lamination!.text).toBe('3 \u00d7 3/4" from 4/4');
    expect(beam.note).toMatch(/^face-laminated \(D-70\): 3 layers of 4\/4, each planed to 25\/32" \(0\.792"\);/);
    expect(beam.lamination!.costPerFt2).toBeCloseTo(30, 6); // 3 x 1 x $10; 8/4 + 4/4 would be $40, 5/4 + 5/4 $31.25
    // the layers add up to the glued block, each fits its board, and the finished shares add up to the part
    const l = beam.lamination!;
    expect(l.layers.reduce((a, q) => a + q.roughT, 0)).toBeCloseTo(beam.rough.t, 6);
    expect(l.layers.reduce((a, q) => a + q.finalT, 0)).toBeCloseTo(beam.stock.t, 6);
    for (const q of l.layers) expect(q.roughT).toBeLessThanOrEqual(boardByNominal(q.board).usableIn + 1e-9);
    // the planing allowance is taken once, on the block
    expect(l.roughT - l.finalT).toBeCloseTo(p.millingAllowanceIn, 6);
  });

  it('lists the layer pieces: N layers per part, a wide layer edge-glued from pieces, the right boards', () => {
    expect(cl.layers.length).toBe(lam.reduce((a, r) => a + r.lamination!.layers.length, 0));
    const knee = cl.layers.filter((q) => q.row.partNo === 'brake-knee');
    expect(knee.length).toBe(3);
    for (const q of knee) { expect(q.edgeGlued).toBe(2); expect(q.qty).toBe(4); expect(q.widthIn).toBeLessThanOrEqual(6); } // 2 knees x 2 pieces across
    const beam = cl.layers.filter((q) => q.row.partNo === 'beam-R');
    expect(beam.length).toBe(3);
    for (const q of beam) { expect(q.edgeGlued).toBe(1); expect(q.board).toBe('4/4'); }
    expect(cl.csv.layers.split('\r\n')[0]).toContain('Rough layer T x W x L (in)');
    expect(cl.csv.layers.split('\r\n').length).toBe(cl.layers.length + 2); // header + rows + trailing
    expect(cl.csv.oak).toContain('face-laminated: 3 \u00d7 3/4"" from 4/4'); // a quote in a CSV cell is doubled
    expect(cl.csv.oak.split('\r\n')[0]).toContain('Lamination');
  });

  it('chooses by cost per square foot of face, and respects each board\'s usable thickness', () => {
    const one = planLamination(2.25, 2.375)!;
    expect(one.layers).toHaveLength(3);
    // a part just over 8/4 (1.9" rough) can be 3 x 4/4 ($30) and no cheaper mix of stocked boards exists
    const t19 = planLamination(1.775, 1.9)!;
    expect(t19.costPerFt2).toBeLessThanOrEqual(30 + 1e-9);
    for (const q of t19.layers) expect(q.roughT).toBeLessThanOrEqual(boardByNominal(q.board).usableIn + 1e-9);
    expect(t19.layers.reduce((a, q) => a + q.roughT, 0)).toBeCloseTo(1.9, 6);
    // a part a stocked board yields is not laminated
    expect(planLamination(1.5, 1.625)).toBeNull();
    expect(one.layers.length).toBeLessThanOrEqual(MAX_LAMINATION_LAYERS);
    expect(laminationText([{ board: '4/4', roughT: 0.8, finalT: 0.75 }, { board: '4/4', roughT: 0.8, finalT: 0.75 }])).toBe('2 \u00d7 3/4" from 4/4');
  });

  it('has no data warnings and still puts every oak part in one row', () => {
    expect(cl.warnings).toEqual([]);
    const ids = rows.flatMap((r) => r.ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
