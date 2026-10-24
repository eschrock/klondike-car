/**
 * Cut-list fit (D-93): the cut list must be long, wide and thick enough for what the model asks of every part.
 *   1. a straight part's final size covers its own geometry (the seat-back crest strip was cut to its thin edge, not its wedge);
 *   2. a bent part (plan-curved wall, sheer band) is cut as long as its developed length, not its x extent;
 *   3. a crossmember in the bow taper is listed at its long point, so it can be scribed to the bent rails;
 *   4. the rough strip carries the overhang the build steps ask for (the gunwale band stands past each web end for the end stops; the rails are glued 1/2" long).
 */
import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { localBounds } from '../model/bounds';
import { defaultParams, KNEE_MOUNT, WEATHER_SPEC, type Params } from '../params';
import type { Part } from '../model/types';
import { cutList, isBuilt } from './cutlist';

const TOL = 1 / 32;
const CASES: Array<[string, Params]> = [
  ['default', defaultParams()],
  ['extreme', { ...defaultParams(), weatherSpec: WEATHER_SPEC.extreme }],
  ['fixed knees', { ...defaultParams(), kneeMount: KNEE_MOUNT.fixed }],
];
const MODELS = CASES.map(([tag, p]) => ({ tag, p, parts: buildModel(p) }));

const built = (parts: Part[]): Part[] => parts.filter((x) => isBuilt(x) && ['lumber', 'sheet', 'bentlam'].includes(x.kind) && !!x.stock);
const planWall = (x: Part): x is Part & { geometry: { type: 'mesh'; positions: number[]; profile: [number, number][] } } => x.geometry.type === 'mesh' && !!x.geometry.profile;

/** The plan-wall's centerline y at each profile x (the mesh has its two faces at y = yc(x) ± t/2). */
function planYc(x: Part & { geometry: { positions: number[] } }): Map<string, number> {
  const acc = new Map<string, { s: number; n: number }>();
  const pos = x.geometry.positions;
  for (let i = 0; i < pos.length; i += 3) {
    const k = pos[i].toFixed(6), a = acc.get(k) ?? { s: 0, n: 0 };
    a.s += pos[i + 1]; a.n += 1; acc.set(k, a);
  }
  return new Map([...acc].map(([k, a]) => [k, a.s / a.n]));
}

/** The top edge of a plan wall as (x, y, z) points: the highest profile point at each x, in x order. */
function topEdge(x: Part & { geometry: { positions: number[]; profile: [number, number][] } }): Array<[number, number, number]> {
  const yc = planYc(x), top = new Map<string, number>();
  for (const [px, pz] of x.geometry.profile) { const k = px.toFixed(6); top.set(k, Math.max(top.get(k) ?? -Infinity, pz)); }
  return [...top].map(([k, z]): [number, number, number] => [Number(k), yc.get(k) ?? 0, z]).sort((a, b) => a[0] - b[0]);
}
const pathLen = (pts: Array<[number, number, number]>, withZ: boolean): number =>
  pts.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1], withZ ? q[2] - pts[i - 1][2] : 0) : 0), 0);

describe('D-93 fit 1: a straight part is cut big enough for its geometry', () => {
  for (const { tag, parts } of MODELS) {
    it(`${tag}: sorted final T x W x L (T times the plies of a laminate) covers the sorted extents of every box, extrusion and solid mesh`, () => {
      const short: string[] = [];
      for (const x of built(parts).filter((q) => !planWall(q))) {
        const b = localBounds(x.geometry);
        const ext = [0, 1, 2].map((k) => b.max[k] - b.min[k]).sort((u, v) => u - v);
        const s = x.stock!;
        const st = [s.t * (x.plies ?? 1), s.w, s.l].sort((u, v) => u - v);
        if (st.some((v, i) => v < ext[i] - TOL)) short.push(`${x.id}: final ${st.map((v) => v.toFixed(3)).join(' x ')} < model ${ext.map((v) => v.toFixed(3)).join(' x ')}`);
      }
      expect(short).toEqual([]);
    });
  }
});

describe('D-93 fit 2: a bent part is cut as long as its developed length', () => {
  for (const { tag, parts } of MODELS) {
    it(`${tag}: every plan-curved wall's final length covers its developed top edge (plan S, and the sheer for a band that follows it), and its thickness the wall`, () => {
      const walls = built(parts).filter(planWall);
      expect(walls.map((x) => x.id)).toEqual(expect.arrayContaining(['rail-L', 'side-L-chine', 'side-L-chine-in', 'side-L-gunwale', 'side-L-gunwale-in', 'side-L-web']));
      const short: string[] = [];
      for (const x of walls) {
        const edge = topEdge(x);
        const dev = pathLen(edge, !!x.geometry.grainFollowsTop);
        if (x.stock!.l < dev - TOL) short.push(`${x.id}: final length ${x.stock!.l.toFixed(3)} < developed ${dev.toFixed(3)}`);
        const t = (x.geometry as { thickness?: number }).thickness ?? 0;
        // (2026-10-24: gunwale cap strip) the cap is 1/8" tall and as wide as the web: its stock width, not its thickness, spans the wall.
        const across = /-gunwale-cap$/.test(x.id) ? x.stock!.w : x.stock!.t * (x.plies ?? 1);
        if (across < t - 1e-6) short.push(`${x.id}: final thickness ${across.toFixed(3)} < wall ${t.toFixed(3)}`);
      }
      expect(short).toEqual([]);
    });
    it(`${tag}: an edge-bent gunwale band is cut as long as its CENTERLINE: the top edge plus half the width times the turn of the sheer`, () => {
      for (const x of built(parts).filter(planWall).filter((q) => q.geometry.grainFollowsTop)) {
        const e = topEdge(x), n = e.length - 1;
        const du = (i: number, j: number): number => Math.hypot(e[j][0] - e[i][0], e[j][1] - e[i][1]);
        const ang = (i: number, j: number): number => Math.atan2(e[j][2] - e[i][2], du(i, j));
        const turn = Math.abs(ang(n - 1, n) - ang(0, 1));
        expect(x.stock!.l, x.id).toBeGreaterThanOrEqual(pathLen(e, true) + (x.stock!.w / 2) * turn - TOL);
      }
    });
  }
});

describe('D-93 fit 3: a crossmember in the bow taper is listed at its long point', () => {
  for (const { tag, parts } of MODELS) {
    it(`${tag}: every crossmember that butts the rails is at least as long as the rails are apart at its rear AND its front face`, () => {
      const rail = parts.find((q) => q.id === 'rail-L')!;
      if (!planWall(rail)) throw new Error('rail-L is not a plan wall');
      const t = (rail.geometry as { thickness?: number }).thickness!;
      const yc = [...planYc(rail)].map(([k, y]): [number, number] => [Number(k), y]).sort((a, b) => a[0] - b[0]);
      const innerAt = (x: number): number => {
        const i = Math.max(1, yc.findIndex((q) => q[0] >= x));
        const [x0, y0] = yc[i - 1], [x1, y1] = yc[i];
        return Math.abs(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1)) - t / 2;
      };
      const members = parts.filter((q) => /^(joist-\d+|king-beam)$/.test(q.id));
      expect(members.length).toBeGreaterThan(5);
      let checked = 0;
      for (const j of members) {
        const b = localBounds(j.geometry), cx = j.transform[12], cy = j.transform[13];
        const xr = cx + b.min[0], xf = cx + b.max[0], yEnd = cy + b.max[1];
        if (innerAt(xf) - yEnd > 0.1) continue; // cut back to a hanger or a backer, not butted to the rail
        checked += 1;
        const need = 2 * Math.max(innerAt(xr), innerAt(xf));
        expect(j.stock!.l, `${j.id}: listed ${j.stock!.l.toFixed(3)}, the rails are ${need.toFixed(3)} apart at the long point`).toBeGreaterThanOrEqual(need - TOL);
        expect(j.stock!.l, `${j.id}: no longer than the long point needs`).toBeLessThanOrEqual(need + TOL);
      }
      expect(checked).toBeGreaterThan(5);
    });
  }
});

describe('D-93 fit 4: the rough strip carries the overhang the steps ask for', () => {
  for (const { tag, p, parts } of MODELS) {
    it(`${tag}: the gunwale strip reaches ${p.gunwaleEndLongIn}" past each web end; the rail strip is glued 1/2" long at each end; the chine strip reaches the web ends`, () => {
      const cl = cutList(parts, p);
      const roughOf = (partNo: string): number => cl.strips.find((r) => r.partNo === partNo)!.rough.l;
      const get = (id: string): Part => parts.find((q) => q.id === id)!;
      const web = localBounds(get('side-L-web').geometry);
      for (const id of ['side-L-gunwale', 'side-L-gunwale-in']) {
        const g = get(id);
        if (!planWall(g)) throw new Error(`${id} is not a plan wall`);
        const e = topEdge(g), n = e.length - 1;
        const cosAt = (i: number, j: number): number => Math.hypot(e[j][0] - e[i][0], e[j][1] - e[i][1]) / Math.hypot(e[j][0] - e[i][0], e[j][1] - e[i][1], e[j][2] - e[i][2]);
        const webPast = (e[0][0] - web.min[0]) / cosAt(0, 1) + (web.max[0] - e[n][0]) / cosAt(n - 1, n);
        expect(webPast).toBeGreaterThan(0.4); // the web stands 1/4" past each band end, into the dados
        expect(roughOf(g.partNo!), id).toBeGreaterThanOrEqual(g.stock!.l + webPast + 2 * p.gunwaleEndLongIn - 1e-6);
      }
      expect(roughOf('rail')).toBeGreaterThanOrEqual(get('rail-L').stock!.l + 2 * 0.5 - 1e-6);
      for (const partNo of ['side-chine-out', 'side-chine-in']) expect(roughOf(partNo), partNo).toBeGreaterThanOrEqual(get('side-L-web').stock!.l - 1e-6);
      // and every strip still comes out of the board the pool buys
      for (const pool of cl.resaw) for (const lane of pool.laneStrips) for (const s of lane) expect(s.lengthIn, `${s.partNo} in a ${pool.boardLengthIn}" board`).toBeLessThanOrEqual(pool.boardLengthIn);
    });
  }
});
