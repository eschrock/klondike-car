/** Sim configuration, controls and scenario presets (BRIEF §8). Plain data: no physics engine, no DOM. */

/** Set at reset: terrain and initial conditions. */
export interface SimConfig {
  /** Downhill slope along the direction of travel, degrees (0-20). */
  slopeDeg: number;
  /** Side slope / camber, degrees; positive raises the left side (the cart tips toward the right). */
  sideSlopeDeg: number;
  /** Tilt-table: the side slope keeps rising from `sideSlopeDeg` at this rate (deg/s). 0 = fixed. */
  tiltRateDegPerS: number;
  /** Tire-ground friction coefficient. */
  frictionMu: number;
  /** Rolling resistance coefficient (pneumatic on firm dirt ≈ 0.05). */
  rollingResistance: number;
  /** All four wheels held against rolling (chocked): the tilt table is a static test. */
  wheelsLocked: boolean;
  /** Phase 3b control mode: 'tow' (tongue, lock 35.5 inner) or 'ride' (stick, lock 8 outer, centering spring). Only the Ackermann front end has a ride mode. */
  mode: 'tow' | 'ride';
  /** Initial steer angle, degrees (+ = left; the INNER wheel in the Ackermann sim); hold it with steerMode 'angle'. */
  initialSteerDeg: number;
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
  /** Pull force at the tongue tip, lbf (horizontal). */
  pullLbf: number;
  /** Pull direction: the way the puller walks, degrees from the starting heading (+ = to the left). */
  pullAngleDeg: number;
  /** The puller circles: the pull direction turns at this rate (deg/s, + = left). 0 = walks straight. */
  pullTurnDegPerS: number;
  /**
   * 'bridle': the steer body is free and the pull force at the tongue tip steers it.
   * 'angle': a stiff motor holds the steer body at `steerAngleDeg` (clamped to the lock): for the turning scenarios.
   */
  steerMode: 'bridle' | 'angle';
  steerAngleDeg: number;
  brakeOn: boolean;
  /** Total brake force at the tire contact patches of the two rear wheels, lbf. */
  brakeLbf: number;
}

export const DEFAULT_CONFIG: SimConfig = {
  slopeDeg: 0, sideSlopeDeg: 0, tiltRateDegPerS: 0, frictionMu: 0.7, rollingResistance: 0.05,
  wheelsLocked: false, mode: 'tow', initialSteerDeg: 0, initialSpeedMph: 0, root: false, rootAtIn: 120, curb: false, curbAtIn: 120,
};

export const DEFAULT_CONTROLS: SimControls = {
  pullLbf: 0, pullAngleDeg: 0, pullTurnDegPerS: 0, steerMode: 'bridle', steerAngleDeg: 0, brakeOn: false, brakeLbf: 60,
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
  /** Steering switches to full lock (angle mode, to the left) this many seconds after the start. */
  steerAtS?: number;
  /** Stop the run this many seconds after the start. */
  endAtS?: number;
}

export type SimScript = Pick<Scenario, 'brakeAtS' | 'steerAtS' | 'endAtS'>;

export const SCENARIOS: Scenario[] = [
  {
    id: 'free', label: 'Free play', blurb: 'Flat ground, rest start. Set the controls yourself.',
    config: {}, controls: {},
  },
  {
    id: 'downhill', label: 'Downhill roll', blurb: 'Released from rest on a downhill slope, brakes off. Watch speed build, then try the brake.',
    config: { slopeDeg: 10 }, controls: { steerMode: 'angle', steerAngleDeg: 0, brakeOn: false }, endAtS: 20,
  },
  {
    id: 'tilt', label: 'Side-slope tilt table', blurb: 'The ground tips sideways at 2°/s with the wheels chocked and high friction (the cart must tip before it slides) until a wheel lifts. Use the steer slider (lock-hold) to see the lock cases.',
    config: { sideSlopeDeg: 0, tiltRateDegPerS: 2, frictionMu: 2, wheelsLocked: true }, controls: { brakeOn: false }, endAtS: 30,
  },
  {
    id: 'bump', label: 'Bump at 10 mph', blurb: 'Rolls at 10 mph into a 2" root (the hard-hit case, D-50), no curb. Look for the load spike and any wheel lift. Curbs are not a design load (the engine still has one under "3 in curb").',
    config: { initialSpeedMph: 10, root: true, rootAtIn: 100 }, controls: { steerMode: 'angle', steerAngleDeg: 0 }, endAtS: 5,
  },
  {
    id: 'turn', label: 'Full-lock turn at speed', blurb: 'Rolling at 8 mph, the steering goes to full lock. The tires alone supply the side force (no rope help). Raise the start speed or the friction to find where a wheel lifts or it tips (≈12 mph at μ 1.5; at μ 0.7 it slides first).',
    config: { initialSpeedMph: 8 }, controls: { steerMode: 'angle', steerAngleDeg: 0 }, steerAtS: 0.5, endAtS: 8,
  },
  {
    id: 'brake', label: 'Braking event', blurb: 'Rolling at 6 mph down a 5° slope, rear brakes applied at 1 s.',
    config: { slopeDeg: 5, initialSpeedMph: 6 }, controls: { steerMode: 'angle', steerAngleDeg: 0, brakeOn: false, brakeLbf: 60 }, brakeAtS: 1, endAtS: 10,
  },
  {
    id: 'ride-downhill', label: 'Ride downhill 8°, 10 mph', blurb: 'Ride mode (stick, centering spring): rolling at 10 mph down an 8° slope at μ 0.5; the rider brakes at 1 s with the brake force the rules assume (front and rear). The stick is centered, so the cart should stay straight.',
    config: { mode: 'ride', slopeDeg: 8, initialSpeedMph: 10, frictionMu: 0.5 }, controls: { steerMode: 'angle', steerAngleDeg: 0, brakeOn: false, brakeLbf: 130 }, brakeAtS: 1, endAtS: 8,
  },
];
