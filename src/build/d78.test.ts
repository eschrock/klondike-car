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
    expect(t).toMatch(/Work on a hard floor, not in snow/);
    expect(t).toMatch(/reach in under the deck, behind the rail, between the two crossmembers just ahead of the rear wheel/);
    expect(t).toMatch(/Angle the wrench handle down/);
    expect(t).toMatch(/2" × 2-1\/2" backing plate/);
    expect(t).toMatch(/Hold each nut with the wrench and back the bolt out with the ratchet and the 9\/16" socket/);
    expect(t).toMatch(/Lift the knee off the rail with the flap still on it, as one piece/);
    expect(t).toMatch(/Thread the bolts, washers and nuts back into the knee loosely, so none is lost/);
    expect(step.goal).toMatch(/About 5 minutes a side; the first time takes longer/);
    expect(t).toMatch(/Hang the knee on one bolt first/);
    expect(t).toMatch(/one person/);
    expect(t).toMatch(/snug, then a quarter turn; more crushes the washers and the oak/);
    expect(t).toMatch(/anti-seize/);
    expect(t).toMatch(/dry/);
    expect(t).toMatch(/after the first outing/);
    expect(t).toMatch(/Replace the lock nuts after about five removals/);
    expect(t).toMatch(/Nothing then stands out beside the tires/);
    // the chock stays tied: no clip wording, and the chocks do not go to the box in this step
    expect(textOf(sR)).not.toMatch(/unclip|clip the chock|clip it back|chock cord back on/i);
    expect(t).toMatch(/Leave the chock tied/);
    expect(t).not.toMatch(/chocks go in the storage box/);
    // no app words in the shop text of the removable steps
    for (const id of ['brake-knee-off', 'brake-knees', 'gear-fit', 'finish-under', 'final-fit']) {
      expect(sR.find((x) => x.id === id)!.instructions.join('\n'), id).not.toMatch(/viewer|Transport mode|Brakes off/);
    }
    expect(step.items.some((i) => (i.parts ?? []).includes('brake-knee-L'))).toBe(true);
    expect(step.tools).toEqual(['3/8" drive ratchet', '9/16" socket', '9/16" combination wrench']);
    expect(t).not.toMatch(/deep socket/);
  });

  it('the build order: knees fitted dry and drilled early, off after the wheel dry fit, finished on the bench, bolted on at the hang step', () => {
    const at = (id: string) => sR.findIndex((x) => x.id === id);
    const txt = (id: string) => sR[at(id)].instructions.join('\n');
    const knees = sR.find((s) => s.id === 'brake-knees')!;
    const t = knees.instructions.join('\n');
    expect(knees.title).toBe('Brake knees, fitted dry while the hull is inverted');
    expect(knees.tools).toContain('3/8" drive ratchet and 9/16" socket');
    expect(t).toMatch(/easiest to reach now, while the hull is inverted/);
    // one way to drill the knee: on the drill press from its layout (a chuck cannot reach the top row through the rail), offered up with all four bolts, never the rail's holes opened
    expect(t).toMatch(/drill each knee leg on the drill press, from its layout/);
    expect(t).not.toMatch(/transfer drill|marked from the rail drawing/);
    expect(t).toMatch(/Offer the knee up to the rail with all 4 bolts through it: its rear face [\d\-/]+" from the rail's finished rear end/);
    expect(t).toMatch(/If a bolt binds, open that knee hole a hair with the drill\. Never open the rail's holes/);
    expect(t).toMatch(/Hold each nut with the wrench from inside the frame/);
    expect(t).toMatch(/seal the bolt holes/);
    expect(t.indexOf('drill each knee leg on the drill press')).toBeLessThan(t.indexOf('seal the bolt holes'));
    expect(t).toMatch(/No glue on the leg/);
    expect(t).not.toMatch(/Seal the two faces/);
    expect(at('gear-fit')).toBeGreaterThan(at('brake-knees'));
    expect(txt('gear-fit')).toMatch(/Take the brake knees off too, now that the margin is measured/);
    expect(txt('finish-under')).toMatch(/rail and chine face where each knee will sit/);
    expect(txt('finish-under')).not.toMatch(/Brush epoxy into the knee bolt holes/);
    expect(txt('finish')).toMatch(/the brake knees with their flaps and chocks/);
    expect(txt('finish')).toMatch(/No finish may run onto the rail/);
    expect(sR.find((x) => x.id === 'finish')!.items.some((i) => (i.parts ?? []).includes('brake-knee-L'))).toBe(true);
    expect(txt('hang')).toMatch(/Brake knees, from the bench/);
    expect(txt('hang')).toMatch(/Hang the knee on one bolt first/);
    expect(txt('frame')).toMatch(/Bed each plate in thickened epoxy in its recess/);
    expect(txt('frame')).toMatch(/sand its back and edges with 80 grit, wipe it with acetone, and bed it within the hour/);
    expect(txt('frame')).toMatch(/Pass 4 waxed 3\/8" bolts through the rail, backer and plate holes from the outside, each with a waxed nut on the plate and a waxed caul block/);
    expect(txt('frame')).toMatch(/Snug the nuts just enough to seat the plate flush/);
    expect(txt('hang')).toMatch(/Screw each strap back on its knee, 4 screws with a drop of epoxy in each pilot/);
    expect(txt('hang')).toMatch(/put a bottom rear bolt, with its washer, through the knee, the rail and the backer/);
    expect(txt('finish')).toMatch(/Take the strap off each knee/);
    expect(sF.find((x) => x.id === 'frame')!.instructions.join('\n')).not.toMatch(/Bed each plate/);
    expect(textOf(sR)).not.toMatch(/epoxy[^.\n]*\b(knee|leg)\b[^.\n]*\bagainst the rail|glue[^.\n]*\bleg\b[^.\n]*\bagainst the rail/i);
    expect(textOf(sR)).not.toMatch(/\bfirm\b|design clamp/);
  });

  it('the default text is unchanged: the knees are glued, there is no removal step and no ratchet', () => {
    const knees = sF.find((s) => s.id === 'brake-knees')!;
    expect(knees.title).toBe('Brake knees (and backers), glued and bolted while the hull is inverted');
    expect(knees.instructions.join('\n')).toMatch(/Glue on the leg against the rail and chine outer face/);
    expect(textOf(sF)).not.toMatch(/ratchet|REMOVAL|REFIT|tool pouch|anti-seize/);
  });

  it('the shop text names no internal ids or param names, and the box text carries the tool pouch for cargo use', () => {
    const t = textOf(sR);
    expect(t).not.toMatch(/\bD-\d+\b/);
    expect(t).not.toMatch(/kneeMount|toolPouch|kneeBoltTighten|brake-knee-[LR]\b(?!\})/);
    const fit = sR.find((s) => s.id === 'final-fit')!.instructions.join('\n');
    expect(fit).toMatch(/Keep the tool pouch \(9" × 3" × 2": ratchet, socket and wrench\) with the spare lock nuts and the anti-seize. It rides in the box for cargo use/);
    expect(sF.find((s) => s.id === 'final-fit')!.instructions.join('\n')).not.toMatch(/tool pouch/);
  });

  it('every step still renders (part tokens resolve) and the step list stays in order', () => {
    const parts = buildModel(rm);
    for (const s of sR) expect(flattenInstr(s.items, parts).join('\n'), s.id).not.toMatch(/\{\{/);
    for (let i = 1; i < sR.length; i++) expect(sR[i].modelStep).toBeGreaterThanOrEqual(sR[i - 1].modelStep);
  });

  it('the BOM adds the tool pouch (an estimate, a TOOL in Purchased parts), anti-seize and spare lock nuts; the default does not', () => {
    const bf = bom(buildModel(fixed), fixed), br = bom(buildModel(rm), rm);
    const lf = bf.sections.flatMap((s) => s.lines), lr = br.sections.flatMap((s) => s.lines);
    expect(lf.some((l) => l.key === 'tool-pouch' || l.key === 'anti-seize')).toBe(false);
    const pouch = lr.find((l) => l.key === 'tool-pouch')!;
    expect(br.sections.find((s) => s.lines.includes(pouch))!.id).toBe('purchased');
    expect(pouch.basis).toBe('estimate');
    expect(pouch.description).toMatch(/^TOOL: .*ratchet.*9\/16" socket.*9\/16" combination wrench/);
    expect(pouch.description).not.toMatch(/deep/);
    expect(pouch.notes).toMatch(/not part of the sled and not in its weight/);
    expect(pouch.notes).toMatch(/may already own/);
    const seize = lr.find((l) => l.key === 'anti-seize')!;
    expect(seize.basis).toBe('quoted'); // D-79 research: the Permatex 1 oz tube, $3.97 at Walmart (via search)
    expect(seize.unitUsd).toBe(3.97);
    const nut = (ls: BomLine[]) => ls.find((l) => /nylon-insert lock nut 3\/8-16/.test(l.key))!;
    expect(nut(lr).key).toMatch(spec === WEATHER_SPEC.standard ? /^18-8/ : /^316/);
    // eight spares on top of the 26 the build uses: the stale "26 by the piece" note is restated
    expect(nut(lr).needed ?? nut(lr).qty).toBe(34);
    expect(nut(lf).needed ?? nut(lf).qty).toBe(26);
    expect(JSON.stringify(nut(lr))).not.toMatch(/26 by the piece/);
    if (spec === WEATHER_SPEC.standard) expect(JSON.stringify(nut(lr))).toMatch(/34 by the piece is 12\.24/);
    expect(br.totalUsd).toBeGreaterThan(bf.totalUsd + 33); // pouch $30 + anti-seize $3.97 (+ spare nuts: already inside a bag under Standard)
    expect(br.totalUsd).toBeLessThan(bf.totalUsd + 43);
    expect(br.unpriced).toEqual([]);
  });

  it('the verify list gains the refit check (flat seat, paper, plate, washers, bolts after the first outing, chock cord eye, wobble); the default list does not', () => {
    const vf = verifyChecklist(buildModel(fixed), fixed), vr = verifyChecklist(buildModel(rm), rm);
    expect(vf.some((c) => c.id === 'brake-knee-refit')).toBe(false);
    expect(vr.length).toBe(vf.length + 1);
    const c = vr.find((q) => q.id === 'brake-knee-refit')!;
    const t = `${c.whatToDo} ${c.pass}`;
    expect(t).toMatch(/flat on the rail and on the chine band/);
    expect(t).toMatch(/slip of paper/);
    expect(t).toMatch(/does not enter the joint line/);
    expect(t).toMatch(/backing plate is still in its recess/);
    expect(t).toMatch(/No washer is pressed into the oak/);
    expect(t).toMatch(/snug, then a quarter turn \(the quarter turn past snug is the spec; with an inch-pound torque wrench it reads about 35 in-lb/);
    expect(t).toMatch(/tight after the first outing/);
    expect(t).toMatch(/chock cord/);
    expect(t).not.toMatch(/clip/i);
    expect(t).not.toMatch(/\bfirm\b|design clamp/);
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
