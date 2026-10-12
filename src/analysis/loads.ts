/**
 * Load cases (spec "Load cases"): empty, operating (150 lb rider + cargo, pass/fail) and goal (200 lb rider + cargo).
 * Mass and CG come from the model's part list (src/model/mass.ts conventions); the rider's mass is applied at the
 * mannequin's D-3 CG and the cargo at its block's center.
 */
import type { Params } from '../params';
import { partCentroid } from '../model/bounds';
import type { Part, Vec3 } from '../model/types';
import type { LoadKind } from './types';

export interface CaseData {
  kind: LoadKind;
  /** Rider and cargo masses in this case. */
  riderLb: number;
  cargoLb: number;
  /** Total mass (= weight in lbf) including the sled. */
  massLb: number;
  /** CG in the neutral (straight) pose. */
  cg: Vec3;
  label: string;
  /** Cargo cases only: which end of the bed the payload is piled against ('aft' = against the box, 'fore' = against the nose end of the full-width run). */
  placement?: string;
}

export interface LoadModel {
  empty: CaseData;
  operating: CaseData;
  goal: CaseData;
  /** Lightest rider (BRIEF §4.1) + cargo, for rows that degrade with a light rider (rearward pitch). */
  light: CaseData;
  /**
   * Cargo mode (D-53): the post-race payload on the bed, seat stowed in the box, no rider, at the cargo CG height and lateral offset. One case per placement (piled
   * against the box, and against the nose end of the full-width run); a row reports the worse. Empty when cargo is not evaluated (the rider sweeps skip it).
   */
  cargoCases: CaseData[];
  /** Empty mass of the removable parts (transport configuration, D-9). */
  removableLb: number;
  /** Mass per part group for the empty sled. */
  emptyMassLb: number;
}

/** Mass, moments and removable mass of an empty-sled part list. (The pivoting front axle assembly turns about the kingpin: its CG shift with the steer angle, about 0.02 in on the sled CG, is neglected.) */
function sumParts(parts: Part[]) {
  let m = 0, mx = 0, my = 0, mz = 0;
  let removable = 0;
  for (const x of parts) {
    if (x.payload || x.group === 'reference') continue;
    const c = x.cgIn ?? partCentroid(x);
    m += x.massLb; mx += x.massLb * c[0]; my += x.massLb * c[1]; mz += x.massLb * c[2];
    if (x.removable) removable += x.massLb;
  }
  return { m, mx, my, mz, removable };
}

/** Where the cargo payload sits for the cargo cases (from the layout; see `cargoCg`). */
export interface CargoPlacement {
  name: string;
  /** CG (x, y, z) of the payload in the model frame. */
  cg: Vec3;
}

export interface CargoInput {
  /** The empty-sled part list with the seat stowed in the box (cargo mode). */
  stowedParts: Part[];
  placements: CargoPlacement[];
}

export function buildLoadModel(p: Params, parts: Part[], cargoIn?: CargoInput): LoadModel {
  const { m, mx, my, mz, removable } = sumParts(parts);
  const torso = parts.find((x) => x.id === 'rider-torso');
  const cargo = parts.find((x) => x.id === 'cargo');
  const riderCg: Vec3 = torso ? (torso.cgIn ?? partCentroid(torso)) : [p.seatXIn + p.riderCgAheadOfHpointIn, 0, p.deckHeightIn + p.riderSeatedCgAboveSeatIn];
  const cargoCg: Vec3 = cargo ? (cargo.cgIn ?? partCentroid(cargo)) : [0, 0, p.deckHeightIn + 2];

  const make = (kind: LoadKind, riderLb: number, cargoLb: number, label: string, base = { m, mx, my, mz }, at: Vec3 = cargoCg, riderAt: Vec3 = riderCg): CaseData => {
    const M = base.m + riderLb + cargoLb;
    const X = base.mx + riderLb * riderAt[0] + cargoLb * at[0];
    const Y = base.my + riderLb * riderAt[1] + cargoLb * at[1];
    const Z = base.mz + riderLb * riderAt[2] + cargoLb * at[2];
    const cg: Vec3 = M > 0 ? [X / M, Y / M, Z / M] : [0, 0, 0];
    return { kind, riderLb, cargoLb, massLb: M, cg, label };
  };
  return {
    empty: make('empty', 0, 0, 'empty'),
    operating: make('operating', p.riderMassLb, p.cargoMassLb, `operating (${p.riderMassLb} lb rider + ${p.cargoMassLb} lb cargo)`),
    goal: make('goal', p.riderGoalMassLb, p.cargoMassLb, `goal (${p.riderGoalMassLb} lb rider + ${p.cargoMassLb} lb cargo)`),
    light: make('light', p.riderMinMassLb, p.cargoMassLb, `lightest rider (${p.riderMinMassLb} lb rider + ${p.cargoMassLb} lb cargo)`),
    cargoCases: cargoIn ? cargoIn.placements.map((pl) => {
      const base = sumParts(cargoIn.stowedParts);
      const c = make('cargo', 0, p.cargoPayloadLb, `cargo (${p.cargoPayloadLb} lb on the bed, seat stowed)`, base, pl.cg);
      c.placement = pl.name;
      return c;
    }) : [],
    removableLb: removable,
    emptyMassLb: m,
  };
}
