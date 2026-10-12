import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext, type Ctx } from './context';
import { bumpCases, bumpPulse, bumpSeatG, bumpSeatGHard, bumpStrike, bumpText, cornerWeightLb, goodmanPulsating, peakVertical, plateGyration, rigidCornerWeightLb, seatFactor, sensitivityText } from './bump';
import { PRE_D60 } from '../test-fixtures';

/** The default design with the goal rider and the cargo case's payload parts present, front axle straight (the same context `runChecks` builds). */
function ackCtx(over: Partial<Params> = {}): Ctx {
  const p = resolveParams({ ...defaultParams(), ...PRE_D60, frontTrackIn: 35.5, rearTrackIn: 35.5, axleHangerThickIn: 0.75, clampPlateWidthIn: 1.5, ...over }); // the 3c-3 hand-calc fixture (D-58 narrowed the tracks)
  return makeContext(p, buildModel(p, { rider: 'goal', cargo: true }));
}

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

  it('hard hit (2 inch at 5 mph) is larger than the normal bump (1 inch at 3 mph) for both wheels, with a bigger H', () => {
    const ctx = ackCtx();
    for (const wheel of ['front', 'rear'] as const) {
      const { normal, hard } = bumpCases(ctx, ctx.loads.goal, wheel);
      expect(hard.Fn).toBeGreaterThan(normal.Fn);
      expect(hard.H).toBeGreaterThan(normal.H);
      expect(peakVertical(hard)).toBeGreaterThan(peakVertical(normal));
    }
    // The sled is a plate on its four tires (D-56: 44 in wheelbase, both tracks 35.5 in): the CG is 17.5 in ahead of the rear axle, so a rear wheel is closer to it and its rigid-body
    // mass is larger than a front wheel's (61 vs 43 lb), and it carries more static load (108 vs 71 lb): the rear wheel is struck harder.
    const g = ctx.loads.goal;
    expect(cornerWeightLb(ctx, g, 'rear')).toBeGreaterThan(cornerWeightLb(ctx, g, 'front'));
    expect(bumpStrike(ctx, g, 'rear', 1).Fn).toBeGreaterThan(bumpStrike(ctx, g, 'front', 1).Fn);
  });

  it('D-55 split speeds: normal strikes use bumpSpeedNormalMph = 3, hard strikes bumpSpeedHardMph = 5, and each strike reports its own speed', () => {
    const ctx = ackCtx();
    expect(ctx.p.bumpSpeedNormalMph).toBe(3);
    expect(ctx.p.bumpSpeedHardMph).toBe(5);
    const g = ctx.loads.goal;
    expect(bumpStrike(ctx, g, 'front', 1).vMph).toBe(3); // default kind is normal
    expect(bumpStrike(ctx, g, 'front', 1, 1, 'normal').vMph).toBe(3);
    expect(bumpStrike(ctx, g, 'front', 2, 1, 'hard').vMph).toBe(5);
    for (const wheel of ['front', 'rear'] as const) {
      const cs = bumpCases(ctx, g, wheel);
      expect(cs.normal.vMph).toBe(3);
      expect(cs.normal.hIn).toBe(1);
      expect(cs.hard.vMph).toBe(5);
      expect(cs.hard.hIn).toBe(2);
      // the text names the strike's own speed
      expect(bumpText(cs.normal, 'n', ctx.p)).toMatch(/\(3 mph\)/);
      expect(bumpText(cs.hard, 'h', ctx.p)).toMatch(/\(5 mph\)/);
    }
    expect(sensitivityText(ctx, g, 'front', 1, 'normal')).toMatch(/1" bump, 3 mph/);
    expect(sensitivityText(ctx, g, 'front', 2, 'hard')).toMatch(/2" hard-hit, 5 mph/);
    // The same step is 5/3 as hard at the hard speed, wheel and mass held: F_n ~ v.
    const n2 = bumpStrike(ctx, g, 'rear', 2, 1, 'normal'), h2 = bumpStrike(ctx, g, 'rear', 2, 1, 'hard');
    expect(h2.Fn / n2.Fn).toBeCloseTo(5 / 3, 9);
    // A user speed change moves only its own basis.
    const fast = ackCtx({ bumpSpeedNormalMph: 4 });
    expect(bumpStrike(fast, fast.loads.goal, 'rear', 1, 1, 'normal').vMph).toBe(4);
    expect(bumpStrike(fast, fast.loads.goal, 'rear', 2, 1, 'hard').vMph).toBe(5);
  });

  it('hand calc at each split speed, 10 in wheel (r = 5), 70 lb static wheel, 40 lb rigid-body mass, k 500: normal 1 in at 3 mph = 228 lbf (H 137, V 182); hard 2 in at 5 mph = 507 lbf (H 405, V 304)', () => {
    const sq = Math.sqrt((500 * 40) / 386.1); // sqrt(k m_e) = 7.197
    expect(sq).toBeCloseTo(7.197, 3);
    // NORMAL: sin(beta) = (5 - 1)/5 = 0.8, cos = 0.6; v = 3 x 17.6 = 52.8 in/s; v_n = 52.8 x 0.6 = 31.68; F_n = 31.68 x 7.197 = 228.0
    const n = bumpPulse({ rIn: 5, hIn: 1, vMph: 3, staticLb: 70, kLbIn: 500, meWeightLb: 40, dlfCheck: 3 });
    expect(n.vn).toBeCloseTo(31.68, 9);
    expect(n.Fn).toBeCloseTo(31.68 * sq, 9);
    expect(n.Fn).toBeCloseTo(228.0, 0);
    expect(n.H).toBeCloseTo(228.0 * 0.6, 0); // 136.8
    expect(n.V).toBeCloseTo(228.0 * 0.8, 0); // 182.4
    expect(peakVertical(n)).toBeCloseTo(182.4 + 70, 0); // 252 with the static load still on the tire
    expect(n.factor).toBeCloseTo(3.26, 2);
    expect(n.conventionalLb).toBe(210);
    // HARD: sin(beta) = (5 - 2)/5 = 0.6, cos = 0.8; v = 5 x 17.6 = 88 in/s; v_n = 70.4; F_n = 70.4 x 7.197 = 506.7
    const h = bumpPulse({ rIn: 5, hIn: 2, vMph: 5, staticLb: 70, kLbIn: 500, meWeightLb: 40, dlfCheck: 3 });
    expect(h.vn).toBeCloseTo(70.4, 9);
    expect(h.Fn).toBeCloseTo(70.4 * sq, 9);
    expect(h.Fn).toBeCloseTo(506.7, 0);
    expect(h.H).toBeCloseTo(506.7 * 0.8, 0); // 405.4
    expect(h.V).toBeCloseTo(506.7 * 0.6, 0); // 304.0
    expect(peakVertical(h)).toBeCloseTo(304.0 + 70, 0); // 374
    expect(h.factor).toBeCloseTo(7.24, 2);
    // 5 mph on the 1 in step (the pre-D-55 normal basis) was 380 lbf: walking pace cuts the routine load by 40%.
    expect(bumpPulse({ rIn: 5, hIn: 1, vMph: 5, staticLb: 70, kLbIn: 500, meWeightLb: 40 }).Fn).toBeCloseTo(380.0, 0);
    expect(n.Fn / 380.0).toBeCloseTo(0.6, 2);
  });

  it('hand calc on the real sled, goal rider, rear wheel, 1 in at 3 mph: W = 359 lb, CG x = 17.5, rear tire at (0, 17.75) on a plate 44 in x 35.5 in -> W_c = 61 lb, F_n = 282 lbf; 2 in at 5 mph = 626 lbf', () => {
    const ctx = ackCtx();
    const c = ctx.loads.goal;
    // plate gyration: ky = span/sqrt(12) with span = the wheelbase 44 (the front contacts at the kingpin line, x = 44); kx from the mean of the two tracks (35.5 and 35.5)
    const ky = 44 / Math.sqrt(12), kx = 35.5 / Math.sqrt(12);
    const wc = c.massLb / (1 + ((0 - c.cg[0]) / ky) ** 2 + ((17.75 - c.cg[1]) / kx) ** 2);
    expect(wc / 63.5).toBeGreaterThan(0.95); // 61 lb at the 134 lb empty sled, 63.5 lb at the 148 lb sled of D-58; the mass moves a little as parts change
    expect(wc / 63.5).toBeLessThan(1.05);
    expect(cornerWeightLb(ctx, c, 'rear')).toBeCloseTo(wc, 9);
    const sq = Math.sqrt((ctx.p.bumpWheelRateLbIn * wc) / 386.1);
    // normal: r = 5, h = 1 -> cos beta = 0.6; v_n = 3 x 17.6 x 0.6 = 31.68 in/s
    const n = bumpStrike(ctx, c, 'rear', 1);
    expect(n.Fn).toBeCloseTo(31.68 * sq, 6);
    expect(n.Fn / 286.4).toBeCloseTo(1, 1);
    // hard: h = 2 -> cos beta = 0.8; v_n = 5 x 17.6 x 0.8 = 70.4 in/s
    const h = bumpStrike(ctx, c, 'rear', 2, 1, 'hard');
    expect(h.Fn).toBeCloseTo(70.4 * sq, 6);
    expect(h.Fn / 636.4).toBeCloseTo(1, 1); // 70.4 x 9.04
    // static rear wheel: rear axle share W (1 - x/44) = 359.2 (1 - 17.46/44) = 216.7 lb, split 0.5 + |y|/track: 108.4 lb
    expect(n.staticLb).toBeCloseTo((c.massLb * (1 - c.cg[0] / 44)) * (0.5 + Math.abs(c.cg[1]) / 35.5), 6);
    expect(n.staticLb / 116.4).toBeCloseTo(1, 1); // 108.4 lb at the 134 lb sled, 116.4 lb at the 148 lb sled
  });

  it('the seat factor is 1 + V_rear / W (normal strike at walking pace, 3 mph, D-55), never below dynamicFactor', () => {
    const ctx = ackCtx();
    const c = ctx.loads.operating;
    const rear = bumpStrike(ctx, c, 'rear', ctx.p.bumpNormalHeightIn);
    expect(bumpSeatG(ctx, c)).toBeCloseTo(1 + rear.V / c.massLb, 9);
    expect(rear.vMph).toBe(3);
    expect(bumpSeatG(ctx, c)).toBeGreaterThan(1.0); // 3 mph, rigid-body mass (3c-3b): V is a fraction of W, so the factor sits between 1 and the dynamicFactor
    expect(bumpSeatG(ctx, c)).toBeLessThan(ctx.p.dynamicFactor);
    // The hard hit (2 in at 5 mph) is a bigger pulse and a bigger factor.
    expect(bumpSeatGHard(ctx, c)).toBeGreaterThan(bumpSeatG(ctx, c));
    expect(seatFactor(ctx, c)).toBe(Math.max(ctx.p.dynamicFactor, bumpSeatG(ctx, c)));
    // At least the dynamic factor of the load basis, and never less.
    expect(seatFactor(ctx, ctx.loads.operating)).toBeGreaterThanOrEqual(ctx.p.dynamicFactor);
  });

  it('prints the wheel-rate sensitivity (k x 0.5 and x 2.5) and Goodman matches the hand value', () => {
    const ctx = ackCtx();
    const txt = sensitivityText(ctx, ctx.loads.goal, 'front', 1);
    expect(txt).toMatch(/k 250, \d+ at 500, \d+ at 1250 lb\/in/);
    const lo = bumpStrike(ctx, ctx.loads.goal, 'front', 1, 0.5), mid = bumpStrike(ctx, ctx.loads.goal, 'front', 1), hi = bumpStrike(ctx, ctx.loads.goal, 'front', 1, 2.5);
    expect(lo.Fn / mid.Fn).toBeCloseTo(Math.sqrt(0.5), 9);
    expect(hi.Fn / mid.Fn).toBeCloseTo(Math.sqrt(2.5), 9);
    // sigma_max 10 ksi pulsating: n = 1 / (5/30 + 5/125) = 4.84
    expect(goodmanPulsating(10000, 30000, 125000)).toBeCloseTo(1 / (5000 / 30000 + 5000 / 125000), 9);
    expect(goodmanPulsating(0, 30000, 125000)).toBe(Infinity);
  });
});

// ── Phase 3c-3b: rigid-body effective mass, 10 inch pneumatic wheel, conventional cross-check ──────────────────────

/** 3-DOF rigid body on four linear tire springs; the struck wheel's ground input ramps at v_n. Returns the peak force in the struck tire (lbf). */
function fourSpringPeak(o: { weightLb: number; cg: [number, number]; wheels: [number, number][]; struck: number; k: number; vn: number; kx: number; ky: number }): number {
  const m = o.weightLb / 386.1, Iy = m * o.ky * o.ky, Ix = m * o.kx * o.kx;
  let z = 0, th = 0, ph = 0, vz = 0, vth = 0, vph = 0, peak = 0;
  const dt = 2e-5;
  for (let t = 0; t < 0.06; t += dt) {
    let Fz = 0, My = 0, Mx = 0, F1 = 0;
    o.wheels.forEach(([x, y], i) => {
      const xr = x - o.cg[0];
      const F = Math.max(0, o.k * ((i === o.struck ? o.vn * t : 0) - (z + th * xr - ph * y)));
      Fz += F; My += F * xr; Mx += -F * y;
      if (i === o.struck) F1 = F;
    });
    vz += (Fz / m) * dt; vth += (My / Iy) * dt; vph += (Mx / Ix) * dt;
    z += vz * dt; th += vth * dt; ph += vph * dt;
    peak = Math.max(peak, F1);
  }
  return peak;
}

describe('bump: rigid-body mass at the struck wheel (3c-3b)', () => {
  it('a uniform plate struck at its corner has the effective weight W/7 (1 + 3 + 3)', () => {
    // By hand: kx^2 = T^2/12, ky^2 = L^2/12, corner at (L/2, T/2): x^2/ky^2 = 3, y^2/kx^2 = 3, so W_c = W / 7.
    const L = 44, T = 30;
    expect(rigidCornerWeightLb(280, L / 2, T / 2, plateGyration(T), plateGyration(L))).toBeCloseTo(40, 9);
    // A point struck at the CG moves the whole body: W_c = W. A very distant point has almost no effective mass.
    expect(rigidCornerWeightLb(280, 0, 0, 5, 5)).toBe(280);
    expect(rigidCornerWeightLb(280, 100, 0, 5, 5)).toBeLessThan(1);
  });

  it('10 inch wheel, 70 lb static, symmetric 280 lb sled: 1 inch at 5 mph is 380 lbf (5.4x), 2 inch at 3 mph is 304 lbf (4.3x)', () => {
    // r = 5, h = 1: sin(beta) = 0.8, cos(beta) = 0.6; v = 88 in/s; v_n = 52.8 in/s; m_e = 40 / 386.1 = 0.1036; sqrt(500 x 0.1036) = 7.197; F_n = 380.0.
    const b = bumpPulse({ rIn: 5, hIn: 1, vMph: 5, staticLb: 70, kLbIn: 500, meWeightLb: 40, dlfCheck: 3 });
    expect(b.vn).toBeCloseTo(52.8, 9);
    expect(b.Fn).toBeCloseTo(52.8 * Math.sqrt(500 * (40 / 386.1)), 9);
    expect(b.Fn).toBeGreaterThan(379);
    expect(b.Fn).toBeLessThan(381);
    expect(b.H).toBeCloseTo(b.Fn * 0.6, 9); // 228
    expect(b.V).toBeCloseTo(b.Fn * 0.8, 9); // 304
    expect(b.factor).toBeCloseTo(5.43, 2);
    expect(b.conventionalLb).toBe(210); // 3 x 70
    expect(b.dropEqIn).toBeCloseTo(52.8 ** 2 / (2 * 386.1), 9); // 3.6 in of free drop
    // 2 inch at 3 mph: sin = 0.6, cos = 0.8, v_n = 52.8 x 0.8 = 42.24; F = 42.24 x 7.197 = 304.
    const hard = bumpPulse({ rIn: 5, hIn: 2, vMph: 3, staticLb: 70, kLbIn: 500, meWeightLb: 40 });
    expect(hard.Fn).toBeGreaterThan(303);
    expect(hard.Fn).toBeLessThan(305);
    expect(hard.factor).toBeCloseTo(4.34, 2);
  });

  it('the force scales as sqrt(m_e), so the factor on the static load falls with a heavier wheel (250 lb wheel, 1 inch, 5 mph: 718 lbf = 2.9x)', () => {
    const w250 = bumpPulse({ rIn: 5, hIn: 1, vMph: 5, staticLb: 250, kLbIn: 500, meWeightLb: (4 * 250) / 7 });
    expect(w250.Fn).toBeCloseTo(52.8 * Math.sqrt(500 * ((1000 / 7) / 386.1)), 9);
    expect(Math.round(w250.Fn)).toBe(718);
    expect(w250.factor).toBeLessThan(3);
  });

  it('the old interface still works (massShare x static) and meWeightLb takes precedence', () => {
    const old = bumpPulse({ rIn: 6.5, hIn: 1, vMph: 5, staticLb: 65, kLbIn: 400, massShare: 1.5 });
    expect(old.meWeightLb).toBeCloseTo(97.5, 9);
    expect(bumpPulse({ rIn: 6.5, hIn: 1, vMph: 5, staticLb: 65, kLbIn: 400, massShare: 1.5, meWeightLb: 30 }).meWeightLb).toBe(30);
  });

  it('the free-body corner mass agrees with a four-tire-spring simulation of the rigid sled within 10% (uniform mass, k 500)', () => {
    const L = 44, T = 30, W = 280;
    const wheels: [number, number][] = [[L, T / 2], [L, -T / 2], [0, T / 2], [0, -T / 2]];
    for (const [cgx, struck] of [[L / 2, 0], [0.4 * L, 0], [0.4 * L, 2]] as const) {
      const [wx, wy] = wheels[struck];
      const wc = rigidCornerWeightLb(W, wx - cgx, wy, plateGyration(T), plateGyration(L));
      const free = 51.7 * Math.sqrt(500 * (wc / 386.1));
      const sim = fourSpringPeak({ weightLb: W, cg: [cgx, 0], wheels, struck, k: 500, vn: 51.7, kx: plateGyration(T), ky: plateGyration(L) });
      expect(sim / free).toBeGreaterThan(0.95);
      expect(sim / free).toBeLessThan(1.1);
    }
  });

  it('on the real sled the struck-wheel mass is a fraction of the sled weight (about W/6 front, W/10 rear), and the multiplier scales the force by its square root', () => {
    const ctx = ackCtx();
    for (const c of [ctx.loads.empty, ctx.loads.goal]) {
      for (const wheel of ['front', 'rear'] as const) {
        const wc = cornerWeightLb(ctx, c, wheel);
        expect(wc).toBeGreaterThan(c.massLb / 12);
        expect(wc).toBeLessThan(c.massLb / 3);
        const b = bumpStrike(ctx, c, wheel, 1);
        expect(b.meWeightLb).toBeCloseTo(ctx.p.bumpMassShare * wc, 9);
      }
    }
    const ctx2 = ackCtx({ bumpMassShare: 2 });
    const r = bumpStrike(ctx2, ctx2.loads.goal, 'front', 1).Fn / bumpStrike(ctx, ctx.loads.goal, 'front', 1).Fn;
    expect(r).toBeCloseTo(Math.sqrt(2 / ctx.p.bumpMassShare), 9);
  });

  it('the pulse is below the old model (1.5 x static, 400 lb/in) and the conventional cross-check is reported with it', () => {
    const ctx = ackCtx();
    const c = ctx.loads.goal;
    for (const wheel of ['front', 'rear'] as const) {
      const nw = bumpStrike(ctx, c, wheel, 1);
      const old = bumpPulse({ rIn: ctx.d.wheelRadiusIn, hIn: 1, vMph: nw.vMph, staticLb: nw.staticLb, kLbIn: 400, massShare: 1.5 });
      expect(nw.Fn).toBeLessThan(old.Fn);
      expect(nw.conventionalLb).toBeCloseTo(ctx.p.bumpDlfCheck * nw.staticLb, 9);
      expect(bumpText(nw, 'x', ctx.p)).toMatch(/conventional check \d+ lbf \(3\.0x static\)/);
    }
    // At the normal walking pace (3 mph, D-55) the discrete 1 inch step lands near the conventional 2 to 3 x for the heavier wheel.
    expect(bumpStrike(ctx, c, 'rear', 1).factor).toBeLessThan(3.0);
  });

  it('the default wheel rate is the pneumatic hand-truck tire: 300 lb at 0.6 in squash = 500 lb/in, flagged verify with a measuring note', async () => {
    const { PARAM_DEFS } = await import('../params');
    expect(PARAM_DEFS.bumpWheelRateLbIn.default).toBe(500);
    expect(PARAM_DEFS.bumpWheelRateLbIn.status).toBe('verify');
    expect(PARAM_DEFS.bumpWheelRateLbIn.note).toMatch(/squash/);
  });
});
