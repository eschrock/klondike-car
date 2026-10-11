import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { runChecks } from './index';
import { LIGHT_OF_ID, clearRiderSweepCache, lightOf, riderSweep, safeRange, withRider, type SweepPoint } from './rider-sweep';
import { checkTruckFit } from '../truck/fit';
import { buildModel } from '../model';

const p0 = defaultParams();
const fit = checkTruckFit(p0, (v) => buildModel(p0, v));

describe('riderSweep', () => {
  it('covers 50-250 lb in 10 lb steps and contains the operating weight at the defaults', () => {
    clearRiderSweepCache();
    const t0 = performance.now();
    const r = riderSweep(p0, { fit });
    expect(performance.now() - t0).toBeLessThan(10000); // ~1-2 s measured with the bump-basis rows (it was ~110 ms before the flip); shared CI runners are 2-3x slower
    expect(r.points.map((x) => x.w)).toEqual(Array.from({ length: 21 }, (_, i) => 50 + 10 * i));
    // Honesty (docs/phase3b-flip-notes.md): at the flip the operating weight FAILS - the new front end (kingpin bolt and bracket, tie rod, bellcrank, tongue tie, stick cable) and
    // the rear end on the bump basis (axle, wheel rating, rail seat, groove) are undersized for the bump loads - so there is no safe range. Pin that it is reported, not which rows.
    expect(r.operating.status).toBe('fail');
    expect(r.safe).toBeNull();
    expect(r.green).toBeNull();
    expect(r.operating.fails.length).toBeGreaterThan(0);
    for (const id of r.operating.fails) expect(LIGHT_OF_ID[id], id).toBeDefined();
    expect(r.operating.fails).toContain('kingpin-bracket');
  });

  it('is cached by design (rider masses excluded)', () => {
    const a = riderSweep(p0, { fit });
    const t = performance.now();
    const b = riderSweep({ ...p0, riderMassLb: 180 }, { fit });
    expect(b.points).toBe(a.points);
    expect(performance.now() - t).toBeLessThan(500);
  });

  it('shows red at the right weights for a design with a known failing check', () => {
    // A very tall, narrow cart: lateral tip fails (the narrower the track the sooner), heavier riders raise the CG.
    const bad = { ...p0, frontTrackIn: 26, rearTrackIn: 26, deckHeightIn: 16 };
    const r = riderSweep(bad, { fit });
    const reds = r.points.filter((x) => x.status === 'fail');
    expect(reds.length).toBeGreaterThan(0);
    // The sweep agrees with a direct run at a red weight, using the same all-riders-equal rule.
    const w = reds[0].w;
    const direct = runChecks(withRider(bad, w), { includeTruck: false });
    expect(direct.some((c) => c.status === 'fail')).toBe(true);
    expect(reds[0].fails.length).toBeGreaterThan(0);
    expect(reds[0].worst?.status).toBe('fail');
    // And a weight the sweep calls non-red has no failing check.
    const ok = r.points.find((x) => x.status !== 'fail');
    if (ok) expect(runChecks(withRider(bad, ok.w), { includeTruck: false }).some((c) => c.status === 'fail' && lightOf(c) !== 'truck')).toBe(false);
  });

  it('maps every check id to exactly one light (or info)', () => {
    const checks = runChecks(p0, { includeTruck: false });
    for (const c of checks) {
      expect(LIGHT_OF_ID[c.id] ?? (c.group === 'Structure' ? 'strength' : undefined), c.id).toBeDefined();
    }
    // Structure rows color Strength, except the rider-independent fit facts (D-41), which are reported only.
    const INFO_STRUCTURE = new Set(['storage-pack', 'storage-lid-open', 'lash-points', 'lash-load']);
    for (const c of checks.filter((x) => x.group === 'Structure')) expect(lightOf(c)).toBe(INFO_STRUCTURE.has(c.id) ? 'info' : 'strength');
    expect(new Set(checks.map((c) => c.id)).size).toBe(checks.length);
  });
});

describe('safeRange', () => {
  const pt = (w: number, status: SweepPoint['status']): SweepPoint => ({
    w, status, worst: { id: `c${w}`, label: `c${w}`, util: 1, status }, byLight: { tipping: status, turns: status, hills: status, steering: status, strength: status, truck: 'pass' }, fails: status === 'fail' ? [`c${w}`] : [],
  });
  const pts = [50, 60, 70, 80, 90, 100].map((w, i) => pt(w, i === 0 || i === 5 ? 'fail' : i === 1 ? 'marginal' : 'pass'));
  it('finds the contiguous run and the limiter at each end', () => {
    const r = safeRange(pts, pts[3]);
    expect(r.safe).toEqual({ loLb: 60, hiLb: 90, openLow: false, openHigh: false });
    expect(r.lowLimit?.id).toBe('c50');
    expect(r.highLimit?.id).toBe('c100');
  });
  it('is null when the operating weight itself fails', () => {
    expect(safeRange(pts, pts[0]).safe).toBeNull();
  });
  it('keeps the all-green tier separate from the yellow weights (M3)', () => {
    // 60 is marginal, 70-90 are green, 50 and 100 fail.
    expect(safeRange(pts, pts[3]).green).toEqual({ loLb: 70, hiLb: 90, openLow: false, openHigh: false });
    expect(safeRange(pts, pts[1]).green).toBeNull(); // a yellow weight has no green run of its own
    expect(safeRange(pts, pts[1]).safe).toEqual({ loLb: 60, hiLb: 90, openLow: false, openHigh: false });
  });
});
