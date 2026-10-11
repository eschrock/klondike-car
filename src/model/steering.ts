/**
 * Steering: turntable, bolster, kingpin, stops, tongue, bridle (D-12, D-14); Phase 3 detail (D-31…D-34):
 *  - steering stops: steel-faced oak dogs on the beam, four oak stop blocks in the corners of the bolster opening (M1),
 *  - structured bolster fasteners the analysis reads (M7), kingpin sleeve / hub specs (M11),
 *  - bridle eye bolts at the front beam and rope legs that start at them (M6),
 *  - the removable kingpin-nut access panel in the nose deck (M10).
 */
import { DRAWBAR, steerStopPlan, kingpinPlatesOn, kingpinWasherEffectiveIn } from '../params';
import { IN3_PER_FT3, STEP, box, cylinder, span, SIDES, woodMassLb, type Ctx } from './build-utils';
import { kingpinPlatePlan, stopArmHx, stopArmThick } from './kingpin-plates';
import { compose } from './mat4';
import { circlePath, customPart, mergeMeshes, pathLength, tubeAlong } from './mesh-utils';
import type { Joint, Part, Vec2, Vec3 } from './types';

// ── Block-model placeholders ──
/** Bridle rope: reach ahead of the tongue tip, section, mass (spec). */
const BRIDLE_LEN_IN = 18;
/** Rope bridle: ring this far ahead of the front axle. */
export const BRIDLE_APEX_AHEAD_IN = 24;
const BRIDLE_SECTION_IN = 0.5;
const BRIDLE_MASS_LB = 1;
/** Bolster fastener rows sit this far in from the ends of the fore and aft rails. */
const RING_BOLT_END_IN = 1;
/** Eye-bolt ring: tube radius as a fraction of the shank, ring outside diameter as a multiple of the shank diameter. */
const EYE_TUBE_FRAC = 0.9;
const EYE_OD_FACTOR = 2.7;
/** Extra bolt length past the grip for the nut and thread (in). */
const NUT_ALLOWANCE_IN = 0.75;

const VENDOR = 'McMaster-Carr or equivalent';

const unit = (v: Vec3): Vec3 => { const n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };

/** 3/8 -> "3/8", 0.75 -> "3/4" (nearest 1/16). */
export function frac(x: number): string {
  const w = Math.floor(x + 1e-9);
  const sixteenths = Math.round((x - w) * 16);
  if (sixteenths === 0) return `${w}`;
  if (sixteenths === 16) return `${w + 1}`;
  let n = sixteenths, d = 16;
  while (n % 2 === 0) { n /= 2; d /= 2; }
  return `${w > 0 ? `${w}-` : ''}${n}/${d}`;
}

/** Bolt positions for `n` through-bolts on the bolster rails: half on the fore rail, half on the aft, staggered about the crossbar. */
export function ringBoltLayout(n: number, bo: { x0: number; x1: number; halfY: number; rw: number }, cb: number): Array<{ rail: 'fore' | 'aft'; x: number; y: number }> {
  const out: Array<{ rail: 'fore' | 'aft'; x: number; y: number }> = [];
  const yr = bo.halfY - RING_BOLT_END_IN;
  for (const rail of ['fore', 'aft'] as const) {
    const k = rail === 'fore' ? Math.ceil(n / 2) : Math.floor(n / 2);
    const m = Math.ceil(k / 2);
    const lo = cb + 1;
    const ys = Array.from({ length: m }, (_, j) => (m === 1 ? yr : lo + ((yr - lo) * j) / (m - 1)));
    const x = rail === 'fore' ? bo.x1 - bo.rw / 2 : bo.x0 + bo.rw / 2;
    for (let i = 0; i < k; i++) {
      const sgn = (i + (rail === 'fore' ? 0 : 1)) % 2 === 0 ? 1 : -1;
      out.push({ rail, x, y: sgn * ys[Math.floor(i / 2)] });
    }
  }
  return out;
}

// ── Kingpin bolt (r3 fittings, build S5): a real purchasable grade-8 hex bolt whose UNTHREADED shank covers every bearing plane ──
/** Grade-8 hex bolt body diameter tolerance below nominal (ASME B18.2.1, 3/4": 0.7439-0.7500). */
export const PIN_BODY_TOL_IN = 0.0061;
/** Hardened flat washer thickness and regular hex nut height as multiples of the bolt diameter (3/4": 0.134" and 41/64"), threads per inch of the coarse series. */
export const WASHER_T_PER_D = 0.178;
export const NUT_H_PER_D = 0.855;
/** Catalog lengths of a grade-8 hex bolt in this size range (in): 1/2" steps. */
export const BOLT_LENGTHS_IN = [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 9, 10];
/** ASME B18.2.1 hex bolt thread length: 2D + 1/4" up to 6" long, 2D + 1/2" over 6". */
export const hexBoltThreadIn = (D: number, L: number): number => 2 * D + (L <= 6 + 1e-9 ? 0.25 : 0.5);
/** Shank kept beyond the last bearing plane before the thread starts. */
export const KINGPIN_SHANK_MARGIN_IN = 0.25;
/** Oak left between the crossbar plate and the floor of the nut counterbore. */
export const KINGPIN_FLOOR_OAK_IN = 0.25;
const roundUp = (x: number, step: number) => Math.ceil(x / step - 1e-9) * step;

export interface KingpinBolt {
  /** Catalog length bought, thread length of that bolt, and its unthreaded shank (under the head). */
  buyIn: number; threadIn: number; shankIn: number;
  /** Shank the bearing planes need (head underside to the top of the last plane + margin). */
  needIn: number;
  /** Hardened washer under the head (thick), washers under the nut (count), nut height, thread pitch. */
  washerIn: number; nTopWashers: number; nutIn: number; pitchIn: number;
  /** Length after cutting the tail to the nut (head underside to the tail). */
  cutIn: number;
  /** z of the head underside, of the thread start, and of the cut tail. */
  zHead: number; zThread: number; zTail: number;
  /** Threaded length left after the cut, and the nut's engagement on it. */
  threadLeftIn: number;
}

/**
 * Select the bolt. The pin bears in the beam plate, the carrier and the crossbar plate (the sleeve hands the reactions to the plates), so the
 * unthreaded shank runs from the head to `zShearTop` + a margin; the nut and its washer sit in a counterbore in the crossbar top whose floor is `zFloor`
 * (at least 1/4" of oak above the crossbar plate), on enough hardened washers to reach the first thread; the tail is cut off 2 threads past the nut.
 */
export function kingpinBolt(D: number, zUnderPlate: number, zShearTop: number, zFloor: number): KingpinBolt {
  const washerIn = WASHER_T_PER_D * D;
  const nutIn = NUT_H_PER_D * D;
  const pitchIn = 1 / (D >= 0.75 ? 10 : D >= 0.625 ? 11 : 13); // UNC coarse, 3/8..3/4
  const zHead = zUnderPlate - washerIn;
  const needIn = zShearTop - zHead + KINGPIN_SHANK_MARGIN_IN;
  const buyIn = BOLT_LENGTHS_IN.find((L) => L - hexBoltThreadIn(D, L) >= needIn - 1e-9) ?? roundUp(needIn + hexBoltThreadIn(D, 8), 1);
  const threadIn = hexBoltThreadIn(D, buyIn);
  const shankIn = buyIn - threadIn;
  const zThread = zHead + shankIn;
  const nTopWashers = Math.max(1, Math.ceil((zThread - zFloor) / washerIn - 1e-9));
  const zNutBot = zFloor + nTopWashers * washerIn;
  const zTail = zNutBot + nutIn + 2 * pitchIn;
  const cutIn = Math.min(buyIn, roundUp(zTail - zHead, 1 / 8));
  return { buyIn, threadIn, shankIn, needIn, washerIn, nTopWashers, nutIn, pitchIn, cutIn, zHead, zThread, zTail: zHead + cutIn, threadLeftIn: zHead + cutIn - zThread };
}

/** Counter-clockwise rounded rectangle (corner radius clamped to the half sides), `seg` chords per corner. Used by the kingpin-access opening and its panel (r3 build S12). */
export function roundedRectCCW(x0: number, x1: number, y0: number, y1: number, r: number, seg = 6): Vec2[] {
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2 - 1e-6, (y1 - y0) / 2 - 1e-6));
  if (rr < 1e-6) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const out: Vec2[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let k = 0; k <= seg; k++) { const a = a0 + (Math.PI / 2) * (k / seg); out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
  };
  corner(x1 - rr, y0 + rr, -Math.PI / 2);
  corner(x1 - rr, y1 - rr, 0);
  corner(x0 + rr, y1 - rr, Math.PI / 2);
  corner(x0 + rr, y0 + rr, Math.PI);
  return out;
}

/** Round a stock size up to the next 1/32" (the shop's smallest practical step). */
export const roundUp32 = (x: number): number => roundUp(x, 1 / 32);

export function buildSteering(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const ts = p.turntableSizeIn;
  const kx = L.kx;
  const bo = L.bolster;
  const cb = L.crossbar;
  const ringDepth = bo.z1 - bo.z0;
  const nBolt = Math.max(1, Math.round(p.bolsterFastenerCount));
  const boltDia = p.bolsterFastenerDiameterIn;
  const bolts = ringBoltLayout(nBolt, bo, cb ? cb.hw : 0);
  const kp = kingpinPlatePlan(p); // kingpin steel plate bolt groups (D-43)
  const plates = kingpinPlatesOn(p) && !!L.kpPlates;

  // ── Turntable ──
  parts.push(box(ctx, {
    id: 'turntable', name: 'Turntable (lazy susan)', group: 'steering', steer: true, mat: 'fixed', massLb: p.turntableMassLb,
    kind: 'purchased', material: 'steel turntable bearing', fab: 'buy', step: STEP.steering,
    ...span([kx - ts / 2, kx + ts / 2], [-ts / 2, ts / 2], [L.turntable.z0, L.turntable.z1]),
    sourcing: { vendor: `${VENDOR}: ${ts}" square lazy-susan turntable bearing, rated ${p.turntableRatingLb} lb (D-28; catalog estimate, verify the part bought)` },
    joints: kingpinPlatesOn(p)
      ? [{ type: 'screw', to: 'kp-carrier', count: 2, size: '1/4-20 × 3/4" flat-head screws through the bottom plate\'s inner flange into the carrier', diaIn: 0.25, note: `Verify the bought bearing (M12): a 12" square lazy susan has its mounting holes in the corners (about 10" apart), which cannot land on the ${p.frontAxleBeamThicknessIn}"-wide beam. Drill two holes in the bottom plate's inner flange (r ≈ ${(p.turntableCenterHoleIn / 2 + 0.25).toFixed(2)}") clear of the ball race, and tap the carrier.` }]
      : [{ type: 'screw', to: 'beam-F', count: 4, size: `${frac(5 / 16)}" × 2-1/2" lag screws through the bottom-plate holes into the beam top`, diaIn: 5 / 16, note: 'Bottom plate on the front beam; the top plate carries the bolster ring.' }],
    notes: `Centerd on the kingpin (D-25). Estimate mass; ${p.turntableRatingLb} lb rated (D-12), thrust only: the roll moment goes through the side-bearers and the pitch moment through the sleeved kingpin couple and the bolster rails (D-32). Its top plate carries the bolster rails; the kingpin, the steel sleeve, the stop arms and the kingpin plates live inside its ${p.turntableCenterHoleIn}" center hole (D-43, assumed: a 12" lazy susan has a ~6" open center; verify) and touch neither plate.`,
  }));

  // ── Bolster ring: two oak rails fore and aft of the kingpin plus two end rails, bearing on the turntable top plate ──
  const depthNote = bo.z1 - bo.z0 <= p.bolsterMinDepthIn + 1e-9 ? 'Depth raised to the minimum; see the validator.' : undefined;
  const ringBolt = (rail: 'fore' | 'aft', cx: number): Joint => {
    const mine = bolts.filter((b) => b.rail === rail);
    return {
      type: 'bolt', to: 'deck-nose', count: mine.length, diaIn: boltDia,
      size: `${frac(boltDia)}" carriage bolt, through the nose deck, the rail and the turntable top plate; nut + washer under the plate`,
      at: mine.map((b): Vec3 => [b.x - cx, b.y, 0]),
      note: 'The structural fasteners that tie the bolster ring to the hull: roll-bolster-attach reads their count and diameter (M7).',
    };
  };
  for (const [tag, name, x0, x1] of [['fore', 'Front', bo.x1 - bo.rw, bo.x1], ['aft', 'Rear', bo.x0, bo.x0 + bo.rw]] as const) {
    const cx = (x0 + x1) / 2;
    parts.push(box(ctx, {
      id: `bolster-${tag}`, name: `${name} bolster rail`, group: 'steering', mat: 'oak', grain: 'y', step: STEP.steering,
      ...span([x0, x1], [-bo.halfY, bo.halfY], [bo.z0, bo.z1]), notes: depthNote,
      joints: [
        ringBolt(tag, cx),
        { type: 'glue', to: `bolster-end-L`, count: 1, note: 'End rail butts the rail face; glued, with two screws.' },
        { type: 'glue', to: `bolster-end-R`, count: 1, note: 'End rail butts the rail face; glued, with two screws.' },
        ...(cb ? [{ type: 'dado' as const, to: 'kingpin-crossbar', count: 1, size: `${p.kingpinCrossbarLetInIn}" deep × ${(2 * cb.hw).toFixed(2)}" wide notch for the crossbar end` }] : []),
        { type: 'glue', to: `stop-block-${tag === 'aft' ? 'A' : 'F'}L`, count: 1, note: 'Stop block glued and screwed to the rail face.' },
        { type: 'glue', to: `stop-block-${tag === 'aft' ? 'A' : 'F'}R`, count: 1, note: 'Stop block glued and screwed to the rail face.' },
      ],
    }));
  }
  for (const { s, tag } of SIDES) {
    parts.push(box(ctx, {
      id: `bolster-end-${tag}`, partNo: 'bolster-end', name: `Bolster end rail ${tag}`, group: 'steering', mat: 'oak', grain: 'x', step: STEP.steering,
      ...span([bo.x0 + bo.rw, bo.x1 - bo.rw], [Math.min(s * (bo.halfY - bo.rw), s * bo.halfY), Math.max(s * (bo.halfY - bo.rw), s * bo.halfY)], [bo.z0, bo.z1]),
      notes: 'Rides over the side-bearer rub block (D-12).',
      joints: [
        { type: 'glue', to: 'bolster-fore', count: 1 }, { type: 'glue', to: 'bolster-aft', count: 1 },
        { type: 'screw', to: 'bolster-fore', count: 2, size: '#10 × 2-1/2" countersunk, through the fore rail into the end grain', diaIn: 0.19 },
        { type: 'screw', to: 'bolster-aft', count: 2, size: '#10 × 2-1/2" countersunk, through the aft rail into the end grain', diaIn: 0.19 },
      ],
    }));
  }

  // ── Side bearers (D-12, critic r2 M5): oak blocks housed in the beam top beside the turntable plate, each with a UHMW wear strip ──
  const sb = L.sideBearer;
  for (const { s, tag } of SIDES) {
    const yr: [number, number] = [Math.min(s * sb.y0, s * sb.y1), Math.max(s * sb.y0, s * sb.y1)];
    parts.push(box(ctx, {
      id: `side-bearer-${tag}`, partNo: 'side-bearer', name: `Side-bearer block ${tag}`, group: 'steering', steer: true, mat: 'oak', grain: 'z', step: STEP.steering,
      ...span([sb.x0, sb.x1], yr, [sb.z0, sb.z1]),
      joints: [
        { type: 'glue', to: 'beam-F', count: 1, size: `${p.sideBearerEmbedIn}" deep mortise in the beam top`, note: 'Epoxy bed in the mortise.' },
        { type: 'screw', to: 'beam-F', count: 2, size: '#10 × 2" countersunk, down through the block into the beam', diaIn: 0.19 },
      ],
      notes: `Housed ${p.sideBearerEmbedIn}" into a mortise in the beam top (glued + screwed); carries roll moment under the bolster rail (D-12).`,
    }));
    const wearVol = (sb.x1 - sb.x0) * (sb.y1 - sb.y0) * p.sideBearerWearIn;
    parts.push(box(ctx, {
      id: `side-bearer-wear-${tag}`, partNo: 'side-bearer-wear', name: `Side-bearer UHMW wear strip ${tag}`, group: 'steering', steer: true, mat: 'fixed',
      massLb: (wearVol / 1728) * p.uhmwDensityPcf, kind: 'purchased', material: 'UHMW-PE strip', fab: 'buy', step: STEP.steering,
      ...span([sb.x0, sb.x1], yr, [sb.z1, sb.zw]),
      sourcing: { vendor: `${VENDOR}: ${frac(p.sideBearerWearIn)}" UHMW-PE sheet, cut to size` },
      joints: [{ type: 'screw', to: `side-bearer-${tag}`, count: 2, size: '#6 countersunk flat-head, counterbored below the surface', diaIn: 0.14 }],
      notes: `${p.sideBearerClearanceIn}" running clearance to the bolster rail underside (the chassis-side bearer face); screwed to the block.`,
    }));
  }

  // ── Kingpin: ahead of the axle (D-25), through the solid beam and the turntable center and, with kingpinThroughBolster (D-12), on up through the oak crossbar ──
  // With the plates (D-43) the pin bears only in the beam plate, the carrier and the crossbar plate; the nut sits in a counterbore in the crossbar top (floor 1/4" above the plate) with
  // the crossbar (the pin touches no oak), so the unthreaded shank must reach just past the crossbar plate. A grade-8 hex bolt is bought long enough for that
  // (ASME B18.2.1 thread length) and the tail is cut off at the nut (r3 fittings, build S5).
  const stack = L.kingpin.z1 - L.kingpin.z0;
  const kb = plates ? kingpinBolt(p.kingpinDiameterIn, L.kpPlates!.under.z0, L.kpPlates!.bar.z1, L.kpPlates!.bar.z1 + KINGPIN_FLOOR_OAK_IN) : null;
  const kpTop = kb ? Math.min(kb.zTail, L.kingpin.z1) : L.kingpin.z1; // never above the crossbar top (the access panel lies on it)
  const kpLen = Math.ceil((stack + 0.25 * p.kingpinDiameterIn + 0.85 * p.kingpinDiameterIn + NUT_ALLOWANCE_IN / 3) * 4) / 4;
  const boltWhat = kb
    ? `SAE grade 8 hex bolt ${frac(p.kingpinDiameterIn)}-10 × ${frac(kb.buyIn)}" (ASME B18.2.1: thread ${kb.threadIn.toFixed(2)}", unthreaded shank ${kb.shankIn.toFixed(2)}" under the head; the planes need ${kb.needIn.toFixed(2)}": head underside to 1/4" past the top of the crossbar plate), cut the tail to ${frac(kb.cutIn)}" overall after the nut is on (${kb.threadLeftIn.toFixed(2)}" of thread left; chase it with a die), 1 hardened washer under the head and ${kb.nTopWashers} under the nut (${kb.washerIn.toFixed(3)}" each, so the nut starts on the first thread), castle nut + cotter pin`
    : `SAE grade 8 hex bolt ${frac(p.kingpinDiameterIn)}" × ${kpLen}" with an UNTHREADED shank for the whole grip ≥ ${stack.toFixed(2)}", hardened washers, lock nut`;
  parts.push(cylinder(ctx, {
    id: 'kingpin', name: 'Kingpin (grade-8 bolt)', group: 'steering', mat: 'steel', kind: 'purchased', fab: 'buy', step: STEP.kingpin,
    center: [kx, 0, (L.kingpin.z0 + kpTop) / 2], axis: 'z', radius: p.kingpinDiameterIn / 2,
    length: kpTop - L.kingpin.z0,
    sourcing: { vendor: `${VENDOR}: ${boltWhat}` },
    joints: cb ? [
      { type: 'bolt', to: 'kingpin-crossbar', count: 1, diaIn: p.kingpinDiameterIn, size: `${frac(p.kingpinDiameterIn)}" grade 8; head + washer under the beam plate, castle nut and ${frac(kingpinWasherEffectiveIn(p))}" washer in a counterbore in the crossbar top (floor ${KINGPIN_FLOOR_OAK_IN}" above the crossbar plate; the pin runs in a clearance bore and does not touch the oak)`, note: kb ? `Thread starts ${(kb.zThread - kb.zHead).toFixed(2)}" above the head underside, ${(kb.zThread - L.kpPlates!.bar.z1).toFixed(2)}" above the top of the crossbar plate: every bearing plane is on the shank. Pin is a free-running fit in the sleeve (reamed ${(p.kingpinDiameterIn + p.kingpinSleeveClearIn).toFixed(3)}"), not in the turntable center hole.` : 'Pin is a tight fit in the sleeves, not in the turntable center hole.' },
    ] : [
      { type: 'bolt', to: 'turntable', count: 1, diaIn: p.kingpinDiameterIn, size: `${frac(p.kingpinDiameterIn)}" grade 8; head let into the turntable plate` },
    ],
    notes: cb
      ? `Mass is the steel shank only; nut and washers are in the hardware allowance. Head + hardened washer under the beam plate, castle nut and washer in the counterbore in the crossbar top (reached through the access panel in the nose deck, M10). D-43: the pin runs in the steel sleeve through the beam (supported at the carrier and the beam plate) and bears on the crossbar plate; it touches no oak. Snug nut, no preload on the turntable (castle nut + cotter).${kb ? ` Bolt: ${boltWhat}.` : ''}`
      : 'Mass is the steel shank only; nut and washers are in the hardware allowance. Head is let into the turntable plate.',
  }));

  // ── Chassis-side kingpin crossbar (D-12): fore-aft oak bar across the bolster opening, ends let into the bolster rails, top flush with them ──
  if (cb) {
    const ap = L.accessPanel;
    const insertAt = ap ? ([[-1, -1], [-1, 1], [1, -1], [1, 1]] as const).map(([sx, sy]): Vec3 => [sx * (ap.x1 - ap.x0) * 0.34, sy * ap.hw * 0.6, (cb.z1 - cb.z0) / 2]) : []; // local frame: the top face is +half the bar height
    const crossbarJoints: Joint[] = [
      { type: 'dado', to: 'bolster-aft', count: 1, size: `${p.kingpinCrossbarLetInIn}" let-in, end grain bears on the notch face` },
      { type: 'dado', to: 'bolster-fore', count: 1, size: `${p.kingpinCrossbarLetInIn}" let-in, end grain bears on the notch face` },
      ...(kingpinPlatesOn(p)
        ? [{ type: 'bolt' as const, to: 'kp-bar-plate', count: 4, diaIn: p.kingpinPlateBoltDiameterIn, size: `${frac(p.kingpinPlateBoltDiameterIn)}" grade 8 bolts through the plate and the crossbar, nuts in counterbores in the crossbar top`, at: kp.barX.map((x): Vec3 => [x, 0, 0]), note: 'The pin force enters the oak only here: roll-bolster / kingpin-bolts rows (NDS dowel bearing, row tear-out).' }]
        : [{ type: 'screw' as const, to: 'turntable', count: 2, size: '#10 × 2-1/2" pan-head, through the crossbar into the top plate', diaIn: 0.19 }]),
      ...(kingpinPlatesOn(p)
        ? [{ type: 'bolt' as const, to: 'kp-bar-plate', count: kp.crossBarX.length, diaIn: p.kingpinCrossBoltDiameterIn, size: `${frac(p.kingpinCrossBoltDiameterIn)}" 316 stainless cross-bolts through the crossbar width, ${frac(p.kingpinCrossBoltWasherIn)}" OD fender washers`, at: kp.crossBarX.map((x): Vec3 => [x, 0, 0]), note: 'Stitch the crossbar against cleavage from the lateral pin load (NDS 3.4.3.3, kingpin-split row).' }]
        : []),
    ];
    if (ap) crossbarJoints.push({ type: 'threaded-insert', to: 'nose-access-panel', count: 4, size: '#10-24 stainless knurled brass insert × 1/2", epoxied 3/4" into the crossbar top', diaIn: 0.19, at: insertAt });
    parts.push(box(ctx, {
      id: 'kingpin-crossbar', name: 'Kingpin crossbar', group: 'steering', mat: 'oak', grain: 'x', step: STEP.steering,
      ...span([cb.x0, cb.x1], [-cb.hw, cb.hw], [cb.z0, cb.z1]),
      joints: crossbarJoints,
      notes: `Ties the kingpin to the chassis (real wagon practice). Ends let ${p.kingpinCrossbarLetInIn}" into the fore and aft bolster rails, top flush; bolted down to the turntable top plate. The four stop blocks bear on its sides (M1). Clear of the steering stops over the full ±${p.steerLockDeg}° sweep.`,
    }));
  }

  // ── Steel sleeve (kingpinSleeveOdIn > 0): with the kingpin plates (D-43) one tube spans the beam from the plate under it to the carrier on top
  // (spigoted into both, flush with their outer faces); without them (Phase 1 pin) a tube is pressed into each bore as before ──
  if (p.kingpinSleeveOdIn > 0) {
    const od = p.kingpinSleeveOdIn, id = p.kingpinDiameterIn;
    const wall = (od - id) / 2;
    const tube = (len: number) => (Math.PI / 4) * (od * od - id * id) * len;
    const ends: Array<[string, string, number, number, boolean]> = plates
      ? [['beam', 'beam and both plates', L.kpPlates!.under.z0, L.kpPlates!.carrier.z1, true]]
      : [['beam', 'beam', L.beamF.bot, L.beamF.top, true]];
    if (cb && !plates) ends.push(['bar', 'crossbar', cb.z0, cb.z1, false]);
    for (const [tag, where, z0, z1, steer] of ends) {
      parts.push(cylinder(ctx, {
        id: `kingpin-sleeve-${tag}`, partNo: 'kingpin-sleeve', name: `Kingpin sleeve (${where} bore)`, group: 'steering', steer, mat: 'fixed',
        massLb: (tube(z1 - z0) / IN3_PER_FT3) * p.steelDensityPcf, kind: 'purchased', material: `${frac(od)}" OD × ${frac(wall)}" wall DOM steel tube (A36 / 1020)`, fab: 'buy', step: STEP.steering,
        center: [kx, 0, (z0 + z1) / 2], axis: 'z', radius: od / 2, length: z1 - z0,
        sourcing: { vendor: `${VENDOR}: ${frac(od)}" OD × ${frac(wall)}" wall DOM (drawn-over-mandrel) steel tube (bought ID about ${id.toFixed(3)}" ± 0.005", which can be SMALLER than a grade-8 pin body of 0.7439-0.7500"), cut ${(z1 - z0).toFixed(2)}" long, then ream or hone the bore to ${(id + p.kingpinSleeveClearIn).toFixed(3)}" +0.002/-0.000 (machine shop, or an adjustable reamer): ${p.kingpinSleeveClearIn.toFixed(3)}-${(p.kingpinSleeveClearIn + 0.002 + PIN_BODY_TOL_IN).toFixed(3)}" diametral clearance on the pin, so the pin turns with a few thousandths of play and never binds` },
        joints: plates
          ? [
            { type: 'pin', to: 'kp-carrier', count: 1, size: `${od.toFixed(3)}" OD spigot in the carrier hole`, note: 'Reaction of the pin at the top of the beam (the carrier plate carries it to the beam through the plate bolts).' },
            { type: 'pin', to: 'kp-under', count: 1, size: `${od.toFixed(3)}" OD spigot in the beam-plate hole`, note: 'Reaction of the pin at the bottom of the beam.' },
            { type: 'glue', to: 'beam-F', count: 1, size: `${od.toFixed(3)}" OD, epoxy-bedded in a reamed bore`, note: 'The epoxy bed seals the bore; its strength is NOT counted (the plates carry the pin force).' },
          ]
          : [{ type: 'glue', to: where === 'beam' ? 'beam-F' : 'kingpin-crossbar', count: 1, size: `${od.toFixed(3)}" OD, press fit in a ${od.toFixed(3)}" reamed bore + epoxy`, note: 'The oak bears on the sleeve OD; the pin bears on its bore (M2 peak-bearing check).' }],
        notes: plates
          ? `${od}" OD × ${wall}" wall DOM tube, ${(z1 - z0).toFixed(2)}" long, bore reamed/honed to ${(id + p.kingpinSleeveClearIn).toFixed(3)}" (D-47), running from the plate under the beam to the carrier on top (D-43): the pin runs in it, it spigots into both plates, and the plates' bolt groups carry the pin force into the beam. Drawn solid.`
          : `${od}" OD × ${wall}" wall DOM tube, ${(z1 - z0).toFixed(2)}" long, pressed and epoxied into the ${where} bore; the oak bears on the OD and the pin on the bore. Drawn solid.`,
      }));
    }
  }

  // ── Kingpin steel plates (D-43): carrier on the beam, plate under the beam, plate under the crossbar ──
  if (plates) {
    const kpl = L.kpPlates!;
    const fabNote = 'Outsourced: waterjet / laser cut by a service (SendCutSend / Oshcut class), deburred, zinc-rich primer + paint; build review M11.';
    const steelPlate = (id: string, name: string, x: [number, number], y: [number, number], z: [number, number], joints: Joint[], notes: string, steer: boolean, sourcing: string) => {
      parts.push(box(ctx, {
        id, name, group: 'steering', steer, mat: 'steel', kind: 'metal', material: 'A36 steel plate', fab: 'outsource', step: STEP.steering,
        ...span(x, y, z), joints, notes: `${notes} ${fabNote}`, sourcing: { vendor: sourcing },
      }));
    };
    const pitchY = kp.beamY[4] - kp.beamY[3];
    const preloadTq = p.kingpinPlateBoltNutFactor * kp.D * p.kingpinPlateBoltPreloadLb; // lb·in, T = K·D·F
    const preloadNote = `ASSEMBLY: snug, then torque to ${(preloadTq / 12).toFixed(1)} lb·ft (${preloadTq.toFixed(0)} lb·in = K ${p.kingpinPlateBoltNutFactor} × D × ${p.kingpinPlateBoltPreloadLb} lbf preload) with two Belleville washers under each head; retorque after the first wet day.`;
    steelPlate('kp-carrier', 'Kingpin carrier plate (on the beam, under the turntable)', [kx - kp.carrier.hx, kx + kp.carrier.hx], [-kp.carrier.hy, kp.carrier.hy], [kpl.carrier.z0, kpl.carrier.z1], [
      { type: 'bolt', to: 'beam-F', count: kp.beamY.length, diaIn: kp.D, size: `${frac(kp.D)}" grade 8 hex bolts from BELOW (head and Belleville washers under the beam plate), threaded into the tapped carrier; thread length trimmed to the carrier so the shank bears in the oak (no countersink in the load path, r3 N-2)`, at: kp.beamY.map((y): Vec3 => [kp.beamX, y, 0]), note: `One line along the beam through the pin, ${pitchY.toFixed(3)}" apart (NDS 5D rows for a load across the grain). Carries the pin force and the carrier's ${(p.kingpinTorqueTopShare * 100).toFixed(0)}% share of the stop torque into the beam (kingpin-bolts row). ${preloadNote}` },
      { type: 'screw', to: 'turntable', count: 2, size: '1/4-20 tapped holes for the bearing\'s bottom-plate screws', diaIn: 0.25, at: [[0, p.turntableCenterHoleIn / 2 + 0.25, 0], [0, -(p.turntableCenterHoleIn / 2 + 0.25), 0]] },
    ], `${frac(p.carrierPlateThickIn)}" A36 strip ${(2 * kp.carrier.hx).toFixed(2)}" × ${(2 * kp.carrier.hy).toFixed(2)}" lying on the beam top, over the axle rod (flush in its groove) and the beam: it is the lazy susan's whole lower support (r3 N-5, D-47): the bearing's bottom plate stands on it (M12: the mounting plate), the ball ring is over steel for ${(2 * kp.carrier.hx).toFixed(1)}" of its ${p.turntableRaceDiaIn}" diameter, the overhang beyond it is the bearing's own lower plate (pitch-path row). The sleeve spigots into it, the stop arms screw to it. The front edge is ${(kp.carrier.hx - (L.beamF.x + L.beamF.thick / 2 - kx)).toFixed(2)}" ahead of the beam front face and carries the ear tabs.`, true,
    `${VENDOR} or a laser service: ${p.carrierPlateThickIn}" A36 plate, ${(2 * kp.carrier.hx).toFixed(2)}" × ${(2 * kp.carrier.hy).toFixed(2)}", ${kp.beamY.length} × ${frac(kp.D)}" countersunk holes, 1-1/4" sleeve hole, two 1/4-20 tapped holes, four stop-arm screw holes tapped ${frac(p.steerStopScrewDiameterIn)}-16`);
    steelPlate('kp-under', 'Kingpin plate (under the beam)', [kx - kp.under.hx, kx + kp.under.hx], [-kp.under.hy, kp.under.hy], [kpl.under.z0, kpl.under.z1], [
      { type: 'bolt', to: 'beam-F', count: kp.beamY.length, diaIn: kp.D, size: `${frac(kp.D)}" grade 8 bolt heads + two Belleville washers each, under the plate`, at: kp.beamY.map((y): Vec3 => [kp.beamX, y, 0]), note: preloadNote },
    ], `${frac(p.kingpinPlateThickIn)}" A36 strip under the beam, ${(2 * kp.under.hx).toFixed(2)}" × ${(2 * kp.under.hy).toFixed(2)}" (narrower than the carrier). The pin head and its hardened washer bear on its underside; the sleeve spigots into it.`, true,
    `${VENDOR} or a laser service: ${p.kingpinPlateThickIn}" A36 plate, ${(2 * kp.under.hx).toFixed(2)}" × ${(2 * kp.under.hy).toFixed(2)}", ${kp.beamY.length} × ${frac(kp.D)}" holes, 1-1/4" sleeve hole`);
    steelPlate('kp-bar-plate', 'Kingpin plate (under the crossbar)', [kx - kp.bar.hx, kx + kp.bar.hx], [-kp.bar.hy, kp.bar.hy], [kpl.bar.z0, kpl.bar.z1], [
      { type: 'bolt', to: 'kingpin-crossbar', count: kp.barX.length, diaIn: kp.D, size: `${frac(kp.D)}" grade 8 undercut flat-head bolts through the plate and the crossbar; nuts in counterbores in the crossbar top`, at: kp.barX.map((x): Vec3 => [x, 0, 0]) },
    ], `${frac(p.kingpinPlateThickIn)}" A36 plate under the crossbar, lying on the turntable top plate (chassis on chassis). The pin bears on its hole, steel on steel (grease or a flanged bronze bushing, D-43), and hands the pin force to the crossbar through its four bolts.`, false,
    `${VENDOR} or a laser service: ${p.kingpinPlateThickIn}" A36 plate, ${(2 * kp.bar.hx).toFixed(2)}" × ${(2 * kp.bar.hy).toFixed(2)}", ${kp.barX.length} × ${frac(kp.D)}" countersunk holes, ${frac(p.kingpinDiameterIn + 1 / 64)}" pin hole (flanged bronze bushing optional)`);
  }

  // ── Shear ears (r3 N-1, D-43): tie the carrier to the beam plate so the stop torque is shared by both bolt planes ──
  if (plates) {
    const kpl = L.kpPlates!;
    const faceX = L.beamF.x + L.beamF.thick / 2;
    const tE = p.kingpinEarThickIn, proj = p.kingpinEarProjectIn;
    const yE = kp.carrier.hy - 0.5;
    for (const { s, tag } of SIDES) {
      parts.push(box(ctx, {
        id: `kp-ear-${tag}`, partNo: 'kp-ear', name: `Kingpin shear ear ${tag}`, group: 'steering', steer: true, mat: 'steel', kind: 'metal', material: 'A36 steel plate', fab: 'outsource', step: STEP.steering,
        ...span([faceX, faceX + proj], [s * yE - tE / 2, s * yE + tE / 2], [kpl.under.z1, kpl.carrier.z0]),
        joints: [
          { type: 'glue', to: 'kp-carrier', count: 1, size: `${frac(p.kingpinEarWeldIn)}" fillet weld, both sides, ${proj}" long`, note: 'Welded to the front-corner tab of the carrier (the tab is part of the waterjet outline). E70 filler.' },
          { type: 'glue', to: 'kp-under', count: 1, size: `${frac(p.kingpinEarWeldIn)}" fillet weld, both sides, ${proj}" long`, note: 'Welded to the front-corner tab of the beam plate.' },
        ],
        notes: `${frac(tE)}" A36 web standing in front of the beam face at y = ±${yE.toFixed(2)}", ${proj}" deep: a steel web tying the carrier to the beam plate in the fore-aft direction, so the stop torque is shared by both bolt planes (kingpin-bolts, ear rows). The two plates carry ${proj}" tabs in their outline for the welds; weld the ears BEFORE the plates go on, then check both plates are parallel. Clear of the bridle rope by the short projection. Fab: laser/waterjet, welded sub-assembly (carrier + ears + beam plate are bolted to the beam, so weld the ears to the plate tabs on the bench with the beam as the jig).`,
        sourcing: { vendor: `${VENDOR} or a laser service: ${frac(tE)}" A36, ${proj}" × ${(kpl.carrier.z0 - kpl.under.z1).toFixed(2)}"` },
      }));
    }
  }

  // ── Steering stops (M1, D-31, D-43): urethane-faced steel channel dogs standing on risers inside the turntable center hole, four oak stop blocks in the corners of the bolster opening ──
  const plan = steerStopPlan(p);
  const clr = p.sideBearerClearanceIn;
  const tfS = p.steerStopFacePlateIn; // channel steel
  const zw0 = bo.z0 + clr; // channel web bottom: clear of the turntable top plate
  const dogH = Math.max(0.5, Math.min(p.steerStopHeightIn, ringDepth - 2 * clr));
  if (plan.ok) {
    const len = plan.rb - plan.ra, midY = (plan.ra + plan.rb) / 2;
    const riserDepth = p.steerStopRiserDepthIn; // in y; the web overhangs it
    const barT = stopArmThick(p);
    const zBar0 = plates ? L.kpPlates!.carrier.z1 : L.turntable.z0; // Phase 1 layout (no crossbar): the arm lies on the beam top
    const yIn = Math.max(p.kingpinSleeveOdIn, p.kingpinDiameterIn) / 2 + 0.25; // the arm starts clear of the sleeve
    const steelLb = (vol: number) => (vol / IN3_PER_FT3) * p.steelDensityPcf;
    for (const { s, tag } of SIDES) {
      const yr: [number, number] = [Math.min(s * (plan.ra - riserDepth), s * plan.ra), Math.max(s * (plan.ra - riserDepth), s * plan.ra)];
      const armY: [number, number] = [Math.min(s * yIn, s * plan.ra), Math.max(s * yIn, s * plan.ra)];
      const armHx = plates ? Math.min(kp.carrier.hx, stopArmHx(p, plan.ra)) : plan.t / 2; // 2" wide unless the hole is tight: its corner stays inside the turntable hole
      // Stop arm: a ½" bar on the carrier, clamped by the plate bolts under it and screwed to the carrier; the riser stands on its outer end.
      parts.push(box(ctx, {
        id: `steer-stop-arm-${tag}`, partNo: 'steer-stop-arm', name: `Stop arm ${tag}`, group: 'steering', steer: true, mat: 'steel', kind: 'metal', material: 'A36 steel flat bar', fab: 'drill-tap', step: STEP.steering,
        ...span([kx - armHx, kx + armHx], armY, [zBar0, zBar0 + barT]),
        sourcing: { vendor: `${VENDOR}: A36 flat bar ${frac(barT)}" × ${(2 * armHx).toFixed(2)}", cut ${(plan.ra - yIn).toFixed(2)}" long (a saw cut; the holes are drilled and the screw holes tapped on the drill press)` },
        joints: [
          { type: 'screw', to: 'kp-carrier', count: 2, diaIn: p.steerStopScrewDiameterIn, size: `${frac(p.steerStopScrewDiameterIn)}-16 grade 8 socket flat-head screws through the arm, tapped into the carrier`, at: [-0.55, 0.55].map((x): Vec3 => [x, s * (plan.ra - riserDepth / 2) - s * (yIn + plan.ra) / 2, 0]), note: 'Steel on steel: the stop torque goes arm → screws → carrier (in its own plane) → plate bolts (steer-stops, kingpin-bolts rows).' },
        ],
        notes: `½" bar lying on the carrier inside the ${p.turntableCenterHoleIn}" center hole (${(2 * armHx).toFixed(2)}" wide, y ${yIn.toFixed(2)}…${plan.ra.toFixed(2)}"): nothing goes through the ball ring (M1 mounting). Held by two stop-arm screws tapped into the carrier.`,
      }));
      parts.push(box(ctx, {
        id: `steer-stop-riser-${tag}`, partNo: 'steer-stop-riser', name: `Stop riser ${tag}`, group: 'steering', steer: true, mat: 'steel', kind: 'metal', material: 'A36 steel bar', fab: 'drill-tap', step: STEP.steering,
        ...span([kx - plan.t / 2, kx + plan.t / 2], yr, [zBar0 + barT, zw0]),
        sourcing: { vendor: `${VENDOR}: A36 bar ${frac(riserDepth)}" × ${frac(plan.t)}", cut ${(zw0 - zBar0 - barT).toFixed(2)}" long` },
        joints: [
          { type: 'glue', to: `steer-stop-arm-${tag}`, count: 1, size: `${frac(p.steerStopWeldIn)}" E70 fillet weld all around the riser foot`, note: 'Arm and riser are one welded stand (r3 N-3); the stand bolts to the carrier by the two arm screws.' },
        ],
        notes: `Short block between the arm and the channel web, at the hole edge (y ${(plan.ra - riserDepth).toFixed(2)}…${plan.ra.toFixed(2)}"). Narrow enough (${plan.t}") that its corner stays out of the crossbar's shadow at lock.`,
      }));
      // Channel dog: ¼" web on the riser, two upturned flanges; the flange outer faces carry the urethane pads.
      const webLen = len + riserDepth;
      const chMass = steelLb(plan.t * webLen * tfS + 2 * (dogH - tfS) * len * tfS);
      parts.push(box(ctx, {
        id: `steer-stop-${tag}`, partNo: 'steer-stop', name: `Steering stop dog ${tag} (steel channel)`, group: 'steering', steer: true, mat: 'fixed', massLb: chMass, kind: 'metal', material: 'A36 steel plate, formed channel', fab: 'outsource', step: STEP.steering,
        size: [plan.t, webLen, dogH], center: [kx, s * (plan.ra - riserDepth + (webLen) / 2), zw0 + dogH / 2],
        sourcing: { vendor: `Waterjet / laser service with a press brake: ${frac(tfS)}" A36 plate, formed U channel ${plan.t}" wide × ${dogH.toFixed(2)}" tall × ${webLen.toFixed(2)}" long, 2 clearance holes in the web` },
        joints: [
          { type: 'glue', to: `steer-stop-riser-${tag}`, count: 1, size: `${frac(p.steerStopWeldIn)}" E70 fillet weld all around the web-to-riser seam (${plan.t}" × ${riserDepth}")`, note: 'Replaces the two 3/8" screws of round 2, which had no bearing or edge-distance check (r3 N-3). Weld the dog to the stand on the bench, then check the face-to-face dimension before bonding the pads.' },
          { type: 'glue', to: `steer-stop-face-${tag}1`, count: 1, note: 'Urethane pad bonded to the flange outer face (epoxy / urethane adhesive, abraded steel).' },
          { type: 'glue', to: `steer-stop-face-${tag}2`, count: 1, note: 'Urethane pad bonded to the flange outer face.' },
        ],
        notes: `Radial dog: ${frac(tfS)}" steel channel (web on the riser, two flanges up), stop face s = ${plan.ra.toFixed(2)}…${plan.rb.toFixed(2)}" from the kingpin, ${dogH.toFixed(2)}" tall, standing on the ${s > 0 ? '+y' : '−y'} axis. Its urethane-faced sides land flat on the stop blocks at exactly ±${p.steerLockDeg}° of lock; the dog is carried from INSIDE the turntable hole, over the ring (D-43). Drawn as the bounding box of the web and flanges.`,
      }));
      for (const [n, sx] of [[1, -1], [2, 1]] as const) {
        const padLb = (plan.tf * len * (dogH - tfS) / IN3_PER_FT3) * p.urethaneDensityPcf;
        parts.push(box(ctx, {
          id: `steer-stop-face-${tag}${n}`, partNo: 'steer-stop-face', name: `Steering stop urethane pad ${tag}${n}`, group: 'steering', steer: true, mat: 'fixed', massLb: padLb, step: STEP.steering,
          size: [plan.tf, len, dogH - tfS], center: [kx + sx * (plan.t / 2 + plan.tf / 2), s * midY, zw0 + tfS + (dogH - tfS) / 2],
          material: `${frac(plan.tf)}" 70-80A cast urethane pad, bonded`, kind: 'purchased', fab: 'buy',
          sourcing: { vendor: `${VENDOR}: ${frac(plan.tf)}" 70-80A urethane sheet, cut ${len.toFixed(2)}" × ${(dogH - tfS).toFixed(2)}" and bonded to the flange` },
          joints: [{ type: 'glue', to: `steer-stop-${tag}`, count: 1, note: 'Bonded to the steel flange; the pad is the compliance that makes the two stops share load (steer-stops row, D-43).' }],
          notes: `${frac(plan.tf)}" urethane on the ${sx < 0 ? 'aft' : 'fore'} flange face of the ${s > 0 ? 'left' : 'right'} dog: the stop face. Stiffness k = E·A/t sets the share between the two stops (D-43).`,
        }));
      }
    }
    const wood = (vol: number, area: number) => woodMassLb(p, vol, area, p.oakDensityPcf);
    for (const th of plan.teeth) {
      const area = Math.abs(th.local.reduce((sum, q, i) => { const r = th.local[(i + 1) % th.local.length]; return sum + q.x * r.y - r.x * q.y; }, 0)) / 2;
      const per = th.local.reduce((sum, q, i) => { const r = th.local[(i + 1) % th.local.length]; return sum + Math.hypot(r.x - q.x, r.y - q.y); }, 0);
      const rail = th.id.startsWith('A') ? 'bolster-aft' : 'bolster-fore';
      const dims = [ringDepth, th.uMax - th.uMin, th.vMax].sort((a, b) => a - b);
      parts.push(customPart(ctx, {
        id: `stop-block-${th.id}`, partNo: 'stop-block', name: `Steering stop block ${th.id}`, group: 'steering', kind: 'lumber', material: 'white oak', fab: 'bandsaw', step: STEP.steering,
        geometry: { type: 'extrusion', outline: th.local.map((q): [number, number] => [q.x, q.y]), depth: ringDepth },
        transform: compose([kx + th.foot.x, th.foot.y, bo.z0], { z: th.theta }),
        massLb: wood(area * ringDepth, 2 * area + per * ringDepth),
        grain: 'y', stock: { t: roundUp32(dims[0]), w: roundUp32(dims[1]), l: roundUp32(dims[2]) },
        rough: { t: roundUp32(dims[0]) + p.stopBlockRoughAllowIn, w: roundUp32(dims[1]) + p.stopBlockRoughAllowIn, l: roundUp32(dims[2]) + p.stopBlockRoughAllowIn },
        explode: unit([0.3, th.side * 0.3, 1]),
        joints: [
          { type: 'glue', to: rail, count: 1, size: 'face of the bolster rail', note: `Contact length ${th.railLen.toFixed(2)}"; the stop force presses it into the rail.` },
          { type: 'screw', to: rail, count: 2, size: '#10 × 2-1/2" countersunk, through the rail into the block', diaIn: 0.19 },
          { type: 'screw', to: rail, count: 1, size: `shim pack (1/64" and 1/32" stainless shims, up to ${p.steerStopAdjustRangeIn}") between the block and the rail`, note: `FIT PLAN (r3 N-1, build S12): the stop face is cut ${frac(1 / 16)}" PROUD of its theoretical plane (blank ${p.stopBlockRoughAllowIn}" over the ${roundUp32(dims[0]).toFixed(3)} × ${roundUp32(dims[1]).toFixed(3)} × ${roundUp32(dims[2]).toFixed(3)}" stock, which is rounded up to 1/32", not the irrational ${dims[0].toFixed(3)} × ${dims[1].toFixed(3)} × ${dims[2].toFixed(3)}" of the plan). (1) Screw the block on with a 1/32" shim pack. (2) Turn the steering to full lock, one side at a time. (3) With the pads on the dog and a 0.003" feeler gauge, plane or scrape the block face until both pads of the dog touch the gauge together (the blocks are proud by 1/16", so there is wood to take). (4) Finish with shims to bring the residual mismatch inside ${p.steerStopFitMismatchIn}" (shim range ${p.steerStopAdjustRangeIn}", set at about 70°F). (5) Recheck after the first season.` },
          ...(cb ? [{ type: 'glue' as const, to: 'kingpin-crossbar', count: 1, size: 'side face of the crossbar', note: `Contact length ${th.barLen.toFixed(2)}".` }] : []),
        ],
        notes: `Wedge cut to the corner between the ${th.id.startsWith('A') ? 'aft' : 'fore'} bolster rail and the crossbar, trimmed where thinner than ${p.stopBlockMinIn}". Its face is the plane the dog's ${th.lockSign > 0 ? 'aft' : 'fore'}-side urethane pad reaches at exactly ${th.lockSign > 0 ? '+' : '−'}${p.steerLockDeg}° of lock (flat contact). Grain runs along the stop force (end-grain face); the analysis conservatively uses the across-grain bearing allowable. The OBB drawn is the bounding rectangle behind the face.`,
      }));
    }
  }

  // ── Removable access panel over the kingpin nut (M10, D-34) ──
  if (L.accessPanel) {
    const ap = L.accessPanel;
    const t = ap.z1 - ap.z0;
    const insertAt = ([[-1, -1], [-1, 1], [1, -1], [1, 1]] as const).map(([sx, sy]): Vec3 => [sx * (ap.x1 - ap.x0) * 0.34, sy * ap.hw * 0.6, t / 2]);
    const plen = ap.x1 - ap.x0, pw = 2 * ap.hw;
    const rad = Math.max(0, Math.min(p.accessOpeningCornerRadiusIn, plen / 2 - 1e-6, ap.hw - 1e-6));
    const outline = roundedRectCCW(-plen / 2, plen / 2, -ap.hw, ap.hw, rad);
    const area = plen * pw - (4 - Math.PI) * rad * rad;
    const perim = 2 * (plen + pw) - (8 - 2 * Math.PI) * rad;
    const panel = customPart(ctx, {
      id: 'nose-access-panel', name: 'Kingpin nut access panel', group: 'steering', kind: 'sheet', material: ctx.plyName, fab: 'cnc', step: STEP.kingpin, explode: [0, 0, 1], grain: 'x',
      geometry: { type: 'extrusion', outline, depth: t }, transform: compose([(ap.x0 + ap.x1) / 2, 0, ap.z0]),
      massLb: woodMassLb(p, area * t, 2 * area + perim * t, ctx.d.plyDensityPcf),
      stock: { t, w: Math.min(plen, pw), l: Math.max(plen, pw) },
      joints: [
        { type: 'threaded-insert', to: 'kingpin-crossbar', count: 4, size: '#10-24 machine screws × 1", stainless, with finish washers', diaIn: 0.19, at: insertAt, note: 'Four screws into the inserts in the crossbar top; taking it off exposes the kingpin nut and washer.' },
      ],
      notes: `Removable for service (kept on in transport): a ${plen.toFixed(2)}" × ${pw.toFixed(2)}" panel of the nose-deck ply, ${t.toFixed(2)}" thick, flush with the deck over the kingpin nut, with ${rad}" corner radii (D-47): cut the opening with a 1/2" bit in a router template, cut the panel from the same template with a bearing bit (0.03" reveal all round); the radius is the tightest that takes 1/16" oak edge veneer on the opening rim and the panel edge without cracking (straight edges elsewhere get 1/4" oak bands). Workstream B cuts this opening in the nose deck (Layout.accessPanel); until then its mass (≈ ${woodMassLb(p, area * t, 2 * area + perim * t, ctx.d.plyDensityPcf).toFixed(2)} lb) is also in the deck. Edges sealed with epoxy before the veneer.`,
    });
    panel.edges = 'edged';
    parts.push(panel);
  }

  // Tongue runs forward from the beam, inside the beam's own height so it never reaches the turntable.
  const tongueDepth = Math.min(p.tongueDepthIn, L.beamF.depth);
  const tongueCz = L.beamF.top - tongueDepth / 2;
  const tongueX0 = L.beamF.x + L.beamF.thick / 2;
  let tipX = tongueX0;
  if (p.drawbar === DRAWBAR.woodTongue) {
    tipX = L.WB + p.tongueLengthIn;
    parts.push(box(ctx, {
      id: 'tongue', name: 'Tongue', group: 'steering', steer: true, mat: 'oak', removable: true, step: STEP.steering, grain: 'x',
      ...span([tongueX0, Math.max(tongueX0 + 1, tipX)], [-p.tongueThickIn / 2, p.tongueThickIn / 2], [tongueCz - tongueDepth / 2, tongueCz + tongueDepth / 2]),
      notes: 'Pins off for transport (D-9). Length is measured from the front axle (overall length, D-23).',
    }));
    parts.push(box(ctx, {
      id: 'bridle', name: 'Bridle rope', group: 'steering', steer: true, mat: 'fixed', massLb: BRIDLE_MASS_LB, kind: 'purchased',
      material: 'rope', fab: 'buy', removable: true, step: STEP.steering,
      ...span([tipX, tipX + BRIDLE_LEN_IN], [-BRIDLE_SECTION_IN / 2, BRIDLE_SECTION_IN / 2], [tongueCz - BRIDLE_SECTION_IN / 2, tongueCz + BRIDLE_SECTION_IN / 2]),
      notes: 'Estimate mass; drawn as a short straight lead from the tongue tip.',
    }));
  } else {
    // Rope bridle (D-14, D-27, D-33): a forged eye bolt through the front face of the beam on each side, just inboard of the U-bolt plate;
    // a rope leg tied to each eye, meeting at a ring ahead of the cart. Only the legs and ring are drawn; the 8 ft pull tails
    // (bridleRopeRunIn) continue to the pullers' hands.
    const beamLen = L.beamF.len;
    const clampInner = Math.min(beamLen / 2 - 0.25, p.frontTrackIn / 2 - p.tireWidthIn / 2) - p.clampPlateWidthIn;
    const tieY = clampInner - p.bridleTieOffsetIn;
    const frontFace = L.beamF.x + L.beamF.thick / 2;
    const tieX = frontFace + p.eyeBoltEyeOffsetIn;
    const d = p.eyeBoltDiameterIn;
    const shankLen = L.beamF.thick + 0.9; // through the beam and the nut / washer stack on the aft face
    const eyeR = (d * EYE_OD_FACTOR) / 2 - (d * EYE_TUBE_FRAC) / 2;
    for (const { s: side, tag } of SIDES) {
      // Local frame: origin at the eye center, +x forward. The shank runs aft from the eye ring to the beam's aft face and beyond.
      const shank: Vec3[] = [[-p.eyeBoltEyeOffsetIn - L.beamF.thick - 0.55, 0, 0], [-eyeR - (d * EYE_TUBE_FRAC) / 2, 0, 0]];
      const ring = circlePath([0, 0, 0], [0, 1, 0], eyeR, 20);
      const mesh = mergeMeshes(tubeAlong(shank, d / 2, 10), tubeAlong(ring, (d * EYE_TUBE_FRAC) / 2, 8, true));
      const volIn3 = Math.PI * (d / 2) ** 2 * pathLength(shank) + Math.PI * ((d * EYE_TUBE_FRAC) / 2) ** 2 * pathLength(ring, true);
      parts.push(customPart(ctx, {
        id: `eyebolt-${tag}`, partNo: 'bridle-eyebolt', name: `Bridle eye bolt ${tag}`, group: 'steering', kind: 'purchased', material: 'forged steel shoulder eye bolt', fab: 'buy', step: STEP.steering,
        geometry: { type: 'mesh', positions: mesh.positions, indices: mesh.indices },
        transform: compose([tieX, side * tieY, tongueCz]),
        steer: true, massLb: (volIn3 / IN3_PER_FT3) * p.steelDensityPcf + 0.04, explode: unit([1, side * 0.2, -0.1]),
        sourcing: { vendor: `${VENDOR}: forged shoulder eye bolt ${frac(d)}" (nut-style, ${shankLen.toFixed(1)}" shank) with a ${frac(p.eyeBoltWasherDiameterIn)}" OD fender washer and lock nut on the aft face. THE EYE BOLT IS THE INTENDED WEAK LINK of the rope tie (D-47): the washer, the beam hole and the beam are sized to outlast it; confirm its working-load limit is at least ${p.pullForceLbf * p.bridleTieOverloadFactor} lbf (${p.pullForceLbf} lbf design pull x ${p.bridleTieOverloadFactor}) at the rope angle (bridle-tie)` },
        joints: [{ type: 'bolt', to: 'beam-F', count: 1, diaIn: d, size: `${frac(d)}" shoulder eye bolt through the beam front face, axis fore-aft, nut + ${frac(p.eyeBoltWasherDiameterIn)}" OD washer on the aft face`, at: [[-p.eyeBoltEyeOffsetIn - L.beamF.thick / 2, 0, 0]], note: 'Tie point for the rope bridle (M6): inboard of the U-bolt plate, so the pull goes into the beam and not the axle rod.' }],
        notes: `Eye ${p.eyeBoltEyeOffsetIn}" ahead of the beam front face at ${tieY.toFixed(2)}" off center and mid-depth of the beam; the rope leg is tied to it with a bowline or a soft shackle. The beam carries its own ${(L.beamF.thick).toFixed(2)}" through-hole.`,
      }));
    }
    const ring: Vec3 = [L.WB + BRIDLE_APEX_AHEAD_IN, 0, tongueCz];
    for (const { s: side, tag } of SIDES) {
      const a: Vec3 = [tieX, side * tieY, tongueCz];
      const dx = ring[0] - a[0], dy = ring[1] - a[1];
      parts.push(box(ctx, {
        id: `bridle-${tag}`, partNo: 'bridle-leg', name: `Bridle rope leg ${tag}`, group: 'steering', steer: true, mat: 'fixed',
        massLb: BRIDLE_MASS_LB / 2, kind: 'purchased', material: '1/2" braided polyester rope (low stretch)', fab: 'buy', removable: true, step: STEP.steering,
        sourcing: { vendor: `${VENDOR}: 1/2" braided polyester rope (low stretch), ${Math.round(p.bridleRopeRunIn / 12)} ft pull tails + legs; requirement: tails ≥ ${Math.round(p.bridleRopeRunIn / 12)} ft, tied low (Phase 2 critic r2 R2)` },
        size: [Math.hypot(dx, dy), BRIDLE_SECTION_IN, BRIDLE_SECTION_IN], center: [(a[0] + ring[0]) / 2, (a[1] + ring[1]) / 2, tongueCz],
        rot: { z: Math.atan2(dy, dx) },
        joints: [{ type: 'bolt', to: `eyebolt-${tag}`, count: 1, size: 'bowline or soft shackle to the eye bolt' }],
        notes: `½" rope tied low to the eye bolt; legs meet at a ring ${BRIDLE_APEX_AHEAD_IN}" ahead of the front axle. Pull tails ${p.bridleRopeRunIn}" (D-27). The leg starts at the eye center (${tieX.toFixed(2)}", ±${tieY.toFixed(2)}").`,
      }));
    }
  }
  return parts;
}
