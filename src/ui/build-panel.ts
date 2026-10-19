/**
 * Build mode (top-level mode since the UI rework): verify checklist, cut list, nesting, BOM, Shaper files,
 * forms and templates, assembly (with the 3D step-through), finishing and downloads. Everything comes from `BuildData` (src/build/package.ts),
 * a pure function of the current model and params, computed lazily for the section on screen only, while the mode is open,
 * debounced on parameter changes and cached per parameter set.
 * Two hosts: a left rail (section nav + the zip, book and print buttons) and the content column. Layout lives in build-panel.css.
 */
import type { Dims, Part } from '../model/types';
import { WEATHER_SPEC, type Params, type ParamKey } from '../params';
import type { BomLine, BomSection, WeatherCompare } from '../build/bom';
import { BuildData, CSV_MIME, LASER_CONVENTIONS, LASER_NOTES, SHAPER_CONVENTIONS, SHAPER_NOTES, SVG_MIME, drawingFileName, zipName, zipPackage } from '../build/package';
import { FROM_TEXT, fabText } from '../build/cutlist';
import { paramLabels } from '../build/verify';
import { tilePlan } from '../build/forms';
import { partLabel, type BuildStep } from '../build/assembly';
import { drawnParts, partDims, type PartDims, type PartDrawingSheet } from '../build/part-drawings';
import { roughFrac } from '../build/units';
import { h } from './dom';
import {
  SPEC_NAME, bytesLabel, clampStep, cureLine, dimsParts, featureSummary, fracDim, fracInch, fracInch64, groupByWhen, groupCutsByBoard, loadDone, loadStep, loadStepChecks, maxDepth, mergeBuy, noteLead, partFacts, pct, pieceWord, pinFocus, previewSvg, saveDone, saveStep, saveStepChecks,
  makeLine, sameLead, sharedNote, sheetSvg, splitUrls, stepFocus, stepOfPart, tilePagesHtml, todayISO, usd, vendorFromUrl, weatherChipText,
  type StepFocus,
} from './build-helpers';
import { createPartUi, type DrawingView } from './part-ui';
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
  /** Set one design parameter (the BOM's weather toggle sets `weatherSpec`). */
  setParam?(key: ParamKey, value: number): void;
  /** Save the briefing book for the troop committee as an HTML file (it needs the 3D viewer for its pictures, so the app makes it). */
  openBriefing?(): void;
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
  { id: 'laser', label: 'Laser', title: 'Laser files (XTool S1)' },
  { id: 'forms', label: 'Forms', title: 'Forms and templates' },
  { id: 'drawings', label: 'Drawings', title: 'Part drawings' },
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
  /** Columns that never wrap (a grain word, a step list). */
  nowrap?: number[];
  /** Phone cards (under 600 px): the quantity column, the one size line that is shown bold, and the closing price. The rest becomes a muted `label value` line. */
  qty?: number;
  key?: number;
  end?: number;
  /** Column widths in percent (a `colgroup`): consecutive cut-list tables share the first columns so Qty and Final line up. */
  cols?: number[];
}

/** A table in a keyboard-scrollable wrapper (a wide table scrolls sideways instead of wrapping into a column of fragments). */
const table = (cls: string, head: (string | Node)[], rows: (string | Node)[][], aria: string, opts: TableOpts = {}): HTMLElement => {
  const classes = (i: number): string => [opts.num?.includes(i) ? 'num' : '', opts.nowrap?.includes(i) ? 'nw' : '', opts.qty === i ? 'c-qty' : '', opts.key === i ? 'c-key' : '', opts.end === i ? 'c-end' : ''].filter(Boolean).join(' ');
  const attrs = (i: number): Record<string, string> => (classes(i) ? { class: classes(i) } : {});
  // `data-label` is the phone card's caption for the cell ("Rough", not "Rough T × W × L").
  const label = (i: number): Record<string, string> => (typeof head[i] === 'string' && head[i] ? { 'data-label': (head[i] as string).replace(/\s*T × W × L$/, '') } : {});
  const t = h('table', { class: `bp-table ${cls}`.trim(), 'aria-label': aria },
    ...(opts.cols ? [h('colgroup', {}, ...opts.cols.map((w) => h('col', { style: `width: ${w}%` })))] : []),
    h('thead', {}, h('tr', {}, ...head.map((x, i) => h('th', { scope: 'col', ...attrs(i) }, x)))),
    h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c, i) => h('td', { ...attrs(i), ...label(i) }, c))))),
    ...(opts.foot ? [h('tfoot', {}, h('tr', {}, ...opts.foot.map((c, i) => h(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : attrs(i), c))))] : []));
  const wrap = h('div', { class: 'bp-scroll', role: 'region', tabindex: '0', 'aria-label': aria }, t);
  watchOverflow(wrap);
  return wrap;
};

/**
 * Keep `.is-over` (a right-edge shadow cue: the table scrolls sideways) and `.is-fit` (nothing overflows, so the wrapper clips instead of
 * scrolling and the table header can stick to the page scroller) in step with the width. One shared observer.
 */
let overflowRo: ResizeObserver | undefined;
function measureOverflow(sc: HTMLElement): void {
  sc.classList.remove('is-fit', 'is-over'); // measure in the scrolling state
  sc.classList.add(sc.scrollWidth > sc.clientWidth + 1 ? 'is-over' : 'is-fit');
}
function watchOverflow(sc: HTMLElement): void {
  if (typeof ResizeObserver === 'undefined') return;
  overflowRo ??= new ResizeObserver((entries) => {
    for (const e of entries) {
      const el = e.target as HTMLElement;
      const sc = el.classList.contains('bp-scroll') ? el : (el.parentElement as HTMLElement | null);
      if (!sc || !sc.isConnected) { overflowRo?.unobserve(el); continue; }
      measureOverflow(sc);
    }
  });
  overflowRo.observe(sc);
  overflowRo.observe(sc.firstElementChild as Element);
}

const sub = (text: string, extra = '') => h('div', { class: 'muted small' }, text + extra);
/** A size in a table cell: `5/8 × 1-3/4 × 21-5/32 (21.142)`, each dimension unbreakable (`.bp-d`). */
const dimsCell = (d: Dims): Node => {
  const out: (string | Node)[] = [];
  dimsParts(d).forEach((x, i) => { if (i) out.push(' × '); out.push(h('span', { class: 'bp-d' }, x)); });
  return h('span', {}, ...out);
};
/** A BOM item name, linked to the vendor page when the price or part carries a real http(s) link. */
const itemName = (text: string, url?: string): string | Node =>
  url && /^https?:\/\//i.test(url) ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'bp-link' }, text) : text;
const isHttp = (url: string | undefined): url is string => !!url && /^https?:\/\//i.test(url);
const extLink = (text: string, url: string): HTMLElement => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'bp-link' }, text);
/** Text with its raw http(s) URLs turned into short "vendor page" links. */
const linkified = (text: string): (string | Node)[] => splitUrls(text).map((seg) => (typeof seg === 'string' ? seg : extLink('vendor page', seg.url)));
/** A cheaper option for a BOM line (`BomLine.alternatives`, from prices.ts); every field is optional so a partial record still renders. */
interface AltLike { source?: string; vendor?: string; usd?: number; unit?: string; url?: string; note?: string; specGap?: boolean | string; packQty?: number; packUsd?: number; packLabel?: string }
const altsOf = (l: BomLine): AltLike[] => {
  const a = (l as { alternatives?: unknown }).alternatives;
  return Array.isArray(a) ? (a as AltLike[]).filter((x) => x && typeof x === 'object') : [];
};
/** "Harbor Freight $9.99/ea (spec gap: 5/8" bore)": the vendor is the link; the why is the first clause of the price's note after "SPEC GAP:" (the rest is in the line's Details). */
const altNode = (a: AltLike): Node => {
  const name = a.source ?? a.vendor ?? (a.url ? vendorFromUrl(a.url) : '') ?? '';
  const price = a.packQty && a.packUsd ? ` ${usd(a.packUsd)} per ${a.packLabel ?? `pack of ${a.packQty}`}` : typeof a.usd === 'number' ? ` ${usd(a.usd)}${a.unit ? `/${a.unit}` : ''}` : '';
  const raw = (typeof a.specGap === 'string' ? a.specGap : a.note ?? '').replace(/^\s*SPEC GAP:\s*/i, '');
  const why = raw ? noteLead(raw, 48).lead.replace(/[.\s]+$/, '') : '';
  const gap = a.specGap || /^\s*SPEC GAP/i.test(a.note ?? '') ? `spec gap${why ? `: ${why}` : ''}` : why;
  return h('span', { class: 'bp-alt', ...(raw ? { title: raw } : {}) }, isHttp(a.url) ? extLink(`${name || 'vendor page'} ↗`, a.url) : (name || 'Other'), price, gap ? ` (${gap})` : '');
};
/** A first sentence of a material note that warns (plated steel, a wrong type): shown inline even when the note differs from the shared one. */
const MATERIAL_WARN = /check the listing|\bNOT\b(?! priced)/;
const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
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
  let stepN = loadStep(); // kept for the tab session (sessionStorage); clampStep fixes it if the step list changed
  let stepUpdate: ((reframe: boolean, pinOnly?: boolean) => void) | null = null;
  /** Move the Assembly step by one (the arrow keys); null outside the Assembly section. */
  let stepMove: ((delta: number) => void) | null = null;
  /** The weather toggle was just used: its re-rendered button gets the focus back. */
  let weatherRefocus = false;
  let done = loadDone();
  const stepChecks = loadStepChecks();
  /** "Show in 3D": the part(s) pinned in the viewer until the next step. `frame` is true until the first emit has asked the camera to frame them. */
  let pin: { ids: string[]; frame: boolean } | null = null;
  /** Bumped by every section render; a deferred fill (drawings, files) whose token is stale is dropped. */
  let renderToken = 0;
  /** The pause before a deferred fill: short on a section change, long after a parameter change (a slider drag should not hitch on the drawings). */
  let lazyDelay = 30;
  const dimsCache = new Map<string, PartDims | undefined>();
  let byIdCache: { parts: Part[]; map: Map<string, Part> } | null = null;
  const partById = (id: string): Part | undefined => {
    if (!design) return undefined;
    if (!byIdCache || byIdCache.parts !== design.parts) byIdCache = { parts: design.parts, map: new Map(design.parts.map((x) => [x.id, x])) };
    return byIdCache.map.get(id);
  };
  let drawnCache: { parts: Part[]; ids: Set<string> } | null = null;
  const drawnHas = (id: string): boolean => {
    if (!design) return false;
    if (!drawnCache || drawnCache.parts !== design.parts) drawnCache = { parts: design.parts, ids: new Set(drawnParts(design.parts).map((x) => x.id)) };
    return drawnCache.ids.has(id);
  };
  /** A drawing modal's content for a part: its dimensioned drawing, else its Shaper file. */
  const drawingOf = (id: string): DrawingView | undefined => {
    if (!data) return undefined;
    const sheet = data.partDrawings.find((x) => x.partIds.includes(id));
    if (sheet) return sheetView(sheet, id);
    const f = data.shaper.find((x) => x.partIds.includes(id));
    return f ? { title: `${f.partNo} (Shaper file)`, sub: `${f.fileName} · ${fracDim(f.widthIn)} × ${fracDim(f.heightIn)} in, full size`, markup: previewSvg(f.svg, `${f.partNo} Shaper file`), fileName: f.fileName, svg: f.svg, partId: id } : undefined;
  };
  const sheetView = (sh: PartDrawingSheet, partId: string): DrawingView => ({
    title: sh.name,
    sub: [makeLine(sh.qty, sh.makeNote), `drawn at ${sh.scale}`].filter(Boolean).join(' · '),
    markup: previewSvg(sh.svg, `${sh.name} drawing`),
    fileName: (drawingFileName(sh).split('/').pop() ?? 'drawing.svg'),
    svg: sh.svg,
    partId,
  });
  const ui = createPartUi({
    label: (id) => { const x = partById(id); return x ? partLabel(x) : undefined; },
    has: (id) => !!partById(id),
    facts: (id) => {
      const part = partById(id);
      if (!part || !design) return undefined;
      if (!dimsCache.has(id)) {
        let dims: PartDims | undefined;
        try { dims = partDims(part, design.parts, design.p); } catch { dims = undefined; }
        dimsCache.set(id, dims);
      }
      return partFacts(part, id, data?.cutList, dimsCache.get(id), data?.partDrawings.find((x) => x.partIds.includes(id))?.makeNote);
    },
    hasDrawing: (id) => drawnHas(id) || !!data?.shaper.some((f) => f.partIds.includes(id)),
    drawing: drawingOf,
    show3d: (id) => show3d(id),
    download: (name, svg) => download(name, SVG_MIME, svg),
  });
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
    h('div', { class: 'bp-rail-actions', role: 'group', 'aria-label': 'Build downloads and print' }, zipBtn, bookBtn,
      ...(opts.openBriefing ? [btn('Download briefing book', () => opts.openBriefing?.(), 'A short handout for the troop committee: what the sled is for, pictures and the cost by group. Saves one HTML file that opens in any browser (print or save as PDF from there)')] : []),
      printBtn),
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
    ui.closeAll();
    if (id !== 'assembly') { stepUpdate = null; stepMove = null; pin = null; emit(null); }
    opts.onSection?.(id);
    if (changed) main.scrollTop = 0;
    if (active) renderSection();
  }

  /**
   * "Show in 3D" on a part chip. In Assembly the viewer highlights and frames the part now; from any other section the panel first switches to Assembly at the step
   * that installs the part (so the part, and the parts it sits on, are drawn), then does the same.
   */
  function show3d(id: string): void {
    if (!refreshData() || !data) return;
    pin = { ids: [id], frame: true };
    if (section === 'assembly' && stepUpdate) { stepUpdate(false, true); return; }
    const n = stepOfPart(data.steps, id);
    if (n !== undefined) { stepN = n; saveStep(n); }
    show('assembly'); // renders, then emits the step with the pin
    window.scrollTo({ top: 0 });
  }

  /** A slow output: a status line now, the content after the paint (dropped if the section was drawn again meanwhile). */
  function lazy(slot: HTMLElement, message: string, make: () => Node[]): void {
    slot.replaceChildren(h('p', { class: 'muted', role: 'status' }, message));
    const mine = renderToken;
    setTimeout(() => {
      if (mine !== renderToken || !slot.isConnected) return;
      try {
        slot.replaceChildren(...make());
      } catch (err) { // never leave "Drawing the parts…" up for good
        console.error(err);
        slot.replaceChildren(h('p', { class: 'fail', role: 'alert' }, `This could not be drawn: ${err instanceof Error ? err.message : String(err)}`));
      }
    }, lazyDelay);
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
    dimsCache.clear();
    return true;
  }

  function renderSection(reframe = true): void {
    root.removeAttribute('aria-busy');
    ui.closeAll();
    renderToken++;
    lazyDelay = reframe ? 30 : 700;
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
    status.textContent = `Design revision ${d.revision} · ${todayISO()} · computed in ${Math.round(stageMs + ms)} ms`;
    if (section === 'assembly') stepUpdate?.(reframe);
    if (weatherRefocus && section === 'bom') {
      weatherRefocus = false;
      panel.querySelector<HTMLElement>('[data-weather][aria-checked="true"]')?.focus({ preventScroll: true });
    }
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

  // ← / → step through the Assembly section unless the keys belong to a field (or another handler already took them: the section list).
  document.addEventListener('keydown', (e) => {
    if (!active || section !== 'assembly' || !stepMove || e.defaultPrevented) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if ((e.target as Element | null)?.closest?.('input, select, textarea, [contenteditable=""], [contenteditable="true"], [role="slider"], .bp-pop, dialog')) return;
    e.preventDefault();
    stepMove(e.key === 'ArrowRight' ? 1 : -1);
  });

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
      note('Test these before you spend money or cut wood. Each check covers parts and design numbers we are not sure of yet. Your ticks stay in this browser.', 'muted small'),
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
            h('strong', { class: 'small' }, 'Do'),
            c.how?.length ? ui.instrList(c.how) : h('p', {}, c.whatToDo),
            h('strong', { class: 'small' }, 'Pass'),
            c.passList?.length ? h('ul', { class: 'bp-sublist bp-pass' }, ...c.passList.map((t) => h('li', {}, ...ui.text(t)))) : h('p', {}, c.pass),
            h('p', {}, h('strong', {}, 'If it fails: '), c.ifFails),
            ...(c.paramKeys.length && c.id !== 'other-params' ? [h('p', { class: 'muted small' }, `Design values this confirms: ${paramLabels(c.paramKeys).join(', ')}`)] : []),
            ...(c.partIds.length ? [h('p', { class: 'small' }, h('span', { class: 'muted' }, 'Parts it covers: '), ui.chips(c.partIds))] : [])));
        ul.append(li);
      }
    }
    return out;
  }

  function renderCutlist(d: BuildData): Node[] {
    const c = d.cutList;
    const out: Node[] = [h('div', { class: 'bp-actions' }, csvButton('Download CSV', 'cutlist.csv', () => d.cutlistCsv))];
    out.push(note('Three steps: saw the CUTS from the boards (rough sizes round up to 1/8"), GLUE UP the panels and blocks, then MILL each part to its FINISHED size. Part names open a card with its sizes and a view in 3D.', 'muted small bp-prose'));
    if (c.warnings.length) {
      out.push(h('details', { class: 'bp-warn' }, h('summary', {}, `${c.warnings.length} data warning${c.warnings.length === 1 ? '' : 's'}`), h('ul', {}, ...c.warnings.map((w) => h('li', {}, w)))));
    }
    const partCell = (id: string, name: string, extra?: string): Node => h('div', {}, ui.chip(id, name), ...(extra ? [h('div', { class: 'small' }, extra)] : []));

    // 1. CUTS: the pieces sawn from the boards, by board thickness.
    out.push(h('h3', { class: 'bp-group' }, '1. Cuts: saw these from the boards'));
    for (const g of groupCutsByBoard(c.cuts)) {
      const pieces = g.cuts.reduce((a, x) => a + x.qty, 0);
      out.push(h('h4', { class: 'bp-sub' }, `${g.board} boards`, h('span', { class: 'muted' }, ` · ${pieces} piece${pieces === 1 ? '' : 's'}`)));
      out.push(table('bp-cuts', ['Cut', 'Qty', 'Rough T × W × L', 'Piece', 'Note'], g.cuts.map((x) => [
        h('div', {}, ui.chip(x.partId, x.label), ...(x.glueUp ? [sub(`glued into the ${x.glueUp}`)] : [])),
        String(x.qty), h('span', { class: 'bp-d' }, x.roughText), pieceWord(x), x.note ?? '',
      ]), `Cuts from ${g.board} boards`, { num: [1], nowrap: [3], qty: 1, key: 2, cols: [34, 6, 24, 14, 22] }));
    }
    if (!c.cuts.length) out.push(note('No solid-wood cuts in this design.'));

    // Resaw: how the laminating strips are made (rip the lanes first, then resaw each lane).
    if (c.resaw.length) {
      out.push(h('h4', { class: 'bp-sub' }, 'Resawing the strips'));
      for (const pool of c.resaw) {
        out.push(h('div', { class: `bp-card bp-resaw${pool.withinCapacity ? '' : ' is-over'}` },
          h('strong', {}, `${pool.strips} strips, ${roughFrac(pool.roughT)} rough, from ${pool.boards} × ${pool.board} board${pool.boards === 1 ? '' : 's'}`),
          h('ul', { class: 'bp-sublist' }, h('li', {}, `${cap(pool.ripText)}: ${pool.laneCountText}.`), h('li', {}, `Then resaw each lane on edge into ${pool.stripsPerBoard} slab${pool.stripsPerBoard === 1 ? '' : 's'}: ${pool.resawHeightText}.`),
            ...(pool.withinCapacity ? [] : [h('li', { class: 'fail' }, `Taller than the bandsaw can cut (${roughFrac(pool.bandsawCapacityIn)}): see the data warnings.`)])),
          h('p', { class: 'muted small' }, `${pool.stripSlots} strips come out for the ${pool.strips} needed: ${pool.spares} spare${pool.spares === 1 ? '' : 's'} for the bend test.`)));
      }
    }

    // 2. GLUE-UPS
    out.push(h('h3', { class: 'bp-group' }, '2. Glue-ups'));
    if (c.glueUps.length) {
      out.push(table('bp-cuts', ['Glue-up', 'Qty', 'From', 'Rough block T × W × L', 'Then mill to T × W × L'], c.glueUps.map((g) => [
        h('div', {}, ui.chip(g.partId, g.label), h('div', { class: 'small' }, g.note.split(';')[0].replace(/^./, (ch) => ch.toUpperCase()))),
        String(g.qty), `${g.from} piece${g.from === 1 ? '' : 's'}`, h('span', { class: 'bp-d' }, g.roughBlockText), h('span', { class: 'bp-d' }, g.finalText),
      ]), 'Glue-ups', { num: [1], nowrap: [2], qty: 1, key: 4, cols: [34, 6, 12, 24, 24] }));
    } else out.push(note('Nothing is glued up in this design.'));

    // 3. FINISHED PARTS
    out.push(h('h3', { class: 'bp-group' }, '3. Finished parts: mill to these sizes'));
    out.push(table('bp-cuts', ['Part', 'Qty', 'Final T × W × L', 'From', 'Board', 'Grain', 'Fabrication', 'Step'], c.finished.map((f) => [
      ui.chip(f.ids[0], f.name),
      String(f.qty), h('span', { class: 'bp-d' }, f.finalText), FROM_TEXT[f.from] ?? f.from, f.board, f.grainWord ?? '–', fabText(f.fab), stepList(f.assemblySteps),
    ]), 'Finished parts', { num: [1], nowrap: [3, 4, 5], qty: 1, key: 2, cols: [24, 5, 20, 10, 7, 12, 14, 8] }));

    // Plywood and metal: the rest of the cut list.
    out.push(h('h3', { class: 'bp-group' }, 'Plywood'));
    for (const g of c.sheets) {
      out.push(h('h4', { class: 'bp-sub' }, `${g.label} (${g.pieces} pieces)`));
      out.push(table('bp-cuts', ['Part', 'Qty', 'Final T × W × L', 'Grain', 'Fabrication', 'Laser', 'Step'], g.rows.map((r) => [
        partCell(r.ids[0], r.name, r.note),
        String(r.qty), dimsCell(r.final), r.grainWord ?? '–', fabText(r.fab), h('span', { class: r.laser.ok ? 'bp-laser-yes' : 'bp-laser-no', title: r.laser.text }, r.laser.ok ? 'Laser: yes' : r.laser.text.replace(/^no: /, 'No: ')), stepList(r.assemblySteps),
      ]), `Plywood ${g.label}`, { num: [1], nowrap: [3], qty: 1, key: 2, cols: [24, 5, 20, 11, 20, 14, 6] }));
    }
    out.push(h('h3', { class: 'bp-group' }, 'Metal stock (cut on the metal bandsaw and drill)'));
    out.push(table('bp-cuts', ['Part', 'Qty', 'Section', 'Cut length', 'Step'], c.metal.map((r) => [
      partCell(r.ids[0], r.name), String(r.qty), r.section, fracInch(r.cutLengthIn), stepList(r.assemblySteps),
    ]), 'Metal stock', { num: [1], qty: 1, key: 3, cols: [26, 5, 22, 22, 25] }));
    return out;
  }

  function renderNesting(d: BuildData): Node[] {
    const n = d.nest;
    const o = d.oak;
    const oakBuy = (): Node[] => {
      const out: Node[] = [];
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
    };
    // The shopping list (oak board feet) comes first; the sheet drawings are the long part.
    const out: Node[] = [...oakBuy()];
    out.push(h('h3', { class: 'bp-group' }, 'Plywood sheets'));
    out.push(note('Part outlines at true shape on full 4 × 8 sheets (grain arrows follow the sheet). The dashed blue box is the largest offcut. The side webs are drawn unrolled to their flat development.', 'muted small bp-prose'));
    for (const s of n.sheets) {
      out.push(h('article', { class: 'bp-card bp-sheet-card', 'aria-label': `${s.label}, sheet ${s.index}` },
        h('h3', { class: 'bp-group' }, `${s.label}, sheet ${s.index}`, h('span', { class: 'muted' }, ` · ${s.utilizationPct.toFixed(1)}% used`)),
        svgBox(sheetSvg(s), 'bp-preview bp-sheetbox'),
        note(`Offcut: largest ${fracDim(s.offcut.largest.widthIn)} × ${fracDim(s.offcut.largest.heightIn)} in, ${Math.round(s.offcut.areaIn2 / 144)} ft² free in all.`),
        h('details', {}, h('summary', {}, `${s.placements.length} parts on this sheet`),
          h('ul', { class: 'bp-plain bp-cols' }, ...s.placements.map((q) => h('li', {}, ui.chip(q.partId, q.name), `: ${fracDim(q.widthIn)} × ${fracDim(q.heightIn)} in${q.rotation ? ', turned 90°' : ''}`))))));
    }
    if (n.unplaced.length) out.push(h('p', { class: 'fail' }, `Did not fit: ${n.unplaced.join(', ')}`));
    if (n.grainTurned.length) out.push(h('p', { class: 'fail' }, `Grain turned across: ${n.grainTurned.map((g) => g.name).join(', ')}`));
    return out;
  }

  /**
   * Weather spec (D-73): a two-way toggle that sets `weatherSpec`, a chip with what the OTHER spec costs against this one, and the difference per section. The
   * comparison is the BOM priced again under the other spec (same design; the thin sheet changes with it unless it was chosen by hand).
   */
  function weatherBlock(spec: 'standard' | 'extreme', cmp: WeatherCompare, sections: BomSection[], thinName: string): Node {
    const choose = (next: 'standard' | 'extreme'): void => {
      if (next === spec) return;
      weatherRefocus = true;
      opts.setParam?.('weatherSpec', next === 'extreme' ? WEATHER_SPEC.extreme : WEATHER_SPEC.standard);
    };
    const seg = (id: 'standard' | 'extreme'): HTMLButtonElement => {
      const b = h('button', { type: 'button', role: 'radio', class: 'bp-seg-btn', 'data-weather': id, 'aria-checked': String(spec === id), tabindex: spec === id ? '0' : '-1' }, SPEC_NAME[id]);
      b.addEventListener('click', () => choose(id));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); choose(id === 'standard' ? 'extreme' : 'standard'); }
      });
      return b;
    };
    const titles = new Map(sections.map((x) => [x.id as string, x.title]));
    const deltas = Object.entries(cmp.deltaBySection).filter(([, v]) => Math.abs(v) >= 0.005);
    const sign = (v: number): string => `${v < 0 ? '-' : '+'}${usd(Math.abs(v), false)}`;
    return h('section', { class: 'bp-weather', 'aria-label': 'Weather spec' },
      h('div', { class: 'bp-weather-row' },
        h('span', { class: 'bp-weather-label', id: 'bp-weather-label' }, 'Weather:'),
        h('div', { class: 'bp-seg', role: 'radiogroup', 'aria-labelledby': 'bp-weather-label' }, seg('standard'), seg('extreme')),
        cmp.computed ? h('span', { class: 'bp-weather-chip', role: 'status' }, weatherChipText(cmp)) : ''),
      h('p', { class: 'muted small bp-weather-note' }, spec === 'standard'
        ? 'Standard: garage-kept, used a few times a year, wet at most at a rainy derby. 304 / 18-8 fasteners, zinc and galvanized hardware, beech Dominos, Titebond III, epoxy only where it earns it, exterior spar urethane.'
        : 'Extreme weather: stored outside, near salt, or exposed regularly. 316 throughout, Sipo Dominos, epoxy everywhere, a saturation coat on the plywood, marine spar varnish.',
        ` Thin sheet: ${thinName}.`),
      deltas.length
        ? h('details', { class: 'bp-weather-deltas', open: '' }, h('summary', {}, `Extreme minus Standard, by section (${cmp.deltaUsd < 0 ? '-' : '+'}${usd(Math.abs(cmp.deltaUsd), false)} in all)`),
            h('ul', { class: 'bp-plain bp-deltas' }, ...deltas.map(([id, v]) => h('li', {}, h('span', {}, titles.get(id) ?? id), h('strong', { class: v < 0 ? 'neg' : '' }, sign(v))))))
        : '');
  }

  function renderBom(d: BuildData): Node[] {
    const b = d.bom;
    const out: Node[] = [h('div', { class: 'bp-actions' }, csvButton('Download CSV', 'bom.csv', () => b.csv))];
    out.push(weatherBlock(b.spec, b.weatherCompare, b.sections, b.thinSheetName));
    const goTo = (id: string) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      el.focus({ preventScroll: true });
    };
    const jumpChip = (title: string, usdV: number, share: number, target: string) => {
      const chip = h('button', { type: 'button', class: 'bp-chip', title: `Jump to ${title}` },
        h('span', { class: 'muted' }, title), h('strong', {}, usd(usdV)), h('span', { class: 'muted small' }, `${pct(share)} estimate`));
      chip.addEventListener('click', () => goTo(`bp-bom-${target}`));
      return h('li', { class: 'bp-part' }, chip);
    };
    // Open decisions: each BOM line that carries a `decision` (an item that does not exist as specified, a spec change), as "item: what to decide".
    const byText = new Map<string, string[]>();
    for (const l of b.sections.flatMap((x) => x.lines)) if (l.decision) byText.set(l.decision, [...(byText.get(l.decision) ?? []), l.description]);
    if (byText.size) {
      out.push(h('aside', { class: 'bp-decisions', 'aria-label': 'Decisions needed' },
        h('h3', { class: 'bp-group' }, 'Decisions needed'),
        h('ul', { class: 'bp-plain' }, ...[...byText].map(([text, names]) => {
          const nl = noteLead(text, 160); // a short lead, the full text behind a fold; lines that share a decision are named together
          const lead = [h('strong', {}, names.join('; ')), ': ', ...linkified(nl.lead)];
          return h('li', {}, ...(nl.rest ? [h('details', { class: 'bp-more' }, h('summary', {}, ...lead, h('span', { class: 'bp-detlink' }, ' Details')), h('p', { class: 'small' }, ...linkified(nl.rest)))] : lead));
        }))));
    }
    const kinds = new Set(['touches']);
    out.push(h('div', { class: 'bp-total', role: 'status' },
      h('div', {}, h('span', {}, 'Total'), h('strong', {}, usd(b.totalUsd))),
      h('div', { class: 'small' }, b.totalsText),
      h('div', { class: 'muted small' }, b.shippingNote),
      h('ul', { class: 'bp-subtotals bp-parts', 'aria-label': 'Totals by kind (jump to a table)' },
        jumpChip('Build', b.coreUsd, b.coreEstimateShare, b.sections[0]?.id ?? 'lumber'),
        jumpChip('Finishing touches', b.touchesUsd, b.touchesEstimateShare, 'touches')),
      h('div', { class: 'muted small' }, `${pct(b.estimateShare)} of this is an estimate (${usd(b.estimateUsd)}); the rest is quoted from a vendor page (each with its link and date), by the model, or is $0 shop stock you already own (marked "shop stock"). Confirm prices before ordering.`),
      h('h3', { class: 'bp-group' }, 'Jump to a section'),
      h('ul', { class: 'bp-subtotals', 'aria-label': 'Subtotals by section (jump to a table)' },
        ...b.sections.filter((x) => !kinds.has(x.id)).map((x) => {
          const chip = h('button', { type: 'button', class: 'bp-chip', title: `Jump to ${x.title}` }, h('span', { class: 'muted' }, x.title), h('strong', {}, usd(x.subtotalUsd)));
          chip.addEventListener('click', () => goTo(`bp-bom-${x.id}`));
          return h('li', {}, chip);
        }))));
    /**
     * The item cell: name, then ONE short line (the first clause of the notes, or the pack count), then the rest of the notes behind a closed "Details" fold. A material note the table
     * shares is printed once above the table; a line shows its own only when it differs (inline for a warning, in the fold otherwise). Alternatives are a compact line of links.
     */
    const itemCell = (l: BomLine, shared: string | undefined): Node => {
      const packed = !!(l.packQty && l.packs);
      const packText = packed ? `need ${+(l.needed ?? 0).toFixed(2)} · ${l.packs} pack${l.packs === 1 ? '' : 's'} of ${l.packQty}${l.packUsd ? ` at ${usd(l.packUsd)}` : ''}` : '';
      const nl = l.notes ? noteLead(l.notes) : undefined;
      const lead = packed ? packText : nl?.lead ?? '';
      const rest: Node[] = [];
      if (packed && l.notes) rest.push(h('p', {}, ...linkified(l.notes)));
      else if (nl?.rest) rest.push(h('p', {}, ...linkified(nl.rest)));
      const ownMaterial = l.materialNote && !sameLead(l.materialNote, shared) ? l.materialNote : '';
      const mat = ownMaterial ? noteLead(ownMaterial) : undefined;
      const warn = !!mat && MATERIAL_WARN.test(mat.lead);
      if (mat && !warn) rest.push(h('p', {}, h('strong', {}, 'Material: '), ...linkified(ownMaterial)));
      const name = h('span', { class: 'bp-name' }, itemName(l.description, l.url));
      const leadEl = lead ? h('span', { class: 'bp-lead', title: lead }, ...linkified(lead)) : undefined;
      const head = rest.length
        ? h('details', { class: 'bp-more' },
            h('summary', { class: 'bp-item' }, name, ...(leadEl ? [leadEl] : []), h('span', { class: 'bp-det' }, 'Details')),
            h('div', { class: 'bp-rest muted small' }, ...rest))
        : h('div', { class: 'bp-item' }, name, ...(leadEl ? [leadEl] : []));
      const alts = altsOf(l);
      return h('div', {}, head,
        ...(mat && warn ? [h('div', { class: 'small bp-material' }, h('strong', {}, 'Material: '), mat.lead)] : []),
        ...(alts.length ? [h('div', { class: 'small bp-alts' }, h('strong', {}, 'Alternatives: '), ...alts.flatMap((a, i) => (i ? ['; ', altNode(a)] : [altNode(a)])))] : []));
    };
    const vendorCell = (l: BomLine): string | Node => {
      const url = isHttp(l.url) ? l.url : undefined;
      const name = l.vendor ?? (url ? vendorFromUrl(url) : '');
      if (!name) return '';
      return url ? extLink(`${name} ↗`, url) : name;
    };
    const bomTable = (title: string, lines: BomLine[], subtotal: number): Node[] => {
      const shared = sharedNote(lines.map((l) => l.materialNote));
      return [
        ...(shared ? [h('p', { class: 'muted small bp-prose bp-shared' }, h('strong', {}, 'Material, every line unless noted: '), shared)] : []),
        table('bp-bom', ['Item', 'Qty', 'Unit price', 'Basis', 'Vendor', 'Extended'],
          lines.map((l) => [
            itemCell(l, shared),
            `${l.qty % 1 ? l.qty.toFixed(2) : l.qty} ${l.unit}`, usd(l.unitUsd), l.basis === 'estimate' ? 'estimate' : l.basis === 'owned' ? 'shop stock' : 'quoted', vendorCell(l), h('strong', {}, usd(l.extUsd)),
          ]),
          title, { num: [1, 2, 5], nowrap: [4], qty: 1, end: 5, foot: [`${title} subtotal`, '', '', '', '', usd(subtotal)] }),
      ];
    };
    for (const s of b.sections) {
      out.push(h('h3', { class: 'bp-group bp-bom-head', id: `bp-bom-${s.id}`, tabindex: '-1' }, s.title, h('span', { class: 'muted' }, ` · ${usd(s.subtotalUsd)}`)));
      for (const t of s.notes ?? []) out.push(note(t, 'muted small bp-prose'));
      if (s.groups?.length) {
        const loose = s.lines.filter((l) => !l.group || !s.groups!.some((g) => g.id === l.group));
        if (loose.length) out.push(...bomTable(s.title, loose, loose.reduce((a, l) => a + l.extUsd, 0)));
        for (const g of s.groups) {
          const lines = s.lines.filter((l) => l.group === g.id);
          if (!lines.length) continue;
          out.push(h('h4', { class: 'bp-sub' }, g.title, h('span', { class: 'muted' }, ` · ${usd(g.subtotalUsd)}`)));
          out.push(...bomTable(g.title, lines, g.subtotalUsd));
        }
      } else out.push(...bomTable(s.title, s.lines, s.subtotalUsd));
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
    const partsById = new Map((design?.parts ?? []).map((x) => [x.id, x]));
    /** "12 mm okoume marine plywood", "1-1/2" white oak": the thickness is the part's stock thickness, the material its own words. */
    const stockOf = (id: string): string => {
      const x = partsById.get(id);
      if (!x) return '–';
      if (!x.stock) return x.material;
      // plywood is sold in millimeters (12 mm = 15/32", 4 mm = 5/32"); lumber in inches
      return /plywood/i.test(x.material) ? `${+(x.stock.t * 25.4).toFixed(1)} mm ${x.material}` : `${fracDim(x.stock.t)}" ${x.material}`;
    };
    for (const f of files) {
      const depth = maxDepth(f.features);
      cards.push(h('article', { class: 'bp-file', 'aria-label': f.fileName },
        svgBox(previewSvg(f.svg, `${f.partNo} Shaper file preview`)),
        h('div', { class: 'bp-file-head' }, h('strong', {}, f.partNo), h('span', { class: 'muted small' }, f.fileName)),
        h('dl', { class: 'bp-facts' },
          h('dt', {}, 'Stock'), h('dd', {}, stockOf(f.partId)),
          h('dt', {}, 'Size'), h('dd', {}, `${fracDim(f.widthIn)} × ${fracDim(f.heightIn)} in`),
          h('dt', {}, 'Qty'), h('dd', {}, f.qty > 1 ? `${f.qty} (${f.partIds.join(', ')})` : '1'),
          h('dt', {}, 'Cut face'), h('dd', {}, f.cutFaceMatters ? `${f.cutFace} up` : 'Either face up'),
          h('dt', {}, 'Bits'), h('dd', {}, f.bits.length ? f.bits.join(', ') : 'none'),
          ...(depth !== undefined ? [h('dt', {}, 'Depth'), h('dd', {}, `up to ${fracInch64(depth)}`)] : [])),
        ...(f.deepCut ? [h('p', { class: 'bp-deep small' }, h('strong', {}, 'Deep cut: '), 'finish with a bandsaw and a flush-trim bit (see the Shaper notes).')] : []),
        h('div', { class: 'small' }, featureSummary(f.features)),
        h('details', {}, h('summary', {}, 'Features and notes'),
          h('ul', { class: 'bp-plain small' }, ...f.features.map((x) => h('li', {}, `${x.kind}${x.count > 1 ? ` ×${x.count}` : ''}: ${x.label}${x.diaIn ? ` Ø${fracInch64(x.diaIn)}` : ''}${x.depthIn ? `, ${fracInch64(x.depthIn)} deep` : ''}`)))),
        h('div', { class: 'bp-actions' }, btn('Download SVG', () => download(f.fileName, SVG_MIME, f.svg), `Save ${f.fileName}`))));
    }
    out.push(h('div', { class: 'bp-grid' }, ...cards));
    return out;
  }

  function renderLaser(d: BuildData): Node[] {
    const files = d.laser;
    const out: Node[] = [];
    out.push(h('div', { class: 'bp-intro' },
      h('div', {}, h('h3', { class: 'bp-group' }, 'How to read the files'),
        h('ul', { class: 'bp-legend', 'aria-label': 'Laser conventions' }, ...LASER_CONVENTIONS.map((c) => h('li', {}, h('span', { class: 'bp-swatch', style: `background:${c.color}`, 'aria-hidden': 'true' }), h('span', {}, h('strong', {}, c.name), `: ${c.meaning}`)))),
        note(`${files.length} files, full size, SVG only. Pieces are laid out along the conveyor; the cut list says which sheet parts the laser can cut.`)),
      h('details', { class: 'bp-card' }, h('summary', {}, `Laser notes (${LASER_NOTES.length})`), h('ul', { class: 'bp-plain muted small' }, ...LASER_NOTES.map((x) => h('li', {}, x))))));
    const cards: Node[] = [];
    for (const f of files) {
      cards.push(h('article', { class: 'bp-file', 'aria-label': f.fileName },
        svgBox(previewSvg(f.svg, `${f.title} laser file preview`).replace(/stroke-width="1"/g, `stroke-width="${Math.max(1, Math.round(f.widthIn * 96 / 250))}"`)),
        h('div', { class: 'bp-file-head' }, h('strong', {}, f.title), h('span', { class: 'muted small' }, `laser/${f.fileName}`)),
        h('dl', { class: 'bp-facts' },
          h('dt', {}, 'Material'), h('dd', {}, `${f.material}`),
          h('dt', {}, 'File size'), h('dd', {}, `${fracDim(f.widthIn)} × ${fracDim(f.heightIn)} in`),
          h('dt', {}, 'Cut'), h('dd', {}, f.kind === 'part' ? (f.qty > 1 ? `${f.qty} (${f.source.join(', ')})` : '1') : `${f.pieces.length} piece${f.pieces.length === 1 ? '' : 's'}`),
          h('dt', {}, 'Bed'), h('dd', { class: f.fits ? 'bp-laser-yes' : 'bp-laser-no' }, f.fits ? 'fits' : f.verdict.text)),
        h('ul', { class: 'bp-plain small' }, ...f.notes.map((x) => h('li', {}, x))),
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
      const steps = f.build ?? [];
      cards.push(h('article', { class: 'bp-file bp-form', 'aria-label': f.title },
        h('div', { class: 'bp-form-pic' },
          svgBox(previewSvg(f.svg, `${f.title} preview`)),
          h('div', { class: 'bp-file-head' }, h('strong', {}, f.title), h('span', { class: 'muted small' }, f.fileName)),
          h('dl', { class: 'bp-facts' },
            h('dt', {}, 'Size'), h('dd', {}, `${fracDim(f.widthIn)} × ${fracDim(f.heightIn)} in`),
            h('dt', {}, 'Print'), h('dd', {}, `${pages} Letter page${pages === 1 ? '' : 's'} (${plan.cols} × ${plan.rows})`)),
          h('div', { class: 'bp-actions' },
            btn('Download full-size SVG', () => download(f.fileName, SVG_MIME, f.svg), `Save ${f.fileName}`),
            btn('Print tiled (Letter)', () => printTiles(tiles.pages), 'Print this drawing on Letter pages at true scale')),
          ...(f.laser?.length ? [h('p', { class: 'small' }, h('strong', {}, 'Laser: '), `${f.laser.map((l) => `laser/${l.id}.svg`).join(', ')} (see the Laser tab)`)] : [])),
        h('div', { class: 'bp-form-body' },
          ...(steps.length
            ? [h('h4', { class: 'bp-sub' }, 'How to make it'),
               h('ol', { class: 'bp-instr' }, ...steps.map((st) => h('li', {}, ...ui.text(st.step),
                 ...(st.sub?.length ? [h('ul', { class: 'bp-sublist' }, ...st.sub.map((x) => h('li', {}, ...ui.text(x))))] : []))))]
            : []),
          h('details', {}, h('summary', {}, 'Dimensions and notes'),
            h('ul', { class: 'bp-plain small' }, ...f.dims.map((x) => h('li', {}, `${x.label}: ${x.text}`)),
              ...f.notes.map((x) => h('li', { class: 'muted' }, x)))))));
    }
    out.push(h('div', { class: 'bp-forms' }, ...cards));
    return out;
  }

  /**
   * One dimensioned drawing per distinct cut (`part-drawings.ts`). They take seconds the first time, so the section shows a status line, draws after the paint and keeps the
   * result in `BuildData` for the popovers and the zip.
   */
  function renderDrawings(d: BuildData): Node[] {
    const slot = h('div', {});
    lazy(slot, 'Drawing the parts… (a few seconds the first time for each design)', () => {
      const sheets = d.partDrawings;
      const cards = sheets.map((sh) => {
        const open = h('button', { type: 'button', class: 'bp-preview-btn', 'aria-label': `Open ${sh.name} drawing large` }, svgBox(previewSvg(sh.svg, `${sh.name} drawing preview`)));
        open.addEventListener('click', () => ui.openDrawing(sheetView(sh, sh.partId), open));
        const view = btn('Open large', () => ui.openDrawing(sheetView(sh, sh.partId), view), `Open the ${sh.name} drawing`);
        return h('article', { class: 'bp-file bp-drawing', 'aria-label': sh.name },
          open,
          h('div', { class: 'bp-file-head' }, ui.chip(sh.partId, sh.name), h('span', { class: 'muted small' }, `Drawn at ${sh.scale}`)),
          h('dl', { class: 'bp-facts' }, h('dt', {}, 'Qty'), h('dd', {}, String(sh.qty))),
          ...(sh.makeNote ? [h('p', { class: 'small bp-make' }, sh.makeNote)] : []),
          h('div', { class: 'bp-actions' }, view, btn('Download SVG', () => download(drawingFileName(sh).split('/').pop() ?? 'drawing.svg', SVG_MIME, sh.svg), `Save the ${sh.name} drawing`)));
      });
      return [
        note(`${sheets.length} drawings, one per distinct cut: identical pieces share a drawing, and a left/right pair that differs only by a mirror shares one (MAKE 2). Balloon letters match the feature list on each. All of them are in the zip under drawings/.`, 'muted small bp-prose'),
        h('div', { class: 'bp-grid' }, ...cards),
      ];
    });
    return [slot];
  }

  function renderAssembly(d: BuildData): Node[] {
    const steps = d.steps;
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
    const lastN = steps.length ? steps[steps.length - 1].n : 0;
    const counterText = h('span', { 'aria-hidden': 'true' });
    // The counter is also the step jump: an invisible native <select> over the text (a picker on phones, a list on desktop).
    const jump = h('select', { class: 'bp-jump', 'aria-label': 'Jump to a step' }, ...steps.map((x) => h('option', { value: String(x.n) }, `${x.n}. ${x.title}`)));
    jump.addEventListener('change', () => go(Number(jump.value)));
    const counter = h('label', { class: 'bp-counter muted', title: 'Jump to a step' }, counterText, jump);
    const prev = btn('← Prev', () => go(steps[Math.max(0, stepIdx() - 1)].n), 'Previous step (left arrow)');
    const next = btn('Next →', () => go(steps[Math.min(steps.length - 1, stepIdx() + 1)].n), 'Next step (right arrow)', 'bp-primary');
    const viewNote = h('p', { class: 'muted small' });
    const tidy = (t: string): string => t.replace(/\s*\(verify\.ts\)/, ''); // a source file name means nothing to the builder

    /** "Check before moving on": real checkboxes on screen (ticks stay in this browser), blank printed boxes on paper. */
    const checkItem = (s: BuildStep, c: string, forPrint: boolean): Node => {
      if (forPrint) return h('li', {}, h('span', { class: 'bp-box', 'aria-hidden': 'true' }), c);
      const key = `${s.n}|${c}`;
      const cb = h('input', { type: 'checkbox' });
      cb.checked = stepChecks.has(key);
      cb.addEventListener('change', () => {
        if (cb.checked) stepChecks.add(key); else stepChecks.delete(key);
        saveStepChecks(stepChecks);
      });
      return h('li', {}, h('label', { class: 'bp-checkline' }, cb, h('span', {}, c)));
    };

    const detailNodes = (s: BuildStep, forPrint: boolean): Node[] => {
      const ids = s.partIds;
      const out: Node[] = [
        h('h3', { class: 'bp-step-title' }, `${s.n}. ${s.title}`, s.kind === 'build' ? '' : h('span', { class: 'bp-kind' }, s.kind)),
        ...(s.goal ? [h('p', { class: 'bp-goal' }, ...ui.text(s.goal))] : []),
        ids.length
          ? h('p', { class: 'small bp-step-parts' }, h('strong', {}, `Parts (${ids.length}): `), ui.chips(ids, forPrint ? ids.length : 8))
          : h('p', { class: 'muted small' }, 'No parts installed in this step.'),
        s.items?.length ? ui.instrList(s.items) : h('ol', { class: 'bp-instr' }, ...(s.instructions ?? []).map((t) => h('li', {}, tidy(t)))),
      ];
      if (s.clampCure) out.push(h('p', { class: 'bp-cure' }, h('strong', {}, 'Glue, clamp and cure: '), s.clampCure));
      else if (s.cure) out.push(h('p', { class: 'bp-cure' }, h('strong', {}, 'Cure: '), cureLine(s.cure)));
      if (s.checks.length) out.push(h('div', {}, h('strong', { class: 'small' }, 'Check before moving on'), h('ul', { class: 'bp-checkboxes' }, ...s.checks.map((c) => checkItem(s, c, forPrint)))));
      if (s.tools.length) out.push(h('p', { class: 'muted small' }, h('strong', {}, 'Tools: '), s.tools.join(', ')));
      return out;
    };

    /** Prev / Next / a jump: if the new step's title is above the visible part of its scroller (#build-main wide, the window narrow), bring it to the top, under the pinned bars. */
    const showStepTop = () => {
      const bar = detail.parentElement?.querySelector('.bp-stepnav');
      const clear = bar ? bar.getBoundingClientRect().bottom : 0;
      if (detail.getBoundingClientRect().top < clear + 2) detail.scrollIntoView({ block: 'start' });
    };

    let drawnStep = -1;
    /** Show the current step. `pinOnly`: only the 3D pin changed, so the step text (and the focus in it) stays as it is. */
    const update = (reframe: boolean, pinOnly = false) => {
      const i = stepIdx();
      const s = steps[i];
      if (!s) { emit(null); return; }
      stepN = s.n;
      saveStep(stepN);
      items.forEach((b, j) => { if (j === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
      if (items[i]) list.scrollTop = items[i].offsetTop - list.clientHeight / 2;
      counterText.textContent = (s.n === 0 ? `Step 0 · ${steps.length} steps in all ▾` : `Step ${s.n} of ${lastN} ▾`);
      jump.value = String(s.n);
      (prev as HTMLButtonElement).disabled = i === 0;
      (next as HTMLButtonElement).disabled = i === steps.length - 1;
      if (!pinOnly || drawnStep !== s.n) { ui.closeAll(); detail.replaceChildren(...detailNodes(s, false)); drawnStep = s.n; }
      const f = stepFocus(steps, s.n, reframe);
      const pinned = pin;
      viewNote.replaceChildren(pinned
        ? h('span', {}, `Showing ${pinned.ids.map((id) => partById(id)?.name ?? id).join(', ')} in the 3D viewer (use Explode if it is hidden inside other parts). `)
        : f?.visibleIds
          ? `The 3D viewer shows steps 0 to ${s.n}${s.partIds.length ? '; this step’s parts are highlighted' : ' (nothing new to install in this step)'}. Camera: ${s.view}.`
          : 'Preparation: nothing is installed yet, so the 3D viewer shows the finished sled for reference.');
      if (pinned) {
        const clear = btn('Back to this step’s parts', () => { pin = null; update(true, true); }, 'Highlight the parts this step installs again', 'bp-linkbtn');
        viewNote.append(clear);
      }
      emit(f && pinned ? pinFocus(f, pinned.ids, pinned.frame) : f);
      if (pinned) pinned.frame = false; // the camera is framed once; a parameter change keeps the view
    };
    const go = (n: number) => {
      stepN = n;
      pin = null; // a step change ends "Show in 3D"
      update(true);
      showStepTop();
    };
    stepUpdate = update;
    stepMove = (delta) => go(steps[Math.max(0, Math.min(steps.length - 1, stepIdx() + delta))].n);

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
    const out: Node[] = [h('p', { class: 'small bp-prose' }, `Finish area (net, glued faces taken off): ${f.areas.oakFt2.toFixed(0)} ft² oak, ${f.areas.plyFt2.toFixed(0)} ft² plywood (${f.areas.show.totalFt2.toFixed(0)} ft² show, ${f.areas.hidden.totalFt2.toFixed(0)} ft² hidden; ${f.areas.gross.totalFt2.toFixed(0)} ft² gross), ${f.areas.oakEndGrainFt2.toFixed(1)} ft² oak end grain. Quantities include ${pct(0.15)} waste.`)];
    out.push(h('p', { class: 'small bp-prose' }, h('strong', {}, `Weather spec: ${SPEC_NAME[f.spec]}. `), f.glue.adhesiveRule, ' Switch the weather setting in the BOM section or the parameters panel.'));
    out.push(h('h3', { class: 'bp-group' }, 'Shopping list'));
    out.push(table('bp-fin', ['Product', 'Notes', 'Buy'], mergeBuy(f.buy).map((b) => { const nl = noteLead(b.note, 120); return [h('strong', {}, b.item), nl.rest ? h('details', { class: 'bp-more small' }, h('summary', {}, nl.lead, h('span', { class: 'bp-detlink' }, ' Details')), h('p', { class: 'muted' }, nl.cut ? b.note : nl.rest)) : b.note, b.buy]; }), 'Finish products to buy', { num: [2] }));
    out.push(h('h3', { class: 'bp-group' }, 'Schedule'));
    const real = (v: string | undefined): string => (v && !/^[-–—\s]*$/.test(v) ? v : '');
    out.push(h('div', { class: 'bp-fin-steps' }, ...f.steps.map((s) =>
      h('article', { class: 'bp-card bp-finstep' },
        h('h4', { class: 'bp-sub' }, `${s.n}. ${s.title}`, s.coats ? h('span', { class: 'muted' }, ` · ${s.coats} coat${s.coats === 1 ? '' : 's'}`) : ''),
        s.items?.length ? ui.instrList(s.items) : h('ol', { class: 'bp-instr' }, ...(s.instructions ?? []).map((t) => h('li', {}, t))),
        s.products.length
          ? table('bp-fin', ['Product', 'Area', 'Coats', 'Qt'], s.products.map((p) => [p.name, `${p.areaFt2.toFixed(0)} ft²`, String(p.coats), p.qtNeeded.toFixed(2)]), `${s.title} products`, { num: [1, 2, 3] })
          : h('span', {}),
        ...(real(s.recoat) || real(s.cure)
          ? [h('p', { class: 'small' }, ...(real(s.recoat) ? [h('strong', {}, 'Recoat: '), real(s.recoat), ' '] : []), ...(real(s.cure) ? [h('strong', {}, 'Cure: '), real(s.cure)] : []))]
          : []),
        ...(real(s.winter) ? [h('p', { class: 'muted small' }, h('strong', {}, 'Winter shop: '), real(s.winter))] : [])))));
    if (f.assumptions.length) out.push(h('details', {}, h('summary', {}, 'Assumptions'), h('ul', { class: 'bp-plain small' }, ...f.assumptions.map((a) => h('li', {}, a)))));
    return out;
  }

  function renderDownloads(d: BuildData): Node[] {
    const out: Node[] = [h('div', { class: 'bp-actions' },
      btn('Download all (zip)', () => saveZip(d), 'Every file below in one zip', 'bp-primary'),
      btn('Open build book (print or save as PDF)', () => openBook(d), 'The whole build on paper, from the same data as this mode: opens in a new tab'))];
    // The file list includes the part drawings (seconds the first time), so it is drawn after the paint.
    const slot = h('div', {});
    lazy(slot, 'Preparing the files… (a few seconds the first time for each design)', () => {
      const files = d.files;
      return [
        note(`${files.length} files, generated from the design on screen (design revision ${d.revision}). The zip is uncompressed; open it with any unzip tool.`, 'muted small bp-prose'),
        table('bp-files', ['File', 'Size', ''], files.map((f) => {
          const size = typeof f.data === 'string' ? new TextEncoder().encode(f.data).length : f.data.length;
          return [h('span', { class: 'bp-fname' }, f.name), bytesLabel(size), btn('Save', () => download(f.name, f.mime, f.data), `Save ${f.name}`)];
        }), 'Package files', { num: [1] }),
      ];
    });
    out.push(slot);
    return out;
  }

  const RENDER: Record<SectionId, (d: BuildData) => Node[]> = {
    verify: renderVerify, cutlist: renderCutlist, nesting: renderNesting, bom: renderBom, shaper: renderShaper, laser: renderLaser,
    forms: renderForms, drawings: renderDrawings, assembly: renderAssembly, finishing: renderFinishing, downloads: renderDownloads,
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
        stepMove = null;
        pin = null;
        ui.closeAll();
        clearTiles();
        emit(null);
        root.removeAttribute('aria-busy');
      }
    },
  };
}
