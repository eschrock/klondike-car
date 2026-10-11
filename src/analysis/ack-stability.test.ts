import { describe, expect, it } from 'vitest';
import { ackCtx, ackParams, byId } from './ack-test-utils';
import { contactsAt, lateralTip, RAD } from './geometry';
import { tipLock, turnRadius } from './stability';
import { steerClearance, steerKinCheck, steerLockCheck, steerSweep } from './steering';
import { runChecks } from './index';
import { LIGHT_OF_ID, lightOf, withRider } from './rider-sweep';
import { makeContext } from './context';
import { buildModel } from '../model';
import type { Part, Mat4 } from '../model/types';
import { defaultParams } from '../params';
import { bumpStrike, seatFactor } from './bump';
import { payload, railsCheck, deckCheck, axleStress, bearingGroove } from './structure';
import { seatBackCheck, seatGripCheck } from './seat';
import { footStopCheck } from './hull';
import { rearBeamSeat, wheelRating } from './rear';

describe('contacts and stability with the Ackermann spec', () => {
  const ctx = ackCtx();
  it('contactsAt with an Ackermann spec gives the hand wheel centers at the tow lock; tip-lock uses them', () => {
    const ct = contactsAt(ctx.contact, 35.5 * RAD);
    expect(ct.FL[0]).toBeCloseTo(42.49, 1);
    expect(ct.FL[1]).toBeCloseTo(16.47, 1);
    expect(ct.FR[0]).toBeCloseTo(45.44, 1);
    expect(ct.FR[1]).toBeCloseTo(-17.99, 1);
    // tip-lock = the independent minimum of atan(d/h) over both directions and both locks.
    const row = tipLock(ctx);
    const c = ctx.loads.operating;
    let best = Infinity;
    for (const lockDeg of [35.5, 8.59]) for (const s of [1, -1]) {
      const cg = c.cgAt(s * lockDeg * RAD);
      best = Math.min(best, lateralTip(contactsAt(ctx.contact, s * lockDeg * RAD), [cg[0], cg[1]], cg[2]).deg);
    }
    expect(row.cases!.operating!.value).toBeCloseTo(best, 1);
    expect(row.how).toMatch(/Ackermann linkage/);
    expect(row.statusOperating).toBe('pass');
  });

  it('turn-radius at the defaults is 8.8 ft and passes against 108 inches; both axle lines are reported', () => {
    const r = turnRadius(ctx);
    expect(r.value / 12).toBeGreaterThan(8.75);
    expect(r.value / 12).toBeLessThan(8.95);
    expect(r.limit).toBe(108);
    expect(r.status).not.toBe('fail');
    expect(r.details!.length).toBe(4);
    const [mean, fromL, fromR] = r.details!.map((d) => d.value);
    expect(Math.min(fromL, fromR)).toBeLessThanOrEqual(mean + 1e-9);
    expect(Math.max(fromL, fromR)).toBeGreaterThanOrEqual(mean - 1e-9);
    expect(Math.abs(fromL - fromR)).toBeLessThan(2);
    expect(r.how).toMatch(/Ackermann/);
  });

  it('steer-kin and steer-lock pass at the defaults and fail when the tie rod is changed or the lock is unreachable', () => {
    expect(steerKinCheck(ctx).status).toBe('pass');
    const lock = steerLockCheck(ctx);
    expect(lock.status).not.toBe('fail');
    expect(lock.value).toBeLessThanOrEqual(ctx.p.tongueMaxYawDeg);
    // A smaller yaw stop than the tongue needs at the tow lock fails.
    expect(steerLockCheck(ackCtx({ tongueMaxYawDeg: 15 })).status).toBe('fail');
    // A big Ackermann arm angle error blows the error limit.
    expect(steerKinCheck(ackCtx({ ackermannAngleDeg: 10 })).status).toBe('fail');
  });
});

/** A flat box part for the synthetic sweep. */
const boxPart = (id: string, body: Part['body'], group: Part['group'], c: [number, number, number], size: [number, number, number]): Part => ({
  id, name: id, group, kind: 'metal', material: 'steel', geometry: { type: 'box', size }, body, massLb: 1, fab: 'none', step: 1,
  transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, c[0], c[1], c[2], 1] as Mat4,
});

describe('steering sweep with per-body poses', () => {
  it('synthetic tires and a wall 0.75 inch from the tire envelope: the minimum clearance is 0.75 and the pair is named', () => {
    const base = ackCtx();
    const r = base.d.wheelRadiusIn, w = base.p.tireWidthIn;
    const st = base.L.front.stub;
    const wheelL = boxPart('wheel-FL', 'wheel-FL', 'running-gear', [st.L[0], st.L[1], st.L[2]], [2 * r, w, 2 * r]);
    const wheelR = boxPart('wheel-FR', 'wheel-FR', 'running-gear', [st.R[0], st.R[1], st.R[2]], [2 * r, w, 2 * r]);
    // Walls: outer faces at |y| = 11.08 - 0.75 (the tire sweep envelope comes in to 11.08 from the center line).
    const wallY = 11.08 - 0.75;
    const wallL = boxPart('hull-wall-L', 'chassis', 'body', [38, wallY - 1, 6.5], [30, 2, 14]);
    const wallR = boxPart('hull-wall-R', 'chassis', 'body', [38, -(wallY - 1), 6.5], [30, 2, 14]);
    const ctx = makeContext(base.p, [wheelL, wheelR, wallL, wallR], );
    const sw = steerSweep(ctx);
    expect(sw.minClearanceIn).toBeGreaterThan(0.7);
    expect(sw.minClearanceIn).toBeLessThan(0.8);
    expect(['wheel-FL', 'wheel-FR']).toContain(sw.steerPart);
    expect(sw.chassisPart).toMatch(/hull-wall/);
    const row = steerClearance(ctx, sw);
    expect(row.value).toBeCloseTo(sw.minClearanceIn, 9);
    expect(row.limit).toBeCloseTo(base.p.steeringClearanceIn - 0.05, 9);
    expect(row.how).toContain(sw.chassisPart);
  });

  it('two steering-hardware parts are skipped, and so is a tire against its own kingpin bracket (the scrub rule judges that pair); a tire against anything else is counted', () => {
    const base = ackCtx();
    const st = base.L.front.stub;
    const spindle = boxPart('spindle-L', 'steer-L', 'steering', [st.L[0], st.L[1], st.L[2]], [2, 3, 2]);
    const bracket = boxPart('kp-bracket-L', 'chassis', 'steering', [st.L[0], st.L[1], st.L[2]], [2, 3, 2]); // overlapping on purpose
    const ctx = makeContext(base.p, [spindle, bracket]);
    expect(steerSweep(ctx).minClearanceIn).toBeGreaterThanOrEqual(3); // nothing counted
    const wheel = boxPart('wheel-FL', 'wheel-FL', 'running-gear', [st.L[0], st.L[1], st.L[2]], [2, 3, 2]);
    expect(steerSweep(makeContext(base.p, [wheel, bracket])).minClearanceIn).toBeGreaterThanOrEqual(3); // the bracket is judged by the scrub rule
    const block = boxPart('some-block', 'chassis', 'body', [st.L[0], st.L[1], st.L[2]], [2, 3, 2]);
    expect(steerSweep(makeContext(base.p, [wheel, block])).minClearanceIn).toBeLessThan(0);
    // The linkage group (knuckles, shoes, rods, tongue) has its own, smaller limit.
    const row = steerClearance(makeContext(base.p, [wheel, block]), steerSweep(makeContext(base.p, [wheel])));
    expect(row.details!.map((d) => d.limit)).toEqual([base.p.steeringClearanceIn - 0.05, base.p.steeringLinkClearIn]);
  });

  it.runIf(buildModel(ackParams(), { rider: 'goal', cargo: true, steerDeg: 0 }).some((x) => x.id === 'spindle-L'))(
    'steering sweep: clearance on the real model at the defaults is >= 0.7 inch and names the pair',
    () => {
      const ctx = ackCtx();
      const sw = steerSweep(ctx);
      expect(sw.minClearanceIn).toBeGreaterThanOrEqual(0.7);
      expect(sw.steerPart).not.toBe('–');
    },
  );
});

describe('row basis (spec 5.4): each re-based row pins its new formula', () => {
  const ctx = ackCtx();

  it('payload uses max(dynamicFactor, 1 + V_rear/W)', () => {
    const c = ctx.loads.goal;
    expect(payload(ctx, c)).toBeCloseTo((c.riderLb + c.cargoLb) * seatFactor(ctx, c), 9);
    // D-53: at jogging pace (5 mph) 1 + V_rear/W is about 2.5, below the dynamic factor 3, so the dynamic factor governs the payload.
    expect(seatFactor(ctx, c)).toBeGreaterThanOrEqual(ctx.p.dynamicFactor);
    expect(seatFactor(ctx, c)).toBe(Math.max(ctx.p.dynamicFactor, 1 + bumpStrike(ctx, c, 'rear', ctx.p.bumpNormalHeightIn).V / c.massLb));
  });

  it('rails: hard-hit bending details exist and scale by the factor ratio; the span runs to the front beam', () => {
    const r = railsCheck(ctx);
    expect(r.details!.some((d) => d.name.startsWith('HARD 2" rear hit'))).toBe(true);
    expect(r.how).toMatch(/Hard hit/);
  });

  it('deck, seat-back, seat-grip, foot-stop use the bump factor', () => {
    const c = ctx.loads.goal;
    const g = seatFactor(ctx, c);
    expect(deckCheck(ctx).how).toContain(`× ${g.toFixed(2)} spread`);
    expect(seatBackCheck(ctx).how).toContain(`dynamic ${g.toFixed(2)}`);
    expect(seatGripCheck(ctx).how).toContain(`× ${g.toFixed(2)}) on the bar`);
    const fs = footStopCheck(ctx);
    if (fs) expect(fs.details!.some((d) => d.name.startsWith('HARD 2" rear hit'))).toBe(true);
  });

  it('axle-stress is rear-only on the bump resultant; bearing-groove uses V + static; wheel-rating and rear-beam-seat have bump details', () => {
    const c = ctx.loads.goal;
    const ax = axleStress(ctx);
    expect(ax.how).toContain('Rear:');
    expect(ax.details!.some((d) => d.name.startsWith('HARD 2" rear hit'))).toBe(true);
    expect(ax.details![0].limit).toBeCloseTo(ctx.p.axleYieldPsi / ctx.p.steelSafetyFactor, 6);
    expect(bearingGroove(ctx).details!.length).toBe(2);
    expect(wheelRating(ctx).details![1].name).toMatch(/NORMAL 1" bump/);
    expect(rearBeamSeat(ctx).details!.some((d) => d.name.startsWith('HARD 2" rear hit'))).toBe(true);
    void c;
  });
});

describe('runChecks on the Ackermann basis', () => {
  it('every id has a light mapping, no old front-end row appears, and the sweep over 50-250 lb stays finite', () => {
    const p = defaultParams();
    for (const w of [50, 100, 150, 200, 250]) {
      const cs = runChecks(withRider(p, w), { includeTruck: false });
      for (const c of cs) {
        expect(lightOf(c), c.id).toBeTruthy();
        const nums = [c.value, c.limit, ...(c.details ?? []).flatMap((d) => [d.value, d.limit])];
        const bad = nums.filter((n) => !Number.isFinite(n) || Math.abs(n) >= 1e8);
        expect(bad, `${c.id} at ${w} lb`).toEqual([]);
      }
      const ids = cs.map((c) => c.id);
      for (const gone of ['kingpin-strike', 'steer-stops', 'turntable-ring', 'kingpin-plates', 'roll-side-bearer', 'pitch-path', 'turntable']) expect(ids).not.toContain(gone);
      for (const id of ['spindle-stub', 'kingpin-bolt', 'kingpin-bracket', 'beam-front', 'wheel-retention', 'spindle-fatigue', 'tie-rod', 'drag-link', 'bellcrank', 'tongue-tie', 'steer-kin', 'steer-lock', 'brake-lever', 'brake-beam', 'park-hold']) expect(ids).toContain(id);
      for (const gone of ['stick-cable', 'ride-rollover', 'ride-envelope', 'steer-centering', 'ride-steer-effort', 'brake-front', 'hip-cable', 'belt-anchor']) expect(ids).not.toContain(gone);
    }
    for (const id of ['steer-kin', 'steer-lock', 'park-hold', 'brake-lever', 'brake-links', 'brake-beam', 'brake-shoes']) expect(LIGHT_OF_ID[id], id).toBeTruthy();
    for (const id of ['brake-stop', 'brake-emergency', 'brake-heat', 'brake-bias', 'ride-rollover']) expect(LIGHT_OF_ID[id], id).toBeUndefined();
  });

  it('a heavier rider loads the bump rows more (monotone utilization on spindle-stub)', () => {
    const p = defaultParams();
    const u = (w: number) => byId(runChecks(withRider(p, w), { includeTruck: false }), 'spindle-stub').util!;
    expect(u(200)).toBeGreaterThan(u(100));
  });
});
