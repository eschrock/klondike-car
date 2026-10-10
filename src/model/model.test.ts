import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, validateParams, type ParamKey, type Params } from '../params';
import { buildModel } from './index';
import { obbOverlap, partOBB } from './bounds';
import { centerOfGravity, totalMass } from './mass';
import type { Part, PartGroup } from './types';

const TOL = 0.05;
const defaults = defaultParams();

interface Allow {
  a: RegExp;
  b: RegExp;
  why: string;
}
/** Intended contacts (kept short; real clashes are fixed in the geometry instead). */
const ALLOW: Allow[] = [
  { a: /^axle-/, b: /^(wheel-|beam-)/, why: 'axle passes through the hub bore and lies in a groove in the beam (D-10, D-15)' },
  { a: /^beam-/, b: /^wheel-/, why: 'tire OBB is a conservative box; the beam ends sit inside the rim, 1/8" short of the hub face' },
  { a: /^brake-shoe-/, b: /^wheel-/, why: 'shoe presses on the tread; the tire OBB corner is not tire' },
  { a: /^(rail-cabin|girder-cabin)-/, b: /^(beam-R|axle-R|brake-shaft)/, why: 'rails/girders are notched or drilled for the rear axle and brake-shaft journals (D-15); joinery is Phase 3' },
  { a: /^kingpin$/, b: /^(beam-F|axle-F|turntable|bolster)/, why: 'kingpin passes through the stack' },
  { a: /^steer-stop-/, b: /^bolster$/, why: 'stops bear on the bolster at lock; counter-stop geometry is Phase 2/3' },
];
const matches = (r: Allow, a: Part, b: Part) => (r.a.test(a.id) && r.b.test(b.id)) || (r.a.test(b.id) && r.b.test(a.id));

const SOLID: PartGroup[] = ['frame', 'body', 'running-gear', 'steering', 'seat', 'storage', 'brake', 'removable', 'lighting', 'hardware'];

function overlaps(parts: Part[]) {
  const solid = parts.filter((p) => !p.payload && SOLID.includes(p.group));
  const obbs = solid.map(partOBB);
  const bad: string[] = [];
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const o = obbOverlap(obbs[i], obbs[j]);
      if (o > TOL && !ALLOW.some((r) => matches(r, solid[i], solid[j]))) bad.push(`${solid[i].id} x ${solid[j].id}: ${o.toFixed(3)}"`);
    }
  }
  return bad;
}

describe('buildModel structure', () => {
  const parts = buildModel(defaults);
  it('defaults still validate clean', () => expect(validateParams(defaults)).toEqual([]));
  it('ids are unique and transforms are finite', () => {
    expect(new Set(parts.map((p) => p.id)).size).toBe(parts.length);
    for (const p of parts) {
      expect(p.transform).toHaveLength(16);
      expect(p.transform.every(Number.isFinite), p.id).toBe(true);
      expect(p.step, p.id).toBeGreaterThan(0);
      expect(p.explode, p.id).toBeDefined();
      expect(p.fab, p.id).toBeDefined();
      if (p.kind === 'lumber' || p.kind === 'sheet') expect(p.stock, p.id).toBeDefined();
    }
  });
  it('has 4 wheels with the required rigid bodies', () => {
    const w = parts.filter((p) => p.geometry.type === 'wheel');
    expect(w.map((p) => p.body).sort()).toEqual(['wheel-FL', 'wheel-FR', 'wheel-RL', 'wheel-RR']);
  });
  it('clamps the steer angle and rotates every steer-body part about the kingpin', () => {
    const p = { ...defaults, steerLockDeg: 20 };
    const s20 = Math.sin((20 * Math.PI) / 180);
    const big = buildModel(p, { steerDeg: 50 });
    const fl = big.find((x) => x.id === 'wheel-FL')!;
    expect(fl.transform[0]).toBeCloseTo(Math.cos((20 * Math.PI) / 180), 6);
    expect(fl.transform[1]).toBeCloseTo(s20, 6);
    for (const part of big.filter((x) => x.body === 'steer')) expect(part.transform[1], part.id).toBeCloseTo(s20, 6);
    expect(big.filter((x) => x.body === 'steer').length).toBeGreaterThan(8);
    const neg = buildModel(p, { steerDeg: -50 }).find((x) => x.id === 'wheel-FL')!;
    expect(neg.transform[1]).toBeCloseTo(-s20, 6);
  });
  it('kingpin stays at (WB, 0) at any steer angle', () => {
    const k = buildModel(defaults, { steerDeg: 40 }).find((x) => x.id === 'kingpin')!;
    expect(k.transform[12]).toBeCloseTo(defaults.wheelbaseIn, 6);
    expect(k.transform[13]).toBeCloseTo(0, 6);
  });
});

describe('overlaps', () => {
  const lock = defaults.steerLockDeg;
  it.each([0, lock, -lock])('no unintended overlaps at steer %d', (deg) => {
    expect(overlaps(buildModel(defaults, { steerDeg: deg }))).toEqual([]);
  });
  it('also clean in the removed (transport) configuration', () => {
    expect(overlaps(buildModel(defaults, { removed: true }))).toEqual([]);
  });
  it('front tires clear the nose and cabin body at full lock', () => {
    for (const deg of [lock, -lock]) {
      const parts = buildModel(defaults, { steerDeg: deg });
      const tires = parts.filter((p) => p.id === 'wheel-FL' || p.id === 'wheel-FR');
      const body = parts.filter((p) => !p.payload && /^(side-|shoulder|deck-|transom|rail-|joist-|bolster|foot-stop|storage|seat-|sign|reflector|grab)/.test(p.id));
      expect(body.length).toBeGreaterThan(10);
      for (const t of tires) for (const b of body) {
        expect(obbOverlap(partOBB(t), partOBB(b)), `${t.id} vs ${b.id} @${deg}`).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe('masses', () => {
  const parts = buildModel(defaults);
  it('every part has finite mass; every non-payload part is positive', () => {
    for (const p of parts) {
      expect(Number.isFinite(p.massLb), p.id).toBe(true);
      if (!p.payload) expect(p.massLb, p.id).toBeGreaterThan(0);
    }
  });
  it('prints the empty-mass breakdown and CGs', () => {
    const rows: Record<string, { parts: number; massLb: number }> = {};
    for (const p of parts.filter((x) => !x.payload)) {
      rows[p.group] ??= { parts: 0, massLb: 0 };
      rows[p.group].parts++;
      rows[p.group].massLb = +(rows[p.group].massLb + p.massLb).toFixed(2);
    }
    const empty = totalMass(parts);
    console.table(rows);
    const f = (v: number[]) => v.map((x) => x.toFixed(2)).join(', ');
    const op = buildModel(defaults, { rider: 'operating' });
    const goal = buildModel(defaults, { rider: 'goal' });
    console.log(`Empty mass ${empty.toFixed(1)} lb (${parts.filter((x) => !x.payload).length} parts, ${parts.length} incl payload); CG [${f(centerOfGravity(parts))}]`);
    console.log(`+ operating rider + cargo: ${totalMass(op, { includePayload: true }).toFixed(1)} lb; CG [${f(centerOfGravity(op, { includePayload: true }))}]`);
    console.log(`+ goal rider + cargo: ${totalMass(goal, { includePayload: true }).toFixed(1)} lb; CG [${f(centerOfGravity(goal, { includePayload: true }))}]`);
    expect(empty).toBeGreaterThan(80);
    expect(empty).toBeLessThan(150);
  });
  it('rider CG follows D-3 and mass follows the view', () => {
    const p = defaults;
    expect(buildModel(p, { rider: 'none' }).some((x) => x.body === 'rider')).toBe(false);
    for (const [rider, mass] of [['operating', p.riderMassLb], ['goal', p.riderGoalMassLb]] as const) {
      const m = buildModel(p, { rider });
      const torso = m.find((x) => x.id === 'rider-torso')!;
      expect(torso.massLb).toBe(mass);
      expect(m.filter((x) => x.body === 'rider' && x !== torso).every((x) => x.massLb === 0)).toBe(true);
      expect(torso.payload).toBe(true);
      const cushion = m.find((x) => x.id === 'seat-cushion')!;
      const seatTop = cushion.transform[14] + (cushion.geometry as { size: number[] }).size[2] / 2;
      expect(torso.cgIn![0]).toBeCloseTo(p.seatXIn + p.riderCgAheadOfHpointIn, 9);
      expect(torso.cgIn![1]).toBe(0);
      expect(torso.cgIn![2]).toBeCloseTo(seatTop + p.riderSeatedCgAboveSeatIn, 9);
    }
    const op = buildModel(p);
    expect(op.find((x) => x.id === 'cargo')!.massLb).toBe(p.cargoMassLb);
    expect(buildModel(p, { cargo: false }).some((x) => x.id === 'cargo')).toBe(false);
    // Payload is excluded from the empty mass and CG.
    expect(totalMass(op)).toBeCloseTo(totalMass(buildModel(p, { rider: 'none', cargo: false })), 9);
    expect(totalMass(op, { includePayload: true })).toBeCloseTo(totalMass(op) + p.riderMassLb + p.cargoMassLb, 6);
  });
});

describe('removed', () => {
  it('drops exactly the removable parts', () => {
    const full = buildModel(defaults);
    const removed = buildModel(defaults, { removed: true });
    expect(removed.map((p) => p.id)).toEqual(full.filter((p) => !p.removable).map((p) => p.id));
    const gone = full.filter((p) => p.removable).map((p) => p.id);
    expect(gone).toEqual(expect.arrayContaining(['tongue', 'prow', 'seat-back', 'sign-L', 'sign-R', 'handle-bar', 'handle-post-L', 'handle-post-R']));
  });
});

describe('param sweeps', () => {
  const all = Object.keys(PARAM_DEFS) as ParamKey[];
  const primary = all.filter((k) => PARAM_DEFS[k].primary);
  const check = (p: Params, label: string) => {
    for (const v of [{}, { steerDeg: 40, rider: 'goal' as const }, { removed: true }]) {
      let parts: Part[] = [];
      expect(() => (parts = buildModel(p, v)), label).not.toThrow();
      for (const part of parts) {
        expect(Number.isFinite(part.massLb), `${label} ${part.id} mass`).toBe(true);
        expect(part.transform.every(Number.isFinite), `${label} ${part.id} transform`).toBe(true);
      }
      expect(Number.isFinite(totalMass(parts, { includePayload: true })), label).toBe(true);
      expect(centerOfGravity(parts, { includePayload: true }).every(Number.isFinite), label).toBe(true);
    }
  };
  it.each(primary)('primary param %s at min and max', (k) => {
    for (const v of [PARAM_DEFS[k].min, PARAM_DEFS[k].max]) check({ ...defaults, [k]: v }, `${k}=${v}`);
  });
  it('every param (and every option) at min/max does not throw', () => {
    for (const k of all) {
      const d = PARAM_DEFS[k];
      const values = d.options ? d.options.map((o) => o.value) : [d.min, d.max];
      for (const v of values) check({ ...defaults, [k]: v }, `${k}=${v}`);
    }
  });
  it('whole-design extremes do not throw', () => {
    const lo = { ...defaults }, hi = { ...defaults };
    for (const k of all) { lo[k] = PARAM_DEFS[k].min; hi[k] = PARAM_DEFS[k].max; }
    check(lo, 'all-min');
    check(hi, 'all-max');
  });
  it('alternate structure, brake, storage and axle options build', () => {
    for (const patch of [
      { frameStyle: 1 }, { sideConstruction: 0 }, { sideConstruction: 2 }, { axleStyle: 1 }, { brakeType: 1 },
      { storageLocation: 1 }, { storageLocation: 2 }, { axleBeamPosition: 1 }, { drawbar: 0 }, { plySpecies: 1 }, { tireType: 1 },
    ]) check({ ...defaults, ...patch }, JSON.stringify(patch));
  });
});
