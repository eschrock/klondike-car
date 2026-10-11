/**
 * Joinery (Phase 3, D-35): turns the finished hull and frame parts into structured `joints`.
 *
 * Every physical joint is recorded on BOTH parts it joins (so a part's own list shows every cut it needs), each with
 * `at` in that part's own local frame. `joinerySummary` counts a physical joint once. The rules are choices made by
 * stock thickness: a Festool Domino where the host keeps a sound wall behind the mortise, a loose tenon where
 * it does not (thin members: a loose tenon), grooves and rabbets that capture the ply, glue + epoxy fillets,
 * and threaded inserts + knobs for everything that comes off (D-9).
 */
import { FRAME_STYLE, SIDE_CONSTRUCTION, type Params } from '../params';
import { SIDES, type Ctx } from './build-utils';
import { innerHalfWidth, sheerRise } from './layout';
import { fingerAnalysis, guardInsertZ, scupperSites } from './body';
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
function toLocal(m: Mat4, pt: Vec3): Vec3 {
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
  const captured = p.sideConstruction === SIDE_CONSTRUCTION.capturedPly;
  const solid = p.sideConstruction === SIDE_CONSTRUCTION.solidOak;
  const openFrame = p.sideConstruction === SIDE_CONSTRUCTION.openFrame;
  const ladder = p.frameStyle === FRAME_STYLE.ladder;
  const rearTx = L.xRear + L.transom;
  const frontTx = L.xFront - L.transom;
  const jD = p.crossmemberDepthIn;

  const ds = p.deckSlopIn;
  const rabbetH = (top: number, bot: number) => top - bot + ds;
  const runs = [
    { zone: 'cabin', x0: rearTx, x1: L.xn, hw: L.hwC, deckTop: L.deckTop, tx: 'transom-rear', txFace: rearTx, deck: 'deck-cabin' },
    { zone: 'nose', x0: L.xn, x1: frontTx, hw: L.hwN, deckTop: L.noseTop, tx: 'transom-front', txFace: frontTx, deck: 'deck-nose' },
  ] as const;
  const bot = L.deckBot; // cabin deck underside
  const cBot = L.chineBot; // chine bottom (captured ply: the nose deck level along the whole hull)
  const zTop = L.sideTop;
  const z0 = L.web.z0;
  const z1 = L.web.z1;

  // ── Sides: panel grooves, deck rabbets, end joints to the transoms; the scarfs between the curved cabin run and the straight nose run at xn ──
  for (const run of runs) {
    const rear = run.zone === 'cabin';
    for (const { s, tag } of SIDES) {
      const id = `side-${run.zone}-${tag}`;
      const yc = s * (run.hw + L.side / 2);
      const xm = rear ? (L.xc0 + L.xn) / 2 : (run.x0 + run.x1) / 2; // mid curve for the cabin run's mid-length joints (the web grooves run the whole length)
      const yAt = (x: number) => s * (innerHalfWidth(L, x) + L.side / 2);
      const riseAt = (x: number) => (rear ? 0 : sheerRise(L, x)); // the nose gunwale and web top follow the sheer (D-44)
      const rabbetSize = `${frac(dd)}" × ${rabbetH(run.deckTop, bot).toFixed(3)}" rabbet (inside bottom edge; deck + ${frac(ds)}" clearance, thickened epoxy fills it)`;
      const xj = rear ? L.xc0 + 1 : run.x0 + 1;
      if (captured) {
        add({ a: `${id}-chine`, b: `${id}-web`, typeA: 'dado', size: groove, pts: [[xm, yAt(xm), z0 - g / 2]], noteA: 'Groove in the top of the chine, routed with a template after the lamination.', noteB: 'Lower edge of the web, captured.' });
        add({ a: `${id}-gunwale`, b: `${id}-web`, typeA: 'dado', size: groove, pts: [[xm, yAt(xm), z1 + g / 2 + riseAt(xm)]], noteA: 'Groove in the underside of the gunwale.', noteB: 'Upper edge of the web, captured.' });
        if (rear) {
          // Cabin deck: a ledge notched into the rail's inner face (open at the top); the nose deck's rabbet in the chine starts at the deck step.
          const ledgeHost = ladder ? `rail-cabin-${tag}` : `girder-cabin-${tag}`;
          add({ a: ledgeHost, b: 'deck-cabin', typeA: 'rabbet', size: `${frac(dd)}" × ${frac(L.railTop - L.deckBot)}" ledge in the inner face, open at the top (deck sits on it; ${frac(ds)}" clearance, thickened epoxy)`, pts: [[xj, s * (innerHalfWidth(L, xj) - (ladder ? p.railThicknessIn - L.side : 0) + dd / 2), bot + L.ply / 2]], noteB: 'Edge of the deck, against the oak wall of the ledge.' });
          const xr = (L.xs + L.xn) / 2;
          add({ a: `${id}-chine`, b: 'deck-nose', typeA: 'rabbet', size: `${frac(dd)}" × ${rabbetH(L.noseTop, L.noseBot).toFixed(3)}" rabbet in the chine underside from the deck step forward`, pts: [[xr, s * (innerHalfWidth(L, xr) + dd / 2), L.noseBot + L.ply / 2]], noteB: 'Edge of the nose deck, captured.' });
        } else add({ a: `${id}-chine`, b: run.deck, typeA: 'rabbet', size: rabbetSize, pts: [[xj, s * (innerHalfWidth(L, xj) + dd / 2), L.noseBot + L.ply / 2]], noteB: 'Edge of the deck, captured.' });
        // Web end into a stopped dado in the transom.
        add({ a: run.tx, b: `${id}-web`, typeA: 'dado', size: `${(pl + p.grooveSlopIn).toFixed(3)}" × ${frac(dd)}" stopped dado, ${frac(p.ventHoleIn)}" vent hole through the transom at its closed end`, pts: [[rear ? run.txFace - dd / 2 : run.txFace + dd / 2, yc, (z0 + z1 + riseAt(run.txFace)) / 2]], noteA: 'Vented: the transom slides on last, so air and epoxy must escape (hydraulic lock, M4).', noteB: `End of the web, captured (${rear ? 'rear' : 'front'}); it enters the dado with the transom's slide in X.` });
        // Chine and gunwale ends into the transom face, clear of the deck dado and the web dado.
        const deckTopZ = Math.max(cBot, run.deckTop + ds);
        const chineBand = z0 - g - deckTopZ - 0.2;
        if (chineBand >= MIN_BAND_IN) {
          const ej = endJoint(p, L.side, L.transom, chineBand);
          add({ a: `${id}-chine`, b: run.tx, typeA: ej.type, size: ej.size, pts: [[run.txFace, yc, deckTopZ + 0.1 + chineBand / 2]], noteA: 'End of the chine into the transom face; epoxy fillet inside.' });
        } else add({ a: `${id}-chine`, b: run.tx, typeA: 'glue', size: 'epoxy + fillet', pts: [[run.txFace, yc, cBot + L.chineH / 2]] });
        const gunBand = zTop - 0.1 - (z1 + g + 0.1);
        if (gunBand >= MIN_BAND_IN) {
          const ej = endJoint(p, L.side, L.transom, gunBand);
          add({ a: `${id}-gunwale`, b: run.tx, typeA: ej.type, size: ej.size, pts: [[run.txFace, yc, z1 + g + 0.1 + gunBand / 2 + riseAt(run.txFace)]], noteA: 'End of the gunwale into the transom face; epoxy fillet inside.' });
        } else add({ a: `${id}-gunwale`, b: run.tx, typeA: 'glue', size: 'epoxy + fillet', pts: [[run.txFace, yc, zTop - L.railBand / 2]] });
      } else if (solid) {
        add({ a: `${id}-board`, b: run.deck, typeA: 'rabbet', size: rabbetSize, pts: [[xj, s * (innerHalfWidth(L, xj) + dd / 2), bot + L.ply / 2]], noteB: 'Edge of the deck, captured.' });
        const ej = endJoint(p, L.side, L.transom, Math.min(2, zTop - bot - 0.4));
        add({ a: `${id}-board`, b: run.tx, typeA: ej.type, size: ej.size, pts: [[run.txFace, yc, (bot + zTop) / 2 - 1], [run.txFace, yc, (bot + zTop) / 2 + 1]], noteA: 'Board end into the transom face.' });
      } else if (openFrame) {
        const ej = endJoint(p, L.side, L.transom, L.railBand);
        add({ a: `${id}-gunwale`, b: run.tx, typeA: ej.type, size: ej.size, pts: [[run.txFace, yc, zTop - L.railBand / 2]], noteA: 'Gunwale end into the transom face.' });
        for (const part of parts) {
          if (!part.id.startsWith(`${id}-post-`)) continue;
          const c: Vec3 = [part.transform[12], part.transform[13], zTop - L.railBand];
          const pj = endJoint(p, L.side, L.side, 1.5);
          add({ a: part.id, b: `${id}-gunwale`, typeA: pj.type, size: pj.size, pts: [c], noteA: 'Post top into the gunwale underside.' });
        }
      }
    }
  }
  // Scarfs between the curved cabin run and the straight nose run, at the tangent point x = xn (the scarf lies in the straight nose run, never in the bend).
  for (const { s, tag } of SIDES) {
    const yN = s * (L.hwN + L.side / 2);
    const scarf = (a: string, bId: string, t: number, zc: number, what: string) =>
      add({ a, b: bId, typeA: 'scarf', size: `1:8 scarf, ${(8 * t).toFixed(1)}" long, epoxy`, pts: [[L.xn, yN, zc]], noteA: `${what}: scarf at the end of the S-curve, in the straight run (continuous member through the transition, build review MUST-1).` });
    if (captured) {
      scarf(`side-cabin-${tag}-chine`, `side-nose-${tag}-chine`, L.side, cBot + L.chineH / 2, 'Chine');
      scarf(`side-cabin-${tag}-gunwale`, `side-nose-${tag}-gunwale`, L.side, zTop - L.railBand / 2, 'Gunwale');
      scarf(`side-cabin-${tag}-web`, `side-nose-${tag}-web`, pl, (z0 + z1) / 2, 'Side panel');
    } else if (solid) scarf(`side-cabin-${tag}-board`, `side-nose-${tag}-board`, L.side, (bot + zTop) / 2, 'Board');
    else if (openFrame) scarf(`side-cabin-${tag}-gunwale`, `side-nose-${tag}-gunwale`, L.side, zTop - L.railBand / 2, 'Gunwale');
    if (ladder) scarf(`rail-cabin-${tag}`, `rail-nose-${tag}`, p.railThicknessIn, (L.railTop + bot - p.railDepthIn) / 2, 'Rail');
  }

  // ── Decks into the transom dados, glued to the frame ──
  add({ a: 'transom-rear', b: 'deck-cabin', typeA: 'dado', size: `${rabbetH(L.deckTop, bot).toFixed(3)}" × ${frac(dd)}" dado across the front face (deck + ${frac(ds)}" clearance), ${frac(p.ventHoleIn)}" vent holes through the transom at both closed ends`, pts: [[rearTx - dd / 2, 0, L.deckBot + L.ply / 2]], noteB: 'Rear edge of the deck, captured.' });
  add({ a: 'transom-front', b: 'deck-nose', typeA: 'dado', size: `${rabbetH(L.noseTop, L.noseBot).toFixed(3)}" × ${frac(dd)}" dado across the rear face (deck + ${frac(ds)}" clearance), ${frac(p.ventHoleIn)}" vent holes through the transom at both closed ends`, pts: [[frontTx + dd / 2, 0, L.noseBot + L.ply / 2]], noteB: 'Front edge of the deck, captured.' });
  for (const { s, tag } of SIDES) {
    if (ladder) {
      const yRc = s * (innerHalfWidth(L, (L.xRear + L.xc0) / 2) + p.railThicknessIn / 2 + 0 * L.side), yRn = s * (L.hwN + L.side - p.railThicknessIn / 2);
      void yRc;
      add({ a: `rail-cabin-${tag}`, b: 'deck-cabin', typeA: 'glue', size: 'thickened epoxy, full face', pts: [[(rearTx + L.xs) / 2, s * (L.hwC + L.side - p.railThicknessIn / 2), L.deckBot]], noteA: 'Deck bonded to the rail ledge (and the joist tops); weights or vacuum bag.' });
      add({ a: `rail-nose-${tag}`, b: 'deck-nose', typeA: 'glue', size: 'thickened epoxy at the rail line (the nose deck sits 1" higher: joists, beam and the chine rabbet carry it)', pts: [[(L.xn + L.noseRailEnd) / 2, yRn, L.railTop]] });
    }
    // Side-to-frame tie (build review M6, D-43): the chine bears on the rail (ladder, flush under it) or on the girder (hull-beam), epoxy bed + VERTICAL Dominos every chineTieSpacingIn (the hull is built inverted, MUST-2).
    if (captured) {
      for (const zone of ['cabin', 'nose'] as const) {
        const x0 = zone === 'cabin' ? rearTx : L.xn, x1 = zone === 'cabin' ? L.xn : (ladder ? L.noseRailEnd : L.xn);
        const frameId = ladder ? `rail-${zone}-${tag}` : `girder-${zone}-${tag}`;
        if (x1 - x0 < 2 * p.chineTieSpacingIn / 3) continue;
        const n = Math.max(2, Math.floor((x1 - x0) / p.chineTieSpacingIn));
        // Flat bearing face under the chine (beside the nose-deck rabbet in the nose), and the Domino that fits it with ≥ 0.1" of oak each side (the groove-wall rule).
        const flat = zone === 'cabin' ? L.side : L.side - dd;
        const dom = DOMINOS.filter((d) => d.tool === 'DF 500' && d.tMm / MM + 2 * TIE_WALL_MIN_IN <= flat).sort((a, b) => b.tMm * b.wMm - a.tMm * a.wMm)[0];
        const pts = Array.from({ length: n }, (_, i) => {
          const x = x0 + ((i + 0.5) * (x1 - x0)) / n;
          return [x, s * (innerHalfWidth(L, x) + (zone === 'cabin' ? 0 : dd) + flat / 2), cBot] as Vec3;
        });
        add({
          a: `side-${zone}-${tag}-chine`, b: frameId, typeA: dom ? 'domino' : 'glue',
          size: dom ? `${dom.name} (${dom.tool}) every ${p.chineTieSpacingIn}" + epoxy bed on the ${frac(flat)}" bearing face` : 'epoxy bed on the bearing face',
          pts, noteA: 'SIDE-TO-FRAME TIE (D-43, D-45): the chine sits on the rail top; the Dominos are VERTICAL and engage as the frame + deck unit is lowered into the inverted side assembly (a protruding Domino cannot be fitted any other way); epoxy bed, then screws up through the rail every other Domino.',
        });
      }
    }
  }

  // ── Frame: rails and girders to the rear transom, crossmembers to the rails or girders, joists to the deck ──
  const railT = ladder ? p.railThicknessIn : L.side;
  for (const { s, tag } of SIDES) {
    const mem = ladder ? `rail-cabin-${tag}` : `girder-cabin-${tag}`;
    const bandZ = L.deckBot - (L.deckTop - jD);
    if (bandZ >= MIN_BAND_IN + 0.2) {
      const ej = endJoint(p, railT, L.transom, bandZ - 0.2);
      add({ a: mem, b: 'transom-rear', typeA: ej.type, size: ej.size, pts: [[rearTx, s * (ladder ? L.hwC + L.side - railT / 2 : L.hwC + L.side / 2), (L.deckTop - jD + L.deckBot) / 2]], noteA: 'Member end into the transom face (the transom hangs jD below the deck).' });
    } else add({ a: mem, b: 'transom-rear', typeA: 'glue', size: 'epoxy + fillet', pts: [[rearTx, s * (L.hwC + L.side / 2), L.deckBot - 0.5]] });
  }
  const spanEnds = (zone: 'cabin' | 'nose', i: number) => {
    const j = byId.get(`joist-${zone}-${i + 1}`);
    if (!j) return null;
    const bb = worldAABB(j);
    return { j, x: (bb.min[0] + bb.max[0]) / 2, yMax: bb.max[1], zc: (bb.min[2] + bb.max[2]) / 2, thick: bb.max[0] - bb.min[0] };
  };
  const jointJoists = (zone: 'cabin' | 'nose', xs: number[]) => {
    xs.forEach((_x, i) => {
      const e = spanEnds(zone, i);
      if (!e) return;
      for (const { s, tag } of SIDES) {
        const hostId = zone === 'cabin' ? (ladder ? `rail-cabin-${tag}` : `girder-cabin-${tag}`) : ladder ? `rail-nose-${tag}` : '';
        if (!hostId) continue;
        const hostT = zone === 'cabin' ? railT : p.railThicknessIn;
        const ej = endJoint(p, e.thick, hostT, jD);
        add({ a: e.j.id, b: hostId, typeA: ej.type, size: ej.size, pts: [[e.x, s * e.yMax, e.zc]], noteA: 'End of the crossmember into the member face; epoxy.' });
      }
      add({ a: e.j.id, b: zone === 'cabin' ? 'deck-cabin' : 'deck-nose', typeA: 'glue', size: 'thickened epoxy, full length', pts: [[e.x, 0, e.zc + jD / 2]], noteA: 'Deck bonded to the crossmember top.' });
    });
  };
  jointJoists('cabin', L.cabinJoistX);
  jointJoists('nose', L.noseJoistX);

  // ── Shoulder beam (build review MUST-1, D-45): the cabin-to-nose tie. Dominoed into the cabin rails (or girders) each side, glued to both decks (riser + seat). ──
  if (has('shoulder-beam')) {
    const sb = byId.get('shoulder-beam')!;
    const bb = worldAABB(sb);
    const yEnd = bb.max[1];
    for (const { s, tag } of SIDES) {
      const hostId = ladder ? `rail-cabin-${tag}` : `girder-cabin-${tag}`;
      const hostT = ladder ? p.railThicknessIn : L.side;
      const ej = endJoint(p, L.shoulderBeam, hostT, jD);
      add({ a: 'shoulder-beam', b: hostId, typeA: ej.type, size: `${ej.size} × 2 per end`, pts: [[(bb.min[0] + bb.max[0]) / 2 - 0.0, s * yEnd, (bb.min[2] + bb.max[2]) / 2 + 0.6], [(bb.min[0] + bb.max[0]) / 2, s * yEnd, (bb.min[2] + bb.max[2]) / 2 - 0.6]], noteA: 'End of the shoulder beam into the rail inner face, vertical engagement with the rest of the frame unit; epoxy. This is the cabin-to-nose tie (MUST-1).' });
      if (ladder) add({ a: 'shoulder-beam', b: `rail-nose-${tag}`, typeA: 'glue', size: 'thickened epoxy on the beam end and the scarf face', pts: [[L.xn, s * yEnd, (bb.min[2] + bb.max[2]) / 2 - 1]], noteA: 'Beam end meets the nose rail scarf (x = xn).' });
    }
    add({ a: 'shoulder-beam', b: 'deck-cabin', typeA: 'glue', size: 'epoxy; the deck front edge (banded) butts the beam rear face', pts: [[L.xs, 0, L.deckBot + L.ply / 2]], noteA: 'The visible riser: oak face from the cabin deck to the nose deck.' });
    add({ a: 'shoulder-beam', b: 'deck-nose', typeA: 'glue', size: 'thickened epoxy, full top face', pts: [[(L.xs + L.xn) / 2, 0, L.noseBot]], noteA: 'Nose deck bonded to the beam top.' });
  }

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
      const host = captured && site.zone === 'cabin' ? (ladder ? `rail-cabin-${tag}` : `girder-cabin-${tag}`) : captured || openFrame ? `side-${site.zone}-${tag}-chine` : `side-${site.zone}-${tag}-board`;
      add({ a: sc.id, b: host, typeA: 'glue', size: `${frac(p.scupperDiaIn)}" 316 nipple bedded in epoxy; hole epoxy-lined`, pts: [[site.x, s * (site.hw + L.side / 2), sc.transform[14]]], noteA: 'Drains the deck at deck level; no cut oak edge is left bare.' });
    }
  }

  // ── Signs: four thumb-knob screws into tee-nuts in the side panel (nothing protrudes inside the hull) ──
  for (const { tag } of SIDES) {
    const sign = byId.get(`sign-${tag}`);
    if (!sign || sign.geometry.type !== 'box') continue;
    const [sx, , sz] = sign.geometry.size;
    const dx = Math.max(0.5, sx / 2 - 2);
    if (captured || solid) {
      const dz = Math.max(0.3, Math.min(1.5, (L.web.z1 - L.web.z0) / 2 - 0.6, sz / 2 - 0.6));
      const pts = ([[-dx, -dz], [dx, -dz], [-dx, dz], [dx, dz]] as const).map(([x, z]) => toModel(sign.transform, [x, 0, z]));
      add({
        a: sign.id, b: captured ? `side-cabin-${tag}-web` : `side-cabin-${tag}-board`, typeA: 'knob', typeB: 'threaded-insert',
        size: '#10-32 × 1 thumb-knob screw through a 3/16 clearance hole', sizeB: captured ? '#10-32 short-barrel stainless tee-nut, epoxied in the 6 mm web, prongs on the inside face' : '#10-32 × 3/8 stainless insert',
        pts, noteA: 'Sign comes off for transport (D-9).',
      });
    } else {
      const dz = Math.max(0.3, sz / 2 - 0.45);
      const pts = [-dx, dx].map((x) => toModel(sign.transform, [x, 0, dz]));
      add({ a: sign.id, b: `side-cabin-${tag}-gunwale`, typeA: 'knob', typeB: 'threaded-insert', size: '#10-32 thumb-knob screw', sizeB: '#10-32 × 3/8 stainless insert in the gunwale face', pts });
    }
  }

  // ── Finger guards: strap on two inserts in the nose gunwale ──
  {
    const fa = fingerAnalysis(ctx);
    for (const { s, tag } of SIDES) {
      const guard = byId.get(`guard-${tag}`);
      if (!guard || !fa.hazard) continue;
      const zc = guardInsertZ(L, p); // above the gunwale's web groove (M2, D-43)
      const x0 = fa.hazard.x0, len = fa.hazard.x1 - fa.hazard.x0;
      add({
        a: guard.id, b: captured || openFrame ? `side-nose-${tag}-gunwale` : `side-nose-${tag}-board`, typeA: 'screw', typeB: 'threaded-insert', size: '#10-32 × 5/8 SS button-head screw', sizeB: '#10-32 × 3/8 flanged 316 stainless insert (above the web groove, not into it)',
        pts: [0.25, 0.75].map((f) => [x0 + len * f, s * (L.hwN + L.side), zc] as Vec3), noteA: 'Strap on the gunwale outer face; the leg lies in the web recess. The inserts sit in the solid oak above the groove (build review M2); print with the extrusion profile in the bed plane (layers parallel to the profile), ASA, 4+ perimeters, and add ribs under the hood flange.',
      });
    }
  }

  // ── Write both sides of every pair ──
  const push = (id: string, j: Joint) => {
    const part = byId.get(id)!;
    (part.joints ??= []).push(j);
  };
  for (const q of pairs) {
    const A = byId.get(q.a)!, B = byId.get(q.b)!;
    push(q.a, { type: q.typeA, to: q.b, count: q.pts.length, size: q.size, at: q.pts.map((pt) => toLocal(A.transform, pt)), ...(q.noteA ? { note: q.noteA } : {}) });
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
 * the hull/frame joinery: clamps, turntable, steer stops, seat and storage hardware, brake and handle bolts, lights).
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
