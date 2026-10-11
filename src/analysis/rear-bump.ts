/**
 * Rear-end rows on the bump basis (Phase 3b, D-50, spec 5.4): `wheel-rating` and `rear-beam-seat` re-based from "static x dynamicFactor" to the bump model
 * (normal 1 inch at full margins, hard 2 inch fail-safe). They are separate from rear.ts (WS-C's file) and replace its rows for the Ackermann front end;
 * rear.ts's versions are deleted at the Stage 2 flip together with the old front-end rows.
 */
import { beamSeat, boltLength, inchesText } from '../model/rear-mount';
import type { Ctx } from './context';
import { dualCheck, detail, governing, singleCheck, type CaseEval } from './dual';
import { RAD } from './geometry';
import { f } from './format';
import type { CaseData } from './loads';
import { evalBoth } from './stability';
import { allowables, wheelLoads } from './structure';
import { boltCapacity, cleavageVr } from './nds';
import { uncTensileArea } from './brake-mount';
import { bumpCases, bumpText, peakVertical, sensitivityText } from './bump';
import type { AnalysisCheck, Detail } from './types';

// ── wheel / hub rating ──────────────────────────────────────────────────────────────────────────────────────

export function wheelRatingBump(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const ev = (c: CaseData): CaseEval => {
    const w = wheelLoads(ctx, c);
    const rating = p.wheelRatingLb;
    const rows = (['front', 'rear'] as const).map((wh) => {
      const cs = bumpCases(ctx, c, wh);
      return { wh, static: wh === 'front' ? w.frontWheel : w.rearWheel, n: cs.normal, vTot: peakVertical(cs.normal), vHard: peakVertical(cs.hard) };
    });
    const worstStatic = rows.reduce((a, r) => (r.static > a.static ? r : a), rows[0]);
    const worstPeak = rows.reduce((a, r) => (r.vTot > a.vTot ? r : a), rows[0]);
    const side = p.tireGroundMu * worstStatic.static;
    const ds: Detail[] = [
      detail(`static load on the heavier wheel (${worstStatic.wh}) vs the vendor rating`, worstStatic.static, 'lb', rating, '<='),
      detail(`NORMAL 1" bump: peak vertical force (${worstPeak.wh}, bump V + static) vs ${f(p.wheelRatingPeakMult, 2)} x the rating`, worstPeak.vTot, 'lbf', rating * p.wheelRatingPeakMult, '<='),
      detail(`lateral skid mu P (mu ${f(p.tireGroundMu, 2)}) vs ${f(p.wheelSideRatingFrac, 2)} x the rating`, side, 'lbf', rating * p.wheelSideRatingFrac, '<='),
    ];
    const how = `Heavier wheel (${worstStatic.wh}): ${f(worstStatic.static)} lb static (front ${f(w.frontWheel)}, rear ${f(w.rearWheel)} lb) against an ASSUMED catalog rating of ${f(rating, 0)} lb per wheel (wheelRatingLb, verify on the vendor listing). `
      + rows.map((r) => `${bumpText(r.n, `${r.wh} 1" bump`, p)}, peak vertical with the static load ${f(r.vTot)} lbf (hard 2" hit: ${f(r.vHard)} lbf)`).join('; ')
      + `. The normal peak is held to ${f(p.wheelRatingPeakMult, 2)} x the rating = ${f(rating * p.wheelRatingPeakMult, 0)} lbf (assumed multiple: a rating is a continuous value with margin; drop-test a wheel). A hard hit is judged by wheel retention, not by this rating: a bent or flattened rim is accepted (D-50). Side load mu P = ${f(side)} lbf vs ${f(rating * p.wheelSideRatingFrac, 0)}. ${sensitivityText(ctx, c, worstPeak.wh, p.bumpNormalHeightIn)}`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'wheel-rating', label: 'Wheel and hub rating (vendor listing, assumed; bump basis)', group: 'Structure', refs: ['D-11', 'D-50', 'D-54'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── rear axle beam seat in the rails ────────────────────────────────────────────────────────────────────────

export function rearBeamSeatBump(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const seat = beamSeat(p, L);
  if (!seat) {
    return singleCheck({ id: 'rear-beam-seat', label: 'Rear axle beam seat and hold-downs', group: 'Structure', value: 0, unit: '', limit: 0, sense: '<=', info: true, how: 'Not evaluated: the beam is not underslung (no rail notch or hold-down in this configuration).', refs: ['D-15', 'D-48'] });
  }
  const al = allowables(ctx);
  const hd = seat.hd;
  const FvP = p.oakNdsShearPsi * p.ndsWetFactorShear * p.ndsLoadDurationFactor;
  const sf = p.steelSafetyFactor, ff = p.failSafeFactor;
  const unsprung = ctx.parts.filter((x) => /^(beam-R|axle-R|clamp-R|wheel-R)/.test(x.id)).reduce((a, x) => a + x.massLb, 0);
  const ev = (c: CaseData): CaseEval => {
    const w = wheelLoads(ctx, c);
    const cs = bumpCases(ctx, c, 'rear');
    const VrailN = peakVertical(cs.normal), VrailH = peakVertical(cs.hard); // the struck wheel's force goes into its rail
    const A = L.beamR.thick * seat.railT;
    const bearCeilN = VrailN / A, bearCeilH = VrailH / A;
    const Fx = p.brakeLoadFactor * c.massLb * Math.sin(p.designSlopeDeg * RAD);
    const wallA = seat.depth * seat.railT;
    const bearWall = Fx / 2 / wallA;
    const d = seat.remain + seat.depth, dn = seat.remain;
    const Vr = (2 / 3) * FvP * seat.railT * dn;
    // Rebound of the unsprung mass after the hit: unchanged (dynamicFactor x unsprung weight), scaled by the hard/normal ratio for the hard case.
    const reboundN = (unsprung * p.dynamicFactor) / 2;
    const reboundH = reboundN * (cs.hard.V / Math.max(1, cs.normal.V));
    const bd = hd.boltD;
    const At = uncTensileArea(bd);
    const tenAllowN = p.kingpinCrossBoltYieldPsi / sf, tenAllowH = p.holdDownBoltUltimatePsi / ff;
    const Tbeam = reboundN / hd.beamBolts.length, TbeamH = reboundH / hd.beamBolts.length;
    const washerA = (Math.PI / 4) * (1 - (bd + 1 / 16) ** 2);
    const capRail = boltCapacity(ctx, bd, seat.railT, hd.t, 90);
    const railBoltV = reboundN / hd.railBolts.length;
    const Fy = p.tireGroundMu * w.rearWheel;
    const Tside = Fy / hd.railBolts.length;
    const distCeil = hd.railBolts[0][1] - seat.zTop;
    const ds: Detail[] = [
      detail('NORMAL 1" rear bump: notch ceiling bearing on the beam top (oak perp, design)', bearCeilN, 'psi', al.oakPerp, '<='),
      detail('notch wall bearing, fore-aft braking load (oak perp on the beam)', bearWall, 'psi', al.oakPerp, '<='),
      detail('NORMAL: rail shear on the net section above the notch', VrailN, 'lbf', Vr, '<='),
      detail('NORMAL rebound: hold-down tension on each vertical bolt through the beam (316, yield / SF)', Tbeam, 'lbf', At * tenAllowN, '<='),
      detail('NORMAL rebound: washer under the beam (1" fender, oak perp)', Tbeam / washerA, 'psi', al.oakPerp, '<='),
      detail('NORMAL rebound: rail bolt shear vs NDS lateral capacity (perp to grain)', railBoltV, 'lbf', capRail.Z, '<='),
      detail('side skid pull on the rail bolts (316 tension)', Tside, 'lbf', At * tenAllowN, '<='),
      detail('side skid washer on the rail outer face (oak perp)', Tside / washerA, 'psi', al.oakPerp, '<='),
      detail('rail cleavage at the hold-down bolts (NDS 3.4.3.3, rebound)', reboundN, 'lbf', cleavageVr(FvP, seat.railT, distCeil), '<='),
      detail('HARD 2" rear hit: notch ceiling bearing (oak perp, no wood safety factor)', bearCeilH, 'psi', al.oakPerp * p.woodSafetyFactor, '<='),
      detail('HARD 2" rear hit: rail shear on the net section (no wood safety factor)', VrailH, 'lbf', Vr * p.woodSafetyFactor, '<='),
      detail('HARD rebound: hold-down tension on each vertical bolt (316 ultimate / fail-safe factor)', TbeamH, 'lbf', At * tenAllowH, '<='),
    ];
    const how = `Struck rear wheel ${bumpText(cs.normal, '1" bump', p)}: its V + static = ${f(VrailN)} lbf goes into its rail (hard 2" hit: ${f(VrailH)} lbf). The rail is NOTCHED ${f(seat.x1 - seat.x0, 2)}" wide x ${f(seat.depth, 2)}" deep on its underside and sits on the beam: the ceiling bears on ${f(L.beamR.thick, 2)}" x ${f(seat.railT, 2)}" = ${f(A, 2)} in2, ${f(bearCeilN, 0)} psi normal, ${f(bearCeilH, 0)} psi hard. `
      + `Fore-aft braking load lambda W sin(theta) = ${f(p.brakeLoadFactor, 1)} x ${f(c.massLb)} x sin ${f(p.designSlopeDeg)} deg = ${f(Fx)} lbf, ${f(Fx / 2)} lbf per notch wall = ${f(bearWall, 0)} psi. Rail left above the notch ${f(dn, 2)}" of ${f(d, 2)}": V_r = 2/3 F'v b d_n = ${f(Vr)} lbf. `
      + `Hold-down angles (316, ${f(hd.t, 3)}" x ${f(hd.leg, 2)}" legs): axle assembly ${f(unsprung)} lb x ${p.dynamicFactor} / 2 = ${f(reboundN)} lbf rebound per side (hard hit ${f(reboundH)}) on 2 x ${f(bd, 3)}" x ${inchesText(boltLength(hd.t + L.beamR.depth, bd))} bolts through the beam (${f(Tbeam)} lbf each normal, ${f(TbeamH)} hard; A_t ${f(At, 4)} in2) and 2 x ${f(bd, 3)}" bolts through the rail (${f(railBoltV)} lbf each vs NDS Z = ${f(capRail.Z)} lbf). A side skid mu P = ${f(Fy)} lbf pulls the beam outward against the rail bolts. ${sensitivityText(ctx, c, 'rear', p.bumpNormalHeightIn)}`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'rear-beam-seat', label: 'Rear axle beam seat in the rails and hold-down angles (bump basis)', group: 'Structure', refs: ['D-15', 'D-48', 'D-50', 'D-54'], primary: 'goal', ...evalBoth(ctx, ev) });
}
