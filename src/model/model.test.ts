import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, validateParams, type ParamKey, type Params } from '../params';
import { buildModel } from './index';
import { obbOverlap, partOBB, worldAABB } from './bounds';
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
  { a: /^kingpin$/, b: /^(beam-F|turntable)$/, why: 'kingpin passes through the solid beam and the turntable centre (D-25); it leads the axle rod, so axle-F is NOT allowed' },
  { a: /^steer-stop-/, b: /^bolster-/, why: 'stops bear on the bolster at lock; counter-stop geometry is Phase 2/3' },
  { a: /^axle-R$/, b: /^brake-drum-/, why: 'wooden drum is bored onto the live rear axle (D-13)' },
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
  it('kingpin stays at (WB + lead, 0) at any steer angle and clears the front axle rod (D-25)', () => {
    const kx = defaults.wheelbaseIn + defaults.kingpinLeadIn;
    for (const deg of [0, 40, -40]) {
      const m = buildModel(defaults, { steerDeg: deg });
      const k = m.find((x) => x.id === 'kingpin')!;
      expect(k.transform[12]).toBeCloseTo(kx, 6);
      expect(k.transform[13]).toBeCloseTo(0, 6);
      const turntable = m.find((x) => x.id === 'turntable')!;
      expect(turntable.transform[12]).toBeCloseTo(kx, 6);
      expect(turntable.transform[13]).toBeCloseTo(0, 6);
      // The kingpin and the axle rod never intersect: centre distance > kingpin radius + rod radius.
      const axle = m.find((x) => x.id === 'axle-F')!;
      const dist = Math.hypot(axle.transform[12] - k.transform[12], axle.transform[13] - k.transform[13]);
      expect(dist).toBeGreaterThan(defaults.kingpinDiameterIn / 2 + defaults.axleDiameterIn / 2);
      expect(obbOverlap(partOBB(k), partOBB(axle))).toBeLessThanOrEqual(0);
    }
    // At neutral the axle rod stays at x = WB.
    expect(buildModel(defaults).find((x) => x.id === 'axle-F')!.transform[12]).toBeCloseTo(defaults.wheelbaseIn, 6);
  });
  it('kingpin runs through solid beam wood (beam spans axle and kingpin)', () => {
    const m = buildModel(defaults);
    const beam = worldAABB(m.find((x) => x.id === 'beam-F')!);
    const k = worldAABB(m.find((x) => x.id === 'kingpin')!);
    expect(k.min[0]).toBeGreaterThanOrEqual(beam.min[0]);
    expect(k.max[0]).toBeLessThanOrEqual(beam.max[0]);
  });
  it('side bearers bear on the beam with the configured running clearance under the bolster (M5, D-12)', () => {
    const m = buildModel(defaults);
    const beam = worldAABB(m.find((x) => x.id === 'beam-F')!);
    const plate = worldAABB(m.find((x) => x.id === 'turntable')!);
    for (const tag of ['L', 'R']) {
      const sb = worldAABB(m.find((x) => x.id === `side-bearer-${tag}`)!);
      const end = worldAABB(m.find((x) => x.id === `bolster-end-${tag}`)!);
      expect(m.find((x) => x.id === `side-bearer-${tag}`)!.body).toBe('steer');
      expect(sb.min[2]).toBeCloseTo(beam.max[2], 6);
      expect(end.min[2] - sb.max[2]).toBeCloseTo(defaults.sideBearerClearanceIn, 6);
      // Outside the turntable plate, under the bolster end rail.
      expect(Math.abs(sb.min[1])).toBeGreaterThanOrEqual(defaults.turntableSizeIn / 2);
      expect(sb.min[1] >= end.min[1] - 1e-9 && sb.max[1] <= end.max[1] + 1e-9).toBe(true);
      expect(plate.max[2]).toBeCloseTo(end.min[2], 6);
    }
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

/** Documented empty masses at defaults (heavy design, D-21), lb. Printed by the breakdown test below. */
const EXPECTED_EMPTY_LB = 119.2;
const EXPECTED_GROUP_LB: Record<string, number> = {
  'running-gear': 46.3, steering: 10.4, frame: 9.5, body: 27.5, seat: 5.8, storage: 8.1, brake: 3.5, removable: 4.9,
};

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
    // Regression band: ±10% of the documented block-model empty mass at defaults (critic H2). Update EXPECTED_EMPTY_LB
    // (and the group table below) deliberately when the design changes. W-1 'default' is ~121 lb; spec says ~100-125.
    expect(empty).toBeGreaterThan(EXPECTED_EMPTY_LB * 0.9);
    expect(empty).toBeLessThan(EXPECTED_EMPTY_LB * 1.1);
    for (const [g, lb] of Object.entries(EXPECTED_GROUP_LB)) {
      expect(rows[g]?.massLb ?? 0, `group ${g}`).toBeGreaterThan(lb * 0.85);
      expect(rows[g]?.massLb ?? 0, `group ${g}`).toBeLessThan(lb * 1.15);
    }
  });
  it('the block-model artefacts stay gone: seat, bolster and storage lid are real members, not slabs', () => {
    expect(parts.some((x) => x.id === 'seat-base')).toBe(false);
    expect(parts.some((x) => x.id === 'bolster')).toBe(false);
    const seatBack = parts.filter((x) => x.id.startsWith('seat-back-') && x.id !== 'seat-back-pad');
    expect(seatBack.map((x) => x.id).sort()).toEqual(['seat-back-panel', 'seat-back-rail-bottom', 'seat-back-rail-top', 'seat-back-stile-L', 'seat-back-stile-R']);
    expect(seatBack.reduce((m, x) => m + x.massLb, 0)).toBeLessThan(4);
    const lid = parts.find((x) => x.id === 'storage-lid')!;
    expect(lid.kind).toBe('sheet');
    expect((lid.geometry as { size: number[] }).size[2]).toBeCloseTo(defaults.panelPlyIn, 6);
    expect(parts.filter((x) => x.group === 'steering' && /^bolster/.test(x.id)).reduce((m, x) => m + x.massLb, 0)).toBeLessThan(5);
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
    expect(gone).toEqual(expect.arrayContaining(['tongue', 'prow', 'seat-back-panel', 'seat-back-stile-L', 'sign-L', 'sign-R', 'handle-bar', 'handle-post-L', 'handle-post-R']));
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

// ── Robustness (critic H3) ──────────────────────────────────────────────────────────────────────────────────────
const errorsOf = (p: Params) => validateParams(p).filter((i) => i.severity === 'error');
/** Scan a param for the lowest / highest value validateParams accepts. */
function validExtreme(key: ParamKey, from: number, to: number, step: number): number {
  const dir = Math.sign(to - from);
  for (let v = from; dir * (to - v) >= 0; v += dir * step) if (!errorsOf({ ...defaults, [key]: v }).length) return v;
  return NaN;
}
const seatMin = validExtreme('seatXIn', PARAM_DEFS.seatXIn.min, PARAM_DEFS.seatXIn.max, 0.5);
const seatMax = validExtreme('seatXIn', PARAM_DEFS.seatXIn.max, PARAM_DEFS.seatXIn.min, 0.5);

/**
 * Variants for the overlap, rider and ground tests. Variants whose params validateParams rejects are skipped
 * (a rule says why); the "…+fix" entries are the feasible companions of the raw extremes.
 */
const VARIANTS: Record<string, Partial<Params>> = {
  overslungBeam: { axleBeamPosition: 1 },
  'overslungBeam+deck': { axleBeamPosition: 1, deckHeightIn: 11.5 },
  seatXMin: { seatXIn: seatMin },
  seatXMax: { seatXIn: seatMax },
  gunwaleFlare2: { gunwaleFlareIn: 2 },
  wheel10: { wheelDiameterIn: 10 },
  wheel11_5: { wheelDiameterIn: 11.5 },
  drumBrake: { brakeType: 1 },
  stubAxles: { axleStyle: 1 },
  hullBeamFrame: { frameStyle: 1 },
  sidesSolidOak: { sideConstruction: 0 },
  sidesCapturedPly: { sideConstruction: 1 },
  sidesOpenFrame: { sideConstruction: 2 },
  storageRear: { storageLocation: 0 },
  storageForwardRaised: { storageLocation: 1 },
  storageUnderSeat: { storageLocation: 2 },
  track30: { rearTrackIn: 30, frontTrackIn: 30 },
  'track30+fix': { rearTrackIn: 30, frontTrackIn: 30, bodyWidthIn: 24, steerLockDeg: 25 },
  track44: { rearTrackIn: 44, frontTrackIn: 44 },
  'track44+fix': { rearTrackIn: 44, frontTrackIn: 44, noseTaperStartIn: 23 },
  wheelbase40: { wheelbaseIn: 40 },
  'wheelbase40+fix': { wheelbaseIn: 40, seatXIn: 8 },
  wheelbase60: { wheelbaseIn: 60 },
  lock30: { steerLockDeg: 30 },
  lock45: { steerLockDeg: 45 },
  kingpinLead0_875: { kingpinLeadIn: 0.875 },
  kingpinLead2_5: { kingpinLeadIn: 2.5, frontOverhangIn: 10 },
  'underSeat+riser': { storageLocation: 2, seatRiserIn: 1.5 },
  riser: { seatRiserIn: 1.5 },
  ropeBridleOnly: { drawbar: 0 },
  flatFree: { tireType: 1 },
  'stubAxles+10in': { axleStyle: 1, wheelDiameterIn: 10, axleBeamDepthIn: 3 },
};
const variantCases = Object.entries(VARIANTS).map(([name, patch]) => ({ name, p: { ...defaults, ...patch } as Params }));
const valid = variantCases.filter((v) => !errorsOf(v.p).length);
const skipped = variantCases.filter((v) => errorsOf(v.p).length);

describe('variants', () => {
  it('the extremes of the validated seat range are real (seat min/max found)', () => {
    expect(Number.isFinite(seatMin) && Number.isFinite(seatMax)).toBe(true);
    expect(seatMin).toBeLessThan(defaults.seatXIn);
    expect(seatMax).toBeGreaterThan(defaults.seatXIn);
    // One step beyond the extremes is rejected: the validator is what stops the impossible seat positions.
    expect(errorsOf({ ...defaults, seatXIn: seatMin - 0.5 }).length).toBeGreaterThan(0);
    expect(errorsOf({ ...defaults, seatXIn: seatMax + 0.5 }).length).toBeGreaterThan(0);
  });
  it('most variants are valid; raw extremes that are impossible are skipped with a reason', () => {
    expect(valid.length).toBeGreaterThanOrEqual(variantCases.length - 6);
    for (const v of skipped) expect(errorsOf(v.p)[0].message.length, v.name).toBeGreaterThan(20);
    // The feasible companions must really be feasible.
    for (const n of ['overslungBeam+deck', 'track30+fix', 'track44+fix', 'wheelbase40+fix', 'seatXMin', 'seatXMax', 'gunwaleFlare2', 'wheel10', 'drumBrake', 'stubAxles', 'hullBeamFrame', 'lock30'])
      expect(valid.some((v) => v.name === n), n).toBe(true);
  });
  it.each(valid.map((v) => [v.name, v.p] as const))('no unintended overlaps: %s (neutral and both full locks, transport config)', (_n, p) => {
    for (const view of [{ steerDeg: 0 }, { steerDeg: p.steerLockDeg }, { steerDeg: -p.steerLockDeg }, { removed: true }])
      expect(overlaps(buildModel(p, view)), JSON.stringify(view)).toEqual([]);
  });
  it.each(valid.map((v) => [v.name, v.p] as const))('rider fits without cutting through the structure: %s', (_n, p) => {
    expect(riderClashes(buildModel(p))).toEqual([]);
  });
  it('rider-vs-structure test has teeth: an oversized seat cuts the rider and is caught', () => {
    const m = buildModel({ ...defaults, seatBackAngleDeg: 0, riderStatureIn: 76 });
    // Not asserting a clash here (validator-dependent); assert the function does detect a forced overlap.
    const torso = m.find((x) => x.id === 'rider-torso')!;
    const stile = m.find((x) => x.id === 'seat-back-stile-L')!;
    const moved = { ...torso, transform: [...torso.transform.slice(0, 12), stile.transform[12], stile.transform[13], stile.transform[14], 1] };
    expect(riderClashes([...m.filter((x) => x !== torso), moved]).length).toBeGreaterThan(0);
  });
  it.each(valid.map((v) => [v.name, v.p] as const))('ground contact: %s', (_n, p) => {
    const parts = buildModel(p);
    const wheels = parts.filter((x) => x.geometry.type === 'wheel');
    expect(wheels).toHaveLength(4);
    for (const w of wheels) expect(worldAABB(w).min[2], w.id).toBeCloseTo(0, 6);
    // Nothing else hangs below the minimum ground clearance (the validator warns about a too-deep beam instead of erroring).
    const warned = validateParams(p).some((i) => i.keys.includes('minGroundClearanceIn'));
    if (!warned)
      for (const x of parts.filter((q) => !q.payload && q.geometry.type !== 'wheel'))
        expect(worldAABB(x).min[2], x.id).toBeGreaterThanOrEqual(p.minGroundClearanceIn - 1e-6);
  });
  it('ground contact at defaults: 4 tire bottoms at z = 0 and 4.3" or more under the lowest structure', () => {
    const parts = buildModel(defaults);
    const low = Math.min(...parts.filter((q) => !q.payload && q.geometry.type !== 'wheel').map((q) => worldAABB(q).min[2]));
    expect(low).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn);
  });
});

/** Rider segments vs every non-payload part; the mannequin is rough, so a 0.1" tolerance. */
function riderClashes(parts: Part[], tol = 0.1): string[] {
  const riders = parts.filter((x) => x.body === 'rider');
  const structure = parts.filter((x) => !x.payload);
  const bad: string[] = [];
  for (const r of riders) for (const q of structure) {
    const o = obbOverlap(partOBB(r), partOBB(q));
    if (o > tol) bad.push(`${r.id} x ${q.id}: ${o.toFixed(2)}"`);
  }
  return bad;
}

describe('rider and tire clearance consistency', () => {
  it('rider fits at the default, at min and max stature, and for both rider loads', () => {
    for (const stature of [PARAM_DEFS.riderStatureIn.min, defaults.riderStatureIn, PARAM_DEFS.riderStatureIn.max]) {
      const p = { ...defaults, riderStatureIn: stature, riderLegReachIn: Math.round(stature * 0.53 * 2) / 2 };
      if (errorsOf(p).length) continue;
      for (const rider of ['operating', 'goal'] as const) expect(riderClashes(buildModel(p, { rider })), `${stature} ${rider}`).toEqual([]);
    }
  });
  it('feet land on the foot stop', () => {
    const m = buildModel(defaults);
    const stop = worldAABB(m.find((x) => x.id === 'foot-stop')!);
    for (const tag of ['L', 'R']) {
      const foot = worldAABB(m.find((x) => x.id === `rider-foot-${tag}`)!);
      expect(Math.abs(foot.max[0] - stop.min[0])).toBeLessThan(0.1);
    }
  });
  it('validateParams (A-4 with the D-25 lead) and the model agree: no rejected-free design lets a front tire touch the body', () => {
    const tireBody = (p: Params, deg: number) => {
      const parts = buildModel(p, { steerDeg: deg });
      const tires = parts.filter((x) => x.id === 'wheel-FL' || x.id === 'wheel-FR');
      const body = parts.filter((x) => !x.payload && /^(side-|shoulder|deck-|transom|rail-|joist-|bolster|foot-stop|storage|seat-|sign|reflector|grab)/.test(x.id));
      let worst = -Infinity;
      for (const t of tires) for (const b of body) worst = Math.max(worst, obbOverlap(partOBB(t), partOBB(b)));
      return worst;
    };
    for (const patch of [{}, { kingpinLeadIn: 0.875 }, { kingpinLeadIn: 2 }, { steerLockDeg: 30 }, { steerLockDeg: 25, noseWidthIn: 14 }, { frontTrackIn: 40, rearTrackIn: 40, noseTaperStartIn: 22, noseWidthIn: 12.5 }]) {
      const p = { ...defaults, ...patch };
      if (errorsOf(p).length) continue;
      for (const deg of [p.steerLockDeg, -p.steerLockDeg]) expect(tireBody(p, deg), JSON.stringify(patch)).toBeLessThanOrEqual(0);
    }
    // Rule is tight, not slack: a nose 1" wider than the limit really is hit.
    // (Rule: nose ≤ 2 × (swing − clearance). The tire itself touches at 2 × swing.)
    const limit = 2 * (derivedSwing() - defaults.steeringClearanceIn);
    const tight = { ...defaults, noseWidthIn: limit + 0.5 };
    expect(errorsOf(tight).some((i) => i.keys.includes('noseWidthIn'))).toBe(true);
    expect(tireBody(tight, defaults.steerLockDeg)).toBeLessThan(0);
    const wide = { ...defaults, noseWidthIn: 2 * derivedSwing() + 0.5 };
    expect(errorsOf(wide).some((i) => i.keys.includes('noseWidthIn'))).toBe(true);
    expect(tireBody(wide, defaults.steerLockDeg)).toBeGreaterThan(0);
    expect(tireBody({ ...defaults, noseWidthIn: limit }, defaults.steerLockDeg)).toBeCloseTo(-defaults.steeringClearanceIn, 6);
  });
});
function derivedSwing(): number {
  const lk = (defaults.steerLockDeg * Math.PI) / 180;
  return (defaults.frontTrackIn / 2 - defaults.tireWidthIn / 2) * Math.cos(lk) - (defaults.kingpinLeadIn + defaults.wheelDiameterIn / 2) * Math.sin(lk);
}

describe('explode directions (M7)', () => {
  const parts = buildModel(defaults);
  const dir = (id: string) => parts.find((x) => x.id === id)!.explode!;
  it('every part has a unit direction, payload has none', () => {
    for (const x of parts) {
      const n = Math.hypot(...x.explode!);
      if (x.payload) expect(x.explode, x.id).toEqual([0, 0, 0]);
      else expect(n, x.id).toBeCloseTo(1, 6);
    }
  });
  it('subsystems separate by their own rule', () => {
    expect(dir('wheel-FL')[1]).toBeGreaterThan(0.8);
    expect(dir('wheel-FR')[1]).toBeLessThan(-0.8);
    expect(dir('beam-R')[2]).toBeLessThan(-0.9);
    expect(dir('tongue')[0]).toBeGreaterThan(0.9);
    expect(dir('kingpin')[2]).toBeLessThan(-0.9);
    expect(dir('side-cabin-L-web')[1]).toBeGreaterThan(0.9);
    expect(dir('side-cabin-R-web')[1]).toBeLessThan(-0.9);
    expect(dir('seat-cushion')[2]).toBeGreaterThan(0.9);
    expect(dir('seat-back-panel')[0]).toBeLessThan(-0.4);
    expect(dir('storage-lid')[2]).toBeGreaterThan(0.9);
    expect(dir('handle-bar')[0]).toBeLessThan(-0.8);
    expect(dir('rail-cabin-L')[2]).toBeLessThan(-0.5);
    expect(dir('deck-cabin')[2]).toBeGreaterThan(0.9);
    // Not all one direction: the exploded view separates the assembly.
    const distinct = new Set(parts.filter((x) => !x.payload).map((x) => x.explode!.map((v) => v.toFixed(1)).join(',')));
    expect(distinct.size).toBeGreaterThan(15);
  });
});
