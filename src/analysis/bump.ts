/**
 * Bump load model (Phase 3b, D-50, spec section 5): the velocity-change pulse of one wheel meeting a step of height h at the bump speed, with the
 * pneumatic wheel's radial stiffness. It replaces `obstacleForce` / `strikeCases` (curb and root, H = V tan phi, x3) for the Ackermann front end.
 *
 *   sin(beta) = (r - h) / r           contact normal tilted beta above the horizontal; h capped at 0.9 r (a taller step is a wall)
 *   v_n       = v cos(beta)           normal-direction speed of the wheel centre
 *   m_e       = bumpMassShare x (static wheel load) / g
 *   F_n       = v_n sqrt(k m_e)       k = bumpWheelRateLbIn
 *   H = F_n cos(beta)   V = F_n sin(beta)       (H opposes the motion, V is up on the wheel)
 *
 * Two bases (D-50): NORMAL USE is the 1 inch bump with the full margins (steel yield / steelSafetyFactor, wood design MOR); a HARD HIT is the 2 inch
 * pothole or root, a fail-safe case (steel ultimate / failSafeFactor, wood MOR with no safety factor, wheel retention). The caveat on every row is
 * the wheel rate: `sensitivityText` prints the result at k x 0.5 and x 2.5.
 *
 * Plain TypeScript, no three.js.
 */
import type { Params } from '../params';
import type { Ctx } from './context';
import type { CaseData } from './loads';
import { wheelLoads } from './structure';

const G_IN_S2 = 386.1;
const IN_S_PER_MPH = 17.6;

export type BumpWheel = 'front' | 'rear';

export interface BumpStrike {
  hIn: number;
  /** h after the 0.9 r cap. */
  hEff: number;
  /** Contact normal angle above the horizontal (rad). */
  beta: number;
  /** Normal-direction speed (in/s). */
  vn: number;
  /** Effective mass (lb s2/in). */
  me: number;
  /** Static wheel load (lb) the pulse mass is based on. */
  staticLb: number;
  Fn: number;
  /** Horizontal component (opposes motion) and vertical component (up on the wheel), lbf. */
  H: number;
  V: number;
  /** Fn / static wheel load. */
  factor: number;
  kLbIn: number;
}

export interface PulseInput {
  rIn: number;
  hIn: number;
  vMph: number;
  staticLb: number;
  kLbIn: number;
  massShare: number;
}

/** The pulse itself, from plain numbers (the tests pin this against the hand arithmetic). */
export function bumpPulse(i: PulseInput): BumpStrike {
  const hEff = Math.max(0, Math.min(i.hIn, 0.9 * i.rIn));
  const sinB = (i.rIn - hEff) / i.rIn;
  const beta = Math.asin(Math.min(1, sinB));
  const v = i.vMph * IN_S_PER_MPH;
  const vn = v * Math.cos(beta);
  const me = (i.massShare * i.staticLb) / G_IN_S2;
  const Fn = vn * Math.sqrt(i.kLbIn * me);
  return { hIn: i.hIn, hEff, beta, vn, me, staticLb: i.staticLb, Fn, H: Fn * Math.cos(beta), V: Fn * Math.sin(beta), factor: i.staticLb > 0 ? Fn / i.staticLb : 0, kLbIn: i.kLbIn };
}

/** Static load of the heavier front or rear wheel in a load case (front: worse of level and nose-down on the design slope, M4). */
export function staticWheelLb(ctx: Ctx, c: CaseData, wheel: BumpWheel): number {
  const w = wheelLoads(ctx, c);
  return wheel === 'front' ? w.frontWheel : w.rearWheel;
}

/** `bumpStrike(ctx, caseData, wheel, hIn)` (spec 5.1). */
export function bumpStrike(ctx: Ctx, c: CaseData, wheel: BumpWheel, hIn: number, kScale = 1): BumpStrike {
  const { p, d } = ctx;
  return bumpPulse({ rIn: d.wheelRadiusIn, hIn, vMph: p.bumpSpeedMph, staticLb: staticWheelLb(ctx, c, wheel), kLbIn: p.bumpWheelRateLbIn * kScale, massShare: p.bumpMassShare });
}

export interface BumpCases {
  normal: BumpStrike;
  hard: BumpStrike;
}

export function bumpCases(ctx: Ctx, c: CaseData, wheel: BumpWheel): BumpCases {
  return { normal: bumpStrike(ctx, c, wheel, ctx.p.bumpNormalHeightIn), hard: bumpStrike(ctx, c, wheel, ctx.p.bumpHardHeightIn) };
}

/**
 * Seat / payload dynamic factor from the rear one-wheel normal bump (spec 5.4): bumpSeatG = 1 + V_rear / W_total. The rear strike governs the
 * seat (the rider is 32/44 of the way from the front axle, study section 6).
 */
export function bumpSeatG(ctx: Ctx, c: CaseData): number {
  const b = bumpStrike(ctx, c, 'rear', ctx.p.bumpNormalHeightIn);
  return 1 + b.V / c.massLb;
}

/** Hard-hit analogue of `bumpSeatG` (rear 2 inch hit) for the ultimate rider-restraint rows. */
export function bumpSeatGHard(ctx: Ctx, c: CaseData): number {
  const b = bumpStrike(ctx, c, 'rear', ctx.p.bumpHardHeightIn);
  return 1 + b.V / c.massLb;
}

/** The payload / seat dynamic factor for a load case: max(dynamicFactor, bumpSeatG) (spec 5.4: rails, deck, seat-back, seat-grip). */
export function seatFactor(ctx: Ctx, c: CaseData): number {
  return Math.max(ctx.p.dynamicFactor, bumpSeatG(ctx, c));
}

/** Peak vertical force on a struck wheel: the obstacle's V plus the static wheel load still on the tire (conservative; the spec rows quote V alone). */
export const peakVertical = (b: BumpStrike): number => b.V + b.staticLb;

/** One sentence for every bump row: the dominant uncertainty is the wheel rate (spec 5.1). */
export function sensitivityText(ctx: Ctx, c: CaseData, wheel: BumpWheel, hIn: number): string {
  const lo = bumpStrike(ctx, c, wheel, hIn, 0.5), mid = bumpStrike(ctx, c, wheel, hIn), hi = bumpStrike(ctx, c, wheel, hIn, 2.5);
  const k = ctx.p.bumpWheelRateLbIn;
  return `Wheel-rate sensitivity (${wheel} ${hIn}" bump, ${ctx.p.bumpSpeedMph} mph): F_n = ${lo.Fn.toFixed(0)} lbf at k ${(k * 0.5).toFixed(0)}, ${mid.Fn.toFixed(0)} at ${k.toFixed(0)}, ${hi.Fn.toFixed(0)} at ${(k * 2.5).toFixed(0)} lb/in (bench-test one wheel; Phase 4 gate).`;
}

/** The pulse as a sentence, for the `how` text of every bump row. */
export function bumpText(b: BumpStrike, label: string, p: Pick<Params, 'bumpSpeedMph' | 'bumpMassShare'>): string {
  return `${label}: step ${b.hIn.toFixed(2)}"${b.hEff < b.hIn ? ` (capped at ${b.hEff.toFixed(2)}")` : ''}, beta = ${(b.beta * 180 / Math.PI).toFixed(1)} deg, v_n = ${(b.vn / IN_S_PER_MPH).toFixed(1)} mph, m_e = ${p.bumpMassShare} x ${b.staticLb.toFixed(0)} lb, `
    + `F_n = v_n sqrt(k m_e) = ${b.Fn.toFixed(0)} lbf (${b.factor.toFixed(1)}x static), H = ${b.H.toFixed(0)}, V = ${b.V.toFixed(0)} lbf`;
}

// ── fatigue (spec 5.3) ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Goodman factor of safety for a pulsating (R = 0) bending stress: sigma_a = sigma_m = sigma_max / 2, n = 1 / (sigma_a / Se + sigma_m / Sut).
 * The stub is fixed and the wheel rotates, so the load direction is fixed on the stub.
 */
export function goodmanPulsating(sigmaMax: number, Se: number, Sut: number): number {
  const sa = sigmaMax / 2, sm = sigmaMax / 2;
  const d = sa / Se + sm / Sut;
  return d > 0 ? 1 / d : Infinity;
}
