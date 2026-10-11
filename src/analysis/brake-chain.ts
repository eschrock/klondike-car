/**
 * Shared brake-chain numbers for the Phase 3b ride rows (WS-C, D-56): the lever -> shoe chain with the front brake and the hip lever, the axle
 * lockup limits on a slope, the stopping distance, and the shoe heat run. Plain functions, no checks; `brake-ride.ts` builds the rows.
 *
 * Conventions: forces in lbf, decelerations in g (positive = slowing), angles in radians, slopes nose-down. The brake force at the ground from one axle is
 * mu_pad x (that axle's total shoe normal force); with the same lining on all four shoes the front share of the ground brake force equals the front share of the
 * total shoe normal force (`frontBrakeGeometry().bias`).
 */
import { brakeGeometry, frontShoeLengthIn, shoeLengthIn, shoeWidthIn, type BrakeGeom } from '../model/brake';
import { frontBrakeGeometry, frontRunLengths, type FrontBrakeGeom } from '../model/brake-front';
import { beltGeometry, hipControlGeometry, type BeltGeom, type HipControlGeom } from '../model/brake-controls';
import type { Params } from '../params';
import type { Ctx } from './context';
import { contactsAt } from './geometry';

export const FT_S2 = 32.174;
export const MPH_FT_S = 22 / 15;
const LBF_N = 4.4482216;
const IN2_M2 = 6.4516e-4;
const MPH_M_S = 0.44704;

export interface Chain {
  g: BrakeGeom;
  fg: FrontBrakeGeom;
  hg: HipControlGeom;
  bg: BeltGeom;
  frontOn: boolean;
  /** N_total / F_hand (no efficiency) per rolling direction, and the smaller of the two (the one to size hand force by). */
  Rtot: { fwd: number; rev: number };
  Rcrit: number;
  /** Front share of the total shoe normal force per direction (0 when there is no front brake). */
  bias: { fwd: number; rev: number };
  phi: number;
  eta: number;
  etaHip: number;
}

const cache = new WeakMap<Ctx, Chain>();
export function chainOf(ctx: Ctx): Chain {
  let c = cache.get(ctx);
  if (c) return c;
  const { p, L } = ctx;
  const g = brakeGeometry(p, L);
  const fg = frontBrakeGeometry(p, L, g);
  const hg = hipControlGeometry(p, L, g);
  const bg = beltGeometry(p, L);
  const frontOn = fg.on;
  const Rtot = frontOn ? fg.Rtot : { fwd: g.ratioFwd, rev: g.ratioRev };
  c = {
    g, fg, hg, bg, frontOn, Rtot, Rcrit: Math.min(Rtot.fwd, Rtot.rev), bias: frontOn ? fg.bias : { fwd: 0, rev: 0 },
    phi: frontOn ? fg.phi : 0, eta: p.brakeEfficiency, etaHip: p.hipCableEfficiency,
  };
  cache.set(ctx, c);
  return c;
}

/** Hand force at the hip grip for a given force at the main grip (geometric ratio and cable efficiency). */
export const hipFromMain = (ch: Chain, fMain: number): number => (fMain * ch.hg.hipPerMain) / ch.etaHip;
/** Inverse: main-grip equivalent of a hip grip force. */
export const mainFromHip = (ch: Chain, fHip: number): number => (fHip * ch.etaHip) / ch.hg.hipPerMain;

/** Main-grip force that produces total shoe normal force N (forward or reverse rolling). */
export const mainForceForN = (ch: Chain, N: number, dir: 'fwd' | 'rev' | 'crit' = 'crit'): number => N / ((dir === 'crit' ? ch.Rcrit : ch.Rtot[dir]) * ch.eta);

/** Rear-axle and front-axle normal loads (lbf) at deceleration `aG` (g) on a slope: N_f = W [x cos + (sin + a) h] / L (derivation in docs/phase3b-wsC-notes.md). */
export function axleNormals(W: number, x: number, h: number, wheelbase: number, theta: number, aG: number): { Nf: number; Nr: number } {
  const Nf = (W * (x * Math.cos(theta) + (Math.sin(theta) + aG) * h)) / wheelbase;
  return { Nf, Nr: W * Math.cos(theta) - Nf };
}

export interface LockLimits {
  /** Deceleration (g) at which the front / rear axle reaches the tire-ground limit with the front share `b`. Infinity: that axle can never lock first. */
  aFront: number;
  aRear: number;
  aMax: number;
  frontFirst: boolean;
}

/**
 * Highest deceleration with fixed brake-force share `b` on the front axle before an axle slides, tire-ground friction `mu`, rolling resistance `crr`.
 * Brake force total F = W (a + sin - crr cos); front limit b F <= mu N_f, rear limit (1 - b) F <= mu N_r.
 */
export function lockLimits(x: number, h: number, wheelbase: number, theta: number, b: number, mu: number, crr: number): LockLimits {
  const s = Math.sin(theta), c = crr * Math.cos(theta), co = Math.cos(theta), L = wheelbase;
  const denF = b - (mu * h) / L;
  const aFront = denF > 1e-12 ? ((mu * (x * co + s * h)) / L - b * (s - c)) / denF : Infinity;
  const denR = 1 - b + (mu * h) / L;
  const aRear = ((mu * ((L - x) * co - s * h)) / L - (1 - b) * (s - c)) / denR;
  const aMax = Math.min(aFront, aRear);
  return { aFront, aRear, aMax, frontFirst: aFront <= aRear };
}

/** Mean front contact x at neutral (the wheelbase used for the load transfer). */
export const wheelbaseOf = (ctx: Ctx): number => {
  const ct = contactsAt(ctx.contact, 0);
  return (ct.FL[0] + ct.FR[0]) / 2;
};

export interface StopResult {
  totalFt: number;
  reactionFt: number;
  brakeFt: number;
  v1MphAtBrake: number;
  aDecG: number;
}

/** Stop from `v0Mph` on a slope: `reactS` of free acceleration, then deceleration `aDecG` (g) with the slope already included. */
export function stopDistance(v0Mph: number, theta: number, crr: number, reactS: number, aDecG: number): StopResult {
  const v0 = v0Mph * MPH_FT_S;
  const aRoll = FT_S2 * (Math.sin(theta) - crr * Math.cos(theta));
  const reactionFt = v0 * reactS + 0.5 * aRoll * reactS * reactS;
  const v1 = Math.max(0, v0 + aRoll * reactS);
  const brakeFt = aDecG > 1e-9 ? (v1 * v1) / (2 * aDecG * FT_S2) : Infinity;
  return { totalFt: reactionFt + brakeFt, reactionFt, brakeFt, v1MphAtBrake: v1 / MPH_FT_S, aDecG };
}

export interface HeatResult {
  /** Continuous-braking distance (ft) to the surface temperature rise limit; Infinity when the slope needs no brake power. */
  runFt: number;
  timeS: number;
  /** Heat flux into the hottest shoe (W/m2) and its power (W). */
  qWm2: number;
  shoeW: number;
  partition: number;
  effusivity: number;
  areaIn2: number;
}

/** Surface temperature rise dT = 2 q sqrt(t) / (sqrt(pi) e) for a constant flux; the time and distance to `brakeHeatLimitK` at the ride speed. */
export function heatRun(p: Params, ch: Chain, W: number, theta: number, speedMph = p.rideSpeedMph, shoe: 'lined' | 'oak' = 'lined'): HeatResult {
  const v = speedMph * MPH_M_S;
  const lined = shoe === 'lined';
  const partition = lined ? p.brakeHeatPartitionLined : p.brakeHeatPartitionOak;
  const e = lined ? p.brakeEffusivityLined : p.brakeEffusivityOak;
  const padW = Math.max(0.5, Math.min(lined ? shoeWidthIn(p) : p.brakeShoeWidthIn, p.tireWidthIn - 2 * 0.6 * p.brakeBarThickIn));
  const power = W * LBF_N * v * (Math.sin(theta) - p.brakeRollingCrr * Math.cos(theta));
  const areaRear = (lined ? shoeLengthIn(p) : p.brakeShoeLengthIn) * padW;
  const areaFront = ch.frontOn ? (lined ? frontShoeLengthIn(p) : p.brakeShoeLengthIn) * padW : 0;
  if (power <= 0) return { runFt: Infinity, timeS: Infinity, qWm2: 0, shoeW: 0, partition, effusivity: e, areaIn2: areaRear };
  // Flux into each axle's shoes (two per axle, equal split): the hotter of the front and the rear sets the run. Rear only: the two rear shoes.
  const bMin = ch.frontOn ? Math.min(ch.bias.fwd, ch.bias.rev) : 0, bMax = ch.frontOn ? Math.max(ch.bias.fwd, ch.bias.rev) : 0;
  const rearW = (power * (1 - bMin)) / 2, frontW = (power * bMax) / 2;
  const qRear = (partition * rearW) / (areaRear * IN2_M2 * p.brakeHeatContactFrac);
  const qFront = ch.frontOn ? (partition * frontW) / (areaFront * IN2_M2 * p.brakeHeatContactFrac) : 0;
  const q = Math.max(qRear, qFront);
  const shoeW = qRear >= qFront ? rearW : frontW;
  const areaIn2 = qRear >= qFront ? areaRear : areaFront;
  const t = ((p.brakeHeatLimitK * Math.sqrt(Math.PI) * e) / (2 * q)) ** 2;
  return { runFt: (v * t) / 0.3048, timeS: t, qWm2: q, shoeW, partition, effusivity: e, areaIn2 };
}

export interface Compliance {
  /** Cable tension at the bias bar (front branch, lbf) and at the hip cable. */
  Tc: number;
  Th: number;
  mainLenIn: number;
  outerLenIn: number;
  hipLenIn: number;
  frontStretchIn: number;
  hipStretchIn: number;
  /** Extra grip travel at the main grip (in) from the front cable stretch, and at the hip grip from the hip cable stretch. */
  extraGripMainIn: number;
  extraGripHipIn: number;
  /** Hip lug travel left over after the main lever link point stroke and the hip cable stretch (in; negative = the hip lever runs out of throw). */
  hipReserveIn: number;
}

/** Cable and housing stretch at a main-grip hold force `fMain` (the effective modulus lumps inner stretch and housing compression). */
export function cableCompliance(ctx: Ctx, ch: Chain, fMain: number): Compliance {
  const { p, L } = ctx;
  const g = ch.g;
  const E = p.bowdenEffModulusPsi;
  const aF = (Math.PI / 4) * p.frontBrakeCableDiaIn ** 2;
  const aH = (Math.PI / 4) * p.hipCableDiaIn ** 2;
  const runs = ch.frontOn ? frontRunLengths(ch.fg, g, L) : { main: 0, outer: 0 };
  const M = fMain * g.lGrip;
  const Tc = ch.frontOn ? (ch.phi * M) / Math.max(1e-6, g.dQ) : 0;
  const Th = M / Math.max(1e-6, ch.hg.linkAbove);
  const hipLen = ch.hg.insideIn + ch.hg.outsideIn + ch.hg.exposedIn;
  const frontStretch = ch.frontOn ? (Tc * runs.main + (Tc / 2) * runs.outer) / (E * aF) : 0;
  const hipStretch = (Th * hipLen) / (E * aH);
  return {
    Tc, Th, mainLenIn: runs.main, outerLenIn: runs.outer, hipLenIn: hipLen, frontStretchIn: frontStretch, hipStretchIn: hipStretch,
    extraGripMainIn: ch.frontOn ? ((ch.phi * frontStretch) / Math.max(1e-6, g.dQ)) * g.lGrip : 0,
    extraGripHipIn: (hipStretch / Math.max(1e-6, ch.hg.cableArmIn)) * ch.hg.armIn,
    hipReserveIn: ch.hg.lugTravelIn - ch.hg.linkTravelIn - hipStretch,
  };
}
