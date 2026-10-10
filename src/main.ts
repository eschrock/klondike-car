import './style.css';
import { store } from './state';
import { buildModel } from './model';
import { Viewer } from './viewer/viewer';
import { mountParamsPanel } from './ui/params-panel';
import { mountRightPanel } from './ui/right-panel';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

mountParamsPanel($('params'), store);
const right = mountRightPanel($('right'));
const viewer = new Viewer($('viewer'));

const render = () => {
  const parts = buildModel(store.get());
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
