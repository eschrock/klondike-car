import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { BREAKTHROUGH_IN, analyzeShaperPart, shaperFiles } from './shaper-svg';
import { flatPattern } from './flat';

const p = defaultParams();
const parts = buildModel(p);
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
      expect(Number.parseFloat(attr(outside[0], 'shaper:cutDepth')!), f.fileName).toBeCloseTo(flatPattern(part)!.thicknessIn + BREAKTHROUGH_IN, 3);
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
    expect(jointHoles('seat-grip-L')).toBe(6);
    expect(featureHoles(fileOf('seat-grip-L'))).toBe(6 + 1); // six bolts and the hand hole
    expect(jointHoles('sign-L')).toBe(4);
    expect(featureHoles(fileOf('sign-L'))).toBe(4);
    // And the SVG carries them: the grab board has 7 inside cuts, the seat back 2 pin holes (the inserts are untrusted guide marks).
    expect(paths(fileOf('seat-grip-L').svg).filter((t) => attr(t, 'shaper:cutType') === 'inside').length).toBe(7);
    expect(paths(fileOf('seat-back-panel').svg).filter((t) => attr(t, 'shaper:cutType') === 'inside').length).toBe(2);
    expect(paths(fileOf('sign-L').svg).filter((t) => attr(t, 'shaper:cutType') === 'inside').length).toBe(0); // #10 holes are under the routing size: drill marks
    expect(fileOf('sign-L').svg.match(/<title>drill<\/title>/g)!.length).toBe(4);
  });

  it('keeps the grab-board bolt holes on the board (the joints write model-frame points)', () => {
    const d = analyzeShaperPart(parts.find((x) => x.id === 'seat-grip-L')!, parts, p)!;
    const holes = d.items.filter((i) => i.k === 'cutHole');
    expect(holes.length).toBe(6);
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

  it('engraves DO NOT STEP on the lid as on-line strokes at the legend depth', () => {
    const lid = parts.find((x) => x.id === 'storage-lid')!;
    const f = fileOf('storage-lid');
    const on = paths(f.svg).filter((t) => attr(t, 'shaper:cutType') === 'online');
    expect(on.length).toBeGreaterThanOrEqual(10);
    for (const t of on) { expect(attr(t, 'shaper:cutDepth')).toBe(`${lid.legend!.depthIn}in`); expect(t).toMatch(/fill="none"/); }
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
    const f = fileOf('seat-back-panel');
    expect(f.features.some((x) => x.kind === 'drill' && x.approx)).toBe(true);
    expect(f.svg).toContain('position uncertain');
  });
});
