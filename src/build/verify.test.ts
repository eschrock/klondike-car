import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams, PARAM_DEFS } from '../params';
import { PRE_D72 } from '../test-fixtures';
import { paramLabels, unusedVerifyKeys, verifyChecklist, verifyGroups, verifyParamKeys, type VerifyWhen } from './verify';

const p = defaultParams();
const parts = buildModel(p);
const list = verifyChecklist(parts, p);
const WHEN: VerifyWhen[] = ['before ordering', 'before cutting', 'at assembly'];

describe('verify checklist', () => {
  it('numbers the checks in the order they are shown: before ordering, then before cutting, then at assembly (the D-77 strap check follows the bow rib check)', () => {
    expect(list.map((c) => c.id)).toEqual([
      'tire-squash', 'wheel', 'axle-rod', 'steering-parts', 'bridle', 'sign-knobs', 'strip-bend', // before ordering
      'seat-back', 'brake-knee', 'lamp-clip', 'ply-thickness', 'other-params', // before cutting
      'bow-rib-clearance', 'brake-strap', // at assembly
    ]);
    expect(list.map((c) => c.n)).toEqual(list.map((_, i) => i + 1));
    expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
    // the display order and the numbering agree: each group is a run of consecutive numbers, in the order of WHEN
    const whenIdx = list.map((c) => WHEN.indexOf(c.when));
    expect([...whenIdx].sort((x, y) => x - y)).toEqual(whenIdx);
  });

  it('the intro lines of the step count the checks that are really there, one line per group', () => {
    const g = verifyGroups(list);
    expect(g.map((q) => q.when)).toEqual(WHEN);
    expect(g.map((q) => q.titles.length)).toEqual(WHEN.map((w) => list.filter((c) => c.when === w).length));
    expect(g[0].text).toContain(`do these ${g[0].titles.length} checks`);
    expect(g[1].text).toContain(`${g[1].titles.length} more checks`);
    expect(g[2].text).toMatch(new RegExp(`${g[2].titles.length} more checks?, each at its own step`));
    expect(g.flatMap((q) => q.titles)).toEqual(list.map((c) => c.title));
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
    const unused = unusedVerifyKeys(p); // the axle tube's strengths (the axle is a solid rod) and the other thin sheets' thicknesses are not this design's
    expect(unused).toEqual(expect.arrayContaining(['axleTubeYieldPsi', 'axleTubeUltimatePsi', 'balticThinThickIn']));
    const verify = verifyParamKeys().filter((k) => !unused.includes(k));
    expect(verify.length).toBeGreaterThan(10);
    const covered = new Set(list.flatMap((c) => c.paramKeys));
    const missing = verify.filter((k) => !covered.has(k));
    expect(missing).toEqual([]);
    // ... and claims no unused param, and no param that is not a verify param except the ones the plywood check tells you to enter (the deck ply thickness).
    for (const k of covered) { expect(unused, k).not.toContain(k); if (k !== 'deckPlyIn') expect(PARAM_DEFS[k as keyof typeof PARAM_DEFS]?.status, k).toBe('verify'); }
    expect(list.find((c) => c.id === 'other-params')!.paramKeys.some((k) => unused.includes(k))).toBe(false);
  });

  it('asks for the real plywood thickness before any dado is cut, and the strip bend test before ordering', () => {
    const ply = list.find((c) => c.id === 'ply-thickness')!;
    expect(ply.when).toBe('before cutting');
    expect(ply.whatToDo).toContain('1/4" wide (fit to the ply)'); // the thin sheet in effect (7/32 white oak plywood + slop), as a fraction
    expect(ply.whatToDo).toMatch(/white oak plywood/);
    expect(ply.paramKeys).toContain('whiteOakPlyThickIn');
    expect(ply.whatToDo).toContain('33/64" wide (fit to the ply)');
    // the sheet this design uses (white oak plywood, not Baltic birch) and the deck ply: the two values its fail text tells you to enter
    expect(ply.paramKeys).toEqual(['whiteOakPlyThickIn', 'deckPlyIn']);
    expect(ply.ifFails).toContain(`"${PARAM_DEFS.deckPlyIn.label}"`);
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
    // 300 lb at <= 560 lb/in => >= 0.54", rounded up to 9/16"; the model's 500 lb/in is 0.60", about 5/8".
    expect(squash.paramKeys).toContain('bumpWheelRateLbIn');
    expect(squash.pass).toContain('9/16"');
    expect(squash.pass).toContain('560 lb/in');
    expect(squash.whatToDo).toContain('500 lb/in');
    expect(squash.whatToDo).toContain('about 5/8"');
    const stiffer = verifyChecklist(parts, { ...p, bumpWheelRateLbIn: 600 })[0];
    expect(stiffer.pass).toContain('670 lb/in');
    expect(stiffer.whatToDo).toContain('600 lb/in');
  });

  it('puts the wheel, tube, bridle and seat numbers in the procedure', () => {
    const by = (id: string) => list.find((c) => c.id === id)!;
    expect(by('wheel').pass).toContain('300 lb');
    expect(by('wheel').pass).toContain('5/8"'); // D-71: 5/8 in, printed as a fraction (D-72)
    expect(by('wheel').whatToDo).toMatch(/MEASURE THE HUB LENGTH/);
    expect(by('wheel').pass).toContain('2-1/4"');
    // D-71: Eric chose the solid rod, so the axle item is the light rod check (1045 / cold-drawn, not hot-rolled A36) and the tube item only appears with a tube
    expect(list.some((c) => c.id === 'axle-tube')).toBe(false);
    expect(by('axle-rod').title).toMatch(/1045 or cold-drawn/);
    expect(by('axle-rod').title).toMatch(/not hot-rolled A36/);
    expect(by('axle-rod').pass).toContain('70 ksi');
    expect(by('axle-rod').pass).toMatch(/the rear axle passes with about 20 % to spare with 70 ksi steel/); // plain words, not "the row is 0.79"
    expect(by('axle-rod').pass).toMatch(/1018 cold-drawn at 54 ksi it is right at its limit/);
    expect(by('axle-rod').pass).toMatch(/hot-rolled A36 at 36 ksi it fails by about/);
    expect(by('axle-rod').pass).not.toMatch(/\b0\.\d\d\b/);
    const tube = verifyChecklist(buildModel({ ...p, ...PRE_D72 }), { ...p, ...PRE_D72 }).find((c) => c.id === 'axle-tube')!;
    expect(tube.whatToDo).toContain('A513 Type 5');
    expect(tube.pass).toContain('70 ksi');
    expect(tube.pass).toMatch(/ERW.*the rear axle passes with about \d+ % to spare.*with ERW tube it fails by about \d+ %/s); // derived from the rows (scaled by 70 / 45 ksi), not typed
    expect(by('steering-parts').pass).toContain('900 lb');
    expect(by('bridle').pass).toContain('3700 lbf');
    expect(by('bridle').pass).toContain('370 lbf'); // the rope WLL: the documented weak link
    expect(by('seat-back').pass).toContain('150 lbf');
    expect(by('brake-knee').pass).toContain('0.4');
    expect(by('lamp-clip').whatToDo).toContain('4-1/2" × 1-1/4"'); // hand-hold = clip + 1/50" a side
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

describe('D-77: the pivot strap check', () => {
  const c = list.find((q) => q.id === 'brake-strap')!;
  it('dry-fits the tongue through the swing with 1/16" all round, slides the pin through the strap and the blind hole with the clip on, and pushes the foot sideways', () => {
    expect(c.when).toBe('at assembly');
    expect(c.whatToDo).toMatch(/whole stroke/);
    expect(c.whatToDo).toMatch(/1\/16" of clearance all round/);
    expect(c.whatToDo).toMatch(/through the strap, the tongue and block, and into the blind hole/);
    expect(c.whatToDo).toMatch(/hitch-pin clip/);
    expect(c.pass).toMatch(/the strap does not move/);
    expect(c.partIds).toEqual(expect.arrayContaining(['brake-strap-L', 'brake-strap-R', 'brake-knee-L', 'brake-flap-L']));
  });
  it('names the assumed sideways push by its params-panel label, with the number from the design, and no param key', () => {
    expect(c.whatToDo).toContain(`"${PARAM_DEFS.brakeFlapSideLoadLbf.label}"`);
    expect(c.whatToDo).toContain(`about ${p.brakeFlapSideLoadLbf} lb`);
    expect(c.pass).toContain(`At ${p.brakeFlapSideLoadLbf} lb sideways`);
    expect(c.ifFails).toContain(`"${PARAM_DEFS.brakeFlapSideLoadLbf.label}"`);
    expect(`${c.whatToDo} ${c.ifFails}`).not.toMatch(/brakeFlapSideLoadLbf|brakeStrapThickIn/);
    const hi = verifyChecklist(buildModel({ ...p, brakeFlapSideLoadLbf: 20 }), { ...p, brakeFlapSideLoadLbf: 20 }).find((q) => q.id === 'brake-strap')!;
    expect(hi.whatToDo).toContain('about 20 lb');
  });
});

describe('verify items are written for the shop (Eric 2026-10-12)', () => {
  it('a short title, a how-to-check list with sub-bullets, pass criteria as short lines, and no param keys anywhere', () => {
    const keys = Object.keys(PARAM_DEFS);
    for (const c of list) {
      expect(c.title.length, c.id).toBeLessThanOrEqual(70);
      expect(c.how.length, c.id).toBeGreaterThanOrEqual(1);
      expect(c.passList.length, c.id).toBeGreaterThanOrEqual(1);
      expect(c.pass, c.id).toBe(c.passList.join(' '));
      const text = [c.title, ...c.how.flatMap((q) => [q.text, ...(q.sub ?? []).map((x) => x.text)]), ...c.passList, c.ifFails].join(' ');
      for (const k of keys) expect(text, `${c.id}: ${k}`).not.toMatch(new RegExp(`\\b${k}\\b`));
      expect(text, c.id).not.toMatch(/\.ts\b/);
    }
  });
});

describe('readability round 2: no IDs, no param keys, no decimal lengths', () => {
  const text = (c: (typeof list)[number]): string => [c.title, ...c.how.flatMap((q) => [q.text, ...(q.sub ?? []).map((x) => x.text)]), ...c.passList, c.ifFails].join('\n');
  it('prints no D-number, no Q-number and no measured length as a decimal', () => {
    for (const c of list) {
      expect(text(c), c.id).not.toMatch(/\b[DQ]-\d+/);
      // a length is "<number>"" or "<number> in": none is a decimal (a tube wall in thousandths and the 0.2 lb filament are not in the default design)
      expect(text(c), c.id).not.toMatch(/\d\.\d+\s?("|in\b|mm\b)/);
    }
  });
  it('names the guarded design values by their parameters-panel label', () => {
    for (const c of list) for (const k of c.paramKeys) expect(paramLabels([k])[0], k).toBe(PARAM_DEFS[k as keyof typeof PARAM_DEFS].label);
    expect(paramLabels(['bumpWheelRateLbIn'])).not.toContain('bumpWheelRateLbIn');
  });
  it('the leftover-values check lists lengths as fractions and does not point at Q-1', () => {
    const other = list.find((c) => c.id === 'other-params')!;
    expect(text(other)).toMatch(/60-1\/2 in/);
  });
});

describe('D-76: the bow rib check', () => {
  it('asks for a booted rider in the bare hull before the ribs go in, names the chain crossmember fallback and the parameters-panel label', () => {
    const c = list.find((q) => q.id === 'bow-rib-clearance')!;
    expect(c.when).toBe('at assembly');
    expect(c.whatToDo).toMatch(/no side ribs cut or fitted yet/);
    expect(c.paramKeys).toEqual(['sideRibFrontXIn']);
    expect(c.whatToDo).toMatch(/winter boots/);
    expect(c.whatToDo).toMatch(/7-7\/8" from the center line/);
    expect(c.whatToDo).toMatch(/chain crossmember/);
    expect((c.whatToDo + c.ifFails).split(`"${PARAM_DEFS.sideRibFrontXIn.label}"`).join('')).not.toMatch(/joist/i); // the panel label (params.ts) is the only place left that says joist
    expect(c.whatToDo).toContain(`"${PARAM_DEFS.sideRibFrontXIn.label}"`);
    expect(c.whatToDo).toMatch(/steering-chain anchor eye bolt/);
    expect(c.whatToDo).not.toContain('sideRibFrontXIn');
    expect(c.partIds).toEqual(expect.arrayContaining(['side-rib-L3', 'side-rib-knee-R3']));
  });
});
