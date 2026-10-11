import { derived, type Params } from '../params';
import { computeLayout, type Layout } from '../model/layout';
import type { Part } from '../model/types';
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
  contact: ContactInputs;
}

export function makeContext(p: Params, parts: Part[]): Ctx {
  const L = computeLayout(p);
  const ack = L.front.ack;
  return {
    p,
    d: derived(p),
    L,
    parts,
    byId: new Map(parts.map((x) => [x.id, x])),
    loads: buildLoadModel(p, parts, ack),
    contact: { wheelbaseIn: p.wheelbaseIn, rearTrackIn: p.rearTrackIn, frontTrackIn: p.frontTrackIn, ack },
  };
}
