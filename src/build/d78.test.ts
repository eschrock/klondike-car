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
import { bom, type Bom, type BomLine } from './bom';
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
const stepText = (s: BuildStep, d: BuildData): string => [s.goal, ...s.instructions, ...s.checks, s.title].join('\n');
const allStepText = (d: BuildData): string => d.steps.map((s) => stepText(s, d)).join('\n');
const itemsText = (items: Instr[]): string => flattenInstr(items, () => undefined).join('\n');
const stepById = (d: BuildData, id: string): BuildStep => d.steps.find((s) => s.id === id)!;
/** A length as the Verify text writes it: to the nearest 1/16. */
const f16 = (v: number): string => fin(Math.round(v * 16) / 16);
/** Regex-safe text. */
const rx = (t: string): RegExp => new RegExp(t.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'));

describe('D-78 the bolted knee (the default) shows nothing of the pins', () => {
  for (const [name, w] of SPECS) {
    it(`${name}: no pin, sleeve, tab, pad, plate or removal step anywhere; the knee bolts are still bought`, () => {
      const { p, data } = get('bolted', w);
      expect(brakeGeometry(p, computeLayout(p)).pins).toBeUndefined();
      expect(lines(data.bom).some((l) => /brake-pin|brake knee (top|bottom) pin|ball-lock|pin sleeve/i.test(`${l.key} ${l.description}`))).toBe(false);
      expect(lines(data.bom).some((l) => /3\/8-16 x 4"/.test(l.key))).toBe(true); // the four knee bolts a side
      expect(data.cutList.metal.some((m) => m.family === 'Stainless tube')).toBe(false);
      expect(data.cutList.oak.flatMap((g) => g.rows).some((r) => /^brake-(tab|knee-pad)$/.test(r.partNo))).toBe(false);
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
      expect(data.files.some((f) => /brake-(tab|knee-pad|sleeve|pin)/.test(f.name))).toBe(false);
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

    it(`${name}: the grade text is ${name === 'Standard' ? '304 class with 17-4 PH accepted' : '316 with a 316 pin that must be sourced'}`, () => {
      const l = b.sections.find((s) => s.id === 'purchased')!.lines.find((q) => (q.partIds ?? []).some((i) => i.startsWith('brake-pin-B')))!;
      if (w === WEATHER_SPEC.standard) {
        expect(l.notes).toMatch(/Standard grade \(304 class\).*17-4 PH.*accepted/);
        expect(l.materialNote).toMatch(/17-4 PH/);
        expect(`${l.key} ${l.description} ${l.vendor ?? ''}`).not.toMatch(/316/);
      } else {
        expect(l.notes).toMatch(/Extreme grade \(316\).*17-4 PH.*NOT 316.*316 pin must be sourced/);
        expect(l.materialNote).toMatch(/316 stainless REQUIRED/);
        expect(l.description).toMatch(/316/);
      }
      expect(l.notes).toMatch(/pull-out rating/);
    });

    it(`${name}: eight sleeves are cut from ONE length of stainless tube, bought as one piece (an estimate)`, () => {
      const tube = b.sections.find((s) => s.id === 'metal')!.lines.find((l) => /tube 1\/2" OD x 3\/8" ID/.test(l.key))!;
      expect(tube).toBeDefined();
      expect(tube.key).toMatch(w === WEATHER_SPEC.standard ? /^18-8 \(304\)/ : /^316/);
      expect(tube.qty).toBe(1);
      expect(tube.unit).toBe('12 in length');
      expect(tube.unitUsd).toBe(9);
      expect(tube.basis).toBe('estimate');
      expect(tube.notes).toMatch(/ESTIMATE, not quoted/);
      expect(tube.notes).toMatch(/bushing/); // the other way to buy them
      // 2 x (3/4 rail, 1-3/4 knee leg, 1-3/16 box rib, 1 tab): 8 sleeves
      const rows = data.cutList.metal.filter((m) => m.family === 'Stainless tube');
      expect(rows.reduce((a, r) => a + r.qty, 0)).toBe(8);
      expect(rows.map((r) => r.cutLengthIn).sort((a, c) => a - c)).toEqual([0.75, 1, 1.1875, 1.75]);
      for (const r of rows) expect(r.cutLengthIn * 16).toBeCloseTo(Math.round(r.cutLengthIn * 16), 6); // rounded UP to 1/16
      expect(tube.notes).toMatch(/2 × 1-3\/4"/);
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
      // four pins at $25, an estimate
      expect(sections.purchased, name).toBe(100);
      // one 12 in length of tube ($9) in, one 12 in piece of 1/8 x 2 flat bar ($15: the backing plates) out
      expect(sections.metal, name).toBe(-6);
      // the knee bolts, nuts and washers (3/8-16 x 4, 26 nylock nuts and 16 fender washers of the sled) leave the fasteners
      expect(sections.fasteners, name).toBeLessThan(-10);
      expect(sections.lumber, name).toBeGreaterThanOrEqual(0); // the tab (5/4) and the pad (4/4) come from the same boards or a little more
      expect(sections.lumber, name).toBeLessThan(15);
      out[name] = { total, sections };
    }
    // the pins cost more than the bolts they replace: about +$80 Standard and +$57 Extreme at the researched prices (ball-lock pins estimated at $25)
    expect(out.Standard.total).toBeGreaterThan(60);
    expect(out.Standard.total).toBeLessThan(105);
    expect(out.Extreme.total).toBeGreaterThan(40);
    expect(out.Extreme.total).toBeLessThan(90);
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

  it('has a tab (oak, grain vertical, from 5/4) and a pad (oak, from 4/4 planed thin), two of each, rough sizes rounded up to 1/8', () => {
    const tab = rowOf('brake-tab'), pad = rowOf('brake-knee-pad');
    expect([tab.qty, pad.qty]).toEqual([2, 2]);
    expect(tab.board).toBe('5/4');
    expect(pad.board).toBe('4/4');
    expect(tab.grain).toBe('z');
    expect(pad.grain).toBe('z');
    // the tab: 1" x 1-21/32 x 2-13/32 finished, the "1 x 2-3/8 x 2-7/16" class
    expect(tab.stock.t).toBeCloseTo(1, 3);
    expect(tab.stock.l).toBeGreaterThan(2.3);
    expect(tab.stock.l).toBeLessThan(2.6);
    for (const r of [tab, pad]) for (const v of [r.rough.t, r.rough.w, r.rough.l]) expect(v * 8, r.partNo).toBeCloseTo(Math.round(v * 8), 6);
    // the cut list tells the shop how: plane a longer piece, then crosscut
    const cuts = data.cutList.cuts;
    expect(cuts.find((c) => c.partNo === 'brake-knee-pad')!.note).toMatch(/plane a longer piece/);
    expect(cuts.find((c) => c.partNo === 'brake-tab')!.note).toMatch(/grain runs up/);
    expect(data.cutlistCsv).toMatch(/Brake knee tab/);
    expect(data.cutlistCsv).toMatch(/Brake knee pad/);
    // and each is a finished part
    expect(data.cutList.finished.map((f) => f.partNo)).toEqual(expect.arrayContaining(['brake-tab', 'brake-knee-pad']));
  });

  it('keeps the knee as it is (same laminate, same finished size) and has no backer or plate row', () => {
    const bolted = get('bolted', WEATHER_SPEC.standard).data;
    const kneeP = data.cutList.finished.find((f) => f.partNo === 'brake-knee')!, kneeB = bolted.cutList.finished.find((f) => f.partNo === 'brake-knee')!;
    expect(kneeP.finalText).toBe(kneeB.finalText);
    expect(data.cutList.glueUps.find((g) => g.partNo === 'brake-knee')!.finalText).toBe(bolted.cutList.glueUps.find((g) => g.partNo === 'brake-knee')!.finalText);
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

    it(`${name}: the frame step drills ONE bottom-pin hole a rail (drill press, on edge against a fence, from the rear end and the top edge), no knee-bolt holes and no backers`, () => {
      const t = bySt('frame');
      expect(t).toMatch(/one bottom-pin hole through each rail/);
      expect(t).toMatch(/on the drill press/);
      expect(t).toMatch(/Stand the rail on its edge against a fence/);
      expect(t).toMatch(rx(`${fin(kp.B.belowRailTop)} down from the rail's top edge`));
      expect(t).toMatch(rx(`${fin(kp.B.fromRailRear)} from the finished rear end`));
      expect(t).toMatch(/1\/2" in from the rear end/); // the rail is still long at the rear
      expect(t).toMatch(rx(`(${fin(kp.B.fromRailRear + 0.5)} from the end of the rail)`));
      expect(t).toMatch(/Epoxy a sleeve into each hole/);
      expect(t).not.toMatch(/knee-bolt/);
      expect(t).not.toMatch(/brake knee backers/);
      expect(t).not.toMatch(/backing plates/);
      expect(stepById(data, 'frame').partIds).toEqual(expect.arrayContaining(['brake-sleeve-B-hull-L', 'brake-sleeve-B-hull-R']));
      expect(stepById(data, 'frame').tools).toContain('fence');
    });

    it(`${name}: the rib step drills the top-pin hole after the rib is glued, with a drill block, from the rib head's named edges, and epoxies the sleeve flush with the web`, () => {
      const t = bySt('side-ribs');
      expect(t).toMatch(/Once the rib epoxy has cured, drill the top-pin hole through each box rib head/);
      expect(t).toMatch(/drill block/);
      expect(t).toMatch(/1" in from the REAR edge of the head/);
      expect(t).toMatch(rx(`${fin(kp.T.belowRibTop)} down from the TOP edge of the head`));
      expect(t).toMatch(rx(`${fin(kp.T.fromRibFoot)} up from the BOTTOM end of the rib`));
      expect(t).toMatch(rx(`${fin(kp.T.hullSleeve.len)} deep in all`));
      expect(t).toMatch(/flush with the web's outer face/);
      expect(stepById(data, 'side-ribs').partIds).toEqual(expect.arrayContaining(['brake-sleeve-T-hull-L', 'brake-sleeve-T-hull-R']));
      // the sleeve is fitted at the rib step, after the ribs, not at the frame
      const ids = data.steps.map((s) => s.id);
      expect(ids.indexOf('frame')).toBeLessThan(ids.indexOf('brake-knees'));
      expect(ids.indexOf('brake-knees')).toBeLessThan(ids.indexOf('side-ribs'));
      expect(ids.indexOf('side-ribs')).toBeLessThan(ids.indexOf('brake-flaps'));
    });

    it(`${name}: the knee step is bench work: tab, pad, holes from the pin-hole plate, sleeves; the knee is not glued or bolted to the hull`, () => {
      const s = stepById(data, 'brake-knees');
      const t = stepText(s, data);
      expect(s.title).toMatch(/bench work, off the hull/);
      expect(t).toMatch(/not glued or bolted to the hull/);
      expect(t).toMatch(/Epoxy a tab to the rear face of each knee/);
      expect(t).toMatch(/Epoxy a pad to the inboard face of each knee/);
      expect(t).toMatch(rx(`${fin(kp.tab.z0 - bg.knee.zBot)} up from the knee's bottom end`)); // the tab
      expect(t).toMatch(rx(`${fin(kp.pad.z0 - bg.knee.zBot)} up from the knee's bottom end`)); // the pad
      expect(t).toMatch(/pin-hole plate/);
      expect(t).toMatch(rx(`${fin(kp.B.fromKneeRear)} from the knee's rear face`)); // hole B
      expect(t).toMatch(rx(`${fin(kp.B.fromKneeBottom)} up from the knee's bottom end`));
      expect(t).toMatch(rx(`${fin(p.brakeTabEndIn)} from the tab's rear end and ${fin(kp.T.z - kp.tab.z0)} up from the tab's bottom edge`)); // hole T
      expect(t).toMatch(rx(spacing)); // the spacing between the holes
      expect(t).toMatch(/Epoxy a sleeve into each hole/);
      expect(t).toMatch(/five thousandths of an inch/);
      expect(t).toMatch(/no screw is needed/i); // no new wood-screw size
      expect(t).not.toMatch(/Bolt each knee|nylock|backing plate|backers/);
      expect(s.partIds).toEqual(expect.arrayContaining(['brake-tab-L', 'brake-tab-R', 'brake-knee-pad-L', 'brake-knee-pad-R', 'brake-sleeve-B-knee-L', 'brake-sleeve-T-tab-R']));
      expect(s.partIds).not.toContain('brake-pin-B-L'); // the pins go on at the hang step
    });

    it(`${name}: the fit step puts the knee on with the two pins; REMOVAL and REFIT are clear steps; Transport mode says the knees come off`, () => {
      const hang = bySt('hang');
      expect(hang).toMatch(/Fit the brake knees, each with its flap on/);
      expect(hang).toMatch(/Push the bottom pin through the knee leg and the rail, then the top pin through the tab, the web and the rib head/);
      expect(stepById(data, 'hang').partIds).toEqual(expect.arrayContaining(['brake-pin-B-L', 'brake-pin-B-R', 'brake-pin-T-L', 'brake-pin-T-R']));
      const ids = data.steps.map((s) => s.id);
      expect(ids.indexOf('knee-swap')).toBe(ids.indexOf('hang') + 1);
      const swap = bySt('knee-swap');
      expect(swap).toMatch(/REMOVAL, about 15 s a side/);
      expect(swap).toMatch(/pull the top pin first/);
      expect(swap).toMatch(/Lift the knee and the flap off the side as one piece/);
      expect(swap).toMatch(/REFIT, about 25 s a side/);
      expect(swap).toMatch(/Set the knee on the hull/);
      expect(swap).toMatch(/Slide the tab over the rib head/);
      expect(swap).toMatch(/Push the bottom pin in from the outside/);
      expect(swap).toMatch(/Transport mode: the knees come off with the brakes/);
      expect(stepById(data, 'knee-swap').kind).toBe('process');
      // the flap step says the flap comes off WITH the knee
      expect(bySt('brake-flaps')).toMatch(/Removable, knee and flap together/);
    });

    it(`${name}: no knee-bolt, backing-plate or backer text, no decision id, no part key and no leftover token in any step`, () => {
      const t = allStepText(data);
      expect(t).not.toMatch(/knee-bolt|knee bolt|backing plate|brake knee backers|Bolt each knee|nylock nuts sit on/i);
      expect(t).not.toMatch(/\bD-\d+\b|\{\{|brake-(sleeve|pin|tab|knee-pad)|kneeMount/);
      for (const s of data.steps) {
        for (const id of tokensIn(itemsText(s.items.map((i) => ({ ...i }))))) expect(data.parts.some((x) => x.id === id), `${s.id}: ${id}`).toBe(true);
      }
      // decimals the shop would have to convert: none in the knee steps
      for (const id of ['frame', 'side-ribs', 'brake-knees', 'knee-swap', 'hang']) expect(stepText(stepById(data, id), data), id).not.toMatch(/\d\.\d{2,}"/);
    });

    it(`${name}: each new part is in exactly one step, the knee-side parts at the knee step, the hull sleeves at the frame and rib steps, the pins at the hang step`, () => {
      const seen = new Map<string, string[]>();
      for (const s of data.steps) for (const id of s.partIds) seen.set(id, [...(seen.get(id) ?? []), s.id]);
      for (const tag of ['L', 'R']) {
        expect(seen.get(`brake-sleeve-B-hull-${tag}`)).toEqual(['frame']);
        expect(seen.get(`brake-sleeve-T-hull-${tag}`)).toEqual(['side-ribs']);
        for (const id of ['brake-tab', 'brake-knee-pad', 'brake-sleeve-B-knee', 'brake-sleeve-T-tab', 'brake-knee']) expect(seen.get(`${id}-${tag}`), id).toEqual(['brake-knees']);
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
    expect(t).toMatch(/brake knee units \(knee, tab and pad\)/);
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

    it(`${name}: pin fit and play in the sleeves, the pad on the recessed web, the top pin clearances and the first-brake-test wobble`, () => {
      expect(v('knee-pin-fit').whatToDo).toMatch(/five thousandths of an inch \(0\.005"\)/);
      expect(v('knee-pin-fit').whatToDo).toMatch(/Do not ream/);
      const clear = v('knee-pin-clearance').whatToDo;
      expect(clear).toMatch(/box tie spacer/);
      expect(clear).toMatch(/D-ring fender washers/);
      expect(clear).toMatch(/side sign/);
      expect(clear).toMatch(rx(`${f16(kp.clear.tabTopToWasher)}" under the bottom of the D-ring fender washers`.replace('""', '"')));
      const seat = v('knee-seat').whatToDo;
      expect(seat).toMatch(/recess of the web/);
      expect(seat).toMatch(/chine band/);
      expect(seat).toMatch(/50 lb/);
      expect(v('knee-seat').pass).toMatch(/No daylight under the pad/);
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
      expect(k.svg).not.toMatch(/\bD-\d+\b|brake-knee-pad/);
      // it still tiles on Letter pages
      expect(data.tiles.find((t) => t.id === 'brake-knee-template')!.pages.length).toBeGreaterThan(1);
    });

    it(`${name}: part drawings for the tab, pad and sleeves; one hole a place on the rail, tab, knee and rib; no backer or plate drawing`, () => {
      const sheet = (partNo: string) => data.partDrawings.find((s) => s.partNo === partNo)!;
      for (const n of ['brake-tab', 'brake-knee-pad', 'brake-sleeve-B-hull', 'brake-sleeve-B-knee', 'brake-sleeve-T-hull', 'brake-sleeve-T-tab']) expect(sheet(n), n).toBeDefined();
      expect(data.partDrawings.some((s) => /brake-(backer|backplate)/.test(s.partNo))).toBe(false);
      const holes = (partNo: string) => sheet(partNo).features.filter((f) => f.kind === 'hole');
      expect(holes('rail').filter((f) => /brake pin|sleeve/i.test(f.text))).toHaveLength(1);
      expect(holes('rail').find((f) => /sleeve B/.test(f.text))!.text).toMatch(/1\/2" hole, through.*16-13\/16" from the REAR end, 1-1\/2" from the TOP edge/);
      expect(holes('brake-tab')).toHaveLength(1);
      expect(holes('brake-tab')[0].text).toMatch(/1" from the REAR edge, 1-3\/16" from the BOTTOM edge/);
      expect(holes('side-rib-box').filter((f) => /sleeve T/.test(f.text))).toHaveLength(1);
      expect(holes('side-rib-box').find((f) => /sleeve T/.test(f.text))!.text).toMatch(/1" from the REAR edge, 3-5\/8" from the BOTTOM end/);
      expect(holes('brake-knee').filter((f) => /sleeve B/.test(f.text))).toHaveLength(1);
      expect(holes('brake-knee').filter((f) => /INBOARD edge: \d+(-\d+\/\d+)?" from the TOP end/.test(f.text))).toHaveLength(1); // no second, pin-clearance hole at the sleeve
      const words = (partNo: string): string => sheet(partNo).svg.replace(/<[^>]+>/g, ' ').replace(/&quot;|&#39;|&apos;/g, "'").replace(/\s+/g, ' ');
      for (const n of ['brake-sleeve-B-hull', 'brake-sleeve-T-hull']) { expect(holes(n)).toHaveLength(0); expect(words(n)).toMatch(/plain piece of stainless tube/); expect(words(n)).toMatch(/five thousandths of an inch/); }
      expect(words('brake-tab')).toMatch(/glued to the knee's rear face only/);
      expect(words('brake-knee-pad')).toMatch(/Plane a longer piece/);
      expect(words('rail')).toMatch(/drill press with the rail on edge against a fence/);
      expect(words('side-rib-box')).toMatch(/Drill it after the rib is glued in/);
      expect(words('brake-knee')).toMatch(/pin-hole plate/);
    });

    it(`${name}: the finishing schedule seals the tab and the pad with the knee, on the bench with the underside`, () => {
      const parts = data.parts;
      expect(showRuleOf(parts.find((x) => x.id === 'brake-tab-L')!).show).toBe(0);
      expect(showRuleOf(parts.find((x) => x.id === 'brake-knee-pad-L')!).show).toBe(0);
      const sand = data.finishing.steps.find((s) => s.id === 'sand')!;
      expect(JSON.stringify(sand)).toMatch(/brake knee units \(knee, tab and pad\)/);
    });

    it(`${name}: the package lists the new drawings, none for the backer or plate, and the book carries the removal and refit steps`, () => {
      const names = data.files.map((f) => f.name);
      for (const n of ['brake-tab', 'brake-knee-pad', 'brake-sleeve-B-hull', 'brake-sleeve-T-tab']) {
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
