/**
 * The pivoting soapbox front axle (D-56): the parts of the front end, the vertical stack at the kingpin, the king beam and the steering stops, the swept pose over the whole
 * steering range, tire clearance, the turning geometry, the removable bridle and the joinery of the new joints. Expected numbers are re-derived from the params by hand,
 * not read back from the builder where that is practical.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, steerGeometry, validateParams, type Params } from '../params';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { joistId } from './frame';
import { partsOverlap, transformPoint, worldAABB } from './bounds';
import { totalMass } from './mass';
import type { Part, Vec3 } from './types';

const defaults = defaultParams();
const L = computeLayout(defaults);
const parts = buildModel(defaults);
const get = (ps: Part[], id: string) => {
  const x = ps.find((q) => q.id === id);
  if (!x) throw new Error(`no part ${id}`);
  return x;
};
const RAD = Math.PI / 180;
const lock = defaults.steerLockDeg;
const kx = defaults.wheelbaseIn;
const tHalf = defaults.axleBeamThicknessIn / 2;
const bodyHalf = defaults.bodyWidthIn / 2;
const TOL = 0.05;

const turning = (x: Part) => x.body === 'front-axle' || x.body === 'wheel-FL' || x.body === 'wheel-FR';
/** Chassis parts a turning front-axle part must not touch: every solid, non-payload part that does not turn (the brake is at the rear and swept in brake.test.ts). */
const SOLID = new Set(['frame', 'body', 'front-end', 'running-gear', 'seat', 'storage', 'removable', 'lighting', 'hardware']);
const fixedParts = (ps: Part[]) => ps.filter((x) => !x.payload && !turning(x) && SOLID.has(x.group));
/** Intended contacts between the turning parts and the chassis: the kingpin passes through the king beam and the thrust washer bore. */
const ALLOWED = [/^kingpin$/];
const clashes = (ps: Part[], tol = TOL) => {
  const bad: string[] = [];
  for (const a of ps.filter((x) => !x.payload && turning(x))) for (const b of fixedParts(ps)) {
    if (ALLOWED.some((r) => r.test(a.id) && /^(king-beam|king-thrust)$/.test(b.id))) continue;
    const o = partsOverlap(a, b);
    if (o > tol) bad.push(`${a.id} x ${b.id}: ${o.toFixed(3)}`);
  }
  return bad;
};

/** Smallest |y| of the tire (a thick disc: the rim circle at both faces) of a posed front wheel, by its transform: local x/z span the disc, local y is the axle. */
function tireMinAbsY(w: Part, p: Params): number {
  const m = w.transform;
  const c: Vec3 = [m[12], m[13], m[14]];
  const u: Vec3 = [m[0], m[1], m[2]], a: Vec3 = [m[4], m[5], m[6]], v: Vec3 = [m[8], m[9], m[10]];
  let best = Infinity;
  for (let k = 0; k < 720; k++) {
    const th = (k * Math.PI) / 360;
    for (const side of [-1, 1]) {
      const y = c[1] + side * (p.tireWidthIn / 2) * a[1] + (p.wheelDiameterIn / 2) * (Math.cos(th) * u[1] + Math.sin(th) * v[1]);
      best = Math.min(best, Math.abs(y));
    }
  }
  return best;
}

describe('the front-end parts (D-56)', () => {
  it('exist with the right rigid bodies and groups; the axle turns, the king beam, thrust washer and stops are the chassis', () => {
    for (const id of ['beam-F', 'axle-FL', 'axle-FR', 'kingpin', 'bridle-tongue', 'bridle-eye', 'bridle', 'clamp-FL1', 'clamp-FL2', 'clamp-FL3', 'clamp-FL4', 'clamp-FR1', 'clamp-FR2', 'clamp-FR3', 'clamp-FR4'])
      expect(get(parts, id).body, id).toBe('front-axle');
    for (const id of ['king-beam', 'king-thrust', 'steer-stop-L', 'steer-stop-R']) expect(get(parts, id).body, id).toBe('chassis');
    expect(get(parts, 'wheel-FL').body).toBe('wheel-FL');
    expect(get(parts, 'wheel-FR').body).toBe('wheel-FR');
    for (const id of ['beam-F', 'kingpin', 'bridle-tongue', 'bridle-eye', 'bridle', 'king-beam', 'king-thrust', 'steer-stop-L', 'steer-stop-R', 'axle-FL', 'clamp-FR4']) expect(get(parts, id).group, id).toBe('front-end');
    expect(get(parts, 'wheel-FL').group).toBe('running-gear');
    expect(get(parts, 'beam-F').material).toBe('white oak');
    expect(get(parts, 'king-beam').material).toBe('white oak');
    expect(get(parts, 'steer-stop-L').material).toBe('white oak');
    expect(get(parts, 'bridle-tongue').material).toMatch(/A36/);
    expect(get(parts, 'king-thrust').material).toMatch(/UHMW/);
    expect(get(parts, 'kingpin').material).toMatch(/grade 8/);
    expect(parts.filter((x) => x.body === 'front-axle').length).toBeGreaterThanOrEqual(15);
    // steering ropes are off by default and are added (turning with the axle) when asked for
    expect(parts.some((x) => /^steer-rope/.test(x.id))).toBe(false);
    const ropes = buildModel({ ...defaults, steerRopesOn: 1 }).filter((x) => /^steer-rope/.test(x.id));
    expect(ropes.map((x) => x.id).sort()).toEqual(['steer-rope-L', 'steer-rope-R']);
    for (const r of ropes) { expect(r.body).toBe('front-axle'); expect(r.removable).toBe(true); }
  });
  it('the old front ends are gone: no casters, tip swivels, bow block, front hangers, placeholder axle or front-end style wording in the notes', () => {
    expect(parts.some((x) => /^(caster-|tip-swivel|bow-block|front-hanger-|beam-F-placeholder)/.test(x.id))).toBe(false);
    for (const x of parts) expect(`${x.name} ${x.notes ?? ''}`, x.id).not.toMatch(/caster|placeholder|PROVISIONAL front|bow block/i);
  });
  it('the front axle beam: oak, 2.5 x 2.25 x track - hub - 1/4 long, top at wheel radius + rod radius (5.375), underslung like the rear', () => {
    const b = worldAABB(get(parts, 'beam-F'));
    expect(L.beamF.top).toBeCloseTo(5.375, 9);
    expect(b.max[2]).toBeCloseTo(5.375, 9);
    expect(b.min[2]).toBeCloseTo(3.125, 9);
    expect(b.max[0] - b.min[0]).toBeCloseTo(defaults.axleBeamThicknessIn, 9);
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(kx, 9);
    expect(b.max[1] - b.min[1]).toBeCloseTo(defaults.frontTrackIn - defaults.hubLengthIn - 0.25, 9);
    expect(b.min[1]).toBeCloseTo(-b.max[1], 9);
    // the same section as the rear beam
    const r = worldAABB(get(parts, 'beam-R'));
    expect(r.max[2]).toBeCloseTo(b.max[2], 9);
    expect(r.min[2]).toBeCloseTo(b.min[2], 9);
    // an overslung REAR beam leaves the front beam underslung (the king stack assumes it)
    expect(computeLayout({ ...defaults, axleBeamPosition: 1, deckHeightIn: 12 }).beamF.top).toBeCloseTo(5.375, 9);
  });
  it('each stub axle is a 3/4 in rod from frontStubLenIn inside the beam end to past the hub, clamped by four plates; the wheel sits on the free end', () => {
    for (const [tag, s] of [['L', 1], ['R', -1]] as const) {
      const rod = worldAABB(get(parts, `axle-F${tag}`));
      const beam = worldAABB(get(parts, 'beam-F'));
      expect(s * (s > 0 ? rod.min[1] : rod.max[1])).toBeCloseTo(beam.max[1] - defaults.frontStubLenIn, 9);
      expect(s * (s > 0 ? rod.max[1] : rod.min[1])).toBeCloseTo(defaults.frontTrackIn / 2 + defaults.hubLengthIn / 2 + defaults.axleEndExtraIn, 9);
      expect(rod.max[2] - rod.min[2]).toBeCloseTo(defaults.axleDiameterIn, 9);
      expect((rod.max[2] + rod.min[2]) / 2).toBeCloseTo(L.r, 9); // on the wheel axis
      const w = get(parts, `wheel-F${tag}`);
      expect(w.transform[13]).toBeCloseTo(s * defaults.frontTrackIn / 2, 9);
      expect(w.transform[14]).toBeCloseTo(L.r, 9);
      for (let k = 1; k <= 4; k++) {
        const c = worldAABB(get(parts, `clamp-F${tag}${k}`));
        expect(c.min[2]).toBeCloseTo(L.beamF.top, 9); // on the beam top
        expect(s * (s > 0 ? c.min[1] : c.max[1])).toBeGreaterThan(s * (s > 0 ? rod.min[1] : rod.max[1]) - 1e-9); // within the clamped length
      }
    }
  });
});

describe('the kingpin stack (D-56)', () => {
  const stack = steerGeometry(defaults);
  it('the kingpin axis is vertical at x = wheelbase, y = 0, through the beam, tongue plate, thrust washer and king beam', () => {
    const k = worldAABB(get(parts, 'kingpin'));
    expect((k.min[0] + k.max[0]) / 2).toBeCloseTo(kx, 9);
    expect((k.min[1] + k.max[1]) / 2).toBeCloseTo(0, 9);
    expect(k.max[0] - k.min[0]).toBeCloseTo(defaults.kingpinDiaIn, 9);
    expect(L.king.x).toBe(kx);
    expect(L.steer.kingX).toBe(kx);
    // the bolt runs from under the beam (head and plate washer) to the nut slot near the top of the king beam
    expect(k.min[2]).toBeLessThan(get(parts, 'beam-F').transform[14] - 1);
    expect(k.max[2]).toBeLessThan(L.deckBot);
    expect(k.max[2]).toBeGreaterThan(L.king.bot);
    for (const id of ['beam-F', 'king-beam', 'king-thrust', 'bridle-tongue']) {
      const b = worldAABB(get(parts, id));
      expect(b.min[0], id).toBeLessThan(kx);
      expect(b.max[0], id).toBeGreaterThan(kx);
      expect(b.min[1], id).toBeLessThan(0);
      expect(b.max[1], id).toBeGreaterThan(0);
    }
  });
  it('the vertical stack: beam-F top 5.375 < tongue plate (3/16) < UHMW thrust washer (1/4) < king beam bottom 5.8125; the king beam top is the deck underside', () => {
    const beam = worldAABB(get(parts, 'beam-F')), tongue = worldAABB(get(parts, 'bridle-tongue'));
    const thr = worldAABB(get(parts, 'king-thrust')), king = worldAABB(get(parts, 'king-beam')), deck = worldAABB(get(parts, 'deck'));
    expect(beam.max[2]).toBeCloseTo(5.375, 9);
    expect(tongue.min[2]).toBeCloseTo(beam.max[2], 9); // lies on the beam
    expect(tongue.max[2] - tongue.min[2]).toBeCloseTo(defaults.tongueThickIn, 9);
    expect(tongue.max[2]).toBeCloseTo(5.5625, 9);
    expect(thr.min[2]).toBeCloseTo(tongue.max[2], 9);
    expect(thr.max[2] - thr.min[2]).toBeCloseTo(defaults.kingThrustThickIn, 9);
    expect(thr.max[2]).toBeCloseTo(5.8125, 9);
    expect(king.min[2]).toBeCloseTo(thr.max[2], 9);
    expect(king.min[2]).toBeCloseTo(5.8125, 9);
    expect(king.max[2]).toBeCloseTo(L.deckBot, 9);
    expect(deck.min[2]).toBeCloseTo(king.max[2], 9); // bonded to the deck underside
    expect(king.max[2] - king.min[2]).toBeCloseTo(stack.kingDepth, 9);
    expect(stack.kingDepth).toBeGreaterThan(1.6);
    // order
    expect(beam.max[2]).toBeLessThan(tongue.max[2]);
    expect(tongue.max[2]).toBeLessThan(thr.max[2]);
    expect(thr.max[2]).toBeLessThan(king.min[2] + 1e-9);
    // the thrust washer: UHMW disc OD 2.5 centered on the kingpin
    expect(thr.max[0] - thr.min[0]).toBeCloseTo(defaults.kingThrustOdIn, 9);
    expect((thr.min[0] + thr.max[0]) / 2).toBeCloseTo(kx, 9);
    expect(get(parts, 'king-thrust').body).toBe('chassis');
  });
  it('the king beam spans between the rail inner faces at the kingpin (3 in fore-aft) and touches the deck underside and both rails', () => {
    const king = worldAABB(get(parts, 'king-beam'));
    const railL = worldAABB(get(parts, 'rail-L')), railR = worldAABB(get(parts, 'rail-R'));
    expect(king.max[1]).toBeCloseTo(railL.min[1], 9);
    expect(king.min[1]).toBeCloseTo(railR.max[1], 9);
    expect(king.max[1]).toBeCloseTo(bodyHalf - defaults.railThicknessIn, 9);
    expect(king.max[0] - king.min[0]).toBeCloseTo(defaults.kingBeamLengthIn, 9);
    expect((king.min[0] + king.max[0]) / 2).toBeCloseTo(kx, 9);
    expect(get(parts, 'king-beam').stock).toBeDefined();
    expect(get(parts, 'king-beam').stock!.l).toBeCloseTo(2 * king.max[1], 9);
    expect(get(parts, 'king-beam').rough).toBeDefined();
    // and it is one of the crossmembers: its x is in joistX and it replaces that joist's id
    expect(L.joistX).toContain(kx);
    expect(joistId(L, L.joistX.indexOf(kx))).toBe('king-beam');
    expect(parts.filter((x) => /^joist-\d+$/.test(x.id)).length).toBe(L.joistX.length - 1);
  });
  it('the rails are extrusions with a step: 3 in deep at the rear, steps down (a 1.5 in ramp ending at railStepX) to railDepthF ahead, so the swinging beam passes under with 0.4 in', () => {
    for (const tag of ['L', 'R']) {
      const r = get(parts, `rail-${tag}`);
      expect(r.geometry.type).toBe('extrusion');
      expect(r.stock).toBeDefined();
      expect(r.rough).toBeDefined();
      expect(r.stock!.t).toBeCloseTo(defaults.railThicknessIn, 9);
      expect(r.stock!.w).toBeCloseTo(defaults.railDepthIn, 9);
      const b = worldAABB(r);
      expect(b.max[2]).toBeCloseTo(L.deckBot, 9);
      expect(b.min[2]).toBeCloseTo(L.deckBot - defaults.railDepthIn, 9);
    }
    expect(L.railDepthF).toBeCloseTo(1.753, 3);
    expect(L.railStepX).toBeLessThan(kx);
    // the rail bottom ahead of the step is 0.4 in over the beam top
    const g = get(parts, 'rail-L').geometry as Extract<Part['geometry'], { type: 'extrusion' }>;
    const front = g.outline.filter((q) => q[0] > L.railStepX + 0.01 && q[1] < L.deckBot - 0.1);
    expect(front.length).toBeGreaterThan(0);
    for (const q of front) expect(q[1] - L.beamF.top).toBeGreaterThanOrEqual(0.4 - 1e-9);
  });
});

describe('the tongue plate, shackle and bridle (D-56)', () => {
  const tongue = get(parts, 'bridle-tongue');
  it('the tongue reaches tongueTieAheadIn past the bow tip; the tie hole is 1 in behind the tip and the shackle pin goes through it', () => {
    const t = worldAABB(tongue);
    expect(t.max[0]).toBeCloseTo(L.xFront + defaults.tongueTieAheadIn, 9);
    expect(t.max[0]).toBeCloseTo(60, 9);
    expect(L.tongue.holeX).toBeCloseTo(59, 9);
    const sh = get(parts, 'bridle-eye');
    const s = worldAABB(sh);
    // the shackle straddles the tongue plate at the tie hole: it spans the hole's x and the plate's z, on the center line
    expect(s.min[0]).toBeLessThan(L.tongue.holeX);
    expect(s.max[0]).toBeGreaterThan(L.tongue.holeX);
    expect(s.min[2]).toBeLessThan(L.tongue.z0);
    expect(s.max[2]).toBeGreaterThan(L.tongue.z1);
    expect((s.min[1] + s.max[1]) / 2).toBeCloseTo(0, 6);
    const pin = sh.joints!.find((j) => j.to === 'bridle-tongue')!;
    expect(pin.type).toBe('pin');
    expect(pin.diaIn).toBeCloseTo(defaults.eyeBoltDiameterIn, 9);
    expect(pin.at![0][0]).toBeCloseTo(L.tongue.holeX, 9);
    expect(L.tongue.tieZ).toBeCloseTo(L.tongue.z1 + 0.35, 9);
    expect(pin.at![0][2]).toBeCloseTo(L.tongue.tieZ, 9);
    // the rope starts at the shackle and runs forward
    const rope = worldAABB(get(parts, 'bridle'));
    expect(rope.min[0]).toBeGreaterThan(L.tongue.holeX);
    expect((rope.min[2] + rope.max[2]) / 2).toBeCloseTo(L.tongue.tieZ, 6);
    expect(get(parts, 'bridle').joints!.some((j) => j.to === 'bridle-eye')).toBe(true);
  });
  it('the tongue is A36 plate 3/16 thick lying on the beam: 4 in head on the kingpin tapering to the 2.5 in bar; it has stock and bolts to the beam with two 3/8 in bolts outside the thrust washer', () => {
    expect(tongue.geometry.type).toBe('extrusion');
    expect(tongue.stock).toBeDefined();
    expect(tongue.stock!.t).toBeCloseTo(defaults.tongueThickIn, 9);
    expect(tongue.stock!.w).toBeCloseTo(defaults.tongueHeadWidthIn, 9);
    const t = worldAABB(tongue);
    expect(t.max[1] - t.min[1]).toBeCloseTo(defaults.tongueHeadWidthIn, 9);
    expect(t.min[0]).toBeCloseTo(kx - defaults.tongueHeadWidthIn / 2, 9);
    const bolts = tongue.joints!.find((j) => j.to === 'beam-F' && j.type === 'bolt')!;
    expect(bolts.count).toBe(2);
    expect(bolts.diaIn).toBeCloseTo(defaults.tongueBoltDiaIn, 9);
    expect(bolts.at!.map((q) => Math.abs(q[1]))).toEqual([bolts.at![0][1], bolts.at![0][1]].map(Math.abs));
    expect(Math.abs(bolts.at![0][1])).toBeGreaterThan(defaults.kingThrustOdIn / 2); // outside the washer
    // mass: 3/16 in of steel over the outline area (about 2.8 lb)
    expect(tongue.massLb).toBeGreaterThan(2);
    expect(tongue.massLb).toBeLessThan(4);
  });
  it('the shackle pin is the intended weak link: the shackle is lighter than the tongue and carries the pin diameter eyeBoltDiameterIn', () => {
    expect(get(parts, 'bridle-eye').massLb).toBeGreaterThan(0.1);
    expect(get(parts, 'bridle-eye').massLb).toBeLessThan(get(parts, 'bridle-tongue').massLb);
    expect(get(parts, 'bridle-eye').sourcing!.vendor).toMatch(/WEAK LINK/);
    expect(get(parts, 'bridle-eye').kind).toBe('purchased');
  });
  it('the bridle comes off for transport: tongue plate, shackle and rope are removable (and nothing else of the front end)', () => {
    const removed = buildModel(defaults, { removed: true });
    for (const id of ['bridle-tongue', 'bridle-eye', 'bridle']) {
      expect(get(parts, id).removable, id).toBe(true);
      expect(removed.some((x) => x.id === id), id).toBe(false);
    }
    for (const id of ['beam-F', 'kingpin', 'king-beam', 'king-thrust', 'steer-stop-L', 'steer-stop-R', 'axle-FL', 'axle-FR', 'wheel-FL', 'wheel-FR', 'clamp-FL1']) {
      expect(get(parts, id).removable, id).toBeFalsy();
      expect(removed.some((x) => x.id === id), id).toBe(true);
    }
    // the cart (without the tongue) is shorter than the bow tip by the banding at most, and lighter by the three parts
    const reach = Math.max(...removed.filter((x) => !x.payload).map((x) => worldAABB(x).max[0]));
    expect(reach).toBeLessThan(L.xFront + 0.5);
    const lost = ['bridle-tongue', 'bridle-eye', 'bridle'].reduce((m, id) => m + get(parts, id).massLb, 0);
    expect(totalMass(parts) - totalMass(removed)).toBeGreaterThanOrEqual(lost - 1e-9);
  });
});

describe('the steering stops and the swept pose (D-56)', () => {
  const stops = L.stops;
  it('the stop blocks hang under the ends of the end joist (joist-7), 3/4 in thick, and reach down past the beam top', () => {
    expect(joistId(L, L.joistX.length - 1)).toBe('joist-7');
    const j = worldAABB(get(parts, 'joist-7'));
    for (const [tag, s] of [['L', 1], ['R', -1]] as const) {
      const b = worldAABB(get(parts, `steer-stop-${tag}`));
      expect(b.min[0]).toBeCloseTo(j.min[0], 9);
      expect(b.max[0]).toBeCloseTo(j.max[0], 9);
      expect(b.max[0] - b.min[0]).toBeCloseTo(defaults.crossmemberThickIn, 9);
      expect(b.max[2]).toBeCloseTo(j.min[2], 9); // under the joist
      expect(b.min[2]).toBeCloseTo(L.beamF.top - 1, 9);
      expect(s * (s > 0 ? b.min[1] : b.max[1])).toBeCloseTo(stops.y1, 9);
      expect(s * (s > 0 ? b.max[1] : b.min[1])).toBeCloseTo(stops.y2, 9);
      expect(get(parts, `steer-stop-${tag}`).stock).toBeDefined();
      expect(get(parts, `steer-stop-${tag}`).rough).toBeDefined();
    }
    expect(stops.faceX).toBeCloseTo(j.min[0], 9);
  });
  it('at the lock angle the beam leading face meets the stop rear face: the swept corner line crosses the face plane at the outer end of the block (within 0.1 in) and never inside it', () => {
    const d = lock * RAD;
    // leading face of the beam (half a thickness ahead of its axis), s along the beam toward the right-hand stop at a left turn (+ steer)
    const face = (s: number): [number, number] => [kx + tHalf * Math.cos(d) + s * Math.sin(d), tHalf * Math.sin(d) - s * Math.cos(d)];
    let s = 0;
    while (face(s)[0] < stops.faceX) s += 0.001;
    const [cx, cy] = face(s);
    expect(cx).toBeCloseTo(stops.faceX, 2);
    expect(Math.abs(cy)).toBeCloseTo(stops.y2, 1); // the outer end of the block
    expect(Math.abs(Math.abs(cy) - stops.y2)).toBeLessThan(0.1);
    expect(Math.abs(cy)).toBeGreaterThan(stops.y1);
    // the along-the-beam distance is the one the validator and layout call stopY1
    expect(s).toBeCloseTo(steerGeometry(defaults).stopY1, 2);
    // beyond the contact point the face is ahead of the stop face, so the block must end there: no block material outboard of it
    expect(stops.y2).toBeLessThanOrEqual(Math.abs(cy) + 0.1);
    // and a hair inside the lock the corner line is still behind the face over the block's whole width
    const d2 = (lock - 0.5) * RAD;
    for (let y = stops.y1; y <= stops.y2 + 1e-9; y += 0.05) {
      const sy = (y + tHalf * Math.sin(d2)) / Math.cos(d2); // beam distance at world |y|
      const x = kx + tHalf * Math.cos(d2) + sy * Math.sin(d2);
      expect(x, `y ${y.toFixed(2)}`).toBeLessThanOrEqual(stops.faceX + 0.1);
    }
  });
  it('the swept pose rotates exactly about the kingpin (44, 0): the kingpin does not move; every turning part rotates by the steer angle, the tongue tip follows the arc', () => {
    for (const deg of [-lock, -7, 7, lock]) {
      const m = buildModel(defaults, { steerDeg: deg });
      const k0 = get(parts, 'kingpin').transform, k1 = get(m, 'kingpin').transform;
      for (const a of [12, 13, 14]) expect(k1[a], `kingpin ${deg}`).toBeCloseTo(k0[a], 9); // the kingpin turns about its own axis
      for (const x of m.filter(turning)) {
        const n = get(parts, x.id);
        expect(Math.atan2(x.transform[1], x.transform[0]), `${x.id} ${deg}`).toBeCloseTo(deg * RAD, 9);
        // rigid rotation about the vertical axis through (kx, 0): z and the radius from the axis are unchanged
        expect(x.transform[14], x.id).toBeCloseTo(n.transform[14], 9);
        expect(Math.hypot(x.transform[12] - kx, x.transform[13]), x.id).toBeCloseTo(Math.hypot(n.transform[12] - kx, n.transform[13]), 9);
      }
      // the tongue tip (60, 0) goes to (44 + 16 cos, 16 sin)
      const tip = transformPoint(get(m, 'bridle-tongue').transform, [L.tongue.tipX, 0, L.tongue.z0]);
      const r = L.tongue.tipX - kx;
      expect(tip[0]).toBeCloseTo(kx + r * Math.cos(deg * RAD), 9);
      expect(tip[1]).toBeCloseTo(r * Math.sin(deg * RAD), 9);
      // and nothing of the chassis moves
      for (const x of m.filter((q) => !q.payload && !turning(q))) expect(x.transform, x.id).toEqual(get(parts, x.id).transform);
    }
    // a steer past the lock is clamped to it
    const over = buildModel(defaults, { steerDeg: 90 });
    expect(Math.atan2(get(over, 'beam-F').transform[1], get(over, 'beam-F').transform[0])).toBeCloseTo(lock * RAD, 9);
  });
  it('sweep -lock..+lock in 1 degree steps: no turning part (beam, stubs, clamps, kingpin, tongue, shackle, rope, wheels) penetrates any chassis part (rails, king beam, joists, stops, deck, body) beyond the kingpin contacts', () => {
    const bad: string[] = [];
    for (let deg = -lock; deg <= lock; deg += 1) for (const c of clashes(buildModel(defaults, { steerDeg: deg }))) bad.push(`${deg}: ${c}`);
    expect(bad).toEqual([]);
  });
  it('the sweep has teeth: past the lock (beam moved 3 degrees beyond it) the beam does hit a stop', () => {
    const m = buildModel(defaults, { steerDeg: 0 });
    // rotate the turning parts by lock + 3 degrees about the kingpin by hand
    const d = (lock + 3) * RAD, c = Math.cos(d), s = Math.sin(d);
    const rot = (x: Part): Part => {
      const t = x.transform.slice();
      const m0 = x.transform;
      const rotate = (a: number, b: number) => [c * a - s * b, s * a + c * b];
      for (const col of [0, 1, 2]) { const [u, v] = rotate(m0[col * 4], m0[col * 4 + 1]); t[col * 4] = u; t[col * 4 + 1] = v; }
      const [px, py] = rotate(m0[12] - kx, m0[13]);
      t[12] = kx + px; t[13] = py;
      return { ...x, transform: t };
    };
    const over = m.map((x) => (x.id === 'beam-F' || x.id === 'axle-FL' || x.id === 'axle-FR' ? rot(x) : x));
    expect(clashes(over).some((q) => /steer-stop/.test(q))).toBe(true);
  });
  it('the tires clear the body sides by at least steerClearIn at full lock, using the posed wheel geometry, and the number equals steerGeometry', () => {
    const sg = steerGeometry(defaults);
    for (const deg of [lock, -lock]) {
      const m = buildModel(defaults, { steerDeg: deg });
      for (const id of ['wheel-FL', 'wheel-FR']) {
        const clear = tireMinAbsY(get(m, id), defaults) - bodyHalf;
        expect(clear, `${id} ${deg}`).toBeGreaterThanOrEqual(defaults.steerClearIn - 1e-6);
      }
    }
    // the tighter wheel at +lock is the left one (its inner rear corner swings toward the body)
    const m = buildModel(defaults, { steerDeg: lock });
    const cl = Math.min(...['wheel-FL', 'wheel-FR'].map((id) => tireMinAbsY(get(m, id), defaults) - bodyHalf));
    expect(cl).toBeCloseTo(sg.clearAtLock, 2); // the 720-point rim sampling is good to ~0.002 in
    expect(sg.clearAtLock).toBeGreaterThan(1.2);
    expect(sg.clearAtLock).toBeLessThan(1.4);
    // at rest the clearance is the plain gap
    const rest = tireMinAbsY(get(parts, 'wheel-FL'), defaults) - bodyHalf;
    expect(rest).toBeCloseTo(defaults.frontTrackIn / 2 - defaults.tireWidthIn / 2 - bodyHalf, 6);
  });
  it('minimum track: at frontTrackIn = minTrack the posed clearance at full lock equals steerClearIn; a track under it is a validation error and a track over it is not', () => {
    const sg = steerGeometry(defaults);
    expect(sg.minTrack).toBeCloseTo(34.28, 1);
    const p = { ...defaults, frontTrackIn: sg.minTrack };
    const m = buildModel(p, { steerDeg: lock });
    const cl = Math.min(...['wheel-FL', 'wheel-FR'].map((id) => tireMinAbsY(get(m, id), p) - p.bodyWidthIn / 2));
    expect(cl).toBeCloseTo(defaults.steerClearIn, 2);
    expect(steerGeometry(p).clearAtLock).toBeCloseTo(defaults.steerClearIn, 9);
    expect(validateParams({ ...defaults, frontTrackIn: sg.minTrack + 0.05 }).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateParams({ ...defaults, frontTrackIn: sg.minTrack - 0.05 }).some((i) => i.severity === 'error' && i.keys.includes('steerLockDeg'))).toBe(true);
    // the track at minTrack still sweeps clean through the whole range
    const bad: string[] = [];
    for (let deg = -lock; deg <= lock; deg += 2) bad.push(...clashes(buildModel(p, { steerDeg: deg })));
    expect(bad).toEqual([]);
  });
});

describe('turning geometry (D-56: no Ackermann, both wheels parallel)', () => {
  const sg = steerGeometry(defaults);
  it('the beam axis meets the rear axle line at WB / tan(lock) from the center line; the center radius is 120.9 in (about 10 ft)', () => {
    const m = buildModel(defaults, { steerDeg: lock });
    const t = get(m, 'beam-F').transform;
    // beam long axis = local y; the axis line passes through the kingpin
    const ax = t[4], ay = t[5];
    const sLine = (0 - kx) / ax; // x = 0 (rear axle line)
    const yAt = sLine * ay;
    expect(Math.abs(yAt)).toBeCloseTo(defaults.wheelbaseIn / Math.tan(lock * RAD), 6);
    expect(Math.abs(yAt)).toBeCloseTo(sg.centerRadiusIn, 6);
    expect(sg.centerRadiusIn).toBeCloseTo(120.9, 1);
    // a left turn (+) has the center on the left (+y)
    expect(yAt).toBeGreaterThan(0);
    const tr = buildModel(defaults, { steerDeg: -lock }).find((x) => x.id === 'beam-F')!.transform;
    expect((0 - kx) / tr[4] * tr[5]).toBeLessThan(0); // a right turn (-) puts the center on the right (-y)
  });
  it('both front wheels roll about the same center (their axle lines are collinear), parallel to each other', () => {
    const m = buildModel(defaults, { steerDeg: lock });
    const fl = get(m, 'wheel-FL').transform, fr = get(m, 'wheel-FR').transform;
    expect(fl[4]).toBeCloseTo(fr[4], 12);
    expect(fl[5]).toBeCloseTo(fr[5], 12);
    // contact points of the posed wheels: (44 - (track/2) sin d, +(track/2) cos d) for the left wheel
    const d = lock * RAD;
    expect(fl[12]).toBeCloseTo(kx - (defaults.frontTrackIn / 2) * Math.sin(d), 9);
    expect(fl[13]).toBeCloseTo((defaults.frontTrackIn / 2) * Math.cos(d), 9);
    expect(fr[12]).toBeCloseTo(kx + (defaults.frontTrackIn / 2) * Math.sin(d), 9);
    expect(fr[13]).toBeCloseTo(-(defaults.frontTrackIn / 2) * Math.cos(d), 9);
  });
  it('the outer tire edge swings a circle of WB / sin(lock) + track / 2 + tire / 2 = 148.1 in about the turning center; the inner edge 109.1 in', () => {
    const m = buildModel(defaults, { steerDeg: lock });
    const C: [number, number] = [0, sg.centerRadiusIn];
    const wheelDist = (id: string) => Math.hypot(get(m, id).transform[12] - C[0], get(m, id).transform[13] - C[1]);
    // the outer wheel at a left turn is the right one
    expect(wheelDist('wheel-FR') + defaults.tireWidthIn / 2).toBeCloseTo(sg.outerEdgeRadiusIn, 6);
    expect(wheelDist('wheel-FL') - defaults.tireWidthIn / 2).toBeCloseTo(sg.innerEdgeRadiusIn, 6);
    expect(sg.outerEdgeRadiusIn).toBeCloseTo(148.1, 1);
    expect(sg.innerEdgeRadiusIn).toBeCloseTo(109.1, 1);
    // closed form
    expect(sg.outerEdgeRadiusIn).toBeCloseTo(defaults.wheelbaseIn / Math.sin(lock * RAD) + defaults.frontTrackIn / 2 + defaults.tireWidthIn / 2, 9);
    // the turning circle (outer edge diameter) is about 24.7 ft, the center-line circle about 20 ft
    expect((2 * sg.outerEdgeRadiusIn) / 12).toBeGreaterThan(24);
    expect((2 * sg.centerRadiusIn) / 12).toBeGreaterThan(20);
  });
});

describe('joinery of the front end (D-56)', () => {
  const idSet = new Set(parts.map((x) => x.id));
  it('every joint of a front-end part (or on a part that mates with one) names a real part, has finite locations matching its count, and is reciprocal with the same count', () => {
    const family = (x: Part) => x.group === 'front-end' || /^(clamp-F|axle-F|beam-F)/.test(x.id);
    const bad: string[] = [];
    for (const x of parts) for (const j of x.joints ?? []) {
      const mate = parts.find((q) => q.id === j.to);
      if (!family(x) && !(mate && family(mate))) continue;
      if (!idSet.has(j.to)) { bad.push(`${x.id} -> ${j.to}: no such part`); continue; }
      if (j.at) {
        if (j.at.length !== j.count) bad.push(`${x.id} -> ${j.to}: ${j.at.length} locations for count ${j.count}`);
        if (!j.at.every((a) => a.every(Number.isFinite))) bad.push(`${x.id} -> ${j.to}: non-finite location`);
      }
      const back = mate!.joints?.filter((k) => k.to === x.id) ?? [];
      if (!back.length) bad.push(`${x.id} -> ${j.to} (${j.type}): no reciprocal on ${j.to}`);
      else if (!back.some((k) => k.count === j.count)) bad.push(`${x.id} -> ${j.to} (${j.type} x${j.count}): reciprocal count ${back.map((k) => k.count).join('/')}`);
    }
    expect(bad).toEqual([]);
  });
  it('the new joints: kingpin through beam, tongue, king beam; tongue bolted to the beam; stop blocks glued and bolted to the end joist; king beam tied to both rails and bonded to the deck; clamp plates bolted to the beam', () => {
    const has = (a: string, b: string, type?: string) => get(parts, a).joints?.some((j) => j.to === b && (!type || j.type === type)) ?? false;
    for (const [a, b] of [['kingpin', 'beam-F'], ['kingpin', 'bridle-tongue'], ['kingpin', 'king-beam'], ['bridle-tongue', 'beam-F'], ['bridle-eye', 'bridle-tongue'], ['bridle', 'bridle-eye'], ['king-beam', 'king-thrust'],
      ['king-beam', 'rail-L'], ['king-beam', 'rail-R'], ['king-beam', 'deck'], ['steer-stop-L', 'joist-7'], ['steer-stop-R', 'joist-7'], ['clamp-FL1', 'beam-F'], ['clamp-FR4', 'beam-F']] as const) {
      expect(has(a, b), `${a} -> ${b}`).toBe(true);
      expect(has(b, a), `${b} -> ${a}`).toBe(true);
    }
    expect(get(parts, 'steer-stop-L').joints!.map((j) => j.type).sort()).toEqual(['bolt', 'glue']);
    // the stop blocks no longer reach the rails (they end at the beam contact point inboard of them)
    expect(get(parts, 'steer-stop-L').joints!.some((j) => /^rail-/.test(j.to))).toBe(false);
    expect(L.stops.y2).toBeLessThan(bodyHalf - defaults.railThicknessIn);
    expect(get(parts, 'steer-stop-L').joints!.find((j) => j.type === 'bolt')!.count).toBe(2);
  });
  it('the tongue joint locations are in its local frame (= the model frame): the kingpin hole at the pin, the bolts at x = 44', () => {
    const t = get(parts, 'bridle-tongue');
    for (const j of t.joints!) for (const a of j.at!) expect(a[0], `${j.to}`).toBeCloseTo(j.to === 'bridle-eye' ? L.tongue.holeX : kx, 6);
    const w = transformPoint(t.transform, t.joints!.find((j) => j.to === 'kingpin')!.at![0]);
    expect(w[0]).toBeCloseTo(kx, 6);
    expect(w[1]).toBeCloseTo(0, 6);
  });
});

describe('cut list and stock (D-56)', () => {
  it('rails (extrusions with the step), the king beam, the stops, the front beam and the tongue plate all carry stock; lumber has rough stock larger in every dimension', () => {
    for (const id of ['rail-L', 'rail-R', 'king-beam', 'steer-stop-L', 'steer-stop-R', 'beam-F', 'bridle-tongue']) {
      const x = get(parts, id);
      expect(x.stock, id).toBeDefined();
      if (x.kind === 'lumber') {
        expect(x.rough, `${id} rough`).toBeDefined();
        expect(x.rough!.t, id).toBeGreaterThan(x.stock!.t);
        expect(x.rough!.w, id).toBeGreaterThan(x.stock!.w);
        expect(x.rough!.l, id).toBeGreaterThan(x.stock!.l);
      }
    }
    expect(get(parts, 'rail-L').kind).toBe('lumber');
    expect(get(parts, 'rail-L').stock!.l).toBeCloseTo(L.railEnd - (L.xRear + L.transom), 9);
    expect(get(parts, 'king-beam').kind).toBe('lumber');
    expect(get(parts, 'bridle-tongue').kind).toBe('metal');
    expect(get(parts, 'bridle-tongue').fab).toBe('outsource');
  });
  it('identical pieces share a part number (cut list and BOM aggregate): both stops, all eight clamp plates, both stub axles', () => {
    expect(new Set([get(parts, 'steer-stop-L').partNo, get(parts, 'steer-stop-R').partNo]).size).toBe(1);
    expect(new Set(parts.filter((x) => /^clamp-F/.test(x.id)).map((x) => x.partNo)).size).toBe(1);
    expect(new Set([get(parts, 'axle-FL').partNo, get(parts, 'axle-FR').partNo]).size).toBe(1);
  });
});

describe('front-end masses at the defaults (D-56): ranges, not pins', () => {
  it('the front-end group is 10-25 lb, the empty cart about 134 lb (120-150), and the beam / tongue / king beam are in their expected bands', () => {
    const grp = parts.filter((x) => x.group === 'front-end').reduce((m, x) => m + x.massLb, 0);
    expect(grp).toBeGreaterThan(10);
    expect(grp).toBeLessThan(25);
    const tot = totalMass(parts);
    expect(tot).toBeGreaterThan(120);
    expect(tot).toBeLessThan(150);
    expect(get(parts, 'beam-F').massLb).toBeGreaterThan(4);
    expect(get(parts, 'beam-F').massLb).toBeLessThan(6.5);
    expect(get(parts, 'king-beam').massLb).toBeGreaterThan(2.5);
    expect(get(parts, 'king-beam').massLb).toBeLessThan(4.5);
    expect(get(parts, 'kingpin').massLb).toBeGreaterThan(0.2);
    expect(get(parts, 'kingpin').massLb).toBeLessThan(1);
    // the front beam is the same section as the rear beam but a hair shorter or longer by the track difference only
    expect(get(parts, 'beam-F').massLb / get(parts, 'beam-R').massLb).toBeCloseTo((defaults.frontTrackIn - defaults.hubLengthIn - 0.25) / (defaults.rearTrackIn - defaults.hubLengthIn - 0.25), 1);
  });
});
