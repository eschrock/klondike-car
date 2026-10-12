/**
 * Bridle-tie row (D-56): shackle pin, tie hole, tongue bar and tongue bolts under the design pull x the overload factor. Everything is re-derived by hand:
 *   pull 150 lbf x 2 = 300 lbf, rope from the tie hole (x 59, z 5.9125) up to the hands (40 in, the upper bound) over a 96 in run: alpha = atan(34.0875 / 96) = 19.55 deg
 *   -> 282.7 lbf horizontal, 100.4 lbf vertical.
 * The tongue plate is 3/16 in A36, 4 in wide at the kingpin to x = 46, tapering to 2.5 in at x = 50, 2.5 in to the tip at x = 60; the tie hole is 3/4 in at x = 59.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext, type Ctx } from './context';
import { runChecks, type AnalysisCheck } from './index';
import { bridleEye, tieLoad, tongueBarStress, tongueWidthAt, TIE_HOLE_DIA_IN } from './bridle';
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

const ALPHA = Math.atan((40 - 5.9125) / 96);
const T = 300, Th = T * Math.cos(ALPHA), Tv = T * Math.sin(ALPHA);
/** Width of the tongue plate by hand: 4 in to x = 46, linear to 2.5 in at x = 50, then 2.5 in. */
const w = (x: number) => (x <= 46 ? 4 : x >= 50 ? 2.5 : 4 - (1.5 * (x - 46)) / 4);

describe('tie load', () => {
  it('300 lbf at 19.5 degrees: 282.7 lbf horizontal, 100.4 lbf vertical, and the lateral / axial parts at the 20 degree lock', () => {
    const ld = tieLoad(ctx);
    expect(ld.T).toBe(300);
    expect(ld.handsZ).toBe(40); // the larger of the 30 in hands and the 40 in upper bound
    expect(ld.alpha).toBeCloseTo(ALPHA, 12);
    expect(ALPHA / RAD).toBeCloseTo(19.55, 2);
    expect(ld.Th).toBeCloseTo(Th, 9);
    expect(ld.Tv).toBeCloseTo(Tv, 9);
    expect(Th).toBeCloseTo(282.7, 0);
    expect(Tv).toBeCloseTo(100.4, 0);
    expect(ld.latLock).toBeCloseTo(Th * Math.sin(20 * RAD), 9);
    expect(ld.axialLock).toBeCloseTo(Th * Math.cos(20 * RAD), 9);
  });
  it('the plate width follows the plan outline: 4 in on the head, 3.25 in halfway down the taper, 2.5 in on the bar', () => {
    for (const [x, ww] of [[44, 4], [46, 4], [48, 3.25], [50, 2.5], [55, 2.5], [59, 2.5]] as const) expect(tongueWidthAt(ctx, x)).toBeCloseTo(ww, 9);
  });
});

describe('bridle-eye row (shackle, tie hole, tongue bar, tongue bolts)', () => {
  it('shackle pin 1/2 in in double shear: 300 / (2 x pi/4 0.25) = 764 psi vs 0.577 x 36,000 / 2 = 10,386; bending over the 7/16 in jaw gap (plate 3/16 + 1/4): M = T g / 4 = 32.8 lb.in, Z = pi d3/32', () => {
    expect(det('double shear').value).toBeCloseTo(T / (2 * (Math.PI * 0.25) / 4), 6);
    expect(det('double shear').value).toBeCloseTo(764, 0);
    expect(det('double shear').limit).toBeCloseTo(0.577 * 18000, 6);
    expect(det('bending over the jaw gap').value).toBeCloseTo((T * 0.4375) / 4 / ((Math.PI * 0.125) / 32), 6);
    expect(det('bending over the jaw gap').limit).toBe(18000);
  });
  it('tie hole: bearing T / (d t) = 300 / (0.5 x 0.1875) = 3,200 psi (allow 1.8 Fy / 2 = 32,400); shear-out on 2 planes with 1 - 0.375 = 0.625 in of clear edge: 300 / (2 x 0.625 x 0.1875) = 1,280 psi (allow 0.6 Fu / 2 = 17,400); net section (2.5 - 0.75) x 0.1875', () => {
    expect(TIE_HOLE_DIA_IN).toBe(0.75);
    expect(det('bearing of the pin').value).toBeCloseTo(3200, 6);
    expect(det('bearing of the pin').limit).toBeCloseTo(32400, 6);
    expect(det('shear-out').value).toBeCloseTo(1280, 6);
    expect(det('shear-out').limit).toBeCloseTo(17400, 6);
    expect(det('net-section').value).toBeCloseTo(300 / ((2.5 - 0.75) * 0.1875), 6);
    expect(det('net-section').limit).toBe(18000);
  });
  it('tongue bar straight ahead: the vertical part bends the plate about its thin axis from the beam face (x 45.25): sigma(x) = Tv (59 - x) / (w t2/6) + Th / (w t), worst at the end of the taper (x = 50)', () => {
    let worst = 0, xw = 0;
    for (let x = 45.25; x <= 59; x += 0.005) {
      const s = (Tv * (59 - x)) / ((w(x) * 0.1875 ** 2) / 6) + Th / (w(x) * 0.1875);
      if (s > worst) { worst = s; xw = x; }
    }
    expect(xw).toBeCloseTo(50, 1);
    expect(det('straight ahead').value / worst).toBeCloseTo(1, 3);
    expect(det('straight ahead').value).toBeCloseTo(62263, -3);
    expect(det('straight ahead').limit).toBe(18000);
    expect(tongueBarStress(ctx, Tv, Th, 0).x).toBeCloseTo(50, 1);
  });
  it('at full lock the pull is 20 degrees off the bar: axial Th cos20, lateral Th sin20 adds the strong-axis bending t w2/6', () => {
    const lat = Th * Math.sin(20 * RAD), ax = Th * Math.cos(20 * RAD);
    let worst = 0;
    for (let x = 45.25; x <= 59; x += 0.005) {
      const s = (Tv * (59 - x)) / ((w(x) * 0.1875 ** 2) / 6) + (lat * (59 - x)) / ((0.1875 * w(x) ** 2) / 6) + ax / (w(x) * 0.1875);
      worst = Math.max(worst, s);
    }
    expect(det('full lock').value / worst).toBeCloseTo(1, 3);
    expect(det('full lock').value).toBeGreaterThan(det('straight ahead').value); // the lateral part only adds
  });
  it('tongue bolts (2 x 3/8 in 316, 1.5175 in either side of the kingpin): the lateral pull twists the tongue, couple = Th sin20 x 15 in / (2 x 1.5175) = 477 lbf each, plus a third of the axial part; the vertical pull tips the head about its front edge (x 46): Tv x 13 in / 2 in / 2 bolts', () => {
    const lat = Th * Math.sin(20 * RAD), ax = Th * Math.cos(20 * RAD);
    const F = Math.hypot((lat * 15) / (2 * 1.5175), ax / 3);
    expect(det('tongue bolts: shear').value).toBeCloseTo(F / ((Math.PI * 0.375 ** 2) / 4), 3);
    expect(det('tongue bolts: shear').limit).toBe(19500);
    const Tb = (Tv * 13) / 2 / 2;
    expect(det('tongue bolts: tension').value).toBeCloseTo(Tb / uncTensileArea(0.375), 3);
    expect(det('tongue bolts: tension').limit).toBe(32500);
    expect(det('tongue bolts: shear').util).toBeLessThan(0.3);
    expect(det('tongue bolts: tension').util).toBeLessThan(0.2);
  });
  it('FINDING: the row FAILS at the defaults (util 3.7) on the 3/16 flat bar bent about its thin axis by the vertical part of the pull; everything else (pin, hole, bolts) is under a quarter of its limit', () => {
    expect(c.id).toBe('bridle-eye');
    expect(c.group).toBe('Structure');
    expect(c.status).toBe('fail');
    expect(c.util!).toBeCloseTo(3.7, 1);
    expect(c.cases!.goal!.util).toBeCloseTo(c.cases!.operating!.util, 9); // the pull does not depend on the rider
    expect(c.cases!.cargo).toBeUndefined(); // no cargo case: the pull is the same
    const others = c.details!.filter((d) => !d.name.includes('tongue bar'));
    for (const d of others) expect(d.util, d.name).toBeLessThan(0.25);
    expect(c.how).toMatch(/shackle pin/);
    expect(c.how).toMatch(/Order of failure/);
  });
  it('a 3/8 in x 3 in tongue passes (util 0.90) but only with room for it; 1/4 x 2.5 and 5/16 x 3 still fail; the util scales with the pull', () => {
    const u = (q: Partial<Params>) => runChecks({ ...defaults, ...q }, { includeTruck: false }).find((x) => x.id === 'bridle-eye')!;
    expect(u({ tongueThickIn: 0.375, tongueWidthIn: 3 }).status).toBe('pass');
    expect(u({ tongueThickIn: 0.375, tongueWidthIn: 3 }).util!).toBeCloseTo(0.9, 1);
    expect(u({ tongueThickIn: 0.25 }).status).toBe('fail');
    expect(u({ tongueThickIn: 0.3125, tongueWidthIn: 3 }).status).toBe('fail');
    expect(u({ pullForceLbf: 100 }).util!).toBeLessThan(c.util!);
    expect(u({ bridleTieHandHeightMaxIn: 30 }).util!).toBeLessThan(c.util!); // hands at 30 in: a flatter rope, a smaller vertical part
  });
  it('the dual-check wrapper', () => {
    expect(bridleEye(ctx).refs).toContain('D-56');
  });
});
