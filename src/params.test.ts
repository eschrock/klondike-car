import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, bowBulkhead, bowTaper, bowTurnInAt, smootherstep, defaultParams, resolveParams, sanitizeParam, sanitizeParams, steerGeometry, validateParams, type ParamKey, type Params } from './params';
import { createStore, decodeHash, encodeHash } from './state';
import { buildModel } from './model';
import { computeLayout } from './model/layout';
import { centerOfGravity, totalMass } from './model/mass';
import { runChecks } from './analysis';

const keys = Object.keys(PARAM_DEFS) as ParamKey[];
const defaults = defaultParams();
const errorsOf = (p: Params) => validateParams(p).filter((i) => i.severity === 'error');
const withKey = (p: Params, k: ParamKey) => validateParams(p).filter((i) => i.keys.includes(k));

describe('PARAM_DEFS', () => {
  it.each(keys)('%s has min <= default <= max', (k) => {
    const d = PARAM_DEFS[k];
    expect(d.min).toBeLessThanOrEqual(d.default);
    expect(d.default).toBeLessThanOrEqual(d.max);
  });

  it.each(keys.filter((k) => PARAM_DEFS[k].options))('%s options contain the default', (k) => {
    expect(PARAM_DEFS[k].options!.map((o) => o.value)).toContain(PARAM_DEFS[k].default);
  });

  it('the removed front-end, caster, hull-curve and option params are gone; the new curl, profile and pivoting-axle (D-56) params are in', () => {
    const gone = ['noseWidthIn', 'hullCurveStartIn', 'tongueLengthIn', 'frameStyle', 'sideConstruction', 'bumpSpeedMph', 'kingpinLeadIn', 'sideHeightIn', 'sheerRiseIn', 'autoNoseGeometry', 'gunwaleFlareIn',
      'casterWheelDiaIn', 'casterWheelWidthIn', 'casterOverallHeightIn', 'casterSwivelRadiusIn', 'casterRatingLb', 'casterSpacingIn', 'casterBlockLengthIn', 'casterBlockWidthIn', 'casterSweepClearIn',
      'casterPlateLengthIn', 'casterMassLb', 'bowBlockThickIn', 'bowBlockWidthIn', 'bowBlockBoltDiaIn', 'bridleEyeHeightIn', 'eyeBoltWasherDiameterIn', 'eyeBoltEyeOffsetIn',
      // D-57: the bow curl, the straight-line sag, the foot-stop board, the star-knob seat back and the pad-and-posts grab handle
      'sideProfileSagIn', 'bowCurlRadiusIn', 'bowCurlAngleDeg', 'bowCurlPlyIn', 'bowCurlPlies', 'footStopThickIn', 'seatBackKnobHeightIn', 'seatInsertAllowLbf', 'seatGripGapIn', 'seatGripClearLengthIn',
      // D-60: the drop-in foot block and its four slot cleats (old links that carry these keys still load: decodeHash ignores unknown keys)
      'footBlockThickIn', 'footBlockStepIn', 'footBlockPositions', 'footBlockSlot',
      // D-66: the fixed 1-1/4 in turn-in over 14 in is replaced by the derived taper (start x and bow width)
      'bowTurnInIn', 'bowTurnLenIn'];
    for (const k of gone) expect(keys, k).not.toContain(k);
    expect(keys.filter((k) => /^caster|^bowBlock|^swivel/.test(k))).toEqual([]);
    const added = ['sideHeightBowIn', 'sideHeightRearIn', 'sheerCurveIn', 'bowWidthIn', 'bowTaperStartIn', 'bowTaperSlackIn', 'bowBulkheadThickIn',
      'grabBoardLengthIn', 'grabHoleLengthIn', 'grabHoleHeightIn', 'grabBoardThickIn', 'grabBoardBarIn', 'grabBoardFootIn', 'handleParkClearIn', 'flagTubeIdIn', 'flagTubeOdIn', 'seatHingeLoadLbf', 'seatBackLatchHeightIn', 'showSideSigns',
      'axleHangerThickIn', 'axleHangerWidthIn', 'bumpSpeedNormalMph', 'bumpSpeedHardMph',
      // D-60: the hollow axle, the wheel bore, the seat-back ply
      'axleWallIn', 'axleTubeYieldPsi', 'axleTubeUltimatePsi', 'axleCrossHoleDiaIn', 'axleCrossHoleFromEndIn', 'wheelBoreIn', 'seatBackPlyIn',
      'frontTrackIn', 'steerLockDeg', 'steerClearIn', 'kingpinDiaIn', 'kingThrustOdIn', 'kingThrustThickIn', 'kingBeamLengthIn', 'steerBearingAllowPsi', 'tongueWidthIn', 'tongueDepthIn',
      'tongueHeadWidthIn', 'tongueHeadLenIn', 'tongueTieAheadIn', 'tongueBoltDiaIn', 'tongueBoltOffsetIn', 'tongueTipEdgeIn', 'tongueHoleDiaIn', 'tongueTopDropIn', 'frontStubLenIn', 'steerRopesOn', 'steerRopeRunIn',
      // D-58 (3c-4a): roll pads, steering check chains, the chain joist and the front beam width
      'rollPadRadiusIn', 'rollPadLenIn', 'rollPadWidthIn', 'rollPadThickIn', 'rollPadGapMinIn', 'steerChainDiaIn', 'steerChainWllLb', 'steerEyeBoltDiaIn', 'steerEyeWllLb', 'steerChainBeamYIn', 'steerChainAnchorYIn', 'chainJoistThickIn', 'frontBeamThicknessIn'];
    for (const k of ['tongueThickIn', 'steerStopBoltDiaIn', 'endJoistThickIn', 'steerStopPadThickIn']) expect(keys, k).not.toContain(k);
    for (const k of added) expect(keys, k).toContain(k);
  });
  it('the design defaults (D-54, D-56, D-57): 24 in body, 44 in wheelbase, 10 in wheels, 8 in deck, a sheer from 4 in at the bow to 14 in at the rear, the 1-1/2 in bow bulkhead (D-60), pivoting front axle at matched 30 in front and rear tracks (D-66) and 20 deg lock', () => {
    expect(defaults).toMatchObject({
      bodyWidthIn: 24, wheelbaseIn: 44, wheelDiameterIn: 10, deckHeightIn: 8, sideHeightBowIn: 4, sideHeightRearIn: 14, sheerCurveIn: 2.5, bowWidthIn: 18.5, bowTaperStartIn: 20, bowTaperSlackIn: 0.125,
      bowBulkheadThickIn: 1.5, bowHoldMinClearIn: 2.5, crossmemberSpacingIn: 8.5, standDeflectionRatio: 240, showSideSigns: 1, rearOverhangIn: 10, frontOverhangIn: 6.75, handleBowCrownIn: 0.875, seatXIn: 13.5, riderLegReachIn: 35.75, // D-60: 1/4 in more, the thinner bulkhead's face is 1/4 in further forward
       seatDepthIn: 14.5, storageVolumeIn3: 2000,
      frontTrackIn: 30, rearTrackIn: 30, steerLockDeg: 20, // D-66: matched 30 in tracks
      steerClearIn: 0.75, kingpinDiaIn: 0.625, kingThrustOdIn: 3, kingThrustThickIn: 0.5, kingBeamLengthIn: 3,
      tongueWidthIn: 1.25, tongueDepthIn: 1.75, tongueTieAheadIn: 5, steerRopesOn: 0, frontBeamThicknessIn: 2.5, rollPadRadiusIn: 9.75, // D-66 (was 11.5, D-60), D-83 (was 9.5): tongue 1-1/4 x 1-3/4, pads out 1/4 in for the 2 in clamp plates
      transomThicknessIn: 0.5, panelPlyIn: 0.236, seatBackPlyIn: 0.512, wheelMass10Lb: 3, wheelRatingLb: 300, hubLengthIn: 2.25, wheelBoreIn: 0.625, axleDiameterIn: 0.625, axleWallIn: 0, // D-71: the Harbor Freight wheel (3 lb, 5/8 in bore, 2.25 in hub assumed) on 5/8 in axles; Eric chose the SOLID rod (axleWallIn 0)
      weatherSpec: 0, thinSheetMaterial: 1, deckPlyIn: 0.512, // (2026-10-24: D-96/97/98) seatBackPlyIn 0.512 (was 0.472); the sheets as bought, 5 mm combi-core white oak (it followed the weather: 6 mm Baltic birch) and the 13 mm deck (was 0.472); D-73, D-80: panelPlyIn is the okoume option's thickness, now 6 mm (was 4 mm)
      crossmemberThickIn: 0.625, handleSocketDepthIn: 14,
    });
    expect(PARAM_DEFS.steerLockDeg.ref).toContain('D-56');
  });
  it('every front-end (D-56) param carries a status and a D-56 reference', () => {
    for (const k of ['frontTrackIn', 'steerLockDeg', 'steerClearIn', 'kingpinDiaIn', 'kingThrustOdIn', 'kingThrustThickIn', 'kingBeamLengthIn', 'steerBearingAllowPsi', 'tongueWidthIn', 'tongueHeadWidthIn', 'tongueTieAheadIn', 'tongueBoltDiaIn', 'frontStubLenIn', 'steerRopesOn', 'steerRopeRunIn', 'rollPadRadiusIn', 'steerChainDiaIn', 'steerEyeBoltDiaIn', 'chainJoistThickIn'] as ParamKey[]) {
      expect(PARAM_DEFS[k].status, k).toBeDefined();
      expect(PARAM_DEFS[k].ref ?? '', k).toMatch(/D-5[68]/);
    }
  });
});

describe('validateParams', () => {
  it('defaults are free of errors and warnings (the one info message is the note that the rails reach the rear beam)', () => {
    const issues = validateParams(defaults);
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
    // the second info is the 3 in brake flap (D-60) against the 3-1/2 in tire section: it presses the flat of the tread, which is narrower than the tire
    expect(issues.filter((i) => i.severity === 'info').map((i) => i.keys[0])).toEqual(['railDepthIn', 'brakeFlapWidthIn']);
  });
  it('warns on crossed rider masses (the Simple view sweeps every weight)', () => {
    const issues = validateParams({ ...defaults, riderGoalMassLb: 150, riderMassLb: 200 });
    expect(issues.filter((i) => i.severity === 'warn').map((i) => i.keys[0])).toContain('riderGoalMassLb');
  });
  it('warns when the sled is too wide for the wheel wells', () => {
    const issues = validateParams({ ...defaults, rearTrackIn: 40 });
    expect(issues.some((i) => i.message.startsWith('Overall width'))).toBe(true);
  });
  it('flags a deck too low for the rear axle beam (the pivot-stack rule fires with it: the king beam needs a much higher deck, so both are reported)', () => {
    const p = { ...defaults, deckHeightIn: 5.5 };
    expect(validateParams(p).some((i) => i.severity === 'error' && i.message.startsWith('Rear axle beam + ply needs the deck'))).toBe(true);
    expect(validateParams(p).some((i) => i.severity === 'error' && /king beam/.test(i.message))).toBe(true);
  });
  it('front pivot stack (D-56): a king beam under 1 in deep (a very low deck) is an error; the 8 in default leaves about 1.7 in (the 1/2 in disc, D-62)', () => {
    const sg = steerGeometry(defaults);
    expect(sg.kingDepth).toBeGreaterThan(1.55);
    expect(sg.kingDepth).toBeLessThan(1.75); // 1.70 with the catalog 1/2 in disc and the 0.05 in lower beam top (D-62); 1.59 with the 9/16 in disc
    expect(errorsOf(defaults)).toEqual([]);
    const low = errorsOf({ ...defaults, deckHeightIn: 6 });
    expect(low.some((i) => i.keys.includes('deckHeightIn') && /king beam/.test(i.message))).toBe(true);
    expect(low.some((i) => /raise the deck to at least/.test(i.message))).toBe(true);
    // the smallest deck the rule accepts leaves a king beam of at least 1 in
    let ok = NaN;
    for (let h = 6; h <= 10; h += 0.25) if (!errorsOf({ ...defaults, deckHeightIn: h }).some((i) => /king beam/.test(i.message))) { ok = h; break; }
    expect(ok).toBeLessThanOrEqual(defaults.deckHeightIn);
    expect(steerGeometry({ ...defaults, deckHeightIn: ok }).kingDepth).toBeGreaterThanOrEqual(1 - 1e-9);
  });
  it('steer clearance at full lock (D-56, D-66): the bow taper is DERIVED from the wheel sweep, so the default clears by steerClearIn + bowTaperSlackIn; a bigger lock shortens the taper; one it cannot fit is an error that names the bow width and the track', () => {
    const sg = steerGeometry(defaults);
    expect(sg.clearAtLock).toBeGreaterThanOrEqual(defaults.steerClearIn + defaults.bowTaperSlackIn - 1e-6);
    expect(sg.clearAtLock).toBeLessThan(defaults.steerClearIn + defaults.bowTaperSlackIn + 0.1); // the taper ends as far forward as the sweep allows (rounded down to 1/4 in)
    const t = bowTaper(defaults);
    expect(t.clears).toBe(true);
    const t30 = bowTaper({ ...defaults, steerLockDeg: 30 });
    expect(t30.x1).toBeLessThan(t.x1); // more lock: the body must be narrow sooner
    const e = errorsOf({ ...defaults, steerLockDeg: 35, bowWidthIn: 21 }).find((i) => i.keys.includes('bowWidthIn') && i.keys.includes('steerLockDeg'));
    expect(e, 'a steer-clearance error').toBeDefined();
    expect(e!.message).toMatch(/cannot keep the front tires/);
    // a wider front track (more room beside the body) lets the taper end later; a narrower one earlier
    expect(bowTaper({ ...defaults, frontTrackIn: 31 }).x1).toBeGreaterThan(t.x1);
    expect(bowTaper({ ...defaults, frontTrackIn: 29.5 }).x1).toBeLessThan(t.x1);
    // the minimum track for THIS body shape is a little under the default (the taper has 1/8 in of slack), and a track under it is a clearance error when the shape is held
    expect(sg.minTrack).toBeLessThan(defaults.frontTrackIn);
    expect(sg.minTrack).toBeGreaterThan(defaults.frontTrackIn - 1);
    // a track so narrow the tires touch the body at rest is its own error
    expect(errorsOf({ ...defaults, frontTrackIn: 26 }).some((i) => i.keys.includes('frontTrackIn'))).toBe(true);
  });
  it('steering check chains (D-58): the anchor eye pulls in on a narrow body so its 2 in washer clears the rail; the beam eye must lie between the kingpin disc and the end of the beam', () => {
    const L0 = computeLayout(defaults), L1 = computeLayout({ ...defaults, bodyWidthIn: 20 });
    expect(Math.abs(L0.chain.anchor[1])).toBeCloseTo(defaults.steerChainAnchorYIn, 9);
    expect(Math.abs(L1.chain.anchor[1])).toBeLessThan(defaults.steerChainAnchorYIn);
    expect(Math.abs(L1.chain.anchor[1]) + 1.15).toBeLessThanOrEqual(L1.steer.railYIn - L1.turnIn(L1.chain.joistX) + 1e-9);
    expect(errorsOf({ ...defaults, steerChainBeamYIn: 1 }).some((i) => i.keys.includes('steerChainBeamYIn'))).toBe(true);
    expect(errorsOf({ ...defaults, steerChainBeamYIn: 13.2 }).some((i) => i.keys.includes('steerChainBeamYIn'))).toBe(true);
    expect(errorsOf({ ...defaults, steerChainBeamYIn: 8 })).toEqual([]);
  });
  it('side profile (D-57): a bow side taller than the rear side warns; a bow side the panel cannot fit (under 1 in above the two bands) errors; a bow hold with under bowHoldMinClearIn of hand room errors (D-69)', () => {
    expect(withKey({ ...defaults, sideHeightBowIn: 7, sideHeightRearIn: 6 }, 'sideHeightBowIn').some((i) => i.severity === 'warn')).toBe(true);
    expect(errorsOf({ ...defaults, sideHeightBowIn: 3 }).some((i) => i.keys.includes('railBandIn'))).toBe(true); // 3 - 2 x 1.5 < 1
    // D-69: the bow hand-hold hangs under the crown (side top 4 + crown 0.875 - 0.75 oak - 1.25 slot = 2.875 in of hand room); a lower bow side, or a bigger minimum, errors
    expect(errorsOf(defaults).some((i) => i.keys.includes('bowHoldMinClearIn'))).toBe(false);
    expect(errorsOf({ ...defaults, bowHoldMinClearIn: 3 }).some((i) => i.keys.includes('bowHoldMinClearIn'))).toBe(true);
    expect(errorsOf({ ...defaults, liftSlotHeightIn: 1.75 }).some((i) => i.keys.includes('bowHoldMinClearIn'))).toBe(true); // 4 + 0.875 - 0.75 - 1.75 = 2.375 < 2.5
    expect(errorsOf({ ...defaults, sideHeightBowIn: 5 }).filter((i) => i.keys.some((k) => /^(side|bow|lift)/.test(k)))).toEqual([]);
  });
  it('bow bulkhead and taper (D-57, D-66): the bulkhead sits one thickness behind the tip; the taper is 0 behind bowTaperStartIn, a smootherstep (curvature-continuous) to (bodyWidthIn - bowWidthIn) / 2 at its derived end, then parallel; the bend radius must meet the cold-bend limit; the feet must reach the face', () => {
    const b = bowBulkhead(defaults);
    expect(b.xTip).toBeCloseTo(50.75, 9);
    expect(b.xFlatEnd).toBeCloseTo(49.25, 9); // D-60: the bulkhead is 1-1/2 in, so its face is 1/4 in further forward
    expect(b.thick).toBe(1.5);
    const t = bowTaper(defaults);
    expect(t.x0).toBe(defaults.bowTaperStartIn);
    expect(t.turnIn).toBeCloseTo((defaults.bodyWidthIn - defaults.bowWidthIn) / 2, 9); // 2.75 in a side: 18.5 in outside at the bow
    expect(t.x1).toBeGreaterThan(t.x0 + 15); // a long taper, not the old 14 in
    expect(t.x1).toBeLessThanOrEqual(b.xFlatEnd);
    expect(bowTurnInAt(defaults, t.x0 - 5)).toBe(0);
    expect(bowTurnInAt(defaults, t.x0)).toBe(0);
    expect(bowTurnInAt(defaults, t.x1)).toBeCloseTo(t.turnIn, 12);
    expect(bowTurnInAt(defaults, b.xFlatEnd)).toBeCloseTo(t.turnIn, 12); // parallel to the bulkhead
    expect(bowTurnInAt(defaults, (t.x0 + t.x1) / 2)).toBeCloseTo(t.turnIn / 2, 12);
    // smootherstep: first AND second derivatives vanish at both ends (no kink, no curvature jump)
    const h = 1e-3, f = (x: number) => bowTurnInAt(defaults, x);
    for (const x of [t.x0 + h, t.x1 - h]) {
      expect(Math.abs((f(x + h) - f(x - h)) / (2 * h))).toBeLessThan(1e-4);
      expect(Math.abs((f(x + h) - 2 * f(x) + f(x - h)) / (h * h))).toBeLessThan(2e-3);
    }
    expect(smootherstep(0.5)).toBeCloseTo(0.5, 12);
    // the tightest bend is far over the cold-bend limit of one 0.234 in band (40 x 0.234 = 9.4 in)
    expect(t.minRadiusIn).toBeGreaterThan(25);
    expect(errorsOf({ ...defaults, bowTaperStartIn: 36 }).some((i) => /cold-bend|bends the chine/.test(i.message) || /cannot keep/.test(i.message))).toBe(true);
    expect(errorsOf({ ...defaults, bowWidthIn: 24 }).filter((i) => i.keys.some((k) => /^(bow|side)/.test(k)))).toEqual([]); // no taper
    // the rider's feet reach past the bulkhead face
    expect(errorsOf({ ...defaults, riderLegReachIn: 40 }).some((i) => i.keys.includes('riderLegReachIn'))).toBe(true);
    // the bow can pinch the nose
    expect(errorsOf({ ...defaults, bowWidthIn: 12.5 }).length).toBeGreaterThan(0);
  });
  it('axle hanger: wide enough for the beam notch and 3/4 in of oak each side; body clear of the rear tires and the U-bolt plates', () => {
    expect(errorsOf({ ...defaults, axleHangerWidthIn: 3.5 }).some((i) => i.keys.includes('axleHangerWidthIn'))).toBe(true);
    expect(errorsOf({ ...defaults, axleHangerWidthIn: 5 })).toEqual([]);
    expect(errorsOf({ ...defaults, bodyWidthIn: 34 }).some((i) => i.keys.includes('rearTrackIn'))).toBe(true);
    expect(errorsOf({ ...defaults, bodyWidthIn: 30, rearTrackIn: 33 }).some((i) => /^The rear U-bolt plates start/.test(i.message))).toBe(true);
    expect(errorsOf({ ...defaults, bodyWidthIn: 20, bowWidthIn: 12.5 }).some((i) => /only 12.5" wide at the bulkhead/.test(i.message))).toBe(true); // a 13 in nose is the least (hand-hold, foot brace, tongue)
  });
  it('the rider\'s feet and the truck: a body longer than the bed is an error', () => {
    expect(errorsOf({ ...defaults, wheelbaseIn: 64, rearOverhangIn: 18, frontOverhangIn: 20, bodyWidthIn: 24 }).some((i) => /longer than bed/.test(i.message))).toBe(true);
  });
});

describe('resolveParams (D-54: no derived-by-rule params remain)', () => {
  it('is the identity: the same object, for the defaults, a patched design and the extremes', () => {
    expect(resolveParams(defaults)).toBe(defaults);
    const patched = { ...defaults, wheelbaseIn: 50, bodyWidthIn: 26 };
    expect(resolveParams(patched)).toBe(patched);
    const lo = { ...defaults }, hi = { ...defaults };
    for (const k of keys) { lo[k] = PARAM_DEFS[k].min; hi[k] = PARAM_DEFS[k].max; }
    expect(resolveParams(lo)).toBe(lo);
    expect(resolveParams(hi)).toBe(hi);
  });
  it('validateParams, buildModel and the checks see exactly what they were given', () => {
    const p = { ...defaults, wheelbaseIn: 46 };
    expect(validateParams(p)).toEqual(validateParams(resolveParams(p)));
    expect(buildModel(p).map((x) => x.massLb)).toEqual(buildModel(resolveParams(p)).map((x) => x.massLb));
  });
});

describe('sanitizeParam', () => {
  it('clamps to min/max', () => {
    expect(sanitizeParam('wheelbaseIn', 1000)).toBe(PARAM_DEFS.wheelbaseIn.max);
    expect(sanitizeParam('wheelbaseIn', -5)).toBe(PARAM_DEFS.wheelbaseIn.min);
  });
  it('snaps option params to the nearest option', () => {
    expect(sanitizeParam('deckPlyIn', 0.4)).toBe(0.354);
  });
  it('falls back to the default for non-finite input', () => {
    expect(sanitizeParam('riderMassLb', NaN)).toBe(PARAM_DEFS.riderMassLb.default);
  });
});

describe('state hash', () => {
  it('is empty for defaults', () => {
    expect(encodeHash(defaults)).toBe('');
  });
  it('round-trips non-default values', () => {
    const s = createStore();
    s.set('wheelbaseIn', 52.5);
    s.set('wheelDiameterIn', 11);
    s.set('steerLockDeg', 25);
    const hash = encodeHash(s.get());
    expect(hash).toContain('wheelbaseIn=52.5');
    expect(hash).toContain('steerLockDeg=25');
    expect(hash).not.toContain('riderMassLb');
    expect(decodeHash('#' + hash)).toEqual(s.get());
  });
  it('sanitizes and ignores junk on decode', () => {
    const p = decodeHash('#wheelbaseIn=9999&bogus=1&riderMassLb=&x');
    expect(p.wheelbaseIn).toBe(PARAM_DEFS.wheelbaseIn.max);
    expect(p.riderMassLb).toBe(PARAM_DEFS.riderMassLb.default);
  });
  it('store notifies, persists, unsubscribes and resets', () => {
    const hashes: string[] = [];
    const s = createStore({ persist: (h) => hashes.push(h) });
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.set('wheelbaseIn', 50);
    s.set('wheelbaseIn', 50); // no-op
    expect(calls).toBe(1);
    off();
    s.set('wheelbaseIn', 51);
    expect(calls).toBe(1);
    s.reset();
    expect(s.get()).toEqual(defaults);
    expect(hashes.at(-1)).toBe('');
  });
});

describe('old shared URLs (Phase 3c-3a, D-54; the front end of D-56)', () => {
  // Removed keys: the hull / Ackermann keys of earlier phases and everything the caster pass added and the pivoting axle (D-56) removed again.
  const REMOVED = ['noseWidthIn', 'hullCurveStartIn', 'tongueLengthIn', 'frameStyle', 'sideConstruction', 'bumpSpeedMph', 'kingpinLeadIn', 'sideHeightIn',
    'casterWheelDiaIn', 'casterWheelWidthIn', 'casterOverallHeightIn', 'casterSwivelRadiusIn', 'casterRatingLb', 'casterSpacingIn', 'casterBlockLengthIn', 'casterBlockWidthIn', 'casterSweepClearIn',
    'casterPlateLengthIn', 'casterMassLb', 'bowBlockThickIn', 'bowBlockWidthIn', 'bowBlockBoltDiaIn', 'bridleEyeHeightIn', 'eyeBoltWasherDiameterIn', 'eyeBoltEyeOffsetIn',
    'sideProfileSagIn', 'bowCurlRadiusIn', 'bowCurlAngleDeg', 'bowCurlPlyIn', 'bowCurlPlies', 'footStopThickIn', 'seatBackKnobHeightIn', 'seatInsertAllowLbf', 'seatGripGapIn', 'seatGripClearLengthIn',
    // D-60: the drop-in foot block and its slot cleats
    'footBlockSlot', 'footBlockThickIn', 'footBlockStepIn', 'footBlockPositions'];
  // Typical values an old shared link would carry for them.
  const OLD: Record<string, number> = {
    noseWidthIn: 14, hullCurveStartIn: 18, tongueLengthIn: 40, frameStyle: 1, sideConstruction: 2, bumpSpeedMph: 5, kingpinLeadIn: 1.5, sideHeightIn: 6,
    casterWheelDiaIn: 10, casterWheelWidthIn: 2.5, casterOverallHeightIn: 12.5, casterSwivelRadiusIn: 6.5, casterRatingLb: 300, casterSpacingIn: 9.5, casterBlockLengthIn: 7, casterBlockWidthIn: 6,
    casterSweepClearIn: 0.5, casterPlateLengthIn: 5, casterMassLb: 8, bowBlockThickIn: 1.5, bowBlockWidthIn: 8, bowBlockBoltDiaIn: 0.375, bridleEyeHeightIn: 2.5, eyeBoltWasherDiameterIn: 1.5, eyeBoltEyeOffsetIn: 1,
    sideProfileSagIn: 1, bowCurlRadiusIn: 7, bowCurlAngleDeg: 80, bowCurlPlyIn: 0.118, bowCurlPlies: 4, footStopThickIn: 0.75, seatBackKnobHeightIn: 1.8, seatInsertAllowLbf: 400, seatGripGapIn: 1.5, seatGripClearLengthIn: 4.5,
    footBlockSlot: 1, footBlockThickIn: 1.5, footBlockStepIn: 4, footBlockPositions: 2, // D-60
  };
  const hashOf = (o: Record<string, number>) => '#' + Object.entries(o).map(([k, v]) => `${k}=${v}`).join('&');

  it('the removed keys are really not params any more', () => {
    for (const k of REMOVED) expect(keys, k).not.toContain(k);
  });
  it('steerLockDeg and frontTrackIn existed before and still do: an old link carrying them keeps them (they are NOT removed keys)', () => {
    expect(keys).toContain('steerLockDeg');
    expect(keys).toContain('frontTrackIn');
    const d = decodeHash(hashOf({ steerLockDeg: 25, frontTrackIn: 38, wheelbaseIn: 46 }));
    expect(d.steerLockDeg).toBe(25);
    expect(d.frontTrackIn).toBe(38);
    expect(d.wheelbaseIn).toBe(46);
    // out-of-range values clamp into the (new) range
    expect(decodeHash(hashOf({ steerLockDeg: 99 })).steerLockDeg).toBe(PARAM_DEFS.steerLockDeg.max);
  });
  it('a hash that carries them decodes to valid params: the removed keys are ignored, the surviving keys load, the rest are defaults', () => {
    const d = decodeHash(hashOf({ ...OLD, wheelbaseIn: 46, rearTrackIn: 36 }));
    expect(d.wheelbaseIn).toBe(46);
    expect(d.rearTrackIn).toBe(36);
    for (const k of REMOVED) expect((d as unknown as Record<string, number>)[k], k).toBeUndefined();
    expect(d).toEqual({ ...defaults, wheelbaseIn: 46, rearTrackIn: 36 });
    expect(Object.keys(d).sort()).toEqual([...keys].sort());
    // every value is a finite number inside its range
    for (const k of keys) {
      expect(Number.isFinite(d[k]), k).toBe(true);
      expect(d[k], k).toBeGreaterThanOrEqual(PARAM_DEFS[k].min);
      expect(d[k], k).toBeLessThanOrEqual(PARAM_DEFS[k].max);
    }
    expect(errorsOf(d)).toEqual([]);
  });
  it('buildModel and runChecks do not throw on it, and the model is the new sled (pivoting front axle, bow bulkhead, no casters, no curl)', () => {
    const d = decodeHash(hashOf({ ...OLD, wheelbaseIn: 46 }));
    let parts: ReturnType<typeof buildModel> = [];
    expect(() => (parts = buildModel(d))).not.toThrow();
    expect(parts.some((x) => x.id === 'beam-F')).toBe(true);
    expect(parts.some((x) => x.id === 'king-beam')).toBe(true);
    expect(parts.some((x) => x.id === 'bow-bulkhead')).toBe(true);
    expect(parts.some((x) => x.id === 'bow-curl')).toBe(false);
    expect(parts.some((x) => /^(caster-|bow-block|tip-swivel|front-hanger|kp-|spindle|tie-rod|side-cabin|side-nose)/.test(x.id))).toBe(false);
    let checks: ReturnType<typeof runChecks> = [];
    expect(() => (checks = runChecks(d, { includeTruck: false }))).not.toThrow();
    expect(checks.length).toBeGreaterThan(20);
    for (const c of checks) expect(Number.isFinite(c.value), c.id).toBe(true);
  });
  it('the same through sanitizeParams (the store, replace) and with every old key at an out-of-range value; the old keys alone give exactly the defaults', () => {
    expect(sanitizeParams(OLD as unknown as Partial<Params>)).toEqual(defaults);
    expect(decodeHash(hashOf(OLD))).toEqual(defaults);
    expect(decodeHash(hashOf(Object.fromEntries(REMOVED.map((k) => [k, 99999]))))).toEqual(defaults);
    const s = createStore();
    s.replace({ ...OLD, wheelbaseIn: 48 } as unknown as Partial<Params>);
    expect(s.get()).toEqual({ ...defaults, wheelbaseIn: 48 });
    expect(() => buildModel(s.get())).not.toThrow();
  });
  it('a re-encoded URL no longer carries them', () => {
    const d = decodeHash(hashOf({ ...OLD, wheelbaseIn: 46 }));
    const h = encodeHash(d);
    expect(h).toBe('wheelbaseIn=46');
    for (const k of REMOVED) expect(h).not.toContain(k);
  });
});

describe('buildModel (block model)', () => {
  const parts = buildModel(defaults);
  it('returns 4 wheels and a full part set with finite transforms', () => {
    expect(parts.length).toBeGreaterThan(50);
    expect(parts.filter((p) => p.geometry.type === 'wheel')).toHaveLength(4);
    for (const p of parts) {
      expect(p.transform).toHaveLength(16);
      expect(p.transform.every(Number.isFinite)).toBe(true);
    }
  });
  it('the steering angle turns the whole front axle (both wheels, the axle beam and the tongue) about the kingpin and is clamped to the lock', () => {
    const rot = (m: ReturnType<typeof buildModel>, id: string) => { const t = m.find((x) => x.id === id)!.transform; return Math.atan2(t[1], t[0]); };
    for (const deg of [5, 20, -12, -20]) {
      const m = buildModel(defaults, { steerDeg: deg });
      for (const id of ['wheel-FL', 'wheel-FR', 'beam-F', 'bridle-tongue']) expect(rot(m, id), `${id} @${deg}`).toBeCloseTo((deg * Math.PI) / 180, 6);
    }
    expect(rot(buildModel(defaults, { steerDeg: 90 }), 'wheel-FL')).toBeCloseTo((defaults.steerLockDeg * Math.PI) / 180, 6);
    expect(rot(buildModel(defaults, { steerDeg: -90 }), 'beam-F')).toBeCloseTo((-defaults.steerLockDeg * Math.PI) / 180, 6);
    const flat = buildModel(defaults).find((x) => x.id === 'wheel-FL')!;
    expect(flat.transform[0]).toBeCloseTo(1, 12);
    expect(flat.transform[1]).toBeCloseTo(0, 12);
  });
  it('mass and CG are sane', () => {
    expect(totalMass(parts)).toBeGreaterThan(20);
    const [x, y, z] = centerOfGravity(parts);
    expect(x).toBeGreaterThan(0);
    expect(Math.abs(y)).toBeLessThan(0.5); // near-symmetric: the brake lever and handle sockets are the only one-sided parts
    expect(z).toBeGreaterThan(0);
  });
});

describe('3c-5: the thing is a sled in every visible word', () => {
  const visible = (s: string | undefined) => (s ?? '').replace(/hand cart|billy-cart/gi, '');
  it('no parameter label, note or option says "cart" (the app and the box call it the sled)', () => {
    for (const [k, d] of Object.entries(PARAM_DEFS)) {
      expect(visible(d.label), k).not.toMatch(/\bcarts?\b/i);
      expect(visible(d.note), k).not.toMatch(/\bcarts?\b/i);
      for (const o of d.options ?? []) expect(o.label, k).not.toMatch(/\bcarts?\b/i);
    }
  });
});
