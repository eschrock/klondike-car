import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { BuildData } from './package';
import { flatPattern } from './flat';
import { COUNTER_CLEARANCE_IN, formDrawings } from './forms';
import { LASER_MAX_THICKNESS_IN, LASER_MAX_WIDTH_IN, clipShape, emptyShape, fitToBed, laserSvg, laserVerdict, layoutShapes, shapeArea, shapeBox } from './laser-svg';
import { distToPoly, polyArea, rectLoop } from './svg-util';

const p = defaultParams();
const parts = buildModel(p);
const data = new BuildData(parts, p);
const files = data.laser;
const byId = (id: string) => files.find((f) => f.id === id)!;

describe('laser verdict (D-86)', () => {
  const v = (o: Partial<Parameters<typeof laserVerdict>[0]>) => laserVerdict({ thicknessIn: 0.236, material: '6 mm Baltic birch plywood', widthIn: 12, heightIn: 40, ...o });
  it('passes 6 mm Baltic birch that fits the bed, whichever way round', () => {
    expect(v({}).ok).toBe(true);
    expect(v({ widthIn: 40, heightIn: 12 }).ok).toBe(true);
  });
  it('fails a sheet wider than the bed, a thick sheet and a non-wood part, each with its reason', () => {
    expect(v({ widthIn: 20, heightIn: 59.5 }).text).toMatch(/wider than the 18-1\/2" bed/);
    expect(v({ widthIn: 14.35, heightIn: 59.5 }).ok).toBe(true);
    expect(v({ thicknessIn: 0.472, material: '12 mm okoume marine plywood' }).text).toMatch(/thicker than the 1\/4"/);
    expect(v({ material: 'UHMW polyethylene', thicknessIn: 0.25 }).ok).toBe(false);
  });
});

describe('the cut list flags the laser parts', () => {
  const rows = data.cutList.sheets.flatMap((g) => g.rows);
  it('says yes for the thin panels that fit and why not for the rest', () => {
    const by = (n: RegExp) => rows.find((r) => n.test(r.name))!;
    expect(by(/Side sign/).laser.ok).toBe(true);
    expect(by(/Storage box side/).laser.ok).toBe(true);
    expect(by(/Storage box end/).laser.ok).toBe(true);
    expect(by(/Side panel \(web\)/).laser.ok).toBe(true);
    expect(by(/Storage lid/).laser.ok).toBe(true);
    expect(by(/Deck/).laser.text).toMatch(/thicker than/);
  });
  it('writes it into the CSV', () => {
    const [head, ...body] = data.cutList.csv.sheets.trim().split('\n');
    expect(head).toContain('Laser');
    expect(body.some((l) => l.includes(',yes,'))).toBe(true);
  });
  it('agrees with the laser files: a file is flagged fitting exactly when its cut-list rows say yes', () => {
    for (const f of files.filter((x) => x.kind === 'part')) {
      const row = rows.find((r) => r.partNo === f.id)!;
      expect(row.laser.ok, f.id).toBe(f.fits);
    }
  });
});

describe('laser part files', () => {
  it('exist for the thin parts that fit, and none for the 12 mm sheets', () => {
    expect(byId('sign').fits).toBe(true);
    expect(byId('storage-side').fits).toBe(true);
    expect(byId('side-web').fits).toBe(true);
    expect(files.find((f) => f.id === 'deck')).toBeUndefined();
  });

  it('keep the part at full size, long side along X, copies laid out', () => {
    const f = byId('storage-end');
    const flat = flatPattern(parts.find((x) => x.partNo === 'storage-end')!)!;
    const big = Math.max(flat.widthIn, flat.heightIn), small = Math.min(flat.widthIn, flat.heightIn);
    expect(f.pieces.length).toBe(f.qty);
    for (const q of f.pieces) { expect(q.widthIn).toBeCloseTo(big, 2); expect(q.heightIn).toBeCloseTo(small, 2); }
  });
});

describe('every laser file is an importable, full-size SVG', () => {
  for (const f of files) {
    it(f.id, () => {
      const m = /<svg [^>]*width="([\d.]+)in" height="([\d.]+)in" viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(f.svg);
      expect(m, 'size in inches, viewBox in 96 dpi pixels').not.toBeNull();
      expect(+m![3]).toBeCloseTo(+m![1] * 96, 1);
      expect(+m![4]).toBeCloseTo(+m![2] * 96, 1);
      expect(+m![1]).toBeCloseTo(f.widthIn, 3);
      expect(f.svg).not.toMatch(/<text/);
      expect(f.svg).not.toMatch(/fill="(?!none)/);
      expect(f.svg).toMatch(/id="[^"]*-outline" d="[^"]*" fill="none" stroke="#FF0000"/);
      // inner cuts come before the outline in the file (cut order), scores first
      expect(f.svg.indexOf('id="score"')).toBeLessThan(f.svg.indexOf('id="cut-inside"'));
      expect(f.svg.indexOf('id="cut-inside"')).toBeLessThan(f.svg.indexOf('id="cut-outline"'));
      expect(f.svg).not.toMatch(/NaN|undefined|Infinity/);
    });
  }
  it('are in the package under laser/, and the README lists them', () => {
    const names = data.files.map((x) => x.name);
    for (const f of files) expect(names).toContain(`laser/${f.fileName}`);
    expect(data.files.find((x) => x.name === 'README.txt')!.data as string).toContain('laser/rail-form.svg');
  });
});

describe('forms are cut in pieces that fit the bed', () => {
  it('no form piece is wider than the bed, and no form file is longer than the feed', () => {
    for (const f of files.filter((x) => x.kind === 'form')) {
      expect(f.fits, f.id).toBe(true);
      for (const q of f.pieces) expect(Math.min(q.widthIn, q.heightIn), `${f.id}: ${q.label}`).toBeLessThanOrEqual(LASER_MAX_WIDTH_IN + 1e-6);
      expect(f.widthIn, f.id).toBeLessThanOrEqual(118);
    }
  });

  it('the web template pieces together are exactly the web: the splits lose and gain nothing', () => {
    const fd = formDrawings(parts, p).find((d) => d.id === 'side-form')!;
    const web = flatPattern(parts.find((x) => x.id === 'side-L-web')!)!;
    const main = fd.laser!.find((l) => l.id === 'side-template')!;
    const under = fd.laser!.find((l) => l.id === 'side-template-under-layer')!;
    const area = (ls: typeof main) => ls.items.reduce((a, it) => a + it.qty * shapeArea(it.shape), 0);
    expect(area(main)).toBeCloseTo(Math.abs(polyArea(web.outer)), 3);
    expect(area(under)).toBeCloseTo(Math.abs(polyArea(web.outer)) - main.items.filter((it) => /front/.test(it.shape.id)).reduce((a, it) => a + shapeArea(it.shape), 0), 3);
    // the under layer carries no marks (it is hidden under the first)
    for (const it of under.items) expect(it.shape.score.length + it.shape.marks.length).toBe(0);
  });
});

describe('the rail form counter-form (the reverse image)', () => {
  const fd = formDrawings(parts, p).find((d) => d.id === 'rail-form')!;
  const laser = fd.laser![0];
  const form = laser.items.find((it) => it.shape.id === 'form-pattern')!.shape;
  const counter = laser.items.find((it) => it.shape.id === 'counter-form-pattern')!.shape;
  const pack = parts.find((x) => x.id === 'rail-L')!.geometry.type === 'mesh' ? ((parts.find((x) => x.id === 'rail-L')!.geometry as { thickness?: number }).thickness ?? 0) : 0;

  it('has a face one strip-pack thickness off the form face, all along it', () => {
    expect(pack).toBeGreaterThan(0.5);
    const top = Math.max(...counter.outer.map((q) => q[1]));
    const faceVerts = counter.outer.filter((q) => q[1] < top - 1e-6);
    expect(faceVerts.length).toBeGreaterThan(20);
    for (const q of faceVerts) expect(distToPoly(q, form.outer), `at ${q[0].toFixed(1)}`).toBeCloseTo(pack + COUNTER_CLEARANCE_IN, 1);
  });

  it('has a straight back parallel to the form back, so every clamp is square to both', () => {
    const top = Math.max(...counter.outer.map((q) => q[1]));
    const backVerts = counter.outer.filter((q) => Math.abs(q[1] - top) < 1e-6);
    expect(backVerts.length).toBe(2);
    const formBack = form.outer.filter((q) => Math.abs(q[1]) < 1e-9);
    expect(formBack.length).toBe(2);
    // both straight and horizontal: the clamp axis (vertical) is normal to both
    expect(backVerts[0][1]).toBe(backVerts[1][1]);
    expect(formBack[0][1]).toBe(formBack[1][1]);
    expect(top).toBeCloseTo(fd.dims.find((d) => d.key === 'counter-width')!.valueIn, 6);
  });

  it('is at least the stated wall thick everywhere and as long as the form', () => {
    const b = shapeBox(counter), fb = shapeBox(form);
    expect(b.u1 - b.u0).toBeCloseTo(fb.u1 - fb.u0, 1);
    const top = b.v1;
    for (const q of counter.outer.filter((c) => c[1] < top - 1e-6)) expect(top - q[1]).toBeGreaterThanOrEqual(fd.dims.find((d) => d.key === 'counter-wall')!.valueIn - 0.05);
  });

  it('is built in the steps in place of the old caul, and the clamp span uses its back', () => {
    const t = fd.build.flatMap((s) => [s.step, ...(s.sub ?? [])]).join(' ');
    expect(t).toMatch(/COUNTER-FORM: the reverse image/);
    expect(t).toMatch(/closes square across, from the form back to the counter-form back/);
    expect(t).not.toMatch(/CAUL/);
  });

  it('is drawn on the full-size sheet below the form', () => {
    expect(fd.svg).toContain('<g id="counterform">');
  });
});

describe('layout and splitting helpers', () => {
  it('splits a tall rectangle into a bed-high band and a sliver without losing area', () => {
    const tall = emptyShape('t', 'tall', rectLoop(0, 0, 30, 20));
    const bands = fitToBed(tall);
    expect(bands.length).toBe(2);
    expect(bands.reduce((a, s) => a + shapeArea(s), 0)).toBeCloseTo(30 * 20, 6);
    for (const s of bands) expect(shapeBox(s).v1 - shapeBox(s).v0).toBeLessThanOrEqual(LASER_MAX_WIDTH_IN);
  });

  it('keeps every piece inside the bed width and apart from its neighbors', () => {
    const items = [30, 29, 7, 7, 5, 20, 12].map((w, i) => ({ shape: emptyShape(`s${i}`, `s${i}`, rectLoop(0, 0, w, 3 + (i % 3) * 3)), qty: 1 }));
    const lay = layoutShapes(items);
    expect(lay.heightIn - 0.25).toBeLessThanOrEqual(LASER_MAX_WIDTH_IN + 1e-6);
    const boxes = lay.placed.map((pl) => { const b = shapeBox(pl.shape); return { x0: b.u0 + pl.x, y0: b.v0 + pl.y, x1: b.u1 + pl.x, y1: b.v1 + pl.y }; });
    boxes.forEach((a, i) => boxes.forEach((b, j) => { if (j > i) expect(a.x1 <= b.x0 + 1e-9 || b.x1 <= a.x0 + 1e-9 || a.y1 <= b.y0 + 1e-9 || b.y1 <= a.y0 + 1e-9, `${i} overlaps ${j}`).toBe(true); }));
    expect(laserSvg({ title: 't', desc: 'd', items }).svg).toContain('<path id="s0-outline"');
  });

  it('clipping keeps a circle with the side its center is on', () => {
    const s = { ...emptyShape('c', 'c', rectLoop(0, 0, 10, 4)), circles: [{ c: [2, 2] as [number, number], dia: 0.5 }, { c: [8, 2] as [number, number], dia: 0.5 }] };
    expect(clipShape(s, 'u', 5, 'lo', 'a', 'a').circles.length).toBe(1);
    expect(clipShape(s, 'u', 5, 'hi', 'b', 'b').circles.length).toBe(1);
  });

  it('keeps the thickness limit at 1/4 in so 6 mm passes and 12 mm does not', () => {
    expect(0.236).toBeLessThan(LASER_MAX_THICKNESS_IN);
    expect(0.472).toBeGreaterThan(LASER_MAX_THICKNESS_IN);
  });
});
