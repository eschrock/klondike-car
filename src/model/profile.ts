/**
 * Profile-extrusion parts (D-40, D-41): printed brackets and shaped oak blocks drawn as a 2D outline plus a depth.
 * The outline is in the part's local XY (outer loop CCW, holes CW) and is extruded along local +Z, so the same data goes
 * straight to an STL (Phase 4) or a CNC / Shaper Origin DXF. `basis` picks which world plane the outline lies in.
 */
import { woodMassLb, STEP, type Ctx } from './build-utils';
import type { Dims, Joint, Mat4, Part, PartGroup, Vec2, Vec3 } from './types';

/** Printed-part density: ASA 1.07 g/cm³ ≈ 66.8 lb/ft³ at 100%, times an assumed 60% effective fill (walls + 40% gyroid), D-41. */
export const PRINT_DENSITY_PCF = 66.8;
export const PRINT_FILL = 0.6;

/** Signed area of a polygon (positive = CCW). */
export function signedArea(o: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < o.length; i++) {
    const [x1, y1] = o[i];
    const [x2, y2] = o[(i + 1) % o.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function perimeter(o: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < o.length; i++) {
    const [x1, y1] = o[i];
    const [x2, y2] = o[(i + 1) % o.length];
    s += Math.hypot(x2 - x1, y2 - y1);
  }
  return s;
}

/**
 * Where the outline plane sits in the model frame:
 *  - 'xz': outline x → world x, outline y → world z, extruded toward −y from `origin` (origin.y is the +y face). Side-view profiles.
 *  - 'yz': outline x → world y, outline y → world z, extruded toward +x from `origin`. Flat plates against an x-facing face.
 *  - 'xy': outline in the horizontal plane, extruded up from `origin`.
 */
export type ProfileBasis = 'xz' | 'yz' | 'xy';

export function basisMatrix(basis: ProfileBasis, origin: Vec3): Mat4 {
  const [ox, oy, oz] = origin;
  switch (basis) {
    case 'xz': return [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, ox, oy, oz, 1];
    case 'yz': return [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, ox, oy, oz, 1];
    default: return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ox, oy, oz, 1];
  }
}

export interface ProfileSpec {
  id: string;
  partNo?: string;
  name: string;
  group: PartGroup;
  outline: Vec2[];
  holes?: Vec2[][];
  depth: number;
  basis: ProfileBasis;
  origin: Vec3;
  /** 'oak' = shaped white-oak block (mass from volume + finish); 'print' = printed (PETG / ASA). */
  mat: 'oak' | 'print';
  material?: string;
  grain?: 'x' | 'y' | 'z';
  stock?: Dims;
  removable?: boolean;
  joints?: Joint[];
  explode?: Vec3;
  step?: number;
  notes?: string;
  sourcing?: Part['sourcing'];
  fab?: Part['fab'];
}

export function profilePart(ctx: Ctx, s: ProfileSpec): Part {
  const { p } = ctx;
  const holeArea = (s.holes ?? []).reduce((m, h) => m + Math.abs(signedArea(h)), 0);
  const area = Math.abs(signedArea(s.outline)) - holeArea;
  const vol = area * s.depth;
  let massLb: number;
  if (s.mat === 'oak') {
    const faces = 2 * area + (perimeter(s.outline) + (s.holes ?? []).reduce((m, h) => m + perimeter(h), 0)) * s.depth;
    massLb = woodMassLb(p, vol, faces, p.oakDensityPcf);
  } else {
    massLb = (vol / 1728) * PRINT_DENSITY_PCF * PRINT_FILL;
  }
  const part: Part = {
    id: s.id,
    name: s.name,
    group: s.group,
    kind: s.mat === 'oak' ? 'lumber' : 'printed',
    material: s.material ?? (s.mat === 'oak' ? 'white oak' : 'ASA'),
    geometry: { type: 'extrusion', outline: s.outline.map((q) => [q[0], q[1]] as Vec2), ...(s.holes ? { holes: s.holes.map((h) => h.map((q) => [q[0], q[1]] as Vec2)) } : {}), depth: s.depth },
    transform: basisMatrix(s.basis, s.origin),
    body: 'chassis',
    massLb,
    fab: s.fab ?? (s.mat === 'oak' ? 'table-saw' : 'print'),
    step: s.step ?? STEP.finish,
    explode: s.explode ?? [0, 0, 1],
  };
  if (s.partNo) part.partNo = s.partNo;
  if (s.mat === 'oak') {
    if (s.grain) part.grain = s.grain;
    if (s.stock) {
      part.stock = s.stock;
      part.rough = { t: s.stock.t + p.millingAllowanceIn, w: s.stock.w + p.millingAllowanceIn, l: s.stock.l + p.millingAllowanceIn };
    }
  }
  if (s.removable) part.removable = true;
  if (s.joints) part.joints = s.joints;
  if (s.notes) part.notes = s.notes;
  if (s.sourcing) part.sourcing = s.sourcing;
  return part;
}
