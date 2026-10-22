import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { SHAPER_MAX_DEPTH_IN, analyzeShaperPart, grainWords, shaperCutDepth, shaperFiles } from './shaper-svg';
import { flatPattern } from './flat';

const p = defaultParams();
// D-86: the signs, storage walls and lid panel are sawn by default; they go back on the Shaper here so its drill marks, mirror sharing and engraving stay covered.
const SAWN_RECT = /^(sign-[LR]|storage-(side-[LR]|end-(aft|fore)|lid))$/;
const parts = buildModel(p).map((x) => (SAWN_RECT.test(x.id) ? { ...x, fab: 'shaper-origin' as const } : x));
const files = shaperFiles(parts, p);
const shaperParts = parts.filter((x) => x.fab === 'shaper-origin');
const fileOf = (id: string) => files.find((f) => f.partIds.includes(id))!;

/** A small well-formedness check (no DOM in this test environment): tags balance, attributes are quoted, and there is one root. */
function wellFormed(xml: string): string | null {
  const body = xml.replace(/<\?xml[^?]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  const stack: string[] = [];
  let pos = 0, roots = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const between = body.slice(pos, m.index);
    if (/[<>]/.test(between)) return `stray angle bracket near ${pos}`;
    if (m[1]) { if (stack.pop() !== m[2]) return `unbalanced </${m[2]}>`; }
    else if (!m[4]) { if (!stack.length) roots++; stack.push(m[2]); }
    else if (!stack.length) roots++;
    pos = m.index + m[0].length;
  }
  if (/[<>]/.test(body.slice(pos))) return 'trailing markup';
  return stack.length ? `unclosed <${stack[stack.length - 1]}>` : roots === 1 ? null : `${roots} roots`;
}
const paths = (svg: string) => [...svg.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];

describe('Shaper SVG files', () => {
  it('covers every shaper-origin part (about 17 at the defaults) with one file per part number', () => {
    expect(shaperParts.length).toBeGreaterThanOrEqual(17);
    for (const x of shaperParts) expect(fileOf(x.id), x.id).toBeDefined();
    const names = files.map((f) => f.fileName);
    expect(new Set(names).size).toBe(names.length);
    expect(files.reduce((n, f) => n + f.qty, 0)).toBe(shaperParts.length);
    for (const f of files) expect(f.qty).toBe(f.partIds.length);
  });

  it('parses as XML, declares the Shaper namespace, and sizes itself in real inches', () => {
    for (const f of files) {
      expect(wellFormed(f.svg), f.fileName).toBeNull();
      expect(f.svg).toContain('xmlns:shaper="http://www.shapertools.com/namespaces/shaper"');
      const w = /<svg[^>]*\swidth="([\d.]+)in"/.exec(f.svg), h = /<svg[^>]*\sheight="([\d.]+)in"/.exec(f.svg);
      expect(w, f.fileName).not.toBeNull();
      const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(f.svg)!;
      expect(Number(vb[1])).toBeCloseTo(Number(w![1]), 3);
      expect(Number(vb[2])).toBeCloseTo(Number(h![1]), 3);
    }
  });

  it('has an outside path at thickness plus the breakthrough, and a depth on every path', () => {
    for (const f of files) {
      const ps = paths(f.svg);
      const outside = ps.filter((t) => attr(t, 'shaper:cutType') === 'outside');
      expect(outside.length, f.fileName).toBe(1);
      const part = parts.find((x) => x.id === f.partId)!;
      expect(Number.parseFloat(attr(outside[0], 'shaper:cutDepth')!), f.fileName).toBeCloseTo(shaperCutDepth(flatPattern(part)!.thicknessIn), 3); // through + breakthrough, but never deeper than the bit reaches
      expect(outside[0]).toMatch(/fill="#000000"/);
      for (const t of ps) {
        expect(attr(t, 'shaper:cutDepth'), `${f.fileName} ${t.slice(0, 60)}`).toMatch(/^[\d.]+in$/);
        expect(['outside', 'inside', 'pocket', 'online', 'guide']).toContain(attr(t, 'shaper:cutType'));
      }
      for (const t of ps.filter((x) => attr(x, 'shaper:cutType') === 'inside')) expect(t).toMatch(/fill="#FFFFFF" stroke="#000000"/);
      for (const t of ps.filter((x) => attr(x, 'shaper:cutType') === 'pocket')) expect(t).toMatch(/fill="#7F7F7F"/);
      for (const t of ps.filter((x) => attr(x, 'shaper:cutType') === 'guide')) expect(t).toMatch(/fill="none" stroke="#0068FF"/);
    }
  });

  it('is as wide and as tall as the flat pattern', () => {
    for (const f of files) {
      const fp = flatPattern(parts.find((x) => x.id === f.partId)!)!;
      expect(f.widthIn).toBeCloseTo(fp.widthIn, 6);
      expect(f.heightIn).toBeCloseTo(fp.heightIn, 6);
      expect(Number(/\swidth="([\d.]+)in"/.exec(f.svg)![1])).toBeCloseTo(fp.widthIn, 3);
      expect(Number(/\sheight="([\d.]+)in"/.exec(f.svg)![1])).toBeCloseTo(fp.heightIn, 3);
    }
  });

  it('unrolls the side web to its flat development, not its plan projection', () => {
    const web = parts.find((x) => x.id === 'side-L-web')!;
    const f = fileOf('side-L-web');
    const prof = (web.geometry as { profile: [number, number][] }).profile;
    expect(f.widthIn).toBeGreaterThan(Math.max(...prof.map((q) => q[0])) - Math.min(...prof.map((q) => q[0])));
  });

  /** Holes and drill marks the model's joints ask for in a part: the points of every fastener joint on it plus the holes of its geometry. */
  const jointHoles = (id: string) => parts.find((x) => x.id === id)!.joints!.filter((j) => ['bolt', 'screw', 'pin', 'knob', 'threaded-insert'].includes(j.type)).reduce((n, j) => n + (j.at?.length ?? j.count), 0);
  const featureHoles = (f: { features: { kind: string; count: number }[] }) => f.features.filter((x) => x.kind === 'hole' || x.kind === 'drill').reduce((n, x) => n + x.count, 0);

  it('puts as many holes in the seat back, grab boards and signs as their joints have', () => {
    expect(jointHoles('seat-back-panel')).toBe(8);
    expect(featureHoles(fileOf('seat-back-panel'))).toBe(jointHoles('seat-back-panel'));
    expect(jointHoles('seat-grip-L')).toBe(5);
    expect(featureHoles(fileOf('seat-grip-L'))).toBe(5 + 1); // five bolts and the hand hole
    expect(jointHoles('sign-L')).toBe(4);
    expect(featureHoles(fileOf('sign-L'))).toBe(4);
    // And the SVG carries them: the grab board has 6 inside cuts, the seat back 2 pin holes (the inserts are untrusted guide marks).
    expect(paths(fileOf('seat-grip-L').svg).filter((t) => attr(t, 'shaper:cutType') === 'inside').length).toBe(6);
    expect(paths(fileOf('seat-back-panel').svg).filter((t) => attr(t, 'shaper:cutType') === 'inside').length).toBe(2);
    expect(paths(fileOf('sign-L').svg).filter((t) => attr(t, 'shaper:cutType') === 'inside').length).toBe(0); // #10 holes are under the routing size: drill marks
    expect(fileOf('sign-L').svg.match(/<title>drill<\/title>/g)!.length).toBe(4);
  });

  it('keeps the grab-board bolt holes on the board (the joints are in the board\'s local frame)', () => {
    const d = analyzeShaperPart(parts.find((x) => x.id === 'seat-grip-L')!, parts, p)!;
    const holes = d.items.filter((i) => i.k === 'cutHole');
    expect(holes.length).toBe(5);
    for (const h of holes) if (h.k === 'cutHole') { expect(h.c[0]).toBeGreaterThan(0.5); expect(h.c[0]).toBeLessThan(d.f.widthIn - 0.5); expect(h.c[1]).toBeGreaterThan(0.2); expect(h.c[1]).toBeLessThan(d.f.heightIn / 2); }
  });

  it('drills the transom vents and cuts its bolt holes through the transom', () => {
    const f = fileOf('transom-rear');
    expect(f.features.find((x) => x.kind === 'drill' && x.joint === 'geometry')!.count).toBe(4);
    expect(f.features.filter((x) => x.kind === 'hole' && x.joint === 'bolt').reduce((n, x) => n + x.count, 0)).toBe(4);
  });

  it('cuts the dados and mortises in the transom and bulkhead faces as pockets of the right depth', () => {
    const t = analyzeShaperPart(parts.find((x) => x.id === 'transom-rear')!, parts, p)!;
    const pk = t.items.filter((i) => i.k === 'pocket');
    expect(pk.length).toBe(5); // two web dados, the deck dado, two mortises
    const depths = pk.map((i) => (i.k === 'pocket' ? i.depth : 0)).sort();
    expect(depths).toEqual([0.25, 0.25, 0.25, 0.375, 0.375]);
    const b = analyzeShaperPart(parts.find((x) => x.id === 'bow-bulkhead')!, parts, p)!;
    expect(b.mirror).toBe(true); // the bulkhead's pockets are in its rear face
    expect(t.mirror).toBe(false);
    // The deck dado runs the deck's width and is as wide as the deck sheet is thick plus clearance.
    const deckDado = pk.find((i) => i.k === 'pocket' && i.label.includes('deck'))!;
    if (deckDado.k === 'pocket') {
      const w = Math.max(...deckDado.loop.map((q) => q[0])) - Math.min(...deckDado.loop.map((q) => q[0]));
      expect(w).toBeGreaterThan(20);
    }
  });

  it('runs the deck dado into the web dados (one pocket at each corner) and the web dados out through the top edge: no thin walls left', () => {
    for (const id of ['transom-rear', 'bow-bulkhead']) {
      const d = analyzeShaperPart(parts.find((x) => x.id === id)!, parts, p)!;
      const pk = d.items.filter((i): i is Extract<typeof i, { k: 'pocket' }> => i.k === 'pocket');
      const bb = (l: [number, number][]) => ({ u0: Math.min(...l.map((q) => q[0])), u1: Math.max(...l.map((q) => q[0])), v0: Math.min(...l.map((q) => q[1])), v1: Math.max(...l.map((q) => q[1])) });
      const deck = bb(pk.find((i) => i.label.includes('deck'))!.loop);
      const webs = pk.filter((i) => /web/.test(i.label));
      expect(webs.length, id).toBe(2);
      for (const w of webs) {
        const b = bb(w.loop);
        // the deck pocket spans the whole width of the web pocket at its end, and shares its rows: one continuous pocket
        expect(deck.u0 <= b.u0 + 1e-9 && deck.u1 >= b.u1 - 1e-9 || deck.u0 <= b.u0 + 1e-9 || deck.u1 >= b.u1 - 1e-9, `${id} ${w.label}`).toBe(true);
        expect(Math.max(deck.v0, b.v0) < Math.min(deck.v1, b.v1), `${id} ${w.label} rows overlap`).toBe(true);
        // open at the top: the pocket ends above the outline there
        const top = Math.max(...d.f.outer.filter((q) => q[0] >= b.u0 - 1e-6 && q[0] <= b.u1 + 1e-6).map((q) => q[1]));
        expect(b.v1, `${id} ${w.label} top`).toBeGreaterThanOrEqual(top - 0.5);
        expect(b.v1).toBeGreaterThan(Math.min(...d.f.outer.map((q) => q[1]))); // sanity
      }
      const deckSpan = [deck.u0, deck.u1], webSpan = [Math.min(...webs.map((w) => bb(w.loop).u0)), Math.max(...webs.map((w) => bb(w.loop).u1))];
      expect(deckSpan[0]).toBeLessThanOrEqual(webSpan[0] + 1e-9);
      expect(deckSpan[1]).toBeGreaterThanOrEqual(webSpan[1] - 1e-9);
      expect(d.notes.filter((n) => /only [\d.]+ in of wood|comes within|lie outside the outline/.test(n)), id).toEqual([]);
      expect(d.features.find((x) => x.kind === 'pocket' && x.to === 'deck')!.label).toMatch(/runs into the web dado at both ends/);
    }
  });

  it('drills the sign knob holes at 7/32 (0.219), the clearance of a #10-32 screw', () => {
    const f = fileOf('sign-L');
    const holes = f.features.filter((x) => x.kind === 'drill' && x.joint === 'knob');
    expect(holes.reduce((n, x) => n + x.count, 0)).toBe(4);
    for (const x of holes) expect(x.diaIn).toBeCloseTo(7 / 32, 6);
  });

  it('engraves DO NOT STEP on the lid as on-line strokes at the legend depth', () => {
    const lid = parts.find((x) => x.id === 'storage-lid')!;
    const f = fileOf('storage-lid');
    const on = paths(f.svg).filter((t) => attr(t, 'shaper:cutType') === 'online');
    expect(on.length).toBeGreaterThanOrEqual(10);
    for (const t of on) { expect(parseFloat(attr(t, 'shaper:cutDepth') ?? '')).toBeCloseTo(lid.legend!.depthIn, 3); expect(t).toMatch(/fill="none"/); }
    expect(f.features.some((x) => x.kind === 'engrave')).toBe(true);
  });

  it('shares one file between identical parts and separates mirror images', () => {
    expect(fileOf('sign-L')).toBe(fileOf('sign-R'));
    expect(fileOf('sign-L').qty).toBe(2);
    expect(fileOf('seat-grip-L')).toBe(fileOf('seat-grip-R'));
    expect(fileOf('side-L-web')).toBe(fileOf('side-R-web'));
    expect(fileOf('brake-flap-L')).not.toBe(fileOf('brake-flap-R')); // the cord eye is inboard: a mirror image
    expect(fileOf('brake-flap-L').fileName).not.toBe(fileOf('brake-flap-R').fileName);
  });

  it('marks a joint position it cannot trust as a guide, never a cut', () => {
    // A synthetic copy of the seat back with one insert moved onto its foot edge: the model's own inserts are all trusted now.
    const panel = parts.find((x) => x.id === 'seat-back-panel')!;
    const moved = { ...panel, joints: panel.joints!.map((j) => (j.to === 'seat-hinge-L' ? { ...j, at: j.at!.map((a, i): [number, number, number] => (i === 0 ? [a[0], 0.02, a[2]] : a)) } : j)) };
    const d = analyzeShaperPart(moved, parts, p)!;
    expect(d.features.some((x) => x.kind === 'drill' && x.approx)).toBe(true);
    expect(d.items.some((i) => i.k === 'drill' && i.label === 'position uncertain')).toBe(true);
  });

  it('puts the hinge inserts of the seat back where the hinge leaf has its holes, as drill marks with depth labels', () => {
    const d = analyzeShaperPart(parts.find((x) => x.id === 'seat-back-panel')!, parts, p)!;
    expect(d.features.some((x) => x.approx)).toBe(false);
    const ins = d.features.filter((x) => x.kind === 'drill' && x.joint === 'screw');
    expect(ins.reduce((n, x) => n + x.count, 0)).toBe(6);
    for (const x of ins) {
      expect(x.depthIn).toBeCloseTo(0.344, 3);
      expect(x.label).toMatch(/Blind insert hole/);
      for (const [u, v] of x.at!) {
        expect(v).toBeGreaterThanOrEqual(0.5); // from the foot edge
        expect(Math.min(u, d.f.widthIn - u)).toBeGreaterThanOrEqual(0.5); // from the side edges
      }
    }
    const svg = fileOf('seat-back-panel').svg;
    expect(svg).not.toContain('position uncertain');
    expect(svg).toMatch(/insert hole Ø[\d.]+ x 0\.344 deep \(x3\)/);
    expect(d.notes.some((n) => /fall outside the pattern/.test(n))).toBe(false);
  });

  it('draws every joint point of every Shaper part: none falls off its pattern (all points are local-frame)', () => {
    for (const part of parts.filter((x) => x.fab === 'shaper-origin')) {
      const d = analyzeShaperPart(part, parts, p);
      if (d) expect(d.notes.filter((n) => /fall outside the pattern/.test(n)), part.id).toEqual([]);
    }
  });

  // ── Phase 4 round 2 ──

  it('cuts the storage lid at its CUT size, tongues included (18.75 x 14.796), with the visible panel as a guide', () => {
    const lid = parts.find((x) => x.id === 'storage-lid')!;
    const f = fileOf('storage-lid');
    expect(f.widthIn).toBeCloseTo(lid.stock!.w, 3);
    expect(f.heightIn).toBeCloseTo(lid.stock!.l, 3);
    expect(f.svg).toContain('visible panel (inside the rabbets)');
    expect(f.features[0].label).toMatch(/INCLUDING the 0\.25 in tongue/);
    // The legend is centered on the cut panel: its ink, not its advance width.
    const eng = paths(f.svg).filter((t) => attr(t, 'shaper:cutType') === 'online');
    const xs = eng.flatMap((t) => [...attr(t, 'd')!.matchAll(/[ML]([-\d.]+),([-\d.]+)/g)].map((m) => Number(m[1])));
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(f.widthIn / 2, 2);
  });

  it('caps every cut at the bit depth and says how to finish a deeper one (the 1.5 in bulkhead)', () => {
    expect(SHAPER_MAX_DEPTH_IN).toBe(1);
    const f = fileOf('bow-bulkhead');
    expect(f.deepCut).toBe(true);
    for (const t of paths(f.svg).filter((x) => ['outside', 'inside'].includes(attr(x, 'shaper:cutType')!))) expect(Number.parseFloat(attr(t, 'shaper:cutDepth')!)).toBeLessThanOrEqual(SHAPER_MAX_DEPTH_IN + 1e-9);
    const deep = f.features.filter((x) => x.deep);
    expect(deep.map((x) => x.kind).sort()).toEqual(['hole', 'outline']); // the outline and the hand hole
    for (const x of deep) { expect(x.label).toMatch(/bandsaw and a flush-trim \(pattern\) bit/); expect(x.depthIn).toBeCloseTo(SHAPER_MAX_DEPTH_IN, 6); }
    expect(f.svg).toMatch(/DEEP CUT/);
    // No other file has a cut deeper than the bit.
    for (const o of files.filter((x) => x !== f)) expect(o.deepCut, o.fileName).toBe(false);
  });

  it('names the cut face in plain words and says when the face does not matter', () => {
    expect(fileOf('bow-bulkhead').cutFace).toMatch(/^REAR \(stern-side\) face UP/);
    expect(fileOf('transom-rear').cutFace).toMatch(/^FORWARD \(bow-side\) face UP/);
    expect(fileOf('storage-lid').cutFace).toMatch(/^TOP face UP/);
    expect(fileOf('side-L-web').cutFaceMatters).toBe(false);
    expect(fileOf('side-L-web').cutFace).toMatch(/^either face can go up/);
    expect(fileOf('side-L-web').svg).toMatch(/2 identical pieces from this one file: cut 2, do not mirror/);
    expect(fileOf('transom-rear').svg).toMatch(/Cut with the FORWARD \(bow-side\) face UP/);
    for (const f of files) expect(f.svg, f.fileName).not.toMatch(/seen from the [+-]z face/);
  });

  it('writes the grain in plain words', () => {
    const bulk = analyzeShaperPart(parts.find((x) => x.id === 'bow-bulkhead')!, parts, p)!;
    expect(grainWords(bulk.f)).toBe('grain along the 18.5" length (horizontal in this drawing)');
    expect(fileOf('bow-bulkhead').svg).toContain('grain along the 18.5&quot; length');
    for (const f of files) expect(f.svg, f.fileName).toMatch(/grain (along the|not specified)/);
  });

  it('draws the grab board in its own flat frame: a 5" tall parallelogram with vertical ends, not a turned drawing of it (D-84)', () => {
    const g = parts.find((x) => x.id === 'seat-grip-L')!;
    const f = fileOf('seat-grip-L');
    expect(f.widthIn).toBeGreaterThan(8.2);
    expect(f.widthIn).toBeLessThan(9.2);
    expect(f.heightIn).toBeCloseTo(5, 6);
    expect(f.widthIn).toBeCloseTo(g.stock!.l, 3);
    expect(f.heightIn).toBeCloseTo(g.stock!.w, 3);
    expect(f.qty).toBe(2);
  });

  it('prints the insert drill size from the joint text, not the 0.19 in thread diameter', () => {
    const f = fileOf('seat-back-panel');
    const ins = f.features.filter((x) => x.kind === 'drill' && /insert hole/i.test(x.label));
    expect(ins.reduce((n, x) => n + x.count, 0)).toBe(6);
    for (const x of ins) { expect(x.diaIn).toBeCloseTo(5 / 16, 6); expect(x.label).not.toMatch(/Ø0\.19\b/); expect(x.depthIn).toBeCloseTo(0.344, 3); }
    expect(f.svg).toMatch(/insert hole Ø0\.3125 x 0\.344 deep \(x3\)/);
  });

  it('names the bit for each feature: 1/4 in for the 0.281 web dado (6 mm Baltic birch + slop, D-80; it was 1/8 in for the 4 mm okoume) and the 0.512 deck dado and the outline, 1/8 in for the mortise', () => {
    const t = fileOf('transom-rear');
    const pk = t.features.filter((x) => x.kind === 'pocket');
    expect(pk.find((x) => /web dado|side-L-web/.test(x.label) || x.to === 'side-L-web')!.bit).toBe('1/4 in');
    expect(pk.find((x) => x.to === 'deck')!.bit).toBe('1/4 in');
    expect(pk.find((x) => x.joint === 'mortise-tenon')!.bit).toBe('1/8 in');
    expect(t.features[0].bit).toBe('1/4 in');
    expect(t.bits).toEqual(expect.arrayContaining(['1/4 in', '1/8 in']));
    expect(fileOf('storage-lid').bits).toContain('1/8 in straight bit, on-line');
  });

  it('keeps human text out of the cut paths: it lives in a guide-marked annotation group below the part', () => {
    for (const f of files) {
      const stripped = f.svg.replace(/<g id="(?:tags|annotations)"[^>]*>[\s\S]*?<\/g>/g, '');
      expect(stripped, f.fileName).not.toMatch(/<text\b/);
      for (const m of f.svg.matchAll(/<g id="(tags|annotations)"([^>]*)>/g)) expect(m[2]).toMatch(/shaper:cutType="guide" fill="none" stroke="#0068FF"/);
      for (const m of f.svg.matchAll(/<text\b[^>]*>/g)) expect(m[0]).not.toMatch(/\sfill=/); // no filled glyph: a guide is a blue STROKE
    }
    // The title block sits below the part, not over its black outline.
    const f = fileOf('transom-rear');
    const y = [...f.svg.matchAll(/<g id="annotations"[^>]*>\s*<text x="[-\d.]+" y="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(y[0]).toBeGreaterThan(f.heightIn);
  });

  it('keeps the GRAIN label off its arrow (round 3): clear above a horizontal arrow, beside a vertical one', () => {
    let n = 0;
    for (const f of files) {
      const label = /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>GRAIN along/.exec(f.svg);
      if (!label) continue;
      n++;
      const arrow = /<path d="M([-\d.]+),([-\d.]+)L([-\d.]+),([-\d.]+)"[^>]*><title>grain<\/title>/.exec(f.svg)!;
      const [x0, y0, x1, y1] = arrow.slice(1).map(Number), [lx, ly] = [Number(label[1]), Number(label[2])];
      if (Math.abs(y1 - y0) < 1e-6) expect(y0 - ly, f.fileName).toBeGreaterThanOrEqual(0.1); // the baseline is above the arrow line (SVG y grows down)
      else expect(Math.min(lx - x0, lx - x1), f.fileName).toBeGreaterThanOrEqual(0.1);
    }
    expect(n).toBeGreaterThan(3);
  });

  it('cuts the two 3/8 in box drain holes in the deck (Standard spec, D-83), and nothing that is drilled in place: the flat-position seat-pin holes (through the panel\'s own holes) and the stop-block screws (from below)', () => {
    const deck = fileOf('deck');
    expect(deck.features.filter((x) => (x.kind === 'hole' || x.kind === 'drill') && x.joint === 'pin')).toEqual([]);
    expect(deck.features.filter((x) => /^seat-wedge-/.test(x.to ?? ''))).toEqual([]);
    expect(deck.features.some((x) => x.kind === 'note' && /seat-pin-L/.test(String(x.to ?? '')))).toBe(true); // a note in the file, not a cut
    const drain = deck.features.filter((x) => x.kind === 'hole' && x.joint === 'hole');
    expect(drain.reduce((n, x) => n + x.count, 0)).toBe(2);
    for (const x of drain) expect(x.diaIn).toBeCloseTo(3 / 8, 4); // exactly the drain size, not a bolt clearance
    const holes = paths(deck.svg).filter((t) => attr(t, 'shaper:cutType') === 'inside');
    expect(holes.length).toBe(2);
  });

  it('D-83: the web\'s file CUTS the two 3/8 in side drains once (they guide the bit through the bands after the glue-up; no second drill mark), and the Extreme spec keeps the nipple drill marks', () => {
    const web = fileOf('side-L-web');
    const drains = web.features.filter((x) => /drain/i.test(x.label));
    expect(drains.reduce((n, x) => n + x.count, 0)).toBe(2);
    for (const x of drains) { expect(x.diaIn).toBeCloseTo(3 / 8, 4); expect(x.kind).toBe('hole'); expect(x.label).toMatch(/inside cut/); }
    expect(web.features.filter((x) => x.kind === 'drill')).toEqual([]);
    const ext = { ...p, weatherSpec: 1 };
    const w2 = shaperFiles(buildModel(ext), ext).find((f) => f.partIds.includes('side-L-web'))!;
    expect(w2.features.filter((x) => /drain/i.test(x.label)).reduce((n, x) => n + x.count, 0)).toBe(2);
  });
});
