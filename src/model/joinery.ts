/**
 * Joinery (Phase 3, D-35): turns the finished hull and frame parts into structured `joints`.
 *
 * Every physical joint is recorded on BOTH parts it joins (so a part's own list shows every cut it needs), each with
 * `at` in that part's own local frame. `joinerySummary` counts a physical joint once. The rules are choices made by
 * stock thickness: a Festool Domino where the host keeps a sound wall behind the mortise, a loose tenon where
 * it does not (thin members: a loose tenon), grooves and rabbets that capture the ply, glue + epoxy fillets,
 * and threaded inserts + knobs for everything that comes off (D-9).
 */
import { joistId } from './frame';
import { thinSheet, WEATHER_SPEC, type Params } from '../params';
import { frac64, SIDES, type Ctx, stainless, insertMat, INSERT_DRILL_IN } from './build-utils';
export { frac64 };
import { sideTopAt } from './layout';
import { SCUPPER_BELOW_SURFACE_IN, scupperSites, signBackerPlan, signKnobPlan } from './body';
import { worldAABB } from './bounds';
import { pickWoodScrew, screwMinBite, screwText } from './rear-mount';

/** Bite of a rail-to-chine screw into the chine sandwich edge (outer band + web) after it has crossed the rail (in). */
export const RAIL_CHINE_BITE_IN = 0.5;
/** A crossmember whose front face is closer than this to the bow bulkhead's rear face is glued to it and to the rails, with no rail Domino (round-2 engineering review: mortise clash). */
const BULKHEAD_SNUG_IN = 0.25;
/** D-75: the counterbore for each #8 flat-head screw that holds the UHMW thrust disc to the king beam (from the disc's sliding face): diameter and depth (in). */
export const THRUST_SCREW_CBORE_DIA_IN = 0.375;
export const THRUST_SCREW_CBORE_DEEP_IN = 0.25;
/**
 * D-72, D-82, D-91: the one rail-to-chine screw length (#8 x 2-1/2, TRIM-HEAD), and the bit that counterbores its head where the rail is deeper than that. The screw sits 0.215" in from the
 * hull's outside face (the middle of the side's bearing edge), so a 3/8" bore for a flat head left only 1/32" of wall there; a #8 trim head is about 7/32" across and goes in a 1/4" bore,
 * which leaves about 3/32". The bore is plugged with a 1/4" oak plug (a plug cutter on offcuts, or a 1/4" dowel).
 */
export const RAIL_CHINE_SCREW_IN = 2.5;
export const RAIL_CHINE_PLUG_DIA_IN = 1 / 4;
/** D-91: the head of a #8 trim-head screw (in), about 7/32". */
export const RAIL_CHINE_HEAD_DIA_IN = 7 / 32;
import type { Joint, JointType, Mat4, Part, ScrewFit, Vec3 } from './types';

// ── Festool Domino catalog (nominal mm, thickness × length) ──
export interface DominoSize {
  name: string;
  tool: 'DF 500' | 'DF 700 XL';
  tMm: number;
  /** Tenon LENGTH = total depth across the joint (about L/2 into each piece), NOT the dimension along the joint face. */
  lMm: number;
  /** Tenon face width (the dimension along the joint face), Festool nominal on the tight DF 500 setting / XL. */
  wMm: number;
}
export const DOMINOS: readonly DominoSize[] = [
  { name: '4×20', tool: 'DF 500', tMm: 4, lMm: 20, wMm: 17 },
  { name: '5×30', tool: 'DF 500', tMm: 5, lMm: 30, wMm: 19 },
  { name: '6×40', tool: 'DF 500', tMm: 6, lMm: 40, wMm: 20 },
  { name: '8×40', tool: 'DF 500', tMm: 8, lMm: 40, wMm: 22 },
  { name: '8×50', tool: 'DF 500', tMm: 8, lMm: 50, wMm: 22 },
  { name: '10×50', tool: 'DF 500', tMm: 10, lMm: 50, wMm: 24 },
  { name: '8×80', tool: 'DF 700 XL', tMm: 8, lMm: 80, wMm: 26 },
  { name: '10×80', tool: 'DF 700 XL', tMm: 10, lMm: 80, wMm: 28 },
  { name: '12×100', tool: 'DF 700 XL', tMm: 12, lMm: 100, wMm: 30 },
  { name: '14×100', tool: 'DF 700 XL', tMm: 14, lMm: 100, wMm: 34 },
];
const MM = 25.4;
/** D-81: the tenon should be about a third of the stock; never more than this fraction (0.34; it was 0.42). */
const DOMINO_MAX_T_FRAC = 0.34;
/** CNC stub tenon: thickness is a third of the stock, width capped here. */
const STUB_MAX_WIDTH_IN = 1;
const MIN_BAND_IN = 0.4;

export interface DominoQuery {
  /** Thickness of the piece that carries the tenon (the Domino sits in its end or edge), in. */
  stockIn: number;
  /** Thickness of the host the other mortise is cut into, along the mortise depth (length / 2), in. */
  hostIn: number;
  /** Room along the joint face (the tenon's face width must fit it with edge margins), in. */
  widthIn: number;
  /** Dimension of the tenon-carrying piece along the tenon axis (the mortise depth L/2 must fit it with a wall); omit when it is not limiting. */
  stockAlongIn?: number;
}

/**
 * Largest DF 500 Domino (by tenon area, D-81) that (a) is no thicker than 0.34× the stock, (b) has mortise depth L/2 that keeps a sound wall in the host
 * (and in the tenon-carrying piece if `stockAlongIn` is given), and (c) whose FACE WIDTH (wMm, not L) fits the joint face with an edge margin; null if none.
 * Example: 6×40 in 1½" × 1½" stiles: T 6 mm ≤ 1.5·0.34 in; depth 20 mm = 0.79" into a 1.5" member; face width 20 mm = 0.79" along a 1.5" rail end, 0.36" margins.
 */
export function chooseDomino(p: Params, q: DominoQuery): DominoSize | null {
  let best: DominoSize | null = null;
  for (const d of DOMINOS) {
    if (d.tool !== 'DF 500') continue; // D-81: the shop tool is the Festool Domino DF 500; the DF 700 XL sizes stay in the table but are never chosen
    const wall = q.hostIn - d.lMm / 2 / MM;
    if (d.tMm / MM > q.stockIn * DOMINO_MAX_T_FRAC) continue;
    if (wall < p.dominoMinWallIn) continue;
    if (q.stockAlongIn !== undefined && q.stockAlongIn - d.lMm / 2 / MM < p.dominoMinWallIn) continue;
    if (d.wMm / MM > q.widthIn - 2 * p.dominoEdgeIn) continue;
    if (!best || d.tMm * d.lMm > best.tMm * best.lMm) best = d;
  }
  return best;
}

/** Nearest 1/16" as a string, e.g. 0.1875 -> "3/16", 1.5 -> "1-1/2". */
export function frac(x: number): string {
  const n = Math.round(x * 16);
  const whole = Math.floor(n / 16);
  let num = n % 16, den = 16;
  while (num > 0 && num % 2 === 0) { num /= 2; den /= 2; }
  if (num === 0) return `${whole}`;
  return whole > 0 ? `${whole}-${num}/${den}` : `${num}/${den}`;
}

export interface EndJoint {
  type: JointType;
  size: string;
  /** Width actually used along the joint face. */
  widthIn: number;
}

/** Oak left behind a loose-tenon mortise in its host (in): a fabrication rule, so a slip of the router or a panel planed thin cannot break through the face. */
const TENON_WALL_IN = 0.25;

/** Joint for the end of a `stockIn`-thick piece into a `hostIn`-thick host over `bandIn` of face: Domino if it fits, else a loose tenon (both parts mortised: CNC or router; shop-made tenon stock). Not an integral CNC tenon (build review S2). */
export function endJoint(p: Params, stockIn: number, hostIn: number, bandIn: number): EndJoint {
  const d = chooseDomino(p, { stockIn, hostIn, widthIn: bandIn });
  if (d) return { type: 'domino', size: `${d.name} (${d.tool})`, widthIn: d.wMm / MM };
  const w = Math.max(0.25, Math.min(STUB_MAX_WIDTH_IN, bandIn - 0.2));
  const t = Math.max(0.125, Math.round((stockIn / 3) * 16) / 16);
  // Keep TENON_WALL_IN of oak behind the mortise in the host (a 1/2" transom with a 3/8" mortise left 1/8" behind its show face): a shallower mortise, never a thinner wall.
  const depth = Math.max(0.125, Math.min(p.tenonDepthIn, Math.floor((hostIn - TENON_WALL_IN) * 16 + 1e-9) / 16));
  return { type: 'mortise-tenon', size: `${frac(t)} × ${frac(w)} × ${frac(depth)} deep loose tenon (both parts mortised; rounded-edge tenon stock)`, widthIn: w };
}

// ── Frames ──
/** A model-frame point in the local frame of a part with transform `m` (translation + rotation, uniform scale). */
export function toLocal(m: Mat4, pt: Vec3): Vec3 {
  const d = [pt[0] - m[12], pt[1] - m[13], pt[2] - m[14]];
  const col = (c: number): Vec3 => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return [0, 1, 2].map((c) => dot(d, col(c)) / dot(col(c), col(c))) as Vec3;
}
function toModel(m: Mat4, l: Vec3): Vec3 {
  return [m[0] * l[0] + m[4] * l[1] + m[8] * l[2] + m[12], m[1] * l[0] + m[5] * l[1] + m[9] * l[2] + m[13], m[2] * l[0] + m[6] * l[1] + m[10] * l[2] + m[14]];
}

interface Pair {
  a: string;
  b: string;
  typeA: JointType;
  typeB?: JointType;
  size: string;
  sizeB?: string;
  /** Model-frame joint locations (shared). */
  pts: Vec3[];
  /** Model-frame locations on part `b`, when they differ from `pts` (a knob screw ends in an insert at the face of its backer, not at the knob). */
  ptsB?: Vec3[];
  noteA?: string;
  noteB?: string;
  /** Record the joint on `a` only (a hole in a host for a cable that is drawn only where it is exposed; the mating part has no matching feature). */
  hostOnly?: boolean;
  /** A wood screw's fit against its stack (D-72), copied to both ends of the joint. */
  fit?: ScrewFit;
  /** Hole diameter (in), for a `hole` joint. */
  diaIn?: number;
}

/** Add the structured joints for the hull and frame to `parts` (mutates them). Call once on a freshly built model. */
export function applyJoinery(ctx: Ctx, parts: Part[]): void {
  const { p, L } = ctx;
  const byId = new Map(parts.map((x) => [x.id, x]));
  const has = (id: string) => byId.has(id);
  const pairs: Pair[] = [];
  const add = (q: Pair) => { if (has(q.a) && has(q.b) && q.pts.length) pairs.push(q); };

  const dd = p.deckCaptureDepthIn;
  const ddS = L.deckEdge; // the deck edge's depth under the inner chine band: the band's thickness at most, less deckSideClearIn (D-62, D-63)
  const bandT = L.sideBand;
  const pl = ctx.d.thinPlyIn;
  const rearTx = L.xRear + L.transom;
  const jD = p.crossmemberDepthIn;
  const railT = p.railThicknessIn;

  const ds = p.deckSlopIn;
  const rabbetH = (top: number, bot: number) => top - bot + ds;
  const deck = 'deck'; // one deck level (D-52): a single deck part
  const bot = L.deckBot;
  const cBot = L.chineBot;
  const xm = (rearTx + L.xSideEnd) / 2;
  const xj = rearTx + 1;
  const topAt = (x: number) => sideTopAt(L, x);
  const hw = L.hwC;
  const hwAt = (x: number) => L.hwC - L.turnIn(x); // the inner half width follows the bow turn-in (D-57)
  const rabbetZ = rabbetH(L.deckTop, bot);
  const webZMid = (x: number) => (cBot + topAt(x) - L.webCap) / 2;

  // ── Sides (D-61, D-62): the sandwich glue faces, the deck gap under the inner chine band, end joints to the rear transom and the bow bulkhead ──
  for (const { s, tag } of SIDES) {
    const id = `side-${tag}`;
    const web1 = `${id}-web`;
    const yOutFace = s * (hw + L.side - bandT), yInFace = s * (hw + bandT); // the web's two faces
    const yOutBand = s * (hw + L.side - bandT / 2), yInBand = s * (hw + bandT / 2);
    const glueSize = `thickened epoxy, full face (${bandT.toFixed(3)}" oak strip on the ${Math.round(pl * 25.4)} mm web; no groove)`;
    const bandPairs: [string, string, number, number][] = [
      [`${id}-chine`, 'outer chine band', yOutFace, cBot + L.chineH / 2],
      [`${id}-chine-in`, 'inner chine band', yInFace, cBot + rabbetZ + (L.chineH - rabbetZ) / 2],
      [`${id}-gunwale`, 'outer gunwale band', yOutFace, topAt(xm) - L.railBand / 2],
      [`${id}-gunwale-in`, 'inner gunwale band', yInFace, topAt(xm) - L.railBand / 2],
    ];
    for (const [bandId, what, yf, zf] of bandPairs) for (const [w, xw] of [[web1, xm]] as [string, number][])
      add({ a: bandId, b: w, typeA: 'glue', size: glueSize, pts: [[xw, yf, zf]], noteA: `Glued full-face to the web and bent with it on the plan form (the ${what} of the sandwich).`, noteB: `Oak band glued on this face (${what}).` });
    // The deck edge rises into the gap under the inner chine band, against the web.
    add({ a: `${id}-chine-in`, b: deck, typeA: 'rabbet', size: `${frac(ddS)}" × ${rabbetZ.toFixed(3)}" gap under the inner chine band (deck + ${frac64(ds)}" clearance, thickened epoxy fills it; no routing); the deck edge is cut ${frac(p.deckSideClearIn)}" short of the web on each side (D-63), the slot is filled with thickened epoxy`, pts: [[xj, s * (hw + ddS / 2), L.deckBot + L.ply / 2]], noteB: 'Edge of the deck, in the gap against the web.' });
    // Web end into a dado in the transom (full web height now). The dado runs from the chine up and OUT through the top edge: the web top is within about 0.02 in of the rounded top corner, so a
    // stopped dado would leave a wall thinner than 1/8 in (it poked through by 0.015 in); open at the top it is one simple cut with no relief needed on the web (Phase 4 finding).
    add({ a: 'transom-rear', b: web1, typeA: 'dado', size: `${(pl + p.grooveSlopIn).toFixed(3)}" × ${frac(dd)}" dado up from the chine and out through the top edge (open at the top: no thin wall at the rounded corner; the epoxy fillet fills the run-out), ${frac(p.ventHoleIn)}" vent hole through the transom mid-height`, pts: [[rearTx - dd / 2, s * (hw + L.side / 2), webZMid(rearTx)]], noteA: 'Vented: the transom slides on last, so air and epoxy must escape (hydraulic lock, M4).', noteB: 'End of the web, captured (rear); it enters the dado with the transom\'s slide in X. The deck dado runs into this dado at the corner.' });
    // Band ends butt the transom face (a band is 0.234 in thick: too thin for a Domino); the web in its dado and the epoxy fillet inside carry the corner.
    const bandEnds: [string, number, number][] = [
      [`${id}-chine`, cBot + L.chineH / 2, yOutBand], [`${id}-chine-in`, cBot + rabbetZ + (L.chineH - rabbetZ) / 2, yInBand],
      [`${id}-gunwale`, topAt(rearTx) - L.railBand / 2, yOutBand], [`${id}-gunwale-in`, topAt(rearTx) - L.railBand / 2, yInBand],
    ];
    for (const [bandId, z, yb] of bandEnds) add({ a: bandId, b: 'transom-rear', typeA: 'glue', size: 'epoxy + fillet (butt joint; the web in its dado locks the corner)', pts: [[rearTx, yb, z]], noteA: 'End of the band against the transom face; thickened-epoxy fillet inside.' });
    // The forward ends meet the rear face of the bow bulkhead (D-57): the web in a dado, the bands butt-glued with a fillet. As in the transom, the dado runs out through the top edge (its stopped top
    // would come within 0.02 in of the rounded corner, D-69).
    {
      const xe = L.xSideEnd, ye = s * (hwAt(xe) + L.side / 2);
      add({ a: web1, b: 'bow-bulkhead', typeA: 'dado', size: `${(pl + p.grooveSlopIn).toFixed(3)}" × ${frac(dd)}" dado in the bulkhead's rear face, up from the chine and out through the top edge (open at the top: no thin wall at the rounded corner; the epoxy fillet fills the run-out)`, pts: [[xe + dd / 2, ye, webZMid(xe)]], noteA: 'End of the web, captured (front); the bulkhead goes on after the rear transom (close one end first, S1).', noteB: 'Dado for the web end, open at the top. The deck dado runs into it at the corner.' });
      const yb = (face: 'out' | 'in') => s * (hwAt(xe) + (face === 'out' ? L.side - bandT / 2 : bandT / 2));
      const fwdEnds: [string, number, number][] = [
        [`${id}-chine`, cBot + L.chineH / 2, yb('out')], [`${id}-chine-in`, cBot + rabbetZ + (L.chineH - rabbetZ) / 2, yb('in')],
        [`${id}-gunwale`, topAt(xe) - L.railBand / 2, yb('out')], [`${id}-gunwale-in`, topAt(xe) - L.railBand / 2, yb('in')],
      ];
      for (const [bandId, z, yy] of fwdEnds) add({ a: bandId, b: 'bow-bulkhead', typeA: 'glue', size: 'epoxy + fillet (butt joint; the web in its dado locks the corner)', pts: [[xe, yy, z]], noteA: 'End of the band against the bulkhead\'s rear face; thickened-epoxy fillet inside.' });
    }
  }

  // ── Deck: rear transom dado, bow bulkhead dado, glued to the frame ──
  add({ a: 'transom-rear', b: deck, typeA: 'dado', size: `${rabbetH(L.deckTop, bot).toFixed(3)}" × ${frac(dd)}" dado across the front face (deck + ${frac64(ds)}" clearance), run out at each end into the web dados (one continuous pocket at each corner, no thin wall between them), ${frac(p.ventHoleIn)}" vent holes through the transom at both ends`, pts: [[rearTx - dd / 2, 0, L.deckBot + L.ply / 2]], noteB: 'Rear edge of the deck, captured; the dado joins the web dados at both corners.' });
  add({ a: 'bow-bulkhead', b: deck, typeA: 'dado', size: `${rabbetH(L.deckTop, bot).toFixed(3)}" × ${frac(dd)}" dado across the rear face (deck + ${frac64(ds)}" clearance), run out at each end into the web dados (one continuous pocket at each corner, no thin wall between them)`, pts: [[L.xFlatEnd + dd / 2, 0, L.deckBot + L.ply / 2]], noteB: 'Front edge of the deck, captured (the dado joins the web dados at both corners); the foot load pulls the bulkhead off it, so the dado glue line is part of the foot-stop row.' });
  for (const { s, tag } of SIDES) {
    add({ a: `rail-${tag}`, b: deck, typeA: 'glue', size: 'thickened epoxy, full face (the rail top is flush with the deck underside)', pts: [[(rearTx + L.railEnd) / 2, s * (hwAt((rearTx + L.railEnd) / 2) + L.side - railT / 2), L.railTop]], noteA: 'Deck bonded to the rail top (and the crossmember tops); weights or vacuum bag.' });
    // Side-to-frame tie (build review M6, D-43, D-81): the chine bears on the rail; a thickened-epoxy bed on the bearing face plus piloted screws up through the rail at even spacing.
    // No Dominos (D-81): the bearing edge is only the outer band + the web, so a tenon in it was 40 to 47 percent of the edge, and the analysis never credited it.
    const x0 = rearTx, x1 = L.railEnd;
    if (x1 - x0 >= (2 * p.chineTieSpacingIn) / 3) {
      const n = Math.max(2, Math.floor((x1 - x0) / p.chineTieSpacingIn));
      const webFace = Math.min(dd, L.sideBand); // the web's inner face, measured from hwC (the deck edge stops deckSideClearIn short of it, D-63)
      const flat = L.side - webFace; // the bearing face under the sandwich: outer band + web edge
      const pts = Array.from({ length: n }, (_, i) => { const x = x0 + ((i + 0.5) * (x1 - x0)) / n; return [x, s * (hwAt(x) + webFace + flat / 2), cBot] as Vec3; });
      const xMid = (x0 + x1) / 2;
      add({
        a: `side-${tag}-chine`, b: `rail-${tag}`, typeA: 'glue',
        size: `thickened epoxy bed, full length of the ${frac(flat)}" bearing face (outer band + web edge), screwed every ${p.chineTieSpacingIn}" (no Dominos, D-81)`,
        pts: [[xMid, s * (hwAt(xMid) + webFace + flat / 2), cBot]],
        noteA: 'SIDE-TO-FRAME TIE (D-43, D-81): the sandwich (outer chine band + web) sits on the rail top. Spread a thickened-epoxy bed along the whole bearing face; the screws through the rail, in EVERY gap at even spacing, register the side: their pilots are drilled into the side at the dry fit through the rail holes, so when the inverted frame + deck unit is lowered into the inverted side assembly (two temporary alignment blocks keep the side from sliding while the screws are started) each screw finds its pilot and draws the side onto the rail; clamps and cauls between the screws hold it while the epoxy cures.',
      });
      // Rail-to-chine screws (D-82): #8, piloted, at the middle of every gap between the n tie stations (even spacing; pilots drilled at the dry fit register the side), up through the rail and RAIL_CHINE_BITE_IN into the chine sandwich.
      // The rail is 3 in deep aft of the step and railDepthF forward of it, so the length is per rail-depth zone (the sloped step is the shallower of its two ends).
      const railD = p.railDepthIn, xs = L.railStepX, run = p.railStepRunIn;
      const depthAt = (x: number): number => (x <= xs - run ? railD : x >= xs ? L.railDepthF : railD + ((L.railDepthF - railD) * (x - (xs - run))) / run);
      const screwPts = Array.from({ length: Math.max(0, n - 1) }, (_, i) => i).map((i) => { // every gap (D-81): even spacing, they locate the side
        // On the curve, not on the chord between two stations: the averaged y of two stations in the S fell up to 0.15" off the bearing edge (round-1 engineering review).
        const xm = (pts[i][0] + pts[i + 1][0]) / 2;
        return [xm, s * (hwAt(xm) + webFace + flat / 2), cBot] as Vec3;
      });
      // D-72, D-82: ONE screw length for every rail depth (#8 x 2-1/2, the shortest standard #8 that bites RAIL_CHINE_BITE_IN where the rail is shallowest). Where the rail is deeper than the
      // screw can reach, the head is counterbored up the rail from its underside, so the tip still lands RAIL_CHINE_BITE_IN in the chine (the counterbore is plugged).
      const SCREW_LEN = RAIL_CHINE_SCREW_IN;
      const cbAt = (x: number): number => Math.max(0, depthAt(x) + RAIL_CHINE_BITE_IN - SCREW_LEN);
      const zoneOf = (x: number): 'deep' | 'ramp' | 'shallow' => (cbAt(x) <= 0.005 ? 'shallow' : depthAt(x) >= railD - 0.005 ? 'deep' : 'ramp');
      const byZone = new Map<string, Vec3[]>();
      for (const q of screwPts) { const z = zoneOf(q[0]); (byZone.get(z) ?? byZone.set(z, []).get(z)!).push(q); }
      for (const [zone, qs] of [...byZone.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const ds = qs.map((q) => depthAt(q[0])), dLo = Math.min(...ds), dHi = Math.max(...ds);
        const cbs = qs.map((q) => cbAt(q[0])), cbLo = Math.min(...cbs), cbHi = Math.max(...cbs);
        const depthText = Math.abs(dHi - dLo) < 0.005 ? `${frac(dHi)}" deep` : `${frac(dLo)}" to ${frac(dHi)}" deep`;
        const where = zone === 'deep' ? 'behind the step' : zone === 'shallow' ? 'ahead of the step' : 'on the sloped step';
        const cbText = cbHi <= 0.005 ? `no counterbore needed (the rail is shallow here, and the tip bites more than the minimum): a light countersink from the rail's underside lets the small trim head sink flush` : `counterbore the head ${Math.abs(cbHi - cbLo) < 0.005 ? frac(cbHi) : `${frac(cbLo)}" to ${frac(cbHi)}`}" up the rail from its underside (${frac(RAIL_CHINE_PLUG_DIA_IN)}" bit), a #8 trim head is about ${frac(RAIL_CHINE_HEAD_DIA_IN)}" across so the bore is ${frac(RAIL_CHINE_PLUG_DIA_IN)}"; then plug it with a ${frac(RAIL_CHINE_PLUG_DIA_IN)}" oak plug (a plug cutter on offcuts, or a ${frac(RAIL_CHINE_PLUG_DIA_IN)}" dowel), glued in and trimmed flush`;
        const fits = qs.map((q): ScrewFit => ({ gauge: 8, lenIn: SCREW_LEN, gripIn: depthAt(q[0]) - cbAt(q[0]), receivingIn: L.chineH, minBiteIn: screwMinBite(L.chineH) }));
        const fit = fits.reduce((a, b) => (b.lenIn - b.gripIn < a.lenIn - a.gripIn ? b : a));
        const biteLo = SCREW_LEN - Math.max(...fits.map((q) => q.gripIn)), biteHi = SCREW_LEN - Math.min(...fits.map((q) => q.gripIn));
        const biteText = Math.abs(biteHi - biteLo) < 0.005 ? frac(biteHi) : `${frac(biteLo)}" to ${frac(biteHi)}`;
        add({
          a: `rail-${tag}`, b: `side-${tag}-chine`, typeA: 'screw',
          size: `${screwText(fit)} ${stainless(p)} trim-head wood screws up through the rail (${depthText} here: ${where}; ${cbText}), ${biteText}" into the chine sandwich edge; PILOT (D-82): an 11/64" clearance hole through the rail, then a 1/8" pilot ${frac(biteHi + 1 / 8)}" deep into the chine edge (1/8" past the screw tip, as the drawings give it) (the threaded part of a #8 in white oak); keep them on the centerline of the ${frac(flat)}" edge (a #8 leaves ${((flat - 0.164) / 2).toFixed(2)}" a side; verify on a test piece that the edge does not split)`,
          pts: qs, noteA: `Every gap between the tie stations, at even spacing; rail ${depthText}.`, fit,
        });
      }
    }
  }

  // ── Axle hangers (D-54): glued and bolted to the inside of each rail, both ends of the joint recorded ──
  for (const { s, tag } of SIDES) for (const [pre, bx] of [['axle-hanger', L.beamR.x]] as const) {
    const hy = s * (hw + L.side - railT / 2 - p.axleHangerThickIn / 2);
    add({ a: `${pre}-${tag}`, b: `rail-${tag}`, typeA: 'glue', size: `${(p.axleHangerWidthIn).toFixed(2)}" × ${p.railDepthIn.toFixed(2)}" side-grain face, ${p.weatherSpec === WEATHER_SPEC.extreme ? 'epoxy' : 'Titebond III'}` /* D-73 glue rule */, pts: [[bx, hy, L.railTop - p.railDepthIn / 2]], noteA: 'Long-grain hanger to the rail inner face: the bolts carry the vertical load, the glue keeps the faces together.' });
    // The hanger's two bolts are the hold-down angle's upright bolts (D-72): one bolt per position through the leg, the hanger and the rail. They are recorded ONCE, on the angle (running-gear.ts),
    // so the fastener count is right; the hanger and rail drawings find them there (an inbound joint, and a bolt that passes through the rail).
  }

  // ── Frame: rails to the rear transom, crossmembers to the rails, joists to the deck ──
  for (const { s, tag } of SIDES) {
    const bandZ = L.deckBot - (L.deckTop - jD);
    if (bandZ >= MIN_BAND_IN + 0.2) {
      const ej = endJoint(p, railT, L.transom, bandZ - 0.2);
      add({ a: `rail-${tag}`, b: 'transom-rear', typeA: ej.type, size: ej.size, pts: [[rearTx, s * (hw + L.side - railT / 2), (L.deckTop - jD + L.deckBot) / 2]], noteA: 'Rail end into the transom face (the transom hangs jD below the deck).' });
    } else add({ a: `rail-${tag}`, b: 'transom-rear', typeA: 'glue', size: 'epoxy + fillet', pts: [[rearTx, s * (hw + L.side / 2), L.deckBot - 0.5]] });
    // The rail's front end into the bow bulkhead's rear face (D-57, D-69): the bulkhead's bottom is the bottom of the stepped front rail (the visible bottom of the side), so the whole
    // front rail depth is the band. The foot load pulls the bulkhead forward off these ends, so each rail takes a Domino (or a loose tenon) and a glue fillet.
    {
      const bandB = L.deckBot - (L.bulkhead.bot) - 0.2;
      const xe = L.railEnd, ye = s * (hwAt(xe) + L.side - railT / 2);
      if (bandB >= MIN_BAND_IN) {
        const ej = endJoint(p, railT, L.bulkhead.thick, bandB);
        add({ a: `rail-${tag}`, b: 'bow-bulkhead', typeA: ej.type, size: ej.size, pts: [[xe, ye, L.railTop - 0.1 - bandB / 2]], noteA: 'Rail end into the bulkhead\'s rear face (D-69: the bulkhead bottom is level with the bottom of the stepped front rail, so the whole rail depth is the band).' });
      } else add({ a: `rail-${tag}`, b: 'bow-bulkhead', typeA: 'glue', size: 'epoxy + fillet', pts: [[xe, ye, L.railTop - 0.5]] });
    }
  }
  const spanEnds = (id: string) => {
    const j = byId.get(id);
    if (!j) return null;
    const bb = worldAABB(j);
    return { j, x: (bb.min[0] + bb.max[0]) / 2, yMin: bb.min[1], yMax: bb.max[1], zc: (bb.min[2] + bb.max[2]) / 2, thick: bb.max[0] - bb.min[0] };
  };
  L.joistX.forEach((_x, i) => {
    const e = spanEnds(joistId(L, i));
    if (!e) return;
    for (const { s, tag } of SIDES) {
      // A joist cut back for the axle hanger butts the hanger's inner face; the others the rail's.
      const hangerPre = Math.abs(e.x - L.beamR.x) < p.axleHangerWidthIn / 2 + L.joistT / 2 ? 'axle-hanger' : null;
      const hangerHere = !!hangerPre && has(`${hangerPre}-${tag}`);
      const hostId = hangerHere ? `${hangerPre}-${tag}` : `rail-${tag}`;
      // A crossmember tight behind the bow bulkhead (the last one, a hair behind its rear face) takes no Domino in the rail: that mortise would meet the rail's own
      // end mortise into the bulkhead (round-2 engineering review). Its ends are glued to the rails and its front face is bedded on the bulkhead's rear face (below).
      const atBulkhead = !hangerHere && L.railEnd - (e.x + e.thick / 2) < BULKHEAD_SNUG_IN;
      if (atBulkhead) {
        add({ a: e.j.id, b: hostId, typeA: 'glue', size: 'thickened epoxy, butt joint (no Domino: the rail end carries the bulkhead mortise here)', pts: [[e.x, s * (s > 0 ? e.yMax : -e.yMin), e.zc]], noteA: 'End of the crossmember against the rail face, glued; it is held by the bulkhead and the deck.' });
        continue;
      }
      const ej = endJoint(p, e.thick, hangerHere ? p.axleHangerThickIn : railT, jD);
      add({ a: e.j.id, b: hostId, typeA: ej.type, size: ej.size, pts: [[e.x, s * (s > 0 ? e.yMax : -e.yMin), e.zc]], noteA: 'End of the crossmember into the member face; thickened epoxy, in the frame glue-up with the deck (D-92: one glue per glue-up).' });
    }
    if (L.railEnd - (e.x + e.thick / 2) < BULKHEAD_SNUG_IN && has('bow-bulkhead')) {
      add({ a: e.j.id, b: 'bow-bulkhead', typeA: 'glue', size: `thickened epoxy, bedding its front face on the bulkhead's rear face (a ${frac(Math.max(0, L.railEnd - (e.x + e.thick / 2)))} gap)`, pts: [[L.railEnd, 0, e.zc]], noteA: 'Front face of the last crossmember bedded on the bow bulkhead\'s rear face in thickened epoxy, filling the gap; the deck glued on top and the bulkhead\'s deck dado hold it.' });
    }
    add({ a: e.j.id, b: 'deck', typeA: 'glue', size: 'thickened epoxy, full length', pts: [[e.x, 0, e.zc + jD / 2]], noteA: 'Deck bonded to the crossmember top.' });
  });
  // ── Front pivot (D-56): the king beam holds the kingpin and the thrust washer; the two steering check chains anchor to it (D-58) ──
  {
    const kb = byId.get('king-beam');
    if (kb) {
      // Three screws on a circle between the bore and the rim (the BOM counts the joint's points: it was one, build review MUST-11); each passes through the disc and 3/4 in into the king beam.
      const rScrew = (p.kingThrustOdIn / 4) + (p.kingpinDiaIn / 4) + 0.015;
      // D-88: one screw straight aft and two at 120 deg either side of it, so none lands in the kingpin nut slot, which runs forward from the bore at the top of the king beam.
      const thrustScrews: Vec3[] = [180, 60, 300].map((deg): Vec3 => [L.king.x + rScrew * Math.cos((deg * Math.PI) / 180), rScrew * Math.sin((deg * Math.PI) / 180), L.king.bot]);
      // D-75 (review MUST-15f): the counterbore is sized: the #8 flat head (about 0.32 in) in a 3/8 in hole, 1/4 in deep from the disc's sliding face, so the head sits below the face and
      // the screw grips only the 1/4 in of UHMW left above it.
      const thrustFit = pickWoodScrew(8, Math.max(0.0625, p.kingThrustThickIn - THRUST_SCREW_CBORE_DEEP_IN), kb.stock?.t ?? L.king.top - L.king.bot);
      add({ a: 'king-beam', b: 'king-thrust', typeA: 'screw', size: `3 × ${screwText(thrustFit)} ${stainless(p)} flat-head screws (each in a ${frac(THRUST_SCREW_CBORE_DIA_IN)}" wide × ${frac(THRUST_SCREW_CBORE_DEEP_IN)}" deep counterbore from the disc's sliding face, ${frac(rScrew)} in from the kingpin axis) holding the UHMW disc to the king beam`, fit: thrustFit, pts: thrustScrews, noteA: 'Keeps the disc with the king beam; the axle beam turns under it (D-58).' });
      add({ a: 'king-beam', b: 'kingpin', typeA: 'hole', typeB: 'pin', size: `${frac(p.kingpinDiaIn)}" bore (snug bushing fit) through the king beam, thin nylock (jam) nut held by its flats in a slot cut from the front face (no washer)`, sizeB: `${frac(p.kingpinDiaIn)}" bolt turns in the bore; the nut only stops the axle dropping away (rebound)`, pts: [[L.king.x, 0, (L.king.bot + L.king.top) / 2]], noteA: 'Bored square to the face on the drill press; the nut slot is cut from the front before the deck goes on.' });
    }
    for (const { s, tag } of SIDES) {
      const [ax, ay, az] = L.chain.anchor;
      add({ a: `steer-anchor-${tag}`, b: joistId(L, L.joistX.indexOf(L.king.x) - 1), typeA: 'bolt', size: `${frac(p.steerEyeBoltDiaIn)}" forged shoulder eye bolt fore-aft through the chain crossmember, shoulder and 2" washer on its front face, nylock nut and 2" washer on the rear face`, pts: [[L.chain.joistX, s * Math.abs(ay), az]], noteA: 'Anchor of the steering check chain (D-58); the chain pulls the eye forward out of the crossmember.' });
      void ax;
      add({ a: `steer-eye-${tag}`, b: 'beam-F', typeA: 'bolt', size: `${frac(p.steerEyeBoltDiaIn)}" forged shoulder eye bolt fore-aft through the axle beam, nylock nut and 2" fender washer on its front face`, pts: [[L.king.x - L.beamF.thick / 2, s * L.chain.beamV, L.chain.beamZ]], noteA: 'Beam end of the steering check chain (D-58); the eye stands out of the trailing face.' });
    }
  }
  void deck;

  // ── Rear transom backers (S13): glued to the transom (D-73 glue rule), the handle-socket screws pass through both into T-nuts ──
  for (const { s, tag } of SIDES) {
    const bk = byId.get(`transom-backer-${tag}`);
    if (!bk) continue;
    const bb = worldAABB(bk);
    add({ a: bk.id, b: 'transom-rear', typeA: 'glue', size: `${p.weatherSpec === WEATHER_SPEC.extreme ? 'epoxy' : 'Titebond III'}, full face (D-73); the handle-socket screws pass through both into T-nuts set in the backer`, pts: [[bb.min[0], (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2]], noteA: 'Glue on the bench before the transom goes on.' });
    void s;
  }

  // ── Scuppers through the chine sandwich (M7, D-62): inner band, web and outer band ──
  if (p.weatherSpec === WEATHER_SPEC.extreme) {
    for (const site of scupperSites(ctx)) {
      for (const { s, tag } of SIDES) {
        const sc = byId.get(`scupper-${site.tagPos}-${tag}`);
        if (!sc) continue;
        for (const host of [`side-${tag}-chine`, `side-${tag}-chine-in`, `side-${tag}-web`])
          add({ a: sc.id, b: host, typeA: 'glue', size: `${frac(p.scupperDiaIn)}" ${stainless(p)} nipple bedded in epoxy; hole epoxy-lined through the inner band, the web and the outer band`, pts: [[site.x, s * (site.hw + L.side / 2), sc.transform[14]]], noteA: 'Drains the deck at deck level; no cut oak or ply edge is left bare.' });
      }
    }
  } else {
    // D-83 (Standard): no nipples. A plain drilled hole through the same sites, its bore sealed with epoxy, so no cut oak or ply edge is bare. One hole joint per host, on the host only.
    const dia = frac(p.scupperDiaIn);
    for (const site of scupperSites(ctx)) {
      for (const { s, tag } of SIDES) {
        const z = site.deckZ + SCUPPER_BELOW_SURFACE_IN + p.scupperDiaIn / 2;
        const hosts: [string, string, number, string][] = [
          [`side-${tag}-chine-in`, `side-${tag}-web`, site.hw + bandT / 2, 'inner chine band'],
          [`side-${tag}-web`, `side-${tag}-chine-in`, site.hw + L.side / 2, 'web'],
          [`side-${tag}-chine`, `side-${tag}-web`, site.hw + L.side - bandT / 2, 'outer chine band'],
        ];
        for (const [host, mate, ay, what] of hosts) add({
          a: host, b: mate, typeA: 'hole', hostOnly: true, diaIn: p.scupperDiaIn,
          size: `${dia}" drain hole through the ${what}, square to the side, its lower edge ${frac(SCUPPER_BELOW_SURFACE_IN)}" above the deck surface (${site.zone} corner); the bore is brushed with epoxy so no cut edge is bare`,
          pts: [[site.x, s * ay, z]], noteA: 'D-83: drilled with the others in one pass through the sandwich (a backer board behind the exit to stop tear-out); then seal the bore with epoxy. The Extreme spec fits a stainless nipple here instead.',
        });
      }
    }
  }

  // ── Signs (D-57, D-62, build 3c M4): four thumb-knob screws through the thin web into threaded inserts in two OAK BACKING STRIPS glued inside the web; nothing is screwed into the ply alone ──
  for (const { tag } of SIDES) {
    const sign = byId.get(`sign-${tag}`);
    if (!sign || sign.geometry.type !== 'box') continue;
    const { dx, dz } = signBackerPlan(ctx);
    const kn = signKnobPlan(ctx);
    const pts = ([[-dx, -dz], [dx, -dz], [-dx, dz], [dx, dz]] as const).map(([x, z]) => toModel(sign.transform, [x, 0, z]));
    const backers = [`sign-backer-${tag}1`, `sign-backer-${tag}2`].filter(has);
    pts.forEach((pt, i) => {
      const bk = backers[i % 2 === 0 ? 0 : 1] ?? backers[0]; // the points go left-lower, right-lower, left-upper, right-upper: even = the left strip
      if (bk) add({
        a: sign.id, b: bk, typeA: 'knob', typeB: 'threaded-insert',
        size: `#10-32 × ${kn.lenIn} in thumb-knob screw through a 7/32 clearance hole in the sign, a ${frac64(kn.standoffIn)}" oak standoff disc (epoxied to the sign back) and the ${thinSheet(p).nominal} web: ${frac64(kn.engagedIn)}" into the insert, tip ${frac64(kn.tipShortIn)}" short of the back of the strip`, sizeB: `#10-32 × 5/16 ${insertMat(p)} threaded insert (epoxied) in a blind ${frac(INSERT_DRILL_IN)} in hole in the oak backing strip inside the web`,
        pts: [pt], ptsB: [[pt[0], Math.sign(pt[1]) * (hw + bandT), pt[2]]], // the insert's mouth is on the backer's outboard face, against the web
        noteA: 'Sign comes off for transport (D-9). The screw goes through the web into the oak backing strip; nothing grips the thin ply alone (build 3c M4).',
      });
    });
  }
  for (const { s, tag } of SIDES) for (const bk of [`sign-backer-${tag}1`, `sign-backer-${tag}2`]) {
    const b = byId.get(bk);
    if (!b) continue;
    const bb = worldAABB(b);
    add({ a: bk, b: `side-${tag}-web`, typeA: 'glue', size: 'thickened epoxy, full face, on the inside of the thin web', pts: [[(bb.min[0] + bb.max[0]) / 2, s * (hw + bandT), (bb.min[2] + bb.max[2]) / 2]], noteA: 'Glued on the bench with the side assembly, before the sides go into the jig.' });
  }

  // ── Write both sides of every pair ──
  const push = (id: string, j: Joint) => {
    const part = byId.get(id)!;
    (part.joints ??= []).push(j);
  };
  for (const q of pairs) {
    const A = byId.get(q.a)!, B = byId.get(q.b)!;
    push(q.a, { type: q.typeA, to: q.b, count: q.pts.length, size: q.size, at: q.pts.map((pt) => toLocal(A.transform, pt)), ...(q.noteA ? { note: q.noteA } : {}), ...(q.fit ? { fit: q.fit } : {}), ...(q.diaIn ? { diaIn: q.diaIn } : {}) });
    if (q.hostOnly) continue;
    push(q.b, { type: q.typeB ?? q.typeA, to: q.a, count: q.pts.length, size: q.sizeB ?? q.size, at: (q.ptsB ?? q.pts).map((pt) => toLocal(B.transform, pt)), ...(q.noteB ?? q.noteA ? { note: q.noteB ?? q.noteA } : {}), ...(q.fit ? { fit: q.fit } : {}) });
  }
  locateJoints(parts);
}

export interface JoinerySummary {
  total: number;
  byType: Record<string, number>;
}

/** Count each physical joint once (a pair listed on both parts counts once); a pair of different hardware (knob + insert) counts both items. */
export function joinerySummary(parts: Part[], filter: (p: Part) => boolean = () => true): JoinerySummary {
  const byType: Record<string, number> = {};
  let total = 0;
  const byId = new Map(parts.map((x) => [x.id, x]));
  for (const part of parts) {
    if (!filter(part)) continue;
    for (const j of part.joints ?? []) {
      const other = byId.get(j.to);
      const mate = other?.joints?.find((k) => k.to === part.id && k.count === j.count);
      if (mate && other && other.id < part.id) continue;
      byType[j.type] = (byType[j.type] ?? 0) + j.count;
      total += j.count;
      // A mated pair of different hardware (a knob screw and its insert) is two items; a tenon and its mortise is one joint.
      if (mate && mate.type !== j.type) {
        byType[mate.type] = (byType[mate.type] ?? 0) + mate.count;
        total += mate.count;
      }
    }
  }
  return { total, byType };
}


/**
 * Fill in `at` (local-frame fastener positions) for every structured joint that does not have one (parts built outside
 * the hull/frame joinery: clamps, front axle, seat and storage hardware, brake and handle bolts, lights).
 *
 * The positions are derived, not hand-placed: the contact region of the two mated parts is the overlap of their world
 * bounding boxes (or, for parts a hair apart, this part's own face toward the mate). `count` points are spread over that region:
 * along its longest axis, or on a grid over its two longest axes for four or more fasteners in a region at least
 * `GRID_MIN_IN` wide. A joint listed on both parts gets the same world points on each (the region is symmetric), each
 * in its own part's local frame. Payload parts are skipped (not part of the sled).
 */
const GRID_MIN_IN = 1;
export function locateJoints(parts: Part[]): void {
  const byId = new Map(parts.map((x) => [x.id, x]));
  const boxes = new Map<string, { min: Vec3; max: Vec3 }>();
  const bb = (x: Part) => { let b = boxes.get(x.id); if (!b) { b = worldAABB(x); boxes.set(x.id, b); } return b; };
  for (const part of parts) {
    if (part.payload) continue;
    for (const j of part.joints ?? []) {
      if (j.at && j.at.length === j.count) continue;
      const a = bb(part);
      const mate = byId.get(j.to);
      const m = mate ? bb(mate) : a;
      const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const l = Math.max(a.min[k], m.min[k]), h = Math.min(a.max[k], m.max[k]);
        // Overlap: the shared slab. Gap: this part's own face toward the mate (the fastener sits on this part, not in the air gap).
        const touching = l <= h + 1e-6; // faces that meet to within rounding count as a contact
        const face = a.min[k] + a.max[k] <= m.min[k] + m.max[k] ? a.max[k] : a.min[k];
        lo[k] = touching ? Math.min(l, h) : face;
        hi[k] = touching ? Math.max(l, h) : face;
      }
      const ext = [0, 1, 2].map((k) => hi[k] - lo[k]);
      const order = [0, 1, 2].sort((p, q) => ext[q] - ext[p]);
      const at = (f: [number, number, number]): Vec3 => [0, 1, 2].map((k) => lo[k] + ext[k] * f[k]) as Vec3;
      const world: Vec3[] = [];
      const n = Math.max(1, j.count);
      if (n === 1) world.push(at([0.5, 0.5, 0.5]));
      else if (n >= 4 && ext[order[1]] >= GRID_MIN_IN) {
        const nx = Math.min(n, Math.max(1, Math.round(Math.sqrt((n * ext[order[0]]) / ext[order[1]]))));
        const ny = Math.ceil(n / nx);
        for (let i = 0; i < n; i++) {
          const f: [number, number, number] = [0.5, 0.5, 0.5];
          f[order[0]] = ((i % nx) + 0.5) / nx;
          f[order[1]] = (Math.floor(i / nx) + 0.5) / ny;
          world.push(at(f));
        }
      } else {
        for (let i = 0; i < n; i++) { const f: [number, number, number] = [0.5, 0.5, 0.5]; f[order[0]] = (i + 0.5) / n; world.push(at(f)); }
      }
      j.at = world.map((w) => toLocal(part.transform, w));
    }
  }
}
