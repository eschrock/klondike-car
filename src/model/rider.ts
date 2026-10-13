/** Payload: rider mannequin (D-3) and cargo block. Reference parts, excluded from empty mass. */
import { STEP, box, segment, type Ctx } from './build-utils';
import { ANKLE_DROP_IN, ANKLE_INSET_IN, FOOT, HEAD, LEG_Y_FRAC, PELVIS, SHIN, THIGH, TORSO, knee } from './rider-geom';
import { BACK_PAD_THICK_IN } from './seat';
import type { Part, Vec3 } from './types';

/** Cargo fills this fraction of the storage box interior. */
const CARGO_FILL = 0.8;

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];

export function buildPayload(ctx: Ctx): Part[] {
  const { p, L, view } = ctx;
  const S = p.riderStatureIn;
  const s = L.seat;
  const parts: Part[] = [];
  const H: Vec3 = [p.seatXIn, 0, s.surface];
  const riderMass = view.rider === 'goal' ? p.riderGoalMassLb : view.rider === 'operating' ? p.riderMassLb : 0;
  const common = { group: 'reference', kind: 'reference', fab: 'none', payload: true, body: 'rider', step: STEP.payload, mat: 'fixed', material: 'mannequin' } as const;
  const lean = (p.seatBackAngleDeg * Math.PI) / 180;

  // Pelvis on the cushion, rear face against the seat-back line.
  parts.push(box(ctx, { ...common, id: 'rider-pelvis', name: 'Rider pelvis', massLb: 0, size: [PELVIS.x * S, PELVIS.y * S, PELVIS.z * S],
    center: [H[0], 0, H[2] + (PELVIS.z * S) / 2] }));

  // Torso: reclined to match the back, resting on the pad.
  const torsoLen = TORSO.len * S;
  const pelvisTop = H[2] + PELVIS.z * S;
  const hq = Math.max(0, (pelvisTop - s.P[2]) / s.col2[2]);
  const q = add(add(s.P, s.col2, hq), s.col0, BACK_PAD_THICK_IN + (TORSO.x * S) / 2);
  const torsoC = add(q, s.col2, torsoLen / 2);
  const seatTopCg: Vec3 = [p.seatXIn + p.riderCgAheadOfHpointIn, 0, s.surface + p.riderSeatedCgAboveSeatIn];
  parts.push(box(ctx, { ...common, id: 'rider-torso', name: `Rider torso (carries the ${view.rider} rider mass)`, massLb: riderMass,
    size: [TORSO.x * S, TORSO.y * S, torsoLen], center: torsoC, rot: { y: -lean }, cgIn: seatTopCg,
    notes: 'Whole-body mass sits here with its CG per D-3; all other segments are 0.' }));
  const headC = add(add(q, s.col2, torsoLen + (HEAD.z * S) / 2), s.col0, -(TORSO.x * S) / 2 + (HEAD.x * S) / 2);
  parts.push(box(ctx, { ...common, id: 'rider-head', name: 'Rider head', massLb: 0, size: [HEAD.x * S, HEAD.y * S, HEAD.z * S], center: headC, rot: { y: -lean } }));

  // Legs reach the foot stop.
  const stopRear = p.seatXIn + p.riderLegReachIn;
  const deckZ = L.deckTop;
  for (const sy of [1, -1]) {
    const y = sy * LEG_Y_FRAC * S;
    const hip: Vec3 = [H[0], y, H[2] + (THIGH.z * S) / 2];
    const ankle: Vec3 = [stopRear - (FOOT.len * S) + ANKLE_INSET_IN, y, deckZ + FOOT.z * S - ANKLE_DROP_IN];
    const k = knee(hip, ankle, THIGH.len * S, SHIN.len * S);
    k[1] = y;
    const tag = sy > 0 ? 'L' : 'R';
    const th = segment(hip, k, THIGH.y * S, THIGH.z * S);
    parts.push(box(ctx, { ...common, id: `rider-thigh-${tag}`, partNo: 'rider-thigh', name: `Rider thigh ${tag}`, massLb: 0, ...th }));
    const sh = segment(k, ankle, SHIN.y * S, SHIN.z * S);
    parts.push(box(ctx, { ...common, id: `rider-shin-${tag}`, partNo: 'rider-shin', name: `Rider shin ${tag}`, massLb: 0, ...sh }));
    parts.push(box(ctx, { ...common, id: `rider-foot-${tag}`, partNo: 'rider-foot', name: `Rider foot ${tag}`, massLb: 0,
      size: [FOOT.len * S, FOOT.y * S, FOOT.z * S], center: [stopRear - (FOOT.len * S) / 2, y, deckZ + (FOOT.z * S) / 2] }));
  }

  // Cargo inside the storage box.
  // 'none' = no rider at all (e.g. truck view): drop the mannequin, keep cargo.
  if (view.rider === 'none') parts.splice(0, parts.length);

  if (view.cargo && view.seat === 'stowed') {
    // Cargo mode (D-53): the payload as one block on the bed, piled against the box, at the cargo CG height (cargoCgHeightIn above the deck).
    const st = L.storage;
    const lx = Math.min(p.cargoLoadLengthIn, Math.max(1, L.xFlatEnd - st.x1 - 0.5));
    const w = Math.max(1, Math.min(p.cargoLoadWidthIn, 2 * L.hwC - 1));
    parts.push(box(ctx, { ...common, id: 'cargo', name: `Cargo payload (${p.cargoPayloadLb} lb on the bed)`, body: 'cargo', massLb: p.cargoPayloadLb, material: 'cargo',
      size: [lx, w, 2 * p.cargoCgHeightIn], center: [st.x1 + 0.5 + lx / 2, 0, L.deckTop + p.cargoCgHeightIn] }));
  } else if (view.cargo) {
    const st = L.storage;
    const lx = Math.max(0.5, st.x1 - st.x0 - 2 * ctx.d.thinPlyIn);
    const w = Math.max(0.5, 2 * st.hw - 2 * ctx.d.thinPlyIn);
    const h = Math.max(0.5, st.zTop - st.zBot - 2 * ctx.d.thinPlyIn);
    parts.push(box(ctx, { ...common, id: 'cargo', name: 'Cargo (10 Essentials + team gear)', body: 'cargo', massLb: p.cargoMassLb, material: 'cargo',
      size: [lx * CARGO_FILL, w * CARGO_FILL, h * CARGO_FILL],
      center: [(st.x0 + st.x1) / 2, 0, st.zBot + ctx.d.thinPlyIn + (h * CARGO_FILL) / 2] }));
  }
  return parts;
}
