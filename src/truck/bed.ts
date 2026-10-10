/**
 * Truck bed model (2007 Tacoma short bed, tailgate down), built from the `truck*` params (D-23).
 *
 * TRUCK frame: origin at bed floor level, x = 0 at the bulkhead, +x toward the tailgate, y = 0 on
 * the centreline, z up. The lowered tailgate continues the floor as a slab. All parts are
 * `payload` + 'reference' so they never count toward mass, the cut list or the BOM.
 */
import type { Params } from '../params';
import { translation } from '../model/mat4';
import type { Part, Vec3 } from '../model/types';

/** Display thickness of the floor slab / walls / bulkhead (cosmetic; the real bed liner is in truckClearanceIn). */
const SLAB_IN = 1;

/** Solids a cart may rest on: touching them is contact, not a collision. */
export const FLOOR_IDS: ReadonlySet<string> = new Set(['truck-floor', 'truck-tailgate']);

function solid(id: string, name: string, min: Vec3, max: Vec3): Part {
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return {
    id,
    name,
    group: 'reference',
    kind: 'reference',
    material: 'truck bed',
    geometry: { type: 'box', size },
    transform: translation((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2),
    body: 'truck',
    massLb: 0,
    fab: 'none',
    step: 0,
    payload: true,
  };
}

/** Ground height in the TRUCK frame (bed floor is truckLoadHeightIn above it). */
export function truckGroundZ(p: Params): number {
  return -p.truckLoadHeightIn;
}

export function buildTruckBed(p: Params, opts: { ground?: boolean } = {}): Part[] {
  const hw = p.truckBedWidthIn / 2;
  const L = p.truckBedLengthIn;
  const T = SLAB_IN;
  const parts: Part[] = [
    solid('truck-floor', 'Bed floor', [0, -hw, -T], [L, hw, 0]),
    solid('truck-bulkhead', 'Bulkhead', [-T, -hw - T, -T], [0, hw + T, p.truckBedDepthIn]),
    solid('truck-wall-L', 'Bed side wall (left)', [0, hw, 0], [L, hw + T, p.truckBedDepthIn]),
    solid('truck-wall-R', 'Bed side wall (right)', [0, -hw - T, 0], [L, -hw, p.truckBedDepthIn]),
    solid('truck-well-L', 'Wheel well (left)', [p.truckWellStartIn, p.truckWellGapIn / 2, 0], [p.truckWellStartIn + p.truckWellLengthIn, hw, p.truckWellHeightIn]),
    solid('truck-well-R', 'Wheel well (right)', [p.truckWellStartIn, -hw, 0], [p.truckWellStartIn + p.truckWellLengthIn, -p.truckWellGapIn / 2, p.truckWellHeightIn]),
    solid('truck-tailgate', 'Tailgate (down)', [L, -hw, -T], [L + p.truckTailgateLengthIn, hw, 0]),
  ];
  if (opts.ground) {
    const gz = truckGroundZ(p);
    parts.push(solid('truck-ground', 'Ground (display only)', [-80, -100, gz - 0.1], [L + p.truckTailgateLengthIn + 80, 100, gz]));
  }
  return parts;
}
