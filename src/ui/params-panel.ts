import { GROUP_LABELS, PARAM_DEFS, validateParams, type ParamGroup, type ParamKey } from '../params';
import type { Store } from '../state';
import { h } from './dom';

const STATUS_HELP: Record<string, string> = {
  locked: 'Locked: fixed by the brief or the event rules',
  verify: 'Verify: placeholder, measure/confirm',
  assumed: 'Assumed: engineering assumption',
  explore: 'Explore: design variable to optimise',
};

type Sync = (value: number) => void;

function fmtValue(v: number): string {
  return String(Number(v.toFixed(4)));
}

function buildRow(key: ParamKey, store: Store, syncs: Map<ParamKey, Sync>): HTMLElement {
  const d = PARAM_DEFS[key];
  const id = `p-${key}`;
  const tip = [STATUS_HELP[d.status], d.note].filter(Boolean).join('\n');

  const badge = h('span', { class: `badge ${d.status}`, title: STATUS_HELP[d.status] }, d.status);
  const label = h('label', { for: id, class: 'plabel' }, d.label);
  const head = h('div', { class: 'phead' }, label, badge);
  const row = h('div', { class: 'prow', title: tip }, head);

  if (d.options) {
    const sel = h('select', { id });
    for (const o of d.options) sel.append(h('option', { value: String(o.value) }, o.label));
    sel.addEventListener('change', () => store.set(key, Number(sel.value)));
    row.append(sel);
    syncs.set(key, (v) => { sel.value = String(v); });
    return row;
  }

  const num = h('input', { id, type: 'number', min: String(d.min), max: String(d.max), step: String(d.step), class: 'pnum' });
  const unit = h('span', { class: 'punit' }, d.unit);
  const ctl = h('div', { class: 'pctl' });
  if (d.primary) {
    const range = h('input', { type: 'range', min: String(d.min), max: String(d.max), step: String(d.step), class: 'prange', 'aria-label': d.label });
    range.addEventListener('input', () => store.set(key, Number(range.value)));
    ctl.append(range);
    syncs.set(key, (v) => { range.value = String(v); num.value = fmtValue(v); });
  } else {
    syncs.set(key, (v) => { num.value = fmtValue(v); });
  }
  num.addEventListener('change', () => {
    store.set(key, Number(num.value));
    syncs.get(key)!(store.get()[key]); // re-show the clamped value even if the store value didn't change
  });
  ctl.append(num, unit);
  row.append(ctl);
  return row;
}

export function mountParamsPanel(host: HTMLElement, store: Store): void {
  const syncs = new Map<ParamKey, Sync>();
  const keys = Object.keys(PARAM_DEFS) as ParamKey[];

  const issuesBox = h('section', { class: 'panel-section issues', 'aria-live': 'polite' });
  host.append(issuesBox);

  const key = h('section', { class: 'panel-section' }, h('h2', {}, 'Key parameters'));
  for (const k of keys) if (PARAM_DEFS[k].primary) key.append(buildRow(k, store, syncs));
  host.append(key);

  for (const group of Object.keys(GROUP_LABELS) as ParamGroup[]) {
    const advanced = keys.filter((k) => PARAM_DEFS[k].group === group && !PARAM_DEFS[k].primary);
    if (!advanced.length) continue;
    const details = h('details', { class: 'panel-section' }, h('summary', {}, GROUP_LABELS[group], h('span', { class: 'count' }, String(advanced.length))));
    for (const k of advanced) details.append(buildRow(k, store, syncs));
    host.append(details);
  }

  const sync = () => {
    const p = store.get();
    for (const [k, fn] of syncs) fn(p[k]);
    const issues = validateParams(p);
    issuesBox.replaceChildren(
      ...issues.map((i) =>
        h('div', { class: `issue ${i.severity}`, title: i.keys.map((k) => PARAM_DEFS[k].label).join(', ') },
          i.severity === 'error' ? '✖ ' : '⚠ ', i.message),
      ),
    );
    issuesBox.hidden = issues.length === 0;
  };
  store.subscribe(sync);
  sync();
}
