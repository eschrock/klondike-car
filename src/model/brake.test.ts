/**
 * The handler's basic rear brake and the rear push handle (Phase 3c-1, D-53; handle D-9/D-39): the kinematics are checked against independent derivations
 * (virtual work by finite differences, the closed link re-measured from the parts), the parts against their declared contacts, and the whole thing over the
 * parameter extremes. The D-38/D-48 cross-shaft mechanism (shaft, bearing plates, crank, ratchet, front brakes, hip lever, lap belt) no longer exists.
 */
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, type Params } from '../params';
import { makeCtx } from './build-utils';
import { brakeGeometry, brakePose, buildBrake, buildBrakeAt, rot2, type V2 } from './brake';
import { handleGeometry } from './handle';
import { buildModel } from './index';
import { transformPoint, worldAABB } from './bounds';
import type { Part } from './types';

const defaults = defaultParams();
const RAD = Math.PI / 180;
const geomOf = (p: Params) => { const c = makeCtx(p); return { c, g: brakeGeometry(c.p, c.L) }; };

describe('brake kinematics (hand calculation)', () => {
  const { c, g } = geomOf(defaults);
  const r = c.L.r;
  it('the beam rests on the keeper strap at the rail bottom plane; the shoes sit a few degrees below the axle line on the rear of the tread', () => {
    const railBot = c.L.deckBot - defaults.railDepthIn;
    expect(g.bl.zB).toBeCloseTo(railBot + defaults.brakeBeamSizeIn / 2, 9);
    const rBack = r + defaults.brakeLiningThickIn + defaults.brakeShoeBackThickIn;
    expect(g.bl.beta).toBeCloseTo(Math.asin((r - g.bl.zB) / rBack), 9);
    expect(g.bl.beta / RAD).toBeGreaterThan(-1);
    expect(g.bl.beta / RAD).toBeLessThan(8);
    // The beam front face touches the shoe back at its middle, released: x = -rBack cos β - stroke.
    expect(g.bl.xFront).toBeCloseTo(-rBack * Math.cos(g.bl.beta) - g.bl.stroke, 9);
    expect(g.bl.stroke).toBeCloseTo(defaults.brakeShoeTravelIn / Math.cos(g.bl.beta), 9);
  });
  it('the closed link keeps its length from released to applied, and every pose in between', () => {
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      const q = brakePose(g, s);
      expect(Math.hypot(q.T[0] - q.B[0], q.T[1] - q.B[1]), `s=${s}`).toBeCloseTo(g.linkLen, 6);
      expect(q.B[0] - g.B0[0]).toBeCloseTo(s * g.bl.stroke, 9);
      // the tail pin turns about the pivot at a fixed radius
      expect(Math.hypot(q.T[0] - g.Q[0], q.T[1] - g.Q[1])).toBeCloseTo(g.tailIn, 6);
    }
    expect(brakePose(g, 1).thetaL).toBeCloseTo(g.thetaL, 9);
    expect(g.thetaL).toBeGreaterThan(8 * RAD);
    expect(g.thetaL).toBeLessThan(18 * RAD);
  });
  it('the lined shoe is on the tread applied and the stroke off it released (model parts, the arc measured about the axle)', () => {
    const gap = (shoe: Part) => {
      if (shoe.geometry.type !== 'extrusion') throw new Error('shoe');
      let best = Infinity;
      for (const q of shoe.geometry.outline) for (const z of [0, shoe.geometry.depth]) {
        const m = shoe.transform;
        const x = m[0] * q[0] + m[4] * q[1] + m[8] * z + m[12];
        const zz = m[2] * q[0] + m[6] * q[1] + m[10] * z + m[14];
        best = Math.min(best, Math.hypot(x, zz - r) - r);
      }
      return best;
    };
    const rel = buildBrakeAt(c, 0).find((x) => x.id === 'brake-shoe-L')!;
    const app = buildBrakeAt(c, 1).find((x) => x.id === 'brake-shoe-L')!;
    expect(gap(app)).toBeCloseTo(0, 6);
    expect(gap(rel)).toBeGreaterThan(defaults.brakeShoeTravelIn - 0.03);
    expect(gap(rel)).toBeLessThan(defaults.brakeShoeTravelIn + 0.03);
  });
  it('virtual work: F_c / F_hand = dG/dB (the grip moves dG horizontally while the beam moves dB), divided by (cos β ± μ sin β) for the total shoe normal force', () => {
    const h = 1e-4;
    const a = brakePose(g, 1 - h), b = brakePose(g, 1);
    const dG = (a.G[0] - b.G[0]) ;
    const dB = b.B[0] - a.B[0];
    const fc = dG / dB; // beam force per horizontal hand force
    const mu = defaults.brakePadMu, beta = g.bl.beta;
    expect(g.ratioFwd).toBeCloseTo(fc / (Math.cos(beta) + mu * Math.sin(beta)), 1);
    expect(g.ratioRev).toBeCloseTo(fc / (Math.cos(beta) - mu * Math.sin(beta)), 1);
    // the cross-product form agrees: (l_grip / d_Q) · u_x
    expect(fc).toBeCloseTo((g.lGrip / g.dQ) * g.ux, 1);
  });
  it('the derived ratio clears the 10:1 target with room (about 15:1), forward is the smaller (the de-servo) direction, and the grip travel is inside the 6.5" limit', () => {
    expect(g.ok).toBe(true);
    expect(g.ratioCrit).toBe(Math.min(g.ratioFwd, g.ratioRev));
    expect(g.ratioCrit).toBeGreaterThan(defaults.brakeLeverRatio);
    expect(g.critical).toBe('forward');
    expect(Math.abs(g.ratioRev - g.ratioFwd) / g.ratioFwd).toBeLessThan(0.1); // no servo: the shoes sit near the axle line
    expect(g.gripTravelIn).toBeLessThan(defaults.brakeGripTravelMaxIn);
    // grip travel = horizontal sweep of the grip: lever arm l_grip times the angle, to first order
    expect(g.gripTravelIn).toBeCloseTo(g.lGrip * Math.sin(g.thetaL), 0);
  });
  it('a shorter lever tail raises the ratio; the link failing to close is reported and nothing throws', () => {
    const short = geomOf({ ...defaults, brakeLeverTailIn: 1.25 } as Params).g;
    expect(short.ratioCrit).toBeGreaterThan(g.ratioCrit);
    const far = geomOf({ ...defaults, brakeShoeTravelIn: 0.75, brakeLeverTailIn: 1 } as Params).g;
    expect(Number.isFinite(far.ratioCrit)).toBe(true);
  });
  it('the pivot is above the link line by the tail length, and the parking holes straddle the applied angle', () => {
    expect(g.Q[1] - g.bl.zB).toBeCloseTo(defaults.brakeLeverTailIn * Math.cos(defaults.brakeLeverTiltDeg * RAD), 9);
    const pk = g.park;
    expect(pk.angles).toHaveLength(5);
    expect(pk.angles[pk.designIndex]).toBeCloseTo(g.thetaL, 9);
    expect(pk.angles[1] - pk.angles[0]).toBeCloseTo(defaults.brakeParkPitchIn / defaults.brakeParkRadiusIn, 9);
  });
});

describe('brake parts', () => {
  const ctx = makeCtx(defaults);
  const brake = buildBrake(ctx);
  const all = buildModel(defaults);
  const byId = (id: string) => all.find((x) => x.id === id)!;
  it('has the whole chain: beam, two shoes, two keepers, clevis, two link bars and pins, lever with grip, parking pin, pivot bracket, spring, handle sockets', () => {
    for (const id of ['brake-beam', 'brake-shoe-L', 'brake-shoe-R', 'brake-keeper-L', 'brake-keeper-R', 'brake-clevis', 'brake-link-a', 'brake-link-b', 'brake-link-pin-T', 'brake-link-pin-B',
      'brake-lever', 'brake-lever-grip', 'brake-park-pin', 'brake-pivot-base', 'brake-pivot-ear-L', 'brake-pivot-ear-R', 'brake-pivot-pin', 'brake-return-spring', 'handle-socket-L', 'handle-socket-R']) {
      expect(brake.some((x) => x.id === id), id).toBe(true);
    }
  });
  it('the old mechanism is gone: no cross shaft, bearing plates, doublers, crank, ratchet, pawl, hubs, arms, front brakes, equalizer, hip lever, cables, belt', () => {
    const banned = /^(brake-(shaft|bearing-plate|rail-doubler|bushing|arm|hub|crank|quadrant|pawl|lever-pin|lever-spacer|lever-sleeve|shoe-pin|shoe-yoke|front|bias|link-clevis|drum)|hip-|lap-belt|belt-|brake-hip|brake-lost)/;
    expect(all.filter((x) => banned.test(x.id)).map((x) => x.id)).toEqual([]);
    expect(all.some((x) => /^brake-shoe-F/.test(x.id) || /^brake-shoe-(yoke|pivot)/.test(x.id))).toBe(false);
  });
  it('every metal part is a cut, drilled or bought piece (no welding), with a source and stock dimensions', () => {
    for (const x of brake.filter((q) => q.group === 'brake' && (q.kind === 'metal' || q.kind === 'purchased'))) {
      expect(['drill-tap', 'outsource', 'buy'], x.id).toContain(x.fab);
      expect(x.sourcing?.vendor, x.id).toBeTruthy();
      if (x.kind === 'metal') expect(x.stock, x.id).toBeDefined();
      expect(`${x.notes ?? ''} ${x.sourcing?.vendor ?? ''}`.toLowerCase(), x.id).not.toMatch(/\bweld(ed|ing)?\b/);
    }
  });
  it('the beam is a 6061-T6 square tube across the tail: 1.75" x 0.125" wall, ends at the shoe centers plus an inch, mass from the section', () => {
    const b = byId('brake-beam');
    expect(b.material).toMatch(/6061-T6 aluminum square tube/);
    const bb = worldAABB(b);
    expect(bb.min[1]).toBeCloseTo(-(defaults.rearTrackIn / 2 + 1), 9);
    expect(bb.max[1]).toBeCloseTo(defaults.rearTrackIn / 2 + 1, 9);
    const section = defaults.brakeBeamSizeIn ** 2 - (defaults.brakeBeamSizeIn - 2 * defaults.brakeBeamWallIn) ** 2;
    expect(b.massLb).toBeCloseTo((section * (defaults.rearTrackIn + 2) * defaults.aluminumDensityPcf) / 1728, 6);
    expect(b.stock).toMatchObject({ t: defaults.brakeBeamWallIn, w: defaults.brakeBeamSizeIn });
  });
  it('the shoes are purchased lined steel-backed shoes at the ends of the beam, radius-matched to the 13" tire: lining inner radius 6.5" about the axle applied, steel back outer 6.875"', () => {
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
      const x = m[0] * q[0] + m[4] * q[1] + m[12];
      const z = m[2] * q[0] + m[6] * q[1] + m[14];
      return Math.hypot(x, z - ctx.L.r);
    });
    expect(Math.min(...radii)).toBeCloseTo(6.5, 6);
    expect(Math.max(...radii)).toBeCloseTo(6.5 + defaults.brakeLiningThickIn + defaults.brakeShoeBackThickIn, 6);
  });
  it('the lever is a 1/4" x 1-1/2" aluminum flat bar on the centerline, its grip is under the push-handle bar, and the lever, grip, pins and spring are removable', () => {
    const lv = byId('brake-lever');
    expect(lv.material).toMatch(/6061-T6 aluminum flat bar/);
    expect(lv.removable).toBe(true);
    const bb = worldAABB(lv);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(defaults.brakeBarThickIn, 9);
    expect(worldAABB(byId('brake-lever-grip')).max[2]).toBeLessThan(worldAABB(byId('handle-bar')).min[2]);
    expect(Math.abs(transformPoint(byId('brake-lever-grip').transform, [0, 0, 0])[1])).toBeLessThan(1e-9);
    for (const id of ['brake-lever', 'brake-lever-grip', 'brake-park-pin', 'brake-pivot-pin', 'brake-return-spring']) expect(byId(id).removable, id).toBe(true);
    for (const id of ['brake-beam', 'brake-keeper-L', 'brake-pivot-base', 'brake-clevis']) expect(byId(id).removable, id).toBeFalsy();
  });
  it('bought hardware lists its source; every joint names a mating part that exists', () => {
    const ids = new Set(all.map((x) => x.id));
    for (const x of brake.filter((q) => q.kind === 'purchased' && q.fab === 'buy')) expect(x.sourcing?.vendor, x.id).toBeTruthy();
    for (const x of brake) for (const j of x.joints ?? []) {
      expect(j.count, `${x.id} → ${j.to}`).toBeGreaterThan(0);
      expect(ids.has(j.to), `${x.id} joint to ${j.to}`).toBe(true);
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
  it('all brake parts stay at or above the minimum ground clearance, released and applied', () => {
    for (const s of [0, 1]) {
      for (const x of buildBrakeAt(ctx, s).filter((q) => /^brake-/.test(q.id))) {
        expect(worldAABB(x).min[2], `${x.id} @${s}`).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn - 1e-6);
      }
    }
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
  it('mass: the whole brake group (beam, shoes, lever, bracket, sockets) is about 8 lb, 23 lb less than the 30.9 lb of the cross-shaft design with its front brakes, hip lever and belt', () => {
    const m = brake.filter((x) => x.group === 'brake').reduce((s, x) => s + x.massLb, 0);
    expect(m).toBeGreaterThan(6);
    expect(m).toBeLessThan(10);
    expect(30.9 - m).toBeGreaterThan(20);
  });
});

describe('brake and handle placement', () => {
  it('the lever pull moves the grip rearward and the tail pin forward; the lever top leans back at rest', () => {
    const { g } = geomOf(defaults);
    const p1 = brakePose(g, 1);
    expect(p1.G[0]).toBeLessThan(g.G0[0]);
    expect(p1.T[0]).toBeGreaterThan(g.T0[0]);
    expect(g.G0[0]).toBeLessThan(g.Q[0]);
  });
  it('rot2 turns counter-clockwise about a center', () => {
    const q: V2 = rot2([1, 0], [0, 0], Math.PI / 2);
    expect(q[0]).toBeCloseTo(0, 12);
    expect(q[1]).toBeCloseTo(1, 12);
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
});
