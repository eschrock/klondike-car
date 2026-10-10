/**
 * Single source of truth for every design variable.
 *
 * Units: inches, pounds (mass = lb, force = lbf), degrees, lb/ft³, psi.
 * Model frame: +X forward (toward the bridle), +Y left, +Z up. Origin is on the
 * ground directly below the rear-axle centre, midway between the rear wheels.
 *
 * `status` records how confident we are in a default:
 *   locked  – fixed by the brief, the event rules, or Eric
 *   verify  – placeholder that Eric needs to measure/confirm
 *   assumed – engineering assumption (cited by `ref` in DECISIONS.md)
 *   explore – design variable that Phase 2 optimises
 *
 * View-only state (e.g. the displayed steer angle) does NOT live here; it is
 * passed to buildModel() separately so it never pollutes the design.
 */

export type ParamStatus = 'locked' | 'verify' | 'assumed' | 'explore';

export type ParamGroup =
  | 'loads'
  | 'layout'
  | 'body'
  | 'seat'
  | 'wheels'
  | 'steering'
  | 'brake'
  | 'stock'
  | 'materials'
  | 'factors'
  | 'truck';

export interface ParamOption {
  value: number;
  label: string;
}

export interface ParamDef {
  label: string;
  group: ParamGroup;
  unit: string;
  default: number;
  min: number;
  max: number;
  step: number;
  status: ParamStatus;
  /** Shown as a slider in the main panel; others live under "Advanced". */
  primary?: boolean;
  /** Discrete choices; when present the UI renders a select. */
  options?: ParamOption[];
  /** DECISIONS.md IDs that justify the default, e.g. "D-6". */
  ref?: string;
  note?: string;
}

export const GROUP_LABELS: Record<ParamGroup, string> = {
  loads: 'Rider & loads',
  layout: 'Overall layout',
  body: 'Body / hull',
  seat: 'Seat & rider position',
  wheels: 'Wheels & axles',
  steering: 'Steering & pull',
  brake: 'Brake & rear handle',
  stock: 'Stock thicknesses',
  materials: 'Material properties',
  factors: 'Design factors & check limits',
  truck: 'Truck bed (2007 Tacoma short bed)',
};

// Enumerations stored as numbers so every param is a plain number (C-3).
export const AXLE_STYLE = { throughRod: 0, stubAxles: 1 } as const;
export const AXLE_BEAM_POSITION = { underslung: 0, overslung: 1 } as const;
export const TIRE_TYPE = { pneumatic: 0, flatFree: 1 } as const;
export const PLY_SPECIES = { okoumeMarine: 0, balticBirchExterior: 1 } as const;
export const BRAKE_TYPE = { tireTread: 0, woodDrum: 1 } as const;
export const DRAWBAR = { ropeBridleOnly: 0, woodTongue: 1 } as const;
export const FRAME_STYLE = { ladder: 0, hullBeam: 1 } as const;
export const SIDE_CONSTRUCTION = { solidOak: 0, capturedPly: 1, openFrame: 2 } as const;
export const STORAGE_LOCATION = { rearOverAxle: 0, forwardRaised: 1, underSeat: 2 } as const;

/** Mannequin proportions (fractions of stature, D-3) that the nose-width validator also needs: hip separation and foot width. */
/** A rear box shorter than this is not a box (critic H3). */
const MIN_REAR_STORAGE_LENGTH_IN = 6;
export const RIDER_LEG_Y_FRAC = 0.05;
export const RIDER_FOOT_Y_FRAC = 0.06;
/** Pelvis block height (fraction of stature): the seat-back pad starts above it. */
export const RIDER_PELVIS_Z_FRAC = 0.075;

const defs = {
  // ── Rider & loads ────────────────────────────────────────────────────────
  riderMassLb: {
    label: 'Operating rider mass', group: 'loads', unit: 'lb',
    default: 150, min: 60, max: 220, step: 5, status: 'locked', primary: true, ref: 'D-1',
    note: 'Largest realistic scout. All checks must pass here.',
  },
  riderGoalMassLb: {
    label: 'Goal rider mass', group: 'loads', unit: 'lb',
    default: 200, min: 150, max: 250, step: 5, status: 'locked', ref: 'D-1',
    note: 'Adult/stretch case. Structure is designed to it; stability is reported at it and flagged if it would compromise the design.',
  },
  riderStatureIn: {
    label: 'Rider stature', group: 'loads', unit: 'in',
    default: 68, min: 54, max: 76, step: 1, status: 'assumed', ref: 'D-3',
  },
  riderSeatedCgAboveSeatIn: {
    label: 'Seated rider CG above seat surface', group: 'loads', unit: 'in',
    default: 9.5, min: 7, max: 12, step: 0.5, status: 'assumed', ref: 'D-3',
  },
  riderCgAheadOfHpointIn: {
    label: 'Seated rider CG ahead of H-point', group: 'loads', unit: 'in',
    default: 4, min: 0, max: 10, step: 0.5, status: 'assumed', ref: 'D-3',
    note: 'Legs extended forward pull the whole-body CG ahead of the hip joint.',
  },
  riderLegReachIn: {
    label: 'H-point to foot stop (horizontal)', group: 'loads', unit: 'in',
    default: 36, min: 24, max: 44, step: 0.5, status: 'assumed', ref: 'D-3',
    note: 'Knees slightly bent on a low seat; ≈ 0.53 × stature.',
  },
  bootAllowanceIn: {
    label: 'Boot allowance per side (nose width)', group: 'loads', unit: 'in',
    default: 0.5, min: 0, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-3',
    note: 'Winter boots add about ½" per boot to the foot span the nose must hold (critic Phase 1 r2, M4).',
  },
  cargoMassLb: {
    label: 'Cargo (10 Essentials + team gear)', group: 'loads', unit: 'lb',
    default: 25, min: 0, max: 60, step: 1, status: 'locked',
  },
  pullForceLbf: {
    label: 'Design bridle pull (peak)', group: 'loads', unit: 'lbf',
    default: 150, min: 50, max: 400, step: 10, status: 'assumed', ref: 'D-14',
    note: '4–6 scouts surging; steady pull on the flat is only ~20–30 lbf.',
  },

  // ── Overall layout ───────────────────────────────────────────────────────
  wheelbaseIn: {
    label: 'Wheelbase (axle to axle)', group: 'layout', unit: 'in',
    default: 48, min: 36, max: 64, step: 0.5, status: 'explore', primary: true,
  },
  rearTrackIn: {
    label: 'Rear track (wheel centre to centre)', group: 'layout', unit: 'in',
    default: 35.5, min: 26, max: 52, step: 0.25, status: 'explore', primary: true, ref: 'D-6',
    note: 'Wheels beside the wheel wells: track + outer width (tire or hub + axle end) + 2 × clearance ≤ well gap → 35.5". Wider only with "straddle" stowage.',
  },
  frontTrackIn: {
    label: 'Front track', group: 'layout', unit: 'in',
    default: 35.5, min: 26, max: 52, step: 0.25, status: 'explore', primary: true, ref: 'D-6',
  },
  rearOverhangIn: {
    label: 'Body overhang behind rear axle', group: 'layout', unit: 'in',
    default: 10, min: 0, max: 18, step: 0.5, status: 'explore',
    note: 'Brake pivot, rear-handle sockets, and (by default) the storage box over the rear axle.',
  },
  frontOverhangIn: {
    label: 'Body/prow overhang ahead of front axle', group: 'layout', unit: 'in',
    default: 8, min: 0, max: 20, step: 0.5, status: 'explore',
  },
  deckHeightIn: {
    label: 'Deck (floor top) height, between axles', group: 'layout', unit: 'in',
    default: 9, min: 6, max: 16, step: 0.25, status: 'explore', primary: true, ref: 'D-15',
    note: 'Must clear the axle/beam/turntable stack; see validateParams().',
  },
  frontDeckRaiseIn: {
    label: 'Forward deck raise over front axle', group: 'layout', unit: 'in',
    default: 0.5, min: 0, max: 8, step: 0.25, status: 'explore', ref: 'D-15',
    note: 'Step the hull up ahead of the foot well so the front wheels can swing under it.',
  },
  minGroundClearanceIn: {
    label: 'Minimum ground clearance', group: 'layout', unit: 'in',
    default: 3.5, min: 2, max: 6, step: 0.25, status: 'assumed', ref: 'D-16',
    note: 'Lowest point (axle beams, brake shoe) vs roots and trail crowns.',
  },

  // ── Body / hull ──────────────────────────────────────────────────────────
  frameStyle: {
    label: 'Primary structure', group: 'body', unit: '',
    default: FRAME_STYLE.ladder, min: 0, max: 1, step: 1, status: 'explore', ref: 'D-17',
    options: [
      { value: FRAME_STYLE.ladder, label: 'Ladder frame (rails + crossmembers)' },
      { value: FRAME_STYLE.hullBeam, label: 'Hull-as-beam (sides are the girders)' },
    ],
  },
  sideConstruction: {
    label: 'Side construction', group: 'body', unit: '',
    default: SIDE_CONSTRUCTION.capturedPly, min: 0, max: 2, step: 1, status: 'explore', ref: 'D-22',
    options: [
      { value: SIDE_CONSTRUCTION.solidOak, label: 'Solid oak boards' },
      { value: SIDE_CONSTRUCTION.capturedPly, label: 'Okoume panel captured in oak frame' },
      { value: SIDE_CONSTRUCTION.openFrame, label: 'Open oak frame (gunwale on posts)' },
    ],
  },
  bodyWidthIn: {
    label: 'Cabin outside width (at deck)', group: 'body', unit: 'in',
    default: 28, min: 18, max: 36, step: 0.25, status: 'explore', primary: true,
  },
  noseWidthIn: {
    label: 'Hull width in the front-wheel swing zone', group: 'body', unit: 'in',
    default: 13.5, min: 12, max: 18, step: 0.25, status: 'explore', ref: 'D-15',
    note: 'Must hold the rider\'s feet + boots (bootAllowanceIn) and be ≤ 2 × (inner tire corner y at full lock − steering clearance); see A-4.',
  },
  noseTaperStartIn: {
    label: 'Nose taper starts this far behind front axle', group: 'body', unit: 'in',
    default: 18, min: 14, max: 26, step: 0.5, status: 'explore', ref: 'A-4',
    note: 'Measured from the front AXLE. The full-width cabin must end behind the rear-most tire corner at full lock + steering clearance; that corner is (swing rear extent − kingpin lead) behind the axle (A-4).',
  },
  steeringClearanceIn: {
    label: 'Tire-to-hull clearance at full lock', group: 'body', unit: 'in',
    default: 0.75, min: 0.25, max: 2, step: 0.125, status: 'assumed', ref: 'A-4',
    note: 'Covers tire bulge, mud, and turntable/kingpin play.',
  },
  sideHeightIn: {
    label: 'Side height above deck', group: 'body', unit: 'in',
    default: 7, min: 3, max: 12, step: 0.25, status: 'explore',
  },
  railBandIn: {
    label: 'Chine / gunwale height', group: 'body', unit: 'in',
    default: 1.5, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-22',
    note: 'Oak chine and gunwale section height; the side panel is captured between them.',
  },
  gunwaleFlareIn: {
    label: 'Gunwale outward flare (each side)', group: 'body', unit: 'in',
    default: 0, min: 0, max: 4, step: 0.25, status: 'explore', ref: 'D-6',
    note: 'Above the wheel-well height the body may be wider than the well gap.',
  },
  crossmemberSpacingIn: {
    label: 'Max unsupported deck span (joist spacing)', group: 'body', unit: 'in',
    default: 12, min: 6, max: 24, step: 0.5, status: 'explore', ref: 'D-17',
  },
  storageLocation: {
    label: 'Storage box location', group: 'body', unit: '',
    default: STORAGE_LOCATION.rearOverAxle, min: 0, max: 2, step: 1, status: 'explore', ref: 'D-19',
    options: [
      { value: STORAGE_LOCATION.rearOverAxle, label: 'Behind seat, over rear axle' },
      { value: STORAGE_LOCATION.forwardRaised, label: 'Forward, raised over front wheels' },
      { value: STORAGE_LOCATION.underSeat, label: 'Under the seat' },
    ],
  },
  storageVolumeIn3: {
    label: 'Storage box interior volume', group: 'body', unit: 'in³',
    default: 1800, min: 800, max: 4000, step: 50, status: 'assumed', ref: 'D-19',
  },
  storageOverSideIn: {
    label: 'Storage box max height above the side top', group: 'body', unit: 'in',
    default: 2, min: 0, max: 6, step: 0.25, status: 'assumed', ref: 'D-19',
    note: 'Caps the box height; the box is a flat tray, so the volume target spreads over its length and width.',
  },
  storageRaisedClearIn: {
    label: 'Raised storage box clearance above tires and knees', group: 'body', unit: 'in',
    default: 0.75, min: 0.25, max: 3, step: 0.25, status: 'assumed', ref: 'D-19',
    note: 'forwardRaised only: box bottom = the higher of (wheel diameter, rider knee top) + this.',
  },
  storageLidRimWidthIn: {
    label: 'Storage lid oak rim width', group: 'body', unit: 'in',
    default: 1, min: 0.5, max: 2, step: 0.25, status: 'assumed', ref: 'D-19',
    note: 'Oak perimeter strip under the ply lid; the box walls end on it.',
  },
  storageLidRimThickIn: {
    label: 'Storage lid oak rim thickness', group: 'body', unit: 'in',
    default: 0.5, min: 0.375, max: 1, step: 0.125, status: 'assumed', ref: 'D-19',
  },

  // ── Seat & rider position ────────────────────────────────────────────────
  seatXIn: {
    label: 'Seat H-point ahead of rear axle', group: 'seat', unit: 'in',
    default: 12, min: 1.5, max: 17.5, step: 0.5, status: 'explore', primary: true,
    note: 'Forward → more front load, better lock stability; aft → more rear-brake traction.',
  },
  seatDepthIn: {
    label: 'Seat cushion depth (fore-aft)', group: 'seat', unit: 'in',
    default: 16, min: 10, max: 22, step: 0.5, status: 'assumed', ref: 'D-18',
  },
  seatWidthIn: {
    label: 'Seat cushion width', group: 'seat', unit: 'in',
    default: 18, min: 12, max: 26, step: 0.5, status: 'assumed', ref: 'D-18',
    note: 'Clamped to the cabin inside width. Rider hips are about 12" wide.',
  },
  seatBehindHpointIn: {
    label: 'Cushion rear edge behind H-point', group: 'seat', unit: 'in',
    default: 4, min: 2, max: 8, step: 0.5, status: 'assumed', ref: 'D-18',
  },
  seatRiserIn: {
    label: 'Seat riser under the cushion', group: 'seat', unit: 'in',
    default: 0, min: 0, max: 3, step: 0.25, status: 'explore', ref: 'D-18',
    note: 'The cushion sits directly on the deck by default (the old 1.5" base ring was redundant). A riser is two oak runners.',
  },
  seatBackWidthIn: {
    label: 'Seat-back width', group: 'seat', unit: 'in',
    default: 16, min: 12, max: 26, step: 0.5, status: 'assumed', ref: 'D-18',
    note: 'About stature × 0.19 + margin for a 13" torso.',
  },
  seatBackThickIn: {
    label: 'Seat-back frame thickness', group: 'seat', unit: 'in',
    default: 0.75, min: 0.5, max: 1.25, step: 0.0625, status: 'assumed', ref: 'D-18',
    note: 'Oak frame (2 stiles + 2 rails) with a ply or fabric panel captured in it.',
  },
  seatBackFrameWidthIn: {
    label: 'Seat-back frame member width', group: 'seat', unit: 'in',
    default: 1.5, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-18',
  },
  footStopHeightIn: {
    label: 'Foot stop height above deck', group: 'seat', unit: 'in',
    default: 4, min: 2, max: 8, step: 0.5, status: 'assumed', ref: 'D-3',
  },
  footStopThickIn: {
    label: 'Foot stop thickness', group: 'seat', unit: 'in',
    default: 0.75, min: 0.5, max: 2, step: 0.25, status: 'assumed', ref: 'D-3',
    note: 'An oak board across the nose, braced by the nose sides.',
  },
  seatCushionIn: {
    label: 'Seat cushion thickness', group: 'seat', unit: 'in',
    default: 2, min: 1, max: 5, step: 0.25, status: 'assumed', ref: 'D-18',
  },
  seatBackHeightIn: {
    label: 'Seat-back height above seat', group: 'seat', unit: 'in',
    default: 16, min: 8, max: 24, step: 0.5, status: 'assumed', ref: 'D-18',
  },
  seatBackAngleDeg: {
    label: 'Seat-back recline from vertical', group: 'seat', unit: '°',
    default: 15, min: 0, max: 30, step: 1, status: 'assumed', ref: 'D-18',
  },

  // ── Wheels & axles ───────────────────────────────────────────────────────
  wheelDiameterIn: {
    label: 'Wheel (tire OD) diameter', group: 'wheels', unit: 'in',
    default: 13, min: 10, max: 13, step: 0.5, status: 'explore', primary: true, ref: 'D-11',
    note: 'Stock sizes: 10" (4.10/3.50-4), ~12" (2.80/2.50-4 or 3.00-4), 13" (4.10/3.50-6). Mass interpolates between the 10" and 13" values.',
  },
  tireType: {
    label: 'Tire type', group: 'wheels', unit: '',
    default: TIRE_TYPE.pneumatic, min: 0, max: 1, step: 1, status: 'explore', ref: 'D-11',
    options: [
      { value: TIRE_TYPE.pneumatic, label: 'Pneumatic' },
      { value: TIRE_TYPE.flatFree, label: 'Flat-free PU foam' },
    ],
  },
  tireWidthIn: {
    label: 'Tire section width', group: 'wheels', unit: 'in',
    default: 4, min: 2.5, max: 5, step: 0.25, status: 'assumed', ref: 'D-11',
  },
  hubLengthIn: {
    label: 'Wheel hub length', group: 'wheels', unit: 'in',
    default: 3, min: 1.5, max: 4, step: 0.25, status: 'verify', ref: 'D-11',
  },
  wheelMass10Lb: {
    label: 'Mass per 10" wheel assembly', group: 'wheels', unit: 'lb',
    default: 4, min: 2, max: 8, step: 0.25, status: 'verify', ref: 'D-11',
  },
  wheelMass13Lb: {
    label: 'Mass per 13" wheel assembly', group: 'wheels', unit: 'lb',
    default: 5.5, min: 3, max: 9, step: 0.25, status: 'verify', ref: 'D-11',
  },
  flatFreeExtraLb: {
    label: 'Extra mass per wheel, flat-free', group: 'wheels', unit: 'lb',
    default: 1.25, min: 0, max: 3, step: 0.25, status: 'verify', ref: 'D-11',
  },
  axleDiameterIn: {
    label: 'Axle diameter', group: 'wheels', unit: 'in',
    default: 0.75, min: 0.625, max: 0.75, step: 0.125, status: 'explore', ref: 'D-10',
    options: [
      { value: 0.625, label: '5/8"' },
      { value: 0.75, label: '3/4"' },
    ],
  },
  axleStyle: {
    label: 'Axle style', group: 'wheels', unit: '',
    default: AXLE_STYLE.throughRod, min: 0, max: 1, step: 1, status: 'explore', ref: 'D-10',
    options: [
      { value: AXLE_STYLE.throughRod, label: 'Through rod (dead axle)' },
      { value: AXLE_STYLE.stubAxles, label: 'Stub axles in oak beam' },
    ],
  },
  axleBeamPosition: {
    label: 'Axle beam relative to axle', group: 'wheels', unit: '',
    default: AXLE_BEAM_POSITION.underslung, min: 0, max: 1, step: 1, status: 'explore', ref: 'D-15',
    options: [
      { value: AXLE_BEAM_POSITION.underslung, label: 'Beam below axle (axle in top groove)' },
      { value: AXLE_BEAM_POSITION.overslung, label: 'Beam above axle (axle in saddles)' },
    ],
  },
  axleEndExtraIn: {
    label: 'Axle beyond hub (collar + cotter)', group: 'wheels', unit: 'in',
    default: 1, min: 0.5, max: 2, step: 0.125, status: 'assumed',
  },
  clampLegGapIn: {
    label: 'U-bolt leg gap beside the axle rod', group: 'wheels', unit: 'in',
    default: 0.25, min: 0.125, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-10',
    note: 'Clamp legs straddle the rod at rod centre ± (rod radius + gap) (critic r2, H2).',
  },
  clampPlateWidthIn: {
    label: 'U-bolt plate width (across the beam)', group: 'wheels', unit: 'in',
    default: 1.5, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-10',
  },
  clampPlateLengthIn: {
    label: 'U-bolt plate length (fore-aft)', group: 'wheels', unit: 'in',
    default: 0.8, min: 0.5, max: 1.5, step: 0.1, status: 'assumed', ref: 'D-10',
  },
  clampPlateThickIn: {
    label: 'U-bolt plate thickness', group: 'wheels', unit: 'in',
    default: 0.375, min: 0.1875, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-10',
  },
  axleYieldPsi: {
    label: 'Axle steel yield strength', group: 'wheels', unit: 'psi',
    default: 50000, min: 30000, max: 120000, step: 1000, status: 'assumed', ref: 'D-4',
    note: '1018 cold-drawn ≈ 54 ksi; 50 ksi used for conservatism.',
  },

  // ── Steering & pull ──────────────────────────────────────────────────────
  steerLockDeg: {
    label: 'Steering lock (each side)', group: 'steering', unit: '°',
    default: 38.5, min: 30, max: 40, step: 0.5, status: 'explore', primary: true, ref: 'D-12',
    note: 'Limited above by the nose width the rider\'s boots need (A-4) and below by the 96" turning radius (A-2).',
  },
  turntableSizeIn: {
    label: 'Turntable bearing size (square)', group: 'steering', unit: 'in',
    default: 12, min: 6, max: 18, step: 1, status: 'assumed', ref: 'D-12',
  },
  turntableThicknessIn: {
    label: 'Turntable bearing stack height', group: 'steering', unit: 'in',
    default: 0.375, min: 0.25, max: 1, step: 0.0625, status: 'verify', ref: 'D-12',
  },
  turntableMassLb: {
    label: 'Turntable bearing mass', group: 'steering', unit: 'lb',
    default: 3.5, min: 1, max: 8, step: 0.25, status: 'verify', ref: 'D-12',
    note: 'Estimate for a 12" lazy-susan plate pair; replace with the catalog value.',
  },
  bolsterRailWidthIn: {
    label: 'Bolster rail width (fore-aft)', group: 'steering', unit: 'in',
    default: 1.5, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-12',
    note: 'Two oak rails fore and aft of the kingpin plus two end rails carry the nose deck on the turntable plate.',
  },
  bolsterMinDepthIn: {
    label: 'Bolster minimum depth', group: 'steering', unit: 'in',
    default: 0.75, min: 0.5, max: 2, step: 0.25, status: 'assumed', ref: 'D-12',
  },
  sideBearerWidthIn: {
    label: 'Side-bearer block width (across)', group: 'steering', unit: 'in',
    default: 1.5, min: 1.5, max: 3, step: 0.25, status: 'assumed', ref: 'D-12',
    note: 'Oak blocks housed in the beam top beside the turntable plate carry the roll moment between the bolster rails and the axle beam (M5).',
  },
  sideBearerLengthIn: {
    label: 'Side-bearer block length (fore-aft)', group: 'steering', unit: 'in',
    default: 1.5, min: 1.5, max: 6, step: 0.25, status: 'assumed', ref: 'D-12',
  },
  sideBearerEmbedIn: {
    label: 'Side-bearer block depth housed in the beam', group: 'steering', unit: 'in',
    default: 0.75, min: 0.25, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-12',
    note: 'The turntable stack is only ~⅜" tall, so the block is let into a mortise in the beam top to get real shear depth.',
  },
  sideBearerSetbackIn: {
    label: 'Wood wall between the axle groove and the side-bearer housing', group: 'steering', unit: 'in',
    default: 0.25, min: 0.125, max: 1, step: 0.125, status: 'assumed', ref: 'D-12',
    note: 'The bearer blocks sit just ahead of the rod groove, in the beam wood between the rod and the beam front face.',
  },
  sideBearerWearIn: {
    label: 'Side-bearer UHMW wear strip thickness', group: 'steering', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-12',
    note: 'UHMW-PE strip on top of the oak block; the bolster rail underside is the chassis-side bearer face.',
  },
  sideBearerClearanceIn: {
    label: 'Side-bearer running clearance', group: 'steering', unit: 'in',
    default: 0.0625, min: 0.03125, max: 0.25, step: 0.03125, status: 'assumed', ref: 'D-12',
  },
  steerStopSizeIn: {
    label: 'Steering stop post size (square)', group: 'steering', unit: 'in',
    default: 1.5, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-12',
    note: 'Oak posts on the turntable plate inside the bolster opening; each turns until it lands flat on the bolster rail face exactly at lock.',
  },
  steerStopHeightIn: {
    label: 'Steering stop post height', group: 'steering', unit: 'in',
    default: 1, min: 0.5, max: 2, step: 0.25, status: 'assumed', ref: 'D-12',
    note: 'Clamped to the bolster depth minus the running clearance.',
  },
  tongueThickIn: {
    label: 'Tongue width (across)', group: 'steering', unit: 'in',
    default: 1, min: 0.75, max: 2, step: 0.25, status: 'assumed', ref: 'D-14',
  },
  tongueDepthIn: {
    label: 'Tongue depth (vertical)', group: 'steering', unit: 'in',
    default: 2.5, min: 1, max: 3.5, step: 0.25, status: 'assumed', ref: 'D-14',
    note: 'Clamped to the front beam depth so the tongue never reaches the turntable.',
  },
  turntableRatingLb: {
    label: 'Turntable load rating', group: 'steering', unit: 'lb',
    default: 1000, min: 1000, max: 2000, step: 50, status: 'locked', ref: 'D-12',
  },
  kingpinLeadIn: {
    label: 'Kingpin ahead of front axle (trail)', group: 'steering', unit: 'in',
    default: 1, min: 0.875, max: 1.5, step: 0.125, status: 'explore', ref: 'D-25',
    note: 'Kingpin must clear the axle rod; the trailing axle self-centres under pull like a caster.',
  },
  kingpinDiameterIn: {
    label: 'Kingpin bolt diameter', group: 'steering', unit: 'in',
    default: 0.5, min: 0.375, max: 0.75, step: 0.0625, status: 'assumed', ref: 'D-12',
  },
  kingpinYieldPsi: {
    label: 'Kingpin bolt yield strength', group: 'steering', unit: 'psi',
    default: 130000, min: 30000, max: 150000, step: 5000, status: 'assumed', ref: 'D-12',
    note: 'SAE grade 8 = 130 ksi. 18-8 stainless ≈ 30–65 ksi depending on temper.',
  },
  drawbar: {
    label: 'Pull attachment', group: 'steering', unit: '',
    default: DRAWBAR.woodTongue, min: 0, max: 1, step: 1, status: 'explore', ref: 'D-14',
    options: [
      { value: DRAWBAR.ropeBridleOnly, label: 'Rope bridle to axle ends' },
      { value: DRAWBAR.woodTongue, label: 'Short oak tongue + bridle' },
    ],
  },
  tongueLengthIn: {
    label: 'Tongue length ahead of front axle', group: 'steering', unit: 'in',
    default: 24, min: 12, max: 48, step: 1, status: 'explore', ref: 'D-14',
  },
  pullerHandHeightIn: {
    label: 'Puller hand height', group: 'steering', unit: 'in',
    default: 30, min: 20, max: 40, step: 1, status: 'assumed', ref: 'D-14',
  },

  // ── Brake & rear handle ──────────────────────────────────────────────────
  brakeType: {
    label: 'Brake type', group: 'brake', unit: '',
    default: BRAKE_TYPE.tireTread, min: 0, max: 1, step: 1, status: 'explore', ref: 'D-13',
    options: [
      { value: BRAKE_TYPE.tireTread, label: 'Shoes on rear tire treads' },
      { value: BRAKE_TYPE.woodDrum, label: 'Band/shoe on wooden drum (live axle)' },
    ],
  },
  brakeLeverRatio: {
    label: 'Brake linkage mechanical advantage', group: 'brake', unit: ':1',
    default: 10, min: 2, max: 14, step: 0.5, status: 'explore', ref: 'D-13',
  },
  brakeShoeThickIn: {
    label: 'Brake shoe radial thickness', group: 'brake', unit: 'in',
    default: 1.5, min: 0.75, max: 3, step: 0.25, status: 'assumed', ref: 'D-13',
  },
  brakeShoeWidthIn: {
    label: 'Brake shoe width (across the tread)', group: 'brake', unit: 'in',
    default: 3, min: 1.5, max: 4, step: 0.25, status: 'assumed', ref: 'D-13',
  },
  brakeShoeLengthIn: {
    label: 'Brake shoe length (along the tread)', group: 'brake', unit: 'in',
    default: 2, min: 1, max: 5, step: 0.25, status: 'assumed', ref: 'D-13',
  },
  brakeShoeAngleDeg: {
    label: 'Brake shoe position above the axle line', group: 'brake', unit: '°',
    default: 45, min: 20, max: 70, step: 5, status: 'assumed', ref: 'D-13',
  },
  brakeDrumDiameterFrac: {
    label: 'Wooden drum diameter ÷ wheel diameter', group: 'brake', unit: '×',
    default: 0.5, min: 0.3, max: 0.7, step: 0.05, status: 'assumed', ref: 'D-13',
    note: 'The drum must stay above the minimum ground clearance (validator warning).',
  },
  brakeDrumWidthIn: {
    label: 'Wooden drum width (along the axle)', group: 'brake', unit: 'in',
    default: 1, min: 0.5, max: 2, step: 0.25, status: 'assumed', ref: 'D-13',
  },
  brakeShaftBehindTireIn: {
    label: 'Brake cross shaft behind the rear tire', group: 'brake', unit: 'in',
    default: 1.5, min: 1, max: 4, step: 0.25, status: 'assumed', ref: 'D-13',
    note: 'The shaft sits this far behind the tread; the rear transom must stay behind it (validator).',
  },
  brakeShaftDiameterIn: {
    label: 'Brake cross shaft diameter', group: 'brake', unit: 'in',
    default: 0.5, min: 0.375, max: 1, step: 0.125, status: 'assumed', ref: 'D-13',
  },
  brakeLeverWidthIn: {
    label: 'Brake lever width (across)', group: 'brake', unit: 'in',
    default: 1.5, min: 1, max: 2.5, step: 0.25, status: 'assumed', ref: 'D-13',
  },
  brakeLeverThickIn: {
    label: 'Brake lever thickness (fore-aft)', group: 'brake', unit: 'in',
    default: 1, min: 0.75, max: 2, step: 0.25, status: 'assumed', ref: 'D-13',
  },
  brakeEfficiency: {
    label: 'Brake linkage efficiency', group: 'brake', unit: '×',
    default: 0.8, min: 0.5, max: 1, step: 0.05, status: 'assumed', ref: 'D-13',
    note: 'Pivot friction and shoe/linkage compliance.',
  },
  brakePadMu: {
    label: 'Shoe-to-tire friction μ (wet, design)', group: 'brake', unit: '',
    default: 0.4, min: 0.2, max: 0.8, step: 0.05, status: 'assumed', ref: 'D-13',
  },
  tireGroundMu: {
    label: 'Tire-to-ground friction μ (design)', group: 'brake', unit: '',
    default: 0.5, min: 0.2, max: 0.9, step: 0.05, status: 'assumed', ref: 'D-16',
    note: 'Damp packed dirt/gravel. Wet leaves can drop to ~0.3.',
  },
  handleForceLimitLbf: {
    label: 'Max brake handle force', group: 'brake', unit: 'lbf',
    default: 30, min: 10, max: 60, step: 1, status: 'locked',
  },
  designSlopeDeg: {
    label: 'Design slope (brake / pitch)', group: 'brake', unit: '°',
    default: 15, min: 0, max: 25, step: 0.5, status: 'locked',
  },
  rearHandleHeightIn: {
    label: 'Rear push-handle grip height', group: 'brake', unit: 'in',
    default: 34, min: 26, max: 42, step: 0.5, status: 'assumed',
    note: 'Adult hip-to-waist height for holding back on descents.',
  },
  handleUprightInsetIn: {
    label: 'Push-handle upright inset from the body edge', group: 'brake', unit: 'in',
    default: 2, min: 0.5, max: 5, step: 0.5, status: 'assumed', ref: 'D-9',
  },
  handleBarDiameterIn: {
    label: 'Push-handle crossbar diameter', group: 'brake', unit: 'in',
    default: 1.25, min: 1, max: 2, step: 0.125, status: 'assumed', ref: 'D-9',
    note: 'Modelled as a square block.',
  },

  // ── Stock thicknesses (finished) ─────────────────────────────────────────
  railThicknessIn: {
    label: 'Frame rail thickness', group: 'stock', unit: 'in',
    default: 0.75, min: 0.5, max: 1.25, step: 0.0625, status: 'explore',
  },
  railDepthIn: {
    label: 'Frame rail depth', group: 'stock', unit: 'in',
    default: 3, min: 1.5, max: 5, step: 0.125, status: 'explore',
  },
  crossmemberDepthIn: {
    label: 'Crossmember / deck joist depth', group: 'stock', unit: 'in',
    default: 1.75, min: 0.75, max: 3.5, step: 0.125, status: 'explore',
  },
  crossmemberThickIn: {
    label: 'Crossmember / deck joist thickness', group: 'stock', unit: 'in',
    default: 0.75, min: 0.5, max: 1.5, step: 0.0625, status: 'explore',
  },
  sideThicknessIn: {
    label: 'Side / gunwale stock thickness', group: 'stock', unit: 'in',
    default: 0.5, min: 0.375, max: 1, step: 0.0625, status: 'explore',
  },
  axleBeamThicknessIn: {
    label: 'Rear axle beam width (fore-aft)', group: 'stock', unit: 'in',
    default: 2.5, min: 1.5, max: 4, step: 0.125, status: 'explore',
  },
  frontAxleBeamThicknessIn: {
    label: 'Front axle beam width (fore-aft)', group: 'stock', unit: 'in',
    default: 3.5, min: 1.5, max: 5, step: 0.125, status: 'explore', ref: 'D-25',
    note: 'Holds the rod groove AND the kingpin hole: needs ≥ lead + rod radius + kingpin radius + 2 × beamLigamentMinIn (H2).',
  },
  axleBeamDepthIn: {
    label: 'Axle beam depth (vertical)', group: 'stock', unit: 'in',
    default: 2.5, min: 1.5, max: 4, step: 0.125, status: 'explore',
  },
  deckPlyIn: {
    label: 'Deck plywood thickness', group: 'stock', unit: 'in',
    default: 0.354, min: 0.236, max: 0.709, step: 0.001, status: 'explore',
    options: [
      { value: 0.236, label: '6 mm' },
      { value: 0.354, label: '9 mm' },
      { value: 0.472, label: '12 mm' },
      { value: 0.709, label: '18 mm' },
    ],
  },
  panelPlyIn: {
    label: 'Bulkhead / box / side-panel plywood', group: 'stock', unit: 'in',
    default: 0.236, min: 0.157, max: 0.472, step: 0.001, status: 'explore',
    options: [
      { value: 0.157, label: '4 mm' },
      { value: 0.236, label: '6 mm' },
      { value: 0.354, label: '9 mm' },
      { value: 0.472, label: '12 mm' },
    ],
  },
  millingAllowanceIn: {
    label: 'Rough-stock allowance (t / w)', group: 'stock', unit: 'in',
    default: 0.125, min: 0, max: 0.5, step: 0.0625, status: 'assumed',
    note: 'Added to thickness and width; length gets 4× this (≈ ½").',
  },

  // ── Material properties ──────────────────────────────────────────────────
  oakDensityPcf: {
    label: 'White oak density @ 12% MC', group: 'materials', unit: 'lb/ft³',
    default: 47, min: 40, max: 52, step: 0.5, status: 'assumed', ref: 'D-4',
  },
  oakMorPsi: {
    label: 'White oak modulus of rupture (clear, 12% MC)', group: 'materials', unit: 'psi',
    default: 15200, min: 8000, max: 16000, step: 100, status: 'assumed', ref: 'D-4',
  },
  oakMoePsi: {
    label: 'White oak modulus of elasticity', group: 'materials', unit: 'psi',
    default: 1780000, min: 1000000, max: 2000000, step: 10000, status: 'assumed', ref: 'D-4',
  },
  oakShearPsi: {
    label: 'White oak shear parallel to grain', group: 'materials', unit: 'psi',
    default: 2000, min: 1000, max: 2200, step: 50, status: 'assumed', ref: 'D-4',
  },
  oakCompParPsi: {
    label: 'White oak compression parallel to grain', group: 'materials', unit: 'psi',
    default: 7440, min: 3500, max: 8000, step: 10, status: 'assumed', ref: 'D-4',
  },
  oakCompPerpPsi: {
    label: 'White oak compression perpendicular (bearing)', group: 'materials', unit: 'psi',
    default: 1070, min: 500, max: 1200, step: 10, status: 'assumed', ref: 'D-4',
    note: 'Governs axle grooves, kingpin bearing and bolt crush.',
  },
  wetServiceFactorStrength: {
    label: 'Wet-service factor on strength', group: 'materials', unit: '×',
    default: 0.85, min: 0.5, max: 1, step: 0.01, status: 'assumed', ref: 'D-4',
  },
  wetServiceFactorStiffness: {
    label: 'Wet-service factor on stiffness', group: 'materials', unit: '×',
    default: 0.9, min: 0.5, max: 1, step: 0.01, status: 'assumed', ref: 'D-4',
  },
  plySpecies: {
    label: 'Plywood', group: 'materials', unit: '',
    default: PLY_SPECIES.okoumeMarine, min: 0, max: 1, step: 1, status: 'explore', ref: 'D-5',
    options: [
      { value: PLY_SPECIES.okoumeMarine, label: 'Okoume marine (BS 1088)' },
      { value: PLY_SPECIES.balticBirchExterior, label: 'Baltic birch, exterior glue' },
    ],
  },
  okoumeDensityPcf: {
    label: 'Okoume marine ply density', group: 'materials', unit: 'lb/ft³',
    default: 33, min: 26, max: 40, step: 0.5, status: 'assumed', ref: 'D-5',
  },
  okoumeMoePsi: {
    label: 'Okoume ply effective E (face grain ∥ span)', group: 'materials', unit: 'psi',
    default: 900000, min: 500000, max: 1300000, step: 10000, status: 'assumed', ref: 'D-5',
  },
  okoumeMorPsi: {
    label: 'Okoume ply effective MOR (face grain ∥ span)', group: 'materials', unit: 'psi',
    default: 5000, min: 3000, max: 8000, step: 100, status: 'assumed', ref: 'D-5',
  },
  birchDensityPcf: {
    label: 'Baltic birch ply density', group: 'materials', unit: 'lb/ft³',
    default: 42, min: 36, max: 46, step: 0.5, status: 'assumed', ref: 'D-5',
  },
  birchMoePsi: {
    label: 'Baltic birch effective E (face grain ∥ span)', group: 'materials', unit: 'psi',
    default: 1300000, min: 800000, max: 1800000, step: 10000, status: 'assumed', ref: 'D-5',
  },
  birchMorPsi: {
    label: 'Baltic birch effective MOR (face grain ∥ span)', group: 'materials', unit: 'psi',
    default: 7000, min: 4000, max: 10000, step: 100, status: 'assumed', ref: 'D-5',
  },
  uhmwDensityPcf: {
    label: 'UHMW-PE density', group: 'materials', unit: 'lb/ft³',
    default: 58.5, min: 55, max: 62, step: 0.5, status: 'assumed',
  },
  steelDensityPcf: {
    label: 'Steel density', group: 'materials', unit: 'lb/ft³',
    default: 490, min: 480, max: 500, step: 1, status: 'locked',
  },
  steelMoePsi: {
    label: 'Steel modulus of elasticity', group: 'materials', unit: 'psi',
    default: 29000000, min: 28000000, max: 30000000, step: 100000, status: 'locked',
  },
  finishLbPerFt2: {
    label: 'Finish mass per ft² of wood surface', group: 'materials', unit: 'lb/ft²',
    default: 0.09, min: 0, max: 0.2, step: 0.005, status: 'assumed', ref: 'D-20',
    note: '2 epoxy coats (~0.03 lb/ft² each) + 3 spar-varnish coats (~0.01 each).',
  },

  // ── Design factors & check limits ────────────────────────────────────────
  dynamicFactor: {
    label: 'Dynamic load factor (bumps, curbs)', group: 'factors', unit: '×',
    default: 3, min: 1, max: 4, step: 0.25, status: 'locked', ref: 'D-2',
  },
  woodSafetyFactor: {
    label: 'Wood material safety factor', group: 'factors', unit: '×',
    default: 2, min: 1, max: 4, step: 0.25, status: 'locked', ref: 'D-2',
  },
  steelSafetyFactor: {
    label: 'Steel safety factor on yield', group: 'factors', unit: '×',
    default: 2, min: 1, max: 4, step: 0.25, status: 'locked', ref: 'D-2',
  },
  targetMassMinLb: {
    label: 'Lightweight-variant mass target, low', group: 'factors', unit: 'lb',
    default: 60, min: 30, max: 100, step: 1, status: 'locked', ref: 'D-21',
    note: 'The full-featured design reports its weight only (D-21).',
  },
  targetMassMaxLb: {
    label: 'Lightweight-variant mass target, high', group: 'factors', unit: 'lb',
    default: 70, min: 30, max: 120, step: 1, status: 'locked', ref: 'D-21',
  },
  tipStraightMinDeg: {
    label: 'Min lateral tip angle, straight (loaded)', group: 'factors', unit: '°',
    default: 40, min: 25, max: 60, step: 1, status: 'locked',
  },
  tipLockMinDeg: {
    label: 'Min lateral tip angle, full lock (loaded)', group: 'factors', unit: '°',
    default: 35, min: 20, max: 60, step: 1, status: 'locked', ref: 'A-3',
  },
  jogSpeedMph: {
    label: 'Running-pull speed for turn check', group: 'factors', unit: 'mph',
    default: 6, min: 2, max: 12, step: 0.5, status: 'locked', ref: 'A-1',
  },
  rolloverSpeedFactor: {
    label: 'Required rollover speed ÷ jog speed', group: 'factors', unit: '×',
    default: 1.5, min: 1, max: 3, step: 0.1, status: 'locked', ref: 'A-1',
    note: 'Reported, not pass/fail (A-1). Pass/fail is SSF ≥ slideMarginFactor × μ.',
  },
  slideMarginFactor: {
    label: 'Required SSF ÷ tire-ground μ (slide before tip)', group: 'factors', unit: '×',
    default: 1.5, min: 1, max: 3, step: 0.1, status: 'locked', ref: 'A-1',
  },
  turnRadiusMaxIn: {
    label: 'Max turning radius (outer front tire)', group: 'factors', unit: 'in',
    default: 96, min: 60, max: 144, step: 1, status: 'locked', ref: 'A-2',
  },
  deflectionLimitRatio: {
    label: 'Static deflection limit L/n', group: 'factors', unit: 'n',
    default: 300, min: 120, max: 600, step: 10, status: 'locked',
  },
  beamLigamentMinIn: {
    label: 'Min wood ligament around axle groove / kingpin hole', group: 'factors', unit: 'in',
    default: 0.75, min: 0.5, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-4',
    note: 'Short-grain wood behind the rod groove and ahead of the kingpin hole carries pull and bump loads in bearing (D-12, D-14).',
  },
  kingpinMargin: {
    label: 'Kingpin / turntable required margin', group: 'factors', unit: '×',
    default: 2, min: 1, max: 4, step: 0.25, status: 'locked',
  },

  // ── Truck bed ────────────────────────────────────────────────────────────
  truckBedLengthIn: {
    label: 'Bed floor length (bulkhead → tailgate)', group: 'truck', unit: 'in',
    default: 60.5, min: 54, max: 80, step: 0.25, status: 'verify', ref: 'Q-1',
  },
  truckTailgateLengthIn: {
    label: 'Tailgate length (down)', group: 'truck', unit: 'in',
    default: 20, min: 14, max: 24, step: 0.25, status: 'verify', ref: 'Q-1',
  },
  truckWellGapIn: {
    label: 'Width between wheel wells', group: 'truck', unit: 'in',
    default: 41.5, min: 36, max: 50, step: 0.25, status: 'verify', ref: 'Q-1',
  },
  truckWellHeightIn: {
    label: 'Wheel-well height above bed floor', group: 'truck', unit: 'in',
    default: 10, min: 6, max: 14, step: 0.25, status: 'verify', ref: 'Q-1',
  },
  truckWellStartIn: {
    label: 'Wheel well front edge, from bulkhead', group: 'truck', unit: 'in',
    default: 18, min: 0, max: 40, step: 0.5, status: 'verify', ref: 'Q-1',
  },
  truckWellLengthIn: {
    label: 'Wheel-well length along bed', group: 'truck', unit: 'in',
    default: 34, min: 20, max: 45, step: 0.5, status: 'verify', ref: 'Q-1',
  },
  truckBedWidthIn: {
    label: 'Bed width wall-to-wall at floor', group: 'truck', unit: 'in',
    default: 57, min: 48, max: 66, step: 0.25, status: 'verify', ref: 'Q-1',
  },
  truckBedDepthIn: {
    label: 'Bed wall height above floor', group: 'truck', unit: 'in',
    default: 18.5, min: 14, max: 24, step: 0.25, status: 'verify', ref: 'Q-1',
  },
  truckLoadHeightIn: {
    label: 'Ground to bed floor / tailgate top', group: 'truck', unit: 'in',
    default: 32, min: 24, max: 40, step: 0.25, status: 'verify', ref: 'Q-1',
  },
  truckCabHeightIn: {
    label: 'Cab back wall height above bed floor', group: 'truck', unit: 'in',
    default: 40, min: 18, max: 60, step: 0.5, status: 'verify', ref: 'Q-1',
    note: 'The bulkhead/cab rear wall stops parts above the bed walls from sliding forward.',
  },
  truckTailgateGapIn: {
    label: 'Hinge gap between bed floor and lowered tailgate', group: 'truck', unit: 'in',
    default: 1, min: 0, max: 3, step: 0.125, status: 'verify', ref: 'Q-1',
    note: 'Tires should not rest in this gap.',
  },
  truckClearanceIn: {
    label: 'Required clearance to bed/wells (incl. liner)', group: 'truck', unit: 'in',
    default: 0.5, min: 0, max: 2, step: 0.125, status: 'assumed', ref: 'D-6',
  },
} satisfies Record<string, ParamDef>;

export const PARAM_DEFS: Record<ParamKey, ParamDef> = defs;
export type ParamKey = keyof typeof defs;
export type Params = Record<ParamKey, number>;

export function defaultParams(): Params {
  const out = {} as Params;
  for (const k of Object.keys(defs) as ParamKey[]) out[k] = defs[k].default;
  return out;
}

/** Clamp to [min, max]; snap option params to the nearest option. */
export function sanitizeParam(key: ParamKey, value: number): number {
  const d: ParamDef = defs[key];
  if (!Number.isFinite(value)) return d.default;
  if (d.options) {
    return d.options.reduce(
      (best, o) => (Math.abs(o.value - value) < Math.abs(best - value) ? o.value : best),
      d.options[0].value,
    );
  }
  return Math.min(d.max, Math.max(d.min, value));
}

export function sanitizeParams(p: Partial<Params>): Params {
  const out = defaultParams();
  for (const k of Object.keys(defs) as ParamKey[]) {
    if (p[k] !== undefined) out[k] = sanitizeParam(k, p[k] as number);
  }
  return out;
}

/** Bolster opening the steering stops live in (kingpin-relative, neutral frame): ring rails around the turntable plate. */
export function bolsterPlan(p: Params) {
  const ts = p.turntableSizeIn;
  const rw = Math.min(p.bolsterRailWidthIn, ts / 2 - 0.25);
  const halfY = ts / 2 + p.sideBearerClearanceIn + p.sideBearerWidthIn;
  return {
    rw,
    halfY,
    /** Inner face of the aft rail (x) and of the fore rail; the end rails' inner faces are at ±openHalfY. */
    aftFaceX: -(ts / 2 - rw),
    foreFaceX: ts / 2 - rw,
    openHalfY: halfY - rw,
  };
}

/**
 * Steering stops (D-12, critic r2 H1): square oak posts on the turntable plate inside the bolster opening. The left
 * post turns aft with +steer and lands flat on the aft bolster rail's inner face exactly at +lock; the right post is the
 * mirror image for −lock. At lock the post is axis-aligned, so its neutral pose is rotated by −lock and centred at
 * R(−lock)·(face + s/2, openHalfY/2). All numbers are kingpin-relative (+x forward). `ok` is false when the posts do
 * not stay inside the opening over the whole sweep or would touch the kingpin.
 */
export function steerStopPlan(p: Params) {
  const b = bolsterPlan(p);
  const s = p.steerStopSizeIn;
  const L = (Math.min(Math.abs(p.steerLockDeg), 60) * Math.PI) / 180;
  const lockX = b.aftFaceX + s / 2;
  const lockY = b.openHalfY / 2;
  const cx = Math.cos(L) * lockX + Math.sin(L) * lockY;
  const cy = -Math.sin(L) * lockX + Math.cos(L) * lockY;
  // Sweep −L..L: every corner of the (rotating) post must stay inside the opening and clear the kingpin.
  const gap = 0.03125;
  let ok = true;
  let why = '';
  const h = s / 2;
  const kpR = p.kingpinDiameterIn / 2;
  const steps = 2 * Math.max(1, Math.round((L * 180) / Math.PI));
  for (let i = 0; i <= steps && ok; i++) {
    const d = -L + (2 * L * i) / steps;
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [qx, qy] of [[-h, -h], [h, -h], [h, h], [-h, h]]) {
      const lx = cx + Math.cos(-L) * qx - Math.sin(-L) * qy;
      const ly = cy + Math.sin(-L) * qx + Math.cos(-L) * qy;
      const x = Math.cos(d) * lx - Math.sin(d) * ly;
      const y = Math.sin(d) * lx + Math.cos(d) * ly;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    // Distance from the kingpin (origin) to the post, in the post's own frame.
    const wx = -(Math.cos(d) * cx - Math.sin(d) * cy);
    const wy = -(Math.sin(d) * cx + Math.cos(d) * cy);
    const a = -(d - L);
    const px = Math.cos(a) * wx - Math.sin(a) * wy;
    const py = Math.sin(a) * wx + Math.cos(a) * wy;
    const kd = Math.hypot(Math.max(Math.abs(px) - h, 0), Math.max(Math.abs(py) - h, 0));
    if (minX < b.aftFaceX - 1e-6) { ok = false; why = 'the post would pass through the aft bolster rail before lock'; }
    else if (maxX > b.foreFaceX - gap) { ok = false; why = 'the post would hit the fore bolster rail when steering the other way'; }
    else if (maxY > b.openHalfY - gap) { ok = false; why = 'the post would hit the bolster end rail'; }
    else if (kd < kpR + gap) { ok = false; why = 'the post would hit the kingpin'; }
  }
  return { ...b, size: s, cx, cy, rotZ: -L, lockX, lockY, ok, why };
}

/** Derived quantities that many modules need; no geometry here. */
export function derived(p: Params) {
  const okoume = p.plySpecies === PLY_SPECIES.okoumeMarine;
  const t = (p.wheelDiameterIn - 10) / 3;
  const wheelMassLb =
    p.wheelMass10Lb + t * (p.wheelMass13Lb - p.wheelMass10Lb) +
    (p.tireType === TIRE_TYPE.flatFree ? p.flatFreeExtraLb : 0);
  // Half-width of a wheel assembly beyond its centre plane: tire, or hub + axle end.
  const wheelOuterHalfIn = Math.max(p.tireWidthIn / 2, p.hubLengthIn / 2 + p.axleEndExtraIn);
  // Front-wheel swing at full lock (A-4): inner tire's rear-inner corner, relative to the kingpin.
  const lk = (p.steerLockDeg * Math.PI) / 180;
  const a = p.frontTrackIn / 2;
  const r = p.wheelDiameterIn / 2;
  // The kingpin leads the axle by `kingpinLeadIn` (D-25), so the tire's rear edge is (lead + r) behind the pivot.
  const swingInnerYIn = (a - p.tireWidthIn / 2) * Math.cos(lk) - (p.kingpinLeadIn + r) * Math.sin(lk);
  const swingRearXIn = (a + p.tireWidthIn / 2) * Math.sin(lk) + (p.kingpinLeadIn + r) * Math.cos(lk);
  // Referenced to the front AXLE: the kingpin is `kingpinLeadIn` ahead of it (D-25), so the rear-most tire corner is
  // swingRear − lead behind the axle (critic r2 M2).
  const swingRearBehindAxleIn = swingRearXIn - p.kingpinLeadIn;
  const rodR = p.axleDiameterIn / 2;
  const kpR = p.kingpinDiameterIn / 2;
  const tongueOnFront = p.drawbar === DRAWBAR.woodTongue ? p.tongueLengthIn : 0;
  return {
    plyDensityPcf: okoume ? p.okoumeDensityPcf : p.birchDensityPcf,
    plyMoePsi: okoume ? p.okoumeMoePsi : p.birchMoePsi,
    plyDesignMorPsi: ((okoume ? p.okoumeMorPsi : p.birchMorPsi) * p.wetServiceFactorStrength) / p.woodSafetyFactor,
    wheelMassLb,
    wheelRadiusIn: p.wheelDiameterIn / 2,
    /** Body length, excluding tongue. */
    bodyLengthIn: p.rearOverhangIn + p.wheelbaseIn + p.frontOverhangIn,
    /** Rear of body to tip of tongue (or body front, whichever is further). */
    overallLengthIn: p.rearOverhangIn + p.wheelbaseIn + Math.max(p.frontOverhangIn, tongueOnFront),
    wheelOuterHalfIn,
    /** Overall width across the wider axle, outside the wheel assemblies. */
    overallWidthIn: Math.max(p.frontTrackIn, p.rearTrackIn) + 2 * wheelOuterHalfIn,
    maxTrackBesideWells: p.truckWellGapIn - 2 * wheelOuterHalfIn - 2 * p.truckClearanceIn,
    /** A-4 (with the D-25 lead): inner tire corner |y| and rear-most tire extent behind the kingpin, at full lock. */
    swingInnerYIn,
    swingRearXIn,
    swingRearBehindAxleIn,
    /** Front beam: centred on the rod + kingpin pair; centre offset from the axle and the wood left beyond each hole edge. */
    frontBeamOffsetIn: (p.kingpinLeadIn + kpR - rodR) / 2,
    frontBeamLigamentIn: (p.frontAxleBeamThicknessIn - p.kingpinLeadIn - rodR - kpR) / 2,
    rearBeamLigamentIn: (p.axleBeamThicknessIn - 2 * rodR) / 2,
    truckUsableLengthIn: p.truckBedLengthIn + p.truckTailgateGapIn + p.truckTailgateLengthIn,
    oakDesignMorPsi: (p.oakMorPsi * p.wetServiceFactorStrength) / p.woodSafetyFactor,
    oakDesignMoePsi: p.oakMoePsi * p.wetServiceFactorStiffness,
    axleAllowablePsi: p.axleYieldPsi / p.steelSafetyFactor,
    /** Vertical load for structural checks: goal rider + cargo (cart self-weight added by the analysis). */
    designPayloadLb: p.riderGoalMassLb + p.cargoMassLb,
  };
}

export interface ParamIssue {
  keys: ParamKey[];
  severity: 'error' | 'warn';
  message: string;
}

/**
 * Cross-parameter sanity rules. Errors mean the geometry is impossible or
 * degenerate; warnings mean a check is likely to fail. The full pass/fail
 * engineering checks live in src/analysis (Phase 2).
 */
export function validateParams(p: Params): ParamIssue[] {
  const issues: ParamIssue[] = [];
  const err = (keys: ParamKey[], message: string) => issues.push({ keys, severity: 'error', message });
  const warn = (keys: ParamKey[], message: string) => issues.push({ keys, severity: 'warn', message });
  const r = p.wheelDiameterIn / 2;

  if (p.riderGoalMassLb < p.riderMassLb)
    err(['riderGoalMassLb', 'riderMassLb'], 'Goal rider is lighter than the operating rider.');
  if (p.targetMassMinLb > p.targetMassMaxLb)
    err(['targetMassMinLb', 'targetMassMaxLb'], 'Mass target low end exceeds high end.');
  if (p.noseWidthIn > p.bodyWidthIn)
    err(['noseWidthIn', 'bodyWidthIn'], 'Nose is wider than the cabin.');
  if (p.noseTaperStartIn > p.wheelbaseIn - p.seatXIn)
    warn(['noseTaperStartIn', 'seatXIn'], 'Nose taper starts behind the seat.');
  const rearInnerTire = p.rearTrackIn / 2 - p.tireWidthIn / 2;
  if (p.bodyWidthIn / 2 + 0.75 > rearInnerTire && p.deckHeightIn < p.wheelDiameterIn)
    err(['bodyWidthIn', 'rearTrackIn'], 'Cabin is too wide to clear the rear tires (needs ≥ ¾" each side).');
  if (p.seatXIn < 0 && p.rearOverhangIn < -p.seatXIn + 6)
    err(['seatXIn', 'rearOverhangIn'], 'Seat hangs off the back of the body.');
  if (p.seatXIn + p.riderLegReachIn > p.wheelbaseIn + p.frontOverhangIn)
    err(['seatXIn', 'riderLegReachIn', 'frontOverhangIn'], 'Rider\'s feet extend past the front of the body.');
  if (p.kingpinLeadIn + p.turntableSizeIn / 2 + p.sideThicknessIn > p.frontOverhangIn)
    err(['kingpinLeadIn', 'turntableSizeIn', 'frontOverhangIn'],
      `The turntable (kingpin at ${p.kingpinLeadIn}" ahead of the axle, ${p.turntableSizeIn}" plate) pokes out of the front of the body; the front overhang must be ≥ ${(p.kingpinLeadIn + p.turntableSizeIn / 2 + p.sideThicknessIn).toFixed(2)}".`);
  // Seat geometry (critic H3): the cushion must end before the shoulder panel, the leaning back must stay inside the rear
  // transom, and a rear storage box needs room between the transom and the seat back.
  const xsShoulder = p.wheelbaseIn - p.noseTaperStartIn;
  const cushionFront = p.seatXIn - p.seatBehindHpointIn + p.seatDepthIn;
  if (cushionFront > xsShoulder - p.panelPlyIn - 0.01)
    err(['seatXIn', 'seatDepthIn', 'noseTaperStartIn', 'wheelbaseIn'],
      `The seat cushion runs into the cabin shoulder (cabin ends ${xsShoulder.toFixed(1)}" ahead of the rear axle; the cushion front is at ${cushionFront.toFixed(1)}"). Move the seat back or shorten it.`);
  const a = (p.seatBackAngleDeg * Math.PI) / 180;
  const backRear = p.seatXIn - p.seatBehindHpointIn - p.seatBackThickIn * Math.cos(a) - p.seatBackHeightIn * Math.sin(a);
  const transomFront = -p.rearOverhangIn + p.sideThicknessIn;
  if (backRear < transomFront + 0.01)
    err(['seatXIn', 'rearOverhangIn', 'seatBackHeightIn', 'seatBackAngleDeg'],
      `The leaning seat back would hit the rear transom (its top reaches ${backRear.toFixed(1)}" from the rear axle; the transom is at ${transomFront.toFixed(1)}").`);
  if (p.storageLocation === STORAGE_LOCATION.rearOverAxle) {
    const room = p.seatXIn - p.seatBehindHpointIn - p.seatBackThickIn * Math.cos(a) - transomFront;
    if (room < MIN_REAR_STORAGE_LENGTH_IN)
      err(['seatXIn', 'rearOverhangIn', 'storageLocation'],
        `Only ${room.toFixed(1)}" between the rear transom and the seat back; a rear storage box needs ≥ ${MIN_REAR_STORAGE_LENGTH_IN}". Move the seat forward or choose another storage location.`);
  }
  // The rider's feet go through the nose to the foot stop.
  const footSpan = (2 * RIDER_LEG_Y_FRAC + RIDER_FOOT_Y_FRAC) * p.riderStatureIn;
  const noseInner = p.noseWidthIn - 2 * p.sideThicknessIn;
  const footNeed = footSpan + 2 * p.bootAllowanceIn + 0.25;
  if (noseInner < footNeed)
    err(['noseWidthIn', 'riderStatureIn', 'bootAllowanceIn'],
      `The nose is ${noseInner.toFixed(1)}" wide inside; the rider's feet need ≥ ${footNeed.toFixed(1)}" at this stature (feet ${footSpan.toFixed(1)}" + ${p.bootAllowanceIn}" boot allowance per side + ¼" play).`);
  if (p.truckWellStartIn + p.truckWellLengthIn > p.truckBedLengthIn)
    err(['truckWellStartIn', 'truckWellLengthIn', 'truckBedLengthIn'], 'Wheel wells extend past the bed.');
  if (p.truckWellGapIn > p.truckBedWidthIn)
    err(['truckWellGapIn', 'truckBedWidthIn'], 'Wheel-well gap is wider than the bed.');
  if (p.axleStyle === AXLE_STYLE.stubAxles && p.axleBeamDepthIn < 2.5)
    warn(['axleStyle', 'axleBeamDepthIn'], 'Stub axles need a deeper beam (≥ 2½") to resist the cantilever moment.');
  if (p.brakeType === BRAKE_TYPE.woodDrum && p.axleStyle === AXLE_STYLE.stubAxles)
    err(['brakeType', 'axleStyle'], 'A wooden drum brake needs a live through-axle.');

  // Vertical stack at the axles (D-15).
  const beamBottom =
    p.axleBeamPosition === AXLE_BEAM_POSITION.underslung
      ? r + p.axleDiameterIn / 2 - p.axleBeamDepthIn
      : r - p.axleDiameterIn / 2;
  if (beamBottom < p.minGroundClearanceIn)
    warn(['axleBeamDepthIn', 'axleBeamPosition', 'minGroundClearanceIn'],
      `Axle beam bottom at ${beamBottom.toFixed(2)}" is below the ${p.minGroundClearanceIn}" ground clearance.`);
  const beamTop = beamBottom + p.axleBeamDepthIn;
  // The bolster must fit between the turntable top and the nose deck underside (the model would otherwise poke through the deck).
  const frontDeckBot = p.deckHeightIn + p.frontDeckRaiseIn - p.deckPlyIn;
  if (beamTop + p.turntableThicknessIn + p.bolsterMinDepthIn > frontDeckBot + 0.01)
    err(['deckHeightIn', 'frontDeckRaiseIn', 'axleBeamPosition', 'axleBeamDepthIn', 'turntableThicknessIn', 'bolsterMinDepthIn'],
      `Front axle beam + turntable + ${p.bolsterMinDepthIn}" bolster needs the nose deck underside at ≥ ${(beamTop + p.turntableThicknessIn + p.bolsterMinDepthIn).toFixed(2)}"; it is ${frontDeckBot.toFixed(2)}". Raise the deck or the forward deck raise, or use an underslung beam.`);
  const frontStackTop = beamTop + p.turntableThicknessIn + p.crossmemberDepthIn + p.deckPlyIn;
  const frontDeck = p.deckHeightIn + p.frontDeckRaiseIn;
  if (frontStackTop > frontDeck + 0.01)
    warn(['deckHeightIn', 'frontDeckRaiseIn', 'axleBeamDepthIn', 'turntableThicknessIn'],
      `Front axle stack (beam + turntable + crossmember + ply) needs the deck at ≥ ${frontStackTop.toFixed(2)}" over the front axle; it is ${frontDeck.toFixed(2)}".`);
  const rearStackTop = beamTop + p.deckPlyIn;
  if (rearStackTop > p.deckHeightIn + 0.01)
    err(['deckHeightIn', 'axleBeamDepthIn'],
      `Rear axle beam + ply needs the deck at ≥ ${rearStackTop.toFixed(2)}"; it is ${p.deckHeightIn}".`);
  if (p.brakeType === BRAKE_TYPE.woodDrum) {
    const drumBottom = r - (p.wheelDiameterIn * p.brakeDrumDiameterFrac) / 2;
    if (drumBottom < p.minGroundClearanceIn)
      warn(['brakeDrumDiameterFrac', 'minGroundClearanceIn'],
        `Brake drum bottom at ${drumBottom.toFixed(2)}" is below the ${p.minGroundClearanceIn}" ground clearance.`);
  }
  // Front-wheel swing at full lock (A-4). Only matters if the tire reaches up to the hull.
  const d = derived(p);
  if (p.wheelDiameterIn > p.deckHeightIn + p.frontDeckRaiseIn - p.deckPlyIn - p.crossmemberDepthIn) {
    const allowedHalf = d.swingInnerYIn - p.steeringClearanceIn;
    if (p.noseWidthIn / 2 > allowedHalf)
      err(['noseWidthIn', 'steerLockDeg', 'frontTrackIn'],
        `Front tires hit the nose at full lock: nose must be ≤ ${(2 * allowedHalf).toFixed(2)}" wide (is ${p.noseWidthIn}").`);
    // swingRearXIn is kingpin-referenced; the shoulder (noseTaperStartIn) is axle-referenced, so subtract the lead (M2).
    const neededTaper = d.swingRearBehindAxleIn + p.steeringClearanceIn;
    if (p.noseTaperStartIn < neededTaper)
      err(['noseTaperStartIn', 'steerLockDeg', 'kingpinLeadIn'],
        `Front tires hit the cabin shoulder at full lock: full width must end ≥ ${neededTaper.toFixed(2)}" behind the front axle (is ${p.noseTaperStartIn}").`);
  }

  // Axle beams (critic r2 H2): wood left behind the rod groove and ahead of the kingpin hole must be real wood.
  if (d.frontBeamLigamentIn < p.beamLigamentMinIn - 1e-9)
    err(['frontAxleBeamThicknessIn', 'kingpinLeadIn', 'beamLigamentMinIn'],
      `Front axle beam is ${p.frontAxleBeamThicknessIn}" wide: with the rod groove and the kingpin hole (${p.kingpinLeadIn}" apart) only ${d.frontBeamLigamentIn.toFixed(2)}" of wood is left behind the rod and ahead of the kingpin; it needs ≥ ${p.beamLigamentMinIn}" (width ≥ ${(p.kingpinLeadIn + p.axleDiameterIn / 2 + p.kingpinDiameterIn / 2 + 2 * p.beamLigamentMinIn).toFixed(2)}").`);
  if (d.rearBeamLigamentIn < p.beamLigamentMinIn - 1e-9)
    err(['axleBeamThicknessIn', 'beamLigamentMinIn'],
      `Rear axle beam is ${p.axleBeamThicknessIn}" wide: only ${d.rearBeamLigamentIn.toFixed(2)}" of wood is left each side of the rod groove; it needs ≥ ${p.beamLigamentMinIn}".`);
  // Side bearers sit in the beam wood just ahead of the rod groove.
  const bearerEnd = p.axleDiameterIn / 2 + p.sideBearerSetbackIn + p.sideBearerLengthIn;
  const beamFrontFromAxle = d.frontBeamOffsetIn + p.frontAxleBeamThicknessIn / 2;
  if (bearerEnd > beamFrontFromAxle + 1e-9)
    err(['sideBearerLengthIn', 'sideBearerSetbackIn', 'frontAxleBeamThicknessIn'],
      `The ${p.sideBearerLengthIn}" side-bearer block does not fit between the rod groove and the beam's front face (needs the beam front ≥ ${bearerEnd.toFixed(2)}" ahead of the axle; is ${beamFrontFromAxle.toFixed(2)}").`);
  if (p.sideBearerEmbedIn > p.axleBeamDepthIn - p.beamLigamentMinIn)
    err(['sideBearerEmbedIn', 'axleBeamDepthIn'], 'The side-bearer housing is too deep for the axle beam.');

  // Front transom hangs below the nose deck; the swinging turntable corners and the tongue pass under it (critic r2 M3).
  const transomBottom = p.deckHeightIn + p.frontDeckRaiseIn - p.crossmemberDepthIn;
  const turntableTop = beamTop + p.turntableThicknessIn;
  if (transomBottom < turntableTop - 0.01)
    err(['deckHeightIn', 'frontDeckRaiseIn', 'crossmemberDepthIn', 'turntableThicknessIn'],
      `The front transom hangs to ${transomBottom.toFixed(2)}", below the top of the turntable (${turntableTop.toFixed(2)}") and the tongue; raise the nose deck to ≥ ${(turntableTop + p.crossmemberDepthIn).toFixed(2)}".`);

  // Rear U-bolt plates sit at the beam ends; the rails/girders above must stay inboard of them (critic r2 M3).
  {
    const under = p.axleBeamPosition === AXLE_BEAM_POSITION.underslung;
    const clampLo = under ? beamTop : beamBottom - p.clampPlateThickIn;
    const clampHi = under ? beamTop + p.clampPlateThickIn : beamBottom;
    const railBot = p.deckHeightIn - p.deckPlyIn - p.railDepthIn;
    const railTop = p.deckHeightIn - p.deckPlyIn;
    if ((railBot < clampHi - 0.01 && railTop > clampLo + 0.01) || p.deckHeightIn - p.deckPlyIn < clampHi - 0.01) {
      const beamLen = Math.max(1, p.rearTrackIn - p.hubLengthIn - 0.25);
      const clampInner = Math.min(beamLen / 2 - 0.25, p.rearTrackIn / 2 - p.tireWidthIn / 2) - p.clampPlateWidthIn;
      // The side panels / girders (outer face at bodyWidth/2) also reach the plates when the deck underside is that low.
      const sideLow = p.deckHeightIn - p.deckPlyIn < clampHi - 0.01;
      const railOuter = p.bodyWidthIn / 2 - (p.frameStyle === FRAME_STYLE.ladder && !sideLow ? p.sideThicknessIn : 0);
      if (railOuter > clampInner + 1e-6)
        err(['bodyWidthIn', 'rearTrackIn', 'clampPlateWidthIn'],
          `The cabin rails/sides reach ${railOuter.toFixed(2)}" off centre but the rear U-bolt plates start at ${clampInner.toFixed(2)}"; narrow the body or widen the track.`);
    }
  }

  // The brake cross shaft runs behind the rear tire and must stay in front of the rear transom (and the push handle behind it).
  const shaftBack = r + p.brakeShaftBehindTireIn + p.brakeShaftDiameterIn / 2;
  if (p.rearOverhangIn < shaftBack + p.sideThicknessIn)
    err(['rearOverhangIn', 'brakeShaftBehindTireIn', 'wheelDiameterIn'],
      `The brake cross shaft reaches ${shaftBack.toFixed(2)}" behind the rear axle, into the rear transom; the rear overhang must be ≥ ${(shaftBack + p.sideThicknessIn).toFixed(2)}".`);

  // Steering stops live inside the bolster opening (H1).
  const stop = steerStopPlan(p);
  if (!stop.ok)
    err(['steerStopSizeIn', 'turntableSizeIn', 'bolsterRailWidthIn', 'steerLockDeg'],
      `Steering stop posts do not fit the bolster opening over the ±${p.steerLockDeg}° sweep: ${stop.why}.`);

  // Truck.
  if (d.overallWidthIn + 2 * p.truckClearanceIn > p.truckWellGapIn)
    warn(['rearTrackIn', 'frontTrackIn'],
      `Overall width ${d.overallWidthIn.toFixed(2)}" does not fit between the wheel wells with clearance (max track ${d.maxTrackBesideWells.toFixed(2)}"); only "straddle" stowage would work (D-6).`);
  if (d.bodyLengthIn > d.truckUsableLengthIn - p.truckClearanceIn)
    err(['wheelbaseIn', 'rearOverhangIn', 'frontOverhangIn'], 'Body is longer than bed + tailgate.');
  return issues;
}
