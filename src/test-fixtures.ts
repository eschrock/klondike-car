/**
 * Test fixtures shared by the hand-calc tests. NOT part of the app (only the test files import it).
 *
 * `PRE_D60` is every design number the weight package (D-60, docs/weight-study-3c.md) changed, at its value before the package. Several analysis tests re-derive a row by hand from the
 * numbers of an older design pass (the 3c-3 front end with 35.5 in tracks, the D-58 hanger, the 3c-5 resting load); they spread `PRE_D60` over the defaults so that hand
 * calculation stays valid against the formulas, while the tests of the real defaults (model.test, hull.test, params.test, d60-weight.test, ...) carry the D-60 numbers.
 */
import type { Params } from './params';

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
  panelPlyIn: 0.236,
  handlePostThickIn: 0.9375, handlePostWidthIn: 1.4375,
};
