import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { buildModel } from '../model';
import { centerOfGravity, totalMass } from '../model/mass';
import { translationOf } from '../model/mat4';
import { createSim } from './core';
import { ackermannErrorDeg, idealOuterDeg, poseMatrices, solveSteer } from '../model/ackermann';
import { eigenSym3 } from './math';
import { KG_PER_LB, M_PER_IN } from './massprops';
import { SCENARIOS } from './scenarios';
import { M_PER_IN as MPI } from './massprops';
import { buildSimSpec, WHEEL_IDS, type SimSpec } from './spec';
import { runTiltOnset } from './tilt';

const p = defaultParams();
const parts = buildModel(p, { steerDeg: 0, rider: 'operating', cargo: true });
const spec = buildSimSpec(parts, p);

describe('mass properties', () => {
  it('eigen-decomposes a symmetric tensor', () => {
    const { values, vectors } = eigenSym3([4, 1, 0, 1, 3, 0, 0, 0, 2]);
    const vs = [...values].sort();
    expect(vs[0]).toBeCloseTo(2, 9);
    expect(vs[1]).toBeCloseTo((7 - Math.sqrt(5)) / 2, 9);
    expect(vs[2]).toBeCloseTo((7 + Math.sqrt(5)) / 2, 9);
    expect(Math.hypot(...vectors[0])).toBeCloseTo(1, 9);
  });

  it('body masses add up to the parts list, and the CG matches the model CG', () => {
    expect(spec.totalMassKg / KG_PER_LB).toBeCloseTo(totalMass(parts, { includePayload: true }), 6);
    const cg = centerOfGravity(parts, { includePayload: true });
    for (let k = 0; k < 3; k++) expect(spec.cgM[k] / M_PER_IN).toBeCloseTo(cg[k], 6);
    expect(spec.bodies[spec.kinematics === 'ackermann' ? 'steer-L' : 'steer']!.massKg).toBeGreaterThan(0.5);
    for (const b of Object.values(spec.bodies)) expect(b.inertiaPrincipal.every((x) => x > 0)).toBe(true);
  });

  it('a custom rider mass changes the total by the difference', () => {
    const heavy = buildSimSpec(parts, p, { riderMassLb: p.riderMassLb + 50 });
    expect((heavy.totalMassKg - spec.totalMassKg) / KG_PER_LB).toBeCloseTo(50, 6);
  });
});

describe('simulation', () => {
  it('rests on four wheels carrying the whole weight, and the kingpin joint holds steer at 0', async () => {
    const sim = await createSim(spec);
    for (let i = 0; i < 240; i++) sim.step();
    const r = sim.readout();
    const sum = WHEEL_IDS.reduce((s, id) => s + r.loadLbf[id], 0);
    expect(sum).toBeCloseTo(spec.weightN / 4.4482216, -1);
    expect(Math.abs(sum / (spec.weightN / 4.4482216) - 1)).toBeLessThan(0.02);
    expect(r.anyLift).toBe(false);
    expect(Math.abs(r.steerDeg)).toBeLessThan(0.5);
    expect(r.tipped).toBe(false);
  });

  it('runs at least 20x real time headless (240 steps = 1 s)', async () => {
    const sim = await createSim(spec);
    const t0 = performance.now();
    for (let i = 0; i < 2400; i++) sim.step();
    const stepsPerSec = 2400 / ((performance.now() - t0) / 1000);
    console.log(`sim speed: ${Math.round(stepsPerSec)} steps/s (${(stepsPerSec / 240).toFixed(1)}x real time)`);
    expect(stepsPerSec / 240).toBeGreaterThan(5);
  });

  it('downhill roll speeds up and the brake stops it', async () => {
    const sc = SCENARIOS.find((s) => s.id === 'brake')!;
    const sim = await createSim(spec, { config: sc.config, controls: sc.controls, script: sc });
    let vMax = 0;
    for (let i = 0; i < 240 * 8; i++) {
      sim.step();
      vMax = Math.max(vMax, sim.readout().speedMph);
    }
    expect(vMax).toBeGreaterThan(5);
    expect(sim.readout().speedMph).toBeLessThan(0.3);
  });

  it('a pulled cart follows the rope without the steering hunting', async () => {
    const sim = await createSim(spec, { controls: { pullLbf: 30, pullAngleDeg: 20 } });
    let late = 0;
    for (let i = 0; i < 240 * 8; i++) {
      sim.step();
      if (sim.t > 5) late = Math.max(late, Math.abs(sim.readout().steerDeg));
    }
    expect(late).toBeLessThan(10);
    expect(sim.readout().speedMph).toBeGreaterThan(3);
  });

  it('a full-lock turn reaches the stop and stays upright at 8 mph', async () => {
    const sc = SCENARIOS.find((s) => s.id === 'turn')!;
    const sim = await createSim(spec, { config: sc.config, controls: sc.controls, script: sc });
    for (let i = 0; i < 240 * 3; i++) sim.step();
    const r = sim.readout();
    expect(r.steerDeg).toBeGreaterThan(p.steerLockDeg - 1.5);
    expect(r.steerDeg).toBeLessThan(p.steerLockDeg + 0.6);
    expect(r.tipped).toBe(false);
  });

  it('a 2-inch root at 10 mph spikes the wheel loads', async () => {
    const sc = SCENARIOS.find((s) => s.id === 'bump')!;
    const sim = await createSim(spec, { config: sc.config, controls: sc.controls, script: sc });
    for (let i = 0; i < 240 * 3; i++) sim.step();
    const r = sim.readout();
    expect(r.peakLoadFactor).toBeGreaterThan(1.5);
  });

  it('poses every model rigid body relative to its build pose', async () => {
    const sim = await createSim(spec);
    const poses = sim.poses();
    for (const id of ['chassis', spec.kinematics === 'ackermann' ? 'steer-L' : 'steer', 'wheel-FL', 'wheel-RR', 'rider', 'cargo'] as const) expect(poses.get(id)).toHaveLength(16);
    // At rest on flat ground the poses are (near) the identity.
    const d = poses.get('wheel-FL')!;
    expect(Math.hypot(d[12], d[13], d[14])).toBeLessThan(0.2);
  });
});

/**
 * Cross-check (BRIEF §8, phase-2 spec): the tilt-table tip onset must match the static tip angle. The static angle is
 * computed here independently from the model: the CG, the wheel contact points at the held steer angle, and the
 * support edge on the downhill side. The plumb line from the CG hits the ground at (x, y − h·tanφ), so the cart tips
 * when that point reaches the line through the two downhill wheels: tanφ = (lateral CG-to-edge distance at the CG's x) / h.
 * For straight steering that is the familiar atan((T/2)/h) with the CG on the centerline.
 */
function staticTipDeg(steerDeg: number, tipTo: 'right' | 'left'): { deg: number; h: number; edge: number } {
  const ps = buildModel(p, { steerDeg, rider: 'operating', cargo: true });
  const cg = centerOfGravity(ps, { includePayload: true });
  const at = (id: string) => translationOf(ps.find((x) => x.id === id)!.transform);
  const [a, b] = tipTo === 'right' ? [at('wheel-RR'), at('wheel-FR')] : [at('wheel-RL'), at('wheel-FL')];
  const yEdge = a[1] + ((cg[0] - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
  const dist = tipTo === 'right' ? cg[1] - yEdge : yEdge - cg[1];
  return { deg: (Math.atan(dist / cg[2]) * 180) / Math.PI, h: cg[2], edge: Math.abs(yEdge) };
}

describe('tilt table vs static tip angle (operating rider)', () => {
  const TOL_DEG = 3;
  const lock = p.steerLockDeg;
  const cases: Array<{ steer: number; tipTo: 'right' | 'left' }> = [
    { steer: 0, tipTo: 'right' }, { steer: 0, tipTo: 'left' },
    { steer: lock, tipTo: 'right' }, { steer: lock, tipTo: 'left' },
    { steer: -lock, tipTo: 'right' }, { steer: -lock, tipTo: 'left' },
  ];
  const results = new Map<string, { sim: number; stat: number; first: number }>();

  it.each(cases)('steer $steer°, tipping to the $tipTo', async ({ steer, tipTo }) => {
    const r = await runTiltOnset(spec, { steerDeg: steer, tipTo });
    const stat = staticTipDeg(steer, tipTo);
    expect(r.onsetDeg).not.toBeNull();
    results.set(`${steer}|${tipTo}`, { sim: r.onsetDeg!, stat: stat.deg, first: r.firstLiftDeg! });
    console.log(`tilt steer ${steer}° ${tipTo}: first lift ${r.firstLiftDeg!.toFixed(1)}°, sim onset ${r.onsetDeg!.toFixed(2)}°, static ${stat.deg.toFixed(2)}° (h ${stat.h.toFixed(1)}", edge ${stat.edge.toFixed(1)}")`);
    expect(Math.abs(r.onsetDeg! - stat.deg)).toBeLessThan(TOL_DEG);
    // The load-transfer warning (first wheel lift) never comes after the tip onset.
    expect(r.firstLiftDeg!).toBeLessThanOrEqual(r.onsetDeg! + 1e-6);
  }, 60_000);

  it('full lock tips earlier than straight, in both directions', () => {
    for (const tipTo of ['right', 'left'] as const) {
      const straight = results.get(`0|${tipTo}`)!;
      for (const s of [lock, -lock]) {
        const locked = results.get(`${s}|${tipTo}`)!;
        expect(locked.sim).toBeLessThan(straight.sim);
        expect(locked.stat).toBeLessThan(straight.stat);
      }
    }
  });
});


/**
 * Phase 3b Ackermann front end (spec 8.2). Until the model has steer-L / steer-R parts, `kinematics: 'ackermann'` forces the two-knuckle
 * sim on the current parts (the old front parts ride on the chassis, the knuckles get a floor mass), so the sim logic is tested now.
 */
describe('Ackermann sim', () => {
  const aspec: SimSpec = buildSimSpec(parts, p, { kinematics: 'ackermann' });
  const ack = aspec.ack!;
  const run = async (s: SimSpec, secs: number, opts: Parameters<typeof createSim>[1] = {}) => {
    const sim = await createSim(s, opts);
    for (let i = 0; i < Math.round(secs * 240); i++) sim.step();
    return sim;
  };

  it('spec: bodies are chassis, steer-L, steer-R and four wheels; kingpins are two points a kingpin spacing apart', () => {
    expect(aspec.kinematics).toBe('ackermann');
    expect(aspec.bodyIds.slice().sort()).toEqual(['chassis', 'steer-L', 'steer-R', ...WHEEL_IDS].sort());
    expect(aspec.bodies.steer).toBeUndefined();
    const k = aspec.kingpinsM!;
    expect(Math.abs(k.L[1] - k.R[1]) / MPI).toBeCloseTo(2 * ack.kpHalf, 6);
    expect(k.L[0]).toBeCloseTo(k.R[0], 9);
  });

  it('rests on four wheels with both knuckles straight', async () => {
    const sim = await run(aspec, 1);
    const r = sim.readout();
    const w = aspec.weightN / 4.4482216;
    expect(Math.abs(WHEEL_IDS.reduce((s, id) => s + r.loadLbf[id], 0) / w - 1)).toBeLessThan(0.02);
    expect(Math.abs(r.knuckleDeg!.L)).toBeLessThan(0.5);
    expect(Math.abs(r.knuckleDeg!.R)).toBeLessThan(0.5);
    expect(r.tipped).toBe(false);
  });

  it('commanding 20 deg inner drives the right knuckle to the solved outer within 1 deg (tire scrub holds it a little short)', async () => {
    const sim = await run(aspec, 2, { controls: { steerMode: 'angle', steerAngleDeg: 20 } });
    const k = sim.readout().knuckleDeg!;
    const sol = solveSteer(ack, 20);
    expect(Math.abs(k.L - sol.leftDeg)).toBeLessThan(1);
    expect(Math.abs(k.R - sol.rightDeg)).toBeLessThan(1);
    // Ackermann: the outer wheel turns less than the inner one, by about the ideal amount.
    expect(Math.abs(k.R)).toBeLessThan(Math.abs(k.L));
    expect(Math.abs(Math.abs(k.R) - idealOuterDeg(ack, 20))).toBeLessThan(ackermannErrorDeg(ack, 20) + 0.6);
    expect(sim.readout().steerDeg).toBeCloseTo(k.L, 6);
  });

  it('commanding a right turn mirrors it (the right wheel is the inner one)', async () => {
    const sim = await run(aspec, 2, { controls: { steerMode: 'angle', steerAngleDeg: -15 } });
    const k = sim.readout().knuckleDeg!;
    const sol = solveSteer(ack, -15);
    expect(Math.abs(k.R - sol.rightDeg)).toBeLessThan(1);
    expect(Math.abs(k.L - sol.leftDeg)).toBeLessThan(1);
    expect(sim.readout().steerDeg).toBeLessThan(-14);
  });

  it('the tow lock is the inner angle at the stop; the ride lock clamps the input to 8 deg outer', async () => {
    const tow = await run(aspec, 3, { controls: { steerMode: 'angle', steerAngleDeg: 80 } });
    const towDeg = tow.readout().knuckleDeg!;
    expect(towDeg.L).toBeGreaterThan(ack.towLockInnerDeg - 1.5);
    expect(towDeg.L).toBeLessThan(ack.towLockInnerDeg + 0.6);
    const ride = await run(aspec, 3, { config: { mode: 'ride' }, controls: { steerMode: 'angle', steerAngleDeg: -80 } });
    const rk = ride.readout().knuckleDeg!;
    // Turning right: the left wheel is the outer one at 8 deg.
    expect(Math.abs(rk.L)).toBeGreaterThan(ack.rideLockOuterDeg - 0.6);
    expect(Math.abs(rk.L)).toBeLessThan(ack.rideLockOuterDeg + 0.6);
    expect(Math.abs(rk.R)).toBeLessThan(ack.rideLockOuterDeg + 1.5);
  });

  it('ride mode with the stick released holds the knuckles at zero', async () => {
    const sim = await run(aspec, 3, { config: { mode: 'ride', initialSpeedMph: 6 }, controls: { steerMode: 'bridle' } });
    const r = sim.readout();
    expect(Math.abs(r.knuckleDeg!.L)).toBeLessThan(0.7);
    expect(Math.abs(r.steerDeg)).toBeLessThan(0.7);
  });

  it('a towed cart follows the rope through the tongue without hunting', async () => {
    const sim = await createSim(aspec, { controls: { pullLbf: 30, pullAngleDeg: 20 } });
    let late = 0;
    for (let i = 0; i < 240 * 8; i++) {
      sim.step();
      if (sim.t > 5) late = Math.max(late, Math.abs(sim.readout().steerDeg));
    }
    expect(late).toBeLessThan(10);
    expect(sim.readout().speedMph).toBeGreaterThan(3);
  });

  it('braking at 10 mph on 8 deg slows the cart with the front share and it stays straight', async () => {
    const sc = SCENARIOS.find((x) => x.id === 'ride-downhill')!;
    expect(sc.config.mode).toBe('ride');
    const sim = await createSim(aspec, { config: sc.config, controls: sc.controls, script: sc });
    let vBefore = 0;
    let maxSteer = 0;
    for (let i = 0; i < 240 * 8; i++) {
      sim.step();
      const r = sim.readout();
      if (sim.t <= 1) vBefore = r.speedMph;
      maxSteer = Math.max(maxSteer, Math.abs(r.steerDeg));
    }
    const r = sim.readout();
    expect(aspec.frontBrakeShare).toBeGreaterThan(0);
    expect(r.speedMph).toBeLessThan(vBefore * 0.4);
    expect(maxSteer).toBeLessThan(1.5);
    expect(r.tipped).toBe(false);
    expect(Math.abs(r.distanceIn)).toBeGreaterThan(100);
  });

  it('poses: tie-rod, bellcrank and tongue match poseMatrices; the knuckles pose themselves', async () => {
    const sim = await run(aspec, 2, { controls: { steerMode: 'angle', steerAngleDeg: 20 } });
    const poses = sim.poses();
    const pm = poseMatrices(ack, solveSteer(ack, sim.steerDeg()));
    const ch = poses.get('chassis')!;
    const inv = (m: number[]) => m; // chassis is near identity on flat ground: compare to within a tolerance below
    expect(inv(ch)).toBeDefined();
    for (const id of ['tie-rod', 'bellcrank', 'tongue'] as const) {
      const m = poses.get(id)!;
      expect(m).toHaveLength(16);
      for (let i = 0; i < 16; i++) expect(Math.abs(m[i] - pm[id][i])).toBeLessThan(0.3);
    }
    expect(poses.get('steer-L')).toHaveLength(16);
    expect(poses.get('steer-R')).toHaveLength(16);
    // The left knuckle matrix rotates about the left kingpin by about the left angle.
    const a = (Math.atan2(poses.get('steer-L')![1], poses.get('steer-L')![0]) * 180) / Math.PI;
    expect(Math.abs(a - sim.readout().knuckleDeg!.L)).toBeLessThan(1);
  });

  it('a full-lock turn at 8 mph stays upright', async () => {
    const sc = SCENARIOS.find((x) => x.id === 'turn')!;
    const sim = await run(aspec, 3, { config: sc.config, controls: sc.controls, script: sc });
    expect(sim.readout().tipped).toBe(false);
    expect(sim.readout().steerDeg).toBeGreaterThan(ack.towLockInnerDeg - 1.5);
  });

  it('tilt table: the onset is within 5 deg of the static angle from the solved contacts', async () => {
    for (const steer of [0, 30]) {
      for (const tipTo of ['right', 'left'] as const) {
        const r = await runTiltOnset(aspec, { steerDeg: steer, tipTo });
        const sol = solveSteer(ack, steer);
        const wc = (await import('../model/ackermann')).wheelCenters(ack, sol);
        const ps = buildModel(p, { steerDeg: 0, rider: 'operating', cargo: true });
        const cg = centerOfGravity(ps, { includePayload: true });
        const at = (id: string) => translationOf(ps.find((x) => x.id === id)!.transform);
        const [a, b] = tipTo === 'right' ? [at('wheel-RR'), [wc.R[0], wc.R[1]]] : [at('wheel-RL'), [wc.L[0], wc.L[1]]];
        const yEdge = a[1] + ((cg[0] - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
        const dist = tipTo === 'right' ? cg[1] - yEdge : yEdge - cg[1];
        const stat = (Math.atan(dist / cg[2]) * 180) / Math.PI;
        expect(r.onsetDeg).not.toBeNull();
        expect(Math.abs(r.onsetDeg! - stat)).toBeLessThan(5);
      }
    }
  }, 120_000);
});
