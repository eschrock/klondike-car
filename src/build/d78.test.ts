/**
 * D-78: the build outputs for removable brake knees (bolts, ratchet and wrench). In removable mode the knee is fitted dry; the assembly has a step that takes the knees off and puts them
 * back (REMOVAL and REFIT); the BOM carries the tool pouch and four spare lock nuts; a verify item checks the refit. The default outputs are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { KNEE_MOUNT, WEATHER_SPEC, defaultParams, type Params } from '../params';
import { bom, type BomLine } from './bom';
import { assemblySteps, flattenInstr } from './assembly';
import { verifyChecklist } from './verify';
import { BuildData } from './package';

const make = (spec: number, knee: number): Params => ({ ...defaultParams(), weatherSpec: spec, kneeMount: knee }) as Params;
const lines = (p: Params): BomLine[] => bom(buildModel(p), p).sections.flatMap((s) => s.lines);
const stepsOf = (p: Params) => assemblySteps(buildModel(p), p);
const textOf = (steps: ReturnType<typeof stepsOf>) => steps.map((s) => [s.title, s.goal, ...s.instructions, ...s.checks].join('\n')).join('\n');

describe.each([['Standard', WEATHER_SPEC.standard], ['Extreme', WEATHER_SPEC.extreme]])('D-78 %s spec', (_n, spec) => {
  const fixed = make(spec, KNEE_MOUNT.fixed), rm = make(spec, KNEE_MOUNT.removable);
  const sF = stepsOf(fixed), sR = stepsOf(rm);

  it('removable mode adds one step, at the end: take the knees off and put them back, with REMOVAL and REFIT', () => {
    expect(sF.some((s) => s.id === 'brake-knee-off')).toBe(false);
    expect(sR.length).toBe(sF.length + 1);
    const step = sR.find((s) => s.id === 'brake-knee-off')!;
    expect(step.title).toBe('Take the brake knees off and put them back');
    const t = step.instructions.join('\n');
    expect(t).toMatch(/REMOVAL/);
    expect(t).toMatch(/REFIT/);
    expect(t).toMatch(/Hold each nut on the 2" × 2-1\/2" backing plate with the wrench/);
    expect(t).toMatch(/Back each of the 4 bolts out with the ratchet and the 9\/16" socket/);
    expect(t).toMatch(/Lift the knee off the rail with the flap still on it, as one piece/);
    expect(t).toMatch(/Thread the bolts, washers and nuts back into the knee loosely, so none is lost/);
    expect(t).toMatch(/unclip the chock cord/);
    expect(step.goal).toMatch(/About 3 minutes a side/);
    expect(t).toMatch(/dry/);
    expect(t).toMatch(/firm/);
    expect(t).toMatch(/after the first outing/);
    expect(t).toMatch(/Replace the lock nuts after about five removals/);
    expect(t).toMatch(/spares ride in the tool pouch/);
    expect(t).toMatch(/Nothing then stands out beside the tires/);
    // the knees are linked in the step so the 3D model shows them
    expect(step.items.some((i) => (i.parts ?? []).includes('brake-knee-L'))).toBe(true);
    expect(step.tools).toEqual(['3/8" drive ratchet', '9/16" deep socket', '9/16" combination wrench']);
  });

  it('the knee step seals the faces and fits the knee dry: no glue against the rail', () => {
    const knees = sR.find((s) => s.id === 'brake-knees')!;
    const t = knees.instructions.join('\n');
    expect(knees.title).toMatch(/sealed and bolted on dry/);
    expect(t).toMatch(/Seal the two faces that meet/);
    expect(t).toMatch(/inboard face of the leg/);
    expect(t).toMatch(/fit it dry/);
    expect(t).not.toMatch(/Glue on the leg/);
    // the other steps never tell the shop to epoxy the knee against the rail
    expect(textOf(sR)).not.toMatch(/epoxy[^.\n]*\b(knee|leg)\b[^.\n]*\bagainst the rail|glue[^.\n]*\bleg\b[^.\n]*\bagainst the rail/i);
    expect(textOf(sR)).not.toMatch(/leg against the rail and chine outer face; clamp/);
  });

  it('the default text is unchanged: the knees are glued, there is no removal step and no ratchet', () => {
    const knees = sF.find((s) => s.id === 'brake-knees')!;
    expect(knees.title).toBe('Brake knees (and backers), glued and bolted while the hull is inverted');
    expect(knees.instructions.join('\n')).toMatch(/Glue on the leg against the rail and chine outer face/);
    expect(textOf(sF)).not.toMatch(/ratchet|REMOVAL|REFIT|tool pouch/);
  });

  it('the shop text names no internal ids or param names, and the box text carries the tool pouch', () => {
    const t = textOf(sR);
    expect(t).not.toMatch(/\bD-\d+\b/);
    expect(t).not.toMatch(/kneeMount|toolPouch|brake-knee-[LR]\b(?!\})/);
    const fit = sR.find((s) => s.id === 'final-fit')!.instructions.join('\n');
    expect(fit).toMatch(/Put the tool pouch in the box \(9" × 3" × 2": ratchet, socket and wrench\) with the spare lock nuts/);
    expect(sF.find((s) => s.id === 'final-fit')!.instructions.join('\n')).not.toMatch(/tool pouch/);
  });

  it('every step still renders (part tokens resolve) and the step list stays in order', () => {
    const parts = buildModel(rm);
    for (const s of sR) expect(flattenInstr(s.items, parts).join('\n'), s.id).not.toMatch(/\{\{/);
    for (let i = 1; i < sR.length; i++) expect(sR[i].modelStep).toBeGreaterThanOrEqual(sR[i - 1].modelStep);
  });

  it('the BOM adds the tool pouch (an estimate, a tool) and four spare lock nuts; the default does not', () => {
    const lf = lines(fixed), lr = lines(rm);
    expect(lf.some((l) => l.key === 'tool-pouch')).toBe(false);
    const pouch = lr.find((l) => l.key === 'tool-pouch')!;
    expect(pouch.basis).toBe('estimate');
    expect(pouch.description).toMatch(/^TOOL: .*ratchet.*9\/16" deep socket.*9\/16" combination wrench/);
    expect(pouch.notes).toMatch(/not part of the sled and not in its weight/);
    expect(pouch.notes).toMatch(/may already own/);
    const nut = (ls: BomLine[]) => ls.find((l) => /nylon-insert lock nut 3\/8-16/.test(l.key))!;
    expect(nut(lr).key).toMatch(spec === WEATHER_SPEC.standard ? /^18-8/ : /^316/);
    expect(spec === WEATHER_SPEC.standard ? true : nut(lr).qty - nut(lf).qty).toBe(spec === WEATHER_SPEC.standard ? true : 4);
    expect(bom(buildModel(rm), rm).totalUsd).toBeGreaterThan(bom(buildModel(fixed), fixed).totalUsd + 29);
    expect(bom(buildModel(rm), rm).totalUsd).toBeLessThan(bom(buildModel(fixed), fixed).totalUsd + 33);
    expect(bom(buildModel(rm), rm).unpriced).toEqual([]);
  });

  it('the verify list gains the refit check (flat seat, bolts after the first outing, chock cord eye, wobble); the default list does not', () => {
    const vf = verifyChecklist(buildModel(fixed), fixed), vr = verifyChecklist(buildModel(rm), rm);
    expect(vf.some((c) => c.id === 'brake-knee-refit')).toBe(false);
    expect(vr.length).toBe(vf.length + 1);
    const c = vr.find((q) => q.id === 'brake-knee-refit')!;
    const t = `${c.whatToDo} ${c.pass}`;
    expect(t).toMatch(/flat on the rail and on the chine band, with no gap/);
    expect(t).toMatch(/firm after the first outing/);
    expect(t).toMatch(/chock cord/);
    expect(t).toMatch(/wobble/);
    expect(c.partIds).toEqual(expect.arrayContaining(['brake-knee-L', 'brake-knee-R']));
    expect(vr.map((q) => q.n)).toEqual(vr.map((_q, i) => i + 1));
  });

  it('the cut list, oak plan and part drawings are the same (the knee is the same part)', () => {
    const a = new BuildData(buildModel(fixed), fixed), b = new BuildData(buildModel(rm), rm);
    expect(JSON.stringify(b.cutList)).toBe(JSON.stringify(a.cutList));
    expect(JSON.stringify(b.oak)).toBe(JSON.stringify(a.oak));
  });
});

describe('D-78 finishing and the build book', () => {
  it('the removable knee is not in a glue joint to the rail in the Standard glue count (two fewer joints), and the book carries the new step', () => {
    const f = new BuildData(buildModel(make(WEATHER_SPEC.standard, 0)), make(WEATHER_SPEC.standard, 0));
    const r = new BuildData(buildModel(make(WEATHER_SPEC.standard, 1)), make(WEATHER_SPEC.standard, 1));
    expect(r.finishing.glue.titebondJoints).toBe(f.finishing.glue.titebondJoints - 2);
    const book = r.files.find((x) => x.name === 'build-book.html')!.data as string;
    expect(book).toContain('Take the brake knees off and put them back');
    expect((f.files.find((x) => x.name === 'build-book.html')!.data as string)).not.toContain('Take the brake knees off and put them back');
  });
});
