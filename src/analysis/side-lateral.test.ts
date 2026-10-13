/**
 * D-76: the side-lateral row (the study's beam-on-strips screening model, rebuilt) and the solver behind it, worked by hand where it can be.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext } from './context';
import { runChecks } from './index';
import { FEEL_LIMIT_IN, KNEE_ROT, kneeScrewLoads, sideLateral, sideModel, sideResponse, sideSolver, type SideModel } from './side-lateral';

const ctxFor = (patch: Partial<Params> = {}) => {
  const p = { ...defaultParams(), ...patch } as Params;
  return makeContext(p, buildModel(p, { rider: 'goal', cargo: true }), buildModel(p, { rider: 'none', cargo: false, seat: 'stowed' }));
};
const ctx = ctxFor();

describe('the model by hand', () => {
  const m = sideModel(ctx);
  it('gunwale band beam EI = E_oak x 1.5 (0.625³ - 0.21³) / 12 + E_ply x 1.5 x 0.21³ / 12 = 53,534 lb·in² (the study: 53,500)', () => {
    const want = (1.78e6 * 1.5 * (0.625 ** 3 - 0.21 ** 3)) / 12 + (1.1e6 * 1.5 * 0.21 ** 3) / 12;
    expect(m.EI).toBeCloseTo(want, 6);
    expect(m.EI).toBeCloseTo(53534, 0);
  });
  it('strip stiffness at the rear (13 in tall) is under 1 lbf/in per inch, at the bow tens (the study: 0.7 and 68)', () => {
    expect(Math.min(...m.k)).toBeGreaterThan(0.4);
    expect(Math.min(...m.k)).toBeLessThan(1);
    expect(Math.max(...m.k)).toBeGreaterThan(50);
  });
  it('the mid rib spring: H² / K_knee + (H - knee)³ / 3EI, about 4,400 lbf/in at the gunwale', () => {
    const r = m.ribs.find((q) => q.st.n === 2)!;
    expect(r.H).toBeCloseTo(r.st.h - 0.75, 9);
    expect(r.zBase).toBeCloseTo(2.5, 9);
    expect(1 / r.K).toBeGreaterThan((r.H * r.H) / KNEE_ROT);
    expect(r.K).toBeGreaterThan(4000);
    expect(r.K).toBeLessThan(4800);
    expect(r.S).toBeCloseTo((0.75 * (0.75 + 0.2075) ** 2) / 6, 9); // the rib and its filler alone, no web flange
  });
});

describe('the solver', () => {
  // A bare simply supported beam (no strips, no ribs): a point load at mid span deflects PL³ / 48EI.
  const bare = (): SideModel => {
    const n = 200, h = 0.5, EI = 1e5;
    return { x0: 0, n, h, xs: Array.from({ length: n + 1 }, (_, i) => i * h), EI, k: new Array(n + 1).fill(0), H: new Array(n + 1).fill(10), zc: 1, tS: 0.625, tW: 0.21, sigPerM: 1, ribs: [], Eoak: 1 };
  };
  it('pinned: PL³ / 48EI at mid span within 0.1 %; fixed: PL³ / 192EI', () => {
    const m = bare(), L = m.n * m.h, P = 10;
    const wp = sideResponse(sideSolver(m, 'pinned'), [[m.n / 2, P]]).w[m.n / 2];
    expect(wp / ((P * L ** 3) / (48 * m.EI))).toBeCloseTo(1, 3);
    const wf = sideResponse(sideSolver(m, 'fixed'), [[m.n / 2, P]]).w[m.n / 2];
    expect(wf / ((P * L ** 3) / (192 * m.EI))).toBeCloseTo(1, 2);
  });
  it('the moment under the load is PL/4 (pinned)', () => {
    const m = bare(), L = m.n * m.h, P = 10;
    const r = sideResponse(sideSolver(m, 'pinned'), [[m.n / 2, P]]);
    expect(r.sigBand / ((P * L) / 4)).toBeCloseTo(1, 2); // sigPerM = 1
  });
});

describe('the side-lateral row (D-76)', () => {
  const s = sideLateral(ctx);
  const row = runChecks(ctx.p, { includeTruck: false }).find((c) => c.id === 'side-lateral')!;
  it('a 50 lbf push moves the gunwale about 0.1 in at worst with the ribs (under the 1/8 in "feels solid" mark), 0.26 to 0.39 in without them', () => {
    expect(s.push.wPinned).toBeLessThan(FEEL_LIMIT_IN);
    expect(s.push.wPinned).toBeGreaterThan(0.06); // this model counts no torsion: more conservative than the study's 0.061
    expect(s.push.wFixed).toBeLessThanOrEqual(s.push.wPinned + 1e-9);
    expect(s.push.noRibsPinned).toBeGreaterThan(0.3);
    expect(s.push.noRibsFixed).toBeGreaterThan(0.2);
    expect(s.push.noRibsPinned / s.push.wPinned).toBeGreaterThan(3);
  });
  it('passes; the knee toe screws or the rating rib bending govern, about 0.78', () => {
    expect(row.status).toBe('pass');
    expect(row.util!).toBeGreaterThan(0.7);
    expect(row.util!).toBeLessThan(0.85);
    expect(row.details!.every((d) => d.util < 0.8)).toBe(true);
    expect(row.statusCargo).toBe('pass');
    expect(row.utilCargo!).toBeLessThan(0.4); // 79 lbf straps at every D-ring
  });
  it('the knee screws by hand: NDS 1380 G² D = 88.06 lbf/in for a #6, x 1.28 in past the tip lead x C_M 0.7 = 78.8 lbf per screw', () => {
    const k = kneeScrewLoads(ctx);
    expect(k.bite).toBeCloseTo(2.5 - (0.5 + 0.472), 6);
    expect(k.perIn).toBeCloseTo(1380 * 0.68 ** 2 * 0.138, 6);
    expect(k.cap).toBeCloseTo(88.06 * (k.bite - 0.25) * 0.7, 1);
    expect(s.push.kneePull).toBeCloseTo(s.push.kneeMoment * k.pullPerMoment, 9);
  });
  it('the D-ring rating pulls the box rib hardest: it cantilevers from the top of its spacer', () => {
    expect(s.rating.ribSigMaxN).toBe(1);
    expect(s.rating.ribSigMax).toBeLessThan(6460);
    expect(s.rating.Hin).toBeCloseTo(300 * Math.SQRT1_2, 6);
  });
  it('without the bow post a rating pull at the bow is carried by the side alone (the study: the deck line goes to 1.35); the row reads the stations the D-rings are on', () => {
    const two = sideLateral(ctxFor({ lashPointsPerSide: 2 }));
    expect(two.rating.station).not.toBe(3);
  });
  it('a weaker web across its grain (the 4 mm okoume) still passes: the ribs carry the load', () => {
    const ok = runChecks({ ...defaultParams(), thinSheetMaterial: 2 } as Params, { includeTruck: false }).find((c) => c.id === 'side-lateral')!;
    expect(ok.status).toBe('pass');
  });
});
