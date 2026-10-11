/**
 * Seat stowing (D-53, Eric): in cargo mode the seat back, the cushion, the two wedges, the two knobs and the two stud-hole plugs come off with no tools and
 * lie flat INSIDE the storage box, leaving a flat bed. This module is the one source for how they lie: `seatStowPlan` measures the real part bounding boxes
 * (not the nominal sizes), packs them into the box interior and reports the fit and its margins; `applySeatStow` moves the parts there for the viewer's
 * "stowed" state and the analysis. Plain math, no three.js.
 *
 * Packing (side view, box interior from the aft wall; the 3/8" corner fillets hold the lowest item 3/8" off the floor):
 *   top    the seat back, frame down and pad up, head toward the aft wall (its stile feet toward the fore end), centered fore-aft so it stays clear of the coaming
 *          ledge all round and rides above the 1 in insert backers at the fore end (their tops are trimmed to the underside of the back)
 *   bottom the cushion (peeled off its Dual Lock strips), flush to the aft wall so its fore end stops short of the backers
 *   beside both, on the floor in a strip along each side wall: a wedge lying on its long edge, then a knob with its stud pointing fore, and (seat off) the two
 *   hole plugs go into the inserts from the bed side.
 * The lid, its battens and its gasket stay clear: the free height is measured up to the underside of the lid frame and battens, not to the lid panel.
 */
import type { Params } from '../params';
import { localBounds, transformPoint, worldAABB } from './bounds';
import type { Layout } from './layout';
import { compose, multiply, rotationY, translation } from './mat4';
import { seatBackSupport } from './seat';
import { BACKER_IN, BOX_FILLET_IN, PLUG_LEN_IN, storageGeometry } from './storage';
import type { Mat4, Part, Vec3 } from './types';

/** Stud length of the seat-back knobs (3/8-16 × 3-1/2 in, D-40); it stows pointing fore, beside the cushion. */
export const KNOB_STUD_IN = 3.5;
/** Knob head: radius and thickness (seat.ts). */
const KNOB_R_IN = 0.5;
const KNOB_T_IN = 0.4;
/** Gap between neighbors in the side strips. */
const GAP_IN = 0.125;

export const isSeatBackPart = (id: string) => /^seat-back-(stile|rail|panel|pad)/.test(id);
const WEDGE_RE = /^seat-wedge-([LR])$/;
const KNOB_RE = /^seat-knob-([LR])$/;
const PLUG_RE = /^seat-plug-([LR])$/;

/** Ids of every part that moves when the seat is stowed. */
export function isStowedKitPart(id: string): boolean {
  return isSeatBackPart(id) || id === 'seat-cushion' || WEDGE_RE.test(id) || KNOB_RE.test(id) || PLUG_RE.test(id);
}

export interface Box3 { min: Vec3; max: Vec3 }

export interface StowItem {
  /** What it is, for the check text. */
  label: string;
  /** Part ids that move together. */
  ids: string[];
  /** Box of the item in its stowed pose (model frame). */
  box: Box3;
}

export interface StowPlan {
  /** False when the storage box is not behind the seat, or the seat parts are missing (nothing to stow). */
  applicable: boolean;
  /** Interior of the box that the pieces may use: x/y walls, the resting height (floor + fillet) and the free ceiling under the lid frame and battens. */
  interior: { x0: number; x1: number; y0: number; y1: number; zFloor: number; zRest: number; zCeil: number };
  /** Measured sizes (in) of the pieces as they lie: [fore-aft, across, up]. */
  sizes: { back: Vec3; cushion: Vec3; wedge: Vec3; knob: Vec3 };
  /** What the stow needs and what is left over (in). Positive margin = fits. */
  need: { lengthIn: number; widthIn: number; heightIn: number };
  margin: { lengthIn: number; widthIn: number; heightIn: number };
  fits: boolean;
  items: StowItem[];
  /** Rigid world transform that carries the back's frame to its stowed pose, and the stud-hole centers on the box end (seat off, plugs in). */
  backMove: Mat4;
  holes: Array<{ tag: 'L' | 'R'; center: Vec3 }>;
}

const col = (u: Vec3, v: Vec3, w: Vec3, o: Vec3): Mat4 => [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, w[0], w[1], w[2], 0, o[0], o[1], o[2], 1];
/** Inverse of a rigid (rotation + translation) matrix. */
function rigidInverse(m: Mat4): Mat4 {
  const t: Vec3 = [m[12], m[13], m[14]];
  const d = (a: number, b: number, c: number) => a * t[0] + b * t[1] + c * t[2];
  return [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, -d(m[0], m[1], m[2]), -d(m[4], m[5], m[6]), -d(m[8], m[9], m[10]), 1];
}

function cornersOf(part: Part): Vec3[] {
  const b = localBounds(part.geometry);
  const out: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push(transformPoint(part.transform, [x, y, z]));
  return out;
}

/** Where a stud's axis meets the outside face of the box's fore end (the plug goes there), per side. */
export function studHoles(p: Params, L: Layout): Array<{ tag: 'L' | 'R'; center: Vec3 }> {
  const s = L.seat;
  const sup = seatBackSupport(p, L);
  const g = storageGeometry(p, L);
  const zS = s.Pr[2] + s.col2[2] * sup.c2B;
  const xr = s.Pr[0] + s.col2[0] * sup.c2B;
  const dist = Math.max(0, (xr - g.x1) / s.col0[0]);
  const zE = zS - s.col0[2] * dist;
  return [{ tag: 'L', center: [g.x1, sup.knobY, zE] }, { tag: 'R', center: [g.x1, -sup.knobY, zE] }];
}

/**
 * Plan the stow from the INSTALLED part list (the real bounding boxes). Pure: it reads the parts and moves nothing.
 */
export function seatStowPlan(p: Params, L: Layout, parts: Part[]): StowPlan {
  const g = storageGeometry(p, L);
  const sup = seatBackSupport(p, L);
  const byId = new Map(parts.map((x) => [x.id, x]));
  const back = parts.filter((x) => isSeatBackPart(x.id));
  const cushion = byId.get('seat-cushion');
  const wedgeL = byId.get('seat-wedge-L'), wedgeR = byId.get('seat-wedge-R');
  const clear = p.seatStowClearIn;
  const interior = {
    x0: g.x0 + g.pl, x1: g.x1 - g.pl, y0: -(g.hw - g.pl), y1: g.hw - g.pl, zFloor: g.floorZ, zRest: g.floorZ + BOX_FILLET_IN,
    zCeil: g.zTop - g.pl - g.rimT,
  };
  const empty: StowPlan = {
    applicable: false, interior, sizes: { back: [0, 0, 0], cushion: [0, 0, 0], wedge: [0, 0, 0], knob: [0, 0, 0] }, need: { lengthIn: 0, widthIn: 0, heightIn: 0 },
    margin: { lengthIn: 0, widthIn: 0, heightIn: 0 }, fits: false, items: [], backMove: translation(0, 0, 0), holes: [],
  };
  if (!sup.rear || !back.length || !cushion || !wedgeL || !wedgeR) return empty;

  // Back extents in its own frame: u = thickness (front normal, pad side +), v = across, w = up the back (head +). From the part corners, so the pad, rails, stiles and panel are real.
  const s = L.seat;
  const u: Vec3 = s.col0, w: Vec3 = s.col2;
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const part of back) for (const c of cornersOf(part)) {
    const d: Vec3 = [c[0] - s.P[0], c[1] - s.P[1], c[2] - s.P[2]];
    const q: Vec3 = [dot(d, u), d[1], dot(d, w)];
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
  }
  const backSize: Vec3 = [hi[2] - lo[2], hi[1] - lo[1], hi[0] - lo[0]]; // lies: along x = head-to-foot, across, up = thickness
  const cb = worldAABB(cushion);
  const cushionSize: Vec3 = [cb.max[0] - cb.min[0], cb.max[1] - cb.min[1], cb.max[2] - cb.min[2]];
  const wb = worldAABB(wedgeL);
  const wedgeSize: Vec3 = [wb.max[2] - wb.min[2], wb.max[1] - wb.min[1], wb.max[0] - wb.min[0]]; // lies on its long edge: long axis fore-aft
  const knobSize: Vec3 = [KNOB_STUD_IN, 2 * KNOB_R_IN, 2 * KNOB_R_IN];

  const avail = { lengthIn: interior.x1 - interior.x0, widthIn: interior.y1 - interior.y0, heightIn: interior.zCeil - interior.zFloor };
  const stripW = wedgeSize[1] + GAP_IN + knobSize[1] + GAP_IN;
  // Fore-aft: the cushion (floor level) must stop short of the 1 in insert backers at the fore end; the back (above the backers) must clear the coaming ledge at both ends
  // (the ledge stands 'coamW - ply' inboard of the wall from the top of the ply wall up).
  const ledge = Math.max(0, g.coamW - g.pl);
  const need = {
    lengthIn: Math.max(cushionSize[0] + BACKER_IN + clear, backSize[0] + 2 * ledge + clear),
    widthIn: Math.max(backSize[1], cushionSize[1]) + 2 * stripW + clear,
    heightIn: BOX_FILLET_IN + cushionSize[2] + backSize[2],
  };
  const margin = { lengthIn: avail.lengthIn - need.lengthIn, widthIn: avail.widthIn - need.widthIn, heightIn: avail.heightIn - need.heightIn };
  const fits = margin.lengthIn >= -1e-9 && margin.widthIn >= -1e-9 && margin.heightIn >= -1e-9;

  // Poses. Head toward the aft wall.
  const xa = interior.x0 + clear / 2; // the cushion and the side strips, flush to the aft wall
  const zCushion = interior.zRest;
  const zBack = zCushion + cushionSize[2];
  const xb = interior.x0 + (avail.lengthIn - backSize[0]) / 2; // the back, centered
  const Ms = col([0, 0, 1], [0, 1, 0], [-1, 0, 0], [xb + hi[2], 0, zBack - lo[0]]); // u -> +z, v -> +y, w -> -x
  const Mb = col(u, [0, 1, 0], w, s.P);
  const backMove = multiply(Ms, rigidInverse(Mb));
  const half = cushionSize[1] / 2;
  const yWedge = half + GAP_IN; // the strip's inner edge
  const yKnob = yWedge + wedgeSize[1] + GAP_IN + KNOB_R_IN;
  const items: StowItem[] = [
    { label: 'seat back (frame, panel and pad)', ids: back.map((x) => x.id), box: { min: [xb, -backSize[1] / 2, zBack], max: [xb + backSize[0], backSize[1] / 2, zBack + backSize[2]] } },
    { label: 'seat cushion', ids: ['seat-cushion'], box: { min: [xa, -half, zCushion], max: [xa + cushionSize[0], half, zCushion + cushionSize[2]] } },
  ];
  for (const sg of [1, -1] as const) {
    const tag = sg > 0 ? 'L' : 'R';
    const y0 = sg > 0 ? yWedge : -(yWedge + wedgeSize[1]);
    items.push({ label: `wedge ${tag}`, ids: [`seat-wedge-${tag}`], box: { min: [xa, y0, interior.zRest], max: [xa + wedgeSize[0], y0 + wedgeSize[1], interior.zRest + wedgeSize[2]] } });
    items.push({ label: `knob and stud ${tag}`, ids: [`seat-knob-${tag}`], box: { min: [xa, sg * yKnob - KNOB_R_IN, interior.zRest], max: [xa + knobSize[0], sg * yKnob + KNOB_R_IN, interior.zRest + 2 * KNOB_R_IN] } });
  }
  return { applicable: true, interior, sizes: { back: backSize, cushion: cushionSize, wedge: wedgeSize, knob: knobSize }, need, margin, fits, items, backMove, holes: studHoles(p, L) };
}

function moveBy(part: Part, m: Mat4): void {
  part.transform = multiply(m, part.transform);
  if (part.cgIn) part.cgIn = transformPoint(m, part.cgIn);
}

/**
 * Put the seat kit into the box (the viewer's "stowed" state and the cargo-mode analysis). Mutates the parts of `parts` in place; does nothing when the box is not
 * behind the seat (the plan is not applicable).
 */
export function applySeatStow(p: Params, L: Layout, parts: Part[]): StowPlan {
  const plan = seatStowPlan(p, L, parts);
  if (!plan.applicable) return plan;
  const byId = new Map(parts.map((x) => [x.id, x]));
  for (const id of plan.items[0].ids) moveBy(byId.get(id)!, plan.backMove);
  // Cushion: slide, no turn, to its box corner.
  {
    const c = byId.get('seat-cushion')!;
    const b = worldAABB(c);
    const t = plan.items[1].box.min;
    moveBy(c, translation(t[0] - b.min[0], t[1] - b.min[1], t[2] - b.min[2]));
  }
  for (const it of plan.items.slice(2)) {
    const id = it.ids[0];
    const part = byId.get(id)!;
    if (WEDGE_RE.test(id)) {
      // Turn 90° about the vertical-plane y axis so the long (up) axis lies fore-aft, about its own bounding-box center, then put that box in its slot.
      const b = worldAABB(part);
      const c: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      const target: Vec3 = [(it.box.min[0] + it.box.max[0]) / 2, (it.box.min[1] + it.box.max[1]) / 2, (it.box.min[2] + it.box.max[2]) / 2];
      moveBy(part, multiply(translation(target[0], target[1], target[2]), multiply(rotationY(Math.PI / 2), translation(-c[0], -c[1], -c[2]))));
    } else if (KNOB_RE.test(id)) {
      // The head is a cylinder along x (the stud direction): lay it on the floor with the stud pointing fore, head at the aft end.
      const cx = it.box.min[0] + KNOB_T_IN / 2;
      part.transform = multiply(translation(cx, (it.box.min[1] + it.box.max[1]) / 2, it.box.min[2] + KNOB_R_IN), rotationY(Math.PI / 2));
    }
  }
  // Plugs: threaded into the inserts from the bed side, axis along the old stud direction (the back normal), 0.4" proud of the end wall.
  const a = Math.atan2(L.seat.col0[2], L.seat.col0[0]);
  for (const h of plan.holes) {
    const part = byId.get(`seat-plug-${h.tag}`);
    if (!part) continue;
    const d = PLUG_LEN_IN / 2;
    const c: Vec3 = [h.center[0] + Math.cos(a) * d, h.center[1], h.center[2] + Math.sin(a) * d];
    part.transform = multiply(compose(c, { y: -a }), rotationY(Math.PI / 2)); // a cylinder along the stud axis
  }
  return plan;
}
