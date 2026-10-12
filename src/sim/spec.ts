/**
 * Turns the parts list into a physics spec (SI units, model frame): rigid-body mass properties, wheel geometry, the bridle-eye pull point and hull collider boxes.
 * Pure data; no physics engine and no DOM (phase-2 spec "Simulation"; D-12, D-56).
 *
 * Bodies: chassis (all chassis parts + rider + cargo as fixed mass), the pivoting front axle ('front-axle': beam, stubs, clamps, kingpin, tongue, shackle, rope) on a vertical
 * hinge at the kingpin with the steering lock as its limits (D-56), and four wheels on revolute joints (the front pair on the front axle). Parts tagged 'truck' are ignored.
 * The parts must be built with steerDeg 0 (the neutral pose): poses are relative to the build pose.
 */
import type { Params } from '../params';
import { partOBB } from '../model/bounds';
import type { Part, Vec3 } from '../model/types';
import { translationOf } from '../model/mat4';
import { computeLayout } from '../model/layout';
import { bodyMass, KG_PER_LB, M_PER_IN, principalSI, G, type BodyMass } from './massprops';
import { qFromColumns, scale, sub, type Quat } from './math';

export const WHEEL_IDS = ['wheel-FL', 'wheel-FR', 'wheel-RL', 'wheel-RR'] as const;
export type WheelId = (typeof WHEEL_IDS)[number];
export type SimBodyId = 'chassis' | 'front-axle' | WheelId;

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
  /** Bodies present in this spec (chassis, front axle, four wheels). */
  bodyIds: SimBodyId[];
  bodies: Partial<Record<SimBodyId, SimBody>>;
  hull: { chassis: HullBox[] };
  wheelRadiusM: number;
  wheelWidthM: number;
  /** Wheel centers, model frame, meters. */
  wheelCentersM: Record<WheelId, Vec3>;
  /** Tongue tie (the bridle shackle), model frame, meters: where the pull force acts, on the FRONT-AXLE body. */
  pullPointM: Vec3;
  /** Kingpin hinge point (vertical axis), model frame, meters. */
  kingpinM: Vec3;
  /** Steering lock, degrees each way (the stop blocks, D-56). */
  steerLockDeg: number;
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
    if (p.geometry.type === 'wheel' || p.payload || p.group === 'reference' || /^(bridle|brake-chock|steer-chain)/.test(p.id)) continue; // the loose wheel chocks sit on the ground by design (D-57)
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

  const riderParts = sim.filter((x) => x.body === 'rider');
  const riderNow = riderParts.reduce((s, x) => s + x.massLb, 0);
  const riderMassLb = opts.riderMassLb ?? riderNow;
  const massOf = (x: Part): number => {
    if (x.body === 'rider' && opts.riderMassLb !== undefined) return riderNow > 0 ? (x.massLb * opts.riderMassLb) / riderNow : 0;
    return x.massLb;
  };
  const chassis = bodyMass(chassisParts, massOf);

  const axleParts = sim.filter((x) => x.body === 'front-axle');
  if (axleParts.length === 0) throw new Error('sim: no front-axle parts in the model');
  const bodies: Partial<Record<SimBodyId, SimBody>> = { chassis: toBody('chassis', chassis), 'front-axle': toBody('front-axle', bodyMass(axleParts)) };
  const L = computeLayout(p);
  const wheelCentersM = {} as Record<WheelId, Vec3>;
  const wheelCentersIn = {} as Record<WheelId, Vec3>;
  let wheelRadiusM = (p.wheelDiameterIn / 2) * M_PER_IN;
  let wheelWidthM = p.tireWidthIn * M_PER_IN;
  for (const id of WHEEL_IDS) {
    const part = sim.find((x) => x.id === id);
    if (!part) throw new Error(`sim: wheel part ${id} missing from the model`);
    const g = part.geometry;
    let rr = wheelRadiusM;
    let w = wheelWidthM;
    if (g.type === 'wheel') {
      rr = (g.diameter / 2) * M_PER_IN;
      w = g.width * M_PER_IN;
      wheelRadiusM = rr;
      wheelWidthM = w;
    }
    const c = translationOf(part.transform);
    wheelCentersIn[id] = c;
    wheelCentersM[id] = inM(c);
    const m = part.massLb * KG_PER_LB;
    // Solid disc: axle (local Y) = ½ m r², transverse = ¼ m r² + m w²/12.
    const it = 0.25 * m * rr * rr + (m * w * w) / 12;
    bodies[id] = {
      id, massKg: m, cgM: inM(c), inertiaPrincipal: [it, 0.5 * m * rr * rr, it], inertiaFrame: { x: 0, y: 0, z: 0, w: 1 },
    };
  }

  // Pull point: the tie hole of the tongue plate (where the shackle and bridle attach), at the tie height, on the centerline.
  const pullIn: Vec3 = [L.tongue.holeX, 0, L.tongue.tieZ];
  // Kingpin hinge: the vertical bolt through the beam, tongue plate, thrust washer and king beam; its axis is at (king.x, 0).
  const kingIn: Vec3 = [L.king.x, 0, (L.steer.beamBot + L.king.top) / 2];

  const total = chassis.massLb + bodies['front-axle']!.massKg / KG_PER_LB + WHEEL_IDS.reduce((s, id) => s + bodies[id]!.massKg / KG_PER_LB, 0);
  const all = Object.values(bodies) as SimBody[];
  const cg: Vec3 = [0, 0, 0];
  for (const b of all) for (let k = 0; k < 3; k++) cg[k] += b.massKg * b.cgM[k];
  const totalKg = all.reduce((s, b) => s + b.massKg, 0);

  return {
    bodyIds: ['chassis', 'front-axle', ...WHEEL_IDS],
    bodies,
    hull: { chassis: hullBoxes(chassisParts, chassis.cgIn) },
    wheelRadiusM,
    wheelWidthM,
    wheelCentersM,
    pullPointM: inM(pullIn),
    kingpinM: inM(kingIn),
    steerLockDeg: Math.abs(p.steerLockDeg),
    totalMassKg: totalKg,
    cgM: [cg[0] / totalKg, cg[1] / totalKg, cg[2] / totalKg],
    weightN: totalKg * G,
    riderMassLb,
    cartMassLb: total - riderMassLb - sim.filter((x) => x.body === 'cargo').reduce((s, x) => s + x.massLb, 0),
  };
}
