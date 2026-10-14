/**
 * D-78 (the optional removable brake knee on clamped bolts, `kneeMount` = removable) in every build output. Both settings, both weather specs:
 *   - bolted (the default): nothing of the removable knee shows anywhere, and the knee is bolted as before (the older tests pin its text);
 *   - removable: the BOM, the cut list, the assembly steps (rail insert, rib insert, bench work on the knee, the fit, REMOVAL and REFIT), the Verify items, the knee template,
 *     the part drawings, the finishing schedule and the package all follow, in the shop's style (fractions, measured places, no internal names).
 * The price difference against the bolted knee is pinned section by section, as weather-spec.test.ts pins the weather difference.
 */
import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { KNEE_MOUNT, WEATHER_SPEC, defaultParams, type Params } from '../params';
import { brakeGeometry } from '../model/brake-layout';
import { computeLayout } from '../model/layout';
import { fin, tokensIn, type BuildStep } from './assembly';
import type { Bom, BomLine } from './bom';
import { BuildData, drawingFileName, zipPackage } from './package';
import { cutList } from './cutlist';
import { oakBoardFeet } from './nesting';
import { showRuleOf } from './finishing';
import { verifyChecklist } from './verify';


type Setting = 'bolted' | 'removable';
const mk = (setting: Setting, weather: number): { p: Params; data: BuildData } => {
  const p: Params = { ...defaultParams(), weatherSpec: weather, kneeMount: setting === 'removable' ? KNEE_MOUNT.removable : KNEE_MOUNT.bolted };
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
const lineOfPart = (b: Bom, prefix: string): BomLine | undefined => lines(b).find((l) => (l.partIds ?? []).some((i) => i.startsWith(prefix)));
/** Every word a step prints: goal, items with their sub-items (part tokens rendered), checks. */
const stepText = (s: BuildStep): string => [s.goal, ...s.instructions, ...s.checks, s.title].join('\n');
const allStepText = (d: BuildData): string => d.steps.map((s) => stepText(s)).join('\n');
const stepById = (d: BuildData, id: string): BuildStep => d.steps.find((s) => s.id === id)!;
/** Regex-safe text. */
const rx = (t: string): RegExp => new RegExp(t.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'));
const geom = (p: Params) => brakeGeometry(p, computeLayout(p)).removable!;

describe('D-78 the bolted knee (the default) shows nothing of the removable knee', () => {
  for (const [name, w] of SPECS) {
    it(`${name}: no bolt, insert, tab, ratchet or removal step anywhere; the knee bolts are still bought`, () => {
      const { p, data } = get('bolted', w);
      expect(brakeGeometry(p, computeLayout(p)).removable).toBeUndefined();
      expect(lines(data.bom).some((l) => /brake-(bolt|washer|insert)-|TOOL:|ratchet|dowel center/i.test(`${l.key} ${l.description} ${(l.partIds ?? []).join(' ')}`))).toBe(false);
      expect(lines(data.bom).some((l) => /3\/8-16 x 4"/.test(l.key))).toBe(true); // the four knee bolts a side
      expect(data.cutList.oak.flatMap((g) => g.rows).some((r) => /^brake-tab$/.test(r.partNo))).toBe(false);
      expect(data.steps.map((s) => s.id)).not.toContain('knee-swap');
      const text = allStepText(data);
      expect(text).not.toMatch(/REMOVAL|REFIT|ratchet|insert in the rail|match-drill/i);
      expect(text).toMatch(/Bolt each knee/);
      expect(data.verify.some((v) => /^knee-/.test(v.id))).toBe(false);
      expect(data.verify.flatMap((v) => v.paramKeys)).not.toEqual(expect.arrayContaining(['brakeBoltTorqueFtLb']));
      expect(data.verify.flatMap((v) => v.paramKeys)).not.toContain('brakeInsertWithdrawalFactor');
      const k = data.forms.find((f) => f.id === 'brake-knee-template')!;
      expect(k.dims.map((q) => q.key)).toContain('bolt-rows');
      expect(k.dims.map((q) => q.key)).not.toContain('bolt-b-height');
      expect(data.files.some((f) => /brake-tab/.test(f.name))).toBe(false);
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

describe('D-78 the BOM with the removable knee', () => {
  for (const [name, w] of SPECS) {
    const { p, data } = get('removable', w);
    const b = data.bom;
    const std = w === WEATHER_SPEC.standard;
    const unit = (kind: 'bolt' | 'washer' | 'insert') => (std ? { bolt: 1.5, washer: 0.6, insert: 4 } : { bolt: 2, washer: 0.8, insert: 5 })[kind];

    it(`${name}: bolts, washers and inserts are estimates, two of each place, one line for both sides`, () => {
      for (const kind of ['bolt', 'washer', 'insert'] as const) {
        for (const place of ['bottom', 'top']) {
          const l = lineOfPart(b, `brake-${kind}-${place}-`)!;
          expect(l, `${kind} ${place}`).toBeDefined();
          expect(l.qty).toBe(2);
          expect(l.unitUsd).toBe(unit(kind));
          expect(l.basis).toBe('estimate');
          expect(l.notes).toMatch(/not quoted/);
          expect(l.description).not.toMatch(/ [LR] /);
        }
      }
      const kp = geom(p);
      expect(lineOfPart(b, 'brake-bolt-bottom-')!.description).toContain(`${fin(kp.bottom.orderLen)} long`);
      expect(lineOfPart(b, 'brake-bolt-top-')!.description).toContain(`${fin(kp.top.orderLen)} long`);
      expect(lineOfPart(b, 'brake-insert-bottom-')!.notes).toMatch(/Verify/);
      expect(lineOfPart(b, 'brake-bolt-top-')!.description).toMatch(std ? /304/ : /316/);
      if (std) for (const k of ['bolt', 'washer', 'insert']) expect(lineOfPart(b, `brake-${k}-top-`)!.description).not.toMatch(/316/);
    });

    it(`${name}: a ratchet with a 9/16" socket and a dowel-center set are TOOL lines, flagged as maybe already owned`, () => {
      const r = lines(b).find((l) => /ratchet/.test(l.description))!;
      expect(r.description).toMatch(/^TOOL: /);
      expect(r.description).toMatch(/you may already own one/);
      expect(r.description).toMatch(/9\/16" deep socket/);
      expect(r.qty).toBe(1);
      expect(r.basis).toBe('estimate');
      expect(r.notes).toMatch(/not counted in the sled weight/);
      const d = lines(b).find((l) => /dowel centers/.test(l.description))!;
      expect(d.description).toMatch(/^TOOL: /);
      expect(d.basis).toBe('estimate');
    });

    it(`${name}: no pin, sleeve, tube, bearing washer, Domino 6x40, backing plate or knee bolt line`, () => {
      const t = JSON.stringify(lines(b).filter((l) => !/seat-back-latch|latch pin|Bridle|bridle/.test(`${l.key} ${l.description}`)));
      expect(t).not.toMatch(/ball-lock|quick-release|brake-pin|brake knee (top|bottom) pin|pin sleeve|bearing washer|backing plate|knee bolt/i);
      expect(lines(b).some((l) => /tube 1\/2" OD x 3\/8" ID/.test(l.key))).toBe(false);
      expect(lines(b).some((l) => /Domino DF 500 6x40/.test(l.key))).toBe(false);
      expect(lines(b).some((l) => /3\/8-16 x 4"/.test(l.key))).toBe(false);
      const bar = lines(b).find((l) => /flat bar 1\/8" x 2"/.test(l.key))!;
      expect(bar.qty).toBe(1);
      expect(bar.notes).toMatch(/two brake pivot straps/);
      expect(data.cutList.metal.some((m) => m.family === 'Stainless tube')).toBe(false);
    });

    it(`${name}: the lines carry no decision id or part key in their printed text`, () => {
      const text = JSON.stringify(lines(b).filter((l) => /brake-(bolt|washer|insert)|TOOL/.test(l.key + (l.partIds ?? []).join(' ') + l.description)).map((l) => [l.description, l.notes, l.materialNote]));
      expect(text).not.toMatch(/\bD-\d+\b/);
      expect(text).not.toMatch(/brake-(bolt|washer|insert|tab|knee)/);
    });
  }

  it('the cost against the bolted knee, section by section, both specs', () => {
    for (const [name, w] of SPECS) {
      const bp = get('removable', w).data.bom, bb = get('bolted', w).data.bom;
      const total = bp.totalUsd - bb.totalUsd;
      const sections: Record<string, number> = {};
      for (const s of bp.sections) sections[s.id] = Math.round((s.subtotalUsd - (bb.sections.find((q) => q.id === s.id)?.subtotalUsd ?? 0)) * 100) / 100;
      expect(Object.values(sections).reduce((a, v) => a + v, 0), name).toBeCloseTo(total, 1);
      // the sled itself costs a little more or less than bolted; the two tools (about $30) are the rest of the consumables
      const tools = 30;
      expect(sections.consumables, name).toBeGreaterThanOrEqual(tools - 1e-9);
      expect(total, name).toBeGreaterThan(0);
      expect(total, name).toBeLessThan(60);
    }
  });
});

describe('D-78 the cut list with the removable knee', () => {
  const { p, data } = get('removable', WEATHER_SPEC.standard);
  const rowOf = (partNo: string) => data.cutList.oak.flatMap((g) => g.rows).find((r) => r.partNo === partNo)!;

  it('has a tab (oak, grain vertical, from 5/4), two of them, rough sizes rounded up to 1/8, and no pad or tube', () => {
    const tab = rowOf('brake-tab');
    expect(tab.qty).toBe(2);
    expect(tab.board).toBe('5/4');
    expect(tab.grain).toBe('z');
    const m = data.parts.find((x) => x.id === 'brake-tab-L')!.stock!;
    expect(tab.stock.t).toBeCloseTo(1, 3);
    expect(tab.stock.l).toBeCloseTo(m.l, 6);
    for (const v of [tab.rough.t, tab.rough.w, tab.rough.l]) expect(v * 8).toBeCloseTo(Math.round(v * 8), 6);
    expect(data.cutList.cuts.find((c) => c.partNo === 'brake-tab')!.note).toMatch(/grain runs up/);
    expect(data.cutlistCsv).toMatch(/Brake knee tab/);
    expect(data.cutlistCsv).not.toMatch(/Brake knee pad/);
    expect(data.cutList.metal.some((x) => /tube/i.test(x.family) && /stainless/i.test(x.section ?? ''))).toBe(false);
  });

  it('the box rib is a 2" block and its filler is cut as the block is wide', () => {
    const rm = geom(p);
    expect(rm.rib.blockW).toBeCloseTo(2, 6);
    const rib = data.parts.find((x) => /^side-rib-box/.test(x.id) || /^side-rib-[LR]1$/.test(x.id));
    expect(rib).toBeDefined();
    const t = stepText(stepById(data, 'side-ribs'));
    expect(t).toMatch(/2" wide at the block/);
    expect(t).not.toMatch(/3" wide or more/);
  });

  it('keeps the knee laminate (the leg is taller over the top bolt) and has no backer or plate row', () => {
    const bolted = get('bolted', WEATHER_SPEC.standard).data;
    const kneeP = data.cutList.finished.find((f) => f.partNo === 'brake-knee')!, kneeB = bolted.cutList.finished.find((f) => f.partNo === 'brake-knee')!;
    const dims = (t: string) => t.split(' × ');
    expect(dims(kneeP.finalText)[0]).toBe(dims(kneeB.finalText)[0]);
    expect(dims(kneeP.finalText)[2]).toBe(dims(kneeB.finalText)[2]);
    expect(kneeP.final.w).toBeGreaterThan(kneeB.final.w);
    expect(data.cutList.finished.some((f) => /brake-backer/.test(f.partNo))).toBe(false);
    expect(data.cutList.metal.some((m) => /backplate/.test(m.partNo))).toBe(false);
  });

  it('plans the boards for about the same stock as the bolted sled', () => {
    const o = oakBoardFeet(data.parts, p), ob = oakBoardFeet(get('bolted', WEATHER_SPEC.standard).data.parts, get('bolted', WEATHER_SPEC.standard).p);
    expect(o.thicknesses.map((t) => t.board)).toEqual(ob.thicknesses.map((t) => t.board));
    expect(Math.abs(o.thicknesses.reduce((a, t) => a + t.purchaseBf, 0) - ob.thicknesses.reduce((a, t) => a + t.purchaseBf, 0))).toBeLessThan(2);
  });

  it('cutList() on the model alone agrees with the package', () => {
    expect(cutList(data.parts, p).cuts.length).toBe(data.cutList.cuts.length);
  });
});

describe('D-78 the assembly with the removable knee', () => {
  for (const [name, w] of SPECS) {
    const { p, data } = get('removable', w);
    const kp = geom(p);

    it(`${name}: the frame step drills and sets the bottom insert in each rail, flat against a fence, counterbore first`, () => {
      const t = stepText(stepById(data, 'frame'));
      expect(t).toMatch(/outboard face down, its top edge against a fence/);
      expect(t).toMatch(rx(`${fin(kp.bottom.belowRailTop)} down from the rail's top edge`));
      expect(t).toMatch(rx(`${fin(kp.bottom.fromRailRear)} from the finished rear end`));
      expect(t).toMatch(rx(`${fin(kp.bottom.insert.cboreDia)} Forstner ${fin(kp.bottom.insert.cboreDepth)} deep`));
      expect(t).toMatch(/13\/32" bit/);
      expect(t).toMatch(/waxed 3\/8-16 bolt/);
      expect(t).not.toMatch(/on edge/);
    });

    it(`${name}: the rib step sets the top insert in each box rib block before the box goes in, and match-drills the knees`, () => {
      const t = stepText(stepById(data, 'side-ribs'));
      expect(t).toMatch(/BEFORE the storage box goes in/);
      expect(t).toMatch(rx(`${fin(kp.top.fromRibFoot)} up from the BOTTOM end of the rib`));
      expect(t).toMatch(rx(`${fin(kp.top.insert.cboreDia)} Forstner, ${fin(kp.top.insert.cboreDepth)} deep`));
      expect(t).toMatch(/dowel center/);
      expect(t).toMatch(/match-drill/);
      expect(t).toMatch(/Try the real bolts/);
    });

    it(`${name}: the knee step is bench work: the tab from one stick, glued with no Domino and no screw, bolt holes left undrilled`, () => {
      const s = stepById(data, 'brake-knees');
      const t = stepText(s);
      expect(s.title).toMatch(/shape the knee and glue on its tab/);
      expect(t).toMatch(/mill ONE 12" stick/);
      expect(t).toMatch(/No screw is needed/);
      expect(t).toMatch(/leave the knee units bare and without bolt holes/);
      expect(t).not.toMatch(/Domino|sleeve|ream|pin-hole plate/i);
      expect(t).toMatch(rx(`${fin(kp.tab.z1 - kp.tab.z0)} (T`.replace(' (T', '')));
    });

    it(`${name}: the fit step puts washers under the heads, the bottom bolt first, tightens to about 15 ft-lb and stores the ratchet in the box`, () => {
      const t = stepText(stepById(data, 'hang'));
      expect(t).toMatch(/Fit the brake knees, each with its flap on/);
      expect(t).toMatch(/washer under each bolt head/);
      expect(t).toMatch(/Bottom bolt first/);
      expect(t).toMatch(new RegExp(`firm hand ratchet, about ${p.brakeBoltTorqueFtLb} ft-lb`));
      expect(t).toMatch(rx(`bottom bolt is ${fin(kp.bottom.orderLen)} long and the top bolt ${fin(kp.top.orderLen)}`));
      expect(t).toMatch(/Put the ratchet and the socket in the storage box/);
    });

    it(`${name}: REMOVAL and REFIT are timed, the chock rides with its knee, and the Transport note names the ratchet`, () => {
      const s = stepById(data, 'knee-swap');
      const t = stepText(s);
      expect(t).toMatch(/REMOVAL, about a minute a side/);
      expect(t).toMatch(/REFIT, about two minutes a side/);
      expect(t).toMatch(/chock rides with its knee|chock stay on the knee/);
      expect(t).toMatch(/Transport mode/);
      expect(t).toMatch(/ratchet and the 9\/16" socket ride in the storage box/);
      expect(t).toMatch(/after the first outing/);
      expect(s.tools.join(' ')).toMatch(/ratchet/);
    });

    it(`${name}: no pin, sleeve, Domino or bearing-washer text in the knee steps, no decision id, no part key, no leftover token`, () => {
      for (const id of ['frame', 'side-ribs', 'brake-knees', 'knee-swap', 'hang']) {
        const t = stepText(stepById(data, id));
        const knee = t.split('\n').filter((l) => /knee|insert|bolt/i.test(l) && !/bridle/i.test(l)).join('\n');
        expect(knee, id).not.toMatch(/ball-lock|quick-release|sleeve|bearing washer|backing plate|brake knee backers|top pin|bottom pin/i);
        expect(t, id).not.toMatch(/\bD-\d+\b|\{\{|brake-(sleeve|pin|tab|bolt|insert)|kneeMount/);
        expect(t, id).not.toMatch(/\d\.\d{2,}"/);
      }
      for (const s of data.steps) for (const id of tokensIn(s.instructions.join('\n'))) expect(data.parts.some((x) => x.id === id), `${s.id}: ${id}`).toBe(true);
    });

    it(`${name}: each new part is in exactly one step: inserts at the frame and rib steps, knee and tab at the knee step, bolts and washers at the hang step`, () => {
      const seen = new Map<string, string[]>();
      for (const s of data.steps) for (const id of s.partIds) seen.set(id, [...(seen.get(id) ?? []), s.id]);
      for (const tag of ['L', 'R']) {
        expect(seen.get(`brake-insert-bottom-${tag}`)).toEqual(['frame']);
        expect(seen.get(`brake-insert-top-${tag}`)).toEqual(['side-ribs']);
        for (const id of ['brake-tab', 'brake-knee']) expect(seen.get(`${id}-${tag}`), id).toEqual(['brake-knees']);
        for (const id of ['brake-bolt-bottom', 'brake-bolt-top', 'brake-washer-bottom', 'brake-washer-top']) expect(seen.get(`${id}-${tag}`), id).toEqual(['hang']);
      }
      const ms = data.steps.map((s) => s.modelStep);
      for (let i = 1; i < ms.length; i++) expect(ms[i], data.steps[i].id).toBeGreaterThanOrEqual(ms[i - 1]);
    });
  }

  it('the underside finish and the gear fit no longer count the knees as on the hull', () => {
    const { data } = get('removable', WEATHER_SPEC.standard);
    const t = stepText(stepById(data, 'finish-under'));
    expect(t).toMatch(/brake knee units \(knee and tab\)/);
    expect(t).not.toMatch(/knee bolt/);
    expect(stepText(stepById(data, 'gear-fit'))).toMatch(/knees are not on the sled yet/);
  });
});

describe('D-78 the Verify items with the removable knee', () => {
  for (const [name, w] of SPECS) {
    const { p, data } = get('removable', w);
    const kp = geom(p);
    const v = (id: string) => data.verify.find((c) => c.id === id)!;

    it(`${name}: insert stock before ordering, and the pull-out and torque-out test on scrap oak`, () => {
      const s = v('knee-insert-stock');
      expect(s.when).toBe('before ordering');
      expect(s.whatToDo).toMatch(/flange/);
      expect(s.whatToDo).toMatch(/thread/);
      const t = v('knee-insert-pullout');
      expect(t.whatToDo).toMatch(/scrap/i);
      expect(t.whatToDo).toMatch(new RegExp(`${p.brakeBoltTorqueFtLb} ft-lb`));
      expect(t.paramKeys).toEqual(['brakeInsertWithdrawalFactor']);
    });

    it(`${name}: bolt grip and tip clearance, the knee seat and the first-brake-test wobble with a retorque`, () => {
      const c = v('knee-bolt-clearance');
      expect(c.whatToDo).toMatch(rx(`about ${fin(Math.round(kp.clear.boltTipToBox * 16) / 16)} is left to the storage box side`));
      expect(c.whatToDo).toMatch(/grip/);
      expect(v('knee-seat').whatToDo).toMatch(/chine band/);
      expect(v('knee-seat').pass).toMatch(/No daylight/);
      const wob = v('knee-wobble');
      expect(wob.whatToDo).toMatch(new RegExp(`${p.brakeFlapSideLoadLbf} lb`));
      expect(wob.whatToDo).toMatch(/first outing/);
      expect(wob.paramKeys).toEqual(expect.arrayContaining(['brakeBoltTorqueFtLb', 'brakeBoltNutFactor']));
      expect(v('brake-knee').whatToDo).toMatch(/before any tab or bolt hole goes on a knee/);
      expect(data.verify.some((c) => /knee-pin/.test(c.id))).toBe(false);
    });

    it(`${name}: every check has its parts in the model and the numbering is unbroken`, () => {
      const idsOf = new Set(data.parts.map((x) => x.id));
      data.verify.forEach((c, i) => { expect(c.n).toBe(i + 1); for (const id of c.partIds) expect(idsOf.has(id), `${c.id}: ${id}`).toBe(true); });
    });
  }
  it('verifyChecklist() alone agrees', () => {
    const { p, data } = get('removable', WEATHER_SPEC.standard);
    expect(verifyChecklist(data.parts, p).map((c) => c.id)).toEqual(data.verify.map((c) => c.id));
  });
});

describe('D-78 the forms, drawings, finishing and package with the removable knee', () => {
  for (const [name, w] of SPECS) {
    const { p, data } = get('removable', w);
    const bg = brakeGeometry(p, computeLayout(p));

    it(`${name}: the knee template shows the tab and the approximate bolt heights, match-drilled, with no pin-hole plate`, () => {
      const k = data.forms.find((f) => f.id === 'brake-knee-template')!;
      expect(k.dims.map((q) => q.key)).toEqual(expect.arrayContaining(['bolt-b-height', 'bolt-t-height']));
      expect(k.dims.map((q) => q.key)).not.toContain('bolt-rows');
      expect(k.svg).toMatch(/tab \(glued to this face\)/);
      expect(k.svg).toMatch(/match-drilled/);
      expect(k.svg).not.toMatch(/PIN-HOLE PLATE/i);
      expect(k.notes.join(' ')).toMatch(/match-drilled/);
      expect(k.svg).not.toMatch(/\bD-\d+\b/);
      expect(data.tiles.find((t) => t.id === 'brake-knee-template')!.pages.length).toBeGreaterThan(1);
      expect(bg.removable).toBeDefined();
    });

    it(`${name}: part drawings for the tab; hole notes on the rail, rib and knee; no sleeve, backer or plate drawing`, () => {
      const sheet = (partNo: string) => data.partDrawings.find((s) => s.partNo === partNo)!;
      expect(sheet('brake-tab')).toBeDefined();
      expect(data.partDrawings.some((s) => /sleeve|brake-(backer|backplate)/.test(s.partNo))).toBe(false);
      const words = (partNo: string): string => sheet(partNo).svg.replace(/<[^>]+>/g, ' ').replace(/&quot;|&#39;|&apos;/g, "'").replace(/\s+/g, ' ');
      expect(words('rail')).toMatch(/OUTBOARD face down, top edge against a fence/);
      expect(words('rail')).toMatch(/counterbore/i);
      expect(words('rail')).not.toMatch(/on edge/);
      expect(words('side-rib-box')).toMatch(/foot of the rib/);
      expect(words('side-rib-box')).toMatch(/before the (storage )?box goes in/i);
      expect(words('brake-tab')).toMatch(/match-drilled|Match-drilled/);
      expect(words('brake-knee')).toMatch(/match-drilled|Match-drilled/);
    });

    it(`${name}: the finishing schedule seals the tab with the knee, on the bench with the underside`, () => {
      expect(showRuleOf(data.parts.find((x) => x.id === 'brake-tab-L')!).show).toBe(0);
      const sand = data.finishing.steps.find((s) => s.id === 'sand')!;
      expect(JSON.stringify(sand)).toMatch(/brake knee units \(knee and tab\)/);
    });

    it(`${name}: the package lists the tab drawing, none for the sleeve, backer or plate, and the book carries the removal and refit steps`, () => {
      const names = data.files.map((f) => f.name);
      expect(names).toContain(drawingFileName(data.partDrawings.find((s) => s.partNo === 'brake-tab')!));
      expect(names.some((n) => /sleeve|brake-(backer|backplate)/.test(n))).toBe(false);
      const book = data.files.find((f) => f.name === 'build-book.html')!.data as string;
      expect(book).toMatch(/REMOVAL, about a minute a side/);
      expect(book).toMatch(/REFIT, about two minutes a side/);
      expect(book).not.toMatch(/Bolt each knee|brake knee backers|backing plates for the knee nuts/);
      expect(zipPackage(data).length).toBeGreaterThan(10000);
    });
  }
});
