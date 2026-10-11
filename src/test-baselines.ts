import { defaultParams, type Params } from './params';

/**
 * The Phase 1 design defaults, frozen. Several tests carry hand calculations (H1/H2/H3/M3/M4/D1/L1/L2, the A-2
 * turn radius, ...) worked at this configuration; they run against `phase1Params()` so the arithmetic in the test
 * title stays valid and readable no matter how the live defaults move (Phase 2 / D-27 changed them).
 */
export const PHASE1_BASELINE: Partial<Params> = {
  drawbar: 1,
  wheelbaseIn: 48,
  steerLockDeg: 38.5,
  kingpinDiameterIn: 0.5,
  kingpinSleeveOdIn: 0,
  kingpinLeadIn: 1.125,
  frontAxleBeamThicknessIn: 3.5,
  axleYieldPsi: 50000,
  deckPlyIn: 0.354,
  crossmemberSpacingIn: 12,
  brakeLeverRatio: 10,
  bridleRopeRunIn: 72,
  bolsterFastenerDiameterIn: 0.25, // Phase 2 assumed 4 × ¼" bolster bolts (D-33 makes them 3/8")
};

export function phase1Params(): Params {
  return { ...defaultParams(), ...PHASE1_BASELINE };
}
