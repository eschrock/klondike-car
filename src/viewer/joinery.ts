import { partCentroid, transformPoint } from '../model/bounds';
import type { JointType, Part, Vec3 } from '../model/types';

export type MarkerShape = 'box' | 'cylinder';

export interface JoineryMarker {
  type: JointType;
  shape: MarkerShape;
  /** World (model-frame) position. */
  at: Vec3;
  /** Unit insertion axis (toward the mating part, snapped to a world axis). */
  axis: Vec3;
  /** Box: full extents in the frame where the insertion axis is `axis` (see viewer); cylinder: radius, length. */
  sizeIn: { w: number; l: number; t: number };
  size?: string;
}

/** Legend entries: marker families and their colors. Dado, rabbet and glue joints are not drawn. */
export const JOINERY_LEGEND: Array<{ label: string; color: string; types: JointType[] }> = [
  { label: 'Domino / tenon / lap', color: '#2f80ed', types: ['domino', 'mortise-tenon', 'bridle', 'half-lap', 'scarf'] },
  { label: 'Insert / bolt / screw / pin / knob', color: '#f2994a', types: ['threaded-insert', 'bolt', 'screw', 'pin', 'knob'] },
];

const BOX_TYPES = new Set<JointType>(['domino', 'mortise-tenon', 'bridle', 'half-lap', 'scarf']);
const ROUND_TYPES = new Set<JointType>(['threaded-insert', 'bolt', 'screw', 'pin', 'knob']);

export function jointColor(type: JointType): string | null {
  return JOINERY_LEGEND.find((l) => l.types.includes(type))?.color ?? null;
}

const MM = 1 / 25.4;

/** "10×50" or "DF 500 5×30" (mm) -> [thickness, width]; null when absent. */
export function parseDominoSize(size?: string): [number, number] | null {
  const m = size?.match(/(\d+(?:\.\d+)?)\s*[×xX]\s*(\d+(?:\.\d+)?)/);
  return m ? [Number(m[1]) * MM, Number(m[2]) * MM] : null;
}

function snapAxis(d: Vec3): Vec3 {
  const a = d.map(Math.abs);
  const k = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
  const v: Vec3 = [0, 0, 0];
  v[k] = d[k] >= 0 ? 1 : -1;
  return v;
}

/**
 * Markers for every structured joint drawn once. Joints are stored on both mated parts, so they are deduplicated by the
 * world position (rounded to 0.1") and type. Joints without `at` are skipped and counted in `missingAt`.
 */
export function joineryMarkers(parts: Part[]): { markers: JoineryMarker[]; missingAt: string[] } {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const markers: JoineryMarker[] = [];
  const missingAt: string[] = [];
  for (const part of parts) {
    for (const j of part.joints ?? []) {
      const shape: MarkerShape | null = BOX_TYPES.has(j.type) ? 'box' : ROUND_TYPES.has(j.type) ? 'cylinder' : null;
      if (!shape) continue;
      if (!j.at?.length) {
        missingAt.push(`${part.id} -> ${j.to} (${j.type})`);
        continue;
      }
      const mate = byId.get(j.to);
      for (const a of j.at) {
        const at = transformPoint(part.transform, a);
        const key = `${j.type}|${at.map((v) => Math.round(v * 10)).join(',')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const toward = mate ? partCentroid(mate) : at;
        const axis = snapAxis([toward[0] - at[0], toward[1] - at[1], toward[2] - at[2]]);
        let sizeIn = { w: 0.4, l: 0.6, t: 0.4 };
        if (shape === 'box') {
          const d = parseDominoSize(j.size);
          // Domino: thickness × width (mm); it enters about 0.6" along the insertion axis.
          sizeIn = d ? { t: d[0], w: d[1], l: 0.6 } : { t: 0.4, w: 1.2, l: 0.6 };
        } else {
          const r = Math.min(0.4, Math.max(0.08, (j.diaIn ?? 0.25) / 2));
          sizeIn = { w: r, l: 0.7, t: r };
        }
        markers.push({ type: j.type, shape, at, axis, sizeIn, size: j.size });
      }
    }
  }
  return { markers, missingAt };
}
