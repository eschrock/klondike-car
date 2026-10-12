import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams, PARAM_DEFS } from '../params';
import { verifyChecklist, verifyParamKeys, type VerifyWhen } from './verify';

const p = defaultParams();
const parts = buildModel(p);
const list = verifyChecklist(parts, p);
const WHEN: VerifyWhen[] = ['before ordering', 'before cutting', 'at assembly'];

describe('verify checklist', () => {
  it('has the nine checks of docs/phase3-checkpoint.md, in order, then the build-review checks and the leftover params', () => {
    expect(list.slice(0, 9).map((c) => c.id)).toEqual([
      'tire-squash', 'wheel', 'axle-tube', 'steering-parts', 'bridle', 'seat-back', 'sign-knobs', 'brake-knee', 'lamp-clip',
    ]);
    expect(list.slice(9, 11).map((c) => c.id)).toEqual(['strip-bend', 'ply-thickness']);
    expect(list[11]?.id).toBe('other-params');
    expect(list.map((c) => c.n)).toEqual(list.map((_, i) => i + 1));
    expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
  });

  it('every check says what to do, how to pass, and when', () => {
    for (const c of list) {
      expect(c.title.length, c.id).toBeGreaterThan(5);
      expect(c.whatToDo.length, c.id).toBeGreaterThan(40);
      expect(c.pass.length, c.id).toBeGreaterThan(20);
      expect(c.ifFails.length, c.id).toBeGreaterThan(10);
      expect(WHEN, c.id).toContain(c.when);
    }
  });

  it('covers every param whose status is verify', () => {
    const verify = verifyParamKeys();
    expect(verify.length).toBeGreaterThan(10);
    const covered = new Set(list.flatMap((c) => c.paramKeys));
    const missing = verify.filter((k) => !covered.has(k));
    expect(missing).toEqual([]);
    // ... and claims nothing that is not a verify param (a confirmed param drops out by itself).
    for (const k of covered) expect(PARAM_DEFS[k as keyof typeof PARAM_DEFS]?.status, k).toBe('verify');
  });

  it('asks for the real plywood thickness before any dado is cut, and the strip bend test before ordering', () => {
    const ply = list.find((c) => c.id === 'ply-thickness')!;
    expect(ply.when).toBe('before cutting');
    expect(ply.whatToDo).toContain(`${+(p.panelPlyIn + p.grooveSlopIn).toFixed(3)}"`);
    expect(ply.whatToDo).toContain(`${+(p.deckPlyIn + p.deckSlopIn).toFixed(3)}"`);
    for (const k of ply.paramKeys) expect(PARAM_DEFS[k as keyof typeof PARAM_DEFS].status).toBe('verify');
    expect(ply.partIds).toEqual(expect.arrayContaining(['deck', 'side-L-web', 'transom-rear', 'bow-bulkhead']));
    const bend = list.find((c) => c.id === 'strip-bend')!;
    expect(bend.when).toBe('before ordering');
    expect(bend.whatToDo).toMatch(/2 vs 3 plies/);
  });

  it('lists only part ids that are in the built model', () => {
    const have = new Set(parts.map((x) => x.id));
    for (const c of list) for (const id of c.partIds) expect(have.has(id), `${c.id}: ${id}`).toBe(true);
    // The guarded parts are really there.
    expect(list.find((c) => c.id === 'tire-squash')!.partIds).toEqual(['wheel-RL', 'wheel-RR', 'wheel-FL', 'wheel-FR']);
    expect(list.find((c) => c.id === 'axle-tube')!.partIds.length).toBe(3);
    for (const c of list.slice(0, 9)) expect(c.partIds.length, c.id).toBeGreaterThan(0);
  });

  it('takes the tire squash target from the params the model uses', () => {
    const squash = list[0];
    // 300 lb at <= 560 lb/in => >= 0.54", rounded up to 0.55"; the model's 500 lb/in is 0.60".
    expect(squash.paramKeys).toContain('bumpWheelRateLbIn');
    expect(squash.pass).toContain('0.55"');
    expect(squash.pass).toContain('560 lb/in');
    expect(squash.whatToDo).toContain('500 lb/in');
    expect(squash.whatToDo).toContain('0.6"');
    const stiffer = verifyChecklist(parts, { ...p, bumpWheelRateLbIn: 600 })[0];
    expect(stiffer.pass).toContain('670 lb/in');
    expect(stiffer.whatToDo).toContain('600 lb/in');
  });

  it('puts the wheel, tube, bridle and seat numbers in the procedure', () => {
    const by = (id: string) => list.find((c) => c.id === id)!;
    expect(by('wheel').pass).toContain('300 lb');
    expect(by('wheel').pass).toContain('0.75"');
    expect(by('wheel').pass).toContain('2.28"');
    expect(by('axle-tube').whatToDo).toContain('A513 Type 5');
    expect(by('axle-tube').pass).toContain('70 ksi');
    expect(by('steering-parts').pass).toContain('900 lb');
    expect(by('bridle').pass).toContain('3700 lbf');
    expect(by('bridle').pass).toContain('370 lbf'); // the rope WLL: the documented weak link
    expect(by('seat-back').pass).toContain('150 lbf');
    expect(by('brake-knee').pass).toContain('0.4');
    expect(by('lamp-clip').whatToDo).toContain('4.5" × 1.25"'); // hand-hold = clip + 0.02" a side
  });

  it('gates ordering on the purchased parts and cutting on the shop-made ones', () => {
    for (const id of ['tire-squash', 'wheel', 'axle-tube', 'steering-parts', 'bridle', 'sign-knobs']) expect(list.find((c) => c.id === id)!.when, id).toBe('before ordering');
    for (const id of ['seat-back', 'brake-knee', 'lamp-clip']) expect(list.find((c) => c.id === id)!.when, id).toBe('before cutting');
  });
});
