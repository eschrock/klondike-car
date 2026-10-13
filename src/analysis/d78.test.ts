/**
 * D-78 analysis: the removable brake knee on two sleeved ball-lock pins (`kneeMount` = pins). The pin loads, the NDS wood-to-wood single-shear capacity of both pins, the axial pull, the
 * tab, the rib and the combined rib rows are each re-derived here by hand from the params and the geometry, independently of the check code. The default (bolted) rows are checked unchanged.
 */
import { describe, expect, it } from 'vitest';
import { KNEE_MOUNT, PARAM_DEFS, WEATHER_SPEC, defaultParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext } from './context';
import { brakeBundle, loadsAt, loadsFromFoot } from './brake';
import { oakFeAt, sleevedPinFyb, woodPinCapacity, woodShearZ } from './nds';
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

describe('D-78 brake-mount in pins mode', () => {
  const mount = byId(csP, 'brake-mount');
  const goal = loadsAt(ctx, ctx.loads.goal, g);
  const hp = handPins(goal.Rk);
  const G = pp.oakSpecificGravity, sOd = pn.sleeveOd;
  const Fyb = (pp.ss316BoltYieldPsi * pn.dia ** 3 + pp.brakeSleeveYieldPsi * (sOd ** 3 - pn.sleeveId ** 3)) / sOd ** 3;
  const Fe = (th: number) => (11200 * G * ((6100 * G ** 1.45) / Math.sqrt(sOd))) / (11200 * G * Math.sin(th * RAD) ** 2 + ((6100 * G ** 1.45) / Math.sqrt(sOd)) * Math.cos(th * RAD) ** 2);
  const wetC = pp.ndsWetFactorFasteners * pp.brakePinLoadDurationFactor;

  it('keeps the id and the group, and says what is true for pins: no bolt, backer or backing-plate row, the knee is on two pins', () => {
    expect(mount.id).toBe('brake-mount');
    expect(mount.group).toBe('Structure');
    expect(mount.label).toMatch(/pin/i);
    expect(mount.label).not.toMatch(/bolt|backer/i);
    expect(mount.refs).toContain('D-78');
    for (const d of mount.details!) expect(d.name, d.name).not.toMatch(/mounting bolt|nut backing plate|head washer|bolt bearing|bolt tear-out/i);
    expect(mount.how).toMatch(/NO bolts, backer or backing plate/);
    expect(mount.how).toMatch(/placeholder/i);
    expect(mount.how).toMatch(/TIGHTEST KNEE DETAIL/);
  });

  it('the pin loads are the elastic two-pin group: equilibrium, then within 1 % of the hand solve; about 124 and 87 lbf at the goal rider (the study: 125 and 87)', () => {
    const Tr = det(csP, 'brake-mount', 'pin T lateral load').value, Br = det(csP, 'brake-mount', 'pin B lateral load').value;
    close(Tr, hp.Tmag);
    close(Br, hp.Bmag);
    // equilibrium of the hand solution: the pin forces on the knee balance -R, and the moments about the pivot vanish
    close(hp.FT[0] + hp.FB[0], -goal.Rk[0], 1e-9);
    close(hp.FT[1] + hp.FB[1], -goal.Rk[1], 1e-9);
    expect(Tr).toBeGreaterThan(120);
    expect(Tr).toBeLessThan(130);
    expect(Br).toBeGreaterThan(84);
    expect(Br).toBeLessThan(90);
  });

  it('pin T capacity: Z\' within 1 % of the hand-written NDS modes (box rib stack + 1 in tab at the load angle), utilization about 0.67, in the study\'s 0.62 to 0.89 band', () => {
    const th = Math.atan2(Math.abs(hp.FT[0]), Math.abs(hp.FT[1])) / RAD; // angle to the vertical grain
    const hull = pn.hull.filler + pn.hull.rib;
    const Z = handZ(sOd, hull, pn.tab.t, Fe(th), Fe(th), Fyb, th) * wetC;
    const d = det(csP, 'brake-mount', 'pin T lateral load');
    close(d.limit, Z);
    close(d.util, hp.Tmag / Z);
    expect(d.util).toBeGreaterThan(0.55);
    expect(d.util).toBeLessThan(0.9);
    expect(d.name).toMatch(/mode II/);
  });

  it('pin B capacity: knee leg in end grain (load across the grain, C_eg 0.67) and the rail at the load angle; utilization about 0.57 (0.39 without C_eg: the study\'s 0.33 to 0.55 had no C_eg)', () => {
    const thRail = Math.atan2(Math.abs(hp.FB[1]), Math.abs(hp.FB[0])) / RAD;
    const thMax = Math.max(90, thRail);
    const Z = handZ(sOd, g.knee.legT, pn.hull.rail, Fe(90), Fe(thRail), Fyb, thMax) * wetC * 0.67;
    const d = det(csP, 'brake-mount', 'pin B lateral load');
    close(d.limit, Z);
    close(d.util, hp.Bmag / Z);
    expect(d.util).toBeGreaterThan(0.45);
    expect(d.util).toBeLessThan(0.7);
    expect(d.name).toMatch(/end grain, C_eg 0\.67/);
    expect(g.knee.layers.find((q) => pn.B.x >= q.x0 && pn.B.x <= q.x1)!.grain).toBe('y');
  });

  it('steel, bearing and retention rows by hand', () => {
    const A = (Math.PI / 4) * pn.dia ** 2;
    close(det(csP, 'brake-mount', 'pin steel single shear').value, Math.max(hp.Tmag, hp.Bmag) / A);
    close(det(csP, 'brake-mount', 'pin steel single shear').limit, (0.577 * pp.ss316BoltYieldPsi) / pp.steelSafetyFactor);
    close(det(csP, 'brake-mount', 'oak bearing under the sleeve at pin T').value, hp.Tmag / (sOd * Math.min(pn.tab.t, pn.hull.filler + pn.hull.rib)));
    close(det(csP, 'brake-mount', 'oak bearing under the sleeve at pin B in the rail').value, hp.Bmag / (sOd * pn.hull.rail));
    close(det(csP, 'brake-mount', 'oak bearing under the sleeve at pin B in the knee leg').limit, al.oakDowel);
    close(det(csP, 'brake-mount', 'oak bearing under the sleeve at pin B in the knee leg').value, hp.Bmag / (sOd * g.knee.legT * 0.67));
    // retention: prying about the tab's lowest contact on the web, yaw about the tab's rear edge, the amplified sideways push
    const e = g.y.wheel - g.y.face;
    const pry = (Math.abs(goal.Rk[1]) * e) / (pn.tab.bearing.z0 - pn.B.z);
    const k = (Math.abs(goal.Rk[0]) * e) / ((pn.T.x - pn.tab.x0) ** 2 + (pn.B.x - pn.tab.x0) ** 2);
    const xNose = g.H[0] + pp.brakePivotEndIn, P = (pp.brakeFlapSideLoadLbf * (xNose - g.F[0])) / Math.max(0.25, xNose - g.knee.x0);
    const xs = (g.strap.x0 + g.strap.x1) / 2, fT = (pn.B.x - xs) / (pn.B.x - pn.T.x);
    const pullT = k * (pn.T.x - pn.tab.x0) + P * fT, pullB = pry + k * (pn.B.x - pn.tab.x0) + P * (1 - fT);
    close(det(csP, 'brake-mount', 'pin T pull-out').value, pullT);
    close(det(csP, 'brake-mount', 'pin B pull-out').value, pullB);
    expect(det(csP, 'brake-mount', 'pin B pull-out').limit).toBe(pp.brakePinRetentionLbf);
    expect(pullB).toBeGreaterThan(pullT);
  });

  it('tab glue uses the REAL patch area (2.01 in2, the tab-on-knee patch of the model); the eccentric patch rows follow from the pin height over the patch', () => {
    const d = det(csP, 'brake-mount', 'tab glue patch (the real');
    const A = pn.tab.glueArea;
    expect(A).toBeCloseTo(2.01, 1);
    close(d.value, Math.hypot(hp.FT[0], hp.FT[1]) / A);
    close(d.limit, al.oakShear * 0.25);
    const ph = pn.tab.patch, h = ph.z1 - ph.z0, w = A / h, zc = ph.zc;
    const M = Math.abs((pn.T.x - pn.tab.x1) * hp.FT[1] - (pn.T.z - zc) * hp.FT[0]);
    close(det(csP, 'brake-mount', 'peak compression on the knee').value, hp.FT[0] / A + M / ((w * h * h) / 6));
    close(det(csP, 'brake-mount', 'peak tension across the glue line').value, M / ((w * h * h) / 6) - hp.FT[0] / A);
  });

  it('the thin wall at pin B is stated plainly, with the numbers: 0.10 in of oak either side of the sleeve in the middle ACROSS layer', () => {
    const layer = g.knee.layers.find((q) => pn.B.x >= q.x0 && pn.B.x <= q.x1)!;
    const wall = (layer.x1 - layer.x0 - sOd) / 2;
    expect(wall).toBeGreaterThan(0.09);
    expect(wall).toBeLessThan(0.12);
    const d = det(csP, 'brake-mount', 'pin B thin wall: the sleeve');
    expect(d.name).toMatch(/0\.10"/);
    close(d.value, Math.abs(hp.FB[0]) / (sOd * g.knee.legT));
    expect(mount.how).toMatch(/only 0\.10" of oak between the sleeve and the glued UPRIGHT layers/);
    expect(mount.how).toMatch(/C_eg 0\.67/);
  });

  it('every row passes at the defaults after the Phase 1b model change (rib block 2 in, no pad, 4.1 in tab); the tightest are the box-rib splitting and the tab\'s splitting behind T', () => {
    const failing = mount.details!.filter((d) => d.util > 1);
    expect(failing.map((d) => d.name)).toEqual([]);
    expect(mount.status).toBe('pass');
    expect(mount.util!).toBeLessThan(0.9);
    const rib = det(csP, 'brake-mount', 'box rib at pin T (brake-rib): splitting');
    close(rib.limit, (2 / 3) * pp.oakNdsShearPsi * pp.ndsWetFactorShear * pp.brakePinLoadDurationFactor * (pn.hull.filler + pn.hull.rib) * (pn.rib.blockW / 2), 1e-9);
    expect(pn.rib.blockW).toBeCloseTo(2, 6);
    expect(rib.util).toBeGreaterThan(0.7);
    const web = det(csP, 'brake-mount', 'tab on the web over the rib block');
    expect(web.util).toBeLessThan(0.3);
    expect(mount.details!.some((d) => /pad on the web/.test(d.name))).toBe(false);
  });

  it('Standard and Extreme weather both produce the pins rows (the sleeve, pin and member numbers do not depend on the spec)', () => {
    for (const w of [WEATHER_SPEC.standard, WEATHER_SPEC.extreme]) {
      const cs = run({ ...pp, weatherSpec: w } as Params);
      const m = byId(cs, 'brake-mount');
      expect(m.details!.length).toBe(mount.details!.length);
      expect(m.how).toMatch(/ball-lock/);
      close(det(cs, 'brake-mount', 'pin T lateral load').value, hp.Tmag, 0.02);
    }
  });
});

describe('D-78 brake-abuse follows the pins mount', () => {
  it('reuses the pins rows at yield level: the same Z\' under the stomp loads, with the limits raised by the safety factor', () => {
    const ab = byId(csP, 'brake-abuse');
    const La = loadsFromFoot(ctx, g, pp.brakeFootAbuseLbf);
    const ha = handPins(La.Rk);
    const d = det(csP, 'brake-abuse', 'mount: pin T lateral load');
    close(d.value, ha.Tmag);
    const base = det(csP, 'brake-mount', 'pin T lateral load');
    expect(d.limit).toBeGreaterThan(base.limit); // Z' for the stomp's load angle, times the steel safety factor
    expect(ab.details!.some((x) => /^mount: /.test(x.name) && /mounting bolt/.test(x.name))).toBe(false);
    expect(ab.details!.filter((x) => /^mount: pin /.test(x.name)).length).toBeGreaterThan(5);
    // the stomp reverses the x part (the flap pushes the knee forward): the glue patch is in tension, the hinge is the knee's front edge
    expect(La.Rk[0]).toBeGreaterThan(0);
  });
  it('the bolted brake-abuse is unchanged: mount rows are the bolt rows', () => {
    expect(byId(csB, 'brake-abuse').details!.some((x) => /^mount: mounting bolt shear/.test(x.name))).toBe(true);
  });
});

describe('D-78 the box rib carries the top pin with the D-ring (lash-load, side-lateral)', () => {
  const sl = sideLateral(ctx);
  const pr = sl.pinRib!;
  it('exists only with pins, uses the 2 in block width (rib.blockW) for S and the 0.5 in sleeve hole for the net section', () => {
    expect(pr).toBeDefined();
    expect(pr.w).toBe(pn.rib.blockW);
    expect(pr.w).toBeCloseTo(2, 6);
    close(pr.S, (pr.w * pr.depth ** 2) / 6, 1e-12);
    close(pr.Snet, ((pr.w - pn.sleeveOd) * pr.depth ** 2) / 6, 1e-12);
    close(pr.zT, pn.T.z - ctx.L.deckTop, 1e-12);
  });
  it('the T-pin loads on the rib are the brake-mount pin T force (about 125 lbf in plane) and the axial pull (about 49 lbf)', () => {
    const hp = handPins(loadsAt(ctx, ctx.loads.goal, g).Rk);
    close(Math.hypot(pr.FTx, pr.FTz), hp.Tmag);
    expect(Math.hypot(pr.FTx, pr.FTz)).toBeGreaterThan(120);
    close(pr.pull, det(csP, 'brake-mount', 'pin T pull-out').value);
  });
  it('lash-load and side-lateral carry the sleeve-hole rows; the 2 in block keeps the sleeve hole well inside the limit', () => {
    const l = det(csP, 'lash-load', 'knee\'s top-pin sleeve hole');
    const s = det(csP, 'side-lateral', 'D-ring rating on the box rib');
    close(l.value, (pr.ribFRating * pr.lever) / pr.Snet);
    close(s.value, l.value, 1e-9);
    expect(l.limit).toBe(al.oakBend);
    expect(l.util).toBeLessThan(0.9);
    expect(det(csP, 'side-lateral', 'outward push + the knee\'s top-pin pull').util).toBeLessThan(1);
    expect(byId(csP, 'side-lateral').how).toMatch(/D-78 removable knee/);
    expect(byId(csP, 'lash-load').how).toMatch(/D-78 removable knee/);
  });
  it('the plain rib-bending number is unchanged (the shaft keeps the D-76 width; the pin block is a local widening)', () => {
    expect(det(csP, 'lash-load', 'rib bending at the rating').util).toBeCloseTo(det(csB, 'lash-load', 'rib bending at the rating').util, 6);
  });
});
