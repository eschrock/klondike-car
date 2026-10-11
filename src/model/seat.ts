/**
 * Seat (D-3, D-9, D-18, D-40): a closed-cell foam cushion with a marine-vinyl cover on the deck (or box top / optional riser),
 * a removable reclined back (oak stiles and rails joined with Dominos, a ply panel captured in grooves, a covered foam pad),
 * side grab handles and a foot stop.
 *
 * The back comes off without tools (D-9): one 3/8-16 stud with a star knob per stile threads into a stainless insert in a fixed
 * oak part behind it (the backer cleat inside the storage box when the box sits behind the seat, otherwise the oak wedge itself).
 * Aft load from the rider bears on an oak wedge that fills the space between the back and the box end (a post when the box is
 * elsewhere); the knobs resist only the overturning couple. Parts are built from the layout so every location variant stays clear.
 */
import { RIDER_PELVIS_Z_FRAC, SIDE_CONSTRUCTION, STORAGE_LOCATION, type Params } from '../params';
import { STEP, box, cylinder, span, SIDES, type Ctx } from './build-utils';
import { innerHalfWidth, type Layout } from './layout';
import { chooseDomino, DOMINOS, type DominoQuery } from './joinery';
import { profilePart, signedArea } from './profile';
import type { Joint, Part, Vec2, Vec3 } from './types';

// ── Detail dimensions and purchased-part estimates (D-18, D-40) ──
/** Closed-cell foam density used for the cushion and the back pad (estimate, D-18). */
const FOAM_DENSITY_PCF = 4.5;
export const BACK_PAD_THICK_IN = 1;
/** Marine vinyl cover: 24 oz per 54" yard ≈ 0.11 lb/ft² (estimate). */
const VINYL_LB_PER_FT2 = 0.11;
/** Gap between the pelvis top and the start of the back pad. */
const PAD_GAP_IN = 0.25;
/** Riser runner width (across). */
const RISER_RUNNER_IN = 1.5;
/** The cushion's rear edge is set back this far from the stile front so the knob heads clear it. */
export const CUSHION_CLEAR_IN = 0.375;
/** Star knob (glass-filled nylon, 3/8-16 stainless stud): head radius and thickness; one per stile. */
const KNOB_R_IN = 0.5;
const KNOB_T_IN = 0.4;
const KNOB_MASS_LB = 0.07;
/** Height of the support (oak post) behind the back when the box is not behind it, along the back; and its crest thickness. */
export const SEAT_POST_HEIGHT_IN = 4.5;
const POST_CREST_IN = 0.75;
/** The wedge crest sits this far below the lid top so the stile never touches the lid frame. */
const WEDGE_BELOW_LID_IN = 1;
/** A rear box is never lower than this (top above the deck), so the seat-back backers and the hinge backers fit inside it. */
export const MIN_REAR_BOX_H_IN = 3.4;
/** Grab handle: pad (on the gunwale), posts, bar. */
const GRIP_PAD_W_IN = 1.5;
const GRIP_PAD_T_IN = 0.75;
/** Pad screw length (#8 × 1-3/4): 1" of engagement past the 3/4" pad. */
const GRIP_SCREW_LEN_IN = 1.75;
export const GRIP_POST_IN = 1;
const GRIP_BAR_W_IN = 1.25;
export const GRIP_BAR_H_IN = 1;
/** Grab handle starts this far behind the H-point (hands rest at the hips). */
const GRIP_BEHIND_HPOINT_IN = 5;
/** Foot-stop corner cleats (S6): an oak block glued to each nose side, ahead of the board so the foot load bears on it (not on screws). */
export const FOOT_CLEAT_X_IN = 1.25;
export const FOOT_CLEAT_T_IN = 0.75;

/**
 * Joint for a light, non-structural-path frame member (seat-back frame, lid frame, grip posts): the largest Domino that chooseDomino
 * accepts with the light-frame edge margin (`dominoEdgeLightIn`), else a blind stub tenon. Single source for those joints (build M1).
 */
export function frameJoint(p: Params, to: string, q: DominoQuery, opts: { count?: number; note?: string } = {}): Joint {
  const d = chooseDomino({ ...p, dominoEdgeIn: p.dominoEdgeLightIn }, q);
  const count = opts.count ?? 1;
  if (d) return { type: 'domino', to, count, size: `${d.name} (${d.tool})`, note: opts.note };
  return { type: 'mortise-tenon', to, count, size: '3/8 × 3/4 × 1/2 deep blind tenon (routed mortise, shaped tenon)', note: opts.note };
}
/** Longest Domino length (mm) in the catalog, for the tests that confirm a joint's Domino really fits its member. */
export const DOMINO_LENGTH_MM: Readonly<Record<string, number>> = Object.fromEntries(DOMINOS.map((d) => [d.name, d.lMm]));

/** Corner radius actually used for a rounded rectangle `w` × `h` (D-44): capped at a third of the smaller side. */
const padRadius = (w: number, h: number, r: number) => Math.max(0, Math.min(r, w / 3, h / 3));
const PAD_CORNER_SEGMENTS = 6;
/** Rounded rectangle centered on x = 0, spanning y = 0..h, CCW (D-44). */
function roundedRect(w: number, h: number, r: number): Vec2[] {
  const rr = padRadius(w, h, r);
  if (rr < 1e-6) return [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]];
  const out: Vec2[] = [];
  const corners: Array<[number, number, number]> = [[w / 2 - rr, rr, -Math.PI / 2], [w / 2 - rr, h - rr, 0], [-w / 2 + rr, h - rr, Math.PI / 2], [-w / 2 + rr, rr, Math.PI]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= PAD_CORNER_SEGMENTS; i++) {
    const a = a0 + (Math.PI / 2) * (i / PAD_CORNER_SEGMENTS);
    out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return out;
}

const unit = (x: number, y: number, z: number): Vec3 => {
  const n = Math.hypot(x, y, z) || 1;
  return [x / n, y / n, z / n];
};

/** Gunwale member name the grips / lash points bolt to (cabin side), by construction (body.ts ids). */
export function gunwaleId(p: Params, tag: 'L' | 'R'): string {
  return p.sideConstruction === SIDE_CONSTRUCTION.solidOak ? `side-cabin-${tag}-board` : `side-cabin-${tag}-gunwale`;
}

/** Y of the cabin gunwale centerline (|y|), including the gunwale flare. */
export const gunwaleY = (L: Layout): number => L.hwC + L.side / 2 + L.flare;
/** Sorted y range (for `span`) of a block of thickness `t` against the inboard face of a gunwale whose inner face is at |y| = `yInner` on side `sg`. */
export const inboardOf = (sg: 1 | -1, yInner: number, t: number): [number, number] => (sg > 0 ? [yInner - t, yInner] : [-yInner, -yInner + t]);

export interface SeatBackSupport {
  /** True when the storage box sits behind the back (rear over axle): the stud goes through the box end into a backer cleat. */
  rear: boolean;
  a: number;
  W: number;
  H: number;
  t: number;
  fw: number;
  /** |y| of each stile centerline and of its knob. */
  stileY: number;
  knobY: number;
  /** Distances along the back from the stile foot (rear-bottom corner): the support crest and the knob. */
  c2A: number;
  c2B: number;
  /** Wedge outline in world (x, z), CCW: bottom-aft, bottom-front, crest-front, crest-aft. */
  wedge: Vec2[];
  xv: number;
  zb: number;
  /** Rear box only: the box top (lid top) and its fore end, cut back so the box never meets the leaning back above the layout height. */
  boxZTop: number;
  boxX1: number;
}

/** Support geometry behind the seat back, shared by the model (seat, storage) and the seat-back check. */
export function seatBackSupport(p: Params, L: Layout): SeatBackSupport {
  const s = L.seat;
  const a = (p.seatBackAngleDeg * Math.PI) / 180;
  const t = p.seatBackThickIn;
  const fw = p.seatBackFrameWidthIn;
  const H = p.seatBackHeightIn;
  const W = Math.max(2 * fw + 0.5, Math.min(p.seatBackWidthIn, 2 * L.hwC - 1));
  const stileY = W / 2 - fw / 2;
  const knobY = Math.min(stileY + 0.25, W / 2 - KNOB_R_IN);
  const rear = p.storageLocation === STORAGE_LOCATION.rearOverAxle;
  const [, , c2z] = s.col2;
  const c2x = s.col2[0];
  const xf = (c2: number) => s.Pr[0] + c2x * c2;
  const faceXAt = (z: number) => xf((z - s.Pr[2]) / c2z);
  const st = L.storage;
  const boxZTop = Math.max(st.zTop, st.zBot + 3 * p.panelPlyIn + p.storageLidRimThickIn + p.storageGasketIn, rear ? st.zBot + MIN_REAR_BOX_H_IN : 0);
  const boxX1 = rear ? Math.min(Math.max(st.x0 + 0.5, st.x1), faceXAt(boxZTop)) : st.x1;
  let c2B = p.seatBackKnobHeightIn;
  let c2A = SEAT_POST_HEIGHT_IN;
  if (rear) c2A = (boxZTop - WEDGE_BELOW_LID_IN - s.Pr[2]) / c2z;
  c2A = Math.min(Math.max(c2A, c2B + 1), p.seatBackHeightIn - 2);
  // Rear box: the crest must stand at least 0.15" off the box end (the stile face meets the end at the lid top), so lower it if the lean is small.
  if (rear && Math.abs(c2x) > 0.05 && xf(c2A) - boxX1 < 0.15) {
    c2A = Math.min(Math.max((boxX1 + 0.15 - s.Pr[0]) / c2x, c2B + 1), c2A);
  }
  c2B = Math.min(c2B, c2A - 1);
  const zb = s.pan;
  const c2b = (zb - s.Pr[2]) / c2z;
  const zA = s.Pr[2] + c2z * c2A;
  const xA = xf(c2A);
  // Aft face is the box end (rear) or a vertical face POST_CREST behind the crest (post).
  const xv = rear ? Math.min(boxX1, xA - 0.02) : xA - POST_CREST_IN;
  const wedge: Vec2[] = [[xv, zb], [xf(c2b), zb], [xA, zA], [xv, zA]];
  return { rear, a, W, H, t, fw, stileY, knobY, c2A, c2B, wedge, xv, zb, boxZTop, boxX1 };
}

export function buildSeat(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const s = L.seat;
  const parts: Part[] = [];
  const hw = s.width / 2;
  const foam = (volIn3: number) => (volIn3 / 1728) * FOAM_DENSITY_PCF;
  const vinyl = (areaIn2: number) => (areaIn2 / 144) * VINYL_LB_PER_FT2;
  const sup = seatBackSupport(p, L);
  const { a, H, t, fw, W } = sup;
  const g = p.seatBackGrooveDepthIn;
  const plyT = Math.min(p.panelPlyIn, t);

  // Optional riser: two oak runners under the cushion (default 0 = cushion on the deck).
  const riser = s.cushionBottom - s.pan;
  if (riser > 0.01) {
    for (const { s: sg, tag } of SIDES) {
      const y = sg * (hw - RISER_RUNNER_IN / 2);
      parts.push(box(ctx, {
        id: `seat-riser-${tag}`, partNo: 'seat-riser', name: `Seat riser runner ${tag}`, group: 'seat', mat: 'oak', step: STEP.seatStorage, grain: 'x',
        ...span([s.xRear, s.xFront], [y - RISER_RUNNER_IN / 2, y + RISER_RUNNER_IN / 2], [s.pan, s.cushionBottom]),
        joints: [{ type: 'glue', to: s.pan > L.deckTop + 0.01 ? 'storage-lid' : 'deck', count: 1, note: 'epoxy + 3 × #8 stainless screws up through the deck' }],
      }));
    }
  }

  // Cushion: 2" closed-cell foam, marine-vinyl cover with four drain grommets (D-18). Held by Dual Lock strips so it lifts off for hauling.
  const cx0 = s.xRear + CUSHION_CLEAR_IN;
  const cushionVol = (s.xFront - cx0) * s.width * p.seatCushionIn;
  const cushionCover = 2 * (s.xFront - cx0) * s.width + 2 * (s.xFront - cx0 + s.width) * p.seatCushionIn;
  parts.push(box(ctx, {
    id: 'seat-cushion', name: 'Seat cushion', group: 'seat', mat: 'fixed', massLb: foam(cushionVol) + vinyl(cushionCover), kind: 'purchased',
    material: 'closed-cell foam, marine-vinyl cover', fab: 'buy', step: STEP.seatStorage, ...span([cx0, s.xFront], [-hw, hw], [s.cushionBottom, s.surface]),
    sourcing: { vendor: 'Closed-cell polyethylene foam (McMaster-Carr / Foam Factory); marine vinyl (Sailrite / Hancock); sewn in-house', costUsd: 55 },
    notes: 'Sits directly on the deck (or the storage lid / riser) on Dual Lock strips. Four drain grommets in the cover. Set back 3/8" from the back so the knob heads clear (D-40). Mass is an estimate (foam + cover, D-18).',
  }));

  // Seat back: front face passes through P and leans back by seatBackAngleDeg. Oak frame (2 stiles + 2 rails) with a captured ply panel.
  const at = (c0: number, c2: number, y = 0): Vec3 => [s.P[0] + s.col0[0] * c0 + s.col2[0] * c2, y, s.P[2] + s.col0[2] * c0 + s.col2[2] * c2];
  const backCommon = { group: 'seat', removable: true, step: STEP.seatStorage, rot: { y: -a } } as const;
  // The Domino sits in the outer band of the member, clear of the panel groove (build M1/S9): band = member width − groove depth.
  const domino = (to: string): Joint => frameJoint(p, to, { stockIn: t, hostIn: fw, widthIn: fw - g }, { note: `one floating tenon per joint, offset past the ${g}" panel groove (outer ${(fw - g).toFixed(3)}" of the ${fw}" member); the groove is stopped at the rail faces` });
  const grooveW = plyT + p.grooveSlopIn;
  const panelDado = (z: number, stopped: boolean): Joint => ({ type: 'dado', to: 'seat-back-panel', count: 1, size: `${g} deep × ${grooveW.toFixed(3)} groove`, note: stopped ? `stopped groove on the inside edge between the rails, ${z.toFixed(2)}" long` : `groove through the member on the inside edge, ${z.toFixed(2)}" long, ends in the stile's solid edge` });
  for (const { s: sg, tag } of SIDES) {
    parts.push(box(ctx, {
      ...backCommon, id: `seat-back-stile-${tag}`, partNo: 'seat-back-stile', name: `Seat back stile ${tag}`, mat: 'oak', grain: 'z',
      size: [t, fw, H], center: at(-t / 2, H / 2, sg * sup.stileY), notes: 'Knob-mounted for transport, no tools (D-9). 3/8" stud hole 13/32" at the knob height; the 3-1/2" stud covers stile + wedge + box end + 3/4" of insert at the 15° back angle (S14).',
      joints: [domino('seat-back-rail-top'), domino('seat-back-rail-bottom'), panelDado(H - 2 * fw, true),
        { type: 'knob', to: `seat-knob-${tag}`, count: 1, size: '3/8-16 × 3-1/2" stud, star knob, nylon-insert jam nut', note: 'perpendicular to the back face; the stud ends in the insert behind (D-9); blue threadlocker on the insert end, jam nut on the stile so the knob cannot back off' }],
    }));
  }
  for (const [tag, c2] of [['top', H - fw / 2], ['bottom', fw / 2]] as const) {
    parts.push(box(ctx, {
      ...backCommon, id: `seat-back-rail-${tag}`, partNo: 'seat-back-rail', name: `Seat back ${tag} rail`, mat: 'oak', grain: 'y',
      size: [t, W - 2 * fw, fw], center: at(-t / 2, c2),
      joints: [domino('seat-back-stile-L'), domino('seat-back-stile-R'), panelDado(W - 2 * fw, false)],
    }));
  }
  parts.push(box(ctx, {
    ...backCommon, id: 'seat-back-panel', name: 'Seat back panel', mat: 'ply', edges: 'captured', grain: 'z',
    size: [plyT, W - 2 * fw, H - 2 * fw], center: at(-t / 2, H / 2),
    stock: { t: plyT, w: W - 2 * fw + 2 * g, l: H - 2 * fw + 2 * g },
    joints: (['seat-back-stile-L', 'seat-back-stile-R', 'seat-back-rail-top', 'seat-back-rail-bottom'] as const).map((to): Joint => ({
      type: 'dado', to, count: 1, size: `${g} deep tongue in a ${grooveW.toFixed(3)} groove`, note: 'all four edges captured, epoxy-sealed (no exposed ply edge); corners notched g × g where the tongues cross',
    })),
    notes: `Ply panel captured in grooves ${g}" deep in the stiles and rails; the cut size (stock) includes the tongues, the modeled box is the visible part.`,
  }));
  // The pad starts above the pelvis (and the cushion and the knobs), so it supports the lumbar region and never overlaps them.
  const pelvisTopAlongBack = (s.surface + RIDER_PELVIS_Z_FRAC * p.riderStatureIn - s.P[2]) / s.col2[2];
  const knobTop = sup.c2B + KNOB_R_IN + 0.1;
  const h0 = Math.min(H - 0.5, Math.max(0.5, p.seatCushionIn / Math.cos(a) + 0.3, pelvisTopAlongBack + PAD_GAP_IN, knobTop));
  const padH = Math.max(0.5, H - h0);
  // The pad is a padded backrest with rounded corners (D-44): a rounded-rectangle extrusion along the back's normal. Local x → across (Y), local y → up the back, local z → forward (the back's normal).
  const padOutline = roundedRect(W, padH, Math.min(p.seatBackCornerRadiusIn, W / 3, padH / 3));
  const padArea = signedArea(padOutline);
  const padPerim = padOutline.reduce((m, q, i) => m + Math.hypot(padOutline[(i + 1) % padOutline.length][0] - q[0], padOutline[(i + 1) % padOutline.length][1] - q[1]), 0);
  const padO = at(0, h0);
  parts.push({
    id: 'seat-back-pad', name: 'Seat back pad', group: 'seat', kind: 'purchased', material: 'closed-cell foam, marine-vinyl cover',
    geometry: { type: 'extrusion', outline: padOutline, depth: BACK_PAD_THICK_IN },
    transform: [0, 1, 0, 0, s.col2[0], 0, s.col2[2], 0, s.col0[0], 0, s.col0[2], 0, padO[0], padO[1], padO[2], 1],
    body: 'chassis', massLb: foam(BACK_PAD_THICK_IN * padArea) + vinyl(2 * padArea + padPerim * BACK_PAD_THICK_IN),
    fab: 'buy', step: STEP.seatStorage, removable: true, explode: unit(-0.7, 0, 1), finish: { soft: true, surface: 'vinyl' },
    sourcing: { vendor: 'Closed-cell polyethylene foam and marine vinyl (as the cushion); sewn in-house', costUsd: 25 },
    joints: [{ type: 'screw', to: 'seat-back-panel', count: 4, size: '#6 × 3/4 stainless pan head, cup washer', note: 'through the vinyl flange; the pad lifts off with the back' }],
    notes: `Mass is an estimate (foam + cover). Rounded-rectangle pad, ${padRadius(W, padH, p.seatBackCornerRadiusIn).toFixed(2)}" corner radius, crowned by the viewer's soft finish (D-44).`,
  });

  // Star knobs: one per stile, just behind the cushion edge.
  for (const { s: sg, tag } of SIDES) {
    parts.push(cylinder(ctx, {
      id: `seat-knob-${tag}`, partNo: 'seat-knob', name: `Seat-back knob ${tag}`, group: 'seat', mat: 'fixed', massLb: KNOB_MASS_LB, kind: 'purchased',
      material: 'glass-filled nylon star knob, 3/8-16 stainless stud', fab: 'buy', removable: true, step: STEP.seatStorage,
      axis: 'x', radius: KNOB_R_IN, length: KNOB_T_IN, rot: { y: -a }, center: at(KNOB_T_IN / 2, sup.c2B, sg * sup.knobY),
      explode: unit(0.5, sg * 0.3, 1),
      sourcing: { vendor: 'McMaster-Carr (3-lobe knob with stainless threaded stud, 3/8-16)', costUsd: 6 },
      notes: 'Hand-tight; no tools to remove the back (D-9).',
    }));
  }

  // Support behind each stile: an oak wedge (box behind the seat) or post. Aft load bears on its crest; the insert for the stud is in
  // the backer cleat inside the box (rear) or in the wedge itself.
  const wedgeW = fw;
  const depthX = Math.max(...sup.wedge.map((q) => q[0])) - Math.min(...sup.wedge.map((q) => q[0]));
  const zA = Math.max(...sup.wedge.map((q) => q[1]));
  for (const { s: sg, tag } of SIDES) {
    const j: Joint[] = [
      { type: 'glue', to: 'deck', count: 1, note: 'epoxy to the deck' },
      { type: 'screw', to: 'deck', count: 2, size: '#10 × 1½ stainless, up through the deck' },
    ];
    if (sup.rear) j.push({ type: 'screw', to: 'storage-end-fore', count: 2, size: '#10 × 1¼ stainless, through the box end into the backer cleat' });
    else j.push({ type: 'threaded-insert', to: `seat-back-stile-${tag}`, count: 1, size: '3/8-16 stainless, 3/4 deep', note: 'the stud ends here (D-9)' });
    parts.push(profilePart(ctx, {
      id: `seat-wedge-${tag}`, partNo: 'seat-wedge', name: sup.rear ? `Seat back wedge ${tag}` : `Seat back post ${tag}`, group: 'seat', mat: 'oak',
      outline: sup.wedge, depth: wedgeW, basis: 'xz', origin: [0, sg * sup.stileY + wedgeW / 2, 0], grain: 'z', step: STEP.seatStorage,
      stock: { t: wedgeW, w: depthX, l: zA - sup.zb }, explode: [0, 0, -1], joints: j,
      notes: 'Shaped to the back angle (CNC or bandsaw + plane). Stays on the cart when the back comes off. The 3/8" stud passes through it.',
    }));
  }

  // Side grab handles (BRIEF §4.7): oak pad on the gunwale, two posts, a bar. Clear opening under the bar so a gloved hand wraps it.
  const clear = p.seatGripClearLengthIn;
  const gx0 = p.seatXIn - GRIP_BEHIND_HPOINT_IN;
  const gLen = clear + 2 * GRIP_POST_IN;
  const gTop = L.deckTop + L.sideH;
  const yg = gunwaleY(L);
  const cabinX1 = L.xc0 - L.side;
  const gxA = Math.min(gx0, cabinX1 - gLen - 0.25);
  const padTop = gTop + GRIP_PAD_T_IN;
  const barBot = padTop + p.seatGripGapIn;
  for (const { s: sg, tag } of SIDES) {
    const gid = gunwaleId(p, tag);
    // Doubler: oak blocking glued to the inboard face of the ½" gunwale, flush with its top, so the pad screws bite into oak with >= 3/4" engagement.
    const dId = `doubler-grip-${tag}`;
    parts.push(box(ctx, {
      id: dId, partNo: 'doubler-grip', name: `Grab handle doubler ${tag}`, group: 'seat', mat: 'oak', step: STEP.finish, grain: 'x',
      ...span([gxA, gxA + gLen], inboardOf(sg, yg - L.side / 2, p.blockingThickIn), [gTop - L.railBand, gTop]),
      joints: [{ type: 'glue', to: gid, count: 1, note: 'epoxy, full face' }, { type: 'screw', to: `seat-grip-pad-${tag}`, count: 4, size: '#8 × 1-3/4 stainless, down through the pad' }],
      notes: `Blocking behind the ${L.side}" gunwale (D-41): the pad screws (${(GRIP_SCREW_LEN_IN - GRIP_PAD_T_IN).toFixed(2)}" past the pad) land in this block, not the thin gunwale edge.`,
    }));
    parts.push(box(ctx, {
      id: `seat-grip-pad-${tag}`, partNo: 'seat-grip-pad', name: `Grab handle pad ${tag}`, group: 'seat', mat: 'oak', step: STEP.finish, grain: 'x',
      ...span([gxA, gxA + gLen], [sg * yg - GRIP_PAD_W_IN / 2, sg * yg + GRIP_PAD_W_IN / 2], [gTop, padTop]),
      joints: [{ type: 'glue', to: gid, count: 1, note: 'epoxy' }, { type: 'screw', to: dId, count: 4, size: '#8 × 1-3/4 stainless, down into the doubler' }],
      notes: 'Spreads the grip load over the gunwale and its doubler (the gunwale alone is only ½" wide).',
    }));
    for (const [n, xa] of [[1, gxA], [2, gxA + gLen - GRIP_POST_IN]] as const) {
      parts.push(box(ctx, {
        id: `seat-grip-post-${tag}${n}`, partNo: 'seat-grip-post', name: `Grab handle post ${tag}${n}`, group: 'seat', mat: 'oak', step: STEP.finish, grain: 'z',
        ...span([xa, xa + GRIP_POST_IN], [sg * yg - GRIP_POST_IN / 2, sg * yg + GRIP_POST_IN / 2], [padTop, barBot]),
        joints: [frameJoint(p, `seat-grip-pad-${tag}`, { stockIn: GRIP_POST_IN, hostIn: GRIP_PAD_T_IN, widthIn: GRIP_POST_IN }, { note: 'into the pad top, epoxy' }), { type: 'mortise-tenon', to: `seat-grip-bar-${tag}`, count: 1, size: '3/8 × 3/4 × 1/2 blind tenon', note: 'the 1" post leaves 1/8" shoulders each side of the tenon' }],
      }));
    }
    parts.push(box(ctx, {
      id: `seat-grip-bar-${tag}`, partNo: 'seat-grip-bar', name: `Grab handle bar ${tag}`, group: 'seat', mat: 'oak', step: STEP.finish, grain: 'x',
      ...span([gxA, gxA + gLen], [sg * yg - GRIP_BAR_W_IN / 2, sg * yg + GRIP_BAR_W_IN / 2], [barBot, barBot + GRIP_BAR_H_IN]),
      notes: `Rounded over ¼" on all edges. Finger gap ${p.seatGripGapIn}" under the bar, ${clear}" clear between the posts: no pinch point (BRIEF §4.7).`,
      joints: [{ type: 'mortise-tenon', to: `seat-grip-post-${tag}1`, count: 1, size: '3/8 × 3/4 × 1/2 blind tenon' }, { type: 'mortise-tenon', to: `seat-grip-post-${tag}2`, count: 1, size: '3/8 × 3/4 × 1/2 blind tenon' }],
    }));
  }

  // Foot stop: an oak board across the nose at x = seatX + leg reach, standing on its deck.
  const fx = p.seatXIn + p.riderLegReachIn;
  const onNose = fx >= L.xn;
  const deckZ = L.deckTop;
  // The board spans the hull's inside width at its own x: the bow converges (D-52), so this is wider than the bow's inside width at the front transom (hwN).
  // The side slopes across the board's thickness (and across the cleat), so each is cut to the narrowest inside width over its x range (a small wedge gap
  // at the wider end is filled with thickened epoxy).
  const narrowest = (a: number, b: number) => Math.min(...[0, 0.25, 0.5, 0.75, 1].map((t) => innerHalfWidth(L, a + (b - a) * t)));
  const zone = onNose ? 'nose' : 'cabin';
  const sideMember = (tag: 'L' | 'R') => (p.sideConstruction === SIDE_CONSTRUCTION.solidOak ? `side-${zone}-${tag}-board` : p.sideConstruction === SIDE_CONSTRUCTION.openFrame ? `side-${zone}-${tag}-gunwale` : `side-${zone}-${tag}-chine`); // the open frame has no chine
  // Corner cleats (build S6): the nose side is a chine + a 6 mm web, so there is nothing to dado. An oak block glued to the inboard face of each side
  // stands ahead of the board (when there is room before the front transom), so the foot load bears on the cleats in compression; the board is
  // Domino-pinned to them and screwed down through the deck.
  const stopX0 = fx - p.footStopThickIn / 2, stopX1 = fx + p.footStopThickIn / 2;
  const fhw = narrowest(stopX0, stopX1);
  const frontLimit = onNose ? L.xFront - L.transom : L.xn;
  const cleatAhead = frontLimit - stopX1 >= FOOT_CLEAT_X_IN - 1e-9;
  const cleatX: [number, number] = cleatAhead ? [stopX1, stopX1 + FOOT_CLEAT_X_IN] : [stopX0 - FOOT_CLEAT_X_IN, stopX0];
  const chw = narrowest(cleatX[0], cleatX[1]);
  const cleatJoint = (tag: 'L' | 'R'): Joint => frameJoint(p, `foot-stop-cleat-${tag}`, { stockIn: p.footStopThickIn, hostIn: Math.min(p.footStopThickIn, FOOT_CLEAT_X_IN), widthIn: p.footStopHeightIn }, { count: 2, note: 'two floating tenons per cleat; the cleat face and the board end meet' });
  parts.push(box(ctx, {
    id: 'foot-stop', name: 'Foot stop', group: 'seat', mat: 'oak', step: STEP.seatStorage, grain: 'y',
    ...span([stopX0, stopX1], [-fhw, fhw], [deckZ, deckZ + p.footStopHeightIn]),
    joints: [
      { type: 'screw', to: 'deck', count: 4, size: '#10 × 1½ stainless, up through the deck' },
      cleatJoint('L'), cleatJoint('R'),
    ],
    notes: `Board between the ${zone} sides, held by two corner cleats and the deck screws. The board end butts the inside face of the side (epoxy, no dado). Top edge rounded ½"; no gap under the board for a foot to catch (D-40).`,
  }));
  for (const { s: sg, tag } of SIDES) {
    parts.push(box(ctx, {
      id: `foot-stop-cleat-${tag}`, partNo: 'foot-stop-cleat', name: `Foot stop cleat ${tag}`, group: 'seat', mat: 'oak', step: STEP.seatStorage, grain: 'z',
      ...span(cleatX, inboardOf(sg, chw, FOOT_CLEAT_T_IN), [deckZ, deckZ + p.footStopHeightIn]),
      joints: [
        { type: 'glue', to: sideMember(tag), count: 1, note: 'epoxy to the inboard face of the side, thickened epoxy fills the 1/8" step to the web' },
        { type: 'screw', to: 'deck', count: 2, size: '#10 × 1½ stainless, up through the deck' },
        { ...cleatJoint(tag), to: 'foot-stop' },
      ],
      notes: `Oak corner cleat (${FOOT_CLEAT_X_IN}" × ${FOOT_CLEAT_T_IN}") ${cleatAhead ? 'ahead of' : 'behind'} the foot-stop board: the rider's feet push the board ${cleatAhead ? 'into' : 'away from'} it. Rounded over ¼" on the exposed edges (S6, D-40).`,
    }));
  }
  return parts;
}
