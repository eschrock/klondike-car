/**
 * Front brakes (Phase 3b WS-C, D-56): a lined tread shoe on a swing arm on each knuckle, driven by a Bowden cable from the main brake lever through a
 * bias bar and an equalizer. Plain TS, no three.js; `frontBrakeGeometry` is the one source for the kinematics, the part builder and the analysis.
 *
 * Mechanism (left side drawn, the right mirrors):
 *   main lever tail pin ── bias bar (splits the lever force between the rear link and the front cable) ── front cable (about 45 in, Bowden)
 *   ── equalizer under the nose deck (equal pull to both knuckles) ── two Bowden outers ── cable tail on the swing arm on the knuckle horn ── lined shoe.
 * The horn bolts to the spindle brake boss, so the whole brake (horn, arms, shoe) is on the `steer-L` / `steer-R` rigid body and steers with the wheel; the
 * Bowden housing loop at each knuckle takes the steering motion (`frontHousingLoop` in analysis/brake-ride.ts).
 *
 * Why a bias bar and why the shoe moves on an offset arm (the numbers are in docs/phase3b-wsC-notes.md):
 *   - One rigid lever driving two brakes shares the force by compliance (indeterminate). A balance bar on the lever tail pin makes the split a lever-arm ratio:
 *     with the bar arms `a_f` (front) and `B - a_f` (rear), the front branch gets the force fraction phi = 1 - a_f / B. a_f is solved so the front share of the
 *     total shoe normal force equals `frontBrakeBias`.
 *   - Work: hand force x grip travel = sum of N x shoe stroke. With the same stroke at all four shoes the front brake does NOT cut the hand force needed to hold; it
 *     adds braking capacity at the ground (two more tires) and parking margin. The cable arm on the swing arm (c_f) is solved so the front cable stroke equals the
 *     rear link stroke, which keeps the bar level.
 *   - The swing arm is offset from the tread tangent by the same friction-line ratio rho = |Kt / Kn| as the rear arm, so the front/rear bias does not change with
 *     the rolling direction or with the pad friction.
 */
import type { Params } from '../params';
import { solveSteer } from './ackermann';
import { STEP, box, cylinder, segment, SIDES, type Ctx } from './build-utils';
import { brakeGeometry, bar, cylY, f2, flatBar, planarExtrusion, frontShoeAngleDeg, frontShoeLengthIn, shoeWidthIn, type BrakeGeom, type V2 } from './brake';
import type { Layout } from './layout';
import type { Part, Vec2, Vec3 } from './types';

const RAD = Math.PI / 180;
const STEEL_LB_PER_IN3 = 0.2836;
const LINING_LB_PER_IN3 = 0.07;
/** Cable mass per inch per square inch of nominal area (3/16 in 7x19 stainless is about 0.005 lb/in) and spiral-wound housing per inch: placeholders for purchased item mass. */
const CABLE_LB_PER_IN_PER_SQIN = 0.14;
const HOUSING_LB_PER_IN = 0.004;
/** Horn plate thickness and the pivot spacer between the horn and the arm clevis (the horn must stay inboard of the tire). */
export const HORN_T_IN = 0.25;
/** The equalizer's x from the aft end of the center linkage corridor (in). */
export const EQ_BEHIND_CORRIDOR_IN = 2;
/** Air the horn keeps from the bracket's bounding square at every steer angle: the front-brake sweep's 0.25" hull clearance plus a little (brake-front row). */
export const HORN_BRACKET_AIR_IN = 0.1;
const ARM_GAP_IN = 0.05;
/** Horn plate depth (vertical) and the yoke: the crossbar ahead of the tire front ties the outboard plate to the horn so the pivot pin is supported at both ends. */
export const HORN_H_IN = 1.5;
export const YOKE_X_IN = 1.0;
export const YOKE_T_IN = 0.25;
/** The equalizer plate: lateral half-length and thickness. */
const EQ_HALF_IN = 2;
const EQ_T_IN = 0.125;

const sub2 = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const add2 = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const mul2 = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const cross2 = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
const norm2 = (a: V2) => Math.hypot(a[0], a[1]);
const dot2 = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const rot2 = (p: V2, c: V2, th: number): V2 => {
  const x = p[0] - c[0], z = p[1] - c[1], co = Math.cos(th), si = Math.sin(th);
  return [c[0] + x * co - z * si, c[1] + x * si + z * co];
};

export interface DirPair { fwd: number; rev: number }

export interface FrontBrakeGeom {
  /** True when the front tread brakes can be built (the rear linkage closes, so the lever and bias bar are defined). */
  on: boolean;
  why: string;
  r: number;
  /** Wheel center (x, z) at neutral and the |y| of the wheel center plane. */
  O: V2;
  yWheel: number;
  /** Shoe position below the axle line (rad), outward normal of the tread at the shoe, friction direction rolling forward, tread tangent (up the tire). */
  beta: number;
  n: V2;
  tFwd: V2;
  tan: V2;
  /** Pin standoff radius, pin at the applied pose (shoe on the tread), tread contact point, pin released, swing pivot. */
  pinR: number;
  E: V2;
  C: V2;
  Erel: V2;
  S: V2;
  /** Arm vector pivot to pin (applied), its length, and the moment arms of the shoe force about the pivot (normal, friction), then per rolling direction. */
  arm: V2;
  armLen: number;
  Kn: number;
  Kt: number;
  kFwd: number;
  kRev: number;
  /** Friction-line ratio |Kt/Kn| copied from the rear arm, and the offset it gives (in). */
  rho: number;
  offsetIn: number;
  /** Shoe stroke and the swing angle it needs (signed, CCW +, rad). */
  stroke: number;
  thetaF: number;
  /** Cable tail: arm from the pivot (solved so the cable stroke equals the rear link stroke), the tail point, the unit pull direction at the tail. */
  tailIn: number;
  tail: V2;
  /** Tail point at the released pose (the drawn pose). */
  tailRel: V2;
  pull: V2;
  /** Rear link stroke at the lever tail pin (in), the stroke the front cable must match. */
  linkStrokeIn: number;
  /** Bias bar: length, the front arm a_f (the "takeoff arm") and the front force fraction phi = 1 - a_f / B. */
  barIn: number;
  aF: number;
  phi: number;
  /** Branch ratios N_total / F_hand if that branch took the whole lever moment, per rolling direction (hand force horizontal at the grip, no efficiency). */
  Rr: DirPair;
  Rf: DirPair;
  /** Resulting total ratio N_total / F_hand and the front share of the total shoe normal force. */
  Rtot: DirPair;
  bias: DirPair;
  /** Shoe and arm y ranges (|y|, left side; mirror for the right). */
  y: { pad: [number, number]; armIn: [number, number]; armOut: [number, number]; horn: [number, number]; pivotPin: [number, number] };
  shoeLen: number;
  shoeW: number;
  /** Neutral positions (x, |y|, z): horn root at the spindle boss, hull exit grommet, and the equalizer. */
  hornRoot: Vec3;
  exit: Vec3;
  equalizer: Vec3;
}

const emptyDir = (v = 0): DirPair => ({ fwd: v, rev: v });

/** Front share of the total shoe normal force when the front branch gets the force fraction `phi`. */
export const biasFromPhi = (phi: number, Rr: number, Rf: number): number => {
  const nf = phi * Rf, nr = (1 - phi) * Rr;
  return nf + nr > 0 ? nf / (nf + nr) : 0;
};

/** The force fraction `phi` that gives the front share `b` (closed form for one rolling direction). */
export const phiForBias = (b: number, Rr: number, Rf: number): number => (b * Rr) / (b * Rr + (1 - b) * Rf);

/** Outer half width of the straight nose (in): the least inner |y| of the left tire sweep minus the steering clearance (spec 3.1, D-52), from the Ackermann solution. */
export function noseOuterHalf(p: Params, L: Layout): number {
  const a = L.front.ack, r = L.r, hw = p.tireWidthIn / 2;
  let minY = Infinity;
  const lock = a.towLockInnerDeg;
  for (let d = -lock; d <= lock + 1e-9; d += 1) {
    const th = (solveSteer(a, d).leftDeg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    for (const [dx, dy] of [[-r, -hw], [r, -hw], [-r, hw], [r, hw]]) {
      const x = -a.lead + dx, y = a.scrub + dy;
      minY = Math.min(minY, a.kpHalf + s * x + c * y);
    }
  }
  return Math.max(0.5, minY - p.steeringClearanceIn);
}

export function frontBrakeGeometry(p: Params, L: Layout, g: BrakeGeom = brakeGeometry(p, L)): FrontBrakeGeom {
  const r = L.r;
  const fl = L.front;
  const on = g.ok;
  const yWheel = Math.abs(fl.stub.L[1]);
  const O: V2 = [L.WB, r];
  const beta = frontShoeAngleDeg(p) * RAD;
  const n: V2 = [Math.cos(beta), -Math.sin(beta)];
  const tFwd: V2 = [-Math.sin(beta), -Math.cos(beta)];
  const tan: V2 = [Math.sin(beta), Math.cos(beta)];
  const pinR = r + p.brakeShoeThickIn / 2;
  const E = add2(O, mul2(n, pinR));
  const C = add2(O, mul2(n, r));
  const mu = p.brakePadMu;

  // Friction-line offset matched to the rear arm so the bias is the same rolling either way.
  const rho = Math.abs(g.Kn) > 1e-9 ? Math.abs(g.Kt / g.Kn) : 0;
  const alpha = p.frontBrakeArmLenIn;
  const gamma = rho * alpha;
  const arm: V2 = add2(mul2(tFwd, alpha), mul2(n, gamma));
  const S = sub2(E, arm);
  const Kn = cross2(arm, n);
  const Kt = cross2(arm, tFwd);
  const kFwd = Math.abs(Kn + mu * Kt);
  const kRev = Math.abs(Kn - mu * Kt);
  const stroke = p.frontShoeTravelIn;
  const thetaF = Math.abs(Kn) < 1e-9 ? 0 : -stroke / Kn;
  const Erel = rot2(E, S, -thetaF);

  // Rear link stroke at the lever tail pin, along the link.
  const uv = sub2(g.B1, g.T1);
  const ul = norm2(uv) || 1;
  const u: V2 = [uv[0] / ul, uv[1] / ul];
  const linkStrokeIn = Math.abs(dot2(sub2(g.T1, g.T0), u));

  // Cable tail: opposite the shoe through the pivot; stroke matched to the rear link.
  const tailIn = Math.abs(thetaF) > 1e-9 ? linkStrokeIn / Math.abs(thetaF) : 0;
  const tdir: V2 = [-arm[0] / norm2(arm), -arm[1] / norm2(arm)];
  const tail = add2(S, mul2(tdir, tailIn));
  const vt: V2 = [-tdir[1] * Math.sign(thetaF || 1), tdir[0] * Math.sign(thetaF || 1)];
  const pull = vt;

  // Branch ratios (hand force horizontal at the grip; both front shoes together).
  const lG = g.lGrip, dQ = g.dQ;
  const Rr: DirPair = { fwd: g.ratioFwd, rev: g.ratioRev };
  const Rf: DirPair = { fwd: dQ > 1e-9 && kFwd > 1e-9 ? (lG * tailIn) / (dQ * kFwd) : 0, rev: dQ > 1e-9 && kRev > 1e-9 ? (lG * tailIn) / (dQ * kRev) : 0 };
  const barIn = p.brakeBiasBarIn;
  // Solve phi for the target bias at the midpoint of the two rolling directions (they coincide when rho is matched).
  let lo = 0.001, hi = 0.999;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    const b = (biasFromPhi(m, Rr.fwd, Rf.fwd) + biasFromPhi(m, Rr.rev, Rf.rev)) / 2;
    if (b < p.frontBrakeBias) lo = m; else hi = m;
  }
  const phi = on ? (lo + hi) / 2 : 0;
  const aF = barIn * (1 - phi);
  const Rtot: DirPair = on
    ? { fwd: (1 - phi) * Rr.fwd + phi * Rf.fwd, rev: (1 - phi) * Rr.rev + phi * Rf.rev }
    : { fwd: Rr.fwd, rev: Rr.rev };
  const bias: DirPair = on ? { fwd: biasFromPhi(phi, Rr.fwd, Rf.fwd), rev: biasFromPhi(phi, Rr.rev, Rf.rev) } : emptyDir(0);

  // y layout: shoe centered on the tread, two arms straddling it, the horn inboard of the tire inner face, a spacer sleeve on the pivot pin between.
  const barT = p.brakeBarThickIn;
  const shoeLen = frontShoeLengthIn(p);
  const shoeW = Math.max(0.5, Math.min(shoeWidthIn(p), p.tireWidthIn - 2 * 0.6 * barT));
  const pad: [number, number] = [yWheel - shoeW / 2, yWheel + shoeW / 2];
  const armIn: [number, number] = [pad[0] - 0.02 - barT, pad[0] - 0.02];
  const armOut: [number, number] = [pad[1] + 0.02, pad[1] + 0.02 + barT];
  const tireIn = yWheel - p.tireWidthIn / 2;
  const hornOut = Math.min(armIn[0] - ARM_GAP_IN, tireIn - 0.15);
  const horn: [number, number] = [hornOut - HORN_T_IN, hornOut];
  const pivotPin: [number, number] = [horn[0], armOut[1]];

  // The horn root stands off the kingpin axis by more than the corner of the bracket C-channel's bounding square (leaf radius x sqrt 2) plus half the horn thickness, so the
  // horn clears the bracket box (the leaves are round discs inside it) at every steer angle with air to spare (D-53/D-56 integration).
  // The horn is a slanted bar HORN_H_IN tall: its square root end pokes back (H/2) sin(slope) behind the root point, so the standoff grows with the slope (a short horn is steep).
  const hornBase = p.kingpinBracketLeafRadiusIn * Math.SQRT2 + HORN_T_IN / 2 + HORN_BRACKET_AIR_IN;
  const hornRootZ = r + p.spindleBossAboveStubIn;
  const hornEnd: V2 = [S[0] + YOKE_X_IN + 0.25, S[1]];
  let hornRootAhead = hornBase;
  for (let k = 0; k < 6; k++) hornRootAhead = hornBase + (HORN_H_IN / 2) * Math.abs(Math.sin(Math.atan2(hornEnd[1] - hornRootZ, hornEnd[0] - (fl.kp.L[0] + hornRootAhead))));
  const hornRoot: Vec3 = [fl.kp.L[0] + hornRootAhead, (horn[0] + horn[1]) / 2, hornRootZ];
  const exit: Vec3 = [fl.kp.L[0] - 2.5, noseOuterHalf(p, L) + 0.5, L.deckBot - p.railDepthIn / 2]; // out through the nose rail at its mid height (a rail hole, joinery.ts)
  // The equalizer rocker sits under the deck above the aft end of the linkage corridor (nothing in the corridor stands near the deck ahead of x0 + 5: the mode pin and tongue link
  // begin at x0 + 5.5), clear of the steering links and the mode pin at every steer angle.
  const equalizer: Vec3 = [fl.keepOut.center.x0 + EQ_BEHIND_CORRIDOR_IN, 0, fl.beam.top + 0.8];

  return {
    on, why: on ? '' : 'the rear linkage does not close',
    r, O, yWheel, beta, n, tFwd, tan, pinR, E, C, Erel, S, arm, armLen: norm2(arm), Kn, Kt, kFwd, kRev, rho, offsetIn: gamma, stroke, thetaF,
    tailIn, tail, tailRel: rot2(tail, S, -thetaF), pull, linkStrokeIn, barIn, aF, phi, Rr, Rf, Rtot, bias,
    y: { pad, armIn, armOut, horn, pivotPin }, shoeLen, shoeW, hornRoot, exit, equalizer,
  };
}

/**
 * Front share of the total shoe normal force (= of the ground brake force, equal pad friction), averaged over the two rolling directions; null when there is
 * no front tread brake (the rear linkage does not close). The sim splits its brake torque with this (`SpecOptions.frontBrakeShare`).
 */
export function frontBrakeShare(p: Params, L: Layout): number | null {
  const fg = frontBrakeGeometry(p, L);
  return fg.on ? (fg.bias.fwd + fg.bias.rev) / 2 : null;
}

/** Plan distance of a point from the kingpin axis is not needed here; the housing loop analysis uses these neutral points (knuckle frame). */
export function housingStop(fg: FrontBrakeGeom, sgn: 1 | -1): Vec3 {
  return [fg.S[0] - 0.5, sgn * (fg.y.horn[0] + fg.y.horn[1]) / 2, fg.S[1] + 0.6];
}

/**
 * Chassis end of the exposed housing loop: on the kingpin axis, 1/2 in above the upper bracket leaf. A housing end on the axis keeps the chord to the
 * knuckle's housing stop constant over the whole steering sweep (the cable only twists), so the loop never has to take up slack.
 */
export function housingAnchor(L: Layout, sgn: 1 | -1): Vec3 {
  const k = sgn > 0 ? L.front.kp.L : L.front.kp.R;
  return [k[0], k[1], L.front.bracket.L.upperLeaf.z1 + 0.5];
}

const cableMassLb = (dia: number, len: number) => CABLE_LB_PER_IN_PER_SQIN * dia * dia * len + HOUSING_LB_PER_IN * len;

/** Cable/housing run lengths (in): the main run lever -> equalizer, and one outer equalizer -> knuckle (with the loop slack). */
export function frontRunLengths(fg: FrontBrakeGeom, g: BrakeGeom, L: Layout): { main: number; outer: number } {
  const lead = g.T0;
  const dx = fg.equalizer[0] - lead[0];
  const dy = Math.abs(g.y.plane);
  const dz = Math.abs(fg.equalizer[2] - lead[1]);
  const main = Math.hypot(dx, dy, dz) * 1.08;
  const stop = housingStop(fg, 1), anchor = housingAnchor(L, 1);
  const loop = Math.hypot(stop[0] - anchor[0], stop[1] - anchor[1], stop[2] - anchor[2]) * 1.15;
  const outer = (Math.hypot(anchor[0] - fg.equalizer[0], anchor[1] - fg.equalizer[1], anchor[2] - fg.equalizer[2]) + loop) * 1.05;
  return { main, outer };
}

/** Build the front brake parts (empty when the rear linkage does not close). */
export function buildFrontBrake(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const g = brakeGeometry(p, L);
  const fg = frontBrakeGeometry(p, L, g);
  if (!fg.on) return [];
  const parts: Part[] = [];
  const barT = p.brakeBarThickIn, barW = p.brakeBarWidthIn;
  const runs = frontRunLengths(fg, g, L);
  const yRange = (sgn: 1 | -1, a: number, b: number): [number, number] => (sgn > 0 ? [a, b] : [-b, -a]);
  const lt = p.brakeLiningThickIn, bt = p.brakeShoeBackThickIn;

  for (const { s: sgn, tag } of SIDES) {
    const body = sgn > 0 ? 'steer-L' as const : 'steer-R' as const;
    // Horn: a vertical plate on the spindle brake boss, reaching forward inboard of the tire to the swing pivot.
    {
      const [h0, h1] = yRange(sgn, fg.y.horn[0], fg.y.horn[1]);
      const hornA: V2 = [fg.hornRoot[0], fg.hornRoot[2]], hornB: V2 = [fg.S[0] + YOKE_X_IN + 0.25, fg.S[1]];
      const seg = segment([hornA[0], (h0 + h1) / 2, hornA[1]], [hornB[0], (h0 + h1) / 2, hornB[1]], HORN_T_IN, HORN_H_IN);
      parts.push({
        ...box(ctx, {
          id: `brake-front-horn-${tag}`, partNo: 'brake-front-horn', name: `Front brake horn ${tag}`, group: 'brake', mat: 'steel', step: STEP.brake, body, ...seg,
          fab: 'drill-tap', explode: [0.4, sgn, 0.2],
          notes: `${f2(HORN_T_IN)}" × 1-1/4" A36 bar bolted to the spindle brake boss (2 × 5/16" bolts), reaching forward INBOARD of the tire (the tire's inner face is ${f2(fg.yWheel - p.tireWidthIn / 2)}", the horn's outer face ${f2(Math.abs(fg.y.horn[1]))}") to the swing-arm pivot. Steers with the knuckle. The real spindle's brake boss geometry is a verify item.`,
          joints: [{ type: 'bolt', to: `spindle-${tag}`, count: 2, diaIn: 0.3125, note: 'to the spindle brake boss' }],
        }),
      });
    }
    // Yoke: a crossbar ahead of the tire front and an outboard plate, so the pivot pin is carried at both ends (a cantilevered pin would see 70 ksi).
    {
      const yOutPlate = fg.y.armOut[1] + 0.13;
      const [c0, c1] = yRange(sgn, fg.y.horn[0], yOutPlate + YOKE_T_IN);
      parts.push({
        ...box(ctx, {
          id: `brake-shoe-yoke-F${tag}`, partNo: 'brake-shoe-yoke-F', name: `Front brake yoke crossbar ${tag}`, group: 'brake', mat: 'steel', step: STEP.brake, body, fab: 'drill-tap',
          center: [fg.S[0] + YOKE_X_IN, (c0 + c1) / 2, fg.S[1]], size: [YOKE_T_IN, Math.abs(c1 - c0), HORN_H_IN], explode: [0.5, sgn, 0.2],
          notes: `${f2(YOKE_T_IN)}" × ${f2(HORN_H_IN)}" A36 bar across the FRONT of the tire (clear of the tread), bolted to the horn end and to the outboard plate; it makes the swing-arm pivot a pin supported at both ends.`,
        }),
      });
      const [o0, o1] = yRange(sgn, yOutPlate, yOutPlate + YOKE_T_IN);
      parts.push({
        ...box(ctx, {
          id: `brake-shoe-yokeplate-F${tag}`, partNo: 'brake-shoe-yokeplate-F', name: `Front brake yoke outboard plate ${tag}`, group: 'brake', mat: 'steel', step: STEP.brake, body, fab: 'drill-tap',
          center: [fg.S[0] + (YOKE_X_IN - 0.4) / 2, (o0 + o1) / 2, fg.S[1]], size: [YOKE_X_IN + 0.4 + YOKE_T_IN, YOKE_T_IN, 1.0], explode: [0.5, sgn, 0.2],
          notes: 'Outboard end of the yoke: carries the pivot pin; its edge stays clear of the tread.',
        }),
      });
    }
    // Swing arms: two flat bars, one each side of the shoe, from the pivot through the shoe pin to the cable tail.
    for (const which of ['in', 'out'] as const) {
      const rng = which === 'in' ? fg.y.armIn : fg.y.armOut;
      const [a0, a1] = yRange(sgn, rng[0], rng[1]);
      const yMid = (a0 + a1) / 2;
      parts.push(flatBar(ctx, {
        id: `brake-shoe-arm-F${tag}-${which}`, partNo: 'brake-shoe-arm-F', name: `Front shoe arm ${tag} ${which === 'in' ? 'inboard' : 'outboard'}`, a: fg.tailRel, b: fg.Erel,
        y: yMid, thickY: barT, widthPlane: barW, mat: 'steel', fab: 'drill-tap', explode: [0.3, sgn, 0.3], extendB: 0.25,
        notes: `${f2(barT)}" × ${f2(barW)}" A36 flat bar, ${f2(fg.armLen)}" from the pivot to the shoe pin and ${f2(fg.tailIn)}" from the pivot to the cable lug. The pin sits ${f2(fg.offsetIn)}" off the tread tangent so the friction servo matches the rear arms (bias is the same rolling either way).`,
      }));
      parts[parts.length - 1].body = body;
    }
    // Pivot pin (through the horn and both arms, with a spacer sleeve between the horn and the inboard arm).
    {
      const [q0, q1] = yRange(sgn, fg.y.pivotPin[0], fg.y.pivotPin[1]);
      parts.push(cylY(ctx, {
        id: `brake-shoe-pivot-F${tag}`, partNo: 'brake-shoe-pivot-F', name: `Front swing-arm pivot pin ${tag}`, c: fg.S, y0: q0, y1: q1, radius: p.frontBrakePivotPinDiaIn / 2, mat: 'steel',
        fab: 'drill-tap', explode: [0.4, sgn, 0.3], material: '3/8" 316 stainless rod, cotter pins both ends', stock: bar(p, p.frontBrakePivotPinDiaIn, p.frontBrakePivotPinDiaIn, Math.abs(q1 - q0)),
        sourcing: { vendor: 'McMaster-Carr (3/8" 316 stainless rod, cut on the bandsaw; two stainless cotter pins; a bronze spacer sleeve between the horn and the inboard arm)' },
      }));
      parts[parts.length - 1].body = body;
    }
    // Shoe pin.
    {
      const [q0, q1] = yRange(sgn, fg.y.armIn[0], fg.y.armOut[1]);
      parts.push(cylY(ctx, {
        id: `brake-shoe-pin-F${tag}`, partNo: 'brake-shoe-pin-F', name: `Front shoe pivot pin ${tag}`, c: fg.Erel, y0: q0, y1: q1, radius: p.brakeShoePinDiameterIn / 2, mat: 'steel',
        fab: 'drill-tap', explode: [0.2, sgn, 0.2], material: '1/2" 316 stainless rod', stock: bar(p, p.brakeShoePinDiameterIn, p.brakeShoePinDiameterIn, Math.abs(q1 - q0)),
        sourcing: { vendor: 'McMaster-Carr (1/2" 316 stainless rod, cut on the bandsaw; two stainless cotter pins or hairpin clips)' },
        notes: 'Lets the shoe swivel so it follows the tread.',
      }));
      parts[parts.length - 1].body = body;
    }
    // Lined shoe on the FRONT of the tread (the tire's rear inner corner is the one that sweeps toward the hull).
    {
      const delta = fg.shoeLen / (2 * fg.r);
      const N = 8;
      const outline: Vec2[] = [];
      const rOut = fg.r + lt + bt, rIn = fg.r;
      for (let i = 0; i <= N; i++) { const a = -fg.beta - delta + (2 * delta * i) / N; outline.push([rOut * Math.cos(a), rOut * Math.sin(a)]); }
      for (let i = N; i >= 0; i--) { const a = -fg.beta - delta + (2 * delta * i) / N; outline.push([rIn * Math.cos(a), rIn * Math.sin(a)]); }
      const shift = sub2(fg.Erel, fg.E);
      const [s0, s1] = yRange(sgn, fg.y.pad[0], fg.y.pad[1]);
      const depth = fg.y.pad[1] - fg.y.pad[0];
      const area = fg.shoeLen * depth;
      const cgR = fg.r + (lt + bt) / 2;
      const cg: V2 = [fg.O[0] + cgR * Math.cos(-fg.beta) + shift[0], fg.O[1] + cgR * Math.sin(-fg.beta) + shift[1]];
      const sh = planarExtrusion(ctx, {
        id: `brake-shoe-F${tag}`, partNo: 'brake-shoe', name: `Front brake shoe ${tag} (lined, steel-backed)`, mat: 'fixed',
        kind: 'purchased', outline, origin: add2(fg.O, shift), yHi: Math.max(s0, s1), depth,
        massLb: area * (bt * STEEL_LB_PER_IN3 + lt * LINING_LB_PER_IN3) + 0.08, fab: 'buy',
        material: `${f2(bt)}" steel back + ${f2(lt)}" woven / molded lining, riveted`, explode: [0.3, sgn, 0.3], cg: [cg[0], (s0 + s1) / 2, cg[1]],
        sourcing: { vendor: `Same purchased lined steel-backed shoe as the rear (${f2(fg.shoeLen)}" × ${f2(depth)}"), radius-matched to the tire, pivot tab drilled for the shoe pin. Part number to confirm.` },
        joints: [{ type: 'pin', to: `brake-shoe-pin-F${tag}`, count: 1, size: `${p.brakeShoePinDiameterIn}" pivot bore in the tab`, note: 'shoe swivels on the pin' }],
        notes: `Front shoe, ${f2(frontShoeAngleDeg(p))}° below the axle line on the FRONT of the tread (mirror of the rear placement). Rides on the knuckle, so it keeps its gap to the tire over the whole steering sweep.`,
      });
      sh.body = body;
      parts.push(sh);
    }
    // Exposed cable loop: from the arm tail out to the hull exit grommet (the housing loop at the knuckle).
    {
      const stop = housingStop(fg, sgn);
      const exit: Vec3 = housingAnchor(L, sgn);
      const dia = p.frontBrakeCableDiaIn;
      const dx = exit[0] - stop[0], dy = exit[1] - stop[1], dz = exit[2] - stop[2];
      const len = Math.hypot(dx, dy, dz);
      const c = cylinder(ctx, {
        id: `brake-front-cable-${tag}`, partNo: 'brake-front-cable', name: `Front brake cable ${tag} (housing loop to the kingpin axis)`, group: 'brake', mat: 'fixed', kind: 'purchased',
        material: `7x19 stainless cable ${f2(dia)}" in a spiral-wound Bowden housing`, massLb: cableMassLb(dia, runs.outer), step: STEP.brake, body,
        center: [(stop[0] + exit[0]) / 2, (stop[1] + exit[1]) / 2, (stop[2] + exit[2]) / 2], axis: 'x', rot: { z: Math.atan2(dy, dx), y: -Math.asin(dz / Math.max(1e-9, len)) },
        radius: 0.14, length: len, fab: 'buy', explode: [0.3, sgn, 0.3],
        sourcing: { vendor: `McMaster-Carr or a cycle / motorcycle cable shop (${f2(dia)}" 7x19 stainless cable, swaged lug at the arm tail, spiral-wound housing with a ferrule at the horn stop; about ${f2(runs.outer)}" run from the equalizer including the steering loop)` },
        notes: `Drawn as the chord from the horn stop to the housing clamp on the kingpin axis above the upper bracket leaf; with the clamp on the axis the chord is the same at every steer angle and the housing only twists (housing check in the brake-front row). About ${f2(runs.outer)}" of cable and housing in all; the rest is fixed and runs over the beam and under the nose deck to the equalizer.`,
      });
      parts.push(c);
    }
  }

  // Equalizer: a rocker plate under the nose deck; the main cable pulls its center, the two outers leave its ends.
  parts.push(box(ctx, {
    id: 'brake-front-equalizer', partNo: 'brake-front-equalizer', name: 'Front brake equalizer plate', group: 'brake', mat: 'steel', step: STEP.brake, fab: 'outsource',
    center: fg.equalizer, size: [1.25, 2 * EQ_HALF_IN, EQ_T_IN], explode: [0, 0, -1],
    notes: `${f2(EQ_T_IN)}" A36 rocker, ${f2(2 * EQ_HALF_IN)}" between the two outer cable ferrules, pivoting on a 1/4" bolt through a bracket on the nose deck underside. Equal pull to both knuckles; the plate tilts to take up the difference between the two sides (brake-steer from a left/right imbalance is a report row).`,
  }));
  // Bias bar on the main lever tail pin.
  {
    const lead = g.T0;
    const aF = fg.aF, aR = fg.barIn - fg.aF;
    parts.push(box(ctx, {
      id: 'brake-bias-bar', partNo: 'brake-bias-bar', name: 'Brake bias bar (balance bar on the lever tail pin)', group: 'brake', mat: 'steel', step: STEP.brake, fab: 'outsource',
      center: [lead[0] + (aF - aR) / 2, g.y.plane, lead[1]], size: [fg.barIn + 0.5, 0.125, 0.75], explode: [-1, 0.3, -0.3],
      notes: `Balance bar pinned to the main lever tail pin: ${f2(aR)}" to the rear-link clevis and ${f2(aF)}" (the takeoff arm a_f) to the front-cable lug, so the front branch takes ${f2(fg.phi * 100)}% of the lever force and the front shoes carry ${f2(fg.bias.fwd * 100)}% (forward) / ${f2(fg.bias.rev * 100)}% (reverse) of the total shoe normal force. Solved by frontBrakeGeometry; moving the front lug 1/4" changes the share by about 4 points. Test the split with two scales on the mock-up.`,
    }));
  }
  // Main cable run lever -> equalizer: hidden under the deck, drawn as the exposed 4" at the bar.
  {
    const dia = p.frontBrakeCableDiaIn;
    const lead = g.T0;
    parts.push(cylinder(ctx, {
      id: 'brake-front-cable-main', partNo: 'brake-front-cable-main', name: 'Front brake main cable (lever to equalizer)', group: 'brake', mat: 'fixed', kind: 'purchased',
      material: `7x19 stainless cable ${f2(dia)}" in a spiral-wound Bowden housing`, massLb: cableMassLb(dia, runs.main), step: STEP.brake, center: [lead[0] + 3, g.y.plane + 0.4, lead[1] + 1.1],
      axis: 'x', radius: 0.14, length: 4, fab: 'buy', explode: [0.4, 0.3, -0.5],
      sourcing: { vendor: `McMaster-Carr or a cycle shop (${f2(dia)}" 7x19 stainless cable and housing, about ${f2(runs.main)}" run)` },
      notes: `About ${f2(runs.main)}" from the bias bar to the equalizer, run under the deck through 1/4" holes in the joists and the rear beam web (a joinery item for the frame owner) with P-clamps; drawn only as the exposed 4" at the bar so it does not collide with the hull model. Its stretch is in the brake-front row.`,
    }));
  }
  return parts;
}
