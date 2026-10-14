import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { computeLayout } from '../model/layout';
import { defaultParams } from '../params';
import { cutListFor, drawnParts, frac, partDims, partDrawings } from './part-drawings';
import { roughFrac } from './units';

const p = defaultParams();
const parts = buildModel(p);
const L = computeLayout(p);
const sheets = partDrawings(parts, p);
const texts = (svg: string): string[] => [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));

describe('part drawings', () => {
  it('formats fractions to 1/32 and drills to 1/64, never decimals', () => {
    expect(frac(2.375)).toBe('2-3/8"');
    expect(frac(1.097)).toBe('1-3/32"');
    expect(frac(0.0625)).toBe('1/16"');
    expect(frac(12)).toBe('12"');
    expect(frac(0.004)).toBe('0"');
    expect(frac(0.266, 64)).toBe('17/64"');
  });

  it('draws every non-Shaper built part (lumber, bent laminations and metal), and no Shaper part', () => {
    const drawn = new Set(sheets.flatMap((s) => s.partIds));
    const want = drawnParts(parts);
    expect(want.length).toBeGreaterThan(60);
    for (const x of want) expect(drawn.has(x.id), x.id).toBe(true);
    for (const x of parts.filter((q) => q.kind === 'lumber' && q.group !== 'reference' && q.fab !== 'shaper-origin')) expect(drawn.has(x.id), `lumber ${x.id}`).toBe(true);
    expect(parts.filter((x) => x.fab === 'shaper-origin').some((x) => drawn.has(x.id))).toBe(false);
    // quantities add up to the parts
    expect(sheets.reduce((n, s) => n + s.qty, 0)).toBe(want.length);
  });

  it('groups identical pieces and L/R mirror pairs on one sheet', () => {
    const rail = sheets.find((s) => s.partNo === 'rail')!;
    expect(rail.qty).toBe(2);
    expect(rail.partId).toBe('rail-L');
    expect(rail.makeNote).toMatch(/MIRROR IMAGE \(right rail\)/);
    const clamps = sheets.find((s) => s.partNo === 'axle-clamp')!;
    expect(clamps.qty).toBe(6);
    expect(clamps.makeNote).toMatch(/identical/);
    // crossmembers of different lengths get their own sheets
    expect(sheets.filter((s) => s.partNo === 'joist').length).toBeGreaterThan(1);
  });

  it('dimensions the rail: the beam notch and the sloped step with their sizes and stations from the REAR end', () => {
    const rail = sheets.find((s) => s.partNo === 'rail')!;
    const notch = rail.features.find((f) => f.kind === 'outline' && /^Notch in the BOTTOM edge/.test(f.text))!;
    expect(notch).toBeTruthy();
    const nw = L.beamR.thick + 0.125;
    expect(notch.size).toMatch(new RegExp(`^${frac(nw)} wide × [\\d/-]+" deep$`));
    expect(notch.face).toBe('bottom edge');
    expect(notch.positions![0]).toMatch(/^[\d/-]+" to [\d/-]+" from the rear end$/);
    const step = rail.features.find((f) => f.kind === 'outline' && /^Step in the BOTTOM edge at the FRONT end/.test(f.text))!;
    expect(step).toBeTruthy();
    expect(step.text).toContain(`leaving ${frac(L.railDepthF)}`);
    expect(step.text).toContain(`cut ${frac(p.railDepthIn - L.railDepthF)} back`);
    // the slope is read from the geometry: the run and the rise the model draws (the note says 37 degrees, not 45)
    expect(step.angleDeg).toBe(Math.round((Math.atan2(p.railDepthIn - L.railDepthF, p.railStepRunIn) * 180) / Math.PI));
    expect(step.text).toMatch(/shoulder slopes at \d+°, from [\d/-]+" from the REAR end, [\d/-]+" from the TOP edge to/);
    expect(step.positions).toHaveLength(2);
    // the same words are on the sheet, and the ordinates mark the notch and the step
    for (const t of [notch.text.slice(0, 60), step.text.slice(0, 60)]) expect(rail.svg).toContain(t.replace(/"/g, '&quot;'));
    const start = /(\d[\d/-]*)" to (\d[\d/-]*)" from the rear end/.exec(notch.positions![0])!;
    expect(texts(rail.svg)).toContain(`${start[1]}"`);
    expect(texts(rail.svg)).toContain(`${start[2]}"`);
    expect(texts(rail.svg)).toContain('0 REAR');
  });

  it('locates every bolt hole joint of a drawn part as a feature, with its position in words', () => {
    let n = 0;
    const byId = new Map(parts.map((x) => [x.id, x]));
    for (const s of sheets) {
      const part = byId.get(s.partId)!;
      for (const j of part.joints ?? []) {
        if (j.type !== 'bolt' || !j.at?.length) continue;
        const f = s.features.find((x) => x.kind === 'hole' && x.to?.includes(j.to));
        expect(f, `${part.id} bolt -> ${j.to}`).toBeTruthy();
        expect(f!.count).toBeGreaterThanOrEqual(1);
        expect(f!.text).toMatch(/(?:In the [A-Z]+ [a-z]+: |Mouth: )/);
        expect(f!.size).toMatch(/\d\/?\d*" /);
        expect(f!.positions!.length).toBeGreaterThan(0);
        n++;
      }
    }
    expect(n).toBeGreaterThan(15);
  });

  it('puts the knee bolts and the plate recess on the brake backer, and the pocket in the knee (D-77)', () => {
    const backer = sheets.find((s) => s.partNo === 'brake-backer')!;
    const knee = sheets.find((s) => s.partNo === 'brake-knee')!;
    const pocket = knee.features.find((f) => f.kind === 'notch' && /^1 pocket, 1-3\/8" wide × 1-25\/32" high × 1-21\/32" deep, open at the outboard edge\. In the REAR face: /.test(f.text) && /flap tongue/.test(f.purpose ?? ''))!;
    expect(pocket).toBeTruthy();
    expect(pocket.positions![0]).toMatch(/^0" to 1-3\/8" from the outboard edge, 3\/4" to 2-17\/32" from the top end$/); // the roof is 3/4" thick, the pocket is open at the outboard edge (no ear)
    expect(knee.features.filter((f) => /\b(slot|ear)\b/i.test(f.text)).map((f) => f.text)).toEqual([]);
    // the pin hole is blind, from the pocket's inboard wall, and a clearance size
    expect(knee.features.some((f) => f.kind === 'hole' && /^1 hole, 13\/32" blind hole, 1" deep\. In the inboard wall of the pocket: 1-5\/8" from the TOP end, 3\/4" from the REAR face/.test(f.text))).toBe(true);
    // D-75: the four knee-bolt holes are recorded on the backer itself (bolts, not screws), plus ONE flush plate recess (2" × 2-1/2", 1/8" deep, flat bottom) instead of four counterbores
    const bolts = backer.features.filter((f) => f.kind === 'hole' && f.count === 4);
    expect(bolts.length).toBe(1);
    expect(bolts[0].text).toMatch(/[Ff]or the 3\/8" bolts/);
    expect(backer.features.some((f) => /counterbore/.test(f.text))).toBe(false);
    const recess = backer.features.filter((f) => /recess/.test(f.text));
    expect(recess.length).toBe(1);
    expect(recess[0].count).toBe(1);
    expect(recess[0].text).toMatch(/1 recess, 2" × 2-1\/2", 1\/8" deep, flat bottom/);
    expect(recess[0].text).toMatch(/stainless backing plate, set flush/);
  });

  it('cuts the axle grooves in the beams and the hanger notch', () => {
    const beamR = sheets.find((s) => s.partNo === 'beam-R')!;
    expect(beamR.features.some((f) => f.kind === 'groove' && /end to end/.test(f.text))).toBe(true);
    const hanger = sheets.find((s) => s.partNo === 'axle-hanger')!;
    expect(hanger.features.some((f) => f.kind === 'notch' && /wide × 1-11\/32" deep/.test(f.text))).toBe(true);
  });

  it('never prints a long decimal: no number with more than 3 decimals in any SVG text', () => {
    for (const s of sheets) for (const t of texts(s.svg)) expect(/\d\.\d{4,}/.test(t), `${s.partId}: ${t}`).toBe(false);
  });

  it('states datums in plain words, never x / y / z', () => {
    for (const s of sheets) {
      expect(s.svg).toMatch(/Datums: lengths from the (REAR|FRONT|LEFT|RIGHT|TOP|BOTTOM|INBOARD|OUTBOARD)/);
      for (const f of s.features) expect(/\b[xyz] ?=/.test(f.text), `${s.partId}: ${f.text.slice(0, 80)}`).toBe(false);
    }
  });

  it('is a well-formed SVG with a title, the scale, the grain and the quantity', () => {
    for (const s of sheets) {
      expect(s.svg.startsWith('<?xml')).toBe(true);
      expect(s.svg).toMatch(/<svg [^>]*width="[\d.]+in" height="[\d.]+in"/);
      expect(s.svg).toMatch(/scale (\d:1|1:\d+)/);
      expect(s.svg).toMatch(/Grain: /);
      expect(s.svg).toContain(`qty ${s.qty}`);
      const opens = (s.svg.match(/<g\b/g) ?? []).length, closes = (s.svg.match(/<\/g>/g) ?? []).length;
      expect(opens).toBe(closes);
    }
  });

  it('summarizes a part for the popover', () => {
    const rail = parts.find((x) => x.id === 'rail-L')!;
    const d = partDims(rail, parts, p);
    expect(d.size).toBe(`${frac(p.railThicknessIn)} × ${frac(p.railDepthIn)} × ${d.l}`);
    expect(d.board).toMatch(/2 strips/);
    expect(d.grain).toMatch(/along the/);
    expect(d.features.some((f) => /^Notch in the BOTTOM edge/.test(f))).toBe(true);
    // works without the model too (own joints only)
    expect(partDims(rail).features.length).toBeGreaterThan(0);
  });

  it('writes every feature line plainly: no coordinates, bracketed ids, decision numbers or long decimals, and two lines at most', () => {
    const wrapLines = (t: string, chars: number): number => { let n = 0, cur = ''; for (const w of t.split(' ')) { if ((`${cur} ${w}`).trim().length > chars && cur) { n++; cur = w; } else cur = `${cur} ${w}`.trim(); } return n + (cur ? 1 : 0); };
    let checked = 0;
    for (const s of sheets) {
      const chars = Math.floor((s.widthIn - 2 * 0.4 - 0.3) / (0.52 * 0.105));
      for (const f of s.features) {
        const where = `${s.partId} ${f.label}: ${f.text.slice(0, 90)}`;
        expect(f.text, where).not.toMatch(/\bx =/);
        expect(f.text, where).not.toContain('[');
        expect(f.text, where).not.toMatch(/D-\d/);
        expect(f.text, where).not.toMatch(/\d\.\d{4,}/);
        expect(f.text, where).not.toMatch(/as the joint says|Position:|Fastener:/);
        if (f.kind !== 'note') expect(wrapLines(f.text, chars), where).toBeLessThanOrEqual(2);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('gives every hole, mortise and notch its size, positions and face as fields, in lower case and fractions', () => {
    for (const s of sheets) for (const f of s.features) {
      if (f.kind === 'note') continue;
      if (f.kind === 'hole' || f.kind === 'mortise' || f.kind === 'dado' || f.kind === 'notch' || f.kind === 'groove' || f.kind === 'slot' || f.kind === 'tenon') {
        expect(f.size, `${s.partId} ${f.label}`).toBeTruthy();
        expect(f.positions?.length, `${s.partId} ${f.label}`).toBeGreaterThan(0);
        expect(f.face, `${s.partId} ${f.label}`).toBeTruthy();
      }
      for (const t of [f.size, ...(f.positions ?? []), f.face]) if (t) expect(/\b(REAR|FRONT|TOP|BOTTOM|INBOARD|OUTBOARD|LEFT|RIGHT)\b/.test(t), `${s.partId} ${f.label}: ${t}`).toBe(false);
    }
    const rail = sheets.find((x) => x.partNo === 'rail')!;
    const c = rail.features.find((f) => f.kind === 'hole' && /counterbore/.test(f.text))!;
    expect(c.text).toMatch(/^4 holes, 1\/8" pilot, through, with a 5\/16" × 1" counterbore from the BOTTOM edge\./);
    expect(c.purpose).toMatch(/^for the #6 × 2-1\/2" screws to the left chine/);
    expect(c.face).toBe('top edge');
  });

  it('shows the hold-down bolts once: 2 holes in the angle, the hanger and the rail, at the same places, not 4', () => {
    const count = (partNo: string, test: (f: { text: string; purpose?: string; to?: string[] }) => boolean): number =>
      sheets.find((x) => x.partNo === partNo)!.features.filter((f) => f.kind === 'hole' && test(f)).reduce((n, f) => n + f.count, 0);
    expect(count('axle-hanger', (f) => /hold-down/.test(f.purpose ?? ''))).toBe(2);
    expect(count('beam-hold-down', (f) => /hanger/.test(f.purpose ?? ''))).toBe(2);
    expect(count('rail', (f) => /hold-down/.test(f.purpose ?? ''))).toBe(2);
    // and no second set on the hanger or the rail from the old hanger-to-rail joint
    const rail = sheets.find((x) => x.partNo === 'rail')!;
    expect(rail.features.filter((f) => f.kind === 'hole' && /hanger/.test(f.purpose ?? '')).reduce((n, f) => n + f.count, 0)).toBe(2);
    const hanger = sheets.find((x) => x.partNo === 'axle-hanger')!;
    expect(hanger.features.filter((f) => f.kind === 'hole').reduce((n, f) => n + f.count, 0)).toBe(2);
  });

  it('draws all the sheets fast enough to recompute on every design change (50 ms warm at the defaults; the bound is loose for shared CI)', () => {
    const fresh = defaultParams();
    const model = buildModel(fresh);
    const t0 = performance.now();
    const out = partDrawings(model, fresh);
    const cold = performance.now() - t0;
    expect(out.length).toBe(sheets.length);
    expect(cold).toBeLessThan(1500);
    const t1 = performance.now();
    partDrawings(model, fresh);
    expect(performance.now() - t1).toBeLessThan(1000);
  });
});

describe('part drawings read their sizes from the cut list (readability round 2)', () => {
  const cl = cutListFor(parts, p);
  /** The text of the title block (the first lines of the sheet), joined: long lines are wrapped. */
  const head = (svg: string): string => texts(/<g id="title">([\s\S]*?)<\/g>/.exec(svg)![1]).join(' ');

  it('prints exactly the cut list\'s rough text for every piece it cuts (rounded UP to 1/8)', () => {
    let n = 0;
    for (const s of sheets) {
      const h = head(s.svg);
      for (const c of cl.cuts.filter((q) => q.ids.includes(s.partId))) { expect(h, `${s.partId}: ${c.roughText}`).toContain(c.roughText); n++; }
      for (const g of cl.glueUps.filter((q) => q.ids.includes(s.partId))) expect(h, `${s.partId} block`).toContain(g.roughBlockText);
    }
    expect(n).toBeGreaterThan(40);
    // the named offenders of the critic: none of these rough sizes appears any more
    const all = sheets.map((s) => head(s.svg)).join('\n');
    for (const bad of ['27/32', '3-27/32', '4-15/32', '7-3/32', '8-7/8', '5-1/2 (T']) expect(all.includes(`rough ${bad}`) || all.includes(` ${bad}" ×`), bad).toBe(false);
    // a rough dimension in a Stock line is always on the 1/8 grid
    for (const s of sheets) {
      const stock = /Stock: ([^\n]*?)(?:Grain:|$)/.exec(head(s.svg))?.[1] ?? '';
      for (const m of stock.matchAll(/(\d+(?:-\d+\/\d+)?|\d+\/\d+)(?= ×| rough| from|;|,| \(T)/g)) {
        const v = m[1].includes('/') ? (m[1].includes('-') ? Number(m[1].split('-')[0]) + eval(m[1].split('-')[1]) : eval(m[1])) : Number(m[1]);
        expect(Math.abs(v * 8 - Math.round(v * 8)) < 1e-6 || /planed to/.test(stock), `${s.partId}: ${m[1]} in "${stock}"`).toBe(true);
      }
    }
  });

  it('says the rail strips are resawn from the board the cut list uses (8/4), not 4/4', () => {
    const rail = sheets.find((s) => s.partNo === 'rail')!;
    const strip = cl.cuts.find((c) => c.ids.includes('rail-L') && c.piece === 'strip')!;
    expect(strip.board).toBe('8/4');
    expect(head(rail.svg)).toContain(`2 strips, each ${strip.roughText} rough`);
    expect(head(rail.svg)).toContain('resawn from 8/4');
    expect(head(rail.svg)).not.toMatch(/from 4\/4/);
    expect(partDims(parts.find((x) => x.id === 'rail-L')!, parts, p).board).toContain('resawn from 8/4');
  });

  it('uses the cut list\'s sizes for the final size: T × W × L for a board, thick × tall × across for the brake knee block, a diameter for a rod', () => {
    const knee = sheets.find((s) => s.partNo === 'brake-knee')!;
    const fin = cl.finished.find((f) => f.ids.includes('brake-knee-L'))!;
    expect(fin.finalText).toBe('2-1/8" thick × 9-1/2" tall × 3-11/16" across');
    expect(head(knee.svg)).toContain(`final ${fin.finalText}`);
    expect(head(knee.svg)).not.toContain(`${fin.finalText} (T × W × L`);
    for (const s of sheets) {
      const f = cl.finished.find((q) => q.ids.includes(s.partId));
      if (f && f.partNo !== 'brake-knee') expect(head(s.svg), s.partId).toContain(`final ${f.finalText} (T × W × L`);
    }
    const d = partDims(parts.find((x) => x.id === 'brake-knee-L')!, parts, p);
    expect(d.size).toBe(fin.finalText);
  });

  it('writes the grain of the cross-laminated knee by layer (face layers up the leg, center layer across), in the drawing and in the popup', () => {
    const knee = sheets.find((s) => s.partNo === 'brake-knee')!;
    const h = head(knee.svg);
    expect(h).toMatch(/Grain: face layers: grain up the leg; center layer: across the sled/);
    expect(h).not.toMatch(/Grain: along L/);
    expect(h).not.toMatch(/By layer, face layer first/);
    const d = partDims(parts.find((x) => x.id === 'brake-knee-L')!, parts, p);
    expect(d.grain).toMatch(/^face layers: grain up the leg; center layer: across the sled/);
    expect(d.grain).not.toMatch(/^along/);
  });

  it('draws a round rod as a diameter and a length, with its cotter holes measured from a named end', () => {
    const axle = sheets.find((s) => s.partId === 'axle-R')!;
    const h = head(axle.svg);
    expect(h).toContain('final 5/8" dia × 34-1/4"');
    expect(h).not.toMatch(/5\/8 × 5\/8 × 34-1\/4/);
    expect(h).not.toMatch(/heights from the/);
    expect(h).toMatch(/Datums: lengths from the LEFT end\./);
    expect(axle.features.length).toBeGreaterThanOrEqual(2);
    for (const f of axle.features) expect(f.text, f.label).toMatch(/Drilled straight through the rod, across its diameter, at .* from the LEFT end/);
    expect(partDims(parts.find((x) => x.id === 'axle-R')!, parts, p).size).toBe('5/8" dia × 34-1/4"');
  });

  it('uses human names in the headers and make notes: no part keys, no decision numbers, no decimals', () => {
    const keys = new Set<string>();
    for (const x of parts) { keys.add(x.id); keys.add(x.partNo ?? x.id); }
    // Plain words that are also keys ("rail") are fine on their own; a key is a hyphenated id or one with a digit/L/R suffix.
    const key = [...keys].filter((k) => /-/.test(k) || /\d$/.test(k)).sort((a, b) => b.length - a.length);
    for (const s of sheets) {
      const all = texts(s.svg);
      const title = /<title>([^<]*)<\/title>/.exec(s.svg)![1];
      const body = [...all, s.makeNote, title].join('\n');
      expect(head(s.svg).startsWith(s.name), s.partId).toBe(true);
      expect(head(s.svg), s.partId).not.toMatch(/\bPart [a-z0-9-]+ +qty/);
      for (const k of key) expect(new RegExp(`(^|[^A-Za-z0-9])${k.replace(/[-]/g, '\\-')}([^A-Za-z0-9-]|$)`).test(body), `${s.partId}: key ${k}`).toBe(false);
      expect(body, s.partId).not.toMatch(/\bD-\d+/);
      expect(body, s.partId).not.toMatch(/\d\.\d/);
    }
  });

  it('shows no decimal in the feature table either', () => {
    for (const s of sheets) for (const f of s.features) for (const t of [f.text, f.size, f.face, f.purpose, ...(f.positions ?? [])]) if (t) expect(t, `${s.partId} ${f.label}`).not.toMatch(/\d\.\d/);
  });

  it('rounds rough sizes with the same function as the cut list', () => {
    expect(roughFrac(26.9)).toBe('27"');
    for (const c of cl.cuts) expect(c.roughText).toBe([c.rough.t, c.rough.w, c.rough.l].map((v) => roughFrac(v).replace(/"$/, '')).join(' × '));
  });
});

describe('position lists read cleanly', () => {
  it('never leave an empty slot in a list of positions (a centered point is named "centered")', () => {
    const p = defaultParams();
    for (const s of partDrawings(buildModel(p), p)) for (const f of s.features) expect(f.text, s.partId).not.toMatch(/,\s+and|,\s+,/);
  });
});

describe('the knee drawing shows how the block is laminated', () => {
  const knee = sheets.find((x) => x.partNo === 'brake-knee')!;
  const t = texts(knee.svg).join('\n');
  const flat = texts(knee.svg).join(' '); // the stock text wraps across lines

  it('has an edge view with the layer lines and each layer\'s grain, and the center-layer glue joint', () => {
    expect(knee.svg).toContain('id="layers"');
    expect(t).toMatch(/LAYERS: how the block is laminated \(layer 1 is the REAR face/);
    expect(t).toContain('EDGE VIEW, from the TOP end');
    expect(t).toContain('1  upright');
    expect(t).toContain('2  across the sled');
    expect(t).toContain('3  upright');
    expect(t).toMatch(/LAYERS 1 and 3, from the rear face/);
    expect(t).toMatch(/LAYER 2, from the rear face/);
    expect(t).toMatch(/board 1 \(bottom edge\): 5-5\/8" wide/);
    expect(t).toMatch(/board 2 \(top\): 4-3\/4" wide/);
    expect(t).toMatch(/edge joint: 5-1\/4" up from/);
    expect(t).toMatch(/ONE piece, 4-1\/8" wide across its grain/);
    // only the cross-laminated part carries the block
    expect(sheets.filter((x) => x.svg.includes('id="layers"')).map((x) => x.partNo)).toEqual(['brake-knee']);
  });

  it('says the rough block is not a rectangle and what each layer measures (from the cut list)', () => {
    expect(flat).toMatch(/the layers are not the same size/);
    expect(flat).toMatch(/layers 1 and 3: 4-1\/8 wide across its grain . 11-5\/8 long; layer 2: 10-3\/8 wide across its grain . 5-3\/4 long/);
    expect(flat).toMatch(/not a rectangle until it is milled; it fits in 2-1\/4" thick . 11-5\/8" tall . 5-3\/4" across/);
    expect(flat).not.toMatch(/glued block rough 2-1\/4/);
  });
});

describe('D-77: the pivot strap drawing', () => {
  const strap = sheets.find((x) => x.partNo === 'brake-strap')!;
  it('draws the strap once for both sides, with the 13/32" pin hole and four 3/16" clearance screw holes (through the strap, never a pilot)', () => {
    expect(strap).toBeTruthy();
    expect(strap.qty).toBe(2);
    expect(strap.partIds.sort()).toEqual(['brake-strap-L', 'brake-strap-R']);
    const pin = strap.features.find((f) => /pin/.test(f.purpose ?? ''))!;
    expect(pin.text).toMatch(/^1 hole, 13\/32" clearance, through\. .*3\/4" from the REAR edge, 1-21\/32" from the BOTTOM end/);
    const screws = strap.features.find((f) => /#8/.test(f.purpose ?? ''))!;
    expect(screws.text).toMatch(/^4 holes, 3\/16" clearance, through\. .*2 columns × 2 rows: 11\/32" and 1-11\/16" from the REAR edge/);
    expect(strap.features.some((f) => /pilot|deep|tap/i.test(f.text))).toBe(false);
  });
  it('says cut, deburr and drill, and nothing else, in the notes; the flat bar size is in the heading', () => {
    const txt = [...strap.svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ');
    expect(txt).toMatch(/Cut from the flat bar on the metal bandsaw and deburr the cut edges; drill on the drill press/);
    expect(txt).toMatch(/flat bar 1\/8&quot; x 2&quot;/);
    expect(txt).toMatch(/final 1\/8 × 2 × 3-5\/16/);
  });
});

describe('D-76: the side rib, knee and box tie drawings', () => {
  const sheet = (id: string) => sheets.find((d) => d.partIds.includes(id))!;
  it('gives the rib its four D-ring holes at 1-1/8" x 1/2" with a clearance drill, the sheer-cut top dimensioned, and the do-not-drill note', () => {
    const d = sheet('side-rib-L2');
    const holes = d.features.find((f) => f.kind === 'hole')!;
    expect(holes.count).toBe(4);
    expect(holes.text).toMatch(/3\/16" clearance/);
    expect(holes.text).toMatch(/7\/16" and 1-9\/16" from the REAR edge/);
    expect(d.features.some((f) => /Sloped edge: a straight cut, 7° from level/.test(f.text))).toBe(true);
    expect(d.svg).toMatch(/final fit|D-ring holes/);
  });
  it('draws each knee counterbore on its sloped face at its own depth, centered on its screw hole', () => {
    const d = sheet('side-rib-knee-L2');
    const cb = d.features.filter((f) => /counterbore/.test(f.text));
    expect(cb.length).toBe(2);
    expect(cb[0].text).toMatch(/3\/8" wide × 1-1\/8" deep.*sloped face: 11\/16" from the OUTBOARD edge/);
    expect(cb[1].text).toMatch(/3\/8" wide × 1\/4" deep.*sloped face: 1-13\/32" from the OUTBOARD edge/);
    expect(cb[0].text).not.toMatch(/the the/);
  });
});

describe('the bridle tongue drawing agrees with its own offsets table and with the step', () => {
  const t = sheets.find((x) => x.partNo === 'bridle-tongue')!;
  it('says the head face runs square before each curve, in the feature line and in the table of offsets', () => {
    const [a, b] = t.features.filter((f) => f.kind === 'outline');
    expect(a.text).toMatch(/starts with a straight run at 3" from the REAR end, 0" to 1-1\/2" from the RIGHT edge/);
    expect(b.text).toMatch(/ends with a straight run at 3" from the REAR end, 6" to 4-1\/2" from the RIGHT edge/);
    expect(t.svg).toMatch(/3&quot;: 0&quot; and 1-1\/2&quot; \(a straight run across\)/);
    expect(t.svg).toMatch(/3&quot;: 4-1\/2&quot; and 6&quot; \(a straight run across\)/);
  });
  it('gives the depth of the bolt holes the step gives (3" through the head)', () => {
    const holes = t.features.find((f) => f.kind === 'hole' && /25\/64/.test(f.text))!;
    expect(holes.text).toMatch(/through \(3" deep\)/);
  });
});
