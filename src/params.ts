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
 *   assumed – engineering assumption (cited by `ref`, see DECISIONS.md)
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
/** D-73: the weather the sled is built for. Standard = garage-kept, a few uses a year; Extreme = stored outside or near salt. */
export const WEATHER_SPEC = { standard: 0, extreme: 1 } as const;
/** D-73, D-80: the thin-sheet material (the side webs, the storage box and lid, the signs). `followWeather` picks 6 mm Baltic birch for Standard and 6 mm okoume for Extreme. */
export const THIN_SHEET = { followWeather: 0, whiteOakPly: 1, okoumeMarine: 2, balticBirch3mm: 3, balticBirch6mm: 4 } as const;
/** D-78: how the step-brake knees are mounted. `fixed` = bolted and glued on for good (the default); `removable` = the same four bolts, fitted dry, taken off with a ratchet and wrench. */
export const KNEE_MOUNT = { fixed: 0, removable: 1 } as const;
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
    label: 'H-point to foot brace (horizontal)', group: 'loads', unit: 'in',
    default: 35.75, min: 24, max: 44, step: 0.25, status: 'assumed', ref: 'D-3, D-53, D-54, D-57, D-60',
    note: 'Knees bent a little more than a straight reach on a low seat; ≈ 0.48 × stature (68 in rider: 32.6 in; 35.5 in is a long, relaxed reach). D-57 restores it toward 36 in (it was 32 at D-54: the seat back no longer rides in the box, so the seat can move back; the cushion still has to lie in a box that must clear the leaning back). The foot brace is the rear face of the bow bulkhead, so seatXIn + this = the bulkhead face (validateParams); a shorter rider moves the seat forward (the foot block was dropped at D-60). D-60: 35.75 in (was 35.5): the bow bulkhead is 1/4 in thinner (1-1/2 in) so its rear face, the foot brace, is 1/4 in further forward with the tip where it was (seatXIn + this = the face).',
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
  // ── Cargo mode (Phase 3c-2, D-53): the seat stows in the box and the sled hauls gear, firewood and water ──
  cargoPayloadLb: {
    label: 'Cargo payload after the race', group: 'cargo', unit: 'lb',
    default: 200, min: 0, max: 600, step: 25, status: 'locked', primary: true, ref: 'D-53, D-58',
    note: 'Eric 2026-10-11: 200 lb (was 250 lb; the owner is weight-sensitive and the parts are sized to this). Camp gear, firewood and water (D-53): a uniform load over the bed, seat stowed, no rider. Carried at a high center of gravity (cargoCgHeightIn). The cargo case runs next to the rider cases and never changes the rider range.',
  },
  restLoadLb: {
    label: 'Resting adult (sitting or stepping in)', group: 'cargo', unit: 'lb',
    default: 250, min: 150, max: 400, step: 10, status: 'assumed', ref: 'D-58',
    note: 'Eric 2026-10-11: an adult of this weight (a) sitting still anywhere on the deck or seat and (b) standing on one foot (a 4 in x 10 in patch) anywhere on the deck must not hurt the sled, at STATIC load with the full material safety factors (the rest-load row). The storage lid is excluded: it is engraved DO NOT STEP and is not strengthened.',
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
    default: 10, min: 3, max: 24, step: 1, status: 'assumed', ref: 'D-53, D-66',
    note: 'D-66: the load-height RULE is now 10 in (was 12): keep the CENTER of the load under 10 in above the deck (a load about 20 in high, e.g. a cooler on a duffel, or gear below the 14 in rear sides). It tightens with the 30 in tracks (D-66) so the cargo tip row keeps its margin. Drives tipping, the rear-only brake hold and pitch.',
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
    note: 'D-1: scouts run 80–150 lb. Rows that get worse with a lighter rider (rearward pitch) are also evaluated here (critic Phase 2 r1, H3).',
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
    default: 30, min: 26, max: 52, step: 0.25, status: 'explore', primary: true, ref: 'D-6, D-58, D-66',
    note: 'D-66 (Eric): 30" (was 32"; D-58 had tightened it from 35.5"). The rear wheels do not steer, so the track is set only by the tire width plus clearance to the 24" body (tire inner face 13.25" from center vs the body side at 12": a 1-1/4" gap, 3/4" is the least, and the rod clamp plates start at 12.6") and by tipping (the cargo tip row, which the tighter cargoCgHeightIn load-height rule protects). The front track is the same (frontTrackIn) so the wheels line up.',
  },
  rearOverhangIn: {
    label: 'Body overhang behind rear axle', group: 'layout', unit: 'in',
    default: 10, min: 0, max: 18, step: 0.5, status: 'explore',
    note: 'Rear-handle sockets, the brake latch hook, and (by default) the storage box over the rear axle. The brake pedal bar sits a further 4 in or so behind it (D-55).',
  },
  frontOverhangIn: {
    label: 'Body overhang ahead of the front axle (to the bow tip)', group: 'layout', unit: 'in',
    default: 6.75, min: 4, max: 20, step: 0.25, status: 'explore', ref: 'D-54, D-57',
    note: 'D-57: 6.75 in (was 12, when the bow curl needed 7 in of run). The flat deck ends one bulkhead thickness (bowBulkheadThickIn) behind the bow tip, and the rider foot brace is the rear face of the bow bulkhead there, so this must reach past the front axle by the bulkhead and the front joist. Wheelbase is rear axle to the pivot.',
  },
  deckHeightIn: {
    label: 'Deck (floor top) height, between axles', group: 'layout', unit: 'in',
    default: 8, min: 6, max: 18, step: 0.25, status: 'explore', primary: true, ref: 'D-15, D-56',
    note: 'D-56: 8 in, set by the front pivot stack (axle beam top 5.4 in + the 9/16 in UHMW thrust disc + a king beam about 1.6 in deep, validateParams; the oak tongue no longer lies under it, D-58) with the 10 in wheels beside the body. The rear beam stack (beam top + ply) and the foot brake allow a little lower.',
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
    note: 'Sled side profile (D-57): low at the bow, rising in a straight line to the rear (sideHeightRearIn). Where the sides end against the bow curl.',
  },
  sideHeightRearIn: {
    label: 'Side height at the rear (above the deck)', group: 'body', unit: 'in',
    default: 14, min: 8, max: 24, step: 0.5, status: 'explore', primary: true, ref: 'D-54, D-57',
    note: 'D-57: 14 in (was 16). The rear transom follows this height, the flag tube and the handle sockets stand in the tall rear section, and the sheer curve (sheerCurveIn) sweeps down from it to the bow.',
  },
  sheerCurveIn: {
    label: 'Sheer curve (sag of the side top below the straight line)', group: 'body', unit: 'in',
    default: 2.5, min: 0, max: 4, step: 0.25, status: 'explore', primary: true, ref: 'D-57',
    note: 'The top edge of the side sweeps up from the low bow to the tall rear in a smooth concave curve, as on Wagner\'s sled (D-57). The gunwale dips this far below the straight line from the rear to the bow at mid-length (a parabola); 2.5 in with the 10 in of rise leaves the top edge level at the bow. 0 = the straight D-54 line. The gunwale is bandsawn from a wide oak board to the curve; the web top follows it.',
  },
  bowWidthIn: {
    label: 'Bow outside width (at the bulkhead)', group: 'body', unit: 'in',
    default: 18.5, min: 15, max: 24, step: 0.25, status: 'explore', primary: true, ref: 'D-66',
    note: 'D-66 (Eric): the sides draw in, in plan, from the full bodyWidthIn at bowTaperStartIn to this width at the bow bulkhead, in one long gradual S (a smootherstep: straight AND curvature-continuous at both ends). The taper is DERIVED from the swing of the front wheels (bowTaper in params.ts): it ends as far forward as the wheel sweep at full lock allows while keeping steerClearIn + bowTaperSlackIn from the tire to the body, and runs parallel to the bulkhead after that. This also sets the turn-in per side, (bodyWidthIn - bowWidthIn) / 2. The chine, web, gunwale, deck and the front rails follow the curve; chine and gunwale are cold-bent flat (2 plies) on a form, the web is a single bent sheet. The rider needs 12 to 14 in INSIDE at the feet (validateParams).',
  },
  bowTaperStartIn: {
    label: 'Bow taper start (x, from the rear axle)', group: 'body', unit: 'in',
    default: 20, min: 10, max: 40, step: 1, status: 'explore', ref: 'D-66',
    note: 'D-66: the sides are straight (full width) behind this x and start to draw in here, about mid-cabin. Earlier = a longer, gentler taper (but it must stay ahead of the seat cushion); later = a tighter bend, which the cold-bend rule limits (hullLamMinRadiusFactor).',
  },
  bowTaperSlackIn: {
    label: 'Taper slack over the steering clearance', group: 'body', unit: 'in',
    default: 0.125, min: 0, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-66',
    note: 'The taper is derived so the tire clears the body by steerClearIn PLUS this much through the whole +-lock sweep (the steer-clear row then reads 1/8 in better than its limit, not exactly at it).',
  },
  bowBulkheadThickIn: {
    label: 'Bow bulkhead thickness', group: 'body', unit: 'in',
    default: 1.5, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-57, D-60',
    note: 'The shaped oak bulkhead at the bow replaces the D-54 bow curl and the separate foot-stop bar: it is the rider\'s foot brace and the structural front of the hull. One piece of 8/4 oak planed to its thickness (two thinner boards glued face to face are the alternative), so there is no cross-grain break at the hand-hold. D-60: 1-1/2 in (was 1-3/4 in): the foot-stop row was at 0.10, it goes to about 0.14.',
  },
  showSideSigns: {
    label: 'Show the side signs', group: 'body', unit: '',
    default: 1, min: 0, max: 1, step: 1, status: 'assumed', ref: 'D-54, D-57',
    options: [{ value: 0, label: 'Off' }, { value: 1, label: 'On (tall rear part of each side)' }],
    note: 'D-57: the Troop 455 sign is back, on the outside of the tall rear part of each side (signTexture, oval plank). Nothing structural is sized to it.',
  },
  hullLamMinRadiusFactor: {
    label: 'Min. bend radius / band thickness', group: 'body', unit: '×',
    default: 40, min: 20, max: 100, step: 5, status: 'assumed', ref: 'D-45, D-57',
    note: 'Cold-bent strips lay up without steaming above this ratio of bend radius to strip thickness; the validator flags a bow turn-in whose plan radius is tighter than this times one oak band of the sandwich side (D-62).',
  },
  deckSlopIn: {
    label: 'Deck rabbet / dado clearance over the ply', group: 'body', unit: 'in',
    default: 0.04, min: 0, max: 0.08, step: 0.004, status: 'assumed', ref: 'D-45',
    note: 'The deck rabbet in the chine and the dado in each transom are cut this much taller than the (epoxy-sealed) deck so the sealed panel enters its own rabbet; thickened epoxy fills the gap (build review MUST-2).',
  },
  deckSideClearIn: {
    label: 'Deck side clearance to each web', group: 'body', unit: 'in',
    default: 0.0625, min: 0, max: 0.125, step: 0.0156, status: 'assumed', ref: 'D-63',
    note: 'D-63 (build r2 R2-M3): the deck is cut this much narrower on EACH side than the gap between the two webs, so a rigid sheet can drop between two bent webs that are never within 0.03 in of nominal over 59 in. It still tucks (the inner band thickness minus this) under each inner chine band; thickened epoxy fills the slot between the deck edge and the web. 1/16 in (23.09 in deck) at the default.',
  },

  railBandIn: {
    label: 'Chine / gunwale height', group: 'body', unit: 'in',
    default: 1.5, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-22',
    note: 'Oak chine and gunwale band height (D-62: the bands are glued on both faces of the full-height 4 mm web, no grooves; the inner chine band is shorter by the deck gap, which makes the deck rabbet). The free web between the bands is the side height less twice this.',
  },
  // ── Hull detail: captured ply, joinery, lift handles, finger guard, signs (Phase 3 workstream B, D-35…D-37) ──
  signBackerThickIn: {
    label: 'Sign backing strip thickness (oak, inside the side web)', group: 'body', unit: 'in',
    default: 0.5, min: 0.375, max: 0.75, step: 0.0625, status: 'assumed', ref: 'D-62, build 3c M4',
    note: 'D-62: nothing is screwed into the 4 mm web (a tee-nut in 0.157 in ply has 0.1 in of bite, and a 1 in screw poked into the cabin). Each side sign hangs on two vertical oak backing strips glued on the INSIDE of the web between the chine and gunwale bands, each with two #10-32 threaded inserts (3/8 long) for the knobs. The strips stand this far inboard of the web (0.27 in proud of the inner band faces), at the sign knob stations behind the box. D-63: the knob screw length is derived from this thickness and the 0.234 in sign standoff (7/8 in at the default: sign + standoff disc + web = 0.55 in, 0.33 in into the insert, 1/8 in of wood left behind its tip).',
  },
  sideKickLbf: {
    label: 'Side web lean / kick load', group: 'loads', unit: 'lbf',
    default: 50, min: 20, max: 150, step: 5, status: 'assumed', ref: 'D-62, eng 3c N-1',
    note: 'D-62: a scout leaning on the side or kicking it: this lateral load on a square patch (sideKickPatchIn) of the 4 mm web, at mid height of the free panel between the oak bands, where the panel is tallest. D-60 took the web from 6 to 4 mm, which cut its out-of-plane stiffness 3.4 times; the side-web row now checks it. A person SITTING on the gunwale is not covered: the gunwale is not a seat.',
  },
  sideKickPatchIn: {
    label: 'Side web kick: patch size', group: 'loads', unit: 'in',
    default: 6, min: 2, max: 12, step: 1, status: 'assumed', ref: 'D-62',
    note: 'A boot or a knee: a 6 in square patch. The panel carries it as a strip fixed at the two oak bands, over the patch width plus half the strip height each side.',
  },
  cargoSideG: {
    label: 'Cargo leaning on the side: lateral g', group: 'loads', unit: 'g',
    default: 0.5, min: 0.2, max: 1, step: 0.05, status: 'assumed', ref: 'D-62',
    note: 'The cargo pushes the side with this multiple of its weight (a hard side bump or the sled dragged sideways; the tire friction coefficient is 0.5), spread over cargoSideContactIn of the side and the free web height.',
  },
  cargoSideContactIn: {
    label: 'Cargo leaning on the side: contact length', group: 'loads', unit: 'in',
    default: 36, min: 12, max: 60, step: 2, status: 'assumed', ref: 'D-62',
    note: 'Length of the side the cargo lies against (the bed is about 40 in between the seat back and the bulkhead).',
  },
  sideWebCapIn: {
    label: 'Side web stops short of the gunwale top', group: 'body', unit: 'in',
    default: 0.125, min: 0, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-61, D-62',
    note: 'D-61 sandwich sides: the 4 mm web runs the full height of the side between an oak band on each face at the chine and at the gunwale (no grooves). It stops this far under the top of the gunwale bands, and the gap is filled flush with thickened epoxy (or a 1/8 in oak cap strip), so no ply edge shows on the rail.',
  },
  grooveSlopIn: {
    label: 'Dado / groove width over the ply thickness', group: 'body', unit: 'in',
    default: 0.04, min: 0, max: 0.06, step: 0.004, status: 'assumed', ref: 'D-35, D-43',
    note: 'Cut the groove at the MEASURED ply thickness + about 1 mm (D-43): real 6 mm okoume runs 5.5–5.9 mm and two epoxy coats on faces and edges add 0.3–0.5 mm, plus ~0.3 mm of glue film. At 0.04" the groove is 0.276" (7 mm cutter) in 6 mm ply. The walls each side of the groove are (side stock − groove) / 2 and need to stay ≥ 0.1".',
  },
  transomThicknessIn: {
    label: 'Transom thickness (front and rear)', group: 'stock', unit: 'in',
    default: 0.5, min: 0.5, max: 1.25, step: 0.0625, status: 'assumed', ref: 'D-35, D-43, D-60',
    note: '¾" gives the transom a real hand-hold bar, lets a DF 500 Domino keep a 0.15" wall, and takes the handle sockets, and quadrant bracket bolts. The chine and gunwale thickness is "Chine / gunwale stock thickness". D-60: 1/2 in (was 3/4 in; 5/8 in is the "free" step, 1/2 in a trade-off). The Domino wall and the socket bolt edge distances are thinner; the lift row goes to 0.67 (0.54 at 3/4 in).',
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
    note: 'Local oak blocking glued behind the gunwale and the rear transom where grip pads screw in, so every wood screw has at least ¾" of engagement. (The D-ring plates are through-bolted to the side ribs, D-76.)',
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
  bowHoldMinClearIn: {
    label: 'Min. hand room under the bow hand-hold (above the deck)', group: 'body', unit: 'in',
    default: 2.5, min: 1.5, max: 5, step: 0.25, status: 'assumed', ref: 'D-69',
    note: 'Hand room under the bow hand-hold; the bow has no box behind it. The hold hangs under the bulkhead crown with liftBarMinIn of oak above (D-69), so its clearance above the deck is sideHeightBowIn + handleBowCrownIn - liftBarMinIn - liftSlotHeightIn (2.875 in at the defaults); the validator errors below this.',
  },
  signLengthIn: {
    label: 'Side sign blank length', group: 'body', unit: 'in',
    default: 15, min: 8, max: 30, step: 1, status: 'assumed', ref: 'D-9, D-57',
    note: 'Shortened automatically to fit the tall rear part of the side (the sheer falls away toward the bow) and to stay behind the rear wheel brake mount.',
  },
  signEndMinXIn: {
    label: 'Side sign: least forward end (inches ahead of the rear axle)', group: 'body', unit: 'in',
    default: 5.5, min: 0, max: 6, step: 0.1, status: 'assumed', ref: 'D-85',
    note: 'D-85: the sign reaches at least this far forward, so the box rib\'s fender washers (on the outside of the gunwale band, up to 1 in ahead of the rib) stay clear under the level sign\'s top edge. The sheer falls toward the bow, so a sign that ends farther forward sits lower. The sign\'s area barely changes (it is boxed in by the brake flap below and the sheer above).',
  },
  signHeightIn: {
    label: 'Side sign blank height', group: 'body', unit: 'in',
    default: 6, min: 3, max: 10, step: 0.5, status: 'assumed', ref: 'D-9, D-57',
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
    default: 8.5, min: 6, max: 24, step: 0.5, status: 'explore', ref: 'D-17, D-43, D-58',
    note: 'D-58 / 3c-5: 8.5 in (was 10), one more joist (8 instead of 7, about +0.84 lb) so a standing adult\'s foot between two joists bends the 12 mm ply less (the resting-weight row).',
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
    default: 2000, min: 800, max: 4000, step: 50, status: 'assumed', ref: 'D-19, D-53, D-54, D-57',
    note: 'D-57: shrunk back to 2,000 (was 2,500 at D-54, 2,200 at D-53) because the seat back no longer rides in the box. It holds the 10 Essentials in race mode (about 1,700 in³ with the packing allowance, storage-pack) OR the two cushions in cargo mode (about 700 in³, seat-stow); both together would need about 2,400 in³.',
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
    label: 'Storage box clearance to the side (each side)', group: 'body', unit: 'in',
    default: 1.5, min: 0.0625, max: 2.5, step: 0.0625, status: 'assumed', ref: 'D-47, D-57',
    note: 'D-57: 1.5 in a side, so the 1.3 in flag tube (flagTubeOdIn) stands beside the box in either rear corner. The box drops in from above and is bonded to the deck, so it needs a gap to the chine inner face anyway (r3 build S3); the gap is filled with thickened epoxy except at the flag tube. The box is narrower by twice this, and the height rises to hold the volume.',
  },
  storageLidRimWidthIn: {
    label: 'Storage lid oak rim width', group: 'body', unit: 'in',
    default: 0.75, min: 0.5, max: 2, step: 0.25, status: 'assumed', ref: 'D-19, D-60',
    note: 'Oak perimeter strip under the ply lid; the box walls end on it. D-60: 3/4 in (was 1 in).',
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
  storageLidStripIn: {
    label: 'Storage box fixed strip across the front of the box top (fore-aft)', group: 'body', unit: 'in',
    default: 3, min: 1.5, max: 5, step: 0.25, status: 'assumed', ref: 'D-89',
    note: 'D-89: a fixed oak strip across the fore end of the box top carries the lid hinges on its aft edge, so the lid is shorter and opens past upright to rest on the upright seat back (the build check holds it at 95 to 100 degrees). Wider opens the lid further but leaves less of a lid.',
  },
  storageDrainDiaIn: {
    label: 'Storage box drain hole diameter', group: 'body', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-41',
    note: 'Two drains at the aft corners through the floor and deck; stainless nipples keep the cut ply edges sealed.',
  },
  flagTubeIdIn: {
    label: 'Flag tube inside diameter', group: 'body', unit: 'in',
    default: 1.05, min: 0.75, max: 1.5, step: 0.05, status: 'assumed', ref: 'D-57',
    note: 'A plain purchased tube (1 in PVC or aluminum) inside a rear corner for the flag staff (D-57; replaces the printed bow socket).',
  },
  flagTubeOdIn: {
    label: 'Flag tube outside diameter', group: 'body', unit: 'in',
    default: 1.315, min: 1, max: 2, step: 0.005, status: 'assumed', ref: 'D-57',
    note: '1 in schedule 40 PVC is 1.315 in OD (0.133 in wall).',
  },
  lashPointsPerSide: {
    label: 'Lash points (D-rings) per side', group: 'body', unit: '',
    default: 4, min: 2, max: 4, step: 1, status: 'assumed', ref: 'D-41, D-76',
    note: 'D-76, D-83: the D-rings are through-bolted (two 1/4-20 bolts each) to the heads of the side ribs, one per rib (4 per side with the rear rib, D-85: the rear rib, the box rib, the mid rib and the bow post). 3 leaves the rear rib without one and 2 leaves the bow post without one too (the ribs stay: they stiffen the side). D-76 asks for at least 6 in all. The old screwed lash doublers are gone.',
  },
  lashLoadLbf: {
    label: 'Lash point design load (strap pull)', group: 'body', unit: 'lbf',
    default: 233, min: 100, max: 600, step: 25, status: 'assumed', ref: 'D-41, D-76, D-83',
    note: 'D-83: the bolt-on cargo D-ring (Harbor Freight 1/4 in D-ring, #60319) is rated 233 lbf working load. The lash-load check pulls each ring with this at the angle below (through-bolts, head bearing, rib bending, D-76), and the side-lateral row pulls the side in with it at the worst rib. The cargo straps pull 79 lbf a ring.',
  },
  lashPullAngleDeg: {
    label: 'Lash strap pull angle above the deck', group: 'body', unit: '°',
    default: 45, min: 15, max: 75, step: 5, status: 'assumed', ref: 'D-41, D-76',
    note: 'The strap runs up and inboard over the load: 45° splits the pull evenly into a vertical part (shear in the D-ring bolts) and an inboard part (bolt tension, and the side pulled in).',
  },
  // ── Side ribs (D-76, docs/studies/side-stiffness-study.md option E): three oak ribs per side on the inside face of the web, whose heads carry the D-rings ──
  sideRibWidthIn: {
    label: 'Side rib width (fore-aft)', group: 'body', unit: 'in',
    default: 0.75, min: 0.5, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-76',
    note: 'D-76: the rib shaft, the knee and the box-tie spacer are this thick fore-aft (3/4 in oak, bandsawn from 4/4 offcuts). The rib is glued to the inside face of the web between the inner chine and gunwale bands and notched over both bands.',
  },
  sideRibDepthIn: {
    label: 'Side rib depth (proud of the inner bands)', group: 'body', unit: 'in',
    default: 0.75, min: 0.5, max: 1.25, step: 0.0625, status: 'assumed', ref: 'D-76',
    note: 'D-76: how far the rib (shaft and head) stands inboard of the inner band faces; between the bands it also fills the band thickness down to the web, so its section there is this plus the band thickness deep. 1 in would take the E2 rib from 0.87 to 0.58 at the D-ring rating for +0.06 lb (study).',
  },
  sideRibHeadLengthIn: {
    label: 'Side rib head length (along the gunwale)', group: 'body', unit: 'in',
    default: 2, min: 1.75, max: 3, step: 0.125, status: 'assumed', ref: 'D-76',
    note: 'D-76: the rib widens to a head this long at the gunwale, as tall as the gunwale band (railBandIn) and cut to the sheer at the top. The 1.75 x 0.75 in D-ring bracket (D-83) sits on its inner face, through-bolted with two 1/4-20 button-head bolts.',
  },
  sideRibKneeHeightIn: {
    label: 'Side rib knee height (up the rib)', group: 'body', unit: 'in',
    default: 2.5, min: 1.5, max: 3, step: 0.125, status: 'assumed', ref: 'D-76',
    note: 'D-76: the triangular oak knee at the foot of the mid rib and the bow post, glued to the rib\'s inner face and to the deck and screwed down through the deck into the joist (or the king beam) under it. The rib section above the knee is what the rib-bending checks read.',
  },
  sideRibKneeLengthIn: {
    label: 'Side rib knee length (along the deck, inboard)', group: 'body', unit: 'in',
    default: 2, min: 1.5, max: 3, step: 0.125, status: 'assumed', ref: 'D-76',
    note: 'D-76: the knee\'s foot runs this far inboard from the rib face. The two screws into the joist sit along it; their withdrawal is checked in the side-lateral row (the toe lifts under an outward push).',
  },
  sideRibBoxInsetIn: {
    label: 'Box rib station (behind the storage box fore end)', group: 'body', unit: 'in',
    default: 4, min: 0.75, max: 6.5, step: 0.05, status: 'assumed', ref: 'D-76, D-85',
    note: 'D-76, D-85: the box rib (E1) stands this far behind the outer face of the storage box\'s fore end, beside the box (study option D), and an oak spacer ties it to the box side, so the box is its base. D-85: 4 in (x = 3.0; it was 1.4 in, x = 5.6) puts it under the front pair of the sign\'s knobs, so the sign screws into this rib and the sign backing strips are gone. Farther back is softer between it and the mid rib (the 50 lbf push is 0.100 in at 1.4 in and 0.124 at 4 in; the limit is 0.125), and nearer the sign\'s forward end its outside bolt washers (1-1/8 in under the sheer at the lowest) would foul the sign\'s top edge (see signEndMinXIn).',
  },
  sideRibRearInsetIn: {
    label: 'Rear rib station (ahead of the storage box aft end)', group: 'body', unit: 'in',
    default: 3.25, min: 2.5, max: 6, step: 0.05, status: 'assumed', ref: 'D-85',
    note: 'D-85: the rear rib (E0) stands this far ahead of the box\'s aft end (x = -5.5), beside the box and the flag tube, with the same oak spacer to the box side. Its head clears the flag tube\'s blocks (they end at x = -6.7). Its ring is at the gunwale like the others, so a strap from it to the opposite side or to a box rib ring crosses the closed lid. It holds the sign\'s two rear knobs.',
  },
  sideRibMidXIn: {
    label: 'Mid rib station (inches ahead of the rear axle; snaps to the nearest crossmember)', group: 'body', unit: 'in',
    default: 27.6, min: 10, max: 44, step: 0.1, status: 'assumed', ref: 'D-76',
    note: 'D-76: the mid rib (E2) and its knee stand on the joist nearest this x (joist 5 at the defaults, x = 27.6), ahead of the seat cushion: a knee on joist 4 (x = 20.2) would hit the cushion.',
  },
  sideRibFrontXIn: {
    label: 'Bow-post rib station (inches ahead of the rear axle; snaps to the nearest crossmember or the king beam)', group: 'body', unit: 'in',
    default: 44, min: 30, max: 48, step: 0.1, status: 'verify', ref: 'D-76',
    note: 'D-76: the bow post (E3) and its knee stand on the member nearest this x: the king beam at 44 (the default). Its inner face is about 7-7/8 in from the center line, about 1 in outside a winter boot. VERIFY: sit a booted rider in the sled before cutting; if the post is in the way, set this to 35 (the chain joist, x = 35.1, where the post face is about 8-3/8 in from the center line).',
  },
  boxTieWidthIn: {
    label: 'Box-tie spacer width (fore-aft)', group: 'body', unit: 'in',
    default: 0.75, min: 0.75, max: 2, step: 0.125, status: 'assumed', ref: 'D-76',
    note: 'D-76 (study option D): the oak spacer between the box rib and the storage box side, epoxied to both; it fills the gap and is this wide fore-aft. 3/4 in, flush with the rib (the study drew 1 in; the glue on the rib face is only the rib\'s width either way, and 3/4 in is 0.03 lb lighter for the pair).',
  },
  boxTieHeightIn: {
    label: 'Box-tie spacer height', group: 'body', unit: 'in',
    default: 3, min: 1.5, max: 4, step: 0.25, status: 'assumed', ref: 'D-76',
    note: 'D-76: the spacer is this tall and its top stands 1/8 in under the box coaming: it is glued to the box side below the coaming, never to the lid frame, which moves.',
  },

  // ── Seat & rider position ────────────────────────────────────────────────
  seatXIn: {
    label: 'Seat H-point ahead of rear axle', group: 'seat', unit: 'in',
    default: 13.5, min: 1.5, max: 17.5, step: 0.5, status: 'explore', primary: true, ref: 'D-53, D-54, D-57',
    note: 'Forward → more front load, better lock stability; aft → more rear-brake traction. D-57: 13.5 in (was 16): the box behind the seat now only holds the cushions (it must be about 14.5 in long inside, and its end leans back with the seat back) and the back flips onto the deck, so the seat moves back 2.5 in and the rider gets 35.5 in of leg reach (was 32).',
  },
  seatDepthIn: {
    label: 'Seat cushion depth (fore-aft)', group: 'seat', unit: 'in',
    default: 14.5, min: 10, max: 22, step: 0.5, status: 'assumed', ref: 'D-18, D-57',
    note: '14.5 in (was 16) so the cushion lies flat in the box for cargo (seat-stow) with the seat 2 in farther back.',
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
    label: 'Seat-back thickness (the frameless 12 mm panel)', group: 'seat', unit: 'in',
    default: 0.472, min: 0.236, max: 1.25, step: 0.001, status: 'assumed', ref: 'D-18, D-62',
    note: 'D-62 (Eric 2026-10-12): the seat back is a frameless 1/2 in (12 mm) okoume panel, so this is the panel thickness (it was a 3/4 in oak frame): keep it equal to seatBackPlyIn. The rear-bottom corner and the stop-block geometry follow it.',
  },
  seatBackFrameWidthIn: {
    label: 'Seat-back hinge / pin / stop-block station width', group: 'seat', unit: 'in',
    default: 1.25, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-18, D-60, D-62',
    note: 'D-62: there is no frame any more; this is the width of each oak stop block behind the panel and of the hinge / latch-pin station (the stations sit this half-width in from each side of the panel). D-60: 1-1/4 in (was 1-1/2 in).',
  },
  footStopHeightIn: {
    label: 'Foot-brace band height above the deck', group: 'seat', unit: 'in',
    default: 4, min: 2, max: 8, step: 0.5, status: 'assumed', ref: 'D-3, D-57',
    note: 'The band of the bow bulkhead the heels and toes press (D-57; the foot-stop row takes the plank section of this height). The drop-in foot block and its slot cleats were dropped at D-60; a block can be added after test rides if small riders want one.',
  },
  seatCushionIn: {
    label: 'Seat cushion thickness', group: 'seat', unit: 'in',
    default: 1.5, min: 1, max: 5, step: 0.25, status: 'assumed', ref: 'D-18, D-83',
    note: 'D-83: 1-1/2 in, the thickness of the Harbor Freight EVA kneeling pad (#56572, 11 x 18 x 1-1/2 in). The cushion is one whole pad plus a strip of a second, edge-glued with contact cement; the seat back pad is a third pad (1-1/2 in, BACK_PAD_THICK_IN), trimmed to size. No cover.',
  },
  evaFoamDensityPcf: {
    label: 'EVA kneeling-pad foam density', group: 'seat', unit: 'lb/ft³',
    default: 5.8, min: 3, max: 9, step: 0.1, status: 'assumed', ref: 'D-83',
    note: 'D-83: the Harbor Freight EVA kneeling pad is about 1 lb for 11 x 18 x 1-1/2 in (297 in³): 1 lb / 297 in³ = 5.8 lb/ft³. WEIGH A PAD to confirm.',
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
  seatBackLatchHeightIn: {
    label: 'Seat-back latch pin height above the stile foot', group: 'seat', unit: 'in',
    default: 2, min: 1.5, max: 6, step: 0.25, status: 'assumed', ref: 'D-57, D-63',
    note: 'D-57, D-63 (Eric 2026-10-12: 2 in up the panel): one 3/8 in spring-detent quick-release pin per side, pushed in by hand with no tools. UPRIGHT: through the panel into a BLIND hole in the fixed oak stop block behind it, whose depth is set from the block outline at this height (the block is thinner the higher the pin goes: at 3 in it is 1.27 in along the pin, at 2 in 1.53 in, and the box end is only 4 mm ply behind it). FLAT (flipped forward onto the deck): through the same panel hole and the deck into a blind hole in the oak hinge backer. The farther below the stop-block crest, the lower the pin load. The seat-back row checks that at least 1/4 in of oak is left behind each hole.',
  },
  seatBackLoadFraction: {
    label: 'Share of rider weight that loads the seat back', group: 'seat', unit: '×',
    default: 0.5, min: 0.25, max: 1, step: 0.05, status: 'assumed', ref: 'D-40',
    note: 'Torso share (≈ 50%); the legs brace on the foot stop and the pelvis on the cushion. Multiplied by the dynamic factor (a hard pull on the bridle throws the rider back).',
  },
  seatHingeLoadLbf: {
    label: 'Seat-back hinge allowable per hinge (screws in oak)', group: 'seat', unit: 'lbf',
    default: 250, min: 100, max: 600, step: 25, status: 'verify', ref: 'D-57',
    note: 'A 2 in 316 butt hinge on #8 screws in white oak: the back-load check keeps the pull on each hinge under this (vendor and NDS data to confirm).',
  },
  seatInsertPulloutLbf: {
    label: 'Seat-back hinge insert pull-out allowable (each)', group: 'seat', unit: 'lbf',
    default: 150, min: 50, max: 400, step: 10, status: 'verify', ref: 'D-62',
    note: 'D-62: a #10-32 x 3/8 stainless hex-drive threaded insert, epoxied into a blind hole in the 12 mm okoume seat-back panel. Published axial pull-out for a #10 insert in plywood is a few hundred pounds; 150 lbf is a cautious working value (confirm with a pull test on a scrap: hang a bucket from a screwed-in insert).',
  },
  seatPinPullLbf: {
    label: 'Seat-back latch pin pull (each pin)', group: 'seat', unit: 'lbf',
    default: 100, min: 25, max: 300, step: 5, status: 'assumed', ref: 'D-62',
    note: 'D-62: the pull on one quick-release pin that holds the upright back against flipping forward (a scout hauling himself up by it, a bump): 100 lbf. It bears on the pin hole in the 12 mm panel and tears out toward the panel edge (a 13/32 in hole centered a half station width from the edge).',
  },
  grabBoardLengthIn: {
    label: 'Grab board length (along the side)', group: 'seat', unit: 'in',
    default: 8, min: 6, max: 14, step: 0.5, status: 'assumed', ref: 'D-40, D-57',
    note: 'D-57: one oak board per side, bolted to the side top and standing above it, with a routed hand hole (replaces the pad, two posts and bar).',
  },
  grabHoleLengthIn: {
    label: 'Grab hole length', group: 'seat', unit: 'in',
    default: 4.5, min: 3.5, max: 6, step: 0.25, status: 'assumed', ref: 'D-40, D-57',
    note: 'A gloved hand: at least 3.5 in (D-40).',
  },
  grabHoleHeightIn: {
    label: 'Grab hole height (finger gap)', group: 'seat', unit: 'in',
    default: 1.5, min: 1.25, max: 2.5, step: 0.25, status: 'assumed', ref: 'D-40, D-57',
    note: 'At least 1.25 in (a gloved finger): no pinch point.',
  },
  grabBoardThickIn: {
    label: 'Grab board thickness', group: 'seat', unit: 'in',
    default: 0.625, min: 0.5, max: 1.25, step: 0.125, status: 'assumed', ref: 'D-57, D-60',
    note: 'D-60: 5/8 in (was 3/4 in).',
  },
  grabBoardBarIn: {
    label: 'Grab board oak above the hole', group: 'seat', unit: 'in',
    default: 1.25, min: 0.75, max: 2, step: 0.25, status: 'assumed', ref: 'D-57',
    note: 'The bar of oak the fingers wrap; the row checks its bending.',
  },
  grabBoardFootIn: {
    label: 'Grab board oak between the gunwale top and the hole', group: 'seat', unit: 'in',
    default: 0.75, min: 0.5, max: 2.5, step: 0.25, status: 'assumed', ref: 'D-57, D-84',
    note: 'The board laps the inboard face of the gunwale (that part is bolted) and stands this far above the gunwale top before the hole starts. D-84: 3/4 in (was 1-1/4 in) so the hole follows the lower sheer toward the palm height of a seated rider.',
  },
  grabHoleAheadOfHpointIn: {
    label: 'Grab hole center ahead of the seat H-point', group: 'seat', unit: 'in',
    default: 5.5, min: 0, max: 12, step: 0.5, status: 'assumed', ref: 'D-84',
    note: 'D-84: a seated rider\'s elbow hangs about 5 in behind the H-point; with the forearm about level the palm lands 11 to 12 in ahead of it, about 6 in ahead of the H-point. The hole center is 5-1/2 in ahead of the H-point (it was 1 in behind, at the elbow) and the 4-1/2 in hole spans the palm. Farther forward the sides start to turn in toward the bow (x = 20 in) and a flat board would stand off the band by more than 1/16 in at its front end (the validator warns). Body numbers are estimates for a 68 in rider: try a real scout in a mock-up (Verify list).',
  },
  gripBoltStiffnessLbIn: {
    label: 'Grab board screw stiffness (screw, washer and head bearing in series)', group: 'seat', unit: 'lb/in',
    default: 120000, min: 30000, max: 600000, step: 10000, status: 'assumed', ref: 'D-84',
    note: 'D-84: a 1/4-20 screw over a 1-1/2 in grip is about 590,000 lb/in alone; the oak under the head strip and under the nut washer is softer, and in series they come to about 120,000 lb/in. It sets how the pull is shared between the screws and the board\'s lower edge in the elastic estimate of the grab-board row (the row also takes the rigid-lever loads and keeps the larger).',
  },
  gripBearingFoundationPsiIn: {
    label: 'Band bearing stiffness under the board (oak across the grain, per inch of depth)', group: 'seat', unit: 'psi/in',
    default: 400000, min: 100000, max: 1000000, step: 50000, status: 'assumed', ref: 'D-84',
    note: 'D-84: oak across the grain is about 200,000 psi, over about 1/2 in of band and web it gives about 400,000 psi per inch of squash. Used in the elastic estimate of the grab-board row.',
  },
  grabBoardCornerIn: {
    label: 'Grab board top corner radius', group: 'seat', unit: 'in',
    default: 1, min: 0.25, max: 1.25, step: 0.25, status: 'assumed', ref: 'D-84',
    note: 'D-84: 1 in (was 3/4 in): the two top corners are rounded well off so they are not sharp on a hand or a knee. The board ends are vertical (to match the ribs and the transom), so the corners are 98 and 82 degrees.',
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
    note: 'Flat-free (foam-filled) tires change the BUMP RATE, not just the mass: a PU foam hand-truck tire is several times stiffer than a 30 psi pneumatic one, and at 2,000 lb/in half the structure rows fail (eng 3c review, section 1b). Selecting it only adds flatFreeExtraLb; the bump rate (bumpWheelRateLbIn) stays at 500 until you set it from a measurement, and validateParams warns. The tire squash test (bumpWheelRateLbIn: squash of 0.55 in or more at 300 lb, i.e. at most about 560 lb/in) is a PRE-ORDER GATE for whichever tire you buy.',
  },
  tireWidthIn: {
    label: 'Tire section width', group: 'wheels', unit: 'in',
    default: 3.5, min: 2.5, max: 5, step: 0.25, status: 'assumed', ref: 'D-11',
  },
  hubLengthIn: {
    label: 'Wheel hub length', group: 'wheels', unit: 'in',
    default: 2.25, min: 1.5, max: 4, step: 0.02, status: 'verify', ref: 'D-11, D-60, D-71',
    note: 'D-71: 2.25 in, MEASURE THE HARBOR FREIGHT HUB (its listing gives no hub length). The Uline H-5454 (the same class, 5/8 in bore) lists a 2-1/4 in offset hub and so does the Martin wheel at Tractor Supply (2-1/4 x 5/8). D-60: it was 2.28 in, then a 3 in placeholder. The hub length sets the stub cantilever and the beam end distances. A shorter hub moves the wheel in toward the beam end and shortens the stub cantilever (front-stub 0.62 to 0.38, front-beam 0.98 to 0.94 in the study).',
  },
  wheelBoreIn: {
    label: 'Wheel bore (bearing inside diameter)', group: 'wheels', unit: 'in',
    default: 0.625, min: 0.5, max: 1, step: 0.125, status: 'verify', ref: 'D-60, D-71',
    note: 'D-71: 5/8 in, the bore of the Harbor Freight 10 in pneumatic tire with black hub (SKU 67465) and of almost every 10 in hand-truck wheel; the axle is 5/8 in to match. VERIFY the bore on the real wheel. D-60: the bore of the wheel you buy must equal the axle diameter (the bearings ride on the axle OD, so a tube of the same OD fits where a rod would). validateParams warns when the bore and the axle differ.',
    options: [{ value: 0.625, label: '5/8"' }, { value: 0.75, label: '3/4"' }, { value: 1, label: '1"' }],
  },
  wheelMass10Lb: {
    label: 'Mass per 10" wheel assembly', group: 'wheels', unit: 'lb',
    default: 3.0, min: 2, max: 8, step: 0.25, status: 'verify', ref: 'D-11, D-60, D-71',
    note: 'D-71: 3.0 lb, the listing weight of the Harbor Freight 10 in pneumatic tire with black hub (SKU 67465); it is 0.2 lb a wheel (0.8 lb for four) over the D-60 figure of 2.8 lb (Tractor Supply 3551979). A retailer figure, not the maker\'s: weigh the wheel you order.',
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
    default: 0.625, min: 0.625, max: 1, step: 0.125, status: 'explore', ref: 'D-10, D-71',
    note: 'D-71: 5/8" to match the Harbor Freight wheel bore (the wheelBoreIn warning fires if they differ). Hand-truck wheels come with 5/8" or 3/4" bearings as standard; 1" bore versions exist, and 7/8"/1" bores need sourced bearings.',
    options: [
      { value: 0.625, label: '5/8"' },
      { value: 0.75, label: '3/4"' },
      { value: 0.875, label: '7/8"' },
      { value: 1, label: '1"' },
    ],
  },
  axleWallIn: {
    label: 'Axle tube wall (0 = solid rod)', group: 'wheels', unit: 'in',
    default: 0, min: 0, max: 0.3, step: 0.005, status: 'assumed', ref: 'D-60, D-71',
    note: 'D-71 (Eric chose the solid rod): 5/8 in solid 1045 or cold-drawn steel rod, cut to length, for the 5/8 in Harbor Freight wheel. The rod is +1.9 lb over the 5/8 in x 0.120 in DOM tube it replaces, and it has margin: axle-stress 0.71 at 150 lb, 0.78 at the 200 lb goal rider, 0.81 for the 200 lb cargo (the tube was 0.85 / 0.925 / 0.957, and fails on 55 to 60 ksi 1020 DOM). Buy 1045 (cold-drawn or turned-ground-polished, yield about 70 ksi or better, axleYieldPsi), NOT hot-rolled A36 (36 ksi) and NOT 1018 cold-drawn (about 54 ksi: axle-stress would be about 1.0 at 200 lb). A wall above 0 gives the hollow DOM tube of D-60 (the tube numbers are axleTubeYieldPsi / axleTubeUltimatePsi): bending of the tube, the cotter-pin cross hole, ring bearing at the clamp plates. A tube needs its end plugs; the solid rod needs none.',
    options: [{ value: 0, label: 'Solid rod' }, { value: 0.095, label: '0.095" tube' }, { value: 0.12, label: '0.120" tube' }, { value: 0.188, label: '0.188" tube' }],
  },
  axleCrossHoleDiaIn: {
    label: 'Axle end cross hole (cotter pin)', group: 'wheels', unit: 'in',
    default: 0.15625, min: 0.09375, max: 0.25, step: 0.0001, status: 'assumed', ref: 'D-60',
    note: 'D-60: a 5/32 in hole drilled across the axle near each end for the 1/8 in cotter pin (or clevis pin) that keeps the collar on. The axle-stress and front-stub rows check the net section, the pin bearing and the tear-out at this hole (the hole is outboard of the wheel: the cross hole of a hollow axle goes through both walls).',
  },
  axleCrossHoleFromEndIn: {
    label: 'Axle cross hole: center from the axle end', group: 'wheels', unit: 'in',
    default: 0.375, min: 0.25, max: 0.75, step: 0.0625, status: 'assumed', ref: 'D-60',
    note: 'D-60: with 1 in of axle beyond the hub (axleEndExtraIn) this leaves 5/8 in for the collar and washer. The edge distance (this less half the hole) should be about 1.5 hole diameters or more.',
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
  axleProudIn: {
    label: 'Axle tube proud of the beam top (groove depth = tube diameter less this)', group: 'wheels', unit: 'in',
    default: 0.03, min: 0.02, max: 0.1, step: 0.01, status: 'assumed', ref: 'D-62, build 3c M2, D-71',
    note: 'D-62: the axle tube sits in a groove (tube diameter less this) deep, so the tube stands this far above the oak and the bridge plate BEARS ON THE TUBE and not on the beam top (flush, the D-60 plates floated 0.075 in above the tube and clamped nothing). D-71: 0.03 in (was 0.05 in) on the 5/8 in tube. The tube is 1/16 in smaller, which lowers the front axle beam top by 1/16 in and so makes the king beam (the deck underside down to the thrust disc) 1/16 in deeper, 1.7655 in: over the 1.75 in an 8/4 board finishes to, so it would have to be face-laminated (D-70). 0.03 in proud keeps it at 1.7455 in. Cut the groove 0.595 in deep for the 5/8 in tube (it was 0.70 in for the 3/4 in tube). The beam top is therefore this much below the top of the tube, which lowers the whole front stack by this much and the beam bottom to 3.03 in off the ground (D-71: 0.03 in proud). Shim the plate ends with tape on the first tightening and check it does not rock.',
  },
  clampLegGapIn: {
    label: 'Clamp bolt gap beside the axle tube', group: 'wheels', unit: 'in',
    default: 0.375, min: 0.125, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-10, D-62',
    note: 'The two bolts of a bridge plate sit at the tube center +/- (tube radius + this): 0.3125 + 0.375 = 0.6875 in for the 5/8 in tube (D-71; 0.75 in for the 3/4 in tube of D-62; it was 0.25, which left a 0.045 in sliver of oak between the 0.41 in bolt hole and the groove wall; now 0.17 in).',
  },
  clampPlateWidthIn: {
    label: 'Clamp bridge plate width (along the axle)', group: 'wheels', unit: 'in',
    default: 2, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-10, D-62, D-66, D-71, D-83',
    note: 'D-83: 2 in, so the plate is cut from 1/4 x 2 stock bar (no ripping). TRADE-OFF: the 2 in bar adds about 0.24 lb over 1-3/4 in, and raises the rear groove bearing margin (the green rider range goes from 220 to 240 lb, the cargo capacity from 254 to 286 lb). 1-3/4 in would need a rip of 1/4 in stainless, or two 12 in pieces of 1-3/4 in bar at about $18 more. The plate lies across the tube on a line this long (the ring-bending row of the tube wall uses it, and the bearing-groove row takes the axle diameter x this as the bearing area in the oak). D-71: 1.75 in (was 1.5 in): the 5/8 in axle has 17 percent less bearing area, which took the rear groove bearing to 0.99 at the 200 lb rider and 1.03 (a fail) at the 200 lb cargo; 1.75 in brings it to 0.85 and 0.88 for about 0.16 lb in all. D-66: at the 30 in rear track the tire inner face is 13.25 in from center, so the rear plate runs from 11.75 to 13.25 in: its inner 1/4 in is UNDER the 12 in rail, whose relief notch is cut high enough to clear it (frame.ts; the hanger, which carries the beam seat, is inboard of that).',
  },
  clampPlateOuterWidthIn: {
    label: 'Front OUTER clamp plate width (along the axle)', group: 'wheels', unit: 'in',
    default: 2, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-62, eng 3c S-3, D-83',
    note: 'D-83: 2 in, cut from the same 1/4 x 2 stock bar as the other plates. D-62: the outer front clamp plate takes the fore-aft bump force on the groove wall (front-beam, HARD 2 in hit, 200 lb cargo forward). The 0.70 in groove (the tube stands proud) cut the wall area 7 percent and put that detail at 1.00; 1/4 in more plate (the eng review S-3 asked for 1/2 in more) brings it to 0.88 for 0.04 lb a plate. The inner front plates and the rear plate stay clampPlateWidthIn.',
  },
  clampPlateLengthIn: {
    label: 'Clamp bridge plate length (across the tube, fore-aft)', group: 'wheels', unit: 'in',
    default: 2.25, min: 1.5, max: 4, step: 0.25, status: 'assumed', ref: 'D-10, D-62',
    note: 'D-62: ONE plate per clamp station with two 3/8 in bolts at +/- 0.6875 in for the 5/8 in tube (D-71; 0.75 in for the 3/4 in tube) (6 plates instead of 12, same bolt count): 316 flat bar 1/4 x 2 x 2-1/4 in (D-83: 2 in stock bar; 1.75 in at D-71, 1.5 in before), 3/8 in from each hole centre to the end. The plate in bending between the bolts (a 800 lbf tube load, the oak-limited preload) is about 19 ksi.',
  },
  clampPlateThickIn: {
    label: 'U-bolt plate thickness', group: 'wheels', unit: 'in',
    default: 0.25, min: 0.1875, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-10, D-60',
    note: 'D-60: 1/4 in (was 3/8 in); no row moves.',
  },
  wheelRatingLb: {
    label: 'Wheel load rating, each (vendor listing)', group: 'wheels', unit: 'lb',
    default: 300, min: 100, max: 800, step: 25, status: 'verify', ref: 'D-11, D-60, D-71',
    note: 'D-71: 300 lb per wheel, the listing rating of the Harbor Freight 10 in pneumatic tire (SKU 67465). VERIFY it on the real wheel. D-60: 300 lb per wheel, the Tractor Supply listing rating for the 2.8 lb wheel (the Wesco 151551 is listed at 350 lb). It is a static / rolling rating: the wheel-rating check compares the static goal-rider load to it and the dynamic peak to `wheelRatingPeakMult` times it; the resting-load row compares the heavier wheel\'s static load with it.',
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
    default: 0.125, min: 0.125, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-15, D-60',
    note: 'D-60: 1/8 in (was 3/16 in) 316 angle.',
  },
  beamHoldDownBoltDiameterIn: {
    label: 'Rear beam hold-down bolt diameter', group: 'wheels', unit: 'in',
    default: 0.25, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-15',
    note: '1/4" 316 stainless hex bolts, nylock nuts, fender washers (the bolts through the rail sit 4D above the notch ceiling).',
  },
  axleHangerThickIn: {
    label: 'Axle hanger thickness (across, on the inside of each rail)', group: 'wheels', unit: 'in',
    default: 0.875, min: 0.5, max: 1.5, step: 0.0625, status: 'assumed', ref: 'D-54, D-15, D-58',
    note: 'D-58: 7/8 in (was 3/4 in). At the 8 in deck only 2.15 in of hanger is left above the beam notch and the rail shear there is proportional to the hanger thickness; the narrower 32 in rear track (more load on a rear wheel) and the 200 lb rider / 200 lb cargo bump failed it at 1.03 to 1.06x with 3/4 in. 7/8 in oak takes 1.17x the shear. D-54: the deck is 14.7 in up, so the rails no longer reach the axle beam. An oak hanger glued and bolted to the INSIDE face of each rail drops from the rail top to the beam and carries the old beam notch and hold-down angle (rear-mount.ts). Its grain is vertical (side-grain glue to the rail).',
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
    default: 70000, min: 30000, max: 120000, step: 1000, status: 'verify', ref: 'D-4, D-71',
    note: 'D-71: the 5/8 in solid rod. 1045 cold-drawn or turned-ground-polished shafting is about 70+ ksi (D-27; confirm vendor cert). 1018 cold-drawn would be about 54 ksi and hot-rolled A36 36 ksi: both too weak for the 200 lb goal (axle-stress about 1.0 and 1.5).',
  },
  axleTubeYieldPsi: {
    label: 'Axle tube yield strength (DOM)', group: 'wheels', unit: 'psi',
    default: 70000, min: 30000, max: 120000, step: 1000, status: 'verify', ref: 'D-60',
    note: 'Used only with a hollow tube (axleWallIn above 0); with the default solid rod (D-71) the checklist does not ask for it. Order DOM (drawn over mandrel) or CDS tube to ASTM A513 Type 5, NOT ordinary ERW "mechanical" tube (about 45 ksi yield / 55 ksi ultimate, which takes axle-stress from 0.92 to about 1.4 at the 5/8 in size of D-71, a fail); keep the mill cert. D-60: 1026 DOM tube is listed at about 70 ksi yield / 80+ ksi tensile (1020 DOM about 60 to 70 ksi yield): CONFIRM on the vendor listing or the mill cert, and lower it if the stock you can buy is 1020 DOM at 60 ksi. Used for the bending, cross-hole and ring-bearing rows when the axle is a tube (axleWallIn > 0); the solid rod uses the 1045 value above.',
  },

  // ── Steering & pull ──────────────────────────────────────────────────────
  // ── Front end (PROVISIONAL) and the bridle eye. The swivel casters of the first D-54 pass were rejected by Eric (deck too high, too close together, 360 degrees of swivel); the front end is being redecided (a center-pivot soapbox axle with limited steering). Until then the front is a fixed placeholder axle. ──
  frontTrackIn: {
    label: 'Front track (wheel center to center)', group: 'steering', unit: 'in',
    default: 30, min: 26, max: 52, step: 0.125, status: 'explore', ref: 'D-56, D-58, D-66',
    note: 'D-66 (Eric): equal to the rear track, so the straight-ahead wheels line up. The front wheels sit outboard of the body on the ends of the pivoting axle beam; at full lock a wheel\'s inner rear corner swings toward the body, and the bow taper (bowWidthIn, bowTaperStartIn, bowTaper in params.ts) is DERIVED from that sweep so the tire clears by steerClearIn + bowTaperSlackIn through the whole +-lock range. A narrower front track needs a longer or narrower taper (steer-clear check in validateParams). D-58 had 34.5 in front and 32 in rear with a 24 in straight body.',
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
    default: 3, min: 1.5, max: 4, step: 0.25, status: 'assumed', ref: 'D-56, D-58',
    note: 'D-58: UHMW disc between the top of the axle beam and the king beam: the bearing the static front load and the tow-pull tilt turn on. The one-wheel roll couple no longer goes through it (the roll pads carry that, rollPadRadiusIn), so it is 3 in (was 2.5 in); the disc is screwed to the king beam and the axle beam turns under it.',
  },
  kingThrustThickIn: {
    label: 'Kingpin thrust washer thickness', group: 'steering', unit: 'in',
    default: 0.5, min: 0.125, max: 0.75, step: 0.0625, status: 'assumed', ref: 'D-56, D-58, D-62',
    note: 'D-62 (build 3c S5): 1/2 in, a catalog UHMW sheet thickness (McMaster steps are 1/2 and 5/8; the D-58 value of 9/16 in is not stocked, and a 5/8 in disc would take the pad gap to the edge of its window). The king beam is 1/16 in deeper to match. D-58: With the steel tongue plate gone the disc lies directly on the axle beam, and its thickness sets the running gap between the axle clamp plates (tops 3/8 in above the beam) and the king beam: 3/16 in (the steer-clear row wants 1/8 in).',
  },
  rollPadRadiusIn: {
    label: 'Roll pads: distance from the kingpin along the axle beam', group: 'steering', unit: 'in',
    default: 9.75, min: 6, max: 14, step: 0.25, status: 'assumed', ref: 'D-58, D-60, D-66, D-83',
    note: 'D-58: two UHMW slide pads on top of the axle beam, one each side of the kingpin, that slide under the frame rails with a small running gap and catch the roll of a one-wheel bump, so the kingpin only locates. The rails are the nearest continuous frame members at this distance (they pass over the whole swing); the pad covers the rail underside at every steering angle (checked in king-bearing). D-60: the pad moves with the inner station\'s edge (validateParams checks it); the king-bearing row is unchanged. D-83: 9-3/4 in (was 9-1/2 in): the inner clamp plates are 2 in wide now (cut from 1/4 x 2 bar), so the pad moves 1/4 in out to keep its clearance from them.',
  },
  rollPadLenIn: {
    label: 'Roll pad length (along the axle beam)', group: 'steering', unit: 'in',
    default: 3, min: 1, max: 4, step: 0.2, status: 'assumed', ref: 'D-58',
    note: 'Long enough that part of the pad is under the 3/4 in rail whatever the steering angle (the rail curves in toward the bow, D-57): the pad turns through an arc while the rail runs straight, so the overlap is at worst about 1.5 in2.',
  },
  rollPadWidthIn: {
    label: 'Roll pad width (fore-aft)', group: 'steering', unit: 'in',
    default: 2, min: 1, max: 2.5, step: 0.25, status: 'assumed', ref: 'D-58',
    note: 'Fore-aft size; the 2.5 in axle beam carries the screws. At full lock the corner of the pad reaches the rail end at the bow bulkhead (the overlap is clipped there).',
  },
  rollPadThickIn: {
    label: 'Roll pad thickness (UHMW)', group: 'steering', unit: 'in',
    default: 0.25, min: 0.1875, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-58, D-62',
    note: 'D-62 (build 3c S5): 1/4 in, a catalog UHMW sheet thickness (5/16 in is not stocked). The rail bottom is beamRailClearIn above the top of the axle tube where the beam swings under it (railDepthFront); a 1/4 in pad leaves the 0.10 in running gap, set with a layer of tape under the pad.',
  },
  beamRailClearIn: {
    label: 'Clearance from the axle tube top to the shallow front rails', group: 'steering', unit: 'in',
    default: 0.35, min: 0.2, max: 0.6, step: 0.05, status: 'assumed', ref: 'D-62',
    note: 'D-62: was a fixed 0.4 in with a 5/16 in roll pad (gap 0.0875 in). With catalog 1/4 in UHMW pads, 0.35 in leaves a 0.10 in running gap (window 0.03 to 0.125 in) and the rails stay 0.05 in deeper at the front.',
  },
  rollPadGapMinIn: {
    label: 'Roll pad running gap (minimum / maximum)', group: 'steering', unit: 'in',
    default: 0.03, min: 0.01, max: 0.1, step: 0.01, status: 'assumed', ref: 'D-58',
    note: 'The running gap between the pad top and the rail underside must stay between this and 1/8 in: smaller binds the steering, larger lets the axle roll before the pad bears.',
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
  tongueWidthIn: {
    label: 'Bridle tongue thickness (white oak, set on edge)', group: 'steering', unit: 'in',
    default: 1.25, min: 1, max: 2.5, step: 0.25, status: 'assumed', ref: 'D-58, D-60',
    note: 'D-58: the steel tongue plate (it bent about its thin axis at 3.7x) is replaced by a white-oak tongue set on edge: 1.5 in across (y), tongueDepthIn deep (z), grain along its length. A bandsawn T: the wide head butts the front face of the axle beam and is bolted through it, the stem runs forward under the end joist and the bow to the bridle hole. D-60: 1-1/4 in (was 1-1/2 in).',
  },
  tongueTopDropIn: {
    label: 'Tongue top below the top of the axle beam', group: 'steering', unit: 'in',
    default: 0.1875, min: 0.0625, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-58',
    note: 'The UHMW thrust disc lies on the beam top and the tongue head turns under it, so the tongue top stays this far below the beam top.',
  },
  tongueDepthIn: {
    label: 'Bridle tongue depth (vertical)', group: 'steering', unit: 'in',
    default: 1.75, min: 1.5, max: 2.25, step: 0.125, status: 'assumed', ref: 'D-58, D-60',
    note: 'The top is tongueTopDropIn below the top of the axle beam (the disc rides on the beam top), so 2 in leaves the bottom 1/16 in above the beam bottom (3.19 in off the ground). More depth would hang toward the 3 in ground clearance. D-60: 1-3/4 in (was 2 in); the bottom then clears the beam bottom by 5/16 in.',
  },
  tongueHeadWidthIn: {
    label: 'Tongue head width (across the axle beam)', group: 'steering', unit: 'in',
    default: 6, min: 3, max: 9, step: 0.5, status: 'assumed', ref: 'D-58',
    note: 'The head is wide so its two carriage bolts are far enough apart (the yaw couple of a sideways yank) and clear of the kingpin.',
  },
  tongueHeadLenIn: {
    label: 'Tongue head length (fore-aft)', group: 'steering', unit: 'in',
    default: 3, min: 2, max: 5, step: 0.5, status: 'assumed', ref: 'D-58',
    note: 'The head, then a taper over the same length, then the stem. The bolts pass through the head and the whole axle beam.',
  },
  tongueBoltDiaIn: {
    label: 'Tongue carriage bolt diameter', group: 'steering', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-58',
    note: 'Two 316 carriage bolts, fore-aft through the tongue head and the axle beam (domed head and square neck in the tongue, fender washer and nylock nut on the rear face of the beam), one each side of the kingpin at mid depth.',
  },
  tongueBoltOffsetIn: {
    label: 'Tongue carriage bolts: distance each side of the center line', group: 'steering', unit: 'in',
    default: 2, min: 1, max: 4, step: 0.25, status: 'assumed', ref: 'D-58',
  },
  tongueTipEdgeIn: {
    label: 'Bridle hole: distance to the tongue tip', group: 'steering', unit: 'in',
    default: 1.5, min: 1.25, max: 4, step: 0.25, status: 'assumed', ref: 'D-58',
    note: 'Oak tears out along the grain, so the hole needs real end distance (the old steel tongue had 1 in); 1 1/2 in with the 1 in sleeve leaves 1 in of oak ahead of it, 3x what the 300 lbf tie load needs (bridle-eye). The rope makes one turn round this 1 in of oak at the tip.',
  },
  tongueHoleDiaIn: {
    label: 'Bridle hole in the tongue (bronze sleeve OD)', group: 'steering', unit: 'in',
    default: 1, min: 0.75, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-58',
    note: 'A 1 in hole drilled across the tongue takes a bronze sleeve bearing (1 in OD, tongueSleeveBoreIn bore) and a fender washer each side. The bridle rope runs through the bore (D-62: no shackle).',
  },
  tongueTieAheadIn: {
    label: 'Tongue tip ahead of the bow tip', group: 'steering', unit: 'in',
    default: 5, min: 2, max: 12, step: 0.5, status: 'assumed', ref: 'D-56, D-58',
    note: 'The tongue tip reaches this far beyond the bow so the bridle hole (tongueTipEdgeIn behind the tip) and the rope clear the bow and the axle can swing.',
  },
  steerChainDiaIn: {
    label: 'Steering stop chain: link stock diameter', group: 'steering', unit: 'in',
    default: 0.1875, min: 0.1875, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-58, D-60',
    note: 'D-58: the steering lock is set by two check chains (the old oak stop blocks hung 1 in below a 3/4 in joist and could not carry the 1.4 kip hard-hit torque: the pry crushed the joist underside 4 to 10x). Grade 43 or stainless 1/4 in chain, from an eye bolt in the trailing face of one end of the axle beam back, under the king beam, to an eye bolt in the crossmember behind it; the right chain goes taut at +lock, the left at -lock, and the other hangs slack. D-60: 3/16 in (was 1/4 in), about 1,000 lb working load.',
  },
  steerChainWllLb: {
    label: 'Steering stop chain: working load limit', group: 'factors', unit: 'lb',
    default: 1000, min: 1000, max: 5000, step: 100, status: 'verify', ref: 'D-58, D-60',
    note: '1/4 in grade 43 high-test chain is rated about 2,600 lb (grade 30 proof coil about 1,300 lb); confirm on the vendor listing. Ultimate is taken as 4 x the rating. D-60: 3/16 in chain, about 1,000 lb working load (grade 30 proof coil is less; confirm the grade and WLL on the vendor listing).',
  },
  steerEyeBoltDiaIn: {
    label: 'Steering stop eye bolts: shank diameter (forged shoulder eye bolts)', group: 'steering', unit: 'in',
    default: 0.375, min: 0.375, max: 0.75, step: 0.0625, status: 'assumed', ref: 'D-58, D-60',
    note: 'Four forged shoulder-type eye bolts (galvanized or stainless): two through the ends of the axle beam, two through the chain joist behind the king beam. Ultimate is taken as 5 x the rating, derated for the angle the chain pulls off the shank axis. D-60 (weight package): 3/8 in (was 1/2 in); the rating below is a supplier number to confirm.',
  },
  steerEyeWllLb: {
    label: 'Steering stop eye bolts: working load limit in line', group: 'factors', unit: 'lb',
    default: 900, min: 500, max: 6000, step: 100, status: 'verify', ref: 'D-58, D-60',
    note: 'A 1/2 in forged shoulder eye bolt is rated about 1,500 lb pulled in line with the shank (5/8 in: 2,600) (confirm on the vendor listing); pulled at an angle in the plane of the eye its rating falls (the analysis derates it linearly to 60 percent at 45 degrees). D-60: 3/8 in forged shoulder eye bolt, about 900 lb in line (listing numbers vary: confirm on the vendor listing before ordering; the steer-stops row uses this).',
  },
  steerChainBeamYIn: {
    label: 'Steering stop chain: eye in the axle beam, distance from the kingpin', group: 'steering', unit: 'in',
    default: 8, min: 4, max: 14, step: 0.2, status: 'assumed', ref: 'D-58, D-66',
    note: 'The eye bolt goes fore-aft through the beam at mid depth (below the stub axle rod in its top groove), its eye standing out of the trailing face, between the kingpin and the stub clamp plates. A long lever keeps the chain pull low. D-66: 8 in (was 10.4): the bow rails now stand at about 8.5 to 9.25 in off center and the chain must stay inside them through the whole swing (at lock the eye swings to about 0.94 x this + 0.65 in).',
  },
  steerChainAnchorYIn: {
    label: 'Steering stop chain: eye in the chain joist, distance from the center line', group: 'steering', unit: 'in',
    default: 7.8, min: 4, max: 11, step: 0.2, status: 'assumed', ref: 'D-58, D-66',
    note: 'D-66: 7.8 in (was 8.4): the chain joist stands where the bow taper has drawn the rail inner face in to about 9.1 in, and the 2 in washer needs 1.15 in of that. The eye bolt goes fore-aft through the chain joist (the crossmember just behind the king beam), the eye standing out of its front face, a little below mid depth; the 2 in washer and nut on its rear face must clear the rail. Behind the king beam the chain can run low, under it, to the beam end.',
  },
  chainJoistThickIn: {
    label: 'Chain joist thickness (the crossmember behind the king beam)', group: 'steering', unit: 'in',
    default: 1.25, min: 0.75, max: 2, step: 0.25, status: 'assumed', ref: 'D-58, D-60',
    note: 'D-58: the joist just behind the king beam anchors the two steering chains; at 1 1/2 in (the other joists are 3/4 in) the chain pull bends it in plan with 5 times less stress. The eye bolts go through it. D-60: 1-1/4 in (was 1-1/2 in).',
  },
  frontStubLenIn: {
    label: 'Front stub axle clamped length on the beam', group: 'steering', unit: 'in',
    default: 8, min: 4.5, max: 14, step: 0.5, status: 'assumed', ref: 'D-56, D-83',
    note: 'D-83: at least 4-1/2 in, so the two 2 in clamp plates of a stub fit. Each front stub axle is a steel rod bolted down in a groove in the top of the beam end (two clamp plates, as on the rear axle), the wheel on the free end.',
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

  bridleRopeDiaIn: {
    label: 'Bridle rope diameter (nylon)', group: 'steering', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-62, eng 3c S-1',
    note: 'D-62: no shackle (a catalog 1/2 in screw-pin shackle will not fit the 1-1/4 in tongue, and a real shackle is hundreds of times stronger than the tie load, so it was never a weak link). The bridle is 3/8 in NYLON three-strand rope (nylon stretches 15 to 25 percent under load, which absorbs the snatch when the rope goes from slack to taut at the start of a pull; low-stretch polyester was the worst choice). It runs through the bronze-sleeved hole in the tongue, once around the tongue tip, and is tied with a bowline round its own standing part, so a single strand passes through the bore. Optional: a 3 ft length of 3/8 in shock cord spliced in near the tongue cuts the snatch again (set bridleSnatchStiffLbIn to about 10).',
  },
  bridleRopeBreakLbf: {
    label: 'Bridle rope breaking strength (new, spliced ends)', group: 'factors', unit: 'lbf',
    default: 3700, min: 1000, max: 12000, step: 100, status: 'verify', ref: 'D-62',
    note: 'Cordage Institute minimum tensile strength of 3/8 in three-strand nylon is about 3,700 lbf (double-braid nylon is a little higher); confirm on the vendor listing. A bowline keeps about 60 percent of it (bridleKnotEfficiency).',
  },
  bridleKnotEfficiency: {
    label: 'Bridle knot efficiency (bowline)', group: 'factors', unit: '×',
    default: 0.6, min: 0.4, max: 1, step: 0.05, status: 'assumed', ref: 'D-62',
    note: 'A bowline keeps roughly 60 percent of the rope strength; an eye splice with a thimble keeps about 90.',
  },
  bridleRopeWllFraction: {
    label: 'Bridle rope working load limit (share of the breaking strength)', group: 'factors', unit: '×',
    default: 0.1, min: 0.05, max: 0.2, step: 0.01, status: 'assumed', ref: 'D-62',
    note: 'The working load limit of a rope in shock-prone service is 10 percent of its new breaking strength (a safety factor of 10; the Cordage Institute gives 15 percent for 3-strand nylon in steady service). 3/8 in nylon: 370 lbf, against the 150 lbf design pull.',
  },
  bridleSnatchSpeedMph: {
    label: 'Bridle snatch: closing speed when the slack comes taut', group: 'loads', unit: 'mph',
    default: 4, min: 1, max: 8, step: 0.5, status: 'assumed', ref: 'D-62, eng 3c S-1',
    note: 'The pullers take up the slack and the sled is not yet moving, so the rope goes from slack to taut with the pullers 2 to 4 mph ahead of the sled. The snatch force is v sqrt(k m): see bridleSnatchStiffLbIn.',
  },
  bridleSnatchStiffLbIn: {
    label: 'Bridle snatch: stiffness of the rope and the pullers', group: 'loads', unit: 'lb/in',
    default: 25, min: 3, max: 200, step: 1, status: 'verify', ref: 'D-62, eng 3c S-1',
    note: 'About 25 lb/in for 8 ft of 3/8 in nylon plus the pullers (nylon gives roughly 15 percent stretch at 10 percent of its breaking strength: 370 lbf over 14 in of an 8 ft run). Low-stretch polyester is about 100 lb/in (the 320 to 640 lbf the engineering review estimated for a 320 lb sled), nylon with a 3 ft shock-cord section about 10. A cheap field test: pull the rope with a luggage scale and measure the stretch.',
  },
  tongueSleeveBoreIn: {
    label: 'Bridle sleeve bore (bronze sleeve bearing ID)', group: 'steering', unit: 'in',
    default: 0.625, min: 0.5, max: 0.875, step: 0.0625, status: 'verify', ref: 'D-62',
    note: 'The bridle rope runs through this bore (a single strand, so it needs only a little over the rope diameter). 5/8 in ID x 1 in OD oil-embedded bronze sleeve bearings are a stocked McMaster size (confirm). Round (flare or ease) both ends of the bore so the rope does not bear on a sharp edge.',
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
    default: 1.5, min: 1.25, max: 4, step: 0.25, status: 'explore', ref: 'D-57, D-65',
    note: 'D-57: a target, not an input. The analysis uses the ratio DERIVED from the flap geometry (pad force on the tread over the foot force, from the moments about the pivot pin, with the pad friction in or against the swing); brake-ratio fails if the geometry delivers less than this. The owner asked for about 2:1. D-65 (Eric): the flap now ends at the transom face, which shortens the foot lever from about 2.3:1 to about 2.0:1 (the average of the two rolling directions; 1.8 in the weaker one), so the target is 1.5 (was 1.75): the row that judges the brake is brake-slow (D-58), which still passes at every rider.',
  },
  brakeEfficiency: {
    label: 'Brake linkage efficiency', group: 'brake', unit: '×',
    default: 0.95, min: 0.5, max: 1, step: 0.05, status: 'assumed', ref: 'D-13, D-57',
    note: 'Pin friction only (D-57, D-65): the stainless pivot pin in oak is the only moving joint of the flap brake, so 0.95.',
  },
  brakePadMu: {
    label: 'Pad-to-tire friction μ (rubber / leather pad on a wet tread, design)', group: 'brake', unit: '',
    default: 0.4, min: 0.2, max: 0.8, step: 0.05, status: 'assumed', ref: 'D-13, D-57',
    note: 'D-57: a 3/8" rubber (or veg-tan leather) pad on a wet rubber tread. Rubber on rubber runs 0.6 to 1.0 dry; wet it falls to about 0.4 to 0.5, which is used here conservatively. Test a pad sample on a wet tire first.',
  },
  brakePadMuFouled: {
    label: 'Pad-to-tire friction μ, mud / snow fouled (pass/fail case)', group: 'brake', unit: '',
    default: 0.25, min: 0.15, max: 0.8, step: 0.05, status: 'assumed', ref: 'D-13, D-57',
    note: 'The pad rests on the shoulder of the tread, which carries mud, slush and ice from the ground. The foot-force check and the member loads use the lower of this and the design μ; the force must still be within the foot-force limit at this μ (the hold row reports it honestly).',
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
    default: 0.875, min: 0, max: 3, step: 0.125, status: 'assumed', ref: 'D-53, D-57',
    note: 'D-57: a gentle crown (was 3 in), bandsawn from one oak board rather than laminated. A sled-style handlebow (D-53): the bow arches up between and over the two posts. 0 = the old straight bar. The bow ends overhang the posts to the edge of the sled; the grip height (rearHandleHeightIn) is measured at the posts.',
  },
  handleParkClearIn: {
    label: 'Parked handlebow clearance over the rear side top', group: 'brake', unit: 'in',
    default: 1, min: 0.25, max: 4, step: 0.25, status: 'assumed', ref: 'D-57',
    note: 'Second pin position (D-57): the posts drop deeper into the sockets and the bow rests this far above the top of the rear transom when it is not being pushed.',
  },
  handlePostThickIn: {
    label: 'Push-handle upright thickness (fore-aft)', group: 'brake', unit: 'in',
    default: 0.6875, min: 0.625, max: 1.5, step: 0.0625, status: 'assumed', ref: 'D-39, D-60',
    note: 'Build r2 S7: a slip fit (with `handleSocketSlipIn` per side) in the aluminum tube. D-60: 11/16" (was 15/16"), so the socket is the standard 1" × 1-1/2" × 1/8" 6061 rectangular tube (inside 0.75" × 1.25") instead of the 1-1/4" × 1-3/4" one (post 11/16" + 2 × 1/32" slip = 0.75"). Mill from 3/4" stock; leave room for the oak to swell. The study\'s 3/4" × 1-1/4" post would need a 1-1/16" × 1-9/16" tube that is not a catalog size.',
  },
  handlePostWidthIn: {
    label: 'Push-handle upright width (across)', group: 'brake', unit: 'in',
    default: 1.1875, min: 1, max: 2.5, step: 0.0625, status: 'assumed', ref: 'D-39, D-60',
    note: 'D-60: 1-3/16" (was 1-7/16"); planed from 1-1/4" stock (see the thickness).',
  },
  handleSocketSlipIn: {
    label: 'Push-handle post slip clearance per side in the socket', group: 'brake', unit: 'in',
    default: 0.03125, min: 0.015, max: 0.0625, step: 0.0078, status: 'assumed', ref: 'D-39',
    note: 'Socket outside = post + 2 × (wall + slip): D-60: 11/16" + 2 × (1/8" + 1/32") = 1" and 1-3/16" + 0.3125" = 1-1/2", the standard tube (it was 15/16" and 1-7/16" → 1-1/4" × 1-3/4").',
  },
  handleSocketDepthIn: {
    label: 'Push-handle socket depth (tube length)', group: 'brake', unit: 'in',
    default: 14, min: 3, max: 18, step: 0.5, status: 'assumed', ref: 'D-39, D-57, D-60',
    note: 'D-57: deeper (was 6 in) so the posts can drop to the parked pin position with the bow just above the rear side top (handleParkClearIn); at 16 in about 5.7 in of post stayed in the socket when riding. Rectangular-tube socket bolted to the outside of the rear transom, its top flush with the transom top. D-60 took it from 16 in to 12 in; the parked position still sinks the post 9.8 in, which left only 1.7 in of post in the socket when riding (it was 5.7 in). Eric (2026-10-12): 14 in, so about 3.7 in of post stays in the socket when riding, the riding pin hole is 2.2 in (7 pin diameters) above the post foot, and the mass goes up 0.46 lb (the tubes are longer and so are the posts; the +0.2 lb quoted earlier was the tubes alone). At 12 in the riding pin hole would sit 0.19 in above the foot of the post (eng 3c review MUST-1): validateParams now errors when it is under 4 pin diameters and warns under 3 in of insertion.',
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
    note: 'A handler leaning back on the grip to hold the sled on a descent (task brief: 50 lbf at the grip height).',
  },

  // ── Brake mechanism (D-57 item 8: scooter-style step brake; the D-55 steel drag bar is gone) ───────────
  brakeFootForceLimitLbf: {
    label: 'Max foot force on each brake flap', group: 'brake', unit: 'lbf',
    default: 90, min: 30, max: 150, step: 5, status: 'assumed', ref: 'D-57',
    note: 'D-57: one foot per flap with both flaps pressed. A 180 lb adult handler standing on both flaps puts half of his weight, 90 lbf, on each (a 150 lb scout leader 75; a 200 lb adult 100). The hold row reports the true force for the 150 lb, 200 lb and cargo cases at the fouled pad; where it exceeds the limit the chock parks the sled (park-hold).',
  },
  brakeFootAbuseLbf: {
    label: 'Brake flap abuse stomp', group: 'brake', unit: 'lbf',
    default: 150, min: 100, max: 300, step: 10, status: 'assumed', ref: 'D-55, D-57',
    note: 'A scout jumping on one flap: the flap, pivot pin and block, knee, bolts and backer must survive it at yield (SF 1). The brake may be bent after it only if the check says so.',
  },
  brakeLiningMaxPsi: {
    label: 'Brake pad allowable contact pressure', group: 'brake', unit: 'psi',
    default: 100, min: 30, max: 300, step: 10, status: 'assumed', ref: 'D-53, D-57',
    note: 'A soft rubber pad against a rubber tread: a long-life limit for a brake used only now and then. Pressure = pad normal force / pad area at the lambda hold load.',
  },
  brakeClearanceIn: {
    label: 'Brake moving-part clearance (sweep limit)', group: 'brake', unit: 'in',
    default: 0.1, min: 0.03, max: 0.5, step: 0.01, status: 'assumed', ref: 'D-38, D-57',
    note: 'Minimum gap between the moving flap group (flap, pivot block, shoe block, pad, bungee) and the tire, hull, rails and ground over the full stroke.',
  },
  brakeLoadFactor: {
    label: 'Brake component load factor (on the hold load)', group: 'brake', unit: '×',
    default: 2, min: 1, max: 4, step: 0.25, status: 'assumed', ref: 'D-65',
    note: 'The flap, pivot, knee and bolts are checked at this multiple of the load needed to hold the sled on the design slope: a hard stomp or a jerk on a parked sled.',
  },
  brakeSteelYieldPsi: {
    label: 'Brake arm plate / pin steel yield', group: 'brake', unit: 'psi',
    default: 36000, min: 30000, max: 100000, step: 1000, status: 'assumed', ref: 'D-38',
    note: 'A36 plate. Allowable = yield / steel safety factor (shear 0.577×).',
  },

  brakePivotAheadIn: {
    label: 'Brake knee rear face ahead of the tire front', group: 'brake', unit: 'in',
    default: 1.25, min: 0.25, max: 4, step: 0.25, status: 'assumed', ref: 'D-57, D-65',
    note: 'D-57, D-65: the knee stands ahead of the rear tire: its rear face is at x = wheel radius + this, but never behind x = 6 in, the end of the sign zone on the side (D-57 item 9). The pivot pin is brakePivotEndIn of oak further forward (x = 7 in at the defaults). The farther ahead, the longer the pad-side lever and the lower the foot lever ratio.',
  },

  brakePadAngleDeg: {
    label: 'Pad position behind the top of the tire', group: 'brake', unit: '°',
    default: 6, min: 0, max: 40, step: 1, status: 'explore', ref: 'D-57',
    note: 'Centre of the pad on the tread, measured from the top of the tire toward the rear. Near the top the pad force is nearly vertical (the hinge sees little sideways load). A pad farther back is closer to the foot (lower ratio).',
  },

  brakePadLengthIn: {
    label: 'Brake pad length (along the tread)', group: 'brake', unit: 'in',
    default: 3, min: 2, max: 5, step: 0.25, status: 'assumed', ref: 'D-57',
    note: 'Rubber (or leather) pad glued and screwed to an oak shoe block that is cut to the tire radius.',
  },

  brakePadWidthIn: {
    label: 'Brake pad width (across the tread)', group: 'brake', unit: 'in',
    default: 3, min: 1.5, max: 3.4, step: 0.1, status: 'assumed', ref: 'D-57',
    note: 'Inside the tread edges (the model clamps it to the tire width minus 0.3 in). Pad area sets the contact pressure.',
  },

  brakePadThickIn: {
    label: 'Brake pad thickness', group: 'brake', unit: 'in',
    default: 0.375, min: 0.25, max: 0.75, step: 0.125, status: 'assumed', ref: 'D-57',
    note: '3/8" 60 to 70 durometer rubber (or 3/8" veg-tan leather) sheet; replaceable.',
  },

  brakePadGapIn: {
    label: 'Pad to tread gap, released (at the pad centre)', group: 'brake', unit: 'in',
    default: 0.375, min: 0.15, max: 0.75, step: 0.025, status: 'assumed', ref: 'D-57',
    note: 'Sets the swing of the flap (angle = gap over the pad lever) and so the foot stroke. Includes the squash of the tire and a little wear allowance; the bungee and the stop cord hold this gap while the sled rolls.',
  },

  brakeShoeBlockIn: {
    label: 'Oak shoe block thickness under the flap (at its thinnest)', group: 'brake', unit: 'in',
    default: 0.5, min: 0.25, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-57',
    note: 'A wedge of oak between the flap and the pad that turns the flap\'s slope into the tire\'s radius. Glued and screwed (2 stainless #10) to the flap underside.',
  },

  brakeFlapThickIn: {
    label: 'Brake flap thickness', group: 'brake', unit: 'in',
    default: 0.875, min: 0.75, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-57, D-60',
    note: 'White oak planed from 5/4 stock. Grain along the flap. The foot end is grooved or taped for grip. D-60: 7/8 in (was 1 in), from 4/4 stock planed to 7/8 in.',
  },

  brakeFlapWidthIn: {
    label: 'Brake flap width (across, over the tire)', group: 'brake', unit: 'in',
    default: 3, min: 2.5, max: 4.5, step: 0.25, status: 'assumed', ref: 'D-57, D-60',
    note: 'The flap is centred on the rear tire (it follows rearTrackIn) and is as wide as the tread. D-60: 3 in (was 3-1/2 in).',
  },

  brakeFlapSlopeDeg: {
    label: 'Brake flap slope (descending toward the rear)', group: 'brake', unit: '°',
    default: 6, min: 0, max: 15, step: 1, status: 'assumed', ref: 'D-57',
    note: 'The foot end is lower than the pivot by this slope, so the foot has less height to climb. The flap\'s underside clears the pad by the shoe block thickness.',
  },

  brakeFlapEndBehindTransomIn: {
    label: 'Flap (and foot tread) rear end behind the rear transom face', group: 'brake', unit: 'in',
    default: 0, min: 0, max: 6, step: 0.5, status: 'assumed', ref: 'D-65',
    note: 'D-65 (Eric): the foot tread ends AT the rear transom face (0): nothing of the flap sticks out behind the sled. The foot point is the middle of the tread, so a shorter flap shortens the foot lever (about 2.3:1 to 2.0:1 on average).',
  },

  brakeFootPadLengthIn: {
    label: 'Foot area length on the flap', group: 'brake', unit: 'in',
    default: 4, min: 3, max: 7, step: 0.5, status: 'assumed', ref: 'D-57, D-65',
    note: 'The last stretch of the flap is the foot tread, a ribbed rubber strip glued on. D-65: 4 in (was 5): the tread now ends at the transom face, so the foot point (the middle of the tread) is 2 in ahead of the transom face and the foot lever is as long as it can be there.',
  },






  brakeKneeDepthIn: {
    label: 'Knee (outrigger) fore-aft depth', group: 'brake', unit: 'in',
    default: 2.125, min: 2, max: 5, step: 0.125, status: 'assumed', ref: 'D-57, D-74',
    note: 'The oak outrigger that carries the hinge sits ahead of the tire; the bolt columns spread over this depth. D-74: 2-1/8 in = 3 layers of 3/4 in (4/4) face-laminated, less the 1/8 in cleanup (was 2-1/2 in).',
  },

  brakeKneeLegIn: {
    label: 'Knee leg thickness (against the hull)', group: 'brake', unit: 'in',
    default: 1.75, min: 1.25, max: 3, step: 0.25, status: 'assumed', ref: 'D-57, D-60',
    note: 'The foot of the knee that sits on the rail and chine outer face; the mounting bolts pass through it. D-60: 1-3/4 in (was 2 in).',
  },

  brakeKneeRoofIn: {
    label: 'Knee roof over the pivot pocket (oak above the tongue)', group: 'brake', unit: 'in',
    default: 0.75, min: 0.5, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-77',
    note: 'D-77 (Eric approved, 2026-10-13): the outboard ear is gone and the slot is a POCKET open at the rear and the outboard side, with oak above it (this roof) and below it (brakeKneeFloorIn). The pivot strap spans the open side and its upper screws bite the roof; 3/4 in leaves 3/8 in of oak each side of a #8 screw. The knee top stands this much above the pocket (the pocket clears the tongue and block through the swing by brakePivotSlotClearIn).',
  },

  brakeKneeFloorIn: {
    label: 'Knee floor under the pivot pocket (at the outboard face)', group: 'brake', unit: 'in',
    default: 0.75, min: 0.5, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-77',
    note: 'D-77: oak under the pocket at the knee\'s outboard face (it deepens inboard along the sloping underside); the strap\'s lower screws bite it. Replaces brakeKneeArmIn (the arm depth at its outboard end, 1-1/2 in): the arm now ends at the pocket\'s outboard face and its depth there is the floor, the pocket and the roof.',
  },

  brakeStrapThickIn: {
    label: 'Pivot strap thickness (stainless flat bar)', group: 'brake', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-77',
    note: 'D-77: the pin\'s outboard end rides in a stainless strap screwed across the open side of the pocket (it replaces the oak outboard ear). Straight flat bar, cut to length on the metal bandsaw and drilled on the drill press: no bending, welding, tapping, machining or countersinking (Eric\'s no-fabrication rule). 1/8 in keeps the out-of-plane bending under a sideways push of the flap (brakeFlapSideLoadLbf) within the brake-pivot row.',
  },

  brakeStrapWidthIn: {
    label: 'Pivot strap width (fore-aft)', group: 'brake', unit: 'in',
    default: 2, min: 1.5, max: 2.5, step: 0.25, status: 'assumed', ref: 'D-77',
    note: 'D-77: the same 1/8 in x 2 in flat bar as the knee-bolt backing plate (one stock for both). It covers the whole pocket opening and puts its four #8 screws in the knee\'s two outer (UPRIGHT) layers, side grain. Capped at the knee depth less 1/8 in.',
  },

  brakeFlapSideLoadLbf: {
    label: 'Sideways push on the flap foot (a boot scuffing it)', group: 'brake', unit: 'lbf',
    default: 10, min: 0, max: 40, step: 1, status: 'assumed', ref: 'D-77',
    note: 'D-77: a boot scuffing sideways on the foot tread (about a ninth of the 90 lbf foot limit). The flap yaws in the pocket and the tongue pushes the strap outward, so the strap screws are loaded in withdrawal and the strap bends out of its plane (brake-pivot row). The oak ear it replaces was never checked for this.',
  },

  brakePivotPinDiaIn: {
    label: 'Flap pivot pin diameter (316 stainless clevis pin)', group: 'brake', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-65',
    note: 'D-65 (Eric): the screwed butt hinge is replaced by a pull pin. A 3/8 in stainless clevis pin goes through the strap (D-77), the flap\'s tongue and into the knee\'s inboard side (double shear) and is held by a hitch-pin clip: pull the pin, unhook the cord, and the flap lifts off. D-77: the outboard ear is a stainless strap now; the pin runs strap, tongue and block, then 1 in blind into the inboard ear (still double shear), the clip outboard of the strap.',
  },

  brakePivotTongueIn: {
    label: 'Flap pivot tongue width (across, in the knee pocket)', group: 'brake', unit: 'in',
    default: 1.25, min: 0.75, max: 2, step: 0.125, status: 'assumed', ref: 'D-65',
    note: 'The flap\'s front end narrows to this tongue (plan taper) and the oak pivot block lies on it; the pair enters the pocket in the rear of the knee (D-77) and the pin goes through the strap and into the knee, the tongue and the block. The slot is 1/16 in wider each side.',
  },

  brakePivotBlockIn: {
    label: 'Pivot block thickness (on the flap tongue)', group: 'brake', unit: 'in',
    default: 0.625, min: 0.375, max: 1, step: 0.125, status: 'assumed', ref: 'D-65',
    note: 'A small white-oak block glued and screwed on top of the flap tongue where it enters the knee. It deepens the tongue (flap 7/8 in + block 5/8 in) so the pin has 3/4 in of oak above and below it. D-77: the knee top stands brakeKneeRoofIn above the pocket that clears the block (it was flush with the block top).',
  },

  brakePivotEndIn: {
    label: 'Flap tongue past the pin (end distance)', group: 'brake', unit: 'in',
    default: 0.75, min: 0.5, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-65',
    note: 'The tongue and the pivot block reach this far past the pin axis: wood beyond the hole. Likewise the knee\'s inboard ear stands this far behind the pin (D-77: there is no outboard ear).',
  },

  brakePivotSlotClearIn: {
    label: 'Pocket clearance each side of the tongue', group: 'brake', unit: 'in',
    default: 0.0625, min: 0.03, max: 0.125, step: 0.0156, status: 'assumed', ref: 'D-65',
    note: 'The slot sawn in the knee arm is the tongue width plus this each side, so the flap swings freely and a little grit does not bind it. D-77: the slot is a pocket with a roof and a floor; it also clears the tongue and block by this much above and below through the whole swing.',
  },

  brakePivotBlockScrews: {
    label: 'Pivot block screws (#10, down through the block into the flap)', group: 'brake', unit: '',
    default: 3, min: 2, max: 4, step: 1, status: 'assumed', ref: 'D-65',
    note: 'Plus epoxy over the whole glued face. They keep the block on when the pin pushes it up (the cord pulls the flap up).',
  },

  brakeBackerThickIn: {
    label: 'Backer (doubler) thickness inside the rail', group: 'brake', unit: 'in',
    default: 0.75, min: 0.75, max: 2, step: 0.25, status: 'assumed', ref: 'D-57, D-60',
    note: 'An oak block epoxied to the inside face of the rail (and the deck underside); the mounting bolts end in it. Joists that meet it are cut back. D-60: 3/4 in (was 1-1/4 in).',
  },

  brakeBackerCboreDeepIn: {
    label: 'Backer recess depth for the nut-side backing plate', group: 'brake', unit: 'in',
    default: 0.125, min: 0, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-57, D-65, D-75',
    note: 'D-75: the four nut-side fender washers (1-1/4 in on bolts 1-1/16 in apart) overlapped, and so did their 1-3/8 in counterbores. The nuts now bear on ONE stainless backing plate (brakeBackPlateThickIn) let into a flat-bottomed rectangular recess this deep in the backer\'s inner face (router or chisel; the plate size is in its part). 1/8 in sets the plate flush and keeps the stock 4 in bolt (was 1/2 in deep round counterbores).',
  },

  brakeBackPlateThickIn: {
    label: 'Knee-bolt backing plate thickness (stainless flat bar)', group: 'brake', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.25, step: 0.0625, status: 'assumed', ref: 'D-75',
    note: 'D-75: one stainless plate per knee under the four nuts, cut from 2 in x 1/8 in flat bar (the bolt pattern plus the same margin all round). It spreads the bolt tension over the backer like a big washer; 1/8 in keeps its overhang past the nuts within the brake-mount bending check (1/16 in would bend like a fender washer).',
  },

  brakeBackPlateYieldPsi: {
    label: 'Knee-bolt backing plate yield (304 / 316, annealed)', group: 'brake', unit: 'psi',
    default: 30000, min: 25000, max: 60000, step: 1000, status: 'assumed', ref: 'D-75',
    note: 'Annealed 304 and 316 flat bar: 30 ksi minimum yield (ASTM A276 / A479). Allowable = yield / steel safety factor. D-77: also the pivot strap (the same flat bar).',
  },

  brakeMountBoltDiaIn: {
    label: 'Knee mounting bolt diameter', group: 'brake', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-57',
    note: '316 stainless hex bolts with fender washers and nylock nuts, through the knee leg, the rail and the backer.',
  },

  brakeMountWasherOdIn: {
    label: 'Knee bolt head washer outside diameter (3/8 in narrow flat washer)', group: 'brake', unit: 'in',
    default: 0.875, min: 0.75, max: 1.0625, step: 0.0625, status: 'assumed', ref: 'D-57, D-65, D-75',
    note: 'D-75: a 3/8 in narrow (type B) flat washer, 7/8 in OD, under each bolt HEAD on the knee leg\'s outboard face, with no counterbore. The knee is 2-1/8 in deep with the bolt columns 1-1/16 in apart and 17/32 in from each face, so a 1 in washer (the first D-75 choice) stood only 1/32 in from the knee\'s face edge and would overhang with any drilling error; the 7/8 in washer leaves 3/32 in at the face and 3/16 in between the washers (the old 1-1/4 in fender washers overlapped). The head side bears on the knee\'s outer layers (D-77: UPRIGHT, side grain) and on the edge of the ACROSS center layer (end grain); the head-washer row stays well below its limit at 7/8 in. The nut side has the backing plate (brakeBackPlateThickIn), not washers. D-65 history: 1-1/4 in fender washers under the nuts in 1-3/8 in counterbores.',
  },

  brakeMountBoltColumns: {
    label: 'Knee mounting bolt columns (fore-aft)', group: 'brake', unit: '',
    default: 2, min: 1, max: 3, step: 1, status: 'assumed', ref: 'D-57',
  },

  brakeMountBoltRows: {
    label: 'Knee mounting bolt rows (vertical, across the rail)', group: 'brake', unit: '',
    default: 2, min: 1, max: 3, step: 1, status: 'assumed', ref: 'D-57',
  },

  brakeBungeeTensionLbf: {
    label: 'Return bungee tension, released', group: 'brake', unit: 'lbf',
    default: 3, min: 1, max: 10, step: 0.5, status: 'assumed', ref: 'D-57',
    note: 'A 1/4" shock cord from the flap to an eye screw in the gunwale, a stop cord of equal length beside it. It lifts the flap and the shoe block against the stop cord; the stomp stretches it further.',
  },

  brakeBungeeRateLbfPerIn: {
    label: 'Return bungee rate', group: 'brake', unit: 'lbf/in',
    default: 1.5, min: 0.5, max: 5, step: 0.5, status: 'assumed', ref: 'D-57',
    note: 'A 1/4" shock cord of this stiffness (a few lbf per inch of stretch at a 6 to 12 in length).',
  },

  brakeBungeeAnchorBelowTopIn: {
    label: 'Bungee eye below the rear transom top', group: 'brake', unit: 'in',
    default: 2.5, min: 1, max: 6, step: 0.5, status: 'assumed', ref: 'D-57',
    note: 'The stainless screw eye goes into the aft face of the rear transom near its outer corner, this far below the top edge, over the transom backer. (Not the side: its outer face is the sign zone.)',
  },

  brakeBungeeAnchorInsetIn: {
    label: 'Bungee eye in from the hull side face', group: 'brake', unit: 'in',
    default: 1, min: 0.5, max: 3, step: 0.25, status: 'assumed', ref: 'D-57',
    note: 'How far inboard of the hull\'s outer side face the transom eye sits. The handle sockets are at about 9.9 in from the center line, so 1 in keeps clear of them.',
  },

  brakeCordBreakLbf: {
    label: 'Cord breaking strength (1/4" braided polyester)', group: 'brake', unit: 'lbf',
    default: 800, min: 300, max: 2000, step: 50, status: 'assumed', ref: 'D-57',
    note: 'Stop cord and chock cord. The checks keep the load under a fifth of it.',
  },

  brakeChockHeightIn: {
    label: 'Wheel chock height', group: 'brake', unit: 'in',
    default: 2.125, min: 1, max: 4, step: 0.125, status: 'assumed', ref: 'D-57, D-74',
    note: 'An oak wedge on a cord for parking; stays under the knee (never taller than the rail bottom). D-74: 2-1/8 in = 3 layers of 3/4 in (4/4) face-laminated, less the 1/8 in cleanup (was 2-1/2 in).',
  },

  brakeChockAngleDeg: {
    label: 'Wheel chock ramp angle', group: 'brake', unit: '°',
    default: 28, min: 15, max: 55, step: 1, status: 'explore', ref: 'D-57',
    note: 'The chock\'s face is tangent to the tire at this angle off the ground and rises away from it: the wheel has to climb it. It holds if tan(angle) is under the ground friction and over the slope load over the wheel\'s weight (park-hold).',
  },

  brakeChockWidthIn: {
    label: 'Wheel chock width', group: 'brake', unit: 'in',
    default: 3.5, min: 2.5, max: 5, step: 0.25, status: 'assumed', ref: 'D-57',
  },

  brakeChockCount: {
    label: 'Wheel chocks carried (one per rear tire)', group: 'brake', unit: '',
    default: 2, min: 1, max: 2, step: 1, status: 'assumed', ref: 'D-57',
    note: 'Two chocks, one for each rear tire. One chock alone takes the whole slope load on one wheel and cannot hold the design slope (park-hold shows it).',
  },

  brakeChockMu: {
    label: 'Chock-to-ground friction μ (toothed oak on packed dirt / gravel)', group: 'brake', unit: '',
    default: 0.6, min: 0.2, max: 0.9, step: 0.05, status: 'verify', ref: 'D-57',
    note: 'The chock\'s base has two stainless screw heads left proud (or a sawtooth cut) to bite. Smooth wood on dirt is about 0.5; on ice or packed snow far less.',
  },

  brakeChockMuFouled: {
    label: 'Chock-to-ground friction μ, wet leaves / slush (pass/fail case)', group: 'brake', unit: '',
    default: 0.4, min: 0.1, max: 0.9, step: 0.05, status: 'verify', ref: 'D-57',
    note: 'The park-hold row uses the lower of this and the design μ.',
  },

  kneeMount: {
    label: 'Brake knees', group: 'brake', unit: '',
    default: KNEE_MOUNT.removable, min: 0, max: 1, step: 1, status: 'explore', ref: 'D-78',
    options: [
      { value: KNEE_MOUNT.fixed, label: 'Knees stay on (bolted, glued)' },
      { value: KNEE_MOUNT.removable, label: 'Removable knees (bolts, ratchet)' },
    ],
    note: 'D-78 (Eric): removable is the default (2026-10-19); fixed is the option. The same four 3/8 in bolts through the knee, rail and backer, nuts on the backing plate (bedded in its recess so it stays when the bolts come out). Removable: the knee is fitted DRY (no epoxy against the rail), finished on the bench and bolted on at the hang step, and a 3/8 in drive ratchet with a 9/16 in socket and a 9/16 in wrench rides in the storage box in cargo mode. Each knee, with its strap and flap, comes off in about 5 minutes (longer the first time). Nothing sticks out beside the tires in transport or cargo use. The chock stays tied to the eye on its knee and travels with it. The brake-mount row adds a wood-to-wood bolt check for the dry knee. Pins and clamped inserts were rejected (the 3 in lever loads the thin rail and rib).',
  },
  kneeBoltTightenLbIn: {
    label: 'Knee bolt tightening (removable knees)', group: 'brake', unit: 'lbf·in',
    default: 35, min: 30, max: 120, step: 5, status: 'assumed', ref: 'D-78',
    note: 'D-78: snug, then a quarter turn is the primary spec (about 0.016 in of travel through about 3-1/4 in of oak, roughly 25 to 40 lbf in, about 600 lbf of clamp); 35 lbf in is the check value. It keeps the 7/8 in narrow washer at about 0.6 of its wet crush onset (about 1,080 lbf); 60 lbf in with anti-seize sits right at the onset, and a hand ratchet easily gives 15 ft lb. Used in the knee, hang and refit steps and the Verify item. Check snug before each outing; retighten after the first; the stainless threads get anti-seize.',
  },
  toolPouchLengthIn: {
    label: 'Tool pouch length (ratchet, socket, wrench)', group: 'brake', unit: 'in',
    default: 9, min: 6, max: 14, step: 0.5, status: 'assumed', ref: 'D-78',
    note: 'D-78: a 3/8 in drive ratchet with a 9/16 in socket and a 9/16 in combination wrench, in a small pouch. About 9 x 3 x 2 in. It rides in the storage box in CARGO mode only (the knees come off at the truck or in the garage, not at the race); it is a tool, not sled mass.',
  },
  toolPouchWidthIn: {
    label: 'Tool pouch width', group: 'brake', unit: 'in',
    default: 3, min: 2, max: 6, step: 0.5, status: 'assumed', ref: 'D-78',
    note: 'D-78: see toolPouchLengthIn.',
  },
  toolPouchHeightIn: {
    label: 'Tool pouch height', group: 'brake', unit: 'in',
    default: 2, min: 1, max: 4, step: 0.5, status: 'assumed', ref: 'D-78',
    note: 'D-78: see toolPouchLengthIn.',
  },
  brakeChockCordLenIn: {
    label: 'Chock cord length', group: 'brake', unit: 'in',
    default: 30, min: 12, max: 72, step: 2, status: 'assumed', ref: 'D-57',
    note: 'Ties the chock to an eye on the knee so it is never lost, long enough to reach the other side of the tire when the sled faces uphill.',
  },

  parkRollingResistance: {
    label: 'Static rolling resistance of the sled (parking)', group: 'brake', unit: '',
    default: 0.02, min: 0, max: 0.08, step: 0.005, status: 'assumed', ref: 'D-57',
    note: 'Fraction of the sled weight that bearings and tire squash resist at standstill; credited in the park-hold row with the chock friction.',
  },

  brakeStopSlopeDeg: {
    label: 'Steepest grade the loaded sled must be STOPPED on by the flaps alone', group: 'brake', unit: '°',
    default: 10, min: 3, max: 15, step: 0.5, status: 'assumed', ref: 'D-57',
    note: 'D-57: the flaps SLOW the loaded sled on the 15° design slope and STOP it on gentler grades. brake-slow reports the steepest grade held at the foot-force limit and the fouled pad μ for each load case, and checks it against this.',
  },


  brakeSlowShareMin: {
    label: 'Share of the design-slope pull the flaps must take (SLOWS)', group: 'brake', unit: '',
    default: 0.5, min: 0.2, max: 1, step: 0.05, status: 'assumed', ref: 'D-57',
    note: 'D-57: the flaps must SLOW the loaded sled on the 15° design slope: at the limit foot force and the fouled pad they take at least this share of the downhill pull (the handler, the pullers and the chock do the rest).',
  },

  brakeFootHeightMaxIn: {
    label: 'Highest foot-area step above the ground', group: 'brake', unit: 'in',
    default: 12, min: 8, max: 16, step: 1, status: 'assumed', ref: 'D-57',
    note: 'The handler steps up onto the flap from behind the sled: a stair step is 7 in, a stool 12 in.',
  },

  brakeFootStrokeMaxIn: {
    label: 'Longest comfortable foot stroke', group: 'brake', unit: 'in',
    default: 1.5, min: 0.5, max: 3, step: 0.25, status: 'assumed', ref: 'D-57',
    note: 'The drop of the foot area from released to the pad on the tread (plus a little squash).',
  },

  brakeReturnLiftMargin: {
    label: 'Bungee lift over the weight of the flap group', group: 'brake', unit: '×',
    default: 1.5, min: 1, max: 4, step: 0.25, status: 'assumed', ref: 'D-57',
    note: 'The released bungee torque about the pivot pin over the weight torque of the flap, shoe block and pad: so a bump does not drop the pad onto the tread.',
  },

  brakeCordSafetyFactor: {
    label: 'Cord safety factor (on breaking strength)', group: 'brake', unit: '×',
    default: 5, min: 3, max: 10, step: 1, status: 'assumed', ref: 'D-57',
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
  railStepRunIn: {
    label: 'Rail step: length of the sloped cut', group: 'stock', unit: 'in',
    default: 1.5, min: 0.5, max: 4, step: 0.125, status: 'assumed', ref: 'D-56',
    note: 'D-56: where the rail drops to its shallow front depth, its bottom edge slopes up over this much length and ends at railStepX (1 in short of the axle-beam swath). At the defaults the rise is 1.135 in, so 1-1/2 in of run is a 37 degree slope, not 45 (a 45 degree cut would start 3/8 in later and shorten the deep rail by that much; nothing needs it). A gentle slope is easier to bandsaw and leaves no sharp inside corner. The notes and drawings read the angle from this and the rise.',
  },
  crossmemberDepthIn: {
    label: 'Crossmember / deck joist depth', group: 'stock', unit: 'in',
    default: 1.75, min: 0.75, max: 3.5, step: 0.125, status: 'explore',
  },
  crossmemberThickIn: {
    label: 'Crossmember / deck joist thickness', group: 'stock', unit: 'in',
    default: 0.625, min: 0.5, max: 1.5, step: 0.0625, status: 'explore', ref: 'D-60',
    note: 'D-60: 5/8 in (was 3/4 in); the joists row goes from 0.54 to about 0.65 and the resting capacity from 359 to about 350 lb.',
  },
  sideThicknessIn: {
    label: 'Side thickness (the sandwich: two oak bands + the thin web)', group: 'stock', unit: 'in',
    default: 0.625, min: 0.375, max: 1, step: 0.0625, status: 'explore', ref: 'D-35, D-43, D-62',
    note: 'D-62: the side is a sandwich, an oak band on each face of the web, D-73, D-80: the bands are (this - the thin sheet in effect) / 2: 0.195 in with the 0.236 in (6 mm) Baltic birch or okoume, 0.2075 in with the 0.21 in white oak plywood, 0.2535 in with the 3 mm Baltic birch. The deck edge rises into the gap under the inner chine band (depth = the band thickness); the transoms have their own thickness.',
  },
  axleBeamThicknessIn: {
    label: 'Rear axle beam width (fore-aft)', group: 'stock', unit: 'in',
    default: 2.25, min: 1.5, max: 4, step: 0.125, status: 'explore', ref: 'D-60',
    note: 'D-60: 2-1/4 in (was 2-1/2 in); beam-rear stays about 0.19. D-74: left at 2-1/4 in on purpose: this is the rip width of the boards (the lamination is across the depth), and 2-1/8 in leaves 0.69 in of wood each side of the rod groove, under the 0.75 in beamLigamentMinIn.',
  },
  frontBeamThicknessIn: {
    label: 'Front axle beam width (fore-aft)', group: 'stock', unit: 'in',
    default: 2.5, min: 1.5, max: 4, step: 0.125, status: 'explore', ref: 'D-56, D-58',
    note: 'The pivoting front beam (the rear beam is axleBeamThicknessIn). It sets the swing of the beam under the rails and the room for the tongue bolts. D-58: 2 1/2 in is enough for the 200 lb cargo bump (2 3/4 in was needed at 250 lb).',
  },
  axleBeamDepthIn: {
    label: 'Axle beam depth (vertical)', group: 'stock', unit: 'in',
    default: 2.125, min: 1.5, max: 4, step: 0.125, status: 'explore', ref: 'D-54, D-74',
    note: 'D-74: 2-1/8 in = 3 layers of 3/4 in (4/4) face-laminated, less the 1/8 in cleanup. Before: 2.25 in (was 2.5): with the 10 in rear wheels the underslung beam bottom is at 5.375 - 2.25 = 3.1 in, above the 3 in ground clearance.',
  },
  deckPlyIn: {
    label: 'Deck plywood thickness', group: 'stock', unit: 'in',
    default: 0.472, min: 0.236, max: 0.709, step: 0.001, status: 'explore', ref: 'D-62',
    note: 'Okoume marine ply, 12 mm (1/2 in), a full 4 x 8 sheet from a local supplier (Eric, 2026-10-12, D-68). Fallback: 12 mm Baltic birch (about 3 to 4 lb heavier, epoxy-seal every face and edge).',
    options: [
      { value: 0.236, label: '6 mm' },
      { value: 0.354, label: '9 mm' },
      { value: 0.472, label: '12 mm' },
      { value: 0.709, label: '18 mm' },
    ],
  },
  panelPlyIn: {
    label: 'Thin sheet when okoume (sides / box / lid / signs)', group: 'stock', unit: 'in',
    default: 0.236, min: 0.157, max: 0.472, step: 0.001, status: 'explore', ref: 'D-60, D-73, D-80',
    options: [
      { value: 0.157, label: '4 mm' },
      { value: 0.236, label: '6 mm' },
      { value: 0.354, label: '9 mm' },
      { value: 0.472, label: '12 mm' },
    ],
    note: 'D-80: 6 mm (0.236 in) okoume BS 1088, the Extreme spec thin sheet (the 4 mm sheet failed the side-web row, 2.0). This is the thickness of the okoume option of thinSheetMaterial only; the effective thin-sheet thickness (thinSheet(p).thicknessIn) follows the material (6 mm Baltic birch 0.236 in, white oak plywood 0.21 in, 3 mm Baltic birch 0.118 in) and is what the model reads. The dado and edge-banding widths follow it, and the sandwich bands of the sides are (side thickness - this) / 2 thick each (D-62). The seat-back panel has its own size (seatBackPlyIn, 12 mm from the deck offcut, D-62). Keep the lid engraved DO NOT STEP (D-58).',
  },
  seatBackPlyIn: {
    label: 'Seat-back panel plywood', group: 'stock', unit: 'in',
    default: 0.472, min: 0.157, max: 0.472, step: 0.001, status: 'explore', ref: 'D-60, D-62',
    note: 'Eric 2026-10-12: frameless 1/2 in (12 mm) okoume, cut from the offcut of the deck sheet (the 12 mm sheet from a local supplier, D-68), so no 6 mm sheet is bought at all. The panel IS the seat back (the oak stiles and rails are gone); the seat-back row checks the bare panel: bending as a strip above the crest line, deflection, the hinge inserts and the pin holes in ply. D-60 had it at 6 mm in an oak frame (the row was 0.53 at 6 mm and 1.09 at 4 mm).',
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
    note: 'Added to the THICKNESS of every rough oak piece (planing allowance). Width and length have their own allowances (roughWidthAllowanceIn, roughLengthAllowanceIn; laminate pieces: laminateWidthAllowanceIn, laminateLengthAllowanceIn).',
  },
  boardYield44In: {
    label: 'Reliable finished thickness of 4/4 stock', group: 'stock', unit: 'in',
    default: 0.75, min: 0.5, max: 4, step: 0.0625, status: 'assumed',
    note: 'Eric 2026-10-13: the FINISHED thickness a 4/4 white oak board reliably gives after jointing and planing both faces ("4/4 stock is often actually closer to 3/4"). A solid part is bought from the thinnest stocked board whose finished thickness is at least the part\'s FINAL thickness, and a face-laminated layer is planed to at most this (rounded down to 1/16). The resaw math keeps the board\'s rough thickness (this plus millingAllowanceIn).',
  },
  boardYield54In: {
    label: 'Reliable finished thickness of 5/4 stock', group: 'stock', unit: 'in',
    default: 1, min: 0.5, max: 4, step: 0.0625, status: 'assumed',
    note: 'Eric 2026-10-13: the FINISHED thickness a 5/4 white oak board reliably gives after jointing and planing both faces ("4/4 stock is often actually closer to 3/4"). A solid part is bought from the thinnest stocked board whose finished thickness is at least the part\'s FINAL thickness, and a face-laminated layer is planed to at most this (rounded down to 1/16). The resaw math keeps the board\'s rough thickness (this plus millingAllowanceIn).',
  },
  boardYield64In: {
    label: 'Reliable finished thickness of 6/4 stock', group: 'stock', unit: 'in',
    default: 1.25, min: 0.5, max: 4, step: 0.0625, status: 'assumed',
    note: 'Eric 2026-10-13: the FINISHED thickness a 6/4 white oak board reliably gives after jointing and planing both faces ("4/4 stock is often actually closer to 3/4"). A solid part is bought from the thinnest stocked board whose finished thickness is at least the part\'s FINAL thickness, and a face-laminated layer is planed to at most this (rounded down to 1/16). The resaw math keeps the board\'s rough thickness (this plus millingAllowanceIn).',
  },
  boardYield84In: {
    label: 'Reliable finished thickness of 8/4 stock', group: 'stock', unit: 'in',
    default: 1.75, min: 0.5, max: 4, step: 0.0625, status: 'assumed',
    note: 'Eric 2026-10-13: the FINISHED thickness a 8/4 white oak board reliably gives after jointing and planing both faces ("4/4 stock is often actually closer to 3/4"). A solid part is bought from the thinnest stocked board whose finished thickness is at least the part\'s FINAL thickness, and a face-laminated layer is planed to at most this (rounded down to 1/16). The resaw math keeps the board\'s rough thickness (this plus millingAllowanceIn).',
  },
  boardYield124In: {
    label: 'Reliable finished thickness of 12/4 stock', group: 'stock', unit: 'in',
    default: 2.75, min: 0.5, max: 4, step: 0.0625, status: 'assumed',
    note: 'Eric 2026-10-13: the FINISHED thickness a 12/4 white oak board reliably gives after jointing and planing both faces ("4/4 stock is often actually closer to 3/4"). A solid part is bought from the thinnest stocked board whose finished thickness is at least the part\'s FINAL thickness, and a face-laminated layer is planed to at most this (rounded down to 1/16). The resaw math keeps the board\'s rough thickness (this plus millingAllowanceIn). 12/4 is not stocked (D-70): the parts that would need it are face-laminated.',
  },
  boardYield164In: {
    label: 'Reliable finished thickness of 16/4 stock', group: 'stock', unit: 'in',
    default: 3.75, min: 0.5, max: 4, step: 0.0625, status: 'assumed',
    note: 'Eric 2026-10-13: the FINISHED thickness a 16/4 white oak board reliably gives after jointing and planing both faces ("4/4 stock is often actually closer to 3/4"). A solid part is bought from the thinnest stocked board whose finished thickness is at least the part\'s FINAL thickness, and a face-laminated layer is planed to at most this (rounded down to 1/16). The resaw math keeps the board\'s rough thickness (this plus millingAllowanceIn). 16/4 is a special order; only the brake shoe and chock blocks ever asked for it.',
  },
  laminationCleanupIn: {
    label: 'Face-lamination cleanup allowance', group: 'stock', unit: 'in',
    default: 0.125, min: 0, max: 0.5, step: 0.0625, status: 'assumed',
    note: 'Eric 2026-10-13: after the layers are glued face to face the block is jointed and planed flat and square, which takes this much off its thickness. Every layer is already planed to a reliable board thickness, so the layers\' sum minus this must still be at least the part\'s final thickness. It replaces millingAllowanceIn for a glued block.',
  },
  roughWidthAllowanceIn: {
    label: 'Rough-stock width allowance (plain solid parts)', group: 'stock', unit: 'in',
    default: 0.25, min: 0.125, max: 0.75, step: 0.0625, status: 'assumed',
    note: 'Eric 2026-10-12: a plain solid part is cut this much wider than its finished width (was the 1/8 in milling allowance), so there is room to joint one edge and plane to width. Rough sizes are rounded UP to the next 1/8 in for the cut list.',
  },
  roughLengthAllowanceIn: {
    label: 'Rough-stock length allowance (plain solid parts)', group: 'stock', unit: 'in',
    default: 1, min: 0.5, max: 3, step: 0.125, status: 'assumed',
    note: 'Eric 2026-10-12: a plain solid part is cut 1 in longer than its finished length (was 4 x the milling allowance = 1/2 in): room to square both ends and to cut around checking.',
  },
  laminateWidthAllowanceIn: {
    label: 'Rough-stock width allowance (laminated / edge-glued / bent pieces)', group: 'stock', unit: 'in',
    default: 0.375, min: 0.25, max: 1, step: 0.0625, status: 'assumed',
    note: 'Eric 2026-10-12: a piece that is face-laminated (D-70 layers), edge-glued (the panel boards) or bent-laminated (the resaw strips for the rails and bands) is cut 3/8 in wider than its share of the finished width. Glued pieces end up slightly askew and have to be jointed and planed true after the glue-up; 1/8 in was too little. Rounded UP to the next 1/8 in for the cut list.',
  },
  laminateLengthAllowanceIn: {
    label: 'Rough-stock length allowance (laminated / edge-glued / bent pieces)', group: 'stock', unit: 'in',
    default: 2, min: 1, max: 4, step: 0.25, status: 'assumed',
    note: 'Eric 2026-10-12: laminated, edge-glued and bent pieces are cut 2 in longer than finished (1 in a plain part): glued layers slip lengthwise, the ends of a glue-up are crushed or starved of glue, and a bent strip is trimmed to the measured length (S1).',
  },
  bandsawResawCapacityIn: {
    label: 'Bandsaw resaw capacity (height)', group: 'stock', unit: 'in',
    default: 6, min: 4, max: 20, step: 0.5, status: 'locked',
    note: "Eric's bandsaw, 6 in (2026-10-12). Every resaw height must be at most this. The strips are RIPPED FIRST, so the resaw height is the strip width (a rail strip is about 1-5/8 in), never the width of the board it came from: a 9 in board is ripped into lanes on the table saw, then each lane goes through the bandsaw on edge.",
  },
  oakWasteAllowance: {
    label: 'Oak waste allowance (board feet)', group: 'stock', unit: '×',
    default: 0.3, min: 0, max: 1, step: 0.05, status: 'assumed',
    note: 'Phase 4 (cut list, BOM): the rough-volume board feet are multiplied by (1 + this) to cover knots, checks, sapwood, snipe and the offcuts a cut plan cannot use. 30 % is typical for hand-selected rough white oak.',
  },
  resawKerfIn: {
    label: 'Saw kerf (resaw, rip and crosscut)', group: 'stock', unit: 'in',
    default: 0.125, min: 0.0625, max: 0.25, step: 0.03125, status: 'assumed',
    note: 'Phase 4: the material lost to each bandsaw resaw cut (and, in the board cut plan, to each rip and crosscut). 1/8 in is a 3/8 in resaw blade with some wander; a thin-kerf 1/16 in blade yields more laminate strips per board.',
  },
  nestKerfIn: {
    label: 'Plywood nesting gap between parts and from the sheet edge', group: 'stock', unit: 'in',
    default: 0.25, min: 0, max: 1, step: 0.0625, status: 'assumed',
    note: 'Phase 4: clear space left between nested plywood parts, and between a part and the sheet edge, for the Shaper Origin bit (1/8 in cutter), the tape and a little drift.',
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
  oakMoePerpPsi: {
    label: 'White oak modulus of elasticity across the grain (tangential)', group: 'materials', unit: 'psi',
    default: 140000, min: 80000, max: 300000, step: 5000, status: 'assumed', ref: 'D-76',
    note: 'D-76 (side-stiffness study): about 0.08 of the along-grain E (Wood Handbook E_T / E_L for white oak). The chine and gunwale bands bend across their grain when the side is pushed in or out.',
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
    note: 'A curb strike is a transient impact; the 3× dynamic factor is already in the load. NDS 10.3.2 caps C_D at 1.6 for connections, so 1.6 is used and no more. It also applies to the brake λ = 2 stomp or jerk impact in the dry (removable) knee check (D-78); the sustained hold (λ = 1) is checked with C_D 1.0.',
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
    note: 'D-73: this species covers the 12 mm deck and seat-back sheet only; the thin sheet (webs, box, lid, signs) is chosen by thinSheetMaterial. MATERIALS AND SOURCES (Eric, 2026-10-12): the deck and seat back are 12 mm (1/2 in) okoume marine plywood (BS 1088), one FULL 4 x 8 ft sheet from a local supplier (D-68); the thin sheet is 6 mm (D-80). Each side web is one piece. FALLBACK if no okoume: Baltic birch 12 mm for the deck (about 3 to 4 lb heavier at the deck alone; every cut edge and face must be epoxy-sealed, it is exterior-glue only, not marine). Solid parts are white oak: the lumber yard stocks 4/4 to 12/4 rough, so resaw and plane to the finished thickness (the stock/rough columns of the cut list already assume this). FINISHING STACK: Standard is clear (no stain, no conditioner: exterior spar urethane over the bare wood, with an epoxy coat on the edges, end grain and deck underside only); Extreme keeps its stain or gel stain, the epoxy saturation coat and marine spar varnish (D-83).',
  },
  weatherSpec: {
    label: 'Weather spec', group: 'materials', unit: '',
    default: WEATHER_SPEC.standard, min: 0, max: 1, step: 1, status: 'explore', ref: 'D-73',
    options: [
      { value: WEATHER_SPEC.standard, label: 'Standard (garage-kept)' },
      { value: WEATHER_SPEC.extreme, label: 'Extreme weather' },
    ],
    note: 'D-73. Standard: garage-kept, used a few times a year, gets wet at most at a rainy derby (Eric, 2026-10-12). Extreme weather: stored outside or near salt. The model reads this for the thin-sheet material ("follow the weather setting": Standard is 6 mm Baltic birch, Extreme is 6 mm okoume marine, D-80), for the drains (Standard: drilled 3/8 in holes with an epoxy-lined bore; Extreme: stainless nipples, D-83). The fasteners, glue and finish that follow the weather spec are chosen in the BOM and finishing schedule: Standard is clear (no stain, urethane); Extreme keeps its stain, epoxy saturation coat and marine varnish (D-83).',
  },
  thinSheetMaterial: {
    label: 'Thin-sheet material (webs, box, lid, signs)', group: 'materials', unit: '',
    default: THIN_SHEET.followWeather, min: 0, max: 4, step: 1, status: 'explore', ref: 'D-73, D-80',
    options: [
      { value: THIN_SHEET.followWeather, label: 'Follow the weather setting' },
      { value: THIN_SHEET.whiteOakPly, label: '1/4" white oak plywood' },
      { value: THIN_SHEET.okoumeMarine, label: '6 mm okoume marine' },
      { value: THIN_SHEET.balticBirch3mm, label: '1/8" (3 mm) Baltic birch' },
      { value: THIN_SHEET.balticBirch6mm, label: '6 mm (1/4") Baltic birch' },
    ],
    note: 'D-73, D-80: the sheet for the side webs, the storage box, its lid and the signs. The dado widths, the sandwich band thickness ((side - web) / 2), the box and lid panels, the sign blanks, the masses, the web and lid rows, the nesting sheet and the cut list all follow it. The 12 mm deck and seat back stay marine okoume. Follow the weather: Standard is 6 mm (1/4 in) Baltic birch (4 x 8, interior glue probably, garage-kept and sealed: ask), Extreme is 6 mm okoume BS 1088. Other choices: 1/4 in white oak plywood (about 0.21 in real, interior glue), 3 mm Baltic birch (0.118 in, 5 x 5 ft sheet).',
  },
  whiteOakPlyThickIn: {
    label: '1/4" white oak plywood real thickness', group: 'materials', unit: 'in',
    default: 0.21, min: 0.15, max: 0.26, step: 0.005, status: 'verify', ref: 'D-73',
    note: 'D-73: nominal 1/4 in hardwood plywood runs about 5.3 mm (0.21 in). MEASURE THE SHEET with calipers before cutting a dado (verify item).',
  },
  whiteOakPlyDensityPcf: {
    label: 'White oak plywood density', group: 'materials', unit: 'lb/ft³',
    default: 40, min: 30, max: 50, step: 0.5, status: 'assumed', ref: 'D-73',
    note: 'D-73: about 40 pcf, assumed for a hardwood-veneer core (a poplar or lauan core would be lighter, an all-hardwood core heavier; the core varies by mill).',
  },
  whiteOakPlyMoePsi: {
    label: 'White oak plywood effective E (face grain ∥ span)', group: 'materials', unit: 'psi',
    default: 1100000, min: 600000, max: 1600000, step: 10000, status: 'assumed', ref: 'D-73',
    note: 'D-73 ESTIMATE, not a published value for the sheet: between the okoume (0.9 Msi) and Baltic birch (1.3 Msi) values of D-5, since a 3-ply hardwood sheet has two face veneers of oak. Ask the supplier for the construction (plies, core) and replace.',
  },
  whiteOakPlyMorPsi: {
    label: 'White oak plywood effective MOR (face grain ∥ span)', group: 'materials', unit: 'psi',
    default: 5500, min: 3000, max: 8000, step: 100, status: 'assumed', ref: 'D-73',
    note: 'D-73 ESTIMATE, between the okoume (5,000) and Baltic birch (7,000) values of D-5; same caveat as the E.',
  },
  whiteOakPlyMoePerpPsi: {
    label: 'White oak plywood effective E (across the face grain)', group: 'materials', unit: 'psi',
    default: 500000, min: 150000, max: 900000, step: 10000, status: 'assumed', ref: 'D-76',
    note: 'D-76 ESTIMATE (side-stiffness study): 1/4 in hardwood plywood is usually 3 plies with thin oak faces and a thick cross-banded core, so bending ACROSS the face grain runs along the core grain: about 0.5 Msi. With equal plies it could be 0.25 Msi. The side webs\' face grain runs along x, so every vertical bending of a web (the side-web row, the side-lateral strips) is across it. Ask the supplier for the construction and replace.',
  },
  whiteOakPlyMorPerpPsi: {
    label: 'White oak plywood effective MOR (across the face grain)', group: 'materials', unit: 'psi',
    default: 2750, min: 1000, max: 5500, step: 50, status: 'assumed', ref: 'D-76',
    note: 'D-76 ESTIMATE (side-stiffness study): half the along-grain value (design 1,170 psi after the wet-service and safety factors), for the thick cross-banded core. Same caveat as the E.',
  },
  balticThinThickIn: {
    label: '1/8" (3 mm) Baltic birch real thickness', group: 'materials', unit: 'in',
    default: 0.118, min: 0.1, max: 0.14, step: 0.001, status: 'verify', ref: 'D-73',
    note: 'D-73: 3 mm (0.118 in). Its density, E and MOR are the Baltic birch values above (birchDensityPcf 42, birchMoePsi, birchMorPsi). The sheet is probably 5 x 5 ft (60 x 60 in): every part must nest on it (the side web blank is about 59.6 in).',
  },
  balticThinMoePerpPsi: {
    label: '3 mm Baltic birch effective E (across the face grain)', group: 'materials', unit: 'psi',
    default: 80000, min: 40000, max: 400000, step: 5000, status: 'assumed', ref: 'D-76',
    note: 'D-76: 3 equal plies, so across the face grain only the thin core runs the right way. Metsä Wood\'s declared values for 4 mm 3-ply birch give E across / along = 1,029 / 16,471 N/mm² = 0.063: 0.063 x 1.3 Msi = 80,000 psi.',
  },
  balticThinMorPerpPsi: {
    label: '3 mm Baltic birch effective MOR (across the face grain)', group: 'materials', unit: 'psi',
    default: 1100, min: 500, max: 3500, step: 50, status: 'assumed', ref: 'D-76',
    note: 'D-76: Metsä Wood\'s declared 4 mm 3-ply birch bending strength across / along = 10.6 / 65.9 N/mm² = 0.16: 0.16 x 7,000 psi = 1,100 psi.',
  },
  balticSixThickIn: {
    label: '6 mm (1/4") Baltic birch real thickness', group: 'materials', unit: 'in',
    default: 0.236, min: 0.2, max: 0.27, step: 0.001, status: 'verify', ref: 'D-80',
    note: 'D-80: 6 mm (0.236 in); 6.5 mm sheets (0.256 in) are sold too. MEASURE THE SHEET with calipers before cutting a dado. Density, along-grain E and MOR are the Baltic birch values (birchDensityPcf, birchMoePsi, birchMorPsi).',
  },
  balticSixMoePerpPsi: {
    label: '6 mm Baltic birch effective E (across the face grain)', group: 'materials', unit: 'psi',
    default: 486000, min: 100000, max: 900000, step: 5000, status: 'assumed', ref: 'D-80',
    note: 'D-80: Metsä Wood declared values for 6.5 mm 5-ply birch give bending E across / along = 4,763 / 12,737 N/mm² = 0.374: 0.374 x 1.3 Msi = 486,000 psi.',
  },
  balticSixMorPerpPsi: {
    label: '6 mm Baltic birch effective MOR (across the face grain)', group: 'materials', unit: 'psi',
    default: 3990, min: 1000, max: 7000, step: 50, status: 'assumed', ref: 'D-80',
    note: 'D-80: Metsä Wood declared strength across / along = 29.0 / 50.9 N/mm² = 0.57 for 6.5 mm 5-ply birch: 0.57 x 7,000 psi = 3,990 psi.',
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
  okoumeMoePerpPsi: {
    label: '6 mm okoume effective E (across the face grain)', group: 'materials', unit: 'psi',
    default: 315000, min: 60000, max: 500000, step: 5000, status: 'assumed', ref: 'D-76, D-80',
    note: 'D-80: 6 mm BS 1088 okoume is 5-ply (Joubert). Bellotti\'s EN 310 data for 6 mm give cross / long E of 3,770 / 4,650 N/mm²; this value takes 0.35 of the along-grain D-5 value (900,000 psi), conservative against that 0.81. Ask the supplier for the sheet\'s data. (D-76 had 150,000 psi for the 4 mm, 3-ply sheet.)',
  },
  okoumeMorPerpPsi: {
    label: '6 mm okoume effective MOR (across the face grain)', group: 'materials', unit: 'psi',
    default: 3000, min: 600, max: 3500, step: 50, status: 'assumed', ref: 'D-76, D-80',
    note: 'D-80: Bellotti\'s EN 310 data for 6 mm BS 1088 give cross / long strength of 32 / 35 N/mm²; this value takes 0.6 of the along-grain D-5 value (5,000 psi), conservative against that 0.91. (D-76 had 1,500 psi for the 4 mm, 3-ply sheet.)',
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
    default: 35, min: 25, max: 60, step: 1, status: 'locked', ref: 'D-67',
    note: 'Tilt-table angle: the static sideways tilt at which the uphill wheels lift (tan θ ≈ the sideways g the loaded sled resists). Eric 2026-10-12: 35° straight ahead, the same as the full-lock limit, for a low passenger sled at walking pace (was 40°, set when the design expected higher speeds); riding-equipment practice is roughly 30°.',
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
  standDeflectionRatio: {
    label: 'Standing-adult static deflection limit L/n (deck ply between joists)', group: 'factors', unit: 'n',
    default: 240, min: 100, max: 400, step: 10, status: 'assumed', ref: 'D-58',
    note: 'Eric: a tad looser for a standing adult (span/240 vs the general span/300; the extra joist alone already holds 289 lb at span/300). A person on one foot at rest is an occasional static load, not a rider\'s repeated one; the other beams keep the general limit (deflectionLimitRatio). Used by the deck row (standing scout) and the resting-weight row.',
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
    note: 'PRE-ORDER GATE (eng 3c review, D-62): the design passes only if the real rate is below about 560 lb/in with the load forward (about 800 for the rider cases); the first row to flip is the front beam groove wall under a hard hit, then the rear beam seat, the groove bearing and the king bearing. TEST BEFORE ORDERING the lot: tire at 30 psi, a known weight over one wheel, a ruler: a squash of 0.55 in or more at 300 lb is a pass (everything holds as built); 0.4 to 0.55 in means lengthen the outer front clamp plate; under 0.4 in, stop and re-run the analysis with the measured k. Flat-free or foam-filled wheels change this rate by a factor of several and are NOT modeled by the tire-type switch. Phase 3c-3b: a 10" x 3.5" pneumatic hand-truck tire (4.10/3.50-4, rated about 300 lb at 30 psi) squashes about 0.6" (18% of the 3.25" section) at its rating, so k is about 300 / 0.6 = 500 lb/in; it scales with inflation pressure and runs 300 (20 psi) to 900 (rim-bound). TO MEASURE: stand a known weight on the sled at one wheel (a 150 lb person on the frame over the wheel) and measure the tire squash with a ruler against the hub; k = load / squash.',
  },
  bumpMassShare: {
    label: 'Rigid-body bump mass multiplier', group: 'bump', unit: '×',
    default: 1, min: 0.5, max: 2, step: 0.05, status: 'assumed', ref: 'D-54',
    note: 'Phase 3c-3b: the effective mass at the struck wheel is the rigid-body corner mass of the whole sled, W / (1 + x²/ky² + y²/kx²), about W/7 for a uniform sled struck at a corner (a rigid sled pivots about its other contacts). This multiplier scales it: 1 = mass spread like a plate over the wheel footprint; above 1 = heavy ends (cargo piled at the wheels); below 1 = mass bunched at the middle. Before 3c-3b this was 1.5 x the wheel static load.',
  },
  bumpDlfCheck: {
    label: 'Conventional dynamic factor (cross-check only)', group: 'bump', unit: '×',
    default: 3, min: 1.5, max: 5, step: 0.25, status: 'assumed', ref: 'D-54',
    note: 'Textbook dynamic wheel-load factor for a hand cart at walking pace, 2 to 3 (D-55). Every bump row quotes the pulse against this × the static wheel load; the checks are NOT capped to it (a square 1" step at jogging pace is physically above it).',
  },
  failSafeFactor: {
    label: 'Fail-safe factor on ultimate (hard hit)', group: 'factors', unit: '×',
    default: 1.25, min: 1, max: 2, step: 0.05, status: 'assumed', ref: 'D-54',
    note: 'Orchestrator decision: hard-hit rows compare to ultimate / this (1.25).',
  },

  // ── Phase 3b WS-D: material strengths and detail sizes for the front-end rows (analysis/front-end.ts, linkage.ts). Hard-hit rows use the ultimate values. ──
  axleUltimatePsi: {
    label: 'Axle steel ultimate strength', group: 'factors', unit: 'psi',
    default: 85000, min: 45000, max: 140000, step: 1000, status: 'verify', ref: 'D-54, D-71',
    note: 'Companion of axleYieldPsi (1045 cold-finished ~ 91 ksi nominal; 85 ksi assumed). Hard-hit rear axle row.',
  },
  axleTubeUltimatePsi: {
    label: 'Axle tube ultimate strength (DOM)', group: 'factors', unit: 'psi',
    default: 80000, min: 45000, max: 140000, step: 1000, status: 'verify', ref: 'D-60',
    note: 'Used only with a hollow tube (axleWallIn above 0); with the default solid rod (D-71) the checklist does not ask for it. D-60: companion of axleTubeYieldPsi (1026 DOM about 80 ksi tensile minimum): the hard-hit rows use it with the fail-safe factor. Confirm on the vendor listing.',
  },
  ss316BoltYieldPsi: {
    label: '316 stainless bolt yield (cold-worked F593)', group: 'factors', unit: 'psi',
    default: 65000, min: 30000, max: 100000, step: 1000, status: 'assumed', ref: 'D-43, D-54',
    note: 'ASTM F593 condition CW, 65 ksi min yield for 3/8 in and under. Allowable tension = yield / steel safety factor. (Was kingpinCrossBoltYieldPsi.)',
  },
  lashBoltYieldPsi: {
    label: 'D-ring bolt yield (1/4-20 stainless button-head bolt)', group: 'factors', unit: 'psi',
    default: 30000, min: 20000, max: 65000, step: 1000, status: 'assumed', ref: 'D-76',
    note: 'D-76, D-83: the two 1/4-20 button-head bolts of each D-ring; stainless machine screws and bolts carry no F593 certification, so the lash-load row uses the annealed 18-8 / 316 minimum yield (30 ksi, the floor), not the 65 ksi of a cold-worked F593 bolt. Allowable = yield / the steel safety factor.',
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
  const stopRear = p.seatXIn + p.riderLegReachIn;
  return [stopRear - 0.14 * p.riderStatureIn, stopRear];
}

/**
 * The bow end (D-57): the deck runs flat to `xFlatEnd`, where the oak bow bulkhead stands (its rear face is the rider's foot brace) and runs on to the bow tip `xTip`.
 * Plain numbers so the validator, the layout and the model agree. (D-54's bent-lamination curl is gone; `bowCurl` keeps the old name for the front-axle geometry.)
 */
export function bowBulkhead(p: Params) {
  const thick = p.bowBulkheadThickIn;
  const xTip = p.wheelbaseIn + p.frontOverhangIn;
  return { thick, xTip, xFlatEnd: xTip - thick };
}
export const bowCurl = bowBulkhead;

/** Height above the deck top of the sheer line at x: from `sideHeightRearIn` at the rear transom's inner face down to `sideHeightBowIn` at `xEnd`, sagging `sheerCurveIn` below the straight line at mid-length (D-57). */
export function sideHeightAt(p: Params, x: number, xRearFace: number, xEnd: number): number {
  const u = Math.max(0, Math.min(1, (x - xRearFace) / Math.max(1e-6, xEnd - xRearFace)));
  return p.sideHeightRearIn + (p.sideHeightBowIn - p.sideHeightRearIn) * u - 4 * p.sheerCurveIn * u * (1 - u);
}

/** The smootherstep 6u^5 - 15u^4 + 10u^3: 0 at u = 0, 1 at u = 1, and its first AND second derivatives vanish at both ends (so the side is curvature-continuous where it leaves the straight and where it meets the bow run). */
export const smootherstep = (u: number): number => { const t = Math.max(0, Math.min(1, u)); return t * t * t * (t * (6 * t - 15) + 10); };
/** The largest |d2/du2| of `smootherstep` (at u = 0.2113): 10 / sqrt(3). The tightest plan bend of the taper is this times turn-in / length^2. */
export const SMOOTHERSTEP_MAX_CURVATURE = 10 / Math.sqrt(3);

export interface BowTaper {
  /** Start x (full width behind it), the x where the taper reaches the bow width (parallel sides to the bulkhead after it), and the turn-in per side at the bow. */
  x0: number;
  x1: number;
  turnIn: number;
  /** Tightest plan radius of the S (in); Infinity when there is no taper. */
  minRadiusIn: number;
  /** True when the turn-in is enough to clear the swinging front tires everywhere (the taper was shortened as far as needed). */
  clears: boolean;
}

/**
 * The inner face of the front tire, as a plan line swept through the whole lock range (D-66): for each steering angle the face is a segment of length 2r at distance `inner` from the
 * wheel plane's center, rotated about the kingpin at (kingX, 0). Returns y(x) = the smallest |y| the tire inner face reaches at x over every angle in [-lock, lock] (Infinity where no
 * angle puts tire at x). The tire is treated as a plan rectangle at full radius (A-4, conservative).
 */
export function tireSweepInnerEdge(p: Pick<Params, 'wheelDiameterIn' | 'wheelbaseIn' | 'frontTrackIn' | 'tireWidthIn' | 'steerLockDeg'>): (x: number) => number {
  const DEG = Math.PI / 180;
  const lock = p.steerLockDeg * DEG;
  const r = p.wheelDiameterIn / 2;
  const kingX = p.wheelbaseIn;
  const inner = p.frontTrackIn / 2 - p.tireWidthIn / 2;
  const N = 80;
  return (x: number): number => {
    let m = Infinity;
    for (let i = 0; i <= N; i++) {
      const a = -lock + (2 * lock * i) / N;
      const c = Math.cos(a), sn = Math.sin(a);
      const u = (x - kingX + inner * sn) / c;
      if (u < -r - 1e-9 || u > r + 1e-9) continue;
      m = Math.min(m, Math.abs(u * sn + inner * c));
    }
    return m;
  };
}

/** The x values to test the tire sweep at: a fine grid over the whole swing plus the exact rear-most corner of the tire at every angle (the inner face starts abruptly there, so a plain grid can step over the worst point). */
export function tireSweepXs(p: Pick<Params, 'wheelDiameterIn' | 'wheelbaseIn' | 'frontTrackIn' | 'tireWidthIn' | 'steerLockDeg'>, step = 0.1): number[] {
  const DEG = Math.PI / 180;
  const lock = p.steerLockDeg * DEG, r = p.wheelDiameterIn / 2, kingX = p.wheelbaseIn, inner = p.frontTrackIn / 2 - p.tireWidthIn / 2;
  const lo = kingX - r - inner, hi = kingX + r + inner;
  const xs: number[] = [];
  for (let x = lo; x <= hi + 1e-9; x += step) xs.push(x);
  for (const a of [-lock, lock]) for (const u of [-r, r]) { const x = kingX + u * Math.cos(a) - inner * Math.sin(a); xs.push(x, x + 1e-6, x - 1e-6); }
  return xs;
}

const taperCache = new Map<string, BowTaper>();

/**
 * The bow taper (D-66), DERIVED from the swing of the front wheels. The hull's outer half width goes from `bodyWidthIn / 2` at `bowTaperStartIn` to `bowWidthIn / 2` at the bow bulkhead in one
 * smootherstep S (curvature-continuous, no kink), and is parallel after it reaches the bow width. Where the S ends is the free choice: ending it LATER makes it gentler but the body is wider
 * where the front tire's inner rear corner sweeps in at full lock. So `x1` is the LATEST end (capped at the bulkhead) that still leaves the tire `steerClearIn + bowTaperSlackIn` off the
 * body over the whole +-lock sweep (bisection on the real tire sweep). If even the shortest S cannot clear, `clears` is false and `validateParams` says to narrow the bow.
 */
export function bowTaper(p: Params): BowTaper {
  const key = [p.bodyWidthIn, p.bowWidthIn, p.bowTaperStartIn, p.bowTaperSlackIn, p.frontTrackIn, p.tireWidthIn, p.wheelDiameterIn, p.wheelbaseIn, p.steerLockDeg, p.steerClearIn, p.frontOverhangIn, p.bowBulkheadThickIn].join('|');
  const hit = taperCache.get(key);
  if (hit) return hit;
  const xBulk = bowBulkhead(p).xFlatEnd;
  const bodyHalf = p.bodyWidthIn / 2;
  const turn = Math.max(0, (p.bodyWidthIn - p.bowWidthIn) / 2);
  const x0 = Math.min(p.bowTaperStartIn, xBulk - 1);
  let out: BowTaper;
  if (turn < 1e-9) {
    out = { x0, x1: xBulk, turnIn: 0, minRadiusIn: Infinity, clears: true };
  } else {
    const edge = tireSweepInnerEdge(p);
    const need = p.steerClearIn + p.bowTaperSlackIn;
    // Required turn-in at x: how far the body must have drawn in so the tire face (the nearest approach over the sweep) is `need` away.
    const req: [number, number][] = [];
    for (const x of tireSweepXs(p)) { if (x > bowBulkhead(p).xTip + 1e-9) continue; const e = edge(x); if (Number.isFinite(e)) req.push([x, bodyHalf - (e - need)]); }
    const okAt = (x1: number): boolean => req.every(([x, t]) => t <= turn * smootherstep((x - x0) / Math.max(1e-6, x1 - x0)) + 1e-9);
    const shortest = x0 + 2;
    let x1: number;
    let clears = true;
    if (okAt(xBulk)) x1 = xBulk;
    else if (!okAt(shortest)) { x1 = shortest; clears = false; }
    else { let lo = shortest, hi = xBulk; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (okAt(mid)) lo = mid; else hi = mid; } x1 = lo; }
    // Round DOWN to 1/4 in so the pattern has a clean number (the slack covers it).
    x1 = Math.max(shortest, Math.floor(x1 * 4) / 4);
    out = { x0, x1, turnIn: turn, minRadiusIn: ((x1 - x0) * (x1 - x0)) / (SMOOTHERSTEP_MAX_CURVATURE * turn), clears };
  }
  if (taperCache.size > 40) taperCache.clear();
  taperCache.set(key, out);
  return out;
}

/** Turn-in per side of the hull's outer face at x for a taper (D-66): 0 behind `x0`, `turnIn` from `x1` on, a smootherstep between. */
export const taperTurnIn = (t: BowTaper, x: number): number => t.turnIn * smootherstep((x - t.x0) / Math.max(1e-6, t.x1 - t.x0));

/** How far the hull's outer face has turned in at x, per side (D-66; the plan curve read by the layout, body, frame and front axle). */
export function bowTurnInAt(p: Params, x: number): number {
  return taperTurnIn(bowTaper(p), x);
}

/** Where the grab board's hole is centered (x, in; D-84): `grabHoleAheadOfHpointIn` ahead of the H-point, held back (in 1/4 in steps) until the side's turn-in over the board's length is 1/16 in at most, because the board is flat. */
export function gripHoleX(p: Params): number {
  const half = p.grabBoardLengthIn / 2;
  let x = p.seatXIn + p.grabHoleAheadOfHpointIn;
  while (x > p.seatXIn - 4 && bowTurnInAt(p, x + half) - bowTurnInAt(p, x - half) > 1 / 16 + 1e-9) x -= 0.25;
  return x;
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
  // Tire vs body at full lock: the inner face of the tire (a plan rectangle 2r long, `tw` wide) swings toward the side of the body, whose outer half width is `bodyHalf` less the bow
  // turn-in at that x (D-57). Sampled along the inner face, both directions of lock; the rear corner governs, 10 in behind the axle where the turn-in has not started (D-58).
  const taper = bowTaper(p);
  const bodyHalfAt = (x: number) => bodyHalf - taperTurnIn(taper, x);
  // The body is the derived taper (D-66); the question "what track would this body need" holds the body fixed and moves the tire. The face is swept through the whole lock range.
  const clearAtTrack = (track: number) => {
    const edge = tireSweepInnerEdge({ ...p, frontTrackIn: track });
    let m = Infinity;
    for (const x of tireSweepXs({ ...p, frontTrackIn: track }, 0.1)) { if (x > bowBulkhead(p).xTip + 1e-9) continue; const e = edge(x); if (Number.isFinite(e)) m = Math.min(m, e - bodyHalfAt(x)); }
    return m;
  };
  const clearAtLock = clearAtTrack(trk);
  let lo = 2 * tw, hi = 80;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (clearAtTrack(mid) >= p.steerClearIn) hi = mid; else lo = mid; }
  const minTrack = hi;
  // Turning: the axle line meets the rear axle line at the turning center.
  const sinL = Math.max(1e-6, Math.sin(lock));
  const centerRadiusIn = p.wheelbaseIn / Math.max(1e-6, Math.tan(lock));
  const outerEdgeRadiusIn = p.wheelbaseIn / sinL + trk / 2 + tw / 2;
  const innerEdgeRadiusIn = Math.max(0, p.wheelbaseIn / sinL - trk / 2 - tw / 2);
  // Vertical stack at the kingpin (underslung beam, axle rod in a top groove, as at the rear).
  const beamTop = r + p.axleDiameterIn / 2 - p.axleProudIn; // the tube stands axleProudIn above the beam (D-62)
  const beamBot = beamTop - p.axleBeamDepthIn;
  const tongueTop = beamTop; // D-58: the oak tongue butts the front of the beam, its top flush with the beam top (the disc lies directly on the beam)
  const thrustTop = beamTop + p.kingThrustThickIn;
  const kingBot = thrustTop;
  const kingDepth = deckBot - kingBot;
  // The axle beam sweeps under the rails at the lock angle: the rails are shallower where it passes.
  const railYIn = bodyHalf - p.railThicknessIn;
  const swathHalf = (p.frontBeamThicknessIn / 2) * Math.cos(lock) + bodyHalf * Math.sin(lock); // at the rail's OUTER face (|y| = bodyHalf), where the beam's trailing corner reaches furthest back
  const railDepthFront = Math.max(0, Math.min(p.railDepthIn, deckBot - (beamTop + p.axleProudIn + p.beamRailClearIn))); // beamRailClearIn over the TUBE, which stands axleProudIn above the beam top (D-62)
  const railStepX = kingX - swathHalf - 1;
  // The steering lock is set by two CHECK CHAINS (D-58): an eye bolt fore-aft through each end of the axle beam (`steerChainBeamYIn` from the kingpin, mid depth, the eye standing 0.7 in out
  // of the beam's TRAILING face) and an eye bolt fore-aft through the crossmember just behind the king beam (layout.ts: `chain`, `steerChainAnchorYIn` from the center line, the eye standing out of its
  // FRONT face). The RIGHT chain goes taut at +lock (the right end of the beam swings forward, away from the anchor behind it), the LEFT at -lock. The chains run under the king beam.
  const endJoistX = bowCurl(p).xFlatEnd - p.crossmemberThickIn / 2 - 0.05; // the last joist, under the scarf of the deck to the bow bulkhead
  const stand = 0.7;
  const beamU = -(p.frontBeamThicknessIn / 2 + stand);
  // S-2 (eng 3c): the chain eye bolt goes through the ligament UNDER the stub groove, not through mid depth of the whole beam (that left a 0.17 in wafer of oak under the groove floor).
  const beamZ = (beamTop - (p.axleDiameterIn - p.axleProudIn) + beamBot) / 2;
  /** The beam eye of the RIGHT chain at steering angle a (rad, + = turning left, the beam turned counter-clockwise from above). */
  const beamEyeAt = (a: number): [number, number, number] => [kingX + beamU * Math.cos(a) + p.steerChainBeamYIn * Math.sin(a), beamU * Math.sin(a) - p.steerChainBeamYIn * Math.cos(a), beamZ];
  return { lock, kingX, clearAtLock, minTrack, centerRadiusIn, outerEdgeRadiusIn, innerEdgeRadiusIn, beamTop, beamBot, tongueTop, thrustTop, kingBot, kingDepth, railYIn, swathHalf, railDepthFront, railStepX, endJoistX, beamU, beamZ, beamEyeAt, stand, deckBot };
}

/** The thin-sheet material in effect (D-73, D-80): `followWeather` resolves to 6 mm Baltic birch (Standard) or 6 mm okoume (Extreme). */
export function thinSheetKey(p: Pick<Params, 'thinSheetMaterial' | 'weatherSpec'>): number {
  if (p.thinSheetMaterial !== THIN_SHEET.followWeather) return p.thinSheetMaterial;
  return p.weatherSpec === WEATHER_SPEC.extreme ? THIN_SHEET.okoumeMarine : THIN_SHEET.balticBirch6mm;
}

export interface ThinSheet {
  key: number;
  /** Short name for the cut list and BOM ("1/4 in white oak plywood"). */
  name: string;
  /** Material text on the parts. */
  material: string;
  /** Nominal size for the sheet class text ("1/4 in", "4 mm", "1/8 in (3 mm)"). */
  nominal: string;
  thicknessIn: number;
  densityPcf: number;
  moePsi: number;
  morPsi: number;
  /** D-76: E and MOR ACROSS the face grain (the side webs bend this way: their face grain runs along x). */
  moePerpPsi: number;
  morPerpPsi: number;
  /** Full sheet bought (in): 48 x 96 except the Baltic birch, which is sold 60 x 60. */
  sheetWidthIn: number;
  sheetLengthIn: number;
  /** Key into PLYWOOD_PRICE (prices.ts). */
  priceKey: string;
  /** Glue rating of the sheet (what the finishing schedule must seal against). */
  glue: string;
}

/** Everything the model, the analysis and the build outputs need about the thin sheet in effect (D-73). Plain numbers from the params, so every view agrees. */
export function thinSheet(p: Params): ThinSheet {
  const key = thinSheetKey(p);
  if (key === THIN_SHEET.whiteOakPly)
    return { key, name: '1/4 in white oak plywood', material: '1/4 in white oak plywood', nominal: '1/4 in', thicknessIn: p.whiteOakPlyThickIn, densityPcf: p.whiteOakPlyDensityPcf, moePsi: p.whiteOakPlyMoePsi, morPsi: p.whiteOakPlyMorPsi, moePerpPsi: p.whiteOakPlyMoePerpPsi, morPerpPsi: p.whiteOakPlyMorPerpPsi, sheetWidthIn: 48, sheetLengthIn: 96, priceKey: 'white-oak-1/4', glue: 'interior / Type II' };
  if (key === THIN_SHEET.balticBirch3mm)
    return { key, name: '3 mm Baltic birch', material: '3 mm Baltic birch plywood', nominal: '1/8 in (3 mm)', thicknessIn: p.balticThinThickIn, densityPcf: p.birchDensityPcf, moePsi: p.birchMoePsi, morPsi: p.birchMorPsi, moePerpPsi: p.balticThinMoePerpPsi, morPerpPsi: p.balticThinMorPerpPsi, sheetWidthIn: 60, sheetLengthIn: 60, priceKey: 'baltic-3mm', glue: 'exterior' };
  if (key === THIN_SHEET.balticBirch6mm)
    return { key, name: '6 mm Baltic birch', material: '6 mm Baltic birch plywood', nominal: '1/4 in (6 mm)', thicknessIn: p.balticSixThickIn, densityPcf: p.birchDensityPcf, moePsi: p.birchMoePsi, morPsi: p.birchMorPsi, moePerpPsi: p.balticSixMoePerpPsi, morPerpPsi: p.balticSixMorPerpPsi, sheetWidthIn: 48, sheetLengthIn: 96, priceKey: 'baltic-6mm', glue: 'interior, verify with the yard' };
  return { key: THIN_SHEET.okoumeMarine, name: p.panelPlyIn < 0.2 ? '4 mm okoume' : '6 mm okoume', material: 'okoume marine plywood', nominal: p.panelPlyIn < 0.2 ? '4 mm' : '6 mm', thicknessIn: p.panelPlyIn, densityPcf: p.okoumeDensityPcf, moePsi: p.okoumeMoePsi, morPsi: p.okoumeMorPsi, moePerpPsi: p.okoumeMoePerpPsi, morPerpPsi: p.okoumeMorPerpPsi, sheetWidthIn: 48, sheetLengthIn: 96, priceKey: 'okoume-6mm', glue: 'marine (BS 1088)' };
}

/** Derived quantities that many modules need; no geometry here. */
export function derived(p: Params) {
  const okoume = p.plySpecies === PLY_SPECIES.okoumeMarine;
  const thin = thinSheet(p);
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
    /** D-73: the thin sheet (webs, box, lid, signs); the three above are the 12 mm deck / seat back sheet. */
    thinPlyIn: thin.thicknessIn,
    thinPlyDensityPcf: thin.densityPcf,
    thinPlyMoePsi: thin.moePsi,
    thinPlyDesignMorPsi: (thin.morPsi * p.wetServiceFactorStrength) / p.woodSafetyFactor,
    /** D-76: across the face grain (vertical bending of the side webs). */
    thinPlyMoePerpPsi: thin.moePerpPsi,
    thinPlyDesignMorPerpPsi: (thin.morPerpPsi * p.wetServiceFactorStrength) / p.woodSafetyFactor,
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
    axleAllowablePsi: (p.axleWallIn > 0 ? p.axleTubeYieldPsi : p.axleYieldPsi) / p.steelSafetyFactor,
    /** Vertical load for structural checks: goal rider + cargo (sled self-weight added by the analysis). */
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
/** Depth of the axle-tube groove in the oak beam: the tube diameter less the amount that stands proud (D-62, build 3c M2). */
export const axleGrooveDepthIn = (p: Pick<Params, 'axleDiameterIn' | 'axleProudIn'>): number => p.axleDiameterIn - p.axleProudIn;

/**
 * The push-handle post in its socket (E1, 3c-7), from params alone so `validateParams` can check it (handle.ts `handleGeometry` has the same numbers from the Layout; a test holds
 * them equal): the post foot, the riding pin hole and the mouth, and so how much post stays in the socket when riding and how much wood is left below the pin hole.
 */
export function handleInsertion(p: Params): { insertionIn: number; pinEndIn: number; parkDropIn: number } {
  const hwC = p.bodyWidthIn / 2 - p.sideThicknessIn;
  const yPost = hwC - p.handleUprightInsetIn;
  const yEnd = hwC + p.sideThicknessIn;
  const c = Math.max(0, p.handleBowCrownIn);
  const R = c > 1e-6 ? (yPost * yPost + c * c) / (2 * c) : Infinity;
  const zEnd = Number.isFinite(R) ? p.rearHandleHeightIn + c - (R - Math.sqrt(Math.max(0, R * R - yEnd * yEnd))) : p.rearHandleHeightIn;
  const sec = p.handleBarDiameterIn;
  const zCornerTop = p.deckHeightIn + p.sideHeightRearIn;
  const needEnd = zCornerTop + p.handleParkClearIn + sec / 2 + (p.rearHandleHeightIn - zEnd);
  const needMid = zCornerTop + p.transomCrownIn + p.handleParkClearIn + sec / 2 - c;
  const parkDropIn = Math.max(0, p.rearHandleHeightIn - Math.max(needEnd, needMid));
  const insertionIn = p.handleSocketDepthIn - 0.5 - parkDropIn; // the foot sits 0.5 in above the socket bottom, plus the parked drop
  const pinEndIn = insertionIn - Math.min(1.5, p.handleSocketDepthIn / 4); // the riding pin hole is min(1.5, depth/4) below the mouth
  return { insertionIn, pinEndIn, parkDropIn };
}

export function validateParams(input: Params): ParamIssue[] {
  const p = resolveParams(input);
  const issues: ParamIssue[] = [];
  const err = (keys: ParamKey[], message: string) => issues.push({ keys, severity: 'error', message });
  const warn = (keys: ParamKey[], message: string) => issues.push({ keys, severity: 'warn', message });
  const info = (keys: ParamKey[], message: string) => issues.push({ keys, severity: 'info', message });
  const r = p.wheelDiameterIn / 2;
  const curl = bowBulkhead(p);
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
  if (p.seatXIn + p.riderLegReachIn > curl.xFlatEnd + 1e-9)
    err(['seatXIn', 'riderLegReachIn', 'frontOverhangIn', 'bowBulkheadThickIn'], `The rider's feet would reach past the bow bulkhead's rear face (the foot brace, x = ${curl.xFlatEnd.toFixed(1)}").`);
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
  // The foot brace is the rear face of the bow bulkhead (D-57); D-60 dropped the foot block, so the leg reach has to land on it.
  if (p.seatXIn + p.riderLegReachIn < curl.xFlatEnd - 1)
    warn(['seatXIn', 'riderLegReachIn'], `The rider's heel would be ${(curl.xFlatEnd - p.seatXIn - p.riderLegReachIn).toFixed(1)}" short of the bulkhead (the foot block was dropped at D-60): move the seat forward or lengthen the leg reach.`);
  // D-60: the axle is a tube; the wheel bore has to match its OD, and the cotter-pin hole needs an end distance.
  if (p.axleWallIn > p.axleDiameterIn / 2 - 0.05)
    err(['axleWallIn', 'axleDiameterIn'], `The axle tube wall (${p.axleWallIn}") leaves no bore in a ${p.axleDiameterIn}" axle. Use a thinner wall, or 0 for a solid rod.`);
  if (Math.abs(p.wheelBoreIn - p.axleDiameterIn) > 0.01)
    warn(['wheelBoreIn', 'axleDiameterIn'], `The wheel bore (${p.wheelBoreIn}") is not the axle diameter (${p.axleDiameterIn}"): the bearings ride on the axle OD, so they must match. Choose another wheel or change the axle.`);
  // S-4 (eng 3c): a foam-filled tire is several times stiffer than the 500 lb/in pneumatic one the bump model assumes.
  if (p.tireType === TIRE_TYPE.flatFree && p.bumpWheelRateLbIn < 1000)
    warn(['tireType', 'bumpWheelRateLbIn'], `Flat-free tires change the bump rate, not just the mass: the bump model still assumes ${p.bumpWheelRateLbIn} lb/in, a pneumatic tire. Measure the squash of the actual tire (load / squash) and set Effective wheel radial stiffness before trusting the structure rows (a foam tire can be 2,000 lb/in or more).`);
  if (p.axleCrossHoleFromEndIn - p.axleCrossHoleDiaIn / 2 < 1.5 * p.axleCrossHoleDiaIn - 1e-6 || p.axleEndExtraIn - p.axleCrossHoleFromEndIn < 0.5)
    warn(['axleCrossHoleFromEndIn', 'axleCrossHoleDiaIn', 'axleEndExtraIn'], 'The cotter-pin cross hole is too close to the axle end (want an end distance of 1.5 hole diameters or more) or leaves less than 1/2" for the collar and washer.');
  // E1 (3c-7): the riding pin hole must have wood below it. At a 12 in socket the hole sat 0.19 in above the post foot (the pin retained nothing).
  {
    const hi = handleInsertion(p);
    if (hi.pinEndIn < 4 * p.handlePinDiameterIn - 1e-9)
      err(['handleSocketDepthIn', 'handlePinDiameterIn', 'handleParkClearIn'], `The riding retaining-pin hole is only ${Math.max(0, hi.pinEndIn).toFixed(2)}" above the foot of the post; it needs 4 pin diameters (${(4 * p.handlePinDiameterIn).toFixed(2)}"). Deepen the socket or reduce the parked drop (${hi.parkDropIn.toFixed(1)}").`);
    else if (hi.insertionIn < 3 - 1e-9)
      warn(['handleSocketDepthIn', 'handleParkClearIn'], `Only ${hi.insertionIn.toFixed(1)}" of post stays in the socket when riding (want 3" or more): the handle will wobble at the grip.`);
  }
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
    warn(['sideHeightBowIn', 'sideHeightRearIn'], 'The sled profile is meant to be low at the bow and tall at the rear (D-57).');
  if (p.sideHeightBowIn - 2 * p.railBandIn < 1)
    err(['sideHeightBowIn', 'railBandIn'], 'The side panel at the bow would be shorter than 1". Raise the bow side or thin the chine and gunwale.');
  // D-69: the bow bulkhead's bottom is the deck underside, its corners the bow side tops, its crown the handlebow's; the hand-hold hangs under the crown with liftBarMinIn of oak above it.
  const bowHoldClear = p.sideHeightBowIn + p.handleBowCrownIn - p.liftBarMinIn - p.liftSlotHeightIn;
  if (bowHoldClear < p.bowHoldMinClearIn - 1e-9)
    err(['sideHeightBowIn', 'handleBowCrownIn', 'liftSlotHeightIn', 'liftBarMinIn', 'bowHoldMinClearIn'], `The bow hand-hold would leave only ${bowHoldClear.toFixed(2)}" of hand room above the deck (it hangs under the bulkhead crown with ${p.liftBarMinIn}" of oak above it); it needs at least ${p.bowHoldMinClearIn}". Raise the bow side or the crown, or shorten the slot (D-69).`);
  // Plan taper (D-66, D-62): each oak band of the sandwich side is cold-bent on the web; the S-curve's tightest bend must stay above the cold-bend limit of ONE band.
  const thinT = thinSheet(p).thicknessIn;
  const bandT = Math.max(0, (p.sideThicknessIn - thinT) / 2);
  const taper = bowTaper(p);
  if (taper.turnIn > 1e-9) {
    const lim = p.hullLamMinRadiusFactor * bandT;
    if (taper.minRadiusIn < lim - 1e-9)
      err(['bowWidthIn', 'bowTaperStartIn', 'hullLamMinRadiusFactor'], `The bow taper bends the chine and gunwale bands to a ${taper.minRadiusIn.toFixed(1)}" radius; a ${bandT.toFixed(3)}" band cold-bends to ${lim.toFixed(1)}" at best: start the taper earlier or narrow the bow less.`);
    if (!taper.clears)
      err(['bowWidthIn', 'bowTaperStartIn', 'frontTrackIn', 'steerLockDeg', 'steerClearIn'], `Even the shortest S-curve from x = ${taper.x0}" to the bow cannot keep the front tires ${p.steerClearIn}" clear of the body at ${p.steerLockDeg}° lock: start the taper earlier, narrow the bow, widen the front track or reduce the lock.`);
    const inside = p.bowWidthIn - 2 * p.sideThicknessIn;
    if (inside < footNeed)
      err(['bowWidthIn', 'riderStatureIn', 'bootAllowanceIn'], `The bow is only ${inside.toFixed(1)}" wide inside; the rider's feet need ≥ ${footNeed.toFixed(1)}" there. Widen the bow.`);
  }
  // D-84: the grab board and its cap are flat; where the sides turn in toward the bow they would stand off the band, so the model holds the board back (gripHoleX).
  {
    const want = p.seatXIn + p.grabHoleAheadOfHpointIn, got = gripHoleX(p);
    if (got < want - 1e-9)
      warn(['grabHoleAheadOfHpointIn', 'grabBoardLengthIn', 'seatXIn'], `The grab board (a flat piece) would reach where the sides turn in toward the bow, so it is held back ${(want - got).toFixed(2)}" from where you set it (its rear end would stand more than 1/16" off the band).`);
  }
  // Sandwich sides (D-61, D-62): the oak band on each face of the web must be a real strip, and the inner chine band must keep some height above the deck gap.
  {
    if (bandT < 0.15)
      warn(['sideThicknessIn', 'panelPlyIn', 'thinSheetMaterial'], `A ${thinT}" web in a ${p.sideThicknessIn}" side leaves ${bandT.toFixed(3)}" oak bands on each face (want 0.15" or more). Thicken the side stock or thin the panel.`);
    const innerChine = p.railBandIn - (p.deckPlyIn + p.deckSlopIn);
    if (innerChine < 0.5)
      warn(['railBandIn', 'deckPlyIn'], `The inner chine band is only ${Math.max(0, innerChine).toFixed(2)}" tall above the ${(p.deckPlyIn + p.deckSlopIn).toFixed(2)}" gap the deck edge rises into (want 1/2" or more): make the chine band taller.`);
    // D-63: the deck is cut narrower than the web gap by deckSideClearIn each side; what is left under the inner chine band must still be a real tuck.
    const tuck = Math.min(p.deckCaptureDepthIn, bandT) - p.deckSideClearIn;
    if (tuck < 0.1)
      warn(['deckSideClearIn', 'deckCaptureDepthIn'], `The deck edge tucks only ${Math.max(0, tuck).toFixed(3)}" under each inner chine band after the ${p.deckSideClearIn}" side clearance (want 0.1" or more): reduce the clearance or thicken the band.`);
  }
  // ── Front end: the pivoting soapbox axle (D-56). The wheels run beside the body; the lock angle sets a minimum track, the stack under the deck sets the king beam depth. ──
  const sg = steerGeometry(p);
  const frontInnerTire = p.frontTrackIn / 2 - p.tireWidthIn / 2;
  if (p.bodyWidthIn / 2 + 0.75 > frontInnerTire)
    err(['bodyWidthIn', 'frontTrackIn'], 'The body is too wide to clear the front tires (needs ≥ ¾" each side).');
  else if (sg.clearAtLock < p.steerClearIn - 1e-9)
    err(['frontTrackIn', 'steerLockDeg', 'bodyWidthIn', 'steerClearIn'], `At full lock (${p.steerLockDeg}°) the front tire corner swings to ${sg.clearAtLock.toFixed(2)}" from the side of the body; it needs ${p.steerClearIn}". Widen the front track to at least ${sg.minTrack.toFixed(1)}", reduce the lock or narrow the body.`);
  if (sg.kingDepth < 1 - 1e-9)
    err(['deckHeightIn', 'kingThrustThickIn', 'axleBeamDepthIn'], `The pivot stack (axle beam top ${sg.beamTop.toFixed(2)}" + thrust disc) leaves only ${sg.kingDepth.toFixed(2)}" for the king beam under the deck; raise the deck to at least ${(sg.kingBot + 1 + p.deckPlyIn).toFixed(2)}".`);
  if (sg.railDepthFront < 1 - 1e-9)
    err(['deckHeightIn', 'railDepthIn'], `The rails would be only ${sg.railDepthFront.toFixed(2)}" deep where the axle beam swings under them; raise the deck.`);
  if (p.wheelbaseIn + 3 > curl.xFlatEnd + 1e-9)
    err(['wheelbaseIn', 'frontOverhangIn'], 'The front axle runs onto the bow bulkhead: lengthen the front overhang.');
  {
    // The steering chains (D-58): the beam eye must lie between the kingpin zone and the clamp plates (the anchor eye pulls in by itself on a narrow body, layout.ts).
    if (Math.min(p.bodyWidthIn, p.bowWidthIn) < 13)
      err(['bodyWidthIn', 'bowWidthIn'], `The bow is only ${Math.min(p.bodyWidthIn, p.bowWidthIn).toFixed(1)}" wide at the bulkhead; it needs 13" for the hand-hold, the foot brace and the tongue.`);
    if (p.steerChainBeamYIn < p.kingThrustOdIn / 2 + 1 || p.steerChainBeamYIn + 1.1 > (p.frontTrackIn - p.hubLengthIn - 0.25) / 2)
      err(['steerChainBeamYIn', 'frontTrackIn'], 'The steering chain eye in the axle beam must lie between the kingpin disc and the end of the beam (room for its 2" washer).');
    if (p.tongueHeadWidthIn / 2 < p.tongueBoltOffsetIn + p.tongueBoltDiaIn / 2 + 0.75)
      err(['tongueHeadWidthIn', 'tongueBoltOffsetIn', 'tongueBoltDiaIn'], 'The tongue head is too narrow for its bolts: 3/4" of oak is needed outside each carriage bolt.');
    if (p.tongueBoltOffsetIn < p.kingpinDiaIn / 2 + p.tongueBoltDiaIn / 2 + 0.5)
      err(['tongueBoltOffsetIn', 'kingpinDiaIn', 'tongueBoltDiaIn'], 'The tongue carriage bolts are too close to the kingpin hole in the axle beam.');
    // The roll pads lie on the beam top between the inner clamp plate and the outer plate.
    {
      const yIn = (p.frontTrackIn - p.hubLengthIn - 0.25) / 2 - p.frontStubLenIn; // inner end of the stub / groove
      const plateIn = yIn + 0.25 + p.clampPlateWidthIn; // inner station's outer edge
      const plateOut = (p.frontTrackIn - p.hubLengthIn - 0.25) / 2 - 0.25 - p.clampPlateOuterWidthIn; // outer station's inner edge
      if (p.rollPadRadiusIn - p.rollPadLenIn / 2 < plateIn + 0.1 || p.rollPadRadiusIn + p.rollPadLenIn / 2 > plateOut - 0.1)
        warn(['rollPadRadiusIn', 'rollPadLenIn', 'frontStubLenIn'], `The roll pads (${(p.rollPadRadiusIn - p.rollPadLenIn / 2).toFixed(1)}" to ${(p.rollPadRadiusIn + p.rollPadLenIn / 2).toFixed(1)}" from the center) must lie between the stub clamp plates on the axle beam (free from ${plateIn.toFixed(1)}" to ${plateOut.toFixed(1)}").`);
    }
    if (p.kingThrustOdIn > 4 || p.kingThrustOdIn > p.kingBeamLengthIn + 1)
      warn(['kingThrustOdIn', 'kingBeamLengthIn'], 'The thrust disc is much wider than the king beam that carries it; lengthen the king beam.');
  }
  // ── Rear axle stack (D-15, D-54) ──
  const beamBottom =
    p.axleBeamPosition === AXLE_BEAM_POSITION.underslung
      ? r + p.axleDiameterIn / 2 - p.axleProudIn - p.axleBeamDepthIn
      : r - p.axleDiameterIn / 2 + p.axleProudIn;
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
    // D-66: the plate may run under the outer part of the rail (the rail's relief notch is cut over the plate), but not past the rail's inner face where the axle hanger stands.
    const railInner = p.bodyWidthIn / 2 - p.railThicknessIn;
    if (railInner > clampInner + 1e-6)
      err(['bodyWidthIn', 'rearTrackIn', 'clampPlateWidthIn', 'railThicknessIn'],
        `The rear U-bolt plates start at ${clampInner.toFixed(2)}" off center but the rails' inner faces (where the axle hangers stand) are at ${railInner.toFixed(2)}"; widen the track or narrow the plates.`);
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
  // ── Step brake (D-57) ──
  {
    const railBot = deckBot - p.railDepthIn;
    if (railBot < p.minGroundClearanceIn - 1e-9)
      warn(['railDepthIn', 'deckHeightIn', 'minGroundClearanceIn'], `The brake knees sit on the rail bottom, ${railBot.toFixed(2)}" off the ground, below the ${p.minGroundClearanceIn}" ground clearance.`);
    if (p.brakeChockHeightIn > railBot - 0.5 + 1e-9)
      warn(['brakeChockHeightIn', 'railDepthIn', 'deckHeightIn'], `The wheel chock (${p.brakeChockHeightIn}" tall) hangs under the knee, whose bottom is ${railBot.toFixed(2)}" off the ground: it needs half an inch of room.`);
    const padSpanDeg = p.brakePadAngleDeg + (p.brakePadLengthIn / (2 * r)) * (180 / Math.PI);
    if (padSpanDeg > 60)
      warn(['brakePadAngleDeg', 'brakePadLengthIn'], `The rear end of the brake pad is ${padSpanDeg.toFixed(0)}° behind the top of the tire: the flap would have to fold steeply down behind the tire.`);
    if (p.brakePadWidthIn > p.tireWidthIn - 0.3 + 1e-9)
      info(['brakePadWidthIn', 'tireWidthIn'], `The brake pad is narrower than set: it is held ${0.3}" inside the tread edges (${(p.tireWidthIn - 0.3).toFixed(1)}").`);
    if (p.brakeFlapWidthIn < p.tireWidthIn - 1e-9)
      info(['brakeFlapWidthIn', 'tireWidthIn'], 'The brake flap is narrower than the tire.');
  }
  void info; void footZoneX;
  return issues;
}
