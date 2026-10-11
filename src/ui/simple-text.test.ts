import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { buildModel } from '../model';
import { checkTruckFit } from '../truck/fit';
import { LIGHT_OF_ID, riderSweep, runAround } from '../analysis/rider-sweep';
import type { Status } from '../analysis/types';
import { headline, lightTexts, limitLine, failReason, weightNote } from './simple-text';

const p = defaultParams();
const fit = checkTruckFit(p, (v) => buildModel(p, v));
const sweep = riderSweep(p, { fit });

describe('simple wording', () => {
  it('generates a sentence per light from the check values', () => {
    const t = lightTexts({ p, checks: sweep.operatingChecks, fit });
    expect(t.tipping.text).toMatch(/side slope/);
    expect(t.tipping.text).toMatch(/30°/);
    expect(t.steering.text).toMatch(/circle [\d.]+ ft across/);
    expect(t.truck.text).toMatch(/Tacoma/);
    expect(t.strength.text).toMatch(/safety margin|Close to the limit|past what it can take/);
    expect(t.strength.text).not.toMatch(/design limit|kingpin|turntable/i);
    for (const x of Object.values(t)) expect(x.text).not.toMatch(/NaN|\?|undefined/);
  });
  it('words the two-tier headline from the sweep (M3)', () => {
    const mk = (statuses: Status[], at: number, from = 50) => {
      const points = statuses.map((status, i) => ({ w: from + i * 10, status, worst: { id: 'kingpin-strike', label: '', util: 1, status } }));
      const idx = (at - from) / 10;
      const opStatus = points[idx].status;
      const g = (ok: (s: Status) => boolean) => runAround(points as never, points[idx] as never, ok).run;
      return {
        points: points as never, fromLb: from, toLb: from + (statuses.length - 1) * 10, stepLb: 10,
        operating: points[idx] as never,
        safe: opStatus === 'fail' ? null : g((s) => s !== 'fail'),
        green: opStatus === 'pass' ? g((s) => s === 'pass') : null,
      };
    };
    // green 50-190, yellow 200-220, red 230+  (the screenshot case)
    const st: Status[] = [];
    for (let w = 50; w <= 250; w += 10) st.push(w <= 190 ? 'pass' : w <= 220 ? 'marginal' : 'fail');
    const h = headline(150, mk(st, 150));
    expect(h.text).toBe('Comfortably safe for riders up to 190 lb');
    expect(h.sub).toBe('200–220 lb are close to the limit.');
    expect(h.ok).toBe(true);
    expect(h.text).not.toMatch(/220/);
    // all green
    expect(headline(150, mk(Array(21).fill('pass'), 150)).text).toBe('Safe for every rider from 50 to 250 lb');
    // no yellow: plain "Safe"
    const noY: Status[] = []; for (let w = 50; w <= 250; w += 10) noY.push(w <= 190 ? 'pass' : 'fail');
    expect(headline(150, mk(noY, 150)).text).toBe('Safe for riders up to 190 lb');
    // this rider is yellow: never a green headline
    const yRider = headline(210, mk(st, 210));
    expect(yRider.tone).toBe('warn');
    expect(yRider.ok).toBe(false);
    expect(yRider.sub).toBe('Comfortably safe for riders 50–190 lb.');
    // this rider fails
    const bad = headline(240, mk(st, 240));
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain('240');
    expect(bad.text).toContain('steering pin');
    expect(bad.sub).toBe('This cart is comfortably safe for riders 50–190 lb.');
    // everything fails: a next step, and no stray " could fail"
    const none = headline(150, mk(Array(21).fill('fail'), 150));
    expect(none.sub).toMatch(/No rider weight is safe/);
  });
  it('names the limiting reason at an end, without jargon', () => {
    expect(limitLine('below', { loLb: 70, hiLb: 230, openLow: false, openHigh: false }, { id: 'pitch-rear', label: '', util: 1, status: 'fail' })).toBe('Below 70 lb: a hard pull uphill can lift the front wheels.');
    expect(failReason('')).toBe('a safety check fails');
    expect(failReason('unknown-check')).toBe('a safety check fails');
    for (const id of Object.keys(LIGHT_OF_ID)) expect(failReason(id)).not.toMatch(/turntable could|bolster|side bearer|tongue could be|bearing groove/i);
    expect(failReason('kingpin-strike')).toMatch(/steering pin/);
  });
  it('describes one weight for the bar note', () => {
    expect(weightNote(190, 'marginal', 'kingpin-strike')).toBe('190 lb: close to the limit (the steering pin in a curb strike).');
    expect(weightNote(150, 'pass', undefined)).toBe('150 lb: OK.');
  });
});
