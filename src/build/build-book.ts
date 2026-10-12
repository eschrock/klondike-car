/**
 * The build book (Phase 4): ONE self-contained, printable HTML document with everything a builder needs at the bench and at the lumber yard.
 * Verify checklist, cut list, board shopping list, nesting drawings, BOM, assembly steps, finishing schedule and the Shaper file index, all
 * generated from the same `BuildData` the Build tab and the zip use, so the three never disagree. Inline CSS and inline SVG only: no scripts,
 * no fonts, no images, nothing fetched. It prints on Letter paper (File > Print, or save as PDF).
 *
 * Plain TS, no DOM. Every string that came from the model goes through `esc`.
 */
import { fracIn } from './cutlist';
import { SHAPER_CONVENTIONS, SHAPER_NOTES, type BuildData } from './package';
import { cureLine, dims3, esc, featureSummary, groupByWhen, maxDepth, pct, sheetSvg, usd } from '../ui/build-helpers';

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
tr { break-inside: avoid; }
.box { display: inline-block; width: 9pt; height: 9pt; border: 1.2px solid var(--ink); margin-right: 5pt; vertical-align: -1pt; }
ul.checks { list-style: none; padding-left: 0; margin: 3pt 0; }
ul.checks li { margin: 2pt 0; }
.check, .step { break-inside: avoid; border-top: 1px solid var(--rule); padding-top: 6pt; margin-top: 8pt; }
.kind { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin-left: 6pt; font-weight: 400; }
.cure { background: var(--tint); border-left: 3px solid var(--accent); padding: 3pt 7pt; margin: 5pt 0; }
ol.instr { margin: 4pt 0 4pt 16pt; padding-left: 8pt; }
ol.instr li { margin: 2pt 0; }
.sheet { break-inside: avoid; margin: 4pt 0 10pt; }
.sheet svg { width: 100%; height: auto; border: 1px solid var(--rule); }
.total { font-weight: 700; }
.legend span.sw { display: inline-block; width: 10pt; height: 10pt; margin-right: 5pt; vertical-align: -1pt; border: 1px solid #000; }
.sw.outside { background: #000; } .sw.inside { background: #fff; } .sw.pocket { background: #999; } .sw.guide { background: #fff; border-color: #0068ff !important; }
@page { size: Letter; margin: 0.6in; }
@media print {
  body { max-width: none; padding: 0; }
  html { font-size: 10pt; }
  section.page { break-before: page; }
  section.page:first-of-type { break-before: auto; }
  a { text-decoration: none; }
}
`;

const td = (v: string | number, cls = ''): string => `<td${cls ? ` class="${cls}"` : ''}>${typeof v === 'number' ? v : v}</td>`;
const th = (v: string, cls = ''): string => `<th${cls ? ` class="${cls}"` : ''}>${v}</th>`;
const table = (head: Array<[string, string?]>, rows: string[][], cls = ''): string =>
  `<table${cls ? ` class="${cls}"` : ''}><thead><tr>${head.map(([h, c]) => th(h, c)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.join('')}</tr>`).join('')}</tbody></table>`;
const ul = (items: string[], cls = ''): string => `<ul${cls ? ` class="${cls}"` : ''}>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const box = (): string => '<span class="box" aria-hidden="true"></span>';
const num = (v: number, dp = 1): string => String(+v.toFixed(dp));

/** Ids and titles of the book's sections, in order (also the table of contents). */
export const BOOK_SECTIONS: Array<[string, string]> = [
  ['verify', 'Verify before ordering'],
  ['cutlist', 'Cut list'],
  ['boards', 'Board shopping list'],
  ['nesting', 'Plywood nesting'],
  ['bom', 'Bill of materials'],
  ['assembly', 'Assembly steps'],
  ['finishing', 'Finishing schedule'],
  ['shaper', 'Shaper Origin file index'],
];

function verifySection(d: BuildData): string {
  const out: string[] = ['<p class="muted small">Test these before you spend money or cut wood. Tick each box when it passes. Each item guards parts and design numbers marked "verify".</p>'];
  for (const g of groupByWhen(d.verify)) {
    out.push(`<h3>${esc(g.when.replace(/^./, (c) => c.toUpperCase()))}</h3>`);
    for (const c of g.checks) {
      out.push(`<div class="check"><h4>${box()}${c.n}. ${esc(c.title)}</h4>` +
        `<p><strong>Do:</strong> ${esc(c.whatToDo)}</p><p><strong>Pass:</strong> ${esc(c.pass)}</p><p><strong>If it fails:</strong> ${esc(c.ifFails)}</p>` +
        `<p class="muted small">Params: ${esc(c.paramKeys.join(', ') || 'none')} · Guards: ${esc(c.partIds.join(', ') || 'no single part')}${c.refs.length ? ` · ${esc(c.refs.join(', '))}` : ''}</p></div>`);
    }
  }
  return out.join('');
}

function cutlistSection(d: BuildData): string {
  const c = d.cutList;
  const out: string[] = ['<p class="muted small">Final size is the finished thickness × width × length; rough adds the milling allowance. Inches, sixteenths as fractions.</p>'];
  if (c.warnings.length) out.push(`<p class="small"><strong>Data warnings:</strong></p>${ul(c.warnings.map(esc), 'small')}`);
  out.push('<h3>White oak, by board thickness</h3>');
  for (const g of c.oak) {
    const resawn = g.board === 'resawn';
    out.push(`<h4>${resawn ? `Resawn strips (${g.pieces} pieces: see the strip list)` : `${esc(g.board)} (usable ${fracIn(g.usableIn)}"), ${g.pieces} pieces`}</h4>`);
    out.push(table([['Part'], ['Qty', 'num'], ['Final T × W × L'], ['Rough T × W × L'], ['Grain'], ['Step', 'num']], g.rows.map((r) => [
      td(`${esc(r.name)}<div class="muted small">${esc(r.partNo)} · ${esc(r.ids.join(', '))}${r.plies ? ` · ${r.plies} plies` : ''}</div>`), td(r.qty, 'num'), td(dims3(r.stock)), td(dims3(r.rough)), td(esc(r.grain ?? '')), td(r.step, 'num'),
    ])));
  }
  out.push('<h3>Resawn strips</h3>');
  out.push(table([['Strips for'], ['Strips', 'num'], ['Final strip T × W × L'], ['Rough strip T × W × L'], ['Resaw from']], c.strips.map((r) => [
    td(`${esc(r.name)} (${r.parts} part${r.parts === 1 ? '' : 's'} × ${r.plies} plies)<div class="muted small">${esc(r.ids.join(', '))}</div>`), td(r.strips, 'num'), td(dims3(r.stock)), td(dims3(r.rough)), td(esc(r.resawFrom)),
  ])));
  for (const pool of c.resaw) {
    out.push(`<p class="small">${pool.strips} strips of ${fracIn(pool.roughT)}" rough: buy ${pool.boards} × ${esc(pool.board)} × ${pool.boardWidthIn}" wide × ${pool.boardLengthIn / 12} ft (${pool.boardFeet.toFixed(1)} bf). Each board gives ${pool.stripsPerBoard} slab${pool.stripsPerBoard === 1 ? '' : 's'} and ${pool.yieldPerBoard} strips; the purchase holds ${pool.stripSlots} strips, so ${pool.spares} spare${pool.spares === 1 ? '' : 's'}.</p>`);
  }
  out.push('<h3>Okoume plywood</h3>');
  for (const g of c.sheets) {
    out.push(`<h4>${esc(g.label)} (${g.pieces} pieces)</h4>`);
    out.push(table([['Part'], ['Qty', 'num'], ['Final T × W × L'], ['Grain'], ['Step', 'num']], g.rows.map((r) => [
      td(`${esc(r.name)}<div class="muted small">${esc(r.partNo)} · ${esc(r.ids.join(', '))}</div>`), td(r.qty, 'num'), td(dims3(r.stock)), td(esc(r.grain ?? '')), td(r.step, 'num'),
    ])));
  }
  out.push('<h3>Metal stock</h3>');
  out.push(table([['Part'], ['Qty', 'num'], ['Stock'], ['Cut length', 'num']], c.metal.map((r) => [
    td(`${esc(r.name)}<div class="muted small">${esc(r.partNo)} · ${esc(r.ids.join(', '))}</div>`), td(r.qty, 'num'), td(esc(r.section)), td(`${fracIn(r.cutLengthIn)}"`, 'num'),
  ])));
  return out.join('');
}

function boardsSection(d: BuildData): string {
  const o = d.oak;
  const out: string[] = ['<p class="muted small">Take this page to the lumber yard. Boards are rough, kiln-dried white oak; ask for the thick boards first, then see what is left for the thinner parts. Widths shown are minimums.</p>'];
  out.push('<h3>Oak boards to buy</h3>');
  out.push(table([['Thickness'], ['Buy'], ['Net bf', 'num'], [`+${Math.round(o.wasteAllowance * 100)}%`, 'num'], ['Boards bf', 'num']], [
    ...o.thicknesses.map((t) => [td(`<strong>${esc(t.board)}</strong><div class="muted small">${t.pieces} pieces</div>`), td(t.summary.map(esc).join('<br>')), td(num(t.netBf), 'num'), td(num(t.allowanceBf), 'num'), td(num(t.plannedBf), 'num')]),
    [td('<strong>Total</strong>'), td(''), td(num(o.netBf), 'num'), td(num(o.allowanceBf), 'num'), td(num(o.purchaseBf), 'num')],
  ]));
  if (o.glueUps.length) out.push(`<p class="small">Wider than a board, edge-glue pieces: ${esc(o.glueUps.join(', '))}.</p>`);
  const sheets = new Map<number, number>();
  for (const s of d.nest.sheets) sheets.set(s.thicknessMm, (sheets.get(s.thicknessMm) ?? 0) + 1);
  out.push('<h3>Plywood to buy</h3>');
  out.push(ul([...sheets.entries()].map(([mm, n]) => `${n} × ${mm} mm marine okoume (BS 1088), 4 × 8 ft sheet`)));
  out.push('<h3>Where each solid piece comes from</h3>');
  for (const t of o.thicknesses) {
    t.boards.forEach((b, i) => {
      out.push(`<h4>${esc(t.board)} board ${i + 1}: ${b.lengthIn / 12} ft × 6"</h4>`);
      out.push(table([['Lane width', 'num'], ['Cuts (width × length)'], ['Used', 'num']], b.lanes.map((l) => [
        td(`${num(l.widthIn, 2)}"`, 'num'),
        td(l.cuts.map((c) => `${esc(c.id)}${c.fromBoard ? ` (milled down from ${esc(t.board)} for ${esc(c.fromBoard)})` : ''} ${num(c.widthIn, 2)}" × ${num(c.lengthIn)}"`).join('; ')),
        td(`${num(l.usedIn)}" of ${b.lengthIn}"`, 'num'),
      ])));
    });
    for (const r of t.resawBoards) {
      const pool = o.resaw[r.pool];
      out.push(`<h4>${esc(t.board)} resaw: ${r.count} × ${r.widthIn}" wide × ${r.lengthIn / 12} ft</h4>`);
      out.push(`<p class="small">${pool.strips} strips of ${fracIn(pool.roughT)}" rough (${esc([...new Set(pool.layerStrips.flat().map((s) => s.partNo))].join(', '))}); each board yields ${r.yieldPerBoard} strips, so ${r.spares} spare${r.spares === 1 ? '' : 's'}.</p>`);
    }
  }
  return out.join('');
}

function nestingSection(d: BuildData): string {
  const n = d.nest;
  const out: string[] = ['<p class="muted small">True-shape part outlines on full 4 × 8 sheets (the arrow is the grain; the dashed box is the largest offcut). The side webs are drawn unrolled to their flat development.</p>'];
  for (const s of n.sheets) {
    out.push(`<div class="sheet"><h3>${esc(s.label)}, sheet ${s.index} <span class="muted">· ${s.utilizationPct.toFixed(1)}% used</span></h3>${sheetSvg(s)}`);
    out.push(`<p class="small muted">Largest offcut ${s.offcut.largest.widthIn.toFixed(1)} × ${s.offcut.largest.heightIn.toFixed(1)} in. Parts: ${esc(s.placements.map((q) => `${q.name} (${q.partId}) ${q.widthIn.toFixed(1)} × ${q.heightIn.toFixed(1)}${q.rotation ? ', turned 90°' : ''}`).join('; '))}.</p></div>`);
  }
  if (n.unplaced.length) out.push(`<p><strong>Did not fit:</strong> ${esc(n.unplaced.join(', '))}</p>`);
  if (n.grainTurned.length) out.push(`<p><strong>Grain turned across:</strong> ${esc(n.grainTurned.map((g) => g.name).join(', '))}</p>`);
  return out.join('');
}

function bomSection(d: BuildData): string {
  const b = d.bom;
  const out: string[] = [`<p class="muted small">Total ${usd(b.totalUsd)}; ${pct(b.estimateShare)} of it is an estimate (${usd(b.estimateUsd)}), the rest quoted by the model. Prices are 2026 US retail guesses until you get quotes.</p>`];
  for (const s of b.sections) {
    out.push(`<h3>${esc(s.title)} <span class="muted">· ${usd(s.subtotalUsd)}</span></h3>`);
    out.push(table([['Item'], ['Qty', 'num'], ['Unit', 'num'], ['Ext.', 'num']], [
      ...s.lines.map((l) => [
        td(`${esc(l.description)}${l.vendor ? `<div class="muted small">${esc(l.vendor)}</div>` : ''}${l.notes ? `<div class="muted small">${esc(l.notes)}</div>` : ''}`),
        td(`${l.qty % 1 ? l.qty.toFixed(2) : l.qty} ${esc(l.unit)}`, 'num'), td(usd(l.unitUsd), 'num'), td(`${usd(l.extUsd)}${l.basis === 'estimate' ? ' est.' : ''}`, 'num'),
      ]),
      [td(`<strong>${esc(s.title)} subtotal</strong>`), td(''), td(''), td(`<strong>${usd(s.subtotalUsd)}</strong>`, 'num')],
    ]));
  }
  out.push(`<p class="total">Grand total ${usd(b.totalUsd)}</p>`);
  if (b.unpriced.length) out.push(`<p><strong>No price:</strong> ${esc(b.unpriced.join(', '))}</p>`);
  return out.join('');
}

function assemblySection(d: BuildData): string {
  const nameOf = new Map(d.parts.map((x) => [x.id, x.name]));
  const out: string[] = ['<p class="muted small">Do the steps in order. Cure blocks give the West System pot life, clamp time and full-cure time; in a cold shop allow longer. Tick each check before you move on.</p>'];
  for (const s of d.steps) {
    const listing = s.partIds.map((id) => nameOf.get(id) ?? id);
    out.push(`<div class="step" id="step-${s.n}"><h3>${s.n}. ${esc(s.title)}${s.kind === 'build' ? '' : `<span class="kind">${esc(s.kind)}</span>`}</h3>`);
    out.push(listing.length ? `<p class="small"><strong>Parts (${listing.length}):</strong> ${esc(listing.join(', '))}</p>` : '<p class="small muted">No parts installed in this step.</p>');
    out.push(`<ol class="instr">${s.instructions.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`);
    if (s.clampCure) out.push(`<p class="cure"><strong>Glue, clamp and cure:</strong> ${esc(s.clampCure)}</p>`);
    else if (s.cure) out.push(`<p class="cure"><strong>Cure:</strong> ${esc(cureLine(s.cure))}</p>`);
    if (s.checks.length) out.push(`<p class="small"><strong>Check before moving on</strong></p><ul class="checks">${s.checks.map((c) => `<li>${box()}${esc(c)}</li>`).join('')}</ul>`);
    if (s.tools.length) out.push(`<p class="small muted"><strong>Tools:</strong> ${esc(s.tools.join(', '))}</p>`);
    out.push('</div>');
  }
  return out.join('');
}

function finishingSection(d: BuildData): string {
  const f = d.finishing;
  const out: string[] = [`<p class="small">Finish area (gross): ${f.areas.oakFt2.toFixed(0)} ft² oak, ${f.areas.okoumeFt2.toFixed(0)} ft² okoume, ${f.areas.oakEndGrainFt2.toFixed(1)} ft² oak end grain.</p>`];
  out.push('<h3>Shopping list</h3>');
  out.push(table([['Product'], ['Buy', 'num']], [
    ...f.buy.map((b) => [td(`${esc(b.item)}<div class="muted small">${esc(b.note)}</div>`), td(`${b.qty} ${esc(b.unit)}`, 'num')]),
    ...f.supplies.map((b) => [td(`${esc(b.item)}<div class="muted small">${esc(b.note)}</div>`), td(`${b.qty} ${esc(b.unit)}`, 'num')]),
  ]));
  out.push('<h3>Schedule</h3>');
  for (const s of f.steps) {
    out.push(`<div class="step"><h4>${s.n}. ${esc(s.title)}${s.coats ? ` <span class="muted">· ${s.coats} coat${s.coats === 1 ? '' : 's'}</span>` : ''}</h4>`);
    out.push(`<ol class="instr">${s.instructions.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`);
    if (s.products.length) out.push(table([['Product'], ['Area', 'num'], ['Coats', 'num'], ['Qt', 'num']], s.products.map((p) => [td(esc(p.name)), td(`${p.areaFt2.toFixed(0)} ft²`, 'num'), td(p.coats, 'num'), td(p.qtNeeded.toFixed(2), 'num')])));
    out.push(`<p class="small"><strong>Recoat:</strong> ${esc(s.recoat)} <strong>Cure:</strong> ${esc(s.cure)}</p><p class="small muted"><strong>Winter shop:</strong> ${esc(s.winter)}</p></div>`);
  }
  if (f.assumptions.length) out.push(`<h3>Assumptions</h3>${ul(f.assumptions.map(esc), 'small')}`);
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
      td(`<code>${esc(f.fileName)}</code>`), td(esc(f.partNo) + (f.qty > 1 ? `<div class="muted small">${esc(f.partIds.join(', '))}</div>` : '')), td(f.qty, 'num'),
      td(`${f.widthIn.toFixed(2)} × ${f.heightIn.toFixed(2)}`, 'num'), td(esc(face.cutFaceMatters === false ? 'either' : face.cutFace ?? '')),
      td(esc(featureSummary(f.features))), td(depth !== undefined ? `${depth.toFixed(2)}"` : '', 'num'),
    ];
  })));
  return out.join('');
}

/** The whole book as one HTML document. */
export function buildBookHtml(d: BuildData): string {
  const body: Record<string, string> = {
    verify: verifySection(d), cutlist: cutlistSection(d), boards: boardsSection(d), nesting: nestingSection(d), bom: bomSection(d),
    assembly: assemblySection(d), finishing: finishingSection(d), shaper: shaperSection(d),
  };
  const out: string[] = [];
  out.push('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">');
  out.push('<title>Troop 455 Klondike sled: build book</title>');
  out.push(`<style>${CSS}</style></head><body>`);
  out.push('<header><h1>Troop 455 Klondike Derby sled: build book</h1>');
  out.push(`<p class="muted">Generated ${esc(d.opts.date ?? '(date not given)')} · params revision <strong>${esc(d.revision)}</strong>${d.opts.link ? ` · ${esc(d.opts.link)}` : ''}</p>`);
  out.push('<p class="small">Every number here was generated from the design on screen at that moment. If you change a design number, download again. Print this file from your browser (Letter, margins default, scale 100%) or save it as a PDF. The full-size forms and the Shaper files are separate files in the same zip.</p>');
  out.push(`<nav aria-label="Contents"><ol>${BOOK_SECTIONS.map(([id, t]) => `<li><a href="#${id}">${esc(t)}</a></li>`).join('')}</ol></nav></header>`);
  BOOK_SECTIONS.forEach(([id, title], i) => out.push(`<section class="page" id="${id}"><h2>${i + 1}. ${esc(title)}</h2>${body[id]}</section>`));
  out.push('</body></html>');
  return out.join('\n');
}
