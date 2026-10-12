/**
 * The "Simple" view (docs/simple-view-spec.md, D-30): "Is this cart safe, and for what rider weights?" at a glance.
 * Left: the five shape controls. Right: the headline, the rider range bar with the rider-weight slider, six traffic
 * lights, an at-a-glance strip and the "watch it" demos.
 *
 * Everything below `mountSimpleView` works on a plain `Params` design object (`DesignView`), never on a global, so a
 * later A-vs-B comparison is two `DesignView`s rendered by two safety cards.
 */
import { PARAM_DEFS, steerGeometry, type ParamDef, type Params } from '../params';
import type { FitResult } from '../truck/fit';
import { SEVERITY, type Status } from '../analysis/types';
import { LIGHTS, isRiderSweepCached, lightOf, riderSweep, type Light, type SweepResult } from '../analysis/rider-sweep';
import type { Store } from '../state';
import { h } from './dom';
import { LIGHT_CHECK_IDS, LIGHT_TITLE, cargoText, headline, lightTexts, limitLine, limiterAdvice, restingText, weightNote } from './simple-text';
import { cargoCapacity, isCargoCapacityCached, type CargoCapacity } from '../analysis/cargo-capacity';
import './simple-view.css';

export type DemoId = 'tilt' | 'turn' | 'bump' | 'brake';
export const DEMOS: { id: DemoId; label: string; title: string }[] = [
  { id: 'tilt', label: 'Tip it sideways', title: 'Tip the ground sideways until a wheel lifts. Opens the detailed view.' },
  { id: 'turn', label: 'Turn the front axle', title: 'Pull the cart with the front axle turned as far as it goes, and read off the turning circle it drives. Opens the detailed view.' },
  { id: 'bump', label: 'Hit a root at jogging pace', title: 'Roll into a 2 inch root at 5 mph. Opens the detailed view.' },
  { id: 'brake', label: 'Brake on a hill', title: 'Roll down a slope, then brake. Opens the detailed view.' },
];

/** Numbers the at-a-glance strip shows that come from the part list rather than the checks. */
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
const UNIT_WORD: Record<string, string> = { lb: 'pounds', in: 'inches', '°': 'degrees' };
const ANNOUNCE_MS = 600;

const dims = (d: { lengthIn: number; widthIn: number; heightIn: number }) => `${Math.round(d.lengthIn)} × ${Math.round(d.widthIn)} × ${Math.round(d.heightIn)} in`;
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
}

const setOne = (key: 'riderMassLb' | 'wheelbaseIn' | 'wheelDiameterIn' | 'deckHeightIn' | 'bodyWidthIn') => (store: Store, v: number) => store.set(key, v);
const resetOne = (key: 'riderMassLb' | 'wheelbaseIn' | 'wheelDiameterIn' | 'deckHeightIn' | 'bodyWidthIn') => (store: Store) => store.set(key, PARAM_DEFS[key].default);

const CONTROLS: Control[] = [
  {
    id: 'rider', label: 'Rider weight', unit: 'lb', def: PARAM_DEFS.riderMassLb,
    // The slider writes riderMassLb (50-250 lb, the same span as the safety bar).
    hint: 'Check the cart for this rider. The bar shows every weight.',
    get: (p) => p.riderMassLb, set: setOne('riderMassLb'), reset: resetOne('riderMassLb'),
  },
  { id: 'length', label: 'Length between wheels', unit: 'in', def: PARAM_DEFS.wheelbaseIn, hint: 'Axle to axle. Longer is steadier on hills but harder to turn.', get: (p) => p.wheelbaseIn, set: setOne('wheelbaseIn'), reset: resetOne('wheelbaseIn') },
  {
    id: 'width', label: 'Width between wheels', unit: 'in', def: PARAM_DEFS.rearTrackIn, hint: 'Wider = steadier, but harder to fit in the truck.',
    get: (p) => p.rearTrackIn,
    // D-58: the rear track follows the slider; the front track follows it too but never goes below its default (the minimum for the full-lock tire clearance).
    set: (store, v) => store.replace({ ...store.get(), frontTrackIn: Math.max(v, PARAM_DEFS.frontTrackIn.default), rearTrackIn: v }),
    reset: (store) => store.replace({ ...store.get(), frontTrackIn: PARAM_DEFS.frontTrackIn.default, rearTrackIn: PARAM_DEFS.rearTrackIn.default }),
  },
  { id: 'wheel', label: 'Wheel size', unit: 'in', def: PARAM_DEFS.wheelDiameterIn, hint: 'All four wheels. Bigger wheels roll easier, but add weight.', get: (p) => p.wheelDiameterIn, set: setOne('wheelDiameterIn'), reset: resetOne('wheelDiameterIn') },
  { id: 'floor', label: 'Floor height', unit: 'in', def: PARAM_DEFS.deckHeightIn, hint: 'Lower floor = steadier. Higher floor = more clearance.', get: (p) => p.deckHeightIn, set: setOne('deckHeightIn'), reset: resetOne('deckHeightIn') },
  { id: 'body', label: 'Body width', unit: 'in', def: PARAM_DEFS.bodyWidthIn, hint: 'Wider carries more, but the feet need room inside.', get: (p) => p.bodyWidthIn, set: setOne('bodyWidthIn'), reset: resetOne('bodyWidthIn') },
];

/** One labeled slider + number + reset. Returns the row and a function that shows the current design in it. */
function controlRow(c: Control, store: Store): { row: HTMLElement; sync: (p: Params) => void } {
  const id = `sv-${c.id}`;
  const d = c.def;
  const defaultText = `${fmtVal(d.default)} ${c.unit}`;
  const range = h('input', { id, type: 'range', min: String(d.min), max: String(d.max), step: String(d.step), class: 'sv-range', 'aria-describedby': `${id}-hint` });
  const num = h('input', { type: 'number', min: String(d.min), max: String(d.max), step: String(d.step), class: 'sv-num', 'aria-label': `${c.label} (${c.unit})` });
  const reset = h('button', { type: 'button', class: 'sv-reset', title: `Reset to ${defaultText}`, 'aria-label': `Reset ${c.label} to ${defaultText}` }, '↺');
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
    range.setAttribute('aria-valuetext', `${fmtVal(v)} ${UNIT_WORD[c.unit] ?? c.unit}`); // M9: the unit is read, not just the number
    if (document.activeElement !== num) num.value = fmtVal(v);
    reset.hidden = Math.abs(v - d.default) < 1e-9 && (c.id !== 'width' || p.frontTrackIn === Math.max(p.rearTrackIn, PARAM_DEFS.frontTrackIn.default));
  };
  const row = h('div', { class: 'sv-row' },
    h('div', { class: 'sv-head' }, h('label', { for: id }, c.label), reset),
    h('div', { class: 'sv-ctl' }, range, num, out),
    h('p', { class: 'sv-hint muted small', id: `${id}-hint` }, c.hint));
  return { row, sync };
}

/** Mount the given controls into `host` and keep them in step with the store. */
function mountControls(host: HTMLElement, store: Store, ids: string[]): void {
  const syncs: Array<(p: Params) => void> = [];
  for (const c of CONTROLS.filter((x) => ids.includes(x.id))) {
    const { row, sync } = controlRow(c, store);
    syncs.push(sync);
    host.append(row);
  }
  const all = () => syncs.forEach((s) => s(store.get()));
  store.subscribe(all);
  all();
}

// ── Right: "Is it safe?" ─────────────────────────────────────────────────────────────────────────────────────────────

/** Everything the safety card needs is in the `DesignView`; the card never reads a global design (A/B readiness). */
function mountSafetyCard(host: HTMLElement, deps: Pick<SimpleViewDeps, 'onLight' | 'onDemo' | 'store'>) {
  const headlineIcon = h('span', { class: 'sv-h-icon', 'aria-hidden': 'true' });
  const headlineText = h('span', {});
  const busy = h('span', { class: 'sv-busy muted', hidden: '', 'aria-hidden': 'true' }, 'checking…');
  const headEl = h('h3', { class: 'sv-headline', id: 'sv-safe-h' }, headlineIcon, headlineText, busy);
  const sub = h('p', { class: 'sv-sub' });
  // Screen readers get one calm announcement after the user stops changing things (M9), never "checking…".
  const live = h('div', { role: 'status', 'aria-live': 'polite', class: 'sv-sr' });
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  const announce = (text: string) => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { live.textContent = text; }, ANNOUNCE_MS);
  };
  // At-a-glance strip: the few numbers people ask first (size, weight, turning, truck bed).
  const glance = h('ul', { class: 'sv-glance', 'aria-label': 'At a glance' });

  const cells: HTMLElement[] = [];
  // Visual only: the rider slider and the note line under the bar carry the same information for assistive tech (UX r2 C2).
  const bar = h('div', { class: 'sv-bar', 'aria-hidden': 'true' });
  for (let w = FROM; w <= TO; w += STEP) {
    const c = h('span', { class: 'sv-cell info', 'data-w': String(w) });
    cells.push(c);
    bar.append(c);
  }
  // Tapping a block sets the rider weight to it (the slider below does the same for keyboards).
  bar.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-w]') as HTMLElement | null;
    if (t) deps.store.set('riderMassLb', Number(t.dataset.w));
  });
  const marker = h('div', { class: 'sv-marker', 'aria-hidden': 'true' }, h('span', { class: 'sv-marker-label' }), h('span', { class: 'sv-marker-tip' }, '▼'));
  const markerLabel = marker.querySelector('.sv-marker-label') as HTMLElement;
  const ticks = h('div', { class: 'sv-ticks', 'aria-hidden': 'true' });
  for (let w = FROM; w <= TO; w += 50) ticks.append(h('span', { style: `left:${((w - (FROM - STEP / 2)) / (TO - FROM + STEP)) * 100}%` }, String(w)));
  const wrap = h('div', { class: 'sv-bar-wrap' }, marker, bar, ticks);
  const note = h('p', { class: 'sv-note' });
  const legend = h('p', { class: 'sv-legend muted small' },
    h('span', { class: 'sv-key pass' }, '✔ OK'), h('span', { class: 'sv-key marginal' }, '! Close to the limit'), h('span', { class: 'sv-key fail' }, '✖ Problem'), 'Each block is a 10 lb step. Tap a block to try it.');
  const caveat = h('p', { class: 'sv-caveat muted small' }, `Estimated from design calculations (weights from ${FROM} to ${TO} lb). It is not a substitute for a test ride and adult inspection.`);
  const limits = h('ul', { class: 'sv-limits' });
  const advice = h('p', { class: 'sv-advice', hidden: '' });

  // The rider-weight slider sits right under the bar, on every screen size (M5).
  const riderHost = h('div', { class: 'sv-rider' }, h('h3', { class: 'sv-rider-h' }, 'Who is riding?'));
  mountControls(riderHost, deps.store, ['rider']);

  const lightEls = new Map<Light, { btn: HTMLButtonElement; icon: HTMLElement; status: HTMLElement; text: HTMLElement }>();
  const lightsList = h('ul', { class: 'sv-lights' });
  for (const l of LIGHTS) {
    const icon = h('span', { class: 'sv-light-icon', 'aria-hidden': 'true' });
    const status = h('span', { class: 'sv-light-status' });
    const text = h('span', { class: 'sv-light-text' });
    const btn = h('button', { type: 'button', class: 'sv-light info', 'data-light': l }, icon,
      h('span', { class: 'sv-light-body' }, h('span', { class: 'sv-light-title' }, LIGHT_TITLE[l], ' ', status), text),
      h('span', { class: 'sv-light-more', 'aria-hidden': 'true' }, 'Details ›'));
    lightEls.set(l, { btn, icon, status, text });
    lightsList.append(h('li', {}, btn));
    btn.addEventListener('click', () => {
      const dv = last;
      const rows = dv ? dv.sweep.operatingChecks.filter((c) => lightOf(c) === l && c.status !== 'info') : [];
      const worst = rows.reduce<(typeof rows)[number] | undefined>((a, b) => (!a || SEVERITY[b.status] > SEVERITY[a.status] || (b.status === a.status && (b.util ?? 0) > (a.util ?? 0)) ? b : a), undefined);
      deps.onLight(l, worst?.id ?? LIGHT_CHECK_IDS[l][0]);
    });
  }

  // Cargo mode (D-53): what the cart hauls after the race. Its own card; the rider headline above never reads it.
  const cargoHead = h('h3', { class: 'sv-headline info', id: 'sv-cargo-h' }, h('span', { class: 'sv-h-icon', 'aria-hidden': 'true' }), h('span', {}, 'After the race: hauling'));
  const cargoLines = h('ul', { class: 'sv-cargo-lines' });
  const cargoSection = h('section', { class: 'sv-section sv-cargo', 'aria-labelledby': 'sv-cargo-h' }, cargoHead, cargoLines);

  const demoBtns = DEMOS.map((d) => {
    const b = h('button', { type: 'button', class: 'sv-demo', title: d.title, 'aria-label': `${d.label}. Opens the detailed view.` }, d.label);
    b.addEventListener('click', () => { if (last) deps.onDemo(d.id, last.p.riderMassLb); });
    return b;
  });

  // Order: the answer (headline, rider bar and control), then the at-a-glance strip and the Watch-it demos, which the
  // owner asked to keep high (2026-10-10), then the per-light detail.
  host.append(
    live,
    h('h2', { class: 'sv-eyebrow' }, 'Is it safe?'),
    headEl,
    sub,
    h('section', { class: 'sv-section sv-answer', 'aria-label': 'Rider weights' }, wrap, note, riderHost, legend, limits, advice, caveat),
    h('section', { class: 'sv-section', 'aria-labelledby': 'sv-glance-h' }, h('h3', { id: 'sv-glance-h' }, 'The cart at a glance'), glance),
    cargoSection,
    h('section', { class: 'sv-section sv-watch', 'aria-labelledby': 'sv-demo-h' },
      h('h3', { id: 'sv-demo-h' }, 'Watch it ', h('span', { class: 'sv-h3-note' }, '(opens the detailed view)')), h('div', { class: 'sv-demos' }, ...demoBtns)),
    h('section', { class: 'sv-section', 'aria-labelledby': 'sv-now-h' },
      h('h3', { id: 'sv-now-h' }, 'At this rider weight'), lightsList,
      h('p', { class: 'muted small' }, 'Tap a card for the engineering detail.')),
  );

  let last: DesignView | null = null;

  const markerPos = (w: number) => ((w - (FROM - STEP / 2)) / (TO - FROM + STEP)) * 100;

  function setBusy(on: boolean) {
    busy.hidden = !on;
    host.classList.toggle('sv-checking', on);
  }

  function update(dv: DesignView) {
    last = dv;
    const { p, sweep, fit, spec } = dv;
    const w = p.riderMassLb;
    // Headline: two tiers (green headline, yellow named in the subline), plus a caveat under the bar.
    const hd = headline(w, sweep);
    headEl.className = `sv-headline ${hd.tone}`;
    headlineIcon.textContent = hd.tone === 'pass' ? '✔' : hd.tone === 'warn' ? '!' : '✖';
    headlineText.textContent = hd.text;
    sub.textContent = hd.sub ?? '';
    sub.hidden = !hd.sub;
    announce(hd.sub ? `${hd.text}. ${hd.sub}` : hd.text);
    // Bar
    sweep.points.forEach((pt, i) => {
      const c = cells[i];
      if (!c) return;
      c.className = `sv-cell ${pt.status}`;
      c.textContent = GLYPH[pt.status];
      c.title = weightNote(pt.w, pt.status, pt.worst?.id);
    });
    marker.style.left = `${markerPos(w)}%`;
    markerLabel.textContent = `${w} lb`;
    bar.setAttribute('aria-label', `Rider weights from ${sweep.fromLb} to ${sweep.toLb} pounds. ${hd.text}. Current rider ${w} pounds.`);
    note.textContent = weightNote(w, sweep.operating.status, sweep.operating.worst?.id);
    const lo = limitLine('below', sweep.safe, sweep.lowLimit);
    const hi = limitLine('above', sweep.safe, sweep.highLimit);
    limits.replaceChildren(...[lo, hi].filter((x): x is string => !!x).map((t) => h('li', {}, t)));
    // One next step, from whatever stops heavier riders.
    const stop = sweep.highLimit ?? sweep.lowLimit;
    const heavier = !!sweep.highLimit;
    advice.hidden = !stop || !sweep.safe;
    if (stop && sweep.safe) advice.textContent = heavier ? `To carry heavier riders: ${limiterAdvice(stop.id)}.` : `To carry lighter riders: ${limiterAdvice(stop.id)}.`;
    // Lights
    const texts = lightTexts({ p, checks: sweep.operatingChecks, fit });
    for (const l of LIGHTS) {
      const t = texts[l];
      const e = lightEls.get(l)!;
      e.btn.className = `sv-light ${t.status}`;
      e.icon.textContent = GLYPH[t.status];
      e.status.textContent = `· ${STATUS_WORD[t.status]}`;
      e.text.textContent = t.text;
      e.btn.setAttribute('aria-label', `${LIGHT_TITLE[l]}: ${STATUS_WORD[t.status]}. ${t.text} Opens the detailed view.`);
    }
    // At a glance: size, weight, turning circle and the truck, colored like the lights so the two never disagree.
    const bedL = fmtVal(p.truckBedLengthIn), bedW = fmtVal(p.truckWellGapIn);
    const fits = texts.truck.status !== 'fail';
    const rest = restingText(sweep.operatingChecks, p.restLoadLb);
    const assembled = fit.cases.some((c) => c.config === 'installed' && c.fits);
    const item = (k: string, v: string, subText: string | null, cls = '') => h('li', { class: `sv-glance-item ${cls}` },
      h('span', { class: 'sv-glance-k' }, k), h('span', { class: 'sv-glance-v' }, v), ...(subText ? [h('span', { class: 'sv-glance-s' }, subText)] : []));
    glance.replaceChildren(
      item('Size (L × W × H)', dims(fit.dims.installed), null),
      item('Empty weight', `${Math.round(spec.emptyLb)} lb`, `Seat back and handle off: two people lift ${Math.round(spec.transportLb / 2)} lb each`),
      item('Front end', `Pivoting axle, ${fmtVal(Math.abs(p.steerLockDeg))} degrees each way`, 'It turns on one big bolt when the rope pulls it', texts.steering.status),
      ...(rest.maxLb !== null ? [item('Resting weight', rest.text, `${rest.status === 'fail' ? `The goal is ${p.restLoadLb} lb. ` : ''}${rest.note}`, rest.status)] : []),
      item('Turning circle', `about ${Math.round((2 * steerGeometry(p).centerRadiusIn) / 12)} ft across`, 'The circle the rear axle drives at full turn'),
      item('Truck',
        fits ? `✔ Fits a Tacoma bed (${bedL} × ${bedW} in)` : `✖ Too big for a Tacoma bed (${bedL} × ${bedW} in)`,
        fits ? `${assembled ? 'Fully assembled.' : 'With the handle and seat back off.'} Packed size ${dims(fit.dims.removed)}.` : `Packed size ${dims(fit.dims.removed)}.`,
        fits ? 'pass' : 'fail'),
    );
    setBusy(false);
  }

  /** The cargo card: shown from a payload sweep, or "checking…" while it runs. */
  function updateCargo(c: CargoCapacity | null) {
    const icon = cargoHead.firstElementChild as HTMLElement, label = cargoHead.lastElementChild as HTMLElement;
    if (!c) {
      cargoHead.className = 'sv-headline info';
      icon.textContent = '–';
      label.textContent = 'After the race: checking what it can haul…';
      cargoLines.replaceChildren();
      return;
    }
    const t = cargoText(c);
    cargoHead.className = `sv-headline ${t.tone}`;
    icon.textContent = t.tone === 'pass' ? '✔' : t.tone === 'warn' ? '!' : '✖';
    label.textContent = t.headline;
    cargoLines.replaceChildren(...t.lines.map((x) => h('li', {}, x)));
  }

  /** Only the marker moves while a new sweep is pending. */
  function pending(p: Params) {
    marker.style.left = `${markerPos(p.riderMassLb)}%`;
    markerLabel.textContent = `${p.riderMassLb} lb`;
    setBusy(true);
  }
  return { update, pending, updateCargo };
}

export function mountSimpleView(leftHost: HTMLElement, rightHost: HTMLElement, deps: SimpleViewDeps): SimpleView {
  leftHost.classList.add('sv-host');
  rightHost.classList.add('sv-host');
  const section = h('section', { class: 'sv-controls', 'aria-labelledby': 'sv-cart-h' }, h('h2', { id: 'sv-cart-h' }, 'Change the cart'));
  leftHost.append(section);
  mountControls(section, deps.store, ['length', 'width', 'wheel', 'floor', 'body']);
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
    // The payload sweep is about a dozen runs of the checks: let the rider answer paint first, then fill the cargo card (cached by the design).
    cardCargo(p);
  };
  let cargoTimer: ReturnType<typeof setTimeout> | undefined;
  const cardCargo = (p: Params) => {
    clearTimeout(cargoTimer);
    if (isCargoCapacityCached(p)) { card.updateCargo(cargoCapacity(p)); return; }
    card.updateCargo(null);
    cargoTimer = setTimeout(() => { if (visible) card.updateCargo(cargoCapacity(p)); }, 30);
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
