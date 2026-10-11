/**
 * Display finishing (D-44): tags every part with how the viewer should dress it (`Part.finish`): a router roundover on exposed oak edges,
 * soft upholstery, tire lugs, and a surface look by material. Cosmetic only: mass, analysis and the overlap tests never read it, so the
 * oak keeps its square section in the checks (conservative for mass, under 2% of the 1-1/2" rail section).
 *
 * One pass at the end of `buildModel` so every builder (box, cylinder, extrusion, sweep, mesh) is covered the same way. A builder that
 * already set a field (for example `soft` on the seat pad) keeps it.
 */
import type { Params } from '../params';
import { localBounds } from './bounds';
import type { Finish, Part } from './types';

/** The roundover never exceeds this fraction of the part's smallest section dimension, so thin parts keep their shape. */
export const ROUNDOVER_MAX_FRACTION = 1 / 3;

/** Smallest section dimension of a part's geometry, in inches (the thickness a roundover has to fit in). */
export function minSection(g: Part['geometry']): number {
  switch (g.type) {
    case 'box': return Math.min(...g.size);
    case 'cylinder': return 2 * g.radius;
    case 'sweep': return Math.min(g.width, g.thickness);
    case 'wheel': return Math.min(g.diameter, g.width);
    case 'extrusion': {
      const b = localBounds(g);
      return Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1], g.depth);
    }
    default: return Infinity;
  }
}

/** Surface look from the material text, or undefined when it is none of the known finishes. */
export function surfaceOf(part: Pick<Part, 'material' | 'kind'>): Finish['surface'] | undefined {
  const m = part.material.toLowerCase();
  if (/mdf|mannequin|cargo|truck/.test(m)) return undefined;
  if (/plywood|okoume|baltic/.test(m)) return 'okoume';
  if (/white oak|\boak\b/.test(m)) return 'oak';
  if (/vinyl/.test(m)) return 'vinyl';
  if (/rope|polyester|braid/.test(m)) return 'rope';
  if (/alumin/.test(m)) return 'aluminum';
  if (/\basa\b|petg|printed|nylon|uhmw|plastic/.test(m)) return 'asa';
  if (/rubber|epdm|urethane|neoprene|tire/.test(m)) return 'rubber';
  if (/steel|stainless|zinc|a36|4140|1020|iron|spring|clevis pin|chromoly|threaded rod|hex bolt|bronze/.test(m)) return 'steel';
  return undefined;
}

/**
 * Surface look of the Phase 3b front-end family by part id / name (D-53): purchased kart spindles and kingpin bolts are blackened steel. (The ride and brake
 * cables and the lap belt are gone at Phase 3c-1.) Mirrors the viewer's fallback (viewer/materials.ts) so the tag is on the part and not only in the renderer.
 */
export function frontSurfaceOf(part: Pick<Part, 'id' | 'name' | 'material'>): Finish['surface'] | undefined {
  const tag = `${part.id} ${part.name}`.toLowerCase();
  if (/spindle|kingpin-bolt|kingpin bolt/.test(tag)) return 'blackened';
  return undefined;
}

/** Finish of one part (merged under anything the builder already set). */
export function finishFor(p: Pick<Params, 'roundoverIn'>, part: Part): Finish | undefined {
  if (part.payload || part.kind === 'reference') return part.finish;
  const out: Finish = { ...(part.finish ?? {}) };
  const m = part.material.toLowerCase();
  if (part.geometry.type === 'wheel') {
    out.tread ??= 'lug';
    out.surface ??= 'rubber';
  } else if (/foam/.test(m) && /vinyl/.test(m)) {
    out.soft ??= true;
    out.surface ??= 'vinyl';
  } else {
    const surface = frontSurfaceOf(part) ?? surfaceOf(part);
    if (surface) out.surface ??= surface;
    if (surface === 'oak' && out.roundoverIn === undefined && p.roundoverIn > 0) {
      out.roundoverIn = Math.min(p.roundoverIn, minSection(part.geometry) * ROUNDOVER_MAX_FRACTION);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** Tag every part in place with its `finish` (D-44). */
export function applyFinish(parts: Part[], p: Pick<Params, 'roundoverIn'>): void {
  for (const part of parts) {
    const f = finishFor(p, part);
    if (f) part.finish = f;
  }
}
