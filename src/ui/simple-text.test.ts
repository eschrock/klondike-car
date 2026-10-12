import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { buildModel } from '../model';
import { checkTruckFit } from '../truck/fit';
import { LIGHT_OF_ID, riderSweep, runAround } from '../analysis/rider-sweep';
import type { Status } from '../analysis/types';
import { LIGHT_CHECK_IDS, cargoText, FRONT_END_IDS, headline, lightTexts, limitLine, failReason, weightNote, limiterName, limiterAdvice, PHASE3B_CHECK_IDS } from './simple-text';
import type { AnalysisCheck } from '../analysis/types';

const p = defaultParams();
/** Words a parent has not met, or that name parts the cart no longer has (the Ackermann front end; the brake handle). The pivoting axle's kingpin and tongue plate are "the bolt the front axle pivots on" and "the pull arm" in words. */
const JARGON = /kingpin|king beam|thrust|uhmw|spindle|tongue|turntable|bolster|side bearer|bellcrank|drag link|tie rod|ackermann|steering pivot|brake handle|brake lever|hand lever/i;
const fit = checkTruckFit(p, (v) => buildModel(p, v));
const sweep = riderSweep(p, { fit });
/** A hand-made analysis row. */
const row = (id: string, value: number, limit: number, status: AnalysisCheck['status'] = 'pass') =>
  ({ id, label: id, group: 'Hills', value, limit, unit: 'ft', sense: '<=', status, how: '', util: value / limit }) as unknown as AnalysisCheck;

describe('simple wording', () => {
  it('generates a sentence per light from the check values', () => {
    const t = lightTexts({ p, checks: sweep.operatingChecks, fit });
    expect(t.tipping.text).toMatch(/side slope/);
    expect(t.tipping.text).toMatch(/30°/);
    expect(t.steering.text).toMatch(/pivots on one big bolt and turns about 20° each way; the turning circle is about 20 ft across/);
    expect(t.truck.text).toMatch(/Tacoma/);
    expect(t.strength.text).toMatch(/safety margin|Close to the limit|load this design allows/);
    expect(t.strength.text).not.toMatch(/design limit|turntable|bolster/i);
    for (const x of Object.values(t)) expect(x.text).not.toMatch(/NaN|\?|undefined/);
    for (const x of Object.values(t)) expect(x.text).not.toMatch(JARGON);
  });
  it('words the two-tier headline from the sweep (M3)', () => {
    const mk = (statuses: Status[], at: number, from = 50) => {
      const points = statuses.map((status, i) => ({ w: from + i * 10, status, worst: { id: 'kingpin', label: '', util: 1, status } }));
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
    expect(bad.text).toContain('Not safe for a 240 lb rider');
    expect(bad.text).toContain('the bolt the front axle pivots on'); // kingpin is a front-end row, said in plain words
    expect(bad.sub).toBe('This cart is comfortably safe for riders 50–190 lb.');
    // everything fails: a next step, and no stray " could fail"
    const none = headline(150, mk(Array(21).fill('fail'), 150));
    expect(none.sub).toMatch(/No rider weight from 50 to 250 lb passes/);
    expect(none.text).not.toMatch(/NaN|undefined|\?/);
  });
  /** A hand-made sweep where nothing is safe and `id` is the limiter (the real default sweep depends on rows other agents are still changing). */
  const noSafe = (id: string, fails: string[] = [id]) => {
    const pts = Array.from({ length: 21 }, (_, i) => ({ w: 50 + 10 * i, status: 'fail' as Status, worst: { id, label: '', util: 1.4, status: 'fail' as Status }, fails }));
    return { points: pts as never, fromLb: 50, toLb: 250, stepLb: 10, safe: null, green: null, operating: pts[10] as never };
  };
  it('honesty fix: when NO weight is safe the Simple view says so plainly, names the limiter, and has no NaN or empty text', () => {
    const sw = noSafe('kingpin');
    expect(FRONT_END_IDS.has('kingpin')).toBe(true);
    const hd = headline(150, sw);
    expect(hd.tone).toBe('fail');
    expect(hd.ok).toBe(false);
    // The front end is decided (D-56): a failing front-end row reads like any other failing row, with no "still being decided" note, and says the rest of the cart passes.
    expect(hd.text).toMatch(/^Not safe for a 150 lb rider: .+\.$/);
    expect(hd.sub).toMatch(/No rider weight from 50 to 250 lb passes the checks yet\. What stops it: .+\./);
    expect(hd.sub).toMatch(/Everything else passes at this weight/); // fails lists only front-end rows
    expect(hd.sub).toMatch(/To change that: .+, or press Reset\./);
    for (const x of [hd.text, hd.sub ?? '', weightNote(150, 'fail', 'kingpin')]) expect(x).not.toMatch(/NaN|undefined|\?|Infinity|still being|not yet shown/i);
    expect(hd.text).not.toMatch(JARGON);
    // A non-front-end limiter reads plainly too, without the "everything else" sentence.
    const hr = headline(150, noSafe('rails'));
    expect(hr.text).toMatch(/^Not safe for a 150 lb rider: the side rails could crack\.$/);
    expect(hr.sub).toMatch(/To change that: .+, or press Reset\./);
    expect(hr.sub).not.toMatch(/Everything else/);
    // With the real default sweep (whatever fails today), the headline has no stray text either.
    const real = headline(p.riderMassLb, sweep);
    for (const x of [real.text, real.sub ?? '']) expect(x).not.toMatch(/NaN|undefined|\?|still being/);
    expect(limitLine('below', sweep.safe, sweep.lowLimit)).toBe(sweep.safe ? limitLine('below', sweep.safe, sweep.lowLimit) : null);
  });
  it('the Strength light for a failing front-end row names it in plain words; the wording holds for every front-end row', () => {
    const mk = (id: string) => [row(id, 1.6, 1, 'fail')];
    const t = lightTexts({ p, checks: mk('kingpin'), fit }).strength;
    expect(t.status).toBe('fail');
    expect(t.text).toContain('the bolt the front axle pivots on');
    expect(t.text).toMatch(/160%/);
    expect(t.text).not.toMatch(JARGON);
    expect(t.text).not.toMatch(/still being/);
    for (const id of FRONT_END_IDS) expect(lightTexts({ p, checks: mk(id), fit }).strength.text, id).not.toMatch(JARGON);
    const r = lightTexts({ p, checks: mk('rails'), fit }).strength;
    expect(r.text).toContain('the side rails');
  });
  it('a range that excludes the default rider but has safe light weights reads cleanly', () => {
    const pts = Array.from({ length: 21 }, (_, i) => ({ w: 50 + 10 * i, status: (50 + 10 * i <= 100 ? 'pass' : 'fail') as Status, worst: { id: 'kingpin', label: '', util: 1, status: 'fail' as Status }, fails: ['kingpin'] }));
    const at = pts[10];
    const hd = headline(150, { points: pts as never, fromLb: 50, toLb: 250, stepLb: 10, safe: null, green: null, operating: at as never });
    expect(hd.text).toMatch(/^Not safe for a 150 lb rider/);
    expect(hd.sub).toBe('This cart is comfortably safe for riders 50–100 lb. Everything else passes at this weight.');
    // A failing row that is not a front-end row gets no "everything else" sentence.
    const ptsB = pts.map((q) => ({ ...q, worst: { ...q.worst, id: 'rails' }, fails: ['rails'] }));
    const hb = headline(150, { points: ptsB as never, fromLb: 50, toLb: 250, stepLb: 10, safe: null, green: null, operating: ptsB[10] as never });
    expect(hb.text).toMatch(/^Not safe for a 150 lb rider/);
    expect(hb.sub).toBe('This cart is comfortably safe for riders 50–100 lb.');
  });
  it('names the limiting reason at an end, without jargon', () => {
    expect(limitLine('below', { loLb: 70, hiLb: 230, openLow: false, openHigh: false }, { id: 'pitch-rear', label: '', util: 1, status: 'fail' })).toBe('Below 70 lb: a hard pull uphill can lift the front wheels.');
    expect(failReason('')).toBe('a safety check fails');
    expect(failReason('unknown-check')).toBe('a safety check fails');
    for (const id of Object.keys(LIGHT_OF_ID)) expect(failReason(id)).not.toMatch(/turntable could|bolster|side bearer|tongue could be|bearing groove/i);
    expect(failReason('bridle-eye')).toMatch(/rope shackle/);
    expect(failReason('kingpin')).toMatch(/bolt the front axle pivots on/);
    expect(failReason('steer-clear')).toMatch(/tire could rub the body/);
    expect(failReason('steer-stops')).toMatch(/steering stop/);
    // The old front-end rows are gone (Ackermann steering, casters, the old tongue; D-54, D-56).
    for (const gone of ['kingpin-strike', 'turntable-ring', 'kingpin-plates', 'roll-side-bearer', 'pitch-path', 'kingpin-bracket', 'spindle-stub', 'spindle-fatigue', 'kingpin-bolt', 'wheel-retention', 'beam-front', 'tie-rod', 'drag-link', 'bellcrank', 'steer-stop-load', 'tongue', 'tongue-tie', 'steer-kin', 'steer-lock', 'caster-mount', 'caster-clear', 'tip-swivel']) {
      expect(failReason(gone), gone).toBe('a safety check fails');
      expect(limiterName(gone), gone).toBe('a safety check');
    }
    // Every wording for every known row is free of the removed parts' words, the hand brake and the old ride mode.
    for (const id of [...Object.keys(LIGHT_OF_ID), ...PHASE3B_CHECK_IDS]) {
      for (const t of [failReason(id), limiterName(id), limiterAdvice(id)]) expect(t, id).not.toMatch(JARGON);
    }
  });
  it('describes one weight for the bar note', () => {
    expect(weightNote(190, 'marginal', 'kingpin')).toBe('190 lb: close to the limit (the bolt the front axle pivots on when the cart is pulled hard).');
    expect(weightNote(150, 'pass', undefined)).toBe('150 lb: OK.');
  });
});

describe('Phase 3b rows in the Simple view (spec 6.3)', () => {
  it('every new check id has a plain name and a failure sentence; none use the old Ackermann words or the pivot parts\' own names', () => {
    for (const id of PHASE3B_CHECK_IDS) {
      expect(failReason(id), id).not.toBe('a safety check fails');
      expect(limiterName(id), id).not.toBe('a safety check');
      expect(limiterAdvice(id), id).not.toBe('adjust the cart in the controls below');
      for (const t of [failReason(id), limiterName(id), limiterAdvice(id), weightNote(150, 'fail', id), weightNote(150, 'marginal', id)])
        expect(t, id).not.toMatch(/turntable|bolster|kingpin|king beam|thrust|spindle|tongue|side bearer|NaN|undefined|\?/i);
    }
  });


  it('the Hills light has no stopping-distance sentence (ride mode is gone, D-53); it speaks of foot force on the brake pedal (D-55) and the pitch rows', () => {
    const t = lightTexts({ p, checks: sweep.operatingChecks, fit }).hills;
    expect(t.text).not.toMatch(/stops in about|riding speed/);
    expect(t.text).toMatch(/brake pedal/);
    expect(t.text).toMatch(/foot force/);
    expect(t.text).not.toMatch(/brake handle|lever|hand/i);
    const fail = lightTexts({ p, checks: [row('brake-force', 80, 30, 'fail'), row('pitch-rear', 1, 1, 'fail')], fit }).hills;
    expect(fail.status).toBe('fail');
    expect(fail.text).toMatch(/takes 80 lb of foot force on the brake pedal/);
    expect(fail.text).toMatch(/could lift the front wheels/);
  });

  it('the Steering light says the front axle pivots on one big bolt, gives the turning circle, and names a tire that rubs in plain words', () => {
    const base = sweep.operatingChecks.filter((c) => c.id !== 'steer-clear');
    const ok = lightTexts({ p, checks: [...base, row('steer-clear', 1.3, 0.75)], fit }).steering;
    expect(ok.text).toBe('The front axle pivots on one big bolt and turns about 20° each way; the turning circle is about 20 ft across. The front tires clear the body at full turn.');
    expect(ok.status).toBe('pass');
    expect(ok.text).not.toMatch(JARGON);
    // The turning circle follows the lock: 12 degrees is a much wider circle (2 x WB / tan 12 = 34.5 ft).
    const wide = lightTexts({ p: { ...p, steerLockDeg: 12 }, checks: [row('steer-clear', 3, 0.75)], fit }).steering;
    expect(wide.text).toMatch(/turns about 12° each way; the turning circle is about 35 ft across/);
    const t = lightTexts({ p, checks: [...base, row('steer-clear', 0.2, 0.75, 'fail')], fit }).steering;
    expect(t.status).toBe('fail');
    expect(t.text).toMatch(/At full turn a front tire would rub the body/);
    expect(t.text).not.toMatch(/NaN|undefined/);
    const m = lightTexts({ p, checks: [...base, row('steer-clear', 0.8, 0.75, 'marginal')], fit }).steering;
    expect(m.status).toBe('marginal');
    expect(m.text).toMatch(/only just clear the body/);
    // Without the clearance row (not built yet) it still reads, as information.
    const none = lightTexts({ p, checks: base, fit }).steering;
    expect(none.status).toBe('info');
    expect(none.text).toMatch(/turning circle is about 20 ft across\.$/);
    expect(limiterAdvice('steer-clear')).toBe('make the body narrower or the wheels farther apart');
    expect(limiterName('turn-radius')).toBe('turning');
  });
  it('the Tipping light takes the lower of the straight and (if the row exists) turned-axle angles, and uses the plain sentence', () => {
    const deg = (id: string, v: number, status: AnalysisCheck['status'] = 'pass') => ({ ...row(id, v, 40, status), unit: 'deg' }) as AnalysisCheck;
    const t = lightTexts({ p, checks: [deg('tip-straight', 45)], fit }).tipping;
    expect(t.status).toBe('pass');
    expect(t.text).toMatch(/^Stays upright on a 45° side slope\./);
    const both = lightTexts({ p, checks: [deg('tip-straight', 45), deg('tip-lock', 41.7)], fit }).tipping;
    expect(both.text).toMatch(/^Stays upright on a 41° side slope\./);
    const f = lightTexts({ p, checks: [deg('tip-straight', 45), deg('tip-lock', 29.4, 'fail')], fit }).tipping;
    expect(f.status).toBe('fail');
    expect(f.text).toMatch(/Could tip over on a side slope of 29°; it should hold at least 40°/);
    expect(LIGHT_CHECK_IDS.tipping).toEqual(['tip-straight']);
    expect(LIGHT_CHECK_IDS.steering).toEqual(['turn-radius', 'steer-clear']);
  });
  it('Advanced-link rows exist: every id a light points to is a real row id of the analysis', () => {
    for (const ids of Object.values(LIGHT_CHECK_IDS)) for (const id of ids) expect(sweep.operatingChecks.some((c) => c.id === id) || id === 'truck-fit', id).toBe(true);
    // The front-end rows the Simple view words are the same ids the analysis builds (D-56).
    for (const id of FRONT_END_IDS) expect(sweep.operatingChecks.some((c) => c.id === id), id).toBe(true);
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
    expect(t.lines.join(' ')).toMatch(/27 in wide all the way, 40 in long out to the foot stop, and 7 in to the top of the sides at the low \(bow\) end/);
    expect(t.lines.join(' ')).toMatch(/lie flat in the box/);
    expect(t.lines.join(' ')).not.toMatch(/holds about \d+%/);
  });
  it('rounds the capacity to 5 lb, goes red below the target and names the limiter and the rows that fail empty', () => {
    const row = (id: string) => ({ id, label: id, utilAtPayload: 1.5, statusAtPayload: 'fail' as Status, failAtLb: 20, marginalAtLb: 10, fixed: false });
    const t = cargoText({ ...base, capacityLb: 154, limiter: row('wheel-rating'), alwaysFailing: [row('kingpin')], counts: { pass: 20, marginal: 1, fail: 3 }, cargoFailsAtPayload: [row('wheel-rating')], statusAtPayload: 'fail',
      limiterOther: row('axle-stress'), capacityOtherLb: 199, stow: { ...base.stow, status: 'marginal' }, rearTraction: 0.62 });
    expect(t.tone).toBe('fail');
    expect(t.headline).toBe('Hauls up to 155 lb after the race');
    const all = t.lines.join(' ');
    expect(all).toMatch(/What stops it first: a rear wheel in a hard bump\. 1 other check fails even with nothing on the bed/);
    expect(all).toMatch(/next limit is an axle, at about 200 lb/);
    expect(all).toMatch(/fit in the box, but only just/);
    expect(all).toMatch(/holds about 62%/); // wording of the brake itself belongs to the brake rows (D-55)
    expect(all).not.toMatch(/NaN|undefined/);
  });
  it('is amber when the design payload is within 10% of a limit', () => {
    expect(cargoText({ ...base, capacityLb: 300, comfortableLb: 200 }).tone).toBe('warn');
  });
});
