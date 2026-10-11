/** Braking checks: lever force to hold on the design slope (D-13) and rear-only traction when parked nose-down (D-24, info). */
import type { Ctx } from './context';
import { dualCheck, detail, type CaseEval } from './dual';
import { RAD, contactsAt } from './geometry';
import { f } from './format';
import type { CaseData } from './loads';
import { evalBoth, rearNormalNoseDown } from './stability';
import type { AnalysisCheck } from './types';

export function brakeForce(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const th = p.designSlopeDeg * RAD;
  const ev = (c: CaseData): CaseEval => {
    const down = c.massLb * Math.sin(th);
    const shoeN = down / p.brakePadMu;
    const F = shoeN / (p.brakeLeverRatio * p.brakeEfficiency);
    const WET_MU = 0.25;
    const Fwet = down / WET_MU / (p.brakeLeverRatio * p.brakeEfficiency);
    return {
      value: F, unit: 'lbf', limit: p.handleForceLimitLbf, sense: '<=',
      details: [
        detail('handle force at the design pad μ', F, 'lbf', p.handleForceLimitLbf, '<='),
        detail(`sensitivity: wet / snowy shoes μ ${WET_MU} (not pass/fail)`, Fwet, 'lbf', p.handleForceLimitLbf, '<='),
      ],
      how: `F = W·sinθ / μ_pad / (ratio · η) = ${f(c.massLb)} × sin ${f(p.designSlopeDeg)}° / ${f(p.brakePadMu, 2)} / (${f(p.brakeLeverRatio, 1)} × ${f(p.brakeEfficiency, 2)}) = ${f(down)} lbf downslope → ${f(shoeN)} lbf shoe normal force → ${f(F)} lbf at the handle. Limit ≤ ${p.handleForceLimitLbf} lbf. (Shoe friction acts at the tire radius, 1:1 with ground force, D-13. Lever ratio ${f(p.brakeLeverRatio, 1)}:1 is read as handle force to TOTAL shoe normal force: one lever on a cross shaft drives both shoes, each seeing half the shaft torque. Sensitivity: wet or snow-contaminated shoes at μ 0.25 need ${f(Fwet)} lbf at the handle.)`,
    };
  };
  return dualCheck({
    id: 'brake-force', label: 'Brake lever force to hold on the slope', group: 'Braking', refs: ['D-13', 'BRIEF §7'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

export function brakeTraction(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const th = p.designSlopeDeg * RAD;
  const ct = contactsAt(ctx.contact, 0);
  const xfc = (ct.FL[0] + ct.FR[0]) / 2;
  const ev = (c: CaseData): CaseEval => {
    const [x, , h] = c.cg;
    const Nr = Math.max(0, rearNormalNoseDown(c.massLb, x, h, th, xfc));
    const down = c.massLb * Math.sin(th);
    const ratio = (p.tireGroundMu * Nr) / down;
    const wet = (0.3 * Nr) / down;
    return {
      value: ratio, unit: '×', limit: 1, sense: '>=', info: true,
      how: `Parked nose-down on ${f(p.designSlopeDeg)}°, rear wheels only: N_r = W(cosθ·(L−x)/L − sinθ·h/L) = ${f(Nr)} lb; μ_ground·N_r = ${f(p.tireGroundMu, 2)} × ${f(Nr)} = ${f(p.tireGroundMu * Nr)} lbf vs W·sinθ = ${f(down)} lbf → ${f(ratio, 2)}× (${f(wet, 2)}× at wet-leaf μ 0.3). Info only (D-24); parked nose-up N_r is much larger.`,
    };
  };
  return dualCheck({
    id: 'brake-traction', label: 'Rear-only traction, parked nose-down', group: 'Braking', refs: ['D-24'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}
