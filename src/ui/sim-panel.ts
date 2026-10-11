/**
 * Simulation tab (BRIEF §8, phase-2 spec "Simulation"): scenario presets, controls, readouts and play/pause/reset over the
 * qualitative Rapier sim in src/sim. The physics is loaded lazily on first activation. Drives the 3D viewer by posing the
 * model's parts per rigid body (Viewer.setBodyPoses) and showing the sim ground and obstacles.
 */
import type { Params } from '../params';
import type { ViewState } from '../model';
import type { Mat4, Part, RigidBody, Vec3 } from '../model/types';
import { loadRapier, Sim, type SimReadout } from '../sim/core';
import { DEFAULT_CONFIG, DEFAULT_CONTROLS, SCENARIOS, type RiderCase, type Scenario, type SimConfig, type SimControls } from '../sim/scenarios';
import { buildSimSpec, WHEEL_IDS, type SimSpec, type WheelId } from '../sim/spec';
import { h } from './dom';
import './sim-panel.css';

/** The slice of the Viewer the panel drives. */
export interface SimViewer {
  update(parts: Part[]): void;
  setBodyPoses(poses: Map<RigidBody, Mat4> | null): void;
  setSimEnvironment(shapes: { id: string; kind: 'box' | 'cylinder'; half: Vec3; center: Vec3 }[] | null): void;
  setSimGroundPose(pose: Mat4, focus?: Vec3): void;
  followPoint(p: Vec3 | null, snap?: boolean): void;
}

export interface SimPanelDeps {
  viewer: SimViewer;
  getParams(): Params;
  buildModel(p: Params, v: ViewState): Part[];
  /** Called when the tab is left: the host re-renders the normal (static) model. */
  restoreView(): void;
}

export interface SimPanel {
  /** Call when the Simulation tab becomes active / inactive. */
  setActive(active: boolean): void;
  /** True while the tab is active: the host should not repaint the viewer with its own parts. */
  readonly active: boolean;
  /** Design parameters changed: rebuild the cart and restart the run. */
  paramsChanged(): void;
  /**
   * Load a scenario by id with a custom rider mass and start it (the Simple view's "Watch it" demos). Safe to call before
   * the tab is active: the state is set now and the run starts when `setActive(true)` follows.
   */
  runScenario(id: string, opts?: { riderLb?: number }): void;
}

const WHEEL_LABEL: Record<WheelId, string> = {
  'wheel-FL': 'Front left', 'wheel-FR': 'Front right', 'wheel-RL': 'Rear left', 'wheel-RR': 'Rear right',
};
const MAX_STEPS_PER_FRAME = 60;

export function mountSimPanel(host: HTMLElement, deps: SimPanelDeps): SimPanel {
  host.classList.add('sim-panel');
  let active = false;
  let scenario: Scenario = SCENARIOS[0];
  let config: SimConfig = { ...DEFAULT_CONFIG };
  let controls: SimControls = { ...DEFAULT_CONTROLS };
  let rider: RiderCase = 'operating';
  let customLb = 175;
  let timeScale = 1;
  let running = false;
  let sim: Sim | null = null;
  let building = false;
  let raf = 0;
  let lastFrame = 0;
  let acc = 0;
  let spsEma = 0;
  const setters: Array<() => void> = [];

  // ── DOM helpers ──
  const slider = (label: string, title: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, unit = '', live = true) => {
    const out = h('output', {});
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label });
    const show = () => { out.textContent = `${Number(get().toFixed(2))}${unit}`; };
    const sync = () => { input.value = String(get()); show(); };
    input.addEventListener('input', () => { set(Number(input.value)); show(); if (!live) restart(); });
    setters.push(sync);
    sync();
    return { row: h('label', { class: 'sp-row', title }, h('span', {}, label), input, out), input, sync };
  };
  const toggle = (label: string, title: string, get: () => boolean, set: (v: boolean) => void, restartAfter: boolean) => {
    const cb = h('input', { type: 'checkbox' });
    const sync = () => { cb.checked = get(); };
    cb.addEventListener('change', () => { set(cb.checked); if (restartAfter) restart(); });
    setters.push(sync);
    sync();
    return h('label', { class: 'sp-row sp-check', title }, cb, h('span', {}, label));
  };
  const select = <T extends string>(label: string, options: Array<[T, string]>, get: () => T, set: (v: T) => void) => {
    const sel = h('select', { 'aria-label': label });
    for (const [v, t] of options) sel.append(h('option', { value: v }, t));
    const sync = () => { sel.value = get(); };
    sel.addEventListener('change', () => set(sel.value as T));
    setters.push(sync);
    sync();
    return { row: h('label', { class: 'sp-row' }, h('span', {}, label), sel), sel, sync };
  };
  const group = (title: string, open: boolean, ...kids: HTMLElement[]) => {
    const d = h('details', { class: 'sp-group' }, h('summary', {}, title), ...kids);
    d.open = open;
    return d;
  };

  // ── header ──
  const banner = h('div', { class: 'sp-banner', role: 'note' },
    h('strong', {}, 'Qualitative — the Analysis tab is the real validation.'),
    h('span', {}, ' Rigid bodies, ball wheels, no tire or frame flex: it shows trends and tip onset, not safety margins.'));

  const scenarioSel = h('select', { 'aria-label': 'Scenario' });
  for (const s of SCENARIOS) scenarioSel.append(h('option', { value: s.id }, s.label));
  const blurb = h('p', { class: 'sp-blurb muted small' });
  const playBtn = h('button', { type: 'button', class: 'sp-play' }, 'Play');
  const resetBtn = h('button', { type: 'button' }, 'Reset');
  const scaleSel = h('select', { 'aria-label': 'Time scale' });
  for (const v of [0.1, 0.25, 0.5, 1, 2, 4]) scaleSel.append(h('option', { value: String(v) }, `${v}×`));
  scaleSel.value = '1';
  const transport = h('div', { class: 'sp-transport' }, playBtn, resetBtn, h('label', { class: 'sp-inline' }, 'Speed', scaleSel));

  // ── readouts ──
  const speedOut = h('output', { class: 'sp-big' }, '0.0');
  const stat = (k: string, v: HTMLElement) => h('div', { class: 'sp-stat' }, h('span', { class: 'muted' }, k), v);
  const steerOut = h('output', {}, '0°');
  const timeOut = h('output', {}, '0.0 s');
  const slopeOut = h('output', {}, '0.0°');
  const rollOut = h('output', {}, '0.0°');
  const peakOut = h('output', {}, '1.0×');
  const stats = h('div', { class: 'sp-stats' },
    h('div', { class: 'sp-stat sp-speed' }, speedOut, h('span', { class: 'muted' }, 'mph')),
    stat('Time', timeOut), stat('Steer', steerOut), stat('Side slope', slopeOut), stat('Tilt', rollOut), stat('Peak load', peakOut));
  const wheelRows = WHEEL_IDS.map((id) => {
    const bar = h('span', { class: 'sp-bar-fill' });
    const val = h('td', { class: 'sp-num' }, '–');
    const flag = h('td', { class: 'sp-flag' }, '');
    const tr = h('tr', {}, h('th', { scope: 'row' }, WHEEL_LABEL[id]), val, h('td', {}, h('span', { class: 'sp-bar' }, bar)), flag);
    return { id, tr, bar, val, flag };
  });
  const loads = h('table', { class: 'sp-loads', 'aria-label': 'Per-wheel normal load' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Wheel'), h('th', {}, 'Load lbf'), h('th', {}, '% of weight'), h('th', {}, ''))),
    h('tbody', {}, ...wheelRows.map((r) => r.tr)));
  const alert = h('div', { class: 'sp-alert', role: 'status', 'aria-live': 'polite', hidden: '' });
  const onset = h('div', { class: 'sp-onset small', hidden: '' });
  const info = h('div', { class: 'sp-info muted small' });

  // ── controls ──
  const terrain = group('Terrain & start (changing restarts the run)', true,
    slider('Downhill slope', 'Slope along the direction of travel, 0-20°.', 0, 20, 1, () => config.slopeDeg, (v) => (config.slopeDeg = v), '°', false).row,
    slider('Side slope', 'Starting camber, + raises the left side so the cart leans to the right.', -25, 25, 1, () => config.sideSlopeDeg, (v) => (config.sideSlopeDeg = v), '°', false).row,
    slider('Tilt rate', 'Tilt table: the side slope keeps rising at this rate (deg/s). 0 = fixed slope.', -4, 4, 0.5, () => config.tiltRateDegPerS, (v) => (config.tiltRateDegPerS = v), '°/s', false).row,
    slider('Start speed', 'Initial speed along the ground.', 0, 15, 0.5, () => config.initialSpeedMph, (v) => (config.initialSpeedMph = v), ' mph', false).row,
    slider('Tire friction μ', 'Tire-ground friction coefficient (dry dirt ≈ 0.6-0.8).', 0.2, 2, 0.05, () => config.frictionMu, (v) => (config.frictionMu = v), '', false).row,
    toggle('2" root', 'A half-buried 2" round root across the path.', () => config.root, (v) => (config.root = v), true),
    toggle('3" curb', 'A 3" step up across the path.', () => config.curb, (v) => (config.curb = v), true),
    toggle('Wheels chocked', 'Hold the wheels against rolling (tilt table).', () => config.wheelsLocked, (v) => (config.wheelsLocked = v), true));

  const customRow = slider('Custom rider', 'Rider mass for the custom case.', 60, 250, 5, () => customLb, (v) => (customLb = v), ' lb', false);
  const riderSel = select<RiderCase>('Rider', [['none', 'No rider'], ['operating', 'Operating'], ['goal', 'Goal'], ['custom', 'Custom mass']], () => rider, (v) => { rider = v; customRow.row.hidden = v !== 'custom'; restart(); });
  customRow.row.hidden = true;
  const riderGroup = group('Rider mass case', true, riderSel.row, customRow.row);

  const lockSlider = slider('Steer angle', 'Lock-hold: the steering is held at this angle (+ = left).', -45, 45, 0.5, () => controls.steerAngleDeg, (v) => (controls.steerAngleDeg = v), '°');
  const modeSel = select<SimControls['steerMode']>('Steering', [['bridle', 'Bridle: the rope steers'], ['angle', 'Lock-hold at an angle']], () => controls.steerMode, (v) => { controls.steerMode = v; });
  const pullGroup = group('Pull & steering (live)', true,
    slider('Pull force', 'Horizontal pull at the tongue tip, lbf.', 0, 150, 1, () => controls.pullLbf, (v) => (controls.pullLbf = v), ' lbf').row,
    slider('Pull direction', 'The way the puller walks, from the starting heading (+ = left). The tongue follows it (bridle mode).', -60, 60, 1, () => controls.pullAngleDeg, (v) => (controls.pullAngleDeg = v), '°').row,
    slider('Puller circles', 'The pull direction turns at this rate: the puller walks a circle (deg/s, + = left).', -30, 30, 1, () => controls.pullTurnDegPerS, (v) => (controls.pullTurnDegPerS = v), '°/s').row,
    modeSel.row, lockSlider.row);
  const brakeGroup = group('Brake (live)', true,
    toggle('Brake on', 'Friction torque on the two rear wheels.', () => controls.brakeOn, (v) => (controls.brakeOn = v), false),
    slider('Brake force', 'Total braking force at the rear tire contact patches, lbf.', 0, 200, 5, () => controls.brakeLbf, (v) => (controls.brakeLbf = v), ' lbf').row);

  const notes = h('details', { class: 'sp-group sp-notes' }, h('summary', {}, 'What this models, and what it does not'),
    h('ul', {},
      h('li', {}, 'Masses, CG and inertia come from the parts list (rider and cargo ride on the chassis); the front axle is a separate body on a vertical kingpin with the steering stops as joint limits (D-12, D-25, D-26).'),
      h('li', {}, 'Each wheel is a ball at the tire radius: contact is at the tire centerline (what the static tip check uses). No tire width, sidewall flex, hub or axle bending.'),
      h('li', {}, 'The pull is a horizontal force at the tongue tip in a fixed world direction; real ropes go slack and real pullers react. Rolling resistance is Coulomb-like (0.05 of the load).'),
      h('li', {}, '“Tip onset” is when a second wheel lifts: the support is then a line and the cart tips. The first lift is a load-transfer warning only.'),
      h('li', {}, 'The Analysis tab, not this sim, is the validation. Fixed step 1/240 s.')));

  host.append(banner,
    h('div', { class: 'sp-scenario' }, h('label', {}, h('span', { class: 'sp-label' }, 'Scenario'), scenarioSel), blurb),
    transport, alert, stats, loads, onset, info, terrain, riderGroup, pullGroup, brakeGroup, notes);

  // ── behavior ──
  const syncAll = () => setters.forEach((f) => f());

  const applyScenario = (s: Scenario) => {
    scenario = s;
    config = { ...DEFAULT_CONFIG, ...s.config };
    controls = { ...DEFAULT_CONTROLS, ...s.controls };
    blurb.textContent = s.blurb;
    scenarioSel.value = s.id;
    syncAll();
  };

  const riderViewState = (): ViewState => ({ steerDeg: 0, rider: rider === 'none' ? 'none' : rider === 'goal' ? 'goal' : 'operating', cargo: true });

  /** Rebuild the cart and a fresh sim from the current parameters and settings. */
  const restart = async () => {
    if (!active) return;
    const token = ++buildToken;
    building = true;
    info.textContent = 'Loading physics…';
    let parts: Part[];
    let spec: SimSpec;
    let R: Awaited<ReturnType<typeof loadRapier>>;
    try {
      R = await loadRapier(); // the WASM chunk is fetched here, on first use
      if (token !== buildToken || !active) return;
      const p = deps.getParams();
      parts = deps.buildModel(p, riderViewState());
      spec = buildSimSpec(parts, p, { riderMassLb: rider === 'custom' ? customLb : undefined });
    } catch (e) {
      building = false;
      info.textContent = `Could not start the simulation: ${e instanceof Error ? e.message : String(e)}`;
      return;
    }
    if (token !== buildToken || !active) return;
    sim?.dispose();
    sim = new Sim(R, spec, { config, controls: { ...controls }, script: scenario });
    // The sim owns its live controls from here (scripted events change them): keep one object so the sliders drive it.
    controls = sim.controls;
    building = false;
    deps.viewer.update(parts);
    deps.viewer.setSimEnvironment(sim.environment());
    deps.viewer.setBodyPoses(sim.poses());
    deps.viewer.setSimGroundPose(sim.groundPose(), sim.chassisPositionIn());
    deps.viewer.followPoint(null);
    deps.viewer.followPoint(sim.chassisPositionIn(), true);
    acc = 0;
    running = scenario.id !== 'free' ? true : running;
    paint(sim.readout());
    syncRun();
  };
  let buildToken = 0;
  let lastSnap = '';

  const syncRun = () => {
    playBtn.textContent = running ? 'Pause' : sim?.readout().finished ? 'Done' : 'Play';
  };

  const fmt = (v: number, d = 1) => v.toFixed(d);
  const paint = (r: SimReadout) => {
    const weightLbf = sim ? sim.spec.weightN / 4.4482216 : 1;
    speedOut.textContent = fmt(Math.abs(r.speedMph));
    timeOut.textContent = `${fmt(r.t)} s`;
    steerOut.textContent = `${fmt(r.steerDeg)}°`;
    slopeOut.textContent = `${fmt(r.groundSideSlopeDeg)}°`;
    rollOut.textContent = `${fmt(r.rollDeg)}°`;
    peakOut.textContent = `${fmt(r.peakLoadFactor, 1)}×`;
    for (const w of wheelRows) {
      w.val.textContent = fmt(r.loadLbf[w.id], 0);
      w.bar.style.width = `${Math.min(100, (r.loadLbf[w.id] / weightLbf) * 100 * 2.5)}%`;
      w.tr.classList.toggle('lift', r.lift[w.id]);
      w.flag.textContent = r.lift[w.id] ? 'LIFT' : '';
    }
    alert.hidden = !(r.tipped || r.anyLift);
    alert.classList.toggle('tip', r.tipped);
    alert.textContent = r.tipped
      ? `TIP-OVER at ${fmt(r.tipTime ?? r.t)} s (${r.tipReason === 'roll' ? 'rolled past 60°' : 'hull touched the ground'}).`
      : `Wheel lift: ${WHEEL_IDS.filter((id) => r.lift[id]).map((id) => WHEEL_LABEL[id]).join(', ')}.`;
    if (r.firstLift || r.secondLift) {
      onset.hidden = false;
      const first = r.firstLift ? `first wheel lift at ${fmt(Math.abs(r.firstLift.groundSideSlopeDeg))}° side slope` : '';
      const second = r.secondLift ? `; tip onset (second wheel) at ${fmt(Math.abs(r.secondLift.groundSideSlopeDeg))}°` : '';
      onset.textContent = first + second + '.';
    } else onset.hidden = true;
    info.textContent = sim ? `${fmt(sim.spec.totalMassKg / 0.45359237, 0)} lb total (rider ${fmt(sim.spec.riderMassLb, 0)} lb) · physics ${spsEma ? `${(spsEma / 1000).toFixed(1)}k steps/s` : '–'}${r.finished ? ' · run finished' : ''}` : '';
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!active || !sim || building) { lastFrame = now; return; }
    const dtReal = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (running && !sim.readout().finished) {
      acc += dtReal * timeScale;
      let n = Math.min(MAX_STEPS_PER_FRAME, Math.floor(acc * 240));
      acc -= n / 240;
      if (acc > 0.05) acc = 0;
      const t0 = performance.now();
      const done = n;
      while (n-- > 0) {
        sim.step();
        if (sim.readout().finished) break;
      }
      const ms = performance.now() - t0;
      if (done > 0 && ms > 0) spsEma = spsEma ? spsEma * 0.9 + (done / ms) * 1000 * 0.1 : (done / ms) * 1000;
      if (sim.readout().finished) { running = false; syncRun(); }
    }
    const r = sim.readout();
    // Scripted events (brake, steer-to-lock) flip live controls: keep their widgets in step.
    const snap = `${controls.brakeOn}|${controls.steerMode}|${controls.steerAngleDeg}`;
    if (snap !== lastSnap) { lastSnap = snap; syncAll(); }
    deps.viewer.setBodyPoses(sim.poses());
    deps.viewer.setSimGroundPose(sim.groundPose(), sim.chassisPositionIn());
    deps.viewer.followPoint(sim.chassisPositionIn());
    paint(r);
  };

  playBtn.addEventListener('click', () => {
    if (sim?.readout().finished) { void restart(); return; }
    running = !running;
    syncRun();
  });
  resetBtn.addEventListener('click', () => { running = scenario.id !== 'free'; void restart(); });
  scaleSel.addEventListener('change', () => { timeScale = Number(scaleSel.value); });
  scenarioSel.addEventListener('change', () => {
    applyScenario(SCENARIOS.find((s) => s.id === scenarioSel.value) ?? SCENARIOS[0]);
    running = scenario.id !== 'free';
    void restart();
  });
  applyScenario(SCENARIOS[0]);
  syncRun();

  return {
    get active() { return active; },
    setActive(a: boolean) {
      if (a === active) return;
      active = a;
      if (a) {
        lastFrame = performance.now();
        raf = requestAnimationFrame(frame);
        void restart();
      } else {
        cancelAnimationFrame(raf);
        buildToken++;
        running = false;
        syncRun();
        deps.viewer.setBodyPoses(null);
        deps.viewer.setSimEnvironment(null);
        deps.viewer.followPoint(null);
        sim?.dispose();
        sim = null;
        deps.restoreView();
      }
    },
    paramsChanged() {
      if (active) void restart();
    },
    runScenario(id, opts = {}) {
      const s = SCENARIOS.find((x) => x.id === id);
      if (!s) return;
      if (opts.riderLb !== undefined && Number.isFinite(opts.riderLb)) {
        rider = 'custom';
        customLb = Math.max(60, Math.min(250, opts.riderLb)); // the custom slider's range
        customRow.row.hidden = false;
      }
      applyScenario(s); // also re-syncs every widget (rider select, custom slider, controls)
      running = s.id !== 'free';
      syncRun();
      if (active) void restart();
    },
  };
}
