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

import { neutralTieLen, type AckSpec } from './model/ackermann';
import { beamLayout, linkTopZ } from './model/brake-layout';
import { frontStackTop } from './model/front-stack';
import { fitBowCurve, leftTirePolys, minGapToTires, offsetY, sidePolyline, type BowSpec, type CurveClearanceSpec, type PlanCurve } from './model/hull-curve';

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
  steering: 'Steering & pull',
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
export const FRAME_STYLE = { ladder: 0, hullBeam: 1 } as const;
export const SIDE_CONSTRUCTION = { solidOak: 0, capturedPly: 1, openFrame: 2 } as const;
export const STORAGE_LOCATION = { rearOverAxle: 0, forwardRaised: 1, underSeat: 2 } as const;

/** Mannequin proportions (fractions of stature, D-3) that the nose-width validator also needs: hip separation and foot width. */
/** Solid-spring rule of thumb (D-57): a member bent from solid stock needs an inside radius of at least this many times its thickness. */
const SOLID_SPRING_RADIUS_FACTOR = 100;
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
    default: 32.5, min: 24, max: 44, step: 0.5, status: 'assumed', ref: 'D-3, D-53',
    note: 'Knees bent a little more than a straight reach on a low seat; ≈ 0.48 × stature. 32.5 in (was 36): the seat moved 3.5 in forward (D-53, so the seat kit lies flat in the storage box) and the foot stop stays where it was, so the nose, the cleats and the steering do not change.',
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
    note: 'The hull narrows toward the nose (26.8 in clear in the cabin, 20.6 in at the end of the S-curve), so the payload can only be piled forward as far as the bed is this wide. A cooler or a duffel is 16 to 24 in.',
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
    default: 13, min: 10, max: 24, step: 0.25, status: 'explore', ref: 'D-15, D-52',
    note: 'The OUTSIDE width of the hull at the front transom (the bow). Your choice; the curve behind it is solved so the hull clears the tire sweep (the pinch ~8" behind the bow is narrower than this only when a bow wider than ~19" is asked for). Narrower = a pointier bow and a gentler curve; the feet need about 12" inside at the foot stop.',
  },
  noseTaperStartIn: {
    label: 'Hull reaches nose width this far behind front axle', group: 'body', unit: 'in',
    default: 13.25, min: -12, max: 26, step: 0.5, status: 'explore', ref: 'A-4, D-45',
    note: 'Derived (the end of the curved part is hullBowStraightIn behind the front transom\'s inner face; negative = ahead of the axle). The END of the plan S-curve (D-45), measured from the front AXLE. Overridden while "Auto nose width & shoulder" is on: resolveParams() finishes the curve as late as the front-tire sweep (full lock) plus steering clearance allows. Old links that saved the square-shoulder distance still load; the validator reports a curve that would hit a tire.',
  },
  hullCurveStartIn: {
    label: 'S-curve starts (cabin begins to narrow) at x', group: 'body', unit: 'in',
    default: 14.5, min: 8, max: 34, step: 0.5, status: 'explore', ref: 'D-45, D-52',
    note: 'The earliest allowed is the front of the grab handles (14.5" at the defaults); the earlier the start the gentler the curve (7 to 9 percent more bend radius per inch earlier at the defaults: 43" at 18, 58" at 14.5, 66" at 12.5, docs/phase3b-wsB-notes.md). Model x of the start of the plan S-curve that blends the cabin side into the nose side (D-45). The cabin stays full width (and straight) up to here: the seat, grab handles, lash points, reflectors and storage box all sit behind it. The curve end is derived from the tire sweep (noseTaperStartIn). An earlier start gives a gentler curve (larger bend radius). With "Auto nose width & shoulder" on, the rule moves the start EARLIER (never later) if the curve would otherwise be tighter than the lamination limit.',
  },
  hullLamThicknessIn: {
    label: 'Hull lamination strip thickness (chine, gunwale, rails)', group: 'body', unit: 'in',
    default: 0.3125, min: 0.0625, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-45, D-57',
    note: 'The chine, gunwale and ladder rails are bent laminations of white-oak strips this thick, glued on a plan-view form (epoxy, slow hardener). The number of plies is member thickness / strip, rounded (5/16" gives 2 plies for the 5/8" chine and gunwale and 2 x 3/8" for the 3/4" rail).',
  },
  hullLamMinRadiusFactor: {
    label: 'Min. bend radius / strip thickness', group: 'body', unit: '×',
    default: 40, min: 20, max: 100, step: 5, status: 'assumed', ref: 'D-45',
    note: 'White oak (and okoume ply sheets) lay up cold without steaming above this ratio; the validator flags a tighter hull curve (the inside face of the lamination is the tightest).',
  },
  hullWebPlies: {
    label: 'Side-panel sheets in the curve', group: 'body', unit: '',
    default: 1, min: 1, max: 3, step: 1, status: 'assumed', ref: 'D-45',
    note: 'The curved 6 mm okoume web is laminated from this many thin sheets (2 x 3 mm) around the same form, so it can take the curve (min radius = factor x one sheet). 1 = a single 6 mm sheet (the bow curve is gentle enough, R >= 58", D-52).',
  },
  deckSlopIn: {
    label: 'Deck rabbet / dado clearance over the ply', group: 'body', unit: 'in',
    default: 0.04, min: 0, max: 0.08, step: 0.004, status: 'assumed', ref: 'D-45',
    note: 'The deck rabbet in the chine and the dado in each transom are cut this much taller than the (epoxy-sealed) deck so the sealed panel enters its own rabbet; thickened epoxy fills the gap (build review MUST-2).',
  },
  hullBowStraightIn: {
    label: 'Straight bow run before the front transom (x extent)', group: 'body', unit: 'in',
    default: 16, min: 4, max: 24, step: 1, status: 'assumed', ref: 'D-52, D-57',
    note: 'Ackermann hull only. The curved part of the side ends this far (in x) behind the front transom\'s inner face; from there to the transom the side is a straight line that keeps converging (the bow). The scarfs between the bent cabin run and the straight bow run sit in it, so they never bend, and the sheer rise (sheerLengthIn) lies on it. Longer = the curve ends earlier; 16" costs nothing in bend radius at the defaults.',
  },

  steeringClearanceIn: {
    label: 'Tire-to-hull clearance at full lock', group: 'body', unit: 'in',
    default: 0.75, min: 0.25, max: 2, step: 0.125, status: 'assumed', ref: 'A-4',
    note: 'Covers tire bulge, mud, and turntable/kingpin play.',
  },
  steeringLinkClearIn: {
    label: 'Steering linkage running clearance (links, bellcrank, tongue to chassis)', group: 'steering', unit: 'in',
    default: 0.25, min: 0.1, max: 1, step: 0.05, status: 'assumed', ref: 'D-53',
    note: 'The least gap the tie rod, drag link, bellcrank, tongue link and tongue keep from every chassis part over the whole steering sweep (steer-clear row). The wheels, knuckles and shoes keep the larger steeringClearanceIn (tire bulge, mud, play).',
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
    default: 2200, min: 800, max: 4000, step: 50, status: 'assumed', ref: 'D-19, D-53',
    note: 'Raised from 1,800 to 2,000 in³ (Phase 3 integration): the 10 Essentials packing check (D-41) filled 0.96 of the 1,762 in³ interior at 1,800. Raised again to 2,200 in³ (Phase 3c-2, D-53): the box also holds the seat back and cushion in cargo mode, so it needs about 4.8 in of height under the lid frame for them (seat-stow check).',
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
    default: 15.5, min: 1.5, max: 17.5, step: 0.5, status: 'explore', primary: true, ref: 'D-53',
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
    note: 'An oak board across the nose, braced by the nose sides.',
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
    default: 35.5, min: 28, max: 42, step: 0.5, status: 'explore', primary: true, ref: 'D-12, D-51',
    note: 'The tow lock: the INNER wheel angle (the outer wheel follows the Ackermann trapezoid, about 26 deg at 35.5). Limited above by the turning radius (D-51, 108") and by the tire sweep that sets the bow width (D-52).',
  },
  // ── Phase 3 workstream A: steering stops, kingpin, bridle ties, front mounting (D-31…D-35) ──
  kingpinPlateBoltYieldPsi: {
    label: 'Kingpin plate bolt yield strength', group: 'steering', unit: 'psi',
    default: 130000, min: 30000, max: 150000, step: 5000, status: 'verify', ref: 'D-43',
    note: 'SAE grade 8, zinc-flake coated and sealed in epoxy where it runs through oak. 316 stainless (cold worked F593, 65 ksi) cuts the stop-torque margin below 1: see the kingpin-bolts row.',
  },
  kingpinCrossBoltYieldPsi: {
    label: 'Kingpin cross-bolt yield strength', group: 'steering', unit: 'psi',
    default: 65000, min: 30000, max: 100000, step: 1000, status: 'assumed', ref: 'D-43',
    note: '316 stainless, cold-worked ASTM F593 condition CW (65 ksi min yield for ⅜"). Allowable tension = yield / steel safety factor.',
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
  tongueThickIn: {
    label: 'Tongue width (across)', group: 'steering', unit: 'in',
    default: 1, min: 0.75, max: 2, step: 0.25, status: 'assumed', ref: 'D-14',
  },
  tongueDepthIn: {
    label: 'Tongue depth (vertical)', group: 'steering', unit: 'in',
    default: 2.5, min: 1, max: 3.5, step: 0.25, status: 'assumed', ref: 'D-14',
    note: 'Clamped to the front beam depth so the tongue never reaches the turntable.',
  },
  kingpinLeadIn: {
    label: 'Kingpin ahead of front axle (trail)', group: 'steering', unit: 'in',
    default: 1.25, min: 0.875, max: 1.5, step: 0.125, status: 'explore', ref: 'D-25, D-53',
    note: 'Kingpin axis ahead of the front axle line (the spindle stub): the trailing wheel self-centers under pull like a caster.',
  },
  kingpinDiameterIn: {
    label: 'Kingpin bolt diameter', group: 'steering', unit: 'in',
    default: 0.375, min: 0.25, max: 1, step: 0.0625, status: 'explore', ref: 'D-12, D-53',
    note: 'Grade 8 kingpin bolt through the bracket leaves and the spindle boss (bump rows, D-50).',
  },
  kingpinYieldPsi: {
    label: 'Kingpin bolt yield strength', group: 'steering', unit: 'psi',
    default: 130000, min: 30000, max: 150000, step: 5000, status: 'assumed', ref: 'D-12',
    note: 'SAE grade 8 = 130 ksi. 18-8 stainless ≈ 30–65 ksi depending on temper.',
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

  // ── Brake & rear handle ──────────────────────────────────────────────────
  brakeLeverRatio: {
    label: 'Brake mechanical advantage TARGET', group: 'brake', unit: ':1',
    default: 10, min: 2, max: 16, step: 0.5, status: 'explore', ref: 'D-53',
    note: 'Phase 3c-1 (D-53): a target, not an input. The analysis uses the ratio DERIVED from the lever / link / beam geometry (hand force at the grip to total shoe normal force); brake-ratio fails if the geometry delivers less than this. 10:1 at 80 percent efficiency holds the goal rider (200 lb) on 15 degrees at the mud-fouled lining with about 26 lbf at the grip.',
  },
  brakeLeverWidthIn: {
    label: 'Brake lever bar width (in the plane of the pull)', group: 'brake', unit: 'in',
    default: 1.5, min: 1, max: 2.5, step: 0.25, status: 'assumed', ref: 'D-53',
    note: 'The hand lever is a flat aluminum bar (6061-T6), brakeBarThickIn thick across the cart and this wide in the plane of the pull, standing behind the rear transom on its own pivot bracket.',
  },
  brakeLeverStandoffIn: {
    label: 'Brake lever standoff behind the pivot bracket plate', group: 'brake', unit: 'in',
    default: 0.75, min: 0.25, max: 2, step: 0.125, status: 'assumed', ref: 'D-53',
    note: 'Air between the pivot bracket plate (on the transom) and the lever bar edge: keeps the finger-pinch gap open (over 3/8") and lets the link reach forward to the beam.',
  },
  brakeBeamSizeIn: {
    label: 'Brake beam square tube size', group: 'brake', unit: 'in',
    default: 1.75, min: 1, max: 2, step: 0.25, status: 'assumed', ref: 'D-53',
    note: 'The brake beam is one 6061-T6 aluminum square tube across the tail, behind the rear tires, with a lined shoe at each end. It slides fore-aft in a notch in each cabin rail (the notches are the guides) and rests on a keeper strap under each notch. Bolted only.',
  },
  brakeBeamWallIn: {
    label: 'Brake beam tube wall', group: 'brake', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-53',
  },
  brakeKeeperThickIn: {
    label: 'Brake beam keeper strap thickness', group: 'brake', unit: 'in',
    default: 0.25, min: 0.0625, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-53',
    note: 'A steel strap screwed across the bottom of each rail notch; the beam rests on it. The beam height follows from the rail bottom, the strap and the tube size.',
  },
  brakeAluminumYieldPsi: {
    label: 'Brake beam and lever aluminum yield (6061-T6)', group: 'brake', unit: 'psi',
    default: 35000, min: 15000, max: 45000, step: 1000, status: 'assumed', ref: 'D-53',
    note: 'Allowable = yield / steelSafetyFactor (shear 0.577x). The same value for the beam tube and the lever bar.',
  },
  brakeParkPitchIn: {
    label: 'Parking quadrant: hole pitch along the arc', group: 'brake', unit: 'in',
    default: 0.5, min: 0.25, max: 1, step: 0.125, status: 'assumed', ref: 'D-53',
    note: 'The parking hold is a hitch pin through the lever and one of a row of holes in the pivot ear (a quadrant concentric with the lever pivot). The pitch sets how finely the hold takes up shoe wear.',
  },
  brakeParkRadiusIn: {
    label: 'Parking quadrant radius (pivot to the pin holes)', group: 'brake', unit: 'in',
    default: 7, min: 4, max: 12, step: 0.5, status: 'assumed', ref: 'D-53',
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
  brakeLiningThickIn: {
    label: 'Brake lining thickness (bonded to the oak pad face)', group: 'brake', unit: 'in',
    default: 0.25, min: 0.0625, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-13, D-56',
    note: 'Woven or molded lining sheet, cut on the bandsaw and bonded to the oak pad with contact or epoxy adhesive plus two stainless pan-head screws. Counted inside the shoe radial thickness.',
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

  // ── Brake mechanism geometry (D-38) ───────────────────────────────────────
  brakeShoeTravelIn: {
    label: 'Brake shoe engagement stroke (pad to tread)', group: 'brake', unit: 'in',
    default: 0.3125, min: 0.1, max: 0.75, step: 0.025, status: 'assumed', ref: 'D-38',
    note: 'Released gap to the tread plus tire/pad compliance and a little wear allowance (the clevis lengthens the link to take up more). Sets the lever stroke: stroke ≈ ratio × this. 3/8" so a muddy shoe retracts clear of the tread (build review S10).',
  },
  brakeBarWidthIn: {
    label: 'Brake steel flat bar width (arms, crank, ratchet pawl)', group: 'brake', unit: 'in',
    default: 1, min: 0.75, max: 2, step: 0.25, status: 'assumed', ref: 'D-38',
  },
  brakeBarThickIn: {
    label: 'Brake steel flat bar thickness', group: 'brake', unit: 'in',
    default: 0.25, min: 0.125, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-38',
  },
  brakeLeverTailIn: {
    label: 'Brake lever tail length (pivot to link pin)', group: 'brake', unit: 'in',
    default: 1.5, min: 1, max: 4, step: 0.05, status: 'explore', ref: 'D-53',
    note: 'The input lever arm of the linkage: the grip arm over this is most of the mechanical advantage (shorter = more advantage and more pivot load). The pivot stands this far above the link line.',
  },
  brakeLeverTiltDeg: {
    label: 'Brake lever tilt toward the rear', group: 'brake', unit: '°',
    default: 4, min: 0, max: 25, step: 1, status: 'assumed', ref: 'D-38',
    note: 'Leans the grip back toward the push handle.',
  },
  brakePivotBoltDiameterIn: {
    label: 'Brake lever pivot bolt diameter', group: 'brake', unit: 'in',
    default: 0.375, min: 0.25, max: 0.625, step: 0.0625, status: 'assumed', ref: 'D-53',
    note: 'A 316 shoulder bolt through the two pivot ears and the lever bar (double shear). The old cantilevered welded post of D-48 is gone.',
  },
  brakeBracketBoltDiameterIn: {
    label: 'Brake pivot bracket bolt diameter (to the rear transom)', group: 'brake', unit: 'in',
    default: 0.25, min: 0.1875, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-53',
    note: 'Four 316 button-head bolts through the bracket plate and the transom. The lever load pushes the plate INTO the transom, so these hold it in place rather than carry the pull.',
  },
  brakePlateThickIn: {
    label: 'Brake pivot bracket plate and ear thickness (A36, outsourced)', group: 'brake', unit: 'in',
    default: 0.1875, min: 0.125, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-53',
  },
  brakeLiningMaxPsi: {
    label: 'Brake lining allowable contact pressure', group: 'brake', unit: 'psi',
    default: 100, min: 30, max: 300, step: 10, status: 'assumed', ref: 'D-53',
    note: 'Woven or molded lining against a rubber tread: a long-life limit for a brake used only now and then. Pressure = shoe normal force / lining area at the lambda hold load.',
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
  brakeClevisPinDiameterIn: {
    label: 'Brake clevis pin diameter', group: 'brake', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-38',
  },
  brakeLeverGripBelowHandleIn: {
    label: 'Brake lever grip below the push-handle grip', group: 'brake', unit: 'in',
    default: 4, min: 0, max: 10, step: 0.5, status: 'assumed', ref: 'D-38, D-53',
    note: 'Measured from the grip height at the posts (rearHandleHeightIn). The handlebow crowns above that at the middle (handleBowCrownIn), so the lever hangs in the hollow under the crown with that much more finger room; raising the lever to follow the crown makes the 100 lbf abuse case fail (the grip arm grows).',
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
    default: 108, min: 60, max: 144, step: 1, status: 'locked', ref: 'A-2, D-51',
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
  // ── Phase 3b: Ackermann front end and bump loads (D-50..D-52, spec docs/phase3b-spec.md); the ride-mode parts of this block went at Phase 3c-1 (D-53) ──
  spindleStub: {
    label: 'Spindle stub diameter', group: 'steering', unit: '',
    default: 1, min: 0, max: 1, step: 1, status: 'verify', ref: 'D-53',
    note: 'Purchased racing-kart spindle stub. 25 mm (0.984") is the default: section modulus 0.0936 in3 vs 0.0294 in3 for 17 mm (3.2x), and the front wheels keep their 13" hand-truck wheels with a 1" bore (no sleeve adapter, orchestrator decision). 17 mm needs a sleeve adapter and is the weak option.',
    options: [{ value: 0, label: '17 mm (0.669")' }, { value: 1, label: '25 mm (0.984")' }],
  },
  spindleStubLengthIn: {
    label: 'Spindle stub length (boss face to tip)', group: 'steering', unit: 'in',
    default: 3.5, min: 2.5, max: 5, step: 0.25, status: 'verify', ref: 'D-53',
    note: 'Catalog spindle; verify against the part bought.',
  },
  spindleYieldPsi: {
    label: 'Spindle yield strength', group: 'steering', unit: 'psi',
    default: 100000, min: 60000, max: 150000, step: 5000, status: 'verify', ref: 'D-53',
    note: 'Hardened chromoly-class assumption; verify with the maker.',
  },
  spindleUltimatePsi: {
    label: 'Spindle ultimate strength', group: 'steering', unit: 'psi',
    default: 125000, min: 80000, max: 180000, step: 5000, status: 'verify', ref: 'D-53',
    note: 'Hardened chromoly-class assumption; used for the hard-hit (fail-safe) rows and the Goodman fatigue row.',
  },
  spindleMassLb: {
    label: 'Spindle mass (each)', group: 'steering', unit: 'lb',
    default: 2.2, min: 1, max: 5, step: 0.1, status: 'verify', ref: 'D-53',
    note: 'Catalog estimate.',
  },
  spindleBossAboveStubIn: {
    label: 'Kingpin boss center above the stub axis', group: 'steering', unit: 'in',
    default: 1.9, min: 1, max: 3, step: 0.1, status: 'verify', ref: 'D-53',
    note: 'Sets the bracket leaf heights and the kingpin boss position.',
  },
  kingpinInclinationDeg: {
    label: 'Kingpin inclination (KPI)', group: 'steering', unit: '°',
    default: 6, min: 0, max: 12, step: 0.5, status: 'assumed', ref: 'D-53',
    note: 'Built into the bracket as hole offsets. Neglected in the plan kinematics (camber and lift change from KPI are ignored); used for the geometry display and analysis rows.',
  },
  casterDeg: {
    label: 'Caster', group: 'steering', unit: '°',
    default: 6, min: 0, max: 12, step: 0.5, status: 'assumed', ref: 'D-53',
    note: 'Built into the bracket as hole offsets. Ground trail = lead + r tan(caster). Neglected in the plan kinematics.',
  },
  scrubRadiusIn: {
    label: 'Scrub radius (kingpin inboard of the wheel center)', group: 'steering', unit: 'in',
    default: 3, min: 0.5, max: 5, step: 0.25, status: 'assumed', ref: 'D-53',
    note: 'Orchestrator decision: 3.0" accepted. Driven by the wheel hub (hubLengthIn/2), the bracket leaf and 0.5" clearance. Validator: scrub >= hubLengthIn/2 + kingpinBracketLeafRadiusIn + 0.5. A dished wheel or thinner hub would give back about 1.5" of scrub and 1.6" of nose width.',
  },
  steerArmLengthIn: {
    label: 'Steering arm length (kingpin to tie-rod pin)', group: 'steering', unit: 'in',
    default: 3, min: 1.5, max: 5, step: 0.25, status: 'assumed', ref: 'D-53',
    note: 'Arm vector at neutral = (-A cos g, -/+ A sin g), rearward and inboard.',
  },
  ackermannAngleDeg: {
    label: 'Steering arm angle (Ackermann)', group: 'steering', unit: '°',
    default: 24, min: 10, max: 40, step: 0.5, status: 'explore', ref: 'D-53',
    note: 'Tuned so the 4-bar tracks ideal Ackermann at the tow lock (error 0.03 deg there, worst 0.59 deg mid-range). Ideal (arms meeting at the rear axle center) is atan(kpHalf / kx) = 18.1 deg, but that underperforms at large lock. The real spindle arm angle may differ (DECISIONS Q-list).',
  },
  frontBeamWidthIn: {
    label: 'Front beam width (fore-aft)', group: 'steering', unit: 'in',
    default: 2, min: 1.5, max: 3, step: 0.25, status: 'assumed', ref: 'D-53',
    note: 'Steel rectangular tube (A500), orchestrator decision. Width is the fore-aft dimension, depth the vertical one.',
  },
  frontBeamDepthIn: {
    label: 'Front beam depth (vertical)', group: 'steering', unit: 'in',
    default: 2, min: 1.5, max: 3, step: 0.25, status: 'assumed', ref: 'D-53',
    note: 'Steel rectangular tube.',
  },
  frontBeamWallIn: {
    label: 'Front beam wall thickness', group: 'steering', unit: 'in',
    default: 0.12, min: 0.083, max: 0.25, step: 0.01, status: 'assumed', ref: 'D-53',
    note: 'A500 tube, 0.120" wall.',
  },
  frontBeamBehindKingpinIn: {
    label: 'Front beam center behind the kingpin line', group: 'steering', unit: 'in',
    default: 0.5, min: 0, max: 2, step: 0.25, status: 'assumed', ref: 'D-53',
    note: 'Beam center x = kx - this (44.75" at the defaults).',
  },
  frontBeamYieldPsi: {
    label: 'Front beam yield strength', group: 'steering', unit: 'psi',
    default: 46000, min: 30000, max: 70000, step: 1000, status: 'assumed', ref: 'D-53',
    note: 'A500 grade B.',
  },
  kingpinBracketThickIn: {
    label: 'Kingpin bracket thickness', group: 'steering', unit: 'in',
    default: 0.1875, min: 0.125, max: 0.3125, step: 0.0625, status: 'assumed', ref: 'D-53',
    note: '3/16" A36 C-channel bent from one flat blank, laser cut and press-brake bent (outsourced, no welding).',
  },
  kingpinBracketGapIn: {
    label: 'Kingpin bracket leaf gap', group: 'steering', unit: 'in',
    default: 2, min: 1, max: 3, step: 0.125, status: 'verify', ref: 'D-53',
    note: 'Leaf gap = spindle boss height plus shims.',
  },
  kingpinBracketLeafRadiusIn: {
    label: 'Kingpin bracket leaf footprint radius', group: 'steering', unit: 'in',
    default: 1, min: 0.75, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-53',
    note: 'Leaf footprint radius around the pivot; enters the scrub validator.',
  },
  kingpinBracketBoltDiaIn: {
    label: 'Kingpin bracket web bolt diameter', group: 'steering', unit: 'in',
    default: 0.3125, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-53',
    note: '5/16" grade 8 through the beam end with crush sleeves and nylock nuts (four per side).',
  },
  tieRodDiaIn: {
    label: 'Tie rod diameter', group: 'steering', unit: 'in',
    default: 0.5, min: 0.375, max: 0.75, step: 0.0625, status: 'assumed', ref: 'D-53',
    note: '1/2" threaded rod with left- and right-hand rod ends (adjustable toe). Euler buckling of the 27" rod is a check.',
  },
  tieRodEndDiaIn: {
    label: 'Tie rod end bolt diameter', group: 'steering', unit: 'in',
    default: 0.3125, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-53',
    note: '5/16" rod ends.',
  },
  bellcrankArmIn: {
    label: 'Bellcrank output arm length (drag link pin)', group: 'steering', unit: 'in',
    default: 4.5, min: 2.5, max: 5.5, step: 0.25, status: 'assumed', ref: 'D-53',
    note: 'Re-laid in Stage 1 (WS-A): the exact link solution, not the lateral-transfer model, sets the angles. The drag link stands nearly along y (across the car) so it carries the rod-center sideways travel; the arm is nearly fore-aft. See docs/phase3b-wsA-notes.md.',
  },
  bellcrankOutAngleDeg: {
    label: 'Bellcrank output arm angle (from +x, CCW)', group: 'steering', unit: '°',
    default: 27.5, min: 0, max: 90, step: 0.5, status: 'assumed', ref: 'D-53',
    note: 'The drag link pin sits ahead and to the left of the pivot, almost directly aft of the tie-rod center line, so the drag link runs across the car (transmission angle >= 0.8).',
  },
  bellcrankInArmIn: {
    label: 'Bellcrank input arm length (tongue link pin)', group: 'steering', unit: 'in',
    default: 3, min: 2, max: 5, step: 0.25, status: 'assumed', ref: 'D-53',
  },
  bellcrankInAngleDeg: {
    label: 'Bellcrank input arm angle (from +x, CCW)', group: 'steering', unit: '°',
    default: 54, min: 0, max: 120, step: 0.5, status: 'assumed', ref: 'D-53',
    note: 'With the tongue ear on the right and aft of the hinge, left and right tow locks give tongue yaws within 0.5 deg of each other.',
  },
  bellcrankPivotAftOfKingpinIn: {
    label: 'Bellcrank pivot behind the kingpin line', group: 'steering', unit: 'in',
    default: 6.5, min: 4, max: 10, step: 0.25, status: 'assumed', ref: 'D-53',
    note: 'Pivot x = kx - this (38.75" at the defaults), y = 0.',
  },
  tongueHingeAheadOfBeamIn: {
    label: 'Tongue hinge ahead of the beam front face', group: 'steering', unit: 'in',
    default: 1.5, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-53',
    note: 'Vertical hinge pin in a bolted clevis (47.25" at the defaults).',
  },
  tongueLinkArmIn: {
    label: 'Tongue link ear offset to the right of the hinge', group: 'steering', unit: 'in',
    default: 1.75, min: 0.5, max: 4, step: 0.25, status: 'assumed', ref: 'D-53',
    note: 'Re-laid in Stage 1: the ear sits on a clevis cross-plate, to the right of the hinge pin; it moves fore-aft as the tongue yaws, which a fore-aft link transmits. About 22 deg of tongue yaw at the tow lock (exact solution), 3 deg inside the stop.',
  },
  tongueEarAheadIn: {
    label: 'Tongue link ear ahead of the hinge (negative = aft, over the beam)', group: 'steering', unit: 'in',
    default: -1.75, min: -4, max: 4, step: 0.25, status: 'assumed', ref: 'D-53',
    note: 'The clevis plate reaches back over the beam top.',
  },
  tongueMaxYawDeg: {
    label: 'Tongue yaw stop', group: 'steering', unit: '°',
    default: 25, min: 15, max: 35, step: 1, status: 'assumed', ref: 'D-53',
    note: 'Yaw stops at +/- this; the tow lock must be reached before it.',
  },
  tongueLinkPinDiaIn: {
    label: 'Tongue-link pin diameter', group: 'steering', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-53',
    note: 'The captured clevis pin that joins the tongue link to the bellcrank (pull it to take the tongue off).',
  },
  brakeShoeBackThickIn: {
    label: 'Steel shoe back thickness', group: 'brake', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.1875, step: 0.0625, status: 'assumed', ref: 'D-56',
  },
  brakeLinedShoeWidthIn: {
    label: 'Lined steel-backed shoe width (across the tread)', group: 'brake', unit: 'in',
    default: 3.7, min: 1.5, max: 3.7, step: 0.1, status: 'verify', ref: 'D-56',
    note: 'WS-C: 3.7 in on the 4 in tire (the oak pad stays brakeShoeWidthIn 2.5). Shoe area sets the heat run (time scales with area squared); the arms sit just outside the shoe, inside the tire edges.',
  },
  brakeLinedShoeLengthIn: {
    label: 'Lined steel-backed shoe length (along the tread)', group: 'brake', unit: 'in',
    default: 3, min: 2, max: 6, step: 0.25, status: 'verify', ref: 'D-56',
    note: 'REAR lined shoe, radius-matched to the 13" tire. The rear shoe sits 11 deg below the axle line; at 3.25 in its released corner is 3.41 in off the ground (limit 3.5), at 3.0 in the lowest part is the crank clevis (3.51 in); the front shoes (frontBrakeShoeLengthIn) are longer. Heat time scales with area squared. The oak pad keeps brakeShoeLengthIn.',
  },
  bumpSpeedMph: {
    label: 'Bump design speed (jogging pace)', group: 'bump', unit: 'mph',
    default: 5, min: 2, max: 8, step: 0.5, status: 'assumed', ref: 'D-53, D-54',
    note: 'Phase 3c-1 (D-53): loads are at walking or jogging pace on a camp road (ride mode and its 10 mph cases are gone). The 1" routine bump and the hard-hit basis are both taken at this speed. D-50 still holds: bumps, not curbs.',
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
    label: 'Effective wheel radial stiffness', group: 'bump', unit: 'lb/in',
    default: 400, min: 150, max: 1500, step: 25, status: 'verify', ref: 'D-54',
    note: 'Pneumatic wheel including bottoming. The dominant uncertainty of the bump model: verify by a deflection test.',
  },
  bumpMassShare: {
    label: 'Effective bump mass (multiple of the struck wheel static load)', group: 'bump', unit: '×',
    default: 1.5, min: 1, max: 3, step: 0.1, status: 'assumed', ref: 'D-54',
    note: 'Wheel plus its share of the axle line.',
  },
  failSafeFactor: {
    label: 'Fail-safe factor on ultimate (hard hit)', group: 'factors', unit: '×',
    default: 1.25, min: 1, max: 2, step: 0.05, status: 'assumed', ref: 'D-54',
    note: 'Orchestrator decision: hard-hit rows compare to ultimate / this (1.25).',
  },
  fatigueLoadFactor: {
    label: 'Fatigue load factor (static wheel load multiple)', group: 'factors', unit: '×',
    default: 2.5, min: 1, max: 5, step: 0.25, status: 'assumed', ref: 'D-54',
    note: 'Pulsating (the stub is fixed, the wheel rotates).',
  },
  spindleEnduranceLimitPsi: {
    label: 'Spindle endurance limit', group: 'factors', unit: 'psi',
    default: 30000, min: 15000, max: 60000, step: 1000, status: 'verify', ref: 'D-54',
    note: 'Marin-derated; verify.',
  },
  fatigueSafetyMin: {
    label: 'Min fatigue safety factor (Goodman)', group: 'factors', unit: '×',
    default: 1.5, min: 1, max: 3, step: 0.1, status: 'assumed', ref: 'D-54',
  },
  ackermannErrorMaxDeg: {
    label: 'Max Ackermann error over the lock', group: 'factors', unit: '°',
    default: 1, min: 0.2, max: 3, step: 0.1, status: 'assumed', ref: 'D-53',
  },

  // ── Phase 3b WS-D: material strengths and detail sizes for the front-end rows (analysis/front-end.ts, linkage.ts). Hard-hit rows use the ultimate values. ──
  axleUltimatePsi: {
    label: 'Axle steel ultimate strength', group: 'factors', unit: 'psi',
    default: 85000, min: 45000, max: 140000, step: 1000, status: 'assumed', ref: 'D-54',
    note: 'Companion of axleYieldPsi (1045 cold-finished ~ 91 ksi nominal; 85 ksi assumed). Hard-hit rear axle row.',
  },
  frontBeamUltimatePsi: {
    label: 'Front beam ultimate strength', group: 'factors', unit: 'psi',
    default: 58000, min: 40000, max: 100000, step: 1000, status: 'assumed', ref: 'D-54',
    note: 'A500 grade B tube.',
  },
  kingpinUltimatePsi: {
    label: 'Grade 8 bolt ultimate strength', group: 'factors', unit: 'psi',
    default: 150000, min: 60000, max: 170000, step: 5000, status: 'assumed', ref: 'D-54',
    note: 'Kingpin and bracket bolts (SAE grade 8 = 150 ksi tensile, 130 ksi yield in kingpinYieldPsi).',
  },
  bracketSteelYieldPsi: {
    label: 'Bracket / plate steel yield strength', group: 'factors', unit: 'psi',
    default: 36000, min: 30000, max: 60000, step: 1000, status: 'assumed', ref: 'D-54',
    note: 'A36 plate: kingpin bracket leaves, bellcrank, brake pivot bracket.',
  },
  bracketSteelUltimatePsi: {
    label: 'Bracket / plate steel ultimate strength', group: 'factors', unit: 'psi',
    default: 58000, min: 40000, max: 80000, step: 1000, status: 'assumed', ref: 'D-54',
  },
  linkRodYieldPsi: {
    label: 'Tie rod / link rod yield strength', group: 'steering', unit: 'psi',
    default: 36000, min: 30000, max: 100000, step: 1000, status: 'assumed', ref: 'D-54',
    note: 'Mild-steel threaded rod (A307 class). Grade 5 rod would be 92 ksi.',
  },
  linkRodUltimatePsi: {
    label: 'Tie rod / link rod ultimate strength', group: 'steering', unit: 'psi',
    default: 60000, min: 40000, max: 120000, step: 1000, status: 'assumed', ref: 'D-54',
  },
  rodEndRatingLbf: {
    label: 'Rod end static radial rating', group: 'steering', unit: 'lbf',
    default: 2500, min: 500, max: 8000, step: 100, status: 'verify', ref: 'D-54',
    note: 'A 5/16" bolt-size rod end (heim joint) is typically listed 2-5 kips static radial; read the catalog for the part bought. The study warned that kart 5/16" rod ends are marginal.',
  },
  spindleBossRadiusIn: {
    label: 'Spindle kingpin boss radius (thrust face)', group: 'steering', unit: 'in',
    default: 0.75, min: 0.4, max: 1.2, step: 0.05, status: 'verify', ref: 'D-53',
    note: 'The boss thrust faces can react a vertical wheel load up to this far off the kingpin axis; the remaining lever to the wheel plane (scrub minus this) loads the kingpin bolt.',
  },
  spindleBossLengthIn: {
    label: 'Spindle kingpin boss length (bearing length)', group: 'steering', unit: 'in',
    default: 1.75, min: 0.75, max: 2.5, step: 0.05, status: 'verify', ref: 'D-53',
    note: 'Less than the bracket leaf gap by the shim stack.',
  },
  steerArmWidthIn: {
    label: 'Steering arm section width (in the plane)', group: 'steering', unit: 'in',
    default: 0.75, min: 0.4, max: 1.5, step: 0.05, status: 'verify', ref: 'D-53',
  },
  steerArmThickIn: {
    label: 'Steering arm section thickness', group: 'steering', unit: 'in',
    default: 0.375, min: 0.2, max: 0.75, step: 0.025, status: 'verify', ref: 'D-53',
  },
  bellcrankPlateThickIn: {
    label: 'Bellcrank plate thickness', group: 'steering', unit: 'in',
    default: 0.25, min: 0.125, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-53',
  },
  bellcrankArmWidthIn: {
    label: 'Bellcrank arm width', group: 'steering', unit: 'in',
    default: 1.25, min: 0.75, max: 2.5, step: 0.125, status: 'assumed', ref: 'D-53',
  },
  tongueHingePinDiaIn: {
    label: 'Tongue hinge pin diameter', group: 'steering', unit: 'in',
    default: 0.5, min: 0.25, max: 0.75, step: 0.0625, status: 'assumed', ref: 'D-53',
    note: 'Grade 8, vertical, double shear in the clevis.',
  },
  tongueClevisThickIn: {
    label: 'Tongue hinge clevis plate thickness', group: 'steering', unit: 'in',
    default: 0.25, min: 0.125, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-53',
  },
  wheelCotterDiaIn: {
    label: 'Wheel cotter pin diameter', group: 'wheels', unit: 'in',
    default: 0.09375, min: 0.0625, max: 0.1875, step: 0.015625, status: 'assumed', ref: 'D-54',
    note: '3/32" cotter through the castle nut and stub end.',
  },
  wheelCotterUltimatePsi: {
    label: 'Wheel cotter pin ultimate strength', group: 'wheels', unit: 'psi',
    default: 55000, min: 30000, max: 100000, step: 1000, status: 'assumed', ref: 'D-54',
  },
  wheelNutEngagementIn: {
    label: 'Wheel castle-nut thread engagement', group: 'wheels', unit: 'in',
    default: 0.375, min: 0.2, max: 0.75, step: 0.025, status: 'assumed', ref: 'D-54',
  },
  stubThreadFrac: {
    label: 'Threaded stub end diameter / stub diameter', group: 'wheels', unit: '',
    default: 0.75, min: 0.5, max: 0.95, step: 0.05, status: 'assumed', ref: 'D-54',
    note: 'The thread at the stub tip is smaller than the stub (25 mm stub: about 3/4"-16; 17 mm: M12).',
  },
  rutWallLateralFrac: {
    label: 'Rut-wall lateral hit as a fraction of the vertical bump force', group: 'factors', unit: '',
    default: 0.8, min: 0.2, max: 1.5, step: 0.05, status: 'assumed', ref: 'D-54',
    note: 'Wheel retention row: the wheel is hit sideways with F_lat = this x V while it is also being hit by the bump.',
  },
  holdDownBoltUltimatePsi: {
    label: 'Rear beam hold-down bolt ultimate strength (316)', group: 'factors', unit: 'psi',
    default: 90000, min: 50000, max: 150000, step: 1000, status: 'assumed', ref: 'D-54',
    note: 'Companion of kingpinCrossBoltYieldPsi for the hard-hit rear-beam-seat row (316 stainless, cold-worked A4-70 about 100 ksi).',
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
 * Resolve derived-by-rule params (A-4, D-26, D-52): the bow curve's start (earlier, never later, when the lamination radius or the tire sweep needs it) and
 * the derived `noseTaperStartIn`. Pure and idempotent; every consumer (model, layout, validator, analysis) calls it first.
 */
export function resolveParams(p: Params): Params {
  return resolveNoseAck(p);
}

/** The tire-sweep clearance spec the hull curve is tested against (the Ackermann sweep; centerline half widths, D-45, D-52). */
export function hullCurveSpec(p: Params): CurveClearanceSpec {
  return {
    tireWidth: p.tireWidthIn,
    wheelDiameter: p.wheelDiameterIn,
    yA: p.bodyWidthIn / 2 - p.sideThicknessIn / 2, yB: p.noseWidthIn / 2 - p.sideThicknessIn / 2, side: p.sideThicknessIn,
    ack: ackSpec(p),
  };
}

/** The bow curve spec (Ackermann hull, D-52) for a curve start `x0`: centerline half widths, the front transom's inner face and the straight bow run. */
export function bowSpecOf(p: Params, x0: number): BowSpec {
  const side = p.sideThicknessIn;
  return { x0, yA: p.bodyWidthIn / 2 - side / 2, xT: p.wheelbaseIn + p.frontOverhangIn - p.transomThicknessIn, yT: p.noseWidthIn / 2 - side / 2, straightIn: p.hullBowStraightIn };
}

/**
 * The plan curve of the hull side centerline for RESOLVED params: the gentlest bow curve that clears the tire sweep (fitBowCurve) from the curve start to the front transom.
 */
export function hullPlanCurve(p: Params): PlanCurve {
  return fitBowCurve(bowSpecOf(p, p.hullCurveStartIn), hullCurveSpec(p), p.sideThicknessIn, p.steeringClearanceIn).curve;
}

/** Smallest distance from the hull's OUTER face to the left front tire over the whole steering sweep, for RESOLVED params (the curve from `hullPlanCurve`). */
export function hullTireGap(p: Params, curve: PlanCurve = hullPlanCurve(p)): number {
  const spec = hullCurveSpec(p);
  const xT = p.wheelbaseIn + p.frontOverhangIn - p.transomThicknessIn;
  return minGapToTires(sidePolyline(curve, p.sideThicknessIn / 2, curve.x0 - 0.5, xT), leftTirePolys(spec));
}

/** Rider foot box (D-3 mannequin: foot length 0.14 of stature, the foot stop's rear face at seatX + leg reach): the x range the hull must be wide enough for. */
export function footZoneX(p: Params): [number, number] {
  const stopRear = p.seatXIn + p.riderLegReachIn - p.footStopThickIn / 2;
  return [stopRear - 0.14 * p.riderStatureIn, stopRear];
}

/**
 * Ackermann kinematics spec (spec section 1.8) from the params: kingpin points, steering arms, derived tie rod, bellcrank and tongue. Plain numbers,
 * so `model/ackermann.ts` stays pure. Front beam width is the fore-aft dimension; the tongue hinge sits `tongueHingeAheadOfBeamIn` ahead of the beam front face.
 */
export function ackSpec(p: Params): AckSpec {
  const kx = p.wheelbaseIn + p.kingpinLeadIn;
  const kpHalf = p.frontTrackIn / 2 - p.scrubRadiusIn;
  const spec: AckSpec = {
    wheelbase: p.wheelbaseIn,
    kx,
    lead: p.kingpinLeadIn,
    scrub: p.scrubRadiusIn,
    kpHalf,
    armLen: p.steerArmLengthIn,
    armAngleDeg: p.ackermannAngleDeg,
    tieLen: 0,
    bellArm: p.bellcrankArmIn,
    bellOutDeg: p.bellcrankOutAngleDeg,
    bellInArm: p.bellcrankInArmIn,
    bellInDeg: p.bellcrankInAngleDeg,
    tongueEar: [p.tongueEarAheadIn, -p.tongueLinkArmIn],
    bellPivot: [kx - p.bellcrankPivotAftOfKingpinIn, 0],
    tongueHinge: [kx - p.frontBeamBehindKingpinIn + p.frontBeamWidthIn / 2 + p.tongueHingeAheadOfBeamIn, 0],
    tongueLinkArm: p.tongueLinkArmIn,
    towLockInnerDeg: p.steerLockDeg,
  };
  spec.tieLen = neutralTieLen(spec);
  return spec;
}

const ackNoseCache = new Map<string, { noseTaperStartIn: number; hullCurveStartIn: number }>();

/**
 * Ackermann hull (D-52). The curved part ends `hullBowStraightIn` behind the front transom's inner face (a derived `noseTaperStartIn`); the bow width is
 * the user's `noseWidthIn`. With auto on, the curve start moves EARLIER (never later, never ahead of the 8" slider minimum) until the gentlest bow curve
 * clears the tire sweep and meets the lamination radius: an earlier start is a longer, gentler curve.
 */
function resolveNoseAck(p: Params): Params {
  const taper = Math.round((p.hullBowStraightIn + p.transomThicknessIn - p.frontOverhangIn) * 1e6) / 1e6;
  let x0 = p.hullCurveStartIn;
  if (p.autoNoseGeometry === 1) {
    const ck = [p.wheelbaseIn, p.kingpinLeadIn, p.scrubRadiusIn, p.frontTrackIn, p.steerArmLengthIn, p.ackermannAngleDeg, p.steerLockDeg, p.tireWidthIn, p.wheelDiameterIn, p.sideThicknessIn,
      p.bodyWidthIn, p.noseWidthIn, p.steeringClearanceIn, p.hullCurveStartIn, p.hullBowStraightIn, p.frontOverhangIn, p.transomThicknessIn, p.railThicknessIn, p.hullLamThicknessIn,
      p.hullLamMinRadiusFactor, p.hullWebPlies, p.panelPlyIn, p.sideConstruction].join('|');
    const hit = ackNoseCache.get(ck);
    if (hit) x0 = hit.hullCurveStartIn;
    else {
      const needR = requiredCurveRadius(p);
      const spec = hullCurveSpec(p);
      const ok = (x: number) => {
        const f = fitBowCurve(bowSpecOf(p, x), spec, p.sideThicknessIn, p.steeringClearanceIn);
        return f.feasible && f.curve.minRadius >= needR - 1e-9;
      };
      const xnEnd = p.wheelbaseIn + p.frontOverhangIn - p.transomThicknessIn - p.hullBowStraightIn;
      if (!ok(x0) && xnEnd - HULL_CURVE_START_MIN_IN > 3) {
        let lo = HULL_CURVE_START_MIN_IN, hi = x0;
        if (!ok(lo)) x0 = lo;
        else {
          while (hi - lo > 0.5 + 1e-9) {
            const mid = Math.floor(((lo + hi) / 2) * 2) / 2;
            if (ok(mid)) lo = mid; else hi = mid;
          }
          x0 = lo;
        }
      }
      if (ackNoseCache.size > 3000) ackNoseCache.clear();
      ackNoseCache.set(ck, { noseTaperStartIn: taper, hullCurveStartIn: x0 });
    }
  }
  if (taper === p.noseTaperStartIn && x0 === p.hullCurveStartIn) return p;
  return { ...p, noseTaperStartIn: taper, hullCurveStartIn: x0 };
}

/** Earliest the auto rule will move the curve start (the slider minimum). */
const HULL_CURVE_START_MIN_IN = 8;

/** Actual ply thickness of a laminated member `t` thick glued from strips of about `strip` (the ply count is rounded: 3/4" rail from 5/16" strips = 2 x 3/8"). */
export function lamPly(t: number, strip: number): number {
  return t / Math.max(1, Math.round(t / Math.max(0.01, strip)));
}

/** Smallest centerline radius (in) the hull curve may have: the inside face of every bent member must meet its cold-bend limit (D-45). */
export function requiredCurveRadius(p: Params): number {
  const strip = Math.max(0.01, p.hullLamThicknessIn);
  const web = p.panelPlyIn / Math.max(1, p.hullWebPlies);
  const f = p.hullLamMinRadiusFactor;
  const r = [f * lamPly(p.sideThicknessIn, strip) + p.sideThicknessIn / 2, f * lamPly(p.railThicknessIn, strip) + p.railThicknessIn / 2];
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
  const rodR = p.axleDiameterIn / 2;
  const tongueOnFront = p.tongueLengthIn;
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

  if (p.riderGoalMassLb < p.riderMassLb)
    warn(['riderGoalMassLb', 'riderMassLb'], 'The operating rider is heavier than the goal rider; the 200 lb goal checks no longer cover the heaviest case (the Simple view sweeps every weight).');
  if (p.targetMassMinLb > p.targetMassMaxLb)
    err(['targetMassMinLb', 'targetMassMaxLb'], 'Mass target low end exceeds high end.');
  if (p.noseWidthIn > p.bodyWidthIn)
    err(['noseWidthIn', 'bodyWidthIn'], 'Nose is wider than the cabin.');
  const rearInnerTire = p.rearTrackIn / 2 - p.tireWidthIn / 2;
  if (p.bodyWidthIn / 2 + 0.75 > rearInnerTire && p.deckHeightIn < p.wheelDiameterIn)
    err(['bodyWidthIn', 'rearTrackIn'], 'Cabin is too wide to clear the rear tires (needs ≥ ¾" each side).');
  const scrubMin = p.hubLengthIn / 2 + p.kingpinBracketLeafRadiusIn + 0.5;
  if (p.scrubRadiusIn < scrubMin - 1e-9)
    err(['scrubRadiusIn', 'hubLengthIn', 'kingpinBracketLeafRadiusIn'],
      `Scrub radius ${p.scrubRadiusIn}" is too small for the wheel hub and the kingpin bracket: needs ≥ hubLength/2 + bracket leaf radius + 0.5" = ${scrubMin.toFixed(2)}" (D-53).`);
  if (p.seatXIn < 0 && p.rearOverhangIn < -p.seatXIn + 6)
    err(['seatXIn', 'rearOverhangIn'], 'Seat hangs off the back of the body.');
  if (p.seatXIn + p.riderLegReachIn > p.wheelbaseIn + p.frontOverhangIn)
    err(['seatXIn', 'riderLegReachIn', 'frontOverhangIn'], 'Rider\'s feet extend past the front of the body.');
  // Seat geometry (critic H3, D-45): the grab handles end before the S-curve starts, the cushion stays inside the narrowing hull,
  // the leaning back must stay inside the rear transom, and a rear storage box needs room between the transom and the seat back.
  const xnCurve = p.wheelbaseIn - p.noseTaperStartIn;
  const cushionFront = p.seatXIn - p.seatBehindHpointIn + p.seatDepthIn;
  // The grab handles slide aft to stay under the straight cabin side (layout: `gxA = min(seatXIn - 5, curve start - side - length - 1/4)`), so the S-curve start never forces the seat back (D-53: the seat moved forward 3 in
  // so the seat kit lies flat in the box). The rule now only asks that they still reach the rider and clear the rear transom.
  const gripLen = p.seatGripClearLengthIn + 2;
  const gripStart = Math.min(p.seatXIn - 5, p.hullCurveStartIn - p.sideThicknessIn - gripLen - 0.25);
  if (p.seatXIn - gripStart > 9)
    err(['hullCurveStartIn', 'seatXIn', 'seatGripClearLengthIn'],
      `The S-curve starts at x = ${p.hullCurveStartIn}", so the grab handles (${gripLen}" long) must start at x = ${gripStart.toFixed(1)}", ${(p.seatXIn - gripStart).toFixed(1)}" behind the hips: out of reach (limit 9"). Start the curve later or move the seat back.`);
  if (cushionFront > xnCurve - 0.01)
    err(['seatXIn', 'seatDepthIn', 'noseTaperStartIn', 'wheelbaseIn'],
      `The seat cushion (front at x = ${cushionFront.toFixed(1)}") runs past the end of the hull curve (x = ${xnCurve.toFixed(1)}"). Move the seat back or shorten it.`);
  if (xnCurve < p.hullCurveStartIn + 3)
    err(['hullCurveStartIn', 'noseTaperStartIn', 'wheelbaseIn'],
      `The S-curve would be shorter than 3" (it starts at x = ${p.hullCurveStartIn}" and ends at ${xnCurve.toFixed(1)}"): start it earlier.`);
  else {
    const curve = hullPlanCurve(p);
    const seatHalf = Math.max(1, Math.min(p.seatWidthIn, p.bodyWidthIn - 2 * p.sideThicknessIn - 1)) / 2;
    const innerAtCushion = offsetY(curve, -p.sideThicknessIn / 2, Math.min(cushionFront, xnCurve));
    if (cushionFront > p.hullCurveStartIn && innerAtCushion < seatHalf + 0.25 - 1e-9)
      err(['hullCurveStartIn', 'seatXIn', 'seatDepthIn', 'seatWidthIn'],
        `The seat cushion (front at x = ${cushionFront.toFixed(1)}", ${(2 * seatHalf).toFixed(0)}" wide) runs into the narrowing hull: inside width there is only ${(2 * innerAtCushion).toFixed(1)}". Start the S-curve later, shorten the seat or narrow it.`);
    const tiresReach = p.wheelDiameterIn > p.deckHeightIn - p.deckPlyIn - p.crossmemberDepthIn;
    if (tiresReach) {
      const gap = hullTireGap(p, curve);
      if (gap < p.steeringClearanceIn - 1e-6)
        err(['hullCurveStartIn', 'noseTaperStartIn', 'noseWidthIn', 'steerLockDeg', 'frontTrackIn', 'kingpinLeadIn'],
          `The hull side comes within ${gap.toFixed(2)}" of the front tire at some steering angle (needs ≥ ${p.steeringClearanceIn}"). Narrow the bow, start the curve earlier (turn "Auto nose width & shoulder" on) or reduce the steering lock.`);
    }
    // Bent laminations: tightest radius of the INSIDE face vs the cold-bend limit (D-45).
    const strip = Math.max(0.01, p.hullLamThicknessIn);
    const webSheet = p.panelPlyIn / Math.max(1, p.hullWebPlies);
    const checks: Array<[string, number, number]> = [
      ['chine / gunwale', p.sideThicknessIn, lamPly(p.sideThicknessIn, strip)],
      ['ladder rail', p.railThicknessIn, lamPly(p.railThicknessIn, strip)],
      ...(p.sideConstruction === SIDE_CONSTRUCTION.capturedPly ? ([['side panel', p.panelPlyIn, webSheet]] as Array<[string, number, number]>) : []),
    ];
    for (const [name, thick, s1] of checks) {
      const rIn = curve.minRadius - thick / 2, lim = p.hullLamMinRadiusFactor * s1;
      if (rIn < lim - 1e-9)
        err(['hullCurveStartIn', 'hullLamThicknessIn', 'hullLamMinRadiusFactor', 'hullWebPlies'],
          `The ${name} bend radius ${rIn.toFixed(1)}" (inside face) is tighter than the cold-bend limit ${lim.toFixed(1)}" (${p.hullLamMinRadiusFactor} x ${s1.toFixed(3)}" strip): start the S-curve earlier, use thinner strips, or steam it.`);
    }
    // A member sprung from one solid piece instead of laminated (D-57): it needs the inside radius >= 100 x its thickness (strain t/2R under 0.5 percent).
    if (Number.isFinite(curve.minRadius)) {
      const need = SOLID_SPRING_RADIUS_FACTOR * p.sideThicknessIn;
      info(['hullLamThicknessIn', 'sideThicknessIn', 'hullCurveStartIn'],
        `Sprung from one solid piece the ${p.sideThicknessIn}" chine/gunwale would need an inside radius of at least ${SOLID_SPRING_RADIUS_FACTOR} x its thickness = ${need.toFixed(1)}"; this curve has ${(curve.minRadius - p.sideThicknessIn / 2).toFixed(1)}" (${curve.minRadius - p.sideThicknessIn / 2 >= need ? 'a test strip may show a solid spring works' : 'too tight, so the sides stay laminated'}). The 3/4" rail would need ${(SOLID_SPRING_RADIUS_FACTOR * p.railThicknessIn).toFixed(1)}".`);
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
  if (p.sideConstruction === SIDE_CONSTRUCTION.capturedPly && p.sideHeightIn - 2 * p.railBandIn < 1)
    err(['sideHeightIn', 'railBandIn'], 'The side panel would be shorter than 1". Raise the side or thin the chine and gunwale.');
  // Captured-ply grooves (D-35): the oak walls left each side of the groove must stay sturdy.
  if (p.sideConstruction === SIDE_CONSTRUCTION.capturedPly) {
    const wall = (p.sideThicknessIn - p.panelPlyIn - p.grooveSlopIn) / 2;
    if (wall < 0.1)
      warn(['sideThicknessIn', 'panelPlyIn', 'grooveSlopIn'], `A ${p.panelPlyIn}" panel in a ${p.sideThicknessIn}" chine/gunwale leaves ${Math.max(0, wall).toFixed(3)}" walls beside the groove (want ≥ 0.1"). Thicken the side stock or thin the panel.`);
  }
  // The rider's feet go through the nose to the foot stop.
  const footSpan = (2 * RIDER_LEG_Y_FRAC + RIDER_FOOT_Y_FRAC) * p.riderStatureIn;
  const footNeed = footSpan + 2 * p.bootAllowanceIn + 0.25;
  // The bow converges: the feet need the room over the whole foot box (heel to the foot stop), not at the transom.
  let noseInner = Infinity;
  {
    const curve = hullPlanCurve(p);
    const [fx0, fx1] = footZoneX(p);
    for (let x = fx0; x <= fx1 + 1e-9; x += 0.5) noseInner = Math.min(noseInner, 2 * offsetY(curve, -p.sideThicknessIn / 2, x));
    noseInner = Math.min(noseInner, 2 * offsetY(curve, -p.sideThicknessIn / 2, fx1));
  }
  if (noseInner < footNeed)
    err(['noseWidthIn', 'riderStatureIn', 'bootAllowanceIn'],
      `The hull is only ${noseInner.toFixed(1)}" wide inside at the rider's feet (x ${footZoneX(p)[0].toFixed(0)}-${footZoneX(p)[1].toFixed(0)}"); they need ≥ ${footNeed.toFixed(1)}" at this stature (feet ${footSpan.toFixed(1)}" + ${p.bootAllowanceIn}" boot allowance per side + ¼" play). Widen the bow.`);
  if (p.truckWellStartIn + p.truckWellLengthIn > p.truckBedLengthIn)
    err(['truckWellStartIn', 'truckWellLengthIn', 'truckBedLengthIn'], 'Wheel wells extend past the bed.');
  if (p.truckWellGapIn > p.truckBedWidthIn)
    err(['truckWellGapIn', 'truckBedWidthIn'], 'Wheel-well gap is wider than the bed.');
  if (p.axleStyle === AXLE_STYLE.stubAxles && p.axleBeamDepthIn < 2.5)
    warn(['axleStyle', 'axleBeamDepthIn'], 'Stub axles need a deeper beam (≥ 2½") to resist the cantilever moment.');

  // Vertical stack at the axles (D-15).
  const beamBottom =
    p.axleBeamPosition === AXLE_BEAM_POSITION.underslung
      ? r + p.axleDiameterIn / 2 - p.axleBeamDepthIn
      : r - p.axleDiameterIn / 2;
  if (beamBottom < p.minGroundClearanceIn)
    warn(['axleBeamDepthIn', 'axleBeamPosition', 'minGroundClearanceIn'],
      `Axle beam bottom at ${beamBottom.toFixed(2)}" is below the ${p.minGroundClearanceIn}" ground clearance.`);
  const beamTop = beamBottom + p.axleBeamDepthIn;
  const rearStackTop = beamTop + p.deckPlyIn;
  if (rearStackTop > p.deckHeightIn + 0.01)
    err(['deckHeightIn', 'axleBeamDepthIn'],
      `Rear axle beam + ply needs the deck at ≥ ${rearStackTop.toFixed(2)}"; it is ${p.deckHeightIn}".`);
  // The front-end linkage stack (beam, tongue plates, link and the link pin head) and the rear beam's hold-down angles must stay under the deck (Phase 3c-1: the rear
  // brake no longer fixes the lowest deck, so these two stacks do).
  {
    const deckBot = p.deckHeightIn - p.deckPlyIn;
    const fs = frontStackTop(p, r, p.deckHeightIn);
    if (fs.pinTop + 0.05 > deckBot + 1e-9)
      err(['deckHeightIn', 'crossmemberDepthIn', 'frontBeamDepthIn', 'deckPlyIn'],
        `The front steering stack (beam top ${fs.beamTop.toFixed(2)}", tongue link pin head ${fs.pinTop.toFixed(2)}") does not fit under the deck underside at ${deckBot.toFixed(2)}" (needs 1/16" to spare): raise the deck.`);
    if (p.axleBeamPosition === AXLE_BEAM_POSITION.underslung && deckBot - (r + p.axleDiameterIn / 2) < 0.9 - 1e-9)
      err(['deckHeightIn', 'axleBeamDepthIn', 'deckPlyIn'], `The rear beam hold-down angle (3/4" leg) does not fit between the beam top (${(r + p.axleDiameterIn / 2).toFixed(2)}") and the deck underside (${deckBot.toFixed(2)}"): raise the deck.`);
  }

  // Rear axle beam (critic r2 H2): wood left beside the rod groove must be real wood.
  const d = derived(p);
  if (d.rearBeamLigamentIn < p.beamLigamentMinIn - 1e-9)
    err(['axleBeamThicknessIn', 'beamLigamentMinIn'],
      `Rear axle beam is ${p.axleBeamThicknessIn}" wide: only ${d.rearBeamLigamentIn.toFixed(2)}" of wood is left each side of the rod groove; it needs ≥ ${p.beamLigamentMinIn}".`);
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

  // The brake beam (D-53, src/model/brake-layout.ts) slides in a notch in each cabin rail behind the rear tire: the notch must stay clear of the rear transom,
  // leave rail under the deck ledge, and the keeper under it must clear the ground.
  {
    const railZBot = p.deckHeightIn - p.deckPlyIn - p.railDepthIn;
    const bl = beamLayout(p, r, railZBot, -p.rearOverhangIn + p.transomThicknessIn);
    if (bl.railEndWall < 0.1 - 1e-9)
      err(['rearOverhangIn', 'wheelDiameterIn', 'brakeBeamSizeIn', 'brakeShoeTravelIn'],
        `The brake beam's rear face is only ${bl.railEndWall.toFixed(2)}" from the rear transom's inner face (needs ≥ 1/8"): the beam sits too far back behind the rear tire. Lengthen the rear overhang or use a smaller tube.`);
    const solidTop = p.deckHeightIn - p.deckPlyIn;
    if (solidTop - bl.notch.top < 1 - 1e-9)
      err(['railDepthIn', 'brakeBeamSizeIn', 'deckHeightIn', 'brakeKeeperThickIn'],
        `The brake beam notch in the rail reaches ${bl.notch.top.toFixed(2)}", leaving ${(solidTop - bl.notch.top).toFixed(2)}" of rail below the deck ledge (needs 1"): a taller rail, a smaller tube or a higher deck.`);
    const transomBottom = p.deckHeightIn - p.crossmemberDepthIn;
    const linkTop = linkTopZ(p, bl.zB);
    if (linkTop > transomBottom - 0.1 + 1e-9)
      err(['railDepthIn', 'crossmemberDepthIn', 'deckHeightIn', 'brakeBeamSizeIn'],
        `The brake link and clevis (top at ${linkTop.toFixed(2)}") pass under the rear transom, whose bottom edge is at ${transomBottom.toFixed(2)}" (needs 1/8" of air): use a deeper rail, shallower crossmembers or a smaller beam tube.`);
    if (bl.keeperBottom < p.minGroundClearanceIn - 1e-9)
      warn(['railDepthIn', 'deckHeightIn', 'minGroundClearanceIn', 'brakeKeeperThickIn'],
        `The brake beam keeper strap is at ${bl.keeperBottom.toFixed(2)}", below the ${p.minGroundClearanceIn}" ground clearance.`);
  }

  // Truck.
  if (d.overallWidthIn + 2 * p.truckClearanceIn > p.truckWellGapIn)
    warn(['rearTrackIn', 'frontTrackIn'],
      `Overall width ${d.overallWidthIn.toFixed(2)}" does not fit between the wheel wells with clearance (max track ${d.maxTrackBesideWells.toFixed(2)}"); only "straddle" stowage would work (D-6).`);
  if (d.bodyLengthIn > d.truckUsableLengthIn - p.truckClearanceIn)
    err(['wheelbaseIn', 'rearOverhangIn', 'frontOverhangIn'], 'Body is longer than bed + tailgate.');
  return issues;
}
