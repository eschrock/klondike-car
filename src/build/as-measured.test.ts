import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { bowAsMeasuredFiles } from './as-measured';
import { BuildData } from './package';
import { shaperFiles } from './shaper-svg';

describe('D-106: the as-measured bow bulkhead is an extra file; the design stays the default', () => {
  const p = defaultParams();
  it('the default is the design bulkhead, and the Shaper and Laser lists add the as-measured file and its template', () => {
    expect(p.bowAsMeasured).toBe(0);
    const d = new BuildData(buildModel(p), p);
    const design = d.shaper.find((f) => f.fileName === 'bow-bulkhead.svg')!;
    expect(design.alternate).toBeUndefined();
    expect(design.features.some((f) => /Domino/.test(f.label))).toBe(false); // the design's Dominos are marked through the template, not in the file
    const alt = d.shaper.find((f) => f.fileName === 'bow-bulkhead-as-measured.svg')!;
    expect(alt.alternate).toMatch(/as measured/);
    const doms = alt.features.filter((f) => /Domino mortise/.test(f.label));
    expect(doms.length).toBe(2);
    for (const m of doms) { expect(m.bit).toBe('1/4 in'); expect(m.label).toMatch(/one plunge of the 1\/4" bit/); }
    expect(alt.features.find((f) => /side-L-web/.test(f.label))!.label).toMatch(/0\.288 wide/);
    expect(d.shaper.filter((f) => f.alternate).length).toBe(2); // the bulkhead and the transom (D-108)
    expect(d.laser.find((f) => f.id === 'end-templates')).toBeDefined();
    const tpl = d.laser.find((f) => f.id === 'bulkhead-template-as-measured')!;
    expect(tpl.pieces.length).toBe(1);
    expect(d.files.some((f) => f.name === 'shaper/bow-bulkhead-as-measured.svg')).toBe(true);
    expect(d.files.some((f) => f.name === 'laser/bulkhead-template-as-measured.svg')).toBe(true);
  });
  it('the design files do not change with the measurements', () => {
    const zero = { ...p, bowWebGapIn: 0, bowWebEndThickIn: 0, bowDominoTopIn: 0, bowDominoBottomIn: 0 };
    const a = shaperFiles(buildModel(p), p).find((f) => f.fileName === 'bow-bulkhead.svg')!;
    const b = shaperFiles(buildModel(zero), zero).find((f) => f.fileName === 'bow-bulkhead.svg')!;
    expect(a.features.map((f) => f.label)).toEqual(b.features.map((f) => f.label));
  });
  it('no extra file for an end that is not measured, or already as measured in the model', () => {
    const names = (q: typeof p) => bowAsMeasuredFiles(q).shaper.map((f) => f.fileName);
    expect(names({ ...p, bowWebGapIn: 0 })).toEqual(['transom-rear-as-measured.svg']);
    expect(names({ ...p, bowAsMeasured: 1 })).toEqual(['transom-rear-as-measured.svg']);
    expect(names({ ...p, rearWebGapIn: 0 })).toEqual(['bow-bulkhead-as-measured.svg']);
    expect(names({ ...p, rearAsMeasured: 1, bowAsMeasured: 1 })).toEqual([]);
  });
  it('D-108: the as-measured transom is the 5/8" panel, reaching 2-1/4" below the deck, with the rail Domino mortises in its file and its own template', () => {
    const d = new BuildData(buildModel(p), p);
    const design = d.shaper.find((f) => f.fileName === 'transom-rear.svg')!;
    expect(design.features.some((f) => /Domino/.test(f.label))).toBe(false);
    const alt = d.shaper.find((f) => f.fileName === 'transom-rear-as-measured.svg')!;
    expect(alt.alternate).toMatch(/rear transom/);
    expect(alt.heightIn).toBeCloseTo(design.heightIn + (p.rearTransomBottomIn - 1.238), 2);
    const doms = alt.features.filter((f) => /Domino mortise/.test(f.label));
    expect(doms.length).toBe(2);
    for (const m of doms) { expect(m.depthIn).toBeCloseTo(p.rearDominoDepthIn, 4); expect(m.bit).toBe('1/4 in'); }
    expect(alt.features.find((f) => /side-L-web/.test(f.label))!.label).toMatch(/0\.288 wide/);
    expect(alt.heightIn).toBeLessThan(17.625 - 0.125); // fits Eric's 17-5/8" panel
    const tpl = d.laser.find((f) => f.id === 'transom-template-as-measured')!;
    expect(tpl.pieces.length).toBe(1);
  });
});
