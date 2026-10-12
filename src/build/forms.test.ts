import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { computeLayout, outerHalfWidth } from '../model/layout';
import { defaultParams } from '../params';
import { flatPattern } from './flat';
import { LETTER_H_IN, LETTER_W_IN, TILE_MARGIN_IN, TILE_OVERLAP_IN, formDrawings, tileForLetter, tilePlan } from './forms';

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
