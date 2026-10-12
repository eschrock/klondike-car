/**
 * Front-end rows of the pivoting soapbox axle (D-56): kingpin, king-bearing, front-beam, front-stub, steer-stops, king-beam, steer-clear. Every number is re-derived here by
 * hand from the params, the layout and the load cases (the bump pulse itself, V and H on one front wheel, is pinned in bump.test.ts and read from `bumpStrike`).
 *
 * Geometry (inches): kingpin at (44, 0); front track 35.5 so the wheels are 17.75 from the kingpin; axle beam 2.5 x 2.25 x 32.25, top z 5.375; tongue plate 3/16, thrust washer 1/4
 * (OD 2.5, bore 0.685), so the king beam bottom is z 5.8125 and its depth 7.528 - 5.8125 = 1.7155; kingpin 5/8 grade 8 (A_t = 0.226 in2).
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext, type Ctx } from './context';
import { runChecks, type AnalysisCheck } from './index';
import { washerContact, frontLoad, stopContact, polyGap } from './front';
import { tieLoad } from './bridle';
import { bumpStrike } from './bump';
import { wheelLoads } from './structure';
import { feAtAngle, feParallel, fePerp, lateralZ, uncTensileArea } from './nds';

const RAD = Math.PI / 180;
const defaults = defaultParams();
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
const R = 1.25, r = (0.625 + 0.06) / 2; // thrust washer OD 2.5, bore 0.685
const A_W = Math.PI * (R * R - r * r);
const I_W = (Math.PI / 4) * (R ** 4 - r ** 4);
const KING_BOT = 5.375 + 0.1875 + 0.25; // beam top + tongue + washer
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
  it('static front axle by hand: level W x/44 = 142 lb, nose down on 15 deg W cos(th) - N_r = 169 lb (M4: the worse governs); the heavier wheel takes 0.5 + |y|/35.5', () => {
    const w = wheelLoads(ctx, g);
    expect(hw.level).toBeCloseTo(142.5, 0);
    expect(hw.slope).toBeCloseTo(169.5, 0);
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

describe('kingpin (grade 8)', () => {
  const c = byId('kingpin');
  const Z = (Math.PI * 0.625 ** 3) / 32, As = (Math.PI * 0.625 ** 2) / 4;
  const kingMid = KING_BOT + KING_D / 2;
  const vm = (S: number, arm: number, T: number) => {
    const sig = T / AT_KING + (S * arm) / Z, tau = S / As;
    return Math.sqrt(sig * sig + 3 * tau * tau);
  };
  it('NORMAL 1" bump while towing: shear = 150 lbf design pull + the fore-aft bump force H, bending over (king beam middle - axle line 5.0), roll-couple tension from the washer; von Mises vs 130,000 / 2', () => {
    const f = forces(normal);
    expect(f.M / f.N).toBeGreaterThan(2); // far outside the washer's core: the bolt holds the unloaded side down
    const T = rigid(f.N, f.M).T;
    const hand1 = vm(150 + normal.H, kingMid - 5, T);
    const d = det('kingpin', 'NORMAL 1" bump');
    expect(rel(d.value, hand1)).toBeLessThan(2e-3);
    expect(d.limit).toBe(65000);
    expect(d.value).toBeCloseTo(38628, -3);
  });
  it('HARD 2" hit: the same with the 5 mph pulse, grade 8 ultimate 150,000 / 1.25 = 120,000 psi', () => {
    const f = forces(hard);
    const hand1 = vm(150 + hard.H, kingMid - 5, rigid(f.N, f.M).T);
    const d = det('kingpin', 'HARD 2" hit');
    expect(rel(d.value, hand1)).toBeLessThan(2e-3);
    expect(d.limit).toBe(120000);
  });
  it('TOW: 300 lbf at the tie, 19.5 deg up (hands 40 in, tie 5.91 in, 96 in run): 283 lbf horizontal through the pin, 100 lbf up tilting the axle with moment Tv x 15 in on the washer under the axle load', () => {
    const ld = tieLoad(ctx);
    expect(ld.alpha / RAD).toBeCloseTo(Math.atan((40 - 5.9125) / 96) / RAD, 9);
    expect(ld.T).toBe(300);
    expect(ld.Th).toBeCloseTo(300 * Math.cos(Math.atan((40 - 5.9125) / 96)), 9);
    expect(ld.Tv).toBeCloseTo(300 * Math.sin(Math.atan((40 - 5.9125) / 96)), 9);
    const N = hw.axle + ld.Tv, M = ld.Tv * 15;
    const T = rigid(N, M).T;
    const hand1 = vm(ld.Th, kingMid - (5.375 + 0.1875 / 2), Math.max(0, T));
    expect(rel(det('kingpin', 'tow pull').value, hand1)).toBeLessThan(5e-3);
  });
  it('passes at the defaults for both riders and the cargo case (the bolt is far stronger than what it holds): util 0.59, hole bearing 272 psi', () => {
    expect(c.status).toBe('pass');
    expect(c.statusCargo).toBe('pass');
    expect(c.util!).toBeCloseTo(0.594, 1);
    expect(det('kingpin', 'NORMAL: bolt bearing').value).toBeCloseTo((150 + normal.H) / (0.625 * KING_D), 6);
    expect(det('kingpin', 'NORMAL: bolt bearing').limit).toBeCloseTo((4000 * 0.85) / 2, 6);
  });
  it('a 1/2 in kingpin has a smaller area and section: the util rises', () => {
    expect(c.util!).toBeLessThan(runChecks({ ...defaults, kingpinDiaIn: 0.5 }, { includeTruck: false }).find((x) => x.id === 'kingpin')!.util!);
  });
});

describe('king-bearing (UHMW washer, oak king beam, nut washer)', () => {
  const al = { perp: (1070 * 0.67) / 2 };
  it('static front axle on the 4.54 in2 annulus: 169.5 / 4.54 = 37 psi vs the 1000 psi allowable; the mean pressure with the 3 mph strike is 79 psi', () => {
    expect(det('king-bearing', 'static front axle').value).toBeCloseTo(hw.axle / A_W, 6);
    expect(det('king-bearing', 'static front axle').limit).toBe(1000);
    const f = forces(normal);
    expect(det('king-bearing', 'NORMAL 1" bump: mean pressure').value).toBeCloseTo(f.N / A_W, 6);
  });
  it('NORMAL one-wheel strike: roll moment (F1 - F2) x 17.75 on the 2.5 in washer: the edge pressure 2 M R / I = 4,400 psi against 1000 UHMW and 358 oak', () => {
    const f = forces(normal);
    const p = rigid(f.N, f.M).pEdge;
    expect(det('king-bearing', 'NORMAL 1" bump, one wheel').value / p).toBeCloseTo(1, 3);
    expect(det('king-bearing', 'NORMAL 1" bump, one wheel').limit).toBe(1000);
    const o = det('king-bearing', 'NORMAL: edge pressure on the oak');
    expect(o.value / p).toBeCloseTo(1, 3);
    expect(o.limit).toBeCloseTo(al.perp, 6);
    expect(o.limit).toBeCloseTo(358.45, 2);
    expect(o.util).toBeGreaterThan(10);
  });
  it('HARD hit: edge pressure vs 2 x 1000 on the UHMW and the oak without the wood safety factor (716.9 psi)', () => {
    const f = forces(hard);
    const p = rigid(f.N, f.M).pEdge;
    expect(det('king-bearing', 'HARD 2" hit, one wheel').value / p).toBeCloseTo(1, 3);
    expect(det('king-bearing', 'HARD 2" hit, one wheel').limit).toBe(2000);
    expect(det('king-bearing', 'HARD: edge pressure on the oak').limit).toBeCloseTo(2 * al.perp, 6);
  });
  it('the kingpin tension of the roll couple bears on the oak slot ceiling through a 2.2 d = 1.375 in flat washer: T / (pi/4 (1.375^2 - 0.6875^2))', () => {
    const f = forces(normal);
    const T = rigid(f.N, f.M).T;
    const nutA = (Math.PI / 4) * (1.375 ** 2 - (0.625 + 1 / 16) ** 2);
    expect(det('king-bearing', 'NORMAL: nut washer').value / (T / nutA)).toBeCloseTo(1, 2);
  });
  it('FINDING: the row FAILS at the defaults for every rider weight and the cargo case (oak under the washer 12x, cargo 20x); a 3.5 in washer still fails (7x)', () => {
    const c = byId('king-bearing');
    expect(c.status).toBe('fail');
    expect(c.statusOperating).toBe('fail');
    expect(c.util!).toBeGreaterThan(10);
    expect(c.utilCargo!).toBeGreaterThan(15);
    const big = runChecks({ ...defaults, kingThrustOdIn: 3.5 }, { includeTruck: false }).find((x) => x.id === 'king-bearing')!;
    expect(big.status).toBe('fail');
    expect(big.util!).toBeLessThan(c.util!);
    expect(big.util!).toBeGreaterThan(5);
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

describe('steer-stops (oak blocks under the end joist)', () => {
  const sc = stopContact(ctx);
  const half = 1.25, lock = 20 * RAD;
  it('the blocks end at the contact point of the beam face at full lock: |y| = stopY1 cos(lock) - 1.25 sin(lock) = 8.177 in, stopY1 = (faceX - 44 - 1.25 cos(lock)) / sin(lock) = 9.157', () => {
    const stopY1 = (ctx.L.stops.faceX - 44 - half * Math.cos(lock)) / Math.sin(lock);
    expect(stopY1).toBeCloseTo(9.1566, 3);
    expect(ctx.L.stops.y2).toBeCloseTo(stopY1 * Math.cos(lock) - half * Math.sin(lock), 9);
    expect(ctx.L.stops.y2).toBeCloseTo(8.1768, 3);
    expect(sc.y).toBeCloseTo(8.1768, 3);
    expect(sc.angle / RAD).toBeCloseTo(20, 4); // the beam meets the block at exactly the lock
    expect(ctx.L.stops.faceX).toBeCloseTo(48.3063, 3);
  });
  it('stop force = torque / lever: H x 17.75 / 8.177 (3 mph bump), mu P x 17.75 / 8.177 (a dragged wheel), 283 lbf x sin(20) x 15 in / 8.177 (the pullers yank the tongue at lock)', () => {
    const y = ctx.L.stops.y2;
    const ld = tieLoad(ctx);
    const Fn = (normal.H * YW) / y, Ff = (0.5 * hw.wheel * YW) / y, Fy = (ld.Th * Math.sin(lock) * 15) / y;
    const hc = 5.375 - 4.375; // beam top reaches 1.0 in up into the block (block bottom 4.375)
    const d = det('steer-stops', 'NORMAL (worst of');
    expect(d.value).toBeCloseTo(Math.max(Fn, Ff, Fy) / (hc * 0.5), 3);
    expect(d.limit).toBeCloseTo(358.45, 2);
    const dh = det('steer-stops', 'HARD 2" hit: oak crush');
    expect(dh.value).toBeCloseTo(((hard.H * YW) / y) / (hc * 0.5), 3);
    expect(dh.limit).toBeCloseTo(716.9, 1);
  });
  it('two 5/16 in 316 bolts in shear: F / (2 x pi/4 0.3125^2) vs 0.6 x 65,000 / 2 = 19,500; NDS lateral capacity of the pair (wood on wood, 90 deg to the grain, IV mode)', () => {
    const y = ctx.L.stops.y2, Fh = (hard.H * YW) / y;
    const dh = det('steer-stops', 'HARD: 2 stop bolts');
    expect(dh.value).toBeCloseTo(Fh / (2 * Math.PI * 0.3125 ** 2 / 4), 3);
    expect(dh.limit).toBeCloseTo((0.6 * 90000) / 1.25, 6);
    expect(det('steer-stops', 'NORMAL: 2 stop bolts').limit).toBe(19500);
    const Fem = feAtAngle(feParallel(0.68), fePerp(0.68, 0.3125), 90);
    const Z = lateralZ({ D: 0.3125, lm: 5.778 - 4.375, ls: 1.75, Fem, Fes: Fem, Fyb: 65000, thetaDeg: 90 }).Z;
    const cap = 2 * Z * 0.7 * 1.6 * 0.85;
    expect(det('steer-stops', 'NORMAL: stop force vs the NDS').limit).toBeCloseTo(cap, 3);
    expect(cap).toBeGreaterThan(450);
    expect(cap).toBeLessThan(650);
  });
  it('end joist plan bending: M = F x (y2 - y1)/2 = F x 1.047 on 1.75 x 0.75 in (S = 1.75 x 0.75^2 / 6 = 0.164 in3)', () => {
    const y = ctx.L.stops.y2, Fh = (hard.H * YW) / y;
    const d = det('steer-stops', 'HARD: end joist');
    expect(d.value).toBeCloseTo((Fh * ((ctx.L.stops.y2 - ctx.L.stops.y1) / 2)) / ((1.75 * 0.75 ** 2) / 6), 3);
    expect(ctx.L.stops.y2 - ctx.L.stops.y1).toBeCloseTo(2.0934, 3);
  });
  it('FINDING: fails at the defaults (oak crush 1.7x normal, 2.5x hard; the hard-hit force exceeds the bolts\' NDS capacity); the shear of the 316 bolts is nowhere near its limit', () => {
    expect(byId('steer-stops').status).toBe('fail');
    expect(byId('steer-stops').cases!.operating!.status).toBe('fail');
    expect(det('steer-stops', 'NORMAL: 2 stop bolts').util).toBeLessThan(0.2);
    expect(det('steer-stops', 'HARD 2" hit: oak crush').util).toBeGreaterThan(2);
  });
});

describe('king-beam (the oak crossmember at the kingpin)', () => {
  const L = 22.5; // span between the rail faces
  const wA = 1.5 - 0.3125; // each half of the 3 in beam beside the 5/8 bolt hole
  const slotH = 1.2 * 0.625; // nut slot cut from the front face, 0.75 in tall
  // net section at the nut slot: rear part full depth, front part only below the slot
  const rects = [{ w: wA, h: KING_D }, { w: wA, h: KING_D - slotH }];
  const Anet = rects.reduce((s, q) => s + q.w * q.h, 0);
  const zbar = rects.reduce((s, q) => s + (q.w * q.h * q.h) / 2, 0) / Anet;
  const Inet = rects.reduce((s, q) => s + (q.w * q.h ** 3) / 12 + q.w * q.h * (q.h / 2 - zbar) ** 2, 0);
  const cNet = Math.max(zbar, KING_D - zbar);
  const Igross = (3 * KING_D ** 3) / 12;
  it('net section at the nut slot by hand: area ' + (2 * 1.1875 * KING_D - 1.1875 * 0.75).toFixed(3) + ' in2, neutral axis ' + '0.75 in up from the beam bottom (parallel-axis theorem), I computed from the two rectangles', () => {
    expect(KING_D).toBeCloseTo(1.7155, 4);
    expect(Anet).toBeCloseTo(2 * 1.1875 * KING_D - 1.1875 * 0.75, 9);
    expect(Inet).toBeLessThan(Igross);
  });
  it('static front axle load at midspan: M = N L / 4 = 169.5 x 22.5 / 4 on the net section (full contact: the washer reaction is the whole axle load at the center)', () => {
    const M = (hw.axle * L) / 4;
    const d = det('king-beam', 'static front axle');
    expect(d.value).toBeCloseTo(Math.max((M * cNet) / Inet, (M * (KING_D / 2)) / Igross), 3);
    expect(d.limit).toBeCloseTo((15200 * 0.85) / 2, 3); // 6,460 psi
  });
  it('one-wheel strike (washer on the kingpin neutral axis): reactions N/2 +- M/L, shear 1.5 V / (3 x 1.7155), the bending under the washer edge M_g = R_B (L/2 - y_C) with y_C = M / C', () => {
    const f = forces(normal);
    const h1 = rigid(f.N, f.M);
    const RB = f.N / 2 + f.M / L;
    expect(RB).toBeCloseTo((h1.C * h1.yC + f.N * (L / 2)) / L, 6); // the same thing from C, T, y_C
    const tau = (1.5 * RB) / (3 * KING_D);
    expect(det('king-beam', 'NORMAL 1" bump: shear').value).toBeCloseTo(tau, 3);
    const Mg = RB * (L / 2 - h1.yC);
    const Mnet = Math.abs((f.N * L) / 4 - f.M / 2);
    const sig = Math.max((Mnet * cNet) / Inet, (Mg * (KING_D / 2)) / Igross);
    expect(rel(det('king-beam', 'NORMAL 1" bump, one wheel').value, sig)).toBeLessThan(5e-3);
    // the end joint: V over the 3 x 1.7155 end face vs half the design shear 2000 x 0.85 / 2 / 2 = 425 psi
    expect(det('king-beam', 'NORMAL 1" bump: end glue').value).toBeCloseTo(RB / (3 * KING_D), 3);
    expect(det('king-beam', 'NORMAL 1" bump: end glue').limit).toBeCloseTo(425, 6);
  });
  it('passes at the defaults (util 0.36 goal, 0.58 cargo): the beam is stronger than the washer that loads it', () => {
    expect(byId('king-beam').status).toBe('pass');
    expect(byId('king-beam').statusCargo).toBe('pass');
    expect(byId('king-beam').cases!.goal!.util).toBeCloseTo(0.363, 1);
  });
});

describe('steer-clear (clearances at full lock)', () => {
  const c = byId('steer-clear');
  it('tire to the body side at full lock: (35.5/2 - 3.5/2) cos(20) - 5 sin(20) - 12 = 1.325 in (needs 0.75)', () => {
    const hand1 = (17.75 - 1.75) * Math.cos(20 * RAD) - 5 * Math.sin(20 * RAD) - 12;
    expect(hand1).toBeCloseTo(1.3250, 3);
    const d = c.details!.find((x) => x.name.includes('tire to the side'))!;
    expect(d.value).toBeCloseTo(hand1, 9);
    expect(d.limit).toBe(0.75);
  });
  it('vertical gaps: axle beam top 5.375 under the shallow rails (7.528 - 1.753 = 5.775): 0.4 in; clamp plate tops 5.75 under the king beam bottom 5.8125: 1/16 in; tongue top 5.5625 under the end joist 7.528 - 1.75 = 5.778: 0.2155 in', () => {
    expect(c.details!.find((x) => x.name.includes('shallow rails'))!.value).toBeCloseTo(0.4, 6);
    expect(c.details!.find((x) => x.name.includes('king beam underside'))!.value).toBeCloseTo(0.0625, 6);
    expect(c.details!.find((x) => x.name.includes('end joist underside'))!.value).toBeCloseTo(0.2155, 6);
  });
  it('plan gaps over the swing: the outer face of the inner right clamp plate (1.025 in ahead of the kingpin line) turns to normal (cos20, sin20) . p = 1.025; the corner of the stop block (4.306, -8.177) from the kingpin is at 1.25 along that normal: gap 0.225 in', () => {
    const P = [48.30634572891455 - 44, -8.176832150353723];
    const n = [Math.cos(20 * RAD), Math.sin(20 * RAD)];
    const gap = n[0] * P[0] + n[1] * P[1] - 1.025;
    expect(gap).toBeCloseTo(0.225, 3);
    expect(c.details!.find((x) => x.name.includes('clamp plates to the steering stop'))!.value).toBeCloseTo(gap, 2);
    expect(c.details!.find((x) => x.name.includes('tongue plate to the steering stop'))!.value).toBeGreaterThan(2);
  });
  it('polyGap: a unit square 2 in from another has gap 2; overlapping squares have gap 0', () => {
    const sq = (x: number): [number, number][] => [[x, 0], [x + 1, 0], [x + 1, 1], [x, 1]];
    expect(polyGap(sq(0), sq(3))).toBeCloseTo(2, 12);
    expect(polyGap(sq(0), sq(0.5))).toBe(0);
  });
  it('FINDING: the row FAILS at the defaults on the 1/16 in between the clamp plate tops and the king beam (the assumed 1/8 in running gap); the tire clearance and the stop gaps are fine; it is rider independent', () => {
    expect(c.status).toBe('fail');
    expect(c.value).toBeCloseTo(0.0625, 6);
    expect(c.limit).toBeCloseTo(0.125, 9);
    expect(c.cases).toBeUndefined();
    expect(c.group).toBe('Steering');
    // a 3/8 in thrust washer (king beam bottom 5.9375) gives the plates 3/16 in
    const hi = runChecks({ ...defaults, kingThrustThickIn: 0.375 }, { includeTruck: false }).find((x) => x.id === 'steer-clear')!;
    expect(hi.status).toBe('pass');
    expect(hi.value).toBeGreaterThan(0.125);
  });
});
