import { derived, type Params } from '../params';
import { computeLayout, type Layout } from '../model/layout';
import type { Part } from '../model/types';
import { cargoBed, type CargoBed } from '../model/bed';
import { buildLoadModel, type LoadModel } from './loads';
import type { ContactInputs } from './geometry';

/** Everything the checks share, built once per runChecks call. */
export interface Ctx {
  p: Params;
  d: ReturnType<typeof derived>;
  L: Layout;
  /** Goal-rider part list at steer 0 (payload parts present; mass cases are applied by `loads`). */
  parts: Part[];
  byId: Map<string, Part>;
  loads: LoadModel;
  /** The cargo bed (D-53) and the stowed-seat part list the cargo cases were built from (null when cargo is not evaluated). */
  bed: CargoBed;
  stowedParts: Part[] | null;
  contact: ContactInputs;
}

/**
 * `stowedParts` (the empty cart with the seat stowed in the box) switches the cargo cases on (D-53); without it the context has no cargo case and the checks
 * report the rider cases only (the rider sweeps use that fast path).
 */
export function makeContext(p: Params, parts: Part[], stowedParts?: Part[]): Ctx {
  const L = computeLayout(p);
  const bed = cargoBed(p, L);
  const lenC = Math.min(p.cargoLoadLengthIn, Math.max(1, bed.xLoadEnd - bed.x0));
  const cy = p.cargoCgOffsetYIn, cz = L.deckTop + p.cargoCgHeightIn;
  const placements = [
    { name: 'aft, piled against the box', cg: [bed.x0 + lenC / 2, cy, cz] as [number, number, number] },
    { name: `fore, at the nose end of the bed where it is still ${p.cargoLoadWidthIn} in wide`, cg: [Math.max(bed.x0 + lenC / 2, bed.xLoadEnd - lenC / 2), cy, cz] as [number, number, number] },
  ];
  return {
    p,
    d: derived(p),
    L,
    parts,
    byId: new Map(parts.map((x) => [x.id, x])),
    loads: buildLoadModel(p, parts, stowedParts ? { stowedParts, placements } : undefined),
    bed,
    stowedParts: stowedParts ?? null,
    contact: { wheelbaseIn: p.wheelbaseIn, rearTrackIn: p.rearTrackIn, frontTrackIn: p.frontTrackIn },
  };
}
