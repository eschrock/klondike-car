/**
 * D-78 (optional setting `kneeMount` = pins): the NUMBERS behind the removable brake knee on two sleeved ball-lock pins, kept apart from the check rows so they are hand-checkable and so the rib rows
 * (`lash-load`, `side-lateral`) can reuse them. Plain TS on `BrakeGeom` (model/brake-layout.ts) and a force on the knee; nothing here imports brake.ts (the row assembly, `pinMountEval`, lives there).
 *
 * Frame: +X forward, +Y left (outboard on the left side), +Z up, inches and pounds; pin sites in the (x, z) plane of one wheel. `Rk` is the force of the flap ON THE KNEE at the pivot pin.
 *   In plane: the knee is a rigid body held by the two pins; the pin reactions on it balance Rk. Elastic pin-group method (as the bolted `brake-mount`): each pin takes half the load (direct) and the
 *     moment of Rk about the pins' centroid is a couple of two equal and opposite twist forces, M / d, perpendicular to the line joining the pins.
 *   Out of plane (axial pull on the pins): the force acts `e` outboard of the hull face. Its z part pries the knee about the TOP of the pad (the pad fills the web recess, so the knee leans on the
 *     web up high): the lower pin B pulls M_x / (z_pad_top - z_B); pin T sits level with that top and the tab lies flat on the web, so T takes none. Its x part yaws the knee about a vertical axis
 *     through the tab's rear edge (back load) or the knee's front edge (forward load, the stomp): the pins pull in proportion to their distance from it. The sideways boot push on the flap foot,
 *     amplified as brake-pivot does, pulls outward at the strap and is shared by the two pins by x (a statically determinate split).
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

/** Axial pull on pins T and B (lbf) for a force `Rk` of the flap on the knee: prying + yaw + the sideways push, all added (the worst case: same sign, at the same time). */
export function pinPull(p: { brakeFlapSideLoadLbf: number; brakePivotEndIn: number }, g: BrakeGeom, Rk: V2) {
  const pn = g.pins!;
  const e = g.y.wheel - g.y.face;
  const zContact = pn.tab.bearing.z0; // the lowest contact of the tab on the web (backed by the rib block): the prying hinge
  const Mx = Math.abs(Rk[1]) * e;
  const armB = Math.max(1e-6, zContact - pn.B.z);
  const pryB = Mx / armB;
  const Mz = Math.abs(Rk[0]) * e;
  const back = Rk[0] <= 0; // the flap pulls the knee back: it yaws about the tab's rear edge; a forward force (the stomp) about the knee's front edge
  const xHinge = back ? pn.tab.x0 : g.knee.x1;
  const dT = Math.abs(pn.T.x - xHinge), dB = Math.abs(pn.B.x - xHinge);
  const k = Mz / Math.max(1e-9, dT * dT + dB * dB);
  const yawT = k * dT, yawB = k * dB;
  const P = sidePushLbf(p, g);
  const xs = (g.strap.x0 + g.strap.x1) / 2;
  const fracT = Math.min(1, Math.max(0, (pn.B.x - xs) / Math.max(1e-9, pn.B.x - pn.T.x)));
  const pushT = P * fracT, pushB = P - pushT;
  const T = yawT + pushT, B = pryB + yawB + pushB;
  // The knee presses on the web with the sum of the pulls at its hinge lines (equilibrium): at the pad top (prying) and along the tab's rear edge or the knee front (yaw).
  const cPad = pryB, cYaw = yawT + yawB;
  return { e, zContact, Mx, armB, pryB, Mz, back, xHinge, dT, dB, yawT, yawB, P, xs, fracT, pushT, pushB, T, B, cPad, cYaw };
}

/**
 * The tab's glue patch on the knee's rear face (`pins.tab.patch`, the REAL overlap of the tab and the knee). Pin T's force acts at the pin, `r` from the patch centroid, so the patch carries it with an
 * eccentric moment as well: normal stress N / A +/- M / S (N = the x part, compression when the pin pushes the knee forward), shear V / A (the z part).
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
