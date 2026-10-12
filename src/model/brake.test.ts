/**
 * The handler's FOOT brake (Phase 3c-3, D-55; it replaced the D-53 hand lever) and the plain rear push handle (D-9/D-39): the kinematics are checked against independent
 * derivations (hand-placed points, virtual work by finite differences, the shoe gap re-measured from the parts), the parts against their declared contacts, and the whole
 * thing over the parameter extremes.
 */
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, validateParams, type Params } from '../params';
import { makeCtx } from './build-utils';
import { atPose, brakeGeometry, buildBrake, buildBrakeAt, rot2, shoeLengthIn, type V2 } from './brake';
import { HOOK_STANDOFF_IN, HOOK_TOOTH_IN, convexGap, polyZAt, rectPts } from './brake-layout';
import { handleGeometry } from './handle';
import { buildModel } from './index';
import { worldAABB } from './bounds';
import type { Part } from './types';

const defaults = defaultParams();
const RAD = Math.PI / 180;
const geomOf = (p: Params) => { const c = makeCtx(p); return { c, g: brakeGeometry(c.p, c.L) }; };

/** Smallest radial gap (in) from a shoe part's inner-arc point number `k` to the tread, measured from the part's own outline in the world frame. */
function arcGap(shoe: Part, r: number, k: number): number {
  if (shoe.geometry.type !== 'extrusion') throw new Error('shoe');
  const q = shoe.geometry.outline[k];
  const m = shoe.transform;
  const x = m[0] * q[0] + m[4] * q[1] + m[12];
  const z = m[2] * q[0] + m[6] * q[1] + m[14];
  return Math.hypot(x, z - r) - r;
}

describe('foot brake kinematics (hand calculation)', () => {
  const { c, g } = geomOf(defaults);
  const r = c.L.r;
  const beta = defaults.brakeShoeAngleDeg * RAD;
  it('the shoe contact point, the shoe back and the pivot sit where a hand calculation puts them: the pivot straight above the contact', () => {
    // r = 5, β = 5° below the axle line: C = (−r cos β, r − r sin β); back of the 1/8" steel + 1/4" lining at r + 3/8".
    expect(g.C[0]).toBeCloseTo(-5 * Math.cos(beta), 9);
    expect(g.C[1]).toBeCloseTo(5 - 5 * Math.sin(beta), 9);
    expect(g.C[0]).toBeCloseTo(-4.9810, 3);
    expect(g.C[1]).toBeCloseTo(4.5642, 3);
    expect(g.rBack).toBeCloseTo(5.375, 9);
    expect(g.Sb[0]).toBeCloseTo(-5.375 * Math.cos(beta), 9);
    expect(g.P[0]).toBe(g.C[0]);
    expect(g.P[1] - g.C[1]).toBeCloseTo(defaults.brakePivotAboveShoeIn, 9);
    expect(g.P[1]).toBeCloseTo(5.6642, 3);
  });
  it('the arm swing closes the shoe stroke: re-measured from the shoe parts, the center of the lining is on the tread applied and a stroke off it released', () => {
    const rel = buildBrakeAt(c, 0).find((x) => x.id === 'brake-shoe-L')!;
    const app = buildBrakeAt(c, 1).find((x) => x.id === 'brake-shoe-L')!;
    const mid = 9 + 4; // the inner-arc point at the shoe center (the outline is the outer arc, 9 points, then the inner arc, 9 points)
    expect(arcGap(app, r, mid)).toBeCloseTo(0, 6);
    expect(arcGap(rel, r, mid)).toBeCloseTo(defaults.brakeShoeTravelIn, 4);
    // an independent solution of the swing: sin θ ≈ stroke / (d cos β) to first order
    expect(Math.sin(g.thetaApp)).toBeCloseTo(defaults.brakeShoeTravelIn / (defaults.brakePivotAboveShoeIn * Math.cos(beta)), 1);
    expect(g.thetaApp / RAD).toBeGreaterThan(10);
    expect(g.thetaApp / RAD).toBeLessThan(18);
  });
  it('the arms turn about a fixed pivot: the bar goes down and the beam forward, the pivot bolt does not move, rigid distances are kept', () => {
    const a0 = buildBrakeAt(c, 0, true), a1 = buildBrakeAt(c, 1, true);
    const bar0 = worldAABB(a0.find((x) => x.id === 'brake-pedal')!), bar1 = worldAABB(a1.find((x) => x.id === 'brake-pedal')!);
    expect(bar1.min[2]).toBeLessThan(bar0.min[2] - 1.5);
    const beam0 = worldAABB(a0.find((x) => x.id === 'brake-beam')!), beam1 = worldAABB(a1.find((x) => x.id === 'brake-beam')!);
    expect(beam1.max[0]).toBeGreaterThan(beam0.max[0] + 0.2);
    const bolt = (parts: Part[]) => worldAABB(parts.find((x) => x.id === 'brake-pivot-bolt-L')!);
    const all0 = buildBrakeAt(c, 0), all1 = buildBrakeAt(c, 1);
    expect(bolt(all0).min[0]).toBeCloseTo(bolt(all1).min[0], 9);
    expect((bolt(all0).min[0] + bolt(all0).max[0]) / 2).toBeCloseTo(g.P[0], 9);
    expect((bolt(all0).min[2] + bolt(all0).max[2]) / 2).toBeCloseTo(g.P[1], 9);
    // the bar center stays the same distance from the pivot at every pose
    for (const s of [0, 0.3, 0.7, 1]) {
      const q = atPose(g, s, g.bar.c);
      expect(Math.hypot(q[0] - g.P[0], q[1] - g.P[1])).toBeCloseTo(Math.hypot(g.bar.c[0] - g.P[0], g.bar.c[1] - g.P[1]), 9);
    }
    expect(atPose(g, 1, g.bar.c)[0]).toBeCloseTo(g.barApp[0], 9);
  });
  it('virtual work: N / F = (bar drop) / (shoe travel along the normal) = a_app / (d cos β), and with friction a_app / (d (cos β + μ sin β))', () => {
    const h = 1e-6;
    const n: V2 = [Math.cos(beta), Math.sin(beta)]; // from the shoe toward the tire center
    const dBar = rot2(g.barApp, g.P, h); // a small extra turn of the applied pose
    const dC = rot2(g.C, g.P, h);
    const drop = g.barApp[1] - dBar[1];
    const travel = (dC[0] - g.C[0]) * n[0] + (dC[1] - g.C[1]) * n[1];
    expect(drop / travel).toBeCloseTo(g.aApp / (g.d * Math.cos(beta)), 3);
    const mu = defaults.brakePadMu;
    expect(g.ratioFwd).toBeCloseTo(g.aApp / (g.d * (Math.cos(beta) + mu * Math.sin(beta))), 9);
    expect(g.ratioRev).toBeCloseTo(g.aApp / (g.d * (Math.cos(beta) - mu * Math.sin(beta))), 9);
  });
  it('the derived ratio clears the 5:1 target with room (about 7:1), rolling forward is the smaller direction, and the bar drop is inside the travel limit', () => {
    expect(g.ok).toBe(true);
    expect(g.ratioCrit).toBe(Math.min(g.ratioFwd, g.ratioRev));
    expect(g.critical).toBe('forward');
    expect(g.ratioCrit).toBeGreaterThan(defaults.brakeLeverRatio);
    expect(g.ratioCrit).toBeGreaterThan(6.5);
    expect(g.ratioCrit).toBeLessThan(8);
    expect(Math.abs(g.ratioRev - g.ratioFwd) / g.ratioFwd).toBeLessThan(0.1); // no servo: the pivot is straight above the contact
    expect(g.barDrop).toBeLessThan(defaults.brakePedalTravelMaxIn);
    // a_app is shorter than the released reach: the arm has turned and the bar has gone down and forward
    expect(g.aApp).toBeLessThan(g.reach);
    expect(g.aApp).toBeGreaterThan(g.reach - 1.5);
  });
  it('a longer reach or a lower pivot raises the ratio; a pivot too low for the beam slot is reported and nothing throws', () => {
    const long = geomOf({ ...defaults, brakePedalReachIn: 10 } as Params).g;
    expect(long.ratioCrit).toBeGreaterThan(g.ratioCrit);
    const low = geomOf({ ...defaults, brakePivotAboveShoeIn: 0.75 } as Params).g;
    expect(low.ok).toBe(false);
    expect(low.why).toMatch(/pivot hole/);
    expect(Number.isFinite(low.ratioCrit)).toBe(true);
  });
  it('the ground clearance: the arm edge under the bar is brakeBarClearIn released, the lowest lining corner is above the minimum clearance, the parked bar is above its limit', () => {
    const rel = buildBrakeAt(c, 0, true), app = buildBrakeAt(c, 1, true);
    const low = (ps: Part[], re: RegExp) => Math.min(...ps.filter((x) => re.test(x.id)).map((x) => worldAABB(x).min[2]));
    expect(low(rel, /^brake-(arm|pedal)/)).toBeCloseTo(defaults.brakeBarClearIn, 6);
    expect(low(rel, /^brake-/)).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn);
    expect(low(app, /^brake-/)).toBeGreaterThanOrEqual(defaults.brakeParkedClearIn);
    // the bar itself sits a web above the arm's lowest edge
    expect(g.bar.bot).toBeGreaterThan(defaults.brakeBarClearIn + 0.3);
    // departure angle from the rear tire's ground contact to the arm's rear-bottom corner
    const arm = worldAABB(rel.find((x) => x.id === 'brake-arm-L')!);
    expect(Math.atan2(arm.min[2], -arm.min[0]) / RAD).toBeGreaterThan(11);
  });
  it('the bar is where a foot can reach it: behind the transom, with the latch stud between the toe guard and the hook on the transom', () => {
    expect(g.bar.front).toBeLessThan(c.L.xRear - 1);
    expect(g.stud.len).toBeGreaterThan(0.3);
    expect(g.stud.len).toBeLessThan(3.5);
    // the hook hangs in front of the guard and the stud tip passes through its thickness applied
    expect(g.hook.x1).toBeCloseTo(c.L.xRear - HOOK_STANDOFF_IN, 9);
    expect(g.stud.tipApp).toBeGreaterThan(g.hook.x1);
    expect(g.stud.tipApp).toBeLessThan(g.hook.x1 + 0.1);
    expect(g.stud.tipRel).toBeLessThan(c.L.xRear - 0.06); // released: the tip stays clear of the transom face
  });
  it('the latch: the tooth sits 0.02" over the stud applied; released the stud is well above the tooth and the hook swings aside to let it pass', () => {
    expect(g.hook.zTooth - (g.stud.zApp + g.stud.r)).toBeCloseTo(0.02, 6);
    expect(atPose(g, 1, [g.stud.tipRel, g.stud.c[1]])[1]).toBeCloseTo(g.stud.zApp, 9);
    expect(g.stud.c[1] - g.stud.r - (g.hook.zTooth + HOOK_TOOTH_IN)).toBeGreaterThan(0.25);
    expect(g.hook.swing).toBeGreaterThan(0.2);
    expect(g.hook.swing).toBeLessThan(1);
    // the stud passes beside the strap (strap half width 1/2) with 0.2" to spare and the tooth reaches over it
    expect(g.stud.y - g.stud.r - 0.5).toBeCloseTo(0.2, 9);
    expect(g.hook.yTooth).toBeGreaterThan(g.stud.y + g.stud.r);
  });
  it('the arm slots hold the bar and the beam with a web all round, clear of the pivot hole, inside the plate', () => {
    const outline = g.arm.outline;
    for (const slot of [g.arm.beamSlot, g.arm.barSlot]) for (const q of slot) {
      // inside the (convex) hull: the signed gap is penetration
      const d = convexGap([q, [q[0] + 1e-6, q[1]], [q[0], q[1] + 1e-6]], outline);
      expect(d).toBeLessThan(-0.35);
    }
    // the pivot hole to the beam slot: at least 0.2 of web
    const holeBottom = g.P[1] - g.arm.holeR;
    const slotTop = Math.max(...g.arm.beamSlot.map((q) => q[1]));
    expect(holeBottom - slotTop).toBeGreaterThan(0.2);
    // the plate's lowest edge is the pedal ground clearance
    expect(Math.min(...outline.map((q) => q[1]))).toBeCloseTo(defaults.brakeBarClearIn, 6);
  });
  it('the shoe beam clears the bracket tongue (which it passes) by at least 0.1" over the whole stroke, measured exactly in the tongue plane', () => {
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      const rect = rectPts(g.beam.c, g.beam.w, g.beam.h).map((q) => rot2(q, g.P, s * g.thetaApp));
      expect(convexGap(rect, g.tongue.outline), `s=${s}`).toBeGreaterThan(0.1);
    }
  });
  it('the return springs hook to an eye screw just above the lower edge of the rear transom (behind it, so they follow the layout) and their force is the one that gives the pedal-equivalent force', () => {
    const sp = g.spring;
    expect(sp.e[0]).toBeLessThan(c.L.xRear);
    expect(sp.e[1]).toBeCloseTo(c.L.deckTop - defaults.crossmemberDepthIn + 0.45, 9);
    expect(sp.lenRel).toBeGreaterThan(1); // the 8 in deck (D-56) brings the transom's eye screw closer to the arm: 1.24 in at the defaults (2.8 in at the old 14.75 in deck)
    expect(sp.fRel).toBeCloseTo(0.8 * sp.fApp, 9);
    expect(sp.lenApp).toBeGreaterThan(sp.lenRel);
    // both springs, moments about the pivot: 2 F lever = F_pedal a_app
    expect(2 * sp.fApp * sp.leverApp).toBeCloseTo(defaults.brakeSpringForceLbf * g.aApp, 6);
    expect(polyZAt(g.arm.outline, sp.a[0])![1] - sp.a[1]).toBeCloseTo(0.4, 6); // hook hole 0.4" below the arm's top edge
  });
});

describe('foot brake parts', () => {
  const ctx = makeCtx(defaults);
  const brake = buildBrake(ctx);
  const all = buildModel(defaults);
  const byId = (id: string) => all.find((x) => x.id === id)!;
  const { g } = geomOf(defaults);
  const ids = ['brake-pedal', 'brake-guard', 'brake-arm-L', 'brake-arm-R', 'brake-beam', 'brake-shoe-L', 'brake-shoe-R', 'brake-bracket-L', 'brake-bracket-R', 'brake-pivot-bolt-L',
    'brake-pivot-bolt-R', 'brake-stop-pin-L', 'brake-stop-pin-R', 'brake-return-spring-L', 'brake-return-spring-R', 'brake-latch-stud', 'brake-latch-hook', 'brake-latch-bolt',
    'handle-socket-L', 'handle-socket-R'];
  it('has the whole chain: pedal bar, toe guard, two arms, shoe beam, two shoes, two brackets with pivot bolts and stop pins, two springs, the latch (stud, hook, bolt), handle sockets', () => {
    for (const id of ids) expect(brake.some((x) => x.id === id), id).toBe(true);
  });
  it('the hand lever mechanism is gone: no lever, grip, links, clevis, keeper straps, transom bracket, ears, quadrant or parking pin; no cross shaft, ratchet, front brakes, hip lever, belt', () => {
    const banned = /^(brake-(lever|link|clevis|keeper|pivot-base|pivot-ear|pivot-pin|park|shaft|bearing-plate|rail-doubler|bushing|hub|crank|quadrant|pawl|front|bias|drum)|hip-|lap-belt|belt-|brake-hip|brake-lost)/;
    expect(all.filter((x) => banned.test(x.id)).map((x) => x.id)).toEqual([]);
    expect(all.some((x) => /^brake-shoe-F/.test(x.id))).toBe(false);
  });
  it('every metal part is a cut, drilled or bought piece (no welding), with a source and stock dimensions', () => {
    for (const x of brake.filter((q) => q.group === 'brake' && (q.kind === 'metal' || q.kind === 'purchased'))) {
      expect(['drill-tap', 'outsource', 'buy'], x.id).toContain(x.fab);
      expect(x.sourcing?.vendor, x.id).toBeTruthy();
      if (x.kind === 'metal') expect(x.stock, x.id).toBeDefined();
      expect(`${x.notes ?? ''} ${x.sourcing?.vendor ?? ''}`.toLowerCase(), x.id).not.toMatch(/\bweld(ed|ing)?\b/);
    }
  });
  it('the pedal bar is white oak 2" x 1-1/4" with the front-lower edge chamfered; it spans the arms plus an inch each side and sits behind the transom', () => {
    const b = byId('brake-pedal');
    expect(b.kind).toBe('lumber');
    expect(b.material).toMatch(/white oak/);
    expect(b.grain).toBe('y');
    expect(b.geometry.type === 'extrusion' && b.geometry.outline.length).toBe(5); // rectangle with the chamfered corner
    const bb = worldAABB(b);
    expect(bb.max[1]).toBeCloseTo(g.y.arm[1] + 1, 9);
    expect(bb.min[1]).toBeCloseTo(-(g.y.arm[1] + 1), 9);
    expect(bb.max[0]).toBeLessThan(ctx.L.xRear - 1);
    expect(b.stock).toMatchObject({ t: defaults.brakePedalHeightIn, w: defaults.brakePedalDepthIn });
    // mass: section (with the chamfer cut off) x length x 47 pcf plus finish
    const sec = defaults.brakePedalDepthIn * defaults.brakePedalHeightIn - 0.5 * defaults.brakeBarKickIn ** 2;
    const vol = sec * 2 * (g.y.arm[1] + 1);
    expect(b.massLb).toBeGreaterThan((vol / 1728) * 47);
    expect(b.massLb).toBeLessThan((vol / 1728) * 47 + 0.6);
  });
  it('the shoe beam is a 6061-T6 rectangular tube through both arms: 1.5" x 1" x 1/8" wall, from shoe to shoe plus a quarter inch, mass from the section', () => {
    const b = byId('brake-beam');
    expect(b.material).toMatch(/6061-T6 aluminum rectangular tube/);
    const bb = worldAABB(b);
    expect(bb.max[1]).toBeCloseTo(defaults.rearTrackIn / 2 + defaults.brakeLinedShoeWidthIn / 2 + 0.25, 6);
    const w = defaults.brakeBeamSizeIn, h = defaults.brakeBeamHeightIn, t = defaults.brakeBeamWallIn;
    const section = w * h - (w - 2 * t) * (h - 2 * t);
    expect(b.massLb).toBeCloseTo((section * 2 * bb.max[1] * defaults.aluminumDensityPcf) / 1728, 6);
    expect(b.stock).toMatchObject({ t, w: h });
  });
  it('the shoes are purchased lined steel-backed shoes at the ends of the beam, radius-matched to the 10" tire: lining inner radius 5.0" about the axle applied, steel back outer 5.375"', () => {
    for (const tag of ['L', 'R']) {
      const sh = byId(`brake-shoe-${tag}`);
      expect(sh.kind).toBe('purchased');
      expect(sh.material).toMatch(/steel back/);
      expect(sh.geometry.type).toBe('extrusion');
      expect(Math.abs((worldAABB(sh).min[1] + worldAABB(sh).max[1]) / 2)).toBeCloseTo(defaults.rearTrackIn / 2, 6);
    }
    const app = buildBrakeAt(ctx, 1).find((x) => x.id === 'brake-shoe-L')!;
    if (app.geometry.type !== 'extrusion') throw new Error('shoe');
    const radii = app.geometry.outline.map((q) => {
      const m = app.transform;
      return Math.hypot(m[0] * q[0] + m[4] * q[1] + m[12], m[2] * q[0] + m[6] * q[1] + m[14] - ctx.L.r);
    });
    expect(Math.min(...radii)).toBeCloseTo(5, 6);
    expect(Math.max(...radii)).toBeCloseTo(5 + defaults.brakeLiningThickIn + defaults.brakeShoeBackThickIn, 6);
    expect(shoeLengthIn(defaults)).toBe(3);
  });
  it('the swing arms are 1/8" A36 plate outside the bracket tongues with three holes (two slots and the pivot); the toe guard is 1/8" aluminum, 3" above the bar, centered', () => {
    for (const tag of ['L', 'R']) {
      const a = byId(`brake-arm-${tag}`);
      expect(a.material).toMatch(/A36/);
      expect(a.geometry.type === 'extrusion' && a.geometry.holes?.length).toBe(3);
      const bb = worldAABB(a), tb = worldAABB(byId(`brake-bracket-${tag}`));
      expect(bb.max[1] - bb.min[1]).toBeCloseTo(defaults.brakePlateThickIn, 9);
      // outside the tongue by the 1/16" washer gap
      const gap = tag === 'L' ? bb.min[1] - tb.max[1] : tb.min[1] - bb.max[1];
      expect(gap).toBeCloseTo(0.0625, 9);
    }
    const gd = byId('brake-guard');
    expect(gd.material).toMatch(/6061-T6 aluminum plate/);
    const gb = worldAABB(gd), pb = worldAABB(byId('brake-pedal'));
    expect(gb.max[2] - pb.max[2]).toBeCloseTo(defaults.brakeToeGuardHeightIn, 6);
    expect(gb.max[1] + gb.min[1]).toBeCloseTo(0, 9);
    expect(gb.max[1]).toBeCloseTo(defaults.brakeToeGuardWidthIn / 2, 9);
    expect(gb.max[0]).toBeCloseTo(pb.max[0] + defaults.brakeGuardThickIn, 6); // on the front of the bar
  });
  it('the brackets are 1/8" A36 plate bolted to the TOP of the axle beam: nothing is bolted to the rails, the hangers or the transom except the latch bolt', () => {
    for (const tag of ['L', 'R']) {
      const b = byId(`brake-bracket-${tag}`);
      expect(b.joints!.some((j) => j.to === 'beam-R' && j.type === 'bolt' && j.count === 2)).toBe(true);
      expect(b.joints!.some((j) => /^(rail|axle-hanger|transom)/.test(j.to))).toBe(false);
      expect(b.notes).toMatch(/TOP of the rear axle beam/);
      // the tongue starts at the beam's rear face, above the beam top
      const bb = worldAABB(b);
      expect(bb.max[0]).toBeCloseTo(ctx.L.beamR.x - ctx.L.beamR.thick / 2, 6);
    }
    expect(byId('brake-latch-hook').joints!.some((j) => j.to === 'transom-rear')).toBe(true);
  });
  it('the latch hook hangs plumb on the centerline from a bolt through the lower edge of the rear transom, 0.45" off its face; the stud is 1/2" stainless', () => {
    const hk = byId('brake-latch-hook'), tr = worldAABB(byId('transom-rear'));
    const hb = worldAABB(hk);
    expect(tr.min[0] - hb.max[0]).toBeCloseTo(HOOK_STANDOFF_IN, 9);
    expect(hb.max[2]).toBeLessThan(tr.max[2]);
    expect(hb.min[2]).toBeGreaterThan(defaults.minGroundClearanceIn);
    const bolt = worldAABB(byId('brake-latch-bolt'));
    expect(bolt.max[0]).toBeGreaterThan(tr.max[0]); // through the transom
    expect((bolt.min[2] + bolt.max[2]) / 2).toBeGreaterThan(tr.min[2] + 0.5);
    expect(byId('brake-latch-stud').material).toMatch(/316/);
    expect(g.hook.length).toBeGreaterThan(2); // 2.18 in at the 8 in deck (D-56)
  });
  it('bought hardware lists its source; every joint names a mating part that exists', () => {
    const idset = new Set(all.map((x) => x.id));
    for (const x of brake.filter((q) => q.kind === 'purchased' && q.fab === 'buy')) expect(x.sourcing?.vendor, x.id).toBeTruthy();
    for (const x of brake) for (const j of x.joints ?? []) {
      expect(j.count, `${x.id} → ${j.to}`).toBeGreaterThan(0);
      expect(idset.has(j.to), `${x.id} joint to ${j.to}`).toBe(true);
    }
  });
  it('wood parts have a grain direction; steel and bought parts do not claim one; explode directions are unit vectors', () => {
    for (const x of brake) {
      if (x.material.includes('oak')) expect(x.grain, x.id).toBeDefined();
      if (x.kind === 'metal' || x.kind === 'purchased') expect(x.grain, x.id).toBeUndefined();
      expect(Math.hypot(...x.explode!), x.id).toBeCloseTo(1, 6);
    }
  });
  it('the push-handle sockets are 6061-T6 aluminum tube: 0.6875 in² × 6" × 169 pcf = 0.40 lb each', () => {
    const sock = byId('handle-socket-L');
    expect(sock.material).toMatch(/aluminum/);
    expect(sock.massLb).toBeCloseTo(0.4034, 3);
    expect(sock.stock).toMatchObject({ t: 1.25, w: 1.75 });
    expect(sock.stock!.l).toBeCloseTo(6, 9);
    expect(sock.sourcing?.vendor).toMatch(/aluminum/);
  });
  it('all brake parts stay at or above the minimum ground clearance released, and the springs hang behind the transom below its lower edge', () => {
    for (const x of buildBrakeAt(ctx, 0).filter((q) => /^brake-/.test(q.id))) expect(worldAABB(x).min[2], x.id).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn - 1e-6);
    const tr = worldAABB(byId('transom-rear'));
    for (const tag of ['L', 'R']) {
      const sp = worldAABB(byId(`brake-return-spring-${tag}`));
      expect(sp.max[0]).toBeLessThanOrEqual(tr.min[0]);
      expect(sp.max[2]).toBeLessThanOrEqual(tr.min[2] + 0.5);
    }
  });
  it('the handle is a PLAIN handle: no brake lever, bracket or spring on the transom face, and no mention of a lever in the handle parts; posts, bow and sockets are unchanged', () => {
    expect(all.some((x) => /^brake-(lever|pivot-base|pivot-ear|park)/.test(x.id))).toBe(false);
    for (const x of all.filter((q) => /^handle-/.test(q.id))) expect(`${x.notes ?? ''} ${x.name}`.toLowerCase(), x.id).not.toMatch(/lever/);
    const removed = buildModel(defaults, { removed: true });
    expect(removed.some((x) => x.id === 'handle-socket-L')).toBe(true);
    expect(removed.some((x) => x.id === 'handle-post-L' || x.id === 'handle-bar' || x.id === 'handle-pin-L')).toBe(false);
    expect(byId('handle-socket-L').joints?.some((j) => j.to === 'transom-rear' && j.type === 'bolt')).toBe(true);
    expect(byId('handle-post-L').joints?.some((j) => j.to === 'handle-socket-L' && j.type === 'pin')).toBe(true);
    const h = handleGeometry(ctx.p, ctx.L);
    expect(h.zTop).toBe(ctx.L.deckTop + ctx.L.sideRear);
    expect(h.zTop - h.zBot).toBe(defaults.handleSocketDepthIn);
  });
  it('mass: the whole brake group (pedal, guard, arms, beam, shoes, brackets, latch, springs, sockets) is about 10 lb, 1.2 lb more than the 8.7 lb hand-lever brake', () => {
    const m = brake.filter((x) => x.group === 'brake').reduce((s, x) => s + x.massLb, 0);
    expect(m).toBeGreaterThan(8.7);
    expect(m).toBeLessThan(11.5);
    // the biggest items are the beam (2.1 lb) and the oak bar (1.7 lb)
    expect(byId('brake-beam').massLb).toBeGreaterThan(byId('brake-pedal').massLb);
  });
});

describe('foot brake validation and the extremes', () => {
  it('the defaults validate clean; a pivot too low for the beam slot, a bar too close to the transom, a short shoe-clearance and a wide body are caught', () => {
    expect(validateParams(defaults).filter((i) => i.severity !== 'info')).toEqual([]);
    const low = validateParams({ ...defaults, brakePivotAboveShoeIn: 0.8 });
    expect(low.some((i) => i.severity === 'error' && i.keys.includes('brakePivotAboveShoeIn'))).toBe(true);
    const near = validateParams({ ...defaults, brakePedalReachIn: 4.5, rearOverhangIn: 8 });
    expect(near.some((i) => i.severity === 'error' && i.keys.includes('brakePedalReachIn'))).toBe(true);
    const far = validateParams({ ...defaults, rearOverhangIn: 6 });
    expect(far.some((i) => i.keys.includes('brakePedalReachIn') && /stud/.test(i.message))).toBe(true);
    const wide = validateParams({ ...defaults, bodyWidthIn: 28 });
    expect(wide.some((i) => i.keys.includes('clampPlateWidthIn') && /bracket flange/.test(i.message))).toBe(true);
    const lowBar = validateParams({ ...defaults, brakeBarClearIn: 2 });
    expect(lowBar.some((i) => i.keys.includes('brakeBarClearIn'))).toBe(true);
    const longShoe = validateParams({ ...defaults, brakeLinedShoeLengthIn: 5 });
    expect(longShoe.some((i) => i.keys.includes('brakeLinedShoeLengthIn'))).toBe(true);
  });
  it('every brake and handle param at its min and max builds finite parts (no NaN, nothing throws)', () => {
    const keys = Object.keys(PARAM_DEFS).filter((k) => /^(brake|handle)/.test(k)) as Array<keyof Params>;
    for (const k of keys) for (const v of [PARAM_DEFS[k].min, PARAM_DEFS[k].max]) {
      let parts: Part[] = [];
      expect(() => (parts = buildModel({ ...defaults, [k]: v } as Params)), `${k}=${v}`).not.toThrow();
      for (const x of parts.filter((q) => /^(brake|handle)-/.test(q.id))) {
        expect(Number.isFinite(x.massLb) && x.transform.every(Number.isFinite), `${k}=${v} ${x.id}`).toBe(true);
      }
    }
  });
  it('the removed hand-lever params are gone from the param table (old shared URLs still load: decodeHash ignores unknown keys)', () => {
    for (const k of ['brakeLeverWidthIn', 'brakeLeverStandoffIn', 'brakeKeeperThickIn', 'brakeParkPitchIn', 'brakeParkRadiusIn', 'brakeBarWidthIn', 'brakeBarThickIn', 'brakeLeverTailIn',
      'brakeLeverTiltDeg', 'brakeGripTravelMaxIn', 'brakeAbuseLbf', 'brakeClevisPinDiameterIn', 'brakeLeverGripBelowHandleIn', 'handleForceLimitLbf'])
      expect(Object.prototype.hasOwnProperty.call(PARAM_DEFS, k), k).toBe(false);
    for (const k of ['brakeFootForceLimitLbf', 'brakeFootAbuseLbf', 'brakeBarClearIn', 'brakeFootGapMinIn', 'brakeToeGuardMinIn']) {
      const d = PARAM_DEFS[k as keyof Params];
      expect(d.status, k).toBe('assumed');
      expect(d.ref, k).toMatch(/D-55/);
    }
    expect(PARAM_DEFS.brakeFootForceLimitLbf.default).toBe(60);
    expect(PARAM_DEFS.brakeBarClearIn.default).toBeGreaterThanOrEqual(3);
  });
});
