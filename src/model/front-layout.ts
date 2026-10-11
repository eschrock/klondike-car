/**
 * Derived geometry of the Ackermann front end (Phase 3b, spec sections 1 and 9): kingpin points, neutral wheel centers and arm tips, tie rod,
 * bellcrank and its stack, tongue, beam, kingpin brackets and the tow stops (Phase 3c-1: the stick, cables, hip lever, mode plate, front-brake inputs are gone, D-53).
 * Plain numbers; every design number comes from Params (src/params.ts). Neutral (steer = 0) model frame.
 *
 * Stage 1 (WS-A) refined the Stage 0 placements and re-laid the center linkage (docs/phase3b-wsA-notes.md): the z levels are a stack, low to high,
 *   tie rod and steering arms (below the beam)  <  drag link  <  bellcrank plate  <  bell bracket plate
 *   ... beam top ... tongue top  <  tongue hinge top plate  <  tongue ear plate  <  tongue link  <  deck underside.
 */
import { ackSpec, type Params } from '../params';
import { centerLinkage, type AckSpec } from './ackermann';
import { TONGUE_UNDER_TRANSOM_MARGIN_IN } from './front-stack';
import type { Beam, Layout } from './layout';
import type { Vec2, Vec3 } from './types';

export interface Box3 { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

export interface FrontBracket {
  /** Web plate on the beam end face (outboard of it), spanning the beam bottom to the upper leaf top. */
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
  /** Plan point of the foot post (under the carrier, inside the tire's inner face) that carries the bolt-on steering arm, and the arm plate's plan outline (neutral, CCW). */
  foot: Vec2;
  armHull: Vec2[];
}

/** A tow-lock stop block (steel on a urethane face) on the beam underside, at the steering arm's leading edge at the tow lock. */
export interface TowStop {
  center: Vec3;
  /** Yaw of the block (it is parallel to the arm at the lock), rad. */
  rotRad: number;
  /** Block size along the arm, across it, and height. */
  size: Vec3;
}

export interface FrontLayout {
  ack: AckSpec;
  /** Kingpin points at hub height (z = wheel-center height). */
  kp: { L: Vec3; R: Vec3 };
  /** Neutral wheel centers (stub axis points). */
  stub: { L: Vec3; R: Vec3 };
  /** Neutral steering-arm tip pins (tie rod ends), at the tie rod height (below the beam). */
  armTip: { L: Vec3; R: Vec3 };
  /** Neutral tie rod: center x, height, length (derived). */
  tieRod: { x: number; z: number; len: number };
  /**
   * Bellcrank: pivot, output arm length, the bellcrank plate center z, the tongue-link plane center z (over the beam), neutral pins and derived link lengths.
   * `outPin` (drag link), `inPin` (tongue link, on a standoff up to `inZ`), `linkPinAt` (the tongue-link clevis pin axis, top of the standoff), `dragZ` (drag link plane),
   * `bracketZ` (bell bracket plate), `plate` (convex plan outline of the plate, absolute neutral frame), `bracket` (plan outline of the bracket plate bolted to the beam rear face).
   */
  bellcrank: {
    pivot: Vec2; arm: number; z: number; inZ: number; outPin: Vec2; inPin: Vec2; linkPinAt: Vec3;
    dragZ: number; bracketZ: number; plate: Vec2[]; bracket: Vec2[];
    dragLinkLen: number; tongueLinkLen: number;
  };
  /**
   * Tongue: hinge pin, link pin (the ear), `z` = center height of the oak tongue (so the tongue-tip eye bolt is at its height), `top`/`bot` of the tongue, the
   * hinge plates (`hingeTop`, `hingeBot` z ranges), the ear plate and tongue link z ranges, and the tongue rear/tip x.
   */
  tongue: {
    hinge: Vec2; linkPin: Vec2; z: number; top: number; bot: number; hingeTop: { z0: number; z1: number }; hingeBot: { z0: number; z1: number };
    plate: { z0: number; z1: number }; link: { z0: number; z1: number }; rearX: number; tipX: number;
  };
  /** Steel tube front beam: centered on the stub axis in z, `thick` = fore-aft width, `len` = tube length. */
  beam: Beam;
  bracket: { L: FrontBracket; R: FrontBracket };
  knuckle: { L: FrontKnuckle; R: FrontKnuckle };
  /** Tow-lock stop blocks (one per side: the inner wheel's lock, 35.5 deg by default). */
  towStop: { L: TowStop; R: TowStop };
  /** Ground trail = lead + r tan(caster). */
  trailIn: number;
  /**
   * Chassis keep-out volume for WS-B (frame, deck): the center linkage corridor under the nose deck (no joist, rail or deck cut-out may sit in it; the deck
   * underside stays above `top`). Neutral frame, with the full steering sweep of the tongue and links included.
   */
  keepOut: { center: Box3 };
}

const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};

/** Assembly clearance left between stacked plates (in): a tolerance, not a design number. */
export const ASSY_GAP_IN = 0.03;
/** Tow-stop block plan size (along the arm, across it) and clearance to the arm at the lock: a catalog-style stand-in block. */
export const TOW_STOP_BLOCK_IN = 0.75;
export const TOW_STOP_GAP_IN = 0.0625;
export { TONGUE_UNDER_TRANSOM_MARGIN_IN };
/** Radius of the rounded pin ends of the bellcrank plate, capped so the swung output arm clears the beam rear face. */
export const BELL_PIN_R_IN = 0.45;
/** The bell bracket strip reaches this far behind the bellcrank pivot (it carries the pivot bolt). */
export const BELL_BRACKET_PAST_PIVOT_IN = 1;
/** Convex hull of points (Andrew's monotone chain), counter-clockwise. */
export function convexHull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: Vec2[] = [];
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Points on a circle of radius r around c (the hull of several of these is a rounded plate outline). */
export const discPts = (c: Vec2, r: number, n = 12): Vec2[] => Array.from({ length: n }, (_, i): Vec2 => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);

/** Needs the already-computed parts of the layout (wheel radius, seat, hull curve). */
export function computeFrontLayout(p: Params, L: Pick<Layout, 'r' | 'WB' | 'kx' | 'hull' | 'side' | 'ply' | 'deckTop'>): FrontLayout {
  const ack = ackSpec(p);
  const r = L.r;
  const RAD = Math.PI / 180;
  const g = ack.armAngleDeg * RAD;
  const cl = centerLinkage(ack);

  // Beam: underslung like the rear, centered on the stub axis in z.
  const beamX = ack.kx - p.frontBeamBehindKingpinIn;
  // The beam ends far enough from the kingpin axis that the bracket web clears the spindle boss: boss radius + the KPI lean of the axis at the boss top + the web
  // + a little air. (Stage 0 used leaf radius + 0.1 = 0.9", which a 0.75" boss radius cannot fit; the beam is about 0.8" shorter.)
  const bossTopRise = p.spindleBossAboveStubIn + p.spindleBossLengthIn / 2;
  const endGap = p.spindleBossRadiusIn + bossTopRise * Math.tan((p.kingpinInclinationDeg * Math.PI) / 180) + p.kingpinBracketThickIn + 0.05;
  const beamLen = 2 * (ack.kpHalf - Math.max(p.kingpinBracketLeafRadiusIn - 0.1, endGap));
  const beam: Beam = { x: beamX, len: beamLen, thick: p.frontBeamWidthIn, depth: p.frontBeamDepthIn, top: r + p.frontBeamDepthIn / 2, bot: r - p.frontBeamDepthIn / 2 };
  const beamMidZ = r;

  // ── z stack of the linkage ──
  const tieZ = beam.bot - p.tieRodDiaIn; // the rod's top is a rod radius under the beam bottom
  const linkT = p.kingpinBracketThickIn; // drag link, tongue link, ear plate and bell bracket plate: the same 3/16" plate
  const bellT = p.bellcrankPlateThickIn;
  const dragZ = tieZ + p.tieRodDiaIn / 2 + ASSY_GAP_IN + linkT / 2;
  const bellZ = dragZ + linkT / 2 + ASSY_GAP_IN + bellT / 2;
  const bracketZ = bellZ + bellT / 2 + ASSY_GAP_IN + linkT / 2;
  // The tongue passes under the front transom (bottom = noseTop - crossmemberDepth) with the linkage running clearance (`steeringLinkClearIn`) plus TONGUE_UNDER_TRANSOM_MARGIN_IN to spare (spec 3.6); the ear plate and the
  // tongue link stand higher (spacer sleeves on the ear-plate bolts) so they pass over the beam top.
  const tongueTop = L.deckTop - p.crossmemberDepthIn - p.steeringLinkClearIn - TONGUE_UNDER_TRANSOM_MARGIN_IN;
  const tongueDepth = p.tongueDepthIn;
  const tongueBot = tongueTop - tongueDepth;
  const tc = p.tongueClevisThickIn;
  const hingeTop = { z0: tongueTop, z1: tongueTop + tc };
  const hingeBot = { z0: tongueBot - tc, z1: tongueBot };
  const plateZ0 = Math.max(hingeTop.z1, beam.top + 2 * p.beamNotchClearIn);
  const plate = { z0: plateZ0, z1: plateZ0 + linkT };
  const link = { z0: plate.z1, z1: plate.z1 + linkT };

  const kp = { L: [ack.kx, ack.kpHalf, r] as Vec3, R: [ack.kx, -ack.kpHalf, r] as Vec3 };
  const stub = { L: [L.WB, ack.kpHalf + ack.scrub, r] as Vec3, R: [L.WB, -(ack.kpHalf + ack.scrub), r] as Vec3 };
  const armTip = {
    L: [ack.kx - ack.armLen * Math.cos(g), ack.kpHalf - ack.armLen * Math.sin(g), tieZ] as Vec3,
    R: [ack.kx - ack.armLen * Math.cos(g), -(ack.kpHalf - ack.armLen * Math.sin(g)), tieZ] as Vec3,
  };

  // Brackets: C-channel; leaves at the boss height +/- gap/2. The web runs from the beam bottom to the upper leaf top (it also carries the beam end face bolts).
  const bossZ = r + p.spindleBossAboveStubIn;
  const t = p.kingpinBracketThickIn;
  const gap = p.kingpinBracketGapIn;
  const lowerLeaf = { z0: bossZ - gap / 2 - t, z1: bossZ - gap / 2 };
  const upperLeaf = { z0: bossZ + gap / 2, z1: bossZ + gap / 2 + t };
  const leafR = p.kingpinBracketLeafRadiusIn;
  const mkBracket = (sy: 1 | -1): FrontBracket => {
    const endY = sy * (beamLen / 2);
    const yA = Math.min(endY, endY + sy * t), yB = Math.max(endY, endY + sy * t);
    const web: Box3 = { x0: beamX - beam.thick / 2, x1: beamX + beam.thick / 2, y0: yA, y1: yB, z0: Math.min(beam.bot, lowerLeaf.z0), z1: upperLeaf.z1 };
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
  const hubHalf = p.hubLengthIn / 2;
  const tanC = Math.tan(p.casterDeg * RAD), tanK = Math.tan(p.kingpinInclinationDeg * RAD);
  const mkKnuckle = (sy: 1 | -1): FrontKnuckle => {
    const axis = unit([-tanC, -sy * tanK, 1]);
    const k = sy > 0 ? kp.L : kp.R;
    const s = p.spindleBossAboveStubIn / axis[2];
    const bossPos: Vec3 = [k[0] + axis[0] * s, k[1] + axis[1] * s, k[2] + axis[2] * s];
    const c = sy > 0 ? stub.L : stub.R;
    const root: Vec2 = [c[0], c[1] - sy * hubHalf];
    // The modeled boss is vertical through the kingpin point (the plan rotation neglects the tilt, spec 1.2); the foot is 40% of the way from it to the stub root.
    const foot: Vec2 = [k[0] + 0.4 * (root[0] - k[0]), k[1] + 0.4 * (root[1] - k[1])];
    const tipP = sy > 0 ? armTip.L : armTip.R;
    const armHull = convexHull([...discPts(foot, p.steerArmWidthIn / 2, 14), ...discPts([k[0], k[1]], p.steerArmWidthIn / 2, 14), ...discPts([tipP[0], tipP[1]], p.steerArmWidthIn / 2, 14)]);
    return { bossPos, bossAxis: axis, foot, armHull };
  };

  const knuckleL = mkKnuckle(1), knuckleR = mkKnuckle(-1);

  // Tow-lock stops: a block on the beam underside at the arm's leading edge when the inner wheel is at its lock. The left knuckle turns CCW (+) for its
  // inner lock, the right one CW (-); the arm is a strip `steerArmWidthIn` wide from the kingpin to the tip pin.
  const lockRad = ack.towLockInnerDeg * RAD;
  const mkStop = (sy: 1 | -1): TowStop => {
    const th = sy * lockRad;
    const kn = sy > 0 ? knuckleL : knuckleR;
    const k = sy > 0 ? kp.L : kp.R;
    const tipP = sy > 0 ? armTip.L : armTip.R;
    const rot = (q: [number, number]): [number, number] => { const d: [number, number] = [q[0] - k[0], q[1] - k[1]]; return [Math.cos(th) * d[0] - Math.sin(th) * d[1], Math.sin(th) * d[0] + Math.cos(th) * d[1]]; };
    const ud = rot([tipP[0], tipP[1]]);
    const u: [number, number] = [ud[0] / Math.hypot(ud[0], ud[1]), ud[1] / Math.hypot(ud[0], ud[1])];
    const n: [number, number] = [-sy * u[1], sy * u[0]]; // the side the arm swings toward
    const along = 0.65 * ack.armLen;
    const b = TOW_STOP_BLOCK_IN;
    // The arm plate's leading extent (along n) within the block's span along the arm, from the hull edges sampled finely.
    let lead = -Infinity;
    const hv = kn.armHull.map((q) => rot([q[0], q[1]]));
    for (let i = 0; i < hv.length; i++) {
      const a = hv[i], c = hv[(i + 1) % hv.length];
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const q: [number, number] = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
        const pu = q[0] * u[0] + q[1] * u[1];
        if (Math.abs(pu - along) <= b / 2) lead = Math.max(lead, q[0] * n[0] + q[1] * n[1]);
      }
    }
    const off = lead + TOW_STOP_GAP_IN + b / 2;
    const h = beam.bot - (tieZ - p.steerArmThickIn / 2 - ASSY_GAP_IN);
    return {
      center: [k[0] + u[0] * along + n[0] * off, k[1] + u[1] * along + n[1] * off, beam.bot - h / 2],
      rotRad: Math.atan2(u[1], u[0]),
      size: [b, b, h],
    };
  };

  const pv = ack.bellPivot;

  // Bellcrank plate: the hull of the pivot boss and the two arm pins.
  const w = p.bellcrankArmWidthIn;
  const bellHull = convexHull([...discPts(pv, w * 0.8), ...discPts(cl.out0, BELL_PIN_R_IN), ...discPts(cl.in0, BELL_PIN_R_IN)]);
  // Bracket plate on the beam rear face: a strip along the centerline back past the pivot.
  const bx1 = beamX - beam.thick / 2; // beam rear face
  const stripHalf = w / 2;
  const headX0 = pv[0] - BELL_BRACKET_PAST_PIVOT_IN;
  const bracketOutline: Vec2[] = [[headX0, -stripHalf], [bx1, -stripHalf], [bx1, stripHalf], [headX0, stripHalf]];

  return {
    ack,
    kp,
    stub,
    armTip,
    tieRod: { x: cl.mid0[0], z: tieZ, len: ack.tieLen },
    bellcrank: {
      pivot: pv, arm: ack.bellArm, z: bellZ, inZ: (link.z0 + link.z1) / 2, outPin: cl.out0, inPin: cl.in0, linkPinAt: [cl.in0[0], cl.in0[1], link.z0],
      dragZ, bracketZ, plate: bellHull, bracket: bracketOutline,
      dragLinkLen: cl.dragLen, tongueLinkLen: cl.tongueLinkLen,
    },
    tongue: {
      hinge: ack.tongueHinge, linkPin: cl.ear0, z: tongueTop - tongueDepth / 2, top: tongueTop, bot: tongueBot, hingeTop, hingeBot, plate, link,
      rearX: ack.tongueHinge[0] - p.tongueHingePinDiaIn - 0.25, tipX: L.WB + p.tongueLengthIn,
    },
    beam,
    bracket: { L: mkBracket(1), R: mkBracket(-1) },
    knuckle: { L: knuckleL, R: knuckleR },
    towStop: { L: mkStop(1), R: mkStop(-1) },
    trailIn: ack.lead + r * tanC,
    keepOut: {
      center: { x0: headX0 - 0.5, x1: ack.tongueHinge[0] + 1.2, y0: -(w / 2 + 3), y1: w / 2 + 3, z0: tieZ - p.steerArmThickIn, z1: link.z1 + 0.15 },
    },
  };
}
