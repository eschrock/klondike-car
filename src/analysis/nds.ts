/**
 * NDS-style timber-connection helpers (Phase 3 round 2, D-35): dowel bearing strength, single-shear yield-mode capacity of a
 * bolt through a steel side plate into oak, row / group tear-out (NDS Appendix E), the cleavage (splitting) shear of a
 * connection loaded perpendicular to grain (NDS 3.4.3.3), and the bolt spacing / edge / end distance rules (NDS 12.5.1).
 * Plain numbers in, plain numbers out; every strength comes from Params (src/params.ts), nothing is hard-coded here except the
 * published NDS coefficients (the 6100, 11200 and 1.45 of Table 12.3.3, the Rd constants of Table 12.3.1B).
 *
 * References checked while writing: the Appendix E row tear-out and group tear-out forms (Z'RT = n_i·F'v·t·s_critical;
 * Z'GT = ½Z'RT1 + ½Z'RT2 + F't·A_group-net). The 3.4.3.3 cleavage form is used as V_r = (2/3)·F'v·b·d_e with d_e the
 * distance from the nearest fastener to the loaded edge; the caller designs mechanical reinforcement for the whole V regardless,
 * so the exact factor on d_e/d does not govern any pass / fail result (see front.ts, kingpin-split).
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
