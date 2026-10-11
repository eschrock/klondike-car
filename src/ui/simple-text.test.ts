import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { buildModel } from '../model';
import { checkTruckFit } from '../truck/fit';
import { riderSweep } from '../analysis/rider-sweep';
import { headline, lightTexts, limitLine } from './simple-text';

const p = defaultParams();
const fit = checkTruckFit(p, (v) => buildModel(p, v));
const sweep = riderSweep(p, { fit });

describe('simple wording', () => {
  it('generates a sentence per light from the check values', () => {
    const t = lightTexts({ p, checks: sweep.operatingChecks, fit });
    expect(t.tipping.text).toMatch(/side slope/);
    expect(t.tipping.text).toMatch(/30°/);
    expect(t.steering.text).toMatch(/ft circle/);
    expect(t.truck.text).toMatch(/Tacoma/);
    expect(t.strength.text).toMatch(/% of its design limit/);
    for (const x of Object.values(t)) expect(x.text).not.toMatch(/NaN|\?|undefined/);
  });
  it('words the range headline', () => {
    expect(headline(150, { loLb: 70, hiLb: 230, openLow: false, openHigh: false }, null, 50, 250).text).toBe('Safe for riders about 70–230 lb');
    expect(headline(150, { loLb: 50, hiLb: 220, openLow: true, openHigh: false }, null, 50, 250).text).toBe('Safe for riders up to about 220 lb');
    const bad = headline(240, null, { id: 'kingpin-strike', label: '', util: 1.2, status: 'fail' }, 50, 250);
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain('240');
  });
  it('names the limiting reason at an end', () => {
    expect(limitLine('below', { loLb: 70, hiLb: 230, openLow: false, openHigh: false }, { id: 'pitch-rear', label: '', util: 1, status: 'fail' })).toBe('Below 70 lb: a hard uphill pull can lift the front wheels');
  });
});
