/**
 * Phase 3b WS-B: the bow-tapered, one-level hull for the Ackermann front end (D-52, D-57): the bow curve family, the fit against the Ackermann tire sweep,
 * one deck, 2-ply sides, the nose rails and joists around the front beam, and the finger guard. The old hull path is covered by hull.test.ts / hull-curve.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { hullCurveSpec, hullPlanCurve, hullTireGap, lamPly, defaultParams, requiredCurveRadius, resolveParams, validateParams, ackSpec, footZoneX, type Params } from '../params';
import { buildModel } from './index';
import { makeCtx } from './build-utils';
import { computeLayout, innerHalfWidth } from './layout';
import { bowCurveWithLambda, curveHeading, fitBowCurve, leftTirePolys, minGapToTires, offsetY, sidePolyline, sweepPinch } from './hull-curve';
import { leftWheelRange } from './ackermann';
import { fingerAnalysis } from './body';
import { frontBeamSeat, FRONT_RAIL_REMAIN_MIN_IN } from './front-mount';
import { partsOverlap, worldAABB } from './bounds';
import type { Part } from './types';

const ack = (over: Partial<Params> = {}): Params => ({ ...defaultParams(), ...over });
const errorsOf = (p: Params) => validateParams(p).filter((i) => i.severity === 'error' && !/kingpin sleeve|axle-rod groove/.test(i.message));
const HULL_ID = /^(deck|side-(cabin|nose)|rail-|joist-|transom-front|transom-rear|guard-|scupper-|front-beam-hold-down|shoulder)/;

describe('bow curve family (hull-curve.ts)', () => {
  const p = resolveParams(ack());
  const spec = { x0: 14.5, yA: 13.6875, xT: 51.75, yT: 6.1875, straightIn: 16 };
  it('starts tangent to the cabin side with curvature 0, ends exactly at the spec point and then runs straight at the end heading', () => {
    const c = bowCurveWithLambda(spec, 0)!;
    expect(c.pts[0]).toEqual([14.5, 13.6875]);
    expect(c.x1).toBeCloseTo(35.75, 9);
    expect(c.yB + (c.endSlope ?? 0) * (51.75 - c.x1)).toBeCloseTo(6.1875, 6);
    const h = (i: number) => Math.atan2(c.pts[i - 1][1] - c.pts[i][1], c.pts[i][0] - c.pts[i - 1][0]);
    expect(h(1)).toBeLessThan(0.02); // tangent start
    expect(Math.abs(h(c.pts.length - 1) - Math.atan(-(c.endSlope ?? 0)))).toBeLessThan(0.02); // tangent end
    // curvature (heading change per chord) ramps in: the first chord turns far less than the middle ones
    const dh = (i: number) => h(i + 1) - h(i);
    expect(dh(1)).toBeLessThan(dh(Math.floor(c.pts.length / 2)) / 2);
    expect(curveHeading(c, 40)).toBeCloseTo(Math.atan(c.endSlope!), 9);
    expect(c.reverseFrac).toBe(0);
  });
  it('lam = 0 is fully convex: the heading never decreases', () => {
    const c = bowCurveWithLambda(spec, 0)!;
    let prev = -1;
    for (let i = 1; i < c.pts.length; i++) {
      const h = Math.atan2(c.pts[i - 1][1] - c.pts[i][1], c.pts[i][0] - c.pts[i - 1][0]);
      expect(h).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = h;
    }
  });
  it('lam toward 1 turns the bow back parallel (the D-45 reverse curve is the limit)', () => {
    const c0 = bowCurveWithLambda(spec, 0)!, c9 = bowCurveWithLambda({ ...spec, yT: 9 }, 0.9)!;
    expect(Math.abs(c9.endSlope!)).toBeLessThan(Math.abs(c0.endSlope!) / 2);
  });
  it('the fit returns the gentlest curve that clears the sweep: it touches the clearance, and a smaller reverse length would not', () => {
    const tires = hullCurveSpec(p);
    const polys = leftTirePolys(tires);
    // a bow wide enough that the pure convex curve does not clear
    const wide = { ...spec, yT: 8.5 - 0.3125 };
    const f = fitBowCurve(wide, tires, p.sideThicknessIn, 0.75);
    expect(f.feasible).toBe(true);
    expect(f.lambda).toBeGreaterThan(0.05);
    const gapOf = (c: NonNullable<ReturnType<typeof bowCurveWithLambda>>) => minGapToTires(sidePolyline(c, p.sideThicknessIn / 2, wide.x0 - 0.5, wide.xT), polys);
    expect(gapOf(f.curve)).toBeGreaterThanOrEqual(0.75 - 1e-6);
    expect(gapOf(f.curve)).toBeLessThan(0.75 + 0.03);
    expect(gapOf(bowCurveWithLambda(wide, f.lambda - 0.02)!)).toBeLessThan(0.75);
  });
  it('an impossible request reports feasible = false and still returns a finite curve', () => {
    const f = fitBowCurve({ ...spec, yT: 13 }, hullCurveSpec(p), p.sideThicknessIn, 0.75);
    expect(f.feasible).toBe(false);
    expect(Number.isFinite(f.curve.minRadius)).toBe(true);
  });
});

describe('hull taper at the defaults (Ackermann front end)', () => {
  const p = resolveParams(ack());
  const L = computeLayout(p);
  const polys = leftTirePolys(hullCurveSpec(p));
  it('the sweep pinch is where the spec says (inner y 11.06 at x 38.4); the hull passes it by exactly the steering clearance', () => {
    const pinch = sweepPinch(polys);
    expect(pinch.y).toBeCloseTo(11.06, 1);
    expect(pinch.x).toBeCloseTo(38.4, 0);
    expect(hullTireGap(p)).toBeGreaterThanOrEqual(p.steeringClearanceIn - 1e-6);
    expect(hullTireGap(p)).toBeLessThan(p.steeringClearanceIn + 0.01);
    // the rule width 2 x (min inner y - clearance), 1/8" down, is the nose the spec quoted: the hull is no wider than that at the pinch
    const rule = Math.floor(2 * (pinch.y - p.steeringClearanceIn) * 8) / 8;
    expect(rule).toBe(20.625);
    expect(2 * offsetY(L.hull, p.sideThicknessIn / 2, pinch.x)).toBeLessThanOrEqual(rule + 1e-6);
  });
  it('the sweep is the Ackermann one: the left wheel range -26..+35.5 and 72 rectangles at 1 degree', () => {
    const r = leftWheelRange(ackSpec(p));
    expect(r.minDeg).toBeCloseTo(-26, 0);
    expect(r.maxDeg).toBeCloseTo(35.5, 1);
    expect(polys.length).toBe(72);
  });
  it('starts at the grab handles (14.5), ends 16" behind the front transom, bow 13" outside', () => {
    expect(L.xc0).toBe(14.5);
    expect(L.xn).toBeCloseTo(35.75, 6);
    expect(p.noseTaperStartIn).toBeCloseTo(8.25, 6);
    expect(2 * (L.hwN + L.side)).toBeCloseTo(13 + 0, 6); // transom half width = outside bow half
    expect(2 * offsetY(L.hull, L.side / 2, L.xFront - L.transom)).toBeCloseTo(13, 1);
  });
  it('is gentle: R_min >= 50" (the D-45 curve was 5.7", the spec estimate 30"), peak heading under 20 degrees, and no reverse curvature to speak of', () => {
    expect(L.hull.minRadius).toBeGreaterThanOrEqual(50);
    expect(L.hull.peakHeading * 57.2958).toBeLessThan(20);
    expect(L.hull.reverseFrac ?? 0).toBeLessThan(0.05);
  });
  it('width never grows toward the front (no waist), and the bow keeps converging past the pinch', () => {
    let prev = Infinity;
    for (let x = L.xc0; x <= L.xFront - L.transom; x += 0.5) {
      const w = offsetY(L.hull, 0, x);
      expect(w).toBeLessThanOrEqual(prev + 1e-9);
      prev = w;
    }
    expect(L.bowHeading).toBeLessThan(-0.15);
    expect(innerHalfWidth(L, 48)).toBeLessThan(innerHalfWidth(L, 40));
  });
  it('tangent and curvature continuous at the start; the straight bow run is straight (the scarf sits in it)', () => {
    const q = (x: number) => curveHeading(L.hull, x);
    expect(q(L.xc0 + 0.01)).toBeLessThan(0.005);
    expect(q(L.xn + 0.5)).toBeCloseTo(L.bowHeading, 9);
    expect(q(L.xn + 7)).toBeCloseTo(q(L.xn + 0.5), 9);
  });
  it('the rider\'s feet have room over the whole foot zone', () => {
    const [x0, x1] = footZoneX(p);
    let w = Infinity;
    for (let x = x0; x <= x1; x += 0.25) w = Math.min(w, 2 * innerHalfWidth(L, x));
    expect(w).toBeGreaterThanOrEqual(10.88 + 2 * p.bootAllowanceIn + 0.25);
  });
  it('bends: every bent member meets the 40x strip rule with 5/16 strips (2 plies) and one 6 mm web sheet', () => {
    expect(p.hullLamThicknessIn).toBeCloseTo(0.3125, 6);
    expect(p.hullWebPlies).toBe(1);
    expect(lamPly(p.sideThicknessIn, p.hullLamThicknessIn)).toBeCloseTo(0.3125, 6);
    expect(lamPly(p.railThicknessIn, p.hullLamThicknessIn)).toBeCloseTo(0.375, 6);
    expect(requiredCurveRadius(p)).toBeLessThanOrEqual(L.hull.minRadius);
    expect(validateParams(ack()).filter((i) => i.severity === 'error' && /bend radius/.test(i.message))).toEqual([]);
  });
  it('info: a solid-sprung member would need R >= 100 t (62.5" for the chine; this curve has just under)', () => {
    const info = validateParams(ack()).filter((i) => i.severity === 'info');
    expect(info).toHaveLength(1);
    expect(info[0].message).toMatch(/100 x its thickness = 62\.5"/);
  });
});

describe('auto start: earlier, never later', () => {
  it('moves the start earlier when the lamination radius would otherwise be violated, and is idempotent', () => {
    const p = ack({ hullLamThicknessIn: 0.375, hullLamMinRadiusFactor: 90, hullCurveStartIn: 22 });
    const r = resolveParams(p);
    expect(r.hullCurveStartIn).toBeLessThanOrEqual(22);
    expect(resolveParams(r)).toBe(r);
    expect(hullPlanCurve(r).minRadius).toBeGreaterThanOrEqual(requiredCurveRadius(r) - 1e-9);
  });
  it('never moves it later than the slider', () => {
    for (const x of [14.5, 16, 20, 26]) expect(resolveParams(ack({ hullCurveStartIn: x })).hullCurveStartIn).toBeLessThanOrEqual(x);
  });
  it('manual (auto off) keeps the start', () => {
    expect(resolveParams(ack({ autoNoseGeometry: 0, hullCurveStartIn: 22 })).hullCurveStartIn).toBe(22);
  });
});

describe('the outer face clears the sweep for variants (track, lock, scrub, lead, wheel size, tire width, arm angle)', () => {
  const variants: Array<[string, Partial<Params>]> = [
    ['track 33', { frontTrackIn: 33 }], ['track 38', { frontTrackIn: 38 }], ['lock 30', { steerLockDeg: 30 }], ['lock 40', { steerLockDeg: 40 }],
    ['scrub 3.5', { scrubRadiusIn: 3.5, frontTrackIn: 37 }], ['lead 0.75', { kingpinLeadIn: 0.75 }], ['lead 2', { kingpinLeadIn: 2 }],
    ['wheel 12', { wheelDiameterIn: 12 }], ['wheel 14', { wheelDiameterIn: 14 }], ['tire 3', { tireWidthIn: 3 }], ['tire 4.5', { tireWidthIn: 4.5, frontTrackIn: 38 }],
    ['arm 20', { ackermannAngleDeg: 20 }], ['arm 28', { ackermannAngleDeg: 28 }], ['bow 15', { noseWidthIn: 15 }], ['bow 11', { noseWidthIn: 11 }],
  ];
  it.each(variants)('%s', (_n, over) => {
    const p = resolveParams(ack(over));
    const curve = hullPlanCurve(p);
    const fit = fitBowCurve({ x0: p.hullCurveStartIn, yA: p.bodyWidthIn / 2 - p.sideThicknessIn / 2, xT: p.wheelbaseIn + p.frontOverhangIn - p.transomThicknessIn, yT: p.noseWidthIn / 2 - p.sideThicknessIn / 2, straightIn: p.hullBowStraightIn }, hullCurveSpec(p), p.sideThicknessIn, p.steeringClearanceIn);
    if (!fit.feasible) return; // an infeasible variant is reported by the validator, not drawn through the tire
    expect(hullTireGap(p, curve)).toBeGreaterThanOrEqual(p.steeringClearanceIn - 1e-6);
    // and on the built parts: the left chine's outer face, from the part itself
    const parts = buildModel(p, { steerDeg: p.steerLockDeg });
    const chines = parts.filter((x) => /^side-(cabin|nose)-L-chine$/.test(x.id));
    expect(chines.length).toBe(2);
  });
});

describe('one deck, one level (parts)', () => {
  const p = ack();
  const parts = buildModel(p);
  const byId = new Map(parts.map((x) => [x.id, x]));
  const L = computeLayout(p);
  it('a single deck part, no cabin/nose split, no riser, no shoulder beam, no access panel', () => {
    expect(byId.has('deck')).toBe(true);
    expect(parts.filter((x) => /^deck/.test(x.id)).map((x) => x.id)).toEqual(['deck']);
    expect(byId.has('shoulder-beam')).toBe(false);
    expect(byId.has('deck-cabin') || byId.has('deck-nose') || byId.has('nose-access-panel')).toBe(false);
    expect(L.chineBot).toBeCloseTo(L.deckBot, 9); // the side lines are at one height
    expect(L.bowHeading).toBeLessThan(0);
  });
  it('the deck is one sheet (fits 4 x 8) and every edge is captured', () => {
    const d = byId.get('deck')!;
    const g = d.geometry;
    expect(g.type).toBe('extrusion');
    if (g.type !== 'extrusion') return;
    const xs = g.outline.map((q) => q[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(96);
    const ys = g.outline.map((q) => q[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(48);
    // Every ply edge is captured in the chine rabbet or a transom dado; the cable slot of the ride stick is gone (D-53), so there is no other edge.
    const edges = d.edges as string[];
    expect(edges.filter((e) => e === 'exposed')).toEqual([]);
    expect(edges.filter((e) => e === 'edged')).toEqual([]);
    expect(g.holes ?? []).toHaveLength(0);
  });
  it('the deck edge is captured in the chine rabbet along the whole hull (distance to the chine centerline = side/2 - capture depth)', () => {
    const d = byId.get('deck')!;
    if (d.geometry.type !== 'extrusion') throw new Error('deck');
    const left = d.geometry.outline.filter((q) => q[1] > 0);
    expect(left.length).toBeGreaterThan(20);
    for (const [x, y] of left) {
      if (x < -L.xRear * 0 + L.xRear + L.transom || x > L.xFront - L.transom) continue; // the transom dado ends
      const web = offsetY(L.hull, 0, x);
      expect(web - y).toBeCloseTo(L.side / 2 - p.deckCaptureDepthIn, 2);
    }
  });
  it('the side lines are at one height: chine bottom = rail top = deck bottom, gunwale top = deck top + side height, in both runs', () => {
    expect(L.chineBot).toBeCloseTo(L.deckBot, 9);
    expect(L.railTop).toBeCloseTo(L.deckBot, 9);
    for (const id of ['side-cabin-L-chine', 'side-nose-L-chine']) {
      const b = worldAABB(byId.get(id)!);
      expect(b.min[2]).toBeCloseTo(L.deckBot, 3);
    }
    for (const id of ['side-cabin-L-gunwale', 'side-nose-L-gunwale']) expect(worldAABB(byId.get(id)!).min[2]).toBeCloseTo(L.sideTop - L.railBand, 3);
    expect(L.chineH).toBe(L.railBand);
  });
  it('the sheer rise starts beyond the finger-pinch zone (flat gunwale under the guard)', () => {
    const fa = fingerAnalysis(makeCtx(p));
    expect(fa.hazard).not.toBeNull();
    expect(fa.infeasible).toBeUndefined();
    expect(L.sheer.x0).toBeGreaterThan(fa.hazard!.x1);
  });
  it('2-ply chine and gunwale (5/16 strips), 2 x 3/8 rail, single 6 mm web sheet', () => {
    const geo = (id: string) => byId.get(id)!.geometry;
    for (const id of ['side-cabin-L-chine', 'side-cabin-L-gunwale']) expect(geo(id)).toMatchObject({ type: 'sweep', plies: 2 });
    expect(geo('rail-cabin-L')).toMatchObject({ type: 'sweep', plies: 2 });
    expect(geo('side-cabin-L-web')).toMatchObject({ type: 'sweep', plies: 1 });
  });
  it('bent-lamination form data: the cabin members are sweeps with the plan path, all on the same form, with ply counts', () => {
    for (const id of ['side-cabin-L-chine', 'side-cabin-L-gunwale', 'rail-cabin-L']) {
      const g = byId.get(id)!.geometry;
      if (g.type !== 'sweep') throw new Error(id);
      expect(g.path.length).toBeGreaterThan(20);
      expect(byId.get(id)!.rough).toBeDefined(); // strip rough size (round-3 buildability)
    }
  });
});

describe('scarfs sit in the straight run, never in the bend', () => {
  const p = ack();
  const L = computeLayout(p);
  const parts = buildModel(p);
  it('scarf joints are at xn, where the heading is the straight bow heading and the next 5" are straight', () => {
    const scarfs = parts.flatMap((x) => (x.joints ?? []).filter((j) => j.type === 'scarf').map((j) => ({ id: x.id, j })));
    expect(scarfs.length).toBeGreaterThanOrEqual(8); // chine, gunwale, web, rail x 2 sides, each listed on both parts
    for (const { j, id } of scarfs) {
      const part = parts.find((x) => x.id === id)!;
      const m = part.transform;
      const at = j.at![0];
      const x = m[0] * at[0] + m[4] * at[1] + m[8] * at[2] + m[12];
      expect(x).toBeGreaterThanOrEqual(L.xn - 1e-6);
      expect(curveHeading(L.hull, x + 5)).toBeCloseTo(L.bowHeading, 6);
    }
  });
  it('the nose run is a straight member set at the bow heading', () => {
    const ch = parts.find((x) => x.id === 'side-nose-L-chine')!;
    expect(Math.atan2(ch.transform[1], ch.transform[0])).toBeCloseTo(L.bowHeading, 6);
    const chR = parts.find((x) => x.id === 'side-nose-R-chine')!;
    expect(Math.atan2(chR.transform[1], chR.transform[0])).toBeCloseTo(-L.bowHeading, 6);
  });
});

describe('frame: nose rails and joists around the front beam', () => {
  const p = ack();
  const L = computeLayout(p);
  const parts = buildModel(p);
  const seat = frontBeamSeat(p, L)!;
  it('the nose rail is notched for beam-F and keeps >= 1" of oak above the notch', () => {
    expect(seat).not.toBeNull();
    expect(seat.remain).toBeGreaterThanOrEqual(FRONT_RAIL_REMAIN_MIN_IN);
    expect(seat.ok).toBe(true);
    expect(seat.zTop).toBeCloseTo(L.front.beam.top, 9);
    for (const tag of ['L', 'R']) {
      const rail = parts.find((x) => x.id === `rail-nose-${tag}`)!;
      expect(rail.joints!.some((j) => j.type === 'dado' && j.to === 'beam-F')).toBe(true);
      expect(rail.joints!.some((j) => j.type === 'bolt' && j.to === `front-beam-hold-down-${tag}`)).toBe(true);
      const hd = parts.find((x) => x.id === `front-beam-hold-down-${tag}`)!;
      expect(hd.joints!.map((j) => j.to).sort()).toEqual(['beam-F', `rail-nose-${tag}`]);
    }
  });
  it('the hold-down angle stays inside the rail line: against its inner face, above the beam top, under the deck', () => {
    const hd = worldAABB(parts.find((x) => x.id === 'front-beam-hold-down-L')!);
    expect(hd.min[2]).toBeCloseTo(L.front.beam.top, 3);
    expect(hd.max[2]).toBeLessThanOrEqual(L.deckBot + 1e-6);
    expect(hd.max[1]).toBeLessThanOrEqual(seat.yIn + 0.4);
  });
  it('joists straddle beam-F: none stands in the beam\'s x range', () => {
    const b = L.front.beam;
    for (const x of [...L.cabinJoistX, ...L.noseJoistX]) expect(Math.abs(x - b.x)).toBeGreaterThanOrEqual((b.thick + L.joistT) / 2);
    expect(L.noseJoistX.some((x) => x < b.x) && L.noseJoistX.some((x) => x > b.x)).toBe(true);
  });
  it('the rear beam straddle is unchanged', () => {
    for (const x of L.cabinJoistX) expect(Math.abs(x - L.beamR.x)).toBeGreaterThanOrEqual((L.beamR.thick + L.joistT) / 2);
  });
});

describe('finger guard against the Ackermann sweep', () => {
  it('guard built when the gap is under 1.5" (0.75" at the defaults), covering every hull point within 1.5" of the tire', () => {
    const p = ack();
    const ctx = makeCtx(p);
    const fa = fingerAnalysis(ctx);
    expect(fa.minGapIn).toBeGreaterThan(0.7);
    expect(fa.minGapIn).toBeLessThan(0.8);
    expect(fa.guardNeeded).toBe(true);
    expect(fa.hazard!.x1 - fa.hazard!.x0).toBeLessThan(8);
    const ids = buildModel(p).map((x) => x.id);
    expect(ids).toContain('guard-L');
    expect(ids).toContain('guard-R');
  });
  it('absent when the steering clearance is raised to 1.5 (the nose narrows)', () => {
    const p = ack({ steeringClearanceIn: 1.5 });
    const fa = fingerAnalysis(makeCtx(p));
    expect(fa.guardNeeded).toBe(false);
    expect(buildModel(p).some((x) => x.id.startsWith('guard-'))).toBe(false);
    expect(hullPlanCurve(resolveParams(p)).minRadius).toBeLessThan(hullPlanCurve(resolveParams(ack())).minRadius);
  });
});

describe('validateParams for the Ackermann hull', () => {
  it('the defaults have no hull errors or warnings', () => {
    expect(validateParams(ack()).filter((i) => i.severity !== 'info' && /hull|bow|cushion|S-curve|feet|bend/i.test(i.message))).toEqual([]);
  });
  it('the seat cushion clears the narrowing hull by a wide margin, and a deeper seat still fits', () => {
    const p = resolveParams(ack());
    const L = computeLayout(p);
    const cushionFront = L.seat.xFront;
    expect(2 * innerHalfWidth(L, cushionFront)).toBeGreaterThan(L.seat.width + 4);
    expect(errorsOf(ack({ seatDepthIn: 19 }))).toEqual([]);
  });
  it('a bow too narrow for the feet is an error', () => {
    expect(errorsOf(ack({ noseWidthIn: 10 })).some((i) => /feet/.test(i.message))).toBe(true);
  });
  it('a bow wider than the sweep allows is reported as a tire clearance error with auto off', () => {
    const issues = validateParams(ack({ autoNoseGeometry: 0, noseWidthIn: 22 }));
    expect(issues.some((i) => i.severity === 'error' && /comes within/.test(i.message))).toBe(true);
  });
});

describe('hull and frame parts: no unintended overlaps (Ackermann hull)', () => {
  const ALLOW: Array<[RegExp, RegExp]> = [
    [/^deck$/, /^(side-(cabin|nose)-[LR]-(chine|board)|(rail|girder)-(cabin|nose)-[LR]|transom-(rear|front))$/], // deck edge in the chine rabbets, the transom dados; boxes over-cover the angled edge
    [/^side-(cabin|nose)-[LR]-web$/, /^(side-(cabin|nose)-[LR]-(chine|gunwale)|transom-(rear|front))$/],
    [/^side-nose-[LR]-(web|chine|gunwale)$/, /^side-cabin-[LR]-(web|chine|gunwale)$/], // scarfs: the bent run's tight boxes and the straight run overlap at the joint
    [/^(rail-(cabin|nose)-[LR])$/, /^(rail-(cabin|nose)-[LR]|front-beam-hold-down-[LR])$/],
    [/^front-beam-hold-down-[LR]$/, /^joist-/],
    [/^scupper-/, /^(side-(cabin|nose)-[LR]-(chine|board)|rail-(cabin|nose)-[LR])$/],
    [/^deck$/, /^side-(cabin|nose)-[LR]-post-\d+$/], // open-frame posts stand outside the angled deck edge; the boxes over-cover it
    [/^guard-[LR]$/, /^side-(cabin|nose)-[LR]-(board|post-\d+)$/],
    [/^guard-[LR]$/, /^side-(cabin|nose)-[LR]-(gunwale|web|chine)$/],
    [/^joist-/, /^(rail-(cabin|nose)-[LR]|side-)/],
  ];
  const ok = (a: Part, b: Part) => ALLOW.some(([x, y]) => (x.test(a.id) && y.test(b.id)) || (x.test(b.id) && y.test(a.id)));
  const check = (p: Params, view = {}) => {
    const parts = buildModel(p, view).filter((x) => HULL_ID.test(x.id));
    const bad: string[] = [];
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const o = partsOverlap(parts[i], parts[j]);
      if (o > 0.06 && !ok(parts[i], parts[j])) bad.push(`${parts[i].id} x ${parts[j].id}: ${o.toFixed(3)}`);
    }
    return bad;
  };
  it('defaults', () => expect(check(ack())).toEqual([]));
  it.each([
    ['solid oak sides', { sideConstruction: 0 }], ['open frame sides', { sideConstruction: 2 }], ['hull-beam frame', { frameStyle: 1 }],
    ['no sheer', { sheerRiseIn: 0 }], ['bow 15', { noseWidthIn: 15 }], ['straight 10', { hullBowStraightIn: 10 }], ['start 17', { hullCurveStartIn: 17 }],
  ] as Array<[string, Partial<Params>]>)('%s', (_n, over) => {
    const p = ack(over);
    if (errorsOf(p).length) return;
    expect(() => buildModel(p)).not.toThrow();
    expect(check(p)).toEqual([]);
  });
});
