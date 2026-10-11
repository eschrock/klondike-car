/**
 * Rear mounts (build review r2 MUST-4 / S2 / S7, D-48; Phase 3c-1, D-53): the rail notch that guides the brake beam (and its keeper strap), the pivot bracket on
 * the rear transom, the rear axle beam's notch seat and hold-down angles, and the fasteners long enough for their stacks. (The D-48 bearing plates, doublers and
 * the cross shaft are gone.)
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, validateParams, type Params } from '../params';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { handleGeometry } from './handle';
import { beamLayout, linkTopZ } from './brake-layout';
import { worldAABB } from './bounds';
import { beamSeat, boltLength, inchesText, nutHeight, railSection, washerThick } from './rear-mount';
import { transformPoint } from './bounds';
import type { Part, Vec3 } from './types';

const defaults = defaultParams();
const parts = buildModel(defaults);
const byId = (id: string) => parts.find((x) => x.id === id)!;
const L = computeLayout(defaults);
const world = (part: Part, at: Vec3) => transformPoint(part.transform, at);

describe('brake beam notch and keeper (D-53)', () => {
  const rail = railSection(defaults, L);
  const bl = beamLayout(defaults, L.r, rail.zBot, rail.xEnd);
  it('the beam passes through a notch in each rail underside, open at the bottom, with at least 1 inch of rail left above it and clear of the rear transom', () => {
    expect(bl.notch.top).toBeGreaterThan(bl.zB + defaults.brakeBeamSizeIn / 2);
    expect(rail.zSolidTop - bl.notch.top).toBeGreaterThanOrEqual(1);
    expect(bl.notch.x1 - bl.notch.x0).toBeGreaterThan(defaults.brakeBeamSizeIn + bl.stroke);
    expect(bl.railEndWall).toBeGreaterThanOrEqual(0.1); // beam rear face to the transom inner face
    for (const tag of ['L', 'R']) {
      const r = byId(`rail-cabin-${tag}`);
      expect(r.joints?.some((j) => j.type === 'dado' && j.to === 'brake-beam' && /notch/.test(j.size ?? '')), `${r.id} beam notch`).toBe(true);
      expect(r.joints?.some((j) => j.type === 'screw' && j.to === `brake-keeper-${tag}` && j.count === 4)).toBe(true);
      expect(r.notes).toMatch(/REAR END \(D-53\)/);
    }
  });
  it('the beam sits on the keeper strap: beam bottom = rail bottom plane = keeper top; the strap is under the rail, not in it; the beam bottom clears the ground', () => {
    const beam = worldAABB(byId('brake-beam'));
    expect(beam.min[2]).toBeCloseTo(rail.zBot, 9);
    expect(beam.max[2]).toBeCloseTo(rail.zBot + defaults.brakeBeamSizeIn, 9);
    for (const tag of ['L', 'R'] as const) {
      const k = worldAABB(byId(`brake-keeper-${tag}`));
      expect(k.max[2]).toBeCloseTo(rail.zBot, 9);
      expect(k.min[2]).toBeCloseTo(rail.zBot - defaults.brakeKeeperThickIn, 9);
      expect(k.min[2]).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn);
      expect(k.min[0]).toBeLessThan(bl.notch.x0);
      expect(k.max[0]).toBeGreaterThan(bl.notch.x1);
      expect(Math.abs(k.min[1] + k.max[1]) / 2).toBeCloseTo(rail.yOut - rail.t / 2, 6);
    }
  });
  it('the notch is cut from the rail mass (the rail weighs less than its blank)', () => {
    const vol = (bl.notch.x1 - bl.notch.x0) * (bl.notch.top - rail.zBot) * rail.t;
    expect((vol / 1728) * defaults.oakDensityPcf).toBeGreaterThan(0.05);
  });
  it('the validator refuses a beam that sits into the rear transom and one that leaves less than an inch of rail under the deck', () => {
    expect(validateParams(defaults).filter((i) => i.severity === 'error')).toEqual([]);
    const bad = validateParams({ ...defaults, rearOverhangIn: 8 });
    expect(bad.some((i) => i.severity === 'error')).toBe(true);
    const tall = validateParams({ ...defaults, brakeBeamSizeIn: 2 });
    expect(tall.some((i) => i.severity === 'error' && i.keys.includes('brakeBeamSizeIn'))).toBe(true);
    // The link and clevis pass under the rear transom: deeper crossmembers lower its bottom edge onto them.
    const deep = validateParams({ ...defaults, crossmemberDepthIn: 2.5 });
    expect(deep.some((i) => i.severity === 'error' && i.keys.includes('crossmemberDepthIn') && /transom/.test(i.message))).toBe(true);
    expect(linkTopZ(defaults, bl.zB)).toBeLessThan(defaults.deckHeightIn - defaults.crossmemberDepthIn - 0.1);
  });
});

describe('brake pivot bracket on the rear transom (D-53)', () => {
  it('the base plate stands on the transom outer face (touching), bolted through it with 316 bolts, and carries the two ears; the quadrant ear is the left one', () => {
    const base = worldAABB(byId('brake-pivot-base'));
    const tr = worldAABB(byId('transom-rear'));
    expect(base.max[0]).toBeCloseTo(tr.min[0], 6);
    expect(base.min[2]).toBeGreaterThanOrEqual(tr.min[2]);
    expect(base.max[2]).toBeLessThanOrEqual(tr.max[2]);
    const j = byId('brake-pivot-base').joints!.find((q) => q.to === 'transom-rear')!;
    expect(j.count).toBe(4);
    expect(j.diaIn).toBe(defaults.brakeBracketBoltDiameterIn);
    expect(j.size).toMatch(/316/);
    expect(byId('brake-pivot-ear-L').partNo).toBe('brake-pivot-ear-quadrant');
    expect(byId('brake-pivot-ear-R').partNo).toBe('brake-pivot-ear');
    expect(byId('brake-pivot-ear-L').massLb).toBeGreaterThan(byId('brake-pivot-ear-R').massLb);
  });
  it('the lever stands behind the bracket at the centerline, clear of the push handle posts and the rear light, and comes off with the handle for transport', () => {
    const lever = worldAABB(byId('brake-lever'));
    expect(Math.abs(lever.max[1] + lever.min[1])).toBeLessThan(1e-6);
    expect(lever.max[1] - lever.min[1]).toBeCloseTo(defaults.brakeBarThickIn, 6);
    const post = worldAABB(byId('handle-post-L'));
    expect(lever.max[1]).toBeLessThan(post.min[1] - 5);
    expect(lever.max[2]).toBeLessThan(worldAABB(byId('handle-bar')).min[2]); // the grip stays under the handle bar
    for (const id of ['brake-lever', 'brake-lever-grip', 'brake-park-pin', 'brake-pivot-pin', 'brake-return-spring']) expect(byId(id).removable, id).toBe(true);
    const removed = buildModel(defaults, { removed: true });
    expect(removed.some((x) => x.id === 'brake-lever')).toBe(false);
    expect(removed.some((x) => x.id === 'brake-beam')).toBe(true);
  });
  it('bolted only: no welding anywhere in the brake, and every steel plate is outsourced or drilled stock with a source', () => {
    for (const x of parts.filter((q) => /^brake-/.test(q.id))) {
      expect(`${x.notes ?? ''} ${x.sourcing?.vendor ?? ''} ${x.material}`.toLowerCase(), x.id).not.toMatch(/\bweld(ed|ing)?\b/);
      if (x.kind === 'metal' || x.kind === 'purchased') expect(x.sourcing?.vendor, x.id).toBeTruthy();
    }
  });
});

describe('rear axle beam seat and hold-downs (MUST-4)', () => {
  const seat = beamSeat(defaults, L)!;
  it('the rails are notched on their underside to bear on the beam top; the whitelist entry is replaced by a bounded one', () => {
    expect(seat).not.toBeNull();
    expect(seat.depth).toBeCloseTo(L.beamR.top - (L.deckBot - defaults.railDepthIn), 9); // 1.35"
    expect(seat.x1 - seat.x0).toBeCloseTo(L.beamR.thick + 2 * defaults.beamNotchClearIn, 9);
    expect(seat.remain).toBeGreaterThan(1.5); // the 3" rail (one deck level, D-52) keeps 1.65" over the notch
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
  it('the socket bolts are 2-1/4 as computed from the stack (not the round-2 1-1/2 carriage bolts); the pivot bracket bolts go through the transom only', () => {
    const sock = byId('handle-socket-L').joints!.find((j) => j.to === 'transom-rear')!;
    const stack = defaults.handleSocketWallIn + L.transom + defaults.blockingThickIn; // 1.625
    expect(boltLength(stack, 0.25, 2)).toBe(2.25);
    expect(sock.size).toMatch(/2-1\/4/);
    expect(sock.size).toMatch(/button-head/);
    expect(sock.at).toHaveLength(2);
    const br = byId('brake-pivot-base').joints!.find((j) => j.to === 'transom-rear')!;
    expect(br.size).toContain(inchesText(boltLength(L.transom + defaults.brakePlateThickIn, defaults.brakeBracketBoltDiameterIn)));
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
    expect(byId('handle-bar').sourcing?.vendor).toMatch(/laminated/); // the handlebow is shop-laminated white oak (D-53), not a bought dowel
  });
});

describe('the push-handle sockets and the girder / stub-axle variants (D-53)', () => {
  it('the girder (hull-beam) frame and a stub-axle design still build and mount the brake beam in a notch', () => {
    for (const q of [{ frameStyle: 1 }, { axleStyle: 1 }] as Partial<Params>[]) {
      const p = { ...defaults, ...q } as Params;
      const ps = buildModel(p);
      expect(ps.some((x) => x.id === 'brake-beam')).toBe(true);
      expect(ps.some((x) => x.id === 'brake-keeper-L')).toBe(true);
      const bl = beamLayout(p, computeLayout(p).r, railSection(p, computeLayout(p)).zBot, railSection(p, computeLayout(p)).xEnd);
      expect(bl.xB).toBeLessThan(-6.5);
    }
  });
});
