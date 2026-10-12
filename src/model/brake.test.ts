/**
 * The handler's STEP BRAKE (Phase 3c-4b, D-57 item 8) and the plain rear push handle (D-9/D-39): the layout is checked against independent derivations (hand-placed
 * points, the pad re-measured from the parts, the moments about the pivot pin from raw vectors), the parts against their declared mounts, and the whole thing over the
 * parameter extremes (the flaps follow the wheels, never a typed track).
 */
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, sanitizeParams, validateParams, type Params } from '../params';
import { makeCtx } from './build-utils';
import { atPose, brakeGeometry, buildBrake, buildBrakeAt } from './brake';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { partsOverlap, worldAABB } from './bounds';
import { SIGN_X_MAX_IN } from './body';
import type { Part } from './types';

const defaults = defaultParams();
const RAD = Math.PI / 180;
const geomOf = (p: Params) => { const c = makeCtx(p); return { c, g: brakeGeometry(c.p, c.L) }; };
const cross = (r: [number, number], f: [number, number]) => r[1] * f[0] - r[0] * f[1];

/** Radial gap (in) of the pad's tread-side arc point number `k` to the tread, from the part's own outline in the world frame. */
function arcGap(pad: Part, r: number, k: number): number {
  if (pad.geometry.type !== 'extrusion') throw new Error('pad');
  const q = pad.geometry.outline[k];
  const m = pad.transform;
  return Math.hypot(m[0] * q[0] + m[4] * q[1] + m[12], m[2] * q[0] + m[6] * q[1] + m[14] - r) - r;
}

describe('step brake layout (hand calculation)', () => {
  const { c, g } = geomOf(defaults);
  const r = c.L.r;
  const a = defaults.brakePadAngleDeg * RAD;
  it('the pad contact and the pivot pin sit where a hand calculation puts them: the knee rear face ahead of the tire front (and of the sign zone), the pin brakePivotEndIn forward of it, the pad just behind the top of the tire', () => {
    expect(g.ok, g.why).toBe(true);
    expect(g.C[0]).toBeCloseTo(-r * Math.sin(a), 9);
    expect(g.C[1]).toBeCloseTo(r + r * Math.cos(a), 9);
    const kneeX0 = Math.max(r + defaults.brakePivotAheadIn, SIGN_X_MAX_IN);
    expect(g.knee.x0).toBeCloseTo(kneeX0, 9);
    expect(g.P[0]).toBeCloseTo(kneeX0 + defaults.brakePivotEndIn, 9); // the point on the flap top above the pin
    expect(g.H[0]).toBeCloseTo(g.P[0] - g.plan.hPin * g.v[0], 9);
    expect(g.H[0]).toBeGreaterThan(r + 0.25);
    expect(g.xh).toBe(g.H[0]);
    expect(g.H[1]).toBeGreaterThan(2 * r); // the pin is above the top of the tire: the flap arches over it
    // D-65: the pin is in the middle of the tongue stack (flap + pivot block): equal wood above and below it
    expect(g.pivot.edgeTongueUp).toBeCloseTo(g.pivot.edgeTongueDown, 9);
    expect(g.pivot.edgeTongueUp).toBeCloseTo((defaults.brakeFlapThickIn + defaults.brakePivotBlockIn) / 2, 9);
  });
  it('the flap clears the pad by the shoe block thickness along the underside plane, and the foot point is on its top surface', () => {
    // the highest point of the pad's top arc, measured on the up normal of the board, plus the block thickness, is the underside offset
    const v = g.v;
    const topMax = Math.max(...g.pad.top.map((q) => q[0] * v[0] + q[1] * v[1]));
    expect(g.c - topMax).toBeCloseTo(defaults.brakeShoeBlockIn, 9);
    expect(g.F[0] * v[0] + g.F[1] * v[1]).toBeCloseTo(g.c + defaults.brakeFlapThickIn, 9);
    expect(g.P[0] * v[0] + g.P[1] * v[1]).toBeCloseTo(g.c + defaults.brakeFlapThickIn, 9);
    expect(g.H[0] * v[0] + g.H[1] * v[1]).toBeCloseTo(g.c + defaults.brakeFlapThickIn - g.plan.hPin, 9); // the pin axis is hPin under the top surface
    expect(Math.atan2(-g.u[1], -g.u[0]) / RAD).toBeCloseTo(defaults.brakeFlapSlopeDeg, 9); // the board descends toward the rear
  });
  it('D-65: the flap and its foot tread END AT the rear transom face: nothing of the flap kit sticks out behind it, the foot point is the middle of the tread', () => {
    expect(defaults.brakeFlapEndBehindTransomIn).toBe(0);
    expect(g.xEnd).toBeCloseTo(c.L.xRear, 9);
    expect(g.F[0]).toBeCloseTo(c.L.xRear + defaults.brakeFootPadLengthIn / 2, 9); // 2 in ahead of the transom face
    const kit = buildBrake(c).filter((x) => /^brake-(flap|pivot-block|foot-tread|shoe|pad)-L$/.test(x.id));
    expect(kit).toHaveLength(5);
    for (const x of kit) expect(worldAABB(x).min[0], x.id).toBeGreaterThanOrEqual(c.L.xRear - 0.12); // the sloping end face's lower corner swings back about a tenth of an inch
    const flap = worldAABB(kit.find((x) => x.id === 'brake-flap-L')!);
    expect(Math.abs(flap.min[0] - g.xEnd)).toBeLessThan(0.15);
    expect(Math.min(...[flap.min[1], flap.max[1]].map(Math.abs))).toBeGreaterThan(c.L.hwC + c.L.side); // outboard of the body
    // the only hardware behind the face is the ring of the cord's eye in the flap's end face and the snap hook at the transom (0.35 in)
    expect(worldAABB(buildBrake(c).find((x) => x.id === 'brake-cord-L')!).min[0]).toBeGreaterThan(c.L.xRear - 0.6);
  });
  it('the foot lever is shorter than before the flap was shortened: the foot point is 15 in from the pin (was 17.5 in) and the ratio averages about 2.0:1 (was 2.3)', () => {
    expect(g.aF).toBeGreaterThan(14.5);
    expect(g.aF).toBeLessThan(15.5);
    expect((g.ratioFwd + g.ratioRev) / 2).toBeGreaterThan(1.9);
    expect((g.ratioFwd + g.ratioRev) / 2).toBeLessThan(2.1);
  });
  it('the lever ratio is geometry: re-derived from raw moments about the pin, ~2:1, and friction is the small second term', () => {
    const rC: [number, number] = [g.C[0] - g.H[0], g.C[1] - g.H[1]];
    const n: [number, number] = [-Math.sin(a), Math.cos(a)], t: [number, number] = [Math.cos(a), Math.sin(a)];
    const mN = cross(rC, n), mT = cross(rC, t);
    expect(g.mN).toBeCloseTo(mN, 9);
    expect(g.mT).toBeCloseTo(mT, 9);
    const aF = g.H[0] - g.F[0];
    expect(g.aF).toBeCloseTo(aF, 9);
    const mu = defaults.brakePadMu;
    expect(g.ratioFwd).toBeCloseTo(aF / (mN + mu * mT), 9);
    expect(g.ratioRev).toBeCloseTo(aF / (mN - mu * mT), 9);
    expect(g.ratioCrit).toBeCloseTo(Math.min(g.ratioFwd, g.ratioRev), 9);
    expect(g.ratioCrit).toBeGreaterThan(1.7);
    expect(g.ratioCrit).toBeLessThan(2.6);
    expect(Math.abs(mu * mT / mN)).toBeLessThan(0.15); // the friction line passes close to the pin: no servo effect
  });
  it('the swing closes the pad gap: re-measured from the pad part, the pad is on the tread applied and a gap off it released (at its nearest point)', () => {
    const rel = buildBrakeAt(c, 0).find((x) => x.id === 'brake-pad-L')!;
    const app = buildBrakeAt(c, 1).find((x) => x.id === 'brake-pad-L')!;
    const n = 9; // 9 tread-side points, then 9 top points
    const gapsRel = Array.from({ length: n }, (_, k) => arcGap(rel, r, k));
    const gapsApp = Array.from({ length: n }, (_, k) => arcGap(app, r, k));
    for (const gp of gapsApp) expect(gp).toBeCloseTo(0, 6);
    // the center of the pad is the gap param; the ends hang a little closer or farther (they are on an arc about the pin)
    expect(gapsRel[4]).toBeCloseTo(defaults.brakePadGapIn, 3);
    expect(Math.min(...gapsRel)).toBeGreaterThan(0.5 * defaults.brakePadGapIn);
    // independent first-order solution: gap = lever x angle, the lever being the distance pin to pad center
    const lever = Math.hypot(g.C[0] - g.H[0], g.C[1] - g.H[1]);
    expect(g.theta).toBeCloseTo(defaults.brakePadGapIn / lever, 2);
    expect(g.theta / RAD).toBeGreaterThan(1.5);
    expect(g.theta / RAD).toBeLessThan(5);
  });
  it('the flap group turns about the fixed pin: the foot area goes down, the pin does not move, rigid distances are kept', () => {
    const a0 = buildBrakeAt(c, 0, true), a1 = buildBrakeAt(c, 1, true);
    const fl0 = worldAABB(a0.find((x) => x.id === 'brake-flap-L')!), fl1 = worldAABB(a1.find((x) => x.id === 'brake-flap-L')!);
    expect(fl0.min[2] - fl1.min[2]).toBeGreaterThan(0.5); // the rear end drops
    expect(Math.abs(fl0.min[2] - fl1.min[2] - g.footDrop)).toBeLessThan(0.2); // (the lowest corner of the end face swings a little farther than the foot point)
    expect(g.footDrop).toBeLessThan(defaults.brakeFootStrokeMaxIn);
    const p0 = atPose(g, 0, g.F), p1 = atPose(g, 1, g.F);
    expect(p1[0]).toBeCloseTo(g.F[0], 9);
    expect(p0[1] - p1[1]).toBeCloseTo(g.footDrop, 9);
    const q0 = atPose(g, 0, g.H);
    expect(q0[0]).toBeCloseTo(g.H[0], 9);
    expect(q0[1]).toBeCloseTo(g.H[1], 9);
    const d = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    for (const s of [0, 0.3, 0.7, 1]) expect(d(atPose(g, s, g.F), atPose(g, s, g.C))).toBeCloseTo(d(g.F, g.C), 9);
    expect(buildBrakeAt(c, 0, true).every((x) => /^brake-(flap|pivot-block|foot-tread|shoe|pad|cord)-/.test(x.id))).toBe(true); // movingOnly: nothing fixed (no pin, clip, snap hook, knee), no handle
  });
});

describe('step brake parts', () => {
  const parts = buildModel(defaults);
  const brake = parts.filter((x) => x.group === 'brake');
  const byId = (id: string) => parts.find((x) => x.id === id)!;
  const L = computeLayout(defaults);
  it('builds the flap, pivot block, pin and clip, shoe block, pad, foot tread, knee, backer, return cord with its snap hook and chock with its cord on each side, and no trace of the D-55 steel parts or the old hinge', () => {
    for (const tag of ['L', 'R']) {
      for (const k of ['flap', 'pivot-block', 'pivot-pin', 'pivot-clip', 'shoe', 'pad', 'foot-tread', 'knee', 'backer', 'cord', 'snap', 'chock', 'chock-cord']) expect(byId(`brake-${k}-${tag}`), `${k}-${tag}`).toBeDefined();
    }
    expect(parts.some((x) => /^brake-hinge/.test(x.id)), 'the butt hinge is gone (D-65)').toBe(false);
    for (const gone of ['brake-pedal', 'brake-guard', 'brake-beam', 'brake-arm-L', 'brake-bracket-L', 'brake-latch-hook', 'brake-latch-stud', 'brake-return-spring-L', 'brake-pivot-bolt-L', 'brake-stop-pin-L']) {
      expect(parts.some((x) => x.id === gone), gone).toBe(false);
    }
    expect(brake.every((x) => !/steel plate|aluminum|A36/i.test(x.material) || /^handle-/.test(x.id)), 'no plate steel or aluminum in the brake').toBe(true);
  });
  it('every part has its group, step, explode direction, mass, joints and a source where bought; fasteners carry diameters', () => {
    for (const x of brake) {
      expect(x.step, x.id).toBeGreaterThan(0);
      expect(x.explode, x.id).toBeDefined();
      expect(Math.abs(Math.hypot(...x.explode!) - 1) < 1e-9 || Math.hypot(...x.explode!) === 0, x.id).toBe(true);
      expect(x.massLb, x.id).toBeGreaterThan(0);
      if (/^brake-/.test(x.id)) {
        expect(x.notes, x.id).toBeTruthy();
        if (x.kind === 'purchased' || x.kind === 'metal') expect(x.sourcing?.vendor, x.id).toBeTruthy();
        expect(x.joints?.length, x.id).toBeGreaterThan(0);
        for (const j of x.joints ?? []) if (j.type === 'bolt' || j.type === 'screw') expect(j.diaIn, `${x.id} -> ${j.to}`).toBeGreaterThan(0);
      }
    }
    const knee = byId('brake-knee-L');
    expect(knee.joints!.find((j) => j.type === 'bolt')!.size).toMatch(/316 hex bolts/);
    expect(byId('brake-flap-L').grain).toBe('x');
    expect(byId('brake-flap-L').stock).toBeDefined();
  });
  it('display finishes: the flap, shoe block, knee, backer and chocks are oak, the pad rubber, the pivot pin stainless steel, the cords rope', () => {
    for (const id of ['brake-flap-L', 'brake-shoe-L', 'brake-knee-R', 'brake-backer-L', 'brake-chock-L']) expect(byId(id).finish?.surface, id).toBe('oak');
    expect(byId('brake-pad-L').finish?.surface).toBe('rubber');
    expect(byId('brake-pivot-pin-R').finish?.surface).toBe('steel');
    expect(byId('brake-pivot-block-L').finish?.surface).toBe('oak');
    for (const id of ['brake-cord-L', 'brake-chock-cord-R']) expect(byId(id).finish?.surface, id).toBe('rope');
  });
  it('the knee is bolted through the rail into the backer: the knee sits on the hull outer face, the backer on the rail inner face, and neither overlaps the rail, the tire or the hull', () => {
    const knee = worldAABB(byId('brake-knee-L'));
    const rail = worldAABB(byId('rail-L'));
    expect(knee.min[1]).toBeCloseTo(L.hwC + L.side, 2); // the hull's outer face
    expect(knee.min[2]).toBeCloseTo(rail.min[2], 2); // on the rail bottom
    for (const id of ['rail-L', 'wheel-RL', 'side-L-chine', 'side-L-gunwale', 'axle-hanger-L']) expect(partsOverlap(byId('brake-knee-L'), byId(id)), id).toBeLessThanOrEqual(0.05);
    for (const id of ['rail-L', 'deck', 'joist-2', 'beam-hold-down-L', 'axle-hanger-L']) expect(partsOverlap(byId('brake-backer-L'), byId(id)), id).toBeLessThanOrEqual(0.05);
    const tire = worldAABB(byId('wheel-RL'));
    expect(knee.min[0]).toBeGreaterThan(tire.max[0] + 1.0); // ahead of the tire front (D-65: 1-1/4 in, the rear face of the knee)
    const pin = worldAABB(byId('brake-pivot-pin-L'));
    expect(pin.min[0]).toBeGreaterThan(knee.min[0]); // D-65: the pin is inside the knee, with oak behind it (the ears) and ahead of it
    expect(pin.max[0]).toBeLessThan(knee.max[0]);
    expect(pin.max[1]).toBeGreaterThan(knee.max[1]); // its outboard end (the cross hole and the clip) sticks out of the knee's outer face
    expect(pin.max[1] - knee.max[1]).toBeCloseTo(0.55, 6);
    expect(pin.min[2]).toBeGreaterThan(knee.min[2]); expect(pin.max[2]).toBeLessThan(knee.max[2]);
  });
  it('the knee stays out of the sign zone on the side (D-57 item 9: x up to 6 in) and the bungee eye is on the transom, not on the side', () => {
    const knee = worldAABB(byId('brake-knee-L'));
    expect(knee.min[0]).toBeGreaterThan(SIGN_X_MAX_IN);
    const cord = worldAABB(byId('brake-cord-L'));
    expect(cord.max[0]).toBeLessThan(L.xRear + 0.5);
    expect(cord.min[1]).toBeLessThan(L.hwC + L.side); // the upper end is inboard of the side's outer face, at the transom corner
  });
  it('the flaps are outboard of the body, centered on the tires, over the tread; the ground clearance holds', () => {
    for (const tag of ['L', 'R']) {
      const fl = worldAABB(byId(`brake-flap-${tag}`));
      const tire = worldAABB(byId(`wheel-R${tag}`));
      // centered on the tire; D-60: the 3 in flap is 1/4 in narrower each side than the 3-1/2 in tire (it presses the flat of the tread)
      expect((fl.min[1] + fl.max[1]) / 2).toBeCloseTo((tire.min[1] + tire.max[1]) / 2, 2);
      expect(fl.max[1] - fl.min[1]).toBeCloseTo(defaults.brakeFlapWidthIn, 2);
      expect(fl.min[1]).toBeGreaterThanOrEqual(tire.min[1] - 1e-6);
      expect(fl.max[1]).toBeLessThanOrEqual(tire.max[1] + 1e-6);
      expect(fl.min[2]).toBeGreaterThan(defaults.minGroundClearanceIn);
    }
    const lowest = Math.min(...brake.filter((x) => !/chock/.test(x.id) && !/^handle-/.test(x.id)).map((x) => worldAABB(x).min[2]));
    expect(lowest).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn);
  });
  it('the flaps and mounts FOLLOW THE WHEELS: a 28 in and a 36 in rear track both give flaps centered on the tires and a valid layout', () => {
    for (const track of [28, 36]) {
      const p = { ...defaults, rearTrackIn: track } as Params;
      const ps = buildModel(p);
      const fl = worldAABB(ps.find((x) => x.id === 'brake-flap-L')!);
      expect((fl.min[1] + fl.max[1]) / 2, `track ${track}`).toBeCloseTo(track / 2, 2);
      const kn = worldAABB(ps.find((x) => x.id === 'brake-knee-L')!);
      expect(kn.max[1]).toBeCloseTo(track / 2 + p.brakeFlapWidthIn / 2, 2);
      expect(brakeGeometry(makeCtx(p).p, makeCtx(p).L).ok).toBe(true);
    }
  });
  it('the cords run to their eyes: the bungee from the flap rear end to the transom, the chock cord from the knee bottom to the chock', () => {
    const { g } = geomOf(defaults);
    const cord = byId('brake-cord-L');
    const bb = worldAABB(cord);
    expect(Math.abs(bb.max[2] - g.bungee.A[2])).toBeLessThan(0.2);
    expect(Math.abs(bb.min[2] - g.bungee.Erel[1])).toBeLessThan(0.2);
    const cc = worldAABB(byId('brake-chock-cord-L'));
    expect(Math.abs(cc.max[2] - (g.knee.zBot - 0.2))).toBeLessThan(0.2);
    expect(Math.abs(cc.min[2] - (g.chock.height + 0.2))).toBeLessThan(0.2);
    expect(g.bungee.lenApp).toBeGreaterThan(g.bungee.lenRel); // the stomp stretches the bungee
    expect(g.bungee.tApp).toBeGreaterThan(g.bungee.tRel);
  });
  it('the chock ramp is tangent to the tire: the face line is a tire radius from the axle, at the ramp angle', () => {
    const { g } = geomOf(defaults);
    const ck = g.chock;
    const [x0, z0] = [ck.xToe, 0], [x1, z1] = [ck.xBack, ck.height];
    const dx = x1 - x0, dz = z1 - z0;
    const dist = Math.abs(dx * (g.O[1] - z0) - dz * (g.O[0] - x0)) / Math.hypot(dx, dz);
    expect(dist).toBeCloseTo(g.r, 6);
    expect(Math.atan2(dz, dx) / RAD).toBeCloseTo(defaults.brakeChockAngleDeg, 6);
    expect(worldAABB(byId('brake-chock-L')).max[2]).toBeCloseTo(defaults.brakeChockHeightIn, 6);
  });
  it('the parts add up: the brake group (flaps, mounts, chocks, handle sockets) is lighter than the 14 lb band', () => {
    const mass = brake.reduce((s, x) => s + x.massLb, 0);
    expect(mass).toBeGreaterThan(8);
    expect(mass).toBeLessThan(14);
  });
  it('D-65: the flap kit (flap, pivot block, pin, clip, shoe block, pad, foot tread, cord, snap hook) and the chocks are REMOVABLE with the shop note; the knees and backers are not', () => {
    for (const tag of ['L', 'R']) {
      for (const k of ['flap', 'pivot-block', 'pivot-pin', 'pivot-clip', 'shoe', 'pad', 'foot-tread', 'cord', 'snap', 'chock', 'chock-cord']) {
        const x = byId(`brake-${k}-${tag}`);
        expect(x.removable, x.id).toBe(true);
        if (!/chock/.test(k)) expect(x.notes, x.id).toMatch(/pull the pivot pin .*unhook the cord.*about 15 s a side, no tools/);
      }
      for (const k of ['knee', 'backer']) expect(byId(`brake-${k}-${tag}`).removable, k).toBeFalsy();
    }
  });
  it('D-65: Transport mode (removed) takes the whole flap kit and the chocks off, the knees and backers stay; brakes: false takes only the flap kit, chocks: false only the chocks', () => {
    const kit = /^brake-(flap|pivot-block|pivot-pin|pivot-clip|shoe|pad|foot-tread|cord|snap)-/;
    const removed = buildModel(defaults, { removed: true });
    expect(removed.some((x) => kit.test(x.id) || /^brake-chock/.test(x.id))).toBe(false);
    expect(removed.filter((x) => /^brake-(knee|backer)-/.test(x.id))).toHaveLength(4);
    const noBrakes = buildModel(defaults, { brakes: false });
    expect(noBrakes.some((x) => kit.test(x.id))).toBe(false);
    expect(noBrakes.filter((x) => /^brake-(knee|backer|chock)/.test(x.id)).length).toBeGreaterThanOrEqual(8); // knees, backers and chocks stay
    expect(noBrakes.some((x) => x.id === 'front-light')).toBe(true); // lights are a separate toggle
    const noChocks = buildModel(defaults, { chocks: false });
    expect(noChocks.some((x) => /^brake-chock/.test(x.id))).toBe(false);
    expect(noChocks.some((x) => x.id === 'brake-flap-L')).toBe(true);
  });
  it('a one-chock build carries a single chock and cord', () => {
    const ps = buildModel({ ...defaults, brakeChockCount: 1 } as Params);
    expect(ps.filter((x) => /^brake-chock-[LR]$/.test(x.id)).length).toBe(1);
  });
});

describe('step brake over the parameter extremes and old links', () => {
  it('builds without NaN over the extremes of the brake params, and the layout stays ok', () => {
    const keys = Object.keys(PARAM_DEFS).filter((k) => /^brake(Pivot|Pad|Flap|Knee|Backer|Mount|Foot|Chock|Shoe|Bungee)/.test(k)) as Array<keyof Params>;
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      for (const v of [PARAM_DEFS[k].min, PARAM_DEFS[k].max]) {
        const p = { ...defaults, [k]: v } as Params;
        const ps = buildModel(p);
        for (const x of ps.filter((q) => q.group === 'brake')) expect(x.transform.every(Number.isFinite) && Number.isFinite(x.massLb), `${String(k)}=${v} ${x.id}`).toBe(true);
      }
    }
  });
  it('old links with the D-55 drag-bar keys still load: the unknown keys are dropped and the sled builds like the defaults', () => {
    const old = { brakePedalReachIn: 9, brakePivotAboveShoeIn: 1.5, brakeBeamSizeIn: 2, brakeLatchPinDiameterIn: 0.375, brakeToeGuardHeightIn: 4, brakeSpringForceLbf: 9, brakeLinedShoeWidthIn: 2.5 };
    const s = sanitizeParams(old as unknown as Partial<Params>);
    expect(s).toEqual(defaults);
    for (const k of Object.keys(old)) expect(Object.keys(PARAM_DEFS), k).not.toContain(k);
  });
  it('the validator accepts the defaults', () => {
    expect(validateParams(defaults).filter((i) => i.severity !== 'info' && i.keys.some((k) => /^brake|^park/.test(k)))).toEqual([]);
  });
});

describe('the slotted knee is real geometry (D-65, D-66 viewer fix)', () => {
  const { c, g } = geomOf(defaults);
  const fixed = buildBrakeAt(c, 0, false);
  const kneeOf = (tag: string) => fixed.find((x) => x.id === `brake-knee-${tag}`)!;
  it('the knee is a mesh with the slot sawn through the arm: two ears and a bridge ahead of the slot, the pin hole line passes through both ears', () => {
    for (const [tag, sgn] of [['L', 1], ['R', -1]] as const) {
      const k = kneeOf(tag);
      expect(k.geometry.type).toBe('mesh');
      const boxes = (k.geometry as { boxes?: unknown[] }).boxes!;
      expect(boxes.length).toBeGreaterThan(5);
      // no box covers the slot: a probe line through the middle of the slot, behind the slot end, hits no box
      const yMid = sgn * (g.pivot.ySlot[0] + g.pivot.ySlot[1]) / 2;
      const hits = (boxes as Array<[[number, number, number], [number, number, number]]>).filter(([lo, hi]) => Math.min(lo[1], hi[1]) < yMid && Math.max(lo[1], hi[1]) > yMid && lo[0] < g.pivot.slotEndX - 0.01 && hi[0] > g.knee.x0 + 0.01);
      expect(hits, `slot of knee ${tag}`).toHaveLength(0);
      // the ears: solid at the pin x on both sides of the slot
      const near = (y: number) => (boxes as Array<[[number, number, number], [number, number, number]]>).some(([lo, hi]) => Math.min(lo[1], hi[1]) < y && Math.max(lo[1], hi[1]) > y && lo[0] < g.H[0] && hi[0] > g.H[0] && lo[2] < g.H[1] && hi[2] > g.H[1]);
      expect(near(sgn * (g.pivot.ySlot[1] + 0.3)), 'outboard ear holds the pin').toBe(true);
      expect(near(sgn * (g.pivot.ySlot[0] - 0.5)), 'inboard ear holds the pin').toBe(true);
      // its wood: lighter than the unslotted block by the slot's volume
      const slotVol = (g.pivot.ySlot[1] - g.pivot.ySlot[0]) * (g.pivot.slotEndX - g.knee.x0) * g.knee.armT;
      expect(slotVol).toBeGreaterThan(1);
    }
  });
  it('the moving flap group (flap tongue, pivot block, shoe, pad, foot tread) never touches the knee over the whole swing: the tongue and block sit IN the slot with their clearance, at every pose', () => {
    const clr = defaults.brakePivotSlotClearIn;
    let worst = -Infinity;
    for (let i = 0; i <= 10; i++) {
      const moving = buildBrakeAt(c, i / 10, true);
      for (const tag of ['L', 'R']) {
        for (const m of moving.filter((x) => x.id.endsWith(`-${tag}`) && /^brake-(flap|pivot-block|shoe|pad|foot-tread)-/.test(x.id))) {
          const o = partsOverlap(m, kneeOf(tag));
          worst = Math.max(worst, o);
          // the pivot block is an exact box: it clears the slot walls by the slot clearance (1/16 in); the flap is covered by slabs that are a little wider than its S-curved flare (conservative), so it only has to be separate
          expect(o, `${m.id} vs knee at pose ${i / 10}`).toBeLessThanOrEqual(/pivot-block/.test(m.id) ? -(clr - 0.01) : -1e-6);
        }
        // the block and the tongue stay inside the slot walls with the clearance each side
        const blk = worldAABB(moving.find((x) => x.id === `brake-pivot-block-${tag}`)!);
        const sg = tag === 'L' ? 1 : -1;
        const ys = [sg * g.pivot.ySlot[0], sg * g.pivot.ySlot[1]].sort((a, b) => a - b);
        expect(blk.min[1] - ys[0]).toBeGreaterThanOrEqual(clr - 1e-6);
        expect(ys[1] - blk.max[1]).toBeGreaterThanOrEqual(clr - 1e-6);
      }
    }
    expect(worst).toBeLessThan(0); // separated at every pose
  });
  it('the flap tongue and block end short of the slot end at every pose (the nose swings but the slot is deep enough)', () => {
    for (let i = 0; i <= 10; i++) {
      const blk = worldAABB(buildBrakeAt(c, i / 10, true).find((x) => x.id === 'brake-pivot-block-L')!);
      expect(g.pivot.slotEndX - blk.max[0], `pose ${i / 10}`).toBeGreaterThan(0.02);
    }
  });
});
