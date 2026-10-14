/**
 * Lighting (D-9, D-41) and the hardware allowance. The front LED headlight rides on a printed ASA clip that snaps into the bow bulkhead's lift hand-hold (3c-5; the flag stands in a plain tube in a rear corner);
 * the rear red tail light rides on a second printed clip that snaps into the REAR transom's hand-hold, facing aft (D-64). Brackets are
 * ASA (UV-stable) 2D profiles + depth, so they go straight to an STL in Phase 4; they are not on a primary load path.
 */
import { ribWasherSpan, sideRibStations } from './side-ribs';
import { STORAGE_LOCATION, WEATHER_SPEC } from '../params';
import { STEP, box, cylinder, span, SIDES, type Ctx, stainless, insertMat } from './build-utils';
import { SIGN_X_MAX_IN, liftSlot } from './body';
import { sideSlopeAt, sideTopAt } from './layout';
import { profilePart } from './profile';
import { GRIP_BACKING_END_IN, GRIP_BEHIND_HPOINT_IN } from './seat';
import type { Part, Vec2, Vec3 } from './types';

const unit = (x: number, y: number, z: number): Vec3 => {
  const n = Math.hypot(x, y, z) || 1;
  return [x / n, y / n, z / n];
};

// ── Estimates / placeholders (D-41) ──
/** D-83: Giant Recon 600 headlight, 87 g (0.19 lb). */
const FRONT_LIGHT_MASS_LB = 0.19;
/** 3c visual round 2: 1.25x across and tall (was 3 x 2.2 x 1.8; the reviewer found it small against the 21 in bulkhead). Same length (no longer overall), the top at about 4.75 in over the deck, still under the 4 7/8 in bulkhead corners. */
const FRONT_LIGHT_SIZE = [3, 2.75, 2.25] as const;
/** D-83: Planet Bike Spok tail light, about 0.06 lb (VERIFY the weight). */
const REAR_LIGHT_MASS_LB = 0.06;
/** The lamp clip (3c-5): print clearance per side in the slot, and how far the plug stands proud of the bulkhead's front face (the lamp's seat). */
export const LAMP_CLIP = { clearIn: 0.02, lipIn: 0.5 } as const;
const REAR_LIGHT_SIZE = [0.75, 2, 1.5] as const;
/**
 * The rear lamp clip (D-64; status assumed): the same stadium plug as the front, through the 1/2 in rear transom's lift hand-hold. `outerLipIn` stands proud of the transom's outer face
 * and carries the tail light (the light faces -x); `innerLipIn` is the most the plug may stand past the transom's inner face (a catch lip for the snap fit), cut back so the plug's inside end
 * keeps `boxClearIn` clear of the storage box end (the box end sits `rearLane` = 0.75 in inside the transom at the defaults).
 */
export const REAR_LAMP_CLIP = { outerLipIn: 0.5, innerLipIn: 0.25, boxClearIn: 0.125 } as const;
const REFLECTOR_MASS_LB = 0.05;
export const REFLECTOR_SIZE = [2, 0.25, 1] as const;
/**
 * Fastener allowance (Phase 3 integration). The old flat 2.5 lb lump predated the itemized hinges, latches, lash plates, U-bolts,
 * eye bolts, kingpin, pins and clamp plates, so it is now a REMAINDER computed from the model's own joints: every fastener that is
 * not a separate part (wood and machine screws, carriage/hex bolts with their nuts and washers, inserts, thumb-knob screws,
 * Dominos, epoxy) at a typical stainless/zinc unit mass. At the defaults the arithmetic (see `fastenerBreakdown`) is about:
 *   screws          ~100 x 0.008 lb = 0.8    (D-72, D-82: #8 x 5/8, #8 x 1-1/4 and #8 x 2-1/2 stainless, 3 to 8 g)
 *   bolt sets        ~48 x 0.04-0.09 lb      (1/4" to 3/8" bolt + nut + washer(s); 0.02 lb for a screw tapped into a hub)
 *   inserts, knobs   ~20 x 0.005 / 0.02 lb
 *   Dominos          ~24 x 0.005 lb
 *   epoxy            ~45 glued joints x 0.01 lb (squeeze-out and fillets are in the glue-line allowance, not the wood)
 *   itemized bolts   nuts + washers for the kingpin, eye bolts and U-bolts, 0.03 lb per leg
 */
const FASTENER_LB = {
  screw: 0.008, machineScrew: 0.016, boltSmall: 0.04, boltLarge: 0.09, boltTapped: 0.02, insert: 0.005, knob: 0.02, domino: 0.005, glue: 0.01, nutWasher: 0.03,
} as const;
/** Bolts whose shank is already a separate part (kingpin, eye bolts, U-bolts, brake and handle pins): only their nuts and washers are left for the allowance. */
const ITEMIZED_BOLT = /^(bridle-eye|eyebolt|clamp-|handle-pin|seat-knob)/;
const HARDWARE_FALLBACK_LB = 2.5;
const HARDWARE_SIZE = [2, 2, 1.25] as const;
/** Cabin reflectors at these fore-aft fractions of the cabin length (clear of the signs and the nose). */
export const REFLECTOR_FRACS = [0.1, 0.95] as const;
/** Flag tube (D-57): mass per inch of 1" schedule 40 PVC, the drain hole, the oak holding blocks (thickness fore-aft, width across, height). */
const FLAG_TUBE_LB_PER_IN = 0.036;
export const FLAG_DRAIN_HOLE_IN = 0.1875;
export const FLAG_BLOCK = { t: 0.75, w: 1.4, h: 1.5 } as const;

/** A stadium (rounded slot) of total length `len` and height `h`, CCW, centered on the origin: the lamp clip's plug, matching the bulkhead's hand-hold hole. */
export function stadiumOutline(len: number, h: number, seg = 8): Vec2[] {
  const r = h / 2, straight = Math.max(0, len - h) / 2;
  const pts: Vec2[] = [];
  for (let i = 0; i <= seg; i++) { const a = -Math.PI / 2 + (Math.PI * i) / seg; pts.push([straight + r * Math.cos(a), r * Math.sin(a)]); }
  for (let i = 0; i <= seg; i++) { const a = Math.PI / 2 + (Math.PI * i) / seg; pts.push([-straight + r * Math.cos(a), r * Math.sin(a)]); }
  return pts;
}

/** Regular polygon, CCW (or CW when `ccw` is false), as a profile loop. */
export function circleLoop(cx: number, cy: number, r: number, n = 16, ccw = true): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((ccw ? i : -i) * 2 * Math.PI) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

export function buildLighting(ctx: Ctx): Part[] {
  const { L } = ctx;
  const parts: Part[] = [];
  const common = { group: 'lighting', step: STEP.finish } as const;

  // ── Front (3c-5): the LED headlight rides on a printed ASA clip that snaps into the bow bulkhead's lift hand-hold and fills it. Pull the clip (and the lamp on it) out to lift the
  //    nose: no finger room is needed in the slot. It replaces the D-57 bracket that clipped over the top of the bulkhead. ──
  const bh = L.bulkhead;
  {
    const { p } = ctx;
    const len = p.liftSlotLengthIn - 2 * LAMP_CLIP.clearIn, h = p.liftSlotHeightIn - 2 * LAMP_CLIP.clearIn;
    const depth = bh.thick + LAMP_CLIP.lipIn; // flush with the bulkhead's rear face (the foot brace stays smooth), a lip proud of the front face for the lamp
    const lampX0 = bh.x0 + depth; // the lamp's rear face rests against the lip
    parts.push(profilePart(ctx, {
      id: 'lamp-clip', name: 'Front lamp clip (fills the hand-hold)', group: 'lighting', mat: 'print', material: 'ASA', outline: stadiumOutline(len, h), depth,
      basis: 'yz', origin: [bh.x0, 0, L.hold.zMid], removable: true, step: STEP.finish, explode: unit(0.8, 0, 0.3), fab: 'print',
      joints: [
        { type: 'pin', to: 'bow-bulkhead', count: 2, size: 'two snap detent ribs, 0.04 in proud, on the long faces of the plug', note: 'tool-free: it pushes in from the front until the lamp stops against the bulkhead and pulls out the same way' },
        { type: 'threaded-insert', to: 'front-light', count: 2, size: 'M4 heat-set inserts in the clip\'s front lip' },
      ],
      notes: `Printed ASA plug, ${len.toFixed(2)}" × ${h.toFixed(2)}" (the ${p.liftSlotLengthIn}" × ${p.liftSlotHeightIn}" hand-hold less ${LAMP_CLIP.clearIn}" a side), ${depth.toFixed(2)}" long: through the ${bh.thick}" bulkhead, its rear face flush with the foot brace and ${LAMP_CLIP.lipIn}" proud of the front. A stadium extrusion (outline in y-z, depth along x): print it lying on one long face so the layers run along the plug and the lip is not a stack of thin layers (P4); 4+ perimeters. Two 0.04" detent ribs make the push fit firm; the lamp's flat mount screws to two M4 heat-set inserts in the lip. To lift the nose: pull the lamp and clip out the front (it rides in the box, with the cushions; the rear lamp pops out of the rear hand-hold the same way, D-64), then grip the oak bar above the slot (D-37, D-57). It is not on a load path; it is removable. VERIFY ON THE REAL PARTS (build 3c-8): the plug has only ${LAMP_CLIP.clearIn}" of clearance a side in a Shaper-cut, epoxy-sealed slot, which is inside the printer's tolerance and the router's wander; print a 1" test slice at 0.04 to 0.05" a side with 0.05" ribs and try it in the real hand-hold (and the real lamp mount) before printing the whole clip.`,
    }));
    const lampW = FRONT_LIGHT_SIZE[0];
    parts.push(box(ctx, {
      ...common, id: 'front-light', name: 'Front LED headlight', mat: 'fixed', massLb: FRONT_LIGHT_MASS_LB, kind: 'purchased', material: 'LED headlight (Giant Recon 600)', fab: 'buy',
      removable: true, explode: unit(0.8, 0, 0.2), size: [...FRONT_LIGHT_SIZE],
      center: [lampX0 + lampW / 2, 0, L.hold.zMid],
      sourcing: { vendor: 'Bicycle Warehouse (Giant Recon 600 rechargeable LED headlight, 87 g, flat mount)', costUsd: 41.95 },
      joints: [{ type: 'screw', to: 'lamp-clip', count: 2, size: 'M4 stainless, into heat-set inserts in the lip' }],
      notes: 'D-83: Giant Recon 600 (87 g); the printed clip was drawn for a different light, so RE-MEASURE the clip and its two screw inserts to the real light before printing. Faces forward from the front lip of the lamp clip, which sits in the bow bulkhead\'s hand-hold (3c-5). Warm-white lens.',
    }));
  }

  // ── Flag tube (D-57): a plain purchased tube standing inside a rear corner, top flush with the side top, a drain hole near the bottom, held by two screwed oak blocks ──
  {
    const { p } = ctx;
    const od = p.flagTubeOdIn, id = p.flagTubeIdIn;
    const rearTx0 = L.xRear + L.transom;
    const lane = p.storageLocation === STORAGE_LOCATION.rearOverAxle ? L.rearLane : 0;
    const xc = rearTx0 + lane + od / 2;
    const yIn = L.hwC - 0.05; // inner face of the side (the gutter beside the box)
    const yTube = yIn - od / 2;
    const zTop = sideTopAt(L, xc); // flush with the gunwale top
    const zBot = L.deckTop;
    const len = zTop - zBot;
    parts.push(cylinder(ctx, {
      ...common, id: 'flag-tube', name: 'Flag tube (1" ID)', mat: 'fixed', massLb: FLAG_TUBE_LB_PER_IN * len, kind: 'purchased', material: '1" schedule 40 PVC tube (or 1" ID aluminum)', fab: 'buy', removable: false,
      axis: 'z', radius: od / 2, length: len, center: [xc, yTube, zBot + len / 2], explode: unit(0, 1, 0.5),
      sourcing: { vendor: `McMaster-Carr (1" schedule 40 PVC pipe, ${od.toFixed(3)}" OD, ${id.toFixed(2)}" ID, cut ${len.toFixed(1)}" long)`, costUsd: 4 },
      joints: [
        { type: 'glue', to: 'flag-block-top', count: 1, size: 'thickened epoxy (or 3M 5200) on the scuffed tube, in the half-round relief', note: 'D-72: no screws into the tube. A wood screw long enough to hold in the block would run through the 0.13 in tube wall into the bore the flag staff slides in.' },
        { type: 'glue', to: 'flag-block-bottom', count: 1, size: 'thickened epoxy (or 3M 5200) on the scuffed tube, in the half-round relief' },
      ],
      notes: `D-57 (replaces the printed socket on the bow): a plain ${id.toFixed(2)}" ID tube ${len.toFixed(1)}" long standing on the deck in the left rear corner, against the front of the handle-socket backer and the inside of the side, its top flush with the gunwale top (z ${zTop.toFixed(2)}"). A ${FLAG_DRAIN_HOLE_IN}" drain hole is drilled through the wall just above the deck so water cannot stand in it (it runs out through the rear scupper). The flag staff (a ${(id - 0.05).toFixed(2)}" dowel) drops in; ${len.toFixed(0)}" of socket holds it.`,
    }));
    const blk = (id: string, name: string, z0: number, to: string, note: string) => box(ctx, {
      ...common, id, partNo: 'flag-block', name, mat: 'oak', grain: 'z', step: STEP.finish,
      ...span([xc + od / 2, xc + od / 2 + FLAG_BLOCK.t], [yIn - FLAG_BLOCK.w, yIn], [z0, z0 + FLAG_BLOCK.h]), // 1.4 in across: it stays off the box wall
      joints: [{ type: 'glue', to, count: 1, size: 'thickened epoxy, full face', note }, { type: 'glue', to: 'flag-tube', count: 1, size: 'thickened epoxy (or 3M 5200) in the half-round relief', note: 'D-72: no screws into the tube wall (the tips would run into the staff bore)' }],
      notes: `Oak holding block (D-57, D-62): ${FLAG_BLOCK.t}" × ${FLAG_BLOCK.w}" × ${FLAG_BLOCK.h}" with a half-round relief for the tube, EPOXIED to the inner oak band of the sandwich side (no screws into the side: the thin web holds no screw, build 3c M4; D-72: no screws into the tube either, the tube is bonded into the relief) so it clamps the tube against the transom backer. Two blocks (top and bottom) hold a 14" tube; the tube stays put without them clipped to anything else.`,
    });
    parts.push(blk('flag-block-top', 'Flag tube block (top)', zTop - FLAG_BLOCK.h - 0.1, 'side-L-gunwale-in', 'epoxied to the inner gunwale band (1-1/2 in tall, the block lies on it)'));
    parts.push(blk('flag-block-bottom', 'Flag tube block (bottom)', zBot + 0.4, 'side-L-chine-in', 'epoxied to the inner chine band (the block lies on it)'));
  }

  // ── Rear (D-64): the red tail light rides on a printed ASA clip that snaps into the REAR transom's lift hand-hold and fills it, facing aft: the mirror of the front lamp. Pop it
  //    out to use the hand-hold. It replaces the printed plate and the 3/4 in oak doubler that sat beside the slot. ──
  {
    const { p } = ctx;
    const rs = liftSlot(ctx);
    const zMid = (rs.zBot + rs.zTop) / 2;
    const len = p.liftSlotLengthIn - 2 * LAMP_CLIP.clearIn, h = p.liftSlotHeightIn - 2 * LAMP_CLIP.clearIn;
    const rearTxIn = L.xRear + L.transom; // the transom's inner face
    const gap = L.storage.x0 - rearTxIn; // from the inner face to the storage box end
    const inner = Math.max(0, Math.min(REAR_LAMP_CLIP.innerLipIn, gap - REAR_LAMP_CLIP.boxClearIn));
    const outer = REAR_LAMP_CLIP.outerLipIn;
    const depth = outer + L.transom + inner;
    const clipX0 = L.xRear - outer;
    parts.push(profilePart(ctx, {
      id: 'rear-lamp-clip', name: 'Rear lamp clip (fills the hand-hold)', group: 'lighting', mat: 'print', material: 'ASA', outline: stadiumOutline(len, h), depth,
      basis: 'yz', origin: [clipX0, 0, zMid], removable: true, step: STEP.finish, explode: unit(-0.8, 0, 0.3), fab: 'print',
      joints: [
        { type: 'pin', to: 'transom-rear', count: 2, size: 'two snap detent ribs, 0.04 in proud, on the long faces of the plug', note: 'tool-free: it pushes in from behind until the outer lip stops against the transom and pulls out the same way' },
        { type: 'threaded-insert', to: 'rear-light', count: 2, size: 'M3 heat-set inserts in the clip\'s outer lip' },
      ],
      notes: `D-64: printed ASA plug, ${len.toFixed(2)}" × ${h.toFixed(2)}" (the ${p.liftSlotLengthIn}" × ${p.liftSlotHeightIn}" rear hand-hold less ${LAMP_CLIP.clearIn}" a side), ${depth.toFixed(2)}" long: through the ${L.transom}" transom, ${outer}" proud of the outer face (the lip that carries the tail light) and ${inner.toFixed(2)}" past the inner face, which leaves ${(gap - inner).toFixed(2)}" to the storage box end (at least ${REAR_LAMP_CLIP.boxClearIn}"). The same stadium extrusion as the front clip (outline in y-z, depth along x): print it lying on one long face, 4+ perimeters (P4). Two 0.04" detent ribs make the push fit firm; the light's flat mount screws to two M3 heat-set inserts in the outer lip. Pop it out before lifting: the rear lifter's hands need the slot, so both lamps come out (D-37, D-64). It is not on a load path; it is removable. VERIFY ON THE REAL PARTS: only ${LAMP_CLIP.clearIn}" of clearance a side in a Shaper-cut, epoxy-sealed slot in a ${L.transom}" transom whose slot edges are eased; print a 1" test slice at 0.04 to 0.05" a side with 0.05" ribs and try it in the real hand-hold before printing the whole clip.`,
    }));
    parts.push(box(ctx, {
      ...common, id: 'rear-light', name: 'Rear red light', mat: 'fixed', massLb: REAR_LIGHT_MASS_LB, kind: 'purchased', material: 'LED tail light (Planet Bike Spok)', fab: 'buy',
      removable: true, size: [...REAR_LIGHT_SIZE], center: [clipX0 - REAR_LIGHT_SIZE[0] / 2, 0, zMid],
      sourcing: { vendor: 'Bicycle Warehouse (Planet Bike Spok rear LED light)', costUsd: 21.99 },
      joints: [{ type: 'screw', to: 'rear-lamp-clip', count: 2, size: 'M3 × 8 stainless, into heat-set inserts in the outer lip' }],
      explode: unit(-1, 0, 0.5), notes: 'D-64, D-83: Planet Bike Spok (mass about 0.06 lb: VERIFY); the printed clip must be RE-MEASURED to the real light before printing. Faces aft from the outer lip of the rear lamp clip, centered on the transom\'s hand-hold. Red lens. Pops out with the clip before lifting.',
    }));
  }

  // ── Side reflectors (DOT-C2 adhesive-backed), forward and aft on each side: on the outside face of the gunwale, turned to the sled slope ──
  const { p } = ctx;
  const reach = L.xSideEnd - L.xRear;
  const washers = sideRibStations(p, L).map(ribWasherSpan);
  for (const { s, tag } of SIDES) {
    REFLECTOR_FRACS.forEach((f, i) => {
      let x = Math.max(L.xRear + reach * f, SIGN_X_MAX_IN + 2); // the rear one stands ahead of the side sign (D-57)
      // D-63: the grab board's 316 backing strip is on the same outer gunwale face; a reflector that would sit on it moves just ahead of it
      const stripX0 = p.seatXIn - GRIP_BEHIND_HPOINT_IN + GRIP_BACKING_END_IN - 0.3, stripX1 = p.seatXIn - GRIP_BEHIND_HPOINT_IN + p.grabBoardLengthIn - GRIP_BACKING_END_IN + 0.3;
      // D-76: and it stays 1/4 in clear of the outside fender washers of the side-rib D-ring bolts (D-83) (the box rib's station is set so the rear one does not have to move).
      for (const [wa, wb] of washers) if (x + REFLECTOR_SIZE[0] / 2 + 0.25 > wa && x - REFLECTOR_SIZE[0] / 2 - 0.25 < wb) x = wb + REFLECTOR_SIZE[0] / 2 + 0.25;
      if (x + REFLECTOR_SIZE[0] / 2 + 0.1 > stripX0 && x - REFLECTOR_SIZE[0] / 2 - 0.1 < stripX1) x = stripX1 + REFLECTOR_SIZE[0] / 2 + 0.3;
      const color = i === 0 ? 'red' : 'amber'; // 3c-5: red at the rear, amber at the front (DOT-C2 side marker colors)
      // D-66: the side draws in toward the bow (L.turnIn), so the reflector sits on the tapered outer face and turns with it in plan.
      const outerHalf = L.hwC + L.side - L.turnIn(x);
      const dTurn = (L.turnIn(x + 0.25) - L.turnIn(x - 0.25)) / 0.5;
      parts.push(box(ctx, {
        id: `reflector-${tag}${i + 1}`, partNo: 'reflector', name: `Side reflector ${tag}${i + 1} (${color}, ${i === 0 ? 'rear' : 'front'})`, group: 'lighting', mat: 'fixed', massLb: REFLECTOR_MASS_LB,
        kind: 'purchased', material: 'reflector', fab: 'buy', step: STEP.finish, size: [...REFLECTOR_SIZE],
        center: [x, s * (outerHalf + REFLECTOR_SIZE[1] / 2), sideTopAt(L, x) - L.railBand / 2], rot: { y: sideSlopeAt(L, x), z: -s * Math.atan(dTurn) },
        sourcing: { vendor: `Generic 2" × 1" adhesive-backed prismatic side reflector, ${color} (DOT-C2 class: amber at the front, red at the rear)`, costUsd: 2 },
        notes: `Stick-on ${color} prismatic reflector on the gunwale's outer face; wipe the varnish clean and press for 60 s (D-41, 3c-5).`,
      }));
    });
  }
  return parts;
}

export function buildHardware(ctx: Ctx): Part[] {
  const { L } = ctx;
  // Under the deck, centerd in the widest gap between cabin crossmembers (and clear of a tall rear axle beam).
  const zBot = L.deckBot - HARDWARE_SIZE[2];
  const blockers: Array<[number, number]> = L.joistX.map((x) => [x - L.joistT / 2, x + L.joistT / 2]);
  if (L.beamR.top > zBot) blockers.push([L.beamR.x - L.beamR.thick / 2, L.beamR.x + L.beamR.thick / 2]);
  blockers.sort((a, b) => a[0] - b[0]);
  let lo = L.xRear + L.transom, bestLo = lo, bestHi = lo;
  for (const [b0, b1] of [...blockers, [L.xFlatEnd, L.xFlatEnd] as [number, number]]) {
    if (b0 - lo > bestHi - bestLo) { bestLo = lo; bestHi = b0; }
    lo = Math.max(lo, b1);
  }
  const gap = Math.max(0.1, bestHi - bestLo);
  const sx = Math.min(HARDWARE_SIZE[0], gap);
  return [box(ctx, {
    id: 'hardware', name: 'Fasteners, inserts & misc', group: 'hardware', mat: 'fixed', massLb: HARDWARE_FALLBACK_LB, kind: 'purchased', fab: 'buy',
    material: `${stainless(ctx.p)} screws and bolts, ${insertMat(ctx.p)} inserts, Dominos; epoxy`,
    sourcing: { vendor: `McMaster-Carr / Fastenal (${stainless(ctx.p)} wood screws and machine screws, ${insertMat(ctx.p)} threaded inserts; Festool Dominos; the epoxy kit of the parts list).${ctx.p.weatherSpec === WEATHER_SPEC.extreme ? ' Stainless throughout: no zinc or brass in wet oak (S7).' : ''}`, costUsd: 60 },
    step: STEP.finish, size: [sx, HARDWARE_SIZE[1], HARDWARE_SIZE[2]], center: [(bestLo + bestHi) / 2, 0, L.deckBot - HARDWARE_SIZE[2] / 2],
    notes: 'Fastener remainder, set from the joint list by applyHardwareMass. Parked under the deck center.',
  })];
}

/** Fastener counts and mass by category (lb) for the parts of a model, each physical fastener counted once (a joint listed on both parts counts once). */
export function fastenerBreakdown(parts: Part[]): Record<string, { count: number; lb: number }> {
  const out: Record<string, { count: number; lb: number }> = {};
  const add = (k: string, n: number, lb: number) => { const r = (out[k] ??= { count: 0, lb: 0 }); r.count += n; r.lb += n * lb; };
  const live = parts.filter((x) => !x.payload && x.id !== 'hardware');
  const byId = new Map(live.map((x) => [x.id, x]));
  for (const part of live) {
    for (const j of part.joints ?? []) {
      const mate = byId.get(j.to)?.joints?.find((k) => k.to === part.id && k.count === j.count && k.type === j.type);
      if (mate && j.to < part.id) continue; // same physical joint, listed on the other part
      if (!mate && !byId.has(j.to)) continue; // joint to a part that is not in this configuration
      const n = j.count;
      switch (j.type) {
        case 'screw': add('screws', n, FASTENER_LB.screw); break;
        case 'bolt': {
          if (ITEMIZED_BOLT.test(part.id) || ITEMIZED_BOLT.test(j.to)) { add('nuts and washers (itemized bolts)', n, FASTENER_LB.nutWasher); break; }
          const size = j.size ?? '';
          if (/see the bushing/.test(size)) break; // cross-reference to the bushing's own bolts, already counted
          if (/tapped/.test(size)) { add('bolts tapped into steel', n, FASTENER_LB.boltTapped); break; }
          const dia = j.diaIn ?? parseDia(size);
          if (dia < 0.2) { add('machine screw sets', n, FASTENER_LB.machineScrew); break; } // 6-32 and #8-32 machine-screw sets (the D-ring bolts are 1/4-20 now, D-83: bolt sets)
          add('bolt sets', n, dia > 0.33 ? FASTENER_LB.boltLarge : FASTENER_LB.boltSmall);
          break;
        }
        case 'threaded-insert': add('inserts', n, FASTENER_LB.insert); break;
        case 'knob': add('thumb knobs', n, FASTENER_LB.knob); break;
        case 'domino': add('Dominos', n, FASTENER_LB.domino); break;
        case 'glue': add('epoxy joints', n, FASTENER_LB.glue); break;
        default: break;
      }
    }
  }
  return out;
}

/** Shank diameter (in) from a size string such as '0.4375" carriage bolts', '3/8" hex bolt' or '1/4-20 x 1'; 0 when none is found. */
function parseDia(size: string): number {
  const d = /(\d+)\/(\d+)/.exec(size);
  if (d && !/^\d+\s*[x×]/.test(size.trim())) return Number(d[1]) / Number(d[2]);
  const f = /(0\.\d+)"/.exec(size);
  return f ? Number(f[1]) : 0.25;
}

/** Set the hardware part's mass from the fasteners that are not separate parts. Call after the joinery (and any transport filtering). */
export function applyHardwareMass(parts: Part[]): void {
  const hw = parts.find((x) => x.id === 'hardware');
  if (!hw) return;
  const total = Object.values(fastenerBreakdown(parts)).reduce((a, r) => a + r.lb, 0);
  hw.massLb = total > 0 ? Math.round(total * 100) / 100 : HARDWARE_FALLBACK_LB;
  hw.notes = `Computed remainder (Phase 3): every fastener, insert, Domino and epoxy joint that is not a separate part, from the joint list at typical stainless unit masses (src/model/lighting.ts, fastenerBreakdown). Parked under the deck center.`;
}
