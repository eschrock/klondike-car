/**
 * D-78 (optional setting `kneeMount` = pins): the NUMBERS behind the removable brake knee on two sleeved ball-lock pins, kept apart from the check rows so they are hand-checkable and so the rib rows
 * (`lash-load`, `side-lateral`) can reuse them. Plain TS on `BrakeGeom` (model/brake-layout.ts) and a force on the knee; nothing here imports brake.ts (the row assembly, `pinMountEval`, lives there).
 *
 * Frame: +X forward, +Y left (outboard on the left side), +Z up, inches and pounds; pin sites in the (x, z) plane of one wheel. `Rk` is the force of the flap ON THE KNEE at the pivot pin.
 *   In plane: the knee is a rigid body held by the two pins; the pin reactions on it balance Rk. Elastic pin-group method (as the bolted `brake-mount`): each pin takes half the load (direct) and the
 *     moment of Rk about the pins' centroid is a couple of two equal and opposite twist forces, M / d, perpendicular to the line joining the pins.
 *   Out of plane (axial pull on the pins and the contact forces): a 3-D rigid-knee solve (`solveKnee`). The knee is a rigid body on two axial pin springs (tension only) and two unilateral contact
 *     patches (compression only): the knee LEG on the rail and the chine band, and the TAB on the web over the rib block. The loads are the flap's force at the pivot (acting `e` outboard of the hull face:
 *     prying about x and yaw about z), the in-plane pin reactions (acting at their y), and the sideways boot push on the foot, amplified as brake-pivot does, pushing OUT or IN at the strap. Sum F_y,
 *     M_x and M_z are balanced by minimizing the convex potential (Newton, backtracking). Contact choices (both patches, the leg only, the tab only) are each solved and the ENVELOPE is taken.
 */
import type { BrakeGeom, V2 } from '../model/brake-layout';

const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
const len = (a: V2) => Math.hypot(a[0], a[1]);

/** Elastic two-pin group: the reactions of pins T and B ON THE KNEE for a force `Rk` of the flap on the knee at the pivot. */
export function pinGroupForces(g: BrakeGeom, Rk: V2) {
  const pn = g.pins!;
  const T: V2 = [pn.T.x, pn.T.z], B: V2 = [pn.B.x, pn.B.z];
  const c: V2 = [(T[0] + B[0]) / 2, (T[1] + B[1]) / 2];
  const d = len([T[0] - B[0], T[1] - B[1]]);
  const u: V2 = [(T[0] - B[0]) / d, (T[1] - B[1]) / d]; // B to T
  const n: V2 = [-u[1], u[0]];
  const rH: V2 = [g.H[0] - c[0], g.H[1] - c[1]];
  const M = cross(rH, Rk); // moment of Rk about the pins' centroid (lbf in)
  const direct: V2 = [-Rk[0] / 2, -Rk[1] / 2];
  const twist = -M / d; // signed twist force on T along n (B gets the opposite)
  const FT: V2 = [direct[0] + twist * n[0], direct[1] + twist * n[1]];
  const FB: V2 = [direct[0] - twist * n[0], direct[1] - twist * n[1]];
  return { T, B, c, d, u, n, rH, M, direct, directMag: len(direct), twist, FT, FB, Tmag: len(FT), Bmag: len(FB) };
}

/** Angle (deg, 0 to 90) between a force in the (x, z) plane and the x axis (grain along x) or the z axis (grain along z). */
export const angleToX = (F: V2): number => (Math.atan2(Math.abs(F[1]), Math.abs(F[0])) * 180) / Math.PI;
export const angleToZ = (F: V2): number => (Math.atan2(Math.abs(F[0]), Math.abs(F[1])) * 180) / Math.PI;

/** The sideways boot push on the flap foot, amplified into a force at the strap as brake-pivot does: P = F_s (x_nose - x_foot) / engaged (lbf). */
export function sidePushLbf(p: { brakeFlapSideLoadLbf: number; brakePivotEndIn: number }, g: BrakeGeom): number {
  const xNose = g.H[0] + p.brakePivotEndIn, engaged = Math.max(0.25, xNose - g.knee.x0);
  return (p.brakeFlapSideLoadLbf * (xNose - g.F[0])) / engaged;
}


// ── 3-D rigid-knee solve ─────────────────────────────────────────────────────────────────────────────────────────

type V3 = [number, number, number];
interface Ld { F: V3; at: V3 }
interface Patch { x0: number; x1: number; z0: number; z1: number }

/** Sample points (x, z) of a patch on an n x n grid including its edges (a rigid contact bears on its edge lines). */
export function samples(pa: Patch, n = 8): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push([pa.x0 + (i * (pa.x1 - pa.x0)) / (n - 1), pa.z0 + (j * (pa.z1 - pa.z0)) / (n - 1)]);
  return out;
}

/**
 * Solve a rigid body on axial springs and unilateral contacts. y is measured outboard from the hull face. Normal displacement of a point (x, z): w = d - tx (z - zr) + tz (x - xr)
 * (+ = outboard). A pin at (x, z) is in tension kp max(0, w); a contact sample is pressed kc max(0, -w). Returns the pin tensions and the contact forces per sample.
 */
export function solveKnee(loads: Ld[], pins: V2[], legPts: V2[], tabPts: V2[], ref: V2) {
  const [xr, zr] = ref;
  const kp = 1000, kc = 1e5 / Math.max(1, Math.max(legPts.length, tabPts.length, 1));
  let Fy = 0, Mx = 0, Mz = 0;
  for (const { F, at } of loads) {
    Fy += F[1];
    Mx += at[1] * F[2] - (at[2] - zr) * F[1];
    Mz += (at[0] - xr) * F[1] - at[1] * F[0];
  }
  const items: Array<{ a: V3; k: number; sign: 1 | -1 }> = [
    ...pins.map(([x, z]) => ({ a: [1, -(z - zr), x - xr] as V3, k: kp, sign: 1 as const })),
    ...legPts.map(([x, z]) => ({ a: [1, -(z - zr), x - xr] as V3, k: kc, sign: -1 as const })),
    ...tabPts.map(([x, z]) => ({ a: [1, -(z - zr), x - xr] as V3, k: kc, sign: -1 as const })),
  ];
  const wOf = (u: V3, a: V3) => u[0] * a[0] + u[1] * a[1] + u[2] * a[2];
  const pot = (u: V3) => items.reduce((sum, it) => { const w = it.sign * wOf(u, it.a); return sum + (w > 0 ? 0.5 * it.k * w * w : 0); }, 0) - (Fy * u[0] + Mx * u[1] + Mz * u[2]);
  let u: V3 = [-1e-6, 0, 0];
  for (let it = 0; it < 200; it++) {
    const g: V3 = [-Fy, -Mx, -Mz];
    const H = [[1e-9, 0, 0], [0, 1e-9, 0], [0, 0, 1e-9]];
    for (const m of items) {
      const w = m.sign * wOf(u, m.a);
      if (w <= 0) continue;
      for (let i = 0; i < 3; i++) { g[i] += m.sign * m.k * w * m.a[i]; for (let j = 0; j < 3; j++) H[i][j] += m.k * m.a[i] * m.a[j]; }
    }
    // 3x3 solve by Cramer's rule
    const det = (M: number[][]) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D = det(H);
    const du: V3 = [0, 0, 0];
    for (let c = 0; c < 3; c++) { const Mc = H.map((r, i) => r.map((v, j) => (j === c ? -g[i] : v))); du[c] = det(Mc) / D; }
    let step = 1;
    const p0 = pot(u);
    while (step > 1e-6 && pot([u[0] + step * du[0], u[1] + step * du[1], u[2] + step * du[2]]) > p0 + 1e-12) step /= 2;
    u = [u[0] + step * du[0], u[1] + step * du[1], u[2] + step * du[2]];
    if (Math.hypot(step * du[0], step * du[1], step * du[2]) < 1e-12) break;
  }
  const force = (a: V3, k: number, sign: 1 | -1) => { const w = sign * wOf(u, a); return w > 0 ? k * w : 0; };
  const nPin = pins.length, nLeg = legPts.length;
  const pinT = items.slice(0, nPin).map((m) => force(m.a, m.k, m.sign));
  const leg = items.slice(nPin, nPin + nLeg).map((m) => force(m.a, m.k, m.sign));
  const tab = items.slice(nPin + nLeg).map((m) => force(m.a, m.k, m.sign));
  // equilibrium residuals (force y, moments x and z about the reference): external + pins (-T at the pins) + contacts (+c at the samples)
  let rFy = Fy, rMx = Mx, rMz = Mz;
  pins.forEach(([x, z], i) => { rFy -= pinT[i]; rMx += (z - zr) * pinT[i]; rMz -= (x - xr) * pinT[i]; });
  [...legPts.map((q, i) => ({ q, c: leg[i] })), ...tabPts.map((q, i) => ({ q, c: tab[i] }))].forEach(({ q, c }) => { rFy += c; rMx -= (q[1] - zr) * c; rMz += (q[0] - xr) * c; });
  return { pinT, leg, tab, u, resid: [rFy, rMx, rMz] as V3, ext: [Fy, Mx, Mz] as V3 };
}

export type ContactChoice = 'both' | 'leg' | 'tab';

/**
 * Axial pull on pins T and B (lbf), the contact forces and what the tab's glue patch carries, for a force `Rk` of the flap on the knee: the envelope of the contact choices and of the sideways push
 * out and in. All y are measured outboard from the hull face (the pivot is `e` out).
 */
export function pinPull(p: { brakeFlapSideLoadLbf: number; brakePivotEndIn: number }, g: BrakeGeom, Rk: V2) {
  const pn = g.pins!, tb = pn.tab, ph = tb.patch;
  const gp = pinGroupForces(g, Rk);
  const e = g.y.wheel - g.y.face;
  const P = sidePushLbf(p, g);
  const xs = (g.strap.x0 + g.strap.x1) / 2;
  const yT = (tb.yIn + tb.yOut) / 2 - g.y.face, yB = g.knee.legT / 2, yWeb = tb.yIn - g.y.face;
  const yPatch = (ph.y0 + ph.y1) / 2 - g.y.face;
  const legPatch: Patch = { x0: g.knee.x0, x1: g.knee.x1, z0: g.knee.zBot, z1: g.knee.zLeg };
  const tabPatchR: Patch = { x0: tb.bearing.x0, x1: tb.bearing.x1, z0: tb.bearing.z0, z1: tb.bearing.z1 };
  const legPts = samples(legPatch), tabPts = samples(tabPatchR);
  const ref: V2 = [(pn.T.x + pn.B.x) / 2, (pn.T.z + pn.B.z) / 2];
  const area = (pa: Patch) => (pa.x1 - pa.x0) * (pa.z1 - pa.z0);
  const A = ph.area, wy = Math.max(1e-6, ph.y1 - ph.y0), hz = Math.max(1e-6, ph.z1 - ph.z0);
  const Sz = (wy * hz * hz) / 6, Sy = (hz * wy * wy) / 6;
  const tabSec = { h: tb.z1 - tb.z0, t: tb.t };
  const scen: Array<{ contacts: ContactChoice; push: 1 | -1; T: number; B: number; leg: number; tab: number; tens: number; comp: number; shear: number; bendTab: number; Mx: number; Mz: number; My: number; N: number; Vy: number; Vz: number; pinTensions: number[]; resid: V3; ext: V3 }> = [];
  for (const contacts of ['both', 'leg', 'tab'] as ContactChoice[]) for (const push of [1, -1] as const) {
    const loads: Ld[] = [
      { F: [Rk[0], 0, Rk[1]], at: [g.H[0], e, g.H[1]] },
      { F: [gp.FT[0], 0, gp.FT[1]], at: [pn.T.x, yT, pn.T.z] },
      { F: [gp.FB[0], 0, gp.FB[1]], at: [pn.B.x, yB, pn.B.z] },
      { F: [0, push * P, 0], at: [xs, e, g.H[1]] },
    ];
    const sol = solveKnee(loads, [[pn.T.x, pn.T.z], [pn.B.x, pn.B.z]], contacts === 'tab' ? [] : legPts, contacts === 'leg' ? [] : tabPts, ref);
    const [Tt, Bt] = sol.pinT;
    const legSum = sol.leg.reduce((a, b) => a + b, 0), tabSum = sol.tab.reduce((a, b) => a + b, 0);
    // loads on the TAB: pin T in plane, its axial pull inward, the contacts on the web
    const onTab: Ld[] = [
      { F: [gp.FT[0], 0, gp.FT[1]], at: [pn.T.x, yT, pn.T.z] },
      { F: [0, -Tt, 0], at: [pn.T.x, yT, pn.T.z] },
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
    // the tab's own bending across the grain at its front face (about z, fibers along x): the y forces and the x force's y offset on the part behind it
    const yTabMid = (tb.yIn + tb.yOut) / 2 - g.y.face;
    const MzTab = Math.abs(sum((l) => (l.at[0] - tb.x1) * l.F[1] - (l.at[1] - yTabMid) * l.F[0]));
    scen.push({ contacts, push, T: Tt, B: Bt, leg: legSum, tab: tabSum, tens, comp, shear, bendTab: (MzTab * 6) / (tabSec.h * tabSec.t ** 2), Mx, Mz, My, N, Vy, Vz, pinTensions: sol.pinT, resid: sol.resid, ext: sol.ext });
  }
  const mx = (f: (s: (typeof scen)[number]) => number) => scen.reduce((a, s) => Math.max(a, f(s)), 0);
  const worst = (f: (s: (typeof scen)[number]) => number) => scen.reduce((a, s) => (f(s) > f(a) ? s : a), scen[0]);
  return {
    e, P, xs, Mpry: Math.abs(Rk[1]) * e, Myaw: Math.abs(Rk[0]) * e, gp, scen,
    T: mx((s) => s.T), B: mx((s) => s.B), legMax: mx((s) => s.leg), tabMax: mx((s) => s.tab),
    tens: mx((s) => s.tens), comp: mx((s) => s.comp), shear: mx((s) => s.shear), bendTab: mx((s) => s.bendTab),
    worstB: worst((s) => s.B), worstT: worst((s) => s.T), worstPatch: worst((s) => s.tens),
    legArea: area(legPatch), tabArea: area(tabPatchR), Sz, Sy,
  };
}

/**
 * The tab's glue patch under the IN-PLANE pin T force alone (the 3-D loads, with the contacts and the pin pull, are in `pinPull`): the patch `pins.tab.patch` (the real overlap of the tab and the knee)
 * carries it with an eccentric moment as well: normal stress N / A +/- M / S (N = the x part, compression when the pin pushes the knee forward), shear V / A (the z part).
 */
export function tabPatch(g: BrakeGeom, FT: V2) {
  const pn = g.pins!, ph = pn.tab.patch;
  const h = Math.max(1e-6, ph.z1 - ph.z0);
  const A = ph.area;
  const w = A / h;
  const zc = ph.zc;
  const S = (w * h * h) / 6;
  const r: V2 = [pn.T.x - pn.tab.x1, pn.T.z - zc];
  const M = Math.abs(cross(r, FT));
  const N = FT[0], V = Math.abs(FT[1]);
  const direct = N / A, bend = M / S;
  return { z0: ph.z0, z1: ph.z1, h, w, A, zc, S, r, M, N, V, direct, bend, sigMax: direct + bend, sigMin: direct - bend, tau: V / A, total: len(FT) / A, comp: Math.max(0, direct + bend), tens: Math.max(0, bend - direct) };
}
