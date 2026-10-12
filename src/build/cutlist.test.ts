import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { BOARD_THICKNESSES, boardByNominal, boardForThickness, cutList, isBuilt, resawUsableIn, stripsPerBoard, toCsv } from './cutlist';

const p = defaultParams();
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
    expect(boardForThickness(2.375)!.nominal).toBe('12/4');
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
      if (g.board === 'resawn') continue;
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
      expect(pool.boards * pool.stripsPerBoard).toBeGreaterThanOrEqual(pool.layers);
      expect(pool.layerStrips.flat().length).toBe(pool.strips);
      for (const layer of pool.layerStrips) expect(layer.reduce((a, s) => a + s.widthIn + p.resawKerfIn, 0)).toBeLessThanOrEqual(6 + p.resawKerfIn + 1e-9);
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
    expect(rails.board).toBe('5/4');
    expect(rails.stripsPerBoard).toBe(2);
    expect(rails.boards).toBe(2);
    expect(rails.boardFeet).toBeLessThan(9); // the 12/4 route was 9 bf
    expect(cl.strips.find((r) => r.partNo === 'rail')!.resawFrom).toBe('5/4');
    // no resaw pool is sawn from a board that yields fewer strips than a thinner board would for fewer board feet
    for (const pool of cl.resaw) expect(pool.yieldByBoard[pool.board]).toBe(pool.stripsPerBoard);
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
