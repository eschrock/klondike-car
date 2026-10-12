/**
 * Phase 3c-7 (D-62): the critic fixes. Each block pins one fix: the handle-socket guard (E1), the bridle without a shackle (E2, tested in bridle.test.ts / pivot.test.ts), the front-beam eye bolt,
 * the side-web row, the cargo load-height rule, the flat-free and squash-gate notes, the bridge clamp plates and 0.05 in proud tube, the brake hinge screws, the flat parts on the Shaper Origin,
 * and the materials sourcing notes.
 */
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, axleGrooveDepthIn, defaultParams, handleInsertion, resolveParams, validateParams } from './params';
import { buildModel } from './model';
import { computeLayout } from './model/layout';
import { handleGeometry } from './model/handle';
import { worldAABB } from './model/bounds';
import { runChecks } from './analysis';
import { cargoCapacity } from './analysis/cargo-capacity';
import { cargoText } from './ui/simple-text';

const defaults = defaultParams();
const parts = buildModel(defaults);
const cs = runChecks(defaults, { includeTruck: false });
const row = (id: string) => cs.find((c) => c.id === id)!;
const get = (id: string) => parts.find((x) => x.id === id)!;

describe('E1: the handle socket guard', () => {
  it('handleInsertion (params only) agrees with handleGeometry (the Layout): 14 in sockets leave 3.7 in of post and the pin hole 2.2 in (7 pin diameters) above the foot', () => {
    const hi = handleInsertion(resolveParams(defaults));
    const h = handleGeometry(defaults, computeLayout(defaults));
    expect(hi.insertionIn).toBeCloseTo(h.zTop - h.zFoot, 9);
    expect(hi.pinEndIn).toBeCloseTo(h.zPin - h.zFoot, 9);
    expect(hi.insertionIn).toBeCloseTo(3.69, 2);
    expect(hi.pinEndIn / defaults.handlePinDiameterIn).toBeGreaterThan(6.9);
  });
  it('a 12 in socket (the HEAD defect: the riding pin hole 0.19 in above the post foot) is now an ERROR, and a 13 in one (under 3 in of post engaged) a warning', () => {
    const e = validateParams({ ...defaults, handleSocketDepthIn: 12 });
    expect(e.some((i) => i.severity === 'error' && i.keys.includes('handleSocketDepthIn') && /0\.19"/.test(i.message))).toBe(true);
    const w = validateParams({ ...defaults, handleSocketDepthIn: 13.2 });
    expect(w.some((i) => i.severity === 'error' && i.keys.includes('handleSocketDepthIn'))).toBe(false);
    expect(w.some((i) => i.severity === 'warn' && i.keys.includes('handleSocketDepthIn'))).toBe(true);
    expect(validateParams(defaults).some((i) => i.keys.includes('handleSocketDepthIn'))).toBe(false);
  });
  it('the handle-sockets row caps the bearing strip at the real insertion and reports the pin end distance; the stale "1.7 in" text is gone and the note gives the real 0.46 lb', () => {
    const c = row('handle-sockets');
    expect(c.details!.some((d) => /riding pin hole|below the riding pin/.test(d.name))).toBe(true);
    expect(c.how).toMatch(/never longer than the insertion/);
    const low = runChecks({ ...defaults, handleSocketDepthIn: 12, bridleRopeDiaIn: 0.375 }, { includeTruck: false }).find((x) => x.id === 'handle-sockets')!;
    expect(low.details!.find((d) => /below the riding pin/.test(d.name))!.util).toBeGreaterThan(1); // the 12 in socket fails the end distance
    const note = PARAM_DEFS.handleSocketDepthIn.note!;
    expect(note).toMatch(/0\.46 lb/);
    expect(note).not.toMatch(/\(\+0\.2 lb\)/);
  });
  it('M5 (revised at D-63, 3c-8): the socket screws go in through a 5/8 in access hole (the 3/8 in hole of 3c-7 was too small for the 0.44 in head and 0.5 in washer) and the post has a relief groove on its transom face; the post mass drops by the groove', () => {
    expect(get('handle-socket-L').joints!.find((j) => j.to === 'transom-rear')!.size).toMatch(/0\.625" \(5\/8 in\) ACCESS HOLE/);
    expect(get('handle-socket-L').notes).toMatch(/ACCESS HOLE/);
    expect(get('handle-post-L').notes).toMatch(/RELIEF GROOVE/);
    expect(get('handle-socket-L').notes).not.toMatch(/15\/16" × 1-7\/16"/);
  });
});

describe('S-2: the front-beam chain eye bolt is centered in the ligament under the stub groove', () => {
  it('the eye is at (beamTop - groove depth + beamBot) / 2 and its net section is a row detail', () => {
    const L = computeLayout(defaults);
    const g = axleGrooveDepthIn(defaults);
    expect(g).toBeCloseTo(0.7, 9);
    expect(L.steer.beamZ).toBeCloseTo((L.beamF.top - g + L.beamF.bot) / 2, 9);
    expect(L.steer.beamZ).toBeLessThan((L.beamF.top + L.beamF.bot) / 2 - 0.3); // not mid depth of the whole beam
    const c = row('front-beam');
    expect(c.details!.some((d) => /chain eye-bolt hole/.test(d.name))).toBe(true);
    expect(c.how).toMatch(/chain eye-bolt hole/);
  });
});

describe('M2: one bridge plate per station, the tube 0.05 in proud', () => {
  it('6 plates (was 12) with the same number of bolts, bolts at +/- 0.75 in with 0.17 in of oak to the groove wall, and the front OUTER plate wider', () => {
    const plates = parts.filter((x) => x.partNo === 'axle-clamp');
    expect(plates).toHaveLength(6);
    expect(plates.reduce((n, x) => n + x.joints!.find((j) => j.type === 'bolt')!.count, 0)).toBe(12);
    const off = defaults.axleDiameterIn / 2 + defaults.clampLegGapIn;
    expect(off).toBeCloseTo(0.75, 9);
    const wall = off - (defaults.uboltRodDiameterIn + 0.03) / 2 - defaults.axleDiameterIn / 2;
    expect(wall).toBeGreaterThan(0.15);
    const outer = worldAABB(get('clamp-FL1')), inner = worldAABB(get('clamp-FL2'));
    expect(outer.max[1] - outer.min[1]).toBeCloseTo(defaults.clampPlateOuterWidthIn, 9);
    expect(inner.max[1] - inner.min[1]).toBeCloseTo(defaults.clampPlateWidthIn, 9);
    expect(defaults.clampPlateOuterWidthIn).toBeGreaterThan(defaults.clampPlateWidthIn);
    // the plate sits on the tube, and the beam top is 0.05 in under the tube top
    const L = computeLayout(defaults);
    expect(worldAABB(get('clamp-RL1')).min[2]).toBeCloseTo(L.r + defaults.axleDiameterIn / 2, 9);
    expect(L.beamR.top).toBeCloseTo(L.r + defaults.axleDiameterIn / 2 - defaults.axleProudIn, 9);
  });
  it('front-beam (the hard-hit groove wall) stays under 0.9 even with the 0.70 in groove; the rows stay clear of 1', () => {
    expect(row('front-beam').utilCargo!).toBeLessThan(0.9);
    expect(row('front-beam').util!).toBeLessThan(0.9);
  });
});

describe('N-1: the 4 mm side web row', () => {
  it('passes with margin for the lean / kick and the cargo pressure, uses the tallest unsupported free web, and has teeth (a 100 lbf kick on a 6 in patch fails it)', () => {
    const c = row('side-web');
    expect(c.group).toBe('Structure');
    expect(c.status).toBe('pass');
    expect(c.util!).toBeLessThan(0.9);
    expect(c.details!.some((d) => /kick/.test(d.name))).toBe(true);
    expect(c.details!.some((d) => /cargo pressure/.test(d.name))).toBe(true);
    const hard = runChecks({ ...defaults, sideKickLbf: 150 }, { includeTruck: false }).find((x) => x.id === 'side-web')!;
    expect(hard.util!).toBeGreaterThan(c.util!);
    expect(hard.util!).toBeCloseTo(c.util! * 3, 1);
  });
});

describe('S-5: the cargo load-height rule', () => {
  it('the info row solves for the height: tip limit about 13.8 in, slide-before-tip lost at about 17 in, tip angle 42 / 36 / 31 degrees at 12 / 18 / 24 in (D-65: 41.9 / 35.9 / 31.3 with the lighter brake kit)', () => {
    const c = row('cargo-height');
    expect(c.status).toBe('info');
    expect(c.how).toMatch(/LOAD-HEIGHT RULE/);
    expect(c.value).toBeGreaterThan(13);
    expect(c.value).toBeLessThan(14.5);
    expect(c.how).toMatch(/at 18 in 35\.9°/);
    expect(c.how).toMatch(/at 24 in 31\.3°/);
  });
  it('the Simple view cargo card says it in plain words', () => {
    const t = cargoText(cargoCapacity(defaults));
    expect(t.lines.some((l) => /Load-height rule: heavy things low/.test(l) && /12 in above the floor/.test(l))).toBe(true);
  });
});

describe('S-4 / S-6 notes and the DOM tube', () => {
  it('the tire type and the wheel rate carry the flat-free warning and the pre-order squash gate; flat-free warns until the rate is measured', () => {
    expect(PARAM_DEFS.tireType.note).toMatch(/change the BUMP RATE/);
    expect(PARAM_DEFS.tireType.note).toMatch(/560 lb\/in/);
    expect(PARAM_DEFS.bumpWheelRateLbIn.note).toMatch(/PRE-ORDER GATE/);
    expect(PARAM_DEFS.bumpWheelRateLbIn.note).toMatch(/0\.55 in or more at 300 lb/);
    expect(validateParams({ ...defaults, tireType: 1 }).some((i) => i.severity === 'warn' && i.keys.includes('tireType'))).toBe(true);
    expect(validateParams({ ...defaults, tireType: 1, bumpWheelRateLbIn: 2000 }).some((i) => i.keys.includes('tireType'))).toBe(false);
    expect(PARAM_DEFS.axleTubeYieldPsi.note).toMatch(/DOM .*A513 Type 5, NOT ordinary ERW/);
  });
});

describe('M3 / S11 / materials', () => {
  it('D-65: the butt hinge (D-62 #10 x 3/4 screws, the beveled knee top) is gone; the knee is slotted for the flap tongue and says so, the pivot block is screwed on with #10 x 1-1/4 screws and the row has margin', () => {
    expect(parts.some((x) => /^brake-hinge/.test(x.id))).toBe(false);
    expect('brakeHingeScrewLenIn' in defaults).toBe(false);
    expect(get('brake-pivot-block-L').joints!.find((j) => j.type === 'screw')!.size).toMatch(/3 x #10 x 1-1\/4"/);
    expect(get('brake-knee-L').notes).toMatch(/SLOTTED/);
    expect(get('brake-knee-L').notes).not.toMatch(/BEVELED/);
    expect(row('brake-pivot').util!).toBeLessThan(0.9);
  });
  it('the flat parts go to the Shaper Origin: deck, webs, grab boards, bulkhead, box panels, sign blanks, brake flaps, the seat-back panel', () => {
    for (const id of ['deck', 'side-L-web', 'seat-grip-L', 'bow-bulkhead', 'storage-end-fore', 'storage-lid', 'sign-L', 'brake-flap-L', 'seat-back-panel']) expect(get(id).fab, id).toBe('shaper-origin');
    expect(parts.filter((x) => x.fab === 'cnc')).toEqual([]);
  });
  it('the sheet goods name their sources and the Baltic birch fallback, the solid-oak stocks and the finishing stack', () => {
    const n = PARAM_DEFS.plySpecies.note!;
    expect(n).toMatch(/Aircraft Spruce, Peachtree City GA/);
    expect(n).toMatch(/local dealer/);
    expect(n).toMatch(/Baltic birch 12 mm for the deck/);
    expect(n).toMatch(/4\/4 to 12\/4/);
    expect(n).toMatch(/pre-stain conditioner or a gel stain.*epoxy seal.*spar varnish/);
  });
  it('S5: the UHMW parts are catalog thicknesses (1/2 in disc, 1/4 in pads) and the kingpin order is a stock length', () => {
    expect(defaults.kingThrustThickIn).toBe(0.5);
    expect(defaults.rollPadThickIn).toBe(0.25);
    expect(get('kingpin').sourcing!.vendor).toMatch(/stock length/);
  });
  it('S7: the handlebow blank is a 5/4 x 6 board at least 4.4 in wide', () => {
    expect(get('handle-bar').stock!.w).toBeGreaterThanOrEqual(4.4);
    expect(get('handle-bar').sourcing!.vendor).toMatch(/5\/4 × 6/);
  });
  it('S2: the cut list shows strips for the laminated members (rails: 2 plies of 3/8, sandwich bands: one 0.234 in strip)', () => {
    expect(get('rail-L').plies).toBe(2);
    expect(get('rail-L').stock!.t).toBeCloseTo(0.375, 9);
    expect(get('side-L-gunwale').stock!.t).toBeCloseTo(computeLayout(defaults).sideBand, 9);
    expect(get('side-L-gunwale').kind).toBe('bentlam');
  });
  it('S4 (revised at D-63, 3c-8): the seat-back latch pin is a 1-1/2 in spring-detent pin and BOTH holes are blind with a detent groove (stop block upright, backer pad flat)', () => {
    expect(get('seat-pin-L').material).toMatch(/1-1\/2"/);
    expect(get('seat-wedge-L').joints!.find((j) => j.type === 'pin')!.size).toMatch(/detent groove/);
    expect(get('seat-hinge-backer-L').joints!.find((j) => j.type === 'pin')!.size).toMatch(/blind hole 0\.625" deep/);
    expect(get('seat-hinge-backer-L').notes).toMatch(/BUTTS/);
  });
});
