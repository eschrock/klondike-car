/**
 * Joinery (Phase 3, D-35): turns the finished hull and frame parts into structured `joints`.
 *
 * Every physical joint is recorded on BOTH parts it joins (so a part's own list shows every cut it needs), each with
 * `at` in that part's own local frame. `joinerySummary` counts a physical joint once. The rules are choices made by
 * stock thickness: a Festool Domino where the host keeps a sound wall behind the mortise, a CNC blind tenon where
 * it does not (the 1/2" transoms and girders), grooves and rabbets that capture the ply, glue + epoxy fillets,
 * and threaded inserts + knobs for everything that comes off (D-9).
 */
import { FRAME_STYLE, SIDE_CONSTRUCTION, type Params } from '../params';
import { SIDES, type Ctx } from './build-utils';
import { prowShape, fingerAnalysis } from './body';
import { worldAABB } from './bounds';
import type { Joint, JointType, Mat4, Part, Vec3 } from './types';

// ── Festool Domino catalog (nominal mm, thickness × length) ──
export interface DominoSize {
  name: string;
  tool: 'DF 500' | 'DF 700 XL';
  tMm: number;
  lMm: number;
}
export const DOMINOS: readonly DominoSize[] = [
  { name: '4×20', tool: 'DF 500', tMm: 4, lMm: 20 },
  { name: '5×30', tool: 'DF 500', tMm: 5, lMm: 30 },
  { name: '6×40', tool: 'DF 500', tMm: 6, lMm: 40 },
  { name: '8×40', tool: 'DF 500', tMm: 8, lMm: 40 },
  { name: '8×50', tool: 'DF 500', tMm: 8, lMm: 50 },
  { name: '10×50', tool: 'DF 500', tMm: 10, lMm: 50 },
  { name: '8×80', tool: 'DF 700 XL', tMm: 8, lMm: 80 },
  { name: '10×80', tool: 'DF 700 XL', tMm: 10, lMm: 80 },
  { name: '12×100', tool: 'DF 700 XL', tMm: 12, lMm: 100 },
  { name: '14×100', tool: 'DF 700 XL', tMm: 14, lMm: 100 },
];
const MM = 25.4;
/** The tenon should be about a third of the stock; never more than this fraction. */
const DOMINO_MAX_T_FRAC = 0.42;
/** CNC stub tenon: thickness is a third of the stock, width capped here. */
const STUB_MAX_WIDTH_IN = 1;
const MIN_BAND_IN = 0.4;

export interface DominoQuery {
  /** Thickness of the piece that carries the tenon (the Domino sits in its end or edge), in. */
  stockIn: number;
  /** Thickness of the host the other mortise is cut into, along the mortise depth (length / 2), in. */
  hostIn: number;
  /** Room along the long dimension of the Domino (the joint face length), in. */
  widthIn: number;
}

/** Largest Domino (by tenon area) that keeps a sound wall in the host, fits the face with an edge margin, and is not thicker than ~0.42× the stock; null if none. */
export function chooseDomino(p: Params, q: DominoQuery): DominoSize | null {
  let best: DominoSize | null = null;
  for (const d of DOMINOS) {
    const wall = q.hostIn - d.lMm / 2 / MM;
    if (d.tMm / MM > q.stockIn * DOMINO_MAX_T_FRAC) continue;
    if (wall < p.dominoMinWallIn) continue;
    if (d.lMm / MM > q.widthIn - 2 * p.dominoEdgeIn) continue;
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

/** Joint for the end of a `stockIn`-thick piece into a `hostIn`-thick host over `bandIn` of face: Domino if it fits, else a CNC blind tenon. */
export function endJoint(p: Params, stockIn: number, hostIn: number, bandIn: number): EndJoint {
  const d = chooseDomino(p, { stockIn, hostIn, widthIn: bandIn });
  if (d) return { type: 'domino', size: `${d.name} (${d.tool})`, widthIn: d.lMm / MM };
  const w = Math.max(0.25, Math.min(STUB_MAX_WIDTH_IN, bandIn - 0.2));
  const t = Math.max(0.125, Math.round((stockIn / 3) * 16) / 16);
  return { type: 'mortise-tenon', size: `${frac(t)} × ${frac(w)} × ${frac(p.tenonDepthIn)} deep (CNC blind tenon)`, widthIn: w };
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
  const rearTx = L.xRear + L.side;
  const frontTx = L.xFront - L.side;
  const jD = p.crossmemberDepthIn;

  const runs = [
    { zone: 'cabin', x0: rearTx, x1: L.xs, hw: L.hwC, bot: L.deckBot, top: L.deckTop, fl: L.flare, tx: 'transom-rear', txFace: rearTx, deck: 'deck-cabin' },
    { zone: 'nose', x0: L.xs, x1: frontTx, hw: L.hwN, bot: L.noseBot, top: L.noseTop, fl: 0, tx: 'transom-front', txFace: frontTx, deck: 'deck-nose' },
  ] as const;

  // ── Sides: panel grooves, deck rabbets, end joints to the transoms ──
  for (const run of runs) {
    const zTop = run.top + L.sideH;
    const rear = run.zone === 'cabin';
    for (const { s, tag } of SIDES) {
      const id = `side-${run.zone}-${tag}`;
      const yc = s * (run.hw + L.side / 2);
      const xm = (run.x0 + run.x1) / 2;
      const z0 = run.bot + L.railBand;
      const z1 = zTop - L.railBand;
      const rabbetSize = `${frac(dd)}" × ${L.ply.toFixed(3)}" rabbet (inside bottom edge)`;
      if (captured) {
        add({ a: `${id}-chine`, b: `${id}-web`, typeA: 'dado', size: groove, pts: [[xm, yc, z0 - g / 2]], noteA: 'Groove in the top of the chine; follows the flare tilt.', noteB: 'Lower edge of the web, captured.' });
        add({ a: `${id}-gunwale`, b: `${id}-web`, typeA: 'dado', size: groove, pts: [[xm, yc + s * run.fl, z1 + g / 2]], noteA: 'Groove in the underside of the gunwale.', noteB: 'Upper edge of the web, captured.' });
        add({ a: `${id}-chine`, b: run.deck, typeA: 'rabbet', size: rabbetSize, pts: [[xm, s * (run.hw + dd / 2), run.bot + L.ply / 2]], noteB: 'Edge of the deck, captured.' });
        // Web end into a stopped dado in the transom.
        add({ a: run.tx, b: `${id}-web`, typeA: 'dado', size: `${(pl + p.grooveSlopIn).toFixed(3)}" × ${frac(dd)}" stopped dado`, pts: [[rear ? run.txFace - dd / 2 : run.txFace + dd / 2, yc, (z0 + z1) / 2]], noteB: `End of the web, captured (${rear ? 'rear' : 'front'}).` });
        // Chine and gunwale ends into the transom face, clear of the deck dado and the web dado.
        const chineBand = z0 - g - (run.bot + L.ply) - 0.2;
        if (chineBand >= MIN_BAND_IN) {
          const ej = endJoint(p, L.side, L.side, chineBand);
          add({ a: `${id}-chine`, b: run.tx, typeA: ej.type, size: ej.size, pts: [[run.txFace, yc, run.bot + L.ply + 0.1 + chineBand / 2]], noteA: 'End of the chine into the transom face; epoxy fillet inside.' });
        } else add({ a: `${id}-chine`, b: run.tx, typeA: 'glue', size: 'epoxy + fillet', pts: [[run.txFace, yc, run.bot + L.railBand / 2]] });
        const gunBand = zTop - 0.1 - (z1 + g + 0.1);
        if (gunBand >= MIN_BAND_IN) {
          const ej = endJoint(p, L.side, L.side, gunBand);
          add({ a: `${id}-gunwale`, b: run.tx, typeA: ej.type, size: ej.size, pts: [[run.txFace, yc + s * run.fl, z1 + g + 0.1 + gunBand / 2]], noteA: 'End of the gunwale into the transom face; epoxy fillet inside.' });
        } else add({ a: `${id}-gunwale`, b: run.tx, typeA: 'glue', size: 'epoxy + fillet', pts: [[run.txFace, yc + s * run.fl, zTop - L.railBand / 2]] });
      } else if (solid) {
        add({ a: `${id}-board`, b: run.deck, typeA: 'rabbet', size: rabbetSize, pts: [[xm, s * (run.hw + dd / 2), run.bot + L.ply / 2]], noteB: 'Edge of the deck, captured.' });
        const ej = endJoint(p, L.side, L.side, Math.min(2, zTop - run.bot - 0.4));
        add({ a: `${id}-board`, b: run.tx, typeA: ej.type, size: ej.size, pts: [[run.txFace, yc, (run.bot + zTop) / 2 - 1], [run.txFace, yc, (run.bot + zTop) / 2 + 1]], noteA: 'Board end into the transom face.' });
      } else if (openFrame) {
        const ej = endJoint(p, L.side, L.side, L.railBand);
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

  // ── Decks into the transom dados, glued to the frame ──
  add({ a: 'transom-rear', b: 'deck-cabin', typeA: 'dado', size: `${L.ply.toFixed(3)}" × ${frac(dd)}" dado across the front face`, pts: [[rearTx - dd / 2, 0, L.deckBot + L.ply / 2]], noteB: 'Rear edge of the deck, captured.' });
  add({ a: 'transom-front', b: 'deck-nose', typeA: 'dado', size: `${L.ply.toFixed(3)}" × ${frac(dd)}" dado across the rear face`, pts: [[frontTx + dd / 2, 0, L.noseBot + L.ply / 2]], noteB: 'Front edge of the deck, captured.' });
  for (const { s, tag } of SIDES) {
    if (ladder) {
      add({ a: `rail-cabin-${tag}`, b: 'deck-cabin', typeA: 'glue', size: 'thickened epoxy, full face', pts: [[(rearTx + L.xs) / 2, s * (L.hwC - p.railThicknessIn / 2), L.deckBot]], noteA: 'Deck bonded to the rail top; weights or vacuum bag.' });
      add({ a: `rail-nose-${tag}`, b: 'deck-nose', typeA: 'glue', size: 'thickened epoxy, full face', pts: [[(L.xs + L.noseRailEnd) / 2, s * (L.hwN - p.railThicknessIn / 2), L.noseBot]] });
    } else {
      add({ a: `girder-cabin-${tag}`, b: `side-cabin-${tag}-chine`, typeA: 'glue', size: 'epoxy, full face + 1/4" bronze screws at 8"', pts: [[(rearTx + L.xs) / 2, s * (L.hwC + L.side / 2), L.deckBot]], noteA: 'Girder laminated under the chine to deepen the side beam (D-17).' });
    }
  }

  // ── Frame: rails and girders to the rear transom, crossmembers to the rails or girders, joists to the deck ──
  const railT = ladder ? p.railThicknessIn : L.side;
  for (const { s, tag } of SIDES) {
    const mem = ladder ? `rail-cabin-${tag}` : `girder-cabin-${tag}`;
    const bandZ = L.deckBot - (L.deckTop - jD);
    if (bandZ >= MIN_BAND_IN + 0.2) {
      const ej = endJoint(p, railT, L.side, bandZ - 0.2);
      add({ a: mem, b: 'transom-rear', typeA: ej.type, size: ej.size, pts: [[rearTx, s * (ladder ? L.hwC - railT / 2 : L.hwC + L.side / 2), (L.deckTop - jD + L.deckBot) / 2]], noteA: 'Member end into the transom face (the transom hangs jD below the deck).' });
    } else add({ a: mem, b: 'transom-rear', typeA: 'glue', size: 'epoxy + fillet', pts: [[rearTx, s * L.hwC, L.deckBot - 0.5]] });
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

  // ── Shoulder panels ──
  for (const { s, tag } of SIDES) {
    add({ a: `shoulder-${tag}`, b: 'deck-cabin', typeA: 'glue', size: 'epoxy fillet along the bottom', pts: [[L.xs - pl / 2, s * ((L.hwN + L.side + L.hwC) / 2), L.deckTop]], noteA: 'Banded on all four edges; fillets to the deck and both sides.' });
  }

  // ── Prow: removable on two inserts + knobs (D-9, D-36) ──
  {
    const pr = prowShape(ctx);
    const zs: number[] = [pr.origin[2] + pr.legLenIn * 0.3, pr.origin[2] + pr.legLenIn * 0.75];
    add({
      a: 'prow', b: 'transom-front', typeA: 'threaded-insert', typeB: 'knob', size: '1/4-20 × 3/8 flanged brass insert, epoxied in the leg', sizeB: '1/4-20 × 2 thumb-knob bolt through a 9/32 hole, knob inside the hull',
      pts: zs.map((z) => [L.xFront, 0, z] as Vec3), noteA: 'Removable for transport; no tools.', noteB: 'Knob heads sit inside the front transom above the foot stop.',
    });
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
        size: '#10-32 × 1 thumb-knob screw through a 3/16 clearance hole', sizeB: captured ? '#10-32 tee-nut, epoxied in the 6 mm web, prongs on the inside face' : '#10-32 × 3/8 brass insert',
        pts, noteA: 'Sign comes off for transport (D-9).',
      });
    } else {
      const dz = Math.max(0.3, sz / 2 - 0.45);
      const pts = [-dx, dx].map((x) => toModel(sign.transform, [x, 0, dz]));
      add({ a: sign.id, b: `side-cabin-${tag}-gunwale`, typeA: 'knob', typeB: 'threaded-insert', size: '#10-32 thumb-knob screw', sizeB: '#10-32 × 3/8 brass insert in the gunwale face', pts });
    }
  }

  // ── Finger guards: strap on two inserts in the nose gunwale ──
  {
    const fa = fingerAnalysis(ctx);
    for (const { s, tag } of SIDES) {
      const guard = byId.get(`guard-${tag}`);
      if (!guard || !fa.hazard) continue;
      const zg = L.noseTop + L.sideH - L.railBand;
      const zc = zg + Math.min(1, L.sideH - 0.25) / 2 - 0.1;
      const x0 = fa.hazard.x0, len = fa.hazard.x1 - fa.hazard.x0;
      add({
        a: guard.id, b: captured || openFrame ? `side-nose-${tag}-gunwale` : `side-nose-${tag}-board`, typeA: 'screw', typeB: 'threaded-insert', size: '#10-32 × 5/8 SS button-head screw', sizeB: '#10-32 × 3/8 flanged brass insert',
        pts: [0.25, 0.75].map((f) => [x0 + len * f, s * (L.hwN + L.side), zc] as Vec3), noteA: 'Strap on the gunwale outer face; the leg lies in the web recess.',
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
