import { describe, expect, it } from 'vitest';
import { defaultParams, derived, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext } from './context';
import { footStopCheck, footStopLoads, hullChecks, liftCheck, liftShares, transportMassCg } from './hull';
import { bowHold, liftBarStressPsi, liftSlot } from '../model/body';
import { innerHalfWidth } from '../model/layout';
import { PRE_D66 } from '../test-fixtures';

const ctxFor = (patch: Partial<Params> = {}) => {
  const p = { ...defaultParams(), ...PRE_D66, ...patch } as Params; // D-66: the foot brace hand calculations are the D-58 bow (21.5 in at the bulkhead); the D-66 bow is checked in d66.test.ts
  return makeContext(p, buildModel(p, { rider: 'goal', cargo: true }));
};
const ctx = ctxFor();
const al = derived(defaultParams());

describe('hull checks (D-43)', () => {
  it('returns lift and foot-stop (the prow-grab check went with the prow, D-45), all Structure and finite; both pass at the defaults (D-58: the nose is lifted by the hand-hold in the bow bulkhead, not by the tongue whose 3/16 in plate bent at 4.8x)', () => {
    const cs = hullChecks(ctx);
    expect(cs.map((c) => c.id)).toEqual(['lift', 'foot-stop', 'side-web']);
    for (const c of cs) {
      expect(c.group).toBe('Structure');
      expect(Number.isFinite(c.value)).toBe(true);
    }
    expect(cs[1].status === 'pass' || cs[1].status === 'marginal').toBe(true);
    expect(cs[0].status).toBe('pass');
    expect(cs[0].details!.some((d) => /bow bulkhead/.test(d.name))).toBe(true);
    expect(cs[0].details!.some((d) => /tongue|kingpin|shackle/.test(d.name))).toBe(false); // nothing is carried by the tongue any more
    expect(cs[0].details!.filter((d) => d.util > 1)).toHaveLength(0);
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

  it('the lift row at the defaults by hand (D-54, D-58): the rear lifter holds the 0.75 in high x 1/2 in thick (D-60) bar over the 4.5 in rear slot; the front lifter holds the hand-hold through the 1 1/2 in bow bulkhead (D-60, x = 50.0 in); the CG-weighted rear share is about 53%', () => {
    const c = liftCheck(ctx);
    const { massLb, xCg } = transportMassCg(ctx.parts);
    expect(Math.abs(massLb / 114 - 1)).toBeLessThan(0.15); // the sled with the removable parts off (the tongue among them; it moves as parts change); 138 lb before the D-60 weight package
    expect(xCg).toBeGreaterThan(14);
    expect(xCg).toBeLessThan(21);
    // hand-holds: rear bar at x = xRear + transom/2 = -10 + 0.25 = -9.75 in (1/2 in transom, D-60); the front hold at the middle of the bulkhead thickness
    const xr = ctx.L.xRear + ctx.L.transom / 2;
    expect(xr).toBeCloseTo(-9.75, 9);
    const xf = (ctx.L.hold.x0 + ctx.L.hold.x1) / 2;
    expect(xf).toBeCloseTo(50, 9); // the 1-1/2 in bulkhead (D-60) from 49.25 to 50.75
    const rear = massLb * (xf - xCg) / (xf - xr);
    expect(rear / massLb).toBeGreaterThan(0.5);
    expect(rear / massLb).toBeLessThan(0.62);
    const s = liftSlot(ctx);
    expect(s.lengthIn).toBe(4.5);
    expect(s.barIn).toBe(0.75);
    expect(s.thickIn).toBe(ctx.L.transom);
    expect(ctx.L.transom).toBe(0.5); // D-60: 1/2 in rear transom (was 3/4 in)
    // the rear bar: P = share x dynamicFactor (3) on one hand; sigma = (P L / 4) / (t h^2 / 6)
    const P = rear * ctx.p.dynamicFactor;
    const sigma = (P * 4.5 / 4) / (0.5 * 0.75 ** 2 / 6);
    const bend = c.details!.find((d) => d.name === 'rear slot bar bending')!;
    expect(bend.value).toBeCloseTo(sigma, 6);
    expect(bend.limit).toBeCloseTo(al.oakDesignMorPsi, 6);
    const shear = c.details!.find((d) => d.name === 'rear slot bar shear')!;
    expect(shear.value).toBeCloseTo((1.5 * (P / 2)) / (0.5 * 0.75), 6);
    expect(shear.limit).toBeCloseTo(850, 0);
    // the front lifter: Pf = (m - rear) x 3 lbf on one hand; the bar above the hand-hold is the bulkhead's crown, 1.5 in thick (D-60) with barIn of oak over the 4.5 in hold
    const Pf = (massLb - rear) * 3;
    const bh = bowHold(ctx);
    expect(bh.thickIn).toBeCloseTo(1.5, 9);
    expect(bh.barIn).toBeCloseTo(0.75, 6); // D-69: the hand-hold hangs under the crown (12.875) with liftBarMinIn (0.75 in) of oak above it (it was 1.5 in under the 5.75 in peak, 3c-5)
    const fb = c.details!.find((d) => d.name.includes('bow bulkhead') && /bending/.test(d.name))!;
    expect(fb.value).toBeCloseTo(liftBarStressPsi(bh, Pf), 6);
    const fs = c.details!.find((d) => d.name.includes('bow bulkhead') && /shear/.test(d.name))!;
    expect(fs.value).toBeCloseTo((1.5 * (Pf / 2)) / (bh.thickIn * bh.barIn), 6);
    expect(fb.util).toBeLessThan(0.3); // the front bar is still far from its limit (0.24 with the D-60 1-1/2 in bulkhead; it was under 0.1 at 1-3/4 in)
    // the rear bar is the tightest (util 0.67, D-60; was 0.54)
    expect(c.details!.reduce((m, d) => (d.util > m.util ? d : m)).name).toBe('rear slot bar bending');
    expect(Math.abs(bend.util / 0.67 - 1)).toBeLessThan(0.1); // 0.54 with the 3/4 in transom; the 1/2 in transom (D-60) is a weaker bar, and the sled is lighter
    expect(c.status).toBe('pass');
    expect(c.how).toMatch(/hand-hold through the bow bulkhead/);
  });
  it('the lift is a transport-configuration row: the seat is removable, so moving it does not move the lifted mass or its CG', () => {
    const base = liftCheck(ctx).details!.find((d) => d.name === 'rear slot bar bending')!.value;
    const fwd = liftCheck(ctxFor({ seatXIn: 22 })).details!.find((d) => d.name === 'rear slot bar bending')!.value;
    expect(base).toBeGreaterThan(0);
    expect(fwd).toBeGreaterThan(0);
    expect(fwd / base).toBeGreaterThan(0.9);
    expect(fwd / base).toBeLessThan(1.1);
  });

  it('foot brace by hand (D-57): 200 lb x 2 g x 0.6 = 240 lbf; the bulkhead spans the 20.25 in inside width at its face (the hull has turned in 1.25 in a side); the 4 in foot band loses the 1 1/8 in of the hand-hold slot at mid-span (D-69: the slot is 2 7/8 to 4 1/8 in over the deck): h = 2.875, t = 1.5 (D-60); M = F L / 4 = 1,215 lb.in, S = 2.875 x 1.5^2 / 6 = 1.078, sigma = 1,127 psi', () => {
    const k = footStopLoads(ctx, 200, 2)!;
    const span = 2 * innerHalfWidth(ctx.L, ctx.L.bulkhead.x0);
    expect(span).toBeCloseTo(24 - 2 * 0.625 - 2 * 1.25, 9);
    expect(span).toBeCloseTo(20.25, 9);
    expect(k.F).toBeCloseTo(240, 9);
    expect(k.span).toBeCloseTo(span, 6);
    expect(k.t).toBeCloseTo(1.5, 6);
    expect(k.h).toBeCloseTo(2.875, 6);
    expect(k.M).toBeCloseTo((240 * span) / 4, 6);
    expect(k.M).toBeCloseTo(1215, 6);
    expect(k.S).toBeCloseTo(2.875 * 2.25 / 6, 9);
    expect(k.sigma).toBeCloseTo(1215 / (2.875 * 2.25 / 6), 6);
    // the push pulls the bulkhead off: the deck tongue's glue (2 faces x the dado depth x 20.25 in) and the Dominos into the rail, chine and gunwale ends
    const dd = ctx.p.deckCaptureDepthIn;
    expect(k.dadoArea).toBeCloseTo(2 * dd * 20.25, 9);
    expect(k.dadoShear).toBeCloseTo(240 / (2 * dd * 20.25), 9);
    expect(k.dominoPts).toBeGreaterThanOrEqual(2); // D-62: the two rail ends; the sandwich band ends are butt joints, the web dados carry the rest
    expect(k.webDadoArea).toBeCloseTo(4 * dd * (ctx.L.deckTop + 4 - ctx.L.webCap - ctx.L.chineBot), 6); // 2 sides x 2 faces x the dado depth x the web height at the bulkhead (4.35 in)
    const fs = footStopCheck(ctx)!;
    expect(fs.statusGoal).not.toBe('fail');
    expect(fs.id).toBe('foot-stop');
    expect(fs.label).toMatch(/bump/);
    expect(fs.details!.some((d) => d.name.includes('deck-edge dado glue'))).toBe(true);
    expect(fs.details!.some((d) => d.name.includes('slot wall'))).toBe(false); // D-60: no foot block; the bulkhead is the only brace
    expect(fs.how).toMatch(/hand-hold slot is cut through it/);
  });

  it('foot brace in the check: the goal rider pushes 200 lb x seatFactor 1.47 x 0.6 = 176.8 lbf (3 mph bump), about 795 psi bending in the 3 in section (585 at 1-3/4 in, D-60); the 2 in hit at 5 mph uses seat factor 2.05', () => {
    const fs = footStopCheck(ctx)!;
    const goal = fs.cases!.goal!;
    expect(goal.status).toBe('pass');
    const k = footStopLoads(ctx, 200, 1.4735)!; // the seat factor 1 + V_rear / W at 3 mph
    expect(Math.abs(k.F / 176.8 - 1)).toBeLessThan(0.1);
    expect(Math.abs(k.sigma / 795 - 1)).toBeLessThan(0.1); // 585 psi with the 1-3/4 in bulkhead: sigma scales with 1/t^2
    expect(goal.util).toBeLessThan(0.3);
    expect(fs.details!.find((d) => d.name.includes('HARD'))!.name).toMatch(/seat factor 2\.\d\d/);
    expect(fs.cases!.operating!.util).toBeLessThan(goal.util);
  });

  it('the bulkhead joints are overloaded when the load is real: 4 g and the whole share on a bulkhead whose joints are 2 Dominos only', () => {
    const k = footStopLoads(ctxFor({ footStopShare: 1 }), 200, 4)!;
    expect(k.F).toBeCloseTo(800, 9);
    expect(k.dadoShear).toBeCloseTo(800 / k.dadoArea, 9);
    expect(k.dominoShear).toBeCloseTo(800 / (k.dominoPts * k.tenonArea + k.webDadoArea), 9); // the rail-end tenons plus the web dados (D-62)
  });
});
