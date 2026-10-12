import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { BuildData, buildPackage, zipName, zipPackage } from './package';
import { crc32 } from './zip';

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
    for (const n of names) expect(readme).toContain(n);
  });

  it('puts every cut list table in cutlist.csv', () => {
    const csv = pkg.files.find((f) => f.name === 'cutlist.csv')!.data as string;
    for (const h of ['# Oak, by board thickness', '# Resawn strips', '# Okoume plywood', '# Metal stock']) expect(csv).toContain(h);
    expect(csv).toContain(pkg.data.cutList.csv.oak.split('\n')[0]);
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
