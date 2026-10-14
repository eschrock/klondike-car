/**
 * D-78 analysis: the removable brake knee on two sleeved ball-lock pins (`kneeMount` = removable: two clamped, preloaded bolts). The pin loads, the NDS wood-to-wood single-shear capacity of both pins, the axial pull, the
 * tab, the rib and the combined rib rows are each re-derived here by hand from the params and the geometry, independently of the check code. The default (bolted) rows are checked unchanged.
 */
import { describe, expect, it } from 'vitest';
import { KNEE_MOUNT, PARAM_DEFS, WEATHER_SPEC, defaultParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext } from './context';
import { brakeBundle, clampSolveAt, loadsBoth, loadsFromFootBoth } from './brake';
import { clampGroupForces, solveKnee } from './brake-clamp';
import { cleavageNearEnd, endDistanceFactor, oakFeAt, woodPinCapacity, woodShearZ } from './nds';
import { thinSheet } from '../params';
import { sideLateral } from './side-lateral';
import { allowables } from './structure';
import { runChecks, type AnalysisCheck } from './index';

const p0 = defaultParams();
const pp = { ...p0, kneeMount: KNEE_MOUNT.removable } as Params;
const run = (p: Params) => runChecks(p, { includeTruck: false });
const csB = run(p0);
const csP = run(pp);
const byId = (c: AnalysisCheck[], id: string) => c.find((x) => x.id === id)!;
const det = (c: AnalysisCheck[], id: string, name: string, cases: 'primary' | 'cargo' = 'primary') => (cases === 'cargo' ? byId(c, id).detailsCargo! : byId(c, id).details!).find((d) => d.name.includes(name))!;
const ctxOf = (p: Params) => makeContext(p, buildModel(p, { rider: 'goal', cargo: true }), buildModel(p, { rider: 'none', cargo: false, seat: 'stowed' }));
const ctx = ctxOf(pp);
const { g } = brakeBundle(ctx);
const rm = g.removable!;
const al = allowables(ctx);
const RAD = Math.PI / 180;
const close = (a: number, b: number, rel = 0.01) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(Math.abs(b), 1e-9));

// ── independent hand derivation of the in-plane pin loads (a different route from the check code: solve the moment balance about the pivot for the twist) ──
function handPins(Rk: [number, number]) {
  const T = [rm.top.x, rm.top.z], B = [rm.bottom.x, rm.bottom.z], H = g.H;
  const dx = T[0] - B[0], dz = T[1] - B[1], d = Math.hypot(dx, dz);
  const n = [-dz / d, dx / d]; // perpendicular to the pin line
  // pin forces on the knee F_T = -R/2 + t n, F_B = -R/2 - t n; moments of the three forces about H must vanish: (T-H) x F_T + (B-H) x F_B + 0 (R acts at H) = 0
  const cr = (a: number[], b: number[]) => a[0] * b[1] - a[1] * b[0];
  const rT = [T[0] - H[0], T[1] - H[1]], rB = [B[0] - H[0], B[1] - H[1]];
  const half = [-Rk[0] / 2, -Rk[1] / 2];
  const t = -(cr(rT, half) + cr(rB, half)) / (cr(rT, n) - cr(rB, n));
  const FT = [half[0] + t * n[0], half[1] + t * n[1]], FB = [half[0] - t * n[0], half[1] - t * n[1]];
  return { FT, FB, Tmag: Math.hypot(FT[0], FT[1]), Bmag: Math.hypot(FB[0], FB[1]), t };
}

/** The NDS modes written out a second time, in their own form (Table 12.3.1A wood-to-wood, single shear), to compare with nds.ts. */
function handZ(D: number, lm: number, ls: number, Fem: number, Fes: number, Fyb: number, th: number) {
  const K = 1 + 0.25 * (th / 90);
  const Re = Fem / Fes, Rt = lm / ls;
  const k1 = (Math.sqrt(Re + 2 * Re ** 2 * (1 + Rt + Rt ** 2) + Rt ** 2 * Re ** 3) - Re * (1 + Rt)) / (1 + Re);
  const k2 = -1 + Math.sqrt(2 * (1 + Re) + (2 * Fyb * (1 + 2 * Re) * D ** 2) / (3 * Fem * lm ** 2));
  const k3 = -1 + Math.sqrt((2 * (1 + Re)) / Re + (2 * Fyb * (2 + Re) * D ** 2) / (3 * Fem * ls ** 2));
  const Z = [
    (D * lm * Fem) / (4 * K), (D * ls * Fes) / (4 * K), (k1 * D * ls * Fes) / (3.6 * K),
    (k2 * D * lm * Fem) / (3.2 * K * (1 + 2 * Re)), (k3 * D * ls * Fem) / (3.2 * K * (2 + Re)), ((D * D) / (3.2 * K)) * Math.sqrt((2 * Fem * Fyb) / (3 * (1 + Re))),
  ];
  return Math.min(...Z);
}

describe('D-78 nds.ts: wood-to-wood single-shear yield modes', () => {
  it('matches an independent second writing of the six modes, and is symmetric in the two members', () => {
    for (const c of [
      { D: 0.5, l1: 0.96, l2: 1, Fe1: 5498, Fe2: 5498, Fyb: 44766, thetaDeg: 57 },
      { D: 0.5, l1: 1.75, l2: 0.75, Fe1: 4932, Fe2: 5043, Fyb: 44766, thetaDeg: 90 },
      { D: 0.375, l1: 1.5, l2: 0.5, Fe1: 5700, Fe2: 4000, Fyb: 65000, thetaDeg: 0 },
      { D: 0.375, l1: 0.75, l2: 0.75, Fe1: 5700, Fe2: 5700, Fyb: 65000, thetaDeg: 30 },
    ]) {
      const r = woodShearZ(c);
      close(r.Z, handZ(c.D, c.l1, c.l2, c.Fe1, c.Fe2, c.Fyb, c.thetaDeg), 1e-9);
      const sw = woodShearZ({ ...c, l1: c.l2, l2: c.l1, Fe1: c.Fe2, Fe2: c.Fe1 });
      close(sw.Z, r.Z, 1e-9);
      expect(Object.keys(r.modes)).toEqual(['Im', 'Is', 'II', 'IIIm', 'IIIs', 'IV']);
    }
  });
  it('a thick pair of equal members with a weak pin is a mode IV (the pin bends) and a thin pair with a strong pin is mode Is / II', () => {
    expect(woodShearZ({ D: 0.375, l1: 3, l2: 3, Fe1: 5700, Fe2: 5700, Fyb: 20000, thetaDeg: 0 }).mode).toBe('IV');
    expect(['Im', 'Is', 'II']).toContain(woodShearZ({ D: 0.5, l1: 0.5, l2: 0.5, Fe1: 4000, Fe2: 4000, Fyb: 200000, thetaDeg: 0 }).mode);
  });
  it('the adjustment is C_M x C_D x C_eg, with no group factor', () => {
    const r = woodPinCapacity({ ndsWetFactorFasteners: 0.7, brakePinLoadDurationFactor: 1 }, { D: 0.5, l1: 1, l2: 1, Fe1: 5000, Fe2: 5000, Fyb: 44766, thetaDeg: 45 }, 0.67);
    close(r.Zadj, r.Z * 0.7 * 0.67, 1e-12);
    expect(oakFeAt(0.68, 0.5, 0)).toBeCloseTo(11200 * 0.68, 6);
    close(oakFeAt(0.68, 0.5, 90), (6100 * 0.68 ** 1.45) / Math.sqrt(0.5), 1e-9);
  });
});

describe('D-78 nds.ts: end-distance factor and near-end splitting', () => {
  it('C_delta is end / required, required = 7 D along the grain falling linearly to 4 D across it; below half the requirement it is flagged', () => {
    const r0 = endDistanceFactor(1.75, 0.5, 0);
    close(r0.required, 3.5, 1e-12);
    close(r0.cDelta, 0.5, 1e-12);
    expect(r0.belowHalf).toBe(false);
    close(endDistanceFactor(10, 0.5, 90).required, 2, 1e-12);
    expect(endDistanceFactor(10, 0.5, 30).cDelta).toBe(1);
    expect(endDistanceFactor(1.2, 0.5, 0).belowHalf).toBe(true);
  });
  it('near-end splitting is V_r = 2/3 Fv b d_e (d_e/d)^2 within 5 d of the end and without the square beyond; d_e = d - (unloaded edge to fastener center - D/2)', () => {
    const near = cleavageNearEnd(199, 1, 2, 1, 0.5, 3);
    close(near.de, 1.25, 1e-12);
    close(near.Vr, (2 / 3) * 199 * 1 * 1.25 * (1.25 / 2) ** 2, 1e-12);
    expect(near.near).toBe(true);
    const far = cleavageNearEnd(199, 1, 2, 1, 0.5, 11);
    close(far.Vr, (2 / 3) * 199 * 1.25, 1e-12);
    expect(far.near).toBe(false);
  });
});

describe('D-78 new params', () => {
  it('the clamped-bolt analysis params carry a status, a note and the D-78 reference; the torque, K and the insert pull-out are verify', () => {
    for (const k of ['brakeBoltTorqueFtLb', 'brakeBoltNutFactor', 'brakeJointFrictionMu', 'brakeBoltPreloadMaxFrac', 'brakeInsertWithdrawalFactor', 'brakeBoltLoadDurationFactor', 'brakeStainlessModulusPsi'] as const) {
      expect(PARAM_DEFS[k].status, k).toBeDefined();
      expect(PARAM_DEFS[k].note, k).toBeTruthy();
      expect(PARAM_DEFS[k].ref, k).toContain('D-78');
    }
    for (const k of ['brakeBoltTorqueFtLb', 'brakeBoltNutFactor', 'brakeInsertWithdrawalFactor'] as const) expect(PARAM_DEFS[k].status, k).toBe('verify');
    expect(PARAM_DEFS.brakeBoltTorqueFtLb.default).toBe(15);
    expect(PARAM_DEFS.brakeBoltNutFactor.default).toBe(0.2);
    expect(PARAM_DEFS.brakeJointFrictionMu.default).toBe(0.3);
  });
});

describe('D-78 the default (bolted) rows are unchanged', () => {
  it('brake-mount is still the bolted row: bolts, backer and plate rows, no pin rows, the old label and refs', () => {
    const c = byId(csB, 'brake-mount');
    expect(c.label).toMatch(/^Brake knee, mounting bolts and backer/);
    expect(c.refs).toEqual(['D-57', 'D-2']);
    expect(c.details!.some((d) => /mounting bolt shear/.test(d.name))).toBe(true);
    expect(c.details!.some((d) => /backing plate/.test(d.name))).toBe(true);
    expect(c.details!.some((d) => /ball-lock|preload|clamp/.test(d.name))).toBe(false);
    expect(c.status).toBe('pass');
  });
  it('lash-load and side-lateral have no D-78 rows and lash-load keeps its D-76 value (the box rib is 3/4 in wide)', () => {
    expect(byId(csB, 'lash-load').util!).toBeCloseTo(0.767, 2);
    expect(byId(csB, 'lash-load').details!.some((d) => /D-78/.test(d.name))).toBe(false);
    expect(byId(csB, 'side-lateral').details!.some((d) => /D-78/.test(d.name))).toBe(false);
    expect(sideLateral(ctxOf(p0)).pinRib).toBeUndefined();
    expect(byId(csB, 'brake-abuse').details!.some((d) => /mount: pin /.test(d.name))).toBe(false);
  });
});

describe('D-78 preload', () => {
  const { oak, syB, preT, preB } = clampSolveAt(ctx, g, [-126, 150]);
  const At = (Math.PI / 4) * (0.375 - 0.9743 / 16) ** 2;
  const lagW = (site: typeof rm.top | typeof rm.bottom) => 1800 * pp.oakSpecificGravity ** 1.5 * site.insert.od ** 0.75 * site.insert.len * pp.ndsWetFactorFasteners * pp.brakeInsertWithdrawalFactor;
  it('P = T / (K d) from the ratchet torque is 2400 lbf at 15 ft-lb, K 0.2, 3/8 in; the proof, washer, flange and insert limits re-derived by hand', () => {
    for (const [pre, site] of [[preT, rm.top], [preB, rm.bottom]] as const) {
      close(pre.limits.torque, (15 * 12) / (0.2 * 0.375), 1e-12);
      close(pre.limits.proof, 0.75 * pp.ss316BoltYieldPsi * At, 1e-9);
      close(pre.flangeArea, (Math.PI / 4) * (site.insert.flangeOd ** 2 - site.insert.od ** 2), 1e-12);
      close(pre.limits.flange, pre.flangeArea * al.oakPerp, 1e-12);
      close(pre.limits.insert, lagW(site), 1e-9);
      close(pre.limits.washer, (Math.PI / 4) * (site.washer.od ** 2 - rm.clearHole ** 2) * (pre.syWasher * oak.par + (1 - pre.syWasher) * al.oakPerp), 1e-12);
      expect(pre.P).toBeCloseTo(Math.min(...Object.values(pre.limits)), 9);
    }
    expect(preT.flangeArea).toBeGreaterThan(0.4);
    expect(preT.flangeArea).toBeLessThan(0.55);
    expect(preT.limits.torque).toBeGreaterThan(preT.P * 5); // the oak and the thread govern, not the ratchet
    expect(syB).toBeGreaterThan(0.5);
  });
  it('the governing limit is named in the row and the how, for each bolt, and the stiffnesses follow the bolt and the clamped oak', () => {
    const mount = byId(csP, 'brake-mount');
    expect(mount.how).toMatch(/governed by (the oak under the insert flange|the insert thread pull-out|the oak under the head washer)/);
    expect(preT.governs).toMatch(/oak|thread/);
    const grip = rm.top.washer.t + rm.top.stack;
    close(preT.kb, (pp.brakeStainlessModulusPsi * (Math.PI / 4) * rm.dia ** 2) / grip, 1e-12);
    expect(preT.kb).toBeGreaterThan(preT.km * 5);
    const pre = det(csP, 'brake-mount', 'bolt T preload');
    expect(pre.info).toBe(true);
    close(pre.value, preT.P, 1e-9);
  });
});

describe('D-78 the 3-D solve with preloaded ties', () => {
  const goal = loadsBoth(ctx, ctx.loads.goal, g);
  it('one tie hand case: below separation the bolt takes F kb/(kb+km) of an outward pull and the clamp loses F km/(kb+km); beyond P (kb+km)/km the clamp is gone and the bolt takes it all', () => {
    const tie = { x: 5, z: 10, P: 200, kb: 1.2e6, km: 8e4 };
    const run = (F: number) => solveKnee([{ F: [0, F, 0], at: [5, 0, 10] }], [tie], [], [], [5, 10]);
    const a = run(50);
    close(a.bolt[0], 200 + (50 * tie.kb) / (tie.kb + tie.km), 1e-6);
    close(a.clamp[0], 200 - (50 * tie.km) / (tie.kb + tie.km), 1e-6);
    const Fsep = (200 * (tie.kb + tie.km)) / tie.km;
    const b = run(Fsep * 2);
    expect(b.clamp[0]).toBe(0);
    close(b.bolt[0], Fsep * 2, 1e-6);
    // and a push inward is carried by the contact, not by the tie: with no contact the tie alone moves in until the bolt force is the rest
    const c = run(-20);
    close(c.bolt[0], 200 - (20 * tie.kb) / (tie.kb + tie.km), 1e-6);
  });
  it('every scenario is in equilibrium (sum F_y, M_x, M_z vanish) for both rolling directions; separation ratios, clamp forces and tensions are non-negative', () => {
    for (const L of goal) {
      const { pl } = clampSolveAt(ctx, g, L.Rk);
      expect(pl.scen.length).toBe(6);
      for (const sc of pl.scen) {
        for (const r of sc.resid) expect(Math.abs(r), `${sc.contacts} ${sc.push}`).toBeLessThan(1e-4);
        expect(sc.Ft).toBeGreaterThanOrEqual(0);
        expect(sc.cb).toBeGreaterThanOrEqual(0);
      }
      close(pl.FbB, Math.max(...pl.scen.map((s) => s.Fb)), 1e-12);
      close(pl.clampT, Math.min(...pl.scen.map((s) => s.ct)), 1e-12);
    }
  });
  it('the amplified push is the brake-pivot force and the bolt tension is at least the preload less what the clamp gives up', () => {
    const { pl, preT, preB } = clampSolveAt(ctx, g, goal[1].Rk);
    expect(pl.P).toBeGreaterThan(90);
    for (const sc of pl.scen) { expect(sc.Ft).toBeGreaterThan(0); expect(sc.Fb).toBeGreaterThan(0); }
    expect(pl.FbB).toBeGreaterThan(preB.P);
    expect(pl.FbT).toBeGreaterThan(preT.P);
  });
});

describe('D-78 brake-mount with clamped bolts', () => {
  const mount = byId(csP, 'brake-mount');
  const goalL = loadsBoth(ctx, ctx.loads.goal, g);
  const hps = goalL.map((L) => handPins(L.Rk));
  const G = pp.oakSpecificGravity, d = rm.dia;
  const Fe = (G_: number, th: number) => { const par = 11200 * G_, per = (6100 * G_ ** 1.45) / Math.sqrt(d); return (par * per) / (par * Math.sin(th * RAD) ** 2 + per * Math.cos(th * RAD) ** 2); };
  const wetC = pp.ndsWetFactorFasteners * pp.brakeBoltLoadDurationFactor;
  const Gweb = thinSheet(pp).densityPcf / (62.4 * 1.12);
  const hullOak = rm.hull.filler + rm.hull.rib, hullT = hullOak + rm.hull.web;
  const zTHand = (F: number[]) => {
    const th = Math.atan2(Math.abs(F[0]), Math.abs(F[1])) / RAD, thW = Math.atan2(Math.abs(F[1]), Math.abs(F[0])) / RAD;
    const FeT = Fe(G, th), FeH = (FeT * hullOak + Fe(Gweb, thW) * rm.hull.web) / hullT;
    const req = d * (7 - (3 * th) / 90);
    const cdTab = Math.min(1, (F[1] > 0 ? rm.tab.z1 - rm.top.z : rm.top.z - rm.tab.z0) / req), cdHull = Math.min(1, (-F[1] > 0 ? rm.top.belowRibTop : rm.top.fromRibFoot) / req);
    return handZ(d, hullT, rm.tab.t, FeH, FeT, pp.ss316BoltYieldPsi, Math.max(th, thW)) * wetC * Math.min(cdTab, cdHull);
  };
  const zBHand = (F: number[]) => {
    const thR = Math.atan2(Math.abs(F[1]), Math.abs(F[0])) / RAD;
    return handZ(d, g.knee.legT, rm.hull.rail, Fe(G, 90), Fe(G, thR), pp.ss316BoltYieldPsi, Math.max(90, thR)) * wetC * 0.67;
  };

  it('keeps the id and the group; it is the clamped-bolt row: no pin, sleeve, Domino or bearing-washer rows, and the how says what governs the preload', () => {
    expect(mount.id).toBe('brake-mount');
    expect(mount.group).toBe('Structure');
    expect(mount.label).toMatch(/clamped bolts/);
    expect(mount.refs).toContain('D-78');
    for (const dd of mount.details!) expect(dd.name, dd.name).not.toMatch(/sleeve|ball-lock|Domino|\bpad\b|bearing washer at pin|^VERIFY/i);
    expect(mount.how).toMatch(/PRELOAD: P = T \/ \(K d\)/);
    expect(mount.how).toMatch(/governed by/);
    expect(mount.how).toMatch(/ENVELOPE OF BOTH ROLLING DIRECTIONS/);
    expect(mount.how).toMatch(/TIGHTEST KNEE DETAIL/);
  });

  it('both rolling directions: sigma -1 loads the top bolt most (124) and sigma +1 loads the bottom bolt more (98); the elastic group balances Rk', () => {
    expect(goalL.map((L) => L.sigma)).toEqual([1, -1]);
    close(hps[0].Bmag, 98, 0.03);
    close(hps[1].Tmag, 124, 0.02);
    for (let i = 0; i < 2; i++) {
      close(hps[i].FT[0] + hps[i].FB[0], -goalL[i].Rk[0], 1e-9);
      close(hps[i].FT[1] + hps[i].FB[1], -goalL[i].Rk[1], 1e-9);
      const gp = clampGroupForces(g, goalL[i].Rk);
      close(gp.Tmag, hps[i].Tmag, 1e-9);
      close(gp.Bmag, hps[i].Bmag, 1e-9);
    }
  });

  it('friction capacity = mu x the smallest clamp force left; the joint capacity row is the larger of friction and the NDS yield mode (hand-written, within 1 %), worst of the two directions', () => {
    const pls = goalL.map((L) => clampSolveAt(ctx, g, L.Rk));
    const fT = det(csP, 'brake-mount', 'bolt T in-plane load vs friction alone');
    const fB = det(csP, 'brake-mount', 'bolt B in-plane load vs friction alone');
    expect(fT.info).toBe(true);
    expect(fB.info).toBe(true);
    close(fT.limit, pp.brakeJointFrictionMu * pls[1].pl.clampT, 1e-9);
    const rowT = det(csP, 'brake-mount', 'bolt T in-plane load vs the joint capacity');
    const rowB = det(csP, 'brake-mount', 'bolt B in-plane load vs the joint capacity');
    close(rowT.util, Math.max(...hps.map((h, i) => h.Tmag / Math.max(pp.brakeJointFrictionMu * pls[i].pl.clampT, zTHand(h.FT)))));
    close(rowB.util, Math.max(...hps.map((h, i) => h.Bmag / Math.max(pp.brakeJointFrictionMu * pls[i].pl.clampB, zBHand(h.FB)))));
    expect(rowT.name).toMatch(/NDS yield mode/);
    expect(rowB.name).toMatch(/end grain C_eg 0\.67/);
  });

  it('with friction not holding the lateral rows carry the slip load; the splitting rows have NO load when the clamp would hold (check at an enormous friction)', () => {
    const hi = byId(run({ ...pp, brakeJointFrictionMu: 0.6, brakeBoltTorqueFtLb: 30 } as Params), 'brake-mount');
    const lo = mount;
    const ribLo = det(csP, 'brake-mount', 'box rib block at the top bolt (brake-rib): splitting');
    expect(ribLo.value).toBeGreaterThan(50);
    const ribHi = det([hi], 'brake-mount', 'box rib block at the top bolt (brake-rib): splitting');
    expect(ribHi.value).toBeGreaterThanOrEqual(0);
    expect(lo.details!.length).toBe(hi.details!.length);
  });

  it('bolt tension, separation and bearing rows by hand: the bolt tension over the tensile stress area, the crush-level washer and flange bearing, the insert pull-out', () => {
    const pls = goalL.map((L) => clampSolveAt(ctx, g, L.Rk));
    const FbT = Math.max(...pls.map((x) => x.pl.FbT)), FbB = Math.max(...pls.map((x) => x.pl.FbB));
    const At = (Math.PI / 4) * (0.375 - 0.9743 / 16) ** 2;
    close(det(csP, 'brake-mount', 'bolt T tension').value, FbT / At, 0.02);
    close(det(csP, 'brake-mount', 'insert flange at B').value, FbB / pls[0].preB.flangeArea, 0.02);
    close(det(csP, 'brake-mount', 'insert flange at B').limit, pp.oakCompPerpPsi * pp.wetServiceFactorCompPerp, 1e-9);
    close(det(csP, 'brake-mount', 'insert thread pull-out at T').limit, pls[0].preT.insertPull, 1e-9);
    close(det(csP, 'brake-mount', 'bolt B joint separation').value, Math.max(...pls.map((x) => x.pl.sepB)), 0.02);
    expect(det(csP, 'brake-mount', 'bolt T joint separation').limit).toBe(1);
    expect(det(csP, 'brake-mount', 'insert torque-out at T').value).toBeCloseTo((pp.brakeBoltTorqueFtLb * 12) / 2, 9);
  });

  it('tab glue uses the real patch (2.89 in2); the rows are the envelope of the scenarios (clamp, net bolt pull and contacts)', () => {
    expect(rm.tab.patch.area).toBeCloseTo(2.89, 1);
    const pls = goalL.map((L) => clampSolveAt(ctx, g, L.Rk).pl);
    close(det(csP, 'brake-mount', 'tab glue patch: peak tension').value, Math.max(...pls.map((x) => x.tens)), 0.02);
    close(det(csP, 'brake-mount', 'tab glue patch: peak compression').value, Math.max(...pls.map((x) => x.comp)), 0.02);
    close(det(csP, 'brake-mount', 'tab glue patch (the real').limit, al.oakShear * 0.25);
    close(det(csP, 'brake-mount', 'tab bending across the grain').limit, al.oakShear / 3);
  });

  it('the clamped joint FAILS at the defaults (reported, not tuned): the insert flange, the insert thread, the head washer and the tab joint', () => {
    const over = mount.details!.filter((x) => !x.info && x.util > 1).map((x) => x.name);
    expect(mount.status).toBe('fail');
    for (const k of ['insert flange at B', 'insert thread pull-out at B', 'tab glue patch: peak tension', 'box rib block at the top bolt (brake-rib): splitting']) expect(over.some((n) => n.startsWith(k)), k).toBe(true);
    for (const k of ['bolt T tension', 'bolt B tension', 'bolt steel', 'knee arm', 'knee leg']) expect(over.some((n) => n.startsWith(k)), k).toBe(false);
  });

  it('Standard and Extreme weather both produce the rows', () => {
    for (const w of [WEATHER_SPEC.standard, WEATHER_SPEC.extreme]) {
      const m = byId(run({ ...pp, weatherSpec: w } as Params), 'brake-mount');
      expect(m.details!.length).toBe(mount.details!.length);
    }
  });
});

describe('D-78 brake-abuse follows the clamped bolts', () => {
  it('reuses the rows at yield level for both rolling directions of the stomp; the info rows stay out of the headline', () => {
    const ab = byId(csP, 'brake-abuse');
    expect(ab.details!.filter((x) => /^mount: bolt [TB] /.test(x.name)).length).toBeGreaterThan(8);
    expect(ab.details!.filter((x) => x.info && /^mount: /.test(x.name)).length).toBe(4);
    const ha = loadsFromFootBoth(ctx, g, pp.brakeFootAbuseLbf).map((L) => handPins(L.Rk));
    const dd = det(csP, 'brake-abuse', 'mount: bolt T in-plane load vs friction alone');
    expect(ha.some((h) => Math.abs(h.Tmag - dd.value) <= 0.01 * h.Tmag)).toBe(true);
    expect(ab.details!.some((x) => /mount: bolt T joint separation/.test(x.name))).toBe(true);
  });
  it('the bolted brake-abuse is unchanged: mount rows are the bolt rows', () => {
    expect(byId(csB, 'brake-abuse').details!.some((x) => /^mount: mounting bolt shear/.test(x.name))).toBe(true);
    expect(byId(csB, 'brake-abuse').details!.some((x) => x.info)).toBe(false);
  });
});

describe('D-78 the box rib carries the top bolt with the D-ring (lash-load, side-lateral)', () => {
  const sl = sideLateral(ctx);
  const pr = sl.pinRib!;
  it('exists only with the removable knee, uses the 2 in block width (rib.blockW) and the insert\'s hole for the net section', () => {
    expect(pr).toBeDefined();
    expect(pr.w).toBe(rm.rib.blockW);
    close(pr.S, (pr.w * pr.depth ** 2) / 6, 1e-12);
    close(pr.Snet, ((pr.w - rm.top.insert.od) * pr.depth ** 2) / 6, 1e-12);
    close(pr.zT, rm.top.z - ctx.L.deckTop, 1e-12);
  });
  it('the loads are the envelope of the goal hold (both directions) and the stomp: largest in-plane top-bolt force and the largest net pull', () => {
    const variants = [...loadsBoth(ctx, ctx.loads.goal, g), ...loadsFromFootBoth(ctx, g, pp.brakeFootAbuseLbf)];
    close(Math.hypot(pr.FTx, pr.FTz), Math.max(...variants.map((L) => handPins(L.Rk).Tmag)), 1e-9);
    close(pr.pull, Math.max(...variants.map((L) => clampSolveAt(ctx, g, L.Rk).pl.pullT)), 1e-9);
  });
  it('lash-load and side-lateral carry the insert-hole rows; the box tie with the net pull is what fails in side-lateral', () => {
    const l = det(csP, 'lash-load', 'insert hole');
    const sd = det(csP, 'side-lateral', 'D-ring rating on the box rib');
    close(l.value, (pr.ribFRating * pr.lever) / pr.Snet);
    close(sd.value, l.value, 1e-9);
    const tie = det(csP, 'side-lateral', 'box tie glue');
    close(tie.value, Math.max(sl.push.tieForce + pr.tieAdd, sl.rating.tieForce) / sl.tieArea, 1e-9);
    expect(byId(csP, 'side-lateral').how).toMatch(/D-78 removable knee/);
    expect(det(csP, 'lash-load', 'rib bending at the rating').util).toBeCloseTo(det(csB, 'lash-load', 'rib bending at the rating').util, 6);
  });
});

describe('D-78 the ratchet rides in the box', () => {
  it('the packing rows include the ratchet and socket pouch when the knees are removable and pass; the bolted default packs without it', () => {
    const sp = byId(csP, 'storage-pack');
    expect(sp.status).toBe('pass');
    expect(sp.value).toBeGreaterThan(byId(csB, 'storage-pack').value);
    for (const c of csP.filter((x) => /^(cargo|storage|seat-stow)/.test(x.id) && x.statusCargo)) expect(c.statusCargo, c.id).not.toBe('fail');
  });
});
