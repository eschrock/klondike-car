/**
 * Derived geometry of the Ackermann front end (Phase 3b, spec sections 1 and 9): kingpin points, neutral wheel centers and arm tips, tie rod,
 * bellcrank, tongue, beam, kingpin brackets, knuckle shoe inputs, the ride stick, the hip lever and the mode plate. Plain numbers; every design
 * number comes from Params (src/params.ts). Neutral (steer = 0) model frame. ADDITIVE in Stage 0: `Layout.front` carries it while the old front end stays.
 *
 * Provisional placements (stick, hip lever, mode plate sockets, shoe pivot, z levels of the links) are first estimates for Stage 1 to refine; the
 * kinematic quantities (kp, stub, armTip, tieRod, bellcrank pins, tongue hinge/ear) are final.
 */
import { ackSpec, type Params } from '../params';
import { centerLinkage, type AckSpec } from './ackermann';
import type { Beam, Layout } from './layout';
import type { Vec2, Vec3 } from './types';

export interface Box3 { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

export interface FrontBracket {
  /** Web plate on the beam end face (outboard of it), spanning the lower leaf bottom to the upper leaf top. */
  web: Box3;
  /** Plan bounding box of the web and both leaves (leaves reach `kingpinBracketLeafRadiusIn` around the pivot). */
  footprint: { x0: number; x1: number; y0: number; y1: number };
  /** Plan point of the kingpin pivot. */
  pivot: Vec2;
  /** z ranges of the lower and upper leaves (the spindle boss sits between them). */
  lowerLeaf: { z0: number; z1: number };
  upperLeaf: { z0: number; z1: number };
  /** The four web-to-beam bolts: a point on the beam end face and the axis (along y, pointing outboard). */
  bolts: { pos: Vec3; axis: Vec3 }[];
}

export interface FrontKnuckle {
  /** Kingpin boss center (on the tilted kingpin axis, `spindleBossAboveStubIn` above the stub axis) and the unit axis (up, tilted by caster and KPI). */
  bossPos: Vec3;
  bossAxis: Vec3;
  /** Front-brake swing-arm pivot on the knuckle (neutral frame; provisional) and the shoe contact angle below the axle line on the FRONT of the tread. */
  shoePivot: Vec3;
  shoeAngleDeg: number;
}

export interface FrontLayout {
  ack: AckSpec;
  /** Kingpin points at hub height (z = wheel-center height). */
  kp: { L: Vec3; R: Vec3 };
  /** Neutral wheel centers (stub axis points). */
  stub: { L: Vec3; R: Vec3 };
  /** Neutral steering-arm tip pins (tie rod ends). */
  armTip: { L: Vec3; R: Vec3 };
  /** Neutral tie rod: center x, height, length (derived). */
  tieRod: { x: number; z: number; len: number };
  /** Bellcrank: pivot, arm length, plate plane z (drag link), input plane z (tongue link, over the beam), neutral pins and derived link lengths. */
  bellcrank: { pivot: Vec2; arm: number; z: number; inZ: number; outPin: Vec2; inPin: Vec2; dragLinkLen: number; tongueLinkLen: number };
  tongue: { hinge: Vec2; linkPin: Vec2; z: number };
  /** Steel tube front beam: centered on the stub axis in z, `thick` = fore-aft width, `len` = tube length. */
  beam: Beam;
  bracket: { L: FrontBracket; R: FrontBracket };
  knuckle: { L: FrontKnuckle; R: FrontKnuckle };
  /** Right-hand ride stick (neutral, upright) and cable arm. */
  stick: { pivot: Vec3; grip: Vec3; cableArm: number };
  /** Left hip brake lever. */
  hipLever: { pivot: Vec3; grip: Vec3 };
  /** Mode plate center and the two mutually exclusive pin sockets. */
  mode: { plate: Vec3; pinTow: Vec3; pinRide: Vec3 };
  /** Ground trail = lead + r tan(caster). */
  trailIn: number;
}

const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};

/** Needs the already-computed parts of the layout (wheel radius, seat, hull curve). */
export function computeFrontLayout(p: Params, L: Pick<Layout, 'r' | 'WB' | 'kx' | 'seat' | 'hull' | 'side' | 'ply'>, innerHalfWidthAt: (x: number) => number): FrontLayout {
  const ack = ackSpec(p);
  const r = L.r;
  const RAD = Math.PI / 180;
  const g = ack.armAngleDeg * RAD;
  const kp = { L: [ack.kx, ack.kpHalf, r] as Vec3, R: [ack.kx, -ack.kpHalf, r] as Vec3 };
  const stub = { L: [L.WB, ack.kpHalf + ack.scrub, r] as Vec3, R: [L.WB, -(ack.kpHalf + ack.scrub), r] as Vec3 };
  const armTip = {
    L: [ack.kx - ack.armLen * Math.cos(g), ack.kpHalf - ack.armLen * Math.sin(g), r] as Vec3,
    R: [ack.kx - ack.armLen * Math.cos(g), -(ack.kpHalf - ack.armLen * Math.sin(g)), r] as Vec3,
  };
  const cl = centerLinkage(ack);

  // Beam: underslung like the rear, centered on the stub axis in z.
  const beamX = ack.kx - p.frontBeamBehindKingpinIn;
  const beamLen = 2 * (ack.kpHalf - p.kingpinBracketLeafRadiusIn) + 0.2;
  const beam: Beam = { x: beamX, len: beamLen, thick: p.frontBeamWidthIn, depth: p.frontBeamDepthIn, top: r + p.frontBeamDepthIn / 2, bot: r - p.frontBeamDepthIn / 2 };
  const beamMidZ = r;

  // Brackets: C-channel; leaves at the boss height ± gap/2.
  const bossZ = r + p.spindleBossAboveStubIn;
  const t = p.kingpinBracketThickIn;
  const gap = p.kingpinBracketGapIn;
  const lowerLeaf = { z0: bossZ - gap / 2 - t, z1: bossZ - gap / 2 };
  const upperLeaf = { z0: bossZ + gap / 2, z1: bossZ + gap / 2 + t };
  const leafR = p.kingpinBracketLeafRadiusIn;
  const mkBracket = (sy: 1 | -1): FrontBracket => {
    const endY = sy * (beamLen / 2);
    const yA = Math.min(endY, endY + sy * t), yB = Math.max(endY, endY + sy * t);
    const web: Box3 = { x0: beamX - beam.thick / 2, x1: beamX + beam.thick / 2, y0: yA, y1: yB, z0: lowerLeaf.z0, z1: upperLeaf.z1 };
    const pyY = sy * ack.kpHalf;
    const fy0 = Math.min(endY, pyY + sy * leafR), fy1 = Math.max(endY, pyY + sy * leafR);
    return {
      web,
      footprint: { x0: Math.min(web.x0, ack.kx - leafR), x1: Math.max(web.x1, ack.kx + leafR), y0: fy0, y1: fy1 },
      pivot: [ack.kx, pyY],
      lowerLeaf,
      upperLeaf,
      bolts: [-1, 1].flatMap((ix) => [-1, 1].map((iz) => ({ pos: [beamX + (ix * beam.thick) / 4, endY, beamMidZ + (iz * beam.depth) / 4] as Vec3, axis: [0, sy, 0] as Vec3 }))),
    };
  };

  // Knuckles: kingpin axis tilted back by caster and in by KPI (top inboard).
  const tc = Math.tan(p.casterDeg * RAD), tk = Math.tan(p.kingpinInclinationDeg * RAD);
  const mkKnuckle = (sy: 1 | -1): FrontKnuckle => {
    const axis = unit([-tc, -sy * tk, 1]);
    const k = sy > 0 ? kp.L : kp.R;
    const s = p.spindleBossAboveStubIn / axis[2];
    const bossPos: Vec3 = [k[0] + axis[0] * s, k[1] + axis[1] * s, k[2] + axis[2] * s];
    // Tread shoe on the FRONT of the tire, `brakeShoeAngleDeg` below the axle line (mirror of the rear placement); the swing arm pivots on the knuckle
    // brake boss a shoe length up the tread tangent and a shoe thickness off the tread (provisional).
    const b = p.brakeShoeAngleDeg * RAD;
    const c = sy > 0 ? stub.L : stub.R;
    const contact: Vec3 = [c[0] + r * Math.cos(b), c[1], c[2] - r * Math.sin(b)];
    const nrm: Vec3 = [Math.cos(b), 0, -Math.sin(b)];
    const tan: Vec3 = [Math.sin(b), 0, Math.cos(b)];
    const shoePivot: Vec3 = [contact[0] + nrm[0] * p.brakeShoeThickIn + tan[0] * p.brakeShoeLengthIn, c[1], contact[2] + nrm[2] * p.brakeShoeThickIn + tan[2] * p.brakeShoeLengthIn];
    return { bossPos, bossAxis: axis, shoePivot, shoeAngleDeg: p.brakeShoeAngleDeg };
  };

  // Rider controls.
  const sx = p.seatXIn + p.rideStickAheadOfHpointIn;
  const stickPivot: Vec3 = [sx, -(innerHalfWidthAt(sx) - p.rideStickInsetIn), L.seat.surface + p.rideStickPivotAboveSeatIn];
  const hx = p.seatXIn + p.hipLeverAheadOfHpointIn;
  const hipPivot: Vec3 = [hx, innerHalfWidthAt(hx) - p.hipLeverInsetIn, L.seat.surface];
  const bellZ = r;
  const inZ = beam.top + p.tieRodEndDiaIn;
  const plateZ = bellZ + p.modePinDiaIn;
  const pv = ack.bellPivot;

  return {
    ack,
    kp,
    stub,
    armTip,
    tieRod: { x: cl.mid0[0], z: r, len: ack.tieLen },
    bellcrank: { pivot: pv, arm: ack.bellArm, z: bellZ, inZ, outPin: cl.out0, inPin: cl.in0, dragLinkLen: cl.dragLen, tongueLinkLen: cl.tongueLinkLen },
    tongue: { hinge: ack.tongueHinge, linkPin: cl.ear0, z: beamMidZ },
    beam,
    bracket: { L: mkBracket(1), R: mkBracket(-1) },
    knuckle: { L: mkKnuckle(1), R: mkKnuckle(-1) },
    stick: { pivot: stickPivot, grip: [stickPivot[0], stickPivot[1], stickPivot[2] + p.rideStickLengthIn], cableArm: p.rideStickCableArmIn },
    hipLever: { pivot: hipPivot, grip: [hipPivot[0], hipPivot[1], hipPivot[2] + p.hipLeverArmIn] },
    mode: { plate: [pv[0], 0, plateZ], pinTow: [pv[0] + ack.bellArm, 0, plateZ], pinRide: [pv[0], -ack.bellArm, plateZ] },
    trailIn: ack.lead + r * tc,
  };
}
