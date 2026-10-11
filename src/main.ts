import './style.css';
import { store } from './state';
import { derived } from './params';
import { buildModel, type ViewState } from './model';
import { h } from './ui/dom';
import { Viewer } from './viewer/viewer';
import { buildTruckBed } from './truck/bed';
import { checkTruckFit, computeFeasibleWindows, configParts, type CartView, type FitResult, type FitWindows } from './truck/fit';
import type { Part } from './model/types';
import { mountParamsPanel } from './ui/params-panel';
import { mountRightPanel } from './ui/right-panel';
import { mountAnalysisPanel } from './ui/analysis-panel';
import { mountSimPanel } from './ui/sim-panel';
import { runChecks } from './analysis';
import { totalMass } from './model/mass';
import { mountSimpleView, type SpecFacts } from './ui/simple-view';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

mountParamsPanel($('params'), store);
let truckKey: string | null = null; // case shown in the Truck view, if any
let truckTabOpen = false;

// Feasible windows (D-23) are expensive (rebuilds the model ~70x), so they are computed lazily, only while the
// Truck fit tab is open, asynchronously, and cached per parameter set.
let windowsKey = '';
let windowsDone: FitWindows | null = null;
let windowsTimer: ReturnType<typeof setTimeout> | undefined;
let windowsRun = 0;
function scheduleWindows(delayMs: number) {
  if (!truckTabOpen) return;
  const p = store.get();
  const key = JSON.stringify(p);
  if (key === windowsKey && windowsDone) {
    right.setWindows(windowsDone);
    return;
  }
  const run = ++windowsRun;
  right.setWindows('computing');
  clearTimeout(windowsTimer);
  windowsTimer = setTimeout(async () => {
    const w = await computeFeasibleWindows(p, (q, v) => buildModel(q, v as ViewState), () => run !== windowsRun);
    if (run !== windowsRun || !w) return;
    windowsKey = key;
    windowsDone = w;
    right.setWindows(w);
  }, delayMs);
}
// Declared before the right panel so its onTab callback can reach it.
let sim: ReturnType<typeof mountSimPanel> | undefined;
const right = mountRightPanel($('right'), {
  onShowTruck(c) {
    truckKey = c.key;
    right.setActiveTruckKey(truckKey);
    render();
  },
  onTab(id) {
    sim?.setActive(id === 'simulation');
    truckTabOpen = id === 'truck';
    if (truckTabOpen) scheduleWindows(0);
  },
});
const viewer = new Viewer($('viewer'));

// View-only articulation: not a design parameter, never persisted.
// `rider`/`cargo`/`removed` are consumed by the Phase 1 model (missing fields = defaults).
const view: CartView = { steerDeg: 0, rider: 'operating', cargo: true, removed: false };
const build = (p: ReturnType<typeof store.get>, v: CartView): Part[] => buildModel(p, v as ViewState);
// Snap to 0.5° so 0 is always reachable even when the lock is a half degree (e.g. 38.5°).
const snapSteer = (v: number) => Math.round(v * 2) / 2;
const steer = h('input', { type: 'range', min: '-50', max: '50', step: '0.5', value: '0', 'aria-label': 'Displayed steer angle' });
const steerNum = h('input', { type: 'number', step: '0.5', value: '0', class: 'steer-num', 'aria-label': 'Steer angle (degrees)' });
const steerZero = h('button', { type: 'button', class: 'steer-zero', title: 'Center the steering (0°)' }, '0°');
const setSteer = (v: number) => {
  view.steerDeg = Number.isFinite(v) ? snapSteer(v) : 0;
  render();
};
steer.addEventListener('input', () => setSteer(Number(steer.value)));
steerNum.addEventListener('change', () => setSteer(Number(steerNum.value)));
steerZero.addEventListener('click', () => setSteer(0));
viewer.addToolbarControl(
  h('label', { class: 'steer-ctl', title: 'Displayed steer angle (view only; clamped to the steering lock)' }, 'Steer', steer, steerNum, steerZero),
);

const checkbox = (label: string | Node[], title: string, checked: boolean, onChange: (v: boolean) => void, cls = '') => {
  const cb = h('input', { type: 'checkbox' });
  cb.checked = checked;
  cb.addEventListener('change', () => onChange(cb.checked));
  return h('label', { class: `steer-ctl ${cls}`.trim(), title }, cb, ...(typeof label === 'string' ? [label] : label));
};
viewer.addToolbarControl(
  checkbox([h('span', { class: 'adv-only' }, 'Rider & cargo'), h('span', { class: 'simple-only' }, 'Show rider')], 'Show the operating rider and cargo (view only; ignored in the Truck view)', true, (v) => {
    view.rider = v ? 'operating' : 'none';
    view.cargo = v;
    render();
  }),
);
viewer.addToolbarControl(
  checkbox('Transport config', 'Remove the removable parts (rear handle, seat back, tongue, ornaments; D-9)', false, (v) => {
    view.removed = v;
    render();
  }, 'adv-only'),
);
const exitTruck = h('button', { type: 'button', hidden: '' }, 'Exit truck view');
exitTruck.addEventListener('click', () => {
  truckKey = null;
  right.setActiveTruckKey(null);
  render();
});
viewer.addToolbarControl(exitTruck);

const analysis = mountAnalysisPanel(right.panelHost('analysis'));

// The summary and the fit depend only on the design parameters, so they are cached across view-only changes.
let cacheKey = '';
let fit: FitResult;
let specFacts: SpecFacts = { emptyLb: 0, transportLb: 0 };
const render = () => {
  const p = store.get();
  const lock = p.steerLockDeg;
  steer.min = String(-lock);
  steer.max = String(lock);
  view.steerDeg = Math.max(-lock, Math.min(lock, view.steerDeg ?? 0));
  steer.value = String(view.steerDeg);
  steerNum.min = String(-lock);
  steerNum.max = String(lock);
  steerNum.value = String(view.steerDeg);

  const key = JSON.stringify(p);
  if (key !== cacheKey) {
    cacheKey = key;
    fit = checkTruckFit(p, (v) => build(p, v));
    const summary = {
      empty: build(p, { steerDeg: 0, rider: 'none', cargo: false }),
      operating: build(p, { steerDeg: 0, rider: 'operating', cargo: true }),
      goal: build(p, { steerDeg: 0, rider: 'goal', cargo: true }),
      transport: build(p, { steerDeg: 0, rider: 'none', cargo: false, removed: true }),
    };
    specFacts = { emptyLb: totalMass(summary.empty), transportLb: totalMass(summary.transport) };
    right.update(
      summary,
      fit,
      { track: p.rearTrackIn, wb: p.wheelbaseIn, lateralBesideLimit: derived(p).maxTrackBesideWells },
    );
    analysis.update(p, runChecks(p, { fit }));
    windowsDone = null;
    right.setWindows(null);
    scheduleWindows(400);
  }
  // Simple view: the design (rider weight included) changed; it debounces and caches its own sweep.
  simple.setDesign(p, fit, specFacts);

  const tc = truckKey ? fit.cases.find((c) => c.key === truckKey) : undefined;
  exitTruck.hidden = !tc;
  if (tc && tc.placement) {
    if (!sim?.active) viewer.update(configParts(tc.config, (v) => build(p, v)));
    viewer.setTruck(buildTruckBed(p, { ground: true }), tc.placement.transform, `${tc.key}|${tc.placement.txIn}`);
    viewer.highlight([...new Set(tc.colliding.map((q) => q.partId))], '#ff3b30');
  } else {
    viewer.setTruck(null);
    if (!sim?.active) viewer.update(build(p, view));
    viewer.highlight([]);
  }
};
// ── Simple | Advanced (D-30) ──
const MODE_KEY = 'klondike-view-mode';
type Mode = 'simple' | 'advanced';
const readMode = (): Mode => {
  try { return localStorage.getItem(MODE_KEY) === 'advanced' ? 'advanced' : 'simple'; } catch { return 'simple'; }
};
let mode: Mode = readMode();
const app = $('app');
const backBar = h('div', { class: 'back-bar', hidden: '' });
const backBtn = h('button', { type: 'button' }, '← Back to simple');
backBar.append(backBtn);
$('right').prepend(backBar);
backBtn.addEventListener('click', () => setMode('simple'));

/** Briefly highlight the Analysis row for a check (and open it), after a traffic-light click. */
function focusAnalysisRow(checkId: string) {
  const row = $('right').querySelector<HTMLElement>(`[data-check-id="${checkId}"]`);
  if (!row) return;
  const head = row.querySelector<HTMLButtonElement>('.ap-head');
  if (head && head.getAttribute('aria-expanded') === 'false') head.click();
  row.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  row.classList.remove('sv-flash');
  void row.offsetWidth; // restart the animation if it is clicked twice
  row.classList.add('sv-flash');
  setTimeout(() => row.classList.remove('sv-flash'), 2400);
}

const simple = mountSimpleView($('simple-left'), $('simple-right'), {
  store,
  onLight(_light, checkId) {
    setMode('advanced', true);
    right.showTab('analysis');
    requestAnimationFrame(() => focusAnalysisRow(checkId));
  },
  onDemo(id, riderLb) {
    sim?.runScenario(id, { riderLb });
    setMode('advanced', true);
    right.showTab('simulation'); // activates the sim, which starts the loaded scenario
  },
});

function setMode(next: Mode, fromSimple = false) {
  mode = next;
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* private window: the choice just won't persist */ }
  app.dataset.mode = mode;
  $('mode-simple').setAttribute('aria-pressed', String(mode === 'simple'));
  $('mode-advanced').setAttribute('aria-pressed', String(mode === 'advanced'));
  backBar.hidden = !(mode === 'advanced' && fromSimple);
  viewer.setSimpleMode(mode === 'simple');
  if (mode === 'simple') {
    // Leave anything that takes over the viewer (simulation, truck placement); the design itself is untouched.
    right.showTab('analysis');
    truckKey = null;
    right.setActiveTruckKey(null);
  }
  simple.setVisible(mode === 'simple');
  render();
}
$('mode-simple').addEventListener('click', () => setMode('simple'));
$('mode-advanced').addEventListener('click', () => setMode('advanced'));

sim = mountSimPanel(right.panelHost('simulation'), {
  viewer,
  getParams: () => store.get(),
  buildModel: (p, v) => buildModel(p, v),
  restoreView: () => render(),
});
store.subscribe(() => {
  sim?.paramsChanged();
  render();
});
setMode(mode);

$('btn-reset').addEventListener('click', () => store.reset());
$('btn-copy-link').addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(window.location.href);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => (btn.textContent = 'Copy link'), 1500);
});
