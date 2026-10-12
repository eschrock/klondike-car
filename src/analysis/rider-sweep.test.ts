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
    // Honesty (D-56): at the defaults the operating weight FAILS - the pivoting front axle's rows: king-bearing (the roll couple of a one-wheel strike on the 2.5 in UHMW washer and the
    // oak under it, about 11x), steer-stops (oak crush at the stop contact), bridle-eye (the 3/16 in tongue bar bends about its thin axis under the vertical part of the pull) and lift
    // (the same tongue when the nose is lifted by it), plus the brake-clear row of the brake agent (the brake beam is 1/16 in from the rail) - so there is no safe range at any weight.
    // Pin that it is reported and that those rows are among the reds.
    expect(r.operating.status).toBe('fail');
    expect(r.safe).toBeNull();
    expect(r.green).toBeNull();
    expect(r.operating.fails.length).toBeGreaterThan(0);
    for (const id of r.operating.fails) expect(LIGHT_OF_ID[id], id).toBeDefined();
    for (const id of ['king-bearing', 'steer-stops', 'bridle-eye', 'lift']) expect(r.operating.fails).toContain(id);
    for (const id of ['tip-straight', 'tip-lock', 'slide-before-tip']) expect(r.operating.fails).not.toContain(id); // the stability rows pass with the wide 35.5 in track and the 14 in CG
    expect(r.points.every((x) => x.status === 'fail')).toBe(true); // every rider weight from 50 to 250 lb is red at the defaults
    // the deck ply fails for the heaviest riders on top of that (230 lb and up)
    expect(r.points.find((x) => x.w === 220)!.fails).not.toContain('deck');
    expect(r.points.find((x) => x.w === 230)!.fails).toContain('deck');
  });

  it('is cached by design (rider masses excluded)', () => {
    const a = riderSweep(p0, { fit });
    const t = performance.now();
    const b = riderSweep({ ...p0, riderMassLb: 180 }, { fit });
    expect(b.points).toBe(a.points);
    expect(performance.now() - t).toBeLessThan(500);
  });

  it('shows red at the right weights for a design with a known failing check', () => {
    // The tip limit is raised to 52 deg (the straight tip is 55.6 deg at 50 lb and 47.9 at 250 lb) and the slide factor to 2.4 (SSF 1.47 at 50 lb down to 1.11 at 250 vs 1.2): the tip row
    // then fails from 110 lb and up and the slide-before-tip row from 160 lb, while the lighter riders have no stability failure. (Front-end and brake rows are ignored here.)
    const bad = { ...p0, tipStraightMinDeg: 52, slideMarginFactor: 2.4 };
    const r = riderSweep(bad, { fit });
    const stab = (fails: string[]) => fails.filter((id) => ['tip-straight', 'slide-before-tip'].includes(id));
    const reds = r.points.filter((x) => stab(x.fails).length > 0);
    expect(reds.length).toBeGreaterThan(0);
    expect(reds.length).toBeLessThan(r.points.length); // the light riders are fine on stability
    expect(stab(r.points[0].fails)).toEqual([]);
    // The sweep agrees with a direct run at a red weight, using the same all-riders-equal rule.
    const w = reds[0].w;
    expect(w).toBe(110);
    const direct = runChecks(withRider(bad, w), { includeTruck: false });
    expect(direct.find((c) => c.id === 'tip-straight')!.status).toBe('fail');
    expect(reds[0].fails).toContain('tip-straight');
    expect(reds[0].byLight.tipping).toBe('fail');
    // And the weight just below is fine on the same row.
    const ok = r.points.find((x) => x.w === w - 10)!;
    expect(runChecks(withRider(bad, ok.w), { includeTruck: false }).find((c) => c.id === 'tip-straight')!.status).not.toBe('fail');
    // The slide row only fails at the heaviest weights.
    const slideRed = r.points.filter((x) => x.fails.includes('slide-before-tip'));
    expect(slideRed.length).toBeGreaterThan(0);
    expect(slideRed[0].w).toBeGreaterThan(w);
    expect(slideRed[0].w).toBe(160);
  });

  it('maps every check id to exactly one light (or info)', () => {
    const checks = runChecks(p0, { includeTruck: false });
    for (const c of checks) {
      expect(LIGHT_OF_ID[c.id] ?? (c.group === 'Structure' ? 'strength' : undefined), c.id).toBeDefined();
    }
    // Structure rows color Strength, except the rider-independent fit facts (D-41), which are reported only.
    const INFO_STRUCTURE = new Set(['storage-pack', 'storage-lid-open', 'lash-points', 'lash-load', 'seat-stow', 'lid-load', 'cargo-strap']);
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
