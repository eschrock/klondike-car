/**
 * Structural checks (D-2, D-4, D-5, D-10, D-12, D-14, D-17). Each is evaluated at the operating and the goal rider; the
 * row shows the goal case (D-2: structure is sized to the goal rider) and `statusOperating` the other.
 *
 * Load factors: payload × dynamicFactor; members that also carry the cart's weight (axles, axle beams, kingpin side,
 * turntable) use the axle's static ground reaction × dynamicFactor, which already contains the cart mass (D-2).
 * Wood allowables are MOR/MOE × wet-service factors, with the wood safety factor; steel is yield / steel SF.
 */
import { FRAME_STYLE, AXLE_STYLE, DRAWBAR, SIDE_CONSTRUCTION, kingpinBoreIn, kingpinWasherEffectiveIn, type Params } from '../params';
import { worldAABB } from '../model/bounds';
import { kingpinPlatePlan } from '../model/kingpin-plates';
import type { Part } from '../model/types';
import type { Ctx } from './context';
import { dualCheck, singleCheck, detail, governing, type CaseEval } from './dual';
import { DEG, RAD, axleLoads, contactsAt } from './geometry';
import { f } from './format';
import type { CaseData } from './loads';
import { bendingStress, cantileverTip, circleSection, rectSection, rectShear, ssPointMid, ssUdlCentered, ssUdlFull, transformedSection, type Layer } from './beams';
import { evalBoth, rearNormalNoseDown } from './stability';
import type { AnalysisCheck, Detail } from './types';

export function allowables(ctx: Ctx) {
  const { p, d } = ctx;
  return {
    oakBend: d.oakDesignMorPsi,
    oakShear: (p.oakShearPsi * p.wetServiceFactorStrength) / p.woodSafetyFactor,
    // Compression ⊥ uses its own wet-service factor (NDS C_M for F_c⊥ = 0.67), not the 0.85 on bending and shear (M2).
    oakPerp: (p.oakCompPerpPsi * p.wetServiceFactorCompPerp) / p.woodSafetyFactor,
    oakDowel: (p.oakDowelBearingPsi * p.wetServiceFactorStrength) / p.woodSafetyFactor,
    uhmw: p.uhmwBearingPsi,
    fastShear: (0.577 * p.bolsterFastenerYieldPsi) / p.kingpinMargin,
    fastTens: p.bolsterFastenerYieldPsi / p.kingpinMargin,
    plyBend: d.plyDesignMorPsi,
    steel: d.axleAllowablePsi,
    kpShear: (0.577 * p.kingpinYieldPsi) / p.kingpinMargin,
    kpBend: p.kingpinYieldPsi / p.kingpinMargin,
    /** Steel sleeve (A36 / 1018 tube): bearing allowable 0.9·Fy / steel SF. */
    sleeve: (0.9 * p.sleeveYieldPsi) / p.steelSafetyFactor,
    /** Kingpin steel plates (D-35): bearing on a plate hole 0.9·Fy / steel SF, net-section tension Fy / steel SF. */
    plateBrg: (0.9 * p.kingpinPlateYieldPsi) / p.steelSafetyFactor,
    plateTens: p.kingpinPlateYieldPsi / p.steelSafetyFactor,
    Eoak: d.oakDesignMoePsi,
    Eply: d.plyMoePsi * p.wetServiceFactorStiffness,
  };
}

export const part = (ctx: Ctx, id: string): Part | undefined => ctx.byId.get(id);

/**
 * Ground reaction per axle and the heavier wheel of each axle for a load case (static, δ = 0). The FRONT axle takes the
 * worse of the level distribution and the nose-down distribution on the design slope, N_f = W·cosθ − N_r (M4); rear is level.
 */
export function wheelLoads(ctx: Ctx, c: CaseData) {
  const ct = contactsAt(ctx.contact, 0);
  const xfc = (ct.FL[0] + ct.FR[0]) / 2;
  const a = axleLoads(c.massLb, c.cg[0], xfc);
  const th = ctx.p.designSlopeDeg * RAD;
  const frontSlope = c.massLb * Math.cos(th) - Math.max(0, rearNormalNoseDown(c.massLb, c.cg[0], c.cg[2], th, xfc));
  const front = Math.max(a.front, frontSlope);
  const share = (T: number) => 0.5 + Math.abs(c.cg[1]) / T;
  return {
    frontAxle: front,
    frontLevel: a.front,
    frontSlope,
    rearAxle: a.rear,
    frontWheel: front * share(ctx.p.frontTrackIn),
    rearWheel: a.rear * share(ctx.p.rearTrackIn),
  };
}

export const frontLoadText = (ctx: Ctx, w: ReturnType<typeof wheelLoads>) =>
  `front axle ${f(w.frontAxle)} lb = worse of level ${f(w.frontLevel)} and nose-down on ${f(ctx.p.designSlopeDeg)}° ${f(w.frontSlope)} (M4)`;

export const payload = (ctx: Ctx, c: CaseData) => (c.riderLb + c.cargoLb) * ctx.p.dynamicFactor;

interface Clamp { outerY: number; centerY: number; widthY: number }
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
  return { outerY: outer, centerY: (lo + hi) / 2, widthY: hi - lo };
}

// ── axles ────────────────────────────────────────────────────────────────────────────────────────────────────

export function axleStress(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const sec = circleSection(p.axleDiameterIn);
  const E = p.steelMoePsi;
  const stub = p.axleStyle === AXLE_STYLE.stubAxles;
  const wheelR = ctx.d.wheelRadiusIn;
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
      // M5: a tire friction force H = μ·P_des acts at the contact patch (arm r below the axle) at angle ψ from the axle axis.
      // Its axial part H·cosψ bends the rod in the vertical plane through the arm r (adds to P·a, either sign) and loads it axially;
      // its fore-aft part H·sinψ bends the rod in the orthogonal plane with arm a. Worst ψ over 0…90°.
      const H = p.tireGroundMu * Pstatic;
      let sigma = 0, psiW = 0, Mv = des.M, Mh = 0;
      for (let psi = 0; psi <= 90; psi += 1) {
        const Hy = H * Math.cos(psi * RAD), Hx = H * Math.sin(psi * RAD);
        const mv = des.M + Hy * wheelR, mh = Hx * a;
        const sg = Math.hypot(mv, mh) * sec.c / sec.I + Hy / sec.A;
        if (sg > sigma) { sigma = sg; psiW = psi; Mv = mv; Mh = mh; }
      }
      return { tag, a, Pstatic, Pdes, H, M: des.M, Mv, Mh, psiW, sigma, sigmaV: bendingStress(des.M, sec), defl: stat.defl };
    });
    const ds: Detail[] = rows.map((r) => detail(`${r.tag === 'F' ? 'front' : 'rear'} axle bending (vertical + tire friction, resultant)`, r.sigma, 'psi', al.steel, '<='));
    const extra: Detail[] = rows.map((r) => detail(`${r.tag === 'F' ? 'front' : 'rear'} axle tip deflection (static)`, r.defl, 'in', 0.05, '<='));
    const how = rows
      .map((r) => `${r.tag === 'F' ? 'Front' : 'Rear'}: P = ${f(r.Pstatic)} lb static wheel load${r.tag === 'F' ? ` (${frontLoadText(ctx, w)})` : ''} × ${p.dynamicFactor} = ${f(r.Pdes)} lbf at the hub; cantilever a = ${f(r.a, 2)}" from the ${stub ? 'beam face (stub axle)' : 'clamp plate outer edge (through rod)'} (the pressure peak is ~0.4" outboard of the clamp edge, so a is a conservative simplification, D3); vertical-only M = P·a = ${f(r.M)} lb·in, σ = ${f(r.sigmaV, 0)} psi. With the tire friction force H = μ·P_static = ${f(p.tireGroundMu, 2)} × ${f(r.Pstatic)} = ${f(r.H)} lbf (cornering / side-slope limit on the static normal load; using the ×${p.dynamicFactor} design load instead would give ${f(p.tireGroundMu * r.Pdes)} lbf) at the contact radius r = ${f(wheelR, 2)}" (worst angle ${f(r.psiW, 0)}° from the axle axis): M_vertical-plane = ${f(r.Mv)}, M_fore-aft = ${f(r.Mh)} lb·in, resultant σ = √(Mv²+Mh²)·c/I + H_axial/A = ${f(r.sigma, 0)} psi; tip deflection P_static·a³/3EI = ${r.defl.toFixed(4)}" (guide ≤ 0.05", info).`)
      .join(' | ') + ` Allowable ${f(al.steel, 0)} psi (yield ${f(p.axleYieldPsi, 0)} / SF ${p.steelSafetyFactor}).`;
    const e = governing(ds, how);
    e.details = [...ds, ...extra];
    return e;
  };
  return dualCheck({
    id: 'axle-stress', label: stub ? 'Stub axle bending' : 'Axle bending (through rod)', group: 'Structure', refs: ['D-2', 'D-4', 'D-10', 'D-16'], primary: 'goal',
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
  const ys = clamp.centerY;
  let M: number, load: string;
  if (kind === 'front') {
    const yl = p.turntableSizeIn / 2;
    M = (F / 2) * Math.abs(ys - yl);
    load = `Turntable load F = ${frontLoadText(ctx, w)} × ${p.dynamicFactor} = ${f(F)} lbf as two loads F/2 = ${f(F / 2)} at y = ±${f(yl)}" (turntable edges), reactions at the clamp plates (y = ±${f(ys, 2)}")`;
  } else {
    // The rail/girder at the rear axle (x = 0) is on the straight cabin side: its centerline, not the bounding box of the curved member (D-45).
    const yr = part(ctx, 'rail-cabin-L') ? ctx.L.hwC + ctx.L.side - p.railThicknessIn / 2 : part(ctx, 'girder-cabin-L') ? ctx.L.hwC + ctx.L.side / 2 : ctx.L.hwC;
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
      how: `${worstTag === 'R' ? 'Rear' : 'Front'} wheel design load ${f(Pw)} lbf (static ${f(Pw / p.dynamicFactor)} × ${p.dynamicFactor}) ${worstTag === 'F' ? '(front: worse of level and nose-down on the design slope, M4) ' : ''}bears on the groove over rod dia × clamp-plate length along the rod = ${f(p.axleDiameterIn, 3)}" × ${f(len, 2)}" = ${f(area, 2)} in² (the two U-bolt plates straddle the same rod length, so they are counted once; conservative against 2 plates): ${f(s, 0)} psi vs compression ⊥ design ${f(al.oakPerp, 0)} psi (${p.oakCompPerpPsi} × C_M ${p.wetServiceFactorCompPerp} (NDS F_c⊥ wet service, M2) / ${p.woodSafetyFactor}).`,
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
  // Real member sections (D-45, eng N-4): never the bounding box of a curved part. A bent chine, gunwale or girder (plan curve), and the sheer
  // gunwale (a 4" board sawn to a 1.5" band), have large bounding boxes; the section is the thickness x height the member actually has.
  const oak = (x: Part | undefined, b: number, z0: number, z1: number): Layer | null => (x ? { b, z0, z1, E: al.Eoak, kind: 'oak' } : null);
  const list: (Layer | null)[] = [];
  if (zone === 'cabin') list.push(oak(part(ctx, 'girder-cabin-L'), L.side, L.deckBot - p.railDepthIn, L.railTop));
  const pre = `side-${zone}-L`;
  if (p.sideConstruction === SIDE_CONSTRUCTION.solidOak) list.push(oak(part(ctx, `${pre}-board`), L.side, L.deckBot, L.sideTop));
  else {
    const open = p.sideConstruction === SIDE_CONSTRUCTION.openFrame;
    list.push(oak(part(ctx, `${pre}-chine`), L.side, L.chineBot, L.chineBot + L.chineH), oak(part(ctx, `${pre}-gunwale`), L.side, L.sideTop - L.railBand, L.sideTop));
    if (p.sideConstruction === SIDE_CONSTRUCTION.capturedPly && !open) {
      const web = part(ctx, `${pre}-web`);
      if (web) list.push({ b: p.panelPlyIn, z0: L.web.z0, z1: L.web.z1, E: al.Eply, kind: 'ply' });
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
  // Sprung chassis weight the rails also carry (deck, sides, seat, storage, fittings; axles/beams/clamps are carried directly), M3.
  const selfLb = ctx.parts.reduce((m, x) => (x.body === 'chassis' && !x.payload && x.group !== 'reference' && x.group !== 'running-gear' ? m + x.massLb : m), 0);
  const ev = (c: CaseData): CaseEval => {
    const Pdyn = payload(ctx, c);
    const Pstat = c.riderLb + c.cargoLb;
    const Pm = Pdyn / 2;
    const Wm = (selfLb * p.dynamicFactor) / 2; // chassis self-weight × dynamic factor, per rail, uniform over the span
    const Ws = selfLb / 2; // static, for deflection
    const selfTxt = `Chassis self-weight ${f(selfLb)} lb (all chassis parts above the axles, M3) × ${p.dynamicFactor} = ${f(selfLb * p.dynamicFactor)} lbf as a UDL, ${f(Wm)} lbf per member (static ${f(Ws)} lb in deflection).`;
    const ds: Detail[] = [];
    let how: string;
    if (!hull) {
      // Real section (D-45: the rail is a bent lamination, its bounding box is not its section).
      const b = p.railThicknessIn;
      const h = p.railDepthIn;
      const sec = rectSection(b, h);
      const r0 = ssPointMid(Pm, span, al.Eoak * sec.I);
      const u0 = ssUdlFull(Wm, span, al.Eoak * sec.I);
      const r = { M: r0.M + u0.M, V: r0.V + u0.V };
      const sigma = bendingStress(r.M, sec);
      const tau = rectShear(r.V, b, h);
      const defl = ssPointMid(Pstat / 2, span, al.Eoak * sec.I).defl + ssUdlFull(Ws, span, al.Eoak * sec.I).defl;
      ds.push(detail('bending', sigma, 'psi', al.oakBend, '<='), detail('shear', tau, 'psi', al.oakShear, '<='), detail('static deflection', defl, 'in', span / p.deflectionLimitRatio, '<='));
      how = `Ladder rails ${f(b, 2)}" × ${f(h, 2)}" (2 members). Payload (${c.riderLb} + ${c.cargoLb}) × ${p.dynamicFactor} = ${f(Pdyn)} lbf as a point load at midspan of the ${f(span)}" span (rear beam to kingpin), ${f(Pm)} lbf per rail: M = PL/4 + wL²/8 = ${f(r0.M)} + ${f(u0.M)} = ${f(r.M)} lb·in. ${selfTxt} σ = M/S = ${f(sigma, 0)} psi (≤ ${f(al.oakBend, 0)}); τ = 1.5V/A = ${f(tau, 0)} psi (≤ ${f(al.oakShear, 0)}); static δ = P·L³/48EI + 5WL³/384EI with P = ${f(Pstat / 2)} lb, W = ${f(Ws)} lb: ${defl.toFixed(3)}" (≤ L/${p.deflectionLimitRatio} = ${(span / p.deflectionLimitRatio).toFixed(3)}").`;
    } else {
      const lay = hullLayers(ctx, 'cabin');
      if (!lay) {
        ds.push(detail('bending', 0, 'psi', al.oakBend, '<='));
        how = 'Hull-beam girder section not found in the parts list.';
      } else {
        const ts = transformedSection(lay, al.Eoak);
        const r0 = ssPointMid(Pm, span, ts.EI);
        const u0 = ssUdlFull(Wm, span, ts.EI);
        const r = { M: r0.M + u0.M };
        const cOak = Math.max(...ts.layers.filter((q) => q.kind === 'oak').map((q) => q.cMax), 0);
        const cPly = Math.max(...ts.layers.filter((q) => q.kind === 'ply').map((q) => q.cMax), 0);
        const nPly = ts.layers.find((q) => q.kind === 'ply')?.n ?? 0;
        const sOak = (r.M * cOak) / ts.I;
        ds.push(detail('girder bending (oak)', sOak, 'psi', al.oakBend, '<='));
        if (cPly > 0) ds.push(detail('girder bending (ply web)', (nPly * r.M * cPly) / ts.I, 'psi', al.plyBend, '<='));
        const defl = ssPointMid(Pstat / 2, span, ts.EI).defl + ssUdlFull(Ws, span, ts.EI).defl;
        ds.push(detail('static deflection', defl, 'in', span / p.deflectionLimitRatio, '<='));
        // Nose section (no deepened girder) at the shoulder, with the load just aft of it.
        let noseTxt = '';
        const nose = L.xs < L.kx ? hullLayers(ctx, 'nose') : null;
        if (nose) {
          const tn = transformedSection(nose, al.Eoak);
          const Mn = (Pm * L.xs * (L.kx - L.xs)) / L.kx + ((Wm / L.kx) * L.xs * (L.kx - L.xs)) / 2;
          const cn = Math.max(...tn.layers.filter((q) => q.kind === 'oak').map((q) => q.cMax), 0);
          const sn = (Mn * cn) / tn.I;
          ds.push(detail('nose side bending at the shoulder (oak)', sn, 'psi', al.oakBend, '<='));
          noseTxt = ` Nose side section at the shoulder (load just aft of it plus the self-weight UDL, M = P·xs(L−xs)/L + w·xs(L−xs)/2 = ${f(Mn)} lb·in): σ = ${f(sn, 0)} psi.`;
        }
        how = `Hull-beam girders (2 members), transformed I-section from the actual parts (oak girder + chine + gunwale flanges, ply web, n_ply = E_ply/E_oak = ${f(nPly, 2)}): NA at z = ${f(ts.zNa, 2)}", I_tr = ${f(ts.I, 1)} in⁴. Payload × ${p.dynamicFactor} = ${f(Pdyn)} lbf at midspan of ${f(span)}", ${f(Pm)} lbf per girder: M = ${f(r0.M)} + ${f(u0.M)} (self-weight) = ${f(r.M)} lb·in. ${selfTxt} σ_oak = ${f(sOak, 0)} psi (≤ ${f(al.oakBend, 0)}); static δ = ${defl.toFixed(3)}" (≤ L/${p.deflectionLimitRatio} = ${(span / p.deflectionLimitRatio).toFixed(3)}").${noseTxt}`;
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
  const edges: number[] = [L.xRear + L.transom]; // D-43: the transom, not the chine thickness
  for (const x of L.cabinJoistX) edges.push(x - half, x + half);
  edges.push(L.xs);
  let m = 0;
  for (let i = 0; i + 1 < edges.length; i += 2) m = Math.max(m, edges[i + 1] - edges[i]);
  return Math.max(1, m);
}

/** Standing-scout foot patch: 4" along the span × 10" across (spec). */
const FOOT_ALONG_IN = 4;
const FOOT_ACROSS_IN = 10;
const STOCK_PLY_MM = [6, 9, 12, 18];

/**
 * Effective strip width of a one-way plate under a patch load at midspan, simply supported (D1): b_eff = b_patch + 2.5·x(1 − x/L)
 * at x = L/2, i.e. b_patch + 0.625·L (EN 1992-1-1 / BS 8110 effective-width rule for concentrated loads on a one-way slab).
 */
export const effectiveStripWidth = (patchAcross: number, span: number): number => patchAcross + 0.625 * span;

export function deckCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const span = maxDeckSpan(ctx);
  const t = p.deckPlyIn;
  const b = 12;
  const lim = span / p.deflectionLimitRatio;
  const beff = effectiveStripWidth(FOOT_ACROSS_IN, span);
  const beffAlt = FOOT_ACROSS_IN + span;
  // Standing-scout response for a ply thickness: bending stress and static deflection of the b_eff strip.
  const standing = (th: number, footLb: number, width = beff) => {
    const sec = rectSection(width, th);
    const r = ssUdlCentered(footLb / FOOT_ALONG_IN, FOOT_ALONG_IN, span, al.Eply * sec.I);
    return { M: r.M, sigma: r.M / sec.S, defl: r.defl };
  };
  const seatCase = (th: number, c: CaseData) => {
    const sec = rectSection(b, th);
    const seatArea = p.seatDepthIn * L.seat.width;
    const wSeat = ((c.riderLb * p.dynamicFactor) / seatArea) * Math.min(b, L.seat.width);
    const a = ssUdlCentered(wSeat, p.seatDepthIn, span, al.Eply * sec.I);
    return { wSeat, M: a.M, sigma: a.M / sec.S };
  };
  const passes = (th: number, c: CaseData) => {
    const st = standing(th, c.riderLb);
    return seatCase(th, c).sigma <= al.plyBend && st.sigma <= al.plyBend && st.defl <= lim;
  };
  const needed = (c: CaseData): number => {
    let lo = 0.05, hi = 3;
    if (!passes(hi, c)) return Infinity;
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (passes(mid, c)) hi = mid; else lo = mid; }
    return hi;
  };
  const ev = (c: CaseData): CaseEval => {
    const sa = seatCase(t, c);
    const s = standing(t, c.riderLb);
    const ds = [
      detail('seat case bending', sa.sigma, 'psi', al.plyBend, '<='),
      detail('standing scout bending', s.sigma, 'psi', al.plyBend, '<='),
      detail('standing scout deflection', s.defl, 'in', lim, '<='),
    ];
    const tReq = needed(c);
    const stock = STOCK_PLY_MM.find((mm) => mm / 25.4 >= tReq - 1e-9);
    const sens = STOCK_PLY_MM.map((mm) => `${mm} mm: ${standing(mm / 25.4, c.riderLb).defl.toFixed(3)}"`).join(', ');
    const alt = standing(t, c.riderLb, beffAlt).defl;
    const how = `Ply ${f(t, 3)}" (${f(t * 25.4, 1)} mm) on the largest crossmember span ${f(span, 2)}" (panel simply supported: the captured/glued edges give some fixity that is not counted). (a) Seat: ${c.riderLb} lb × ${p.dynamicFactor} spread over ${f(p.seatDepthIn)}" × ${f(L.seat.width)}" → ${f(sa.wSeat, 1)} lb/in on a 12" strip, M = ${f(sa.M)} lb·in, σ = ${f(sa.sigma, 0)} psi. (b) Standing scout: ${c.riderLb} lb static on a ${FOOT_ALONG_IN}" (along the span) × ${FOOT_ACROSS_IN}" patch at midspan, treated as a one-way plate with effective strip width b_eff = b_patch + 2.5·x(1−x/L) = ${FOOT_ACROSS_IN} + 0.625 × ${f(span, 2)} = ${f(beff, 1)}" (EN 1992 / BS 8110 rule for a point load on a one-way slab at x = L/2): M = ${f(s.M)} lb·in, σ = ${f(s.sigma, 0)} psi, δ = ${s.defl.toFixed(3)}" vs span/${p.deflectionLimitRatio} = ${lim.toFixed(3)}". Ply design stress ${f(al.plyBend, 0)} psi, E = ${f(al.Eply, 0)} psi (E × C_M ${p.wetServiceFactorStiffness}). Thickness that passes all three: ≥ ${Number.isFinite(tReq) ? `${f(tReq * 25.4, 1)} mm (${f(tReq, 3)}")` : 'more than 3"'}${stock ? `, so the next stock ply is ${stock} mm` : ''}. Standing-scout deflection by stock ply (same b_eff, this load): ${sens}. For reference, the looser b_eff = patch + span = ${f(beffAlt, 1)}" would give ${alt.toFixed(3)}" at the current ply.`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'deck', label: 'Deck ply panel', group: 'Structure', refs: ['D-2', 'D-5', 'D-17'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

// ── steering structure ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Kingpin geometry shared by the pull, strike and roll rows.
 *
 * Without the crossbar (kingpinThroughBolster = 0) the pin stops at the turntable top: single shear at the turntable interface,
 * a cantilever over the whole stack s (beam underside to turntable top), M = H·s (the old model, kept for comparison).
 *
 * With the crossbar (= 1) the pin is held in two members, the steer beam below and the chassis crossbar above, with the
 * turntable (thickness g) between them. The horizontal force enters the pin from one member and leaves into the other, so it
 * crosses the pin ONCE, at the turntable plane: that is SINGLE shear (a double-shear pin needs a fork of two chassis members
 * either side of the beam; the load point is not "midway between two supports" here, so M = H·s/4 does not apply).
 * Each member bears over its own depth D (beam D1, crossbar D2). Moment equilibrium of the pin needs the two bearing
 * resultants to sit the same distance a from the shear plane; a uniform bearing puts them at g/2 + D/2, and the shallower
 * member cannot shift its resultant much closer or further, so a = g/2 + min(D1, D2)/2 and the peak bending moment (at the
 * shear plane) is M = H·a. This is the elastic equal-lever estimate for a pin in two bearing members, far below the cantilever
 * H·s because the bearing spreads the load along the pin instead of acting at the tip.
 */
function kingpinGeom(ctx: Ctx) {
  const { p, L } = ctx;
  const sec = circleSection(p.kingpinDiameterIn);
  const stack = Math.max(0.1, L.kingpin.z1 - L.kingpin.z0);
  const cb = L.crossbar;
  const through = cb !== null;
  const D1 = L.beamF.depth;
  const D2 = cb ? cb.z1 - cb.z0 : 0;
  const g = L.turntable.z1 - L.turntable.z0;
  // D-35 (kingpin steel plates): the pin runs in the sleeve, supported at the sleeve's two ends (a apart), and is loaded by the crossbar plate b above the
  // sleeve top: an overhanging beam, reactions R_top = H(1 + b/a) and R_bot = −H·b/a, bending H·b at the top support.
  const kpl = L.kpPlates;
  const a = kpl ? (kpl.carrier.z0 + kpl.carrier.z1) / 2 - (kpl.under.z0 + kpl.under.z1) / 2 : 0;
  const b = kpl ? (kpl.bar.z0 + kpl.bar.z1) / 2 - (kpl.carrier.z0 + kpl.carrier.z1) / 2 : 0;
  const arm = kpl ? b : through ? g / 2 + Math.min(D1, D2) / 2 : stack;
  const bore = kingpinBoreIn(p);
  return { sec, stack, through, D1, D2, g, arm, bore, sleeve: p.kingpinSleeveOdIn > 0, cbWidth: cb ? 2 * cb.hw : 0, plates: !!kpl, a, b, tBar: kpl ? kpl.bar.z1 - kpl.bar.z0 : 0 };
}

/** Kingpin stresses for a horizontal load H at the turntable plane (single shear; see kingpinGeom for the moment arm). */
function kingpinStress(ctx: Ctx, H: number) {
  const g = kingpinGeom(ctx);
  const d = ctx.p.kingpinDiameterIn;
  const M = H * g.arm;
  return {
    ...g,
    tau: H / g.sec.A,
    M,
    sigma: bendingStress(M, g.sec),
    /** Oak bore bearing in the beam (on the sleeve OD when fitted), average over the bore. Zero with the kingpin plates: the pin touches no oak (D-35). */
    bearing: g.plates ? 0 : H / (g.bore * g.D1),
    /** Same in the crossbar (through only). */
    bearingBar: g.plates ? 0 : g.through ? H / (g.bore * g.D2) : 0,
    /** Pin on the steel sleeve (sleeve only): the pin diameter over the shallower member; with the plates, the top reaction R_top over a pin-diameter length of sleeve. */
    sleeveBrg: g.plates ? (H * (1 + g.b / g.a)) / (d * d) : g.sleeve ? H / (d * (g.through ? Math.min(g.D1, g.D2) : g.D1)) : 0,
    /** Pin on the hole of the crossbar plate (steel on steel), D-35. */
    plateBrg: g.plates ? H / (d * g.tBar) : 0,
    /** Crossbar end face on the bolster rail notch (fore-aft load, rails run across: oak ⊥). */
    endBrg: g.through ? H / (g.cbWidth * g.D2) : 0,
  };
}

type KpStress = ReturnType<typeof kingpinStress>;

/** The bearing rows shared by the pull and strike checks (the ones that exist for this configuration). */
function kingpinBearingDetails(k: KpStress, al: ReturnType<typeof allowables>, prefix: string): Detail[] {
  if (k.plates) {
    return [
      detail('pin on the steel sleeve, peak at the top end (R_top over one pin diameter)', k.sleeveBrg, 'psi', al.sleeve, '<='),
      detail('pin on the crossbar plate hole (steel on steel)', k.plateBrg, 'psi', al.plateBrg, '<='),
      detail('crossbar end bearing on the bolster rail (oak ⊥)', k.endBrg, 'psi', al.oakPerp, '<='),
    ];
  }
  const out: Detail[] = [detail(`${prefix} in the beam (oak ⊥)`, k.bearing, 'psi', al.oakPerp, '<=')];
  if (k.through) {
    out.push(detail(`${prefix} in the crossbar (oak ⊥)`, k.bearingBar, 'psi', al.oakPerp, '<='));
    out.push(detail('crossbar end bearing on the bolster rail (oak ⊥)', k.endBrg, 'psi', al.oakPerp, '<='));
  }
  if (k.sleeve) out.push(detail('pin on steel sleeve bearing', k.sleeveBrg, 'psi', al.sleeve, '<='));
  return out;
}

const kingpinUtil = (k: KpStress, al: ReturnType<typeof allowables>) =>
  Math.max(k.tau / al.kpShear, k.sigma / al.kpBend, k.bearing / al.oakPerp, k.through ? Math.max(k.bearingBar, k.endBrg) / al.oakPerp : 0, k.sleeve || k.plates ? k.sleeveBrg / al.sleeve : 0, k.plates ? k.plateBrg / al.plateBrg : 0);

const SHEAR_TXT = (k: KpStress) => k.plates
  ? `the pin runs in the steel sleeve through the beam, supported where the sleeve spigots into the carrier and the beam plate (a = ${f(k.a, 2)}" apart, D-35), and is loaded by the crossbar plate b = ${f(k.b, 2)}" above the carrier: an overhanging pin, reactions R_top = H(1 + b/a) = ${f(1 + k.b / k.a, 3)}·H and R_bot = −H·b/a, bending M = H·b = H·${f(k.arm, 3)}", single shear H between the sleeve top and the crossbar plate; it touches no oak`
  : k.through
  ? `the pin is held in the beam below and the chassis crossbar above the turntable (g = ${f(k.g, 3)}"), so the force crosses it once at the turntable plane: single shear, with the bearing spread over the member depths (beam ${f(k.D1, 2)}", crossbar ${f(k.D2, 2)}"); equal-lever moment M = H·(g/2 + D_min/2) = H·${f(k.arm, 3)}"`
  : 'the shear plane is the turntable interface between the steer body (beam + lazy-susan bottom plate) and the chassis side (top plate/bolster); the bolt is a cantilever fixed at the beam-underside washer over the whole stack s';

const BORE_TXT = (p: Params, k: KpStress) => k.sleeve
  ? `${f(k.bore, 3)}" steel sleeve OD (pin ${f(p.kingpinDiameterIn, 3)}")`
  : `${f(k.bore, 3)}" bore`;

export function kingpinCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const H = p.pullForceLbf;
  const k = kingpinStress(ctx, H);
  const ds = [
    detail('shear', k.tau, 'psi', al.kpShear, '<='),
    detail('bending', k.sigma, 'psi', al.kpBend, '<='),
    ...kingpinBearingDetails(k, al, 'bore bearing'),
  ];
  const how = `Horizontal pull ${H} lbf (D-14 design peak) at the turntable plane. ${k.through ? 'Bolt passes the beam, the turntable and the oak crossbar over it.' : 'Bolt passes the beam and turntable only.'} Single shear (${SHEAR_TXT(k)}): τ = H/A = ${f(H)}/${f(k.sec.A, 3)} = ${f(k.tau, 0)} psi (≤ 0.577·${f(p.kingpinYieldPsi, 0)}/${p.kingpinMargin} = ${f(al.kpShear, 0)}); M = ${f(k.M)} lb·in, σ = ${f(k.sigma, 0)} psi (≤ ${f(al.kpBend, 0)})${k.plates ? `; pin on the sleeve (peak, top end) ${f(k.sleeveBrg, 0)} psi (≤ ${f(al.sleeve, 0)}), on the crossbar plate hole ${f(k.plateBrg, 0)} psi (≤ ${f(al.plateBrg, 0)} = 0.9·${f(p.kingpinPlateYieldPsi, 0)}/${p.steelSafetyFactor}), crossbar end on the rail ${f(k.endBrg, 0)} psi (≤ ${f(al.oakPerp, 0)}); the oak sees only the plate bolts ('kingpin-bolts')` : `; bearing on the oak of the ${BORE_TXT(p, k)}: beam H/(d·depth) = ${f(k.bearing, 0)} psi${k.through ? `, crossbar ${f(k.bearingBar, 0)} psi, crossbar end on the rail ${f(k.endBrg, 0)} psi` : ''} (≤ ${f(al.oakPerp, 0)} = ${p.oakCompPerpPsi} × C_M ${p.wetServiceFactorCompPerp} / ${p.woodSafetyFactor}; average over the bore, a rigid pin peaks higher, D6)${k.sleeve ? `; pin on the steel sleeve ${f(k.sleeveBrg, 0)} psi (≤ 0.9·${f(p.sleeveYieldPsi, 0)}/${p.steelSafetyFactor} = ${f(al.sleeve, 0)})` : ''}`}. The bridle pull is the lighter horizontal case: see 'kingpin-strike' for curb/root strikes.`;
  const ev = governing(ds, how);
  return dualCheck({
    id: 'kingpin', label: 'Kingpin bolt (bridle pull)', group: 'Structure', refs: ['D-12', 'D-14', 'D-4'], primary: 'goal',
    ...evalBoth(ctx, () => ev),
  });
}

// ── front-wheel obstacle strike (H1) and the D-12 roll path (H2) ────────────────────────────────────────────────

/**
 * Horizontal force at which a wheel of radius r climbs a step of height h under vertical load V: the contact normal is
 * tilted by φ with cos φ = (r − h)/r, so H = V·tanφ (h capped at 0.9 r: a taller step is a wall).
 */
export function obstacleForce(r: number, h: number, V: number): { H: number; phi: number; tan: number; hEff: number } {
  const hEff = Math.min(h, 0.9 * r);
  const cos = (r - hEff) / r;
  const phi = Math.acos(cos);
  const tan = Math.sqrt(1 - cos * cos) / cos;
  return { H: V * tan, phi, tan, hEff };
}

/** Roll balance of the steer body with one wheel loaded (P at y_w) and the bearer at y_sb: F_sb = P·y_w/y_sb, uplift U = F_sb − P. */
export function rollBalance(P: number, yw: number, ysb: number): { Fsb: number; U: number } {
  const Fsb = (P * yw) / ysb;
  return { Fsb, U: Math.max(0, Fsb - P) };
}

export interface Strike { name: string; both: boolean; h: number; hEff: number; phi: number; tan: number; Vw: number; Hw: number; H: number }

/**
 * Curb and root strikes by the front wheel(s). The wheel climbs the obstacle when the horizontal force reaches V·tanφ with
 * cos φ = (r − h)/r (h capped at 0.9 r: a taller step is a wall). V is the design (×dynamicFactor) front wheel load: the
 * heavier wheel alone, or both wheels at half the axle each. Both wheels: H = 2·H_w; one wheel: H = H_w.
 */
export function strikeCases(ctx: Ctx, c: CaseData): Strike[] {
  const { p, d } = ctx;
  const w = wheelLoads(ctx, c);
  const r = d.wheelRadiusIn;
  const out: Strike[] = [];
  for (const [name, h] of [['curb', p.curbHeightIn], ['root', p.rootHeightIn]] as const) {
    for (const both of [true, false]) {
      const Vw = (both ? w.frontAxle / 2 : w.frontWheel) * p.dynamicFactor;
      const { H: Hw, phi, tan, hEff } = obstacleForce(r, h, Vw);
      out.push({ name: `${name} ${both ? 'both wheels' : 'one wheel'}`, both, h, hEff, phi, tan, Vw, Hw, H: both ? 2 * Hw : Hw });
    }
  }
  return out;
}

/** Lateral position |y| of the bridle tie points (the eye bolts), or the front beam end when the rig has none. */
export function tieHalfY(ctx: Ctx): number {
  const e = part(ctx, 'eyebolt-L');
  return e ? Math.abs(e.transform[13]) : ctx.L.beamF.len / 2;
}

/**
 * Yaw torque on the steer body about the kingpin that the steering stops must hold (M1, D-31): the larger of a one-wheel curb
 * strike (the obstacle force H_w at the wheel's lateral position y_w) and a hard rope pull on one tie point (pull × the tie's
 * lateral position, taken as the lever).
 */
export function yawTorque(ctx: Ctx, c: CaseData): { T: number; strike: number; rope: number; Hw: number; Vw: number; yw: number; yTie: number; governing: string } {
  const { p } = ctx;
  const one = strikeCases(ctx, c).find((s) => s.name === 'curb one wheel')!;
  const yw = p.frontTrackIn / 2;
  const yTie = tieHalfY(ctx);
  const strike = one.Hw * yw;
  const rope = p.pullForceLbf * yTie;
  return { T: Math.max(strike, rope), strike, rope, Hw: one.Hw, Vw: one.Vw, yw, yTie, governing: strike >= rope ? 'one-wheel curb strike' : 'rope pull at one tie' };
}

const STD_KINGPIN_IN = [0.375, 0.5, 0.625, 0.75, 0.875, 1, 1.25];

export function kingpinStrikeCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const sec = circleSection(p.axleDiameterIn);
  const ev = (c: CaseData): CaseEval => {
    const w = wheelLoads(ctx, c);
    const cases = strikeCases(ctx, c);
    const clamp = clampGeometry(ctx, 'F');
    const wheel = part(ctx, 'wheel-FL');
    const yw = wheel ? Math.abs(wheel.transform[13]) : p.frontTrackIn / 2;
    const stub = p.axleStyle === AXLE_STYLE.stubAxles;
    const aAx = Math.max(0.01, yw - (stub ? L.beamF.len / 2 : clamp.outerY));
    const hEffBeam = Math.max(0.1, L.beamF.depth - p.axleDiameterIn);
    const netX = Math.max(0.1, L.beamF.thick - kingpinBoreIn(p));
    // Evaluate every case against the kingpin criteria; the governing case is the one with the highest utilization.
    const rows = cases.map((s) => {
      const k = kingpinStress(ctx, s.H);
      const Mbeam = s.Hw * clamp.centerY;
      const sBeam = (6 * Mbeam) / (hEffBeam * netX * netX);
      const sAxle = (Math.hypot(s.Vw, s.Hw) * aAx * sec.c) / sec.I;
      return { s, k, sBeam, sAxle, util: Math.max(kingpinUtil(k, al), sBeam / al.oakBend, sAxle / al.steel) };
    });
    const g = rows.reduce((a, b) => (b.util > a.util ? b : a), rows[0]);
    const ds: Detail[] = [
      detail('kingpin shear', g.k.tau, 'psi', al.kpShear, '<='),
      detail(g.k.through ? 'kingpin bending (equal-lever, beam + crossbar)' : 'kingpin bending (cantilever over the stack)', g.k.sigma, 'psi', al.kpBend, '<='),
      ...kingpinBearingDetails(g.k, al, 'kingpin bore bearing'),
      detail('front beam fore-aft bending at the kingpin hole', g.sBeam, 'psi', al.oakBend, '<='),
      detail('front axle bending, vertical + fore-aft resultant', g.sAxle, 'psi', al.steel, '<='),
    ];
    // Smallest kingpin that passes shear, bending and bore bearing for the governing H (and the next standard size).
    const Hg = g.s.H;
    const dBend = Math.cbrt((32 * Hg * g.k.arm) / (Math.PI * al.kpBend));
    const dShear = Math.sqrt((4 * Hg) / (Math.PI * al.kpShear));
    // Bore (pin, or the sleeve OD when fitted) for the oak bearing in the shallowest member.
    const dBear = Hg / (al.oakPerp * (g.k.through ? Math.min(g.k.D1, g.k.D2) : g.k.D1));
    const dMin = Math.max(dBend, dShear, g.k.sleeve || g.k.plates ? 0 : dBear);
    const dStd = STD_KINGPIN_IN.find((x) => x >= dMin - 1e-9);
    const table = rows.map((r) => `${r.s.name}: H = ${f(r.s.H)} lbf (V_w ${f(r.s.Vw)}, tanφ ${f(r.s.tan, 2)}, φ ${f(r.s.phi * DEG, 1)}°) → kingpin σ ${f(r.k.sigma / 1000, 1)} ksi, bearing ${f(r.k.bearing, 0)} psi`).join('; ');
    const how = `Front wheel(s) strike a ${p.curbHeightIn}" curb or ${p.rootHeightIn}" root (loaded wheel radius r = ${f(ctx.d.wheelRadiusIn, 2)}"): cos φ = (r − h)/r, horizontal force H = V·tanφ on the design wheel load V = static × ${p.dynamicFactor} (${frontLoadText(ctx, w)}). ${table}. Governing: ${g.s.name}, H = ${f(g.s.H)} lbf. The kingpin and the beam are the only horizontal link between the axle and the chassis (stops and side-bearers resist only rotation), so H goes through the ${f(p.kingpinDiameterIn, 3)}" bolt: ${SHEAR_TXT(g.k)}${g.k.through ? '' : `, s = ${f(g.k.stack, 3)}"`}. Single shear: τ = ${f(g.k.tau, 0)} psi (≤ ${f(al.kpShear, 0)}), M = H·${f(g.k.arm, 3)}" = ${f(g.k.M)} lb·in, σ = ${f(g.k.sigma, 0)} psi (≤ ${f(al.kpBend, 0)} = yield ${f(p.kingpinYieldPsi, 0)} / ${p.kingpinMargin})${g.k.plates ? `; pin on the sleeve (peak, top end, R_top over one pin diameter) ${f(g.k.sleeveBrg, 0)} psi (≤ ${f(al.sleeve, 0)}), on the crossbar plate hole H/(d·t) = ${f(g.k.plateBrg, 0)} psi (≤ ${f(al.plateBrg, 0)}), crossbar end on the bolster rail ${f(g.k.endBrg, 0)} psi (≤ ${f(al.oakPerp, 0)}); the oak sees only the plate bolts (rows 'kingpin-bolts' and 'kingpin-split')` : `; oak bearing on the ${BORE_TXT(p, g.k)}: beam H/(d·depth ${f(g.k.D1, 2)}") = ${f(g.k.bearing, 0)} psi${g.k.through ? `, crossbar (depth ${f(g.k.D2, 2)}") ${f(g.k.bearingBar, 0)} psi, crossbar end on the bolster rail H/(${f(g.k.cbWidth, 2)}" × ${f(g.k.D2, 2)}") ${f(g.k.endBrg, 0)} psi` : ''} (≤ ${f(al.oakPerp, 0)}, C_M ${p.wetServiceFactorCompPerp})${g.k.sleeve ? `; pin on the steel sleeve ${f(g.k.sleeveBrg, 0)} psi (≤ 0.9·${f(p.sleeveYieldPsi, 0)}/${p.steelSafetyFactor} = ${f(al.sleeve, 0)})` : ''}`}. Beam: the wheel force enters at the clamps (y = ±${f(clamp.centerY, 2)}") and is reacted at the kingpin, fore-aft bending ${f(g.sBeam, 0)} psi on the net section ${f(hEffBeam, 2)}" × (${f(L.beamF.thick, 2)}" − ${f(kingpinBoreIn(p), 2)}" bore). Axle: ${f(g.s.Vw)} lbf vertical with ${f(g.s.Hw)} lbf fore-aft on the ${f(aAx, 2)}" cantilever: ${f(g.sAxle, 0)} psi. The turntable carries no horizontal rating (D-12), so the kingpin takes it all; the yaw torque of a one-wheel strike swings the steer body into its stop. Minimum kingpin for this H: bending d ≥ ${f(dBend, 3)}", shear ≥ ${f(dShear, 3)}", oak bore (pin or sleeve OD) ≥ ${f(dBear, 3)}"${g.k.sleeve ? ' (met by the sleeve OD, not the pin)' : ''} → ${Number.isFinite(dMin) ? `${f(dMin, 3)}"` : '?'}, i.e. ${dStd ? `${dStd}" bolt (at the same grade and arm)` : 'more than 1¼"'}; a steel sleeve, a deeper member or a stronger bolt grade also works.`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'kingpin-strike', label: 'Front obstacle strike: kingpin, beam, axle', group: 'Structure', refs: ['D-2', 'D-12', 'D-14', 'H1'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

/** One front wheel at the dynamic load, the other unloaded: bearer force and kingpin uplift from the beam's moment balance. */
function rollLoads(ctx: Ctx, c: CaseData) {
  const { p, L } = ctx;
  const w = wheelLoads(ctx, c);
  const P = w.frontWheel * p.dynamicFactor;
  const yw = p.frontTrackIn / 2;
  const sb = L.sideBearer;
  const ysb = (sb.y0 + sb.y1) / 2;
  const { Fsb, U } = rollBalance(P, yw, ysb);
  return { w, P, yw, ysb, Fsb, U, area: (sb.y1 - sb.y0) * (sb.x1 - sb.x0) };
}

const ROLL_TXT = (ctx: Ctx, r: ReturnType<typeof rollLoads>) =>
  `One front wheel carries the design load P = ${f(r.w.frontWheel)} lb static (${frontLoadText(ctx, r.w)}, heavier wheel) × ${ctx.p.dynamicFactor} = ${f(r.P)} lbf at y = ${f(r.yw, 2)}"; the other is unloaded. Moment balance of the steer body about its centerline: F_sb = P·y_w/y_sb = ${f(r.P)} × ${f(r.yw, 2)} / ${f(r.ysb, 2)}" (centroid of the bearer block) = ${f(r.Fsb)} lbf down on the bearer; vertical balance leaves ${f(r.U)} lbf of UPLIFT that the kingpin must carry in tension (D-12: the turntable is not moment-rated).`;

export function rollSideBearerCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const ev = (c: CaseData): CaseEval => {
    const r = rollLoads(ctx, c);
    const sOak = r.Fsb / r.area;
    const ds = [
      detail('bearer oak block / bolster rail bearing (⊥)', sOak, 'psi', al.oakPerp, '<='),
      detail('UHMW wear strip bearing', sOak, 'psi', al.uhmw, '<='),
    ];
    const sb = L.sideBearer;
    const how = `${ROLL_TXT(ctx, r)} Bearer face ${f(sb.y1 - sb.y0, 2)}" (across) × ${f(sb.x1 - sb.x0, 2)}" (fore-aft) = ${f(r.area, 2)} in²: ${f(r.Fsb)} / ${f(r.area, 2)} = ${f(sOak, 0)} psi against oak ⊥ ${f(al.oakPerp, 0)} psi (${p.oakCompPerpPsi} × C_M ${p.wetServiceFactorCompPerp} / ${p.woodSafetyFactor}; the bolster rail underside bears on the strip at the same stress) and UHMW ${f(al.uhmw, 0)} psi (creep-limited design value). Uniform pressure across the face is assumed; a one-wheel bump loads one side only.`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'roll-side-bearer', label: 'Bump roll: side-bearer bearing', group: 'Structure', refs: ['D-12', 'D-2', 'H2'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

export function rollKingpinUpliftCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const sec = circleSection(p.kingpinDiameterIn);
  const ev = (c: CaseData): CaseEval => {
    const r = rollLoads(ctx, c);
    // The washer is never smaller than 2.25 × the pin (kingpinWasherEffectiveIn), so a fatter pin does not starve its own washer.
    const wOd = kingpinWasherEffectiveIn(p);
    const Aw = Math.max(1e-6, (Math.PI / 4) * (wOd ** 2 - p.kingpinDiameterIn ** 2));
    const sW = r.U / Aw;
    const sT = r.U / sec.A;
    const kpPlan = ctx.L.kpPlates ? kingpinPlatePlan(p) : null;
    const plateA = kpPlan ? 4 * kpPlan.carrier.hx * kpPlan.carrier.hy : 0;
    const ds = [
      ...(kpPlan
        ? [
          detail('washer bearing on the beam plate (steel, D-35)', sW, 'psi', al.plateBrg, '<='),
          detail('beam plate pushing up on the beam underside (oak ⊥)', r.U / plateA, 'psi', al.oakPerp, '<='),
        ]
        : [detail('washer bearing on the beam underside (oak ⊥)', sW, 'psi', al.oakPerp, '<=')]),
      ...(ctx.L.crossbar ? [detail('nut washer bearing on the crossbar top (oak ⊥)', sW, 'psi', al.oakPerp, '<=')] : []),
      detail('kingpin tension', sT, 'psi', al.kpBend, '<='),
    ];
    const how = `${ROLL_TXT(ctx, r)}${kpPlan ? ` D-35: the pin head and hardened washer bear on the steel beam plate (${f(sW, 0)} psi on the plate, ≤ ${f(al.plateBrg, 0)}), and the plate's ${f(plateA, 1)} in² push up on the beam underside: ${f(r.U / plateA, 1)} psi (≤ ${f(al.oakPerp, 0)}).` : ''} The bolt head/washer under the beam pushes the beam up: a ${f(wOd, 2)}" OD washer (rule: max(${f(p.kingpinWasherDiameterIn, 2)}" param, 2.25 × the ${f(p.kingpinDiameterIn, 3)}" pin)) on a ${f(p.kingpinDiameterIn, 3)}" bolt has ${f(Aw, 2)} in², so ${f(r.U)} / ${f(Aw, 2)} = ${f(sW, 0)} psi on the oak ⊥ (≤ ${f(al.oakPerp, 0)}); bolt tension ${f(r.U)} / ${f(sec.A, 3)} = ${f(sT, 0)} psi (≤ ${f(al.kpBend, 0)}). ${ctx.L.crossbar ? 'The pin passes up through the oak crossbar and the same-size washer and nut on its top hold it down (the beam is pulled up by the washer below, the crossbar is held by the bolster fasteners).' : ''} The uplift then goes up through the nut and turntable top plate into the bolster (see 'roll-bolster-attach').`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'roll-kingpin-uplift', label: 'Bump roll: kingpin uplift and washer', group: 'Structure', refs: ['D-12', 'H2'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

export function rollBolsterAttachCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  // M7: the fasteners are the structured 'bolt' joints on the bolster fore / aft rails (to the nose deck); the params are only the fallback.
  const ringBolts = ctx.parts.filter((x) => /^bolster-(fore|aft)$/.test(x.id)).flatMap((x) => (x.joints ?? []).filter((j) => j.type === 'bolt' && j.to === 'deck-nose').map((j) => ({ x, j })));
  const fromJoints = ringBolts.length > 0;
  const n = fromJoints ? ringBolts.reduce((m, r) => m + r.j.count, 0) : Math.max(1, Math.round(p.bolsterFastenerCount));
  const dia = fromJoints ? ringBolts[0].j.diaIn ?? p.bolsterFastenerDiameterIn : p.bolsterFastenerDiameterIn;
  // Bolt radii from the kingpin (for the yaw-torque couple): joint locations are in each rail's local frame.
  const radii = ringBolts.flatMap((r) => (r.j.at ?? []).map((a) => Math.hypot(r.x.transform[12] + a[0] - L.kx, r.x.transform[13] + a[1])));
  const sumR2 = radii.reduce((m, r) => m + r * r, 0);
  const rMax = radii.length ? Math.max(...radii) : 0;
  const Ab = (Math.PI * dia * dia) / 4;
  const At = 0.75 * Ab; // threaded tensile stress area ≈ 0.75 × gross area
  const tb = Math.max(0.1, L.bolster.z1 - L.bolster.z0);
  const ev = (c: CaseData): CaseEval => {
    const r = rollLoads(ctx, c);
    const H = Math.max(...strikeCases(ctx, c).map((s) => s.H));
    const tau = H / (n * Ab);
    const sT = r.U / (n * At);
    const brg = H / (n * dia * tb);
    const inter = (tau / al.fastShear) ** 2 + (sT / al.fastTens) ** 2;
    // The stops' yaw torque T goes through the ring into these bolts as a couple: F_i = T·r_i/Σr², added to the strike shear H/n (worst alignment).
    const yaw = yawTorque(ctx, c);
    const Fyaw = sumR2 > 0 ? (yaw.T * rMax) / sumR2 : 0;
    const tauYaw = (H / n + Fyaw) / Ab;
    const ds = [
      detail('fastener shear (horizontal strike load)', tau, 'psi', al.fastShear, '<='),
      detail('fastener tension (roll uplift)', sT, 'psi', al.fastTens, '<='),
      detail('shear + tension interaction (ellipse)', Math.sqrt(inter), '', 1, '<='),
      detail('fastener bearing in the bolster oak (⊥, dowel)', brg, 'psi', al.oakDowel, '<='),
      ...(sumR2 > 0 ? [detail('fastener shear with the stop yaw torque (couple at the outermost bolt)', tauYaw, 'psi', al.fastShear, '<=')] : []),
    ];
    const how = `Fasteners read from the bolster rails' structured joints (M7): ${n} × ${f(dia, 3)}" bolts (yield ${f(p.bolsterFastenerYieldPsi, 0)} psi, A307-type) through the nose deck, the bolster rails and the turntable top plate; bolster depth ${f(tb, 2)}". Loads: the governing strike H = ${f(H)} lbf horizontally (kingpin-strike) and the roll uplift U = ${f(r.U)} lbf. Shear τ = H/(n·A) = ${f(H)}/(${n} × ${f(Ab, 4)}) = ${f(tau, 0)} psi (≤ 0.577·yield/${p.kingpinMargin} = ${f(al.fastShear, 0)}); tension σ = U/(n·A_t), A_t ≈ 0.75·A = ${f(sT, 0)} psi (≤ yield/${p.kingpinMargin} = ${f(al.fastTens, 0)}); interaction √((τ/τ_a)² + (σ/σ_a)²) = ${f(Math.sqrt(inter), 2)} (≤ 1); bearing on the bolster oak H/(n·d·t) = ${f(brg, 0)} psi (≤ ${f(al.oakDowel, 0)} = ${p.oakDowelBearingPsi} dowel bearing × C_M ${p.wetServiceFactorStrength} / ${p.woodSafetyFactor}). ${sumR2 > 0 ? ` Stop yaw torque (${yaw.governing}) T = ${f(yaw.T)} lb·in is carried by the bolts as a couple about the kingpin: bolt radii ${radii.map((r) => f(r, 2)).join('", ')}", F_max = T·r_max/Σr² = ${f(yaw.T)} × ${f(rMax, 2)} / ${f(sumR2, 1)} = ${f(Fyaw)} lbf, plus H/n = ${f(H / n)} lbf in the worst alignment: τ = ${f(tauYaw, 0)} psi (≤ ${f(al.fastShear, 0)}).` : ''} The fasteners' pull-through and the bolster's own bending are not modeled.`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'roll-bolster-attach', label: 'Bolster-to-chassis fasteners (strike shear + roll uplift)', group: 'Structure', refs: ['D-12', 'H1', 'H2'], primary: 'goal',
    ...evalBoth(ctx, ev),
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
      how: `Front axle load (${frontLoadText(ctx, w)}) × ${p.dynamicFactor} = ${f(F)} lbf vs rating ${p.turntableRatingLb} lb / margin ${p.kingpinMargin} = ${f(cap)} lbf. (The turntable is not moment-rated: roll goes through the side-bearers, D-12.)`,
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

