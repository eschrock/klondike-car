/**
 * The resting-weight row (D-58, Eric 2026-10-11): an adult of `restLoadLb` (250 lb) (a) SITTING still anywhere on the deck or seat and (b) STANDING ON ONE FOOT (a 4 in x 10 in
 * footprint) anywhere on the deck, at STATIC load: no bump factor, the full material safety factors (the same design allowables as the other rows). Checked on the deck ply, the
 * joists, the rails, the axle beams, the stub rods, the wheels and the front axle pivot (the thrust disc and the king beam). The storage lid is NOT checked and NOT strengthened:
 * it carries the legend DO NOT STEP (engraved), so nobody is meant to stand on it (Eric).
 *
 * The weight is a point (the seat footprint or the foot patch) moved over the deck; the cart's own weight splits between the axles by its CG. Everything is linear in the
 * weight, so the maximum resting weight is found by bisection on the worst utilization (the cart's own weight is a constant part of the load).
 */
import { totalMass, centerOfGravity } from '../model/mass';
import type { Ctx } from './context';
import { detail, governing, singleCheck } from './dual';
import { f } from './format';
import { rectSection, circleSection, ssUdlCentered, ssPointMid, bendingStress, rectShear } from './beams';
import { allowables, effectiveStripWidth, maxDeckSpan, FOOT_ACROSS_IN, FOOT_ALONG_IN } from './structure';
import { cabinJoists } from './cargo';
import { discOf, kingNetSection } from './front';
import type { AnalysisCheck, Detail } from './types';

interface RestResult { details: Detail[]; maxUtil: number; text: string }

/** Evaluate the resting adult of weight W: every detail's utilization is demand / capacity at W. */
export function restEval(ctx: Ctx, W: number): RestResult {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const m = totalMass(ctx.parts);
  const xc = centerOfGravity(ctx.parts)[0];
  const WB = p.wheelbaseIn;
  const Tf = p.frontTrackIn, Tr = p.rearTrackIn;
  const xMin = L.xRear + L.transom + 6, xMax = L.xFlatEnd - 4;
  const yMax = Math.max(0, L.hwC - 6);

  // ── where the weight puts load on the axles (the worst position for each member) ──
  let wFront = 0, wRear = 0, nFront = 0, atF = '', atR = '', atN = '';
  for (let x = xMin; x <= xMax + 1e-9; x += 1) for (const y of [0, yMax]) {
    const fF = x / WB, fR = 1 - fF;
    const rear = (m * (1 - xc / WB)) / 2 + W * Math.max(0, fR) * (0.5 + y / Tr);
    const front = (m * (xc / WB)) / 2 + W * Math.max(0, fF) * (0.5 + y / Tf);
    const axle = m * (xc / WB) + W * Math.max(0, fF);
    if (rear > wRear) { wRear = rear; atR = `x = ${f(x, 0)}", ${f(y, 0)}" off center`; }
    if (front > wFront) { wFront = front; atF = `x = ${f(x, 0)}", ${f(y, 0)}" off center`; }
    if (axle > nFront) { nFront = axle; atN = `x = ${f(x, 0)}"`; }
  }
  const ds: Detail[] = [];
  const add = (name: string, value: number, unit: string, limit: number) => ds.push(detail(name, value, unit, limit, '<='));

  // ── deck ply (seated: the cushion footprint; standing: the foot patch at the middle of the widest bay) ──
  {
    const span = maxDeckSpan(ctx);
    const t = p.deckPlyIn;
    const sec12 = rectSection(12, t);
    const seatArea = p.seatDepthIn * L.seat.width;
    const wSeat = (W / seatArea) * Math.min(12, L.seat.width);
    const seat = ssUdlCentered(wSeat, p.seatDepthIn, span, al.Eply * sec12.I);
    add('seated: deck ply bending (the cushion footprint on the widest bay)', seat.M / sec12.S, 'psi', al.plyBend);
    const beff = effectiveStripWidth(FOOT_ACROSS_IN, span);
    const secF = rectSection(beff, t);
    const stand = ssUdlCentered(W / FOOT_ALONG_IN, FOOT_ALONG_IN, span, al.Eply * secF.I);
    add('standing on one foot: deck ply bending (the whole weight on a 4 in x 10 in patch, mid-bay)', stand.M / secF.S, 'psi', al.plyBend);
    add('standing on one foot: deck ply deflection', stand.defl, 'in', span / p.deflectionLimitRatio);
  }
  // ── joists ──
  {
    const j = cabinJoists(ctx);
    if (j) {
      const sec = rectSection(j.thickIn, j.depthIn);
      const EI = al.Eoak * sec.I;
      const a = Math.min(L.seat.width, j.spanIn);
      const cushion = L.seat.xFront - L.seat.xRear;
      const strip = Math.min(j.tribIn, cushion);
      const Q = (W * strip) / cushion;
      const seat = ssUdlCentered(Q / a, a, j.spanIn, EI);
      add('seated: joist bending (its strip of the cushion)', bendingStress(seat.M, sec), 'psi', al.oakBend);
      add('seated: joist shear', rectShear(seat.V, j.thickIn, j.depthIn), 'psi', al.oakShear);
      // the foot on the joist itself: the ply sends part of the weight to the neighbors, but take the whole weight on a 10 in patch at the middle of one joist (conservative)
      const stand = ssUdlCentered(W / FOOT_ACROSS_IN, FOOT_ACROSS_IN, j.spanIn, EI);
      add('standing on one foot: joist bending (the whole weight on a 10 in patch at its middle)', bendingStress(stand.M, sec), 'psi', al.oakBend);
      add('standing on one foot: joist shear', rectShear(stand.V, j.thickIn, j.depthIn), 'psi', al.oakShear);
    }
  }
  // ── rails: a beam on the rear axle (hangers) and the king beam, overhanging in front; the weight at the worst x on the worse rail ──
  {
    const b = p.railThicknessIn, h = p.railDepthIn, hF = L.railDepthF;
    const selfLb = ctx.parts.reduce((s, x) => (x.body === 'chassis' && !x.payload && x.group !== 'reference' && x.group !== 'running-gear' ? s + x.massLb : s), 0);
    const w = selfLb / 2 / WB; // lb/in per rail, over the span
    let worst = 0, worstV = 0, at = '';
    for (let xl = xMin; xl <= xMax + 1e-9; xl += 1) {
      const share = 0.5 + yMax / (2 * (L.hwC + L.side - b)); // the worse rail's share of a weight yMax off center
      const P = W * share;
      const R0 = (P * (WB - xl)) / WB; // reaction at the rear support (negative = uplift) for a point load at xl, supports at 0 and WB, overhang beyond WB
      for (let xs = 0; xs <= L.railEnd + 1e-9; xs += 1) {
        // sagging positive: the point load, plus the rail's share of the chassis weight over the span
        const M = xs <= WB ? R0 * xs - P * Math.max(0, xs - xl) + (w * xs * (WB - xs)) / 2 : -P * Math.max(0, xl - xs);
        const S = xs >= L.railStepX ? (b * hF * hF) / 6 : (b * h * h) / 6;
        const sig = Math.abs(M) / S;
        if (sig > worst) { worst = sig; at = `load at x = ${f(xl, 0)}", section at x = ${f(xs, 0)}"`; }
      }
      const V = Math.max(Math.abs(R0), P);
      const tau = rectShear(V, b, hF);
      if (tau > worstV) worstV = tau;
    }
    add(`rails bending (the weight on the worse rail, ${at})`, worst, 'psi', al.oakBend);
    add('rails shear in the shallow section at the king beam', worstV, 'psi', al.oakShear);
  }
  // ── axle beams, stub rods, wheels ──
  {
    const bF = L.beamF, kd = p.kingpinDiaIn;
    const secK = (Math.max(0.1, bF.thick - kd) * bF.depth ** 2) / 6;
    add(`front axle beam bending at the kingpin hole (heavier front wheel ${f(wFront)} lb at ${atF})`, (wFront * (Tf / 2)) / secK, 'psi', al.oakBend);
    const bR = L.beamR;
    const hangerY = L.hwC + L.side - p.railThicknessIn - p.axleHangerThickIn / 2;
    const lever = Math.max(0.5, Tr / 2 - hangerY);
    const secR = (bR.thick * Math.max(0.1, bR.depth - p.axleDiameterIn) ** 2) / 6;
    add(`rear axle beam bending between the hanger and the wheel (heavier rear wheel ${f(wRear)} lb at ${atR})`, (wRear * lever) / secR, 'psi', al.oakBend);
    add('rear axle beam shear at the hanger', rectShear(wRear, bR.thick, bR.depth), 'psi', al.oakShear);
    const rod = circleSection(p.axleDiameterIn);
    const aF = Math.max(0.01, Tf / 2 - bF.len / 2), aR = Math.max(0.01, Tr / 2 - bR.len / 2);
    add('front stub axle bending', bendingStress(wFront * aF, rod), 'psi', al.steel);
    add('rear stub axle bending', bendingStress(wRear * aR, rod), 'psi', al.steel);
    add('wheel: static load on the heavier wheel vs the vendor rating', Math.max(wFront, wRear), 'lb', p.wheelRatingLb);
  }
  // ── the front axle pivot: the thrust disc and the king beam carry the front axle load; the kingpin carries no vertical load ──
  {
    const disc = discOf(ctx);
    add(`front pivot: UHMW thrust disc pressure (front axle ${f(nFront)} lb, weight at ${atN})`, nFront / disc.Ac, 'psi', p.steerBearingAllowPsi);
    add('front pivot: the oak under the disc (oak perpendicular)', nFront / disc.Ac, 'psi', al.oakPerp);
    const net = kingNetSection(ctx);
    const span = 2 * (L.steer.railYIn - L.turnIn(L.king.x + L.king.len / 2));
    const kb = ssPointMid(nFront, span, al.Eoak * net.I);
    add('front pivot: king beam bending (the front axle load at midspan, net section)', (kb.M * net.c) / net.I, 'psi', al.oakBend);
  }
  const maxUtil = Math.max(...ds.map((d) => d.util));
  return { details: ds, maxUtil, text: `cart ${f(m)} lb, CG x = ${f(xc, 1)}"` };
}

/** The most the cart holds at rest with the full margins (lb): the weight at which the worst detail reaches its limit. */
export function restMaxLb(ctx: Ctx): number {
  let lo = 0, hi = 4000;
  if (restEval(ctx, hi).maxUtil <= 1) return hi;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (restEval(ctx, mid).maxUtil <= 1) lo = mid; else hi = mid; }
  return lo;
}

export function restLoadCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const W = p.restLoadLb;
  const r = restEval(ctx, W);
  const maxLb = restMaxLb(ctx);
  const ds: Detail[] = [detail('the resting weight the cart holds with every margin (the worst member reaches its limit)', W, 'lb', maxLb, '<='), ...r.details];
  const g = governing(ds, '');
  const worst = r.details.reduce((a, b) => (b.util > a.util ? b : a));
  const how = `An adult of ${f(W, 0)} lb (restLoadLb, Eric 2026-10-11) at REST: (a) sitting still anywhere on the deck or seat, (b) standing on one foot (the whole weight on a ${FOOT_ALONG_IN} in x ${FOOT_ACROSS_IN} in patch) anywhere on the deck, worst position for each member. Static load: no bump factor, the same design allowables (full safety factors) as the other rows; the cart's own weight (${r.text}) is carried with it. `
    + `The cart holds up to ${f(maxLb, 0)} lb this way (the tightest member is: ${worst.name}, ${f(worst.util * 100, 0)}% at ${f(W, 0)} lb). `
    + `The STORAGE LID is not checked and is not strengthened: it is engraved DO NOT STEP (CNC, on the lid top), so nobody is meant to stand on it (Eric, D-58). The kingpin carries no vertical load (the thrust disc does), so it is not on this list. Simple view: "Holds a ${f(Math.floor(maxLb / 10) * 10, 0)} lb adult sitting or stepping in."`;
  return singleCheck({
    id: 'rest-load', label: 'Resting weight: an adult sitting or stepping in (static)', group: 'Structure', refs: ['D-58', 'D-17'],
    value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, details: ds, how,
  });
}
