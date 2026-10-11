/**
 * Load cases (spec "Load cases"): empty, operating (150 lb rider + cargo, pass/fail) and goal (200 lb rider + cargo).
 * Mass and CG come from the model's part list (src/model/mass.ts conventions); the rider's mass is applied at the
 * mannequin's D-3 CG and the cargo at its block's center.
 */
import type { Params } from '../params';
import { partCentroid } from '../model/bounds';
import type { Part, Vec3 } from '../model/types';
import { rot2, type P2 } from './geometry';
import type { LoadKind } from './types';

export interface CaseData {
  kind: LoadKind;
  /** Rider and cargo masses in this case. */
  riderLb: number;
  cargoLb: number;
  /** Total mass (= weight in lbf) including the cart. */
  massLb: number;
  /** CG in the neutral (straight) pose. */
  cg: Vec3;
  /** CG when the steer body is rotated by `deltaRad` about the kingpin (the steer body carries its own mass). */
  cgAt(deltaRad: number): Vec3;
  label: string;
}

export interface LoadModel {
  empty: CaseData;
  operating: CaseData;
  goal: CaseData;
  /** Lightest rider (BRIEF §4.1) + cargo, for rows that degrade with a light rider (rearward pitch). */
  light: CaseData;
  /** Empty mass of the removable parts (transport configuration, D-9). */
  removableLb: number;
  /** Mass per part group for the empty cart. */
  emptyMassLb: number;
}

const isSteerBody = (x: Part) => x.body === 'steer' || x.body === 'wheel-FL' || x.body === 'wheel-FR';

export function buildLoadModel(p: Params, parts: Part[], kingpinX: number): LoadModel {
  let m = 0, mx = 0, my = 0, mz = 0;
  let ms = 0, msx = 0, msy = 0, msz = 0;
  let removable = 0;
  for (const x of parts) {
    if (x.payload || x.group === 'reference') continue;
    const c = x.cgIn ?? partCentroid(x);
    m += x.massLb; mx += x.massLb * c[0]; my += x.massLb * c[1]; mz += x.massLb * c[2];
    if (isSteerBody(x)) { ms += x.massLb; msx += x.massLb * c[0]; msy += x.massLb * c[1]; msz += x.massLb * c[2]; }
    if (x.removable) removable += x.massLb;
  }
  const torso = parts.find((x) => x.id === 'rider-torso');
  const cargo = parts.find((x) => x.id === 'cargo');
  const riderCg: Vec3 = torso ? (torso.cgIn ?? partCentroid(torso)) : [p.seatXIn + p.riderCgAheadOfHpointIn, 0, p.deckHeightIn + p.riderSeatedCgAboveSeatIn];
  const cargoCg: Vec3 = cargo ? (cargo.cgIn ?? partCentroid(cargo)) : [0, 0, p.deckHeightIn + 2];
  const steerC: Vec3 = ms > 0 ? [msx / ms, msy / ms, msz / ms] : [kingpinX, 0, 0];

  const make = (kind: LoadKind, riderLb: number, cargoLb: number, label: string): CaseData => {
    const M = m + riderLb + cargoLb;
    const X = mx + riderLb * riderCg[0] + cargoLb * cargoCg[0];
    const Y = my + riderLb * riderCg[1] + cargoLb * cargoCg[1];
    const Z = mz + riderLb * riderCg[2] + cargoLb * cargoCg[2];
    const cg: Vec3 = M > 0 ? [X / M, Y / M, Z / M] : [0, 0, 0];
    return {
      kind, riderLb, cargoLb, massLb: M, cg, label,
      cgAt(d: number): Vec3 {
        if (d === 0 || ms === 0 || M === 0) return cg;
        const q = rot2([steerC[0], steerC[1]] as P2, d, [kingpinX, 0]);
        return [(X - msx + ms * q[0]) / M, (Y - msy + ms * q[1]) / M, cg[2]];
      },
    };
  };
  return {
    empty: make('empty', 0, 0, 'empty'),
    operating: make('operating', p.riderMassLb, p.cargoMassLb, `operating (${p.riderMassLb} lb rider + ${p.cargoMassLb} lb cargo)`),
    goal: make('goal', p.riderGoalMassLb, p.cargoMassLb, `goal (${p.riderGoalMassLb} lb rider + ${p.cargoMassLb} lb cargo)`),
    light: make('light', p.riderMinMassLb, p.cargoMassLb, `lightest rider (${p.riderMinMassLb} lb rider + ${p.cargoMassLb} lb cargo)`),
    removableLb: removable,
    emptyMassLb: m,
  };
}
