import type { PartGroup } from '../model/types';
import type { SummaryStats } from '../analysis/summary';
import { CONFIGS, type AxleMargin, type Config, type FitCase, type FitResult, type FitWindow, type FitWindows } from '../truck/fit';
import { h } from './dom';

const TABS: { id: string; label: string; phase: number; blurb: string }[] = [
  { id: 'analysis', label: 'Analysis', phase: 2, blurb: 'Stability, braking, structure and mass checks with pass/fail.' },
  { id: 'simulation', label: 'Simulation', phase: 3, blurb: 'Rapier physics: turning, braking and bump scenarios.' },
  { id: 'truck', label: 'Truck fit', phase: 1, blurb: 'The sled in the bed with the tailgate down; collisions highlighted.' },
];

/** Design numbers the truck view quotes next to its results. */
export interface TruckParams {
  track: number;
  wb: number;
  /** `derived().maxTrackBesideWells`: the purely lateral beside limit (D-6). */
  lateralBesideLimit: number;
}

const GROUP_LABEL: Record<PartGroup, string> = {
  frame: 'Frame', body: 'Body (sides, deck, bow bulkhead, transom)', 'front-end': 'Front end (pivoting axle, kingpin, tongue)', 'running-gear': 'Running gear (wheels, axles)',
  seat: 'Seat', brake: 'Brake', storage: 'Storage', lighting: 'Lighting', removable: 'Push handle',
  hardware: 'Hardware', reference: 'Reference',
};

export interface RightPanel {
  update(summary: SummaryStats, fit: FitResult, params: TruckParams): void;
  /** Mark the row currently shown in the Truck view (null = none). */
  setActiveTruckKey(key: string | null): void;
  /** Feasible-window search state: computing, done, or not available. */
  setWindows(w: FitWindows | 'computing' | null): void;
  /** Empty tab body for a self-contained panel (analysis, simulation) to mount into. */
  panelHost(id: 'analysis' | 'simulation'): HTMLElement;
  /** Programmatically open a tab (the Simple view jumps to Analysis / Simulation). */
  showTab(id: string): void;
}

export interface RightPanelOptions {
  onShowTruck(c: FitCase): void;
  /** A tab became active (the Truck fit tab starts the lazy window search). */
  onTab(id: string): void;
}

/** Tabs whose content is mounted by another module via panelHost(). */
const MOUNTED = new Set(['analysis', 'simulation']);

const MODE_LABEL = { beside: 'Beside wells', straddle: 'Straddle wells' } as const;
const ORIENT_LABEL = { 'nose-tailgate': 'Nose to tailgate', 'nose-bulkhead': 'Nose to bulkhead' } as const;
const CONFIG_LABEL: Record<Config, string> = { installed: 'Installed', removed: 'Transport mode' };
const CONFIG_HELP: Record<Config, string> = {
  installed: 'Everything fitted, including the tongue and bridle rope',
  removed: 'Transport mode (D-65): brakes, lights and chocks off, handle parked, seat back flat; the tongue and the signs stay on',
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
    h('dt', { title: 'Empty mass in Transport mode (brakes, lights and chocks off; handle parked, seat back flat; the tongue stays on; D-65): what two people lift onto the truck (D-7, D-9)' }, 'Lift weight (transport config)'), lift,
    h('dt', {}, 'Overall L × W × H, installed'), sizeInstalled,
    h('dt', {}, 'Overall L × W × H, transport'), sizeTransport,
  );
  const groupBody = h('tbody', {});
  const groupTable = h('table', { class: 'summary-table group-table', 'aria-label': 'Empty mass by part group' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Mass by group'), h('th', {}, 'lb'), h('th', {}, '%'))),
    groupBody,
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
    groupTable,
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
        : MOUNTED.has(t.id)
        ? h('div', { role: 'tabpanel', id: `panel-${t.id}`, 'aria-labelledby': `tab-${t.id}` })
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
  const f2 = (v: number) => v.toFixed(2);

  /** Beside mode: why the max track at this wheelbase differs from the purely lateral limit (D-6). */
  function besideExplain(w: FitWindow, p: TruckParams): string {
    if (w.maxTrackIn === null) return '';
    const d = w.maxTrackIn - p.lateralBesideLimit;
    const lat = `${f2(p.lateralBesideLimit)}"`;
    if (d > 0.01) {
      return w.axlesClearWellsAtMax
        ? `${f2(d)}" more than the lateral-only limit (${lat}): at this wheelbase the axle ends (hub + rod, wider than the tires) sit fore/aft of the wells, so only the tires must fit beside them. A different wheelbase moves this limit.`
        : `${f2(d)}" more than the lateral-only limit (${lat}); within the 0.25" search step.`;
    }
    if (d < -0.01) return `${f2(-d)}" below the lateral-only limit (${lat}): ${w.trackLimitedBy ?? 'limited by another part'}.`;
    return w.axlesClearWellsAtMax === false
      ? `Equals the lateral-only limit (${lat}): the axle ends are beside the wells too, so they set it (D-6).`
      : `Matches the lateral-only limit (${lat}).`;
  }

  function windowRow(w: FitWindow, p: TruckParams): HTMLElement {
    const bedOnly = w.trackBoundedByValidator && w.maxTrackBedOnlyIn !== null ? ` Bed alone would allow ~${f1(w.maxTrackBedOnlyIn)}".` : '';
    const track = w.maxTrackIn === null
      ? (w.invalidNow ? 'design invalid at the current parameters (validator)' : 'no track fits')
      : `max track ${f1(w.maxTrackIn)}" at wheelbase ${f1(p.wb)}" (now ${f1(p.track)}")${w.trackBoundedByValidator ? ' · limited by the validator' : ''}`;
    const wb = w.wheelbaseMinIn === null ? 'no wheelbase fits' : `wheelbase ${fmtRange(w.wheelbaseMinIn, w.wheelbaseMaxIn)} (now ${f1(p.wb)}")`;
    const why = [w.maxTrackIn !== null && w.trackLimitedBy ? `track limit: ${w.trackLimitedBy}.${bedOnly}` : '', w.wheelbaseLimitedBy ? `wheelbase limit: ${w.wheelbaseLimitedBy}` : ''].filter(Boolean).join(' ');
    const stab = w.ssfAtMax === null ? '' :
      `Stability preview (D-23): SSF (T/2)/h ${f2(w.ssfNow)} now → ${f2(w.ssfAtMax)} at max track (${w.ssfAtMax >= w.ssfNow ? '+' : ''}${f2(w.ssfAtMax - w.ssfNow)}), loaded CG ${f1(w.cgHeightNowIn)}" → ${f1(w.cgHeightAtMaxIn ?? 0)}" (operating rider + cargo).${w.trackBoundedByValidator && w.ssfAtBedMax !== null && w.maxTrackBedOnlyIn !== null ? ` At the bed-only max track ${f1(w.maxTrackBedOnlyIn)}" SSF would be ${f2(w.ssfAtBedMax)}, but only once the nose width and shoulder are re-derived for that track (Phase 2).` : ''} Preview only; Phase 2 does the full check.`;
    return h('div', { class: 'win-row' },
      h('div', { class: 'win-mode' }, MODE_LABEL[w.mode]),
      h('div', {}, track),
      w.mode === 'beside' && w.maxTrackIn !== null ? h('div', { class: 'muted small' }, besideExplain(w, p)) : h('span', {}),
      stab ? h('div', { class: 'muted small' }, stab) : h('span', {}),
      h('div', {}, wb),
      why ? h('div', { class: 'muted small' }, why) : h('span', {}),
    );
  }

  const gapText = (a: AxleMargin) =>
    a.relation === 'beside'
      ? `tires overlap the well span ${f1(a.wheelWellOverlapIn)}" fore-aft (beside the wells)`
      : `tires ${f2(a.wheelWellGapIn)}\" ${a.relation === 'ahead' ? 'ahead of' : 'behind'} the wells`;
  const axleLine = (a: AxleMargin, req: number) =>
    h('div', { class: 'muted small' },
      `${a.side === 'bulkhead' ? 'Bulkhead' : 'Tailgate'}-side axle (${a.cartAxle}): ${gapText(a)}; axle ends ${a.rodWellGapIn >= 0 ? `${f2(a.rodWellGapIn)}" clear of the well span` : 'over the well span'}; tire patch ${f2(a.hingeGapIn)}" from the hinge gap${a.hingeGapIn < req ? ' (tight)' : ''}`);

  let lastParams: TruckParams = { track: 0, wb: 0, lateralBesideLimit: 0 };
  const cardEls = new Map<string, HTMLElement>();

  function renderTruck(fit: FitResult) {
    const L = fit.usableLengthIn;
    const head = h('div', { class: 'truck-head' },
      h('h3', {}, 'Truck fit (tailgate down)'),
      h('p', { class: fit.anyFits ? 'pass' : 'fail' }, fit.anyFits ? `Fits: ${fit.cases.filter((c) => c.fits).length} of ${fit.cases.length} cases.` : 'Does not fit in any case.'),
      h('p', { class: 'muted' }, `Usable length (bed + hinge gap + tailgate) ${f1(L)} in; required clearance ${fit.requiredClearanceIn} in to everything (walls, wells, bulkhead, cab wall).`),
      h('p', { class: 'muted' }, 'Beside: the wheels pass beside the wells (tires inside the well gap, any fore-aft position). At some wheelbases the axles also clear the wells fore-aft, so only the tires are beside them and the axle ends (hub + rod, wider than the tires) are not limited by the wells: the beside max track therefore depends on the wheelbase, and can exceed the purely lateral limit of ' + f2(lastParams.lateralBesideLimit) + '" (D-6). Straddle: one axle wholly ahead of the wells, the other wholly behind (D-6, D-23). Min gap = true minimum separation; slack = how far the sled can slide fore/aft and still fit.'),
    );
    cardEls.clear();
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
          select(truckIndex); // the panel may have been hidden; reveal it, then bring the card into view
          cardEls.get(c.key)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
          c.fits && c.slack
            ? h('div', { class: 'small' }, c.slack.totalIn < 1e-9
                ? 'Fore-aft slack: none (this is the only position that fits).'
                : `Fore-aft slack: ${f2(c.slack.totalIn)}" total (${f2(c.slack.toBulkheadIn)}" toward the bulkhead, ${f2(c.slack.toTailgateIn)}" toward the tailgate).`)
            : h('span', {}),
          ...c.axles.map((a) => axleLine(a, fit.requiredClearanceIn)),
          c.mode === 'beside' && c.axlesClearWells !== null
            ? h('div', { class: 'muted small' }, c.axlesClearWells ? 'Axle ends clear the wells fore-aft; only the tires are beside them.' : 'Axle ends are beside the wells too.')
            : h('span', {}),
          c.note && !c.fits ? h('div', { class: 'muted small' }, c.note) : h('span', {}),
        );
        cardEls.set(c.key, card);
        sec.append(card);
      }
      blocks.push(sec);
    }
    truckBody.replaceChildren(...blocks);
  }

  return {
    showTab(id) {
      const i = TABS.findIndex((t) => t.id === id);
      if (i >= 0) select(i);
    },
    panelHost(id) {
      return bodies[TABS.findIndex((t) => t.id === id)];
    },
    update(sum, fit, params) {
      lastParams = params;
      sum.cases.forEach((c, j) => [c.massLb, c.cog[0], c.cog[1], c.cog[2]].forEach((v, r) => (rows[r].cells[j].textContent = f1(v))));
      const sz = (d: { lengthIn: number; widthIn: number; heightIn: number }) => `${f1(d.lengthIn)} × ${f1(d.widthIn)} × ${f1(d.heightIn)} in`;
      const groups = sum.groups;
      const total = groups.reduce((t, g) => t + g.massLb, 0);
      groupBody.replaceChildren(
        ...groups.map((g) => h('tr', {}, h('th', {}, GROUP_LABEL[g.group] ?? g.group), h('td', {}, f1(g.massLb)), h('td', { class: 'muted' }, total > 0 ? `${Math.round((100 * g.massLb) / total)}` : '–'))),
        h('tr', { class: 'total' }, h('th', {}, 'Total (empty)'), h('td', {}, f1(total)), h('td', {}, '')),
      );
      lift.textContent = `${f1(sum.transportLb)} lb`;
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
