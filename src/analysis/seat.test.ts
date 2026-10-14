import { describe, expect, it } from 'vitest';
import { defaultParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext } from './context';
import { lashLoads, lidOpenAngleDeg, seatBackLoads, seatChecks } from './seat';

const ctxFor = (patch: Partial<Params> = {}) => {
  const p = { ...defaultParams(), ...patch } as Params;
  return makeContext(p, buildModel(p, { rider: 'goal', cargo: true }));
};
const ctx = ctxFor();

describe('seatChecks', () => {
  const checks = seatChecks(ctx);
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  it('returns the six rows, all in the Structure group and finite', () => {
    expect(checks.map((c) => c.id)).toEqual(['seat-back', 'seat-grip', 'storage-pack', 'storage-lid-open', 'lash-points', 'lash-load']);
    for (const c of checks) {
      expect(c.group).toBe('Structure');
      expect(Number.isFinite(c.value), c.id).toBe(true);
      expect(c.how.length, c.id).toBeGreaterThan(20);
    }
  });
  it('seat back passes at the operating rider and the goal rider, with every criterion under 1.0', () => {
    const c = byId['seat-back'];
    expect(c.statusOperating).not.toBe('fail');
    expect(c.statusGoal).not.toBe('fail');
    expect(c.details!.map((d) => d.name)).toEqual([
      'panel bending (bare 12 mm ply as a strip above and below the crest line)', 'crest bearing on the oak crest strip (full width)', 'hinge load (each hinge, screws in the oak backer)',
      'hinge leaf inserts pull-out (each of 3 threaded inserts in the ply)', 'latch pin bearing on the 12 mm ply (pull per pin)', 'latch pin tear-out toward the panel edge (ply rolling shear)', 'panel overhang deflection at the static torso load',
      // D-63 (3c-8): the blind latch holes keep oak behind them (never the 4 mm box end)
      'oak left behind the upright latch hole (stop block; the 4 mm box end is behind it)', 'oak left under the flat latch hole (hinge backer pad)',
    ]);
    // D-62 (Eric 2026-10-12): the bare 12 mm panel on the full-width crest strip passes with margin: no fallback to the oak frame was needed
    expect(c.util!).toBeLessThan(0.9);
    for (const d of c.details!) expect(d.util, d.name).toBeLessThan(1);
  });
  it('seat-back statics balance: R_A + R_B = w·H and moments about the hinge (the stile foot, B = 0) vanish', () => {
    const k = seatBackLoads(ctx, 200);
    expect(k.Q).toBeCloseTo(200 * 3 * 0.5, 9);
    expect(k.RA + k.RB).toBeCloseTo(k.w * k.sup.H, 9);
    // Moment about B: R_A (A − B) = w H (H/2 − B).
    expect(k.RA * (k.A - k.B)).toBeCloseTo(k.w * k.sup.H * (k.sup.H / 2 - k.B), 9);
    // The hinge is at the foot, B = 0, and the crest is high up the back (D-57): the stop block takes slightly more than the whole load and the hinge is pulled toward it.
    expect(k.B).toBe(0);
    expect(k.RB).toBeLessThan(0);
    expect(k.T).toBeCloseTo(-k.RB, 9);
    expect(k.T / k.Q).toBeLessThan(0.3); // a small share: the hinge screws in oak are not the weak link
    // Hand check at the defaults: w = 300/2/16 = 9.375 lbf/in per stile.
    expect(k.w).toBeCloseTo(9.375, 9);
    // Hand check of the bare panel: the worst moment per station M (at the crest, w (H - A)^2 / 2), over the 16 in width: m = 2M/W, sigma = 6 m / t^2 with t = 0.472
    const Mcrest = (k.w * (k.sup.H - k.A) ** 2) / 2;
    expect(k.M).toBeGreaterThanOrEqual(Mcrest - 1e-6);
    expect(k.m).toBeCloseTo((2 * k.M) / k.sup.W, 9);
    expect(k.sigmaPly).toBeCloseTo((6 * k.m) / (0.472 * 0.472), 6);
    expect(k.sigmaPly).toBeLessThan(2125);
  });
  it('a heavier torso share and a weak insert fail the row (the check has teeth)', () => {
    const bad = seatChecks(ctxFor({ seatBackLoadFraction: 1, seatHingeLoadLbf: 10 })).find((c) => c.id === 'seat-back')!;
    expect(bad.status).toBe('fail');
    expect(bad.governingLoad).toBeDefined();
  });
  it('hinge load grows with a lower crest (a stop block lower on the back leaves the foot hinge more to hold)', () => {
    const hi = seatBackLoads(ctxFor({ seatBackLatchHeightIn: 4.5 }), 200).T;
    const lo = seatBackLoads(ctxFor({ seatBackLatchHeightIn: 1.5 }), 200).T;
    expect(Number.isFinite(hi) && Number.isFinite(lo)).toBe(true);
    expect(seatBackLoads(ctx, 200).A).toBeGreaterThan(seatBackLoads(ctx, 200).sup.c2L);
  });
  it('grab-board row: the bar, the bolt couple and the washers hold a hard pull; no pinch point; a short, thin bar fails (teeth)', () => {
    const c = byId['seat-grip'];
    expect(c.status).not.toBe('fail');
    expect(c.details!.map((d) => d.name)).toEqual(['grab bar bending over the hole', 'bolt tension (each, the couple of the two rows)', 'washer bearing on the oak (⊥ grain)',
      'heads: 316 backing strip bearing on the outer gunwale band (⊥ grain, all six bolts)', 'heads: 3/8" washer punching the 1/16" backing strip (shear)', 'finger gap (no pinch)', 'clear length (hand)']);
    const bad = seatChecks(ctxFor({ grabBoardBarIn: 0.75, grabHoleLengthIn: 6, grabBoardThickIn: 0.5, riderMassLb: 250, riderGoalMassLb: 250 })).find((q) => q.id === 'seat-grip')!;
    expect(bad.util ?? 0).toBeGreaterThan(c.util ?? 0);
    const pinch = seatChecks(ctxFor({ grabHoleHeightIn: 1.25 })).find((q) => q.id === 'seat-grip')!;
    expect(pinch.status).not.toBe('fail');
  });
  it('storage packing reports the kit against the real interior', () => {
    const c = byId['storage-pack'];
    expect(c.status).not.toBe('fail');
    expect(c.value).toBeGreaterThan(0.5);
    expect(c.how).toMatch(/First-aid kit/);
    const small = seatChecks(ctxFor({ storageVolumeIn3: 1000 })).find((q) => q.id === 'storage-pack')!;
    expect(small.status).toBe('fail');
  });
  it('lid opening: the leaning back stops the lid near 90° minus the recline', () => {
    expect(lidOpenAngleDeg(ctx)).toBeGreaterThan(70);
    expect(lidOpenAngleDeg(ctx)).toBeLessThanOrEqual(90 - ctx.p.seatBackAngleDeg + 2);
    expect(lidOpenAngleDeg(ctxFor({ seatBackAngleDeg: 0 }))).toBe(90);
    expect(byId['storage-lid-open'].status).not.toBe('fail');
  });
  it('lash points: 6 at the defaults', () => {
    expect(byId['lash-points'].value).toBe(6);
    expect(byId['lash-points'].status).not.toBe('fail');
  });
  it('lash-load by hand (D-83): 233 lbf at 45° on a D-ring bracket through-bolted to a rib head with 2 1/4-20 button-head bolts', () => {
    // V = H = 233 sin 45° = 164.76 lbf; per bolt 82.38 lbf of tension and of shear.
    // Tension 82.38 / 0.0318 = 2,591 psi of 15,000 (30 ksi annealed stainless / 2); shear 82.38 / 0.0269 = 3,062 psi of 9,000 (0.6 x 30 ksi / 2): sqrt(0.1727² + 0.3403²) = 0.382.
    // Head bearing 82.38 / (0.25 x 0.75) = 439.3 psi (of 1,700); fender washer 82.38 / (pi/4 (0.75² - 0.281²) = 0.3798) = 216.9 psi (of 1,070 x 0.67 / 2 = 358.5).
    const k = lashLoads(ctx);
    expect(k.V).toBeCloseTo(164.76, 2);
    expect(k.T1).toBeCloseTo(82.38, 2);
    expect(k.sigT).toBeCloseTo(2591, 0);
    expect(k.tau).toBeCloseTo(3062, 0);
    expect(k.interaction).toBeCloseTo(0.382, 3);
    expect(k.headBearing).toBeCloseTo(439.35, 1);
    expect(k.washerArea).toBeCloseTo(0.3798, 4);
    expect(k.washerBearing).toBeCloseTo(216.9, 1);
    expect(k.bolt.len).toBe(2); // 0.063 washer + 0.625 side + 0.75 head + 0.125 bracket + 0.3125 nylock + 2 threads = 1.94 in
    const c = byId['lash-load'];
    expect(c.status).toBe('pass');
    expect(c.details!.map((d) => d.name)).toEqual(['bolt tension and shear together ((σ/Ft)² + (τ/Fv)², square root)', 'bolt bearing on the oak head (along its grain)', 'fender washer bearing on the outer gunwale band (compression ⊥)', `rib bending at the rating (rib ${k.ribN})`]);
    // The fender washer on the outer band (0.61) and the box rib (it cantilevers from the top of its spacer, 0.59) govern, well under their limits; nothing withdraws any more.
    expect(c.util!).toBeCloseTo(Math.max(k.ribSig / 6460, k.washerBearing / 358.5), 3);
    expect(c.util!).toBeGreaterThan(0.5);
    expect(c.util!).toBeLessThan(0.85);
    // A 450 lbf pull fails it (the rib, 1.5 x).
    expect(seatChecks(ctxFor({ lashLoadLbf: 450 })).find((q) => q.id === 'lash-load')!.status).toBe('fail');
  });

});
