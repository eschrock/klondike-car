/**
 * Stability checks: lateral tip (worst steer angle of the pivoting front axle, D-56), slide-before-tip (A-1), turn rollover speed, turning radius (info), forward and
 * rearward pitch. Geometry from `geometry.ts`, CG and mass from the load cases.
 */
import { bridleTiePoint } from '../model/bridle';
import type { Ctx } from './context';
import { cargoOnlyCheck, dualCheck, singleCheck, detail, type CaseEval } from './dual';
import { DEG, RAD, contactsAt, contactsWorstTip, lateralTip, sideEdges, axleLoads, worstOuterEdge } from './geometry';
import { f } from './format';
import type { CaseData } from './loads';
import { SEVERITY, judge, utilization, type AnalysisCheck } from './types';

const G_IN_S2 = 386.1;
const IN_S_PER_MPH = 17.6;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Evaluate `fn` at the operating and goal cases, and (Phase 3c-2, D-53) at the cargo case: the worse of the cargo placements in `ctx.loads.cargoCases` (the payload
 * piled against the box, and against the nose end of the full-width bed). Pass `{ cargo: false }` for a row with its own cargo evaluation or none (seat rows).
 */
export function evalBoth(ctx: Ctx, fn: (c: CaseData) => CaseEval, opts: { cargo?: boolean } = {}) {
  const base = {
    operating: fn(ctx.loads.operating),
    goal: fn(ctx.loads.goal),
    operatingLabel: cap(ctx.loads.operating.label),
    goalLabel: cap(ctx.loads.goal.label),
  };
  const cases = ctx.loads.cargoCases;
  if (opts.cargo === false || !cases.length) return base;
  return { ...base, ...cargoWorst(cases, fn) };
}

/** Evaluate `fn` at each cargo placement and keep the one with the highest utilization (worst status first). */
export function cargoWorst(cases: CaseData[], fn: (c: CaseData) => CaseEval): { cargo: CaseEval; cargoLabel: string } {
  const evs = cases.map((c) => {
    const e = fn(c);
    return { c, e, status: e.info ? 'info' as const : judge(e.value, e.limit, e.sense, e.marginalAbs), util: utilization(e.value, e.limit, e.sense) };
  });
  const best = evs.reduce((a, b) => (SEVERITY[b.status] > SEVERITY[a.status] || (b.status === a.status && b.util > a.util) ? b : a));
  const others = evs.filter((x) => x !== best).map((x) => `${x.c.placement ?? 'cargo'}: ${Number.isFinite(x.util) ? Math.round(x.util * 100) : '∞'}%`).join('; ');
  return {
    cargo: { ...best.e, how: `[${best.c.placement ?? 'cargo'}] ${best.e.how}${others ? ` Other placement (${others}).` : ''}` },
    cargoLabel: cap(best.c.label),
  };
}

export function tipStraight(ctx: Ctx): AnalysisCheck {
  const { p, contact, L } = ctx;
  const lock = L.steer.lock;
  const ev = (c: CaseData): CaseEval => {
    const [x, y, h] = c.cg;
    const w = contactsWorstTip(contact, [x, y], h, lock);
    const s0 = contactsAt(contact, 0);
    const lat0 = lateralTip(s0, [x, y], h);
    const sides = sideEdges(w.contacts, [x, y]).map((e) => `${e.a}-${e.b} ${f(e.dist, 2)}"`).join(', ');
    return {
      value: w.deg, unit: '°', limit: p.tipStraightMinDeg, sense: '>=',
      how: `θ = atan(d/h) = atan(${f(w.d, 2)} / ${f(h, 2)}) = ${f(w.deg)}°; d = CG distance to the nearest side edge of the 4-contact polygon, worst over the steering range (the front axle turns about the kingpin, D-56: both front tires stay parallel, so the front contacts move with the steer angle; worst at ${f(w.steer * DEG, 0)}°, edge ${w.edge}: ${sides}; straight ahead ${f(lat0.deg)}°). Rear track ${f(contact.rearTrackIn, 1)}", front track ${f(contact.frontTrackIn, 1)}", wheelbase ${f(contact.wheelbaseIn, 1)}"; CG (${f(x)}, ${f(y, 2)}, ${f(h, 2)}) in, total ${f(c.massLb)} lb (CG shift from the turning axle neglected: about 0.02"). Limit ≥ ${p.tipStraightMinDeg}° at any steer angle from -${f(lock * DEG, 0)}° to +${f(lock * DEG, 0)}°.`,
    };
  };
  return dualCheck({
    id: 'tip-straight', label: 'Lateral tip (worst steer, +/- lock)', group: 'Stability', refs: ['BRIEF §7', 'A-3', 'D-1', 'D-56'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

/** Lateral tip at exactly full lock (D-56, A-3): the front axle at +/- the lock angle, the smaller of the two directions. `tip-straight` is the worst over the whole range. */
export function tipLock(ctx: Ctx): AnalysisCheck {
  const { p, contact, L } = ctx;
  const lock = L.steer.lock;
  const ev = (c: CaseData): CaseEval => {
    const [x, y, h] = c.cg;
    let best = { deg: Infinity, d: 0, edge: '', steer: 0 };
    for (const st of [lock, -lock]) {
      const lat = lateralTip(contactsAt(contact, st), [x, y], h);
      if (lat.deg < best.deg) best = { deg: lat.deg, d: lat.d, edge: lat.edge, steer: st };
    }
    return {
      value: best.deg, unit: '°', limit: p.tipLockMinDeg, sense: '>=',
      how: `θ = atan(d/h) = atan(${f(best.d, 2)} / ${f(h, 2)}) = ${f(best.deg)}° with the front axle turned ${f(best.steer * DEG, 0)}° (edge ${best.edge}; the front contacts at (${f(contact.wheelbaseIn - (contact.frontTrackIn / 2) * Math.sin(best.steer), 2)}, ${f((contact.frontTrackIn / 2) * Math.cos(best.steer), 2)}) and (${f(contact.wheelbaseIn + (contact.frontTrackIn / 2) * Math.sin(best.steer), 2)}, ${f(-(contact.frontTrackIn / 2) * Math.cos(best.steer), 2)}), both wheels parallel, D-56); the smaller of the two lock directions. CG (${f(x)}, ${f(y, 2)}, ${f(h, 2)}) in, ${f(c.massLb)} lb. Limit ≥ ${p.tipLockMinDeg}° (A-3).`,
    };
  };
  return dualCheck({
    id: 'tip-lock', label: 'Lateral tip at full lock', group: 'Stability', refs: ['BRIEF §7', 'A-3', 'D-1', 'D-56'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

/** SSF: the CG's distance to the outer support edge of a turn over its height, worst over the steering range. */
function outerSsf(ctx: Ctx, c: CaseData) {
  const o = worstOuterEdge(ctx.contact, [c.cg[0], c.cg[1]], ctx.L.steer.lock);
  return { ssf: o.d / c.cg[2], d: o.d, h: c.cg[2], edge: o.edge, steer: o.steer, cg: c.cg };
}

/**
 * The cargo LOAD-HEIGHT RULE (eng 3c S-5, D-62): the tip and slide-before-tip rows move a lot with the height of the cargo's center, which is an assumption (cargoCgHeightIn). This info row
 * solves for the cargo CG height above the deck at which (a) the lateral tip angle reaches its limit and (b) the static stability factor falls to the slide-before-tip limit, worst over the
 * cargo placements, and prints the tip angle at 10, 12, 18 and 24 in (the rule is 10 in since D-66), so the rule on the Simple view ("heavy things low, keep the load's center under X in") has numbers behind it.
 */
export function cargoHeightRule(ctx: Ctx): { tipLimitIn: number; slideLimitIn: number; atIn: Record<number, number> } | null {
  const { p, contact, L } = ctx;
  const cases = ctx.loads.cargoCases;
  if (!cases.length) return null;
  const lock = L.steer.lock;
  const withHc = (c: CaseData, hc: number): CaseData => ({ ...c, cg: [c.cg[0], c.cg[1], c.cg[2] + (c.cargoLb * (hc - p.cargoCgHeightIn)) / c.massLb] });
  const tipDeg = (c: CaseData, hc: number) => { const q = withHc(c, hc); return contactsWorstTip(contact, [q.cg[0], q.cg[1]], q.cg[2], lock).deg; };
  const ssf = (c: CaseData, hc: number) => outerSsf(ctx, withHc(c, hc)).ssf;
  const solve = (fn: (hc: number) => number, target: number): number => { // fn decreases with the height
    let lo = 0, hi = 80;
    if (fn(hi) >= target) return hi;
    if (fn(lo) <= target) return 0;
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (fn(mid) >= target) lo = mid; else hi = mid; }
    return lo;
  };
  const slideLimit = p.slideMarginFactor * p.tireGroundMu;
  const tipLimitIn = Math.min(...cases.map((c) => solve((hc) => tipDeg(c, hc), p.tipStraightMinDeg)));
  const slideLimitIn = Math.min(...cases.map((c) => solve((hc) => ssf(c, hc), slideLimit)));
  const atIn: Record<number, number> = {};
  for (const hc of [10, 12, 18, 24]) atIn[hc] = Math.min(...cases.map((c) => tipDeg(c, hc)));
  return { tipLimitIn, slideLimitIn, atIn };
}

export function cargoHeightCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const r = cargoHeightRule(ctx);
  if (!r) return cargoOnlyCheck({ id: 'cargo-height', label: 'Cargo load-height rule', group: 'Stability', value: 0, unit: 'in', limit: 0, sense: '>=', info: true, how: 'No cargo case in this design.', refs: ['eng 3c S-5'] });
  return cargoOnlyCheck({
    id: 'cargo-height', label: 'Cargo load-height rule (center of the load above the deck)', group: 'Stability', value: r.tipLimitIn, unit: 'in', limit: p.cargoCgHeightIn, sense: '>=', info: true, refs: ['eng 3c S-5', 'D-53', 'D-62'],
    details: [detail('cargo CG height at which the lateral tip angle reaches its limit', r.tipLimitIn, 'in', p.cargoCgHeightIn, '>='), detail('cargo CG height at which slide-before-tip is lost', r.slideLimitIn, 'in', p.cargoCgHeightIn, '>=')],
    how: `LOAD-HEIGHT RULE: heavy things low, on the deck, strapped down; keep the CENTER of the load under ${p.cargoCgHeightIn} in above the deck (the cargo case assumes exactly that, cargoCgHeightIn). Solving for the cargo center height (worst placement, the cargo 3 in off center): the lateral tip angle reaches its ${p.tipStraightMinDeg}° limit at ${f(r.tipLimitIn, 1)} in (so the ${p.cargoCgHeightIn} in rule keeps ${f(r.tipLimitIn - p.cargoCgHeightIn, 1)} in of margin on tipping); the static stability factor falls to the slide-before-tip limit (${f(p.slideMarginFactor * p.tireGroundMu, 2)}) at ${f(r.slideLimitIn, 1)} in, above which the sled can tip instead of skidding. Tip angle at 10 in ${f(r.atIn[10], 1)}°, at 12 in ${f(r.atIn[12], 1)}°, at 18 in ${f(r.atIn[18], 1)}°, at 24 in ${f(r.atIn[24], 1)}°. A cooler stack on firewood puts the center near 18 in: safe at walking pace, but no longer "slide before tip". Engrave or placard it on the sled.`,
  });
}

export function slideBeforeTip(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const limit = p.slideMarginFactor * p.tireGroundMu;
  const ev = (c: CaseData): CaseEval => {
    const o = outerSsf(ctx, c);
    return {
      value: o.ssf, unit: '', limit, sense: '>=', marginalAbs: limit * 0.1,
      how: `SSF = d / h = ${f(o.d, 2)} / ${f(o.h, 2)} = ${f(o.ssf, 2)} (outer edge ${o.edge} at ${f(o.steer * DEG, 0)}° steer: the worst over -lock to +lock with the front axle turned about the kingpin, D-56). Required ≥ ${f(p.slideMarginFactor, 1)} × μ_ground ${f(p.tireGroundMu, 2)} = ${f(limit, 2)}, so the sled skids before it can tip (A-1).`,
    };
  };
  return dualCheck({
    id: 'slide-before-tip', label: 'Slide before tip (static stability factor)', group: 'Stability', refs: ['A-1', 'D-16', 'D-56'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

export function vRollover(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const jog = p.jogSpeedMph;
  // Steady turn at full lock: the turning center is where the (parallel-wheel) axle line meets the rear axle line, centerRadiusIn = WB / tan(lock) to the side of the turn (D-56).
  const R0 = L.steer.centerRadiusIn;
  const ev = (c: CaseData): CaseEval => {
    const o = outerSsf(ctx, c);
    const icY = (o.steer >= 0 ? 1 : -1) * R0;
    const rCg = Math.hypot(o.cg[0], o.cg[1] - icY);
    const v = (r: number) => Math.sqrt(G_IN_S2 * r * o.ssf) / IN_S_PER_MPH;
    const v1 = v(rCg);
    return {
      value: v1, unit: 'mph', limit: p.rolloverSpeedFactor * jog, sense: '>=', info: true,
      how: `v = √(g·r·SSF) with g = 386.1 in/s², r_cg = ${f(rCg)}" (CG to the turning center on the rear axle line, ${f(R0)}" to the side = wheelbase / tan(lock), D-56) and SSF = ${f(o.ssf, 2)}: v = ${f(v1, 1)} mph (${f(v1 / jog, 2)}× a ${jog} mph jog; A-1 target 1.5× = ${f(p.rolloverSpeedFactor * jog, 1)} mph; reported, not pass/fail). At 2× r: ${f(v(2 * rCg), 1)} mph, 3× r: ${f(v(3 * rCg), 1)}.`,
    };
  };
  return dualCheck({
    id: 'v-rollover', label: 'Turn rollover speed', group: 'Stability', refs: ['A-1', 'BRIEF §7', 'D-56'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

/**
 * Turning (D-56): the front axle pivots about the kingpin with both wheels parallel (no Ackermann), so the turning center is where the axle line meets the rear axle line.
 * Center radius (to the rear axle center) = WB / tan(lock); outer tire edge = WB / sin(lock) + track/2 + tire/2. Pass/fail against `turnRadiusMaxIn` (A-2, relaxed by Eric to
 * 12.5 ft = 150 in on the outer tire edge for the +/-20 degree center-pivot axle; D-56).
 */
export function turnRadius(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const s = L.steer;
  const ft = (v: number) => `${f(v / 12, 1)} ft`;
  const rest = p.turnRadiusMaxIn - p.frontTrackIn / 2 - p.tireWidthIn / 2;
  const need = rest > p.wheelbaseIn ? Math.asin(Math.min(1, p.wheelbaseIn / rest)) * DEG : NaN;
  return singleCheck({
    id: 'turn-radius', label: 'Turning radius (outer tire edge, full lock)', group: 'Steering', refs: ['A-2', 'D-51', 'D-56'],
    value: s.outerEdgeRadiusIn, unit: 'in', limit: p.turnRadiusMaxIn, sense: '<=',
    how: `The axle turns ±${f(p.steerLockDeg, 0)}° about the kingpin with both wheels parallel, so the turning center is where the axle line meets the rear axle line: center radius (rear axle center) = WB / tan(lock) = ${f(p.wheelbaseIn)} / tan ${f(p.steerLockDeg, 0)}° = ${f(s.centerRadiusIn)}" (${ft(s.centerRadiusIn)}); outer tire edge = WB / sin(lock) + track/2 + tire/2 = ${f(p.wheelbaseIn / Math.sin(s.lock))} + ${f(p.frontTrackIn / 2, 2)} + ${f(p.tireWidthIn / 2, 2)} = ${f(s.outerEdgeRadiusIn)}" (${ft(s.outerEdgeRadiusIn)}); inner tire edge ${f(s.innerEdgeRadiusIn)}" (${ft(s.innerEdgeRadiusIn)}); turning circle about ${ft(2 * s.centerRadiusIn)} (outer edge ${ft(2 * s.outerEdgeRadiusIn)}). `
      + `Limit (A-2, relaxed by Eric for the center-pivot axle, D-56): outer tire edge <= ${f(p.turnRadiusMaxIn, 0)}" (${ft(p.turnRadiusMaxIn)})${Number.isFinite(need) ? `, which needs at least ${f(need, 1)}° of lock at this wheelbase and track` : ''}.`,
  });
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
      how: `On ${f(p.designSlopeDeg)}° nose down, rear-only braking at its traction limit: N_r = W(cosθ·(L−x)/L − sinθ·h/L) = ${f(Nr)} lb, F_b/W = μ·N_r/W = ${f(p.tireGroundMu, 2)}·${f(Nr)}/${f(c.massLb)} = ${f(aOverG, 3)}. Tip threshold F_b/W = (x_fc−x_cg)/h · cosθ = ${f(xfc - x, 1)}/${f(h, 2)} · ${f(Math.cos(th), 3)} = ${f(tipLimit, 3)} (the grade is already inside F_b, so no tanθ term). Margin ${f(margin, 3)}. Equivalent angle = the slope at which that braking force would equal the threshold, acos((F_b/W)/geo) = ${f(thetaStar)}°, minus the design slope ${f(p.designSlopeDeg)}° = ${f(deg)}° (> 0 passes; F_b held at its design-slope value; static N_r ignores braking load transfer: conservative). Other forward-pitch loads: front-wheel bump hits are checked in the kingpin, king-bearing, front-beam, front-stub and bridle-eye rows; a rear handler holding the sled back on the ${f(p.rearHandleHeightIn)}" handle (about W·sinθ = ${f(c.massLb * Math.sin(th))} lbf) is reacted by the handler and is not checked here.`,
    };
  };
  return dualCheck({
    id: 'pitch-fwd', label: 'Forward pitch-over, braking downhill', group: 'Stability', refs: ['BRIEF §7', 'D-13', 'D-24'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

/** The pull point: the bridle tie hole in the tongue (D-56): x of the hole, z of the shackle and rope center line, with the axle straight. */
export function pullPoint(ctx: Ctx): { x: number; z: number } {
  return bridleTiePoint(ctx);
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
      how: `Nose up on ${f(p.designSlopeDeg)}°, pivot at the rear contacts, W = ${f(c.massLb)} lb, CG (${f(x)}", ${f(h, 2)}"). The pull is at the tongue tie (${f(pt.x)}", ${f(pt.z, 2)}") angled α = atan((${p.pullerHandHeightIn}" hand − ${f(pt.z, 2)}") / ${p.bridleRopeRunIn}" rope run) = ${f(alpha * DEG)}° above the sled (D-14; rope run is the bridleRopeRunIn param). Pull needed to lift the front wheels: T_lift = W(x·cosθ − h·sinθ)/(x_p·sinα − z_p·cosα) = ${f(c.massLb * (x * Math.cos(th) - h * Math.sin(th)))} / ${f(pt.x * Math.sin(alpha) - pt.z * Math.cos(alpha), 2)} = ${Number.isFinite(Tl) ? f(Tl) : '∞'} lbf vs the ${p.pullForceLbf} lbf design peak (D-14): ${f(ratio, 2)}×. Limit ≥ ${f(limit, 2)}× (a surge that tries to lift the front must be this much bigger than the design peak). Details: with the peak pull held constant the tip-back slope is ${f(r.deg)}° (no pull: ${f(plain)}°); the steady pull on the slope is only ~${f(steady)} lbf.`,
    };
  };
  return dualCheck({
    id: 'pitch-rear', label: 'Rearward pitch: pull to lift the front (design slope)', group: 'Stability', refs: ['BRIEF §7', 'BRIEF §4.1', 'D-14'], primary: 'operating',
    ...evalBoth(ctx, ev),
    light: ev(ctx.loads.light), lightLabel: cap(ctx.loads.light.label),
  });
}

/** Static axle loads (steered straight; the front pivot turns about the kingpin at x = wheelbase), for the `cg` row (info). */
export function staticAxleText(ctx: Ctx, c: CaseData): string {
  const ct0 = contactsAt(ctx.contact, 0);
  const a0 = axleLoads(c.massLb, c.cg[0], (ct0.FL[0] + ct0.FR[0]) / 2);
  return `front ${f(a0.front)} / rear ${f(a0.rear)} lb (each axle pair splits equally)`;
}
