/**
 * Build mode (Phase 4, docs/phase4-spec.md; top-level mode since the UI rework): verify checklist, cut list, nesting, BOM, Shaper files,
 * forms and templates, assembly (with the 3D step-through), finishing and downloads. Everything comes from `BuildData` (src/build/package.ts),
 * a pure function of the current model and params, computed lazily for the section on screen only, while the mode is open,
 * debounced on parameter changes and cached per parameter set.
 * Two hosts: a left rail (section nav + the zip, book and print buttons) and the content column. Layout lives in build-panel.css.
 */
import type { Part } from '../model/types';
import type { Params } from '../params';
import { BuildData, CSV_MIME, SHAPER_CONVENTIONS, SHAPER_NOTES, SVG_MIME, zipName, zipPackage } from '../build/package';
import { fracIn } from '../build/cutlist';
import { tilePlan } from '../build/forms';
import type { BuildStep } from '../build/assembly';
import { h } from './dom';
import {
  bytesLabel, clampStep, cureLine, dims3, featureSummary, groupByWhen, loadDone, maxDepth, pct, previewSvg, saveDone, sheetSvg, stepFocus, tilePagesHtml, todayISO, usd,
  type StepFocus,
} from './build-helpers';
import './build-panel.css';

export interface BuildPanelHosts {
  /** The `<nav>` for the section list and the quick actions. */
  rail: HTMLElement;
  /** The content column. */
  main: HTMLElement;
}

export interface BuildPanelOptions {
  /** The assembly step-through wants the 3D viewer to show this (or null: restore the full model). */
  onStep(focus: StepFocus | null): void;
  /** The visible section changed (the layout shows the 3D viewer only for Assembly). */
  onSection?(id: string): void;
  /** The shareable design link for the README. */
  getLink?(): string;
}

export interface BuildPanel {
  /** The design changed (cheap: stores it; recomputes the section on screen after a pause if Build mode is open). */
  setDesign(p: Params, parts: Part[]): void;
  /** Build mode was entered or left. */
  setActive(active: boolean): void;
  /** The section on screen. */
  section(): string;
}

const SECTIONS = [
  { id: 'verify', label: 'Verify', title: 'Verify before ordering' },
  { id: 'cutlist', label: 'Cut list', title: 'Cut list' },
  { id: 'nesting', label: 'Nesting', title: 'Nesting and board feet' },
  { id: 'bom', label: 'BOM', title: 'Bill of materials' },
  { id: 'shaper', label: 'Shaper', title: 'Shaper Origin files' },
  { id: 'forms', label: 'Forms', title: 'Forms and templates' },
  { id: 'assembly', label: 'Assembly', title: 'Assembly steps' },
  { id: 'finishing', label: 'Finishing', title: 'Finishing schedule' },
  { id: 'downloads', label: 'Downloads', title: 'Downloads' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const SECTION_KEY = 'klondike-build-section';
const DEBOUNCE_MS = 250;

function download(name: string, mime: string, data: string | Uint8Array): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name.split('/').pop() ?? name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function svgBox(markup: string, cls = 'bp-preview'): HTMLElement {
  const box = h('div', { class: cls });
  box.innerHTML = markup;
  return box;
}

const btn = (label: string, onClick: () => void, title = '', cls = ''): HTMLButtonElement => {
  const b = h('button', { type: 'button', class: cls, ...(title ? { title } : {}) }, label);
  b.addEventListener('click', onClick);
  return b;
};

interface TableOpts {
  /** Column indexes that hold numbers (right aligned). */
  num?: number[];
  /** A closing row (subtotals). */
  foot?: (string | Node)[];
}

/** A table in a keyboard-scrollable wrapper (a wide table scrolls sideways instead of wrapping into a column of fragments). */
const table = (cls: string, head: (string | Node)[], rows: (string | Node)[][], aria: string, opts: TableOpts = {}): HTMLElement => {
  const attrs = (i: number): Record<string, string> => (opts.num?.includes(i) ? { class: 'num' } : {});
  const t = h('table', { class: `bp-table ${cls}`.trim(), 'aria-label': aria },
    h('thead', {}, h('tr', {}, ...head.map((x, i) => h('th', { scope: 'col', ...attrs(i) }, x)))),
    h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c, i) => h('td', attrs(i), c))))),
    ...(opts.foot ? [h('tfoot', {}, h('tr', {}, ...opts.foot.map((c, i) => h(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : attrs(i), c))))] : []));
  return h('div', { class: 'bp-scroll', role: 'region', tabindex: '0', 'aria-label': aria }, t);
};

const sub = (text: string, extra = '') => h('div', { class: 'muted small' }, text + extra);
const stepList = (n: number[]): string => (n.length ? n.join(', ') : '–');

const note = (text: string, cls = 'muted small') => h('p', { class: cls }, text);

export function mountBuildPanel(hosts: BuildPanelHosts, opts: BuildPanelOptions): BuildPanel {
  const { rail, main } = hosts;
  const root = h('div', { class: 'bp' });
  main.append(root);

  let active = false;
  let design: { p: Params; parts: Part[]; key: string } | null = null;
  let data: BuildData | null = null;
  let focusActive = false;
  let dataKey = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stepN = 0;
  let stepUpdate: ((reframe: boolean) => void) | null = null;
  let done = loadDone();
  /** Tell the viewer what to show; a `null` only goes out when a focus is active, so mounting never touches the viewer. */
  const emit = (f: StepFocus | null): void => {
    if (!f && !focusActive) return;
    focusActive = !!f;
    opts.onStep(f);
  };

  const readSection = (): SectionId => {
    try {
      const v = localStorage.getItem(SECTION_KEY);
      if (SECTIONS.some((s) => s.id === v)) return v as SectionId;
    } catch { /* ignore */ }
    return 'verify';
  };
  let section: SectionId = readSection();
  const wide = window.matchMedia('(min-width: 900px)');

  // ── Frame: the rail (section nav, quick actions) and the content column ──
  const navButtons = new Map<SectionId, HTMLButtonElement>();
  const navList = h('ul', { class: 'bp-navlist' });
  const panels = new Map<SectionId, HTMLElement>();
  const body = h('div', { class: 'bp-body' });
  SECTIONS.forEach((s, i) => {
    const b = h('button', { type: 'button', id: `bp-tab-${s.id}`, class: 'bp-tab' }, h('span', { class: 'bp-tab-n', 'aria-hidden': 'true' }, String(i + 1)), h('span', {}, s.label));
    b.addEventListener('click', () => { show(s.id); window.scrollTo({ top: 0 }); });
    // Arrow keys move between the sections (focus only; Enter or Space opens one). Tab still reaches each button.
    b.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k !== 'ArrowDown' && k !== 'ArrowUp' && k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Home' && k !== 'End') return;
      e.preventDefault();
      const fwd = k === 'ArrowDown' || k === 'ArrowRight';
      const n = k === 'Home' ? 0 : k === 'End' ? SECTIONS.length - 1 : (i + (fwd ? 1 : SECTIONS.length - 1)) % SECTIONS.length;
      navButtons.get(SECTIONS[n].id)?.focus();
    });
    navButtons.set(s.id, b);
    navList.append(h('li', {}, b));
    const sec = h('section', { class: 'bp-section', id: `bp-sec-${s.id}`, 'aria-labelledby': `bp-h-${s.id}`, hidden: '' });
    panels.set(s.id, sec);
    body.append(sec);
  });
  const status = h('p', { class: 'bp-status muted small', role: 'status' });
  const zipBtn = btn('Download all (zip)', () => withData(saveZip), 'Every output file in one zip', 'bp-primary');
  const bookBtn = btn('Open build book', () => withData(openBook), 'The whole build on paper (print or save as PDF); opens in a new tab');
  const printBtn = btn('Print this section', () => printSection(), 'Print the section on screen (save as PDF from the print dialog)', 'bp-print');
  rail.append(
    h('h2', { class: 'bp-rail-title' }, 'Build'),
    navList,
    h('div', { class: 'bp-rail-actions', role: 'group', 'aria-label': 'Build downloads and print' }, zipBtn, bookBtn, printBtn),
  );
  root.append(body, status);

  function show(id: SectionId): void {
    const changed = id !== section;
    section = id;
    try { localStorage.setItem(SECTION_KEY, id); } catch { /* per-viewer convenience only */ }
    for (const s of SECTIONS) {
      const on = s.id === id;
      if (on) navButtons.get(s.id)!.setAttribute('aria-current', 'page'); else navButtons.get(s.id)!.removeAttribute('aria-current');
      panels.get(s.id)!.hidden = !on;
    }
    navButtons.get(id)!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (id !== 'assembly') { stepUpdate = null; emit(null); }
    opts.onSection?.(id);
    if (changed) main.scrollTop = 0;
    if (active) renderSection();
  }

  const withData = (fn: (d: BuildData) => void): void => {
    if (refreshData() && data) fn(data);
  };
  const saveZip = (d: BuildData): void => download(zipName(d), 'application/zip', zipPackage(d));
  const openBook = (d: BuildData): void => {
    const book = d.files.find((f) => f.name === 'build-book.html');
    if (!book) return;
    const url = URL.createObjectURL(new Blob([book.data as BlobPart], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  // ── Compute scheduling ──
  function refreshData(): boolean {
    if (!design) return false;
    if (data && dataKey === design.key) return true;
    data = new BuildData(design.parts, design.p, { date: todayISO(), link: opts.getLink?.() });
    dataKey = design.key;
    return true;
  }

  function renderSection(reframe = true): void {
    root.removeAttribute('aria-busy');
    const panel = panels.get(section)!;
    if (!refreshData() || !data) {
      panel.replaceChildren(note('No design loaded yet.'));
      return;
    }
    const d = data;
    const t0 = performance.now();
    const rendered = RENDER[section](d);
    panel.replaceChildren(h('h2', { class: 'bp-title', id: `bp-h-${section}` }, SECTIONS.find((s) => s.id === section)!.title), ...rendered);
    const ms = performance.now() - t0;
    const stageMs = Object.values(d.timings).reduce((a, v) => a + v, 0);
    status.textContent = `Params rev ${d.revision} · ${todayISO()} · computed in ${Math.round(stageMs + ms)} ms`;
    if (section === 'assembly') stepUpdate?.(reframe);
  }

  function schedule(): void {
    clearTimeout(timer);
    root.setAttribute('aria-busy', 'true');
    status.textContent = 'Updating for the new parameters…';
    timer = setTimeout(() => {
      if (!active) return;
      renderSection(false); // a parameter change keeps the step; only a new step reframes the camera
    }, DEBOUNCE_MS);
  }

  // ── Print ──
  let tilesHost: HTMLElement | null = null;
  function clearTiles(): void {
    document.body.classList.remove('bp-print-tiles');
    tilesHost?.replaceChildren();
  }
  // Print every section's folded details open, then fold them back.
  const reopened: HTMLDetailsElement[] = [];
  window.addEventListener('beforeprint', () => {
    for (const d of root.querySelectorAll<HTMLDetailsElement>('.bp-section:not([hidden]) details:not([open])')) { d.open = true; reopened.push(d); }
  });
  window.addEventListener('afterprint', () => {
    for (const d of reopened.splice(0)) d.open = false;
  });
  function printSection(): void {
    clearTiles();
    window.print();
  }
  function printTiles(pages: string[]): void {
    if (!tilesHost) {
      tilesHost = h('div', { id: 'bp-print-tiles', 'aria-hidden': 'true' });
      document.body.append(tilesHost);
    }
    tilesHost.innerHTML = tilePagesHtml(pages);
    document.body.classList.add('bp-print-tiles');
    const finish = () => { clearTiles(); window.removeEventListener('afterprint', finish); };
    window.addEventListener('afterprint', finish);
    setTimeout(() => window.print(), 50); // let the pages lay out first (not rAF: it stalls in a background tab)
  }

  // ── Sections ──
  const csvButton = (label: string, name: string, text: () => string) => btn(label, () => download(name, CSV_MIME, text()), `Save ${name}`);

  function renderVerify(d: BuildData): Node[] {
    const checks = d.verify;
    const count = () => checks.filter((c) => done.has(c.id)).length;
    const progress = h('p', { class: 'bp-progress', role: 'status' });
    const setProgress = () => { progress.textContent = `${count()} of ${checks.length} done`; };
    setProgress();
    const out: Node[] = [
      note('Test these before you spend money or cut wood. Each item guards parts and design numbers marked "verify". Your ticks stay in this browser.', 'muted small'),
      progress,
    ];
    const groups = h('div', { class: 'bp-verify-groups' });
    out.push(groups);
    for (const g of groupByWhen(checks)) {
      const ul = h('ul', { class: 'bp-checks' });
      groups.append(h('section', { class: 'bp-verify-group' }, h('h3', { class: 'bp-group' }, g.when.replace(/^./, (c) => c.toUpperCase())), ul));
      for (const c of g.checks) {
        const cb = h('input', { type: 'checkbox', id: `bp-v-${c.id}` });
        cb.checked = done.has(c.id);
        cb.addEventListener('change', () => {
          if (cb.checked) done.add(c.id); else done.delete(c.id);
          saveDone(done);
          setProgress();
          li.classList.toggle('is-done', cb.checked);
        });
        const li = h('li', { class: `bp-check${cb.checked ? ' is-done' : ''}` },
          h('div', { class: 'bp-check-head' }, cb, h('label', { for: `bp-v-${c.id}` }, h('span', { class: 'muted' }, `${c.n}. `), c.title)),
          h('details', {},
            h('summary', {}, 'How to test'),
            h('p', {}, h('strong', {}, 'Do: '), c.whatToDo),
            h('p', {}, h('strong', {}, 'Pass: '), c.pass),
            h('p', {}, h('strong', {}, 'If it fails: '), c.ifFails),
            h('p', { class: 'muted small' }, `Params: ${c.paramKeys.join(', ') || 'none'}`),
            h('p', { class: 'muted small' }, `Guards: ${c.partIds.join(', ') || 'no single part'}${c.refs.length ? ` · ${c.refs.join(', ')}` : ''}`)));
        ul.append(li);
      }
    }
    return out;
  }

  function renderCutlist(d: BuildData): Node[] {
    const c = d.cutList;
    const out: Node[] = [h('div', { class: 'bp-actions' }, csvButton('Download CSV', 'cutlist.csv', () => d.cutlistCsv))];
    out.push(note('Final size is the finished T × W × L; rough adds the milling allowance. Dimensions in inches (sixteenths as fractions).'));
    if (c.warnings.length) {
      out.push(h('details', { class: 'bp-warn' }, h('summary', {}, `${c.warnings.length} data warning${c.warnings.length === 1 ? '' : 's'}`), h('ul', {}, ...c.warnings.map((w) => h('li', {}, w)))));
    }
    const partCell = (name: string, partNo: string, extra?: string): Node => h('div', {}, h('strong', {}, name), sub(partNo), ...(extra ? [h('div', { class: 'small' }, extra)] : []));
    out.push(h('h3', { class: 'bp-group' }, 'White oak by board thickness'));
    for (const g of c.oak) {
      const resawn = g.board === 'resawn';
      out.push(h('h4', { class: 'bp-sub' }, resawn ? `Resawn strips (${g.pieces} pieces)` : `${g.board} (usable ${fracIn(g.usableIn)}"), ${g.pieces} pieces`));
      out.push(table('bp-cuts', ['Part', 'Qty', 'Final T × W × L', 'Rough T × W × L', 'Grain', 'Fabrication', 'Step'], g.rows.map((r) => [
        partCell(r.name, r.partNo),
        String(r.qty), dims3(r.stock), dims3(r.rough), r.grainWord ?? '–',
        `${r.fab}${r.plies ? ` · ${r.plies} plies` : ''}`, stepList(r.assemblySteps),
      ]), `Oak ${g.board}`, { num: [1] }));
    }
    out.push(h('h3', { class: 'bp-group' }, 'Resaw list'));
    out.push(table('bp-cuts', ['Strips for', 'Strips', 'Final T × W × L', 'Rough T × W × L', 'Resaw from'], c.strips.map((r) => [
      h('div', {}, h('strong', {}, r.name), sub(`${r.parts} part${r.parts === 1 ? '' : 's'} × ${r.plies} plies`)),
      String(r.strips), dims3(r.stock), dims3(r.rough), r.resawFrom,
    ]), 'Resawn strips', { num: [1] }));
    for (const pool of c.resaw) {
      out.push(note(`${pool.strips} strips of ${fracIn(pool.roughT)}" rough: buy ${pool.boards} × ${pool.board} × ${pool.boardWidthIn}" wide × ${pool.boardLengthIn / 12} ft (${pool.boardFeet.toFixed(1)} bf). RIP FIRST into ${pool.lanes} lane${pool.lanes === 1 ? '' : 's'}, then resaw each lane into ${pool.stripsPerBoard} slab${pool.stripsPerBoard === 1 ? '' : 's'}; a board yields ${pool.yieldPerBoard} strips, so the purchase holds ${pool.stripSlots}: ${pool.spares} spare${pool.spares === 1 ? '' : 's'}.`, 'muted bp-prose'));
    }
    out.push(h('h3', { class: 'bp-group' }, 'Okoume plywood'));
    for (const g of c.sheets) {
      out.push(h('h4', { class: 'bp-sub' }, `${g.label} (${g.pieces} pieces)`));
      out.push(table('bp-cuts', ['Part', 'Qty', 'Size T × W × L', 'Grain', 'Fabrication', 'Step'], g.rows.map((r) => [
        partCell(r.name, r.partNo, r.note),
        String(r.qty), dims3(r.stock), r.grainWord ?? '–', r.fab, stepList(r.assemblySteps),
      ]), `Plywood ${g.label}`, { num: [1] }));
    }
    out.push(h('h3', { class: 'bp-group' }, 'Metal stock (drill and tap)'));
    out.push(table('bp-cuts', ['Part', 'Qty', 'Section', 'Cut length', 'Step'], c.metal.map((r) => [
      partCell(r.name, r.partNo), String(r.qty), r.section, `${fracIn(r.cutLengthIn)}"`, stepList(r.assemblySteps),
    ]), 'Metal stock', { num: [1] }));
    return out;
  }

  function renderNesting(d: BuildData): Node[] {
    const n = d.nest;
    const o = d.oak;
    const out: Node[] = [note('Part outlines at true shape on full 4 × 8 sheets (grain arrows follow the sheet). The dashed blue box is the largest offcut. The side webs are drawn unrolled to their flat development.', 'muted small bp-prose')];
    for (const s of n.sheets) {
      out.push(h('article', { class: 'bp-card bp-sheet-card', 'aria-label': `${s.label}, sheet ${s.index}` },
        h('h3', { class: 'bp-group' }, `${s.label}, sheet ${s.index}`, h('span', { class: 'muted' }, ` · ${s.utilizationPct.toFixed(1)}% used`)),
        svgBox(sheetSvg(s), 'bp-preview bp-sheetbox'),
        note(`Offcut: largest ${s.offcut.largest.widthIn.toFixed(1)} × ${s.offcut.largest.heightIn.toFixed(1)} in, ${Math.round(s.offcut.areaIn2 / 144)} ft² free in all.`),
        h('details', {}, h('summary', {}, `${s.placements.length} parts on this sheet`),
          h('ul', { class: 'bp-plain bp-cols' }, ...s.placements.map((q) => h('li', {}, `${q.name} (${q.partId}): ${q.widthIn.toFixed(1)} × ${q.heightIn.toFixed(1)} in${q.rotation ? ', turned 90°' : ''}`))))));
    }
    if (n.unplaced.length) out.push(h('p', { class: 'fail' }, `Did not fit: ${n.unplaced.join(', ')}`));
    if (n.grainTurned.length) out.push(h('p', { class: 'fail' }, `Grain turned across: ${n.grainTurned.map((g) => g.name).join(', ')}`));
    out.push(h('h3', { class: 'bp-group' }, 'Oak board feet'));
    out.push(table('bp-bf', ['Board', 'Pieces', 'Net bf', `+${Math.round(o.wasteAllowance * 100)}% waste`, 'Buy'], [
      ...o.thicknesses.map((t) => [
        h('strong', {}, t.board), String(t.pieces), t.netBf.toFixed(1), t.allowanceBf.toFixed(1),
        h('div', { class: 'bp-buy' }, ...t.summary.map((x) => h('div', {}, x))),
      ]),
    ], 'Oak board feet by thickness', { num: [1, 2, 3], foot: ['Total', '', o.netBf.toFixed(1), o.allowanceBf.toFixed(1), ''] }));
    out.push(note('Net = nominal thickness × rough width × rough length. The BOM prices the suggested whole boards (6" wide, 6, 8 or 10 ft), which runs higher than net plus the waste allowance; a yard that sells by the foot, or wider boards, costs less. Ask the yard for the thick boards first, then see what is left for the thinner parts.', 'muted small bp-prose'));
    if (o.glueUps.length) out.push(note(`Wider than a board, edge-glue two pieces: ${o.glueUps.join(', ')}.`, 'small bp-prose'));
    return out;
  }

  function renderBom(d: BuildData): Node[] {
    const b = d.bom;
    const out: Node[] = [h('div', { class: 'bp-actions' }, csvButton('Download CSV', 'bom.csv', () => b.csv))];
    out.push(h('div', { class: 'bp-total', role: 'status' },
      h('div', {}, h('span', {}, 'Total'), h('strong', {}, usd(b.totalUsd))),
      h('div', { class: 'muted small' }, `${pct(b.estimateShare)} of this is an estimate (${usd(b.estimateUsd)}); the rest is quoted. Prices are 2026 US retail guesses until you get quotes.`),
      h('ul', { class: 'bp-subtotals', 'aria-label': 'Subtotals by section' },
        ...b.sections.map((s) => h('li', {}, h('span', { class: 'muted' }, s.title), h('strong', {}, usd(s.subtotalUsd)))))));
    for (const s of b.sections) {
      out.push(h('h3', { class: 'bp-group' }, s.title, h('span', { class: 'muted' }, ` · ${usd(s.subtotalUsd)}`)));
      out.push(table('bp-bom', ['Item', 'Qty', 'Unit price', 'Basis', 'Vendor', 'Extended'],
        s.lines.map((l) => [
          h('div', {}, l.description, ...(l.notes ? [sub(l.notes)] : [])),
          `${l.qty % 1 ? l.qty.toFixed(2) : l.qty} ${l.unit}`, usd(l.unitUsd), l.basis === 'estimate' ? 'estimate' : 'quoted', l.vendor ?? '–', h('strong', {}, usd(l.extUsd)),
        ]),
        s.title, { num: [1, 2, 5], foot: [`${s.title} subtotal`, '', '', '', '', usd(s.subtotalUsd)] }));
    }
    out.push(h('div', { class: 'bp-total bp-grand' }, h('div', {}, h('span', {}, 'Grand total'), h('strong', {}, usd(b.totalUsd)))));
    if (b.unpriced.length) out.push(h('p', { class: 'fail' }, `No price: ${b.unpriced.join(', ')}`));
    out.push(note(`Lumber is priced as the whole boards to buy; net board feet plus the waste allowance would be about ${usd(b.lumberAllowanceUsd, false)}.`, 'muted small bp-prose'));
    return out;
  }

  function renderShaper(d: BuildData): Node[] {
    const files = d.shaper;
    const out: Node[] = [];
    const legend = h('ul', { class: 'bp-legend', 'aria-label': 'Shaper conventions' },
      ...SHAPER_CONVENTIONS.map((c) => h('li', {}, h('span', { class: `bp-swatch ${c.swatch}`, 'aria-hidden': 'true' }), h('span', {}, h('strong', {}, c.name), `: ${c.meaning}`))));
    out.push(h('div', { class: 'bp-intro' },
      h('div', {}, h('h3', { class: 'bp-group' }, 'How to read the drawings'), legend, note(`${files.length} files, one per part (identical parts share a file). SVG only.`)),
      h('details', { class: 'bp-card' }, h('summary', {}, `Shaper notes (${SHAPER_NOTES.length})`), h('ul', { class: 'bp-plain muted small' }, ...SHAPER_NOTES.map((x) => h('li', {}, x))))));
    const cards: Node[] = [];
    for (const f of files) {
      const depth = maxDepth(f.features);
      cards.push(h('article', { class: 'bp-file', 'aria-label': f.fileName },
        svgBox(previewSvg(f.svg, `${f.partNo} Shaper file preview`)),
        h('div', { class: 'bp-file-head' }, h('strong', {}, f.partNo), h('span', { class: 'muted small' }, f.fileName)),
        h('dl', { class: 'bp-facts' },
          h('dt', {}, 'Size'), h('dd', {}, `${f.widthIn.toFixed(2)} × ${f.heightIn.toFixed(2)} in`),
          h('dt', {}, 'Qty'), h('dd', {}, f.qty > 1 ? `${f.qty} (${f.partIds.join(', ')})` : '1'),
          h('dt', {}, 'Cut face'), h('dd', {}, f.cutFaceMatters ? `${f.cutFace} up` : 'Either face up'),
          h('dt', {}, 'Bits'), h('dd', {}, f.bits.length ? f.bits.join(', ') : 'none'),
          ...(depth !== undefined ? [h('dt', {}, 'Depth'), h('dd', {}, `up to ${depth.toFixed(2)} in`)] : [])),
        ...(f.deepCut ? [h('p', { class: 'bp-deep small' }, h('strong', {}, 'Deep cut: '), 'finish with a bandsaw and a flush-trim bit (see the Shaper notes).')] : []),
        h('div', { class: 'small' }, featureSummary(f.features)),
        h('details', {}, h('summary', {}, 'Features and notes'),
          h('ul', { class: 'bp-plain small' }, ...f.features.map((x) => h('li', {}, `${x.kind}${x.count > 1 ? ` ×${x.count}` : ''}: ${x.label}${x.diaIn ? ` Ø${x.diaIn.toFixed(3)}"` : ''}${x.depthIn ? `, ${x.depthIn.toFixed(3)}" deep` : ''}`)))),
        h('div', { class: 'bp-actions' }, btn('Download SVG', () => download(f.fileName, SVG_MIME, f.svg), `Save ${f.fileName}`))));
    }
    out.push(h('div', { class: 'bp-grid' }, ...cards));
    return out;
  }

  function renderForms(d: BuildData): Node[] {
    const out: Node[] = [note('Full-size (1:1) drawings with dimensions and a 1 inch check square. "Print tiled" splits them onto Letter pages with alignment marks; in the print dialog choose scale 100% (not "fit to page"), margins none, and measure the check square on every page.', 'muted small bp-prose')];
    const cards: Node[] = [];
    for (const f of d.forms) {
      const plan = tilePlan(f.widthIn, f.heightIn);
      const tiles = d.tiles.find((t) => t.id === f.id)!;
      const pages = plan.cols * plan.rows;
      cards.push(h('article', { class: 'bp-file', 'aria-label': f.title },
        svgBox(previewSvg(f.svg, `${f.title} preview`)),
        h('div', { class: 'bp-file-head' }, h('strong', {}, f.title), h('span', { class: 'muted small' }, f.fileName)),
        h('dl', { class: 'bp-facts' },
          h('dt', {}, 'Size'), h('dd', {}, `${f.widthIn.toFixed(1)} × ${f.heightIn.toFixed(1)} in`),
          h('dt', {}, 'Print'), h('dd', {}, `${pages} Letter page${pages === 1 ? '' : 's'} (${plan.cols} × ${plan.rows})`)),
        h('details', {}, h('summary', {}, 'Dimensions and notes'),
          h('ul', { class: 'bp-plain small' }, ...f.dims.map((x) => h('li', {}, `${x.label}: ${fracIn(Math.round(x.valueIn * 1000) / 1000)}${/count|clamps|ribs|marks/i.test(x.label) ? '' : '"'}`)),
            ...f.notes.map((x) => h('li', { class: 'muted' }, x)))),
        h('div', { class: 'bp-actions' },
          btn('Download full-size SVG', () => download(f.fileName, SVG_MIME, f.svg), `Save ${f.fileName}`),
          btn('Print tiled (Letter)', () => printTiles(tiles.pages), 'Print this drawing on Letter pages at true scale'))));
    }
    out.push(h('div', { class: 'bp-grid bp-grid-forms' }, ...cards));
    return out;
  }

  function renderAssembly(d: BuildData): Node[] {
    const steps = d.steps;
    const parts = design?.parts ?? [];
    const nameOf = new Map(parts.map((x) => [x.id, x.name]));
    stepN = clampStep(steps, stepN);
    const stepIdx = () => Math.max(0, steps.findIndex((s) => s.n === stepN));

    const list = h('ol', { class: 'bp-steps', 'aria-label': 'Assembly steps' });
    const items = steps.map((s) => {
      const b = h('button', { type: 'button', class: 'bp-step-btn' }, h('span', { class: 'bp-step-n' }, `${s.n}`), h('span', {}, s.title), s.kind === 'build' ? '' : h('span', { class: 'bp-kind' }, s.kind));
      b.addEventListener('click', () => go(s.n));
      list.append(h('li', {}, b));
      return b;
    });
    const detail = h('div', { class: 'bp-step-detail', 'aria-live': 'polite' });
    const counter = h('span', { class: 'muted small' });
    const prev = btn('← Prev', () => go(steps[Math.max(0, stepIdx() - 1)].n), 'Previous step');
    const next = btn('Next →', () => go(steps[Math.min(steps.length - 1, stepIdx() + 1)].n), 'Next step', 'bp-primary');
    const viewNote = h('p', { class: 'muted small' });

    const detailNodes = (s: BuildStep, forPrint: boolean): Node[] => {
      const ids = s.partIds;
      const listing = ids.map((id) => nameOf.get(id) ?? id);
      const out: Node[] = [
        h('h3', { class: 'bp-step-title' }, `${s.n}. ${s.title}`, s.kind === 'build' ? '' : h('span', { class: 'bp-kind' }, s.kind)),
        ids.length
          ? (listing.length > 6 && !forPrint
              ? h('details', { class: 'small' }, h('summary', {}, `Parts (${ids.length})`), h('div', { class: 'muted' }, listing.join(', ')))
              : h('p', { class: 'small' }, h('strong', {}, `Parts (${ids.length}): `), listing.join(', ')))
          : h('p', { class: 'muted small' }, 'No parts installed in this step.'),
        h('ol', { class: 'bp-instr' }, ...s.instructions.map((t) => h('li', {}, t))),
      ];
      if (s.clampCure) out.push(h('p', { class: 'bp-cure' }, h('strong', {}, 'Glue, clamp and cure: '), s.clampCure));
      else if (s.cure) out.push(h('p', { class: 'bp-cure' }, h('strong', {}, 'Cure: '), cureLine(s.cure)));
      if (s.checks.length) out.push(h('div', {}, h('strong', { class: 'small' }, 'Check before moving on'), h('ul', { class: 'bp-checkboxes' }, ...s.checks.map((c) => h('li', {}, h('span', { class: 'bp-box', 'aria-hidden': 'true' }), c)))));
      if (s.tools.length) out.push(h('p', { class: 'muted small' }, h('strong', {}, 'Tools: '), s.tools.join(', ')));
      return out;
    };

    const update = (reframe: boolean) => {
      const i = stepIdx();
      const s = steps[i];
      if (!s) { emit(null); return; }
      items.forEach((b, j) => { if (j === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
      if (items[i]) list.scrollTop = items[i].offsetTop - list.clientHeight / 2;
      counter.textContent = `Step ${i + 1} of ${steps.length}`;
      (prev as HTMLButtonElement).disabled = i === 0;
      (next as HTMLButtonElement).disabled = i === steps.length - 1;
      detail.replaceChildren(...detailNodes(s, false));
      const f = stepFocus(steps, s.n, reframe);
      viewNote.textContent = f?.visibleIds
        ? `The 3D viewer shows steps 0 to ${s.n}${s.partIds.length ? '; this step’s parts are highlighted' : ' (nothing new to install in this step)'}. Camera: ${s.view}.`
        : 'Preparation: nothing is installed yet, so the 3D viewer shows the finished sled for reference.';
      emit(f);
    };
    const go = (n: number) => {
      stepN = n;
      update(true);
    };
    stepUpdate = update;

    return [
      note('Step through the build; the 3D viewer shows the sled as built up to the current step. Leaving this section restores the full model.', 'muted small bp-screen-only'),
      h('div', { class: 'bp-screen-only' },
        h('div', { class: 'bp-stepnav' }, prev, counter, next),
        viewNote,
        detail,
        h('details', { class: 'bp-allsteps', ...(wide.matches ? { open: '' } : {}) }, h('summary', {}, `All ${steps.length} steps`), list)),
      h('div', { class: 'bp-print-only' }, ...steps.map((s) => h('article', { class: 'bp-step-print' }, ...detailNodes(s, true)))),
    ];
  }

  function renderFinishing(d: BuildData): Node[] {
    const f = d.finishing;
    const out: Node[] = [h('p', { class: 'small bp-prose' }, `Finish area (gross): ${f.areas.oakFt2.toFixed(0)} ft² oak, ${f.areas.okoumeFt2.toFixed(0)} ft² okoume, ${f.areas.oakEndGrainFt2.toFixed(1)} ft² oak end grain. Quantities include ${pct(0.15)} waste.`)];
    out.push(h('h3', { class: 'bp-group' }, 'Shopping list'));
    out.push(table('bp-fin', ['Product', 'Notes', 'Buy'], f.buy.map((b) => [h('strong', {}, b.item), b.note, `${b.qty} ${b.unit}`]), 'Finish products to buy'));
    out.push(h('h3', { class: 'bp-group' }, 'Schedule'));
    out.push(h('div', { class: 'bp-grid bp-grid-fin' }, ...f.steps.map((s) =>
      h('article', { class: 'bp-card bp-finstep' },
        h('h4', { class: 'bp-sub' }, `${s.n}. ${s.title}`, s.coats ? h('span', { class: 'muted' }, ` · ${s.coats} coat${s.coats === 1 ? '' : 's'}`) : ''),
        h('ol', { class: 'bp-instr' }, ...s.instructions.map((t) => h('li', {}, t))),
        s.products.length
          ? table('bp-fin', ['Product', 'Area', 'Coats', 'Qt'], s.products.map((p) => [p.name, `${p.areaFt2.toFixed(0)} ft²`, String(p.coats), p.qtNeeded.toFixed(2)]), `${s.title} products`, { num: [1, 2, 3] })
          : h('span', {}),
        h('p', { class: 'small' }, h('strong', {}, 'Recoat: '), s.recoat, ' ', h('strong', {}, 'Cure: '), s.cure),
        h('p', { class: 'muted small' }, h('strong', {}, 'Winter shop: '), s.winter)))));
    if (f.assumptions.length) out.push(h('details', {}, h('summary', {}, 'Assumptions'), h('ul', { class: 'bp-plain small' }, ...f.assumptions.map((a) => h('li', {}, a)))));
    return out;
  }

  function renderDownloads(d: BuildData): Node[] {
    const files = d.files;
    const out: Node[] = [];
    out.push(h('div', { class: 'bp-actions' },
      btn('Download all (zip)', () => saveZip(d), 'Every file below in one zip', 'bp-primary'),
      btn('Open build book (print or save as PDF)', () => openBook(d), 'The whole build on paper, from the same data as this mode: opens in a new tab')));
    out.push(note(`${files.length} files, generated from the design on screen (params rev ${d.revision}). The zip is uncompressed; open it with any unzip tool.`, 'muted small bp-prose'));
    out.push(table('bp-files', ['File', 'Size', ''], files.map((f) => {
      const size = typeof f.data === 'string' ? new TextEncoder().encode(f.data).length : f.data.length;
      return [h('span', { class: 'bp-fname' }, f.name), bytesLabel(size), btn('Save', () => download(f.name, f.mime, f.data), `Save ${f.name}`)];
    }), 'Package files', { num: [1] }));
    return out;
  }

  const RENDER: Record<SectionId, (d: BuildData) => Node[]> = {
    verify: renderVerify, cutlist: renderCutlist, nesting: renderNesting, bom: renderBom, shaper: renderShaper,
    forms: renderForms, assembly: renderAssembly, finishing: renderFinishing, downloads: renderDownloads,
  };

  show(section);
  panels.get(section)!.append(note('Open Build mode to generate the outputs.'));

  return {
    setDesign(p, parts) {
      design = { p, parts, key: JSON.stringify(p) };
      if (!active) return; // computed when the mode opens
      if (data && dataKey === design.key) return;
      if (!data) renderSection(); // the first design after the mode opened: no pause
      else schedule();
    },
    section: () => section,
    setActive(a) {
      if (a === active) return;
      active = a;
      clearTimeout(timer);
      if (a) renderSection();
      else {
        stepUpdate = null;
        clearTiles();
        emit(null);
        root.removeAttribute('aria-busy');
      }
    },
  };
}
