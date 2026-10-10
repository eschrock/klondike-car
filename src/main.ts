import './style.css';
import { store } from './state';
import { buildModel, type ViewState } from './model';
import { h } from './ui/dom';
import { Viewer } from './viewer/viewer';
import { mountParamsPanel } from './ui/params-panel';
import { mountRightPanel } from './ui/right-panel';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

mountParamsPanel($('params'), store);
const right = mountRightPanel($('right'));
const viewer = new Viewer($('viewer'));

// View-only articulation: not a design parameter, never persisted.
const view: ViewState = { steerDeg: 0 };
const steerOut = h('output', { class: 'steer-out' }, '0°');
const steer = h('input', { type: 'range', min: '-50', max: '50', step: '1', value: '0', 'aria-label': 'Displayed steer angle' });
steer.addEventListener('input', () => {
  view.steerDeg = Number(steer.value);
  render();
});
viewer.addToolbarControl(h('label', { class: 'steer-ctl', title: 'Displayed steer angle (view only; clamped to the steering lock)' }, 'Steer', steer, steerOut));

const render = () => {
  const p = store.get();
  const lock = p.steerLockDeg;
  steer.min = String(-lock);
  steer.max = String(lock);
  view.steerDeg = Math.max(-lock, Math.min(lock, view.steerDeg ?? 0));
  steer.value = String(view.steerDeg);
  steerOut.textContent = `${view.steerDeg}°`;
  const parts = buildModel(p, view);
  viewer.update(parts);
  right.update(parts);
};
store.subscribe(render);
render();

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
