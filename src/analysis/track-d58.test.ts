/**
 * D-58 (Eric 2026-10-11): the tracks are tightened. FRONT 34 1/2 in = the true minimum for the 20 degree lock with the 3/4 in tire margin, rounded UP to 1/8 in; REAR 32 in.
 * Tip angles before (35.5 / 35.5) and after, the truck fit, the brake rows and the overall width are pinned here so the change is on record.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, steerGeometry, validateParams, type Params } from '../params';
import { buildModel } from '../model';
import { checkTruckFit } from '../truck/fit';
import { runChecks } from './index';
import { PRE_D71, PRE_D60, PRE_D66 } from '../test-fixtures';

const OLD = { frontTrackIn: 35.5, rearTrackIn: 35.5, axleHangerThickIn: 0.75, clampPlateWidthIn: 1.5, clampPlateOuterWidthIn: 1.5 };
// D-66 moved the defaults on (30 in tracks, the derived taper); this file records D-58, so its "new" design is the D-58 default restored with PRE_D66. The D-66 numbers are in d66.test.ts.
const run = (q: Partial<Params>) => runChecks({ ...defaultParams(), ...PRE_D71, ...PRE_D66, ...PRE_D60, ...q } as Params, { includeTruck: false });
const row = (cs: ReturnType<typeof run>, id: string) => cs.find((c) => c.id === id)!;
const nw = run({});
const old = run(OLD);

describe('the D-58 tracks', () => {
  it('front 34 1/2 in, rear 32 in; the front is the least track (rounded to 1/8 in) that keeps the tire 3/4 in off the body at the 20 degree lock', () => {
    const p = { ...defaultParams(), ...PRE_D71, ...PRE_D66, ...PRE_D60 } as Params;
    expect(p.frontTrackIn).toBe(34.5);
    expect(p.rearTrackIn).toBe(32);
    const sg = steerGeometry(p);
    expect(sg.clearAtLock).toBeGreaterThanOrEqual(p.steerClearIn);
    // the true minimum for the 3/4 in tire margin is 34.28 in; 34 3/8 in would just clear (0.80 in) but sits in the 10% marginal band, so the next 1/8 in, 34 1/2 in (0.855 in), is the default
    expect(sg.minTrack).toBeCloseTo(34.28, 2);
    expect(sg.minTrack).toBeLessThan(34.375);
    expect(steerGeometry({ ...p, frontTrackIn: 34.375 }).clearAtLock).toBeLessThan(p.steerClearIn * 1.1);
    expect(steerGeometry({ ...p, frontTrackIn: 34.25 }).clearAtLock).toBeLessThan(p.steerClearIn);
    expect(sg.clearAtLock).toBeGreaterThanOrEqual(p.steerClearIn * 1.1);
    expect(validateParams(p).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('tip angles before (35.5 / 35.5 in) and after (34 1/2 / 32 in), the straight tip limit (40 degrees in D-58, 35 since D-67)', () => {
  const tip = (cs: ReturnType<typeof run>, k: 'operating' | 'goal' | 'cargo') => row(cs, 'tip-straight').cases![k]!.value;
  it('150 lb rider 50.9 -> 48.7 deg; 200 lb rider 49.4 -> 47.3 deg; both far above the limit', () => {
    expect(tip(old, 'operating')).toBeCloseTo(50.73, 1); // 50.79 before D-65 (the lighter, shorter brake flaps), 50.84 before D-62 // 50.9 before D-60 dropped the four foot-block cleats (a little less mass forward)
    expect(tip(nw, 'operating')).toBeCloseTo(48.57, 1); // 48.62 before D-65, 48.7 before D-62
    expect(tip(old, 'goal')).toBeCloseTo(49.30, 1);
    expect(tip(nw, 'goal')).toBeCloseTo(47.14, 1);
    for (const k of ['operating', 'goal'] as const) expect(tip(nw, k)).toBeGreaterThan(40 + 5);
    expect(row(nw, 'tip-straight').statusOperating).toBe('pass');
    expect(row(nw, 'tip-straight').statusGoal).toBe('pass');
  });
  it('200 lb cargo (the D-58 target, piled at the nose end of the bed): 44.7 -> 42.8 deg (the angles do not depend on the limit); it passed the old 40 degree limit by 3 degrees (marginal band) and clears the D-67 35 degree limit by 7.8 degrees, outside the 10% band (38.5), a plain pass', () => {
    expect(tip(old, 'cargo')).toBeCloseTo(44.50, 1); // 44.58 before D-65, 44.67 before D-62 // D-60 (no foot-block cleats): 44.7 / 43.1 before
    expect(tip(nw, 'cargo')).toBeCloseTo(42.83, 1); // 42.91 before D-65, 43.0 before D-62
    expect(tip(nw, 'cargo')).toBeGreaterThan(40);
    expect(row(nw, 'tip-straight').cases!.cargo!.limit).toBe(35); // D-67 (was 40)
    expect(tip(nw, 'cargo')).toBeGreaterThan(35 * 1.1); // 42.8 > 38.5: outside the marginal band
    expect(row(nw, 'tip-straight').statusCargo).toBe('pass'); // was 'marginal' at the 40 degree limit
  });
  it('250 lb cargo, for the record: 43.2 -> 41.7 deg, still above the limit', () => {
    expect(tip(run({ ...OLD, cargoPayloadLb: 250 }), 'cargo')).toBeCloseTo(43.05, 1);
    expect(tip(run({ cargoPayloadLb: 250 }), 'cargo')).toBeCloseTo(41.45, 1); // 41.52 before D-65, 41.7 before D-60 dropped the cleats, 41.6 before D-62
  });
  it('slide-before-tip and tip-lock still pass for the riders; the slide margin falls 1.24 -> 1.14 (150 lb) against the 0.75 required', () => {
    expect(row(old, 'slide-before-tip').cases!.operating!.value).toBeCloseTo(1.24, 1);
    expect(row(nw, 'slide-before-tip').cases!.operating!.value).toBeCloseTo(1.14, 1); // 1.24 / 1.14 to two places before D-60 dropped the foot-block cleats (1.236 / 1.138 now)
    expect(row(nw, 'slide-before-tip').statusOperating).toBe('pass');
    expect(row(nw, 'tip-lock').statusOperating).toBe('pass');
    expect(row(nw, 'tip-lock').statusGoal).toBe('pass');
  });
  it('no row fails for the 150 lb or 200 lb rider or the 200 lb cargo case at the new tracks (the resting-weight row is a separate static check)', () => {
    for (const c of nw) {
      if (c.id === 'rest-load') continue;
      expect(c.statusOperating ?? c.status, c.id).not.toBe('fail');
      expect(c.statusGoal ?? c.status, c.id).not.toBe('fail');
      expect(c.statusCargo ?? 'pass', c.id).not.toBe('fail');
    }
  });
});

describe('truck fit, brake and overall width at the new tracks', () => {
  const fitAt = (q: Partial<Params>) => {
    const p = { ...defaultParams(), ...PRE_D71, ...PRE_D66, ...PRE_D60, ...q } as Params;
    return checkTruckFit(p, (v) => buildModel(p, v));
  };
  it('the overall width falls 40.5 -> 39.5 in (set by the front axle ends: front track + tire + stub ends); the sled still fits beside in the bed in all three configurations', () => {
    const a = fitAt(OLD), b = fitAt({});
    expect(a.dims.installed.widthIn).toBeCloseTo(40.5, 1);
    expect(b.dims.installed.widthIn).toBeCloseTo(39.5, 1);
    expect(b.dims.installed.widthIn).toBeLessThan(a.dims.installed.widthIn);
    for (const config of ['installed', 'removed']) expect(b.cases.some((c) => c.mode === 'beside' && c.config === config && c.fits), config).toBe(true);
    expect(b.anyFits).toBe(true);
  });
  it('the 32 in rear track keeps the brake flaps working: brake-slow (10 deg stop grade) and the brake geometry rows are unchanged or better; brake-clear stays at the rail (0.22 in)', () => {
    expect(row(nw, 'brake-slow').statusOperating).toBe('pass');
    expect(row(nw, 'brake-slow').statusGoal).toBe('pass');
    expect(row(nw, 'brake-slow').cases!.operating!.value).toBeCloseTo(row(old, 'brake-slow').cases!.operating!.value, 1);
    expect(row(nw, 'brake-clear').status).toBe('pass');
    expect(row(nw, 'brake-ratio').status).toBe('pass');
    expect(row(nw, 'brake-force').status).toBe('info'); // Eric: the hold force is information only
  });
  it('the 32 in rear track clears the 24 in body: the validator accepts it, and a 28 in body that would meet the tires is refused', () => {
    expect(validateParams({ ...defaultParams(), ...PRE_D71, ...PRE_D66, bodyWidthIn: 24 }).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateParams({ ...defaultParams(), ...PRE_D71, ...PRE_D66, bodyWidthIn: 28 }).some((i) => i.severity === 'error' && i.keys.includes('rearTrackIn'))).toBe(true);
    expect(resolveParams({ ...defaultParams(), ...PRE_D71, ...PRE_D66 }).rearTrackIn).toBe(32);
  });
});
