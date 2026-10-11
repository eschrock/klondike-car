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
  /**
   * Phase 3b Ackermann front end (D-51). True when the model carries the new front-end parts (`spindle-L`), or when forced by the caller (tests that exercise
   * the new rows on the old model). It selects the new front-end rows, the bump load basis (D-50) and the Ackermann contacts; false keeps the old rows
   * working until the Stage 2 flip.
   */
  newFront: boolean;
}

export interface ContextOptions {
  /** Force the Phase 3b basis on or off; default: detect the new front-end parts. */
  newFront?: boolean;
}

export function makeContext(p: Params, parts: Part[], opts: ContextOptions = {}): Ctx {
  const L = computeLayout(p);
  const newFront = opts.newFront ?? parts.some((x) => x.id === 'spindle-L');
  const ack = newFront ? L.front.ack : undefined;
  return {
    newFront,
    p,
    d: derived(p),
    L,
    parts,
    byId: new Map(parts.map((x) => [x.id, x])),
    loads: buildLoadModel(p, parts, L.kx, ack),
    contact: { wheelbaseIn: p.wheelbaseIn, rearTrackIn: p.rearTrackIn, frontTrackIn: p.frontTrackIn, kingpinLeadIn: p.kingpinLeadIn, ...(ack ? { ack } : {}) },
  };
}
