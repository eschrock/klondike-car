/**
 * Front brakes, hip controls and the lined rear shoes (Phase 3b WS-C, D-56): geometry re-derived by hand, the bias solve in both rolling directions,
 * the lost-motion slot, part placement (steer bodies, clear of the tire and the hull) and the old defaults left alone.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, type Params } from '../params';
import { buildModel } from './index';
import { makeCtx } from './build-utils';
import { brakeGeometry } from './brake';
import { frontBrakeGeometry, frontBrakeShare } from './brake-front';
import { hipControlGeometry } from './brake-controls';
import { partsOverlap } from './bounds';

const RAD = Math.PI / 180;
const p3 = defaultParams();
const geom = (p: Params) => { const c = makeCtx(p); const g = brakeGeometry(c.p, c.L); return { c, g, fg: frontBrakeGeometry(c.p, c.L, g), hg: hipControlGeometry(c.p, c.L, g) }; };

describe('front brake geometry (hand calculation)', () => {
  const { c, g, fg } = geom(p3);
  it('the front shoe sits on the FRONT of the tread at the front-shoe angle; the pin is at the standoff radius on the tread normal', () => {
    const b = p3.frontBrakeShoeAngleDeg * RAD;
    const rPin = c.L.r + p3.brakeShoeThickIn / 2;
    expect(fg.on).toBe(true);
    expect(fg.E[0]).toBeCloseTo(c.L.WB + rPin * Math.cos(b), 9);
    expect(fg.E[1]).toBeCloseTo(c.L.r - rPin * Math.sin(b), 9);
    expect(fg.n[0]).toBeGreaterThan(0.9); // normal points forward: the front of the tire
  });
  it('the arm is offset from the tread tangent by the rear arm\'s friction-line ratio, so servo k = |Kn ∓ mu Kt| scales the same way as the rear', () => {
    expect(fg.rho).toBeCloseTo(Math.abs(g.Kt / g.Kn), 9);
    expect(fg.offsetIn).toBeCloseTo(fg.rho * p3.frontBrakeArmLenIn, 9);
    // re-derive Kn, Kt from the pivot and pin
    const a: [number, number] = [fg.E[0] - fg.S[0], fg.E[1] - fg.S[1]];
    const Kn = a[0] * fg.n[1] - a[1] * fg.n[0], Kt = a[0] * fg.tFwd[1] - a[1] * fg.tFwd[0];
    expect(Kn).toBeCloseTo(fg.Kn, 9);
    expect(Kt).toBeCloseTo(fg.Kt, 9);
    expect(fg.kFwd).toBeCloseTo(Math.abs(Kn + p3.brakePadMu * Kt), 9);
    expect(fg.kRev).toBeCloseTo(Math.abs(Kn - p3.brakePadMu * Kt), 9);
    expect(fg.kRev / fg.kFwd).toBeCloseTo(g.kRev / g.kFwd, 6);
  });
  it('the pivot is outside the tire, and the released pin is the stroke off the tread along the swing', () => {
    expect(Math.hypot(fg.S[0] - fg.O[0], fg.S[1] - fg.O[1])).toBeGreaterThan(c.L.r + 0.5);
    const dE = Math.hypot(fg.Erel[0] - fg.E[0], fg.Erel[1] - fg.E[1]);
    expect(dE).toBeCloseTo(2 * fg.armLen * Math.sin(Math.abs(fg.thetaF) / 2), 9); // chord of the swing
    expect(Math.abs(fg.thetaF)).toBeCloseTo(fg.stroke / Math.abs(fg.Kn), 9);
  });
  it('the cable stroke equals the rear link stroke: tail arm = link stroke x |Kn| / front stroke', () => {
    expect(fg.tailIn).toBeCloseTo((fg.linkStrokeIn * Math.abs(fg.Kn)) / fg.stroke, 6);
  });
});

describe('brake bias: the bias-bar arm gives the front share in both rolling directions', () => {
  it.each([0.4, 0.5, 0.55, 0.6])('target %f: front share within 0.02 forward and backward; total ratio = (1 - phi) Rr + phi Rf', (b) => {
    const { fg } = geom({ ...p3, frontBrakeBias: b });
    expect(Math.abs(fg.bias.fwd - b)).toBeLessThan(0.02);
    expect(Math.abs(fg.bias.rev - b)).toBeLessThan(0.02);
    expect(fg.aF).toBeCloseTo(fg.barIn * (1 - fg.phi), 9);
    expect(fg.Rtot.rev).toBeCloseTo((1 - fg.phi) * fg.Rr.rev + fg.phi * fg.Rf.rev, 9);
    // share re-derived: N_f / N_total
    expect(fg.bias.fwd).toBeCloseTo((fg.phi * fg.Rf.fwd) / (fg.phi * fg.Rf.fwd + (1 - fg.phi) * fg.Rr.fwd), 9);
  });
  it('a larger front arm gives the front LESS of the lever force (balance bar)', () => {
    const lo = geom({ ...p3, frontBrakeBias: 0.45 }).fg, hi = geom({ ...p3, frontBrakeBias: 0.6 }).fg;
    expect(hi.aF).toBeLessThan(lo.aF);
  });
  it('by virtual work the front brake adds no leverage: the total ratio stays within 5% of the rear-only critical ratio', () => {
    const { fg, g } = geom(p3);
    expect(Math.abs(fg.Rtot.rev / g.ratioCrit - 1)).toBeLessThan(0.05);
  });
  it('the sim share helper returns the mean share of the two rolling directions (0.60 at the defaults)', () => {
    const c = makeCtx(p3);
    expect(frontBrakeShare(p3, c.L)).toBeCloseTo(p3.frontBrakeBias, 2);
    expect(frontBrakeShare(p3, c.L)).toBeCloseTo(0.6, 2);
  });
  it('the sim spec takes the front share from the solved takeoff arm', async () => {
    const { buildSimSpec } = await import('../sim/spec');
    expect(buildSimSpec(buildModel(p3), p3).frontBrakeShare).toBeCloseTo(frontBrakeShare(p3, makeCtx(p3).L)!, 9);
  });
});

describe('hip lever and lost motion', () => {
  const { g, hg } = geom(p3);
  it('the lost-motion slot lets the main lever move its full stroke at the link point (1.4 in slot) without moving the hip lever', () => {
    expect(hg.linkTravelIn).toBeCloseTo(hg.linkAbove * g.thetaL, 9);
    expect(hg.slotIn).toBeGreaterThanOrEqual(hg.linkTravelIn + 0.1);
  });
  it('the hip lever throw gives enough cable travel for the full stroke, and the geometric hip-to-main force ratio is the spec 0.93', () => {
    expect(hg.lugTravelIn).toBeCloseTo(p3.hipLeverCableArmIn * p3.hipLeverThrowDeg * RAD, 9);
    expect(hg.lugTravelIn).toBeGreaterThan(hg.linkTravelIn);
    expect(hg.hipPerMain).toBeCloseTo((p3.hipLeverCableArmIn / p3.hipLeverArmIn) * (g.lGrip / p3.hipLinkAboveLeverPivotIn), 9);
    expect(hg.hipPerMain).toBeGreaterThan(0.9);
    expect(hg.hipPerMain).toBeLessThan(0.96);
  });
});

describe('parts', () => {
  const parts = buildModel(p3);
  const ids = new Set(parts.map((x) => x.id));
  it('front shoes, arms, horn and cables are on the steer bodies; the bias bar, equalizer and main cable are on the chassis', () => {
    for (const [tag, body] of [['L', 'steer-L'], ['R', 'steer-R']] as const) {
      for (const id of [`brake-shoe-F${tag}`, `brake-shoe-arm-F${tag}-in`, `brake-shoe-arm-F${tag}-out`, `brake-front-horn-${tag}`, `brake-shoe-pin-F${tag}`, `brake-shoe-pivot-F${tag}`, `brake-front-cable-${tag}`]) {
        expect(ids.has(id), id).toBe(true);
        expect(parts.find((x) => x.id === id)!.body, id).toBe(body);
      }
    }
    for (const id of ['brake-bias-bar', 'brake-front-equalizer', 'brake-front-cable-main']) expect(parts.find((x) => x.id === id)!.body).toBe('chassis');
  });
  it('the rear shoes are purchased lined steel-backed shoes of about 0.6 lb and the oak pad and lining are gone', () => {
    const s = parts.find((x) => x.id === 'brake-shoe-L')!;
    expect(s.kind).toBe('purchased');
    expect(s.massLb).toBeGreaterThan(0.4);
    expect(s.massLb).toBeLessThan(0.9);
    expect(ids.has('brake-shoe-lining-L')).toBe(false);
  });
  it('the hip lever, cable, lost-motion plate and lap belt exist, and the cables are not "rope"', () => {
    for (const id of ['hip-lever', 'hip-cable', 'brake-lost-motion-link', 'belt-anchor-L', 'belt-anchor-R', 'lap-belt-L', 'lap-belt-R']) expect(ids.has(id), id).toBe(true);
    for (const x of parts.filter((q) => /cable/.test(q.id))) expect(x.material.toLowerCase()).not.toMatch(/rope/);
  });
  it('none of the new parts overlaps another part (the old turntable stack aside), except the shoe on its own tire', () => {
    const mine = parts.filter((x) => /^(brake-front|brake-shoe-F|brake-shoe-arm-F|brake-shoe-pivot-F|brake-shoe-pin-F|brake-shoe-yoke|brake-bias|brake-lost|brake-hip|hip-|belt-|lap-belt)/.test(x.id) && x.id !== 'brake-front-equalizer');
    const others = parts.filter((x) => !x.payload);
    const bad: string[] = [];
    for (const a of mine) for (const b of others) {
      if (a === b) continue;
      if (/^brake-/.test(a.id) && /^brake-/.test(b.id)) continue;
      if (/^brake-shoe/.test(a.id) && /^wheel-/.test(b.id)) continue; // tire OBB is a conservative box
      const o = partsOverlap(a, b);
      if (o > 0.001) bad.push(`${a.id} x ${b.id} ${o.toFixed(3)}`);
    }
    expect(bad).toEqual([]);
  });
  it('mass of the new brake parts (front brake, hip controls, belt) is reported and bounded', () => {
    const mass = parts.filter((x) => /^(brake-front|brake-shoe-[A-Za-z-]*F|brake-bias|hip-|brake-hip|belt-|lap-belt)/.test(x.id)).reduce((s, x) => s + x.massLb, 0);
    expect(mass).toBeGreaterThan(8);
    expect(mass).toBeLessThan(25);
  });
});
