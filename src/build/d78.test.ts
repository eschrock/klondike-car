/**
 * D-78 (the optional removable brake knee on quick-release pins, `kneeMount` = pins) in every build output. Both settings, both weather specs:
 *   - bolted (the default): nothing of the pin knee shows anywhere, and the knee is bolted as before (the older tests pin its text);
 *   - pins: the BOM, the cut list, the assembly steps (the rail hole, the rib hole, the bench work on the knee, the fit, the REMOVAL and REFIT steps), the Verify items, the knee template,
 *     the part drawings, the finishing schedule and the package all follow, in the shop's style (fractions, measured places, no internal names).
 * The price difference against the bolted knee is pinned section by section, as weather-spec.test.ts pins the weather difference.
 */
import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { KNEE_MOUNT, WEATHER_SPEC, defaultParams, type Params } from '../params';
import { brakeGeometry } from '../model/brake-layout';
import { computeLayout } from '../model/layout';
import { fin, flattenInstr, tokensIn, type BuildStep, type Instr } from './assembly';
import { frac } from './svg-util';
import { finalFrac } from './units';
import type { Bom, BomLine } from './bom';
import { BuildData, drawingFileName, zipPackage } from './package';
import { cutList } from './cutlist';
import { oakBoardFeet } from './nesting';
import { showRuleOf } from './finishing';
import { verifyChecklist } from './verify';

type Setting = 'bolted' | 'pins';
const mk = (setting: Setting, weather: number): { p: Params; data: BuildData } => {
  const p: Params = { ...defaultParams(), weatherSpec: weather, kneeMount: setting === 'pins' ? KNEE_MOUNT.pins : KNEE_MOUNT.bolted };
  return { p, data: new BuildData(buildModel(p), p, { date: '2026-10-13' }) };
};
const SPECS: Array<[string, number]> = [['Standard', WEATHER_SPEC.standard], ['Extreme', WEATHER_SPEC.extreme]];
const built = new Map<string, { p: Params; data: BuildData }>();
const get = (setting: Setting, weather: number) => {
  const k = `${setting}${weather}`;
  if (!built.has(k)) built.set(k, mk(setting, weather));
  return built.get(k)!;
};

const lines = (b: Bom): BomLine[] => b.sections.flatMap((s) => s.lines);
const lineIn = (b: Bom, section: string, key: RegExp): BomLine | undefined => b.sections.find((s) => s.id === section)?.lines.find((l) => key.test(l.key));
/** Every word a step prints: goal, items with their sub-items (part tokens rendered), checks. */
const stepText = (s: BuildStep, _d?: BuildData): string => [s.goal, ...s.instructions, ...s.checks, s.title].join('\n');
const allStepText = (d: BuildData): string => d.steps.map((s) => stepText(s, d)).join('\n');
const itemsText = (items: Instr[]): string => flattenInstr(items, () => undefined).join('\n');
const stepById = (d: BuildData, id: string): BuildStep => d.steps.find((s) => s.id === id)!;
/** A length as the Verify text writes it: to the nearest 1/16. */
const f16 = (v: number): string => fin(Math.round(v * 16) / 16);
/** Regex-safe text. */
const rx = (t: string): RegExp => new RegExp(t.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'));

describe('D-78 the bolted knee (the default) shows nothing of the pins', () => {
  for (const [name, w] of SPECS) {
    it(`${name}: no pin, sleeve, tab, plate or removal step anywhere; the knee bolts are still bought`, () => {
      const { p, data } = get('bolted', w);
      expect(brakeGeometry(p, computeLayout(p)).pins).toBeUndefined();
      expect(lines(data.bom).some((l) => /brake-pin|brake knee (top|bottom) pin|ball-lock|pin sleeve/i.test(`${l.key} ${l.description}`))).toBe(false);
      expect(lines(data.bom).some((l) => /3\/8-16 x 4"/.test(l.key))).toBe(true); // the four knee bolts a side
      expect(data.cutList.metal.some((m) => m.family === 'Stainless tube')).toBe(false);
      expect(data.cutList.oak.flatMap((g) => g.rows).some((r) => /^brake-tab$/.test(r.partNo))).toBe(false);
      expect(data.steps.map((s) => s.id)).not.toContain('knee-swap');
      const text = allStepText(data);
      expect(text).not.toMatch(/ball-lock|REMOVAL|REFIT|pin-hole plate|top pin|bottom pin/i);
      expect(text).toMatch(/Bolt each knee/);
      expect(stepById(data, 'brake-knees').title).toMatch(/glued and bolted/);
      const vids = data.verify.map((v) => v.id);
      expect(vids.some((v) => /^knee-/.test(v))).toBe(false);
      expect(data.verify.flatMap((v) => v.paramKeys)).not.toContain('brakePinRetentionLbf');
      expect(data.verify.find((v) => v.id === 'other-params')!.whatToDo).not.toMatch(/Ball-lock/);
      const k = data.forms.find((f) => f.id === 'brake-knee-template')!;
      expect(k.svg).not.toMatch(/PIN-HOLE PLATE/);
      expect(k.dims.map((q) => q.key)).toContain('bolt-rows');
      expect(data.files.some((f) => /brake-(tab|sleeve|pin)/.test(f.name))).toBe(false);
    });
  }
  it('an explicit bolted setting is the default, output for output', () => {
    const a = new BuildData(buildModel(defaultParams()), defaultParams(), { date: '2026-10-13' });
    const p2: Params = { ...defaultParams(), kneeMount: KNEE_MOUNT.bolted };
    const b2 = new BuildData(buildModel(p2), p2, { date: '2026-10-13' });
    expect(b2.bom.csv).toBe(a.bom.csv);
    expect(b2.cutlistCsv).toBe(a.cutlistCsv);
    expect(JSON.stringify(b2.steps)).toBe(JSON.stringify(a.steps));
    expect(JSON.stringify(b2.verify)).toBe(JSON.stringify(a.verify));
  });
});

describe('D-78 the BOM with the pins on', () => {
  for (const [name, w] of SPECS) {
    const { data } = get('pins', w);
    const b = data.bom;

    it(`${name}: four ball-lock pins a sled (2 bottom, 2 top), priced as an ESTIMATE of about $25, never quoted`, () => {
      for (const key of ['brake-pin-B', 'brake-pin-T']) {
        const l = lineIn(b, 'purchased', new RegExp(`^${key}$`)) ?? b.sections.find((s) => s.id === 'purchased')!.lines.find((q) => (q.partIds ?? []).some((i) => i.startsWith(key)))!;
        expect(l, key).toBeDefined();
        expect(l.qty).toBe(2);
        expect(l.unitUsd).toBe(25);
        expect(l.extUsd).toBe(50);
        expect(l.basis).toBe('estimate');
        expect(l.notes).toMatch(/not quoted/i);
        expect(l.description).toMatch(/ball-lock/);
        expect(l.description).not.toMatch(/ [LR] /); // one line for both sides
        expect(l.materialNote).toBeTruthy();
        // the cheaper way, said clearly and never substituted
        expect(l.alternatives?.length).toBe(1);
        expect(l.notes).toMatch(/clevis pin/);
        expect(l.notes).toMatch(/\$40 to \$45/);
        expect(l.notes).toMatch(/SPEC GAP/);
      }
    });

    it(`${name}: the grade text is ${name === 'Standard' ? 'stainless with 17-4 PH accepted' : '316 with a 316 pin that must be sourced'}`, () => {
      const l = b.sections.find((s) => s.id === 'purchased')!.lines.find((q) => (q.partIds ?? []).some((i) => i.startsWith('brake-pin-B')))!;
      if (w === WEATHER_SPEC.standard) {
        expect(l.notes).toMatch(/Standard grade: stainless, and 17-4 PH is accepted/);
        expect(l.description).toMatch(/stainless; 17-4 PH accepted/);
        expect(l.materialNote).toMatch(/17-4 PH/);
        expect(`${l.key} ${l.description} ${l.vendor ?? ''}`).not.toMatch(/316/);
      } else {
        expect(l.notes).toMatch(/Extreme grade \(316\).*17-4 PH.*NOT 316.*316 pin must be sourced/);
        expect(l.materialNote).toMatch(/316 stainless REQUIRED/);
        expect(l.description).toMatch(/316/);
      }
      expect(l.notes).toMatch(/pull-out rating/);
      expect(l.notes).toMatch(/at most about 1\/8" longer/);
    });

    it(`${name}: the pin lines give the usable length to order (the stack rounded up to 1/4")`, () => {
      const { p } = get('pins', w);
      const kp = brakeGeometry(p, computeLayout(p)).pins!;
      const lb = b.sections.find((s) => s.id === 'purchased')!.lines;
      const lineOf = (k: string) => lb.find((q) => (q.partIds ?? []).some((i) => i.startsWith(k)))!;
      expect(lineOf('brake-pin-B').description).toContain(`${fin(kp.B.gripOrder)} usable length`);
      expect(lineOf('brake-pin-T').description).toContain(`${fin(kp.T.gripOrder)} usable length`);
      expect(kp.T.gripOrder).toBeGreaterThanOrEqual(kp.T.stack);
      expect(kp.T.gripOrder - kp.T.stack).toBeLessThan(0.25 + 1e-9);
    });

    it(`${name}: four flanged bushings (an estimate, not quoted) are bought for the hull`, () => {
      const l = b.sections.find((s) => s.id === 'purchased')!.lines.filter((q) => (q.partIds ?? []).some((i) => /^brake-sleeve-[BT]-hull/.test(i)));
      expect(l.reduce((a, q) => a + q.qty, 0)).toBe(4);
      for (const q of l) { expect(q.basis).toBe('estimate'); expect(q.notes).toMatch(/not quoted/); expect(q.description).toMatch(/flanged/); }
    });

    it(`${name}: the four knee-side sleeves are cut from ONE 2 ft length of stainless tube, bought as one piece (an estimate)`, () => {
      const tube = b.sections.find((s) => s.id === 'metal')!.lines.find((l) => /tube 1\/2" OD x 3\/8" ID/.test(l.key))!;
      expect(tube).toBeDefined();
      expect(tube.key).toMatch(w === WEATHER_SPEC.standard ? /^18-8 \(304\)/ : /^316/);
      expect(tube.qty).toBe(1);
      expect(tube.unit).toBe('24 in length'); // two feet: the four knee sleeves and spares for the reaming
      expect(tube.unitUsd).toBe(16);
      expect(tube.basis).toBe('estimate');
      expect(tube.notes).toMatch(/ESTIMATE, not quoted/);
      expect(tube.notes).toMatch(/Order ONE pin first/);
      expect(tube.notes).not.toMatch(/check the (real )?tube/i);
      expect(tube.notes).toMatch(/bushing/); // the other way to buy them
      // 2 x (1-3/4 knee leg, 1 tab): 4 tube sleeves; the hull sleeves are bought flanged bushings
      const rows = data.cutList.metal.filter((m) => m.family === 'Stainless tube');
      expect(rows.reduce((a, r) => a + r.qty, 0)).toBe(4);
      expect(rows.map((r) => r.cutLengthIn).sort((a, c) => a - c)).toEqual([1, 1.75]);
      for (const r of rows) expect(r.cutLengthIn * 16).toBeCloseTo(Math.round(r.cutLengthIn * 16), 6); // rounded UP to 1/16
      expect(tube.notes).toMatch(/2 × 1-3\/4"/);
      expect(tube.partIds ?? []).toBeDefined();
      expect(data.cutList.warnings.filter((x) => /unrecognized metal/.test(x))).toEqual([]);
    });

    it(`${name}: the knee bolts, backing plates and backers are gone`, () => {
      const all = lines(b);
      expect(all.some((l) => /hex bolt 3\/8-16 x 4"/.test(l.key))).toBe(false);
      expect(JSON.stringify(b.sections)).not.toMatch(/backing plate/i);
      expect(JSON.stringify(b.sections)).not.toMatch(/knee bolt/i);
      const bar = lineIn(b, 'metal', /flat bar 1\/8" x 2"/)!;
      expect(bar.qty).toBe(1); // the two straps only
      expect(bar.notes).toMatch(/two brake pivot straps/);
    });

    it(`${name}: the lines carry no decision id, report tag or part key in their printed text`, () => {
      const text = JSON.stringify(b.sections.flatMap((s) => s.lines).filter((l) => /pin|tube|flat bar/.test(l.key + (l.partIds ?? []).join(' '))).map((l) => [l.description, l.notes, l.materialNote]));
      expect(text).not.toMatch(/\bD-\d+\b/);
      expect(text).not.toMatch(/brake-(pin|sleeve|tab|knee)/);
    });
  }

  it('the cost against the bolted knee, section by section, both specs', () => {
    const out: Record<string, { total: number; sections: Record<string, number> }> = {};
    for (const [name, w] of SPECS) {
      const bp = get('pins', w).data.bom, bb = get('bolted', w).data.bom;
      const total = bp.totalUsd - bb.totalUsd;
      const sections: Record<string, number> = {};
      for (const s of bp.sections) sections[s.id] = Math.round((s.subtotalUsd - (bb.sections.find((q) => q.id === s.id)?.subtotalUsd ?? 0)) * 100) / 100;
      expect(Object.values(sections).reduce((a, v) => a + v, 0), name).toBeCloseTo(total, 1);
      // four pins at $25 and four flanged bushings at $4, all estimates
      expect(sections.purchased, name).toBe(116);
      // one 24 in length of tube ($16) in, one 12 in piece of 1/8 x 2 flat bar ($15: the backing plates) out
      expect(sections.metal, name).toBe(1);
      // the knee bolts, nuts and washers (3/8-16 x 4, 26 nylock nuts and 16 fender washers of the sled) leave the fasteners
      expect(sections.fasteners, name).toBeLessThan(-10);
      expect(sections.lumber, name).toBeGreaterThanOrEqual(0); // the tab (5/4) and the pad (4/4) come from the same boards or a little more
      expect(sections.lumber, name).toBeLessThan(15);
      out[name] = { total, sections };
    }
    // the pins cost more than the bolts they replace: about +$80 Standard and +$57 Extreme at the researched prices (ball-lock pins estimated at $25)
    expect(out.Standard.total).toBeGreaterThan(70);
    expect(out.Standard.total).toBeLessThan(125);
    expect(out.Extreme.total).toBeGreaterThan(50);
    expect(out.Extreme.total).toBeLessThan(110);
    // the leaner way (ball-lock at the top hole only, a clevis pin and hitch-pin clip at the bottom) saves about $40 to $45 against the 4 pins
    const alt = lineIn(get('pins', WEATHER_SPEC.standard).data.bom, 'purchased', /^brake-pin-B$/) ?? get('pins', WEATHER_SPEC.standard).data.bom.sections.find((s) => s.id === 'purchased')!.lines.find((q) => (q.partIds ?? []).some((i) => i.startsWith('brake-pin-B')))!;
    const saves = (alt.unitUsd - alt.alternatives![0].usd) * 2;
    expect(saves).toBeGreaterThan(38);
    expect(saves).toBeLessThan(46);
  });
});

describe('D-78 the cut list with the pins on', () => {
  const { p, data } = get('pins', WEATHER_SPEC.standard);
  const rowOf = (partNo: string) => data.cutList.oak.flatMap((g) => g.rows).find((r) => r.partNo === partNo)!;

  it('has a tab (oak, grain vertical, from 5/4), two of them, rough sizes rounded up to 1/8, and no pad', () => {
    const tab = rowOf('brake-tab');
    expect(tab.qty).toBe(2);
    expect(tab.board).toBe('5/4');
    expect(tab.grain).toBe('z');
    const m = data.parts.find((x) => x.id === 'brake-tab-L')!.stock!;
    expect(tab.stock.t).toBeCloseTo(1, 3);
    expect(tab.stock.l).toBeCloseTo(m.l, 6);
    for (const v of [tab.rough.t, tab.rough.w, tab.rough.l]) expect(v * 8).toBeCloseTo(Math.round(v * 8), 6);
    expect(tab.rough.l).toBeGreaterThanOrEqual(tab.stock.l);
    expect(data.cutList.cuts.find((c) => c.partNo === 'brake-tab')!.note).toMatch(/grain runs up/);
    expect(data.cutlistCsv).toMatch(/Brake knee tab/);
    expect(data.cutlistCsv).not.toMatch(/Brake knee pad/);
    expect(data.cutList.finished.map((f) => f.partNo)).toContain('brake-tab');
  });

  it('keeps the knee laminate (the leg is taller over the top pin) and has no backer or plate row', () => {
    const bolted = get('bolted', WEATHER_SPEC.standard).data;
    const kneeP = data.cutList.finished.find((f) => f.partNo === 'brake-knee')!, kneeB = bolted.cutList.finished.find((f) => f.partNo === 'brake-knee')!;
    // same laminate and width and thickness; the pins leg rises over the top pin, so it is taller by the rise
    const dims = (t: string) => t.split(' × ');
    expect(dims(kneeP.finalText)[0]).toBe(dims(kneeB.finalText)[0]);
    expect(dims(kneeP.finalText)[2]).toBe(dims(kneeB.finalText)[2]);
    expect(kneeP.final.w).toBeGreaterThan(kneeB.final.w);
    expect(data.cutList.glueUps.find((g) => g.partNo === 'brake-knee')!.layers).toBe(bolted.cutList.glueUps.find((g) => g.partNo === 'brake-knee')!.layers);
    expect(data.cutList.cuts.some((c) => /backer/i.test(c.partNo) && /brake/.test(c.partNo))).toBe(false);
    expect(data.cutList.finished.some((f) => /brake-backer/.test(f.partNo))).toBe(false);
    expect(data.cutList.metal.some((m) => /backplate/.test(m.partNo))).toBe(false);
  });

  it('plans the boards for the same stock as the bolted sled plus, at most, a little of the offcuts', () => {
    const o = oakBoardFeet(data.parts, p), ob = oakBoardFeet(get('bolted', WEATHER_SPEC.standard).data.parts, get('bolted', WEATHER_SPEC.standard).p);
    expect(o.thicknesses.map((t) => t.board)).toEqual(ob.thicknesses.map((t) => t.board));
    expect(Math.abs(o.thicknesses.reduce((a, t) => a + t.purchaseBf, 0) - ob.thicknesses.reduce((a, t) => a + t.purchaseBf, 0))).toBeLessThan(2);
  });

  it('cutList() on the model alone agrees with the package', () => {
    expect(cutList(data.parts, p).cuts.length).toBe(data.cutList.cuts.length);
  });
});

describe('D-78 the assembly with the pins on', () => {
  for (const [name, w] of SPECS) {
    const { p, data } = get('pins', w);
    const bg = brakeGeometry(p, computeLayout(p));
    const kp = bg.pins!;
    const spacing = fin(Math.hypot(kp.B.x - kp.T.x, kp.B.z - kp.T.z));
    const bySt = (id: string): string => stepText(stepById(data, id), data);

    it(`${name}: the frame step drills ONE oversize bottom-pin hole a rail (rail laid flat against a fence, never on edge) with the flange counterbore, and prepares the sleeves; no knee-bolt holes, no backers`, () => {
      const t = bySt('frame');
      expect(t).toMatch(/drill the bottom-pin hole through each rail/);
      expect(t).toMatch(/laid flat, outboard face down, its top edge against a fence/);
      expect(t).not.toMatch(/on its edge|Stand the rail/);
      expect(t).toMatch(rx(`${fin(kp.B.belowRailTop)} down from the rail's top edge`));
      expect(t).toMatch(rx(`${fin(kp.B.fromRailRear)} from the finished rear end`));
      expect(t).toMatch(/1\/2" in from the end of the rail as it is now/); // the rail is still long at the rear
      expect(t).toMatch(rx(`(${fin(kp.B.fromRailRear + 0.5)} from the end)`));
      expect(t).toMatch(rx(`${fin(kp.flange.cboreDia)} Forstner, ${fin(kp.flange.cboreDepth)} deep`)); // the flange counterbore, in the inboard face
      expect(t).toMatch(/INBOARD face/i);
      expect(t).toMatch(/5\/8" bit straight through/);
      expect(t).toMatch(/oversize on purpose/);
      expect(t).toMatch(/Order ONE pin first/);
      expect(t).toMatch(/reamer/);
      expect(t).not.toMatch(/knee-bolt/);
      expect(t).not.toMatch(/brake knee backers|backing plates/);
      expect(stepById(data, 'frame').tools).toContain('fence and stop block');
    });

    it(`${name}: the rib step drills the top hole 5/8" oversize in the rib BLOCK from the rib foot, with a drill block, and beds the flanged bushing around a rod through the knee's tab sleeve with the knee pinned on at the bottom pin`, () => {
      const t = bySt('side-ribs');
      expect(t).toMatch(/drill the top-pin hole through each box rib block and bed its flanged bushing/);
      expect(t).toMatch(/drill block/);
      expect(t).toMatch(/in from the REAR edge of the block/);
      expect(t).toMatch(rx(`${fin(kp.T.fromRibFoot)} up from the BOTTOM end of the rib, the foot`));
      expect(t).toMatch(/Measure from the foot, not from the top/);
      expect(t).not.toMatch(/rib head/i.test(t) ? /^$/ : /rib head/); // the hole is in the block, not the head
      expect(t).not.toMatch(/down from the TOP edge/);
      expect(t).toMatch(rx(`${fin(kp.T.hullSleeve.len)} deep in all`));
      expect(t).toMatch(rx(`${fin(kp.flange.cboreDia)} Forstner, ${fin(kp.flange.cboreDepth)} deep`));
      expect(t).toMatch(/oversize on purpose/);
      expect(t).toMatch(/release tape/);
      expect(t).toMatch(/waxed 3\/8" rod through the tab's sleeve/);
      expect(t).toMatch(/push the bottom pin through the leg sleeve and the rail bushing/);
      expect(t).toMatch(/plain end is flush with the web's outer face/);
      expect(t).toMatch(/T-shaped like the rib/); // the filler follows the block
      expect(t).toMatch(/resaw a 4\/4 offcut/);
      expect(stepById(data, 'side-ribs').partIds).toEqual(expect.arrayContaining(['brake-sleeve-T-hull-L', 'brake-sleeve-T-hull-R']));
      const ids = data.steps.map((s) => s.id);
      expect(ids.indexOf('frame')).toBeLessThan(ids.indexOf('brake-knees'));
      expect(ids.indexOf('brake-knees')).toBeLessThan(ids.indexOf('side-ribs'));
      expect(ids.indexOf('side-ribs')).toBeLessThan(ids.indexOf('brake-flaps'));
    });

    it(`${name}: the knee step is bench work: tab from one stick, holes from the pin-hole plate (33/64" bit, top hole first, bottom last), reamed sleeves, the rail bushings bedded; units marked L and R; the knee is not glued or bolted to the hull`, () => {
      const s = stepById(data, 'brake-knees');
      const t = stepText(s, data);
      expect(s.title).toMatch(/the knee is not glued to the hull/);
      expect(t).toMatch(/not glued or bolted to the hull/);
      expect(t).toMatch(/Epoxy a tab to the rear face of each knee/);
      expect(t).toMatch(/mill ONE 12" stick/);
      expect(t).toMatch(rx(`its bottom edge ${fin(kp.tab.z0 - bg.knee.zBot)} up from the knee's bottom end`)); // the tab
      expect(t).toMatch(rx(`stands ${fin(kp.tab.z1 - bg.knee.zTopLeg)} above the top of the knee's leg`));
      expect(t).toMatch(rx(`The knee is ${fin(bg.knee.zTopLeg - bg.knee.zBot)} tall`));
      expect(t).toMatch(/touches the knee over its lower/);
      expect(t).toMatch(/pin-hole plate/);
      expect(t).toMatch(/1\/8" center hole/);
      expect(t).toMatch(/33\/64" brad-point bit/);
      expect(t).toMatch(rx(`${fin(kp.B.fromKneeRear)} from the knee's rear face`)); // hole B
      expect(t).toMatch(rx(`${fin(kp.B.fromKneeBottom)} up from its bottom end`));
      expect(t).toMatch(rx(`${fin(p.brakeTabEndIn)} from the tab's rear end and ${fin(kp.tab.z1 - kp.T.z)} under its top edge`)); // hole T
      expect(t).toMatch(rx(spacing)); // the spacing between the holes
      expect(t).toMatch(rx(`${finalFrac(kp.webRecess)} shim`));
      expect(t).toMatch(/Drill the top hole first and the bottom hole last/);
      expect(t).toMatch(/Mark the unit L or R/);
      expect(t).toMatch(/Epoxy a reamed sleeve into each hole/);
      expect(t).toMatch(/Bed a flanged bushing in each rail, with its knee clamped on/);
      expect(t).toMatch(/release tape/);
      expect(t).toMatch(/no screw is needed/i); // no new wood-screw size
      expect(t).not.toMatch(/Bolt each knee|nylock|backing plate|backers|clear of the bolt holes|bolted leg|\bpad\b.*\bknee\b.*\binboard/i);
      expect(t).not.toMatch(/with its top flat/);
      expect(s.tools).not.toContain('wrenches');
      expect(s.partIds).toEqual(expect.arrayContaining(['brake-tab-L', 'brake-tab-R', 'brake-sleeve-B-knee-L', 'brake-sleeve-T-tab-R', 'brake-sleeve-B-hull-L', 'brake-sleeve-B-hull-R']));
      expect(s.partIds).not.toContain('brake-pin-B-L'); // the pins go on at the hang step
    });

    it(`${name}: the fit step puts the knee on bottom pin first, swings the tab onto the web, then the top pin, and prints the tire gaps; REMOVAL and REFIT are clear steps; the chock rides with its knee; Transport mode says the knees come off`, () => {
      const hang = bySt('hang');
      expect(hang).toMatch(/Fit the brake knees, each with its flap on/);
      expect(hang).toMatch(/Push the bottom pin through the knee leg and the rail bushing first/);
      expect(hang).toMatch(/the tab is outside the web/);
      expect(hang).toMatch(rx(`the knee's rear face ${fin(bg.knee.x0 - (bg.O[0] + bg.r))} ahead of the tire front`));
      expect(hang).toMatch(rx(`the tab's bottom edge ${fin(kp.tab.z0 - (bg.O[1] + bg.r))} above the tire top`));
      expect(hang).toMatch(rx(`the balls stand ${fin(kp.tipIn)} inside the sled`));
      expect(stepById(data, 'hang').partIds).toEqual(expect.arrayContaining(['brake-pin-B-L', 'brake-pin-B-R', 'brake-pin-T-L', 'brake-pin-T-R']));
      const ids = data.steps.map((s) => s.id);
      expect(ids.indexOf('knee-swap')).toBe(ids.indexOf('hang') + 1);
      const swap = bySt('knee-swap');
      expect(swap).toMatch(/REMOVAL, about 15 s a side/);
      expect(swap).toMatch(/unclip the chock cord from the eye under the knee \(the chock rides with its knee\)/);
      expect(swap).toMatch(/pull the top pin .* first/);
      expect(swap).toMatch(/its flap off the side as one piece/);
      expect(swap).toMatch(/REFIT, about 25 s a side/);
      expect(swap).toMatch(/Push the bottom pin in from the outside/);
      expect(swap).toMatch(/Swing the knee until the tab .* outside the web/);
      expect(swap).toMatch(/then push the top pin through the tab, the web and the rib block/);
      expect(swap).toMatch(/chock cord on its eye/);
      expect(swap).toMatch(/Transport mode: the knees come off with the brakes/);
      expect(swap).toMatch(/chocks/);
      expect(stepById(data, 'knee-swap').kind).toBe('process');
      expect(JSON.stringify(stepById(data, 'knee-swap').items)).toMatch(/\{\{brake-pin-T-L\}\}/); // part tokens link
      // the flap step says the flap comes off WITH the knee, and the finish step touches the knee units and the bushings up
      expect(bySt('brake-flaps')).toMatch(/Removable, knee and flap together/);
      expect(bySt('finish')).toMatch(/Touch up the brake knee units/);
      expect(bySt('finish')).toMatch(/Mask and touch up around the hull bushings/);
    });

    it(`${name}: no knee-bolt, backing-plate or backer text, no decision id, no part key and no leftover token in any step`, () => {
      const t = allStepText(data);
      expect(t).not.toMatch(/knee-bolt|knee bolt|backing plate|brake knee backers|Bolt each knee|nylock nuts sit on/i);
      expect(t).not.toMatch(/\bD-\d+\b|\{\{|brake-(sleeve|pin|tab)|kneeMount|0\.005/);
      for (const s of data.steps) {
        for (const id of tokensIn(itemsText(s.items.map((i) => ({ ...i }))))) expect(data.parts.some((x) => x.id === id), `${s.id}: ${id}`).toBe(true);
      }
      // decimals the shop would have to convert: none in the knee steps
      for (const id of ['frame', 'side-ribs', 'brake-knees', 'knee-swap', 'hang']) expect(stepText(stepById(data, id), data), id).not.toMatch(/\d\.\d{2,}"/);
    });

    it(`${name}: each new part is in exactly one step: the knee-side parts and the rail bushings at the knee step, the rib bushings at the rib step, the pins at the hang step`, () => {
      const seen = new Map<string, string[]>();
      for (const s of data.steps) for (const id of s.partIds) seen.set(id, [...(seen.get(id) ?? []), s.id]);
      for (const tag of ['L', 'R']) {
        expect(seen.get(`brake-sleeve-B-hull-${tag}`)).toEqual(['brake-knees']); // bedded at the knee step with the knee clamped on
        expect(seen.get(`brake-sleeve-T-hull-${tag}`)).toEqual(['side-ribs']);
        for (const id of ['brake-tab', 'brake-sleeve-B-knee', 'brake-sleeve-T-tab', 'brake-knee']) expect(seen.get(`${id}-${tag}`), id).toEqual(['brake-knees']);
        for (const id of ['brake-pin-B', 'brake-pin-T']) expect(seen.get(`${id}-${tag}`), id).toEqual(['hang']);
        for (const id of ['brake-backer', 'brake-backplate']) expect(seen.has(`${id}-${tag}`), id).toBe(false);
      }
      const ms = data.steps.map((s) => s.modelStep);
      for (let i = 1; i < ms.length; i++) expect(ms[i], data.steps[i].id).toBeGreaterThanOrEqual(ms[i - 1]);
    });

    it(`${name}: the spacing of the pin holes in the knee is the spacing of the sleeves in the hull`, () => {
      expect(Math.hypot(kp.B.x - kp.T.x, kp.B.z - kp.T.z)).toBeGreaterThan(8);
      expect(Math.hypot(kp.B.x - kp.T.x, kp.B.z - kp.T.z)).toBeLessThan(9);
    });
  }

  it('the underside finish and the gear fit no longer count the knees as on the hull', () => {
    const { data } = get('pins', WEATHER_SPEC.standard);
    const t = stepText(stepById(data, 'finish-under'), data);
    expect(t).toMatch(/brake knee units \(knee and tab\)/);
    expect(t).not.toMatch(/knee bolt/);
    expect(stepText(stepById(data, 'gear-fit'), data)).toMatch(/knees are not on the sled yet/);
  });
});

describe('D-78 the Verify items with the pins on', () => {
  for (const [name, w] of SPECS) {
    const { p, data } = get('pins', w);
    const kp = brakeGeometry(p, computeLayout(p)).pins!;
    const v = (id: string) => data.verify.find((c) => c.id === id)!;

    it(`${name}: retention rating and ${w === WEATHER_SPEC.extreme ? '316 availability' : 'the accepted grade'}, before ordering`, () => {
      const c = v('knee-pin-hardware');
      expect(c.when).toBe('before ordering');
      expect(c.whatToDo).toMatch(/pull-out rating/);
      expect(c.whatToDo).toMatch(/double-shear breaking strength, which is not the retention/);
      expect(c.whatToDo).toMatch(/\$25 each as an estimate, not a quote/);
      expect(c.paramKeys).toEqual(['brakePinRetentionLbf']);
      expect(c.pass).toMatch(new RegExp(`${p.brakePinRetentionLbf} lbf`));
      if (w === WEATHER_SPEC.extreme) {
        expect(c.whatToDo).toMatch(/316 ball-lock pin/);
        expect(c.whatToDo).toMatch(/17-4 PH/);
        expect(c.pass).toMatch(/316 pin is quoted, or 17-4 PH is written down as the exception/);
      } else {
        expect(c.whatToDo).toMatch(/17-4 PH is the usual grade and is accepted/);
      }
    });

    it(`${name}: pin fit and play in the sleeves, the knee seat, the top pin clearances and the first-brake-test wobble`, () => {
      expect(v('knee-pin-fit').whatToDo).toMatch(/about five thousandths of an inch of play/);
      expect(v('knee-pin-fit').whatToDo).not.toMatch(/0\.005/);
      expect(v('knee-pin-fit').whatToDo).toMatch(/Test the first pin before anything else is ordered or glued/);
      expect(v('knee-pin-fit').whatToDo).toMatch(/Reaming only enlarges the bore of a bought piece/);
      const clear = v('knee-pin-clearance').whatToDo;
      expect(clear).toMatch(/box tie spacer/);
      expect(clear).toMatch(/D-ring fender washers/);
      expect(clear).toMatch(/side sign/);
      expect(clear).toMatch(rx(`${f16(kp.clear.tabTopToWasher)}" under the bottom of the D-ring fender washers`.replace('""', '"')));
      const seat = v('knee-seat').whatToDo;
      expect(seat).toMatch(/lies on the web over the box rib, which backs the web there/);
      expect(seat).toMatch(/chine band/);
      expect(seat).toMatch(/50 lb/);
      expect(v('knee-seat').pass).toMatch(/No daylight under the tab or the leg/);
      const wob = v('knee-wobble');
      expect(wob.whatToDo).toMatch(new RegExp(`${p.brakeFlapSideLoadLbf} lb`));
      expect(wob.whatToDo).toMatch(/REMOVAL/);
      expect(wob.when).toBe('at assembly');
      // the one-knee test no longer says the knees are glued
      expect(v('brake-knee').whatToDo).not.toMatch(/BEFORE the knees are glued/);
    });

    it(`${name}: every check has its parts in the model and the numbering is unbroken`, () => {
      const idsOf = new Set(data.parts.map((x) => x.id));
      data.verify.forEach((c, i) => { expect(c.n).toBe(i + 1); for (const id of c.partIds) expect(idsOf.has(id), `${c.id}: ${id}`).toBe(true); });
      expect(v('knee-pin-fit').partIds).toEqual(expect.arrayContaining(['brake-pin-B-L', 'brake-sleeve-B-hull-L']));
    });
  }
  it('verifyChecklist() alone agrees', () => {
    const { p, data } = get('pins', WEATHER_SPEC.standard);
    expect(verifyChecklist(data.parts, p).map((c) => c.id)).toEqual(data.verify.map((c) => c.id));
  });
});

describe('D-78 the forms, drawings, finishing and package with the pins on', () => {
  for (const [name, w] of SPECS) {
    const { p, data } = get('pins', w);
    const bg = brakeGeometry(p, computeLayout(p));
    const kp = bg.pins!;
    const spacingT = frac(Math.hypot(kp.B.x - kp.T.x, kp.B.z - kp.T.z));
    const bT = frac(kp.B.z - bg.knee.zBot), tT = frac(kp.T.z - bg.knee.zBot);

    it(`${name}: the knee template adds the tab and the pin-hole plate with both hole points and their spacing`, () => {
      const k = data.forms.find((f) => f.id === 'brake-knee-template')!;
      expect(k.title).toMatch(/pin-hole plate/);
      expect(k.dims.map((q) => q.key)).toEqual(expect.arrayContaining(['pin-spacing', 'pin-b-height', 'pin-t-height']));
      expect(k.dims.find((q) => q.key === 'pin-spacing')!.text).toBe(spacingT);
      expect(k.dims.find((q) => q.key === 'pin-b-height')!.text).toBe(bT);
      expect(k.dims.find((q) => q.key === 'pin-t-height')!.text).toBe(tT);
      expect(k.dims.map((q) => q.key)).not.toContain('bolt-rows');
      expect(k.svg).toMatch(/PIN-HOLE PLATE/);
      expect(k.svg).toMatch(/tab \(glued to this face\)/);
      expect(k.svg).toMatch(rx(`bottom pin hole: ${bT.replace('"', '&quot;')} up`));
      expect(k.svg).toMatch(rx(`top pin hole: ${tT.replace('"', '&quot;')} up`));
      expect(k.svg).not.toMatch(/bolt rows/);
      expect(k.notes.join(' ')).toMatch(/hull's own/);
      expect(k.build.map((q) => q.step).join(' ')).toMatch(/pin-hole plate/);
      // the plate is two inside cuts (the two holes) and one outside cut
      expect((k.svg.match(/shaper:cutType="inside"/g) ?? []).length).toBeGreaterThanOrEqual(2);
      expect(k.svg).not.toMatch(/\bD-\d+\b/);
      // it still tiles on Letter pages
      expect(data.tiles.find((t) => t.id === 'brake-knee-template')!.pages.length).toBeGreaterThan(1);
    });

    it(`${name}: part drawings for the tab and the knee sleeves; one hole a place on the rail, tab, knee and rib; no backer or plate drawing`, () => {
      const sheet = (partNo: string) => data.partDrawings.find((s) => s.partNo === partNo)!;
      for (const n of ['brake-tab', 'brake-sleeve-B-knee', 'brake-sleeve-T-tab']) expect(sheet(n), n).toBeDefined(); // the hull bushings are bought: no drawing
      expect(data.partDrawings.some((s) => /brake-(backer|backplate)/.test(s.partNo))).toBe(false);
      const holes = (partNo: string) => sheet(partNo).features.filter((f) => f.kind === 'hole');
      expect(holes("rail").filter((f) => /flanged bushing/i.test(f.text))).toHaveLength(1);
      expect(holes("rail").find((f) => /flanged bushing/.test(f.text))!.text).toMatch(/5\/8" hole, through.*16-13\/16" from the REAR end, 1-1\/2" from the TOP edge/); // oversize, bedded round the knee's sleeve
      expect(holes('brake-tab')).toHaveLength(1);
      expect(holes('brake-tab')[0].text).toMatch(/33\/64" hole, through/);
      expect(holes('brake-tab')[0].text).toMatch(new RegExp(`1" from the REAR edge, ${rx(fin(kp.T.z - kp.tab.z0)).source} from the BOTTOM (edge|end)`));
      expect(holes('side-rib-box').filter((f) => /5\/8" hole/.test(f.text))).toHaveLength(1);
      expect(holes('side-rib-box').find((f) => /5\/8" hole/.test(f.text))!.text).toMatch(rx(`1" from the REAR edge, ${fin(kp.T.fromRibFoot)} from the BOTTOM end`));
      expect(holes('brake-knee').filter((f) => /33\/64" hole/.test(f.text))).toHaveLength(1);
      expect(holes('brake-knee').filter((f) => /INBOARD edge: \d+(-\d+\/\d+)?" from the BOTTOM end/.test(f.text))).toHaveLength(1); // no second, pin-clearance hole at the sleeve
      const words = (partNo: string): string => sheet(partNo).svg.replace(/<[^>]+>/g, ' ').replace(/&quot;|&#39;|&apos;/g, "'").replace(/\s+/g, ' ');
      for (const n of ['brake-sleeve-B-knee', 'brake-sleeve-T-tab']) { expect(holes(n)).toHaveLength(0); expect(words(n)).toMatch(/piece of stainless tube or a flanged bushing/); expect(words(n)).toMatch(/five thousandths of an inch/); }
      expect(words('brake-tab')).toMatch(/Glue the tab to the knee's rear face only/);
      expect(words('brake-tab')).toMatch(rx(`Grain runs up the ${fin(data.parts.find((x) => x.id === 'brake-tab-L')!.stock!.l)} side`.replace('"', "'")));
      expect(words('brake-tab')).toMatch(/AFTER it is glued to the knee/);
      expect(words('rail')).toMatch(/Lay the rail flat on the drill press, OUTBOARD face down, top edge against a fence/);
      expect(words('rail')).toMatch(/counterbore, .* deep, in the INBOARD face/);
      expect(words('rail')).not.toMatch(/on edge/);
      expect(words('side-rib-box')).toMatch(/full-width BLOCK, measured from the foot of the rib/);
      expect(words('side-rib-box')).toMatch(/Do not drill it on the bench/);
      expect(words('brake-knee')).toMatch(/pin-hole plate/);
      expect(words('brake-knee')).toMatch(/Then drill the top hole in the tab and, last, the bottom hole/);
    });

    it(`${name}: the finishing schedule seals the tab and the pad with the knee, on the bench with the underside`, () => {
      const parts = data.parts;
      expect(showRuleOf(parts.find((x) => x.id === 'brake-tab-L')!).show).toBe(0);
      const sand = data.finishing.steps.find((s) => s.id === 'sand')!;
      expect(JSON.stringify(sand)).toMatch(/brake knee units \(knee and tab\)/);
    });

    it(`${name}: the package lists the new drawings, none for the backer or plate, and the book carries the removal and refit steps`, () => {
      const names = data.files.map((f) => f.name);
      for (const n of ['brake-tab', 'brake-sleeve-B-knee', 'brake-sleeve-T-tab']) {
        const sh = data.partDrawings.find((s) => s.partNo === n)!;
        expect(names).toContain(drawingFileName(sh));
      }
      expect(names.some((n) => /brake-(backer|backplate)/.test(n))).toBe(false);
      const book = data.files.find((f) => f.name === 'build-book.html')!.data as string;
      expect(book).toMatch(/REMOVAL, about 15 s a side/);
      expect(book).toMatch(/REFIT, about 25 s a side/);
      expect(book).toMatch(/Brake knee tab/);
      expect(book).not.toMatch(/Bolt each knee|brake knee backers|backing plates for the knee nuts/);
      const zip = zipPackage(data);
      expect(zip.length).toBeGreaterThan(10000);
    });
  }
});
