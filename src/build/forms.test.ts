import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { computeLayout, outerHalfWidth } from '../model/layout';
import { defaultParams } from '../params';
import { flatPattern } from './flat';
import { frac } from './svg-util';
import { cutListFor } from './part-drawings';
import { LETTER_H_IN, LETTER_W_IN, PRINT_CUT_STROKE_IN, RIB_BASE_IN, TILE_MARGIN_IN, TILE_OVERLAP_IN, formDrawings, pathBounds, printStyle, tileForLetter, tilePlan } from './forms';

const p = defaultParams();
const parts = buildModel(p);
const L = computeLayout(p);
const drawings = formDrawings(parts, p);
const byId = (id: string) => drawings.find((d) => d.id === id)!;
const dim = (id: string, key: string) => byId(id).dims.find((d) => d.key === key)!.valueIn;

/** Tags balance, attributes are quoted, one root (no DOM here). */
function wellFormed(xml: string): string | null {
  const body = xml.replace(/<\?xml[^?]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  const stack: string[] = [];
  let pos = 0, roots = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (/[<>]/.test(body.slice(pos, m.index))) return `stray angle bracket near ${pos}`;
    if (m[1]) { if (stack.pop() !== m[2]) return `unbalanced </${m[2]}>`; }
    else if (!m[4]) { if (!stack.length) roots++; stack.push(m[2]); }
    else if (!stack.length) roots++;
    pos = m.index + m[0].length;
  }
  if (/[<>]/.test(body.slice(pos))) return 'trailing markup';
  return stack.length ? `unclosed <${stack[stack.length - 1]}>` : roots === 1 ? null : `${roots} roots`;
}

describe('forms and templates', () => {
  it('draws the side form, rail form, crown templates, brake-flap and knee templates, and the end templates', () => {
    expect(drawings.map((d) => d.id)).toEqual(['side-form', 'rail-form', 'crown-templates', 'brake-flap-template', 'brake-knee-template', 'end-templates']);
  });

  it('D-94: the end templates copy the transom and the bulkhead with every dado and rail mortise cut through, grown to stay one piece, and fit the laser bed', () => {
    const d = byId('end-templates');
    const job = d.laser![0];
    expect(job.thicknessIn).toBeCloseTo(0.25, 6);
    const [tr, bh] = job.items.map((i) => i.shape);
    expect(tr.id).toBe('transom-template');
    expect(bh.id).toBe('bulkhead-template');
    const box = (loop: Array<[number, number]>) => ({ u0: Math.min(...loop.map((q) => q[0])), u1: Math.max(...loop.map((q) => q[0])), v0: Math.min(...loop.map((q) => q[1])), v1: Math.max(...loop.map((q) => q[1])) });
    for (const [shape, id] of [[tr, 'transom-rear'], [bh, 'bow-bulkhead']] as const) {
      const f = flatPattern(parts.find((x) => x.id === id)!)!;
      const ob = box(shape.outer as Array<[number, number]>);
      // the end's outline grown 3/4" all round, and its short side fits the 18-1/2" bed
      expect(ob.u1 - ob.u0).toBeCloseTo(f.widthIn + 1.5, 3);
      expect(ob.v1 - ob.v0).toBeCloseTo(f.heightIn + 1.5, 3);
      expect(Math.min(ob.u1 - ob.u0, ob.v1 - ob.v0)).toBeLessThanOrEqual(18.5);
      // every slot lies inside the template (closed, so the template is one piece)
      for (const sl of shape.holes) { const b = box(sl as Array<[number, number]>); expect(b.u0).toBeGreaterThan(ob.u0); expect(b.u1).toBeLessThan(ob.u1); expect(b.v0).toBeGreaterThan(ob.v0); expect(b.v1).toBeLessThan(ob.v1); }
      // the end's own outline is scored
      expect(shape.score.length).toBeGreaterThan(0);
    }
    // transom: 2 web dados, the deck dado and 2 rail mortises; bulkhead: 3 dados and 2 Domino places
    expect(tr.holes.length).toBe(5);
    expect(bh.holes.length).toBe(5);
    // the bulkhead's Domino slots sit on the rail ends' Dominos: 8-7/8" either side of the center, 15/16" below the rail top (from the rail's joint)
    const W = flatPattern(parts.find((x) => x.id === 'bow-bulkhead')!)!.widthIn;
    const doms = bh.holes.map((h) => box(h as Array<[number, number]>)).filter((b) => b.u1 - b.u0 < 0.3 && b.v1 - b.v0 > 0.8 && b.v1 - b.v0 < 1);
    expect(doms.length).toBe(2);
    for (const b of doms) expect(Math.abs((b.u0 + b.u1) / 2 - 0.75 - W / 2)).toBeCloseTo(8.875, 2);
    expect(d.build.map((q) => q.step).join(' ')).toMatch(/USE \(at the ends step, after the hull is glued\)/);
  });

  it('is well-formed, in real inches, with a title block, a 1 in check square and a cuttable outline', () => {
    for (const d of drawings) {
      expect(wellFormed(d.svg), d.id).toBeNull();
      expect(Number(/<svg[^>]*\swidth="([\d.]+)in"/.exec(d.svg)![1])).toBeCloseTo(d.widthIn, 3);
      expect(Number(/<svg[^>]*\sheight="([\d.]+)in"/.exec(d.svg)![1])).toBeCloseTo(d.heightIn, 3);
      for (const needle of ['Scale 1:1', 'units: inches', '1 in check square', 'shaper:cutType="outside"', 'shaper:cutType="guide"']) expect(d.svg.includes(needle), `${d.id}: ${needle}`).toBe(true);
      expect(d.notes.length).toBeGreaterThan(0);
      for (const t of d.svg.match(/<path\b[^>]*>/g)!) expect(/shaper:cutDepth="[\d.]+in"/.test(t), t.slice(0, 80)).toBe(true);
    }
  });

  it('dates the title block from the params state, never the clock', () => {
    const again = formDrawings(parts, p);
    expect(again[0].svg === drawings[0].svg).toBe(true);
    const rev = /Design revision ([0-9a-f]{6})/.exec(drawings[0].svg)![1];
    expect(rev).toMatch(/^[0-9a-f]{6}$/);
    const other = formDrawings(buildModel({ ...p, handleBowCrownIn: p.handleBowCrownIn + 0.25 }), { ...p, handleBowCrownIn: p.handleBowCrownIn + 0.25 });
    expect(/Design revision ([0-9a-f]{6})/.exec(other[0].svg)![1]).not.toBe(rev);
    expect(formDrawings(parts, p, { date: '2026-10-12' })[0].svg.includes('2026-10-12')).toBe(true);
  });

  it('develops the sheer and chine lines on the web pattern, with cleats every 4 to 5 in and an S-ramp as high as the turn-in', () => {
    const web = flatPattern(parts.find((x) => x.id === 'side-L-web')!)!;
    expect(dim('side-form', 'web-length')).toBeCloseTo(web.widthIn, 6);
    const spacing = dim('side-form', 'cleat-spacing');
    expect(spacing).toBeGreaterThanOrEqual(4);
    expect(spacing).toBeLessThanOrEqual(5);
    expect(dim('side-form', 'sheer-length')).toBeGreaterThan(web.widthIn - 1);
    expect(dim('side-form', 'ramp-rise')).toBeCloseTo(L.taper.turnIn, 6);
    expect(dim('side-form', 's-length')).toBeGreaterThan(L.taper.x1 - L.taper.x0 - 0.5); // developed length, a little longer than the plan
    expect(dim('side-form', 's-length')).toBeLessThan(L.taper.x1 - L.taper.x0 + 1);
  });

  it('bends the rail strips on a form whose face follows the plan turn-in, with the spring-back noted and not applied', () => {
    expect(dim('rail-form', 'turn-in')).toBeCloseTo(L.taper.turnIn, 6);
    expect(dim('rail-form', 'strip')).toBeCloseTo(p.railThicknessIn / 2, 6);
    expect(dim('rail-form', 'min-radius')).toBeCloseTo(L.taper.minRadiusIn, 6);
    expect(dim('rail-form', 'springback-low')).toBeGreaterThan(0);
    // The face is the rail's own outer face: the rail mesh's outermost vertex at the rail end is the hull's outer half width there.
    const rail = parts.find((x) => x.id === 'rail-L')!.geometry as { positions: number[] };
    const ys: number[] = [];
    for (let i = 0; i < rail.positions.length; i += 3) if (Math.abs(rail.positions[i] - L.railEnd) < 1e-6) ys.push(rail.positions[i + 1]);
    expect(Math.max(...ys)).toBeCloseTo(outerHalfWidth(L, L.railEnd), 6);
    const note = byId('rail-form').notes.join(' ');
    expect(note).toMatch(/not built in/);
    // The form's body is the face curve plus a straight bottom: its tallest point is the depth plus the turn-in.
    expect(byId('rail-form').heightIn).toBeGreaterThan(L.taper.turnIn);
  });

  it('draws the handlebow and bulkhead templates at the same crown', () => {
    expect(dim('crown-templates', 'bow-crown')).toBeCloseTo(p.handleBowCrownIn, 6);
    expect(dim('crown-templates', 'bulk-crown')).toBeCloseTo(p.handleBowCrownIn, 6);
    expect(dim('crown-templates', 'bulk-span')).toBeCloseTo(2 * L.bulkhead.halfW, 6);
    expect(dim('crown-templates', 'bow-length')).toBeCloseTo(2 * (L.hwC + L.side), 6);
  });

  it('draws a brake-knee template from the knee outline: its size is the finished knee, with the pocket, pin and bolt-row guides (D-77)', () => {
    const fin = cutListFor(parts, p).finished.find((f) => f.ids.includes('brake-knee-L'))!;
    expect(dim('brake-knee-template', 'knee-width')).toBeCloseTo(fin.final.l, 6);
    expect(dim('brake-knee-template', 'knee-height')).toBeCloseTo(fin.final.w, 6);
    expect(dim('brake-knee-template', 'knee-thickness')).toBeCloseTo(fin.final.t, 3);
    expect(dim('brake-knee-template', 'bolt-rows')).toBe(p.brakeMountBoltRows);
    const t = byId('brake-knee-template');
    expect(t.svg).toMatch(/brake knee outline \(template, offset 0\)/);
    expect(t.svg).toMatch(/pivot pin hole line/);
    expect(t.svg).toMatch(/pocket \(open at the outboard edge\)/);
    expect(t.notes.join(' ')).toMatch(/mirror image/);
    // D-77: no slot lines, no ear: the finished knee is 3-11\/16" reach and 9-1\/2" tall, the pocket rectangle 1-3\/8" wide, 3\/4" to 2-17\/32" below the top end
    expect(t.notes.join(' ')).not.toMatch(/slot/);
    expect(t.notes.join(' ')).toMatch(/pocket rectangle at the top end \(1-3\/8" in from the outboard edge, 3\/4" to 2-17\/32" below the top end/);
    expect(t.notes.join(' ')).toMatch(/pivot pin line \(1-5\/8" below the top end/);
    expect(dim('brake-knee-template', 'knee-width')).toBeCloseTo(3.6875, 3);
    expect(dim('brake-knee-template', 'knee-height')).toBeCloseTo(9.5, 1);
    expect(wellFormed(t.svg)).toBeNull();
  });

  it('cuts both ramp caps as plain rectangles that carry either hand of web: the S-ramp cap the web plus 1/2" a side, the mirror cap 1-1/2" a side for the cleats', () => {
    const web = flatPattern(parts.find((x) => x.id === 'side-L-web')!)!;
    const steps = byId('side-form').build.flatMap((b) => [b.step, ...(b.sub ?? [])]);
    const caps = steps.filter((t) => /^Cap: /.test(t));
    expect(caps).toHaveLength(2);
    expect(caps[0]).toContain(`× ${frac(web.heightIn + 1)}, a plain rectangle centered on the ribs, running 2" past the web's bow end`);
    expect(caps[1]).toContain(`× ${frac(web.heightIn + 3)}, a plain rectangle, running 2" past the web's bow end, 1-1/2" wider than the web each side`);
    expect(steps.join(' ')).not.toMatch(/web's outline plus|second template/);
  });

  it('cuts the brake-flap template at offset 0 with its drill holes', () => {
    const flap = flatPattern(parts.find((x) => x.id === 'brake-flap-L')!)!;
    expect(dim('brake-flap-template', 'flap-length')).toBeCloseTo(flap.widthIn, 6);
    expect(dim('brake-flap-template', 'flap-width')).toBeCloseTo(flap.heightIn, 6);
    expect(dim('brake-flap-template', 'pilot-marks')).toBe(5);
  });
});

describe('tileForLetter', () => {
  const pw = LETTER_W_IN - 2 * TILE_MARGIN_IN, ph = LETTER_H_IN - 2 * TILE_MARGIN_IN;

  it('covers the whole drawing with overlapping Letter windows', () => {
    for (const [w, h] of [[3, 2], [7.5, 10], [7.6, 10.1], [20, 8], [61.8, 24.2], [100, 100]]) {
      const { cols, rows, windows } = tilePlan(w, h);
      expect(windows.length).toBe(cols * rows);
      expect(Math.max(...windows.map((x) => x.x + x.w))).toBeGreaterThanOrEqual(w - 1e-9);
      expect(Math.max(...windows.map((x) => x.y + x.h))).toBeGreaterThanOrEqual(h - 1e-9);
      expect(Math.min(...windows.map((x) => x.x))).toBe(0);
      // Neighbors overlap by the alignment strip and leave no gap.
      for (const a of windows) for (const b of windows) {
        if (b.row === a.row && b.col === a.col + 1) expect(a.x + a.w - b.x).toBeCloseTo(TILE_OVERLAP_IN, 9);
        if (b.col === a.col && b.row === a.row + 1) expect(a.y + a.h - b.y).toBeCloseTo(TILE_OVERLAP_IN, 9);
      }
      // A fine grid of sample points over the drawing each lie in some window.
      for (let u = 0; u <= w; u += Math.max(0.25, w / 40)) for (let v = 0; v <= h; v += Math.max(0.25, h / 40)) expect(windows.some((x) => u >= x.x - 1e-9 && u <= x.x + x.w + 1e-9 && v >= x.y - 1e-9 && v <= x.y + x.h + 1e-9), `${w}x${h} @ ${u},${v}`).toBe(true);
    }
    expect(tilePlan(pw, ph).windows.length).toBe(1);
  });

  it('makes one Letter page per printed window, labeled A1, A2, ..., with alignment marks and a check square', () => {
    const d = byId('side-form');
    const pages = tileForLetter(d.svg, d.widthIn, d.heightIn);
    const plan = tilePlan(d.widthIn, d.heightIn);
    expect(pages.length).toBeLessThanOrEqual(plan.windows.length);
    expect(pages.length).toBeGreaterThan(4);
    pages.forEach((pg, i) => {
      expect(wellFormed(pg), `page ${i}`).toBeNull();
      const w = plan.windows.find((q) => pg.includes(`<title>${'Sandwich side: cleat-line template and S-ramp (1:1)'} page ${q.page}</title>`))!;
      expect(w, `page ${i} has a window`).toBeDefined();
      for (const needle of [`width="${LETTER_W_IN}in" height="${LETTER_H_IN}in"`, `>${w.page}</text>`, '>1 in</text>', 'stroke-dasharray', '<circle', `viewBox="${w.x} ${w.y} ${w.w} ${w.h}"`]) expect(pg.includes(needle), `page ${w.page}: ${needle}`).toBe(true);
    });
    expect(plan.windows.slice(0, 3).map((x) => x.page)).toEqual(['A1', 'A2', 'A3']);
    expect(plan.windows[plan.cols].page).toBe('B1');
  });

  it('puts a small drawing on one page', () => {
    expect(tileForLetter(byId('brake-flap-template').svg, 5, 4).length).toBe(1);
  });
});

describe('printing (Phase 4 round 2)', () => {
  const pathsOf = (svg: string) => [...svg.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
  const att = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

  it('prints cuts as black outlines, never filled, and keeps guides blue', () => {
    for (const d of drawings) {
      const pages = tileForLetter(d.svg, d.widthIn, d.heightIn);
      for (const pg of pages) {
        expect(pg).not.toContain('fill="#000000"');
        for (const t of pathsOf(pg)) {
          const kind = att(t, 'shaper:cutType');
          if (kind === 'outside' || kind === 'inside' || kind === 'pocket') { expect(att(t, 'fill'), t.slice(0, 80)).toBe('none'); expect(att(t, 'stroke')).toBe('#000000'); }
          if (kind === 'outside') expect(Number(att(t, 'stroke-width'))).toBeCloseTo(PRINT_CUT_STROKE_IN, 6);
          if (kind === 'guide') expect(att(t, 'stroke')).toBe('#0068FF');
        }
      }
    }
    // The side form's template outline is on a page as an unfilled black path.
    const pg = tileForLetter(byId('side-form').svg, byId('side-form').widthIn, byId('side-form').heightIn)[0];
    expect(pathsOf(pg).some((t) => att(t, 'shaper:cutType') === 'outside' && att(t, 'fill') === 'none')).toBe(true);
  });

  it('rewrites only outside / inside / pocket paths', () => {
    const src = '<path d="M0,0L1,1Z" fill="#000000" stroke="none" fill-rule="evenodd" shaper:cutType="outside" shaper:cutDepth="1in"></path><path d="M0,0L1,1" fill="none" stroke="#0068FF" stroke-width="0.01" shaper:cutType="guide" shaper:cutDepth="0in"></path><path d="M0,0L1,1" fill="none" stroke="#000000" stroke-width="0.01" shaper:cutType="online"></path>';
    const out = printStyle(src);
    expect(out).toContain('fill="none" stroke="#000000" stroke-width="0.02"');
    expect(out).toContain('fill="none" stroke="#0068FF" stroke-width="0.01" shaper:cutType="guide"');
    expect(out).toContain('shaper:cutType="online"');
    expect(out).not.toContain('#000000" stroke="none"');
  });

  it('reads the bounds of the paths we draw (polygons and circles)', () => {
    expect(pathBounds('M1,2L4,2L4,6L1,6Z')).toEqual({ x0: 1, y0: 2, x1: 4, y1: 6 });
    const b = pathBounds('M9,5a1,1 0 1,0 2,0a1,1 0 1,0 -2,0Z')!; // circle of diameter 2 centered at (10, 5)
    expect(b.x0).toBeCloseTo(9, 9); expect(b.x1).toBeCloseTo(11, 9); expect(b.y0).toBeCloseTo(4, 9); expect(b.y1).toBeCloseTo(6, 9);
  });

  it('skips pages with no CUT path or drill mark on them: guide lines and labels alone do not count', () => {
    // A 20 x 22 in sheet: an outline and a drill mark far apart, plus a long guide line and a label crossing the middle windows (3 x 3 windows, only the two corners print).
    const cut = (d: string) => `<path d="${d}" fill="none" stroke="#000000" shaper:cutType="outside"></path>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20in" height="22in" viewBox="0 0 20 22"><title>t</title>${cut('M1,1L2,1L2,2L1,2Z')}<path d="M18,20.5a0.1,0.1 0 1,0 0.2,0a0.1,0.1 0 1,0 -0.2,0Z" fill="none" stroke="#0068FF" shaper:cutType="guide"></path><path d="M0,11L20,11" fill="none" stroke="#0068FF" shaper:cutType="guide"></path><text x="10" y="10">label only</text></svg>`;
    const plan = tilePlan(20, 22);
    expect(plan.windows.length).toBeGreaterThanOrEqual(6);
    const pages = tileForLetter(svg, 20, 22);
    expect(pages.length).toBe(2);
    expect(pages[0]).toContain('>A1</text>');
    expect(pages[0]).toContain('page 1 of 2');
    expect(pages[1]).toContain(`page 2 of 2`);
  });

  it('prints the outline of a big template only where the outline or a mark is: the side form drops its guide-only pages', () => {
    const d = byId('side-form');
    const plan = tilePlan(d.widthIn, d.heightIn);
    const pages = tileForLetter(d.svg, d.widthIn, d.heightIn);
    expect(pages.length).toBeLessThan(plan.windows.length);
    expect(pages.length).toBeGreaterThan(5);
    for (const f of drawings) expect(tileForLetter(f.svg, f.widthIn, f.heightIn).length, f.id).toBeLessThanOrEqual(tilePlan(f.widthIn, f.heightIn).windows.length);
  });

  it('keeps every footer line inside the page width (about 0.55 em a character) and 0.25 in from every edge', () => {
    for (const d of drawings) for (const pg of tileForLetter(d.svg, d.widthIn, d.heightIn)) {
      for (const m of pg.slice(pg.indexOf('<g id="marks">')).matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)) {
        const [x, y, size, txt] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4]];
        if (/text-anchor="end"/.test(m[0]) || /text-anchor="middle"/.test(m[0])) continue;
        expect(x + txt.length * size * 0.55, `${d.id}: ${txt.slice(0, 40)}`).toBeLessThanOrEqual(LETTER_W_IN - 0.25);
        expect(y).toBeGreaterThanOrEqual(0.25);
        expect(y).toBeLessThanOrEqual(LETTER_H_IN - 0.25);
      }
    }
  });

  it('puts registration crosses at the same drawing coordinates on neighboring pages, so they overlay', () => {
    const d = byId('side-form');
    const plan = tilePlan(d.widthIn, d.heightIn);
    const pages = tileForLetter(d.svg, d.widthIn, d.heightIn);
    expect(pages.length).toBeGreaterThan(plan.cols); // at least two rows print
    const crosses = (i: number): Array<[number, number]> => [...pages[i].matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="0.06"/g)].map((m) => [Number(m[1]) - TILE_MARGIN_IN + plan.windows[i].x, Number(m[2]) - TILE_MARGIN_IN + plan.windows[i].y] as [number, number]);
    const same = (a: Array<[number, number]>, b: Array<[number, number]>) => a.filter((q) => b.some((r) => Math.abs(q[0] - r[0]) < 1e-6 && Math.abs(q[1] - r[1]) < 1e-6));
    const idx = (r: number, c: number) => r * plan.cols + c;
    // Left-right neighbors share crosses at both ends of the overlap strip; so do top-bottom neighbors.
    expect(same(crosses(idx(0, 0)), crosses(idx(0, 1))).length).toBeGreaterThanOrEqual(4);
    expect(same(crosses(idx(0, 0)), crosses(idx(1, 0))).length).toBeGreaterThanOrEqual(4);
    expect(same(crosses(idx(0, 1)), crosses(idx(1, 1))).length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the page label 0.3 in or more from the page bottom', () => {
    const pg = tileForLetter(byId('brake-flap-template').svg, 5, 4)[0];
    const y = Number(/<text x="[\d.]+" y="([\d.]+)"[^>]*font-weight="bold"/.exec(pg)![1]);
    expect(LETTER_H_IN - y).toBeGreaterThanOrEqual(0.3 - 1e-9);
  });
});

describe('S-ramp rib', () => {
  it('sits on a 1/4 in base, so it never ends in a knife edge', () => {
    expect(RIB_BASE_IN).toBeGreaterThanOrEqual(0.25);
    expect(dim('side-form', 'rib-base')).toBeCloseTo(RIB_BASE_IN, 9);
    const ramp = /<g id="ramp"><path d="([^"]*)"/.exec(byId('side-form').svg)!;
    const b = pathBounds(ramp[1])!;
    expect(b.y1 - b.y0).toBeCloseTo(RIB_BASE_IN + L.taper.turnIn, 3); // base plus the rise
    // The first and last vertical edges of the rib are at least the base high.
    const pts = [...ramp[1].matchAll(/[ML]([-\d.]+),([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const xs = pts.map((q) => q[0]), lo = Math.min(...xs);
    const startEdge = pts.filter((q) => Math.abs(q[0] - lo) < 1e-6).map((q) => q[1]);
    expect(Math.abs(Math.max(...startEdge) - Math.min(...startEdge))).toBeGreaterThanOrEqual(RIB_BASE_IN - 1e-3);
  });
});


describe('form text is annotation only (round 3)', () => {
  it('every <text> sits in a stroke-only guide group and carries no fill of its own', () => {
    for (const d of drawings) {
      expect(d.svg.match(/<text\b/g)?.length ?? 0, d.id).toBeGreaterThan(5);
      const stripped = d.svg.replace(/<g id="[a-z]+" shaper:cutType="guide" fill="none" stroke="#0068FF" stroke-width="0.008">[\s\S]*?<\/g>/g, '');
      expect(stripped, d.id).not.toMatch(/<text\b/);
      for (const m of d.svg.matchAll(/<text\b[^>]*>/g)) expect(m[0], d.id).not.toMatch(/\sfill=/);
    }
  });
  it('the side form quotes the web end from the flat pattern, not the band end', () => {
    const f = flatPattern(parts.find((x) => x.id === 'side-L-web')!)!;
    const web = frac(f.widthIn); // fractions in the shop text (59-1/2")
    expect(byId('side-form').notes.join(' ')).toContain(`The web ends at ${web}`);
    expect(byId('side-form').svg).toContain(`web ends ${web.replace(/"/g, '&quot;')}`);
    expect(byId('side-form').notes.join(' ')).not.toMatch(/web ends at 59-1\/4"/); // the web runs 1/4" past the bands into the bulkhead dado
  });
});

describe('how to build the forms (Eric 2026-10-12)', () => {
  const all = (id: string): string => byId(id).build.flatMap((s) => [s.step, ...(s.sub ?? [])]).join(' ');

  it('gives every form an ordered list of build steps, printed in the title block and the description', () => {
    for (const d of drawings) {
      expect(d.build.length, d.id).toBeGreaterThanOrEqual(4);
      expect(d.svg, d.id).toContain('HOW TO BUILD IT');
      expect(d.svg, d.id).toContain(esc1(d.build[0].step.slice(0, 40)));
      for (const t of d.build.flatMap((s) => [s.step, ...(s.sub ?? [])])) expect(/\d\.\d{3,}/.test(t), `${d.id}: ${t.slice(0, 60)}`).toBe(false);
    }
  });

  it('says how to build the rail form: MDF layers to the form line, stacked to the rail depth plus 1/2, on a ply base, counter-form, tape, spring-back, a clamp at every station', () => {
    const t = all('rail-form');
    const layers = Math.ceil((p.railDepthIn + 0.5) / 0.75 - 1e-9);
    expect(t).toContain(`the form is a stack of ${layers} layers of 3/4" MDF, ${frac(layers * 0.75)} tall`);
    expect(t).toMatch(/3\/4" MDF/);
    expect(t).toMatch(/BASE: 3\/4" plywood [\d/-]+" × [\d/-]+"/);
    expect(t).toMatch(/COUNTER-FORM: the reverse image of the form/);
    expect(t).not.toMatch(/CAUL/);
    expect(t).toMatch(/packing tape/);
    expect(t).toMatch(/SPRING-BACK: none is built in/);
    expect(t).toContain(`CLAMP: ${dim('rail-form', 'clamps') + 2} or ${dim('rail-form', 'clamps') + 3} bar or pipe clamps`);
    expect(t).toMatch(/2 strips \(3\/8" × 3-3\/8"\)/); // the strips as cut: planed to the 3" rail depth after the glue-up
    expect(byId('rail-form').svg).toContain('<g id="sketch">');
  });

  it('says how to build the side form: the template, the cleats at their spacing, the ramp ribs and cap, tape and clamps', () => {
    const t = all('side-form');
    expect(t).toMatch(/TEMPLATE \(laser\): the web's flat outline/);
    expect(t).toContain(`CLEATS on the sheer line: ${2 * dim('side-form', 'cleat-count')} blocks`);
    expect(t).toContain(`${dim('side-form', 'cleat-count')} for each bench top`);
    expect(t).toMatch(/Stand each on edge/);
    expect(t).toMatch(/Set them against a dry web/);
    expect(t).toContain(`S-RAMP (first face): cut ${dim('side-form', 'ramp-ribs')} ribs from 3/4" MDF`);
    expect(t).toContain(`MIRROR RAMP (second face)`);
    expect(t).toMatch(/Cap: 1\/4" hardboard/);
    expect(t).toMatch(/packing tape/);
    expect(t).not.toMatch(/spring clamps|C-clamps|spacer \(plywood scraps/);
    expect(t).toMatch(/held down with bags of sand/);
    // the forms are handed: the right side is made on the same benches with the template's rear piece turned over and the cleats re-set
    expect(t).toMatch(/RIGHT SIDE \(later, when the sides are glued\): the forms are set for the left side/);
    expect(t).toMatch(/turn it over along its length/);
  });

  it('says the templates are tracing / routing patterns, not bending forms', () => {
    expect(all('crown-templates')).toMatch(/nothing is bent/);
    expect(all('brake-flap-template')).toMatch(/guide holes/);
  });
});

/** The SVG text form of a string (quotes escaped). */
function esc1(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

describe('forms read plainly (readability round 2)', () => {
  const textsOf = (d: ReturnType<typeof formDrawings>[number]): string[] => [
    ...[...d.svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')),
    d.title, ...d.notes, ...d.build.flatMap((s) => [s.step, ...(s.sub ?? [])]), ...d.dims.flatMap((x) => [x.label, x.text]),
  ];

  it('has no decimal, part key or decision number in any text of any form', () => {
    const keys = [...new Set(parts.flatMap((x) => [x.id, x.partNo ?? x.id]))].filter((k) => /-/.test(k));
    for (const d of drawings) for (const t of textsOf(d)) {
      expect(t, `${d.id}: ${t}`).not.toMatch(/\d\.\d/);
      expect(t, `${d.id}: ${t}`).not.toMatch(/\bD-\d+/);
      for (const k of keys) expect(new RegExp(`(^|[^A-Za-z0-9])${k}([^A-Za-z0-9-]|$)`).test(t), `${d.id}: ${k} in ${t}`).toBe(false);
    }
  });

  it('prints the dimensions table as fractions, counts as counts, angles in whole degrees', () => {
    for (const d of drawings) for (const x of d.dims) {
      if (x.kind === 'length') expect(x.text, `${d.id} ${x.key}`).toBe(frac(x.valueIn));
      if (x.kind === 'count') expect(x.text, `${d.id} ${x.key}`).toMatch(new RegExp(`^${x.valueIn} [a-z][a-z ]+$`));
      if (x.kind === 'angle') expect(x.text, `${d.id} ${x.key}`).toMatch(/^\d+°$/);
      expect(x.text, `${d.id} ${x.key}`).not.toMatch(/\d\.\d/);
    }
    const cleats = byId('side-form').dims.find((x) => x.key === 'cleat-count')!;
    expect(cleats.text).toBe(`${cleats.valueIn} cleats`);
    expect(byId('side-form').dims.find((x) => x.key === 'web-length')!.text).toBe(frac(dim('side-form', 'web-length')));
    expect(byId('crown-templates').dims.find((x) => x.key === 'bow-slope')!.text).toMatch(/^\d+°$/);
  });

  it('states the rail form layer count once and derives the stack height from it', () => {
    const d = byId('rail-form');
    const all = textsOf(d).join('\n');
    const counts = new Set([...all.matchAll(/(\d+) layers/g)].map((m) => m[1]));
    expect(counts.size).toBe(1);
    const n = Number([...counts][0]);
    expect(all).not.toMatch(/\bmore layers\b|\d+ more\b/i);
    const railW = parts.find((x) => x.id === 'rail-L')!.stock!.w;
    expect(n).toBe(Math.ceil((railW + 0.5) / 0.75 - 1e-9));
    expect(all).toContain(`${n} layers of 3/4" MDF, ${frac(n * 0.75)} tall`);
  });

  it('sets the strips past the form\'s bow end, says how much of the rough strip hangs off the rear end, and supports it level with the base (round-3 B1)', () => {
    const d = byId('rail-form');
    const strip = cutListFor(parts, p).cuts.find((c) => c.piece === 'strip' && c.ids.includes('rail-L'))!;
    const dimOf = (k: string): number => d.dims.find((x) => x.key === k)!.valueIn;
    const form = dimOf('form-length'), bow = dimOf('bow-extra'), hang = dimOf('overhang');
    const step = d.build.find((s) => s.step.startsWith('STRAIGHT RUN'))!.step;
    expect(step).not.toContain('cut the strips');
    expect(step).toContain(`bow end about ${frac(bow)} past the form's bow end`);
    // the strip is the bow allowance, the form (along its curved face, a little longer than its straight length) and the overhang
    expect(strip.rough.l - bow - hang).toBeGreaterThan(form - 1e-6);
    expect(strip.rough.l - bow - hang).toBeLessThan(form + 0.5);
    expect(step).toContain(`about ${frac(hang)} of each strip hangs off`);
    expect(step).toContain(`plywood strip, about ${frac(Math.ceil(hang))} long`);
  });

  it('defines the mirror ramp: a second set of ribs for the flipped web, with its own profile on the drawing, and never "the same ramp"', () => {
    const d = byId('side-form');
    const all = textsOf(d).join('\n');
    const mirror = d.build.find((s) => s.step.startsWith('MIRROR RAMP'))!;
    expect(mirror).toBeTruthy();
    expect(mirror.step).toMatch(/lower than its rear end/);
    expect((mirror.sub ?? []).join(' ')).toMatch(/tall from the rear end to the S start, then falling/);
    expect(d.svg).toContain('id="mirrorramp"');
    expect(d.dims.some((x) => x.key === 'mirror-ribs' && x.kind === 'count')).toBe(true);
    // the glue-up step flips onto the mirror ramp, and nothing says the second face goes on the same ramp
    expect(d.build.find((s) => s.step.startsWith('GLUE-UP'))!.sub!.join(' ')).toMatch(/turn the web over along its length onto the MIRROR ramp/);
    expect(all).not.toMatch(/same template and ramp|on the same ramp/);
  });

  it('gives the ramp ribs one spacing, the same in the notes, the steps and the sketch', () => {
    const all = textsOf(byId('side-form')).join('\n');
    // the S-ramp spacing: in the S-ramp note, the S-RAMP step and the sketch; the mirror spacing: in its note and its step
    const d = byId('side-form');
    const sStep = d.build.find((s) => s.step.startsWith('S-RAMP'))!, mStep = d.build.find((s) => s.step.startsWith('MIRROR RAMP'))!;
    const sp = (t: string): string[] => [...t.matchAll(/(\d[\d/-]*)" apart/g)].map((m) => m[1]);
    const sNote = d.notes.find((t) => t.startsWith('S-ramp'))!, mNote = d.notes.find((t) => t.startsWith('Mirror ramp'))!;
    const sSet = new Set([...sp(sNote), ...sp((sStep.sub ?? []).join(' ')), ...[...all.matchAll(/ribs, 3\/4" MDF, (\d[\d/-]*)" apart/g)].map((m) => m[1])]);
    const mSet = new Set([...sp(mNote), ...sp((mStep.sub ?? []).join(' '))]);
    expect(sSet.size).toBe(1);
    expect(mSet.size).toBe(1);
    expect(all).not.toMatch(/about 4-1\/2" apart/);
  });

  it('names the bands of each face with their own sizes (the inner chine band is narrower)', () => {
    const glue = byId('side-form').build.find((s) => s.step.startsWith('GLUE-UP'))!;
    const text = [glue.step, ...(glue.sub ?? [])].join(' ');
    const st = (id: string) => parts.find((x) => x.id === id)!.stock!;
    expect(text).toContain(`outer chine band (${frac(st('side-L-chine').t)} × ${frac(st('side-L-chine').w)})`);
    expect(text).toContain(`inner chine band (${frac(st('side-L-chine-in').t)} × ${frac(st('side-L-chine-in').w)})`);
  });
});
