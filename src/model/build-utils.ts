/**
 * Shared helpers for the subsystem builders: build context, part factories (box / cylinder),
 * wood / steel mass with finish (D-20), and rigid-body placement of the steered parts (Ackermann poses).
 */
import { derived, PLY_SPECIES, resolveParams, type Params } from '../params';
import { computeLayout, type Layout } from './layout';
import { compose, multiply, rotationX, rotationY } from './mat4';
import type { Dims, EdgeCondition, Fab, Joint, Mat4, Part, PartGroup, PartKind, RigidBody, Vec2, Vec3 } from './types';

export interface ViewState {
  /** Displayed steering angle of the front axle, degrees (+ = turning left), clamped to the lock (D-56). Default 0. */
  steerDeg?: number;
  /** Which rider mass the mannequin carries. Default 'operating'. */
  rider?: 'none' | 'operating' | 'goal';
  /** Include the cargo block. Default true. */
  cargo?: boolean;
  /** Transport configuration: omit `removable` parts. */
  removed?: boolean;
  /** The brake flap kit (flaps, pivot blocks, pins, clips, shoe blocks, pads, foot treads, cords, snap hooks) is on the sled. Default true; false hides it (the knees and backers stay), D-65. */
  brakes?: boolean;
  /** The lights (front lamp and clip, rear light and clip) are on the sled. Default true, D-65. */
  lights?: boolean;
  /** The wheel chocks (and their cords) hang at the rear tires. Default true; the viewer builds with false until its Wheel chocks toggle asks (they ride in the box), D-65. */
  chocks?: boolean;
  /**
   * Cargo mode (D-53, D-57): 'stowed' (shown as "seat flat") flips the seat back forward onto the deck and lays the two cushions flat inside the storage box (no rider; `cargo`
   * then shows the payload on the bed instead of the Essentials block). Default 'installed'.
   */
  seat?: 'installed' | 'stowed';
  /** Rear handlebow (D-57): 'up' at the riding pin position, 'parked' dropped to the second pin position so the bow rests just above the rear side top. Default 'up'. */
  handle?: 'up' | 'parked';
}

export interface Ctx {
  p: Params;
  d: ReturnType<typeof derived>;
  L: Layout;
  view: Required<ViewState>;
  /** Steering angle in radians (clamped to the lock). */
  steerRad: number;
  plyName: string;
}

/**
 * Assembly step numbers (build order). The hull comes first (frame 3, then the fractional hull steps 4.0-4.4 below); the front beam and kingpin brackets
 * (4.6), then the axles (gear 4.6) are fitted to it afterwards, while the hull is still upside down: the front beam's hold-down angles and the rear beam bolt to
 * the rail undersides, reachable only after the deck exists (r3 build S10). Then the hull is turned upright, the spindles, steering linkage and tongue go on
 * (4.7, 4.9), and the seat and storage (5), the brake (6) and the finish (7) follow.
 */
export const STEP = { frame: 3, body: 4, steering: 4.5, gear: 4.6, linkage: 4.7, spindles: 4.9, seatStorage: 5, brake: 6, finish: 7, payload: 8 } as const;
/** D-54 build order note: `steering` (4.5) is the bow, `spindles` (4.9) the tongue plate, bridle and steering ropes, bolted on with the hull upright (D-56). */

/**
 * Hull assembly sequence (build review M4 / MUST-2, D-43, D-45; rewritten for the sandwich sides at D-61/D-62, build 3c S1/S10). `Part.step` is where a part is INSTALLED; the hull
 * sequence is fractional between the frame (3) and the seat and storage (5), so Phase 4 can sort on it. The hull is built UPSIDE DOWN so that every move is a straight vertical one,
 * which works for the curved sides too (a curved side cannot slide inboard onto a curved deck edge):
 *   0. Epoxy-seal every dado, the deck faces and edges and all ply faces (a process step, before the bench glue-ups; wash or sand the amine blush off any face that will be glued again).
 *      The deck gap under the inner chine band and the dados are the (sealed) deck + a clearance (deckSlopIn) tall: thickened epoxy fills the gap. The deck is also cut deckSideClearIn
 *      (1/16 in) narrower than the gap between the two webs on each side (D-63), so a rigid sheet drops between two bent webs; thickened epoxy fills that slot too.
 *   1. (4.0) Forms: one S-form (two 3/4" MDF cauls) for the plan turn-in. Cut each one-piece 4 mm web (D-68) to the flat
 *      development of the sheer, glue the sign backing strips inside them.
 *   2. (4.0) Frame (rails, joists, king beam) + deck glued as a unit, right side up on the bench; the Domino mortises in the rail tops are cut. The rails are two 3/8 strips bent on the form, glued into the frame 1/2" LONG at both ends (they are trimmed in step 3, once the true length is known).
 *   3. (4.2) Side assemblies on the bench: each web gets an oak band glued on EACH face at the chine and at the gunwale and is bent with them on the form (no grooves); vents drilled.
 *      GLUE-UP POSTURE (3c-8; a web with four bands is a two-direction bend: the sheer in the plane of the web, the S across it): lay the web FLAT on the bench with the S-ramp form
 *      under the bow end, where the S-bend is and the web is only about 5 in tall (the ramp's rise and length come from the D-66 bow taper, `L.taper`; see `src/build/forms.ts`); CLEAT THE SHEER LINE (screws or cleats into a sacrificial
 *      table every 4 to 5 in, the whole length), because a straight 1.5 in strip edge-bent to the sheer pushes sideways about 65 lbf at mid-span per band until the epoxy cures; glue and
 *      clamp ONE FACE per cure (its chine and gunwale bands; C-clamps or spring clamps across the band every 4 to 5 in, about 14 per band pair; brads or a vacuum bag if short), let it
 *      cure, flip the web onto the mirror ramp and do the other face: TWO CURES PER SIDE. Bend-test a dry strip on the form first.
 *      The two side assemblies stand inverted in the jig. DRY-FIT the frame + deck unit and both side assemblies, MEASURE from the rear transom dado to the bow bulkhead dado, and cut the
 *      bands and webs to that length less 1/32" and trim the frame unit's rails (left 1/2 in long in step 2) to match (S1); rehearse the close.
 *   4. (4.2) The frame + deck unit is turned over and LOWERED into the inverted side assemblies: the Dominos (all vertical) engage, the deck edge rises into the gap under the inner chine
 *      band, epoxy bed, screws up through the rails.
 *   5. (4.4) Close ONE end first: glue and clamp the rear transom (its stopped dados take the web ends, its deck dado the deck), let it kick, then bring in the bow bulkhead with a
 *      second batch of slow (120-minute) epoxy. The vent holes let the dados breathe. Backers are glued to the transom first. Two pipe clamps along the length.
 *   6. (STEP.steering 4.5, STEP.gear 4.6) With the hull still inverted and the deck underside facing up: fit the front beam, kingpin and the axle clamp plates, then the axles and wheels
 *      (flipping the finished hull with axles and wheels is about 100 lb: four people and padded horses). THEN turn the hull upright and fit the tongue, bridle, linkage (STEP.linkage 4.7,
 *      STEP.spindles 4.9), the seat and storage (5), the brake (6) and the finish (7).
 */
/** Thickness of the 316 backing strip under the grab-board screw heads, on the outer gunwale band (D-63). The side signs hang this much farther out, so they clear it. */
export const GRIP_BACKING_T_IN = 0.0625;
export const HULL_STEP = { deck: 4, sides: 4.2, transom: 4.4 } as const;

/** Rough (as-milled-from-the-board) size of a finished wood piece: thickness and width + the allowance, length + 4× (≈ ½", build review M8). */
export function roughOf(p: Params, s: Dims): Dims {
  return { t: s.t + p.millingAllowanceIn, w: s.w + p.millingAllowanceIn, l: s.l + 4 * p.millingAllowanceIn };
}

/** Default sourcing of a steel bar, plate or rod part nobody gave a source (build review M9): McMaster-class stock cut to length. */
export const STEEL_STOCK_SOURCING = { vendor: 'McMaster-Carr (A36 steel bar / plate / rod stock, cut to length)' } as const;

export function makeCtx(input: Params, v: ViewState = {}): Ctx {
  const p = resolveParams(input);
  const L = computeLayout(p);
  const lock = Math.abs(p.steerLockDeg);
  const steerDeg = Math.min(lock, Math.max(-lock, v.steerDeg ?? 0));
  return {
    p,
    d: derived(p),
    L,
    steerRad: (steerDeg * Math.PI) / 180,
    view: { steerDeg, rider: v.seat === 'stowed' ? 'none' : v.rider ?? 'operating', cargo: v.cargo ?? true, removed: v.removed ?? false, brakes: v.brakes ?? true, lights: v.lights ?? true, chocks: v.chocks ?? true, seat: v.seat ?? 'installed', handle: v.handle ?? 'up' },
    plyName: p.plySpecies === PLY_SPECIES.okoumeMarine ? 'okoume marine plywood' : 'baltic birch plywood',
  };
}

export const IN3_PER_FT3 = 1728;
export const IN2_PER_FT2 = 144;

export const boxVolume = (s: Vec3) => s[0] * s[1] * s[2];
export const boxArea = (s: Vec3) => 2 * (s[0] * s[1] + s[1] * s[2] + s[0] * s[2]);

/** Wood mass: volume × density + all-face area × finish (D-20). */
export function woodMassLb(p: Params, volIn3: number, areaIn2: number, densityPcf: number): number {
  return (volIn3 / IN3_PER_FT3) * densityPcf + (areaIn2 / IN2_PER_FT2) * p.finishLbPerFt2;
}

export type Mat = 'oak' | 'ply' | 'steel' | 'fixed';

export interface PartSpec {
  id: string;
  name: string;
  group: PartGroup;
  center: Vec3;
  rot?: { x?: number; y?: number; z?: number };
  body?: RigidBody;
  mat: Mat;
  /** Required for mat = 'fixed' (purchased / printed / computed). */
  massLb?: number;
  kind?: PartKind;
  material?: string;
  partNo?: string;
  fab?: Fab;
  step: number;
  explode?: Vec3;
  removable?: boolean;
  payload?: boolean;
  notes?: string;
  /** Lettering engraved into a face (D-58: DO NOT STEP on the storage lid). */
  legend?: Part['legend'];
  grain?: 'x' | 'y' | 'z';
  edges?: EdgeCondition | EdgeCondition[];
  joints?: Joint[];
  stock?: Dims | false;
  sourcing?: Part['sourcing'];
  cgIn?: Vec3;
}

export interface BoxSpec extends PartSpec {
  size: Vec3;
}

export interface CylSpec extends PartSpec {
  radius: number;
  length: number;
  /** Wall thickness (in) of a hollow tube (D-60 axles); 0 or absent = a solid rod. Only the steel and oak mass follow it. */
  wall?: number;
  /** World axis the cylinder runs along. */
  axis: 'x' | 'y' | 'z';
}

/** A direction as a unit vector (the exploded view moves parts by a distance along it); undefined stays undefined, a zero vector stays zero. */
export function unitDir(v: Vec3 | undefined): Vec3 | undefined {
  if (!v) return undefined;
  const n = Math.hypot(...v);
  return n < 1e-9 ? [0, 0, 0] : [v[0] / n, v[1] / n, v[2] / n];
}

function placement(_ctx: Ctx, s: PartSpec): Mat4 {
  return compose(s.center, s.rot);
}

/**
 * Exploded-view direction by subsystem (unit vector, model frame). Parts separate along the way they would
 * come apart: running gear down and outward, steering forward-down, frame down and spread fore/aft, sides outward,
 * seat and storage up, removable parts outward, payload none.
 */
function defaultExplode(ctx: Ctx, s: PartSpec): Vec3 {
  const { L } = ctx;
  const c = s.center;
  const unit = (v: Vec3): Vec3 => {
    const n = Math.hypot(...v);
    return n < 1e-9 ? [0, 0, 0] : [v[0] / n, v[1] / n, v[2] / n];
  };
  if (s.payload) return [0, 0, 0];
  const sy = c[1] >= 0 ? 1 : -1;
  const mid = (L.xRear + L.xFront) / 2;
  const half = Math.max(1, (L.xFront - L.xRear) / 2);
  const fx = Math.max(-1, Math.min(1, (c[0] - mid) / half));
  const id = s.id;
  switch (s.group) {
    case 'running-gear':
      if (id.startsWith('wheel')) return unit([0, sy * 1, -0.25]);
      if (id.startsWith('clamp')) return unit([0, sy * 0.6, -1]);
      return unit([fx * 0.3, 0, -1]);
    case 'front-end':
      if (/^(bridle|eyebolt)/.test(id)) return unit([1, 0, 0.1]);
      if (/^bow-/.test(id)) return unit([1, 0, 0.5]);
      return unit([0.3, 0, -0.8]);
    case 'frame':
      return unit([fx * 0.6, Math.abs(c[1]) > 4 ? sy * 0.3 : 0, -0.6]);
    case 'body':
      if (/^deck/.test(id)) return unit([fx * 0.3, 0, 1]);
      if (id === 'bow-bulkhead') return unit([1, 0, 0.3]);
      if (/^side-/.test(id)) return unit([0, sy * 1, 0.25]);
      if (/^transom-rear/.test(id)) return unit([-1, 0, 0.3]);
      return unit([0, sy * 0.5, 0.8]);
    case 'seat':
      if (/^foot-stop/.test(id)) return unit([0.6, 0, 0.8]);
      if (/^seat-back/.test(id)) return unit([-0.7, 0, 1]);
      return unit([0, 0, 1]);
    case 'storage':
      if (/^storage-lid/.test(id)) return unit([-0.3, 0, 1]);
      return unit([-0.5, 0, 0.7]);
    case 'brake':
      if (/^brake-(flap|shoe|pad|cord)/.test(id)) return unit([-0.4, sy * 0.5, 1]);
      if (/^brake-knee/.test(id)) return unit([0.3, sy * 1, 0.4]);
      if (/^brake-backer/.test(id)) return unit([0, -sy * 0.3, -1]);
      if (/^brake-chock/.test(id)) return unit([1, sy * 0.3, 0]);
      return unit([-1, 0, -0.3]);
    case 'removable':
      if (/^handle/.test(id)) return unit([-1, 0, 0.3]);
      return unit([0, sy * 1, 0.4]);
    case 'lighting':
      if (id === 'rear-light') return unit([-1, 0, 0.5]);
      if (id === 'lamp-clip') return unit([0.8, 0, 0.3]);
      if (id === 'rear-lamp-clip') return unit([-0.8, 0, 0.3]);
      return unit([0, sy * 1, 0.2]);
    case 'hardware':
      return [0, 0, -1];
    default:
      return [0, 0, 0];
  }
}

function finalize(ctx: Ctx, s: PartSpec, geometry: Part['geometry'], massLb: number, dimsSorted: [number, number, number]): Part {
  const { p } = ctx;
  const kind: PartKind = s.kind ?? (s.mat === 'oak' ? 'lumber' : s.mat === 'ply' ? 'sheet' : s.mat === 'steel' ? 'metal' : 'purchased');
  const material =
    s.material ?? (s.mat === 'oak' ? 'white oak' : s.mat === 'ply' ? ctx.plyName : s.mat === 'steel' ? 'steel' : 'purchased');
  const wood = s.mat === 'oak' || s.mat === 'ply';
  const [t, w, l] = dimsSorted;
  // Steel bar / plate / rod: the stock is the section × the cut length (build review M9), unless the builder says otherwise.
  const stock: Dims | undefined = s.stock === false ? undefined : s.stock ?? (wood || s.mat === 'steel' ? { t, w, l } : undefined);
  const rough: Dims | undefined = wood && stock && s.mat === 'oak' ? roughOf(p, stock) : undefined;
  const fab: Fab = s.fab ?? (wood ? 'table-saw' : s.mat === 'steel' ? 'drill-tap' : 'buy');
  const out: Part = {
    id: s.id,
    name: s.name,
    group: s.group,
    kind,
    material,
    geometry,
    transform: placement(ctx, s),
    body: s.body ?? 'chassis',
    massLb,
    fab,
    step: s.step,
    explode: unitDir(s.explode) ?? defaultExplode(ctx, s),
  };
  if (s.partNo) out.partNo = s.partNo;
  if (stock) out.stock = stock;
  if (rough) out.rough = rough;
  if (wood && s.grain) out.grain = s.grain;
  if (s.edges) out.edges = s.edges;
  if (s.joints) out.joints = s.joints;
  if (s.removable) out.removable = true;
  if (s.payload) out.payload = true;
  if (s.notes) out.notes = s.notes;
  if (s.legend) out.legend = s.legend;
  if (s.sourcing) out.sourcing = s.sourcing;
  else if (s.mat === 'steel') out.sourcing = { ...STEEL_STOCK_SOURCING };
  if (s.cgIn) out.cgIn = s.cgIn;
  return out;
}

/** Longest local axis for grain. */
function longAxis(size: Vec3): 'x' | 'y' | 'z' {
  return size[0] >= size[1] && size[0] >= size[2] ? 'x' : size[1] >= size[2] ? 'y' : 'z';
}

export function box(ctx: Ctx, s: BoxSpec): Part {
  const { p } = ctx;
  const vol = boxVolume(s.size);
  const area = boxArea(s.size);
  let mass: number;
  switch (s.mat) {
    case 'oak': mass = woodMassLb(p, vol, area, p.oakDensityPcf); break;
    case 'ply': mass = woodMassLb(p, vol, area, ctx.d.plyDensityPcf); break;
    case 'steel': mass = (vol / IN3_PER_FT3) * p.steelDensityPcf; break;
    default: mass = s.massLb ?? 0;
  }
  const sorted = [...s.size].sort((a, b) => a - b) as [number, number, number];
  const part = finalize(ctx, { ...s, grain: s.grain ?? longAxis(s.size) }, { type: 'box', size: [...s.size] as Vec3 }, mass, sorted);
  if (s.mat !== 'oak' && s.mat !== 'ply') delete part.grain;
  return part;
}

export function cylinder(ctx: Ctx, s: CylSpec): Part {
  const { p } = ctx;
  const wall = Math.min(Math.max(0, s.wall ?? 0), s.radius);
  const vol = Math.PI * (wall > 0 ? s.radius * s.radius - (s.radius - wall) ** 2 : s.radius * s.radius) * s.length; // a tube's wall annulus, or the solid rod
  const mass = s.mat === 'steel' ? (vol / IN3_PER_FT3) * p.steelDensityPcf : s.mat === 'oak' ? woodMassLb(p, vol, 2 * Math.PI * s.radius * (s.radius + s.length), p.oakDensityPcf) : s.massLb ?? 0;
  const rotAxis: Mat4 = s.axis === 'y' ? rotationX(Math.PI / 2) : s.axis === 'x' ? rotationY(Math.PI / 2) : rotationX(0);
  const base = compose(s.center, s.rot);
  const m = multiply(base, rotAxis);
  const part = finalize(ctx, s, { type: 'cylinder', radius: s.radius, length: s.length, ...(wall > 0 ? { wall } : {}) }, mass, [2 * s.radius, 2 * s.radius, s.length]);
  part.transform = m;
  delete part.grain;
  return part;
}

/** Box whose local x axis runs from a to b in the XZ plane (rotated about Y). */
export function segment(a: Vec3, b: Vec3, thickY: number, thickZ: number): { size: Vec3; center: Vec3; rot: { y: number } } {
  const dx = b[0] - a[0], dz = b[2] - a[2];
  const L = Math.hypot(dx, dz);
  return {
    size: [Math.max(0.01, L), thickY, thickZ],
    center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    rot: { y: -Math.atan2(dz, dx) },
  };
}

/** Axis-aligned x/y/z interval helpers: build a box spec's size+center from ranges. */
export function span(x: [number, number], y: [number, number], z: [number, number]): { size: Vec3; center: Vec3 } {
  const s = (r: [number, number]) => Math.max(0.01, r[1] - r[0]);
  return {
    size: [s(x), s(y), s(z)],
    center: [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2],
  };
}

/** Mirror helper: [+1, −1] for left / right. */
export const SIDES: ReadonlyArray<{ s: 1 | -1; tag: 'L' | 'R' }> = [
  { s: 1, tag: 'L' },
  { s: -1, tag: 'R' },
];


/** A member of constant section bent in PLAN along a hull-side curve (D-45): chine, gunwale, ladder rail, side panel. Sweep geometry, path in plan. */
export interface BandSpec {
  id: string;
  partNo?: string;
  name: string;
  group: PartGroup;
  mat: 'oak' | 'ply';
  /** Side sign (+1 left) and the |y| centerline samples (x, |y|) of the member. */
  s: 1 | -1;
  path: Vec2[];
  /** In-plan thickness, height (vertical) and the z of its center. */
  t: number;
  h: number;
  zc: number;
  plies: number;
  step: number;
  grain?: 'x' | 'y' | 'z';
  edges?: EdgeCondition | EdgeCondition[];
  extraLb?: number;
  removable?: boolean;
  notes?: string;
}

export function bandPart(ctx: Ctx, b: BandSpec): Part {
  const { p } = ctx;
  let len = 0;
  for (let i = 1; i < b.path.length; i++) len += Math.hypot(b.path[i][0] - b.path[i - 1][0], b.path[i][1] - b.path[i - 1][1]);
  const vol = b.t * b.h * len;
  const surf = 2 * len * (b.t + b.h) + 2 * b.t * b.h;
  const oak = b.mat === 'oak';
  const mass = woodMassLb(p, vol, surf, oak ? p.oakDensityPcf : ctx.d.plyDensityPcf) + (b.extraLb ?? 0);
  const stock: Dims = { t: Math.min(b.t, b.h), w: Math.max(b.t, b.h), l: len };
  const cx = b.path.reduce((a, q) => a + q[0], 0) / b.path.length;
  const cy = b.path.reduce((a, q) => a + q[1], 0) / b.path.length;
  let lx = 0, ly = 0;
  for (let i = 1; i < b.path.length; i++) {
    const w = Math.hypot(b.path[i][0] - b.path[i - 1][0], b.path[i][1] - b.path[i - 1][1]);
    lx += (w * (b.path[i][0] + b.path[i - 1][0])) / 2;
    ly += (w * (b.path[i][1] + b.path[i - 1][1])) / 2;
  }
  lx /= Math.max(1e-9, len);
  ly /= Math.max(1e-9, len);
  const out: Part = {
    id: b.id,
    name: b.name,
    group: b.group,
    kind: oak ? 'bentlam' : 'sheet',
    material: oak ? 'white oak' : ctx.plyName,
    // local x → model X, local y (width) → model Z, local z → −Y: a plan path (x, |y|) becomes (x, −s·|y|).
    geometry: { type: 'sweep', path: b.path.map(([x, y]) => [x, -b.s * y] as Vec2), width: b.h, thickness: b.t, plies: b.plies },
    transform: [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, b.zc, 1],
    body: 'chassis',
    massLb: mass,
    fab: 'bentlam',
    step: b.step,
    stock,
    // Reuse the subsystem's default exploded-view direction through a throwaway box at the same place.
    explode: box(ctx, { id: b.id, name: b.name, group: b.group, mat: 'oak', size: [1, 1, 1], center: [cx, b.s * cy, b.zc], step: b.step }).explode,
    cgIn: [lx, b.s * ly, b.zc], // length-weighted centroid of the path (the bounding box center of a curved member is far from it)
  };
  if (b.partNo) out.partNo = b.partNo;
  if (oak) out.rough = roughOf(p, stock);
  if (b.grain ?? 'x') out.grain = b.grain ?? 'x';
  if (b.edges) out.edges = b.edges;
  if (b.removable) out.removable = true;
  if (b.notes) out.notes = b.notes;
  return out;
}
