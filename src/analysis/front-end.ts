/**
 * Ackermann front-end structure rows (Phase 3b, D-51, D-53, D-54; spec 5.2, 5.3, 5.5): the spindle stub, the kingpin bolt, the kingpin brackets and their
 * bolts into the beam, the steel front beam, wheel retention and spindle fatigue. They are computed from `Layout.front` and the params (no part ids needed),
 * on the bump model (`bump.ts`).
 *
 * Two bases per row (D-50). NORMAL USE: the 1 inch bump at the bump speed (plus cornering where it matters), steel yield / steelSafetyFactor, bearing 0.9 Fy.
 * HARD HIT: the 2 inch hit, steel ULTIMATE / failSafeFactor (elastic stress against the ultimate: conservative against the plastic moment, so a member may bend
 * but not break) and bearing 1.5 Fu. Each row lists the details of both bases; the governing one sets the row. The `how` ends with the order of failure.
 *
 * Load path used throughout (kingpin tilt neglected, as in the kinematics): the wheel force (H aft, V up, F_lat) acts at the hub center, which sits `scrub`
 * outboard of the kingpin axis, `lead` aft of it and `spindleBossAboveStubIn` below the boss center. The boss thrust faces react V up to
 * `spindleBossRadiusIn` off the axis; the rest of the lever, and the height offset of H, load the kingpin bolt as a couple on the two bracket leaves.
 */
import { circleSection } from './beams';
import type { Ctx } from './context';
import { dualCheck, detail, governing, type CaseEval } from './dual';
import { f } from './format';
import type { CaseData } from './loads';
import { evalBoth } from './stability';
import { bumpCases, bumpText, goodmanPulsating, peakVertical, sensitivityText, staticWheelLb, type BumpStrike } from './bump';
import { uncTensileArea } from './brake-mount';
import { innerHalfWidth } from '../model/layout';
import type { AnalysisCheck, Detail } from './types';

const REFS = ['D-50', 'D-53', 'D-54'];

/** Stub diameter (in) from the spindle option: 17 mm or 25 mm. */
export const stubDiameterIn = (ctx: Ctx): number => (ctx.p.spindleStub === 0 ? 17 : 25) / 25.4;

/** Steel allowables on the two bases (spec 5.2). */
export function steelBases(ctx: Ctx) {
  const { p } = ctx;
  const sf = p.steelSafetyFactor, ff = p.failSafeFactor;
  return {
    sf, ff,
    /** bending allowable: yield / SF (normal) and ultimate / ff (hard) for a material with the given yield and ultimate. */
    bendN: (fy: number) => fy / sf,
    bendH: (fu: number) => fu / ff,
    shearN: (fy: number) => (0.577 * fy) / sf,
    shearH: (fu: number) => (0.6 * fu) / ff,
    brgN: (fy: number) => (0.9 * fy) / sf,
    brgH: (fu: number) => (1.5 * fu) / ff,
  };
}

export interface FrontHit {
  b: BumpStrike;
  H: number;
  /** Bump V plus the static wheel load still on the tire. */
  Vt: number;
  P: number;
  /** Resultant of H and Vt in the fore-aft / vertical plane. */
  R: number;
  /** Rut-wall lateral force 0.8 V (spec 5.2). */
  Flat: number;
}

/** The struck front wheel (the heavier one) in a load case. */
export function frontHit(ctx: Ctx, c: CaseData, kind: 'normal' | 'hard'): FrontHit {
  const { p } = ctx;
  const cs = bumpCases(ctx, c, 'front');
  const b = kind === 'normal' ? cs.normal : cs.hard;
  const Vt = peakVertical(b);
  return { b, H: b.H, Vt, P: b.staticLb, R: Math.hypot(b.H, Vt), Flat: p.rutWallLateralFrac * b.V };
}

/** Lever from the stub root (boss face) to the hub center: scrub minus the boss thrust radius. */
export const stubArmIn = (ctx: Ctx): number => Math.max(0.25, ctx.L.front.ack.scrub - ctx.p.spindleBossRadiusIn);

// ── spindle stub ─────────────────────────────────────────────────────────────────────────────────────────────

export function spindleStubCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const m = steelBases(ctx);
  const d = stubDiameterIn(ctx);
  const sec = circleSection(d);
  const a = stubArmIn(ctx);
  const ev = (c: CaseData): CaseEval => {
    const n = frontHit(ctx, c, 'normal'), h = frontHit(ctx, c, 'hard');
    const Mn = a * n.R, Mh = a * h.R;
    const skid = p.tireGroundMu * n.P;
    const Msk = n.P * a + skid * ctx.d.wheelRadiusIn;
    const ds: Detail[] = [
      detail('NORMAL 1" bump: stub bending (yield / SF)', Mn / sec.S, 'psi', m.bendN(p.spindleYieldPsi), '<='),
      detail('NORMAL 1" bump: stub shear (0.577 yield / SF)', (4 / 3) * n.R / sec.A, 'psi', m.shearN(p.spindleYieldPsi), '<='),
      detail('NORMAL cornering skid (mu P at the contact patch): stub bending', Msk / sec.S, 'psi', m.bendN(p.spindleYieldPsi), '<='),
      detail('HARD 2" hit: stub bending (ultimate / fail-safe factor)', Mh / sec.S, 'psi', m.bendH(p.spindleUltimatePsi), '<='),
      detail('HARD 2" hit: stub shear (0.6 ultimate / fail-safe factor)', (4 / 3) * h.R / sec.A, 'psi', m.shearH(p.spindleUltimatePsi), '<='),
    ];
    const how = `${bumpText(n.b, 'Normal front hit', p)}; with the static wheel load still on the tire V_total = ${f(n.Vt)} lbf, resultant ${f(n.R)} lbf. ${bumpText(h.b, 'Hard front hit', p)}; V_total = ${f(h.Vt)}, resultant ${f(h.R)} lbf. `
      + `Stub ${f(d * 25.4, 0)} mm (${f(d, 3)}", S = ${f(sec.S, 4)} in3, A = ${f(sec.A, 3)} in2), root at the boss face: lever a = scrub ${f(ctx.L.front.ack.scrub, 2)}" - boss radius ${f(p.spindleBossRadiusIn, 2)}" = ${f(a, 2)}" to the hub center. `
      + `M = R a = ${f(Mn, 0)} lb.in (normal), ${f(Mh, 0)} lb.in (hard); sigma = M / S = ${f(Mn / sec.S, 0)} psi vs ${f(m.bendN(p.spindleYieldPsi), 0)} (yield ${f(p.spindleYieldPsi, 0)} / ${m.sf}); hard ${f(Mh / sec.S, 0)} psi vs ${f(m.bendH(p.spindleUltimatePsi), 0)} (ultimate ${f(p.spindleUltimatePsi, 0)} / ${m.ff}). `
      + `Cornering skid mu P = ${p.tireGroundMu} x ${f(n.P)} = ${f(skid)} lbf at r = ${f(ctx.d.wheelRadiusIn, 1)}": M = P a + mu P r = ${f(Msk, 0)} lb.in. `
      + `${sensitivityText(ctx, c, 'front', p.bumpNormalHeightIn)} Spindle strengths are assumed (verify with the maker, D-53).`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'spindle-stub', label: `Spindle stub bending (${f(stubDiameterIn(ctx) * 25.4, 0)} mm)`, group: 'Structure', refs: REFS, primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── kingpin bolt and leaves ──────────────────────────────────────────────────────────────────────────────────

export interface KingpinLoad {
  /** Resultant leaf reaction (the more loaded leaf), lbf. */
  Rleaf: number;
  Rx: number;
  Ry: number;
  /** Bolt bending moment at the boss center (lb.in), double-shear plane shear force (lbf). */
  Mbolt: number;
  /** Moment of the wheel force about the kingpin axis (lb.in): reacted by the tie rod. */
  Mz: number;
  /** Half spacing of the leaf load planes (in), and the bolt bearing length in the boss. */
  s: number;
}

export interface KpForce { H: number; Fy: number; V: number; /** Height of F_y below the hub center (in); 0 at the hub. */ fyBelow?: number }

/**
 * Statics of the knuckle on the kingpin bolt. M_x = (scrub - R_b) V + (z + fyBelow) F_y, M_y = z H + max(0, lead - R_b) V with z = boss height above the stub axis;
 * the couples are reacted by the two leaf planes (spacing 2 s), the direct forces H, F_y split between them. M_z = scrub H + lead F_y goes to the tie rod.
 */
export function kingpinLoad(ctx: Ctx, F: KpForce): KingpinLoad {
  const { p } = ctx;
  const ack = ctx.L.front.ack;
  const s = (p.kingpinBracketGapIn + p.kingpinBracketThickIn) / 2;
  const z = p.spindleBossAboveStubIn, Rb = p.spindleBossRadiusIn;
  const Mx = Math.max(0, ack.scrub - Rb) * F.V + (z + (F.fyBelow ?? 0)) * Math.abs(F.Fy);
  const My = z * F.H + Math.max(0, ack.lead - Rb) * F.V;
  const Rx = F.H / 2 + My / (2 * s);
  const Ry = Math.abs(F.Fy) / 2 + Mx / (2 * s);
  const R = Math.hypot(Rx, Ry);
  const Lb = p.spindleBossLengthIn;
  return { Rleaf: R, Rx, Ry, Mbolt: R * Math.max(0, s - Lb / 4), Mz: ack.scrub * F.H + ack.lead * Math.abs(F.Fy), s };
}

export function kingpinBoltCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const m = steelBases(ctx);
  const dk = p.kingpinDiameterIn;
  const sec = circleSection(dk);
  const t = p.kingpinBracketThickIn;
  const ev = (c: CaseData): CaseEval => {
    const n = frontHit(ctx, c, 'normal'), h = frontHit(ctx, c, 'hard');
    const kn = kingpinLoad(ctx, { H: n.H, Fy: 0, V: n.Vt });
    const kh = kingpinLoad(ctx, { H: h.H, Fy: 0, V: h.Vt });
    const sk = kingpinLoad(ctx, { H: 0, Fy: p.tireGroundMu * n.P, V: n.P, fyBelow: ctx.d.wheelRadiusIn });
    const Lb = p.spindleBossLengthIn;
    const ds: Detail[] = [
      detail('NORMAL 1" bump: kingpin bolt shear (leaf plane, 0.577 Fy / SF)', kn.Rleaf / sec.A, 'psi', m.shearN(p.kingpinYieldPsi), '<='),
      detail('NORMAL 1" bump: kingpin bolt bending (Fy / SF)', (kn.Mbolt * sec.c) / sec.I, 'psi', m.bendN(p.kingpinYieldPsi), '<='),
      detail('NORMAL 1" bump: bearing on the bracket leaf (0.9 Fy / SF)', kn.Rleaf / (dk * t), 'psi', m.brgN(p.bracketSteelYieldPsi), '<='),
      detail('NORMAL 1" bump: bearing in the spindle boss (0.9 Fy / SF)', (2 * kn.Rleaf) / (dk * Lb), 'psi', m.brgN(p.spindleYieldPsi), '<='),
      detail('NORMAL cornering skid: kingpin bolt bending', (sk.Mbolt * sec.c) / sec.I, 'psi', m.bendN(p.kingpinYieldPsi), '<='),
      detail('HARD 2" hit: kingpin bolt shear (0.6 Fu / ff)', kh.Rleaf / sec.A, 'psi', m.shearH(p.kingpinUltimatePsi), '<='),
      detail('HARD 2" hit: kingpin bolt bending (Fu / ff)', (kh.Mbolt * sec.c) / sec.I, 'psi', m.bendH(p.kingpinUltimatePsi), '<='),
      detail('HARD 2" hit: bearing on the bracket leaf (1.5 Fu / ff)', kh.Rleaf / (dk * t), 'psi', m.brgH(p.bracketSteelUltimatePsi), '<='),
    ];
    const how = `Front hit at the hub center ${f(ctx.L.front.ack.scrub, 2)}" outboard of the kingpin axis, ${f(ctx.L.front.ack.lead, 2)}" aft, ${f(p.spindleBossAboveStubIn, 2)}" below the boss center. Normal: H = ${f(n.H)}, V_total = ${f(n.Vt)} lbf; hard: H = ${f(h.H)}, V_total = ${f(h.Vt)} lbf. `
      + `The boss thrust faces (radius ${f(p.spindleBossRadiusIn, 2)}") take V on the axis; the lever left over, (scrub - R_b) V = ${f((ctx.L.front.ack.scrub - p.spindleBossRadiusIn) * n.Vt, 0)} lb.in normal and the height offset z H, load the bolt as a couple on two leaf planes ${f(2 * kn.s, 2)}" apart. `
      + `Leaf reaction ${f(kn.Rleaf)} lbf normal (${f(kn.Rx)} fore-aft, ${f(kn.Ry)} lateral), ${f(kh.Rleaf)} lbf hard. Bolt ${f(dk, 3)}" grade 8 (S = ${f(sec.S, 5)} in3): bending at the boss center M = R (s - L_b/4) = ${f(kn.Mbolt, 0)} lb.in normal, ${f(kh.Mbolt, 0)} hard. `
      + `Moment about the kingpin axis (to the tie rod) M_z = scrub H + lead F_y = ${f(kn.Mz, 0)} lb.in normal, ${f(kh.Mz, 0)} hard. Kingpin tilt neglected. `
      + `Order of failure at the hard hit (util): bolt bending ${f((kh.Mbolt * sec.c) / sec.I / m.bendH(p.kingpinUltimatePsi), 2)}, shear ${f(kh.Rleaf / sec.A / m.shearH(p.kingpinUltimatePsi), 2)}, leaf bearing ${f(kh.Rleaf / (dk * t) / m.brgH(p.bracketSteelUltimatePsi), 2)}. ${sensitivityText(ctx, c, 'front', p.bumpNormalHeightIn)}`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'kingpin-bolt', label: `Kingpin bolt (${f(dk, 3)}" grade 8, double shear)`, group: 'Structure', refs: REFS, primary: 'goal', ...evalBoth(ctx, ev) });
}

/** Cantilever length of the bracket leaf: kingpin axis to the outer face of the web (in). */
export function leafArmIn(ctx: Ctx): number {
  const b = ctx.L.front.bracket.L;
  return Math.max(0.25, Math.abs(b.pivot[1]) - Math.max(Math.abs(b.web.y0), Math.abs(b.web.y1)));
}

export function kingpinBracketCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const m = steelBases(ctx);
  const fl = ctx.L.front;
  const t = p.kingpinBracketThickIn;
  const w = 2 * p.kingpinBracketLeafRadiusIn;
  const arm = leafArmIn(ctx);
  const bolts = fl.bracket.L.bolts;
  const nb = bolts.length;
  const bd = p.kingpinBracketBoltDiaIn;
  const At = uncTensileArea(bd);
  const leverZ = ctx.L.front.beam.depth * 0.75; // bolt row to the compression edge of the end face
  const wheelY = fl.ack.kpHalf + fl.ack.scrub;
  const beamEndY = fl.beam.len / 2;
  const armWheel = wheelY - beamEndY;
  const wall = p.frontBeamWallIn;
  const ev = (c: CaseData): CaseEval => {
    const n = frontHit(ctx, c, 'normal'), h = frontHit(ctx, c, 'hard');
    const kn = kingpinLoad(ctx, { H: n.H, Fy: 0, V: n.Vt });
    const kh = kingpinLoad(ctx, { H: h.H, Fy: 0, V: h.Vt });
    const Sout = (w * t * t) / 6, Sin = (t * w * w) / 6;
    const leafN = (k: KingpinLoad, F: FrontHit) => ({ out: (F.Vt * arm) / Sout, inp: (k.Rx * arm) / Sin });
    const ln = leafN(kn, n), lh = leafN(kh, h);
    // Web bolts: tension on the top row from the overturning moment V_t x (wheel - beam end), shear from the resultant.
    const boltCase = (F: FrontHit) => {
      const M = F.Vt * armWheel;
      const T = M / (leverZ * (nb / 2));
      const Vs = F.R / nb;
      return { T, Vs };
    };
    const bn = boltCase(n), bh = boltCase(h);
    const wallBrgN = bn.Vs / (2 * bd * wall), wallBrgH = bh.Vs / (2 * bd * wall);
    const interaction = (b: { T: number; Vs: number }, tAllow: number, vAllow: number) => Math.hypot(b.T / (At * tAllow), b.Vs / (At * vAllow));
    const tN = m.bendN(p.kingpinYieldPsi), vN = m.shearN(p.kingpinYieldPsi);
    const tH = m.bendH(p.kingpinUltimatePsi), vH = m.shearH(p.kingpinUltimatePsi);
    const ds: Detail[] = [
      detail('NORMAL 1" bump: leaf bending out of plane at the web (yield / SF)', ln.out, 'psi', m.bendN(p.bracketSteelYieldPsi), '<='),
      detail('NORMAL 1" bump: leaf bending in plane (fore-aft reaction)', ln.inp, 'psi', m.bendN(p.bracketSteelYieldPsi), '<='),
      detail('NORMAL 1" bump: web bolts, tension + shear interaction', interaction(bn, tN, vN), '', 1, '<='),
      detail('NORMAL 1" bump: bolt bearing on the beam wall (0.9 Fy / SF, crush sleeve)', wallBrgN, 'psi', m.brgN(p.frontBeamYieldPsi), '<='),
      detail('HARD 2" hit: leaf bending out of plane (ultimate / ff)', lh.out, 'psi', m.bendH(p.bracketSteelUltimatePsi), '<='),
      detail('HARD 2" hit: leaf bending in plane', lh.inp, 'psi', m.bendH(p.bracketSteelUltimatePsi), '<='),
      detail('HARD 2" hit: web bolts, tension + shear interaction', interaction(bh, tH, vH), '', 1, '<='),
      detail('HARD 2" hit: bolt bearing on the beam wall (1.5 Fu / ff)', wallBrgH, 'psi', m.brgH(p.frontBeamUltimatePsi), '<='),
    ];
    const how = `Leaf: ${f(t, 4)}" A36 x ${f(w, 2)}" wide, cantilever ${f(arm, 2)}" from the kingpin axis to the web; the upward wheel force V_total (${f(n.Vt)} lbf normal, ${f(h.Vt)} hard) is thrust through the upper leaf: sigma = V arm / (w t2 / 6) = ${f(ln.out, 0)} psi normal, ${f(lh.out, 0)} hard; fore-aft leaf reaction ${f(kn.Rx)} / ${f(kh.Rx)} lbf in plane. `
      + `Web bolts: ${nb} x ${f(bd, 4)}" grade 8 (A_t ${f(At, 4)} in2) through the beam end face with crush sleeves; overturning moment V_total x ${f(armWheel, 2)}" (wheel plane to the beam end) = ${f(n.Vt * armWheel, 0)} lb.in normal, reacted by the top row (${f(leverZ, 2)}" from the compression edge): T = ${f(bn.T)} lbf each, shear ${f(bn.Vs)} lbf each; hard T = ${f(bh.T)}, shear ${f(bh.Vs)} lbf. Interaction sqrt((T/Ft)2 + (V/Fv)2): ${f(interaction(bn, tN, vN), 2)} normal, ${f(interaction(bh, tH, vH), 2)} hard. `
      + `Bearing of the bolt on the ${f(wall, 3)}" tube wall (two walls, sleeve): ${f(wallBrgN, 0)} psi normal, ${f(wallBrgH, 0)} hard. ${sensitivityText(ctx, c, 'front', p.bumpNormalHeightIn)}`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'kingpin-bracket', label: 'Kingpin brackets and their bolts into the beam', group: 'Structure', refs: REFS, primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── steel front beam ─────────────────────────────────────────────────────────────────────────────────────────

/** y of the rail seat (the nose rail center under the chine) at the beam, and the cantilever lever from there to the hub (in). */
export function beamLevers(ctx: Ctx): { railY: number; wheelY: number; arm: number } {
  const fl = ctx.L.front;
  const railY = innerHalfWidth(ctx.L, fl.beam.x) + ctx.L.side / 2;
  const wheelY = fl.ack.kpHalf + fl.ack.scrub;
  return { railY, wheelY, arm: Math.max(0.5, wheelY - railY) };
}

export function frontBeamCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const m = steelBases(ctx);
  const bm = ctx.L.front.beam;
  const wd = p.frontBeamWidthIn, dp = p.frontBeamDepthIn, wl = p.frontBeamWallIn;
  const I = (wd * dp ** 3 - (wd - 2 * wl) * (dp - 2 * wl) ** 3) / 12;
  const S = I / (dp / 2);
  const Am = (wd - wl) * (dp - wl);
  const lv = beamLevers(ctx);
  const xOff = Math.abs(ctx.L.front.stub.L[0] - bm.x);
  const ev = (c: CaseData): CaseEval => {
    const n = frontHit(ctx, c, 'normal'), h = frontHit(ctx, c, 'hard');
    const one = (F: FrontHit) => {
      const M = F.R * lv.arm;
      const T = F.Vt * xOff;
      const sig = M / S, tau = T / (2 * Am * wl);
      const V = F.R;
      const tauV = V / (2 * dp * wl);
      return { M, T, sig, tau, vm: Math.sqrt(sig * sig + 3 * (tau + tauV) ** 2), tauV };
    };
    const rn = one(n), rh = one(h);
    const ds: Detail[] = [
      detail('NORMAL 1" bump: tube bending + torsion (von Mises, yield / SF)', rn.vm, 'psi', m.bendN(p.frontBeamYieldPsi), '<='),
      detail('HARD 2" hit: tube bending + torsion (von Mises, ultimate / ff)', rh.vm, 'psi', m.bendH(p.frontBeamUltimatePsi), '<='),
    ];
    const how = `Steel tube ${f(wd, 2)}" x ${f(dp, 2)}" x ${f(wl, 3)}" A500 (I = ${f(I, 4)} in4, S = ${f(S, 4)} in3), ${f(bm.len)}" long, seated in the nose rails at |y| = ${f(lv.railY, 2)}" and carrying the bracket at the ends. `
      + `The wheel force acts at the hub plane |y| = ${f(lv.wheelY, 2)}", a cantilever of ${f(lv.arm, 2)}" from the rail seat: M = R x arm = ${f(n.R, 0)} x ${f(lv.arm, 2)} = ${f(rn.M, 0)} lb.in normal (${f(rh.M, 0)} hard), sigma = ${f(rn.sig, 0)} / ${f(rh.sig, 0)} psi; torsion V_total x ${f(xOff, 2)}" (hub behind the beam center) = ${f(rn.T, 0)} lb.in, shear ${f(rn.tau + rn.tauV, 0)} psi; von Mises ${f(rn.vm, 0)} (allow ${f(m.bendN(p.frontBeamYieldPsi), 0)} = ${f(p.frontBeamYieldPsi, 0)} / ${m.sf}) normal and ${f(rh.vm, 0)} (allow ${f(m.bendH(p.frontBeamUltimatePsi), 0)} = ${f(p.frontBeamUltimatePsi, 0)} / ${m.ff}) hard. `
      + `The beam is the intended ductile fuse at the hard hit: it bends before the bolts, stub or retention fail. Rail seat bearing and hold-downs follow front-mount.ts (WS-A) when it lands. ${sensitivityText(ctx, c, 'front', p.bumpNormalHeightIn)}`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'beam-front', label: 'Front axle beam (steel tube)', group: 'Structure', refs: REFS, primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── wheel retention (hard hit: never release a wheel) ────────────────────────────────────────────────────────

export function wheelRetentionCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const m = steelBases(ctx);
  const dStub = stubDiameterIn(ctx);
  const dT = dStub * p.stubThreadFrac;
  const aCotter = 2 * (Math.PI / 4) * p.wheelCotterDiaIn ** 2; // double shear
  const aThread = Math.PI * dT * p.wheelNutEngagementIn * 0.5; // thread shear area, 0.5 pi d L_e
  const secStub = circleSection(dStub);
  const a = stubArmIn(ctx);
  const r = ctx.d.wheelRadiusIn;
  const ev = (c: CaseData): CaseEval => {
    const out = (wheel: 'front' | 'rear') => {
      const cs = bumpCases(ctx, c, wheel);
      const b = cs.hard;
      const Fl = p.rutWallLateralFrac * b.V;
      const Vt = peakVertical(b);
      const Mroot = Fl * r + Math.hypot(b.H, Vt) * a;
      return { b, Fl, Mroot };
    };
    const fr = out('front');
    const capCotter = aCotter * m.shearH(p.wheelCotterUltimatePsi);
    const capThread = aThread * m.shearH(p.spindleUltimatePsi);
    const capTens = 0.75 * (Math.PI / 4) * dT * dT * m.bendH(p.spindleUltimatePsi);
    const ds: Detail[] = [
      detail('HARD 2" hit: lateral hit F_lat on the castle nut threads (thread shear, 0.6 Fu / ff)', fr.Fl, 'lbf', capThread, '<='),
      detail('HARD 2" hit: lateral hit on the stub-end thread (tension, Fu / ff)', fr.Fl, 'lbf', capTens, '<='),
      detail('HARD 2" hit: stub bending with F_lat r + R a (ultimate / ff)', fr.Mroot / secStub.S, 'psi', m.bendH(p.spindleUltimatePsi), '<='),
    ];
    const how = `Hard front hit ${f(fr.b.Fn)} lbf (H ${f(fr.b.H)}, V ${f(fr.b.V)}); the rut wall adds a lateral hit F_lat = ${p.rutWallLateralFrac} V = ${f(fr.Fl)} lbf along the stub axis (it tries to pull the wheel off). `
      + `The load path is the castle-nut thread, not the cotter: the ${f(p.wheelCotterDiaIn, 4)}" cotter in double shear (${f(capCotter)} lbf) only locks the nut and is a backup if it backs off. Castle-nut thread (${f(dT, 3)}" x ${f(p.wheelNutEngagementIn, 3)}" engaged): ${f(capThread)} lbf; stub-end thread tension: ${f(capTens)} lbf. Stub bending with F_lat at the contact radius ${f(r, 1)}" plus the bump moment: ${f(fr.Mroot / secStub.S, 0)} psi vs ${f(m.bendH(p.spindleUltimatePsi), 0)}. `
      + `The rim, tire or hub bearing may be bent or flattened (accepted, D-50); the stub, nut and cotter must hold. Hub bearing and axial rating of the purchased wheel are not modeled (vendor).`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'wheel-retention', label: 'Wheel retention (hard hit: the wheel stays on the stub)', group: 'Structure', refs: REFS, primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── fatigue at normal riding (spec 5.3) ──────────────────────────────────────────────────────────────────────

export function spindleFatigueCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const dStub = stubDiameterIn(ctx);
  const sec = circleSection(dStub);
  const a = stubArmIn(ctx);
  const Se = p.spindleEnduranceLimitPsi, Sut = p.spindleUltimatePsi;
  const secK = circleSection(p.kingpinDiameterIn);
  const sArm = (p.steerArmThickIn * p.steerArmWidthIn ** 2) / 6;
  const ev = (c: CaseData): CaseEval => {
    const P = staticWheelLb(ctx, c, 'front');
    const Pf = P * p.fatigueLoadFactor;
    const sigStub = (Pf * a) / sec.S;
    const nStub = goodmanPulsating(sigStub, Se, Sut);
    const kl = kingpinLoad(ctx, { H: 0, Fy: 0, V: Pf });
    const sigK = (kl.Mbolt * secK.c) / secK.I;
    const nK = goodmanPulsating(sigK, Se, p.kingpinUltimatePsi);
    const Mz = ctx.L.front.ack.scrub * p.tireGroundMu * P;
    const sigArm = Mz / sArm;
    const nArm = goodmanPulsating(sigArm, Se, Sut);
    const ds: Detail[] = [
      detail('stub bending, Goodman factor (pulsating, R = 0)', nStub, '', p.fatigueSafetyMin, '>='),
      detail('kingpin bolt bending, Goodman factor', nK, '', p.fatigueSafetyMin, '>='),
      detail('steering arm bending (brake-steer mu P at the scrub arm), Goodman factor', nArm, '', p.fatigueSafetyMin, '>='),
    ];
    const how = `Normal riding: static front wheel ${f(P)} lb x fatigue load factor ${p.fatigueLoadFactor} = ${f(Pf)} lbf, applied at the hub center ${f(a, 2)}" from the stub root; the stub is fixed and the wheel rotates, so the stress is pulsating (R = 0): sigma_max = M / S = ${f(sigStub, 0)} psi, sigma_a = sigma_m = ${f(sigStub / 2, 0)}; n = 1 / (sigma_a / Se + sigma_m / Sut) = 1 / (${f(sigStub / 2, 0)} / ${f(Se, 0)} + ${f(sigStub / 2, 0)} / ${f(Sut, 0)}) = ${f(nStub, 2)} (limit ${p.fatigueSafetyMin}). `
      + `Kingpin bolt (same load through the boss): ${f(sigK, 0)} psi, n = ${f(nK, 2)}. Steering arm (${f(p.steerArmThickIn, 3)}" x ${f(p.steerArmWidthIn, 2)}"): brake-steer mu P x scrub = ${f(Mz, 0)} lb.in, ${f(sigArm, 0)} psi, n = ${f(nArm, 2)}. Endurance limit ${f(Se, 0)} psi is a Marin-derated assumption (verify).`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'spindle-fatigue', label: 'Spindle fatigue at normal riding (Goodman)', group: 'Structure', refs: ['D-54', 'D-53'], primary: 'goal', ...evalBoth(ctx, ev) });
}

export function frontEndChecks(ctx: Ctx): AnalysisCheck[] {
  return [spindleStubCheck(ctx), kingpinBoltCheck(ctx), kingpinBracketCheck(ctx), frontBeamCheck(ctx), wheelRetentionCheck(ctx), spindleFatigueCheck(ctx)];
}
