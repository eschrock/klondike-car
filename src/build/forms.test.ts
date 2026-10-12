import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { computeLayout, outerHalfWidth } from '../model/layout';
import { defaultParams } from '../params';
import { flatPattern } from './flat';
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
  it('draws the side form, rail form, crown templates and brake-flap template', () => {
    expect(drawings.map((d) => d.id)).toEqual(['side-form', 'rail-form', 'crown-templates', 'brake-flap-template']);
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
    const rev = /Params rev ([0-9a-f]{6})/.exec(drawings[0].svg)![1];
    expect(rev).toMatch(/^[0-9a-f]{6}$/);
    const other = formDrawings(buildModel({ ...p, handleBowCrownIn: p.handleBowCrownIn + 0.25 }), { ...p, handleBowCrownIn: p.handleBowCrownIn + 0.25 });
    expect(/Params rev ([0-9a-f]{6})/.exec(other[0].svg)![1]).not.toBe(rev);
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
    expect(note).toContain('NOT applied');
    // The form's body is the face curve plus a straight bottom: its tallest point is the depth plus the turn-in.
    expect(byId('rail-form').heightIn).toBeGreaterThan(L.taper.turnIn);
  });

  it('draws the handlebow and bulkhead templates at the same crown', () => {
    expect(dim('crown-templates', 'bow-crown')).toBeCloseTo(p.handleBowCrownIn, 6);
    expect(dim('crown-templates', 'bulk-crown')).toBeCloseTo(p.handleBowCrownIn, 6);
    expect(dim('crown-templates', 'bulk-span')).toBeCloseTo(2 * L.bulkhead.halfW, 6);
    expect(dim('crown-templates', 'bow-length')).toBeCloseTo(2 * (L.hwC + L.side), 6);
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

  it('makes one Letter page per window, labeled A1, A2, ..., with alignment marks and a check square', () => {
    const d = byId('side-form');
    const pages = tileForLetter(d.svg, d.widthIn, d.heightIn);
    const plan = tilePlan(d.widthIn, d.heightIn);
    expect(pages.length).toBe(plan.windows.length);
    expect(pages.length).toBeGreaterThan(4);
    pages.forEach((pg, i) => {
      expect(wellFormed(pg), `page ${i}`).toBeNull();
      const w = plan.windows[i];
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

  it('skips pages with no ink on them', () => {
    // A 20 x 22 in sheet with two small marks, far apart: 3 x 3 windows, only two of them hold a path.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20in" height="22in" viewBox="0 0 20 22"><title>t</title><path d="M1,1L2,1L2,2L1,2Z" fill="none" stroke="#0068FF" shaper:cutType="guide"></path><path d="M18,20L19,20L19,21L18,21Z" fill="none" stroke="#0068FF" shaper:cutType="guide"></path><text x="10" y="10">label only</text></svg>';
    const plan = tilePlan(20, 22);
    expect(plan.windows.length).toBeGreaterThanOrEqual(6);
    const pages = tileForLetter(svg, 20, 22);
    expect(pages.length).toBe(2);
    expect(pages[0]).toContain('>A1</text>');
    expect(pages[0]).toContain('page 1 of 2');
    expect(pages[1]).toContain(`page 2 of 2`);
  });

  it('puts registration crosses at the same drawing coordinates on neighboring pages, so they overlay', () => {
    const d = byId('side-form');
    const plan = tilePlan(d.widthIn, d.heightIn);
    const pages = tileForLetter(d.svg, d.widthIn, d.heightIn);
    expect(pages.length).toBe(plan.windows.length); // the side form has ink on every page
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

