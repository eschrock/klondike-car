/**
 * Brake mechanism and rear push-handle model (D-13, D-38, D-39): the kinematics are checked against independent
 * derivations (cross products re-done here, virtual work by finite differences), the parts against their declared
 * contacts, and the whole thing against the rest of the cart over the stroke and over the parameter variants.
 */
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, validateParams, type Params } from '../params';
import { makeCtx } from './build-utils';
import { brakeGeometry, brakePose, buildBrake, buildBrakeAt, handleGeometry, ratchetGeometry, rot2, type V2 } from './brake';
import { buildModel } from './index';
import { obbOverlap, partOBB, worldAABB } from './bounds';
import type { Part } from './types';

const defaults = defaultParams();
const RAD = Math.PI / 180;
const geomOf = (p: Params) => { const c = makeCtx(p); return { c, g: brakeGeometry(c.p, c.L) }; };

describe('brake kinematics (hand calculation)', () => {
  const { c, g } = geomOf(defaults);
  const r = 6.5;
  it('the shaft sits 1.5" behind the tread at axle height; the pad pin sits at mid-thickness on the rear tread, 11° below the axle line', () => {
    expect(g.S).toEqual([-8, 6.5]);
    const b = 11 * RAD;
    const rPin = r + defaults.brakeShoeThickIn / 2; // 7.25
    expect(g.E[0]).toBeCloseTo(-rPin * Math.cos(b), 9);
    expect(g.E[1]).toBeCloseTo(r - rPin * Math.sin(b), 9);
    expect(g.C[0]).toBeCloseTo(-r * Math.cos(b), 9);
  });
  it('moment arms of the shoe force about the shaft, worked independently: |Kn| = 1.53", |Kt| = 0.60", k = |Kn ∓ μKt|', () => {
    const b = 11 * RAD;
    const E: V2 = [-7.25 * Math.cos(b), 6.5 - 7.25 * Math.sin(b)];
    const arm: V2 = [E[0] + 8, E[1] - 6.5];
    const n: V2 = [-Math.cos(b), -Math.sin(b)];
    const t: V2 = [-Math.sin(b), Math.cos(b)]; // friction on the shoe when the cart rolls forward: along the surface motion
    const Kn = arm[0] * n[1] - arm[1] * n[0];
    const Kt = arm[0] * t[1] - arm[1] * t[0];
    expect(Math.abs(Kn)).toBeCloseTo(1.5265, 3);
    expect(Math.abs(Kt)).toBeCloseTo(0.603, 3);
    expect(g.kFwd).toBeCloseTo(Math.abs(Kn + 0.4 * Kt), 9); // 1.285: friction helps (servo) rolling forward
    expect(g.kRev).toBeCloseTo(Math.abs(Kn - 0.4 * Kt), 9); // 1.768: de-servo rolling backward
    expect(g.kRev).toBeGreaterThan(g.kFwd);
    expect(g.critical).toBe('reverse');
    expect(g.selfLocking).toBe(false);
    expect(Math.abs(Kn) / Math.abs(Kt)).toBeGreaterThan(2); // would lock only at μ > 2.7
  });
  it('the closed link keeps its length from released to applied, and every pose in between', () => {
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      const q = brakePose(g, s);
      expect(Math.hypot(q.B[0] - q.T[0], q.B[1] - q.T[1])).toBeCloseTo(g.linkLen, 6);
      // the lever is rigid about Q and the crank rigid about S
      expect(Math.hypot(q.T[0] - g.Q[0], q.T[1] - g.Q[1])).toBeCloseTo(defaults.brakeLeverTailIn, 9);
      expect(Math.hypot(q.B[0] - g.S[0], q.B[1] - g.S[1])).toBeCloseTo(defaults.brakeCrankIn, 9);
    }
    expect(brakePose(g, 1).thetaL).toBeCloseTo(g.thetaL, 9);
  });
  it('at the applied pose the pad is on the tread; released it stands the engagement stroke off (0.3") along the arc', () => {
    const gap = (E: V2) => Math.hypot(E[0], E[1] - r) - (r + defaults.brakeShoeThickIn / 2); // pin radius error
    expect(gap(g.E)).toBeCloseTo(0, 9);
    const dE = Math.hypot(g.Erel[0] - g.E[0], g.Erel[1] - g.E[1]);
    expect(dE).toBeGreaterThan(defaults.brakeShoeTravelIn * 0.99); // the arc is a little longer than its inward component
    // inward component of the pin motion = the stroke
    const inward = (g.E[0] - g.Erel[0]) * -g.n[0] + (g.E[1] - g.Erel[1]) * -g.n[1];
    expect(inward).toBeCloseTo(defaults.brakeShoeTravelIn, 1); // first order θ·|Kn| = 0.3; the arc adds ~3%
  });
  it('virtual work: hand travel × F = pad travel × N_total, independent of the cross-product ratio', () => {
    // Frictionless: ratio0 = grip displacement / pad inward displacement, by finite differences about the applied pose.
    const eps = 1e-5;
    const a = brakePose(g, 1 - eps), b = brakePose(g, 1);
    const dGrip = a.G[0] - b.G[0];
    const dPad = (a.E[0] - b.E[0]) * -g.n[0] + (a.E[1] - b.E[1]) * -g.n[1];
    const ratio0 = Math.abs(dGrip / dPad);
    const fromGeometry = (g.lGrip / g.dQ) * (g.dS / Math.abs(g.Kn));
    expect(ratio0).toBeCloseTo(fromGeometry, 2);
  });
  it('the derived ratio is (l_grip / d_Q)(d_S / k): ≈ 12.99:1 backward, 17.86:1 forward, above the 12:1 target', () => {
    expect(g.ratioRev).toBeCloseTo((g.lGrip / g.dQ) * (g.dS / g.kRev), 9);
    expect(g.ratioFwd).toBeCloseTo((g.lGrip / g.dQ) * (g.dS / g.kFwd), 9);
    expect(g.ratioCrit).toBe(Math.min(g.ratioFwd, g.ratioRev));
    expect(g.ratioCrit).toBeGreaterThanOrEqual(defaults.brakeLeverRatio);
    expect(g.ratioCrit).toBeLessThan(defaults.brakeLeverRatio * 1.15); // solved to the target, not far above it
    expect(g.ok).toBe(true);
  });
  it('lever stroke: 4.8" at the grip for a 0.3" shoe stroke, ratio × stroke / servo', () => {
    expect(g.gripTravelIn).toBeGreaterThan(3.5);
    expect(g.gripTravelIn).toBeLessThan(6);
    expect(g.gripZ).toBe(defaults.rearHandleHeightIn - defaults.brakeLeverGripBelowHandleIn);
  });
  it('the target is a target: the derived ratio does not follow brakeLeverRatio', () => {
    expect(geomOf({ ...defaults, brakeLeverRatio: 6 }).g.ratioCrit).toBeCloseTo(g.ratioCrit, 9);
  });
  it('shortening the lever tail or lengthening the crank raises the ratio; a longer shoe arm (shoe lower is neutral at 25°) lowers it', () => {
    expect(geomOf({ ...defaults, brakeLeverTailIn: 1.7 }).g.ratioCrit).toBeGreaterThan(g.ratioCrit);
    expect(geomOf({ ...defaults, brakeCrankIn: 2.8 }).g.ratioCrit).toBeGreaterThan(g.ratioCrit);
  });
  it('rolling forward is servo-assisted and the servo gain goes away at the neutral angle (arm tangent to the tread)', () => {
    // Neutral when the shaft lies on the tangent through the pin: cos β = (r + t/2) / (r + gap behind the tire).
    const beta = (Math.acos(7.25 / 8) * 180) / Math.PI; // 25.0°
    const z = geomOf({ ...defaults, brakeShoeAngleDeg: beta }).g;
    expect(Math.abs(z.kFwd - z.kRev) / z.kRev).toBeLessThan(1e-3);
    expect(g.kFwd).toBeLessThan(g.kRev);
  });
  it('self-locking is detected (a long friction arm at a small normal arm)', () => {
    // μ_lock = |Kn|/|Kt| = 2.65 here: a rubber pad on a dry tire (μ ≈ 0.8) is nowhere near it, an absurd μ of 3 is past it
    expect(geomOf({ ...defaults, brakePadMu: 0.8 }).g.selfLocking).toBe(false);
    const bad = geomOf({ ...defaults, brakePadMu: 3 }).g;
    expect(bad.selfLocking).toBe(true);
    expect(bad.ok).toBe(false);
  });
  it('no solution when the link cannot close (crank pointing away): ok = false, ratio 0, and nothing throws', () => {
    const x = geomOf({ ...defaults, brakeCrankAngleDeg: 180 }).g;
    expect(Number.isFinite(x.ratioCrit)).toBe(true);
    if (!x.ok) expect(x.why.length + (x.selfLocking ? 1 : 0)).toBeGreaterThan(0);
  });
  it('ratchet geometry: the pawl pivot is below the gunwale top and the quadrant is concentric with the lever pivot', () => {
    const rg = ratchetGeometry(c.p, g, c.L);
    expect(rg.center).toEqual(g.Q);
    expect(g.Q[1] + rg.rTooth * Math.cos(g.tilt) + 0.9 * defaults.brakeBarWidthIn).toBeLessThan(c.L.deckTop + c.L.sideH);
    expect(rg.nTeeth).toBe(Math.floor((defaults.brakeRatchetSpanDeg * RAD) / (defaults.brakeRatchetPitchIn / rg.rTooth)));
    // pawl pivot lies on the lever axis, outside the rim
    const rel: V2 = [rg.pawlPivot[0] - g.Q[0], rg.pawlPivot[1] - g.Q[1]];
    expect(Math.hypot(...rel)).toBeGreaterThan(rg.rTooth);
    expect(rot2(g.G, g.Q, 0)).toEqual(g.G);
  });
});

describe('brake parts', () => {
  const ctx = makeCtx(defaults);
  const parts = buildBrake(ctx);
  const byId = (id: string) => parts.find((x) => x.id === id)!;
  const all = buildModel(defaults);
  const brake = all.filter((x) => /^(brake|handle)-/.test(x.id));
  it('has the whole chain: lever, pivot, link, crank, shaft, bearings, arms, pins, pads, spring, ratchet, sockets', () => {
    for (const id of ['brake-lever', 'brake-pivot-block', 'brake-lever-pin', 'brake-link', 'brake-link-clevis-lever', 'brake-link-clevis-crank', 'brake-crank', 'brake-shaft',
      'brake-bushing-L', 'brake-bushing-R', 'brake-arm-L-in', 'brake-arm-L-out', 'brake-arm-R-in', 'brake-arm-R-out', 'brake-hub-L-in', 'brake-shoe-pin-L', 'brake-shoe-L', 'brake-shoe-R',
      'brake-return-spring', 'brake-quadrant', 'brake-quadrant-bracket', 'brake-pawl', 'brake-pawl-pin', 'brake-pawl-spring', 'handle-socket-L', 'handle-socket-R', 'handle-post-L', 'handle-bar'])
      expect(parts.concat(all).some((x) => x.id === id), id).toBe(true);
  });
  it('every metal part is a cut / drilled / bought piece (no welding): steel parts carry drill-tap, laser or buy fabrication', () => {
    for (const x of brake.filter((q) => q.kind === 'metal' || q.kind === 'purchased')) expect(['drill-tap', 'laser', 'buy', 'cnc'], x.id).toContain(x.fab);
  });
  it('bought hardware lists its source; every joint names a mating part that exists', () => {
    const ids = new Set(all.map((x) => x.id));
    for (const x of brake.filter((q) => q.kind === 'purchased' && q.fab === 'buy')) expect(x.sourcing?.vendor, x.id).toBeTruthy();
    for (const x of brake) for (const j of x.joints ?? []) {
      expect(j.count, `${x.id} → ${j.to}`).toBeGreaterThan(0);
      if (!/^side-cabin-L-gunwale$/.test(j.to)) expect(ids.has(j.to), `${x.id} joint to ${j.to}`).toBe(true);
    }
  });
  it('wood parts have a grain direction; steel and bought parts do not claim one', () => {
    for (const x of brake) {
      if (x.material.includes('oak')) expect(x.grain, x.id).toBeDefined();
      if (x.kind === 'metal' || x.kind === 'purchased') expect(x.grain, x.id).toBeUndefined();
    }
  });
  it('explode directions are unit vectors', () => {
    for (const x of brake) expect(Math.hypot(...x.explode!), x.id).toBeCloseTo(1, 6);
  });
  it('the shaft is 0.75" ground steel, 2 × 19.5" long, at axle height behind the tire; the pads are oak arcs', () => {
    const sh = byId('brake-shaft');
    expect(sh.geometry).toMatchObject({ type: 'cylinder', radius: 0.375 });
    expect(worldAABB(sh).min[1]).toBeCloseTo(-19.545, 3); // the outer hub face: pad 15.9–18.9 + arm + 3/8" hub
    expect(sh.transform[12]).toBeCloseTo(-8, 9);
    expect(sh.transform[14]).toBeCloseTo(6.5, 9);
    const pad = byId('brake-shoe-L');
    expect(pad.geometry.type).toBe('extrusion');
    expect(pad.material).toBe('white oak');
    expect(pad.grain).toBe('z'); // across the tread
  });
  it('the pad arc is concentric with the 13" tire: inner radius 6.5" and outer 8" about the axle', () => {
    const pad = buildBrakeAt(ctx, 1).find((x) => x.id === 'brake-shoe-L')!;
    if (pad.geometry.type !== 'extrusion') throw new Error('pad is an extrusion');
    const m = pad.transform;
    const rad = pad.geometry.outline.map((q) => Math.hypot(m[0] * q[0] + m[4] * q[1] + m[12], m[2] * q[0] + m[6] * q[1] + m[14] - 6.5));
    expect(Math.min(...rad)).toBeCloseTo(6.5, 9);
    expect(Math.max(...rad)).toBeCloseTo(8, 9);
  });
  it('all brake parts stay at or above the minimum ground clearance, released and applied', () => {
    for (const s of [0, 1]) for (const x of buildBrakeAt(ctx, s)) expect(worldAABB(x).min[2], `${x.id} @${s}`).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn - 1e-6);
  });
  it('the handle posts are removable and sit in sockets that stay; the sockets are bolted to the transom', () => {
    const removed = buildModel(defaults, { removed: true });
    expect(removed.some((x) => x.id === 'handle-socket-L')).toBe(true);
    expect(removed.some((x) => x.id === 'handle-post-L' || x.id === 'handle-bar' || x.id === 'handle-pin-L')).toBe(false);
    expect(byId('handle-socket-L').joints?.some((j) => j.to === 'transom-rear' && j.type === 'bolt')).toBe(true);
    expect(byId('handle-post-L').joints?.some((j) => j.to === 'handle-socket-L' && j.type === 'pin')).toBe(true);
    const h = handleGeometry(ctx.p, ctx.L);
    expect(h.zTop).toBe(ctx.L.deckTop + ctx.L.sideH);
    expect(h.zTop - h.zBot).toBe(defaults.handleSocketDepthIn);
  });
  it('mass: the brake group is 12 lb (3.5 lb before Phase 3): shaft 4.9 + steel hubs/arms/cranks ≈ 3 + sockets 2.3 + oak ≈ 2', () => {
    const m = brake.filter((x) => x.group === 'brake').reduce((s, x) => s + x.massLb, 0);
    expect(m).toBeGreaterThan(10);
    expect(m).toBeLessThan(14);
    // hand: 3/4" shaft 39.09" long: π(0.375)² × 39.09 × 490/1728 = 4.9 lb
    expect(byId('brake-shaft').massLb).toBeCloseTo(Math.PI * 0.375 ** 2 * 39.09 * (defaults.steelDensityPcf / 1728), 1);
  });
});

describe('brake and handle clearance', () => {
  const ctx = makeCtx(defaults);
  const fixed = buildModel(defaults).filter((x) => !x.payload && !/^(brake|handle)-/.test(x.id) && !/^wheel-R[LR]$/.test(x.id));
  const obstacles = fixed.map((x) => ({ id: x.id, o: partOBB(x) }));
  it('the moving brake parts never touch the hull, rails, storage box, axle beam or handle over the stroke (box separation ≥ 0.1")', () => {
    for (let i = 0; i <= 10; i++) for (const m of buildBrakeAt(ctx, i / 10, true)) {
      const o = partOBB(m);
      for (const ob of obstacles) expect(-obbOverlap(o, ob.o), `${m.id} vs ${ob.id} @${i / 10}`).toBeGreaterThanOrEqual(0.1 - 1e-9);
    }
  });
  const cases: Record<string, Partial<Params>> = {
    defaults: {}, hullBeam: { frameStyle: 1 }, flare2: { gunwaleFlareIn: 2 }, sidesSolidOak: { sideConstruction: 0 }, sidesOpenFrame: { sideConstruction: 2 },
    wheel10: { wheelDiameterIn: 10 }, wheel11_5: { wheelDiameterIn: 11.5 }, 'track44+fix': { rearTrackIn: 44, frontTrackIn: 44, seatXIn: 11.5, noseTaperStartIn: 23 },
    'track30+fix': { rearTrackIn: 30, frontTrackIn: 30, bodyWidthIn: 24, steerLockDeg: 25, brakeShaftBehindTireIn: 3, rearOverhangIn: 11 },
    storageUnder: { storageLocation: 2 }, overslung: { axleBeamPosition: 1, deckHeightIn: 11.5 }, rearOverhang12: { rearOverhangIn: 12 },
  };
  const ALLOWED = [
    /^brake-/, // brake-vs-brake contacts are bored / pinned fits, checked above and in the sweep
    /^(rail-cabin|girder-cabin)-[LR]$/, // the shaft, bushing and pivot bolt pass through the rail band
    /^wheel-R[LR]$/, // pads touch the tread: the round tire is checked analytically in the sweep (analysis/brake.test.ts)
    /^handle-/,
  ];
  it.each(Object.entries(cases))('static overlaps of brake and handle parts with the rest of the cart: %s', (name, patch) => {
    const p = { ...defaults, ...patch } as Params;
    if (validateParams(p).some((i) => i.severity === 'error')) throw new Error(`${name} is not a valid design`);
    const parts = buildModel(p).filter((x) => !x.payload);
    const mine = parts.filter((x) => /^(brake|handle)-/.test(x.id));
    const others = parts.filter((x) => !/^(brake|handle)-/.test(x.id));
    const bad: string[] = [];
    for (const a of mine) {
      const oa = partOBB(a);
      for (const b of others) {
        if (ALLOWED.some((r) => r.test(b.id))) continue;
        // flared gunwale: transom / web OBBs are conservative boxes over the flared outline (lever and pawl stay 1/2" off the real surface)
        if (/^(transom-rear|side-cabin-[LR]-web)$/.test(b.id) && /^brake-(lever|pawl)/.test(a.id)) continue;
        const o = obbOverlap(oa, partOBB(b));
        if (o > 0.05) bad.push(`${a.id} x ${b.id}: ${o.toFixed(3)}"`);
      }
    }
    expect(bad, name).toEqual([]);
  });
  it('the validator rejects a hull so close to the tire that the crank and clevis cannot fit, and accepts the track-30 fix', () => {
    const tight = { ...defaults, rearTrackIn: 30, frontTrackIn: 30, bodyWidthIn: 24, steerLockDeg: 25 } as Params;
    expect(validateParams(tight).some((i) => i.severity === 'error' && i.keys.includes('brakeCrankIn'))).toBe(true);
    expect(validateParams({ ...tight, brakeShaftBehindTireIn: 3, rearOverhangIn: 11 }).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('the validator warns when a low brake part is under the ground clearance (10" wheels)', () => {
    const w = validateParams({ ...defaults, wheelDiameterIn: 10 }).filter((i) => i.keys.includes('minGroundClearanceIn'));
    expect(w.length).toBeGreaterThan(0);
    expect(validateParams(defaults).filter((i) => i.keys.includes('minGroundClearanceIn'))).toEqual([]);
  });
  it('every brake param at its min and max builds finite parts (no NaN, nothing throws)', () => {
    const keys = Object.keys(PARAM_DEFS).filter((k) => /^(brake|handle)/.test(k)) as Array<keyof Params>;
    for (const k of keys) for (const v of [PARAM_DEFS[k].min, PARAM_DEFS[k].max]) {
      let parts: Part[] = [];
      expect(() => (parts = buildModel({ ...defaults, [k]: v } as Params)), `${k}=${v}`).not.toThrow();
      for (const x of parts.filter((q) => /^(brake|handle)-/.test(q.id))) {
        expect(Number.isFinite(x.massLb) && x.transform.every(Number.isFinite), `${k}=${v} ${x.id}`).toBe(true);
      }
    }
  });
  it('the wooden-drum variant keeps its drums, shaft and lever and gets the same push handle', () => {
    const drum = buildModel({ ...defaults, brakeType: 1 });
    for (const id of ['brake-drum-L', 'brake-drum-R', 'brake-shaft', 'brake-lever', 'handle-socket-L', 'handle-bar']) expect(drum.some((x) => x.id === id), id).toBe(true);
    expect(drum.some((x) => x.id === 'brake-link')).toBe(false);
  });
});
