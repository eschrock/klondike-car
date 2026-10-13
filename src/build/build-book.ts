/**
 * The build book (Phase 4): ONE self-contained, printable HTML document with everything a builder needs at the bench and at the lumber yard.
 * Verify checklist, cut list, board shopping list, nesting drawings, BOM, assembly steps, finishing schedule and the Shaper file index, all
 * generated from the same `BuildData` the Build tab and the zip use, so the three never disagree. Inline CSS and inline SVG only: no scripts,
 * no fonts, no images, nothing fetched. It prints on Letter paper (File > Print, or save as PDF).
 *
 * Plain TS, no DOM. Every string that came from the model goes through `esc`.
 */
import { FROM_TEXT, fabText, pieceText } from './cutlist';
import { fractionText, roughFrac } from './units';
import { paramLabels } from './verify';
import { PART_TOKEN_RE, partLabel, tokensIn, type Instr } from './assembly';
import { SHAPER_CONVENTIONS, SHAPER_NOTES, type BuildData } from './package';
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
tr { break-inside: avoid; }
.box { display: inline-block; margin-right: 5pt; font-size: 1.15em; line-height: 1; vertical-align: -1pt; }
ul.checks { list-style: none; padding-left: 0; margin: 3pt 0; }
ul.checks li { margin: 2pt 0; }
.check, .step { break-inside: avoid; border-top: 1px solid var(--rule); padding-top: 6pt; margin-top: 8pt; }
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
  return (id, capital = false) => {
    let name = partLabel(byId.get(id), id);
    if (capital) name = name[0].toUpperCase() + name.slice(1);
    return anchored.has(id) ? `<a class="part" href="#part-${esc(id)}">${esc(name)}</a>` : esc(name);
  };
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
function instrList(items: Instr[], link: PartLink, top = true): string {
  const li = (it: Instr): string => {
    const extra = (it.parts ?? []).filter((id) => !tokensIn(it.text).includes(id));
    const also = extra.length && extra.length <= 4 ? ` <span class="also">(${extra.map((id) => link(id)).join(', ')})</span>` : '';
    return `<li>${instrText(it.text, link)}${also}${it.sub?.length ? instrList(it.sub, link, false) : ''}</li>`;
  };
  return top ? `<ol class="instr">${items.map(li).join('')}</ol>` : `<ul>${items.map(li).join('')}</ul>`;
}

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
  const out: string[] = ['<p class="muted small">Test these before you spend money or cut wood. Tick each box when the check passes. Each check covers parts and design numbers we are not sure of yet.</p>'];
  const link = partLinker(d);
  const nameOnly = (id: string): string => esc(partLabel(d.parts.find((x) => x.id === id), id));
  for (const g of groupByWhen(d.verify)) {
    out.push(`<h3>${esc(g.when.replace(/^./, (c) => c.toUpperCase()))}</h3>`);
    for (const c of g.checks) {
      const names = [...new Set(c.partIds.map(nameOnly))];
      const values = c.paramKeys.length && c.id !== 'other-params' ? paramLabels(c.paramKeys) : [];
      out.push(`<div class="check"><h4>${box()}${c.n}. ${esc(c.title)}</h4>` +
        `<p><strong>How to check</strong></p>${instrList(c.how, link)}<p><strong>Pass</strong></p>${ul(c.passList.map(esc), 'small')}<p><strong>If it fails:</strong> ${esc(c.ifFails)}</p>` +
        (values.length ? `<p class="muted small">Design values this confirms: ${esc(values.join(', '))}</p>` : '') +
        (names.length ? `<p class="muted small">Parts it covers: ${esc(names.slice(0, 8).join(', '))}${names.length > 8 ? `, and ${names.length - 8} more` : ''}</p>` : '') + '</div>');
    }
  }
  return out.join('');
}

function cutlistSection(d: BuildData): string {
  const c = d.cutList;
  const out: string[] = ['<p class="muted small">Three steps: saw the CUTS from the boards (rough sizes round up to 1/8"), GLUE UP the panels and blocks, then MILL each part to its FINISHED size. Sizes are thickness × width × length in inches. Step is the number of the assembly step (section 6) that installs the part.</p>'];
  const seen = new Set<string>();
  if (c.warnings.length) out.push(`<p class="small"><strong>Data warnings:</strong></p>${ul(c.warnings.map(esc), 'small')}`);

  out.push('<h3>1. Cuts: saw these from the boards</h3>');
  for (const g of groupCutsByBoard(c.cuts)) {
    const pieces = g.cuts.reduce((a, x) => a + x.qty, 0);
    out.push(`<h4>${esc(g.board)} boards <span class="muted">· ${pieces} piece${pieces === 1 ? '' : 's'}</span></h4>`);
    out.push(table([['Cut'], ['Qty', 'num'], ['Rough T × W × L'], ['Piece'], ['Note']], g.cuts.map((x) => [
      td(`${esc(x.label)}${x.glueUp ? `<div class="muted small">glued into the ${esc(x.glueUp)}</div>` : ''}`), td(x.qty, 'num'), td(esc(x.roughText)), td(esc(pieceText(x))), td(esc(x.note ?? '')),
    ])));
  }
  if (!c.cuts.length) out.push('<p class="small">No solid-wood cuts in this design.</p>');

  if (c.resaw.length) {
    out.push('<h4>Resawing the strips</h4>');
    for (const pool of c.resaw) {
      out.push(`<p class="small"><strong>${pool.strips} strips, ${roughFrac(pool.roughT)} rough, from ${pool.boards} × ${esc(pool.board)} board${pool.boards === 1 ? '' : 's'}</strong> (${fractionText(pool.boardWidthIn, 8)}" wide × ${pool.boardLengthIn / 12} ft, ${+pool.boardFeet.toFixed(1)} board feet).</p>` +
        ul([
          `${esc(pool.ripText[0].toUpperCase() + pool.ripText.slice(1))}: ${esc(pool.laneCountText)}.`,
          `Then resaw each lane on edge into ${pool.stripsPerBoard} slab${pool.stripsPerBoard === 1 ? '' : 's'}: ${esc(pool.resawHeightText)}.`,
          `${pool.stripSlots} strips come out for the ${pool.strips} needed: ${pool.spares} spare${pool.spares === 1 ? '' : 's'} for the bend test.`,
        ], 'small'));
    }
  }

  out.push('<h3>2. Glue-ups</h3>');
  if (c.glueUps.length) {
    out.push(table([['Glue-up'], ['Qty', 'num'], ['From'], ['Rough block T × W × L'], ['Then mill to T × W × L']], c.glueUps.map((g) => [
      td(`${esc(g.label)}<div class="small">${esc(g.note.split(';')[0].replace(/^./, (ch) => ch.toUpperCase()))}</div>`), td(g.qty, 'num'), td(`${g.from} piece${g.from === 1 ? '' : 's'}`), td(esc(g.roughBlockText)), td(esc(g.finalText)),
    ])));
  } else out.push('<p class="small">Nothing is glued up in this design.</p>');

  out.push('<h3>3. Finished parts: mill to these sizes</h3>');
  out.push(table([['Part'], ['Qty', 'num'], ['Final T × W × L'], ['From'], ['Board'], ['Grain'], ['Fabrication'], ['Step', 'num']], c.finished.map((f) => [
    td(`${anchors(f.ids, seen)}${esc(f.name)}`), td(f.qty, 'num'), td(esc(f.finalText)), td(esc(FROM_TEXT[f.from] ?? f.from)), td(esc(f.board)), td(esc(f.grainWord ?? '')), td(esc(fabText(f.fab))), td(f.assemblySteps.join(', '), 'num'),
  ])));

  out.push('<h3>Plywood</h3>');
  for (const g of c.sheets) {
    out.push(`<h4>${esc(g.label)} <span class="muted">· ${g.pieces} pieces</span></h4>`);
    out.push(table([['Part'], ['Qty', 'num'], ['Size T × W × L'], ['Grain'], ['Fabrication'], ['Step', 'num']], g.rows.map((r) => [
      td(`${anchors(r.ids, seen)}${esc(r.name)}${r.note ? `<div class="small"><strong>${esc(r.note)}</strong></div>` : ''}`), td(r.qty, 'num'), td(dims3(r.stock)), td(esc(r.grainWord ?? '')), td(esc(fabText(r.fab))), td(r.assemblySteps.join(', '), 'num'),
    ])));
  }
  out.push('<h3>Metal stock</h3>');
  out.push(table([['Part'], ['Qty', 'num'], ['Stock'], ['Cut length', 'num'], ['Step', 'num']], c.metal.map((r) => [
    td(`${anchors(r.ids, seen)}${esc(r.name)}`), td(r.qty, 'num'), td(esc(r.section)), td(fracInch(r.cutLengthIn), 'num'), td(r.assemblySteps.join(', '), 'num'),
  ])));
  return out.join('');
}

function boardsSection(d: BuildData): string {
  const o = d.oak;
  const nameOf = (id: string): string => partLabel(d.parts.find((x) => x.id === id), id);
  const out: string[] = ['<p class="muted small">Take this page to the lumber yard. Boards are rough, kiln-dried white oak; ask for the thick boards first, then see what is left for the thinner parts. Widths shown are minimums.</p>'];
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
      out.push(`<p class="small">${pool.strips} strips of ${roughFrac(pool.roughT)} rough (${esc([...new Set(pool.laneStrips.flat().map((s) => nameOf(s.id)))].join(', '))}); each board yields ${r.yieldPerBoard} strips, so ${r.spares} spare${r.spares === 1 ? '' : 's'}.</p>`);
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
  out.push(`<p class="muted small">${esc(b.totalsText)}. ${pct(b.estimateShare)} of the total is an estimate (${usd(b.estimateUsd)}), the rest quoted by the model or by a vendor list. Prices are 2026 US retail guesses until you get quotes. Bulk parts (screws, nuts, washers, inserts, Dominos, tape, sandpaper) are priced by the pack in their own section: you buy a whole pack and may already have them in the shop. The finishing touches (lights, seat cushions, reflectors, tie-downs) are priced as their own section so you can build with or without them.</p>`);
  const lineRow = (l: BuildData['bom']['sections'][number]['lines'][number]): string[] => [
    td(`${esc(l.description)}${l.vendor ? `<div class="muted small">${esc(l.vendor)}</div>` : ''}${l.notes ? `<div class="muted small">${esc(l.notes)}</div>` : ''}${l.materialNote ? `<div class="small"><strong>Material:</strong> ${esc(l.materialNote)}</div>` : ''}${l.url ? `<div class="small">${link(l.url)}</div>` : ''}`),
    td(`${l.qty % 1 ? l.qty.toFixed(2) : l.qty} ${esc(l.unit)}${l.packs !== undefined ? `<div class="muted small">need ${num(l.needed ?? 0, 2)}, ${l.packs} pack${l.packs === 1 ? '' : 's'} of ${l.packQty} at ${usd(l.packUsd ?? 0)}</div>` : ''}`, 'num'), td(usd(l.unitUsd), 'num'), td(`${usd(l.extUsd)}${l.basis === 'estimate' ? ' est.' : ''}`, 'num'),
  ];
  for (const s of b.sections) {
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
  out.push(`<p class="total">Grand total ${usd(b.totalUsd)}</p>`);
  if (b.unpriced.length) out.push(`<p><strong>No price:</strong> ${esc(b.unpriced.join(', '))}</p>`);
  return out.join('');
}

function assemblySection(d: BuildData): string {
  const nameOf = new Map(d.parts.map((x) => [x.id, x.name]));
  const link = partLinker(d);
  const out: string[] = ['<p class="muted small">Do the steps in order. Cure blocks give the West System pot life, clamp time and full-cure time; in a cold shop allow longer. Tick each check before you move on.</p>'];
  for (const s of d.steps) {
    const listing = s.partIds.map((id) => nameOf.get(id) ?? id);
    out.push(`<div class="step" id="step-${s.n}"><h3>${s.n}. ${esc(s.title)}${s.kind === 'build' ? '' : `<span class="kind">${esc(s.kind)}</span>`}</h3>`);
    out.push(listing.length ? `<p class="small"><strong>Parts (${listing.length}):</strong> ${esc(listing.join(', '))}</p>` : '<p class="small muted">No parts installed in this step.</p>');
    if (s.goal) out.push(`<p class="goal">${esc(s.goal)}</p>`);
    out.push(s.items?.length ? instrList(s.items, link) : `<ol class="instr">${s.instructions.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`);
    if (s.clampCure) out.push(`<p class="cure"><strong>Glue, clamp and cure:</strong> ${esc(s.clampCure)}</p>`);
    else if (s.cure) out.push(`<p class="cure"><strong>Cure:</strong> ${esc(cureLine(s.cure))}</p>`);
    if (s.checks.length) out.push(`<p class="small"><strong>Check before moving on</strong></p><ul class="checks">${s.checks.map((c) => `<li>${box()}${esc(c.replace(/:\s*passed$/i, ''))}</li>`).join('')}</ul>`);
    if (s.tools.length) out.push(`<p class="small muted"><strong>Tools:</strong> ${esc(s.tools.join(', '))}</p>`);
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
    out.push(`<div class="step"><h4>${s.n}. ${esc(s.title)}${s.coats ? ` <span class="muted">· ${s.coats} coat${s.coats === 1 ? '' : 's'}</span>` : ''}</h4>`);
    out.push(s.items?.length ? instrList(s.items, partLinker(d)) : `<ol class="instr">${s.instructions.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`);
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
    verify: verifySection(d), cutlist: cutlistSection(d), boards: boardsSection(d), nesting: nestingSection(d), bom: bomSection(d),
    assembly: assemblySection(d), finishing: finishingSection(d), shaper: shaperSection(d),
  };
  const out: string[] = [];
  out.push('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">');
  out.push('<title>Troop 455 Klondike sled: build book</title>');
  out.push(`<style>${CSS}</style></head><body>`);
  out.push('<header><h1>Troop 455 Klondike Derby sled: build book</h1>');
  out.push(`<p class="muted">Generated ${esc(d.opts.date ?? '(date not given)')} · design revision <strong>${esc(d.revision)}</strong>${d.opts.link ? ` · ${esc(d.opts.link)}` : ''}</p>`);
  const cmp = d.bom.weatherCompare;
  out.push(`<p><strong>Weather spec: ${esc(SPEC_NAME[d.bom.spec])}</strong> (${d.bom.spec === 'standard' ? 'garage-kept, used a few times a year, wet at most at a rainy derby' : 'stored outside, near salt, or exposed regularly'}). Thin sheet: ${esc(d.bom.thinSheetName)}.${cmp.computed ? ` ${esc(weatherLine(cmp).replace(/^Weather spec: [^.]*\. /, ''))}` : ''}</p>`);
  out.push('<p class="small">Every number here was generated from the design on screen at that moment. If you change a design number, download again. Print this file from your browser (Letter, margins default, scale 100%) or save it as a PDF. The full-size forms and the Shaper files are separate files in the same zip.</p>');
  out.push(`<nav aria-label="Contents"><ol>${BOOK_SECTIONS.map(([id, t]) => `<li><a href="#${id}">${esc(t)}</a></li>`).join('')}</ol></nav></header>`);
  BOOK_SECTIONS.forEach(([id, title], i) => out.push(`<section class="page" id="${id}"><h2>${i + 1}. ${esc(title)}</h2>${body[id]}</section>`));
  out.push('</body></html>');
  return out.join('\n');
}
