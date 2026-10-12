/**
 * Rear mounts (build review r2 MUST-4 / S2 / S7, D-48; D-55): the foot brake's mounting (bolted to the top of the axle beam, nothing in the rails), the rear axle
 * beam's notch seat and hold-down angles, and the fasteners long enough for their stacks. (The D-48 bearing plates, doublers and the cross shaft, and the D-53 rail notch
 * and transom bracket, are gone.)
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, validateParams, type Params } from '../params';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { handleGeometry } from './handle';
import { brakeGeometry } from './brake';
import { worldAABB } from './bounds';
import { beamSeat, boltLength, inchesText, nutHeight, railSection, washerThick } from './rear-mount';
import { transformPoint } from './bounds';
import type { Part, Vec3 } from './types';

const defaults = defaultParams();
const parts = buildModel(defaults);
const byId = (id: string) => parts.find((x) => x.id === id)!;
const L = computeLayout(defaults);
const world = (part: Part, at: Vec3) => transformPoint(part.transform, at);

describe('foot brake mounts (D-55)', () => {
  it('the rails and hangers are not cut or drilled for the brake: the pivot brackets bolt to the TOP of the rear axle beam, so the thrust loop closes inside the axle (no brake joints on the rails or the hangers)', () => {
    for (const id of ['rail-L', 'rail-R', 'axle-hanger-L', 'axle-hanger-R']) {
      const r = byId(id);
      expect(r.joints?.some((j) => /^brake-/.test(j.to)), id).toBeFalsy();
    }
    for (const tag of ['L', 'R']) {
      const br = byId(`brake-bracket-${tag}`);
      expect(br.joints?.some((j) => j.type === 'bolt' && j.to === 'beam-R' && j.count === 2), `${br.id} beam bolts`).toBe(true);
      expect(br.joints?.some((j) => j.to.startsWith('rail-'))).toBeFalsy();
    }
  });
  it('the bracket flange bolts clear the rod, the rod clamp plates and the hold-down angles, and stay inside the beam', () => {
    const g = brakeGeometry(defaults, L);
    const fl = g.tongue.flange;
    for (const [x, y] of fl.bolts) {
      expect(Math.abs(x - L.beamR.x) - defaults.brakeBracketBoltDiameterIn / 2).toBeGreaterThan(defaults.axleDiameterIn / 2);
      expect(L.beamR.x + L.beamR.thick / 2 - x).toBeGreaterThan(defaults.brakeBracketBoltDiameterIn);
      expect(y).toBeLessThan(L.beamR.len / 2 - 1);
    }
    const clamp = worldAABB(byId('clamp-RL1'));
    expect(fl.y1).toBeLessThan(clamp.min[1]);
    const hd = worldAABB(byId('beam-hold-down-L'));
    expect(fl.y0).toBeGreaterThan(hd.max[1]);
  });
  it('bolted only: no welding anywhere in the brake, and every steel plate is outsourced or drilled stock with a source', () => {
    for (const x of parts.filter((q) => /^brake-/.test(q.id))) {
      expect(`${x.notes ?? ''} ${x.sourcing?.vendor ?? ''} ${x.material}`.toLowerCase(), x.id).not.toMatch(/\bweld(ed|ing)?\b/);
      if (x.kind === 'metal' || x.kind === 'purchased') expect(x.sourcing?.vendor, x.id).toBeTruthy();
    }
  });
  it('the validator accepts the defaults and flags a rear overhang that leaves the latch stud too long to reach the hook on the transom', () => {
    expect(validateParams(defaults).filter((i) => i.severity === 'error')).toEqual([]);
    const bad = validateParams({ ...defaults, rearOverhangIn: 6 });
    expect(bad.some((i) => i.keys.includes('brakePedalReachIn') && /stud/.test(i.message))).toBe(true);
  });
});

describe('rear axle hangers, beam seat and hold-downs (MUST-4, D-54)', () => {
  const seat = beamSeat(defaults, L)!;
  const rs = railSection(defaults, L);
  it('an oak hanger is glued and bolted to the inside face of each rail (the deck is 8 in up, D-56: the 3 in deep rail reaches only 0.85 in below the beam top): 5 x 0.75 in, from the rail top down to 1.35 in under the beam top', () => {
    // Hand: the beam top = wheel radius 5 + rod radius 0.375 = 5.375 (underslung); the hanger bottom = 5.375 - 1.35 = 4.025; the top = the deck underside 7.528.
    expect(L.beamR.top).toBeCloseTo(5.375, 9);
    for (const tag of ['L', 'R']) {
      const s = tag === 'L' ? 1 : -1;
      const hg = byId(`axle-hanger-${tag}`);
      const b = worldAABB(hg), rail = worldAABB(byId(`rail-${tag}`));
      expect(b.min[2]).toBeCloseTo(5.375 - defaults.axleSeatNotchIn, 9);
      expect(b.max[2]).toBeCloseTo(L.deckBot, 9); // the rail top
      expect(b.min[0]).toBeCloseTo(L.beamR.x - defaults.axleHangerWidthIn / 2, 9);
      expect(b.max[0]).toBeCloseTo(L.beamR.x + defaults.axleHangerWidthIn / 2, 9);
      // On the inside of the rail: its outer face is the rail's inner face (|y| 11.25), 3/4 in thick (inner face at 10.5).
      expect(s * (s > 0 ? b.max[1] : b.min[1])).toBeCloseTo(11.25, 9);
      expect(s * (s > 0 ? b.min[1] : b.max[1])).toBeCloseTo(11.25 - defaults.axleHangerThickIn, 9);
      expect(s * (s > 0 ? rail.min[1] : rail.max[1])).toBeCloseTo(11.25, 9);
      // The rail is a 3 in bar under the deck (D-56: the deck is only 8 in up); its bottom is 0.85 in below the beam top, so the hanger (bottom 1.35 in below the beam top) reaches just under it.
      expect(rail.min[2]).toBeCloseTo(L.railTop - defaults.railDepthIn, 9);
      expect(b.min[2]).toBeLessThan(rail.min[2]);
      expect(hg.grain).toBe('z'); // vertical grain, side-grain glue to the rail
      expect(hg.joints!.some((j) => j.type === 'glue' && j.to === `rail-${tag}`)).toBe(true);
      expect(hg.joints!.find((j) => j.type === 'bolt' && j.to === `rail-${tag}`)!.count).toBe(2);
    }
    expect(rs.zBot).toBeCloseTo(5.375 - 1.35, 9);
    expect(rs.zSolidTop).toBeCloseTo(L.deckBot, 9);
    expect(rs.yOut).toBeCloseTo(11.25, 9);
    expect(rs.yIn).toBeCloseTo(10.5, 9);
  });
  it('the hanger is notched on its underside to bear on the beam top; the whitelist entry is replaced by a bounded one', () => {
    expect(seat).not.toBeNull();
    expect(seat.depth).toBeCloseTo(L.beamR.top - (L.beamR.top - defaults.axleSeatNotchIn), 9); // 1.35"
    expect(seat.depth).toBeCloseTo(1.35, 9);
    expect(seat.x1 - seat.x0).toBeCloseTo(L.beamR.thick + 2 * defaults.beamNotchClearIn, 9); // 2.5 + 2 x 1/16 = 2.625
    expect(seat.remain).toBeGreaterThan(1.5); // 8.9" of oak above the notch (the whole hanger is solid up to the rail top)
    expect(seat.remain).toBeCloseTo(L.railTop - L.beamR.top, 9);
    // the overlap of the hanger's box and the beam is exactly the notch: no more than its depth and width
    const beam = worldAABB(byId('beam-R'));
    const hanger = worldAABB(byId('axle-hanger-L'));
    const dz = Math.min(beam.max[2], hanger.max[2]) - Math.max(beam.min[2], hanger.min[2]);
    expect(dz).toBeCloseTo(seat.depth, 6);
    expect(beam.max[0] - beam.min[0]).toBeLessThanOrEqual(seat.x1 - seat.x0);
    for (const tag of ['L', 'R']) {
      const h = byId(`axle-hanger-${tag}`);
      const j = h.joints!.find((q) => q.to === 'beam-R' && q.type === 'dado')!;
      expect(j.size).toMatch(/notch/);
      expect(byId('beam-R').joints!.some((q) => q.to === h.id && q.type === 'dado')).toBe(true);
      expect(world(h, j.at![0])[0]).toBeCloseTo(L.beamR.x, 6);
      expect(Math.abs(world(h, j.at![0])[1])).toBeCloseTo(11.25 - defaults.axleHangerThickIn / 2, 6); // mid-thickness of the hanger
    }
    // the notch volume (2.625 x 1.35 x 0.75 = 2.66 in^3) comes out of the hanger mass: a wider notch makes it lighter
    const oakLb = (seat.volume / 1728) * defaults.oakDensityPcf;
    expect(seat.volume).toBeCloseTo(2.625 * 1.35 * 0.75, 9);
    expect(oakLb).toBeGreaterThan(0.05);
    const loose = { ...defaults, beamNotchClearIn: 0.25 } as Params;
    expect(validateParams(loose).filter((i) => i.severity === 'error')).toEqual([]);
    expect(buildModel(loose).find((x) => x.id === 'axle-hanger-L')!.massLb).toBeLessThan(byId('axle-hanger-L').massLb);
  });
  it('hangers follow the axle: with a different wheel size or beam position the notch still ends 1.35 in under the beam top and the hanger touches the beam only in the notch', () => {
    const variants: Partial<Params>[] = [{ wheelDiameterIn: 11 }, { axleBeamPosition: 1 }, { axleStyle: 1, axleBeamDepthIn: 2.5 }, { rearTrackIn: 36.5 }];
    let built = 0;
    for (const q of variants) {
      const p = { ...defaults, ...q } as Params;
      if (validateParams(p).some((i) => i.severity === 'error')) continue;
      built++;
      const ps = buildModel(p);
      const Lp = computeLayout(p);
      const sp = beamSeat(p, Lp);
      if (!sp) { expect(ps.some((x) => x.id.startsWith('axle-hanger-'))).toBe(false); continue; }
      const hg = worldAABB(ps.find((x) => x.id === 'axle-hanger-L')!), beam = worldAABB(ps.find((x) => x.id === 'beam-R')!);
      expect(hg.min[2], JSON.stringify(q)).toBeCloseTo(Lp.beamR.top - p.axleSeatNotchIn, 9);
      expect(Math.min(beam.max[2], hg.max[2]) - Math.max(beam.min[2], hg.min[2]), JSON.stringify(q)).toBeCloseTo(sp.depth, 6);
    }
    expect(built).toBeGreaterThanOrEqual(2);
  });
  it('each side has a real 316 angle bracket with sourcing, bolts through the hanger and down through the beam, `at` on the written positions', () => {
    for (const { tag, s } of [{ tag: 'L', s: 1 }, { tag: 'R', s: -1 }]) {
      const hd = byId(`beam-hold-down-${tag}`);
      expect(hd.kind).toBe('metal');
      expect(hd.material).toMatch(/316/);
      expect(hd.sourcing?.vendor).toMatch(/316/);
      expect(hd.stock).toBeDefined();
      const jr = hd.joints!.find((j) => j.to === `axle-hanger-${tag}`)!; // D-54: the upright leg lies on the HANGER's inner face
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
      // the hanger bolts are above the notch ceiling and below the deck ledge (and the hanger's own, higher bolts to the rail)
      for (const [, z] of seat.hd.railBolts) { expect(z).toBeGreaterThan(seat.zTop + 3 * defaults.beamHoldDownBoltDiameterIn); expect(z).toBeLessThan(L.deckBot - 1.5 * defaults.beamHoldDownBoltDiameterIn); }
      const b = worldAABB(hd), hg = worldAABB(byId(`axle-hanger-${tag}`));
      expect(b.max[2]).toBeLessThan(L.deckBot); // under the deck
      // the upright leg lies flat on the hanger's inner face (|y| 10.5) and inside the hanger's fore-aft width; the flat leg runs inboard along the beam top
      expect(s > 0 ? b.max[1] : -b.min[1]).toBeCloseTo(railSection(defaults, L).yIn, 9);
      expect(b.min[0]).toBeGreaterThanOrEqual(hg.min[0]);
      expect(b.max[0]).toBeLessThanOrEqual(hg.max[0]);
      expect(b.min[2]).toBeCloseTo(L.beamR.top, 9);
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
  it('the socket bolts are 2-1/4 as computed from the stack (not the round-2 1-1/2 carriage bolts)', () => {
    const sock = byId('handle-socket-L').joints!.find((j) => j.to === 'transom-rear')!;
    const stack = defaults.handleSocketWallIn + L.transom + defaults.blockingThickIn; // 1.625
    expect(boltLength(stack, 0.25, 2)).toBe(2.25);
    expect(sock.size).toMatch(/2-1\/4/);
    expect(sock.size).toMatch(/button-head/);
    expect(sock.at).toHaveLength(2);
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

describe('the push-handle sockets and the girder / stub-axle variants (D-53, D-55)', () => {
  it('the girder (hull-beam) frame and a stub-axle design still build the brake and mount the pivot brackets on the axle beam', () => {
    for (const q of [{ frameStyle: 1 }, { axleStyle: 1 }] as Partial<Params>[]) {
      const p = { ...defaults, ...q } as Params;
      const ps = buildModel(p);
      expect(ps.some((x) => x.id === 'brake-beam')).toBe(true);
      expect(ps.some((x) => x.id === 'brake-bracket-L')).toBe(true);
      expect(ps.some((x) => x.id === 'brake-arm-R')).toBe(true);
    }
  });
});
