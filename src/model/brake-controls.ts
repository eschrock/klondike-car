/**
 * Rider brake controls (Phase 3b WS-C, D-56): the left hip lever, its Bowden cable into the main brake lever through a lost-motion slot, and the lap belt.
 * Plain TS geometry (`hipControlGeometry`, `beltGeometry`) shared by the part builder and the analysis; parts are built only when `rideBrakeControls` is 1.
 *
 * Hip lever (left, inside the hull): a 1 in x 1/4 in aluminum bar pivoting on a bracket on the left chine inner face, grip `hipLeverArmIn` above the pivot,
 * cable lug `hipLeverCableArmIn` below it, so pulling the grip aft pulls the lug forward and the Bowden inner cable into its housing. The housing runs aft
 * in a printed channel on the chine inner face to the storage box, through one grommeted hole in the chine just ahead of it, then OUTSIDE the chine
 * (the storage box leaves only 1/8 in off the chine, so the spec's inside run does not fit) to a housing stop behind the main lever; the exposed inner cable
 * runs forward from the stop to a pin riding in a slot in a plate on the main lever (`hipLinkAboveLeverPivotIn` above its pivot). Pulling the inner cable
 * into the housing pulls the pin aft = applies the main lever. The main lever applies freely without moving the cable while the slot is longer than its
 * link-point stroke (lost motion), so either lever applies without back-driving the other.
 *
 * Parking: the existing quadrant and pawl act on the main lever, so both axles stay set. The pawl can be released only by the main lever's thumb tab;
 * the hip lever cannot release it (docs/phase3b-wsC-notes.md, open question on ride-mode modulation).
 */
import type { Params } from '../params';
import { STEP, box, cylinder, SIDES, type Ctx } from './build-utils';
import { brakeGeometry, f2, type BrakeGeom } from './brake';
import type { Layout } from './layout';
import type { Part, Vec3 } from './types';

const RAD = Math.PI / 180;
const ALUMINUM_LB_PER_IN3 = 0.098;
const CABLE_LB_PER_IN_PER_SQIN = 0.14;
const HOUSING_LB_PER_IN = 0.004;
const WEBBING_LB_PER_IN = 0.008;

export interface HipControlGeom {
  on: boolean;
  /** Hip lever pivot (x, |y|, z) and the grip at rest. */
  pivot: Vec3;
  grip: Vec3;
  armIn: number;
  cableArmIn: number;
  throwRad: number;
  /** Grip arc travel (in) and the cable travel at the lug through the full throw. */
  gripTravelIn: number;
  lugTravelIn: number;
  /** Main lever: pivot, the link point (above it), the main-lever rotation for a full stroke, and the arc travel of the link point. */
  mainPivot: [number, number];
  linkAbove: number;
  linkTravelIn: number;
  slotIn: number;
  /** Cable path (neutral), x/|y|/z: chine hole, aft housing stop, the pin at the slot's forward end (released), and the inside channel ends. */
  channelFront: Vec3;
  hole: Vec3;
  stop: Vec3;
  pinRel: Vec3;
  /** Outer face of the chine, the cable's y and z outside the chine, and the channel's z. */
  outerY: number;
  cableY: number;
  runZ: number;
  channelZ: number;
  /** Run lengths (in): inside channel, outside run, exposed inner cable. */
  insideIn: number;
  outsideIn: number;
  exposedIn: number;
  /** Geometric ratio F_hip / F_main_eq (hip grip force per equivalent main-grip force, cable friction not included); the spec's 0.93. */
  hipPerMain: number;
}

export function hipControlGeometry(p: Params, L: Layout, g: BrakeGeom = brakeGeometry(p, L)): HipControlGeom {
  const hl = L.front.hipLever;
  const on = p.rideBrakeControls === 1;
  const throwRad = p.hipLeverThrowDeg * RAD;
  const linkAbove = p.hipLinkAboveLeverPivotIn;
  const linkTravelIn = linkAbove * g.thetaL;
  const mainPivot: [number, number] = [g.Q[0], g.Q[1]];
  const eAbove = [g.e[0] * linkAbove, g.e[1] * linkAbove];
  const outer = L.hwC + L.side;
  const runZ = L.deckTop + 0.95;
  const cableY = outer + 0.3;
  // The slot plate is on the INBOARD face of the lever (between the lever and the hull), so the cable need not cross the lever.
  const pinRel: Vec3 = [g.Q[0] + eAbove[0], cableY, g.Q[1] + eAbove[1]];
  const stop: Vec3 = [pinRel[0] - p.hipLostMotionSlotIn - 1.2, cableY, runZ + 0.25];
  const chineIn = L.hwC;
  const channelZ = L.deckTop + 0.5;
  const channelFront: Vec3 = [hl.pivot[0] - 1.0, chineIn - 0.25, channelZ];
  // The storage box leaves 1/8 in off the chine, so the hole is just ahead of the box's fore end.
  const hole: Vec3 = [L.storage.x1 + 0.8, outer, runZ];
  const insideIn = Math.abs(channelFront[0] - hole[0]) + 1;
  const outsideIn = Math.abs(hole[0] - stop[0]) * 1.05 + 2;
  const exposedIn = Math.abs(pinRel[0] - stop[0]) + 0.5;
  const cableTravel = p.hipLeverCableArmIn * throwRad;
  const hipPerMain = (p.hipLeverCableArmIn / p.hipLeverArmIn) * (g.lGrip / Math.max(1e-6, linkAbove));
  return {
    on, pivot: hl.pivot, grip: hl.grip, armIn: p.hipLeverArmIn, cableArmIn: p.hipLeverCableArmIn, throwRad,
    gripTravelIn: p.hipLeverArmIn * throwRad, lugTravelIn: cableTravel, mainPivot, linkAbove, linkTravelIn, slotIn: p.hipLostMotionSlotIn,
    outerY: outer, cableY, runZ, channelZ, channelFront, hole, stop, pinRel, insideIn, outsideIn, exposedIn, hipPerMain,
  };
}

export interface BeltGeom {
  on: boolean;
  /** Anchor centers (x, |y|, z) on the deck at the chine, the doubler under the rail, two bolts each. */
  x: number;
  y: number;
  zDeck: number;
  plate: { lenIn: number; widIn: number; thickIn: number };
  doubler: { lenIn: number; widIn: number; thickIn: number };
  boltSpacingIn: number;
  webbingLenIn: number;
}

export function beltGeometry(p: Params, L: Layout): BeltGeom {
  return {
    on: p.rideBrakeControls === 1,
    x: p.seatXIn,
    y: L.hwC - 0.5,
    zDeck: L.deckTop,
    plate: { lenIn: 3, widIn: 0.9, thickIn: 0.1875 },
    doubler: { lenIn: 3, widIn: 0.9, thickIn: p.beltAnchorDoublerThickIn },
    boltSpacingIn: 2,
    webbingLenIn: 62,
  };
}

const cableMassLb = (dia: number, len: number) => CABLE_LB_PER_IN_PER_SQIN * dia * dia * len + HOUSING_LB_PER_IN * len;

/** Hip lever, cable, channel, lost-motion plate and the lap belt. */
export function buildBrakeControls(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  if (p.rideBrakeControls !== 1) return [];
  const g = brakeGeometry(p, L);
  const hg = hipControlGeometry(p, L, g);
  const bg = beltGeometry(p, L);
  const parts: Part[] = [];
  const chine = L.hwC;

  // ── Hip lever: arm (grip up) plus the cable lug below the pivot, one aluminum bar ──
  {
    const top: Vec3 = [hg.pivot[0], hg.pivot[1], hg.pivot[2] + hg.armIn];
    const bot: Vec3 = [hg.pivot[0], hg.pivot[1], hg.pivot[2] - hg.cableArmIn - 0.4];
    const len = top[2] - bot[2];
    const t = 0.25, w = 1.0;
    parts.push(box(ctx, {
      id: 'hip-lever', partNo: 'hip-lever', name: 'Hip brake lever (left)', group: 'brake', mat: 'fixed', kind: 'metal', material: '6061-T6 aluminum flat bar 1/4" x 1"',
      massLb: len * t * w * ALUMINUM_LB_PER_IN3 + 0.1, step: STEP.brake, size: [w, t, len], center: [hg.pivot[0], hg.pivot[1], (top[2] + bot[2]) / 2], fab: 'drill-tap',
      stock: { t, w, l: len }, explode: [0, 0.6, 0.8],
      sourcing: { vendor: `McMaster-Carr (6061-T6 aluminum flat bar 1/4" x 1", cut ${f2(len)}", pivot bore and cable-lug hole drilled, rubber grip sleeve on the top 4")` },
      notes: `Grip ${f2(hg.armIn)}" above the pivot at the left hip, ${f2(p.hipLeverThrowDeg)}° throw = ${f2(hg.gripTravelIn)}" at the grip. The cable lug is ${f2(hg.cableArmIn)}" below the pivot (cable travel ${f2(hg.lugTravelIn)}" over the throw). A return spring brings it back. Pull aft to brake; it never releases the pawl.`,
    }));
    // Bracket on the chine inner face and the pivot bolt.
    parts.push(box(ctx, {
      id: 'hip-lever-bracket', partNo: 'hip-lever-bracket', name: 'Hip lever bracket', group: 'brake', mat: 'steel', step: STEP.brake, fab: 'outsource',
      size: [2.0, 0.1875, 3.0], center: [hg.pivot[0], chine - 0.1875 / 2 - 0.03, hg.pivot[2] + 0.1], explode: [0, 0.4, 0.4],
      notes: '3/16" A36 plate flat on the chine inner face, 2 x 5/16" stainless bolts through the chine and the rail; carries the pivot bolt on a 3/8" standoff.',
      joints: [{ type: 'bolt', to: 'side-cabin-L-chine', count: 2, diaIn: 0.3125, note: 'through the chine into the rail' }],
    }));
    parts.push(cylinder(ctx, {
      id: 'hip-lever-pivot', partNo: 'hip-lever-pivot', name: 'Hip lever pivot bolt', group: 'brake', mat: 'steel', step: STEP.brake, fab: 'buy', kind: 'purchased', material: '3/8" 316 shoulder bolt, nylon-insert nut',
      center: [hg.pivot[0], (chine - 0.25 + hg.pivot[1] + 0.125) / 2, hg.pivot[2]], axis: 'y', radius: 0.1875, length: Math.max(0.5, chine - 0.25 - hg.pivot[1] - 0.125), explode: [0, 0.5, 0.2],
    }));
    parts.push(cylinder(ctx, {
      id: 'hip-lever-spring', partNo: 'hip-lever-spring', name: 'Hip lever return spring', group: 'brake', mat: 'fixed', kind: 'purchased', material: 'stainless extension spring', massLb: 0.05,
      center: [hg.pivot[0] + 1.1, hg.pivot[1], hg.pivot[2] - 0.2], axis: 'z', radius: 0.15, length: 1.2, fab: 'buy', step: STEP.brake, explode: [0, 0.5, 0],
    }));
  }

  // ── Channel (printed ASA) on the chine inner face from the hip lever aft to the hole, grommet, inner cable pieces ──
  {
    const x0 = hg.channelFront[0], x1 = hg.hole[0];
    const len = Math.abs(x0 - x1);
    parts.push(box(ctx, {
      id: 'hip-cable-channel', partNo: 'hip-cable-channel', name: 'Hip cable channel (printed ASA)', group: 'brake', mat: 'fixed', kind: 'printed', material: 'ASA (printed), snap-fit over the housing',
      massLb: len * 0.04, step: STEP.brake, size: [len, 0.4, 0.4], center: [(x0 + x1) / 2, chine - 0.45 / 2 - 0.25, hg.channelZ], fab: 'print', explode: [0, 0.4, 0.5],
      notes: `Open-face channel ${f2(len)}" long on the chine inner face just above the deck; holds the Bowden housing so a foot or a strap cannot catch it. Two #8 screws into the chine.`,
    }));
    parts.push(cylinder(ctx, {
      id: 'hip-cable-grommet', partNo: 'hip-cable-grommet', name: 'Hip cable chine grommet', group: 'brake', mat: 'fixed', kind: 'purchased', material: 'nylon grommet 1/4"', massLb: 0.01,
      center: [hg.hole[0], hg.outerY + 0.05, hg.hole[2]], axis: 'y', radius: 0.19, length: 0.1, fab: 'buy', step: STEP.brake, explode: [0, 1, 0],
      notes: 'One 1/4" hole through the left chine just ahead of the storage box fore end; the housing passes out through the grommet. The chine is solid oak there (no joint), check before drilling.',
    }));
    const dia = p.hipCableDiaIn;
    parts.push(cylinder(ctx, {
      id: 'hip-cable', partNo: 'hip-cable', name: 'Hip brake cable (Bowden, outside run)', group: 'brake', mat: 'fixed', kind: 'purchased',
      material: `7x19 stainless cable ${f2(dia)}" in a spiral-wound Bowden housing`, massLb: cableMassLb(dia, hg.insideIn + hg.outsideIn + hg.exposedIn), step: STEP.brake,
      center: [(hg.hole[0] + hg.stop[0]) / 2, hg.cableY, hg.runZ], axis: 'x', radius: 0.14, length: Math.abs(hg.hole[0] - hg.stop[0]), fab: 'buy', explode: [-0.3, 1, 0],
      sourcing: { vendor: `McMaster-Carr or a cycle shop (${f2(dia)}" 7x19 stainless cable, swaged ball end at the hip lug, spiral-wound housing with ferrules; about ${f2(hg.insideIn + hg.outsideIn + hg.exposedIn)}" in all)` },
      notes: `Drawn as the outside run along the left chine face (y ${f2(hg.cableY)}") from the grommet aft to the housing stop. The ${f2(hg.insideIn)}" inside run is in the channel; ${f2(hg.exposedIn)}" of bare inner cable runs forward from the stop to the lost-motion pin.`,
    }));
    parts.push(box(ctx, {
      id: 'brake-hip-cable-stop', partNo: 'brake-hip-cable-stop', name: 'Hip cable housing stop (aft of the main lever)', group: 'brake', mat: 'steel', step: STEP.brake, fab: 'drill-tap',
      size: [0.6, 0.6, 0.6], center: [hg.stop[0] - 0.3, hg.cableY, hg.stop[2]], explode: [-1, 0.5, 0],
      notes: 'A 3/8" steel block with a housing seat, on a stainless bracket to the rear transom end. A joinery item for the rear-end owner (not modeled as a joint).',
    }));
    // Lost-motion plate on the OUTBOARD face of the main lever, slotted for the cable pin.
    const slotLen = hg.slotIn + 0.6;
    parts.push(box(ctx, {
      id: 'brake-lost-motion-link', partNo: 'brake-lost-motion-link', name: 'Lost-motion slot plate (on the main lever)', group: 'brake', mat: 'steel', step: STEP.brake, fab: 'outsource',
      size: [slotLen + 0.8, 0.125, 0.9], center: [hg.pinRel[0] - slotLen / 2 + 0.3, g.y.lever[0] - 0.0625 - 0.02, hg.pinRel[2]], explode: [-1, 0.6, 0],
      notes: `1/8" A36 plate bolted to the INBOARD face of the main lever (between the lever and the hull) ${f2(hg.linkAbove)}" above its pivot with a ${f2(hg.slotIn)}" slot along the pull. The main lever moves ${f2(hg.linkTravelIn)}" at the link point over a full stroke, so the handler's lever moves free of the cable (lost motion ${f2(hg.slotIn - hg.linkTravelIn)}" spare) and the rider's pull drags the lever aft through the pin at the slot's forward end.`,
      joints: [{ type: 'bolt', to: 'brake-lever', count: 2, diaIn: 0.25, note: 'to the main lever, inboard face' }],
    }));
    parts.push(cylinder(ctx, {
      id: 'brake-hip-cable-pin', partNo: 'brake-hip-cable-pin', name: 'Hip cable slot pin', group: 'brake', mat: 'fixed', kind: 'purchased', material: '3/16" 316 stainless pin with the swaged cable end', massLb: 0.03,
      center: [hg.pinRel[0], hg.pinRel[1] + 0.08, hg.pinRel[2]], axis: 'y', radius: 0.0938, length: 0.4, fab: 'buy', step: STEP.brake, explode: [0, 1, 0],
      notes: `Rides in the slot; the bare inner cable (${f2(hg.exposedIn)}") runs aft to the housing stop.`,
    }));
  }

  // ── Lap belt ──
  {
    const names = SIDES;
    for (const { s: sgn, tag } of names) {
      parts.push(box(ctx, {
        id: `belt-anchor-${tag}`, partNo: 'belt-anchor', name: `Lap belt anchor plate ${tag}`, group: 'brake', mat: 'steel', step: STEP.brake, fab: 'outsource',
        size: [bg.plate.lenIn, bg.plate.widIn, bg.plate.thickIn], center: [bg.x, sgn * bg.y, bg.zDeck + bg.plate.thickIn / 2], explode: [0, sgn * 0.3, 0.8],
        notes: `${f2(bg.plate.thickIn)}" A36 plate on the deck at the chine, two ${f2(p.beltAnchorBoltDiaIn)}" 316 bolts ${f2(bg.boltSpacingIn)}" apart through the deck, the rail and a ${f2(bg.doubler.thickIn)}" steel doubler strap under the rail (nylock nuts), with a slot for the 2" webbing.`,
        joints: [{ type: 'bolt', to: `rail-cabin-${tag}`, count: 2, diaIn: p.beltAnchorBoltDiaIn, note: 'vertical through the deck, rail and doubler' }],
      }));
      parts.push(box(ctx, {
        id: `belt-doubler-${tag}`, partNo: 'belt-doubler', name: `Lap belt anchor doubler ${tag}`, group: 'brake', mat: 'steel', step: STEP.brake, fab: 'outsource',
        size: [bg.doubler.lenIn, bg.doubler.widIn, bg.doubler.thickIn], center: [bg.x, sgn * bg.y, 5.53 - bg.doubler.thickIn / 2 - 0.02], explode: [0, sgn * 0.3, -0.8],
        notes: 'Steel strap on the rail underside spreading the bolt tension over the oak (compression across the grain).',
      }));
    }
    for (const { s: sgn, tag } of names) {
      parts.push(box(ctx, {
        id: `lap-belt-${tag}`, partNo: 'lap-belt-half', name: `Lap belt half ${tag} (2" webbing${tag === 'L' ? ', quick-release buckle' : ''})`, group: 'brake', mat: 'fixed', kind: 'purchased',
        material: '2" nylon / polyester webbing' + (tag === 'L' ? ' with a quick-release buckle' : ''), massLb: bg.webbingLenIn * WEBBING_LB_PER_IN + (tag === 'L' ? 0.35 : 0.05),
        step: STEP.brake, size: [2.0, 2.7, 0.2], center: [bg.x, sgn * 10.65, bg.zDeck + 0.1], fab: 'buy', explode: [0, 0, 1], removable: true,
        sourcing: { vendor: `Webbing and quick-release buckle (any 2" belt rated ${p.beltWebbingBreakLbf} lbf or more; about ${bg.webbingLenIn}" of webbing in all)` },
        notes: 'Drawn only as the stub lying on the deck beside the cushion from the anchor; the strap itself lies across the rider\'s lap. Ride mode only (removable).',
      }));
    }
  }
  return parts;
}
