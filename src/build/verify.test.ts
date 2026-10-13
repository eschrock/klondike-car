import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams, PARAM_DEFS, thinSheet } from '../params';
import { PRE_D72 } from '../test-fixtures';
import { verifyChecklist, verifyParamKeys, type VerifyWhen } from './verify';

const p = defaultParams();
const parts = buildModel(p);
const list = verifyChecklist(parts, p);
const WHEN: VerifyWhen[] = ['before ordering', 'before cutting', 'at assembly'];

describe('verify checklist', () => {
  it('has the nine checks of docs/phase3-checkpoint.md, in order, then the build-review checks and the leftover params', () => {
    expect(list.slice(0, 9).map((c) => c.id)).toEqual([
      'tire-squash', 'wheel', 'axle-rod', 'steering-parts', 'bridle', 'seat-back', 'sign-knobs', 'brake-knee', 'lamp-clip',
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
    expect(ply.whatToDo).toContain(`${+(thinSheet(p).thicknessIn + p.grooveSlopIn).toFixed(3)}"`); // D-73: the thin sheet in effect (0.21 in white oak plywood + slop)
    expect(ply.whatToDo).toMatch(/white oak plywood/);
    expect(ply.paramKeys).toContain('whiteOakPlyThickIn');
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
    expect(list.find((c) => c.id === 'axle-rod')!.partIds.length).toBe(3);
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
    expect(by('wheel').pass).toContain('5/8"'); // D-71: 5/8 in, printed as a fraction (D-72)
    expect(by('wheel').whatToDo).toMatch(/MEASURE THE HUB LENGTH/);
    expect(by('wheel').pass).toContain('2.25"');
    // D-71: Eric chose the solid rod, so the axle item is the light rod check (1045 / cold-drawn, not hot-rolled A36) and the tube item only appears with a tube
    expect(list.some((c) => c.id === 'axle-tube')).toBe(false);
    expect(by('axle-rod').title).toMatch(/1045 or cold-drawn/);
    expect(by('axle-rod').title).toMatch(/not hot-rolled A36/);
    expect(by('axle-rod').pass).toContain('70 ksi');
    expect(by('axle-rod').pass).toMatch(/1018 cold-drawn at 54 ksi would be about 1\.0/);
    const tube = verifyChecklist(buildModel({ ...p, ...PRE_D72 }), { ...p, ...PRE_D72 }).find((c) => c.id === 'axle-tube')!;
    expect(tube.whatToDo).toContain('A513 Type 5');
    expect(tube.pass).toContain('70 ksi');
    expect(tube.pass).toMatch(/ERW.*from 0\.92 to about 1\.4\d at the goal rider/s); // derived from the rows (the tube's 0.92 scaled by 70 / 45 ksi), not typed
    expect(by('steering-parts').pass).toContain('900 lb');
    expect(by('bridle').pass).toContain('3700 lbf');
    expect(by('bridle').pass).toContain('370 lbf'); // the rope WLL: the documented weak link
    expect(by('seat-back').pass).toContain('150 lbf');
    expect(by('brake-knee').pass).toContain('0.4');
    expect(by('lamp-clip').whatToDo).toContain('4.5" × 1.25"'); // hand-hold = clip + 0.02" a side
  });

  it('gates ordering on the purchased parts and cutting on the shop-made ones', () => {
    for (const id of ['tire-squash', 'wheel', 'axle-rod', 'steering-parts', 'bridle', 'sign-knobs']) expect(list.find((c) => c.id === id)!.when, id).toBe('before ordering');
    for (const id of ['seat-back', 'brake-knee', 'lamp-clip']) expect(list.find((c) => c.id === id)!.when, id).toBe('before cutting');
  });

  it('round 2: the one-knee test says "the other knee" and comes before the knees are glued; the strip bend test uses the planned spares', () => {
    const knee = list.find((c) => c.id === 'brake-knee')!;
    expect(knee.whatToDo).toMatch(/before cutting the other knee/);
    expect(knee.whatToDo).not.toMatch(/three knees/);
    expect(knee.whatToDo).toMatch(/BEFORE the knees are glued/);
    const bend = list.find((c) => c.id === 'strip-bend')!;
    expect(bend.whatToDo).toMatch(/FIRST board of each strip pool/);
    expect(bend.whatToDo).toMatch(/planned SPARE strips/);
    expect(bend.whatToDo).toMatch(/\d+ spare strips?\)/);
  });
});
