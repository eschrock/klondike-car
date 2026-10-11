/**
 * Stability checks: lateral tip (straight and at lock), slide-before-tip (A-1), turn rollover speed, forward and
 * rearward pitch. Geometry from `geometry.ts`, CG and mass from the load cases.
 */
import { worldAABB, partOBB } from '../model/bounds';
import { instantCenters, solveSteer, wheelCenters } from '../model/ackermann';
import type { Ctx } from './context';
import { dualCheck, singleCheck, detail, type CaseEval } from './dual';
import { DEG, RAD, contactsAt, instantCenterY, lateralTip, outerEdgeDistance, sideEdges, turnGeometry, axleLoads } from './geometry';
import { f } from './format';
import type { CaseData } from './loads';
import type { AnalysisCheck } from './types';

const G_IN_S2 = 386.1;
const IN_S_PER_MPH = 17.6;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Evaluate `fn` at the operating and goal cases. */
export function evalBoth(ctx: Ctx, fn: (c: CaseData) => CaseEval) {
  return {
    operating: fn(ctx.loads.operating),
    goal: fn(ctx.loads.goal),
    operatingLabel: cap(ctx.loads.operating.label),
    goalLabel: cap(ctx.loads.goal.label),
  };
}

export function tipStraight(ctx: Ctx): AnalysisCheck {
  const { p, contact } = ctx;
  const ev = (c: CaseData): CaseEval => {
    const ct = contactsAt(contact, 0);
    const [x, y, h] = c.cg;
    const es = sideEdges(ct, [x, y]);
    const lat = lateralTip(ct, [x, y], h);
    const sides = es.map((e) => `${e.a}-${e.b} ${f(e.dist, 2)}"`).join(', ');
    return {
      value: lat.deg, unit: '°', limit: p.tipStraightMinDeg, sense: '>=',
      how: `θ = atan(d/h) = atan(${f(lat.d, 2)} / ${f(h, 2)}) = ${f(lat.deg)}°; d = CG distance to the nearest side edge of the 4-contact polygon at δ = 0 (${sides}); CG (${f(x)}, ${f(y, 2)}, ${f(h, 2)}) in, total ${f(c.massLb)} lb. Limit ≥ ${p.tipStraightMinDeg}°.`,
    };
  };
  return dualCheck({
    id: 'tip-straight', label: 'Lateral tip, straight', group: 'Stability', refs: ['BRIEF §7', 'A-3', 'D-1'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

export function tipLock(ctx: Ctx): AnalysisCheck {
  const { p, contact } = ctx;
  const lock = Math.abs(p.steerLockDeg) * RAD;
  // Ackermann front end (D-53): the tow lock (inner wheel angle), contacts from the solved wheel centers.
  const locks: { rad: number; name: string }[] = [{ rad: lock, name: 'tow lock' }];
  const ev = (c: CaseData): CaseEval => {
    let best = { deg: Infinity, d: 0, h: 0, edge: '', sign: 1, x: 0, y: 0, name: '' };
    for (const lk of locks) for (const s of [1, -1]) {
      const cg = c.cgAt(s * lk.rad);
      const ct = contactsAt(contact, s * lk.rad);
      const lat = lateralTip(ct, [cg[0], cg[1]], cg[2]);
      if (lat.deg < best.deg) best = { deg: lat.deg, d: lat.d, h: cg[2], edge: lat.edge, sign: s, x: cg[0], y: cg[1], name: lk.name };
    }
    const lockTxt = `the 4 contacts with the front wheel centers solved by the Ackermann linkage at the ${f(p.steerLockDeg)} deg tow lock (inner wheel; outer ${f(solveSteer(ctx.L.front.ack, p.steerLockDeg).outerDeg)} deg)`;
    return {
      value: best.deg, unit: '°', limit: p.tipLockMinDeg, sense: '>=',
      how: `θ = atan(d/h) = atan(${f(best.d, 2)} / ${f(best.h, 2)}) = ${f(best.deg)}°; ${lockTxt} (${best.sign > 0 ? 'left' : 'right'} lock governs, edge ${best.edge}); min over all side edges and both lock directions. CG at lock (${f(best.x)}, ${f(best.y, 2)}). Limit ≥ ${p.tipLockMinDeg}°.`,
    };
  };
  return dualCheck({
    id: 'tip-lock', label: 'Lateral tip at full lock', group: 'Stability', refs: ['BRIEF §7', 'A-3', 'D-1'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

/** SSF at the outer edge in a full-lock turn, min over both turn directions. */
function outerSsf(ctx: Ctx, c: CaseData) {
  const lock = Math.abs(ctx.p.steerLockDeg) * RAD;
  let best = { ssf: Infinity, d: 0, h: 0, sign: 1, cg: [0, 0, 0] as [number, number, number] };
  for (const s of [1, -1]) {
    const cg = c.cgAt(s * lock);
    const ct = contactsAt(ctx.contact, s * lock);
    const d = outerEdgeDistance(ct, [cg[0], cg[1]], s * lock);
    const ssf = d / cg[2];
    if (ssf < best.ssf) best = { ssf, d, h: cg[2], sign: s, cg };
  }
  return best;
}

export function slideBeforeTip(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const limit = p.slideMarginFactor * p.tireGroundMu;
  const ev = (c: CaseData): CaseEval => {
    const o = outerSsf(ctx, c);
    return {
      value: o.ssf, unit: '', limit, sense: '>=', marginalAbs: limit * 0.1,
      how: `SSF = d_outer / h = ${f(o.d, 2)} / ${f(o.h, 2)} = ${f(o.ssf, 2)} at full lock (outer edge = ${o.sign > 0 ? 'right' : 'left'} side, turning ${o.sign > 0 ? 'left' : 'right'}). Required ≥ ${f(p.slideMarginFactor, 1)} × μ_ground ${f(p.tireGroundMu, 2)} = ${f(limit, 2)}, so the cart skids before it can tip (A-1).`,
    };
  };
  return dualCheck({
    id: 'slide-before-tip', label: 'Slide before tip (static stability factor)', group: 'Stability', refs: ['A-1', 'D-16'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

export function vRollover(ctx: Ctx): AnalysisCheck {
  const { p, contact } = ctx;
  const lock = Math.abs(p.steerLockDeg) * RAD;
  const jog = p.jogSpeedMph;
  const ev = (c: CaseData): CaseEval => {
    const o = outerSsf(ctx, c);
    const ic = instantCenterY(contact, o.sign * lock) ?? 0;
    const rCg = Math.hypot(o.cg[0], o.cg[1] - ic);
    const v = (r: number) => Math.sqrt(G_IN_S2 * r * o.ssf) / IN_S_PER_MPH;
    const v1 = v(rCg);
    return {
      value: v1, unit: 'mph', limit: p.rolloverSpeedFactor * jog, sense: '>=', info: true,
      how: `v = √(g·r·SSF) with g = 386.1 in/s², r_cg = ${f(rCg)}" (CG to the instant center on the rear axle line, y = ${f(Math.abs(ic))}") and SSF_out = ${f(o.ssf, 2)}: v = ${f(v1, 1)} mph at r_min = ${f(v1 / jog, 2)}× a ${jog} mph jog (A-1 target 1.5× = ${f(p.rolloverSpeedFactor * jog, 1)} mph; reported, not pass/fail). At 2× r: ${f(v(2 * rCg), 1)} mph, 3× r: ${f(v(3 * rCg), 1)}, 4× r: ${f(v(4 * rCg), 1)} (SSF held at its full-lock value, conservative).`,
    };
  };
  return dualCheck({
    id: 'v-rollover', label: 'Turn rollover speed', group: 'Stability', refs: ['A-1', 'BRIEF §7'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

/**
 * Turning radius at full lock (A-2): swept radius of the outer front tire EDGE (curb to curb). The instant center lies on
 * the front axle line, so the radial direction at the front wheel is the axle direction and the outer edge is exactly
 * centerline + w/2. (A-2 originally called the tire center "conservative"; it is the less conservative reading.)
 */
export function turnRadius(ctx: Ctx): AnalysisCheck {
  const { p, contact } = ctx;
  const t = turnGeometry(contact, Math.abs(p.steerLockDeg) * RAD);
  const half = p.tireWidthIn / 2;
  const edge = t ? t.outerFront + half : Infinity;
  const lim = p.turnRadiusMaxIn;
  if (!t) return singleCheck({ id: 'turn-radius', label: 'Turning radius (outer tire edge, curb to curb)', group: 'Steering', refs: ['A-2', 'D-26', 'D-51', 'D-53'], value: Infinity, unit: 'in', limit: lim, sense: '<=', how: 'No steering lock.' });
  {
    // Ackermann (D-53): the two axle lines meet within about a foot of each other; pass/fail is the mean instant center, both are reported.
    const ack = ctx.L.front.ack;
    const sol = solveSteer(ack, Math.abs(p.steerLockDeg));
    const ic = instantCenters(ack, sol);
    const wc = wheelCenters(ack, sol);
    // Turning left: the right wheel is outer. Radius of the outer wheel center from each instant center, plus half the tire width.
    const edgeFrom = (y: number | null) => (y === null ? NaN : Math.hypot(wc.R[0], wc.R[1] - y) + half);
    const eL = edgeFrom(ic.fromLeft), eR = edgeFrom(ic.fromRight);
    return singleCheck({
      id: 'turn-radius', label: 'Turning radius (outer tire edge, curb to curb)', group: 'Steering', refs: ['A-2', 'D-26', 'D-51', 'D-53'],
      value: edge, unit: 'in', limit: lim, sense: '<=',
      details: [
        detail('outer front tire edge, mean instant center (pass/fail)', edge, 'in', lim, '<='),
        detail('outer front tire edge, from the left wheel axle line', eL, 'in', lim, '<='),
        detail('outer front tire edge, from the right wheel axle line', eR, 'in', lim, '<='),
        detail('rear-axle center', t.rearCenter, 'in', lim, '<='),
      ],
      how: `Ackermann at the ${f(p.steerLockDeg)} deg tow lock (inner wheel; outer ${f(sol.outerDeg, 2)} deg). The two wheel axle lines meet the rear axle line at y = ${f(ic.fromLeft ?? NaN)}" (left) and ${f(ic.fromRight ?? NaN)}" (right), a spread of ${f(Math.abs((ic.fromLeft ?? 0) - (ic.fromRight ?? 0)))}"; pass/fail uses the mean ${f(t.icY)}". Outer tire edge = distance of the outer wheel center (${f(wc.R[0])}, ${f(wc.R[1])}) from the instant center + w/2 ${f(half, 2)}" = ${f(edge)}" (${f(edge / 12, 2)} ft) with the mean; ${f(eL)}" (${f(eL / 12, 2)} ft) from the left axle line, ${f(eR)}" (${f(eR / 12, 2)} ft) from the right. Inner front centerline ${f(t.innerFront)}", rear-axle center ${f(t.rearCenter)}". Limit <= ${lim}" (${f(lim / 12, 1)} ft, D-51). Body corners and the tongue sweep wider than the tires and are not counted.`,
    });
  }
}

/** Rear contact load on a slope, nose down: N_r = W (cosθ (L − x)/L − sinθ h/L). */
export function rearNormalNoseDown(W: number, x: number, h: number, theta: number, L: number): number {
  return W * (Math.cos(theta) * (L - x) / L - Math.sin(theta) * h / L);
}

export function pitchForward(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const th = p.designSlopeDeg * RAD;
  const ct = contactsAt(ctx.contact, 0);
  const xfc = (ct.FL[0] + ct.FR[0]) / 2;
  const ev = (c: CaseData): CaseEval => {
    const [x, , h] = c.cg;
    const Nr = Math.max(0, rearNormalNoseDown(c.massLb, x, h, th, xfc));
    const aOverG = (p.tireGroundMu * Nr) / c.massLb;
    const geo = (xfc - x) / h;
    // Incipient front-over-the-axle tip in the slope frame (D'Alembert): forward force at the CG equals the ground braking force F_b,
    // so W cosθ (x_fc − x) = F_b h → tips when F_b/W exceeds geo·cosθ. The grade term is already inside F_b (no separate tanθ).
    const tipLimit = geo * Math.cos(th);
    const margin = tipLimit - aOverG;
    const thetaStar = Math.acos(Math.min(1, aOverG / geo)) * DEG;
    const deg = thetaStar - p.designSlopeDeg;
    return {
      value: deg, unit: '°', limit: 0, sense: '>=', marginalAbs: 5,
      how: `On ${f(p.designSlopeDeg)}° nose down, rear-only braking at its traction limit: N_r = W(cosθ·(L−x)/L − sinθ·h/L) = ${f(Nr)} lb, F_b/W = μ·N_r/W = ${f(p.tireGroundMu, 2)}·${f(Nr)}/${f(c.massLb)} = ${f(aOverG, 3)}. Tip threshold F_b/W = (x_fc−x_cg)/h · cosθ = ${f(xfc - x, 1)}/${f(h, 2)} · ${f(Math.cos(th), 3)} = ${f(tipLimit, 3)} (the grade is already inside F_b, so no tanθ term). Margin ${f(margin, 3)}. Equivalent angle = the slope at which that braking force would equal the threshold, acos((F_b/W)/geo) = ${f(thetaStar)}°, minus the design slope ${f(p.designSlopeDeg)}° = ${f(deg)}° (> 0 passes; F_b held at its design-slope value; static N_r ignores braking load transfer: conservative). Other forward-pitch loads: front-wheel bump hits are checked in the spindle, kingpin, bracket and beam rows; a rear handler holding the cart back on the ${f(p.rearHandleHeightIn)}" handle (about W·sinθ = ${f(c.massLb * Math.sin(th))} lbf) is reacted by the handler and is not checked here.`,
    };
  };
  return dualCheck({
    id: 'pitch-fwd', label: 'Forward pitch-over, braking downhill', group: 'Stability', refs: ['BRIEF §7', 'D-13', 'D-24'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

/** Tongue tip (pull point) from the bridle part, or the front beam when absent: x of the bridle's rear end, z at its center line. */
export function pullPoint(ctx: Ctx): { x: number; z: number } {
  // Tongue rig: the straight lead 'bridle' starts at the tongue tip. Rope rig: the legs are tied at the beam ends.
  const br = ctx.byId.get('bridle') ?? ctx.byId.get('bridle-L');
  if (br) {
    const b = worldAABB(br);
    return { x: b.min[0], z: partOBB(br).center[2] };
  }
  const bf = ctx.byId.get('beam-F');
  return bf ? { x: worldAABB(bf).max[0], z: ctx.L.front.beam.top } : { x: ctx.L.WB, z: 0 };
}

/**
 * Pitch-back tip angle with a pull. Balance about the rear contact when the front lifts:
 * W(x cosθ − h sinθ) = T(x_p sinα − z_p cosα)  (the pull's lift moment is independent of the pitch angle).
 */
export function tipBackAngle(W: number, x: number, h: number, T: number, xp: number, zp: number, alpha: number): { deg: number; liftMoment: number } {
  const C = T * (xp * Math.sin(alpha) - zp * Math.cos(alpha));
  const rho = Math.hypot(x, h);
  const beta = Math.atan2(h, x);
  const arg = Math.max(-1, Math.min(1, C / (W * rho)));
  return { deg: (Math.acos(arg) - beta) * DEG, liftMoment: C };
}

/**
 * Pull needed to lift the front wheels at slope θ (balance about the rear contact):
 * T_lift = W(x cosθ − h sinθ) / (x_p sinα − z_p cosα). Returns Infinity when the pull has no lift moment arm.
 */
export function liftPull(W: number, x: number, h: number, theta: number, xp: number, zp: number, alpha: number): number {
  const num = W * (x * Math.cos(theta) - h * Math.sin(theta));
  const den = xp * Math.sin(alpha) - zp * Math.cos(alpha);
  return den > 1e-9 ? num / den : num > 0 ? Infinity : 0;
}

export function pitchRear(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const pt = pullPoint(ctx);
  const run = p.bridleRopeRunIn;
  const alpha = Math.atan2(p.pullerHandHeightIn - pt.z, run);
  const th = p.designSlopeDeg * RAD;
  const limit = p.pitchPullMarginMin;
  const CAP = 99;
  const ev = (c: CaseData): CaseEval => {
    const [x, , h] = c.cg;
    const Tl = liftPull(c.massLb, x, h, th, pt.x, pt.z, alpha);
    const ratio = Math.min(CAP, Tl / p.pullForceLbf);
    const plain = Math.atan2(x, h) * DEG;
    const r = tipBackAngle(c.massLb, x, h, p.pullForceLbf, pt.x, pt.z, alpha);
    const steady = c.massLb * (Math.sin(th) + 0.06 * Math.cos(th));
    return {
      value: ratio, unit: '×', limit, sense: '>=',
      details: [detail('tip-back slope with the 150 lbf peak held constant', r.deg, '°', p.designSlopeDeg, '>=')],
      how: `Nose up on ${f(p.designSlopeDeg)}°, pivot at the rear contacts, W = ${f(c.massLb)} lb, CG (${f(x)}", ${f(h, 2)}"). The pull is at the tongue tip (${f(pt.x)}", ${f(pt.z, 2)}") angled α = atan((${p.pullerHandHeightIn}" hand − ${f(pt.z, 2)}") / ${p.bridleRopeRunIn}" rope run) = ${f(alpha * DEG)}° above the cart (D-14; rope run is the bridleRopeRunIn param). Pull needed to lift the front wheels: T_lift = W(x·cosθ − h·sinθ)/(x_p·sinα − z_p·cosα) = ${f(c.massLb * (x * Math.cos(th) - h * Math.sin(th)))} / ${f(pt.x * Math.sin(alpha) - pt.z * Math.cos(alpha), 2)} = ${Number.isFinite(Tl) ? f(Tl) : '∞'} lbf vs the ${p.pullForceLbf} lbf design peak (D-14): ${f(ratio, 2)}×. Limit ≥ ${f(limit, 2)}× (a surge that tries to lift the front must be this much bigger than the design peak). Details: with the peak pull held constant the tip-back slope is ${f(r.deg)}° (no pull: ${f(plain)}°); the steady pull on the slope is only ~${f(steady)} lbf.`,
    };
  };
  return dualCheck({
    id: 'pitch-rear', label: 'Rearward pitch: pull to lift the front (design slope)', group: 'Stability', refs: ['BRIEF §7', 'BRIEF §4.1', 'D-14'], primary: 'operating',
    ...evalBoth(ctx, ev),
    light: ev(ctx.loads.light), lightLabel: cap(ctx.loads.light.label),
  });
}

/** Static axle loads at δ = 0 and at lock, for the `cg` row (info). */
export function staticAxleText(ctx: Ctx, c: CaseData): string {
  const ct0 = contactsAt(ctx.contact, 0);
  const a0 = axleLoads(c.massLb, c.cg[0], (ct0.FL[0] + ct0.FR[0]) / 2);
  const lock = Math.abs(ctx.p.steerLockDeg) * RAD;
  const ctl = contactsAt(ctx.contact, lock);
  const cgl = c.cgAt(lock);
  const al = axleLoads(c.massLb, cgl[0], (ctl.FL[0] + ctl.FR[0]) / 2);
  return `front ${f(a0.front)} / rear ${f(a0.rear)} lb straight; at lock front ${f(al.front)} / rear ${f(al.rear)} lb (axle pairs split equally)`;
}
