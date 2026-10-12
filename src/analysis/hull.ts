/**
 * Hull checks (Phase 3 round 2, D-43; the prow-grab check went with the prow, D-45): `hullChecks(ctx)` returns
 *  - lift:       the rear lifter's real share of the transport mass (CG-weighted, not mass / 2) × the dynamic factor, on the grip bar over
 *                the lift slot (bending and shear), for the rear and the front slot;
 *  - foot-stop:  rider restraint in a bump (rider × bump g × foot-stop share) on the bow bulkhead (D-60: no foot block): plank bending between the sides, and the
 *                glue and Domino joints that hold the bulkhead on (operating and goal rider; D-57).
 * Every formula is written out in the `how` string; hull.test.ts works each one by hand with literal numbers.
 */
import { worldAABB } from '../model/bounds';
import { bowHold, liftBarStressPsi, liftSlot } from '../model/body';
import { innerHalfWidth, sideTopAt } from '../model/layout';
import type { Part } from '../model/types';
import type { Ctx } from './context';
import { dualCheck, governing, singleCheck, detail, type CaseEval } from './dual';
import { f } from './format';
import type { CaseData } from './loads';
import { allowables } from './structure';
import { bumpSeatG, bumpSeatGHard } from './bump';
import { evalBoth } from './stability';
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
  // not by the tongue). The hold is at the bulkhead's mid-thickness.
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
  const how = `Transport mass ${f(massLb)} lb (Transport mode: the removable brakes, lights, chocks and seat pad off; the tongue, signs and the parked handle on), CG ${f(xCg)}" ahead of the rear axle. Rear lifter's hands on the rear bar at x = ${f(xr, 2)}", front lifter's hands in the hand-hold through the bow bulkhead at x = ${f(xf, 2)}" (D-57, D-58: the nose is lifted by the body, not the tongue). Both lamps pop out of their hand-holds before the lift (the front lamp clip in the bow bulkhead, the rear one in the transom, D-64), so each lifter's hand has the whole slot. The rear lifter takes M·(x_f − x_cg)/(x_f − x_r) = ${f(sh.rear)} lb (${f((100 * sh.rear) / massLb, 0)}%), the front lifter ${f(sh.front)} lb. `
    + `Rear: ${f(P)} lbf on one hand (share × ${p.dynamicFactor}); bar ${f(s.thickIn, 2)}" × ${f(s.barIn, 2)}" over a ${f(s.lengthIn, 1)}" slot: M = P·L/4 = ${f(P * s.lengthIn / 4)} lb·in, σ = ${f(sigma, 0)} psi (≤ ${f(al.oakBend, 0)}), τ = 1.5·(P/2)/(t·h) = ${f(tau, 0)} psi (≤ ${f(al.oakShear, 0)}). `
    + `Front: ${f(Pf)} lbf on one hand; bulkhead ${f(bh.thickIn, 2)}" thick with ${f(bh.barIn, 2)}" of oak above the ${f(bh.lengthIn, 1)}" hand-hold (the crown at the center): M = P·L/4 = ${f(Pf * bh.lengthIn / 4)} lb·in, σ = ${f(sigmaF, 0)} psi (≤ ${f(al.oakBend, 0)}), τ = ${f(tauF, 0)} psi (≤ ${f(al.oakShear, 0)}).`;
  const g = governing(rows, how);
  return singleCheck({
    id: 'lift', label: 'Lifting the sled (rear hand-hold, front hand-hold in the bow bulkhead)', group: 'Structure',
    value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, details: rows, how, refs: ['D-37', 'D-43', 'D-57', 'D-58', 'BRIEF 4.4'],
  });
}

/**
 * Numbers behind the foot-stop check for one rider mass, exported for the tests. D-57: the foot brace is the rear face of the BOW BULKHEAD (an oak plank spanning the inside of the
 * hull, glued to the deck edge in a dado and to the ends of the rails, chine and gunwale). D-60: the drop-in foot block and its slot cleats are gone, so the bulkhead is the only brace.
 */
export function footStopLoads(ctx: Ctx, riderLb: number, g: number) {
  const { p, L } = ctx;
  const F = riderLb * g * p.footStopShare;
  const bulk = ctx.byId.get('bow-bulkhead');
  if (!bulk) return null;
  const spanIn = 2 * innerHalfWidth(L, L.bulkhead.x0);
  const t = L.bulkhead.thick;
  // The heels and toes press a band `footStopHeightIn` tall; the plank section that takes it is that tall (the lower strip of the bulkhead).
  // At mid-span the lift hand-hold is cut through that band, so the section there is the band less the part of the slot inside it.
  const band = Math.min(p.footStopHeightIn, L.bulkhead.zCorner - L.deckTop);
  const slotInBand = Math.max(0, Math.min(L.deckTop + band, L.hold.zTop) - Math.max(L.deckTop, L.hold.zBot));
  const h = band - slotInBand;
  const M = (F * spanIn) / 4;
  const S = (h * t * t) / 6;
  const dd = p.deckCaptureDepthIn;
  // The push on the bulkhead pulls it forward off its mates: the deck edge in its dado (glue on both faces of the tongue) and the 6 member ends (Dominos).
  const dadoArea = 2 * dd * 2 * innerHalfWidth(L, L.bulkhead.x0);
  const dominoPts = (bulk.joints ?? []).filter((j) => (j.type === 'domino' || j.type === 'mortise-tenon') && /^(rail|side)-/.test(j.to)).reduce((n, j) => n + j.count, 0);
  const tenonArea = 1; // glue area of one loose tenon or Domino in this part (in²): both long faces of about 1 in × 1/2 in; the 1 in band under the rail ends only takes a loose tenon
  // D-62: the sandwich side ends are butt-glued with a fillet (0.234 in bands take no Domino); what locks them is the full-height web in its stopped dado: 2 faces x dd x the web height, a side.
  const webH = sideTopAt(L, L.xSideEnd) - L.webCap - L.chineBot;
  const webDadoArea = 2 * 2 * dd * Math.max(0, webH);
  const jointArea = dominoPts * tenonArea + webDadoArea;
  return { F, span: spanIn, t, h, M, S, sigma: M / S, dadoArea, dadoShear: F / dadoArea, dominoPts, tenonArea, webDadoArea, dominoShear: jointArea > 0 ? F / jointArea : Infinity };
}

export function footStopCheck(ctx: Ctx): AnalysisCheck | null {
  const { p } = ctx;
  const al = allowables(ctx);
  if (!ctx.byId.get('bow-bulkhead')) return null;
  const ev = (c: CaseData): CaseEval => {
    const gN = bumpSeatG(ctx, c);
    const k = footStopLoads(ctx, c.riderLb, gN)!;
    const what = 'bow bulkhead';
    const ds: Detail[] = [
      detail(`${what} bending between the sides`, k.sigma, 'psi', al.oakBend, '<='),
      detail('deck-edge dado glue in shear (carrying the whole push)', k.dadoShear, 'psi', al.oakShear, '<='),
    ];
    if (k.dominoPts > 0 || k.webDadoArea > 0) ds.push(detail('rail ends (Domino / loose tenon) and side-web dado glue in shear (carrying the whole push)', k.dominoShear, 'psi', al.oakShear, '<='));
    // Hard hit (D-50; no lap belt at 3c-1, D-53): the 2" rear hit's seat factor, wood to MOR x C_M with no safety factor.
    const gH = bumpSeatGHard(ctx, c);
    const kh = footStopLoads(ctx, c.riderLb, gH)!;
    ds.push(detail(`HARD 2" rear hit (seat factor ${f(gH, 2)}): ${what} bending (MOR x C_M, no safety factor)`, kh.sigma, 'psi', al.oakBend * p.woodSafetyFactor, '<='));
    const hardTxt = ` Hard hit: seat factor ${f(gH, 2)} gives ${f(kh.F)} lbf and ${f(kh.sigma, 0)} psi against ${f(al.oakBend * p.woodSafetyFactor, 0)} (no safety factor); the grab boards and seat friction take the rest.`;
    const how = `Bump: rider ${f(c.riderLb, 0)} lb × ${f(gN, 2)} g × foot-stop share ${p.footStopShare} = ${f(k.F)} lbf forward on the ${what} (the rest goes through the grab boards and seat friction). `
      + `The ${what} spans ${f(k.span, 1)}" between the sides, ${f(k.t, 2)}" thick over a ${f(k.h, 1)}" band (the hand-hold slot is cut through it at mid-span): M = F·L/4 = ${f(k.M)} lb·in, σ = M/(h·t²/6) = ${f(k.sigma, 0)} psi (≤ ${f(al.oakBend, 0)}). `
      + `The push pulls the bulkhead forward off the hull: the deck edge in its ${p.deckCaptureDepthIn}" dado has ${f(k.dadoArea, 1)} in² of glue on the two faces of the tongue (${f(k.dadoShear, 0)} psi if it took it all, ≤ ${f(al.oakShear, 0)} shear)`
      + `, and the ${k.dominoPts} rail-end tenons (${f(k.dominoPts * k.tenonArea, 1)} in²) plus the two full-height web ends in their stopped dados (${f(k.webDadoArea, 1)} in² of glue; the 0.234 in oak bands are butt-glued and take no Domino, D-62) have ${f(k.dominoPts * k.tenonArea + k.webDadoArea, 1)} in² (${f(k.dominoShear, 0)} psi alone). `
      + hardTxt;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'foot-stop', label: 'Foot brace (bow bulkhead) and rider restraint (bump)', group: 'Structure', refs: ['D-40', 'D-43', 'D-57', 'eng S-foot'],
    primary: 'goal', operating: ev(ctx.loads.operating), goal: ev(ctx.loads.goal), operatingLabel: 'Operating rider', goalLabel: 'Goal rider',
  });
}

/**
 * The free 4 mm web between the chine and gunwale bands under a lean or kick and under cargo pressure (eng 3c N-1, D-62). The panel is a strip fixed at the two oak bands (the bands are
 * 0.625 in of glued sandwich, far stiffer than the 0.157 in ply), `free(x)` tall at x; it is checked where it is tallest outside the zone the transom supports (a panel within its own
 * height of the transom is held by it). Kick: sideKickLbf on a sideKickPatchIn patch at mid height, a line load over (patch + h/2) across the strip: fixed-fixed M = P' h / 8. Cargo: the payload
 * times cargoSideG over cargoSideContactIn x h as a uniform pressure: M = q h^2 / 12. Stress = 6 M / t^2 against the ply design bending stress.
 */
export function freeWebAt(ctx: Pick<Ctx, 'L'>, x: number): number {
  const { L } = ctx;
  return Math.max(0, sideTopAt(L, x) - L.railBand - (L.chineBot + L.chineH));
}

export function sideWebLoads(ctx: Ctx, cargoLb: number) {
  const { p, L } = ctx;
  const rearTx = L.xRear + L.transom;
  let best = { x: L.xSideEnd, h: 0 };
  for (let i = 0; i <= 120; i++) {
    const x = rearTx + ((L.xSideEnd - rearTx) * i) / 120;
    const h = freeWebAt(ctx, x);
    if (x - rearTx < h) continue; // held by the transom
    if (h > best.h) best = { x, h };
  }
  const t = p.panelPlyIn, h = best.h;
  const bEff = p.sideKickPatchIn + h / 2;
  const lineKick = p.sideKickLbf / bEff; // lbf per inch of strip width, at mid height
  const MKick = (lineKick * h) / 8;
  const Fc = cargoLb * p.cargoSideG;
  const q = h > 0 ? Fc / (p.cargoSideContactIn * h) : 0; // psi on the web
  const MCargo = (q * h * h) / 12;
  const sig = (M: number) => (6 * M) / (t * t);
  return { ...best, t, bEff, lineKick, MKick, sigKick: sig(MKick), Fc, q, MCargo, sigCargo: sig(MCargo) };
}

export function sideWebCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const ev = (c: CaseData): CaseEval => {
    const k = sideWebLoads(ctx, c.cargoLb);
    const ds: Detail[] = [
      detail(`kick / lean: ${f(p.sideKickLbf, 0)} lbf on a ${f(p.sideKickPatchIn, 0)} in patch, panel bending between the bands`, k.sigKick, 'psi', al.plyBend, '<='),
      detail(`cargo pressure: ${f(c.cargoLb, 0)} lb x ${f(p.cargoSideG, 2)} g on the side, panel bending between the bands`, k.sigCargo, 'psi', al.plyBend, '<='),
    ];
    const how = `The ${f(k.t * 25.4, 0)} mm okoume web is a strip fixed at the chine and gunwale bands (the sandwich is ${f(p.sideThicknessIn, 3)} in thick there, the ply 0.157 in), at its tallest ${f(k.h, 2)} in free height at x = ${f(k.x, 1)} in (not within its own height of the transom, which holds it). `
      + `Kick: ${f(p.sideKickLbf, 0)} lbf over a ${f(p.sideKickPatchIn, 0)} in patch spreads over ${f(k.bEff, 1)} in of strip = ${f(k.lineKick, 2)} lbf/in at mid height: M = P' h / 8 = ${f(k.MKick, 2)} lb.in/in, sigma = 6M/t^2 = ${f(k.sigKick, 0)} psi (ply design ${f(al.plyBend, 0)}). `
      + `Cargo: ${f(c.cargoLb, 0)} lb x ${f(p.cargoSideG, 2)} g = ${f(k.Fc)} lbf over ${f(p.cargoSideContactIn, 0)} in x ${f(k.h, 2)} in = ${f(k.q, 3)} psi: M = q h^2 / 12 = ${f(k.MCargo, 2)} lb.in/in, sigma = ${f(k.sigCargo, 0)} psi. A person sitting on the gunwale is not covered (the gunwale is not a seat).`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'side-web', label: 'Side web (4 mm panel between the oak bands): lean, kick and cargo pressure', group: 'Structure', refs: ['D-60', 'D-62', 'eng 3c N-1'],
    primary: 'goal', ...evalBoth(ctx, ev),
  });
}

export function hullChecks(ctx: Ctx): AnalysisCheck[] {
  const fs = footStopCheck(ctx);
  return [liftCheck(ctx), ...(fs ? [fs] : []), sideWebCheck(ctx)];
}
