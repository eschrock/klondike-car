/**
 * Brake mechanism (D-13, D-38), parking ratchet (D-39) and rear push-handle sockets (D-9, D-39).
 *
 * Mechanism (tire-tread brake, left lever side drawn; everything else mirrors):
 *   hand lever (oak) ── link (threaded rod + 2 clevises) ── crank on the cross shaft ── shaft (ground steel rod in
 *   two flange bearings) ── pinned shaft collars ── two steel arms per side ── pin ── oak shoe pad faced with a bonded
 *   brake lining, that swivels to wrap the tread.
 * No lathe, mill, broach or welder (build review M10): the collars are bought, the shaft joints are drill-press cross-pins
 * (a heavy-duty roll pin through collar and shaft, drilled together), and the steel plate (ratchet quadrant) is cut by a
 * waterjet / laser service (`fab: 'outsource'`).
 * The lever pivots on a 3/4" post (bronze sleeve) welded to the ear of the left steel bearing plate; both bearings are bronze flanged sleeves pressed into 3/16" plates bolted to the outside of the rail band (rear-mount.ts, D-48). The shoes sit on the
 * REAR of each tread just below the axle line (shaft is 1.5" behind the tire), so the arms are short and nearly tangent
 * to the tread: the friction force then passes almost through the shaft and the servo effect stays small (see `brakeGeometry`).
 *
 * `brakeGeometry` is the single source for the kinematics (lever ratio, stroke, servo factor) in the vertical x–z plane; both
 * the part builder and the analysis (`analysis/brake.ts`) read it. Pose s = 0 is released, s = 1 is applied (pad on the tread).
 * Everything here is plain TS (no three.js).
 */
import { BRAKE_TYPE, FRAME_STYLE, PARAM_DEFS, type Params } from '../params';
import { STEP, box, cylinder, span, segment, SIDES, woodMassLb, IN3_PER_FT3, type Ctx } from './build-utils';
import type { Layout } from './layout';
import { compose, multiply, rotationX, translation } from './mat4';
import { BEARING_STANDOFF_IN, HEAD_HEIGHT_D, bearingMount, boltLength, inchesText, localPoint } from './rear-mount';
import type { Joint, Mat4, Part, Vec2, Vec3 } from './types';

const RAD = Math.PI / 180;

// ── Vendor / placeholder dimensions (purchased items; not design numbers) ──
/** Oil-impregnated bronze bushing mass per inch of length (¾" bore × 1¼" OD). */
const BUSHING_MASS_LB_PER_IN = 0.06;
/** Clevis (rod end) body, nominal: long, across and tall. */
const CLEVIS_LEN_IN = 0.9;
/** Clevis fork cheek outside the part it straddles. */
const CLEVIS_CHEEK_IN = 0.15;
const CLEVIS_Z_IN = 0.5;
const CLEVIS_MASS_LB = 0.09;
/** Clearance between the lever and the hull top; washer / running gaps between stacked parts. */
const LEVER_HULL_GAP_IN = 0.64;
const STACK_GAP_IN = 0.05;
/**
 * The ratchet plate's outer face stands this far inboard of the lever: too small for a fingertip (< 3/16") and clear of a rub. With the
 * lever LEVER_HULL_GAP_IN (0.64") off the hull and a 1/4" plate that puts the plate 0.28" off the gunwale (clears a 1/4" side reflector). The
 * lever-to-hull gap (0.64") is outside the 3/16"–1/2" finger-entrapment band (eng review, pinch gaps).
 */
const PLATE_LEVER_GAP_IN = 0.11;
/** Shaft-collar OD = shaft + this; collar width = this × bar thickness (a bought 3/4"-bore collar, ≈ 1-1/4" OD × 3/8" wide). */
const HUB_WALL_IN = 0.5;
export const HUB_LEN_BARS = 1.5;
/** Ligament left on each side of the shaft bore in the crank boss (the crank bar is widened to shaft + 2 ligaments). */
export const CRANK_LIGAMENT_IN = 0.375;
/** Brake lining density (woven / molded sheet, about 120 lb/ft³) and shaft end cap dimensions: placeholders for purchased items. */
const LINING_LB_PER_IN3 = 0.07;
const END_CAP_MASS_LB = 0.02;
const END_CAP_LEN_IN = 0.5;
export const STEEL_FINISH = 'Finish: hot-dip galvanize or zinc-rich primer + two coats of paint (wet tannin-rich oak, BRIEF §5.2); stainless fasteners; epoxy barrier coat where it touches oak.';
/** Rough oak length: finished + 4 × the milling allowance (crosscut and end-trim; build review M8). Metal stock is the section × the cut length (build-utils, M9). */
const roughLen = (p: Params, l: number) => l + 4 * p.millingAllowanceIn;
/** Pad and its arms sit this far (fraction of the bar thickness) inside the tread edge. */
const PAD_INSET_BARS = 0.6;
const RETURN_SPRING_MASS_LB = 0.12;
const PAWL_SPRING_MASS_LB = 0.03;
const SLEEVE_MASS_LB = 0.05;
/** Bronze / steel sleeve wall (both sides) around a pin or bolt in an oak bore. */
export const SLEEVE_WALL_IN = 0.375;
/** Wall of the bronze sleeve in the lever bore around the 3/4" pivot post (3/4" ID × 1" OD). */
export const PIVOT_SLEEVE_WALL_IN = 0.125;

// ── 2D helpers on (x, z) ──
export type V2 = [number, number];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
const norm = (a: V2) => Math.hypot(a[0], a[1]);
/** Rotate `p` counter-clockwise (seen with +x right, +z up) by `th` about `c`. */
export function rot2(p: V2, c: V2, th: number): V2 {
  const x = p[0] - c[0], z = p[1] - c[1];
  const co = Math.cos(th), si = Math.sin(th);
  return [c[0] + x * co - z * si, c[1] + x * si + z * co];
}

/** Rear shoe length along the tread (in): the purchased lined steel-backed shoe (D-56). */
export const shoeLengthIn = (p: Params): number => p.brakeLinedShoeLengthIn;
/** Front shoe length and angle below the axle line: the long lined shoe at the axle line, where length costs no ground clearance. */
export const frontShoeLengthIn = (p: Params): number => p.frontBrakeShoeLengthIn;
export const frontShoeAngleDeg = (p: Params): number => p.frontBrakeShoeAngleDeg;
/** Lined shoe width across the tread (in). */
export const shoeWidthIn = (p: Params): number => p.brakeLinedShoeWidthIn;
/** Radial thickness of the lined shoe (steel back + lining) in inches; the pivot lug stands up to the pin at `brakeShoeThickIn / 2`. */
export const linedShoeThickIn = (p: Params): number => p.brakeShoeBackThickIn + p.brakeLiningThickIn;
/** Density of A36 sheet (lb/in3) for the shoe back. */
const STEEL_LB_PER_IN3 = 0.2836;

export interface BrakeGeom {
  /** False for the wooden-drum variant (no linkage geometry) or when the linkage cannot close. */
  ok: boolean;
  why: string;
  /** Wheel radius and centre (x, z). */
  r: number;
  O: V2;
  /** Cross shaft centre (x, z). */
  S: V2;
  /** Shoe: angle below the axle line (rad), outward normal of the tread at the shoe, friction direction (forward roll). */
  beta: number;
  n: V2;
  tFwd: V2;
  /** Pad pin at the APPLIED pose (pad on the tread) and the tread contact point. */
  E: V2;
  C: V2;
  /** Pad pin released (arm rotated back by the stroke). */
  Erel: V2;
  /** Arm vector shaft → pin (applied), its length, normal and friction moment arms about the shaft (in). */
  arm: V2;
  armLen: number;
  Kn: number;
  Kt: number;
  /** Effective moment arm of the shoe force about the shaft (in): forward roll (servo or de-servo) and reverse roll. */
  kFwd: number;
  kRev: number;
  /** The friction force makes the shoe self-energizing past the point of lock (|Kn| ≤ μ|Kt|). */
  selfLocking: boolean;
  /** Shaft rotation from released to applied (rad, counter-clockwise positive) and the stroke it produces at the pad. */
  thetaS: number;
  // Lever and link
  /** Lever tail length used (pivot → link pin): the param, or solved from the ratio target (`brakeLeverTailAuto`). */
  tailIn: number;
  /** Crank length used (shaft → link pin): the param, or lengthened by the solve when even the shortest tail cannot reach the ratio (small wheels). */
  crankIn: number;
  Q: V2;
  tilt: number;
  /** Unit vector along the lever, pivot → grip (released). */
  e: V2;
  G: V2;
  gripZ: number;
  /** Lever pivot → link pin on the lever, released and applied. */
  T0: V2;
  T1: V2;
  /** Link pin on the crank, released and applied. */
  B0: V2;
  B1: V2;
  linkLen: number;
  /** Lever rotation released → applied (rad, CCW = grip toward the rear). */
  thetaL: number;
  /** Perpendicular distances (applied) from the lever pivot and from the shaft to the link line (in). */
  dQ: number;
  dS: number;
  /** Vertical distance pivot → grip at the applied pose (in): the hand's lever arm for a horizontal pull. */
  lGrip: number;
  /** Link carries tension (true) or compression under a hand pull. */
  linkTension: boolean;
  /** N_total / F_hand, hand force horizontal at the grip, no efficiency: both rolling directions. */
  ratioFwd: number;
  ratioRev: number;
  /** The smaller of the two, and which way the cart is rolling when it applies. */
  ratioCrit: number;
  critical: 'forward' | 'reverse';
  /** Horizontal grip travel from released to applied (in). */
  gripTravelIn: number;
  /** Lever lean in the y–z plane (rad) above the knee, parallel to the flared side web: 0 when there is no flare. */
  lean: number;
  /** Height of the lever's knee (deck underside): below it the lever stands straight, above it it leans out. */
  kneeZ: number;
  y: BrakeY;
}

/** Positions across the cart (|y|, left side; mirror for the right). */
export interface BrakeY {
  /** Outer face of the rail band the shaft crosses. */
  rail: number;
  /** Steel bearing plate on the rail band (build r2 MUST-3: replaces the oak block): carries the shaft bearing and (left) the lever pivot. */
  block: [number, number];
  /** Lever (bottom of its lean) and crank / link plane centre. */
  lever: [number, number];
  plane: number;
  /** Input crank: a thick keyed plate from just outside the block to the clevis side of the link plane. */
  crank: [number, number];
  /** Pad, the two arms and the two hubs. */
  pad: [number, number];
  armIn: [number, number];
  armOut: [number, number];
  hubIn: [number, number];
  hubOut: [number, number];
  /** Shaft half length. */
  shaftHalf: number;
  /** Ratchet quadrant layer on the gunwale. */
  quad: [number, number];
  hullTop: number;
}

const solveLever = (T0: V2, B1: V2, Q: V2, linkLen: number): number | null => {
  // |rot(T0, Q, θ) − B1| = linkLen, smallest θ > 0 (grip toward the rear).
  const f = (th: number) => norm(sub(rot2(T0, Q, th), B1)) - linkLen;
  let a = 0, fa = f(0);
  const STEP_RAD = 0.002;
  for (let i = 1; i <= 400; i++) {
    const b = i * STEP_RAD, fb = f(b);
    if (fa === 0) return a;
    if (fa * fb <= 0) {
      let lo = a, hi = b;
      for (let k = 0; k < 60; k++) {
        const m = (lo + hi) / 2;
        if (f(lo) * f(m) <= 0) hi = m; else lo = m;
      }
      return (lo + hi) / 2;
    }
    a = b; fa = fb;
  }
  return null;
};

/** Shaft centre (x, z): behind the tread, at axle height (D-13). */
export const shaftCenter = (p: Params, r: number): V2 => [-(r + p.brakeShaftBehindTireIn), r];

const tailCache = new Map<string, { tail: number; crank: number }>();
/**
 * Lever tail (and, only if that is not enough, crank length) that makes the critical-direction ratio equal `target × headroom` (eng S-3:
 * the ratio must not fall out of a few fixed numbers). Scans the tail from the longest down, takes the first (longest) tail that delivers the
 * ratio and refines by bisection. If even the shortest tail falls short (small wheels), the tail stays at its minimum and the crank is
 * lengthened the same way. If nothing reaches it the shortest tail and longest crank are returned so `brake-ratio` fails honestly.
 */
export function solveLeverTail(p: Params, L: Layout): { tail: number; crank: number } {
  const tLo = PARAM_DEFS.brakeLeverTailIn.min, tHi = PARAM_DEFS.brakeLeverTailIn.max;
  const cLo = p.brakeCrankIn, cHi = Math.max(p.brakeCrankIn, PARAM_DEFS.brakeCrankIn.max);
  const key = JSON.stringify([L.r, p.rearHandleHeightIn, Object.entries(p).filter(([k]) => /^brake/.test(k) && k !== 'brakeLeverTailIn')]);
  const hit = tailCache.get(key);
  if (hit) return hit;
  const goal = p.brakeLeverRatio * p.brakeRatioHeadroom;
  const ratioAt = (t: number, c: number) => { const g = geometryWithTail(p, L, t, c); return g.ok ? g.ratioCrit : -1; };
  const STEP_IN = 0.05;
  /** Largest x in [lo, hi] with f(x) ≥ goal, scanning down from hi and refining by bisection; null if none. */
  const largest = (lo: number, hi: number, f: (x: number) => number): number | null => {
    for (let x = hi; x >= lo - 1e-9; x -= STEP_IN) {
      if (f(x) >= goal) {
        if (x >= hi - 1e-9) return hi;
        let a = x, b = x + STEP_IN; // a delivers the goal, b does not
        for (let k = 0; k < 30; k++) { const m = (a + b) / 2; if (f(m) >= goal) a = m; else b = m; }
        return a;
      }
    }
    return null;
  };
  let out = { tail: tLo, crank: cHi };
  const t = largest(tLo, tHi, (x) => ratioAt(x, cLo));
  if (t !== null) out = { tail: t, crank: cLo };
  else {
    // shortest tail, longer crank: ratio rises with the crank length, so take the SMALLEST crank that delivers it
    for (let c = cLo; c <= cHi + 1e-9; c += STEP_IN) {
      if (ratioAt(tLo, c) >= goal) {
        let a = Math.max(cLo, c - STEP_IN), b = c; // b delivers it, a (or the previous step) does not
        for (let k = 0; k < 30; k++) { const m = (a + b) / 2; if (ratioAt(tLo, m) >= goal) b = m; else a = m; }
        out = { tail: tLo, crank: b };
        break;
      }
    }
  }
  if (tailCache.size > 64) tailCache.clear();
  tailCache.set(key, out);
  return out;
}

export function brakeGeometry(p: Params, L: Layout): BrakeGeom {
  if (p.brakeType === BRAKE_TYPE.woodDrum || !p.brakeLeverTailAuto) return geometryWithTail(p, L, p.brakeLeverTailIn, p.brakeCrankIn);
  const { tail, crank } = solveLeverTail(p, L);
  return geometryWithTail(p, L, tail, crank);
}

function geometryWithTail(p: Params, L: Layout, tailIn: number, crankIn: number): BrakeGeom {
  const r = L.r;
  const O: V2 = [0, r];
  const S = shaftCenter(p, r);
  const mu = p.brakePadMu;
  const beta = p.brakeShoeAngleDeg * RAD;
  const n: V2 = [-Math.cos(beta), -Math.sin(beta)];
  const tFwd: V2 = [-Math.sin(beta), Math.cos(beta)];
  const rPin = r + p.brakeShoeThickIn / 2;
  const E: V2 = add(O, mul(n, rPin));
  const C: V2 = add(O, mul(n, r));
  const arm = sub(E, S);
  const Kn = cross(arm, n);
  const Kt = cross(arm, tFwd);
  const kFwd = Math.abs(Kn + mu * Kt);
  const kRev = Math.abs(Kn - mu * Kt);
  const selfLocking = !(Math.abs(Kn) > mu * Math.abs(Kt) + 1e-9) || Math.abs(Kn) < 1e-6;
  // Rotation that moves the pin INWARD (along −n) by the stroke: v_E·(−n) = −θ·Kn  ⇒  θ = −sign(Kn)·stroke/|Kn|.
  const thetaS = Math.abs(Kn) < 1e-6 ? 0 : (-Math.sign(Kn) * p.brakeShoeTravelIn) / Math.abs(Kn);
  const Erel = rot2(E, S, -thetaS);

  // Lever geometry (released pose).
  const Q: V2 = [S[0] - p.brakeLeverPivotBehindShaftIn, p.brakeLeverPivotZIn];
  const tilt = p.brakeLeverTiltDeg * RAD;
  const e: V2 = [-Math.sin(tilt), Math.cos(tilt)];
  const gripZ = p.rearHandleHeightIn - p.brakeLeverGripBelowHandleIn;
  const lever = Math.max(1, (gripZ - Q[1]) / Math.cos(tilt));
  const G = add(Q, mul(e, lever));
  const T0 = sub(Q, mul(e, tailIn));
  const phi = p.brakeCrankAngleDeg * RAD;
  const B0 = add(S, mul([Math.cos(phi), Math.sin(phi)], crankIn));
  const linkLen = norm(sub(B0, T0));
  const B1 = rot2(B0, S, thetaS);

  const th = solveLever(T0, B1, Q, linkLen);
  const thetaL = th ?? 0;
  const T1 = rot2(T0, Q, thetaL);
  const G1 = rot2(G, Q, thetaL);
  const u: V2 = linkLen > 1e-9 ? mul(sub(B1, T1), 1 / Math.max(1e-9, norm(sub(B1, T1)))) : [1, 0];
  const dQ = Math.abs(cross(sub(T1, Q), u));
  const dS = Math.abs(cross(sub(B1, S), u));
  const lGrip = G1[1] - Q[1];
  // Hand pull back at the grip → CCW moment M = F·lGrip on the lever; link force c·u on the lever at T1 balances it.
  const crossTQ = cross(sub(T1, Q), u);
  const linkTension = Math.abs(crossTQ) > 1e-9 ? -lGrip / crossTQ > 0 : true;
  const safe = (k: number) => (k > 1e-6 && dQ > 1e-6 ? (lGrip / dQ) * (dS / k) : 0);
  const ratioFwd = safe(kFwd);
  const ratioRev = safe(kRev);
  const critical: 'forward' | 'reverse' = ratioFwd < ratioRev ? 'forward' : 'reverse';
  const ratioCrit = Math.min(ratioFwd, ratioRev);

  // Lean the lever outward so it stays clear of a flared gunwale (parallel to the side web).
  const kneeZ = L.deckBot;
  const lean = L.flare > 0 ? Math.atan2(L.flare, Math.max(0.1, L.web.z1 - kneeZ)) : 0;
  // The ratchet plate sits PLATE_LEVER_GAP_IN inboard of the lever at the plate's lowest point (where a leaning lever is closest to the hull).
  const rTooth = ratchetRadius(p, L, Q[1], tilt);
  const plateZLow = Q[1] + (rTooth - p.brakeBarWidthIn - 0.25) * Math.min(Math.sin(Math.atan2(e[1], e[0])), Math.sin(Math.atan2(e[1], e[0]) + p.brakeRatchetSpanDeg * RAD));

  // ── y positions ──
  const hullTop = L.hwC + L.side + L.flare;
  const rail = L.hwC + L.side; // ladder rails now run flush under the chine (D-43, F2), so both frames have their outer face here
  const barT = p.brakeBarThickIn;
  const leverY0 = Math.max(rail + 0.5, L.hwC + L.side + LEVER_HULL_GAP_IN);
  const leverW = p.brakeLeverWidthIn;
  const plane = leverY0 + leverW / 2;
  const hubLen = HUB_LEN_BARS * barT;
  const ry = p.rearTrackIn / 2;
  const padW = Math.max(0.5, Math.min(shoeWidthIn(p), p.tireWidthIn - 2 * PAD_INSET_BARS * barT));
  const padY0 = ry - p.tireWidthIn / 2 + PAD_INSET_BARS * barT;
  const padY1 = padY0 + padW;
  const armIn: [number, number] = [padY0 - STACK_GAP_IN * 0.4 - barT, padY0 - STACK_GAP_IN * 0.4];
  const armOut: [number, number] = [padY1 + STACK_GAP_IN * 0.4, padY1 + STACK_GAP_IN * 0.4 + barT];
  const hubIn: [number, number] = [armIn[0] - hubLen, armIn[0]];
  const hubOut: [number, number] = [armOut[1], armOut[1] + hubLen];
  const bt = p.brakePlateThickIn;
  const headH = HEAD_HEIGHT_D * p.brakeBearingBoltDiameterIn;
  const y: BrakeY = {
    rail,
    block: [rail, rail + bt],
    lever: [leverY0, leverY0 + leverW],
    plane,
    // The crank starts just outside the plate's bolt heads (heads stand HEAD_HEIGHT_D × D proud of the plate) and is centred on the link plane.
    crank: ((): [number, number] => { const y0 = Math.max(rail + bt + headH + 0.1, leverY0); return [y0, 2 * plane - y0]; })(),
    pad: [padY0, padY1],
    armIn, armOut, hubIn, hubOut,
    shaftHalf: hubOut[1],
    quad: ((): [number, number] => { const face = leverY0 + Math.tan(lean) * Math.max(0, plateZLow - kneeZ) - PLATE_LEVER_GAP_IN; return [face - p.brakeRatchetPlateThickIn, face]; })(),
    hullTop,
  };

  const why = th === null ? 'the link does not close: no lever angle reaches the applied crank position' : '';
  const ok = th !== null && !selfLocking && ratioCrit > 0;
  return {
    ok, why, r, O, S, beta, n, tFwd, E, C, Erel, arm, armLen: norm(arm), Kn, Kt, kFwd, kRev, selfLocking, thetaS,
    tailIn, crankIn, Q, tilt, e, G, gripZ, T0, T1, B0, B1, linkLen, thetaL, dQ, dS, lGrip, linkTension,
    ratioFwd, ratioRev, ratioCrit, critical, gripTravelIn: G[0] - G1[0], lean, kneeZ, y,
  };
}

/** Rigid pose of the linkage at s ∈ [0, 1] (0 released, 1 applied): shaft angle and the closing lever angle. */
export function brakePose(g: BrakeGeom, s: number): { thetaS: number; thetaL: number; T: V2; B: V2; G: V2; E: V2 } {
  const thetaS = s * g.thetaS;
  const B = rot2(g.B0, g.S, thetaS);
  const thetaL = s <= 0 ? 0 : s >= 1 ? g.thetaL : solveLever(g.T0, B, g.Q, g.linkLen) ?? 0;
  return { thetaS, thetaL, T: rot2(g.T0, g.Q, thetaL), B, G: rot2(g.G, g.Q, thetaL), E: rot2(g.Erel, g.S, thetaS) };
}

// ── Ratchet geometry (quadrant concentric with the lever pivot) ──
export interface RatchetGeom {
  center: V2;
  /** Lever axis angle (rad from +x) released, and the toothed span (rad). */
  a0: number;
  span: number;
  rTooth: number;
  rInner: number;
  pitchAngle: number;
  nTeeth: number;
  /** Pawl pivot (on the lever, outside the ring) and tip (at the rim) in the released pose. */
  pawlPivot: V2;
  pawlTip: V2;
  pawlArm: number;
}

/** Tooth radius: the param, capped so the pawl pivot (tooth radius + 0.9 bar widths) and its bar stay below the gunwale top, where the lash points sit. */
export function ratchetRadius(p: Params, L: Layout | undefined, pivotZ: number, tilt: number): number {
  const gTop = L ? L.deckTop + L.sideH : Infinity;
  const rMax = (gTop - 0.1 - p.brakeBarWidthIn * 0.4 - pivotZ) / Math.cos(tilt) - p.brakeBarWidthIn * 0.9;
  return Math.max(3, Math.min(p.brakeRatchetRadiusIn, rMax));
}

export function ratchetGeometry(p: Params, g: BrakeGeom, L?: Layout): RatchetGeom {
  const rTooth = ratchetRadius(p, L, g.Q[1], g.tilt);
  const a0 = Math.atan2(g.e[1], g.e[0]);
  const span = p.brakeRatchetSpanDeg * RAD;
  const pitchAngle = p.brakeRatchetPitchIn / rTooth;
  const nTeeth = Math.max(1, Math.floor(span / pitchAngle));
  const dirAt = (a: number): V2 => [Math.cos(a), Math.sin(a)];
  const pawlPivot = add(g.Q, mul(g.e, rTooth + p.brakeBarWidthIn * 0.9));
  // Pawl rests in the first valley after release: tip on the rim at the lever axis.
  const pawlTip = add(g.Q, mul(dirAt(a0), rTooth - p.brakeRatchetToothDepthIn / 2));
  return {
    center: g.Q, a0, span, rTooth, rInner: Math.max(1, rTooth - p.brakeBarWidthIn - 0.25), pitchAngle, nTeeth,
    pawlPivot, pawlTip, pawlArm: norm(sub(pawlPivot, pawlTip)),
  };
}

// ── Part helpers ──
const mid3 = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** Basis-matrix transform from a position and two columns (the third is x × y). */
function basis(ex: Vec3, ey: Vec3, o: Vec3): Mat4 {
  const ez: Vec3 = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  return [ex[0], ex[1], ex[2], 0, ey[0], ey[1], ey[2], 0, ez[0], ez[1], ez[2], 0, o[0], o[1], o[2], 1];
}

/** Part from a profile in the model x–z plane, extruded across y from `yHi` down to `yHi − depth` (profile origin at (ox, oz)). */
export function planarExtrusion(ctx: Ctx, s: {
  id: string; partNo?: string; name: string; mat: 'oak' | 'steel' | 'fixed'; outline: Vec2[]; origin: V2; yHi: number; depth: number;
  grain?: 'x' | 'y' | 'z'; fab?: Part['fab']; joints?: Joint[]; notes?: string; explode?: Vec3; cg?: Vec3;
  kind?: Part['kind']; massLb?: number; material?: string; sourcing?: Part['sourcing'];
}): Part {
  const { p } = ctx;
  let a = 0, per = 0;
  for (let i = 0; i < s.outline.length; i++) {
    const [x1, y1] = s.outline[i], [x2, y2] = s.outline[(i + 1) % s.outline.length];
    a += x1 * y2 - x2 * y1;
    per += Math.hypot(x2 - x1, y2 - y1);
  }
  const area = Math.abs(a) / 2;
  const vol = area * s.depth;
  const massLb = s.massLb !== undefined ? s.massLb : s.mat === 'steel'
    ? (vol / IN3_PER_FT3) * p.steelDensityPcf
    : woodMassLb(p, vol, 2 * area + per * s.depth, p.oakDensityPcf);
  const xs = s.outline.map((q) => q[0]), zs = s.outline.map((q) => q[1]);
  const dims = [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), s.depth].sort((q, w) => q - w);
  const part: Part = {
    id: s.id, name: s.name, group: 'brake', kind: s.kind ?? (s.mat === 'steel' ? 'metal' : 'lumber'),
    material: s.material ?? (s.mat === 'steel' ? 'A36 steel plate' : 'white oak'),
    geometry: { type: 'extrusion', outline: s.outline, depth: s.depth },
    // local (x, y, z) → model (x, yHi − z, oz + y): Rx(+90°) then translate.
    transform: multiply(translation(s.origin[0], s.yHi, s.origin[1]), rotationX(Math.PI / 2)),
    body: 'chassis', massLb, fab: s.fab ?? (s.mat === 'steel' ? 'laser' : 'bandsaw'), step: STEP.brake,
    explode: s.explode ?? [-1, 0, -0.3],
  };
  if (s.partNo) part.partNo = s.partNo;
  if (s.mat === 'oak') {
    part.stock = { t: dims[0], w: dims[1], l: dims[2] };
    part.rough = { t: dims[0] + p.millingAllowanceIn, w: dims[1] + p.millingAllowanceIn, l: roughLen(p, dims[2]) };
    if (s.grain) part.grain = s.grain;
  } else if (s.mat === 'steel') {
    // Plate blank: the bounding rectangle of the outline (the cutting service nests it; the width/length are the blank).
    const spans = [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)].sort((q, w) => q - w);
    part.stock = { t: s.depth, w: spans[0], l: spans[1] };
  }
  if (s.sourcing) part.sourcing = s.sourcing;
  if (s.joints) part.joints = s.joints;
  if (s.notes) part.notes = s.notes;
  if (s.cg) part.cgIn = s.cg;
  return part;
}

/** Rotated flat bar in the x–z plane: from (x, z) a to b, `thickY` across, `widthPlane` in the plane. */
export function flatBar(ctx: Ctx, s: { id: string; partNo?: string; name: string; a: V2; b: V2; y: number; thickY: number; widthPlane: number; mat: 'steel' | 'oak'; grain?: 'x' | 'y' | 'z';
  fab?: Part['fab']; joints?: Joint[]; notes?: string; explode?: Vec3; extendA?: number; extendB?: number; sourcing?: Part['sourcing'] }): Part {
  const d = sub(s.b, s.a);
  const len = Math.max(1e-6, norm(d));
  const ud: V2 = [d[0] / len, d[1] / len];
  const a = sub(s.a, mul(ud, s.extendA ?? 0));
  const b = add(s.b, mul(ud, s.extendB ?? 0));
  const seg = segment([a[0], s.y, a[1]], [b[0], s.y, b[1]], s.thickY, s.widthPlane);
  return box(ctx, {
    id: s.id, partNo: s.partNo, name: s.name, group: 'brake', mat: s.mat, step: STEP.brake, grain: s.grain, fab: s.fab, joints: s.joints,
    notes: s.notes, explode: s.explode, sourcing: s.sourcing, ...seg,
  });
}

export const cylY = (ctx: Ctx, s: { id: string; partNo?: string; name: string; c: V2; y0: number; y1: number; radius: number; mat?: 'steel' | 'fixed'; massLb?: number; material?: string;
  kind?: Part['kind']; fab?: Part['fab']; joints?: Joint[]; notes?: string; explode?: Vec3; sourcing?: Part['sourcing']; stock?: Part['stock'] }): Part =>
  cylinder(ctx, {
    id: s.id, partNo: s.partNo, name: s.name, group: 'brake', mat: s.mat ?? 'steel', massLb: s.massLb, material: s.material, kind: s.kind, fab: s.fab, step: STEP.brake,
    center: [s.c[0], (s.y0 + s.y1) / 2, s.c[1]], axis: 'y', radius: s.radius, length: Math.abs(s.y1 - s.y0), joints: s.joints, notes: s.notes, explode: s.explode, sourcing: s.sourcing, stock: s.stock,
  });

/** Bought bar / rod stock (A36 flat bar, ground rod): the section × the cut length (build review M9). */
export const bar = (_p: Params, t: number, w: number, l: number) => ({ t, w, l });
export const YARD = (what: string): Part['sourcing'] => ({ vendor: `Local steel yard or Metals Depot / McMaster-Carr (${what})` });

/**
 * Brake parts at pose `s` (0 released, 1 applied; the model default is 0). `sweep` in analysis/brake.ts calls this with
 * s = 0 … 1 to check the stroke. Returns only the parts that move with s when `movingOnly`.
 */
export function buildBrakeAt(ctx: Ctx, s: number, movingOnly = false): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const g = brakeGeometry(p, L);
  const pose = brakePose(g, s);
  const r = L.r;
  const barT = p.brakeBarThickIn, barW = p.brakeBarWidthIn;
  const D = p.brakeShaftDiameterIn;
  const Y = g.y;
  const ladder = p.frameStyle === FRAME_STYLE.ladder;
  const railId = (tag: 'L' | 'R') => (ladder ? `rail-cabin-${tag}` : `girder-cabin-${tag}`);
  const add1 = (x: Part | null) => { if (x) parts.push(x); };
  const fixed = (x: Part): Part | null => (movingOnly ? null : x);
  const yRange = (sgn: 1 | -1, a: number, b: number): [number, number] => (sgn > 0 ? [a, b] : [-b, -a]);

  if (p.brakeType === BRAKE_TYPE.woodDrum) return movingOnly ? [] : buildDrumVariant(ctx);

  // ── Cross shaft ──
  add1(fixed(cylinder(ctx, {
    id: 'brake-shaft', name: 'Brake cross shaft', group: 'brake', mat: 'steel', step: STEP.brake, center: [g.S[0], 0, g.S[1]], axis: 'y',
    radius: D / 2, length: 2 * Y.shaftHalf, material: 'ground 4140 pre-hardened alloy steel rod (28-32 HRC)',
    stock: bar(p, D, D, 2 * Y.shaftHalf),
    sourcing: { vendor: `McMaster-Carr (${D}" precision ground 4140 pre-hardened alloy rod, 72" (6 ft) length: the cut shaft is ${f2(2 * Y.shaftHalf)}", so the 36" length is too short; cut on the bandsaw with a bi-metal blade and cutting fluid, chamfer both ends, grease it)` },
    notes: `Turns ±~11° in two flange bearings. CROSS-DRILLING A 28-32 HRC ROD ON A DRILL PRESS (build review r2 S9): the six ${p.brakeRollPinDiameterIn}" holes (one per arm collar, two at 90° in the crank) are drilled with each collar or the crank clamped on the shaft in a V-block in the drill-press vise: center-punch, 1/8" pilot, then a ${p.brakeRollPinDiameterIn}" cobalt (M42) bit, about 300 rpm, cutting fluid, peck every 1/16"; ream to the roll-pin size; drill collar and shaft TOGETHER so the holes line up. Plan on one dull bit; if the shop would rather not, a machine shop will cross-drill the rod cheaply, or step up to a 7/8" 1045 shaft (+1.8 lb) that drills like mild steel. No keyseat, lathe or mill (build review M10). Shaft ground rod (D-38). ${STEEL_FINISH} Both ends carry a rubber / nylon dome cap (shin height).`,
    joints: [
      { type: 'pin', to: 'brake-hub-L-in', count: 1, size: `${p.brakeRollPinDiameterIn}" heavy-duty roll pin`, note: 'cross-drilled through the collar and shaft together' },
      { type: 'pin', to: 'brake-hub-L-out', count: 1, size: `${p.brakeRollPinDiameterIn}" heavy-duty roll pin` },
      { type: 'pin', to: 'brake-hub-R-in', count: 1, size: `${p.brakeRollPinDiameterIn}" heavy-duty roll pin` },
      { type: 'pin', to: 'brake-hub-R-out', count: 1, size: `${p.brakeRollPinDiameterIn}" heavy-duty roll pin` },
      { type: 'pin', to: 'brake-crank', count: 2, size: `${p.brakeRollPinDiameterIn}" heavy-duty roll pins at 90°`, note: 'through the crank boss and shaft' },
    ],
    explode: [0, 0, -1],
  })));

  const mount = bearingMount(p, L, g.S, g.Q);
  const rail0 = mount.rail;
  const plateT = p.brakePlateThickIn;
  const bolts = mount.bolts;
  const nB = bolts.length;
  const bolt = p.brakeBearingBoltDiameterIn;
  const dbl = mount.doubler;
  const grip = plateT + rail0.t + dbl.t;
  const bLen = boltLength(grip, bolt);

  for (const { s: sgn, tag } of SIDES) {
    // Steel bearing plate on the OUTSIDE of the rail band (build r2 MUST-3, D-48): bolted in the solid rail forward of the shaft notch; the flanged
    // bronze bearing is pressed into it and stands into the notch; the left plate has an ear that reaches behind the rail end for the lever pivot.
    {
      const plateId = `brake-bearing-plate-${tag}`;
      const [pl0, pl1] = yRange(sgn, Y.block[0], Y.block[1]);
      const yMid = sgn * (Y.rail + plateT / 2);
      const plate = planarExtrusion(ctx, {
        id: plateId, partNo: 'brake-bearing-plate', name: `Brake bearing plate ${tag}`, mat: 'steel', outline: tag === 'L' ? mount.outlineL : mount.outlineR, origin: [0, 0],
        yHi: Math.max(pl0, pl1), depth: plateT, fab: 'outsource', explode: [-0.3, sgn, -0.2],
        sourcing: { vendor: `Waterjet / laser cutting service (SendCutSend, OSH Cut or a local shop): ${f2(plateT)}" A36 plate from the DXF, ${nB} × ${f2(mount.boltHole)}" bolt holes, ${f2(mount.bearingOd)}" bearing bore (reamed to a press fit)${tag === 'L' ? `; the ${f2(p.brakePivotBoltDiameterIn)}" pivot post is welded to the ear` : ''}; hot-dip galvanize or zinc-rich primer + paint (steel against wet oak, epoxy the contact face)` },
        joints: [],
        notes: `${f2(plateT)}" A36 plate on the outside of the ${rail0.ladder ? 'cabin rail' : 'side girder'}, ${bolts.length} bolts (${mount.xCols.length} columns × 2 rows) in the solid wood FORWARD of the shaft notch, ${f2(mount.dist.end)}" from the rail end (≥ 7D) and ${f2(mount.dist.bottom)}" / ${f2(mount.dist.top)}" from the rail bottom / the deck ledge. The bronze bearing (${f2(mount.bearingOd)}" OD) is pressed in and stands ${f2(BEARING_STANDOFF_IN)}" into the ${f2(mount.notch.x1 - mount.notch.x0)}" shaft notch cut up from the rail bottom (the shaft passes through the notch, not through the rail).${tag === 'L' ? ` The ear behind the rail end carries the welded lever pivot post at x = ${f2(g.Q[0])}" (the plate overhangs the rear transom's end, which has no bolts in end grain).` : ''} ${STEEL_FINISH}`,
      });
      const world = bolts.map(([x, z]): Vec3 => [x, yMid, z]);
      plate.joints!.push({
        type: 'bolt', to: railId(tag), count: bolts.length, diaIn: bolt, at: world.map((w) => localPoint(plate.transform, w)),
        size: `${f2(bolt)}" × ${inchesText(bLen)} 316 hex bolts (head outside, ${f2(HEAD_HEIGHT_D * bolt)}" proud), 1-1/2" fender washer + nylock nut inside the rail`,
        note: `grid ${mount.xCols.length} × 2 at ${f2(p.brakeBearingBoltSpacingIn)}" × ${f2(p.brakeBearingBoltRowGapIn)}"; grip ${f2(grip)}" (plate + rail + oak doubler)`,
      });
      plate.joints!.push({ type: 'pin', to: `brake-bushing-${tag}`, count: 1, size: `${f2(mount.bearingOd)}" bore, press fit with retaining compound`, at: [localPoint(plate.transform, [g.S[0], yMid, g.S[1]])] });
      if (tag === 'L') plate.joints!.push({ type: 'pin', to: 'brake-lever-pin', count: 1, size: '3/16" fillet weld all round (outsourced)', at: [localPoint(plate.transform, [g.Q[0], sgn * Y.block[1], g.Q[1]])] });
      add1(fixed(plate));
      if (dbl.t > 1e-6) {
        const dy: [number, number] = yRange(sgn, rail0.yIn - dbl.t, rail0.yIn);
        const doubler = box(ctx, {
          id: `brake-rail-doubler-${tag}`, partNo: 'brake-rail-doubler', name: `Bearing-plate oak doubler ${tag}`, group: 'brake', mat: 'oak', step: STEP.brake, grain: 'x',
          ...span([dbl.x0, dbl.x1], dy, [dbl.z0, dbl.z1]), explode: [0.2, -sgn, -0.3],
          joints: [{ type: 'glue', to: railId(tag), count: 1, size: 'epoxy, full face, clamped with the bearing-plate bolts' }],
          notes: `${f2(dbl.t)}" oak doubler glued to the INSIDE of the ${rail0.ladder ? 'rail' : 'girder'} behind the bolt grid (x ${f2(dbl.x0)} to ${f2(dbl.x1)}), so the ${nB} bearing-plate bolts go through ${f2(rail0.t + dbl.t)}" of oak (more bolt capacity and a cleavage limit that a 3/4" rail alone cannot meet at these edge distances, build MUST-3, D-48). It starts forward of the shaft's path and stops short of the rear-axle-beam hold-down angle; the deck rests on its top.`,
        });
        doubler.joints!.push({ type: 'bolt', to: plateId, count: nB, diaIn: bolt, size: 'the plate bolts pass through (see the plate)', at: bolts.map(([x, z]) => localPoint(doubler.transform, [x, sgn * (rail0.yIn - dbl.t / 2), z])) });
        add1(fixed(doubler));
      }
      // Flanged bronze bearing: pressed into the plate, stands into the notch (steel-backed length = plate + standoff).
      const [b0, b1] = yRange(sgn, Y.rail - BEARING_STANDOFF_IN, Y.block[1]);
      const bush = cylY(ctx, {
        id: `brake-bushing-${tag}`, partNo: 'brake-bushing', name: `Cross shaft bearing ${tag}`, c: g.S, y0: b0, y1: b1, radius: mount.bearingOd / 2, mat: 'fixed', kind: 'purchased',
        material: 'oil-impregnated bronze flanged sleeve bearing', massLb: BUSHING_MASS_LB_PER_IN * Math.abs(b1 - b0), fab: 'buy', explode: [0, sgn, -0.3],
        sourcing: { vendor: `McMaster-Carr (SAE 841 flanged sleeve bearing, ${f2(D)}" ID × ${f2(mount.bearingOd)}" OD × ${f2(Math.abs(b1 - b0))}" long; confirm the stocked length, the ID is what matters; flange against the plate's outer face)` },
        notes: `Bronze sleeve bearing pressed into the ${f2(plateT)}" steel plate (the plate, not the oak, carries the overturning moment of the crank and shoe-arm loads to the bolt grid: brake-shaft, D-38/D-48); it stands ${f2(BEARING_STANDOFF_IN)}" into the shaft notch in the rail.`,
      });
      bush.joints = [{ type: 'pin', to: plateId, count: 1, size: `${f2(mount.bearingOd)}" press fit`, at: [localPoint(bush.transform, [g.S[0], yMid, g.S[1]])] }];
      add1(fixed(bush));
    }
    // Shoe assembly: hubs, arms, pin, pad, spring.
    const arm = (which: 'in' | 'out') => {
      const [a0, a1] = which === 'in' ? Y.armIn : Y.armOut;
      const [y0, y1] = yRange(sgn, a0, a1);
      return flatBar(ctx, {
        id: `brake-arm-${tag}-${which}`, partNo: 'brake-arm', name: `Shoe arm ${tag} ${which === 'in' ? 'inboard' : 'outboard'}`, a: g.S, b: pose.E,
        y: (y0 + y1) / 2, thickY: barT, widthPlane: barW, mat: 'steel', fab: 'drill-tap', extendB: p.brakeShoePinDiameterIn / 2 + 0.1,
        sourcing: YARD(`A36 flat bar ${barT}" × ${barW}", bandsaw and drill press`),
        joints: [
          { type: 'bolt', to: `brake-hub-${tag}-${which}`, count: 2, size: '1/4-20 × 1 stainless socket-head screws, into the face-tapped collar' },
          { type: 'pin', to: `brake-shoe-pin-${tag}`, count: 1, size: `${p.brakeShoePinDiameterIn}" dia pin, drilled to a close slip fit` },
        ],
        notes: `Cut from A36 flat bar on the bandsaw; the pin hole is reamed. The arm is nearly tangent to the tread so the shoe friction stays close to neutral (D-38). ${STEEL_FINISH}`,
        explode: [0.2, sgn, 0.2],
      });
    };
    const hub = (which: 'in' | 'out') => {
      const [a0, a1] = which === 'in' ? Y.hubIn : Y.hubOut;
      const [y0, y1] = yRange(sgn, a0, a1);
      const od = D + HUB_WALL_IN, len = Math.abs(y1 - y0);
      return cylY(ctx, {
        id: `brake-hub-${tag}-${which}`, partNo: 'brake-hub', name: `Shoe arm shaft collar ${tag} ${which === 'in' ? 'inboard' : 'outboard'}`, c: g.S, y0, y1, radius: od / 2,
        mat: 'fixed', kind: 'purchased', material: 'steel shaft collar, face-tapped (flange-mount)', massLb: (Math.PI / 4) * (od ** 2 - D ** 2) * len / IN3_PER_FT3 * p.steelDensityPcf,
        fab: 'buy', explode: [0, sgn, -0.5],
        sourcing: { vendor: `McMaster-Carr or Ruland (${D}" bore flange-mount / face-tapped clamp-on shaft collar, about ${f2(od)}" OD × ${f2(len)}" wide, stainless or zinc-plated)` },
        joints: [{ type: 'pin', to: 'brake-shaft', count: 1, size: `${p.brakeRollPinDiameterIn}" heavy-duty roll pin`, note: 'cross-drilled with the shaft (drill press); the collar clamp or set screw only locates it' }],
        notes: 'Bought collar, no lathe or broach: the arm bolts to the tapped face and a roll pin through collar and shaft carries the torque (build review M10).',
      });
    };
    add1(arm('in')); add1(arm('out')); add1(hub('in')); add1(hub('out'));
    // Pin through both arms and the pad.
    const [pi0, pi1] = yRange(sgn, Y.armIn[0], Y.armOut[1]);
    add1(cylY(ctx, {
      id: `brake-shoe-pin-${tag}`, partNo: 'brake-shoe-pin', name: `Shoe pivot pin ${tag}`, c: pose.E, y0: pi0, y1: pi1, radius: p.brakeShoePinDiameterIn / 2,
      fab: 'drill-tap', explode: [0.2, sgn, 0.2], material: '1/2" 316 stainless rod', sourcing: { vendor: 'McMaster-Carr (1/2" 316 stainless rod, cut on the bandsaw; two stainless cotter pins or hairpin clips)' },
      stock: bar(p, p.brakeShoePinDiameterIn, p.brakeShoePinDiameterIn, Math.abs(pi1 - pi0)),
      notes: 'Retained by two stainless cotter / hairpin clips with their ends turned in and capped. Lets the pad swivel so it follows the tread. Stainless: it sits in the mud and spray of the rear tire (build review S10).',
    }));
    const delta = shoeLengthIn(p) / (2 * r);
    const N = 8;
    // Purchased lined steel-backed shoe (D-56): a 1/8" steel back with the lining riveted on, radius-matched to the tread, with a pivot tab to the shoe pin.
    const lt = p.brakeLiningThickIn, bt = p.brakeShoeBackThickIn;
    const arcOutline: Vec2[] = [];
    for (let i = 0; i <= N; i++) { const a = g.beta - delta + (2 * delta * i) / N; arcOutline.push([-(r + lt + bt) * Math.cos(a), -(r + lt + bt) * Math.sin(a)]); }
    for (let i = N; i >= 0; i--) { const a = g.beta - delta + (2 * delta * i) / N; arcOutline.push([-r * Math.cos(a), -r * Math.sin(a)]); }
    const shiftL = sub(pose.E, g.E);
    const [qy0, qy1] = yRange(sgn, Y.pad[0], Y.pad[1]);
    const depthL = Y.pad[1] - Y.pad[0];
    const areaL = shoeLengthIn(p) * depthL;
    const atR = (rad: number): V2 => add([g.O[0] - rad * Math.cos(g.beta), g.O[1] - rad * Math.sin(g.beta)], shiftL);
    const cgL = atR(r + (lt + bt) / 2);
    add1(planarExtrusion(ctx, {
      id: `brake-shoe-${tag}`, partNo: 'brake-shoe', name: `Brake shoe ${tag} (lined, steel-backed)`, mat: 'fixed', kind: 'purchased',
      material: `${f2(bt)}" steel back + ${f2(lt)}" woven / molded lining, riveted`, outline: arcOutline, origin: [g.O[0] + shiftL[0], g.O[1] + shiftL[1]],
      yHi: Math.max(qy0, qy1), depth: depthL, massLb: areaL * (bt * STEEL_LB_PER_IN3 + lt * LINING_LB_PER_IN3) + 0.08, fab: 'buy',
      explode: [0.2, sgn, 0.2], cg: [cgL[0], (qy0 + qy1) / 2, cgL[1]],
      sourcing: { vendor: `Purchased lined steel-backed brake shoe (go-kart band / industrial shoe, ${f2(shoeLengthIn(p))}" × ${f2(depthL)}" lining on a ${f2(bt)}" back, radius-matched to the ${f2(2 * r)}" tire) with a ${f2(bt)}" pivot tab drilled for the ${p.brakeShoePinDiameterIn}" shoe pin. Part number to confirm (docs/phase3b-wsC-notes.md).` },
      joints: [{ type: 'pin', to: `brake-shoe-pin-${tag}`, count: 1, size: `${p.brakeShoePinDiameterIn}" pivot bore in the tab`, note: 'shoe swivels on the pin' }],
      notes: `Lined steel-backed shoe, ${f2(shoeLengthIn(p))}" long × ${f2(depthL)}" wide. Design μ ${f2(p.brakePadMu)} wet; ${f2(p.brakePadMuFouled)} mud-fouled (pass/fail). The steel back sheds spray, so the oak pad's splash shield is dropped. Test a lining sample on a wet tire first.`,
    }));
  }

  // ── Return spring (single torsion spring on the shaft, right side) ──
  {
    const [y0, y1] = yRange(-1, Y.block[1] + 0.1, Y.block[1] + 0.1 + 0.6);
    add1(fixed(cylY(ctx, {
      id: 'brake-return-spring', name: 'Brake return spring', c: g.S, y0, y1, radius: (D + 0.6) / 2, mat: 'fixed', kind: 'purchased', material: 'stainless torsion spring',
      massLb: RETURN_SPRING_MASS_LB, fab: 'buy', explode: [0, -1, -0.5], sourcing: { vendor: 'McMaster-Carr (302 stainless torsion spring, ¾" ID)' },
      notes: 'Coaxial with the shaft: one leg hooks the bearing flange, the other the shaft collar. Backs the shoes off the tread and returns the lever when the pawl is released.',
    })));
  }

  // ── Shaft end caps: the shaft ends sit at shin height beside the rear tire (eng review: sharp ends) ──
  for (const { s: sgn, tag } of SIDES) {
    const yEnd = sgn * Y.shaftHalf;
    const [c0, c1] = yRange(sgn, Y.shaftHalf - 0.1, Y.shaftHalf + END_CAP_LEN_IN - 0.1);
    add1(fixed(cylY(ctx, {
      id: `brake-shaft-cap-${tag}`, partNo: 'brake-shaft-cap', name: `Shaft end cap ${tag}`, c: g.S, y0: c0, y1: c1, radius: (D + 0.2) / 2, mat: 'fixed', kind: 'purchased',
      material: 'rubber / nylon dome end cap', massLb: END_CAP_MASS_LB, fab: 'buy', explode: [0, sgn, 0],
      sourcing: { vendor: `McMaster-Carr (${D}" ID rubber or nylon dome end cap, about 1/2" long)` },
      notes: `Covers the cut end of the cross shaft (y = ${f2(Math.abs(yEnd))}") so there is no sharp end at shin height.`,
    })));
  }

  // ── Lever side (left) ──
  const [lv0, lv1] = Y.lever;
  const leverTop = rot2(g.G, g.Q, pose.thetaL);
  const tailEnd: V2 = sub(pose.T, mul(rot2(g.e, [0, 0], pose.thetaL), barW / 2));
  // Lever: one straight oak bar; with a flared gunwale it is two bars, the lower one straight and the upper one leaning out above the
  // knee, parallel to the side web (a bent lever cut from a crooked blank). Basis: ex along the bar, ey ≈ +y, ez the thickness in the plane.
  {
    const yMid = lv0 + (lv1 - lv0) / 2;
    const leverFaceAt = (z: number) => Math.tan(g.lean) * Math.max(0, z - g.kneeZ);
    const lever3 = (id: string, name: string, a2: V2, b2: V2, extra: Partial<Parameters<typeof box>[1]>): Part => {
      const a: Vec3 = [a2[0], yMid + leverFaceAt(a2[1]), a2[1]];
      const bb: Vec3 = [b2[0], yMid + leverFaceAt(b2[1]), b2[1]];
      const d: Vec3 = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]];
      const len = Math.hypot(...d);
      const ex: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
      // ey = world +y made perpendicular to the bar (the across-width direction); ez = ex × ey (the thickness, in the plane of the pull).
      let ey: Vec3 = [-ex[1] * ex[0], 1 - ex[1] * ex[1], -ex[1] * ex[2]];
      const en = Math.hypot(...ey) || 1;
      ey = [ey[0] / en, ey[1] / en, ey[2] / en];
      const part = box(ctx, {
        id, name, group: 'brake', mat: 'oak', step: STEP.brake, grain: 'x', center: mid3(a, bb), size: [len, lv1 - lv0, p.brakeLeverThickIn], explode: [-1, 0.3, -0.3], ...extra,
      });
      part.transform = basis(ex, ey, mid3(a, bb));
      return part;
    };
    const joints: Joint[] = [
      { type: 'pin', to: 'brake-lever-pin', count: 1, size: `${p.brakePivotBoltDiameterIn}" pivot post through a bronze sleeve`, note: 'bore at the pivot; sleeve pressed in' },
      { type: 'bolt', to: 'brake-link-clevis-lever', count: 1, size: `${p.brakeClevisPinDiameterIn}" clevis pin`, note: 'tail bore, fork straddles the lever' },
      { type: 'bolt', to: 'brake-pawl-pin', count: 1, size: `${p.brakePawlPinDiameterIn}" shoulder screw into a threaded insert` },
    ];
    const notes = `Oak, grain along the lever. Pivots ${f2(g.tailIn)}" above its link pin${p.brakeLeverTailAuto ? ' (solved from the ratio target)' : ''}; grip ${f2(g.gripZ)}" above the ground, ${f2(p.brakeLeverGripBelowHandleIn)}" below the push-handle grip (D-38).`;
    const kneeIn = g.lean > 0 && tailEnd[1] < g.kneeZ && g.kneeZ < leverTop[1];
    if (!kneeIn) {
      add1(lever3('brake-lever', 'Brake lever', tailEnd, leverTop, { joints, notes }));
    } else {
      const t = (g.kneeZ - tailEnd[1]) / (leverTop[1] - tailEnd[1]);
      const knee: V2 = [tailEnd[0] + (leverTop[0] - tailEnd[0]) * t, g.kneeZ];
      add1(lever3('brake-lever', 'Brake lever (lower)', tailEnd, knee, { joints: joints.slice(0, 2), notes: `${notes} Flared gunwale: the lever is bent at the knee (D-38).` }));
      add1(lever3('brake-lever-upper', 'Brake lever (upper, leaning)', knee, leverTop, { joints: [joints[2], { type: 'glue', to: 'brake-lever', count: 1, size: 'one blank, bent at the knee', note: 'shown as two bars' }], notes: 'Leans out parallel to the flared side web so the grip clears the gunwale (D-38).' }));
    }
  }
  // Lever pivot (build r2 MUST-3, D-48): a 3/4" A36 post welded to the left bearing plate's ear (behind the rail end), thrust washers to stand the lever off
  // the hull by the finger-gap distance, the bronze lever sleeve, a washer and a cotter pin. No hole in the rail; a stout post because it is a cantilever.
  const spacerLen = Math.max(0.1, lv0 - Y.block[1]);
  const pivD = p.brakePivotBoltDiameterIn;
  const pinY1 = lv1 + 0.4;
  add1(fixed(cylY(ctx, {
    id: 'brake-lever-spacer', partNo: 'brake-lever-spacer', name: 'Lever pivot thrust washers', c: g.Q, y0: Y.block[1], y1: lv0, radius: (pivD + 0.5) / 2, mat: 'fixed', kind: 'purchased',
    material: '316 stainless thrust washers', massLb: (Math.PI / 4) * (((pivD + 0.5) ** 2) - (pivD + 0.03) ** 2) * spacerLen * 0.289, fab: 'buy', explode: [-1, 0.5, -0.3],
    sourcing: { vendor: `McMaster-Carr (316 stainless flat washers ${f2(pivD + 0.03)}" ID × ${f2(pivD + 0.5)}" OD, stacked to ${f2(spacerLen)}")` },
    notes: `Stand the lever ${f2(spacerLen)}" off the bearing plate's outer face so its inboard face is ${f2(lv0 - L.hwC - L.side)}" off the hull (outside the 3/16" to 1/2" finger band, D-38).`,
  })));
  const pin = cylY(ctx, {
    id: 'brake-lever-pin', partNo: 'brake-lever-pin', name: 'Lever pivot post', c: g.Q, y0: Y.block[1], y1: pinY1, radius: pivD / 2, mat: 'steel', kind: 'metal', material: 'A36 round bar, welded to the plate', fab: 'drill-tap', explode: [-1, 0.5, -0.3],
    stock: bar(p, pivD, pivD, Math.abs(pinY1 - Y.block[1]) + 0.25),
    sourcing: { vendor: `Local steel yard or McMaster-Carr (A36 or 1018 round bar ${f2(pivD)}", cut ${f2(Math.abs(pinY1 - Y.block[1]) + 0.25)}"; 1/8" cross-hole for a 316 cotter pin; welded to the bearing plate ear by the fab shop that cuts the plate: 3/16" fillet all round, then galvanized or zinc-rich primer and paint)` },
    joints: [{ type: 'pin', to: 'brake-bearing-plate-L', count: 1, size: '3/16" fillet weld all round (outsourced), square to the plate', at: [[0, 0, 0]] }],
    notes: `${f2(pivD)}" post, ${f2(Math.abs(pinY1 - Y.block[1]))}" proud of the plate: it is a cantilever carrying the lever pivot reaction (about 570 lbf at the 2× hold load, ${f2(spacerLen + (lv1 - lv0) / 2)}" from the plate), so it is a stout steel post, not a bolt (brake-lever checks its bending and weld). A cotter pin through a cross hole and a washer keep the lever on; cap the end with a rubber dome so no bare steel stands at hand height. ${STEEL_FINISH}`,
  });
  pin.joints![0].at = [localPoint(pin.transform, [g.Q[0], Y.block[1], g.Q[1]])];
  add1(fixed(pin));
  add1(fixed(cylY(ctx, {
    id: 'brake-lever-sleeve', name: 'Lever pivot sleeve', c: g.Q, y0: lv0, y1: lv1, radius: (pivD + 2 * PIVOT_SLEEVE_WALL_IN) / 2, mat: 'fixed', kind: 'purchased', material: 'oil-impregnated bronze sleeve',
    massLb: SLEEVE_MASS_LB * 2, fab: 'buy', explode: [-1, 0.5, -0.3], sourcing: { vendor: `McMaster-Carr (SAE 841 sleeve bearing, ${f2(pivD)}" ID × ${f2(pivD + 2 * PIVOT_SLEEVE_WALL_IN)}" OD × ${f2(lv1 - lv0)}" long)` },
  })));

  // Crank: a thick keyed plate (S → link pin), link rod and clevises.
  const planeY = Y.plane;
  const [cr0, cr1] = Y.crank;
  const crankW = Math.max(barW, D + 2 * CRANK_LIGAMENT_IN);
  add1(flatBar(ctx, {
    id: 'brake-crank', name: 'Brake crank (input)', a: g.S, b: pose.B, y: (cr0 + cr1) / 2, thickY: cr1 - cr0, widthPlane: crankW, mat: 'steel', fab: 'drill-tap', extendB: crankW / 2,
    sourcing: YARD(`A36 flat bar ${f2(cr1 - cr0)}" × ${f2(crankW)}", bandsaw and drill press`),
    joints: [
      { type: 'pin', to: 'brake-shaft', count: 2, size: `${p.brakeRollPinDiameterIn}" heavy-duty roll pins at 90°`, note: 'shaft bore drilled and reamed on the drill press, then cross-drilled with the shaft' },
      { type: 'pin', to: 'brake-link-clevis-crank', count: 1, size: `${p.brakeClevisPinDiameterIn}" clevis pin` },
    ],
    notes: `Cut from ${f2(cr1 - cr0)}" × ${f2(crankW)}" A36 bar on the bandsaw: the ${f2(D)}" shaft hole is drilled (step drill, then reamer) on the drill press, leaving ${f2(CRANK_LIGAMENT_IN)}" of ligament each side; two ${p.brakeRollPinDiameterIn}" roll pins at 90° through the boss and shaft carry the torque (no keyseat, build review M10). The ${p.brakeClevisPinDiameterIn}" pin hole is the link crank end. ${STEEL_FINISH}`, explode: [-1, 0.2, -0.3],
  }));
  {
    const a = pose.T, b = pose.B;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const len = norm(sub(b, a));
    const lrod = Math.max(0.2, len - CLEVIS_LEN_IN);
    add1(cylinder(ctx, {
      id: 'brake-link', name: 'Brake link rod', group: 'brake', mat: 'steel', step: STEP.brake, center: [(a[0] + b[0]) / 2, planeY, (a[1] + b[1]) / 2], axis: 'x', rot: { y: -ang },
      radius: p.brakeLinkRodDiameterIn / 2, length: lrod, fab: 'drill-tap', material: '316 stainless rod, 3/8-24 threaded each end', stock: bar(p, p.brakeLinkRodDiameterIn, p.brakeLinkRodDiameterIn, lrod),
      sourcing: { vendor: 'McMaster-Carr (3/8-24 316 stainless threaded rod, or 3/8" rod threaded with a die; cut on the bandsaw)' },
      joints: [
        { type: 'screw', to: 'brake-link-clevis-lever', count: 1, size: '3/8-24 thread, jam nut', note: 'length adjustment' },
        { type: 'screw', to: 'brake-link-clevis-crank', count: 1, size: '3/8-24 thread, jam nut' },
      ],
      notes: 'Both clevis ends thread on: turning them is the brake adjustment (wear take-up). Cut the rod 1/2" long and file the ends: the threads are inside the clevis shanks, no bare end shows.', explode: [-1, 0.2, -0.3],
    }));
    const ends: Array<[string, V2, V2, number]> = [
      ['brake-link-clevis-lever', a, b, 0],
      ['brake-link-clevis-crank', b, a, 0],
    ];
    for (const [id, c0, c1] of ends) {
      const dir = sub(c1, c0);
      const ln = Math.max(1e-6, norm(dir));
      const u: V2 = [dir[0] / ln, dir[1] / ln];
      const ctr = add(c0, mul(u, CLEVIS_LEN_IN / 2 - 0.15));
      const yHalf = id.endsWith('lever') ? Math.max((lv1 - lv0) / 2, 0.4) + CLEVIS_CHEEK_IN : (cr1 - cr0) / 2 + CLEVIS_CHEEK_IN;
      add1(box(ctx, {
        id, name: id.endsWith('lever') ? 'Clevis (lever end)' : 'Clevis (crank end)', group: 'brake', mat: 'fixed', kind: 'purchased', material: '316 stainless clevis rod end', massLb: CLEVIS_MASS_LB, fab: 'buy',
        step: STEP.brake, size: [CLEVIS_LEN_IN, 2 * yHalf, CLEVIS_Z_IN], center: [ctr[0], planeY, ctr[1]], rot: { y: -Math.atan2(u[1], u[0]) },
        sourcing: { vendor: 'McMaster-Carr (3/8-24 316 stainless clevis rod end with 5/16 pin and cotter)' }, explode: [-1, 0.2, -0.3],
      }));
    }
  }

  // ── Parking ratchet: toothed quadrant on the gunwale, spring pawl on the lever ──
  const rg = ratchetGeometry(p, g, L);
  let quadZ: [number, number] = [g.Q[1], g.Q[1]];
  {
    const outline: Vec2[] = [];
    const plateT = p.brakeRatchetPlateThickIn;
    const R = rg.rTooth, d = p.brakeRatchetToothDepthIn;
    const a0 = rg.a0, nt = rg.nTeeth, pa = rg.pitchAngle;
    const aEnd = a0 + nt * pa;
    // Outer rim, CCW: ramp up over 0.85 of the pitch then a radial drop (holding face).
    const rimPts: Vec2[] = [];
    for (let i = 0; i < nt; i++) {
      const aa = a0 + i * pa;
      rimPts.push([ (R - d) * Math.cos(aa), (R - d) * Math.sin(aa) ]);
      rimPts.push([ R * Math.cos(aa + 0.85 * pa), R * Math.sin(aa + 0.85 * pa) ]);
      rimPts.push([ R * Math.cos(aa + pa), R * Math.sin(aa + pa) ]);
    }
    rimPts.push([ (R - d) * Math.cos(aEnd), (R - d) * Math.sin(aEnd) ]);
    outline.push(...rimPts);
    const ri = rg.rInner;
    for (let i = 0; i <= 6; i++) { const aa = aEnd - ((aEnd - a0) * i) / 6; outline.push([ri * Math.cos(aa), ri * Math.sin(aa)]); }
    quadZ = [g.Q[1] + Math.min(...outline.map((q) => q[1])), g.Q[1] + Math.max(...outline.map((q) => q[1]))];
    // Hull side: the quadrant is flat against the gunwale at y = hullTop.
    add1(fixed(planarExtrusion(ctx, {
      id: 'brake-quadrant', name: 'Parking ratchet quadrant', mat: 'steel', outline, origin: g.Q, yHi: Y.quad[1], depth: plateT, fab: 'outsource',
      sourcing: { vendor: `Waterjet / laser cutting service (SendCutSend, OSH Cut or a local shop): ${f2(plateT)}" A36 plate cut from the DXF; teeth finished with a file` },
      explode: [-1, 0.5, 0.5],
      joints: [{ type: 'bolt', to: 'brake-quadrant-bracket', count: 2, size: '1/4-20 × 3/4 machine screws, tapped into the bracket', note: 'the plate swings behind the hull end, so it hangs from a bent bracket on the transom' }],
      notes: `Waterjet / laser-service-cut ${f2(plateT)}" A36 plate (outsourced: the shop's laser does not cut steel), ${nt} teeth at ${f2(p.brakeRatchetPitchIn)}" pitch on a ${f2(R)}" radius (${f2(p.brakeRatchetSpanDeg)}° span), ${f2(d)}" deep; teeth are filed square on the holding face. ${STEEL_FINISH} (Alternate: CNC'd hardwood with steel tooth inserts.)`,
    })));
  }
  {
    const zTopT = L.deckTop + L.sideH;
    const bz0 = Math.max(quadZ[0], zTopT - 2.5), bz1 = Math.min(quadZ[1], zTopT);
    const bY: [number, number] = [L.hwC - 1, Y.quad[1]];
    // Bracket bolts (build review r2 S2): stack = angle leg + transom (+ the corner backer where there is one); length = stack + washer + nut + two threads, rounded up.
    const hgB = handleGeometry(p, L);
    const backerY: [number, number] = [Math.max(0.5, hgB.yPost - hgB.socketY / 2 - 0.5), L.hwC];
    const zBr = (bz0 + Math.max(bz0 + 0.5, bz1)) / 2;
    const xBr = L.xRear - p.brakeRatchetPlateThickIn / 2;
    const bkBolt = (y: number) => {
      const inBacker = y >= backerY[0] && y <= backerY[1];
      const grip = p.brakeRatchetPlateThickIn + L.transom + (inBacker ? p.blockingThickIn : 0);
      return { y, inBacker, grip, len: boltLength(grip, 0.25, 1) };
    };
    const bA = bkBolt(L.hwC - 0.5), bB = bkBolt(Y.quad[1] - 0.6);
    const brCenter: Vec3 = [xBr, ((L.hwC - 1) + Y.quad[1]) / 2, zBr];
    const bracketBolts: Joint[] = [bA, bB].map((bb) => ({
      type: 'bolt' as const, to: 'transom-rear', count: 1, diaIn: 0.25,
      size: `1/4-20 × ${inchesText(bb.len)} 316 hex bolt (stack ${f2(bb.grip)}" = angle ${f2(p.brakeRatchetPlateThickIn)}" + transom ${f2(L.transom)}"${bb.inBacker ? ` + backer ${f2(p.blockingThickIn)}"` : ', no backer here'}), fender washer + nylock nut inside`,
      at: [[0, bb.y - brCenter[1], 0] as Vec3], note: bb.inBacker ? 'through the corner backer' : 'outboard of the corner backer: transom only',
    }));
    add1(fixed(box(ctx, {
      id: 'brake-quadrant-bracket', name: 'Ratchet bracket (cut angle)', group: 'brake', mat: 'steel', step: STEP.brake, fab: 'drill-tap',
      sourcing: YARD('A36 angle iron, 2" × 2" × 1/4", cut on the bandsaw with a metal blade and drilled'),
      ...span([L.xRear - p.brakeRatchetPlateThickIn, L.xRear], bY, [bz0, Math.max(bz0 + 0.5, bz1)]),
      joints: bracketBolts,
      notes: `Cut from 1/4" angle iron (a bought L, not bent: one leg against the outer face of the rear transom, the other carrying the toothed quadrant). The ratchet load presses it onto the transom. Sits where the rear transom backer goes (hull workstream): bolts pass through the backer. ${STEEL_FINISH}`,
      explode: [-1, 0.5, 0.5],
    })));
    const tip = rot2(rg.pawlTip, g.Q, pose.thetaL);
    const pv = rot2(rg.pawlPivot, g.Q, pose.thetaL);
    const yPawl = (Y.quad[0] + Y.quad[1]) / 2;
    add1(flatBar(ctx, {
      id: 'brake-pawl', name: 'Parking ratchet pawl', a: pv, b: tip, y: yPawl, thickY: p.brakeRatchetPlateThickIn, widthPlane: Math.min(barW, 0.75), mat: 'steel', fab: 'drill-tap',
      sourcing: YARD(`A36 flat bar ${f2(p.brakeRatchetPlateThickIn)}" × 3/4", bandsaw and drill press`),
      joints: [{ type: 'pin', to: 'brake-pawl-pin', count: 1, size: `${p.brakePawlPinDiameterIn}" shoulder screw, single shear` }],
      notes: 'Flat bar pawl on a shoulder screw in the lever; the spring keeps the tip in the teeth. The thumb tab at the pivot end lifts it to release the brake.', explode: [-1, 0.5, 0.5],
    }));
    // The lever leans out with a flared gunwale: its face at the pawl height.
    const leverFace = lv0 + Math.tan(g.lean) * Math.max(0, pv[1] - g.kneeZ);
    const [pp0, pp1] = [Y.quad[0], leverFace + (lv1 - lv0) / 2];
    add1(cylY(ctx, {
      id: 'brake-pawl-pin', name: 'Pawl pivot screw', c: pv, y0: pp0, y1: pp1, radius: p.brakePawlPinDiameterIn / 2, mat: 'fixed', kind: 'purchased', material: '316 stainless shoulder screw', massLb: 0.02, fab: 'buy', explode: [-1, 0.5, 0.5],
      sourcing: { vendor: 'McMaster-Carr (1/4" shoulder screw, 316 stainless, into a stainless threaded insert; acorn nut on the lever side)' },
    }));
    add1(cylY(ctx, {
      id: 'brake-pawl-spring', name: 'Pawl spring', c: add(pv, [0.25, -0.7]), y0: Y.quad[1], y1: Math.min(leverFace, Y.quad[1] + 0.24), radius: 0.15, mat: 'fixed', kind: 'purchased', material: 'torsion spring',
      massLb: PAWL_SPRING_MASS_LB, fab: 'buy', explode: [-1, 0.5, 0.5], sourcing: { vendor: 'McMaster-Carr (small 302 stainless torsion spring)' },
    }));
  }

  if (!movingOnly) parts.push(...buildHandle(ctx));
  return unitExplode(stockPass(ctx, parts));
}

/** Every bought or cut metal part carries stock dimensions (section × cut length) and a source, for the Phase 4 bar / plate list (build review M9). */
function stockPass(_ctx: Ctx, parts: Part[]): Part[] {
  for (const x of parts) {
    if (x.kind !== 'metal') continue;
    if (!x.stock) {
      const g = x.geometry;
      if (g.type === 'box') {
        const d = [...g.size].sort((a, b) => a - b);
        x.stock = { t: d[0], w: d[1], l: d[2] };
      } else if (g.type === 'cylinder') x.stock = { t: 2 * g.radius, w: 2 * g.radius, l: g.length };
    }
    if (!x.sourcing) x.sourcing = YARD(`${x.material}, cut on the bandsaw and drilled`);
  }
  return parts;
}

/** The exploded view needs unit directions. */
function unitExplode(parts: Part[]): Part[] {
  for (const x of parts) {
    if (!x.explode) continue;
    const n = Math.hypot(...x.explode);
    x.explode = n < 1e-9 ? [0, 0, 0] : [x.explode[0] / n, x.explode[1] / n, x.explode[2] / n];
  }
  return parts;
}

export const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

export function buildBrake(ctx: Ctx): Part[] {
  return buildBrakeAt(ctx, 0);
}

// ── Wooden-drum variant (D-13 alternative): drums on the live axle; band geometry deferred (Phase 3). ──
function buildDrumVariant(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const r = L.r;
  const ry = p.rearTrackIn / 2;
  const D = p.brakeShaftDiameterIn;
  for (const { s, tag } of SIDES) {
    const dia = p.wheelDiameterIn * p.brakeDrumDiameterFrac;
    parts.push(cylinder(ctx, {
      id: `brake-drum-${tag}`, partNo: 'brake-drum', name: `Brake drum ${tag}`, group: 'brake', mat: 'oak', step: STEP.brake,
      center: [0, s * (ry + p.tireWidthIn / 2 + p.brakeDrumWidthIn / 2), r], axis: 'y', radius: dia / 2, length: p.brakeDrumWidthIn,
      notes: 'Wooden drum on the live axle (D-13); band geometry is deferred (the analysis uses the target lever ratio for this variant).',
    }));
  }
  const sx = -(r + p.brakeShaftBehindTireIn);
  parts.push(cylinder(ctx, {
    id: 'brake-shaft', name: 'Brake cross shaft', group: 'brake', mat: 'steel', step: STEP.brake, center: [sx, 0, r], axis: 'y', radius: D / 2, length: p.rearTrackIn,
    notes: 'Pivots in the frame rails.',
  }));
  const leverY = L.hwC + L.side + L.flare + LEVER_HULL_GAP_IN + p.brakeLeverWidthIn / 2;
  const leverTop = p.rearHandleHeightIn - p.brakeLeverGripBelowHandleIn;
  const leverBot = r + D / 2;
  parts.push(box(ctx, {
    id: 'brake-lever', name: 'Brake lever', group: 'brake', mat: 'oak', step: STEP.brake, grain: 'z',
    ...span([sx - p.brakeLeverThickIn / 2, sx + p.brakeLeverThickIn / 2], [leverY - p.brakeLeverWidthIn / 2, leverY + p.brakeLeverWidthIn / 2], [leverBot, Math.max(leverBot + 1, leverTop)]),
    notes: `Drum variant: lever ratio ${p.brakeLeverRatio}:1 is the target, not drawn (D-13).`,
  }));
  parts.push(...buildHandle(ctx));
  return unitExplode(stockPass(ctx, parts));
}

// ── Rear push handle: steel-tube sockets on the transom, pinned oak uprights, crossbar (D-9, D-39) ──
export interface HandleGeom {
  zTop: number;
  zBot: number;
  /** Socket outside / inside along x and y. */
  socketX: number;
  socketY: number;
  postX: [number, number];
  /** Pin height, post foot and top heights. */
  zPin: number;
  zFoot: number;
  zPostTop: number;
  /** Lever arm from the socket mouth to the grip, and from the grip to the lower contact. */
  gripArm: number;
  yPost: number;
  xBar: number;
}

export function handleGeometry(p: Params, L: Layout): HandleGeom {
  const w = p.handleSocketWallIn;
  const zTop = L.deckTop + L.sideH;
  const zBot = zTop - p.handleSocketDepthIn;
  const xo = L.xRear;
  const slip = p.handleSocketSlipIn;
  const postX: [number, number] = [xo - w - slip - p.handlePostThickIn, xo - w - slip];
  const barZ = p.rearHandleHeightIn;
  return {
    zTop, zBot, socketX: p.handlePostThickIn + 2 * (w + slip), socketY: p.handlePostWidthIn + 2 * (w + slip), postX,
    zPin: zBot + Math.min(1, p.handleSocketDepthIn / 4), zFoot: zBot + 0.5, zPostTop: barZ - p.handleBarDiameterIn / 2,
    gripArm: barZ - zTop, yPost: L.hwC - p.handleUprightInsetIn, xBar: (postX[0] + postX[1]) / 2,
  };
}

function buildHandle(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const h = handleGeometry(p, L);
  const parts: Part[] = [];
  const w = p.handleSocketWallIn;
  const barZ = p.rearHandleHeightIn;
  // Hollow 6061 aluminum tube (plan item 5, −1.5 lb vs steel): wall area × length × density.
  const tubeLb = ((h.socketX * h.socketY - (h.socketX - 2 * w) * (h.socketY - 2 * w)) * p.handleSocketDepthIn / IN3_PER_FT3) * p.aluminumDensityPcf;
  const sockGrip = w + L.transom + p.blockingThickIn;
  const sockLen = boltLength(sockGrip, 0.25, 2);
  for (const { s, tag } of SIDES) {
    const y = s * h.yPost;
    parts.push(box(ctx, {
      id: `handle-socket-${tag}`, partNo: 'handle-socket', name: `Push handle socket ${tag}`, group: 'brake', mat: 'fixed', kind: 'metal', massLb: tubeLb, step: STEP.brake, fab: 'drill-tap',
      stock: { t: h.socketX, w: h.socketY, l: p.handleSocketDepthIn },
      ...span([L.xRear - h.socketX, L.xRear], [y - h.socketY / 2, y + h.socketY / 2], [h.zBot, h.zTop]),
      material: '6061-T6 aluminum rectangular tube, anodized',
      joints: [
        { type: 'bolt', to: 'transom-rear', count: 2, diaIn: 0.25, size: `1/4-20 × ${inchesText(sockLen)} 316 button-head cap screws (round holes: a carriage-bolt square neck will not seat in a 1/8" aluminum wall), nylon washer under the head, fender washer + nylock nut inside the backer`,
          at: [h.zBot + 1.2, h.zTop - 1.2].map((z): Vec3 => [h.socketX / 2 - w / 2, 0, z - (h.zBot + h.zTop) / 2]), note: `grip = socket wall ${f2(w)}" + transom ${f2(L.transom)}" + backer ${f2(p.blockingThickIn)}" = ${f2(sockGrip)}"; ${f2(sockLen)}" bolt: grip + 2 washers + nut + two threads` },
        { type: 'pin', to: `handle-post-${tag}`, count: 1, size: `${p.handlePinDiameterIn}" clevis pin through both walls and the post` },
      ],
      notes: `Aluminum 6061-T6 rectangular tube ${f2(h.socketX)} × ${f2(h.socketY)} × ${f2(p.handleSocketDepthIn)} (wall ${f2(w)}), cut on the bandsaw and drilled on the drill press; the 15/16" × 1-7/16" post is a slip fit (1/32" a side) in the 1.0" × 1.5" inside. Lighter than steel (about 0.4 lb vs 1.2 lb each, plan item 5). Anodized or epoxy-coated, and bedded in epoxy / sealant against the transom: bare aluminum corrodes against wet tannin oak. Stays on the cart when the handle is removed (D-9).`,
      sourcing: { vendor: `McMaster-Carr (6061-T6 aluminum rectangular tube, ${f2(h.socketX)}" × ${f2(h.socketY)}" outside, ${f2(w)}" wall)` }, explode: [-1, 0, 0.3],
    }));
    parts.push(box(ctx, {
      id: `handle-post-${tag}`, partNo: 'handle-post', name: `Push handle upright ${tag}`, group: 'removable', mat: 'oak', removable: true, step: STEP.brake, grain: 'z',
      ...span(h.postX, [y - p.handlePostWidthIn / 2, y + p.handlePostWidthIn / 2], [h.zFoot, h.zPostTop]),
      joints: [
        { type: 'pin', to: `handle-socket-${tag}`, count: 1, size: `${p.handlePinDiameterIn}" clevis pin, cross-bored ${f2(h.zPin - h.zBot)}" above the socket bottom` },
        { type: 'pin', to: 'handle-bar', count: 1, diaIn: 0.375, size: '3/8" × 2-1/4" 316 stainless rod (or an oak dowel) epoxied into a stopped 3/8" hole 1-1/2" deep in the post top and 3/4" deep in the bar underside', note: 'permanent: the posts and the bar come out of the sockets as one U' },
        { type: 'glue', to: 'handle-bar', count: 1, size: 'epoxy on the post top and the pin' },
      ],
      notes: `Planed ${f2(p.handlePostThickIn)}" × ${f2(p.handlePostWidthIn)}" from 1" × 1-1/2" stock so it slides in the socket (inside ${f2(h.socketX - 2 * w)}" × ${f2(h.socketY - 2 * w)}", build review r2 S7). Lifts straight out of the socket once the clevis pin is out (D-9); the crossbar is epoxied to the two uprights, so the handle comes off as ONE U (no wing nut inside the aluminum socket).`,
    }));
    parts.push(cylinder(ctx, {
      id: `handle-pin-${tag}`, partNo: 'handle-pin', name: `Push handle retaining pin ${tag}`, group: 'removable', mat: 'fixed', kind: 'purchased', material: 'clevis pin + lynch pin', massLb: 0.05,
      fab: 'buy', removable: true, step: STEP.brake, center: [h.xBar, y, h.zPin], axis: 'y', radius: p.handlePinDiameterIn / 2, length: h.socketY + 0.3,
      sourcing: { vendor: 'McMaster-Carr (clevis pin with lynch pin)' }, explode: [-1, s, 0.3],
    }));
  }
  // A real round bar (D-44): a 1-1/4" white-oak dowel, ends rounded over by the viewer's finish (it stood in as a square block before).
  const bar = cylinder(ctx, {
    id: 'handle-bar', name: 'Push handle crossbar', group: 'removable', mat: 'oak', removable: true, step: STEP.brake, axis: 'y',
    radius: p.handleBarDiameterIn / 2, length: 2 * (L.hwC + L.side), center: [h.xBar, 0, barZ],
    notes: `Round ${p.handleBarDiameterIn}" white-oak dowel (bought, no lathe), ends eased over; pinned and epoxied to the tops of the two uprights (build review r2 S7, D-44). Drill the two blind 3/8" holes in its underside with the dowel in a V-block.`,
    sourcing: { vendor: `McMaster-Carr or Rockler (${p.handleBarDiameterIn}" white-oak dowel rod, 36" length, cut to ${f2(2 * (L.hwC + L.side))}")` },
  });
  bar.grain = 'z'; // the cylinder's own axis (it lies along Y in the model)
  bar.joints = SIDES.map(({ s: sg, tag }) => ({ type: 'pin' as const, to: `handle-post-${tag}`, count: 1, diaIn: 0.375, size: '3/8" × 2-1/4" 316 stainless rod epoxied, blind hole 3/4" deep in the bar', at: [localPoint(bar.transform, [h.xBar, sg * h.yPost, barZ - p.handleBarDiameterIn / 2 + 0.375])] }));
  parts.push(bar);
  return parts;
}

// Keep unused imports referenced for tree-shaking linters.
void compose; void (null as Vec2 | null);
