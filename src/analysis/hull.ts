/**
 * Hull checks (Phase 3 round 2, D-43; the prow-grab check went with the prow, D-45): `hullChecks(ctx)` returns
 *  - lift:       the rear lifter's real share of the transport mass (CG-weighted, not mass / 2) × the dynamic factor, on the grip bar over
 *                the lift slot (bending and shear), for the rear and the front slot;
 *  - foot-stop:  rider restraint in a bump (rider × bump g × foot-stop share) on the bow bulkhead (or the drop-in foot block): plank bending between the sides, and the
 *                glue and Domino joints that hold the bulkhead on (operating and goal rider; D-57).
 * Every formula is written out in the `how` string; hull.test.ts works each one by hand with literal numbers.
 */
import { worldAABB } from '../model/bounds';
import { bowHold, liftBarStressPsi, liftSlot } from '../model/body';
import { innerHalfWidth } from '../model/layout';
import { FOOT_CLEAT_T_IN, FOOT_SLOT_DEPTH_IN, FOOT_SLOT_WALL_IN } from '../model/seat';
import type { Part } from '../model/types';
import type { Ctx } from './context';
import { dualCheck, governing, singleCheck, detail, type CaseEval } from './dual';
import { f } from './format';
import type { CaseData } from './loads';
import { allowables } from './structure';
import { bumpSeatG, bumpSeatGHard } from './bump';
import type { AnalysisCheck, Detail } from './types';

/** Rear lifter's share of a carried mass: reaction at the rear hand-hold (xRear) for a CG at xCg between the two hand-holds (moments about the front one). */
export function liftShares(massLb: number, xCg: number, xRear: number, xFront: number): { rear: number; front: number } {
  const rear = (massLb * (xFront - xCg)) / (xFront - xRear);
  return { rear, front: massLb - rear };
}

/** Transport configuration (removable parts off): mass and CG x of the carried sled. */
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
  // The rear lifter's hands on the rear transom bar (mid-thickness); the front lifter's hands in the hand-hold through the bow bulkhead (D-57, D-58: the nose is lifted by the body,
  // not by the tongue, which is unbolted for transport). The hold is at the bulkhead's mid-thickness.
  const xr = L.xRear + L.transom / 2;
  const xf = (L.hold.x0 + L.hold.x1) / 2;
  const sh = liftShares(massLb, xCg, xr, xf);
  const rows: Detail[] = [];
  const s = liftSlot(ctx);
  const P = sh.rear * p.dynamicFactor; // one hand carries the whole share (conservative)
  const sigma = liftBarStressPsi(s, P);
  const V = P / 2;
  const tau = (1.5 * V) / (s.thickIn * s.barIn);
  rows.push(detail('rear slot bar bending', sigma, 'psi', al.oakBend, '<='));
  rows.push(detail('rear slot bar shear', tau, 'psi', al.oakShear, '<='));
  const bh = bowHold(ctx);
  const Pf = sh.front * p.dynamicFactor;
  const sigmaF = liftBarStressPsi(bh, Pf);
  const tauF = (1.5 * (Pf / 2)) / (bh.thickIn * bh.barIn);
  rows.push(detail('front (bow bulkhead) hand-hold bar bending', sigmaF, 'psi', al.oakBend, '<='));
  rows.push(detail('front (bow bulkhead) hand-hold bar shear', tauF, 'psi', al.oakShear, '<='));
  const how = `Transport mass ${f(massLb)} lb (removable parts off, the tongue among them), CG ${f(xCg)}" ahead of the rear axle. Rear lifter's hands on the rear bar at x = ${f(xr, 2)}", front lifter's hands in the hand-hold through the bow bulkhead at x = ${f(xf, 2)}" (D-57, D-58: the nose is lifted by the body, not the tongue). The rear lifter takes M·(x_f − x_cg)/(x_f − x_r) = ${f(sh.rear)} lb (${f((100 * sh.rear) / massLb, 0)}%), the front lifter ${f(sh.front)} lb. `
    + `Rear: ${f(P)} lbf on one hand (share × ${p.dynamicFactor}); bar ${f(s.thickIn, 2)}" × ${f(s.barIn, 2)}" over a ${f(s.lengthIn, 1)}" slot: M = P·L/4 = ${f(P * s.lengthIn / 4)} lb·in, σ = ${f(sigma, 0)} psi (≤ ${f(al.oakBend, 0)}), τ = 1.5·(P/2)/(t·h) = ${f(tau, 0)} psi (≤ ${f(al.oakShear, 0)}). `
    + `Front: ${f(Pf)} lbf on one hand; bulkhead ${f(bh.thickIn, 2)}" thick with ${f(bh.barIn, 2)}" of oak above the ${f(bh.lengthIn, 1)}" hand-hold (the crown at the center): M = P·L/4 = ${f(Pf * bh.lengthIn / 4)} lb·in, σ = ${f(sigmaF, 0)} psi (≤ ${f(al.oakBend, 0)}), τ = ${f(tauF, 0)} psi (≤ ${f(al.oakShear, 0)}).`;
  const g = governing(rows, how);
  return singleCheck({
    id: 'lift', label: 'Lifting the sled (rear hand-hold, front hand-hold in the bow bulkhead)', group: 'Structure',
    value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, details: rows, how, refs: ['D-37', 'D-43', 'D-57', 'D-58', 'BRIEF 4.4'],
  });
}

/**
 * Numbers behind the foot-stop check for one rider mass, exported for the tests. D-57: the foot brace is the rear face of the BOW BULKHEAD (a 2" oak plank spanning the inside of the
 * hull, glued to the deck edge in a dado and to the ends of the rails, chine and gunwale), or the drop-in FOOT BLOCK in a slot when `footBlockSlot` is set.
 */
export function footStopLoads(ctx: Ctx, riderLb: number, g: number) {
  const { p, L } = ctx;
  const F = riderLb * g * p.footStopShare;
  const block = ctx.byId.get('foot-block');
  const bulk = ctx.byId.get('bow-bulkhead');
  if (!bulk) return null;
  const bb = worldAABB(block ?? bulk);
  const spanIn = block ? bb.max[1] - bb.min[1] : 2 * innerHalfWidth(L, L.bulkhead.x0);
  const t = block ? bb.max[0] - bb.min[0] : L.bulkhead.thick;
  // The heels and toes press a band `footStopHeightIn` tall; the plank section that takes it is that tall (the lower strip of the bulkhead).
  // At mid-span the lift hand-hold is cut through that band, so the section there is the band less the part of the slot inside it.
  const band = Math.min(p.footStopHeightIn, L.bulkhead.zCorner - L.deckTop);
  const slotInBand = Math.max(0, Math.min(L.deckTop + band, L.hold.zTop) - Math.max(L.deckTop, L.hold.zBot));
  const h = block ? bb.max[2] - bb.min[2] : band - slotInBand;
  const M = (F * spanIn) / 4;
  const S = (h * t * t) / 6;
  const dd = p.deckCaptureDepthIn;
  // The push on the bulkhead pulls it forward off its mates: the deck edge in its dado (glue on both faces of the tongue) and the 6 member ends (Dominos).
  const dadoArea = 2 * dd * 2 * innerHalfWidth(L, L.bulkhead.x0);
  const slotWallArea = block ? 2 * FOOT_SLOT_DEPTH_IN * h : 0;
  const slotWallSigma = block ? ((F / 2) * (h / 2)) / ((FOOT_CLEAT_T_IN * FOOT_SLOT_WALL_IN * FOOT_SLOT_WALL_IN) / 6) : 0;
  const dominoPts = (bulk.joints ?? []).filter((j) => (j.type === 'domino' || j.type === 'mortise-tenon') && /^(rail|side)-/.test(j.to)).reduce((n, j) => n + j.count, 0);
  const tenonArea = 1; // glue area of one loose tenon or Domino in this part (in²): both long faces of about 1 in × 1/2 in; the 1 in band under the rail ends only takes a loose tenon
  return { F, span: spanIn, t, h, M, S, sigma: M / S, block: !!block, dadoArea, dadoShear: F / dadoArea, dominoPts, tenonArea, dominoShear: dominoPts > 0 ? F / (dominoPts * tenonArea) : Infinity, slotWallArea, slotBearing: block ? F / slotWallArea : 0, slotWallSigma };
}

export function footStopCheck(ctx: Ctx): AnalysisCheck | null {
  const { p } = ctx;
  const al = allowables(ctx);
  if (!ctx.byId.get('bow-bulkhead')) return null;
  const ev = (c: CaseData): CaseEval => {
    const gN = bumpSeatG(ctx, c);
    const k = footStopLoads(ctx, c.riderLb, gN)!;
    const what = k.block ? 'foot block' : 'bow bulkhead';
    const ds: Detail[] = [
      detail(`${what} bending between the sides`, k.sigma, 'psi', al.oakBend, '<='),
      detail('deck-edge dado glue in shear (carrying the whole push)', k.dadoShear, 'psi', al.oakShear, '<='),
    ];
    if (k.dominoPts > 0) ds.push(detail('side and rail ends: Domino / loose-tenon glue in shear (carrying the whole push)', k.dominoShear, 'psi', al.oakShear, '<='));
    if (k.block) {
      ds.push(detail('slot wall bearing on the block end', k.slotBearing, 'psi', al.oakPerp, '<='));
      ds.push(detail('slot wall bending (cantilever from the cleat)', k.slotWallSigma, 'psi', al.oakBend, '<='));
    }
    // Hard hit (D-50; no lap belt at 3c-1, D-53): the 2" rear hit's seat factor, wood to MOR x C_M with no safety factor.
    const gH = bumpSeatGHard(ctx, c);
    const kh = footStopLoads(ctx, c.riderLb, gH)!;
    ds.push(detail(`HARD 2" rear hit (seat factor ${f(gH, 2)}): ${what} bending (MOR x C_M, no safety factor)`, kh.sigma, 'psi', al.oakBend * p.woodSafetyFactor, '<='));
    const hardTxt = ` Hard hit: seat factor ${f(gH, 2)} gives ${f(kh.F)} lbf and ${f(kh.sigma, 0)} psi against ${f(al.oakBend * p.woodSafetyFactor, 0)} (no safety factor); the grab boards and seat friction take the rest.`;
    const how = `Bump: rider ${f(c.riderLb, 0)} lb × ${f(gN, 2)} g × foot-stop share ${p.footStopShare} = ${f(k.F)} lbf forward on the ${what} (the rest goes through the grab boards and seat friction). `
      + `The ${what} spans ${f(k.span, 1)}" between the sides, ${f(k.t, 2)}" thick over a ${f(k.h, 1)}" band (the hand-hold slot is cut through it at mid-span): M = F·L/4 = ${f(k.M)} lb·in, σ = M/(h·t²/6) = ${f(k.sigma, 0)} psi (≤ ${f(al.oakBend, 0)}). `
      + `The push pulls the bulkhead forward off the hull: the deck edge in its ${p.deckCaptureDepthIn}" dado has ${f(k.dadoArea, 1)} in² of glue on the two faces of the tongue (${f(k.dadoShear, 0)} psi if it took it all, ≤ ${f(al.oakShear, 0)} shear)`
      + (k.dominoPts > 0 ? `, and the ${k.dominoPts} Dominos / loose tenons into the rail, chine and gunwale ends have ${f(k.dominoPts * k.tenonArea, 1)} in² (${f(k.dominoShear, 0)} psi alone). ` : '. ')
      + (k.block ? `The foot block's ends bear ${f(k.slotWallArea, 1)} in² on the slot walls (${f(k.slotBearing, 0)} psi, ≤ ${f(al.oakPerp, 0)}), each wall a ${FOOT_SLOT_WALL_IN}" cantilever ${f(k.slotWallSigma, 0)} psi. ` : '')
      + hardTxt;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'foot-stop', label: 'Foot brace (bow bulkhead) and rider restraint (bump)', group: 'Structure', refs: ['D-40', 'D-43', 'D-57', 'eng S-foot'],
    primary: 'goal', operating: ev(ctx.loads.operating), goal: ev(ctx.loads.goal), operatingLabel: 'Operating rider', goalLabel: 'Goal rider',
  });
}

export function hullChecks(ctx: Ctx): AnalysisCheck[] {
  const fs = footStopCheck(ctx);
  return [liftCheck(ctx), ...(fs ? [fs] : [])];
}
