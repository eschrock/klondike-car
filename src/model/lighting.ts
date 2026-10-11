/**
 * Lighting (D-9, D-41) and the hardware allowance. The front lantern bracket and the flag-pole socket clip onto the front
 * transom (the prow offers no socket yet); the rear light mounts on a flat printed plate on the rear transom. Brackets are
 * ASA (UV-stable) 2D profiles + depth, so they go straight to an STL in Phase 4; they are not on a primary load path.
 */
import { STEP, box, SIDES, type Ctx } from './build-utils';
import { cabinSidePoint } from './layout';
import { profilePart } from './profile';
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
const HARDWARE_MASS_LB = 2.5;
const HARDWARE_SIZE = [2, 2, 1.25] as const;
/** Cabin reflectors at these fore-aft fractions of the cabin length (clear of the signs and the nose). */
export const REFLECTOR_FRACS = [0.1, 0.95] as const;
/** Printed clip: wall thickness, clearance to the transom, leg depth, width across, shelf length ahead of the transom. */
export const CLIP = { wall: 0.25, clearance: 0.03, leg: 1.25, width: 2.5, shelf: 3 } as const;
/** Rear plate: width across, height, thickness; hole radius. */
export const REAR_PLATE = { width: 4, height: 2.4, thick: 0.25, hole: 0.1 } as const;
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

export function buildLighting(ctx: Ctx, _prowTipX: number, _prowTipZ: number): Part[] {
  const { L } = ctx;
  const parts: Part[] = [];
  const common = { group: 'lighting', step: STEP.finish } as const;

  // ── Front: clips on the front transom, left of the prow base (lantern) and right of it (flag-pole socket) ──
  const zT = L.noseTop + L.sideH;
  const x0c = L.xFront - L.side;
  const yc = Math.max(2.3, Math.min(4.5, L.hwN - CLIP.width / 2 - 0.15));
  const clipJoint = (to: string) => [{ type: 'knob' as const, to, count: 2, size: 'M5 thumbscrew in the leg, clamping the transom', note: 'tool-free; friction clamp + the web over the top (not a load path)' }];
  const lantern = profilePart(ctx, {
    id: 'lantern-mount', name: 'Front lantern bracket', group: 'lighting', mat: 'print', material: 'ASA', outline: clipOutline(L.side, true), depth: CLIP.width,
    basis: 'xz', origin: [x0c, yc + CLIP.width / 2, zT], removable: true, step: STEP.finish, explode: [0.6, 0, 0.8],
    joints: clipJoint('transom-front'),
    notes: 'Printed ASA, 4 perimeters; clips over the front transom and carries the headlight on its forward shelf. Comes off with the light for transport.',
  });
  parts.push(lantern);
  const shelfX0 = x0c + L.side + CLIP.clearance + CLIP.wall;
  const wz = zT + CLIP.clearance + CLIP.wall;
  parts.push(box(ctx, {
    ...common, id: 'front-light', name: 'Front LED headlight', mat: 'fixed', massLb: FRONT_LIGHT_MASS_LB, kind: 'purchased', material: 'LED headlight', fab: 'buy',
    removable: true, explode: unit(0.6, 0, 1), size: [...FRONT_LIGHT_SIZE],
    center: [shelfX0 + FRONT_LIGHT_SIZE[0] / 2, yc, wz + FRONT_LIGHT_SIZE[2] / 2],
    sourcing: { vendor: 'Generic 800 lm rechargeable LED bike headlight with a flat mount (e.g. Cygolite / NiteRider class)', costUsd: 40 },
    joints: [{ type: 'screw', to: 'lantern-mount', count: 2, size: 'M4 stainless, into heat-set inserts in the shelf' }],
    notes: 'Mass is an estimate. Faces forward on the shelf, ahead of the prow base.',
  }));
  parts.push(profilePart(ctx, {
    id: 'flag-mount', name: 'Flag-pole clip', group: 'lighting', mat: 'print', material: 'ASA', outline: clipOutline(L.side, false), depth: CLIP.width,
    basis: 'xz', origin: [x0c, -yc + CLIP.width / 2, zT], removable: true, step: STEP.finish, explode: [0.6, 0, 0.8],
    joints: clipJoint('transom-front'),
    notes: 'Printed ASA; clips over the front transom, right of the prow. The prow has no socket yet (workstream B); this takes a flag or lantern staff meanwhile.',
  }));
  const sock: [Vec2[], Vec2[]] = [circleLoop(0, 0, FLAG_SOCKET.rOut), circleLoop(0, 0, FLAG_SOCKET.rBore, 16, false)];
  parts.push(profilePart(ctx, {
    id: 'flag-socket', name: 'Flag-pole socket', group: 'lighting', mat: 'print', material: 'ASA', outline: sock[0], holes: [sock[1]], depth: FLAG_SOCKET.height,
    basis: 'xy', origin: [x0c + L.side / 2, -yc, wz], removable: true, step: STEP.finish, explode: [0, 0, 1],
    joints: [{ type: 'pin', to: 'flag-mount', count: 2, size: '#6-32 stainless, into heat-set inserts', note: 'the staff drops in and is held by a thumbscrew' }],
    notes: 'Printed ASA tube for a 1/2" staff, 3" deep.',
  }));

  // ── Rear: flat plate on the rear transom's outer face, the red light on it ──
  const zTop = L.deckTop + L.sideH;
  const plateZ0 = zTop - REAR_PLATE.height;
  const hw2 = REAR_PLATE.width / 2;
  const hz = plateZ0 + REAR_PLATE.height / 2;
  const holes: Vec2[][] = [[-1.5, hz - 0.6], [1.5, hz - 0.6], [-0.5, hz + 0.6], [0.5, hz + 0.6]].map(([hy, hzz]) => circleLoop(hy, hzz, REAR_PLATE.hole, 8, false));
  parts.push(profilePart(ctx, {
    id: 'rear-light-mount', name: 'Rear light plate', group: 'lighting', mat: 'print', material: 'ASA',
    outline: [[-hw2, plateZ0], [hw2, plateZ0], [hw2, zTop], [-hw2, zTop]], holes, depth: REAR_PLATE.thick, basis: 'yz', origin: [L.xRear - REAR_PLATE.thick, 0, 0],
    step: STEP.finish, explode: unit(-1, 0, 0.3),
    joints: [{ type: 'screw', to: 'transom-rear', count: 2, size: '#8 × 3/8 stainless pan head (the transom is only ½")', note: 'screws pilot-drilled; a 3/8" screw does not break through' }],
    notes: 'Printed ASA flat plate, 2 screws to the transom and 2 for the light (not a load path).',
  }));
  parts.push(box(ctx, {
    ...common, id: 'rear-light', name: 'Rear red light', mat: 'fixed', massLb: REAR_LIGHT_MASS_LB, kind: 'purchased', material: 'LED light', fab: 'buy',
    size: [...REAR_LIGHT_SIZE], center: [L.xRear - REAR_PLATE.thick - REAR_LIGHT_SIZE[0] / 2, 0, hz],
    sourcing: { vendor: 'Generic red LED bike tail light (USB rechargeable, rear-facing, with a screw-on bracket)', costUsd: 20 },
    joints: [{ type: 'screw', to: 'rear-light-mount', count: 2, size: 'M3 × 8 stainless' }],
    explode: unit(-1, 0, 0.5), notes: 'On the printed plate on the rear transom; mass includes the light (estimate).',
  }));

  // ── Side reflectors (DOT-C2 adhesive-backed), forward and aft on each side ──
  const cabinLen = L.xs - L.xRear;
  const rp = cabinSidePoint(L, L.deckTop + L.sideH / 2, L.side / 2 + REFLECTOR_SIZE[1] / 2, REFLECTOR_SIZE[2] / 2);
  for (const { s, tag } of SIDES) {
    REFLECTOR_FRACS.forEach((f, i) => {
      parts.push(box(ctx, {
        id: `reflector-${tag}${i + 1}`, partNo: 'reflector', name: `Side reflector ${tag}${i + 1}`, group: 'lighting', mat: 'fixed', massLb: REFLECTOR_MASS_LB,
        kind: 'purchased', material: 'reflector', fab: 'buy', step: STEP.finish, size: [...REFLECTOR_SIZE],
        center: [L.xRear + cabinLen * f, s * rp.y, rp.z], rot: { x: -s * rp.phi },
        sourcing: { vendor: 'Generic 2" × 1" adhesive-backed amber/white side reflector (DOT-C2 class)', costUsd: 2 },
        notes: 'Stick-on reflector; wipe the varnish clean and press for 60 s (D-41).',
      }));
    });
  }
  return parts;
}

export function buildHardware(ctx: Ctx): Part[] {
  const { L } = ctx;
  // Under the deck, centerd in the widest gap between cabin crossmembers (and clear of a tall rear axle beam).
  const zBot = L.deckBot - HARDWARE_SIZE[2];
  const blockers: Array<[number, number]> = L.cabinJoistX.map((x) => [x - L.joistT / 2, x + L.joistT / 2]);
  const p = ctx.p;
  if (L.r + p.brakeShaftDiameterIn / 2 > zBot && L.r - p.brakeShaftDiameterIn / 2 < L.deckBot) {
    const sx = -(L.r + p.brakeShaftBehindTireIn);
    blockers.push([sx - p.brakeShaftDiameterIn / 2, sx + p.brakeShaftDiameterIn / 2]);
  }
  if (L.beamR.top > zBot) blockers.push([L.beamR.x - L.beamR.thick / 2, L.beamR.x + L.beamR.thick / 2]);
  blockers.sort((a, b) => a[0] - b[0]);
  let lo = L.xRear + L.side, bestLo = lo, bestHi = lo;
  for (const [b0, b1] of [...blockers, [L.xs, L.xs] as [number, number]]) {
    if (b0 - lo > bestHi - bestLo) { bestLo = lo; bestHi = b0; }
    lo = Math.max(lo, b1);
  }
  const gap = Math.max(0.1, bestHi - bestLo);
  const sx = Math.min(HARDWARE_SIZE[0], gap);
  return [box(ctx, {
    id: 'hardware', name: 'Fasteners, inserts & misc', group: 'hardware', mat: 'fixed', massLb: HARDWARE_MASS_LB, kind: 'purchased', fab: 'buy',
    step: STEP.finish, size: [sx, HARDWARE_SIZE[1], HARDWARE_SIZE[2]], center: [(bestLo + bestHi) / 2, 0, L.deckBot - HARDWARE_SIZE[2] / 2],
    notes: 'Allowance (estimate): bolts, nuts, washers, threaded inserts, glue. Parked under the deck center.',
  })];
}
