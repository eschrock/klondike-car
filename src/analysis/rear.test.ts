/**
 * Rear end checks, round 3 (eng N-7; build MUST-4): wheel rating and the rear beam seat. (The brake bearing-plate statics and the lever abuse row of D-48 went with
 * the cross-shaft brake at Phase 3c-1; the new brake is in brake.test.ts.) Hand numbers are re-derived from params and the layout, not read back from the check code.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, type Params } from '../params';
import { makeCtx } from '../model/build-utils';
import { beamSeat } from '../model/rear-mount';
import { runChecks, type AnalysisCheck } from './index';

const defaults = defaultParams();
const cs = runChecks(defaults, { includeTruck: false });
const byId = (c: AnalysisCheck[], id: string) => c.find((x) => x.id === id)!;
const det = (c: AnalysisCheck[], id: string, name: string) => byId(c, id).details!.find((d) => d.name.includes(name))!;
const run = (q: Partial<Params>) => runChecks({ ...defaults, ...q } as Params, { includeTruck: false });
const ctx = makeCtx(defaults);

describe('wheel / hub rating (N-7)', () => {
  const c = byId(cs, 'wheel-rating');
  it('is a Structure row with the assumed 300 lb rating and three details; on the 1" bump basis the peak vertical force FAILS at the defaults (flip notes: a rated wheel or a lower bump rate)', () => {
    expect(c.group).toBe('Structure');
    expect(defaults.wheelRatingLb).toBe(300);
    expect(c.status).toBe('fail'); // honest: peak 1,240 lbf against 2 x 300 (docs/phase3b-flip-notes.md)
    expect(c.details!.length).toBe(3);
    expect(c.how).toMatch(/vendor listing/);
  });
  it('static load on the heavier wheel, bump peak (V + static) vs 2 x rating, skid = mu P vs half the rating', () => {
    const stat = det(cs, 'wheel-rating', 'static load');
    const peak = det(cs, 'wheel-rating', 'peak vertical');
    const side = det(cs, 'wheel-rating', 'lateral skid');
    expect(stat.limit).toBe(300);
    expect(peak.value).toBeGreaterThan(stat.value * defaults.dynamicFactor); // the bump pulse is a larger multiple than the old dynamic factor
    expect(peak.limit).toBe(300 * defaults.wheelRatingPeakMult);
    expect(side.value).toBeCloseTo(defaults.tireGroundMu * stat.value, 6);
    expect(side.limit).toBeCloseTo(300 * defaults.wheelSideRatingFrac, 9);
    // the goal-rider rear wheel is about 120-135 lb static (eng review: about 120 + the CG offset)
    expect(stat.value).toBeGreaterThan(100);
    expect(stat.value).toBeLessThan(160);
  });
  it('a 100 lb rating fails (static); a 650 lb rated wheel passes the 1" bump peak with room', () => {
    expect(byId(run({ wheelRatingLb: 100 }), 'wheel-rating').status).toBe('fail');
    expect(byId(run({ wheelRatingLb: 650 }), 'wheel-rating').status).not.toBe('fail');
    expect(byId(run({ wheelRatingLb: 400 }), 'wheel-rating').util).toBeLessThan(byId(cs, 'wheel-rating').util!);
  });
});

describe('rear axle beam seat (MUST-4)', () => {
  const seat = beamSeat(ctx.p, ctx.L)!;
  it('on the 1" bump basis the struck wheel\'s V + static goes into ONE rail: the notch ceiling and the rail net-section shear FAIL at the defaults (flip notes), worked by hand', () => {
    const c = byId(cs, 'rear-beam-seat');
    expect(c.status).toBe('fail');
    const w = ctx.L.beamR.thick;
    const bear = det(cs, 'rear-beam-seat', 'notch ceiling');
    // bearing = V_total / (beam thickness x rail thickness); several hundred psi against the 358 psi design
    expect((bear.value * w * seat.railT)).toBeGreaterThan(500); // the 1" bump at jogging pace (5 mph, D-53): about 650 lbf (1,240 lbf at the 10 mph of the ride study)
    expect(bear.limit).toBeGreaterThan(300);
    expect(c.how).toMatch(/NOTCHED/);
  });
  it('the rail net-section shear above the notch is the tightest detail (it is the failing one: remaining rail 1.65 inch)', () => {
    const v = det(cs, 'rear-beam-seat', 'NORMAL: rail shear');
    expect(v.util).toBeGreaterThan(1);
    expect(seat.remain).toBeCloseTo(1.65, 2);
  });
  it('the hold-down bolts carry rebound and the side skid in 316 tension, with washers on oak: far from their limits', () => {
    const t = det(cs, 'rear-beam-seat', 'hold-down tension on each vertical bolt');
    expect(t.util).toBeLessThan(0.2);
    expect(det(cs, 'rear-beam-seat', 'side skid pull').util).toBeLessThan(0.3);
    expect(det(cs, 'rear-beam-seat', 'washer').util).toBeLessThan(1);
  });
  it('an overslung beam has no notch or hold-down and the row is info', () => {
    expect(byId(run({ axleBeamPosition: 1 }), 'rear-beam-seat').status).toBe('info');
  });
});
