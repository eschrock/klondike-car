/**
 * Part schema. Model builders turn Params into Part[]; every downstream view
 * (viewer, analysis, sim, cut list, BOM, exports, assembly) reads only this.
 *
 * Geometry is expressed in the part's local frame, in inches; `transform`
 * places it in the model frame (+X forward, +Y left, +Z up, origin on the
 * ground under the rear-axle center). Plain data — no three.js types — so the
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
  | 'front-end'
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
  | 'outsource' // cut by a waterjet / laser service (steel plate): not a shop operation
  | 'buy'
  | 'none';

/**
 * Rigid body the part belongs to, for the physics sim and articulation.
 * 'front-axle' is the pivoting front axle (D-56): the axle beam, stub axles, clamp plates, kingpin bolt, tongue and bridle, which turn together about the
 * kingpin with the front wheels ('wheel-FL' / 'wheel-FR'). The king beam, thrust washer and stop blocks are on the chassis.
 */
export type RigidBody =
  | 'chassis'
  | 'front-axle'
  | 'wheel-FL'
  | 'wheel-FR'
  | 'wheel-RL'
  | 'wheel-RR'
  | 'rider'
  | 'cargo'
  | 'truck';

export type Geometry =
  /** Axis-aligned box centerd on the local origin. */
  | { type: 'box'; size: Vec3 }
  /** Cylinder along local Z, centerd on the local origin. `wall` > 0 makes it a tube of that wall thickness (D-60: the hollow axles); 0 or absent = solid. */
  | { type: 'cylinder'; radius: number; length: number; wall?: number }
  /** Tire + hub; axle along local Y, centerd on the local origin. */
  | { type: 'wheel'; diameter: number; width: number; hubDiameter: number; hubLength: number; bore: number }
  /** 2D profile in local XY (outer loop CCW, holes CW), extruded along +Z from z=0. */
  | { type: 'extrusion'; outline: Vec2[]; holes?: Vec2[][]; depth: number }
  /** Bent lamination: centerline path in local XZ, rectangular section (width along Y). */
  | { type: 'sweep'; path: Vec2[]; width: number; thickness: number; plies: number }
  /** Pre-built triangle mesh (purchased parts, mannequin, truck). */
  | { type: 'mesh'; positions: number[]; indices?: number[]; /** A long thin wall (D-57 plan-curved hull members): the overlap tests cover it with boxes about this long (in) along x instead of one bounding box. */ slabs?: number; /** Wall thickness (in) of such a plan-curved member, for the finish's roundover cap. */ thickness?: number; /** The wall's (x, z) outline, so the overlap tests can clip a notch or a step exactly. */ profile?: Vec2[]; /** The wood grain follows the top edge of the outline (a bandsawn sheer gunwale) instead of running straight along x. Cosmetic. */ grainFollowsTop?: boolean; /** Explicit tight boxes (local min / max corners) for the overlap tests, when the mesh has a slot or a notch that its bounding box would fill (the slotted brake knee, D-65). Each box must lie inside the solid. */ boxes?: Array<[Vec3, Vec3]> };

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
  | 'knob'
  /** A drilled hole a cable, housing or wire passes through (the host part needs the hole; nothing is fastened). */
  | 'hole';

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
  /** Fastener shank diameter (in), for bolts / screws / inserts, so the analysis reads real fasteners (D-33). */
  diaIn?: number;
  /** Wood screws (D-72): the standard screw picked for the stack, so a test can hold every screw to its bite and its poke-through limit. */
  fit?: ScrewFit;
  /**
   * A cut in THIS part (the one that owns the joint), recorded so the drawings and the instructions can locate it. Use joint type `hole` (nothing is fastened, and the fastener counts skip it).
   * `slot`, `groove` and `relief` are a box from `lo` to `hi` in the part's local frame; `counterbore` is a round recess `dia` wide and `depth` deep at each `at` point, entering the face
   * the point lies on. `what` is the purpose in a few plain words ("to hold the kingpin nut and washer"; for a counterbore, what it holds: "the nut and washer of the knee bolts").
   */
  cut?: { kind: 'slot' | 'groove' | 'relief' | 'counterbore'; lo?: Vec3; hi?: Vec3; dia?: number; depth?: number; what: string };
}

/**
 * A wood screw against the stack it crosses (D-72). `gripIn` is what the screw passes through before the member it bites (leaves, plies, plates, a counterbore leaves less);
 * `receivingIn` is the thickness of the member the tip lands in (glued layers count together); `minBiteIn` is the engagement the joint needs. The bite is `lenIn - gripIn`.
 */
export interface ScrewFit {
  gauge: 6 | 8 | 10;
  lenIn: number;
  gripIn: number;
  receivingIn: number;
  minBiteIn: number;
}

/** Display finishing for a part (see `Part.finish`, D-44). */
export interface Finish {
  /** Radius of the roundover on the part's exposed edges (in). Box and extrusion parts. */
  roundoverIn?: number;
  /** Upholstered part: the viewer draws a soft, crowned pillow inside the geometry's bounds. */
  soft?: boolean;
  /** Wheel: draw a lugged tread on the tire. */
  tread?: 'lug' | 'rib';
  /** Surface look, when the material name alone is ambiguous. */
  surface?: 'oak' | 'okoume' | 'vinyl' | 'rubber' | 'steel' | 'aluminum' | 'asa' | 'rope' | 'blackened';
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
  /** Laminated member (D-62, build 3c S2): `stock` and `rough` are ONE strip and the part is this many strips glued face to face (1 = a single strip, such as a sandwich band bent onto the web). */
  plies?: number;
  /** Local axis the wood grain (or ply face grain) runs along. */
  grain?: 'x' | 'y' | 'z';
  /**
   * Cross-laminated part (D-75): the grain axis (local) of each face-glued layer, face layer first (the layer at the low end of the laminating axis, `stock.t`), so the drawings and the
   * cut list can show it. Absent = every layer runs along `grain`.
   */
  layerGrain?: Array<'x' | 'y' | 'z'>;
  /** Sheet parts: one entry per outline edge, or a single value for all edges. */
  edges?: EdgeCondition | EdgeCondition[];
  geometry: Geometry;
  transform: Mat4;
  body: RigidBody;
  massLb: number;
  /** Mass-center in the model frame; defaults to the transformed geometry centroid. */
  cgIn?: Vec3;
  removable?: boolean;
  /** Unit direction (model frame) the part moves in the exploded view. */
  explode?: Vec3;
  fab: Fab;
  joints?: Joint[];
  /** Assembly step number where it is installed. */
  step: number;
  sourcing?: { vendor: string; url?: string; costUsd?: number; sku?: string };
  /** Not part of the empty sled (rider, cargo, truck). */
  payload?: boolean;
  /**
   * Display finishing (D-44): how the viewer dresses the part. Analysis, mass and overlap tests ignore it, so it must
   * stay a small-scale cosmetic (edge roundover, cushion crown). Real shape changes go in `geometry`.
   */
  finish?: Finish;
  /** Lettering cut into a face (D-58: the storage lid is engraved DO NOT STEP). Data for the CNC file and, later, the viewer; no geometry. */
  legend?: { text: string; face: 'top'; process: string; letterHeightIn: number; depthIn: number; /** Width of the scored line (in): the laser scores each stroke as passes side by side. Absent = one pass. */ lineIn?: number };
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
  load?: 'empty' | 'operating' | 'goal' | 'cargo';
  how: string;
  refs?: string[];
}
