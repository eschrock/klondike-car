/**
 * Cargo-mode rows (Phase 3c-2, D-53; D-57). The sled hauls gear, firewood and water after the race: the seat back flips flat onto the deck and the two cushions lie in the storage box (`seat-stow`),
 * the payload (default 250 lb, `cargoPayloadLb`) sits on the flat bed with no rider, and the rows below are the ones that exist only for that case or have a
 * cargo evaluation of their own:
 *   seat-stow   the two cushions fit flat in the box interior (fore-aft, across, height under the lid frame), from the real part bounding boxes; the back flips flat on the deck
 *   joists      the deck crossmembers under the rider's seat and the standing scout (operating and goal rider) and under the cargo (uniform and concentrated)
 *   lid-load    the box lid as a table: a light item on the concentrated footprint (cargo only)
 *   cargo-strap strapping the payload down: strap tension for the restraint g, against the strap and the D-ring plate (cargo only)
 *   handle-bow  the handlebow under the handler's hold-back pull at the middle and a push-down (rider independent)
 * The cargo case of the generic rows (axles, wheels, bearings, rails, brake, tipping) comes from `evalBoth` (stability.ts); the deck has its own in structure.ts.
 */
import { bowGeometry } from '../model/handle';
import { cargoBed } from '../model/bed';
import { seatStowPlan } from '../model/seat-stow';
import { VOID_USABLE, boxGear, packEssentials, storageInterior } from '../model/storage';
import { worldAABB } from '../model/bounds';
import type { Part } from '../model/types';
import type { Ctx } from './context';
import { bendingStress, rectSection, rectShear, ssPointMid, ssUdlCentered, ssUdlFull, transformedSection } from './beams';
import { cargoOnlyCheck, dualCheck, detail, governing, singleCheck, type CaseEval } from './dual';
import { f } from './format';
import type { CaseData } from './loads';
import { seatFactor } from './bump';
import { allowables } from './structure';
import type { AnalysisCheck, Detail, Status } from './types';

// ── the seat in the box ─────────────────────────────────────────────────────────────────────────────────────────

/** Width of a standing scout's foot patch across the span (the deck row uses the same 10"). */
const FOOT_ACROSS_IN = 10;

/** Margin (in) below which a stow reads "marginal": a stack that fits by less than a quarter inch will not close in a cold, swollen box. */
const STOW_MARGINAL_IN = 0.25;

export function seatStowCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const plan = seatStowPlan(p, L, ctx.parts);
  const label = 'Cushions, front lamp and chocks stow in the box; the back flips flat';
  if (!plan.applicable) {
    return singleCheck({
      id: 'seat-stow', label, group: 'Structure', value: 0, unit: 'in', limit: 0, sense: '>=', info: true, refs: ['D-57'],
      how: 'Not evaluated: the storage box is not behind the seat (the stow plan is for the rear box), or the cushions are missing.',
    });
  }
  const { need, margin, interior: i, sizes: s } = plan;
  const avail = { l: i.x1 - i.x0, w: i.y1 - i.y0, h: i.zCeil - i.zFloor };
  const ds: Detail[] = [
    detail('fore-aft: the seat cushion (or the pad) plus the clearance', need.lengthIn, 'in', avail.l, '<='),
    detail('across: the cushion plus the clearance', need.widthIn, 'in', avail.w, '<='),
    detail('height: corner fillet + seat cushion + back pad, under the lid frame and battens', need.heightIn, 'in', avail.h, '<='),
  ];
  // 3c-5: the front lamp, its clip and the wheel chocks lie in the layer above the cushions (the height left under the lid frame and battens), measured from the real parts.
  const gear = boxGear(ctx.parts);
  const gearKit = [...gear.lamp, ...gear.chocks];
  const layerH = Math.max(0, margin.heightIn);
  const layer = packEssentials({ lx: avail.l, w: avail.w, h: layerH, capIn3: 0, totalIn3: avail.l * avail.w * layerH }, gearKit);
  const gearTall = Math.max(0, ...gearKit.map((k) => Math.min(...(k.dims ?? [0]))));
  const gearIn3 = layer.rigidIn3;
  if (gearKit.length) {
    ds.push(detail('height: the tallest of the lamp, its clip and the chocks (laid on their smallest side) in the height left above the cushions', gearTall, 'in', layerH, '<='));
    ds.push(detail('floor area: the lamp, its clip and the chocks side by side in the layer above the cushions', layer.fill, '× of layer', 1, '<='));
  }
  const g = governing(ds, '');
  const gearMargin = gearKit.length ? layerH - gearTall : Infinity;
  const minMargin = Math.min(margin.lengthIn, margin.widthIn, margin.heightIn, gearMargin, layer.fits ? Infinity : -1);
  const status: Status = minMargin < -1e-9 ? 'fail' : minMargin < STOW_MARGINAL_IN ? 'marginal' : 'pass';
  const ess = packEssentials(storageInterior(p, L));
  const essIn3 = ess.rigidIn3 + ess.softCompressedIn3 / VOID_USABLE;
  const bed = cargoBed(p, L);
  const how = `D-57: the seat BACK never goes in the box. It flips forward about its hinge onto the deck (rotated ${f(90 + p.seatBackAngleDeg, 0)}° about the stile feet) and lies flat from x = ${f(plan.flat.x0, 1)}" to ${f(plan.flat.x1, 1)}" (${f(plan.flat.zTop - L.deckTop, 2)}" proud of the deck, ${f(bed.xStop - plan.flat.x1, 1)}" short of the foot brace), held by the same two quick-release pins. `
    + `Only the two cushions lie in the box, measured from the real parts: the seat cushion ${f(s.cushion[0], 2)}" × ${f(s.cushion[1], 2)}" × ${f(s.cushion[2], 2)}" on the floor flush to the aft wall, the back pad ${f(s.pad[0], 2)}" × ${f(s.pad[1], 2)}" × ${f(s.pad[2], 2)}" on it, face up. `
    + `Interior ${f(avail.l, 2)}" long × ${f(avail.w, 2)}" wide (inside the 6 mm walls); the lowest piece rides on the 3/8" corner fillets, so the stack starts ${f(i.zRest - i.zFloor, 3)}" off the floor and has ${f(avail.h, 2)}" up to the underside of the lid frame and battens. `
    + `Needs ${f(need.lengthIn, 2)}" fore-aft (incl. ${f(p.seatStowClearIn, 2)}" clearance), ${f(need.widthIn, 2)}" across, ${f(need.heightIn, 2)}" high: margins ${f(margin.lengthIn, 2)}", ${f(margin.widthIn, 2)}", ${f(margin.heightIn, 2)}" (marginal under ${STOW_MARGINAL_IN}"). `
    + `The cushions take ${f(plan.cushionsIn3, 0)} in³; the box interior under the lid frame has ${f(plan.freeIn3, 0)} in³ left, and the 10 Essentials need about ${f(essIn3, 0)} in³ (rigid items plus the soft goods at their packed volume, storage-pack row)${plan.freeIn3 >= essIn3 ? ': both fit together' : ': they do NOT both fit; carry the Essentials in a pack on the bed, or raise storageVolumeIn3'}. `
    + (gearKit.length
      ? `Cargo mode also carries the front lamp and its clip and the ${gear.chocks[0]?.qty ?? 0} wheel chocks in a layer on top of the cushions (${f(avail.l, 1)}" × ${f(avail.w, 1)}" and ${f(layerH, 2)}" high under the lid frame): ${gearKit.map((k) => `${k.qty > 1 ? `${k.qty} × ` : ''}${k.name} ${(k.dims ?? []).map((v) => f(v, 1)).join('×')}"`).join(', ')} = ${f(gearIn3, 0)} in³ of bounding boxes in a ${f(layer.interior.totalIn3, 0)} in³ layer (fill ${f(layer.fill, 2)}); the tallest lies ${f(gearTall, 2)}" high, leaving ${f(layerH - gearTall, 2)}" under the lid${layer.fits ? '' : `; NOT placed: ${layer.unplaced.join(', ')}`}. `
      : '')
    + `Procedure, no tools: peel the back pad and the seat cushion off their Dual Lock, lay them in the box, pull the two pins, flip the back forward and push the pins down through the stiles into the deck.`;
  return singleCheck({
    id: 'seat-stow', label, group: 'Structure', value: g.value, unit: g.unit, limit: g.limit, sense: '<=',
    status, details: ds, how, refs: ['D-57', 'D-53', 'D-41'],
  });
}

// ── deck joists ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The cabin joists (crossmembers under the deck) as measured from the parts. */
export function cabinJoists(ctx: Ctx): { parts: Part[]; spanIn: number; thickIn: number; depthIn: number; xs: number[]; tribIn: number } | null {
  const js = ctx.parts.filter((x) => /^joist-\d+$/.test(x.id));
  if (!js.length) return null;
  const bb = js.map((x) => worldAABB(x));
  const xs = bb.map((b) => (b.min[0] + b.max[0]) / 2).sort((a, b) => a - b);
  // The king beam (the crossmember at the kingpin, D-56) is a support too, though its part id is not joist-N.
  const edges = [ctx.L.xRear + ctx.L.transom, ...[...xs, ctx.L.king.x].sort((a, b) => a - b), ctx.L.xFlatEnd];
  let trib = 0;
  for (let i = 1; i < edges.length - 1; i++) trib = Math.max(trib, (edges[i + 1] - edges[i - 1]) / 2);
  return {
    parts: js, xs, tribIn: trib,
    spanIn: Math.max(...bb.map((b) => b.max[1] - b.min[1])), thickIn: bb[0].max[0] - bb[0].min[0], depthIn: bb[0].max[2] - bb[0].min[2],
  };
}

export function joistCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const j = cabinJoists(ctx);
  if (!j) return singleCheck({ id: 'joists', label: 'Deck joists (crossmembers)', group: 'Structure', value: 0, unit: '', limit: 0, sense: '<=', info: true, how: 'No cabin crossmembers in this design.', refs: ['D-17'] });
  const al = allowables(ctx);
  const sec = rectSection(j.thickIn, j.depthIn);
  const EI = al.Eoak * sec.I;
  const lim = j.spanIn / p.deflectionLimitRatio;
  const section = `Joist ${f(j.thickIn, 2)}" × ${f(j.depthIn, 2)}" oak (S = ${f(sec.S, 3)} in³), ${f(j.spanIn, 1)}" between the side members (simply supported, the let-in ends give extra that is not counted), ${f(j.xs.length, 0)} joists, tributary ${f(j.tribIn, 1)}".`;
  const rider = (c: CaseData): CaseEval => {
    const g = seatFactor(ctx, c);
    const a = Math.min(L.seat.width, j.spanIn);
    // The seat pressure acts over the cushion depth; a joist inside the cushion carries its tributary strip of it (the deck ply spreads the load to the supports on each side).
    const strip = Math.min(j.tribIn, L.seat.xFront - L.seat.xRear);
    const Q = (c.riderLb * g * strip) / (L.seat.xFront - L.seat.xRear);
    const seat = ssUdlCentered(Q / a, a, j.spanIn, EI);
    // A scout standing on the deck: the static weight on a 10" wide foot patch at the middle of the span, centered on the joist; the deck ply sends the other half of it to the
    // neighbors, so the joist takes half (the deck row checks the ply itself).
    const stand = ssUdlCentered((0.5 * c.riderLb) / FOOT_ACROSS_IN, FOOT_ACROSS_IN, j.spanIn, EI);
    const ds: Detail[] = [
      detail('seat load, bending', bendingStress(seat.M, sec), 'psi', al.oakBend, '<='),
      detail('seat load, shear', rectShear(seat.V, j.thickIn, j.depthIn), 'psi', al.oakShear, '<='),
      detail('standing scout (static, half the weight on one joist), bending', bendingStress(stand.M, sec), 'psi', al.oakBend, '<='),
      detail('standing scout (static, half the weight on one joist), deflection', stand.defl, 'in', lim, '<='),
    ];
    return governing(ds, `${section} Seat: ${f(c.riderLb, 0)} lb × ${f(g, 2)} spread over the ${f(L.seat.xFront - L.seat.xRear, 0)}" cushion; a joist inside it carries its ${f(strip, 1)}" tributary strip, ${f(Q)} lbf over ${f(a, 0)}" at the middle: M = ${f(seat.M)} lb·in, σ = ${f(bendingStress(seat.M, sec), 0)} psi (≤ ${f(al.oakBend, 0)}). Standing scout: half of ${f(c.riderLb, 0)} lb static on a ${FOOT_ACROSS_IN}" wide patch at the middle of one joist: M = ${f(stand.M)} lb·in, σ = ${f(bendingStress(stand.M, sec), 0)} psi, δ = ${stand.defl.toFixed(3)}" (≤ L/${p.deflectionLimitRatio} = ${lim.toFixed(3)}").`);
  };
  const cargo = (): CaseEval => {
    const c = ctx.loads.cargoCases[0];
    const g = seatFactor(ctx, c);
    const area = ctx.bed.areaIn2;
    const q = (p.cargoPayloadLb * g) / area; // psi over the bed
    const qs = p.cargoPayloadLb / area;
    const udl = ssUdlFull(q * j.tribIn * j.spanIn, j.spanIn, EI);
    const udlS = ssUdlFull(qs * j.tribIn * j.spanIn, j.spanIn, EI);
    const Pc = Math.min(p.cargoConcentratedLb, p.cargoPayloadLb);
    const nc = Math.max(1, Math.ceil(p.cargoPatchAlongIn / j.tribIn));
    const conc = ssPointMid((Pc * g) / nc, j.spanIn, EI);
    const concS = ssPointMid(Pc / nc, j.spanIn, EI);
    const ds: Detail[] = [
      detail('uniform cargo, bending', bendingStress(udl.M, sec), 'psi', al.oakBend, '<='),
      detail('uniform cargo, shear', rectShear(udl.V, j.thickIn, j.depthIn), 'psi', al.oakShear, '<='),
      detail('uniform cargo, deflection (static)', udlS.defl, 'in', lim, '<='),
      detail('concentrated item, bending', bendingStress(conc.M, sec), 'psi', al.oakBend, '<='),
      detail('concentrated item, deflection (static)', concS.defl, 'in', lim, '<='),
    ];
    return governing(ds, `${section} Uniform: ${f(p.cargoPayloadLb, 0)} lb × ${f(g, 2)} over the ${f(area / 144, 2)} ft² bed (${f(q, 2)} psi) on a ${f(j.tribIn, 1)}" tributary = ${f(q * j.tribIn, 2)} lbf/in: M = wL²/8 = ${f(udl.M)} lb·in, σ = ${f(bendingStress(udl.M, sec), 0)} psi (≤ ${f(al.oakBend, 0)}). Concentrated ${f(Pc, 0)} lb × ${f(g, 2)} on a ${p.cargoPatchAlongIn}" × ${p.cargoPatchAcrossIn}" footprint over ${nc} joist${nc > 1 ? 's' : ''} (treated as a point load at the middle of each, conservative): M = PL/4 = ${f(conc.M)} lb·in, σ = ${f(bendingStress(conc.M, sec), 0)} psi, static δ = ${concS.defl.toFixed(3)}" (≤ ${lim.toFixed(3)}").`);
  };
  return dualCheck({
    id: 'joists', label: 'Deck joists (crossmembers)', group: 'Structure', refs: ['D-17', 'D-53'], primary: 'goal',
    operating: rider(ctx.loads.operating), goal: rider(ctx.loads.goal), operatingLabel: 'Operating rider', goalLabel: 'Goal rider',
    ...(ctx.loads.cargoCases.length ? { cargo: cargo(), cargoLabel: `Cargo ${p.cargoPayloadLb} lb` } : {}),
  });
}

// ── the lid as a table ──────────────────────────────────────────────────────────────────────────────────────────

/** Numbers behind the lid-load row, exported for the tests. A batten (oak, simply supported across the lid between the frame sides) carries its share of the patch, with the ply panel as its flange. */
export function lidLoads(ctx: Ctx, loadLb: number) {
  const { p } = ctx;
  const al = allowables(ctx);
  const bat = ctx.parts.filter((x) => x.id.startsWith('storage-lid-batten-'));
  const lid = ctx.byId.get('storage-lid');
  if (!lid) return null;
  const lb = worldAABB(lid);
  const bays = bat.length + 1;
  const bayIn = (lb.max[0] - lb.min[0]) / bays;
  const bb = bat.length ? worldAABB(bat[0]) : null;
  const spanIn = bb ? bb.max[1] - bb.min[1] : lb.max[1] - lb.min[1];
  const bIn = bb ? bb.max[0] - bb.min[0] : 0.75, hIn = bb ? bb.max[2] - bb.min[2] : 0.5;
  const plyT = lb.max[2] - lb.min[2];
  const g = p.dynamicFactor;
  // Battens under the patch (its along-x extent centered on the lid): each takes an equal share of the patch (the ply and the frame ends share too, not counted).
  const lidMid = (lb.min[0] + lb.max[0]) / 2;
  const under = bat.filter((x) => { const b = worldAABB(x); const cx = (b.min[0] + b.max[0]) / 2; return Math.abs(cx - lidMid) <= p.cargoPatchAlongIn / 2; }).length;
  const share = Math.max(1, under);
  const P = (loadLb * g) / share;
  const flange = Math.min(bayIn, 12 * plyT);
  const tr = transformedSection([
    { b: bIn, z0: 0, z1: hIn, E: al.Eoak, kind: 'oak' },
    { b: flange, z0: hIn, z1: hIn + plyT, E: al.Eply, kind: 'ply' },
  ], al.Eoak);
  const M = (P * spanIn) / 4;
  const cOak = Math.max(...tr.layers.filter((q) => q.kind === 'oak').map((q) => q.cMax));
  const cPly = Math.max(...tr.layers.filter((q) => q.kind === 'ply').map((q) => q.cMax));
  const sOak = (M * cOak) / tr.I;
  const sPly = (tr.layers.find((q) => q.kind === 'ply')!.n * M * cPly) / tr.I;
  const defl = ((loadLb / share) * spanIn ** 3) / (48 * tr.EI);
  return { al, bat: bat.length, bayIn, spanIn, bIn, hIn, plyT, g, under: share, P, flange, M, sOak, sPly, defl, lim: spanIn / p.deflectionLimitRatio, I: tr.I, zNa: tr.zNa };
}

export function lidLoadCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const rated = p.cargoLidLoadLb;
  const k = lidLoads(ctx, Math.max(1e-6, rated));
  if (!k) return cargoOnlyCheck({ id: 'lid-load', label: 'Storage lid carries a light item', group: 'Structure', value: 0, unit: 'lb', limit: 0, sense: '>=', info: true, how: 'No lid panel in this design.', refs: ['D-53'] });
  const ds: Detail[] = [
    detail('batten bending (oak, bottom fiber of the T section)', k.sOak, 'psi', k.al.oakBend, '<='),
    detail('ply panel flange bending (top fiber)', k.sPly, 'psi', k.al.plyBend, '<='),
    detail('batten deflection (static)', k.defl, 'in', k.lim, '<='),
  ];
  const util = Math.max(...ds.map((d) => d.util));
  const capacity = util > 0 ? rated / util : Infinity;
  return cargoOnlyCheck({
    id: 'lid-load', label: 'Storage lid carries a light item (capacity vs the rated load)', group: 'Structure', value: capacity, unit: 'lb', limit: rated, sense: '>=', details: ds, refs: ['D-53', 'D-41'],
    how: `A ${f(rated, 0)} lb item (a light cooler or a duffel; param cargoLidLoadLb) × dynamic ${f(k.g, 1)} on a ${p.cargoPatchAlongIn}" × ${p.cargoPatchAcrossIn}" footprint at the middle of the lid. ${k.bat} oak battens (${f(k.bIn, 2)}" × ${f(k.hIn, 2)}") run across the ${f(k.spanIn, 1)}" clear span between the lid-frame sides, ${f(k.bayIn, 1)}" apart; ${k.under} of them are under the footprint and take it equally (the panel and the frame ends share too, not counted): ${f(k.P)} lbf each at the middle, M = PL/4 = ${f(k.M)} lb·in. `
      + `Each batten acts as a T beam with the ${f(k.plyT * 25.4, 1)} mm ply as its ${f(k.flange, 1)}" flange (transformed section, NA ${f(k.zNa, 3)}" above the batten bottom, I = ${f(k.I, 4)} in⁴): oak σ = ${f(k.sOak, 0)} psi (≤ ${f(k.al.oakBend, 0)}), ply σ = ${f(k.sPly, 0)} psi (≤ ${f(k.al.plyBend, 0)}), static δ = ${k.defl.toFixed(3)}" (≤ ${k.lim.toFixed(3)}"). The loads scale linearly, so the lid carries up to ${Number.isFinite(capacity) ? f(capacity, 0) : '∞'} lb of such an item. Heavy items (jugs, a full cooler) go on the floor of the bed, not on the lid.`,
  });
}

// ── tying the load down ─────────────────────────────────────────────────────────────────────────────────────────

/** Numbers behind the cargo-strap row, exported for the tests. */
export function strapLoads(ctx: Ctx) {
  const { p } = ctx;
  const W = p.cargoPayloadLb;
  const anchors = ctx.parts.filter((x) => x.id.startsWith('lash-')).length;
  const straps = Math.max(1, Math.floor(anchors / 2)); // each strap runs from a D-ring on one gunwale to the one opposite
  const th = (p.lashPullAngleDeg * Math.PI) / 180;
  // Friction holds the load against the restraint deceleration; the straps add to the normal force (the lateral parts cancel).
  const hold = Math.max(0, W * (p.cargoRestraintG / p.cargoStrapMu - 1)); // total hold-down (vertical) the straps must add
  const T = hold / (2 * straps * Math.sin(th));
  return { W, anchors, straps, th, hold, T, lateralNeed: W * (0.5 / p.cargoStrapMu - 1) };
}

export function cargoStrapCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const k = strapLoads(ctx);
  const ds: Detail[] = [
    detail('strap tension vs the D-ring plate working load (lashLoadLbf)', k.T, 'lbf', p.lashLoadLbf, '<='),
    detail('strap tension vs the strap working load', k.T, 'lbf', p.cargoStrapWllLbf, '<='),
  ];
  const g = governing(ds, '');
  return cargoOnlyCheck({
    id: 'cargo-strap', label: 'Tie-downs hold the payload (strap tension, D-rings)', group: 'Structure', value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, details: ds, refs: ['D-53', 'D-41', 'BRIEF 4.9'],
    how: `Payload ${f(k.W, 0)} lb must resist ${p.cargoRestraintG} g forward (US DOT cargo securement, param cargoRestraintG) on a deck with friction μ ${p.cargoStrapMu}. Friction alone gives μW = ${f(p.cargoStrapMu * k.W)} lbf, short of ${f(p.cargoRestraintG * k.W)} lbf, so the straps must add a hold-down of W(g/μ − 1) = ${f(k.hold)} lbf. `
      + `${k.straps} straps run across the load from a D-ring on one gunwale to the opposite one (${k.anchors} plates, D-41), each pulling at ${p.lashPullAngleDeg}° above the deck, so each carries T = hold / (2 × ${k.straps} × sin ${p.lashPullAngleDeg}°) = ${f(k.T)} lbf (the sideways parts of the two ends cancel). That is ${f((100 * k.T) / p.lashLoadLbf, 0)}% of a plate's ${p.lashLoadLbf} lbf working load (the lash-load row checks the screws at that load) and ${f((100 * k.T) / p.cargoStrapWllLbf, 0)}% of a ${p.cargoStrapWllLbf} lbf cam strap. Sideways and rearward (0.5 g) need less hold-down (${f(Math.max(0, k.lateralNeed))} lbf). Cam-buckle straps over the load, snug by hand; no ratchets (a ratchet can crush a plate's oak doubler).`,
  });
}

// ── the handlebow ───────────────────────────────────────────────────────────────────────────────────────────────

/** Bending strength of clear wood with cross grain, as a fraction of straight grain, by slope of grain (rise per run), from the Wood Handbook's table (1:20 = 1.0 ... 1:5 = 0.45). */
export function grainSlopeFactor(slope: number): number {
  const tbl: Array<[number, number]> = [[0, 1], [0.05, 1], [1 / 15, 0.96], [0.1, 0.81], [0.2, 0.45], [0.5, 0.2]];
  const a = Math.abs(slope);
  for (let i = 1; i < tbl.length; i++) if (a <= tbl[i][0]) return tbl[i - 1][1] + ((a - tbl[i - 1][0]) / (tbl[i][0] - tbl[i - 1][0])) * (tbl[i][1] - tbl[i - 1][1]);
  return tbl[tbl.length - 1][1];
}

export function handleBowCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const bw = bowGeometry(p, L);
  const sec = p.handleBarDiameterIn;
  const R = Number.isFinite(bw.radiusIn) ? bw.radiusIn : Infinity;
  const span = 2 * bw.yPost;
  const F = p.handleHoldbackLbf;
  const s = rectSection(sec, sec);
  const Mh = (F * span) / 4; // a hand at the middle of the bow pulling aft: the bow spans between the posts (plan bending)
  const Mv = (F * span) / 4; // leaning down on the middle
  const arm = (bw.yEnd - bw.yPost); // a hand on the overhanging end, cantilever from the post
  const Me = F * Math.max(0, arm);
  // D-57: ONE bandsawn board, so no lamination factor, but the sawn arc cuts the grain: level at the middle, running out at the posts and the ends.
  const slopeEnd = Number.isFinite(R) ? Math.tan(Math.asin(Math.min(1, bw.yEnd / R))) : 0;
  const Cg = grainSlopeFactor(slopeEnd);
  const pinShear = (F / 2) / ((Math.PI / 4) * 0.375 ** 2);
  const ds: Detail[] = [
    detail('hand at the middle pulling aft, plan bending (grain level there)', bendingStress(Mh, s), 'psi', al.oakBend, '<='),
    detail('leaning on the middle, vertical bending (grain level there)', bendingStress(Mv, s), 'psi', al.oakBend, '<='),
    detail('hand on an overhanging end (cantilever; grain runs out at the end)', bendingStress(Me, s), 'psi', al.oakBend * Cg, '<='),
    detail('3/8 in pin at each post top, shear', pinShear, 'psi', (p.brakeSteelYieldPsi * 0.577) / p.steelSafetyFactor, '<='),
  ];
  const g = governing(ds, '');
  return singleCheck({
    id: 'handle-bow', label: 'Handlebow (hold-back pull at the middle)', group: 'Structure', value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, details: ds, refs: ['D-53', 'D-39', 'D-57'],
    how: `Handlebow ${f(sec, 2)}" square, ONE bandsawn oak board (D-57), a ${Number.isFinite(R) ? f(R, 1) : '∞'}" radius arc (crown ${f(bw.crownIn, 2)}"), spanning ${f(span, 1)}" between the post tops with ${f(arm, 1)}" overhanging each side. The D-39 socket loads are unchanged: the hold-back pull is taken at the posts at the ${f(p.rearHandleHeightIn)}" grip height (handle-sockets row). Here the worst place for the bow itself: the hold-back ${f(F, 0)} lbf at the MIDDLE (the bow as a simply supported span, arch action ignored): M = FL/4 = ${f(Mh)} lb·in, σ = ${f(bendingStress(Mh, s), 0)} psi against the oak design bending ${f(al.oakBend, 0)} (the grain is level at the middle, so no knock-down). The same ${f(F, 0)} lbf leaning down on the middle, and on an overhanging end (cantilever ${f(arm, 1)}"), are in the details; the sawn arc runs the grain out ${f((Math.atan(slopeEnd) * 180) / Math.PI, 0)}° at the ends, which cuts the bending strength there to ${f(Cg, 2)} of straight grain (Wood Handbook slope-of-grain table), so the end is checked against ${f(al.oakBend * Cg, 0)} psi.`,
  });
}

/** Cargo-mode checks: `cargoChecks(ctx)` adds the cargo-only rows only when the context carries cargo cases. */
export function cargoChecks(ctx: Ctx): AnalysisCheck[] {
  const rows = [seatStowCheck(ctx), joistCheck(ctx), handleBowCheck(ctx)];
  if (ctx.loads.cargoCases.length) rows.push(lidLoadCheck(ctx), cargoStrapCheck(ctx));
  return rows;
}
