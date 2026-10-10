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
    default: 14, min: 8, max: 30, step: 0.25, status: 'explore', ref: 'D-15',
    note: 'Must be ≤ 2 × (inner tire corner y at full lock − steering clearance); see A-4.',
  },
  noseTaperStartIn: {
    label: 'Nose taper starts this far behind front axle', group: 'body', unit: 'in',
    default: 18.5, min: 0, max: 30, step: 0.5, status: 'explore', ref: 'A-4',
    note: 'Full-width cabin must end behind the rear-most tire corner at full lock + steering clearance (A-4).',
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

  // ── Seat & rider position ────────────────────────────────────────────────
  seatXIn: {
    label: 'Seat H-point ahead of rear axle', group: 'seat', unit: 'in',
    default: 12, min: -4, max: 36, step: 0.5, status: 'explore', primary: true,
    note: 'Forward → more front load, better lock stability; aft → more rear-brake traction.',
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
  axleYieldPsi: {
    label: 'Axle steel yield strength', group: 'wheels', unit: 'psi',
    default: 50000, min: 30000, max: 120000, step: 1000, status: 'assumed', ref: 'D-4',
    note: '1018 cold-drawn ≈ 54 ksi; 50 ksi used for conservatism.',
  },

  // ── Steering & pull ──────────────────────────────────────────────────────
  steerLockDeg: {
    label: 'Steering lock (each side)', group: 'steering', unit: '°',
    default: 40, min: 20, max: 50, step: 1, status: 'explore', primary: true, ref: 'D-12',
  },
  turntableSizeIn: {
    label: 'Turntable bearing size (square)', group: 'steering', unit: 'in',
    default: 12, min: 6, max: 18, step: 1, status: 'assumed', ref: 'D-12',
  },
  turntableThicknessIn: {
    label: 'Turntable bearing stack height', group: 'steering', unit: 'in',
    default: 0.375, min: 0.25, max: 1, step: 0.0625, status: 'verify', ref: 'D-12',
  },
  turntableRatingLb: {
    label: 'Turntable load rating', group: 'steering', unit: 'lb',
    default: 1000, min: 1000, max: 2000, step: 50, status: 'locked', ref: 'D-12',
  },
  kingpinLeadIn: {
    label: 'Kingpin ahead of front axle (trail)', group: 'steering', unit: 'in',
    default: 1.25, min: 0.875, max: 4, step: 0.125, status: 'explore', ref: 'D-25',
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
    label: 'Tongue length ahead of kingpin', group: 'steering', unit: 'in',
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
  sideThicknessIn: {
    label: 'Side / gunwale stock thickness', group: 'stock', unit: 'in',
    default: 0.5, min: 0.375, max: 1, step: 0.0625, status: 'explore',
  },
  axleBeamThicknessIn: {
    label: 'Axle beam width (fore-aft)', group: 'stock', unit: 'in',
    default: 2.5, min: 1.5, max: 4, step: 0.125, status: 'explore',
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
  const swingInnerYIn = (a - p.tireWidthIn / 2) * Math.cos(lk) - r * Math.sin(lk);
  const swingRearXIn = (a + p.tireWidthIn / 2) * Math.sin(lk) + r * Math.cos(lk);
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
    /** A-4: inner tire corner |y| and rear-most tire extent behind the kingpin, at full lock. */
    swingInnerYIn,
    swingRearXIn,
    truckUsableLengthIn: p.truckBedLengthIn + p.truckTailgateLengthIn,
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
  const frontStackTop = beamTop + p.turntableThicknessIn + p.crossmemberDepthIn + p.deckPlyIn;
  const frontDeck = p.deckHeightIn + p.frontDeckRaiseIn;
  if (frontStackTop > frontDeck + 0.01)
    warn(['deckHeightIn', 'frontDeckRaiseIn', 'axleBeamDepthIn', 'turntableThicknessIn'],
      `Front axle stack (beam + turntable + crossmember + ply) needs the deck at ≥ ${frontStackTop.toFixed(2)}" over the front axle; it is ${frontDeck.toFixed(2)}".`);
  const rearStackTop = beamTop + p.deckPlyIn;
  if (rearStackTop > p.deckHeightIn + 0.01)
    warn(['deckHeightIn', 'axleBeamDepthIn'],
      `Rear axle beam + ply needs the deck at ≥ ${rearStackTop.toFixed(2)}"; it is ${p.deckHeightIn}".`);
  // Front-wheel swing at full lock (A-4). Only matters if the tire reaches up to the hull.
  const d = derived(p);
  if (p.wheelDiameterIn > p.deckHeightIn + p.frontDeckRaiseIn - p.deckPlyIn - p.crossmemberDepthIn) {
    const allowedHalf = d.swingInnerYIn - p.steeringClearanceIn;
    if (p.noseWidthIn / 2 > allowedHalf)
      err(['noseWidthIn', 'steerLockDeg', 'frontTrackIn'],
        `Front tires hit the nose at full lock: nose must be ≤ ${(2 * allowedHalf).toFixed(2)}" wide (is ${p.noseWidthIn}").`);
    const neededTaper = d.swingRearXIn + p.steeringClearanceIn;
    if (p.noseTaperStartIn < neededTaper)
      err(['noseTaperStartIn', 'steerLockDeg'],
        `Front tires hit the cabin shoulder at full lock: full width must end ≥ ${neededTaper.toFixed(2)}" behind the front axle (is ${p.noseTaperStartIn}").`);
  }

  // Truck.
  if (d.overallWidthIn + 2 * p.truckClearanceIn > p.truckWellGapIn)
    warn(['rearTrackIn', 'frontTrackIn'],
      `Overall width ${d.overallWidthIn.toFixed(2)}" does not fit between the wheel wells with clearance (max track ${d.maxTrackBesideWells.toFixed(2)}"); only "straddle" stowage would work (D-6).`);
  if (d.bodyLengthIn > d.truckUsableLengthIn - p.truckClearanceIn)
    err(['wheelbaseIn', 'rearOverhangIn', 'frontOverhangIn'], 'Body is longer than bed + tailgate.');
  return issues;
}
