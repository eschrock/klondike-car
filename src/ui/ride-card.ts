/** The Simple view's "Riding it downhill" card (spec 6.3). All content comes from `rideRules(p)`; this file only lays it out. */
import type { Params } from '../params';
import { h } from './dom';
import { rideRules, type RideVerdict } from './ride-rules';

const WORD: Record<RideVerdict, string> = { go: 'GO', caution: 'CAUTION', walk: 'WALK' };
const GLYPH: Record<RideVerdict, string> = { go: '✔', caution: '!', walk: '✖' };

export interface RideCard {
  el: HTMLElement;
  update(p: Params, cartLb: number): void;
}

export function mountRideCard(): RideCard {
  const el = h('section', { class: 'sv-section sv-ride', 'aria-labelledby': 'sv-ride-h' });
  let lastKey = '';
  function update(p: Params, cartLb: number) {
    const r = rideRules(p, { cartLb });
    const key = JSON.stringify([r, cartLb]);
    if (key === lastKey) return;
    lastKey = key;
    const head = h('tr', {}, h('th', { scope: 'col' }, 'Slope'), ...r.table.columns.map((m) => h('th', { scope: 'col', class: 'sv-ride-mu' }, `μ ${m.toFixed(1)}`)));
    const body = r.table.rows.map((row) =>
      h('tr', {}, h('th', { scope: 'row' }, `${row.slopeDeg}°`),
        ...row.cells.map((c) => h('td', {
          class: `sv-ride-cell ${c.verdict}`,
          title: `Measured friction ${c.measuredMu.toFixed(1)} (usable ${c.usableMu.toFixed(2)}) on ${row.slopeDeg}°: ${WORD[c.verdict]}`,
        }, h('span', { 'aria-hidden': 'true' }, GLYPH[c.verdict]), ' ', WORD[c.verdict]))));
    const table = h('table', { class: 'sv-ride-table' }, h('caption', {}, r.table.caption), h('thead', {}, head), h('tbody', {}, ...body));
    const keyLine = h('p', { class: 'sv-ride-key muted small' },
      h('span', { class: 'sv-key pass' }, '✔ GO'), ' ride at the speed limit. ',
      h('span', { class: 'sv-key marginal' }, '! CAUTION'), ` ${p.rideCautionSpeedMph} mph with an adult beside the cart. `,
      h('span', { class: 'sv-key fail' }, '✖ WALK'), ' rider off, handler on the brake.');
    const camp = h('details', { class: 'sv-ride-camp' },
      h('summary', {}, r.campTest.title),
      h('p', {}, r.campTest.intro),
      h('ol', {}, ...r.campTest.steps.map((s) => h('li', {}, s))),
      h('p', { class: 'muted small' }, r.campTest.note));
    el.replaceChildren(
      h('h3', { id: 'sv-ride-h' }, r.title),
      h('p', {}, r.lead),
      h('ul', { class: 'sv-ride-rules' }, ...r.rules.map((t) => h('li', {}, t))),
      table,
      keyLine,
      camp,
    );
  }
  return { el, update };
}
