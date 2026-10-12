import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, bowBulkhead, bowTurnInAt, defaultParams, resolveParams, sanitizeParam, sanitizeParams, steerGeometry, validateParams, type ParamKey, type Params } from './params';
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
      'footBlockThickIn', 'footBlockStepIn', 'footBlockPositions', 'footBlockSlot'];
    for (const k of gone) expect(keys, k).not.toContain(k);
    expect(keys.filter((k) => /^caster|^bowBlock|^swivel/.test(k))).toEqual([]);
    const added = ['sideHeightBowIn', 'sideHeightRearIn', 'sheerCurveIn', 'bowTurnInIn', 'bowTurnLenIn', 'bowBulkheadThickIn', 'bowBulkheadHeightIn', 
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
  it('the design defaults (D-54, D-56, D-57): 24 in body, 44 in wheelbase, 10 in wheels, 8 in deck, a sheer from 4 in at the bow to 14 in at the rear, the 1-1/2 in bow bulkhead (D-60), pivoting front axle at 34 1/2 in front and 32 in rear track (D-58) and 20 deg lock', () => {
    expect(defaults).toMatchObject({
      bodyWidthIn: 24, wheelbaseIn: 44, wheelDiameterIn: 10, deckHeightIn: 8, sideHeightBowIn: 4, sideHeightRearIn: 14, sheerCurveIn: 2.5, bowTurnInIn: 1.25, bowTurnLenIn: 14,
      bowBulkheadThickIn: 1.5, bowBulkheadHeightIn: 5.75, crossmemberSpacingIn: 8.5, standDeflectionRatio: 240, showSideSigns: 1, rearOverhangIn: 10, frontOverhangIn: 6.75, handleBowCrownIn: 0.875, seatXIn: 13.5, riderLegReachIn: 35.75, // D-60: 1/4 in more, the thinner bulkhead's face is 1/4 in further forward
       seatDepthIn: 14.5, storageVolumeIn3: 2000,
      frontTrackIn: 34.5, rearTrackIn: 32, steerLockDeg: 20, steerClearIn: 0.75, kingpinDiaIn: 0.625, kingThrustOdIn: 3, kingThrustThickIn: 0.5, kingBeamLengthIn: 3,
      tongueWidthIn: 1.25, tongueDepthIn: 1.75, tongueTieAheadIn: 5, steerRopesOn: 0, frontBeamThicknessIn: 2.5, rollPadRadiusIn: 11.5, // D-60: tongue 1-1/4 x 1-3/4, pads out 1/2 in with the short hub
      transomThicknessIn: 0.5, panelPlyIn: 0.157, seatBackPlyIn: 0.472, wheelMass10Lb: 2.8, wheelRatingLb: 300, hubLengthIn: 2.28, wheelBoreIn: 0.75, axleWallIn: 0.12, crossmemberThickIn: 0.625, handleSocketDepthIn: 14,
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
  it('steer clearance at full lock (D-56): a narrow front track is an error that names the minimum track; the minimum itself passes and a hair less fails', () => {
    const sg = steerGeometry(defaults);
    expect(sg.clearAtLock).toBeGreaterThan(defaults.steerClearIn);
    const narrow = errorsOf({ ...defaults, frontTrackIn: 30 });
    const e = narrow.find((i) => i.keys.includes('frontTrackIn') && i.keys.includes('steerLockDeg'));
    expect(e, 'a steer-clearance error').toBeDefined();
    expect(e!.message).toContain(`${sg.minTrack.toFixed(1)}"`);
    expect(e!.message).toMatch(/Widen the front track to at least/);
    // the formula is consistent: at exactly the minimum track the clearance equals steerClearIn
    const atMin = steerGeometry({ ...defaults, frontTrackIn: sg.minTrack });
    expect(atMin.clearAtLock).toBeCloseTo(defaults.steerClearIn, 9);
    const clearErr = (t: number) => errorsOf({ ...defaults, frontTrackIn: t }).some((i) => i.keys.includes('steerLockDeg') && i.keys.includes('frontTrackIn'));
    expect(clearErr(sg.minTrack + 0.01)).toBe(false);
    expect(clearErr(sg.minTrack - 0.01)).toBe(true);
    // a bigger lock needs a wider track
    expect(steerGeometry({ ...defaults, steerLockDeg: 30 }).minTrack).toBeGreaterThan(sg.minTrack);
    // a track so narrow the tires touch the body at rest is its own error
    expect(errorsOf({ ...defaults, frontTrackIn: 26 }).some((i) => i.keys.includes('frontTrackIn'))).toBe(true);
  });
  it('steering check chains (D-58): the anchor eye pulls in on a narrow body so its 2 in washer clears the rail; the beam eye must lie between the kingpin disc and the end of the beam', () => {
    const L0 = computeLayout(defaults), L1 = computeLayout({ ...defaults, bodyWidthIn: 20 });
    expect(Math.abs(L0.chain.anchor[1])).toBeCloseTo(defaults.steerChainAnchorYIn, 9);
    expect(Math.abs(L1.chain.anchor[1])).toBeLessThan(defaults.steerChainAnchorYIn);
    expect(Math.abs(L1.chain.anchor[1]) + 1.15).toBeLessThanOrEqual(L1.steer.railYIn - L1.turnIn(L1.chain.joistX) + 1e-9);
    expect(errorsOf({ ...defaults, steerChainBeamYIn: 1 }).some((i) => i.keys.includes('steerChainBeamYIn'))).toBe(true);
    expect(errorsOf({ ...defaults, steerChainBeamYIn: 15.2 }).some((i) => i.keys.includes('steerChainBeamYIn'))).toBe(true);
    expect(errorsOf({ ...defaults, steerChainBeamYIn: 10.4 })).toEqual([]);
  });
  it('side profile (D-57): a bow side taller than the rear side warns; a bow side the panel cannot fit (under 1 in above the two bands) errors; a bulkhead too low for the hand-hold errors', () => {
    expect(withKey({ ...defaults, sideHeightBowIn: 7, sideHeightRearIn: 6 }, 'sideHeightBowIn').some((i) => i.severity === 'warn')).toBe(true);
    expect(errorsOf({ ...defaults, sideHeightBowIn: 3 }).some((i) => i.keys.includes('railBandIn'))).toBe(true); // 3 - 2 x 1.5 < 1
    expect(errorsOf({ ...defaults, bowBulkheadHeightIn: 4 }).some((i) => i.keys.includes('liftSlotClearIn'))).toBe(true); // 3 in of hand clearance + 1.25 slot + 0.75 oak = 5
    expect(errorsOf({ ...defaults, sideHeightBowIn: 5 }).filter((i) => i.keys.some((k) => /^(side|bow|lift)/.test(k)))).toEqual([]);
  });
  it('bow bulkhead and turn-in (D-57): the bulkhead sits one thickness behind the tip; the turn-in is 0 behind its start and bowTurnInIn at the face, a smoothstep between; the bend radius must meet the cold-bend limit; the feet must reach the face', () => {
    const b = bowBulkhead(defaults);
    expect(b.xTip).toBeCloseTo(50.75, 9);
    expect(b.xFlatEnd).toBeCloseTo(49.25, 9); // D-60: the bulkhead is 1-1/2 in, so its face is 1/4 in further forward
    expect(b.thick).toBe(1.5);
    expect(bowTurnInAt(defaults, 30)).toBe(0);
    expect(bowTurnInAt(defaults, b.xFlatEnd)).toBeCloseTo(defaults.bowTurnInIn, 9);
    expect(bowTurnInAt(defaults, b.xFlatEnd - defaults.bowTurnLenIn / 2)).toBeCloseTo(defaults.bowTurnInIn / 2, 9);
    // a tight bend: 3 in over 6 in is a 2 in radius, far under 40 x 5/16
    expect(errorsOf({ ...defaults, bowTurnInIn: 3, bowTurnLenIn: 6 }).some((i) => /cold-bend|bend/.test(i.message))).toBe(true);
    expect(errorsOf({ ...defaults, bowTurnInIn: 0 }).filter((i) => i.keys.some((k) => /^(bow|side)/.test(k)))).toEqual([]);
    // the rider's feet reach past the bulkhead face
    expect(errorsOf({ ...defaults, riderLegReachIn: 40 }).some((i) => i.keys.includes('riderLegReachIn'))).toBe(true);
    // the turn-in can pinch the nose
    expect(errorsOf({ ...defaults, bodyWidthIn: 18, bowTurnInIn: 3, bowTurnLenIn: 30 }).length).toBeGreaterThan(0);
  });
  it('axle hanger: wide enough for the beam notch and 3/4 in of oak each side; body clear of the rear tires and the U-bolt plates', () => {
    expect(errorsOf({ ...defaults, axleHangerWidthIn: 3.5 }).some((i) => i.keys.includes('axleHangerWidthIn'))).toBe(true);
    expect(errorsOf({ ...defaults, axleHangerWidthIn: 5 })).toEqual([]);
    expect(errorsOf({ ...defaults, bodyWidthIn: 34 }).some((i) => i.keys.includes('rearTrackIn'))).toBe(true);
    expect(errorsOf({ ...defaults, bodyWidthIn: 30, rearTrackIn: 36 }).some((i) => i.message.startsWith('The rails/sides reach'))).toBe(true);
    expect(errorsOf({ ...defaults, bodyWidthIn: 20, bowTurnInIn: 3.75 }).some((i) => /pinches the nose/.test(i.message))).toBe(true); // a 13 in nose is the least (hand-hold, foot brace, tongue): 20 - 2 x 3.5 = 13 passes, 12.5 in does not
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
