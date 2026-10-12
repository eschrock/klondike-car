/**
 * Front-end rows for the pivoting soapbox axle (D-56): `kingpin`, `king-bearing`, `front-beam`, `front-stub`, `steer-stops`, `king-beam` and `steer-clear`.
 *
 * The axle turns about ONE grade-8 kingpin bolt at (x = wheelbase, y = 0). The vertical load goes through the UHMW thrust washer (axle beam > tongue plate > washer > oak king
 * beam), not through the bolt; the bolt carries the tow pull, the fore-aft bump force and, because a one-wheel strike rolls the axle about the washer, the tension of the roll couple.
 *
 * Load basis (same as the rear rows, D-50/D-55): NORMAL use is the 1 in step at walking pace (`bumpSpeedNormalMph`, full margins); the HARD hit is the 2 in step at a jog
 * (`bumpSpeedHardMph`, steel ultimate / failSafeFactor, wood MOR x C_M with no safety factor). `bumpStrike(.., 'front', ..)` gives the vertical and fore-aft force on one front wheel.
 *
 * One-wheel roll: the struck wheel carries F1 = V + static, the other wheel F2 = its static load; the axle beam then tips about the washer with the moment M = (F1 - F2) track/2.
 * The washer resists it by an edge pressure; when the resultant lies outside the washer's core the bolt (at the center) holds the opposite side down in tension (`washerContact`).
 */
import { worldAABB } from '../model/bounds';
import { uncTensileArea, feAtAngle, feParallel, fePerp, lateralZ, ndsAdjust } from './nds';
import { circleSection, rectSection } from './beams';
import type { Ctx } from './context';
import { dualCheck, detail, governing, singleCheck, type CaseEval } from './dual';
import { DEG, RAD } from './geometry';
import { f } from './format';
import type { CaseData } from './loads';
import { evalBoth } from './stability';
import { allowables, wheelLoads } from './structure';
import { bumpStrike, peakVertical, bumpText, type BumpStrike } from './bump';
import { tieLoad } from './bridle';
import type { AnalysisCheck, Detail } from './types';

// ── analysis assumptions that are not design numbers ────────────────────────────────────────────────────────────

/** Bedding width (in) of the line contact between the axle beam face and a stop block once the oak has crushed in a little (assumed). */
export const STOP_BEDDING_IN = 0.5;
/** Minimum running gap (in) between a part that turns with the axle and a fixed part (steel past wood), other than the tires (those use `steerClearIn`). */
export const PART_CLEAR_IN = 0.125;
/** Outside diameter of the flat washer under the kingpin nut, as a multiple of the bolt diameter (an SAE flat washer is about 2.2 d). */
const NUT_WASHER_OD_X = 2.2;

// ── washer contact: the roll couple on the thrust washer ────────────────────────────────────────────────────────

export interface WasherContact {
  /** Peak contact pressure at the loaded edge (psi). */
  pEdge: number;
  /** Mean pressure N / A (psi). */
  pMean: number;
  /** Tension in the kingpin holding the unloaded side down (lbf); 0 when the washer stays in full contact or lifts off without the bolt. */
  bolt: number;
  /** Compression resultant on the washer and its distance from the washer center along the tilt direction. */
  C: number;
  yC: number;
  regime: 'full contact' | 'part contact' | 'bolt in tension';
}

/**
 * Pressure on an annular thrust washer (outer radius R, bore radius r) loaded by a downward force N and a tilting moment M about a diameter, with a no-tension linear pressure
 * distribution and the kingpin (a rigid tension member at the center) able to hold the unloaded side down:
 *  - core (N/A >= M/S): the whole washer is in contact, p_edge = N/A + M/S, no bolt force;
 *  - otherwise the contact shrinks to the loaded side; if the eccentricity M/N is larger than the bolt-at-the-neutral-axis case allows, the neutral axis is the diameter through the
 *    bolt and the bolt takes C - N in tension.
 */
export function washerContact(N: number, M: number, R: number, r: number): WasherContact {
  const A = Math.PI * (R * R - r * r);
  const I = (Math.PI / 4) * (R ** 4 - r ** 4);
  const S = I / R;
  const m = Math.abs(M);
  const n = Math.max(0, N);
  if (n / A >= m / S - 1e-12 && n > 0) return { pEdge: n / A + m / S, pMean: n / A, bolt: 0, C: n, yC: n > 0 ? m / n : 0, regime: 'full contact' };
  const NS = 800;
  const strip = (y0: number) => {
    let C = 0, Mo = 0;
    const dy = (2 * R) / NS;
    for (let i = 0; i < NS; i++) {
      const y = -R + (i + 0.5) * dy;
      const w = 2 * (Math.sqrt(Math.max(0, R * R - y * y)) - (Math.abs(y) < r ? Math.sqrt(r * r - y * y) : 0));
      const u = y - y0;
      if (u > 0) { C += u * w * dy; Mo += u * y * w * dy; }
    }
    return { C, Mo };
  };
  const s0 = strip(0);
  const e0 = s0.Mo / s0.C;
  if (n <= 0 || m / n >= e0) {
    const k = m / s0.Mo;
    const C = k * s0.C;
    return { pEdge: k * R, pMean: n / A, bolt: Math.max(0, C - n), C, yC: e0, regime: 'bolt in tension' };
  }
  // Partial contact without bolt force: the neutral axis y0 < 0 where the compression resultant sits at e = M / N.
  let lo = -R, hi = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const s = strip(mid);
    if (s.Mo / s.C > m / n) hi = mid; else lo = mid;
  }
  const y0 = (lo + hi) / 2;
  const s = strip(y0);
  const k = n / s.C;
  return { pEdge: k * (R - y0), pMean: n / A, bolt: 0, C: n, yC: m / n, regime: 'part contact' };
}

// ── loads on the front axle ─────────────────────────────────────────────────────────────────────────────────────

export type StrikeKind = 'normal' | 'hard';

export interface FrontLoad {
  kind: StrikeKind;
  strike: BumpStrike;
  /** Wheel forces: struck wheel (V + static), the other wheel's static load, their sum and the roll moment (F1 - F2) track / 2. */
  F1: number;
  F2: number;
  N: number;
  roll: number;
  H: number;
  static: ReturnType<typeof wheelLoads>;
}

export function frontLoad(ctx: Ctx, c: CaseData, kind: StrikeKind): FrontLoad {
  const { p } = ctx;
  const w = wheelLoads(ctx, c);
  const strike = kind === 'hard' ? bumpStrike(ctx, c, 'front', p.bumpHardHeightIn, 1, 'hard') : bumpStrike(ctx, c, 'front', p.bumpNormalHeightIn, 1, 'normal');
  const F1 = peakVertical(strike);
  const F2 = Math.max(0, w.frontAxle - w.frontWheel);
  return { kind, strike, F1, F2, N: F1 + F2, roll: Math.max(0, (F1 - F2)) * (p.frontTrackIn / 2), H: strike.H, static: w };
}

/** The thrust-washer numbers for a load, with the washer's own geometry. */
function washerOf(ctx: Ctx) {
  const { p } = ctx;
  const R = p.kingThrustOdIn / 2, r = (p.kingpinDiaIn + 0.06) / 2;
  return { R, r, A: Math.PI * (R * R - r * r) };
}

const kindText = (k: StrikeKind) => (k === 'hard' ? 'HARD 2" hit' : 'NORMAL 1" bump');

// ── kingpin ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function kingpinCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const kd = p.kingpinDiaIn;
  const As = (Math.PI * kd * kd) / 4, At = uncTensileArea(kd), Z = (Math.PI * kd ** 3) / 32;
  const SF = p.steelSafetyFactor, FS = p.failSafeFactor;
  const allowN = p.grade8BoltYieldPsi / SF, allowH = p.grade8BoltUltimatePsi / FS;
  const wsh = washerOf(ctx);
  const kingMid = L.king.bot + L.king.depth / 2;
  const tongueMid = (L.tongue.z0 + L.tongue.z1) / 2;
  const armTow = Math.max(0.05, kingMid - tongueMid);
  const armWheel = Math.max(0.05, kingMid - L.r);
  const ld = tieLoad(ctx);
  const pitchArm = L.tongue.holeX - L.king.x;
  /** Von Mises stress of the bolt for a shear S (lbf), bending arm (in) and tension (lbf). */
  const vm = (S: number, arm: number, T: number) => {
    const sig = T / At + (S * arm) / Z, tau = S / As;
    return { sig, tau, vm: Math.sqrt(sig * sig + 3 * tau * tau) };
  };
  const ev = (c: CaseData): CaseEval => {
    // (i) tow pull at the tie (design pull x overload factor): shear Th through the kingpin; the vertical part lifts the nose and tips the axle about the washer.
    const w = wheelLoads(ctx, c);
    const tow = washerContact(w.frontAxle + ld.Tv, ld.Tv * pitchArm, wsh.R, wsh.r);
    const sTow = vm(ld.Th, armTow, tow.bolt);
    const n = frontLoad(ctx, c, 'normal'), h = frontLoad(ctx, c, 'hard');
    // (ii) bump while towing: the design pull plus the fore-aft bump force in shear; the roll couple as tension.
    const rollN = washerContact(n.N, n.roll, wsh.R, wsh.r), rollH = washerContact(h.N, h.roll, wsh.R, wsh.r);
    const sN = vm(p.pullForceLbf + n.H, armWheel, rollN.bolt);
    const sH = vm(p.pullForceLbf + h.H, armWheel, rollH.bolt);
    // hole bearing in the king beam (bolt in an oak hole, bearing perpendicular to grain, the bolt's shear on the beam depth)
    const al = allowables(ctx);
    const bearN = (p.pullForceLbf + n.H) / (kd * L.king.depth), bearH = (p.pullForceLbf + h.H) / (kd * L.king.depth);
    const ds: Detail[] = [
      detail('tow pull at the tie (x overload): bolt shear + bending + nut tension, von Mises (grade 8 yield / SF)', sTow.vm, 'psi', allowN, '<='),
      detail('NORMAL 1" bump at walking pace (+ the design pull): shear + bending + roll-couple tension, von Mises', sN.vm, 'psi', allowN, '<='),
      detail('HARD 2" hit (+ the design pull): shear + bending + roll-couple tension, von Mises (grade 8 ultimate / fail-safe factor)', sH.vm, 'psi', allowH, '<='),
      detail('NORMAL: bolt bearing in the oak king beam hole (dowel bearing)', bearN, 'psi', al.oakDowel, '<='),
      detail('HARD: bolt bearing in the oak king beam hole (no wood safety factor)', bearH, 'psi', al.oakDowel * p.woodSafetyFactor, '<='),
    ];
    const how = `Grade 8 kingpin ${f(kd, 3)}" (shank ${f(As, 3)} in2, threaded tensile area ${f(At, 3)} in2, Z = ${f(Z, 4)} in3); yield ${f(p.grade8BoltYieldPsi, 0)} / ${SF} = ${f(allowN, 0)} psi, ultimate ${f(p.grade8BoltUltimatePsi, 0)} / ${FS} = ${f(allowH, 0)} psi. `
      + `TOW: ${f(p.pullForceLbf)} lbf x ${p.bridleTieOverloadFactor} = ${f(ld.T)} lbf at the tie, ${f(ld.Th)} lbf horizontal through the bolt in shear (bending over ${f(armTow, 2)}", from the tongue plate to the middle of the ${f(L.king.depth, 2)}" king beam) and ${f(ld.Tv)} lbf up at ${f(pitchArm, 1)}" ahead of the pin: a tilting moment ${f(ld.Tv * pitchArm)} lb.in on the washer under the axle load ${f(w.frontAxle)} lb (${tow.regime}${tow.bolt > 0 ? `, nut tension ${f(tow.bolt)} lbf` : ''}): sigma ${f(sTow.sig, 0)}, tau ${f(sTow.tau, 0)}, von Mises ${f(sTow.vm, 0)} psi. `
      + `${bumpText(n.strike, 'Front 1" bump', p)}: fore-aft ${f(n.H)} lbf + design pull ${f(p.pullForceLbf)} = ${f(p.pullForceLbf + n.H)} lbf shear (arm ${f(armWheel, 2)}" from the axle line to the king beam middle); the struck wheel ${f(n.F1)} lbf and the other ${f(n.F2)} lbf tip the axle about the washer (roll moment ${f(n.roll)} lb.in, N = ${f(n.N)} lbf, ${rollN.regime}): the kingpin holds the other side down with ${f(rollN.bolt)} lbf = ${f(rollN.bolt / At, 0)} psi; von Mises ${f(sN.vm, 0)} psi. `
      + `${kindText('hard')}: ${bumpText(h.strike, 'Front hard hit', p)}; shear ${f(p.pullForceLbf + h.H)} lbf, roll moment ${f(h.roll)} lb.in (${rollH.regime}), tension ${f(rollH.bolt)} lbf: von Mises ${f(sH.vm, 0)} psi. `
      + `Hole bearing in the king beam ${f(bearN, 0)} / ${f(bearH, 0)} psi. The nut only stops the axle dropping away; the bolt is nowhere near its limit, the washer and the oak under the nut are (king-bearing row).`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'kingpin', label: 'Kingpin bolt (grade 8): tow pull, bump shear and roll tension', group: 'Structure', refs: ['D-56', 'D-47', 'D-55'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── king bearing (UHMW washer and the oak under it and under the nut) ──────────────────────────────────────────

export function kingBearingCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const wsh = washerOf(ctx);
  const allow = p.steerBearingAllowPsi;
  const kd = p.kingpinDiaIn;
  const nutOd = NUT_WASHER_OD_X * kd;
  const nutA = (Math.PI / 4) * (nutOd * nutOd - (kd + 1 / 16) ** 2);
  const ev = (c: CaseData): CaseEval => {
    const w = wheelLoads(ctx, c);
    const n = frontLoad(ctx, c, 'normal'), h = frontLoad(ctx, c, 'hard');
    const cN = washerContact(n.N, n.roll, wsh.R, wsh.r), cH = washerContact(h.N, h.roll, wsh.R, wsh.r);
    const uniN = n.N / wsh.A, uniH = h.N / wsh.A;
    const stat = w.frontAxle / wsh.A;
    const nutN = cN.bolt / nutA, nutH = cH.bolt / nutA;
    const ds: Detail[] = [
      detail('static front axle load on the UHMW washer (mean pressure)', stat, 'psi', allow, '<='),
      detail('NORMAL 1" bump: mean pressure (static + the struck wheel\'s bump force)', uniN, 'psi', allow, '<='),
      detail('HARD 2" hit: mean pressure (static + the struck wheel\'s bump force; 2 x the static allowable)', uniH, 'psi', 2 * allow, '<='),
      detail('NORMAL 1" bump, one wheel: edge pressure of the roll couple on the UHMW washer', cN.pEdge, 'psi', allow, '<='),
      detail('HARD 2" hit, one wheel: edge pressure of the roll couple on the UHMW washer (2 x the static allowable)', cH.pEdge, 'psi', 2 * allow, '<='),
      detail('NORMAL: edge pressure on the oak king beam under the washer (oak compression perpendicular, design)', cN.pEdge, 'psi', al.oakPerp, '<='),
      detail('HARD: edge pressure on the oak king beam (oak perpendicular, no wood safety factor)', cH.pEdge, 'psi', al.oakPerp * p.woodSafetyFactor, '<='),
      detail('NORMAL: nut washer bearing on the oak slot ceiling (roll-couple tension, oak perpendicular)', nutN, 'psi', al.oakPerp, '<='),
      detail('HARD: nut washer bearing on the oak slot ceiling (no wood safety factor)', nutH, 'psi', al.oakPerp * p.woodSafetyFactor, '<='),
    ];
    const how = `UHMW thrust washer ${f(p.kingThrustOdIn, 2)}" OD x ${f(kd + 0.06, 3)}" bore x ${f(p.kingThrustThickIn, 3)}": area ${f(wsh.A, 2)} in2; allowable ${f(allow, 0)} psi (steerBearingAllowPsi, verify with the supplier; PV-limited when turning under load). `
      + `Static front axle ${f(w.frontAxle)} lb: ${f(stat, 0)} psi. ${bumpText(n.strike, 'Front 1" bump', p)}: struck wheel ${f(n.F1)} lbf + other wheel ${f(n.F2)} lbf = N ${f(n.N)} lbf, ${f(uniN, 0)} psi mean. `
      + `One-wheel roll couple M = (F1 - F2) x track/2 = (${f(n.F1)} - ${f(n.F2)}) x ${f(p.frontTrackIn / 2, 2)} = ${f(n.roll)} lb.in on the washer (section modulus ${f((Math.PI / 4) * (wsh.R ** 4 - wsh.r ** 4) / wsh.R, 3)} in3): ${cN.regime}, edge pressure ${f(cN.pEdge, 0)} psi${cN.bolt > 0 ? ` with the kingpin holding the other side down at ${f(cN.bolt)} lbf` : ''} (an idealized bolt preload that kept the whole washer in contact would give N/A + M/S = ${f(n.N / wsh.A + n.roll / ((Math.PI / 4) * (wsh.R ** 4 - wsh.r ** 4) / wsh.R), 0)} psi: a lower bound). `
      + `Hard hit: ${bumpText(h.strike, 'Front hard hit', p)}; N ${f(h.N)} lbf, M ${f(h.roll)} lb.in: ${cH.regime}, edge ${f(cH.pEdge, 0)} psi (allow 2 x ${f(allow, 0)}); kingpin tension ${f(cH.bolt)} lbf. `
      + `The same pressure bears on the oak of the king beam under the washer (${f(al.oakPerp, 0)} psi design = ${p.oakCompPerpPsi} x C_M ${p.wetServiceFactorCompPerp} / ${p.woodSafetyFactor}) and the tension on the oak slot ceiling over the ${f(nutOd, 2)}" flat washer under the nut (area ${f(nutA, 2)} in2: ${f(nutN, 0)} / ${f(nutH, 0)} psi), ${f(L.king.depth - p.kingpinDiaIn * 1.2, 2)}" of oak above the slot. The 2.5" washer is a short lever for the roll couple of a one-wheel strike; a larger washer (kingThrustOdIn, to ${f(3.5, 1)}"), a steel bearing plate on the king beam, or a stop that limits the axle's roll are the fixes if this row fails.`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'king-bearing', label: 'Kingpin thrust washer and the oak under it', group: 'Structure', refs: ['D-56', 'D-55'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── front axle beam ──────────────────────────────────────────────────────────────────────────────────────────────

export function frontBeamCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const b = L.beamF;
  const yw = p.frontTrackIn / 2;
  const hole = p.kingpinDiaIn;
  const groove = p.axleDiameterIn;
  // The beam at the kingpin: full depth, the bolt hole takes width. At the inner end of the stub grooves: the groove takes depth.
  const wNet = Math.max(0.1, b.thick - hole);
  const secK = { A: wNet * b.depth, I: (wNet * b.depth ** 3) / 12, c: b.depth / 2, S: (wNet * b.depth ** 2) / 6 };
  const hEff = Math.max(0.1, b.depth - groove);
  const secG = rectSection(b.thick, hEff);
  const yIn = b.len / 2 - p.frontStubLenIn; // inner end of the groove / stub
  const plateY = p.clampPlateWidthIn;
  const yOutSt = b.len / 2 - 0.25 - plateY / 2, yInSt = yIn + 0.25 + plateY / 2; // the two clamp stations (model/pivot.ts)
  const bd = p.uboltRodDiameterIn;
  const boltAllowN = p.ss316BoltYieldPsi / p.steelSafetyFactor, boltAllowH = p.holdDownBoltUltimatePsi / p.failSafeFactor;
  const ligament = (b.thick - groove) / 2;
  const ev = (c: CaseData): CaseEval => {
    const w = wheelLoads(ctx, c);
    const n = frontLoad(ctx, c, 'normal'), h = frontLoad(ctx, c, 'hard');
    const mK = (F: number) => F * yw; // wheel force x lever to the kingpin section
    const mG = (F: number) => F * (yw - yIn); // ... to the inner end of the groove
    const tauK = (F: number) => (1.5 * F) / secK.A;
    // The rod is a beam on its two clamp stations: the wheel force F (up, at yw) is held by the outer station pushing down (F (yw - yInSt)/(yOutSt - yInSt)) and the inner one up.
    const Pout = (F: number) => (F * (yw - yInSt)) / (yOutSt - yInSt);
    const boltT = (F: number) => Pout(F) / 2; // two plate bolts per station
    const At = uncTensileArea(bd);
    // Fore-aft bump force on the rod: the same lever ratio, reacted by the groove walls over the plate length.
    const wallP = (H: number) => (H * (yw - yInSt)) / (yOutSt - yInSt) / (groove * plateY);
    const Fs = w.frontWheel;
    const ds: Detail[] = [
      detail('static wheel force: bending at the kingpin hole (net section)', bendingNet(mK(Fs), secK), 'psi', al.oakBend, '<='),
      detail('NORMAL 1" bump: bending at the kingpin hole (net of the bolt hole)', bendingNet(mK(n.F1), secK), 'psi', al.oakBend, '<='),
      detail('NORMAL 1" bump: shear at the kingpin section (net)', tauK(n.F1), 'psi', al.oakShear, '<='),
      detail('NORMAL 1" bump: bending at the inner end of the stub groove (net of the rod groove)', (mG(n.F1) * secG.c) / secG.I, 'psi', al.oakBend, '<='),
      detail('HARD 2" hit: bending at the kingpin hole (MOR x C_M, no wood safety factor)', bendingNet(mK(h.F1), secK), 'psi', al.oakBend * p.woodSafetyFactor, '<='),
      detail('HARD 2" hit: shear at the kingpin section (no wood safety factor)', tauK(h.F1), 'psi', al.oakShear * p.woodSafetyFactor, '<='),
      detail('HARD 2" hit: bending at the inner end of the stub groove (no wood safety factor)', (mG(h.F1) * secG.c) / secG.I, 'psi', al.oakBend * p.woodSafetyFactor, '<='),
      detail('NORMAL: clamp-plate bolt tension at the outer station (316 yield / SF)', boltT(n.F1), 'lbf', At * boltAllowN, '<='),
      detail('HARD: clamp-plate bolt tension at the outer station (316 ultimate / fail-safe factor)', boltT(h.F1), 'lbf', At * boltAllowH, '<='),
      detail('NORMAL: fore-aft bump force bearing on the rod groove wall at the outer station (oak perpendicular)', wallP(n.H), 'psi', al.oakPerp, '<='),
      detail('HARD: fore-aft bump force on the groove wall (no wood safety factor)', wallP(h.H), 'psi', al.oakPerp * p.woodSafetyFactor, '<='),
      detail('wood ligament beside the rod groove (min ligament, D-4)', ligament, 'in', p.beamLigamentMinIn, '>='),
    ];
    const how = `Front beam ${f(b.thick, 2)}" x ${f(b.depth, 2)}" x ${f(b.len, 2)}" oak, a stub axle clamped in a top groove at each end over ${f(p.frontStubLenIn, 1)}". The wheel force acts ${f(yw, 2)}" from the kingpin; the beam is held down at the kingpin by the thrust washer (center reaction). `
      + `Static heavier wheel ${f(Fs)} lb: M = ${f(mK(Fs))} lb.in. ${bumpText(n.strike, 'Front 1" bump', p)}: wheel force V + static = ${f(n.F1)} lbf: M = F x ${f(yw, 2)} = ${f(mK(n.F1))} lb.in on the net section at the kingpin hole (${f(wNet, 3)}" x ${f(b.depth, 2)}", S = ${f(secK.S, 3)} in3): sigma ${f(bendingNet(mK(n.F1), secK), 0)} psi (design ${f(al.oakBend, 0)}), tau ${f(tauK(n.F1), 0)} psi (design ${f(al.oakShear, 0)}). At the inner end of the stub groove (${f(yIn, 2)}" from the center; the section is ${f(b.thick, 2)}" x ${f(hEff, 2)}" after the ${f(groove, 2)}" rod groove) M = F x ${f(yw - yIn, 2)} = ${f(mG(n.F1))} lb.in: ${f((mG(n.F1) * secG.c) / secG.I, 0)} psi. `
      + `Hard hit: wheel force ${f(h.F1)} lbf: ${f(bendingNet(mK(h.F1), secK), 0)} psi against MOR x C_M ${f(al.oakBend * p.woodSafetyFactor, 0)}. `
      + `The rod acts as a beam on its two clamp stations (${f(yInSt, 2)}" and ${f(yOutSt, 2)}" from the center): the outer station holds it down with ${f(Pout(n.F1))} lbf (${f(boltT(n.F1))} lbf on each of its two ${f(bd, 3)}" 316 bolts, ${f(At, 4)} in2 tensile area; hard ${f(boltT(h.F1))} lbf), and the fore-aft bump force H = ${f(n.H)} lbf (hard ${f(h.H)}) bears on the groove wall over ${f(groove, 2)}" x ${f(plateY, 2)}" at the outer station: ${f(wallP(n.H), 0)} / ${f(wallP(h.H), 0)} psi. Ligament beside the groove ${f(ligament, 3)}" (min ${p.beamLigamentMinIn}"). ${'Wheel-rate sensitivity as in the wheel rows (bumpWheelRateLbIn, verify by bench test).'}`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'front-beam', label: 'Front axle beam (oak): bending at the kingpin hole, clamp bolts and groove', group: 'Structure', refs: ['D-56', 'D-4', 'D-50', 'D-55'], primary: 'goal', ...evalBoth(ctx, ev) });
}

/** Bending stress of a section for a moment (M c / I). */
const bendingNet = (M: number, s: { I: number; c: number }): number => (M * s.c) / s.I;

// ── front stub axles ─────────────────────────────────────────────────────────────────────────────────────────────

export function frontStubCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const sec = circleSection(p.axleDiameterIn);
  const E = p.steelMoePsi;
  const yw = p.frontTrackIn / 2;
  const a = Math.max(0.01, yw - L.beamF.len / 2); // from the beam end (where the groove ends) to the hub center
  const allowN = p.axleYieldPsi / p.steelSafetyFactor, allowH = p.axleUltimatePsi / p.failSafeFactor;
  const wheelR = ctx.d.wheelRadiusIn;
  const ev = (c: CaseData): CaseEval => {
    const n = frontLoad(ctx, c, 'normal'), h = frontLoad(ctx, c, 'hard');
    const Rn = Math.hypot(n.H, n.F1), Rh = Math.hypot(h.H, h.F1);
    const sN = (Rn * a * sec.c) / sec.I, sH = (Rh * a * sec.c) / sec.I;
    const Pst = n.static.frontWheel;
    const Hs = p.tireGroundMu * Pst;
    let sSkid = 0, psiW = 0;
    for (let psi = 0; psi <= 90; psi += 1) {
      const Hy = Hs * Math.cos(psi * RAD), Hx = Hs * Math.sin(psi * RAD);
      const sg = (Math.hypot(Pst * a + Hy * wheelR, Hx * a) * sec.c) / sec.I + Hy / sec.A;
      if (sg > sSkid) { sSkid = sg; psiW = psi; }
    }
    const defl = (Pst * a ** 3) / (3 * E * sec.I);
    const ds: Detail[] = [
      detail('NORMAL 1" front bump: stub bending (resultant of H and V + static, yield / SF)', sN, 'psi', allowN, '<='),
      detail('NORMAL cornering skid (mu P at the contact patch, static load), resultant', sSkid, 'psi', allowN, '<='),
      detail('HARD 2" front hit: stub bending (ultimate / fail-safe factor)', sH, 'psi', allowH, '<='),
      detail('front stub tip deflection (static)', defl, 'in', 0.05, '<='),
    ];
    const how = `Front stub axle ${p.axleDiameterIn}" steel rod bolted down in the beam end, free end carrying the wheel: cantilever a = ${f(a, 2)}" from the beam end (${f(L.beamF.len / 2, 3)}") to the hub center (${f(yw, 3)}"). ${bumpText(n.strike, 'Front 1" bump', p)}; with the static wheel load still on the tire V_total = ${f(n.F1)} lbf, resultant ${f(Rn)} lbf: sigma = ${f(sN, 0)} psi vs ${f(allowN, 0)} (yield ${f(p.axleYieldPsi, 0)} / SF ${p.steelSafetyFactor}). ${bumpText(h.strike, 'Hard hit', p)}; resultant ${f(Rh)} lbf: ${f(sH, 0)} psi vs ${f(allowH, 0)} (ultimate ${f(p.axleUltimatePsi, 0)} / ${p.failSafeFactor}). Cornering skid H = mu P_static = ${f(Hs)} lbf at r ${f(wheelR, 2)}" (worst angle ${f(psiW, 0)} deg): ${f(sSkid, 0)} psi; static tip deflection ${defl.toFixed(4)}".`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'front-stub', label: 'Front stub axle bending (bump basis)', group: 'Structure', refs: ['D-56', 'D-4', 'D-50', 'D-55'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── steering stops ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Where the axle beam first meets a stop block as the steer angle grows (the model's block geometry, `L.stops`). The beam's leading face is the plane `half` ahead of its axis;
 * turned by `a` it crosses the block's rear face (x = `faceX`) at world |y*| = ((faceX - kingX - half cos a) / sin a) cos a - half sin a, and everything outboard of that is AHEAD of the
 * face. The block ends at y2, so the beam touches its OUTER end when y*(a) = y2: that is the lock angle by construction (layout.ts). Returns the angle (rad) and the contact |y|.
 */
export function stopContact(ctx: Ctx): { angle: number; y: number } {
  const { L } = ctx;
  const half = L.beamF.thick / 2;
  const yStar = (a: number) => ((L.stops.faceX - L.king.x - half * Math.cos(a)) / Math.sin(a)) * Math.cos(a) - half * Math.sin(a);
  let lo = 1e-4, hi = Math.PI / 2 - 1e-4;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (yStar(mid) > L.stops.y2) lo = mid; else hi = mid; }
  return { angle: (lo + hi) / 2, y: L.stops.y2 };
}

export function steerStopsCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const st = L.stops;
  const yw = p.frontTrackIn / 2;
  const sc = stopContact(ctx);
  const yc = sc.y; // lever of the stop force from the kingpin
  const ld = tieLoad(ctx);
  const arm = L.tongue.holeX - L.king.x;
  const hc = Math.max(0.1, L.beamF.top - st.bot); // block height the beam face overlaps
  const nB = 2, bd = p.steerStopBoltDiaIn;
  const Ab = (Math.PI * bd * bd) / 4;
  const boltShearN = (0.6 * p.ss316BoltYieldPsi) / p.steelSafetyFactor, boltShearH = (0.6 * p.holdDownBoltUltimatePsi) / p.failSafeFactor;
  const jointArm = Math.max(0.1, st.top - (st.bot + hc / 2)); // force line to the glue plane under the joist
  const Aten = uncTensileArea(bd);
  const jD = p.crossmemberDepthIn;
  const joist = { t: L.joistT, d: jD };
  const Sj = (joist.d * joist.t ** 2) / 6; // plan bending of the joist (weak axis)
  const jointLever = (st.y2 - st.y1) / 2;
  // NDS lateral capacity of one bolt, wood on wood, single shear at the glue plane (load perpendicular to the grain in both pieces).
  const Fem = feAtAngle(feParallel(p.oakSpecificGravity), fePerp(p.oakSpecificGravity, bd), 90);
  const lat = lateralZ({ D: bd, lm: st.top - st.bot, ls: jD, Fem, Fes: Fem, Fyb: p.ss316BoltYieldPsi, thetaDeg: 90 });
  const Zadj = lat.Z * ndsAdjust(p);
  const ev = (c: CaseData): CaseEval => {
    const n = frontLoad(ctx, c, 'normal'), h = frontLoad(ctx, c, 'hard');
    // Torque about the kingpin: the fore-aft force at one front wheel (lever track/2), or the pullers' yank on the tongue (the lateral part at the tie).
    const Tn = n.H * yw, Th = h.H * yw;
    const Tf = p.tireGroundMu * n.static.frontWheel * yw; // one front wheel dragged on the ground
    const Ty = ld.Th * Math.sin(Math.max(ld.lock, 0.0)) * arm + 0; // a lateral yank of the rope at the lock angle
    const Tyank = ld.Th * arm * Math.sin(ld.lock);
    void Ty;
    const Fn = Tn / yc, Fh = Th / yc, Ff = Tf / yc, Fy = Tyank / yc;
    const crush = (F: number) => F / (hc * STOP_BEDDING_IN);
    const shear = (F: number) => F / (nB * Ab);
    const bolts = (F: number) => F / (nB * Zadj / nB); // placeholder replaced below
    void bolts;
    const lateralCap = nB * Zadj;
    const tens = (F: number) => (F * jointArm) / (L.joistT / 2) / nB; // each bolt holds the block against tipping about its front edge
    const jM = (F: number) => F * jointLever;
    const worstN = Math.max(Fn, Ff, Fy);
    const ds: Detail[] = [
      detail('NORMAL (worst of 1" bump H, dragged wheel, puller yank): oak crush at the line contact (perpendicular to grain)', crush(worstN), 'psi', al.oakPerp, '<='),
      detail('HARD 2" hit: oak crush at the line contact (no wood safety factor)', crush(Fh), 'psi', al.oakPerp * p.woodSafetyFactor, '<='),
      detail('NORMAL: 2 stop bolts in shear across the glue line (316 yield, 0.6 / SF)', shear(worstN), 'psi', boltShearN, '<='),
      detail('HARD: 2 stop bolts in shear (316 ultimate, 0.6 / fail-safe factor)', shear(Fh), 'psi', boltShearH, '<='),
      detail('NORMAL: stop force vs the NDS lateral capacity of the 2 bolts in oak (wood on wood, single shear)', worstN, 'lbf', lateralCap, '<='),
      detail('HARD: stop force vs the NDS lateral capacity (2 bolts, no further factor)', Fh, 'lbf', lateralCap * 1.0, '<='),
      detail('NORMAL: bolt tension holding the block against tipping about the load line offset (316 yield / SF)', tens(worstN), 'lbf', Aten * p.ss316BoltYieldPsi / p.steelSafetyFactor, '<='),
      detail('NORMAL: end joist plan bending from the stop force (weak axis, deck diaphragm neglected)', jM(worstN) / Sj, 'psi', al.oakBend, '<='),
      detail('HARD: end joist plan bending (no wood safety factor)', jM(Fh) / Sj, 'psi', al.oakBend * p.woodSafetyFactor, '<='),
    ];
    const how = `Stops: two oak blocks ${f(L.joistT, 2)}" x ${f(st.y2 - st.y1, 2)}" x ${f(st.top - st.bot, 2)}" under the ends of the end joist, rear face at x = ${f(st.faceX, 2)}". The axle beam's leading face (half thickness ${f(L.beamF.thick / 2, 2)}") reaches that plane at the block's outer end, |y| = ${f(st.y2, 2)}", at ${f(sc.angle * DEG, 1)}° (the ${f(p.steerLockDeg, 0)}° lock; the block runs inboard from there to |y| = ${f(st.y1, 2)}"): contact at |y| = ${f(yc, 2)}", over the ${f(hc, 2)}" the beam top (${f(L.beamF.top, 3)}") reaches up into the block. `
      + `Torque about the kingpin (lever track/2 = ${f(yw, 2)}"): ${bumpText(n.strike, 'Front 1" bump', p)} gives H ${f(n.H)} lbf x ${f(yw, 2)} = ${f(Tn)} lb.in -> stop force ${f(Fn)} lbf; a front wheel dragged on the ground mu P = ${f(p.tireGroundMu * n.static.frontWheel)} lbf -> ${f(Ff)} lbf; the pullers yanking the tongue at full lock (${f(ld.Th)} lbf x sin ${f(ld.lock * DEG, 0)}° x ${f(arm, 1)}") -> ${f(Fy)} lbf; hard hit H ${f(h.H)} lbf -> ${f(Fh)} lbf. `
      + `Crush on the line contact bedded ${f(STOP_BEDDING_IN, 2)}" wide (assumed) x ${f(hc, 2)}": ${f(crush(worstN), 0)} / ${f(crush(Fh), 0)} psi vs ${f(al.oakPerp, 0)} / ${f(al.oakPerp * p.woodSafetyFactor, 0)}. The block hangs by its glue (end grain on the joist: not counted) and two ${f(bd, 4)}" 316 bolts: shear ${f(shear(worstN), 0)} / ${f(shear(Fh), 0)} psi, NDS lateral capacity ${f(lateralCap)} lbf for the pair (${lat.mode}, Z ${f(lat.Z)} adj x ${f(ndsAdjust(p), 2)}), tension ${f(tens(worstN))} lbf each from the ${f(jointArm, 2)}" offset of the load below the glue plane. End joist ${f(joist.t, 2)}" x ${f(joist.d, 2)}": plan M = F x ${f(jointLever, 2)}" = ${f(jM(worstN))} lb.in, ${f(jM(worstN) / Sj, 0)} psi (the glued deck ply stiffens it a lot; not counted).`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'steer-stops', label: 'Steering stop blocks: crush, bolts and end joist', group: 'Structure', refs: ['D-56', 'D-55'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── king beam (the crossmember) ──────────────────────────────────────────────────────────────────────────────

/** Net section of the king beam at the bolt: the hole takes the center, the nut slot (cut from the front face near the top) takes depth from the front half. */
function kingNetSection(ctx: Ctx) {
  const { p, L } = ctx;
  const len = L.king.len, D = L.king.depth, kd = p.kingpinDiaIn;
  const slotH = Math.min(D - 0.1, kd * 1.2);
  const wA = Math.max(0.05, len / 2 - kd / 2), wB = wA;
  const rects = [
    { w: wA, h: D, z0: 0 }, // rear part, full depth
    { w: wB, h: D - slotH, z0: 0 }, // front part under the slot
  ];
  const A = rects.reduce((s, r) => s + r.w * r.h, 0);
  const zbar = rects.reduce((s, r) => s + r.w * r.h * (r.z0 + r.h / 2), 0) / A;
  const I = rects.reduce((s, r) => s + (r.w * r.h ** 3) / 12 + r.w * r.h * (r.z0 + r.h / 2 - zbar) ** 2, 0);
  const cMax = Math.max(zbar, D - zbar);
  return { A, I, c: cMax, S: I / cMax, slotH, w: wA + wB };
}

export function kingBeamCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const span = 2 * L.steer.railYIn;
  const sec = rectSection(L.king.len, L.king.depth);
  const net = kingNetSection(ctx);
  const wsh = washerOf(ctx);
  const FvEnd = al.oakShear / 2; // the beam's end grain is glued to the rail face: cross-grain, half the design shear (as the rear hangers)
  const endA = L.king.len * L.king.depth;
  const ev = (c: CaseData): CaseEval => {
    const n = frontLoad(ctx, c, 'normal'), h = frontLoad(ctx, c, 'hard');
    const w = wheelLoads(ctx, c);
    /** Reactions and moments of the simply supported beam under: up C at yC from the center (the washer contact), down T at the center (the nut). */
    const solve = (N: number, M: number) => {
      const wc = washerContact(N, M, wsh.R, wsh.r);
      const C = wc.C, T = wc.bolt, yC = wc.yC;
      const RB = (C * (span / 2 + yC) - T * (span / 2)) / span;
      const RA = C - T - RB;
      const M0 = RB * (span / 2); // at the center (nut, net section): the up load C sits at yC > 0 from the center
      const M0c = M0 - C * yC;
      const Mc = RB * (span / 2 - yC);
      return { wc, C, T, yC, RA, RB, Mnet: Math.abs(M0c), Mgross: Math.abs(Mc), V: Math.max(Math.abs(RA), Math.abs(RB)) };
    };
    const st = solve(w.frontAxle, 0);
    const sn = solve(n.N, n.roll), sh = solve(h.N, h.roll);
    const sBend = (s: ReturnType<typeof solve>) => Math.max((s.Mnet * net.c) / net.I, (s.Mgross * sec.c) / sec.I);
    const tau = (V: number) => (1.5 * V) / (sec.A);
    const end = (V: number) => V / endA;
    const ds: Detail[] = [
      detail('static front axle load at midspan: bending (net section at the kingpin and nut slot)', sBend(st), 'psi', al.oakBend, '<='),
      detail('NORMAL 1" bump, one wheel: bending (washer reaction, nut hold-down, net section at the nut slot)', sBend(sn), 'psi', al.oakBend, '<='),
      detail('NORMAL 1" bump: shear', tau(sn.V), 'psi', al.oakShear, '<='),
      detail('NORMAL 1" bump: end glue / Domino joint to the rail (cross-grain, half the design shear)', end(sn.V), 'psi', FvEnd, '<='),
      detail('HARD 2" hit: bending (MOR x C_M, no wood safety factor)', sBend(sh), 'psi', al.oakBend * p.woodSafetyFactor, '<='),
      detail('HARD 2" hit: shear (no wood safety factor)', tau(sh.V), 'psi', al.oakShear * p.woodSafetyFactor, '<='),
      detail('HARD 2" hit: end glue joint to the rail (no wood safety factor)', end(sh.V), 'psi', FvEnd * p.woodSafetyFactor, '<='),
    ];
    const how = `King beam ${f(L.king.len, 2)}" fore-aft x ${f(L.king.depth, 2)}" deep oak between the rails (span ${f(span, 2)}" between the rail faces, simply supported, the glued deck above it is not counted). The thrust washer pushes it up at the kingpin; the nut, in a slot cut from the front face (${f(net.slotH, 2)}" tall), pulls it down. `
      + `Static front axle ${f(w.frontAxle)} lb at midspan: M = ${f(st.Mnet)} lb.in. One-wheel 1" strike: washer reaction ${f(sn.C)} lbf at ${f(sn.yC, 2)}" off center (${sn.wc.regime}), nut hold-down ${f(sn.T)} lbf: reactions ${f(sn.RA)} / ${f(sn.RB)} lbf, M ${f(sn.Mnet)} lb.in at the nut slot (net section: area ${f(net.A, 2)} in2, S ${f(net.S, 3)} in3) and ${f(sn.Mgross)} lb.in under the washer edge (S ${f(sec.S, 3)}): ${f(sBend(sn), 0)} psi vs ${f(al.oakBend, 0)}; shear ${f(tau(sn.V), 0)} psi; end joint ${f(end(sn.V), 0)} psi on ${f(endA, 2)} in2. `
      + `Hard hit: reactions ${f(sh.RA)} / ${f(sh.RB)} lbf, ${f(sBend(sh), 0)} psi vs ${f(al.oakBend * p.woodSafetyFactor, 0)} (MOR x C_M), end joint ${f(end(sh.V), 0)} psi vs ${f(FvEnd * p.woodSafetyFactor, 0)}. The bearing of the oak under the washer and the nut is in the king-bearing row.`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'king-beam', label: 'King beam (oak crossmember): bending, shear and end joints', group: 'Structure', refs: ['D-56', 'D-4', 'D-50', 'D-55'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── steering clearances ──────────────────────────────────────────────────────────────────────────────────────────

type P2 = [number, number];

function rotAbout(q: P2, a: number, c: P2): P2 {
  const co = Math.cos(a), si = Math.sin(a);
  return [c[0] + co * (q[0] - c[0]) - si * (q[1] - c[1]), c[1] + si * (q[0] - c[0]) + co * (q[1] - c[1])];
}

function segDist(a: P2, b: P2, q: P2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2));
  return Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1]);
}

function pointInPoly(q: P2, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Smallest distance between two plan polygons (0 when they overlap). */
export function polyGap(a: P2[], b: P2[]): number {
  if (a.some((q) => pointInPoly(q, b)) || b.some((q) => pointInPoly(q, a))) return 0;
  let m = Infinity;
  for (const [pa, pb] of [[a, b], [b, a]] as [P2[], P2[]][]) {
    for (const q of pa) for (let i = 0; i < pb.length; i++) m = Math.min(m, segDist(pb[i], pb[(i + 1) % pb.length], q));
  }
  return m;
}

export function steerClear(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const lock = L.steer.lock;
  const sc = stopContact(ctx);
  const aMax = Math.min(lock, sc.angle); // the axle cannot turn past the stops
  const kc: P2 = [L.king.x, 0];
  const rects = (ids: string[]): P2[][] => ids.map((id) => ctx.byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => {
    const b = worldAABB(x);
    return [[b.min[0], b.min[1]], [b.max[0], b.min[1]], [b.max[0], b.max[1]], [b.min[0], b.max[1]]] as P2[];
  });
  const plateIds = ['L', 'R'].flatMap((s) => [1, 2, 3, 4].map((k) => `clamp-F${s}${k}`));
  const plates = rects(plateIds);
  const plateTop = Math.max(...plateIds.map((id) => { const x = ctx.byId.get(id); return x ? worldAABB(x).max[2] : -Infinity; }));
  const tongue = ctx.byId.get('bridle-tongue');
  const tongueOutlineXY = ((): P2[] => {
    if (!tongue) return [];
    const b = worldAABB(tongue);
    // Plan outline from the model: head, taper, bar (same as pivot.ts tongueOutline).
    const hw = p.tongueHeadWidthIn / 2, bw = p.tongueWidthIn / 2, kx = L.king.x;
    const xh0 = kx - Math.max(hw, p.kingThrustOdIn / 2 + 0.25), xh1 = kx + Math.max(hw, p.kingThrustOdIn / 2 + 0.25);
    return [[xh0, -hw], [xh1, -hw], [xh1 + 4, -bw], [b.max[0], -bw], [b.max[0], bw], [xh1 + 4, bw], [xh1, hw], [xh0, hw]];
  })();
  const stopRects: P2[][] = [1, -1].map((s) => {
    const x0 = L.stops.faceX, x1 = L.stops.faceX + L.stops.thick;
    const ya = s * L.stops.y1, yb = s * L.stops.y2;
    return [[x0, ya], [x1, ya], [x1, yb], [x0, yb]];
  });
  let gapTongue = Infinity, gapPlates = Infinity;
  const steps = 40;
  for (let i = -steps; i <= steps; i++) {
    const a = (aMax * i) / steps;
    for (const sr of stopRects) {
      if (tongueOutlineXY.length) gapTongue = Math.min(gapTongue, polyGap(tongueOutlineXY.map((q) => rotAbout(q, a, kc)), sr));
      for (const pl of plates) gapPlates = Math.min(gapPlates, polyGap(pl.map((q) => rotAbout(q, a, kc)), sr));
    }
  }
  const railBot = L.deckBot - L.railDepthF;
  const gapBeamRail = railBot - L.beamF.top;
  const gapKing = L.king.bot - plateTop;
  const jointBot = L.deckBot - p.crossmemberDepthIn;
  const gapJoist = jointBot - L.tongue.z1;
  const tireClear = L.steer.clearAtLock;
  const ds: Detail[] = [
    detail('tire to the side of the body at full lock (both directions)', tireClear, 'in', p.steerClearIn, '>='),
    detail('axle beam top to the underside of the shallow rails', gapBeamRail, 'in', PART_CLEAR_IN, '>='),
    detail('clamp plates (tops) to the king beam underside', gapKing, 'in', PART_CLEAR_IN, '>='),
    detail('tongue plate top to the end joist underside', gapJoist, 'in', PART_CLEAR_IN, '>='),
    detail('tongue plate to the steering stop blocks (plan gap over the swing)', gapTongue, 'in', PART_CLEAR_IN, '>='),
    detail('clamp plates to the steering stop blocks (plan gap over the swing)', gapPlates, 'in', PART_CLEAR_IN, '>='),
  ];
  const g = governing(ds, '');
  const how = `Tire: inner corner clearance to the body side at ${f(p.steerLockDeg, 0)}° lock = (track/2 - tire/2) cos(lock) - r sin(lock) - body/2 = ${f(tireClear, 2)}" (needs ${f(p.steerClearIn, 2)}"; same both ways; minimum track ${f(L.steer.minTrack, 1)}"). `
    + `Beam: top ${f(L.beamF.top, 3)}" vs the rails' shallow underside ${f(railBot, 3)}" (${f(L.railDepthF, 3)}" deep ahead of x = ${f(L.railStepX, 1)}"): ${f(gapBeamRail, 3)}". Clamp plates: tops ${f(plateTop, 3)}", the king beam bottom ${f(L.king.bot, 4)}": ${f(gapKing, 3)}" (the plate bolt heads stand above the plate tops: check them against the king beam and the joists; no plate passes under the end joist within the lock). Tongue plate top ${f(L.tongue.z1, 4)}" vs the end joist underside ${f(jointBot, 3)}": ${f(gapJoist, 3)}". `
    + `In plan, over the swing to ±${f(aMax * DEG, 1)}° the tongue plate (head ${f(p.tongueHeadWidthIn, 1)}" wide, bar ${f(p.tongueWidthIn, 1)}") comes within ${f(gapTongue, 2)}" of a stop block and the clamp plates within ${f(gapPlates, 2)}". `
    + `Stops: the beam face meets a block at ${f(sc.angle * DEG, 1)}° (lock ${f(p.steerLockDeg, 0)}°), at the block's outer end |y| ${f(sc.y, 2)}". Assumed minimum running gap ${f(PART_CLEAR_IN, 3)}" for steel past wood. Ground clearance (info): the axle beam bottom is ${f(L.beamF.bot, 3)}" off the ground, but the kingpin head and its plate washer hang about 0.45" below it, ${f(L.beamF.bot - 0.45, 3)}" up (under the ${f(p.minGroundClearanceIn, 1)}" rule; the model test exempts them).`;
  return singleCheck({
    id: 'steer-clear', label: 'Steering clearances at full lock (tires, plates, tongue, stops)', group: 'Steering', refs: ['D-56'],
    value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, details: ds, how,
  });
}

export function frontChecks(ctx: Ctx): AnalysisCheck[] {
  return [kingpinCheck(ctx), kingBearingCheck(ctx), frontBeamCheck(ctx), frontStubCheck(ctx), steerStopsCheck(ctx), kingBeamCheck(ctx), steerClear(ctx)];
}
