/**
 * Single source of truth for every design variable.
 *
 * Units: inches, pounds (mass = lb, force = lbf), degrees, lb/ft³, psi.
 * Model frame: +X forward (toward the bridle), +Y left, +Z up. Origin is on the
 * ground directly below the rear-axle center, midway between the rear wheels.
 *
 * `status` records how confident we are in a default:
 *   locked  – fixed by the brief, the event rules, or Eric
 *   verify  – placeholder that Eric needs to measure/confirm
 *   assumed – engineering assumption (cited by `ref` in DECISIONS.md)
 *   explore – design variable that Phase 2 optimizes
 *
 * View-only state (e.g. the displayed swivel angle) does NOT live here; it is
 * passed to buildModel() separately so it never pollutes the design.
 */


export type ParamStatus = 'locked' | 'verify' | 'assumed' | 'explore';

export type ParamGroup =
  | 'loads'
  | 'cargo'
  | 'layout'
  | 'body'
  | 'seat'
  | 'wheels'
  | 'steering'
  | 'brake'
  | 'stock'
  | 'materials'
  | 'factors'
  | 'bump'
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
  cargo: 'Cargo mode (hauling after the race)',
  layout: 'Overall layout',
  body: 'Body / hull',
  seat: 'Seat & rider position',
  wheels: 'Wheels & axles',
  steering: 'Front end (pivot axle) & bridle',
  brake: 'Brake & rear handle',
  stock: 'Stock thicknesses',
  materials: 'Material properties',
  factors: 'Design factors & check limits',
  bump: 'Bump loads (walking and jogging pace)',
  truck: 'Truck bed (2007 Tacoma short bed)',
};

// Enumerations stored as numbers so every param is a plain number (C-3).
export const AXLE_STYLE = { throughRod: 0, stubAxles: 1 } as const;
export const AXLE_BEAM_POSITION = { underslung: 0, overslung: 1 } as const;
export const TIRE_TYPE = { pneumatic: 0, flatFree: 1 } as const;
export const PLY_SPECIES = { okoumeMarine: 0, balticBirchExterior: 1 } as const;
export const STORAGE_LOCATION = { rearOverAxle: 0, underSeat: 2 } as const;

/** Mannequin proportions (fractions of stature, D-3) that the foot-room validator also needs: hip separation and foot width. */
/** Solid-spring rule of thumb (D-57): a member bent from solid stock needs an inside radius of at least this many times its thickness. */
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
    default: 150, min: 50, max: 250, step: 5, status: 'locked', primary: true, ref: 'D-1',
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
    default: 32, min: 24, max: 44, step: 0.5, status: 'assumed', ref: 'D-3, D-53, D-54',
    note: 'Knees bent a little more than a straight reach on a low seat; ≈ 0.48 × stature. 32.5 in (was 36): the seat moved 3.5 in forward (D-53, so the seat kit lies flat in the storage box) and the foot stop stays where it was, so the nose, the cleats and the steering do not change.',
  },
  bootAllowanceIn: {
    label: 'Boot allowance per side (foot room)', group: 'loads', unit: 'in',
    default: 0.5, min: 0, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-3',
    note: 'Winter boots add about ½" per boot to the foot span the body must hold inside (critic Phase 1 r2, M4).',
  },
  cargoMassLb: {
    label: 'Cargo (10 Essentials + team gear)', group: 'loads', unit: 'lb',
    default: 25, min: 0, max: 60, step: 1, status: 'locked',
  },
  // ── Cargo mode (Phase 3c-2, D-53): the seat stows in the box and the cart hauls gear, firewood and water ──
  cargoPayloadLb: {
    label: 'Cargo payload after the race', group: 'cargo', unit: 'lb',
    default: 250, min: 0, max: 600, step: 25, status: 'assumed', primary: true, ref: 'D-53',
    note: 'Confirm with Eric. Camp gear, firewood and water (reference/04): a uniform load over the bed, seat stowed, no rider. Carried at a high center of gravity (cargoCgHeightIn). The cargo case runs next to the rider cases and never changes the rider range.',
  },
  cargoConcentratedLb: {
    label: 'Concentrated cargo item (jug pair or cooler)', group: 'cargo', unit: 'lb',
    default: 90, min: 20, max: 200, step: 5, status: 'assumed', ref: 'D-53',
    note: 'Two full 5-gal water jugs (about 42 lb each) or a loaded cooler on a small footprint (deck, joists). Never more than the payload.',
  },
  cargoPatchAlongIn: {
    label: 'Concentrated item footprint, fore-aft', group: 'cargo', unit: 'in',
    default: 12, min: 6, max: 24, step: 1, status: 'assumed', ref: 'D-53',
    note: 'A 5-gal jug is about 11.5 in across.',
  },
  cargoPatchAcrossIn: {
    label: 'Concentrated item footprint, across', group: 'cargo', unit: 'in',
    default: 12, min: 6, max: 24, step: 1, status: 'assumed', ref: 'D-53',
  },
  cargoCgHeightIn: {
    label: 'Cargo center of gravity above the deck', group: 'cargo', unit: 'in',
    default: 12, min: 3, max: 24, step: 1, status: 'assumed', ref: 'D-53',
    note: 'A tall strapped load (coolers on firewood, duffels above the 7 in gunwale): 5 in above the gunwale. Drives tipping, the rear-only brake hold and pitch.',
  },
  cargoCgOffsetYIn: {
    label: 'Cargo center of gravity off the centerline', group: 'cargo', unit: 'in',
    default: 3, min: 0, max: 8, step: 0.5, status: 'assumed', ref: 'D-53',
    note: 'A lopsided load. Applied to the tipping and wheel-share rows (worst side).',
  },
  cargoLoadWidthIn: {
    label: 'Width of the payload block', group: 'cargo', unit: 'in',
    default: 20, min: 10, max: 26, step: 1, status: 'assumed', ref: 'D-53',
    note: 'The straight-sided body is 22.75 in clear inside all the way (D-54), so the payload can sit anywhere on the bed if it is no wider than this. A cooler or a duffel is 16 to 24 in.',
  },
  cargoLoadLengthIn: {
    label: 'Length of bed the payload occupies', group: 'cargo', unit: 'in',
    default: 16, min: 8, max: 28, step: 1, status: 'assumed', ref: 'D-53',
    note: 'Sets how far fore or aft the cargo center can sit: the payload is checked piled against the box (aft) and against the nose end of the bed where it is still cargoLoadWidthIn wide (fore).',
  },
  cargoLidLoadLb: {
    label: 'Load the storage lid is rated to carry', group: 'cargo', unit: 'lb',
    default: 40, min: 0, max: 150, step: 5, status: 'assumed', ref: 'D-53',
    note: 'A light cooler or a duffel on the box lid on the concentrated footprint. Heavy items go on the floor of the bed, not on the lid.',
  },
  cargoRestraintG: {
    label: 'Cargo restraint deceleration', group: 'cargo', unit: 'g',
    default: 0.8, min: 0.3, max: 1.5, step: 0.1, status: 'assumed', ref: 'D-53',
    note: 'Forward restraint a strapped load must resist (US DOT cargo securement uses 0.8 g forward, 0.5 g rearward and sideways).',
  },
  cargoStrapMu: {
    label: 'Cargo to deck friction', group: 'cargo', unit: '',
    default: 0.3, min: 0.1, max: 0.6, step: 0.05, status: 'assumed', ref: 'D-53',
    note: 'Wet cargo on a sealed deck. The straps supply the rest of the restraint.',
  },
  cargoStrapWllLbf: {
    label: 'Cargo strap working load (each)', group: 'cargo', unit: 'lbf',
    default: 500, min: 100, max: 1500, step: 50, status: 'assumed', ref: 'D-53, D-41',
    note: '1 in cam-buckle tie-down strap, 500 lbf working load (1,500 lbf break). The D-ring plate end is rated by lashLoadLbf.',
  },
  riderMinMassLb: {
    label: 'Lightest rider mass (pitch-back case)', group: 'loads', unit: 'lb',
    default: 80, min: 40, max: 150, step: 5, status: 'assumed', ref: 'D-1',
    note: 'BRIEF §4.1: scouts run 80–150 lb. Rows that get worse with a lighter rider (rearward pitch) are also evaluated here (critic Phase 2 r1, H3).',
  },
  pullForceLbf: {
    label: 'Design bridle pull (peak)', group: 'loads', unit: 'lbf',
    default: 150, min: 50, max: 400, step: 10, status: 'assumed', ref: 'D-14',
    note: '4–6 scouts surging; steady pull on the flat is only ~20–30 lbf.',
  },

  // ── Overall layout ───────────────────────────────────────────────────────
  wheelbaseIn: {
    label: 'Wheelbase (axle to axle)', group: 'layout', unit: 'in',
    default: 44, min: 36, max: 64, step: 0.5, status: 'explore', primary: true,
  },
  rearTrackIn: {
    label: 'Rear track (wheel center to center)', group: 'layout', unit: 'in',
    default: 35.5, min: 26, max: 52, step: 0.25, status: 'explore', primary: true, ref: 'D-6',
    note: 'Wheels beside the wheel wells: track + outer width (tire or hub + axle end) + 2 × clearance ≤ well gap → 35.5". Wider only with "straddle" stowage.',
  },
  rearOverhangIn: {
    label: 'Body overhang behind rear axle', group: 'layout', unit: 'in',
    default: 10, min: 0, max: 18, step: 0.5, status: 'explore',
    note: 'Rear-handle sockets, the brake latch hook, and (by default) the storage box over the rear axle. The brake pedal bar sits a further 4 in or so behind it (D-55).',
  },
  frontOverhangIn: {
    label: 'Body overhang ahead of the front axle (to the bow tip)', group: 'layout', unit: 'in',
    default: 12, min: 6, max: 20, step: 0.5, status: 'explore', ref: 'D-54',
    note: 'The flat deck ends where the bow curl starts (the curl radius and angle below), and the foot stop must stand on the flat deck, so this must reach past the foot stop by the curl length. Wheelbase is rear axle to the front (placeholder) axle.',
  },
  deckHeightIn: {
    label: 'Deck (floor top) height, between axles', group: 'layout', unit: 'in',
    default: 8, min: 6, max: 18, step: 0.25, status: 'explore', primary: true, ref: 'D-15, D-56',
    note: 'D-56: 8 in, set by the front pivot stack (axle beam top 5.4 in + the tongue plate + the UHMW thrust washer + a king beam about 1.7 in deep, validateParams) with the 10 in wheels beside the body. The rear beam stack (beam top + ply) and the foot brake allow a little lower.',
  },
  minGroundClearanceIn: {
    label: 'Minimum ground clearance', group: 'layout', unit: 'in',
    default: 3, min: 2, max: 6, step: 0.25, status: 'assumed', ref: 'D-16, D-54',
    note: 'Lowest point (axle beams, brake shoe) vs roots and trail crowns.',
  },

  // ── Body / hull ──────────────────────────────────────────────────────────
  bodyWidthIn: {
    label: 'Body outside width', group: 'body', unit: 'in',
    default: 24, min: 18, max: 36, step: 0.25, status: 'explore', primary: true, ref: 'D-54',
    note: 'Straight parallel sides all the way (D-54). The wheels of both axles run beside the body (the front end is provisional).',
  },
  sideHeightBowIn: {
    label: 'Side height at the bow (above the deck)', group: 'body', unit: 'in',
    default: 4, min: 2, max: 8, step: 0.25, status: 'explore', primary: true, ref: 'D-54',
    note: 'Sled side profile (reference/05): low at the bow, rising in a straight line to the rear (sideHeightRearIn). Where the sides end against the bow curl.',
  },
  sideHeightRearIn: {
    label: 'Side height at the rear (above the deck)', group: 'body', unit: 'in',
    default: 16, min: 8, max: 24, step: 0.5, status: 'explore', primary: true, ref: 'D-54',
    note: 'The storage box and the seat back stand in the tall rear section; the rear transom follows this height.',
  },
  sideProfileSagIn: {
    label: 'Side profile sag below the straight line (mid-length)', group: 'body', unit: 'in',
    default: 0, min: -2, max: 3, step: 0.25, status: 'explore', ref: 'D-54',
    note: 'Optional gentle curve: the gunwale dips this far below the straight line from the rear to the bow at mid-length (a parabola; negative = bulges up). 0 = the straight line.',
  },
  bowCurlRadiusIn: {
    label: 'Bow curl radius (centerline)', group: 'body', unit: 'in',
    default: 7, min: 4, max: 14, step: 0.5, status: 'assumed', ref: 'D-54',
    note: 'The curled bow (D-54): a bent-lamination panel that runs on from the deck and curls up on this radius, replacing the front transom. validateParams() checks the inside radius against the cold-bend limit (hullLamMinRadiusFactor x one ply).',
  },
  bowCurlAngleDeg: {
    label: 'Bow curl angle', group: 'body', unit: '°',
    default: 80, min: 45, max: 90, step: 5, status: 'assumed', ref: 'D-54',
    note: 'How far the curl turns up from the flat deck (90 = vertical at the tip).',
  },
  bowCurlPlyIn: {
    label: 'Bow curl ply thickness (each)', group: 'body', unit: 'in',
    default: 0.118, min: 0.059, max: 0.236, step: 0.001, status: 'assumed', ref: 'D-54',
    note: '3 mm okoume bending ply (or 1/8 in oak veneer-core sheet). The curl is this many plies epoxied on a form.',
  },
  bowCurlPlies: {
    label: 'Bow curl plies', group: 'body', unit: '',
    default: 4, min: 2, max: 8, step: 1, status: 'assumed', ref: 'D-54',
    note: '4 x 3 mm = 12 mm: the same thickness as the deck, which it is scarfed to (8:1) at the tangent point.',
  },
  showSideSigns: {
    label: 'Show the side signs', group: 'body', unit: '',
    default: 0, min: 0, max: 1, step: 1, status: 'assumed', ref: 'D-54',
    options: [{ value: 0, label: 'Off (provisional)' }, { value: 1, label: 'On (provisional placement)' }],
    note: 'Eric: design the shape first, then decide where a sign fits. Off by default; when on, the blank is a provisional flat panel on the side web, and nothing in the body is sized to it.',
  },
  hullLamMinRadiusFactor: {
    label: 'Min. bend radius / ply thickness', group: 'body', unit: '×',
    default: 40, min: 20, max: 100, step: 5, status: 'assumed', ref: 'D-45, D-54',
    note: 'Okoume bending ply lays up cold without steaming above this ratio; the validator flags a bow curl whose inside radius is tighter than this times one ply.',
  },
  deckSlopIn: {
    label: 'Deck rabbet / dado clearance over the ply', group: 'body', unit: 'in',
    default: 0.04, min: 0, max: 0.08, step: 0.004, status: 'assumed', ref: 'D-45',
    note: 'The deck rabbet in the chine and the dado in each transom are cut this much taller than the (epoxy-sealed) deck so the sealed panel enters its own rabbet; thickened epoxy fills the gap (build review MUST-2).',
  },

  railBandIn: {
    label: 'Chine / gunwale height', group: 'body', unit: 'in',
    default: 1.5, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-22',
    note: 'Oak chine and gunwale section height; the side panel is captured between them.',
  },
  // ── Hull detail: captured ply, joinery, lift handles, finger guard, signs (Phase 3 workstream B, D-35…D-37) ──
  grooveDepthIn: {
    label: 'Side-panel groove depth (chine / gunwale)', group: 'body', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-35',
    note: 'The okoume web enters a groove this deep in the chine (top) and the gunwale (underside); the groove follows the flare tilt.',
  },
  grooveSlopIn: {
    label: 'Groove width over the ply thickness', group: 'body', unit: 'in',
    default: 0.04, min: 0, max: 0.06, step: 0.004, status: 'assumed', ref: 'D-35, D-43',
    note: 'Cut the groove at the MEASURED ply thickness + about 1 mm (D-43): real 6 mm okoume runs 5.5–5.9 mm and two epoxy coats on faces and edges add 0.3–0.5 mm, plus ~0.3 mm of glue film. At 0.04" the groove is 0.276" (7 mm cutter) in 6 mm ply. The walls each side of the groove are (side stock − groove) / 2 and need to stay ≥ 0.1".',
  },
  transomThicknessIn: {
    label: 'Transom thickness (front and rear)', group: 'stock', unit: 'in',
    default: 0.75, min: 0.5, max: 1.25, step: 0.0625, status: 'assumed', ref: 'D-35, D-43',
    note: '¾" gives the transom a real hand-hold bar, lets a DF 500 Domino keep a 0.15" wall, and takes the handle sockets, and quadrant bracket bolts. The chine and gunwale thickness is "Chine / gunwale stock thickness".',
  },
  scupperDiaIn: {
    label: 'Deck scupper (drain hole) diameter', group: 'body', unit: 'in',
    default: 0.375, min: 0.25, max: 0.75, step: 0.0625, status: 'assumed', ref: 'D-43',
    note: 'Epoxy-lined holes through the chines at the rear corners and just behind the bow curl, each with a stainless nipple so no cut ply edge is exposed.',
  },
  ventHoleIn: {
    label: 'Dado vent hole diameter', group: 'body', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.25, step: 0.0156, status: 'assumed', ref: 'D-43',
    note: 'Relief hole from the closed end of each stopped dado / deck dado through the transom, so epoxy and air can escape when the transom slides on (hydraulic lock).',
  },
  chineTieSpacingIn: {
    label: 'Chine-to-frame Domino spacing', group: 'body', unit: 'in',
    default: 6, min: 3, max: 12, step: 1, status: 'assumed', ref: 'D-43',
    note: 'The rail runs flush under the chine; a Domino every this many inches plus an epoxy bed ties the side to the frame.',
  },
  footStopShare: {
    label: 'Share of the rider restraint force taken by the foot stop', group: 'factors', unit: '',
    default: 0.6, min: 0.3, max: 1, step: 0.05, status: 'assumed', ref: 'D-43',
    note: 'The rest goes through the grab handles and seat friction (μ 0.4 × weight ≈ 0.4 g of the 2 g).',
  },
  woodScrewLateralLbf: {
    label: '#10 stainless wood screw lateral allowable (oak, wet)', group: 'factors', unit: 'lbf',
    default: 90, min: 40, max: 200, step: 5, status: 'verify', ref: 'D-43',
    note: 'NDS-style single-shear lateral value for a #10 (0.19") screw in white oak with wet-service and a safety factor; confirm against the fastener catalog.',
  },
  deckCaptureDepthIn: {
    label: 'Deck / web-end capture depth (rabbet or dado)', group: 'body', unit: 'in',
    default: 0.25, min: 0.125, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-35',
    note: 'The deck edge sits in a rabbet in each chine and in a dado in each transom; the side-panel ends enter a stopped dado in the transoms.',
  },
  roundoverIn: {
    label: 'Roundover on exposed oak edges', group: 'body', unit: 'in',
    default: 0.25, min: 0, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-44',
    note: 'Router roundover on every exposed oak edge (hands, shins, splinters). Drawn in the viewer; the analysis and mass use the square section, which is conservative for mass and slightly unconservative for section (1/4" on a 1-1/2" rail is under 2%).',
  },
  transomCrownIn: {
    label: 'Transom crown (arc rise at the center)', group: 'body', unit: 'in',
    default: 0.625, min: 0, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-44',
    note: 'The transom top edge arcs up this much at the center above the gunwale line at its corners (a parabolic arc). The lift slot keeps its position, so the oak above it only grows.',
  },
  transomCornerRadiusIn: {
    label: 'Transom top corner radius', group: 'body', unit: 'in',
    default: 0.75, min: 0, max: 2, step: 0.125, status: 'assumed', ref: 'D-44',
    note: 'Rounded top corners of both transoms (profile cut on the CNC or bandsaw). Kept small so the gunwale ends stay captured beside the corner.',
  },
  seatBackCornerRadiusIn: {
    label: 'Seat back corner radius', group: 'seat', unit: 'in',
    default: 2.5, min: 0, max: 5, step: 0.25, status: 'assumed', ref: 'D-44',
    note: 'The padded backrest is a rounded rectangle; the radius is capped at a third of the smaller side.',
  },
  edgeBandIn: {
    label: 'Oak edge-banding thickness (edged ply)', group: 'body', unit: 'in',
    default: 0.25, min: 0.125, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-35, D-47',
    note: 'Glued-on oak strip, flush both faces, on every straight ply edge that is not captured (deck step, signs). 1/4" thick x 5/16" wide (ply + 1/16" proud), epoxied, cauls and tape, then flush-trimmed; 3/16" strips snapped on the bench (r3 build S12). Curved corners (the kingpin-access opening) use 1/16" oak edge veneer instead.',
  },
  blockingThickIn: {
    label: 'Oak doubler (blocking) thickness', group: 'body', unit: 'in',
    default: 0.75, min: 0.5, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-41',
    note: 'Local oak blocking glued behind the gunwale and the rear transom where grip pads, lash plates and the rear-light plate screw in, so every wood screw has at least ¾" of engagement.',
  },
  liftSlotLengthIn: {
    label: 'Lift hand-hold slot length (across the transom)', group: 'body', unit: 'in',
    default: 4.5, min: 4, max: 6, step: 0.25, status: 'assumed', ref: 'D-37',
    note: 'Sized for a gloved hand.',
  },
  liftSlotHeightIn: {
    label: 'Lift hand-hold slot height', group: 'body', unit: 'in',
    default: 1.25, min: 1, max: 2, step: 0.125, status: 'assumed', ref: 'D-37',
  },
  liftSlotClearIn: {
    label: 'Hand clearance under the slot (above the deck / box lid)', group: 'body', unit: 'in',
    default: 3, min: 1.5, max: 5, step: 0.25, status: 'assumed', ref: 'D-37',
    note: 'The slot bottom sits at least this far above the deck, and clear of a storage box that abuts the transom.',
  },
  liftBarMinIn: {
    label: 'Oak left above the lift slot', group: 'body', unit: 'in',
    default: 0.75, min: 0.5, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-37',
    note: 'If the slot pushes this above the gunwale line, the transom rises into a low crest.',
  },
  signLengthIn: {
    label: 'Side sign blank length', group: 'body', unit: 'in',
    default: 20, min: 8, max: 30, step: 1, status: 'assumed', ref: 'D-9',
    note: 'Shortened automatically to fit between the rear tire and the forward reflector.',
  },
  signHeightIn: {
    label: 'Side sign blank height', group: 'body', unit: 'in',
    default: 6, min: 3, max: 9, step: 0.5, status: 'assumed', ref: 'D-9',
  },
  tenonDepthIn: {
    label: 'Loose-tenon depth (thin stock)', group: 'stock', unit: 'in',
    default: 0.375, min: 0.25, max: 0.625, step: 0.0625, status: 'assumed', ref: 'D-35',
    note: 'Loose-tenon depth where no Domino size keeps the wall (thin hosts): both parts are mortised and a shop-made tenon is glued in. Not a CNC-cut integral tenon (build review S2).',
  },
  dominoMinWallIn: {
    label: 'Domino mortise: minimum wall left behind', group: 'stock', unit: 'in',
    default: 0.15, min: 0.1, max: 0.3, step: 0.025, status: 'assumed', ref: 'D-35',
  },
  dominoEdgeIn: {
    label: 'Domino: minimum margin to the stock edge', group: 'stock', unit: 'in',
    default: 0.25, min: 0.1, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-35',
  },
  dominoEdgeLightIn: {
    label: 'Domino: margin to the stock edge, light frames', group: 'stock', unit: 'in',
    default: 0.1, min: 0.05, max: 0.25, step: 0.025, status: 'assumed', ref: 'D-40',
    note: 'Seat-back frame, storage lid frame and grab-handle posts carry no structural load path through the Domino (a 4x20 in a 1" member leaves 0.1" each side). Fed to chooseDomino for those joints only.',
  },
  printedDensityPcf: {
    label: 'Printed ASA / PETG density (solid walls)', group: 'materials', unit: 'lb/ft³',
    default: 66, min: 50, max: 80, step: 1, status: 'assumed', ref: 'D-37',
  },
  crossmemberSpacingIn: {
    label: 'Max unsupported deck span (joist spacing)', group: 'body', unit: 'in',
    default: 10, min: 6, max: 24, step: 0.5, status: 'explore', ref: 'D-17, D-43',
  },
  storageLocation: {
    label: 'Storage box location', group: 'body', unit: '',
    default: STORAGE_LOCATION.rearOverAxle, min: 0, max: 2, step: 1, status: 'explore', ref: 'D-19',
    options: [
      { value: STORAGE_LOCATION.rearOverAxle, label: 'Behind seat, over rear axle' },
      { value: STORAGE_LOCATION.underSeat, label: 'Under the seat' },
    ],
  },
  storageVolumeIn3: {
    label: 'Storage box interior volume', group: 'body', unit: 'in³',
    default: 2500, min: 800, max: 4000, step: 50, status: 'assumed', ref: 'D-19, D-53, D-54',
    note: 'Raised from 1,800 to 2,000 in³ (Phase 3 integration): the 10 Essentials packing check (D-41) filled 0.96 of the 1,762 in³ interior at 1,800. Raised again to 2,200 in³ (Phase 3c-2, D-53): the box also holds the seat back and cushion in cargo mode, so it needs about 4.8 in of height under the lid frame for them (seat-stow check). 2,500 in³ at D-54: the 24 in body leaves a 22 in interior, so the wedges and knobs lie on top of the seat back (about 1.7 in more height) instead of in floor strips, and the Essentials still pack.',
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
  storageSideClearIn: {
    label: 'Storage box clearance to the chine (each side)', group: 'body', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.25, step: 0.0156, status: 'assumed', ref: 'D-47',
    note: 'The box drops in from above and is bonded to the deck, so it needs a gap to the chine inner face (r3 build S3); the gap is filled with thickened epoxy. The box is narrower by twice this, and the height rises to hold the volume.',
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
  // Workstream D (D-41): weatherproofing and lash points.
  storageGasketIn: {
    label: 'Storage lid gasket thickness (uncompressed)', group: 'body', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-41',
    note: 'EPDM bulb or closed-cell strip between the wall tops and the lid frame.',
  },
  storageCoamingThickIn: {
    label: 'Storage wall-top oak coaming thickness', group: 'body', unit: 'in',
    default: 0.375, min: 0.25, max: 0.75, step: 0.125, status: 'assumed', ref: 'D-41',
    note: 'An oak strip capping the 6 mm ply walls so the gasket seals on oak and no ply edge is exposed at the wall tops. The ply wall stops this far below the gasket.',
  },
  storageCoamingWidthIn: {
    label: 'Storage wall-top oak coaming width', group: 'body', unit: 'in',
    default: 0.5, min: 0.375, max: 1, step: 0.125, status: 'assumed', ref: 'D-41',
    note: 'Flush with the outside of the wall; the inboard overhang past the ply wall is a ledge that the gasket also sits on.',
  },
  storageDrainDiaIn: {
    label: 'Storage box drain hole diameter', group: 'body', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-41',
    note: 'Two drains at the aft corners through the floor and deck; stainless nipples keep the cut ply edges sealed.',
  },
  lashPointsPerSide: {
    label: 'Lash points per gunwale', group: 'body', unit: '',
    default: 3, min: 2, max: 5, step: 1, status: 'assumed', ref: 'D-41',
    note: 'Stainless D-rings on the cabin gunwales for post-race gear hauling (BRIEF §4.9: at least 6 in all).',
  },

  lashDoublerThickIn: {
    label: 'Lash-plate doubler thickness (inboard of the gunwale)', group: 'body', unit: 'in',
    default: 1, min: 0.75, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-47',
    note: 'The lash plate (1.5 x 0.9") is centered on this oak doubler, glued to the inner face of the gunwale, and its four screws go straight down into it (r3 build S8): the 5/8" gunwale is too thin and has the web groove under it. 1" leaves 0.25" of oak beside each screw row.',
  },
  lashLoadLbf: {
    label: 'Lash point design load (strap pull)', group: 'body', unit: 'lbf',
    default: 300, min: 100, max: 600, step: 25, status: 'assumed', ref: 'D-41',
    note: 'BRIEF §4.9: the D-ring bolt plate is rated for 300 lbf working load. The lash-load check pulls each plate with this at the angle below.',
  },
  lashPullAngleDeg: {
    label: 'Lash strap pull angle above the deck', group: 'body', unit: '°',
    default: 45, min: 15, max: 75, step: 5, status: 'assumed', ref: 'D-41',
    note: 'The strap runs up and inboard over the load: 45° splits the pull evenly into screw withdrawal (vertical) and lateral shear (horizontal).',
  },

  // ── Seat & rider position ────────────────────────────────────────────────
  seatXIn: {
    label: 'Seat H-point ahead of rear axle', group: 'seat', unit: 'in',
    default: 16, min: 1.5, max: 17.5, step: 0.5, status: 'explore', primary: true, ref: 'D-53, D-54',
    note: 'Forward → more front load, better lock stability; aft → more rear-brake traction. 15.5 in (was 12): the box behind the seat must be at least 16.9 in long inside so the seat back (16 in) and the cushion (15.6 in) lie flat in it, the cushion stopping short of the 1 in insert backers (D-53, seat-stow check).',
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
    note: 'An oak board across the body, braced by its sides and two cleats.',
  },
  seatCushionIn: {
    label: 'Seat cushion thickness', group: 'seat', unit: 'in',
    default: 2, min: 1, max: 5, step: 0.25, status: 'assumed', ref: 'D-18',
  },
  seatStowClearIn: {
    label: 'Clearance around the stowed seat in the box', group: 'seat', unit: 'in',
    default: 0.25, min: 0, max: 1, step: 0.125, status: 'assumed', ref: 'D-53',
    note: 'Total slack, fore-aft and across, when the seat back and cushion lie flat in the storage box (seat-stow check).',
  },
  seatBackHeightIn: {
    label: 'Seat-back height above seat', group: 'seat', unit: 'in',
    default: 16, min: 8, max: 24, step: 0.5, status: 'assumed', ref: 'D-18',
  },
  seatBackAngleDeg: {
    label: 'Seat-back recline from vertical', group: 'seat', unit: '°',
    default: 15, min: 0, max: 30, step: 1, status: 'assumed', ref: 'D-18',
  },
  // Workstream D (D-40): seat-back attachment, panel groove, side grips.
  seatBackGrooveDepthIn: {
    label: 'Seat-back panel groove depth', group: 'seat', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-40',
    note: 'The ply panel is captured in a groove this deep in the stiles and rails; the cut size includes it.',
  },
  seatBackKnobHeightIn: {
    label: 'Seat-back knob height above the stile foot', group: 'seat', unit: 'in',
    default: 1.8, min: 1.2, max: 3, step: 0.1, status: 'assumed', ref: 'D-40',
    note: 'One 3/8-16 stud + star knob per stile, just behind the cushion edge. The farther below the crest it sits, the lower the insert pull-out force.',
  },
  seatBackLoadFraction: {
    label: 'Share of rider weight that loads the seat back', group: 'seat', unit: '×',
    default: 0.5, min: 0.25, max: 1, step: 0.05, status: 'assumed', ref: 'D-40',
    note: 'Torso share (≈ 50%); the legs brace on the foot stop and the pelvis on the cushion. Multiplied by the dynamic factor (a hard pull on the bridle throws the rider back).',
  },
  seatInsertAllowLbf: {
    label: 'Seat-back insert allowable pull-out (each)', group: 'seat', unit: 'lbf',
    default: 400, min: 100, max: 800, step: 25, status: 'verify', ref: 'D-40',
    note: '3/8-16 stainless threaded insert in white oak: ultimate ≈ 1,200 lbf (vendor data to confirm) ÷ 3.',
  },
  seatGripGapIn: {
    label: 'Side grip finger gap above the gunwale', group: 'seat', unit: 'in',
    default: 1.5, min: 1.25, max: 2.5, step: 0.25, status: 'assumed', ref: 'D-40',
    note: 'No pinch point: the gap under the bar is at least 1.25" (a gloved finger) and the clear length at least 3.5" (a hand).',
  },
  seatGripClearLengthIn: {
    label: 'Side grip clear length between posts', group: 'seat', unit: 'in',
    default: 4.5, min: 3.5, max: 6, step: 0.25, status: 'assumed', ref: 'D-40',
  },

  // ── Wheels & axles ───────────────────────────────────────────────────────
  wheelDiameterIn: {
    label: 'Wheel (tire OD) diameter', group: 'wheels', unit: 'in',
    default: 10, min: 8, max: 13, step: 0.5, status: 'explore', primary: true, ref: 'D-11, D-54',
    note: 'REAR wheels (D-54): 10" pneumatic hand-truck wheels (4.10/3.50-4). Other stock sizes: ~12" (2.80/2.50-4 or 3.00-4), 13" (4.10/3.50-6). Mass interpolates between the 10" and 13" values.',
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
    default: 3.5, min: 2.5, max: 5, step: 0.25, status: 'assumed', ref: 'D-11',
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
    default: 0.75, min: 0.625, max: 1, step: 0.125, status: 'explore', ref: 'D-10',
    note: 'Hand-truck wheels come with 5/8" or 3/4" bearings as standard; 1" bore versions exist, and 7/8"/1" bores need sourced bearings.',
    options: [
      { value: 0.625, label: '5/8"' },
      { value: 0.75, label: '3/4"' },
      { value: 0.875, label: '7/8"' },
      { value: 1, label: '1"' },
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
  uboltRodDiameterIn: {
    label: 'Rear clamp bolt diameter', group: 'wheels', unit: 'in',
    default: 0.375, min: 0.3125, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-34',
    note: '316 hex bolt through each rear clamp plate and the beam beside the axle rod (the plates pin the rod in its groove).',
  },
  clampLegGapIn: {
    label: 'U-bolt leg gap beside the axle rod', group: 'wheels', unit: 'in',
    default: 0.25, min: 0.125, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-10',
    note: 'Clamp legs straddle the rod at rod center ± (rod radius + gap) (critic r2, H2).',
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
  wheelRatingLb: {
    label: 'Wheel load rating, each (vendor listing)', group: 'wheels', unit: 'lb',
    default: 300, min: 100, max: 800, step: 25, status: 'verify', ref: 'D-11',
    note: 'Eng r2 N-7: READ THIS OFF THE VENDOR LISTING for the exact wheel you order (13" hand-truck wheels are typically listed 250-400 lb per wheel; flat-free are often listed higher than pneumatic). 300 is an assumed placeholder. It is a static / rolling rating: the wheel-rating check compares the static goal-rider load to it and the dynamic peak to `wheelRatingPeakMult` times it.',
  },
  wheelRatingPeakMult: {
    label: 'Short-duration peak allowed over the wheel rating', group: 'wheels', unit: '×',
    default: 2, min: 1, max: 4, step: 0.25, status: 'verify', ref: 'D-11',
    note: 'A catalog rating is a continuous / static value with margin against failure; a curb-strike or drop peak may reach a multiple of it for an instant. 2× is an assumption (hub bearings and spokes / web, not the tire, are what fail); ask the vendor or test one wheel to a drop.',
  },
  wheelSideRatingFrac: {
    label: 'Wheel lateral (skid) capacity as a fraction of the rating', group: 'wheels', unit: '×',
    default: 0.5, min: 0.1, max: 1, step: 0.05, status: 'verify', ref: 'D-11',
    note: 'Hub bearings in a hand-truck wheel are rated radially; a side load (cornering, side-slope skid) acts on the bearing as a moment and axial load. Half the radial rating is an assumption.',
  },
  beamNotchClearIn: {
    label: 'Rail notch clearance each side of the rear axle beam', group: 'wheels', unit: 'in',
    default: 0.0625, min: 0.03, max: 0.125, step: 0.0156, status: 'assumed', ref: 'D-15',
    note: 'Build r2 MUST-4: the cabin rails are notched on their underside so they bear on the rear beam top (the beam is 1.35" higher than the rail bottom). Beam width + this each side, 1.35" deep, router or bandsaw + chisel, corners relieved.',
  },
  beamHoldDownLegIn: {
    label: 'Rear beam hold-down angle leg length', group: 'wheels', unit: 'in',
    default: 1.5, min: 1, max: 2.5, step: 0.25, status: 'assumed', ref: 'D-15',
    note: '316 stainless angle, inside each rail: one leg against the rail inner face (two bolts through the rail), the other lying on the beam top (one bolt down through the beam). Ties the beam to the rail against rebound and side loads.',
  },
  beamHoldDownThickIn: {
    label: 'Rear beam hold-down angle thickness', group: 'wheels', unit: 'in',
    default: 0.1875, min: 0.125, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-15',
  },
  beamHoldDownBoltDiameterIn: {
    label: 'Rear beam hold-down bolt diameter', group: 'wheels', unit: 'in',
    default: 0.25, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-15',
    note: '1/4" 316 stainless hex bolts, nylock nuts, fender washers (the bolts through the rail sit 4D above the notch ceiling).',
  },
  axleHangerThickIn: {
    label: 'Axle hanger thickness (across, on the inside of each rail)', group: 'wheels', unit: 'in',
    default: 0.75, min: 0.5, max: 1.5, step: 0.0625, status: 'assumed', ref: 'D-54, D-15',
    note: 'D-54: the deck is 14.7 in up, so the rails no longer reach the axle beam. An oak hanger glued and bolted to the INSIDE face of each rail drops from the rail top to the beam and carries the old beam notch and hold-down angle (rear-mount.ts). Its grain is vertical (side-grain glue to the rail).',
  },
  axleHangerWidthIn: {
    label: 'Axle hanger width (fore-aft)', group: 'wheels', unit: 'in',
    default: 5, min: 3.5, max: 8, step: 0.25, status: 'assumed', ref: 'D-54',
    note: 'Leaves about 1.2 in of oak each side of the 2.6 in beam notch.',
  },
  axleSeatNotchIn: {
    label: 'Axle hanger notch depth (above the hanger bottom to the beam top)', group: 'wheels', unit: 'in',
    default: 1.35, min: 0.5, max: 2.5, step: 0.05, status: 'assumed', ref: 'D-15, D-54',
    note: 'The hanger bottom is this far below the beam top, so the hanger straddles the beam (D-48 rail notch, moved to the hanger).',
  },
  axleYieldPsi: {
    label: 'Axle steel yield strength', group: 'wheels', unit: 'psi',
    default: 70000, min: 30000, max: 120000, step: 1000, status: 'assumed', ref: 'D-4',
    note: '¾" 1045 turned-ground-polished shafting ≈ 70+ ksi (D-27; confirm vendor cert). 1018 cold-drawn would be ≈ 54 ksi.',
  },

  // ── Steering & pull ──────────────────────────────────────────────────────
  // ── Front end (PROVISIONAL) and the bridle eye. The swivel casters of the first D-54 pass were rejected by Eric (deck too high, too close together, 360 degrees of swivel); the front end is being redecided (a center-pivot soapbox axle with limited steering). Until then the front is a fixed placeholder axle. ──
  frontTrackIn: {
    label: 'Front track (wheel center to center)', group: 'steering', unit: 'in',
    default: 35.5, min: 26, max: 52, step: 0.25, status: 'explore', ref: 'D-56, D-6',
    note: 'D-56: the two front wheels sit outboard of the 24 in body on the ends of the pivoting axle beam. At full lock a wheel\'s inner rear corner swings toward the body, so the track has a minimum for the lock angle (steer-clear check in validateParams: about 34 in at 20 degrees).',
  },
  steerLockDeg: {
    label: 'Steering lock (each way)', group: 'steering', unit: '°',
    default: 20, min: 5, max: 35, step: 1, status: 'assumed', primary: true, ref: 'D-56',
    note: 'Eric: about 20 degrees each way, set by two stop blocks. The whole axle pivots on the kingpin; both wheels stay parallel (no Ackermann), so the turning center is where the axle line meets the rear axle line.',
  },
  steerClearIn: {
    label: 'Min. tire-to-body clearance at full lock', group: 'steering', unit: 'in',
    default: 0.75, min: 0.25, max: 2, step: 0.25, status: 'assumed', ref: 'D-56',
    note: 'The inner rear (or front) corner of the tire swings toward the side of the body at full lock. validateParams checks track/2 - tire/2 times cos(lock) - tire radius times sin(lock) against the body half width plus this.',
  },
  kingpinDiaIn: {
    label: 'Kingpin bolt diameter (grade 8)', group: 'steering', unit: 'in',
    default: 0.625, min: 0.5, max: 0.75, step: 0.0625, status: 'assumed', ref: 'D-56',
    note: 'One SAE grade 8 bolt through the axle beam centre and the king beam, head down under the beam with a plate washer, nylock nut in a slot cut from the front face of the king beam. Bolted only (no welding).',
  },
  kingThrustOdIn: {
    label: 'Kingpin thrust washer OD (UHMW)', group: 'steering', unit: 'in',
    default: 2.5, min: 1.5, max: 3.5, step: 0.25, status: 'assumed', ref: 'D-56',
    note: 'Large UHMW washer between the steel tongue plate (on the axle beam) and the king beam: the bearing the whole front load turns on.',
  },
  kingThrustThickIn: {
    label: 'Kingpin thrust washer thickness', group: 'steering', unit: 'in',
    default: 0.25, min: 0.125, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-56',
  },
  kingBeamLengthIn: {
    label: 'King beam length (fore-aft)', group: 'steering', unit: 'in',
    default: 3, min: 2, max: 5, step: 0.25, status: 'assumed', ref: 'D-56',
    note: 'The king beam is an oak crossmember between the rails at the kingpin: it carries the front load from the kingpin into the rails and the deck. Its depth is whatever is left between the thrust washer and the deck underside.',
  },
  steerBearingAllowPsi: {
    label: 'UHMW thrust washer allowable bearing pressure', group: 'factors', unit: 'psi',
    default: 1000, min: 300, max: 2500, step: 50, status: 'verify', ref: 'D-56',
    note: 'UHMW-PE is good to about 1000 psi static (PV-limited when turning slowly under load); confirm with the supplier.',
  },
  tongueThickIn: {
    label: 'Bridle tongue plate thickness', group: 'steering', unit: 'in',
    default: 0.1875, min: 0.125, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-56',
    note: 'A36 flat bar lying on top of the axle beam: it carries the kingpin hole and the thrust washer bearing face, then reaches forward under the deck and the bow to the bridle tie. Bolted to the beam (two bolts); no welding.',
  },
  tongueWidthIn: {
    label: 'Bridle tongue bar width', group: 'steering', unit: 'in',
    default: 2.5, min: 1.5, max: 4, step: 0.25, status: 'assumed', ref: 'D-56',
  },  tongueHeadWidthIn: {
    label: 'Tongue plate width at the kingpin (the bearing plate)', group: 'steering', unit: 'in',
    default: 4, min: 3, max: 6, step: 0.25, status: 'assumed', ref: 'D-56',
    note: 'The tongue plate is wide where it lies on the axle beam so two bolts sit outside the thrust washer; it tapers to the bar width ahead of the beam.',
  },
  tongueBoltDiaIn: {
    label: 'Tongue plate bolt diameter (to the axle beam)', group: 'steering', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-56',
    note: 'Two 316 bolts down through the plate and the beam, one each side of the kingpin, outside the thrust washer.',
  },

  tongueTieAheadIn: {
    label: 'Bridle tie hole ahead of the bow tip', group: 'steering', unit: 'in',
    default: 4, min: 2, max: 12, step: 0.5, status: 'assumed', ref: 'D-56',
    note: 'The tongue reaches this far beyond the curled bow so the rope and shackle clear the bow and the axle can swing.',
  },
  steerStopBoltDiaIn: {
    label: 'Steering stop block bolt diameter', group: 'steering', unit: 'in',
    default: 0.3125, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-56',
    note: 'Two 316 bolts down through each oak stop block and the end joist.',
  },
  frontStubLenIn: {
    label: 'Front stub axle clamped length on the beam', group: 'steering', unit: 'in',
    default: 8, min: 4, max: 14, step: 0.5, status: 'assumed', ref: 'D-56',
    note: 'Each front stub axle is a steel rod bolted down in a groove in the top of the beam end (two clamp plates, as on the rear axle), the wheel on the free end.',
  },
  steerRopesOn: {
    label: 'Steering ropes from the axle ends to the musher', group: 'steering', unit: '',
    default: 0, min: 0, max: 1, step: 1, status: 'assumed', ref: 'D-56',
    options: [{ value: 0, label: 'Off (pullers steer with the bridle)' }, { value: 1, label: 'On (two ropes, axle ends to the musher)' }],
    note: 'Optional: a light rope from each end of the front axle back to the musher at the handlebow, so the musher can help steer. Default off.',
  },
  steerRopeRunIn: {
    label: 'Steering rope length (axle end to the musher)', group: 'steering', unit: 'in',
    default: 96, min: 48, max: 144, step: 6, status: 'assumed', ref: 'D-56',
  },

  eyeBoltDiameterIn: {
    label: 'Bridle shackle pin diameter (tongue tie)', group: 'steering', unit: 'in',
    default: 0.5, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-33, D-47, D-56',
    note: 'D-56: the bridle is tied to a bow shackle through a hole in the tip of the tongue (the old bow eye bolt and backing block are gone). The shackle pin is the intended weak link of the rope tie, and it holds the design pull x the overload factor.',
  },

  eyeBoltYieldPsi: {
    label: 'Bridle eye bolt steel yield strength', group: 'steering', unit: 'psi',
    default: 36000, min: 30000, max: 90000, step: 1000, status: 'assumed', ref: 'D-33',
    note: 'Forged carbon steel, conservative. Allowable = yield / steel safety factor. Confirm the vendor working-load limit is at least the pull in the rope-tie row.',
  },
  bridleTieOverloadFactor: {
    label: 'Bridle tie overload factor on the design pull', group: 'loads', unit: '×',
    default: 2, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-47',
    note: 'The rope tie (eye bolt, washer, beam hole) is checked at the design pull x this factor, so a hard yank by 8 scouts does not fail it first (r3 fittings N-6). 2 x 150 = 300 lbf. The pull itself is still O-2.',
  },
  bridleTieHandHeightMaxIn: {
    label: 'Puller hand height for the tie-load case (upper bound)', group: 'steering', unit: 'in',
    default: 40, min: 30, max: 50, step: 1, status: 'assumed', ref: 'D-33',
    note: 'The tie load is evaluated with the hands at this height (30–40" range), which gives the largest vertical component on the eye.',
  },
  pullerHandHeightIn: {
    label: 'Puller hand height', group: 'steering', unit: 'in',
    default: 30, min: 20, max: 40, step: 1, status: 'assumed', ref: 'D-14',
  },
  bridleRopeRunIn: {
    label: 'Bridle rope run (tongue tie to puller hands)', group: 'steering', unit: 'in',
    default: 96, min: 36, max: 144, step: 6, status: 'assumed', ref: 'D-14, D-54',
    note: 'A 6 ft rope sets the pull angle α = atan((hand height − tie height) / run) used by the rearward-pitch check.',
  },

  // ── Brake & rear handle ──────────────────────────────────────────────────
  brakeLeverRatio: {
    label: 'Brake foot-lever advantage TARGET', group: 'brake', unit: ':1',
    default: 5, min: 2, max: 12, step: 0.5, status: 'explore', ref: 'D-55',
    note: 'D-55: a target, not an input. The analysis uses the ratio DERIVED from the pedal geometry (foot force at the pedal to total shoe normal force); brake-ratio fails if the geometry delivers less than this. The geometry gives about 7:1; a 5:1 target holds the 250 lb cargo case on 15 degrees at the mud-fouled lining with about 55 lbf of foot force at 90 percent efficiency.',
  },
  brakeBeamSizeIn: {
    label: 'Brake shoe beam depth (fore-aft)', group: 'brake', unit: 'in',
    default: 1.5, min: 1, max: 2.5, step: 0.25, status: 'assumed', ref: 'D-55',
    note: 'D-55: the shoe beam is a 6061-T6 aluminum rectangular tube across the tail just behind the rear tires, with a lined shoe bolted to its front face at each end. It passes through a slot in each swing arm. It takes the shoe thrust as plan bending between the arms and the shoes, so its depth in the fore-aft direction is the strong way. Bolted only.',
  },
  brakeBeamHeightIn: {
    label: 'Brake shoe beam height', group: 'brake', unit: 'in',
    default: 1, min: 0.75, max: 2, step: 0.25, status: 'assumed', ref: 'D-55',
    note: 'Kept low so the arm pivot can sit only a little above the shoe (the lever ratio is pedal reach over that height).',
  },
  brakeBeamWallIn: {
    label: 'Brake shoe beam tube wall', group: 'brake', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-53',
  },
  brakeAluminumYieldPsi: {
    label: 'Brake beam and guard aluminum yield (6061-T6)', group: 'brake', unit: 'psi',
    default: 35000, min: 15000, max: 45000, step: 1000, status: 'assumed', ref: 'D-53',
    note: 'Allowable = yield / steelSafetyFactor (shear 0.577x). The same value for the shoe beam tube and the toe guard plate.',
  },
  brakeEfficiency: {
    label: 'Brake linkage efficiency', group: 'brake', unit: '×',
    default: 0.9, min: 0.5, max: 1, step: 0.05, status: 'assumed', ref: 'D-13, D-55',
    note: 'Pivot friction only (D-55): a stepped bar on two bolted pivots has no links or cross shaft, so 0.9 (it was 0.8 for the D-53 lever and link).',
  },
  brakePadMu: {
    label: 'Lining-to-tire friction μ (bonded woven / molded lining, wet design)', group: 'brake', unit: '',
    default: 0.45, min: 0.2, max: 0.8, step: 0.05, status: 'assumed', ref: 'D-13',
    note: 'Phase 3 r2: the oak pads are faced with a 1/8" woven or molded brake lining (bonded, brass-free), which is about 0.45 against a wet rubber tread. Bare oak on wet rubber is only about 0.25 (eng review S-3).',
  },
  brakePadMuFouled: {
    label: 'Lining-to-tire friction μ, mud / slush fouled (pass/fail case)', group: 'brake', unit: '',
    default: 0.35, min: 0.15, max: 0.8, step: 0.05, status: 'assumed', ref: 'D-13',
    note: 'The shoe sits on the rear-lower tread, the part that just left the ground, so mud and slush reach it first (build review S10). The foot-force check and the member loads use the lower of this and the design μ; the force must still be ≤ the foot-force limit at this μ. Test the lining on a wet tire before the build.',
  },
  brakeLiningThickIn: {
    label: 'Brake lining thickness (bonded to the oak pad face)', group: 'brake', unit: 'in',
    default: 0.25, min: 0.0625, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-13, D-56',
    note: 'Woven or molded lining sheet bonded to the steel shoe back with contact or epoxy adhesive plus two stainless rivets. Counted inside the shoe radial thickness.',
  },
  tireGroundMu: {
    label: 'Tire-to-ground friction μ (design)', group: 'brake', unit: '',
    default: 0.5, min: 0.2, max: 0.9, step: 0.05, status: 'assumed', ref: 'D-16',
    note: 'Damp packed dirt/gravel. Wet leaves can drop to ~0.3.',
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
    label: 'Push-handle bow section (square, rounded over)', group: 'brake', unit: 'in',
    default: 1.25, min: 1, max: 2, step: 0.125, status: 'assumed', ref: 'D-9, D-53',
    note: 'The handlebow is a laminated white-oak bow of this square section, rounded over to a grip by hand.',
  },
  handleBowCrownIn: {
    label: 'Handlebow crown (rise at the middle over the post tops)', group: 'brake', unit: 'in',
    default: 3, min: 0, max: 8, step: 0.5, status: 'assumed', ref: 'D-53',
    note: 'A sled-style handlebow (reference/05): the bow arches up between and over the two posts. 0 = the old straight bar. The bow ends overhang the posts to the edge of the cart; the grip height (rearHandleHeightIn) is measured at the posts.',
  },
  handlePostThickIn: {
    label: 'Push-handle upright thickness (fore-aft)', group: 'brake', unit: 'in',
    default: 0.9375, min: 0.75, max: 1.5, step: 0.0625, status: 'assumed', ref: 'D-39',
    note: 'Build r2 S7: planed 15/16" so it is a slip fit (with `handleSocketSlipIn` per side) in the 1-1/4" × 1-3/4" × 1/8" aluminum tube (inside 1.0" × 1.5"). Mill from 1" stock; leave room for the oak to swell.',
  },
  handlePostWidthIn: {
    label: 'Push-handle upright width (across)', group: 'brake', unit: 'in',
    default: 1.4375, min: 1, max: 2.5, step: 0.0625, status: 'assumed', ref: 'D-39',
    note: 'Planed 1-7/16" from 1-1/2" stock (see the thickness).',
  },
  handleSocketSlipIn: {
    label: 'Push-handle post slip clearance per side in the socket', group: 'brake', unit: 'in',
    default: 0.03125, min: 0.015, max: 0.0625, step: 0.0078, status: 'assumed', ref: 'D-39',
    note: 'Socket outside = post + 2 × (wall + slip): 15/16" + 2 × (1/8" + 1/32") = 1-1/4" and 1-7/16" → 1-3/4", the standard tube.',
  },
  handleSocketDepthIn: {
    label: 'Push-handle socket depth (tube length)', group: 'brake', unit: 'in',
    default: 6, min: 3, max: 8, step: 0.5, status: 'assumed', ref: 'D-39',
    note: 'Steel rectangular-tube socket bolted to the outside of the rear transom, its top flush with the transom top.',
  },
  handleSocketWallIn: {
    label: 'Push-handle socket wall thickness', group: 'brake', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-39',
  },
  handlePinDiameterIn: {
    label: 'Push-handle retaining pin diameter', group: 'brake', unit: 'in',
    default: 0.3125, min: 0.1875, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-39',
    note: 'Clevis (or hitch) pin through both socket walls and the upright; a cotter or lynch pin keeps it in (D-9).',
  },
  handleHoldbackLbf: {
    label: 'Hold-back pull on the push handle', group: 'brake', unit: 'lbf',
    default: 50, min: 20, max: 100, step: 5, status: 'locked', ref: 'D-39',
    note: 'A handler leaning back on the grip to hold the cart on a descent (task brief: 50 lbf at the grip height).',
  },

  // ── Brake mechanism geometry (D-55 foot brake) ────────────────────────────
  brakeShoeTravelIn: {
    label: 'Brake shoe engagement stroke (shoe to tread)', group: 'brake', unit: 'in',
    default: 0.25, min: 0.1, max: 0.75, step: 0.025, status: 'assumed', ref: 'D-38, D-55',
    note: 'Released gap from the lining to the tread, which includes the tire squash and a little wear allowance. It sets the arm swing: angle = asin(stroke / pivot height above the shoe). A muddy shoe must retract clear of the tread (build review S10).',
  },
  brakeShoeAngleDeg: {
    label: 'Brake shoe position below the axle line', group: 'brake', unit: '°',
    default: 5, min: 0, max: 15, step: 1, status: 'assumed', ref: 'D-55',
    note: 'The shoes press the rear of the tread this many degrees below the axle line, so the normal force is nearly horizontal. The lowest lining corner must still clear minGroundClearanceIn.',
  },
  brakePivotAboveShoeIn: {
    label: 'Brake pivot height above the shoe', group: 'brake', unit: 'in',
    default: 1.1, min: 0.75, max: 3, step: 0.05, status: 'explore', ref: 'D-55',
    note: 'The swing arm pivots on a bolt directly above the shoe contact. The foot-lever ratio is the pedal reach over this height, so a low pivot is a strong lever; the shoe beam passes through the arm just below it.',
  },
  brakePedalReachIn: {
    label: 'Brake pedal reach behind the pivot', group: 'brake', unit: 'in',
    default: 8.5, min: 4, max: 14, step: 0.25, status: 'explore', ref: 'D-55',
    note: 'Horizontal distance from the pivot to the middle of the pedal bar, released. With the pivot 1 in above the shoe this gives about 7:1 once the arm has turned. A longer reach puts the bar farther behind the transom (the foot reaches it, the departure angle drops).',
  },
  brakePedalDepthIn: {
    label: 'Brake pedal bar depth (fore-aft)', group: 'brake', unit: 'in',
    default: 2, min: 1.5, max: 4, step: 0.25, status: 'assumed', ref: 'D-55',
    note: 'White oak, chosen over aluminum (D-55): the same weight, warm and grippy under a boot, cut and chamfered with the shop tools, no corrosion against the steel arms, and a section about four times stronger than the stomp needs. This is the tread depth the foot stands on.',
  },
  brakePedalHeightIn: {
    label: 'Brake pedal bar height', group: 'brake', unit: 'in',
    default: 1.25, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-55',
  },
  brakeBarClearIn: {
    label: 'Brake pedal assembly ground clearance (released)', group: 'brake', unit: 'in',
    default: 3.25, min: 2, max: 6, step: 0.25, status: 'assumed', ref: 'D-55',
    note: 'Height of the lowest edge of the swing arms above the ground with the pedal up (the oak bar sits a little higher). Never below minGroundClearanceIn. The bar kicks up at its front-lower edge so a root or rock rides over it (brakeBarKickIn).',
  },
  brakeBarKickIn: {
    label: 'Brake pedal bar front-lower chamfer ("kick")', group: 'brake', unit: 'in',
    default: 0.75, min: 0, max: 1.25, step: 0.125, status: 'assumed', ref: 'D-55',
    note: 'The lower front edge of the oak bar is cut at 45 degrees this far, like the turned-up nose of a sled runner, so the bar does not catch on roots as the cart rolls forward.',
  },
  brakeParkedClearIn: {
    label: 'Brake pedal ground clearance when parked (latched down)', group: 'brake', unit: 'in',
    default: 0.75, min: 0.25, max: 4, step: 0.25, status: 'assumed', ref: 'D-55',
    note: 'The latched bar sits about 2 in lower than the released bar (the arm swing). A parked cart is stationary, so this only has to clear the ground.',
  },
  brakePedalTravelMaxIn: {
    label: 'Brake pedal travel limit (bar drop, released to applied)', group: 'brake', unit: 'in',
    default: 2.5, min: 1.5, max: 4, step: 0.25, status: 'verify', ref: 'D-55',
    note: 'The most a boot can push the bar down in one stomp before it feels awkward. Feel-test the mock-up. Raising the shoe stroke or lowering the pivot raises the travel.',
  },
  brakeSpringForceLbf: {
    label: 'Brake return spring force at the pedal, applied', group: 'brake', unit: 'lbf',
    default: 7, min: 3, max: 20, step: 1, status: 'assumed', ref: 'D-55',
    note: 'Both extension springs together, as the equivalent vertical force on the bar at the applied pose (the released force is 80 percent of it: a low-rate spring). The foot adds it to the force that holds the cart; the released spring torque must lift the weight of the swinging parts.',
  },
  brakeFootForceLimitLbf: {
    label: 'Max foot force on the brake pedal', group: 'brake', unit: 'lbf',
    default: 60, min: 30, max: 120, step: 5, status: 'assumed', ref: 'D-55',
    note: 'D-55: a handler can lean 60 lbf onto a bar with one foot without much effort (the old hand lever was 30 lbf). The loaded cart (150 lb rider, 200 lb goal rider, 250 lb cargo case) must hold on the design slope within this.',
  },
  brakeFootAbuseLbf: {
    label: 'Brake pedal abuse stomp', group: 'brake', unit: 'lbf',
    default: 150, min: 100, max: 300, step: 10, status: 'assumed', ref: 'D-55',
    note: 'A scout jumping on the bar: the pedal bar, arms, pivot bolts, brackets, shoe beam and shoes must survive it at yield (SF 1). The brake may be bent after it only if the check says so.',
  },
  brakeToeGuardHeightIn: {
    label: 'Toe guard height above the pedal bar', group: 'brake', unit: 'in',
    default: 3, min: 1.5, max: 5, step: 0.25, status: 'assumed', ref: 'D-55',
    note: 'An aluminum plate bolted to the front of the bar that stops a boot sliding forward off the bar toward the tire. It also carries the latch stud.',
  },
  brakeToeGuardWidthIn: {
    label: 'Toe guard width', group: 'brake', unit: 'in',
    default: 18, min: 8, max: 26, step: 1, status: 'assumed', ref: 'D-55',
    note: 'Centered on the bar; never wider than the gap between the swing arms. Narrower is lighter, wider keeps a stray boot off the arms.',
  },
  brakeToeGuardMinIn: {
    label: 'Toe guard minimum height (boot toe)', group: 'brake', unit: 'in',
    default: 2, min: 1, max: 4, step: 0.25, status: 'assumed', ref: 'D-55',
    note: 'The height of plate that reliably stops the toe of a boot.',
  },
  brakeFootGapMinIn: {
    label: 'Open gap between the toe guard and the tire (foot-pinch limit)', group: 'brake', unit: 'in',
    default: 3.5, min: 2, max: 6, step: 0.25, status: 'assumed', ref: 'D-55',
    note: 'The space in front of the guard must stay open at least this wide (a boot cannot wedge in it; anything narrower would need a plate across it).',
  },
  brakeLatchPinDiameterIn: {
    label: 'Brake parking latch stud diameter', group: 'brake', unit: 'in',
    default: 0.5, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-55',
    note: 'A 316 bolt through the toe guard, sticking forward about 1 in; the latch hook (a hanging steel strap on a bolt through the rear transom) drops over it when the bar is stomped down. Kick the hook sideways to release.',
  },
  brakePivotBoltDiameterIn: {
    label: 'Brake arm pivot bolt diameter', group: 'brake', unit: 'in',
    default: 0.375, min: 0.25, max: 0.625, step: 0.0625, status: 'assumed', ref: 'D-53, D-55',
    note: 'A 316 shoulder bolt through the bracket tongue and the swing arm (one shear plane), head on the inboard side, nylock nut outboard.',
  },
  brakeBracketBoltDiameterIn: {
    label: 'Brake pivot bracket bolt diameter (to the rail)', group: 'brake', unit: 'in',
    default: 0.375, min: 0.1875, max: 0.4375, step: 0.0625, status: 'assumed', ref: 'D-55',
    note: 'Four 316 bolts through the bracket tongue and the cabin rail, fender washers and nylock nuts on the inside face of the rail. The shoe thrust pulls the pivot straight back, so these carry it as shear and as a moment couple.',
  },
  brakeBracketWidthIn: {
    label: 'Brake pivot bracket width on the rail (fore-aft)', group: 'brake', unit: 'in',
    default: 5, min: 2.5, max: 6, step: 0.25, status: 'assumed', ref: 'D-55',
    note: 'The flat top of each bracket tongue, bolted to the OUTER face of the cabin rail just behind the axle; the tongue tapers down to the pivot below the rail.',
  },
  brakePlateThickIn: {
    label: 'Brake arm, bracket and hook plate thickness (A36, outsourced)', group: 'brake', unit: 'in',
    default: 0.125, min: 0.125, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-53, D-55',
  },
  brakeGuardThickIn: {
    label: 'Toe guard plate thickness (6061-T6 aluminum)', group: 'brake', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-55',
  },
  brakeLiningMaxPsi: {
    label: 'Brake lining allowable contact pressure', group: 'brake', unit: 'psi',
    default: 100, min: 30, max: 300, step: 10, status: 'assumed', ref: 'D-53',
    note: 'Woven or molded lining against a rubber tread: a long-life limit for a brake used only now and then. Pressure = shoe normal force / lining area at the lambda hold load.',
  },
  brakeClearanceIn: {
    label: 'Brake moving-part clearance (sweep limit)', group: 'brake', unit: 'in',
    default: 0.1, min: 0.03, max: 0.5, step: 0.01, status: 'assumed', ref: 'D-38',
    note: 'Minimum gap between the moving brake parts and the wheel, hull, rails, storage box and ground over the full stroke.',
  },
  brakeLoadFactor: {
    label: 'Brake component load factor (on the hold load)', group: 'brake', unit: '×',
    default: 2, min: 1, max: 4, step: 0.25, status: 'assumed', ref: 'D-38',
    note: 'The pedal, arms, pivot, beam, shoes and latch are checked at this multiple of the load needed to hold the cart on the design slope: a hard stomp or a jerk on a parked cart.',
  },
  brakeSteelYieldPsi: {
    label: 'Brake arm plate / pin steel yield', group: 'brake', unit: 'psi',
    default: 36000, min: 30000, max: 100000, step: 1000, status: 'assumed', ref: 'D-38',
    note: 'A36 plate. Allowable = yield / steel safety factor (shear 0.577×).',
  },

  // ── Parking ratchet (D-39) ────────────────────────────────────────────────

  // ── Metal hardware: lathe-free shaft joints, aluminum sockets (build review M10; plan item 5) ──
  handleSocketYieldPsi: {
    label: 'Push-handle socket tube yield (6061-T6 aluminum)', group: 'brake', unit: 'psi',
    default: 35000, min: 20000, max: 60000, step: 1000, status: 'assumed', ref: 'D-39',
    note: 'Plan item 5: the push-handle sockets are 6061-T6 rectangular tube, not steel. Allowable = yield / steelSafetyFactor. Anodized or epoxy-coated, with a plastic isolator under the bolt washers (aluminum corrodes against wet tannin oak and steel bolts).',
  },
  aluminumDensityPcf: {
    label: 'Aluminum 6061 density', group: 'brake', unit: 'lb/ft³',
    default: 169, min: 160, max: 175, step: 1, status: 'assumed', ref: 'D-39',
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
    label: 'Chine / gunwale stock thickness', group: 'stock', unit: 'in',
    default: 0.625, min: 0.375, max: 1, step: 0.0625, status: 'explore', ref: 'D-35, D-43',
    note: '⅝" leaves 0.17" walls beside the 0.276" groove (D-43) and a ⅜"-wide bearing face under the deck rabbet; the transoms have their own thickness.',
  },
  axleBeamThicknessIn: {
    label: 'Rear axle beam width (fore-aft)', group: 'stock', unit: 'in',
    default: 2.5, min: 1.5, max: 4, step: 0.125, status: 'explore',
  },
  axleBeamDepthIn: {
    label: 'Axle beam depth (vertical)', group: 'stock', unit: 'in',
    default: 2.25, min: 1.5, max: 4, step: 0.125, status: 'explore', ref: 'D-54',
    note: '2.25 in (was 2.5): with the 10 in rear wheels the underslung beam bottom is at 5.375 - 2.25 = 3.1 in, above the 3 in ground clearance.',
  },
  deckPlyIn: {
    label: 'Deck plywood thickness', group: 'stock', unit: 'in',
    default: 0.472, min: 0.236, max: 0.709, step: 0.001, status: 'explore',
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
    note: 'Governs axle grooves and bolt crush.',
  },
  wetServiceFactorStrength: {
    label: 'Wet-service factor on strength', group: 'materials', unit: '×',
    default: 0.85, min: 0.5, max: 1, step: 0.01, status: 'assumed', ref: 'D-4',
  },
  wetServiceFactorStiffness: {
    label: 'Wet-service factor on stiffness', group: 'materials', unit: '×',
    default: 0.9, min: 0.5, max: 1, step: 0.01, status: 'assumed', ref: 'D-4',
  },
  wetServiceFactorCompPerp: {
    label: 'Wet-service factor on compression ⊥ (bearing)', group: 'materials', unit: '×',
    default: 0.67, min: 0.5, max: 1, step: 0.01, status: 'assumed', ref: 'D-4',
    note: 'NDS wet-service factor C_M for F_c⊥ is 0.67 (not the 0.85 used on bending and shear). Used for every compression-⊥ check.',
  },
  oakDowelBearingPsi: {
    label: 'White oak bolt (dowel) bearing ⊥ grain, clear', group: 'materials', unit: 'psi',
    default: 4000, min: 1500, max: 8000, step: 100, status: 'assumed', ref: 'D-4',
    note: 'Bolt bearing in a drilled hole is far above the area-bearing C⊥ (NDS Fe⊥ ≈ 6100·G^1.45/√D ≈ 5,700 psi for G = 0.68, ⅜" bolt); 4,000 psi is a conservative round figure. Used only for the bolster fastener bearing.',
  },
  oakSpecificGravity: {
    label: 'White oak specific gravity (NDS G)', group: 'materials', unit: '',
    default: 0.68, min: 0.5, max: 0.8, step: 0.01, status: 'assumed', ref: 'D-35',
    note: 'NDS Table 12.3.3: dowel bearing Fe⊥ = 6,100·G^1.45/√D, Fe∥ = 11,200·G. G = 0.68 for white oak (oven-dry basis).',
  },
  oakNdsShearPsi: {
    label: 'White oak NDS design shear Fv (reference)', group: 'materials', unit: 'psi',
    default: 205, min: 100, max: 300, step: 5, status: 'verify', ref: 'D-35',
    note: 'Lumber design value (it already carries the allowance for checks and splits), used for cleavage and row / group tear-out (NDS Appendix E and 3.4.3.3). The 850 psi clear-wood rows elsewhere are not used for these.',
  },
  ndsWetFactorShear: {
    label: 'NDS wet-service factor on Fv', group: 'materials', unit: '×',
    default: 0.97, min: 0.5, max: 1, step: 0.01, status: 'assumed', ref: 'D-35',
    note: 'NDS Table 4.3.1: C_M = 0.97 for shear parallel to grain in sawn lumber used wet.',
  },
  ndsWetFactorFasteners: {
    label: 'NDS wet-service factor on bolt lateral capacity', group: 'materials', unit: '×',
    default: 0.7, min: 0.5, max: 1, step: 0.05, status: 'assumed', ref: 'D-35',
    note: 'NDS Table 11.3.3: C_M = 0.7 for bolts in wood at moisture content over 19% in service (snow, rain, mud).',
  },
  ndsLoadDurationFactor: {
    label: 'NDS load-duration factor on the strike (connections)', group: 'materials', unit: '×',
    default: 1.6, min: 1, max: 1.6, step: 0.05, status: 'assumed', ref: 'D-35',
    note: 'A curb strike is a transient impact; the 3× dynamic factor is already in the load. NDS 10.3.2 caps C_D at 1.6 for connections, so 1.6 is used and no more.',
  },
  ndsGroupFactor: {
    label: 'NDS group action factor Cg for the plate bolt rows', group: 'materials', unit: '×',
    default: 0.85, min: 0.5, max: 1, step: 0.05, status: 'assumed', ref: 'D-35',
    note: 'Conservative constant for 4 to 6 bolts in a row at ≥ 4D spacing through a steel side plate (NDS 11.3.6); the table value is 0.9 or better.',
  },
  steelDowelBearingPsi: {
    label: 'Steel plate dowel bearing strength Fe (A36)', group: 'materials', unit: 'psi',
    default: 87000, min: 40000, max: 120000, step: 1000, status: 'assumed', ref: 'D-35',
    note: 'NDS Table 12.3.3: A36 steel, 87,000 psi.',
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
    default: 150, min: 60, max: 200, step: 1, status: 'locked', ref: 'A-2, D-56',
    note: 'Eric relaxed from 8/9 ft for the ±20° center-pivot front axle (12.5 ft on the outer tire edge; the turning circle is about 20 ft).',
  },
  deflectionLimitRatio: {
    label: 'Static deflection limit L/n', group: 'factors', unit: 'n',
    default: 300, min: 120, max: 600, step: 10, status: 'locked',
  },
  beamLigamentMinIn: {
    label: 'Min wood ligament around the axle groove', group: 'factors', unit: 'in',
    default: 0.75, min: 0.5, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-4',
    note: 'Short-grain wood behind the rod groove carries pull and bump loads in bearing (D-12, D-14).',
  },
  pitchPullMarginMin: {
    label: 'Rearward pitch: lift pull / peak pull', group: 'factors', unit: '×',
    default: 1.25, min: 1, max: 2.5, step: 0.05, status: 'assumed', ref: 'D-14',
    note: 'The pull that would lift the front wheels on the design slope must exceed the 150 lbf surge peak by this factor.',
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
  // ── Bump loads (D-50, D-54, D-55); the Ackermann front-end and ride-mode parts of this block went at Phase 3c-1 and 3c-3a ──
  brakeShoeBackThickIn: {
    label: 'Steel shoe back thickness', group: 'brake', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.1875, step: 0.0625, status: 'assumed', ref: 'D-56',
  },
  brakeLinedShoeWidthIn: {
    label: 'Lined steel-backed shoe width (across the tread)', group: 'brake', unit: 'in',
    default: 3, min: 1.5, max: 3.2, step: 0.1, status: 'verify', ref: 'D-56, D-55',
    note: 'D-55: 3.0 in on the 3.5 in tire, inside the tread edges (the model clamps it to the tire width minus 0.3 in). Shoe area sets the lining pressure.',
  },
  brakeLinedShoeLengthIn: {
    label: 'Lined steel-backed shoe length (along the tread)', group: 'brake', unit: 'in',
    default: 3, min: 2, max: 6, step: 0.25, status: 'verify', ref: 'D-56',
    note: 'REAR lined shoe, radius-matched to the 10" tire (D-55). At the default 5 degrees below the axle line its lowest corner is 3.1 in off the ground.',
  },
  bumpSpeedNormalMph: {
    label: 'Normal-use bump speed (walking pace)', group: 'bump', unit: 'mph',
    default: 3, min: 1, max: 6, step: 0.5, status: 'assumed', ref: 'D-55, D-53',
    note: 'Eric 2026-10-11: walking pace is normal use; a sharp edge at a jog is the occasional hard hit. The routine 1" step at this speed, with full margins (steel yield / SF, wood design MOR). D-50 still holds: bumps, not curbs. Replaces bumpSpeedMph (old shared links still load).',
  },
  bumpSpeedHardMph: {
    label: 'Hard-hit speed (jogging pace)', group: 'bump', unit: 'mph',
    default: 5, min: 2, max: 10, step: 0.5, status: 'assumed', ref: 'D-55, D-53',
    note: 'Eric 2026-10-11: walking pace is normal use; a sharp edge at a jog is the occasional hard hit. The 2" step at this speed, the fail-safe case (steel ultimate / failSafeFactor, wood MOR x C_M with no safety factor, wheel retention: bend, do not break).',
  },
  bumpNormalHeightIn: {
    label: 'Routine bump height', group: 'bump', unit: 'in',
    default: 1, min: 0.5, max: 3, step: 0.25, status: 'assumed', ref: 'D-54',
    note: 'Normal-use rows use full margins.',
  },
  bumpHardHeightIn: {
    label: 'Hard-hit height', group: 'bump', unit: 'in',
    default: 2, min: 1, max: 4, step: 0.25, status: 'assumed', ref: 'D-54',
    note: 'Rare hard hit (D-50: the 2" pothole or root). Hard-hit rows use ultimate / failSafeFactor.',
  },
  bumpWheelRateLbIn: {
    label: 'Effective wheel radial stiffness (10" pneumatic)', group: 'bump', unit: 'lb/in',
    default: 500, min: 150, max: 1500, step: 25, status: 'verify', ref: 'D-54',
    note: 'Phase 3c-3b: a 10" x 3.5" pneumatic hand-truck tire (4.10/3.50-4, rated about 300 lb at 30 psi) squashes about 0.6" (18% of the 3.25" section) at its rating, so k is about 300 / 0.6 = 500 lb/in; it scales with inflation pressure and runs 300 (20 psi) to 900 (rim-bound). TO MEASURE: stand a known weight on the cart at one wheel (a 150 lb person on the frame over the wheel) and measure the tire squash with a ruler against the hub; k = load / squash. docs/phase3c-3b-notes.md.',
  },
  bumpMassShare: {
    label: 'Rigid-body bump mass multiplier', group: 'bump', unit: '×',
    default: 1, min: 0.5, max: 2, step: 0.05, status: 'assumed', ref: 'D-54',
    note: 'Phase 3c-3b: the effective mass at the struck wheel is the rigid-body corner mass of the whole cart, W / (1 + x²/ky² + y²/kx²), about W/7 for a uniform cart struck at a corner (a rigid cart pivots about its other contacts). This multiplier scales it: 1 = mass spread like a plate over the wheel footprint; above 1 = heavy ends (cargo piled at the wheels); below 1 = mass bunched at the middle. Before 3c-3b this was 1.5 x the wheel static load.',
  },
  bumpDlfCheck: {
    label: 'Conventional dynamic factor (cross-check only)', group: 'bump', unit: '×',
    default: 3, min: 1.5, max: 5, step: 0.25, status: 'assumed', ref: 'D-54',
    note: 'Textbook dynamic wheel-load factor for a hand cart at walking pace, 2 to 3 (docs/phase3c-3b-notes.md). Every bump row quotes the pulse against this × the static wheel load; the checks are NOT capped to it (a square 1" step at jogging pace is physically above it).',
  },
  failSafeFactor: {
    label: 'Fail-safe factor on ultimate (hard hit)', group: 'factors', unit: '×',
    default: 1.25, min: 1, max: 2, step: 0.05, status: 'assumed', ref: 'D-54',
    note: 'Orchestrator decision: hard-hit rows compare to ultimate / this (1.25).',
  },

  // ── Phase 3b WS-D: material strengths and detail sizes for the front-end rows (analysis/front-end.ts, linkage.ts). Hard-hit rows use the ultimate values. ──
  axleUltimatePsi: {
    label: 'Axle steel ultimate strength', group: 'factors', unit: 'psi',
    default: 85000, min: 45000, max: 140000, step: 1000, status: 'assumed', ref: 'D-54',
    note: 'Companion of axleYieldPsi (1045 cold-finished ~ 91 ksi nominal; 85 ksi assumed). Hard-hit rear axle row.',
  },
  ss316BoltYieldPsi: {
    label: '316 stainless bolt yield (cold-worked F593)', group: 'factors', unit: 'psi',
    default: 65000, min: 30000, max: 100000, step: 1000, status: 'assumed', ref: 'D-43, D-54',
    note: 'ASTM F593 condition CW, 65 ksi min yield for 3/8 in and under. Allowable tension = yield / steel safety factor. (Was kingpinCrossBoltYieldPsi.)',
  },
  grade8BoltYieldPsi: {
    label: 'SAE grade 8 bolt yield', group: 'factors', unit: 'psi',
    default: 130000, min: 30000, max: 150000, step: 5000, status: 'verify', ref: 'D-43, D-54',
    note: 'Grade 8 = 130 ksi yield, 150 ksi tensile. (Was kingpinPlateBoltYieldPsi / kingpinYieldPsi.)',
  },
  grade8BoltUltimatePsi: {
    label: 'SAE grade 8 bolt ultimate', group: 'factors', unit: 'psi',
    default: 150000, min: 60000, max: 170000, step: 5000, status: 'assumed', ref: 'D-54',
  },
  bracketSteelYieldPsi: {
    label: 'Bracket / plate steel yield strength', group: 'factors', unit: 'psi',
    default: 36000, min: 30000, max: 60000, step: 1000, status: 'assumed', ref: 'D-54',
    note: 'A36 plate: the foot-brake pivot brackets.',
  },
  bracketSteelUltimatePsi: {
    label: 'Bracket / plate steel ultimate strength', group: 'factors', unit: 'psi',
    default: 58000, min: 40000, max: 80000, step: 1000, status: 'assumed', ref: 'D-54',
  },
  holdDownBoltUltimatePsi: {
    label: 'Rear beam hold-down bolt ultimate strength (316)', group: 'factors', unit: 'psi',
    default: 90000, min: 50000, max: 150000, step: 1000, status: 'assumed', ref: 'D-54',
    note: 'Companion of ss316BoltYieldPsi for the hard-hit rear-beam-seat row (316 stainless, cold-worked A4-70 about 100 ksi).',
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

/**
 * Resolve derived-by-rule params. D-54 removed the auto nose geometry (the hull has straight parallel sides now), so this is the identity; every consumer (model, layout,
 * validator, analysis) still calls it first, so a future derived param has one home.
 */
export function resolveParams(p: Params): Params {
  return p;
}

/** Rider foot box (D-3 mannequin: foot length 0.14 of stature, the foot stop's rear face at seatX + leg reach): the x range the hull must be wide enough for. */
export function footZoneX(p: Params): [number, number] {
  const stopRear = p.seatXIn + p.riderLegReachIn - p.footStopThickIn / 2;
  return [stopRear - 0.14 * p.riderStatureIn, stopRear];
}

/**
 * The curled bow (D-54): the deck runs flat to `xFlatEnd`, where a bent-lamination panel carries on and curls up on the centerline radius `radius` through `angleRad`.
 * Plain numbers so the validator, the layout and the model agree. `rise` is the height of the tip's centerline above the flat deck centerline.
 */
export function bowCurl(p: Params) {
  const radius = p.bowCurlRadiusIn;
  const angleRad = (p.bowCurlAngleDeg * Math.PI) / 180;
  const xTip = p.wheelbaseIn + p.frontOverhangIn;
  const run = radius * Math.sin(angleRad);
  const rise = radius * (1 - Math.cos(angleRad));
  const thick = p.bowCurlPlies * p.bowCurlPlyIn;
  const rIn = radius - thick / 2; // radius of the concave (upper, inside) face
  return { radius, angleRad, xTip, run, rise, thick, rIn, riseInner: rIn * (1 - Math.cos(angleRad)), xFlatEnd: xTip - run };
}

/** Height above the deck top of the straight side-profile line at x (before the optional sag), from `sideHeightRearIn` at the rear transom's inner face to `sideHeightBowIn` at `xEnd`. */
export function sideHeightAt(p: Params, x: number, xRearFace: number, xEnd: number): number {
  const u = Math.max(0, Math.min(1, (x - xRearFace) / Math.max(1e-6, xEnd - xRearFace)));
  return p.sideHeightRearIn + (p.sideHeightBowIn - p.sideHeightRearIn) * u - 4 * p.sideProfileSagIn * u * (1 - u);
}

/** Actual ply thickness of a bent lamination `t` thick glued from plies of about `ply`. */
export function lamPly(t: number, ply: number): number {
  return t / Math.max(1, Math.round(t / Math.max(0.01, ply)));
}

/**
 * The pivoting front axle (D-56) in plain numbers, so the validator, the layout, the model and the analysis agree. One kingpin at the beam center; the whole axle
 * turns, both wheels stay parallel (no Ackermann). Heights are z above the ground; `deckBot` is the deck underside.
 */
export function steerGeometry(p: Params) {
  const DEG = Math.PI / 180;
  const lock = p.steerLockDeg * DEG;
  const r = p.wheelDiameterIn / 2;
  const kingX = p.wheelbaseIn;
  const trk = p.frontTrackIn;
  const tw = p.tireWidthIn;
  const bodyHalf = p.bodyWidthIn / 2;
  const deckBot = p.deckHeightIn - p.deckPlyIn;
  // Tire vs body at full lock: the inner rear (or front) corner of the tire swings toward the side of the body.
  const innerFace = trk / 2 - tw / 2;
  const clearAtLock = innerFace * Math.cos(lock) - r * Math.sin(lock) - bodyHalf;
  const minTrack = 2 * ((bodyHalf + p.steerClearIn + r * Math.sin(lock)) / Math.cos(lock) + tw / 2);
  // Turning: the axle line meets the rear axle line at the turning center.
  const sinL = Math.max(1e-6, Math.sin(lock));
  const centerRadiusIn = p.wheelbaseIn / Math.max(1e-6, Math.tan(lock));
  const outerEdgeRadiusIn = p.wheelbaseIn / sinL + trk / 2 + tw / 2;
  const innerEdgeRadiusIn = Math.max(0, p.wheelbaseIn / sinL - trk / 2 - tw / 2);
  // Vertical stack at the kingpin (underslung beam, axle rod in a top groove, as at the rear).
  const beamTop = r + p.axleDiameterIn / 2;
  const beamBot = beamTop - p.axleBeamDepthIn;
  const tongueTop = beamTop + p.tongueThickIn;
  const thrustTop = tongueTop + p.kingThrustThickIn;
  const kingBot = thrustTop;
  const kingDepth = deckBot - kingBot;
  // The axle beam sweeps under the rails at the lock angle: the rails are shallower where it passes.
  const railYIn = bodyHalf - p.railThicknessIn;
  const swathHalf = (p.axleBeamThicknessIn / 2) * Math.cos(lock) + bodyHalf * Math.sin(lock); // at the rail's OUTER face (|y| = bodyHalf), where the beam's trailing corner reaches furthest back
  const railDepthFront = Math.max(0, Math.min(p.railDepthIn, deckBot - (beamTop + 0.4)));
  const railStepX = kingX - swathHalf - 1;
  // Stop blocks hang under the ends of the end joist (under the scarf of the deck to the bow curl): the beam's leading face meets the stop at the lock angle.
  const c = bowCurl(p);
  const endJoistX = c.xFlatEnd - p.crossmemberThickIn / 2 - 0.05;
  const stopFaceX = endJoistX - p.crossmemberThickIn / 2;
  const stopY1 = (stopFaceX - kingX - (p.axleBeamThicknessIn / 2) * Math.cos(lock)) / sinL;
  return { lock, kingX, clearAtLock, minTrack, centerRadiusIn, outerEdgeRadiusIn, innerEdgeRadiusIn, beamTop, beamBot, tongueTop, thrustTop, kingBot, kingDepth, railYIn, swathHalf, railDepthFront, railStepX, endJoistX, stopFaceX, stopY1 };
}

/** Derived quantities that many modules need; no geometry here. */
export function derived(p: Params) {
  const okoume = p.plySpecies === PLY_SPECIES.okoumeMarine;
  const t = (p.wheelDiameterIn - 10) / 3;
  const wheelMassLb =
    p.wheelMass10Lb + t * (p.wheelMass13Lb - p.wheelMass10Lb) +
    (p.tireType === TIRE_TYPE.flatFree ? p.flatFreeExtraLb : 0);
  // Half-width of a wheel assembly beyond its center plane: tire, or hub + axle end.
  const wheelOuterHalfIn = Math.max(p.tireWidthIn / 2, p.hubLengthIn / 2 + p.axleEndExtraIn);
  const rodR = p.axleDiameterIn / 2;
  return {
    plyDensityPcf: okoume ? p.okoumeDensityPcf : p.birchDensityPcf,
    plyMoePsi: okoume ? p.okoumeMoePsi : p.birchMoePsi,
    plyDesignMorPsi: ((okoume ? p.okoumeMorPsi : p.birchMorPsi) * p.wetServiceFactorStrength) / p.woodSafetyFactor,
    wheelMassLb,
    wheelRadiusIn: p.wheelDiameterIn / 2,
    /** Body length, rear transom to the bow tip. */
    bodyLengthIn: p.rearOverhangIn + p.wheelbaseIn + p.frontOverhangIn,
    /** Body length plus the tongue that reaches past the bow (D-56); the tongue unbolts for transport. */
    overallLengthIn: p.rearOverhangIn + p.wheelbaseIn + p.frontOverhangIn + p.tongueTieAheadIn,
    wheelOuterHalfIn,
    /** Overall width across the wider axle, outside the wheel assemblies. */
    overallWidthIn: Math.max(p.frontTrackIn, p.rearTrackIn) + 2 * wheelOuterHalfIn,
    maxTrackBesideWells: p.truckWellGapIn - 2 * wheelOuterHalfIn - 2 * p.truckClearanceIn,
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
  severity: 'error' | 'warn' | 'info';
  message: string;
}

/**
 * Cross-parameter sanity rules. Errors mean the geometry is impossible or
 * degenerate; warnings mean a check is likely to fail. The full pass/fail
 * engineering checks live in src/analysis (Phase 2).
 */
export function validateParams(input: Params): ParamIssue[] {
  const p = resolveParams(input);
  const issues: ParamIssue[] = [];
  const err = (keys: ParamKey[], message: string) => issues.push({ keys, severity: 'error', message });
  const warn = (keys: ParamKey[], message: string) => issues.push({ keys, severity: 'warn', message });
  const info = (keys: ParamKey[], message: string) => issues.push({ keys, severity: 'info', message });
  const r = p.wheelDiameterIn / 2;
  const curl = bowCurl(p);
  const deckBot = p.deckHeightIn - p.deckPlyIn;

  if (p.riderGoalMassLb < p.riderMassLb)
    warn(['riderGoalMassLb', 'riderMassLb'], 'The operating rider is heavier than the goal rider; the 200 lb goal checks no longer cover the heaviest case (the Simple view sweeps every weight).');
  if (p.targetMassMinLb > p.targetMassMaxLb)
    err(['targetMassMinLb', 'targetMassMaxLb'], 'Mass target low end exceeds high end.');
  // The rear wheels run beside the straight body (no wheel wells).
  const rearInnerTire = p.rearTrackIn / 2 - p.tireWidthIn / 2;
  if (p.bodyWidthIn / 2 + 0.75 > rearInnerTire)
    err(['bodyWidthIn', 'rearTrackIn'], 'The body is too wide to clear the rear tires (needs ≥ ¾" each side).');
  if (p.seatXIn < 0 && p.rearOverhangIn < -p.seatXIn + 6)
    err(['seatXIn', 'rearOverhangIn'], 'Seat hangs off the back of the body.');
  if (p.seatXIn + p.riderLegReachIn > curl.xFlatEnd)
    err(['seatXIn', 'riderLegReachIn', 'frontOverhangIn', 'bowCurlRadiusIn'], 'The rider\'s feet extend onto the bow curl (the flat deck ends at x = ' + curl.xFlatEnd.toFixed(1) + '").');
  // The seat and the foot stop stand on the flat deck.
  const cushionFront = p.seatXIn - p.seatBehindHpointIn + p.seatDepthIn;
  if (cushionFront > curl.xFlatEnd - 0.01)
    err(['seatXIn', 'seatDepthIn', 'frontOverhangIn'], `The seat cushion (front at x = ${cushionFront.toFixed(1)}") runs past the flat deck (it ends at x = ${curl.xFlatEnd.toFixed(1)}"). Move the seat back or shorten it.`);
  const a = (p.seatBackAngleDeg * Math.PI) / 180;
  const backRear = p.seatXIn - p.seatBehindHpointIn - p.seatBackThickIn * Math.cos(a) - p.seatBackHeightIn * Math.sin(a);
  const transomFront = -p.rearOverhangIn + p.transomThicknessIn;
  if (backRear < transomFront + 0.01)
    err(['seatXIn', 'rearOverhangIn', 'seatBackHeightIn', 'seatBackAngleDeg'],
      `The leaning seat back would hit the rear transom (its top reaches ${backRear.toFixed(1)}" from the rear axle; the transom is at ${transomFront.toFixed(1)}").`);
  if (p.storageLocation === STORAGE_LOCATION.rearOverAxle) {
    const room = p.seatXIn - p.seatBehindHpointIn - p.seatBackThickIn * Math.cos(a) - transomFront - p.blockingThickIn; // minus the corner-backer lane behind the box (D-43)
    if (room < MIN_REAR_STORAGE_LENGTH_IN)
      err(['seatXIn', 'rearOverhangIn', 'storageLocation'],
        `Only ${room.toFixed(1)}" between the rear transom and the seat back; a rear storage box needs ≥ ${MIN_REAR_STORAGE_LENGTH_IN}". Move the seat forward or choose another storage location.`);
  }
  // The foot stop (a board of footStopThickIn at seatX + leg reach) and its cleats stand on the flat deck.
  const footStopFront = p.seatXIn + p.riderLegReachIn + p.footStopThickIn / 2;
  if (footStopFront > curl.xFlatEnd - 0.5 + 1e-9)
    err(['seatXIn', 'riderLegReachIn', 'frontOverhangIn', 'bowCurlRadiusIn', 'bowCurlAngleDeg'],
      `The foot stop reaches ${footStopFront.toFixed(2)}" ahead of the rear axle; the flat deck ends at ${curl.xFlatEnd.toFixed(2)}" (needs ½" to spare for the front joist). Move the seat back, lengthen the front overhang or use a smaller curl.`);
  // The rider's feet go through the body to the foot stop.
  const footSpan = (2 * RIDER_LEG_Y_FRAC + RIDER_FOOT_Y_FRAC) * p.riderStatureIn;
  const footNeed = footSpan + 2 * p.bootAllowanceIn + 0.25;
  const inner = p.bodyWidthIn - 2 * p.sideThicknessIn;
  if (inner < footNeed)
    err(['bodyWidthIn', 'riderStatureIn', 'bootAllowanceIn'],
      `The body is only ${inner.toFixed(1)}" wide inside; the rider's feet need ≥ ${footNeed.toFixed(1)}" at this stature (feet ${footSpan.toFixed(1)}" + ${p.bootAllowanceIn}" boot allowance per side + ¼" play). Widen the body.`);
  // The grab handles slide aft to stay clear of the sloped gunwale's lash points; they must still reach the rider (as before).
  // Side profile (D-54).
  if (p.sideHeightBowIn > p.sideHeightRearIn)
    warn(['sideHeightBowIn', 'sideHeightRearIn'], 'The sled profile is meant to be low at the bow and tall at the rear (reference/05).');
  if (p.sideHeightBowIn - 2 * p.railBandIn < 1)
    err(['sideHeightBowIn', 'railBandIn'], 'The side panel at the bow would be shorter than 1". Raise the bow side or thin the chine and gunwale.');
  if (p.sideHeightBowIn > curl.riseInner - 0.2 + 1e-9)
    err(['sideHeightBowIn', 'bowCurlRadiusIn', 'bowCurlAngleDeg'], `The sides end against the curl where it has risen to the side height; the curl's inside face only rises ${curl.riseInner.toFixed(1)}" (side at the bow ${p.sideHeightBowIn}"). Lower the bow side, or use a bigger or steeper curl.`);
  // Bow curl lamination: inside radius vs the cold-bend limit.
  {
    const ply = lamPly(curl.thick, p.bowCurlPlyIn);
    const rIn = curl.radius - curl.thick / 2;
    const lim = p.hullLamMinRadiusFactor * ply;
    if (rIn < lim - 1e-9)
      err(['bowCurlRadiusIn', 'bowCurlPlyIn', 'bowCurlPlies', 'hullLamMinRadiusFactor'],
        `The bow curl's inside radius ${rIn.toFixed(1)}" is tighter than the cold-bend limit ${lim.toFixed(1)}" (${p.hullLamMinRadiusFactor} x ${ply.toFixed(3)}" ply): use a bigger radius, thinner plies or steam it.`);
  }
  // Captured-ply grooves (D-35): the oak walls left each side of the groove must stay sturdy.
  {
    const wall = (p.sideThicknessIn - p.panelPlyIn - p.grooveSlopIn) / 2;
    if (wall < 0.1)
      warn(['sideThicknessIn', 'panelPlyIn', 'grooveSlopIn'], `A ${p.panelPlyIn}" panel in a ${p.sideThicknessIn}" chine/gunwale leaves ${Math.max(0, wall).toFixed(3)}" walls beside the groove (want ≥ 0.1"). Thicken the side stock or thin the panel.`);
  }
  // ── Front end: the pivoting soapbox axle (D-56). The wheels run beside the body; the lock angle sets a minimum track, the stack under the deck sets the king beam depth. ──
  const sg = steerGeometry(p);
  const frontInnerTire = p.frontTrackIn / 2 - p.tireWidthIn / 2;
  if (p.bodyWidthIn / 2 + 0.75 > frontInnerTire)
    err(['bodyWidthIn', 'frontTrackIn'], 'The body is too wide to clear the front tires (needs ≥ ¾" each side).');
  else if (sg.clearAtLock < p.steerClearIn - 1e-9)
    err(['frontTrackIn', 'steerLockDeg', 'bodyWidthIn', 'steerClearIn'], `At full lock (${p.steerLockDeg}°) the front tire corner swings to ${sg.clearAtLock.toFixed(2)}" from the side of the body; it needs ${p.steerClearIn}". Widen the front track to at least ${sg.minTrack.toFixed(1)}", reduce the lock or narrow the body.`);
  if (sg.kingDepth < 1 - 1e-9)
    err(['deckHeightIn', 'kingThrustThickIn', 'tongueThickIn', 'axleBeamDepthIn'], `The pivot stack (axle beam top ${sg.beamTop.toFixed(2)}" + tongue plate + thrust washer) leaves only ${sg.kingDepth.toFixed(2)}" for the king beam under the deck; raise the deck to at least ${(sg.kingBot + 1 + p.deckPlyIn).toFixed(2)}".`);
  if (sg.railDepthFront < 1 - 1e-9)
    err(['deckHeightIn', 'railDepthIn'], `The rails would be only ${sg.railDepthFront.toFixed(2)}" deep where the axle beam swings under them; raise the deck.`);
  if (p.wheelbaseIn + 3 > curl.xFlatEnd + 1e-9)
    err(['wheelbaseIn', 'frontOverhangIn'], 'The front axle runs onto the bow curl: lengthen the front overhang.');
  {
    const railIn = sg.railYIn;
    if (sg.stopY1 < 2.5 || sg.stopY1 > railIn - 1)
      err(['steerLockDeg', 'wheelbaseIn', 'frontOverhangIn', 'axleBeamThicknessIn'], `The steering stops (under the end joist) would meet the axle beam ${sg.stopY1.toFixed(1)}" from the center; they must be between 2.5" and ${(railIn - 1).toFixed(1)}" (the rail inner face less 1"). Move the front axle or change the lock.`);
    if (p.kingThrustOdIn / 2 + p.tongueBoltDiaIn / 2 + 0.1 > 2 && p.kingThrustOdIn > p.tongueHeadWidthIn - 1)
      warn(['kingThrustOdIn', 'tongueHeadWidthIn'], 'The thrust washer is nearly as wide as the tongue plate head; the two plate bolts need room outside it.');
  }
  // ── Rear axle stack (D-15, D-54) ──
  const beamBottom =
    p.axleBeamPosition === AXLE_BEAM_POSITION.underslung
      ? r + p.axleDiameterIn / 2 - p.axleBeamDepthIn
      : r - p.axleDiameterIn / 2;
  if (beamBottom < p.minGroundClearanceIn)
    warn(['axleBeamDepthIn', 'axleBeamPosition', 'minGroundClearanceIn'],
      `Axle beam bottom at ${beamBottom.toFixed(2)}" is below the ${p.minGroundClearanceIn}" ground clearance.`);
  const beamTop = beamBottom + p.axleBeamDepthIn;
  if (beamTop + p.deckPlyIn > p.deckHeightIn + 0.01)
    err(['deckHeightIn', 'axleBeamDepthIn'], `Rear axle beam + ply needs the deck at ≥ ${(beamTop + p.deckPlyIn).toFixed(2)}"; it is ${p.deckHeightIn}".`);
  if (p.axleBeamPosition === AXLE_BEAM_POSITION.underslung && deckBot - p.railDepthIn < beamTop + 0.3)
    info(['railDepthIn'], 'The rails reach the rear beam; the axle hangers are very short.');
  // Rear axle beam (critic r2 H2): wood left beside the rod groove must be real wood.
  const d = derived(p);
  if (d.rearBeamLigamentIn < p.beamLigamentMinIn - 1e-9)
    err(['axleBeamThicknessIn', 'beamLigamentMinIn'],
      `Rear axle beam is ${p.axleBeamThicknessIn}" wide: only ${d.rearBeamLigamentIn.toFixed(2)}" of wood is left each side of the rod groove; it needs ≥ ${p.beamLigamentMinIn}".`);
  if (p.axleHangerWidthIn < p.axleBeamThicknessIn + 2 * p.beamNotchClearIn + 2 * 0.75 - 1e-9)
    err(['axleHangerWidthIn', 'axleBeamThicknessIn'], 'The axle hanger is too narrow: it needs 3/4" of oak each side of the beam notch.');
  // Rear U-bolt plates sit at the beam ends; the hangers and rails above must stay inboard of them (critic r2 M3).
  {
    const beamLen = Math.max(1, p.rearTrackIn - p.hubLengthIn - 0.25);
    const clampInner = Math.min(beamLen / 2 - 0.25, p.rearTrackIn / 2 - p.tireWidthIn / 2) - p.clampPlateWidthIn;
    if (p.bodyWidthIn / 2 > clampInner + 1e-6)
      err(['bodyWidthIn', 'rearTrackIn', 'clampPlateWidthIn'],
        `The rails/sides reach ${(p.bodyWidthIn / 2).toFixed(2)}" off center but the rear U-bolt plates start at ${clampInner.toFixed(2)}"; narrow the body or widen the track.`);
  }

  // Truck.
  if (d.overallWidthIn + 2 * p.truckClearanceIn > p.truckWellGapIn)
    warn(['rearTrackIn'],
      `Overall width ${d.overallWidthIn.toFixed(2)}" does not fit between the wheel wells with clearance (max track ${d.maxTrackBesideWells.toFixed(2)}"); only "straddle" stowage would work (D-6).`);
  if (p.truckWellStartIn + p.truckWellLengthIn > p.truckBedLengthIn)
    err(['truckWellStartIn', 'truckWellLengthIn', 'truckBedLengthIn'], 'Wheel wells extend past the bed.');
  if (p.truckWellGapIn > p.truckBedWidthIn)
    err(['truckWellGapIn', 'truckBedWidthIn'], 'Wheel-well gap is wider than the bed.');
  if (p.axleStyle === AXLE_STYLE.stubAxles && p.axleBeamDepthIn < 2.5)
    warn(['axleStyle', 'axleBeamDepthIn'], 'Stub axles need a deeper beam (≥ 2½") to resist the cantilever moment.');
  if (d.bodyLengthIn > d.truckUsableLengthIn - p.truckClearanceIn)
    err(['wheelbaseIn', 'rearOverhangIn', 'frontOverhangIn'], 'Body is longer than bed + tailgate.');
  // ── Foot brake (D-55) ──
  {
    const bt = p.brakeShoeAngleDeg * Math.PI / 180;
    // lowest corner of the lining must clear the ground by the minimum clearance
    const lowShoe = r - r * Math.sin(bt + p.brakeLinedShoeLengthIn / (2 * r));
    if (lowShoe < p.minGroundClearanceIn - 1e-9)
      warn(['brakeLinedShoeLengthIn', 'brakeShoeAngleDeg', 'minGroundClearanceIn'], `The lowest corner of the brake shoe lining is ${lowShoe.toFixed(2)}" off the ground, below the ${p.minGroundClearanceIn}" ground clearance: shorten the shoe or raise it (a smaller angle below the axle line).`);
    if (p.brakeBarClearIn < p.minGroundClearanceIn - 1e-9)
      warn(['brakeBarClearIn', 'minGroundClearanceIn'], `The brake pedal arms hang ${p.brakeBarClearIn}" off the ground, below the ${p.minGroundClearanceIn}" ground clearance.`);
    // the pivot hole must clear the slot for the shoe beam (about half the beam height + a 0.55" web and hole radius above the shoe)
    if (p.brakePivotAboveShoeIn < p.brakeBeamHeightIn / 2 + 0.6 - 1e-9)
      err(['brakePivotAboveShoeIn', 'brakeBeamHeightIn'], `The brake arm pivot is only ${p.brakePivotAboveShoeIn}" above the shoe: the pivot hole would run into the ${p.brakeBeamHeightIn}" shoe beam slot (needs at least ${(p.brakeBeamHeightIn / 2 + 0.6).toFixed(2)}").`);
    // the latch stud must be able to reach the hook on the rear transom without being a long cantilever, and the pedal bar must be behind the transom
    const barFront = -r * Math.cos(bt) - p.brakePedalReachIn + p.brakePedalDepthIn / 2 + p.brakeGuardThickIn;
    const studLen = -p.rearOverhangIn - 0.39 - barFront + 0.25;
    if (studLen < 0.3)
      err(['rearOverhangIn', 'brakePedalReachIn', 'brakePedalDepthIn'], `The pedal bar is too close to the rear transom: the latch stud would stick out only ${studLen.toFixed(1)}" (it needs at least 0.3") to reach the hook (move the pedal bar back with brakePedalReachIn, or the transom forward).`);
    else if (studLen > 3.5)
      warn(['rearOverhangIn', 'brakePedalReachIn', 'brakePedalDepthIn'], `The brake latch stud would stick out about ${studLen.toFixed(1)}" to reach the hook on the rear transom (the brake-clear row wants at most 3.5"): move the pedal bar (brakePedalReachIn) or the transom (rearOverhangIn).`);
    // the pivot bracket flange lies on the top of the axle beam between the hanger and the rod clamp plates
    const clampInner = Math.min(Math.max(1, p.rearTrackIn - p.hubLengthIn - 0.25) / 2 - 0.25, p.rearTrackIn / 2 - p.tireWidthIn / 2) - p.clampPlateWidthIn;
    if (p.bodyWidthIn / 2 + p.brakePlateThickIn + 2 + 0.1 > clampInner)
      warn(['bodyWidthIn', 'rearTrackIn', 'clampPlateWidthIn', 'hubLengthIn'], `The brake pivot bracket flange (2" wide, on the axle beam top) does not fit between the hull side and the rod clamp plates, which start at ${clampInner.toFixed(2)}": widen the track or narrow the body (the brake-clear row also flags it).`);
  }
  void info; void footZoneX;
  return issues;
}
