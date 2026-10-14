/**
 * D-78 (optional setting `kneeMount` = removable): the NUMBERS behind the removable brake knee held by two CLAMPED, PRELOADED 3/8-16 stainless bolts (bottom: knee leg + rail; top: tab + web + filler + rib block) into flanged
 * threaded inserts in the hull. Plain TS on `BrakeGeom` (model/brake-layout.ts) and a force on the knee; nothing here imports brake.ts (the row assembly, `boltMountEval`, lives there).
 *
 * Frame: +X forward, +Y left (outboard on the left side), +Z up, inches and pounds. `Rk` is the force of the flap ON THE KNEE at the pivot pin.
 *   Preload: P = T / (K d) from the ratchet torque, capped by the weakest of the bolt's proof load, the oak under the head washer, the oak under the insert flange and the insert's thread pull-out.
 *   In plane: a rigid knee on the two bolts, elastic group (direct + twist) as the bolted `brake-mount`; the clamp carries it by friction mu x clamp force while the preload stays.
 *   Out of plane: a 3-D rigid-knee solve (`solveKnee`). Each bolt site is a PRELOADED TIE: the bolt pulls the knee in with P + k_b w, the clamped oak pushes it out with max(0, P - k_m w) (w = outward displacement
 *     there), so the joint stays closed while the external pull is below the preload and separates beyond it. Two unilateral contact patches (the knee leg on the rail and chine band; the tab on the web over the rib block)
 *     are added. The loads are the flap's force at the pivot (prying about x, yaw about z), the in-plane bolt forces at their y, and the sideways boot push (amplified as brake-pivot does) out and in; the envelope of the
 *     contact choices (both, leg only, tab only) is taken.
 */
import type { BoltSite, BrakeGeom, V2 } from '../model/brake-layout';
import { uncTensileArea } from './nds';

const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
const len = (a: V2) => Math.hypot(a[0], a[1]);

/** Elastic two-bolt group: the reactions of the top (T) and bottom (B) bolts ON THE KNEE for a force `Rk` of the flap on the knee at the pivot. */
export function clampGroupForces(g: BrakeGeom, Rk: V2) {
  const rm = g.removable!;
  const T: V2 = [rm.top.x, rm.top.z], B: V2 = [rm.bottom.x, rm.bottom.z];
  const c: V2 = [(T[0] + B[0]) / 2, (T[1] + B[1]) / 2];
  const d = len([T[0] - B[0], T[1] - B[1]]);
  const u: V2 = [(T[0] - B[0]) / d, (T[1] - B[1]) / d];
  const n: V2 = [-u[1], u[0]];
  const rH: V2 = [g.H[0] - c[0], g.H[1] - c[1]];
  const M = cross(rH, Rk);
  const direct: V2 = [-Rk[0] / 2, -Rk[1] / 2];
  const twist = -M / d;
  const FT: V2 = [direct[0] + twist * n[0], direct[1] + twist * n[1]];
  const FB: V2 = [direct[0] - twist * n[0], direct[1] - twist * n[1]];
  return { T, B, c, d, u, n, rH, M, direct, directMag: len(direct), twist, FT, FB, Tmag: len(FT), Bmag: len(FB) };
}

export const angleToX = (F: V2): number => (Math.atan2(Math.abs(F[1]), Math.abs(F[0])) * 180) / Math.PI;
export const angleToZ = (F: V2): number => (Math.atan2(Math.abs(F[0]), Math.abs(F[1])) * 180) / Math.PI;

/** The sideways boot push on the flap foot, amplified into a force at the strap as brake-pivot does: P = F_s (x_nose - x_foot) / engaged (lbf). */
export function sidePushLbf(p: { brakeFlapSideLoadLbf: number; brakePivotEndIn: number }, g: BrakeGeom): number {
  const xNose = g.H[0] + p.brakePivotEndIn, engaged = Math.max(0.25, xNose - g.knee.x0);
  return (p.brakeFlapSideLoadLbf * (xNose - g.F[0])) / engaged;
}

// ── preload ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface ClampParams {
  brakeBoltTorqueFtLb: number; brakeBoltNutFactor: number; brakeBoltPreloadMaxFrac: number; brakeInsertWithdrawalFactor: number;
  ss316BoltYieldPsi: number; oakSpecificGravity: number; ndsWetFactorFasteners: number; brakeStainlessModulusPsi: number; oakMoePerpPsi: number;
}
/** Allowable and crush stresses of the oak (psi) the preload and the in-service bearing checks use; the caller passes `allowables(ctx)` and the strength factors. */
export interface OakBearing {
  /** Design (with the safety factor) compression across the grain, and along the grain. */
  perp: number; par: number;
  /** Crush level (wet, NO safety factor) across and along the grain: the transient limit for preload plus pull. */
  perpCrush: number; parCrush: number;
}

export interface BoltPreload {
  /** The preload (lbf) = the smallest of the limits, which one governs, and every limit. */
  P: number; governs: string;
  limits: { torque: number; proof: number; washer: number; flange: number; insert: number };
  /** Washer and flange ring areas (in^2), the washer's end-grain share of oak (0 to 1), insert thread pull-out (lbf), the bolt and joint stiffness (lbf/in). */
  washerArea: number; flangeArea: number; syWasher: number; insertPull: number; kb: number; km: number; At: number; washerCrush: number; flangeCrush: number;
}

/** Preload of one bolt site. `syWasher` = the share of the washer's footprint that lies on end grain (the knee's ACROSS layer under the bottom washer; 0 under the tab). */
export function boltPreload(p: ClampParams, site: BoltSite, clearHole: number, dia: number, oak: OakBearing, syWasher: number): BoltPreload {
  const At = uncTensileArea(dia);
  const torque = (p.brakeBoltTorqueFtLb * 12) / (p.brakeBoltNutFactor * dia);
  const proof = p.brakeBoltPreloadMaxFrac * p.ss316BoltYieldPsi * At;
  const washerArea = (Math.PI / 4) * (site.washer.od ** 2 - clearHole ** 2);
  const washerPress = syWasher * oak.par + (1 - syWasher) * oak.perp;
  const washerCrush = syWasher * oak.parCrush + (1 - syWasher) * oak.perpCrush;
  const flangeArea = (Math.PI / 4) * (site.insert.flangeOd ** 2 - site.insert.od ** 2);
  const insertPull = 1800 * p.oakSpecificGravity ** 1.5 * site.insert.od ** 0.75 * site.insert.len * p.ndsWetFactorFasteners * p.brakeInsertWithdrawalFactor;
  const limits = { torque, proof, washer: washerArea * washerPress, flange: flangeArea * oak.perp, insert: insertPull };
  const names: Record<string, string> = { torque: 'the ratchet torque (P = T / K d)', proof: 'the bolt proof load', washer: 'the oak under the head washer', flange: 'the oak under the insert flange', insert: 'the insert thread pull-out' };
  const key = (Object.keys(limits) as Array<keyof typeof limits>).reduce((a, b) => (limits[b] < limits[a] ? b : a));
  // bolt stiffness (shank over the grip) and joint stiffness (oak across the grain over a cone about the washer, grip = washer + stack)
  const grip = site.washer.t + site.stack;
  const kb = (p.brakeStainlessModulusPsi * (Math.PI / 4) * dia ** 2) / grip;
  const aEff = (Math.PI / 4) * ((site.washer.od + 0.5 * site.stack) ** 2 - clearHole ** 2);
  const km = (p.oakMoePerpPsi * aEff) / site.stack;
  return { P: limits[key], governs: names[key], limits, washerArea, flangeArea, syWasher, insertPull, kb, km, At, washerCrush, flangeCrush: oak.perpCrush };
}

// ── 3-D rigid-knee solve with preloaded ties ─────────────────────────────────────────────────────────────────

type V3 = [number, number, number];
interface Ld { F: V3; at: V3 }
interface Patch { x0: number; x1: number; z0: number; z1: number }

/** Sample points (x, z) of a patch on an n x n grid including its edges (a rigid contact bears on its edge lines). */
export function samples(pa: Patch, n = 8): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push([pa.x0 + (i * (pa.x1 - pa.x0)) / (n - 1), pa.z0 + (j * (pa.z1 - pa.z0)) / (n - 1)]);
  return out;
}

export interface TieSite { x: number; z: number; P: number; kb: number; km: number }

/**
 * Solve a rigid body on preloaded bolt ties and unilateral contacts. y is measured outboard from the hull face. Outward displacement of a point (x, z): w = d - tx (z - zr) + tz (x - xr).
 * A tie at a bolt: bolt tension F_b = max(0, P + k_b w) pulls the knee in, the clamped oak pushes it out with c = max(0, P - k_m w); the force on the knee is c - F_b. A contact sample is pressed kc max(0, -w).
 * Returns the bolt tensions, clamp forces and displacements, the contact forces per sample and the equilibrium residuals.
 */
export function solveKnee(loads: Ld[], ties: TieSite[], legPts: V2[], tabPts: V2[], ref: V2) {
  const [xr, zr] = ref;
  const kc = 1e5 / Math.max(1, Math.max(legPts.length, tabPts.length, 1));
  let Fy = 0, Mx = 0, Mz = 0;
  for (const { F, at } of loads) {
    Fy += F[1];
    Mx += at[1] * F[2] - (at[2] - zr) * F[1];
    Mz += (at[0] - xr) * F[1] - at[1] * F[0];
  }
  type Item = { a: V3; f: (w: number) => number; df: (w: number) => number };
  const arm = (x: number, z: number): V3 => [1, -(z - zr), x - xr];
  const items: Item[] = [
    ...ties.map((t): Item => ({
      a: arm(t.x, t.z),
      f: (w) => Math.max(0, t.P - t.km * w) - Math.max(0, t.P + t.kb * w),
      df: (w) => -(t.P - t.km * w > 0 ? t.km : 0) - (t.P + t.kb * w > 0 ? t.kb : 0),
    })),
    ...[...legPts, ...tabPts].map(([x, z]): Item => ({ a: arm(x, z), f: (w) => kc * Math.max(0, -w), df: (w) => (w < 0 ? -kc : 0) })),
  ];
  const wOf = (u: V3, a: V3) => u[0] * a[0] + u[1] * a[1] + u[2] * a[2];
  const resid = (u: V3): V3 => { const r: V3 = [Fy, Mx, Mz]; for (const it of items) { const f = it.f(wOf(u, it.a)); for (let i = 0; i < 3; i++) r[i] += f * it.a[i]; } return r; };
  const norm = (r: V3) => Math.hypot(r[0], r[1], r[2]);
  const det = (M: number[][]) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  let u: V3 = [0, 0, 0];
  for (let it = 0; it < 300; it++) {
    const r = resid(u);
    if (norm(r) < 1e-9) break;
    const J = [[1e-9, 0, 0], [0, 1e-9, 0], [0, 0, 1e-9]];
    for (const m of items) { const d = m.df(wOf(u, m.a)); if (d === 0) continue; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) J[i][j] -= d * m.a[i] * m.a[j]; }
    // J here is -dr/du (positive definite): du = J^-1 r
    const D = det(J);
    const du: V3 = [0, 0, 0];
    for (let c = 0; c < 3; c++) { const Mc = J.map((row, i) => row.map((v, j) => (j === c ? r[i] : v))); du[c] = det(Mc) / D; }
    let step = 1;
    const r0 = norm(r);
    while (step > 1e-8 && norm(resid([u[0] + step * du[0], u[1] + step * du[1], u[2] + step * du[2]])) > r0 * (1 - 1e-4 * step)) step /= 2;
    u = [u[0] + step * du[0], u[1] + step * du[1], u[2] + step * du[2]];
    if (Math.hypot(step * du[0], step * du[1], step * du[2]) < 1e-14) break;
  }
  const nTie = ties.length, nLeg = legPts.length;
  const ws = items.map((m) => wOf(u, m.a));
  const bolt = ties.map((t, i) => Math.max(0, t.P + t.kb * ws[i]));
  const clamp = ties.map((t, i) => Math.max(0, t.P - t.km * ws[i]));
  const wTie = ws.slice(0, nTie);
  const leg = ws.slice(nTie, nTie + nLeg).map((w) => kc * Math.max(0, -w));
  const tab = ws.slice(nTie + nLeg).map((w) => kc * Math.max(0, -w));
  return { bolt, clamp, wTie, leg, tab, u, resid: resid(u), ext: [Fy, Mx, Mz] as V3 };
}

export type ContactChoice = 'both' | 'leg' | 'tab';

/**
 * The out-of-plane solve for a force `Rk` of the flap on the knee: bolt tensions and clamp forces at both bolts, the joint-separation ratio (k_m w / P: 1 = the clamp is gone), the contact forces and the loads on the
 * tab's glue patch, as the envelope of the contact choices and of the sideways push out and in.
 */
export function clampSolve(p: { brakeFlapSideLoadLbf: number; brakePivotEndIn: number }, g: BrakeGeom, Rk: V2, pre: { top: BoltPreload; bottom: BoltPreload }) {
  const rm = g.removable!, tb = rm.tab, ph = tb.patch;
  const gp = clampGroupForces(g, Rk);
  const e = g.y.wheel - g.y.face;
  const P = sidePushLbf(p, g);
  const xs = (g.strap.x0 + g.strap.x1) / 2;
  const yT = (tb.yIn + tb.yOut) / 2 - g.y.face, yB = g.knee.legT / 2, yWeb = tb.yIn - g.y.face;
  const yPatch = (ph.y0 + ph.y1) / 2 - g.y.face;
  const legPatch: Patch = { x0: g.knee.x0, x1: g.knee.x1, z0: g.knee.zBot, z1: g.knee.zLeg };
  const tabPatchR: Patch = { x0: tb.bearing.x0, x1: tb.bearing.x1, z0: tb.bearing.z0, z1: tb.bearing.z1 };
  const legPts = samples(legPatch), tabPts = samples(tabPatchR);
  const ref: V2 = [(rm.top.x + rm.bottom.x) / 2, (rm.top.z + rm.bottom.z) / 2];
  const area = (pa: Patch) => (pa.x1 - pa.x0) * (pa.z1 - pa.z0);
  const A = ph.area, wy = Math.max(1e-6, ph.y1 - ph.y0), hz = Math.max(1e-6, ph.z1 - ph.z0);
  const Sz = (wy * hz * hz) / 6, Sy = (hz * wy * wy) / 6;
  const tabSec = { h: tb.z1 - tb.z0, t: tb.t };
  const ties: TieSite[] = [
    { x: rm.top.x, z: rm.top.z, P: pre.top.P, kb: pre.top.kb, km: pre.top.km },
    { x: rm.bottom.x, z: rm.bottom.z, P: pre.bottom.P, kb: pre.bottom.kb, km: pre.bottom.km },
  ];
  interface Scen { contacts: ContactChoice; push: 1 | -1; Ft: number; Fb: number; ct: number; cb: number; sepT: number; sepB: number; pullT: number; pullB: number; leg: number; tab: number; tens: number; comp: number; shear: number; bendTab: number; N: number; Vy: number; Vz: number; resid: V3; ext: V3 }
  const scen: Scen[] = [];
  for (const contacts of ['both', 'leg', 'tab'] as ContactChoice[]) for (const push of [1, -1] as const) {
    const loads: Ld[] = [
      { F: [Rk[0], 0, Rk[1]], at: [g.H[0], e, g.H[1]] },
      { F: [gp.FT[0], 0, gp.FT[1]], at: [rm.top.x, yT, rm.top.z] },
      { F: [gp.FB[0], 0, gp.FB[1]], at: [rm.bottom.x, yB, rm.bottom.z] },
      { F: [0, push * P, 0], at: [xs, e, g.H[1]] },
    ];
    const sol = solveKnee(loads, ties, contacts === 'tab' ? [] : legPts, contacts === 'leg' ? [] : tabPts, ref);
    const [Ft, Fb] = sol.bolt, [ct, cb] = sol.clamp;
    const sepT = (ties[0].km * sol.wTie[0]) / ties[0].P, sepB = (ties[1].km * sol.wTie[1]) / ties[1].P;
    const legSum = sol.leg.reduce((a, b) => a + b, 0), tabSum = sol.tab.reduce((a, b) => a + b, 0);
    // loads on the TAB: the top bolt's in-plane force, its tension pulling the tab in, the clamp and the contacts pushing it out
    const onTab: Ld[] = [
      { F: [gp.FT[0], 0, gp.FT[1]], at: [rm.top.x, yT, rm.top.z] },
      { F: [0, ct - Ft, 0], at: [rm.top.x, yT, rm.top.z] },
      ...tabPts.map((q, i): Ld => ({ F: [0, sol.tab[i] ?? 0, 0], at: [q[0], yWeb, q[1]] })).filter((l) => l.F[1] > 0),
    ];
    const sum = (f: (l: Ld) => number) => onTab.reduce((a, l) => a + f(l), 0);
    const N = sum((l) => l.F[0]), Vy = sum((l) => l.F[1]), Vz = sum((l) => l.F[2]);
    const My = sum((l) => (l.at[2] - ph.zc) * l.F[0] - (l.at[0] - tb.x1) * l.F[2]);
    const Mz = sum((l) => (l.at[0] - tb.x1) * l.F[1] - (l.at[1] - yPatch) * l.F[0]);
    const Mx = sum((l) => (l.at[1] - yPatch) * l.F[2] - (l.at[2] - ph.zc) * l.F[1]);
    const tens = Math.max(0, -N / A + Math.abs(My) / Sz + Math.abs(Mz) / Sy);
    const comp = Math.max(0, N / A + Math.abs(My) / Sz + Math.abs(Mz) / Sy);
    const shear = Math.hypot(Vy, Vz) / A + (Math.abs(Mx) * (3 * Math.max(hz, wy) + 1.8 * Math.min(hz, wy))) / (Math.max(hz, wy) ** 2 * Math.min(hz, wy) ** 2);
    const yTabMid = (tb.yIn + tb.yOut) / 2 - g.y.face;
    const MzTab = Math.abs(sum((l) => (l.at[0] - tb.x1) * l.F[1] - (l.at[1] - yTabMid) * l.F[0]));
    scen.push({ contacts, push, Ft, Fb, ct, cb, sepT, sepB, pullT: Ft - ct, pullB: Fb - cb, leg: legSum, tab: tabSum, tens, comp, shear, bendTab: (MzTab * 6) / (tabSec.h * tabSec.t ** 2), N, Vy, Vz, resid: sol.resid, ext: sol.ext });
  }
  const mx = (f: (s: Scen) => number) => scen.reduce((a, s) => Math.max(a, f(s)), 0);
  const mn = (f: (s: Scen) => number) => scen.reduce((a, s) => Math.min(a, f(s)), Infinity);
  const worst = (f: (s: Scen) => number) => scen.reduce((a, s) => (f(s) > f(a) ? s : a), scen[0]);
  return {
    e, P, xs, Mpry: Math.abs(Rk[1]) * e, Myaw: Math.abs(Rk[0]) * e, gp, scen,
    FbT: mx((s) => s.Ft), FbB: mx((s) => s.Fb), clampT: mn((s) => s.ct), clampB: mn((s) => s.cb), sepT: mx((s) => s.sepT), sepB: mx((s) => s.sepB),
    pullT: mx((s) => s.pullT), pullB: mx((s) => s.pullB),
    legMax: mx((s) => s.leg), tabMax: mx((s) => s.tab), tens: mx((s) => s.tens), comp: mx((s) => s.comp), shear: mx((s) => s.shear), bendTab: mx((s) => s.bendTab),
    worstB: worst((s) => s.Fb), worstT: worst((s) => s.Ft), worstPatch: worst((s) => s.tens),
    legArea: area(legPatch), tabArea: area(tabPatchR), Sz, Sy,
  };
}

/** The tab's glue patch under the IN-PLANE top-bolt force alone (the 3-D loads, with the clamp, the contacts and the bolt pull, are in `clampSolve`). */
export function tabPatch(g: BrakeGeom, FT: V2) {
  const rm = g.removable!, ph = rm.tab.patch;
  const h = Math.max(1e-6, ph.z1 - ph.z0);
  const A = ph.area;
  const w = A / h;
  const zc = ph.zc;
  const S = (w * h * h) / 6;
  const r: V2 = [rm.top.x - rm.tab.x1, rm.top.z - zc];
  const M = Math.abs(cross(r, FT));
  const N = FT[0], V = Math.abs(FT[1]);
  const direct = N / A, bend = M / S;
  return { z0: ph.z0, z1: ph.z1, h, w, A, zc, S, r, M, N, V, direct, bend, sigMax: direct + bend, sigMin: direct - bend, tau: V / A, total: len(FT) / A, comp: Math.max(0, direct + bend), tens: Math.max(0, bend - direct) };
}
