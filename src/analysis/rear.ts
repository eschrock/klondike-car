/**
 * Rear-end checks (Phase 3 round 3): the rear axle beam's seat in the rails and its hold-down angles (build review r2 MUST-4, D-48), and the wheel / hub
 * rating row (eng review r2 N-7). Plain TypeScript, no three.js.
 */
import { beamSeat, boltLength, inchesText } from '../model/rear-mount';
import type { Ctx } from './context';
import { dualCheck, detail, governing, singleCheck, type CaseEval } from './dual';
import { RAD } from './geometry';
import { f } from './format';
import type { CaseData } from './loads';
import { evalBoth } from './stability';
import { allowables, wheelLoads } from './structure';
import { boltCapacity } from './front';
import { uncTensileArea } from './brake-mount';
import { cleavageVr } from './nds';
import type { AnalysisCheck, Detail } from './types';

// ── wheel / hub rating (N-7) ────────────────────────────────────────────────────────────────────────────────

export function wheelRating(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const ev = (c: CaseData): CaseEval => {
    const w = wheelLoads(ctx, c);
    const rows = [
      { tag: 'rear', P: w.rearWheel }, { tag: 'front', P: w.frontWheel },
    ];
    const worst = rows.reduce((a, r) => (r.P > a.P ? r : a), rows[0]);
    const rating = p.wheelRatingLb;
    const peak = worst.P * p.dynamicFactor;
    const side = p.tireGroundMu * worst.P;
    const ds: Detail[] = [
      detail(`static load on the heavier wheel (${worst.tag}) vs the vendor rating`, worst.P, 'lb', rating, '<='),
      detail(`dynamic peak (static × ${p.dynamicFactor}) vs ${f(p.wheelRatingPeakMult, 2)} × the rating`, peak, 'lbf', rating * p.wheelRatingPeakMult, '<='),
      detail(`lateral skid μ·P (μ ${f(p.tireGroundMu, 2)}) vs ${f(p.wheelSideRatingFrac, 2)} × the rating`, side, 'lbf', rating * p.wheelSideRatingFrac, '<='),
    ];
    const how = `Heavier wheel (${worst.tag}): ${f(worst.P)} lb static at this rider (rear ${f(w.rearWheel)} lb, front ${f(w.frontWheel)} lb, the front worse of level and nose-down on ${f(p.designSlopeDeg)}°; the CG offset loads one side), against an ASSUMED catalog rating of ${f(rating, 0)} lb per wheel (wheelRatingLb, status verify: READ IT OFF THE VENDOR LISTING for the exact 13" wheel; flat-free and pneumatic hand-truck wheels are listed anywhere from about 250 to 450 lb). Dynamic peak ${f(p.dynamicFactor, 1)} × ${f(worst.P)} = ${f(peak)} lbf is held to ${f(p.wheelRatingPeakMult, 2)} × the rating = ${f(rating * p.wheelRatingPeakMult, 0)} lbf (a rating is a continuous value with margin; the multiple is an assumption, ask the vendor or drop-test a wheel). A side load μ·P = ${f(p.tireGroundMu, 2)} × ${f(worst.P)} = ${f(side)} lbf acts on a hub bearing rated radially: held to ${f(p.wheelSideRatingFrac, 2)} × the rating = ${f(rating * p.wheelSideRatingFrac, 0)} lbf (assumed fraction, verify).`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'wheel-rating', label: 'Wheel and hub rating (vendor listing, assumed)', group: 'Structure', refs: ['D-11', 'eng r2 N-7'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

// ── rear axle beam seat in the rails (MUST-4) ───────────────────────────────────────────────────────────────

export function rearBeamSeat(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const seat = beamSeat(p, L);
  if (!seat) {
    return singleCheck({ id: 'rear-beam-seat', label: 'Rear axle beam seat and hold-downs', group: 'Structure', value: 0, unit: '', limit: 0, sense: '<=', info: true, how: 'Not evaluated: the beam is not underslung (no rail notch or hold-down in this configuration).', refs: ['D-15', 'D-48'] });
  }
  const al = allowables(ctx);
  const hd = seat.hd;
  const FvP = p.oakNdsShearPsi * p.ndsWetFactorShear * p.ndsLoadDurationFactor;
  const sf = p.steelSafetyFactor;
  const unsprung = ctx.parts.filter((x) => /^(beam-R|axle-R|clamp-R|wheel-R)/.test(x.id)).reduce((a, x) => a + x.massLb, 0);
  const ev = (c: CaseData): CaseEval => {
    const w = wheelLoads(ctx, c);
    const F = w.rearAxle * p.dynamicFactor;
    const V = F / 2; // per rail
    const A = L.beamR.thick * seat.railT;
    const bearCeil = V / A;
    const Fx = p.brakeLoadFactor * c.massLb * Math.sin(p.designSlopeDeg * RAD);
    const wallA = seat.depth * seat.railT;
    const bearWall = Fx / 2 / wallA;
    const d = seat.remain + seat.depth, dn = seat.remain;
    const Vr = (2 / 3) * FvP * seat.railT * dn;
    const rebound = (unsprung * p.dynamicFactor) / 2; // per side
    const bd = hd.boltD;
    const At = uncTensileArea(bd);
    const tenAllow = p.kingpinCrossBoltYieldPsi / sf;
    const Tbeam = rebound / hd.beamBolts.length;
    const washerA = (Math.PI / 4) * (1 - (bd + 1 / 16) ** 2);
    const capRail = boltCapacity(ctx, bd, seat.railT, hd.t, 90);
    const railBoltV = rebound / hd.railBolts.length;
    const Fy = p.tireGroundMu * w.rearWheel;
    const Tside = Fy / hd.railBolts.length;
    const distCeil = hd.railBolts[0][1] - seat.zTop;
    const ds: Detail[] = [
      detail('notch ceiling bearing on the beam top (oak ⊥ grain)', bearCeil, 'psi', al.oakPerp, '<='),
      detail('notch wall bearing, fore-aft braking load (oak ⊥ grain on the beam)', bearWall, 'psi', al.oakPerp, '<='),
      detail('rail shear on the net section above the notch (interior compression-face notch over a support)', V, 'lbf', Vr, '<='),
      detail('hold-down: rebound tension on each vertical bolt through the beam (316)', Tbeam, 'lbf', At * tenAllow, '<='),
      detail('hold-down: washer under the beam (1" fender, oak ⊥ grain)', Tbeam / washerA, 'psi', al.oakPerp, '<='),
      detail('hold-down: rail bolt shear vs NDS lateral capacity (rebound, ⊥ grain)', railBoltV, 'lbf', capRail.Z, '<='),
      detail('hold-down: side skid pull on the rail bolts (316 tension)', Tside, 'lbf', At * tenAllow, '<='),
      detail('hold-down: side skid washer on the rail outer face (oak ⊥ grain)', Tside / washerA, 'psi', al.oakPerp, '<='),
      detail('rail cleavage at the hold-down bolts (NDS 3.4.3.3)', rebound, 'lbf', cleavageVr(FvP, seat.railT, distCeil), '<='),
    ];
    const how = `Rear axle load ${f(w.rearAxle)} lb × ${p.dynamicFactor} = ${f(F)} lbf, ${f(V)} lbf into each rail. The rail is NOTCHED ${f(seat.x1 - seat.x0, 2)}" wide × ${f(seat.depth, 2)}" deep on its underside (the rail bottom is ${f(seat.depth, 2)}" below the beam top) and sits on the beam: the ceiling bears on ${f(L.beamR.thick, 2)}" × ${f(seat.railT, 2)}" = ${f(A, 2)} in² → ${f(bearCeil, 0)} psi. Fore-aft braking load λ·W·sinθ = ${f(p.brakeLoadFactor, 1)} × ${f(c.massLb)} × sin ${f(p.designSlopeDeg)}° = ${f(Fx)} lbf, all assumed on the rear beam, ${f(Fx / 2)} lbf per notch wall (${f(wallA, 2)} in²) = ${f(bearWall, 0)} psi on the beam side. Rail left above the notch ${f(dn, 2)}" of ${f(d, 2)}": net-section shear V_r = ⅔·F'v·b·d_n = ⅔ × ${f(FvP, 0)} × ${f(seat.railT, 2)} × ${f(dn, 2)} = ${f(Vr)} lbf (the notch is an interior one on the compression face over a support, not the tension-face end notch of NDS 3.4.3.2(b), so the d_n/d reduction does not apply; with it V_r would be ${f(Vr * dn / d)} lbf, and the glued chine / web / gunwale above the rail share the shear besides). Hold-down angles (316, ${f(hd.t, 3)}" × ${f(hd.leg, 2)}" legs): axle assembly ${f(unsprung)} lb (beam, rod, wheels, clamps) × ${p.dynamicFactor} / 2 = ${f(rebound)} lbf rebound per side on 2 × ${f(bd, 3)}" × ${inchesText(boltLength(hd.t + L.beamR.depth, bd))} bolts through the beam (${f(Tbeam)} lbf each, ${f(Tbeam / At, 0)} psi on A_t ${f(At, 4)} in², ≤ ${f(tenAllow, 0)}) and 2 × ${f(bd, 3)}" bolts through the rail (${f(railBoltV)} lbf each vs NDS Z = ${f(capRail.Z)} lbf at 90° to the grain, steel ${f(hd.t, 3)}", oak ${f(seat.railT, 2)}"). A side skid μ·P = ${f(p.tireGroundMu, 2)} × ${f(w.rearWheel)} = ${f(Fy)} lbf pulls the beam outward against the rail bolts in tension. The bracket stands clear of the straddling deck joists and sits on top of the rod, which it also retains.`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'rear-beam-seat', label: 'Rear axle beam seat in the rails and hold-down angles', group: 'Structure', refs: ['D-15', 'D-48', 'build r2 MUST-4'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}
