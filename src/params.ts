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
 * View-only state (e.g. the displayed steer angle) does NOT live here; it is
 * passed to buildModel() separately so it never pollutes the design.
 */

import { kingpinPlateIssues, kingpinPlatePlan, stopArmHx } from './model/kingpin-plates';
import { planStops } from './model/stops';
import { buildPlanCurve, curveTireGap, latestCurveEnd, offsetY, type CurveClearanceSpec } from './model/hull-curve';

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
  riderMinMassLb: {
    label: 'Lightest rider mass (pitch-back case)', group: 'loads', unit: 'lb',
    default: 80, min: 40, max: 150, step: 5, status: 'assumed', ref: 'D-1',
    note: 'BRIEF §4.1: scouts run 80–150 lb. Rows that get worse with a lighter rider (rearward pitch) are also evaluated here (critic Phase 2 r1, H3).',
  },
  curbHeightIn: {
    label: 'Curb height (front-wheel strike)', group: 'loads', unit: 'in',
    default: 3, min: 1, max: 5, step: 0.5, status: 'assumed', ref: 'D-2',
    note: 'Step the front wheel(s) strike at walking speed; same as the Phase 2 sim curb. Horizontal force = V·tan φ, cos φ = (r − h)/r.',
  },
  rootHeightIn: {
    label: 'Root height (front-wheel strike)', group: 'loads', unit: 'in',
    default: 2, min: 0.5, max: 4, step: 0.5, status: 'assumed', ref: 'D-2',
    note: 'Same as the Phase 2 sim root. Struck by both front wheels (a root runs across the trail) or by one.',
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
    label: 'Body overhang ahead of front axle', group: 'layout', unit: 'in',
    default: 8.5, min: 0, max: 20, step: 0.5, status: 'explore', ref: 'D-43',
    note: '8.5" (was 8"): the turntable corner, kingpin lead and the ¾" front transom need ≥ 8.25" (D-43).',
  },
  deckHeightIn: {
    label: 'Deck (floor top) height, between axles', group: 'layout', unit: 'in',
    default: 9, min: 6, max: 16, step: 0.25, status: 'explore', primary: true, ref: 'D-15',
    note: 'Must clear the axle/beam/turntable stack; see validateParams().',
  },
  frontDeckRaiseIn: {
    label: 'Forward deck raise over front axle', group: 'layout', unit: 'in',
    default: 1, min: 0, max: 8, step: 0.25, status: 'explore', ref: 'D-15',
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
  autoNoseGeometry: {
    label: 'Auto nose width & shoulder', group: 'body', unit: '',
    default: 1, min: 0, max: 1, step: 1, status: 'explore', ref: 'A-4',
    options: [
      { value: 0, label: 'Manual (use the two values below)' },
      { value: 1, label: 'Auto (derive from front track, lock, lead)' },
    ],
    note: 'Auto sets the nose width to the widest the swing limit allows (1/8" down, ≤ cabin width) and the shoulder to the nearest valid 1/8" behind the swing; resolveParams() applies it everywhere (D-26).',
  },
  noseWidthIn: {
    label: 'Hull width in the front-wheel swing zone', group: 'body', unit: 'in',
    default: 13.5, min: 12, max: 18, step: 0.25, status: 'explore', ref: 'D-15',
    note: 'Overridden while "Auto nose width & shoulder" is on (resolveParams). Must hold the rider\'s feet + boots (bootAllowanceIn) and be ≤ 2 × (inner tire corner y at full lock − steering clearance); see A-4.',
  },
  noseTaperStartIn: {
    label: 'Hull reaches nose width this far behind front axle', group: 'body', unit: 'in',
    default: 13.25, min: 12, max: 26, step: 0.5, status: 'explore', ref: 'A-4, D-45',
    note: 'The END of the plan S-curve (D-45), measured from the front AXLE. Overridden while "Auto nose width & shoulder" is on: resolveParams() finishes the curve as late as the front-tire sweep (full lock) plus steering clearance allows. Old links that saved the square-shoulder distance still load; the validator reports a curve that would hit a tire.',
  },
  hullCurveStartIn: {
    label: 'S-curve starts (cabin begins to narrow) at x', group: 'body', unit: 'in',
    default: 18, min: 8, max: 34, step: 0.5, status: 'explore', ref: 'D-45',
    note: 'Model x of the start of the plan S-curve that blends the cabin side into the nose side (D-45). The cabin stays full width (and straight) up to here: the seat, grab handles, lash points, reflectors and storage box all sit behind it. The curve end is derived from the tire sweep (noseTaperStartIn). An earlier start gives a gentler curve (larger bend radius). With "Auto nose width & shoulder" on, the rule moves the start EARLIER (never later) if the curve would otherwise be tighter than the lamination limit.',
  },
  hullLamThicknessIn: {
    label: 'Hull lamination strip thickness (chine, gunwale, rails)', group: 'body', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-45',
    note: 'The chine, gunwale and ladder rails are bent laminations of white-oak strips this thick, glued on a plan-view form (epoxy, slow hardener). The number of plies is member thickness / strip.',
  },
  hullLamMinRadiusFactor: {
    label: 'Min. bend radius / strip thickness', group: 'body', unit: '×',
    default: 40, min: 20, max: 100, step: 5, status: 'assumed', ref: 'D-45',
    note: 'White oak (and okoume ply sheets) lay up cold without steaming above this ratio; the validator flags a tighter hull curve (the inside face of the lamination is the tightest).',
  },
  hullWebPlies: {
    label: 'Side-panel sheets in the curve', group: 'body', unit: '',
    default: 2, min: 1, max: 3, step: 1, status: 'assumed', ref: 'D-45',
    note: 'The curved 6 mm okoume web is laminated from this many thin sheets (2 x 3 mm) around the same form, so it can take the curve (min radius = factor x one sheet). 1 = a single 6 mm sheet, which does not bend this tight cold.',
  },
  deckSlopIn: {
    label: 'Deck rabbet / dado clearance over the ply', group: 'body', unit: 'in',
    default: 0.04, min: 0, max: 0.08, step: 0.004, status: 'assumed', ref: 'D-45',
    note: 'The deck rabbet in the chine and the dado in each transom are cut this much taller than the (epoxy-sealed) deck so the sealed panel enters its own rabbet; thickened epoxy fills the gap (build review MUST-2).',
  },
  shoulderBeamIn: {
    label: 'Shoulder beam thickness (under the deck step)', group: 'body', unit: 'in',
    default: 1.5, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-45',
    note: 'A full-width oak beam under the 1" deck step, just behind where the S-curve ends. Both rail pairs Domino into it, the cabin deck butts its rear face and the nose deck sits on it: the cabin-to-nose structural tie (build review MUST-1).',
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
    note: 'IGNORED since D-45: the S-curve hull has vertical sides (the web is laminated around a plan-view form, so it cannot also lean). Kept so old links load; the validator warns when it is set.',
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
    note: 'Epoxy-lined holes through the deck at the rear corners and the nose low point, each with a stainless nipple so no cut ply edge is exposed.',
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
  curbStrikeG: {
    label: 'Curb-strike deceleration (foot-stop load)', group: 'factors', unit: 'g',
    default: 2, min: 1, max: 4, step: 0.25, status: 'assumed', ref: 'D-43',
    note: 'Forward deceleration when a front wheel hits a curb; the rider is restrained by the foot stop, the grab handles and seat friction.',
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
  sheerRiseIn: {
    label: 'Sheer: gunwale rise at the bow', group: 'body', unit: 'in',
    default: 2.5, min: 0, max: 4, step: 0.25, status: 'assumed', ref: 'D-44',
    note: 'The nose gunwale (and the side panel top, the front transom top) climbs this far above the flat side height toward the bow, on a smooth curve that starts flat. 0 reproduces the straight gunwale. The rear and cabin keep their heights (seat, grab handles, storage box, handle sockets); the structural checks read the lowest section (side height), which is conservative.',
  },
  sheerLengthIn: {
    label: 'Sheer: length of the rise (from the bow back)', group: 'body', unit: 'in',
    default: 18, min: 6, max: 30, step: 1, status: 'assumed', ref: 'D-44',
    note: 'The rise starts this far behind the front transom (never behind the cabin shoulder). Keep it shorter than the nose minus the finger-guard zone, so the guard sits on the flat gunwale.',
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
  fingerGapMinIn: {
    label: 'No-pinch gap between tire and hull', group: 'body', unit: 'in',
    default: 1.5, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-37',
    note: 'A gap narrower than this at any steering angle needs a guard over it (M5).',
  },
  fingerGuardClearIn: {
    label: 'Finger-guard hood clearance above the tire top', group: 'body', unit: 'in',
    default: 0.75, min: 0.25, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-37',
    note: 'Never less than the steering clearance (steeringClearanceIn): the hood is a hull part and the steering sweep must clear it.',
  },
  fingerGuardThickIn: {
    label: 'Finger-guard printed wall thickness', group: 'body', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.1875, step: 0.0156, status: 'assumed', ref: 'D-37',
    note: 'Printed ASA bracket: hood over the pinch zone, leg in the web recess, strap on the gunwale.',
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
      { value: STORAGE_LOCATION.forwardRaised, label: 'Forward, raised over front wheels' },
      { value: STORAGE_LOCATION.underSeat, label: 'Under the seat' },
    ],
  },
  storageVolumeIn3: {
    label: 'Storage box interior volume', group: 'body', unit: 'in³',
    default: 2000, min: 800, max: 4000, step: 50, status: 'assumed', ref: 'D-19',
    note: 'Raised from 1,800 to 2,000 in³ (Phase 3 integration): the 10 Essentials packing check (D-41) filled 0.96 of the 1,762 in³ interior at 1,800, so this restores about 10% margin.',
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
  axleYieldPsi: {
    label: 'Axle steel yield strength', group: 'wheels', unit: 'psi',
    default: 70000, min: 30000, max: 120000, step: 1000, status: 'assumed', ref: 'D-4',
    note: '¾" 1045 turned-ground-polished shafting ≈ 70+ ksi (D-27; confirm vendor cert). 1018 cold-drawn would be ≈ 54 ksi.',
  },

  // ── Steering & pull ──────────────────────────────────────────────────────
  steerLockDeg: {
    label: 'Steering lock (each side)', group: 'steering', unit: '°',
    default: 37, min: 30, max: 40, step: 0.5, status: 'explore', primary: true, ref: 'D-12',
    note: 'Limited above by the nose width the rider\'s boots need (A-4) and below by the 96" turning radius (A-2).',
  },
  turntableType: {
    label: 'Turntable bearing', group: 'steering', unit: '',
    default: 2, min: 0, max: 3, step: 1, status: 'explore', ref: 'D-28',
    note: 'Presets set size, stack height, mass and rating (catalog estimates — verify against the part bought). "Custom" uses the four turntable params below.',
    options: [
      { value: 0, label: 'Custom (use the values below)' },
      { value: 1, label: '12" lazy-susan, 1000 lb' },
      { value: 2, label: '12" heavy-duty ball bearing, 1500 lb' },
      { value: 3, label: 'Steel fifth-wheel ring, 2000 lb' },
    ],
  },
  turntableSizeIn: {
    label: 'Turntable bearing size (square)', group: 'steering', unit: 'in',
    default: 12, min: 6, max: 18, step: 1, status: 'assumed', ref: 'D-12',
  },
  turntableThicknessIn: {
    label: 'Turntable bearing stack height', group: 'steering', unit: 'in',
    default: 0.5, min: 0.25, max: 1, step: 0.0625, status: 'verify', ref: 'D-12',
  },
  turntableMassLb: {
    label: 'Turntable bearing mass', group: 'steering', unit: 'lb',
    default: 5.5, min: 1, max: 8, step: 0.25, status: 'verify', ref: 'D-12',
    note: 'Estimate for the 12" heavy-duty ball-bearing plate pair (preset 2, D-35); replace with the catalog value.',
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
    label: 'Steering stop dog width (steel channel, across the flanges)', group: 'steering', unit: 'in',
    default: 1.25, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-43',
    note: 'Round 2: each stop dog is a formed steel channel (web + two upturned flanges, outsourced waterjet + brake) bolted to a riser that stands on the kingpin carrier plate INSIDE the turntable center hole, so nothing goes through the ball ring. The flange outer faces are the stops; a bonded urethane pad on each face makes the two stops share load. Each dog has a face on both sides and lands flat on a chassis stop block exactly at lock (src/model/stops.ts).',
  },
  steerStopHeightIn: {
    label: 'Steering stop dog flange height', group: 'steering', unit: 'in',
    default: 1.625, min: 0.5, max: 2, step: 0.25, status: 'assumed', ref: 'D-43',
    note: 'Clamped to the bolster depth minus the web, the running clearances and the riser. The bearing face on the stop block is this tall.',
  },
  // ── Phase 3 workstream A: steering stops, kingpin, bridle ties, front mounting (D-31…D-35) ──
  steerStopFacePlateIn: {
    label: 'Stop channel steel thickness', group: 'steering', unit: 'in',
    default: 0.375, min: 0.1875, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-43',
    note: 'A36 plate, web and flanges; the flange bends over the stop pressure (steer-stops row). Also the riser and foot plate.',
  },
  steerStopPadIn: {
    label: 'Stop face urethane pad thickness', group: 'steering', unit: 'in',
    default: 0.3125, min: 0.125, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-43',
    note: '70-80A urethane bonded to each flange face. It is the compliance that makes two stops share the yaw torque (stiffness k = E·A/t, share from fit-up mismatch) and it soaks up the impact.',
  },
  steerStopPadModulusPsi: {
    label: 'Stop pad effective compressive modulus', group: 'steering', unit: 'psi',
    default: 1500, min: 500, max: 5000, step: 100, status: 'verify', ref: 'D-43',
    note: 'Apparent modulus of a thin bonded 75A urethane pad (shape factor ~2), ~1,500 psi; test a pad (Phase 4). Lower = softer = shares better but crushes more.',
  },
  steerStopPadAllowPsi: {
    label: 'Stop pad bearing allowable', group: 'steering', unit: 'psi',
    default: 800, min: 300, max: 2000, step: 50, status: 'verify', ref: 'D-43',
    note: 'Compressive stress the urethane pad may see at the design strike (about half its 1,500 psi yield stress).',
  },
  steerStopPadYieldPsi: {
    label: 'Stop pad yield stress (bounding case)', group: 'steering', unit: 'psi',
    default: 1500, min: 500, max: 4000, step: 100, status: 'verify', ref: 'D-43',
    note: 'Compressive stress at which a thin bonded 75A urethane pad takes a set. The share-1.0 bounding row (one stop closes, the other does not) is held to this, not to the design allowable.',
  },
  steerStopRiserDepthIn: {
    label: 'Stop riser depth (radial, y)', group: 'steering', unit: 'in',
    default: 0.5, min: 0.25, max: 1, step: 0.125, status: 'assumed', ref: 'D-43',
    note: 'The short block between the stop arm and the channel web, at the turntable hole edge. The web and the riser reach this far in from the stop face, and the planner keeps that inner end clear of the crossbar at lock.',
  },
  steerStopFitMismatchIn: {
    label: 'Stop fit-up mismatch (one stop closes late)', group: 'steering', unit: 'in',
    default: 0.018, min: 0, max: 0.06, step: 0.001, status: 'assumed', ref: 'D-43',
    note: 'Residual fit-up mismatch of the two stops AFTER the feeler-gauge step (r3 N-1): 0.005" cannot be held by a shop, so the design uses a realistic 0.015-0.020" (bonded pad thickness tolerance + block seat + thermal change + pad set). The stops are adjustable (shim packs under the stop blocks, steerStopAdjustRangeIn) and the assembly step is "both pads touch a 0.003" feeler within 0.010" at lock". share = ½ + k·δ/(2·P). A mismatch of P/k closes only one stop (share 1.0, the bounding row).',
  },
  steerStopPadModulusMinPsi: {
    label: 'Stop pad modulus, soft end of the range', group: 'steering', unit: 'psi',
    default: 1000, min: 300, max: 3000, step: 100, status: 'assumed', ref: 'D-43',
    note: 'Soft bound of the pad apparent modulus (70A durometer tolerance, hot day, aging). steer-stops is evaluated at this, the nominal and the stiff value and the worst governs (r3 N-1), so no row depends on a lucky modulus.',
  },
  steerStopPadModulusMaxPsi: {
    label: 'Stop pad modulus, stiff end of the range', group: 'steering', unit: 'psi',
    default: 3000, min: 1000, max: 8000, step: 100, status: 'assumed', ref: 'D-43',
    note: 'Stiff bound: 80A durometer tolerance and a winter night (urethane roughly doubles in modulus near freezing). A stiffer pad raises the share of the late-closing stop and the net force on the kingpin.',
  },
  steerStopAdjustRangeIn: {
    label: 'Stop block shim-pack adjustment range', group: 'steering', unit: 'in',
    default: 0.0625, min: 0.03125, max: 0.25, step: 0.03125, status: 'assumed', ref: 'D-43',
    note: 'Total shim thickness available under each stop block (1/64" and 1/32" stainless shims). Must cover the fit-up mismatch (validator). Assembly step: shim until both pads of each dog touch a feeler gauge together at lock.',
  },
  kingpinTorqueTopShare: {
    label: 'Stop torque taken at the carrier bolt plane', group: 'steering', unit: '',
    default: 0.6, min: 0.5, max: 1, step: 0.05, status: 'assumed', ref: 'D-43',
    note: 'The stop torque enters the carrier; two welded shear ears (kp-ear) tie the carrier to the beam plate so the under plane takes the rest (r3 N-1). 0.5 if both planes were equally stiff; 0.6 covers the ear/weld compliance. 1.0 = no ears.',
  },
  kingpinEarThickIn: {
    label: 'Shear ear web thickness', group: 'steering', unit: 'in',
    default: 0.25, min: 0.1875, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-43',
    note: 'A36 web in the fore-aft/vertical plane, welded to a tab of the carrier above and a tab of the beam plate below, standing in front of the beam face. In-plane shear carries the torque share between the two plates.',
  },
  kingpinEarProjectIn: {
    label: 'Shear ear projection ahead of the beam face', group: 'steering', unit: 'in',
    default: 0.75, min: 0.5, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-43',
    note: 'How far the ear web (and the plate tabs) reach forward of the beam front face; kept short of the bridle rope.',
  },
  kingpinEarWeldIn: {
    label: 'Shear ear fillet weld leg', group: 'steering', unit: 'in',
    default: 0.1875, min: 0.125, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-43',
    note: 'Fillet weld leg, both sides of the web at both plates, E70 filler.',
  },
  kingpinPlateBoltPreloadLb: {
    label: 'Plate bolt preload (target)', group: 'steering', unit: 'lbf',
    default: 1500, min: 500, max: 4000, step: 100, status: 'assumed', ref: 'D-43',
    note: 'About 25% of proof for a 5/16 grade 8 bolt, limited by oak crush under the plates (clamp pressure row). Torque = K·D·F with K = kingpinPlateBoltNutFactor, ~8 lb·ft lubricated. Two Belleville washers under each nut hold it as the oak shrinks; retorque after the first wet day.',
  },
  kingpinPlatePreloadRetainedFrac: {
    label: 'Plate bolt preload retained after shrinkage', group: 'steering', unit: '',
    default: 0.5, min: 0.2, max: 1, step: 0.05, status: 'assumed', ref: 'D-43',
    note: 'Fraction of the bolt preload left after the oak shrinks and creeps (Belleville washers keep it from falling further). The plate-edge contact row uses this retained clamp plus the couple.',
  },
  kingpinPlateBoltNutFactor: {
    label: 'Bolt nut factor K', group: 'steering', unit: '',
    default: 0.2, min: 0.1, max: 0.3, step: 0.01, status: 'assumed', ref: 'D-43',
    note: 'T = K·D·F; 0.2 for plain or zinc-flake steel, dry.',
  },
  steerStopWeldIn: {
    label: 'Stop riser-to-arm fillet weld leg', group: 'steering', unit: 'in',
    default: 0.25, min: 0.125, max: 0.3125, step: 0.0625, status: 'assumed', ref: 'D-43',
    note: 'All-around fillet welds: web to riser and riser to arm (r3 N-3). The dog, riser and arm are one welded stand (deeper risers push the stop face outward and shrink the pad: tried 1.0-1.5", the crossbar-side stop block bearing doubled); the two arm screws bolt the stand to the carrier. E70 filler, allowable 0.3 F_EXX.',
  },
  weldFexxPsi: {
    label: 'Weld filler tensile strength F_EXX', group: 'steering', unit: 'psi',
    default: 70000, min: 60000, max: 80000, step: 10000, status: 'assumed', ref: 'D-43',
    note: 'E70 electrode; fillet weld allowable shear = 0.3 F_EXX (AISC ASD).',
  },
  stopBlockMinIn: {
    label: 'Stop block minimum wood thickness behind the face', group: 'steering', unit: 'in',
    default: 0.5, min: 0.25, max: 1, step: 0.125, status: 'assumed', ref: 'D-31',
    note: 'The stop blocks are wedges in the corners of the bolster opening; the thin ends are trimmed off where the wood behind the face is thinner than this, which also sets the length of the stop face.',
  },
  stopBlockRoughAllowIn: {
    label: 'Stop block blank allowance (over the finished wedge)', group: 'steering', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.25, step: 0.0156, status: 'assumed', ref: 'D-47',
    note: 'The wedges are small, so they are cut from the board 1/8" over the finished stock size (not the 1/2" a long board needs) and the stop face is cut 1/16" proud, then planed back at the shim fit (r3 build S12).',
  },
  turntableCenterHoleIn: {
    label: 'Turntable center hole diameter', group: 'steering', unit: 'in',
    default: 6.25, min: 4, max: 8, step: 0.25, status: 'verify', ref: 'D-43',
    note: 'The open center of a 12" lazy susan is about 6" (a 12" round bearing lists 6.3"). The kingpin plates, the stop risers and the plate bolts live inside it so nothing goes through the ball ring. Verify the bought bearing.',
  },
  kingpinPlateThickIn: {
    label: 'Kingpin steel plate thickness', group: 'steering', unit: 'in',
    default: 0.1875, min: 0.125, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-43',
    note: 'A36 plate, outsourced waterjet / laser. A plate on top of the front beam (the turntable carrier), one under the beam and one under the crossbar; the pin bears on them steel-on-steel.',
  },
  carrierPlateThickIn: {
    label: 'Turntable carrier plate thickness (on the beam)', group: 'steering', unit: 'in',
    default: 0.375, min: 0.1875, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-43',
    note: 'The A36 strip on top of the front beam under the lazy susan: the kingpin sleeve spigots into it, the stop arms screw to it, and it hands the stop torque in its own plane to the plate bolts. 5/16" so its bolt holes bear well enough to pass the stop torque (NDS yield mode IIIs scales with plate thickness) and the strip carries it in bending.',
  },
  kingpinPlateWidthIn: {
    label: 'Carrier / beam plate width (along the fore-aft axis)', group: 'steering', unit: 'in',
    default: 4, min: 2, max: 4.5, step: 0.125, status: 'assumed', ref: 'D-47',
    note: 'The CARRIER plate on top of the beam is this wide (r3 fittings N-5): it is the lazy susan\'s whole lower support, so it spans the beam (4") and lies over the axle rod and the groove, leaving the ball ring over steel for 4" of its 9" diameter instead of 2.5". The sleeve hole takes 1¼" of it, so the net section beside the hole carries the pin reaction in the plane of the plate (kingpin-plates row). The plate under the beam keeps its own width (kingpinUnderPlateWidthIn).',
  },
  kingpinUnderPlateWidthIn: {
    label: 'Beam plate (under the beam) width', group: 'steering', unit: 'in',
    default: 2.5, min: 2, max: 3, step: 0.125, status: 'assumed', ref: 'D-47',
    note: 'The 3/16" plate under the beam. It only clamps the beam and takes the pin head, so it stays at the old 2.5" (r3 fittings: only the carrier was widened).',
  },
  turntableRaceDiaIn: {
    label: 'Turntable ball-race (pitch) diameter', group: 'steering', unit: 'in',
    default: 9, min: 6, max: 11, step: 0.5, status: 'verify', ref: 'D-47',
    note: 'Assumed: a 12" square lazy susan has a ball ring of about 9" on its pitch circle and a 6.25" open center. Sets the ring support and pitch-moment rows (pitch-path). Ask the vendor for the real ring diameter and the plate thickness.',
  },
  turntablePlateThickIn: {
    label: 'Turntable lower-plate thickness (vendor)', group: 'steering', unit: 'in',
    default: 0.1875, min: 0.0625, max: 0.375, step: 0.0156, status: 'verify', ref: 'D-47',
    note: 'Assumed 3/16" steel for a 1,500 lb 12" bearing. The part of the lower plate that overhangs the carrier bends under the ball ring (pitch-path row). Buy a bearing whose lower plate is at least the thickness the row reports, or add wings.',
  },
  steerStopBarThickIn: {
    label: 'Stop arm bar thickness', group: 'steering', unit: 'in',
    default: 0.25, min: 0.25, max: 0.75, step: 0.0625, status: 'assumed', ref: 'D-43',
    note: 'A36 flat bar lying on the carrier inside the turntable hole: the stop dogs stand on it through a riser. Thinned from ½" in r3 (N-3) so the riser block between arm and channel web is 0.31" tall and the riser screws have real bearing thickness.',
  },
  steerStopScrewDiameterIn: {
    label: 'Stop arm screw diameter', group: 'steering', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-43',
    note: 'Grade 8 socket flat-head screws through each stop arm, tapped into the carrier (shear and a little tension from the riser overturning). Four in all.',
  },
  kingpinPlateYieldPsi: {
    label: 'Kingpin plate steel yield strength', group: 'steering', unit: 'psi',
    default: 36000, min: 30000, max: 60000, step: 1000, status: 'assumed', ref: 'D-43',
    note: 'A36. Allowable = yield / steel safety factor.',
  },
  kingpinPlateBoltDiameterIn: {
    label: 'Kingpin plate bolt diameter', group: 'steering', unit: 'in',
    default: 0.3125, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-43',
    note: '5/16" through-bolts holding the plates to the beam (6, in one line, ≥ 5D apart) and the crossbar (4): flat heads flush in the carrier, nuts under the beam plate. 5/16" because the 4D loaded-edge distance of a ⅜" bolt (1.5") does not fit the front lip and the rod groove of the 4" beam (1.25" each). Per-bolt lateral capacity is the NDS yield-mode value (src/analysis/nds.ts).',
  },
  kingpinPlateBoltYieldPsi: {
    label: 'Kingpin plate bolt yield strength', group: 'steering', unit: 'psi',
    default: 130000, min: 30000, max: 150000, step: 5000, status: 'verify', ref: 'D-43',
    note: 'SAE grade 8, zinc-flake coated and sealed in epoxy where it runs through oak. 316 stainless (cold worked F593, 65 ksi) cuts the stop-torque margin below 1: see the kingpin-bolts row.',
  },
  kingpinCrossBoltDiameterIn: {
    label: 'Kingpin cross-bolt diameter (splitting reinforcement)', group: 'steering', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-43',
    note: '316 stainless fore-aft bolts through the front beam, flanking the plate bolts, with fender washers: they stitch the front slab against cleavage (NDS 3.4.3.3). The crossbar gets two across its width.',
  },
  kingpinCrossBoltYieldPsi: {
    label: 'Kingpin cross-bolt yield strength', group: 'steering', unit: 'psi',
    default: 65000, min: 30000, max: 100000, step: 1000, status: 'assumed', ref: 'D-43',
    note: '316 stainless, cold-worked ASTM F593 condition CW (65 ksi min yield for ⅜"). Allowable tension = yield / steel safety factor.',
  },
  kingpinCrossBoltWasherIn: {
    label: 'Kingpin cross-bolt washer OD', group: 'steering', unit: 'in',
    default: 1.75, min: 1, max: 2.5, step: 0.125, status: 'assumed', ref: 'D-43',
    note: 'Fender washers under the cross-bolt heads and nuts; they spread the splitting tension into the oak (oak ⊥ bearing).',
  },
  eyeBoltDiameterIn: {
    label: 'Bridle eye bolt shank diameter', group: 'steering', unit: 'in',
    default: 0.5, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-33, D-47',
    note: 'Forged shoulder eye bolt through the front face of the front axle beam (axis fore-aft, along the rope), nut and washer on the aft face. 1/2" since r3 (fittings N-6): the eye bolt is the intended weak link of the rope tie, and it now holds the design pull x the overload factor.',
  },
  eyeBoltYieldPsi: {
    label: 'Bridle eye bolt steel yield strength', group: 'steering', unit: 'psi',
    default: 36000, min: 30000, max: 90000, step: 1000, status: 'assumed', ref: 'D-33',
    note: 'Forged carbon steel, conservative. Allowable = yield / steel safety factor. Confirm the vendor working-load limit is at least the pull in the rope-tie row.',
  },
  eyeBoltWasherDiameterIn: {
    label: 'Bridle eye bolt washer OD (aft face of the beam)', group: 'steering', unit: 'in',
    default: 2, min: 0.75, max: 2, step: 0.125, status: 'assumed', ref: 'D-33, D-47',
    note: '2" fender washer (r3 fittings N-6): at 1" the washer crushed the oak at 250 lbf of rope pull.',
  },
  bridleTieOverloadFactor: {
    label: 'Bridle tie overload factor on the design pull', group: 'loads', unit: '×',
    default: 2, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-47',
    note: 'The rope tie (eye bolt, washer, beam hole) is checked at the design pull x this factor, so a hard yank by 8 scouts does not fail it first (r3 fittings N-6). 2 x 150 = 300 lbf. The pull itself is still O-2.',
  },
  eyeBoltEyeOffsetIn: {
    label: 'Bridle eye center ahead of the beam front face', group: 'steering', unit: 'in',
    default: 1, min: 0.5, max: 2, step: 0.125, status: 'assumed', ref: 'D-33',
    note: 'The rope pulls here, so the transverse part of the pull bends the shank over this arm.',
  },
  bridleTieOffsetIn: {
    label: 'Bridle tie inboard of the front U-bolt', group: 'steering', unit: 'in',
    default: 1, min: 0.5, max: 4, step: 0.25, status: 'assumed', ref: 'D-33',
    note: 'The eye bolts sit this far inside the U-bolt plate, so the rope load goes into the beam and not into the axle rod.',
  },
  bridleTieHandHeightMaxIn: {
    label: 'Puller hand height for the tie-load case (upper bound)', group: 'steering', unit: 'in',
    default: 40, min: 30, max: 50, step: 1, status: 'assumed', ref: 'D-33',
    note: 'The tie load is evaluated with the hands at this height (30–40" range), which gives the largest vertical component on the eye.',
  },
  uboltRodDiameterIn: {
    label: 'Front U-bolt rod diameter', group: 'wheels', unit: 'in',
    default: 0.375, min: 0.3125, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-34',
    note: 'Square U-bolt, inside width = beam thickness + 2 × the clearance below; legs run down around the underslung front beam to a steel plate under it (the rear keeps the Phase 2 plates).',
  },
  uboltNutAllowanceIn: {
    label: 'Front U-bolt leg end below the plate (nut + thread)', group: 'wheels', unit: 'in',
    default: 0.4, min: 0.25, max: 0.75, step: 0.05, status: 'assumed', ref: 'D-34',
    note: 'Hex nut (about 0.33" for 3/8-16) plus two threads. The nuts are the lowest point of the front axle assembly, so they set the ground clearance under the front beam.',
  },
  uboltBeamClearIn: {
    label: 'Front U-bolt clearance to each beam face', group: 'wheels', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-34',
  },
  accessPanelLengthIn: {
    label: 'Kingpin-nut access panel length (fore-aft)', group: 'steering', unit: 'in',
    default: 4.5, min: 3.5, max: 6, step: 0.25, status: 'assumed', ref: 'D-34',
    note: 'A removable ply panel in the nose deck over the kingpin nut (threaded inserts + machine screws into the crossbar). Needs the kingpin crossbar.',
  },
  accessOpeningCornerRadiusIn: {
    label: 'Kingpin-access opening corner radius', group: 'steering', unit: 'in',
    default: 1, min: 0.5, max: 1.375, step: 0.125, status: 'assumed', ref: 'D-47',
    note: 'The opening in the nose deck and its panel have this corner radius (a 1/2" router bit in a template; 1" is the tightest radius that takes 1/16" oak edge veneer without cracking; r3 build S12). It must stay under half the opening width.',
  },
  accessPanelWidthIn: {
    label: 'Kingpin-nut access panel width (across)', group: 'steering', unit: 'in',
    default: 2.75, min: 2, max: 3, step: 0.25, status: 'assumed', ref: 'D-34',
    note: 'Kept inside the crossbar width so the screws bite the crossbar, not the open bolster.',
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
    default: 1500, min: 1000, max: 2500, step: 50, status: 'verify', ref: 'D-28',
    note: 'Used when Turntable bearing = Custom; the brief requires ≥ 1000 lb.',
  },
  kingpinLeadIn: {
    label: 'Kingpin ahead of front axle (trail)', group: 'steering', unit: 'in',
    default: 1.5, min: 0.875, max: 1.5, step: 0.125, status: 'explore', ref: 'D-25',
    note: 'Needs ≥ rod radius + kingpin radius + rodKingpinWebMinIn (1.125" for ¾" rod, ½" bolt, ½" web). Kingpin must clear the axle rod; the trailing axle self-centers under pull like a caster.',
  },
  rodKingpinWebMinIn: {
    label: 'Min web between axle-rod groove and kingpin hole', group: 'steering', unit: 'in',
    default: 0.5, min: 0.25, max: 1, step: 0.125, status: 'assumed', ref: 'D-25',
    note: 'Short-grain oak where the tongue pull reacts into the rod (Phase 1 r3 carry item 3). Lead ≥ rod radius + kingpin radius + this.',
  },
  kingpinDiameterIn: {
    label: 'Kingpin bolt diameter', group: 'steering', unit: 'in',
    default: 0.75, min: 0.375, max: 1, step: 0.0625, status: 'explore', ref: 'D-12',
  },
  kingpinYieldPsi: {
    label: 'Kingpin bolt yield strength', group: 'steering', unit: 'psi',
    default: 130000, min: 30000, max: 150000, step: 5000, status: 'assumed', ref: 'D-12',
    note: 'SAE grade 8 = 130 ksi. 18-8 stainless ≈ 30–65 ksi depending on temper.',
  },
  kingpinThroughBolster: {
    label: 'Kingpin through a chassis crossbar', group: 'steering', unit: '',
    default: 1, min: 0, max: 1, step: 1, status: 'assumed', ref: 'D-12',
    options: [
      { value: 0, label: 'No: kingpin stops at the turntable top (single-shear cantilever)' },
      { value: 1, label: 'Yes: kingpin runs up through an oak crossbar let into the bolster (real wagon practice)' },
    ],
    note: 'A kingpin must tie the steer beam to the chassis. With 1, an oak crossbar spans the bolster opening over the turntable center, flush with the bolster rails and let into them, and the kingpin (and its nut) end at its top. The pin is then held in two members, one on each side of the turntable interface.',
  },
  kingpinCrossbarWidthIn: {
    label: 'Kingpin crossbar width (across the cart)', group: 'steering', unit: 'in',
    default: 3, min: 1.5, max: 4.5, step: 0.25, status: 'assumed', ref: 'D-12',
    note: 'Oak bar running fore-aft across the bolster opening (depth = the bolster depth), kingpin at its center. Needs ≥ bore diameter + 2 × beamLigamentMinIn and must stay clear of the swinging steer stops.',
  },
  kingpinCrossbarLetInIn: {
    label: 'Kingpin crossbar let-in depth into each bolster rail', group: 'steering', unit: 'in',
    default: 0.5, min: 0.25, max: 1, step: 0.125, status: 'assumed', ref: 'D-12',
    note: 'The crossbar ends are notched into the fore and aft bolster rails by this much; the end faces bear on the rail notch faces (fore-aft strike load).',
  },
  kingpinSleeveOdIn: {
    label: 'Kingpin steel sleeve outside diameter (0 = none)', group: 'steering', unit: 'in',
    default: 1.25, min: 0, max: 2, step: 0.0625, status: 'explore', ref: 'D-12',
    note: 'A steel tube sleeve (inside diameter = the kingpin) in the beam bore, e.g. 1.25" OD for a ¾" pin. With the kingpin steel plates (D-35, the default crossbar configuration) it is the pin guide between the beam plates: it bears in their spigot holes and the epoxy bed in the oak is a seal that is NOT counted. Without the crossbar (the Phase 1 pin) the oak bears on the sleeve OD instead. Must exceed the kingpin diameter; the rod-to-kingpin web and beam ligament rules use the sleeve OD.',
  },
  kingpinSleeveClearIn: {
    label: 'Kingpin sleeve bore clearance over the pin (diametral)', group: 'steering', unit: 'in',
    default: 0.006, min: 0.003, max: 0.015, step: 0.001, status: 'assumed', ref: 'D-47',
    note: 'The DOM tube is bought at about 0.750" ID +/- 0.005, which can be smaller than a grade-8 pin body (0.744-0.750" per ASME B18.2.1). The bore is reamed or honed to pin + this (0.756"), which leaves 0.006-0.014" diametral clearance on a bolt body of 0.7439-0.7500". Steering play at the stop is a few thousandths of an inch.',
  },
  sleeveYieldPsi: {
    label: 'Kingpin sleeve steel yield strength', group: 'steering', unit: 'psi',
    default: 36000, min: 20000, max: 100000, step: 1000, status: 'assumed', ref: 'D-12',
    note: 'A36 / 1018 tube. Pin-on-sleeve bearing allowable = 0.9 · Fy / steel safety factor.',
  },
  drawbar: {
    label: 'Pull attachment', group: 'steering', unit: '',
    default: 0, min: 0, max: 1, step: 1, status: 'explore', ref: 'D-14',
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
  bridleRopeRunIn: {
    label: 'Bridle rope run (tongue tip to puller hands)', group: 'steering', unit: 'in',
    default: 96, min: 36, max: 144, step: 6, status: 'assumed', ref: 'D-14',
    note: 'A 6 ft rope sets the pull angle α = atan((hand height − tongue tip height) / run) used by the rearward-pitch check.',
  },
  kingpinWasherDiameterIn: {
    label: 'Kingpin washer outside diameter (under the beam)', group: 'steering', unit: 'in',
    default: 1.25, min: 0.75, max: 2.5, step: 0.125, status: 'assumed', ref: 'D-12',
    note: 'Fender washer between the bolt head/nut and the oak beam underside; carries the kingpin tension (bump-roll uplift).',
  },
  uhmwBearingPsi: {
    label: 'UHMW-PE design bearing stress (side-bearer wear strip)', group: 'steering', unit: 'psi',
    default: 1000, min: 300, max: 3000, step: 50, status: 'assumed', ref: 'D-12',
    note: 'Compressive yield of UHMW-PE is ~2,500–3,000 psi at 10% strain; 1,000 psi is a creep-limited design value.',
  },
  bolsterFastenerDiameterIn: {
    label: 'Bolster-to-chassis fastener diameter', group: 'steering', unit: 'in',
    default: 0.375, min: 0.1875, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-33',
    note: 'Phase 3 (M7): ⅜" A307 carriage bolts through the nose deck, the bolster fore / aft rails and the turntable top plate (nut under the plate), count below. They are structured joints on the rails, which roll-bolster-attach reads. Phase 2 assumed 4 × ¼".',
  },
  bolsterFastenerCount: {
    label: 'Bolster-to-chassis fastener count', group: 'steering', unit: '',
    default: 4, min: 2, max: 12, step: 1, status: 'assumed', ref: 'D-12',
  },
  bolsterFastenerYieldPsi: {
    label: 'Bolster fastener yield strength', group: 'steering', unit: 'psi',
    default: 36000, min: 30000, max: 130000, step: 1000, status: 'assumed', ref: 'D-12',
    note: 'ASTM A307 / low-carbon steel bolt: 36 ksi. Allowable shear = 0.577·yield / kingpin margin.',
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
    label: 'Brake mechanical advantage TARGET', group: 'brake', unit: ':1',
    default: 12, min: 2, max: 14, step: 0.5, status: 'explore', ref: 'D-13',
    note: 'Phase 3 (D-38): a target, not an input. The analysis uses the ratio derived from the lever / crank / shoe geometry; the brake-ratio check fails if the geometry delivers less than this. (The wooden-drum variant has no linkage geometry and still uses the target.)',
  },
  brakeShoeThickIn: {
    label: 'Brake shoe radial thickness', group: 'brake', unit: 'in',
    default: 1.5, min: 0.75, max: 3, step: 0.25, status: 'assumed', ref: 'D-13',
  },
  brakeShoeWidthIn: {
    label: 'Brake shoe width (across the tread)', group: 'brake', unit: 'in',
    default: 2.5, min: 1.5, max: 4, step: 0.25, status: 'assumed', ref: 'D-13',
    note: 'Phase 3 r2: 2.5" (was 3") shortens the shoe-arm overhang beyond the bearing, which sets the bending in the cross-drilled shaft; pad pressure is about 55 psi at 2× the hold load.',
  },
  brakeShoeLengthIn: {
    label: 'Brake shoe length (along the tread)', group: 'brake', unit: 'in',
    default: 2, min: 1, max: 5, step: 0.25, status: 'assumed', ref: 'D-13',
  },
  brakeShoeAngleDeg: {
    label: 'Brake shoe position below the axle line (rear of the tire)', group: 'brake', unit: '°',
    default: 11, min: 0, max: 20, step: 1, status: 'assumed', ref: 'D-38',
    note: 'Phase 3: the shoes sit on the REAR of each tread, this far below the axle line, so the pad swings straight in from the cross shaft behind the tire. The lowest pad corner must stay above the minimum ground clearance (validator warning).',
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
    default: 0.875, min: 0.375, max: 1, step: 0.125, status: 'assumed', ref: 'D-38',
    note: 'Ground shafting, pre-hardened 4140 (brakeShaftYieldPsi). ¾" carries the shoe-arm torque at 2× the hold load; ½" does not. Phase 3 r2: the shaft is cross-drilled for roll pins (no keyseat, build review M10) and the ¼" diametral hole costs 57% of the bending section, so the net-section stress is checked (brake-shaft); 1045 at 70 ksi would need a 7/8" shaft (+1.8 lb).',
  },
  brakeLeverWidthIn: {
    label: 'Brake lever width (across)', group: 'brake', unit: 'in',
    default: 0.75, min: 0.5, max: 2.5, step: 0.25, status: 'assumed', ref: 'D-38',
    note: 'Kept narrow so the lever, its clevis and the shoe arms fit side by side in the gap between the hull and the rear tire.',
  },
  brakeLeverThickIn: {
    label: 'Brake lever thickness (fore-aft, in the plane of the pull)', group: 'brake', unit: 'in',
    default: 2, min: 0.75, max: 2, step: 0.25, status: 'assumed', ref: 'D-38',
  },
  brakeEfficiency: {
    label: 'Brake linkage efficiency', group: 'brake', unit: '×',
    default: 0.8, min: 0.5, max: 1, step: 0.05, status: 'assumed', ref: 'D-13',
    note: 'Pivot friction and shoe/linkage compliance.',
  },
  brakePadMu: {
    label: 'Lining-to-tire friction μ (bonded woven / molded lining, wet design)', group: 'brake', unit: '',
    default: 0.45, min: 0.2, max: 0.8, step: 0.05, status: 'assumed', ref: 'D-13',
    note: 'Phase 3 r2: the oak pads are faced with a 1/8" woven or molded brake lining (bonded, brass-free), which is about 0.45 against a wet rubber tread. Bare oak on wet rubber is only about 0.25 and needs 32–37 lbf at the handle (eng review S-3).',
  },
  brakePadMuFouled: {
    label: 'Lining-to-tire friction μ, mud / slush fouled (pass/fail case)', group: 'brake', unit: '',
    default: 0.35, min: 0.15, max: 0.8, step: 0.05, status: 'assumed', ref: 'D-13',
    note: 'The shoe sits on the rear-lower tread, the part that just left the ground, so mud and slush reach it first (build review S10). The handle-force check and the member loads use the lower of this and the design μ; the force must still be ≤ the handle limit at this μ. Test the lining on a wet tire before the build.',
  },
  brakeShaftYieldPsi: {
    label: 'Brake cross shaft yield (pre-hardened 4140 ground rod)', group: 'brake', unit: 'psi',
    default: 100000, min: 50000, max: 140000, step: 5000, status: 'assumed', ref: 'D-38',
    note: 'Pre-hardened 4140 ground rod (28–32 HRC, yield ≥ 100 ksi; drills and reams on the drill press with a cobalt bit). Allowable = yield / steelSafetyFactor. The axle stays 1045 at axleYieldPsi.',
  },
  brakeLiningThickIn: {
    label: 'Brake lining thickness (bonded to the oak pad face)', group: 'brake', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-13',
    note: 'Woven or molded lining sheet, cut on the bandsaw and bonded to the oak pad with contact or epoxy adhesive plus two stainless pan-head screws. Counted inside the shoe radial thickness.',
  },
  brakeLeverTailAuto: {
    label: 'Solve the lever tail from the ratio target', group: 'brake', unit: '',
    default: 1, min: 0, max: 1, step: 1, status: 'assumed', ref: 'D-38',
    options: [
      { value: 1, label: 'On: tail solved so the critical ratio meets the target' },
      { value: 0, label: 'Off: use the lever tail length below' },
    ],
    note: 'Phase 3 r2 (eng S-3): the lever tail is solved by bisection so that the derived critical-direction ratio equals the target × headroom, for any wheel size. If no tail between 1" and 4" can reach it, the tail is clamped and brake-ratio fails honestly.',
  },
  brakeRatioHeadroom: {
    label: 'Ratio headroom over the target (tail solve)', group: 'brake', unit: '×',
    default: 1.2, min: 1, max: 1.3, step: 0.01, status: 'assumed', ref: 'D-38',
    note: 'The tail is solved to this multiple of the target so the check passes with margin, not at equality.',
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
    note: 'Modeled as a square block.',
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

  // ── Brake mechanism geometry (D-38) ───────────────────────────────────────
  brakeShoeTravelIn: {
    label: 'Brake shoe engagement stroke (pad to tread)', group: 'brake', unit: 'in',
    default: 0.3125, min: 0.1, max: 0.75, step: 0.025, status: 'assumed', ref: 'D-38',
    note: 'Released gap to the tread plus tire/pad compliance and a little wear allowance (the clevis lengthens the link to take up more). Sets the lever stroke: stroke ≈ ratio × this. 3/8" so a muddy shoe retracts clear of the tread (build review S10).',
  },
  brakeShoePinDiameterIn: {
    label: 'Shoe pivot pin diameter', group: 'brake', unit: 'in',
    default: 0.5, min: 0.25, max: 0.75, step: 0.0625, status: 'assumed', ref: 'D-38',
    note: 'Steel pin through the two shoe arms and the pad: lets the pad wrap the tread.',
  },
  brakeBarWidthIn: {
    label: 'Brake steel flat bar width (arms, crank, ratchet pawl)', group: 'brake', unit: 'in',
    default: 1, min: 0.75, max: 2, step: 0.25, status: 'assumed', ref: 'D-38',
  },
  brakeBarThickIn: {
    label: 'Brake steel flat bar thickness', group: 'brake', unit: 'in',
    default: 0.25, min: 0.125, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-38',
  },
  brakeLeverPivotBehindShaftIn: {
    label: 'Brake lever pivot behind the cross shaft', group: 'brake', unit: 'in',
    default: 1.25, min: 0.75, max: 3, step: 0.05, status: 'assumed', ref: 'D-38',
    note: 'The lever pivots on a post welded to the left bearing plate (outside the rail band), just behind the shaft (behind the tire, so it never depends on the hull-to-tire gap); the plate ear reaches behind the rail end (D-48).',
  },
  brakeLeverPivotZIn: {
    label: 'Brake lever pivot height', group: 'brake', unit: 'in',
    default: 6.1, min: 5.5, max: 8, step: 0.05, status: 'assumed', ref: 'D-38',
    note: 'On the rear rail band.',
  },
  brakeLeverTailIn: {
    label: 'Brake lever tail length (pivot to link pin), manual', group: 'brake', unit: 'in',
    default: 1.9, min: 1, max: 4, step: 0.05, status: 'explore', ref: 'D-38',
    note: 'The input lever arm of the linkage (shorter = more mechanical advantage). Used only when "Solve the lever tail" is off; otherwise the tail is solved from the ratio target (brakeLeverTailAuto).',
  },
  brakeCrankIn: {
    label: 'Brake crank length (shaft to link pin)', group: 'brake', unit: 'in',
    default: 3, min: 1, max: 4, step: 0.05, status: 'explore', ref: 'D-38',
    note: 'Phase 3 r2: 3.0" (was 2.4") so the solved lever tail stays near 1.8" at the 1.1× ratio headroom and the link, tail shear and tail-pin bearing keep margin (tail shear and pin bearing 85% of allowable).',
  },
  brakeCrankAngleDeg: {
    label: 'Brake crank direction (0° = forward, 270° = down)', group: 'brake', unit: '°',
    default: 322, min: 180, max: 360, step: 1, status: 'assumed', ref: 'D-38',
    note: 'Released position of the crank, counter-clockwise from +x seen from the left. 322° points forward and down at 38° (was 315°; raised so the 3" crank and its clevis stay ≥ 3.5" above the ground).',
  },
  brakeLeverTiltDeg: {
    label: 'Brake lever tilt toward the rear', group: 'brake', unit: '°',
    default: 4, min: 0, max: 25, step: 1, status: 'assumed', ref: 'D-38',
    note: 'Leans the grip back toward the push handle.',
  },
  brakeBearingBoltDiameterIn: {
    label: 'Cross shaft bearing-plate bolt diameter', group: 'brake', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-38',
    note: 'Phase 3 r3 (build MUST-3): 3/8" 316 hex bolts through the steel bearing plate and the 3/4" rail band, fender washer and nylock nut inside the rail. 3/8" (not 7/16") because the rail is only 0.75" thick and 4" tall: the edge distances are 1.5D (parallel to grain) and 7D from the rail end toward which the pivot load pulls.',
  },
  brakePivotBoltDiameterIn: {
    label: 'Brake lever pivot post diameter', group: 'brake', unit: 'in',
    default: 0.75, min: 0.375, max: 1, step: 0.125, status: 'assumed', ref: 'D-48',
    note: 'Phase 3 r3: a 3/4" A36 round post welded (outsourced, 3/16" fillet all round) to the left bearing plate ear, sticking out 1.4" to carry the lever on a bronze sleeve. A 3/8" bolt cantilevered that far bends (about 460 lbf·in at the 2× hold load against 80 for a 316 bolt; the round-2 check never looked at pin bending). The lever bore is the post + 2 × 1/8" sleeve.',
  },
  brakeBearingBoltSpacingIn: {
    label: 'Cross shaft bearing-plate bolt pitch (fore-aft, between columns)', group: 'brake', unit: 'in',
    default: 1.75, min: 1.25, max: 3, step: 0.125, status: 'assumed', ref: 'D-38',
    note: 'Phase 3 r3: the bolts are a grid of 2 rows × `brakeBearingBoltCols` columns on the outside of the rail band, FORWARD of the shaft notch (the rail is solid wood there), not a 2" square around the shaft (that put holes 0.25" from the rail end and below its bottom, build MUST-3). Pitch ≥ 4D along the grain.',
  },
  brakeBearingBoltCols: {
    label: 'Cross shaft bearing-plate bolt columns (2 rows each)', group: 'brake', unit: '',
    default: 2, min: 2, max: 4, step: 1, status: 'assumed', ref: 'D-38',
    note: 'Bolts in the bearing-plate grid = 2 × this. The left plate also carries the lever pivot reaction (about 600 lbf at 2× the goal hold load), 2.7" behind the first column, so it needs the third column.',
  },
  brakeBearingBoltRowGapIn: {
    label: 'Bearing-plate bolt rows: vertical gap', group: 'brake', unit: 'in',
    default: 1.3, min: 1, max: 2.5, step: 0.125, status: 'assumed', ref: 'D-38',
    note: 'Gap between the two bolt rows; the lower row sits `brakeBoltEdgeIn` above the rail bottom, the upper row must stay 1.5D below the deck ledge (validator).',
  },
  brakeBoltEdgeIn: {
    label: 'Bearing-plate lower bolt row above the rail bottom', group: 'brake', unit: 'in',
    default: 0.8, min: 0.5, max: 1.5, step: 0.05, status: 'assumed', ref: 'D-38',
    note: 'Edge distance of the lower bolt row to the rail bottom (2.1D for 3/8"; NDS wants 1.5D parallel to the grain, 4D perpendicular, and a steel plate on the outside plus a fender washer inside spread the load).',
  },
  brakeBoltEndIn: {
    label: 'Bearing-plate first bolt column: distance from the rail end', group: 'brake', unit: 'in',
    default: 2.95, min: 1.5, max: 5, step: 0.05, status: 'assumed', ref: 'D-38',
    note: '≥ 7D (NDS loaded end distance, 2.63" for 3/8"): the lever pivot reaction pulls the plate toward the rail end. Also must clear the shaft notch (validator).',
  },
  brakeDoublerThickIn: {
    label: 'Brake bearing-plate oak doubler inside the rail (0 = none)', group: 'brake', unit: 'in',
    default: 1.5, min: 0, max: 2, step: 0.25, status: 'assumed', ref: 'D-48',
    note: 'A glued, bolted oak block on the INSIDE of the rail behind the bolt grid (the dedicated bearing block the build review asked for): the bolts then go through 1.75" of oak instead of 0.75", which lifts the NDS bolt capacity and the cleavage limit (⅔ F\'v b d_e, b = rail + doubler) that a 0.75" rail alone fails at the plate\'s edge distances. It stays forward of the shaft (clear of the shaft path) and aft of the rear axle beam hold-down.',
  },
  brakePlateThickIn: {
    label: 'Brake bearing plate thickness (A36, outsourced)', group: 'brake', unit: 'in',
    default: 0.1875, min: 0.1875, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-38',
    note: 'One plate per side on the outside of the rail band: carries the bronze shaft bearing and (left) the lever pivot, and spans the shaft notch to solid rail. 3/16 inch (the bolt-hole bearing and tear-out are at 10% of allowable; the pivot post is welded to the left plate\'s ear).',
  },
  brakeGripTravelMaxIn: {
    label: 'Brake lever grip travel limit', group: 'brake', unit: 'in',
    default: 6.5, min: 4, max: 9, step: 0.25, status: 'verify', ref: 'D-38',
    note: 'The most a scout can sweep the grip before the lever becomes awkward (F3 flagged 6.4" as long). Feel-test on the mock-up. Raising the ratio or the shoe stroke raises the travel one for one; the check reports both.',
  },
  brakeAbuseLbf: {
    label: 'Brake lever abuse pull (a scout hanging on the grip)', group: 'brake', unit: 'lbf',
    default: 100, min: 50, max: 200, step: 10, status: 'locked', ref: 'D-38',
    note: 'Eng r2 N-8: lever, link, crank, shaft, pins and ratchet must survive this at the grip without yielding (SF 1). The brake may be bent after it only if the check says so; no failure of the rider-facing parts.',
  },
  brakeShieldThickIn: {
    label: 'Brake shoe splash shield sheet thickness (0 = none)', group: 'brake', unit: 'in',
    default: 0.0625, min: 0, max: 0.125, step: 0.0156, status: 'assumed', ref: 'D-38',
    note: 'Build r1 S10: a bent 1/16" HDPE or aluminum cover over the back and sides of each oak shoe and its pivot bore, between the shoe arms. It does not touch the tread; it keeps the pivot, pin and spring clear of tire spray. The mud-fouled lining case (brakePadMuFouled) is still the pass/fail case.',
  },
  brakeBushingPsi: {
    label: 'Oil-impregnated bronze bushing allowable bearing pressure', group: 'brake', unit: 'psi',
    default: 3000, min: 1000, max: 5000, step: 100, status: 'assumed', ref: 'D-38',
    note: 'SAE 841 static load limit is about 4,500 psi at low speed; 3,000 psi leaves margin for the oscillating motion.',
  },
  brakeLinkRodDiameterIn: {
    label: 'Brake link rod diameter', group: 'brake', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-38',
    note: 'Cold-rolled rod, threaded 3/8-24 at both ends for the clevises.',
  },
  brakeClevisPinDiameterIn: {
    label: 'Brake clevis pin diameter', group: 'brake', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-38',
  },
  brakeStrokeReserve: {
    label: 'Ratchet stroke reserve (× the applied lever angle)', group: 'brake', unit: '×',
    default: 1.5, min: 1, max: 3, step: 0.1, status: 'assumed', ref: 'D-39',
    note: 'The toothed quadrant must cover the applied lever angle times this, to take up shoe wear and tire compression before the clevis needs re-adjusting.',
  },
  brakeLeverGripBelowHandleIn: {
    label: 'Brake lever grip below the push-handle grip', group: 'brake', unit: 'in',
    default: 4, min: 0, max: 10, step: 0.5, status: 'assumed', ref: 'D-38',
  },
  brakeClearanceIn: {
    label: 'Brake moving-part clearance (sweep limit)', group: 'brake', unit: 'in',
    default: 0.1, min: 0.03, max: 0.5, step: 0.01, status: 'assumed', ref: 'D-38',
    note: 'Minimum gap between the moving brake parts and the wheel, hull, rails, storage box and ground over the full stroke.',
  },
  brakeLoadFactor: {
    label: 'Brake component load factor (on the hold load)', group: 'brake', unit: '×',
    default: 2, min: 1, max: 4, step: 0.25, status: 'assumed', ref: 'D-38',
    note: 'Lever, links, shaft and ratchet are checked at this multiple of the load needed to hold the cart on the design slope: a hard pull or a jerk on the lever. 2× the 24 lbf goal hold ≈ 48 lbf, close to the 50 lbf hold-back pull.',
  },
  brakeSteelYieldPsi: {
    label: 'Brake flat bar / rod / pin steel yield', group: 'brake', unit: 'psi',
    default: 36000, min: 30000, max: 100000, step: 1000, status: 'assumed', ref: 'D-38',
    note: 'A36 flat bar and cold-rolled rod. Allowable = yield / steel safety factor (shear 0.577×).',
  },

  // ── Parking ratchet (D-39) ────────────────────────────────────────────────
  brakeRatchetRadiusIn: {
    label: 'Parking ratchet tooth radius (from the lever pivot)', group: 'brake', unit: 'in',
    default: 8.5, min: 5, max: 16, step: 0.5, status: 'assumed', ref: 'D-39',
    note: 'Toothed steel quadrant on the hull side of the lever, concentric with the lever pivot; a spring-loaded pawl on the lever engages it. Capped so the pawl stays below the gunwale top (lash points).',
  },
  brakeRatchetPitchIn: {
    label: 'Ratchet tooth pitch (along the arc)', group: 'brake', unit: 'in',
    default: 0.3125, min: 0.1875, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-39',
  },
  brakeRatchetToothDepthIn: {
    label: 'Ratchet tooth depth', group: 'brake', unit: 'in',
    default: 0.1, min: 0.0625, max: 0.25, step: 0.0125, status: 'assumed', ref: 'D-39',
  },
  brakeRatchetPlateThickIn: {
    label: 'Ratchet quadrant and pawl thickness', group: 'brake', unit: 'in',
    default: 0.25, min: 0.1875, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-39',
  },
  brakeRatchetSpanDeg: {
    label: 'Ratchet quadrant arc (toothed span)', group: 'brake', unit: '°',
    default: 28, min: 8, max: 40, step: 1, status: 'assumed', ref: 'D-39',
    note: 'Must cover the applied lever angle plus wear take-up (checked). 28° covers the 3/8" shoe stroke (15.6° applied) at 1.5× reserve with margin.',
  },
  brakePawlPinDiameterIn: {
    label: 'Ratchet pawl pivot pin diameter', group: 'brake', unit: 'in',
    default: 0.25, min: 0.1875, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-39',
  },

  // ── Metal hardware: lathe-free shaft joints, aluminum sockets (build review M10; plan item 5) ──
  brakeRollPinDiameterIn: {
    label: 'Brake shaft cross-pin (heavy-duty roll pin) diameter', group: 'brake', unit: 'in',
    default: 0.25, min: 0.1875, max: 0.3125, step: 0.0625, status: 'assumed', ref: 'D-38',
    note: 'Drill-press joint, no lathe, mill or broach: the shaft collar (or the crank bar, drilled and reamed to the shaft) and the shaft are cross-drilled together and a roll pin is driven through. Arm collars have one pin each, the crank two at 90°.',
  },
  brakeRollPinShearPsi: {
    label: 'Heavy-duty roll pin allowable double shear', group: 'brake', unit: 'psi',
    default: 20000, min: 8000, max: 40000, step: 1000, status: 'assumed', ref: 'D-38',
    note: 'A heavy-duty 1/4" spring (roll) pin breaks at about 4,000 lbf in double shear, i.e. about 41 ksi on its 2 × 0.049 in² section; ÷ safety factor 2 is 20 ksi.',
  },
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
  frontAxleBeamThicknessIn: {
    label: 'Front axle beam width (fore-aft)', group: 'stock', unit: 'in',
    default: 4, min: 1.5, max: 5, step: 0.125, status: 'explore', ref: 'D-25',
    note: 'Holds the rod groove AND the kingpin hole: needs ≥ lead + rod radius + kingpin radius + 2 × beamLigamentMinIn (H2).',
  },
  axleBeamDepthIn: {
    label: 'Axle beam depth (vertical)', group: 'stock', unit: 'in',
    default: 2.5, min: 1.5, max: 4, step: 0.125, status: 'explore',
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
  oakNdsTensionPsi: {
    label: 'White oak NDS design tension parallel to grain Ft (reference)', group: 'materials', unit: 'psi',
    default: 500, min: 200, max: 1000, step: 25, status: 'verify', ref: 'D-35',
    note: 'Net-section term of the group tear-out (NDS Appendix E).',
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
  urethaneDensityPcf: {
    label: 'Urethane density (stop pads)', group: 'materials', unit: 'lb/ft³',
    default: 70, min: 60, max: 80, step: 1, status: 'assumed', ref: 'D-35',
    note: '70-80A cast urethane, about 1.1 g/cm³.',
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

/** Diameter of the bore the kingpin sits in: the steel sleeve OD when a sleeve is fitted, else the pin itself. */
export function kingpinBoreIn(p: Params): number {
  return p.kingpinSleeveOdIn > 0 ? Math.max(p.kingpinSleeveOdIn, p.kingpinDiameterIn) : p.kingpinDiameterIn;
}

/** The steel kingpin plates exist whenever the pin runs up through the chassis crossbar (the default); the Phase 1 single-shear pin keeps its oak bores (D-35). */
export function kingpinPlatesOn(p: Params): boolean {
  return p.kingpinThroughBolster === 1;
}

/** Height of the turntable stack above the front beam top: the bearing plus the steel carrier plate under it (D-35). */
export function frontStackIn(p: Params): number {
  return p.turntableThicknessIn + (kingpinPlatesOn(p) ? p.carrierPlateThickIn : 0);
}

/** Effective washer OD under the beam / over the crossbar: the param, but never less than 2.25 × the pin diameter (so a fatter pin is not starved of bearing area). */
export function kingpinWasherEffectiveIn(p: Params): number {
  return Math.max(p.kingpinWasherDiameterIn, 2.25 * p.kingpinDiameterIn);
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
 * Steering stops (D-31, supersedes the D-12 / critic r2 H1 posts): two oak dogs faced with steel on the beam, four oak
 * stop blocks in the corners of the bolster opening. The geometry (face planes, tooth polygons, `ok` / `why` when the dogs
 * do not fit the opening over the ±lock sweep) is src/model/stops.ts; this wrapper adds the bolster plan numbers.
 */
export function steerStopPlan(p: Params) {
  const b = bolsterPlan(p);
  return { ...b, size: p.steerStopSizeIn, ...planStops(p, b) };
}

/** Largest overlap a tilted (flared) side panel may have with its chine/gunwale grooves, in the block model (inches). */

/** Front-wheel swing at full lock (A-4, D-25): inner tire corner |y| (kingpin frame) and rear-most extent behind the axle. */
function swingGeometry(p: Params) {
  const lk = (p.steerLockDeg * Math.PI) / 180;
  const a = p.frontTrackIn / 2;
  const r = p.wheelDiameterIn / 2;
  // The kingpin leads the axle by `kingpinLeadIn` (D-25), so the tire's rear edge is (lead + r) behind the pivot.
  const swingInnerYIn = (a - p.tireWidthIn / 2) * Math.cos(lk) - (p.kingpinLeadIn + r) * Math.sin(lk);
  const swingRearXIn = (a + p.tireWidthIn / 2) * Math.sin(lk) + (p.kingpinLeadIn + r) * Math.cos(lk);
  // Referenced to the front AXLE: the kingpin is `kingpinLeadIn` ahead of it (D-25), so the rear-most tire corner is
  // swingRear − lead behind the axle (critic r2 M2).
  return { swingInnerYIn, swingRearXIn, swingRearBehindAxleIn: swingRearXIn - p.kingpinLeadIn };
}

/** Auto nose geometry rounds to this (inches). */
const AUTO_NOSE_STEP_IN = 0.125;

/**
 * Resolve derived-by-rule params (A-4, D-26). With `autoNoseGeometry` = 1, `noseWidthIn` becomes the widest hull that
 * clears the front tires at full lock (2·(swingInnerY − steeringClearance), rounded DOWN to 1/8", ≤ bodyWidthIn) and
 * `noseTaperStartIn` the shortest valid shoulder distance (swingRearBehindAxle + steeringClearance + margin, rounded UP
 * to 1/8"). Pure and idempotent. If the auto nose is narrower than the rider's feet + boots need, it is left narrow:
 * validateParams then reports the boot error, which is the honest outcome. Does nothing when the tires cannot reach
 * the hull (no swing rule applies) or when auto is off. Every consumer (buildModel, computeLayout, validateParams)
 * sees the resolved values; the manual nose params are ignored while auto is on.
 */
/** Turntable presets (D-28): size, stack height, mass, rating. Catalog estimates, status 'verify'. */
export const TURNTABLE_PRESETS: Record<number, { size: number; thick: number; mass: number; rating: number }> = {
  1: { size: 12, thick: 0.375, mass: 3.5, rating: 1000 },
  2: { size: 12, thick: 0.5, mass: 5.5, rating: 1500 },
  3: { size: 12, thick: 0.75, mass: 9, rating: 2000 },
};

/**
 * Apply derived-default params: the turntable preset (D-28), then the auto nose geometry (A-4/D-26).
 * Pure and idempotent; every consumer (model, layout, validator, analysis) calls it first.
 */
export function resolveParams(p: Params): Params {
  const t = TURNTABLE_PRESETS[p.turntableType];
  const q = t && (p.turntableSizeIn !== t.size || p.turntableThicknessIn !== t.thick || p.turntableMassLb !== t.mass || p.turntableRatingLb !== t.rating)
    ? { ...p, turntableSizeIn: t.size, turntableThicknessIn: t.thick, turntableMassLb: t.mass, turntableRatingLb: t.rating }
    : p;
  return resolveNose(q);
}

/** The tire-sweep clearance spec the S-curve is tested against (centerline half widths, D-45). */
export function hullCurveSpec(p: Params): CurveClearanceSpec {
  return {
    wheelbase: p.wheelbaseIn, kx: p.wheelbaseIn + p.kingpinLeadIn, frontTrack: p.frontTrackIn, tireWidth: p.tireWidthIn,
    wheelDiameter: p.wheelDiameterIn, lockDeg: p.steerLockDeg,
    yA: p.bodyWidthIn / 2 - p.sideThicknessIn / 2, yB: p.noseWidthIn / 2 - p.sideThicknessIn / 2, side: p.sideThicknessIn,
  };
}

const curveEndCache = new Map<string, number>();

const noseCache = new Map<string, { noseWidthIn: number; noseTaperStartIn: number; hullCurveStartIn: number }>();

function resolveNose(p: Params): Params {
  if (p.autoNoseGeometry !== 1) return p;
  if (!(p.wheelDiameterIn > p.deckHeightIn + p.frontDeckRaiseIn - p.deckPlyIn - p.crossmemberDepthIn)) return p;
  const ck = [p.wheelbaseIn, p.kingpinLeadIn, p.frontTrackIn, p.tireWidthIn, p.wheelDiameterIn, p.steerLockDeg, p.sideThicknessIn, p.bodyWidthIn, p.steeringClearanceIn, p.hullCurveStartIn,
    p.railThicknessIn, p.hullLamThicknessIn, p.hullLamMinRadiusFactor, p.hullWebPlies, p.panelPlyIn, p.sideConstruction, p.rearOverhangIn, p.noseWidthIn, p.noseTaperStartIn].join('|');
  const hit = noseCache.get(ck);
  if (hit) return hit.noseWidthIn === p.noseWidthIn && hit.noseTaperStartIn === p.noseTaperStartIn && hit.hullCurveStartIn === p.hullCurveStartIn ? p : { ...p, ...hit };
  const out = resolveNoseUncached(p);
  if (noseCache.size > 5000) noseCache.clear();
  noseCache.set(ck, { noseWidthIn: out.noseWidthIn, noseTaperStartIn: out.noseTaperStartIn, hullCurveStartIn: out.hullCurveStartIn });
  return out;
}

function resolveNoseUncached(p: Params): Params {
  const sw = swingGeometry(p);
  const maxNose = 2 * (sw.swingInnerYIn - p.steeringClearanceIn);
  // Floor keeps the model non-degenerate (a nose thinner than its own side boards); the validator still flags it.
  const nose = Math.max(
    2 * p.sideThicknessIn + 0.5,
    Math.min(p.bodyWidthIn, Math.floor((maxNose + 1e-9) / AUTO_NOSE_STEP_IN) * AUTO_NOSE_STEP_IN),
  );
  // D-45: the S-curve ends as late as the tire sweep + clearance allows (replaces the square-shoulder rule of A-4), and starts early enough
  // that the bent laminations stay within their cold-bend radius (the start is moved earlier, never later, than the slider says).
  const q = { ...p, noseWidthIn: nose };
  const spec = hullCurveSpec(q);
  const needR = requiredCurveRadius(q);
  const maxShoulder = p.wheelbaseIn + p.rearOverhangIn - 2 * p.sideThicknessIn;
  /** End (as a 1/8" shoulder distance) and radius-ok flag for a curve start. */
  const trial = (x0: number) => {
    const key = [spec.wheelbase, spec.kx, spec.frontTrack, spec.tireWidth, spec.wheelDiameter, spec.lockDeg, spec.yA, spec.yB, spec.side, x0, p.steeringClearanceIn].join('|');
    let xe = curveEndCache.get(key);
    if (xe === undefined) {
      xe = latestCurveEnd(x0, spec, p.steeringClearanceIn, 3, Math.max(3, p.wheelbaseIn - HULL_CURVE_END_BEHIND_AXLE_MIN_IN - x0));
      if (curveEndCache.size > 2000) curveEndCache.clear();
      curveEndCache.set(key, xe);
    }
    let shoulder = Math.min(maxShoulder, Math.max(0, Math.ceil((p.wheelbaseIn - xe - 1e-9) / AUTO_NOSE_STEP_IN) * AUTO_NOSE_STEP_IN));
    // Rounding the end back to 1/8" and the gap itself are not monotone: verify, and step the end back until the rounded curve clears.
    for (let k = 0; k < 40 && p.wheelbaseIn - shoulder > x0 + 3 && curveTireGap(x0, p.wheelbaseIn - shoulder, spec) < p.steeringClearanceIn - 1e-9; k++) shoulder += AUTO_NOSE_STEP_IN;
    const xn = p.wheelbaseIn - shoulder;
    const ok = xn <= x0 + 3 || buildPlanCurve(x0, xn, spec.yA, spec.yB).minRadius >= needR - 1e-9;
    return { shoulder, ok };
  };
  let x0 = p.hullCurveStartIn;
  let tr = trial(x0);
  if (!tr.ok) {
    // Earlier start = longer, gentler curve (monotone): find the latest start (0.5" steps) that meets the radius, by bisection.
    let lo = HULL_CURVE_START_MIN_IN, hi = x0;
    const trLo = trial(lo);
    if (!trLo.ok) { x0 = lo; tr = trLo; } else {
      let best = trLo;
      while (hi - lo > 0.5 + 1e-9) {
        const mid = Math.floor(((lo + hi) / 2) * 2) / 2;
        const t = trial(mid);
        if (t.ok) { lo = mid; best = t; } else hi = mid;
      }
      x0 = lo; tr = best;
    }
  }
  const shoulder = tr.shoulder;
  if (nose === p.noseWidthIn && shoulder === p.noseTaperStartIn && x0 === p.hullCurveStartIn) return p;
  return { ...p, noseWidthIn: nose, noseTaperStartIn: shoulder, hullCurveStartIn: x0 };
}

/** The S-curve must end at least this far behind the front axle (room for the shoulder beam, nose joists and the bolster ring). */
const HULL_CURVE_END_BEHIND_AXLE_MIN_IN = 12;
/** Earliest the auto rule will move the S-curve start (the slider minimum). */
const HULL_CURVE_START_MIN_IN = 8;

/** Smallest centerline radius (in) the hull curve may have: the inside face of every bent member must meet its cold-bend limit (D-45). */
export function requiredCurveRadius(p: Params): number {
  const strip = Math.max(0.01, p.hullLamThicknessIn);
  const web = p.panelPlyIn / Math.max(1, p.hullWebPlies);
  const f = p.hullLamMinRadiusFactor;
  const r = [f * strip + p.sideThicknessIn / 2, f * strip + p.railThicknessIn / 2];
  if (p.sideConstruction === SIDE_CONSTRUCTION.capturedPly) r.push(f * web + p.panelPlyIn / 2);
  return Math.max(...r);
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
  const { swingInnerYIn, swingRearXIn, swingRearBehindAxleIn } = swingGeometry(p);
  const rodR = p.axleDiameterIn / 2;
  const kpR = kingpinBoreIn(p) / 2; // the wood is cut for the bore (sleeve OD when fitted), not the pin
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
    /** Front beam: centerd on the rod + kingpin pair; center offset from the axle and the wood left beyond each hole edge. */
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
export function validateParams(input: Params): ParamIssue[] {
  const p = resolveParams(input);
  const issues: ParamIssue[] = [];
  const err = (keys: ParamKey[], message: string) => issues.push({ keys, severity: 'error', message });
  const warn = (keys: ParamKey[], message: string) => issues.push({ keys, severity: 'warn', message });
  const r = p.wheelDiameterIn / 2;

  if (p.riderGoalMassLb < p.riderMassLb)
    warn(['riderGoalMassLb', 'riderMassLb'], 'The operating rider is heavier than the goal rider; the 200 lb goal checks no longer cover the heaviest case (the Simple view sweeps every weight).');
  if (p.targetMassMinLb > p.targetMassMaxLb)
    err(['targetMassMinLb', 'targetMassMaxLb'], 'Mass target low end exceeds high end.');
  if (p.noseWidthIn > p.bodyWidthIn)
    err(['noseWidthIn', 'bodyWidthIn'], 'Nose is wider than the cabin.');
  const rearInnerTire = p.rearTrackIn / 2 - p.tireWidthIn / 2;
  if (p.bodyWidthIn / 2 + 0.75 > rearInnerTire && p.deckHeightIn < p.wheelDiameterIn)
    err(['bodyWidthIn', 'rearTrackIn'], 'Cabin is too wide to clear the rear tires (needs ≥ ¾" each side).');
  if (p.seatXIn < 0 && p.rearOverhangIn < -p.seatXIn + 6)
    err(['seatXIn', 'rearOverhangIn'], 'Seat hangs off the back of the body.');
  if (p.seatXIn + p.riderLegReachIn > p.wheelbaseIn + p.frontOverhangIn)
    err(['seatXIn', 'riderLegReachIn', 'frontOverhangIn'], 'Rider\'s feet extend past the front of the body.');
  if (p.kingpinLeadIn + p.turntableSizeIn / 2 + p.transomThicknessIn > p.frontOverhangIn)
    err(['kingpinLeadIn', 'turntableSizeIn', 'frontOverhangIn'],
      `The turntable (kingpin at ${p.kingpinLeadIn}" ahead of the axle, ${p.turntableSizeIn}" plate) pokes out of the front of the body; the front overhang must be ≥ ${(p.kingpinLeadIn + p.turntableSizeIn / 2 + p.transomThicknessIn).toFixed(2)}".`);
  // Seat geometry (critic H3, D-45): the grab handles end before the S-curve starts, the cushion stays inside the narrowing hull,
  // the leaning back must stay inside the rear transom, and a rear storage box needs room between the transom and the seat back.
  const xnCurve = p.wheelbaseIn - p.noseTaperStartIn;
  const cushionFront = p.seatXIn - p.seatBehindHpointIn + p.seatDepthIn;
  const gripFront = p.seatXIn - 5 + p.seatGripClearLengthIn + 2 + p.sideThicknessIn + 0.25;
  if (p.hullCurveStartIn < gripFront - 1e-9)
    err(['hullCurveStartIn', 'seatXIn', 'seatGripClearLengthIn'],
      `The S-curve starts at x = ${p.hullCurveStartIn}" but the grab handles reach ${gripFront.toFixed(1)}": the cabin must stay full width and straight under them (D-45). Start the curve later or move the seat back.`);
  if (cushionFront > xnCurve - p.shoulderBeamIn - 0.01)
    err(['seatXIn', 'seatDepthIn', 'noseTaperStartIn', 'wheelbaseIn'],
      `The seat cushion (front at x = ${cushionFront.toFixed(1)}") runs into the deck step (the shoulder beam starts at ${(xnCurve - p.shoulderBeamIn).toFixed(1)}"). Move the seat back or shorten it.`);
  if (xnCurve < p.hullCurveStartIn + 3)
    err(['hullCurveStartIn', 'noseTaperStartIn', 'wheelbaseIn'],
      `The S-curve would be shorter than 3" (it starts at x = ${p.hullCurveStartIn}" and ends at ${xnCurve.toFixed(1)}"): start it earlier.`);
  else {
    const curve = buildPlanCurve(p.hullCurveStartIn, xnCurve, p.bodyWidthIn / 2 - p.sideThicknessIn / 2, p.noseWidthIn / 2 - p.sideThicknessIn / 2);
    const seatHalf = Math.max(1, Math.min(p.seatWidthIn, p.bodyWidthIn - 2 * p.sideThicknessIn - 1)) / 2;
    const innerAtCushion = offsetY(curve, -p.sideThicknessIn / 2, Math.min(cushionFront, xnCurve));
    if (cushionFront > p.hullCurveStartIn && innerAtCushion < seatHalf + 0.25 - 1e-9)
      err(['hullCurveStartIn', 'seatXIn', 'seatDepthIn', 'seatWidthIn'],
        `The seat cushion (front at x = ${cushionFront.toFixed(1)}", ${(2 * seatHalf).toFixed(0)}" wide) runs into the narrowing hull: inside width there is only ${(2 * innerAtCushion).toFixed(1)}". Start the S-curve later, shorten the seat or narrow it.`);
    const tiresReach = p.wheelDiameterIn > p.deckHeightIn + p.frontDeckRaiseIn - p.deckPlyIn - p.crossmemberDepthIn;
    if (tiresReach) {
      const gap = curveTireGap(p.hullCurveStartIn, xnCurve, hullCurveSpec(p));
      if (gap < p.steeringClearanceIn - 1e-6)
        err(['hullCurveStartIn', 'noseTaperStartIn', 'steerLockDeg', 'frontTrackIn', 'kingpinLeadIn'],
          `The S-curve hull comes within ${gap.toFixed(2)}" of the front tire at some steering angle (needs ≥ ${p.steeringClearanceIn}"). End the curve earlier or turn "Auto nose width & shoulder" on.`);
    }
    // Bent laminations: tightest radius of the INSIDE face vs the cold-bend limit (D-45).
    const strip = Math.max(0.01, p.hullLamThicknessIn);
    const webSheet = p.panelPlyIn / Math.max(1, p.hullWebPlies);
    const checks: Array<[string, number, number]> = [
      ['chine / gunwale', p.sideThicknessIn, strip],
      ['ladder rail', p.railThicknessIn, strip],
      ...(p.sideConstruction === SIDE_CONSTRUCTION.capturedPly ? ([['side panel', p.panelPlyIn, webSheet]] as Array<[string, number, number]>) : []),
    ];
    for (const [name, thick, s1] of checks) {
      const rIn = curve.minRadius - thick / 2, lim = p.hullLamMinRadiusFactor * s1;
      if (rIn < lim - 1e-9)
        err(['hullCurveStartIn', 'hullLamThicknessIn', 'hullLamMinRadiusFactor', 'hullWebPlies'],
          `The ${name} bend radius ${rIn.toFixed(1)}" (inside face) is tighter than the cold-bend limit ${lim.toFixed(1)}" (${p.hullLamMinRadiusFactor} x ${s1.toFixed(3)}" strip): start the S-curve earlier, use thinner strips, or steam it.`);
    }
  }
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
  // The foot stop (a board of footStopThickIn at seatX + leg reach) must end inside the front transom's inner face.
  const footStopFront = p.seatXIn + p.riderLegReachIn + p.footStopThickIn / 2;
  if (footStopFront > p.wheelbaseIn + p.frontOverhangIn - p.transomThicknessIn + 1e-9)
    err(['seatXIn', 'riderLegReachIn', 'frontOverhangIn', 'wheelbaseIn'],
      `The foot stop reaches ${footStopFront.toFixed(2)}" ahead of the rear axle, into the front transom (its inner face is at ${(p.wheelbaseIn + p.frontOverhangIn - p.transomThicknessIn).toFixed(2)}"). Move the seat back or lengthen the front overhang.`);
  if (p.gunwaleFlareIn > 0)
    warn(['gunwaleFlareIn'], 'Gunwale flare is ignored: the S-curve hull (D-45) has vertical sides.');
  if (p.sideConstruction === SIDE_CONSTRUCTION.capturedPly && p.sideHeightIn - 2 * p.railBandIn - p.frontDeckRaiseIn < 1)
    err(['sideHeightIn', 'railBandIn', 'frontDeckRaiseIn'], 'The side panel would be shorter than 1" (the chine is deepened by the deck step, D-45). Raise the side or reduce the step.');
  // Captured-ply grooves (D-35): the oak walls left each side of the groove must stay sturdy.
  if (p.sideConstruction === SIDE_CONSTRUCTION.capturedPly) {
    const wall = (p.sideThicknessIn - p.panelPlyIn - p.grooveSlopIn) / 2;
    if (wall < 0.1)
      warn(['sideThicknessIn', 'panelPlyIn', 'grooveSlopIn'], `A ${p.panelPlyIn}" panel in a ${p.sideThicknessIn}" chine/gunwale leaves ${Math.max(0, wall).toFixed(3)}" walls beside the groove (want ≥ 0.1"). Thicken the side stock or thin the panel.`);
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
  if (p.axleBeamPosition === AXLE_BEAM_POSITION.underslung) {
    const uboltBottom = beamBottom - p.clampPlateThickIn - p.uboltNutAllowanceIn;
    if (uboltBottom < p.minGroundClearanceIn - 1e-9)
      warn(['clampPlateThickIn', 'uboltNutAllowanceIn', 'axleBeamDepthIn', 'minGroundClearanceIn'],
        `The front U-bolt nuts hang to ${uboltBottom.toFixed(2)}" (beam bottom ${beamBottom.toFixed(2)}" − plate ${p.clampPlateThickIn}" − nut ${p.uboltNutAllowanceIn}"), below the ${p.minGroundClearanceIn}" ground clearance.`);
  }
  const beamTop = beamBottom + p.axleBeamDepthIn;
  // The bolster must fit between the turntable top and the nose deck underside (the model would otherwise poke through the deck).
  const frontDeckBot = p.deckHeightIn + p.frontDeckRaiseIn - p.deckPlyIn;
  if (beamTop + frontStackIn(p) + p.bolsterMinDepthIn > frontDeckBot + 0.01)
    err(['deckHeightIn', 'frontDeckRaiseIn', 'axleBeamPosition', 'axleBeamDepthIn', 'turntableThicknessIn', 'bolsterMinDepthIn'],
      `Front axle beam + turntable + ${p.bolsterMinDepthIn}" bolster needs the nose deck underside at ≥ ${(beamTop + frontStackIn(p) + p.bolsterMinDepthIn).toFixed(2)}"; it is ${frontDeckBot.toFixed(2)}". Raise the deck or the forward deck raise, or use an underslung beam.`);
  const frontStackTop = beamTop + frontStackIn(p) + p.crossmemberDepthIn + p.deckPlyIn;
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
  }

  // Kingpin sleeve (steel tube, ID = pin) and the bore the wood is cut for.
  const bore = kingpinBoreIn(p);
  if (p.kingpinSleeveOdIn > 0 && p.kingpinSleeveOdIn <= p.kingpinDiameterIn + 1e-9)
    err(['kingpinSleeveOdIn', 'kingpinDiameterIn'],
      `The kingpin sleeve OD (${p.kingpinSleeveOdIn}") must be larger than the kingpin (${p.kingpinDiameterIn}"); use 0 for no sleeve.`);
  if (p.kingpinThroughBolster === 1) {
    const needW = bore + 2 * p.beamLigamentMinIn;
    if (p.kingpinCrossbarWidthIn < needW - 1e-9)
      err(['kingpinCrossbarWidthIn', 'kingpinDiameterIn', 'kingpinSleeveOdIn', 'beamLigamentMinIn'],
        `The kingpin crossbar is ${p.kingpinCrossbarWidthIn}" wide: a ${bore}" bore leaves ${((p.kingpinCrossbarWidthIn - bore) / 2).toFixed(2)}" of wood each side; it needs ≥ ${p.beamLigamentMinIn}" (width ≥ ${needW.toFixed(2)}").`);
    const bp = bolsterPlan(p);
    if (p.kingpinCrossbarLetInIn > bp.rw - 0.25 + 1e-9)
      err(['kingpinCrossbarLetInIn', 'bolsterRailWidthIn'],
        `The crossbar is let ${p.kingpinCrossbarLetInIn}" into each bolster rail but the rails are only ${bp.rw}" wide; at most ${(bp.rw - 0.25).toFixed(2)}" (¼" of rail must remain).`);
  }

  // Web of short-grain oak between the rod groove and the kingpin hole (Phase 1 r3 carry item 3).
  const rodKpWeb = p.kingpinLeadIn - p.axleDiameterIn / 2 - bore / 2;
  if (rodKpWeb < p.rodKingpinWebMinIn - 1e-9)
    err(['kingpinLeadIn', 'rodKingpinWebMinIn', 'axleDiameterIn', 'kingpinDiameterIn', 'kingpinSleeveOdIn'],
      `Only ${rodKpWeb.toFixed(3)}" of wood between the axle-rod groove and the kingpin ${p.kingpinSleeveOdIn > 0 ? 'sleeve bore' : 'hole'}; it needs ≥ ${p.rodKingpinWebMinIn}" (kingpin lead ≥ ${(p.axleDiameterIn / 2 + bore / 2 + p.rodKingpinWebMinIn).toFixed(3)}").`);

  // Axle beams (critic r2 H2): wood left behind the rod groove and ahead of the kingpin hole must be real wood.
  if (d.frontBeamLigamentIn < p.beamLigamentMinIn - 1e-9)
    err(['frontAxleBeamThicknessIn', 'kingpinLeadIn', 'beamLigamentMinIn', 'kingpinSleeveOdIn'],
      `Front axle beam is ${p.frontAxleBeamThicknessIn}" wide: with the rod groove and the kingpin hole (${p.kingpinLeadIn}" apart) only ${d.frontBeamLigamentIn.toFixed(2)}" of wood is left behind the rod and ahead of the kingpin; it needs ≥ ${p.beamLigamentMinIn}" (width ≥ ${(p.kingpinLeadIn + p.axleDiameterIn / 2 + bore / 2 + 2 * p.beamLigamentMinIn).toFixed(2)}").`);
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
  const turntableTop = beamTop + frontStackIn(p);
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
      // The ladder rails now run flush under the chines (D-43), so rails, girders and side panels all have their outer face at bodyWidth/2.
      const railOuter = p.bodyWidthIn / 2;
      if (railOuter > clampInner + 1e-6)
        err(['bodyWidthIn', 'rearTrackIn', 'clampPlateWidthIn'],
          `The cabin rails/sides reach ${railOuter.toFixed(2)}" off center but the rear U-bolt plates start at ${clampInner.toFixed(2)}"; narrow the body or widen the track.`);
    }
  }

  // The brake cross shaft runs behind the rear tire and must stay in front of the rear transom (and the push handle behind it).
  const shaftBack = r + p.brakeShaftBehindTireIn + p.brakeShaftDiameterIn / 2;
  if (p.rearOverhangIn < shaftBack + p.transomThicknessIn)
    err(['rearOverhangIn', 'brakeShaftBehindTireIn', 'wheelDiameterIn'],
      `The brake cross shaft reaches ${shaftBack.toFixed(2)}" behind the rear axle, into the rear transom; the rear overhang must be ≥ ${(shaftBack + p.transomThicknessIn).toFixed(2)}".`);

  // Brake bearing-plate bolt grid in the rail (build r2 MUST-3, D-48): mirrors src/model/rear-mount.ts bearingMount.
  if (p.brakeType === BRAKE_TYPE.tireTread) {
    const railBot = p.deckHeightIn - p.deckPlyIn - p.railDepthIn;
    const solidTop = p.deckHeightIn - p.deckPlyIn;
    const zHi = railBot + p.brakeBoltEdgeIn + p.brakeBearingBoltRowGapIn;
    const bd = p.brakeBearingBoltDiameterIn;
    if (solidTop - zHi < 1.5 * bd - 1e-9)
      err(['brakeBoltEdgeIn', 'brakeBearingBoltRowGapIn', 'railDepthIn', 'brakeBearingBoltDiameterIn'],
        `The upper bearing-plate bolt row is ${(solidTop - zHi).toFixed(2)}" below the deck ledge (needs 1.5D = ${(1.5 * bd).toFixed(2)}"): lower the rows, deepen the rail or use a smaller bolt (D-48).`);
    if (p.brakeBoltEdgeIn < 1.5 * bd - 1e-9)
      err(['brakeBoltEdgeIn', 'brakeBearingBoltDiameterIn'], `The lower bearing-plate bolt row is ${p.brakeBoltEdgeIn}" above the rail bottom (needs 1.5D = ${(1.5 * bd).toFixed(2)}"; D-48).`);
    const notchTop = r + 0 + p.brakeShaftDiameterIn / 2 + 0.125;
    if (solidTop - notchTop < 1)
      err(['railDepthIn', 'brakeShaftDiameterIn', 'deckHeightIn', 'wheelDiameterIn'],
        `The brake shaft notch in the rail reaches ${notchTop.toFixed(2)}", leaving ${(solidTop - notchTop).toFixed(2)}" of rail below the deck ledge (needs 1"): a taller rail, a lower shaft (smaller wheel) or a higher deck (D-48).`);
  }
  // Brake linkage (D-38). Numbers below mirror src/model/brake.ts (lever-to-hull gap 0.64", clevis cheek 0.15", clevis half height 0.25").
  if (p.brakeType === BRAKE_TYPE.tireTread) {
    const sX = -(r + p.brakeShaftBehindTireIn);
    const phiB = (p.brakeCrankAngleDeg * Math.PI) / 180;
    const bX = sX + p.brakeCrankIn * Math.cos(phiB);
    const bZ = r + p.brakeCrankIn * Math.sin(phiB);
    const planeOuterY = p.bodyWidthIn / 2 + 0.64 + p.brakeLeverWidthIn + 0.15; // crank plate + clevis cheek, outboard face
    const tireIn = p.rearTrackIn / 2 - p.tireWidthIn / 2;
    if (bX + 0.5 > -r - 0.05 && planeOuterY > tireIn - 0.05)
      err(['brakeCrankIn', 'brakeCrankAngleDeg', 'brakeShaftBehindTireIn', 'bodyWidthIn', 'rearTrackIn'],
        `The brake crank and clevis (${planeOuterY.toFixed(2)}" out from the centerline, reaching ${(bX + 0.5).toFixed(2)}" behind the axle) would run into the rear tire, whose inner face is at ${tireIn.toFixed(2)}". Move the cross shaft further back, shorten or re-aim the crank, or narrow the body.`);
    const tilt = (p.brakeLeverTiltDeg * Math.PI) / 180;
    const delta = p.brakeShoeLengthIn / (2 * r);
    const beta = (p.brakeShoeAngleDeg * Math.PI) / 180;
    // Released pad: the pin is turned back about the shaft by the stroke (see brakeGeometry), which moves the pad down along its arc.
    const ex = -(r + p.brakeShoeThickIn / 2) * Math.cos(beta) - sX, ez = r - (r + p.brakeShoeThickIn / 2) * Math.sin(beta) - r;
    const kn = ex * -Math.sin(beta) - ez * -Math.cos(beta);
    const thS = Math.abs(kn) < 1e-6 ? 0 : (-Math.sign(kn) * p.brakeShoeTravelIn) / Math.abs(kn);
    const padLow = r - (r + p.brakeShoeThickIn) * Math.sin(beta + delta) + thS * -ex;
    const leverLow = p.brakeLeverPivotZIn - p.brakeLeverTailIn * Math.cos(tilt) - p.brakeBarWidthIn / 2;
    const lowest = Math.min(padLow, bZ - 0.25, leverLow);
    if (lowest < p.minGroundClearanceIn - 1e-6)
      warn(['brakeShoeAngleDeg', 'brakeCrankAngleDeg', 'brakeLeverPivotZIn', 'brakeLeverTailIn', 'minGroundClearanceIn', 'wheelDiameterIn'],
        `The lowest brake part (pad corner ${padLow.toFixed(2)}", crank clevis ${(bZ - 0.25).toFixed(2)}", lever tail ${leverLow.toFixed(2)}") is below the ${p.minGroundClearanceIn}" ground clearance.`);
  }

  // Steering stops live inside the bolster opening (H1, D-31).
  const stop = steerStopPlan(p);
  if (!stop.ok)
    err(['steerStopSizeIn', 'steerStopPadIn', 'stopBlockMinIn', 'turntableSizeIn', 'bolsterRailWidthIn', 'steerLockDeg', 'kingpinCrossbarWidthIn'],
      `Steering stops do not fit the bolster opening over the ±${p.steerLockDeg}° sweep: ${stop.why}.`);
  // Kingpin steel plates (D-35): bolt-line edge distances, carrier length, bolt clearances, riser height, and the stop arm inside the turntable center hole.
  // The NDS edge-distance rule is advisory (kingpinPlateIssues, shown in the kingpin-bolts how text): only the hard geometry fits are validator errors.
  for (const i of kingpinPlateIssues(p)) if (!/loaded edge distance/.test(i.message)) err(i.keys as ParamKey[], i.message);
  if (kingpinPlatesOn(p) && stop.ok) {
    const armHx = Math.min(kingpinPlatePlan(p).carrier.hx, stopArmHx(p, stop.ra));
    const holeR = p.turntableCenterHoleIn / 2;
    const corner = Math.hypot(armHx, stop.ra);
    if (corner > holeR - 0.02)
      err(['turntableCenterHoleIn', 'steerStopSizeIn', 'steerStopRiserDepthIn', 'kingpinCrossbarWidthIn'],
        `The stop arm's corner (${armHx}" off the pin line, ${stop.ra.toFixed(2)}" along it) reaches ${corner.toFixed(2)}" from the kingpin, outside the ${holeR.toFixed(3)}" radius of the turntable's ${p.turntableCenterHoleIn}" center hole (needs ≥ ${(corner + 0.02).toFixed(2)}"). Verify the bearing's open center.`);
  }

  // Stop adjustability and the riser screw pattern (r3 N-1, N-3).
  if (p.steerStopAdjustRangeIn < 2 * p.steerStopFitMismatchIn - 1e-9)
    err(['steerStopAdjustRangeIn', 'steerStopFitMismatchIn'], `The shim range ${p.steerStopAdjustRangeIn}" cannot cover twice the ${p.steerStopFitMismatchIn}" fit-up mismatch the stop rows assume.`);

  // Kingpin-nut access panel (D-34): it must sit on the crossbar top and cover the nut washer.
  if (p.kingpinThroughBolster === 1) {
    const bp = bolsterPlan(p);
    const lenMax = 2 * (-bp.aftFaceX) - 0.5;
    if (p.accessPanelWidthIn > p.kingpinCrossbarWidthIn - 0.25 + 1e-9)
      err(['accessPanelWidthIn', 'kingpinCrossbarWidthIn'],
        `The access panel is ${p.accessPanelWidthIn}" wide; it must stay ≥ ¼" inside the ${p.kingpinCrossbarWidthIn}" crossbar so its screws bite the crossbar (width ≤ ${(p.kingpinCrossbarWidthIn - 0.25).toFixed(2)}").`);
    if (p.accessPanelWidthIn < kingpinWasherEffectiveIn(p) + 0.25 - 1e-9)
      err(['accessPanelWidthIn', 'kingpinDiameterIn', 'kingpinWasherDiameterIn'],
        `The access panel (${p.accessPanelWidthIn}" wide) must clear the ${kingpinWasherEffectiveIn(p).toFixed(2)}" kingpin washer with ¼" to spare (width ≥ ${(kingpinWasherEffectiveIn(p) + 0.25).toFixed(2)}").`);
    if (p.accessPanelLengthIn > lenMax + 1e-9)
      err(['accessPanelLengthIn', 'turntableSizeIn', 'bolsterRailWidthIn'],
        `The access panel is ${p.accessPanelLengthIn}" long; the bolster opening allows ${lenMax.toFixed(2)}".`);
  }

  // Bridle eye bolts sit inboard of the front U-bolt plate and outboard of the bolster ring (D-33).
  {
    const bp = bolsterPlan(p);
    const beamLen = Math.max(1, p.frontTrackIn - p.hubLengthIn - 0.25);
    const clampInner = Math.min(beamLen / 2 - 0.25, p.frontTrackIn / 2 - p.tireWidthIn / 2) - p.clampPlateWidthIn;
    const tieY = clampInner - p.bridleTieOffsetIn;
    if (tieY < bp.halfY + 1)
      err(['bridleTieOffsetIn', 'clampPlateWidthIn', 'frontTrackIn', 'turntableSizeIn'],
        `The bridle eye bolts would sit at ${tieY.toFixed(2)}" off center, inside the bolster ring (${bp.halfY.toFixed(2)}" + 1"); reduce the tie offset or the U-bolt plate width, or widen the front track.`);
  }

  // Truck.
  if (d.overallWidthIn + 2 * p.truckClearanceIn > p.truckWellGapIn)
    warn(['rearTrackIn', 'frontTrackIn'],
      `Overall width ${d.overallWidthIn.toFixed(2)}" does not fit between the wheel wells with clearance (max track ${d.maxTrackBesideWells.toFixed(2)}"); only "straddle" stowage would work (D-6).`);
  if (d.bodyLengthIn > d.truckUsableLengthIn - p.truckClearanceIn)
    err(['wheelbaseIn', 'rearOverhangIn', 'frontOverhangIn'], 'Body is longer than bed + tailgate.');
  return issues;
}
