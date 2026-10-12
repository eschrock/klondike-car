/**
 * Hull checks (Phase 3 round 2, D-43; the prow-grab check went with the prow, D-45): `hullChecks(ctx)` returns
 *  - lift:       the rear lifter's real share of the transport mass (CG-weighted, not mass / 2) × the dynamic factor, on the grip bar over
 *                the lift slot (bending and shear), for the rear and the front slot;
 *  - foot-stop:  rider restraint in a curb strike (rider × curb-strike g × foot-stop share): board bending between the sides, cleat bearing and
 *                the deck screws in lateral shear (operating and goal rider).
 * Every formula is written out in the `how` string; hull.test.ts works each one by hand with literal numbers.
 */
import { worldAABB } from '../model/bounds';
import { liftBarStressPsi, liftSlot } from '../model/body';
import type { Part } from '../model/types';
import type { Ctx } from './context';
import { dualCheck, governing, singleCheck, detail, type CaseEval } from './dual';
import { f } from './format';
import type { CaseData } from './loads';
import { allowables } from './structure';
import { bumpSeatG, bumpSeatGHard } from './bump';
import { tongueBarStress } from './bridle';
import { uncTensileArea } from './nds';
import type { AnalysisCheck, Detail } from './types';

/** Rear lifter's share of a carried mass: reaction at the rear hand-hold (xRear) for a CG at xCg between the two hand-holds (moments about the front one). */
export function liftShares(massLb: number, xCg: number, xRear: number, xFront: number): { rear: number; front: number } {
  const rear = (massLb * (xFront - xCg)) / (xFront - xRear);
  return { rear, front: massLb - rear };
}

/** Transport configuration (removable parts off): mass and CG x of the carried cart. */
export function transportMassCg(parts: Part[]): { massLb: number; xCg: number } {
  let m = 0, mx = 0;
  for (const x of parts) {
    if (x.payload || x.group === 'reference' || x.removable) continue;
    const bb = worldAABB(x);
    const cx = x.cgIn ? x.cgIn[0] : (bb.min[0] + bb.max[0]) / 2;
    m += x.massLb;
    mx += x.massLb * cx;
  }
  return { massLb: m, xCg: m > 0 ? mx / m : 0 };
}

export function liftCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const { massLb, xCg } = transportMassCg(ctx.parts);
  // The rear lifter's hands on the rear transom bar (mid-thickness); the front lifter carries through a rope loop in the bridle shackle at the tongue tip (D-56: there is no front hand-hold).
  const xr = L.xRear + L.transom / 2;
  const xf = L.tongue.holeX;
  const sh = liftShares(massLb, xCg, xr, xf);
  const rows: Detail[] = [];
  const s = liftSlot(ctx);
  const P = sh.rear * p.dynamicFactor; // one hand carries the whole share (conservative)
  const sigma = liftBarStressPsi(s, P);
  const V = P / 2;
  const tau = (1.5 * V) / (s.thickIn * s.barIn);
  rows.push(detail('rear slot bar bending', sigma, 'psi', al.oakBend, '<='));
  rows.push(detail('rear slot bar shear', tau, 'psi', al.oakShear, '<='));
  const Pf = sh.front * p.dynamicFactor;
  // Front: the load goes shackle pin > tie hole > tongue bar (a cantilever, weak axis) and the cart hangs from the nose by the thrust washer / kingpin.
  const d = p.eyeBoltDiameterIn;
  const Apin = (Math.PI * d * d) / 4;
  const tauPin = Pf / (2 * Apin);
  const pinAllow = (0.577 * p.eyeBoltYieldPsi) / p.steelSafetyFactor;
  rows.push(detail('front carry through the shackle pin (double shear)', tauPin, 'psi', pinAllow, '<='));
  const bar = tongueBarStress(ctx, Pf, 0, 0);
  rows.push(detail('front carry: tongue plate bending about its weak axis (A36)', bar.sigma, 'psi', p.bracketSteelYieldPsi / p.steelSafetyFactor, '<='));
  const kd = p.kingpinDiaIn;
  const At = uncTensileArea(kd);
  const sKing = Pf / At;
  rows.push(detail('front carry: kingpin in tension if the axle hangs from the nut (grade 8)', sKing, 'psi', p.grade8BoltYieldPsi / p.steelSafetyFactor, '<='));
  const nutA = (Math.PI / 4) * ((2.2 * kd) ** 2 - (kd + 1 / 16) ** 2);
  rows.push(detail('front carry: nut washer bearing on the oak slot ceiling (oak perpendicular)', Pf / nutA, 'psi', al.oakPerp, '<='));
  const how = `Transport mass ${f(massLb)} lb (removable parts off), CG ${f(xCg)}" ahead of the rear axle. Rear lifter's hands on the rear bar at x = ${f(xr, 2)}", front lifter through a rope loop in the bridle shackle at the tongue tip, x = ${f(xf, 2)}" (D-56: no front hand-hold). The rear lifter takes M·(x_f − x_cg)/(x_f − x_r) = ${f(sh.rear)} lb (${f((100 * sh.rear) / massLb, 0)}%), the front lifter ${f(sh.front)} lb. `
    + `Rear: ${f(P)} lbf on one hand (share × ${p.dynamicFactor}); bar ${f(s.thickIn, 2)}" × ${f(s.barIn, 2)}" over a ${f(s.lengthIn, 1)}" slot: M = P·L/4 = ${f(P * s.lengthIn / 4)} lb·in, σ = ${f(sigma, 0)} psi (≤ ${f(al.oakBend, 0)}), τ = 1.5·(P/2)/(t·h) = ${f(tau, 0)} psi (≤ ${f(al.oakShear, 0)}). `
    + `Front: ${f(Pf)} lbf at the tie: shackle pin ${f(d, 3)}" in double shear ${f(tauPin, 0)} psi (≤ ${f(pinAllow, 0)}); the tongue plate is a cantilever from the beam, bending about its thin axis ${f(bar.sigma, 0)} psi (≤ ${f(p.bracketSteelYieldPsi / p.steelSafetyFactor, 0)}) — lifting the nose by the tongue bends it; lift the front by the body instead. If the axle hangs from the kingpin nut the ${f(kd, 3)}" grade 8 bolt takes ${f(Pf)} lbf in tension (${f(sKing, 0)} psi, ≤ ${f(p.grade8BoltYieldPsi / p.steelSafetyFactor, 0)}) and the nut washer bears on the slot ceiling at ${f(Pf / nutA, 0)} psi (≤ ${f(al.oakPerp, 0)}).`;
  const g = governing(rows, how);
  return singleCheck({
    id: 'lift', label: 'Lifting the cart (rear hand-hold, front through the tongue shackle)', group: 'Structure',
    value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, details: rows, how, refs: ['D-37', 'D-43', 'D-56', 'BRIEF 4.4'],
  });
}

/** Numbers behind the foot-stop check for one rider mass, exported for the tests. */
export function footStopLoads(ctx: Ctx, riderLb: number, g: number) {
  const { p } = ctx;
  const board = ctx.byId.get('foot-stop');
  if (!board) return null;
  const bb = worldAABB(board);
  const span = bb.max[1] - bb.min[1], t = bb.max[0] - bb.min[0], h = bb.max[2] - bb.min[2];
  const F = riderLb * g * p.footStopShare;
  const M = (F * span) / 4;
  const S = (h * t * t) / 6;
  const cleats = ctx.parts.filter((x) => x.id.startsWith('foot-stop-cleat-'));
  // Cleats ahead of the board take the push in compression (cleat face on the board's front face); behind it they only hold it by tenons and screws.
  const ahead = cleats.filter((c) => worldAABB(c).min[0] >= bb.max[0] - 1e-6);
  const cleatArea = ahead.reduce((m, c) => { const b = worldAABB(c); return m + (b.max[1] - b.min[1]) * Math.min(b.max[2], bb.max[2]) - 0 * b.min[2]; }, 0);
  const contact = ahead.reduce((m, c) => { const b = worldAABB(c); return m + (b.max[1] - b.min[1]) * (Math.min(b.max[2], bb.max[2]) - Math.max(b.min[2], bb.min[2])); }, 0);
  void cleatArea;
  const screws = [board, ...cleats].reduce((n, x) => n + (x.joints ?? []).filter((j) => j.type === 'screw' && j.to === 'deck').reduce((a, j) => a + j.count, 0), 0);
  return { F, span, t, h, M, S, sigma: M / S, aheadCount: ahead.length, contact, bearing: contact > 0 ? F / contact : Infinity, screws, screwLoad: screws > 0 ? F / screws : Infinity };
}

export function footStopCheck(ctx: Ctx): AnalysisCheck | null {
  const { p } = ctx;
  const al = allowables(ctx);
  if (!ctx.byId.get('foot-stop')) return null;
  const ev = (c: CaseData): CaseEval => {
    const gN = bumpSeatG(ctx, c);
    const k = footStopLoads(ctx, c.riderLb, gN)!;
    const ds: Detail[] = [
      detail('foot-stop board bending between the sides', k.sigma, 'psi', al.oakBend, '<='),
      detail('deck screws in lateral shear (each)', k.screwLoad, 'lbf', p.woodScrewLateralLbf, '<='),
    ];
    if (k.aheadCount > 0) ds.push(detail('cleat bearing on the board face', k.bearing, 'psi', al.oakPerp, '<='));
    // Hard hit (D-50; no lap belt at 3c-1, D-53): the 2" rear hit's seat factor, wood to MOR x C_M with no safety factor.
    const gH = bumpSeatGHard(ctx, c);
    const kh = footStopLoads(ctx, c.riderLb, gH)!;
    ds.push(detail(`HARD 2" rear hit (seat factor ${f(gH, 2)}): foot-stop board bending (MOR x C_M, no safety factor)`, kh.sigma, 'psi', al.oakBend * p.woodSafetyFactor, '<='));
    const hardTxt = ` Hard hit: seat factor ${f(gH, 2)} gives ${f(kh.F)} lbf and ${f(kh.sigma, 0)} psi against ${f(al.oakBend * p.woodSafetyFactor, 0)} (no safety factor); the grab handles and seat friction take the rest.`;
    const how = `Bump: rider ${f(c.riderLb, 0)} lb × ${f(gN, 2)} g × foot-stop share ${p.footStopShare} = ${f(k.F)} lbf forward on the board (the rest goes through the grab handles and seat friction). `
      + `Board ${f(k.span, 1)}" between the sides, ${f(k.t, 2)}" × ${f(k.h, 1)}": M = F·L/4 = ${f(k.M)} lb·in, σ = M/(h·t²/6) = ${f(k.sigma, 0)} psi (≤ ${f(al.oakBend, 0)}). `
      + (k.aheadCount > 0 ? `${k.aheadCount} cleats ahead of the board bear on its face over ${f(k.contact, 1)} in²: ${f(k.bearing, 0)} psi (≤ ${f(al.oakPerp, 0)}). ` : 'No cleat stands ahead of the board: the load goes through the tenons and screws. ')
      + `${k.screws} #10 stainless deck screws share it in lateral shear: ${f(k.screwLoad)} lbf each (≤ ${f(p.woodScrewLateralLbf, 0)}).${hardTxt}`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'foot-stop', label: 'Foot stop and rider restraint (bump)', group: 'Structure', refs: ['D-40', 'D-43', 'eng S-foot'],
    primary: 'goal', operating: ev(ctx.loads.operating), goal: ev(ctx.loads.goal), operatingLabel: 'Operating rider', goalLabel: 'Goal rider',
  });
}

export function hullChecks(ctx: Ctx): AnalysisCheck[] {
  const fs = footStopCheck(ctx);
  return [liftCheck(ctx), ...(fs ? [fs] : [])];
}
