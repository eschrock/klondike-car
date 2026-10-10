import type { Part } from '../model/types';
import { centerOfGravity, totalMass } from '../model/mass';
import { CONFIGS, type Config, type FitCase, type FitResult, type FitWindow, type FitWindows } from '../truck/fit';
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
  /** Transport configuration, no rider (removables off): the two-person lift (D-7, D-9). */
  transport: Part[];
}

export interface RightPanel {
  update(summary: SummaryInput, fit: FitResult, params: { track: number; wb: number }): void;
  /** Mark the row currently shown in the Truck view (null = none). */
  setActiveTruckKey(key: string | null): void;
  /** Feasible-window search state: computing, done, or not available. */
  setWindows(w: FitWindows | 'computing' | null): void;
}

export interface RightPanelOptions {
  onShowTruck(c: FitCase): void;
  /** A tab became active (the Truck fit tab starts the lazy window search). */
  onTab(id: string): void;
}

const MODE_LABEL = { beside: 'Beside wells', straddle: 'Straddle wells' } as const;
const ORIENT_LABEL = { 'nose-tailgate': 'Nose to tailgate', 'nose-bulkhead': 'Nose to bulkhead' } as const;
const CONFIG_LABEL: Record<Config, string> = { installed: 'Installed', 'tongue-off': 'Tongue off', removed: 'Removed (transport)' };
const CONFIG_HELP: Record<Config, string> = {
  installed: 'Everything fitted, including the tongue',
  'tongue-off': 'Only the tongue and bridle removed',
  removed: 'All removable parts off (D-9)',
};

export function mountRightPanel(host: HTMLElement, opts: RightPanelOptions): RightPanel {
  const cell = () => h('td', {}, '–');
  const rows = ['Mass (lb)', 'CG x (in fwd of rear axle)', 'CG y (in left)', 'CG z (in height)'].map((label) => ({
    label,
    cells: [cell(), cell(), cell()],
  }));
  const lift = h('dd', {}, '–');
  const sizeInstalled = h('dd', {}, '–');
  const sizeTransport = h('dd', {}, '–');
  const extra = h('dl', { class: 'summary-extra' },
    h('dt', { title: 'Empty mass with the removable parts off: what two people lift onto the truck (D-7, D-9)' }, 'Lift weight (transport config)'), lift,
    h('dt', {}, 'Overall L × W × H, installed'), sizeInstalled,
    h('dt', {}, 'Overall L × W × H, transport'), sizeTransport,
  );
  const summary = h(
    'section',
    { class: 'summary' },
    h('h2', {}, 'Summary'),
    h(
      'table',
      { class: 'summary-table' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Empty'), h('th', { title: 'Empty + operating rider + cargo (150 lb must pass)' }, 'Operating'), h('th', { title: 'Empty + goal rider + cargo (200 lb)' }, 'Goal'))),
      h('tbody', {}, ...rows.map((r) => h('tr', {}, h('th', {}, r.label), ...r.cells))),
    ),
    extra,
  );

  const tablist = h('div', { class: 'tabs', role: 'tablist' });
  const panels = h('div', { class: 'tabpanels' });
  const buttons: HTMLButtonElement[] = [];
  const bodies: HTMLElement[] = [];

  let truckIndex = -1;
  const select = (i: number) => {
    opts.onTab(TABS[i].id);
    buttons.forEach((b, j) => {
      b.setAttribute('aria-selected', String(i === j));
      b.tabIndex = i === j ? 0 : -1;
      bodies[j].hidden = i !== j;
    });
  };

  const truckBody = h('div', { class: 'truck-fit' });
  truckIndex = TABS.findIndex((t) => t.id === 'truck');
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

  let windows: FitWindows | 'computing' | null = null;

  const fmtRange = (lo: number | null, hi: number | null) => (lo === null || hi === null ? 'none' : lo === hi ? `${f1(lo)}"` : `${f1(lo)}-${f1(hi)}"`);

  function windowRow(w: FitWindow, p: { track: number; wb: number }): HTMLElement {
    const track = w.maxTrackIn === null ? 'no track fits' : `max track ${f1(w.maxTrackIn)}" (now ${f1(p.track)}")`;
    const wb = w.wheelbaseMinIn === null ? 'no wheelbase fits' : `wheelbase ${fmtRange(w.wheelbaseMinIn, w.wheelbaseMaxIn)} (now ${f1(p.wb)}")`;
    const why = [w.maxTrackIn !== null && w.trackLimitedBy ? `track limit: ${w.trackLimitedBy}` : '', w.wheelbaseLimitedBy ? `wheelbase limit: ${w.wheelbaseLimitedBy}` : ''].filter(Boolean).join('. ');
    return h('div', { class: 'win-row' },
      h('div', { class: 'win-mode' }, MODE_LABEL[w.mode]),
      h('div', {}, track),
      h('div', {}, wb),
      why ? h('div', { class: 'muted small' }, why) : h('span', {}),
    );
  }

  let lastParams = { track: 0, wb: 0 };

  function renderTruck(fit: FitResult) {
    const L = fit.usableLengthIn;
    const head = h('div', { class: 'truck-head' },
      h('h3', {}, 'Truck fit (tailgate down)'),
      h('p', { class: fit.anyFits ? 'pass' : 'fail' }, fit.anyFits ? `Fits: ${fit.cases.filter((c) => c.fits).length} of ${fit.cases.length} cases.` : 'Does not fit in any case.'),
      h('p', { class: 'muted' }, `Usable length (bed + hinge gap + tailgate) ${f1(L)} in; required clearance ${fit.requiredClearanceIn} in to everything (walls, wells, bulkhead, cab wall).`),
      h('p', { class: 'muted' }, 'Beside: wheels pass beside the wells (wheel width inside the well gap, any fore-aft position). Straddle: one axle wholly ahead of the wells, the other wholly behind (D-6, D-23). Gap = true minimum separation.'),
    );
    const blocks: HTMLElement[] = [head];
    for (const config of CONFIGS) {
      const d = fit.dims[config];
      const sec = h('section', { class: 'fit-config' },
        h('h4', { title: CONFIG_HELP[config] }, CONFIG_LABEL[config]),
        h('div', { class: 'muted small' }, `${f1(d.lengthIn)} × ${f1(d.widthIn)} × ${f1(d.heightIn)} in`),
      );
      const wins = windows && windows !== 'computing' ? windows.windows.filter((w) => w.config === config) : [];
      sec.append(
        h('div', { class: 'win-card' },
          h('div', { class: 'win-title' }, 'Feasible window'),
          windows === 'computing' ? h('div', { class: 'muted small' }, 'computing…')
            : wins.length ? h('div', {}, ...wins.map((w) => windowRow(w, lastParams)))
            : h('div', { class: 'muted small' }, 'not computed'),
        ),
      );
      for (const c of fit.cases.filter((x) => x.config === config)) {
        const btn = h('button', { type: 'button', title: 'Show this placement in the 3D viewer' }, activeKey === c.key ? 'Showing' : 'Show');
        btn.addEventListener('click', () => {
          opts.onShowTruck(c);
          select(truckIndex);
        });
        const q = c.fits ? c.limiting[0] : (c.colliding[0] ?? c.limiting[0]);
        const lim = c.fits || c.colliding.length
          ? q ? `${q.partId} / ${q.solidId.replace('truck-', '')} ${q.clearanceIn.toFixed(2)}"` : ''
          : c.modeIssue ?? '';
        const card = h('div', { class: `fit-card${activeKey === c.key ? ' active' : ''}` },
          h('div', { class: 'fc-head' },
            h('div', { class: 'fc-title' }, h('strong', {}, MODE_LABEL[c.mode]), h('span', { class: 'muted' }, ` · ${ORIENT_LABEL[c.orientation]}`)),
            h('span', { class: `pill ${c.fits ? 'pass' : 'fail'}` }, c.fits ? 'Fits' : 'No'),
          ),
          h('div', { class: 'fc-meta' },
            h('span', {}, c.placement ? `min gap ${c.minClearanceIn.toFixed(2)}"` : '–'),
            h('span', { class: 'muted' }, lim),
            btn,
          ),
          c.note && !c.fits ? h('div', { class: 'muted small' }, c.note) : h('span', {}),
        );
        sec.append(card);
      }
      blocks.push(sec);
    }
    truckBody.replaceChildren(...blocks);
  }

  return {
    update(sum, fit, params) {
      lastParams = params;
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
      const sz = (d: { lengthIn: number; widthIn: number; heightIn: number }) => `${f1(d.lengthIn)} × ${f1(d.widthIn)} × ${f1(d.heightIn)} in`;
      lift.textContent = `${f1(totalMass(sum.transport))} lb`;
      sizeInstalled.textContent = sz(fit.dims.installed);
      sizeTransport.textContent = sz(fit.dims.removed);
      lastFit = fit;
      renderTruck(fit);
    },
    setWindows(w) {
      windows = w;
      if (lastFit) renderTruck(lastFit);
    },
    setActiveTruckKey(key) {
      activeKey = key;
      if (lastFit) renderTruck(lastFit);
    },
  };
}
