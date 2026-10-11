/**
 * Shared helpers for the subsystem builders: build context, part factories (box / cylinder),
 * wood / steel mass with finish (D-20), and steer-body placement about the kingpin.
 */
import { derived, PLY_SPECIES, resolveParams, type Params } from '../params';
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
  /** T(kingpin)·Rz(steer)·T(−kingpin), kingpin at x = WB + kingpinLeadIn (D-25): moves a neutral-frame steer-body part to its steered pose. */
  pivot: Mat4;
  plyName: string;
}

/** Assembly step numbers (build order). */
export const STEP = { gear: 1, steering: 2, frame: 3, body: 4, seatStorage: 5, brake: 6, finish: 7, payload: 8 } as const;

export function makeCtx(input: Params, v: ViewState = {}): Ctx {
  const p = resolveParams(input); // every part sees the auto-resolved nose width / shoulder (A-4, D-26)
  const L = computeLayout(p);
  const lock = Math.abs(p.steerLockDeg);
  const deg = Math.min(lock, Math.max(-lock, v.steerDeg ?? 0));
  const steerRad = (deg * Math.PI) / 180;
  const pivot = multiply(translation(L.kx, 0, 0), multiply(rotationZ(steerRad), translation(-L.kx, 0, 0)));
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
    case 'steering':
      if (/^(tongue|bridle)/.test(id)) return unit([1, 0, -0.1]);
      if (id === 'kingpin' || /^kingpin-sleeve-beam/.test(id)) return unit([0.3, 0, -1]);
      if (id === 'kingpin-crossbar' || /^kingpin-sleeve-bar/.test(id)) return unit([0.3, 0, 1]);
      if (/^steer-stop/.test(id)) return unit([0.3, sy * 0.8, -0.6]);
      if (/^side-bearer/.test(id)) return unit([0.3, sy * 0.6, -0.8]);
      return unit([0.6, 0, -0.5]);
    case 'frame':
      return unit([fx * 0.6, Math.abs(c[1]) > 4 ? sy * 0.3 : 0, -0.6]);
    case 'body':
      if (/^deck/.test(id)) return unit([fx * 0.3, 0, 1]);
      if (/^side-/.test(id) || /^shoulder/.test(id)) return unit([0, sy * 1, 0.25]);
      if (/^transom-rear/.test(id)) return unit([-1, 0, 0.3]);
      if (/^transom-front/.test(id)) return unit([1, 0, 0.3]);
      if (/^prow/.test(id)) return unit([0.5, 0, 1]);
      if (/^grab/.test(id)) return unit([0, sy * 0.7, 1]);
      return unit([0, sy * 0.5, 0.8]);
    case 'seat':
      if (/^foot-stop/.test(id)) return unit([0.6, 0, 0.8]);
      if (/^seat-back/.test(id)) return unit([-0.7, 0, 1]);
      return unit([0, 0, 1]);
    case 'storage':
      if (/^storage-lid/.test(id)) return unit([-0.3, 0, 1]);
      return unit([-0.5, 0, 0.7]);
    case 'brake':
      if (/^brake-shoe|^brake-drum/.test(id)) return unit([0.2, sy * 1, 0.2]);
      return unit([-1, 0, -0.3]);
    case 'removable':
      if (/^handle/.test(id)) return unit([-1, 0, 0.3]);
      return unit([0, sy * 1, 0.4]);
    case 'lighting':
      if (id === 'rear-light') return unit([-1, 0, 0.5]);
      if (id === 'lantern-mount') return unit([0.6, 0, 1]);
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
    explode: s.explode ?? defaultExplode(ctx, s),
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
