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
    expect(alt.features.filter((f) => /Domino mortise/.test(f.label)).length).toBe(2);
    expect(alt.features.find((f) => /side-L-web/.test(f.label))!.label).toMatch(/0\.288 wide/);
    expect(d.shaper.filter((f) => f.alternate).length).toBe(1);
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
  it('no extra file when nothing is measured, or when the model is already as measured', () => {
    expect(bowAsMeasuredFiles({ ...p, bowWebGapIn: 0 }).shaper.length).toBe(0);
    expect(bowAsMeasuredFiles({ ...p, bowAsMeasured: 1 }).shaper.length).toBe(0);
  });
});
