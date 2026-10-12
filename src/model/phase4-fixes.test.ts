import { describe, expect, it } from 'vitest';
import { buildModel } from '.';
import { defaultParams } from '../params';
import { localBounds } from './bounds';
import type { Mat4, Part, Vec2, Vec3 } from './types';

/** Model-data fixes found by the Phase 4 build-output generators (docs/phase4-geometry-notes.md, "Model fixes (Phase 4)"). */
const p = defaultParams();
const parts = buildModel(p);
const get = (id: string): Part => parts.find((x) => x.id === id)!;
const toModel = (m: Mat4, l: Vec3): Vec3 => [m[0] * l[0] + m[4] * l[1] + m[8] * l[2] + m[12], m[1] * l[0] + m[5] * l[1] + m[9] * l[2] + m[13], m[2] * l[0] + m[6] * l[1] + m[10] * l[2] + m[14]];
const distToPoly = (q: Vec2, poly: Vec2[]): number => {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / (ex * ex + ey * ey || 1)));
    d = Math.min(d, Math.hypot(q[0] - a[0] - t * ex, q[1] - a[1] - t * ey));
  }
  return d;
};
const inside = (part: Part, a: Vec3, tol = 1e-6): boolean => {
  const b = localBounds(part.geometry);
  return [0, 1, 2].every((k) => a[k] >= b.min[k] - tol && a[k] <= b.max[k] + tol);
};

describe('grab boards (local-frame joint points)', () => {
  it.each(['L', 'R'])('seat-grip-%s: every joint point is inside the board in its own frame, at mid-thickness', (tag) => {
    const g = get(`seat-grip-${tag}`);
    const at = g.joints!.flatMap((j) => j.at ?? []);
    expect(at.length).toBe(6);
    for (const a of at) { expect(inside(g, a), JSON.stringify(a)).toBe(true); expect(a[2]).toBeCloseTo(p.grabBoardThickIn / 2, 9); }
  });
  it('the board points map to the model frame inside the board, in the gunwale band zone, on the correct side', () => {
    for (const [tag, sg] of [['L', 1], ['R', -1]] as const) {
      const g = get(`seat-grip-${tag}`);
      const yb = g.joints![0].at!.map((a) => toModel(g.transform, a)[1]);
      const yMid = yb[0];
      for (const y of yb) { expect(Math.sign(y)).toBe(sg); expect(y).toBeCloseTo(yMid, 9); }
      const board = get(`seat-grip-${tag}`);
      const ys = [toModel(board.transform, [0, 0, 0])[1], toModel(board.transform, [0, 0, p.grabBoardThickIn])[1]].sort((u, v) => u - v);
      expect(yb[0]).toBeGreaterThan(ys[0]);
      expect(yb[0]).toBeLessThan(ys[1]);
    }
  });
});

describe('seat-back panel data', () => {
  const panel = get('seat-back-panel');
  const g = panel.geometry as { outline: Vec2[]; depth: number };
  it('has its face grain along the panel (up the back), not along its thickness', () => {
    expect(panel.grain).toBe('y');
  });
  it('puts the pin holes at mid-thickness and every joint point inside the panel', () => {
    for (const j of panel.joints!.filter((q) => q.type === 'pin')) for (const a of j.at!) { expect(a[2]).toBeCloseTo(g.depth / 2, 9); expect(inside(panel, a), JSON.stringify(a)).toBe(true); }
    for (const j of panel.joints!) for (const a of j.at ?? []) expect(inside(panel, a), `${j.to} ${JSON.stringify(a)}`).toBe(true);
  });
  it('puts the six hinge inserts 1/2 in or more from every edge, in the front face, where the hinge leaf has its holes', () => {
    for (const tag of ['L', 'R']) {
      const j = panel.joints!.find((q) => q.to === `seat-hinge-${tag}`)!;
      expect(j.at!.length).toBe(3);
      for (const a of j.at!) {
        expect(a[2]).toBeCloseTo(g.depth, 9); // the mouth, on the front face
        expect(distToPoly([a[0], a[1]], g.outline), JSON.stringify(a)).toBeGreaterThanOrEqual(0.5 - 1e-9);
      }
      // the hinge's own leaf holes coincide with them in the model frame
      const hinge = get(`seat-hinge-${tag}`);
      const h = hinge.joints!.find((q) => q.to === 'seat-back-panel')!;
      const mp = j.at!.map((a) => toModel(panel.transform, a)).sort((u, v) => u[1] - v[1]);
      const mh = h.at!.map((a) => toModel(hinge.transform, a)).sort((u, v) => u[1] - v[1]);
      for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) expect(mp[i][k], `${tag} ${i} ${k}`).toBeCloseTo(mh[i][k], 6);
      // and the hinge (2 in knuckle) stays inside the panel's width
      const hy = hinge.transform[13];
      expect(Math.abs(hy) + 1).toBeLessThanOrEqual((g.outline.reduce((m, q) => Math.max(m, q[0]), 0)) + 1e-9);
    }
  });
});

describe('brake flap data', () => {
  for (const tag of ['L', 'R']) {
    const flap = get(`brake-flap-${tag}`);
    const thick = (flap.geometry as { depth: number }).depth;
    const block = get(`brake-pivot-block-${tag}`);
    it(`${tag}: every joint point is inside the flap's thickness and outline`, () => {
      const ol = (flap.geometry as { outline: Vec2[] }).outline;
      for (const j of flap.joints!) for (const a of j.at ?? []) {
        expect(a[2], `${j.to} ${JSON.stringify(a)}`).toBeGreaterThanOrEqual(-1e-9);
        expect(a[2], `${j.to} ${JSON.stringify(a)}`).toBeLessThanOrEqual(thick + 1e-9);
        expect(a[0]).toBeGreaterThanOrEqual(Math.min(...ol.map((q) => q[0])) - 1e-9);
        expect(a[0]).toBeLessThanOrEqual(Math.max(...ol.map((q) => q[0])) + 1e-9);
      }
    });
    it(`${tag}: the cord eye is in the rear end face at mid-thickness, inboard`, () => {
      const eye = flap.joints!.find((j) => j.to === `brake-cord-${tag}`)!.at![0];
      const ol = (flap.geometry as { outline: Vec2[] }).outline;
      expect(eye[0]).toBeCloseTo(Math.min(...ol.map((q) => q[0])), 6);
      expect(eye[2]).toBeCloseTo(thick / 2, 9);
      expect(Math.sign(eye[1])).toBe(tag === 'L' ? -1 : 1); // toward the centerline
    });
    it(`${tag}: block screws keep 3/8 in of oak to the pin's cross-hole edge, on the block, and agree with the block's own points`, () => {
      const pin = flap.joints!.find((j) => j.to === `brake-pivot-pin-${tag}`)!;
      const px = pin.at![0][0];
      const holeR = (pin.diaIn! + 1 / 32) / 2;
      const sj = flap.joints!.find((j) => j.to === `brake-pivot-block-${tag}` && j.type === 'screw')!;
      expect(sj.at!.length).toBe(sj.count);
      const blockLen = (block.geometry as { size: Vec3 }).size[0];
      const nose = Math.max(...(flap.geometry as { outline: Vec2[] }).outline.map((q) => q[0]));
      for (const a of sj.at!) {
        expect(Math.abs(a[0] - px) - holeR - sj.diaIn! / 2, JSON.stringify(a)).toBeGreaterThanOrEqual(0.375 - 1e-9);
        expect(a[0]).toBeLessThanOrEqual(nose - 0.25); // on the block: behind the nose by the end distance and inside its length
        expect(a[0]).toBeGreaterThanOrEqual(nose - blockLen + 0.25 - 1e-9);
        expect(Math.abs(a[1])).toBeLessThanOrEqual(1.25 / 2 - 0.25 + 1e-9); // inside the tongue by the edge distance
      }
      const bj = block.joints!.find((j) => j.to === flap.id && j.type === 'screw')!;
      const mf = sj.at!.map((a) => toModel(flap.transform, [a[0], a[1], thick])).sort((u, v) => u[1] - v[1] || u[0] - v[0]);
      const blockT = (block.geometry as { size: Vec3 }).size[2];
      const mb = bj.at!.map((a) => toModel(block.transform, [a[0], a[1], a[2] - blockT])).sort((u, v) => u[1] - v[1] || u[0] - v[0]);
      for (let i = 0; i < mf.length; i++) for (let k = 0; k < 3; k++) expect(mb[i][k], `${i} ${k}`).toBeCloseTo(mf[i][k], 6);
    });
    it(`${tag}: the shoe screws are on the flap underside and agree with the shoe's own points`, () => {
      const shoe = get(`brake-shoe-${tag}`);
      const sj = flap.joints!.find((j) => j.to === shoe.id && j.type === 'screw')!;
      for (const a of sj.at!) expect(a[2]).toBe(0);
      const bj = shoe.joints!.find((j) => j.to === flap.id && j.type === 'screw')!;
      const mf = sj.at!.map((a) => toModel(flap.transform, a)).sort((u, v) => u[0] - v[0]);
      const mb = bj.at!.map((a) => toModel(shoe.transform, a)).sort((u, v) => u[0] - v[0]);
      for (let i = 0; i < mf.length; i++) for (let k = 0; k < 3; k++) expect(mb[i][k], `${i} ${k}`).toBeCloseTo(mf[i][k], 6);
    });
  }
});

describe('sign knobs and dado text', () => {
  it('sign knob screws (#10-32, 0.19 major) go through a 7/32 clearance hole', () => {
    for (const j of get('sign-L').joints!.filter((q) => q.type === 'knob')) {
      expect(j.size).toMatch(/7\/32 clearance hole/);
      expect(j.size).not.toMatch(/3\/16 clearance/);
    }
  });
  it('the deck dado runs into the web dados and the web dados run out through the top edge, in both the transom and the bulkhead', () => {
    for (const id of ['transom-rear', 'bow-bulkhead']) {
      const dados = get(id).joints!.filter((j) => j.type === 'dado');
      expect(dados.find((j) => j.to === 'deck')!.size, id).toMatch(/into the web dados/);
      for (const j of dados.filter((q) => /web/.test(q.to))) expect(j.size, `${id} ${j.to}`).toMatch(/out through the top edge/);
    }
  });
});

describe('stale text', () => {
  it('the model notes carry no stale 2 x 4 sheet, scarf-the-halves, Aircraft Spruce or 6 mm seat back text, and no hard-coded S-ramp size', () => {
    const all = JSON.stringify(parts.map((x) => [x.notes, x.sourcing, (x.joints ?? []).map((j) => [j.size, j.note])]));
    expect(all).not.toMatch(/Aircraft Spruce/);
    expect(all).not.toMatch(/2 ?x ?4 ?(ft|sheet)/i);
    expect(all).not.toMatch(/scarf the (two )?halves/i);
    expect(all).not.toMatch(/6 mm seat back/i);
    expect(all).not.toMatch(/about 1\.25 in high|about 2\.75" high and 22" long/);
  });
});
