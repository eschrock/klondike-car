import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { TRANSPORT_VIEW } from '../model/removable';
import { defaultParams } from '../params';
import { bom } from './bom';
import { SECTION_BLURB, briefingBookHtml } from './briefing-book';
import { usd } from '../ui/build-helpers';

const p = defaultParams();
const parts = buildModel(p, { steerDeg: 0, rider: 'none', cargo: false });
const transportParts = buildModel(p, { steerDeg: 0, rider: 'none', cargo: false, ...TRANSPORT_VIEW });
const b = bom(parts, p);
const html = briefingBookHtml({ p, parts, transportParts, bom: b, images: { mobile: 'data:image/jpeg;base64,AAAA' }, date: '2026-10-19' });
const text = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ');

describe('briefing book', () => {
  it('lists every BOM section with its subtotal and a plain-words blurb, and the BOM total', () => {
    for (const s of b.sections) {
      expect(SECTION_BLURB[s.id]).toBeTruthy();
      expect(html).toContain(`${s.title}</td>`);
      expect(html).toContain(usd(s.subtotalUsd, false));
    }
    expect(html).toContain(usd(b.totalUsd, false));
  });
  it('subtotals the donated wood and asks for a budget on the rest only', () => {
    const wood = b.sections.filter((s) => s.id === 'lumber' || s.id === 'plywood').reduce((a, s) => a + s.subtotalUsd, 0);
    const troop = b.totalUsd - wood;
    expect(html).toContain(`donated by the builder</td><td class="num">${usd(wood, false)}`);
    expect(html).toContain(`Parts the troop buys</td><td class="num">${usd(troop, false)}`);
    const budget = Math.ceil((troop * 1.15) / 50) * 50;
    expect(html).toContain(`troop budget of <strong>${usd(budget, false)}</strong>`);
    expect(budget).toBeLessThan(b.totalUsd);
  });
  it('has no bulk-parts group, and says the brake brackets unbolt (removable knees, the default)', () => {
    expect(html).not.toMatch(/bulk/i);
    expect(text).toMatch(/brake brackets unbolt/);
  });
  it('shows a picture it was given and a placeholder for one it was not', () => {
    expect(html).toContain('<img src="data:image/jpeg;base64,AAAA"');
    expect(html).toContain('picture not available');
  });
  it('carries no design IDs or parameter names (it is for the committee, not the shop)', () => {
    expect(text).not.toMatch(/\b[DA]-\d+\b/);
    expect(text).not.toMatch(/\b[a-z]+[A-Z][a-zA-Z]*(?:Lb|In|Deg)\b/);
  });
  it('ignores an image source that is not a picture', () => {
    const h = briefingBookHtml({ p, parts, transportParts, bom: b, images: { mobile: 'javascript:alert(1)' } });
    expect(h).not.toContain('javascript:');
  });
});
