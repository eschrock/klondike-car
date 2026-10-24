import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { worldAABB } from '../model/bounds';
import { HULL_STEP, STEP } from '../model/build-utils';
import { defaultParams, KNEE_MOUNT, THIN_SHEET } from '../params';
import { PRE_D72 } from '../test-fixtures';
import type { Part } from '../model/types';
import type { Params } from '../params';
import { cutList, ribFillers } from './cutlist';
import { formDrawings } from './forms';
import { computeLayout } from '../model/layout';
import { sideRibStations } from '../model/side-ribs';
import { RAIL_CHINE_HEAD_DIA_IN } from '../model/joinery';
import { assemblySteps, cumulativeParts, cuttingItems, cutObject, cutsPart, flattenInstr, glueCard, EARLY_STEP_IDS, hasGlueJoint, isEarlyBrakePart, isHangPart, isShopCut, jointTally, PART_TOKEN_RE, renderInstrText, socketScrewText, stepParts, stopBlockPilots, type BuildStep, type Instr } from './assembly';
import { finalFrac, roughFrac } from './units';
import { flatPattern } from './flat';
import { verifyChecklist } from './verify';
import { EPOXY_SYSTEM, finishingSchedule } from './finishing';

// D-73: this file tests the EXTREME weather spec's text (316, epoxy, varnish); the Standard text is tested in weather-spec.test.ts.
const p = { ...defaultParams(), weatherSpec: 1 }; // Extreme text on the Extreme spec's own geometry: the 5 mm white oak plywood thin sheet and the 13 mm deck as bought (2026-10-24; it was the 6 mm okoume of D-80)
const parts = buildModel(p);
const built = parts.filter((x) => x.group !== 'reference' && x.kind !== 'reference' && !x.payload);
const steps = assemblySteps(parts, p);
const VIEWS = ['iso', 'top', 'side', 'front', 'under'];

describe('assembly steps', () => {
  it('begin with the preparation steps, which install nothing: the deck first (the reference, D-94), then each form on its own', () => {
    expect(steps.slice(0, 5).map((s) => s.title)).toEqual([
      'Verify before ordering',
      'Mill the oak and resaw the strips',
      'Cut the deck and the seat back first',
      'Build the rail form',
      'Build the side forms, then cut the webs',
    ]);
    expect(steps.slice(0, 6).map((s) => s.id)).toEqual(['verify', 'mill', 'cut-deck', 'rail-form', 'side-forms', 'seal']);
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
    // (the early steps aside: the brake knees and the grab boards are installed before their model step, EARLY_STEP_IDS)
    const at = (ms: number): number => steps.findIndex((s) => !EARLY_STEP_IDS.has(s.id) && s.partIds.some((id) => by.get(id)!.step === ms));
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
        expect(s.clampCure, s.id).toMatch(/\d+ h|\d+-\d+ min|cure/); // one short line; the pot life and cold-shop times are on the glue card
        expect(s.cure, s.id).toBeDefined(); // Extreme: epoxy throughout
      }
    }
    // Every build step that installs wood joints is in that set.
    expect(steps.filter((s) => s.clampCure).length).toBeGreaterThan(12);
  });

  it('uses the one epoxy the BOM buys (U.S. Composites 635, 2:1) for every glue-up, the closing of the ends included (small batches, mixed alone)', () => {
    const get = (id: string) => steps.find((s) => s.id === id)!;
    expect(get('frame').cure!.hardener).toBe('556');
    expect(get('frame').cure!.potMin).toEqual(EPOXY_SYSTEM.potMin);
    expect(get('frame').cure!.clampHours).toEqual([12, 24]);
    expect(get('frame').cure!.fullHours).toBe(168);
    for (const id of ['transom', 'bulkhead']) {
      expect(get(id).cure!.hardener, id).toBe('556');
      expect(get(id).clampCure, id).toMatch(/^Epoxy: clamp 12-24 h, full cure 7 days/);
      expect(get(id).instructions.join(' '), id).toMatch(/small batch/i);
      expect(get(id).instructions.join(' '), id).not.toMatch(/second person|two people/i);
    }
    expect(flattenInstr([glueCard(p)], parts).join(' ')).toMatch(/GLUE CARD[\s\S]*60 °F[\s\S]*55 °F/); // the winter figures are on the glue card (a box before the steps)
  });

  it('have a goal, 2-10 short items, a title, tools, checks and a valid camera', () => {
    for (const s of steps) {
      expect(s.title.length, s.id).toBeGreaterThan(4);
      expect(s.goal.length, s.id).toBeGreaterThan(10);
      expect(s.items.length, s.id).toBeGreaterThanOrEqual(2);
      expect(s.items.length, s.id).toBeLessThanOrEqual(10);
      expect(s.checks.length, s.id).toBeGreaterThanOrEqual(1);
      expect(VIEWS, s.id).toContain(s.view);
    }
    for (const s of steps.filter((x) => x.kind !== 'process')) expect(s.tools.length, s.id).toBeGreaterThan(0);
  });

  it('look at the running gear from underneath (hull still inverted)', () => {
    const first = steps.findIndex((s) => s.id === 'rear-beam');
    const last = steps.findIndex((s) => s.id === 'finish-under');
    const gear = steps.slice(first, last + 1);
    expect(gear.map((s) => s.id)).toEqual(['rear-beam', 'front-beam', 'brake-knees', 'gear-fit', 'under-holes', 'finish-under']);
    for (const s of gear) expect(s.view, s.id).toBe('under');
  });

  it('build instructions from the joints and the params', () => {
    const get = (id: string) => steps.find((s) => s.id === id)!;
    // D-81, D-82: the chine tie has NO Dominos. The screw counts come from the rail's joint list: 8 a rail, #8 × 2-1/2", up through the rail into the side sandwich in every gap.
    expect(get('rails').instructions.join(' ')).toContain('8 holes a rail, straight through from the bottom edge to the top edge, 11/64" clearance');
    expect(get('lower').instructions.join(' ')).toMatch(/8 screws a side, #8 × 2-1\/2" trim-heads, evenly spaced/);
    expect(get('lower').instructions.join(' ')).toMatch(/13\/32" bearing face/); // outer band 0.214 + web 0.197, to the nearest 1/32 (2026-10-24: 13 mm deck, 5 mm combi-core white oak sides as bought)
    const okSteps = assemblySteps(buildModel({ ...p, ...PRE_D72 }, undefined), { ...p, ...PRE_D72 });
    expect(okSteps.find((s) => s.id === 'lower')!.instructions.join(' ')).toMatch(/8 screws a side, #8 × 2-1\/2"/);
    expect(okSteps.find((s) => s.id === 'lower')!.instructions.join(' ')).not.toMatch(/Domino/);
    expect(get('dry-fit').instructions.join(' ')).toContain(`${finalFrac(p.deckSideClearIn)} a side`);
    expect(get('side-forms').instructions.join(' ')).toMatch(/Cut the two webs, left side panel and right side panel, from the thin sheet, placed as the nesting drawing shows/); // D-94: the webs are cut at the side forms, once the forms are proved
    expect(get('side-forms').instructions.join(' ')).not.toMatch(/scarf/i);
    expect(get('gear-fit').instructions.join(' ')).toMatch(/5\/8" bore on the 5\/8" rod/); // D-71/D-72: fractions, and the solid rod Eric chose
    expect(get('gear-fit').instructions.join(' ')).not.toMatch(/0\.63"/);
  });

  it('count a joint listed on both mating parts once', () => {
    const ids = new Set(['rail-L', 'rail-R']);
    const t = jointTally(parts, ids, 'domino', (j) => (/^5×30/.test(j.size ?? '') ? '5×30' : /^6×40/.test(j.size ?? '') ? '6×40' : 'other'));
    expect(t.get('5×30')).toBe(12); // the crossmember and king beam Dominos (6 a rail: the last crossmember is glued to the bulkhead, its rail mortise met the bulkhead mortise); the chine tie has none (D-81)
    expect(t.get('6×40')).toBe(2); // the rail ends into the bow bulkhead: 6×40 now, not the 8×50 (D-81)
    expect(t.has('other')).toBe(false);
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
    for (const id of ['wheel-RL', 'wheel-FR', 'axle-FL', 'clamp-FL1', 'roll-pad-L', 'steer-eye-L', 'steer-anchor-R', 'seat-hinge-L', 'storage-hinge-R', 'handle-socket-L', 'brake-pivot-pin-L']) expect(hang.partIds, id).toContain(id);
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
    expect(fin).toMatch(/tongue and the grab boards \(with their caps\) are NOT removable/);
    expect(fin).not.toMatch(/\(brake flaps, handle, signs, tongue\)/);
    expect(get('tongue').instructions.join(' ')).toMatch(/not removable/);
  });

  it('fits and drills the gear, takes it off, finishes the underside before the flip, and hangs it last', () => {
    // round 1 fix: the rear axle and its plates go on for good with the beam (the hold-down angles pin the axle), only the front gear comes off
    expect(get('rear-beam').instructions.join(' ')).toMatch(/stay on from here, through the finish/);
    for (const id of ['axle-R', 'clamp-RL1', 'clamp-RR1']) expect(get('rear-beam').partIds, id).toContain(id);
    expect(get('front-beam').instructions.join(' ')).toMatch(/they come off again after the wheel dry fit/);
    const gf = get('gear-fit');
    expect(gf.kind).toBe('process');
    expect(gf.instructions.join(' ')).toMatch(/OFF and bag/);
    expect(get('under-holes').instructions.join(' ')).toMatch(/stop-block/); // the last holes from below are their own step, after the wheels
    expect(get('finish-under').instructions.join(' ')).toMatch(/underside|from below/);
    expect(get('finish-under').checks.join(' ')).toMatch(/dry to handle/);
    const h = get('hang').instructions.join(' ');
    expect(h).toMatch(/varnish has cured/);
    expect(h).toMatch(/cotter pins/);
    expect(h).toMatch(/T-nuts/);
    // The hinges are fitted dry at their steps, not screwed on.
    expect(get('seat-back').instructions.join(' ')).toMatch(/FIT AND DRILL now, hang later/);
    expect(get('handle').instructions.join(' ')).toMatch(/FIT now, then take off/);
  });

  it('gives wrench access to the handle-socket nuts before the box closes them in', () => {
    const t = get('transom').instructions.join(' ');
    expect(t).toMatch(/T-nut/);
    expect(t).toMatch(/behind the storage box/);
    expect(idx('transom')).toBeLessThan(idx('storage-box'));
  });
});

describe('build review round 1: stain vs seal (MUST-2)', () => {
  it('seals only the deck underside, the ply edges and hidden faces at assembly; the show faces are dyed, then sealed (D-99)', () => {
    const seal = steps.find((s) => s.id === 'seal')!.instructions.join(' ');
    expect(seal).toMatch(/ONLY the deck underside and edges, every ply edge/); // D-94: no dados exist yet at the seal step
    expect(seal).toMatch(/show faces stay bare/);
    expect(seal).toMatch(/Glue faces stay bare or scuffed/);
    expect(seal).toMatch(/Water-based dye under epoxy is the safe route/);
    expect(seal).toMatch(/offcut tests/);
    expect(seal).not.toMatch(/all ply faces/i);
    expect(seal).toMatch(/They are dyed, THEN sealed/);
    const fin = steps.find((s) => s.id === 'finish')!.instructions.join(' ');
    expect(fin).toMatch(/Show faces: dye first \(finishing step F3\), then the epoxy seal and the varnish/);
  });
});

describe('build review round 1: rail end mortises (MUST-3)', () => {
  it('cuts them after the trim, with tools that work on the glued unit, from the current joints', () => {
    const rails = steps.find((s) => s.id === 'rails')!.instructions.join(' ');
    expect(rails).toMatch(/Do NOT cut the end mortises yet/);
    expect(rails).not.toMatch(/loose-tenon mortises in the rail ends/);
    const dry = steps.find((s) => s.id === 'rail-ends')!; // the rail trim and end mortises are their own step after the dry fit
    const text = dry.instructions.join(' ');
    expect(text).toMatch(/flush-cut saw/);
    expect(dry.tools).toContain('flush-cut (Japanese) saw');
    expect(text.indexOf('Trim the rails')).toBeGreaterThan(-1);
    expect(text.indexOf('cut the rail-end mortises in the trimmed ends')).toBeGreaterThan(-1);
    expect(text.indexOf('Trim the rails')).toBeGreaterThan(text.indexOf('cut the rail-end mortises in the trimmed ends')); // the mortise item opens with the rail trim, on the horses
    expect(text).not.toMatch(/table saw or bandsaw/);
    expect(dry.tools).not.toContain('table saw or bandsaw');
    // Joint types are read from the model (D-69: Dominos into the bulkhead).
    const rail = parts.find((x) => x.id === 'rail-L')!;
    const jb = rail.joints!.find((j) => j.to === 'bow-bulkhead')!;
    const jt = rail.joints!.find((j) => j.to === 'transom-rear')!;
    if (jb.type === 'domino') expect(text).toContain(`Bulkhead end: ${/(\d+)\s*×\s*(\d+)/.exec(jb.size!)!.slice(1, 3).join('×')} Domino`);
    if (jt.type === 'mortise-tenon') expect(text).toMatch(/Transom end: [^.]*(loose-tenon mortise|loose tenon)/);
  });
});

describe('build review round 1: brake backers (MUST-4)', () => {
  const retarget = (step: number): Part[] => parts.map((x) => (/^brake-backer-[LR]$/.test(x.id) ? { ...x, step } : x));
  const host = (ps: Part[]): string => assemblySteps(ps, p).find((s) => s.partIds.includes('brake-backer-L'))!.id;

  it('places the backers in whatever step the model says', () => {
    expect(host(parts)).toBe(parts.find((x) => x.id === 'brake-backer-L')!.step <= HULL_STEP.deck ? 'frame-parts' : 'brake-knees'); // the day-before step of the frame
    expect(host(retarget(STEP.frame))).toBe('frame-parts');
    expect(host(retarget(STEP.brake))).toBe('brake-knees');
  });

  it('glues them in the frame glue-up and drills the knee-bolt holes there, when the model puts them in the frame step', () => {
    const s2 = assemblySteps(retarget(STEP.frame), p);
    const frame = s2.find((s) => s.id === 'frame-parts')!.instructions.join(' ');
    expect(frame).toMatch(/brake knee backers/i);
    expect(frame).toMatch(/knee-bolt holes/);
    expect(s2.find((s) => s.id === 'brake-knees')!.instructions.join(' ')).toMatch(/went in with the frame glue-up/);
    const s3 = assemblySteps(retarget(STEP.brake), p);
    expect(s3.find((s) => s.id === 'frame')!.instructions.join(' ')).not.toMatch(/brake knee backers/i);
    expect(s3.find((s) => s.id === 'brake-knees')!.instructions.join(' ')).toMatch(/Glue the backers \(3\/4" oak\)/);
  });
});

describe('D-81, D-82: the chine tie is an epoxy bed and screws, no Dominos (replaces the chine Domino tie of build review round 1)', () => {
  const idx = (id: string): number => steps.findIndex((s) => s.id === id);
  it('drills the pilots in the bottom edge of each side at the dry fit, through the rail holes, after the trim', () => {
    const dry = steps[idx('rail-ends')];
    const t = dry.instructions.join(' ');
    expect(t).toMatch(/Drill the screw pilots in the bottom edge of each side, through the rail holes: 8 a side/);
    expect(t).toMatch(/7 pilots: 1\/8" pilot, 5\/8" deep/);
    expect(t).toMatch(/1 pilot: 1\/8" pilot, 13\/16" deep/); // the forward rail is 1-13/16" deep under the 13 mm deck (2026-10-24: 13 mm deck, 5 mm combi-core white oak sides as bought)
    expect(t).toMatch(/glue line between the outer band and the web/);
    // the rail ends are marked in place before the pilots, then sawn on the horses after them (round 3: no saw beside the web edge)
    expect(dry.instructions.findIndex((l) => /Mark each rail end flush with the band ends/.test(l))).toBeLessThan(dry.instructions.findIndex((l) => /screw pilots/.test(l)));
    expect(dry.instructions.findIndex((l) => /Trim the rails/.test(l))).toBeGreaterThan(dry.instructions.findIndex((l) => /screw pilots/.test(l)));
    expect(dry.tools).toContain('drill');
    expect(idx('sides-outer')).toBeLessThan(idx('dry-fit'));
    expect(idx('dry-fit')).toBeLessThan(idx('lower'));
    expect(steps[idx('sides-outer')].tools).not.toContain('Domino'); // no mortises in the sides any more
  });
  it('beds the bearing face in thickened epoxy, lowers the unit, screws in every gap with a pilot, and clamps the side flush while it cures', () => {
    const t = steps[idx('lower')].instructions.join('\n');
    expect(t).toMatch(/Spread a bed of epoxy thickened with fumed silica[^\n]*bearing face of both sides/);
    expect(t).toMatch(/Lower the unit onto the sides, alone/);
    expect(t).not.toMatch(/two people|second person/i);
    expect(t).toMatch(/Screw each rail to its side in every gap: 8 screws a side, #8 × 2-1\/2" trim-heads, evenly spaced \(about 6-1\/2" apart\)/);
    expect(t).toMatch(/11\/64" clearance hole through the rail and a 1\/8" pilot in the side/);
    expect(t).toMatch(/1\/4" counterbores 1" deep in the rail's bottom edge/);
    expect(t).toMatch(/Clamp the side to the rail between the screws\.[\s\S]*Small bar clamps[^\n]*caul/);
    // the pilots drilled at the dry fit register the side; the deck slot is filled last; the pot-life budget is stated
    expect(t).toMatch(/each screw registers the side/);
    expect(t.indexOf('Then fill the deck slot')).toBeGreaterThan(t.indexOf('Clamp the side to the rail'));
    expect(t).toMatch(/Pot-life budget[^\n]*TWO batches/);
    expect(t).toMatch(/straight down through the rail/);
    expect(t).not.toMatch(/Domino|mortise/);
    expect(steps[idx('lower')].clampCure).toMatch(/^Epoxy: clamp 12-24 h/);
  });
  it('no step, check or tool in either spec mentions a chine Domino, a chine mortise or a #6 screw', () => {
    const pStd = { ...defaultParams(), weatherSpec: 0 };
    for (const list of [steps, assemblySteps(buildModel(pStd), pStd)]) {
      for (const s of list) {
        const all = [s.title, s.goal, ...s.instructions, ...s.checks, ...s.tools, s.clampCure ?? ''].join('\n');
        expect(all, s.id).not.toMatch(/chine[^\n]*Domino|Domino[^\n]*chine|chine[- ]tie mortise|chine mortise/i);
        expect(all, s.id).not.toMatch(/#6\b/);
        expect(all, s.id).not.toMatch(/8×50/);
      }
    }
  });
});

describe('build review round 1: forms and resaw numbers come from their sources (MUST-6, MUST-9)', () => {
  const forms = formDrawings(parts, p);
  const dim = (id: string, key: string): number => forms.find((d) => d.id === id)!.dims.find((q) => q.key === key)!.valueIn;
  const railForm = steps.find((s) => s.id === 'rail-form')!.instructions.join(' ');
  const sideForms = steps.find((s) => s.id === 'side-forms')!.instructions.join(' ');
  const every = steps.flatMap((s) => [s.title, ...s.instructions, ...s.checks, ...s.tools]).join('\n');

  it('quotes the S-ramp and the rail form from forms.ts, and presents the forms\' own steps for making them (the glue-up belongs to the glue steps)', () => {
    // the side forms are the form drawing's own build list, one item per piece of the jig
    expect(sideForms).toContain(`hangs ${finalFrac(dim('side-form', 'ramp-rise'))} lower`);
    expect(sideForms).toContain(`${finalFrac(dim('side-form', 'ramp-length'))} long`);
    expect(sideForms).toContain(`cut ${dim('side-form', 'ramp-ribs')} ribs from 3/4" MDF`);
    expect(railForm).toContain(`${finalFrac(dim('rail-form', 'form-length'))} long`);
    for (const [stepId, id, word] of [['rail-form', 'rail-form', 'rail form'], ['side-forms', 'side-form', 'S-ramp']] as const) {
      const step = steps.find((s) => s.id === stepId)!;
      const build = (forms.find((d) => d.id === id) as unknown as { build?: Array<{ step: string }> }).build ?? [];
      const making = build.filter((b) => !/^(CLAMP|GLUE-UP|SPRING-BACK)/.test(b.step));
      if (stepId === 'side-forms') {
        // D-94: the hardboard test web, one item per piece of the jig, the check before the webs are cut (and their cut), then the dry run with the band bend test
        expect(step.items.length, id).toBe(making.length + 4);
        expect(step.items.map((q) => q.text.split(':')[0])).toEqual(['Cut a test web first', ...making.map((q) => q.step.split(':')[0]), 'Before you cut the webs', 'Cut the two webs, {{side-L-web}} and {{side-R-web}}, from the thin sheet, placed as the nesting drawing shows.', 'Dry-run the real webs on the form, then bend-test a spare band strip on it, before any glue goes on.']);
      } else {
        const item = step.items.find((q) => q.text.includes(word))!;
        expect(item, id).toBeTruthy();
        if (build.length) expect(item.sub!.length, id).toBe(making.length);
      }
      // the form steps hold no glue-up: clamping, curing and the glue are in the rails and side steps
      expect(step.instructions.join(' '), id).not.toMatch(/GLUE-UP|CLAMP:|Cure 24 h|epoxy the inner chine band/i);
    }
  });

  it('stacks the rail form at least as high as the rail is deep', () => {
    const depth = parts.find((x) => x.id === 'rail-L')!.stock!.w;
    const m = /(\d+) layers of 3\/4" MDF/.exec(railForm)!;
    expect(m).toBeTruthy();
    expect(+m[1] * 0.75).toBeGreaterThanOrEqual(depth - 1e-9);
  });

  it('uses one term: S-ramp, never "S-form", and no stale ramp size', () => {
    expect(every).not.toMatch(/S-form/);
    expect(every).not.toMatch(/1\.25" high/);
    expect(every).toMatch(/S-ramp/);
  });

  it('writes the resaw text from the cut list pools, with its spare strips, and buys nothing', () => {
    const pools = cutList(parts, p).resaw;
    const mill = steps.find((s) => s.id === 'mill')!.instructions.join(' ');
    expect(pools.length).toBeGreaterThanOrEqual(2);
    for (const pool of pools) {
      // the rip text names the board thickness: "a 10"-wide 4/4 board", "2 boards of 5/4"
      expect(mill).toContain(pool.ripText.replace(/^./, (c) => c.toUpperCase()).replace(/\b(\d+) boards\b/, `$1 boards of ${pool.board}`).replace(/\bboard first\b/, `${pool.board} board first`));
      expect(mill).toContain(pool.resawHeightText);
      expect(mill).toContain(`${pool.stripSlots} strips for the ${pool.strips} needed`);
      expect(mill).toContain(pool.spares > 0 ? `${pool.spares} spare` : 'no spare');
    }
    expect(mill).not.toMatch(/\bBuy\b/i);
    expect(mill).not.toMatch(/25 % spares/);
  });

  it('schedules the face laminations in the milling step, before anything is notched, bored or slotted (D-70)', () => {
    const mill = steps.find((s) => s.id === 'mill')!.instructions.join(' ');
    expect(mill).toMatch(/Face-laminate the thick parts before anything is notched, bored or slotted/);
    const lam = steps.find((s) => s.id === 'mill')!.items.find((q) => /Face-laminate/.test(q.text))!;
    const lamIds = (lam.sub ?? []).flatMap((q) => [...(q.parts ?? []), ...(q.sub ?? []).flatMap((x) => x.parts ?? [])]); // the blocks are listed under one sub-item, after the generic steps (round 3)
    for (const id of ['beam-F', 'beam-R', 'brake-knee-L', 'brake-chock-L']) expect(lamIds, id).toContain(id);
    expect(mill).toContain('3 layers: 3 \u00d7 3/4" from 4/4, glue up, then mill the block to 2-1/8"'); // D-74 (Eric 2026-10-13): the beams, knees and chocks are all 3 \u00d7 3/4" from 4/4
    expect(mill).toMatch(/Mill the cured block to its final size/);
    expect(mill.indexOf('Edge-glue the wide boards first')).toBeLessThan(mill.indexOf('Face-laminate')); // the glued layers come before the lamination that depends on them
    expect(steps.find((s) => s.id === 'mill')!.checks.join(' ')).toMatch(/Laminated blocks cured/);
    const mi = steps.findIndex((s) => s.id === 'mill');
    for (const later of ['brake-knees']) expect(steps.findIndex((s) => s.id === later), later).toBeGreaterThan(mi);
  });

  it('schedules the edge-glued panels in the milling step', () => {
    const mill = steps.find((s) => s.id === 'mill')!.instructions.join(' ');
    expect(mill).toMatch(/Edge-glue the wide boards first/);
    const edge = steps.find((s) => s.id === 'mill')!.items.find((q) => /Edge-glue the wide boards first/.test(q.text))!;
    expect((edge.sub ?? []).flatMap((q) => q.parts ?? [])).toContain('transom-rear');
  });
});

describe('build review round 1: shop details', () => {
  const get = (id: string) => steps.find((s) => s.id === id)!;
  it('gives the inverted sides station cradles with the widths from the layout', () => {
    const t = get('dry-fit').instructions.join(' ');
    expect(t).toMatch(/4 MDF station cradles/);
    expect(t).toMatch(/Cradle 1: [\d\-/]+" from the rear end of the sides; plate [\d\-/]+" wide \(the hull is [\d\-/]+" wide outside there\); the side is [\d\-/]+" tall there, so the slot floors are [\d\-/]+" from the floor/);
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

  it('fits the knees (dry by default, glued in the option) while the hull is inverted, before the underside is finished and before the flip', () => {
    expect(idx('brake-knees')).toBeGreaterThan(idx('front-beam'));
    expect(idx('brake-knees')).toBeLessThan(idx('finish-under'));
    expect(idx('brake-knees')).toBeLessThan(idx('flip'));
    expect(knees.view).toBe('under');
    const t = knees.instructions.join(' ');
    expect(t).toMatch(/The knees go on dry/); // removable knees, the default (D-78)
    const fx = { ...p, kneeMount: KNEE_MOUNT.fixed };
    const fxSteps = assemblySteps(buildModel(fx), fx);
    expect(fxSteps.find((s) => s.id === 'brake-knees')!.instructions.join(' ')).toMatch(/glue will not bond to varnish/);
    expect(fxSteps.find((s) => s.id === 'finish-under')!.instructions.join(' ')).toMatch(/brake knees/); // glued knees are finished in place with the underside
    expect(t).toMatch(/nylock nuts/);
    expect(t).toMatch(/hull is inverted/);
    expect(t).toMatch(/one-knee test/);
    expect(t).not.toMatch(/stay bolted on for finishing/);
    expect(t).not.toMatch(/the other three knees/);
    // The one-knee verify item needs a knee: it is done at the knee step (listed in step 0 with the other at-assembly checks).
    expect(verifyChecklist(parts, p).find((v) => v.id === 'brake-knee')!.when).toBe('at assembly');
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
  const board = (id: string): string => {
    const r = cl.oak.flatMap((g) => g.rows).find((q) => q.ids.includes(id))!;
    // the brake knee is cross-laminated (D-75): step 1 gives its recipe in full and the blank line points at it
    if (r.lamination && id.startsWith('brake-knee')) return `cross-laminated block (glued above), milled to ${cl.glueUps.find((q) => q.ids.includes(id))!.finalText}`;
    return r.lamination ? `laminated block, ${r.lamination.text}` : r.board;
  };
  const blankItem = (ss: BuildStep[]) => ss.find((s) => s.id === 'mill')!.items.find((q) => /single-board bandsaw blanks/.test(q.text))!;
  const blankOf = (ss: BuildStep[], id: string): string => blankItem(ss).sub!.find((q) => (q.parts ?? []).includes(id))!.text;

  it('reads every single-board bandsaw blank from the cut list board column, and does not repeat the lamination lines', () => {
    expect(blankOf(steps, 'brake-shoe-L')).toContain(board('brake-shoe-L'));
    const listed = blankItem(steps).sub!.flatMap((q) => q.parts ?? []);
    for (const id of ['brake-knee-L', 'brake-chock-L', 'beam-R']) expect(listed, id).not.toContain(id); // laminated blocks: their recipe is in the face-laminate block only
    expect(blankItem(steps).sub!.map((q) => q.text).join(' ')).not.toMatch(/glue up, then mill the block|laminated block/);
    // Nothing is bought in 16/4, whatever the model's raw rough says.
    expect(mill).not.toMatch(/16\/4/);
    // ... and a part with a transposed model rough still gets its cut-list board.
    const bad = parts.map((x) => (x.id === 'brake-shoe-L' || x.id === 'brake-shoe-R' ? { ...x, rough: { t: 3.125, w: 1.048, l: 3.7 } } : x));
    const s2 = assemblySteps(bad, p);
    expect(blankOf(s2, 'brake-shoe-L')).toContain(cutList(bad, p).oak.flatMap((g) => g.rows).find((r) => r.ids.includes('brake-shoe-L'))!.board);
    expect(s2.find((s) => s.id === 'mill')!.instructions.join(' ')).not.toMatch(/16\/4/);
  });

  it('prescribes rip first and quotes the resaw height, the yield, the spares and the lane plan from cutList().resaw', () => {
    expect(cl.resaw.length).toBeGreaterThanOrEqual(2);
    for (const pool of cl.resaw) {
      // r3 MUST-1: the lane count includes the spare lanes, so ripping as written yields the spares the bend test uses
      const rip = pool.ripText.replace(/\b(\d+) boards\b/, `$1 boards of ${pool.board}`).replace(/\bboard first\b/, `${pool.board} board first`);
      const m = mill.match(new RegExp(`${rip.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}: (\\d+) lanes?`, 'i'));
      expect(m, pool.board).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(pool.lanes);
      expect(mill).toContain(pool.resawHeightText);
      expect(pool.withinCapacity).toBe(true);
      expect(mill).toContain(`${pool.stripSlots} strips for the ${pool.strips} needed`);
    }
    expect(mill).toMatch(/Never stand the whole board on edge/);
  });

  it('bends a real spare strip: the rail form step quotes the spares of both pools and the verify test uses them', () => {
    const shaper = steps.find((s) => s.id === 'rail-form')!.instructions.join(' ');
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

  it('says the Shaper file cuts net and the blank is the stock, at the side forms (where the webs are cut, D-94) and at the dry fit (numbers from the model)', () => {
    expect(blank).toBeGreaterThan(net);
    const shaper = get('side-forms').instructions.join(' ');
    expect(shaper).toContain(`cut the net from the Shaper file: ${finalFrac(net)} long`);
    expect(shaper).toContain(`Nest the ${roughFrac(blank)} blank on the sheet`);
    expect(shaper).toMatch(/cut the net from the Shaper file/);
    const dry = get('dry-fit').instructions.join(' ');
    expect(dry).toContain(`came off the Shaper at ${finalFrac(net)}`);
  });

  it('quotes the handle-socket screw from the joint size text, no hardcoded length', () => {
    const j = parts.find((x) => x.id === 'handle-socket-L')!.joints!.find((q) => q.type === 'bolt')!;
    const m = /^(\S+) × (\S+) .*?([a-z]+-head cap screws?)/.exec(j.size!)!;
    const cut = /\(cut to ([^")]+)"?\)/.exec(j.size ?? '');
    const text = `${j.count} × ${m[1]} × ${m[2]}" stainless ${m[3]}${cut ? ` cut to ${cut[1]}"` : ''}`;
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
    expect(t).toMatch(/roll it onto its side on a padded blanket/i);
    expect(t).toMatch(/flip it onto padded horses \(four people/);
  });

  it('gives the stop-block pilot locations in the wheel dry-fit step and screws from the underside, never from above', () => {
    const pilots = stopBlockPilots(parts, p)!;
    expect(pilots.total).toBe(4);
    expect(pilots.xs.length).toBe(2);
    const gf = get('under-holes').instructions.join(' ');
    expect(gf).toContain(`${pilots.xs.map((n) => finalFrac(n)).join(' and ')} forward`);
    expect(gf).toContain(`${pilots.offCenter.map((n) => finalFrac(n)).join(' and ')} either side of the centerline`);
    expect(gf).toMatch(/transom's outer face/);
    // The pilots are the screws' own positions, in the model frame (the wedge `at` is local): the distance to the centerline equals the wedge's lateral center.
    const sb = get('seat-blocks').instructions.join(' ');
    expect(sb).toMatch(/UNDERSIDE/);
    expect(sb).toMatch(/Raise the sled on blocks so you can reach under the deck/); // never tipped with the glue wet
    expect(sb).toMatch(/Dry first: drive the 2 screws up from below/);
    expect(sb).not.toMatch(/screw from below\./);
    expect(get('flip').instructions.join(' ')).toMatch(/at least 4"/);
  });
});

describe('instruction style (Eric 2026-10-12: short steps, names not ids, fractions, locations, no buying)', () => {
  const std = defaultParams();
  const stdParts = buildModel(std);
  const okP = { ...p, ...PRE_D72 };
  const okParts = buildModel(okP);
  const cases: Array<[string, Part[], BuildStep[]]> = [
    ['extreme', parts, steps],
    ['standard', stdParts, assemblySteps(stdParts, std)],
    ['pre-D72 okoume', okParts, assemblySteps(okParts, okP)],
  ];
  const walk = (items: Instr[]): Instr[] => items.flatMap((q) => [q, ...walk(q.sub ?? [])]);
  const textsOf = (s: BuildStep): string[] => [s.goal, ...walk(s.items).map((q) => q.text), ...s.instructions, ...s.checks];
  const escRe = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (const [name, ps, ss] of cases) {
    const ids = ps.filter((x) => /[-\d]/.test(x.id)).map((x) => x.id);
    const idRe = new RegExp(`(?<![\\w{-])(${ids.map(escRe).join('|')})(?![\\w}-])`);
    const have = new Set(ps.map((x) => x.id));

    it(`${name}: no param names, file names, raw part ids or long decimals in any step`, () => {
      for (const s of ss) {
        for (const t of textsOf(s)) {
          const bare = t.replace(PART_TOKEN_RE, '');
          expect(bare, `${s.id}: ${t}`).not.toMatch(/\b[a-z]+(?:[A-Z][a-z0-9]*)+(In|Lb|Lbf|Psi|Deg)\b/);
          expect(bare, `${s.id}: ${t}`).not.toMatch(/\.ts\b/);
          expect(bare, `${s.id}: ${t}`).not.toMatch(idRe);
          expect(t, `${s.id}: ${t}`).not.toMatch(/\d\.\d{3,}/);
        }
        if (s.clampCure) expect(s.clampCure, s.id).not.toMatch(/\d\.\d{3,}/);
      }
    });

    it(`${name}: no step talks about buying`, () => {
      for (const s of ss) for (const t of textsOf(s)) expect(t, `${s.id}: ${t}`).not.toMatch(/\bbuy\b|\bbought\b|\border(s|ed|ing)?\b|\$/i);
    });

    it(`${name}: every {{token}} and every listed part is a real part; each step has 2-10 items`, () => {
      for (const s of ss) {
        expect(s.items.length, s.id).toBeGreaterThanOrEqual(2);
        expect(s.items.length, s.id).toBeLessThanOrEqual(10);
        for (const q of walk(s.items)) {
          for (const m of q.text.matchAll(PART_TOKEN_RE)) expect(have.has(m[1]), `${s.id}: ${m[1]}`).toBe(true);
          for (const id of q.parts ?? []) expect(have.has(id), `${s.id}: ${id}`).toBe(true);
          for (const m of q.text.matchAll(PART_TOKEN_RE)) expect(q.parts, `${s.id}: ${q.text}`).toContain(m[1]);
        }
      }
    });
  }

  it('flattens items into the plain instructions: names for tokens, sub-items as "– " lines', () => {
    const rails = steps.find((s) => s.id === 'rails')!;
    const lines = rails.instructions;
    expect(lines.length).toBeGreaterThan(rails.items.length);
    expect(lines.some((l) => l.startsWith('– '))).toBe(true);
    expect(lines.join(' ')).not.toMatch(/\{\{/);
    expect(lines[0]).toContain(renderInstrText(rails.items[0].text, parts));
    expect(renderInstrText('{{rail-L}} first, then {{beam-R}}.', parts)).toBe('Rail L first, then rear axle beam.');
    expect(renderInstrText('Bolt it to {{king-beam}}. {{kingpin}} next.', parts)).toBe('Bolt it to king beam. Kingpin bolt next.');
  });

  it('the resaw items quote the resaw height (rip first, so the cut is only a strip wide)', () => {
    const mill = steps.find((s) => s.id === 'mill')!;
    for (const pool of cutList(parts, p).resaw) {
      const item = mill.items.find((q) => /^Resaw/.test(q.text) && walk(q.sub ?? []).some((x) => x.text.includes(pool.resawHeightText)));
      expect(item, pool.board).toBeTruthy();
      expect(pool.resawHeightIn).toBeLessThanOrEqual(pool.bandsawCapacityIn);
    }
  });

  it('the notch, bore, groove and mortise items carry their locations from the part drawings', () => {
    const sub = (id: string, re: RegExp): string => {
      const it = steps.find((s) => s.id === id)!.items.find((q) => re.test(q.text));
      expect(it, `${id} ${re}`).toBeTruthy();
      return walk([it!]).map((q) => q.text).join(' ');
    };
    const loc = /\d[\d\-/]*" (from|to)\b|from the (rear|left|top|bottom|front)/;
    const cases: Array<[string, RegExp, RegExp]> = [
      ['rails', /beam notch/, /wide × [\d\-/]+" deep in the bottom edge, starting [\d\-/]+" from the rear end/],
      ['rails', /bow step/, /from the rear end/],
      ['rails', /Drill the screw holes BEFORE the bow step/, /from the rear end[^.]*from the inboard face/], // D-81: the drawing's positions of the chine screws
      ['rails', /crossmembers and the king beam/, /from the rear end/],
      ['hangers', /beam notch/, /from the rear edge/],
      ['hangers', /Domino mortise/, /from the rear edge/],
      ['frame', /kingpin/, /from the left end/],
      ['rear-beam', /axle groove/, /from the rear face/],
      ['rear-beam', /Drill the beam/, /from the left end/],
      ['front-beam', /Drill and groove/, /Kingpin hole: [^.]*from the left end/],
      ['brake-knees', /drill each knee leg/, /up from the bottom end/], // removable knees (the default): the holes are drilled before the dry fit
      ['rail-ends', /rail-end mortises/, /from the top edge/],
      ['rail-ends', /screw pilots/, /from the rear end \(the finished end/],
      ['seat-blocks', /latch hole/, /from the rear edge/],
      ['storage-lid', /lid frame pieces/, /from the rear end/],
      ['handle', /handlebow|{{handle-bar}}/, /from the left end/],
    ];
    for (const [id, re, want] of cases) {
      const t = sub(id, re);
      expect(t, `${id} ${re}`).toMatch(loc);
      expect(t, `${id} ${re}`).toMatch(want);
      expect(t, `${id} ${re}`).not.toMatch(/positions (are )?on the part drawing/i);
    }
  });
});

describe('readability round 2 (steps)', () => {
  const pStd = { ...defaultParams(), weatherSpec: 0 };
  const sets: Array<[string, BuildStep[]]> = [['Standard', assemblySteps(buildModel(pStd), pStd)], ['Extreme', steps]];
  const allText = (s: BuildStep): string => [s.title, s.goal, ...s.instructions, ...s.checks, ...s.tools, s.clampCure ?? ''].join('\n');

  for (const [name, list] of sets) {
    const get = (id: string) => list.find((s) => s.id === id)!;
    const text = (id: string): string => get(id).instructions.join('\n');

    it(`${name}: no decision id, decimal, param name or "passed" in any step`, () => {
      for (const s of list) {
        const t = allText(s);
        expect(t, s.id).not.toMatch(/\b[DAQ]-\d+\b/);
        expect(t, s.id).not.toMatch(/\d\.\d/);
        expect(t, s.id).not.toMatch(/\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/);
        expect(t, s.id).not.toMatch(/: passed/);
      }
    });

    it(`${name}: every clampCure is one short line`, () => {
      const withLine = list.filter((s) => s.clampCure);
      expect(withLine.length).toBeGreaterThan(12);
      for (const s of withLine) {
        expect(s.clampCure, s.id).not.toMatch(/\n/);
        expect(s.clampCure!.length, s.id).toBeLessThan(90);
      }
      if (name === 'Extreme') for (const s of withLine) expect(s.clampCure, s.id).not.toMatch(/Titebond/);
    });

    it(`${name}: the glue card is one box before the steps (not a step item), with the working times`, () => {
      const mill = get('mill');
      expect(mill.instructions.join('\n')).not.toMatch(/GLUE CARD/);
      const card = flattenInstr([glueCard(name === 'Standard' ? pStd : p)], parts).join('\n');
      // the glue card states the kit the BOM buys: U.S. Composites 635, 2 parts resin to 1 of hardener, fumed silica; nothing of the West System 105/206 5:1 kit
      expect(card).toMatch(/Epoxy \(U\.S\. Composites 635 thin epoxy, 2 parts resin to 1 part hardener by volume\)/);
      expect(card).toMatch(/Pot life is about 35-40 min/);
      expect(card).toMatch(/Clamp overnight, 12-24 h/);
      expect(card).toMatch(/full cure about 7 days/);
      expect(card).toMatch(/fumed silica/);
      expect(card).toMatch(/check the can/);
      expect(card).not.toMatch(/105|206|5:1|5 parts|\b406\b|microballoon/i);
      expect(card).toMatch(/Cold shop/);
      expect(card).toMatch(/Below 55 °F/);
      expect(/Titebond III/.test(card)).toBe(name === 'Standard');
    });

    it(`${name}: step 1 states the real allowances from the params, in fractions`, () => {
      const t = text('mill');
      expect(t).toMatch(/rounded up to 1\/8"/);
      expect(t).toMatch(/plain part is 1\/8" thicker, 1\/4" wider and 1" longer/);
      expect(t).toMatch(/3\/8" wider and 2" longer/);
      expect(t).toMatch(/4\/4 planes to 3\/4"/);
    });

    it(`${name}: step 22 quotes the latch hole and the 75° cut, not the screw pilots`, () => {
      const t = text('seat-blocks');
      expect(t).toMatch(/3\/8" hole, 1-1\/16" deep/);
      expect(t).toMatch(/tilted 15°/);
      expect(t).toMatch(/75° from level/);
      expect(t).toMatch(/Mouth: 1-17\/32" from the rear edge, 1-15\/16" from the bottom end/); // on the sloped face, where the drill enters (2026-10-24: 13 mm deck, 5 mm combi-core white oak sides as bought)
      expect(t).not.toMatch(/1\/8" blind|29\/32" deep/);
    });

    it(`${name}: features with several positions give every one`, () => {
      expect(text('rear-beam')).toMatch(/Clamp-plate bolts, both ends:[^\n]*1-1\/4" and 26-1\/4" from the left end/); // D-88: the rear plates 1/4" in from the beam ends, as the front outer plates // D-83: 2 in wide plates, so the bolt rows sit a little further out
      expect(text('rear-beam')).toMatch(/Hold-down bolts, both ends:[^\n]*4-3\/16" and 23-5\/16" from the left end/);
      const fb = text('front-beam');
      expect(fb).toMatch(/Clamp-plate bolts, 4 plates:[^\n]*1-1\/4", 6-3\/4", 20-3\/4" and 26-1\/4" from the left end/);
      expect(fb).toMatch(/Eye-bolt holes[^\n]*5-3\/4" and 21-3\/4" from the left end/);
      expect(fb).toMatch(/pilots, both pads:[^\n]*4" and 23-1\/2" from the left end/);
      expect(text('storage-lid')).toMatch(/Centers 3-1\/2", 6-7\/32" and 8-31\/32" from the rear end of the frame[^\n]*butted to them/); // (2026-10-24: D-96/97/98) unchanged on the sheets as bought; the battens butt the frame sides (no dados); D-89: the shorter lid behind the fixed strip
      expect(text('transom')).toMatch(/Both sockets: centered 9-3\/8" either side of the centerline/);
    });

    it(`${name}: the unfilled template text is gone`, () => {
      for (const s of list) {
        const t = allText(s);
        expect(t, s.id).not.toMatch(/from the parts list|in each end, in the (left|right) end|the screws on the joint list/);
      }
      expect(text('handle')).toMatch(/2 × 1\/4-20 × 1-1\/2" stainless button-head cap screws cut to 1-3\/8" per socket/);
      expect(text('hang')).toMatch(/2 × 1\/4-20 × 1-1\/2" stainless button-head cap screws cut to 1-3\/8" per socket/);
      expect(text('frame')).toMatch(/at both ends of each crossmember: 7\/8" from the bottom edge/);
    });

    it(`${name}: no buying talk in step 0, the knee holes come from positions, the mirror ramp is named`, () => {
      const v = text('verify');
      expect(v).not.toMatch(/Get the other three|mill cert/);
      expect(v).toMatch(/Verify section/);
      expect(get('verify').checks.join(' ')).not.toMatch(/passed/);
      expect(text('seal')).not.toMatch(/Extreme setting|stored outside\) uses/);
      const fr = text('frame-parts');
      expect(fr).not.toMatch(/as a template/);
      expect(fr).toMatch(/knee-bolt holes[^\n]*from the finished rear end[^\n]*from the bottom edge/);
      expect(text('sides-outer')).toMatch(/MIRROR ramp/);
      for (const s of list) expect(allText(s), s.id).not.toMatch(/same template and ramp|same ramp\b(?!:)/);
    });
  }

  it('Standard: a step with no Titebond joint says nothing about Titebond, and the card names the Titebond steps', () => {
    const std = sets[0][1];
    expect(std.find((s) => s.id === 'rails')!.clampCure).not.toMatch(/Titebond/);
    expect(std.find((s) => s.id === 'sides-inner')!.clampCure).not.toMatch(/Titebond/);
    expect(std.find((s) => s.id === 'hangers')!.clampCure).toMatch(/Titebond III/);
    expect(std.find((s) => s.id === 'frame')!.clampCure).toMatch(/Titebond III[^\n]*epoxy/);
  });
});

describe('build readability round 3: one recipe for the knee, one set of numbers for the side web, nothing pointing at the wrong place', () => {
  const cl = cutList(parts, p);
  const stepText = (id: string): string => steps.find((s) => s.id === id)!.instructions.join('\n');
  const all = steps.map((s) => s.instructions.join('\n')).join('\n');

  it('step 1 gives the full cross-lamination recipe for the knee, off the cut list', () => {
    const mill = stepText('mill');
    const g = cl.glueUps.find((q) => q.ids.includes('brake-knee-L'))!;
    expect(mill).toMatch(/Brake knee, left and brake knee, right: cross-laminated, like plywood/);
    expect(mill).toMatch(/grain upright \/ across the sled \/ upright/);
    expect(mill).toMatch(/Layers 1 and 3 \(grain upright\): ONE piece, 4-1\/8" wide across its grain \u00d7 11-5\/8" long/);
    expect(mill).toMatch(/Layer 2 \(grain across the sled\): edge-glue 2 boards first, 5-5\/8" and 4-3\/4" wide \u00d7 5-3\/4" long/);
    expect(mill).toMatch(/Only the center layer is edge-glued: its joint is 5-1\/4" up from the bottom edge of the finished knee, clear of the bolt holes/);
    expect(mill).toContain(`Mill the cured block to ${g.finalText.replace(/ across$/, ' across the sled').replace(/ \u00d7 /g, ', ')}`);
    // the layer sizes are the cut list's, not computed here
    for (const c of cl.cuts.filter((q) => q.piece === 'layer' && q.ids.includes('brake-knee-L'))) {
      expect(mill).toContain(`${roughFrac(c.rough.l)} long`);
    }
    // the knee is not also listed as a plain edge-glued panel, and no step says its layers are each edge-glued
    expect(mill).not.toMatch(/Brake knee, left and brake knee, right: 2 boards across/);
    expect(all).not.toMatch(/each layer edge-glued from boards/);
  });

  it('D-77: step 1 cuts the pocket as a notch in the rear and center layers before the glue-up, and says where', () => {
    const mill = stepText('mill');
    expect(mill).toMatch(/Cut the flap pocket in the rear layer \(layer 1\) and the center layer \(layer 2\) BEFORE the glue-up: a notch 1-3\/8" deep in from the outboard edge, 7" to 8-13\/16" up from the bottom edge of the finished knee/); // (2026-10-24: 13 mm deck, 5 mm combi-core white oak sides as bought) // 6-31\/32" is a layout number: said to 1\/16"
    expect(mill).toMatch(/Leave the front layer whole: the pocket is recessed about 1\/4" into it after the glue-up/);
    expect(mill).not.toMatch(/outboard ear|two ears/);
  });

  it('D-77: the knee step is 9-9/16" tall, recesses the pocket into the front layer, and has no slot or ears', () => {
    const knees = stepText('brake-knees');
    expect(knees).toMatch(/The knee is 9-9\/16" tall/); // (2026-10-24: 13 mm deck, 5 mm combi-core white oak sides as bought)
    expect(knees).toMatch(/Recess the pocket about 1\/4" into the front layer, so it ends 1-21\/32" from the rear face/);
    expect(knees).toMatch(/the grain of the rear and front layers runs up the leg, and the center layer runs across the sled/);
    expect(knees).toMatch(/drilled with the stainless strap on and the flap tongue clamped in the pocket/);
    expect(knees).not.toMatch(/\bslot|\bears?\b/);
  });

  it('D-77: the flap step cuts, deburrs and drills the strap, screws it on with 1/8" pilots, then drills the pin hole through it with the tongue clamped in the pocket', () => {
    const t = stepText('brake-flaps');
    expect(t).toMatch(/Make the two pivot straps: brake pivot strap L and brake pivot strap R/);
    expect(t).toMatch(/cut 3-5\/16" long on the metal bandsaw and deburred/);
    expect(t).toMatch(/4 holes \u00d83\/16"[^\n]*11\/32" and 1-11\/16" from the rear edge/);
    expect(t).toMatch(/then the pin hole, \u00d813\/32"/);
    expect(t).toMatch(/Each strap takes 4 \u00d7 #8 \u00d7 1-1\/4" stainless pan-head wood screws: 2 in the roof above the pocket and 2 in the floor under it/);
    expect(t).toMatch(/drill 1\/8" pilots 1-3\/16" deep/);
    expect(t).toMatch(/clamp the tongue and block in the knee's pocket with the mark centered in the strap's hole, and drill the pin hole in one pass with one 13\/32" bit: through the strap's hole, the block and the tongue, and 1" blind into the inboard wall of the pocket/);
    expect(t).toMatch(/hitch-pin clip in its cross hole, outboard of the strap/);
    expect(t).toMatch(/clip off \(it sits outboard of the strap\)/);
    expect(steps.find((s) => s.id === 'brake-flaps')!.partIds).toEqual(expect.arrayContaining(['brake-strap-L', 'brake-strap-R']));
    expect(stepText('hang')).toMatch(/pivot pin through the strap in double shear, hitch-pin clip outboard of the strap/);
  });

  it('D-77: no step asks for more than cut, deburr and drill on metal (no filing, tapping, bending, welding or countersinking of it)', () => {
    expect(all).not.toMatch(/hacksaw|file the corners|drill and tap|\btapped\b|\bweld/i);
    expect(stepText('brake-knees')).toMatch(/nylock nuts sit on the stainless backing plates/);
    expect(all).toMatch(/Cut it from 2" flat bar on the metal bandsaw and deburr the cut edges/);
  });

  it('step 15 refers back to step 1 instead of gluing the knee again', () => {
    const knees = stepText('brake-knees');
    expect(knees).toMatch(/laminated in step 1/);
    expect(knees).not.toMatch(/Glue up each knee block/i);
    expect(knees).not.toMatch(/Epoxy the three layers/);
    expect(knees).not.toMatch(/edge-glued first/);
    // the bandsaw-blank line in step 1 points at the recipe too
    expect(stepText('mill')).toMatch(/Brake knee, left and brake knee, right: cross-laminated, like plywood/);
    expect(stepText('mill')).not.toMatch(/cross-laminated block \(glued above\), milled to/);
    expect(stepText('mill')).not.toMatch(/laminated block, 3 layers: 3 \u00d7 3\/4" from 4\/4, glue up, then mill the block to 2-1\/8"\.\n[^\n]*Brake shoe/);
  });

  it('step 2 has a single layer count for the rail form, and it is the form\'s own', () => {
    const shaper = stepText('rail-form');
    const counts = [...shaper.matchAll(/(\d+) layers? of 3\/4" MDF/g)].map((m) => m[1]);
    expect(new Set(counts).size).toBe(1);
    expect(shaper).toMatch(/stack of 5 layers of 3\/4" MDF, 3-3\/4" tall/);
    expect(shaper).not.toMatch(/4 layers of 3\/4" MDF/);
    const railForm = formDrawings(parts, p).find((d) => d.id === 'rail-form')!;
    expect(railForm.build.map((b) => b.step).join(' ')).toMatch(/5 layers of 3\/4" MDF/);
  });

  it('quotes the side web blank and net length from the cut list, the same in the steps, the cut list and the plywood table', () => {
    const row = cl.sheets.flatMap((g) => g.rows).find((r) => r.ids.includes('side-L-web'))!;
    const blank = roughFrac(row.stock.l), net = finalFrac(row.final.l);
    expect(blank).toBe('59-5/8"');
    expect(net).toBe('59-1/2"');
    const shaper = stepText('side-forms');
    expect(shaper).toContain(`Nest the ${blank} blank on the sheet`);
    expect(shaper).toContain(`file: ${net} long`);
    expect(row.note).toContain(`cuts it to ${net}`);
    expect(row.note).toContain(`start from a ${blank} blank`);
    // the plywood table's final length is the Shaper net length, and it is the flat development's
    expect(row.final.l).toBeCloseTo(Math.max(flatPattern(parts.find((x) => x.id === 'side-L-web')!)!.widthIn, flatPattern(parts.find((x) => x.id === 'side-L-web')!)!.heightIn), 9);
    expect(cl.csv.sheets).toContain('59-1/2');
    expect(cl.csv.sheets).not.toContain('59-19/32');
    expect(stepText('dry-fit')).not.toContain('59-19/32');
  });

  it('never calls the form\'s mirror ramp "step 5"; the forms use their own item numbers', () => {
    const forms = formDrawings(parts, p);
    const formText = forms.flatMap((d) => [...d.notes, ...d.build.flatMap((b) => [b.step, ...(b.sub ?? [])])]).join('\n');
    expect(formText).not.toMatch(/\(step 5\)/);
    expect(formText).toContain('(the MIRROR RAMP item below)');
    const side = forms.find((d) => d.id === 'side-form')!;
    expect(side.build[3].step).toMatch(/^MIRROR RAMP/); // item 4 of the side form really is the mirror ramp (the cleats follow both ramps)
    expect(side.build[4].step).toMatch(/^CLEATS/);
    expect(all).not.toMatch(/mirror ramp \(step 5\)/i);
  });

  it('step 6 puts the plate recess under the brake knee backers; the seat-hinge backers go on only after the deck is located on the dry frame', () => {
    const parts0 = stepText('frame-parts').split('\n'); // the backers and plates are the day-before step
    const recess = parts0.findIndex((l) => /cut the plate recess/.test(l));
    const brake = parts0.findIndex((l) => /prepare the brake knee backers and glue them/.test(l));
    const lines = stepText('frame').split('\n');
    const dry = lines.findIndex((l) => /Dry-fit the rails/.test(l));
    const deck = lines.findIndex((l) => /lay the .* on the dry frame and check the frame against it/.test(l));
    const hinge = lines.findIndex((l) => /glue the seat-hinge backers/.test(l));
    expect(recess).toBeGreaterThan(brake);
    expect(parts0[recess]).toMatch(/inboard face of each brake knee backer/);
    expect(deck).toBeGreaterThan(dry);
    expect(hinge).toBeGreaterThan(deck);
    expect(lines.slice(hinge).join('\n')).toMatch(/line of the rear face of .* marked at the dry fit/);
    // the deck check: its ends on the rails' finished-end marks, its edge set in from the rails' outer faces, the rail spacing and diagonals (numbers from the model)
    const t = lines.slice(deck, hinge).join('\n');
    expect(t).toMatch(/rear edge stands 1\/4" behind the finished-end marks on both rails/);
    expect(t).toMatch(/deck edge sits in from the rail's outer face by 15\/32" at every station/); // (2026-10-24: 13 mm deck, 5 mm combi-core white oak sides as bought)
    expect(t).toMatch(/Rail spacing over the outer faces: 24" at the finished rear ends and 18-1\/2" at the bow-end marks/);
    expect(t).toMatch(/Diagonals from the finished-end marks equal within 1\/16"/);
    expect(t).toMatch(/Never trim the deck/);
    expect(stepText('frame')).toMatch(/Set the deck down on its ticks from the dry fit/);
  });

  it('prints a brake-knee template that the steps ask for and the forms have', () => {
    expect(stepText('brake-knees')).toMatch(/knee router template \(Forms section\)/);
    const t = formDrawings(parts, p).find((d) => d.id === 'brake-knee-template')!;
    expect(t).toBeTruthy();
    expect(t.title).toMatch(/Brake knee router template/);
  });
});

describe('D-76: side ribs, knees and box ties (tie-down bases)', () => {
  const pStd = { ...defaultParams(), weatherSpec: 0 };
  const pStdOrExt = (name: string) => (name === 'Standard' ? pStd : p);
  const sets: Array<[string, BuildStep[]]> = [['Standard', assemblySteps(buildModel(pStd), pStd)], ['Extreme', steps]];
  const txt = (s: BuildStep | undefined): string => (s ? [s.title, s.goal, ...s.instructions, ...s.checks, s.clampCure ?? ''].join('\n') : '');
  for (const [name, list] of sets) {
    const get = (id: string) => list.find((s) => s.id === id)!;
    it(`${name}: the ribs go in after the tongue and before the storage box, with every rib, knee and tie installed once`, () => {
      const ids = list.map((s) => s.id);
      expect(ids.indexOf('side-ribs')).toBeGreaterThan(ids.indexOf('flip'));
      expect(ids.indexOf('side-ribs')).toBeLessThan(ids.indexOf('storage-box'));
      const mine = get('side-ribs').partIds;
      expect(mine.filter((i) => /^side-rib-[LR]\d$/.test(i)).length).toBe(8);
      expect(mine.filter((i) => /^side-rib-knee-/.test(i)).length).toBe(4);
      expect(get('storage-box').partIds.filter((i) => /^box-tie-/.test(i)).length).toBe(4);
      expect(ids).not.toContain('step-5'); // no generated fallback step for them
    });
    it(`${name}: the rib step gives stations from the transom, the filler, the knee screws and the counterbores`, () => {
      const t = txt(get('side-ribs'));
      expect(t).toMatch(/band-strip filler to the web/);
      expect(t).toMatch(/Epoxy each rib to the inner bands and its filler/);
      // the stations come from the model (the mid rib stands forward of its crossmember where the side is turned in)
      const L = computeLayout(pStdOrExt(name));
      const at = sideRibStations(pStdOrExt(name), L).map((st) => finalFrac(Math.round((st.x - L.xRear) * 8) / 8));
      expect(t).toContain(`rear rib ${at[3]}, box rib ${at[0]}, mid rib ${at[1]} and bow post ${at[2]}`);
      expect(t).toMatch(/2 stainless #8 × 2-1\/2" screws/); // D-82: every wood screw is a #8
      expect(t).toMatch(/11\/16" and 1-13\/32" from the outboard edge/);
      expect(t).toMatch(/Counterbore each from the sloped face first, 3\/8" wide, leaving 1\/2" of oak/);
      // the knee is drilled on the drill press first, then dry-placed by the screw pilots, then glued and screwed (never driven before the holes exist)
      const order = ['Drill each rib knee first, on the drill press', 'Dry-place each knee by the screw pilots, then open the deck pilots', 'Glue each knee to its rib and the deck, then drive the screws'].map((x) => t.indexOf(x));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      // each knee is centered on its rib shaft and set by the pilots in the deck; its member's centerline is the model's
      const ppp = pStdOrExt(name), msr = buildModel(ppp);
      expect(t).toMatch(/Each knee is centered on its rib shaft, square to the side, and the two pilots in the deck set it/);
      for (const [member, label] of [['joist-5', 'crossmember 5'], ['king-beam', 'the king beam']] as const) {
        const b = worldAABB(msr.find((x) => x.id === member)!);
        const mid = Math.round(((b.min[0] + b.max[0]) / 2 - computeLayout(ppp).xRear) * 8) / 8;
        expect(t).toContain(`Its screws land on the centerline of ${label}, ${finalFrac(mid)} from the transom`);
      }
      expect(t).not.toMatch(/rear face of each knee|behind the rib's center/);
      expect(t).toMatch(/Open each pilot in the deck from the deck top to 11\/64", with a depth stop at the deck's thickness[^\n]*the pilot guides the bit/);
      expect(t).toMatch(/shaft centered [\d\-/]+" from the transom, [\d\-/]+" ahead of the pair of screw pilots in the deck \(step \d+\)/);
      expect(t).toMatch(/shaft centered [\d\-/]+" from the transom, in line with the screw pilots in the deck/);
      expect(t).not.toMatch(/locator|centerline [\d\-/]+" from the transom/);
      expect(t).not.toMatch(/Drive them while the epoxy is wet/);
      expect(t).not.toMatch(/\bjoist\b/i);
      expect(t).toMatch(/the tail of a band strip \(each strip comes off its board about [\d\-/]+" longer than it needs: leave the tail on until the strip is planed[^;]*; the same thickness as the bands/); // the spares stay for the bend test
      // the filler lengths are the cut list's, rounded up to 1/8" the way its rough sizes are
      const fl = ribFillers(msr, ppp);
      expect(t).toContain(`about ${roughFrac(fl[1].lengthIn)} at the mid rib, about ${roughFrac(fl[2].lengthIn)} at the bow post and about ${roughFrac(fl[3].lengthIn)} at the rear rib`);
      expect(t).toMatch(/sit a booted rider in the bare hull and confirm the bow-post station/);
      expect(t).not.toMatch(/\d\.\d{2,}/);
      expect(t).not.toMatch(/doubler/i);
      expect(get('side-ribs').clampCure).toMatch(/epoxy|Epoxy/); // the ribs are epoxy under both weather specs
    });
    it(`${name}: the box tie is glued at the box install, never to the lid frame; the D-ring brackets are bolted at the final fit with the bracket as the template`, () => {
      const box = txt(get('storage-box'));
      expect(box).toMatch(/box tie between each box or rear rib and the box side/);
      expect(box).toMatch(/Its top stands 1\/8" below the top of the plywood wall, clear of the coaming/);
      // D-ring and grab-board holes are drilled at the rib step, before any finish, with the bracket as the template and a scrap block outside; the final fit only bolts
      const rib = txt(get('side-holes'));
      expect(get('side-holes').title).toBe('Drill the D-ring holes and fit the grab boards (before the finish)');
      expect(txt(get('side-ribs'))).not.toMatch(/Grab boards:|scrap block/);
      expect(list.map((q) => q.id).indexOf('side-holes')).toBe(list.map((q) => q.id).indexOf('side-ribs') + 1);
      expect(rib).toMatch(/Hold each bracket on the inner face of its rib head[^\n]*The bracket is the template/);
      expect(rib).toMatch(/through the bracket, the head, the inner band, the web and the outer band in one pass/);
      expect(rib).toMatch(/scrap block on the outside of the side behind the holes, to stop tear-out/);
      expect(rib).toMatch(/Brush epoxy into each hole[^\n]*run the bit through again/);
      // the board's own holes (cut with it on the Shaper) are the template: the side is drilled through them, the board never again; the reach check comes first
      expect(rib).toMatch(/reach check[\s\S]*Cut the two grab boards and their oak caps on the Shaper[\s\S]*Drill the stainless strips on the drill press[\s\S]*Drill the side through each board's own holes[\s\S]*Drill dry from the inside through them, the inner band, the web and the outer band[\s\S]*Do not drill the board again/);
      // the sign: knob holes through the web and inserts in the ribs, the sign as the template, before the finish; the final fit only hangs it
      expect(rib).toMatch(/Sign knob holes and inserts: 4 a side, through the web into the rib behind it, with the sign as the drill template/);
      expect(rib).toMatch(/Rib shaft centers, from the transom's outer face, on both sides: 4-1\/2" \(the rear rib\) and 13" \(the box rib\) \(the stations they were set at\), within 1\/8"/); // to each rib's center, at the side-rib step's 1/8" stations
      expect(rib).toMatch(/Bore each spot 5\/16", square to the side, 13\/16" deep from the web's outer face/); // the web, the 33/64" flush insert (signInsertLenIn) and 1/16" (2026-10-24: 13 mm deck, 5 mm combi-core white oak sides as bought)
      expect(rib).toMatch(/#10-32 × 33\/64" [^\n]*threaded insert on epoxy/);
      expect(rib).toMatch(/Then the 8 oak standoff discs, one per hole/);
      expect(txt(get('final-fit'))).toMatch(/Through the 7\/32" holes, the standoff discs \(epoxied to the sign back\) and the web, into the inserts set at step \d+/);
      const fit = txt(get('final-fit'));
      expect(fit).not.toMatch(/Drill all \d holes|drill all the layers/i);
      expect(fit).toContain(`drilled at step ${list.map((q) => q.id).indexOf('side-holes')}, before the finish`);
      expect(fit).toMatch(/two 1\/4-20 × 2" (?:stainless )?button-head bolts each, pushed in from OUTSIDE with a 3\/4" fender washer/);
      expect(fit).toMatch(/Nylock nuts on the bracket/);
      expect(rib).toMatch(/Check its two holes first \(Verify\)/);
      expect(fit).toContain(`${p.lashLoadLbf} lbf pull at ${p.lashPullAngleDeg}°`);
      // a 1/4-20 bolt of 2" stock needs about 1-15/16": no cutting
      expect(fit).not.toMatch(/Run a nut on each bolt, cut it|rotary tool|cutoff wheel/);
      expect(fit).not.toMatch(/doubler/i);
      expect(list.map((s) => s.id)).not.toContain('wood-fitout-doublers');
    });
  }
});

describe('D-79..D-83: the cost-pass build text', () => {
  const pStd = { ...defaultParams(), weatherSpec: 0 };
  const partsStd = buildModel(pStd);
  const std = assemblySteps(partsStd, pStd);
  const ext = steps;
  const stepText = (list: BuildStep[], id: string): string => list.find((s) => s.id === id)!.instructions.join('\n');
  const everything = (list: BuildStep[]): string => list.flatMap((s) => [s.title, s.goal, ...s.instructions, ...s.checks, ...s.tools, s.clampCure ?? '']).join('\n');

  it('Standard: the drain holes are drilled and sealed (sides and box floor), at located centers; Extreme still fits the nipples', () => {
    const outer = stepText(std, 'sides-outer');
    // the web's Shaper file cuts the drain holes in the web: they guide the bit through the inner band before cure 2, then through the outer band after it; no second hole in the web
    expect(outer).toMatch(/Before the web goes on the mirror ramp: drill the inner band through the web's own drain holes \(3\/8", made with the web\)/);
    expect(outer).toMatch(/Drill the drain holes on through the outer band once the cure is hard: 2 in each side, 3\/8", from the inside, through the holes already in the web and the inner band/);
    // ONE datum: the inner face of the rear transom (the web end sits 1/4" inside the transom dado), the same as the band drawing
    expect(outer).toMatch(/3\/8" and 58" forward of the transom line \(a square line 1\/4" in from the rear end of the web\), 3\/4" up from the web's bottom edge/); // the numbers of the band and web drawings (2026-10-24: 13 mm deck, 5 mm combi-core white oak sides as bought)
    expect(outer).toMatch(/backer block on the outside of the outer band/);
    expect(outer).not.toMatch(/Drill the drain holes once the cure is hard/);
    expect(outer).toMatch(/Brush epoxy into each bore/);
    expect(outer).not.toMatch(/nipple|scupper/i);
    // the box drains are drilled and sealed with the hull inverted (with the stop-block pilots), and the underside finish step checks them; the box step only fairs the floor
    const gear = stepText(std, 'under-holes');
    // the deck's Shaper file cuts the box drains: the last-holes step only checks and seals them, it never drills a second hole
    expect(gear).toMatch(/Seal the 2 box drain holes with the hull still inverted\. They came with the deck \(its Shaper file\): do not drill them again/);
    expect(gear).not.toMatch(/Drill the 2 box drain holes/);
    expect(gear).toMatch(/storage box's rear corners will be [^\n]*forward of the transom's outer face, [^\n]*either side of the centerline/);
    expect(gear).toMatch(/Tape the top-face mouth, brush epoxy up each bore/);
    expect(std.find((s) => s.id === 'under-holes')!.checks.join(' ')).toMatch(/box drain holes sealed and open/); // cut with the deck's file: not drilled again
    expect(std.find((s) => s.id === 'finish-under')!.checks.join(' ')).toMatch(/box drain holes are open and their bores sealed/);
    expect(stepText(std, 'finish-under')).toMatch(/Keep the drain holes open/);
    const box = stepText(std, 'storage-box');
    expect(box).not.toMatch(/drill the 2 box drain holes/i);
    expect(box).toMatch(/keep the holes open/);
    expect(std.findIndex((s) => s.id === 'gear-fit')).toBeLessThan(std.findIndex((s) => s.id === 'storage-box'));
    expect(box).not.toMatch(/nipple|microballoon/);
    expect(stepText(std, 'final-fit')).not.toMatch(/nipple/);
    expect(std.find((s) => s.id === 'sides-outer')!.title).toBe('Side sandwiches, cure 2: outer bands and drain holes');
    // Extreme: scuppers with stainless nipples, in the sides and the box
    expect(stepText(ext, 'sides-outer')).toMatch(/Drill the scuppers: 4 holes, 3\/8", through inner band, web and outer band/);
    expect(stepText(ext, 'sides-outer')).toMatch(/bed the stainless nipples/);
    expect(stepText(ext, 'final-fit')).toMatch(/Aft drain nipples, epoxied in/);
    expect(ext.find((s) => s.id === 'sides-outer')!.title).toMatch(/outer bands and scuppers/);
    expect(stepText(ext, 'storage-box')).not.toMatch(/box drain holes through/);
  });

  it('D-99: the show faces are dyed by default under both specs; with no stain, Standard is clear spar urethane and every stain line says there is none', () => {
    for (const list of [std, ext]) {
      expect(list.find((s) => s.id === 'finish')!.title).toBe('Finish: dye, epoxy, lettering check, topcoat');
      expect(list.find((s) => s.id === 'finish')!.instructions.join('\n')).toMatch(/F3: Dye the show faces \(Golden Brown\)/);
      expect(stepText(list, 'finish-under')).toMatch(/dye the show faces \(finishing step F3\): the outside of the sides, the transom and the bulkhead/);
    }
    expect(stepText(std, 'seal')).not.toMatch(/Finishing, steps 3-4/);
    expect(stepText(std, 'seal')).toMatch(/No dye here: the deck underside is hidden and plywood edges take no dye/);
    expect(stepText(ext, 'seal')).toMatch(/Finishing, steps 3-4/);
    // the clear option: no dye anywhere, and every line that mentions a stain says there is none
    for (const spec of [0, 1]) {
      const pc = { ...defaultParams(), weatherSpec: spec, stainShowFaces: 0 };
      const clear = assemblySteps(buildModel(pc), pc);
      const t = everything(clear);
      expect(t).not.toMatch(/\bdye(?:d|ing)?\b(?! under epoxy)/i);
      for (const line of [...t.matchAll(/[^\n]*\bstain(?:ed|ing)?\b[^\n]*/gi)].map((m) => m[0])) expect(line, line).toMatch(/no stain|No stain|stain-free/i);
      expect(clear.find((s) => s.id === 'finish')!.title).toBe('Finish: epoxy, lettering check, topcoat');
      expect(clear.find((s) => s.id === 'finish')!.instructions.join('\n')).toMatch(/F3: Raise the grain \(no stain\)/);
      expect(stepText(clear, 'finish-under')).toMatch(/raise the grain once/);
    }
  });

  it('D-99: every step that first seals or coats a show face says to dye it first, and no step dyes a glue face', () => {
    const fin = finishingSchedule(partsStd, pStd);
    const F = fin.steps.find((s) => s.id === 'stain')!.n;
    expect(fin.steps.find((s) => s.id === 'stain')!.title).toBe('Dye the show faces (Golden Brown)');
    for (const list of [std, ext]) {
      const tx = (id: string): string => stepText(list, id);
      // the early seals and coats of show faces, each with its dye-first line
      expect(tx('ends'), 'ends').toMatch(new RegExp(`Dye the edges that show first \\(Golden Brown, finishing step F${F}\\); keep it off the dados, the mortises and the faces that glue to the hull`));
      expect(tx('finish-under'), 'finish-under').toMatch(/dye the show faces \(finishing step F3\)/);
      expect(tx('storage-lid'), 'storage strip').toMatch(/Dye its top and front face first \(Golden Brown, finishing step F3\); keep it off the underside, the groove and the end blocks \(glue faces\)/);
      expect(tx('storage-lid'), 'lid panel').toMatch(/Once the lettering is sanded flush, dye the top face \(Golden Brown, finishing step F3\); keep it off the tongue all round and the underside \(glue faces\)/);
      expect(tx('seat-back'), 'seat-back banding').toMatch(/Dye the banding first \(Golden Brown, finishing step F3\); keep it off the back face where the oak pads glue/);
      expect(tx('brake-flaps'), 'flaps').toMatch(/Dye each flap and shoe first \(Golden Brown, finishing step F3\); keep it off the tread's patch on the flap and the pad's seat on the shoe \(glue faces\)/);
      expect(tx('finish'), 'finish').toMatch(/Show faces: dye first \(finishing step F3\)/);
      // the dye line comes before the seal or coat it protects, in the same item
      for (const id of ['storage-lid', 'seat-back', 'brake-flaps', 'ends']) {
        const st = list.find((s) => s.id === id)!;
        const item = st.items.find((x) => (x.sub ?? []).some((q) => /^(Dye|Once the lettering is sanded flush, dye) /.test(q.text)));
        expect(item, id).toBeDefined();
        expect(item!.text + (item!.sub ?? []).map((q) => q.text).join(' '), id).toMatch(/seal/i);
      }
      // the steps that seal only hidden faces, bores or edges say nothing about dyeing them
      for (const id of ['seal']) expect(tx(id), id).not.toMatch(/^(?:– )*Dye /m);
      // no step dyes a glue face: every "dye ..." instruction names the glue faces it stays off, and none tells you to dye a dado, mortise, tenon or glue face
      for (const s of list) {
        for (const line of s.instructions) {
          if (!/\bdye (?:the|its|each)\b/i.test(line) || /\bdye the show faces\b/i.test(line) || /^(?:– )*Show faces: dye first/.test(line)) continue;
          expect(line, `${s.id}: ${line}`).toMatch(/keep it off/);
          expect(line.split('keep it off')[0], `${s.id}: ${line}`).not.toMatch(/dado|mortise|tenon|glue face|underside/i);
        }
      }
      // squeeze-out: cured epoxy blocks the dye (the glue card and the seal step, and the big glue-ups)
      expect(tx('seal')).toMatch(/cured epoxy blocks the dye/);
      expect(tx('sides-outer')).toMatch(/wipe the squeeze-out off the web and the bands before it kicks, or the dye will not take there/);
      expect(tx('transom')).toMatch(/the dye will not take over cured epoxy/);
    }
    expect(flattenInstr([glueCard(pStd)], partsStd).join(' ')).toMatch(/cured epoxy blocks the dye.*Dye never goes on a glue face/);
  });

  it('the Finishing step numbers cited by the seal and finish steps are the finishing schedule\'s own', () => {
    const sched = finishingSchedule(buildModel({ ...p }), p);
    const n = (id: string): number => sched.steps.find((q) => q.id === id)!.n;
    expect(stepText(ext, 'seal')).toContain(`Finishing, steps ${n('stain')}-${n('epoxy')}`);
    expect(stepText(ext, 'storage-lid')).toMatch(/finishing schedule only checks the lettering's fill \(step 5\)/);
    expect(n('engrave')).toBe(5);
  });

  it('D-89: the lid is hinged on a fixed strip, opens past upright onto the seat back, and has no stay under either spec', () => {
    for (const steps of [std, ext]) {
      const lid = stepText(steps, 'storage-lid');
      expect(lid).toMatch(/Cut the storage box fixed strip from one oak board, to the box's width as you measured it/);
      expect(lid).toMatch(/lying flat on top across the joint between the strip and the lid/);
      expect(lid).toMatch(/With the seat back upright, the lid opens past upright and rests on it\. With the back flipped flat, it folds right over and lies open on the strip, on two rubber bumpers/);
      expect(stepText(steps, 'final-fit')).toMatch(/Lid bumpers \(.*\): two 1\/2" self-stick rubber bumpers, 1\/8" tall, on the strip top/);
      expect(lid).toMatch(/rests on the upright seat back at about (9[5-9]|100)°/);
      expect(`${lid} ${stepText(steps, 'final-fit')} ${stepText(steps, 'storage-box')}`).not.toMatch(/lid support|friction stay|hinge backer/i);
    }
    expect(partsStd.some((x) => x.id === 'storage-lid-stay')).toBe(false);
    expect(parts.some((x) => x.id === 'storage-lid-stay')).toBe(false);
  });

  it('the seat pads: three EVA kneeling pads (cushion = one pad + a strip, back pad = the third), no vinyl cover, hook-and-loop strips located, no Dual Lock', () => {
    const seat = stepText(std, 'seat-back');
    expect(seat).toMatch(/Make the seat cushion and the back pad from three 11" × 18" × 1-1\/2" EVA kneeling pads/);
    expect(seat).toMatch(/Make the seat cushion, 14-1\/8" × 18", from two pads/);
    expect(seat).toMatch(/Use one whole pad, and cut a 3-1\/4" wide strip, the full 18" long, from the second pad/);
    expect(seat).toMatch(/contact cement/);
    expect(seat).toMatch(/Make the seat back pad from the third pad/);
    expect(seat).toMatch(/no cover and no finish/);
    expect(seat).toMatch(/Mark where the hook-and-loop strips go/);
    expect(seat).toMatch(/Cushion: two strips of 2" wide industrial hook-and-loop, each 12" long, running front to back, 4" in from each side edge/);
    expect(seat).toMatch(/forward of the transom's outer face/);
    expect(seat).toMatch(/Back pad: two strips, each 2" wide/);
    expect(stepText(std, 'hang')).toMatch(/hook-and-loop strips/);
    for (const list of [std, ext]) expect(everything(list)).not.toMatch(/Dual Lock|vinyl|Velcro/i);
  });

  it('the D-rings are bolt-on brackets on two 1/4-20 button-head bolts, drilled with the bracket as the template, with the real bracket checked first', () => {
    const fit = stepText(std, 'final-fit');
    expect(fit).toMatch(/Bolt on the D-rings:/);
    expect(stepText(std, 'side-holes')).toMatch(/they should be 1-1\/4" apart along the gunwale; if yours differ, drill to the bracket/);
    expect(fit).not.toMatch(/#8-32|machine screw/);
    expect(stepText(std, 'side-ribs')).toMatch(/The D-ring holes are drilled in the next step/);
    expect(std.find((s) => s.id === 'final-fit')!.goal).toMatch(/D-rings/);
  });

  it('Standard beds the handle sockets in thickened epoxy (Extreme: epoxy or polysulfide sealant)', () => {
    expect(stepText(std, 'hang')).toMatch(/Handle: 2 sockets bedded in thickened epoxy on the transom/);
    expect(stepText(std, 'handle')).toMatch(/At the hang step: the socket bedded on the transom in thickened epoxy,/);
    expect(stepText(std, 'handle') + stepText(std, 'hang')).not.toMatch(/polysulfide|sealant/i); // the grab-board backing strips keep their own bedding line
    expect(std.find((s) => s.id === 'hang')!.clampCure).not.toMatch(/Sealant/);
    expect(stepText(ext, 'hang')).toMatch(/bedded in epoxy or polysulfide sealant/);
  });

  it('cuts the clamp plates from the 1/4" × 2" bar: 2-1/4" lengths, six in all', () => {
    for (const list of [std, ext]) {
      const t = stepText(list, 'rear-beam');
      expect(t).toMatch(/Cut the clamp plates: 6 plates in all \(2 here, 4 on the front beam\)/);
      expect(t).toMatch(/Each is 2-1\/4" of [^\n]*flat bar 1\/4" x 2", cut on the metal bandsaw and deburred on every edge/);
    }
  });

  it('every part the cut list face-laminates is named in the glue-up item of the mill step (D-95: 8/4 is bought, so only the 2-1/8" parts are laminated)', () => {
    for (const [pp, list] of [[pStd, std], [p, ext]] as const) {
      const cl = cutList(buildModel(pp), pp);
      const mill = stepText(list, 'mill');
      const lam = cl.glueUps.filter((g) => g.kind !== 'edge');
      expect(lam.length).toBeGreaterThanOrEqual(3); // the axle beams (rear and front), the knee block and the chock block
      const m = buildModel(pp);
      for (const g of lam) for (const id of g.ids) {
        const name = m.find((x) => x.id === id)!.name;
        expect(mill.toLowerCase(), `${id} (${name})`).toContain(name.replace(/\s*\(.*\)\s*$/, '').toLowerCase().replace(/^./, (c) => c));
      }
      // the parts thicker than 8/4 finishes to are among them, and the board-yield line only offers what is bought
      for (const id of ['beam-R', 'beam-F', 'brake-chock-L', 'brake-knee-L']) expect(lam.some((g) => g.ids.includes(id)), id).toBe(true);
      expect(mill).toMatch(/4\/4 planes to 3\/4", 5\/4 to 1", 8\/4 to 1-3\/4"\./);
      expect(mill).not.toMatch(/6\/4 to/);
      expect(mill).toMatch(/The lumber list has 4\/4, 5\/4 and 8\/4 white oak/);
      expect(mill).toMatch(/Mill the cured block to its final size \(joint one face, plane to thickness\)/);
      expect(mill).toMatch(/plenty of clamps/);
    }
  });

  it('the deck and web steps measure the real sheets before anything is cut from them; the thin sheet is named for the spec (no leftover 1/4 in white oak ply or 4 mm okoume wording)', () => {
    // the defaults (2026-10-24: 13 mm deck, 5 mm combi-core white oak sides as bought)
    for (const list of [std, ext]) expect(stepText(list, 'side-forms')).toMatch(/The web sheet \(5 mm white oak plywood\): count the plies at an edge and measure it/);
    for (const list of [std, ext]) expect(everything(list)).not.toMatch(/1\/4 in white oak ply|4 mm okoume|3 mm Baltic|6 mm Baltic|6 mm okoume/i);
    // D-80's follow-the-weather sheet on the 12 mm deck
    const fwStd = { ...pStd, thinSheetMaterial: THIN_SHEET.followWeather, deckPlyIn: 0.472, seatBackPlyIn: 0.472, seatBackThickIn: 0.472 }, fwExt = { ...fwStd, weatherSpec: 1 };
    const sFw = assemblySteps(buildModel(fwStd), fwStd), eFw = assemblySteps(buildModel(fwExt), fwExt);
    expect(stepText(sFw, 'cut-deck')).toMatch(/Before you cut: measure the 12 mm sheet/);
    expect(stepText(sFw, 'side-forms')).toMatch(/The web sheet \(6 mm Baltic birch\): count the plies at an edge and measure it/);
    expect(stepText(eFw, 'side-forms')).toMatch(/The web sheet \(6 mm okoume\): count the plies/);
    for (const list of [sFw, eFw]) expect(everything(list)).not.toMatch(/white oak ply|4 mm okoume|3 mm Baltic/i);
    expect(stepText(std, 'cut-deck')).toMatch(/Before you cut: measure the 13 mm sheet/); // the deck as bought (2026-10-24)
  });

  it('the lights: the lamp clips are fitted to the real lights (re-measured before printing)', () => {
    expect(stepText(std, 'final-fit')).toMatch(/clips must be printed to the real lights, so measure the lights first/);
  });

  it('the epoxy facts come from ONE place (the kit the BOM buys): no West System 105/206, 5:1, 406 filler, 205/209 or microballoon text in the Standard build text, both specs name the 635 kit', () => {
    const t = `${everything(std)} ${flattenInstr([glueCard(p)], parts).join(' ')}`; // the glue card is a box before the steps
    expect(t).not.toMatch(/\b105\/206\b|\b105 resin|5:1|\b406\b|\b205\b|\b209\b|\b206\b|microballoon|West System|second person/i);
    expect(t).toMatch(/U\.S\. Composites 635 thin epoxy, 2 parts resin to 1 part hardener by volume/);
    expect(t).toMatch(/fumed silica/);
    // the Extreme spec buys the same kit; its low-density filler is bought, so it may name it
    const x = `${everything(ext)} ${flattenInstr([glueCard({ ...p, weatherSpec: 1 } as Params)], parts).join(' ')}`;
    expect(x).not.toMatch(/\b105\/206\b|5:1|\b406\b|\b206\b|West System|second person/i);
    expect(x).toMatch(/U\.S\. Composites 635 thin epoxy/);
    // the finishing schedule and its buy list say the same
    for (const [pp, mm] of [[pStd, partsStd], [p, buildModel(p)]] as const) {
      const sch = finishingSchedule(mm, pp);
      const ft = sch.steps.map((q) => q.instructions.join(' ')).join(' ') + sch.assumptions.join(' ') + sch.buy.map((b) => `${b.item} ${b.note}`).join(' ');
      expect(ft).not.toMatch(/West System|\b105\b|\b206\b|5:1|\b301\b|\b303\b|\b207\b/);
      expect(ft).toMatch(/2 parts resin to 1 part hardener by volume/);
      expect(sch.buy.some((b) => b.item === EPOXY_SYSTEM.buyItem)).toBe(true);
    }
  });

  it('the rail-to-chine screws are trim-heads in 1/4" counterbores (D-91: about 3/32" of wall at the hull\'s outside), plugged with 1/4" oak plugs; the forward hole is countersunk; drilled before the bow step; one direction (straight down, hull inverted)', () => {
    const rails = stepText(std, 'rails');
    expect(rails).toMatch(/Counterbore first: holes 1 to 7, a 1\/4" brad-point or Forstner bit, 1" deep measured from the bottom edge/);
    expect(rails).not.toMatch(/3\/8" bit|5\/16" bit/);
    expect(rails).toMatch(/1\/4" oak plugs from a plug cutter on offcuts \(or a 1\/4" dowel\), glued in and trimmed flush/);
    expect(rails).toMatch(/The last \(forward\) hole has no bore/);
    expect(rails.indexOf('Drill the screw holes')).toBeLessThan(rails.indexOf('Cut the bow step'));
    const dry = stepText(std, 'rail-ends'), lower = stepText(std, 'lower');
    expect(dry).toMatch(/drill straight down into the bottom edge of the side/);
    expect(lower).toMatch(/straight down through the rail/);
    for (const list of [std, ext]) expect(everything(list)).not.toMatch(/up through the rail/);
    const rail = partsStd.find((x) => x.id === 'rail-L')!.joints!.filter((j) => j.type === 'screw' && /chine/.test(j.to));
    const deep = rail.find((j) => /counterbore the head/.test(j.size!))!;
    const bit = /\((\d+)\/(\d+)" bit\)/.exec(deep.size!)!;
    expect(Number(bit[1]) / Number(bit[2])).toBeGreaterThanOrEqual(RAIL_CHINE_HEAD_DIA_IN); // the trim head fits the bore
    expect(deep.size).toMatch(/trim-head wood screws/);
    expect(rail.find((j) => /no counterbore needed/.test(j.size!))!.size).toMatch(/trim head sink flush/);
  });

  it('the layers of an edge-glued laminate are unequal and mirrored, so the seams of neighboring layers sit at least 1-1/2" apart (bridle tongue, bow bulkhead); the edge-glue block comes before the lamination', () => {
    // D-95 makes these solid 8/4; an 8/4 that finishes to only 1" (a yard with thin stock) puts them back to layers
    const pThin = { ...pStd, boardYield84In: 1 };
    const partsThin = buildModel(pThin);
    const std = assemblySteps(partsThin, pThin);
    const cl = cutList(partsThin, pThin);
    for (const id of ['bridle-tongue', 'bow-bulkhead']) {
      const cuts = cl.cuts.filter((q) => q.piece === 'layer' && q.ids.includes(id));
      const seam = (layer: number): number => cuts.filter((q) => q.layer === layer).sort((a, b) => a.index - b.index)[0].rough.w; // the first board's width: where the seam sits from the board-1 edge
      expect(Math.abs(seam(1) - seam(2)), id).toBeGreaterThanOrEqual(1.5);
    }
    const mill = stepText(std, 'mill');
    expect(mill).toMatch(/Layer 1: boards 2-3\/8" and 4-3\/8" wide \(cut list\)[\s\S]*Layer 2: boards 4-3\/8" and 2-3\/8" wide/);
    expect(mill).toMatch(/the seams then sit at least 2" apart/);
    expect(mill.indexOf('Edge-glue the wide boards first')).toBeLessThan(mill.indexOf('Face-laminate the thick parts'));
  });

  it('the bridle tongue is shaped (straight tapers, the 1" sleeve hole 9" from the rear end, easing) before its bolt holes; the handlebow is a glued block with the glue line through its middle', () => {
    const t = stepText(std, 'tongue');
    expect(t.indexOf('Shape the bridle tongue')).toBeLessThan(t.indexOf('Drill the bridle tongue T head'));
    expect(t).toMatch(/Bandsaw the two straight tapers to the stem/);
    expect(t).toMatch(/Drill the 1" sleeve hole across the stem now[\s\S]*9" from the rear end \(1-1\/2" from the tip\)/);
    expect(t).toMatch(/Ease every edge of the stem and the tip/);
    const h = stepText(std, 'handle');
    expect(h).toMatch(/from its solid 8\/4 blank \(step 1\)/); // D-95: one board, no glue line
    expect(h).toMatch(/grain runs along the arc/);
    expect(h).not.toMatch(/one board|single board/);
  });

  it('the D-ring bolts take one fender washer a bolt (under the head), and the clamp plates are drilled with stainless advice', () => {
    const fit = stepText(std, 'final-fit');
    expect(fit).toMatch(/3\/4" fender washer under each head/);
    expect(fit).toMatch(/no washer under them \(one fender washer a bolt, under the head\)/);
    const rear = stepText(std, 'rear-beam');
    expect(rear).toMatch(/Drill stainless as in step \d+/); // the how-to is printed once, in the frame step (the knee backing plates are the first stainless drilled)
    expect(rear).toMatch(/cutting oil/);
  });

  it('the build text asks for no second person where the step can be done alone (side glue-up, closing the ends)', () => {
    for (const id of ['lower', 'transom', 'bulkhead', 'dry-fit']) for (const list of [std, ext]) expect(stepText(list, id), id).not.toMatch(/two people|second person/i);
  });
});

describe('final review fixes (steps): sizes from the model, one sequence per hole, forms that only build forms, holes before the finish', () => {
  const pStd = { ...defaultParams(), weatherSpec: 0 };
  const pRm = { ...defaultParams(), weatherSpec: 0, kneeMount: KNEE_MOUNT.removable };
  const sets: Array<[string, Params, BuildStep[]]> = [['Standard', pStd, assemblySteps(buildModel(pStd), pStd)], ['Extreme', p, steps], ['Standard removable', pRm, assemblySteps(buildModel(pRm), pRm)]];
  for (const [name, pp, list] of sets) {
    const ms = buildModel(pp);
    const get = (id: string) => list.find((q) => q.id === id)!;
    const txt = (id: string): string => get(id).instructions.join('\n');
    const at = (id: string): number => list.findIndex((q) => q.id === id);

    it(`${name}: the hold-down bolts are the model's (diameter and length from the angle's joints), the hanger holes are drilled first and bolted at the beam step`, () => {
      const hd = ms.find((x) => x.id === 'beam-hold-down-L')!;
      const len = (to: RegExp): string => /× ([\d\-/]+) /.exec(hd.joints!.find((j) => j.type === 'bolt' && to.test(j.to))!.size!)![1];
      const beam = txt('rear-beam');
      expect(beam).toContain(`1/4" × ${len(/^axle-hanger/)}" bolts through each angle's upright leg, the hanger and the rail`);
      expect(beam).toContain(`1/4" × ${len(/^beam-/)}" bolts up through the beam and each flat leg`);
      expect(beam).not.toMatch(/× 3" bolts/);
      expect(beam).toContain(`in the holes drilled at step ${at('hangers')}`);
      const hang = txt('hangers');
      expect(hang).toMatch(/Drill the 2 bolt holes through each hanger and its rail together/);
      expect(hang).toContain(`the same holes the hold-down angles use at step ${at('rear-beam')}`);
      expect(hang).not.toMatch(/Nylock|fender washers/);
      expect(get('hangers').tools).not.toContain('wrenches');
      expect(get('hangers').goal).not.toMatch(/bolt them/);
    });

    it(`${name}: the forms are built in their own steps with one release method; the rails take the clamps and the glue card's clamp time`, () => {
      const forms = [txt('rail-form'), txt('side-forms')].join('\n');
      expect(get('rail-form').kind).toBe('prep');
      expect(get('side-forms').kind).toBe('prep');
      expect(forms).toMatch(/packing tape/);
      expect(forms).not.toMatch(/paste wax|wax paper/i);
      const rails = txt('rails');
      expect(rails).toMatch(/packing tape/);
      expect(rails).toMatch(/Clamps: 10 or 11 bar or pipe clamps of 12" capacity or more: one at each of the 8 scored ticks/);
      // a bent lamination stays on the form for the top of the glue card's clamp time (24 h at 60 °F or warmer), not the flat glue-up clamp time
      expect(rails).toMatch(/Leave each rail clamped for 24 h at 70 °F, 36 h at 60 °F[^\n]*before it comes off the form/); // round 3: the 60 °F time agrees with the glue card's temperature factor
      expect(rails).not.toMatch(/Leave it clamped|wax paper/);
      expect(txt('side-forms')).not.toMatch(/Clamp each band|spring clamps/);
      expect(txt('sides-inner')).toMatch(/a 5 lb bag of sand about every 6" along each band/);
      expect(txt('sides-inner')).not.toMatch(/spring clamps|C-clamps/);
      expect(txt('sides-inner')).not.toMatch(/\(24 h\)/);
      expect(txt('seat-blocks')).not.toMatch(/wax paper/);
      // bench and jig numbers are loose: no 32nds in the form text with a whole number ("20-11/32")
      expect(txt('side-forms')).not.toMatch(/\d+-\d+\/(32|64)"/);
      expect(txt('side-forms')).toMatch(/at least 65-1\/2" × 20-3\/8"/);
    });

    it(`${name}: no "joist" in any step (they are crossmembers), and the backers glue to the rail only, the deck bonding at the deck glue-up`, () => {
      const every = list.flatMap((q) => [q.title, q.goal, ...q.instructions, ...q.checks, ...q.tools]).join('\n');
      expect(every).not.toMatch(/\bjoists?\b/i);
      const frame = txt('frame'), fparts = txt('frame-parts');
      expect(fparts).toMatch(/prepare the brake knee backers and glue them to the rail inboard faces/);
      expect(`${frame} ${fparts}`).not.toMatch(/inboard face and the deck underside/);
      expect(fparts).toMatch(/Glue it to the rail only\. It bonds to the deck underside at the deck glue-up/);
      expect(frame).toMatch(/Weight the deck down; it bonds full length to the rail and crossmember tops and to the backers/);
      // the cut-back sentence appears only when the model has a crossmember that meets a backer
      const bk = worldAABB(ms.find((x) => x.id === 'brake-backer-L')!);
      const meets = ms.filter((x) => /^(joist-\d+|king-beam)$/.test(x.id)).filter((x) => { const b = worldAABB(x); return b.max[0] > bk.min[0] && b.min[0] < bk.max[0] && !ms.filter((h) => /^axle-hanger-/.test(h.id)).some((h) => { const hb = worldAABB(h); return b.max[0] > hb.min[0] && b.min[0] < hb.max[0]; }); });
      if (meets.length) expect(frame).toMatch(/meets? a backer: cut (its|their) ends back/);
      else expect(frame).not.toMatch(/cut back|ends back|meets a backer/);
    });

    it(`${name}: the hidden crossmember and king beam get the rib-knee screw pilots from below, drilled through the member and the deck from the member's drawing`, () => {
      const gear = txt('under-holes'); // the last holes from below are their own step
      for (const id of ['joist-5', 'king-beam']) {
        const knee = ms.find((x) => x.id === (id === 'king-beam' ? 'side-rib-knee-L3' : 'side-rib-knee-L2'))!;
        expect(knee.joints!.find((j) => j.type === 'screw')!.to).toBe(id);
      }
      expect(gear).toMatch(/Drill the rib-knee screw pilots now, straight through the crossmember and the deck/);
      expect(gear).toMatch(/Left end means the sled's left side/);
      expect(gear).toMatch(/On (crossmember 5|joist 5): Left knee: one [\d\-/]+" toward the left end from the center line, [\d\-/]+" from the rear face; one [\d\-/]+" toward the left end from the center line, [\d\-/]+" from the rear face\. Right knee:/i); // D-93: a scribed crossmember is measured from its center line
      expect(gear).toMatch(/On king beam: Left knee: two pilots, [\d\-/]+" and [\d\-/]+" from the left end, [\d\-/]+" from the rear edge/);
      expect(gear).toMatch(/Use a 1\/8" × 6" aircraft bit, square to the deck, with a square block clamped on the deck beside each hole as a drill guide: a jobber bit's flutes are too short/);
      expect(gear.indexOf('stop-block screw pilot')).toBeLessThan(gear.indexOf('Drill the rib-knee screw pilots'));
      expect(gear).not.toMatch(/locator|1\/16" holes/);
      expect(txt('side-ribs')).toMatch(/the screw pilots in the deck/);
    });

    it(`${name}: the vent holes are located, the Domino spacing is "about", the counterbores are plugged, the underside epoxy points back at the seal step`, () => {
      const tr = txt('transom');
      expect(tr).toMatch(/Drill the 4 vent holes \(1\/8"\) through the (rear )?transom, into the dados/);
      expect(tr).toMatch(/One each side, [\d\-/]+" off the centerline and [\d\-/]+" up from the transom's bottom edge/);
      expect(txt('lower')).toMatch(/about 6-1\/2" apart/);
      expect(txt('lower')).toMatch(/After the cure, glue an oak plug into each counterbore and pare it flush/);
      expect(txt('finish-under')).toContain(pp.weatherSpec === 1 ? `done in step ${at('seal')}` : `coated in step ${at('seal')}`);
      expect(txt('finish-under')).toContain(`step ${at('ends')}`); // the transom and bulkhead edges are coated at the ends step
    });

    it(`${name}: the torque wrench is listed only where the build has a torque to set`, () => {
      expect(get('rear-beam').tools).not.toContain('torque wrench');
      expect(get('hang').tools).not.toContain('torque wrench'); // D-88: every bolt goes snug plus a quarter turn
    });
  }

  it('removable knees: drilled on the drill press and offered up (one method), the strap off for the finish and on at the hang step, the knee hung on a bottom bolt, the removal step linked by number', () => {
    const l = sets[2][2];
    const t = (id: string): string => l.find((q) => q.id === id)!.instructions.join('\n');
    expect(t('brake-knees')).toMatch(/Mark the outline with the knee router template \(Forms section\)/);
    expect(t('brake-flaps')).toContain(`see step ${l.findIndex((q) => q.id === 'brake-knee-off')} (`);
    expect(t('brake-flaps')).toMatch(/inboard wall of the pocket/);
    expect(t('brake-flaps')).not.toMatch(/\bear\b|With removable knees|outboard face/);
    // D-94: the flaps are cut at their own step, after the template check on the knee and the tire
    expect(t('brake-flaps')).toMatch(/Or, without the Shaper: bandsaw each 1\/16" outside the line and flush-trim it with a pattern bit on the flap router template/);
    expect(t('brake-flaps')).toContain(`Before you cut the two flaps, brake flap L and brake flap R: the flap template passed its check on the knee and the tire at step ${l.findIndex((q) => q.id === 'gear-fit')}`);
    expect(t('brake-flaps')).not.toMatch(/Cut the flaps on the Shaper|No Shaper/);
    expect(t('brake-flaps')).toMatch(/The eye goes in at the hang step, with a drop of epoxy in the pilot/);
    expect(t('hang')).toMatch(/Fit each shoe to its tire with the wheel on/);
    expect(t('hang')).toContain(`fit each knee as in step ${l.findIndex((q) => q.id === 'brake-knee-off')}, REFIT`); // one place for the refit text
    expect(t('brake-knee-off')).toMatch(/Angle the wrench handle down and inboard/);
    expect(t('brake-knee-off')).toMatch(/put a bottom rear bolt, with its washer, through the knee, the rail and the backer/);
    expect(t('brake-knee-off')).toMatch(/Angle the wrench handle down and inboard/);
  });
});

describe('D-94: every shop-cut part is cut to its final size in exactly one step, after the work it fits against', () => {
  const variants: Array<[string, Params]> = [
    ['standard', p],
    ['extreme', { ...p, weatherSpec: 1 } as Params],
    ['knees stay on', { ...p, kneeMount: KNEE_MOUNT.fixed }],
    ['pre-D72 okoume', { ...p, ...PRE_D72 }],
  ];
  /** The parts an item (and its sub-items) names. */
  for (const [name, pp] of variants) {
    it(`${name}: each shop-cut part (Shaper, table saw, bandsaw) is cut to final in exactly one step, by an item that says so, at or before the step that fits it, and no other step says to cut it`, () => {
      // Not counted, and why: bent laminations (rails, bands) are bent on their forms and trimmed at the dry fit; metal is bought stock cut to length and drilled; printed and bought parts are not cut.
      const ps = buildModel(pp);
      const list = assemblySteps(ps, pp);
      const idx = (id: string): number => list.findIndex((q) => q.id === id);
      const shop = ps.filter((x) => x.group !== 'reference' && x.kind !== 'reference' && !x.payload && isShopCut(x));
      expect(shop.length).toBeGreaterThan(80);
      for (const x of shop) {
        const at = list.filter((q) => q.cutIds.includes(x.id));
        expect(at.length, `${x.id} cut in ${at.map((q) => q.id).join(', ')}`).toBe(1);
        const cutIdx = at[0].n;
        const inst = list.findIndex((q) => q.partIds.includes(x.id));
        expect(inst, `${x.id} installed`).toBeGreaterThanOrEqual(0);
        expect(cutIdx, `${x.id}: cut at ${at[0].id}, fitted at ${list[inst].id}`).toBeLessThanOrEqual(inst);
        // exactly one step (the stock steps aside) has an item, at any depth, that cuts this part: the cut step
        const saying = list.filter((q) => !['verify', 'mill'].includes(q.id) && cuttingItems(q.items, x.id).length > 0).map((q) => q.id);
        expect(saying, `${x.id}: the steps that say to cut it`).toEqual([at[0].id]);
      }
      // a step that cuts parts to fit built work comes after that work, and its "Before you cut" check comes before its first cutting item
      for (const q of list.filter((r) => r.cutAfter)) {
        expect(idx(q.cutAfter!), `${q.id} after ${q.cutAfter}`).toBeGreaterThanOrEqual(0);
        expect(idx(q.cutAfter!), `${q.id} after ${q.cutAfter}`).toBeLessThan(q.n);
        const first = q.items.findIndex((it) => /^Before you cut/.test(it.text));
        expect(first, `${q.id} has a Before you cut check`).toBeGreaterThanOrEqual(0);
        const cutsAt = q.items.findIndex((it) => q.cutIds.some((id) => cuttingItems([it], id).length > 0));
        expect(cutsAt, `${q.id}: the check comes before the cut`).toBeGreaterThanOrEqual(first);
      }
    });
  }

  it('the frame measures each tapered crossmember at its long point (its cut-list length), cuts it there and scribes it shorter: never to the center gap', () => {
    const frame = steps.find((q) => q.id === 'frame')!;
    const text = frame.instructions.join('\n');
    const tapered = parts.filter((x) => /^(joist-\d+|king-beam)$/.test(x.id)).filter((x) => { const b = worldAABB(x); return x.stock!.l - (b.max[1] - b.min[1]) > 1 / 64; });
    expect(tapered.map((x) => x.id).sort()).toEqual(['joist-5', 'joist-6']);
    const line = text.split('\n').find((l) => /measure at each crossmember's rear face/.test(l))!;
    expect(line).toBeTruthy();
    for (const x of tapered) {
      const name = renderInstrText(`{{${x.id}}}`, parts);
      const m = new RegExp(`${name} (\\d+(?:-\\d+/\\d+)?)"`, 'i').exec(line);
      expect(m, x.id).toBeTruthy();
      const v = m![1].includes('-') ? +m![1].split('-')[0] + +m![1].split('-')[1].split('/')[0] / +m![1].split('/')[1] : +m![1];
      expect(Math.abs(v - x.stock!.l), x.id).toBeLessThanOrEqual(1 / 32);
    }
    expect(text).not.toMatch(/the cut-list lengths are the long point/); // one story: measured at the long point, cut there, then scribed
    expect(text).toMatch(/each tapered crossmember was cut to its long point above, so scribe each end to its rail now/);
  });

  it('no item tells you to cut a shop-cut part by its plain name without naming the part (so the cut step is never hidden)', () => {
    const shop = parts.filter((x) => x.group !== 'reference' && x.kind !== 'reference' && !x.payload && isShopCut(x));
    const bad: string[] = [];
    for (const st of steps) {
      const walk = (xs: Instr[]): void => {
        for (const it of xs) {
          if (cutsPart(it.text)) {
            const plain = (cutObject(it.text) ?? '').toLowerCase(); // the part being cut is the verb's object
            for (const x of shop) {
              const name = renderInstrText(`{{${x.id}}}`, parts).toLowerCase();
              if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(plain) && !(it.parts ?? []).includes(x.id)) bad.push(`${st.id}: ${x.id}: ${it.text.slice(0, 80)}`);
            }
          }
          if (it.sub) walk(it.sub);
        }
      };
      walk(st.items);
    }
    expect(bad).toEqual([]);
    // the object of the cut decides: a feature word after the verb is a feature, not the part; a feature word before the verb does not hide the cut
    expect(cutsPart('Joint and cut to length the {{joist-2}}.')).toBe(true);
    expect(cutsPart('Cut the {{transom-rear}} hand hole.')).toBe(false);
    expect(cutsPart('Cut the Domino mortise for {{joist-1}} in each hanger.')).toBe(false);
  });

  it('regressions: a part named by a step that only drills or mortises near it is not cut there (the stop blocks, crossmember 1)', () => {
    const at = (id: string): string => steps.find((q) => q.cutIds.includes(id))!.id;
    // the stop blocks' deck pilots are drilled from below, but the blocks are shaped at the seat-block step
    for (const id of ['seat-wedge-L', 'seat-wedge-R']) expect(at(id)).toBe('seat-blocks');
    // crossmember 1's Domino mortise is cut in the hangers, but the crossmember itself is cut at the frame step
    expect(at('joist-1')).toBe('frame');
    expect(cuttingItems(steps.find((q) => q.id === 'hangers')!.items, 'joist-1')).toEqual([]);
    expect(cuttingItems(steps.find((q) => q.id === 'under-holes')!.items, 'seat-wedge-L')).toEqual([]);
  });

  it('the reordered parts land where the rule puts them (the deck first; webs at the side forms; the ends after the hull; flaps after the wheel dry fit; signs and grab boards after the ribs; the box and lid to the hull)', () => {
    const at = (id: string): string => steps.find((q) => q.cutIds.includes(id))!.id;
    const idx = (id: string): number => steps.findIndex((q) => q.id === id);
    const stepText = (id: string): string => steps.find((q) => q.id === id)!.instructions.join('\n');
    expect(at('deck')).toBe('cut-deck');
    expect(at('seat-back-panel')).toBe('cut-deck');
    expect(idx('cut-deck')).toBe(idx('mill') + 1);
    for (const id of ['side-L-web', 'side-R-web']) expect(at(id)).toBe('side-forms');
    for (const id of ['transom-rear', 'bow-bulkhead']) expect(at(id)).toBe('ends');
    expect(idx('ends')).toBe(idx('lower') + 1);
    expect(idx('ends')).toBeLessThan(idx('transom'));
    for (const id of ['brake-flap-L', 'brake-flap-R']) expect(at(id)).toBe('brake-flaps');
    expect(idx('gear-fit')).toBeLessThan(idx('brake-flaps'));
    for (const id of ['sign-L', 'sign-R', 'seat-grip-L', 'seat-grip-R', 'seat-grip-cap-L', 'seat-grip-cap-R']) expect(at(id)).toBe('side-holes');
    for (const id of ['storage-side-L', 'storage-end-aft']) expect(at(id)).toBe('storage-box');
    expect(at('storage-lid')).toBe('storage-lid');
    // the old cut-everything-first step is gone
    expect(steps.some((q) => q.id === 'shaper')).toBe(false);
    // the seal step no longer checks dados that do not exist yet; the ends step does, once they are cut
    expect(stepText('seal')).not.toMatch(/enters its dado/);
    expect(stepText('ends')).toMatch(/check the sealed deck enters its dados/);
    // the ends step: the template check with numbers from the model, then the oak, then BOTH ends dry before any epoxy
    const ends = stepText('ends');
    expect(ends).toMatch(/Before you cut: try the end templates on the hull/);
    expect(ends).toMatch(/24" over the outer bands at the rear and 18-1\/2" at the bow, within 1\/32"/);
    expect(ends).toMatch(/the tenons sit 11-5\/8" either side of the centerline and 5\/8" below the deck's underside at the rear; the Dominos 8-7\/8" either side of the centerline and 29\/32" below the deck's underside at the bow/); // (2026-10-24: 13 mm deck, 5 mm combi-core white oak sides as bought)
    expect(ends).toMatch(/Dry-fit BOTH ends, with no glue, before any epoxy is mixed/);
    expect(ends.indexOf('Before you cut')).toBeLessThan(ends.indexOf('Cut the rear transom on the Shaper'));
    // the webs: a hardboard test web proves the forms, and the deck's edge is measured, before the sheet is cut
    const sf = stepText('side-forms');
    expect(sf).toMatch(/Cut a test web first: one left web in 1\/8" hardboard, on the laser/);
    expect(sf).toMatch(/Measure the deck's edge along its curve with a flexible steel tape, from its rear corner to its bow corner, on both sides: 59-1\/2"/);
    // the flap template is tried on the knee and the tire while both are on
    expect(stepText('gear-fit')).toMatch(/Try the brake flap template on each knee and tire now, while both are on/);
    expect(stepText('gear-fit')).toMatch(/5\/8" behind the axle's center, within 1\/4"/);
    // the transom panel and the bulkhead block are left rough at the mill step
    expect(stepText('mill')).toMatch(/Rear transom and bow bulkhead: planed to thickness, but left at the rough size: they are cut to the hull at step \d+/);
  });
});
