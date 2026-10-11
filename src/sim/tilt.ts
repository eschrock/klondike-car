/** Headless tilt-table run: raises the side slope slowly until the cart's support is down to a line (tip onset). */
import { createSim, type Sim, type SimReadout } from './core';
import type { SimSpec } from './spec';

export interface TiltResult {
  /** Side slope (degrees, magnitude) at the first wheel lift: the load-transfer warning. */
  firstLiftDeg: number | null;
  /** Side slope (degrees, magnitude) when a second wheel lifts: the cart is on a line and tips (the onset angle). */
  onsetDeg: number | null;
  readout: SimReadout;
  sim: Sim;
}

export interface TiltOptions {
  /** Steer angle held during the test, degrees (+ = left). */
  steerDeg?: number;
  /** 'right' raises the left side (tips to the right, positive slope); 'left' the reverse. */
  tipTo?: 'right' | 'left';
  rateDegPerS?: number;
  frictionMu?: number;
  wheelsLocked?: boolean;
  maxSeconds?: number;
}

/**
 * Tire-ground friction of the tilt table: high enough that the cart tips rather than slides (the static tip angle is about 50 degrees, tan 50 = 1.2), but not
 * so high that the locked steered inner wheel sticks and shifts load abruptly (at 2.0 the 35.5 degree left-lock case lifted its second wheel 8 degrees early).
 */
export const TILT_FRICTION_MU = 1.5;

export async function runTiltOnset(spec: SimSpec, o: TiltOptions = {}): Promise<TiltResult> {
  const rate = (o.rateDegPerS ?? 2) * (o.tipTo === 'left' ? -1 : 1);
  const steer = o.steerDeg ?? 0;
  const sim = await createSim(spec, {
    config: { tiltRateDegPerS: rate, frictionMu: o.frictionMu ?? TILT_FRICTION_MU, wheelsLocked: o.wheelsLocked ?? true, initialSteerDeg: steer },
    controls: { steerMode: 'angle', steerAngleDeg: steer },
  });
  const steps = Math.round((o.maxSeconds ?? 60) * 240);
  for (let i = 0; i < steps; i++) {
    sim.step();
    const r = sim.readout();
    if (r.secondLift || r.tipped) break;
  }
  const r = sim.readout();
  return {
    firstLiftDeg: r.firstLift ? Math.abs(r.firstLift.groundSideSlopeDeg) : null,
    onsetDeg: r.secondLift ? Math.abs(r.secondLift.groundSideSlopeDeg) : null,
    readout: r,
    sim,
  };
}
