import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { worldAABB } from '../model/bounds';
import { HULL_STEP, STEP } from '../model/build-utils';
import { defaultParams, KNEE_MOUNT } from '../params';
import { PRE_D72 } from '../test-fixtures';
import type { Part } from '../model/types';
import type { Params } from '../params';
import { cutList, ribFillers } from './cutlist';
import { formDrawings } from './forms';
import { computeLayout } from '../model/layout';
import { sideRibStations } from '../model/side-ribs';
import { assemblySteps, cumulativeParts, EARLY_STEP_IDS, hasGlueJoint, isEarlyBrakePart, isHangPart, jointTally, PART_TOKEN_RE, renderInstrText, socketScrewText, stepParts, stopBlockPilots, type BuildStep, type Instr } from './assembly';
import { finalFrac, roughFrac } from './units';
import { flatPattern } from './flat';
import { verifyChecklist } from './verify';
import { EPOXY_SYSTEM, finishingSchedule } from './finishing';

// D-73: this file tests the EXTREME weather spec's text (316, epoxy, varnish); the Standard text is tested in weather-spec.test.ts.
const p = { ...defaultParams(), weatherSpec: 1 }; // Extreme text on the Extreme spec's own geometry: 6 mm okoume thin sheet (D-80)
const parts = buildModel(p);
const built = parts.filter((x) => x.group !== 'reference' && x.kind !== 'reference' && !x.payload);
const steps = assemblySteps(parts, p);
const VIEWS = ['iso', 'top', 'side', 'front', 'under'];

describe('assembly steps', () => {
  it('begin with the preparation steps, which install nothing: the Shaper parts, then each form on its own', () => {
    expect(steps.slice(0, 5).map((s) => s.title)).toEqual([
      'Verify before ordering',
      'Mill the oak and resaw the strips',
      'Cut the Shaper parts',
      'Build the rail form',
      'Build the side forms: template, cleats and the two ramps',
    ]);
    expect(steps.slice(0, 6).map((s) => s.id)).toEqual(['verify', 'mill', 'shaper', 'rail-form', 'side-forms', 'seal']);
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
    expect(get('mill').instructions.join(' ')).toMatch(/GLUE CARD[\s\S]*60 °F[\s\S]*55 °F/); // the winter figures are on the glue card
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
    expect(gear.map((s) => s.id)).toEqual(['rear-beam', 'front-beam', 'brake-knees', 'gear-fit', 'finish-under']);
    for (const s of gear) expect(s.view, s.id).toBe('under');
  });

  it('build instructions from the joints and the params', () => {
    const get = (id: string) => steps.find((s) => s.id === id)!;
    // D-81, D-82: the chine tie has NO Dominos. The screw counts come from the rail's joint list: 8 a rail, #8 × 2-1/2", up through the rail into the side sandwich in every gap.
    expect(get('rails').instructions.join(' ')).toContain('Drill the screw holes in the top edge of each rail: 8 holes, 11/64" clearance');
    expect(get('lower').instructions.join(' ')).toMatch(/8 screws a side, #8 × 2-1\/2" flat-heads, evenly spaced/);
    expect(get('lower').instructions.join(' ')).toMatch(/7\/16" bearing face/); // outer band 0.2075 + web 0.236, to the nearest 1/32
    const okSteps = assemblySteps(buildModel({ ...p, ...PRE_D72 }, undefined), { ...p, ...PRE_D72 });
    expect(okSteps.find((s) => s.id === 'lower')!.instructions.join(' ')).toMatch(/8 screws a side, #8 × 2-1\/2"/);
    expect(okSteps.find((s) => s.id === 'lower')!.instructions.join(' ')).not.toMatch(/Domino/);
    expect(get('dry-fit').instructions.join(' ')).toContain(`${finalFrac(p.deckSideClearIn)} a side`);
    expect(get('shaper').instructions.join(' ')).toMatch(/ONE piece from a full 4' × 8' sheet/);
    expect(get('shaper').instructions.join(' ')).not.toMatch(/scarf/i);
    expect(get('gear-fit').instructions.join(' ')).toMatch(/5\/8" bore on the 5\/8" rod/); // D-71/D-72: fractions, and the solid rod Eric chose
    expect(get('gear-fit').instructions.join(' ')).not.toMatch(/0\.63"/);
  });

  it('count a joint listed on both mating parts once', () => {
    const ids = new Set(['rail-L', 'rail-R']);
    const t = jointTally(parts, ids, 'domino', (j) => (/^5×30/.test(j.size ?? '') ? '5×30' : /^6×40/.test(j.size ?? '') ? '6×40' : 'other'));
    expect(t.get('5×30')).toBe(14); // the crossmember and king beam Dominos (7 a rail); the chine tie has none now (D-81)
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
    expect(fin).toMatch(/tongue and the grab boards \(with their caps\) are NOT removable/);
    expect(fin).not.toMatch(/\(brake flaps, handle, signs, tongue\)/);
    expect(get('tongue').instructions.join(' ')).toMatch(/not removable/);
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
  it('seals only the dados, edges and hidden faces at assembly; the show faces are stained, then sealed', () => {
    const seal = steps.find((s) => s.id === 'seal')!.instructions.join(' ');
    expect(seal).toMatch(/ONLY the dados/);
    expect(seal).toMatch(/show faces stay bare/);
    expect(seal).toMatch(/Glue faces stay bare or scuffed/);
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
    expect(text).toMatch(/flush-cut saw/);
    expect(dry.tools).toContain('flush-cut (Japanese) saw');
    expect(text.indexOf('Trim the rails')).toBeGreaterThan(-1);
    expect(text.indexOf('rail-end mortises')).toBeGreaterThan(text.indexOf('Trim the rails'));
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
    expect(host(parts)).toBe(parts.find((x) => x.id === 'brake-backer-L')!.step <= HULL_STEP.deck ? 'frame' : 'brake-knees');
    expect(host(retarget(STEP.frame))).toBe('frame');
    expect(host(retarget(STEP.brake))).toBe('brake-knees');
  });

  it('glues them in the frame glue-up and drills the knee-bolt holes there, when the model puts them in the frame step', () => {
    const s2 = assemblySteps(retarget(STEP.frame), p);
    const frame = s2.find((s) => s.id === 'frame')!.instructions.join(' ');
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
    const dry = steps[idx('dry-fit')];
    const t = dry.instructions.join(' ');
    expect(t).toMatch(/Drill the screw pilots in the bottom edge of each side, through the rail holes: 8 a side/);
    expect(t).toMatch(/7 pilots: 1\/8" pilot, 5\/8" deep/);
    expect(t).toMatch(/1 pilot: 1\/8" pilot, 3\/4" deep/);
    expect(t).toMatch(/glue line between the outer band and the web/);
    expect(dry.instructions.findIndex((l) => /Trim the rails/.test(l))).toBeLessThan(dry.instructions.findIndex((l) => /screw pilots/.test(l)));
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
    expect(t).toMatch(/Screw each rail to its side in every gap: 8 screws a side, #8 × 2-1\/2" flat-heads, evenly spaced \(about 6-1\/2" apart\)/);
    expect(t).toMatch(/11\/64" clearance hole through the rail and a 1\/8" pilot in the side/);
    expect(t).toMatch(/3\/8" counterbores 1" up the rail/);
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
    expect(sideForms).toContain(`rise ${finalFrac(dim('side-form', 'ramp-rise'))}`);
    expect(sideForms).toContain(`${finalFrac(dim('side-form', 'ramp-length'))} long from the start of the S`);
    expect(sideForms).toContain(`${dim('side-form', 'ramp-ribs')} MDF ribs`);
    expect(railForm).toContain(`${finalFrac(dim('rail-form', 'form-length'))} long`);
    for (const [stepId, id, word] of [['rail-form', 'rail-form', 'rail form'], ['side-forms', 'side-form', 'S-ramp']] as const) {
      const step = steps.find((s) => s.id === stepId)!;
      const build = (forms.find((d) => d.id === id) as unknown as { build?: Array<{ step: string }> }).build ?? [];
      const making = build.filter((b) => !/^(CLAMP|GLUE-UP|SPRING-BACK)/.test(b.step));
      const item = step.items.find((q) => q.text.includes(word))!;
      expect(item, id).toBeTruthy();
      if (build.length) expect(item.sub!.length, id).toBe(making.length);
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
      expect(mill).toContain(pool.ripText.replace(/^./, (c) => c.toUpperCase()));
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
    const lamIds = (lam.sub ?? []).flatMap((q) => q.parts ?? []);
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
    expect(t).toMatch(/Cradle 1: [\d\-/]+" from the rear end of the sides, [\d\-/]+" wide outside, [\d\-/]+" tall/);
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
    for (const id of ['brake-knee-L', 'brake-chock-L', 'handle-bar', 'bridle-tongue']) expect(listed, id).not.toContain(id); // laminated blocks: their recipe is in the face-laminate block only
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
      const m = mill.match(new RegExp(`${pool.ripText.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}: (\\d+) lanes?`, 'i'));
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

  it('says the Shaper file cuts net and the blank is the stock, in step 2 and at the dry fit (numbers from the model)', () => {
    expect(blank).toBeGreaterThan(net);
    const shaper = get('shaper').instructions.join(' ');
    expect(shaper).toContain(`cuts the flat development net, ${finalFrac(net)} long`);
    expect(shaper).toContain(`Start from a ${roughFrac(blank)} blank`);
    expect(shaper).toMatch(/cut net from the file/);
    const dry = get('dry-fit').instructions.join(' ');
    expect(dry).toContain(`came off the Shaper at ${finalFrac(net)}`);
  });

  it('quotes the handle-socket screw from the joint size text, no hardcoded length', () => {
    const j = parts.find((x) => x.id === 'handle-socket-L')!.joints!.find((q) => q.type === 'bolt')!;
    const m = /^(\S+) × (\S+) .*?([a-z]+-head cap screws?)/.exec(j.size!)!;
    const text = `${j.count} × ${m[1]} × ${m[2]}" stainless ${m[3]}`;
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
    const gf = get('gear-fit').instructions.join(' ');
    expect(gf).toContain(`${pilots.xs.map((n) => finalFrac(n)).join(' and ')} forward`);
    expect(gf).toContain(`${pilots.offCenter.map((n) => finalFrac(n)).join(' and ')} either side of the centerline`);
    expect(gf).toMatch(/transom's outer face/);
    // The pilots are the screws' own positions, in the model frame (the wedge `at` is local): the distance to the centerline equals the wedge's lateral center.
    const sb = get('seat-blocks').instructions.join(' ');
    expect(sb).toMatch(/UNDERSIDE/);
    expect(sb).toMatch(/tip the sled onto its side/i);
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
      ['rails', /screw holes in the top edge/, /from the rear end[^.]*from the inboard face/], // D-81: the drawing's positions of the chine screws
      ['rails', /crossmembers and the king beam/, /from the rear end/],
      ['hangers', /beam notch/, /from the rear edge/],
      ['hangers', /Domino mortise/, /from the rear edge/],
      ['frame', /kingpin/, /from the left end/],
      ['rear-beam', /axle groove/, /from the rear face/],
      ['rear-beam', /Drill the beam/, /from the left end/],
      ['front-beam', /Drill and groove/, /Kingpin hole: [^.]*from the left end/],
      ['brake-knees', /Drill each knee leg/, /from the top end/], // removable knees (the default): the holes are drilled before the dry fit
      ['dry-fit', /rail-end mortises/, /from the top edge/],
      ['dry-fit', /screw pilots/, /from the rear end \(the finished end/],
      ['seat-blocks', /latch hole/, /from the rear edge/],
      ['storage-lid', /lid frame joints/, /from the rear end/],
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

    it(`${name}: the glue card is the first item of the first glue step, with the working times`, () => {
      const mill = get('mill');
      expect(mill.items[0].text).toMatch(/^GLUE CARD/);
      const card = mill.instructions.slice(0, 20).join('\n');
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
      expect(t).toMatch(/Mouth: 1-5\/16" from the rear edge, 1-29\/32" from the bottom end/);
      expect(t).not.toMatch(/1\/8" blind|29\/32" deep/);
    });

    it(`${name}: features with several positions give every one`, () => {
      expect(text('rear-beam')).toMatch(/Clamp-plate bolts, both ends:[^\n]*1-1\/2" and 26" from the left end/); // D-83: 2 in wide plates, so the bolt rows sit a little further out
      expect(text('rear-beam')).toMatch(/Hold-down bolts, both ends:[^\n]*4-3\/16" and 23-5\/16" from the left end/);
      const fb = text('front-beam');
      expect(fb).toMatch(/Clamp-plate bolts, 4 plates:[^\n]*1-1\/4", 6-3\/4", 20-3\/4" and 26-1\/4" from the left end/);
      expect(fb).toMatch(/Eye-bolt holes[^\n]*5-3\/4" and 21-3\/4" from the left end/);
      expect(fb).toMatch(/pilots, both pads:[^\n]*4" and 23-1\/2" from the left end/);
      expect(text('storage-lid')).toMatch(/3 batten dados[^\n]*3-13\/16", 7-11\/32" and 10-29\/32" from the rear end/);
      expect(text('transom')).toMatch(/Both sockets: centered 9-3\/8" either side of the centerline/);
    });

    it(`${name}: the unfilled template text is gone`, () => {
      for (const s of list) {
        const t = allText(s);
        expect(t, s.id).not.toMatch(/from the parts list|in each end, in the (left|right) end|the screws on the joint list/);
      }
      expect(text('handle')).toMatch(/2 × 1\/4-20 × 1-1\/4" stainless button-head cap screws per socket/);
      expect(text('hang')).toMatch(/2 × 1\/4-20 × 1-1\/4" stainless button-head cap screws per socket/);
      expect(text('frame')).toMatch(/at both ends of each crossmember: 7\/8" from the bottom edge/);
    });

    it(`${name}: no buying talk in step 0, the knee holes come from positions, the mirror ramp is named`, () => {
      const v = text('verify');
      expect(v).not.toMatch(/Get the other three|mill cert/);
      expect(v).toMatch(/Verify section/);
      expect(get('verify').checks.join(' ')).not.toMatch(/passed/);
      expect(text('seal')).not.toMatch(/Extreme setting|stored outside\) uses/);
      const fr = text('frame');
      expect(fr).not.toMatch(/as a template/);
      expect(fr).toMatch(/knee-bolt holes[^\n]*from the rear end[^\n]*from the top edge/);
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
    expect(mill).toMatch(/Only the center layer is edge-glued: its joint is 5-1\/4" up from the bottom edge of the finished knee \(3\/4" above the shoulder\)/);
    expect(mill).toContain(`Mill the cured block to ${g.finalText}`);
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
    expect(mill).toMatch(/Cut the flap pocket in the rear layer \(layer 1\) and the center layer \(layer 2\) BEFORE the glue-up: a 1-3\/8"-wide notch in from the outboard edge, 7" to 8-3\/4" up from the bottom edge of the finished knee/); // 6-31\/32" is a layout number: said to 1\/16"
    expect(mill).toMatch(/Leave the front layer whole: the pocket is recessed about 1\/4" into it after the glue-up/);
    expect(mill).not.toMatch(/outboard ear|two ears/);
  });

  it('D-77: the knee step is 9-1/2" tall, recesses the pocket into the front layer, and has no slot or ears', () => {
    const knees = stepText('brake-knees');
    expect(knees).toMatch(/The knee is 9-1\/2" tall/);
    expect(knees).toMatch(/Recess the pocket about 1\/4" into the front layer, so it ends 1-21\/32" from the rear face/);
    expect(knees).toMatch(/the grain of the rear and front layers runs up the leg, and the center layer runs across the sled/);
    expect(knees).toMatch(/drilled with the stainless strap on and the flap tongue clamped in the pocket/);
    expect(knees).not.toMatch(/\bslot|\bears?\b/);
  });

  it('D-77: the flap step cuts, deburrs and drills the strap, screws it on with 1/8" pilots, then drills the pin hole through it with the tongue clamped in the pocket', () => {
    const t = stepText('brake-flaps');
    expect(t).toMatch(/Make the two pivot straps: brake pivot strap L and brake pivot strap R/);
    expect(t).toMatch(/Cut each 3-5\/16" long on the metal bandsaw, then deburr every cut edge/);
    expect(t).toMatch(/4 holes \u00d83\/16"[^\n]*11\/32" and 1-11\/16" from the rear edge/);
    expect(t).toMatch(/Then the pin hole: \u00d813\/32"/);
    expect(t).toMatch(/Each strap takes 4 \u00d7 #8 \u00d7 1-1\/4" stainless pan-head wood screws: 2 in the roof above the pocket and 2 in the floor under it/);
    expect(t).toMatch(/Drill 1\/8" pilots 1-3\/16" deep/);
    expect(t).toMatch(/Clamp the tongue and block in the knee's pocket, then drill the pin hole in one pass with one 13\/32" bit: through the strap's hole, the block and the tongue, and 1" blind into the inboard wall of the pocket/);
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
    const shaper = stepText('shaper');
    expect(shaper).toContain(`Start from a ${blank} blank (cut list)`);
    expect(shaper).toContain(`net, ${net} long`);
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
    expect(side.build[4].step).toMatch(/^MIRROR RAMP/); // item 5 of the side form really is the mirror ramp
    expect(all).not.toMatch(/mirror ramp \(step 5\)/i);
  });

  it('step 6 puts the plate recess under the brake knee backers, not after the seat-hinge backers', () => {
    const lines = stepText('frame').split('\n');
    const recess = lines.findIndex((l) => /cut the plate recess/.test(l));
    const brake = lines.findIndex((l) => /prepare the brake knee backers and glue them/.test(l));
    const hinge = lines.findIndex((l) => /seat-hinge backers/.test(l));
    expect(recess).toBeGreaterThan(brake);
    expect(brake).toBeGreaterThan(hinge);
    expect(lines[recess]).toMatch(/inboard face of each brake knee backer/);
    expect(lines.slice(hinge + 1, brake).join('\n')).not.toMatch(/recess/);
  });

  it('prints a brake-knee template that the steps ask for and the forms have', () => {
    expect(stepText('shaper')).toMatch(/brake flap and knee/);
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
      expect(mine.filter((i) => /^side-rib-[LR]\d$/.test(i)).length).toBe(6);
      expect(mine.filter((i) => /^side-rib-knee-/.test(i)).length).toBe(4);
      expect(get('storage-box').partIds.filter((i) => /^box-tie-/.test(i)).length).toBe(2);
      expect(ids).not.toContain('step-5'); // no generated fallback step for them
    });
    it(`${name}: the rib step gives stations from the transom, the filler, the knee screws and the counterbores`, () => {
      const t = txt(get('side-ribs'));
      expect(t).toMatch(/band-strip filler to the web/);
      expect(t).toMatch(/Epoxy each rib to the inner bands and its filler/);
      // the stations come from the model (the mid rib stands forward of its crossmember where the side is turned in)
      const L = computeLayout(pStdOrExt(name));
      const at = sideRibStations(pStdOrExt(name), L).map((st) => finalFrac(Math.round((st.x - L.xRear) * 8) / 8));
      expect(t).toContain(`box rib ${at[0]}, mid rib ${at[1]} and bow post ${at[2]}`);
      expect(t).toMatch(/2 stainless #8 × 2-1\/2" screws/); // D-82: every wood screw is a #8
      expect(t).toMatch(/11\/16" and 1-13\/32" from the outboard edge/);
      expect(t).toMatch(/Counterbore each from the sloped face first, 3\/8" wide, leaving 1\/2" of oak/);
      // the knee is drilled on the drill press first, then dry-placed by the screw pilots, then glued and screwed (never driven before the holes exist)
      const order = ['Drill each rib knee first, on the drill press', 'Dry-place each knee by the screw pilots, then open the deck pilots', 'Glue each knee to its rib and the deck, then drive the screws'].map((x) => t.indexOf(x));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      // each knee is centered on its rib shaft and set by the pilots in the deck; its member's centerline is the model's
      const ppp = pStdOrExt(name), msr = buildModel(ppp);
      expect(t).toMatch(/Each knee is centered on its rib shaft, and the two pilots in the deck set it/);
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
      expect(t).toMatch(/spare band strip \(the same thickness as the bands/);
      // the filler lengths are the cut list's, rounded up to 1/8" the way its rough sizes are
      const fl = ribFillers(msr, ppp);
      expect(t).toContain(`about ${roughFrac(fl[1].lengthIn)} at the mid rib and about ${roughFrac(fl[2].lengthIn)} at the bow post`);
      expect(t).toMatch(/sit a booted rider in the bare hull and confirm the bow-post station/);
      expect(t).not.toMatch(/\d\.\d{2,}/);
      expect(t).not.toMatch(/doubler/i);
      expect(get('side-ribs').clampCure).toMatch(/epoxy|Epoxy/); // the ribs are epoxy under both weather specs
    });
    it(`${name}: the box tie is glued at the box install, never to the lid frame; the D-ring brackets are bolted at the final fit with the bracket as the template`, () => {
      const box = txt(get('storage-box'));
      expect(box).toMatch(/box tie between each box rib and the box side/);
      expect(box).toMatch(/never glued to the lid frame/);
      // D-ring and grab-board holes are drilled at the rib step, before any finish, with the bracket as the template and a scrap block outside; the final fit only bolts
      const rib = txt(get('side-holes'));
      expect(get('side-holes').title).toBe('Drill the D-ring holes and fit the grab boards (before the finish)');
      expect(txt(get('side-ribs'))).not.toMatch(/Grab boards:|scrap block/);
      expect(list.map((q) => q.id).indexOf('side-holes')).toBe(list.map((q) => q.id).indexOf('side-ribs') + 1);
      expect(rib).toMatch(/Hold each bracket on the inner face of its rib head[^\n]*The bracket is the template/);
      expect(rib).toMatch(/through the bracket, the head, the inner band, the web and the outer band in one pass/);
      expect(rib).toMatch(/scrap block on the outside of the side behind the holes, to stop tear-out/);
      expect(rib).toMatch(/Brush epoxy into each hole[^\n]*run the bit through again/);
      expect(rib).toMatch(/Grab boards:[\s\S]*drill through the board, the inner band, the web, the outer band and the strip/);
      const fit = txt(get('final-fit'));
      expect(fit).not.toMatch(/Drill all \d holes|drill all the layers/i);
      expect(fit).toContain(`drilled at step ${list.map((q) => q.id).indexOf('side-holes')}, before the finish`);
      expect(fit).toMatch(/2 1\/4-20 × 2" (?:stainless )?button-head bolts each, pushed in from OUTSIDE with a 3\/4" fender washer/);
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
    expect(outer).toMatch(/Drill the drain holes once the cure is hard: 2 in each side, 3\/8", straight through the inner band, the web and the outer band/);
    // ONE datum: the inner face of the rear transom (the web end sits 1/4" inside the transom dado), the same as the band drawing
    expect(outer).toMatch(/Mark the inner face of the rear transom on each sandwich first: 1\/4" in from the rear end of the web/);
    expect(outer).toMatch(/Centers 3\/8" and 58" forward of that line, measured along the bottom edge[^\n]*, 23\/32" up from the web's bottom edge/); // the numbers of the band and web drawings
    expect(outer).toMatch(/backer board behind the exit/);
    expect(outer).toMatch(/Brush epoxy into each bore/);
    expect(outer).not.toMatch(/nipple|scupper/i);
    // the box drains are drilled and sealed with the hull inverted (with the stop-block pilots), and the underside finish step checks them; the box step only fairs the floor
    const gear = stepText(std, 'gear-fit');
    expect(gear).toMatch(/Drill the 2 box drain holes through the deck now, hull still inverted: 3\/8", straight up through the deck from below/);
    expect(gear).toMatch(/aft corners of the box: [^\n]*forward of the transom's outer face, [^\n]*either side of the centerline/);
    expect(gear).toMatch(/Seal each bore now: tape the top-face mouth, brush epoxy/);
    expect(std.find((s) => s.id === 'gear-fit')!.checks.join(' ')).toMatch(/box drain holes drilled, sealed and open/);
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

  it('Standard: no stain and no stain step; clear spar urethane only, and the finish steps cite the finishing schedule\'s own numbers', () => {
    const t = everything(std);
    // every line that mentions a stain says there is none
    const mentions = [...t.matchAll(/[^\n]*\bstain(?:ed|ing)?\b[^\n]*/gi)].map((m) => m[0]);
    for (const line of mentions) expect(line, line).toMatch(/no stain|No stain|stain-free/i);
    expect(std.find((s) => s.id === 'finish')!.title).toBe('Finish: epoxy, engrave, topcoat');
    expect(std.find((s) => s.id === 'finish')!.instructions.join('\n')).toMatch(/3\. Raise the grain \(no stain\)/);
    expect(stepText(std, 'finish-under')).toMatch(/raise the grain once\. No stain/);
    expect(stepText(std, 'seal')).not.toMatch(/Finishing, steps 3-4/);
    expect(stepText(std, 'seal')).toMatch(/clear urethane/);
    // Extreme keeps the stain, and cites steps 3 and 4 of its own schedule
    expect(ext.find((s) => s.id === 'finish')!.title).toBe('Finish: stain, epoxy, engrave, topcoat');
    expect(stepText(ext, 'seal')).toMatch(/Finishing, steps 3-4/);
    expect(stepText(ext, 'finish-under')).toMatch(/stain the show faces/);
  });

  it('the Finishing step numbers cited by the seal and finish steps are the finishing schedule\'s own', () => {
    const sched = finishingSchedule(buildModel({ ...p }), p);
    const n = (id: string): number => sched.steps.find((q) => q.id === id)!.n;
    expect(stepText(ext, 'seal')).toContain(`Finishing, steps ${n('stain')}-${n('epoxy')}`);
    expect(stepText(ext, 'storage-lid')).toMatch(/Fit and drill the friction stay/);
    expect(stepText(ext, 'storage-lid')).toMatch(/DO NOT STEP in the finishing schedule \(step 5\)/);
    expect(n('engrave')).toBe(5);
  });

  it('Standard fits a 6" lid support (Extreme the friction stay) with located pilots and mounts it at the final fit', () => {
    const lid = stepText(std, 'storage-lid');
    expect(lid).toMatch(/Fit and drill the 6" lid support, then take it off/);
    expect(lid).toMatch(/Its base on the left hinge backer: 2 holes, 1\/8" pilot, 5\/8" deep, in the inboard end: 5\/16" and 15\/16" from the rear face, 1-1\/4" from the bottom face/);
    expect(lid).toMatch(/Its arm end on the lid frame: 2 holes, 1\/8" pilot, 5\/8" deep, in the bottom face:/);
    expect(stepText(std, 'final-fit')).toMatch(/Lid support: the 6" support/);
    expect(lid).toMatch(/Screws: #8 × 5\/8" at the base and #8 × 5\/8" at the arm end, each in a 1\/8" pilot/);
    expect(lid).toMatch(/each pilot keeps 5\/16" of oak on both sides/); // at least 3/16" of wood around the pilot
    expect(partsStd.find((x) => x.id === 'storage-lid-stay')!.name).toBe('Lid support'); // the id stays, the Standard name is the product's
    expect(parts.find((x) => x.id === 'storage-lid-stay')!.name).toBe('Lid friction stay');
    expect(stepText(ext, 'final-fit')).toMatch(/Lid stay: the stainless friction stay/);
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
    expect(stepText(std, 'side-holes')).toMatch(/the model assumes 1-1\/4" between them/);
    expect(fit).not.toMatch(/#8-32|machine screw/);
    expect(stepText(std, 'side-ribs')).toMatch(/The D-ring holes are drilled in the next step/);
    expect(std.find((s) => s.id === 'final-fit')!.goal).toMatch(/D-rings/);
  });

  it('Standard beds the handle sockets in thickened epoxy (Extreme: epoxy or polysulfide sealant)', () => {
    expect(stepText(std, 'hang')).toMatch(/Handle: 2 sockets bedded in thickened epoxy on the transom/);
    expect(stepText(std, 'handle')).toMatch(/At the hang step: bedded in thickened epoxy,/);
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

  it('every part the cut list face-laminates is named in the glue-up item of the mill step (D-79: only 4/4 and 5/4 are bought)', () => {
    for (const [pp, list] of [[pStd, std], [p, ext]] as const) {
      const cl = cutList(buildModel(pp), pp);
      const mill = stepText(list, 'mill');
      const lam = cl.glueUps.filter((g) => g.kind !== 'edge');
      expect(lam.length).toBeGreaterThanOrEqual(9);
      const m = buildModel(pp);
      for (const g of lam) for (const id of g.ids) {
        const name = m.find((x) => x.id === id)!.name;
        expect(mill.toLowerCase(), `${id} (${name})`).toContain(name.replace(/\s*\(.*\)\s*$/, '').toLowerCase().replace(/^./, (c) => c));
      }
      // the parts that used 6/4 and 8/4 boards are among them, and the board-yield line only offers what is bought
      for (const id of ['bridle-tongue', 'king-beam', 'joist-6', 'bow-bulkhead', 'seat-wedge-L', 'storage-hinge-backer-L', 'handle-bar']) expect(lam.some((g) => g.ids.includes(id)), id).toBe(true);
      expect(mill).toMatch(/4\/4 planes to 3\/4", 5\/4 to 1"\./);
      expect(mill).not.toMatch(/6\/4 to|8\/4 to/);
      expect(mill).toMatch(/The lumber list has only 4\/4 and 5\/4 white oak/);
      expect(mill).toMatch(/Mill the cured block to its final size \(joint one face, plane to thickness\)/);
      expect(mill).toMatch(/plenty of clamps/);
    }
  });

  it('the shaper step says to measure the real 6 mm sheet before the dados; the thin sheet is named for the spec (no leftover 1/4 in white oak ply or 4 mm okoume wording)', () => {
    expect(stepText(std, 'shaper')).toMatch(/6 mm Baltic birch: left side panel/);
    expect(stepText(std, 'shaper')).toMatch(/Measure the real 1\/4 in \(6 mm\) sheet and the 12 mm sheet first \(Verify\)/);
    expect(stepText(ext, 'shaper')).toMatch(/6 mm okoume: left side panel/);
    for (const list of [std, ext]) expect(everything(list)).not.toMatch(/white oak ply|4 mm okoume|3 mm Baltic/i);
  });

  it('the lights: the lamp clips are fitted to the real lights (re-measured before printing)', () => {
    expect(stepText(std, 'final-fit')).toMatch(/clips must be printed to the real lights, so measure the lights first/);
  });

  it('the epoxy facts come from ONE place (the kit the BOM buys): no West System 105/206, 5:1, 406 filler, 205/209 or microballoon text in the Standard build text, both specs name the 635 kit', () => {
    const t = everything(std);
    expect(t).not.toMatch(/\b105\/206\b|\b105 resin|5:1|\b406\b|\b205\b|\b209\b|\b206\b|microballoon|West System|second person/i);
    expect(t).toMatch(/U\.S\. Composites 635 thin epoxy, 2 parts resin to 1 part hardener by volume/);
    expect(t).toMatch(/fumed silica/);
    // the Extreme spec buys the same kit; its low-density filler is bought, so it may name it
    const x = everything(ext);
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

  it('the rail-to-chine screws seat in 3/8" counterbores (a #8 flat head is about 11/32"), plugged with a 3/8" oak plug; the forward holes are countersunk; one direction (straight down, hull inverted)', () => {
    const rails = stepText(std, 'rails');
    expect(rails).toMatch(/Counterbore the first 7 from the bottom edge up the rail: a 3\/8" bit, 1" deep/);
    expect(rails).not.toMatch(/5\/16" bit/);
    expect(rails).toMatch(/3\/8" oak plug from a plug cutter on offcuts \(or a 3\/8" dowel\), glued in and trimmed flush/);
    expect(rails).toMatch(/The last \(forward\) hole gets a countersink from the bottom edge instead of a bore/);
    const dry = stepText(std, 'dry-fit'), lower = stepText(std, 'lower');
    expect(dry).toMatch(/drill straight down into the bottom edge of the side/);
    expect(lower).toMatch(/straight down through the rail/);
    for (const list of [std, ext]) expect(everything(list)).not.toMatch(/up through the rail/);
    const rail = partsStd.find((x) => x.id === 'rail-L')!.joints!.filter((j) => j.type === 'screw' && /chine/.test(j.to));
    const deep = rail.find((j) => /counterbore the head/.test(j.size!))!;
    const bit = /\((\d+)\/(\d+)" bit\)/.exec(deep.size!)!;
    expect(Number(bit[1]) / Number(bit[2])).toBeGreaterThanOrEqual(3 / 8 - 1e-9);
    expect(rail.find((j) => /no counterbore needed/.test(j.size!))!.size).toMatch(/countersink the head flush/);
  });

  it('the layers of an edge-glued laminate are unequal and mirrored, so the seams of neighboring layers sit at least 1-1/2" apart (bridle tongue, bow bulkhead); the edge-glue block comes before the lamination', () => {
    const cl = cutList(partsStd, pStd);
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

  it('the bridle tongue is shaped (stem curves, the 1" sleeve hole 9" from the rear end, easing) before its bolt holes; the handlebow is a glued block with the glue line through its middle', () => {
    const t = stepText(std, 'tongue');
    expect(t.indexOf('Shape the bridle tongue')).toBeLessThan(t.indexOf('Drill the bridle tongue T head'));
    expect(t).toMatch(/Bandsaw the two stem curves/);
    expect(t).toMatch(/Drill the 1" sleeve hole across the stem now[\s\S]*9" from the rear end \(1-1\/2" from the tip\)/);
    expect(t).toMatch(/Ease every edge of the stem and the tip/);
    const h = stepText(std, 'handle');
    expect(h).toMatch(/from its glued block \(step 1\)/);
    expect(h).toMatch(/glue line then runs through the middle of the bar's depth/);
    expect(h).not.toMatch(/one board|single board/);
  });

  it('the D-ring bolts take one fender washer a bolt (under the head), and the clamp plates are drilled with stainless advice', () => {
    const fit = stepText(std, 'final-fit');
    expect(fit).toMatch(/3\/4" fender washer under each head/);
    expect(fit).toMatch(/no washer under them \(one fender washer a bolt, under the head\)/);
    const rear = stepText(std, 'rear-beam');
    expect(rear).toMatch(/Drilling stainless: center-punch every mark, use a cobalt bit/);
    expect(rear).toMatch(/SLOW/);
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
      expect(beam).toContain(`1/4" × ${len(/^beam-/)}" bolts down through each flat leg and the beam`);
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
      expect(rails).toMatch(/Clamps: 8 bar or pipe clamps of 12" capacity or more/);
      // a bent lamination stays on the form for the top of the glue card's clamp time (24 h at 60 °F or warmer), not the flat glue-up clamp time
      expect(rails).toMatch(/Leave each rail clamped for 24 h at 60 °F or warmer[^\n]*before it comes off the form/);
      expect(rails).not.toMatch(/Leave it clamped|wax paper/);
      expect(txt('side-forms')).not.toMatch(/Clamp each band|spring clamps/);
      expect(txt('sides-inner')).toMatch(/Clamp each band to the web every [\d\-/]+": about \d+ spring clamps/);
      expect(txt('sides-inner')).not.toMatch(/\(24 h\)/);
      expect(txt('seat-blocks')).not.toMatch(/wax paper/);
      // bench and jig numbers are loose: no 32nds in the form text with a whole number ("20-11/32")
      expect(txt('side-forms')).not.toMatch(/\d+-\d+\/(32|64)"/);
      expect(txt('side-forms')).toMatch(/at least 65-1\/2" × 20-3\/8"/);
    });

    it(`${name}: no "joist" in any step (they are crossmembers), and the backers glue to the rail only, the deck bonding at the deck glue-up`, () => {
      const every = list.flatMap((q) => [q.title, q.goal, ...q.instructions, ...q.checks, ...q.tools]).join('\n');
      expect(every).not.toMatch(/\bjoists?\b/i);
      const frame = txt('frame');
      expect(frame).toMatch(/prepare the brake knee backers and glue them to the rail inboard faces/);
      expect(frame).not.toMatch(/inboard face and the deck underside/);
      expect(frame).toMatch(/Glue it to the rail only\. It bonds to the deck underside at the deck glue-up/);
      expect(frame).toMatch(/Weight the deck down; it bonds full length to the rail and crossmember tops and to the backers/);
      // the cut-back sentence appears only when the model has a crossmember that meets a backer
      const bk = worldAABB(ms.find((x) => x.id === 'brake-backer-L')!);
      const meets = ms.filter((x) => /^(joist-\d+|king-beam)$/.test(x.id)).filter((x) => { const b = worldAABB(x); return b.max[0] > bk.min[0] && b.min[0] < bk.max[0] && !ms.filter((h) => /^axle-hanger-/.test(h.id)).some((h) => { const hb = worldAABB(h); return b.max[0] > hb.min[0] && b.min[0] < hb.max[0]; }); });
      if (meets.length) expect(frame).toMatch(/meets? a backer: cut (its|their) ends back/);
      else expect(frame).not.toMatch(/cut back|ends back|meets a backer/);
    });

    it(`${name}: the hidden crossmember and king beam get the rib-knee screw pilots from below, drilled through the member and the deck from the member's drawing`, () => {
      const gear = txt('gear-fit');
      for (const id of ['joist-5', 'king-beam']) {
        const knee = ms.find((x) => x.id === (id === 'king-beam' ? 'side-rib-knee-L3' : 'side-rib-knee-L2'))!;
        expect(knee.joints!.find((j) => j.type === 'screw')!.to).toBe(id);
      }
      expect(gear).toMatch(/Drill the rib-knee screw pilots now, straight through the crossmember and the deck/);
      expect(gear).toMatch(/Left end means the sled's left side/);
      expect(gear).toMatch(/On (crossmember 5|joist 5): Left knee: one [\d\-/]+" from the left end, [\d\-/]+" from the rear face; one [\d\-/]+" from the left end, [\d\-/]+" from the rear face\. Right knee:/i);
      expect(gear).toMatch(/On king beam: Left knee: one [\d\-/]+" and [\d\-/]+" from the left end, [\d\-/]+" from the rear edge/);
      expect(gear).toMatch(/Use a 1\/8" × 6" aircraft bit, square to the deck: a jobber bit's flutes are too short/);
      expect(gear.indexOf('stop-block screw pilot')).toBeLessThan(gear.indexOf('Drill the rib-knee screw pilots'));
      expect(gear).not.toMatch(/locator|1\/16" holes/);
      expect(txt('side-ribs')).toMatch(/the screw pilots in the deck/);
    });

    it(`${name}: the vent holes are located, the Domino spacing is "about", the counterbores are plugged, the underside epoxy points back at the seal step`, () => {
      const tr = txt('transom');
      expect(tr).toMatch(/Drill the 4 vent holes \(1\/8"\) through the (rear )?transom, into the dados/);
      expect(tr).toMatch(/One each side, [\d\-/]+" off the centerline and [\d\-/]+" up from the transom's bottom edge/);
      expect(txt('lower')).toMatch(/about 6-1\/2" apart/);
      expect(txt('lower')).toMatch(/Plug each counterbore with a glued oak plug/);
      expect(txt('finish-under')).toContain(pp.weatherSpec === 1 ? `done in step ${at('seal')}` : `both were coated in step ${at('seal')}`);
    });

    it(`${name}: the torque wrench is listed only where the build has a torque to set`, () => {
      expect(get('rear-beam').tools).not.toContain('torque wrench');
      if (pp.kneeMount === KNEE_MOUNT.removable) expect(get('hang').tools).toContain('torque wrench');
      else expect(get('hang').tools).not.toContain('torque wrench');
    });
  }

  it('removable knees: drilled on the drill press and offered up (one method), the strap off for the finish and on at the hang step, the knee hung on a bottom bolt, the removal step linked by number', () => {
    const l = sets[2][2];
    const t = (id: string): string => l.find((q) => q.id === id)!.instructions.join('\n');
    expect(t('brake-knees')).toMatch(/Mark the outline with the knee router template \(Forms section\)/);
    expect(t('brake-flaps')).toContain(`see step ${l.findIndex((q) => q.id === 'brake-knee-off')} (`);
    expect(t('brake-flaps')).toMatch(/inboard wall of the pocket/);
    expect(t('brake-flaps')).not.toMatch(/\bear\b|With removable knees|outboard face/);
    expect(t('shaper')).toMatch(/Or, without the Shaper, the brake flaps only: bandsaw each 1\/16" outside the line and flush-trim it with a pattern bit on the flap router template/);
    expect(t('brake-flaps')).toMatch(/Take the flaps cut in step 2 /);
    expect(t('shaper')).toMatch(/The other Shaper parts need the Shaper/);
    expect(t('brake-flaps')).not.toMatch(/Cut the flaps on the Shaper|No Shaper/);
    expect(t('brake-flaps')).toMatch(/The eye goes in at the hang step, with a drop of epoxy in the pilot/);
    expect(t('hang')).toMatch(/Fit each shoe to its tire with the wheel on/);
    expect(t('hang')).toMatch(/angle the wrench handle down and inboard/);
    expect(t('brake-knee-off')).toMatch(/put a bottom rear bolt through the knee and the rail/);
    expect(t('brake-knee-off')).toMatch(/Angle the wrench handle down and inboard/);
  });
});
