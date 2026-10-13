/**
 * Bridle-tie row (D-56, D-58, D-62): the rope (the documented weak link, no shackle), the sleeve and oak around the bridle hole, the oak tongue stem and the two carriage bolts under the design
 * pull x the overload factor, plus the slack-then-taut SNATCH at the start of a pull. Everything is re-derived by hand:
 *   pull 150 lbf x 2 = 300 lbf, rope from the sleeve (x 54.25, z 4.22 = mid-depth of the tongue, 0.05 in lower since the tube stands proud of the beam, D-62, and 0.0425 in lower again on the 5/8 in axle with 0.03 in proud, D-71) up to the hands (40 in, the
 *   upper bound) over a 96 in run: alpha = atan(35.78 / 96) = 20.45 deg -> 281.0 lbf horizontal, 105.0 lbf vertical.
 * D-60: the tongue is 1-1/4 in thick x 1-3/4 in deep (was 1-1/2 x 2).
 * The tongue is white oak set ON EDGE: 1.25 in thick x 1.75 in deep, a 6 in wide head butting the front face of the axle beam (x 45.25) for 3 in, a 3 in taper to the 1.25 in stem
 * (x 51.25), the stem to the tip (x 55.75); the 1 in bronze sleeve is 1.5 in from the tip (x 54.25); two 3/8 in carriage bolts 2 in either side of the kingpin line at mid depth.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext, type Ctx } from './context';
import { runChecks, type AnalysisCheck } from './index';
import { bridleEye, tieLoad, tongueBarStress, tongueWidthAt, TONGUE_NUT_WASHER_OD_IN, OAK_TENSION_PAR_OF_BEND } from './bridle';
import { uncTensileArea } from './nds';

const RAD = Math.PI / 180;
const defaults = defaultParams();
const mkCtx = (q: Partial<Params> = {}): Ctx => {
  const p = resolveParams({ ...defaults, ...q } as Params);
  return makeContext(p, buildModel(p, { rider: 'goal', cargo: true }), buildModel(p, { rider: 'none', cargo: false, seat: 'stowed' }));
};
const ctx = mkCtx();
const cs = runChecks(defaults, { includeTruck: false });
const c = cs.find((x) => x.id === 'bridle-eye') as AnalysisCheck;
const det = (frag: string) => c.details!.find((d) => d.name.includes(frag))!;

const XB = 45.25, XH = 54.25;
const ALPHA = Math.atan((40 - 4.22) / 96);
const T = 300, Th = T * Math.cos(ALPHA), Tv = T * Math.sin(ALPHA);
const D = 1.75; // tongue depth (on edge); the stem is 1.25 in thick (D-60)
/** Width of the tongue by hand: 6 in to x = 48.25, linear to 1.25 in at x = 51.25, then 1.25 in. */
const w = (x: number) => (x <= 48.25 ? 6 : x >= 51.25 ? 1.25 : 6 - (4.75 * (x - 48.25)) / 3);
const al = ctx.p.oakMorPsi; // keeps the import used for the allowable check below
void al;

describe('tie load', () => {
  it('300 lbf at 20.45 degrees: 281.0 lbf horizontal, 105.0 lbf vertical, and the lateral / axial parts at the 20 degree lock', () => {
    const ld = tieLoad(ctx);
    expect(ld.T).toBe(300);
    expect(ld.handsZ).toBe(40); // the larger of the 30 in hands and the 40 in upper bound
    expect(ld.alpha).toBeCloseTo(ALPHA, 12);
    expect(ALPHA / RAD).toBeCloseTo(20.45, 1);
    expect(ld.Th).toBeCloseTo(Th, 9);
    expect(ld.Tv).toBeCloseTo(Tv, 9);
    expect(Th).toBeCloseTo(281.2, 0);
    expect(Tv).toBeCloseTo(104.6, 0);
    expect(ld.latLock).toBeCloseTo(Th * Math.sin(20 * RAD), 9);
    expect(ld.axialLock).toBeCloseTo(Th * Math.cos(20 * RAD), 9);
  });
  it('the tongue width follows the plan outline: 6 in on the head, 3.625 in halfway down the taper, 1.25 in on the stem (D-60)', () => {
    for (const [x, ww] of [[45.25, 6], [48.25, 6], [49.75, 3.625], [51.25, 1.25], [54, 1.25], [55.75, 1.25]] as const) expect(tongueWidthAt(ctx, x), String(x)).toBeCloseTo(ww, 9);
    for (const x of [46, 49, 50.5, 53]) expect(tongueWidthAt(ctx, x)).toBeCloseTo(w(x), 9);
  });
});

describe('bridle-eye row (rope, sleeve and oak hole, tongue stem, carriage bolts, snatch)', () => {
  it('the rope is the documented weak link (D-62): 3/8 in nylon rated 3,700 lbf, 60% at the bowline = 2,220 lbf, working load limit 10% = 370 lbf against the 150 lbf design pull', () => {
    expect(det('rope: design pull').value).toBe(150);
    expect(det('rope: design pull').limit).toBeCloseTo(370, 6);
    expect(det('rope: design pull').util).toBeCloseTo(150 / 370, 6);
    expect(c.how).toMatch(/working load limit 370 lbf/);
    expect(c.how).toMatch(/2220 lbf at the knot/);
    expect(c.how).not.toMatch(/shackle pin .* in double shear/);
    expect(c.details!.some((d) => /shackle/i.test(d.name))).toBe(false); // there is no shackle any more
  });
  it('SNATCH (slack then taut): F = v sqrt(k m) at 4 mph and 25 lb/in; for the goal rider and cargo it is about 330 lbf, a stiff low-stretch rope (100 lb/in) would be twice that; oak may dent but nothing breaks', () => {
    const m = ctx.loads.goal.massLb / 386.09;
    const F = 4 * 17.6 * Math.sqrt(25 * m);
    expect(c.how).toContain(`= ${F.toFixed(1)} lbf (`);
    const stem = c.details!.find((d) => d.name.includes('SNATCH: tongue stem'))!;
    expect(stem.limit).toBeCloseTo(6460 * ctx.p.woodSafetyFactor, 6); // MOR x C_M: the design stress times the wood safety factor
    for (const d of c.details!.filter((q) => /^SNATCH/.test(q.name))) expect(d.util, d.name).toBeLessThan(0.5);
    expect(c.how).toMatch(/oak may DENT/i);
    // the stiffer the rope the harder the snatch: polyester at 100 lb/in doubles it (sqrt of 4)
    const stiff = runChecks({ ...defaults, bridleSnatchStiffLbIn: 100 }, { includeTruck: false }).find((x) => x.id === 'bridle-eye')!;
    const sn = (q: AnalysisCheck) => q.details!.find((d) => d.name.includes('SNATCH: tongue stem'))!.value;
    expect(sn(stiff) / sn(c)).toBeCloseTo(2, 1);
    // a rope too weak at the knot fails the snatch row
    const weak = runChecks({ ...defaults, bridleRopeBreakLbf: 600 }, { includeTruck: false }).find((x) => x.id === 'bridle-eye')!;
    expect(weak.details!.find((d) => d.name.includes('SNATCH: the rope'))!.util).toBeGreaterThan(0.8);
  });
  it('bridle hole in the oak: the 1 in sleeve bears T / (1 x 1.25) = 240 psi along the grain (dowel allow 1,700); shear-out on 2 planes with 1.5 - 1/2 = 1 in of oak ahead of the hole: 300 / (2 x 1 x 1.25) = 120 psi (allow 850); net section (1.75 - 1) x 1.25 in: 320 psi against half the bending design stress', () => {
    expect(det('sleeve bearing').value).toBeCloseTo(T / (1 * 1.25), 6);
    expect(det('sleeve bearing').limit).toBeCloseTo(1700, 6);
    expect(det('bridle hole: edge shear-out').value).toBeCloseTo(T / (2 * 1.0 * 1.25), 6);
    expect(det('bridle hole: edge shear-out').limit).toBeCloseTo(850, 6);
    expect(det('bridle hole: net-section').value).toBeCloseTo(T / ((D - 1) * 1.25), 6);
    expect(det('bridle hole: net-section').limit).toBeCloseTo(6460 * OAK_TENSION_PAR_OF_BEND, 6);
  });
  it('tongue stem straight ahead: the vertical pull bends it about the STRONG axis (S = w d2/6) from the beam face: sigma(x) = Tv (54.25 - x) / (w(x) d2/6) + Th / (w(x) d), worst at the end of the taper (x = 51.25)', () => {
    let worst = 0, xw = 0;
    for (let x = XB; x <= XH; x += 0.005) {
      const s = (Tv * (XH - x)) / ((w(x) * D * D) / 6) + Th / (w(x) * D);
      if (s > worst) { worst = s; xw = x; }
    }
    expect(xw).toBeGreaterThan(51);
    expect(xw).toBeLessThan(52);
    expect(det('straight ahead').value / worst).toBeCloseTo(1, 2);
    expect(det('straight ahead').value).toBeCloseTo(620, -1); // 405 psi with the 1-1/2 x 2 in tongue
    expect(det('straight ahead').limit).toBeCloseTo(6460, 6);
    expect(tongueBarStress(ctx, Tv, Th, 0).x).toBeGreaterThan(51);
  });
  it('the old steel plate lay flat and bent about its thin axis (3.7 times over): on edge the same pull bends the oak at about 6% of its design stress', () => {
    expect(det('straight ahead').util).toBeLessThan(0.1);
    expect(det('full lock').util).toBeLessThan(0.2);
  });
  it('at full lock the pull is 20 degrees off the stem: axial Th cos20, and the lateral Th sin20 bends it about the WEAK axis (S = d w2/6)', () => {
    const lat = Th * Math.sin(20 * RAD), ax = Th * Math.cos(20 * RAD);
    let worst = 0;
    for (let x = XB; x <= XH; x += 0.005) {
      const s = (Tv * (XH - x)) / ((w(x) * D * D) / 6) + (lat * (XH - x)) / ((D * w(x) ** 2) / 6) + ax / (w(x) * D);
      worst = Math.max(worst, s);
    }
    expect(det('full lock').value / worst).toBeCloseTo(1, 2);
    expect(det('full lock').value).toBeGreaterThan(det('straight ahead').value); // the lateral part only adds
  });
  it('carriage bolts (2 x 3/8 in 316, 2 in either side of the kingpin line, mid depth): tension = (Th + Tv x 9 in / (D/2 = 0.875 in)) / 2 each (the nose-up pry about the head\'s bottom edge), shear = the yaw couple Th sin20 x 9 in / (2 x 2 in)', () => {
    const lat = Th * Math.sin(20 * RAD);
    const arm = XH - XB; // 9 in from the beam face to the bridle hole
    const Tb = (Th + (Tv * arm) / (D / 2)) / 2; // D-60: the pry lever is half the depth (the bolts are at mid depth): 0.875 in, was 1 in
    expect(det('carriage bolts: tension').value).toBeCloseTo(Tb / uncTensileArea(0.375), 3);
    expect(det('carriage bolts: tension').limit).toBe(32500);
    const F = (lat * arm) / (2 * 2);
    expect(det('carriage bolts: shear').value).toBeCloseTo(F / ((Math.PI * 0.375 ** 2) / 4), 3);
    expect(det('carriage bolts: shear').limit).toBe(19500);
    const washA = (Math.PI / 4) * (TONGUE_NUT_WASHER_OD_IN ** 2 - (0.375 + 1 / 16) ** 2);
    expect(det('nut washer').value).toBeCloseTo(Tb / washA, 3);
    expect(det('nut washer').limit).toBeCloseTo(358.45, 2);
  });
  it('D-58, D-60, D-62: the row PASSES at the defaults (util 0.63 on the nut washers, the oak dents first); it was 3.7x over with the flat steel plate; no cargo case (the pull is the same)', () => {
    expect(c.id).toBe('bridle-eye');
    expect(c.group).toBe('Structure');
    expect(c.status).toBe('pass');
    expect(c.util!).toBeCloseTo(0.633, 2);
    expect(c.cases!.goal!.util).toBeCloseTo(c.cases!.operating!.util, 2); // the pull does not depend on the rider; the snatch only a little
    expect(c.cases!.cargo).toBeUndefined();
    expect(c.refs).toContain('D-58');
    expect(c.refs).toContain('D-62');
    expect(c.how).toMatch(/Order of failure/);
    expect(c.how).toMatch(/ROPE is the documented weak link/);
    // the oak under the nut washers dents first (a crush, not a break, at 3x the design pull); nothing that BREAKS (the bolts, the stem, the sleeve and shear-out) comes near it
    const washer = det('nut washer');
    for (const d of c.details!.filter((q) => !/nut washer/.test(q.name))) expect(d.util, d.name).toBeLessThan(washer.util);
    expect(washer.util).toBeLessThan(0.7);
  });
  it('a shallower tongue still passes until about an inch deep; a 3/8 in bolt on a 1 in lever is the thing that grows with the pry; the util scales with the pull', () => {
    const u = (q: Partial<Params>) => runChecks({ ...defaults, ...q }, { includeTruck: false }).find((x) => x.id === 'bridle-eye')!;
    expect(u({ tongueDepthIn: 1.75 }).status).not.toBe('fail');
    expect(u({ pullForceLbf: 100 }).util!).toBeLessThan(c.util!);
    expect(u({ bridleTieHandHeightMaxIn: 30 }).util!).toBeLessThanOrEqual(c.util!); // hands at 30 in: a flatter rope, a smaller vertical part
  });
  it('the dual-check wrapper', () => {
    expect(bridleEye(ctx).refs).toContain('D-56');
  });
});
