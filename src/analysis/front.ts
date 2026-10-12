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
import { tongueOutline } from '../model/pivot';
import { uncTensileArea } from './nds';
import { rectSection } from './beams';
import { axleHoleDetails, axleHoleText, axleSection, axleUltimate, axleWhat, axleYield, type AxleLoads } from './axle';
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

/** Minimum running gap (in) between a part that turns with the axle and a fixed part (steel past wood), other than the tires (those use `steerClearIn`). */
export const PART_CLEAR_IN = 0.125;
/** Friction coefficient of UHMW sliding on oak (dry, with some sand: assumed). */
export const UHMW_MU = 0.25;
/** Largest steering friction, as a fraction of the design pull, that the pullers can overcome without noticing (assumed). */
export const STEER_FRICTION_FRAC_MAX = 0.1;
/** Largest running gap (in) between a roll pad and the rail (assumed): more lets the axle roll before the pad bears. */
export const PAD_GAP_MAX_IN = 0.125;
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

// ── roll pads and the thrust disc (D-58) ────────────────────────────────────────────────────────────────────────

/** |y| band (inner, outer) of the frame rail at x: the rails follow the hull's plan turn-in toward the bow (D-57). */
export function railBandAt(ctx: Ctx, x: number): [number, number] {
  const { p, L } = ctx;
  const outer = p.bodyWidthIn / 2 - L.turnIn(x);
  return [outer - p.railThicknessIn, outer];
}

export interface PadPatch {
  /** Smallest overlap (in2) of one roll pad with the rail underside over the steering range, and the steering angle (deg) where it happens. */
  minArea: number;
  minAreaDeg: number;
  /** Largest vertical pad force per unit roll moment (1/in): max over the swing of cos(a) / (y of the contact centroid). */
  kP: number;
  /** Largest pad pressure per unit roll moment (1/in3): max of kP / overlap area. */
  kq: number;
  /** Smallest |y| of the contact centroid (in), the pad's lever about the fore-aft axis. */
  yMin: number;
  /** x range swept by the pad over the steering range, and whether it stays on the shallow part of the rail (x >= railStepX) and ahead of the rail's end (x <= railEnd). */
  xMin: number;
  xMax: number;
  onRail: boolean;
}

/**
 * Where a roll pad meets the frame rail: the pad rectangle (rollPadWidthIn x rollPadLenIn, centered rollPadRadiusIn from the kingpin along the axle beam) is turned through the steering
 * range and intersected with the rail's underside (the rail band at each x, ahead of the rail step and behind the rail's end at the bow bulkhead). Gridded, so the overlap is
 * honest at every angle, including where the rail curves in toward the bow.
 */
export function rollPadPatch(ctx: Ctx): PadPatch {
  const { p, L } = ctx;
  const R = p.rollPadRadiusIn, w = p.rollPadWidthIn, l = p.rollPadLenIn;
  const kx = L.king.x, lock = L.steer.lock;
  const N = 36, steps = 20;
  let minArea = Infinity, minDeg = 0, kP = 0, kq = 0, yMin = Infinity, xMin = Infinity, xMax = -Infinity, misses = false;
  for (let i = -steps; i <= steps; i++) {
    const a = (lock * i) / steps, c = Math.cos(a), s = Math.sin(a);
    let n = 0, sy = 0;
    for (const [u, v] of [[-w / 2, R - l / 2], [w / 2, R - l / 2], [w / 2, R + l / 2], [-w / 2, R + l / 2]]) {
      const x = kx + u * c - v * s;
      xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
    }
    for (let iu = 0; iu < N; iu++) for (let iv = 0; iv < N; iv++) {
      const u = -w / 2 + ((iu + 0.5) * w) / N, v = R - l / 2 + ((iv + 0.5) * l) / N;
      const x = kx + u * c - v * s, y = u * s + v * c;
      if (x > L.railEnd || x < L.railStepX) continue;
      const [yi, yo] = railBandAt(ctx, x);
      if (y >= yi && y <= yo) { n++; sy += y; }
    }
    const area = (n * w * l) / (N * N);
    if (area < minArea) { minArea = area; minDeg = a * DEG; }
    if (n === 0) { misses = true; continue; } // the pad is off the rail at this angle: it holds nothing here (the row fails on `onRail`, and rollShare gives the roll to the kingpin)
    const ybar = sy / n;
    yMin = Math.min(yMin, ybar);
    const k = Math.cos(a) / ybar;
    kP = Math.max(kP, k);
    kq = Math.max(kq, k / area);
  }
  if (!Number.isFinite(yMin)) yMin = R;
  return { minArea, minAreaDeg: minDeg, kP, kq, yMin, xMin, xMax, onRail: !misses && xMin >= L.railStepX - 1e-9 && xMax <= L.railEnd + 0.25 && minArea > 0.5 };
}

/** Running gap (in) between the top of a roll pad and the rail bottom over the swing (the rail is railDepthFront deep where the beam passes under it). */
export function rollPadGap(ctx: Ctx): number {
  const { p, L } = ctx;
  return L.deckBot - L.railDepthF - (L.beamF.top + p.rollPadThickIn);
}

/** The thrust disc: its annulus, and the part of it that touches the axle beam top (a strip as wide as the beam, whatever the steering angle: the disc is round). */
export function discOf(ctx: Ctx) {
  const { p, L } = ctx;
  const R = p.kingThrustOdIn / 2, r = (p.kingpinDiaIn + 0.06) / 2;
  const hw = Math.min(R, L.beamF.thick / 2);
  const n = 400;
  let Ac = 0;
  for (let i = 0; i < n; i++) {
    const x = -hw + ((i + 0.5) * 2 * hw) / n;
    const half = Math.sqrt(Math.max(0, R * R - x * x)), hole = Math.abs(x) < r ? Math.sqrt(r * r - x * x) : 0;
    Ac += 2 * (half - hole) * ((2 * hw) / n);
  }
  const A = Math.PI * (R * R - r * r);
  return { R, r, A, Ac, Lx: 2 * hw, Wy: Ac / (2 * hw) };
}

/**
 * A rectangular bearing patch (length Lx in the tilt direction, width Wy) loaded by a downward force N and a tilting moment M about its center line, with the kingpin (a rigid
 * tension member at the center) able to hold the unloaded side down. Within the core (e <= Lx/6) the pressure is trapezoidal; beyond it the neutral axis is the center line,
 * the compression is a triangle on one half and the bolt takes T = C - N.
 */
export function stripContact(N: number, M: number, Lx: number, Wy: number): { pEdge: number; pMean: number; bolt: number; regime: 'full contact' | 'bolt in tension' } {
  const A = Lx * Wy, m = Math.abs(M), n = Math.max(0, N);
  if (n > 0 && m <= (n * Lx) / 6 + 1e-9) return { pEdge: n / A + (6 * m) / (Wy * Lx * Lx), pMean: n / A, bolt: 0, regime: 'full contact' };
  const C = (3 * m) / Lx;
  return { pEdge: (4 * C) / (Wy * Lx), pMean: n / A, bolt: Math.max(0, C - n), regime: 'bolt in tension' };
}

const kindText = (k: StrikeKind) => (k === 'hard' ? 'HARD 2" hit' : 'NORMAL 1" bump');

/** Roll couple of a one-wheel strike shared between the roll pad on the high side and the disc: the pad takes M cos(a) / y, the kingpin holds any shortfall. */
function rollShare(pad: PadPatch, l: FrontLoad, disc?: { Lx: number; Wy: number }) {
  // A pad that is off the rail at some steering angle cannot be counted on: the whole roll couple goes to the kingpin through the disc (the old D-56 load path); the row fails on `onRail`.
  if (!pad.onRail && disc) return { P: 0, pressure: 0, hold: stripContact(l.N, l.roll, disc.Lx, disc.Wy).bolt };
  const P = pad.kP * l.roll;
  const pressure = pad.kq * l.roll;
  const hold = Math.max(0, P - l.N); // the pad force exceeds the whole axle load: the nut holds the rest
  return { P, pressure, hold };
}

// ── kingpin ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function kingpinCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const kd = p.kingpinDiaIn;
  const As = (Math.PI * kd * kd) / 4, At = uncTensileArea(kd), Z = (Math.PI * kd ** 3) / 32;
  const SF = p.steelSafetyFactor, FS = p.failSafeFactor;
  const allowN = p.grade8BoltYieldPsi / SF, allowH = p.grade8BoltUltimatePsi / FS;
  const pad = rollPadPatch(ctx);
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
    // (i) tow pull at the tie (design pull x overload factor): shear Th through the kingpin; the vertical part lifts the nose and tips the axle about the disc.
    // The nose-up tilt of the vertical pull is a couple the bolt shares with the axle beam hole (its top-front and bottom-rear edges bear on the bolt, 0.8 of the depth apart).
    const Mtilt = ld.Tv * pitchArm;
    const sTow = vm(ld.Th, Math.max(armTow, Mtilt / ld.Th), 0); // the couple lives inside the beam hole, the shear moment above it at the king beam: the larger of the two bends the bolt
    const bearTilt = (ld.Th / 2 + Mtilt / (0.8 * L.beamF.depth)) / (kd * 0.4 * L.beamF.depth);
    const n = frontLoad(ctx, c, 'normal'), h = frontLoad(ctx, c, 'hard');
    // (ii) bump while towing: the design pull plus the fore-aft bump force in shear; the part of the roll couple the pads cannot carry as tension.
    const dsc = discOf(ctx);
    const rn = rollShare(pad, n, dsc), rh = rollShare(pad, h, dsc);
    const sN = vm(p.pullForceLbf + n.H, armWheel, rn.hold);
    const sH = vm(p.pullForceLbf + h.H, armWheel, rh.hold);
    // hole bearing (bolt in an oak hole, perpendicular to grain, the bolt's shear on the member depth): the king beam and the axle beam
    const al = allowables(ctx);
    const bearN = (p.pullForceLbf + n.H) / (kd * L.king.depth), bearH = (p.pullForceLbf + h.H) / (kd * L.king.depth);
    const bearBeamN = (p.pullForceLbf + n.H) / (kd * L.beamF.depth), bearBeamH = (p.pullForceLbf + h.H) / (kd * L.beamF.depth);
    const bearBeamTow = ld.Th / (kd * L.beamF.depth);
    const ds: Detail[] = [
      detail('tow pull at the tie (x overload): bolt shear + bending + nut tension, von Mises (grade 8 yield / SF)', sTow.vm, 'psi', allowN, '<='),
      detail('NORMAL 1" bump at walking pace (+ the design pull): shear + bending + roll-couple tension, von Mises', sN.vm, 'psi', allowN, '<='),
      detail('HARD 2" hit (+ the design pull): shear + bending + roll-couple tension, von Mises (grade 8 ultimate / fail-safe factor)', sH.vm, 'psi', allowH, '<='),
      detail('NORMAL: bolt bearing in the oak king beam hole (dowel bearing)', bearN, 'psi', al.oakDowel, '<='),
      detail('HARD: bolt bearing in the oak king beam hole (no wood safety factor)', bearH, 'psi', al.oakDowel * p.woodSafetyFactor, '<='),
      detail('tow pull at the tie (x overload): bolt bearing in the oak axle beam hole', bearBeamTow, 'psi', al.oakDowel, '<='),
      detail('tow pull tilt (the nose-up couple on the bolt through the beam hole): hole edge bearing in the oak axle beam', bearTilt, 'psi', al.oakDowel, '<='),
      detail('NORMAL: bolt bearing in the oak axle beam hole', bearBeamN, 'psi', al.oakDowel, '<='),
      detail('HARD: bolt bearing in the oak axle beam hole (no wood safety factor)', bearBeamH, 'psi', al.oakDowel * p.woodSafetyFactor, '<='),
    ];
    const how = `Grade 8 kingpin ${f(kd, 3)}" (shank ${f(As, 3)} in2, threaded tensile area ${f(At, 3)} in2, Z = ${f(Z, 4)} in3); yield ${f(p.grade8BoltYieldPsi, 0)} / ${SF} = ${f(allowN, 0)} psi, ultimate ${f(p.grade8BoltUltimatePsi, 0)} / ${FS} = ${f(allowH, 0)} psi. `
      + `D-58: the kingpin only LOCATES the axle. The vertical load goes through the UHMW disc and the roll of a one-wheel bump through the roll pads (king-bearing row), so the bolt carries the horizontal forces and only the roll shortfall as tension. `
      + `TOW: ${f(p.pullForceLbf)} lbf x ${p.bridleTieOverloadFactor} = ${f(ld.T)} lbf at the tie, ${f(ld.Th)} lbf horizontal through the bolt in shear (bending over ${f(armTow, 2)}", from the middle of the ${f(L.tongue.z1 - L.tongue.z0, 2)}" oak tongue and beam to the middle of the ${f(L.king.depth, 2)}" king beam) and ${f(ld.Tv)} lbf up at ${f(pitchArm, 1)}" ahead of the pin: a nose-up couple ${f(Mtilt)} lb.in that the bolt resists with the edges of the beam hole (${f(bearTilt, 0)} psi on the hole edges) and bends it (the larger of this couple and the shear moment over the king beam arm): sigma ${f(sTow.sig, 0)}, tau ${f(sTow.tau, 0)}, von Mises ${f(sTow.vm, 0)} psi (the disc edge shares part of it, not counted). `
      + `${bumpText(n.strike, 'Front 1" bump', p)}: fore-aft ${f(n.H)} lbf + design pull ${f(p.pullForceLbf)} = ${f(p.pullForceLbf + n.H)} lbf shear (arm ${f(armWheel, 2)}" from the axle line to the king beam middle); roll moment ${f(n.roll)} lb.in goes to the pad (${f(rn.P)} lbf), kingpin tension ${f(rn.hold)} lbf = ${f(rn.hold / At, 0)} psi; von Mises ${f(sN.vm, 0)} psi. `
      + `${kindText('hard')}: ${bumpText(h.strike, 'Front hard hit', p)}; shear ${f(p.pullForceLbf + h.H)} lbf, roll moment ${f(h.roll)} lb.in (pad ${f(rh.P)} lbf), tension ${f(rh.hold)} lbf: von Mises ${f(sH.vm, 0)} psi. `
      + `Hole bearing ${f(bearN, 0)} / ${f(bearH, 0)} psi in the king beam and ${f(bearBeamN, 0)} / ${f(bearBeamH, 0)} psi in the ${f(L.beamF.depth, 2)}" axle beam (tow ${f(bearBeamTow, 0)}).`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'kingpin', label: 'Kingpin bolt (grade 8): tow pull, bump shear and roll tension', group: 'Structure', refs: ['D-56', 'D-47', 'D-55', 'D-58'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── king bearing (thrust disc, roll pads and the oak under them) ────────────────────────────────────────────────

export function kingBearingCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const disc = discOf(ctx);
  const pad = rollPadPatch(ctx);
  const allow = p.steerBearingAllowPsi;
  const kd = p.kingpinDiaIn;
  const nutOd = NUT_WASHER_OD_X * kd;
  const nutA = (Math.PI / 4) * (nutOd * nutOd - (kd + 1 / 16) ** 2);
  const ld = tieLoad(ctx);
  const pitchArm = L.tongue.holeX - L.king.x;
  const gap = rollPadGap(ctx);
  const padA = p.rollPadWidthIn * p.rollPadLenIn;
  const ev = (c: CaseData): CaseEval => {
    const w = wheelLoads(ctx, c);
    const n = frontLoad(ctx, c, 'normal'), h = frontLoad(ctx, c, 'hard');
    const rn = rollShare(pad, n, disc), rh = rollShare(pad, h, disc);
    const towP = (w.frontAxle + ld.Tv) / disc.Ac;
    const stat = w.frontAxle / disc.Ac;
    const uniN = n.N / disc.Ac, uniH = h.N / disc.Ac;
    const nutN = rn.hold / nutA, nutH = rh.hold / nutA;
    const fricLbf = (UHMW_MU * w.frontAxle * 0.67 * disc.R) / Math.max(1, pitchArm);
    const ds: Detail[] = [
      detail('static front axle load on the UHMW disc (mean pressure over the part that touches the beam top)', stat, 'psi', allow, '<='),
      detail('static: the same pressure on the oak of the axle beam top and the king beam (oak perpendicular)', stat, 'psi', al.oakPerp, '<='),
      detail('NORMAL 1" bump: mean pressure on the disc (static + the struck wheel\'s bump force, the roll couple is on the pads)', uniN, 'psi', allow, '<='),
      detail('NORMAL: the same on the oak (oak perpendicular, design)', uniN, 'psi', al.oakPerp, '<='),
      detail('HARD 2" hit: mean pressure on the disc (2 x the static allowable)', uniH, 'psi', 2 * allow, '<='),
      detail('HARD: the same on the oak (no wood safety factor)', uniH, 'psi', al.oakPerp * p.woodSafetyFactor, '<='),
      detail('NORMAL 1" bump, one wheel: pressure of the pad on the rail underside (oak perpendicular, design)', rn.pressure, 'psi', al.oakPerp, '<='),
      detail('HARD 2" hit, one wheel: pressure of the pad on the rail underside (no wood safety factor)', rh.pressure, 'psi', al.oakPerp * p.woodSafetyFactor, '<='),
      detail('NORMAL, one wheel: the pad on the axle beam top (its full area, oak perpendicular)', rn.P / padA, 'psi', al.oakPerp, '<='),
      detail('HARD, one wheel: the pad on the axle beam top (no wood safety factor)', rh.P / padA, 'psi', al.oakPerp * p.woodSafetyFactor, '<='),
      detail('NORMAL: nut washer bearing on the oak slot ceiling if the pad cannot hold the whole roll (oak perpendicular)', nutN, 'psi', al.oakPerp, '<='),
      detail('HARD: nut washer bearing on the oak slot ceiling (no wood safety factor)', nutH, 'psi', al.oakPerp * p.woodSafetyFactor, '<='),
      detail('tow pull (x overload) with its vertical part: mean pressure on the oak under the disc (the nose-up couple is on the kingpin, see the kingpin row)', towP, 'psi', al.oakPerp, '<='),
      detail('running gap between a pad top and the rail bottom (not too tight: the axle must swing free)', gap, 'in', p.rollPadGapMinIn, '>='),
      detail('running gap between a pad top and the rail bottom (not too loose: the pad must catch the roll)', gap, 'in', PAD_GAP_MAX_IN, '<='),
      detail('the pads stay under the shallow part of the rail over the whole steering range (worst overlap area; 0 = a pad leaves the rail)', pad.onRail ? pad.minArea : 0, 'in2', 0.5, '>='),
      detail('steering effort: UHMW disc friction (mu 0.25) at the static load, as a sideways force at the shackle', fricLbf, 'lbf', STEER_FRICTION_FRAC_MAX * p.pullForceLbf, '<='),
    ];
    const how = `D-58: the roll of the axle (the high wheel pushes up, the low wheel less) is carried by two UHMW slide pads on the axle beam top, ${f(p.rollPadRadiusIn, 2)}" either side of the kingpin, under the frame rails; the kingpin and the disc only locate and carry the vertical load. `
      + `Thrust disc: ${f(p.kingThrustOdIn, 2)}" OD x ${f(kd + 0.06, 3)}" bore x ${f(p.kingThrustThickIn, 3)}" UHMW, screwed to the king beam, turning on the beam top; it touches ${f(disc.Ac, 2)} in2 of it (the beam is ${f(L.beamF.thick, 2)}" wide); allowable ${f(allow, 0)} psi (steerBearingAllowPsi, verify with the supplier). `
      + `Static front axle ${f(w.frontAxle)} lb: ${f(stat, 0)} psi. ${bumpText(n.strike, 'Front 1" bump', p)}: struck wheel ${f(n.F1)} lbf + other wheel ${f(n.F2)} lbf = N ${f(n.N)} lbf, ${f(uniN, 0)} psi mean on the disc and the oak (design ${f(al.oakPerp, 0)} = ${p.oakCompPerpPsi} x C_M ${p.wetServiceFactorCompPerp} / ${p.woodSafetyFactor}). `
      + `One-wheel roll: M = (F1 - F2) x track/2 = (${f(n.F1)} - ${f(n.F2)}) x ${f(p.frontTrackIn / 2, 2)} = ${f(n.roll)} lb.in; the pad on the high side meets the rail with M cos(a) / y = ${f(rn.P)} lbf (lever y >= ${f(pad.yMin, 1)}" over the steering range), spread over the part of the pad that is under the rail (at least ${f(pad.minArea, 2)} in2 of the ${f(padA, 2)} in2 pad, at ${f(pad.minAreaDeg, 0)} deg of steering: the rail is ${f(p.railThicknessIn, 2)}" wide and curves in toward the bow): ${f(rn.pressure, 0)} psi on the rail underside (design ${f(al.oakPerp, 0)}); ${rn.hold > 0 ? `the pad force exceeds the whole axle load, the nut holds the rest (${f(rn.hold)} lbf)` : 'the whole axle load is more than the pad force, so the kingpin holds nothing'}. `
      + `Hard hit: ${bumpText(h.strike, 'Front hard hit', p)}; N ${f(h.N)} lbf, M ${f(h.roll)} lb.in, pad ${f(rh.P)} lbf, ${f(rh.pressure, 0)} psi on the rail (allow ${f(al.oakPerp * p.woodSafetyFactor, 0)} with no wood safety factor)${rh.hold > 0 ? `, nut hold-down ${f(rh.hold)} lbf` : ''}. `
      + `Tow pull: the vertical ${f(ld.Tv)} lbf at ${f(pitchArm, 1)}" ahead of the pin tilts the axle nose-up by ${f(ld.Tv * pitchArm)} lb.in; that couple is resisted by the kingpin through the hole in the axle beam (kingpin row), the disc carries ${f(towP, 0)} psi. `
      + `Running gap: the rail bottom is ${f(L.deckBot - L.railDepthF - L.beamF.top, 3)}" over the beam top and the pad is ${f(p.rollPadThickIn, 4)}" thick, so ${f(gap, 3)}" (between ${f(p.rollPadGapMinIn, 2)}" and ${f(PAD_GAP_MAX_IN, 3)}", set with tape under the pad): about ${f(Math.atan(gap / pad.yMin) * DEG, 2)} deg of roll before a pad bears. ${pad.onRail ? '' : `The pad swings from x = ${f(pad.xMin, 1)}" to ${f(pad.xMax, 1)}" and leaves the rail (steps at ${f(L.railStepX, 1)}", ends at ${f(L.railEnd, 1)}"). `}`
      + `Steering friction: the disc bears the static load, so the UHMW friction torque (mu ${UHMW_MU}) is about ${f(UHMW_MU * w.frontAxle * 0.67 * disc.R)} lb.in = ${f(fricLbf)} lbf at the shackle (limit ${f(STEER_FRICTION_FRAC_MAX * p.pullForceLbf)} lbf = ${f(STEER_FRICTION_FRAC_MAX * 100, 0)}% of the design pull); while a pad bears it is higher but only for the moment of the bump.`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'king-bearing', label: 'Roll pads, thrust disc and the oak under them', group: 'Structure', refs: ['D-56', 'D-55', 'D-58'], primary: 'goal', ...evalBoth(ctx, ev) });
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
  const sec = axleSection(p);
  const E = p.steelMoePsi;
  const yw = p.frontTrackIn / 2;
  const a = Math.max(0.01, yw - L.beamF.len / 2); // from the beam end (where the groove ends) to the hub center
  const allowN = axleYield(p) / p.steelSafetyFactor, allowH = axleUltimate(p) / p.failSafeFactor;
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
    const hole: AxleLoads = { Rn, Rh, Tn: p.tireGroundMu * Pst, Th: p.tireGroundMu * h.F1, stations: 2 };
    ds.push(...axleHoleDetails(ctx, hole, allowN, allowH));
    const how = `Front stub axle ${axleWhat(p)} bolted down in the beam end, free end carrying the wheel: cantilever a = ${f(a, 2)}" from the beam end (${f(L.beamF.len / 2, 3)}") to the hub center (${f(yw, 3)}"). ${bumpText(n.strike, 'Front 1" bump', p)}; with the static wheel load still on the tire V_total = ${f(n.F1)} lbf, resultant ${f(Rn)} lbf: sigma = ${f(sN, 0)} psi vs ${f(allowN, 0)} (yield ${f(axleYield(p), 0)} / SF ${p.steelSafetyFactor}). ${bumpText(h.strike, 'Hard hit', p)}; resultant ${f(Rh)} lbf: ${f(sH, 0)} psi vs ${f(allowH, 0)} (ultimate ${f(axleUltimate(p), 0)} / ${p.failSafeFactor}). Cornering skid H = mu P_static = ${f(Hs)} lbf at r ${f(wheelR, 2)}" (worst angle ${f(psiW, 0)} deg): ${f(sSkid, 0)} psi; static tip deflection ${defl.toFixed(4)}". ${axleHoleText(ctx, hole)}`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'front-stub', label: 'Front stub axle bending (bump basis)', group: 'Structure', refs: ['D-56', 'D-4', 'D-50', 'D-55', 'D-60'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── steering stops: the check chains (D-58) ───────────────────────────────────────────────────────────────────────

/** Eye-bolt rating factor for a pull at `thetaDeg` off the shank axis in the plane of the eye (shoulder-type forged eye bolt): 1 in line, 0.6 at 45 degrees, no less than 0.3 (assumed, vendor tables). */
export const eyeAngleFactor = (thetaDeg: number): number => Math.max(0.3, 1 - (0.4 * thetaDeg) / 45);
/** Ultimate load of a forged eye bolt or chain as a multiple of its working load limit (the usual 5 : 1 and 4 : 1). */
export const EYE_ULT_MULT = 5;
export const CHAIN_ULT_MULT = 4;
/** Area (in2) of the 2 in OD fender washer under an eye bolt nut or shoulder, net of the bolt hole. */
const eyeWasherA = (d: number) => (Math.PI / 4) * (2 ** 2 - (d + 1 / 16) ** 2);

/**
 * The taut chain at full lock (the RIGHT chain at +lock; the left is the mirror): the geometry that turns the stop torque about the kingpin into the chain tension, and the
 * direction the pull has on the beam eye (in the beam's own frame) and on the anchor eye (world).
 */
export function chainGeom(ctx: Ctx) {
  const { L } = ctx;
  const lock = L.steer.lock;
  const A = L.chain.anchor, B = L.steer.beamEyeAt(lock);
  const v = [A[0] - B[0], A[1] - B[1], A[2] - B[2]];
  const len = Math.hypot(v[0], v[1], v[2]);
  const plan = Math.hypot(v[0], v[1]);
  const el = Math.atan2(v[2], plan);
  const up = [v[0] / plan, v[1] / plan];
  const lever = Math.abs((L.king.x - B[0]) * up[1] - (0 - B[1]) * up[0]); // perpendicular distance from the kingpin to the chain line, in plan
  const d = [v[0] / len, v[1] / len, v[2] / len];
  // pull on the BEAM eye (toward A), in the beam frame: rotate the world vector by -lock
  const du = d[0] * Math.cos(lock) + d[1] * Math.sin(lock), dv = -d[0] * Math.sin(lock) + d[1] * Math.cos(lock), dz = d[2];
  return { A, B, len, plan, el, lever, d, du, dv, dz, lock };
}

/** Worst steering-torque cases about the kingpin (lb.in): a 1 in bump H, a dragged wheel, a sideways yank of the rope (normal) and the 2 in hit H (hard). */
function stopTorques(ctx: Ctx, c: CaseData) {
  const { p, L } = ctx;
  const yw = p.frontTrackIn / 2;
  const ld = tieLoad(ctx);
  const arm = L.tongue.holeX - L.king.x;
  const n = frontLoad(ctx, c, 'normal'), h = frontLoad(ctx, c, 'hard');
  const Tn = n.H * yw;
  const Tf = p.tireGroundMu * n.static.frontWheel * yw; // one front wheel dragged on the ground
  const Ty = ld.Th * arm * Math.sin(ld.lock); // a lateral yank of the rope at the lock angle
  return { n, h, Tn, Tf, Ty, TnWorst: Math.max(Tn, Tf, Ty), Th: h.H * yw, yw, ld, arm };
}

export function stopContact(ctx: Ctx): { angle: number; y: number } {
  const g = chainGeom(ctx);
  return { angle: g.lock, y: Math.abs(g.B[1]) };
}

export function steerStopsCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const cg = chainGeom(ctx);
  const d = p.steerEyeBoltDiaIn;
  const washA = eyeWasherA(d);
  const WLL = p.steerChainWllLb, FS = p.failSafeFactor;
  const eyeW = p.steerEyeWllLb;
  const beamT = L.beamF.thick, jT = L.chain.joistT, jD = p.crossmemberDepthIn;
  const thEye = Math.acos(Math.min(1, Math.abs(cg.du))) * DEG; // pull angle off the shank axis at the beam eye
  const thAnc = Math.acos(Math.min(1, Math.abs(cg.d[0]))) * DEG; // ... at the anchor eye
  const capBeamEye = eyeW * eyeAngleFactor(thEye), capAncEye = eyeW * eyeAngleFactor(thAnc);
  const jHalf = L.steer.railYIn - L.turnIn(L.chain.joistX); // the chain joist's half span (rail inner face)
  const anchorY = Math.abs(L.chain.anchor[1]);
  const kArm = Math.max(0.5, jHalf - anchorY); // the anchor to the rail
  const kSplan = (jD * jT ** 2) / 6; // plan bending of the chain joist (weak axis)
  const kSvert = (Math.max(0.5, jT - d) * jD ** 2) / 6; // vertical bending, net of the eye bolt hole
  const kEndA = jT * jD;
  const FvEnd = al.oakShear / 2; // cross-grain glue of the king beam to the rail face: half the design shear
  const ev = (c: CaseData): CaseEval => {
    const t = stopTorques(ctx, c);
    const chainT = (torque: number) => torque / cg.lever / Math.cos(cg.el); // the torque is carried by the plan component of the chain pull
    const Tn = chainT(t.TnWorst), Th = chainT(t.Th);
    const row = (T: number) => ({
      axial: Math.abs(cg.du) * T, lat: Math.abs(cg.dv) * T, vert: Math.abs(cg.dz) * T, // on the beam eye
      fx: Math.abs(cg.d[0]) * T, fy: Math.abs(cg.d[1]) * T, fz: Math.abs(cg.d[2]) * T, // on the anchor eye (world)
    });
    const rn = row(Tn), rh = row(Th);
    const holeBeam = (r: ReturnType<typeof row>) => Math.hypot(r.lat, r.vert) / (d * beamT); // hole bearing in the beam (lateral ∥ and vertical ⟂ grain: mixed, taken at the ⟂ allowable)
    const holeKing = (r: ReturnType<typeof row>) => Math.hypot(r.fy, r.fz) / (d * jT);
    const Mplan = (r: ReturnType<typeof row>) => (r.fx * kArm) / kSplan;
    const Mvert = (r: ReturnType<typeof row>) => (r.fz * kArm) / kSvert;
    const ds: Detail[] = [
      detail('NORMAL (worst of 1" bump H, dragged wheel, puller yank): chain tension vs its working load limit', Tn, 'lbf', WLL, '<='),
      detail('HARD 2" hit: chain tension (ultimate = 4 x the working load limit, / fail-safe factor)', Th, 'lbf', (CHAIN_ULT_MULT * WLL) / FS, '<='),
      detail('NORMAL: beam eye bolt, pull vs its rating at the angle off the shank axis', Tn, 'lbf', capBeamEye, '<='),
      detail('HARD: beam eye bolt (ultimate = 5 x the angled rating, / fail-safe factor)', Th, 'lbf', (EYE_ULT_MULT * capBeamEye) / FS, '<='),
      detail('NORMAL: anchor eye bolt, pull vs its rating at the angle off the shank axis', Tn, 'lbf', capAncEye, '<='),
      detail('HARD: anchor eye bolt (ultimate = 5 x the angled rating, / fail-safe factor)', Th, 'lbf', (EYE_ULT_MULT * capAncEye) / FS, '<='),
      detail('NORMAL: beam eye nut washer on the front face of the axle beam (oak perpendicular)', rn.axial / washA, 'psi', al.oakPerp, '<='),
      detail('HARD: beam eye nut washer on the axle beam (no wood safety factor)', rh.axial / washA, 'psi', al.oakPerp * p.woodSafetyFactor, '<='),
      detail('NORMAL: beam eye hole bearing (oak, lateral and vertical parts)', holeBeam(rn), 'psi', al.oakDowel, '<='),
      detail('HARD: beam eye hole bearing (no wood safety factor)', holeBeam(rh), 'psi', al.oakDowel * p.woodSafetyFactor, '<='),
      detail('NORMAL: anchor eye nut washer on the rear face of the chain joist (oak perpendicular)', rn.fx / washA, 'psi', al.oakPerp, '<='),
      detail('HARD: anchor eye nut washer on the chain joist (no wood safety factor)', rh.fx / washA, 'psi', al.oakPerp * p.woodSafetyFactor, '<='),
      detail('NORMAL: anchor eye hole bearing in the chain joist (oak)', holeKing(rn), 'psi', al.oakDowel, '<='),
      detail('HARD: anchor eye hole bearing in the chain joist (no wood safety factor)', holeKing(rh), 'psi', al.oakDowel * p.woodSafetyFactor, '<='),
      detail('NORMAL: chain joist plan bending from the chain pull at the anchor (weak axis)', Mplan(rn), 'psi', al.oakBend, '<='),
      detail('HARD: chain joist plan bending (no wood safety factor)', Mplan(rh), 'psi', al.oakBend * p.woodSafetyFactor, '<='),
      detail('NORMAL: chain joist vertical bending from the vertical part of the pull (net of the eye bolt hole)', Mvert(rn), 'psi', al.oakBend, '<='),
      detail('NORMAL: chain joist end glue / Domino joint to the rail (cross-grain, half the design shear)', Math.hypot(rn.fx, rn.fz) / kEndA, 'psi', FvEnd, '<='),
      detail('HARD: chain joist end joint to the rail (no wood safety factor)', Math.hypot(rh.fx, rh.fz) / kEndA, 'psi', FvEnd * p.woodSafetyFactor, '<='),
    ];
    const how = `D-58: the steering lock is set by two check chains (the oak stop blocks of D-56 hung 1" below a 3/4" joist: a 1.4 kip hard-hit torque at that lever pried the joist underside to 4-10x its bearing stress). An eye bolt goes fore-aft through each end of the axle beam (${f(p.steerChainBeamYIn, 1)}" from the kingpin, the eye ${f(L.chain.stand, 1)}" behind the trailing face) and one through the ${f(jT, 1)}" chain joist just behind the king beam (${f(anchorY, 1)}" off the center line, the eye on its front face at x = ${f(L.chain.anchor[0], 1)}"). The chain runs back under the king beam. `
      + `A ${f(cg.len, 2)}" chain between the eye rings goes taut exactly at the ${f(p.steerLockDeg, 0)}° lock (right chain turning left, left chain turning right; the other hangs slack: ${f(cg.len - Math.hypot(...[0, 1, 2].map((i) => L.steer.beamEyeAt(0)[i] - L.chain.anchor[i])), 1)}" of slack straight ahead). At the lock the chain runs ${f(cg.plan, 2)}" in plan and rises ${f(cg.el * DEG, 0)}°; its line passes ${f(cg.lever, 2)}" from the kingpin, so a torque T about the kingpin gives a chain tension T / ${f(cg.lever, 2)} / cos ${f(cg.el * DEG, 0)}°. `
      + `Torque about the kingpin (lever track/2 = ${f(t.yw, 2)}"): ${bumpText(t.n.strike, 'Front 1" bump', p)} gives H ${f(t.n.H)} lbf x ${f(t.yw, 2)} = ${f(t.Tn)} lb.in; a front wheel dragged on the ground mu P = ${f(p.tireGroundMu * t.n.static.frontWheel)} lbf -> ${f(t.Tf)} lb.in; the pullers yanking the tongue at full lock (${f(t.ld.Th)} lbf x sin ${f(t.ld.lock * DEG, 0)}° x ${f(t.arm, 1)}") -> ${f(t.Ty)} lb.in; hard hit H ${f(t.h.H)} lbf -> ${f(t.Th)} lb.in. Chain tension ${f(Tn)} lbf normal (rated ${f(WLL, 0)}), ${f(Th)} lbf hard (ultimate ${f(CHAIN_ULT_MULT * WLL, 0)} / ${FS}). `
      + `Beam eye: the chain pulls it ${f(thEye, 0)}° off the shank axis (rated ${f(capBeamEye, 0)} lbf there of ${f(eyeW, 0)} in line): the axial part ${f(rn.axial)} / ${f(rh.axial)} lbf is carried by the 2" washer and nylock nut on the front face of the beam (${f(rn.axial / washA, 0)} / ${f(rh.axial / washA, 0)} psi on ${f(washA, 2)} in2, oak perpendicular ${f(al.oakPerp, 0)}). `
      + `Anchor eye: ${f(thAnc, 0)}° off the axis; the pull ${f(rn.fx)} / ${f(rh.fx)} lbf pulls the eye forward out of the joist, held by its 2" washer and nut on the rear face (${f(rn.fx / washA, 0)} / ${f(rh.fx / washA, 0)} psi); ${f(rn.fz)} / ${f(rh.fz)} lbf vertical and ${f(rn.fy)} / ${f(rh.fy)} lbf sideways load the hole. Chain joist: the pull acts ${f(kArm, 2)}" from the rail face: plan bending ${f(Mplan(rn), 0)} / ${f(Mplan(rh), 0)} psi, vertical ${f(Mvert(rn), 0)} psi, end joint ${f(Math.hypot(rn.fx, rn.fz) / kEndA, 0)} / ${f(Math.hypot(rh.fx, rh.fz) / kEndA, 0)} psi.`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'steer-stops', label: 'Steering check chains: chain, eye bolts and chain joist anchor', group: 'Structure', refs: ['D-56', 'D-55', 'D-58'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── king beam (the crossmember) ──────────────────────────────────────────────────────────────────────────────

/** Net section of the king beam at the bolt: the hole takes the center, the nut slot (cut from the front face near the top) takes depth from the front half. */
export function kingNetSection(ctx: Ctx) {
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
  const span = 2 * (L.steer.railYIn - L.turnIn(L.king.x + L.king.len / 2)); // between the rail inner faces, which follow the bow turn-in (D-57)
  const sec = rectSection(L.king.len, L.king.depth);
  const net = kingNetSection(ctx);
  const ld = tieLoad(ctx);
  const FvEnd = al.oakShear / 2; // the beam's end grain is glued to the rail face: cross-grain, half the design shear (as the rear hangers)
  const endA = L.king.len * L.king.depth;
  const ev = (c: CaseData): CaseEval => {
    const n = frontLoad(ctx, c, 'normal'), h = frontLoad(ctx, c, 'hard');
    const w = wheelLoads(ctx, c);
    /** Simply supported between the rails: the disc pushes it up at the center with N; the tow tilt adds the nut's hold-down T at the center. D-58: the one-wheel roll couple is on the roll pads and the rails, not this beam. */
    const solve = (N: number, T: number) => {
      const R = (N - T) / 2; // each rail end carries half of the net central load
      const M = (R * span) / 2;
      return { Mnet: Math.abs(M), V: Math.abs(R), N, T };
    };
    const st = solve(w.frontAxle, 0);
    const sn = solve(n.N, 0), sh = solve(h.N, 0);
    const stow = solve(w.frontAxle + ld.Tv, 0);
    const sBend = (s: { Mnet: number }) => Math.max((s.Mnet * net.c) / net.I, (s.Mnet * sec.c) / sec.I);
    const tau = (V: number) => (1.5 * V) / sec.A;
    const end = (V: number) => V / endA;
    const ds: Detail[] = [
      detail('static front axle load at midspan: bending (net section at the kingpin and nut slot)', sBend(st), 'psi', al.oakBend, '<='),
      detail('NORMAL 1" bump (the struck wheel and the other, both through the disc): bending, net section at the nut slot', sBend(sn), 'psi', al.oakBend, '<='),
      detail('NORMAL 1" bump: shear', tau(sn.V), 'psi', al.oakShear, '<='),
      detail('NORMAL 1" bump: end glue / Domino joint to the rail (cross-grain, half the design shear)', end(sn.V), 'psi', FvEnd, '<='),
      detail('tow pull (x overload) with its vertical part: bending', sBend(stow), 'psi', al.oakBend, '<='),
      detail('HARD 2" hit: bending (MOR x C_M, no wood safety factor)', sBend(sh), 'psi', al.oakBend * p.woodSafetyFactor, '<='),
      detail('HARD 2" hit: shear (no wood safety factor)', tau(sh.V), 'psi', al.oakShear * p.woodSafetyFactor, '<='),
      detail('HARD 2" hit: end glue joint to the rail (no wood safety factor)', end(sh.V), 'psi', FvEnd * p.woodSafetyFactor, '<='),
    ];
    const how = `King beam ${f(L.king.len, 2)}" fore-aft x ${f(L.king.depth, 2)}" deep oak between the rails (span ${f(span, 2)}" between the rail faces, simply supported, the glued deck above it is not counted). The UHMW disc is screwed to its underside and pushes it up at the kingpin; the nut, in a slot cut from the front face (${f(net.slotH, 2)}" tall), pulls it down in the tow tilt. `
      + `D-58: the one-wheel roll of a bump goes into the rails through the roll pads, so this beam carries the whole axle load N at midspan. Static front axle ${f(w.frontAxle)} lb: M = ${f(st.Mnet)} lb.in. 1" strike N = ${f(n.N)} lbf: M ${f(sn.Mnet)} lb.in at the nut slot (net section: area ${f(net.A, 2)} in2, S ${f(net.S, 3)} in3) and under the disc (S ${f(sec.S, 3)}): ${f(sBend(sn), 0)} psi vs ${f(al.oakBend, 0)}; shear ${f(tau(sn.V), 0)} psi; end joint ${f(end(sn.V), 0)} psi on ${f(endA, 2)} in2. `
      + `Hard hit N = ${f(h.N)} lbf: ${f(sBend(sh), 0)} psi vs ${f(al.oakBend * p.woodSafetyFactor, 0)} (MOR x C_M), end joint ${f(end(sh.V), 0)} psi vs ${f(FvEnd * p.woodSafetyFactor, 0)}. The bearing of the oak under the disc and the nut is in the king-bearing row.`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'king-beam', label: 'King beam (oak crossmember): bending, shear and end joints', group: 'Structure', refs: ['D-56', 'D-4', 'D-50', 'D-55', 'D-58'], primary: 'goal', ...evalBoth(ctx, ev) });
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

/** Distance (in) from a plan point to a plan polygon (0 inside). */
function pointPolyDist(q: P2, poly: P2[]): number {
  if (pointInPoly(q, poly)) return 0;
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) m = Math.min(m, segDist(poly[i], poly[(i + 1) % poly.length], q));
  return m;
}

export function steerClear(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const lock = L.steer.lock;
  const kc: P2 = [L.king.x, 0];
  const rects = (ids: string[]): { poly: P2[]; z0: number; z1: number }[] => ids.map((id) => ctx.byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => {
    const b = worldAABB(x);
    return { poly: [[b.min[0], b.min[1]], [b.max[0], b.min[1]], [b.max[0], b.max[1]], [b.min[0], b.max[1]]] as P2[], z0: b.min[2], z1: b.max[2] };
  });
  const plateIds = ['L', 'R'].flatMap((s) => [1, 2, 3, 4].map((k) => `clamp-F${s}${k}`));
  const plates = rects(plateIds);
  const plateTop = Math.max(...plates.map((q) => q.z1));
  const hb = L.beamF.thick / 2;
  const padZ = [L.beamF.top, L.beamF.top + p.rollPadThickIn];
  const pads = [1, -1].map((s) => ({ poly: [[-p.rollPadWidthIn / 2, p.rollPadRadiusIn - p.rollPadLenIn / 2], [p.rollPadWidthIn / 2, p.rollPadRadiusIn - p.rollPadLenIn / 2], [p.rollPadWidthIn / 2, p.rollPadRadiusIn + p.rollPadLenIn / 2], [-p.rollPadWidthIn / 2, p.rollPadRadiusIn + p.rollPadLenIn / 2]].map(([u, v]): P2 => [L.king.x + u, s * v]), z0: padZ[0], z1: padZ[1] }));
  const tongue = { poly: tongueOutline(ctx).map(([x, y]): P2 => [x, y]), z0: L.tongue.z0, z1: L.tongue.z1 };
  const beamBody = { poly: [[L.king.x - hb, -L.beamF.len / 2], [L.king.x + hb, -L.beamF.len / 2], [L.king.x + hb, L.beamF.len / 2], [L.king.x - hb, L.beamF.len / 2]] as P2[], z0: L.beamF.bot, z1: L.beamF.top };
  const turning = [beamBody, tongue, ...plates, ...pads];
  const kingHalf = L.steer.railYIn - L.turnIn(L.king.x + L.king.len / 2);
  const kingBox = { poly: [[L.king.x - L.king.len / 2, -kingHalf], [L.king.x + L.king.len / 2, -kingHalf], [L.king.x + L.king.len / 2, kingHalf], [L.king.x - L.king.len / 2, kingHalf]] as P2[], z0: L.king.bot, z1: L.king.top };
  const R = p.kingThrustOdIn / 2;
  const discBox = { poly: [[L.king.x - R, -R], [L.king.x + R, -R], [L.king.x + R, R], [L.king.x - R, R]] as P2[], z0: L.beamF.top, z1: L.king.bot };
  // The chain at full lock (the RIGHT chain turning left; the left is the mirror and every obstacle is symmetric): the taut line from the beam eye to the anchor, against everything,
  // 3D distance less half the chain width. A slack chain hangs lower and nearer the beam, which this does not see: the check is for the taut line.
  const cg = chainGeom(ctx);
  const half = p.steerChainDiaIn * 1.5 / 2;
  let gapChain = Infinity, chainAt = '';
  const gap3 = (q: [number, number, number], o: { poly: P2[]; z0: number; z1: number }, rotate: boolean) => {
    const poly = rotate ? o.poly.map((v) => rotAbout(v, lock, kc)) : o.poly;
    const plan = pointPolyDist([q[0], q[1]], poly);
    const dz = Math.max(0, o.z0 - q[2], q[2] - o.z1);
    return Math.hypot(plan, dz) - half;
  };
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const q: [number, number, number] = [cg.B[0] + (cg.A[0] - cg.B[0]) * t, cg.B[1] + (cg.A[1] - cg.B[1]) * t, cg.B[2] + (cg.A[2] - cg.B[2]) * t];
    for (const [name, o, rot] of [['axle beam', beamBody, true], ['tongue', tongue, true], ['king beam', kingBox, false], ['thrust disc', discBox, false]] as const) {
      const g = gap3(q, o, rot);
      if (g < gapChain && !(name === 'axle beam' && i === 0)) { gapChain = g; chainAt = `${name} at ${(t * 100).toFixed(0)}% along the chain`; }
    }
    for (const o of [...plates, ...pads]) { const g = gap3(q, o, true); if (g < gapChain) { gapChain = g; chainAt = `a plate or pad at ${(t * 100).toFixed(0)}% along the chain`; } }
  }
  void turning;
  const railBot = L.deckBot - L.railDepthF;
  const gapBeamRail = railBot - L.beamF.top;
  const gapKing = L.king.bot - plateTop;
  const jointBot = L.deckBot - p.crossmemberDepthIn;
  const gapJoist = jointBot - L.tongue.z1;
  const gapDisc = L.beamF.top - L.tongue.z1;
  const tireClear = L.steer.clearAtLock;
  const ds: Detail[] = [
    detail('tire to the side of the body at full lock (both directions)', tireClear, 'in', p.steerClearIn, '>='),
    detail('axle beam top to the underside of the shallow rails', gapBeamRail, 'in', PART_CLEAR_IN, '>='),
    detail('clamp plates (tops) to the king beam underside', gapKing, 'in', PART_CLEAR_IN, '>='),
    detail('tongue top to the end joist underside', gapJoist, 'in', PART_CLEAR_IN, '>='),
    detail('tongue top to the thrust disc (the disc lies on the beam top, the tongue head turns under it)', gapDisc, 'in', PART_CLEAR_IN, '>='),
    detail('taut steering chain to everything else at full lock (3D, less the chain width)', gapChain, 'in', PART_CLEAR_IN, '>='),
  ];
  const g = governing(ds, '');
  const how = `Tire: inner corner clearance to the body side at ${f(p.steerLockDeg, 0)}° lock = (track/2 - tire/2) cos(lock) - r sin(lock) - body/2 = ${f(tireClear, 2)}" (needs ${f(p.steerClearIn, 2)}"; same both ways; minimum track ${f(L.steer.minTrack, 2)}", D-58). `
    + `Beam: top ${f(L.beamF.top, 3)}" vs the rails' shallow underside ${f(railBot, 3)}" (${f(L.railDepthF, 3)}" deep ahead of x = ${f(L.railStepX, 1)}"): ${f(gapBeamRail, 3)}". Clamp plates: tops ${f(plateTop, 3)}", the king beam bottom ${f(L.king.bot, 4)}": ${f(gapKing, 3)}" (the plate bolt heads stand above the plate tops: check them against the king beam and the joists; no plate passes under the end joist within the lock). Oak tongue top ${f(L.tongue.z1, 4)}" vs the end joist underside ${f(jointBot, 3)}": ${f(gapJoist, 3)}", and ${f(gapDisc, 3)}" below the thrust disc (which lies on the beam top). `
    + `The taut steering chain (${f(cg.len, 2)}" between the eye rings, ${f(chainGeom(ctx).lever, 2)}" lever) passes ${f(gapChain, 2)}" from the nearest other part (${chainAt}); it lies behind the king beam, so the tongue, the disc, the plates and the pads are far from it. `
    + `The axle turns freely to the lock because nothing else is in its swing (the roll pads and the clamp plates pass under the rails and the king beam, the tongue head under the end joist); the chains, not blocks, set the lock. Assumed minimum running gap ${f(PART_CLEAR_IN, 3)}" for steel past wood. Ground clearance (info): the axle beam bottom is ${f(L.beamF.bot, 3)}" off the ground, but the kingpin head and its plate washer hang about 0.45" below it, ${f(L.beamF.bot - 0.45, 3)}" up (under the ${f(p.minGroundClearanceIn, 1)}" rule; the model test exempts them).`;
  return singleCheck({
    id: 'steer-clear', label: 'Steering clearances at full lock (tires, plates, tongue, chains)', group: 'Steering', refs: ['D-56', 'D-58'],
    value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, details: ds, how,
  });
}

export function frontChecks(ctx: Ctx): AnalysisCheck[] {
  return [kingpinCheck(ctx), kingBearingCheck(ctx), frontBeamCheck(ctx), frontStubCheck(ctx), steerStopsCheck(ctx), kingBeamCheck(ctx), steerClear(ctx)];
}
