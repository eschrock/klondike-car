import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { fastenerBreakdown } from '../model/lighting';
import { defaultParams } from '../params';
import { bom, jointItems, shortVendor } from './bom';
import { cutList, isBuilt } from './cutlist';

const p = defaultParams();
const parts = buildModel(p);
const b = bom(parts, p);
const cl = cutList(parts, p);

describe('bom', () => {
  it('totals to a finite positive number, section by section', () => {
    expect(Number.isFinite(b.totalUsd)).toBe(true);
    expect(b.totalUsd).toBeGreaterThan(500);
    expect(b.sections.map((s) => s.id)).toEqual(['lumber', 'plywood', 'metal', 'purchased', 'fasteners', 'consumables']);
    expect(b.sections.reduce((a, s) => a + s.subtotalUsd, 0)).toBeCloseTo(b.totalUsd, 1);
    for (const s of b.sections) {
      expect(s.lines.length, s.id).toBeGreaterThan(0);
      expect(s.lines.reduce((a, l) => a + l.extUsd, 0)).toBeCloseTo(s.subtotalUsd, 1);
      for (const l of s.lines) {
        expect(Number.isFinite(l.extUsd), l.key).toBe(true);
        expect(l.extUsd, l.key).toBeCloseTo(l.qty * l.unitUsd, 1);
        expect(l.qty, l.key).toBeGreaterThan(0);
      }
    }
    expect(b.estimateShare).toBeGreaterThan(0);
    expect(b.estimateShare).toBeLessThanOrEqual(1);
    expect(b.unpriced).toEqual([]);
  });

  it('puts every built part in exactly one cut-list or BOM line (the fastener allowance is expanded instead)', () => {
    const where = new Map<string, number>();
    const hit = (id: string) => where.set(id, (where.get(id) ?? 0) + 1);
    cl.oak.forEach((g) => g.rows.forEach((r) => r.ids.forEach(hit)));
    cl.sheets.forEach((g) => g.rows.forEach((r) => r.ids.forEach(hit)));
    cl.metal.forEach((r) => r.ids.forEach(hit));
    b.sections.find((s) => s.id === 'purchased')!.lines.forEach((l) => l.partIds!.forEach(hit));
    const built = parts.filter(isBuilt);
    expect(built.length).toBeGreaterThan(150);
    for (const x of built) expect(where.get(x.id), x.id).toBe(1);
    expect(where.has('hardware')).toBe(false);
    expect(where.size).toBe(built.length);
  });

  it('expands fasteners from the joints: counts equal the model breakdown', () => {
    const fb = fastenerBreakdown(parts);
    const n = (k: string): number => fb[k]?.count ?? 0;
    expect(b.jointCounts.screw).toBe(n('screws'));
    expect(b.jointCounts.bolt).toBe(n('bolt sets') + n('bolts tapped into steel') + n('nuts and washers (itemized bolts)'));
    expect(b.jointCounts['threaded-insert']).toBe(n('inserts'));
    expect(b.jointCounts.knob).toBe(n('thumb knobs'));
    expect(b.jointCounts.domino).toBe(n('Dominos'));
    expect(b.jointCounts.glue).toBe(n('epoxy joints'));
    const lines = b.sections.find((s) => s.id === 'fasteners')!.lines;
    const sum = (re: RegExp) => lines.filter((l) => re.test(l.key)).reduce((a, l) => a + l.qty, 0);
    expect(sum(/^Domino/)).toBe(b.jointCounts.domino);
    // every bolt brings a nut, except the kingpin (nut is in the part)
    expect(sum(/lock nut/)).toBeGreaterThanOrEqual(b.jointCounts.bolt - 1);
    expect(lines.some((l) => /Domino DF 500 4x20/.test(l.key))).toBe(true);
    expect(lines.some((l) => /Domino DF 500 5x30/.test(l.key))).toBe(true);
  });

  it('marks model costs quoted and table prices estimated', () => {
    const purchased = b.sections.find((s) => s.id === 'purchased')!.lines;
    const cushion = purchased.find((l) => l.key === 'seat-cushion')!;
    expect(cushion.basis).toBe('quoted');
    expect(cushion.unitUsd).toBe(parts.find((x) => x.id === 'seat-cushion')!.sourcing!.costUsd);
    expect(purchased.find((l) => l.key === 'wheel')!.basis).toBe('estimate');
    expect(purchased.find((l) => l.key === 'wheel')!.qty).toBe(4);
    for (const s of ['lumber', 'plywood', 'metal'] as const) expect(b.sections.find((x) => x.id === s)!.lines.every((l) => l.basis === 'estimate')).toBe(true);
  });

  it('prices two sheets from a local supplier and 4/4 to 12/4 oak', () => {
    const ply = b.sections.find((s) => s.id === 'plywood')!.lines;
    expect(ply.map((l) => l.qty)).toEqual([1, 1]);
    expect(JSON.stringify(b)).not.toMatch(/Aircraft Spruce/);
    const lumber = b.sections.find((s) => s.id === 'lumber')!.lines.map((l) => l.key);
    expect(lumber).toEqual(['4/4', '5/4', '6/4', '8/4', '12/4']);
  });

  it('keeps vendor names short and writes a CSV with subtotals and a total', () => {
    const purchased = b.sections.find((s) => s.id === 'purchased')!.lines;
    for (const l of purchased) expect(l.vendor!.length, l.key).toBeLessThanOrEqual(60);
    expect(shortVendor('McMaster-Carr or equivalent: 10" wheel', 'purchased')).toBe('McMaster-Carr');
    expect(b.csv.split('\r\n')[0]).toBe('Section,Item,Description,Qty,Unit,Unit USD,Ext USD,Basis,Vendor,Notes');
    expect(b.csv).toContain('Grand total');
    expect(b.csv.match(/Subtotal/g)!.length).toBe(6);
  });

  it('classifies fastener size text', () => {
    const part = parts.find((x) => x.id === 'beam-R')!;
    const j = (type: any, size: string, count = 2) => ({ type, to: 'x', count, size });
    expect(jointItems(part, j('screw', '#10 × 1-1/4 stainless'))[0].label).toBe('316 wood screw #10 x 1-1/4"');
    expect(jointItems(part, j('screw', '#10-32 × 3/8 316 flat-head machine screws'))[0].label).toBe('316 machine screw #10-32 x 3/8"');
    expect(jointItems(part, j('bolt', '2 × 0.38" × 3-1/4 316 hex bolts')).map((i) => i.label)).toEqual([
      '316 hex bolt 3/8-16 x 3-1/4"', '316 nylon-insert lock nut 3/8-16', '316 fender washer 3/8"',
    ]);
    expect(jointItems(part, j('domino', '5×30 (DF 500)'))[0].label).toBe('Domino DF 500 5x30');
    expect(jointItems(part, j('bolt', '5/8" grade 8 kingpin through the beam'))).toEqual([]);
  });
});
