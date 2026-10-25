/**
 * Test fixtures shared by the hand-calc tests. NOT part of the app (only the test files import it).
 *
 * `PRE_D60` is every design number the weight package (D-60) changed, at its value before the package. Several analysis tests re-derive a row by hand from the
 * numbers of an older design pass (the 3c-3 front end with 35.5 in tracks, the D-58 hanger, the 3c-5 resting load); they spread `PRE_D60` over the defaults so that hand
 * calculation stays valid against the formulas, while the tests of the real defaults (model.test, hull.test, params.test, d60-weight.test, ...) carry the D-60 numbers.
 */
import type { Params } from './params';

/** `npm run test:full`: the randomized sweeps run at full depth (to hunt for bugs); `npm test` and the deploy run a quick sample of each. */
export const FULL_TESTS = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.FULL_TESTS;

export const PRE_D60: Partial<Params> = {
  // Package A
  steerEyeBoltDiaIn: 0.5, steerEyeWllLb: 1500, steerChainDiaIn: 0.25, steerChainWllLb: 2600, chainJoistThickIn: 1.5,
  tongueWidthIn: 1.5, tongueDepthIn: 2,
  bowBulkheadThickIn: 1.75, riderLegReachIn: 35.5, rollPadRadiusIn: 11,
  transomThicknessIn: 0.75, crossmemberThickIn: 0.75, handleSocketDepthIn: 16,
  clampPlateThickIn: 0.375, axleBeamThicknessIn: 2.5, beamHoldDownThickIn: 0.1875,
  brakeFlapThickIn: 1, brakeFlapWidthIn: 3.5, brakeBackerThickIn: 1.25, brakeKneeLegIn: 2,
  storageLidRimWidthIn: 1, seatBackFrameWidthIn: 1.5, grabBoardThickIn: 0.75,
  axleWallIn: 0,
  // the four trade-offs
  wheelMass10Lb: 4, wheelRatingLb: 300, hubLengthIn: 3,
  thinSheetMaterial: 2, panelPlyIn: 0.236, // D-73: the okoume option, so panelPlyIn (6 mm) is the thin sheet
  handlePostThickIn: 0.9375, handlePostWidthIn: 1.4375,
  // D-62 (3c-7): the axle groove is the full tube diameter again (no 0.05 in proud) and the clamp bolts sit 0.625 in from the tube centerline, so the older hand calcs keep their geometry.
  axleProudIn: 0, clampLegGapIn: 0.25, clampPlateLengthIn: 0.8, clampPlateOuterWidthIn: 1.5, kingThrustThickIn: 0.5625, rollPadThickIn: 0.3125, beamRailClearIn: 0.4,
};

/**
 * D-66 (matched 30 in tracks, the derived bow taper, the 10 in load-height rule, pads and chain eyes moved in) changed the numbers the 3c-3 hand-calc fixtures were built on. `PRE_D66` puts the
 * D-58 design back for those tests: 32 in rear and 34 1/2 in front track, a 12 in load-height rule, the pads 11-1/2 in out (spread PRE_D66 BEFORE PRE_D60, which has the older 11 in), the chain eyes at 10.4 / 8.4 in, and the D-57 bow turn-in (1.25 in a side over the last 14 in:
 * `bowWidthIn` 21.5 from x = 35; with these wide tracks the derived taper is not limited by the wheels, so it ends at the bulkhead, as the old smoothstep did). The D-66 defaults are tested in d66.test.ts and the rows' own files.
 */
export const PRE_D66: Partial<Params> = {
  rearTrackIn: 32, frontTrackIn: 34.5, cargoCgHeightIn: 12, rollPadRadiusIn: 11.5, steerChainBeamYIn: 10.4, steerChainAnchorYIn: 8.4, bowWidthIn: 21.5, bowTaperStartIn: 35, bowTaperSlackIn: 0,
};

/**
 * D-71 (Harbor Freight 10 in wheels, 5/8 in axles) changed the axle diameter (3/4 to 5/8 in), the wheel bore, the hub length (2.28 to 2.25 in), the wheel mass (2.8 to 3.0 lb), the clamp
 * plate width (1.5 to 1.75 in) and the proud of the tube (0.05 to 0.03 in, which keeps the king beam inside an 8/4 board). `PRE_D71` puts the D-60 / D-62 3/4 in axle design back for the hand-calc tests whose literal numbers (the beam top at 5.325 in, the groove 0.70 in deep, the
 * clamp bolts at 0.75 in) were worked out for it. Spread it over the defaults BEFORE the older fixtures. The D-71 defaults are tested in axle.test.ts and the rows' own files.
 */
export const PRE_D71: Partial<Params> = {
  axleDiameterIn: 0.75, wheelBoreIn: 0.75, hubLengthIn: 2.28, wheelMass10Lb: 2.8, clampPlateWidthIn: 1.5, axleProudIn: 0.05,
};

/**
 * D-71 (Eric chose the solid rod) and D-73 (the Standard weather spec's thin sheet is 1/4 in white oak plywood) changed two defaults: the axle is a solid 5/8 in rod (it was the 0.120 in DOM tube) and the
 * sides, box, lid and signs are 0.21 in white oak plywood (they were 4 mm okoume). `PRE_D72` puts the D-71 tube and the 4 mm okoume back for the tests whose literal numbers were worked out for them
 * (the D-60 weight package, the hand calculations on the tube, the 4 mm sandwich bands). Spread it over the defaults BEFORE PRE_D71 and PRE_D66. The new defaults are tested in d72.test.ts.
 */
/**
 * D-101 (Eric's bend test, 2026-10-25) made the rail three 1/4 in strips (it was two of 3/8 in). The 3/8 in rough of a 1/4 in strip is the band strips' rough, so the rails and bands now share
 * one resaw pool of 4/4. `PRE_D101` puts the two-ply rail back for the tests of two separate pools (the 1/2 in rail strips from their own board). The new defaults are tested in d101.test.ts.
 */
export const PRE_D101: Partial<Params> = { railPlies: 2 };

export const PRE_D72: Partial<Params> = {
  thinSheetMaterial: 2, // 4 mm okoume marine (THIN_SHEET.okoumeMarine)
  panelPlyIn: 0.157, okoumeMoePerpPsi: 150000, okoumeMorPerpPsi: 1500, // D-80 made the okoume option 6 mm (0.236 in, 315,000 / 3,000 psi across the grain); these are the 4 mm values
  axleWallIn: 0.12,
};
