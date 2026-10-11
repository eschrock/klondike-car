import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { buildModel } from '../model';
import { checkTruckFit } from '../truck/fit';
import { LIGHT_OF_ID, riderSweep, runAround } from '../analysis/rider-sweep';
import type { Status } from '../analysis/types';
import { headline, lightTexts, limitLine, failReason, weightNote, limiterName, limiterAdvice, PHASE3B_CHECK_IDS } from './simple-text';
import type { AnalysisCheck } from '../analysis/types';

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
    expect(t.strength.text).toMatch(/safety margin|Close to the limit|load this design allows/);
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
    expect(bad.sub).toBe('This cart is comfortably safe for riders 50–190 lb. The front end (steering stops, plates and pivot) is being redesigned.'); // kingpin-strike is a front-end row
    // everything fails: a next step, and no stray " could fail"
    const none = headline(150, mk(Array(21).fill('fail'), 150));
    expect(none.sub).toMatch(/No rider weight from 50 to 250 lb passes/);
    expect(none.text).not.toMatch(/NaN|undefined|\?/);
  });
  it('honesty fix: when NO weight is safe (the defaults today) the Simple view says so plainly, names the limiter and the front-end redesign, and has no NaN or empty text', () => {
    const t = lightTexts({ p, checks: sweep.operatingChecks, fit });
    expect(sweep.safe).toBeNull();
    const hd = headline(p.riderMassLb, sweep);
    expect(hd.tone).toBe('fail');
    expect(hd.ok).toBe(false);
    expect(hd.text).toBe('Not yet shown safe for a 150 lb rider: the steering stops could crush or loosen at full turn.');
    expect(hd.sub).toMatch(/No rider weight from 50 to 250 lb passes the checks yet\. What stops it: the steering stops at full turn\./);
    expect(hd.sub).toMatch(/Everything else passes at this weight\. The front end .* is being redesigned\./);
    for (const x of [hd.text, hd.sub ?? '', t.strength.text, weightNote(150, 'fail', sweep.operating.worst?.id)]) expect(x).not.toMatch(/NaN|undefined|\?|Infinity/);
    expect(t.strength.status).toBe('fail');
    expect(t.strength.text).toMatch(/shortfall in margin, not a forecast that it will break/);
    expect(limitLine('below', sweep.safe, sweep.lowLimit)).toBeNull();
  });
  it('a range that excludes the default rider but has safe light weights reads cleanly', () => {
    const pts = Array.from({ length: 21 }, (_, i) => ({ w: 50 + 10 * i, status: (50 + 10 * i <= 100 ? 'pass' : 'fail') as Status, worst: { id: 'steer-stops', label: '', util: 1, status: 'fail' as Status }, fails: ['steer-stops'] }));
    const at = pts[10];
    const hd = headline(150, { points: pts as never, fromLb: 50, toLb: 250, stepLb: 10, safe: null, green: null, operating: at as never });
    expect(hd.text).toMatch(/^Not yet shown safe for a 150 lb rider/);
    expect(hd.sub).toBe('This cart is comfortably safe for riders 50–100 lb. Everything else passes at this weight. The front end (steering stops, plates and pivot) is being redesigned.');
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

describe('Phase 3b rows in the Simple view (spec 6.3)', () => {
  it('every new check id has a plain name and a failure sentence; none mention turntable, bolster or kingpin plates', () => {
    for (const id of PHASE3B_CHECK_IDS) {
      expect(failReason(id), id).not.toBe('a safety check fails');
      expect(limiterName(id), id).not.toBe('a safety check');
      expect(limiterAdvice(id), id).not.toBe('adjust the cart in the controls below');
      for (const t of [failReason(id), limiterName(id), limiterAdvice(id), weightNote(150, 'fail', id), weightNote(150, 'marginal', id)])
        expect(t, id).not.toMatch(/turntable|bolster|kingpin plates|side bearer|NaN|undefined|\?/i);
    }
  });

  const row = (id: string, value: number, limit: number, status: AnalysisCheck['status'] = 'pass') =>
    ({ id, label: id, group: 'Hills', value, limit, unit: 'ft', sense: '<=', status, how: '', util: value / limit }) as unknown as AnalysisCheck;

  it('the Hills light adds the stopping-distance sentence when the brake-stop row exists, and degrades silently when it does not', () => {
    const base = sweep.operatingChecks;
    const without = lightTexts({ p, checks: base, fit }).hills.text;
    expect(without).not.toMatch(/stops in about/);
    const withRow = lightTexts({ p, checks: [...base, row('brake-stop', 34.4, 40)], fit }).hills;
    expect(withRow.text).toContain(`On an ${p.rideGoSlopeDeg}° hill at ${p.rideSpeedMph} mph it stops in about 34 ft.`);
    const bad = lightTexts({ p, checks: [...base, row('brake-stop', 52, 40, 'fail')], fit }).hills;
    expect(bad.status).toBe('fail');
    expect(bad.text).toMatch(/longer than the 40 ft/);
  });

  it('the Steering light names a failing kinematic row in plain words', () => {
    const t = lightTexts({ p, checks: [...sweep.operatingChecks, row('steer-kin', 2, 1, 'fail')], fit }).steering;
    expect(t.status).toBe('fail');
    expect(t.text).toMatch(/do not turn together/);
    expect(t.text).not.toMatch(/NaN|undefined/);
  });
});
