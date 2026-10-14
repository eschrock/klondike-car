/**
 * Seat, storage and fittings checks (workstream D, D-9, D-19, D-40, D-41, D-57). `seatChecks(ctx)` returns:
 *  - seat-back:    rider throws their weight on the back (rider × dynamic factor × torso share): stile bending at the stop-block crest, crest bearing, hinge load, ply panel
 *                  bending (operating and goal rider);
 *  - seat-grip:    grab board (D-57): the bar of oak above the hand hole in bending, the bolt couple under an inboard pull and the no-pinch geometry (finger gap, clear length);
 *  - storage-pack: the 10 Essentials kit list (D-19) packed into the actual box interior;
 *  - storage-lid-open: how far the lid opens before the (upright) seat back stops it;
 *  - lash-points:  count of gunwale lash points (D-76: at least 6);
 *  - lash-load:    one D-ring plate pulled at its working load and angle (D-76: through-bolted to a rib head): bolt tension and shear, head bearing, washer bearing, rib bending.
 *
 * Seat-back model (per stile, 2 stiles): uniform line load w = Q / (2H) aft along the back, Q = rider mass × dynamic factor × torso share.
 * The stile bears on the oak stop block crest at height A (conservative: the face below is taken as relieved) and is held at its front foot (B = 0) by the hinge. Statics:
 * R_A = w·H·(H/2 − B)/(A − B) (bearing), R_B = w·H − R_A (negative = the hinge is loaded toward the support: its screws take it in shear). Bending peaks at the crest:
 * M = w·(H − A)²/2.
 */
import { GRIP_BACKING_H_IN, GRIP_BACKING_T_IN, gripBackingLen, GRIP_BOLT_COLS, GRIP_BOLT_DIA_IN, GRIP_WASHER_OD_IN, GRIP_BOLT_ROWS_IN, GRIP_BOLTS, LATCH_HOLE_WALL_MIN_IN, latchGeometry, seatBackSupport } from '../model/seat';
import { storageGeometry, storageInterior, boxGear, packEssentials, ESSENTIALS } from '../model/storage';
import { LASH_BOLTS, LASH_BOLT_AR_IN2, LASH_BOLT_AT_IN2, LASH_BOLT_DIA_IN, LASH_WASHER, lashBoltLength, sideRibStations } from '../model/side-ribs';
import { sideLateral } from './side-lateral';
import type { Ctx } from './context';
import { dualCheck, governing, singleCheck, detail, type CaseEval } from './dual';
import { f } from './format';
import type { CaseData } from './loads';
import { allowables } from './structure';
import { seatFactor } from './bump';
import type { AnalysisCheck, Detail } from './types';

/** Effective bearing height of the stile on the wedge crest (crest plus the lid frame above it), in. */
export const CRUSH_HEIGHT_IN = 1;
/** Share of the ply bending design stress taken as rolling shear / tear-out strength (assumed, ply is weak in rolling shear). */
const PLY_SHEAR_FRAC_OF_MOR = 0.15;

/**
 * Numbers behind the seat-back check for one rider mass, exported for the tests. D-62: the back is a bare 12 mm okoume panel. Per station (2 stations): w = Q / (2H) aft along the back; the
 * back leans on the full-width oak crest strip at height A and is held at its foot by the hinge (B = 0): R_A = w H (H/2 - B)/(A - B), R_B = w H - R_A (negative = the hinge is pulled toward
 * the support). The moment M(x) = R_B x + R_A (x - A)+ - w x^2/2 (per station) is taken over the whole width W as a strip, m = 2 M / W per inch of width, sigma = 6 m / t^2. Deflection of
 * the overhang above the crest at the static torso load.
 */
export function seatBackLoads(ctx: Ctx, riderLb: number, g: number = ctx.p.dynamicFactor) {
  const { p } = ctx;
  const sup = seatBackSupport(p, ctx.L);
  const Q = riderLb * g * p.seatBackLoadFraction;
  const w = Q / 2 / sup.H;
  const A = sup.c2A, B = sup.c2B;
  const RA = (w * sup.H * (sup.H / 2 - B)) / (A - B);
  const RB = w * sup.H - RA;
  let M = 0, xM = 0;
  for (const x of [...Array.from({ length: 201 }, (_, i) => (sup.H * i) / 200), A]) {
    const m = Math.abs(RB * x + (x > A ? RA * (x - A) : 0) - (w * x * x) / 2);
    if (m > M) { M = m; xM = x; }
  }
  const t = Math.min(p.seatBackPlyIn, sup.t);
  const m = (2 * M) / sup.W; // lb.in per inch of width
  const sigmaPly = (6 * m) / (t * t);
  const L = sup.H - A;
  const Q1 = riderLb * p.seatBackLoadFraction; // static, for the deflection
  const wPress = Q1 / (sup.H * sup.W); // lbf per in^2 of panel face
  const Eply = allowables(ctx).Eply;
  const defl = (wPress * L ** 4) / (8 * Eply * (t ** 3 / 12));
  const stations = 2;
  const halfEdge = sup.fw / 2 - 0.2; // from the pin hole edge to the panel side edge
  return { sup, Q, w, A, B, RA, RB, T: Math.max(0, -RB), M, xM, t, m, sigmaPly, defl, stations, edge: halfEdge };
}

export function seatBackCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const lg = latchGeometry(p, ctx.L); // D-63: geometry only, the same for every rider
  const ev = (c: CaseData): CaseEval => {
    const gF = seatFactor(ctx, c);
    const k = seatBackLoads(ctx, c.riderLb, gF);
    const contactW = 2 * k.sup.stileY + k.sup.fw;
    const pinBear = p.seatPinPullLbf / (0.375 * k.t); // 3/8 in pin: F / (d t)
    const pinTear = p.seatPinPullLbf / (2 * Math.max(0.05, k.edge) * k.t);
    const ds: Detail[] = [
      detail('panel bending (bare 12 mm ply as a strip above and below the crest line)', k.sigmaPly, 'psi', al.plyBend, '<='),
      detail('crest bearing on the oak crest strip (full width)', (2 * k.RA) / (contactW * CRUSH_HEIGHT_IN), 'psi', al.oakPerp, '<='),
      detail('hinge load (each hinge, screws in the oak backer)', k.T, 'lbf', p.seatHingeLoadLbf, '<='),
      detail('hinge leaf inserts pull-out (each of 3 threaded inserts in the ply)', k.T / 3, 'lbf', p.seatInsertPulloutLbf, '<='),
      detail('latch pin bearing on the 12 mm ply (pull per pin)', pinBear, 'psi', al.plyBend, '<='),
      detail('latch pin tear-out toward the panel edge (ply rolling shear)', pinTear, 'psi', al.plyBend * PLY_SHEAR_FRAC_OF_MOR, '<='),
      detail('panel overhang deflection at the static torso load', k.defl, 'in', 0.375, '<='),
      detail('oak left behind the upright latch hole (stop block; the 4 mm box end is behind it)', lg.upLeftIn, 'in', LATCH_HOLE_WALL_MIN_IN, '>='),
      detail('oak left under the flat latch hole (hinge backer pad)', lg.flatLeftIn, 'in', LATCH_HOLE_WALL_MIN_IN, '>='),
    ];
    const how = `Rider ${f(c.riderLb, 0)} lb × dynamic ${f(gF, 2)} (max of the dynamic factor and 1 + V_rear/W, spec 5.4) × torso share ${p.seatBackLoadFraction} = ${f(k.Q)} lbf aft over the ${f(k.sup.H)}" frameless back, ${f(k.w, 2)} lbf/in at each of 2 stations. `
      + `The bare ${f(k.t * 25.4, 0)} mm panel leans on the full-width oak crest strip at ${f(k.A, 2)}" and is held at its foot by the hinges (${f(k.B, 2)}"): `
      + `R_A = ${f(k.RA)} lbf per station, hinge load ${f(k.T)} lbf per hinge; worst moment ${f(k.M)} lb·in per station at ${f(k.xM, 1)}" up the back, over the ${f(k.sup.W)}" width m = 2M/W = ${f(k.m, 1)} lb·in/in, σ = 6m/t² = ${f(k.sigmaPly, 0)} psi (≤ ${f(al.plyBend, 0)}); `
      + `bearing ${f((2 * k.RA) / (contactW * CRUSH_HEIGHT_IN), 0)} psi on ${f(contactW, 1)}" × ${CRUSH_HEIGHT_IN}" of crest (≤ ${f(al.oakPerp, 0)}); hinge ${f(k.T, 0)} lbf (≤ ${f(p.seatHingeLoadLbf, 0)}), ${f(k.T / 3, 0)} lbf on each of 3 inserts (≤ ${f(p.seatInsertPulloutLbf, 0)}, verify by a pull test); `
      + `latch pins ${f(k.sup.c2L, 2)}" up the panel (D-63): blind holes ${f(lg.upHoleIn, 4)}" in the stop block (${f(lg.blockIn, 2)}" thick along the pin, ${f(lg.upLeftIn, 2)}" of oak left behind the hole, ≥ ${LATCH_HOLE_WALL_MIN_IN}") and ${f(lg.flatHoleIn, 3)}" in the 1" backer pad when flat (${f(lg.flatLeftIn, 2)}" left); latch pin pull ${f(p.seatPinPullLbf, 0)} lbf: bearing ${f(pinBear, 0)} psi on 3/8" × ${f(k.t, 2)}", tear-out ${f(pinTear, 0)} psi on 2 × ${f(k.edge, 2)}" × ${f(k.t, 2)}" (rolling shear ${f(al.plyBend * PLY_SHEAR_FRAC_OF_MOR, 0)}); static deflection of the ${f(k.sup.H - k.A, 1)}" overhang ${f(k.defl, 3)}". `
      + `The two-block version (without the crest strip) would span ${f(2 * k.sup.stileY, 1)}" between the blocks and overstress the panel; a frame was the fallback and is not needed.`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'seat-back',
    label: 'Seat-back load (frameless 12 mm panel, crest strip, hinge inserts, latch pins)',
    group: 'Structure',
    refs: ['D-9', 'D-40', 'D-62'],
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
    // D-63 (3c-8 S9): the screw heads bear on a continuous 316 backing strip (1/16 x 1 in x board length) on the outer face of the outer gunwale band; all six tensions load the strip against the band,
    // and each head's 3/8 in washer punches the strip.
    const Ttotal = GRIP_BOLT_COLS * k * GRIP_BOLT_ROWS_IN.reduce((m, d) => m + d, 0);
    const stripA = gripBackingLen(p.grabBoardLengthIn) * GRIP_BACKING_H_IN - (GRIP_BOLTS * Math.PI * 0.28 ** 2) / 4; // net of the 9/32 in holes
    const punchD = 0.375;
    const punch = Tbolt / (Math.PI * punchD * GRIP_BACKING_T_IN);
    const ds: Detail[] = [
      detail('grab bar bending over the hole', Mbar / Sbar, 'psi', al.oakBend, '<='),
      detail('bolt tension (each, the couple of the two rows)', Tbolt / boltArea, 'psi', p.ss316BoltYieldPsi / p.steelSafetyFactor, '<='),
      detail('washer bearing on the oak (⊥ grain)', Tbolt / washerA, 'psi', al.oakPerp, '<='),
      detail('heads: 316 backing strip bearing on the outer gunwale band (⊥ grain, all six bolts)', Ttotal / stripA, 'psi', al.oakPerp, '<='),
      detail('heads: 3/8" washer punching the 1/16" backing strip (shear)', punch, 'psi', (0.577 * p.ss316BoltYieldPsi) / p.steelSafetyFactor, '<='),
      detail('finger gap (no pinch)', p.grabHoleHeightIn, 'in', 1.25, '>='),
      detail('clear length (hand)', hl, 'in', 3.5, '>='),
    ];
    const how = `Pull ${f(F)} lbf (0.5 × ${f(c.riderLb, 0)} lb × ${f(gF, 2)}) on one board: the ${f(bt, 2)}" × ${f(bar, 2)}" bar over the ${f(hl, 2)}" hole, M = F·L/4 = ${f(Mbar)} lb·in, σ = M/S = ${f(Mbar / Sbar, 0)} psi (≤ ${f(al.oakBend, 0)}). `
      + `The pull acts ${f(arm, 2)}" above the gunwale top; the ${GRIP_BOLTS} bolts (${GRIP_BOLT_COLS} columns × 2 rows ${GRIP_BOLT_ROWS_IN.join('" and ')}" below the top) resist it as a couple: T = F·arm·d_max/(cols·Σd²) = ${f(Tbolt)} lbf on the worst bolt, ${f(Tbolt / boltArea, 0)} psi on the ${f(boltArea, 4)} in² tensile area (≤ ${f(p.ss316BoltYieldPsi / p.steelSafetyFactor, 0)}), ${f(Tbolt / washerA, 0)} psi under the ${f(GRIP_WASHER_OD_IN, 2)}" fender washer (≤ ${f(al.oakPerp, 0)}). The heads bear on the ${GRIP_BACKING_T_IN}" × ${GRIP_BACKING_H_IN}" × ${f(gripBackingLen(p.grabBoardLengthIn), 1)}" stainless strip (D-63): ${f(Ttotal)} lbf over ${f(stripA, 1)} in², ${f(Ttotal / stripA, 0)} psi on the outer band, ${f(punch, 0)} psi punching through the strip under a ${punchD}" washer. `
      + `Finger gap ${f(p.grabHoleHeightIn, 2)}" (≥ 1.25") and ${f(hl, 2)}" clear length (≥ 3.5"): no pinch point (D-40).`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'seat-grip',
    label: 'Side grab board (bar bending, bolts, no pinch)',
    group: 'Structure',
    refs: ['D-40', 'D-57'],
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
  const gear = boxGear(ctx.parts, p);
  const chocks = gear.chocks;
  const tools = gear.tools; // D-78: the ratchet pouch, only with removable knees
  const r = packEssentials(interior, [...ESSENTIALS, ...chocks, ...tools]);
  const r0 = packEssentials(interior);
  const rNoTools = tools.length ? packEssentials(interior, [...ESSENTIALS, ...chocks]) : r;
  const chockIn3 = r.rigidIn3 - r0.rigidIn3;
  const lines = ESSENTIALS.map((k) => `${k.qty > 1 ? `${k.qty} × ` : ''}${k.name}${k.dims ? ` ${k.dims.join('×')}"` : ` ${k.softVolIn3} in³ soft`}`).join('; ');
  return singleCheck({
    id: 'storage-pack',
    label: tools.length ? 'Storage box fits the 10 Essentials kit, the wheel chocks and the tool pouch' : 'Storage box fits the 10 Essentials kit and the wheel chocks',
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
      + (tools.length ? `Removable knees (D-78) add the tool pouch for the ratchet, the 9/16" socket and the 9/16" wrench: ${tools[0].dims!.map((v) => f(v, 1)).join('×')}" (a tool, not sled mass, ${f(tools[0].dims!.reduce((a, b) => a * b, 1), 0)} in³) is inside the numbers above; without it the fill is ${f(rNoTools.fill, 2)}. ` : '')
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
  const xs = sideRibStations(ctx.p, ctx.L).map((st) => f(st.x, 1));
  return singleCheck({
    id: 'lash-points',
    label: 'Lash points for gear hauling',
    group: 'Structure',
    value: n,
    unit: 'points',
    limit: 6,
    sense: '>=',
    marginalAbs: 0,
    refs: ['D-41', 'D-76'],
    how: `${n} D-rings, through-bolted to the heads of the side ribs (D-76: ${ctx.p.lashPointsPerSide} per side, ribs at x = ${xs.join(', ')}"), so the tie-downs bracket the whole bed; each bolt plate is rated for a ${ctx.p.lashLoadLbf} lbf strap load. At least 6 are required (D-76).`,
  });
}

/** Numbers behind the lash-load check (D-76: four #8-32 machine screws through the rib head and the side sandwich), exported for the tests. */
export function lashLoads(ctx: Ctx) {
  const { p } = ctx;
  const th = (p.lashPullAngleDeg * Math.PI) / 180;
  const V = p.lashLoadLbf * Math.sin(th); // up the head: shear in the bolts, bearing on the head along its grain
  const H = p.lashLoadLbf * Math.cos(th); // inboard: bolt tension, the fender washers bear on the outer band
  const T1 = H / LASH_BOLTS, V1 = V / LASH_BOLTS;
  const Ft = p.lashBoltYieldPsi / p.steelSafetyFactor, Fv = (0.6 * p.lashBoltYieldPsi) / p.steelSafetyFactor;
  const sigT = T1 / LASH_BOLT_AT_IN2, tau = V1 / LASH_BOLT_AR_IN2;
  const interaction = Math.hypot(sigT / Ft, tau / Fv);
  const headBearing = V1 / (LASH_BOLT_DIA_IN * p.sideRibDepthIn);
  const washerArea = (Math.PI / 4) * (LASH_WASHER.od ** 2 - LASH_WASHER.id ** 2);
  const washerBearing = T1 / washerArea;
  const sl = sideLateral(ctx);
  return { V, H, T1, V1, Ft, Fv, sigT, tau, interaction, headBearing, washerArea, washerBearing, ribSig: sl.rating.ribSigMax, ribN: sl.rating.ribSigMaxN, ribM: sl.rating.ribMMax, bolt: lashBoltLength(p) };
}

export function lashLoadCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const k = lashLoads(ctx);
  const ds: Detail[] = [
    detail('bolt tension and shear together ((σ/Ft)² + (τ/Fv)², square root)', k.interaction, '', 1, '<='),
    detail('bolt bearing on the oak head (along its grain)', k.headBearing, 'psi', al.oakDowel, '<='),
    detail('fender washer bearing on the outer gunwale band (compression ⊥)', k.washerBearing, 'psi', al.oakPerp, '<='),
    detail(`rib bending at the rating (rib ${k.ribN})`, k.ribSig, 'psi', al.oakBend, '<='),
  ];
  const g = ds.reduce((a, b) => (b.util > a.util ? b : a), ds[0]);
  return singleCheck({
    id: 'lash-load',
    label: 'Lash point pull (through-bolts, head and rib)',
    group: 'Structure',
    value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, details: ds,
    refs: ['D-41', 'D-76'],
    how: `One D-ring plate pulled at its ${p.lashLoadLbf} lbf working load, ${p.lashPullAngleDeg}° above the deck: V = ${f(k.V)} lbf up the rib head, H = ${f(k.H)} lbf inboard. `
      + `D-76: the plate is through-bolted to the rib head with ${LASH_BOLTS} #8-32 x ${k.bolt.len}" stainless machine screws (washer, side sandwich, head, plate, nylock: ${k.bolt.need.toFixed(2)}"), so nothing withdraws: each takes ${f(k.T1)} lbf of tension (${f(k.sigT, 0)} psi on ${LASH_BOLT_AT_IN2} in², allowable ${f(k.Ft, 0)} = ${f(p.lashBoltYieldPsi, 0)} / ${p.steelSafetyFactor}) and ${f(k.V1)} lbf of shear (${f(k.tau, 0)} psi on the ${LASH_BOLT_AR_IN2} in² root, allowable ${f(k.Fv, 0)}); together ${k.interaction.toFixed(2)}. `
      + `Bearing: ${f(k.V1)} lbf per bolt on ${LASH_BOLT_DIA_IN}" x ${p.sideRibDepthIn}" of head = ${f(k.headBearing, 0)} psi (≤ ${f(al.oakDowel, 0)}; the bands and web behind it not counted); the ${LASH_WASHER.od}" fender washer outside bears ${f(k.washerBearing, 0)} psi on the outer band (≤ ${f(al.oakPerp, 0)}, compression ⊥). `
      + `Rib: each rib pulled alone at ${f(k.H)} lbf inboard in the side-lateral model; rib ${k.ribN} takes ${f(k.ribM, 0)} lb·in above its base, ${f(k.ribSig, 0)} psi on the rib section (≤ ${f(al.oakBend, 0)}). The side's own stresses at the rating are in the side-lateral row.`,
  });
}

/** All workstream D checks. The orchestrator adds these to `runChecks` (and the ids to GROUP_OF_ID, all 'Structure'). */
export function seatChecks(ctx: Ctx): AnalysisCheck[] {
  return [seatBackCheck(ctx), seatGripCheck(ctx), storagePackCheck(ctx), lidOpenCheck(ctx), lashPointsCheck(ctx), lashLoadCheck(ctx)];
}
