import type { Part, Vec3 } from './types';
import { partCentroid } from './bounds';

export interface MassOptions {
  /** Include rider/cargo/other payload parts. Default false (empty cart). */
  includePayload?: boolean;
}

function counted(parts: Part[], opts?: MassOptions): Part[] {
  return opts?.includePayload ? parts : parts.filter((p) => !p.payload);
}

/** Sum of part.massLb (one Part = one physical piece, C-5). */
export function totalMass(parts: Part[], opts: MassOptions = {}): number {
  return counted(parts, opts).reduce((s, p) => s + p.massLb, 0);
}

/** Mass-weighted centre of gravity in the model frame (inches). Zero vector if there is no mass. */
export function centerOfGravity(parts: Part[], opts: MassOptions = {}): Vec3 {
  let m = 0, x = 0, y = 0, z = 0;
  for (const p of counted(parts, opts)) {
    const c = p.cgIn ?? partCentroid(p);
    m += p.massLb;
    x += p.massLb * c[0];
    y += p.massLb * c[1];
    z += p.massLb * c[2];
  }
  return m > 0 ? [x / m, y / m, z / m] : [0, 0, 0];
}
