/**
 * The "Simple" view (docs/simple-view-spec.md, D-30): "Is this cart safe, and for what rider weights?" at a glance.
 * Left: a handful of plain controls. Right: the rider range bar, six traffic lights, a spec card and "watch it" demos.
 *
 * Everything below `mountSimpleView` works on a plain `Params` design object (`DesignView`), never on a global, so a
 * later A-vs-B comparison is two `DesignView`s rendered by two safety cards.
 */
import { PARAM_DEFS, type ParamDef, type Params } from '../params';
import type { FitResult } from '../truck/fit';
import { SEVERITY, type Status } from '../analysis/types';
import { LIGHTS, isRiderSweepCached, lightOf, riderSweep, type Light, type SweepResult } from '../analysis/rider-sweep';
import type { Store } from '../state';
import { h } from './dom';
import { LIGHT_CHECK_IDS, LIGHT_TITLE, failReason, headline, lightTexts, limitLine } from './simple-text';
import './simple-view.css';

export type DemoId = 'tilt' | 'turn' | 'bump' | 'brake';
export const DEMOS: { id: DemoId; label: string; title: string }[] = [
  { id: 'tilt', label: 'Tilt test', title: 'Tip the ground sideways until a wheel lifts' },
  { id: 'turn', label: 'Sharp turn', title: 'Full-lock turn at speed' },
  { id: 'bump', label: 'Curb bump', title: 'Roll into a root and a curb' },
  { id: 'brake', label: 'Brake on a hill', title: 'Roll down a slope, then brake' },
];

/** Numbers the spec card shows that come from the part list rather than the checks. */
export interface SpecFacts {
  emptyLb: number;
  /** Mass in transport configuration (removable parts off): what two people lift. */
  transportLb: number;
}

export interface DesignView {
  p: Params;
  fit: FitResult;
  spec: SpecFacts;
  sweep: SweepResult;
}

export interface SimpleViewDeps {
  store: Store;
  /** A traffic light was clicked: open Advanced → Analysis at (the first / worst) row of this check. */
  onLight(light: Light, checkId: string): void;
  /** A "watch it" demo was clicked: open Advanced → Simulation with this scenario at this rider weight. */
  onDemo(id: DemoId, riderLb: number): void;
}

export interface SimpleView {
  /** The design changed (or was first built): recompute after a short debounce. */
  setDesign(p: Params, fit: FitResult, spec: SpecFacts): void;
  /** Only compute while the Simple view is showing. */
  setVisible(visible: boolean): void;
}

const FROM = 50, TO = 250, STEP = 10;
const DEBOUNCE_MS = 150;
const STATUS_WORD: Record<Status, string> = { pass: 'OK', marginal: 'Close to the limit', fail: 'Problem', info: 'For information' };
const GLYPH: Record<Status, string> = { pass: '✔', marginal: '!', fail: '✖', info: '–' };

const f1 = (v: number) => v.toFixed(1);
const dims = (d: { lengthIn: number; widthIn: number; heightIn: number }) => `${f1(d.lengthIn)} × ${f1(d.widthIn)} × ${f1(d.heightIn)} in`;
const fmtVal = (v: number) => String(Number(v.toFixed(4)));

// ── Left: "Your cart" ────────────────────────────────────────────────────────────────────────────────────────────────

interface Control {
  id: string;
  label: string;
  hint: string;
  /** Param limits taken from PARAM_DEFS (the one home for design numbers). */
  def: ParamDef;
  unit: string;
  get(p: Params): number;
  set(store: Store, v: number): void;
  reset(store: Store): void;
  prominent?: boolean;
}

const setOne = (key: 'riderMassLb' | 'wheelbaseIn' | 'wheelDiameterIn' | 'deckHeightIn' | 'steerLockDeg') => (store: Store, v: number) => store.set(key, v);
const resetOne = (key: 'riderMassLb' | 'wheelbaseIn' | 'wheelDiameterIn' | 'deckHeightIn' | 'steerLockDeg') => (store: Store) => store.set(key, PARAM_DEFS[key].default);

const CONTROLS: Control[] = [
  {
    id: 'rider', label: 'Rider weight', unit: 'lb', def: PARAM_DEFS.riderMassLb, prominent: true,
    // The slider writes riderMassLb (50-250 lb, the same span as the safety bar).
    hint: 'The rider the lights are checked for. The bar shows every weight from 50 to 250 lb.',
    get: (p) => p.riderMassLb, set: setOne('riderMassLb'), reset: resetOne('riderMassLb'),
  },
  { id: 'length', label: 'Length between wheels', unit: 'in', def: PARAM_DEFS.wheelbaseIn, hint: 'Axle to axle (wheelbase).', get: (p) => p.wheelbaseIn, set: setOne('wheelbaseIn'), reset: resetOne('wheelbaseIn') },
  {
    id: 'width', label: 'Width between wheels', unit: 'in', def: PARAM_DEFS.rearTrackIn, hint: 'Center to center; front and rear are set together.',
    get: (p) => p.rearTrackIn,
    set: (store, v) => store.replace({ ...store.get(), frontTrackIn: v, rearTrackIn: v }),
    reset: (store) => store.replace({ ...store.get(), frontTrackIn: PARAM_DEFS.frontTrackIn.default, rearTrackIn: PARAM_DEFS.rearTrackIn.default }),
  },
  { id: 'wheel', label: 'Wheel size', unit: 'in', def: PARAM_DEFS.wheelDiameterIn, hint: 'Tire diameter.', get: (p) => p.wheelDiameterIn, set: setOne('wheelDiameterIn'), reset: resetOne('wheelDiameterIn') },
  { id: 'floor', label: 'Floor height', unit: 'in', def: PARAM_DEFS.deckHeightIn, hint: 'Top of the floor above the ground. Lower is steadier.', get: (p) => p.deckHeightIn, set: setOne('deckHeightIn'), reset: resetOne('deckHeightIn') },
  { id: 'steer', label: 'How sharp it turns', unit: '°', def: PARAM_DEFS.steerLockDeg, hint: 'Steering angle each way. More degrees = a tighter turning circle.', get: (p) => p.steerLockDeg, set: setOne('steerLockDeg'), reset: resetOne('steerLockDeg') },
];

function mountControls(host: HTMLElement, store: Store): void {
  const syncs: Array<(p: Params) => void> = [];
  const section = h('section', { class: 'sv-controls', 'aria-labeledby': 'sv-cart-h' }, h('h2', { id: 'sv-cart-h' }, 'Your cart'));
  for (const c of CONTROLS) {
    const id = `sv-${c.id}`;
    const d = c.def;
    const range = h('input', { id, type: 'range', min: String(d.min), max: String(d.max), step: String(d.step), class: 'sv-range', 'aria-describedby': `${id}-hint` });
    const num = h('input', { type: 'number', min: String(d.min), max: String(d.max), step: String(d.step), class: 'sv-num', 'aria-label': `${c.label} (${c.unit})` });
    const reset = h('button', { type: 'button', class: 'sv-reset', title: `Back to ${fmtVal(c.id === 'width' ? PARAM_DEFS.rearTrackIn.default : d.default)} ${c.unit}`, 'aria-label': `Reset ${c.label}` }, '↺');
    reset.hidden = true;
    reset.addEventListener('click', () => c.reset(store));
    range.addEventListener('input', () => c.set(store, Number(range.value)));
    num.addEventListener('change', () => {
      c.set(store, Number(num.value));
      sync(store.get()); // re-show the clamped value even when the design did not change
    });
    const out = h('span', { class: 'sv-unit' }, c.unit);
    const sync = (p: Params) => {
      const v = c.get(p);
      range.value = String(v);
      if (document.activeElement !== num) num.value = fmtVal(v);
      reset.hidden = Math.abs(v - (c.id === 'width' ? PARAM_DEFS.rearTrackIn.default : d.default)) < 1e-9 && (c.id !== 'width' || p.frontTrackIn === p.rearTrackIn);
    };
    syncs.push(sync);
    section.append(h('div', { class: `sv-row${c.prominent ? ' sv-prominent' : ''}` },
      h('div', { class: 'sv-head' }, h('label', { for: id }, c.label), reset),
      h('div', { class: 'sv-ctl' }, range, num, out),
      h('p', { class: 'sv-hint muted small', id: `${id}-hint` }, c.hint)));
  }
  host.append(section);
  const all = () => syncs.forEach((s) => s(store.get()));
  store.subscribe(all);
  all();
}

// ── Right: "Is it safe?" ─────────────────────────────────────────────────────────────────────────────────────────────

/** Everything the safety card needs is in the `DesignView`; the card never reads a global design (A/B readiness). */
function mountSafetyCard(host: HTMLElement, deps: Pick<SimpleViewDeps, 'onLight' | 'onDemo'>) {
  const headlineIcon = h('span', { class: 'sv-h-icon', 'aria-hidden': 'true' });
  const headlineText = h('span', {});
  const busy = h('span', { class: 'sv-busy muted', hidden: '' }, 'checking…');
  const headEl = h('h2', { class: 'sv-headline', id: 'sv-safe-h' }, headlineIcon, headlineText, busy);
  const live = h('div', { role: 'status', 'aria-live': 'polite', class: 'sv-live' }, headEl);

  const cells: HTMLElement[] = [];
  const bar = h('div', { class: 'sv-bar', role: 'img' });
  for (let w = FROM; w <= TO; w += STEP) {
    const c = h('span', { class: 'sv-cell info' });
    cells.push(c);
    bar.append(c);
  }
  const marker = h('div', { class: 'sv-marker', 'aria-hidden': 'true' }, h('span', { class: 'sv-marker-label' }), h('span', { class: 'sv-marker-tip' }, '▼'));
  const markerLabel = marker.querySelector('.sv-marker-label') as HTMLElement;
  const ticks = h('div', { class: 'sv-ticks', 'aria-hidden': 'true' });
  for (let w = FROM; w <= TO; w += 50) ticks.append(h('span', { style: `left:${((w - (FROM - STEP / 2)) / (TO - FROM + STEP)) * 100}%` }, String(w)));
  const wrap = h('div', { class: 'sv-bar-wrap' }, marker, bar, ticks);
  const legend = h('p', { class: 'sv-legend muted small' },
    h('span', { class: 'sv-key pass' }, '✔ OK'), h('span', { class: 'sv-key marginal' }, '! close to the limit'), h('span', { class: 'sv-key fail' }, '✖ a check fails'), 'Each block is a 10 lb step.');
  const limits = h('ul', { class: 'sv-limits' });

  const lightEls = new Map<Light, { btn: HTMLButtonElement; icon: HTMLElement; status: HTMLElement; text: HTMLElement }>();
  const lightsList = h('ul', { class: 'sv-lights' });
  for (const l of LIGHTS) {
    const icon = h('span', { class: 'sv-light-icon', 'aria-hidden': 'true' });
    const status = h('span', { class: 'sv-light-status' });
    const text = h('span', { class: 'sv-light-text' });
    const btn = h('button', { type: 'button', class: 'sv-light info', 'data-light': l }, icon, h('span', { class: 'sv-light-body' }, h('span', { class: 'sv-light-title' }, LIGHT_TITLE[l], ' ', status), text));
    lightEls.set(l, { btn, icon, status, text });
    lightsList.append(h('li', {}, btn));
    btn.addEventListener('click', () => {
      const dv = last;
      const rows = dv ? dv.sweep.operatingChecks.filter((c) => lightOf(c) === l && c.status !== 'info') : [];
      const worst = rows.reduce<(typeof rows)[number] | undefined>((a, b) => (!a || SEVERITY[b.status] > SEVERITY[a.status] || (b.status === a.status && (b.util ?? 0) > (a.util ?? 0)) ? b : a), undefined);
      deps.onLight(l, worst?.id ?? LIGHT_CHECK_IDS[l][0]);
    });
  }

  const specList = h('dl', { class: 'sv-spec' });
  const demoBtns = DEMOS.map((d) => {
    const b = h('button', { type: 'button', class: 'sv-demo', title: d.title }, d.label);
    b.addEventListener('click', () => { if (last) deps.onDemo(d.id, last.p.riderMassLb); });
    return b;
  });

  host.append(
    live,
    h('section', { class: 'sv-section', 'aria-label': 'Rider weights' }, wrap, legend, limits),
    h('section', { class: 'sv-section', 'aria-labeledby': 'sv-now-h' },
      h('h3', { id: 'sv-now-h' }, 'At this rider weight'), lightsList,
      h('p', { class: 'muted small' }, 'Every check here uses this one rider weight. The Analysis tab also checks the goal and lightest riders. Click a light for the details.')),
    h('section', { class: 'sv-section', 'aria-labeledby': 'sv-spec-h' }, h('h3', { id: 'sv-spec-h' }, 'The cart'), specList),
    h('section', { class: 'sv-section', 'aria-labeledby': 'sv-demo-h' }, h('h3', { id: 'sv-demo-h' }, 'Watch it'), h('div', { class: 'sv-demos' }, ...demoBtns),
      h('p', { class: 'muted small' }, 'Opens the full simulation at this rider weight. “Back to simple” returns here.')),
  );

  let last: DesignView | null = null;

  const markerPos = (w: number) => ((w - (FROM - STEP / 2)) / (TO - FROM + STEP)) * 100;

  function setBusy(on: boolean) {
    busy.hidden = !on;
    host.setAttribute('aria-busy', String(on));
    host.classList.toggle('sv-checking', on);
  }

  function update(dv: DesignView) {
    last = dv;
    const { p, sweep, fit, spec } = dv;
    const w = p.riderMassLb;
    // Headline
    const hd = headline(w, sweep.safe, sweep.lowLimit, sweep.fromLb, sweep.toLb);
    headEl.className = `sv-headline ${hd.ok ? 'pass' : 'fail'}`;
    headlineIcon.textContent = hd.ok ? '✔' : '✖';
    headlineText.textContent = hd.text;
    // Bar
    sweep.points.forEach((pt, i) => {
      const c = cells[i];
      if (!c) return;
      c.className = `sv-cell ${pt.status}`;
      c.textContent = pt.status === 'pass' ? '' : GLYPH[pt.status];
      c.title = `${pt.w} lb: ${pt.status === 'fail' ? `a check fails (${failReason(pt.worst?.id ?? '')})` : pt.status === 'marginal' ? 'passes, but close to a limit' : 'OK'}`;
    });
    marker.style.left = `${markerPos(w)}%`;
    markerLabel.textContent = `${w} lb`;
    bar.setAttribute('aria-label', `Rider weights from ${sweep.fromLb} to ${sweep.toLb} pounds. ${hd.text}. Current rider ${w} pounds.`);
    const lo = limitLine('below', sweep.safe, sweep.lowLimit);
    const hi = limitLine('above', sweep.safe, sweep.highLimit);
    limits.replaceChildren(...[lo, hi].filter((x): x is string => !!x).map((t) => h('li', {}, t)));
    if (!sweep.safe) {
      const bestRun = widestRun(sweep);
      limits.replaceChildren(h('li', {}, bestRun ? `It would be safe for riders about ${bestRun.lo}–${bestRun.hi} lb.` : 'No rider weight from 50 to 250 lb is safe with this design.'));
    }
    // Lights
    const texts = lightTexts({ p, checks: sweep.operatingChecks, fit });
    for (const l of LIGHTS) {
      const t = texts[l];
      const e = lightEls.get(l)!;
      e.btn.className = `sv-light ${t.status}`;
      e.icon.textContent = GLYPH[t.status];
      e.status.textContent = `· ${STATUS_WORD[t.status]}`;
      e.text.textContent = t.text;
      e.btn.setAttribute('aria-label', `${LIGHT_TITLE[l]}: ${STATUS_WORD[t.status]}. ${t.text} Show the details in Advanced.`);
    }
    // Spec card
    const turn = sweep.operatingChecks.find((c) => c.id === 'turn-radius');
    const turnFt = turn ? (2 * (turn.cases?.operating?.value ?? turn.value)) / 12 : NaN;
    const rows: [string, string][] = [
      ['Size, assembled (L × W × H)', dims(fit.dims.installed)],
      ['Size for the truck', dims(fit.dims.removed)],
      ['Empty weight', `${f1(spec.emptyLb)} lb`],
      ['Lift weight, two people', `${f1(spec.transportLb / 2)} lb each`],
      ['Wheel size', `${fmtVal(p.wheelDiameterIn)} in`],
      ['Floor height', `${fmtVal(p.deckHeightIn)} in`],
      ['Turning circle', Number.isFinite(turnFt) ? `${f1(turnFt)} ft` : '–'],
      ['Fits the truck', texts.truck.status === 'pass' ? 'Yes' : texts.truck.status === 'fail' ? 'No' : '–'],
    ];
    specList.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    setBusy(false);
  }

  /** Only the marker moves while a new sweep is pending. */
  function pending(p: Params) {
    marker.style.left = `${markerPos(p.riderMassLb)}%`;
    markerLabel.textContent = `${p.riderMassLb} lb`;
    setBusy(true);
  }
  return { update, pending };
}

/** Widest no-fail run over the whole sweep (shown when the operating weight itself fails). */
function widestRun(s: SweepResult): { lo: number; hi: number } | null {
  let best: { lo: number; hi: number } | null = null;
  let cur: { lo: number; hi: number } | null = null;
  for (const pt of s.points) {
    if (pt.status === 'fail') { cur = null; continue; }
    cur = cur ? { lo: cur.lo, hi: pt.w } : { lo: pt.w, hi: pt.w };
    if (!best || cur.hi - cur.lo > best.hi - best.lo) best = cur;
  }
  return best;
}

export function mountSimpleView(leftHost: HTMLElement, rightHost: HTMLElement, deps: SimpleViewDeps): SimpleView {
  leftHost.classList.add('sv-host');
  rightHost.classList.add('sv-host');
  mountControls(leftHost, deps.store);
  const card = mountSafetyCard(rightHost, deps);

  let pendingDesign: { p: Params; fit: FitResult; spec: SpecFacts } | null = null;
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const compute = () => {
    timer = undefined;
    if (!pendingDesign || !visible) return;
    const { p, fit, spec } = pendingDesign;
    const sweep = riderSweep(p, { fit, fromLb: FROM, toLb: TO, stepLb: STEP });
    card.update({ p, fit, spec, sweep });
  };

  return {
    setDesign(p, fit, spec) {
      pendingDesign = { p, fit, spec };
      if (!visible) return;
      clearTimeout(timer);
      // A rider-weight change on a cached design needs no wait; anything else is debounced behind "checking…".
      if (isRiderSweepCached(p, { fit, fromLb: FROM, toLb: TO, stepLb: STEP })) { compute(); return; }
      card.pending(p);
      timer = setTimeout(compute, DEBOUNCE_MS);
    },
    setVisible(v) {
      visible = v;
      if (v && pendingDesign) {
        clearTimeout(timer);
        card.pending(pendingDesign.p);
        timer = setTimeout(compute, 0);
      }
    },
  };
}
