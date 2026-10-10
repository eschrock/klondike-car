import type { Part } from '../model/types';
import { centerOfGravity, totalMass } from '../model/mass';
import { h } from './dom';

const TABS: { id: string; label: string; phase: number; blurb: string }[] = [
  { id: 'analysis', label: 'Analysis', phase: 2, blurb: 'Stability, braking, structure and mass checks with pass/fail.' },
  { id: 'simulation', label: 'Simulation', phase: 3, blurb: 'Rapier physics: turning, braking and bump scenarios.' },
  { id: 'truck', label: 'Truck fit', phase: 2, blurb: 'The cart in the bed with the tailgate down; collisions highlighted.' },
  { id: 'cutlist', label: 'Cut list', phase: 4, blurb: 'Rough and finished dimensions, board feet, plywood nesting.' },
  { id: 'bom', label: 'BOM', phase: 4, blurb: 'Hardware and purchased parts with vendors and total cost.' },
  { id: 'exports', label: 'Exports', phase: 4, blurb: 'DXF, STL, and CSV outputs.' },
  { id: 'assembly', label: 'Assembly', phase: 5, blurb: 'Step-by-step build sequence with joinery notes.' },
];

export interface RightPanel {
  update(parts: Part[]): void;
}

export function mountRightPanel(host: HTMLElement): RightPanel {
  const mass = h('dd', {}, '–');
  const cgx = h('dd', {}, '–');
  const cgy = h('dd', {}, '–');
  const cgz = h('dd', {}, '–');
  const summary = h(
    'section',
    { class: 'summary' },
    h('h2', {}, 'Summary'),
    h('dl', {}, h('dt', {}, 'Empty mass'), mass, h('dt', {}, 'CG x (fwd of rear axle)'), cgx, h('dt', {}, 'CG y (left)'), cgy, h('dt', {}, 'CG z (height)'), cgz),
  );

  const tablist = h('div', { class: 'tabs', role: 'tablist' });
  const panels = h('div', { class: 'tabpanels' });
  const buttons: HTMLButtonElement[] = [];
  const bodies: HTMLElement[] = [];

  const select = (i: number) => {
    buttons.forEach((b, j) => {
      b.setAttribute('aria-selected', String(i === j));
      b.tabIndex = i === j ? 0 : -1;
      bodies[j].hidden = i !== j;
    });
  };

  TABS.forEach((t, i) => {
    const b = h('button', { role: 'tab', type: 'button', id: `tab-${t.id}`, 'aria-controls': `panel-${t.id}` }, t.label);
    b.addEventListener('click', () => select(i));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
      select(n);
      buttons[n].focus();
    });
    const body = h('div', { role: 'tabpanel', id: `panel-${t.id}`, 'aria-labelledby': `tab-${t.id}`, class: 'placeholder' },
      h('h3', {}, t.label), h('p', {}, t.blurb), h('p', { class: 'muted' }, `Coming in Phase ${t.phase}.`));
    buttons.push(b);
    bodies.push(body);
    tablist.append(b);
    panels.append(body);
  });
  select(0);

  host.append(summary, tablist, panels);

  const f = (v: number, unit: string) => `${v.toFixed(1)} ${unit}`;
  return {
    update(parts) {
      mass.textContent = f(totalMass(parts, { includePayload: false }), 'lb');
      const [x, y, z] = centerOfGravity(parts);
      cgx.textContent = f(x, 'in');
      cgy.textContent = f(y, 'in');
      cgz.textContent = f(z, 'in');
    },
  };
}
