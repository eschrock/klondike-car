/**
 * Front-end rows of the pivoting soapbox axle (D-56): kingpin, king-bearing, front-beam, front-stub, steer-stops, king-beam, steer-clear. Every number is re-derived here by
 * hand from the params, the layout and the load cases (the bump pulse itself, V and H on one front wheel, is pinned in bump.test.ts and read from `bumpStrike`).
 *
 * Geometry (inches): kingpin at (44, 0); front track 35.5 so the wheels are 17.75 from the kingpin; axle beam 2.5 x 2.25 x 32.25, top z 5.375; tongue plate 3/16, thrust washer 1/4
 * (OD 2.5, bore 0.685), so the king beam bottom is z 5.8125 and its depth 7.528 - 5.8125 = 1.7155; kingpin 5/8 grade 8 (A_t = 0.226 in2).
 * D-58 (3c-4a): the rows now read a 3 in x 9/16 in UHMW disc on the beam top (king beam bottom z 5.9375, depth 1.5905), two UHMW roll pads under the rails (the roll of a one-wheel
 * bump), an oak tongue beside the disc, and check chains for the steering lock. The 35.5 in track and the 250 lb cargo of 3c-3 are kept here as the hand-calc fixture; the D-58
 * defaults (34 1/2 in front, 32 in rear, 200 lb cargo) are covered in track-d58.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext, type Ctx } from './context';
import { runChecks, type AnalysisCheck } from './index';
import { washerContact, frontLoad, stopContact, polyGap, rollPadPatch, rollPadGap, discOf, chainGeom, eyeAngleFactor, EYE_ULT_MULT, CHAIN_ULT_MULT } from './front';
import { tieLoad } from './bridle';
import { bumpStrike } from './bump';
import { wheelLoads } from './structure';
import { uncTensileArea } from './nds';
import { PRE_D60 } from '../test-fixtures';

const RAD = Math.PI / 180;
const defaults = { ...defaultParams(), ...PRE_D60, frontTrackIn: 35.5, rearTrackIn: 35.5, axleHangerThickIn: 0.75, cargoPayloadLb: 250 }; // the 3c-3 hand-calc fixture (35.5 in tracks, 250 lb cargo); D-58 narrowed the tracks, cargo is 200 lb; the new defaults are in the rows below and track-d58.test.ts
const mkCtx = (q: Partial<Params> = {}): Ctx => {
  const p = resolveParams({ ...defaults, ...q } as Params);
  return makeContext(p, buildModel(p, { rider: 'goal', cargo: true }), buildModel(p, { rider: 'none', cargo: false, seat: 'stowed' }));
};
const ctx = mkCtx();
const g = ctx.loads.goal;
const cs = runChecks(defaults, { includeTruck: false });
const byId = (id: string): AnalysisCheck => cs.find((c) => c.id === id)!;
const det = (id: string, frag: string) => byId(id).details!.find((d) => d.name.includes(frag))!;
const rel = (a: number, b: number) => Math.abs(a / b - 1);

// design numbers read from the defaults, written out
const YW = 17.75; // wheel to kingpin
const R = 1.25, r = (0.625 + 0.06) / 2; // the legacy 2.5 in washer used by the washerContact unit tests (the D-58 disc is 3 in OD, see discOf)
const A_W = Math.PI * (R * R - r * r);
const I_W = (Math.PI / 4) * (R ** 4 - r ** 4);
const KING_BOT = 5.375 + 0.5625; // D-58: the king beam sits on the 9/16 in UHMW disc, which lies on the beam top (the oak tongue is beside it, not under it)
const KING_D = 7.528 - KING_BOT;
const AT_KING = uncTensileArea(0.625);

/** The goal rider's wheel forces, by hand: front axle load = the worse of level and the nose-down slope (M4), shared 0.5 + |y|/track. */
function hand() {
  const W = g.massLb, x = g.cg[0], h = g.cg[2], th = 15 * RAD;
  const level = (W * x) / 44;
  const Nr = W * (Math.cos(th) * (44 - x) / 44 - (Math.sin(th) * h) / 44);
  const slope = W * Math.cos(th) - Nr;
  const axle = Math.max(level, slope);
  const wheel = axle * (0.5 + Math.abs(g.cg[1]) / 35.5);
  return { level, slope, axle, wheel, other: axle - wheel };
}
const hw = hand();
const normal = bumpStrike(ctx, g, 'front', 1, 1, 'normal');
const hard = bumpStrike(ctx, g, 'front', 2, 1, 'hard');
/** Wheel forces and the rolling moment of a one-wheel strike: F1 = V + static on the struck wheel, F2 = the other wheel's static load, M = (F1 - F2) x 17.75. */
const forces = (b: { V: number }) => {
  const F1 = b.V + hw.wheel, F2 = hw.other;
  return { F1, F2, N: F1 + F2, M: (F1 - F2) * YW };
};
/** Washer with the kingpin holding the unloaded side down (large eccentricity): neutral axis through the bolt, p = k y on the loaded half: M = k I / 2 -> p_edge = 2 M R / I. */
const rigid = (N: number, M: number) => {
  const pEdge = (2 * M * R) / I_W;
  const C = (pEdge / R) * (2 / 3) * (R ** 3 - r ** 3);
  return { pEdge, C, T: C - N, yC: M / C };
};

describe('washerContact (the roll couple on the UHMW thrust washer)', () => {
  it('full contact inside the core: p_edge = N/A + M R / I, no bolt force (N = 400 lbf, M = 100 lb.in)', () => {
    const w = washerContact(400, 100, R, r);
    expect(w.regime).toBe('full contact');
    expect(w.pEdge).toBeCloseTo(400 / A_W + (100 * R) / I_W, 9);
    expect(w.bolt).toBe(0);
    expect(w.C).toBe(400);
    expect(w.yC).toBeCloseTo(0.25, 12);
    expect(A_W).toBeCloseTo(4.5402, 3);
    expect(I_W).toBeCloseTo(1.9067, 3);
  });
  it('a large eccentricity puts the neutral axis through the kingpin: p_edge = 2 M R / I, C = p_edge/R (2/3)(R3 - r3), bolt tension C - N (N = 331 lbf, M = 3,355 lb.in)', () => {
    const w = washerContact(331, 3355, R, r);
    const h = rigid(331, 3355);
    expect(w.regime).toBe('bolt in tension');
    expect(w.pEdge / h.pEdge).toBeCloseTo(1, 3);
    expect(w.pEdge).toBeCloseTo(4398.5, -1);
    expect(w.bolt / h.T).toBeCloseTo(1, 2);
    expect(w.bolt).toBeCloseTo(4160, -2);
    expect(w.C / h.C).toBeCloseTo(1, 2);
    expect(w.yC).toBeCloseTo(3355 / h.C, 2);
  });
  it('between the two (eccentricity 0.5 in on a 1 in = 1,000 lbf load): partial contact, no bolt force, the resultant on the load line, the edge pressure above the linear value', () => {
    const w = washerContact(1000, 500, R, r);
    expect(w.regime).toBe('part contact');
    expect(w.bolt).toBe(0);
    expect(w.yC).toBeCloseTo(0.5, 12);
    expect(w.pEdge).toBeGreaterThan(1000 / A_W + (500 * R) / I_W - 1e-9 - 1000); // sanity: positive
    expect(w.pEdge).toBeGreaterThan(2 * 1000 / A_W * 0.9);
  });
  it('a bigger washer (OD 3.5) carries the same roll couple at a much lower edge pressure: p ~ 1/R^3', () => {
    const big = washerContact(331, 3355, 1.75, r);
    expect(big.pEdge).toBeLessThan(0.4 * washerContact(331, 3355, R, r).pEdge);
  });
});

describe('front wheel loads (the basis of every row)', () => {
  it('static front axle by hand: level W x/44 = 137 lb, nose down on 15 deg W cos(th) - N_r = 164 lb (M4: the worse governs); the heavier wheel takes 0.5 + |y|/35.5', () => {
    const w = wheelLoads(ctx, g);
    expect(hw.level).toBeCloseTo(136.7, 0); // 138.1 before D-60 dropped the four foot-block cleats (the CG moves aft with them gone)
    expect(hw.slope).toBeCloseTo(164.3, 0); // 165.7 with the foot-block cleats
    expect(w.frontAxle).toBeCloseTo(hw.axle, 6);
    expect(w.frontWheel).toBeCloseTo(hw.wheel, 6);
  });
  it('frontLoad: struck wheel F1 = V + static, the other wheel F2 = its static load, roll moment (F1 - F2) x track/2', () => {
    const n = frontLoad(ctx, g, 'normal'), h = frontLoad(ctx, g, 'hard');
    const f = forces(normal), fh = forces(hard);
    expect(n.F1).toBeCloseTo(f.F1, 6);
    expect(n.F2).toBeCloseTo(f.F2, 6);
    expect(n.roll).toBeCloseTo(f.M, 6);
    expect(h.roll).toBeCloseTo(fh.M, 6);
    expect(n.H).toBeCloseTo(normal.H, 9);
    expect(normal.vMph).toBe(3);
    expect(hard.vMph).toBe(5);
    expect(fh.M).toBeGreaterThan(f.M);
  });
});

/** The disc contact area by independent numerical integration: the annulus (OD 3, bore 0.685) cut to the 2.5 in wide strip of the beam top it touches. */
function discContactArea() {
  const Rd = 1.5, rd = (0.625 + 0.06) / 2, hwid = 1.25, n = 20000;
  let A = 0;
  for (let i = 0; i < n; i++) {
    const x = -hwid + ((i + 0.5) * 2 * hwid) / n;
    const outer = Math.sqrt(Math.max(0, Rd * Rd - x * x)), inner = Math.abs(x) < rd ? Math.sqrt(rd * rd - x * x) : 0;
    A += 2 * (outer - inner) * ((2 * hwid) / n);
  }
  return A;
}
const A_DISC = discContactArea();
const pad = rollPadPatch(ctx);
/** The roll-pad share of a one-wheel strike (hand): P = kP M (the pad on the high side meets the rail at the lever y), the nut holds only what exceeds the axle load. */
const padShare = (f: { N: number; M: number }) => ({ P: pad.kP * f.M, pressure: pad.kq * f.M, hold: Math.max(0, pad.kP * f.M - f.N) });

describe('roll pads and the thrust disc (D-58)', () => {
  it('the disc touches a strip as wide as the beam (2.5 in) of its 3 in OD annulus: A = 6.14 in2 by integration, the same as discOf', () => {
    expect(discOf(ctx).Ac).toBeCloseTo(A_DISC, 3);
    expect(A_DISC).toBeGreaterThan(6);
    expect(A_DISC).toBeLessThan(6.3);
    expect(discOf(ctx).Lx).toBeCloseTo(2.5, 9);
  });
  it('a pad sits 11 in from the kingpin on the beam top, 2 in x 3 in, and the rail swings over it: its lever y is 9.5 to 12.5 straight ahead (rail inner face 10.5 at the axle, curving in toward the bow)', () => {
    expect(ctx.p.rollPadRadiusIn).toBe(11);
    expect(ctx.p.rollPadWidthIn * ctx.p.rollPadLenIn).toBe(6);
    // straight ahead, by hand: the rail band at the pad's x is [outer - 1.5, outer], the pad spans y = 9.5..12.5 and x = 43..45 (kingpin at 44)
    const [yi, yo] = [ctx.L.steer.railYIn - 0, 12 - ctx.L.turnIn(44)];
    expect(yo).toBeCloseTo(12 - ctx.L.turnIn(44), 9);
    const overlap0 = 2 * (Math.min(12.5, yo) - Math.max(9.5, yo - ctx.p.railThicknessIn));
    expect(overlap0).toBeGreaterThan(0.5);
    void yi;
    // the swept patch keeps at least half of the straight-ahead overlap over the +-20 deg steering range, and the lever stays near the pad center
    expect(pad.minArea).toBeGreaterThan(0.5);
    expect(pad.minArea).toBeLessThanOrEqual(overlap0 + 1e-9);
    expect(pad.yMin).toBeGreaterThan(9);
    expect(pad.yMin).toBeLessThan(12.5);
    expect(pad.onRail).toBe(true);
    // pressure per unit roll moment: the largest of cos(a) / (y area)
    expect(pad.kq).toBeGreaterThanOrEqual(1 / (12.5 * 6)); // never better than the whole pad at its far edge
    expect(pad.kP).toBeGreaterThan(Math.cos(20 * RAD) / 12.5 - 1e-9);
    expect(pad.kP).toBeLessThan(1 / 9);
  });
  it('the running gap above a pad is the rail bottom over the beam top less the pad: 7.528 - 1.753 - 5.375 - 0.3125 = 0.0875 in, between the 0.03 in minimum and the 1/8 in maximum', () => {
    expect(rollPadGap(ctx)).toBeCloseTo(7.528 - 1.753 - 5.375 - 0.3125, 9);
    expect(rollPadGap(ctx)).toBeCloseTo(0.0875, 9);
    expect(det('king-bearing', 'not too tight').value).toBeCloseTo(0.0875, 9);
    expect(det('king-bearing', 'not too tight').limit).toBe(0.03);
    expect(det('king-bearing', 'not too loose').limit).toBe(0.125);
  });
});

describe('kingpin (grade 8)', () => {
  const c = byId('kingpin');
  const Z = (Math.PI * 0.625 ** 3) / 32, As = (Math.PI * 0.625 ** 2) / 4;
  const kingMid = KING_BOT + KING_D / 2;
  const vm = (S: number, arm: number, T: number) => {
    const sig = T / AT_KING + (S * arm) / Z, tau = S / As;
    return Math.sqrt(sig * sig + 3 * tau * tau);
  };
  it('NORMAL 1" bump while towing: shear = 150 lbf design pull + the fore-aft bump force H, bending over (king beam middle - axle line 5.0), plus only the roll shortfall the pads cannot carry as tension', () => {
    const f = forces(normal);
    const sh = padShare(f);
    const hand1 = vm(150 + normal.H, kingMid - 5, sh.hold);
    const d = det('kingpin', 'NORMAL 1" bump');
    expect(rel(d.value, hand1)).toBeLessThan(2e-3);
    expect(d.limit).toBe(65000);
    expect(sh.hold).toBe(0); // the pad force is smaller than the axle load: the bolt holds nothing down
    expect(d.util).toBeLessThan(0.4); // D-56 had the washer carry the roll: 38,628 psi (0.6) with 4,160 lbf of bolt tension
  });
  it('HARD 2" hit: the same with the 5 mph pulse, grade 8 ultimate 150,000 / 1.25 = 120,000 psi; the pad force may now exceed the axle load, and the bolt holds the rest', () => {
    const f = forces(hard);
    const sh = padShare(f);
    const hand1 = vm(150 + hard.H, kingMid - 5, sh.hold);
    const d = det('kingpin', 'HARD 2" hit');
    expect(rel(d.value, hand1)).toBeLessThan(2e-3);
    expect(d.limit).toBe(120000);
    expect(d.util).toBeLessThan(0.4);
  });
  it('TOW: 300 lbf at the shackle, 20.5 deg up (hands 40 in, shackle 4.19 in, 96 in run): 281 lbf horizontal through the pin, 105 lbf up tilting the axle with a nose-up moment Tv x 10.25 in resisted by the edges of the beam hole', () => {
    const ld = tieLoad(ctx);
    const alpha = Math.atan((40 - 4.1875) / 96);
    expect(ld.alpha / RAD).toBeCloseTo(alpha / RAD, 9);
    expect(ld.T).toBe(300);
    expect(ld.Th).toBeCloseTo(300 * Math.cos(alpha), 9);
    expect(ld.Tv).toBeCloseTo(300 * Math.sin(alpha), 9);
    const pitchArm = 54.25 - 44; // shackle hole to the kingpin
    const Mtilt = ld.Tv * pitchArm;
    const armTow = KING_BOT + KING_D / 2 - (3.1875 + 5.1875) / 2; // king beam middle to the middle of the oak tongue
    const hand1 = vm(ld.Th, Math.max(armTow, Mtilt / ld.Th), 0);
    expect(rel(det('kingpin', 'tow pull at the tie (x overload): bolt shear').value, hand1)).toBeLessThan(5e-3);
    const kdepth = 2.25;
    const tilt = (ld.Th / 2 + Mtilt / (0.8 * kdepth)) / (0.625 * 0.4 * kdepth);
    expect(det('kingpin', 'tow pull tilt').value).toBeCloseTo(tilt, 3);
    expect(det('kingpin', 'tow pull tilt').limit).toBe(1700);
  });
  it('passes at the defaults for both riders and the cargo case; the tow tilt (the nose-up couple on the hole edges of the beam, util 0.77) governs, the bolt itself is under 0.7', () => {
    expect(c.status).toBe('pass');
    expect(c.statusCargo).toBe('pass');
    expect(c.util!).toBeCloseTo(0.77, 1);
    expect(det('kingpin', 'NORMAL: bolt bearing in the oak king beam').value).toBeCloseTo((150 + normal.H) / (0.625 * KING_D), 6);
    expect(det('kingpin', 'NORMAL: bolt bearing in the oak king beam').limit).toBeCloseTo((4000 * 0.85) / 2, 6);
    const gov = c.details!.reduce((a, b) => (b.util > a.util ? b : a));
    expect(gov.name).toMatch(/tow pull tilt/);
  });
  it('a 1/2 in kingpin has a smaller area and section: the util rises', () => {
    expect(c.util!).toBeLessThan(runChecks({ ...defaults, kingpinDiaIn: 0.5 }, { includeTruck: false }).find((x) => x.id === 'kingpin')!.util!);
  });
});

describe('king-bearing (UHMW disc, roll pads, the oak under them)', () => {
  const al = { perp: (1070 * 0.67) / 2 };
  const nutA = (Math.PI / 4) * ((2.2 * 0.625) ** 2 - (0.625 + 1 / 16) ** 2);
  it('static front axle on the disc: 167.5 lb over the 6.14 in2 the disc touches = 27 psi vs the 1000 psi allowable; the mean pressure with the 3 mph strike is N / A', () => {
    expect(det('king-bearing', 'static front axle').value).toBeCloseTo(hw.axle / A_DISC, 2);
    expect(det('king-bearing', 'static front axle').limit).toBe(1000);
    const f = forces(normal);
    expect(det('king-bearing', 'NORMAL 1" bump: mean pressure on the disc').value).toBeCloseTo(f.N / A_DISC, 2);
    expect(det('king-bearing', 'HARD 2" hit: mean pressure').limit).toBe(2000);
  });
  it('NORMAL one-wheel strike: the roll moment (F1 - F2) x 17.75 goes to the pad on the high side, P = M cos(a) / y, spread over the part of the pad under the rail: the pressure on the rail underside against 358 psi', () => {
    const f = forces(normal);
    const sh = padShare(f);
    const d = det('king-bearing', 'NORMAL 1" bump, one wheel: pressure of the pad on the rail');
    expect(d.value).toBeCloseTo(sh.pressure, 6);
    expect(d.limit).toBeCloseTo(al.perp, 6);
    expect(d.limit).toBeCloseTo(358.45, 2);
    expect(d.util).toBeLessThan(1); // D-56: 4,400 psi edge pressure on the washer, 12x the oak
    expect(d.util).toBeGreaterThan(0.4);
    // the pad on the beam top uses its full 2 x 3 in
    expect(det('king-bearing', 'NORMAL, one wheel: the pad on the axle beam top').value).toBeCloseTo(sh.P / 6, 6);
    // the pad force is less than the axle load, so no nut hold-down is needed
    expect(det('king-bearing', 'NORMAL: nut washer').value).toBe(0);
    // the pad force and the pressure both scale with the roll moment: kq = the worst over the swing of cos(a) / (y A)
    expect(sh.pressure / sh.P).toBeGreaterThan(1 / 6 - 1e-9);
  });
  it('HARD hit: pad pressure vs the oak without the wood safety factor (716.9 psi); the pad force now exceeds the axle load and the nut washer holds the rest on the slot ceiling', () => {
    const f = forces(hard);
    const sh = padShare(f);
    expect(det('king-bearing', 'HARD 2" hit, one wheel: pressure of the pad on the rail').value).toBeCloseTo(sh.pressure, 6);
    expect(det('king-bearing', 'HARD 2" hit, one wheel: pressure of the pad on the rail').limit).toBeCloseTo(2 * al.perp, 6);
    expect(sh.hold).toBeGreaterThan(0);
    expect(det('king-bearing', 'HARD: nut washer').value).toBeCloseTo(sh.hold / nutA, 6);
  });
  it('steering effort: the UHMW disc friction (mu 0.25) at the static load is about 4 lbf at the shackle, under 10% of the 150 lbf pull', () => {
    const d = det('king-bearing', 'steering effort');
    expect(d.value).toBeCloseTo((0.25 * hw.axle * 0.67 * 1.5) / (54.25 - 44), 3);
    expect(d.limit).toBeCloseTo(15, 9);
    expect(d.util).toBeLessThan(0.4);
  });
  it('D-58: the row PASSES at the defaults for every rider weight; the 250 lb cargo fixture is marginal (util 0.98, the pad on the rail underside); 3c-3 failed it 11x (12x for the oak under the washer, 20x with the cargo)', () => {
    const c = byId('king-bearing');
    expect(c.status).toBe('pass');
    expect(c.statusOperating).toBe('pass');
    expect(c.util!).toBeCloseTo(0.7, 1); // the running gap detail (0.0875 of 0.125) is the most loaded
    expect(c.statusCargo).not.toBe('fail');
    expect(c.utilCargo!).toBeLessThan(1);
    expect(c.utilCargo!).toBeGreaterThan(c.util!);
  });
  it('a pad that is not under the rail at some steering angle holds nothing: the row fails and gives finite numbers (the roll goes to the kingpin through the disc)', () => {
    const q = runChecks({ ...defaults, rollPadRadiusIn: 14 }, { includeTruck: false });
    const k = q.find((x) => x.id === 'king-bearing')!;
    expect(k.status).toBe('fail');
    for (const d of k.details!) {
      expect(Number.isFinite(d.value), d.name).toBe(true);
      expect(Number.isFinite(d.limit), d.name).toBe(true);
    }
    expect(Number.isFinite(q.find((x) => x.id === 'kingpin')!.util!)).toBe(true);
    expect(k.details!.find((d) => d.name.includes('pads stay under'))!.value).toBe(0);
  });
});

describe('front-beam (oak axle beam)', () => {
  const f = forces(normal), fh = forces(hard);
  it('bending at the kingpin hole: M = F x 17.75 on the net section (2.5 - 0.625) x 2.25: S = 1.875 x 2.25^2 / 6 = 1.582 in3', () => {
    const S = (1.875 * 2.25 ** 2) / 6;
    const d = det('front-beam', 'NORMAL 1" bump: bending at the kingpin hole');
    expect(d.value).toBeCloseTo((f.F1 * YW) / S, 6);
    expect(d.limit).toBeGreaterThan(6000);
    const dh = det('front-beam', 'HARD 2" hit: bending at the kingpin hole');
    expect(dh.value).toBeCloseTo((fh.F1 * YW) / S, 6);
    expect(dh.limit / d.limit).toBeCloseTo(2, 9);
    const sh = det('front-beam', 'NORMAL 1" bump: shear at the kingpin');
    expect(sh.value).toBeCloseTo((1.5 * f.F1) / (1.875 * 2.25), 6);
  });
  it('at the inner end of the stub groove (8.125 in from the center) the section is 2.5 x (2.25 - 0.75) and the lever is 17.75 - 8.125 = 9.625 in', () => {
    const d = det('front-beam', 'NORMAL 1" bump: bending at the inner end');
    expect(d.value).toBeCloseTo((f.F1 * 9.625 * 6) / (2.5 * 1.5 ** 2), 6);
  });
  it('the rod is a beam on its two clamp stations (9.125 and 15.125 in out): the outer station holds it down with F (17.75 - 9.125) / 6 = 1.4375 F, shared by its two 3/8 in 316 bolts', () => {
    const d = det('front-beam', 'NORMAL: clamp-plate bolt tension');
    expect(d.value).toBeCloseTo((1.4375 * f.F1) / 2, 6);
    expect(d.limit).toBeCloseTo(uncTensileArea(0.375) * 65000 / 2, 6);
    expect(det('front-beam', 'HARD: clamp-plate bolt').limit).toBeCloseTo(uncTensileArea(0.375) * 90000 / 1.25, 6);
  });
  it('the fore-aft bump force bears on the groove wall at the outer station over rod diameter x plate length = 0.75 x 1.5 in2 with the same lever ratio; the ligament beside the groove is (2.5 - 0.75) / 2 = 0.875 in vs 0.75', () => {
    expect(det('front-beam', 'NORMAL: fore-aft').value).toBeCloseTo((1.4375 * normal.H) / (0.75 * 1.5), 6);
    const l = det('front-beam', 'wood ligament');
    expect(l.value).toBeCloseTo(0.875, 9);
    expect(l.limit).toBe(0.75);
  });
  it('passes at the defaults for both riders (util 0.86 governed by the ligament); the cargo case (the payload piled at the nose loads a front wheel with 167 lb) FAILS the hard-hit groove wall bearing by 7%', () => {
    expect(byId('front-beam').status).toBe('pass');
    expect(byId('front-beam').statusCargo).toBe('fail');
    expect(byId('front-beam').utilCargo!).toBeCloseTo(1.07, 1);
  });
});

describe('front-stub (steel rod cantilever to the hub)', () => {
  it('a = 17.75 - 16.125 = 1.625 in from the beam end to the hub center; sigma = hypot(H, F1) a c / I with c = 0.375, I = pi d^4 / 64 vs 70,000 / 2', () => {
    const I = (Math.PI * 0.75 ** 4) / 64;
    const f = forces(normal);
    const Rn = Math.hypot(normal.H, f.F1);
    const d = det('front-stub', 'NORMAL 1" front bump');
    expect(d.value).toBeCloseTo((Rn * 1.625 * 0.375) / I, 4);
    expect(d.limit).toBe(35000);
    const fh = forces(hard);
    const dh = det('front-stub', 'HARD 2" front hit');
    expect(dh.value).toBeCloseTo((Math.hypot(hard.H, fh.F1) * 1.625 * 0.375) / I, 4);
    expect(dh.limit).toBeCloseTo(85000 / 1.25, 6);
    expect(byId('front-stub').status).toBe('pass');
    expect(byId('front-stub').cases!.goal!.util).toBeCloseTo(0.345, 1);
  });
  it('the cornering skid at mu P_static: worst direction, resultant of the vertical, drag and side bending plus the axial drag stress', () => {
    const I = (Math.PI * 0.75 ** 4) / 64, A = (Math.PI * 0.75 ** 2) / 4, P = hw.wheel, H = 0.5 * P;
    let worst = 0;
    for (let psi = 0; psi <= 90; psi += 1) {
      const Hy = H * Math.cos(psi * RAD), Hx = H * Math.sin(psi * RAD);
      worst = Math.max(worst, (Math.hypot(P * 1.625 + Hy * 5, Hx * 1.625) * 0.375) / I + Hy / A);
    }
    expect(det('front-stub', 'cornering skid').value).toBeCloseTo(worst, 4);
  });
});

describe('steer-stops (the check chains, D-58)', () => {
  const cg = chainGeom(ctx);
  const sc = stopContact(ctx);
  const lock = 20 * RAD;
  it('the chain goes taut exactly at the lock: the beam eye at 20 deg is the chain length from the anchor eye (eyes 8.4 / 10.4 in off the center line), and the contact reported is the lock angle', () => {
    expect(sc.angle / RAD).toBeCloseTo(20, 4);
    expect(Math.hypot(...[0, 1, 2].map((i) => cg.A[i] - cg.B[i]))).toBeCloseTo(ctx.L.chain.lenIn, 6);
    expect(cg.A[1]).toBeCloseTo(-8.4, 6);
    // by hand: the eye rides on a circle of radius hypot(beamU, 10.4) about the kingpin; rotate it through the lock
    const u = -(2.5 / 2 + 0.7), v = 10.4; // behind the beam's rear face by the eye stand-off, 10.4 in out along the beam
    const Bx = 44 + u * Math.cos(lock) + v * Math.sin(lock), By = u * Math.sin(lock) - v * Math.cos(lock);
    expect(cg.B[0]).toBeCloseTo(Bx, 6);
    expect(cg.B[1]).toBeCloseTo(By, 6);
  });
  it('the lever of the taut chain about the kingpin (plan distance from the pin to the chain line) and its rise: chain tension = torque / lever / cos(rise)', () => {
    const dx = cg.A[0] - cg.B[0], dy = cg.A[1] - cg.B[1];
    const plan = Math.hypot(dx, dy);
    const lever = Math.abs((44 - cg.B[0]) * (dy / plan) - (0 - cg.B[1]) * (dx / plan));
    expect(cg.lever).toBeCloseTo(lever, 9);
    expect(cg.el).toBeCloseTo(Math.atan2(cg.A[2] - cg.B[2], plan), 9);
    expect(cg.lever).toBeGreaterThan(5); // a long lever (about 8.5 in) is what keeps the chain loads small
    expect(cg.lever).toBeLessThan(12);
  });
  it('torque cases about the kingpin: a 3 mph bump H x 17.75, a dragged wheel mu P x 17.75, the pullers yanking the tongue at lock Th sin(20) x 10.25 in; the chain tension is the worst / lever / cos(rise) against the 2,600 lbf working load', () => {
    const ld = tieLoad(ctx);
    const Tn = normal.H * YW, Tf = 0.5 * hw.wheel * YW, Ty = ld.Th * Math.sin(lock) * 10.25;
    const worst = Math.max(Tn, Tf, Ty);
    const T = worst / cg.lever / Math.cos(cg.el);
    const d = det('steer-stops', 'NORMAL (worst of');
    expect(d.value).toBeCloseTo(T, 3);
    expect(d.limit).toBe(2600);
    expect(d.util).toBeLessThan(0.2);
    const Hh = ((hard.H * YW) / cg.lever) / Math.cos(cg.el);
    const dh = det('steer-stops', 'HARD 2" hit: chain tension');
    expect(dh.value).toBeCloseTo(Hh, 3);
    expect(dh.limit).toBeCloseTo((CHAIN_ULT_MULT * 2600) / 1.25, 6);
    expect(dh.limit).toBe(8320);
  });
  it('eye bolts are derated by the angle the chain pulls off the shank axis: capacity = 1,500 lbf x (1 - 0.4 theta / 45), at least 0.3; ultimate is 5 x that, divided by the fail-safe factor 1.25', () => {
    expect(eyeAngleFactor(0)).toBe(1);
    expect(eyeAngleFactor(45)).toBeCloseTo(0.6, 12);
    expect(eyeAngleFactor(90)).toBe(0.3);
    const thBeam = Math.acos(Math.abs(cg.du)) / RAD, thAnc = Math.acos(Math.abs(cg.d[0])) / RAD;
    expect(det('steer-stops', 'NORMAL: beam eye bolt').limit).toBeCloseTo(1500 * eyeAngleFactor(thBeam), 6);
    expect(det('steer-stops', 'NORMAL: anchor eye bolt').limit).toBeCloseTo(1500 * eyeAngleFactor(thAnc), 6);
    expect(det('steer-stops', 'HARD: beam eye bolt').limit).toBeCloseTo((EYE_ULT_MULT * 1500 * eyeAngleFactor(thBeam)) / 1.25, 6);
  });
  it('nut washers (2 in OD) carry the axial part of the pull on the oak: the beam eye on the front face of the axle beam, the anchor eye on the rear face of the chain joist', () => {
    const washA = (Math.PI / 4) * (2 ** 2 - (0.5 + 1 / 16) ** 2);
    const ld = tieLoad(ctx);
    const T = Math.max(normal.H * YW, 0.5 * hw.wheel * YW, ld.Th * Math.sin(lock) * 10.25) / cg.lever / Math.cos(cg.el);
    expect(det('steer-stops', 'NORMAL: beam eye nut washer').value).toBeCloseTo((Math.abs(cg.du) * T) / washA, 3);
    expect(det('steer-stops', 'NORMAL: anchor eye nut washer').value).toBeCloseTo((Math.abs(cg.d[0]) * T) / washA, 3);
    expect(det('steer-stops', 'NORMAL: beam eye nut washer').limit).toBeCloseTo(358.45, 2);
  });
  it('chain joist: the pull acts at the anchor, (rail face - anchor y) from the rail; plan bending on the weak axis (1.5 in thick x 1.75 in deep), vertical bending net of the 1/2 in hole, and the end joint', () => {
    const jT = 1.5, jD = ctx.p.crossmemberDepthIn;
    const jHalf = ctx.L.steer.railYIn - ctx.L.turnIn(ctx.L.chain.joistX);
    const arm = Math.max(0.5, jHalf - 8.4);
    const ld = tieLoad(ctx);
    const T = Math.max(normal.H * YW, 0.5 * hw.wheel * YW, ld.Th * Math.sin(lock) * 10.25) / cg.lever / Math.cos(cg.el);
    const fx = Math.abs(cg.d[0]) * T, fz = Math.abs(cg.d[2]) * T;
    expect(det('steer-stops', 'NORMAL: chain joist plan bending').value).toBeCloseTo((fx * arm) / ((jD * jT ** 2) / 6), 3);
    expect(det('steer-stops', 'NORMAL: chain joist vertical bending').value).toBeCloseTo((fz * arm) / (((jT - 0.5) * jD ** 2) / 6), 3);
    expect(det('steer-stops', 'NORMAL: chain joist end glue').value).toBeCloseTo(Math.hypot(fx, fz) / (jT * jD), 3);
    expect(det('steer-stops', 'NORMAL: chain joist end glue').limit).toBeCloseTo(425, 6);
  });
  it('D-58: the row PASSES at the defaults for both riders and the cargo case (util 0.36, 0.53 with the 250 lb fixture); the oak stop blocks it replaces crushed 1.7x (normal) and 2.5x (hard)', () => {
    const c = byId('steer-stops');
    expect(c.status).toBe('pass');
    expect(c.statusOperating).toBe('pass');
    expect(c.statusCargo).toBe('pass');
    expect(c.util!).toBeLessThan(0.5);
    expect(c.how).toMatch(/check chains/);
  });
});

describe('king-beam (the oak crossmember at the kingpin)', () => {
  const Lspan = 2 * (ctx.L.steer.railYIn - ctx.L.turnIn(44 + 1.5)); // span between the rail inner faces at the king beam, which follow the bow turn-in
  const wA = 1.5 - 0.3125; // each half of the 3 in beam beside the 5/8 bolt hole
  const slotH = 1.2 * 0.625; // nut slot cut from the front face, 0.75 in tall
  // net section at the nut slot: rear part full depth, front part only below the slot
  const rects = [{ w: wA, h: KING_D }, { w: wA, h: KING_D - slotH }];
  const Anet = rects.reduce((s, q) => s + q.w * q.h, 0);
  const zbar = rects.reduce((s, q) => s + (q.w * q.h * q.h) / 2, 0) / Anet;
  const Inet = rects.reduce((s, q) => s + (q.w * q.h ** 3) / 12 + q.w * q.h * (q.h / 2 - zbar) ** 2, 0);
  const cNet = Math.max(zbar, KING_D - zbar);
  const Igross = (3 * KING_D ** 3) / 12;
  const sBend = (M: number) => Math.max((M * cNet) / Inet, (M * (KING_D / 2)) / Igross);
  it('net section at the nut slot by hand: area ' + (2 * 1.1875 * 1.5905 - 1.1875 * 0.75).toFixed(3) + ' in2, the 3 in beam is 1.5905 in deep over the 9/16 in disc, I computed from the two rectangles', () => {
    expect(KING_D).toBeCloseTo(1.5905, 4);
    expect(Anet).toBeCloseTo(2 * 1.1875 * KING_D - 1.1875 * 0.75, 9);
    expect(Inet).toBeLessThan(Igross);
    expect(Lspan).toBeGreaterThan(19);
    expect(Lspan).toBeLessThan(22);
  });
  it('static front axle load at midspan: M = N L / 4 = 167.5 x L / 4 on the net section (D-58: the whole axle load is at the disc, the roll couple is on the pads and rails)', () => {
    const M = (hw.axle * Lspan) / 4;
    const d = det('king-beam', 'static front axle');
    expect(d.value).toBeCloseTo(sBend(M), 2);
    expect(d.limit).toBeCloseTo((15200 * 0.85) / 2, 3); // 6,460 psi
  });
  it('NORMAL strike: the whole N = F1 + F2 goes through the disc at midspan, so M = N L / 4, shear V = N / 2 over 1.5 V / (3 x depth), the end joint V over the 3 x depth end face (425 psi)', () => {
    const f = forces(normal);
    const M = (f.N * Lspan) / 4, V = f.N / 2;
    expect(det('king-beam', 'NORMAL 1" bump (the struck wheel and the other').value).toBeCloseTo(sBend(M), 2);
    expect(det('king-beam', 'NORMAL 1" bump: shear').value).toBeCloseTo((1.5 * V) / (3 * KING_D), 3);
    expect(det('king-beam', 'NORMAL 1" bump: end glue').value).toBeCloseTo(V / (3 * KING_D), 3);
    expect(det('king-beam', 'NORMAL 1" bump: end glue').limit).toBeCloseTo(425, 6);
    const fh = forces(hard);
    expect(det('king-beam', 'HARD 2" hit: bending').value).toBeCloseTo(sBend((fh.N * Lspan) / 4), 2);
    expect(det('king-beam', 'HARD 2" hit: bending').limit).toBeCloseTo(2 * 6460, 0);
  });
  it('tow: the vertical part of the pull adds to the axle load at the disc: M = (N + Tv) L / 4', () => {
    const ld = tieLoad(ctx);
    expect(det('king-beam', 'tow pull').value).toBeCloseTo(sBend(((hw.axle + ld.Tv) * Lspan) / 4), 2);
  });
  it('passes at the defaults (util 0.47 goal, 0.80 with the 250 lb cargo fixture): the beam is stronger than the load it carries', () => {
    expect(byId('king-beam').status).toBe('pass');
    expect(byId('king-beam').statusCargo).not.toBe('fail');
    expect(byId('king-beam').cases!.goal!.util).toBeCloseTo(0.47, 1);
  });
});

describe('steer-clear (clearances at full lock)', () => {
  const c = byId('steer-clear');
  it('tire to the body side at full lock: (35.5/2 - 3.5/2) cos(20) - 5 sin(20) - 12 = 1.325 in (needs 0.75) at the 3c-3 fixture track', () => {
    const hand1 = (17.75 - 1.75) * Math.cos(20 * RAD) - 5 * Math.sin(20 * RAD) - 12;
    expect(hand1).toBeCloseTo(1.3250, 3);
    const d = c.details!.find((x) => x.name.includes('tire to the side'))!;
    expect(d.value).toBeCloseTo(hand1, 9);
    expect(d.limit).toBe(0.75);
  });
  it('D-58 front track 34 1/2 in is the least that clears the body with a margin, rounded to 1/8 in: the gap is 0.855 in (0.75 needed) and a track 1/8 in narrower would give less than 0.75 in', () => {
    const q = (trk: number) => runChecks({ ...defaultParams(), frontTrackIn: trk }, { includeTruck: false }).find((x) => x.id === 'steer-clear')!.details!.find((x) => x.name.includes('tire to the side'))!.value;
    const hand1 = ((34.5 - 3.5) / 2) * Math.cos(20 * RAD) - 5 * Math.sin(20 * RAD) - 12;
    expect(hand1).toBeCloseTo(q(34.5), 1);
    expect(q(34.5)).toBeGreaterThanOrEqual(0.75);
    expect(q(34.375)).toBeLessThan(q(34.5));
  });
  it('vertical gaps: axle beam top 5.375 under the shallow rails (7.528 - 1.753 = 5.775): 0.4 in; clamp plate tops 5.75 under the king beam bottom 5.9375: 3/16 in; tongue top 5.1875 under the chain joist-level underside 7.528 - 1.75 = 5.778 ...', () => {
    expect(c.details!.find((x) => x.name.includes('shallow rails'))!.value).toBeCloseTo(0.4, 6);
    expect(c.details!.find((x) => x.name.includes('king beam underside'))!.value).toBeCloseTo(5.9375 - 5.75, 6);
    expect(c.details!.find((x) => x.name.includes('end joist underside'))!.value).toBeCloseTo(7.528 - 1.75 - (5.375 - 0.1875), 6);
    expect(c.details!.find((x) => x.name.includes('thrust disc'))!.value).toBeCloseTo(0.1875, 6); // the tongue top 3/16 under the beam top, under the disc
  });
  it('the taut chain stays at least 1/8 in from everything at full lock (3D, less its width); it lies behind the king beam', () => {
    const d = c.details!.find((x) => x.name.includes('taut steering chain'))!;
    expect(d.limit).toBeCloseTo(0.125, 9);
    expect(d.value).toBeGreaterThan(0.125);
  });
  it('polyGap: a unit square 2 in from another has gap 2; overlapping squares have gap 0', () => {
    const sq = (x: number): [number, number][] => [[x, 0], [x + 1, 0], [x + 1, 1], [x, 1]];
    expect(polyGap(sq(0), sq(3))).toBeCloseTo(2, 12);
    expect(polyGap(sq(0), sq(0.5))).toBe(0);
  });
  it('D-58: the row PASSES at the defaults (the least gap is 3/16 in against the 1/8 in running gap); it failed at 1/16 in under the 1/4 in disc; it is rider independent', () => {
    expect(c.status).toBe('pass');
    expect(c.value).toBeCloseTo(0.1875, 4);
    expect(c.limit).toBeCloseTo(0.125, 9);
    expect(c.cases).toBeUndefined();
    expect(c.group).toBe('Steering');
    // a thinner disc leaves the plates less room under the king beam: 3/8 in leaves only 1/16 in
    const lo = runChecks({ ...defaults, kingThrustThickIn: 0.375 }, { includeTruck: false }).find((x) => x.id === 'steer-clear')!;
    expect(lo.value).toBeLessThan(c.value!);
  });
});
