import type { Params } from '../src/params';
/** Phase 2 recommended configuration (docs/phase2-recommendation.md): changes from the Phase 1 defaults. */
export const RECOMMENDED: Partial<Params> = {
  drawbar: 0, // rope bridle to the axle ends, no wooden tongue
  wheelbaseIn: 44,
  steerLockDeg: 37,
  kingpinDiameterIn: 0.75,
  kingpinSleeveOdIn: 1.25,
  kingpinLeadIn: 1.5,
  frontAxleBeamThicknessIn: 4.0,
  axleYieldPsi: 70000, // 3/4" 1045 turned-ground-polished shafting
  deckPlyIn: 0.472, // 12 mm okoume
  crossmemberSpacingIn: 8,
  brakeLeverRatio: 12,
  bridleRopeRunIn: 96, // 8 ft bridle tails, tied low at the axle ends
};
