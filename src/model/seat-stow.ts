/**
 * Cargo mode of the seat (D-57, Eric; it replaced the D-53 "kit lies in the box"): the SEAT BACK stays on the sled. It FLIPS FORWARD about its hinge onto the deck and is
 * held flat by the same quick-release pins; it never goes in the box. Only the two CUSHIONS (the seat cushion and the back pad, both on Dual Lock) lie flat in the storage
 * box, together with the 10 Essentials. This module is the one source for how they lie: `seatStowPlan` measures the real part bounding boxes, packs the cushions into the box
 * interior and reports the fit and its margins (and what is left for the Essentials); `applySeatStow` moves the parts for the viewer's "flat" state and the analysis.
 * Plain math, no three.js.
 *
 * Packing (side view, box interior from the aft wall; the 3/8" corner fillets hold the lowest item 3/8" off the floor): the seat cushion on the floor flush to the aft wall,
 * the back pad on top of it, face up. The lid, its battens and its gasket stay clear: the free height is measured up to the underside of the lid frame and battens.
 * The back: rotated forward about the hinge axis (the stile's front foot, along y) through 90 degrees + the recline, so its front face lies on the deck and its rear face is up;
 * it then lies flat from the hinge to `seatBackHeightIn` ahead of it, `BACK_THICK` proud of the deck.
 */
import type { Params } from '../params';
import { localBounds, transformPoint, worldAABB } from './bounds';
import type { Layout } from './layout';
import { multiply, rotationY, translation } from './mat4';
import { PIN_HEAD_IN, PIN_LEN_IN, PIN_R_IN, seatBackSupport } from './seat';
import { BOX_FILLET_IN, storageGeometry } from './storage';
import type { Mat4, Part, Vec3 } from './types';

/** The back frame parts that rotate about the hinge when it flips (the pad comes off and goes in the box; the pins ride with it). */
export const isSeatBackPart = (id: string) => /^seat-back-(stile|rail|panel)/.test(id);
const PAD_ID = 'seat-back-pad';
const PIN_RE = /^seat-pin-([LR])$/;

/** Ids of every part that moves when the seat goes to its cargo pose. */
export function isStowedKitPart(id: string): boolean {
  return isSeatBackPart(id) || id === 'seat-cushion' || id === PAD_ID || PIN_RE.test(id);
}
/** The parts that lie in the box in cargo mode. */
export const isBoxedCushion = (id: string): boolean => id === 'seat-cushion' || id === PAD_ID;

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
  /** False when the storage box is not behind the seat, or the cushions are missing (nothing to stow). */
  applicable: boolean;
  /** Interior of the box that the cushions may use: x/y walls, the resting height (floor + fillet) and the free ceiling under the lid frame and battens. */
  interior: { x0: number; x1: number; y0: number; y1: number; zFloor: number; zRest: number; zCeil: number };
  /** Measured sizes (in) of the pieces as they lie: [fore-aft, across, up]. */
  sizes: { back: Vec3; cushion: Vec3; pad: Vec3 };
  /** What the stow needs and what is left over (in). Positive margin = fits. */
  need: { lengthIn: number; widthIn: number; heightIn: number };
  margin: { lengthIn: number; widthIn: number; heightIn: number };
  fits: boolean;
  /** Volume (in³) of the interior under the lid frame left after the cushions, and the volume of the cushions. */
  freeIn3: number;
  cushionsIn3: number;
  items: StowItem[];
  /** Rigid world transform of the flip: the back's frame to its flat pose (about the hinge, onto the deck). */
  backMove: Mat4;
  /** The flat back: x range (hinge to head), the top (rear face) z, and the stile pin holes where the flat latch pins go down into the deck. */
  flat: { x0: number; x1: number; zTop: number; pins: Array<{ tag: 'L' | 'R'; center: Vec3 }> };
}

/** Rigid world transform that flips the back forward about the hinge axis (the stile's front foot P, along y) onto the deck. */
export function backFlipMove(p: Params, L: Layout): Mat4 {
  const s = L.seat;
  const phi = Math.PI / 2 + (p.seatBackAngleDeg * Math.PI) / 180;
  const P = s.P;
  const lower = L.deckTop - P[2]; // the upright back rests on its rear corner, so the knuckle is a little above the deck: the flat back lies ON the deck
  return multiply(translation(0, 0, lower), multiply(translation(P[0], 0, P[2]), multiply(rotationY(phi), translation(-P[0], 0, -P[2]))));
}

function cornersOf(part: Part): Vec3[] {
  const b = localBounds(part.geometry);
  const out: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push(transformPoint(part.transform, [x, y, z]));
  return out;
}

/** Where each latch pin goes when the back is flat: vertically down through its stile (the pin hole) into the deck. */
export function flatPinHoles(p: Params, L: Layout): Array<{ tag: 'L' | 'R'; center: Vec3 }> {
  const s = L.seat;
  const sup = seatBackSupport(p, L);
  const M = backFlipMove(p, L);
  // The pin hole is at c2L up the stile, mid-thickness; its flat position is the image of that point.
  const mid = (c0: number, c2: number, y: number): Vec3 => [s.P[0] + s.col0[0] * c0 + s.col2[0] * c2, y, s.P[2] + s.col0[2] * c0 + s.col2[2] * c2];
  return ([['L', 1], ['R', -1]] as const).map(([tag, sg]) => ({ tag, center: transformPoint(M, mid(-p.seatBackThickIn / 2, sup.c2L, sg * sup.stileY)) }));
}

/**
 * The clearance hole the flat-position latch pin needs through the 12 mm deck (D-63): with the back flipped flat, each pin goes down through the panel AND the deck into the blind hole in the hinge backer
 * pad under it. The backer's pin joint records the blind hole; this records the hole in the deck (it was missing, so the deck's Shaper file had no hole for it, Phase 4 files review). Recorded on the deck only
 * (a hole in a host: the pin part has no matching feature). `at` is the deck's local frame, mid-thickness. Call once after `applyJoinery`.
 */
export function addFlatPinDeckHoles(p: Params, L: Layout, parts: Part[]): void {
  const deck = parts.find((x) => x.id === 'deck');
  if (!deck) return;
  for (const h of flatPinHoles(p, L)) {
    if (!parts.some((x) => x.id === `seat-pin-${h.tag}`)) continue;
    const m = deck.transform;
    const local: Vec3 = [h.center[0] - m[12], h.center[1] - m[13], L.deckBot + L.ply / 2 - m[14]]; // the deck transform is a pure translation (compose([0, 0, deckBot]))
    (deck.joints ??= []).push({
      type: 'pin', to: `seat-pin-${h.tag}`, count: 1, diaIn: 2 * PIN_R_IN, size: '13/32 clearance hole through the 12 mm deck for the flat-position latch pin (the pin ends in the blind hole in the backer pad under the deck)', at: [local],
      note: 'Bored square to the face; epoxy-seal the bore. Drill it with the backer pad glued on, one bit through the deck and into the pad (stop at the pad hole depth).',
    });
  }
}

/**
 * Plan the cargo pose from the INSTALLED part list (the real bounding boxes). Pure: it reads the parts and moves nothing.
 */
export function seatStowPlan(p: Params, L: Layout, parts: Part[]): StowPlan {
  const g = storageGeometry(p, L);
  const sup = seatBackSupport(p, L);
  const byId = new Map(parts.map((x) => [x.id, x]));
  const back = parts.filter((x) => isSeatBackPart(x.id));
  const cushion = byId.get('seat-cushion');
  const pad = byId.get(PAD_ID);
  const clear = p.seatStowClearIn;
  const interior = {
    x0: g.x0 + g.pl, x1: g.x1 - g.pl, y0: -(g.hw - g.pl), y1: g.hw - g.pl, zFloor: g.floorZ, zRest: g.floorZ + BOX_FILLET_IN,
    zCeil: g.zTop - g.pl - g.rimT,
  };
  const M = backFlipMove(p, L);
  const empty: StowPlan = {
    applicable: false, interior, sizes: { back: [0, 0, 0], cushion: [0, 0, 0], pad: [0, 0, 0] }, need: { lengthIn: 0, widthIn: 0, heightIn: 0 },
    margin: { lengthIn: 0, widthIn: 0, heightIn: 0 }, fits: false, freeIn3: 0, cushionsIn3: 0, items: [], backMove: M, flat: { x0: 0, x1: 0, zTop: 0, pins: [] },
  };
  if (!sup.rear || !back.length || !cushion || !pad) return empty;

  const bb = (part: Part): Vec3 => { const b = worldAABB(part); return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]; };
  const cushionSize = bb(cushion);
  // The pad's own frame: x across, y up the back, z the thickness. It lies flat, face up, its up-the-back axis fore-aft.
  const pb = localBounds(pad.geometry);
  const padSize: Vec3 = [pb.max[1] - pb.min[1], pb.max[0] - pb.min[0], pb.max[2] - pb.min[2]];

  // The back flat: the image of its corners under the flip.
  let fx0 = Infinity, fx1 = -Infinity, fz = -Infinity;
  for (const part of back) for (const c of cornersOf(part)) {
    const q = transformPoint(M, c);
    fx0 = Math.min(fx0, q[0]); fx1 = Math.max(fx1, q[0]); fz = Math.max(fz, q[2]);
  }
  const backSize: Vec3 = [fx1 - fx0, p.seatBackWidthIn, fz - L.deckTop];

  const avail = { lengthIn: interior.x1 - interior.x0, widthIn: interior.y1 - interior.y0, heightIn: interior.zCeil - interior.zFloor };
  const need = {
    lengthIn: Math.max(cushionSize[0], padSize[0]) + clear,
    widthIn: Math.max(cushionSize[1], padSize[1]) + clear,
    heightIn: BOX_FILLET_IN + cushionSize[2] + padSize[2],
  };
  const margin = { lengthIn: avail.lengthIn - need.lengthIn, widthIn: avail.widthIn - need.widthIn, heightIn: avail.heightIn - need.heightIn };
  const fits = margin.lengthIn >= -1e-9 && margin.widthIn >= -1e-9 && margin.heightIn >= -1e-9;

  // Poses: both flush to the aft wall, the pad centered across and on top of the cushion.
  const xa = interior.x0 + clear / 2;
  const zCushion = interior.zRest;
  const cushionBox: Box3 = { min: [xa, -cushionSize[1] / 2, zCushion], max: [xa + cushionSize[0], cushionSize[1] / 2, zCushion + cushionSize[2]] };
  const padBox: Box3 = { min: [xa, -padSize[1] / 2, zCushion + cushionSize[2]], max: [xa + padSize[0], padSize[1] / 2, zCushion + cushionSize[2] + padSize[2]] };
  const items: StowItem[] = [
    { label: 'seat cushion', ids: ['seat-cushion'], box: cushionBox },
    { label: 'back pad', ids: [PAD_ID], box: padBox },
  ];
  const cushionsIn3 = cushionSize[0] * cushionSize[1] * cushionSize[2] + padSize[0] * padSize[1] * padSize[2];
  const boxIn3 = avail.lengthIn * avail.widthIn * avail.heightIn;
  return {
    applicable: true, interior, sizes: { back: backSize, cushion: cushionSize, pad: padSize }, need, margin, fits, freeIn3: Math.max(0, boxIn3 - cushionsIn3), cushionsIn3, items,
    backMove: M, flat: { x0: fx0, x1: fx1, zTop: fz, pins: flatPinHoles(p, L) },
  };
}

function moveBy(part: Part, m: Mat4): void {
  part.transform = multiply(m, part.transform);
  if (part.cgIn) part.cgIn = transformPoint(m, part.cgIn);
}

/**
 * Put the seat in its cargo pose (the viewer's "flat" state and the cargo-mode analysis): the back flips forward onto the deck, the two cushions lie in the box. Mutates the parts of
 * `parts` in place; does nothing when the box is not behind the seat (the plan is not applicable).
 */
export function applySeatStow(p: Params, L: Layout, parts: Part[]): StowPlan {
  const plan = seatStowPlan(p, L, parts);
  if (!plan.applicable) return plan;
  const byId = new Map(parts.map((x) => [x.id, x]));
  for (const part of parts) if (isSeatBackPart(part.id)) moveBy(part, plan.backMove);
  // Seat cushion: slide, no turn, to its box corner.
  {
    const c = byId.get('seat-cushion')!;
    const b = worldAABB(c);
    const t = plan.items[0].box.min;
    moveBy(c, translation(t[0] - b.min[0], t[1] - b.min[1], t[2] - b.min[2]));
  }
  // Back pad: lies flat, face up, up-the-back axis fore-aft (local x -> -y, local y -> +x, local z -> +z), its corner on the cushion.
  {
    const pad = byId.get(PAD_ID)!;
    const pb = localBounds(pad.geometry);
    const t = plan.items[1].box;
    const yMid = (t.min[1] + t.max[1]) / 2;
    // local (x, y, z) -> world (xo + y - pb.min[1], yMid - (x - cx), zo + z - pb.min[2])
    const cx = (pb.min[0] + pb.max[0]) / 2;
    const m: Mat4 = [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, t.min[0] - pb.min[1], yMid + cx, t.min[2] - pb.min[2], 1];
    pad.transform = m;
    delete pad.cgIn;
  }
  // Latch pins: vertically down through the flat panel and the deck into the backer pad (head up, seated on the panel's rear face, D-63). h.center is mid-thickness of the panel, so the rear
  // (top) face is half a panel thickness above it; the usable length hangs below that face and the head stands PIN_HEAD_IN above it.
  for (const h of plan.flat.pins) {
    const pin = byId.get(`seat-pin-${h.tag}`);
    if (!pin) continue;
    const zFace = h.center[2] + p.seatBackThickIn / 2;
    pin.transform = translation(h.center[0], h.center[1], zFace - PIN_LEN_IN + (PIN_LEN_IN + PIN_HEAD_IN) / 2);
    if (pin.cgIn) delete pin.cgIn;
  }
  return plan;
}
