/**
 * Stability checks: lateral tip (straight and at lock), slide-before-tip (A-1), turn rollover speed, forward and
 * rearward pitch. Geometry from `geometry.ts`, CG and mass from the load cases.
 */
import { worldAABB, partOBB } from '../model/bounds';
import type { Ctx } from './context';
import { dualCheck, singleCheck, type CaseEval } from './dual';
import { DEG, RAD, contactsAt, instantCentreY, lateralTip, outerEdgeDistance, sideEdges, turnGeometry, axleLoads } from './geometry';
import { f, g } from './format';
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
  const ev = (c: CaseData): CaseEval => {
    let best = { deg: Infinity, d: 0, h: 0, edge: '', sign: 1, x: 0, y: 0 };
    for (const s of [1, -1]) {
      const cg = c.cgAt(s * lock);
      const ct = contactsAt(contact, s * lock);
      const lat = lateralTip(ct, [cg[0], cg[1]], cg[2]);
      if (lat.deg < best.deg) best = { deg: lat.deg, d: lat.d, h: cg[2], edge: lat.edge, sign: s, x: cg[0], y: cg[1] };
    }
    return {
      value: best.deg, unit: '°', limit: p.tipLockMinDeg, sense: '>=',
      how: `θ = atan(d/h) = atan(${f(best.d, 2)} / ${f(best.h, 2)}) = ${f(best.deg)}°; polygon from the 4 contacts with the front pair rotated about the kingpin by ±${f(p.steerLockDeg)}° (${best.sign > 0 ? 'left' : 'right'} lock governs, edge ${best.edge}); min over all side edges and both lock directions. CG at lock (${f(best.x)}, ${f(best.y, 2)}). Limit ≥ ${p.tipLockMinDeg}°.`,
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
    const ic = instantCentreY(contact, o.sign * lock) ?? 0;
    const rCg = Math.hypot(o.cg[0], o.cg[1] - ic);
    const v = (r: number) => Math.sqrt(G_IN_S2 * r * o.ssf) / IN_S_PER_MPH;
    const v1 = v(rCg);
    return {
      value: v1, unit: 'mph', limit: p.rolloverSpeedFactor * jog, sense: '>=', info: true,
      how: `v = √(g·r·SSF) with g = 386.1 in/s², r_cg = ${f(rCg)}" (CG to the instant centre on the rear axle line, y = ${f(Math.abs(ic))}") and SSF_out = ${f(o.ssf, 2)}: v = ${f(v1, 1)} mph at r_min = ${f(v1 / jog, 2)}× a ${jog} mph jog (A-1 target 1.5× = ${f(p.rolloverSpeedFactor * jog, 1)} mph; reported, not pass/fail). At 2× r: ${f(v(2 * rCg), 1)} mph, 3× r: ${f(v(3 * rCg), 1)}, 4× r: ${f(v(4 * rCg), 1)} (SSF held at its full-lock value, conservative).`,
    };
  };
  return dualCheck({
    id: 'v-rollover', label: 'Turn rollover speed', group: 'Stability', refs: ['A-1', 'BRIEF §7'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

/** Turning radius at full lock (A-2): outer front tyre centre about the instant centre. */
export function turnRadius(ctx: Ctx): AnalysisCheck {
  const { p, contact } = ctx;
  const t = turnGeometry(contact, Math.abs(p.steerLockDeg) * RAD);
  const outer = t ? t.outerFront : Infinity;
  return singleCheck({
    id: 'turn-radius', label: 'Turning radius (outer front tyre)', group: 'Steering', refs: ['A-2', 'D-26'],
    value: outer, unit: 'in', limit: p.turnRadiusMaxIn, sense: '<=',
    how: t
      ? `Instant centre at y = ${f(t.icY)}" on the rear axle line (front axle line through the axle centre, which trails the kingpin by ${f(p.kingpinLeadIn, 2)}", meets x = 0 at ${f(p.steerLockDeg)}° lock). Outer front tyre-centre radius = ${f(t.outerFront)}" (${f(t.outerFront / 12, 2)} ft); rear-axle centre radius = ${f(t.rearCentre)}" (${f(t.rearCentre / 12, 2)} ft); inner front ${f(t.innerFront)}". Limit ≤ ${p.turnRadiusMaxIn}" (${f(p.turnRadiusMaxIn / 12, 1)} ft).`
      : 'No steering lock.',
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
    const margin = geo - (Math.tan(th) + aOverG);
    const tipSlope = Math.atan(geo - aOverG) * DEG;
    const deg = tipSlope - p.designSlopeDeg;
    return {
      value: deg, unit: '°', limit: 0, sense: '>=', marginalAbs: 5,
      how: `On ${f(p.designSlopeDeg)}° nose down, rear-only braking at its traction limit: N_r = W(cosθ·(L−x)/L − sinθ·h/L) = ${f(Nr)} lb, a/g = μ·N_r/W = ${f(p.tireGroundMu, 2)}·${f(Nr)}/${f(c.massLb)} = ${f(aOverG, 3)}. Margin (x_fc−x_cg)/h − (tanθ + a/g) = ${f(xfc - x, 1)}/${f(h, 2)} − (${f(Math.tan(th), 3)} + ${f(aOverG, 3)}) = ${f(margin, 3)}; equivalent slope angle atan((x_fc−x_cg)/h − a/g) − θ = ${f(tipSlope)}° − ${f(p.designSlopeDeg)}° = ${f(deg)}°. Must be > 0 (a is the traction limit, ignoring grade assist and load transfer: conservative).`,
    };
  };
  return dualCheck({
    id: 'pitch-fwd', label: 'Forward pitch-over, braking downhill', group: 'Stability', refs: ['BRIEF §7', 'D-13', 'D-24'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

/** Tongue tip (pull point) from the bridle part, or the front beam when absent: x of the bridle's rear end, z at its centre line. */
export function pullPoint(ctx: Ctx): { x: number; z: number } {
  const br = ctx.byId.get('bridle');
  if (br) {
    const b = worldAABB(br);
    return { x: b.min[0], z: partOBB(br).center[2] };
  }
  const bf = ctx.byId.get('beam-F');
  return bf ? { x: worldAABB(bf).max[0], z: ctx.L.beamF.top } : { x: ctx.L.WB, z: 0 };
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

export function pitchRear(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const pt = pullPoint(ctx);
  const ROPE_RUN_IN = 72;
  const alpha = Math.atan2(p.pullerHandHeightIn - pt.z, ROPE_RUN_IN);
  const limit = 2 * p.designSlopeDeg;
  const ev = (c: CaseData): CaseEval => {
    const [x, , h] = c.cg;
    const plain = Math.atan2(x, h) * DEG;
    const r = tipBackAngle(c.massLb, x, h, p.pullForceLbf, pt.x, pt.z, alpha);
    return {
      value: r.deg, unit: '°', limit, sense: '>=',
      how: `Nose up, pivot at the rear contacts. No pull: atan(x_cg/h) = atan(${f(x)}/${f(h, 2)}) = ${f(plain)}°. With the design pull T = ${p.pullForceLbf} lbf (D-14) at the tongue tip (${f(pt.x)}", ${f(pt.z, 2)}") angled α = atan((${p.pullerHandHeightIn}" hand − ${f(pt.z, 2)}")/72" rope) = ${f(alpha * DEG)}° above the ground, its lift moment is T(x_p sinα − z_p cosα) = ${g(r.liftMoment)} lb·in against W·√(x²+h²) = ${g(c.massLb * Math.hypot(x, h))}: tip-back slope = acos(M_lift/(W·ρ)) − atan(h/x) = ${f(r.deg)}°. Limit ≥ 2 × design slope = ${f(limit)}°.`,
    };
  };
  return dualCheck({
    id: 'pitch-rear', label: 'Rearward pitch, climbing', group: 'Stability', refs: ['BRIEF §7', 'D-14'], primary: 'operating',
    ...evalBoth(ctx, ev),
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
