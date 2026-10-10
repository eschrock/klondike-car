import type { Part } from '../model/types';
import { centerOfGravity, totalMass } from '../model/mass';
import type { FitCase, FitResult } from '../truck/fit';
import { h } from './dom';

const TABS: { id: string; label: string; phase: number; blurb: string }[] = [
  { id: 'analysis', label: 'Analysis', phase: 2, blurb: 'Stability, braking, structure and mass checks with pass/fail.' },
  { id: 'simulation', label: 'Simulation', phase: 3, blurb: 'Rapier physics: turning, braking and bump scenarios.' },
  { id: 'truck', label: 'Truck fit', phase: 1, blurb: 'The cart in the bed with the tailgate down; collisions highlighted.' },
  { id: 'cutlist', label: 'Cut list', phase: 4, blurb: 'Rough and finished dimensions, board feet, plywood nesting.' },
  { id: 'bom', label: 'BOM', phase: 4, blurb: 'Hardware and purchased parts with vendors and total cost.' },
  { id: 'exports', label: 'Exports', phase: 4, blurb: 'DXF, STL, and CSV outputs.' },
  { id: 'assembly', label: 'Assembly', phase: 5, blurb: 'Step-by-step build sequence with joinery notes.' },
];

/** Part lists for the three summary load cases (built by the caller with buildModel). */
export interface SummaryInput {
  empty: Part[];
  /** Operating rider + cargo (150 lb must pass, D-1). */
  operating: Part[];
  /** Goal rider + cargo (200 lb). */
  goal: Part[];
}

export interface RightPanel {
  update(summary: SummaryInput, fit: FitResult): void;
  /** Mark the row currently shown in the Truck view (null = none). */
  setActiveTruckKey(key: string | null): void;
}

export interface RightPanelOptions {
  onShowTruck(c: FitCase): void;
}

const MODE_LABEL = { beside: 'Beside wells', straddle: 'Straddle wells' } as const;
const ORIENT_LABEL = { 'nose-tailgate': 'Nose to tailgate', 'nose-bulkhead': 'Nose to bulkhead' } as const;
const CONFIG_LABEL = { installed: 'Installed', removed: 'Removed' } as const;

export function mountRightPanel(host: HTMLElement, opts: RightPanelOptions): RightPanel {
  const cell = () => h('td', {}, '–');
  const rows = ['Mass (lb)', 'CG x (in fwd of rear axle)', 'CG y (in left)', 'CG z (in height)'].map((label) => ({
    label,
    cells: [cell(), cell(), cell()],
  }));
  const summary = h(
    'section',
    { class: 'summary' },
    h('h2', {}, 'Summary'),
    h(
      'table',
      { class: 'summary-table' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Empty'), h('th', { title: 'Operating rider + cargo (150 lb must pass)' }, '+ Operating'), h('th', { title: 'Goal rider + cargo (200 lb)' }, '+ Goal'))),
      h('tbody', {}, ...rows.map((r) => h('tr', {}, h('th', {}, r.label), ...r.cells))),
    ),
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

  const truckBody = h('div', { class: 'truck-fit' });
  TABS.forEach((t, i) => {
    const b = h('button', { role: 'tab', type: 'button', id: `tab-${t.id}`, 'aria-controls': `panel-${t.id}` }, t.label);
    b.addEventListener('click', () => select(i));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
      select(n);
      buttons[n].focus();
    });
    const body =
      t.id === 'truck'
        ? h('div', { role: 'tabpanel', id: `panel-${t.id}`, 'aria-labelledby': `tab-${t.id}` }, truckBody)
        : h('div', { role: 'tabpanel', id: `panel-${t.id}`, 'aria-labelledby': `tab-${t.id}`, class: 'placeholder' },
            h('h3', {}, t.label), h('p', {}, t.blurb), h('p', { class: 'muted' }, `Coming in Phase ${t.phase}.`));
    buttons.push(b);
    bodies.push(body);
    tablist.append(b);
    panels.append(body);
  });
  select(0);

  host.append(summary, tablist, panels);

  const f1 = (v: number) => v.toFixed(1);
  let activeKey: string | null = null;
  let lastFit: FitResult | null = null;

  function renderTruck(fit: FitResult) {
    const L = fit.usableLengthIn;
    const dimLine = (c: 'installed' | 'removed') => {
      const d = fit.dims[c];
      return `${CONFIG_LABEL[c]}: ${f1(d.lengthIn)} × ${f1(d.widthIn)} × ${f1(d.heightIn)} in`;
    };
    const head = h('div', { class: 'truck-head' },
      h('h3', {}, 'Truck fit (tailgate down)'),
      h('p', { class: fit.anyFits ? 'pass' : 'fail' }, fit.anyFits ? `Fits: ${fit.cases.filter((c) => c.fits).length} of ${fit.cases.length} stowage cases.` : 'Does not fit in any stowage case.'),
      h('p', { class: 'muted' }, `Cart L × W × H. ${dimLine('installed')}; ${dimLine('removed')}. Usable bed + tailgate length ${f1(L)} in; required clearance ${fit.requiredClearanceIn} in.`),
      h('p', { class: 'muted' }, 'Beside: wheels between the wells (track limited by the well gap). Straddle: front axle ahead of the wells, rear behind them (D-6, D-23).'),
    );
    const tbody = h('tbody', {});
    for (const c of fit.cases) {
      const btn = h('button', { type: 'button', title: 'Show this placement in the 3D viewer' }, activeKey === c.key ? 'Showing' : 'Show');
      btn.addEventListener('click', () => opts.onShowTruck(c));
      const limiting = (c.fits ? c.limiting.slice(0, 2) : c.colliding.slice(0, 3)).map((q) => `${q.partId} / ${q.solidId.replace('truck-', '')} ${q.clearanceIn.toFixed(2)}`).join('; ');
      const tr = h('tr', { class: activeKey === c.key ? 'active' : '' },
        h('td', {}, h('div', {}, `${MODE_LABEL[c.mode]}, ${CONFIG_LABEL[c.config]}`), h('div', { class: 'muted' }, ORIENT_LABEL[c.orientation])),
        h('td', { class: c.fits ? 'pass' : 'fail' }, c.fits ? 'Fits' : 'No'),
        h('td', {}, c.placement ? `${c.minClearanceIn.toFixed(2)}"` : '–'),
        h('td', { class: 'muted' }, c.note && !c.fits && !c.colliding.length ? c.note : limiting),
        h('td', {}, btn),
      );
      tbody.append(tr);
    }
    const table = h('table', { class: 'fit-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Case'), h('th', {}, 'Fit'), h('th', {}, 'Min gap'), h('th', {}, 'Limiting (part / solid gap in)'), h('th', {}, ''))),
      tbody);
    truckBody.replaceChildren(head, table);
  }

  return {
    update(sum, fit) {
      const cases = [
        { parts: sum.empty, payload: false },
        { parts: sum.operating, payload: true },
        { parts: sum.goal, payload: true },
      ];
      cases.forEach((c, j) => {
        const m = totalMass(c.parts, { includePayload: c.payload });
        const [x, y, z] = centerOfGravity(c.parts, { includePayload: c.payload });
        [m, x, y, z].forEach((v, r) => (rows[r].cells[j].textContent = f1(v)));
      });
      lastFit = fit;
      renderTruck(fit);
    },
    setActiveTruckKey(key) {
      activeKey = key;
      if (lastFit) renderTruck(lastFit);
    },
  };
}
