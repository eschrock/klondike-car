/** Test helpers for the analysis rows: a context on the default design (the Ackermann tow cart). */
import { defaultParams, resolveParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext, type Ctx } from './context';

export function ackParams(over: Partial<Params> = {}): Params {
  return resolveParams({ ...defaultParams(), ...over });
}

export function ackCtx(over: Partial<Params> = {}): Ctx {
  const p = ackParams(over);
  const parts = buildModel(p, { rider: 'goal', cargo: true, steerDeg: 0 });
  return makeContext(p, parts);
}

export const byId = <T extends { id: string }>(cs: T[], id: string): T => {
  const c = cs.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
};
