import { describe, expect, it } from 'vitest';
import { buildModel } from '.';
import { defaultParams } from '../params';
import { localBounds } from './bounds';
import { computeLayout } from './layout';
import { STEP } from './build-utils';
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

// ── Round 2 (Phase 4 critics, round 1) ──

/** Local extents (x, y, z) of a part's geometry. */
const localExt = (part: Part): Vec3 | null => {
  const g = part.geometry;
  if (g.type === 'box') return [...g.size];
  if (g.type === 'extrusion' || g.type === 'mesh') { const b = localBounds(g); return [0, 1, 2].map((k) => b.max[k] - b.min[k]) as Vec3; }
  return null;
};

describe('grain is a LOCAL axis (types.ts)', () => {
  // Parts whose grain axis is deliberately the second-longest local dimension (the rest must be the longest).
  const SECOND_LONGEST_OK: Record<string, string> = {
    'axle-hanger': 'vertical grain on purpose: the hanger is a vertical strap (D-54)',
    'seat-hinge-backer': 'a 3.47 x 3 pad, nearly square: grain across the sled so the pin hole bites side grain',
    'storage-latch-block': 'vertical grain on purpose: no end grain under the latch screws (S5)',
    'brake-knee': 'grain along the outrigger arm (across the sled), the load path (D-65)',
  };
  const graded = parts.filter((x) => x.grain && ['lumber', 'bentlam', 'sheet'].includes(x.kind));
  it('has a grain axis on every graded part that is the longest local dimension, or the second-longest with a documented reason', () => {
    expect(graded.length).toBeGreaterThan(60);
    for (const x of graded) {
      const e = localExt(x);
      if (!e) continue;
      const k = 'xyz'.indexOf(x.grain!);
      const rank = e.filter((v) => v > e[k] + 1e-6).length; // 0 = longest
      const key = Object.keys(SECOND_LONGEST_OK).find((id) => (x.partNo ?? x.id).startsWith(id) || x.id.startsWith(id));
      expect(rank, `${x.id}: grain ${x.grain} on local extents ${e.map((v) => v.toFixed(2)).join(' x ')}`).toBeLessThanOrEqual(key ? 1 : 0);
    }
  });
  it('puts the bulkhead, handlebow, handle posts, wedges and crest strip grain along their own long local axis', () => {
    expect(get('bow-bulkhead').grain).toBe('x'); // local x is the 18.5 in width across the hull (it was the world letter 'y')
    expect(get('handle-bar').grain).toBe('x');
    expect(get('handle-post-L').grain).toBe('y');
    expect(get('seat-wedge-L').grain).toBe('y');
    expect(get('seat-crest-strip').grain).toBe('z');
    expect(get('brake-shoe-L').grain).toBe('x');
  });
});

describe('side webs run into the bulkhead dado as they run into the transom dado', () => {
  const L = computeLayout(p);
  it('ends at the dado bottom at both ends', () => {
    const dd = p.deckCaptureDepthIn;
    for (const tag of ['L', 'R']) {
      const web = get(`side-${tag}-web`);
      const prof = (web.geometry as { profile: Vec2[] }).profile;
      const xs = prof.map((q) => q[0]);
      expect(Math.min(...xs)).toBeCloseTo(L.xRear + L.transom - dd, 6); // transom dado bottom
      expect(Math.max(...xs)).toBeCloseTo(L.bulkhead.x0 + dd, 6); // bulkhead dado bottom: its rear face plus the dado depth
    }
  });
  it('keeps the trim allowance in the stock only (0.1 in over the flat development)', () => {
    const web = get('side-L-web');
    expect(web.stock!.l).toBeGreaterThan(59.4);
    expect(web.notes).toMatch(/runs 0\.25" into the dado/);
  });
});

describe('fastener data (build review MUST-11)', () => {
  it('types the brake snap hook as a clip (pin), not a thumb-knob screw', () => {
    for (const tag of ['L', 'R']) for (const j of get(`brake-snap-${tag}`).joints!) expect(j.type).not.toBe('knob');
  });
  it('counts three screws in the thrust disc, spread around the disc, with a length', () => {
    const j = get('king-beam').joints!.find((q) => q.to === 'king-thrust')!;
    expect(j.count).toBe(3);
    expect(j.at!.length).toBe(3);
    expect(j.size).toMatch(/3 × #8 × [\d-/]+ 316/);
  });
  it('gives the grab-board screws, hanger bolts, roll-pad screws and stop-block screws real lengths, rounded up to a stocked size', () => {
    const grip = get('seat-grip-L').joints!.find((q) => q.type === 'bolt')!;
    expect(grip.size).toMatch(/^0\.25" × 2 316 button-head cap screws/); // grip 1.31 (board + 2 bands + web + 1/16 strip) + 2 washers + nylock nut + 2 threads = 1.86, rounded up to 2
    const hanger = get('axle-hanger-L').joints!.find((q) => q.type === 'bolt' && q.to === 'rail-L')!;
    expect(hanger.size).toMatch(/^0\.25" × \d(-\d\/\d)? 316 hex bolts/);
    for (const tag of ['L', 'R']) {
      const pad = get('beam-F').joints!.find((q) => q.to === `roll-pad-${tag}`)!;
      expect(pad.size).toMatch(/2 × #10 × [\d-/]+ 316/);
      const stop = get(`seat-wedge-${tag}`).joints!.find((q) => q.type === 'screw')!;
      expect(stop.count).toBe(2);
      expect(stop.size).toMatch(/2 × #8 × [\d-/]+ 316/);
    }
  });
  it('fastens the handle sockets with a bolt into a T-nut in the backer, length from the stack, no nylock nut', () => {
    for (const tag of ['L', 'R']) {
      const j = get(`handle-socket-${tag}`).joints!.find((q) => q.type === 'bolt')!;
      expect(j.size).toMatch(/^1\/4-20 × [\d-/]+ 316 button-head cap screws/);
      expect(j.size).toMatch(/T-NUT/);
      expect(j.size).toMatch(/NO nylock nut/);
      expect(j.size).not.toMatch(/fender washer \+ nylock/);
      expect(j.note).toMatch(/no nut/);
    }
  });
  it('moves the brake backers to the frame glue-up', () => {
    for (const tag of ['L', 'R']) expect(get(`brake-backer-${tag}`).step).toBe(STEP.frame);
  });
});

describe('seat back, signs and deck holes', () => {
  it('cuts the seat back at the size its notes and its file give (16 in), not 16.25', () => {
    const panel = get('seat-back-panel');
    expect(panel.stock!.w).toBeCloseTo(16, 6);
    expect(panel.stock!.l).toBeCloseTo(16, 6);
  });
  it('says the sign is a rectangle (the model is a box)', () => {
    const sign = get('sign-L');
    expect(sign.geometry.type).toBe('box');
    expect(sign.notes).not.toMatch(/rounded-oval plank/);
    expect(sign.notes).toMatch(/plain RECTANGLE/);
  });
  it('records the flat-position seat-pin holes through the deck, inside the deck', () => {
    const deck = get('deck');
    const pins = deck.joints!.filter((j) => j.type === 'pin');
    expect(pins.length).toBe(2);
    for (const j of pins) { expect(j.size).toMatch(/13\/32 clearance/); expect(inside(deck, j.at![0]), JSON.stringify(j.at)).toBe(true); }
  });
});
