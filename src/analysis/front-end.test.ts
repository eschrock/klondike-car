import { describe, expect, it } from 'vitest';
import { ackCtx } from './ack-test-utils';
import { bumpCases, goodmanPulsating, peakVertical, staticWheelLb } from './bump';
import { frontEndChecks, frontHit, kingpinLoad, leafArmIn, spindleStubCheck, stubArmIn, stubDiameterIn, kingpinBoltCheck, kingpinBracketCheck, frontBeamCheck, wheelRetentionCheck, spindleFatigueCheck, beamLevers } from './front-end';
import { byId } from './ack-test-utils';

const util = (c: { details?: { util: number; name: string }[] }, prefix: string) => c.details!.find((d) => d.name.startsWith(prefix))!;

describe('spindle rows (spec 5.5)', () => {
  const ctx = ackCtx();
  it('a 25 mm stub passes normal and hard at the goal rider', () => {
    const c = spindleStubCheck(ctx);
    expect(c.cases!.goal!.status).not.toBe('fail');
    expect(c.statusOperating).not.toBe('fail');
    expect(stubDiameterIn(ctx)).toBeCloseTo(25 / 25.4, 9);
  });

  it('stub bending is the hand value M / S with M = a x resultant of H and V + static', () => {
    const c = ctx.loads.goal;
    const h = frontHit(ctx, c, 'normal');
    const d = stubDiameterIn(ctx);
    const S = (Math.PI * d ** 3) / 32;
    const a = ctx.L.front.ack.scrub - ctx.p.spindleBossRadiusIn;
    expect(stubArmIn(ctx)).toBeCloseTo(a, 9);
    const hand = (a * Math.hypot(h.b.H, h.b.V + h.b.staticLb)) / S;
    const row = spindleStubCheck(ctx);
    expect(row.details![0].value).toBeCloseTo(hand, 3);
    expect(row.details![0].limit).toBeCloseTo(ctx.p.spindleYieldPsi / ctx.p.steelSafetyFactor, 6);
    // Hard-hit row compares to ultimate / failSafeFactor.
    const hard = util(row, 'HARD 2" hit: stub bending');
    expect(hard.util).toBeGreaterThan(0);
    const hh = frontHit(ctx, c, 'hard');
    expect((hard as unknown as { limit: number }).limit).toBeCloseTo(ctx.p.spindleUltimatePsi / ctx.p.failSafeFactor, 6);
    expect(hh.R).toBeGreaterThan(h.R);
  });

  it('a 17 mm stub is 3.2x as stressed (section modulus) and is no longer comfortable in normal use', () => {
    const c17 = ackCtx({ spindleStub: 0 });
    const r25 = spindleStubCheck(ctx), r17 = spindleStubCheck(c17);
    const ratio = (r17.details![0].value) / (r25.details![0].value);
    expect(ratio).toBeGreaterThan(3.0);
    expect(ratio).toBeLessThan(3.4);
    expect(r17.cases!.goal!.status).not.toBe('pass'); // at jogging pace (D-53) it is marginal; at the 10 mph of the ride study it failed
    expect(r17.cases!.goal!.util).toBeGreaterThan(3 * r25.cases!.goal!.util - 0.05);
  });

  it('spindle-fatigue: Goodman factor matches the hand value and the stub is far above the limit at the defaults', () => {
    const c = ctx.loads.goal;
    const P = staticWheelLb(ctx, c, 'front');
    const d = stubDiameterIn(ctx);
    const sig = (P * ctx.p.fatigueLoadFactor * stubArmIn(ctx)) / ((Math.PI * d ** 3) / 32);
    const n = goodmanPulsating(sig, ctx.p.spindleEnduranceLimitPsi, ctx.p.spindleUltimatePsi);
    const row = spindleFatigueCheck(ctx);
    const stub = row.details!.find((x) => x.name.startsWith('stub bending'))!;
    expect(stub.value).toBeCloseTo(n, 6);
    expect(n).toBeGreaterThan(ctx.p.fatigueSafetyMin * 3);
    // 17 mm: lower, by about the section modulus ratio.
    const n17 = spindleFatigueCheck(ackCtx({ spindleStub: 0 })).details![0].value;
    expect(n17).toBeLessThan(n);
    expect(n17).toBeGreaterThan(1);
  });

  it('wheel-retention: F_lat = 0.8 V_hard against the hand thread capacity', () => {
    const c = ctx.loads.goal;
    const row = wheelRetentionCheck(ctx);
    const V = bumpCases(ctx, c, 'front').hard.V;
    const thread = row.details!.find((d) => d.name.includes('castle nut threads'))!;
    expect(thread.value).toBeCloseTo(ctx.p.rutWallLateralFrac * V, 6);
    const dT = stubDiameterIn(ctx) * ctx.p.stubThreadFrac;
    const cap = Math.PI * dT * ctx.p.wheelNutEngagementIn * 0.5 * ((0.6 * ctx.p.spindleUltimatePsi) / ctx.p.failSafeFactor);
    expect(thread.limit).toBeCloseTo(cap, 3);
    expect(peakVertical(bumpCases(ctx, c, 'front').hard)).toBeGreaterThan(V);
  });
});

describe('kingpin, bracket and beam rows', () => {
  const ctx = ackCtx();
  it('kingpin statics: pure fore-aft H gives the couple z H / (2 s) plus H / 2 on the loaded leaf; bolt bending R (s - Lb/4)', () => {
    const k = kingpinLoad(ctx, { H: 1000, Fy: 0, V: 0 });
    const s = (ctx.p.kingpinBracketGapIn + ctx.p.kingpinBracketThickIn) / 2;
    const Rx = 500 + (ctx.p.spindleBossAboveStubIn * 1000) / (2 * s);
    expect(k.Rx).toBeCloseTo(Rx, 6);
    expect(k.Ry).toBeCloseTo(0, 9);
    expect(k.Mbolt).toBeCloseTo(Rx * (s - ctx.p.spindleBossLengthIn / 4), 6);
    expect(k.Mz).toBeCloseTo(ctx.L.front.ack.scrub * 1000, 6);
    // V acts at scrub minus the boss thrust radius.
    const kv = kingpinLoad(ctx, { H: 0, Fy: 0, V: 1000 });
    expect(kv.Ry).toBeCloseTo(((ctx.L.front.ack.scrub - ctx.p.spindleBossRadiusIn) * 1000) / (2 * s), 6);
  });

  it('a bigger kingpin bolt cuts the bending stress by the cube of the diameter ratio', () => {
    const a = kingpinBoltCheck(ackCtx({ kingpinDiameterIn: 0.375 })), b = kingpinBoltCheck(ackCtx({ kingpinDiameterIn: 0.5 }));
    const bend = (c: typeof a) => c.details!.find((d) => d.name.startsWith('NORMAL 1" bump: kingpin bolt bending'))!.value;
    expect(bend(b) / bend(a)).toBeCloseTo((0.375 / 0.5) ** 3, 3);
  });

  it('bracket leaf bending is V arm / (w t2 / 6) and falls with the square of the leaf thickness', () => {
    const c = ctx.loads.goal;
    const row = kingpinBracketCheck(ctx);
    const h = frontHit(ctx, c, 'normal');
    const t = ctx.p.kingpinBracketThickIn, w = 2 * ctx.p.kingpinBracketLeafRadiusIn;
    const hand = (h.Vt * leafArmIn(ctx)) / ((w * t * t) / 6);
    expect(row.details![0].value).toBeCloseTo(hand, 3);
    const thick = kingpinBracketCheck(ackCtx({ kingpinBracketThickIn: 0.375 }));
    expect(thick.details![0].value / row.details![0].value).toBeCloseTo((0.1875 / 0.375) ** 2 * (leafArmIn(ackCtx({ kingpinBracketThickIn: 0.375 })) / leafArmIn(ctx)), 2);
  });

  it('beam-front: bending is the resultant times the cantilever from the rail seat over the tube modulus', () => {
    const c = ctx.loads.goal;
    const lv = beamLevers(ctx);
    expect(lv.wheelY).toBeCloseTo(17.75, 6);
    expect(lv.arm).toBeGreaterThan(5);
    const h = frontHit(ctx, c, 'normal');
    const p = ctx.p;
    const I = (p.frontBeamWidthIn * p.frontBeamDepthIn ** 3 - (p.frontBeamWidthIn - 2 * p.frontBeamWallIn) * (p.frontBeamDepthIn - 2 * p.frontBeamWallIn) ** 3) / 12;
    const sig = (h.R * lv.arm) / (I / (p.frontBeamDepthIn / 2));
    const row = frontBeamCheck(ctx);
    expect(row.details![0].value).toBeGreaterThanOrEqual(sig); // von Mises adds torsion and shear
    expect(row.details![0].value).toBeLessThan(sig * 1.15);
    expect(row.details![0].limit).toBeCloseTo(p.frontBeamYieldPsi / p.steelSafetyFactor, 6);
  });

  it('every row is dual-case, finite, cites D-50 and carries a wheel-rate sensitivity line where it is bump-driven', () => {
    const rows = frontEndChecks(ctx);
    expect(rows.map((r) => r.id)).toEqual(['spindle-stub', 'kingpin-bolt', 'kingpin-bracket', 'beam-front', 'wheel-retention', 'spindle-fatigue']);
    for (const r of rows) {
      expect(r.cases!.operating && r.cases!.goal).toBeTruthy();
      expect(Number.isFinite(r.util!)).toBe(true);
      expect(r.refs!.join()).toMatch(/D-5/);
    }
    for (const id of ['spindle-stub', 'kingpin-bolt', 'kingpin-bracket', 'beam-front']) expect(byId(rows, id).how).toMatch(/Wheel-rate sensitivity/);
  });
});
