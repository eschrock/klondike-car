import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { buildModel } from '../model';
import { checkTruckFit } from '../truck/fit';
import { LIGHT_OF_ID, riderSweep, runAround } from '../analysis/rider-sweep';
import type { Status } from '../analysis/types';
import { cargoText, FRONT_END_IDS, headline, lightTexts, limitLine, failReason, weightNote, limiterName, limiterAdvice, PHASE3B_CHECK_IDS } from './simple-text';
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
    expect(t.strength.text).not.toMatch(/design limit|turntable|bolster/i);
    for (const x of Object.values(t)) expect(x.text).not.toMatch(/NaN|\?|undefined/);
  });
  it('words the two-tier headline from the sweep (M3)', () => {
    const mk = (statuses: Status[], at: number, from = 50) => {
      const points = statuses.map((status, i) => ({ w: from + i * 10, status, worst: { id: 'kingpin-bracket', label: '', util: 1, status } }));
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
    expect(bad.text).toContain('bracket that holds a steering pivot');
    expect(bad.sub).toBe('This cart is comfortably safe for riders 50–190 lb. The new steering front end (spindle, bracket, rod and link sizes) is still being verified.'); // kingpin-bracket is a front-end row
    // everything fails: a next step, and no stray " could fail"
    const none = headline(150, mk(Array(21).fill('fail'), 150));
    expect(none.sub).toMatch(/No rider weight from 50 to 250 lb passes/);
    expect(none.text).not.toMatch(/NaN|undefined|\?/);
  });
  it('honesty fix: when NO weight is safe the Simple view says so plainly, names the limiter and the front-end note, and has no NaN or empty text', () => {
    const t = lightTexts({ p, checks: sweep.operatingChecks, fit });
    expect(sweep.safe).toBeNull();
    const hd = headline(p.riderMassLb, sweep);
    expect(hd.tone).toBe('fail');
    expect(hd.ok).toBe(false);
    // The limiter at the defaults is a new front-end row, so the headline says "not yet shown safe" and keeps the one-line front-end note.
    expect(FRONT_END_IDS.has(sweep.operating.worst!.id)).toBe(true);
    expect(hd.text).toMatch(/^Not yet shown safe for a 150 lb rider: .+\.$/);
    expect(hd.sub).toMatch(/No rider weight from 50 to 250 lb passes the checks yet\. What stops it: .+\./);
    expect(hd.sub).toMatch(/is still being verified\./);
    for (const x of [hd.text, hd.sub ?? '', t.strength.text, weightNote(150, 'fail', sweep.operating.worst?.id)]) expect(x).not.toMatch(/NaN|undefined|\?|Infinity/);
    expect(t.strength.status).toBe('fail');
    expect(t.strength.text).toMatch(/shortfall in margin, not a forecast that it will break/);
    expect(limitLine('below', sweep.safe, sweep.lowLimit)).toBeNull();
  });
  it('a range that excludes the default rider but has safe light weights reads cleanly', () => {
    const pts = Array.from({ length: 21 }, (_, i) => ({ w: 50 + 10 * i, status: (50 + 10 * i <= 100 ? 'pass' : 'fail') as Status, worst: { id: 'kingpin-bracket', label: '', util: 1, status: 'fail' as Status }, fails: ['kingpin-bracket'] }));
    const at = pts[10];
    const hd = headline(150, { points: pts as never, fromLb: 50, toLb: 250, stepLb: 10, safe: null, green: null, operating: at as never });
    expect(hd.text).toMatch(/^Not yet shown safe for a 150 lb rider/);
    expect(hd.sub).toBe('This cart is comfortably safe for riders 50–100 lb. Everything else passes at this weight. The new steering front end (spindle, bracket, rod and link sizes) is still being verified.');
    // A failing row that is not a front-end row gets the plain wording and no note.
    const ptsB = pts.map((q) => ({ ...q, worst: { ...q.worst, id: 'rails' }, fails: ['rails'] }));
    const hb = headline(150, { points: ptsB as never, fromLb: 50, toLb: 250, stepLb: 10, safe: null, green: null, operating: ptsB[10] as never });
    expect(hb.text).toMatch(/^Not safe for a 150 lb rider/);
    expect(hb.sub).not.toMatch(/verified/);
  });
  it('names the limiting reason at an end, without jargon', () => {
    expect(limitLine('below', { loLb: 70, hiLb: 230, openLow: false, openHigh: false }, { id: 'pitch-rear', label: '', util: 1, status: 'fail' })).toBe('Below 70 lb: a hard pull uphill can lift the front wheels.');
    expect(failReason('')).toBe('a safety check fails');
    expect(failReason('unknown-check')).toBe('a safety check fails');
    for (const id of Object.keys(LIGHT_OF_ID)) expect(failReason(id)).not.toMatch(/turntable could|bolster|side bearer|tongue could be|bearing groove/i);
    expect(failReason('kingpin-bracket')).toMatch(/steering pivot/);
    for (const gone of ['kingpin-strike', 'steer-stops', 'turntable-ring', 'kingpin-plates', 'roll-side-bearer', 'pitch-path']) expect(failReason(gone)).toBe('a safety check fails'); // the old front-end rows are gone
  });
  it('describes one weight for the bar note', () => {
    expect(weightNote(190, 'marginal', 'kingpin-bracket')).toBe('190 lb: close to the limit (a bracket that holds a steering pivot in a hard bump).');
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

  it('the Hills light no longer carries a stopping-distance sentence (ride mode is gone, D-53); it names the brake handle force and the pitch rows', () => {
    const t = lightTexts({ p, checks: sweep.operatingChecks, fit }).hills;
    expect(t.text).not.toMatch(/stops in about|riding speed/);
    expect(t.text).toMatch(/brake handle/);
  });

  it('the Steering light names a failing kinematic row in plain words', () => {
    const t = lightTexts({ p, checks: [...sweep.operatingChecks.filter((c) => c.id !== 'steer-kin'), row('steer-kin', 2, 1, 'fail')], fit }).steering;
    expect(t.status).toBe('fail');
    expect(t.text).toMatch(/do not turn together/);
    expect(t.text).not.toMatch(/NaN|undefined/);
  });
});

describe('cargo card wording (D-53)', () => {
  const base = {
    payloadLb: 250, statusAtPayload: 'pass' as Status, counts: { pass: 30, marginal: 0, fail: 0 }, capacityLb: null as number | null, comfortableLb: null as number | null, maxLb: 600,
    limiter: null, openIds: [] as string[], capacityOtherLb: null, limiterOther: null, alwaysFailing: [], cargoFailsAtPayload: [], rows: [],
    bed: { x0: 8, xFull: 36, xLoadEnd: 37, loadWidthIn: 20, loadLengthIn: 29, xStop: 48, widthIn: 26.75, stopWidthIn: 14, heightIn: 7, straightLengthIn: 6, fullLengthIn: 28, totalLengthIn: 40, areaIn2: 900, fullAreaIn2: 700, boxTopIn: 5 },
    stow: { applicable: true, fits: true, status: 'pass' as Status, marginIn: { length: 0.5, width: 2, height: 0.4 } }, rearTraction: 1.2,
  };
  it('says "hauls N lb or more" when nothing fails up to the end of the ladder, and the bed and the stow in words', () => {
    const t = cargoText(base);
    expect(t.tone).toBe('pass');
    expect(t.headline).toBe('Hauls 600 lb or more after the race');
    expect(t.lines.join(' ')).toMatch(/27 in wide at the box and 20 in or wider for 29 in, 7 in to the top of the sides, 40 in long/);
    expect(t.lines.join(' ')).toMatch(/lie flat in the box/);
    expect(t.lines.join(' ')).not.toMatch(/rear brake alone/);
  });
  it('rounds the capacity to 5 lb, goes red below the target and names the limiter and the rows that fail empty', () => {
    const row = (id: string) => ({ id, label: id, utilAtPayload: 1.5, statusAtPayload: 'fail' as Status, failAtLb: 20, marginalAtLb: 10, fixed: false });
    const t = cargoText({ ...base, capacityLb: 154, limiter: row('wheel-rating'), alwaysFailing: [row('bellcrank')], counts: { pass: 20, marginal: 1, fail: 3 }, cargoFailsAtPayload: [row('wheel-rating')], statusAtPayload: 'fail',
      limiterOther: row('axle-stress'), capacityOtherLb: 199, stow: { ...base.stow, status: 'marginal' }, rearTraction: 0.62 });
    expect(t.tone).toBe('fail');
    expect(t.headline).toBe('Hauls up to 155 lb after the race');
    const all = t.lines.join(' ');
    expect(all).toMatch(/What stops it first: a wheel in a hard bump\. 1 other check fails even with nothing on the bed/);
    expect(all).toMatch(/next limit is an axle, at about 200 lb/);
    expect(all).toMatch(/fit in the box, but only just/);
    expect(all).toMatch(/rear brake alone holds about 62%/);
    expect(all).not.toMatch(/NaN|undefined/);
  });
  it('is amber when the design payload is within 10% of a limit', () => {
    expect(cargoText({ ...base, capacityLb: 300, comfortableLb: 200 }).tone).toBe('warn');
  });
});
