import { describe, expect, it } from 'vitest';
import { defaultParams, derived, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext } from './context';
import { footStopCheck, footStopLoads, hullChecks, liftCheck, liftShares, transportMassCg } from './hull';
import { liftBarStressPsi, liftSlot } from '../model/body';
import { innerHalfWidth } from '../model/layout';

const ctxFor = (patch: Partial<Params> = {}) => {
  const p = { ...defaultParams(), ...patch } as Params;
  return makeContext(p, buildModel(p, { rider: 'goal', cargo: true }));
};
const ctx = ctxFor();
const al = derived(defaultParams());

describe('hull checks (D-43)', () => {
  it('returns lift and foot-stop (the prow-grab check went with the prow, D-45), all Structure and finite; foot-stop passes and lift FAILS at the defaults (FINDING, D-56: lifting the nose by the tongue bends the 3/16 in plate)', () => {
    const cs = hullChecks(ctx);
    expect(cs.map((c) => c.id)).toEqual(['lift', 'foot-stop']);
    for (const c of cs) {
      expect(c.group).toBe('Structure');
      expect(Number.isFinite(c.value)).toBe(true);
    }
    expect(cs[1].status === 'pass' || cs[1].status === 'marginal').toBe(true);
    expect(cs[0].status).toBe('fail');
    expect(cs[0].details!.find((d) => d.util > 1)!.name).toMatch(/tongue plate bending/);
    expect(cs[0].details!.filter((d) => d.util > 1)).toHaveLength(1); // everything else in the row (rear bar, shackle pin, kingpin, nut washer) passes
  });

  it('lift share by hand: 137.1 lb with the CG 18.4" ahead of the rear axle and the rear hand-hold at -9.625" and the front rope loop at 56.6" -> rear 137.1 x (56.6 - 18.4) / 66.25 = 79.0 lb', () => {
    const s = liftShares(137.1, 18.4, -9.625, 56.625);
    expect(s.rear).toBeCloseTo((137.1 * (56.625 - 18.4)) / (56.625 + 9.625), 9);
    expect(s.rear).toBeCloseTo(79.1, 1);
    expect(s.front).toBeCloseTo(58.0, 1);
    expect(s.rear + s.front).toBeCloseTo(137.1, 9);
    // Bar by hand: P = 79.1 x 3 = 237.3 lbf; M = P L / 4 = 237.3 x 4.5 / 4 = 267 lb.in; S = 0.75 x 0.75^2 / 6 = 0.0703125 in3 -> 3,797 psi.
    const sigma = liftBarStressPsi({ zBot: 0, zTop: 1, transomTop: 2, barIn: 0.75, thickIn: 0.75, lengthIn: 4.5 }, 79.1 * 3);
    expect(sigma).toBeCloseTo(3797, -1);
    expect(sigma / al.oakDesignMorPsi).toBeLessThan(0.6);
  });

  it('the lift row at the defaults by hand (D-54): the rear lifter holds the 0.75 x 0.75 in bar over the 4.5 in rear slot; the front lifter carries through a rope loop in the bridle shackle at the tongue tip (x = 59 in); the CG-weighted rear share is about 60%', () => {
    const c = liftCheck(ctx);
    const { massLb, xCg } = transportMassCg(ctx.parts);
    expect(Math.abs(massLb / 120 - 1)).toBeLessThan(0.15); // the cart with the removable parts off (about 120 lb; it moves as parts change)
    expect(xCg).toBeGreaterThan(14);
    expect(xCg).toBeLessThan(17.5);
    // hand-holds: rear bar at x = xRear + transom/2 = -10 + 0.375 = -9.625 in; the front loop through the shackle in the tie hole of the tongue (D-56): x = tip 60 - 1
    const xr = ctx.L.xRear + ctx.L.transom / 2;
    expect(xr).toBeCloseTo(-9.625, 9);
    const xf = ctx.L.tongue.holeX;
    expect(xf).toBeCloseTo(59, 9);
    const rear = massLb * (xf - xCg) / (xf - xr);
    expect(rear / massLb).toBeGreaterThan(0.58);
    expect(rear / massLb).toBeLessThan(0.66);
    expect(rear).toBeGreaterThan(massLb / 2); // the CG sits aft of the middle, so the rear person carries more
    const s = liftSlot(ctx);
    expect(s.lengthIn).toBe(4.5);
    expect(s.barIn).toBe(0.75);
    expect(s.thickIn).toBe(ctx.L.transom);
    expect(ctx.L.transom).toBe(0.75);
    // the rear bar: P = share x dynamicFactor (3) on one hand; sigma = (P L / 4) / (t h^2 / 6)
    const P = rear * ctx.p.dynamicFactor;
    const sigma = (P * 4.5 / 4) / (0.75 * 0.75 ** 2 / 6);
    const bend = c.details!.find((d) => d.name === 'rear slot bar bending')!;
    expect(bend.value).toBeCloseTo(sigma, 6);
    expect(Math.abs(bend.value / 3672 - 1)).toBeLessThan(0.1); // mass drifts a few percent while the brake design settles
    expect(bend.limit).toBeCloseTo(al.oakDesignMorPsi, 6);
    // shear: tau = 1.5 (P/2) / (t h) = 1.5 x 114.75 / 0.5625 = 306 psi vs oak shear 850
    const shear = c.details!.find((d) => d.name === 'rear slot bar shear')!;
    expect(shear.value).toBeCloseTo((1.5 * (P / 2)) / (0.75 * 0.75), 6);
    expect(Math.abs(shear.value / 306 - 1)).toBeLessThan(0.1);
    expect(shear.limit).toBeCloseTo(850, 0);
    // the front lifter: Pf = (m - rear) x 3 lbf at the tie hole of the tongue. Shackle pin (1/2 in) in double shear: Pf / (2 x pi d^2/4) vs 0.577 x 36,000 / 2
    const Pf = (massLb - rear) * 3;
    const pin = c.details!.find((d) => d.name.includes('shackle pin'))!;
    expect(pin.value).toBeCloseTo(Pf / (2 * Math.PI * 0.5 ** 2 / 4), 6);
    expect(pin.limit).toBeCloseTo((0.577 * 36000) / 2, 6);
    // the tongue plate is a 3/16 in flat bar cantilevered from the beam face (x = 44 + 1.25): the head is 4 in wide to x = 46, tapers to 2.5 in at x = 50, then 2.5 in to the tie hole at 59.
    // sigma(x) = Pf (59 - x) / (w(x) t^2 / 6); the worst section is at the end of the taper.
    const w = (x: number) => (x <= 46 ? 4 : x >= 50 ? 2.5 : 4 - (1.5 * (x - 46)) / 4);
    let worst = 0;
    for (let x = 45.25; x <= 59; x += 0.01) worst = Math.max(worst, (Pf * (59 - x)) / ((w(x) * 0.1875 ** 2) / 6));
    const bar = c.details!.find((d) => d.name.includes('tongue plate bending'))!;
    expect(bar.value / worst).toBeCloseTo(1, 3);
    expect(bar.limit).toBe(ctx.p.bracketSteelYieldPsi / ctx.p.steelSafetyFactor);
    expect(bar.limit).toBe(18000);
    expect(bar.util).toBeGreaterThan(4); // the flat bar yields at about 38 lbf at the tip: lift the nose by the body, not the tongue
    // the kingpin in tension if the axle hangs from the nut: Pf / A_t (5/8-11: 0.226 in2) vs 130,000 / 2; the nut washer bears on the oak slot ceiling
    const king = c.details!.find((d) => d.name.includes('kingpin in tension'))!;
    expect(king.value).toBeCloseTo(Pf / (Math.PI / 4 * (0.625 - 0.9743 / 11) ** 2), 4);
    expect(king.limit).toBe(65000);
    expect(king.util).toBeLessThan(0.05);
    // the rear bar is the next tightest (util 0.56); there is no front slot any more (the front transom and its hand-hold are gone)
    expect(c.details!.some((d) => d.name.includes('front slot'))).toBe(false);
    expect(Math.abs(bend.util / 0.564 - 1)).toBeLessThan(0.1);
    expect(c.status).toBe('fail');
    expect(c.how).toMatch(/rope loop in the bridle shackle/);
  });

  it('the lift is a transport-configuration row: the seat is removable, so moving it does not move the lifted mass or its CG', () => {
    const base = liftCheck(ctx).details!.find((d) => d.name === 'rear slot bar bending')!.value;
    const fwd = liftCheck(ctxFor({ seatXIn: 22 })).details!.find((d) => d.name === 'rear slot bar bending')!.value;
    expect(base).toBeGreaterThan(0);
    expect(fwd).toBeGreaterThan(0);
    expect(fwd / base).toBeGreaterThan(0.9);
    expect(fwd / base).toBeLessThan(1.1);
  });

  it('foot stop by hand: 200 lb x 2 g x 0.6 = 240 lbf; the board spans the inside width 22.75 in (sides are parallel); M = F L / 4 = 1,365 lb.in, S = 4 x 0.75^2 / 6 = 0.375, sigma = 3,640 psi; 8 deck screws at 30 lbf', () => {
    const k = footStopLoads(ctx, 200, 2)!;
    const span = 2 * innerHalfWidth(ctx.L, 48);
    expect(span).toBeCloseTo(24 - 2 * 0.625, 9); // body width 24 in less two 0.625 in sides
    expect(span).toBeCloseTo(22.75, 9);
    expect(k.F).toBeCloseTo(240, 9);
    expect(k.span).toBeCloseTo(span, 6);
    expect(k.t).toBeCloseTo(0.75, 6);
    expect(k.h).toBeCloseTo(4, 6);
    expect(k.M).toBeCloseTo((240 * span) / 4, 6);
    expect(k.M).toBeCloseTo(1365, 6);
    expect(k.S).toBeCloseTo(0.375, 9);
    expect(k.sigma).toBeCloseTo(3640, 6);
    expect(k.screws).toBe(8); // 4 through the board + 2 through each of 2 cleats
    expect(k.screwLoad).toBeCloseTo(30, 9);
    // the two cleats stand aft of the board (47.6 in vs the board at 47.6-48.4): no cleat bears on the board's front face, the screws carry the push
    expect(k.aheadCount).toBe(0);
    const fs = footStopCheck(ctx)!;
    expect(fs.statusGoal).not.toBe('fail');
    expect(fs.id).toBe('foot-stop');
    expect(fs.label).toMatch(/bump/);
    expect(fs.details!.some((d) => d.name.includes('cleat bearing'))).toBe(false);
    expect(fs.how).toMatch(/No cleat stands ahead of the board/);
  });

  it('foot stop in the check: the goal rider pushes 200 lb x seatFactor 1.47 x 0.6 = 176.8 lbf (3 mph bump), 2,681 psi bending = util 0.46; the 2 in hit at 5 mph uses seat factor 2.05', () => {
    const fs = footStopCheck(ctx)!;
    const goal = fs.cases!.goal!;
    expect(goal.status).toBe('pass');
    expect(Math.abs(goal.util / 0.458 - 1)).toBeLessThan(0.1);
    const k = footStopLoads(ctx, 200, 1.4735)!; // the seat factor 1 + V_rear / W at 3 mph
    expect(Math.abs(k.F / 176.8 - 1)).toBeLessThan(0.1);
    expect(Math.abs(k.sigma / 2681 - 1)).toBeLessThan(0.1);
    expect(fs.details!.find((d) => d.name.includes('HARD'))!.name).toMatch(/seat factor 2\.\d\d/);
    expect(fs.cases!.operating!.util).toBeLessThan(goal.util);
  });

  it('foot stop screws are overloaded when the load is real: 4 g and the whole share (200 x 4 x 1.0 = 800 lbf, 100 lbf per screw > 90)', () => {
    expect(footStopLoads(ctxFor({ footStopShare: 1 }), 200, 4)!.screwLoad).toBeCloseTo(100, 9);
    expect(footStopLoads(ctxFor({ footStopShare: 1 }), 200, 4)!.screwLoad).toBeGreaterThan(ctx.p.woodScrewLateralLbf);
  });
});
