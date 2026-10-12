import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { BuildData } from '../build/package';
import {
  bytesLabel, clampStep, cureLine, dims3, featureSummary, fracDim, fracInch, groupByWhen, loadDone, loadStep, loadStepChecks, mergeBuy, noteLead, previewSvg, saveDone, saveStep, saveStepChecks, sharedNote, sheetSvg, splitUrls, stepFocus, tilePagesHtml, todayISO, usd, vendorFromUrl, viewerView,
} from './build-helpers';

const p = defaultParams();
const parts = buildModel(p);
const d = new BuildData(parts, p, { date: '2026-10-12' });

/** Balanced-tag check for the small SVGs these helpers emit (no DOM in the test environment). */
function balanced(markup: string): boolean {
  const re = /<(\/?)([A-Za-z][\w:.-]*)[^<>]*?(\/?)>/g;
  const stack: string[] = [];
  for (let m = re.exec(markup); m; m = re.exec(markup)) {
    if (m[3]) continue;
    if (m[1]) { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]);
  }
  return stack.length === 0;
}

describe('cureLine', () => {
  it('prints the West System pot life, clamp and full-cure times the build tab and the build book share', () => {
    expect(cureLine({ hardener: '206', potMin: [20, 25], clampHours: [8, 10], fullHours: 24 })).toBe('West 206 slow: pot life 20-25 min, clamp 8-10 h, full cure 24 h');
    expect(cureLine({ hardener: '209', potMin: [90, 120], clampHours: [20, 20], fullHours: 48 })).toBe('West 209 extra slow: pot life 90-120 min, clamp 20 h, full cure 48 h');
  });
});

describe('formatting', () => {
  it('formats dollars, dimensions, sizes and dates', () => {
    expect(usd(2376.654)).toBe('$2,376.65');
    expect(usd(1234.5, false)).toBe('$1,235');
    expect(dims3({ t: 1.1875, w: 6, l: 24.5 })).toBe('1-3/16 × 6 × 24-1/2');
    expect(bytesLabel(500)).toBe('500 B');
    expect(bytesLabel(2048)).toBe('2.0 kB');
    expect(todayISO(new Date(2026, 9, 2))).toBe('2026-10-02');
  });
});

describe('previewSvg', () => {
  it('scales a Shaper file to the panel without touching the original', () => {
    const f = d.shaper[0];
    const out = previewSvg(f.svg, 'deck');
    expect(out.startsWith('<svg')).toBe(true);
    const root = /<svg\b[^>]*>/.exec(out)![0];
    expect(root).toContain('width="100%"');
    expect(root).not.toMatch(/height=/);
    expect(root).not.toMatch(/\d(in)"/); // no in-unit sizes left on the root
    expect(root).toContain('viewBox="');
    expect(root).toContain('overflow="hidden"');
    expect(root).toContain('role="img"');
    expect(f.svg).toMatch(/width="[\d.]+in"/); // the download keeps real inches
    expect(out).toContain('shaper:cutDepth');
    expect(balanced(out)).toBe(true);
  });
});

describe('featureSummary', () => {
  it('summarizes every Shaper file', () => {
    for (const f of d.shaper) expect(featureSummary(f.features), f.fileName).toMatch(/outline/);
    expect(featureSummary([{ kind: 'hole', label: 'a', count: 2 }, { kind: 'drill', label: 'b', count: 1 }])).toBe('2 holes, 1 drill mark');
  });
});

describe('sheetSvg', () => {
  it('draws every placed part of every sheet to scale', () => {
    for (const s of d.nest.sheets) {
      const svg = sheetSvg(s);
      expect(balanced(svg)).toBe(true);
      expect(svg).toContain(`viewBox="-1 -1 ${s.lengthIn + 2} ${s.widthIn + 2}"`);
      for (const q of s.placements) expect(svg).toContain(`data-part="${q.partId}"`);
      expect((svg.match(/<path d="M/g) ?? []).length).toBeGreaterThanOrEqual(s.placements.length);
    }
  });
});

describe('print view', () => {
  it('wraps each tile page at its real Letter size', () => {
    const pages = d.tiles[0].pages;
    const html = tilePagesHtml(pages);
    expect((html.match(/class="bp-tile-page"/g) ?? []).length).toBe(pages.length);
    expect(html).not.toContain('<?xml');
    expect(html).toContain('width="8.5in" height="11in"');
    expect(html).toContain('viewBox="0 0 8.5 11"'); // 1 unit = 1 in: the 1 in check square measures 1 in at 100%
  });
});

describe('verify checklist storage', () => {
  it('round-trips through a storage and survives a broken one', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveDone(new Set(['tire-squash', 'wheel']), store);
    expect([...loadDone(store)].sort()).toEqual(['tire-squash', 'wheel']);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadDone(broken).size).toBe(0);
    expect(() => saveDone(new Set(['x']), broken)).not.toThrow();
    mem.set('klondike-build-verify-done', '{not json');
    expect(loadDone(store).size).toBe(0);
  });

  it('groups the checks by when, in order, without losing any', () => {
    const g = groupByWhen(d.verify);
    expect(g.map((x) => x.when)).toEqual(['before ordering', 'before cutting', 'at assembly'].filter((w) => d.verify.some((c) => c.when === w)));
    expect(g.reduce((a, x) => a + x.checks.length, 0)).toBe(d.verify.length);
  });
});

describe('assembly step-through focus', () => {
  const steps = d.steps;

  it('shows the cumulative parts, highlights the step, and uses its camera', () => {
    const built = steps.find((s) => s.partIds.length > 0)!;
    const f = stepFocus(steps, built.n, true)!;
    expect(f.highlightIds).toEqual(built.partIds);
    expect(f.visibleIds).toEqual(expect.arrayContaining(built.partIds));
    expect(f.view).toBe(built.view);
    expect(f.reframe).toBe(true);
    const last = stepFocus(steps, steps[steps.length - 1].n, false)!;
    expect(last.visibleIds!.length).toBeGreaterThanOrEqual(f.visibleIds!.length);
    for (const id of f.visibleIds!) expect(last.visibleIds).toContain(id);
  });

  it('a preparation step with nothing installed shows the whole model, with no highlight', () => {
    const prep = steps[0];
    expect(prep.partIds).toEqual([]);
    const f = stepFocus(steps, prep.n, true)!;
    expect(f.visibleIds).toBeNull();
    expect(f.highlightIds).toEqual([]);
  });

  it('keeps the step index across a parameter change, or the nearest one', () => {
    const n = steps[5].n;
    expect(clampStep(steps, n)).toBe(n);
    const q = { ...p, wheelbaseIn: p.wheelbaseIn + 2 };
    const steps2 = new BuildData(buildModel(q), q).steps;
    expect(clampStep(steps2, n)).toBe(n);
    expect(clampStep(steps, 999)).toBe(steps[steps.length - 1].n);
    expect(clampStep([], 3)).toBe(0);
  });

  it('maps the under view onto a viewer preset', () => {
    expect(viewerView('under')).toBe('under');
    for (const v of ['iso', 'top', 'side', 'front'] as const) expect(viewerView(v)).toBe(v);
    expect(steps.every((s) => ['iso', 'top', 'side', 'front', 'under'].includes(s.view))).toBe(true);
  });
});

describe('off-grid sizes (visual round 2)', () => {
  it('shows the nearest 1/32 with the exact decimal after it, and leaves sixteenths and whole numbers alone', () => {
    expect(fracDim(21.142)).toBe('21-5/32 (21.142)');
    expect(fracDim(0.657)).toBe('21/32 (0.657)');
    expect(fracDim(15.796)).toBe('15-25/32 (15.796)');
    expect(fracDim(24.5)).toBe('24-1/2');
    expect(fracDim(6)).toBe('6');
    expect(fracDim(0.004)).toBe('0.004');
    expect(fracInch(21.142)).toBe('21-5/32" (21.142")');
    expect(fracInch(24.5)).toBe('24-1/2"');
    expect(dims3({ t: 0.625, w: 1.75, l: 21.142 })).toBe('5/8 × 1-3/4 × 21-5/32 (21.142)');
  });
});

describe('assembly step and checks persistence', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('remembers the step and survives garbage or blocked storage', () => {
    const st = mem();
    expect(loadStep(st)).toBe(0);
    saveStep(11, st);
    expect(loadStep(st)).toBe(11);
    st.setItem('klondike-build-step', 'nope');
    expect(loadStep(st)).toBe(0);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadStep(blocked)).toBe(0);
    expect(() => saveStep(3, blocked)).not.toThrow();
  });
  it('keeps the per-step checks per viewer', () => {
    const st = mem();
    saveStepChecks(new Set(['3|Dry fit']), st);
    expect([...loadStepChecks(st)]).toEqual(['3|Dry fit']);
    expect(loadStepChecks({ getItem: () => '{bad' }).size).toBe(0);
  });
});

describe('BOM note helpers', () => {
  it('noteLead keeps the first clause: a Buy list up to its parenthesis, else the first sentence, capped on a word', () => {
    const buy = 'Buy: 3 x 4/4 x 6" x 10 ft; 1 x 4/4 x 9" wide x 6 ft (resaw into strips). 14.26 bf net.';
    expect(noteLead(buy).lead).toBe('Buy: 3 x 4/4 x 6" x 10 ft; 1 x 4/4 x 9" wide x 6 ft');
    expect(noteLead(buy).rest).toMatch(/^\(resaw/);
    const pack = '316 wood screw; pack of 50 per length. Need 6 pcs, sold in packs of 50.';
    expect(noteLead(pack)).toMatchObject({ lead: '316 wood screw; pack of 50 per length.', cut: false });
    expect(noteLead('A decimal 0.792 stays in one sentence').rest).toBe('');
    const long = noteLead(`${'word '.repeat(60)}end`);
    expect(long.lead.length).toBeLessThanOrEqual(141);
    expect(long.lead.endsWith('…')).toBe(true);
    expect(long.cut && long.rest.startsWith('word')).toBe(true);
  });
  it('splitUrls finds raw links and leaves the closing parenthesis and the full stop in the text', () => {
    expect(splitUrls('see (https://clinelumber.com/a/b/). Then')).toEqual(['see (', { url: 'https://clinelumber.com/a/b/' }, '). Then']);
    expect(splitUrls('no link')).toEqual(['no link']);
  });
  it('vendorFromUrl names known shops and falls back to the host', () => {
    expect(vendorFromUrl('https://www.thewoodyard.com/current-pricing-list/')).toBe('The Wood Yard');
    expect(vendorFromUrl('https://www.example.org/x')).toBe('example.org');
    expect(vendorFromUrl('javascript:alert(1)')).toBe('');
  });
  it('sharedNote returns a note only when it is common enough to print once', () => {
    expect(sharedNote(['a', 'a', 'a', 'b'])).toBe('a');
    expect(sharedNote(['a', 'a', 'b', 'c'])).toBeUndefined();
    expect(sharedNote(['a', 'a', undefined])).toBeUndefined();
  });
  it('mergeBuy folds one product split into containers into a single row', () => {
    const rows = mergeBuy([
      { item: 'Resin', unit: 'qt', qty: 2, note: 'n' }, { item: 'Resin', unit: 'pt', qty: 1, note: 'n' }, { item: 'Stain', unit: 'qt', qty: 1, note: 'm' },
    ]);
    expect(rows).toEqual([{ item: 'Resin', note: 'n', buy: '2 qt + 1 pt' }, { item: 'Stain', note: 'm', buy: '1 qt' }]);
  });
});
