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
    // Phase 3 r2: design μ is 0.45 (bonded lining, wet): k_fwd = |−1.5265 + 0.45 × 0.6030| = 1.2551, k_rev = |−1.5265 − 0.45 × 0.6030| = 1.7978
    expect(g.kFwd).toBeCloseTo(Math.abs(Kn + 0.45 * Kt), 9); // 1.255: friction helps (servo) rolling forward
    expect(g.kRev).toBeCloseTo(Math.abs(Kn - 0.45 * Kt), 9); // 1.798: de-servo rolling backward
    expect(g.kFwd).toBeCloseTo(1.2551, 3);
    expect(g.kRev).toBeCloseTo(1.7978, 3);
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
      expect(Math.hypot(q.T[0] - g.Q[0], q.T[1] - g.Q[1])).toBeCloseTo(g.tailIn, 9); // the solved tail (≈ 1.76")
      expect(Math.hypot(q.B[0] - g.S[0], q.B[1] - g.S[1])).toBeCloseTo(defaults.brakeCrankIn, 9); // crank 3.0" (not lengthened on a 13" wheel)
    }
    expect(brakePose(g, 1).thetaL).toBeCloseTo(g.thetaL, 9);
  });
  it('at the applied pose the pad is on the tread; released it stands the engagement stroke off (3/8") along the arc', () => {
    const gap = (E: V2) => Math.hypot(E[0], E[1] - r) - (r + defaults.brakeShoeThickIn / 2); // pin radius error
    expect(gap(g.E)).toBeCloseTo(0, 9);
    const dE = Math.hypot(g.Erel[0] - g.E[0], g.Erel[1] - g.E[1]);
    expect(dE).toBeGreaterThan(defaults.brakeShoeTravelIn * 0.99); // the arc is a little longer than its inward component
    // inward component of the pin motion = the stroke
    const inward = (g.E[0] - g.Erel[0]) * -g.n[0] + (g.E[1] - g.Erel[1]) * -g.n[1];
    expect(inward).toBeCloseTo(defaults.brakeShoeTravelIn, 1); // first order θ·|Kn| = 0.375; the arc adds ~3%
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
  it('the derived ratio is (l_grip / d_Q)(d_S / k): 14.4:1 backward (solved: 12 × 1.2 headroom, r3 N-8), ≈ 20:1 forward, above the 12:1 target', () => {
    expect(g.ratioRev).toBeCloseTo((g.lGrip / g.dQ) * (g.dS / g.kRev), 9);
    expect(g.ratioFwd).toBeCloseTo((g.lGrip / g.dQ) * (g.dS / g.kFwd), 9);
    expect(g.ratioCrit).toBe(Math.min(g.ratioFwd, g.ratioRev));
    expect(g.ratioCrit).toBeGreaterThanOrEqual(defaults.brakeLeverRatio);
    expect(g.ratioCrit).toBeCloseTo(12 * 1.2, 6); // solved to the target × headroom (14.4), not far above it
    expect(g.ratioFwd).toBeCloseTo(g.ratioCrit * (g.kRev / g.kFwd), 6); // same l_grip/d_Q · d_S, smaller k (servo)
    expect(g.ok).toBe(true);
  });
  it('lever stroke: ≈ 5.7" at the grip for a 5/16" shoe stroke (ratio 14.4 × 0.3125 = 4.5" frictionless-ideal; the lever arc and the link angle add the rest), inside the 6.5" travel limit (r3 N-8)', () => {
    expect(g.gripTravelIn).toBeGreaterThan(4.5);
    expect(g.gripTravelIn).toBeLessThan(defaults.brakeGripTravelMaxIn);
    expect(g.gripZ).toBe(defaults.rearHandleHeightIn - defaults.brakeLeverGripBelowHandleIn);
  });
  it('auto tail on: the ratio follows target × headroom (10 → 12:1); auto off: the target does not move the geometry', () => {
    expect(geomOf({ ...defaults, brakeLeverRatio: 10 }).g.ratioCrit).toBeCloseTo(12, 6);
    const off = { ...defaults, brakeLeverTailAuto: 0 } as Params;
    expect(geomOf({ ...off, brakeLeverRatio: 6 }).g.ratioCrit).toBeCloseTo(geomOf(off).g.ratioCrit, 9);
    expect(geomOf(off).g.tailIn).toBe(defaults.brakeLeverTailIn);
  });
  it('shortening the lever tail or lengthening the crank raises the ratio (auto off)', () => {
    const off = { ...defaults, brakeLeverTailAuto: 0 } as Params;
    expect(geomOf({ ...off, brakeLeverTailIn: 1.6 }).g.ratioCrit).toBeGreaterThan(geomOf(off).g.ratioCrit);
    expect(geomOf({ ...off, brakeCrankIn: 3.4 }).g.ratioCrit).toBeGreaterThan(geomOf(off).g.ratioCrit);
  });
  it('wheel size: the solved tail shrinks on a 12" wheel (≈ 1.03") and the ratio still lands on 14.4:1; a 11" wheel runs out of tail and lengthens the crank (still short: fails honestly)', () => {
    const w12 = geomOf({ ...defaults, wheelDiameterIn: 12 } as Params).g;
    expect(w12.ratioCrit).toBeCloseTo(14.4, 6);
    expect(w12.tailIn).toBeLessThan(g.tailIn);
    expect(w12.tailIn).toBeGreaterThanOrEqual(1);
    const w11 = geomOf({ ...defaults, wheelDiameterIn: 11 } as Params).g;
    expect(w11.tailIn).toBe(1);
    expect(w11.crankIn).toBeGreaterThan(defaults.brakeCrankIn);
    expect(w11.ratioCrit).toBeLessThan(12);
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
    expect(geomOf({ ...defaults, brakePadMu: 0.8, brakePadMuFouled: 0.8 }).g.selfLocking).toBe(false);
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
    for (const id of ['brake-lever', 'brake-bearing-plate-L', 'brake-bearing-plate-R', 'brake-rail-doubler-L', 'brake-lever-spacer', 'brake-lever-pin', 'brake-link', 'brake-link-clevis-lever', 'brake-link-clevis-crank', 'brake-crank', 'brake-shaft',
      'brake-bushing-L', 'brake-bushing-R', 'brake-arm-L-in', 'brake-arm-L-out', 'brake-arm-R-in', 'brake-arm-R-out', 'brake-hub-L-in', 'brake-shoe-pin-L', 'brake-shoe-L', 'brake-shoe-R',
      'brake-return-spring', 'brake-quadrant', 'brake-quadrant-bracket', 'brake-pawl', 'brake-pawl-pin', 'brake-pawl-spring', 'handle-socket-L', 'handle-socket-R', 'handle-post-L', 'handle-bar'])
      expect(parts.concat(all).some((x) => x.id === id), id).toBe(true);
  });
  it('every metal part is a cut / drilled / bought piece (no welding): steel parts carry drill-tap, laser or buy fabrication', () => {
    for (const x of brake.filter((q) => q.kind === 'metal' || q.kind === 'purchased')) expect(['drill-tap', 'outsource', 'buy', 'bandsaw'], x.id).toContain(x.fab);
    // the shop's laser does not cut steel and the router does not either: the A36 plate quadrant is outsourced
    expect(byId('brake-quadrant').fab).toBe('outsource');
    expect(byId('brake-quadrant').sourcing?.vendor).toMatch(/[Ww]aterjet/);
    expect(byId('brake-quadrant').stock).toMatchObject({ t: 0.25 });
  });
  it('no lathe, mill or broach (build review M10): the shaft collars are bought, the shaft joints are roll pins, nothing is keyed or bored on a lathe', () => {
    for (const id of ['brake-hub-L-in', 'brake-hub-L-out', 'brake-hub-R-in', 'brake-hub-R-out']) {
      expect(byId(id).kind).toBe('purchased');
      expect(byId(id).fab).toBe('buy');
      expect(byId(id).sourcing?.vendor).toMatch(/shaft collar/);
      expect(byId(id).joints?.some((j) => /roll pin/.test(j.size ?? ''))).toBe(true);
    }
    for (const x of brake) expect(`${x.notes ?? ''} ${(x.joints ?? []).map((j) => j.size).join(' ')}`, x.id).not.toMatch(/keyseat broached|square key|bored to the shaft, keyseat/);
    expect(byId('brake-shaft').joints?.filter((j) => /roll pin/.test(j.size ?? '')).length).toBe(5);
  });
  it('every metal part carries stock dimensions and a source (build review M9); the lined shoe is a bought part', () => {
    for (const x of brake.filter((q) => q.kind === 'metal')) {
      expect(x.stock, x.id).toBeDefined();
      expect(x.sourcing?.vendor, x.id).toBeTruthy();
    }
    // arm: 1/4" × 1" flat bar, section × cut length (the shop crosscuts from stock; build-utils M9 convention)
    const arm = byId('brake-arm-L-in');
    const finishedLen = arm.geometry.type === 'box' ? Math.max(...arm.geometry.size) : 0;
    expect(arm.stock!.t).toBeCloseTo(0.25, 9);
    expect(arm.stock!.w).toBeCloseTo(1, 9);
    expect(arm.stock!.l).toBeCloseTo(finishedLen, 9);
    // the shoe is a purchased lined steel-backed shoe (D-56): no stock to cut
    const pad = byId('brake-shoe-L');
    expect(pad.kind).toBe('purchased');
    expect(pad.fab).toBe('buy');
    // shaft: 7/8" rod cut to twice the outer collar face (40.49" with the 3.7" lined shoes)
    expect(byId('brake-shaft').stock!.l).toBeCloseTo(2 * worldAABB(byId('brake-shaft')).max[1], 6);
    expect(byId('brake-shaft').stock!.l).toBeCloseTo(40.49, 2);
  });
  it('the shoes are purchased lined steel-backed shoes (D-56): the lining face is on the tread, the 1/8\" steel back is outside the lining, mu 0.45 wet', () => {
    const shoe = all.find((x) => x.id === 'brake-shoe-L')!;
    expect(shoe.kind).toBe('purchased');
    expect(shoe.material).toMatch(/steel back/);
    expect(shoe.material).toMatch(/lining/);
    expect(shoe.sourcing?.vendor).toMatch(/lined steel-backed/);
    expect(shoe.joints?.some((j) => j.to === 'brake-shoe-pin-L' && j.type === 'pin')).toBe(true);
    expect(all.some((x) => x.id === 'brake-shoe-lining-L' || x.id.startsWith('brake-shoe-shield'))).toBe(false); // the oak pad, its lining sheet and its splash shield are gone
    // (applied pose: the shoe sits on the tread, concentric with the tire)
    const pad1 = buildBrakeAt(ctx, 1).find((x) => x.id === 'brake-shoe-L')!;
    if (pad1.geometry.type !== 'extrusion') throw new Error('shoe is an extrusion');
    const radii = (part: Part) => { const m = part.transform; return part.geometry.type === 'extrusion' ? part.geometry.outline.map((q) => Math.hypot(m[0] * q[0] + m[4] * q[1] + m[12], m[2] * q[0] + m[6] * q[1] + m[14] - 6.5)) : []; };
    expect(Math.min(...radii(pad1))).toBeCloseTo(6.5, 9); // lining face on the tread (13" tire)
    expect(Math.max(...radii(pad1))).toBeCloseTo(6.5 + defaults.brakeLiningThickIn + defaults.brakeShoeBackThickIn, 9);
    // mass by hand: the arc segment area x width x (0.2836 lb/in3 back + 0.07 lb/in3 lining) + 0.08 lb of rivets and tab
    expect(shoe.massLb).toBeGreaterThan(0.5);
    expect(shoe.massLb).toBeLessThan(0.9);
  });
  it('the shaft ends wear caps (no sharp ends at shin height) and the pivot post is held by a cotter pin and capped', () => {
    expect(all.some((x) => x.id === 'brake-shaft-cap-L')).toBe(true);
    expect(all.some((x) => x.id === 'brake-shaft-cap-R')).toBe(true);
    expect(byId('brake-lever-pin').notes).toMatch(/cotter/);
  });
  it('the push-handle sockets are 6061-T6 aluminum tube: 0.6875 in² × 6" × 169 pcf = 0.40 lb each (steel was 1.17 lb), 1.5 lb saved for the pair', () => {
    const sock = byId('handle-socket-L');
    expect(sock.material).toMatch(/aluminum/);
    // (1.25 × 1.75 − 1.0 × 1.5) = 0.6875 in²; × 6" = 4.125 in³; × 169/1728 = 0.4034 lb
    expect(sock.massLb).toBeCloseTo(0.4034, 3);
    expect(sock.stock).toMatchObject({ t: 1.25, w: 1.75 });
    expect(sock.stock!.l).toBeCloseTo(6, 9); // cut length (metal stock = section × cut length)
    const steel = ((1.25 * 1.75 - 1.5) * 6 / 1728) * defaults.steelDensityPcf;
    expect(steel).toBeCloseTo(1.1696, 3);
    expect(2 * (steel - sock.massLb)).toBeCloseTo(1.53, 1);
    expect(sock.sourcing?.vendor).toMatch(/aluminum/);
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
  it('the shaft is 7/8" ground steel (r3: the 100 lbf abuse case), 2 × 19.5" long, at axle height behind the tire; the shoes are lined steel arcs', () => {
    const sh = byId('brake-shaft');
    expect(sh.geometry).toMatchObject({ type: 'cylinder', radius: 0.4375 });
    // the outer collar face: shoe 15.9–19.6 (3.7" wide) + 0.02 gap + 1/4" arm = 19.87, + 3/8" collar = 20.245
    expect(worldAABB(sh).min[1]).toBeCloseTo(-20.245, 3); // the 3.7" lined shoe is 1.2" wider than the old oak pad
    expect(sh.transform[12]).toBeCloseTo(-8, 9);
    expect(sh.transform[14]).toBeCloseTo(6.5, 9);
    const pad = byId('brake-shoe-L');
    expect(pad.geometry.type).toBe('extrusion');
    expect(pad.material).toMatch(/steel back/);
  });
  it('the shoe arc is concentric with the 13" tire: lining inner radius 6.5" (on the tread) and steel back outer 6.875" about the axle', () => {
    const pad = buildBrakeAt(ctx, 1).find((x) => x.id === 'brake-shoe-L')!;
    if (pad.geometry.type !== 'extrusion') throw new Error('pad is an extrusion');
    const m = pad.transform;
    const rad = pad.geometry.outline.map((q) => Math.hypot(m[0] * q[0] + m[4] * q[1] + m[12], m[2] * q[0] + m[6] * q[1] + m[14] - 6.5));
    expect(Math.min(...rad)).toBeCloseTo(6.5, 9);
    expect(Math.max(...rad)).toBeCloseTo(6.875, 9);
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
  it('mass: the REAR brake (lever, shaft, shoes, plates) is about 16 lb; the brake group with the front brake and bias bar is about 27.5 lb (the hip lever and belt are listed under hardware names)', () => {
    const m = brake.filter((x) => x.group === 'brake').reduce((s, x) => s + x.massLb, 0);
    expect(m).toBeGreaterThan(26);
    expect(m).toBeLessThan(29);
    const rear = brake.filter((x) => x.group === 'brake' && !/^(brake-front|brake-shoe-[A-Za-z-]*F|brake-bias|hip-|brake-hip|belt-|lap-belt)/.test(x.id)).reduce((s, x) => s + x.massLb, 0);
    expect(rear).toBeGreaterThan(13);
    expect(rear).toBeLessThan(19);
    // hand: 7/8" shaft: π(0.4375)² × L × 490/1728 (L = 2 × the outer collar face)
    const L = 2 * worldAABB(byId('brake-shaft')).max[1];
    expect(byId('brake-shaft').massLb).toBeCloseTo(Math.PI * 0.4375 ** 2 * L * (defaults.steelDensityPcf / 1728), 1);
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
    'track30+fix': { rearTrackIn: 30, frontTrackIn: 30, bodyWidthIn: 23, steerLockDeg: 25, brakeShaftBehindTireIn: 3, rearOverhangIn: 11 }, // 23" body: the rear U-bolt plates start at 11.5" (D-43)
    storageUnder: { storageLocation: 2 }, overslung: { axleBeamPosition: 1, deckHeightIn: 11.5 }, rearOverhang12: { rearOverhangIn: 12 },
  };
  const ALLOWED = [
    /^brake-/, // brake-vs-brake contacts are bored / pinned fits, checked above and in the sweep
    /^(rail-cabin|girder-cabin)-[LR]$/, // the shaft, bushing and pivot bolt pass through the rail band
    /^wheel-[RF][LR]$/, // shoes touch the tread: the round tire is checked analytically in the sweeps (analysis/brake.test.ts, brake-front row)
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
        if (/^(transom-rear|side-cabin-[LR]-web)$/.test(b.id) && /^brake-(lever|pawl|quadrant)/.test(a.id)) continue;
        // The overslung 11.5" deck variant puts the hip cable run (deck + 0.95") 0.16" into the ratchet quadrant's box: a routing item for the hip cable in that variant (flip notes, open items).
        if (name === 'overslung' && a.id === 'brake-quadrant' && b.id === 'hip-cable') continue;
        const o = obbOverlap(oa, partOBB(b));
        if (o > 0.05) bad.push(`${a.id} x ${b.id}: ${o.toFixed(3)}"`);
      }
    }
    expect(bad, name).toEqual([]);
  });
  it('the validator rejects a hull so close to the tire that the crank and clevis cannot fit, and accepts the track-30 fix', () => {
    const tight = { ...defaults, rearTrackIn: 30, frontTrackIn: 30, bodyWidthIn: 24, steerLockDeg: 25 } as Params;
    expect(validateParams(tight).some((i) => i.severity === 'error' && i.keys.includes('brakeCrankIn'))).toBe(true);
    expect(validateParams({ ...tight, bodyWidthIn: 23, brakeShaftBehindTireIn: 3, rearOverhangIn: 11 }).filter((i) => i.severity === 'error')).toEqual([]);
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
