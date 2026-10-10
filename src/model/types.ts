/**
 * Part schema. Model builders turn Params into Part[]; every downstream view
 * (viewer, analysis, sim, cut list, BOM, exports, assembly) reads only this.
 *
 * Geometry is expressed in the part's local frame, in inches; `transform`
 * places it in the model frame (+X forward, +Y left, +Z up, origin on the
 * ground under the rear-axle centre). Plain data — no three.js types — so the
 * model and analysis run headless in tests.
 *
 * One Part = one physical piece. Identical pieces are separate Parts (e.g.
 * wheel-FL, wheel-FR) so each has its own transform; the cut list and BOM
 * aggregate them by `partNo`. `massLb` is always for that single piece.
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

/**
 * Rigid body the part belongs to, for the physics sim and articulation.
 * 'steer' parts rotate with the front axle about the kingpin.
 */
export type RigidBody =
  | 'chassis'
  | 'steer'
  | 'wheel-FL'
  | 'wheel-FR'
  | 'wheel-RL'
  | 'wheel-RR'
  | 'rider'
  | 'cargo'
  | 'truck';

export type Geometry =
  /** Axis-aligned box centred on the local origin. */
  | { type: 'box'; size: Vec3 }
  /** Cylinder along local Z, centred on the local origin. */
  | { type: 'cylinder'; radius: number; length: number }
  /** Tire + hub; axle along local Y, centred on the local origin. */
  | { type: 'wheel'; diameter: number; width: number; hubDiameter: number; hubLength: number; bore: number }
  /** 2D profile in local XY (outer loop CCW, holes CW), extruded along +Z from z=0. */
  | { type: 'extrusion'; outline: Vec2[]; holes?: Vec2[][]; depth: number }
  /** Bent lamination: centreline path in local XZ, rectangular section (width along Y). */
  | { type: 'sweep'; path: Vec2[]; width: number; thickness: number; plies: number }
  /** Pre-built triangle mesh (purchased parts, mannequin, truck). */
  | { type: 'mesh'; positions: number[]; indices?: number[] };

export interface Dims {
  t: number;
  w: number;
  l: number;
}

export type JointType =
  | 'domino'
  | 'mortise-tenon'
  | 'bridle'
  | 'half-lap'
  | 'rabbet'
  | 'dado'
  | 'scarf'
  | 'glue'
  | 'bolt'
  | 'screw'
  | 'threaded-insert'
  | 'pin'
  | 'knob';

export interface Joint {
  type: JointType;
  /** Mating part id. */
  to: string;
  count: number;
  /** e.g. "10×50" (Domino), "1/4-20 × 2½" (bolt), "3/8 deep × 1/4" (rabbet). */
  size?: string;
  /** Local-frame locations of each joint, when known (for DXF holes / viewer cut previews). */
  at?: Vec3[];
  note?: string;
}

/** How each plywood edge is protected (acceptance: no exposed ply edges). */
export type EdgeCondition = 'captured' | 'edged' | 'exposed';

export interface Part {
  id: string;
  /** Shared by identical pieces; cut list/BOM aggregate on it. Defaults to id. */
  partNo?: string;
  name: string;
  group: PartGroup;
  kind: PartKind;
  material: string;
  stock?: Dims;
  rough?: Dims;
  /** Local axis the wood grain (or ply face grain) runs along. */
  grain?: 'x' | 'y' | 'z';
  /** Sheet parts: one entry per outline edge, or a single value for all edges. */
  edges?: EdgeCondition | EdgeCondition[];
  geometry: Geometry;
  transform: Mat4;
  body: RigidBody;
  massLb: number;
  /** Mass-centre in the model frame; defaults to the transformed geometry centroid. */
  cgIn?: Vec3;
  removable?: boolean;
  /** Unit direction (model frame) the part moves in the exploded view. */
  explode?: Vec3;
  fab: Fab;
  joints?: Joint[];
  /** Assembly step number where it is installed. */
  step: number;
  sourcing?: { vendor: string; url?: string; costUsd?: number; sku?: string };
  /** Not part of the empty cart (rider, cargo, truck). */
  payload?: boolean;
  notes?: string;
}

export interface AssemblyStep {
  n: number;
  title: string;
  instructions: string[];
  /** Glue, clamp and cure notes. */
  clampCure?: string;
  /** Camera preset for the step view. */
  view?: 'iso' | 'top' | 'side' | 'front' | 'under';
}

export interface CheckResult {
  id: string;
  label: string;
  value: number;
  unit: string;
  limit: number;
  /** How value is compared to limit. */
  sense: '>=' | '<=';
  /** 'marginal' = passes by < 10%; 'info' = reported, no limit. */
  status: 'pass' | 'marginal' | 'fail' | 'info';
  /** Which rider case this was evaluated at. */
  load?: 'empty' | 'operating' | 'goal';
  how: string;
  refs?: string[];
}
