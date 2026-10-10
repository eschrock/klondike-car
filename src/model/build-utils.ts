/**
 * Shared helpers for the subsystem builders: build context, part factories (box / cylinder),
 * wood / steel mass with finish (D-20), and steer-body placement about the kingpin.
 */
import { derived, PLY_SPECIES, type Params } from '../params';
import { computeLayout, type Layout } from './layout';
import { compose, multiply, rotationX, rotationY, rotationZ, translation } from './mat4';
import type { Dims, EdgeCondition, Fab, Joint, Mat4, Part, PartGroup, PartKind, RigidBody, Vec3 } from './types';

export interface ViewState {
  /** Displayed steer angle, degrees (+ = turning left). Clamped to ± lock. */
  steerDeg?: number;
  /** Which rider mass the mannequin carries. Default 'operating'. */
  rider?: 'none' | 'operating' | 'goal';
  /** Include the cargo block. Default true. */
  cargo?: boolean;
  /** Transport configuration: omit `removable` parts. */
  removed?: boolean;
}

export interface Ctx {
  p: Params;
  d: ReturnType<typeof derived>;
  L: Layout;
  view: Required<ViewState>;
  /** Steer angle in radians, clamped to ± lock. */
  steerRad: number;
  /** T(kingpin)·Rz(steer)·T(−kingpin): moves a neutral-frame steer-body part to its steered pose. */
  pivot: Mat4;
  plyName: string;
}

/** Assembly step numbers (build order). */
export const STEP = { gear: 1, steering: 2, frame: 3, body: 4, seatStorage: 5, brake: 6, finish: 7, payload: 8 } as const;

export function makeCtx(p: Params, v: ViewState = {}): Ctx {
  const L = computeLayout(p);
  const lock = Math.abs(p.steerLockDeg);
  const deg = Math.min(lock, Math.max(-lock, v.steerDeg ?? 0));
  const steerRad = (deg * Math.PI) / 180;
  const pivot = multiply(translation(L.WB, 0, 0), multiply(rotationZ(steerRad), translation(-L.WB, 0, 0)));
  return {
    p,
    d: derived(p),
    L,
    view: { steerDeg: deg, rider: v.rider ?? 'operating', cargo: v.cargo ?? true, removed: v.removed ?? false },
    steerRad,
    pivot,
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
  /** Neutral-frame placement that rotates with the front steer body. */
  steer?: boolean;
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
  /** World axis the cylinder runs along. */
  axis: 'x' | 'y' | 'z';
}

function placement(ctx: Ctx, s: PartSpec): Mat4 {
  const m = compose(s.center, s.rot);
  return s.steer ? multiply(ctx.pivot, m) : m;
}

function defaultExplode(group: PartGroup, c: Vec3): Vec3 {
  const z = group === 'running-gear' || group === 'steering' ? -1 : 1;
  const y = Math.abs(c[1]) > 6 ? Math.sign(c[1]) * 0.6 : 0;
  const n = Math.hypot(y, z);
  return [0, y / n, z / n];
}

function finalize(ctx: Ctx, s: PartSpec, geometry: Part['geometry'], massLb: number, dimsSorted: [number, number, number]): Part {
  const { p } = ctx;
  const kind: PartKind = s.kind ?? (s.mat === 'oak' ? 'lumber' : s.mat === 'ply' ? 'sheet' : s.mat === 'steel' ? 'metal' : 'purchased');
  const material =
    s.material ?? (s.mat === 'oak' ? 'white oak' : s.mat === 'ply' ? ctx.plyName : s.mat === 'steel' ? 'steel' : 'purchased');
  const wood = s.mat === 'oak' || s.mat === 'ply';
  const [t, w, l] = dimsSorted;
  const stock: Dims | undefined = s.stock === false ? undefined : s.stock ?? (wood ? { t, w, l } : undefined);
  const rough: Dims | undefined = wood && stock && s.mat === 'oak'
    ? { t: stock.t + p.millingAllowanceIn, w: stock.w + p.millingAllowanceIn, l: stock.l + p.millingAllowanceIn }
    : undefined;
  const fab: Fab = s.fab ?? (wood ? 'table-saw' : s.mat === 'steel' ? 'drill-tap' : 'buy');
  const out: Part = {
    id: s.id,
    name: s.name,
    group: s.group,
    kind,
    material,
    geometry,
    transform: placement(ctx, s),
    body: s.body ?? (s.steer ? 'steer' : 'chassis'),
    massLb,
    fab,
    step: s.step,
    explode: s.explode ?? defaultExplode(s.group, s.center),
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
  if (s.sourcing) out.sourcing = s.sourcing;
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
  const vol = Math.PI * s.radius * s.radius * s.length;
  const mass = s.mat === 'steel' ? (vol / IN3_PER_FT3) * p.steelDensityPcf : s.mat === 'oak' ? woodMassLb(p, vol, 2 * Math.PI * s.radius * (s.radius + s.length), p.oakDensityPcf) : s.massLb ?? 0;
  const rotAxis: Mat4 = s.axis === 'y' ? rotationX(Math.PI / 2) : s.axis === 'x' ? rotationY(Math.PI / 2) : rotationX(0);
  const base = compose(s.center, s.rot);
  const m = multiply(base, rotAxis);
  const part = finalize(ctx, s, { type: 'cylinder', radius: s.radius, length: s.length }, mass, [2 * s.radius, 2 * s.radius, s.length]);
  part.transform = s.steer ? multiply(ctx.pivot, m) : m;
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
