/**
 * Qualitative physics core (BRIEF §8): Rapier rigid bodies for the chassis (with rider and cargo as fixed mass), the pivoting
 * front axle and the four wheels on revolute joints. No three.js, no DOM: runs headless under vitest.
 *
 * Front end (D-56): the front axle (beam, stubs, kingpin, tongue plate, shackle, rope) is one rigid body on a vertical hinge at the kingpin, limited to +/-steerLockDeg by the
 * steering stops (a hard joint limit), otherwise free with a little friction; the two front wheels spin on it. The pull force acts at the tongue tie ON THE FRONT AXLE, so a pull at an
 * angle steers it; a servo (`steerHold`) can hold a commanded angle instead (the turning-circle demo).
 *
 * Units inside the engine are SI (m, kg, N); the public readouts and poses are in the model's units (inches, lbf,
 * mph) so they plug straight into the viewer. The step is a fixed 1/240 s.
 *
 * Modeling choices (limitations are listed in the panel):
 *  - Each wheel is a ball of the tire radius: contact is at the tire centerline, which is what the static tip check
 *    (T/2)/h uses, and ball-on-plane contact is robust. Tire width, sidewall and hub are not simulated.
 *  - Ground is a kinematic slab (so the tilt table can rotate it) carrying the root and the curb. Gravity is vertical.
 *  - The hull collides with the ground via compound cuboids from the part OBBs; that contact is the "hull touches
 *    the ground" half of the tip-over event.
 *  - Rolling resistance and the brakes are velocity motors (target 0) on the wheel joints with a limited torque. Only the two REAR wheels brake (D-53).
 */
import type RapierModule from '@dimforge/rapier3d-compat';
import type { Mat4, RigidBody, Vec3 } from '../model/types';
import { G, M_PER_IN, MPH_PER_MS, N_PER_LBF } from './massprops';
import { add, dot, mat4FromQuat, qAxisAngle, qMul, qRotate, scale, sub, type Quat } from './math';
import { DEFAULT_CONFIG, DEFAULT_CONTROLS, type SimConfig, type SimControls, type SimScript } from './scenarios';
import { WHEEL_IDS, type SimBodyId, type SimSpec, type WheelId } from './spec';

export type Rapier = typeof RapierModule;

let rapierPromise: Promise<Rapier> | null = null;
/** Loads and initializes the Rapier WASM once; every caller shares the promise. */
export function loadRapier(): Promise<Rapier> {
  rapierPromise ??= import('@dimforge/rapier3d-compat').then(async (m) => {
    const R = ((m as unknown as { default?: Rapier }).default ?? (m as unknown as Rapier)) as Rapier;
    await R.init();
    return R;
  });
  return rapierPromise;
}

/** Fixed timestep (spec: 1/240 s). */
export const DT = 1 / 240;
/** Roll angle (sled up vs ground normal) past which the sled counts as tipped over. */
export const TIP_ROLL_DEG = 60;
/** A wheel is "lifting" when its load falls under this fraction of its even share of the weight. */
export const LIFT_FRACTION = 0.03;
/** Beyond this distance from the start the sled has left the "course" and the run ends. */
export const COURSE_LIMIT_IN = 2400;

export interface EnvShape {
  id: 'ground' | 'root' | 'curb';
  kind: 'box' | 'cylinder';
  /** Box: half extents. Cylinder (axis Y): [radius, halfLength, radius]. Inches, ground frame. */
  half: Vec3;
  center: Vec3;
}

export interface SimReadout {
  t: number;
  /** Signed speed along the sled's heading, mph. */
  speedMph: number;
  /** Ground tilt from the side slope, degrees (rises in the tilt table). */
  groundSideSlopeDeg: number;
  /** Sled up-axis vs the ground normal, degrees. */
  rollDeg: number;
  /** Per-wheel normal load, lbf. */
  loadLbf: Record<WheelId, number>;
  /** Per-wheel load as a fraction of the whole-sled weight. */
  loadFrac: Record<WheelId, number>;
  lift: Record<WheelId, boolean>;
  anyLift: boolean;
  /** Second distinct wheel lift: the support is down to a line, so the sled tips about it (the tip-onset angle). */
  secondLift: { t: number; wheel: WheelId; groundSideSlopeDeg: number } | null;
  /** First wheel lift of the run, with the side slope at that moment (the tilt-table onset). */
  firstLift: { t: number; wheel: WheelId; groundSideSlopeDeg: number } | null;
  tipped: boolean;
  tipReason: 'roll' | 'hull' | null;
  tipTime: number | null;
  /** Peak total wheel load over the run, as a multiple of the weight (bump strikes). */
  peakLoadFactor: number;
  distanceIn: number;
  finished: boolean;
  brakeActive: boolean;
  /** Front-axle angle about the kingpin relative to the chassis, degrees (+ = left turn). */
  steerDeg: number;
  /** Radius of the circle the rear axle center is driving, inches (speed / yaw rate); null when the sled is not turning. */
  turnRadiusIn: number | null;
}

export interface SimOptions {
  config?: Partial<SimConfig>;
  controls?: Partial<SimControls>;
  script?: SimScript;
}

type RB = InstanceType<Rapier['RigidBody']>;
type Col = InstanceType<Rapier['Collider']>;
type Joint = InstanceType<Rapier['RevoluteImpulseJoint']>;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const IG = (membership: number, filter: number) => ((membership << 16) | filter) >>> 0;
const GRP_GROUND = 1, GRP_HULL = 2, GRP_WHEEL = 4;
/** Servo (steerHold) stiffness (N·m/rad) and damping (N·m·s/rad) on the kingpin: stiff, to hold the axle against the pull and the tire scrub. */
const STEER_K = 30000;
const STEER_C = 400;
/** Light friction of the kingpin bearing (UHMW on steel), N·m: the free axle is not frictionless. */
const KING_FRICTION_NM = 0.4;

export class Sim {
  readonly spec: SimSpec;
  readonly config: SimConfig;
  readonly controls: SimControls;
  readonly script: SimScript;
  /** Seconds of simulated time. */
  t = 0;
  stepCount = 0;

  private readonly world: InstanceType<Rapier['World']>;
  private readonly bodies = {} as Record<SimBodyId, RB>;
  private readonly ground: RB;
  private readonly groundCols: Col[] = [];
  private readonly wheelCols = {} as Record<WheelId, Col>;
  private readonly hullChassis = new Set<number>();
  private readonly wheelJoints = {} as Record<WheelId, Joint>;
  private kingJoint!: Joint;
  private readonly bodyIds: SimBodyId[];
  private readonly qSlope: Quat;
  private readonly cgIn = {} as Record<SimBodyId, Vec3>;
  private readonly startPos: Vec3;
  private loadN = { 'wheel-FL': 0, 'wheel-FR': 0, 'wheel-RL': 0, 'wheel-RR': 0 } as Record<WheelId, number>;
  private firstLift: SimReadout['firstLift'] = null;
  private secondLift: SimReadout['secondLift'] = null;
  private tipped: SimReadout['tipReason'] = null;
  private tipTime: number | null = null;
  private peakLoadFactor = 0;
  private finished = false;
  private brakeActive = false;

  constructor(R: Rapier, spec: SimSpec, opts: SimOptions = {}) {
    this.spec = spec;
    this.config = { ...DEFAULT_CONFIG, ...opts.config };
    this.controls = { ...DEFAULT_CONTROLS, ...opts.controls };
    this.script = opts.script ?? {};
    this.bodyIds = spec.bodyIds;
    const c = this.config;
    const world = (this.world = new R.World({ x: 0, y: 0, z: -G }));
    world.timestep = DT;
    // Solver effort: a caster fork is a light body (pitch inertia of a few hundredths of a kg·m², less than a locked
    // wheel's spin inertia) closing a constraint loop chassis -> swivel -> fork -> wheel hinge -> ground. With few
    // internal PGS iterations that loop does not converge and the whole sled rocks on its wheels. 16 internal
    // iterations settle it for any plausible fork.
    world.numSolverIterations = 8;
    world.numInternalPgsIterations = 16;
    world.integrationParameters.contact_natural_frequency = 60;

    // Ground orientation: pitch (downhill) about Y, side slope about the sled's own X axis first.
    const qg = (roll: number) => qMul(qAxisAngle('y', rad(c.slopeDeg)), qAxisAngle('x', rad(roll)));
    this.qSlope = qg(c.sideSlopeDeg);
    const Rg = this.qSlope;

    // ── ground (kinematic, carries the obstacles) ──
    this.ground = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setRotation(Rg).setCanSleep(false));
    const gcol = (d: InstanceType<Rapier['ColliderDesc']>) => {
      const col = world.createCollider(
        d.setFriction(c.frictionMu).setFrictionCombineRule(R.CoefficientCombineRule.Max).setRestitution(0)
          .setCollisionGroups(IG(GRP_GROUND, GRP_HULL | GRP_WHEEL)),
        this.ground,
      );
      this.groundCols.push(col);
    };
    gcol(R.ColliderDesc.cuboid(1000, 1000, 0.5).setTranslation(0, 0, -0.5));
    const env = this.environment();
    for (const s of env) {
      if (s.id === 'root') {
        gcol(R.ColliderDesc.cylinder(s.half[1] * M_PER_IN, s.half[0] * M_PER_IN).setTranslation(s.center[0] * M_PER_IN, 0, 0));
      } else if (s.id === 'curb') {
        gcol(R.ColliderDesc.cuboid(s.half[0] * M_PER_IN, s.half[1] * M_PER_IN, s.half[2] * M_PER_IN)
          .setTranslation(s.center[0] * M_PER_IN, 0, s.center[2] * M_PER_IN));
      }
    }

    // ── bodies ──
    const place = (id: SimBodyId): { pos: Vec3; rot: Quat } => {
      const cg = spec.bodies[id]!.cgM;
      return { pos: qRotate(Rg, cg), rot: Rg };
    };
    const v0 = c.initialSpeedMph / MPH_PER_MS;
    const vel = qRotate(Rg, [v0, 0, 0]);
    // The run starts with the front axle already turned to controls.steerDeg (clamped to the lock): the axle, its wheels and everything on it are
    // swung about the kingpin; the hinge angle is then that start angle.
    const lockRad = rad(spec.steerLockDeg);
    const steer0 = Math.max(-lockRad, Math.min(lockRad, rad(this.controls.steerDeg)));
    const qSteer = qAxisAngle('z', steer0);
    const onAxle = (id: SimBodyId) => id === 'front-axle' || id === 'wheel-FL' || id === 'wheel-FR';
    for (const id of this.bodyIds) {
      const b = spec.bodies[id]!;
      let pl = place(id);
      if (onAxle(id) && steer0 !== 0) {
        const k = spec.kingpinM;
        const rel = qRotate(qSteer, sub(b.cgM, k));
        pl = { pos: qRotate(Rg, [k[0] + rel[0], k[1] + rel[1], k[2] + rel[2]]), rot: qMul(Rg, qSteer) };
      }
      const desc = R.RigidBodyDesc.dynamic()
        .setTranslation(...pl.pos).setRotation(pl.rot).setCanSleep(false)
        .setAdditionalMassProperties(b.massKg, { x: 0, y: 0, z: 0 }, { x: b.inertiaPrincipal[0], y: b.inertiaPrincipal[1], z: b.inertiaPrincipal[2] }, b.inertiaFrame)
        .setLinvel(...vel);
      const rb = world.createRigidBody(desc);
      this.bodies[id] = rb;
      this.cgIn[id] = scale(b.cgM, 1 / M_PER_IN);
      if (id.startsWith('wheel')) {
        const wr = spec.wheelRadiusM;
        const w = qRotate(pl.rot, [0, v0 / wr, 0]);
        rb.setAngvel({ x: w[0], y: w[1], z: w[2] }, true);
        this.wheelCols[id as WheelId] = world.createCollider(
          R.ColliderDesc.ball(wr).setDensity(0).setFriction(c.frictionMu)
            .setFrictionCombineRule(R.CoefficientCombineRule.Max).setRestitution(0)
            .setCollisionGroups(IG(GRP_WHEEL, GRP_GROUND)),
          rb,
        );
      }
    }
    const sp = this.bodies.chassis.translation();
    this.startPos = [sp.x, sp.y, sp.z];

    // Hull colliders (mass 0: the mass comes from the part list).
    const addHull = (id: 'chassis', set: Set<number>) => {
      for (const h of spec.hull[id]) {
        const col = world.createCollider(
          R.ColliderDesc.cuboid(...h.half).setTranslation(...h.center).setRotation(h.rot).setDensity(0)
            .setFriction(0.5).setRestitution(0).setCollisionGroups(IG(GRP_HULL, GRP_GROUND)),
          this.bodies[id],
        );
        set.add(col.handle);
      }
    };
    addHull('chassis', this.hullChassis);

    // ── joints ──
    const loc = (id: SimBodyId, p: Vec3) => {
      const o = sub(p, spec.bodies[id]!.cgM);
      return { x: o[0], y: o[1], z: o[2] };
    };
    {
      // Kingpin: a vertical hinge between the chassis and the front axle; the stops are hard limits at +/-lock.
      const k = spec.kingpinM;
      const j = R.JointData.revolute(loc('chassis', k), loc('front-axle', k), { x: 0, y: 0, z: 1 });
      const joint = world.createImpulseJoint(j, this.bodies.chassis, this.bodies['front-axle'], true) as Joint;
      joint.setLimits(-lockRad, lockRad);
      joint.configureMotorModel(R.MotorModel.ForceBased);
      this.kingJoint = joint;
    }
    for (const id of WHEEL_IDS) {
      const parent: SimBodyId = id === 'wheel-FL' || id === 'wheel-FR' ? 'front-axle' : 'chassis';
      const wc = spec.wheelCentersM[id];
      const j = R.JointData.revolute(loc(parent, wc), { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
      const joint = world.createImpulseJoint(j, this.bodies[parent], this.bodies[id], true) as Joint;
      joint.configureMotorModel(R.MotorModel.ForceBased);
      joint.configureMotorVelocity(0, 1e4);
      joint.setMotorMaxForce(0);
      this.wheelJoints[id] = joint;
    }
    this.applyMotors();
  }

  /** Static scene shapes in the ground frame (inches), for the viewer. */
  environment(): EnvShape[] {
    const c = this.config;
    const out: EnvShape[] = [{ id: 'ground', kind: 'box', half: [40000, 40000, 0.5], center: [0, 0, -0.5] }];
    if (c.root) out.push({ id: 'root', kind: 'cylinder', half: [2, 40000, 2], center: [c.rootAtIn, 0, 0] });
    if (c.curb) out.push({ id: 'curb', kind: 'box', half: [20000, 40000, 1.5], center: [c.curbAtIn + 20000, 0, 1.5] });
    return out;
  }

  private groundRotation(): Quat {
    const roll = this.config.sideSlopeDeg + this.config.tiltRateDegPerS * this.t;
    return qMul(qAxisAngle('y', rad(this.config.slopeDeg)), qAxisAngle('x', rad(roll)));
  }

  get groundSideSlopeDeg(): number {
    return this.config.sideSlopeDeg + this.config.tiltRateDegPerS * this.t;
  }

  /** Brake torque per wheel (N·m) plus rolling resistance, as the wheel-joint motor limit. */
  private applyMotors(): void {
    const crr = this.config.rollingResistance;
    const brakeN = this.brakeActive ? this.controls.brakeLbf * N_PER_LBF : 0;
    for (const id of WHEEL_IDS) {
      const rear = id === 'wheel-RL' || id === 'wheel-RR';
      const r = this.spec.wheelRadiusM;
      const brakeNm = rear ? (brakeN * this.spec.wheelRadiusM) / 2 : 0; // rear brake only (D-53, D-55)
      this.wheelJoints[id].setMotorMaxForce(this.config.wheelsLocked ? 1e6 : crr * this.loadN[id] * r + brakeNm);
    }
  }

  /** The kingpin: the servo (steerHold) holds the commanded angle, otherwise only a little bearing friction acts and the axle is free between the stops. */
  private applySteering(): void {
    const lock = rad(this.spec.steerLockDeg);
    if (this.controls.steerHold) {
      const target = Math.max(-lock, Math.min(lock, rad(this.controls.steerDeg)));
      this.kingJoint.configureMotorPosition(target, STEER_K, STEER_C);
      this.kingJoint.setMotorMaxForce(1e6);
    } else {
      this.kingJoint.configureMotorVelocity(0, 0.5);
      this.kingJoint.setMotorMaxForce(KING_FRICTION_NM);
    }
  }

  step(): void {
    if (this.finished) return;
    const c = this.config;
    // Scripted events.
    if (this.script.brakeAtS !== undefined && this.t >= this.script.brakeAtS) this.controls.brakeOn = true;
    this.brakeActive = this.controls.brakeOn;
    this.applyMotors();
    this.applySteering();

    // Pull force: at the tongue tie ON THE FRONT AXLE, so a pull off the tongue's line steers the axle. The rope is the pull direction in the world
    // (or, with pullFollowsAxle, along the axle's own heading), not a body-fixed one.
    const ax = this.bodies['front-axle'];
    ax.resetForces(true);
    ax.resetTorques(true); // addForceAtPoint also accumulates a persistent torque
    if (this.controls.pullLbf > 0) {
      let a = rad(this.controls.pullAngleDeg + this.controls.pullTurnDegPerS * this.t);
      if (this.controls.pullFollowsAxle) {
        const f = qRotate(ax.rotation() as Quat, [1, 0, 0]);
        a += Math.atan2(f[1], f[0]);
      }
      const F = this.controls.pullLbf * N_PER_LBF;
      const local = sub(this.spec.pullPointM, this.spec.bodies['front-axle']!.cgM);
      const t = ax.translation();
      const w = add([t.x, t.y, t.z], qRotate(ax.rotation() as Quat, local));
      ax.addForceAtPoint({ x: F * Math.cos(a), y: F * Math.sin(a), z: 0 }, { x: w[0], y: w[1], z: w[2] }, true);
    }

    // Tilt table: rotate the kinematic ground for the next step.
    if (c.tiltRateDegPerS !== 0) this.ground.setNextKinematicRotation(this.groundRotation());

    this.world.step();
    this.t += DT;
    this.stepCount++;
    this.readContacts();
    this.events();
  }

  /** Per-wheel normal load from the contact impulses of the last step, plus hull contacts. */
  private readContacts(): void {
    const W = this.spec.weightN;
    let total = 0;
    for (const id of WHEEL_IDS) {
      let imp = 0;
      for (const g of this.groundCols) {
        this.world.contactPair(this.wheelCols[id], g, (m) => {
          for (let i = 0, n = m.numContacts(); i < n; i++) imp += m.contactImpulse(i);
        });
      }
      this.loadN[id] = imp / DT;
      total += this.loadN[id];
    }
    this.peakLoadFactor = Math.max(this.peakLoadFactor, total / W);
    this.hullTouch = false;
    for (const g of this.groundCols) {
      this.world.contactPairsWith(g, (other) => {
        const chassisHit = this.hullChassis.has(other.handle);
        if (!chassisHit) return;
        this.world.contactPair(g, other, (m) => {
          let imp = 0;
          for (let i = 0, n = m.numContacts(); i < n; i++) imp += m.contactImpulse(i);
          if (imp > 1e-3) {
            if (chassisHit) this.hullTouch = true;
          }
        });
      });
    }
  }
  private hullTouch = false;
  private events(): void {
    const fair = this.spec.weightN / 4;
    if (this.t > 0.05 && this.secondLift === null) {
      const lifted = WHEEL_IDS.filter((id) => this.loadN[id] < LIFT_FRACTION * fair);
      const at = { t: this.t, groundSideSlopeDeg: this.groundSideSlopeDeg };
      if (this.firstLift === null && lifted.length > 0) this.firstLift = { ...at, wheel: lifted[0] };
      if (lifted.length > 1 || (this.firstLift && lifted.some((id) => id !== this.firstLift!.wheel))) {
        this.secondLift = { ...at, wheel: lifted.find((id) => id !== this.firstLift!.wheel) ?? lifted[0] };
      }
    }
    if (this.tipped === null) {
      if (this.rollDeg() > TIP_ROLL_DEG) this.tip('roll');
      else if (this.hullTouch) this.tip('hull');
    }
    const p = this.bodies.chassis.translation();
    const d = Math.hypot(p.x - this.startPos[0], p.y - this.startPos[1], p.z - this.startPos[2]) / M_PER_IN;
    if ((this.script.endAtS !== undefined && this.t >= this.script.endAtS) || d > COURSE_LIMIT_IN) this.finished = true;
  }

  private tip(reason: 'roll' | 'hull'): void {
    this.tipped = reason;
    this.tipTime = this.t;
  }

  /** Angle between the sled's up axis and the ground normal. */
  rollDeg(): number {
    const up = qRotate(this.bodies.chassis.rotation() as Quat, [0, 0, 1]);
    const n = qRotate(this.groundRotation(), [0, 0, 1]);
    return deg(Math.acos(Math.max(-1, Math.min(1, dot(up, n)))));
  }

  readout(): SimReadout {
    const fair = this.spec.weightN / 4;
    const v = this.bodies.chassis.linvel();
    const fwd = qRotate(this.bodies.chassis.rotation() as Quat, [1, 0, 0]);
    const loadLbf = {} as Record<WheelId, number>;
    const loadFrac = {} as Record<WheelId, number>;
    const lift = {} as Record<WheelId, boolean>;
    let any = false;
    for (const id of WHEEL_IDS) {
      loadLbf[id] = this.loadN[id] / N_PER_LBF;
      loadFrac[id] = this.loadN[id] / this.spec.weightN;
      lift[id] = this.t > 0.05 && this.loadN[id] < LIFT_FRACTION * fair;
      any ||= lift[id];
    }
    const p = this.bodies.chassis.translation();
    return {
      t: this.t,
      speedMph: dot([v.x, v.y, v.z], fwd) * MPH_PER_MS,
      groundSideSlopeDeg: this.groundSideSlopeDeg,
      rollDeg: this.rollDeg(),
      loadLbf, loadFrac, lift, anyLift: any,
      firstLift: this.firstLift,
      secondLift: this.secondLift,
      tipped: this.tipped !== null,
      tipReason: this.tipped,
      tipTime: this.tipTime,
      peakLoadFactor: this.peakLoadFactor,
      distanceIn: Math.hypot(p.x - this.startPos[0], p.y - this.startPos[1], p.z - this.startPos[2]) / M_PER_IN,
      finished: this.finished,
      brakeActive: this.brakeActive,
      steerDeg: this.steerDeg(),
      turnRadiusIn: this.turnRadiusIn(),
    };
  }

  /** Front-axle angle relative to the chassis about the vertical, degrees (+ = left). */
  steerDeg(): number {
    const qc = this.bodies.chassis.rotation() as Quat;
    const qa = this.bodies['front-axle'].rotation() as Quat;
    const rel = qMul({ x: -qc.x, y: -qc.y, z: -qc.z, w: qc.w }, qa);
    return deg(2 * Math.atan2(rel.z, rel.w));
  }

  /** Radius of the rear axle center's path (speed over yaw rate about the sled's up axis), inches; null when it is not turning or not moving. */
  turnRadiusIn(): number | null {
    const qc = this.bodies.chassis.rotation() as Quat;
    const up = qRotate(qc, [0, 0, 1]);
    const w = this.bodies.chassis.angvel();
    const yaw = dot([w.x, w.y, w.z], up);
    const l = this.bodies['wheel-RL'].linvel(), r = this.bodies['wheel-RR'].linvel();
    const vm = Math.hypot((l.x + r.x) / 2, (l.y + r.y) / 2, (l.z + r.z) / 2);
    if (Math.abs(yaw) < 0.02 || vm < 0.1) return null;
    return vm / Math.abs(yaw) / M_PER_IN;
  }

  /**
   * Pose of each model rigid body relative to its build pose (the neutral model frame, inches): left-multiply a part's
   * model transform by it to get its world transform. Rider and cargo ride on the chassis.
   */
  poses(): Map<RigidBody, Mat4> {
    const out = new Map<RigidBody, Mat4>();
    for (const id of this.bodyIds) {
      const b = this.bodies[id];
      const q = b.rotation() as Quat;
      const t = b.translation();
      const cg = this.cgIn[id];
      const rc = qRotate(q, cg);
      out.set(id as RigidBody, mat4FromQuat(q, [t.x / M_PER_IN - rc[0], t.y / M_PER_IN - rc[1], t.z / M_PER_IN - rc[2]]));
    }
    out.set('rider', out.get('chassis')!);
    out.set('cargo', out.get('chassis')!);
    return out;
  }

  /** Ground-body pose (inches), for drawing the slab and obstacles. */
  groundPose(): Mat4 {
    return mat4FromQuat(this.groundRotation(), [0, 0, 0]);
  }

  /** World position of the chassis CG (inches), for a following camera. */
  chassisPositionIn(): Vec3 {
    const t = this.bodies.chassis.translation();
    return [t.x / M_PER_IN, t.y / M_PER_IN, t.z / M_PER_IN];
  }

  dispose(): void {
    this.world.free();
  }
}

/** Build a sim from a spec after the (shared) Rapier init. */
export async function createSim(spec: SimSpec, opts: SimOptions = {}): Promise<Sim> {
  return new Sim(await loadRapier(), spec, opts);
}
