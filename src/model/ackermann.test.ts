/**
 * Stage 0 of Phase 3b (docs/phase3b-spec.md sections 0.1, 9 and 10.A): the Ackermann kinematics and the additive interface (params block, Layout.front,
 * RigidBody ids, ViewState.mode, Ctx.pose, ContactInputs.ack, TireSweepSpec.ack). The Stage 0 defaults are `defaultParams()`: the existing keys whose
 * default changes at the flip (steerLockDeg 35.5, kingpinLeadIn 1.25, ...) are applied there, not yet in `defaultParams()`.
 */
import { describe, expect, it } from 'vitest';
import { contactsAt, turnGeometry, DEG, RAD } from '../analysis/geometry';
import { ackSpec, defaultParams, PARAM_DEFS, sanitizeParams, validateParams, type Params } from '../params';
import {
  ackermannErrorDeg, centerLinkage, centerPins, idealOuterDeg, linkageConditioning, instantCenters, kpL, kpR, leftWheelRange, lockLimits, poseMatrices, solveCenterExact, solveFromTongue, solveSteer, wheelCenters,
  type AckSpec,
} from './ackermann';
import { makeCtx } from './build-utils';
import { leftTirePolys, minGapToTires } from './hull-curve';
import { computeLayout } from './layout';
import type { Mat4 } from './types';

const P0 = defaultParams();
const S: AckSpec = ackSpec(P0);
const apply = (m: Mat4, x: number, y: number): [number, number] => [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13]];

describe('ackermann: derived spec at the defaults (spec 0.1)', () => {
  it('kingpin axis at x = 45.25, y = +/-14.75; tie rod 27.06; arm tips at (42.51, +/-13.53)', () => {
    expect(S.kx).toBeCloseTo(45.25, 6);
    expect(S.kpHalf).toBeCloseTo(14.75, 6);
    expect(S.tieLen).toBeCloseTo(27.06, 2);
    const L = computeLayout(P0).front;
    expect(L.armTip.L[0]).toBeCloseTo(42.51, 2);
    expect(L.armTip.L[1]).toBeCloseTo(13.53, 2);
    expect(L.armTip.R[1]).toBeCloseTo(-13.53, 2);
    expect(S.tongueHinge[0]).toBeCloseTo(47.25, 6);
    expect(S.bellPivot[0]).toBeCloseTo(38.75, 6);
  });
});

describe('ackermann', () => {
  it('straight ahead at 0 gives zero angles and the neutral tie rod length', () => {
    const sol = solveSteer(S, 0);
    expect(sol.ok).toBe(true);
    for (const v of [sol.innerDeg, sol.outerDeg, sol.leftDeg, sol.rightDeg, sol.bellcrankDeg, sol.tongueDeg, sol.stickDeg, sol.rod.dx, sol.rod.dy, sol.rod.rotDeg]) expect(Math.abs(v)).toBeLessThan(1e-9);
    const L = computeLayout(P0).front;
    const len = Math.hypot(L.armTip.L[0] - L.armTip.R[0], L.armTip.L[1] - L.armTip.R[1]);
    expect(len).toBeCloseTo(S.tieLen, 9);
    expect(L.tieRod.len).toBeCloseTo(S.tieLen, 9);
  });

  it('the 4-bar solution is the same whether solved from the left or the right knuckle (mirror)', () => {
    for (const d of [5, 12, 20, 30, 35.5]) {
      const a = solveSteer(S, d), b = solveSteer(S, -d);
      expect(b.leftDeg).toBeCloseTo(-a.rightDeg, 9);
      expect(b.rightDeg).toBeCloseTo(-a.leftDeg, 9);
      expect(b.rod.dy).toBeCloseTo(-a.rod.dy, 9);
      // Stage 1: the drag link slants, so the bellcrank/tongue are only NEAR mirror images (opposite sense, within 1.5 deg of each other); see the conditioning tests.
      expect(Math.sign(b.tongueDeg)).toBe(-Math.sign(a.tongueDeg));
      expect(Math.abs(b.tongueDeg + a.tongueDeg)).toBeLessThan(1.5);
      // Independent check: the tie rod really keeps its length at the solved knuckle angles (solved from either side).
      for (const sol of [a, b]) {
        const g = S.armAngleDeg * RAD;
        const tipL = [S.kx + Math.cos(sol.leftDeg * RAD) * -S.armLen * Math.cos(g) - Math.sin(sol.leftDeg * RAD) * -S.armLen * Math.sin(g), S.kpHalf + Math.sin(sol.leftDeg * RAD) * -S.armLen * Math.cos(g) + Math.cos(sol.leftDeg * RAD) * -S.armLen * Math.sin(g)];
        const tipR = [S.kx + Math.cos(sol.rightDeg * RAD) * -S.armLen * Math.cos(g) - Math.sin(sol.rightDeg * RAD) * S.armLen * Math.sin(g), -S.kpHalf + Math.sin(sol.rightDeg * RAD) * -S.armLen * Math.cos(g) + Math.cos(sol.rightDeg * RAD) * S.armLen * Math.sin(g)];
        expect(Math.hypot(tipL[0] - tipR[0], tipL[1] - tipR[1])).toBeCloseTo(S.tieLen, 6);
      }
    }
  });

  it('tow lock 35.5 inner gives outer 26.0 +/- 0.1 at the defaults', () => {
    const sol = solveSteer(S, 35.5);
    expect(sol.ok).toBe(true);
    expect(sol.outerDeg).toBeGreaterThan(25.9);
    expect(sol.outerDeg).toBeLessThan(26.1);
    expect(idealOuterDeg(S, 35.5)).toBeCloseTo(25.96, 1);
    const lim = lockLimits(S, 'tow');
    expect(lim.innerDeg).toBe(35.5);
    expect(lim.outerDeg).toBeCloseTo(sol.outerDeg, 9);
    expect(leftWheelRange(S).maxDeg).toBeCloseTo(35.5, 9);
    expect(leftWheelRange(S).minDeg).toBeCloseTo(-sol.outerDeg, 9);
  });

  it('error versus ideal stays under 1 deg over 0..lock and under 0.1 deg at the tow lock', () => {
    let worst = 0, at = 0;
    for (let d = 0; d <= 35.5 + 1e-9; d += 0.5) {
      const e = ackermannErrorDeg(S, d);
      if (e > worst) { worst = e; at = d; }
    }
    expect(worst).toBeLessThan(1);
    expect(worst).toBeLessThan(0.6); // spec 0.58-0.6 (calc)
    expect(at).toBeGreaterThan(15);
    expect(ackermannErrorDeg(S, 35.5)).toBeLessThan(0.1);
    expect(PARAM_DEFS.ackermannErrorMaxDeg.default).toBe(1);
  });

  it('ride lock outer 8 gives inner 8.55 +/- 0.05', () => {
    const lim = lockLimits(S, 'ride');
    expect(lim.outerDeg).toBe(8);
    expect(Math.abs(lim.innerDeg - 8.55)).toBeLessThan(0.05);
    const sol = solveSteer(S, lim.innerDeg);
    expect(sol.outerDeg).toBeCloseTo(8, 6);
    // Rod travel 0.39"; bellcrank about 5.8 deg (exact re-laid linkage); stick +/-15 deg (1.5" cable arm, 3.8" cross-bar).
    expect(Math.abs(sol.rod.dy)).toBeCloseTo(0.39, 1);
    expect(Math.abs(sol.bellcrankDeg)).toBeGreaterThan(5.4);
    expect(Math.abs(sol.bellcrankDeg)).toBeLessThan(6.4);
    expect(Math.abs(sol.stickDeg)).toBeGreaterThan(14.4);
    expect(Math.abs(sol.stickDeg)).toBeLessThan(15.6);
    expect(sol.stickDeg).toBeGreaterThan(0);
  });

  it('tongue yaw at the tow lock (EXACT linkage) is 21-23 deg in both directions, at least 2 deg inside tongueMaxYawDeg', () => {
    const left = solveSteer(S, 35.5), right = solveSteer(S, -35.5);
    expect(left.ok && right.ok).toBe(true);
    for (const sol of [left, right]) {
      expect(Math.abs(sol.tongueDeg)).toBeGreaterThan(21);
      expect(Math.abs(sol.tongueDeg)).toBeLessThan(23);
      expect(Math.abs(sol.tongueDeg)).toBeLessThan(P0.tongueMaxYawDeg - 2);
    }
    expect(left.tongueDeg).toBeGreaterThan(0); // tongue pulled left (CCW) steers left
    expect(Math.abs(left.tongueDeg + right.tongueDeg)).toBeLessThan(1);
    expect(Math.abs(left.rod.dy)).toBeCloseTo(1.34, 1);
    expect(Math.abs(left.bellcrankDeg)).toBeGreaterThan(16);
    expect(Math.abs(left.bellcrankDeg)).toBeLessThan(20);
    // solveFromTongue inverts it.
    const back = solveFromTongue(S, left.tongueDeg);
    expect(back.steerDeg).toBeCloseTo(35.5, 3);
    expect(solveFromTongue(S, -10).steerDeg).toBeLessThan(0);
    expect(solveFromTongue(S, 10).tongueDeg).toBeCloseTo(10, 6);
    // Monotone and smooth over the whole range (no flip to the other circle root).
    let prev = -Infinity;
    for (let d = -35.5; d <= 35.5 + 1e-9; d += 0.5) {
      const t = solveSteer(S, d).tongueDeg;
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it('the re-laid center linkage is well conditioned, and the Stage 0 straight layout (the deviation) is not', () => {
    // Transmission = sine of the angle between each arm and its link at the three joints, worst over -lock..+lock.
    expect(linkageConditioning(S)).toBeGreaterThan(0.8);
    // The exact solver agrees with itself through solveSteer.
    const ex = solveCenterExact(S, 35.5)!;
    expect(ex.tongueDeg).toBeCloseTo(solveSteer(S, 35.5).tongueDeg, 9);
    expect(ex.bellcrankDeg).toBeCloseTo(solveSteer(S, 35.5).bellcrankDeg, 9);
    // The Stage 0 straight lever (output aft, input forward, ear ahead, 3" arms): a near toggle, tongue yaw 31.8 deg > the stop.
    const old: AckSpec = { ...S, bellArm: 3, bellOutDeg: undefined, bellInArm: undefined, bellInDeg: undefined, bellCableArm: undefined, tongueEar: undefined, tongueLinkArm: 3.25 };
    const exOld = solveCenterExact(old, 35.5)!;
    expect(exOld.tongueDeg).toBeGreaterThan(P0.tongueMaxYawDeg);
    expect(centerLinkage(old).dragLen).toBeGreaterThan(6);
    expect(linkageConditioning(old)).toBeLessThan(0.3);
  });

  it('the pins of the center linkage keep the rigid link lengths over the whole range', () => {
    const cl = centerLinkage(S);
    for (const d of [-35.5, -20, -8, 0, 8, 20, 35.5]) {
      const sol = solveSteer(S, d);
      const pins = centerPins(S, sol)!;
      expect(Math.hypot(pins.out[0] - pins.mid[0], pins.out[1] - pins.mid[1])).toBeCloseTo(cl.dragLen, 9);
      expect(Math.hypot(pins.ear[0] - pins.in[0], pins.ear[1] - pins.in[1])).toBeCloseTo(cl.tongueLinkLen, 9);
      // The cross-bar pins stay 2 x cableArm apart and centered on the pivot.
      expect(Math.hypot(pins.cableA[0] - pins.cableB[0], pins.cableA[1] - pins.cableB[1])).toBeCloseTo(2 * cl.cableArm, 9);
      // The link poses carry their neutral pins onto the solved ones.
      const pose = poseMatrices(S, sol);
      const o = apply(pose['drag-link'], cl.out0[0], cl.out0[1]), m = apply(pose['drag-link'], cl.mid0[0], cl.mid0[1]);
      expect(o[0]).toBeCloseTo(pins.out[0], 9); expect(o[1]).toBeCloseTo(pins.out[1], 9);
      expect(m[0]).toBeCloseTo(pins.mid[0], 9); expect(m[1]).toBeCloseTo(pins.mid[1], 9);
      const e = apply(pose['tongue-link'], cl.ear0[0], cl.ear0[1]), i = apply(pose['tongue-link'], cl.in0[0], cl.in0[1]);
      expect(e[0]).toBeCloseTo(pins.ear[0], 9); expect(e[1]).toBeCloseTo(pins.ear[1], 9);
      expect(i[0]).toBeCloseTo(pins.in[0], 9); expect(i[1]).toBeCloseTo(pins.in[1], 9);
      // Bellcrank and tongue poses move the pins the same way.
      const bi = apply(pose.bellcrank, cl.in0[0], cl.in0[1]);
      expect(bi[0]).toBeCloseTo(pins.in[0], 9); expect(bi[1]).toBeCloseTo(pins.in[1], 9);
      const te = apply(pose.tongue, cl.ear0[0], cl.ear0[1]);
      expect(te[0]).toBeCloseTo(pins.ear[0], 9); expect(te[1]).toBeCloseTo(pins.ear[1], 9);
    }
  });

  it('the linkage reports ok = false when the tie rod length is changed by 1 inch', () => {
    expect(solveSteer({ ...S, tieLen: S.tieLen + 1 }, 0).ok).toBe(false);
    expect(solveSteer({ ...S, tieLen: S.tieLen - 1 }, 20).ok).toBe(false);
    expect(solveSteer(S, 20).ok).toBe(true);
    // A binding mechanism never poisons the poses with NaN.
    const bad = solveSteer({ ...S, tieLen: 60 }, 30);
    expect(bad.ok).toBe(false);
    expect(Number.isFinite(bad.leftDeg) && Number.isFinite(bad.rightDeg)).toBe(true);
  });

  it('poseMatrices rotates each knuckle about its own kingpin', () => {
    const sol = solveSteer(S, 20);
    const pose = poseMatrices(S, sol);
    const kL = kpL(S), kR = kpR(S);
    const fL = apply(pose['steer-L'], kL[0], kL[1]), fR = apply(pose['steer-R'], kR[0], kR[1]);
    expect(fL[0]).toBeCloseTo(kL[0], 9); expect(fL[1]).toBeCloseTo(kL[1], 9);
    expect(fR[0]).toBeCloseTo(kR[0], 9); expect(fR[1]).toBeCloseTo(kR[1], 9);
    // The neutral wheel center goes where wheelCenters says.
    const wc = wheelCenters(S, sol);
    const nl = apply(pose['steer-L'], S.wheelbase, S.kpHalf + S.scrub), nr = apply(pose['steer-R'], S.wheelbase, -(S.kpHalf + S.scrub));
    expect(nl[0]).toBeCloseTo(wc.L[0], 9); expect(nl[1]).toBeCloseTo(wc.L[1], 9);
    expect(nr[0]).toBeCloseTo(wc.R[0], 9); expect(nr[1]).toBeCloseTo(wc.R[1], 9);
    // Rotation angles: the wheel axle direction (neutral +y) turns by leftDeg / rightDeg.
    expect(Math.atan2(pose['steer-L'][1], pose['steer-L'][0]) * DEG).toBeCloseTo(sol.leftDeg, 9);
    expect(Math.atan2(pose['steer-R'][1], pose['steer-R'][0]) * DEG).toBeCloseTo(sol.rightDeg, 9);
    // The tie rod ends follow the arm tips, the bellcrank and tongue rotate about their pivots.
    const L = computeLayout(P0).front;
    const tl = apply(pose['tie-rod'], L.armTip.L[0], L.armTip.L[1]), tr = apply(pose['tie-rod'], L.armTip.R[0], L.armTip.R[1]);
    expect(Math.hypot(tl[0] - tr[0], tl[1] - tr[1])).toBeCloseTo(S.tieLen, 6);
    const bp = apply(pose.bellcrank, S.bellPivot[0], S.bellPivot[1]);
    expect(bp[0]).toBeCloseTo(S.bellPivot[0], 9);
    const th = apply(pose.tongue, S.tongueHinge[0], S.tongueHinge[1]);
    expect(th[1]).toBeCloseTo(S.tongueHinge[1], 9);
  });

  it('wheel centers at the tow lock match the hand values (42.49, 16.47) and (45.44, -17.99)', () => {
    const wc = wheelCenters(S, solveSteer(S, 35.5));
    expect(wc.L[0]).toBeCloseTo(42.49, 2); expect(wc.L[1]).toBeCloseTo(16.47, 2);
    expect(wc.R[0]).toBeCloseTo(45.44, 2); expect(wc.R[1]).toBeCloseTo(-17.99, 2);
    // Neutral: wheel centers sit at (WB, +/- track/2).
    const w0 = wheelCenters(S, solveSteer(S, 0));
    expect(w0.L).toEqual([44, 17.75].map((v, i) => (i ? v : v)) as [number, number]);
    expect(w0.R[1]).toBeCloseTo(-17.75, 9);
  });

  it('instant centers lie on the rear axle line: 76.0" and 75.2" at the tow lock, tow edge radius under 9 ft', () => {
    const sol = solveSteer(S, 35.5);
    const ic = instantCenters(S, sol);
    expect(ic.fromLeft).toBeCloseTo(76.0, 0);
    expect(ic.fromRight).toBeCloseTo(75.2, 0);
    expect(ic.mean).toBeCloseTo(75.6, 0);
    expect(instantCenters(S, solveSteer(S, 0)).mean).toBeNull();
    // Outer tire edge radius: from each IC to the outer (right) wheel center plus half the tire width.
    const wc = wheelCenters(S, sol);
    for (const icY of [ic.fromLeft!, ic.fromRight!, ic.mean!]) {
      const edge = Math.hypot(wc.R[0], wc.R[1] - icY) + P0.tireWidthIn / 2;
      expect(edge).toBeGreaterThan(8.7 * 12);
      expect(edge).toBeLessThan(9 * 12); // turnRadiusMaxIn 108
    }
    expect(PARAM_DEFS.turnRadiusMaxIn.default).toBe(108);
    // Right-hand turn mirrors the center to the right.
    expect(instantCenters(S, solveSteer(S, -35.5)).mean!).toBeCloseTo(-ic.mean!, 6);
  });

  it('tire sweep envelope: min inner |y| 11.08" near x = 38.4", rear-most 36.0", front-most 52.2"; nose 20.625" outside', () => {
    const polys = leftTirePolys({ tireWidth: P0.tireWidthIn, wheelDiameter: P0.wheelDiameterIn, ack: S }, 1);
    expect(polys.length).toBe(72); // -35.5 .. +35.5 in 1 deg steps
    let minY = Infinity, xAtMin = 0, minX = Infinity, maxX = -Infinity;
    for (const q of polys) for (const [x, y] of q) {
      if (y < minY) { minY = y; xAtMin = x; }
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    }
    expect(minY).toBeCloseTo(11.08, 1);
    expect(xAtMin).toBeGreaterThan(37.5); expect(xAtMin).toBeLessThan(39.5);
    expect(minX).toBeCloseTo(36.0, 0);
    expect(maxX).toBeCloseTo(52.2, 0);
    const nose = 2 * (minY - P0.steeringClearanceIn);
    expect(nose).toBeCloseTo(20.65, 1);
    expect(Math.floor(nose * 8) / 8).toBe(20.625);
    // A straight line at the nose half width clears the sweep by exactly the steering clearance.
    const line: [number, number][] = [[30, nose / 2], [60, nose / 2]];
    expect(minGapToTires(line, polys)).toBeGreaterThan(P0.steeringClearanceIn - 0.02);
  });
});

describe('stage 0 interface (additive)', () => {
  it('Layout.front carries the Ackermann geometry, and L.kx and the old fields stay', () => {
    const L = computeLayout(P0);
    const f = L.front;
    expect(L.kx).toBeCloseTo(P0.wheelbaseIn + P0.kingpinLeadIn, 9);
    expect(f.ack.kx).toBeCloseTo(L.kx, 9);
    expect(f.kp.L[0]).toBeCloseTo(45.25, 6); expect(f.kp.L[1]).toBeCloseTo(14.75, 6); expect(f.kp.R[1]).toBeCloseTo(-14.75, 6); expect(f.kp.L[2]).toBeCloseTo(L.r, 9);
    expect(f.stub.L).toEqual([44, 17.75, L.r]);
    expect(f.stub.R[1]).toBeCloseTo(-17.75, 9);
    expect(f.tieRod.x).toBeCloseTo(42.51, 2);
    expect(f.tieRod.len).toBeCloseTo(27.06, 2);
    expect(f.bellcrank.pivot[0]).toBeCloseTo(38.75, 6);
    expect(f.bellcrank.dragLinkLen).toBeGreaterThan(0);
    expect(f.tongue.hinge[0]).toBeCloseTo(47.25, 6);
    expect(f.tongue.linkPin[0]).toBeCloseTo(45.5, 6);
    expect(f.tongue.linkPin[1]).toBeCloseTo(-1.75, 6);
    // Steel tube beam: 2 x 2, centered on the stub axis, top = axis + 1", x = kx - 0.5", length 27.7".
    expect(f.beam.x).toBeCloseTo(44.75, 6);
    expect(f.beam.top).toBeCloseTo(L.r + 1, 9);
    expect(f.beam.len).toBeCloseTo(26.94, 2); // Stage 1: the beam ends 1.4" from the kingpin axis (boss radius + KPI lean + web), not 0.9" (27.7")
    for (const side of ['L', 'R'] as const) {
      const br = f.bracket[side];
      expect(br.bolts).toHaveLength(4);
      expect(br.lowerLeaf.z1 - br.lowerLeaf.z0).toBeCloseTo(P0.kingpinBracketThickIn, 9);
      expect(br.upperLeaf.z0 - br.lowerLeaf.z1).toBeCloseTo(P0.kingpinBracketGapIn, 9);
      expect(Math.abs(br.pivot[1])).toBeCloseTo(14.75, 9);
      const k = f.knuckle[side];
      expect(Math.hypot(...k.bossAxis)).toBeCloseTo(1, 9);
      expect(k.bossPos[2]).toBeGreaterThan(L.r + P0.spindleBossAboveStubIn - 0.01);
      expect(k.shoeAngleDeg).toBe(P0.brakeShoeAngleDeg);
    }
    // KPI leans the boss inboard, caster leans it back.
    expect(f.knuckle.L.bossPos[1]).toBeLessThan(f.kp.L[1]);
    expect(f.knuckle.L.bossPos[0]).toBeLessThan(f.kp.L[0]);
    expect(f.trailIn).toBeCloseTo(P0.kingpinLeadIn + L.r * Math.tan(P0.casterDeg * RAD), 9);
    // Modes: the two pin sockets are farther apart than the pin plus an inch.
    expect(Math.hypot(...(f.mode.pinTow.map((v, i) => v - f.mode.pinRide[i]) as [number, number, number]))).toBeGreaterThan(P0.modePinDiaIn + 1);
    expect(f.stick.pivot[1]).toBeLessThan(0); expect(f.hipLever.pivot[1]).toBeGreaterThan(0);
    expect(computeLayout(defaultParams()).front.ack.kx).toBeCloseTo(45.25, 9);
  });

  it('Ctx carries the solved pose and the mode (default both)', () => {
    const c0 = makeCtx(P0);
    expect(c0.view.mode).toBe('both');
    expect(c0.steer.ok).toBe(true);
    const c20 = makeCtx(P0, { steerDeg: 20, mode: 'tow' });
    expect(c20.view.mode).toBe('tow');
    // The ride mode clamps the displayed angle to the inner angle of the ride lock (outer 8 deg).
    expect(makeCtx(P0, { steerDeg: 20, mode: 'ride' }).steer.innerDeg).toBeCloseTo(8.59, 1);
    expect(c20.steer.innerDeg).toBe(20);
    expect(Math.atan2(c20.pose['steer-L'][1], c20.pose['steer-L'][0]) * DEG).toBeCloseTo(20, 9);
    expect(Math.atan2(c20.pose['steer-R'][1], c20.pose['steer-R'][0]) * DEG).toBeCloseTo(c20.steer.outerDeg, 9);
    // The steer angle is clamped to the lock like before.
    expect(makeCtx(P0, { steerDeg: 90 }).view.steerDeg).toBe(35.5);
  });

  it('contactsAt with the Ackermann spec gives the hand wheel centers', () => {
    const g = { wheelbaseIn: P0.wheelbaseIn, rearTrackIn: P0.rearTrackIn, frontTrackIn: P0.frontTrackIn };
    const c = contactsAt({ ...g, ack: S }, 35.5 * RAD);
    expect(c.FL[0]).toBeCloseTo(42.49, 2); expect(c.FL[1]).toBeCloseTo(16.47, 2);
    expect(c.FR[0]).toBeCloseTo(45.44, 2); expect(c.FR[1]).toBeCloseTo(-17.99, 2);
    expect(c.kx).toBeCloseTo(45.25, 9);
    expect(contactsAt({ ...g, ack: S }, 0).FL).toEqual([44, 17.75]);
    // Mirror.
    const m = contactsAt({ ...g, ack: S }, -35.5 * RAD);
    expect(m.FR[1]).toBeCloseTo(-c.FL[1], 9);
    // Track at lock is about 34.5" with the Ackermann contacts.
    expect(Math.hypot(c.FL[0] - c.FR[0], c.FL[1] - c.FR[1])).toBeCloseTo(34.5, 0);
    // Turn geometry uses the Ackermann instant center when the spec is present.
    const tg = turnGeometry({ ...g, ack: S }, 35.5 * RAD)!;
    expect(tg.icY).toBeCloseTo(75.6, 0);
  });

  it('the Phase 3b param block is present with status, ref and a note on every new param', () => {
    const keys = ['spindleStub', 'spindleStubLengthIn', 'spindleYieldPsi', 'spindleUltimatePsi', 'spindleMassLb', 'spindleBossAboveStubIn', 'kingpinInclinationDeg', 'casterDeg', 'scrubRadiusIn',
      'steerArmLengthIn', 'ackermannAngleDeg', 'steerRideLockDeg', 'steerCenterSpringLbf', 'frontBeamWidthIn', 'frontBeamDepthIn', 'frontBeamWallIn', 'frontBeamBehindKingpinIn', 'frontBeamYieldPsi',
      'kingpinBracketThickIn', 'kingpinBracketGapIn', 'kingpinBracketLeafRadiusIn', 'kingpinBracketBoltDiaIn', 'tieRodDiaIn', 'tieRodEndDiaIn', 'bellcrankArmIn', 'bellcrankPivotAftOfKingpinIn',
      'tongueHingeAheadOfBeamIn', 'tongueLinkArmIn', 'tongueMaxYawDeg', 'modePinDiaIn', 'rideStickAheadOfHpointIn', 'rideStickInsetIn', 'rideStickLengthIn', 'rideStickPivotAboveSeatIn',
      'rideStickCableArmIn', 'stickCableDiaIn', 'stickCablePreloadLbf', 'frontBrakeBias', 'frontShoeTravelIn', 'brakeShoeBackThickIn', 'hipLeverAheadOfHpointIn',
      'hipLeverInsetIn', 'hipLeverArmIn', 'hipLeverCableArmIn', 'hipLeverThrowDeg', 'hipCableDiaIn', 'brakeEmergencyLimitLbf', 'brakeHeatLimitK', 'brakeHeatContactFrac', 'rideRunFt', 'beltDesignG',
      'rideSpeedMph', 'rideMaxSlopeDeg', 'rideGoSlopeDeg', 'rideMuGo8', 'rideMuGo10', 'rideMuDerate', 'rideStopMaxFt', 'rideReactionS', 'bumpSpeedMph', 'bumpNormalHeightIn', 'bumpHardHeightIn',
      'bumpWheelRateLbIn', 'bumpMassShare', 'failSafeFactor', 'fatigueLoadFactor', 'spindleEnduranceLimitPsi', 'fatigueSafetyMin', 'ackermannErrorMaxDeg'] as const;
    for (const k of keys) {
      const d = PARAM_DEFS[k];
      expect(d, k).toBeDefined();
      expect(d.status, k).toBeTruthy();
      expect(d.ref, k).toMatch(/^[DAQ]-\d+/);
      expect(d.default, k).toBeGreaterThanOrEqual(d.min);
      expect(d.default, k).toBeLessThanOrEqual(d.max);
    }
    for (const k of ['spindleStub', 'scrubRadiusIn', 'ackermannAngleDeg', 'frontBrakeBias', 'bumpWheelRateLbIn', 'failSafeFactor']) expect(PARAM_DEFS[k as keyof typeof PARAM_DEFS].note, k).toBeTruthy();
    // Orchestrator decisions.
    expect(PARAM_DEFS.spindleStub.default).toBe(1); // 25 mm
    expect(PARAM_DEFS.spindleStub.options).toHaveLength(2);
    expect(PARAM_DEFS.scrubRadiusIn.default).toBe(3);
    expect(PARAM_DEFS.failSafeFactor.default).toBe(1.25);
    expect(PARAM_DEFS.bumpWheelRateLbIn.group).toBe('ride');
    // Existing keys whose default changed at the Phase 3b flip (D-51, D-53, D-56): now in PARAM_DEFS.
    expect([P0.steerLockDeg, P0.kingpinLeadIn, P0.kingpinDiameterIn, P0.turnRadiusMaxIn, P0.brakeLiningThickIn]).toEqual([35.5, 1.25, 0.375, 108, 0.25]);
    expect([PARAM_DEFS.steerLockDeg.min, PARAM_DEFS.steerLockDeg.max, PARAM_DEFS.kingpinDiameterIn.min]).toEqual([28, 42, 0.25]);
    expect(P0.steerLockDeg).toBe(35.5);
    expect(P0.kingpinLeadIn).toBe(1.25);
  });

  it('old links load: unknown keys (turntableType, drawbar, frontDeckRaiseIn) are ignored, and new keys fall back to defaults', () => {
    const s = sanitizeParams({ turntableType: 1, drawbar: 0, frontDeckRaiseIn: 0.5, notAKey: 7 } as unknown as Partial<Params>);
    expect(s.scrubRadiusIn).toBe(3);
    expect((s as unknown as Record<string, number>).notAKey).toBeUndefined();
    const t = sanitizeParams({ scrubRadiusIn: 99, spindleStub: 0.4 });
    expect(t.scrubRadiusIn).toBe(PARAM_DEFS.scrubRadiusIn.max);
    expect(t.spindleStub).toBe(0);
  });

  it('validateParams: scrub radius too small for the hub and bracket is an error; defaults are clean', () => {
    expect(validateParams(defaultParams()).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateParams(P0).filter((i) => i.severity === 'error' && i.keys.includes('scrubRadiusIn'))).toEqual([]);
    const bad = validateParams({ ...P0, scrubRadiusIn: 2.5 });
    expect(bad.some((i) => i.severity === 'error' && i.keys.includes('scrubRadiusIn'))).toBe(true);
    const hub = validateParams({ ...P0, hubLengthIn: 4 });
    expect(hub.some((i) => i.severity === 'error' && i.keys.includes('scrubRadiusIn'))).toBe(true);
  });

  it('the new 4-bar stays assembled across reasonable designs', () => {
    for (const track of [30, 33, 35.5, 38, 42]) for (const arm of [20, 24, 30]) {
      const p = { ...P0, frontTrackIn: track, ackermannAngleDeg: arm };
      const s = ackSpec(p);
      const sol = solveSteer(s, 30);
      expect(sol.ok, `${track}/${arm}`).toBe(true);
      expect(sol.outerDeg).toBeLessThan(sol.innerDeg);
    }
  });
});
