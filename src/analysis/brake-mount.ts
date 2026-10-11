/**
 * Brake bearing-plate mounts (build review r2 MUST-3, D-48): vector statics of the closed brake linkage and the bolt group that holds the plates to the rail.
 *
 * The hand force, the link, the crank, the shoe arms and the shaft form a closed loop, so the loads on the left bearing plate are NOT the sum of magnitudes
 * (the old R = F_link + R_pin): the link pushes the crank one way and the shoes pull the arms the other. Per rolling direction σ (+1 forward, −1 reverse):
 *   N_σ = F_hand · ratio_σ                              total shoe normal force for the same hand force
 *   force on the shoes (both) = N_σ (n + σ μ t)         tread push + friction, on the arms and so on the shaft
 *   crank force F_c = −M_arms / (r_c × u) · u           shaft torque balance (|F_c| = F_link)
 *   lever: pivot post carries F_hand − F_c               (link is a two-force member: tail gets −F_c)
 *   shaft: lever rule between the two bearings           force on the left bearing P_L = Σ W_i (y_i + y_s)/(2 y_s)
 * The bolt group is solved elastically (rigid plate): direct shear, in-plane torsion about the group centroid, and tension from the tilt moments (the load
 * planes are off the rail face). The old magnitude-sum bound is reported alongside in the row text.
 */
import type { Params } from '../params';
import type { BrakeGeom } from '../model/brake';
import { BEARING_STANDOFF_IN, nutHeight, washerThick, type BearingMount, type V2 } from '../model/rear-mount';
import { boltCapacity } from './nds';
import { cleavageVr } from './nds';
import type { Ctx } from './context';
import { detail } from './dual';
import { f } from './format';
import type { Detail } from './types';

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const norm = (a: V2) => Math.hypot(a[0], a[1]);
const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];

export interface Statics {
  sigma: 1 | -1;
  N: number;
  Fc: V2;
  /** Force on the left plate from the shaft bearing, and the right; from the lever pivot post. */
  PL: V2;
  PR: V2;
  Qp: V2;
  /** Pivot post bending moment arm used (in) and the unbalanced lever moment (sanity: ≈ 0). */
  leverResidual: number;
  hand: number;
}

/** Statics at the applied pose for a hand force `feq` (lbf, horizontal at the grip) rolling in direction σ. */
export function mountStatics(p: Params, g: BrakeGeom, feq: number, sigma: 1 | -1): Statics {
  const mu = p.brakePadMu;
  const ratio = sigma > 0 ? g.ratioFwd : g.ratioRev;
  const N = feq * ratio;
  const t: V2 = [sigma * g.tFwd[0], sigma * g.tFwd[1]];
  const dir: V2 = [g.n[0] + mu * t[0], g.n[1] + mu * t[1]];
  const Marms = N * (g.Kn + sigma * mu * g.Kt);
  const uv = sub(g.B1, g.T1);
  const ul = norm(uv) || 1;
  const u: V2 = [uv[0] / ul, uv[1] / ul];
  const cu = cross(sub(g.B1, g.S), u) || 1e-9;
  const c = -Marms / cu;
  const Fc: V2 = [c * u[0], c * u[1]];
  const Y = g.y;
  const ys = Y.rail + (p.brakePlateThickIn - BEARING_STANDOFF_IN) / 2;
  const mid = (a: [number, number]) => (a[0] + a[1]) / 2;
  const Fside: V2 = [(N / 2) * dir[0], (N / 2) * dir[1]];
  const loads: Array<{ y: number; F: V2 }> = [
    { y: Y.plane, F: Fc },
    { y: mid(Y.armIn), F: [Fside[0] / 2, Fside[1] / 2] }, { y: mid(Y.armOut), F: [Fside[0] / 2, Fside[1] / 2] },
    { y: -mid(Y.armIn), F: [Fside[0] / 2, Fside[1] / 2] }, { y: -mid(Y.armOut), F: [Fside[0] / 2, Fside[1] / 2] },
  ];
  let PL: V2 = [0, 0], tot: V2 = [0, 0];
  for (const l of loads) {
    const share = (l.y + ys) / (2 * ys);
    PL = [PL[0] + l.F[0] * share, PL[1] + l.F[1] * share];
    tot = [tot[0] + l.F[0], tot[1] + l.F[1]];
  }
  const PR: V2 = [tot[0] - PL[0], tot[1] - PL[1]];
  const Fh: V2 = [-feq, 0];
  const Qp: V2 = [Fh[0] - Fc[0], Fh[1] - Fc[1]];
  // Lever moment balance about the pivot: hand + (−F_c at the tail) should cancel.
  const residual = cross(sub(g.G, g.Q), Fh) + cross(sub(g.T1, g.Q), [-Fc[0], -Fc[1]]);
  return { sigma, N, Fc, PL, PR, Qp, leverResidual: residual, hand: feq };
}

export interface GroupResult {
  Vmax: number;
  Tmax: number;
  /** Sums of the downward / upward z-components of the bolt shears (perpendicular-to-grain demand toward the rail's bottom / top edge). */
  VzDown: number;
  VzUp: number;
  net: V2;
  torsion: number;
  Mx: number;
  Mz: number;
}

/** Rigid-plate bolt group: forces (in the x–z plane) applied at plate positions with out-of-plane offsets e from the rail face. */
export function boltGroup(bolts: V2[], loads: Array<{ pos: V2; F: V2; e: number }>): GroupResult {
  const n = bolts.length;
  const C: V2 = [bolts.reduce((a, b) => a + b[0], 0) / n, bolts.reduce((a, b) => a + b[1], 0) / n];
  const rho = bolts.map((b) => sub(b, C));
  const sx2 = rho.reduce((a, r) => a + r[0] ** 2, 0) || 1e-9, sz2 = rho.reduce((a, r) => a + r[1] ** 2, 0) || 1e-9, sr2 = sx2 + sz2;
  let net: V2 = [0, 0], torsion = 0, Mx = 0, Mz = 0;
  for (const l of loads) {
    net = [net[0] + l.F[0], net[1] + l.F[1]];
    torsion += cross(sub(l.pos, C), l.F);
    Mx += l.e * l.F[1];
    Mz += -l.e * l.F[0];
  }
  let Vmax = 0, Tmax = 0, VzDown = 0, VzUp = 0;
  for (const r of rho) {
    const v: V2 = [net[0] / n + (-torsion * r[1]) / sr2, net[1] / n + (torsion * r[0]) / sr2];
    Vmax = Math.max(Vmax, norm(v));
    if (v[1] < 0) VzDown -= v[1]; else VzUp += v[1];
    const T = (Mx * r[1]) / sz2 - (Mz * r[0]) / sx2;
    Tmax = Math.max(Tmax, Math.abs(T));
  }
  return { Vmax, Tmax, VzDown, VzUp, net, torsion, Mx, Mz };
}

/** UNC tensile stress area of a bolt of diameter d: π/4 (d − 0.9743/n)². */
export function uncTensileArea(d: number): number {
  const n = d <= 0.25 ? 20 : d <= 0.3125 ? 18 : d <= 0.375 ? 16 : d <= 0.4375 ? 14 : d <= 0.5 ? 13 : 11;
  return (Math.PI / 4) * (d - 0.9743 / n) ** 2;
}

export interface MountEval { details: Detail[]; text: string; nets: { left: number; right: number; magnitudeSumBolt: number } }

/**
 * Bearing-plate bolt-group details at a hand force `feq` (both rolling directions, left plate with the pivot, right plate), the NDS bolt capacity, washers,
 * plate bearing / tear-out, distances and cleavage. `k` scales the allowables (1 = design with safety factors; the safety factor for yield-level abuse checks).
 */
export function mountDetails(ctx: Ctx, g: BrakeGeom, mount: BearingMount, feq: number, k = 1): MountEval {
  const { p } = ctx;
  const Y = g.y;
  const plateT = mount.plateT;
  const D = mount.boltD;
  const sf = p.steelSafetyFactor;
  const FvP = p.oakNdsShearPsi * p.ndsWetFactorShear * p.ndsLoadDurationFactor;
  const best = new Map<string, Detail>();
  const keep = (d: Detail) => { const c = best.get(d.name); if (!c || d.util > c.util) best.set(d.name, d); };
  const eB = Math.abs((Y.rail + (plateT - BEARING_STANDOFF_IN) / 2) - Y.rail) + plateT / 2;
  const eP = (Y.lever[0] + Y.lever[1]) / 2 - Y.rail;
  const bTot = mount.rail.t + (mount.doubler.covers ? mount.doubler.t : 0); // rail + glued doubler act as one main member
  const cap = boltCapacity(ctx, D, bTot, plateT, 90);
  const At = uncTensileArea(D);
  const boltTenAllow = (p.kingpinCrossBoltYieldPsi / sf) * k;
  const washerOd = 1.5;
  const washerA = (Math.PI / 4) * (washerOd ** 2 - (D + 1 / 16) ** 2);
  const bushLen = plateT + BEARING_STANDOFF_IN;
  const plateBear = (0.9 * p.brakeSteelYieldPsi / sf) * k;
  const plateShear = (0.6 * p.brakeSteelYieldPsi / sf) * k;
  const hole = mount.boltHole;
  const edgeP = 1.5 * hole + hole / 2;
  let worstNet = 0, magSum = 0, lNet = 0, rNet = 0;
  for (const sg of [1, -1] as const) {
    const s = mountStatics(p, g, feq, sg);
    magSum = Math.max(magSum, norm(s.PL) + norm(s.Qp));
    for (const side of ['L', 'R'] as const) {
      const loads = side === 'L'
        ? [{ pos: mount.S, F: s.PL, e: eB }, { pos: mount.Q, F: s.Qp, e: eP }]
        : [{ pos: mount.S, F: s.PR, e: eB }];
      const r = boltGroup(mount.bolts, loads);
      const nm = norm(r.net);
      if (side === 'L') lNet = Math.max(lNet, nm); else rNet = Math.max(rNet, nm);
      worstNet = Math.max(worstNet, nm);
      const inter = (r.Vmax / (cap.Z * k)) ** 2 + (r.Tmax / (At * boltTenAllow)) ** 2;
      keep(detail('bearing-plate bolt shear vs NDS lateral capacity (steel plate on oak, ⊥ grain)', r.Vmax, 'lbf', cap.Z * k, '<='));
      keep(detail('bearing-plate bolt tension (316, tensile area)', r.Tmax, 'lbf', At * boltTenAllow, '<='));
      keep(detail('bearing-plate bolt: shear-tension interaction (V/Z)² + (T/T_all)²', inter, '×', 1, '<='));
      keep(detail('bearing-plate washer pull-through on the rail inner face (oak ⊥ grain)', r.Tmax / washerA, 'psi', allowOakPerp(ctx) * k, '<='));
      keep(detail('bearing-plate bolt hole bearing in the steel plate', r.Vmax / (D * plateT), 'psi', plateBear, '<='));
      keep(detail('bearing-plate bolt hole tear-out toward the plate edge', r.Vmax / (2 * (edgeP - hole / 2) * plateT), 'psi', plateShear, '<='));
      keep(detail('rail cleavage toward the bottom edge (NDS 3.4.3.3): downward shear components vs ⅔ F\'v b d_e', r.VzDown, 'lbf', cleavageVr(FvP, bTot, mount.dist.bottom) * k, '<='));
      keep(detail('rail cleavage toward the deck-ledge edge (NDS 3.4.3.3): upward shear components vs ⅔ F\'v b d_e', r.VzUp, 'lbf', cleavageVr(FvP, bTot, mount.dist.top) * k, '<='));
      keep(detail('bearing bushing pressure (bronze, plate + standoff length)', norm(side === 'L' ? s.PL : s.PR) / (mount.D * bushLen), 'psi', p.brakeBushingPsi * k, '<='));
    }
  }
  keep(detail('bolt end distance: first bolt to the rail end (loaded end, ≥ 7D)', mount.dist.end, 'in', 7 * D, '>='));
  keep(detail('bolt edge distance to the rail bottom (≥ 1.5D)', mount.dist.bottom, 'in', 1.5 * D, '>='));
  keep(detail('bolt edge distance to the deck ledge (≥ 1.5D)', mount.dist.top, 'in', 1.5 * D, '>='));
  keep(detail('bolt distance to the shaft notch (≥ 2D)', mount.dist.notch, 'in', 2 * D, '>='));
  keep(detail('bolt pitch along the grain (≥ 4D)', mount.xCols.length > 1 ? mount.xCols[1] - mount.xCols[0] : 99, 'in', 4 * D, '>='));
  const ds = [...best.values()];
  const text = `Bearing plates (D-48): ${mount.bolts.length} × ${f(D, 3)}" 316 bolts in a ${mount.xCols.length} × 2 grid (${f(p.brakeBearingBoltSpacingIn, 2)}" × ${f(p.brakeBearingBoltRowGapIn, 2)}") through the ${f(mount.rail.t, 2)}" rail, the ${f(mount.doubler.t, 2)}" oak doubler and the ${f(plateT, 2)}" plate; ${f(mount.dist.end, 2)}" from the rail end, ${f(mount.dist.bottom, 2)}" above the rail bottom, ${f(mount.dist.top, 2)}" below the deck ledge, ${f(mount.dist.notch, 2)}" from the shaft notch. Loads by vector statics of the closed linkage for a hand force of ${f(feq)} lbf in both rolling directions: the link pushes the crank one way and the shoes pull the arms the other, so the net in-plane load on the left plate is ${f(lNet)} lbf (right ${f(rNet)}), against ${f(magSum)} lbf if the bearing and pivot magnitudes were simply added as in round 2. In-plane torsion about the bolt centroid and the tilt moments (pivot post ${f(eP, 2)}" off the rail face, bearing ${f(eB, 2)}") go into the elastic bolt-group solution. NDS lateral Z = ${f(cap.Z)} lbf (mode ${cap.mode}, ⊥ grain, steel side plate ${f(plateT, 2)}", oak ${f(bTot, 2)}", × C_M C_D C_g), tensile area ${f(At, 4)} in², 1-1/2" fender washers ${f(washerA, 2)} in², cleavage V_r = ⅔·F'v·b·d_e = ⅔ × ${f(FvP, 0)} × ${f(bTot, 2)} × d_e (${f(mount.dist.bottom, 2)}" to the bottom edge, ${f(mount.dist.top, 2)}" to the ledge) = ${f(cleavageVr(FvP, bTot, mount.dist.bottom))} / ${f(cleavageVr(FvP, bTot, mount.dist.top))} lbf.`;
  return { details: ds, text, nets: { left: lNet, right: rNet, magnitudeSumBolt: magSum } };
}

function allowOakPerp(ctx: Ctx): number {
  const { p } = ctx;
  return (p.oakCompPerpPsi * p.wetServiceFactorCompPerp) / p.woodSafetyFactor;
}

export { nutHeight, washerThick };
