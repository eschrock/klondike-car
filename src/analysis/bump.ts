/**
 * Bump load model (Phase 3b, D-50, spec section 5): the velocity-change pulse of one wheel meeting a step of height h at the bump speed, with the
 * pneumatic wheel's radial stiffness. It replaces `obstacleForce` / `strikeCases` (curb and root, H = V tan phi, x3) for the Ackermann front end.
 *
 *   sin(beta) = (r - h) / r           contact normal tilted beta above the horizontal; h capped at 0.9 r (a taller step is a wall)
 *   v_n       = v cos(beta)           normal-direction speed of the wheel centre
 *   m_e       = bumpMassShare x W_c / g   W_c = rigid-body corner weight, W / (1 + x^2/ky^2 + y^2/kx^2) (Phase 3c-3b, docs/phase3c-3b-notes.md)
 *   F_n       = v_n sqrt(k m_e)       k = bumpWheelRateLbIn
 *   H = F_n cos(beta)   V = F_n sin(beta)       (H opposes the motion, V is up on the wheel)
 *
 * Two bases (D-50): NORMAL USE is the 1 inch bump with the full margins (steel yield / steelSafetyFactor, wood design MOR); a HARD HIT is the 2 inch
 * pothole or root, a fail-safe case (steel ultimate / failSafeFactor, wood MOR with no safety factor, wheel retention). The caveat on every row is
 * the wheel rate: `sensitivityText` prints the result at k x 0.5 and x 2.5.
 *
 * Phase 3c-3b (D-54 follow-up): the effective mass is the rigid-body mass at the struck wheel (a rigid sled pivots about its other contacts, so it is a
 * fraction of the total, not 1.5 x the wheel's static load) and the wheel rate is a 10 inch pneumatic hand-truck tire (500 lb/in at 30 psi). Every
 * strike also carries the conventional cross-check (bumpDlfCheck x static) so a reader sees the ratio of the physics to the textbook dynamic factor.
 *
 * Plain TypeScript, no three.js.
 */
import type { Params } from '../params';
import type { Ctx } from './context';
import type { CaseData } from './loads';
import { wheelLoads } from './structure';
import { contactsAt } from './geometry';

const G_IN_S2 = 386.1;
const IN_S_PER_MPH = 17.6;

export type BumpWheel = 'front' | 'rear';
export type BumpKind = 'normal' | 'hard';

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
  /** The same mass as a weight (lb). */
  meWeightLb: number;
  /** Static wheel load (lb) the pulse mass is based on. */
  staticLb: number;
  Fn: number;
  /** Horizontal component (opposes motion) and vertical component (up on the wheel), lbf. */
  H: number;
  V: number;
  /** Fn / static wheel load. */
  factor: number;
  kLbIn: number;
  /** The speed this strike was taken at (mph): the walking-pace normal case or the jogging-pace hard hit (D-55). */
  vMph: number;
  /** Drop height (in) of the effective mass that gives the same normal speed: v_n^2 / 2g. */
  dropEqIn: number;
  /** Conventional cross-check: bumpDlfCheck x the static wheel load (lbf); 0 when the pulse was built without it. */
  conventionalLb: number;
}

export interface PulseInput {
  rIn: number;
  hIn: number;
  vMph: number;
  staticLb: number;
  kLbIn: number;
  /** Old interface: m_e = massShare x staticLb / g. Ignored when `meWeightLb` is given. */
  massShare?: number;
  /** Effective mass as a weight (lb): the rigid-body corner weight from `rigidCornerWeightLb` times the participation multiplier. */
  meWeightLb?: number;
  /** Conventional dynamic factor for the cross-check (default 0 = none). */
  dlfCheck?: number;
}

/**
 * Rigid-body mass at one wheel for a vertical impulse (as a weight, lb). A free rigid body of weight W with radii of gyration kx (roll, about the
 * fore-aft axis) and ky (pitch) struck at (x, y) from its CG moves at the struck point with dv = J (1/m + x^2/Iy + y^2/Ix), so
 * W_c = W / (1 + x^2/ky^2 + y^2/kx^2). A uniform plate struck at its corner is W/7 (1 + 3 + 3).
 */
export function rigidCornerWeightLb(weightLb: number, x: number, y: number, kx: number, ky: number): number {
  return weightLb / (1 + (x * x) / (ky * ky) + (y * y) / (kx * kx));
}

/** Radius of gyration of a uniform rectangle of side s about its center: s / sqrt(12). */
export const plateGyration = (side: number): number => side / Math.sqrt(12);

/** The pulse itself, from plain numbers (the tests pin this against the hand arithmetic). */
export function bumpPulse(i: PulseInput): BumpStrike {
  const hEff = Math.max(0, Math.min(i.hIn, 0.9 * i.rIn));
  const sinB = (i.rIn - hEff) / i.rIn;
  const beta = Math.asin(Math.min(1, sinB));
  const v = i.vMph * IN_S_PER_MPH;
  const vn = v * Math.cos(beta);
  const meWeightLb = i.meWeightLb ?? (i.massShare ?? 1) * i.staticLb;
  const me = meWeightLb / G_IN_S2;
  const Fn = vn * Math.sqrt(i.kLbIn * me);
  return {
    hIn: i.hIn, hEff, beta, vn, me, meWeightLb, staticLb: i.staticLb, Fn, H: Fn * Math.cos(beta), V: Fn * Math.sin(beta), factor: i.staticLb > 0 ? Fn / i.staticLb : 0, kLbIn: i.kLbIn, vMph: i.vMph,
    dropEqIn: (vn * vn) / (2 * G_IN_S2), conventionalLb: (i.dlfCheck ?? 0) * i.staticLb,
  };
}

/** Static load of the heavier front or rear wheel in a load case (front: worse of level and nose-down on the design slope, M4). */
export function staticWheelLb(ctx: Ctx, c: CaseData, wheel: BumpWheel): number {
  const w = wheelLoads(ctx, c);
  return wheel === 'front' ? w.frontWheel : w.rearWheel;
}

/**
 * Rigid-body corner weight (lb) at the struck wheel in a load case, from the wheel contacts and the case CG. The radii of gyration are those of a
 * uniform plate spanning the four contacts (wheelbase x track): a deliberate middle estimate, the sled's real mass is spread over a similar footprint
 * (rider and cargo near the middle, box and handlebow at the ends). `bumpMassShare` scales the result (default 1).
 */
export function cornerWeightLb(ctx: Ctx, c: CaseData, wheel: BumpWheel): number {
  const ct = contactsAt(ctx.contact, 0);
  const pt = wheel === 'front' ? ct.FL : ct.RL;
  const spanX = Math.abs((ct.FL[0] + ct.FR[0]) / 2 - (ct.RL[0] + ct.RR[0]) / 2);
  const track = (Math.abs(ct.FL[1] - ct.FR[1]) + Math.abs(ct.RL[1] - ct.RR[1])) / 2;
  const ky = plateGyration(Math.max(1, spanX)), kx = plateGyration(Math.max(1, track));
  return rigidCornerWeightLb(c.massLb, pt[0] - c.cg[0], pt[1] - c.cg[1], kx, ky);
}

/**
 * `bumpStrike(ctx, caseData, wheel, hIn)` (spec 5.1). `kind` picks the design speed (D-55, Eric 2026-10-11): 'normal' = the routine bump at walking pace
 * (`bumpSpeedNormalMph`, full margins), 'hard' = the occasional sharp edge at a jog (`bumpSpeedHardMph`, the fail-safe case).
 */
export function bumpStrike(ctx: Ctx, c: CaseData, wheel: BumpWheel, hIn: number, kScale = 1, kind: BumpKind = 'normal'): BumpStrike {
  const { p, d } = ctx;
  return bumpPulse({
    rIn: d.wheelRadiusIn, hIn, vMph: kind === 'hard' ? p.bumpSpeedHardMph : p.bumpSpeedNormalMph, staticLb: staticWheelLb(ctx, c, wheel), kLbIn: p.bumpWheelRateLbIn * kScale,
    meWeightLb: p.bumpMassShare * cornerWeightLb(ctx, c, wheel), dlfCheck: p.bumpDlfCheck,
  });
}

export interface BumpCases {
  normal: BumpStrike;
  hard: BumpStrike;
}

export function bumpCases(ctx: Ctx, c: CaseData, wheel: BumpWheel): BumpCases {
  return { normal: bumpStrike(ctx, c, wheel, ctx.p.bumpNormalHeightIn, 1, 'normal'), hard: bumpStrike(ctx, c, wheel, ctx.p.bumpHardHeightIn, 1, 'hard') };
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
  const b = bumpStrike(ctx, c, 'rear', ctx.p.bumpHardHeightIn, 1, 'hard');
  return 1 + b.V / c.massLb;
}

/** The payload / seat dynamic factor for a load case: max(dynamicFactor, bumpSeatG) (spec 5.4: rails, deck, seat-back, seat-grip). */
export function seatFactor(ctx: Ctx, c: CaseData): number {
  return Math.max(ctx.p.dynamicFactor, bumpSeatG(ctx, c));
}

/** Peak vertical force on a struck wheel: the obstacle's V plus the static wheel load still on the tire (conservative; the spec rows quote V alone). */
export const peakVertical = (b: BumpStrike): number => b.V + b.staticLb;

/** One sentence for every bump row: the dominant uncertainty is the wheel rate (spec 5.1). */
export function sensitivityText(ctx: Ctx, c: CaseData, wheel: BumpWheel, hIn: number, kind: BumpKind = 'normal'): string {
  const lo = bumpStrike(ctx, c, wheel, hIn, 0.5, kind), mid = bumpStrike(ctx, c, wheel, hIn, 1, kind), hi = bumpStrike(ctx, c, wheel, hIn, 2.5, kind);
  const k = ctx.p.bumpWheelRateLbIn;
  return `Wheel-rate sensitivity (${wheel} ${hIn}" ${kind === 'hard' ? 'hard-hit' : 'bump'}, ${mid.vMph} mph): F_n = ${lo.Fn.toFixed(0)} lbf at k ${(k * 0.5).toFixed(0)}, ${mid.Fn.toFixed(0)} at ${k.toFixed(0)}, ${hi.Fn.toFixed(0)} at ${(k * 2.5).toFixed(0)} lb/in (bench-test one wheel; Phase 4 gate).`;
}

/** The pulse as a sentence, for the `how` text of every bump row. */
export function bumpText(b: BumpStrike, label: string, _p?: Pick<Params, 'bumpMassShare'>): string {
  const conv = b.conventionalLb > 0 ? `; conventional check ${b.conventionalLb.toFixed(0)} lbf (${(b.conventionalLb / b.staticLb).toFixed(1)}x static), this pulse is ${(b.Fn / b.conventionalLb).toFixed(2)} of it` : '';
  return `${label}: step ${b.hIn.toFixed(2)}"${b.hEff < b.hIn ? ` (capped at ${b.hEff.toFixed(2)}")` : ''}, beta = ${(b.beta * 180 / Math.PI).toFixed(1)} deg, v_n = ${(b.vn / IN_S_PER_MPH).toFixed(1)} mph (${b.vMph} mph), m_e = ${b.meWeightLb.toFixed(0)} lb (rigid-body corner of the sled, wheel static ${b.staticLb.toFixed(0)} lb), `
    + `F_n = v_n sqrt(k m_e) = ${b.Fn.toFixed(0)} lbf (${b.factor.toFixed(1)}x static), H = ${b.H.toFixed(0)}, V = ${b.V.toFixed(0)} lbf${conv}`;
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
