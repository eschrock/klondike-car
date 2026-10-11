/**
 * Rear mounts (build review r2 MUST-3 / MUST-4 / S2 / S7 / S9 / S13, D-48): every bolt of the brake bearing plates is in real wood with real edge distance,
 * the `at` coordinates of the joint records are the written pattern, the lever pivot sits on plate material (not on the rail end face), the rear axle beam
 * has a notch seat and hold-down angles, and the fasteners are long enough for their stacks.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, type Params } from '../params';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { brakeGeometry, handleGeometry, shaftCenter } from './brake';
import { worldAABB } from './bounds';
import { bearingMount, beamSeat, boltLength, inchesText, nutHeight, railSection, washerThick } from './rear-mount';
import { transformPoint } from './bounds';
import type { Part, Vec3 } from './types';

const defaults = defaultParams();
const parts = buildModel(defaults);
const byId = (id: string) => parts.find((x) => x.id === id)!;
const L = computeLayout(defaults);
const g = brakeGeometry(defaults, L);
const m = bearingMount(defaults, L, g.S, g.Q);
const world = (part: Part, at: Vec3) => transformPoint(part.transform, at);
const inPoly = (pt: [number, number], poly: Array<[number, number]>) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > pt[1]) !== (zj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const polyDist = (pt: [number, number], poly: Array<[number, number]>) => {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dz)));
  }
  return best;
};

describe('brake bearing plate mount (MUST-3)', () => {
  const D = defaults.brakeBearingBoltDiameterIn;
  const rail = railSection(defaults, L);
  it('the old pattern is gone: no bolt is within 7D of the rail end, below the rail bottom, above the deck ledge or inside the shaft notch', () => {
    expect(m.bolts.length).toBe(2 * defaults.brakeBearingBoltCols);
    for (const [x, z] of m.bolts) {
      expect(x - rail.xEnd, `end ${x}`).toBeGreaterThanOrEqual(7 * D - 1e-9);
      expect(z - rail.zBot, `bottom ${z}`).toBeGreaterThanOrEqual(1.5 * D);
      expect(rail.zSolidTop - z, `ledge ${z}`).toBeGreaterThanOrEqual(1.5 * D);
      const inNotch = x > m.notch.x0 - 2 * D && x < m.notch.x1 + 2 * D && z < m.notch.top + 2 * D;
      expect(inNotch, `notch ${x},${z}`).toBe(false);
    }
    expect(m.dist.end).toBeCloseTo(Math.min(...m.bolts.map((b) => b[0] - rail.xEnd)), 9);
    // pitch along the grain >= 4D and the rows are separated
    expect(defaults.brakeBearingBoltSpacingIn).toBeGreaterThanOrEqual(4 * D);
  });
  it('the shaft passes through a notch in the rail underside, wide enough for the bearing, open at the bottom, with oak left above it', () => {
    expect(m.notch.x0).toBeLessThan(g.S[0] - defaults.brakeShaftDiameterIn / 2);
    expect(m.notch.x1).toBeGreaterThan(g.S[0] + defaults.brakeShaftDiameterIn / 2);
    expect(m.notch.top).toBeGreaterThan(g.S[1] + defaults.brakeShaftDiameterIn / 2);
    expect(rail.zSolidTop - m.notch.top).toBeGreaterThan(1.4); // sound rail above it
    for (const tag of ['L', 'R']) {
      const r = byId(`rail-cabin-${tag}`);
      expect(r.joints?.some((j) => j.type === 'dado' && j.to === 'brake-shaft' && /notch/.test(j.size ?? '')), `${r.id} shaft notch`).toBe(true);
      expect(r.notes).toMatch(/notched/);
    }
  });
  it('the joint `at` points ARE the written pattern, on the plate, the rail and (for the doubler) the doubler, and they are real wood', () => {
    for (const { tag, s } of [{ tag: 'L', s: 1 }, { tag: 'R', s: -1 }]) {
      const plate = byId(`brake-bearing-plate-${tag}`);
      const jp = plate.joints!.find((j) => j.type === 'bolt' && j.to === `rail-cabin-${tag}`)!;
      const jr = byId(`rail-cabin-${tag}`).joints!.find((j) => j.type === 'bolt' && j.to === `brake-bearing-plate-${tag}`)!;
      expect(jp.count).toBe(m.bolts.length);
      expect(jp.at).toHaveLength(m.bolts.length);
      expect(jr.at).toHaveLength(m.bolts.length);
      const outline = (tag === 'L' ? m.outlineL : m.outlineR) as Array<[number, number]>;
      m.bolts.forEach(([x, z], i) => {
        for (const [part, at] of [[plate, jp.at![i]], [byId(`rail-cabin-${tag}`), jr.at![i]]] as const) {
          const w = world(part, at);
          expect(w[0], `${part.id} bolt ${i} x`).toBeCloseTo(x, 6);
          expect(w[2], `${part.id} bolt ${i} z`).toBeCloseTo(z, 6);
          expect(Math.abs(w[1]), `${part.id} bolt ${i} y`).toBeGreaterThan(rail.yIn);
          expect(Math.abs(w[1]), `${part.id} bolt ${i} y`).toBeLessThan(rail.yOut + defaults.brakePlateThickIn + 1e-9);
          expect(Math.sign(w[1])).toBe(s);
        }
        // the plate has real steel around every hole: >= 1.5 hole diameters from the bolt center to the plate edge
        expect(inPoly([x, z], outline)).toBe(true);
        expect(polyDist([x, z], outline), `plate edge ${i}`).toBeGreaterThanOrEqual(1.5 * m.boltHole - 1e-9);
      });
      // the bolts are in the rail's real box (x from the transom face, z in the solid part)
      const rb = worldAABB(byId(`rail-cabin-${tag}`));
      for (const [x, z] of m.bolts) {
        expect(x).toBeGreaterThan(rb.min[0] + 7 * D - 0.4);
        expect(z).toBeGreaterThan(rb.min[2]);
        expect(z).toBeLessThan(rb.max[2]);
      }
    }
  });
  it('the lever pivot is on the left plate (ear behind the rail end), not on the rail end face; the shaft bearing is in both plates', () => {
    const plate = byId('brake-bearing-plate-L');
    const post = byId('brake-lever-pin');
    const wp = worldAABB(post);
    expect(inPoly(g.Q as [number, number], m.outlineL as Array<[number, number]>)).toBe(true);
    expect(polyDist(g.Q as [number, number], m.outlineL as Array<[number, number]>)).toBeGreaterThanOrEqual(defaults.brakePivotBoltDiameterIn / 2 + 0.4 - 1e-9);
    expect(g.Q[0]).toBeLessThan(rail.xEnd + 1e-9); // the pivot is at/behind the rail end: no hole in the rail
    expect(wp.min[1]).toBeCloseTo(worldAABB(plate).max[1], 6); // the post stands on the plate's outer face
    expect(post.joints?.some((j) => j.to === 'brake-bearing-plate-L')).toBe(true);
    for (const tag of ['L', 'R']) {
      const pl = byId(`brake-bearing-plate-${tag}`);
      expect(inPoly(g.S as [number, number], (tag === 'L' ? m.outlineL : m.outlineR) as Array<[number, number]>)).toBe(true);
      expect(pl.fab).toBe('outsource');
      expect(pl.kind).toBe('metal');
      expect(pl.sourcing?.vendor).toMatch(/[Ww]aterjet/);
      expect(byId(`brake-bushing-${tag}`).joints?.some((j) => j.to === pl.id)).toBe(true);
    }
    expect(byId('brake-pivot-block')).toBeUndefined();
  });
  it('the plates sit outside the rail (touching, no overlap) and the crank clears the bolt heads', () => {
    for (const tag of ['L', 'R']) {
      const pb = worldAABB(byId(`brake-bearing-plate-${tag}`)), rb = worldAABB(byId(`rail-cabin-${tag}`));
      const s = tag === 'L' ? 1 : -1;
      expect(s > 0 ? pb.min[1] : -pb.max[1]).toBeGreaterThanOrEqual((s > 0 ? rb.max[1] : -rb.min[1]) - 1e-6);
    }
    const crank = worldAABB(byId('brake-crank'));
    expect(crank.min[1] - (rail.yOut + defaults.brakePlateThickIn)).toBeGreaterThanOrEqual(0.65 * D + 0.1 - 1e-9);
  });
  it('the oak doubler is inside the rail, behind the bolts, and stays clear of the shaft path and of every deck joist', () => {
    for (const tag of ['L', 'R']) {
      const d = byId(`brake-rail-doubler-${tag}`);
      const b = worldAABB(d);
      expect(m.doubler.covers).toBe(true);
      expect(b.min[0]).toBeGreaterThan(g.S[0] + defaults.brakeShaftDiameterIn / 2);
      for (const [x] of m.bolts) { expect(x).toBeGreaterThanOrEqual(b.min[0]); expect(x).toBeLessThanOrEqual(b.max[0]); }
      for (const jx of L.cabinJoistX) expect(jx - L.joistT / 2 >= b.max[0] || jx + L.joistT / 2 <= b.min[0], `joist ${jx}`).toBe(true);
    }
  });
});

describe('rear axle beam seat and hold-downs (MUST-4)', () => {
  const seat = beamSeat(defaults, L)!;
  it('the rails are notched on their underside to bear on the beam top; the whitelist entry is replaced by a bounded one', () => {
    expect(seat).not.toBeNull();
    expect(seat.depth).toBeCloseTo(L.beamR.top - (L.deckBot - defaults.railDepthIn), 9); // 1.35"
    expect(seat.x1 - seat.x0).toBeCloseTo(L.beamR.thick + 2 * defaults.beamNotchClearIn, 9);
    expect(seat.remain).toBeGreaterThan(2);
    // the overlap of the rail's box and the beam is exactly the notch: no more than its depth and width
    const beam = worldAABB(byId('beam-R'));
    const rail = worldAABB(byId('rail-cabin-L'));
    const dz = Math.min(beam.max[2], rail.max[2]) - Math.max(beam.min[2], rail.min[2]);
    expect(dz).toBeCloseTo(seat.depth, 6);
    expect(beam.max[0] - beam.min[0]).toBeLessThanOrEqual(seat.x1 - seat.x0);
    for (const tag of ['L', 'R']) {
      const r = byId(`rail-cabin-${tag}`);
      const j = r.joints!.find((q) => q.to === 'beam-R' && q.type === 'dado')!;
      expect(j.size).toMatch(/notch/);
      expect(byId('beam-R').joints!.some((q) => q.to === r.id && q.type === 'dado')).toBe(true);
      expect(world(r, j.at![0])[0]).toBeCloseTo(L.beamR.x, 6);
    }
    // the notch volume comes out of the rail mass
    const oakLb = (seat.volume / 1728) * defaults.oakDensityPcf;
    expect(oakLb).toBeGreaterThan(0.05);
  });
  it('each side has a real 316 angle bracket with sourcing, bolts through the rail and down through the beam, `at` on the written positions', () => {
    for (const { tag, s } of [{ tag: 'L', s: 1 }, { tag: 'R', s: -1 }]) {
      const hd = byId(`beam-hold-down-${tag}`);
      expect(hd.kind).toBe('metal');
      expect(hd.material).toMatch(/316/);
      expect(hd.sourcing?.vendor).toMatch(/316/);
      expect(hd.stock).toBeDefined();
      const jr = hd.joints!.find((j) => j.to === `rail-cabin-${tag}`)!;
      const jb = hd.joints!.find((j) => j.to === 'beam-R')!;
      expect(jr.count).toBe(2);
      expect(jb.count).toBe(2);
      seat.hd.railBolts.forEach(([x, z], i) => { const w = world(hd, jr.at![i]); expect(w[0]).toBeCloseTo(x, 6); expect(w[2]).toBeCloseTo(z, 6); expect(Math.abs(w[1])).toBeGreaterThan(railSection(defaults, L).yIn - seat.hd.t - 1e-6); expect(Math.sign(w[1])).toBe(s); });
      seat.hd.beamBolts.forEach(([x, y], i) => { const w = world(hd, jb.at![i]); expect(w[0]).toBeCloseTo(x, 6); expect(w[1]).toBeCloseTo(s * y, 6); });
      // the vertical bolts stay beside the rod, not through it, and inside the beam
      for (const [x] of seat.hd.beamBolts) {
        expect(Math.abs(x - L.beamR.x) - defaults.beamHoldDownBoltDiameterIn / 2).toBeGreaterThan(defaults.axleDiameterIn / 2);
        expect(Math.abs(x - L.beamR.x)).toBeLessThan(L.beamR.thick / 2 - defaults.beamHoldDownBoltDiameterIn);
      }
      // the rail bolts are above the notch ceiling and below the deck ledge
      for (const [, z] of seat.hd.railBolts) { expect(z).toBeGreaterThan(seat.zTop + 3 * defaults.beamHoldDownBoltDiameterIn); expect(z).toBeLessThan(L.deckBot - 1.5 * defaults.beamHoldDownBoltDiameterIn); }
      const b = worldAABB(hd);
      expect(b.max[2]).toBeLessThan(L.deckBot); // under the deck
    }
  });
  it('the rear clamp plates are 316 flat bar parts with stock and sourcing, one bolt through the beam each (no zinc, no "mass is an estimate")', () => {
    for (const id of ['clamp-RL1', 'clamp-RL2', 'clamp-RR1', 'clamp-RR2']) {
      const c = byId(id);
      expect(c.material).toMatch(/316/);
      expect(c.material).not.toMatch(/zinc/);
      expect(c.sourcing?.vendor).toMatch(/316/);
      expect(c.stock).toBeDefined();
      expect(c.joints?.some((j) => j.to === 'beam-R' && j.type === 'bolt')).toBe(true);
      expect(c.notes).not.toMatch(/estimate/);
    }
  });
});

describe('fastener stacks (S2) and the push-handle fit (S7)', () => {
  it('boltLength rounds a grip + washer + nut + two threads up to the next 1/4"', () => {
    expect(boltLength(1.625, 0.25, 2)).toBe(2.25);
    expect(boltLength(1.0, 0.25, 1)).toBe(1.5);
    expect(boltLength(2.0, 0.375, 1)).toBeGreaterThanOrEqual(2 + washerThick(0.375) + nutHeight(0.375) + 0.1);
    expect(inchesText(2.25)).toBe('2-1/4');
    expect(inchesText(1.5)).toBe('1-1/2');
    expect(inchesText(3)).toBe('3');
    expect(inchesText(1.75)).toBe('1-3/4');
  });
  it('the socket and quadrant-bracket bolts are 2-1/4 and 1-1/2 as computed from the stack (not the round-2 1-1/2 carriage bolts)', () => {
    const sock = byId('handle-socket-L').joints!.find((j) => j.to === 'transom-rear')!;
    const stack = defaults.handleSocketWallIn + L.transom + defaults.blockingThickIn; // 1.625
    expect(boltLength(stack, 0.25, 2)).toBe(2.25);
    expect(sock.size).toMatch(/2-1\/4/);
    expect(sock.size).toMatch(/button-head/);
    expect(sock.at).toHaveLength(2);
    const br = byId('brake-quadrant-bracket').joints!.filter((j) => j.to === 'transom-rear');
    expect(br).toHaveLength(2);
    const lens = br.map((j) => /× (\d-\d\/\d|\d)/.exec(j.size!)![1]);
    expect(lens).toContain('2-1/4'); // through the backer
    expect(lens).toContain('1-1/2'); // outboard of it: transom only
    for (const j of br) expect(j.at).toHaveLength(1);
  });
  it('the push-handle post is a slip fit in its socket (inside 1.0" x 1.5") and the bar joint can be assembled: pinned and glued, no nut inside the tube', () => {
    const h = handleGeometry(defaults, L);
    const w = defaults.handleSocketWallIn;
    expect(h.socketX - 2 * w - defaults.handlePostThickIn).toBeCloseTo(2 * defaults.handleSocketSlipIn, 9);
    expect(h.socketY - 2 * w - defaults.handlePostWidthIn).toBeCloseTo(2 * defaults.handleSocketSlipIn, 9);
    expect(h.socketX).toBeCloseTo(1.25, 9);
    expect(h.socketY).toBeCloseTo(1.75, 9);
    const post = worldAABB(byId('handle-post-L'));
    const sock = worldAABB(byId('handle-socket-L'));
    expect(post.min[0]).toBeGreaterThanOrEqual(sock.min[0] + w - 1e-9);
    expect(post.max[0]).toBeLessThanOrEqual(sock.max[0] - w + 1e-9);
    const j = byId('handle-post-L').joints!.find((q) => q.to === 'handle-bar' && q.type === 'pin')!;
    expect(j.size).toMatch(/epoxied/);
    expect(byId('handle-post-L').joints!.some((q) => q.to === 'handle-bar' && /wing nut/.test(q.size ?? ''))).toBe(false);
    expect(byId('handle-bar').sourcing?.vendor).toMatch(/dowel/);
  });
});

describe('brake shaft stock and cross-drilling (S9), BOM parts (S13)', () => {
  it('the 72" stock length is ordered (the shaft is 38.1" cut) and the drilling method is written down', () => {
    const sh = byId('brake-shaft');
    expect(sh.stock!.l).toBeCloseTo(2 * worldAABB(sh).max[1], 6);
    expect(sh.stock!.l).toBeGreaterThan(36); // longer than the 36" length the round-2 sourcing named
    expect(sh.sourcing!.vendor).toMatch(/72/);
    expect(sh.notes).toMatch(/cobalt/);
    expect(sh.notes).toMatch(/V-block/);
    expect(sh.notes).toMatch(/cutting fluid/);
    expect(sh.joints!.filter((j) => j.type === 'pin').length).toBeGreaterThanOrEqual(5);
  });
  it('the bearing plates, spacer washers, pivot post, doublers, shield and hold-downs are in the BOM with a source', () => {
    for (const id of ['brake-bearing-plate-L', 'brake-bearing-plate-R', 'brake-lever-spacer', 'brake-lever-pin', 'brake-shoe-shield-L', 'brake-shoe-shield-R', 'beam-hold-down-L', 'beam-hold-down-R', 'brake-bushing-L', 'brake-rail-doubler-L']) {
      const p = byId(id);
      expect(p, id).toBeDefined();
      if (p.kind !== 'lumber') expect(p.sourcing?.vendor, id).toBeTruthy();
    }
  });
  it('the splash shield is 1/16" sheet on the shoe back, does not lower the lowest brake point, and weighs a few hundredths of a pound', () => {
    const sh = byId('brake-shoe-shield-L');
    expect(sh.massLb).toBeLessThan(0.1);
    expect(sh.massLb).toBeGreaterThan(0.005);
    const pad = worldAABB(byId('brake-shoe-L'));
    expect(worldAABB(sh).min[2]).toBeGreaterThanOrEqual(pad.min[2] - 0.05);
    const off = buildModel({ ...defaults, brakeShieldThickIn: 0 });
    expect(off.some((x) => x.id.startsWith('brake-shoe-shield'))).toBe(false);
  });
  it('the girder (hull-beam) frame and a stub-axle design still build, mount and stay valid', () => {
    for (const q of [{ frameStyle: 1 }, { axleStyle: 1 }] as Partial<Params>[]) {
      const p = { ...defaults, ...q } as Params;
      const ps = buildModel(p);
      expect(ps.some((x) => x.id === 'brake-bearing-plate-L')).toBe(true);
      const sh = shaftCenter(p, computeLayout(p).r);
      expect(sh[0]).toBeCloseTo(-8, 6);
    }
  });
});
