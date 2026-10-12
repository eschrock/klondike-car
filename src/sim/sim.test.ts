import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { buildModel } from '../model';
import { centerOfGravity, totalMass } from '../model/mass';
import { translationOf } from '../model/mat4';
import { createSim } from './core';
import { eigenSym3 } from './math';
import { KG_PER_LB, M_PER_IN } from './massprops';
import { DEFAULT_CONFIG, SCENARIOS } from './scenarios';
import { buildSimSpec, WHEEL_IDS } from './spec';
import { runTiltOnset } from './tilt';

const p = defaultParams();
const parts = buildModel(p, { rider: 'operating', cargo: true });
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
    // The wheels are real bodies, each a few pounds; the front axle assembly is a body of its own (D-56).
    for (const id of WHEEL_IDS) expect(spec.bodies[id]!.massKg).toBeGreaterThan(0.5);
    const axleLb = parts.filter((x) => x.body === 'front-axle').reduce((s, x) => s + x.massLb, 0);
    expect(spec.bodies['front-axle']!.massKg / KG_PER_LB).toBeCloseTo(axleLb, 6);
    expect(axleLb).toBeGreaterThan(5);
    for (const b of Object.values(spec.bodies)) expect(b.inertiaPrincipal.every((x) => x > 0)).toBe(true);
  });

  it('a custom rider mass changes the total by the difference', () => {
    const heavy = buildSimSpec(parts, p, { riderMassLb: p.riderMassLb + 50 });
    expect((heavy.totalMassKg - spec.totalMassKg) / KG_PER_LB).toBeCloseTo(50, 6);
  });
});


/** Turning-circle tests (D-56): the center radius of the rear axle at full lock is WB / tan(lock) = 120.9 in; the sim's pure-rolling wheels should land on it. */
const TURN_RADIUS_TOL = 0.03;

describe('simulation', () => {
  const run = async (secs: number, opts: Parameters<typeof createSim>[1] = {}, s = spec) => {
    const sim = await createSim(s, opts);
    for (let i = 0; i < Math.round(secs * 240); i++) sim.step();
    return sim;
  };
  const yawDeg = (sim: Awaited<ReturnType<typeof createSim>>) => {
    const m = sim.poses().get('chassis')!;
    return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  };

  it('spec: bodies are the chassis, the front axle and four wheels; the pull point is the tongue tie, on the front axle', () => {
    expect([...spec.bodyIds].sort()).toEqual(['chassis', 'front-axle', ...WHEEL_IDS].sort());
    expect(Object.keys(spec.bodies).sort()).toEqual(['chassis', 'front-axle', ...WHEEL_IDS].sort());
    expect(Object.keys(spec.hull)).toEqual(['chassis']);
    for (const k of ['swivelsM', 'casterWheelRadiusM']) expect(spec).not.toHaveProperty(k);
    expect(spec.wheelRadiusM / M_PER_IN).toBeCloseTo(p.wheelDiameterIn / 2, 6);
    expect(spec.steerLockDeg).toBe(p.steerLockDeg);
    // Wheels: front pair at the wheelbase on the front track, rear pair under the origin on the rear track.
    for (const [id, x, y] of [['wheel-FL', p.wheelbaseIn, p.frontTrackIn / 2], ['wheel-FR', p.wheelbaseIn, -p.frontTrackIn / 2], ['wheel-RL', 0, p.rearTrackIn / 2], ['wheel-RR', 0, -p.rearTrackIn / 2]] as const) {
      const c = spec.wheelCentersM[id].map((v) => v / M_PER_IN);
      expect(c[0], id).toBeCloseTo(x, 4);
      expect(c[1], id).toBeCloseTo(y, 4);
      expect(c[2], id).toBeCloseTo(p.wheelDiameterIn / 2, 4);
    }
    // Kingpin at the front axle on the centerline; the tongue tie ahead of it, above the deck bottom, on the centerline.
    const king = spec.kingpinM.map((x) => x / M_PER_IN);
    expect(king[0]).toBeCloseTo(p.wheelbaseIn, 4);
    expect(Math.abs(king[1])).toBeLessThan(1e-6);
    const pull = spec.pullPointM.map((x) => x / M_PER_IN);
    expect(pull[0]).toBeGreaterThan(p.wheelbaseIn + p.frontOverhangIn - 1);
    expect(Math.abs(pull[1])).toBeLessThan(0.5);
    expect(pull[2]).toBeGreaterThan(king[2] - 3);
  });

  it('rests on four wheels carrying the whole weight (weight split by the contacts)', async () => {
    const sim = await run(1);
    const r = sim.readout();
    const w = spec.weightN / 4.4482216;
    const sum = WHEEL_IDS.reduce((s, id) => s + r.loadLbf[id], 0);
    expect(Math.abs(sum / w - 1)).toBeLessThan(0.02);
    expect(r.anyLift).toBe(false);
    expect(r.tipped).toBe(false);
    // The split follows the statics: the rear pair carries the share of the CG's distance to the front axle, and left and right agree by symmetry.
    const rear = r.loadLbf['wheel-RL'] + r.loadLbf['wheel-RR'];
    const front = r.loadLbf['wheel-FL'] + r.loadLbf['wheel-FR'];
    const rearShare = 1 - spec.cgM[0] / M_PER_IN / p.wheelbaseIn;
    expect(Math.abs(r.steerDeg)).toBeLessThan(0.1); // the axle rests straight
    console.log(`rest: rear share ${(rear / w).toFixed(3)} vs statics ${rearShare.toFixed(3)}`);
    expect(Math.abs(rear / w - rearShare)).toBeLessThan(0.04);
    expect(Math.abs(r.loadLbf['wheel-RL'] - r.loadLbf['wheel-RR'])).toBeLessThan(0.1 * rear);
    expect(Math.abs(r.loadLbf['wheel-FL'] - r.loadLbf['wheel-FR'])).toBeLessThan(0.1 * front);
  });

  it('runs at least 5x real time headless (240 steps = 1 s)', async () => {
    const sim = await createSim(spec);
    const t0 = performance.now();
    for (let i = 0; i < 2400; i++) sim.step();
    const stepsPerSec = 2400 / ((performance.now() - t0) / 1000);
    console.log(`sim speed: ${Math.round(stepsPerSec)} steps/s (${(stepsPerSec / 240).toFixed(1)}x real time)`);
    expect(stepsPerSec / 240).toBeGreaterThan(5);
  });

  it('downhill roll speeds up and stays straight and upright', async () => {
    const sc = SCENARIOS.find((s) => s.id === 'downhill')!;
    const sim = await run(8, { config: sc.config, controls: sc.controls, script: sc });
    expect(sim.readout().speedMph).toBeGreaterThan(5);
    expect(sim.readout().tipped).toBe(false);
    expect(Math.abs(yawDeg(sim))).toBeLessThan(2);
  });

  it('braking event: the rear brake alone slows the cart, which stays straight and upright (no front brakes, D-53)', async () => {
    const sc = SCENARIOS.find((s) => s.id === 'brake')!;
    expect(sc.brakeAtS).toBeDefined();
    const sim = await createSim(spec, { config: sc.config, controls: { ...sc.controls, brakeLbf: 100 }, script: sc });
    let vBefore = 0;
    let vMax = 0;
    for (let i = 0; i < 240 * 8; i++) {
      sim.step();
      const r = sim.readout();
      if (sim.t <= 1) vBefore = r.speedMph;
      vMax = Math.max(vMax, r.speedMph);
    }
    const r = sim.readout();
    expect(spec).not.toHaveProperty('frontBrakeShare');
    expect(vBefore).toBeGreaterThan(4); // it started at 6 mph downhill
    expect(r.speedMph).toBeLessThan(vBefore);
    expect(r.speedMph).toBeLessThan(0.5);
    expect(Math.abs(yawDeg(sim))).toBeLessThan(3);
    expect(r.tipped).toBe(false);
    expect(vMax).toBeLessThan(10);
  });

  it('a straight pull at the tongue tie accelerates the cart straight ahead with the axle straight (nothing to hunt)', async () => {
    const sim = await run(6, { controls: { pullLbf: 30, pullAngleDeg: 0 } });
    expect(sim.readout().speedMph).toBeGreaterThan(3);
    expect(Math.abs(yawDeg(sim))).toBeLessThan(2);
    expect(Math.abs(sim.readout().steerDeg)).toBeLessThan(1);
    expect(sim.readout().tipped).toBe(false);
  });

  it('the front axle turns freely about the kingpin: a servo (or a pull) swings it, and the stops hold it at the lock either way', async () => {
    const lock = p.steerLockDeg;
    // Free: a sideways pull at the tongue (45 degrees off the cart's heading) turns the axle until the stop catches it.
    const free = await createSim(spec, { controls: { pullLbf: 30, pullAngleDeg: 45 } });
    let peak = 0, peakNeg = 0;
    for (let i = 0; i < 240 * 1.5; i++) { free.step(); peak = Math.max(peak, free.readout().steerDeg); peakNeg = Math.min(peakNeg, free.readout().steerDeg); }
    expect(peak).toBeGreaterThan(lock - 0.5);
    expect(peak).toBeLessThanOrEqual(lock + 0.5); // never past the stop
    expect(peakNeg).toBeGreaterThan(-1);
    // Servo asked for more than the lock (or the other way): clamped at +/- the lock.
    for (const cmd of [lock + 15, -lock - 15, 8]) {
      const s2 = await createSim(spec, { controls: { steerDeg: 0, steerHold: true } });
      s2.controls.steerDeg = cmd;
      for (let i = 0; i < 240 * 1.5; i++) s2.step();
      const want = Math.max(-lock, Math.min(lock, cmd));
      expect(s2.readout().steerDeg, `cmd ${cmd}`).toBeCloseTo(want, 0);
    }
  });

  it('a sideways pull at the tongue steers the axle toward the lock, and the cart follows round', async () => {
    const left = await createSim(spec, { controls: { pullLbf: 40, pullAngleDeg: 30 } });
    const right = await createSim(spec, { controls: { pullLbf: 40, pullAngleDeg: -30 } });
    let pl = 0, pr = 0;
    for (let i = 0; i < 240 * 1; i++) { left.step(); right.step(); pl = Math.max(pl, left.readout().steerDeg); pr = Math.min(pr, right.readout().steerDeg); }
    expect(pl).toBeGreaterThan(p.steerLockDeg - 1);
    expect(pr).toBeLessThan(-p.steerLockDeg + 1);
    for (let i = 0; i < 240 * 9; i++) left.step();
    // The cart ends up heading roughly along the rope, the axle back near straight, upright.
    expect(yawDeg(left)).toBeGreaterThan(15);
    expect(left.readout().tipped).toBe(false);
  });

  it('turning circle: held at full lock the rear axle center drives a circle of radius WB / tan(lock), left and right', async () => {
    const analytic = p.wheelbaseIn / Math.tan((p.steerLockDeg * Math.PI) / 180);
    const sc = SCENARIOS.find((s) => s.id === 'turn')!;
    for (const sign of [1, -1]) {
      const sim = await createSim(spec, { config: sc.config, controls: { ...sc.controls, steerDeg: sign * p.steerLockDeg } });
      for (let i = 0; i < 240 * 3; i++) sim.step();
      const r = sim.readout();
      expect(r.steerDeg).toBeCloseTo(sign * p.steerLockDeg, 0);
      expect(r.turnRadiusIn).not.toBeNull();
      expect(Math.abs(r.turnRadiusIn! / analytic - 1)).toBeLessThan(TURN_RADIUS_TOL);
      expect(r.tipped).toBe(false);
    }
  });

  it('the bump scenario (5 mph into a 2 in root) spikes the wheel loads, and the cart stays upright', async () => {
    const sc = SCENARIOS.find((s) => s.id === 'bump')!;
    const sim = await run(5, { config: sc.config, controls: sc.controls, script: sc });
    const r = sim.readout();
    console.log(`bump: peak load factor ${r.peakLoadFactor.toFixed(2)}`);
    expect(r.peakLoadFactor).toBeGreaterThan(1.5);
    expect(r.tipped).toBe(false);
  });

  it('scenarios: no ride, the turning circle demo is there; no swivel or caster fields anywhere; the tilt table chocks the wheels at high friction', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(['free', 'downhill', 'tilt', 'bump', 'turn', 'brake']);
    expect(Object.keys(DEFAULT_CONFIG)).not.toContain('mode');
    for (const sc of SCENARIOS) expect(JSON.stringify(sc)).not.toMatch(/swivel|caster|ackermann/i);
    const turn = SCENARIOS.find((s) => s.id === 'turn')!;
    expect(turn.controls.steerHold).toBe(true);
    expect(turn.controls.steerDeg).toBeGreaterThan(0);
    const tilt = SCENARIOS.find((s) => s.id === 'tilt')!;
    expect(tilt.config.wheelsLocked).toBe(true);
    expect(tilt.config.frictionMu).toBeGreaterThanOrEqual(1.2);
    expect(tilt.config.tiltRateDegPerS).toBeGreaterThan(0);
  });

  it('poses: exactly the chassis, the front axle, the four wheels, the rider and the cargo; no caster or knuckle bodies', async () => {
    const sim = await run(1);
    const poses = sim.poses();
    for (const id of ['chassis', 'front-axle', 'wheel-FL', 'wheel-FR', 'wheel-RL', 'wheel-RR', 'rider', 'cargo'] as const) expect(poses.get(id), id).toHaveLength(16);
    for (const id of ['caster-L', 'caster-R', 'steer-L', 'tie-rod', 'bellcrank', 'tongue']) expect(poses.has(id as never), id).toBe(false);
    // At rest the front axle pose is the identity too (it stays straight).
    const a = poses.get('front-axle')!;
    expect(Math.hypot(a[12], a[13], a[14])).toBeLessThan(0.2);
    expect(Math.abs(a[1])).toBeLessThan(0.01);
    // At rest on flat ground the poses are (near) the identity.
    const d = poses.get('wheel-FL')!;
    expect(Math.hypot(d[12], d[13], d[14])).toBeLessThan(0.2);
  });
});

/**
 * Cross-check (BRIEF §8, phase-2 spec): the tilt-table tip onset must match the static tip angle. The static angle is
 * computed here independently from the model: the CG and the four wheel contact points, and the support edge on the downhill side. The plumb line from the
 * CG hits the ground at (x, y - h*tan(phi)), so the cart tips when that point reaches the line through the two downhill wheels:
 * tan(phi) = (lateral CG-to-edge distance at the CG's x) / h. Straight, the front track equals the rear track and the edge is parallel to X; steered, the front wheel contacts (and the CG, as the axle assembly swings) move and the edge tilts.
 */
function staticTipDeg(tipTo: 'right' | 'left', steerDeg = 0): { deg: number; h: number; edge: number } {
  const ps = buildModel(p, { rider: 'operating', cargo: true, steerDeg });
  const cg = centerOfGravity(ps, { includePayload: true });
  const at = (id: string) => translationOf(ps.find((x) => x.id === id)!.transform);
  const [a, b] = tipTo === 'right' ? [at('wheel-RR'), at('wheel-FR')] : [at('wheel-RL'), at('wheel-FL')];
  const yEdge = a[1] + ((cg[0] - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
  const dist = tipTo === 'right' ? cg[1] - yEdge : yEdge - cg[1];
  return { deg: (Math.atan(dist / cg[2]) * 180) / Math.PI, h: cg[2], edge: Math.abs(yEdge) };
}

describe('tilt table vs static tip angle (operating rider)', () => {
  /** The sim's onset is the second wheel lift; tire compliance shifts the contact by about an inch, so a degree or so of tolerance. */
  const TOL_DEG = 1.5;
  const results = new Map<string, { sim: number; stat: number; first: number }>();

  it.each(['right', 'left'] as const)('tipping to the %s', async (tipTo) => {
    const r = await runTiltOnset(spec, { tipTo });
    const stat = staticTipDeg(tipTo);
    expect(r.onsetDeg).not.toBeNull();
    results.set(tipTo, { sim: r.onsetDeg!, stat: stat.deg, first: r.firstLiftDeg! });
    console.log(`tilt ${tipTo}: first lift ${r.firstLiftDeg!.toFixed(1)}°, sim onset ${r.onsetDeg!.toFixed(2)}°, static ${stat.deg.toFixed(2)}° (h ${stat.h.toFixed(1)}", edge ${stat.edge.toFixed(1)}")`);
    expect(Math.abs(r.onsetDeg! - stat.deg)).toBeLessThan(TOL_DEG);
    // The load-transfer warning (first wheel lift) never comes after the tip onset.
    expect(r.firstLiftDeg!).toBeLessThanOrEqual(r.onsetDeg! + 1e-6);
  }, 60_000);

  it('left and right agree (the cart is symmetric about its centerline), in the sim and in the statics', () => {
    const l = results.get('left')!, r = results.get('right')!;
    expect(Math.abs(l.stat - r.stat)).toBeLessThan(0.5);
    expect(Math.abs(l.sim - r.sim)).toBeLessThan(1);
  });

  it('the static tip angle is well above the 20 deg side-slope target of the brief', () => {
    for (const tipTo of ['right', 'left'] as const) expect(results.get(tipTo)!.stat).toBeGreaterThan(20);
  });
});

describe('tilt table with the front axle held at the lock (fixed contacts at the displayed steer)', () => {
  const TOL_DEG = 1.5;
  it.each([['right', 1], ['left', 1], ['right', -1], ['left', -1]] as const)('tipping to the %s with the axle at %i x lock', async (tipTo, sign) => {
    const steer = sign * p.steerLockDeg;
    const r = await runTiltOnset(spec, { tipTo, steerDeg: steer });
    const stat = staticTipDeg(tipTo, steer);
    expect(r.onsetDeg).not.toBeNull();
    console.log(`tilt ${tipTo} @ ${steer}: sim onset ${r.onsetDeg!.toFixed(2)}°, static ${stat.deg.toFixed(2)}°`);
    expect(Math.abs(r.onsetDeg! - stat.deg)).toBeLessThan(TOL_DEG);
    expect(stat.deg).toBeGreaterThan(20);
    expect(r.readout.steerDeg).toBeCloseTo(steer, 0);
  }, 60_000);
});

