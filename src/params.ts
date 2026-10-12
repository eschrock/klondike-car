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
    note: 'Eric 2026-10-11: 200 lb (was 250 lb; the owner is weight-sensitive and the parts are sized to this). Camp gear, firewood and water (reference/04): a uniform load over the bed, seat stowed, no rider. Carried at a high center of gravity (cargoCgHeightIn). The cargo case runs next to the rider cases and never changes the rider range.',
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
    default: 32, min: 26, max: 52, step: 0.25, status: 'explore', primary: true, ref: 'D-6, D-58',
    note: 'D-58 (Eric): tightened from 35.5" to 32". The rear wheels do not steer, so the track is set only by the tire width plus clearance to the 24" body (tire inner face 14.25" from center vs the body side at 12", the rod clamp plates start at 12.6") and by tipping (the 250 lb cargo case: tip-straight 41.0° vs the 40° limit at 32"). Still fits between the wheel wells of the truck bed with the front track.',
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
    note: 'Sled side profile (reference/05): low at the bow, rising in a straight line to the rear (sideHeightRearIn). Where the sides end against the bow curl.',
  },
  sideHeightRearIn: {
    label: 'Side height at the rear (above the deck)', group: 'body', unit: 'in',
    default: 14, min: 8, max: 24, step: 0.5, status: 'explore', primary: true, ref: 'D-54, D-57',
    note: 'D-57: 14 in (was 16). The rear transom follows this height, the flag tube and the handle sockets stand in the tall rear section, and the sheer curve (sheerCurveIn) sweeps down from it to the bow.',
  },
  sheerCurveIn: {
    label: 'Sheer curve (sag of the side top below the straight line)', group: 'body', unit: 'in',
    default: 2.5, min: 0, max: 4, step: 0.25, status: 'explore', primary: true, ref: 'D-57',
    note: 'The top edge of the side sweeps up from the low bow to the tall rear in a smooth concave curve, as on Wagner\'s sled (reference/05). The gunwale dips this far below the straight line from the rear to the bow at mid-length (a parabola); 2.5 in with the 10 in of rise leaves the top edge level at the bow. 0 = the straight D-54 line. The gunwale is bandsawn from a wide oak board to the curve; the web top follows it.',
  },
  bowTurnInIn: {
    label: 'Bow turn-in (each side, in plan)', group: 'body', unit: 'in',
    default: 1.25, min: 0, max: 3, step: 0.25, status: 'explore', primary: true, ref: 'D-57',
    note: 'In plan the sides ease in toward the bow over bowTurnLenIn (a smooth S that is straight at both ends), so the nose is this much narrower on each side than the 24 in body. The chine, web, gunwale, deck and the front rails follow the curve; the bow bulkhead is as wide as the narrowed hull. It also gives the front tires more room at full lock. Chine and gunwale are cold-bent flat (2 plies) on a form; the web is a single bent sheet.',
  },
  bowTurnLenIn: {
    label: 'Bow turn-in length (ahead of the foot brace)', group: 'body', unit: 'in',
    default: 14, min: 6, max: 30, step: 1, status: 'explore', ref: 'D-57',
    note: 'The plan curve starts this far behind the bow bulkhead and runs to it. Keep it long enough that the bend in the chine and gunwale stays gentle (hullLamMinRadiusFactor).',
  },
  bowBulkheadThickIn: {
    label: 'Bow bulkhead thickness', group: 'body', unit: 'in',
    default: 1.5, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-57, D-60',
    note: 'The shaped oak bulkhead at the bow replaces the D-54 bow curl and the separate foot-stop bar: it is the rider\'s foot brace and the structural front of the hull. One piece of 8/4 oak planed to its thickness (two thinner boards glued face to face are the alternative), so there is no cross-grain break at the hand-hold. D-60: 1-1/2 in (was 1-3/4 in): the foot-stop row was at 0.10, it goes to about 0.14.',
  },
  bowBulkheadHeightIn: {
    label: 'Bow bulkhead height at the center (above the deck)', group: 'body', unit: 'in',
    default: 5.75, min: 5, max: 14, step: 0.25, status: 'explore', primary: true, ref: 'D-57, 3c-5',
    note: 'The top is a gentle crown (the same rise as the handlebow, handleBowCrownIn) that peaks at this height at the center, so the corners stand handleBowCrownIn lower (3c-5; it was a 9 in peak over 4 in corners). The lift hand-hold is cut through it under the crown, with at least liftBarMinIn of oak above. The front lamp clip snaps into that slot (3c-5).',
  },
  showSideSigns: {
    label: 'Show the side signs', group: 'body', unit: '',
    default: 1, min: 0, max: 1, step: 1, status: 'assumed', ref: 'D-54, D-57',
    options: [{ value: 0, label: 'Off' }, { value: 1, label: 'On (tall rear part of each side)' }],
    note: 'D-57: the Troop 455 sign is back, on the outside of the tall rear part of each side (signTexture, oval plank). Nothing structural is sized to it.',
  },
  hullLamMinRadiusFactor: {
    label: 'Min. bend radius / ply thickness', group: 'body', unit: '×',
    default: 40, min: 20, max: 100, step: 5, status: 'assumed', ref: 'D-45, D-57',
    note: 'Cold-bent plies lay up without steaming above this ratio of bend radius to ply thickness; the validator flags a bow turn-in whose plan radius is tighter than this times one ply of the chine and gunwale (two plies each).',
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
    default: 15, min: 8, max: 30, step: 1, status: 'assumed', ref: 'D-9, D-57',
    note: 'Shortened automatically to fit the tall rear part of the side (the sheer falls away toward the bow) and to stay behind the rear wheel brake mount.',
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
    label: 'Lash points per gunwale', group: 'body', unit: '',
    default: 3, min: 2, max: 5, step: 1, status: 'assumed', ref: 'D-41',
    note: 'Stainless D-rings on the cabin gunwales for post-race gear hauling (BRIEF §4.9: at least 6 in all).',
  },

  lashDoublerThickIn: {
    label: 'Lash-plate doubler thickness (inboard of the gunwale)', group: 'body', unit: 'in',
    default: 1, min: 0.75, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-47',
    note: 'The lash plate (1.5 x 0.9") is centered on this oak doubler, glued to the inner face of the gunwale, and its four screws go straight down into it (r3 build S8): the 5/8" gunwale is too thin and has the web groove under it. 1" leaves 0.25" of oak beside each screw row. D-60 looked at 3/4 in (0.13 lb) and kept 1 in: the 0.9 in lash plate is wider than a 3/4 in doubler and would overhang it into the gunwale, and only 1/8 in of oak would be left beside each screw row.',
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
    label: 'Seat-back frame thickness', group: 'seat', unit: 'in',
    default: 0.75, min: 0.5, max: 1.25, step: 0.0625, status: 'assumed', ref: 'D-18',
    note: 'Oak frame (2 stiles + 2 rails) with a ply or fabric panel captured in it.',
  },
  seatBackFrameWidthIn: {
    label: 'Seat-back frame member width', group: 'seat', unit: 'in',
    default: 1.25, min: 1, max: 3, step: 0.25, status: 'assumed', ref: 'D-18, D-60',
    note: 'D-60: 1-1/4 in (was 1-1/2 in).',
  },
  footStopHeightIn: {
    label: 'Foot-brace band height above the deck', group: 'seat', unit: 'in',
    default: 4, min: 2, max: 8, step: 0.5, status: 'assumed', ref: 'D-3, D-57',
    note: 'The band of the bow bulkhead the heels and toes press (D-57; the foot-stop row takes the plank section of this height). The drop-in foot block and its slot cleats were dropped at D-60; a block can be added after test rides if small riders want one.',
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
  seatBackLatchHeightIn: {
    label: 'Seat-back latch pin height above the stile foot', group: 'seat', unit: 'in',
    default: 3, min: 1.5, max: 6, step: 0.25, status: 'assumed', ref: 'D-57',
    note: 'D-57: one 3/8 in quick-release (ball-lock) pin per stile, pushed in by hand with no tools. UPRIGHT: through the stile into the fixed oak stop block behind it. FLAT (flipped forward onto the deck): through the same stile hole into the deck and its backer. The farther below the stop-block crest, the lower the pin load.',
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
  grabBoardLengthIn: {
    label: 'Grab board length (along the side)', group: 'seat', unit: 'in',
    default: 8, min: 6, max: 14, step: 0.5, status: 'assumed', ref: 'D-40, D-57',
    note: 'D-57: one oak board per side, bolted to the side top and standing above it, with a routed hand hole (replaces the pad, two posts and bar).',
  },
  grabHoleLengthIn: {
    label: 'Grab hole length', group: 'seat', unit: 'in',
    default: 4.5, min: 3.5, max: 6, step: 0.25, status: 'assumed', ref: 'D-40, D-57',
    note: 'A gloved hand: at least 3.5 in (BRIEF 4.7).',
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
    default: 1.25, min: 0.5, max: 2.5, step: 0.25, status: 'assumed', ref: 'D-57',
    note: 'The board laps the inboard face of the gunwale (that part is bolted) and stands this far above the gunwale top before the hole starts.',
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
    default: 2.28, min: 1.5, max: 4, step: 0.02, status: 'verify', ref: 'D-11, D-60',
    note: 'D-60: 2.28 in, a short hub (the hub width listed for the Dynaline 80105; it was a 3 in placeholder). The listing for the 2.8 lb wheel does not give a hub length: CONFIRM IT. A shorter hub moves the wheel in toward the beam end and shortens the stub cantilever (front-stub 0.62 to 0.38, front-beam 0.98 to 0.94 in the study).',
  },
  wheelBoreIn: {
    label: 'Wheel bore (bearing inside diameter)', group: 'wheels', unit: 'in',
    default: 0.75, min: 0.5, max: 1, step: 0.125, status: 'verify', ref: 'D-60',
    note: 'D-60: the bore of the wheel you buy must equal the axle diameter (the bearings ride on the axle OD, so a tube of the same OD fits where a rod would). The retailer listings for the light wheels (Tractor Supply 4.10/3.50-4, Wesco 151551) do not state the bore, and many 10 in hand-truck wheels have a 5/8 in bore: CONFIRM 3/4 in before ordering, or choose a wheel with a 3/4 in bore (or a 5/8 in wheel and a 5/8 in axle, which is not the design). validateParams warns when the bore and the axle differ.',
    options: [{ value: 0.625, label: '5/8"' }, { value: 0.75, label: '3/4"' }, { value: 1, label: '1"' }],
  },
  wheelMass10Lb: {
    label: 'Mass per 10" wheel assembly', group: 'wheels', unit: 'lb',
    default: 2.8, min: 2, max: 8, step: 0.25, status: 'verify', ref: 'D-11, D-60',
    note: 'D-60 (weight study 3c, trade-off 1): 2.8 lb, the listing weight of the Tractor Supply 4.10/3.50-4 pneumatic wheel on a steel rim (item 3551979); the lighter alternatives are 3.5 lb (Wesco 151551) and 4.0 lb (the old placeholder). A retailer figure, not the maker\'s: weigh the wheel you order.',
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
  axleWallIn: {
    label: 'Axle tube wall (0 = solid rod)', group: 'wheels', unit: 'in',
    default: 0.12, min: 0, max: 0.3, step: 0.005, status: 'assumed', ref: 'D-60',
    note: 'D-60: the rear through axle and the front stub axles are hollow DOM (drawn-over-mandrel) mild-steel tube, 3/4 in OD x 0.120 in wall (1020 or 1026 DOM; McMaster-Carr and the like list 3/4 in OD x 0.120 in wall in 1020/1026 DOM tube; the same OD as the shafting, so the wheel bearings, clamp plates and beam grooves do not change). It saves 3.55 lb for the four axle pieces. 0 = the old solid 1045 rod. The section, mass and rows follow: bending of the tube, the cotter-pin cross hole, ring bearing at the clamp plates. A 0.095 in wall saves 0.4 lb more but dents under the clamps; 0.188 in saves 1.15 lb less.',
    options: [{ value: 0, label: 'Solid rod' }, { value: 0.095, label: '0.095"' }, { value: 0.12, label: '0.120"' }, { value: 0.188, label: '0.188"' }],
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
    default: 0.25, min: 0.1875, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-10, D-60',
    note: 'D-60: 1/4 in (was 3/8 in); no row moves.',
  },
  wheelRatingLb: {
    label: 'Wheel load rating, each (vendor listing)', group: 'wheels', unit: 'lb',
    default: 300, min: 100, max: 800, step: 25, status: 'verify', ref: 'D-11, D-60',
    note: 'D-60: 300 lb per wheel, the Tractor Supply listing rating for the 2.8 lb wheel (the Wesco 151551 is listed at 350 lb). READ THIS OFF THE VENDOR LISTING for the exact wheel you order: it is a placeholder until then. It is a static / rolling rating: the wheel-rating check compares the static goal-rider load to it and the dynamic peak to `wheelRatingPeakMult` times it; the resting-load row compares the heavier wheel\'s static load with it.',
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
    default: 70000, min: 30000, max: 120000, step: 1000, status: 'assumed', ref: 'D-4',
    note: '¾" 1045 turned-ground-polished shafting ≈ 70+ ksi (D-27; confirm vendor cert). 1018 cold-drawn would be ≈ 54 ksi.',
  },
  axleTubeYieldPsi: {
    label: 'Axle tube yield strength (DOM)', group: 'wheels', unit: 'psi',
    default: 70000, min: 30000, max: 120000, step: 1000, status: 'verify', ref: 'D-60',
    note: 'D-60: 1026 DOM tube is listed at about 70 ksi yield / 80+ ksi tensile (1020 DOM about 60 to 70 ksi yield): CONFIRM on the vendor listing or the mill cert, and lower it if the stock you can buy is 1020 DOM at 60 ksi. Used for the bending, cross-hole and ring-bearing rows when the axle is a tube (axleWallIn > 0); the solid rod uses the 1045 value above.',
  },

  // ── Steering & pull ──────────────────────────────────────────────────────
  // ── Front end (PROVISIONAL) and the bridle eye. The swivel casters of the first D-54 pass were rejected by Eric (deck too high, too close together, 360 degrees of swivel); the front end is being redecided (a center-pivot soapbox axle with limited steering). Until then the front is a fixed placeholder axle. ──
  frontTrackIn: {
    label: 'Front track (wheel center to center)', group: 'steering', unit: 'in',
    default: 34.5, min: 26, max: 52, step: 0.125, status: 'explore', ref: 'D-56, D-58',
    note: 'D-56: the two front wheels sit outboard of the 24 in body on the ends of the pivoting axle beam. At full lock a wheel\'s inner rear corner swings toward the body, so the track has a minimum for the lock angle (steer-clear check in validateParams: 34.28 in at 20 degrees and a 24 in body, 0.75 in clearance). D-58 (Eric): 34 1/2 in, the true minimum (34.28) plus about 0.1 in per side (the 3/4 in clearance is already an assumed running gap). The rear tire corner at lock sits about 10 in behind the axle where the body is still full width, so a narrower bow does not lower the minimum.',
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
    default: 0.5625, min: 0.125, max: 0.75, step: 0.0625, status: 'assumed', ref: 'D-56, D-58',
    note: 'D-58: 9/16 in (was 1/4 in; a 1/2 in disc plus a 1/16 in shim, or 5/8 in sheet planed). With the steel tongue plate gone the disc lies directly on the axle beam, and its thickness sets the running gap between the axle clamp plates (tops 3/8 in above the beam) and the king beam: 3/16 in (the steer-clear row wants 1/8 in).',
  },
  rollPadRadiusIn: {
    label: 'Roll pads: distance from the kingpin along the axle beam', group: 'steering', unit: 'in',
    default: 11.5, min: 6, max: 14, step: 0.25, status: 'assumed', ref: 'D-58, D-60',
    note: 'D-58: two UHMW slide pads on top of the axle beam, one each side of the kingpin, that slide under the frame rails with a small running gap and catch the roll of a one-wheel bump, so the kingpin only locates. The rails are the nearest continuous frame members at this distance (they pass over the whole swing); the pad covers the rail underside at every steering angle (checked in king-bearing). D-60: 11-1/2 in (was 11 in): the shorter 2.28 in wheel hub moves the stub clamp stations outboard, so the pad moves with the inner station\'s edge (validateParams checks it); the king-bearing row is unchanged.',
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
    default: 0.3125, min: 0.1875, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-58',
    note: 'The rail bottom is 0.4 in above the axle beam top where the beam swings under it (railDepthFront); 5/16 in leaves the running gap, set with a layer of tape under the pad.',
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
    note: 'D-58: the steel tongue plate (it bent about its thin axis at 3.7x) is replaced by a white-oak tongue set on edge: 1.5 in across (y), tongueDepthIn deep (z), grain along its length. A bandsawn T: the wide head butts the front face of the axle beam and is bolted through it, the stem runs forward under the end joist and the bow to the shackle hole. D-60: 1-1/4 in (was 1-1/2 in).',
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
    label: 'Shackle hole: distance to the tongue tip', group: 'steering', unit: 'in',
    default: 1.5, min: 1.25, max: 4, step: 0.25, status: 'assumed', ref: 'D-58',
    note: 'Oak tears out along the grain, so the hole needs real end distance (the old steel tongue had 1 in); 1 1/2 in with the 1 in sleeve leaves 1 in of oak ahead of it, 3x what the 300 lbf tie load needs (bridle-eye). A 1/2 in bow shackle is about 1 1/2 in inside, so its bow clears the tip.',
  },
  tongueHoleDiaIn: {
    label: 'Shackle hole in the tongue (bronze or steel sleeve OD)', group: 'steering', unit: 'in',
    default: 1, min: 0.75, max: 1.5, step: 0.125, status: 'assumed', ref: 'D-58',
    note: 'A 1 in hole drilled across the tongue takes a bronze (or steel) sleeve bushing (1 in OD, 5/8 in bore for the 1/2 in shackle pin) and a fender washer each side. The shackle pin stays the intended weak link.',
  },
  tongueTieAheadIn: {
    label: 'Tongue tip ahead of the bow tip', group: 'steering', unit: 'in',
    default: 5, min: 2, max: 12, step: 0.5, status: 'assumed', ref: 'D-56, D-58',
    note: 'The tongue tip reaches this far beyond the bow so the shackle hole (tongueTipEdgeIn behind the tip), the ring and the rope clear the bow and the axle can swing.',
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
    default: 10.4, min: 4, max: 14, step: 0.2, status: 'assumed', ref: 'D-58',
    note: 'The eye bolt goes fore-aft through the beam at mid depth (below the stub axle rod in its top groove), its eye standing out of the trailing face, between the kingpin and the stub clamp plates. A long lever keeps the chain pull low.',
  },
  steerChainAnchorYIn: {
    label: 'Steering stop chain: eye in the chain joist, distance from the center line', group: 'steering', unit: 'in',
    default: 8.4, min: 4, max: 11, step: 0.2, status: 'assumed', ref: 'D-58',
    note: 'The eye bolt goes fore-aft through the chain joist (the crossmember just behind the king beam), the eye standing out of its front face, a little below mid depth; the 2 in washer and nut on its rear face must clear the rail. Behind the king beam the chain can run low, under it, to the beam end.',
  },
  chainJoistThickIn: {
    label: 'Chain joist thickness (the crossmember behind the king beam)', group: 'steering', unit: 'in',
    default: 1.25, min: 0.75, max: 2, step: 0.25, status: 'assumed', ref: 'D-58, D-60',
    note: 'D-58: the joist just behind the king beam anchors the two steering chains; at 1 1/2 in (the other joists are 3/4 in) the chain pull bends it in plan with 5 times less stress. The eye bolts go through it. D-60: 1-1/4 in (was 1-1/2 in).',
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
    default: 1.75, min: 1.25, max: 4, step: 0.25, status: 'explore', ref: 'D-57',
    note: 'D-57: a target, not an input. The analysis uses the ratio DERIVED from the flap geometry (pad force on the tread over the foot force, from the moments about the hinge pin, with the pad friction in or against the swing); brake-ratio fails if the geometry delivers less than this. The owner asked for about 2:1; the geometry delivers a little over 2:1, so the target is 1.75.',
  },
  brakeEfficiency: {
    label: 'Brake linkage efficiency', group: 'brake', unit: '×',
    default: 0.95, min: 0.5, max: 1, step: 0.05, status: 'assumed', ref: 'D-13, D-57',
    note: 'Hinge friction only (D-57): a stainless butt hinge on a stainless pin is the only moving joint of the flap brake, so 0.95.',
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
    note: 'D-57: a gentle crown (was 3 in), bandsawn from one oak board rather than laminated. A sled-style handlebow (reference/05): the bow arches up between and over the two posts. 0 = the old straight bar. The bow ends overhang the posts to the edge of the sled; the grip height (rearHandleHeightIn) is measured at the posts.',
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
    default: 12, min: 3, max: 18, step: 0.5, status: 'assumed', ref: 'D-39, D-57, D-60',
    note: 'D-57: deeper (was 6 in) so the posts can drop to the parked pin position with the bow just above the rear side top (handleParkClearIn); at 16 in about 5.7 in of post stayed in the socket when riding. Rectangular-tube socket bolted to the outside of the rear transom, its top flush with the transom top. D-60: 12 in (was 16 in). The parked position still sinks the post 9.8 in, so only about 1.7 in of post stays in the socket when riding (it was 5.7 in): the handle-sockets row passes the 50 lbf hold-back at 0.78 on that insertion, but the handle will have more play; check it on the first build.',
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
    note: 'A scout jumping on one flap: the flap, hinge, screws, knee, bolts and backer must survive it at yield (SF 1). The brake may be bent after it only if the check says so.',
  },
  brakeLiningMaxPsi: {
    label: 'Brake pad allowable contact pressure', group: 'brake', unit: 'psi',
    default: 100, min: 30, max: 300, step: 10, status: 'assumed', ref: 'D-53, D-57',
    note: 'A soft rubber pad against a rubber tread: a long-life limit for a brake used only now and then. Pressure = pad normal force / pad area at the lambda hold load.',
  },
  brakeClearanceIn: {
    label: 'Brake moving-part clearance (sweep limit)', group: 'brake', unit: 'in',
    default: 0.1, min: 0.03, max: 0.5, step: 0.01, status: 'assumed', ref: 'D-38, D-57',
    note: 'Minimum gap between the moving flap group (flap, shoe block, pad, hinge leaf, bungee) and the tire, hull, rails and ground over the full stroke.',
  },
  brakeLoadFactor: {
    label: 'Brake component load factor (on the hold load)', group: 'brake', unit: '×',
    default: 2, min: 1, max: 4, step: 0.25, status: 'assumed', ref: 'D-38',
    note: 'The flap, hinge, knee and bolts are checked at this multiple of the load needed to hold the sled on the design slope: a hard stomp or a jerk on a parked sled.',
  },
  brakeSteelYieldPsi: {
    label: 'Brake arm plate / pin steel yield', group: 'brake', unit: 'psi',
    default: 36000, min: 30000, max: 100000, step: 1000, status: 'assumed', ref: 'D-38',
    note: 'A36 plate. Allowable = yield / steel safety factor (shear 0.577×).',
  },

  brakeHingeAheadIn: {
    label: 'Flap hinge pin ahead of the tire front', group: 'brake', unit: 'in',
    default: 2, min: 0.25, max: 4, step: 0.25, status: 'assumed', ref: 'D-57',
    note: 'D-57: the hinge sits ahead of the rear tire (pin at x = wheel radius + this) on top of the knee, so the flap reaches back over the tire to the foot. 2 in puts the pin and knee ahead of x = 6.5 in, clear of the sign zone on the side (D-57 item 9, x up to 6 in). The farther ahead, the longer the pad-side lever and the lower the foot lever ratio.',
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
    note: 'The foot end is lower than the hinge by this slope, so the foot has less height to climb. The flap\'s underside clears the pad by the shoe block thickness.',
  },

  brakeFootBehindTransomIn: {
    label: 'Foot area centre behind the rear transom face', group: 'brake', unit: 'in',
    default: 0.5, min: -4, max: 8, step: 0.5, status: 'assumed', ref: 'D-57',
    note: 'D-57: the handler stands behind the transom and steps on the flap with one foot, so the foot area (brakeFootPadLengthIn long) is centred just behind the transom face and outboard of the body. The flap ends at the rear of the foot area.',
  },

  brakeFootPadLengthIn: {
    label: 'Foot area length on the flap', group: 'brake', unit: 'in',
    default: 5, min: 3, max: 7, step: 0.5, status: 'assumed', ref: 'D-57',
    note: 'The last stretch of the flap is the foot pad: grooved oak or a strip of rubber stair tread glued on.',
  },

  brakeHingeLengthIn: {
    label: 'Hinge length (along the pin)', group: 'brake', unit: 'in',
    default: 3, min: 2, max: 4, step: 0.5, status: 'assumed', ref: 'D-57',
    note: 'McMaster 316 stainless steel butt hinge, a leaf height of this length.',
  },

  brakeHingeLeafIn: {
    label: 'Hinge leaf width (each leaf)', group: 'brake', unit: 'in',
    default: 1.5, min: 1, max: 2, step: 0.25, status: 'assumed', ref: 'D-57',
    note: 'A 3 in x 3 in (open) hinge has two 1.5 in leaves: one screws to the flap top, one to the knee top.',
  },

  brakeHingePinDiaIn: {
    label: 'Hinge pin diameter', group: 'brake', unit: 'in',
    default: 0.25, min: 0.1875, max: 0.375, step: 0.0625, status: 'assumed', ref: 'D-57',
    note: 'The stainless pin through the knuckles (double shear).',
  },

  brakeHingeScrewDiaIn: {
    label: 'Hinge screw diameter (#10)', group: 'brake', unit: 'in',
    default: 0.19, min: 0.164, max: 0.25, step: 0.001, status: 'assumed', ref: 'D-57',
    note: '#10 316 stainless flat-head screws, 1 in long, into the oak flap and the oak knee.',
  },

  brakeHingeScrewsPerLeaf: {
    label: 'Hinge screws per leaf', group: 'brake', unit: '',
    default: 6, min: 2, max: 8, step: 1, status: 'assumed', ref: 'D-57',
    note: 'Pilot holes drilled with the hinge as the template; a drop of epoxy in each hole in the end-grain side.',
  },

  brakeKneeDepthIn: {
    label: 'Knee (outrigger) fore-aft depth', group: 'brake', unit: 'in',
    default: 2.5, min: 2, max: 5, step: 0.25, status: 'assumed', ref: 'D-57',
    note: 'The oak outrigger that carries the hinge sits ahead of the tire; the bolt columns spread over this depth.',
  },

  brakeKneeLegIn: {
    label: 'Knee leg thickness (against the hull)', group: 'brake', unit: 'in',
    default: 1.75, min: 1.25, max: 3, step: 0.25, status: 'assumed', ref: 'D-57, D-60',
    note: 'The foot of the knee that sits on the rail and chine outer face; the mounting bolts pass through it. D-60: 1-3/4 in (was 2 in).',
  },

  brakeKneeArmIn: {
    label: 'Knee arm thickness (under the hinge)', group: 'brake', unit: 'in',
    default: 1.25, min: 1, max: 2.5, step: 0.25, status: 'assumed', ref: 'D-57',
    note: 'The horizontal arm that reaches out over the gap beside the tire to the hinge; braced by a sloping underside.',
  },

  brakeBackerThickIn: {
    label: 'Backer (doubler) thickness inside the rail', group: 'brake', unit: 'in',
    default: 0.75, min: 0.75, max: 2, step: 0.25, status: 'assumed', ref: 'D-57, D-60',
    note: 'An oak block epoxied to the inside face of the rail (and the deck underside); the mounting bolts end in it. Joists that meet it are cut back. D-60: 3/4 in (was 1-1/4 in).',
  },

  brakeMountBoltDiaIn: {
    label: 'Knee mounting bolt diameter', group: 'brake', unit: 'in',
    default: 0.375, min: 0.25, max: 0.5, step: 0.0625, status: 'assumed', ref: 'D-57',
    note: '316 stainless hex bolts with fender washers and nylock nuts, through the knee leg, the rail and the backer.',
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
    default: 2.5, min: 1, max: 4, step: 0.25, status: 'assumed', ref: 'D-57',
    note: 'An oak wedge on a cord for parking; stays under the knee (never taller than the rail bottom).',
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

  brakeHingeScrewLenIn: {
    label: 'Hinge screw length', group: 'brake', unit: 'in',
    default: 1, min: 0.75, max: 1.5, step: 0.25, status: 'assumed', ref: 'D-57',
    note: 'Thread engagement in the oak is this length less the hinge leaf and a 0.1 in tip.',
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
    note: 'The released bungee torque about the hinge over the weight torque of the flap, shoe block and pad: so a bump does not drop the pad onto the tread.',
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
    label: 'Chine / gunwale stock thickness', group: 'stock', unit: 'in',
    default: 0.625, min: 0.375, max: 1, step: 0.0625, status: 'explore', ref: 'D-35, D-43',
    note: '⅝" leaves 0.17" walls beside the 0.276" groove (D-43) and a ⅜"-wide bearing face under the deck rabbet; the transoms have their own thickness.',
  },
  axleBeamThicknessIn: {
    label: 'Rear axle beam width (fore-aft)', group: 'stock', unit: 'in',
    default: 2.25, min: 1.5, max: 4, step: 0.125, status: 'explore', ref: 'D-60',
    note: 'D-60: 2-1/4 in (was 2-1/2 in); beam-rear stays about 0.19.',
  },
  frontBeamThicknessIn: {
    label: 'Front axle beam width (fore-aft)', group: 'stock', unit: 'in',
    default: 2.5, min: 1.5, max: 4, step: 0.125, status: 'explore', ref: 'D-56, D-58',
    note: 'The pivoting front beam (the rear beam is axleBeamThicknessIn). It sets the swing of the beam under the rails and the room for the tongue bolts. D-58: 2 1/2 in is enough for the 200 lb cargo bump (2 3/4 in was needed at 250 lb).',
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
    label: 'Side / box / lid plywood', group: 'stock', unit: 'in',
    default: 0.157, min: 0.157, max: 0.472, step: 0.001, status: 'explore', ref: 'D-60',
    options: [
      { value: 0.157, label: '4 mm' },
      { value: 0.236, label: '6 mm' },
      { value: 0.354, label: '9 mm' },
      { value: 0.472, label: '12 mm' },
    ],
    note: 'D-60: 4 mm okoume (was 6 mm) for the side webs, the storage box and its lid and the sign blanks; the groove, dado and edge-banding widths follow it. The seat-back panel has its own size (seatBackPlyIn, still 6 mm). 4 mm skin and lid dent more easily (the cargo case of the lid-load row goes from 0.42 to 0.75); keep the lid engraved DO NOT STEP (D-58).',
  },
  seatBackPlyIn: {
    label: 'Seat-back panel plywood', group: 'stock', unit: 'in',
    default: 0.236, min: 0.157, max: 0.472, step: 0.001, status: 'explore', ref: 'D-60',
    note: 'D-60: the seat-back panel stays 6 mm when the sides, box and lid go to 4 mm (the seat-back row was 0.53 at 6 mm and 1.09 at 4 mm).',
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
    note: 'Phase 3c-3b: a 10" x 3.5" pneumatic hand-truck tire (4.10/3.50-4, rated about 300 lb at 30 psi) squashes about 0.6" (18% of the 3.25" section) at its rating, so k is about 300 / 0.6 = 500 lb/in; it scales with inflation pressure and runs 300 (20 psi) to 900 (rim-bound). TO MEASURE: stand a known weight on the sled at one wheel (a 150 lb person on the frame over the wheel) and measure the tire squash with a ruler against the hub; k = load / squash. docs/phase3c-3b-notes.md.',
  },
  bumpMassShare: {
    label: 'Rigid-body bump mass multiplier', group: 'bump', unit: '×',
    default: 1, min: 0.5, max: 2, step: 0.05, status: 'assumed', ref: 'D-54',
    note: 'Phase 3c-3b: the effective mass at the struck wheel is the rigid-body corner mass of the whole sled, W / (1 + x²/ky² + y²/kx²), about W/7 for a uniform sled struck at a corner (a rigid sled pivots about its other contacts). This multiplier scales it: 1 = mass spread like a plate over the wheel footprint; above 1 = heavy ends (cargo piled at the wheels); below 1 = mass bunched at the middle. Before 3c-3b this was 1.5 x the wheel static load.',
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
  axleTubeUltimatePsi: {
    label: 'Axle tube ultimate strength (DOM)', group: 'factors', unit: 'psi',
    default: 80000, min: 45000, max: 140000, step: 1000, status: 'verify', ref: 'D-60',
    note: 'D-60: companion of axleTubeYieldPsi (1026 DOM about 80 ksi tensile minimum): the hard-hit rows use it with the fail-safe factor. Confirm on the vendor listing.',
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

/**
 * How far the hull's outer face has turned in at x, per side (D-57): 0 behind the turn-in start, `bowTurnInIn` at the bow bulkhead, a smoothstep between (so the sides are straight at both ends).
 * One function shared by the layout, the body, the frame and the front axle (the front tires sweep beside this part of the hull).
 */
export function bowTurnInAt(p: Params, x: number): number {
  const x1 = bowBulkhead(p).xFlatEnd;
  const x0 = x1 - p.bowTurnLenIn;
  const u = Math.max(0, Math.min(1, (x - x0) / Math.max(1e-6, x1 - x0)));
  return p.bowTurnInIn * u * u * (3 - 2 * u);
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
  const bodyHalfAt = (x: number) => bodyHalf - bowTurnInAt(p, x);
  const clearAtTrack = (track: number) => {
    const inner = track / 2 - tw / 2;
    let m = Infinity;
    for (const a of [lock, -lock]) {
      for (let i = 0; i <= 40; i++) {
        const u = -r + (2 * r * i) / 40;
        const x = kingX + u * Math.cos(a) - inner * Math.sin(a), y = u * Math.sin(a) + inner * Math.cos(a);
        m = Math.min(m, Math.abs(y) - bodyHalfAt(x));
      }
    }
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
  const beamTop = r + p.axleDiameterIn / 2;
  const beamBot = beamTop - p.axleBeamDepthIn;
  const tongueTop = beamTop; // D-58: the oak tongue butts the front of the beam, its top flush with the beam top (the disc lies directly on the beam)
  const thrustTop = beamTop + p.kingThrustThickIn;
  const kingBot = thrustTop;
  const kingDepth = deckBot - kingBot;
  // The axle beam sweeps under the rails at the lock angle: the rails are shallower where it passes.
  const railYIn = bodyHalf - p.railThicknessIn;
  const swathHalf = (p.frontBeamThicknessIn / 2) * Math.cos(lock) + bodyHalf * Math.sin(lock); // at the rail's OUTER face (|y| = bodyHalf), where the beam's trailing corner reaches furthest back
  const railDepthFront = Math.max(0, Math.min(p.railDepthIn, deckBot - (beamTop + 0.4)));
  const railStepX = kingX - swathHalf - 1;
  // The steering lock is set by two CHECK CHAINS (D-58): an eye bolt fore-aft through each end of the axle beam (`steerChainBeamYIn` from the kingpin, mid depth, the eye standing 0.7 in out
  // of the beam's TRAILING face) and an eye bolt fore-aft through the crossmember just behind the king beam (layout.ts: `chain`, `steerChainAnchorYIn` from the center line, the eye standing out of its
  // FRONT face). The RIGHT chain goes taut at +lock (the right end of the beam swings forward, away from the anchor behind it), the LEFT at -lock. The chains run under the king beam.
  const endJoistX = bowCurl(p).xFlatEnd - p.crossmemberThickIn / 2 - 0.05; // the last joist, under the scarf of the deck to the bow bulkhead
  const stand = 0.7;
  const beamU = -(p.frontBeamThicknessIn / 2 + stand);
  const beamZ = (beamTop + beamBot) / 2;
  /** The beam eye of the RIGHT chain at steering angle a (rad, + = turning left, the beam turned counter-clockwise from above). */
  const beamEyeAt = (a: number): [number, number, number] => [kingX + beamU * Math.cos(a) + p.steerChainBeamYIn * Math.sin(a), beamU * Math.sin(a) - p.steerChainBeamYIn * Math.cos(a), beamZ];
  return { lock, kingX, clearAtLock, minTrack, centerRadiusIn, outerEdgeRadiusIn, innerEdgeRadiusIn, beamTop, beamBot, tongueTop, thrustTop, kingBot, kingDepth, railYIn, swathHalf, railDepthFront, railStepX, endJoistX, beamU, beamZ, beamEyeAt, stand, deckBot };
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
  if (p.axleCrossHoleFromEndIn - p.axleCrossHoleDiaIn / 2 < 1.5 * p.axleCrossHoleDiaIn - 1e-6 || p.axleEndExtraIn - p.axleCrossHoleFromEndIn < 0.5)
    warn(['axleCrossHoleFromEndIn', 'axleCrossHoleDiaIn', 'axleEndExtraIn'], 'The cotter-pin cross hole is too close to the axle end (want an end distance of 1.5 hole diameters or more) or leaves less than 1/2" for the collar and washer.');
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
  if (p.bowBulkheadHeightIn - p.handleBowCrownIn < p.sideHeightBowIn - 1e-9)
    warn(['bowBulkheadHeightIn', 'handleBowCrownIn', 'sideHeightBowIn'], 'The bow bulkhead corners (its peak less the handlebow crown it echoes, 3c-5) are meant to be at least as high as the side tops at the bow, so the sides end against it (D-57).');
  if (p.bowBulkheadHeightIn < p.liftSlotClearIn + p.liftSlotHeightIn + p.liftBarMinIn - 1e-9)
    err(['bowBulkheadHeightIn', 'liftSlotClearIn', 'liftSlotHeightIn'], `The bow bulkhead is too low for the lift hand-hold: it needs ${(p.liftSlotClearIn + p.liftSlotHeightIn + p.liftBarMinIn).toFixed(2)}" at the center (hand clearance + slot + oak above).`);
  // Plan turn-in (D-57): the chine and gunwale are cold-bent flat in two plies; the smoothstep's tightest bend (6 x turn-in / length^2 curvature) must stay above the cold-bend limit.
  if (p.bowTurnInIn > 1e-9) {
    const rMin = (p.bowTurnLenIn * p.bowTurnLenIn) / (6 * p.bowTurnInIn);
    const lim = p.hullLamMinRadiusFactor * (p.sideThicknessIn / 2);
    if (rMin < lim - 1e-9)
      err(['bowTurnInIn', 'bowTurnLenIn', 'hullLamMinRadiusFactor'], `The bow turn-in bends the chine and gunwale to a ${rMin.toFixed(1)}" radius; two ${(p.sideThicknessIn / 2).toFixed(3)}" plies cold-bend to ${lim.toFixed(1)}" at best: lengthen the turn-in or reduce it.`);
    if (p.bowTurnInIn * 2 > p.bodyWidthIn - 12)
      err(['bowTurnInIn', 'bodyWidthIn'], 'The bow turn-in would pinch the nose below 12" wide.');
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
    err(['deckHeightIn', 'kingThrustThickIn', 'axleBeamDepthIn'], `The pivot stack (axle beam top ${sg.beamTop.toFixed(2)}" + thrust disc) leaves only ${sg.kingDepth.toFixed(2)}" for the king beam under the deck; raise the deck to at least ${(sg.kingBot + 1 + p.deckPlyIn).toFixed(2)}".`);
  if (sg.railDepthFront < 1 - 1e-9)
    err(['deckHeightIn', 'railDepthIn'], `The rails would be only ${sg.railDepthFront.toFixed(2)}" deep where the axle beam swings under them; raise the deck.`);
  if (p.wheelbaseIn + 3 > curl.xFlatEnd + 1e-9)
    err(['wheelbaseIn', 'frontOverhangIn'], 'The front axle runs onto the bow bulkhead: lengthen the front overhang.');
  {
    // The steering chains (D-58): the beam eye must lie between the kingpin zone and the clamp plates (the anchor eye pulls in by itself on a narrow body, layout.ts).
    if (p.bodyWidthIn - 2 * p.bowTurnInIn < 13)
      err(['bodyWidthIn', 'bowTurnInIn'], `The bow turn-in pinches the nose to ${(p.bodyWidthIn - 2 * p.bowTurnInIn).toFixed(1)}" at the bulkhead; it needs 13" for the hand-hold, the foot brace and the tongue.`);
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
      const plateOut = (p.frontTrackIn - p.hubLengthIn - 0.25) / 2 - 0.25 - p.clampPlateWidthIn; // outer station's inner edge
      if (p.rollPadRadiusIn - p.rollPadLenIn / 2 < plateIn + 0.1 || p.rollPadRadiusIn + p.rollPadLenIn / 2 > plateOut - 0.1)
        warn(['rollPadRadiusIn', 'rollPadLenIn', 'frontStubLenIn'], `The roll pads (${(p.rollPadRadiusIn - p.rollPadLenIn / 2).toFixed(1)}" to ${(p.rollPadRadiusIn + p.rollPadLenIn / 2).toFixed(1)}" from the center) must lie between the stub clamp plates on the axle beam (free from ${plateIn.toFixed(1)}" to ${plateOut.toFixed(1)}").`);
    }
    if (p.kingThrustOdIn > 4 || p.kingThrustOdIn > p.kingBeamLengthIn + 1)
      warn(['kingThrustOdIn', 'kingBeamLengthIn'], 'The thrust disc is much wider than the king beam that carries it; lengthen the king beam.');
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
