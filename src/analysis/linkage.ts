/**
 * Steering linkage and tongue rows for the Ackermann front end (Phase 3b, D-51, D-53, D-54; spec 2.3, 5.5): tie rod, drag link, bellcrank, steer stops,
 * tongue (hinge, link pin), tongue tie (the bridle eye bolt moved to the tongue tip) and the ride stick with its cables. Computed from `Layout.front` and
 * the params, on the bump model for the kickback and on the 150 lbf bridle pull for the tongue.
 *
 * Kickback path. A front hit puts the moment M_z = scrub H (+ lead F_lat for a sideways hit) on the struck knuckle about its kingpin. The steering arm turns
 * it into a tie-rod force F = M_z / (A cos g) (A cos g = the arm's fore-aft projection, 2.74" at the defaults), the other knuckle is free, so the whole force
 * goes through the rod center, the drag link and the bellcrank (1:1) to whatever holds the bellcrank: the tongue link (tow), the stick cables (ride, until the
 * narrow window plate stops the bellcrank) or the stops. Normal rows use the 1 inch bump, hard rows the 2 inch hit at ultimate / failSafeFactor.
 */
import { rectSection, bendingStress } from './beams';
import type { Ctx } from './context';
import { dualCheck, detail, governing, type CaseEval } from './dual';
import { f } from './format';
import type { CaseData } from './loads';
import { evalBoth } from './stability';
import { allowables } from './structure';
import { frontHit, kingpinLoad, steelBases, type FrontHit } from './front-end';
import { sensitivityText } from './bump';
import { uncTensileArea } from './brake-mount';
import type { AnalysisCheck, Detail } from './types';

const REFS = ['D-50', 'D-53', 'D-54'];

/** Fore-aft projection of the steering arm: the lever of the tie-rod force about the kingpin (in). */
export const armLeverIn = (ctx: Ctx): number => ctx.L.front.ack.armLen * Math.cos((ctx.L.front.ack.armAngleDeg * Math.PI) / 180);

export interface Kick { Mz: number; Frod: number; fromLateral: boolean }

/** Tie-rod force from a front hit: the larger of the aft hit (scrub H) and the rut-wall sideways hit (lead F_lat). */
export function kickback(ctx: Ctx, F: FrontHit): Kick {
  const a = kingpinLoad(ctx, { H: F.H, Fy: 0, V: F.Vt }).Mz;
  const l = ctx.L.front.ack.lead * F.Flat;
  const Mz = Math.max(a, l);
  return { Mz, Frod: Mz / armLeverIn(ctx), fromLateral: l > a };
}

export interface Leverage {
  /** Perpendicular distance from the bellcrank pivot to the drag-link line / the tongue-link line (in). */
  out: number;
  inn: number;
  /** Perpendicular distance from the tongue hinge to the tongue-link line (in). */
  ear: number;
  /** Cable cross-bar half length on the bellcrank (the ride window and the cables act here). */
  cable: number;
  /** |cos| of the angle between the drag link and the tie-rod axis (the rod center force is along y): F_drag = F_rod / dragCos. */
  dragCos: number;
}

const cross2 = (a: [number, number], b: [number, number]) => a[0] * b[1] - a[1] * b[0];

/**
 * Lever arms of the re-laid center linkage (WS-A, Stage 1) at the NEUTRAL pose, read from `Layout.front`: the drag link runs across the car from the output pin to the
 * tie-rod center; the tongue link runs from the input pin to the tongue ear. Forces move through the bellcrank by moment balance, F_drag leverOut = F_tonguelink leverIn.
 */
export function leverage(ctx: Ctx): Leverage {
  const fl = ctx.L.front;
  const piv = fl.bellcrank.pivot as [number, number];
  const outPin = fl.bellcrank.outPin as [number, number], inPin = fl.bellcrank.inPin as [number, number];
  const mid: [number, number] = [fl.tieRod.x, 0];
  const ear = fl.tongue.linkPin as [number, number], hinge = fl.tongue.hinge as [number, number];
  const unit = (a: [number, number], b: [number, number]): [number, number] => { const d = [b[0] - a[0], b[1] - a[1]]; const n = Math.hypot(d[0], d[1]) || 1; return [d[0] / n, d[1] / n]; };
  const ud = unit(outPin, mid), ut = unit(inPin, ear);
  const rel = (a: [number, number], o: [number, number]): [number, number] => [a[0] - o[0], a[1] - o[1]];
  return {
    out: Math.max(0.25, Math.abs(cross2(rel(outPin, piv), ud))),
    inn: Math.max(0.25, Math.abs(cross2(rel(inPin, piv), ut))),
    ear: Math.max(0.25, Math.abs(cross2(rel(ear, hinge), ut))),
    cable: fl.ack.bellCableArm ?? fl.ack.bellArm,
    dragCos: Math.max(0.3, Math.abs(ud[1])),
  };
}

/** Euler buckling load of a round rod, pinned ends (K = 1): pi2 E I / L2. */
export const eulerLoad = (E: number, d: number, L: number): number => (Math.PI ** 2 * E * (Math.PI * d ** 4) / 64) / (L * L);

/**
 * Sideways tongue pull: lateral component of the design pull at the tongue tip, the hinge moment, the force in the tongue link, the bellcrank moment, the
 * drag-link force and the tie-rod force it makes (lbf). The wheels are taken as held, so the rod splits it between the two knuckles.
 */
export function tongueSidePull(ctx: Ctx): { Fperp: number; Mh: number; Flink: number; Fax: number; Mb: number; Fdrag: number; Frod: number } {
  const { p } = ctx;
  const lv = leverage(ctx);
  const Fperp = p.pullForceLbf * Math.SQRT1_2, Fax = p.pullForceLbf * Math.SQRT1_2;
  const Mh = Fperp * p.tongueLengthIn;
  const Flink = Mh / lv.ear;
  const Mb = Flink * lv.inn;
  const Fdrag = Mb / lv.out;
  return { Fperp, Fax, Mh, Flink, Mb, Fdrag, Frod: Fdrag * lv.dragCos };
}

// ── force chain from a front hit ────────────────────────────────────────────────────────────────────────────

export interface Chain {
  Mz: number;
  Frod: number;
  /** Force in the drag link, moment on the bellcrank, force at the cable cross-bar / window, force in the tongue link. */
  Fdrag: number;
  Mb: number;
  Fcable: number;
  Ftl: number;
  fromLateral: boolean;
}

/** Tie rod -> drag link -> bellcrank -> (window / cables / tongue link) for a front hit, by moment balance on the neutral lever arms. */
export function chain(ctx: Ctx, F: FrontHit): Chain {
  const lv = leverage(ctx);
  const k = kickback(ctx, F);
  const Fdrag = k.Frod / lv.dragCos;
  const Mb = Fdrag * lv.out;
  return { Mz: k.Mz, Frod: k.Frod, Fdrag, Mb, Fcable: Mb / lv.cable, Ftl: Mb / lv.inn, fromLateral: k.fromLateral };
}

const levText = (lv: Leverage) => `lever arms from the re-laid linkage: drag link ${f(lv.out, 2)}" and tongue link ${f(lv.inn, 2)}" about the bellcrank pivot, cable cross-bar ${f(lv.cable, 2)}", tongue link ${f(lv.ear, 2)}" about the hinge, drag link at ${f((Math.acos(lv.dragCos) * 180) / Math.PI, 0)} deg to the rod axis`;

// ── tie rod ─────────────────────────────────────────────────────────────────────────────────────────────────

export function tieRodCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const m = steelBases(ctx);
  const d = p.tieRodDiaIn;
  const At = uncTensileArea(d);
  const L = ctx.L.front.tieRod.len;
  const Pcr = eulerLoad(p.steelMoePsi, d, L);
  const sArm = (p.steerArmThickIn * p.steerArmWidthIn ** 2) / 6;
  const side = tongueSidePull(ctx);
  const lv = leverage(ctx);
  const ev = (c: CaseData): CaseEval => {
    const n = kickback(ctx, frontHit(ctx, c, 'normal')), h = kickback(ctx, frontHit(ctx, c, 'hard'));
    const halfSide = side.Frod / 2;
    const ds: Detail[] = [
      detail('NORMAL 1" bump: rod tension (yield / SF, thread area)', n.Frod, 'lbf', At * m.bendN(p.linkRodYieldPsi), '<='),
      detail('NORMAL 1" bump: Euler buckling, pinned ends (P_cr / SF)', n.Frod, 'lbf', Pcr / m.sf, '<='),
      detail('NORMAL sideways tongue pull: half the rod force in compression vs Euler (P_cr / SF)', halfSide, 'lbf', Pcr / m.sf, '<='),
      detail('NORMAL 1" bump: rod end static rating / SF', n.Frod, 'lbf', p.rodEndRatingLbf / m.sf, '<='),
      detail('NORMAL 1" bump: steering arm bending (yield / SF)', n.Mz / sArm, 'psi', m.bendN(p.spindleYieldPsi), '<='),
      detail('HARD 2" hit: rod tension (ultimate / ff)', h.Frod, 'lbf', At * m.bendH(p.linkRodUltimatePsi), '<='),
      detail('HARD 2" hit: rod end static rating', h.Frod, 'lbf', p.rodEndRatingLbf, '<='),
      detail('HARD 2" hit: steering arm bending (ultimate / ff)', h.Mz / sArm, 'psi', m.bendH(p.spindleUltimatePsi), '<='),
    ];
    const how = `Front hit moment about the struck kingpin: normal ${f(n.Mz, 0)} lb.in, hard ${f(h.Mz, 0)} lb.in (${h.fromLateral ? 'sideways rut-wall hit' : 'aft hit, scrub x H'}); steering arm ${f(ctx.L.front.ack.armLen, 2)}" at ${f(ctx.L.front.ack.armAngleDeg, 0)} deg, fore-aft lever ${f(armLeverIn(ctx), 2)}": rod force ${f(n.Frod)} lbf normal, ${f(h.Frod)} lbf hard (the other knuckle is free, so the rod carries all of it to the drag link). `
      + `Rod ${f(d, 3)}" (A_t ${f(At, 4)} in2), ${f(L, 2)}" between pins, Euler P_cr = pi2 E I / L2 = ${f(Pcr, 0)} lbf (pinned ends; the center clevis would only raise it). `
      + `Sideways tongue pull (${p.pullForceLbf} lbf at 45 deg, lateral ${f(side.Fperp)} lbf at the ${p.tongueLengthIn}" tip, hinge moment ${f(side.Mh, 0)} lb.in; ${levText(lv)}): tongue link ${f(side.Flink)} lbf, drag link ${f(side.Fdrag)} lbf, rod ${f(side.Frod)} lbf shared by the two knuckles = ${f(halfSide)} lbf in the compressed half. `
      + `At the hard hit the rod buckles at ${f(Pcr, 0)} lbf if the force exceeds it (hard force ${f(h.Frod)} = ${f((h.Frod / Pcr) * 100, 0)}% of P_cr): buckling is a bend, not a break, and is the intended first failure after the beam (D-50), so it is reported here and not scored. Rod-end rating ${f(p.rodEndRatingLbf, 0)} lbf is assumed (verify).`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'tie-rod', label: 'Tie rod, rod ends and steering arm', group: 'Structure', refs: REFS, primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── drag link ───────────────────────────────────────────────────────────────────────────────────────────────

export function dragLinkCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const m = steelBases(ctx);
  const d = p.tieRodDiaIn;
  const At = uncTensileArea(d);
  const L = ctx.L.front.bellcrank.dragLinkLen;
  const Pcr = eulerLoad(p.steelMoePsi, d, L);
  const side = tongueSidePull(ctx);
  const lv = leverage(ctx);
  const ev = (c: CaseData): CaseEval => {
    const n = chain(ctx, frontHit(ctx, c, 'normal')), h = chain(ctx, frontHit(ctx, c, 'hard'));
    const Fn = Math.max(n.Fdrag, side.Fdrag);
    const ds: Detail[] = [
      detail('NORMAL: link tension (yield / SF)', Fn, 'lbf', At * m.bendN(p.linkRodYieldPsi), '<='),
      detail('NORMAL: Euler buckling (P_cr / SF)', Fn, 'lbf', Pcr / m.sf, '<='),
      detail('NORMAL: rod end static rating / SF', Fn, 'lbf', p.rodEndRatingLbf / m.sf, '<='),
      detail('HARD 2" hit: link tension (ultimate / ff)', h.Fdrag, 'lbf', At * m.bendH(p.linkRodUltimatePsi), '<='),
      detail('HARD 2" hit: rod end static rating', h.Fdrag, 'lbf', p.rodEndRatingLbf, '<='),
    ];
    const how = `The drag link joins the bellcrank output pin to the tie-rod center and carries the tie-rod force through its angle (${levText(lv)}): ${f(n.Fdrag)} lbf (1" bump), ${f(side.Fdrag)} lbf (sideways tongue pull) so ${f(Fn)} lbf normal, ${f(h.Fdrag)} lbf hard. Rod ${f(d, 3)}", ${f(L, 2)}" long (derived), Euler P_cr = ${f(Pcr, 0)} lbf. Rod-end rating ${f(p.rodEndRatingLbf, 0)} lbf assumed (verify).`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'drag-link', label: 'Drag link and rod ends', group: 'Structure', refs: REFS, primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── bellcrank ───────────────────────────────────────────────────────────────────────────────────────────────

export function bellcrankCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const m = steelBases(ctx);
  const lv = leverage(ctx);
  const sec = rectSection(p.bellcrankPlateThickIn, p.bellcrankArmWidthIn);
  const dp = p.modePinDiaIn; // pivot bolt
  const side = tongueSidePull(ctx);
  const ev = (c: CaseData): CaseEval => {
    const n = chain(ctx, frontHit(ctx, c, 'normal')), h = chain(ctx, frontHit(ctx, c, 'hard'));
    const Mn = Math.max(n.Mb, side.Mb), Mh = h.Mb;
    const Fp = (M: number) => Math.max(M / lv.out, M / lv.inn);
    const Ap = (Math.PI / 4) * dp * dp;
    const ds: Detail[] = [
      detail('NORMAL: arm bending at the pivot (yield / SF)', bendingStress(Mn, sec), 'psi', m.bendN(p.bracketSteelYieldPsi), '<='),
      detail('NORMAL: pivot bolt shear (single shear, 0.577 Fy / SF)', Fp(Mn) / Ap, 'psi', m.shearN(p.kingpinYieldPsi), '<='),
      detail('NORMAL: pivot bearing on the plate (0.9 Fy / SF)', Fp(Mn) / (dp * p.bellcrankPlateThickIn), 'psi', m.brgN(p.bracketSteelYieldPsi), '<='),
      detail('HARD 2" hit: arm bending (ultimate / ff)', bendingStress(Mh, sec), 'psi', m.bendH(p.bracketSteelUltimatePsi), '<='),
      detail('HARD 2" hit: pivot bolt shear (0.6 Fu / ff)', Fp(Mh) / Ap, 'psi', m.shearH(p.kingpinUltimatePsi), '<='),
    ];
    const how = `Bellcrank plate ${f(p.bellcrankPlateThickIn, 3)}" x ${f(p.bellcrankArmWidthIn, 2)}" arms (${levText(lv)}). Moment on the plate: ${f(Mn, 0)} lb.in normal (the larger of the 1" bump kickback ${f(n.Mb, 0)} and the sideways tongue pull ${f(side.Mb, 0)}), ${f(Mh, 0)} lb.in hard. S = ${f(sec.S, 4)} in3. Pivot bolt ${f(dp, 3)}" grade 8 in single shear takes the larger arm force ${f(Fp(Mn))} lbf normal, ${f(Fp(Mh))} hard (the opposite arm's force is a couple, so this is conservative).`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'bellcrank', label: 'Bellcrank plate and pivot', group: 'Structure', refs: REFS, primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── steer stops (tow tabs, ride window) ─────────────────────────────────────────────────────────────────────

export function steerStopLoadCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const m = steelBases(ctx);
  const dp = p.modePinDiaIn;
  const tPlate = 0.125; // mode plate, 1/8" steel (spec 1.1)
  const dt = p.kingpinBracketBoltDiaIn; // the tow-stop set screw
  const At = (Math.PI / 4) * dt * dt;
  const A = ctx.L.front.ack.armLen;
  const ev = (c: CaseData): CaseEval => {
    const n = chain(ctx, frontHit(ctx, c, 'normal')), h = chain(ctx, frontHit(ctx, c, 'hard'));
    const side = tongueSidePull(ctx);
    const tabN = Math.max(n.Mz, (side.Frod / 2) * armLeverIn(ctx)) / A, tabH = h.Mz / A;
    const winN = n.Fcable, winH = h.Fcable;
    const ds: Detail[] = [
      detail('NORMAL: ride window plate bearing under the mode pin (0.9 Fy / SF)', winN / (dp * tPlate), 'psi', m.brgN(p.bracketSteelYieldPsi), '<='),
      detail('NORMAL: mode pin double shear (0.577 Fy / SF)', winN / (2 * (Math.PI / 4) * dp * dp), 'psi', m.shearN(p.kingpinYieldPsi), '<='),
      detail('NORMAL: tow stop tab set screw shear (0.577 Fy / SF)', tabN / At, 'psi', m.shearN(p.kingpinYieldPsi), '<='),
      detail('HARD 2" hit: ride window plate bearing (1.5 Fu / ff)', winH / (dp * tPlate), 'psi', m.brgH(p.bracketSteelUltimatePsi), '<='),
      detail('HARD 2" hit: mode pin double shear (0.6 Fu / ff)', winH / (2 * (Math.PI / 4) * dp * dp), 'psi', m.shearH(p.kingpinUltimatePsi), '<='),
      detail('HARD 2" hit: tow stop tab set screw shear (0.6 Fu / ff)', tabH / At, 'psi', m.shearH(p.kingpinUltimatePsi), '<='),
    ];
    const how = `Ride mode: the narrow window in the 1/8" mode plate stops the bellcrank before the cable or the hand can: the bellcrank moment (${f(n.Mb, 0)} lb.in normal, ${f(h.Mb, 0)} hard) acts on the window at the cross-bar radius ${f(leverage(ctx).cable, 2)}", ${f(winN)} lbf normal, ${f(winH)} lbf hard, bearing under the ${f(dp, 3)}" mode pin (double shear). Tow mode: the bracket tab set screws (${f(dt, 4)}" grade 8) stop the steering arm at its ${f(A, 2)}" tip: ${f(tabN)} lbf normal (including the sideways tongue pull share), ${f(tabH)} lbf hard. The cable and the hand never see the kickback beyond the window (spec 1.6).`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'steer-stop-load', label: 'Steer stops: ride window plate, mode pin, tow tab screws', group: 'Structure', refs: REFS, primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── tongue (hinge pin, link pin, bending) ───────────────────────────────────────────────────────────────────

export function tongueLinkageCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const m = steelBases(ctx);
  const len = p.tongueLengthIn, thick = p.tongueThickIn, depth = p.tongueDepthIn;
  const side = tongueSidePull(ctx);
  const lv = leverage(ctx);
  const dh = p.tongueHingePinDiaIn, tc = p.tongueClevisThickIn, dl = p.modePinDiaIn;
  const ev = (c: CaseData): CaseEval => {
    void c;
    const lat = rectSection(depth, thick), vert = rectSection(thick, depth);
    const M = side.Fperp * len;
    const sLat = bendingStress(M, lat) + side.Fax / (thick * depth);
    const sVert = bendingStress(M, vert) + side.Fax / (thick * depth);
    const Fh = p.pullForceLbf; // resultant at the hinge pin
    const Ah = (Math.PI / 4) * dh * dh, Al = (Math.PI / 4) * dl * dl;
    const ds: Detail[] = [
      detail('tongue lateral bending at the hinge', sLat, 'psi', al.oakBend, '<='),
      detail('tongue vertical bending at the hinge', sVert, 'psi', al.oakBend, '<='),
      detail('hinge pin double shear (0.577 Fy / SF)', Fh / (2 * Ah), 'psi', m.shearN(p.kingpinYieldPsi), '<='),
      detail('hinge pin bearing on the two clevis plates (0.9 Fy / SF)', Fh / (2 * dh * tc), 'psi', m.brgN(p.bracketSteelYieldPsi), '<='),
      detail('hinge pin bearing in the oak tongue (dowel bearing)', Fh / (dh * depth), 'psi', al.oakDowel, '<='),
      detail('link pin single shear at the sideways pull (0.577 Fy / SF)', side.Flink / Al, 'psi', m.shearN(p.kingpinYieldPsi), '<='),
      detail('link pin bearing on the ear plate (0.9 Fy / SF)', side.Flink / (dl * tc), 'psi', m.brgN(p.bracketSteelYieldPsi), '<='),
    ];
    const how = `Design pull ${p.pullForceLbf} lbf at 45 deg to the tongue axis (D-14): ${f(side.Fperp)} lbf lateral and ${f(side.Fax)} lbf axial at the tip, ${len}" from the hinge. Tongue ${f(thick, 2)}" wide x ${f(depth, 2)}" deep oak: M = ${f(M, 0)} lb.in, lateral sigma ${f(sLat, 0)} psi, vertical ${f(sVert, 0)} psi (design ${f(al.oakBend, 0)}). `
      + `Hinge pin ${f(dh, 3)}" grade 8 in double shear through two ${f(tc, 3)}" clevis plates, resultant ${f(Fh)} lbf. Link: the lateral hinge moment ${f(side.Mh, 0)} lb.in over the ${f(lv.ear, 2)}" lever of the tongue link about the hinge gives ${f(side.Flink)} lbf in the link; link pin ${f(dl, 3)}". The tongue is held by the tongue-link / bellcrank / tie-rod chain and the +/-${p.tongueMaxYawDeg} deg yaw stops.`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'tongue', label: 'Tongue: bending, hinge pin and link pin', group: 'Structure', refs: ['D-14', 'D-53', 'D-4'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── tongue tie (the bridle eye bolt moved to the tongue tip) ────────────────────────────────────────────────

export function tongueTieCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const d = p.eyeBoltDiameterIn;
  const Ash = (Math.PI * d * d) / 4;
  const At = 0.75 * Ash; // threaded tensile area as in the old bridle-tie row
  const Z = (Math.PI * d ** 3) / 32;
  const arm = p.eyeBoltEyeOffsetIn;
  const Dw = p.eyeBoltWasherDiameterIn;
  const Aw = Math.max(1e-6, (Math.PI / 4) * (Dw * Dw - (d + 1 / 16) ** 2));
  const depth = p.tongueDepthIn;
  const handsZ = Math.max(p.pullerHandHeightIn, p.bridleTieHandHeightMaxIn);
  const eyeZ = ctx.L.front.tongue.z;
  const alpha = Math.atan2(handsZ - eyeZ, p.bridleRopeRunIn);
  const T = p.pullForceLbf * p.bridleTieOverloadFactor;
  const Tax = T * Math.sin(alpha); // along the vertical bolt axis
  const Th = T * Math.cos(alpha); // transverse: shear and bending over the eye offset
  const allow = p.eyeBoltYieldPsi / p.steelSafetyFactor;
  const ev = (c: CaseData): CaseEval => {
    void c;
    const sT = Tax / At, sB = (Th * arm) / Z;
    const sComb = sT + sB;
    const pW = Tax / Aw;
    const pHole = Th / (d * depth);
    const ds: Detail[] = [
      detail('eye bolt shank: axial tension + bending over the eye offset', sComb, 'psi', allow, '<='),
      detail('washer bearing on the tongue (oak perp)', pW, 'psi', al.oakPerp, '<='),
      detail('shank bearing in the tongue hole (oak dowel bearing)', pHole, 'psi', al.oakDowel, '<='),
    ];
    const how = `Tie load: design pull ${f(p.pullForceLbf)} lbf (D-14) x overload factor ${p.bridleTieOverloadFactor} (D-47) = ${f(T)} lbf along the rope from the tongue-tip eye (z = ${f(eyeZ, 2)}") to the pullers' hands ${f(p.bridleRopeRunIn)}" ahead at ${f(handsZ)}" (${f(alpha * 180 / Math.PI, 1)} deg above horizontal). The vertical shoulder eye bolt through the ${f(depth, 2)}" tongue sees ${f(Tax)} lbf axial and ${f(Th)} lbf transverse over the ${f(arm, 2)}" eye offset: sigma = ${f(sT, 0)} + ${f(sB, 0)} = ${f(sComb, 0)} psi (allow ${f(allow, 0)} = yield ${f(p.eyeBoltYieldPsi, 0)} / ${p.steelSafetyFactor}). Washer (${f(Dw, 2)}" OD) ${f(pW, 0)} psi, hole bearing ${f(pHole, 0)} psi. Order of failure (D-47): the eye bolt is the intended weak link: eye bolt at ${f((sComb / allow) * 100, 0)}% of its allowable, washer ${f((pW / al.oakPerp) * 100, 0)}%, hole ${f((pHole / al.oakDowel) * 100, 0)}%. Confirm the bought eye bolt's working-load limit is at least ${f(T)} lbf. A horizontal eye (axis fore-aft) would put the pull along the shank instead of across it.`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'tongue-tie', label: 'Tongue tie: eye bolt through the tongue tip', group: 'Structure', refs: ['D-33', 'D-14', 'D-47'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── ride stick and cables ───────────────────────────────────────────────────────────────────────────────────

export function stickCableCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const m = steelBases(ctx);
  const st = ctx.L.front.stick;
  const arm = p.rideStickLengthIn; // pivot to grip
  const ca = st.cableArm;
  const lv = leverage(ctx);
  const od = p.rideStickDiaIn, id = od - 2 * p.rideStickWallIn;
  const I = (Math.PI / 64) * (od ** 4 - id ** 4), S = I / (od / 2);
  const ev = (c: CaseData): CaseEval => {
    const n = chain(ctx, frontHit(ctx, c, 'normal')), h = chain(ctx, frontHit(ctx, c, 'hard'));
    const handN = p.stickHandLoadLbf, handH = 2 * p.stickHandLoadLbf;
    // The cable carries the lesser of the kickback (bellcrank moment over the cross-bar) and what a hand holding the grip can resist (hand x grip arm / stick cable arm).
    const cableN = Math.min(n.Fcable, (handN * arm) / ca), cableH = Math.min(h.Fcable, (handH * arm) / ca);
    const gripN = (cableN * ca) / arm, gripH = (cableH * ca) / arm;
    const Mn = gripN * arm, Mh = gripH * arm;
    const ds: Detail[] = [
      detail('NORMAL: cable tension vs minimum break strength / 3.5', cableN, 'lbf', p.stickCableBreakLbf / 3.5, '<='),
      detail('NORMAL: stick tube bending (yield / SF)', Mn / S, 'psi', m.bendN(p.rideStickYieldPsi), '<='),
      detail('HARD 2" hit: cable tension vs break strength / ff', cableH, 'lbf', p.stickCableBreakLbf / m.ff, '<='),
      detail('HARD 2" hit: stick tube bending (elastic vs 1.2 yield: bend, not break)', Mh / S, 'psi', p.rideStickYieldPsi * 1.2, '<='),
    ];
    const how = `Stick: ${f(od, 3)}" x ${f(p.rideStickWallIn, 3)}" aluminum tube (S = ${f(S, 4)} in3), pivot to grip ${arm}", stick cable arm ${ca}" (ratio ${f(arm / ca, 1)}:1); two 1/8" 7x19 stainless pull-pull cables, preload ${p.stickCablePreloadLbf} lbf, break ${f(p.stickCableBreakLbf, 0)} lbf (assumed). `
      + `Kickback of a front hit: bellcrank moment ${f(n.Mb, 0)} lb.in (1" bump), ${f(h.Mb, 0)} (2" hit) over the ${f(lv.cable, 2)}" cross-bar = ${f(n.Fcable)} / ${f(h.Fcable)} lbf in the cable if the stick is held; a hand can resist ${handN} lbf (hard: ${handH}) at the grip = ${f((handN * arm) / ca)} (${f((handH * arm) / ca)}) lbf in the cable, so the cable carries ${f(cableN)} lbf normal and ${f(cableH)} lbf hard (grip force ${f(gripN)} / ${f(gripH)} lbf; the study quoted 44-160 lbf). Tube bending ${f(Mn, 0)} lb.in normal, ${f(Mh, 0)} hard. Once the bellcrank reaches the window plate, the plate (steer-stop-load) takes the rest, not the cable. ${sensitivityText(ctx, c, 'front', p.bumpNormalHeightIn)}`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'stick-cable', label: 'Ride stick tube and pull-pull cables', group: 'Structure', refs: REFS, primary: 'goal', ...evalBoth(ctx, ev) });
}

export function linkageChecks(ctx: Ctx): AnalysisCheck[] {
  return [tieRodCheck(ctx), dragLinkCheck(ctx), bellcrankCheck(ctx), steerStopLoadCheck(ctx), tongueLinkageCheck(ctx), tongueTieCheck(ctx), stickCableCheck(ctx)];
}
