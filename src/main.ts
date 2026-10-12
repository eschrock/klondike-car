import './style.css';
import { mountThemeToggle } from './theme';
import { store } from './state';
import { derived } from './params';
import { buildModel, type ViewState } from './model';
import { h } from './ui/dom';
import { Viewer } from './viewer/viewer';
import { buildTruckBed } from './truck/bed';
import { checkTruckFit, computeFeasibleWindows, configParts, type CartView, type FitResult, type FitWindows } from './truck/fit';
import { TRANSPORT_VIEW } from './model/removable';
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
const view: CartView = { steerDeg: 0, rider: 'none', cargo: false, removed: false, seat: 'installed', handle: 'up', brakes: true, lights: true, chocks: false }; // rider default follows the mode (setMode)
const build = (p: ReturnType<typeof store.get>, v: CartView): Part[] => buildModel(p, v as ViewState);
// Steering preview (D-56): turns the front axle, wheels, tongue and bridle about the kingpin. Range tied to p.steerLockDeg; never persisted, never changes the design.
const steer = h('input', { type: 'range', min: '-20', max: '20', step: '0.5', value: '0', 'aria-label': 'Steering preview, front axle angle in degrees' });
const steerNum = h('input', { type: 'number', step: '0.5', value: '0', class: 'steer-num', 'aria-label': 'Steering angle (degrees)' });
const steerZero = h('button', { type: 'button', class: 'steer-zero', title: 'Straighten the front axle (0°)', 'aria-label': 'Straighten the front axle' }, '↺');
const setSteer = (v: number) => {
  view.steerDeg = Number.isFinite(v) ? Math.round(v * 2) / 2 : 0; // snap to 0.5° so 0 is always reachable
  render();
};
steer.addEventListener('input', () => setSteer(Number(steer.value)));
steerNum.addEventListener('change', () => setSteer(Number(steerNum.value)));
steerZero.addEventListener('click', () => setSteer(0));
viewer.addToolbarControl(
  h('label', { class: 'steer-ctl', title: "Preview only: it doesn't change the sled. Turns the front axle about the kingpin, from full left to full right lock (+ = left)." }, 'Steering', steer, steerNum, h('span', { class: 'steer-unit' }, '°'), steerZero),
);
const checkbox = (label: string | Node[], title: string, checked: boolean, onChange: (v: boolean) => void, cls = '') => {
  const cb = h('input', { type: 'checkbox' });
  cb.checked = checked;
  cb.addEventListener('change', () => onChange(cb.checked));
  return h('label', { class: `steer-ctl ${cls}`.trim(), title }, cb, ...(typeof label === 'string' ? [label] : label));
};
// Visual pass r2 / 3c round 2: the rider and cargo hide the finish work, so they default OFF in both Simple and Advanced (opt in with the checkbox).
let riderTouched = false;
const riderLabel = checkbox([h('span', { class: 'adv-only' }, 'Show rider & cargo'), h('span', { class: 'simple-only' }, 'Show rider')], 'Show the operating rider and cargo (view only; ignored in the Truck view)', false, (v) => {
  riderTouched = true;
  view.rider = v ? 'operating' : 'none';
  view.cargo = v;
  render();
});
const riderCb = riderLabel.querySelector('input') as HTMLInputElement;
const setRiderShown = (v: boolean) => {
  riderCb.checked = v;
  view.rider = v ? 'operating' : 'none';
  view.cargo = v;
};
viewer.addToolbarControl(riderLabel);
// ── View toggles (D-57, D-65). Simple shows only Transport mode (and Show rider); the individual toggles are Advanced only (`adv-only`). ──
// Transport mode is a meta-control: it shows the truck-fit "transport" configuration (TRANSPORT_VIEW: brakes, lights and chocks off, handle parked, seat back flat; the tongue and the signs
// stay on). While it is on the individual toggles show those states and are locked; turning it off brings back what they were set to.
let transport = false;
const toggles = {} as Record<'seat' | 'handle' | 'brakes' | 'lights' | 'chocks', HTMLInputElement>;
/** What the viewer builds: the individual toggles, or the transport configuration over them. */
const effectiveView = (): CartView => (transport ? { ...view, ...TRANSPORT_VIEW, brakes: true, lights: true, chocks: false } : view);
const syncToggles = () => {
  const e = effectiveView();
  const shown = { seat: e.seat === 'stowed', handle: e.handle === 'parked', brakes: e.brakes !== false && !e.removed, lights: e.lights !== false && !e.removed, chocks: !!e.chocks && !e.removed };
  for (const k of Object.keys(toggles) as Array<keyof typeof toggles>) {
    toggles[k].checked = shown[k];
    toggles[k].disabled = transport;
    toggles[k].closest('label')?.classList.toggle('is-locked', transport);
  }
};
const addToggle = (key: keyof typeof toggles, label: string, title: string, on: (v: boolean) => void) => {
  const l = checkbox(label, title, false, (v) => { on(v); render(); }, 'adv-only');
  toggles[key] = l.querySelector('input') as HTMLInputElement;
  viewer.addToolbarControl(l);
};
const transportCb = checkbox('Transport mode', 'Show the sled as it rides in the truck: the brake flaps, the lights and the wheel chocks off, the handlebow parked and the seat back flat. The tongue and the signs stay on. This is the same set the Truck fit tab uses (D-65). View only.', false, (v) => {
  transport = v;
  render();
});
viewer.addToolbarControl(transportCb);
// Cargo mode (D-53, D-57): the seat back flips flat onto the deck and the two cushions lie in the storage box. View only; with "Show rider & cargo" on, the payload block shows on the bed.
addToggle('seat', 'Seat flat', 'Flip the seat back forward onto the deck and lay the seat cushion and the back pad flat inside the storage box, leaving a flat cargo bed (D-57). With "Show rider & cargo" on, the cargo payload sits on the bed. View only.', (v) => {
  view.seat = v ? 'stowed' : 'installed';
});
// Handlebow parked (D-57): the posts drop to the second pin position and the bow rests just above the rear side top.
addToggle('handle', 'Handle parked', 'Drop the rear handlebow to its second pin position, resting just above the rear side top, as when it is not being pushed (D-57). View only.', (v) => {
  view.handle = v ? 'parked' : 'up';
});
// Removable kits (D-65): the brake flaps (the knees and backers stay on the rails) and the lights.
addToggle('brakes', 'Brakes', 'Show the removable brake parts: the flaps, pivot blocks and pins, shoe blocks and pads, foot treads and return cords. Off hides them (the knees and backers stay bolted on). View only.', (v) => {
  view.brakes = v;
});
addToggle('lights', 'Lights', 'Show the front lamp and its clip and the rear light and its clip. Off hides them. View only.', (v) => {
  view.lights = v;
});
// The wheel chocks hang under the rear knees on cords; they ride in the box when the sled is carried, so the drawing hides them until this toggle asks (3c-5, D-65).
addToggle('chocks', 'Wheel chocks', 'Show the wheel chocks parked in front of the rear tires (they are carried in the box when the sled is on the move). View only.', (v) => {
  view.chocks = v;
});
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
  const lock = Math.abs(p.steerLockDeg);
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
      transport: build(p, { steerDeg: 0, rider: 'none', cargo: false, ...TRANSPORT_VIEW }),
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
    syncToggles();
    if (!sim?.active) viewer.update(build(p, transport ? { ...effectiveView(), steerDeg: 0 } : view)); // the transport config has the axle turned straight
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
const backBar = $('back-bar');
/** Page scroll position to return to when "Back to the simple view" is used. */
let simpleScrollY = 0;
$('btn-back').addEventListener('click', () => {
  setMode('simple'); // not persisted: the saved mode only changes with an explicit Simple | Advanced click
  window.scrollTo({ top: simpleScrollY });
});
const stacked = window.matchMedia('(max-width: 1200px)');

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
    simpleScrollY = window.scrollY;
    setMode('advanced', { fromSimple: true });
    right.showTab('analysis');
    requestAnimationFrame(() => focusAnalysisRow(checkId));
  },
  onDemo(id, riderLb) {
    simpleScrollY = window.scrollY;
    sim?.runScenario(id, { riderLb });
    setMode('advanced', { fromSimple: true });
    right.showTab('simulation'); // activates the sim, which starts the loaded scenario
    if (stacked.matches) window.scrollTo({ top: 0 }); // phone: show the pinned viewer and the simulation controls
  },
});

/**
 * `persist` is true only for an explicit Simple | Advanced click (and the first mount, which keeps the saved value):
 * a demo or traffic-light click that lands in Advanced must not make Advanced the mode the next visit opens in (M8).
 */
function setMode(next: Mode, opts: { fromSimple?: boolean; persist?: boolean } = {}) {
  const fromSimple = !!opts.fromSimple;
  mode = next;
  if (opts.persist) {
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* private window: the choice just won't persist */ }
  }
  app.dataset.mode = mode;
  $('mode-simple').setAttribute('aria-pressed', String(mode === 'simple'));
  $('mode-advanced').setAttribute('aria-pressed', String(mode === 'advanced'));
  backBar.hidden = !(mode === 'advanced' && fromSimple);
  app.classList.toggle('has-back', !backBar.hidden);
  viewer.setSimpleMode(mode === 'simple');
  if (!riderTouched) setRiderShown(false);
  if (mode === 'simple') { // D-65: Simple has only Transport mode; the Advanced toggles go back to their defaults so the picture matches the controls
    view.seat = 'installed'; view.handle = 'up'; view.brakes = true; view.lights = true; view.chocks = false;
  }
  if (mode === 'simple') {
    // Leave anything that takes over the viewer (simulation, truck placement); the design itself is untouched.
    right.showTab('analysis');
    truckKey = null;
    right.setActiveTruckKey(null);
  }
  simple.setVisible(mode === 'simple');
  render();
}
$('mode-simple').addEventListener('click', () => setMode('simple', { persist: true }));
$('mode-advanced').addEventListener('click', () => setMode('advanced', { persist: true }));

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

mountThemeToggle($('btn-theme') as HTMLButtonElement);
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
