/**
 * D-75 (readability review round 1, MUST-15 a–f): the physical fixes the shop-readable outputs exposed. The cross-laminated brake knee, the square seat for the bridle-tongue
 * carriage bolts, the seat-hinge backer's holes, the seat-back inserts and screws on one face, the absolute knee-bolt layout on the rail and backer, and the knee-bolt washers and
 * backing plate (no overlap, every counterbore sized).
 */
import { describe, expect, it } from 'vitest';
import { buildModel } from '.';
import { defaultParams } from '../params';
import { makeCtx } from './build-utils';
import { brakeGeometry } from './brake-layout';
import { carriageHeadDia, tongueSeatHalfWidth } from './pivot';
import { CARRIAGE_STOCK_IN, MIN_THREADS_PAST_NUT, stockBoltFit } from './rear-mount';
import { BOARD_WIDTH_IN } from '../build/cutlist';
import { tongueWidthAt, TONGUE_NUT_WASHER_OD_IN } from '../analysis/bridle';
import { makeContext } from '../analysis/context';
import { runChecks } from '../analysis/index';
import type { Mat4, Part, Vec3 } from './types';

const p = defaultParams();
const parts = buildModel(p);
const get = (id: string): Part => parts.find((x) => x.id === id)!;
const ctx = makeCtx(p);
const actx = makeContext(p, buildModel(p, { rider: 'goal', cargo: true }), buildModel(p, { rider: 'none', cargo: false, seat: 'stowed' }));
const g = brakeGeometry(ctx.p, ctx.L);
const toWorld = (m: Mat4, v: Vec3): Vec3 => [0, 1, 2].map((k) => m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k]) as Vec3;

describe('(a) the brake knee is cross-laminated (D-75; the layup flipped by D-77)', () => {
  it('three layers, UPRIGHT / ACROSS / UPRIGHT (z / y / z): D-77 removed the outboard ear the D-75 front ACROSS layer carried, so the outer layers are UPRIGHT (the leg and the strap screws)', () => {
    for (const tag of ['L', 'R']) expect(get(`brake-knee-${tag}`).layerGrain).toEqual(['z', 'y', 'z']);
    expect(g.knee.layers.map((q) => q.grain)).toEqual(['z', 'y', 'z']);
    const t = g.knee.layers.map((q) => q.x1 - q.x0);
    for (const v of t) expect(v).toBeCloseTo(p.brakeKneeDepthIn / 3, 9);
  });
  it('each UPRIGHT layer is one board wide; the ACROSS layer is edge-glued from two pieces that fit a board, the joint clear of the top bolt hole and of the shoulder', () => {
    const allow = p.laminateWidthAllowanceIn;
    const height = g.knee.zTop - g.knee.zBot, reach = g.knee.yOut - g.y.face;
    expect(reach + allow).toBeLessThanOrEqual(BOARD_WIDTH_IN);
    expect(height + allow).toBeGreaterThan(BOARD_WIDTH_IN); // so the ACROSS layer is edge-glued
    const zg = g.knee.zEdgeGlue;
    expect(zg - g.knee.zBot + allow).toBeLessThanOrEqual(BOARD_WIDTH_IN);
    expect(g.knee.zTop - zg + allow).toBeLessThanOrEqual(BOARD_WIDTH_IN);
    const topHole = Math.max(...g.bolts.zs) + g.bolts.dia / 2;
    expect(zg - topHole).toBeGreaterThan(0.75);
    expect(Math.abs(g.knee.zLeg - zg)).toBeGreaterThanOrEqual(0.75 - 1e-9); // D-77: 3/4 in above the shoulder (the taller knee); D-75 had it below
    expect(get('brake-knee-L').notes).toMatch(/CROSS-LAMINATED \(D-75/);
  });
  it('the analysis counts only the layers whose grain suits each check: the leg on the UPRIGHT layers, the arm, roof and floor on the ACROSS layer; the D-75 ear checks are gone with the ear', () => {
    const cs = runChecks(p, { includeTruck: false });
    const mount = cs.find((c) => c.id === 'brake-mount')!, pivot = cs.find((c) => c.id === 'brake-pivot')!;
    const leg = mount.details!.find((d) => /knee leg just above the top bolt row/.test(d.name))!;
    expect(leg.util).toBeLessThan(0.5); // two UPRIGHT layers now (0.72 with one)
    expect(pivot.details!.some((d) => /layer islands pulled off|bridge ahead of the slot|outboard ear/.test(d.name))).toBe(false);
    expect(pivot.details!.some((d) => /knee roof over the pocket/.test(d.name))).toBe(true);
    expect(mount.status).toBe('pass');
    expect(pivot.status).toBe('pass');
  });
});

describe('(b) the bridle-tongue carriage bolts seat on a square face', () => {
  it('the head front face is square out past each carriage-bolt head, so the hole is the head length deep and the stock bolt engages the whole nut', () => {
    const ys = tongueSeatHalfWidth(p);
    const head = carriageHeadDia(p.tongueBoltDiaIn);
    expect(ys).toBeLessThanOrEqual(p.tongueBoltOffsetIn - head / 2 - 1 / 32);
    const xb = ctx.L.king.x + ctx.L.beamF.thick / 2, xh = xb + p.tongueHeadLenIn;
    // just in front of the head face, the taper is inside the bolt heads
    expect(tongueWidthAt(actx, xh + 0.01) / 2).toBeLessThan(p.tongueBoltOffsetIn - head / 2);
    const fit = stockBoltFit(p.tongueHeadLenIn + ctx.L.beamF.thick, p.tongueBoltDiaIn, 1, CARRIAGE_STOCK_IN);
    expect(fit.pastNutIn).toBeGreaterThanOrEqual(MIN_THREADS_PAST_NUT / 16 - 1e-9); // 1.5 threads of 3/8-16 past the nylon insert
    expect(fit.stockIn).toBe(6.5);
    const j = get('bridle-tongue').joints!.find((q) => q.type === 'bolt')!;
    expect(j.size).toMatch(/6-1\/2/);
    expect(j.note).toMatch(/SQUARE front face/);
    // the nut washers on the beam's rear face do not overlap (2 x 2 in apart)
    expect(2 * p.tongueBoltOffsetIn).toBeGreaterThan(TONGUE_NUT_WASHER_OD_IN);
  });
});

/** Distance (in) from each hole edge to the nearest side of a box part, in its two large-face axes. */
function holeEdgeDistances(x: Part): Array<{ what: string; d: number }> {
  const sz = (x.geometry as { size: Vec3 }).size;
  const thin = sz.indexOf(Math.min(...sz));
  const out: Array<{ what: string; d: number }> = [];
  for (const j of x.joints ?? []) {
    if (!j.diaIn || !j.at || j.type === 'glue') continue;
    for (const a of j.at) for (let k = 0; k < 3; k++) if (k !== thin) out.push({ what: `${j.type} ${j.to} axis ${k}`, d: sz[k] / 2 - Math.abs(a[k]) - j.diaIn / 2 });
  }
  return out;
}

describe('(c) holes in the oak backers keep 3/8 in of wood to the edge', () => {
  it('the seat-hinge backers: the flat-pin hole and the hinge screws are where the hinge and the flat pin really are, at least 3/8 in from every edge', () => {
    for (const tag of ['L', 'R']) {
      const bk = get(`seat-hinge-backer-${tag}`);
      const ds = holeEdgeDistances(bk);
      expect(ds.length).toBe(2 * 4); // 3 screws + 1 pin, two in-plane axes each
      for (const q of ds) expect(q.d, `${bk.id} ${q.what}`).toBeGreaterThanOrEqual(0.375);
      // the pin hole is the flat pin's station, not the bounding-box corner the locator used to pick
      const pin = bk.joints!.find((q) => q.type === 'pin')!;
      const w = toWorld(bk.transform, pin.at![0]);
      const hinge = get(`seat-hinge-${tag}`);
      const hw = hinge.joints!.find((q) => q.to === bk.id)!.at!.map((a) => toWorld(hinge.transform, a));
      const bw = bk.joints!.find((q) => q.to === hinge.id)!.at!.map((a) => toWorld(bk.transform, a));
      for (let i = 0; i < 3; i++) { expect(bw[i][0]).toBeCloseTo(hw[i][0], 6); expect(bw[i][1]).toBeCloseTo(hw[i][1], 6); }
      expect(w[0]).toBeGreaterThan(hw[0][0] + 1); // ahead of the hinge screws, near the joist the pad butts
    }
  });
  it('the brake backers: the knee-bolt holes keep 3/8 in of wood to every edge', () => {
    for (const tag of ['L', 'R']) for (const q of holeEdgeDistances(get(`brake-backer-${tag}`))) expect(q.d, q.what).toBeGreaterThanOrEqual(0.375);
  });
});

describe('(d) the seat-back hinge inserts and their screws use ONE face', () => {
  it('the insert mouths are on the panel FRONT face (local z = thickness, which faces forward), and the hinge screws into them come from the front', () => {
    const panel = get('seat-back-panel');
    const plyT = (panel.geometry as { depth: number }).depth;
    const fwd = [panel.transform[8], panel.transform[9], panel.transform[10]];
    expect(fwd[0]).toBeGreaterThan(0.9); // local +z points forward: the front face
    for (const tag of ['L', 'R']) {
      const ins = panel.joints!.find((q) => q.to === `seat-hinge-${tag}`)!;
      for (const a of ins.at!) expect(a[2]).toBeCloseTo(plyT, 9);
      expect(ins.size).toMatch(/from the front face/);
      expect(ins.note).toMatch(/FRONT/);
      const scr = get(`seat-hinge-${tag}`).joints!.find((q) => q.to === 'seat-back-panel')!;
      expect(`${scr.size} ${scr.note}`).toMatch(/front face/);
      expect(scr.note).not.toMatch(/on the back\b/);
    }
  });
});

describe('(e) the knee-bolt holes have an absolute layout on the rail and the backer', () => {
  it('the rail carries the four holes at the knee bolt points, dimensioned from its finished rear end and its top edge', () => {
    for (const [tag, s] of [['L', 1], ['R', -1]] as const) {
      const rail = get(`rail-${tag}`);
      const h = rail.joints!.find((q) => q.type === 'hole' && q.to === `brake-knee-${tag}`)!;
      expect(h.count).toBe(g.bolts.count);
      const pts = g.bolts.zs.flatMap((z) => g.bolts.xs.map((x): Vec3 => [x, s * g.y.face, z]));
      for (let i = 0; i < pts.length; i++) for (let k = 0; k < 3; k++) expect(toWorld(rail.transform, h.at![i])[k]).toBeCloseTo(pts[i][k], 6);
      expect(h.size).toMatch(/from the rail's finished rear end/);
      expect(h.size).toMatch(/below its top edge/);
      const bk = get(`brake-backer-${tag}`);
      const bh = bk.joints!.find((q) => q.type === 'hole' && q.to === `rail-${tag}`)!;
      expect(bh.size).toMatch(/from the backer's rear end/);
      expect(bh.at!.map((a) => toWorld(bk.transform, a)[0]).sort()).toEqual(pts.map((q) => q[0]).sort().map((v) => expect.closeTo(v, 6)));
    }
  });
});

describe('(f) knee-bolt washers do not overlap, and every counterbore has a diameter and a depth', () => {
  it('the head washers on a bolt pair clear each other and stay on the knee leg; the nut side is one backing plate that covers every bolt and fits the backer', () => {
    const xs = g.bolts.xs, zs = g.bolts.zs, od = p.brakeMountWasherOdIn;
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThan(od);
    for (let i = 1; i < zs.length; i++) expect(zs[i] - zs[i - 1]).toBeGreaterThan(od);
    for (const x of xs) { expect(x - od / 2).toBeGreaterThanOrEqual(g.knee.x0); expect(x + od / 2).toBeLessThanOrEqual(g.knee.x1); }
    const pl = g.bolts.plate;
    for (const x of xs) { expect(x - g.bolts.dia).toBeGreaterThan(pl.x0); expect(x + g.bolts.dia).toBeLessThan(pl.x1); }
    for (const z of zs) { expect(z - g.bolts.dia).toBeGreaterThan(pl.z0); expect(z + g.bolts.dia).toBeLessThan(pl.z1); }
    expect(pl.x0).toBeGreaterThanOrEqual(g.backer.x0); expect(pl.x1).toBeLessThanOrEqual(g.backer.x1);
    expect(pl.z0).toBeGreaterThanOrEqual(g.backer.z0); expect(pl.z1).toBeLessThanOrEqual(g.backer.z1);
    for (const tag of ['L', 'R']) expect(get(`brake-backplate-${tag}`).kind).toBe('metal');
    // the 4 in stock bolt still clamps the stack with the nut fully engaged
    expect(get('brake-knee-L').joints!.find((q) => q.type === 'bolt')!.size).toMatch(/ x 4" /);
  });
  it('every counterbore in the joint data states its diameter and depth (a `cut` with both numbers, or both in the text)', () => {
    let n = 0;
    for (const x of parts) for (const j of x.joints ?? []) {
      if (j.cut?.kind === 'counterbore') {
        expect(j.cut.dia, `${x.id} -> ${j.to}`).toBeGreaterThan(0);
        expect(j.cut.depth, `${x.id} -> ${j.to}`).toBeGreaterThan(0);
      }
      for (const t of [j.size ?? '', j.note ?? '']) {
        const said = t.replace(/no counterbore[^,;.)]*/gi, '').replace(/old four [^)]*counterbores[^)]*/gi, '');
        if (!/counterbor/i.test(said)) continue;
        n++;
        // a diameter: N" wide / N" bit / N" dia; a depth: N" deep / N" up the rail
        expect(said, `${x.id} -> ${j.to}`).toMatch(/\d[\d/-]*" (wide|bit|dia)|\(\d[\d/-]*" bit\)/);
        expect(said, `${x.id} -> ${j.to}`).toMatch(/\d[\d/-]*" (deep|up the rail)/);
      }
    }
    expect(n).toBeGreaterThan(0); // the rail-to-chine screws and the thrust-disc screws
  });
});
