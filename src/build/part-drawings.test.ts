import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { computeLayout } from '../model/layout';
import { defaultParams } from '../params';
import { drawnParts, frac, partDims, partDrawings } from './part-drawings';

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
    expect(rail.makeNote).toMatch(/MIRROR IMAGE \(rail-R\)/);
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

  it('puts the knee bolts through the brake backer (no joint records them) and the slot in the knee', () => {
    const backer = sheets.find((s) => s.partNo === 'brake-backer')!;
    expect(backer.features.some((f) => f.kind === 'hole' && f.joint === 'passing' && f.count === 4)).toBe(true);
    const knee = sheets.find((s) => s.partNo === 'brake-knee')!;
    expect(knee.features.some((f) => f.kind === 'slot' && /^1 slot, .*wide .*deep from the REAR face/.test(f.text) && /flap tongue/.test(f.purpose ?? ''))).toBe(true);
    // the nut-and-washer counterbores of the knee bolts, with their size (the model records them now)
    expect(backer.features.some((f) => f.kind === 'hole' && /counterbores?, 1-3\/8" wide × 1\/2" deep/.test(f.text))).toBe(true);
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
