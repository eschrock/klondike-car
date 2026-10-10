/**
 * Part schema. Model builders turn Params into Part[]; every downstream view
 * (viewer, analysis, sim, cut list, BOM, exports, assembly) reads only this.
 *
 * Geometry is expressed in the part's local frame, in inches; `transform`
 * places it in the model frame (+X forward, +Y left, +Z up, origin on the
 * ground under the rear-axle centre). Plain data — no three.js types — so the
 * model and analysis run headless in tests.
 */

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

/** Column-major 4×4, same layout as three.js Matrix4.elements. */
export type Mat4 = number[];

export type PartGroup =
  | 'frame'
  | 'body'
  | 'steering'
  | 'running-gear'
  | 'seat'
  | 'brake'
  | 'storage'
  | 'lighting'
  | 'removable'
  | 'hardware'
  | 'reference'; // rider, cargo, truck — not built, excluded from cut list/BOM

export type PartKind = 'lumber' | 'sheet' | 'bentlam' | 'printed' | 'metal' | 'purchased' | 'reference';

export type Fab =
  | 'table-saw'
  | 'bandsaw'
  | 'cnc'
  | 'shaper-origin'
  | 'laser'
  | 'print'
  | 'bentlam'
  | 'drill-tap'
  | 'buy'
  | 'none';

export type Geometry =
  /** Axis-aligned box centred on the local origin. */
  | { type: 'box'; size: Vec3 }
  /** Cylinder along local Z, centred on the local origin. */
  | { type: 'cylinder'; radius: number; length: number }
  /** Tire: torus-ish; along local Y (axle direction). */
  | { type: 'wheel'; diameter: number; width: number; hubDiameter: number }
  /** 2D profile in local XY (outer loop CCW, holes CW), extruded along +Z. */
  | { type: 'extrusion'; outline: Vec2[]; holes?: Vec2[][]; depth: number }
  /** Bent lamination: centreline path in local XZ, rectangular section. */
  | { type: 'sweep'; path: Vec2[]; width: number; thickness: number; plies: number }
  /** Pre-built triangle mesh (purchased parts, mannequin). */
  | { type: 'mesh'; positions: number[]; indices?: number[] };

export interface Dims {
  t: number;
  w: number;
  l: number;
}

export interface Part {
  id: string;
  name: string;
  group: PartGroup;
  kind: PartKind;
  material: string;
  stock?: Dims;
  rough?: Dims;
  geometry: Geometry;
  transform: Mat4;
  massLb: number;
  /** Mass-centre in the model frame; defaults to the transformed geometry centroid. */
  cgIn?: Vec3;
  removable?: boolean;
  fab: Fab;
  joinery?: string[];
  step: number;
  qty?: number;
  sourcing?: { vendor: string; url?: string; costUsd?: number; sku?: string };
  /** Exclude from empty-cart mass (rider, cargo, truck). */
  payload?: boolean;
  notes?: string;
}
