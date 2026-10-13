/**
 * The pivoting soapbox front axle (D-56): the parts of the front end, the vertical stack at the kingpin, the king beam and the steering stops, the swept pose over the whole
 * steering range, tire clearance, the turning geometry, the removable bridle and the joinery of the new joints. Expected numbers are re-derived from the params by hand,
 * not read back from the builder where that is practical.
 */
import { describe, expect, it } from 'vitest';
import { bowTurnInAt, defaultParams, steerGeometry, validateParams, type Params } from '../params';
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
const tHalf = defaults.frontBeamThicknessIn / 2;
const bodyHalf = defaults.bodyWidthIn / 2;
const TOL = 0.05;

const turning = (x: Part) => x.body === 'front-axle' || x.body === 'wheel-FL' || x.body === 'wheel-FR';
/** Chassis parts a turning front-axle part must not touch: every solid, non-payload part that does not turn (the brake is at the rear and swept in brake.test.ts). */
const SOLID = new Set(['frame', 'body', 'front-end', 'running-gear', 'seat', 'storage', 'removable', 'lighting', 'hardware']);
const fixedParts = (ps: Part[]) => ps.filter((x) => !x.payload && !turning(x) && SOLID.has(x.group));
/** Intended contacts between the turning parts and the chassis: the kingpin passes through the king beam and the thrust disc bore; the chain hangs on the beam eye bolt (D-58). */
const ALLOWED = [/^kingpin$/, /^steer-eye-[LR]$/];
const clashes = (ps: Part[], tol = TOL) => {
  const bad: string[] = [];
  for (const a of ps.filter((x) => !x.payload && turning(x))) for (const b of fixedParts(ps)) {
    if (ALLOWED.some((r) => r.test(a.id) && /^(king-beam|king-thrust|steer-chain-[LR])$/.test(b.id))) continue;
    const o = partsOverlap(a, b);
    if (o > tol) bad.push(`${a.id} x ${b.id}: ${o.toFixed(3)}`);
  }
  return bad;
};

/**
 * Smallest clearance of the tire (a thick disc: the rim circle at both faces) of a posed front wheel to the body side at the same x (D-66: the body half width follows the bow taper,
 * `bowTurnInAt`): min over the rim of |y| - (bodyWidth / 2 - turnIn(x)). Local x/z span the disc, local y is the axle.
 */
function tireMinClear(w: Part, p: Params): number {
  const m = w.transform;
  const c: Vec3 = [m[12], m[13], m[14]];
  const u: Vec3 = [m[0], m[1], m[2]], a: Vec3 = [m[4], m[5], m[6]], v: Vec3 = [m[8], m[9], m[10]];
  let best = Infinity;
  for (let k = 0; k < 720; k++) {
    const th = (k * Math.PI) / 360;
    for (const side of [-1, 1]) {
      const y = c[1] + side * (p.tireWidthIn / 2) * a[1] + (p.wheelDiameterIn / 2) * (Math.cos(th) * u[1] + Math.sin(th) * v[1]);
      const x = c[0] + side * (p.tireWidthIn / 2) * a[0] + (p.wheelDiameterIn / 2) * (Math.cos(th) * u[0] + Math.sin(th) * v[0]);
      best = Math.min(best, Math.abs(y) - (p.bodyWidthIn / 2 - bowTurnInAt(p, x)));
    }
  }
  return best;
}

describe('the front-end parts (D-56, D-58)', () => {
  it('exist with the right rigid bodies and groups; the axle turns, the king beam, thrust disc, chain anchors and chains are the chassis', () => {
    for (const id of ['beam-F', 'axle-FL', 'axle-FR', 'kingpin', 'bridle-tongue', 'bridle-sleeve', 'bridle', 'roll-pad-L', 'roll-pad-R', 'steer-eye-L', 'steer-eye-R', 'clamp-FL1', 'clamp-FL2', 'clamp-FR1', 'clamp-FR2'])
      expect(get(parts, id).body, id).toBe('front-axle');
    for (const id of ['king-beam', 'king-thrust', 'steer-anchor-L', 'steer-anchor-R', 'steer-chain-L', 'steer-chain-R']) expect(get(parts, id).body, id).toBe('chassis');
    expect(get(parts, 'wheel-FL').body).toBe('wheel-FL');
    expect(get(parts, 'wheel-FR').body).toBe('wheel-FR');
    for (const id of ['beam-F', 'kingpin', 'bridle-tongue', 'bridle', 'king-beam', 'king-thrust', 'roll-pad-L', 'steer-chain-L', 'steer-eye-R', 'steer-anchor-R', 'axle-FL', 'clamp-FR2']) expect(get(parts, id).group, id).toBe('front-end');
    expect(get(parts, 'wheel-FL').group).toBe('running-gear');
    expect(get(parts, 'beam-F').material).toBe('white oak');
    expect(get(parts, 'king-beam').material).toBe('white oak');
    expect(get(parts, 'bridle-tongue').material).toBe('white oak');
    expect(get(parts, 'roll-pad-L').material).toMatch(/UHMW/);
    expect(get(parts, 'king-thrust').material).toMatch(/UHMW/);
    expect(get(parts, 'kingpin').material).toMatch(/grade 8/);
    expect(parts.filter((x) => x.body === 'front-axle').length).toBeGreaterThanOrEqual(15); // D-62: no shackle, two bridge plates a side (were four, and a shackle)
    // the oak stop blocks of D-56 are gone (D-58: the lock is set by two chains)
    expect(parts.some((x) => /^steer-stop/.test(x.id))).toBe(false);
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
  it('the front axle beam: oak, 2 3/4 x 2.25 x track - hub - 1/4 long, top at wheel radius + rod radius less the 0.05 in the tube stands proud (5.2825 for the 5/8 in tube, 0.03 in proud, D-71; 5.325 at 3/4 in), underslung like the rear', () => {
    const b = worldAABB(get(parts, 'beam-F'));
    expect(L.beamF.top).toBeCloseTo(5.2825, 9);
    expect(b.max[2]).toBeCloseTo(5.2825, 9);
    expect(b.min[2]).toBeCloseTo(3.0325, 9);
    expect(b.max[0] - b.min[0]).toBeCloseTo(defaults.frontBeamThicknessIn, 9); // D-58: 2 3/4 in (the rear beam is axleBeamThicknessIn)
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(kx, 9);
    expect(b.max[1] - b.min[1]).toBeCloseTo(defaults.frontTrackIn - defaults.hubLengthIn - 0.25, 9);
    expect(b.min[1]).toBeCloseTo(-b.max[1], 9);
    // the same depth as the rear beam
    const r = worldAABB(get(parts, 'beam-R'));
    expect(r.max[2]).toBeCloseTo(b.max[2], 9);
    expect(r.min[2]).toBeCloseTo(b.min[2], 9);
    // an overslung REAR beam leaves the front beam underslung (the king stack assumes it)
    expect(computeLayout({ ...defaults, axleBeamPosition: 1, deckHeightIn: 12 }).beamF.top).toBeCloseTo(5.2825, 9);
  });
  it('each stub axle is a 3/4 in rod from frontStubLenIn inside the beam end to past the hub, clamped by two bridge plates (D-62); the wheel sits on the free end', () => {
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
      for (let k = 1; k <= 2; k++) {
        const c = worldAABB(get(parts, `clamp-F${tag}${k}`));
        expect(c.min[2]).toBeCloseTo(L.beamF.top + defaults.axleProudIn, 9); // on the TUBE, which stands proud of the beam top (D-62)
        expect(s * (s > 0 ? c.min[1] : c.max[1])).toBeGreaterThan(s * (s > 0 ? rod.min[1] : rod.max[1]) - 1e-9); // within the clamped length
      }
    }
  });
});

describe('the kingpin stack (D-56, D-58)', () => {
  const stack = steerGeometry(defaults);
  it('the kingpin axis is vertical at x = wheelbase, y = 0, through the beam, the thrust disc and the king beam', () => {
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
    for (const id of ['beam-F', 'king-beam', 'king-thrust']) {
      const b = worldAABB(get(parts, id));
      expect(b.min[0], id).toBeLessThan(kx);
      expect(b.max[0], id).toBeGreaterThan(kx);
      expect(b.min[1], id).toBeLessThan(0);
      expect(b.max[1], id).toBeGreaterThan(0);
    }
  });
  it('the vertical stack (D-58, D-62): beam-F top 5.2825 < UHMW thrust disc (1/2, a catalog size) < king beam bottom 5.7825; the king beam top is the deck underside; the oak tongue stands 3/16 in under the beam top', () => {
    const beam = worldAABB(get(parts, 'beam-F')), tongue = worldAABB(get(parts, 'bridle-tongue'));
    const thr = worldAABB(get(parts, 'king-thrust')), king = worldAABB(get(parts, 'king-beam')), deck = worldAABB(get(parts, 'deck'));
    expect(beam.max[2]).toBeCloseTo(5.2825, 9);
    expect(thr.min[2]).toBeCloseTo(beam.max[2], 9); // the disc lies on the beam top
    expect(thr.max[2] - thr.min[2]).toBeCloseTo(defaults.kingThrustThickIn, 9);
    expect(thr.max[2]).toBeCloseTo(5.7825, 9); // D-62: the catalog 1/2 in UHMW disc
    expect(king.min[2]).toBeCloseTo(thr.max[2], 9);
    expect(king.max[2]).toBeCloseTo(L.deckBot, 9);
    expect(deck.min[2]).toBeCloseTo(king.max[2], 9); // bonded to the deck underside
    expect(king.max[2] - king.min[2]).toBeCloseTo(stack.kingDepth, 9);
    expect(stack.kingDepth).toBeGreaterThan(1.55);
    // the tongue top is tongueTopDropIn under the beam top, its bottom 1/16 in above the beam bottom
    expect(tongue.max[2]).toBeCloseTo(beam.max[2] - defaults.tongueTopDropIn, 9);
    expect(tongue.max[2] - tongue.min[2]).toBeCloseTo(defaults.tongueDepthIn, 9);
    expect(tongue.min[2]).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn);
    // clamp plates (3/8 in on the beam top) pass under the king beam with the running gap
    const plate = worldAABB(get(parts, 'clamp-FL1'));
    expect(king.min[2] - plate.max[2]).toBeGreaterThanOrEqual(0.125 - 1e-9);
    // the thrust disc: UHMW OD 3 centered on the kingpin
    expect(thr.max[0] - thr.min[0]).toBeCloseTo(defaults.kingThrustOdIn, 9);
    expect((thr.min[0] + thr.max[0]) / 2).toBeCloseTo(kx, 9);
    expect(get(parts, 'king-thrust').body).toBe('chassis');
  });
  it('the king beam spans between the rail inner faces at the kingpin (3 in fore-aft) and touches the deck underside', () => {
    const king = worldAABB(get(parts, 'king-beam'));
    const railL = worldAABB(get(parts, 'rail-L'));
    // the rails follow the bow turn-in (D-57): the beam ends at the rail inner face at its front edge
    expect(king.max[1]).toBeCloseTo(bodyHalf - defaults.railThicknessIn - L.turnIn(kx + defaults.kingBeamLengthIn / 2), 9);
    expect(king.max[1]).toBeGreaterThanOrEqual(railL.min[1] - 1e-9);
    expect(king.min[1]).toBeCloseTo(-king.max[1], 9);
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
  it('the rails are 3 in deep at the rear and only railDepthF ahead of railStepX, so the swinging beam passes under them with 0.35 in over the tube', () => {
    for (const tag of ['L', 'R']) {
      const r = get(parts, `rail-${tag}`);
      expect(r.stock).toBeDefined();
      expect(r.rough).toBeDefined();
      expect(r.stock!.t).toBeCloseTo(defaults.railThicknessIn / 2, 9); // S2: the cut list shows ONE strip of the two glued face to face
      expect(r.plies).toBe(2);
      expect(r.stock!.w).toBeCloseTo(defaults.railDepthIn, 9);
      const b = worldAABB(r);
      expect(b.max[2]).toBeCloseTo(L.deckBot, 9);
      expect(b.min[2]).toBeCloseTo(L.deckBot - defaults.railDepthIn, 9);
    }
    expect(L.railDepthF).toBeCloseTo(1.8655, 4); // D-71: 1/16 in deeper on the 5/8 in tube (1.803 at 3/4 in). D-62: the beam top is 0.05 in lower, the tube stands 0.05 proud and the clearance over the tube is beamRailClearIn 0.35 (was 0.4) for the catalog 1/4 in roll pad
    expect(L.railStepX).toBeLessThan(kx);
    expect(L.deckBot - L.railDepthF - L.beamF.top - defaults.axleProudIn).toBeCloseTo(defaults.beamRailClearIn, 6); // the rail bottom over the tube top
  });
});

describe('the oak tongue, shackle and bridle (D-56, D-58)', () => {
  const tongue = get(parts, 'bridle-tongue');
  it('the tongue reaches tongueTieAheadIn past the bow tip; the sleeve is tongueTipEdgeIn behind the tip, bored for a single strand of the bridle rope (no shackle, D-62)', () => {
    const t = worldAABB(tongue);
    expect(t.max[0]).toBeCloseTo(L.xFront + defaults.tongueTieAheadIn, 9);
    expect(L.tongue.holeX).toBeCloseTo(L.tongue.tipX - defaults.tongueTipEdgeIn, 9);
    expect(parts.some((x) => x.id === 'bridle-eye')).toBe(false); // the shackle is gone
    expect(L.tongue.tieZ).toBeCloseTo((L.tongue.z0 + L.tongue.z1) / 2, 9);
    // the sleeve lies across the stem at the hole, bored tongueSleeveBoreIn for the rope
    const sleeve = get(parts, 'bridle-sleeve');
    const sl = worldAABB(sleeve);
    expect((sl.min[0] + sl.max[0]) / 2).toBeCloseTo(L.tongue.holeX, 6);
    expect(sl.max[1] - sl.min[1]).toBeGreaterThanOrEqual(defaults.tongueWidthIn);
    const pin = sleeve.joints!.find((j) => j.to === 'bridle')!;
    expect(pin.diaIn).toBeCloseTo(defaults.bridleRopeDiaIn, 9);
    expect(defaults.tongueSleeveBoreIn).toBeGreaterThan(defaults.bridleRopeDiaIn);
    expect(sleeve.sourcing!.vendor).toMatch(new RegExp(`${defaults.tongueSleeveBoreIn.toFixed(2).replace(/0$/, '')}`));
    // the rope starts at the tongue tip and runs forward
    const rope = worldAABB(get(parts, 'bridle'));
    expect(rope.min[0]).toBeGreaterThan(L.tongue.holeX);
    expect((rope.min[2] + rope.max[2]) / 2).toBeCloseTo(L.tongue.tieZ, 6);
    expect(get(parts, 'bridle').joints!.some((j) => j.to === 'bridle-sleeve')).toBe(true);
    expect(get(parts, 'bridle-sleeve').joints!.some((j) => j.to === 'bridle')).toBe(true);
  });
  it('the tongue is white oak set ON EDGE, 1 1/2 in thick and 2 in deep: a 6 in head butting the front face of the beam, tapering to the stem; it has stock and rough stock and bolts to the beam with two 3/8 in carriage bolts', () => {
    expect(tongue.geometry.type).toBe('extrusion');
    expect(tongue.material).toBe('white oak');
    expect(tongue.kind).toBe('lumber');
    expect(tongue.stock).toBeDefined();
    expect(tongue.rough).toBeDefined();
    expect(tongue.stock!.t).toBeCloseTo(defaults.tongueDepthIn, 9);
    expect(tongue.stock!.w).toBeCloseTo(defaults.tongueHeadWidthIn, 9);
    const t = worldAABB(tongue);
    expect(t.max[1] - t.min[1]).toBeCloseTo(defaults.tongueHeadWidthIn, 9); // the head
    expect(t.min[0]).toBeCloseTo(kx + tHalf, 9); // butts the front face of the beam
    // the stem is tongueWidthIn thick across y
    const o = (tongue.geometry as Extract<Part['geometry'], { type: 'extrusion' }>).outline;
    const tipPts = o.filter((q) => q[0] > L.tongue.tipX - 1e-9);
    expect(Math.abs(tipPts[0][1] - tipPts[1][1])).toBeCloseTo(defaults.tongueWidthIn, 9);
    const bolts = tongue.joints!.find((j) => j.to === 'beam-F' && j.type === 'bolt')!;
    expect(bolts.count).toBe(2);
    expect(bolts.diaIn).toBeCloseTo(defaults.tongueBoltDiaIn, 9);
    expect(bolts.at!.map((q) => Math.abs(q[1]))).toEqual([defaults.tongueBoltOffsetIn, defaults.tongueBoltOffsetIn]);
    expect(Math.abs(bolts.at![0][1])).toBeGreaterThan(defaults.kingpinDiaIn / 2 + defaults.tongueBoltDiaIn / 2); // clear of the kingpin hole
    expect(tongue.massLb).toBeGreaterThan(1);
    expect(tongue.massLb).toBeLessThan(3.5);
    // it is NOT under the kingpin any more: no joint with the kingpin or the disc
    expect(tongue.joints!.some((j) => j.to === 'kingpin')).toBe(false);
  });
  it('the ROPE is the documented weak link (D-62, no shackle): 3/8 in NYLON (not low-stretch polyester), with its working load and the knotted breaking strength in the notes', () => {
    const rope = get(parts, 'bridle');
    expect(rope.kind).toBe('purchased');
    expect(rope.material).toMatch(/nylon/);
    expect(rope.sourcing!.vendor).toMatch(/NYLON/);
    expect(rope.sourcing!.vendor).toMatch(/NOT low-stretch polyester/);
    expect(rope.notes).toMatch(/WEAK LINK/);
    expect(rope.notes).toMatch(/370 lbf/); // working load limit
    expect(rope.notes).toMatch(/2220 lbf/); // breaks at the bowline
    expect(rope.sourcing!.vendor).toMatch(/shock cord/i);
    expect(rope.massLb).toBeGreaterThan(0.1);
    expect(rope.massLb).toBeLessThan(0.6);
  });
  it('D-65 (Eric): the tongue is bolted on with two carriage bolts and stays on in Transport mode: tongue, sleeve and rope are NOT removable (the steer ropes, when switched on, are)', () => {
    const removed = buildModel(defaults, { removed: true });
    for (const id of ['bridle-tongue', 'bridle-sleeve', 'bridle']) {
      expect(get(parts, id).removable, id).toBeFalsy();
      expect(removed.some((x) => x.id === id), id).toBe(true);
    }
    for (const id of ['beam-F', 'kingpin', 'king-beam', 'king-thrust', 'roll-pad-L', 'steer-eye-L', 'steer-anchor-L', 'steer-chain-L', 'axle-FL', 'axle-FR', 'wheel-FL', 'wheel-FR', 'clamp-FL1']) {
      expect(get(parts, id).removable, id).toBeFalsy();
      expect(removed.some((x) => x.id === id), id).toBe(true);
    }
    // nothing of the front end comes off: the sled still reaches the tongue tip
    const reach = Math.max(...removed.filter((x) => !x.payload).map((x) => worldAABB(x).max[0]));
    expect(reach).toBeGreaterThan(L.xFront + defaults.tongueTieAheadIn - 0.01);
  });
});

describe('the roll pads (D-58)', () => {
  it('two UHMW pads lie on the tube over the beam top, rollPadRadiusIn either side of the kingpin, 1/4 in thick (a catalog size, D-62), turning with the axle, with a running gap under the rails', () => {
    for (const [tag, s] of [['L', 1], ['R', -1]] as const) {
      const b = worldAABB(get(parts, `roll-pad-${tag}`));
      expect(b.min[2]).toBeCloseTo(L.beamF.top + defaults.axleProudIn, 9); // on the tube (D-62)
      expect(b.max[2] - b.min[2]).toBeCloseTo(defaults.rollPadThickIn, 9);
      expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(s * defaults.rollPadRadiusIn, 9);
      expect(b.max[1] - b.min[1]).toBeCloseTo(defaults.rollPadLenIn, 9);
      expect(b.max[0] - b.min[0]).toBeCloseTo(defaults.rollPadWidthIn, 9);
      expect(get(parts, `roll-pad-${tag}`).body).toBe('front-axle');
      // between the stub clamp plates on the beam top
      const inner = worldAABB(get(parts, `clamp-F${tag}2`)), outer = worldAABB(get(parts, `clamp-F${tag}1`));
      expect(s * (s > 0 ? b.min[1] : b.max[1])).toBeGreaterThan(s * (s > 0 ? inner.max[1] : inner.min[1]));
      expect(s * (s > 0 ? b.max[1] : b.min[1])).toBeLessThan(s * (s > 0 ? outer.min[1] : outer.max[1]));
    }
    const gap = L.deckBot - L.railDepthF - (L.beamF.top + defaults.axleProudIn + defaults.rollPadThickIn);
    expect(gap).toBeGreaterThanOrEqual(defaults.rollPadGapMinIn);
    expect(gap).toBeLessThanOrEqual(0.125);
    expect(get(parts, 'roll-pad-L').partNo).toBe(get(parts, 'roll-pad-R').partNo);
  });
});

describe('the steering check chains and the swept pose (D-58)', () => {
  const ch = L.chain;
  it('the chain joist (the crossmember just behind the king beam) is 1 1/2 in thick and carries the two anchor eye bolts, a little below mid depth on its front face', () => {
    const idx = L.joistX.indexOf(kx) - 1;
    expect(ch.joistX).toBe(L.joistX[idx]);
    const j = get(parts, joistId(L, idx));
    const b = worldAABB(j);
    expect(b.max[0] - b.min[0]).toBeCloseTo(defaults.chainJoistThickIn, 9);
    expect(j.partNo).toBe('chain-joist');
    for (const [tag, s] of [['L', 1], ['R', -1]] as const) {
      const a = get(parts, `steer-anchor-${tag}`);
      const ab = worldAABB(a);
      expect(a.joints!.some((q) => q.to === j.id && q.type === 'bolt')).toBe(true);
      expect(j.joints!.some((q) => q.to === a.id)).toBe(true);
      expect(ab.min[0]).toBeLessThan(b.min[0] + 1e-9);
      expect(ab.max[0]).toBeGreaterThan(b.max[0]); // the shank reaches the rear-face nut, the eye stands out of the front face
      expect((ab.min[1] + ab.max[1]) / 2).toBeCloseTo(s * Math.abs(ch.anchor[1]), 9);
      expect(Math.abs(ch.anchor[1])).toBeCloseTo(defaults.steerChainAnchorYIn, 9);
      expect(ch.anchor[2]).toBeLessThan((L.deckBot + (L.deckBot - defaults.crossmemberDepthIn)) / 2);
    }
  });
  it('the RIGHT chain goes taut at +lock (the right end of the beam swings forward, away from the anchor behind it) and hangs slack straight ahead and at -lock; the left is the mirror', () => {
    const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const A = ch.anchor;
    expect(dist(A, L.steer.beamEyeAt(lock * RAD))).toBeCloseTo(ch.lenIn, 9);
    expect(dist(A, L.steer.beamEyeAt(0))).toBeLessThan(ch.lenIn - 1); // at least an inch of slack straight ahead
    expect(dist(A, L.steer.beamEyeAt(-lock * RAD))).toBeLessThan(ch.lenIn);
    for (let d = -lock; d <= lock; d += 1) expect(dist(A, L.steer.beamEyeAt(d * RAD)), `${d} deg`).toBeLessThanOrEqual(ch.lenIn + 1e-9); // never more than taut inside the lock
    expect(dist(A, L.steer.beamEyeAt((lock + 3) * RAD))).toBeGreaterThan(ch.lenIn); // beyond the lock it would have to stretch
    // the model's beam eye bolts sit at the layout's eye positions (right eye: y < 0 behind the trailing face)
    const eye = worldAABB(get(parts, 'steer-eye-R'));
    expect((eye.min[1] + eye.max[1]) / 2).toBeCloseTo(-defaults.steerChainBeamYIn, 9);
    expect(eye.min[0]).toBeLessThan(kx - tHalf); // the ring stands out of the trailing face
    // at the lock the drawn right chain runs from the posed eye to the anchor and is as long as the chain
    const m = buildModel(defaults, { steerDeg: lock });
    const cb = worldAABB(get(m, 'steer-chain-R'));
    expect(cb.min[0]).toBeLessThan(A[0] + 1);
    const chain = get(m, 'steer-chain-R');
    const len = (chain.geometry as Extract<Part['geometry'], { type: 'box' }>).size[0];
    expect(len).toBeCloseTo(ch.lenIn, 6);
  });
  it('the chain stock and the eye bolts are purchased parts: a chain length that makes it taut exactly at the lock is in the sourcing note', () => {
    for (const id of ['steer-chain-L', 'steer-chain-R', 'steer-eye-L', 'steer-anchor-R']) {
      expect(get(parts, id).kind, id).toBe('purchased');
      expect(get(parts, id).fab, id).toBe('buy');
    }
    expect(get(parts, 'steer-chain-L').sourcing!.vendor).toMatch(/taut exactly at the 20° lock/);
    expect(new Set([get(parts, 'steer-chain-L').partNo, get(parts, 'steer-chain-R').partNo]).size).toBe(1);
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
      // the tongue tip goes to (44 + r cos, r sin)
      const tip = transformPoint(get(m, 'bridle-tongue').transform, [L.tongue.tipX, 0, L.tongue.z0]);
      const r = L.tongue.tipX - kx;
      expect(tip[0]).toBeCloseTo(kx + r * Math.cos(deg * RAD), 9);
      expect(tip[1]).toBeCloseTo(r * Math.sin(deg * RAD), 9);
      // and nothing of the chassis moves (the chains are drawn between the turning eye and the fixed anchor, so they follow the beam eye)
      for (const x of m.filter((q) => !q.payload && !turning(q) && !/^steer-chain-/.test(q.id))) expect(x.transform, x.id).toEqual(get(parts, x.id).transform);
    }
    // a steer past the lock is clamped to it
    const over = buildModel(defaults, { steerDeg: 90 });
    expect(Math.atan2(get(over, 'beam-F').transform[1], get(over, 'beam-F').transform[0])).toBeCloseTo(lock * RAD, 9);
  });
  it('sweep -lock..+lock in 1 degree steps: no turning part (beam, stubs, clamps, pads, eye bolts, kingpin, tongue, shackle, rope, wheels) penetrates any chassis part (rails, king beam, joists, disc, deck, body) beyond the kingpin contacts', () => {
    const bad: string[] = [];
    for (let deg = -lock; deg <= lock; deg += 1) for (const c of clashes(buildModel(defaults, { steerDeg: deg }))) bad.push(`${deg}: ${c}`);
    expect(bad).toEqual([]);
  });
  it('the sweep has teeth: the tongue head turned 40 degrees does hit the king beam / disc region and the clamp plates hit the chain joist side if the beam is moved sideways', () => {
    const m = buildModel(defaults, { steerDeg: 0 });
    const d = 40 * RAD, c = Math.cos(d), s = Math.sin(d);
    const rot = (x: Part): Part => {
      const t2 = x.transform.slice();
      const m0 = x.transform;
      const rotate = (a: number, b: number) => [c * a - s * b, s * a + c * b];
      for (const col of [0, 1, 2]) { const [u, v] = rotate(m0[col * 4], m0[col * 4 + 1]); t2[col * 4] = u; t2[col * 4 + 1] = v; }
      const [px, py] = rotate(m0[12] - kx, m0[13]);
      t2[12] = kx + px; t2[13] = py;
      return { ...x, transform: t2 };
    };
    const over = m.map((x) => (turning(x) ? rot(x) : x));
    expect(clashes(over).length).toBeGreaterThan(0);
  });
  it('the tires clear the body sides by at least steerClearIn at full lock (D-66: through the whole sweep, against the tapered side at the same x), using the posed wheel geometry, and the number equals steerGeometry', () => {
    const sg = steerGeometry(defaults);
    for (const deg of [-lock, -10, 0, 10, lock]) {
      const m = buildModel(defaults, { steerDeg: deg });
      for (const id of ['wheel-FL', 'wheel-FR']) {
        const clear = tireMinClear(get(m, id), defaults);
        expect(clear, `${id} ${deg}`).toBeGreaterThanOrEqual(defaults.steerClearIn + defaults.bowTaperSlackIn - 0.01);
      }
    }
    const m = buildModel(defaults, { steerDeg: lock });
    const cl = Math.min(...['wheel-FL', 'wheel-FR'].map((id) => tireMinClear(get(m, id), defaults)));
    expect(cl).toBeCloseTo(sg.clearAtLock, 1); // the 720-point rim sampling against the 0.1 in sweep grid
    expect(sg.clearAtLock).toBeGreaterThanOrEqual(defaults.steerClearIn + defaults.bowTaperSlackIn - 1e-6); // D-66: the taper is derived to this
    expect(sg.clearAtLock).toBeLessThan(defaults.steerClearIn + defaults.bowTaperSlackIn + 0.1);
    // at rest the clearance is the plain gap behind the taper: the rear track's 1-1/4 in
    const rest = tireMinClear(get(parts, 'wheel-FL'), defaults);
    expect(rest).toBeGreaterThan(1.25 - 1e-6);
    expect(defaults.frontTrackIn / 2 - defaults.tireWidthIn / 2 - bodyHalf).toBeCloseTo(1.25, 9);
  });
  it('the taper is DERIVED: at any front track that clears the body at rest (and any lock) the posed clearance at full lock is steerClearIn plus the slack, to within the 1/4 in rounding of the taper end, and the sweep stays clean', () => {
    for (const patch of [{ frontTrackIn: 29.5 }, { frontTrackIn: 31 }, { steerLockDeg: 22 }, { steerLockDeg: 15 }]) {
      const p = { ...defaults, ...patch } as Params;
      expect(validateParams(p).filter((i) => i.severity === 'error'), JSON.stringify(patch)).toEqual([]);
      const sgp = steerGeometry(p);
      const m = buildModel(p, { steerDeg: p.steerLockDeg });
      const cl = Math.min(...['wheel-FL', 'wheel-FR'].map((id) => tireMinClear(get(m, id), p)));
      expect(cl, JSON.stringify(patch)).toBeCloseTo(sgp.clearAtLock, 1);
      expect(cl, JSON.stringify(patch)).toBeGreaterThanOrEqual(p.steerClearIn + p.bowTaperSlackIn - 0.01);
      expect(cl, JSON.stringify(patch)).toBeLessThan(p.steerClearIn + p.bowTaperSlackIn + 0.25);
    }
  });
  it('minimum track for THIS body shape: the default has the 1/8 in slack, so the least track is a hair under it; the track is not what limits the taper (the shape is derived from it)', () => {
    const sg = steerGeometry(defaults);
    expect(sg.minTrack).toBeCloseTo(29.65, 1);
    expect(sg.minTrack).toBeLessThan(defaults.frontTrackIn);
    // a lock the body cannot clear is a validation error (the shortest S-curve is not enough), and the default sweeps clean through the whole range
    expect(validateParams({ ...defaults, steerLockDeg: 35, bowWidthIn: 21 }).some((i) => i.severity === 'error' && i.keys.includes('steerLockDeg'))).toBe(true);
    const bad: string[] = [];
    for (let deg = -lock; deg <= lock; deg += 2) bad.push(...clashes(buildModel(defaults, { steerDeg: deg })));
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
  it('the outer tire edge swings a circle of WB / sin(lock) + track / 2 + tire / 2 = 145.4 in about the turning center (D-66: 30 in front track); the inner edge 109.7 in', () => {
    const m = buildModel(defaults, { steerDeg: lock });
    const C: [number, number] = [0, sg.centerRadiusIn];
    const wheelDist = (id: string) => Math.hypot(get(m, id).transform[12] - C[0], get(m, id).transform[13] - C[1]);
    // the outer wheel at a left turn is the right one
    expect(wheelDist('wheel-FR') + defaults.tireWidthIn / 2).toBeCloseTo(sg.outerEdgeRadiusIn, 6);
    expect(wheelDist('wheel-FL') - defaults.tireWidthIn / 2).toBeCloseTo(sg.innerEdgeRadiusIn, 6);
    expect(sg.outerEdgeRadiusIn).toBeCloseTo(145.4, 1);
    expect(sg.innerEdgeRadiusIn).toBeCloseTo(111.9, 1); // 30 in front track (D-66; 34.5 in gave 147.6 / 109.65 at D-58)
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
  it('the new joints: kingpin through beam and king beam; tongue bolted to the beam, sleeve in the tongue; pads screwed to the beam; eye bolts through the beam and the chain joist, hooked to the chains; king beam tied to both rails and bonded to the deck; clamp plates bolted to the beam', () => {
    const has = (a: string, b: string, type?: string) => get(parts, a).joints?.some((j) => j.to === b && (!type || j.type === type)) ?? false;
    const cj = joistId(L, L.joistX.indexOf(kx) - 1);
    for (const [a, b] of [['kingpin', 'beam-F'], ['kingpin', 'king-beam'], ['bridle-tongue', 'beam-F'], ['bridle-tongue', 'bridle-sleeve'], ['bridle', 'bridle-sleeve'], ['king-beam', 'king-thrust'],
      ['king-beam', 'rail-L'], ['king-beam', 'rail-R'], ['king-beam', 'deck'], ['roll-pad-L', 'beam-F'], ['roll-pad-R', 'beam-F'], ['steer-eye-L', 'beam-F'], ['steer-eye-R', 'steer-chain-R'],
      ['steer-anchor-L', cj], ['steer-anchor-R', 'steer-chain-R'], ['clamp-FL1', 'beam-F'], ['clamp-FR2', 'beam-F']] as const) {
      expect(has(a, b), `${a} -> ${b}`).toBe(true);
      expect(has(b, a), `${b} -> ${a}`).toBe(true);
    }
    expect(has('kingpin', 'bridle-tongue')).toBe(false); // D-58: the tongue no longer lies under the kingpin
    expect(has('bridle-tongue', 'kingpin')).toBe(false);
  });
  it('the tongue joint locations are in its local frame (the model frame in plan, z from the tongue bottom): the carriage bolts one each side at the head, the sleeve at the hole', () => {
    const t = get(parts, 'bridle-tongue');
    const bolts = t.joints!.find((j) => j.to === 'beam-F')!;
    for (const a of bolts.at!) expect(a[0], 'bolt x').toBeCloseTo(kx + tHalf + defaults.tongueHeadLenIn / 2, 6);
    const w = transformPoint(t.transform, t.joints!.find((j) => j.to === 'bridle-sleeve')!.at![0]);
    expect(w[0]).toBeCloseTo(L.tongue.holeX, 6);
    expect(w[1]).toBeCloseTo(0, 6);
    expect(w[2]).toBeCloseTo(L.tongue.tieZ, 6);
  });
});

describe('cut list and stock (D-56)', () => {
  it('rails, the king beam, the chain joist, the front beam and the oak tongue all carry stock; lumber has rough stock larger in every dimension', () => {
    for (const id of ['rail-L', 'rail-R', 'king-beam', 'joist-5', 'beam-F', 'bridle-tongue']) {
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
    expect(get(parts, 'bridle-tongue').kind).toBe('lumber');
    expect(get(parts, 'bridle-tongue').fab).toBe('bandsaw');
  });
  it('identical pieces share a part number (cut list and BOM aggregate): both roll pads, all eight clamp plates, both stub axles', () => {
    expect(new Set([get(parts, 'roll-pad-L').partNo, get(parts, 'roll-pad-R').partNo]).size).toBe(1);
    expect(new Set(parts.filter((x) => /^clamp-F/.test(x.id)).map((x) => x.partNo)).size).toBe(1);
    expect(new Set([get(parts, 'axle-FL').partNo, get(parts, 'axle-FR').partNo]).size).toBe(1);
  });
});

describe('front-end masses at the defaults (D-56): ranges, not pins', () => {
  it('the front-end group is 10-25 lb, the empty sled about 150 lb (120-160), and the beam / tongue / king beam are in their expected bands', () => {
    const grp = parts.filter((x) => x.group === 'front-end').reduce((m, x) => m + x.massLb, 0);
    expect(grp).toBeGreaterThan(10);
    expect(grp).toBeLessThan(25);
    const tot = totalMass(parts);
    expect(tot).toBeGreaterThan(115);
    expect(tot).toBeLessThan(160);
    expect(get(parts, 'beam-F').massLb).toBeGreaterThan(4);
    expect(get(parts, 'beam-F').massLb).toBeLessThan(6.5);
    expect(get(parts, 'king-beam').massLb).toBeGreaterThan(2.3); // D-66: the beam spans the narrowed bow (17 in between the rails, was 21)
    expect(get(parts, 'king-beam').massLb).toBeLessThan(4.5);
    expect(get(parts, 'kingpin').massLb).toBeGreaterThan(0.2);
    expect(get(parts, 'kingpin').massLb).toBeLessThan(1);
    // the front beam is the same section as the rear beam but a hair shorter or longer by the track difference only
    expect(get(parts, 'beam-F').massLb / get(parts, 'beam-R').massLb).toBeCloseTo(((defaults.frontTrackIn - defaults.hubLengthIn - 0.25) * defaults.frontBeamThicknessIn) / ((defaults.rearTrackIn - defaults.hubLengthIn - 0.25) * defaults.axleBeamThicknessIn), 1);
  });
});
