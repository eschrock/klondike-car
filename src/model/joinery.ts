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
import type { Params } from '../params';
import { SIDES, type Ctx } from './build-utils';
import { sideTopAt, webTopAt } from './layout';
import { scupperSites } from './body';
import { worldAABB } from './bounds';
import type { Joint, JointType, Mat4, Part, Vec3 } from './types';

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
/** The tenon should be about a third of the stock; never more than this fraction. */
const DOMINO_MAX_T_FRAC = 0.42;
/** CNC stub tenon: thickness is a third of the stock, width capped here. */
const STUB_MAX_WIDTH_IN = 1;
const MIN_BAND_IN = 0.4;
/** Oak left each side of a Domino cut in a face (the same ≥ 0.1" rule as the groove walls). */
const TIE_WALL_MIN_IN = 0.1;

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
 * Largest Domino (by tenon area) that (a) is no thicker than ~0.42× the stock, (b) has mortise depth L/2 that keeps a sound wall in the host
 * (and in the tenon-carrying piece if `stockAlongIn` is given), and (c) whose FACE WIDTH (wMm, not L) fits the joint face with an edge margin; null if none.
 * Example: 6×40 in ¾" × 1½" stiles: T 6 mm ≤ 0.75·0.42 in; depth 20 mm = 0.79" into a 1.5" member; face width 20 mm = 0.79" along a 1.5" rail end, 0.36" margins.
 */
export function chooseDomino(p: Params, q: DominoQuery): DominoSize | null {
  let best: DominoSize | null = null;
  for (const d of DOMINOS) {
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

/** Joint for the end of a `stockIn`-thick piece into a `hostIn`-thick host over `bandIn` of face: Domino if it fits, else a loose tenon (both parts mortised: CNC or router; shop-made tenon stock). Not an integral CNC tenon (build review S2). */
export function endJoint(p: Params, stockIn: number, hostIn: number, bandIn: number): EndJoint {
  const d = chooseDomino(p, { stockIn, hostIn, widthIn: bandIn });
  if (d) return { type: 'domino', size: `${d.name} (${d.tool})`, widthIn: d.wMm / MM };
  const w = Math.max(0.25, Math.min(STUB_MAX_WIDTH_IN, bandIn - 0.2));
  const t = Math.max(0.125, Math.round((stockIn / 3) * 16) / 16);
  return { type: 'mortise-tenon', size: `${frac(t)} × ${frac(w)} × ${frac(p.tenonDepthIn)} deep loose tenon (both parts mortised; rounded-edge tenon stock)`, widthIn: w };
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
  noteA?: string;
  noteB?: string;
  /** Record the joint on `a` only (a hole in a host for a cable that is drawn only where it is exposed; the mating part has no matching feature). */
  hostOnly?: boolean;
}

/** Add the structured joints for the hull and frame to `parts` (mutates them). Call once on a freshly built model. */
export function applyJoinery(ctx: Ctx, parts: Part[]): void {
  const { p, L } = ctx;
  const byId = new Map(parts.map((x) => [x.id, x]));
  const has = (id: string) => byId.has(id);
  const pairs: Pair[] = [];
  const add = (q: Pair) => { if (has(q.a) && has(q.b) && q.pts.length) pairs.push(q); };

  const dd = p.deckCaptureDepthIn;
  const g = p.grooveDepthIn;
  const pl = p.panelPlyIn;
  const groove = `${(pl + p.grooveSlopIn).toFixed(3)}" × ${frac(g)}" groove, full length`;
  const rearTx = L.xRear + L.transom;
  const jD = p.crossmemberDepthIn;
  const railT = p.railThicknessIn;

  const ds = p.deckSlopIn;
  const rabbetH = (top: number, bot: number) => top - bot + ds;
  const deck = 'deck'; // one deck level (D-52): a single deck part
  const bot = L.deckBot;
  const cBot = L.chineBot;
  const z0 = L.web.z0;
  const xm = (rearTx + L.xSideEnd) / 2;
  const xj = rearTx + 1;
  const topAt = (x: number) => sideTopAt(L, x);
  const webTop = (x: number) => webTopAt(L, x);
  const hw = L.hwC;

  // ── Sides: panel grooves, deck rabbets, end joints to the rear transom and the bow curl ──
  for (const { s, tag } of SIDES) {
    const id = `side-${tag}`;
    const yc = s * (hw + L.side / 2);
    const rabbetSize = `${frac(dd)}" × ${rabbetH(L.deckTop, bot).toFixed(3)}" rabbet (inside bottom edge; deck + ${frac(ds)}" clearance, thickened epoxy fills it)`;
    add({ a: `${id}-chine`, b: `${id}-web`, typeA: 'dado', size: groove, pts: [[xm, yc, z0 - g / 2]], noteA: 'Groove in the top of the chine (a straight cut: router table, fence).', noteB: 'Lower edge of the web, captured.' });
    add({ a: `${id}-gunwale`, b: `${id}-web`, typeA: 'dado', size: groove, pts: [[xm, yc, webTop(xm) + g / 2]], noteA: 'Groove in the underside of the gunwale, plowed along the sloped edge before the board is sawn to the sled line.', noteB: 'Upper edge of the web, captured.' });
    add({ a: `${id}-chine`, b: deck, typeA: 'rabbet', size: rabbetSize, pts: [[xj, s * (hw + dd / 2), L.deckBot + L.ply / 2]], noteB: 'Edge of the deck, captured.' });
    // Web end into a stopped dado in the transom.
    add({ a: 'transom-rear', b: `${id}-web`, typeA: 'dado', size: `${(pl + p.grooveSlopIn).toFixed(3)}" × ${frac(dd)}" stopped dado, ${frac(p.ventHoleIn)}" vent hole through the transom at its closed end`, pts: [[rearTx - dd / 2, yc, (z0 + webTop(rearTx)) / 2]], noteA: 'Vented: the transom slides on last, so air and epoxy must escape (hydraulic lock, M4).', noteB: 'End of the web, captured (rear); it enters the dado with the transom\'s slide in X.' });
    // Chine and gunwale ends into the transom face, clear of the deck dado and the web dado.
    const deckTopZ = Math.max(cBot, L.deckTop + ds);
    const chineBand = z0 - g - deckTopZ - 0.2;
    if (chineBand >= MIN_BAND_IN) {
      const ej = endJoint(p, L.side, L.transom, chineBand);
      add({ a: `${id}-chine`, b: 'transom-rear', typeA: ej.type, size: ej.size, pts: [[rearTx, yc, deckTopZ + 0.1 + chineBand / 2]], noteA: 'End of the chine into the transom face; epoxy fillet inside.' });
    } else add({ a: `${id}-chine`, b: 'transom-rear', typeA: 'glue', size: 'epoxy + fillet', pts: [[rearTx, yc, cBot + L.chineH / 2]] });
    const gunBand = topAt(rearTx) - 0.1 - (webTop(rearTx) + g + 0.1);
    if (gunBand >= MIN_BAND_IN) {
      const ej = endJoint(p, L.side, L.transom, gunBand);
      add({ a: `${id}-gunwale`, b: 'transom-rear', typeA: ej.type, size: ej.size, pts: [[rearTx, yc, webTop(rearTx) + g + 0.1 + gunBand / 2]], noteA: 'End of the gunwale into the transom face; epoxy fillet inside.' });
    } else add({ a: `${id}-gunwale`, b: 'transom-rear', typeA: 'glue', size: 'epoxy + fillet', pts: [[rearTx, yc, topAt(rearTx) - L.railBand / 2]] });
    // The forward ends butt the bow curl, whose edge is bonded to the inside faces of the chine, web and gunwale.
    for (const m of ['chine', 'web', 'gunwale'] as const) {
      const zc = m === 'chine' ? cBot + L.chineH / 2 : m === 'web' ? (z0 + webTop(L.xSideEnd)) / 2 : topAt(L.xSideEnd) - L.railBand / 2;
      add({ a: `${id}-${m}`, b: 'bow-curl', typeA: 'glue', size: 'thickened epoxy, the curl\'s edge against the inside face', pts: [[L.xSideEnd, s * hw, zc]], noteA: 'The bow curl\'s side edge is bonded along the member\'s inside face where the two meet (the curl rises across the end of the side).' });
    }
  }

  // ── Deck: rear transom dado, scarfed to the bow curl, glued to the frame ──
  add({ a: 'transom-rear', b: deck, typeA: 'dado', size: `${rabbetH(L.deckTop, bot).toFixed(3)}" × ${frac(dd)}" dado across the front face (deck + ${frac(ds)}" clearance), ${frac(p.ventHoleIn)}" vent holes through the transom at both closed ends`, pts: [[rearTx - dd / 2, 0, L.deckBot + L.ply / 2]], noteB: 'Rear edge of the deck, captured.' });
  add({ a: deck, b: 'bow-curl', typeA: 'scarf', size: `8:1 scarf, ${(8 * L.ply).toFixed(1)}" long, epoxy`, pts: [[L.xFlatEnd, 0, L.deckBot + L.ply / 2]], noteA: 'Deck to the bow curl: the scarf lies in the flat part, over the last joist.' });
  for (const { s, tag } of SIDES) {
    add({ a: `rail-${tag}`, b: deck, typeA: 'glue', size: 'thickened epoxy, full face (the rail top is flush with the deck underside)', pts: [[(rearTx + L.railEnd) / 2, s * (hw + L.side - railT / 2), L.railTop]], noteA: 'Deck bonded to the rail top (and the joist tops); weights or vacuum bag.' });
    // Side-to-frame tie (build review M6, D-43): the chine bears on the rail, epoxy bed + VERTICAL Dominos every chineTieSpacingIn (the hull is built inverted, MUST-2).
    const x0 = rearTx, x1 = L.railEnd;
    if (x1 - x0 >= (2 * p.chineTieSpacingIn) / 3) {
      const n = Math.max(2, Math.floor((x1 - x0) / p.chineTieSpacingIn));
      const flat = L.side - dd;
      const dom = DOMINOS.filter((d) => d.tool === 'DF 500' && d.tMm / MM + 2 * TIE_WALL_MIN_IN <= flat).sort((a, b) => b.tMm * b.wMm - a.tMm * a.wMm)[0];
      const pts = Array.from({ length: n }, (_, i) => [x0 + ((i + 0.5) * (x1 - x0)) / n, s * (hw + dd + flat / 2), cBot] as Vec3);
      add({
        a: `side-${tag}-chine`, b: `rail-${tag}`, typeA: dom ? 'domino' : 'glue',
        size: dom ? `${dom.name} (${dom.tool}) every ${p.chineTieSpacingIn}" + epoxy bed on the ${frac(flat)}" bearing face` : 'epoxy bed on the bearing face',
        pts, noteA: 'SIDE-TO-FRAME TIE (D-43): the chine sits on the rail top; the Dominos are VERTICAL and engage as the frame + deck unit is lowered into the inverted side assembly (a protruding Domino cannot be fitted any other way); epoxy bed, then screws up through the rail every other Domino.',
      });
    }
  }

  // ── Axle hangers (D-54): glued and bolted to the inside of each rail, both ends of the joint recorded ──
  for (const { s, tag } of SIDES) for (const [pre, bx] of [['axle-hanger', L.beamR.x]] as const) {
    const hy = s * (hw + L.side - railT / 2 - p.axleHangerThickIn / 2);
    add({ a: `${pre}-${tag}`, b: `rail-${tag}`, typeA: 'glue', size: `${(p.axleHangerWidthIn).toFixed(2)}" × ${p.railDepthIn.toFixed(2)}" side-grain face, epoxy`, pts: [[bx, hy, L.railTop - p.railDepthIn / 2]], noteA: 'Long-grain hanger to the rail inner face: the bolts carry the vertical load, the glue keeps the faces together.' });
    add({ a: `${pre}-${tag}`, b: `rail-${tag}`, typeA: 'bolt', size: `${p.beamHoldDownBoltDiameterIn}" 316 bolts through the hanger and the rail, nylock nuts and fender washers on the outside face`, pts: [[bx - 0.6, hy, L.railTop - 0.8], [bx + 0.6, hy, L.railTop - 0.8]], noteA: 'Above the beam notch, one each side of the hold-down angle.' });
  }

  // ── Frame: rails to the rear transom, crossmembers to the rails, joists to the deck ──
  for (const { s, tag } of SIDES) {
    const bandZ = L.deckBot - (L.deckTop - jD);
    if (bandZ >= MIN_BAND_IN + 0.2) {
      const ej = endJoint(p, railT, L.transom, bandZ - 0.2);
      add({ a: `rail-${tag}`, b: 'transom-rear', typeA: ej.type, size: ej.size, pts: [[rearTx, s * (hw + L.side - railT / 2), (L.deckTop - jD + L.deckBot) / 2]], noteA: 'Rail end into the transom face (the transom hangs jD below the deck).' });
    } else add({ a: `rail-${tag}`, b: 'transom-rear', typeA: 'glue', size: 'epoxy + fillet', pts: [[rearTx, s * (hw + L.side / 2), L.deckBot - 0.5]] });
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
      const ej = endJoint(p, e.thick, hangerHere ? p.axleHangerThickIn : railT, jD);
      add({ a: e.j.id, b: hostId, typeA: ej.type, size: ej.size, pts: [[e.x, s * (s > 0 ? e.yMax : -e.yMin), e.zc]], noteA: 'End of the crossmember into the member face; epoxy.' });
    }
    add({ a: e.j.id, b: 'deck', typeA: 'glue', size: 'thickened epoxy, full length', pts: [[e.x, 0, e.zc + jD / 2]], noteA: 'Deck bonded to the crossmember top.' });
  });
  // ── Front pivot (D-56): the king beam holds the kingpin and the thrust washer; the stop blocks hang under the end joist (they end at the contact point of the swinging beam, inboard of the rails) ──
  {
    const kb = byId.get('king-beam');
    if (kb) {
      add({ a: 'king-beam', b: 'king-thrust', typeA: 'screw', size: 'two #6 screws (or contact cement) holding the UHMW washer to the king beam', pts: [[L.king.x, 0, L.king.bot]], noteA: 'Keeps the washer with the king beam; the tongue plate slides under it.' });
      add({ a: 'king-beam', b: 'kingpin', typeA: 'hole', typeB: 'pin', size: `${frac(p.kingpinDiaIn)}" bore (snug bushing fit) through the king beam, nylock nut and washer captured in a slot cut from the front face`, sizeB: `${frac(p.kingpinDiaIn)}" bolt turns in the bore; the nut only stops the axle dropping away (rebound)`, pts: [[L.king.x, 0, (L.king.bot + L.king.top) / 2]], noteA: 'Bored square to the face on the drill press; the nut slot is cut from the front before the deck goes on.' });
    }
    const endJ = joistId(L, L.joistX.length - 1);
    for (const { s, tag } of SIDES) {
      const sb = `steer-stop-${tag}`;
      const st = L.stops;
      const yc = s * (st.y1 + st.y2) / 2;
      add({ a: sb, b: endJ, typeA: 'glue', size: 'epoxy on the joist underside, full face', pts: [[L.joistX[L.joistX.length - 1], yc, st.top]], noteA: 'Stop block bonded to the end joist.' });
      add({ a: sb, b: endJ, typeA: 'bolt', size: `${frac(p.steerStopBoltDiaIn)}" 316 bolts down through the joist and the block, nylock nuts and fender washers at the bottom of the block (counterbored)`, pts: [-1, 1].map((k): Vec3 => [L.joistX[L.joistX.length - 1], yc + k * Math.max(0.3, (st.y2 - st.y1) / 4), (st.top + st.bot) / 2]), noteA: 'Carry the stop load in shear across the glue line.' });
    }
  }
  void deck;

  // ── Rear transom backers (S13): epoxy to the transom, the socket and bracket bolts pass through both ──
  for (const { s, tag } of SIDES) {
    const bk = byId.get(`transom-backer-${tag}`);
    if (!bk) continue;
    const bb = worldAABB(bk);
    add({ a: bk.id, b: 'transom-rear', typeA: 'glue', size: 'epoxy, full face; the socket / bracket carriage bolts pass through both', pts: [[bb.min[0], (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2]], noteA: 'Glue on the bench before the transom goes on.' });
    void s;
  }

  // ── Scuppers through the chines (M7) ──
  for (const site of scupperSites(ctx)) {
    for (const { s, tag } of SIDES) {
      const sc = byId.get(`scupper-${site.tagPos}-${tag}`);
      if (!sc) continue;
      add({ a: sc.id, b: `side-${tag}-chine`, typeA: 'glue', size: `${frac(p.scupperDiaIn)}" 316 nipple bedded in epoxy; hole epoxy-lined`, pts: [[site.x, s * (site.hw + L.side / 2), sc.transform[14]]], noteA: 'Drains the deck at deck level; no cut oak edge is left bare.' });
    }
  }

  // ── Signs (provisional): four thumb-knob screws into tee-nuts in the side panel (nothing protrudes inside the hull) ──
  for (const { tag } of SIDES) {
    const sign = byId.get(`sign-${tag}`);
    if (!sign || sign.geometry.type !== 'box') continue;
    const [sx, , sz] = sign.geometry.size;
    const dx = Math.max(0.5, sx / 2 - 2);
    const dz = Math.max(0.3, Math.min(1.5, sz / 2 - 0.6));
    const pts = ([[-dx, -dz], [dx, -dz], [-dx, dz], [dx, dz]] as const).map(([x, z]) => toModel(sign.transform, [x, 0, z]));
    add({
      a: sign.id, b: `side-${tag}-web`, typeA: 'knob', typeB: 'threaded-insert',
      size: '#10-32 × 1 thumb-knob screw through a 3/16 clearance hole', sizeB: '#10-32 short-barrel stainless tee-nut, epoxied in the 6 mm web, prongs on the inside face',
      pts, noteA: 'Sign comes off for transport (D-9). Provisional placement (D-54).',
    });
  }

  // ── Write both sides of every pair ──
  const push = (id: string, j: Joint) => {
    const part = byId.get(id)!;
    (part.joints ??= []).push(j);
  };
  for (const q of pairs) {
    const A = byId.get(q.a)!, B = byId.get(q.b)!;
    push(q.a, { type: q.typeA, to: q.b, count: q.pts.length, size: q.size, at: q.pts.map((pt) => toLocal(A.transform, pt)), ...(q.noteA ? { note: q.noteA } : {}) });
    if (q.hostOnly) continue;
    push(q.b, { type: q.typeB ?? q.typeA, to: q.a, count: q.pts.length, size: q.sizeB ?? q.size, at: q.pts.map((pt) => toLocal(B.transform, pt)), ...(q.noteB ?? q.noteA ? { note: q.noteB ?? q.noteA } : {}) });
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
 * in its own part's local frame. Payload parts are skipped (BRIEF: not part of the cart).
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
