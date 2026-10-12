/**
 * Seat, storage and fittings checks (workstream D, D-9, D-19, D-40, D-41, D-57). `seatChecks(ctx)` returns:
 *  - seat-back:    rider throws their weight on the back (rider × dynamic factor × torso share): stile bending at the stop-block crest, crest bearing, hinge load, ply panel
 *                  bending (operating and goal rider);
 *  - seat-grip:    grab board (D-57): the bar of oak above the hand hole in bending, the bolt couple under an inboard pull and the no-pinch geometry (finger gap, clear length);
 *  - storage-pack: the 10 Essentials kit list (D-19) packed into the actual box interior;
 *  - storage-lid-open: how far the lid opens before the (upright) seat back stops it;
 *  - lash-points:  count of gunwale lash points (BRIEF §4.9: at least 6);
 *  - lash-load:    one lash plate pulled at its working load and angle: screw withdrawal (NDS) and lateral bearing (S-9).
 *
 * Seat-back model (per stile, 2 stiles): uniform line load w = Q / (2H) aft along the back, Q = rider mass × dynamic factor × torso share.
 * The stile bears on the oak stop block crest at height A (conservative: the face below is taken as relieved) and is held at its front foot (B = 0) by the hinge. Statics:
 * R_A = w·H·(H/2 − B)/(A − B) (bearing), R_B = w·H − R_A (negative = the hinge is loaded toward the support: its screws take it in shear). Bending peaks at the crest:
 * M = w·(H − A)²/2.
 */
import { GRIP_BOLT_COLS, GRIP_BOLT_DIA_IN, GRIP_WASHER_OD_IN, GRIP_BOLT_ROWS_IN, GRIP_BOLTS, seatBackSupport } from '../model/seat';
import { storageGeometry, storageInterior, boxGear, packEssentials, ESSENTIALS, lashPositions, LASH_SCREWS, LASH_SCREW_DIA_IN, LASH_SCREW_LEN_IN, LASH_PLATE_T_IN, LASH_TIP_IN } from '../model/storage';
import type { Ctx } from './context';
import { dualCheck, governing, singleCheck, detail, type CaseEval } from './dual';
import { f } from './format';
import type { CaseData } from './loads';
import { allowables } from './structure';
import { seatFactor } from './bump';
import type { AnalysisCheck, Detail } from './types';

/** Effective bearing height of the stile on the wedge crest (crest plus the lid frame above it), in. */
const CRUSH_HEIGHT_IN = 1;
/** Simply supported rectangular plate, uniform load: M_max = α q a² (a = short side) vs the side ratio. */
const PLATE_ALPHA: ReadonlyArray<[number, number]> = [[1, 0.0479], [1.2, 0.0627], [1.4, 0.0755], [1.6, 0.0862], [1.8, 0.0948], [2, 0.1017], [3, 0.1189], [100, 0.125]];

function plateAlpha(r: number): number {
  const ratio = Math.max(1, r);
  for (let i = 1; i < PLATE_ALPHA.length; i++) {
    const [r1, a1] = PLATE_ALPHA[i];
    const [r0, a0] = PLATE_ALPHA[i - 1];
    if (ratio <= r1) return a0 + ((ratio - r0) / (r1 - r0)) * (a1 - a0);
  }
  return PLATE_ALPHA[PLATE_ALPHA.length - 1][1];
}

/** Numbers behind the seat-back check for one rider mass, exported for the tests. */
export function seatBackLoads(ctx: Ctx, riderLb: number, g: number = ctx.p.dynamicFactor) {
  const { p } = ctx;
  const sup = seatBackSupport(p, ctx.L);
  const Q = riderLb * g * p.seatBackLoadFraction;
  const w = Q / 2 / sup.H;
  const A = sup.c2A, B = sup.c2B;
  const RA = (w * sup.H * (sup.H / 2 - B)) / (A - B);
  const RB = w * sup.H - RA;
  const M = (w * (sup.H - A) ** 2) / 2;
  const plyT = Math.min(p.seatBackPlyIn, sup.t);
  const a = Math.min(sup.W - 2 * sup.fw, sup.H - 2 * sup.fw);
  const b = Math.max(sup.W - 2 * sup.fw, sup.H - 2 * sup.fw);
  const q = Q / (sup.W * sup.H);
  const Mp = plateAlpha(b / a) * q * a * a;
  return { sup, Q, w, A, B, RA, RB, T: Math.max(0, -RB), M, plyT, a, b, q, Mp, sigmaPly: (6 * Mp) / (plyT * plyT) };
}

export function seatBackCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const ev = (c: CaseData): CaseEval => {
    const gF = seatFactor(ctx, c);
    const k = seatBackLoads(ctx, c.riderLb, gF);
    const S = (k.sup.fw * k.sup.t * k.sup.t) / 6;
    const ds: Detail[] = [
      detail('stile bending at the crest', k.M / S, 'psi', al.oakBend, '<='),
      detail('crest bearing on the stop block', k.RA / (k.sup.fw * CRUSH_HEIGHT_IN), 'psi', al.oakPerp, '<='),
      detail('hinge load (each hinge, screws in oak)', k.T, 'lbf', p.seatHingeLoadLbf, '<='),
      detail('ply panel bending', k.sigmaPly, 'psi', al.plyBend, '<='),
    ];
    const how = `Rider ${f(c.riderLb, 0)} lb × dynamic ${f(gF, 2)} (max of the dynamic factor and 1 + V_rear/W, spec 5.4) × torso share ${p.seatBackLoadFraction} = ${f(k.Q)} lbf aft over the ${f(k.sup.H)}" back, ${f(k.w, 2)} lbf/in on each of 2 stiles. `
      + `Stile ${f(k.sup.fw, 2)}" × ${f(k.sup.t, 2)}" bears on the fixed oak ${k.sup.rear ? 'stop block against the box end' : 'post'} crest at ${f(k.A, 2)}" and is held at its foot by the hinge (${f(k.B, 2)}"): `
      + `R_A = ${f(k.RA)} lbf, hinge load ${f(k.T)} lbf per stile; M at the crest = w(H − A)²/2 = ${f(k.M)} lb·in, σ = ${f(k.M / S, 0)} psi (≤ ${f(al.oakBend, 0)}); `
      + `bearing ${f(k.RA / (k.sup.fw * CRUSH_HEIGHT_IN), 0)} psi on ${f(k.sup.fw, 2)}" × ${CRUSH_HEIGHT_IN}" (≤ ${f(al.oakPerp, 0)}); hinge ${f(k.T, 0)} lbf (≤ ${f(p.seatHingeLoadLbf, 0)}); `
      + `ply panel ${f(k.a, 1)}" × ${f(k.b, 1)}" simply supported on 4 edges under ${f(k.q, 2)} psi: M = ${f(plateAlpha(k.b / k.a), 4)}·q·a² = ${f(k.Mp, 1)} lb·in/in, σ = ${f(k.sigmaPly, 0)} psi (≤ ${f(al.plyBend, 0)}).`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'seat-back',
    label: 'Seat-back load (stile, stop block, hinge)',
    group: 'Structure',
    refs: ['D-9', 'D-40', 'BRIEF 4.7'],
    primary: 'goal',
    operating: ev(ctx.loads.operating),
    goal: ev(ctx.loads.goal),
    operatingLabel: 'Operating rider',
    goalLabel: 'Goal rider',
  });
}

export function seatGripCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const ev = (c: CaseData): CaseEval => {
    // A hard pull on the board toward the sled centerline: half the rider weight × the dynamic factor on the oak bar over the hand hole (one hand, one board).
    const gF = seatFactor(ctx, c);
    const F = 0.5 * c.riderLb * gF;
    const bt = p.grabBoardThickIn, bar = p.grabBoardBarIn, hl = p.grabHoleLengthIn;
    const Sbar = (bt * bar * bar) / 6;
    const Mbar = (F * hl) / 4; // simply supported over the hole (conservative: the ends are fixed in the board)
    // The pull is applied on the bar at `arm` above the gunwale top; the board turns about the gunwale top edge and the bolt rows resist it as a couple: T_i = k d_i, M = k Σ d_i².
    const arm = p.grabBoardFootIn + p.grabHoleHeightIn + bar / 2;
    const sumD2 = GRIP_BOLT_COLS * GRIP_BOLT_ROWS_IN.reduce((m, d) => m + d * d, 0);
    const k = (F * arm) / sumD2;
    const Tbolt = k * Math.max(...GRIP_BOLT_ROWS_IN);
    const boltArea = (Math.PI / 4) * (GRIP_BOLT_DIA_IN - 0.0825) ** 2; // 1/4-20 tensile stress area ≈ 0.0318 in²
    const washerA = (Math.PI / 4) * (GRIP_WASHER_OD_IN ** 2 - (GRIP_BOLT_DIA_IN + 0.03) ** 2);
    const ds: Detail[] = [
      detail('grab bar bending over the hole', Mbar / Sbar, 'psi', al.oakBend, '<='),
      detail('bolt tension (each, the couple of the two rows)', Tbolt / boltArea, 'psi', p.ss316BoltYieldPsi / p.steelSafetyFactor, '<='),
      detail('washer bearing on the oak (⊥ grain)', Tbolt / washerA, 'psi', al.oakPerp, '<='),
      detail('finger gap (no pinch)', p.grabHoleHeightIn, 'in', 1.25, '>='),
      detail('clear length (hand)', hl, 'in', 3.5, '>='),
    ];
    const how = `Pull ${f(F)} lbf (0.5 × ${f(c.riderLb, 0)} lb × ${f(gF, 2)}) on one board: the ${f(bt, 2)}" × ${f(bar, 2)}" bar over the ${f(hl, 2)}" hole, M = F·L/4 = ${f(Mbar)} lb·in, σ = M/S = ${f(Mbar / Sbar, 0)} psi (≤ ${f(al.oakBend, 0)}). `
      + `The pull acts ${f(arm, 2)}" above the gunwale top; the ${GRIP_BOLTS} bolts (${GRIP_BOLT_COLS} columns × 2 rows ${GRIP_BOLT_ROWS_IN.join('" and ')}" below the top) resist it as a couple: T = F·arm·d_max/(cols·Σd²) = ${f(Tbolt)} lbf on the worst bolt, ${f(Tbolt / boltArea, 0)} psi on the ${f(boltArea, 4)} in² tensile area (≤ ${f(p.ss316BoltYieldPsi / p.steelSafetyFactor, 0)}), ${f(Tbolt / washerA, 0)} psi under the ${f(GRIP_WASHER_OD_IN, 2)}" fender washer (≤ ${f(al.oakPerp, 0)}). `
      + `Finger gap ${f(p.grabHoleHeightIn, 2)}" (≥ 1.25") and ${f(hl, 2)}" clear length (≥ 3.5"): no pinch point (BRIEF §4.7).`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'seat-grip',
    label: 'Side grab board (bar bending, bolts, no pinch)',
    group: 'Structure',
    refs: ['D-40', 'D-57', 'BRIEF 4.7'],
    primary: 'goal',
    operating: ev(ctx.loads.operating),
    goal: ev(ctx.loads.goal),
    operatingLabel: 'Operating rider',
    goalLabel: 'Goal rider',
  });
}

export function storagePackCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const interior = storageInterior(p, L);
  // Race mode (3c-5): the 10 Essentials AND the wheel chocks ride in the box (the cushions are on the sled, the lamp is on the bow).
  const chocks = boxGear(ctx.parts).chocks;
  const r = packEssentials(interior, [...ESSENTIALS, ...chocks]);
  const r0 = packEssentials(interior);
  const chockIn3 = r.rigidIn3 - r0.rigidIn3;
  const lines = ESSENTIALS.map((k) => `${k.qty > 1 ? `${k.qty} × ` : ''}${k.name}${k.dims ? ` ${k.dims.join('×')}"` : ` ${k.softVolIn3} in³ soft`}`).join('; ');
  return singleCheck({
    id: 'storage-pack',
    label: 'Storage box fits the 10 Essentials kit and the wheel chocks',
    group: 'Structure',
    value: r.fill,
    unit: '× of interior',
    limit: 1,
    sense: '<=',
    status: r.fits ? (r.fill <= 0.9 ? 'pass' : 'marginal') : 'fail',
    refs: ['D-19', 'D-41'],
    how: `Interior ${f(interior.lx)}" × ${f(interior.w)}" × ${f(interior.h, 2)}" under the wall tops (${f(interior.lx * interior.w * interior.h, 0)} in³) plus ${f(interior.capIn3, 0)} in³ in the lid zone = ${f(interior.totalIn3, 0)} in³ (target ${p.storageVolumeIn3} in³). `
      + `Kit: ${lines}. ${r.rigidPlaced}/${r.rigidTotal} rigid items placed in levels (bounding boxes, flat) = ${f(r.rigidIn3, 0)} in³; soft goods ${f(r.softIn3, 0)} in³ compressed to ${f(r.softCompressedIn3, 0)} in³ into the voids (90% usable). `
      + `Fill = (rigid + soft ÷ 0.9) ÷ interior = ${f(r.fill, 2)}.${r.unplaced.length ? ` Not placed: ${r.unplaced.join(', ')}.` : ''} `
      + (chocks.length ? `Race mode (3c-5) carries the ${chocks[0].qty} wheel chocks too: ${chocks[0].dims!.map((v) => f(v, 1)).join('×')}" each (bounding box, ${f(chockIn3, 0)} in³ together) are inside the numbers above; without them the fill is ${f(r0.fill, 2)}. ` : '')
      + (r.fits ? `Margin: ${f((1 - r.fill) * interior.totalIn3, 0)} in³ free. ` : `It does NOT fit. Lightest fix, without making the box bigger: a small printed ASA holder that clips each chock to the outside of the box wall or the rear transom (about 0.1 lb each), or carry the chocks on their cords at the wheels. `),
  });
}

/** Angle (deg) the lid opens about the fore-edge hinge before the leaning seat back stops it; 90 with no lean. */
export function lidOpenAngleDeg(ctx: Ctx): number {
  const { p, L } = ctx;
  const g = storageGeometry(p, L);
  const a = (p.seatBackAngleDeg * Math.PI) / 180;
  const len = g.x1 - g.x0;
  const hinge = 0.3; // hinge axis below the lid top
  if (a <= 0 || p.storageLocation !== 0) return 90;
  const k = Math.tan(a);
  for (let d = 0; d <= 90; d += 0.1) {
    const th = (d * Math.PI) / 180;
    // Worst point along the lid is the free end (s = len) once the coefficient goes negative.
    const lhs = len * Math.cos(th) - (len * Math.sin(th) - hinge) * k;
    if (lhs <= 0) return d;
  }
  return 90;
}

export function lidOpenCheck(ctx: Ctx): AnalysisCheck {
  const ang = lidOpenAngleDeg(ctx);
  return singleCheck({
    id: 'storage-lid-open',
    label: 'Lid opening with the seat back fitted',
    group: 'Structure',
    value: ang,
    unit: '°',
    limit: 60,
    sense: '>=',
    refs: ['D-41', 'D-9'],
    how: `Hinges on the fore edge, so the lid swings up and aft; the seat back (${ctx.p.seatBackAngleDeg}° recline) leans over the lid and stops it at ${f(ang, 0)}° (limit 60° to reach the kit). With the back removed (no tools) the lid opens to 100°+ on a stay.`,
  });
}

export function lashPointsCheck(ctx: Ctx): AnalysisCheck {
  const n = ctx.parts.filter((x) => x.id.startsWith('lash-')).length;
  const want = lashPositions(ctx.p, ctx.L, ctx.p.lashPointsPerSide).length * 2;
  return singleCheck({
    id: 'lash-points',
    label: 'Lash points for gear hauling',
    group: 'Structure',
    value: n,
    unit: 'points',
    limit: 6,
    sense: '>=',
    marginalAbs: 0,
    refs: ['BRIEF 4.9', 'D-41'],
    how: `${n} stainless D-rings on the cabin gunwales (${ctx.p.lashPointsPerSide} per side requested, ${want} fit clear of the grab handles); each bolt plate is rated for a 300 lbf strap load. BRIEF §4.9 asks for at least 6.`,
  });
}

/** White oak specific gravity (NDS Table 12.3.3A, oven-dry) and the wet-service factor C_M for screw withdrawal (NDS Table 11.3.3). */
const OAK_G = 0.68;
const WITHDRAWAL_WET_CM = 0.7;

/** Numbers behind the lash-load check, exported for the tests. */
export function lashLoads(p: Ctx['p']) {
  const th = (p.lashPullAngleDeg * Math.PI) / 180;
  const V = p.lashLoadLbf * Math.sin(th);
  const H = p.lashLoadLbf * Math.cos(th);
  const pen = LASH_SCREW_LEN_IN - LASH_PLATE_T_IN - LASH_TIP_IN;
  // NDS 12.2.1: W = 1380·G²·D lbf per inch of thread penetration (ASD, already includes the safety factor); wet service C_M = 0.7.
  const wPerIn = 1380 * OAK_G * OAK_G * LASH_SCREW_DIA_IN;
  const wScrew = wPerIn * pen * WITHDRAWAL_WET_CM;
  const capW = LASH_SCREWS * wScrew;
  const bearing = H / LASH_SCREWS / (LASH_SCREW_DIA_IN * pen);
  return { V, H, pen, wPerIn, wScrew, capW, bearing };
}

export function lashLoadCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const k = lashLoads(p);
  const ds: Detail[] = [
    detail('screw withdrawal (plate, all screws)', k.V, 'lbf', k.capW, '<='),
    detail('screw bearing on the oak (lateral)', k.bearing, 'psi', al.oakDowel, '<='),
  ];
  const g = ds.reduce((a, b) => (b.util > a.util ? b : a), ds[0]);
  return singleCheck({
    id: 'lash-load',
    label: 'Lash point pull (screw withdrawal)',
    group: 'Structure',
    value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, details: ds,
    refs: ['BRIEF 4.9', 'D-41'],
    how: `One lash plate pulled at its ${p.lashLoadLbf} lbf working load, ${p.lashPullAngleDeg}° above the deck: withdrawal V = ${f(p.lashLoadLbf, 0)} × sin ${p.lashPullAngleDeg}° = ${f(k.V)} lbf, lateral H = ${f(k.H)} lbf. `
      + `${LASH_SCREWS} stainless #10 × ${LASH_SCREW_LEN_IN}" screws (D = ${LASH_SCREW_DIA_IN}"), thread penetration ${LASH_SCREW_LEN_IN} − ${LASH_PLATE_T_IN} plate − ${LASH_TIP_IN} tip = ${f(k.pen, 3)}" into oak (G = ${OAK_G}): NDS W = 1380·G²·D = ${f(k.wPerIn)} lbf/in, × ${f(k.pen, 3)}" × C_M ${WITHDRAWAL_WET_CM} (wet) = ${f(k.wScrew)} lbf per screw, ${f(k.capW)} lbf for ${LASH_SCREWS}. `
      + `Lateral: ${f(k.H / LASH_SCREWS)} lbf per screw bears on ${f(k.pen, 3)}" × ${LASH_SCREW_DIA_IN}" = ${f(k.bearing, 0)} psi (≤ ${f(al.oakDowel, 0)}). Two screws would give ${f((2 * k.wScrew), 0)} lbf and fail; the plate is a 4-hole plate for that reason.`,
  });
}

/** All workstream D checks. The orchestrator adds these to `runChecks` (and the ids to GROUP_OF_ID, all 'Structure'). */
export function seatChecks(ctx: Ctx): AnalysisCheck[] {
  return [seatBackCheck(ctx), seatGripCheck(ctx), storagePackCheck(ctx), lidOpenCheck(ctx), lashPointsCheck(ctx), lashLoadCheck(ctx)];
}
