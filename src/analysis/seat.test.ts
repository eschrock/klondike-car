import { describe, expect, it } from 'vitest';
import { defaultParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeContext } from './context';
import { lidOpenAngleDeg, seatBackLoads, seatChecks } from './seat';

const ctxFor = (patch: Partial<Params> = {}) => {
  const p = { ...defaultParams(), ...patch } as Params;
  return makeContext(p, buildModel(p, { rider: 'goal', cargo: true, steerDeg: 0 }));
};
const ctx = ctxFor();

describe('seatChecks', () => {
  const checks = seatChecks(ctx);
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  it('returns the five rows, all in the Structure group and finite', () => {
    expect(checks.map((c) => c.id)).toEqual(['seat-back', 'seat-grip', 'storage-pack', 'storage-lid-open', 'lash-points']);
    for (const c of checks) {
      expect(c.group).toBe('Structure');
      expect(Number.isFinite(c.value), c.id).toBe(true);
      expect(c.how.length, c.id).toBeGreaterThan(20);
    }
  });
  it('seat back passes at the operating rider and the goal rider, with every criterion under 1.0', () => {
    const c = byId['seat-back'];
    expect(c.statusOperating).not.toBe('fail');
    expect(c.statusGoal).not.toBe('fail');
    expect(c.details!.map((d) => d.name)).toEqual(['stile bending at the crest', 'crest bearing on the wedge', 'insert pull-out (each stud)', 'ply panel bending']);
    for (const d of c.details!) expect(d.util, d.name).toBeLessThan(1);
  });
  it('seat-back statics balance: R_A + R_B = w·H and moments about the stud vanish', () => {
    const k = seatBackLoads(ctx, 200);
    expect(k.Q).toBeCloseTo(200 * 3 * 0.5, 9);
    expect(k.RA + k.RB).toBeCloseTo(k.w * k.sup.H, 9);
    // Moment about B: R_A (A − B) = w H (H/2 − B).
    expect(k.RA * (k.A - k.B)).toBeCloseTo(k.w * k.sup.H * (k.sup.H / 2 - k.B), 9);
    // The load is carried aft, so the stud (below the crest) is in tension.
    expect(k.RB).toBeLessThan(0);
    expect(k.T).toBeCloseTo(-k.RB, 9);
    // Hand check at the defaults: w = 300/2/16 = 9.375 lbf/in per stile.
    expect(k.w).toBeCloseTo(9.375, 9);
  });
  it('a heavier torso share and a weak insert fail the row (the check has teeth)', () => {
    const bad = seatChecks(ctxFor({ seatBackLoadFraction: 1, seatInsertAllowLbf: 100 })).find((c) => c.id === 'seat-back')!;
    expect(bad.status).toBe('fail');
    expect(bad.governingLoad).toBeDefined();
  });
  it('pull-out force falls as the stud moves farther below the crest', () => {
    const hi = seatBackLoads(ctxFor({ seatBackKnobHeightIn: 2.6 }), 200).T;
    const lo = seatBackLoads(ctxFor({ seatBackKnobHeightIn: 1.4 }), 200).T;
    expect(lo).toBeLessThan(hi);
  });
  it('grip row: no pinch point and a post that holds a hard pull', () => {
    const c = byId['seat-grip'];
    expect(c.status).not.toBe('fail');
    const bad = seatChecks(ctxFor({ seatGripGapIn: 1.25 })).find((q) => q.id === 'seat-grip')!;
    expect(bad.status).not.toBe('fail');
  });
  it('storage packing reports the kit against the real interior', () => {
    const c = byId['storage-pack'];
    expect(c.status).not.toBe('fail');
    expect(c.value).toBeGreaterThan(0.5);
    expect(c.how).toMatch(/First-aid kit/);
    const small = seatChecks(ctxFor({ storageVolumeIn3: 1000 })).find((q) => q.id === 'storage-pack')!;
    expect(small.status).toBe('fail');
  });
  it('lid opening: the leaning back stops the lid near 90° minus the recline', () => {
    expect(lidOpenAngleDeg(ctx)).toBeGreaterThan(70);
    expect(lidOpenAngleDeg(ctx)).toBeLessThanOrEqual(90 - ctx.p.seatBackAngleDeg + 2);
    expect(lidOpenAngleDeg(ctxFor({ seatBackAngleDeg: 0 }))).toBe(90);
    expect(byId['storage-lid-open'].status).not.toBe('fail');
  });
  it('lash points: 6 at the defaults', () => {
    expect(byId['lash-points'].value).toBe(6);
    expect(byId['lash-points'].status).not.toBe('fail');
  });
});
