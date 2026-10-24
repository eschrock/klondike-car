import { PRE_D66 } from '../test-fixtures';
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
    // D-58: the front-axle rows are fixed (roll pads, oak tongue, check chains, lift by the body), so at the defaults the 150 lb operating weight PASSES every row.
    // 3c-5: one more joist (8.5 in spacing) and span/160 for a standing foot (D-58): nothing is red up to 250 lb (the top of the sweep, so the safe range is open at the heavy end too);
    // the green range (no yellow either) is 50-210 lb. D-60 (the weight package): 50-230 lb, the lighter sled and rear beam move the marginal rows (rear-beam-seat and the tip rows) out of the yellow band.
    expect(r.operating.status).toBe('pass');
    expect(r.operating.fails).toEqual([]);
    expect(r.safe).toEqual({ loLb: 50, hiLb: 230, openLow: true, openHigh: false }); // D-84: the honest grab-board row (the board turns about its lower edge) is red from 240 lb
    // D-63 (3c-8): the lighter hinge/pin pads (-0.4 lb) tip the bearing-groove row at 240 lb from 0.9003 to 0.8995, just under the 0.9 yellow line: green is 50-230 or 50-240 depending on that knife edge.
    // D-66 (matched 30 in tracks): nothing is red up to 250 lb, but the straight tip (43.6 deg at 200 lb, limit 40) was inside its 10% band from 190 lb, so green was 50-180 lb.
    // D-67 (the straight tip limit 35 deg): 43.6 deg at 200 lb is 8.6 deg over it (util 35 / 43.6 = 0.80, far outside the 10% band), so the tip row leaves the sweep's marginal list and green is
    // 50-240 lb; the 250 lb point is yellow only on the seat-back panel (0.909), and at 200 lb the tightest row is park-hold (0.883, a fit fact), not the tip.
    // D-71 (Harbor Freight wheels, 5/8 in axles): the rear axle-stress row (the 5/8 in tube, 0.12 in wall) is over the 0.9 line from 190 lb (0.925 at the 200 lb goal rider), so green ends at 180 lb;
    // nothing is red up to 250 lb (the 1.75 in clamp plate keeps the rear groove bearing at 0.85 at 200 lb).
    // D-71 (Eric chose the solid rod) and D-73 (1/4 in white oak sides, +2.8 lb): the rod's axle-stress is 0.79 at 200 lb, so the groove bearing on the oak (0.89 at 220 lb, 0.90 from 230 lb) ends green at 220 lb.
    // D-83 (the 233 lbf D-rings, the 2 in clamp plates, the 1-1/2 in EVA seat that seats the rider lower): the groove bearing drops to 0.75 at 200 lb and green runs to 240 lb.
    // D-84 (the grab board turns about its lower edge, the honest row): the strip and washer bearing reach 0.9 at 220 lb and the lower-edge bearing is red from 240 lb, so green is 50-210 lb and safe 50-230 lb.
    expect(r.green).toMatchObject({ loLb: 50, hiLb: 210, openLow: true, openHigh: false }); // (2026-10-24: D-96/97/98) 210 lb on the sheets as bought (the grab board goes yellow at 220)
    expect(r.points.find((x) => x.w === 200)!.worst!.id).toBe('park-hold'); // a fit fact (0.883), as with the 3/4 in axle; the D-71 tube had axle-stress (0.925)
    expect(r.points.find((x) => x.w === 250)!.worst!.id).toBe('seat-grip'); // D-84: the grab board is the tightest row at 250 lb (it fails there); D-83 had brake-slow
    for (const id of ['king-bearing', 'steer-stops', 'bridle-eye', 'lift', 'brake-force']) expect(r.points.every((x) => !x.fails.includes(id)), id).toBe(true);
    expect(r.points.filter((x) => x.w <= 200).every((x) => x.status === 'pass')).toBe(true); // 2026-10-24: 210 lb is a knife edge (brake-mount 0.9001 with the 13 mm deck as bought; seat-grip 0.898 with the 12 mm deck)
    // the deck ply no longer fails for the heaviest riders (it did from 230 lb at 10 in joist spacing and span/300)
    for (const w of [220, 230, 250]) expect(r.points.find((x) => x.w === w)!.fails).not.toContain('deck');
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
    // then fails from 70 lb (D-60; 80 lb before) and up and the slide-before-tip row from 100 lb (D-58 tracks; 120 lb before D-60: the sled is 24 lb lighter, so the stability margins shift), while the lighter riders have no stability failure. (Front-end and brake rows are ignored here.)
    const bad = { ...p0, ...PRE_D66, tipStraightMinDeg: 52, slideMarginFactor: 2.4 }; // D-66 (30 in tracks) lowers the tip angles by about 3 degrees, so this known-failing design keeps the D-58 numbers it was written for
    const r = riderSweep(bad, { fit });
    const stab = (fails: string[]) => fails.filter((id) => ['tip-straight', 'slide-before-tip'].includes(id));
    const reds = r.points.filter((x) => stab(x.fails).length > 0);
    expect(reds.length).toBeGreaterThan(0);
    expect(reds.length).toBeLessThan(r.points.length); // the light riders are fine on stability
    expect(stab(r.points[0].fails)).toEqual([]);
    // The sweep agrees with a direct run at a red weight, using the same all-riders-equal rule.
    const w = reds[0].w;
    expect(w).toBe(80); // D-83: 80 (the lower seat raises the tip angle about 0.45 deg, so the 52 deg limit first fails at 80 lb, not 70); earlier: 70; 34 1/2 / 32 in tracks (D-58): the straight tip is 48.6 deg at 150 lb; D-60: the 24 lb lighter sled has a lower total mass, so the straight tip angle drops about 1 deg for the same rider and the 52 deg limit fails from 70 lb (it was 80)
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
    expect(slideRed[0].w).toBe(110); // D-83: 110 (was 100: the lower seat is more stable)
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
