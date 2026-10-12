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
    for (const h of ['# Oak, by board thickness', '# Resawn strips', '# Okoume plywood', '# Metal stock']) expect(csv).toContain(h);
    expect(csv).toContain(pkg.data.cutList.csv.oak.split('\n')[0]);
    expect(csv).toContain('# Face-laminated layers (D-70)'); // the beams, knees and chocks (no 12/4)
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
    expect(html).not.toMatch(/<script|<link|<img|<iframe|@import|url\(/i);
    expect(html).not.toMatch(/\ssrc="/i);
    // the only URLs are the SVG namespace, the design link quoted in the header and the vendor links Eric gave (BOM lines with a `url`)
    const vendor = new Set([...pkg.data.bom.sections.flatMap((s) => s.lines.map((l) => l.url).filter((u): u is string => !!u)), ...Object.values(OAK_ALT_PRICE_PER_BF).map((q) => q.url).filter((u): u is string => !!u)].map(esc));
    expect(vendor.size).toBeGreaterThan(0);
    const urls = [...html.matchAll(/https?:\/\/[^\s"'<)]+/g)].map((m) => m[0]);
    expect(urls.filter((u) => u !== 'http://www.w3.org/2000/svg' && u !== 'https://example.test/#x' && !vendor.has(u))).toEqual([]);
    // every external link opens in a new tab without an opener
    const anchors = [...html.matchAll(/<a href="(https?:[^"]+)"([^>]*)>/g)];
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) { expect(vendor.has(a[1]), a[1]).toBe(true); expect(a[2]).toContain('target="_blank"'); expect(a[2]).toContain('rel="noopener"'); }
    expect((html.match(/<svg\b/g) ?? []).length).toBe(pkg.data.nest.sheets.length);
    expect(new TextEncoder().encode(html).length).toBeLessThan(4_000_000);
  });

  it('contains every assembly step title, with its clamp and cure text and its checks', () => {
    expect(pkg.data.steps.length).toBeGreaterThan(20);
    for (const s of pkg.data.steps) {
      expect(html, `step ${s.n}`).toContain(`${s.n}. ${esc(s.title)}`);
      if (s.clampCure) expect(html, `step ${s.n} clampCure`).toContain(esc(s.clampCure));
      for (const c of s.checks) expect(html, `step ${s.n} check`).toContain(esc(c));
      for (const t of s.instructions) expect(html, `step ${s.n} instruction`).toContain(esc(t));
    }
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
    for (const g of cl.oak) for (const r of g.rows) expect(html, r.partNo).toContain(esc(r.name));
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

describe('build book: laminations, links, bulk parts and finishing touches', () => {
  const html = (pkg.files.find((f) => f.name === 'build-book.html')!.data) as string;
  const bom = pkg.data.bom;

  it('shows each face-laminated part with its layers in the cut list and the board plan', () => {
    expect(html).toContain('Face-laminated parts');
    expect(html).toContain('Face-laminated layers');
    for (const r of pkg.data.cutList.oak.flatMap((g) => g.rows).filter((q) => q.lamination)) expect(html, r.partNo).toContain(esc(`face-laminated: ${r.lamination!.text}`));
    expect(html).toMatch(/beam-F layer 1\/3/);
    expect(html).not.toMatch(/12\/4 \(usable/);
  });

  it('prints the BOM links as anchors that open in a new tab, and the material of each fastener line', () => {
    expect(html).toContain('<a href="https://www.thewoodyard.com/current-pricing-list/" target="_blank" rel="noopener">thewoodyard.com</a>');
    expect(html).toContain('href="https://www.aircraftspruce.com/catalog/wppages/okume.php"');
    expect(html).toContain('<strong>Material:</strong>');
    expect(html).toContain(esc(bom.sections.find((s) => s.id === 'fasteners')!.notes![0]));
  });

  it('shows the bulk and touches sections with their subtotals, and the totals as build + bulk + touches', () => {
    expect(html).toContain('Bulk parts (shop stock)');
    expect(html).toContain('Finishing touches subtotal');
    expect(html).toContain('Bulk parts (shop stock) subtotal');
    expect(html).toContain(`Lights subtotal`);
    expect(html).toContain(esc(bom.totalsText));
    expect(bom.totalsText).toBe(`Build ${usd(bom.coreUsd)} + bulk parts ${usd(bom.bulkUsd)} + finishing touches ${usd(bom.touchesUsd)} = ${usd(bom.totalUsd)}`);
    expect(html).toMatch(/need [\d.]+, \d+ packs? of \d+ at \$/);
  });

  it('writes the totals, the URLs and the pack data to bom.csv', () => {
    const csv = pkg.files.find((f) => f.name === 'bom.csv')!.data as string;
    expect(csv).toContain(bom.totalsText);
    expect(csv).toContain('Finishing touches');
    expect(csv).toContain('Bulk parts (shop stock)');
    expect(csv.split('\r\n')[0]).toContain('URL');
  });
});
