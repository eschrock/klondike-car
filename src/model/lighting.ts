/**
 * Lighting (D-9, D-41) and the hardware allowance. The front LED headlight rides on a printed ASA clip that snaps into the bow bulkhead's lift hand-hold (3c-5; the flag stands in a plain tube in a rear corner);
 * the rear light mounts on a flat printed plate on the rear transom. Brackets are
 * ASA (UV-stable) 2D profiles + depth, so they go straight to an STL in Phase 4; they are not on a primary load path.
 */
import { STORAGE_LOCATION } from '../params';
import { STEP, box, cylinder, span, SIDES, type Ctx } from './build-utils';
import { SIGN_X_MAX_IN } from './body';
import { sideSlopeAt, sideTopAt } from './layout';
import { profilePart } from './profile';
import { storageGeometry } from './storage';
import type { Part, Vec2, Vec3 } from './types';

const unit = (x: number, y: number, z: number): Vec3 => {
  const n = Math.hypot(x, y, z) || 1;
  return [x / n, y / n, z / n];
};

// ── Estimates / placeholders (D-41) ──
const FRONT_LIGHT_MASS_LB = 0.4;
/** 3c visual round 2: 1.25x across and tall (was 3 x 2.2 x 1.8; the reviewer found it small against the 21 in bulkhead). Same length (no longer overall), the top at about 4.75 in over the deck, still under the 4 7/8 in bulkhead corners. */
const FRONT_LIGHT_SIZE = [3, 2.75, 2.25] as const;
const REAR_LIGHT_MASS_LB = 0.3;
/** The lamp clip (3c-5): print clearance per side in the slot, and how far the plug stands proud of the bulkhead's front face (the lamp's seat). */
export const LAMP_CLIP = { clearIn: 0.02, lipIn: 0.5 } as const;
const REAR_LIGHT_SIZE = [0.75, 2, 1.5] as const;
const REFLECTOR_MASS_LB = 0.05;
export const REFLECTOR_SIZE = [2, 0.25, 1] as const;
/**
 * Fastener allowance (Phase 3 integration). The old flat 2.5 lb lump predated the itemized hinges, latches, lash plates, U-bolts,
 * eye bolts, kingpin, pins and clamp plates, so it is now a REMAINDER computed from the model's own joints: every fastener that is
 * not a separate part (wood and machine screws, carriage/hex bolts with their nuts and washers, inserts, thumb-knob screws,
 * Dominos, epoxy) at a typical stainless/zinc unit mass. At the defaults the arithmetic (see `fastenerBreakdown`) is about:
 *   screws          ~114 x 0.008 lb = 0.91   (#8-#10 stainless, 3/4" to 2-1/2" long, 3 to 16 g)
 *   bolt sets        ~48 x 0.04-0.09 lb      (1/4" to 3/8" bolt + nut + washer(s); 0.02 lb for a screw tapped into a hub)
 *   inserts, knobs   ~20 x 0.005 / 0.02 lb
 *   Dominos          ~24 x 0.005 lb
 *   epoxy            ~45 glued joints x 0.01 lb (squeeze-out and fillets are in the glue-line allowance, not the wood)
 *   itemized bolts   nuts + washers for the kingpin, eye bolts and U-bolts, 0.03 lb per leg
 */
const FASTENER_LB = {
  screw: 0.008, boltSmall: 0.04, boltLarge: 0.09, boltTapped: 0.02, insert: 0.005, knob: 0.02, domino: 0.005, glue: 0.01, nutWasher: 0.03,
} as const;
/** Bolts whose shank is already a separate part (kingpin, eye bolts, U-bolts, brake and handle pins): only their nuts and washers are left for the allowance. */
const ITEMIZED_BOLT = /^(bridle-eye|eyebolt|clamp-|handle-pin|seat-knob)/;
const HARDWARE_FALLBACK_LB = 2.5;
const HARDWARE_SIZE = [2, 2, 1.25] as const;
/** Cabin reflectors at these fore-aft fractions of the cabin length (clear of the signs and the nose). */
export const REFLECTOR_FRACS = [0.1, 0.95] as const;
/** Rear plate: width across, height, thickness; hole radius. */
export const REAR_PLATE = { width: 4, height: 2.4, thick: 0.25, hole: 0.1 } as const;
/** Oak left between the lift slot's end and the rear-light plate. */
const REAR_PLATE_SLOT_GAP_IN = 0.75;
/** Least height of free inner transom face (above the lid frame) that takes an inside doubler. */
const MIN_INSIDE_DOUBLER_IN = 1.25;
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
      notes: `Printed ASA plug, ${len.toFixed(2)}" × ${h.toFixed(2)}" (the ${p.liftSlotLengthIn}" × ${p.liftSlotHeightIn}" hand-hold less ${LAMP_CLIP.clearIn}" a side), ${depth.toFixed(2)}" long: through the ${bh.thick}" bulkhead, its rear face flush with the foot brace and ${LAMP_CLIP.lipIn}" proud of the front. A stadium extrusion (outline in y-z, depth along x): print it lying on one long face so the layers run along the plug and the lip is not a stack of thin layers (P4); 4+ perimeters. Two 0.04" detent ribs make the push fit firm; the lamp's flat mount screws to two M4 heat-set inserts in the lip. To lift the nose: pull the lamp and clip out the front (it rides in the box, with the cushions), then grip the oak bar above the slot (D-37, D-57). It is not on a load path; it is removable.`,
    }));
    const lampW = FRONT_LIGHT_SIZE[0];
    parts.push(box(ctx, {
      ...common, id: 'front-light', name: 'Front LED headlight', mat: 'fixed', massLb: FRONT_LIGHT_MASS_LB, kind: 'purchased', material: 'LED headlight', fab: 'buy',
      removable: true, explode: unit(0.8, 0, 0.2), size: [...FRONT_LIGHT_SIZE],
      center: [lampX0 + lampW / 2, 0, L.hold.zMid],
      sourcing: { vendor: 'Generic 800 lm rechargeable LED bike headlight with a flat mount (e.g. Cygolite / NiteRider class)', costUsd: 40 },
      joints: [{ type: 'screw', to: 'lamp-clip', count: 2, size: 'M4 stainless, into heat-set inserts in the lip' }],
      notes: 'Mass is an estimate. Faces forward from the front lip of the lamp clip, which sits in the bow bulkhead\'s hand-hold (3c-5). Warm-white lens.',
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
        { type: 'screw', to: 'flag-block-top', count: 2, size: '#8 × 1-1/4 stainless, through the block and the tube wall', note: 'the top block holds the tube; no tools to use the tube' },
        { type: 'screw', to: 'flag-block-bottom', count: 2, size: '#8 × 1-1/4 stainless' },
      ],
      notes: `D-57 (replaces the printed socket on the bow): a plain ${id.toFixed(2)}" ID tube ${len.toFixed(1)}" long standing on the deck in the left rear corner, against the front of the handle-socket backer and the inside of the side, its top flush with the gunwale top (z ${zTop.toFixed(2)}"). A ${FLAG_DRAIN_HOLE_IN}" drain hole is drilled through the wall just above the deck so water cannot stand in it (it runs out through the rear scupper). The flag staff (a ${(id - 0.05).toFixed(2)}" dowel) drops in; ${len.toFixed(0)}" of socket holds it.`,
    }));
    const blk = (id: string, name: string, z0: number, to: string, note: string) => box(ctx, {
      ...common, id, partNo: 'flag-block', name, mat: 'oak', grain: 'z', step: STEP.finish,
      ...span([xc + od / 2, xc + od / 2 + FLAG_BLOCK.t], [yIn - FLAG_BLOCK.w, yIn], [z0, z0 + FLAG_BLOCK.h]), // 1.4 in across: it stays off the box wall
      joints: [{ type: 'screw', to, count: 2, size: '#10 × 1-1/4 stainless, through the block into the side', note }, { type: 'screw', to: 'flag-tube', count: 2, size: '#8 × 1-1/4 stainless, into the tube wall' }, { type: 'glue', to, count: 1, note: 'epoxy to the side' }],
      notes: `Oak holding block (D-57): ${FLAG_BLOCK.t}" × ${FLAG_BLOCK.w}" × ${FLAG_BLOCK.h}" with a half-round relief for the tube, epoxied and screwed to the inside of the side so it clamps the tube against the transom backer. Two blocks (top and bottom) hold a 14" tube; the tube stays put without them clipped to anything else.`,
    });
    parts.push(blk('flag-block-top', 'Flag tube block (top)', zTop - FLAG_BLOCK.h - 0.1, 'side-L-gunwale', 'into the gunwale band'));
    parts.push(blk('flag-block-bottom', 'Flag tube block (bottom)', zBot + 0.4, 'side-L-web', 'into the side panel, with the epoxy bed'));
  }

  // ── Rear: flat plate on the rear transom's outer face, the red light on it ──
  // The plate sits beside the lift slot (B's 4.5" hand-hold is centered on the transom; a centered plate would cover it and its screws
  // would land in the void), on the right (-y) side, with an oak doubler on the inner face so the screws have > 3/4" of engagement in the 1/2" transom.
  const { p } = ctx;
  const zTop = L.deckTop + L.sideRear; // the rear transom's top corners
  const plateZ0 = zTop - REAR_PLATE.height;
  const hw2 = REAR_PLATE.width / 2;
  const hz = plateZ0 + REAR_PLATE.height / 2;
  const yP = -(p.liftSlotLengthIn / 2 + hw2 + REAR_PLATE_SLOT_GAP_IN);
  const rearTx = L.xRear + L.transom;
  const st = storageGeometry(p, L);
  const zLo = p.storageLocation === STORAGE_LOCATION.rearOverAxle ? Math.max(plateZ0 + 0.3, st.zTop + 0.05) : plateZ0 + 0.3;
  // A tall rear box fills the transom's inner face up to the gunwale line: then the doubler goes on the outer face and the plate stands off it.
  const inside = zTop - zLo >= MIN_INSIDE_DOUBLER_IN;
  const T = p.blockingThickIn;
  const off = inside ? 0 : T;
  const holes: Vec2[][] = [[-1.5, hz - 0.3], [1.5, hz - 0.3], [-0.5, hz + 0.6], [0.5, hz + 0.6]].map(([hy, hzz]) => circleLoop(yP + hy, hzz, REAR_PLATE.hole, 8, false));
  parts.push(profilePart(ctx, {
    id: 'rear-light-mount', name: 'Rear light plate', group: 'lighting', mat: 'print', material: 'ASA',
    outline: [[yP - hw2, plateZ0], [yP + hw2, plateZ0], [yP + hw2, zTop], [yP - hw2, zTop]], holes, depth: REAR_PLATE.thick, basis: 'yz', origin: [L.xRear - off - REAR_PLATE.thick, 0, 0],
    step: STEP.finish, explode: unit(-1, 0, 0.3),
    joints: [{ type: 'screw', to: 'doubler-rear-light', count: 2, size: '#8 × 1-1/4 stainless pan head, through the plate into the doubler', note: inside ? `pilot-drilled; ${(1.25 - REAR_PLATE.thick).toFixed(2)}" of oak engagement (the ${L.transom}" transom + ${(1.25 - REAR_PLATE.thick - L.transom).toFixed(2)}" into the doubler)` : `pilot-drilled; ${(1.25 - REAR_PLATE.thick).toFixed(2)}" of oak engagement in the outer doubler` }],
    notes: 'Printed ASA flat plate beside the lift slot, 2 screws into the doubler and 2 for the light (not a load path). Print flat on the bed, 4+ perimeters (P4).',
  }));
  parts.push(box(ctx, {
    ...common, id: 'doubler-rear-light', partNo: 'doubler-rear-light', name: 'Rear light doubler', group: 'lighting', mat: 'oak', grain: 'y',
    ...span(inside ? [rearTx, rearTx + T] : [L.xRear - T, L.xRear], [yP - hw2 - 0.5, yP + hw2 + 0.5], inside ? [zLo, zTop] : [plateZ0, zTop]),
    joints: [{ type: 'glue', to: 'transom-rear', count: 1, note: 'epoxy, full face' }, { type: 'screw', to: 'rear-light-mount', count: 2, size: '#8 × 1-1/4 stainless, through the plate' }],
    notes: inside ? `Blocking on the inner face of the ${L.transom}" rear transom, above the lid frame, so the light-plate screws have ${(1.25 - REAR_PLATE.thick).toFixed(2)}" of engagement (D-41).`
      : `Blocking on the OUTER face of the rear transom (a tall storage box fills the inner face), so the light-plate screws have ${(1.25 - REAR_PLATE.thick).toFixed(2)}" of engagement (D-41).`,
  }));
  parts.push(box(ctx, {
    ...common, id: 'rear-light', name: 'Rear red light', mat: 'fixed', massLb: REAR_LIGHT_MASS_LB, kind: 'purchased', material: 'LED light', fab: 'buy',
    size: [...REAR_LIGHT_SIZE], center: [L.xRear - off - REAR_PLATE.thick - REAR_LIGHT_SIZE[0] / 2, yP, hz],
    sourcing: { vendor: 'Generic red LED bike tail light (USB rechargeable, rear-facing, with a screw-on bracket)', costUsd: 20 },
    joints: [{ type: 'screw', to: 'rear-light-mount', count: 2, size: 'M3 × 8 stainless' }],
    explode: unit(-1, 0, 0.5), notes: 'On the printed plate on the rear transom, off center so the lift slot stays open; mass includes the light (estimate).',
  }));

  // ── Side reflectors (DOT-C2 adhesive-backed), forward and aft on each side: on the outside face of the gunwale, turned to the sled slope ──
  const reach = L.xSideEnd - L.xRear;
  for (const { s, tag } of SIDES) {
    REFLECTOR_FRACS.forEach((f, i) => {
      const x = Math.max(L.xRear + reach * f, SIGN_X_MAX_IN + 2); // the rear one stands ahead of the side sign (D-57)
      const color = i === 0 ? 'red' : 'amber'; // 3c-5: red at the rear, amber at the front (DOT-C2 side marker colors)
      parts.push(box(ctx, {
        id: `reflector-${tag}${i + 1}`, partNo: 'reflector', name: `Side reflector ${tag}${i + 1} (${color}, ${i === 0 ? 'rear' : 'front'})`, group: 'lighting', mat: 'fixed', massLb: REFLECTOR_MASS_LB,
        kind: 'purchased', material: 'reflector', fab: 'buy', step: STEP.finish, size: [...REFLECTOR_SIZE],
        center: [x, s * (L.hwC + L.side + REFLECTOR_SIZE[1] / 2), sideTopAt(L, x) - L.railBand / 2], rot: { y: sideSlopeAt(L, x) },
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
    material: '316 stainless screws, bolts, inserts and Dominos; epoxy',
    sourcing: { vendor: 'McMaster-Carr / Fastenal (316 stainless wood screws, machine screws and threaded inserts; Festool Dominos; West System epoxy). Stainless throughout: no zinc or brass in wet oak (S7).', costUsd: 60 },
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
