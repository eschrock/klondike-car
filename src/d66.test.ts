/**
 * D-66 (Eric 2026-10-12): matched tracks and a gradual bow taper. Rear AND front track 30 in (tire to body gap 1-1/4 in), the cargo load-height rule 10 in, and the abrupt 1-1/4 in turn-in over
 * 14 in replaced by a long S-curve taper that starts mid-cabin (x = 20) and is DERIVED from the swing of the front wheels (`bowTaper`). The results are pinned here; the pieces are in
 * params.test.ts (the taper function), body.test.ts (the model), pivot.test.ts (the posed wheels), brake.test.ts (the slotted knee) and track-d58.test.ts (the D-58 history).
 */
import { describe, expect, it } from 'vitest';
import { bowTaper, defaultParams, steerGeometry, validateParams, type Params } from './params';
import { PRE_D72 } from './test-fixtures';
import { buildModel } from './model';
import { computeLayout } from './model/layout';
import { totalMass } from './model/mass';
import { worldAABB } from './model/bounds';
import { runChecks } from './analysis';
import { riderSweep } from './analysis/rider-sweep';
import { cargoCapacity } from './analysis/cargo-capacity';
import { checkTruckFit } from './truck/fit';

const defaults = defaultParams();
const L = computeLayout(defaults);
const cs = runChecks(defaults, { includeTruck: false });
const row = (id: string) => cs.find((c) => c.id === id)!;

describe('D-66 matched tracks', () => {
  it('rear and front track are both 30 in: the straight-ahead wheels line up; the tire inner face is 13-1/4 in off center, 1-1/4 in from the 12 in body side (3/4 in is the least)', () => {
    expect(defaults.rearTrackIn).toBe(30);
    expect(defaults.frontTrackIn).toBe(defaults.rearTrackIn);
    const gap = defaults.rearTrackIn / 2 - defaults.tireWidthIn / 2 - defaults.bodyWidthIn / 2;
    expect(gap).toBeCloseTo(1.25, 9);
    expect(gap).toBeGreaterThanOrEqual(0.75);
    const parts = buildModel(defaults);
    for (const [f, r] of [['wheel-FL', 'wheel-RL'], ['wheel-FR', 'wheel-RR']]) expect(parts.find((x) => x.id === f)!.transform[13]).toBeCloseTo(parts.find((x) => x.id === r)!.transform[13], 9);
    expect(validateParams(defaults).filter((i) => i.severity !== 'info')).toEqual([]);
  });
  it('overall width is the 30 in track plus the hub and axle end (34.3 in; it was 38.8 in), and the sled still fits beside in the bed, assembled and in Transport mode', () => {
    const fit = checkTruckFit(defaults, (v) => buildModel(defaults, v));
    expect(fit.dims.installed.widthIn).toBeCloseTo(34.28, 1);
    expect(fit.anyFits).toBe(true);
    for (const config of ['installed', 'removed']) expect(fit.cases.some((c) => c.mode === 'beside' && c.config === config && c.fits), config).toBe(true);
    expect(row('turn-radius').value).toBeCloseTo(145.4, 0); // outer tire edge radius in (150 limit): a hair better than 147.6 at the 34.5 in front track
  });
  it('mass 115.5 lb (119.9 before): the narrower bow, a shorter front beam and king beam, the shorter stubs and the lighter rear plates (D-72/D-73: 120.7 lb with the solid axle rod, +1.9, and the 1/4 in white oak sides, box and lid, +2.8)', () => {
    const m = totalMass(buildModel(defaults, { rider: 'none', cargo: false }));
    expect(m).toBeGreaterThan(119.5); // D-76: 120.2 lb (the side ribs, +0.96); D-74: 119.2 lb with the 2-1/8 in laminated beams, knees and chocks (-1.3 lb on 120.5)
    expect(m).toBeLessThan(123); // 2026-10-24: 122.81 lb (13 mm deck, 5 mm combi-core white oak sides as bought); D-85: 122.80 lb (the rear ribs and rings, +0.72 lb); D-80/D-83: 121.64 lb (the 6 mm Baltic birch thin sheet is heavier than the 1/4 in white oak ply, the 2 in clamp plates, less the lighter EVA seat pads); D-77: 121.09 lb (the pivot straps and the knee roofs, +0.87)
    // with the D-71 tube and the 4 mm okoume (PRE_D72) the D-66 / D-71 mass is back
    const old = totalMass(buildModel({ ...defaults, ...PRE_D72, deckPlyIn: 0.472, seatBackPlyIn: 0.472, seatBackThickIn: 0.472 } as Params, { rider: 'none', cargo: false })); // 2026-10-24: and the 12 mm deck (the defaults are the 13 mm sheet as bought)
    expect(old).toBeGreaterThan(114.9); // D-76: 115.5 lb (the side ribs); D-74: 114.5 lb (the 2-1/8 in laminated parts), 115.5 before
    expect(old).toBeLessThan(117.4); // D-85: 116.81 lb (+0.75); D-77: 116.40 lb (the pivot straps and the knee roofs, +0.87)
  });
});

describe('D-66 bow taper', () => {
  const t = bowTaper(defaults);
  it('starts at x = 20 (mid-cabin), takes 22 in, goes from 24 in to 18.5 in outside; 17-1/4 in is left inside for the rider\'s feet (12 to 14 in needed)', () => {
    expect(t.x0).toBe(20);
    expect(t.x1 - t.x0).toBeGreaterThan(20);
    expect(t.x1 - t.x0).toBeLessThan(25);
    expect(t.turnIn).toBeCloseTo(2.75, 12);
    const inside = defaults.bowWidthIn - 2 * defaults.sideThicknessIn;
    expect(inside).toBeCloseTo(17.25, 9);
    expect(inside).toBeGreaterThan(14);
    expect(2 * (L.hwC - L.turnIn(L.xFlatEnd))).toBeCloseTo(17.25, 9);
    expect(validateParams(defaults).some((i) => /feet need/.test(i.message))).toBe(false);
  });
  it('is gradual: never steeper than 14 degrees, curvature-continuous (smootherstep), tightest bend 31 in against the 9.4 in cold-bend limit of a 0.234 in band', () => {
    let maxSlope = 0;
    for (let x = t.x0; x < t.x1; x += 0.05) maxSlope = Math.max(maxSlope, (L.turnIn(x + 0.05) - L.turnIn(x)) / 0.05);
    expect((Math.atan(maxSlope) * 180) / Math.PI).toBeLessThan(14);
    expect(t.minRadiusIn).toBeGreaterThan(30);
    expect(t.minRadiusIn).toBeGreaterThan(defaults.hullLamMinRadiusFactor * L.sideBand * 3);
  });
  it('keeps the front tires steerClearIn + 1/8 in clear of the body through the whole +-20 degree sweep (derived from the real wheel sweep): the steer-clear row passes with room', () => {
    const sg = steerGeometry(defaults);
    expect(sg.clearAtLock).toBeGreaterThanOrEqual(0.75 + 0.125 - 1e-6);
    expect(row('steer-clear').status).toBe('pass');
    expect(row('steer-clear').util!).toBeLessThan(0.9); // 0.83: 0.90 in against the 0.75 in limit
  });
  it('the sandwich bands stay bendable, the bow bulkhead follows the taper, and the deck, rails and chain joist follow it too', () => {
    expect(validateParams(defaults).filter((i) => i.severity === 'error')).toEqual([]);
    expect(L.bulkhead.halfW).toBeCloseTo(9.25, 9);
    const m = buildModel(defaults);
    const bb = worldAABB(m.find((x) => x.id === 'bow-bulkhead')!);
    expect(bb.max[1]).toBeCloseTo(9.25, 6);
    const king = worldAABB(m.find((x) => x.id === 'king-beam')!);
    expect(king.max[1]).toBeCloseTo(11.25 - L.turnIn(L.king.x + defaults.kingBeamLengthIn / 2), 6); // between the rails: 17 in
    expect(2 * king.max[1]).toBeLessThan(18);
  });
});

describe('D-66 the numbers that moved', () => {
  it('cargo: the load-height rule is 10 in; the 200 lb cargo tips at 40.7 deg (D-67 limit 35: a plain pass, it was marginal at the D-66 limit of 40), the capacity is 223 lb (D-71: 274 lb with the 3/4 in axle) and the rear axle-stress row limits it (D-66 had it at 226 lb on the tip row; the front beam at 269 lb before)', () => {
    expect(defaults.cargoCgHeightIn).toBe(10);
    const tip = row('tip-straight');
    expect(tip.cases!.cargo!.value).toBeCloseTo(40.99, 1); // 2026-10-24: 40.99 (13 mm deck, 5 mm combi-core white oak sides as bought); D-84: 40.93 (the 1/2 in grab-board caps); D-76: 40.88 (the ribs, 0.96 lb, mostly low and forward); 40.8 after D-74 (the 1.3 lb lighter sled) // unchanged by D-67: the limit moved, not the sled (40.65 before D-71: the 0.36 lb heavier sled; 40.9 with the D-72/D-73 4.7 lb heavier sled)
    expect(tip.cases!.cargo!.limit).toBe(35);
    expect(tip.cases!.cargo!.value).toBeGreaterThan(35 * 1.1); // outside the 10% marginal band (38.5)
    expect(tip.statusCargo).toBe('pass'); // marginal at the 40 deg limit
    const cap = cargoCapacity(defaults);
    expect(cap.capacityLb!).toBeGreaterThanOrEqual(200);
    expect(cap.capacityLb!).toBeLessThan(300); // 254 lb with the solid rod (223 lb with the D-71 tube, 274 lb at 3/4 in)
    expect(cap.limiter!.id).toBe('brake-mount'); // D-78 removable knees (the default): the dry knee limits; glued knees: 'rear-beam-seat'. D-83: the 2 in clamp plates raise the groove bearing, so the rear beam seat limits; D-71 solid rod: bearing-groove (the tube's axle-stress limited it); the tip row no longer limits (it did at 226 lb with the 40 deg limit)
    expect(cap.statusAtPayload).not.toBe('fail');
    expect(cap.cargoFailsAtPayload).toEqual([]);
  });
  it('riders: safe 50 to over 250 lb (nothing red), green 50 to 240 lb (D-67: the straight tip, 43.6 deg at 200 lb, clears its 35 deg limit with room; it was inside the 10% band of the old 40 deg limit from 190 lb, green 50-180 lb; 250 lb is yellow on the seat-back panel only)', () => {
    const sw = riderSweep(defaults);
    expect(sw.safe).toEqual({ loLb: 50, hiLb: 230, openLow: true, openHigh: false }); // D-84: the honest grab-board row
    expect(sw.green).toMatchObject({ loLb: 50, hiLb: 210, openLow: true, openHigh: false }); // (2026-10-24: D-96/97/98) 210 lb on the sheets as bought, the grab board (seat-grip) goes yellow at 220; D-83: 240 lb again with the 2 in clamp plates (more groove bearing area); D-73: 220 lb. D-71: 240 lb with the 3/4 in axle, 180 lb with the 5/8 in tube; the solid 5/8 in rod and the 4.7 lb heavier D-73 sled: 220 lb (230 lb with the 4 mm okoume)
    expect(row('tip-straight').cases!.goal!.value).toBeCloseTo(44.3, 0); // D-83: 44.3 deg (the 6 mm Baltic sides and the lighter EVA seat move the center of gravity a little); 43.6 before
    expect(row('tip-straight').statusGoal).toBe('pass'); // marginal at the 40 deg limit (util 0.80 now, 35 / 43.6)
    expect(row('tip-lock').status).toBe('pass');
    expect(row('slide-before-tip').status).toBe('pass');
  });
  it('no row fails at 150 lb, 200 lb or the 200 lb cargo; only the turn radius and the fit facts are above 0.9 (D-67: the tip row, 0.95 at the 40 deg limit, is down to 0.86 on the cargo case)', () => {
    for (const c of cs) {
      expect(c.statusOperating ?? c.status, c.id).not.toBe('fail');
      expect(c.statusGoal ?? c.status, c.id).not.toBe('fail');
      expect(c.statusCargo ?? 'pass', c.id).not.toBe('fail');
    }
    const high = cs.filter((c) => c.status !== 'info' && ((c.util ?? 0) > 0.9 || (c.utilCargo ?? 0) > 0.9)).map((c) => c.id).sort();
    expect(high).toEqual(['park-hold', 'seat-stow', 'side-web', 'turn-radius']); // 2026-10-24: side-web 0.96 marginal on the 5 mm combi-core white oak sides as bought (0.33 on the 6 mm Baltic birch); D-85: the ring count is no longer above 0.9 (8 rings); // D-71 tube: axle-stress 0.925 at the 200 lb rider, 0.957 on the cargo; the solid rod brings it to 0.79 / 0.82
    expect(row('rest-load').status).toBe('pass'); // the resting 250 lb adult still passes: holds up to 348 lb, the heavier wheel is the tightest member (73%)
    expect(row('rest-load').how).toMatch(/holds up to 36\d lb/); // (2026-10-24: D-96/97/98) 360 lb with the stiffer 13 mm deck as bought (34x lb with the 12 mm deck)
  });
  it('front end at the narrow bow: the roll pads (9-3/4 in out, D-83) are under the rails at every angle, the chain eyes stay inside the rails, the king beam is 17 in between the rails; every front row passes', () => {
    for (const id of ['king-bearing', 'kingpin', 'front-beam', 'front-stub', 'steer-stops', 'king-beam', 'steer-clear', 'bridle-eye']) {
      expect(row(id).status, id).toBe('pass');
      expect(row(id).statusCargo ?? 'pass', id).not.toBe('fail');
    }
    expect(row('king-bearing').util!).toBeLessThan(0.9);
    expect(row('steer-stops').util!).toBeLessThan(0.6);
    expect(defaults.rollPadRadiusIn).toBe(9.75); // D-83: 1/4 in further out for the 2 in clamp plates (was 9.5)
    expect(defaults.steerChainBeamYIn).toBe(8);
  });
  it('rear and brake: the rear clamp plate (11-1/4 to 13-1/4 in, 2 in wide since D-83) runs under the outer part of the rail, whose relief notch is cut over it; the brake rows pass, brake-clear still 0.22 in', () => {
    const rail = buildModel(defaults).find((x) => x.id === 'rail-L')!;
    const plate = worldAABB(buildModel(defaults).find((x) => x.id === 'clamp-RL1')!);
    expect(plate.min[1]).toBeCloseTo(11.5, 6); // D-88: the outboard edge 1/4 in in from the beam end, clear of the hanger (11-1/4 to 13-1/4 before); D-83: 2 in wide
    expect(plate.max[1]).toBeCloseTo(13.5, 6);
    expect(rail).toBeDefined();
    for (const id of ['brake-slow', 'brake-ratio', 'brake-clear', 'brake-flap', 'brake-pivot', 'brake-mount', 'brake-return', 'brake-abuse', 'bearing-groove', 'rear-beam-seat']) expect(row(id).status, id).toBe('pass');
    expect(row('axle-stress').status).toBe('pass'); // D-71 solid rod: 0.79 at the 200 lb goal rider (0.925, marginal, on the 5/8 in tube); 150 lb is a pass
    expect(row('brake-clear').value).toBeCloseTo(0.22, 1);
  });
});
