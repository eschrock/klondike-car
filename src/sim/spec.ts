/**
 * Turns the parts list into a physics spec (SI units, model frame): rigid-body mass properties, wheel and kingpin
 * geometry, the tongue-tip pull point and hull collider boxes. Pure data; no physics engine and no DOM (phase-2 spec
 * "Simulation"; D-12, D-25, D-26).
 *
 * Bodies (spec 8.2): chassis (all chassis parts + rider + cargo as fixed mass, plus the visual-only tie rod, bellcrank, links and tongue), two knuckle
 * bodies 'steer-L' / 'steer-R' on their own vertical kingpins, and four wheels. The tie rod is replaced by position motors that command each knuckle to its
 * solved angle (`solveSteer`). Parts tagged 'truck' are ignored.
 */
import { ackSpec, type Params } from '../params';
import { lockLimits, type AckSpec } from '../model/ackermann';
import { partOBB, worldAABB } from '../model/bounds';
import { frontBrakeShare } from '../model/brake-front';
import { computeLayout } from '../model/layout';
import type { Part, Vec3 } from '../model/types';
import { translationOf } from '../model/mat4';
import { bodyMass, KG_PER_LB, M_PER_IN, principalSI, G, type BodyMass } from './massprops';
import { qFromColumns, scale, sub, type Quat } from './math';

export const WHEEL_IDS = ['wheel-FL', 'wheel-FR', 'wheel-RL', 'wheel-RR'] as const;
export type WheelId = (typeof WHEEL_IDS)[number];
export type SimBodyId = 'chassis' | 'steer-L' | 'steer-R' | WheelId;

export interface SimBody {
  id: SimBodyId;
  massKg: number;
  /** CG in the model frame, meters (the body origin in the sim). */
  cgM: Vec3;
  inertiaPrincipal: Vec3;
  inertiaFrame: Quat;
}

export interface HullBox {
  /** Center relative to the body CG, meters, body axes. */
  center: Vec3;
  half: Vec3;
  rot: Quat;
  partId: string;
}

/** Rigid bodies the sim does not integrate: their mass rides on the chassis and the viewer poses them analytically (`poseMatrices`). */
export const VISUAL_BODIES = ['tie-rod', 'bellcrank', 'tongue', 'drag-link', 'tongue-link'] as const;
const isVisualBody = (b: string) => (VISUAL_BODIES as readonly string[]).includes(b);

/** Default share of the braking force taken by the front axle (spec 4: front 0.4-0.6, bias set by the takeoff arm). */
export const DEFAULT_FRONT_BRAKE_SHARE = 0.5;

export interface SimSpec {
  /** Bodies present in this spec (chassis, the two knuckles, four wheels). */
  bodyIds: SimBodyId[];
  bodies: Partial<Record<SimBodyId, SimBody>>;
  hull: { chassis: HullBox[]; 'steer-L': HullBox[]; 'steer-R': HullBox[] };
  wheelRadiusM: number;
  wheelWidthM: number;
  /** Wheel centers at zero steer, model frame, meters. */
  wheelCentersM: Record<WheelId, Vec3>;
  /** The midpoint of the two kingpins. */
  kingpinM: Vec3;
  /** The two kingpins, meters. */
  kingpinsM: { L: Vec3; R: Vec3 };
  /** Ackermann kinematics (inches/degrees, the model's own source of truth). */
  ack: AckSpec;
  /** Tow lock, rad: the inner wheel angle. */
  lockRad: number;
  /** Ride lock, rad, as an inner wheel angle (outer 8 deg gives about 8.55). */
  rideLockRad: number;
  /** Tongue yaw stop, deg. */
  tongueMaxYawDeg: number;
  /** Tongue hinge, model frame, meters: where the pull force acts on the chassis. */
  tongueHingeM: Vec3;
  /** Share of the brake force taken by the front wheels (the solved bias of the takeoff arm, `frontBrakeShare`). */
  frontBrakeShare: number;
  /** Tongue tip (or bridle attachment): where the pull force acts, model frame at zero steer, meters. */
  pullPointM: Vec3;
  /** Whole-cart mass, CG (model frame, m) and weight in newtons. */
  totalMassKg: number;
  cgM: Vec3;
  weightN: number;
  riderMassLb: number;
  cartMassLb: number;
}

export interface SpecOptions {
  frontBrakeShare?: number;
  /** Override the rider mass (lb): the rider parts' masses are scaled to sum to this. */
  riderMassLb?: number;
}

const inM = (v: Vec3): Vec3 => scale(v, M_PER_IN);

function toBody(id: SimBodyId, b: BodyMass): SimBody {
  const pi = principalSI(b.inertiaLbIn2);
  return { id, massKg: b.massLb * KG_PER_LB, cgM: inM(b.cgIn), inertiaPrincipal: pi.values, inertiaFrame: pi.frame };
}

function hullBoxes(parts: Part[], cgIn: Vec3): HullBox[] {
  const out: HullBox[] = [];
  for (const p of parts) {
    if (p.geometry.type === 'wheel' || p.payload || p.group === 'reference' || /^bridle/.test(p.id) || isVisualBody(p.body)) continue;
    const o = partOBB(p);
    if (Math.max(...o.half) * 2 < 2) continue; // hardware and other small bits do not matter for ground contact
    out.push({
      center: inM(sub(o.center, cgIn)),
      half: [Math.max(o.half[0], 0.05) * M_PER_IN, Math.max(o.half[1], 0.05) * M_PER_IN, Math.max(o.half[2], 0.05) * M_PER_IN],
      rot: qFromColumns(o.axes[0], o.axes[1], o.axes[2]),
      partId: p.id,
    });
  }
  return out;
}

export function buildSimSpec(parts: Part[], p: Params, opts: SpecOptions = {}): SimSpec {
  const sim = parts.filter((x) => x.body !== 'truck');
  const chassisParts = sim.filter((x) => x.body === 'chassis' || x.body === 'rider' || x.body === 'cargo' || isVisualBody(x.body));

  const riderParts = sim.filter((x) => x.body === 'rider');
  const riderNow = riderParts.reduce((s, x) => s + x.massLb, 0);
  const riderMassLb = opts.riderMassLb ?? riderNow;
  const massOf = (x: Part): number => {
    if (x.body === 'rider' && opts.riderMassLb !== undefined) return riderNow > 0 ? (x.massLb * opts.riderMassLb) / riderNow : 0;
    return x.massLb;
  };
  // A custom rider mass with no rider parts present has nothing to attach to: put it on the (first) chassis seat CG.
  const chassis = bodyMass(chassisParts, massOf);

  const bodies: Partial<Record<SimBodyId, SimBody>> = { chassis: toBody('chassis', chassis) };
  const wheelCentersM = {} as Record<WheelId, Vec3>;
  const wheelCentersIn = {} as Record<WheelId, Vec3>;
  let wheelRadiusM = (p.wheelDiameterIn / 2) * M_PER_IN;
  let wheelWidthM = p.tireWidthIn * M_PER_IN;
  for (const id of WHEEL_IDS) {
    const part = sim.find((x) => x.id === id);
    if (!part) throw new Error(`sim: wheel part ${id} missing from the model`);
    const g = part.geometry;
    if (g.type === 'wheel') {
      wheelRadiusM = (g.diameter / 2) * M_PER_IN;
      wheelWidthM = g.width * M_PER_IN;
    }
    const c = translationOf(part.transform);
    wheelCentersIn[id] = c;
    wheelCentersM[id] = inM(c);
    const m = part.massLb * KG_PER_LB;
    const rr = wheelRadiusM;
    const w = wheelWidthM;
    // Solid disc: axle (local Y) = ½ m r², transverse = ¼ m r² + m w²/12.
    const it = 0.25 * m * rr * rr + (m * w * w) / 12;
    bodies[id] = {
      id, massKg: m, cgM: inM(c), inertiaPrincipal: [it, 0.5 * m * rr * rr, it], inertiaFrame: { x: 0, y: 0, z: 0, w: 1 },
    };
  }

  const ack = ackSpec(p);
  const hubZ = wheelCentersIn['wheel-FL'][2];
  // Kingpins at hub height (the kinematics are planar about vertical axes through these points).
  const kL: Vec3 = [ack.kx, ack.kpHalf, hubZ];
  const kR: Vec3 = [ack.kx, -ack.kpHalf, hubZ];
  const kingpinsM = { L: inM(kL), R: inM(kR) };
  const kingpinIn: Vec3 = [ack.kx, 0, hubZ];
  let steerMassLb = 0;
  const knuckleHull = { L: [] as HullBox[], R: [] as HullBox[] };
  for (const side of ['L', 'R'] as const) {
    const knuckleParts = sim.filter((x) => x.body === (side === 'L' ? 'steer-L' : 'steer-R'));
    const bm = bodyMass(knuckleParts);
    const id: SimBodyId = side === 'L' ? 'steer-L' : 'steer-R';
    bodies[id] = toBody(id, bm);
    steerMassLb += bm.massLb;
    knuckleHull[side] = hullBoxes(knuckleParts, bm.cgIn);
  }

  // Pull point: the tongue tip, or (ride view: no tongue part) where it would be.
  const tongue = sim.find((x) => x.id === 'tongue');
  let pullIn: Vec3;
  if (tongue) {
    const bb = worldAABB(tongue);
    pullIn = [bb.max[0], (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
  } else {
    pullIn = [ack.tongueHinge[0] + p.tongueLengthIn, 0, hubZ];
  }

  const total = chassis.massLb + steerMassLb + WHEEL_IDS.reduce((s, id) => s + bodies[id]!.massKg / KG_PER_LB, 0);
  const all = Object.values(bodies) as SimBody[];
  const cg: Vec3 = [0, 0, 0];
  for (const b of all) for (let k = 0; k < 3; k++) cg[k] += b.massKg * b.cgM[k];
  const totalKg = all.reduce((s, b) => s + b.massKg, 0);
  const towInner = lockLimits(ack, 'tow').innerDeg;
  const rideInner = lockLimits(ack, 'ride').innerDeg;

  return {
    bodyIds: ['chassis', 'steer-L', 'steer-R', ...WHEEL_IDS],
    bodies,
    hull: { chassis: hullBoxes(chassisParts, chassis.cgIn), 'steer-L': knuckleHull.L, 'steer-R': knuckleHull.R },
    wheelRadiusM,
    wheelWidthM,
    wheelCentersM,
    kingpinM: inM(kingpinIn),
    kingpinsM,
    ack,
    lockRad: (towInner * Math.PI) / 180,
    rideLockRad: (rideInner * Math.PI) / 180,
    tongueMaxYawDeg: p.tongueMaxYawDeg,
    tongueHingeM: inM([ack.tongueHinge[0], 0, hubZ]),
    frontBrakeShare: opts.frontBrakeShare ?? frontBrakeShare(p, computeLayout(p)) ?? DEFAULT_FRONT_BRAKE_SHARE,
    pullPointM: inM(pullIn),
    totalMassKg: totalKg,
    cgM: [cg[0] / totalKg, cg[1] / totalKg, cg[2] / totalKg],
    weightN: totalKg * G,
    riderMassLb,
    cartMassLb: total - riderMassLb - sim.filter((x) => x.body === 'cargo').reduce((s, x) => s + x.massLb, 0),
  };
}
