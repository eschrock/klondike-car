/**
 * Test helpers for the Phase 3b analysis rows: a context on the Phase 3b defaults with the Ackermann basis FORCED on, so the new rows can be exercised before the model carries the new
 * front-end parts (`spindle-L`); once it does, the same helper simply keeps the flag on.
 */
import { phase3bDefaults, resolveParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext, type Ctx } from './context';

export function ackParams(over: Partial<Params> = {}): Params {
  return resolveParams({ ...phase3bDefaults(), ...over });
}

export function ackCtx(over: Partial<Params> = {}): Ctx {
  const p = ackParams(over);
  const parts = buildModel(p, { rider: 'goal', cargo: true, steerDeg: 0 });
  return makeContext(p, parts, { newFront: true });
}

export const byId = <T extends { id: string }>(cs: T[], id: string): T => {
  const c = cs.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
};
