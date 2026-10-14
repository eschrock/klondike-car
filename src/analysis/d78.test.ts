/**
 * D-78 analysis: the removable brake knee on two sleeved ball-lock pins (`kneeMount` = pins). The pin loads, the NDS wood-to-wood single-shear capacity of both pins, the axial pull, the
 * tab, the rib and the combined rib rows are each re-derived here by hand from the params and the geometry, independently of the check code. The default (bolted) rows are checked unchanged.
 */
import { describe, expect, it } from 'vitest';
import { KNEE_MOUNT, PARAM_DEFS, WEATHER_SPEC, defaultParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext } from './context';
import { brakeBundle, loadsBoth, loadsFromFootBoth } from './brake';
import { pinGroupForces, pinPull, samples, solveKnee } from './brake-pins';
import { cleavageNearEnd, endDistanceFactor, oakFeAt, sleevedPinFyb, woodPinCapacity, woodShearZ } from './nds';
import { thinSheet } from '../params';
import { sideLateral } from './side-lateral';
import { allowables } from './structure';
import { runChecks, type AnalysisCheck } from './index';

const p0 = defaultParams();
const pp = { ...p0, kneeMount: KNEE_MOUNT.pins } as Params;
const run = (p: Params) => runChecks(p, { includeTruck: false });
const csB = run(p0);
const csP = run(pp);
const byId = (c: AnalysisCheck[], id: string) => c.find((x) => x.id === id)!;
const det = (c: AnalysisCheck[], id: string, name: string, cases: 'primary' | 'cargo' = 'primary') => (cases === 'cargo' ? byId(c, id).detailsCargo! : byId(c, id).details!).find((d) => d.name.includes(name))!;
const ctxOf = (p: Params) => makeContext(p, buildModel(p, { rider: 'goal', cargo: true }), buildModel(p, { rider: 'none', cargo: false, seat: 'stowed' }));
const ctx = ctxOf(pp);
const { g } = brakeBundle(ctx);
const pn = g.pins!;
const al = allowables(ctx);
const RAD = Math.PI / 180;
const close = (a: number, b: number, rel = 0.01) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(Math.abs(b), 1e-9));

// ── independent hand derivation of the in-plane pin loads (a different route from the check code: solve the moment balance about the pivot for the twist) ──
function handPins(Rk: [number, number]) {
  const T = [pn.T.x, pn.T.z], B = [pn.B.x, pn.B.z], H = g.H;
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
  it('sleeved-pin F_yb is the plastic moment of the pin plus the tube over a solid pin of the sleeve OD (about 44.8 ksi at the defaults)', () => {
    const fy = sleevedPinFyb(p0.ss316BoltYieldPsi, p0.brakeSleeveYieldPsi, 0.5, 0.375);
    close(fy, (65000 * 0.375 ** 3 + 30000 * (0.5 ** 3 - 0.375 ** 3)) / 0.5 ** 3, 1e-9);
    expect(fy).toBeGreaterThan(44500);
    expect(fy).toBeLessThan(45000);
    expect(sleevedPinFyb(65000, 65000, 0.5, 0.375)).toBeCloseTo(65000, 6);
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
  it('the three new analysis params carry a status, a note and the D-78 reference; the retention is a verify placeholder', () => {
    for (const k of ['brakePinRetentionLbf', 'brakeSleeveYieldPsi', 'brakePinLoadDurationFactor'] as const) {
      expect(PARAM_DEFS[k].status, k).toBeDefined();
      expect(PARAM_DEFS[k].note, k).toBeTruthy();
      expect(PARAM_DEFS[k].ref, k).toContain('D-78');
    }
    expect(PARAM_DEFS.brakePinRetentionLbf.status).toBe('verify');
    expect(PARAM_DEFS.brakePinRetentionLbf.note).toMatch(/vendor/i);
    expect(PARAM_DEFS.brakePinLoadDurationFactor.default).toBe(1);
  });
});

describe('D-78 the default (bolted) rows are unchanged', () => {
  it('brake-mount is still the bolted row: bolts, backer and plate rows, no pin rows, the old label and refs', () => {
    const c = byId(csB, 'brake-mount');
    expect(c.label).toMatch(/^Brake knee, mounting bolts and backer/);
    expect(c.refs).toEqual(['D-57', 'D-2']);
    expect(c.details!.some((d) => /mounting bolt shear/.test(d.name))).toBe(true);
    expect(c.details!.some((d) => /backing plate/.test(d.name))).toBe(true);
    expect(c.details!.some((d) => /ball-lock|pin T|pin B/.test(d.name))).toBe(false);
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

describe('D-78 the 3-D rigid-knee solve', () => {
  const goal = loadsBoth(ctx, ctx.loads.goal, g);
  it('every scenario of the solve is in equilibrium (sum F_y, M_x, M_z about the reference all vanish), and the contact choices are covered both ways of pushing', () => {
    for (const L of goal) {
      const pl = pinPull(pp, g, L.Rk);
      expect(pl.scen.length).toBe(6);
      for (const sc of pl.scen) {
        for (const r of sc.resid) expect(Math.abs(r), `${sc.contacts} ${sc.push}`).toBeLessThan(1e-4);
        expect(sc.T).toBeGreaterThanOrEqual(0);
        expect(sc.B).toBeGreaterThanOrEqual(0);
      }
      close(pl.B, Math.max(...pl.scen.map((s) => s.B)), 1e-12);
      close(pl.T, Math.max(...pl.scen.map((s) => s.T)), 1e-12);
    }
  });
  it('hand case: the prying alone about the top of the leg contact pulls pin B by M_x / (z_leg_top - z_B) (about 152 lbf: the chine-top hinge), pin T not at all; about the tab bottom it is about 48 lbf', () => {
    const e = g.y.wheel - g.y.face, Rz = 151.8;
    const ref: [number, number] = [(pn.T.x + pn.B.x) / 2, (pn.T.z + pn.B.z) / 2];
    const pins: Array<[number, number]> = [[pn.T.x, pn.T.z], [pn.B.x, pn.B.z]];
    const leg = samples({ x0: g.knee.x0, x1: g.knee.x1, z0: g.knee.zBot, z1: g.knee.zLeg });
    const load = [{ F: [0, 0, Rz] as [number, number, number], at: [g.H[0], e, g.H[1]] as [number, number, number] }];
    const s1 = solveKnee(load, pins, leg, [], ref);
    close(s1.pinT[1], (Rz * e) / (g.knee.zLeg - pn.B.z), 0.03);
    expect(s1.pinT[0]).toBeLessThan(1);
    const tab = samples({ x0: pn.tab.bearing.x0, x1: pn.tab.bearing.x1, z0: pn.tab.bearing.z0, z1: pn.tab.bearing.z1 });
    const s2 = solveKnee(load, pins, [], tab, ref);
    expect(s2.pinT[1]).toBeLessThan(s1.pinT[1] / 2);
  });
  it('yaw alone about the leg\'s rear edge pulls pin B by M_z / (x_B - x_leg_rear) (the rear-edge yaw case): 380 / 1.06 = about 358 lbf', () => {
    const e = g.y.wheel - g.y.face, Rx = -126.6;
    const ref: [number, number] = [(pn.T.x + pn.B.x) / 2, (pn.T.z + pn.B.z) / 2];
    const pins: Array<[number, number]> = [[pn.T.x, pn.T.z], [pn.B.x, pn.B.z]];
    const leg = samples({ x0: g.knee.x0, x1: g.knee.x1, z0: g.knee.zBot, z1: g.knee.zLeg });
    const s = solveKnee([{ F: [Rx, 0, 0], at: [g.H[0], e, g.H[1]] }], pins, leg, [], ref);
    close(s.pinT[1], (Math.abs(Rx) * e) / (pn.B.x - g.knee.x0), 0.03);
  });
  it('the envelope pull exceeds the both-contacts pull, and pin B is pulled most by the leg-only choice, pin T by the tab-only choice', () => {
    const pl = pinPull(pp, g, goal[1].Rk);
    const mx = (c: string, f: (s: (typeof pl.scen)[number]) => number) => Math.max(...pl.scen.filter((s) => s.contacts === c).map(f));
    expect(mx('leg', (s) => s.B)).toBeGreaterThanOrEqual(mx('both', (s) => s.B));
    expect(mx('tab', (s) => s.T)).toBeGreaterThanOrEqual(mx('both', (s) => s.T));
    expect(pl.B).toBeGreaterThan(300);
  });
});

describe('D-78 brake-mount in pins mode', () => {
  const mount = byId(csP, 'brake-mount');
  const goalL = loadsBoth(ctx, ctx.loads.goal, g);
  const hps = goalL.map((L) => handPins(L.Rk));
  const G = pp.oakSpecificGravity, sOd = pn.sleeveOd;
  const Fyb = (pp.ss316BoltYieldPsi * pn.dia ** 3 + pp.brakeSleeveYieldPsi * (sOd ** 3 - pn.sleeveId ** 3)) / sOd ** 3;
  const Fe = (G_: number, D: number, th: number) => { const par = 11200 * G_, per = (6100 * G_ ** 1.45) / Math.sqrt(D); return (par * per) / (par * Math.sin(th * RAD) ** 2 + per * Math.cos(th * RAD) ** 2); };
  const wetC = pp.ndsWetFactorFasteners * pp.brakePinLoadDurationFactor;
  const Gweb = thinSheet(pp).densityPcf / (62.4 * 1.12);
  const hullOak = pn.hull.filler + pn.hull.rib, hullT = hullOak + pn.hull.web;
  const zTHand = (F: number[]) => {
    const th = Math.atan2(Math.abs(F[0]), Math.abs(F[1])) / RAD, thW = Math.atan2(Math.abs(F[1]), Math.abs(F[0])) / RAD;
    const FeT = Fe(G, sOd, th), FeH = (FeT * hullOak + Fe(Gweb, sOd, thW) * pn.hull.web) / hullT;
    const req = sOd * (7 - (3 * th) / 90);
    const cdTab = Math.min(1, (F[1] > 0 ? pn.tab.z1 - pn.T.z : pn.T.z - pn.tab.z0) / req), cdHull = Math.min(1, (-F[1] > 0 ? pn.T.belowRibTop : pn.T.fromRibFoot) / req);
    return handZ(sOd, hullT, pn.tab.t, FeH, FeT, Fyb, Math.max(th, thW)) * wetC * Math.min(cdTab, cdHull);
  };
  const zBHand = (F: number[]) => {
    const thR = Math.atan2(Math.abs(F[1]), Math.abs(F[0])) / RAD;
    return handZ(sOd, g.knee.legT, pn.hull.rail, Fe(G, sOd, 90), Fe(G, sOd, thR), Fyb, Math.max(90, thR)) * wetC * 0.67;
  };

  it('keeps the id and the group, and says what is true for pins: no bolt, backer or backing-plate row', () => {
    expect(mount.id).toBe('brake-mount');
    expect(mount.group).toBe('Structure');
    expect(mount.label).toMatch(/pin/i);
    expect(mount.label).not.toMatch(/bolt|backer/i);
    expect(mount.refs).toContain('D-78');
    for (const d of mount.details!) expect(d.name, d.name).not.toMatch(/mounting bolt|nut backing plate|head washer|bolt bearing|bolt tear-out|\bpad\b/i);
    expect(mount.how).toMatch(/NO bolts, backer or backing plate/);
    expect(mount.how).toMatch(/TIGHTEST KNEE DETAIL/);
    expect(mount.how).toMatch(/ENVELOPE OF BOTH ROLLING DIRECTIONS/);
  });

  it('both rolling directions are evaluated: sigma -1 is the larger force on the knee (T about 124.6, B 87.2) and sigma +1 loads pin B more (about 98)', () => {
    expect(goalL.map((L) => L.sigma)).toEqual([1, -1]);
    const [hp1, hm1] = hps;
    close(hp1.Bmag, 98, 0.03);
    close(hm1.Tmag, 124.6, 0.02);
    close(hm1.Bmag, 87.2, 0.02);
    expect(hp1.Bmag).toBeGreaterThan(hm1.Bmag);
    expect(hm1.Tmag).toBeGreaterThan(hp1.Tmag);
    // the elastic group balances Rk and the moments about the pivot
    for (let i = 0; i < 2; i++) {
      close(hps[i].FT[0] + hps[i].FB[0], -goalL[i].Rk[0], 1e-9);
      close(hps[i].FT[1] + hps[i].FB[1], -goalL[i].Rk[1], 1e-9);
      const gp = pinGroupForces(g, goalL[i].Rk);
      close(gp.Tmag, hps[i].Tmag, 1e-9);
      close(gp.Bmag, hps[i].Bmag, 1e-9);
    }
  });

  it('pin T and pin B Z\' within 1 % of the hand-written NDS modes (web counted with its own Fe, C_delta on the tab\'s end, C_eg on the knee), worst of the two directions', () => {
    const dT = det(csP, 'brake-mount', 'pin T lateral load'), dB = det(csP, 'brake-mount', 'pin B lateral load');
    close(dT.util, Math.max(...hps.map((h) => h.Tmag / zTHand(h.FT))));
    close(dB.util, Math.max(...hps.map((h) => h.Bmag / zBHand(h.FB))));
    expect(dT.name).toMatch(/C_delta/);
    expect(dB.name).toMatch(/end grain, C_eg 0\.67/);
    expect(dT.util).toBeLessThan(1);
    expect(dB.util).toBeLessThan(1);
  });

  it('the retention rows are VERIFY / info only: flagged, excluded from the status, and the how states the required rating (the computed worst pull)', () => {
    const rows = mount.details!.filter((d) => /pull-out at the ball-lock/.test(d.name));
    expect(rows.length).toBe(2);
    for (const r of rows) { expect(r.info).toBe(true); expect(r.name).toMatch(/^VERIFY/); expect(r.limit).toBe(pp.brakePinRetentionLbf); }
    expect(mount.details!.filter((d) => d.info && /^VERIFY/.test(d.name)).length).toBe(2);
    // with the Dominos the glue-alone tension and shear rows are reference only
    expect(mount.details!.filter((d) => d.info && /glue alone/.test(d.name)).length).toBe(2);
    expect(mount.label).not.toMatch(/VERIFY/);
    const pl = goalL.map((L) => pinPull(pp, g, L.Rk));
    const needB = Math.max(...pl.map((x) => x.B)), needT = Math.max(...pl.map((x) => x.T));
    close(rows.find((r) => /pin B/.test(r.name))!.value, needB, 0.02);
    close(rows.find((r) => /pin T/.test(r.name))!.value, needT, 0.02);
    expect(mount.how).toMatch(/must be rated for at least/);
    expect(mount.how).toMatch(/UNPUBLISHED/);
    // a retention rating that is never met does not change the status of the row: raise the placeholder to 1 lbf and the other details keep their utilizations
    const low = byId(run({ ...pp, brakePinRetentionLbf: 100 } as Params), 'brake-mount');
    expect(low.status).toBe(mount.status);
  });

  it('the pad is gone: the tab lies on the web over the rib block and the knee leg bears on the rail and chine band (both contact rows exist, in oak perpendicular to grain)', () => {
    expect(mount.details!.some((d) => /tab on the web over the rib block/.test(d.name))).toBe(true);
    expect(mount.details!.some((d) => /knee leg on the rail and the chine band/.test(d.name))).toBe(true);
    const pl = goalL.map((L) => pinPull(pp, g, L.Rk));
    close(det(csP, 'brake-mount', 'tab on the web over the rib block').value, Math.max(...pl.map((x) => x.tabMax / x.tabArea)), 0.02);
    close(det(csP, 'brake-mount', 'knee leg on the rail and the chine band').value, Math.max(...pl.map((x) => x.legMax / x.legArea)), 0.02);
  });

  it('tab glue uses the real patch (2.89 in2) with the contact and pull y forces and the moments: the patch rows are the envelope of the scenarios', () => {
    expect(pn.tab.patch.area).toBeCloseTo(2.89, 1);
    const pl = goalL.map((L) => pinPull(pp, g, L.Rk));
    close(det(csP, 'brake-mount', 'tab glue patch: peak tension').value, Math.max(...pl.map((x) => x.tens)), 0.02);
    close(det(csP, 'brake-mount', 'tab glue patch: peak compression').value, Math.max(...pl.map((x) => x.comp)), 0.02);
    close(det(csP, 'brake-mount', 'tab glue patch (the real').limit, al.oakShear * 0.25);
    close(det(csP, 'brake-mount', 'peak tension across the glue').limit, al.oakShear / 3);
    close(det(csP, 'brake-mount', 'tab bending across the grain').limit, al.oakShear / 3);
    expect(det(csP, 'brake-mount', 'tab in-plane bending').limit).toBe(al.oakBend);
  });

  it('the bearing washer takes the pull: bearing on the counterbore floor by its ring (washer.ringArea), and the knee-side sleeves are checked on their epoxy', () => {
    const pl = goalL.map((L) => pinPull(pp, g, L.Rk));
    const ring = pn.washer.ringArea;
    expect(ring).toBeGreaterThan(1);
    close(det(csP, 'brake-mount', 'hull bearing washer at pin B').value, Math.max(...pl.map((x) => x.B)) / ring, 0.02);
    close(det(csP, 'brake-mount', 'hull bearing washer at pin T').value, Math.max(...pl.map((x) => x.T)) / ring, 0.02);
    close(det(csP, 'brake-mount', 'knee-side sleeve at pin B').value, Math.max(...pl.map((x) => x.B)) / (Math.PI * sOd * g.knee.legT), 0.02);
    expect(det(csP, 'brake-mount', 'counterbore at pin T').limit).toBe(pp.brakePinEdgeIn);
  });

  it('the splitting rows use the NDS near-end form: rib block d_e 1.25 of 2.00 in, the tab toward its rear end; the plug text names the side that is loaded', () => {
    const rib = det(csP, 'brake-mount', 'box rib block at pin T (brake-rib): splitting');
    const cl = cleavageNearEnd(pp.oakNdsShearPsi * pp.ndsWetFactorShear * pp.brakePinLoadDurationFactor, hullOak, pn.rib.blockW, pn.rib.blockW / 2, sOd, Math.min(pn.T.fromRibFoot, pn.T.belowRibTop));
    close(rib.limit, cl.Vr, 1e-9);
    expect(rib.name).toMatch(/near-end/);
    expect(det(csP, 'brake-mount', 'tab behind pin T').name).toMatch(/near-end|far/);
    expect(det(csP, 'brake-mount', 'pin B thin wall: the z part').name).toMatch(/below the sleeve/);
    expect(mount.how).toMatch(/only 0\.10" of oak between the sleeve and the glued UPRIGHT layers/);
  });

  it('at the defaults pins mode FAILS (reported, not tuned): the hull bearing washer, the tab glue patch and the box-rib splitting are over their limits, and the pin Z\' rows still pass', () => {
    const over = mount.details!.filter((d) => !d.info && d.util > 1).map((d) => d.name);
    expect(mount.status).toBe('fail');
    for (const k of ['hull bearing washer at pin B', 'tab joint with 2 Dominos: shear', 'tab glue patch: peak compression', 'box rib block at pin T (brake-rib): splitting']) expect(over.some((n) => n.startsWith(k)), k).toBe(true);
    for (const k of ['pin T lateral load', 'pin B lateral load', 'pin steel']) expect(over.some((n) => n.startsWith(k)), k).toBe(false);
  });

  it('the Dominos are credited on top of the glue left around their mortises: peel and shear resultants vs glue + tenon capacity, with the assumed (verify) bond stress', () => {
    const dom = pn.tab.dominos!;
    expect(dom).toBeTruthy();
    expect(dom.count).toBe(2);
    expect(PARAM_DEFS.brakeDominoBondPsi.status).toBe('verify');
    expect(PARAM_DEFS.brakeDominoBondPsi.note).toMatch(/ASSUMED/);
    const A = pn.tab.patch.area, aGlue = A - dom.count * dom.tIn * dom.wIn;
    const pull = pp.brakeDominoBondPsi * 2 * (dom.tIn + dom.wIn) * dom.depthEach;
    const t = det(csP, 'brake-mount', 'tab joint with 2');
    close(t.limit, (al.oakShear / 3) * aGlue + dom.count * pull, 1e-9);
    const sh = det(csP, 'brake-mount', 'tab joint with 2 Dominos: shear');
    close(sh.limit, al.oakShear * 0.25 * aGlue + dom.count * Math.min(pull, al.oakPerp * dom.wIn * dom.depthEach), 1e-9);
    const pl = goalL.map((L) => pinPull(pp, g, L.Rk));
    close(det(csP, 'brake-mount', 'peel / tension resultant').value, Math.max(...pl.map((x) => (x.tens * A) / 2)), 0.02);
    close(sh.value, Math.max(...pl.map((x) => x.shear * A)), 0.02);
    expect(mount.how).toMatch(/ASSUMED/);
    // without Dominos the joint rows are absent
    expect(det(csP, 'brake-mount', 'tab glue patch: peak tension').limit).toBeCloseTo(al.oakShear / 3, 6);
  });

  it('Standard and Extreme weather both produce the pins rows', () => {
    for (const w of [WEATHER_SPEC.standard, WEATHER_SPEC.extreme]) {
      const cs = run({ ...pp, weatherSpec: w } as Params);
      const m = byId(cs, 'brake-mount');
      expect(m.details!.length).toBe(mount.details!.length);
      expect(m.how).toMatch(/ball-lock/);
    }
  });
});

describe('D-78 brake-abuse follows the pins mount', () => {
  it('reuses the pins rows at yield level for both rolling directions of the stomp, limits raised by the safety factor, the VERIFY rows kept out of the headline', () => {
    const ab = byId(csP, 'brake-abuse');
    const ha = loadsFromFootBoth(ctx, g, pp.brakeFootAbuseLbf).map((L) => handPins(L.Rk));
    const d = det(csP, 'brake-abuse', 'mount: pin T lateral load');
    expect(ha.some((h) => Math.abs(h.Tmag - d.value) <= 0.01 * h.Tmag)).toBe(true);
    expect(d.limit).toBeGreaterThan(det(csP, 'brake-mount', 'pin T lateral load').limit);
    expect(ab.details!.filter((x) => /^mount: pin /.test(x.name)).length).toBeGreaterThan(5);
    expect(ab.details!.filter((x) => x.info && /VERIFY/.test(x.name)).length).toBe(2);
    expect(ab.label).toMatch(/abuse/);
    expect(ab.limit).not.toBe(pp.brakePinRetentionLbf * 2);
  });
  it('the bolted brake-abuse is unchanged: mount rows are the bolt rows', () => {
    expect(byId(csB, 'brake-abuse').details!.some((x) => /^mount: mounting bolt shear/.test(x.name))).toBe(true);
    expect(byId(csB, 'brake-abuse').details!.some((x) => x.info)).toBe(false);
  });
});

describe('D-78 the box rib carries the top pin with the D-ring (lash-load, side-lateral)', () => {
  const sl = sideLateral(ctx);
  const pr = sl.pinRib!;
  it('exists only with pins, uses the 3 in block width (rib.blockW) for S and the 0.5 in sleeve hole for the net section', () => {
    expect(pr).toBeDefined();
    expect(pr.w).toBe(pn.rib.blockW);
    expect(pr.w).toBeCloseTo(3, 6);
    close(pr.S, (pr.w * pr.depth ** 2) / 6, 1e-12);
    close(pr.Snet, ((pr.w - pn.sleeveOd) * pr.depth ** 2) / 6, 1e-12);
    close(pr.zT, pn.T.z - ctx.L.deckTop, 1e-12);
  });
  it('the T-pin loads are the envelope of the goal hold load (both rolling directions) and the stomp: largest in-plane force and largest pull', () => {
    const variants = [...loadsBoth(ctx, ctx.loads.goal, g), ...loadsFromFootBoth(ctx, g, pp.brakeFootAbuseLbf)];
    const hp = variants.map((L) => handPins(L.Rk));
    close(Math.hypot(pr.FTx, pr.FTz), Math.max(...hp.map((h) => h.Tmag)), 1e-9);
    close(pr.pull, Math.max(...variants.map((L) => pinPull(pp, g, L.Rk).T)), 1e-9);
    expect(pr.pull).toBeGreaterThan(det(csP, 'brake-mount', 'pin T lateral load').value);
  });
  it('lash-load and side-lateral carry the sleeve-hole rows (the 3 in block keeps the hole inside the limit); the box tie with the envelope pull is what fails in side-lateral', () => {
    const l = det(csP, 'lash-load', 'knee\'s top-pin sleeve hole');
    const s = det(csP, 'side-lateral', 'D-ring rating on the box rib');
    close(l.value, (pr.ribFRating * pr.lever) / pr.Snet);
    close(s.value, l.value, 1e-9);
    expect(l.util).toBeLessThan(0.9);
    const tie = det(csP, 'side-lateral', 'box tie glue');
    expect(tie.name).toMatch(/knee/);
    close(tie.value, Math.max(sl.push.tieForce + pr.tieAdd, sl.rating.tieForce) / sl.tieArea, 1e-9);
    expect(byId(csP, 'side-lateral').how).toMatch(/D-78 removable knee/);
    expect(byId(csP, 'lash-load').how).toMatch(/D-78 removable knee/);
  });
  it('the plain rib-bending number is unchanged (the shaft keeps the D-76 width; the pin block is a local widening)', () => {
    expect(det(csP, 'lash-load', 'rib bending at the rating').util).toBeCloseTo(det(csB, 'lash-load', 'rib bending at the rating').util, 6);
  });
});
