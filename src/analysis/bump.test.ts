import { describe, expect, it } from 'vitest';
import { ackCtx } from './ack-test-utils';
import { bumpCases, bumpPulse, bumpSeatG, bumpSeatGHard, bumpStrike, goodmanPulsating, peakVertical, seatFactor, sensitivityText } from './bump';
import { makeContext } from './context';
import { buildModel } from '../model';
import { defaultParams } from '../params';

const base = { rIn: 6.5, hIn: 1, vMph: 10, staticLb: 65, kLbIn: 400, massShare: 1.5 };

describe('bump: velocity-pulse (spec 5.1)', () => {
  it('reproduces the hand numbers (1 inch, 10 mph, k 400, 65 lb front wheel): F_n = 943 +/- 15 lbf, H 503, V 798', () => {
    const b = bumpPulse(base);
    // By hand: sin(beta) = 5.5/6.5, v_n = 176 in/s x cos(beta), m_e = 1.5 x 65 / 386.1, F_n = v_n sqrt(k m_e).
    const beta = Math.asin(5.5 / 6.5);
    const vn = 176 * Math.cos(beta);
    const me = (1.5 * 65) / 386.1;
    expect(b.Fn).toBeCloseTo(vn * Math.sqrt(400 * me), 6);
    expect(b.Fn).toBeGreaterThan(928);
    expect(b.Fn).toBeLessThan(958);
    expect(b.H).toBeCloseTo(b.Fn * Math.cos(beta), 6);
    expect(b.V).toBeCloseTo(b.Fn * Math.sin(beta), 6);
    expect(Math.abs(b.H - 503)).toBeLessThan(12);
    expect(Math.abs(b.V - 798)).toBeLessThan(15);
    expect(b.factor).toBeCloseTo(b.Fn / 65, 9);
  });

  it('force scales with speed, falls with a lower wheel rate, and is capped by 0.9 r', () => {
    const b10 = bumpPulse(base), b5 = bumpPulse({ ...base, vMph: 5 });
    expect(b5.Fn / b10.Fn).toBeCloseTo(0.5, 9); // F ~ v
    expect(bumpPulse({ ...base, kLbIn: 100 }).Fn / b10.Fn).toBeCloseTo(0.5, 9); // F ~ sqrt(k)
    expect(bumpPulse({ ...base, kLbIn: 1000 }).Fn).toBeGreaterThan(b10.Fn);
    // A step taller than 0.9 r is a wall: the same force as 0.9 r.
    const wall = bumpPulse({ ...base, hIn: 20 }), cap = bumpPulse({ ...base, hIn: 0.9 * 6.5 });
    expect(wall.Fn).toBeCloseTo(cap.Fn, 9);
    expect(wall.hEff).toBeCloseTo(5.85, 9);
    // Heavier wheel, bigger mass share: more force (F ~ sqrt(m_e)).
    expect(bumpPulse({ ...base, staticLb: 130 }).Fn / b10.Fn).toBeCloseTo(Math.SQRT2, 6);
  });

  it('hard hit (2 inch) is larger than the normal bump for both wheels, with a smaller V share and a bigger H', () => {
    const ctx = ackCtx();
    for (const wheel of ['front', 'rear'] as const) {
      const { normal, hard } = bumpCases(ctx, ctx.loads.goal, wheel);
      expect(hard.Fn).toBeGreaterThan(normal.Fn);
      expect(hard.H).toBeGreaterThan(normal.H);
      expect(peakVertical(hard)).toBeGreaterThan(peakVertical(normal) * 0.95);
    }
    // The rear wheel carries more static load, so it is struck harder.
    expect(bumpStrike(ctx, ctx.loads.goal, 'rear', 1).Fn).toBeGreaterThan(bumpStrike(ctx, ctx.loads.goal, 'front', 1).Fn);
  });

  it('the seat factor is 1 + V_rear / W (about 4 at the defaults) and only replaces dynamicFactor on the Ackermann basis', () => {
    const ctx = ackCtx();
    const c = ctx.loads.operating;
    const rear = bumpStrike(ctx, c, 'rear', ctx.p.bumpNormalHeightIn);
    expect(bumpSeatG(ctx, c)).toBeCloseTo(1 + rear.V / c.massLb, 9);
    expect(bumpSeatG(ctx, c)).toBeGreaterThan(3.2);
    expect(bumpSeatG(ctx, c)).toBeLessThan(4.8);
    expect(bumpSeatGHard(ctx, c)).toBeGreaterThan(bumpSeatG(ctx, c) - 0.5);
    expect(seatFactor(ctx, c)).toBe(Math.max(ctx.p.dynamicFactor, bumpSeatG(ctx, c)));
    const p0 = defaultParams();
    const old = makeContext(p0, buildModel(p0, { rider: 'goal', cargo: true, steerDeg: 0 }));
    expect(old.newFront).toBe(false);
    expect(seatFactor(old, old.loads.operating)).toBe(p0.dynamicFactor);
  });

  it('prints the wheel-rate sensitivity (k x 0.5 and x 2.5) and Goodman matches the hand value', () => {
    const ctx = ackCtx();
    const txt = sensitivityText(ctx, ctx.loads.goal, 'front', 1);
    expect(txt).toMatch(/k 200, \d+ at 400, \d+ at 1000 lb\/in/);
    const lo = bumpStrike(ctx, ctx.loads.goal, 'front', 1, 0.5), mid = bumpStrike(ctx, ctx.loads.goal, 'front', 1), hi = bumpStrike(ctx, ctx.loads.goal, 'front', 1, 2.5);
    expect(lo.Fn / mid.Fn).toBeCloseTo(Math.sqrt(0.5), 9);
    expect(hi.Fn / mid.Fn).toBeCloseTo(Math.sqrt(2.5), 9);
    // sigma_max 10 ksi pulsating: n = 1 / (5/30 + 5/125) = 4.84
    expect(goodmanPulsating(10000, 30000, 125000)).toBeCloseTo(1 / (5000 / 30000 + 5000 / 125000), 9);
    expect(goodmanPulsating(0, 30000, 125000)).toBe(Infinity);
  });
});
