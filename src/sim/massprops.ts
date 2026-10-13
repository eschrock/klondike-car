/**
 * Mass, center of gravity and inertia of a group of Parts (DESIGN.md).
 * Inertia is approximated as the sum of each part's solid-box inertia (from its OBB) plus the parallel-axis term.
 * Model units: inches and pounds; the result is also given in SI for the physics engine.
 */
import { partCentroid, partOBB } from '../model/bounds';
import type { Part, Vec3 } from '../model/types';
import { eigenSym3, qFromColumns, type Quat } from './math';

export const M_PER_IN = 0.0254;
export const KG_PER_LB = 0.45359237;
export const N_PER_LBF = 4.4482216;
export const MPH_PER_MS = 2.2369363;
export const G = 9.80665;

export interface BodyMass {
  massLb: number;
  /** Center of mass, model frame, inches. */
  cgIn: Vec3;
  /** Inertia tensor about the CG in the model axes, lb·in², row-major. */
  inertiaLbIn2: number[];
}

/** Σ m_i, mass-weighted CG, and Σ (I_box,i + m_i (|d|² 𝟙 − d dᵀ)) about that CG. `massOf` overrides a part's mass. */
export function bodyMass(parts: Part[], massOf: (p: Part) => number = (p) => p.massLb): BodyMass {
  let m = 0;
  const c: Vec3 = [0, 0, 0];
  const cgs = parts.map((p) => p.cgIn ?? partCentroid(p));
  parts.forEach((p, i) => {
    const mi = massOf(p);
    m += mi;
    for (let k = 0; k < 3; k++) c[k] += mi * cgs[i][k];
  });
  const cg: Vec3 = m > 0 ? [c[0] / m, c[1] / m, c[2] / m] : [0, 0, 0];
  const I = new Array<number>(9).fill(0);
  parts.forEach((p, i) => {
    const mi = massOf(p);
    if (mi <= 0) return;
    const o = partOBB(p);
    const h = o.half;
    const lam = [
      (mi / 3) * (h[1] * h[1] + h[2] * h[2]),
      (mi / 3) * (h[0] * h[0] + h[2] * h[2]),
      (mi / 3) * (h[0] * h[0] + h[1] * h[1]),
    ];
    for (let a = 0; a < 3; a++) {
      for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) I[r * 3 + s] += lam[a] * o.axes[a][r] * o.axes[a][s];
    }
    const d: Vec3 = [cgs[i][0] - cg[0], cgs[i][1] - cg[1], cgs[i][2] - cg[2]];
    const d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) I[r * 3 + s] += mi * ((r === s ? d2 : 0) - d[r] * d[s]);
  });
  return { massLb: m, cgIn: cg, inertiaLbIn2: I };
}

/** SI principal inertia (kg·m²) and its frame, from a lb·in² tensor. */
export function principalSI(inertiaLbIn2: number[]): { values: Vec3; frame: Quat } {
  const k = KG_PER_LB * M_PER_IN * M_PER_IN;
  const { values, vectors } = eigenSym3(inertiaLbIn2.map((v) => v * k));
  return { values, frame: qFromColumns(vectors[0], vectors[1], vectors[2]) };
}
