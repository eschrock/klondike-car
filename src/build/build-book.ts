/**
 * The build book (Phase 4): ONE self-contained, printable HTML document with everything a builder needs at the bench and at the lumber yard.
 * Verify checklist, cut list, board shopping list, nesting drawings, BOM, assembly steps, finishing schedule and the Shaper file index, all
 * generated from the same `BuildData` the Build tab and the zip use, so the three never disagree. Inline CSS and inline SVG only: no scripts,
 * no fonts, no images, nothing fetched. It prints on Letter paper (File > Print, or save as PDF).
 *
 * Plain TS, no DOM. Every string that came from the model goes through `esc`.
 */
import { SHIPPING_TAX_PHRASE } from './bom';
import { PAGE_BIND_IN, PAGE_OUTER_IN } from './part-drawings';
import { widthListText } from './nesting';
import { FROM_TEXT, fabText, pieceText, stepsLabel } from './cutlist';
import { fractionText, roughFrac } from './units';
import { glueCard, PART_TOKEN_RE, partLabel, tokensIn, type Instr } from './assembly';
import { LASER_CONVENTIONS, LASER_NOTES, SHAPER_CONVENTIONS, SHAPER_NOTES, type BuildData } from './package';
import { SPEC_NAME, cureLine, dims3, esc, featureSummary, fracDim, fracInch, fracInch64, groupByWhen, groupCutsByBoard, lbDelta, maxDepth, pct, sheetSvg, usd, weatherLine } from '../ui/build-helpers';

const CSS = `
:root { color-scheme: light; --ink: #1b1b1b; --muted: #5c5c5c; --rule: #bdbdbd; --tint: #f1eee6; --accent: #7a4b00; }
* { box-sizing: border-box; }
html { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: var(--ink); background: #fff; font-size: 11pt; line-height: 1.4; }
body { margin: 0 auto; max-width: 8.5in; padding: 0.5in 0.6in; }
h1 { font-size: 22pt; margin: 0 0 4pt; }
h2 { font-size: 15pt; margin: 0 0 8pt; padding-bottom: 3pt; border-bottom: 2px solid var(--ink); }
h3 { font-size: 12pt; margin: 14pt 0 4pt; color: var(--accent); }
h4 { font-size: 11pt; margin: 10pt 0 3pt; }
p { margin: 4pt 0; }
section { margin-top: 22pt; }
.muted { color: var(--muted); }
.small { font-size: 9pt; }
nav ol { columns: 2; padding-left: 18pt; margin: 6pt 0; }
nav a { color: inherit; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 8pt; font-size: 9.5pt; }
th, td { border: 1px solid var(--rule); padding: 2.5pt 5pt; text-align: left; vertical-align: top; }
th { background: var(--tint); font-weight: 600; }
td.num, th.num { text-align: right; white-space: nowrap; }
td.dims, td.piece { white-space: nowrap; font-variant-numeric: tabular-nums; }
tr { break-inside: avoid; }
.box { display: inline-block; margin-right: 5pt; font-size: 1.5em; line-height: 1; vertical-align: -2pt; }
ul.checks { list-style: none; padding-left: 0; margin: 3pt 0; }
ul.checks li { margin: 2pt 0; }
.check, .step { break-inside: avoid; border-top: 1px solid var(--rule); padding-top: 6pt; margin-top: 8pt; }
.step:has(figure) { break-inside: auto; }
.step h3 { break-after: avoid; }
.title-page { text-align: center; padding: 1.6in 0 0; }
.title-page h1 { font-size: 30pt; margin: 0; }
.title-page .subtitle { font-size: 18pt; color: var(--muted); margin: 6pt 0 0.5in; }
.title-page img.cover { width: 100%; height: auto; }
.blank-page { display: none; }
nav.toc-check ol { columns: 1; list-style: none; padding-left: 0; }
nav.toc-check > ol > li { margin: 3pt 0; font-size: 11pt; }
nav.toc-check ol.toc-steps { columns: 2; column-gap: 18pt; list-style: none; padding-left: 22pt; margin: 2pt 0 4pt; font-size: 9pt; }
ol.toc-steps li { break-inside: avoid; margin: 1pt 0; }
.print-pick { border: 1px solid var(--rule); background: var(--tint); padding: 4pt 8pt; margin: 8pt 0; font-size: 9pt; }
.print-pick label { margin-right: 10pt; white-space: nowrap; }
.dref { font-size: 8.5pt; color: var(--accent); font-weight: 600; white-space: nowrap; }
.drawing, .form { margin-top: 10pt; }
.drawing figure.fig svg { max-height: 8.6in; }
.form figure.fig svg { max-height: 6in; }
#assembly .step > h3 { font-size: 14pt; color: var(--ink); }
#assembly .step > h3 .no { color: var(--accent); }
ul.parts { columns: 4; column-gap: 10pt; font-size: 8pt; list-style: none; padding-left: 0; margin: 2pt 0 6pt; }
ul.parts li { break-inside: avoid; }
table.index td.box-cell { width: 24pt; text-align: center; }
p, li { orphans: 3; widows: 3; }
ol.instr li:not(:has(li)) { break-inside: avoid; }
figure.fig { break-inside: avoid; margin: 6pt 0 8pt; }
figure.fig svg { display: block; width: 100%; height: auto; border: 1px solid var(--rule); }
figure.fig figcaption { margin-top: 2pt; }
.why { border-left: 3px solid var(--accent); padding: 2pt 7pt; margin: 4pt 0; }
.kind { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin-left: 6pt; font-weight: 400; }
.cure { background: var(--tint); border-left: 3px solid var(--accent); padding: 3pt 7pt; margin: 5pt 0; }
ol.instr { margin: 4pt 0 4pt 16pt; padding-left: 8pt; }
ol.instr li { margin: 2pt 0; }
ol.instr ul { margin: 1pt 0 2pt 12pt; padding-left: 6pt; list-style: disc; }
ol.instr ul ul { list-style: circle; }
.goal { font-style: italic; margin: 2pt 0 4pt; }
.also { color: var(--muted); font-size: 9pt; }
a.part { color: inherit; text-decoration: underline dotted; }
.sheet { break-inside: avoid; margin: 4pt 0 10pt; }
.sheet svg { width: 100%; height: auto; border: 1px solid var(--rule); }
.total { font-weight: 700; }
.legend span.sw { display: inline-block; width: 10pt; height: 10pt; margin-right: 5pt; vertical-align: -1pt; border: 1px solid #000; }
.sw.outside { background: #000; } .sw.inside { background: #fff; } .sw.pocket { background: #999; } .sw.guide { background: #fff; border-color: #0068ff !important; }
@page { size: Letter; margin: 0.45in ${PAGE_OUTER_IN}in 0.55in ${PAGE_BIND_IN}in; @bottom-right { content: "page " counter(page); font-size: 8pt; color: #555; } }
@page :left { margin-left: ${PAGE_OUTER_IN}in; margin-right: ${PAGE_BIND_IN}in; }
@media print {
  body { max-width: none; padding: 0; }
  html { font-size: 9.25pt; line-height: 1.25; }
  ol.instr li { margin: 1pt 0; }
  table.index { columns: 2; }
  a { color: inherit; }
  h2 { font-size: 13pt; } h3 { font-size: 11pt; margin-top: 8pt; }
  table { font-size: 8.5pt; } th, td { padding: 1.5pt 4pt; }
  .print-pick { display: none; }
  figure.fig svg { width: auto; max-width: 100%; max-height: 4in; margin: 0 auto; }
  .drawing figure.fig svg { max-width: 100%; max-height: 9in; height: auto; margin: 0; }
  .form figure.fig svg { max-height: 3.6in; }
  .drawing { break-inside: avoid; border-top: 1px solid var(--rule); padding-top: 4pt; }
  .check { break-inside: auto; }
  .check h4 { break-after: avoid; }
  #assembly, #boards { break-before: page; }
  #assembly .step, .form { break-inside: auto; }
  h2, h3, h4 { break-after: avoid; }
  .screen-only { display: none; }
  .title-page { page: title; break-after: page; }
  .blank-page { display: block; page: blank; height: 1pt; break-after: page; }
  header { break-after: page; }
  #finishing .step { break-inside: auto; }
  #finishing .step h4 { break-after: avoid; }
  a, a.part { text-decoration: none; }
  :root { --muted: #444; }
  .small, .also { font-size: 8.5pt; }
  #assembly .step { border-top: 2px solid var(--ink); }
  #assembly .step > h3 { break-after: avoid; }
  .why, .cure, .goal { break-inside: avoid; }
  .form h3 { break-after: avoid; }
}
`;

const td = (v: string | number, cls = ''): string => `<td${cls ? ` class="${cls}"` : ''}>${typeof v === 'number' ? v : v}</td>`;
const th = (v: string, cls = ''): string => `<th${cls ? ` class="${cls}"` : ''}>${v}</th>`;
const table = (head: Array<[string, string?]>, rows: string[][], cls = ''): string =>
  `<table${cls ? ` class="${cls}"` : ''}><thead><tr>${head.map(([h, c]) => th(h, c)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.join('')}</tr>`).join('')}</tbody></table>`;
const ul = (items: string[], cls = ''): string => `<ul${cls ? ` class="${cls}"` : ''}>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
/** An empty check box to tick with a pen. */
const box = (): string => '<span class="box" aria-hidden="true">\u2610</span>';
const num = (v: number, dp = 1): string => String(+v.toFixed(dp));
/** A link to a real vendor page: new tab, no opener. Only http(s) URLs become links (a vendor URL is data, not markup). */
const link = (url: string | undefined, text?: string): string => {
  if (!url || !/^https?:\/\//i.test(url)) return '';
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep the raw text */ }
  return `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text ?? host)}</a>`;
};

/** Part ids that have an anchor (`#part-<id>`) on their row in the cut list: the finished parts, the plywood and the metal. */
function anchoredIds(d: BuildData): Set<string> {
  const c = d.cutList;
  return new Set([...c.finished.flatMap((r) => r.ids), ...c.sheets.flatMap((g) => g.rows.flatMap((r) => r.ids)), ...c.metal.flatMap((r) => r.ids)]);
}
/** Anchors for the ids of one cut-list row (each id gets one anchor, on the first row that lists it). */
function anchors(ids: string[], seen: Set<string>): string {
  return ids.filter((id) => !seen.has(id) && (seen.add(id), true)).map((id) => `<span id="part-${esc(id)}"></span>`).join('');
}
type PartLink = (id: string, capital?: boolean) => string;
/** A part mention: its name, linked to its cut-list row when it has one. */
function partLinker(d: BuildData): PartLink {
  const byId = new Map(d.parts.map((x) => [x.id, x]));
  const anchored = anchoredIds(d);
  const drawing = drawingNumbers(d);
  return (id, capital = false) => {
    let name = partLabel(byId.get(id), id);
    if (capital) name = name[0].toUpperCase() + name.slice(1);
    const dn = drawing.byPart.get(id);
    if (dn) return `<a class="part" href="#drawing-${dn}">${esc(name)}</a> <span class="dref">[D${dn}]</span>`;
    return anchored.has(id) ? `<a class="part" href="#part-${esc(id)}">${esc(name)}</a>` : esc(name);
  };
}

/**
 * The part drawings in build order, numbered D1, D2 ... for paper cross-references: each step prints "[D12]" after a part that has a drawing.
 * A drawing's place is the first step that cuts or installs any of its parts (drawings no step names go last, by name).
 */
const DRAWING_NUMBERS = new WeakMap<BuildData, { order: BuildData['partDrawings']; byPart: Map<string, number>; stepOf: Map<number, number> }>();
function drawingNumbers(d: BuildData): { order: BuildData['partDrawings']; byPart: Map<string, number>; stepOf: Map<number, number> } {
  const hit = DRAWING_NUMBERS.get(d);
  if (hit) return hit;
  const firstStep = new Map<string, number>();
  for (const st of d.steps) for (const id of [...st.cutIds, ...st.partIds]) if (!firstStep.has(id)) firstStep.set(id, st.n);
  const stepOfSheet = (sh: BuildData['partDrawings'][number]): number => Math.min(...sh.partIds.map((id) => firstStep.get(id) ?? Infinity));
  // A plain board (no notch, hole or shape) needs no drawing on paper: its size is in the cut list, and the drawings section lists it by name.
  const order = d.partDrawings.filter((sh) => sh.features.length > 0).sort((a, b) => stepOfSheet(a) - stepOfSheet(b) || a.name.localeCompare(b.name));
  const byPart = new Map<string, number>();
  const stepOf = new Map<number, number>();
  order.forEach((sh, i) => { for (const id of sh.partIds) if (!byPart.has(id)) byPart.set(id, i + 1); stepOf.set(i + 1, stepOfSheet(sh)); });
  const out = { order, byPart, stepOf };
  DRAWING_NUMBERS.set(d, out);
  return out;
}
/** Instruction text as HTML: the text escaped, every `{{part-id}}` token a part link. */
function instrText(t: string, link: PartLink): string {
  let out = '';
  let last = 0;
  for (const m of t.matchAll(PART_TOKEN_RE)) {
    const at = m.index ?? 0;
    out += esc(t.slice(last, at));
    out += link(m[1], at === 0 || /[.!?]\s+$/.test(t.slice(0, at)));
    last = at + m[0].length;
  }
  return out + esc(t.slice(last));
}
/** The items as a numbered list with nested sub-bullets; parts an item names in plain words (not as tokens) follow it in small type, up to four. */
function instrList(items: Instr[], link: PartLink, top = true, seen?: Set<string>, tick = false): string {
  const li = (it: Instr): string => {
    // A part named in plain words is echoed in small type once per step (`seen`), not after every item that touches it.
    const extra = (it.parts ?? []).filter((id) => !tokensIn(it.text).includes(id) && !(seen?.has(id)));
    for (const id of [...extra, ...tokensIn(it.text)]) seen?.add(id);
    const also = extra.length && extra.length <= 4 ? ` <span class="also">(${extra.map((id) => link(id)).join(', ')})</span>` : '';
    // A task to tick: the top-level items of a step get a box (Eric 2026-10-24: "I love checklists"); their sub-bullets are details, with none.
    return `<li>${top && tick ? box() : ''}${instrText(it.text, link)}${also}${it.sub?.length ? instrList(it.sub, link, false, seen) : ''}</li>`;
  };
  return top ? `<ol class="instr">${items.map(li).join('')}</ol>` : `<ul>${items.map(li).join('')}</ul>`;
}

/** Ids and titles of the book's sections, in order (also the table of contents). */
export const BOOK_SECTIONS: Array<[string, string]> = [
  ['start', 'Start here'],
  ['verify', 'Verify checklist'],
  ['cutlist', 'Cut list'],
  ['nesting', 'Plywood nesting'],
  ['assembly', 'Assembly steps'],
  ['finishing', 'Finishing schedule'],
  ['forms', 'Forms and templates'],
  ['drawings', 'Part drawings'],
  ['shaper', 'Shaper Origin file index'],
  ['laser', 'Laser (XTool S1) file index'],
  ['boards', 'Board shopping list'],
  ['bom', 'Bill of materials'],
];
/** Sections a builder who has bought the lumber can leave out of the printout (ticked on the first page; plain CSS, no script). */
const SKIPPABLE: ReadonlySet<string> = new Set(['verify', 'finishing', 'forms', 'drawings', 'shaper', 'laser', 'boards', 'bom']);


/** Section number of a book section, for "see section N" on paper. */
const secNo = (id: string): number => BOOK_SECTIONS.findIndex(([k]) => k === id) + 1;

/** The front page for a builder who has the lumber: what to measure first, what else to print, and how the book cross-references. */
function startSection(d: BuildData): string {
  const out: string[] = [];
  const forms = d.forms.map((f) => {
    const t = d.tiles.find((x) => x.id === f.id);
    return `<li>${esc(f.title)}: ${f.id === 'side-form' ? `<strong>print its ${t?.pages.length ?? 0} tiled pages</strong> (the 3/4" MDF ramp ribs are traced from them)` : f.laser?.length ? 'laser-cut; no printing' : `${t?.pages.length ?? 0} tiled pages`}.</li>`;
  });
  out.push('<h3>1. Before the first cut, now that the lumber is home</h3>');
  out.push(`<ol class="instr">
<li>Let the oak and plywood sit in the shop a week, stickered, then check the oak with a moisture meter: 6% to 9% is ready.</li>
<li>Do the "Before cutting" checks in section ${secNo('verify')}.</li>
<li>If a measured number differs from the design (the plywood thickness most of all: the dado widths and the Shaper and laser files follow it), change it in the app and download a fresh build package before you cut anything. The revision at the foot of every page tells two printouts apart.</li>
<li>The board plan in section ${secNo('boards')} is an example layout for boards of the sizes it lists. Your boards will differ: lay the cuts in section ${secNo('cutlist')} out on the boards you have, longest and widest first.</li>
<li>Hardware not yet bought: do its "Before ordering" checks in section ${secNo('verify')} before you order it.</li>
<li>The jigs and templates need stock the bill of materials does not list (MDF, a plywood bench top, hardboard, offcuts for cleats, 1/4" Baltic birch for the laser patterns, play sand): each jig's list is in section ${secNo('forms')}.</li>
</ol>`);
  out.push('<h3>2. What else to print, and what to load</h3>');
  out.push(`<ul>
<li><strong>This book.</strong> The part drawings (section ${secNo('drawings')}) locate every notch, hole and mortise of the hand-made parts. The parts cut on the Shaper or the laser (the deck, the webs, the transom, the bulkhead, the seat back, the grab boards and caps, the flaps) have their features in their files instead; the app shows each one dimensioned.</li>
<li><strong>The full-size forms</strong> (from the build package zip; files, stock and key sizes in section ${secNo('forms')}). Print tiles on Letter at 100% scale (never "fit to page") and measure the 1" check square on every page; check each laser-cut pattern with a tape against its key dimensions.<ul>${forms.join('')}</ul></li>
<li><strong>Machine files, not printed:</strong> <code>shaper/</code> for the Shaper Origin (section ${secNo('shaper')}), <code>laser/</code> for the XTool S1 (section ${secNo('laser')}), <code>stl/</code> for the 3D-printed lamp clips (print in ASA).</li>
</ul>`);
  out.push('<h3>3. How the book cross-references</h3>');
  out.push(`<ul>
<li>The step index at the start of section ${secNo('assembly')} is the checklist of every step.</li>
<li class="screen-only">To print less: the box above the contents on the first page leaves sections out (the shopping lists are at the back; with the lumber bought, the bill of materials is only needed for the hardware).</li>
<li>A part name followed by a drawing number, like <span class="dref">[D12]</span>, has a dimensioned drawing under that number in section ${secNo('drawings')}. The drawings are in build order.</li>
<li>Sizes are in the cut list (section ${secNo('cutlist')}); each part's row there names the steps that cut and fit it. The finishing steps are numbered F1, F2 ... in section ${secNo('finishing')}.</li>
</ul>`);
  return out.join('');
}

/** Each form and template: what it is for, how to build it, its full-size and tiled files and its laser file. */
function formsSection(d: BuildData): string {
  const link = partLinker(d);
  const out: string[] = [`<p class="muted small">The jigs and templates the steps use: their files, the stock to gather and the key sizes. Build from the full-size file, its tiled pages or the laser file; the step that builds a jig gives its instructions.</p>`];
  const plain = (t: string): string => t.replace(PART_TOKEN_RE, '').replace(/\s+/g, ' ').trim();
  const flat = (items: Instr[]): string[] => items.flatMap((q) => [plain(q.text), ...flat(q.sub ?? [])]);
  const stepText = d.steps.map((st) => ({ n: st.n, text: flat(st.items).join(' ') }));
  for (const f of d.forms) {
    const t = d.tiles.find((x) => x.id === f.id);
    out.push(`<div class="form" id="form-${esc(f.id)}"><h3>${esc(f.title)}</h3>`);
    out.push(`<p class="small">Full size ${fracDim(f.widthIn)} × ${fracDim(f.heightIn)}: <code>forms/${esc(f.fileName)}</code>, or ${t?.pages.length ?? 0} Letter pages in <code>forms/tiled/${esc(f.id)}-*.svg</code>.${f.laser?.length ? ` Laser: ${f.laser.map((l) => `<code>laser/${esc(l.id)}.svg</code> (${esc(l.material)})`).join(', ')}.` : ''}</p>`);
    if (f.materials?.length) out.push(`<h4>Materials for this jig</h4>${ul(f.materials.map(esc), 'small')}`);
    if (f.dims.length) out.push(`<h4>Key dimensions</h4>${ul(f.dims.map((x) => `${esc(x.label)}: ${esc(x.text)}`), 'small')}`);
    // The build text lives in the step that builds the jig (the side and rail forms); a template no step spells out keeps its own steps here.
    const quotedAt = f.build?.length ? stepText.find((st) => st.text.includes(plain(f.build[0].step).slice(0, 50)))?.n : undefined;
    if (quotedAt !== undefined) out.push(`<p class="small">How to build it: step ${quotedAt}.</p>`);
    else if (f.build?.length) out.push(`<h4>How to make it</h4><ol class="instr">${f.build.map((st) => `<li>${box()}${instrText(st.step, link)}${st.sub?.length ? `<ul>${st.sub.map((x) => `<li>${instrText(x, link)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>`);
    out.push('</div>');
  }
  return out.join('');
}

/** A part drawing taller than this (in) is shrunk to fit the printed page (`.drawing` max-height): it says so. */
const TALL_SHEET_IN = 9;
/** Every dimensioned part drawing, D1 ... in build order. */
function drawingsSection(d: BuildData): string {
  const { order, stepOf } = drawingNumbers(d);
  const plain = d.partDrawings.filter((sh) => sh.features.length === 0).map((sh) => sh.name).sort();
  const out: string[] = [`<p class="muted small">${order.length} drawings, one per distinct cut, in build order.${plain.length ? ` Plain boards with no notch, hole or shaping have no drawing here; their sizes are in the cut list: ${esc(plain.join(', '))}.` : ''}`];
  out.push(`<p class="muted small"> Identical pieces share a drawing; a left/right pair that differs only by a mirror shares one (MAKE 2). Balloon letters match the feature list on each drawing. The dimensions are what count: the drawings are scaled to fit the page.</p>`);
  order.forEach((sh, i) => {
    const st = stepOf.get(i + 1);
    out.push(`<div class="drawing" id="drawing-${i + 1}"><h3>D${i + 1}. ${esc(sh.name)} <span class="muted small">· make ${sh.qty}${st !== undefined && Number.isFinite(st) ? ` · step ${st}` : ''}</span></h3>`);
    // At its true size: a sheet is drawn to fit the 7-1/2" page width, so it prints 1:1 with its text at the size it was drawn (a sheet taller than the page is scaled to fit).
    const tall = sh.heightIn > TALL_SHEET_IN ? `<p class="muted small">Shrunk to fit the page (the sheet is ${fracDim(sh.heightIn)} tall): open it in the app's Drawings tab to read it full size.</p>` : '';
    out.push(`<figure class="fig">${sh.svg.replace(/<\?xml[^?]*\?>/, '').replace(/\swidth="[^"]*"\sheight="[^"]*"/, ` style="width:${sh.widthIn.toFixed(3)}in"`)}</figure>${tall}</div>`);
  });
  return out.join('');
}

function verifySection(d: BuildData): string {
  const out: string[] = ['<p class="muted small">Test these before you spend money or cut wood. Tick each box when the check passes. Each check covers parts and design numbers we are not sure of yet.</p>'];
  const link = partLinker(d);
  for (const g of groupByWhen(d.verify)) {
    out.push(`<h3>${esc(g.when.replace(/^./, (c) => c.toUpperCase()))}</h3>`);
    for (const c of g.checks) {
      out.push(`<div class="check"><h4>${box()}${c.n}. ${esc(c.title)}</h4>` +
        `<p><strong>How to check</strong></p>${instrList(c.how, link)}<p><strong>Pass</strong></p>${ul(c.passList.map(esc))}<p><strong>If it fails:</strong> ${esc(c.ifFails)}</p>` +
        '</div>');
    }
  }
  return out.join('');
}

function cutlistSection(d: BuildData): string {
  const c = d.cutList;
  const out: string[] = [`<p class="muted small">Three steps: saw the CUTS from the boards (rough sizes round up to 1/8"), GLUE UP the panels and blocks, then MILL each part to its FINISHED size. Sizes are thickness × width × length in inches. Step is the number of the assembly step (section ${secNo('assembly')}) that fits the part, on the cuts as well as the finished parts; "cut 13 · fit 14" means it is cut to its final size at step 13 and fitted at step 14.</p>`];
  const seen = new Set<string>();
  const finishedOf = new Map(c.finished.flatMap((f) => f.ids.map((id) => [id, f] as const)));
  if (c.warnings.length) out.push(`<p class="small"><strong>Data warnings:</strong></p>${ul(c.warnings.map(esc), 'small')}`);

  out.push('<h3>1. Cuts: saw these from the boards</h3>');
  for (const g of groupCutsByBoard(c.cuts)) {
    const pieces = g.cuts.reduce((a, x) => a + x.qty, 0);
    out.push(`<h4>${esc(g.board)} boards <span class="muted">· ${pieces} piece${pieces === 1 ? '' : 's'}</span></h4>`);
    const noteFrom = new Map<string, string>();
    out.push(table([['', 'box-cell'], ['Cut'], ['Qty', 'num'], ['Rough T × W × L'], ['Piece'], ['Step', 'num'], ['Note']], g.cuts.map((x) => {
      const note = x.note ?? '';
      const first = noteFrom.get(note);
      const shown = note && first ? `Same note as ${first}.` : note;
      if (note && !first) noteFrom.set(note, x.label);
      const fin = finishedOf.get(x.partId);
      return [
        td(box(), 'box-cell'), td(`${esc(x.label)}${x.glueUp ? `<div class="muted small">glued into the ${esc(x.glueUp)}</div>` : ''}`), td(x.qty, 'num'), td(esc(x.roughText), 'dims'), td(esc(pieceText(x)), 'piece'), td(fin ? esc(stepsLabel(fin)) : '', 'num'), td(esc(shown)),
      ];
    })));
  }
  if (!c.cuts.length) out.push('<p class="small">No solid-wood cuts in this design.</p>');

  if (c.resaw.length) {
    out.push('<h4>Resawing the strips</h4>');
    for (const pool of c.resaw) {
      out.push(`<p class="small"><strong>${pool.strips} strips, ${roughFrac(pool.roughT)} rough, from ${pool.boards} × ${esc(pool.board)} board${pool.boards === 1 ? '' : 's'}</strong> (${fractionText(pool.boardWidthIn, 8)}" wide × ${pool.boardLengthIn / 12} ft, ${+pool.boardFeet.toFixed(1)} board feet).</p>` +
        ul([
          `${esc(pool.ripText[0].toUpperCase() + pool.ripText.slice(1))}: ${esc(pool.laneCountText)}.`,
          `Then resaw each lane on edge into ${pool.stripsPerBoard} slab${pool.stripsPerBoard === 1 ? '' : 's'}: ${esc(pool.resawHeightText)}.`,
          `${pool.stripSlots} strips come out for the ${pool.strips} needed: ${pool.sparesText}.`,
        ], 'small'));
    }
  }

  out.push('<h3>2. Glue-ups</h3>');
  if (c.glueUps.length) {
    out.push(table([['', 'box-cell'], ['Glue-up'], ['Qty', 'num'], ['From'], ['Rough block T × W × L'], ['Then mill to T × W × L']], c.glueUps.map((g) => [
      td(box(), 'box-cell'), td(`${esc(g.label)}<div class="small">${esc(g.note.split(';')[0].replace(/^./, (ch) => ch.toUpperCase()))}</div>`), td(g.qty, 'num'), td(`${g.from} piece${g.from === 1 ? '' : 's'}`), td(esc(g.roughBlockText), 'dims'), td(esc(g.finalText), 'dims'),
    ])));
  } else out.push('<p class="small">Nothing is glued up in this design.</p>');

  out.push('<h3>3. Finished parts: mill to these sizes</h3>');
  out.push(table([['', 'box-cell'], ['Part'], ['Qty', 'num'], ['Final T × W × L'], ['From'], ['Board'], ['Grain'], ['Fabrication'], ['Step', 'num']], c.finished.map((f) => [
    td(box(), 'box-cell'), td(`${anchors(f.ids, seen)}${esc(f.name)}`), td(f.qty, 'num'), td(esc(f.finalText), 'dims'), td(esc(FROM_TEXT[f.from] ?? f.from)), td(esc(f.board)), td(esc(f.grainWord ?? '')), td(esc(fabText(f.fab))), td(esc(stepsLabel(f)), 'num'),
  ])));

  out.push('<h3>Plywood</h3>');
  for (const g of c.sheets) {
    out.push(`<h4>${esc(g.label)} <span class="muted">· ${g.pieces} pieces</span></h4>`);
    out.push(table([['', 'box-cell'], ['Part'], ['Qty', 'num'], ['Final T × W × L'], ['Grain'], ['Fabrication'], ['Laser'], ['Step', 'num']], g.rows.map((r) => [
      td(box(), 'box-cell'), td(`${anchors(r.ids, seen)}${esc(r.name)}${r.note ? `<div class="small"><strong>${esc(r.note)}</strong></div>` : ''}`), td(r.qty, 'num'), td(dims3(r.final), 'dims'), td(esc(r.grainWord ?? '')), td(esc(fabText(r.fab))), td(esc(r.laser.text)), td(esc(stepsLabel(r)), 'num'),
    ])));
  }
  out.push('<h3>Metal stock</h3>');
  out.push(table([['', 'box-cell'], ['Part'], ['Qty', 'num'], ['Stock'], ['Cut length', 'num'], ['Step', 'num']], c.metal.map((r) => [
    td(box(), 'box-cell'), td(`${anchors(r.ids, seen)}${esc(r.name)}`), td(r.qty, 'num'), td(esc(r.section)), td(fracInch(r.cutLengthIn), 'num'), td(esc(stepsLabel(r)), 'num'),
  ])));
  return out.join('');
}

function boardsSection(d: BuildData): string {
  const o = d.oak;
  const nameOf = (id: string): string => partLabel(d.parts.find((x) => x.id === id), id);
  const out: string[] = ['<p class="muted small">Take this page to the lumber yard. Boards are rough, kiln-dried white oak; ask for the thick boards first, then see what is left for the thinner parts. Widths shown are minimums.</p>'];
  out.push('<h3>Oak to buy, by width</h3>');
  out.push(table([['Thickness'], ['Width and linear feet']], o.thicknesses.map((t) => [td(`<strong>${esc(t.board)}</strong>`), td(widthListText(t).map(esc).join('<br>'))])));
  out.push('<p class="muted small">Each piece\'s width is rounded up to a whole inch and the lengths include the saw kerf. Take any board at least that wide and at least as long as the longest piece; boards of any length add up to the total, and a wider board rips down to the narrower widths. Add a little for defects.</p>');
  out.push('<h3>Oak boards to buy</h3>');
  out.push(table([['Thickness'], ['Buy'], ['Net bf', 'num'], [`+${Math.round(o.wasteAllowance * 100)}%`, 'num'], ['Boards bf', 'num']], [
    ...o.thicknesses.map((t) => [td(`<strong>${esc(t.board)}</strong><div class="muted small">${t.pieces} pieces</div>`), td(t.summary.map(esc).join('<br>')), td(num(t.netBf), 'num'), td(num(t.allowanceBf), 'num'), td(num(t.plannedBf), 'num')]),
    [td('<strong>Total</strong>'), td(''), td(num(o.netBf), 'num'), td(num(o.allowanceBf), 'num'), td(num(o.purchaseBf), 'num')],
  ]));
  if (o.glueUps.length) out.push(`<p class="small">Wider than a board, so edge-glue pieces: ${esc([...new Set(o.glueUps.map(nameOf))].join(', '))}.</p>`);
  if (o.laminated.length) out.push(`<p class="small">Too thick for any board the yard stocks, so face-laminated from the boards above: ${esc([...new Set(o.laminated.map((q) => `${nameOf(q.id)} (${q.lamination.text})`))].join('; '))}.</p>`);
  const sheets = new Map<string, number>();
  for (const s of d.nest.sheets) { const k = `${s.label}|${s.widthIn}|${s.lengthIn}`; sheets.set(k, (sheets.get(k) ?? 0) + 1); }
  out.push('<h3>Plywood to buy</h3>');
  out.push(ul([...sheets.entries()].map(([k, n]) => { const [label, w, l] = k.split('|'); return `${n} × ${esc(label)}, ${+w / 12} × ${+l / 12} ft sheet`; })));
  out.push('<h3>Where each solid piece comes from</h3>');
  for (const t of o.thicknesses) {
    t.boards.forEach((b, i) => {
      out.push(`<h4>${esc(t.board)} board ${i + 1}: ${b.lengthIn / 12} ft × 6"</h4>`);
      out.push(table([['Lane width', 'num'], ['Cuts (width × length)'], ['Used', 'num']], b.lanes.map((l) => [
        td(roughFrac(l.widthIn), 'num'),
        td(l.cuts.map((c) => `${esc(nameOf(c.id))}${c.layer ? `, layer ${c.layer} of ${c.layers}` : ''}${c.fromBoard ? ` (milled down from ${esc(t.board)} for ${esc(c.fromBoard)})` : ''}: ${roughFrac(c.widthIn)} × ${roughFrac(c.lengthIn)}`).join('; ')),
        td(`${roughFrac(l.usedIn)} of ${b.lengthIn}"`, 'num'),
      ])));
    });
    for (const r of t.resawBoards) {
      const pool = o.resaw[r.pool];
      out.push(`<h4>${esc(t.board)} resaw: ${r.count} × ${r.widthIn}" wide × ${r.lengthIn / 12} ft</h4>`);
      out.push(`<p class="small">${pool.strips} strips of ${roughFrac(pool.roughT)} rough (${esc([...new Set(pool.laneStrips.flat().map((s) => nameOf(s.id)))].join(', '))}); the boards yield ${r.yieldText.replace(/ per board$/, '')} strips (${pool.stripSlots} in all), so ${pool.sparesText}.</p>`);
    }
  }
  return out.join('');
}

function nestingSection(d: BuildData): string {
  const n = d.nest;
  const out: string[] = ['<p class="muted small">True-shape part outlines on full 4 × 8 sheets (the arrow is the grain; the dashed box is the largest offcut). The side webs are drawn unrolled to their flat development.</p>'];
  for (const s of n.sheets) {
    out.push(`<div class="sheet"><h3>${esc(s.label)}, sheet ${s.index} <span class="muted">· ${s.utilizationPct.toFixed(1)}% used</span></h3>${sheetSvg(s)}`);
    out.push(`<p class="small muted">Largest offcut ${fracDim(s.offcut.largest.widthIn)} × ${fracDim(s.offcut.largest.heightIn)} in. Parts: ${esc(s.placements.map((q) => `${q.name} ${fracDim(q.widthIn)} × ${fracDim(q.heightIn)}${q.rotation ? ', turned 90°' : ''}`).join('; '))}.</p></div>`);
  }
  if (n.unplaced.length) out.push(`<p><strong>Did not fit:</strong> ${esc(n.unplaced.join(', '))}</p>`);
  if (n.grainTurned.length) out.push(`<p><strong>Grain turned across:</strong> ${esc(n.grainTurned.map((g) => g.name).join(', '))}</p>`);
  return out.join('');
}

function bomSection(d: BuildData): string {
  const b = d.bom;
  const cmp = b.weatherCompare;
  const out: string[] = [];
  if (cmp.computed) {
    out.push(`<p><strong>Weather spec: ${esc(SPEC_NAME[b.spec])}.</strong> ${esc(weatherLine(cmp).replace(/^Weather spec: [^.]*\. /, ''))}</p>`);
    const secTitle = new Map(b.sections.map((x) => [x.id as string, x.title]));
    out.push(table([['Section'], ['Extreme minus Standard', 'num']], [
      ...Object.entries(cmp.deltaBySection).filter(([, v]) => Math.abs(v) >= 0.005).map(([id, v]) => [td(esc(secTitle.get(id) ?? id)), td(`${v < 0 ? '-' : '+'}${usd(Math.abs(v))}`, 'num')]),
      [td('<strong>Total</strong>'), td(`<strong>${cmp.deltaUsd < 0 ? '-' : '+'}${usd(Math.abs(cmp.deltaUsd))}</strong> (${lbDelta(cmp.deltaLb)})`, 'num')],
    ]));
  }
  out.push(`<p class="muted small">${esc(b.totalsText)}. ${pct(b.estimateShare)} of the total is an estimate (${usd(b.estimateUsd)}), the rest quoted by the model or by a vendor list, or $0 shop stock you already own (marked "shop stock"; keep them on the list so you do not forget them). Prices are 2026 US retail guesses until you get quotes; the research notes behind each line are in the app's BOM and in bom.csv. Small parts sold in big packs (screws, nuts, washers, inserts, plugs) are priced by the whole pack: you may already have them in the shop. The finishing touches (lights, seat cushions, reflectors, tie-downs) are priced as their own section so you can build with or without them.</p>`);
  const matSeen = new Set<string>();
  const lineRow = (l: BuildData['bom']['sections'][number]['lines'][number]): string[] => [
    // On paper: what to buy and where. The price research (notes, alternatives, material notes) stays in the app's BOM and bom.csv.
    td(`${esc(l.description)}${l.vendor || l.url ? `<div class="muted small">${esc(l.vendor ?? '')}${l.url ? ` · ${link(l.url)}` : ''}</div>` : ''}${l.materialNote && !matSeen.has(l.materialNote) && matSeen.add(l.materialNote) ? `<div class="small"><strong>Material:</strong> ${esc(l.materialNote)}</div>` : ''}`),
    td(`${l.qty % 1 ? l.qty.toFixed(2) : l.qty} ${esc(l.unit)}${l.packs !== undefined ? `<div class="muted small">need ${num(l.needed ?? 0, 2)}, ${l.packs} pack${l.packs === 1 ? '' : 's'} of ${num(l.packQty ?? 0, 2)} at ${usd(l.packUsd ?? 0)}</div>` : ''}`, 'num'), td(usd(l.unitUsd), 'num'), td(`${usd(l.extUsd)}${l.basis === 'estimate' ? ' est.' : l.basis === 'owned' ? ' shop stock' : ''}`, 'num'),
  ];
  for (const s of b.sections) {
    matSeen.clear(); // a material note prints once per section, on its first line
    out.push(`<h3>${esc(s.title)} <span class="muted">· ${usd(s.subtotalUsd)}</span></h3>`);
    const rows: string[][] = [];
    if (s.groups) {
      for (const g of s.groups) {
        const ls = s.lines.filter((l) => l.group === g.id);
        if (!ls.length) continue;
        rows.push([`<td colspan="4"><strong>${esc(g.title)}</strong></td>`]);
        rows.push(...ls.map(lineRow));
        rows.push([td(`<em>${esc(g.title)} subtotal</em>`), td(''), td(''), td(`<em>${usd(g.subtotalUsd)}</em>`, 'num')]);
      }
    } else rows.push(...s.lines.map(lineRow));
    rows.push([td(`<strong>${esc(s.title)} subtotal</strong>`), td(''), td(''), td(`<strong>${usd(s.subtotalUsd)}</strong>`, 'num')]);
    out.push(table([['Item'], ['Qty', 'num'], ['Unit', 'num'], ['Ext.', 'num']], rows));
    for (const n of s.notes ?? []) out.push(`<p class="muted small">${esc(n)}</p>`);
  }
  out.push(`<p class="total">${esc(b.totalsText)}</p>`);
  out.push(`<p class="total">Grand total ${usd(b.totalUsd)} (${esc(SHIPPING_TAX_PHRASE)})</p>`);
  out.push(`<p class="muted small">${esc(b.shippingNote)}</p>`);
  if (b.unpriced.length) out.push(`<p><strong>No price:</strong> ${esc(b.unpriced.join(', '))}</p>`);
  return out.join('');
}

function assemblySection(d: BuildData): string {
  const nameOf = new Map(d.parts.map((x) => [x.id, x.name]));
  const link = partLinker(d);
  const out: string[] = ['<p class="muted small">Do the steps in order. Cure blocks give the epoxy pot life, clamp time and full-cure time; in a cold shop allow longer. Tick each check before you move on.</p>'];
  // The glue card: one box before the steps; every glue step's cure line points back to it.
  const card = glueCard(d.p);
  out.push(`<div class="step glue-card" id="glue-card"><h3>Glue card</h3><p class="small">${esc(card.text.replace(/^GLUE CARD\s*/, ''))}</p>${instrList(card.sub ?? [], link)}</div>`);
  for (const s of d.steps) {
    if (s.id === 'verify') continue; // step 0 is its index row and the Verify section (section 2)
    const listing = s.partIds.map((id) => nameOf.get(id) ?? id);
    out.push(`<div class="step" id="step-${s.n}"><h3><span class="no">Step ${s.n}.</span> ${esc(s.title)}${s.kind === 'build' ? '' : `<span class="kind">${esc(s.kind)}</span>`}</h3>`);
    if (listing.length > 8) out.push(`<p class="small"><strong>Parts (${listing.length}):</strong></p><ul class="parts small">${listing.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
    else if (listing.length) out.push(`<p class="small"><strong>Parts (${listing.length}):</strong> ${esc(listing.join(', '))}</p>`);
    if (s.goal) out.push(`<p class="goal">${esc(s.goal)}</p>`);
    // On paper the purpose line is kept for the jig and process steps, where the parts do not say it (a build step's goal line does).
    if (s.why && s.kind !== 'build') out.push(`<p class="why"><strong>What this is for:</strong> ${esc(s.why)}</p>`);
    if (s.plan) out.push(`<p class="cure"><strong>Plan the days:</strong> ${esc(s.plan)}</p>`);
    if (s.tools.length) out.push(`<p class="small"><strong>You will need:</strong> ${esc(s.tools.join(', '))}</p>`);
    for (const f of s.figures ?? []) out.push(`<figure class="fig">${f.svg.replace(/<\?xml[^?]*\?>/, '').replace(/\swidth="[^"]*"\sheight="[^"]*"/, ' width="100%"')}<figcaption class="small"><strong>${esc(f.title)}.</strong> ${esc(f.caption)}</figcaption></figure>`);
    out.push(s.items?.length ? instrList(s.items, link, true, new Set(), true) : `<ol class="instr">${s.instructions.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`);
    if (s.clampCure) out.push(`<p class="cure"><strong>Glue, clamp and cure:</strong> ${esc(s.clampCure)}</p>`);
    else if (s.cure) out.push(`<p class="cure"><strong>Cure:</strong> ${esc(cureLine(s.cure))}</p>`);
    if (s.checks.length) out.push(`<p class="small"><strong>Check before moving on</strong></p><ul class="checks">${s.checks.map((c) => `<li>${box()}${esc(c.replace(/:\s*passed$/i, ''))}</li>`).join('')}</ul>`);
    out.push('</div>');
  }
  return out.join('');
}

function finishingSection(d: BuildData): string {
  const f = d.finishing;
  const out: string[] = [`<p class="small"><strong>Weather spec: ${esc(SPEC_NAME[f.spec])}.</strong> ${esc(f.glue.adhesiveRule)}</p>`, `<p class="small">Finish area (net, glued faces taken off): ${f.areas.oakFt2.toFixed(0)} ft² oak, ${f.areas.plyFt2.toFixed(0)} ft² plywood (${f.areas.show.totalFt2.toFixed(0)} ft² show, ${f.areas.hidden.totalFt2.toFixed(0)} ft² hidden; ${f.areas.gross.totalFt2.toFixed(0)} ft² gross), ${f.areas.oakEndGrainFt2.toFixed(1)} ft² oak end grain.</p>`];
  out.push('<h3>Shopping list</h3>');
  out.push(table([['Product'], ['Buy', 'num']], [
    ...f.buy.map((b) => [td(`${esc(b.item)}<div class="muted small">${esc(b.note)}</div>`), td(`${b.qty} ${esc(b.unit)}`, 'num')]),
    ...f.supplies.map((b) => [td(`${esc(b.item)}<div class="muted small">${esc(b.note)}</div>`), td(`${b.qty} ${esc(b.unit)}`, 'num')]),
  ]));
  out.push('<h3>Schedule</h3>');
  for (const s of f.steps) {
    out.push(`<div class="step"><h4>F${s.n}. ${esc(s.title)}${s.coats ? ` <span class="muted">· ${s.coats} coat${s.coats === 1 ? '' : 's'}</span>` : ''}</h4>`);
    out.push(s.items?.length ? instrList(s.items, partLinker(d), true, undefined, true) : `<ol class="instr">${s.instructions.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`);
    if (s.products.length) out.push(table([['Product'], ['Area', 'num'], ['Coats', 'num'], ['Qt', 'num']], s.products.map((p) => [td(esc(p.name)), td(p.areaFt2 >= 0.5 ? `${p.areaFt2.toFixed(0)} ft²` : 'touch-ups', 'num'), td(p.coats, 'num'), td(`${p.qtNeeded.toFixed(2)} qt`, 'num')])));
    const given = (t: string): boolean => !!t && !/^[-–]$/.test(t.trim());
    const rc = [given(s.recoat) ? `<strong>Recoat:</strong> ${esc(s.recoat)}` : '', given(s.cure) ? `<strong>Cure:</strong> ${esc(s.cure)}` : ''].filter(Boolean).join(' ');
    out.push(`${rc ? `<p class="small">${rc}</p>` : ''}<p class="small muted"><strong>Winter shop:</strong> ${esc(s.winter)}</p></div>`);
  }
  if (f.assumptions.length) out.push(`<h3>Assumptions</h3>${ul(f.assumptions.map(esc), 'small')}`);
  return out.join('');
}

function laserSection(d: BuildData): string {
  const files = d.laser;
  const out: string[] = [];
  out.push(`<ul class="legend" style="list-style:none;padding-left:0">${LASER_CONVENTIONS.map((c) => `<li><strong>${esc(c.name)}</strong>: ${esc(c.meaning)}</li>`).join('')}</ul>`);
  out.push(ul(LASER_NOTES.map(esc), 'small'));
  out.push(`<p class="small">${files.length} files in the zip, folder <code>laser/</code>. SVG only, full size.</p>`);
  out.push(table([['File'], ['Job'], ['Material'], ['Cut', 'num'], ['Size (in)', 'num'], ['Bed']], files.map((f) => [
    td(`<code>${esc(f.fileName)}</code>`), td(esc(f.title)), td(esc(f.material)), td(f.kind === 'part' ? f.qty : f.pieces.length, 'num'),
    td(`${fracDim(f.widthIn)} × ${fracDim(f.heightIn)}`, 'num'), td(esc(f.fits ? 'fits' : f.verdict.text)),
  ])));
  return out.join('');
}

function shaperSection(d: BuildData): string {
  const files = d.shaper;
  const out: string[] = [];
  out.push(`<ul class="legend" style="list-style:none;padding-left:0">${SHAPER_CONVENTIONS.map((c) => `<li><span class="sw ${c.swatch}"></span><strong>${esc(c.name)}</strong>: ${esc(c.meaning)}</li>`).join('')}</ul>`);
  out.push(ul(SHAPER_NOTES.map(esc), 'small'));
  out.push(`<p class="small">${files.length} files in the zip, folder <code>shaper/</code>: one per part (identical parts share a file). SVG only.</p>`);
  out.push(table([['File'], ['Part'], ['Qty', 'num'], ['Size (in)', 'num'], ['Face up'], ['Features'], ['Depth', 'num']], files.map((f) => {
    const depth = maxDepth(f.features);
    const face = (f as { cutFace?: string; cutFaceMatters?: boolean });
    return [
      td(`<code>${esc(f.fileName)}</code>`), td(esc([...new Set(f.partIds.map((id) => d.parts.find((x) => x.id === id)?.name ?? id))].join(', '))), td(f.qty, 'num'),
      td(`${fracDim(f.widthIn)} × ${fracDim(f.heightIn)}`, 'num'), td(esc(face.cutFaceMatters === false ? 'either' : face.cutFace ?? '')),
      td(esc(featureSummary(f.features))), td(depth !== undefined ? fracInch64(depth) : '', 'num'),
    ];
  })));
  return out.join('');
}

/** The whole book as one HTML document. */
export function buildBookHtml(d: BuildData): string {
  const body: Record<string, string> = {
    start: startSection(d), forms: formsSection(d), drawings: drawingsSection(d),
    verify: verifySection(d), cutlist: cutlistSection(d), boards: boardsSection(d), nesting: nestingSection(d), bom: bomSection(d),
    assembly: assemblySection(d), finishing: finishingSection(d), shaper: shaperSection(d), laser: laserSection(d),
  };
  const out: string[] = [];
  out.push('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">');
  out.push('<title>Troop 455 Klondike sled: build book</title>');
  const skipCss = [...SKIPPABLE].map((id) => `@media print { body:has(#skip-${id}:checked) #${id} { display: none; } }`).join('\n');
  out.push(`<style>${CSS}${skipCss}@page title { @bottom-left { content: none; } @bottom-right { content: none; } } @page blank { @bottom-left { content: none; } @bottom-right { content: none; } } @page { @bottom-left { content: "Sled build book · revision ${esc(d.revision)}"; font-size: 8pt; color: #555; } }</style></head><body>`);
  // Page 1, the binder's front: the title and a picture; page 2 its blank back (printed double-sided); page 3 the checklist of sections and steps.
  const cover = d.cover && /^data:image\/(png|jpeg|webp);base64,/.test(d.cover) ? `<img class="cover" src="${esc(d.cover)}" alt="The sled">` : '';
  out.push(`<section class="title-page"><h1>Troop 455 Klondike Derby sled</h1><p class="subtitle">Build book</p>${cover}</section><div class="blank-page" aria-hidden="true"></div>`);
  out.push('<header><h1>Troop 455 Klondike Derby sled: build book</h1>');
  out.push(`<p class="muted">Generated ${esc(d.opts.date ?? '(date not given)')} · design revision <strong>${esc(d.revision)}</strong>${d.opts.link ? ` · ${esc(d.opts.link)}` : ''}</p>`);
  out.push(`<div class="print-pick"><strong>Leave out of the printout</strong> (tick, then print; this box does not print): ${BOOK_SECTIONS.filter(([id]) => SKIPPABLE.has(id)).map(([id, t]) => `<label><input type="checkbox" id="skip-${id}"${id === 'boards' ? ' checked' : ''}> ${esc(t)}</label>`).join(' ')}</div>`);
  const stepList = `<ol class="toc-steps">${d.steps.map((st) => `<li>${box()}<a href="${st.id === 'verify' ? '#verify' : `#step-${st.n}`}">${st.n}. ${esc(st.title)}</a></li>`).join('')}</ol>`;
  out.push(`<nav aria-label="Contents" class="toc-check"><h2>Checklist</h2><p class="muted small">Tick a section when it is done; the assembly steps are ticked one by one.</p><ol>${BOOK_SECTIONS.map(([id, t]) => `<li>${box()}<a href="#${id}">${esc(t)}</a>${id === 'assembly' ? stepList : ''}</li>`).join('')}</ol></nav></header>`);
  // The design facts and how to print lead the Start here section, so page 3 is the checklist alone.
  const lead: string[] = [];
  const cmp = d.bom.weatherCompare;
  lead.push(`<p><strong>Weather spec: ${esc(SPEC_NAME[d.bom.spec])}</strong> (${d.bom.spec === 'standard' ? 'garage-kept, used a few times a year, wet at most at a rainy derby' : 'stored outside, near salt, or exposed regularly'}). Thin sheet: ${esc(d.bom.thinSheetName)}.${cmp.computed ? ` ${esc(weatherLine(cmp).replace(/^Weather spec: [^.]*\. /, ''))}` : ''}</p>`);
  lead.push('<p class="small">Every number here was generated from the design on screen at that moment. If you change a design number, download again. <span class="screen-only">Print this file from your browser (Letter, margins default, scale 100%, background graphics on) or save it as a PDF.</span> The full-size forms and the machine files are separate files in the same zip: section 1 lists what to print.</p>');
  BOOK_SECTIONS.forEach(([id, title], i) => out.push(`<section class="page" id="${id}"><h2>${i + 1}. ${esc(title)}</h2>${id === 'start' ? lead.join('') : ''}${body[id]}</section>`));
  out.push('</body></html>');
  return out.join('\n');
}
