/**
 * Qualitative physics core (BRIEF §8): Rapier rigid bodies for the chassis (with rider and cargo as fixed mass), the
 * steered front end and four wheels on revolute joints. No three.js, no DOM: runs headless under vitest.
 *
 * Front end (spec 8.2): two knuckle bodies on their own vertical kingpin revolutes with the lock limits of the
 * control mode (tow: inner 35.5; ride: outer 8). The tie rod is NOT a physics linkage: two stiff position motors command the knuckles
 * to the angles `solveSteer` gives for the commanded inner-wheel angle. The tie rod, bellcrank, links and tongue are visual-only: their poses are
 * computed analytically (`poseMatrices`) and merged into `poses()` (tie rod, bellcrank, drag link, tongue link, tongue). In tow 'bridle' mode the tongue follows the rope direction (rate and
 * damping limited, clamped to the yaw stop) and the steer angle is `solveFromTongue`: qualitative, like the rest. In ride mode the input
 * is clamped to the ride lock and, with no input, a weak centering motor holds the knuckles at zero.
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
 *  - Rolling resistance and the brakes are velocity motors (target 0) on the wheel joints with a limited torque.
 */
import type RapierModule from '@dimforge/rapier3d-compat';
import { poseMatrices, solveSteer, type SteerSolution } from '../model/ackermann';
import { multiply } from '../model/mat4';
import type { Mat4, RigidBody, Vec3 } from '../model/types';
import { G, M_PER_IN, MPH_PER_MS, N_PER_LBF } from './massprops';
import { add, dot, mat4FromQuat, qAxisAngle, qConj, qMul, qRotate, scale, sub, type Quat } from './math';
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
/** Roll angle (cart up vs ground normal) past which the cart counts as tipped over. */
export const TIP_ROLL_DEG = 60;
/** A wheel is "lifting" when its load falls under this fraction of its even share of the weight. */
export const LIFT_FRACTION = 0.03;
/** Slew rate of the commanded steering angle (deg/s). */
const STEER_RATE_DEG_S = 120;
/** Ackermann knuckle motors: stiff, because they stand in for a rigid tie rod and must hold the solved angle against the tire scrub torque. */
const ACK_STEER_K = 12000;
const ACK_STEER_C = 240;
/** Ride-mode centering motor (N·m/rad per knuckle, N·m·s/rad): the spring at the bellcrank, felt at the grip as about 2.5 lbf at the lock. */
const RIDE_CENTER_K = 120;
const RIDE_CENTER_C = 25;
/** Tongue follow dynamics in tow bridle mode: first-order time constant (s) and the slew limit (deg/s). */
const TONGUE_TAU_S = 0.12;
const TONGUE_RATE_DEG_S = 120;
/** Beyond this distance from the start the cart has left the "course" and the run ends. */
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
  /** Signed speed along the cart's heading, mph. */
  speedMph: number;
  /** Steer angle (+ = left), degrees: the inner wheel angle. */
  steerDeg: number;
  /** The left and right knuckle angles (deg, + = left). */
  knuckleDeg: { L: number; R: number };
  /** Ground tilt from the side slope, degrees (rises in the tilt table). */
  groundSideSlopeDeg: number;
  /** Cart up-axis vs the ground normal, degrees. */
  rollDeg: number;
  /** Per-wheel normal load, lbf. */
  loadLbf: Record<WheelId, number>;
  /** Per-wheel load as a fraction of the whole-cart weight. */
  loadFrac: Record<WheelId, number>;
  lift: Record<WheelId, boolean>;
  anyLift: boolean;
  /** Second distinct wheel lift: the support is down to a line, so the cart tips about it (the tip-onset angle). */
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
  private readonly hullSteer = new Set<number>();
  private readonly wheelJoints = {} as Record<WheelId, Joint>;
  /** Left and right kingpin joints. */
  private readonly kpL!: Joint;
  private readonly kpR!: Joint;
  private readonly bodyIds: SimBodyId[];
  /** Tongue yaw relative to the chassis (deg, + = left) in tow bridle mode; inner-wheel command from it. */
  private tongueDeg = 0;
  private tongueTable: Array<{ t: number; s: number }> = [];
  private lastSol: { cmd: number; sol: SteerSolution } | null = null;
  private readonly qSlope: Quat;
  private readonly cgIn = {} as Record<SimBodyId, Vec3>;
  private readonly startPos: Vec3;
  private steerCmdRad = 0;
  private loadN = { 'wheel-FL': 0, 'wheel-FR': 0, 'wheel-RL': 0, 'wheel-RR': 0 } as Record<WheelId, number>;
  private firstLift: SimReadout['firstLift'] = null;
  private secondLift: SimReadout['secondLift'] = null;
  private tipped: SimReadout['tipReason'] = null;
  private tipTime: number | null = null;
  private peakLoadFactor = 0;
  private finished = false;
  private brakeActive = false;
  private scriptSteerDone = false;

  constructor(R: Rapier, spec: SimSpec, opts: SimOptions = {}) {
    this.spec = spec;
    this.config = { ...DEFAULT_CONFIG, ...opts.config };
    this.controls = { ...DEFAULT_CONTROLS, ...opts.controls };
    this.script = opts.script ?? {};
    this.bodyIds = spec.bodyIds;
    const c = this.config;
    const world = (this.world = new R.World({ x: 0, y: 0, z: -G }));
    world.timestep = DT;
    // Solver effort: a knuckle is a light body (pitch inertia of a few hundredths of a kg·m², less than a locked
    // wheel's spin inertia) closing a constraint loop chassis -> kingpin -> knuckle -> wheel hinge -> ground. With few
    // internal PGS iterations that loop does not converge and the whole cart rocks on its wheels. 16 internal
    // iterations settle it for any plausible knuckle.
    world.numSolverIterations = 8;
    world.numInternalPgsIterations = 16;
    world.integrationParameters.contact_natural_frequency = 60;

    // Ground orientation: pitch (downhill) about Y, side slope about the cart's own X axis first.
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
    const steer0 = Math.max(-this.lockRad(), Math.min(this.lockRad(), rad(c.initialSteerDeg)));
    this.steerCmdRad = steer0;
    const sol0 = solveSteer(spec.ack, deg(steer0));
    const place = (id: SimBodyId): { pos: Vec3; rot: Quat } => {
      const cg = spec.bodies[id]!.cgM;
      // Which kingpin and angle (rad) this body turns about.
      let pivot: Vec3 | null = null;
      let ang = 0;
      if (id === 'steer-L' || id === 'wheel-FL') { pivot = spec.kingpinsM.L; ang = rad(sol0.leftDeg); }
      else if (id === 'steer-R' || id === 'wheel-FR') { pivot = spec.kingpinsM.R; ang = rad(sol0.rightDeg); }
      const qz = qAxisAngle('z', ang);
      const local = pivot ? add(pivot, qRotate(qz, sub(cg, pivot))) : cg;
      return { pos: qRotate(Rg, local), rot: qMul(Rg, qz) };
    };
    const v0 = c.initialSpeedMph / MPH_PER_MS;
    const vel = qRotate(Rg, [v0, 0, 0]);
    for (const id of this.bodyIds) {
      const b = spec.bodies[id]!;
      const pl = place(id);
      const desc = R.RigidBodyDesc.dynamic()
        .setTranslation(...pl.pos).setRotation(pl.rot).setCanSleep(false)
        .setAdditionalMassProperties(b.massKg, { x: 0, y: 0, z: 0 }, { x: b.inertiaPrincipal[0], y: b.inertiaPrincipal[1], z: b.inertiaPrincipal[2] }, b.inertiaFrame)
        .setLinvel(...vel);
      const rb = world.createRigidBody(desc);
      this.bodies[id] = rb;
      this.cgIn[id] = scale(b.cgM, 1 / M_PER_IN);
      if (id.startsWith('wheel')) {
        const w = qRotate(Rg, [0, v0 / spec.wheelRadiusM, 0]);
        rb.setAngvel({ x: w[0], y: w[1], z: w[2] }, true);
        this.wheelCols[id as WheelId] = world.createCollider(
          R.ColliderDesc.ball(spec.wheelRadiusM).setDensity(0).setFriction(c.frictionMu)
            .setFrictionCombineRule(R.CoefficientCombineRule.Max).setRestitution(0)
            .setCollisionGroups(IG(GRP_WHEEL, GRP_GROUND)),
          rb,
        );
      }
    }
    const sp = this.bodies.chassis.translation();
    this.startPos = [sp.x, sp.y, sp.z];

    // Hull colliders (mass 0: the mass comes from the part list).
    const addHull = (id: 'chassis' | 'steer-L' | 'steer-R', set: Set<number>) => {
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
    addHull('steer-L', this.hullSteer);
    addHull('steer-R', this.hullSteer);

    // ── joints ──
    const loc = (id: SimBodyId, p: Vec3) => {
      const o = sub(p, spec.bodies[id]!.cgM);
      return { x: o[0], y: o[1], z: o[2] };
    };
    // Left-wheel angle range of the mode: tow = -outer..+inner, ride = -8..+inner(8.55); the right wheel is the mirror.
    const lim = this.leftLimitsRad();
    const mk = (side: 'L' | 'R') => {
      const kp = spec.kingpinsM[side];
      const kid: SimBodyId = side === 'L' ? 'steer-L' : 'steer-R';
      const j = R.JointData.revolute(loc('chassis', kp), loc(kid, kp), { x: 0, y: 0, z: 1 });
      j.limitsEnabled = true;
      const [lo, hi] = side === 'L' ? [lim.min, lim.max] : [-lim.max, -lim.min];
      j.limits = [lo, hi];
      const joint = world.createImpulseJoint(j, this.bodies.chassis, this.bodies[kid], true) as Joint;
      joint.setLimits(lo, hi);
      joint.configureMotorModel(R.MotorModel.ForceBased);
      return joint;
    };
    this.kpL = mk('L');
    this.kpR = mk('R');
    this.tongueTable = this.buildTongueTable();
    for (const id of WHEEL_IDS) {
      const parent: SimBodyId = id === 'wheel-FL' || id === 'wheel-FR' ? (id === 'wheel-FL' ? 'steer-L' : 'steer-R') : 'chassis';
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

  /** The steering lock of the control mode, rad: the INNER wheel angle at the tow or ride stop. */
  lockRad(): number {
    return this.config.mode === 'ride' ? this.spec.rideLockRad : this.spec.lockRad;
  }

  /** Left-knuckle angle range of the control mode (rad): turning right the left wheel is the outer one. */
  private leftLimitsRad(): { min: number; max: number } {
    const a = this.spec.ack;
    const inner = this.lockRad();
    const outer = rad(solveSteer(a, -deg(inner)).leftDeg);
    return { min: outer, max: inner };
  }

  /** Inner-wheel angle (deg) -> tongue yaw table, for the inverse map `solveFromTongue` without a bisection per step. */
  private buildTongueTable(): Array<{ t: number; s: number }> {
    const a = this.spec.ack;
    const out: Array<{ t: number; s: number }> = [];
    const top = Math.ceil(deg(this.spec.lockRad)) + 2;
    for (let s = 0; s <= top; s += 0.5) {
      const sol = solveSteer(a, s);
      if (!sol.ok) break;
      out.push({ s, t: sol.tongueDeg });
    }
    return out;
  }

  private innerFromTongue(tongueDeg: number): number {
    const tb = this.tongueTable;
    const a = Math.abs(tongueDeg);
    let out = tb[tb.length - 1].s;
    for (let i = 1; i < tb.length; i++) {
      if (a <= tb[i].t) {
        const f = (a - tb[i - 1].t) / Math.max(1e-9, tb[i].t - tb[i - 1].t);
        out = tb[i - 1].s + f * (tb[i].s - tb[i - 1].s);
        break;
      }
    }
    return Math.sign(tongueDeg) * out;
  }

  private solveCached(cmdDeg: number): SteerSolution {
    if (!this.lastSol || this.lastSol.cmd !== cmdDeg) this.lastSol = { cmd: cmdDeg, sol: solveSteer(this.spec.ack, cmdDeg) };
    return this.lastSol.sol;
  }

  /** Brake torque per wheel (N·m) plus rolling resistance, as the wheel-joint motor limit. */
  private applyMotors(): void {
    const r = this.spec.wheelRadiusM;
    const crr = this.config.rollingResistance;
    const brakeN = this.brakeActive ? this.controls.brakeLbf * N_PER_LBF : 0;
    const frontShare = this.spec.frontBrakeShare;
    for (const id of WHEEL_IDS) {
      const rear = id === 'wheel-RL' || id === 'wheel-RR';
      const brakeNm = (brakeN * r * (rear ? 1 - frontShare : frontShare)) / 2;
      this.wheelJoints[id].setMotorMaxForce(this.config.wheelsLocked ? 1e6 : crr * this.loadN[id] * r + brakeNm);
    }
    this.applySteering();
  }

  /** Two knuckle motors: tow bridle (tongue follows the rope), angle hold, or the ride centering spring. */
  private applySteering(): void {
    const lock = this.lockRad();
    let cmdRad: number;
    let K = ACK_STEER_K;
    let C = ACK_STEER_C;
    if (this.controls.steerMode === 'angle') {
      const target = Math.max(-lock, Math.min(lock, rad(this.controls.steerAngleDeg)));
      const maxStep = rad(STEER_RATE_DEG_S) * DT;
      this.steerCmdRad += Math.max(-maxStep, Math.min(maxStep, target - this.steerCmdRad));
      cmdRad = this.steerCmdRad;
    } else if (this.config.mode === 'ride') {
      // Hands off the stick: the centering spring holds the knuckles straight (weak, so a rider's pull overcomes it).
      this.steerCmdRad = 0;
      cmdRad = 0;
      K = RIDE_CENTER_K;
      C = RIDE_CENTER_C;
    } else {
      // Tow bridle: the tongue yaw follows the rope direction (first-order, slew limited), clamped to the yaw stop.
      let target = this.tongueDeg;
      if (this.controls.pullLbf > 0) {
        const a = deg(rad(this.controls.pullAngleDeg + this.controls.pullTurnDegPerS * this.t));
        const f = qRotate(this.bodies.chassis.rotation() as Quat, [1, 0, 0]);
        const yaw = deg(Math.atan2(f[1], f[0]));
        target = ((((a - yaw) % 360) + 540) % 360) - 180;
      }
      const maxT = this.spec.tongueMaxYawDeg;
      target = Math.max(-maxT, Math.min(maxT, target));
      const step = (target - this.tongueDeg) * (1 - Math.exp(-DT / TONGUE_TAU_S));
      const lim = TONGUE_RATE_DEG_S * DT;
      this.tongueDeg += Math.max(-lim, Math.min(lim, step));
      cmdRad = Math.max(-lock, Math.min(lock, rad(this.innerFromTongue(this.tongueDeg))));
      this.steerCmdRad = cmdRad;
    }
    const sol = this.solveCached(Math.round(deg(cmdRad) * 1e4) / 1e4);
    this.kpL.configureMotorPosition(rad(sol.leftDeg), K, C);
    this.kpR.configureMotorPosition(rad(sol.rightDeg), K, C);
    this.kpL.setMotorMaxForce(1e6);
    this.kpR.setMotorMaxForce(1e6);
  }

  step(): void {
    if (this.finished) return;
    const c = this.config;
    // Scripted events.
    if (this.script.brakeAtS !== undefined && this.t >= this.script.brakeAtS) this.controls.brakeOn = true;
    if (this.script.steerAtS !== undefined && !this.scriptSteerDone && this.t >= this.script.steerAtS) {
      this.scriptSteerDone = true;
      this.controls.steerMode = 'angle';
      this.controls.steerAngleDeg = deg(this.lockRad());
    }
    this.brakeActive = this.controls.brakeOn;
    this.applyMotors();

    // Pull force: at the tongue hinge on the chassis (tow mode only: the tongue is off in ride mode). The rope is the pull direction in the world, not a body-fixed one.
    const sb = this.bodies.chassis;
    sb.resetForces(true);
    sb.resetTorques(true); // addForceAtPoint also accumulates a persistent torque
    if (this.controls.pullLbf > 0 && this.config.mode !== 'ride') {
      const a = rad(this.controls.pullAngleDeg + this.controls.pullTurnDegPerS * this.t);
      const F = this.controls.pullLbf * N_PER_LBF;
      const local = sub(this.spec.tongueHingeM, this.spec.bodies.chassis!.cgM);
      const t = sb.translation();
      const w = add([t.x, t.y, t.z], qRotate(sb.rotation() as Quat, local));
      sb.addForceAtPoint({ x: F * Math.cos(a), y: F * Math.sin(a), z: 0 }, { x: w[0], y: w[1], z: w[2] }, true);
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
    this.steerScrape = false;
    for (const g of this.groundCols) {
      this.world.contactPairsWith(g, (other) => {
        const chassisHit = this.hullChassis.has(other.handle);
        if (!chassisHit && !this.hullSteer.has(other.handle)) return;
        this.world.contactPair(g, other, (m) => {
          let imp = 0;
          for (let i = 0, n = m.numContacts(); i < n; i++) imp += m.contactImpulse(i);
          if (imp > 1e-3) {
            if (chassisHit) this.hullTouch = true;
            else this.steerScrape = true;
          }
        });
      });
    }
  }
  private hullTouch = false;
  /** The steer body (axle beam, tongue) touches the ground: reported, but not by itself a tip-over. */
  steerScrape = false;

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

  /** Angle between the cart's up axis and the ground normal. */
  rollDeg(): number {
    const up = qRotate(this.bodies.chassis.rotation() as Quat, [0, 0, 1]);
    const n = qRotate(this.groundRotation(), [0, 0, 1]);
    return deg(Math.acos(Math.max(-1, Math.min(1, dot(up, n)))));
  }

  /** Knuckle angle relative to the chassis, degrees (+ = CCW). */
  private relDeg(id: SimBodyId): number {
    const rel = qMul(qConj(this.bodies.chassis.rotation() as Quat), this.bodies[id].rotation() as Quat);
    const x = qRotate(rel, [1, 0, 0]); // heading of the body's forward axis in the chassis frame: robust to a little pitch and roll
    return deg(Math.atan2(x[1], x[0]));
  }

  /** Left and right knuckle angles (Ackermann sim), degrees, + = turn left. */
  knuckleDeg(): { L: number; R: number } {
    return { L: this.relDeg('steer-L'), R: this.relDeg('steer-R') };
  }

  /** Steer angle, degrees, + = left. Ackermann: the INNER wheel angle (the larger knuckle angle). */
  steerDeg(): number {
    const k = this.knuckleDeg();
    return Math.abs(k.L) >= Math.abs(k.R) ? k.L : k.R;
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
      steerDeg: this.steerDeg(),
      knuckleDeg: this.knuckleDeg(),
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
    };
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
    // Visual-only bodies: the analytic pose at the measured steer angle, carried by the chassis.
    const ch = out.get('chassis')!;
    const pm = poseMatrices(this.spec.ack, solveSteer(this.spec.ack, this.steerDeg()));
    out.set('tie-rod', multiply(ch, pm['tie-rod']));
    out.set('bellcrank', multiply(ch, pm.bellcrank));
    out.set('drag-link', multiply(ch, pm['drag-link']));
    out.set('tongue-link', multiply(ch, pm['tongue-link']));
    out.set('tongue', multiply(ch, pm.tongue));
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
