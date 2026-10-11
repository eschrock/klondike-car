import { describe, expect, it } from 'vitest';
import { ackCtx, byId } from './ack-test-utils';
import { frontHit, kingpinLoad } from './front-end';
import { armLeverIn, chain, eulerLoad, kickback, leverage, linkageChecks, stickCableCheck, tieRodCheck, tongueLinkageCheck, tongueSidePull, tongueTieCheck } from './linkage';

const ctx = ackCtx();

describe('kickback chain', () => {
  it('rod force = M_z / (arm fore-aft lever); M_z = scrub H for an aft hit', () => {
    const h = frontHit(ctx, ctx.loads.goal, 'hard');
    const k = kickback(ctx, h);
    expect(armLeverIn(ctx)).toBeCloseTo(ctx.L.front.ack.armLen * Math.cos((ctx.L.front.ack.armAngleDeg * Math.PI) / 180), 9);
    const Mz = Math.max(kingpinLoad(ctx, { H: h.H, Fy: 0, V: h.Vt }).Mz, ctx.L.front.ack.lead * h.Flat);
    expect(k.Mz).toBeCloseTo(Mz, 6);
    expect(k.Frod).toBeCloseTo(Mz / armLeverIn(ctx), 6);
  });

  it('moves through the drag link and bellcrank by moment balance', () => {
    const lv = leverage(ctx);
    const c = chain(ctx, frontHit(ctx, ctx.loads.goal, 'normal'));
    expect(c.Fdrag).toBeCloseTo(c.Frod / lv.dragCos, 6);
    expect(c.Mb).toBeCloseTo(c.Fdrag * lv.out, 6);
    expect(c.Fcable).toBeCloseTo(c.Mb / lv.cable, 6);
    expect(c.Ftl).toBeCloseTo(c.Mb / lv.inn, 6);
    expect(lv.dragCos).toBeGreaterThan(0.3);
    expect(lv.out).toBeGreaterThan(0.25);
  });

  it('the sideways tongue pull is the 45 degree lateral component over the tongue length, through the same chain', () => {
    const s = tongueSidePull(ctx);
    const lv = leverage(ctx);
    expect(s.Fperp).toBeCloseTo(150 * Math.SQRT1_2, 9);
    expect(s.Mh).toBeCloseTo(s.Fperp * ctx.p.tongueLengthIn, 9);
    expect(s.Flink).toBeCloseTo(s.Mh / lv.ear, 9);
    expect(s.Frod).toBeCloseTo(((s.Flink * lv.inn) / lv.out) * lv.dragCos, 9);
  });
});

describe('linkage rows', () => {
  it('tie-rod: Euler buckling load with a 1/2 inch rod is about 1,200 lbf', () => {
    expect(ctx.p.tieRodDiaIn).toBe(0.5);
    const Pcr = eulerLoad(ctx.p.steelMoePsi, 0.5, ctx.L.front.tieRod.len);
    expect(Pcr).toBeGreaterThan(1180);
    expect(Pcr).toBeLessThan(1220);
    const row = tieRodCheck(ctx);
    const e = row.details!.find((d) => d.name.startsWith('NORMAL 1" bump: Euler'))!;
    expect(e.limit).toBeCloseTo(Pcr / ctx.p.steelSafetyFactor, 6);
    expect(row.details!.some((d) => d.name.includes('sideways tongue pull'))).toBe(true);
    expect(row.how).toMatch(/buckling is a bend, not a break/);
  });

  it('tongue: hinge pin shear and bearing at the 150 lbf design pull match the hand values', () => {
    const row = tongueLinkageCheck(ctx);
    const A = (Math.PI / 4) * ctx.p.tongueHingePinDiaIn ** 2;
    expect(row.details!.find((d) => d.name.startsWith('hinge pin double shear'))!.value).toBeCloseTo(150 / (2 * A), 6);
    expect(row.details!.find((d) => d.name.startsWith('hinge pin bearing in the oak'))!.value).toBeCloseTo(150 / (ctx.p.tongueHingePinDiaIn * ctx.p.tongueDepthIn), 6);
  });

  it('tongue-tie keeps the eye-bolt hand numbers: 2 x 150 lbf, bolt shank is the intended weak link', () => {
    const row = tongueTieCheck(ctx);
    const p = ctx.p;
    const T = p.pullForceLbf * p.bridleTieOverloadFactor;
    const alpha = Math.atan2(Math.max(p.pullerHandHeightIn, p.bridleTieHandHeightMaxIn) - ctx.L.front.tongue.z, p.bridleRopeRunIn);
    const At = 0.75 * (Math.PI * p.eyeBoltDiameterIn ** 2) / 4, Z = (Math.PI * p.eyeBoltDiameterIn ** 3) / 32;
    const sig = (T * Math.sin(alpha)) / At + (T * Math.cos(alpha) * p.eyeBoltEyeOffsetIn) / Z;
    expect(row.details![0].value).toBeCloseTo(sig, 3);
    expect(row.details![0].util).toBeGreaterThan(row.details![1].util);
    expect(row.details![0].util).toBeGreaterThan(row.details![2].util);
  });

  it('stick-cable: the cable carries the lesser of the kickback and the hand-limited tension (60 lbf x 14" / 1.5" = 560 lbf)', () => {
    const row = stickCableCheck(ctx);
    const cab = row.details!.find((d) => d.name.startsWith('NORMAL: cable tension'))!;
    const handLimited = (ctx.p.stickHandLoadLbf * ctx.p.rideStickLengthIn) / ctx.L.front.stick.cableArm;
    expect(handLimited).toBeCloseTo(560, 6);
    const kick = chain(ctx, frontHit(ctx, ctx.loads.goal, 'normal')).Fcable;
    expect(cab.value).toBeCloseTo(Math.min(kick, handLimited), 6);
    expect(cab.limit).toBeCloseTo(ctx.p.stickCableBreakLbf / 3.5, 6);
  });

  it('the family returns dual-case rows with finite values', () => {
    const rows = linkageChecks(ctx);
    expect(rows.map((r) => r.id)).toEqual(['tie-rod', 'drag-link', 'bellcrank', 'steer-stop-load', 'tongue', 'tongue-tie', 'stick-cable']);
    for (const r of rows) { expect(Number.isFinite(r.util!)).toBe(true); expect(r.cases!.goal).toBeTruthy(); }
    expect(byId(rows, 'bellcrank').how).toMatch(/lever arms/);
  });
});
