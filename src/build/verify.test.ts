import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { KNEE_MOUNT, defaultParams, PARAM_DEFS } from '../params';
import { PRE_D72 } from '../test-fixtures';
import { paramLabels, unusedVerifyKeys, verifyChecklist, verifyGroups, verifyParamKeys, type VerifyWhen } from './verify';

const p = defaultParams();
const parts = buildModel(p);
const list = verifyChecklist(parts, p);
const WHEN: VerifyWhen[] = ['before ordering', 'before cutting', 'at assembly'];

describe('verify checklist (D-100: only the fits that change a purchase or a cut)', () => {
  it('numbers the checks in the order they are shown: before ordering, then before cutting, then at assembly', () => {
    expect(list.map((c) => c.id)).toEqual([
      'wheel', 'axle-rod', 'strip-bend', // before ordering
      'lamp-clip', 'other-params', // before cutting
      'brake-knee', 'bow-rib-clearance', 'grab-reach', // at assembly, in build order
    ]);
    expect(list.map((c) => c.n)).toEqual(list.map((_, i) => i + 1));
    const whenIdx = list.map((c) => WHEN.indexOf(c.when));
    expect([...whenIdx].sort((x, y) => x - y)).toEqual(whenIdx);
  });

  it('the intro lines of the step count the checks that are really there, one line per group', () => {
    const g = verifyGroups(list);
    expect(g.map((q) => q.when)).toEqual(WHEN);
    expect(g.map((q) => q.titles.length)).toEqual(WHEN.map((w) => list.filter((c) => c.when === w).length));
    expect(g[0].text).toContain(`do these ${g[0].titles.length} checks`);
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

  it('covers every param whose status is verify, and only those: the wheel bore and hub, the bow-post station and the truck bed', () => {
    const verify = verifyParamKeys().filter((k) => !unusedVerifyKeys(p).includes(k));
    expect(verify.filter((k) => !k.startsWith('truck')).sort()).toEqual(['hubLengthIn', 'sideRibFrontXIn', 'wheelBoreIn']);
    const covered = new Set(list.flatMap((c) => c.paramKeys));
    expect(verify.filter((k) => !covered.has(k))).toEqual([]);
    for (const k of covered) expect(PARAM_DEFS[k as keyof typeof PARAM_DEFS]?.status, k).toBe('verify');
    // vendor ratings and material strengths are assumptions with margin, not things to look up
    for (const k of ['bumpWheelRateLbIn', 'axleYieldPsi', 'steerEyeWllLb', 'bridleRopeBreakLbf', 'whiteOakPlyMoePsi', 'brakeChockMu'] as const) expect(PARAM_DEFS[k].status, k).toBe('assumed');
  });

  it('the truck values are their own check, as fractions', () => {
    const t = list.find((c) => c.id === 'other-params')!;
    expect(t.title).toBe('Truck bed: measure yours');
    expect(t.whatToDo).toMatch(/60-1\/2 in/);
    expect(t.paramKeys.every((k) => k.startsWith('truck'))).toBe(true);
  });

  it('the wheel check is one wheel: the bore on the axle and the hub length', () => {
    const w = list.find((c) => c.id === 'wheel')!;
    expect(w.when).toBe('before ordering');
    expect(w.whatToDo).toMatch(/Get ONE wheel/);
    expect(w.pass).toContain('5/8"');
    expect(w.pass).toContain('2-1/4"');
    expect(w.paramKeys.sort()).toEqual(['hubLengthIn', 'wheelBoreIn']);
    expect(w.partIds).toEqual(['wheel-RL', 'wheel-RR', 'wheel-FL', 'wheel-FR']);
  });

  it('the axle check names the grade to buy in plain words; the tube item appears only with a tube', () => {
    const rod = list.find((c) => c.id === 'axle-rod')!;
    expect(rod.title).toMatch(/1045 or cold-drawn.*not hot-rolled A36/);
    expect(rod.pass).toMatch(/Hot-rolled A36 is too weak/);
    expect(rod.partIds.length).toBe(3);
    expect(list.some((c) => c.id === 'axle-tube')).toBe(false);
    const tube = verifyChecklist(buildModel({ ...p, ...PRE_D72 }), { ...p, ...PRE_D72 }).find((c) => c.id === 'axle-tube')!;
    expect(tube.title).toMatch(/DOM/);
    expect(tube.pass).toMatch(/Welded \(ERW\) tube is too weak/);
  });

  it('the strip bend test comes before ordering and uses the planned spares', () => {
    const bend = list.find((c) => c.id === 'strip-bend')!;
    expect(bend.when).toBe('before ordering');
    expect(bend.whatToDo).toMatch(/2 vs 3 plies/);
    expect(bend.whatToDo).toMatch(/FIRST board of each strip pool/);
    expect(bend.whatToDo).toMatch(/planned SPARE strips/);
    expect(bend.whatToDo).toMatch(/\d+ spare strips?\)/);
  });

  it('the lamp clip check measures the real lights before printing, with the hand-hold size from the model', () => {
    const c = list.find((q) => q.id === 'lamp-clip')!;
    expect(c.when).toBe('before cutting');
    expect(c.whatToDo).toMatch(/Measure the real lights before anything is printed/);
    expect(c.whatToDo).toMatch(/Giant Recon 600/);
    expect(c.whatToDo).toContain('4-1/2" × 1-1/4"'); // hand-hold = clip + 1/50" a side
  });

  it('the first brake knee is fitted before the other is cut; glued knees need the full test first', () => {
    const knee = list.find((c) => c.id === 'brake-knee')!;
    expect(knee.when).toBe('at assembly');
    expect(knee.whatToDo).toMatch(/shape ONE knee first/);
    expect(knee.whatToDo).toMatch(/try its pocket with a scrap block/i);
    expect(knee.whatToDo).toMatch(/full test comes at the "Brake flaps" step/);
    expect(knee.partIds).toEqual(expect.arrayContaining(['brake-knee-L', 'brake-strap-L', 'brake-flap-L']));
    const fx = { ...p, kneeMount: KNEE_MOUNT.fixed };
    expect(verifyChecklist(buildModel(fx), fx).find((c) => c.id === 'brake-knee')!.whatToDo).toMatch(/full test must come first/);
  });

  it('D-76: the bow rib check asks for a booted rider in the bare hull, with the chain crossmember fallback by its panel label', () => {
    const c = list.find((q) => q.id === 'bow-rib-clearance')!;
    expect(c.when).toBe('at assembly');
    expect(c.whatToDo).toMatch(/no side ribs cut or fitted yet/);
    expect(c.whatToDo).toMatch(/winter boots/);
    expect(c.whatToDo).toMatch(/7-7\/8" from the center line/);
    expect(c.whatToDo).toMatch(/chain crossmember/);
    expect(c.whatToDo).toContain(`"${PARAM_DEFS.sideRibFrontXIn.label}"`);
    expect(c.paramKeys).toEqual(['sideRibFrontXIn']);
    expect(c.partIds).toEqual(expect.arrayContaining(['side-rib-L3', 'side-rib-knee-R3']));
  });

  it('D-84: the grab-board reach is tried with real scouts before the boards are cut', () => {
    const c = list.find((q) => q.id === 'grab-reach')!;
    expect(c.when).toBe('at assembly');
    expect(c.whatToDo).toMatch(/smallest and the biggest scout/);
    expect(c.partIds).toEqual(['seat-grip-L', 'seat-grip-R']);
  });

  it('lists only part ids that are in the built model', () => {
    const have = new Set(parts.map((x) => x.id));
    for (const c of list) for (const id of c.partIds) expect(have.has(id), `${c.id}: ${id}`).toBe(true);
  });
});

describe('verify items are written for the shop', () => {
  const text = (c: (typeof list)[number]): string => [c.title, ...c.how.flatMap((q) => [q.text, ...(q.sub ?? []).map((x) => x.text)]), ...c.passList, c.ifFails].join('\n');
  it('a short title, a how-to list, pass lines, and no param keys, file names, D- or Q-numbers or decimal lengths', () => {
    const keys = Object.keys(PARAM_DEFS);
    for (const c of list) {
      expect(c.title.length, c.id).toBeLessThanOrEqual(70);
      expect(c.how.length, c.id).toBeGreaterThanOrEqual(1);
      expect(c.passList.length, c.id).toBeGreaterThanOrEqual(1);
      expect(c.pass, c.id).toBe(c.passList.join(' '));
      for (const k of keys) expect(text(c), `${c.id}: ${k}`).not.toMatch(new RegExp(`\\b${k}\\b`));
      expect(text(c), c.id).not.toMatch(/\.ts\b/);
      expect(text(c), c.id).not.toMatch(/\b[DQ]-\d+/);
      expect(text(c), c.id).not.toMatch(/\d\.\d+\s?("|in\b|mm\b)/);
    }
  });
  it('names the guarded design values by their parameters-panel label', () => {
    for (const c of list) for (const k of c.paramKeys) expect(paramLabels([k])[0], k).toBe(PARAM_DEFS[k as keyof typeof PARAM_DEFS].label);
  });
});
