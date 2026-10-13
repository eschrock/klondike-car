/**
 * Rear mounts (build review r2 MUST-4 / S2 / S7, D-48; D-57): the step brake's mounting (knees bolted through the rails into oak backers), the rear axle
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

describe('step brake mounts (D-57)', () => {
  it('the rail is drilled for the brake knee (4 bolts a side) and backed by a glued oak doubler inside it; the axle hangers and the rear axle beam are not touched', () => {
    for (const tag of ['L', 'R']) {
      const knee = byId(`brake-knee-${tag}`);
      const j = knee.joints?.find((q) => q.type === 'bolt' && q.to === `rail-${tag}`);
      expect(j, `${knee.id} bolts`).toBeDefined();
      expect(j!.diaIn).toBe(defaults.brakeMountBoltDiaIn);
      expect(j!.count).toBe(defaults.brakeMountBoltColumns * defaults.brakeMountBoltRows);
      const bk = byId(`brake-backer-${tag}`);
      expect(bk.joints?.some((q) => q.type === 'glue' && q.to === `rail-${tag}`)).toBe(true);
    }
    for (const id of ['axle-hanger-L', 'axle-hanger-R', 'beam-R']) {
      expect(byId(id).joints?.some((q) => /^brake-/.test(q.to)), id).toBeFalsy();
    }
  });
  it('the backer lies on the rail inner face, behind the hanger, and the joist that met it is cut back to its face', () => {
    const g = brakeGeometry(defaults, L);
    const bk = worldAABB(byId('brake-backer-L'));
    expect(bk.max[1]).toBeCloseTo(L.hwC + L.side - defaults.railThicknessIn, 2); // the rail's inner face
    expect(bk.max[1] - bk.min[1]).toBeCloseTo(defaults.brakeBackerThickIn, 6);
    expect(bk.min[0]).toBeGreaterThan(worldAABB(byId('axle-hanger-L')).max[0]);
    // 3c-5: at the 8.5 in joist spacing no crossmember meets the backer (joist-2 ends at x = 5.9, the backer starts at 6.2), so it runs the full width; at 10 in the joist at x = 8 is cut back to the backer's face
    expect(worldAABB(byId('joist-2')).max[1]).toBeCloseTo(L.hwC + L.side - defaults.railThicknessIn, 2);
    const j2 = worldAABB(buildModel({ ...defaults, crossmemberSpacingIn: 10 }).find((x) => x.id === 'joist-2')!);
    expect(j2.max[1]).toBeCloseTo(bk.min[1], 2);
    expect(g.backer.x1).toBeGreaterThan(g.bolts.xs[g.bolts.xs.length - 1]);
  });
  it('bolted only: no welding anywhere in the brake, no steel plate, and every purchased part has a source', () => {
    for (const x of parts.filter((q) => /^brake-/.test(q.id))) {
      expect(`${x.notes ?? ''} ${x.sourcing?.vendor ?? ''} ${x.material}`.toLowerCase(), x.id).not.toMatch(/\bweld(ed|ing)?\b|a36|laser/);
      if (x.kind === 'metal' || x.kind === 'purchased') expect(x.sourcing?.vendor, x.id).toBeTruthy();
    }
  });
  it('the validator accepts the defaults and warns when the chock is taller than the room under the knee', () => {
    expect(validateParams(defaults).filter((i) => i.severity !== 'info' && i.keys.some((k) => /^brake/.test(k)))).toEqual([]);
    // railDepthIn 3.5: the knee bottom drops to 4.0 in, leaving 3.5 in for a 4 in chock
    expect(validateParams({ ...defaults, brakeChockHeightIn: 4, railDepthIn: 3.5 }).some((i) => i.keys.includes('brakeChockHeightIn'))).toBe(true);
  });
});

describe('rear axle hangers, beam seat and hold-downs (MUST-4, D-54)', () => {
  const seat = beamSeat(defaults, L)!;
  const rs = railSection(defaults, L);
  it('an oak hanger is glued and bolted to the inside face of each rail (the deck is 8 in up, D-56: the 3 in deep rail reaches only 0.85 in below the beam top): 5 x 0.75 in, from the rail top down to 1.35 in under the beam top', () => {
    // Hand: the beam top = wheel radius 5 + rod radius 0.3125 (D-71; 0.375 at 3/4 in) - the 0.03 the tube stands proud (D-62, D-71) = 5.3125 - 0.03 = 5.2825 (underslung; D-71 lowered the proud from 0.05 to 0.03); the hanger bottom = 5.2825 - 1.35 = 3.9325; the top = the deck underside 7.528.
    expect(L.beamR.top).toBeCloseTo(5.2825, 9);
    for (const tag of ['L', 'R']) {
      const s = tag === 'L' ? 1 : -1;
      const hg = byId(`axle-hanger-${tag}`);
      const b = worldAABB(hg), rail = worldAABB(byId(`rail-${tag}`));
      expect(b.min[2]).toBeCloseTo(5.2825 - defaults.axleSeatNotchIn, 9);
      expect(b.max[2]).toBeCloseTo(L.deckBot, 9); // the rail top
      expect(b.min[0]).toBeCloseTo(L.beamR.x - defaults.axleHangerWidthIn / 2, 9);
      expect(b.max[0]).toBeCloseTo(L.beamR.x + defaults.axleHangerWidthIn / 2, 9);
      // On the inside of the rail: its outer face is the rail's inner face (|y| 11.25), 3/4 in thick (inner face at 10.5).
      expect(s * (s > 0 ? b.max[1] : b.min[1])).toBeCloseTo(11.25, 9);
      expect(s * (s > 0 ? b.min[1] : b.max[1])).toBeCloseTo(11.25 - defaults.axleHangerThickIn, 9);
      expect(s * (s > 0 ? rail.min[1] : rail.max[1])).toBeLessThanOrEqual(11.25 + 1e-9); // the rail's box reaches further in at the bow turn-in (D-57); at the axle its inner face is at 11.25
      // The rail is a 3 in bar under the deck (D-56: the deck is only 8 in up); its bottom is 0.85 in below the beam top, so the hanger (bottom 1.35 in below the beam top) reaches just under it.
      expect(rail.min[2]).toBeCloseTo(L.railTop - defaults.railDepthIn, 9);
      expect(b.min[2]).toBeLessThan(rail.min[2]);
      expect(hg.grain).toBe('z'); // vertical grain, side-grain glue to the rail
      expect(hg.joints!.some((j) => j.type === 'glue' && j.to === `rail-${tag}`)).toBe(true);
      expect(hg.joints!.some((j) => j.type === 'bolt'), 'the hanger bolts are the hold-down angle\'s upright bolts: recorded once, on the angle').toBe(false);
      expect(byId(`beam-hold-down-${tag}`).joints!.find((j) => j.type === 'bolt' && j.to === hg.id)!.count).toBe(2);
    }
    expect(rs.zBot).toBeCloseTo(5.2825 - 1.35, 9);
    expect(rs.zSolidTop).toBeCloseTo(L.deckBot, 9);
    expect(rs.yOut).toBeCloseTo(11.25, 9);
    expect(rs.yIn).toBeCloseTo(11.25 - defaults.axleHangerThickIn, 9); // 7/8 in hanger (D-58)
  });
  it('the hanger is notched on its underside to bear on the beam top; the whitelist entry is replaced by a bounded one', () => {
    expect(seat).not.toBeNull();
    expect(seat.depth).toBeCloseTo(L.beamR.top - (L.beamR.top - defaults.axleSeatNotchIn), 9); // 1.35"
    expect(seat.depth).toBeCloseTo(1.35, 9);
    expect(seat.x1 - seat.x0).toBeCloseTo(L.beamR.thick + 2 * defaults.beamNotchClearIn, 9); // 2.25 + 2 x 1/16 = 2.375 (D-60: the beam is 2-1/4 in fore-aft; 2.625 before)
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
    // the notch volume (2.375 x 1.35 x 0.875 = 2.81 in^3, the 7/8 in hanger of D-58 and the D-60 2-1/4 in beam; 3.10 before) comes out of the hanger mass: a wider notch makes it lighter
    const oakLb = (seat.volume / 1728) * defaults.oakDensityPcf;
    expect(seat.volume).toBeCloseTo(2.375 * 1.35 * defaults.axleHangerThickIn, 9);
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
      expect(hd.material).toMatch(/(?:316|18-8 \(304\) stainless)/);
      expect(hd.sourcing?.vendor).toMatch(/(?:316|18-8 \(304\) stainless)/);
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
      expect(b.min[2]).toBeCloseTo(L.beamR.top + defaults.axleProudIn, 9); // the flat leg bears on the tube, which stands 0.05 in proud (D-62)
    }
  });
  it('the rear clamp plates (ONE bridge plate per side, D-62) are 316 flat bar parts with stock and sourcing and two bolts through the beam (no zinc, no "mass is an estimate")', () => {
    for (const id of ['clamp-RL1', 'clamp-RR1']) {
      const c = byId(id);
      expect(c.material).toMatch(/(?:316|18-8 \(304\) stainless)/);
      expect(c.material).not.toMatch(/zinc/);
      expect(c.sourcing?.vendor).toMatch(/(?:316|18-8 \(304\) stainless)/);
      expect(c.stock).toBeDefined();
      expect(c.joints?.some((j) => j.to === 'beam-R' && j.type === 'bolt' && j.count === 2)).toBe(true);
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
  it('the socket screws are 1-1/4 in (round 3): the longest 1/4 in step that ends short of the T-nut flange with 1.5 diameters engaged, so no tip stands into the box aft wall (1-3/4 stood 0.31 in past it)', () => {
    const sock = byId('handle-socket-L').joints!.find((j) => j.to === 'transom-rear')!;
    const stack = defaults.handleSocketWallIn + L.transom + defaults.blockingThickIn + washerThick(0.25); // 1.4375 to the flange
    const len = 1.25;
    expect(sock.size).toMatch(/1\/4-20 × 1-1\/4 (?:316|18-8 \(304\) stainless)/);
    expect(len).toBeLessThanOrEqual(stack + 1e-9); // ends flush or short of the backer face
    expect(1.25 - (stack - defaults.blockingThickIn)).toBeGreaterThanOrEqual(1.5 * 0.25); // T-nut engagement
    expect(sock.note).toMatch(/SHORT of the flange/);
  });
  it('the socket bolts on a nylock nut were 2 in, with a T-nut the stack is computed from the grip', () => {
    const sock = byId('handle-socket-L').joints!.find((j) => j.to === 'transom-rear')!;
    const stack = defaults.handleSocketWallIn + L.transom + defaults.blockingThickIn; // 1.375
    expect(boltLength(stack, 0.25, 2)).toBe(2); // the nylock-nut length, kept to show the T-nut saves a size
    expect(sock.size).toMatch(/1\/4-20 × 1-1\/4 (?:316|18-8 \(304\) stainless)/);
    expect(sock.size).toMatch(/T-NUT/);
    expect(sock.size).toMatch(/button-head/);
    expect(sock.at).toHaveLength(2);
  });
  it('the push-handle post is a slip fit in its socket (inside 0.75" x 1.25", the standard 1" x 1-1/2" x 1/8" tube, D-60) and the bar joint can be assembled: pinned and glued, no nut inside the tube', () => {
    const h = handleGeometry(defaults, L);
    const w = defaults.handleSocketWallIn;
    expect(h.socketX - 2 * w - defaults.handlePostThickIn).toBeCloseTo(2 * defaults.handleSocketSlipIn, 9);
    expect(h.socketY - 2 * w - defaults.handlePostWidthIn).toBeCloseTo(2 * defaults.handleSocketSlipIn, 9);
    expect(h.socketX).toBeCloseTo(1, 9); // D-60: the standard 1 in x 1-1/2 in tube (it was 1-1/4 x 1-3/4 in)
    expect(h.socketY).toBeCloseTo(1.5, 9);
    const post = worldAABB(byId('handle-post-L'));
    const sock = worldAABB(byId('handle-socket-L'));
    expect(post.min[0]).toBeGreaterThanOrEqual(sock.min[0] + w - 1e-9);
    expect(post.max[0]).toBeLessThanOrEqual(sock.max[0] - w + 1e-9);
    const j = byId('handle-post-L').joints!.find((q) => q.to === 'handle-bar' && q.type === 'pin')!;
    expect(j.size).toMatch(/epoxied/);
    expect(byId('handle-post-L').joints!.some((q) => q.to === 'handle-bar' && /wing nut/.test(q.size ?? ''))).toBe(false);
    expect(byId('handle-bar').sourcing?.vendor).toMatch(/white-oak board/); // the handlebow is bandsawn from one white-oak board (D-57), not a bought dowel
  });
});

describe('the push-handle sockets and the girder / stub-axle variants (D-53, D-55)', () => {
  it('the girder (hull-beam) frame and a stub-axle design still build the step brake and mount its knees on the rails', () => {
    for (const q of [{ frameStyle: 1 }, { axleStyle: 1 }] as Partial<Params>[]) {
      const p = { ...defaults, ...q } as Params;
      const ps = buildModel(p);
      expect(ps.some((x) => x.id === 'brake-flap-L')).toBe(true);
      expect(ps.some((x) => x.id === 'brake-knee-L')).toBe(true);
      expect(ps.some((x) => x.id === 'brake-backer-R')).toBe(true);
    }
  });
});
