import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { hillStopSentence, requiredMuFor, rideRules, rideStopFt, rideVerdict } from './ride-rules';

const p = defaultParams();
const verdicts = (r: ReturnType<typeof rideRules>) => r.table.rows.map((row) => row.cells.map((c) => c.verdict[0]).join(''));

describe('ride rules (spec 6.1, 6.2)', () => {
  it('the table has rows 5, 8 and 10 degrees and measured friction columns 0.3 to 0.7, already derated', () => {
    const r = rideRules(p);
    expect(r.table.rows.map((x) => x.slopeDeg)).toEqual([5, 8, 10]);
    expect(r.table.columns).toEqual([0.3, 0.4, 0.5, 0.6, 0.7]);
    const c = r.table.rows[0].cells[2];
    expect(c.usableMu).toBeCloseTo(0.5 * p.rideMuDerate, 9);
  });

  it('GO needs 0.4 usable up to 8 deg and 0.5 up to 10 deg; above 10 it is walk', () => {
    expect(requiredMuFor(p, 5)).toBe(p.rideMuGo8);
    expect(requiredMuFor(p, 8)).toBe(p.rideMuGo8);
    expect(requiredMuFor(p, 10)).toBe(p.rideMuGo10);
    expect(requiredMuFor(p, 11)).toBeNull();
    expect(rideVerdict(p, 12, 0.7)).toBe('walk');
    // measured 0.5 x 0.85 = 0.425 >= 0.4 -> GO at 8, but < 0.5 -> CAUTION at 10; measured 0.6 -> 0.51 -> GO at 10.
    expect(rideVerdict(p, 8, 0.5)).toBe('go');
    expect(rideVerdict(p, 10, 0.5)).toBe('caution');
    expect(rideVerdict(p, 10, 0.6)).toBe('go');
  });

  it('the rows get safer with higher friction and shallower slopes (monotone), and the low end is not GO', () => {
    const r = rideRules(p);
    const rank = { walk: 0, caution: 1, go: 2 } as const;
    for (const row of r.table.rows) for (let i = 1; i < row.cells.length; i++) expect(rank[row.cells[i].verdict]).toBeGreaterThanOrEqual(rank[row.cells[i - 1].verdict]);
    for (let j = 0; j < r.table.columns.length; j++) for (let i = 1; i < r.table.rows.length; i++) expect(rank[r.table.rows[i].cells[j].verdict]).toBeLessThanOrEqual(rank[r.table.rows[i - 1].cells[j].verdict]);
    expect(verdicts(r)[0][0]).not.toBe('g');
    expect(verdicts(r)[2][4]).toBe('g');
  });

  it('table rows follow params: change rideMuGo8 and the table changes', () => {
    const before = verdicts(rideRules(p));
    const after = verdicts(rideRules({ ...p, rideMuGo8: 0.6 }));
    expect(after).not.toEqual(before);
    expect(after[1].split('').filter((c) => c === 'g').length).toBeLessThan(before[1].split('').filter((c) => c === 'g').length);
    expect(rideRules({ ...p, rideMuGo8: 0.6 }).table.caption).toContain('0.6');
    // The max slope moves the walk line.
    const lower = rideRules({ ...p, rideMaxSlopeDeg: 9, rideGoSlopeDeg: 8 });
    expect(lower.table.rows.map((x) => x.slopeDeg)).toEqual([5, 8, 9]);
    expect(lower.walkRule).toContain('9°');
  });

  it('the text states the speed, caution, daylight, helmet, belt, spotter and walk-it-down rules from the params', () => {
    const r = rideRules(p);
    expect(r.speedRule).toContain(`${p.rideSpeedMph} mph`);
    expect(r.cautionRule).toContain(`${p.rideCautionSpeedMph} mph`);
    expect(r.daylightRule).toMatch(/Daylight only/);
    expect(r.gearRule).toMatch(/Lap belt/);
    expect(r.gearRule).toMatch(/helmet/);
    expect(r.spotterRule).toMatch(/spotter/);
    expect(r.walkRule).toMatch(/walk it down/);
    expect(r.walkRule).toContain(`${p.rideMaxSlopeDeg}°`);
    expect(rideRules({ ...p, rideSpeedMph: 8 }).speedRule).toContain('8 mph');
    expect(r.rules).toHaveLength(6);
    for (const t of [...r.rules, r.lead, r.table.caption]) expect(t).not.toMatch(/NaN|undefined|Infinity|turntable|bolster/);
  });

  it('the camp friction test has its steps, the derate and the cart weight', () => {
    const r = rideRules(p, { cartLb: 172.4 });
    expect(r.campTest.steps).toHaveLength(5);
    expect(r.campTest.steps[0]).toMatch(/all four wheels/);
    expect(r.campTest.steps[1]).toContain('172 lb');
    expect(r.campTest.steps[2]).toContain(String(p.rideMuDerate));
    expect(r.campTest.steps[3]).toMatch(/0\.27/);
    expect(r.campTest.steps[4]).toMatch(/date/);
    expect(rideRules(p).campTest.steps[1]).toContain('169 lb');
  });

  it('stop distance: longer at higher speed and on steeper ground; a slope the friction cannot hold gives Infinity', () => {
    expect(rideStopFt(p, 10, 8, 0.5)).toBeGreaterThan(rideStopFt(p, 5, 8, 0.5));
    expect(rideStopFt(p, 10, 10, 0.5)).toBeGreaterThan(rideStopFt(p, 10, 5, 0.5));
    expect(rideStopFt(p, 10, 15, 0.2)).toBe(Infinity);
  });

  it('the hills sentence uses the brake-stop value and degrades to nothing when the row is absent', () => {
    expect(hillStopSentence(p, 34.4)).toBe('On an 8° hill at 10 mph it stops in about 34 ft.');
    expect(hillStopSentence(p, undefined)).toBeNull();
    expect(hillStopSentence(p, NaN)).toBeNull();
    expect(hillStopSentence({ ...p, rideGoSlopeDeg: 10 }, 40)).toMatch(/^On a 10° hill/);
  });
});
