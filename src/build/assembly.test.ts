import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { HULL_STEP, STEP } from '../model/build-utils';
import { defaultParams } from '../params';
import { PRE_D72 } from '../test-fixtures';
import type { Part } from '../model/types';
import { cutList } from './cutlist';
import { formDrawings } from './forms';
import { assemblySteps, cumulativeParts, EARLY_STEP_IDS, hasGlueJoint, isEarlyBrakePart, isHangPart, jointTally, socketScrewText, stepParts, stopBlockPilots } from './assembly';
import { flatPattern } from './flat';
import { verifyChecklist } from './verify';

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
    // Verify points at the Verify section and its checks (no source file names in the text).
    expect(steps[0].instructions.join(' ')).toMatch(/Verify section/);
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
    // The hang step installs hardware whose model steps are earlier (fitted at its own step, hung after the varnish): its modelStep is clamped up to the finish step.
    // The brake knees are glued while the hull is inverted: their step sits at 4.6 although the parts are model step 6 (EARLY_STEP_IDS, clamped down).
    const build = steps.filter((s) => s.partIds.length && s.id !== 'hang' && !EARLY_STEP_IDS.has(s.id));
    for (let i = 0; i < build.length; i++) {
      const s = build[i];
      const ms = s.partIds.map((id) => by.get(id)!.step);
      expect(Math.min(...ms), s.id).toBe(s.modelStep);
      if (i + 1 < build.length) expect(Math.max(...ms), `${s.id} before ${build[i + 1].id}`).toBeLessThanOrEqual(build[i + 1].modelStep);
    }
    const hang = steps.find((s) => s.id === 'hang')!;
    expect(hang.modelStep).toBe(STEP.finish);
    for (const id of hang.partIds) expect(by.get(id)!.step, id).toBeLessThanOrEqual(hang.modelStep);
    // The hull sub-steps appear in the HULL_STEP order.
    const at = (ms: number): number => steps.findIndex((s) => s.partIds.some((id) => by.get(id)!.step === ms));
    expect(at(STEP.frame)).toBeLessThan(at(HULL_STEP.deck) + 1);
    expect(at(HULL_STEP.deck)).toBeLessThan(at(HULL_STEP.sides));
    expect(at(HULL_STEP.sides)).toBeLessThan(at(HULL_STEP.transom));
    expect(at(HULL_STEP.transom)).toBeLessThan(at(STEP.gear));
    expect(at(STEP.gear)).toBeLessThan(at(STEP.spindles));
    expect(at(STEP.spindles)).toBeLessThan(at(STEP.seatStorage));
    const flaps = steps.findIndex((s) => s.id === 'brake-flaps');
    expect(at(STEP.seatStorage)).toBeLessThan(flaps);
    expect(flaps).toBeLessThan(at(STEP.finish));
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
    expect(idx('front-beam')).toBeLessThan(idx('gear-fit')); // fit and drill the running gear on the inverted hull ...
    expect(idx('gear-fit')).toBeLessThan(idx('finish-under')); // ... take it off, finish the underside ...
    expect(idx('finish-under')).toBeLessThan(idx('flip')); // ... and only then turn the hull over
    expect(idx('flip')).toBeLessThan(idx('tongue'));
    expect(idx('wood-fitout')).toBeLessThan(idx('finish')); // glue before the finish
    expect(idx('finish')).toBeLessThan(idx('hang')); // hardware after the varnish
    expect(idx('hang')).toBeLessThan(idx('final-fit'));
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

  it('uses 206 for every glue-up, the closing of the ends included (small batches, a second person mixing)', () => {
    const get = (id: string) => steps.find((s) => s.id === id)!;
    expect(get('frame').cure!.hardener).toBe('206');
    expect(get('frame').cure!.potMin).toEqual([20, 25]);
    expect(get('frame').cure!.clampHours).toEqual([8, 10]);
    expect(get('frame').cure!.fullHours).toBe(24);
    for (const id of ['transom', 'bulkhead']) {
      expect(get(id).cure!.hardener, id).toBe('206');
      expect(get(id).clampCure, id).toMatch(/206 slow/);
      expect(get(id).instructions.join(' '), id).toMatch(/small batch/i);
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
    const first = steps.findIndex((s) => s.id === 'rear-beam');
    const last = steps.findIndex((s) => s.id === 'finish-under');
    const gear = steps.slice(first, last + 1);
    expect(gear.map((s) => s.id)).toEqual(['rear-beam', 'front-beam', 'brake-knees', 'gear-fit', 'finish-under']);
    for (const s of gear) expect(s.view, s.id).toBe('under');
  });

  it('build instructions from the joints and the params', () => {
    const get = (id: string) => steps.find((s) => s.id === id)!;
    // Domino counts come from the joint list (9 per side to the chine band, 18 in all). D-73: the 1/4 in white oak web leaves a 0.417 in bearing land, wide enough for the 5×30 Domino (the Sipo size that exists);
    // with the 4 mm okoume (0.391 in land) the tie is the 4×20.
    expect(get('rails').instructions.join(' ')).toContain('5×30 ×32');
    expect(get('rails').instructions.join(' ')).toContain('the 18 5×30 are the chine ties');
    expect(get('lower').instructions.join(' ')).toMatch(/18 Dominos \(5×30, every 6"/);
    expect(get('lower').instructions.join(' ')).toMatch(/7\/16" bearing face/);
    const okSteps = assemblySteps(buildModel({ ...p, ...PRE_D72 }, undefined), { ...p, ...PRE_D72 });
    expect(okSteps.find((s) => s.id === 'rails')!.instructions.join(' ')).toContain('4×20 ×18');
    expect(okSteps.find((s) => s.id === 'lower')!.instructions.join(' ')).toMatch(/18 Dominos \(4×20, every 6"/);
    expect(get('dry-fit').instructions.join(' ')).toContain(`${p.deckSideClearIn}"`);
    expect(get('shaper').instructions.join(' ')).toMatch(/ONE piece from the full 4' × 8' sheet/);
    expect(get('shaper').instructions.join(' ')).not.toMatch(/scarf/i);
    expect(get('gear-fit').instructions.join(' ')).toMatch(/5\/8" bore on the 5\/8" rod/); // D-71/D-72: fractions, and the solid rod Eric chose
    expect(get('gear-fit').instructions.join(' ')).not.toMatch(/0\.63"/);
  });

  it('count a joint listed on both mating parts once', () => {
    const ids = new Set(['rail-L', 'rail-R']);
    const t = jointTally(parts, ids, 'domino', (j) => (/^5×30/.test(j.size ?? '') ? '5×30' : 'other'));
    expect(t.get('5×30')).toBe(32); // 18 chine ties + 14 rail-end and bulkhead Dominos, all 5×30 now (with the 4 mm okoume the ties were 4×20: 18, and 5×30: 14)
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

describe('build review round 1: finish after hardware (MUST-1)', () => {
  const idx = (id: string): number => steps.findIndex((s) => s.id === id);
  const get = (id: string) => steps.find((s) => s.id === id)!;
  const hardware = built.filter(isHangPart);

  it('hangs the running gear, hinges, sockets and brake kit after the varnish, each part once', () => {
    const hang = get('hang');
    expect(hang.kind).toBe('build');
    expect(hardware.length).toBeGreaterThan(40);
    for (const x of hardware) expect(hang.partIds, x.id).toContain(x.id);
    expect(hang.partIds.length).toBe(hardware.length);
    for (const id of ['wheel-RL', 'wheel-FR', 'axle-R', 'axle-FL', 'clamp-RL1', 'roll-pad-L', 'steer-eye-L', 'steer-anchor-R', 'seat-hinge-L', 'storage-hinge-R', 'handle-socket-L', 'brake-pivot-pin-L']) expect(hang.partIds, id).toContain(id);
    // Nothing of it is on the sled before the finish.
    const before = new Set(steps.slice(0, idx('finish') + 1).flatMap((s) => s.partIds));
    for (const x of hardware) expect(before.has(x.id), x.id).toBe(false);
    // The viewer is truthful: the flip shows a hull with no wheels; the end shows everything once.
    const atFlip = new Set(cumulativeParts(steps, idx('flip')));
    expect(atFlip.has('wheel-FL')).toBe(false);
    expect(atFlip.has('beam-R')).toBe(true);
    expect(new Set(cumulativeParts(steps, steps.length - 1)).size).toBe(built.length);
  });

  it('keeps the tongue, beams, kingpin, hold-downs and every wood part out of it, and the tongue is not taken off for finishing', () => {
    const hang = get('hang');
    for (const id of ['bridle-tongue', 'bridle-sleeve', 'beam-R', 'beam-F', 'kingpin', 'beam-hold-down-L', 'brake-flap-L', 'handle-bar', 'brake-knee-L']) expect(hang.partIds, id).not.toContain(id);
    for (const x of hardware) expect(['purchased', 'metal', 'printed'], x.id).toContain(x.kind);
    const fin = get('finish').instructions.join(' ');
    expect(fin).toMatch(/tongue is NOT removable \(D-65\)/);
    expect(fin).not.toMatch(/\(brake flaps, handle, signs, tongue\)/);
    expect(get('tongue').instructions.join(' ')).toMatch(/not removable \(D-65\)/);
  });

  it('fits and drills the gear, takes it off, finishes the underside before the flip, and hangs it last', () => {
    expect(get('rear-beam').instructions.join(' ')).toMatch(/FIT AND DRILL, then take off/);
    expect(get('front-beam').instructions.join(' ')).toMatch(/FIT AND DRILL, then take off/);
    const gf = get('gear-fit');
    expect(gf.kind).toBe('process');
    expect(gf.instructions.join(' ')).toMatch(/OFF and bag/);
    expect(gf.instructions.join(' ')).toMatch(/stop-block/);
    expect(get('finish-under').instructions.join(' ')).toMatch(/underside|from below/);
    expect(get('finish-under').checks.join(' ')).toMatch(/dry to handle/);
    const h = get('hang').instructions.join(' ');
    expect(h).toMatch(/varnish has cured/);
    expect(h).toMatch(/cotter pins/);
    expect(h).toMatch(/T-nuts/);
    // The hinges are fitted dry at their steps, not screwed on.
    expect(get('seat-back').instructions.join(' ')).toMatch(/FIT AND DRILL now, hang later/);
    expect(get('handle').instructions.join(' ')).toMatch(/FIT AND DRILL now/);
  });

  it('gives wrench access to the handle-socket nuts before the box closes them in', () => {
    const t = get('transom').instructions.join(' ');
    expect(t).toMatch(/T-nut/);
    expect(t).toMatch(/behind the storage box/);
    expect(idx('transom')).toBeLessThan(idx('storage-box'));
  });
});

describe('build review round 1: stain vs seal (MUST-2)', () => {
  it('seals only the dados, edges and hidden faces at assembly; the show faces are stained, then sealed', () => {
    const seal = steps.find((s) => s.id === 'seal')!.instructions.join(' ');
    expect(seal).toMatch(/ONLY the dados/);
    expect(seal).toMatch(/show faces stay bare/);
    expect(seal).toMatch(/Glue faces stay bare or are scuffed/);
    expect(seal).toMatch(/Water-based dye under epoxy is the safe route/);
    expect(seal).toMatch(/offcut tests/);
    expect(seal).not.toMatch(/all ply faces/i);
    const fin = steps.find((s) => s.id === 'finish')!.instructions.join(' ');
    expect(fin).toMatch(/stained first, then epoxy-sealed/);
  });
});

describe('build review round 1: rail end mortises (MUST-3)', () => {
  it('cuts them after the trim, with tools that work on the glued unit, from the current joints', () => {
    const rails = steps.find((s) => s.id === 'rails')!.instructions.join(' ');
    expect(rails).toMatch(/Do NOT cut the end mortises yet/);
    expect(rails).not.toMatch(/loose-tenon mortises in the rail ends/);
    const dry = steps.find((s) => s.id === 'dry-fit')!;
    const text = dry.instructions.join(' ');
    expect(text).toMatch(/flush-cut \(Japanese\) saw/);
    expect(text.indexOf('trim the frame unit')).toBeGreaterThan(-1);
    expect(text.indexOf('rail-end mortises')).toBeGreaterThan(text.indexOf('trim the frame unit'));
    expect(text).not.toMatch(/table saw or bandsaw/);
    expect(dry.tools).not.toContain('table saw or bandsaw');
    // Joint types are read from the model (D-69: Dominos into the bulkhead).
    const rail = parts.find((x) => x.id === 'rail-L')!;
    const jb = rail.joints!.find((j) => j.to === 'bow-bulkhead')!;
    const jt = rail.joints!.find((j) => j.to === 'transom-rear')!;
    if (jb.type === 'domino') expect(text).toContain(`bulkhead end ${/(\d+)\s*×\s*(\d+)/.exec(jb.size!)!.slice(1, 3).join('×')} Domino`);
    if (jt.type === 'mortise-tenon') expect(text).toContain(`transom end ${jt.size!.split(' (')[0]}`);
  });
});

describe('build review round 1: brake backers (MUST-4)', () => {
  const retarget = (step: number): Part[] => parts.map((x) => (/^brake-backer-[LR]$/.test(x.id) ? { ...x, step } : x));
  const host = (ps: Part[]): string => assemblySteps(ps, p).find((s) => s.partIds.includes('brake-backer-L'))!.id;

  it('places the backers in whatever step the model says', () => {
    expect(host(parts)).toBe(parts.find((x) => x.id === 'brake-backer-L')!.step <= HULL_STEP.deck ? 'frame' : 'brake-knees');
    expect(host(retarget(STEP.frame))).toBe('frame');
    expect(host(retarget(STEP.brake))).toBe('brake-knees');
  });

  it('glues them in the frame glue-up and drills the knee-bolt holes there, when the model puts them in the frame step', () => {
    const s2 = assemblySteps(retarget(STEP.frame), p);
    const frame = s2.find((s) => s.id === 'frame')!.instructions.join(' ');
    expect(frame).toMatch(/Brake backers/);
    expect(frame).toMatch(/knee-bolt holes/);
    expect(s2.find((s) => s.id === 'brake-knees')!.instructions.join(' ')).toMatch(/went in with the frame glue-up/);
    const s3 = assemblySteps(retarget(STEP.brake), p);
    expect(s3.find((s) => s.id === 'frame')!.instructions.join(' ')).not.toMatch(/Brake backers/);
    expect(s3.find((s) => s.id === 'brake-knees')!.instructions.join(' ')).toMatch(/Backers \(0\.75" oak/);
  });
});

describe('build review round 1: chine Domino tie (MUST-5)', () => {
  it('mortises the bottom edge of each side at the end of the side assembly, before the dry fit', () => {
    const idx = (id: string): number => steps.findIndex((s) => s.id === id);
    const outer = steps[idx('sides-outer')];
    const t = outer.instructions.join(' ');
    expect(t).toMatch(/Chine ties/);
    expect(t).toMatch(/9 per side, 5×30 Dominos/);
    expect(t).toMatch(/\(0\.417"\)/); // outer band 0.2075 + web 0.21
    expect(t).toMatch(/through the outer band and the web edge/);
    expect(t).toMatch(/glue line/);
    expect(outer.instructions[outer.instructions.length - 1]).toMatch(/Leave all bands and webs long/);
    expect(idx('sides-outer')).toBeLessThan(idx('dry-fit'));
    expect(outer.tools).toContain('Domino');
  });
});

describe('build review round 1: forms and resaw numbers come from their sources (MUST-6, MUST-9)', () => {
  const forms = formDrawings(parts, p);
  const dim = (id: string, key: string): number => forms.find((d) => d.id === id)!.dims.find((q) => q.key === key)!.valueIn;
  const shaper = steps.find((s) => s.id === 'shaper')!.instructions.join(' ');
  const every = steps.flatMap((s) => [s.title, ...s.instructions, ...s.checks, ...s.tools]).join('\n');

  it('quotes the S-ramp and the rail form from forms.ts', () => {
    expect(shaper).toContain(`rise ${+dim('side-form', 'ramp-rise').toFixed(2)}"`);
    expect(shaper).toContain(`${+dim('side-form', 'ramp-length').toFixed(1)}" long from the S start`);
    expect(shaper).toContain(`${dim('side-form', 'ramp-ribs')} ribs`);
    expect(shaper).toContain(`${+dim('rail-form', 'form-length').toFixed(1)}" long`);
  });

  it('stacks the rail form at least as high as the rail is deep', () => {
    const depth = parts.find((x) => x.id === 'rail-L')!.stock!.w;
    const m = /Stack (\d+) layers of 0\.75" MDF \(([\d.]+)"/.exec(shaper)!;
    expect(m).toBeTruthy();
    expect(+m[1] * 0.75).toBeGreaterThanOrEqual(depth - 1e-9);
    expect(+m[2]).toBeGreaterThanOrEqual(depth - 1e-9);
  });

  it('uses one term: S-ramp, never "S-form", and no stale ramp size', () => {
    expect(every).not.toMatch(/S-form/);
    expect(every).not.toMatch(/1\.25" high/);
    expect(every).toMatch(/S-ramp/);
  });

  it('writes the resaw text from the cut list pools, with its spare strips and no hardcoded 4/4', () => {
    const pools = cutList(parts, p).resaw;
    const mill = steps.find((s) => s.id === 'mill')!.instructions.join(' ');
    expect(pools.length).toBeGreaterThanOrEqual(2);
    for (const pool of pools) {
      expect(mill).toContain(`resawn from ${pool.board}`);
      expect(mill).toContain(`Buy ${pool.boards} × ${pool.board} × ${pool.boardWidthIn}"`);
      expect(mill).toContain(`it yields ${pool.stripSlots} strips for the ${pool.strips} needed`);
      expect(mill).toContain(pool.spares > 0 ? `${pool.spares} spare strip` : 'no spare strip');
    }
    // Nothing is typed in: a board thickness appears only when a pool chose it.
    for (const nominal of ['4/4', '5/4', '6/4', '8/4']) if (!pools.some((q) => q.board === nominal)) expect(mill, nominal).not.toContain(`from ${nominal}`);
    expect(mill).not.toMatch(/25 % spares/);
  });

  it('schedules the face laminations in the milling step, before anything is notched, bored or slotted (D-70)', () => {
    const mill = steps.find((s) => s.id === 'mill')!.instructions.join(' ');
    expect(mill).toMatch(/Face-laminate the thick parts BEFORE anything is notched, bored or slotted/);
    for (const id of ['beam-F', 'beam-R', 'brake-knee-L', 'brake-chock-L']) expect(mill, id).toContain(id);
    expect(mill).toContain('3 \u00d7 3/4" from 4/4');
    expect(mill).toMatch(/mill the glued block to its final size/);
    expect(mill.indexOf('Face-laminate')).toBeLessThan(mill.indexOf('Edge-glue the wide panels FIRST'));
    expect(steps.find((s) => s.id === 'mill')!.checks.join(' ')).toMatch(/Laminated blocks cured/);
    const mi = steps.findIndex((s) => s.id === 'mill');
    for (const later of ['brake-knees']) expect(steps.findIndex((s) => s.id === later), later).toBeGreaterThan(mi);
  });

  it('schedules the edge-glued panels in the milling step', () => {
    const mill = steps.find((s) => s.id === 'mill')!.instructions.join(' ');
    expect(mill).toMatch(/Edge-glue the wide panels FIRST/);
    expect(mill).toContain('transom-rear');
  });
});

describe('build review round 1: shop details', () => {
  const get = (id: string) => steps.find((s) => s.id === id)!;
  it('gives the inverted sides station cradles with the widths from the layout', () => {
    const t = get('dry-fit').instructions.join(' ');
    expect(t).toMatch(/4 MDF station cradles/);
    expect(t).toMatch(/x = [-\d.]+": [\d.]+" wide, [\d.]+" tall/);
  });
  it('tells the builder to scribe the angled joist ends in the bow taper', () => {
    expect(get('frame').instructions.join(' ')).toMatch(/meet the bent rails at up to \d+°/);
    expect(get('frame').instructions.join(' ')).toMatch(/scribe each end/);
  });
});

describe('build review round 2: brake knees before the underside finish (MUST-A)', () => {
  const idx = (id: string): number => steps.findIndex((s) => s.id === id);
  const get = (id: string) => steps.find((s) => s.id === id)!;
  const knees = get('brake-knees');

  it('glues and bolts the knees while the hull is inverted, before the underside is finished and before the flip', () => {
    expect(idx('brake-knees')).toBeGreaterThan(idx('front-beam'));
    expect(idx('brake-knees')).toBeLessThan(idx('finish-under'));
    expect(idx('brake-knees')).toBeLessThan(idx('flip'));
    expect(knees.view).toBe('under');
    const t = knees.instructions.join(' ');
    expect(t).toMatch(/epoxy will not bond to varnish/);
    expect(t).toMatch(/nylock nuts/);
    expect(t).toMatch(/hull is inverted/);
    expect(t).toMatch(/one-knee test/);
    expect(t).not.toMatch(/stay bolted on for finishing/);
    expect(t).not.toMatch(/the other three knees/);
    expect(get('finish-under').instructions.join(' ')).toMatch(/brake knees/);
    // The one-knee verify item is a "before cutting" gate: it is done in step 0, ahead of the knee step.
    expect(verifyChecklist(parts, p).find((v) => v.id === 'brake-knee')!.when).toBe('before cutting');
    expect(idx('verify')).toBeLessThan(idx('brake-knees'));
  });

  it('keeps each part in exactly one step: the knees alone, the flaps, pins, pads and cords stay in brake-flaps and hang', () => {
    for (const id of ['brake-knee-L', 'brake-knee-R']) expect(knees.partIds, id).toContain(id);
    for (const id of knees.partIds) expect(isEarlyBrakePart(parts.find((x) => x.id === id)!), id).toBe(true);
    for (const id of ['brake-flap-L', 'brake-shoe-L', 'brake-chock-L', 'brake-pivot-block-L']) expect(get('brake-flaps').partIds, id).toContain(id);
    for (const id of ['brake-pivot-pin-L', 'brake-pad-L', 'brake-cord-L']) expect(get('hang').partIds.some((q) => q.startsWith(id.slice(0, 9))), id).toBe(true);
    const seen = new Map<string, number>();
    for (const s of steps) for (const id of s.partIds) seen.set(id, (seen.get(id) ?? 0) + 1);
    for (const id of knees.partIds) expect(seen.get(id), id).toBe(1);
  });

  it('clamps the knee step to the position it occupies, so modelStep stays nondecreasing and honest', () => {
    const kneePart = parts.find((x) => x.id === 'brake-knee-L')!;
    expect(kneePart.step).toBe(STEP.brake);
    expect(knees.modelStep).toBeLessThan(kneePart.step);
    expect(knees.modelStep).toBeGreaterThanOrEqual(steps[idx('front-beam')].modelStep);
    expect(knees.modelStep).toBeLessThanOrEqual(steps[idx('gear-fit')].modelStep);
    // The viewer shows the knees when they are glued: absent before the step, on the hull from it to the end, no wheels yet.
    expect(cumulativeParts(steps, idx('front-beam'))).not.toContain('brake-knee-L');
    expect(cumulativeParts(steps, idx('brake-knees'))).toContain('brake-knee-L');
    expect(cumulativeParts(steps, idx('flip'))).toContain('brake-knee-R');
    expect(cumulativeParts(steps, idx('flip'))).not.toContain('wheel-FL');
  });

  it('counts the knees in the weight of the hull at the flip', () => {
    const mass = (ids: string[]): number => ids.reduce((a, id) => a + parts.find((x) => x.id === id)!.massLb, 0);
    const m = /weighs about (\d+) lb/.exec(get('flip').instructions.join(' '));
    expect(m).toBeTruthy();
    expect(mass(knees.partIds)).toBeGreaterThan(0);
  });
});

describe('build review round 2: step 1 names the cut list boards, rip first (MUST-B, MUST-C)', () => {
  const cl = cutList(parts, p);
  const mill = steps.find((s) => s.id === 'mill')!.instructions.join(' ');
  // a face-laminated part (no 12/4, D-70) is named by its layers
  const board = (id: string): string => { const r = cl.oak.flatMap((g) => g.rows).find((q) => q.ids.includes(id))!; return r.lamination ? `laminated: ${r.lamination.text}` : r.board; };

  it('reads every bandsaw-blank board from the cut list board column', () => {
    for (const [label, id] of [['brake knees', 'brake-knee-L'], ['brake shoes', 'brake-shoe-L'], ['chocks', 'brake-chock-L'], ['handlebow', 'handle-bar'], ['tongue', 'bridle-tongue']] as const) {
      expect(mill, label).toContain(`${label} (${board(id)})`);
    }
    // Nothing is bought in 16/4, whatever the model's raw rough says.
    expect(mill).not.toMatch(/16\/4/);
    // ... and a part with a transposed model rough still gets its cut-list board.
    const bad = parts.map((x) => (x.id === 'brake-shoe-L' || x.id === 'brake-shoe-R' ? { ...x, rough: { t: 3.125, w: 1.048, l: 3.7 } } : x));
    const t2 = assemblySteps(bad, p).find((s) => s.id === 'mill')!.instructions.join(' ');
    expect(t2).toContain(`brake shoes (${cutList(bad, p).oak.flatMap((g) => g.rows).find((r) => r.ids.includes('brake-shoe-L'))!.board})`);
    expect(t2).not.toMatch(/16\/4/);
  });

  it('prescribes rip first and quotes the yield, the spares and the lane plan from cutList().resaw', () => {
    expect(cl.resaw.length).toBeGreaterThanOrEqual(2);
    for (const pool of cl.resaw) {
      // r3 MUST-1: the lane count includes the spare lanes, so ripping as written yields the spares the bend test uses
      const m = mill.match(new RegExp(`resawn from ${pool.board.replace('/', '\\/')}, RIP FIRST: rip (\\d+) lane`));
      expect(m, pool.board).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(pool.lanes);
      if (pool.spares > 0) expect(mill).toMatch(/spare lane/);
      expect(mill).toContain(`it yields ${pool.stripSlots} strips for the ${pool.strips} needed`);
      expect(mill).toContain(pool.spares > 0 ? `${pool.spares} spare strip` : 'no spare strip');
    }
    expect(mill).toMatch(/do not resaw the full board width first/);
  });

  it('bends a real spare strip: the shaper step quotes the spares of both pools and the verify test uses them', () => {
    const shaper = steps.find((s) => s.id === 'shaper')!.instructions.join(' ');
    const rail = cl.resaw.find((q) => cl.strips.some((r) => r.ids.includes('rail-L') && Math.abs(r.rough.t - q.roughT) < 0.002))!;
    const band = cl.resaw.find((q) => cl.strips.some((r) => r.ids.includes('side-L-chine') && Math.abs(r.rough.t - q.roughT) < 0.002))!;
    expect(rail.spares).toBeGreaterThanOrEqual(1);
    expect(band.spares).toBeGreaterThanOrEqual(1);
    expect(shaper).toContain(`${rail.spares} spare rail strip`);
    expect(shaper).toContain(`${band.spares} spare band strip`);
    const bend = verifyChecklist(parts, p).find((v) => v.id === 'strip-bend')!;
    expect(bend.whatToDo).toContain(`${band.board} × ${band.boardWidthIn}" (${band.spares} spare`);
    expect(bend.whatToDo).toContain(`${rail.board} × ${rail.boardWidthIn}" (${rail.spares} spare`);
    expect(bend.whatToDo).toMatch(/SPARE strips/);
    expect(bend.whatToDo).not.toMatch(/needs one more board/);
  });
});

describe('build review round 2: web length, socket screws, hang support, stop-block pilots', () => {
  const get = (id: string) => steps.find((s) => s.id === id)!;
  const web = parts.find((x) => x.id === 'side-L-web')!;
  const net = +flatPattern(web)!.widthIn.toFixed(2);
  const blank = +web.stock!.l.toFixed(2);

  it('says the Shaper file cuts net and the blank is the stock, in step 2 and at the dry fit (numbers from the model)', () => {
    expect(blank).toBeGreaterThan(net);
    const shaper = get('shaper').instructions.join(' ');
    expect(shaper).toContain(`cuts the NET flat development, ${net}" long`);
    expect(shaper).toContain(`the blank is ${blank}"`);
    expect(shaper).toMatch(/cut net from the file/);
    const dry = get('dry-fit').instructions.join(' ');
    expect(dry).toContain(`net, ${net}" from the file; the blank was ${blank}"`);
  });

  it('quotes the handle-socket screw from the joint size text, no hardcoded length', () => {
    const j = parts.find((x) => x.id === 'handle-socket-L')!.joints!.find((q) => q.type === 'bolt')!;
    const m = /^(\S+ × \S+) (\d+ [^,(]*?screws?)/.exec(j.size!)!;
    const text = `${j.count} × ${m[1]} ${m[2]}`;
    expect(socketScrewText(parts)).toBe(text);
    expect(get('hang').instructions.join(' ')).toContain(text);
    expect(get('handle').instructions.join(' ')).toContain(text);
    expect(get('hang').instructions.join(' ')).not.toMatch(/1\/4-20 × 2 button/);
    // A model with a different screw length changes the text.
    const alt = parts.map((x) => (x.id === 'handle-socket-L' ? { ...x, joints: x.joints!.map((q) => (q.type === 'bolt' ? { ...q, size: q.size!.replace(/^(\S+ × )\S+/, '$19-9/16') } : q)) } : x));
    expect(assemblySteps(alt, p).find((s) => s.id === 'hang')!.instructions.join(' ')).toContain('1/4-20 × 9-9/16');
  });

  it('says how the hull is supported while the nuts go on under the beams and joists', () => {
    const t = get('hang').instructions.join(' ');
    expect(t).toMatch(/roll it onto its side on a padded blanket/);
    expect(t).toMatch(/flip it onto padded horses \(four people/);
  });

  it('gives the stop-block pilot locations in the wheel dry-fit step and screws from the underside, never from above', () => {
    const pilots = stopBlockPilots(parts, p)!;
    expect(pilots.total).toBe(4);
    expect(pilots.xs.length).toBe(2);
    const gf = get('gear-fit').instructions.join(' ');
    expect(gf).toContain(`${pilots.xs.map((n) => `${+n.toFixed(2)}"`).join(' and ')} forward`);
    expect(gf).toContain(`${pilots.offCenter.map((n) => `${+n.toFixed(2)}"`).join(' and ')} off the centerline`);
    expect(gf).toMatch(/transom's outer face/);
    // The pilots are the screws' own positions, in the model frame (the wedge `at` is local): the distance to the centerline equals the wedge's lateral center.
    const sb = get('seat-blocks').instructions.join(' ');
    expect(sb).toMatch(/UNDERSIDE/);
    expect(sb).toMatch(/tip the sled onto its side/);
    expect(sb).not.toMatch(/screw from below\./);
    expect(get('flip').instructions.join(' ')).toMatch(/at least 4"/);
  });
});
