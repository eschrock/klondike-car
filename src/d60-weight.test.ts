/**
 * The weight package (D-60, docs/weight-study-3c.md, notes in docs/phase3c-6-weight-notes.md) pinned end to end: the param values and their status/refs, the foot block and its
 * cleats gone (old links still load), the mass by group and the saving against the pre-package numbers (PRE_D60), the part-by-part savings, and the headline analysis results
 * (every row passes at 150 lb, 200 lb and cargo; the safe and green rider ranges; cargo and resting capacity; the rows above 0.9).
 */
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, validateParams, type ParamKey, type Params } from './params';
import { decodeHash, encodeHash } from './state';
import { buildModel } from './model';
import { worldAABB } from './model/bounds';
import { totalMass } from './model/mass';
import { makeContext } from './analysis/context';
import { runChecks } from './analysis';
import { cargoCapacity } from './analysis/cargo-capacity';
import { restMaxLb } from './analysis/rest';
import { riderSweep } from './analysis/rider-sweep';
import { checkTruckFit } from './truck/fit';
import { PRE_D60, PRE_D66, PRE_D71, PRE_D72 } from './test-fixtures';

// D-66 moved the tracks, the bow and the load-height rule on; the D-60 package headline numbers (mass, width, rider range, cargo) are recorded for the D-65 design, restored with PRE_D66
// D-71 (Harbor Freight wheels, 5/8 in axles) changed the wheel, axle and clamp numbers again: this file records the D-60 3/4 in design, restored with PRE_D71
// D-72/D-73: and the 0.120 in DOM tube and the 4 mm okoume sides, box and lid (PRE_D72)
const defaults = { ...defaultParams(), ...PRE_D72, ...PRE_D71, ...PRE_D66 } as Params;
const pre = { ...defaults, ...PRE_D60 } as Params;
const parts = buildModel(defaults);
const partsPre = buildModel(pre);
const cs = runChecks(defaults, { includeTruck: false });
const byId = (id: string) => parts.find((x) => x.id === id)!;
const massOf = (ps: typeof parts, re: RegExp) => ps.filter((x) => re.test(x.id)).reduce((m, x) => m + x.massLb, 0);
const groupMass = (ps: typeof parts) => {
  const g: Record<string, number> = {};
  for (const x of ps) if (!x.payload && x.group !== 'reference') g[x.group] = (g[x.group] ?? 0) + x.massLb;
  return g;
};

describe('the changed params (every one cites D-60; the supplier-derived ones are "verify" with their source in the note)', () => {
  const VALUES: Partial<Record<ParamKey, number>> = {
    // Package A
    steerEyeBoltDiaIn: 0.375, steerEyeWllLb: 900, steerChainDiaIn: 0.1875, steerChainWllLb: 1000, chainJoistThickIn: 1.25,
    tongueWidthIn: 1.25, tongueDepthIn: 1.75, bowBulkheadThickIn: 1.5, crossmemberThickIn: 0.625, handleSocketDepthIn: 14,
    clampPlateThickIn: 0.25, axleBeamThicknessIn: 2.25, brakeFlapThickIn: 0.875, brakeFlapWidthIn: 3, brakeBackerThickIn: 0.75,
    storageLidRimWidthIn: 0.75, beamHoldDownThickIn: 0.125, brakeKneeLegIn: 1.75, seatBackFrameWidthIn: 1.25, grabBoardThickIn: 0.625, axleWallIn: 0.12,
    // the first four trade-offs
    wheelMass10Lb: 2.8, wheelRatingLb: 300, hubLengthIn: 2.28, wheelBoreIn: 0.75, panelPlyIn: 0.157, seatBackPlyIn: 0.472, // D-62 (Eric 2026-10-12): the seat back is a frameless 12 mm panel, was 6 mm in a frame
    transomThicknessIn: 0.5,
    handlePostThickIn: 0.6875, handlePostWidthIn: 1.1875,
    // the follow-ons
    riderLegReachIn: 35.75, rollPadRadiusIn: 9.5, // D-66: the pads moved in to 9-1/2 in (was D-60's 11-1/2) under the narrower bow rails
  };
  it.each(Object.entries(VALUES) as [ParamKey, number][])('%s = %s', (k, v) => {
    if (k !== 'rollPadRadiusIn') expect(defaults[k]).toBe(v);
    expect(PARAM_DEFS[k].default).toBe(({ wheelMass10Lb: 3, hubLengthIn: 2.25, wheelBoreIn: 0.625, axleWallIn: 0 } as Partial<Record<ParamKey, number>>)[k] ?? v); // D-71 moved these three on (the Harbor Freight wheel) and the axle to the solid rod
  });
  it.each(Object.keys(VALUES) as ParamKey[])('%s cites D-60 in its ref or note', (k) => {
    expect(`${PARAM_DEFS[k].ref ?? ''} ${PARAM_DEFS[k].note ?? ''}`, k).toMatch(/D-60/);
  });
  it('supplier / listing numbers are status "verify": the wheel (mass, rating, hub, bore), the eye bolt and chain working loads, the tube strengths', () => {
    for (const k of ['wheelMass10Lb', 'wheelRatingLb', 'hubLengthIn', 'wheelBoreIn', 'steerEyeWllLb', 'steerChainWllLb', 'axleTubeYieldPsi', 'axleTubeUltimatePsi'] as ParamKey[])
      expect(PARAM_DEFS[k].status, k).toBe('verify');
    expect(PARAM_DEFS.wheelMass10Lb.note).toMatch(/Tractor Supply/);
    expect(PARAM_DEFS.wheelRatingLb.note).toMatch(/listing/i);
    expect(PARAM_DEFS.hubLengthIn.note).toMatch(/MEASURE|CONFIRM/); // D-71: "measure the Harbor Freight hub"
    expect(PARAM_DEFS.wheelBoreIn.note).toMatch(/VERIFY|CONFIRM/);
    expect(PARAM_DEFS.steerEyeWllLb.note).toMatch(/vendor listing/);
    expect(PARAM_DEFS.steerChainWllLb.note).toMatch(/vendor listing/);
  });
  it('the items the owner chose, and the ones this package leaves alone, are untouched: 14 in rear sides, 24 in body, 12 mm deck, 3/4 in axle, rails, signs on, 8.5 in joist spacing, 5/8 in chine and gunwale', () => {
    expect(defaults).toMatchObject({
      sideHeightRearIn: 14, bodyWidthIn: 24, deckPlyIn: 0.472, axleDiameterIn: 0.75, railDepthIn: 3, railThicknessIn: 0.75, showSideSigns: 1, crossmemberSpacingIn: 8.5,
      sideThicknessIn: 0.625, railBandIn: 1.5, kingBeamLengthIn: 3, seatCushionIn: 2, seatBackHeightIn: 16, lashDoublerThickIn: 1,
    });
  });
});

describe('the foot block and its slot cleats are gone (D-60; Eric, D-57 item 3)', () => {
  it('no foot-block, foot-slot or foot-stop part exists, at the defaults or with any old setting', () => {
    expect(parts.some((x) => /^foot-/.test(x.id))).toBe(false);
    expect(buildModel(defaults, { removed: true }).some((x) => /^foot-/.test(x.id))).toBe(false);
    expect(buildModel({ ...defaults, seatXIn: 8 } as Params).some((x) => /^foot-/.test(x.id))).toBe(false);
  });
  it('the four params are not params any more, and an old link that carries them still loads: unknown keys are ignored, everything else is kept', () => {
    for (const k of ['footBlockSlot', 'footBlockStepIn', 'footBlockThickIn', 'footBlockPositions']) expect(Object.keys(PARAM_DEFS)).not.toContain(k);
    const old = decodeHash('#footBlockSlot=2&footBlockThickIn=1.5&footBlockStepIn=4&footBlockPositions=2&wheelbaseIn=46&hubLengthIn=3');
    expect(old).toEqual({ ...defaultParams(), wheelbaseIn: 46, hubLengthIn: 3 });
    expect(encodeHash(old)).toBe('wheelbaseIn=46&hubLengthIn=3');
    expect(() => buildModel(old)).not.toThrow();
    expect(Object.keys(old)).not.toContain('footBlockSlot');
  });
  it('the foot-stop row uses the bow bulkhead alone: no slot-wall rows, the same 1-1/2 in plank, still a pass', () => {
    const fs = cs.find((c) => c.id === 'foot-stop')!;
    expect(fs.status).toBe('pass');
    expect(fs.details!.some((d) => /slot|foot block/i.test(d.name))).toBe(false);
    expect(fs.how).toMatch(/bow bulkhead/);
    expect(fs.how).not.toMatch(/foot block/);
    expect(fs.util!).toBeLessThan(0.3); // the study: 0.14 at 1-1/2 in; the rows' hard-hit case is the governing detail
  });
  it('the rider\'s heel lands on the bulkhead face (the leg reach went up 1/4 in with the thinner bulkhead)', () => {
    const face = byId('bow-bulkhead');
    expect(defaults.seatXIn + defaults.riderLegReachIn).toBeCloseTo(worldAABB(face).min[0], 9);
  });
});

describe('mass (target about 120 lb; 144.4 at 3c-5, 143.0 with the cleats gone)', () => {
  it('the empty sled is 119.9 lb: the D-60 package gave 120.6 (the study predicted 120.7), 14 in sockets +0.46 = 121.1, the D-62 build fixes +0.1, D-64 the tail light clip -0.15, D-65 the pull-pin brake (shorter flaps, no hinges) -0.97; the package still saves about 20 lb against the PRE_D60 numbers rebuilt with the D-62 sandwich sides, bridle and clamps', () => {
    expect(totalMass(parts)).toBeGreaterThan(117.8); // D-74: 118.3 lb (the 2-1/8 in laminated beams, knees and chocks: -1.3 lb); was above 119.4
    expect(totalMass(parts)).toBeLessThan(119.1);
    expect(totalMass(partsPre)).toBeCloseTo(137.8, 0); // D-74: 137.8 (the baseline takes the 2-1/8 in laminated parts too: -1.8 lb); 139.6 before D-74; 141.2 before D-65 (the pull-pin brake is lighter in this baseline too); the study's B0 was 143.0; the D-62 changes (sandwich sides, no shackle, frameless seat back, ...) are in this baseline too
    expect(totalMass(partsPre) - totalMass(parts)).toBeGreaterThan(19.5);
    expect(totalMass(partsPre) - totalMass(parts)).toBeLessThan(21);
  });
  it('by group (lb): body 36.5 (D-65: the signs, 0.6 lb, are in the body now, not a removable part), running gear 18.8, front end 16.0, frame 13.5, brake 10.3 (D-65: 11.1 before the pull-pin brake), seat 8.5, storage 7.0, hardware 5.9 (epoxy joints of the sandwich), removable 1.9 (the handle), lighting 1.9', () => {
    const g = groupMass(parts);
    const want: Record<string, number> = { body: 36.5, 'running-gear': 18.8, 'front-end': 16.0, frame: 13.5, brake: 9.31, /* D-74: 2-1/8 in knees and chocks */ seat: 8.4, storage: 7.0, hardware: 5.8, removable: 1.9, lighting: 1.9 };
    for (const [k, v] of Object.entries(want)) expect(Math.abs(g[k] - v), `${k} ${g[k]?.toFixed(2)}`).toBeLessThan(0.6);
    const gp = groupMass(partsPre);
    // the same sled before the package (PRE_D60, rebuilt with the D-62 sandwich sides, bridle and clamps): running gear 26.1, front end 18.7, body 40.1
    expect(gp['running-gear']).toBeCloseTo(26.1, 0);
    expect(gp['front-end']).toBeCloseTo(18.7, 0);
    expect(gp.body).toBeCloseTo(40.8, 0); // 40.1 before D-65 moved the signs into the body group
  });
  it('the biggest single savings are where the study said: the hollow axles (3.5 lb), the wheels (4.8 lb), the 1/2 in transom (2.6 lb), the 4 mm side webs, box and lid', () => {
    const saved = (re: RegExp) => massOf(partsPre, re) - massOf(parts, re);
    expect(saved(/^axle-(R|FL|FR)$/)).toBeGreaterThan(3.3);
    expect(saved(/^axle-(R|FL|FR)$/)).toBeLessThan(3.7);
    expect(saved(/^wheel-/)).toBeCloseTo(4 * (4 - 2.8), 9);
    expect(saved(/^transom-rear$/)).toBeGreaterThan(2.4);
    expect(saved(/^transom-rear$/)).toBeLessThan(2.8);
    expect(saved(/^bow-bulkhead$/)).toBeGreaterThan(0.8);
    expect(saved(/^side-[LR]-web$/)).toBeGreaterThan(0.9);
    expect(saved(/^(storage-(side|end|lid)|storage-lid$)/)).toBeGreaterThan(0.6);
    expect(saved(/^brake-flap-/)).toBeGreaterThan(0.6); // D-65: the shortened Shaper-cut fender is 0.3 lb lighter again than the D-60 flap (0.7 against 0.9 saved)
    expect(saved(/^handle-(socket|post)-/)).toBeGreaterThan(1.0); // 14 in sockets (Eric, 2026-10-12) give back about 0.2 lb of the 16 -> 12 in saving
    expect(saved(/^steer-(chain|eye|anchor)-/)).toBeGreaterThan(1.5);
    expect(saved(/^joist-/)).toBeGreaterThan(0.7);
  });
  it('4 mm okoume for the sides, box and lid (and the sign blanks) and a frameless 12 mm seat back (D-62): the sandwich bands and the edge banding follow', () => {
    expect(worldAABB(byId('sign-L')).max[1] - worldAABB(byId('sign-L')).min[1]).toBeCloseTo(0.157, 3);
    const lid = worldAABB(byId('storage-lid'));
    expect(lid.max[2] - lid.min[2]).toBeCloseTo(0.157, 3);
    const end = worldAABB(byId('storage-end-fore'));
    expect(end.max[0] - end.min[0]).toBeCloseTo(0.157, 3);
    const panel = byId('seat-back-panel');
    expect(panel.geometry).toMatchObject({ type: 'extrusion' }); // D-62: the frameless 12 mm panel (was 6 mm in a frame)
    expect(panel.stock!.t).toBeCloseTo(0.472, 3);
    expect(byId('side-L-chine').joints!.find((j) => j.to === 'side-L-web')!.size).toMatch(/0\.234" oak strip/); // the sandwich bands, no groove
    expect(byId('side-L-web').notes).toMatch(/^4 mm okoume panel/);
    expect(byId('storage-hinge-backer-L').notes).toMatch(/4 mm ply/);
  });
  it('a 1/2 in transom, 5/8 in joists, 1-1/2 in bulkhead and the smaller handle posts are the sizes in the parts', () => {
    const t = worldAABB(byId('transom-rear'));
    expect(t.max[0] - t.min[0]).toBeCloseTo(0.5, 9);
    const b = worldAABB(byId('bow-bulkhead'));
    expect(b.max[0] - b.min[0]).toBeCloseTo(1.5, 9);
    const j = worldAABB(byId('joist-3'));
    expect(j.max[0] - j.min[0]).toBeCloseTo(0.625, 9);
    const post = worldAABB(byId('handle-post-L'));
    expect(post.max[0] - post.min[0]).toBeCloseTo(0.6875, 9);
    expect(post.max[1] - post.min[1]).toBeGreaterThan(1.1); // 1-3/16 across (the top is cut to the bow slope: the box is a little deeper)
    const sock = worldAABB(byId('handle-socket-L'));
    expect(sock.max[0] - sock.min[0]).toBeCloseTo(1, 9); // the standard 1 x 1-1/2 x 1/8 in 6061 tube
    expect(sock.max[1] - sock.min[1]).toBeCloseTo(1.5, 9);
    expect(sock.max[2] - sock.min[2]).toBeCloseTo(14, 9); // 14 in sockets (Eric, 2026-10-12)
  });
  it('the wheels: 2.8 lb, a 2.28 in hub on the geometry, bore = the 3/4 in axle; the overall width falls with the hub (38.8 in, was 39.5)', () => {
    const w = byId('wheel-FL');
    expect(w.massLb).toBe(2.8);
    expect(w.geometry).toMatchObject({ type: 'wheel', hubLength: 2.28, bore: 0.75 });
    expect(w.sourcing?.vendor).toMatch(/0\.75" bore/);
    expect(w.sourcing?.vendor).toMatch(/VERIFY the hub length, bore and rating/); // D-71 (was "READ THE LOAD RATING OFF THE LISTING")
    const fit = checkTruckFit(defaults, (v) => buildModel(defaults, v));
    expect(fit.dims.installed.widthIn).toBeCloseTo(38.78, 1);
  });
});

describe('the analysis after the package (the study predicted: safe 50-250+, green 50-230, cargo about 236 (B), resting about 348, nothing failing)', () => {
  it('no row fails at 150 lb, 200 lb or the 200 lb cargo; only turn-radius is marginal (unchanged since 3c-3)', () => {
    for (const c of cs) {
      expect(c.statusOperating, c.id).not.toBe('fail');
      expect(c.statusGoal, c.id).not.toBe('fail');
      expect(c.statusCargo ?? 'pass', c.id).not.toBe('fail');
    }
    expect(cs.filter((c) => c.statusOperating === 'marginal' || c.statusGoal === 'marginal').map((c) => c.id)).toEqual(['turn-radius']);
  });
  it('rows above 0.9: the fit facts (park-hold, lash-points count, seat-stow 0.94) and turn-radius 0.98; nothing else (D-67: tip-straight, 0.95 on the cargo case at the 40 deg limit, is down to 0.84 at 35 deg)', () => {
    const above = cs.filter((c) => Math.max(c.util ?? 0, c.utilCargo ?? 0) > 0.9 && c.status !== 'info').map((c) => c.id).sort();
    expect(above).toEqual(['lash-points', 'park-hold', 'seat-stow', 'turn-radius']); // D-62: front-beam cargo fell from 0.94 to 0.88 with the wider outer front clamp plate
    const u = (id: string) => cs.find((c) => c.id === id)!;
    expect(u('front-beam').utilCargo!).toBeLessThan(0.9);
    expect(u('tip-straight').util!).toBeLessThan(0.9);
    expect(u('tip-straight').utilCargo!).toBeCloseTo(35 / 41.88, 2); // D-67: limit 35 / cargo tip 41.9 deg = 0.84 (0.95 at the 40 deg limit)
    expect(u('seat-stow').util!).toBeLessThan(0.97);
    expect(u('turn-radius').util!).toBeCloseTo(0.98, 2);
  });
  it('the rows the package leans on stay where the study put them: lift 0.67 (1/2 in transom), handle-sockets 0.50 (14 in sockets), bridle-eye 0.63, joists 0.65, rest-load 0.72, wheel-rating 0.56, foot-stop low', () => {
    const u = (id: string) => cs.find((c) => c.id === id)!.util!;
    expect(u('lift')).toBeCloseTo(0.67, 1);
    expect(u('handle-sockets')).toBeLessThan(0.75); // 14 in sockets: 3.7 in of post engaged (0.78 at 12 in); D-62 adds the pin end-distance and the notched post: 0.69
    expect(u('bridle-eye')).toBeCloseTo(0.63, 1);
    expect(u('joists')).toBeCloseTo(0.65, 1);
    expect(u('rest-load')).toBeCloseTo(0.72, 1);
    expect(u('wheel-rating')).toBeCloseTo(0.56, 1);
    expect(u('steer-stops')).toBeLessThan(0.8); // 3/8 in eye bolts and 3/16 in chain: the study 0.54
    expect(u('seat-back')).toBeLessThan(0.8); // the frameless 12 mm panel on the crest strip: 0.78, the latch pin tear-out in ply governs (D-62; 0.59 for the framed 6 mm back)
    expect(u('lid-load')).toBeLessThan(0.8); // the 4 mm lid (the study 0.71)
    expect(u('brake-flap')).toBeLessThan(0.8);
    expect(u('brake-return')).toBeLessThan(0.7);
    expect(u('beam-rear')).toBeLessThan(0.3);
    expect(u('axle-stress')).toBeLessThan(0.7);
  });
  it('the wheel-rating row compares with the 300 lb listing rating (the heavier wheel is 215 lb at rest, the peak is allowed 2x)', () => {
    const w = cs.find((c) => c.id === 'wheel-rating')!;
    expect(w.status).toBe('pass');
    expect(w.how).toMatch(/300 lb/);
  });
  it('rider range: safe 50 to over 250 lb, green 50 to 230 lb (the study: 50-250+ / 50-230)', () => {
    const fit = checkTruckFit(defaults, (v) => buildModel(defaults, v));
    const r = riderSweep(defaults, { fit });
    expect(r.safe).toEqual({ loLb: 50, hiLb: 250, openLow: true, openHigh: true });
    // D-63 (3c-8): 240 lb is a knife edge (bearing-groove 0.8995 against the 0.9 yellow line, after the lighter hinge/pin pads), so green is 50-230 or 50-240; 230 was the 3c-7 value.
    expect(r.green).toMatchObject({ loLb: 50, openLow: true, openHigh: false });
    expect(r.green!.hiLb).toBeGreaterThanOrEqual(230);
    expect(r.green!.hiLb).toBeLessThanOrEqual(240);
  });
  it('cargo capacity is at least 225 lb against the 200 lb target (207 before, the study 212 for A and 236 for B); resting capacity about 348 lb against 250 (the study 348-350)', () => {
    expect(cargoCapacity(defaults).capacityLb!).toBeGreaterThanOrEqual(225);
    expect(cargoCapacity(defaults).capacityLb!).toBeLessThan(280); // 269 with the wider outer front clamp plate (233 before D-62, front-beam limited it)
    expect(cargoCapacity(defaults).limiter?.id).toBe('front-beam');
    const p = { ...defaults } as Params;
    const ctx = makeContext(p, buildModel(p, { rider: 'goal', cargo: true }));
    expect(restMaxLb(ctx)).toBeGreaterThan(340);
    expect(restMaxLb(ctx)).toBeLessThan(356);
  });
  it('validateParams has nothing to say about the defaults except the two info notes (rails reach the rear beam, flap narrower than the tire): no warning from the wheel bore, the tube, the cross hole or the roll pads', () => {
    expect(validateParams(defaults).filter((i) => i.severity !== 'info')).toEqual([]);
    expect(validateParams(defaults).filter((i) => i.severity === 'info').map((i) => i.keys[0])).toEqual(['railDepthIn', 'brakeFlapWidthIn']);
  });
});
