/**
 * Ride-mode brake rows (Phase 3b WS-C, D-56): emergency stop force, stopping distance, front/rear bias and lockup order, shoe heat, the front brake
 * structure and housing, the hip lever and cable, parking hold on the design slope, and the lap belt anchor. The chain numbers (front/rear split, hip ratio,
 * lockup limits, stop and heat formulas) are in `brake-chain.ts`; every row is hand-checkable from its `how` text and docs/phase3b-wsC-notes.md.
 */
import { HORN_H_IN, HORN_T_IN } from '../model/brake-front';
import type { Ctx } from './context';
import { dualCheck, detail, governing, type CaseEval } from './dual';
import { f } from './format';
import type { CaseData } from './loads';
import { evalBoth } from './stability';
import type { AnalysisCheck, Detail } from './types';
import { cableCompliance, chainOf, heatRun, hipFromMain, lockLimits, mainForceForN, mainFromHip, stopDistance, wheelbaseOf, FT_S2, type Chain } from './brake-chain';
import { frontBrakeSweep } from './brake-sweep-front';

const RAD = Math.PI / 180;
/** An informational detail: reported, never failing. */
const info = (name: string, value: number, unit: string): Detail => ({ name, value, unit, limit: 0, sense: '>=', util: 0 });

const crrOf = (ctx: Ctx) => ctx.p.brakeRollingCrr;

/** Deceleration (g) the brakes can deliver at a slope, tire-ground friction `mu`, for a rider case: traction limit and hand-force limit at the emergency force. */
function decelAvailable(ctx: Ctx, ch: Chain, c: CaseData, slopeDeg: number, mu: number) {
  const { p } = ctx;
  const th = slopeDeg * RAD;
  const b = ch.frontOn ? (ch.bias.fwd + ch.bias.rev) / 2 : 0;
  const lk = lockLimits(c.cg[0], c.cg[2], wheelbaseOf(ctx), th, b, mu, crrOf(ctx));
  const fMain = mainFromHip(ch, p.brakeEmergencyLimitLbf);
  const N = fMain * ch.Rcrit * ch.eta;
  const aHand = (p.brakePadMuFouled * N) / c.massLb - Math.sin(th) + crrOf(ctx) * Math.cos(th);
  const aTrac = Math.max(0, lk.aMax);
  return { lk, aHand, aTrac, aDec: Math.min(aTrac, aHand), traction: aTrac <= aHand };
}

// ── emergency stop force ──────────────────────────────────────────────────────────────────────────────

export function brakeEmergency(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const ch = chainOf(ctx);
  const th = p.rideGoSlopeDeg * RAD;
  const ev = (c: CaseData): CaseEval => {
    const Ftot = c.massLb * (0.3 + Math.sin(th) - crrOf(ctx) * Math.cos(th));
    const N = Ftot / p.brakePadMuFouled;
    const fMain = mainForceForN(ch, N);
    const fHip = hipFromMain(ch, fMain);
    return {
      value: fHip, unit: 'lbf', limit: p.brakeEmergencyLimitLbf, sense: '<=', marginalAbs: 0.05 * p.brakeEmergencyLimitLbf,
      details: [detail('hip grip force', fHip, 'lbf', p.brakeEmergencyLimitLbf, '<='), info('main grip force', fMain, 'lbf')],
      how: `A 0.30 g stop on ${f(p.rideGoSlopeDeg)}°: total brake force F = W(0.30 + sinθ − Crr cosθ) = ${f(c.massLb)} × (0.30 + ${f(Math.sin(th), 3)} − ${f(crrOf(ctx), 3)} × ${f(Math.cos(th), 3)}) = ${f(Ftot)} lbf; at the mud-fouled lining μ ${f(p.brakePadMuFouled, 2)} the shoes need N = ${f(N)} lbf. Chain ratio ${f(ch.Rcrit, 1)}:1 (the smaller rolling direction; the front branch adds braking capacity, not leverage, same grip stroke) × efficiency ${f(ch.eta, 2)} gives ${f(fMain)} lbf at the main grip; the hip lever is ${f(ch.hg.hipPerMain, 3)} of that geometrically and the Bowden cable is ${f(ch.etaHip, 2)} efficient, so ${f(fHip)} lbf at the hip grip. Limit ${f(p.brakeEmergencyLimitLbf)} lbf.`,
    };
  };
  return dualCheck({ id: 'brake-emergency', label: 'Emergency stop: hand force for 0.30 g on the envelope slope', group: 'Braking', refs: ['D-56', 'D-51'], primary: 'operating', ...evalBoth(ctx, ev) });
}

// ── stopping distance ─────────────────────────────────────────────────────────────────────────────────

export function brakeStop(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const ch = chainOf(ctx);
  const ev = (c: CaseData): CaseEval => {
    const stopAt = (deg: number, mu: number) => {
      const a = decelAvailable(ctx, ch, c, deg, mu);
      return { ...stopDistance(p.rideSpeedMph, deg * RAD, crrOf(ctx), p.rideReactionS, a.aDec), a };
    };
    const s8 = stopAt(p.rideGoSlopeDeg, p.tireGroundMu);
    const s5 = stopAt(5, p.tireGroundMu);
    const s10 = stopAt(p.rideMaxSlopeDeg, p.tireGroundMu);
    const m4 = stopAt(p.rideGoSlopeDeg, 0.4), m3 = stopAt(p.rideGoSlopeDeg, 0.3);
    const ds: Detail[] = [
      detail(`stop from ${f(p.rideSpeedMph, 0)} mph on ${f(p.rideGoSlopeDeg, 0)}°, μ ${f(p.tireGroundMu, 2)}`, s8.totalFt, 'ft', p.rideStopMaxFt, '<='),
      detail(`stop on ${f(p.rideMaxSlopeDeg, 0)}°, μ ${f(p.tireGroundMu, 2)}`, s10.totalFt, 'ft', 55, '<='),
      info('stop on 5°, μ 0.5', s5.totalFt, 'ft'),
      info(`stop on ${f(p.rideGoSlopeDeg, 0)}°, μ 0.4 (info)`, m4.totalFt, 'ft'),
      info(`stop on ${f(p.rideGoSlopeDeg, 0)}°, μ 0.3 (info)`, m3.totalFt, 'ft'),
    ];
    return {
      value: s8.totalFt, unit: 'ft', limit: p.rideStopMaxFt, sense: '<=', details: ds, marginalAbs: 0.05 * p.rideStopMaxFt,
      how: `Reaction ${f(p.rideReactionS, 1)} s of free roll from ${f(p.rideSpeedMph, 0)} mph on ${f(p.rideGoSlopeDeg, 0)}° (a = g(sinθ − Crr cosθ) = ${f(FT_S2 * (Math.sin(p.rideGoSlopeDeg * RAD) - crrOf(ctx) * Math.cos(p.rideGoSlopeDeg * RAD)), 2)} ft/s²): ${f(s8.reactionFt)} ft, speed at brake onset ${f(s8.v1MphAtBrake)} mph. Then v₁²/(2·a_dec) with a_dec = ${f(s8.aDecG, 3)} g = the lesser of the tire-ground traction limit ${f(s8.a.aTrac, 3)} g (front share ${f(ch.frontOn ? (ch.bias.fwd + ch.bias.rev) / 2 : 0, 2)}, ${s8.a.lk.frontFirst ? 'front' : 'rear'} axle slides first, load transfer included) and the ${f(p.brakeEmergencyLimitLbf)} lbf hand limit ${f(s8.a.aHand, 3)} g: ${f(s8.brakeFt)} ft. Total ${f(s8.totalFt)} ft (limit ${f(p.rideStopMaxFt)}). At 10° ${f(s10.totalFt)} ft; at μ 0.4 ${f(m4.totalFt)} ft, μ 0.3 ${f(m3.totalFt)} ft.`,
    };
  };
  return dualCheck({ id: 'brake-stop', label: 'Stopping distance from ride speed on the envelope slope', group: 'Braking', refs: ['D-56', 'D-51', 'D-55'], primary: 'operating', ...evalBoth(ctx, ev) });
}

// ── bias and lockup order ────────────────────────────────────────────────────────────────────────────

export function brakeBias(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const ch = chainOf(ctx);
  const ev = (c: CaseData): CaseEval => {
    const wb = wheelbaseOf(ctx);
    const b = ch.frontOn ? (ch.bias.fwd + ch.bias.rev) / 2 : 0;
    const lockAt = (deg: number, mu: number) => lockLimits(c.cg[0], c.cg[2], wb, deg * RAD, b, mu, crrOf(ctx));
    const k8 = lockAt(p.rideGoSlopeDeg, p.tireGroundMu), k10 = lockAt(p.rideMaxSlopeDeg, p.tireGroundMu), k3 = lockAt(p.rideGoSlopeDeg, 0.3), k7 = lockAt(p.rideGoSlopeDeg, 0.7);
    const margin = (k: ReturnType<typeof lockAt>) => (Number.isFinite(k.aFront) ? k.aRear - k.aFront : k.aRear);
    const ds: Detail[] = [
      detail('front share, rolling forward ≥ 0.4', ch.bias.fwd, '', 0.4, '>='),
      detail('front share, rolling forward ≤ 0.6', ch.bias.fwd, '', 0.6, '<='),
      detail('front share, rolling backward ≥ 0.4', ch.bias.rev, '', 0.4, '>='),
      detail('front share, rolling backward ≤ 0.6', ch.bias.rev, '', 0.6, '<='),
      detail(`front axle slides no later than the rear, ${f(p.rideGoSlopeDeg, 0)}° μ ${f(p.tireGroundMu, 2)} (rear limit − front limit, g)`, margin(k8), 'g', 0, '>='),
      detail(`same on ${f(p.rideMaxSlopeDeg, 0)}°`, margin(k10), 'g', 0, '>='),
      info(`same on ${f(p.rideGoSlopeDeg, 0)}°, μ 0.3 (info)`, margin(k3), 'g'),
      info(`same on ${f(p.rideGoSlopeDeg, 0)}°, μ 0.7 (info)`, margin(k7), 'g'),
    ];
    const txt = (k: ReturnType<typeof lockAt>) => `front ${Number.isFinite(k.aFront) ? f(k.aFront, 3) : '∞'} g / rear ${f(k.aRear, 3)} g`;
    return {
      ...governing(ds, `Front share of the shoe force: ${f(ch.bias.fwd, 3)} rolling forward, ${f(ch.bias.rev, 3)} backward (bias bar front arm a_f = ${f(ch.fg.aF, 2)}" of ${f(ch.fg.barIn, 1)}", force fraction φ = ${f(ch.phi, 3)}; the swing arm is offset by the rear arm's friction-line ratio ρ = ${f(ch.fg.rho, 3)} so the split does not depend on direction or pad μ). Lockup limits with load transfer on the slope (CG x = ${f(c.cg[0])}" ahead of the rear axle, h = ${f(c.cg[2])}", wheelbase ${f(wb)}"): ${f(p.rideGoSlopeDeg, 0)}° μ ${f(p.tireGroundMu, 2)}: ${txt(k8)}; ${f(p.rideMaxSlopeDeg, 0)}°: ${txt(k10)}; ${f(p.rideGoSlopeDeg, 0)}° μ 0.3: ${txt(k3)}, μ 0.7: ${txt(k7)}. Front-first (plows straight) is the benign order; rear-first slides sideways.`),
      marginalAbs: 0.02,
    };
  };
  return dualCheck({ id: 'brake-bias', label: 'Front/rear brake share and lockup order', group: 'Braking', refs: ['D-56'], primary: 'operating', ...evalBoth(ctx, ev) });
}

// ── shoe heat ────────────────────────────────────────────────────────────────────────────────────────

export function brakeHeat(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const ch = chainOf(ctx);
  const ev = (c: CaseData): CaseEval => {
    const h8 = heatRun(p, ch, c.massLb, p.rideGoSlopeDeg * RAD);
    const h10 = heatRun(p, ch, c.massLb, p.rideMaxSlopeDeg * RAD);
    const h15 = heatRun(p, ch, c.massLb, 15 * RAD);
    const hOak = heatRun(p, ch, c.massLb, p.rideGoSlopeDeg * RAD, p.rideSpeedMph, 'oak');
    const ds: Detail[] = [
      detail(`continuous braking distance to ${f(p.brakeHeatLimitK, 0)} K at ${f(p.rideGoSlopeDeg, 0)}°`, h8.runFt, 'ft', p.rideRunFt, '>='),
      info(`same at ${f(p.rideMaxSlopeDeg, 0)}° (info)`, h10.runFt, 'ft'),
      info('same at 15° (info)', h15.runFt, 'ft'),
      info(`same at ${f(p.rideGoSlopeDeg, 0)}° with oak shoes (info)`, hOak.runFt, 'ft'),
    ];
    return {
      value: h8.runFt, unit: 'ft', limit: p.rideRunFt, sense: '>=', details: ds, marginalAbs: 0.1 * p.rideRunFt,
      how: `Surface rise ΔT = 2 q √t / (√π e). Power W·v·(sinθ − Crr cosθ) at ${f(p.rideSpeedMph, 0)} mph on ${f(p.rideGoSlopeDeg, 0)}° goes to the shoes; the hottest one takes ${f(h8.shoeW)} W. Partition ${f(h8.partition, 2)} into a lined steel-backed shoe (e = ${f(h8.effusivity, 0)} W·s^½/m²K), contact patch ${f(p.brakeHeatContactFrac, 2)} of ${f(h8.areaIn2, 1)} in² gives q = ${f(h8.qWm2, 0)} W/m². ΔT reaches ${f(p.brakeHeatLimitK, 0)} K after ${f(h8.timeS, 1)} s = ${f(h8.runFt, 0)} ft at ride speed (time ∝ 1/q²: a patch twice as large gives four times the run). Required ${f(p.rideRunFt, 0)} ft. Oak shoes on the same slope: ${f(hOak.runFt, 0)} ft. ${f(p.rideMaxSlopeDeg, 0)}°: ${f(h10.runFt, 0)} ft; 15°: ${f(h15.runFt, 0)} ft.`,
    };
  };
  return dualCheck({ id: 'brake-heat', label: 'Shoe heat: continuous braking distance on the envelope slope', group: 'Braking', refs: ['D-56', 'D-55'], primary: 'operating', ...evalBoth(ctx, ev) });
}

// ── park hold ────────────────────────────────────────────────────────────────────────────────────────

export function parkHold(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const th = p.designSlopeDeg * RAD;
  const ev = (c: CaseData): CaseEval => {
    const down = c.massLb * Math.sin(th);
    const hold = (mu: number) => (mu * c.massLb * Math.cos(th)) / down;
    return {
      value: hold(p.tireGroundMu), unit: '×', limit: 1.5, sense: '>=', marginalAbs: 0.1,
      details: [detail(`ground friction ÷ downslope pull, μ ${f(p.tireGroundMu, 2)}`, hold(p.tireGroundMu), '×', 1.5, '>='), info('same at μ 0.3 (info: wet leaves)', hold(0.3), '×')],
      how: `Parked on ${f(p.designSlopeDeg)}° with the ratchet set so all four wheels are locked (the pawl holds the main lever, which holds both axles): the ground holds with μ·W·cosθ = ${f(p.tireGroundMu, 2)} × ${f(c.massLb)} × ${f(Math.cos(th), 3)} = ${f(p.tireGroundMu * c.massLb * Math.cos(th))} lbf against W·sinθ = ${f(down)} lbf: ${f(hold(p.tireGroundMu), 2)}× (needs 1.5×). At μ 0.3 it is ${f(hold(0.3), 2)}×. Rear-only locked (the old brake) held 1.0× at the same μ with no margin. The hip lever sets the brake and the pawl catches it, but only the main lever's thumb tab releases the pawl: the handler releases.`,
    };
  };
  return dualCheck({ id: 'park-hold', label: 'Parking hold on the design slope (both axles locked)', group: 'Braking', refs: ['D-56', 'D-24'], primary: 'operating', ...evalBoth(ctx, ev) });
}

// ── front brake structure and housing ───────────────────────────────────────────────────────────────

export function frontBrakeCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const ch = chainOf(ctx);
  const fg = ch.fg;
  const sweep = frontBrakeSweep(ctx);
  const fyA = p.brakeSteelYieldPsi / p.steelSafetyFactor;
  const fyPin = p.brakeShoePinYieldPsi / p.steelSafetyFactor;
  const th = p.designSlopeDeg * RAD;
  const mbs = (d: number) => p.brakeCableBreakPsi * d * d;
  const circle = (d: number) => (Math.PI / 4) * d * d;
  const ev = (c: CaseData): CaseEval => {
    const lam = p.brakeLoadFactor;
    const nHold = (c.massLb * Math.sin(th)) / Math.min(p.brakePadMu, p.brakePadMuFouled);
    const bF = Math.max(ch.bias.fwd, ch.bias.rev);
    const Ns = (lam * nHold * bF) / 2; // per front shoe
    const mu = p.brakePadMu;
    const kMax = Math.max(fg.kFwd, fg.kRev);
    const sig = (sigma: 1 | -1) => ({ x: fg.n[0] + sigma * mu * fg.tFwd[0], z: fg.n[1] + sigma * mu * fg.tFwd[1] });
    const Fs = (sigma: 1 | -1) => { const q = sig(sigma); return [Ns * q.x, Ns * q.z] as [number, number]; };
    // Cable tension at the tail (per side), from the moment about the pivot; pivot reaction = shoe force + cable force.
    const Ts = (Ns * kMax) / Math.max(1e-6, fg.tailIn);
    const react = (sigma: 1 | -1) => { const F = Fs(sigma); const px = F[0] + Ts * fg.pull[0], pz = F[1] + Ts * fg.pull[1]; return Math.hypot(px, pz); };
    const Rpin = Math.max(Math.hypot(...Fs(1)), Math.hypot(...Fs(-1)));
    const Rpiv = Math.max(react(1), react(-1));
    const ahat: [number, number] = [fg.arm[0] / fg.armLen, fg.arm[1] / fg.armLen];
    const perp = Math.max(...[1, -1].map((s) => Math.abs(ahat[0] * Fs(s as 1 | -1)[1] - ahat[1] * Fs(s as 1 | -1)[0])));
    const axial = Math.max(...[1, -1].map((s) => Math.abs(ahat[0] * Fs(s as 1 | -1)[0] + ahat[1] * Fs(s as 1 | -1)[1])));
    const t = p.brakeBarThickIn, w = p.brakeBarWidthIn, dpin = p.frontBrakePivotPinDiaIn;
    const Snet = (t * (w ** 3 - dpin ** 3)) / (6 * w);
    const sigArm = ((perp / 2) * fg.armLen) / Snet + axial / 2 / (t * (w - dpin));
    // Pivot pin carried at both ends (horn mid and outboard plate mid): two arm loads R/2.
    const hornMid = Math.abs((fg.y.horn[0] + fg.y.horn[1]) / 2), armInMid = Math.abs((fg.y.armIn[0] + fg.y.armIn[1]) / 2), armOutMid = Math.abs((fg.y.armOut[0] + fg.y.armOut[1]) / 2);
    const plateMid = Math.abs(fg.y.armOut[1] + 0.13 + 0.125);
    const span = plateMid - hornMid;
    const P = Rpiv / 2;
    const R0 = (P * (plateMid - armInMid) + P * (plateMid - armOutMid)) / span;
    const R1 = 2 * P - R0;
    const Mpin = Math.max(R0 * (armInMid - hornMid), R1 * (plateMid - armOutMid));
    const sigPivotPin = (32 * Mpin) / (Math.PI * dpin ** 3);
    const tauPivotPin = Math.max(R0, R1) / circle(dpin);
    // Shoe pin between the two arms.
    const padW = fg.y.pad[1] - fg.y.pad[0];
    const dsp = p.brakeShoePinDiameterIn;
    const Mshoe = (Rpin * padW) / 8;
    const sigShoePin = (32 * Mshoe) / (Math.PI * dsp ** 3);
    const bearArm = Rpin / 2 / (dsp * t);
    // Horn: root moment of the pivot reaction about the boss; bolts as a couple 1 in apart.
    const armToRoot = Math.abs(fg.S[0] - fg.hornRoot[0]);
    const Mhorn = Rpiv * armToRoot;
    const sigHorn = (6 * Mhorn) / (HORN_T_IN * HORN_H_IN ** 2);
    const boltAt = 0.0524;
    const boltT = Mhorn / 1.0 / 2 / boltAt;
    // Cables: tension vs MBS/3.5 at the λ hold, and at the 100 lbf abuse pull on the main lever.
    const Tc = 2 * Ts;
    const abuseTc = ch.phi * p.brakeAbuseLbf * ch.g.lGrip / Math.max(1e-6, ch.g.dQ);
    const mFront = mbs(p.frontBrakeCableDiaIn);
    const comp = cableCompliance(ctx, ch, (c.massLb * Math.sin(th)) / p.brakePadMuFouled / (ch.Rcrit * ch.eta));
    const gripWithCable = ch.g.gripTravelIn + comp.extraGripMainIn;
    // Brake-steer: shoe force at the tread plane acts about the kingpin through the scrub; the equalizer keeps the two sides equal, imbalance steers.
    const groundScrub = L.front.ack.scrub - L.r * Math.tan(p.kingpinInclinationDeg * RAD);
    const Fwheel = (lam * nHold * bF) / 2 * mu; // ground brake force per front wheel at λ (in the member sizing case)
    const mHub = Fwheel * L.front.ack.scrub, mGround = Fwheel * groundScrub;
    const dMoment = 2 * p.frontBrakeImbalanceFrac * Fwheel * L.front.ack.scrub; // net steering moment about the kingpins for the imbalance
    const dragLink = dMoment / Math.max(1e-6, L.front.ack.armLen * Math.cos(L.front.ack.armAngleDeg * RAD));
    const ds: Detail[] = [
      detail('swing arm bending + axial at the pivot hole (each of two)', sigArm, 'psi', fyA, '<='),
      detail('pivot pin bending (supported at the horn and the yoke plate)', sigPivotPin, 'psi', fyPin, '<='),
      detail('pivot pin shear', tauPivotPin, 'psi', 0.577 * fyPin, '<='),
      detail('shoe pin bending (between the two arms)', sigShoePin, 'psi', fyPin, '<='),
      detail('shoe pin bearing on an arm', bearArm, 'psi', 0.9 * fyA, '<='),
      detail('horn bending at the spindle boss', sigHorn, 'psi', fyA, '<='),
      detail('horn boss bolts tension (2 × 5/16 in, 1 in apart)', boltT, 'psi', fyA, '<='),
      detail('cable tension at the tail ≤ break strength ÷ 3.5 (λ hold)', Tc, 'lbf', mFront / 3.5, '<='),
      detail('main cable at the 100 lbf abuse pull ≤ break strength ÷ 1.5', abuseTc, 'lbf', mFront / 1.5, '<='),
      detail('main grip travel with the front cable stretch', gripWithCable, 'in', p.brakeGripTravelMaxIn, '<='),
    ];
    if (sweep.on) {
      ds.push(
        detail('front shoe lining gap to the tread at its center, released (= front stroke)', sweep.shoeGapIn, 'in', p.frontShoeTravelIn - 0.03, '>='),
        detail('front shoe lining ends clear of the tread, released', sweep.shoeEndGapIn, 'in', 0.05, '>='),
        detail('arms, horn and pins to the tire', sweep.armToTireIn, 'in', 0.1, '>='),
        detail('front brake parts to the hull and chassis over the steering sweep', sweep.minToHullIn, 'in', 0.25, '>='),
        detail('housing loop bend radius (chord constant: clamp on the kingpin axis)', sweep.bendRadiusIn, 'in', p.frontBrakeHousingMinBendIn, '>='),
      );
    }
    ds.push(info('brake-steer moment per wheel about the kingpin, hub-height scrub (info)', mHub, 'lbf·in'), info('brake-steer moment per wheel, ground-level scrub (info)', mGround, 'lbf·in'),
      info(`net steering moment with ${f(p.frontBrakeImbalanceFrac * 100, 0)}% left/right imbalance (info)`, dMoment, 'lbf·in'), info('drag-link force from that imbalance (info)', dragLink, 'lbf'));
    return {
      ...{ ...governing(ds.filter((d) => d.limit > 0), `At the λ ${f(lam, 1)} hold load (${f(c.massLb)} lb on ${f(p.designSlopeDeg)}°, total N ${f(lam * nHold)} lbf, front share ${f(bF, 2)}): N per front shoe ${f(Ns)} lbf, shoe force on the pin ${f(Rpin)} lbf, pivot reaction ${f(Rpiv)} lbf. Arm ${f(fg.armLen, 2)}" with the pin ${f(fg.offsetIn, 2)}" off the tread tangent; cable tail ${f(fg.tailIn, 2)}" so the cable stroke ${f(fg.linkStrokeIn, 3)}" equals the rear link stroke; cable tension ${f(Ts)} lbf per side, ${f(Tc)} lbf in the main run (${p.frontBrakeCableDiaIn}" 7x19, break ${f(mFront, 0)} lbf). Stretch at the hold force: ${f(comp.frontStretchIn, 3)}" of cable and housing (${f(comp.mainLenIn, 0)}" main run + 2 × ${f(comp.outerLenIn, 0)}" outers at E_eff ${f(p.bowdenEffModulusPsi / 1e6, 1)} Mpsi), which adds ${f(comp.extraGripMainIn, 2)}" of main-grip travel. Brake-steer: each front wheel's ground brake force ${f(Fwheel, 1)} lbf acts ${f(L.front.ack.scrub, 1)}" (hub) / ${f(groundScrub, 2)}" (ground, after KPI) off the kingpin = ${f(mHub, 0)} / ${f(mGround, 0)} lbf·in per wheel; equal on both sides they cancel in the tie rod, a ${f(p.frontBrakeImbalanceFrac * 100, 0)}% imbalance leaves ${f(dMoment, 0)} lbf·in = ${f(dragLink, 1)} lbf in the drag link (a few lbf at the stick). Verify items: spindle brake boss geometry and strength, and the shoe part number.`), details: ds },
    };
  };
  return dualCheck({ id: 'brake-front', label: 'Front brake: arms, pins, horn, cables, housing, clearance', group: 'Structure', refs: ['D-56'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── hip lever and cable ──────────────────────────────────────────────────────────────────────────────

export function hipCableCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const ch = chainOf(ctx);
  const hg = ch.hg;
  const mbs = p.brakeCableBreakPsi * p.hipCableDiaIn ** 2;
  const th = p.designSlopeDeg * RAD;
  const ev = (c: CaseData): CaseEval => {
    const Tabuse = (100 * hg.armIn) / hg.cableArmIn;
    const sf = mbs / Tabuse;
    const hold = (c.massLb * Math.sin(th)) / p.brakePadMuFouled / (ch.Rcrit * ch.eta);
    const holdHip = hipFromMain(ch, hold);
    const comp = cableCompliance(ctx, ch, hold);
    // Lever: 1/4 x 1 in 6061-T6 bar bent by 100 lbf at the grip (yield level, SF 1), net of the 3/8 in pivot bore.
    const t = 0.25, w = 1.0, dpiv = 0.375, fyAl = 35000;
    const S = (t * (w ** 3 - dpiv ** 3)) / (6 * w);
    const sigLever = (100 * hg.armIn) / S;
    const shearPivot = (Tabuse + 100) / (2 * (Math.PI / 4) * dpiv ** 2); // bolt in double shear, cable + hand resultant (bound)
    const fyBolt = p.brakeSteelYieldPsi * 0.577;
    const slotSpare = hg.slotIn - hg.linkTravelIn;
    const ds: Detail[] = [
      detail('cable tension at the 100 lbf abuse pull: break strength ÷ tension ≥ 3.5', sf, '×', 3.5, '>='),
      detail('hip lever bending at the pivot bore, 100 lbf (aluminum yield)', sigLever, 'psi', fyAl, '<='),
      detail('hip pivot bolt double shear, 100 lbf bound', shearPivot, 'psi', fyBolt, '<='),
      detail('lost-motion slot minus the main lever link stroke (the main lever moves free of the cable)', slotSpare, 'in', 0.1, '>='),
      detail('hip lug travel left after the link stroke and the cable stretch', comp.hipReserveIn, 'in', 0, '>='),
      detail(`hip force to hold ${f(p.designSlopeDeg)}° (mud-fouled lining)`, holdHip, 'lbf', p.handleForceLimitLbf, '<='),
    ];
    return {
      ...governing(ds, `Hip grip ${f(hg.armIn, 1)}" from the pivot, cable lug ${f(hg.cableArmIn, 1)}" below it: a 100 lbf pull at the grip puts ${f(Tabuse)} lbf in the ${f(p.hipCableDiaIn, 4)}" cable (7x19 break ${f(mbs, 0)} lbf, factor ${f(sf, 2)}; 1/8" would be ${f((p.brakeCableBreakPsi * 0.125 ** 2) / Tabuse, 2)}). The link point is ${f(hg.linkAbove, 1)}" above the main lever pivot and moves ${f(hg.linkTravelIn, 3)}" over a full stroke; the slot is ${f(hg.slotIn, 1)}" so the handler's lever moves ${f(slotSpare, 2)}" free of the cable. The hip lever throw gives ${f(hg.lugTravelIn, 3)}" of cable; the full stroke needs ${f(hg.linkTravelIn, 3)}" plus ${f(comp.hipStretchIn, 3)}" of stretch at the hold force (${f(comp.hipLenIn, 0)}" run): ${f(comp.hipReserveIn, 3)}" left. Hold force ${f(hold)} lbf at the main grip = ${f(holdHip)} lbf at the hip grip (geometric ${f(hg.hipPerMain, 3)}, cable efficiency ${f(p.hipCableEfficiency, 2)}).`),
    };
  };
  return dualCheck({ id: 'hip-cable', label: 'Hip brake lever and cable', group: 'Structure', refs: ['D-56'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── lap belt anchor ──────────────────────────────────────────────────────────────────────────────────

export function beltAnchorCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const ch = chainOf(ctx);
  const bg = ch.bg;
  const ev = (c: CaseData): CaseEval => {
    const total = c.riderLb * p.beltDesignG;
    const per = total / 2;
    const d = p.beltAnchorBoltDiaIn;
    const At = (Math.PI / 4) * (d - 0.9743 / 16) ** 2; // 3/8-16 tensile area
    const perBolt = per / 2;
    const boltStress = perBolt / At;
    const dbl = bg.doubler;
    const oakUlt = p.oakCompPerpPsi * p.wetServiceFactorCompPerp * 2;
    const bearing = per / (dbl.lenIn * dbl.widIn);
    const sheetBend = (per / 2 * 0.45) / ((dbl.widIn * dbl.thickIn ** 2) / 6);
    const ds: Detail[] = [
      detail('anchor bolt tension (ultimate)', boltStress, 'psi', p.beltAnchorBoltUltPsi, '<='),
      detail('doubler bearing on the oak rail (ultimate)', bearing, 'psi', oakUlt, '<='),
      detail('doubler bending between the bolts (A36 ultimate)', sheetBend, 'psi', p.brakeSteelYieldPsi * 1.6, '<='),
      detail('webbing: break strength ÷ belt tension', p.beltWebbingBreakLbf / per, '×', 1, '>='),
    ];
    return { ...governing(ds, `Lap belt, fail-safe (ultimate, no safety factor): rider ${f(c.riderLb)} lb × ${f(p.beltDesignG, 1)} g = ${f(total)} lbf over two anchors = ${f(per)} lbf each, two ${f(d, 3)}" 316 bolts per anchor (${f(perBolt)} lbf each, tensile area ${f(At, 4)} in²) vertically through the deck and rail into a ${f(dbl.thickIn, 3)}" × ${f(dbl.lenIn, 0)}" × ${f(dbl.widIn, 2)}" doubler under the rail. The pull is forward and up; all of it is taken as tension (a bound).`) };
  };
  return dualCheck({ id: 'belt-anchor', label: 'Lap belt anchors (fail-safe, ultimate)', group: 'Structure', refs: ['D-55', 'D-56'], primary: 'goal', ...evalBoth(ctx, ev) });
}

/** The ride-mode brake rows: stop, emergency, bias, heat, park-hold, the front brake structure, the hip cable and the belt anchors. */
export function brakeRideRows(ctx: Ctx): AnalysisCheck[] {
  return [brakeEmergency(ctx), brakeStop(ctx), brakeBias(ctx), brakeHeat(ctx), parkHold(ctx), frontBrakeCheck(ctx), hipCableCheck(ctx), beltAnchorCheck(ctx)];
}

