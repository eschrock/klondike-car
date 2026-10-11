/**
 * Turns the parts list into a physics spec (SI units, model frame): rigid-body mass properties, wheel and kingpin
 * geometry, the tongue-tip pull point and hull collider boxes. Pure data; no physics engine and no DOM (phase-2 spec
 * "Simulation"; D-12, D-25, D-26).
 *
 * Bodies: chassis (all chassis parts + rider + cargo as fixed mass), steer (everything on the front axle / turntable,
 * rotates about the kingpin) and four wheels. Parts tagged 'truck' are ignored.
 */
import type { Params } from '../params';
import { partOBB, worldAABB } from '../model/bounds';
import type { Part, Vec3 } from '../model/types';
import { translationOf } from '../model/mat4';
import { bodyMass, KG_PER_LB, M_PER_IN, principalSI, G, type BodyMass } from './massprops';
import { qFromColumns, scale, sub, type Quat } from './math';

export const WHEEL_IDS = ['wheel-FL', 'wheel-FR', 'wheel-RL', 'wheel-RR'] as const;
export type WheelId = (typeof WHEEL_IDS)[number];
export type SimBodyId = 'chassis' | 'steer' | WheelId;

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

export interface SimSpec {
  bodies: Record<SimBodyId, SimBody>;
  hull: { chassis: HullBox[]; steer: HullBox[] };
  wheelRadiusM: number;
  wheelWidthM: number;
  /** Wheel centers at zero steer, model frame, meters. */
  wheelCentersM: Record<WheelId, Vec3>;
  kingpinM: Vec3;
  lockRad: number;
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
    if (p.geometry.type === 'wheel' || p.payload || p.group === 'reference' || /^bridle/.test(p.id)) continue;
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
  const chassisParts = sim.filter((x) => x.body === 'chassis' || x.body === 'rider' || x.body === 'cargo');
  const steerParts = sim.filter((x) => x.body === 'steer');

  const riderParts = sim.filter((x) => x.body === 'rider');
  const riderNow = riderParts.reduce((s, x) => s + x.massLb, 0);
  const riderMassLb = opts.riderMassLb ?? riderNow;
  const massOf = (x: Part): number => {
    if (x.body === 'rider' && opts.riderMassLb !== undefined) return riderNow > 0 ? (x.massLb * opts.riderMassLb) / riderNow : 0;
    return x.massLb;
  };
  // A custom rider mass with no rider parts present has nothing to attach to: put it on the (first) chassis seat CG.
  const chassis = bodyMass(chassisParts, massOf);
  const steer = bodyMass(steerParts);

  const bodies = { chassis: toBody('chassis', chassis), steer: toBody('steer', steer) } as Record<SimBodyId, SimBody>;
  const wheelCentersM = {} as Record<WheelId, Vec3>;
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

  const kp = sim.find((x) => x.id === 'kingpin');
  const kx = p.wheelbaseIn + p.kingpinLeadIn;
  const kingpinIn: Vec3 = kp ? translationOf(kp.transform) : [kx, 0, p.wheelDiameterIn / 2];
  // Pull point: tongue tip, else the bridle's near end, else the front of the steer body.
  const tongue = sim.find((x) => x.id === 'tongue');
  // Straight lead ('bridle') with a tongue, or the two rope legs ('bridle-L'/'bridle-R') tied at the beam ends.
  const bridleParts = sim.filter((x) => /^bridle/.test(x.id));
  const bridle = bridleParts.length ? bridleParts : undefined;
  let pullIn: Vec3;
  if (tongue) {
    const bb = worldAABB(tongue);
    pullIn = [bb.max[0], (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
  } else if (bridle) {
    const bb = worldAABB(bridle);
    pullIn = [bb.min[0], 0, (bb.min[2] + bb.max[2]) / 2];
  } else {
    const bb = worldAABB(steerParts.filter((x) => !/^bridle/.test(x.id)));
    pullIn = [bb.max[0], 0, (bb.min[2] + bb.max[2]) / 2];
  }

  const total = chassis.massLb + steer.massLb + WHEEL_IDS.reduce((s, id) => s + bodies[id].massKg / KG_PER_LB, 0);
  const cg: Vec3 = [0, 0, 0];
  const add = (b: SimBody) => {
    for (let k = 0; k < 3; k++) cg[k] += (b.massKg * b.cgM[k]);
  };
  (Object.values(bodies) as SimBody[]).forEach(add);
  const totalKg = (Object.values(bodies) as SimBody[]).reduce((s, b) => s + b.massKg, 0);

  return {
    bodies,
    hull: { chassis: hullBoxes(chassisParts, chassis.cgIn), steer: hullBoxes(steerParts, steer.cgIn) },
    wheelRadiusM,
    wheelWidthM,
    wheelCentersM,
    kingpinM: inM(kingpinIn),
    lockRad: (Math.abs(p.steerLockDeg) * Math.PI) / 180,
    pullPointM: inM(pullIn),
    totalMassKg: totalKg,
    cgM: [cg[0] / totalKg, cg[1] / totalKg, cg[2] / totalKg],
    weightN: totalKg * G,
    riderMassLb,
    cartMassLb: total - riderMassLb - sim.filter((x) => x.body === 'cargo').reduce((s, x) => s + x.massLb, 0),
  };
}
