import { describe, expect, it } from 'vitest';
import { defaultParams, derived, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext } from './context';
import { footStopCheck, footStopLoads, hullChecks, liftCheck, liftShares } from './hull';
import { liftBarStressPsi } from '../model/body';

const ctxFor = (patch: Partial<Params> = {}) => {
  const p = { ...defaultParams(), ...patch } as Params;
  return makeContext(p, buildModel(p, { rider: 'goal', cargo: true, steerDeg: 0 }));
};
const ctx = ctxFor();
const al = derived(defaultParams());

describe('hull checks (D-43)', () => {
  it('returns lift and foot-stop (the prow-grab check went with the prow, D-45), all Structure, finite, and passing at the defaults', () => {
    const cs = hullChecks(ctx);
    expect(cs.map((c) => c.id)).toEqual(['lift', 'foot-stop']);
    for (const c of cs) {
      expect(c.group).toBe('Structure');
      expect(Number.isFinite(c.value)).toBe(true);
      expect(c.status === 'pass' || c.status === 'marginal', `${c.id} ${c.status}`).toBe(true);
    }
  });

  it('lift share by hand: 137.1 lb with the CG 18.4" ahead of the rear axle and hand-holds at −9.625" and 51.875" → rear 137.1 × (51.875 − 18.4) / 61.5 = 74.6 lb', () => {
    const s = liftShares(137.1, 18.4, -9.625, 51.875);
    expect(s.rear).toBeCloseTo(74.6, 1);
    expect(s.front).toBeCloseTo(62.5, 1);
    expect(s.rear + s.front).toBeCloseTo(137.1, 9);
    // Bar by hand: P = 74.6 × 3 = 223.9 lbf; M = P·L/4 = 223.9 × 4.5 / 4 = 251.9 lb·in; S = 0.75 × 0.75² / 6 = 0.0703125 in³ → 3,582 psi.
    const sigma = liftBarStressPsi({ zBot: 0, zTop: 1, transomTop: 2, barIn: 0.75, thickIn: 0.75, lengthIn: 4.5 }, 74.6 * 3);
    expect(sigma).toBeCloseTo(3582, -1);
    expect(sigma / al.oakDesignMorPsi).toBeLessThan(0.6);
  });

  it('the lift row uses the CG-weighted share, not mass / 2: the rear person carries 70-78 lb (review: about 74), more than the front', () => {
    const c = liftCheck(ctx);
    const rear = c.details!.find((d) => d.name === 'rear slot bar bending')!;
    // σ = share × 3 × 4.5/4 / 0.0703125 → share = σ × 0.0703125 × 4 / (3 × 4.5)
    const share = (rear.value * 0.0703125 * 4) / (3 * 4.5);
    expect(share).toBeGreaterThan(70);
    expect(share).toBeLessThan(78);
    const front = c.details!.find((d) => d.name === 'front slot bar bending')!;
    expect(rear.value).toBeGreaterThan(front.value);
    expect(rear.limit).toBeCloseTo(al.oakDesignMorPsi, 6);
    expect(c.how).toMatch(/not mass \/ 2/);
  });

  it('foot stop by hand: 200 lb × 2 g × 0.6 = 240 lbf; board 12.75" × 0.75" × 4": M = 240 × 12.75 / 4 = 765 lb·in, S = 4 × 0.75² / 6 = 0.375 → 2,040 psi; 8 deck screws → 30 lbf each', () => {
    const k = footStopLoads(ctx, 200)!;
    expect(k.F).toBeCloseTo(240, 9);
    expect(k.span).toBeCloseTo(12.75, 6);
    expect(k.M).toBeCloseTo(765, 6);
    expect(k.S).toBeCloseTo(0.375, 9);
    expect(k.sigma).toBeCloseTo(2040, 6);
    expect(k.screws).toBe(8); // 4 through the board + 2 through each of 2 cleats
    expect(k.screwLoad).toBeCloseTo(30, 9);
    expect(footStopCheck(ctx)!.statusGoal).not.toBe('fail');
  });

  it('foot stop fails when the load is real: 4 g and the whole share (200 × 4 × 1.0 = 800 lbf, 100 lbf per screw > 90)', () => {
    const c = footStopCheck(ctxFor({ curbStrikeG: 4, footStopShare: 1 }))!;
    expect(c.statusGoal).toBe('fail');
    expect(footStopLoads(ctxFor({ curbStrikeG: 4, footStopShare: 1 }), 200)!.screwLoad).toBeCloseTo(100, 9);
  });
});
