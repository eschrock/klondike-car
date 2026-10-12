/** Sim configuration, controls and scenario presets (BRIEF §8). Plain data: no physics engine, no DOM. */

/** Set at reset: terrain and initial conditions. */
export interface SimConfig {
  /** Downhill slope along the direction of travel, degrees (0-20). */
  slopeDeg: number;
  /** Side slope / camber, degrees; positive raises the left side (the sled tips toward the right). */
  sideSlopeDeg: number;
  /** Tilt-table: the side slope keeps rising from `sideSlopeDeg` at this rate (deg/s). 0 = fixed. */
  tiltRateDegPerS: number;
  /** Tire-ground friction coefficient. */
  frictionMu: number;
  /** Rolling resistance coefficient (pneumatic on firm dirt ≈ 0.05). */
  rollingResistance: number;
  /** All four wheels held against rolling (chocked): the tilt table is a static test. */
  wheelsLocked: boolean;
  /** Initial speed along the ground, mph. */
  initialSpeedMph: number;
  root: boolean;
  /** Root position from the rear axle, inches along the ground. */
  rootAtIn: number;
  curb: boolean;
  curbAtIn: number;
}

/** Live controls: may change while the sim runs. */
export interface SimControls {
  /** Pull force at the tongue tie on the front axle, lbf (horizontal). */
  pullLbf: number;
  /** Pull direction: the way the puller walks, degrees from the starting heading (+ = to the left). With `pullFollowsAxle` it is measured from the axle's own heading instead. */
  pullAngleDeg: number;
  /** The pull direction is measured from the front axle's heading (the puller keeps the rope along the tongue), not fixed in the world. */
  pullFollowsAxle: boolean;
  /** Front-axle steer angle, degrees about the kingpin (+ = left turn), clamped to the lock. It is the starting angle of a run; with `steerHold` it is also held live. */
  steerDeg: number;
  /** A servo holds the front axle at `steerDeg` (a steering demo); off, the axle swings free between the stops and the pull steers it (D-56). */
  steerHold: boolean;
  /** The puller circles: the pull direction turns at this rate (deg/s, + = left). 0 = walks straight. */
  pullTurnDegPerS: number;
  brakeOn: boolean;
  /** Total brake force at the tire contact patches of the two rear wheels, lbf. */
  brakeLbf: number;
}

export const DEFAULT_CONFIG: SimConfig = {
  slopeDeg: 0, sideSlopeDeg: 0, tiltRateDegPerS: 0, frictionMu: 0.7, rollingResistance: 0.05,
  wheelsLocked: false, initialSpeedMph: 0, root: false, rootAtIn: 120, curb: false, curbAtIn: 120,
};

export const DEFAULT_CONTROLS: SimControls = {
  pullLbf: 0, pullAngleDeg: 0, pullFollowsAxle: false, steerDeg: 0, steerHold: false, pullTurnDegPerS: 0, brakeOn: false, brakeLbf: 60,
};

export type RiderCase = 'none' | 'operating' | 'goal' | 'custom';

export interface Scenario {
  id: string;
  label: string;
  blurb: string;
  config: Partial<SimConfig>;
  controls: Partial<SimControls>;
  /** Brake switches on this many seconds after the start (braking event). */
  brakeAtS?: number;
  /** Stop the run this many seconds after the start. */
  endAtS?: number;
}

export type SimScript = Pick<Scenario, 'brakeAtS' | 'endAtS'>;

export const SCENARIOS: Scenario[] = [
  {
    id: 'free', label: 'Free play', blurb: 'Flat ground, rest start. Set the controls yourself.',
    config: {}, controls: {},
  },
  {
    id: 'downhill', label: 'Downhill roll', blurb: 'Released from rest on a downhill slope, brakes off. Watch speed build, then try the brake.',
    config: { slopeDeg: 10 }, controls: { brakeOn: false }, endAtS: 20,
  },
  {
    id: 'tilt', label: 'Side-slope tilt table', blurb: 'The ground tips sideways at 2°/s with the wheels chocked and high friction, μ 1.5 (the sled must tip before it slides) until a wheel lifts.',
    config: { sideSlopeDeg: 0, tiltRateDegPerS: 2, frictionMu: 1.5, wheelsLocked: true }, controls: { brakeOn: false }, endAtS: 30,
  },
  {
    id: 'bump', label: 'Bump at jogging pace', blurb: 'Rolls at 5 mph (jogging pace, D-53) into a 2" root (the hard-hit case, D-50), no curb. Look for the load spike and any wheel lift. Curbs are not a design load (the engine still has one under "3 in curb").',
    config: { initialSpeedMph: 5, root: true, rootAtIn: 100 }, controls: {}, endAtS: 5,
  },
  {
    id: 'turn', label: 'Turning circle', blurb: 'The front axle is held at full lock (20° each way) while the sled is pulled along the tongue at about walking pace. The sled arcs; the panel reports the turning radius it achieved (the rear axle center\'s circle) against the geometric radius.',
    config: { initialSpeedMph: 3 }, controls: { steerDeg: 20, steerHold: true, pullLbf: 20, pullFollowsAxle: true }, endAtS: 14,
  },
  {
    id: 'brake', label: 'Braking event', blurb: 'Rolling at 6 mph down a 5° slope, rear brake applied at 1 s (the only brake, D-53/D-55).',
    config: { slopeDeg: 5, initialSpeedMph: 6 }, controls: { brakeOn: false, brakeLbf: 60 }, brakeAtS: 1, endAtS: 10,
  },
];
