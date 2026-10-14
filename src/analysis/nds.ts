/**
 * NDS-style timber-connection helpers (Phase 3 round 2, D-43): dowel bearing strength, single-shear yield-mode capacity of a
 * bolt through a steel side plate into oak, row / group tear-out (NDS Appendix E), the cleavage (splitting) shear of a
 * connection loaded perpendicular to grain (NDS 3.4.3.3), and the bolt spacing / edge / end distance rules (NDS 12.5.1).
 * Plain numbers in, plain numbers out; every strength comes from Params (src/params.ts), nothing is hard-coded here except the
 * published NDS coefficients (the 6100, 11200 and 1.45 of Table 12.3.3, the Rd constants of Table 12.3.1B).
 *
 * References checked while writing: the Appendix E row tear-out and group tear-out forms (Z'RT = n_i·F'v·t·s_critical;
 * Z'GT = ½Z'RT1 + ½Z'RT2 + F't·A_group-net). The 3.4.3.3 cleavage form is used as V_r = (2/3)·F'v·b·d_e with d_e the
 * distance from the nearest fastener to the loaded edge; the caller designs mechanical reinforcement for the whole V regardless,
 * so the exact factor on d_e/d does not govern any pass / fail result (see the caster-mount row).
 */

/** Dowel bearing strength parallel to grain, Fe∥ = 11,200·G (NDS Table 12.3.3), psi. */
export const feParallel = (G: number): number => 11200 * G;

/** Dowel bearing strength perpendicular to grain for D ≥ ¼", Fe⊥ = 6,100·G^1.45 / √D (NDS Table 12.3.3), psi. D in inches. */
export const fePerp = (G: number, D: number): number => (6100 * G ** 1.45) / Math.sqrt(D);

/** Hankinson interpolation at θ degrees between the load and the grain (NDS 12.3.3.? / Eq. 12.3-1): Fe∥·Fe⊥ / (Fe∥·sin²θ + Fe⊥·cos²θ). */
export function feAtAngle(fePar: number, feNorm: number, thetaDeg: number): number {
  const t = (thetaDeg * Math.PI) / 180;
  return (fePar * feNorm) / (fePar * Math.sin(t) ** 2 + feNorm * Math.cos(t) ** 2);
}

/** Kθ = 1 + 0.25·(θ/90), θ the angle between the load and the grain (NDS Table 12.3.1B). */
export const kTheta = (thetaDeg: number): number => 1 + 0.25 * (thetaDeg / 90);

/** Reduction terms Rd of NDS Table 12.3.1B for ¼" ≤ D ≤ 1": Im, Is = 4Kθ; II = 3.6Kθ; IIIm, IIIs, IV = 3.2Kθ. */
export function rdFactors(thetaDeg: number): { Im: number; Is: number; II: number; IIIm: number; IIIs: number; IV: number } {
  const k = kTheta(thetaDeg);
  return { Im: 4 * k, Is: 4 * k, II: 3.6 * k, IIIm: 3.2 * k, IIIs: 3.2 * k, IV: 3.2 * k };
}

export interface LateralInput {
  /** Bolt diameter (in), main-member (oak) thickness l_m and steel side-plate thickness l_s (in). */
  D: number;
  lm: number;
  ls: number;
  /** Dowel bearing strengths of the oak (at this load angle) and the steel plate, bolt bending yield, psi. */
  Fem: number;
  Fes: number;
  Fyb: number;
  /** Angle between the load and the oak grain, degrees. */
  thetaDeg: number;
}

export interface LateralResult { Z: number; mode: string; modes: Record<string, number> }

/**
 * Reference lateral design value Z (lbf, one bolt, single shear, steel side plate on a wood main member) = min of the NDS
 * yield modes Im, Is, IIIs and IV (Table 12.3.1A; II and IIIm need a thick side member and are not applicable to a plate).
 *   Im  = D·l_m·Fem / Rd
 *   Is  = D·l_s·Fes / Rd
 *   IIIs= k3·D·l_s·Fem / ((2 + Re)·Rd),   k3 = −1 + √(2(1+Re)/Re + 2·Fyb(2+Re)·D² / (3·Fem·l_s²)),  Re = Fem/Fes
 *   IV  = D²/Rd · √(2·Fem·Fyb / (3(1+Re)))
 */
export function lateralZ(i: LateralInput): LateralResult {
  const { D, lm, ls, Fem, Fes, Fyb, thetaDeg } = i;
  const rd = rdFactors(thetaDeg);
  const Re = Fem / Fes;
  const k3 = -1 + Math.sqrt((2 * (1 + Re)) / Re + (2 * Fyb * (2 + Re) * D * D) / (3 * Fem * ls * ls));
  const modes = {
    Im: (D * lm * Fem) / rd.Im,
    Is: (D * ls * Fes) / rd.Is,
    IIIs: (k3 * D * ls * Fem) / ((2 + Re) * rd.IIIs),
    IV: ((D * D) / rd.IV) * Math.sqrt((2 * Fem * Fyb) / (3 * (1 + Re))),
  };
  let mode = 'Im';
  let Z = Infinity;
  for (const [m, v] of Object.entries(modes)) if (v < Z) { Z = v; mode = m; }
  return { Z, mode, modes };
}

export interface WoodLateralInput {
  /** Bolt diameter (in), side-member thickness l_s and main-member thickness l_m (in), dowel bearing strengths of the two members (psi), bolt bending yield (psi), load angle to the grain (deg). */
  D: number;
  ls: number;
  lm: number;
  Fes: number;
  Fem: number;
  Fyb: number;
  thetaDeg: number;
}

/**
 * Reference lateral design value Z (lbf, one bolt, single shear, WOOD side member on a WOOD main member) = min of all six NDS yield modes (Table 12.3.1A):
 *   Im = D·l_m·Fem/Rd;  Is = D·l_s·Fes/Rd;  II = k1·D·l_s·Fes/Rd
 *   IIIm = k2·D·l_m·Fem/((1+2Re)·Rd);  IIIs = k3·D·l_s·Fem/((2+Re)·Rd);  IV = D²/Rd·√(2·Fem·Fyb/(3(1+Re)))
 *   Re = Fem/Fes, Rt = l_m/l_s, k1 = (√(Re + 2Re²(1+Rt+Rt²) + Rt²Re³) − Re(1+Rt))/(1+Re),
 *   k2 = −1 + √(2(1+Re) + 2Fyb(1+2Re)D²/(3Fem·l_m²)),  k3 = −1 + √(2(1+Re)/Re + 2Fyb(2+Re)D²/(3Fem·l_s²)).
 * Rd is from `rdFactors` (4Kθ for Im and Is, 3.6Kθ for II, 3.2Kθ for IIIm, IIIs and IV). The NDS text was not at hand: these are the published equations as worked in the Caltrans falsework examples.
 */
export function lateralZWood(i: WoodLateralInput): LateralResult {
  const { D, ls, lm, Fes, Fem, Fyb, thetaDeg } = i;
  const rd = rdFactors(thetaDeg);
  const Re = Fem / Fes, Rt = lm / ls;
  const k1 = (Math.sqrt(Re + 2 * Re * Re * (1 + Rt + Rt * Rt) + Rt * Rt * Re ** 3) - Re * (1 + Rt)) / (1 + Re);
  const k2 = -1 + Math.sqrt(2 * (1 + Re) + (2 * Fyb * (1 + 2 * Re) * D * D) / (3 * Fem * lm * lm));
  const k3 = -1 + Math.sqrt((2 * (1 + Re)) / Re + (2 * Fyb * (2 + Re) * D * D) / (3 * Fem * ls * ls));
  const modes = {
    Im: (D * lm * Fem) / rd.Im,
    Is: (D * ls * Fes) / rd.Is,
    II: (k1 * D * ls * Fes) / rd.II,
    IIIm: (k2 * D * lm * Fem) / ((1 + 2 * Re) * rd.IIIm),
    IIIs: (k3 * D * ls * Fem) / ((2 + Re) * rd.IIIs),
    IV: ((D * D) / rd.IV) * Math.sqrt((2 * Fem * Fyb) / (3 * (1 + Re))),
  };
  let mode = 'Im';
  let Z = Infinity;
  for (const [m, v] of Object.entries(modes)) if (v < Z) { Z = v; mode = m; }
  return { Z, mode, modes };
}

/** Row tear-out of n fasteners in a row (NDS Appendix E): Z'RT = n·F'v·t·s_critical, s_critical = lesser of the end distance and half the in-row spacing. */
export function rowTearOut(n: number, FvPrime: number, t: number, endDist: number, rowSpacing: number): { sCrit: number; Z: number } {
  const sCrit = Math.min(endDist, rowSpacing / 2);
  return { sCrit, Z: n * FvPrime * t * sCrit };
}

/** Group tear-out (NDS Appendix E): Z'GT = ½Z'RT1 + ½Z'RT2 + F't·A_group-net, the two outer rows and the net section between them. */
export const groupTearOut = (zRt1: number, zRt2: number, FtPrime: number, aGroupNet: number): number => 0.5 * zRt1 + 0.5 * zRt2 + FtPrime * aGroupNet;

/** Cleavage shear V_r = (2/3)·F'v·b·d_e of a member loaded perpendicular to grain through a connection (NDS 3.4.3.3), lbf. */
export const cleavageVr = (FvPrime: number, b: number, de: number): number => ((2 / 3) * FvPrime * b * de);

export interface Spacing {
  /** Minimum distances in inches (NDS Tables 12.5.1A–D for bolts). */
  inRow: number;
  betweenRows: number;
  loadedEnd: number;
  unloadedEnd: number;
  loadedEdge: number;
  unloadedEdge: number;
}

/**
 * Bolt spacing, end and edge distances (NDS 12.5.1) for bolt diameter D and main-member length l in the bolt (l/D), for a load
 * PARALLEL to the grain ('par') or PERPENDICULAR to it ('perp').
 *   parallel:      in a row 4D; between rows 1.5D; end 7D loaded (tension member) / 4D unloaded; edge 1.5D
 *   perpendicular: in a row 3D; between rows 2.5D (l/D ≤ 2), 5D (l/D ≥ 6), (5·l + 10·D)/8 between; loaded edge 4D, unloaded edge 1.5D, end 4D
 */
export function boltSpacing(D: number, l: number, load: 'par' | 'perp'): Spacing {
  if (load === 'par') return { inRow: 4 * D, betweenRows: 1.5 * D, loadedEnd: 7 * D, unloadedEnd: 4 * D, loadedEdge: 1.5 * D, unloadedEdge: 1.5 * D };
  const r = l / D;
  const between = r <= 2 ? 2.5 * D : r >= 6 ? 5 * D : (5 * l + 10 * D) / 8;
  return { inRow: 3 * D, betweenRows: between, loadedEnd: 4 * D, unloadedEnd: 4 * D, loadedEdge: 4 * D, unloadedEdge: 1.5 * D };
}

/**
 * Depth of the countersink of an 82° flat-head fastener of shank diameter D (ASME B18.3 head diameter ≈ 1.92·D), inches. A countersunk
 * hole bears only on the plate below the head: the effective side-plate thickness is t − ½·depth (AISC 360 J3.10 style reduction; verify
 * the clause for a bolt group in wood, r3 N-2).
 */
export const countersinkDepth = (D: number): number => ((1.92 * D - D) / 2) / Math.tan((41 * Math.PI) / 180);

/** Effective side-member thickness when a countersunk head is flush in it (0 depth = plain hole). */
export const effectiveSideThickness = (t: number, csDepth: number): number => Math.max(0.05, t - 0.5 * csDepth);

import type { Ctx } from './context';

/** NDS adjustment on a lateral design value: C_M (wet) × C_D (impact, ≤ 1.6) × C_g (group). */
export const ndsAdjust = (p: { ndsWetFactorFasteners: number; ndsLoadDurationFactor: number; ndsGroupFactor: number }): number =>
  p.ndsWetFactorFasteners * p.ndsLoadDurationFactor * p.ndsGroupFactor;

/** Adjusted lateral capacity (lbf) of one plate bolt in the oak at angle θ to the grain, steel side plate of thickness ls, oak length lm. */
export function boltCapacity(ctx: Ctx, D: number, lm: number, ls0: number, thetaDeg: number, csDepth = 0): { Zref: number; Z: number; mode: string; Fem: number; Re: number; ls: number } {
  const { p } = ctx;
  const ls = effectiveSideThickness(ls0, csDepth); // a flush countersunk head bears only on the plate below it (r3 N-2)
  const Fem = feAtAngle(feParallel(p.oakSpecificGravity), fePerp(p.oakSpecificGravity, D), thetaDeg);
  const r = lateralZ({ D, lm, ls, Fem, Fes: p.steelDowelBearingPsi, Fyb: p.grade8BoltYieldPsi, thetaDeg });
  return { Zref: r.Z, Z: r.Z * ndsAdjust(p), mode: r.mode, Fem, Re: Fem / p.steelDowelBearingPsi, ls };
}

/** UNC tensile stress area of a bolt of diameter d: π/4 (d − 0.9743/n)². */
export function uncTensileArea(d: number): number {
  const n = d <= 0.25 ? 20 : d <= 0.3125 ? 18 : d <= 0.375 ? 16 : d <= 0.4375 ? 14 : d <= 0.5 ? 13 : 11;
  return (Math.PI / 4) * (d - 0.9743 / n) ** 2;
}
