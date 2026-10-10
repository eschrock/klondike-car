/**
 * Structural checks (D-2, D-4, D-5, D-10, D-12, D-14, D-17). Each is evaluated at the operating and the goal rider; the
 * row shows the goal case (D-2: structure is sized to the goal rider) and `statusOperating` the other.
 *
 * Load factors: payload × dynamicFactor; members that also carry the cart's weight (axles, axle beams, kingpin side,
 * turntable) use the axle's static ground reaction × dynamicFactor, which already contains the cart mass (D-2).
 * Wood allowables are MOR/MOE × wet-service factors, with the wood safety factor; steel is yield / steel SF.
 */
import { FRAME_STYLE, AXLE_STYLE, DRAWBAR, SIDE_CONSTRUCTION } from '../params';
import { worldAABB } from '../model/bounds';
import type { Part } from '../model/types';
import type { Ctx } from './context';
import { dualCheck, singleCheck, detail, governing, type CaseEval } from './dual';
import { axleLoads, contactsAt } from './geometry';
import { f } from './format';
import type { CaseData } from './loads';
import { bendingStress, cantileverTip, circleSection, rectSection, rectShear, ssPointMid, ssUdlCentered, transformedSection, type Layer } from './beams';
import { evalBoth } from './stability';
import type { AnalysisCheck, Detail } from './types';

export function allowables(ctx: Ctx) {
  const { p, d } = ctx;
  return {
    oakBend: d.oakDesignMorPsi,
    oakShear: (p.oakShearPsi * p.wetServiceFactorStrength) / p.woodSafetyFactor,
    oakPerp: (p.oakCompPerpPsi * p.wetServiceFactorStrength) / p.woodSafetyFactor,
    plyBend: d.plyDesignMorPsi,
    steel: d.axleAllowablePsi,
    kpShear: (0.577 * p.kingpinYieldPsi) / p.kingpinMargin,
    kpBend: p.kingpinYieldPsi / p.kingpinMargin,
    Eoak: d.oakDesignMoePsi,
    Eply: d.plyMoePsi * p.wetServiceFactorStiffness,
  };
}

const part = (ctx: Ctx, id: string): Part | undefined => ctx.byId.get(id);

/** Ground reaction per axle and the heavier wheel of each axle for a load case (static, δ = 0). */
function wheelLoads(ctx: Ctx, c: CaseData) {
  const ct = contactsAt(ctx.contact, 0);
  const a = axleLoads(c.massLb, c.cg[0], (ct.FL[0] + ct.FR[0]) / 2);
  const share = (T: number) => 0.5 + Math.abs(c.cg[1]) / T;
  return {
    frontAxle: a.front,
    rearAxle: a.rear,
    frontWheel: a.front * share(ctx.p.frontTrackIn),
    rearWheel: a.rear * share(ctx.p.rearTrackIn),
  };
}

const payload = (ctx: Ctx, c: CaseData) => (c.riderLb + c.cargoLb) * ctx.p.dynamicFactor;

interface Clamp { outerY: number; centreY: number; widthY: number }
function clampGeometry(ctx: Ctx, tag: 'F' | 'R'): Clamp {
  let outer = 0, lo = Infinity, hi = 0;
  for (const id of [`clamp-${tag}L1`, `clamp-${tag}L2`]) {
    const x = part(ctx, id);
    if (!x) continue;
    const b = worldAABB(x);
    outer = Math.max(outer, b.max[1]);
    lo = Math.min(lo, Math.max(0, b.min[1]));
    hi = Math.max(hi, b.max[1]);
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 0; }
  return { outerY: outer, centreY: (lo + hi) / 2, widthY: hi - lo };
}

// ── axles ────────────────────────────────────────────────────────────────────────────────────────────────────

export function axleStress(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const sec = circleSection(p.axleDiameterIn);
  const E = p.steelMoePsi;
  const stub = p.axleStyle === AXLE_STYLE.stubAxles;
  const ev = (c: CaseData): CaseEval => {
    const w = wheelLoads(ctx, c);
    const rows = (['F', 'R'] as const).map((tag) => {
      const wheel = part(ctx, `wheel-${tag}L`);
      const yw = wheel ? Math.abs(wheel.transform[13]) : (tag === 'F' ? p.frontTrackIn : p.rearTrackIn) / 2;
      const clamp = clampGeometry(ctx, tag);
      const beam = part(ctx, `beam-${tag}`);
      const beamHalf = beam ? worldAABB(beam).max[1] : yw;
      const edge = stub ? beamHalf : clamp.outerY;
      const a = Math.max(0.01, yw - edge);
      const Pstatic = tag === 'F' ? w.frontWheel : w.rearWheel;
      const Pdes = Pstatic * p.dynamicFactor;
      const des = cantileverTip(Pdes, a, E * sec.I);
      const stat = cantileverTip(Pstatic, a, E * sec.I);
      return { tag, a, Pstatic, Pdes, M: des.M, sigma: bendingStress(des.M, sec), defl: stat.defl };
    });
    const ds: Detail[] = rows.map((r) => detail(`${r.tag === 'F' ? 'front' : 'rear'} axle bending`, r.sigma, 'psi', al.steel, '<='));
    const extra: Detail[] = rows.map((r) => detail(`${r.tag === 'F' ? 'front' : 'rear'} axle tip deflection (static)`, r.defl, 'in', 0.05, '<='));
    const how = rows
      .map((r) => `${r.tag === 'F' ? 'Front' : 'Rear'}: P = ${f(r.Pstatic)} lb static wheel load × ${p.dynamicFactor} = ${f(r.Pdes)} lbf at the hub; cantilever a = ${f(r.a, 2)}" from the ${stub ? 'beam face (stub axle)' : 'clamp plate outer edge (through rod)'}; M = P·a = ${f(r.M)} lb·in; σ = M·c/I = ${f(r.M)} × ${f(sec.c, 3)} / ${sec.I.toFixed(5)} = ${f(r.sigma, 0)} psi; tip deflection P_static·a³/3EI = ${r.defl.toFixed(4)}" (guide ≤ 0.05", info).`)
      .join(' | ') + ` Allowable ${f(al.steel, 0)} psi (yield ${f(p.axleYieldPsi, 0)} / SF ${p.steelSafetyFactor}).`;
    const e = governing(ds, how);
    e.details = [...ds, ...extra];
    return e;
  };
  return dualCheck({
    id: 'axle-stress', label: stub ? 'Stub axle bending' : 'Axle bending (through rod)', group: 'Structure', refs: ['D-2', 'D-4', 'D-10'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

// ── axle beams ───────────────────────────────────────────────────────────────────────────────────────────────

function beamEval(ctx: Ctx, kind: 'front' | 'rear', c: CaseData): CaseEval {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const tag = kind === 'front' ? 'F' : 'R';
  const beam = kind === 'front' ? L.beamF : L.beamR;
  const w = wheelLoads(ctx, c);
  const F = (kind === 'front' ? w.frontAxle : w.rearAxle) * p.dynamicFactor;
  const groove = p.axleDiameterIn;
  const hEff = Math.max(0.1, beam.depth - groove);
  const sec = rectSection(beam.thick, hEff);
  const clamp = clampGeometry(ctx, tag);
  const ys = clamp.centreY;
  let M: number, load: string;
  if (kind === 'front') {
    const yl = p.turntableSizeIn / 2;
    M = (F / 2) * Math.abs(ys - yl);
    load = `Turntable load F = axle load ${f(F / p.dynamicFactor)} lb × ${p.dynamicFactor} = ${f(F)} lbf as two loads F/2 = ${f(F / 2)} at y = ±${f(yl)}" (turntable edges), reactions at the clamp plates (y = ±${f(ys, 2)}")`;
  } else {
    const rail = part(ctx, 'rail-cabin-L') ?? part(ctx, 'girder-cabin-L');
    const yr = rail ? (worldAABB(rail).min[1] + worldAABB(rail).max[1]) / 2 : ctx.L.hwC;
    M = (F / 2) * Math.abs(ys - Math.abs(yr));
    load = `Rail/girder loads F/2 = ${f(F / 2)} lbf at y = ±${f(Math.abs(yr), 2)}" (axle load ${f(F / p.dynamicFactor)} lb × ${p.dynamicFactor} = ${f(F)} lbf), reactions at the clamp plates (y = ±${f(ys, 2)}")`;
  }
  const sigma = bendingStress(M, sec);
  const V = F / 2;
  const tau = rectShear(V, beam.thick, hEff);
  const ds = [
    detail('bending', sigma, 'psi', al.oakBend, '<='),
    detail('shear at the clamps', tau, 'psi', al.oakShear, '<='),
  ];
  const how = `${load}. M = ${f(M)} lb·in on the net section ${f(beam.thick, 2)}" × (${f(beam.depth, 2)}" − ${f(groove, 2)}" rod groove) = ${f(beam.thick, 2)}" × ${f(hEff, 2)}": σ = M/S = ${f(M)}/${f(sec.S, 3)} = ${f(sigma, 0)} psi (≤ ${f(al.oakBend, 0)} psi design); τ = 1.5V/A = 1.5 × ${f(V)} / ${f(sec.A, 2)} = ${f(tau, 0)} psi (≤ ${f(al.oakShear, 0)} psi).`;
  return governing(ds, how);
}

export function beamFront(ctx: Ctx): AnalysisCheck {
  return dualCheck({
    id: 'beam-front', label: 'Front axle beam', group: 'Structure', refs: ['D-2', 'D-4', 'D-12'], primary: 'goal',
    ...evalBoth(ctx, (c) => beamEval(ctx, 'front', c)),
  });
}

export function beamRear(ctx: Ctx): AnalysisCheck {
  return dualCheck({
    id: 'beam-rear', label: 'Rear axle beam', group: 'Structure', refs: ['D-2', 'D-4'], primary: 'goal',
    ...evalBoth(ctx, (c) => beamEval(ctx, 'rear', c)),
  });
}

export function bearingGroove(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const ev = (c: CaseData): CaseEval => {
    const w = wheelLoads(ctx, c);
    const worstTag = w.rearWheel >= w.frontWheel ? 'R' : 'F';
    const Pw = Math.max(w.rearWheel, w.frontWheel) * p.dynamicFactor;
    const clamp = clampGeometry(ctx, worstTag);
    const len = Math.max(0.1, clamp.widthY);
    const area = p.axleDiameterIn * len;
    const s = Pw / area;
    return {
      value: s, unit: 'psi', limit: al.oakPerp, sense: '<=',
      how: `${worstTag === 'R' ? 'Rear' : 'Front'} wheel design load ${f(Pw)} lbf (static ${f(Pw / p.dynamicFactor)} × ${p.dynamicFactor}) bears on the groove over rod dia × clamp-plate length along the rod = ${f(p.axleDiameterIn, 3)}" × ${f(len, 2)}" = ${f(area, 2)} in² (the two U-bolt plates straddle the same rod length, so they are counted once; conservative against 2 plates): ${f(s, 0)} psi vs compression ⊥ design ${f(al.oakPerp, 0)} psi (${p.oakCompPerpPsi} × ${p.wetServiceFactorStrength} / ${p.woodSafetyFactor}).`,
    };
  };
  return dualCheck({
    id: 'bearing-groove', label: 'Compression ⊥ at the axle groove', group: 'Structure', refs: ['D-4', 'D-10'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

// ── rails / girders ──────────────────────────────────────────────────────────────────────────────────────────

/** Vertical stack of oak/ply layers for a hull-beam side at `tag` in the cabin or nose zone (read from the parts). */
export function hullLayers(ctx: Ctx, zone: 'cabin' | 'nose'): Layer[] | null {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const oak = (x: Part | undefined): Layer | null => {
    if (!x) return null;
    const b = worldAABB(x);
    return { b: b.max[1] - b.min[1], z0: b.min[2], z1: b.max[2], E: al.Eoak, kind: 'oak' };
  };
  const list: (Layer | null)[] = [];
  if (zone === 'cabin') list.push(oak(part(ctx, 'girder-cabin-L')));
  const pre = `side-${zone}-L`;
  if (p.sideConstruction === SIDE_CONSTRUCTION.solidOak) list.push(oak(part(ctx, `${pre}-board`)));
  else {
    list.push(oak(part(ctx, `${pre}-chine`)), oak(part(ctx, `${pre}-gunwale`)));
    if (p.sideConstruction === SIDE_CONSTRUCTION.capturedPly) {
      const web = part(ctx, `${pre}-web`);
      if (web) {
        const z0 = zone === 'cabin' ? L.web.z0 : L.noseBot + L.railBand;
        const z1 = zone === 'cabin' ? L.web.z1 : L.noseTop + L.sideH - L.railBand;
        list.push({ b: p.panelPlyIn, z0, z1, E: al.Eply, kind: 'ply' });
      }
    }
  }
  const out = list.filter((x): x is Layer => !!x && x.z1 > x.z0);
  return out.length ? out : null;
}

export function railsCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const hull = p.frameStyle === FRAME_STYLE.hullBeam;
  const span = L.kx - 0;
  const ev = (c: CaseData): CaseEval => {
    const Pdyn = payload(ctx, c);
    const Pstat = c.riderLb + c.cargoLb;
    const Pm = Pdyn / 2;
    const ds: Detail[] = [];
    let how: string;
    if (!hull) {
      const rail = part(ctx, 'rail-cabin-L');
      const bb = rail ? worldAABB(rail) : null;
      const b = bb ? bb.max[1] - bb.min[1] : p.railThicknessIn;
      const h = bb ? bb.max[2] - bb.min[2] : p.railDepthIn;
      const sec = rectSection(b, h);
      const r = ssPointMid(Pm, span, al.Eoak * sec.I);
      const sigma = bendingStress(r.M, sec);
      const tau = rectShear(r.V, b, h);
      const defl = ssPointMid(Pstat / 2, span, al.Eoak * sec.I).defl;
      ds.push(detail('bending', sigma, 'psi', al.oakBend, '<='), detail('shear', tau, 'psi', al.oakShear, '<='), detail('static deflection', defl, 'in', span / p.deflectionLimitRatio, '<='));
      how = `Ladder rails ${f(b, 2)}" × ${f(h, 2)}" (2 members). Payload (${c.riderLb} + ${c.cargoLb}) × ${p.dynamicFactor} = ${f(Pdyn)} lbf as a point load at midspan of the ${f(span)}" span (rear beam to kingpin), ${f(Pm)} lbf per rail: M = PL/4 = ${f(r.M)} lb·in, σ = M/S = ${f(sigma, 0)} psi (≤ ${f(al.oakBend, 0)}); τ = 1.5V/A = ${f(tau, 0)} psi (≤ ${f(al.oakShear, 0)}); static δ = P·L³/48EI with P = ${f(Pstat / 2)} lb: ${defl.toFixed(3)}" (≤ L/${p.deflectionLimitRatio} = ${(span / p.deflectionLimitRatio).toFixed(3)}").`;
    } else {
      const lay = hullLayers(ctx, 'cabin');
      if (!lay) {
        ds.push(detail('bending', 0, 'psi', al.oakBend, '<='));
        how = 'Hull-beam girder section not found in the parts list.';
      } else {
        const ts = transformedSection(lay, al.Eoak);
        const r = ssPointMid(Pm, span, ts.EI);
        const cOak = Math.max(...ts.layers.filter((q) => q.kind === 'oak').map((q) => q.cMax), 0);
        const cPly = Math.max(...ts.layers.filter((q) => q.kind === 'ply').map((q) => q.cMax), 0);
        const nPly = ts.layers.find((q) => q.kind === 'ply')?.n ?? 0;
        const sOak = (r.M * cOak) / ts.I;
        ds.push(detail('girder bending (oak)', sOak, 'psi', al.oakBend, '<='));
        if (cPly > 0) ds.push(detail('girder bending (ply web)', (nPly * r.M * cPly) / ts.I, 'psi', al.plyBend, '<='));
        const defl = ssPointMid(Pstat / 2, span, ts.EI).defl;
        ds.push(detail('static deflection', defl, 'in', span / p.deflectionLimitRatio, '<='));
        // Nose section (no deepened girder) at the shoulder, with the load just aft of it.
        let noseTxt = '';
        const nose = L.xs < L.kx ? hullLayers(ctx, 'nose') : null;
        if (nose) {
          const tn = transformedSection(nose, al.Eoak);
          const Mn = (Pm * L.xs * (L.kx - L.xs)) / L.kx;
          const cn = Math.max(...tn.layers.filter((q) => q.kind === 'oak').map((q) => q.cMax), 0);
          const sn = (Mn * cn) / tn.I;
          ds.push(detail('nose side bending at the shoulder (oak)', sn, 'psi', al.oakBend, '<='));
          noseTxt = ` Nose side section at the shoulder (load just aft of it, M = P·xs(L−xs)/L = ${f(Mn)} lb·in): σ = ${f(sn, 0)} psi.`;
        }
        how = `Hull-beam girders (2 members), transformed I-section from the actual parts (oak girder + chine + gunwale flanges, ply web, n_ply = E_ply/E_oak = ${f(nPly, 2)}): NA at z = ${f(ts.zNa, 2)}", I_tr = ${f(ts.I, 1)} in⁴. Payload × ${p.dynamicFactor} = ${f(Pdyn)} lbf at midspan of ${f(span)}", ${f(Pm)} lbf per girder: M = ${f(r.M)} lb·in, σ_oak = ${f(sOak, 0)} psi (≤ ${f(al.oakBend, 0)}); static δ = ${defl.toFixed(3)}" (≤ L/${p.deflectionLimitRatio} = ${(span / p.deflectionLimitRatio).toFixed(3)}").${noseTxt}`;
      }
    }
    return governing(ds, how);
  };
  return dualCheck({
    id: 'rails', label: hull ? 'Hull-beam side girders' : 'Frame rails', group: 'Structure', refs: ['D-2', 'D-4', 'D-17'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

// ── deck ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Largest clear panel span (in) between the cabin crossmembers / end supports. */
export function maxDeckSpan(ctx: Ctx): number {
  const { L } = ctx;
  const half = L.joistT / 2;
  const edges: number[] = [L.xRear + L.side];
  for (const x of L.cabinJoistX) edges.push(x - half, x + half);
  edges.push(L.xs);
  let m = 0;
  for (let i = 0; i + 1 < edges.length; i += 2) m = Math.max(m, edges[i + 1] - edges[i]);
  return Math.max(1, m);
}

export function deckCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const span = maxDeckSpan(ctx);
  const t = p.deckPlyIn;
  const b = 12;
  const sec = rectSection(b, t);
  const EI = al.Eply * sec.I;
  const ev = (c: CaseData): CaseEval => {
    const seatArea = p.seatDepthIn * L.seat.width;
    const wSeat = ((c.riderLb * p.dynamicFactor) / seatArea) * Math.min(b, L.seat.width);
    const a = ssUdlCentered(wSeat, p.seatDepthIn, span, EI);
    const sA = a.M / sec.S;
    const footLb = c.riderLb;
    const patch = 4;
    const s = ssUdlCentered(footLb / patch, patch, span, EI);
    const sB = s.M / sec.S;
    const ds = [
      detail('seat case bending', sA, 'psi', al.plyBend, '<='),
      detail('standing scout bending', sB, 'psi', al.plyBend, '<='),
      detail('standing scout deflection', s.defl, 'in', span / p.deflectionLimitRatio, '<='),
    ];
    const how = `12" strip of ${f(t, 3)}" ply on the largest crossmember span ${f(span, 2)}" (simply supported, conservative): (a) seat: ${c.riderLb} lb × ${p.dynamicFactor} spread over ${f(p.seatDepthIn)}" × ${f(L.seat.width)}" → ${f(wSeat, 1)} lb/in on the strip, M = ${f(a.M)} lb·in, σ = M/S = ${f(sA, 0)} psi; (b) standing scout ${c.riderLb} lb static on a 4" × 10" patch at midspan (4" along the span): M = ${f(s.M)} lb·in, σ = ${f(sB, 0)} psi, δ = ${s.defl.toFixed(3)}" vs span/${p.deflectionLimitRatio} = ${(span / p.deflectionLimitRatio).toFixed(3)}". Ply design stress ${f(al.plyBend, 0)} psi, E = ${f(al.Eply, 0)} psi (E × C_M). A 12" strip ignores plate action and load spreading across the panel (conservative).`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'deck', label: 'Deck ply panel', group: 'Structure', refs: ['D-2', 'D-5', 'D-17'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

// ── steering structure ───────────────────────────────────────────────────────────────────────────────────────

export function kingpinCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const sec = circleSection(p.kingpinDiameterIn);
  const H = p.pullForceLbf;
  const stack = Math.max(0.1, L.kingpin.z1 - L.kingpin.z0);
  const double = L.kingpin.z1 >= L.bolster.z1 - 1e-6;
  const tau = H / ((double ? 2 : 1) * sec.A);
  const M = double ? (H * stack) / 4 : H * stack;
  const sigma = bendingStress(M, sec);
  const beamDepth = L.beamF.depth;
  const bearing = H / (p.kingpinDiameterIn * beamDepth);
  const ds = [
    detail('shear', tau, 'psi', al.kpShear, '<='),
    detail('bending', sigma, 'psi', al.kpBend, '<='),
    detail('bore bearing in the beam (oak ⊥)', bearing, 'psi', al.oakPerp, '<='),
  ];
  const how = `Horizontal pull ${H} lbf (D-14 design peak) at the turntable plane. ${double ? 'Bolt passes the beam and the bolster: double shear, M = H·s/4.' : 'Bolt passes the beam and turntable only: single shear, plus cantilever bending over the stack'} s = ${f(stack, 3)}" (layout.kingpin): τ = H/A = ${f(H)}/${f(sec.A, 3)} = ${f(tau, 0)} psi (≤ 0.577·${f(p.kingpinYieldPsi, 0)}/${p.kingpinMargin} = ${f(al.kpShear, 0)}); M = ${f(M)} lb·in, σ = ${f(sigma, 0)} psi (≤ ${f(al.kpBend, 0)}); bearing on the oak bore H/(d·depth) = ${f(bearing, 0)} psi (≤ ${f(al.oakPerp, 0)}).`;
  const ev = governing(ds, how);
  return dualCheck({
    id: 'kingpin', label: 'Kingpin bolt', group: 'Structure', refs: ['D-12', 'D-14', 'D-4'], primary: 'goal',
    ...evalBoth(ctx, () => ev),
  });
}

export function turntableCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const cap = p.turntableRatingLb / p.kingpinMargin;
  const ev = (c: CaseData): CaseEval => {
    const w = wheelLoads(ctx, c);
    const F = w.frontAxle * p.dynamicFactor;
    return {
      value: F, unit: 'lbf', limit: cap, sense: '<=',
      how: `Front axle load ${f(w.frontAxle)} lb × ${p.dynamicFactor} = ${f(F)} lbf vs rating ${p.turntableRatingLb} lb / margin ${p.kingpinMargin} = ${f(cap)} lbf. (The turntable is not moment-rated: roll goes through the side-bearers, D-12.)`,
    };
  };
  return dualCheck({
    id: 'turntable', label: 'Turntable rating', group: 'Structure', refs: ['D-12', 'D-2'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

export function tongueCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const t = part(ctx, 'tongue');
  if (p.drawbar !== DRAWBAR.woodTongue || !t || t.geometry.type !== 'box') {
    return singleCheck({
      id: 'tongue', label: 'Tongue bending', group: 'Structure', value: 0, unit: 'psi', limit: al.oakBend, sense: '<=', info: true,
      how: 'No wooden tongue: rope bridle only (D-14).', refs: ['D-14'], load: 'goal',
    });
  }
  const [len, thick, depth] = t.geometry.size;
  const Fperp = p.pullForceLbf * Math.SQRT1_2;
  const Fax = p.pullForceLbf * Math.SQRT1_2;
  const M = Fperp * len;
  const lat = rectSection(depth, thick);
  const vert = rectSection(thick, depth);
  const sLat = bendingStress(M, lat) + Fax / (thick * depth);
  const sVert = bendingStress(M, vert) + Fax / (thick * depth);
  const ds = [
    detail('lateral bending at the beam joint', sLat, 'psi', al.oakBend, '<='),
    detail('vertical bending at the beam joint', sVert, 'psi', al.oakBend, '<='),
  ];
  const how = `Pull ${p.pullForceLbf} lbf at 45° to the tongue axis (D-14): perpendicular component ${f(Fperp)} lbf and axial ${f(Fax)} lbf at the tip, ${f(len)}" from the beam joint; tongue ${f(thick, 2)}" wide × ${f(depth, 2)}" deep. M = ${f(M)} lb·in. Lateral: σ = M/S + F/A = ${f(M)}/${f(lat.S, 3)} + ${f(Fax / (thick * depth), 0)} = ${f(sLat, 0)} psi; vertical: ${f(sVert, 0)} psi; design ${f(al.oakBend, 0)} psi.`;
  const ev = governing(ds, how);
  return dualCheck({
    id: 'tongue', label: 'Tongue bending', group: 'Structure', refs: ['D-14', 'D-4'], primary: 'goal',
    ...evalBoth(ctx, () => ev),
  });
}

