import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { buildModel } from '../model';
import { centerOfGravity, totalMass } from '../model/mass';
import { translationOf } from '../model/mat4';
import { createSim } from './core';
import { eigenSym3 } from './math';
import { KG_PER_LB, M_PER_IN } from './massprops';
import { SCENARIOS } from './scenarios';
import { buildSimSpec, WHEEL_IDS } from './spec';
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
    expect(spec.bodies.steer.massKg).toBeGreaterThan(1);
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

  it('a root and a curb at speed spike the wheel loads and lift a wheel', async () => {
    const sc = SCENARIOS.find((s) => s.id === 'bump')!;
    const sim = await createSim(spec, { config: sc.config, controls: sc.controls, script: sc });
    for (let i = 0; i < 240 * 3; i++) sim.step();
    const r = sim.readout();
    expect(r.peakLoadFactor).toBeGreaterThan(2);
    expect(r.firstLift).not.toBeNull();
  });

  it('poses every model rigid body relative to its build pose', async () => {
    const sim = await createSim(spec);
    const poses = sim.poses();
    for (const id of ['chassis', 'steer', 'wheel-FL', 'wheel-RR', 'rider', 'cargo'] as const) expect(poses.get(id)).toHaveLength(16);
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
 * For straight steering that is the familiar atan((T/2)/h) with the CG on the centreline.
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
