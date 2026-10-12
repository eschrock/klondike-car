/**
 * Plan of the foot brake (Phase 3c-3, D-55): ONE pure source for where the swing arms, pivots, pedal bar, shoe beam, shoes, spring and parking latch sit, shared by
 * `model/brake.ts` (the parts), `analysis/brake.ts` (the checks) and the tests. Plain TS, no three.js. Model frame: +X forward, +Y left, +Z up, origin on the ground
 * under the rear-axle center; inches. All planar numbers are (x, z) in the vertical plane of one side; the right side mirrors the left (the whole mechanism is symmetrical
 * about y = 0, the latch hook hangs on the centerline).
 *
 * The mechanism (the Alaskan-sled drag bar of reference/05, on wheels):
 *   • Two swing ARMS (A36 plate) pivot on 3/8" bolts through two BRACKET tongues that reach back from the top of the rear axle beam, where each is bolted through the
 *     beam beside the rod (the shoe thrust goes tire → hub → rod → beam → bracket → arm → shoe, a closed loop inside the axle, so the rails and hangers see none of it).
 *     Each pivot sits directly ABOVE the shoe contact point, `d` = brakePivotAboveShoeIn higher.
 *   • The oak PEDAL BAR passes through a slot in the rear end of each arm, `a` = brakePedalReachIn behind the pivot, at ground clearance brakeBarClearIn.
 *   • The aluminum shoe BEAM passes through a slot at the front of each arm, just behind the rear tires, with a lined steel-backed SHOE bolted to its front face at each end.
 *   • Stepping on the bar swings both arms (rotation CCW about the pivots, seen with +x right): the bar goes down, the beam and shoes go FORWARD into the tread. Two
 *     extension springs lift the bar. A hook hung from the rear transom drops over a stud on the toe guard to hold it down (kick the hook sideways to release it).
 * The shoe force on the arm acts at the contact point `C`, a vertical distance `d` below the pivot (no horizontal offset), so the lever ratio is simply
 *   N_total / F_foot = a_applied / (d (cos β ± μ sin β)),   β = the shoe's angle below the axle line, ± for the cart rolling forward / backward.
 * Pose s ∈ [0, 1]: 0 is released (the model default, arm frame = world axes), 1 is applied (shoes on the tread): rotate the released geometry CCW by s·θ_app about the pivot.
 * The shoe is bolted to the beam with an oversize hole and rocks to follow the tread, so it only TRANSLATES with its bolt (it keeps the applied orientation).
 */
import type { Params } from '../params';
import type { Layout } from './layout';

export type V2 = [number, number];

const RAD = Math.PI / 180;
/** Running gap between stacked flat parts (in): a tolerance, not a design number. */
export const STACK_GAP_IN = 0.0625;
/** Material left around a slot or hole in the arm plate (in): fabrication rule of thumb. */
export const ARM_WEB_IN = 0.4;
/** Total running clearance of a bar in its slot (in): a tolerance. */
export const SLOT_CLEAR_IN = 0.0625;
/** Radius of plate material around a pivot hole (in). */
export const PIVOT_BOSS_IN = 0.8;
/** Radius of the bracket tongue's boss around the pivot (in): smaller than the arm's so the shoe beam, which crosses the tongue's plane, clears it. */
export const TONGUE_BOSS_IN = 0.65;
/** Released spring force as a fraction of the applied force: the spring's preload (a small-rate extension spring). */
export const SPRING_PRELOAD = 0.8;
/** Latch hook strap width, tooth height, gap from the transom face to the hook, and the stud's lateral clearance from the strap (in). */
export const HOOK_W_IN = 1;
export const HOOK_TOOTH_IN = 0.45;
export const HOOK_STANDOFF_IN = 0.45;
export const HOOK_TAIL_IN = 0.9;
export const STUD_SIDE_CLEAR_IN = 0.2;
/** Stop pin radius (in) and the distance behind the pivot where it sits. */
export const STOP_PIN_R_IN = 0.125;
export const STOP_BEHIND_PIVOT_IN = 1.2;
/** Height of the bracket's neck (the tongue between the pivot boss and the beam flange), the flange's length across the beam, and the bolt edge setback (in): fabrication rules. */
export const NECK_IN = 1.2;
export const FLANGE_Y_IN = 2;
export const FLANGE_BOLT_SETBACK_IN = 0.55;

export const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
export const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
export const cross2 = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
export const norm2 = (a: V2) => Math.hypot(a[0], a[1]);

/** Rotate `p` counter-clockwise (seen with +x right, +z up) by `th` about `c`. */
export function rot2(p: V2, c: V2, th: number): V2 {
  const x = p[0] - c[0], z = p[1] - c[1];
  const co = Math.cos(th), si = Math.sin(th);
  return [c[0] + x * co - z * si, c[1] + x * si + z * co];
}

export const disc = (c: V2, rad: number, n = 16): V2[] => Array.from({ length: n }, (_, i): V2 => [c[0] + rad * Math.cos((2 * Math.PI * i) / n), c[1] + rad * Math.sin((2 * Math.PI * i) / n)]);
export const rectPts = (c: V2, w: number, h: number): V2[] => [[c[0] - w / 2, c[1] - h / 2], [c[0] + w / 2, c[1] - h / 2], [c[0] + w / 2, c[1] + h / 2], [c[0] - w / 2, c[1] + h / 2]];

/** Convex hull, counter-clockwise (Andrew's monotone chain). */
export function hull2(pts: V2[]): V2[] {
  const q = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: V2[] = [];
  for (const v of q) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], v) <= 0) lo.pop(); lo.push(v); }
  const hi: V2[] = [];
  for (const v of [...q].reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], v) <= 0) hi.pop(); hi.push(v); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/** Signed separation of two CONVEX polygons (separating-axis test): positive = the gap along the best axis (a lower bound of the true distance), negative = penetration depth. */
export function convexGap(A: V2[], B: V2[]): number {
  let best = -Infinity;
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const nx = b[1] - a[1], nz = a[0] - b[0];
      const n = Math.hypot(nx, nz);
      if (n < 1e-12) continue;
      const proj = (q: V2) => (q[0] * nx + q[1] * nz) / n;
      const pa = A.map(proj), pb = B.map(proj);
      best = Math.max(best, Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
    }
  }
  return best;
}

/** [low, high] of a CONVEX polygon along the line x = `x` (null when the line misses it). */
export function polyZAt(poly: V2[], x: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[0] - x) * (b[0] - x) > 0) continue;
    if (Math.abs(b[0] - a[0]) < 1e-12) { lo = Math.min(lo, a[1], b[1]); hi = Math.max(hi, a[1], b[1]); continue; }
    const z = a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    lo = Math.min(lo, z); hi = Math.max(hi, z);
  }
  return Number.isFinite(lo) ? [lo, hi] : null;
}

/** [low, high] of a CONVEX polygon along the line z = `z`. */
export function polyXAt(poly: V2[], z: number): [number, number] | null {
  return polyZAt(poly.map((q): V2 => [q[1], q[0]]), z);
}

/** Positions across the cart (|y|, left side; the right side mirrors). */
export interface BrakeY {
  /** Bracket tongue, swing arm, bar half length, guard half width, shoe beam half length. */
  tongue: [number, number];
  arm: [number, number];
  barHalf: number;
  guardHalf: number;
  beamHalf: number;
  /** Shoe lining face (|y| range) and its center. */
  pad: [number, number];
  shoeC: number;
  /** Pivot bolt: head side face and nut side face. */
  boltIn: number;
  boltOut: number;
}

export interface BrakeGeom {
  ok: boolean;
  why: string;
  /** Wheel radius and center (x, z). */
  r: number;
  O: V2;
  /** Shoe angle below the axle line (rad), the radius of the shoe back, half-angle of the shoe arc. */
  beta: number;
  rBack: number;
  shoeHalfAngle: number;
  /** Tread contact point of the shoe center, and the center of the shoe back (applied pose; both fixed on the cart). */
  C: V2;
  Sb: V2;
  /** Pivot (fixed), its height above the contact, the pedal reach (released) and the shoe stroke. */
  P: V2;
  d: number;
  reach: number;
  stroke: number;
  /** Arm swing from released to applied (rad, CCW). */
  thetaApp: number;
  /** Shoe beam tube (arm frame, released): center, depth (x), height (z), and the center of its front face (the shoe bolt point). */
  beam: { c: V2; w: number; h: number; wall: number; face: V2 };
  /** Oak pedal bar (arm frame, released): center, depth, height and the edges. */
  bar: { c: V2; w: number; h: number; front: number; rear: number; top: number; bot: number };
  /** Bar center applied, horizontal reach pivot-to-bar applied, drop of the bar (released to applied). */
  barApp: V2;
  aApp: number;
  barDrop: number;
  /** Arm plate (arm frame): outline (convex, CCW), the beam slot, the bar slot and the pivot hole (radius). */
  arm: { outline: V2[]; beamSlot: V2[]; barSlot: V2[]; holeR: number; t: number; area: number };
  /**
   * Bracket tongue (fixed, one per side): the vertical plate (outline in x–z) with the pivot and stop pin holes, and the horizontal flange bent from its lower edge that lies
   * on the top of the axle beam (not drawn): flange x range and |y| range, the two vertical bolts (x, |y|) beside the rod, the neck, and the beam it sits on.
   */
  tongue: { outline: V2[]; flange: { x0: number; x1: number; y0: number; y1: number; bolts: V2[]; z0: number; z1: number }; neck: { x0: number; x1: number; z0: number; z1: number }; stop: V2; t: number; railBot: number; railTop: number; beam: { x: number; top: number; thick: number; depth: number; halfLen: number } };
  /** Toe guard plate (arm frame, released): x range, z range, half width, and the stud (center, length, tip released, tip applied). */
  guard: { x0: number; x1: number; z0: number; z1: number; yHalf: number; t: number };
  stud: { c: V2; len: number; r: number; y: number; x0: number; tipRel: number; tipApp: number; zApp: number };
  /** Latch hook (fixed, hangs from a bolt through the rear transom on the centerline): bolt (x, z), plate x range, outline in (y, z), tooth. */
  hook: { bolt: V2; x0: number; x1: number; outline: V2[]; hole: V2[]; zTooth: number; zBottom: number; yTooth: number; length: number; swing: number };
  /** Return springs (one per arm): hook point on the arm (released) and the eye screw in the transom's rear face, spring lengths and rate, forces, released/applied torque lever. */
  spring: { a: V2; e: V2; lenRel: number; lenApp: number; fApp: number; fRel: number; rate: number; leverApp: number; leverRel: number; y: number };
  /** The stop pin (center) that the arm rests against when released. */
  stop: V2;
  /** Foot-lever ratios: total shoe normal force over foot force, cart rolling forward / backward, the smaller (critical) one. */
  ratioFwd: number;
  ratioRev: number;
  ratioCrit: number;
  critical: 'forward' | 'reverse';
  y: BrakeY;
}

/** Released-pose point `q` (arm frame) moved to pose s ∈ [0, 1]. */
export const atPose = (g: Pick<BrakeGeom, 'P' | 'thetaApp'>, s: number, q: V2): V2 => rot2(q, g.P, s * g.thetaApp);

export function brakeGeometry(p: Params, L: Layout): BrakeGeom {
  const r = L.r;
  const O: V2 = [0, r];
  const beta = p.brakeShoeAngleDeg * RAD;
  const lt = p.brakeLiningThickIn, bt = p.brakeShoeBackThickIn;
  const rBack = r + lt + bt;
  const C: V2 = [-r * Math.cos(beta), r - r * Math.sin(beta)];
  const Sb: V2 = [-rBack * Math.cos(beta), r - rBack * Math.sin(beta)];
  const d = p.brakePivotAboveShoeIn;
  const P: V2 = [C[0], C[1] + d];
  const mu = p.brakePadMu;
  const stroke = p.brakeShoeTravelIn;
  const t = p.brakePlateThickIn;

  // Arm swing: the released shoe is the applied shoe moved back with the arm (translation only), `stroke` off the tread at its center.
  const gapAt = (th: number) => {
    const sb0 = rot2(Sb, P, -th);
    const c0: V2 = [C[0] + sb0[0] - Sb[0], C[1] + sb0[1] - Sb[1]];
    return Math.hypot(c0[0] - O[0], c0[1] - O[1]) - r;
  };
  let lo = 0, hi = 1.2;
  let why = '';
  if (gapAt(hi) < stroke) why = 'the arm cannot swing far enough to give the shoe stroke';
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (gapAt(m) < stroke) lo = m; else hi = m; }
  const thetaApp = (lo + hi) / 2;

  // Beam, bar (released frame)
  const bw = p.brakeBeamSizeIn, bh = p.brakeBeamHeightIn, wall = p.brakeBeamWallIn;
  const face = rot2(Sb, P, -thetaApp);
  const beam = { c: [face[0] - bw / 2, face[1]] as V2, w: bw, h: bh, wall, face };
  const pedD = p.brakePedalDepthIn, pedH = p.brakePedalHeightIn;
  const barZ = p.brakeBarClearIn + ARM_WEB_IN + SLOT_CLEAR_IN / 2 + pedH / 2;
  const barC: V2 = [P[0] - p.brakePedalReachIn, barZ];
  const bar = { c: barC, w: pedD, h: pedH, front: barC[0] + pedD / 2, rear: barC[0] - pedD / 2, top: barZ + pedH / 2, bot: barZ - pedH / 2 };
  const barApp = rot2(barC, P, thetaApp);
  const aApp = P[0] - barApp[0];
  const barDrop = barC[1] - barApp[1];

  // Foot-lever ratios. The shoe force acts at C, d below the pivot: moment arm d·(cos β ± μ sin β) (friction adds to the normal force's moment rolling forward).
  const kF = Math.cos(beta) + mu * Math.sin(beta);
  const kR = Math.cos(beta) - mu * Math.sin(beta);
  const ratioFwd = kF > 1e-6 ? aApp / (d * kF) : 0;
  const ratioRev = kR > 1e-6 ? aApp / (d * kR) : 0;
  const ratioCrit = Math.min(ratioFwd, ratioRev);

  // Arm plate: hull of the pivot boss, the beam slot web and the bar slot web; slots and the pivot hole are cut in it.
  const clr = SLOT_CLEAR_IN;
  const beamSlotC = beam.c, barSlotC = barC;
  const hullPts = [
    ...disc(P, PIVOT_BOSS_IN, 24),
    ...rectPts(beamSlotC, bw + clr + 2 * ARM_WEB_IN, bh + clr + 2 * ARM_WEB_IN),
    ...rectPts(barSlotC, pedD + clr + 2 * ARM_WEB_IN, pedH + clr + 2 * ARM_WEB_IN),
  ];
  const outline = hull2(hullPts);
  const area = polyArea(outline) - (bw + clr) * (bh + clr) - (pedD + clr) * (pedH + clr) - Math.PI * (p.brakePivotBoltDiameterIn / 2 + 0.02) ** 2;
  const arm = { outline, beamSlot: rectPts(beamSlotC, bw + clr, bh + clr), barSlot: rectPts(barSlotC, pedD + clr, pedH + clr), holeR: p.brakePivotBoltDiameterIn / 2 + 0.02, t, area };

  // Bracket tongue: a vertical plate at the rail's outer face line whose neck reaches forward to the top of the axle beam, with a flange bent inboard-to-outboard over the
  // beam top (bolted down through the beam in front of the rod). The thrust runs along the neck in tension, at about pivot height, with almost no moment.
  const railTop = L.railTop;
  const railBot = L.deckBot - p.railDepthIn;
  const bm = L.beamR;
  const rodR = p.axleDiameterIn / 2;
  const bd = p.brakeBracketBoltDiameterIn;
  const flangeX0 = bm.x - bm.thick / 2;
  const boltX = bm.x + rodR + 0.2 + bd / 2;
  const flangeX1 = boltX + bd / 2 + 0.3;
  const neck = { x0: flangeX0, x1: P[0] + TONGUE_BOSS_IN, z0: bm.top, z1: bm.top + NECK_IN };
  const stopTop = polyZAt(outline, P[0] - STOP_BEHIND_PIVOT_IN);
  const stop: V2 = [P[0] - STOP_BEHIND_PIVOT_IN, (stopTop ? stopTop[1] : P[1] + PIVOT_BOSS_IN) + STOP_PIN_R_IN];
  const yRailFace = L.hwC + L.side;
  const tongueOutline = hull2([...rectPts([(neck.x0 + neck.x1) / 2, (neck.z0 + neck.z1) / 2], neck.x1 - neck.x0, neck.z1 - neck.z0), ...disc(P, TONGUE_BOSS_IN, 24), ...disc(stop, 0.4, 12)]);
  const yFl0 = yRailFace + t + 0.0;
  const flange = { x0: flangeX0, x1: flangeX1, y0: yFl0, y1: yFl0 + FLANGE_Y_IN, bolts: [[boltX, yFl0 + FLANGE_BOLT_SETBACK_IN], [boltX, yFl0 + FLANGE_Y_IN - FLANGE_BOLT_SETBACK_IN]] as V2[], z0: bm.top, z1: bm.top + t };
  const tongue = { outline: tongueOutline, flange, neck, stop, t, railBot, railTop, beam: { x: bm.x, top: bm.top, thick: bm.thick, depth: bm.depth, halfLen: bm.len / 2 } };

  // y layers (left side): rail outer face, tongue, gap, arm, then the pivot bolt's head and nut sides.
  const yRail = L.hwC + L.side;
  const tY: [number, number] = [yRail, yRail + t];
  const aY: [number, number] = [tY[1] + STACK_GAP_IN, tY[1] + STACK_GAP_IN + t];
  const ry = p.rearTrackIn / 2;
  const padW = Math.max(0.5, Math.min(p.brakeLinedShoeWidthIn, p.tireWidthIn - 0.3));
  const pad: [number, number] = [ry - padW / 2, ry + padW / 2];
  const y: BrakeY = { tongue: tY, arm: aY, barHalf: aY[1] + 1, guardHalf: Math.min(aY[0] - 0.1, p.brakeToeGuardWidthIn / 2), beamHalf: pad[1] + 0.25, pad, shoeC: ry, boltIn: tY[0] - 0.3, boltOut: aY[1] + 0.58 };

  // Toe guard on the bar's front face, rising above the bar, and the latch stud through it.
  const tg = p.brakeGuardThickIn;
  const guard = { x0: bar.front, x1: bar.front + tg, z0: bar.top - 0.5, z1: bar.top + p.brakeToeGuardHeightIn, yHalf: y.guardHalf, t: tg };
  const hookT = t;
  const hookX1 = L.xRear - HOOK_STANDOFF_IN, hookX0 = hookX1 - hookT;
  const studR = p.brakeLatchPinDiameterIn / 2;
  const studC0: V2 = [guard.x1, guard.z1 - 0.75];
  const tipApp = hookX1 + 0.06; // applied tip: past the front face of the hook so the stud covers its whole thickness
  // The stud points along the arm-frame +x; at the applied pose it is tilted by thetaApp and its tip sits at tipApp. Solve the released tip from the applied stud line.
  const studLenGuess = (xTip: number) => Math.max(0.2, xTip - guard.x1);
  let tipRel = tipApp + 0.2;
  for (let i = 0; i < 20; i++) {
    const tipPt = rot2([tipRel, studC0[1]], P, thetaApp);
    tipRel += tipApp - tipPt[0];
  }
  const studApp = rot2([tipRel, studC0[1]], P, thetaApp);
  const stud = { c: studC0, len: studLenGuess(tipRel), r: studR, y: HOOK_W_IN / 2 + STUD_SIDE_CLEAR_IN + studR, x0: guard.x1, tipRel, tipApp: studApp[0], zApp: studApp[1] };

  // Latch hook: strap hanging from a bolt through the rear transom; the tooth sits just above the applied stud.
  const zb = L.deckTop - p.crossmemberDepthIn;
  // The hook bolt goes through the transom 0.7" above its lower edge, or, if that would put it in the deck dado, 0.6" above the deck top.
  const zBoltLow = zb + 0.7;
  const zBolt = zBoltLow + p.brakeBracketBoltDiameterIn / 2 < L.deckBot - 0.2 ? zBoltLow : L.deckTop + 0.6;
  const zTooth = stud.zApp + studR + 0.02;
  const zBottom = zTooth - HOOK_TAIL_IN;
  const yTooth = stud.y + studR + 0.1;
  const hw = HOOK_W_IN / 2;
  const top: V2[] = Array.from({ length: 13 }, (_, i): V2 => { const a = (Math.PI * i) / 12; return [hw * Math.cos(a), zBolt + hw * Math.sin(a)]; });
  const hookOutline: V2[] = [[-hw, zBottom], [hw, zBottom], [hw, zTooth], [yTooth, zTooth], [yTooth, zTooth + 0.1], [hw, zTooth + HOOK_TOOTH_IN], ...top];
  const hookHole = Array.from({ length: 12 }, (_, i): V2 => { const a = -(2 * Math.PI * i) / 12; return [0.2 * Math.cos(a), zBolt + 0.2 * Math.sin(a)]; });
  const length = zBolt + hw - zBottom;
  const hook = { bolt: [hookX1 - hookT / 2, zBolt] as V2, x0: hookX0, x1: hookX1, outline: hookOutline, hole: hookHole, zTooth, zBottom, yTooth, length, swing: yTooth - (stud.y - studR) };

  // Return springs: from a hook in the top edge of the arm, behind the pivot and under the rear transom, up to an eye screw in the transom's rear face just above its lower
  // edge (the rail bottom is too close to the arm when the deck is low, so the transom is the anchor; the load is vertical and small).
  const armMinX = Math.min(...outline.map((q) => q[0]));
  const xA = Math.min(P[0] - 1.5, Math.max(armMinX + 0.5, L.xRear - 0.4));
  const topAt = polyZAt(outline, xA);
  const A: V2 = [xA, (topAt ? topAt[1] : P[1]) - 0.4];
  const E: V2 = [xA, zb + 0.45];
  const Aapp = rot2(A, P, thetaApp);
  const lenRel = norm2(sub(E, A)), lenApp = norm2(sub(E, Aapp));
  const lever = (pt: V2) => { const u = sub(E, pt); const n = norm2(u) || 1; return Math.abs(cross2(sub(pt, P), [u[0] / n, u[1] / n])); };
  const leverApp = lever(Aapp), leverRel = lever(A);
  const fApp = leverApp > 1e-6 ? (p.brakeSpringForceLbf * aApp) / 2 / leverApp : 0;
  const fRel = SPRING_PRELOAD * fApp;
  const rate = lenApp - lenRel > 1e-6 ? (fApp - fRel) / (lenApp - lenRel) : 0;
  const spring = { a: A, e: E, lenRel, lenApp, fApp, fRel, rate, leverApp, leverRel, y: L.hwC - 0.2 };

  if (!why && !(P[1] - arm.holeR > beam.c[1] + (bh + clr) / 2 + 0.2)) why = 'the pivot hole runs into the beam slot: raise the pivot or lower the beam';
  if (!why && !(ratioCrit > 0)) why = 'no lever ratio';
  if (!why && !(stud.len > 0.3)) why = `the latch stud would stick out only ${stud.len.toFixed(1)}" to reach the hook on the rear transom: move the pedal bar back or the transom forward`;
  const ok = !why;
  return {
    ok, why, r, O, beta, rBack, shoeHalfAngle: p.brakeLinedShoeLengthIn / (2 * r), C, Sb, P, d, reach: p.brakePedalReachIn, stroke, thetaApp, beam, bar, barApp, aApp, barDrop,
    arm, tongue, guard, stud, hook, spring, stop, ratioFwd, ratioRev, ratioCrit, critical: ratioFwd <= ratioRev ? 'forward' : 'reverse', y,
  };
}

function polyArea(poly: V2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}
