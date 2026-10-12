import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { HULL_STEP, STEP } from '../model/build-utils';
import { defaultParams } from '../params';
import type { Part } from '../model/types';
import { assemblySteps, cumulativeParts, hasGlueJoint, jointTally, stepParts } from './assembly';

const p = defaultParams();
const parts = buildModel(p);
const built = parts.filter((x) => x.group !== 'reference' && x.kind !== 'reference' && !x.payload);
const steps = assemblySteps(parts, p);
const VIEWS = ['iso', 'top', 'side', 'front', 'under'];

describe('assembly steps', () => {
  it('begin with the three preparation steps, which install nothing', () => {
    expect(steps.slice(0, 3).map((s) => s.title)).toEqual([
      'Verify before ordering',
      'Mill the oak and resaw the strips',
      'Cut the Shaper parts and make the forms',
    ]);
    expect(steps.map((s) => s.n)).toEqual(steps.map((_, i) => i));
    for (const s of steps.filter((x) => x.kind === 'prep')) {
      expect(s.partIds, s.id).toEqual([]);
      expect(s.modelStep, s.id).toBe(0);
    }
    // Verify points at verify.ts and its checks.
    expect(steps[0].instructions.join(' ')).toMatch(/verify\.ts/);
    expect(steps[0].instructions.join(' ')).toMatch(/Tire squash/);
  });

  it('install every built non-reference part in exactly one step', () => {
    const seen = new Map<string, number>();
    for (const s of steps) for (const id of s.partIds) seen.set(id, (seen.get(id) ?? 0) + 1);
    expect(built.length).toBeGreaterThan(150);
    for (const x of built) expect(seen.get(x.id), x.id).toBe(1);
    // ... and nothing else: no unknown ids, no mannequins, cargo or truck.
    const have = new Set(parts.map((x) => x.id));
    const mine = new Set(built.map((x) => x.id));
    for (const id of seen.keys()) {
      expect(have.has(id), id).toBe(true);
      expect(mine.has(id), `${id} is a reference part`).toBe(true);
    }
  });

  it('are in nondecreasing model-step order, and each part is installed in its own model step', () => {
    for (let i = 1; i < steps.length; i++) expect(steps[i].modelStep, steps[i].id).toBeGreaterThanOrEqual(steps[i - 1].modelStep);
    const by = new Map(parts.map((x) => [x.id, x]));
    const build = steps.filter((s) => s.partIds.length);
    for (let i = 0; i < build.length; i++) {
      const s = build[i];
      const ms = s.partIds.map((id) => by.get(id)!.step);
      expect(Math.min(...ms), s.id).toBe(s.modelStep);
      if (i + 1 < build.length) expect(Math.max(...ms), `${s.id} before ${build[i + 1].id}`).toBeLessThanOrEqual(build[i + 1].modelStep);
    }
    // The hull sub-steps appear in the HULL_STEP order.
    const at = (ms: number): number => steps.findIndex((s) => s.partIds.some((id) => by.get(id)!.step === ms));
    expect(at(STEP.frame)).toBeLessThan(at(HULL_STEP.deck) + 1);
    expect(at(HULL_STEP.deck)).toBeLessThan(at(HULL_STEP.sides));
    expect(at(HULL_STEP.sides)).toBeLessThan(at(HULL_STEP.transom));
    expect(at(HULL_STEP.transom)).toBeLessThan(at(STEP.gear));
    expect(at(STEP.gear)).toBeLessThan(at(STEP.spindles));
    expect(at(STEP.spindles)).toBeLessThan(at(STEP.seatStorage));
    expect(at(STEP.seatStorage)).toBeLessThan(at(STEP.brake));
    expect(at(STEP.brake)).toBeLessThan(at(STEP.finish));
  });

  it('close the hull in the order of the HULL_STEP comment', () => {
    const idx = (id: string): number => steps.findIndex((s) => s.id === id);
    expect(idx('rails')).toBeLessThan(idx('frame'));
    expect(idx('frame')).toBeLessThan(idx('sides-inner'));
    expect(idx('sides-inner')).toBeLessThan(idx('sides-outer')); // two cures per side
    expect(idx('sides-outer')).toBeLessThan(idx('dry-fit'));
    expect(idx('dry-fit')).toBeLessThan(idx('lower'));
    expect(idx('lower')).toBeLessThan(idx('transom')); // close ONE end first
    expect(idx('transom')).toBeLessThan(idx('bulkhead'));
    expect(idx('hangers')).toBeLessThan(idx('frame')); // joist-1's end Dominos go into the hangers
    expect(idx('wheels')).toBeLessThan(idx('flip')); // running gear on the inverted hull, then turn it over
    expect(idx('flip')).toBeLessThan(idx('tongue'));
    expect(idx('wood-fitout')).toBeLessThan(idx('finish')); // glue before the finish
    expect(idx('finish')).toBeLessThan(idx('final-fit')); // hardware after the varnish
  });

  it('give every step with a glue joint a clampCure with pot life and cure times', () => {
    for (const s of steps) {
      const glued = s.partIds.some((id) => hasGlueJoint(parts.find((x) => x.id === id) as Part));
      if (glued || s.cure) {
        expect(s.clampCure, s.id).toBeTruthy();
        expect(s.clampCure, s.id).toMatch(/pot life \d+-\d+ min/);
        expect(s.clampCure, s.id).toMatch(/clamp \d+-\d+ h/);
        expect(s.clampCure, s.id).toMatch(/full cure \d+ h\+/);
        expect(s.cure, s.id).toBeDefined();
      }
    }
    // Every build step that installs wood joints is in that set.
    expect(steps.filter((s) => s.clampCure).length).toBeGreaterThan(12);
  });

  it('uses 206 for the normal glue-ups and 209 (120 min) for closing the ends', () => {
    const get = (id: string) => steps.find((s) => s.id === id)!;
    expect(get('frame').cure!.hardener).toBe('206');
    expect(get('frame').cure!.potMin).toEqual([20, 25]);
    expect(get('frame').cure!.clampHours).toEqual([8, 10]);
    expect(get('frame').cure!.fullHours).toBe(24);
    for (const id of ['transom', 'bulkhead']) {
      expect(get(id).cure!.hardener, id).toBe('209');
      expect(get(id).cure!.potMin[1], id).toBe(120);
      expect(get(id).clampCure, id).toMatch(/209 extra slow/);
    }
    expect(get('frame').clampCure).toMatch(/60 °F/); // winter figures
  });

  it('have 3-8 terse instructions, a title, tools, checks and a valid camera', () => {
    for (const s of steps) {
      expect(s.title.length, s.id).toBeGreaterThan(4);
      expect(s.instructions.length, s.id).toBeGreaterThanOrEqual(3);
      expect(s.instructions.length, s.id).toBeLessThanOrEqual(8);
      expect(s.checks.length, s.id).toBeGreaterThanOrEqual(1);
      expect(VIEWS, s.id).toContain(s.view);
    }
    for (const s of steps.filter((x) => x.kind !== 'process')) expect(s.tools.length, s.id).toBeGreaterThan(0);
  });

  it('look at the running gear from underneath (hull still inverted)', () => {
    const gear = steps.filter((s) => s.kind === 'build' && s.modelStep >= STEP.steering && s.modelStep <= STEP.gear);
    expect(gear.length).toBeGreaterThanOrEqual(3);
    for (const s of gear) expect(s.view, s.id).toBe('under');
  });

  it('build instructions from the joints and the params', () => {
    const get = (id: string) => steps.find((s) => s.id === id)!;
    // Domino counts come from the joint list (9 per side to the chine band, 18 in all).
    expect(get('rails').instructions.join(' ')).toContain('4×20 ×18');
    expect(get('lower').instructions.join(' ')).toMatch(/18 Dominos/);
    expect(get('dry-fit').instructions.join(' ')).toContain(`${p.deckSideClearIn}"`);
    expect(get('shaper').instructions.join(' ')).toMatch(/ONE piece from the full 4' × 8' sheet/);
    expect(get('shaper').instructions.join(' ')).not.toMatch(/scarf/i);
    expect(get('wheels').instructions.join(' ')).toContain(`${p.wheelBoreIn}" bore`);
  });

  it('count a joint listed on both mating parts once', () => {
    const ids = new Set(['rail-L', 'rail-R']);
    const t = jointTally(parts, ids, 'domino', (j) => (/^4×20/.test(j.size ?? '') ? '4×20' : 'other'));
    expect(t.get('4×20')).toBe(18);
  });
});

describe('cumulativeParts', () => {
  it('is monotonic and ends with every part', () => {
    let prev = new Set<string>();
    for (const s of steps) {
      const now = cumulativeParts(steps, s.n);
      const set = new Set(now);
      expect(set.size, `no duplicates at ${s.id}`).toBe(now.length);
      for (const id of prev) expect(set.has(id), `${id} vanished at ${s.id}`).toBe(true);
      expect(set.size - prev.size, s.id).toBe(s.partIds.length);
      for (const id of s.partIds) expect(set.has(id) && !prev.has(id), id).toBe(true);
      prev = set;
    }
    expect(prev.size).toBe(built.length);
    expect(cumulativeParts(steps, -1)).toEqual([]);
    expect(cumulativeParts(steps, 0)).toEqual([]);
    expect(stepParts(steps, steps.findIndex((s) => s.id === 'transom'))).toContain('transom-rear');
  });
});

describe('a part the templates do not know', () => {
  it('still lands in exactly one step, in model-step order', () => {
    const fake = (id: string, step: number): Part => ({ ...(parts.find((x) => x.id === 'joist-2') as Part), id, name: id, step, joints: [] });
    const extra = [fake('zz-hull', HULL_STEP.sides), fake('zz-steer', STEP.steering), fake('zz-late', STEP.brake), fake('zz-new', 4.45)];
    const s2 = assemblySteps([...parts, ...extra], p);
    const seen = new Map<string, number>();
    for (const s of s2) for (const id of s.partIds) seen.set(id, (seen.get(id) ?? 0) + 1);
    for (const x of extra) expect(seen.get(x.id), x.id).toBe(1);
    for (const x of [...built, ...extra]) expect(seen.get(x.id), x.id).toBe(1);
    for (let i = 1; i < s2.length; i++) expect(s2[i].modelStep).toBeGreaterThanOrEqual(s2[i - 1].modelStep);
    // The generated step for 4.45 sits between the transom closing (4.4) and the running gear (4.6).
    const at = (id: string): number => s2.findIndex((s) => s.partIds.includes(id));
    expect(at('zz-new')).toBeGreaterThan(at('bow-bulkhead'));
    expect(at('zz-new')).toBeLessThan(at('beam-R'));
  });
});
