import { OAK_ALT_PRICE_PER_BF } from './prices';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { BuildData, buildPackage, zipName, zipPackage } from './package';
import { crc32 } from './zip';
import { BOOK_SECTIONS } from './build-book';
import { esc, usd } from '../ui/build-helpers';

const p = defaultParams();
const parts = buildModel(p);
const date = '2026-10-12';
const t0 = performance.now();
const pkg = buildPackage(parts, p, { date, link: 'https://example.test/#x' });
const totalMs = performance.now() - t0;
const names = pkg.files.map((f) => f.name);

describe('buildPackage', () => {
  it('has one SVG per Shaper file', () => {
    const shaper = pkg.data.shaper;
    expect(shaper.length).toBeGreaterThan(5);
    for (const s of shaper) {
      const f = pkg.files.find((q) => q.name === `shaper/${s.fileName}`);
      expect(f, s.fileName).toBeDefined();
      expect(f!.mime).toBe('image/svg+xml');
      expect(f!.data).toBe(s.svg);
    }
    expect(names.filter((n) => n.startsWith('shaper/')).length).toBe(shaper.length);
  });

  it('has the full-size forms and their Letter tiles', () => {
    expect(pkg.data.forms.length).toBeGreaterThanOrEqual(4);
    for (const f of pkg.data.forms) expect(names).toContain(`forms/${f.fileName}`);
    for (const t of pkg.data.tiles) {
      expect(t.pages.length).toBeGreaterThan(0);
      expect(names.some((n) => n.startsWith(`forms/tiled/${t.id}-`))).toBe(true);
    }
    const tiled = names.filter((n) => n.startsWith('forms/tiled/'));
    expect(tiled.length).toBe(pkg.data.tiles.reduce((a, t) => a + t.pages.length, 0));
  });

  it('has both lamp clip STLs, both CSVs and the README', () => {
    const stl = pkg.files.filter((f) => f.name.startsWith('stl/'));
    expect(stl.length).toBe(2);
    for (const f of stl) {
      expect(f.name.endsWith('.stl')).toBe(true);
      expect(f.data).toBeInstanceOf(Uint8Array);
      expect((f.data as Uint8Array).length).toBeGreaterThan(84);
    }
    expect(names).toContain('cutlist.csv');
    expect(names).toContain('bom.csv');
    expect(names).toContain('README.txt');
  });

  it('has unique file names and a README with the date, hash, conventions and the file list', () => {
    expect(new Set(names).size).toBe(names.length);
    const readme = pkg.files.find((f) => f.name === 'README.txt')!.data as string;
    expect(readme).toContain(date);
    expect(readme).toContain(pkg.data.revision);
    expect(readme).toContain('https://example.test/#x');
    expect(readme).toMatch(/Black fill/);
    expect(readme).toMatch(/Blue stroke/);
    // round 3: bit per feature, the DEEP CUT method, text is annotation only (one test import), the insert drill verify, and no stale mirrored-bulkhead line
    expect(readme).toMatch(/names its bit/);
    expect(readme).toMatch(/DEEP CUT parts/);
    expect(readme).toMatch(/annotation only/);
    expect(readme).toMatch(/import transom-rear\.svg/);
    expect(readme).toMatch(/VERIFY the insert drill/);
    expect(readme).not.toMatch(/so it is mirrored/);
    for (const n of names) expect(readme).toContain(n);
  });

  it('puts every cut list table in cutlist.csv', () => {
    const csv = pkg.files.find((f) => f.name === 'cutlist.csv')!.data as string;
    const heads = csv.split('\n').filter((l) => l.startsWith('# '));
    expect(heads.map((h) => h.replace(/:.*$/, '').replace(/^# /, ''))).toEqual(['1. Cuts', 'Resawing the strips', '2. Glue-ups', '3. Finished parts', 'Plywood', 'Metal stock']);
    for (const t of Object.values(pkg.data.cutList.csv)) expect(csv).toContain(t.split('\r\n')[0]);
    // the old final-size table and the layer table are gone: no "Rail L 3/8 x 3 x 59" row, no decimal layer sizes, no part-key column
    expect(csv).not.toMatch(/Oak, by board thickness|Face-laminated layers|Resawn strips\n|Part no|D-\d+/);
    expect(csv).not.toMatch(/Rail L,2,3\/8 × 3 × 59/);
    expect(csv).not.toMatch(/\d\.\d+ × \d/);
    expect(csv).toMatch(/"?Rail, strip 1 of 2/); // the rail is cut as its strips, not listed at its final size
    expect(csv).toContain('glue the 3 layers face to face');
  });

  it('zips every file with matching CRCs', () => {
    const zip = zipPackage(pkg.data);
    const dv = new DataView(zip.buffer);
    const eocd = zip.length - 22;
    expect(dv.getUint16(eocd + 10, true)).toBe(pkg.files.length);
    let pos = dv.getUint32(eocd + 16, true);
    const seen: string[] = [];
    for (let i = 0; i < pkg.files.length; i++) {
      const crc = dv.getUint32(pos + 16, true), size = dv.getUint32(pos + 24, true), nlen = dv.getUint16(pos + 28, true), off = dv.getUint32(pos + 42, true);
      const name = new TextDecoder().decode(zip.subarray(pos + 46, pos + 46 + nlen));
      const data = zip.subarray(off + 30 + nlen, off + 30 + nlen + size);
      expect(crc32(data)).toBe(crc);
      seen.push(name);
      pos += 46 + nlen;
    }
    expect(seen).toEqual(names);
    expect(zipName(pkg.data)).toBe(`klondike-sled-build-${pkg.data.revision}.zip`);
  });

  it('computes lazily and caches', () => {
    const d = new BuildData(parts, p);
    expect(Object.keys(d.timings)).toEqual([]);
    void d.verify;
    expect(Object.keys(d.timings)).toEqual(['verify']);
    expect(d.bom).toBe(d.bom);
  });

  it('reports stage timings (informational)', () => {
    const rows = Object.entries(pkg.timings).map(([k, v]) => `${k} ${v.toFixed(0)} ms`);
    console.info(`package at the defaults: ${totalMs.toFixed(0)} ms total; ${rows.join(', ')}`);
    expect(Object.keys(pkg.timings)).toEqual(expect.arrayContaining(['shaper', 'forms', 'tiles', 'cutList', 'nest', 'bom']));
  });
});

describe('build book', () => {
  const book = pkg.files.find((f) => f.name === 'build-book.html');
  const html = (book?.data ?? '') as string;

  it('is in the package as one text/html file, listed in the README', () => {
    expect(book).toBeDefined();
    expect(book!.mime).toBe('text/html');
    const readme = pkg.files.find((f) => f.name === 'README.txt')!.data as string;
    expect(readme).toContain('build-book.html');
    expect(names.filter((n) => n.startsWith('nesting/')).length).toBe(pkg.data.nest.sheets.length);
  });

  it('is self-contained and printable: inline CSS and SVG only, no scripts, no fetched resources', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).toContain('@media print');
    expect(html).toContain('@page');
    expect(html).not.toMatch(/<script|<link|<img|<iframe|@import|url\((?!#)/i); // url(#id) is an in-page clip path (part drawings), not a fetch
    expect(html).not.toMatch(/\ssrc="/i);
    // the only URLs are the SVG namespace, the design link quoted in the header and the vendor links Eric gave (BOM lines with a `url`)
    // (a line's alternatives are named in its notes with their links, so those links are allowed too)
    const vendor = new Set([...pkg.data.bom.sections.flatMap((s) => s.lines.flatMap((l) => [l.url, ...(l.alternatives ?? []).map((a) => a.url)]).filter((u): u is string => !!u)), ...Object.values(OAK_ALT_PRICE_PER_BF).map((q) => q.url).filter((u): u is string => !!u)].map(esc));
    expect(vendor.size).toBeGreaterThan(0);
    const urls = [...html.matchAll(/https?:\/\/[^\s"'<)]+/g)].map((m) => m[0]);
    // (a link with a ")" in it, such as a Bolt Depot page, is cut there by the pattern: a prefix of a vendor link is fine)
    expect(urls.filter((u) => u !== 'http://www.w3.org/2000/svg' && u !== 'http://www.shapertools.com/namespaces/shaper' && u !== 'https://example.test/#x' && ![...vendor].some((v) => v.startsWith(u)))).toEqual([]);
    // every external link opens in a new tab without an opener
    const anchors = [...html.matchAll(/<a href="(https?:[^"]+)"([^>]*)>/g)];
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) { expect(vendor.has(a[1]), a[1]).toBe(true); expect(a[2]).toContain('target="_blank"'); expect(a[2]).toContain('rel="noopener"'); }
    // the SVGs are the nesting sheets, the assembly step figures, the forms (shrunk) and the part drawings
    expect((html.match(/<svg\b/g) ?? []).length).toBe(pkg.data.nest.sheets.length + pkg.data.steps.reduce((n, s) => n + s.figures.length, 0) + pkg.data.forms.length + pkg.data.partDrawings.length);
    expect(new TextEncoder().encode(html).length).toBeLessThan(4_000_000);
  });

  it('contains every assembly step title, with its clamp and cure text and its checks', () => {
    expect(pkg.data.steps.length).toBeGreaterThan(20);
    for (const s of pkg.data.steps) {
      expect(html, `step ${s.n}`).toContain(`Step ${s.n}.</span> ${esc(s.title)}`);
      if (s.clampCure) expect(html, `step ${s.n} clampCure`).toContain(esc(s.clampCure));
      for (const c of s.checks) expect(html, `step ${s.n} check`).toContain(esc(c.replace(/:\s*passed$/i, ''))); // a check is a to-do (an empty box), never "passed"
      expect(html, `step ${s.n} goal`).toContain(esc(s.goal));
      // Each item and sub-item, with its part tokens as links to the cut list: the text between the tokens is in the book as written.
      const walk = (items: typeof s.items): string[] => items.flatMap((q) => [q.text, ...walk(q.sub ?? [])]);
      for (const t of walk(s.items)) for (const piece of t.split(/\{\{[^{}]+\}\}/).map((x) => x.trim()).filter((x) => x.length > 3)) expect(html, `step ${s.n} item`).toContain(esc(piece));
    }
    // A part with a drawing links to it (with its "[Dn]" number for paper); every in-page link has its target.
    expect(html).toMatch(/<a class="part" href="#drawing-\d+">rail L<\/a> <span class="dref">\[D\d+\]<\/span>/);
    for (const m of html.matchAll(/href="#([^"]+)"/g)) expect(html, m[1]).toContain(`id="${m[1]}"`);
  });

  it('contains every Shaper file name', () => {
    expect(pkg.data.shaper.length).toBeGreaterThan(5);
    for (const f of pkg.data.shaper) expect(html, f.fileName).toContain(esc(f.fileName));
  });

  it('has every section: verify checks, cut list, board list, nesting, BOM, finishing', () => {
    for (const [id, title] of BOOK_SECTIONS) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(esc(title));
    }
    for (const c of pkg.data.verify) expect(html, c.id).toContain(esc(c.title));
    const cl = pkg.data.cutList;
    for (const f of cl.finished) expect(html, f.partNo).toContain(esc(f.name));
    for (const c of cl.cuts) expect(html, c.label).toContain(esc(c.label));
    for (const g of cl.glueUps) expect(html, g.label).toContain(esc(g.label));
    for (const g of cl.sheets) for (const r of g.rows) expect(html, r.partNo).toContain(esc(r.name));
    for (const r of cl.metal) expect(html, r.partNo).toContain(esc(r.name));
    for (const t of pkg.data.oak.thicknesses) for (const line of t.summary) expect(html, line).toContain(esc(line));
    for (const sh of pkg.data.nest.sheets) expect(html).toContain(`${esc(sh.label)}, sheet ${sh.index}`);
    const bom = pkg.data.bom;
    expect(html).toContain(usd(bom.totalUsd));
    for (const s of bom.sections) for (const l of s.lines) expect(html, l.key).toContain(esc(l.description));
    for (const b of pkg.data.finishing.buy) expect(html, b.item).toContain(esc(b.item));
    for (const s of pkg.data.finishing.steps) expect(html, s.title).toContain(esc(s.title));
  });

  it('is generated from the same data: a changed parameter changes the book', () => {
    const other = new BuildData(buildModel({ ...p, deckPlyIn: p.deckPlyIn + 0.02 }), { ...p, deckPlyIn: p.deckPlyIn + 0.02 }, { date });
    const f = other.files.find((q) => q.name === 'build-book.html')!.data as string;
    expect(f).not.toBe(html);
    expect(f).toContain(other.revision);
  });
});

describe('build book: laminations, links, pack-priced parts and finishing touches', () => {
  const html = (pkg.files.find((f) => f.name === 'build-book.html')!.data) as string;
  const bom = pkg.data.bom;

  it('shows each face-laminated part with its layers in the cut list and the board plan', () => {
    for (const g of pkg.data.cutList.glueUps.filter((q) => q.layers > 1)) {
      expect(html, g.label).toContain(esc(g.label));
      for (let i = 1; i <= g.layers; i++) expect(html, `${g.label} layer ${i}`).toContain(`${esc(g.label.replace(/ (block|panel)$/, ''))}, layer ${i} of ${g.layers}`);
    }
    expect(html).toMatch(/Front axle beam \(pivots\), layer 1 of 3/); // the beam is three layers of 4/4, listed as three cuts and then a glue-up
    expect(html).not.toMatch(/12\/4 \(usable/);
  });

  it('prints the BOM links as anchors that open in a new tab, and the material of each fastener line', () => {
    expect(html).toContain('target="_blank" rel="noopener">cdn.hibuwebsites.com</a>'); // D-79: the oak is Peach State Lumber's price sheet (a PDF on its website host)
    expect(html).toContain('href="https://www.thewoodyard.com/current-pricing-list/#plywood"'); // the 12 mm deck sheet is still The Wood Yard's (D-80: the 6 mm Baltic birch thin sheet is Peach State's plywood sheet, okoume under Extreme weather is Aircraft Spruce's)
    expect(html).toContain('<strong>Material:</strong>');
    expect(html).toContain(esc(bom.sections.find((s) => s.id === 'fasteners')!.notes![0]));
  });

  it('shows the touches section with its subtotals, no bulk section, and the totals as build + touches', () => {
    expect(html).not.toContain('Bulk parts');
    expect(html).toContain('Finishing touches subtotal');
    expect(html).toContain(`Lights subtotal`);
    expect(html).toContain(esc(bom.totalsText));
    expect(bom.totalsText).toBe(`Build ${usd(bom.coreUsd)} + finishing touches ${usd(bom.touchesUsd)} = ${usd(bom.totalUsd)}, excluding shipping and tax`);
    expect(html).toContain(esc(bom.shippingNote)); // the shipping orders are named where the total shows (no number invented)
    expect(html).toMatch(/Grand total \$[\d,.]+ \(excluding shipping and tax\)/);
    expect(html).toMatch(/need [\d.]+, \d+ packs? of \d+ at \$/);
  });

  it('writes the totals, the URLs and the pack data to bom.csv', () => {
    const csv = pkg.files.find((f) => f.name === 'bom.csv')!.data as string;
    expect(csv).toContain(bom.totalsText);
    expect(csv).toContain('Finishing touches');
    expect(csv).not.toContain('Bulk parts');
    expect(csv.split('\r\n')[0]).toContain('URL');
  });
});


describe('readability round 2: the book reads in the shop', () => {
  const html = (pkg.files.find((f) => f.name === 'build-book.html')!.data) as string;
  /** The section's text without markup, style or script: what a person reads. */
  const sectionText = (id: string): string => {
    const m = new RegExp(`<section class="page" id="${id}">([\\s\\S]*?)</section>`).exec(html)!;
    return m[1].replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  };
  const bookText = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

  it('prints the checks as empty boxes to tick, never as "passed"', () => {
    expect(bookText).not.toMatch(/:\s*passed\b/); // ("the test panel passed" in the finishing text is a sentence, not a check)
    expect(bookText).toContain('\u2610');
    expect((html.match(/\u2610/g) ?? []).length).toBeGreaterThanOrEqual(pkg.data.verify.length);
    const step0 = pkg.data.steps[0];
    for (const c of step0.checks) expect(html).toContain(`\u2610</span>${esc(c.replace(/:\s*passed$/i, ''))}`);
  });

  it('has no D-number, no Q-number and no parameter name (camelCase) in the sections it generates', () => {
    for (const id of ['verify', 'cutlist', 'boards', 'nesting', 'shaper']) {
      const t = sectionText(id);
      if (id === 'shaper') expect(t, id).not.toMatch(/\bside-[LR]-web\b|\bseat-grip-[LR]\b/); // the Part column names parts, not keys
      expect(t, id).not.toMatch(/\b[DQ]-\d+/);
      expect(t.replace(/shaper:cutDepth/g, ''), id).not.toMatch(/\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/); // (shaper:cutDepth is the attribute the Shaper reads)
    }
    expect(sectionText('verify')).not.toMatch(/Params:|Guards:/);
    expect(sectionText('verify')).toContain('Design values this confirms:');
    expect(sectionText('verify')).toContain('"Wheel hub length"'); // a design value by its parameters-panel label
  });

  it('has no decimal length in the verify, cut list, board list or nesting text (fractions only)', () => {
    for (const id of ['verify', 'cutlist', 'boards', 'nesting']) {
      const t = sectionText(id).replace(/\d\.\d+"+ wall/g, '').replace(/\d+\.\d+ bf|\d+\.\d+ board feet/g, '').replace(/\d\.\d+ ?%|\d\.\d+% used/g, '');
      const hit = /(\d+\.\d+)\s?("|\bin\b|\binch|\bmm\b)/.exec(t);
      expect(hit?.[0], `${id}: ${hit ? t.slice(Math.max(0, hit.index - 50), hit.index + 30) : ''}`).toBeUndefined();
      expect(t, id).not.toMatch(/\d+(?:-\d+\/\d+)? \(\d+\.\d+\)/); // no "21-5/32 (21.142)" parenthetical
    }
  });

  it('lists the cut list in the UI order: cuts by board, glue-ups, finished parts, then plywood and metal', () => {
    const t = sectionText('cutlist');
    const at = ['1. Cuts: saw these from the boards', '2. Glue-ups', '3. Finished parts: mill to these sizes', 'Plywood', 'Metal stock'].map((h) => t.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(t).not.toMatch(/Rail L\s+2\s+3\/8 × 3 × 59|Face-laminated layers|Final size is the finished/);
    expect(t).toContain('the Shaper file cuts it to 59-1/2"; start from a 59-5/8" blank (+1/8" trim)');
    expect(t).not.toMatch(/\bS1\b|7\/32 \(0\.21\)/);
  });

  it('quotes the same resaw lane count as step 1 of the assembly', () => {
    const stepText = pkg.data.steps.flatMap((s) => (s.items ?? []).flatMap(function walk(q: { text: string; sub?: { text: string; sub?: unknown[] }[] }): string[] { return [q.text, ...(q.sub ?? []).flatMap((x) => walk(x as never))]; })).join('\n');
    expect(pkg.data.cutList.resaw.length).toBeGreaterThan(0);
    for (const pool of pkg.data.cutList.resaw) {
      expect(html, pool.board).toContain(esc(pool.laneCountText));
      // step 1 words the lanes its own way (which width is for what, which lane is the spare); the lane count is the same
      expect(stepText, pool.board).toContain(`${pool.ripLanes} lanes`);
    }
  });

  it('names parts, not keys, in the board plan and the nesting list', () => {
    const t = sectionText('boards') + sectionText('nesting');
    expect(t).not.toMatch(/\b(?:joist|beam-[RF]|brake-knee-[LR]|transom-rear|storage-[a-z]+-[a-z]+|seat-wedge-[LR])\b/);
  });
});
