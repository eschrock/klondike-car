/**
 * Lighting (D-9, D-41) and the hardware allowance. The front lantern bracket and the flag-pole socket clip onto the tip of the bow curl (D-54);
 * the rear light mounts on a flat printed plate on the rear transom. Brackets are
 * ASA (UV-stable) 2D profiles + depth, so they go straight to an STL in Phase 4; they are not on a primary load path.
 */
import { STORAGE_LOCATION } from '../params';
import { STEP, box, span, SIDES, type Ctx } from './build-utils';
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
const FRONT_LIGHT_SIZE = [3, 2.2, 1.8] as const;
const REAR_LIGHT_MASS_LB = 0.3;
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
const ITEMIZED_BOLT = /^(bridle-eye|eyebolt|clamp-|brake-(pivot-pin|link-pin-[TB]|park-pin|lever-pin)|handle-pin|seat-knob)/;
const HARDWARE_FALLBACK_LB = 2.5;
const HARDWARE_SIZE = [2, 2, 1.25] as const;
/** Cabin reflectors at these fore-aft fractions of the cabin length (clear of the signs and the nose). */
export const REFLECTOR_FRACS = [0.1, 0.95] as const;
/** Printed clip: wall thickness, clearance to the transom, leg depth, width across, shelf length ahead of the transom. */
export const CLIP = { wall: 0.25, clearance: 0.03, leg: 1.25, width: 2.5, shelf: 3 } as const;
/** Rear plate: width across, height, thickness; hole radius. */
export const REAR_PLATE = { width: 4, height: 2.4, thick: 0.25, hole: 0.1 } as const;
/** Oak left between the lift slot's end and the rear-light plate. */
const REAR_PLATE_SLOT_GAP_IN = 0.75;
/** Least height of free inner transom face (above the lid frame) that takes an inside doubler. */
const MIN_INSIDE_DOUBLER_IN = 1.25;
/** Flag-pole socket: outer and bore radius, height (a 1/2" fiberglass staff). */
export const FLAG_SOCKET = { rOut: 0.6, rBore: 0.27, height: 3 } as const;

/** Regular polygon, CCW (or CW when `ccw` is false), as a profile loop. */
export function circleLoop(cx: number, cy: number, r: number, n = 16, ccw = true): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((ccw ? i : -i) * 2 * Math.PI) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** Inverted-U clip over a transom of thickness `side` (x), top at z = 0; optional forward shelf for a light. Local (x aft→fore, z up). */
export function clipOutline(side: number, shelf: boolean): Vec2[] {
  const { wall: w, clearance: c, leg: d } = CLIP;
  const xf = side + c + w;
  const tail: Vec2[] = shelf
    ? [[xf, c], [xf + CLIP.shelf, c], [xf + CLIP.shelf, c + w]]
    : [[xf, c + w]];
  return [[-w - c, -d], [-c, -d], [-c, c], [side + c, c], [side + c, -d], [xf, -d], ...tail, [-w - c, c + w]];
}

export function buildLighting(ctx: Ctx): Part[] {
  const { L } = ctx;
  const parts: Part[] = [];
  const common = { group: 'lighting', step: STEP.finish } as const;

  // ── Front: clips over the tip of the bow curl (D-54), lantern left of center, flag-pole socket right of center ──
  // The curl's tip edge is nearly vertical (bowCurlAngleDeg off the deck); the clip is drawn upright over it, centered on the panel at the tip.
  const curl = L.curl;
  const tipTopZ = L.deckTop - curl.thick / 2 + curl.rise + (curl.thick / 2) * Math.sin(curl.angleRad);
  const x0c = L.xFront - curl.thick / 2 - (curl.thick / 2) * Math.cos(curl.angleRad) * 0;
  const yc = Math.max(2.3, Math.min(4.5, L.hwC - CLIP.width / 2 - 0.15));
  const zT = tipTopZ;
  const clipJoint = (to: string) => [{ type: 'knob' as const, to, count: 2, size: 'M5 thumbscrew in the leg, clamping the curl', note: 'tool-free; friction clamp over the curl\'s top edge (not a load path)' }];
  const lantern = profilePart(ctx, {
    id: 'lantern-mount', name: 'Front lantern bracket', group: 'lighting', mat: 'print', material: 'ASA', outline: clipOutline(curl.thick, true), depth: CLIP.width,
    basis: 'xz', origin: [x0c, yc + CLIP.width / 2, zT], removable: true, step: STEP.finish, explode: [0.6, 0, 0.8],
    joints: clipJoint('bow-curl'),
    notes: 'Printed ASA, 4+ perimeters, printed with the extrusion profile flat on the bed (layers parallel to the profile, strong in bending, P4); 0.25" shelf ribbed or printed in CF-nylon, 1/8" fillets at the inside corners. Heat-set inserts for the M5 stainless thumbscrews (brass is fine inside the plastic, away from the oak). Clips over the top of the bow curl and carries the headlight on its forward shelf. Comes off with the light for transport.',
  });
  parts.push(lantern);
  const shelfX0 = x0c + curl.thick + CLIP.clearance + CLIP.wall;
  const wz = zT + CLIP.clearance + CLIP.wall;
  parts.push(box(ctx, {
    ...common, id: 'front-light', name: 'Front LED headlight', mat: 'fixed', massLb: FRONT_LIGHT_MASS_LB, kind: 'purchased', material: 'LED headlight', fab: 'buy',
    removable: true, explode: unit(0.6, 0, 1), size: [...FRONT_LIGHT_SIZE],
    center: [shelfX0 + FRONT_LIGHT_SIZE[0] / 2, yc, wz + FRONT_LIGHT_SIZE[2] / 2],
    sourcing: { vendor: 'Generic 800 lm rechargeable LED bike headlight with a flat mount (e.g. Cygolite / NiteRider class)', costUsd: 40 },
    joints: [{ type: 'screw', to: 'lantern-mount', count: 2, size: 'M4 stainless, into heat-set inserts in the shelf' }],
    notes: 'Mass is an estimate. Faces forward on the shelf.',
  }));
  parts.push(profilePart(ctx, {
    id: 'flag-mount', name: 'Flag-pole clip', group: 'lighting', mat: 'print', material: 'ASA', outline: clipOutline(curl.thick, false), depth: CLIP.width,
    basis: 'xz', origin: [x0c, -yc + CLIP.width / 2, zT], removable: true, step: STEP.finish, explode: [0.6, 0, 0.8],
    joints: clipJoint('bow-curl'),
    notes: 'Printed ASA, 4+ perimeters, profile flat on the bed (P4); heat-set inserts for the M5 stainless thumbscrews (brass is fine inside the plastic). Clips over the top of the bow curl, right of center (D-45: there is no prow; the staff socket carries the flag).',
  }));
  const sock: [Vec2[], Vec2[]] = [circleLoop(0, 0, FLAG_SOCKET.rOut), circleLoop(0, 0, FLAG_SOCKET.rBore, 16, false)];
  parts.push(profilePart(ctx, {
    id: 'flag-socket', name: 'Flag-pole socket', group: 'lighting', mat: 'print', material: 'ASA', outline: sock[0], holes: [sock[1]], depth: FLAG_SOCKET.height,
    basis: 'xy', origin: [x0c + curl.thick / 2, -yc, wz], removable: true, step: STEP.finish, explode: [0, 0, 1],
    joints: [{ type: 'pin', to: 'flag-mount', count: 2, size: '#6-32 stainless, into heat-set inserts', note: 'the staff drops in and is held by a thumbscrew' }],
    notes: 'Printed ASA tube for a 1/2" staff, 3" deep.',
  }));

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
      const x = L.xRear + reach * f;
      parts.push(box(ctx, {
        id: `reflector-${tag}${i + 1}`, partNo: 'reflector', name: `Side reflector ${tag}${i + 1}`, group: 'lighting', mat: 'fixed', massLb: REFLECTOR_MASS_LB,
        kind: 'purchased', material: 'reflector', fab: 'buy', step: STEP.finish, size: [...REFLECTOR_SIZE],
        center: [x, s * (L.hwC + L.side + REFLECTOR_SIZE[1] / 2), sideTopAt(L, x) - L.railBand / 2], rot: { y: sideSlopeAt(L, x) },
        sourcing: { vendor: 'Generic 2" × 1" adhesive-backed amber/white side reflector (DOT-C2 class)', costUsd: 2 },
        notes: 'Stick-on reflector on the gunwale\'s outer face; wipe the varnish clean and press for 60 s (D-41).',
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
