import { describe, expect, it } from 'vitest';
import { ackCtx } from './ack-test-utils';
import { CRR, GO_DECEL_G, decelGeom, goStatus, practicalDecelG, rideChecks, rideEnvelope, rideRollover, steerCentering, worstBiasDecelG } from './ride';

describe('practical deceleration (study 1.1, 1.5)', () => {
  it('level ground, CG at mid-wheelbase and ground level: both axles at mu W/2, so mu + Crr', () => {
    expect(practicalDecelG({ x: 22, h: 0, L: 44 }, 0, 0.5, 0.5)).toBeCloseTo(0.5 + CRR, 9);
  });
  it('with load transfer h/L = 0.3 the rear limits: F = mu A_r / (1 - s + mu k) by hand', () => {
    const k = 0.3, mu = 0.5, s = 0.5;
    const F = (mu * 0.5) / (1 - s + mu * k);
    expect(practicalDecelG({ x: 22, h: 13.2, L: 44 }, 0, mu, s)).toBeCloseTo(F + CRR, 9);
  });
  it('reproduces the study table at the real CG (worst of front shares 0.4/0.5/0.6)', () => {
    const ctx = ackCtx();
    const g = decelGeom(ctx, ctx.loads.operating);
    const at = (s: number, mu: number) => worstBiasDecelG(g, s, mu, 0.5, 0.1); // the study's +/-0.1 around 0.5
    expect(at(5, 0.5)).toBeCloseTo(0.35, 1);
    expect(at(8, 0.4)).toBeCloseTo(0.21, 1);
    expect(at(10, 0.5)).toBeCloseTo(0.25, 1);
    expect(at(15, 0.5)).toBeCloseTo(0.16, 1);
    expect(goStatus(at(8, 0.4))).toBe('GO');
    expect(goStatus(at(10, 0.4))).toBe('CAUTION');
    expect(goStatus(at(10, 0.3))).toBe('NO');
  });
});

describe('ride rows', () => {
  const ctx = ackCtx();
  it('ride: lateral acceleration at 10 mph at the ride lock is about 0.26 g against 0.5 x SSF', () => {
    const r = rideRollover(ctx);
    expect(r.cases!.operating!.value).toBeGreaterThan(0.24);
    expect(r.cases!.operating!.value).toBeLessThan(0.29);
    const ssf = r.cases!.operating!.limit / 0.5;
    expect(ssf).toBeGreaterThan(1.1);
    expect(ssf).toBeLessThan(1.35);
    expect(r.status).toBe('pass');
  });
  it('ride-envelope is an info row; its two GO corners are at least 0.2 g at the solved front share (0.60), but not at the share +/- 0.05 for the 8 deg corner: the row says so', () => {
    const r = rideEnvelope(ctx);
    expect(r.status).toBe('info');
    const by = (re: RegExp) => r.details!.find((d) => re.test(d.name))!;
    expect(by(/8 deg corner at exactly the solved share/).value).toBeGreaterThanOrEqual(GO_DECEL_G); // 0.218 g (WS-C)
    expect(by(/10 deg corner at exactly the solved share/).value).toBeGreaterThanOrEqual(GO_DECEL_G); // 0.292 g
    expect(by(/GO table value at 10 deg/).value).toBeGreaterThanOrEqual(GO_DECEL_G); // 0.232 g at 0.55..0.65
    expect(by(/GO table value at 8 deg/).value).toBeLessThan(GO_DECEL_G); // 0.174 g at the 0.65 share: honest
    expect(r.how).toMatch(/WATCH: at exactly the solved share/);
    expect(r.how).toMatch(/0\.55, 0\.60, 0\.65/);
    expect(r.how).toMatch(/Walk it down above 10 deg/);
  });
  it('the envelope follows the params: a lower friction threshold fails the 8 deg corner', () => {
    const r = rideEnvelope(ackCtx({ rideMuGo8: 0.3 }));
    expect(r.details![0].value).toBeLessThan(GO_DECEL_G);
  });
  it('steering-feel rows are info and finite', () => {
    const rows = rideChecks(ctx);
    expect(rows.map((x) => x.id)).toEqual(['ride-rollover', 'steer-centering', 'ride-steer-effort', 'ride-envelope']);
    expect(steerCentering(ctx).status).toBe('info');
    expect(steerCentering(ctx).value).toBeGreaterThan(10);
  });
});
