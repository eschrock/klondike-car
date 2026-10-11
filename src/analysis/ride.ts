/**
 * Ride-mode analysis rows (Phase 3b, D-49, D-51, spec 6 and 7): lateral stability at the ride lock and the ride speed, steering feel (info), and the
 * ride envelope (slope x friction -> practical deceleration, info). The brake stopping distance, heat, bias and park-hold rows are WS-C's (analysis/brake-ride.ts).
 *
 * Practical deceleration (study 1.1, 1.5). A fixed front share s of the total brake force F, on a slope theta, with the CG at x ahead of the rear contact and
 * height h over a wheelbase L: N_f = (W cos(theta) x + F h) / L, N_r = W cos(theta) - N_f, each axle limited by mu N. The most F the pair can use is
 * min(mu A_f / (s - mu k), mu A_r / ((1 - s) + mu k)) with A_f = W cos(theta) x / L, A_r = W cos(theta) (L - x) / L, k = h / L (the front limit is unbounded when
 * s <= mu k). Deceleration in g = F / W - sin(theta) + Crr cos(theta). GO needs >= 0.2 g for front shares of 0.4, 0.5 and 0.6.
 */
import { lockLimits } from '../model/ackermann';
import type { Ctx } from './context';
import { dualCheck, singleCheck, detail, type CaseEval } from './dual';
import { RAD, contactsAt, instantCenterY, outerEdgeDistance } from './geometry';
import { f } from './format';
import type { CaseData } from './loads';
import { evalBoth } from './stability';
import { frontHit } from './front-end';
import { chain } from './linkage';
import type { AnalysisCheck } from './types';

const G_IN_S2 = 386.1;
const IN_S_PER_MPH = 17.6;
/** Rolling resistance coefficient of the pneumatic tires on dirt (study 2.1: 0.015 / 0.03 / 0.06). */
export const CRR = 0.03;
/** GO needs at least this deceleration (g); CAUTION from 0.1 g (study 1.1). */
export const GO_DECEL_G = 0.2;
export const CAUTION_DECEL_G = 0.1;

export interface DecelGeom { x: number; h: number; L: number }

/** Practical deceleration (g) with a fixed front share on a slope, both axles limited by mu N. Negative: the cart speeds up even with the brakes at the limit. */
export function practicalDecelG(geom: DecelGeom, slopeDeg: number, mu: number, share: number): number {
  const th = slopeDeg * RAD;
  const k = geom.h / geom.L;
  const Af = (Math.cos(th) * geom.x) / geom.L, Ar = (Math.cos(th) * (geom.L - geom.x)) / geom.L; // per unit weight
  const front = share - mu * k > 1e-9 ? (mu * Af) / (share - mu * k) : Infinity;
  const rear = (mu * Ar) / (1 - share + mu * k);
  const F = Math.min(front, rear);
  return F - Math.sin(th) + CRR * Math.cos(th);
}

/**
 * Worst practical deceleration over the front shares bias - tol, bias, bias + tol. The tolerance is `frontBrakeBiasTolerance` (0.05): the solved share is accurate to about
 * +/-0.02 (a bench-set bias bar and the lining mu of each shoe set), so 0.05 is 2.5 times that. The spec's +/-0.1 was written around a 0.5 share; around the 0.6 that the
 * lockup order needs (D-56) it would test 0.7, a share the bias bar cannot reach (the 0.4-0.6 band).
 */
export function worstBiasDecelG(geom: DecelGeom, slopeDeg: number, mu: number, bias: number, tol = 0.05): number {
  return Math.min(...[bias - tol, bias, bias + tol].map((s) => practicalDecelG(geom, slopeDeg, mu, s)));
}

export const goStatus = (g: number): 'GO' | 'CAUTION' | 'NO' => (g >= GO_DECEL_G ? 'GO' : g >= CAUTION_DECEL_G ? 'CAUTION' : 'NO');

/** Decel geometry of a load case: CG x (ahead of the rear axle), height, and the front axle x. */
export function decelGeom(ctx: Ctx, c: CaseData): DecelGeom {
  const ct = contactsAt(ctx.contact, 0);
  return { x: c.cg[0], h: c.cg[2], L: (ct.FL[0] + ct.FR[0]) / 2 };
}

// ── ride-rollover (lateral, at the ride lock and speed) ─────────────────────────────────────────────────────

export function rideRollover(ctx: Ctx): AnalysisCheck {
  const { p, contact } = ctx;
  const ack = ctx.L.front.ack;
  const ride = lockLimits(ack, 'ride');
  const inner = ride.innerDeg * RAD;
  const v = p.rideSpeedMph * IN_S_PER_MPH;
  const ev = (c: CaseData): CaseEval => {
    let best = { a: 0, ssf: Infinity, R: 0, sign: 1, h: 0, d: 0 };
    for (const s of [1, -1]) {
      const cg = c.cgAt(s * inner);
      const ct = contactsAt(contact, s * inner);
      const d = outerEdgeDistance(ct, [cg[0], cg[1]], s * inner);
      const ic = instantCenterY(contact, s * inner) ?? 0;
      const R = Math.hypot(cg[0], cg[1] - ic);
      const a = v * v / (R * G_IN_S2);
      const ssf = d / cg[2];
      if (ssf < best.ssf) best = { a, ssf, R, sign: s, h: cg[2], d };
    }
    const limit = 0.5 * best.ssf;
    return {
      value: best.a, unit: 'g', limit, sense: '<=',
      how: `Ride lock ${f(p.steerRideLockDeg, 1)} deg outer / ${f(ride.innerDeg, 2)} deg inner (Ackermann contacts): instant center ${f(Math.abs(instantCenterY(contact, best.sign * inner) ?? 0) / 12, 0)} ft off the rear axle, CG radius R = ${f(best.R / 12, 1)} ft. a = v2 / R = (${p.rideSpeedMph} mph)2 / ${f(best.R / 12, 1)} ft = ${f(best.a, 3)} g. Tip needs the static stability factor SSF = d_outer / h = ${f(best.d, 2)} / ${f(best.h, 2)} = ${f(best.ssf, 2)} g (the study quoted 1.16-1.23); the limit is half of it, ${f(limit, 2)} g. The tires slide first: ${f(p.tireGroundMu, 2)} g at mu ${f(p.tireGroundMu, 2)} (so the cart skids, not rolls; speed at which a ${f(p.steerRideLockDeg, 0)} deg turn reaches the slide: ${f(Math.sqrt(p.tireGroundMu * G_IN_S2 * best.R) / IN_S_PER_MPH, 1)} mph, to tip: ${f(Math.sqrt(best.ssf * G_IN_S2 * best.R) / IN_S_PER_MPH, 1)} mph). A trip over a rut (a sideways slide of about 4.5 mph hooking it) is the real rollover and is an accepted risk (D-51).`,
    };
  };
  return dualCheck({ id: 'ride-rollover', label: 'Ride-mode lateral stability (ride lock, ride speed)', group: 'Stability', refs: ['D-51', 'D-53', 'A-1'], primary: 'operating', ...evalBoth(ctx, ev) });
}

// ── steering feel (info) ────────────────────────────────────────────────────────────────────────────────────

/** Self-centering stiffness of one front wheel (lb.in per degree of steer) and the ground trail used (in). */
export function centeringStiffness(ctx: Ctx, wheelLoadLb: number): { kPerDeg: number; trail: number } {
  const { p } = ctx;
  const trail = ctx.L.front.trailIn + p.tirePneumaticTrailIn;
  return { kPerDeg: p.tireCorneringPerDeg * wheelLoadLb * trail, trail };
}

export function steerCentering(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const c = ctx.loads.operating;
  const ct = contactsAt(ctx.contact, 0);
  const wf = (c.massLb * c.cg[0]) / ((ct.FL[0] + ct.FR[0]) / 2) / 2;
  const k = centeringStiffness(ctx, wf);
  const ride = lockLimits(ctx.L.front.ack, 'ride');
  const total = 2 * k.kPerDeg;
  const atLock = total * ride.outerDeg;
  return singleCheck({
    id: 'steer-centering', label: 'Self-centering (trail) and centering spring', group: 'Steering', refs: ['D-53', 'study 3.4'],
    value: total, unit: 'lb.in/deg', limit: 0, sense: '>=', info: true,
    how: `Ground trail = kingpin lead ${f(ctx.L.front.ack.lead, 2)}" + r tan(caster ${p.casterDeg} deg) ${f(ctx.L.front.trailIn - ctx.L.front.ack.lead, 2)}" + pneumatic ${f(p.tirePneumaticTrailIn, 2)}" = ${f(k.trail, 2)}". Each front wheel (${f(wf)} lb) centers with C_alpha x load x trail = ${f(p.tireCorneringPerDeg, 2)} x ${f(wf)} x ${f(k.trail, 2)} = ${f(k.kPerDeg, 1)} lb.in per degree; both wheels ${f(total, 1)} lb.in/deg, ${f(atLock, 0)} lb.in at the ${f(ride.outerDeg, 0)} deg ride lock (the study quoted about 16 lb.in/deg each; C_alpha is assumed). The centering spring (${p.steerCenterSpringLbf} lbf at the grip at the ride lock) only defines neutral at rest, where there is no tire side force. Info only.`,
  });
}

export function rideSteerEffort(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const c = ctx.loads.operating;
  const ct = contactsAt(ctx.contact, 0);
  const wf = (c.massLb * c.cg[0]) / ((ct.FL[0] + ct.FR[0]) / 2) / 2;
  const k = centeringStiffness(ctx, wf);
  const hold = 5; // deg of steer held for a steady bend (study 3.4)
  const arm = ctx.L.front.ack.armLen * Math.cos((ctx.L.front.ack.armAngleDeg * Math.PI) / 180);
  const Frod = (2 * k.kPerDeg * hold) / arm;
  // Through the drag link and bellcrank (same lever arms as the kickback chain) to the cables and the stick.
  const stickArm = ctx.L.front.stick.cableArm;
  const cableArmRatio = stickArm / p.rideStickLengthIn;
  const kn = chain(ctx, frontHit(ctx, c, 'normal')), kh = chain(ctx, frontHit(ctx, c, 'hard'));
  const gripKick = (kn.Fcable * stickArm) / p.rideStickLengthIn, gripHard = (kh.Fcable * stickArm) / p.rideStickLengthIn;
  const ratio = kn.Frod > 0 ? kn.Fcable / kn.Frod : 1; // cable force per rod force
  const gripSteady = Frod * ratio * cableArmRatio;
  return singleCheck({
    id: 'ride-steer-effort', label: 'Ride stick effort (steady, transient, kickback)', group: 'Steering', refs: ['D-53', 'study 3.4, 4.2'],
    value: gripSteady, unit: 'lbf', limit: p.stickHandLoadLbf, sense: '<=', info: true,
    how: `Holding ${hold} deg of steer against the tire self-centering (2 x ${f(k.kPerDeg, 1)} lb.in/deg x ${hold} = ${f(2 * k.kPerDeg * hold, 0)} lb.in) takes a rod force of ${f(Frod)} lbf and about ${f(gripSteady, 1)} lbf at the ${p.rideStickLengthIn}" grip through the drag link, bellcrank and the ${f(stickArm, 1)}" cable arm (C_alpha assumed ${p.tireCorneringPerDeg}/deg; the study quoted about 2 lbf, from a smaller aligning moment). Kickback if the stick is held: ${f(gripKick)} lbf at the grip from a 1" bump, ${f(gripHard)} lbf from a 2" hit (study: 44-160 lbf); the bellcrank window plate stops the motion, so the hand and the cable see only what they choose to resist. Info only.`,
  });
}

// ── ride envelope (info) ────────────────────────────────────────────────────────────────────────────────────

export const ENVELOPE_SLOPES = [5, 8, 10] as const;
export const ENVELOPE_MU = [0.3, 0.4, 0.5, 0.6, 0.7] as const;

export function rideEnvelope(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const c = ctx.loads.operating;
  const g = decelGeom(ctx, c);
  const bias = p.frontBrakeBias, tol = p.frontBrakeBiasTolerance;
  const rows = ENVELOPE_SLOPES.map((s) => `${s} deg: ` + ENVELOPE_MU.map((mu) => { const d = worstBiasDecelG(g, s, mu, bias, tol); return `mu ${mu} ${f(d, 2)} g ${goStatus(d)}`; }).join(', '));
  const dGo8 = worstBiasDecelG(g, p.rideGoSlopeDeg, p.rideMuGo8, bias, tol);
  const dGo10 = worstBiasDecelG(g, p.rideMaxSlopeDeg, p.rideMuGo10, bias, tol);
  const worst = Math.min(dGo8, dGo10);
  // The same corners at exactly the solved share (no tolerance): the GO rule is met there, but only just, and a bias-bar error of the tolerance can take a corner back to CAUTION.
  const solved8 = practicalDecelG(g, p.rideGoSlopeDeg, p.rideMuGo8, bias), solved10 = practicalDecelG(g, p.rideMaxSlopeDeg, p.rideMuGo10, bias);
  const fragile = (dGo8 < GO_DECEL_G && solved8 >= GO_DECEL_G) || (dGo10 < GO_DECEL_G && solved10 >= GO_DECEL_G);
  return singleCheck({
    id: 'ride-envelope', label: 'Ride envelope: slope x friction (GO table)', group: 'Braking', refs: ['D-51', 'D-55', 'study 1.5'],
    value: worst, unit: 'g', limit: GO_DECEL_G, sense: '>=', info: true,
    details: [
      detail(`GO table value at ${p.rideGoSlopeDeg} deg, usable mu ${p.rideMuGo8} (worst front share)`, dGo8, 'g', GO_DECEL_G, '>='),
      detail(`GO table value at ${p.rideMaxSlopeDeg} deg, usable mu ${p.rideMuGo10} (worst front share)`, dGo10, 'g', GO_DECEL_G, '>='),
      detail(`same ${p.rideGoSlopeDeg} deg corner at exactly the solved share ${f(bias, 2)} (info)`, solved8, 'g', GO_DECEL_G, '>='),
      detail(`same ${p.rideMaxSlopeDeg} deg corner at exactly the solved share ${f(bias, 2)} (info)`, solved10, 'g', GO_DECEL_G, '>='),
    ],
    how: `Practical deceleration with a fixed front share (${f(bias - tol, 2)}, ${f(bias, 2)}, ${f(bias + tol, 2)}: the solved bias +/- ${f(tol, 2)}, the bias bar's accuracy; the worst is quoted), both axles limited by mu N with the braking load transfer, CG ${f(g.x)}" ahead of the rear axle and ${f(g.h)}" high at the operating rider, rolling resistance ${CRR}. GO needs >= ${GO_DECEL_G} g, CAUTION ${CAUTION_DECEL_G}-${GO_DECEL_G} g (5 mph with a handler), NO below. ${rows.join('; ')}. Rule: ride up to ${p.rideMaxSlopeDeg} deg at up to ${p.rideSpeedMph} mph (daylight, helmet, lap belt, an adult spotter); GO needs usable mu >= ${p.rideMuGo8} up to ${p.rideGoSlopeDeg} deg and >= ${p.rideMuGo10} up to ${p.rideMaxSlopeDeg} deg (the camp-measured mu x ${p.rideMuDerate}); the table above gives ${f(dGo8, 2)} g and ${f(dGo10, 2)} g at those two corners. Walk it down above ${p.rideMaxSlopeDeg} deg.${fragile ? ` WATCH: at exactly the solved share the corners give ${f(solved8, 2)} g and ${f(solved10, 2)} g (GO), but a bias error of ${f(tol, 2)} takes one below the ${GO_DECEL_G} g GO line (${f(dGo8, 2)} g at ${p.rideGoSlopeDeg} deg, ${f(dGo10, 2)} g at ${p.rideMaxSlopeDeg} deg): set the bias bar on the mock-up with two scales (brake-bias row) or raise the GO friction rule.` : ''} The stopping distance, heat and bias rows are in the Braking group (brake-ride).`,
  });
}

export function rideChecks(ctx: Ctx): AnalysisCheck[] {
  return [rideRollover(ctx), steerCentering(ctx), rideSteerEffort(ctx), rideEnvelope(ctx)];
}
