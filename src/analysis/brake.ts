/**
 * Braking checks for the handler's STEP BRAKE (Phase 3c-4b, D-57 item 8; it replaced the D-55 steel drag bar): the foot-lever ratio DERIVED from the flap geometry
 * (`brakeGeometry`, model/brake-layout.ts), the FOOT force to hold the loaded sled on the design slope, how steep a grade the flaps stop it on at the limit foot force, the
 * rear-only traction (info), the members (flap, shoe block and pad; pivot pin, ears and block; knee, mounting bolts and backer; return bungee), the wheel-chock parking hold, a
 * foot-stomp abuse check, the push-handle sockets and a sweep of the moving flap group over its stroke.
 *
 * Load path (all forces in lbf, moments in lbf·in, every row is hand-checkable from its `how` string). One flap, forces ON THE FLAP, moments about the pivot pin H, M = rz·fx − rx·fz:
 *   pad: N along the tread normal n at the contact C and friction σ μ N along the forward tangent t (σ = +1 sled rolling forward);   bungee: B at its eye E;   foot: F straight down
 *   at the foot point.    F · a_F = N (m_N + σ μ m_T) + M_B     (a_F = horizontal pin-to-foot distance; m_N, m_T = moments of a unit normal / friction force about H, brake-layout.ts)
 *   pivot reaction on the flap  R = −(N n + σ μ N t + B + F)  and the force on the knee is −R (D-65: the pull pin, in double shear).
 * Hold: W sinθ / μ = N_total is shared by two flaps (one foot each); members are checked at λ × that (a hard stomp / jerk on a parked sled, `brakeLoadFactor`).
 */
import { obbOverlap, partOBB, partOBBs, worldAABB } from '../model/bounds';
import { atPose, brakeGeometry, buildBrakeAt, type BrakeGeom, type V2 } from '../model/brake';
import { SHOULDER_CLEAR_IN, WITHDRAWAL_WET_CM, dot2, flapHalfWidth, momentY, norm2, pointPolyGap, sub } from '../model/brake-layout';
import { SIGN_X_MAX_IN } from '../model/body';
import { makeCtx } from '../model/build-utils';
import { handleGeometry, POST_RELIEF, SOCKET_ACCESS_HOLE_IN, type HandleGeom } from '../model/handle';
import type { Part } from '../model/types';
import type { Ctx } from './context';
import { dualCheck, singleCheck, detail, governing, type CaseEval } from './dual';
import { RAD, contactsAt } from './geometry';
import { f } from './format';
import type { CaseData } from './loads';
import { uncTensileArea } from './nds';
import { evalBoth, rearNormalNoseDown } from './stability';
import { allowables } from './structure';
import { judge, worst, type AnalysisCheck, type Detail, type Status } from './types';

/** Raise the limit of every '<=' detail by k (the abuse case is held to strength, not to the design allowable). */
export function scaleLimits(ds: Detail[], k: number): Detail[] {
  return ds.map((d) => (d.sense === '<=' ? detail(d.name, d.value, d.unit, d.limit * k, '<=') : d));
}

// ── shared bundle ────────────────────────────────────────────────────────────────────────────────────────────

interface Bundle { g: BrakeGeom; h: HandleGeom }
const bundles = new WeakMap<Ctx, Bundle>();
export function brakeBundle(ctx: Ctx): Bundle {
  let b = bundles.get(ctx);
  if (!b) {
    b = { g: brakeGeometry(ctx.p, ctx.L), h: handleGeometry(ctx.p, ctx.L) };
    bundles.set(ctx, b);
  }
  return b;
}

/** Friction used to size the hold load: the lower of the design (wet pad) μ and the mud-fouled μ. */
export const holdMu = (p: { brakePadMu: number; brakePadMuFouled: number }): number => Math.min(p.brakePadMu, p.brakePadMuFouled);

const circleA = (d: number) => (Math.PI / 4) * d * d;
const SIGMAS: Array<1 | -1> = [1, -1];
/** Length of the squash chord of the tire against the chock face (in): a patch about an inch long under a few hundred pounds. */
const SQUASH_CHORD_IN = 1;

/** Allowable stresses for the 316 bolts, screws and the pivot pin (yield / steel SF; shear 0.577). */
function allow(ctx: Ctx) {
  const { p } = ctx;
  const fb = p.ss316BoltYieldPsi / p.steelSafetyFactor;
  return { bolt: fb, boltShear: 0.577 * fb };
}

/** NDS withdrawal of one wood screw of diameter D with `pen` inches of thread in the oak (lbf, wet service): 1380 G² D pen C_M. */
const screwWithdrawal = (p: Ctx['p'], D: number, pen: number) => 1380 * p.oakSpecificGravity ** 2 * D * Math.max(0, pen) * WITHDRAWAL_WET_CM;

// ── load chain ──────────────────────────────────────────────────────────────────────────────────────────────

/** Loads on ONE flap for a pad normal force `nFlap` and rolling direction σ. */
export interface Loads {
  W: number; down: number; mu: number; sigma: 1 | -1; lam: number;
  /** Pad normal force on this flap, and the foot force (at equilibrium, pin friction ignored). */
  nFlap: number; foot: number;
  /** Forces ON THE FLAP (x, z): pad, pad friction, bungee, foot; the force on the KNEE at the pivot pin (−R) and its size. */
  fN: V2; fF: V2; fB: V2; fFoot: V2; Rk: V2; Rmag: number;
}

function chain(g: BrakeGeom, nFlap: number, mu: number, sigma: 1 | -1, base: { W: number; down: number; lam: number }): Loads {
  const fN: V2 = [g.n[0] * nFlap, g.n[1] * nFlap];
  const fF: V2 = [g.t[0] * sigma * mu * nFlap, g.t[1] * sigma * mu * nFlap];
  const fB = g.bungee.fApp;
  const foot = (nFlap * (g.mN + sigma * mu * g.mT) + g.bungee.mApp) / g.aF;
  const fFoot: V2 = [0, -foot];
  const Rk: V2 = [fN[0] + fF[0] + fB[0] + fFoot[0], fN[1] + fF[1] + fB[1] + fFoot[1]];
  return { ...base, mu, sigma, nFlap, foot, fN, fF, fB, fFoot, Rk, Rmag: norm2(Rk) };
}

/** Member loads at the hold load × λ (both flaps pressed): the rolling direction with the larger force on the knee. */
export function loadsAt(ctx: Ctx, c: CaseData, g: BrakeGeom): Loads {
  const { p } = ctx;
  const down = c.massLb * Math.sin(p.designSlopeDeg * RAD);
  const mu = holdMu(p);
  const nHold = down / (2 * mu);
  const base = { W: c.massLb, down, lam: p.brakeLoadFactor };
  const ls = SIGMAS.map((s) => chain(g, p.brakeLoadFactor * nHold, mu, s, base));
  return ls.reduce((a, b) => (b.Rmag > a.Rmag ? b : a));
}

/** Loads for a foot force `F` on ONE flap (the abuse stomp): the pad force follows from the moment balance, in the direction (and at the μ) that gives the larger force. */
export function loadsFromFoot(ctx: Ctx, g: BrakeGeom, F: number): Loads {
  const { p } = ctx;
  const mu = p.brakePadMu;
  const best = SIGMAS.map((s) => {
    const den = g.mN + s * mu * g.mT;
    return { s, n: den > 1e-6 ? Math.max(0, (F * g.aF - g.bungee.mApp) * p.brakeEfficiency / den) : 0 };
  }).reduce((a, b) => (b.n > a.n ? b : a));
  const l = chain(g, best.n, mu, best.s, { W: 0, down: 0, lam: 0 });
  return { ...l, foot: F, fFoot: [0, -F], Rk: [l.fN[0] + l.fF[0] + l.fB[0], l.fN[1] + l.fF[1] + l.fB[1] - F], Rmag: norm2([l.fN[0] + l.fF[0] + l.fB[0], l.fN[1] + l.fF[1] + l.fB[1] - F]) };
}

const loadText = (L: Loads, g: BrakeGeom) => L.lam === 0
  ? `Stomp F = ${f(L.foot)} lbf on ONE flap's foot area (pin-to-foot ${f(g.aF, 2)}") with the tire dragging ${L.sigma > 0 ? 'forward' : 'backward'}: pad force N = (F a_F − M_B) η / (m_N ${L.sigma > 0 ? '+' : '−'} μ|m_T|) = ${f(L.nFlap)} lbf; force on the knee at the pivot pin ${f(L.Rmag)} lbf (x ${f(L.Rk[0])}, z ${f(L.Rk[1])})`
  : `Hold load W·sinθ/μ = ${f(L.W)} × sin θ / ${f(L.mu, 2)} = ${f(L.down / L.mu)} lbf shared by two flaps = ${f(L.down / L.mu / 2)} each; × λ ${f(L.lam, 2)} = N ${f(L.nFlap)} lbf per flap; foot force at that load ${f(L.foot)} lbf (F a_F = N (m_N ${L.sigma > 0 ? '+' : '−'} μ|m_T|) + M_B with m_N ${f(g.mN, 2)}, m_T ${f(g.mT, 2)}, M_B ${f(g.bungee.mApp, 1)}); force on the knee at the pivot pin ${f(L.Rmag)} lbf (x ${f(L.Rk[0])}, z ${f(L.Rk[1])})`;

// ── foot-lever ratio, foot force, slowing, traction ─────────────────────────────────────────────────────────

export function brakeRatio(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const g = brakeBundle(ctx).g;
  const toDeg = 180 / Math.PI;
  const how = `Derived from the flap geometry, not assumed (D-57). The pivot pin is ${f(g.xh, 2)}" ahead of the axle (${f(p.brakePivotAheadIn, 2)}" ahead of the tire front) and ${f(g.H[1], 2)}" off the ground; the pad is centered ${f(g.alpha * toDeg, 0)}° behind the top of the tire (a ${f(g.pad.length, 1)}" pad at ${f(g.C[0], 2)}", ${f(g.C[1], 2)}"); the foot point is ${f(g.aF, 2)}" behind the pin, ${f(Math.abs(g.F[0] - L.xRear), 2)}" ${g.F[0] < L.xRear ? 'behind' : 'ahead of'} the rear transom face. Moments about the pin: a unit pad force n at C gives m_N = ${f(g.mN, 2)} in, a unit friction force along the tread gives m_T = ${f(g.mT, 2)} in, so ratio N_pad / F_foot = a_F / (m_N ± μ m_T) = ${f(g.aF, 2)} / (${f(g.mN, 2)} ± ${f(p.brakePadMu, 2)} × ${f(Math.abs(g.mT), 2)}) = ${f(g.ratioFwd, 2)}:1 rolling forward, ${f(g.ratioRev, 2)}:1 backward (friction is the small second term: the line of the pad force and the tread pass close to the pin, so there is no servo effect). Average of the two directions ${f((g.ratioFwd + g.ratioRev) / 2, 2)}:1 (about 2:1, D-65: the flap ends at the transom face, so the foot point is ${f(g.aF, 2)}" from the pin, was 17.5"). Stepping on the foot area swings the flap ${f(g.theta * toDeg, 1)}° and drops it ${f(g.footDrop, 2)}".`;
  const details: Detail[] = [
    detail('ratio, rolling forward', g.ratioFwd, ':1', p.brakeLeverRatio, '>='),
    detail('ratio, rolling backward', g.ratioRev, ':1', p.brakeLeverRatio, '>='),
    detail('foot stroke, released to applied (drop of the foot area)', g.footDrop, 'in', p.brakeFootStrokeMaxIn, '<='),
    detail('foot area height above the ground, released', g.F[1] - g.footDrop, 'in', p.brakeFootHeightMaxIn, '<='),
    detail('flap and foot tread stick out behind the rear transom face (D-65: none)', L.xRear - g.xEnd, 'in', 0, '<='),
  ];
  const ok: Status = g.ok ? [judge(g.ratioCrit, p.brakeLeverRatio, '>=', 0.25), ...details.slice(2).map((d) => judge(d.value, d.limit, d.sense, 0))].reduce((x, y) => worst(x, y)) : 'fail';
  return singleCheck({
    id: 'brake-ratio', label: 'Brake foot-lever advantage (derived from geometry)', group: 'Braking', refs: ['D-57', 'D-55', 'D-53'],
    value: g.ok ? g.ratioCrit : 0, unit: ':1', limit: p.brakeLeverRatio, sense: '>=', marginalAbs: 0.25, how, details, status: ok,
  });
}

/** Foot force (lbf) per foot to hold a downslope pull `down` at pad friction `mu`, both flaps pressed, sled rolling in direction σ, with the pivot efficiency. */
export function footForce(ctx: Ctx, g: BrakeGeom, down: number, mu: number, sigma: 1 | -1): number {
  const { p } = ctx;
  const nFlap = down / (2 * mu);
  return (nFlap * (g.mN + sigma * mu * g.mT)) / (g.aF * p.brakeEfficiency) + g.bungee.mApp / g.aF;
}

export function brakeForce(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const th = p.designSlopeDeg * RAD;
  const g = brakeBundle(ctx).g;
  const ev = (c: CaseData): CaseEval => {
    const down = c.massLb * Math.sin(th);
    const muD = p.brakePadMu, muF = p.brakePadMuFouled;
    const worstDir = (mu: number) => Math.max(...SIGMAS.map((s) => footForce(ctx, g, down, mu, s)));
    const Fd = worstDir(muD);
    const Ff = worstDir(muF);
    const F = Math.max(Fd, Ff);
    const lim = p.brakeFootForceLimitLbf;
    return {
      value: F, unit: 'lbf', limit: lim, sense: '<=', suffix: Ff >= Fd ? 'fouled pad' : 'wet pad', info: true, // D-58: a reported number, not pass/fail: the flaps SLOW the sled (brake-slow is the judged row); holding on steep hills is done by the chock or a person
      details: [
        detail(`foot force per foot, wet rubber pad μ ${f(muD, 2)}`, Fd, 'lbf', lim, '<='),
        detail(`foot force per foot, mud / snow-fouled pad μ ${f(muF, 2)} (pass/fail)`, Ff, 'lbf', lim, '<='),
      ],
      how: `Both flaps pressed, one foot on each. F = N (m_N ± μ m_T) / (a_F η) + M_B / a_F with N = W·sinθ / (2 μ) per flap = ${f(c.massLb)} × sin ${f(p.designSlopeDeg)}° / (2 μ); W·sinθ = ${f(down)} lbf downslope. Geometry: a_F = ${f(g.aF, 2)}", m_N = ${f(g.mN, 2)}", m_T = ${f(g.mT, 2)}" (ratio ${f(g.ratioCrit, 2)}:1 before efficiency, brake-ratio), η = ${f(p.brakeEfficiency, 2)}, bungee torque ${f(g.bungee.mApp, 1)} lbf·in (${f(g.bungee.mApp / g.aF, 1)} lbf at the foot). Worse of the two rolling directions. Wet pad: ${f(Fd)} lbf; fouled pad: ${f(Ff)} lbf per foot (limit ${f(lim, 0)} lbf per foot: about half of a ${f(2 * lim, 0)} lb handler's weight on the two flaps). Only the rear wheels brake (D-53): stepping with one foot only takes half of the retarding force. Where this is over the limit the chock parks the sled (park-hold). INFO ONLY (Eric, D-58): the flaps are a just-in-case slowing brake, so the row that passes or fails is brake-slow; to HOLD the loaded sled on a steep hill, chock a wheel or have someone hold it.`,
    };
  };
  return dualCheck({
    id: 'brake-force', label: 'Foot force on each flap to hold on the slope (info)', group: 'Braking', refs: ['D-57', 'D-55', 'D-13', 'BRIEF §7'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

/** What the flaps do at the limit foot force and the fouled pad, one foot per flap: the braking force (also capped by the rear tires' traction), the grade held, the share of the design-slope pull. */
export function slowing(ctx: Ctx, c: CaseData, g: BrakeGeom, twoFeet = true) {
  const { p, contact } = ctx;
  const th = p.designSlopeDeg * RAD;
  const mu = holdMu(p);
  const Fl = p.brakeFootForceLimitLbf;
  // pad force per flap from the moment balance at the limit foot force, the smaller of the two rolling directions (conservative)
  const n = Math.min(...SIGMAS.map((s) => Math.max(0, (Fl * g.aF - g.bungee.mApp) * p.brakeEfficiency / (g.mN + s * mu * g.mT))));
  const flaps = twoFeet ? 2 : 1;
  const padForce = flaps * mu * n;
  const ct = contactsAt(contact, 0);
  const xfc = (ct.FL[0] + ct.FR[0]) / 2;
  const nr = (a: number) => Math.max(0, rearNormalNoseDown(c.massLb, c.cg[0], c.cg[2], a, xfc));
  const Nr = nr(th);
  const traction = p.tireGroundMu * Nr;
  const F = padForce;
  // The steepest grade held is where the pad force meets the pull, or where the rear tires' traction (which falls as the grade rises) meets it, whichever comes first.
  const gradePad = Math.asin(Math.min(1, padForce / c.massLb));
  let lo = 0, hi = Math.PI / 4;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (p.tireGroundMu * nr(m) >= c.massLb * Math.sin(m)) lo = m; else hi = m; }
  const gradeTrac = (lo + hi) / 2;
  const grade = gradePad / RAD;
  const down = c.massLb * Math.sin(th);
  return { n, padForce, traction, F, grade, gradePad: gradePad / RAD, gradeTrac: gradeTrac / RAD, share: F / down, decelG: F / c.massLb - Math.sin(th), down, Nr, mu };
}

export function brakeSlow(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const g = brakeBundle(ctx).g;
  const ev = (c: CaseData): CaseEval => {
    const s2 = slowing(ctx, c, g, true), s1 = slowing(ctx, c, g, false);
    const lim = p.brakeStopSlopeDeg;
    return {
      value: s2.grade, unit: '°', limit: lim, sense: '>=', marginalAbs: 1,
      suffix: 'steepest grade held',
      details: [
        detail('steepest grade the flaps hold, both feet at the limit force (fouled pad)', s2.grade, '°', lim, '>='),
        detail(`share of the ${f(p.designSlopeDeg, 0)}° downhill pull the flaps take (SLOWS)`, s2.share, '', p.brakeSlowShareMin, '>='),
        detail('steepest grade held with ONE foot only', s1.grade, '°', 0, '>='),
        detail('INFO: steepest grade the rear tires\' traction holds (the front wheels roll free; see brake-traction)', s2.gradeTrac, '°', 0, '>='),
      ],
      how: `At the ${f(p.brakeFootForceLimitLbf, 0)} lbf foot limit per flap the pad force is N = (F a_F − M_B) η / (m_N ± μ m_T) = ${f(s2.n)} lbf per flap (the smaller rolling direction), the retarding force at the tread 2 μ N = 2 × ${f(s2.mu, 2)} × ${f(s2.n)} = ${f(s2.padForce)} lbf at the fouled pad μ, (rear tires' traction, info only as in brake-traction: μ_ground N_r = ${f(p.tireGroundMu, 2)} × ${f(s2.Nr)} = ${f(s2.traction)} lbf on ${f(p.designSlopeDeg, 0)}° nose-down, which would limit the grade to ${f(s2.gradeTrac)}°: the rear tires skid first with a nose-heavy load, and the pullers hold the rest). With W = ${f(c.massLb)} lb the pad force holds sin θ = ${f(s2.padForce)} / ${f(c.massLb)}, i.e. up to ${f(s2.grade)}° (limit ≥ ${f(p.brakeStopSlopeDeg, 0)}°: STOPS on gentler grades). On the ${f(p.designSlopeDeg, 0)}° design slope the downhill pull is ${f(s2.down)} lbf, so the flaps take ${f(100 * s2.share, 0)}% of it${s2.decelG >= 0 ? `: a net deceleration of ${f(s2.decelG, 3)} g` : `: the sled still gains ${f(-s2.decelG, 3)} g, which the flaps cut by ${f(100 * s2.share, 0)}%`} (SLOWS, and the pullers or the chock do the rest). One foot only: ${f(s1.grade)}°.`,
    };
  };
  return dualCheck({
    id: 'brake-slow', label: 'Flaps slow on the design slope and stop on gentler grades', group: 'Braking', refs: ['D-57'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

export function brakeTraction(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const th = p.designSlopeDeg * RAD;
  const ct = contactsAt(ctx.contact, 0);
  const xfc = (ct.FL[0] + ct.FR[0]) / 2;
  const ev = (c: CaseData): CaseEval => {
    const [x, , h] = c.cg;
    const Nr = Math.max(0, rearNormalNoseDown(c.massLb, x, h, th, xfc));
    const down = c.massLb * Math.sin(th);
    const ratio = (p.tireGroundMu * Nr) / down;
    const wet = (0.3 * Nr) / down;
    return {
      value: ratio, unit: '×', limit: 1, sense: '>=', info: true,
      how: `Parked nose-down on ${f(p.designSlopeDeg)}°, rear wheels only locked: N_r = W(cosθ·(L−x)/L − sinθ·h/L) = ${f(Nr)} lb; μ_ground·N_r = ${f(p.tireGroundMu, 2)} × ${f(Nr)} = ${f(p.tireGroundMu * Nr)} lbf vs W·sinθ = ${f(down)} lbf → ${f(ratio, 2)}× (${f(wet, 2)}× at wet-leaf μ 0.3). Info only (D-24); parked nose-up N_r is much larger. There are no front brakes (D-53): the front wheels roll free, so a locked rear pair holds only this share of a steep slope and the pullers (or the chock) hold the rest.`,
    };
  };
  return dualCheck({
    id: 'brake-traction', label: 'Rear-only traction, parked nose-down', group: 'Braking', refs: ['D-24', 'D-53'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

// ── members ──────────────────────────────────────────────────────────────────────────────────────────────────

function members(id: string, label: string, ctx: Ctx, fn: (L: Loads, g: BrakeGeom) => CaseEval, refs: string[]): AnalysisCheck {
  const g = brakeBundle(ctx).g;
  const ev = (c: CaseData): CaseEval => fn(loadsAt(ctx, c, g), g);
  return dualCheck({ id, label, group: 'Structure', refs, primary: 'goal', ...evalBoth(ctx, ev) });
}

/** Position of a point along the board from the pin (s, toward the foot) and its height across (positive up). */
const along = (g: BrakeGeom, q: V2) => dot2(sub(q, g.H), g.u);

function flapEval(ctx: Ctx, L: Loads, g: BrakeGeom): CaseEval {
  const { p } = ctx;
  const al = allowables(ctx);
  const b = g.board;
  // Board loads transverse (·v) and axial (·u) to the board; stations s from the pin.
  const sC = along(g, g.C), sF = along(g, g.F), sE = along(g, g.bungee.E);
  const tF = Math.abs(dot2(L.fFoot, g.v)), tB = dot2(L.fB, g.v);
  const Mpad = Math.abs(tF * (sF - sC) - tB * (sE - sC));
  const axial = Math.abs(dot2(L.fF, g.u));
  const ecc = Math.abs(dot2(sub(g.C, g.board.c), g.v)); // the friction acts at the tread, below the board's center line
  const M = Mpad + axial * ecc;
  const S = (b.w * b.thick ** 2) / 6;
  const sig = M / S + axial / (b.w * b.thick);
  const V = Math.abs(tF - tB);
  const tau = (1.5 * V) / (b.w * b.thick);
  const EI = al.Eoak * (b.w * b.thick ** 3) / 12;
  const lo = sF - sC;
  const defl = (tF * lo ** 3) / (3 * EI);
  const padArea = g.pad.length * g.pad.w;
  const press = L.nFlap / padArea;
  const fric = L.mu * L.nFlap;
  const screwLat = p.woodScrewLateralLbf;
  const padScrewLat = screwLat * (0.164 / 0.19); // #8 against the #10 value
  // D-65: the Shaper-cut fender narrows to a tongue at the pivot. The moment is the pin's transverse reaction times the station s (zero at the pin, the pad's M at s_C), the section the
  // flap alone (the glued block is not counted) at the width of the outline there: find the weakest station between the pin and the pad.
  const Tpin = Math.abs(dot2([-L.Rk[0], -L.Rk[1]], g.v));
  let sigTaper = 0, sAt = 0;
  for (let st = 0.1; st <= sC + 1e-9; st += 0.1) {
    const sg = (Tpin * st) / ((2 * flapHalfWidth(g, st) * b.thick ** 2) / 6);
    if (sg > sigTaper) { sigTaper = sg; sAt = st; }
  }
  const tauTongue = (1.5 * Tpin) / (g.plan.wTongue * b.thick);
  const ds: Detail[] = [
    detail('flap bending at the pad (oak, 5/4 board)', sig, 'psi', al.oakBend, '<='),
    detail(`flap bending, weakest station of the tapered fender (${f(sAt, 1)}" from the pin)`, sigTaper, 'psi', al.oakBend, '<='),
    detail('flap shear in the tongue at the pivot (oak, tongue width, flap alone)', tauTongue, 'psi', al.oakShear, '<='),
    detail('flap shear between the pad and the foot (oak)', tau, 'psi', al.oakShear, '<='),
    detail('flap deflection at the foot (the overhang past the pad) against the foot stroke', defl, 'in', g.footDrop, '<='),
    detail('pad contact pressure (rubber on the tread)', press, 'psi', p.brakeLiningMaxPsi, '<='),
    detail('shoe block screws, pad friction in lateral shear (2 x #10, each)', fric / 2, 'lbf', screwLat, '<='),
    detail('pad screws, pad friction in lateral shear (2 x #8, each)', fric / 2, 'lbf', padScrewLat, '<='),
  ];
  const how = `${loadText(L, g)}. Oak flap ${f(b.w, 2)}" × ${f(b.thick, 2)}" (full width): the foot (${f(tF)} lbf across the board) acts ${f(sF - sC, 1)}" past the pad, the bungee lifts back ${f(Math.abs(tB), 1)} lbf, so M at the pad = ${f(Mpad)} lbf·in (+ friction ${f(axial)} lbf × ${f(ecc, 2)}" off the center line), S = ${f(S, 3)} in³, σ = ${f(sig, 0)} psi (design ${f(al.oakBend, 0)}); τ = 1.5 V / A = ${f(tau, 0)} psi; foot-end deflection ${f(defl, 3)}" as a ${f(lo, 1)}" overhang (EI ${f(EI, 0)} lbf·in²). Tapered fender (D-65): ${f(g.plan.wTongue, 2)}" tongue at the pivot, S-curved flare to the full width by ${f(g.plan.sFull, 1)}" from the pin; the weakest station (the flap alone, M = pin reaction ${f(Tpin)} lbf × s over S = w(s) t²/6) is ${f(sAt, 1)}" from the pin at ${f(sigTaper, 0)} psi; shear in the tongue ${f(tauTongue, 0)} psi. Pad ${f(g.pad.length, 1)}" × ${f(g.pad.w, 1)}" = ${f(padArea, 1)} in²: ${f(press, 1)} psi (limit ${f(p.brakeLiningMaxPsi, 0)}). The pad friction μN = ${f(fric)} lbf is held by two #10 screws up through the shoe block into the flap (glued too) and two #8 screws through the pad.`;
  return governing(ds, how);
}

export function brakeFlap(ctx: Ctx): AnalysisCheck {
  return members('brake-flap', 'Brake flap, shoe block and pad', ctx, (L, g) => flapEval(ctx, L, g), ['D-57', 'D-2']);
}

/** NDS-style screw withdrawal strength is `screwWithdrawal`; the pivot checks below are hand-checkable from the layout (pivot block, ears, pin). */
function pivotEval(ctx: Ctx, L: Loads, g: BrakeGeom): CaseEval {
  const { p } = ctx;
  const al = allowables(ctx);
  const a = allow(ctx);
  const pv = g.pivot, pl = g.plan, b = g.board;
  const R = L.Rmag;
  const d = pv.dia;
  const wt = pl.wTongue, clr = p.brakePivotSlotClearIn;
  // Double shear: the pin is loaded at the tongue and held by the two ears, so two planes carry R.
  const shear = R / (2 * circleA(d));
  // The ears' reactions (the pin is held over the outboard ear's thickness and over the blind depth in the inboard ear): moment arms from the tongue's center.
  const armO = wt / 2 + clr + pv.earOut / 2, armI = wt / 2 + clr + pv.blind / 2;
  const Ro = (R * armI) / (armO + armI), Ri = R - Ro;
  const Mpin = Math.max(Ro * armO, Ri * armI) - (R / 2) * (wt / 4);
  const Zpin = (Math.PI * d ** 3) / 32;
  const bend = Mpin / Zpin;
  // Oak bearing of the pin (dowel bearing), on the tongue (flap + block, grain along x, the load across it) and on each ear.
  const bearT = R / (d * wt), bearO = Ro / (d * pv.earOut), bearI = Ri / (d * pv.blind);
  // Tear-out toward the loaded edge: two shear planes either side of the pin, the nearer edge (the load can come either way).
  const eT = Math.min(pv.edgeTongueUp, pv.edgeTongueDown), eE = Math.min(pv.edgeEarUp, pv.edgeEarDown);
  const tearT = R / (2 * eT * wt), tearO = Ro / (2 * eE * pv.earOut);
  // End distance past the pin: the tongue and the ears' rear stand p.brakePivotEndIn from the pin.
  const endD = p.brakePivotEndIn;
  // The pivot block takes its share of the pin's load (by thickness) and passes it into the flap through its screws (glue ignored): it pulls up when the pin pushes the flap down.
  const nBS = Math.max(1, Math.round(p.brakePivotBlockScrews));
  const penBS = 1.25 - pl.blockT - 0.1;
  const wBS = screwWithdrawal(p, 0.19, penBS);
  const shareBlock = (pl.blockT / (b.thick + pl.blockT)) * R;
  const ds: Detail[] = [
    detail('pivot pin double shear (316)', shear, 'psi', a.boltShear, '<='),
    detail('pivot pin bending between the ears (316)', bend, 'psi', a.bolt, '<='),
    detail('oak bearing of the pin on the tongue and block (dowel bearing)', bearT, 'psi', al.oakDowel, '<='),
    detail('oak bearing on the outboard ear', bearO, 'psi', al.oakDowel, '<='),
    detail('oak bearing on the inboard ear (blind hole depth)', bearI, 'psi', al.oakDowel, '<='),
    detail('tear-out of the tongue toward the nearer edge (oak shear, two planes)', tearT, 'psi', al.oakShear, '<='),
    detail('tear-out of the outboard ear toward the nearer edge (oak shear, two planes)', tearO, 'psi', al.oakShear, '<='),
    detail('edge distance, pin center to the nearer edge of the tongue stack (pin diameters, 1.5 D minimum)', eT / d, '×D', 1.5, '>='),
    detail('edge distance, pin center to the nearer edge of the ear (pin diameters)', eE / d, '×D', 1.5, '>='),
    detail('end distance, pin center past the tongue end and the ear rear face (pin diameters)', endD / d, '×D', 1.5, '>='),
    detail('pivot block screws, withdrawal each at the block share of the pin load (NDS, wet)', shareBlock / nBS, 'lbf', wBS, '<='),
  ];
  const how = `${loadText(L, g)}. D-65 pull-pin pivot: a ${f(d, 3)}" 316 clevis pin through the knee's two ears and the flap tongue (${f(wt, 2)}" wide, flap ${f(b.thick, 2)}" + pivot block ${f(pl.blockT, 2)}", the slot ${f(clr, 3)}" wider each side), held by a hitch-pin clip. The pin carries the whole ${f(R)} lbf in DOUBLE shear: ${f(R)} / (2 × ${f(circleA(d), 4)} in²) = ${f(shear, 0)} psi (allowable ${f(a.boltShear, 0)}). It is held by the outboard ear (${f(pv.earOut, 2)}" thick) and ${f(pv.blind, 2)}" of the inboard ear (blind hole): reactions ${f(Ro)} and ${f(Ri)} lbf at arms ${f(armO, 2)}" and ${f(armI, 2)}" from the tongue's center, so M = ${f(Mpin)} lbf·in on Z = π d³/32 = ${f(Zpin, 4)} in³ = ${f(bend, 0)} psi (allowable ${f(a.bolt, 0)}). Bearing: ${f(bearT, 0)} psi on the tongue (${f(wt, 2)}" × ${f(d, 3)}"), ${f(bearO, 0)} psi on the outboard ear, ${f(bearI, 0)} psi on the inboard ear (allowable ${f(al.oakDowel, 0)}). The pin sits ${f(pv.edgeTongueUp, 2)}" below the top of the tongue stack and ${f(pv.edgeTongueDown, 2)}" above its underside (${f(eT / d, 1)} pin diameters), ${f(pv.edgeEarUp, 2)}" below the knee top and ${f(pv.edgeEarDown, 2)}" above the arm bottom, and ${f(endD, 2)}" from the tongue end and the ears' rear faces; tear-out is checked as oak shear on two planes of the nearer edge. The pivot block's ${nBS} #10 × 1-1/4" screws (${f(penBS, 2)}" of thread in the flap, ${f(wBS)} lbf each) carry its ${f(shareBlock)} lbf share if the glue lets go.`;
  return governing(ds, how);
}

export function brakePivot(ctx: Ctx): AnalysisCheck {
  return members('brake-pivot', 'Brake pivot pin, ears and pivot block (pull pin)', ctx, (L, g) => pivotEval(ctx, L, g), ['D-65', 'D-57', 'D-2']);
}

/** Lower z of the knee outline at |y| = y (the sloping underside beyond the leg) and its height there. */
function kneeSection(g: BrakeGeom, y: number) {
  const k = g.knee;
  const y0 = g.y.face + k.legT;
  const zLo = y <= y0 ? k.zBot : k.zLeg + ((k.zArmBot - k.zLeg) * (y - y0)) / Math.max(1e-6, k.yOut - y0);
  return { zLo, h: k.zTop - zLo, depth: k.x1 - k.x0 };
}

function mountEval(ctx: Ctx, L: Loads, g: BrakeGeom): CaseEval {
  const { L: lay, p } = ctx;
  const al = allowables(ctx), a = allow(ctx);
  const k = g.knee, bt = g.bolts, bd = bt.dia;
  const n = bt.count;
  const pts: V2[] = bt.xs.flatMap((x) => bt.zs.map((z): V2 => [x, z]));
  const r2 = pts.map(([x, z]) => (x - bt.cx) ** 2 + (z - bt.cz) ** 2);
  const sumR2 = r2.reduce((x, y) => x + y, 0);
  const rmax = Math.sqrt(Math.max(...r2));
  const Rk = L.Rk;
  // In-plane: the force at the pin (x = pin, z = pin height) about the bolt group; direct share plus the twist (added arithmetically: conservative).
  const Mpl = Math.abs(momentY([g.xh - bt.cx, g.H[1] - bt.cz], Rk));
  const direct = L.Rmag / n;
  const twist = sumR2 > 1e-9 ? (Mpl * rmax) / sumR2 : 0;
  const V = direct + twist;
  // Out of plane: the force acts e outboard of the hull face; the couple in z (Rz) pivots on the top of the contact band (the chine), in x (Rx) about the bolt columns.
  const e = g.y.wheel - g.y.face;
  const zc = k.zLeg;
  const Mx = Math.abs(Rk[1]) * e, Mz = Math.abs(Rk[0]) * e;
  const sumZ2 = pts.reduce((s, [, z]) => s + (zc - z) ** 2, 0);
  const sumX2 = pts.reduce((s, [x]) => s + (x - bt.cx) ** 2, 0);
  const Tz = Math.max(...pts.map(([, z]) => (sumZ2 > 0 ? (Mx * (zc - z)) / sumZ2 : 0)));
  const Tx = sumX2 > 1e-9 ? Math.max(...pts.map(([x]) => (Mz * Math.abs(x - bt.cx)) / sumX2)) : 0;
  const T = Tz + Tx;
  const Cbear = pts.reduce((s, [, z]) => s + (sumZ2 > 0 ? (Mx * (zc - z)) / sumZ2 : 0), 0); // the compression resultant balances the bolt tension
  const At = uncTensileArea(bd);
  const sigT = T / At;
  const shear = V / circleA(bd);
  const comb = Math.hypot(shear / a.boltShear, sigT / a.bolt);
  const tComp = Math.min(k.legT, g.rail.t + g.backer.t); // the bolt bears on the rail + glued backer, and on the knee leg
  const bear = V / (bd * tComp);
  const edge = (g.rail.zt - g.rail.zb) / (2 * bt.zs.length); // from the first / last bolt row to the rail edge
  const tear = V / (2 * edge * tComp);
  const dW = p.brakeMountWasherOdIn, dH = bd + 0.0625;
  const washerA = (Math.PI / 4) * (dW ** 2 - dH ** 2);
  const pull = T / washerA;
  const contactA = (k.x1 - k.x0) * lay.chineH;
  const cBear = Cbear / contactA;
  // Knee arm: section just beyond the leg, bending from the force at the pin lever (y_pin − y_s), both axes.
  const ys = g.y.face + k.legT + 0.1;
  const sec = kneeSection(g, ys);
  const lever = Math.max(0, g.y.wheel - ys);
  const sigK = (Math.abs(Rk[1]) * lever) / ((sec.depth * sec.h ** 2) / 6) + (Math.abs(Rk[0]) * lever) / ((sec.h * sec.depth ** 2) / 6);
  const tauK = (1.5 * Math.abs(Rk[1])) / (sec.depth * sec.h);
  const ds: Detail[] = [
    detail('knee arm bending beyond the leg, both axes (oak)', sigK, 'psi', al.oakBend, '<='),
    detail('knee arm shear (oak)', tauK, 'psi', al.oakShear, '<='),
    detail('mounting bolt shear, worst bolt, direct + twist (316)', shear, 'psi', a.boltShear, '<='),
    detail('mounting bolt tension from the overturning couple, worst (316)', sigT, 'psi', a.bolt, '<='),
    detail('mounting bolt shear + tension combined (316)', comb, '', 1, '<='),
    detail('bolt bearing in the rail + backer and the knee leg (oak, across the grain)', bear, 'psi', al.oakDowel, '<='),
    detail('bolt tear-out toward the rail edge (oak shear)', tear, 'psi', al.oakShear, '<='),
    detail('nut washer bearing on the backer face (oak across the grain)', pull, 'psi', al.oakPerp, '<='),
    detail('knee leg bearing on the chine / rail face at the top of the couple (oak across the grain)', cBear, 'psi', al.oakPerp, '<='),
  ];
  const how = `${loadText(L, g)}. ${n} × ${f(bd, 3)}" 316 bolts (${bt.xs.length} columns × ${bt.zs.length} rows, centroid x ${f(bt.cx, 2)}", z ${f(bt.cz, 2)}") through the ${f(k.legT, 2)}" knee leg, the ${f(g.rail.t, 2)}" rail and the ${f(g.backer.t, 2)}" backer glued to it. In plane: M = ${f(Mpl)} lbf·in about the bolt group (pin ${f(g.xh - bt.cx, 2)}" ahead of / ${f(g.H[1] - bt.cz, 2)}" above it), twist ${f(twist)} + direct ${f(direct)} = ${f(V)} lbf on the worst bolt (shear ${f(shear, 0)} psi, bearing ${f(bear, 0)} psi on ${f(tComp, 2)}"). Out of plane: the force acts ${f(e, 2)}" outboard of the hull face: M_x = ${f(Mx)} lbf·in pivots on the chine top (z ${f(zc, 2)}") into the ${bt.zs.length} bolt rows (T ${f(Tz)} lbf) and M_z = ${f(Mz)} lbf·in over the columns (T ${f(Tx)} lbf): worst bolt tension ${f(T)} lbf = ${f(sigT, 0)} psi on ${f(At, 4)} in², washer bearing ${f(pull, 0)} psi on a ${f(dW, 3)}" fender washer. Knee arm section just beyond the leg ${f(sec.depth, 2)}" × ${f(sec.h, 2)}": σ ${f(sigK, 0)} psi. The knee bolts into the rail (backed by the glued ${f(g.backer.t, 2)}" doubler), not the 1/4" side panel.`;
  return governing(ds, how);
}

export function brakeMount(ctx: Ctx): AnalysisCheck {
  return members('brake-mount', 'Brake knee, mounting bolts and backer', ctx, (L, g) => mountEval(ctx, L, g), ['D-57', 'D-2']);
}

/** Weight torque (lbf·in) about the pivot pin of the flap group (flap, pivot block, shoe block, pad, foot tread) in the released pose. */
export function weightTorque(ctx: Ctx, g: BrakeGeom): number {
  const bctx = makeCtx(ctx.p, {});
  const mov = buildBrakeAt(bctx, 0, true).filter((x) => /^brake-(flap|shoe|pad|pivot-block|foot-tread)-L$/.test(x.id));
  return mov.reduce((s, x) => s + x.massLb * Math.max(0, g.H[0] - (x.cgIn ? x.cgIn[0] : partOBB(x).center[0])), 0);
}

export function brakeReturn(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const g = brakeBundle(ctx).g;
  const bg = g.bungee;
  const wt = weightTorque(ctx, g);
  const lift = wt > 1e-6 ? bg.mRel / wt : 99;
  const tMax = bg.tApp;
  const brk = p.brakeCordBreakLbf / p.brakeCordSafetyFactor;
  const leverE = Math.max(0.5, g.H[0] - bg.Erel[0]);
  const stopV = Math.max(0, bg.mRel - wt) / leverE; // vertical force the stop cord holds at rest
  const stopT = stopV / Math.max(0.2, bg.fRel[1] / bg.tRel);
  const pen = L.transom + p.blockingThickIn - 0.1;
  const wEye = screwWithdrawal(p, 0.19, pen);
  const wFlapEye = 0.5 * screwWithdrawal(p, 0.19, 1); // D-65: the flap eye is a #10 screw eye 1 in long in the flap's rear END face: end-grain withdrawal is taken as half the side-grain value
  const latFlapEye = 0.5 * p.woodScrewLateralLbf;
  const ds: Detail[] = [
    detail('bungee torque over the weight torque of the flap group, released', lift, '×', p.brakeReturnLiftMargin, '>='),
    detail('bungee tension, applied (cord breaking strength / safety factor)', tMax, 'lbf', brk, '<='),
    detail('stop cord tension at rest (breaking strength / safety factor)', stopT, 'lbf', brk, '<='),
    detail('transom eye screw, withdrawal at the applied tension (NDS, wet)', tMax * (bg.fApp[1] / bg.tApp), 'lbf', wEye, '<='),
    detail('flap eye screw (end grain), withdrawal: the x part of the cord pull at the applied tension (NDS, wet, half value)', tMax * (Math.abs(bg.fApp[0]) / bg.tApp), 'lbf', wFlapEye, '<='),
    detail('flap eye screw (end grain), lateral: the cord pull across the screw (half value)', tMax, 'lbf', latFlapEye, '<='),
  ];
  const how = `Return set per flap: a ${f(bg.lenRel)}" shock cord from an eye in the flap's rear end to an eye in the rear transom's aft face (${f(p.brakeBungeeAnchorBelowTopIn, 1)}" below the top, over the backer), with a stop cord of the same length. Released tension ${f(bg.tRel, 1)} lbf, ${f(bg.rate, 1)} lbf/in, ${f(bg.tApp, 2)} lbf at the applied pose (cord ${f(bg.lenApp)}"); torque about the pin ${f(bg.mRel, 1)} lbf·in released against the weight torque of the flap, shoe block and pad ${f(wt, 1)} lbf·in = ${f(lift, 2)}× (limit ≥ ${f(p.brakeReturnLiftMargin, 1)}): the stop cord takes the difference (${f(stopT, 2)} lbf) and holds the ${f(p.brakePadGapIn, 3)}" pad gap. Cords: ${p.brakeCordBreakLbf} lbf breaking strength / ${p.brakeCordSafetyFactor} = ${f(brk, 0)} lbf. Eye screws #10 into ${f(pen, 2)}" of the transom and its backer (${f(wEye)} lbf) and a 1" screw eye in the flap's rear end face (${f(wFlapEye)} lbf withdrawal, ${f(latFlapEye)} lbf lateral, end grain at half value).`;
  const gv = governing(ds, how);
  return singleCheck({
    id: 'brake-return', label: 'Flap return bungee, stop cord and eyes', group: 'Structure', refs: ['D-57'],
    value: gv.value, unit: gv.unit, limit: gv.limit, sense: gv.sense, how, details: ds,
    status: ds.map((d) => judge(d.value, d.limit, d.sense)).reduce((x, y) => worst(x, y), 'pass' as Status),
  });
}

// ── parking: the wheel chock (D-57) ──────────────────────────────────────────────────────────────────────────

/** Numbers behind the park-hold row, exported for the tests. A chocked, free-rolling rear wheel in the slope frame: the chock pushes back along the radius at ψ off the slope normal. */
export function chockHold(ctx: Ctx, c: CaseData, muGround: number) {
  const { p } = ctx;
  const g = brakeBundle(ctx).g;
  const th = p.designSlopeDeg * RAD;
  const psi = g.chock.psi;
  const n = Math.max(1, Math.round(p.brakeChockCount));
  const ct = contactsAt(ctx.contact, 0);
  const xfc = (ct.FL[0] + ct.FR[0]) / 2;
  const down = c.massLb * Math.sin(th);
  const roll = p.parkRollingResistance * c.massLb * Math.cos(th);
  const P = Math.max(0, down - roll);
  const Pw = P / n; // along-slope load through each chocked wheel (the unchocked wheels roll free)
  const Nr = Math.max(0, rearNormalNoseDown(c.massLb, c.cg[0], c.cg[2], th, xfc));
  const Na = Math.max(1e-6, Nr / 2); // normal load on one rear wheel
  const tanNeed = Pw / Na; // the wheel climbs the chock if tan ψ is less than this
  const Q = Pw / Math.sin(psi); // chock-to-tire force, along the radius
  const wC = ctx.parts.find((x) => x.id === 'brake-chock-L')?.massLb ?? 0.5;
  const Nc = Q * Math.cos(psi) + wC * Math.cos(th);
  const fc = Pw + wC * Math.sin(th);
  const muReq = fc / Nc;
  const climb = Math.tan(psi) / tanNeed;
  const slide = muGround / muReq;
  // The tire presses the face over a patch about as wide as the tire and as long as its squash chord; bearing on the oak wedge (grain along the wedge).
  return { psi, n, down, roll, P, Pw, Nr, Na, tanNeed, Q, Nc, fc, muReq, climb, slide, margin: Math.min(climb, slide), wC };
}

export function parkHold(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const g = brakeBundle(ctx).g;
  const al = allowables(ctx);
  const muDesign = p.brakeChockMu, muFouled = p.brakeChockMuFouled;
  const muUse = muDesign; // pass/fail on dirt or gravel with the cleated base; the wet / fouled ground is a flagged detail and in the text (it fails: park-hold needs grip)
  const ev = (c: CaseData): CaseEval => {
    const d = chockHold(ctx, c, muDesign), u = chockHold(ctx, c, muUse);
    const ck = g.chock;
    const bear = u.Q / (ck.width * SQUASH_CHORD_IN); // the tire presses the face over its width and a squash chord about an inch long
    const drag = muUse * u.wC; // pulling the chock along the ground by its cord
    const reach = p.brakeChockCordLenIn / (1.2 * (2 * g.r + ck.xBack + ck.xBack)); // to the same spot behind the tire: over its diameter, with 20% slack
    const ds: Detail[] = [
      detail(`climb margin: tan ψ ${f(Math.tan(u.psi), 2)} over the slope load / wheel load ${f(u.tanNeed, 2)}`, u.climb, '×', 1, '>='),
      detail(`slide margin at the design ground μ ${f(muDesign, 2)} (dirt, gravel; pass/fail)`, d.slide, '×', 1, '>='),
      detail(`slide margin at the wet / fouled ground μ ${f(muFouled, 2)} (NOT held: flagged)`, chockHold(ctx, c, muFouled).slide, '×', 1, '>='),
      detail('chock face bearing from the tire (oak, wedge face)', bear, 'psi', al.oakPerp, '<='),
      detail('cord load if the sled drags the chock along the ground', drag, 'lbf', p.brakeCordBreakLbf / p.brakeCordSafetyFactor, '<='),
      detail('cord length over the reach to the far side of the tire', reach, '×', 1, '>='),
    ];
    return {
      value: u.margin, unit: '×', limit: 1, sense: '>=', marginalAbs: 0.1, details: ds,
      info: c.kind === 'cargo', // the cargo case is reported, not judged (as brake-traction, D-24): the chocks sit under the rear tires, which a forward payload unloads
      suffix: u.climb < u.slide ? 'the wheel climbs it' : 'the chock slides',
      how: `Parked on ${f(p.designSlopeDeg)}° nose-down with ${u.n} chock${u.n > 1 ? 's' : ''} (one per rear tire), the front wheels free. Load along the slope P = W sinθ − rolling ${f(p.parkRollingResistance, 3)} W cosθ = ${f(u.down)} − ${f(u.roll)} = ${f(u.P)} lbf, ${f(u.Pw)} lbf per chocked wheel. Rear normal load N_r = ${f(u.Nr)} lb (${f(u.Na)} on each wheel). A free wheel against the ramp face (ψ = ${f(u.psi / RAD, 0)}° off the ground, tangent to the tire ${f(ck.tangent[1], 2)}" up): the chock force Q = P_w / sin ψ = ${f(u.Q)} lbf along the radius. The wheel stays down if tan ψ ≥ P_w / N_wheel = ${f(u.tanNeed, 2)}; the wedge stays put if the ground μ ≥ (P_w + w sinθ) / (Q cos ψ + w cosθ) = ${f(u.muReq, 2)} (essentially tan ψ = ${f(Math.tan(u.psi), 2)}). Margins: climb ${f(u.climb, 2)}×, slide ${f(u.slide, 2)}× at the lower ground μ ${f(muUse, 2)} (the row is judged at the design ${f(muDesign, 2)} of dirt or gravel with the cleated base; on wet leaves, slush or snow the ground μ is nearer ${f(muFouled, 2)} and the chock slides at ${f(chockHold(ctx, c, muFouled).slide, 2)}×: it will NOT hold the loaded sled there, and the foot flaps or the pullers must). The cord only tethers the chock (it does not hold the sled): ${f(p.brakeChockCordLenIn, 0)}" of ${p.brakeCordBreakLbf} lbf cord.`,
    };
  };
  return dualCheck({ id: 'park-hold', label: 'Parking hold: wheel chocks and the wheels', group: 'Braking', refs: ['D-57', 'D-39'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── foot stomp abuse (a scout jumping on a flap) ─────────────────────────────────────────────────────────────

export function brakeAbuse(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const g = brakeBundle(ctx).g;
  const L = loadsFromFoot(ctx, g, p.brakeFootAbuseLbf);
  const kS = p.steelSafetyFactor; // yield-level: the design allowables carry the safety factor, remove it
  const kW = p.woodSafetyFactor;
  const parts: Array<[string, CaseEval]> = [['flap', flapEval(ctx, L, g)], ['pivot', pivotEval(ctx, L, g)], ['mount', mountEval(ctx, L, g)]];
  const ds: Detail[] = [];
  for (const [name, e] of parts) {
    for (const d of e.details ?? []) {
      const k = /\(316\)|screws|NDS|pin/.test(d.name) && !/oak/.test(d.name) ? kS : kW;
      ds.push({ ...scaleLimits([d], k)[0], name: `${name}: ${d.name}` });
    }
  }
  const worstD = ds.reduce((a, c) => (c.util > a.util ? c : a), ds[0]);
  const how = `A ${f(p.brakeFootAbuseLbf)} lbf stomp on the foot area of ONE flap (a scout jumping on it, ${f(p.brakeFootAbuseLbf / Math.max(1, p.brakeFootForceLimitLbf), 1)}× the ${f(p.brakeFootForceLimitLbf, 0)} lbf limit) with the tire turning: the pad sees N = (F a_F − M_B) η / (m_N ${L.sigma > 0 ? '+' : '−'} μ|m_T|) = ${f(L.nFlap)} lbf (the rolling direction and the dry pad μ ${f(p.brakePadMu, 2)} that give the larger force), the knee ${f(L.Rmag)} lbf at the pivot pin. The flap, pivot and mount are checked at yield level (limits raised by the safety factors, ${f(kW, 1)} on wood and ${f(kS, 1)} on steel): the brake may bend after it, but must not break.`;
  return singleCheck({
    id: 'brake-abuse', label: `Brake flap abuse, ${f(p.brakeFootAbuseLbf)} lbf stomp (yield level)`, group: 'Structure', refs: ['D-57', 'D-55', 'eng r2 N-8'],
    value: worstD.value, unit: worstD.unit, limit: worstD.limit, sense: worstD.sense, how, details: ds,
  });
}

// ── rear push-handle sockets (D-9, D-39) ────────────────────────────────────────────────────────────────────

export function handleSockets(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const h = brakeBundle(ctx).h;
  const al = allowables(ctx);
  const sa = { shear: 0.577 * (p.brakeSteelYieldPsi / p.steelSafetyFactor) };
  const F = p.handleHoldbackLbf;
  const Fp = F / 2; // per post
  const gripZ = p.rearHandleHeightIn;
  const lEff = Math.max(0.5, h.zTop - h.zFoot); // insertion length: foot to mouth
  const arm = gripZ - h.zFoot;
  const Rtop = (Fp * arm) / lEff;
  const M = Fp * (gripZ - h.zTop);
  const w = p.handlePostWidthIn, t = p.handlePostThickIn;
  // Build 3c M5: the post has a relief groove down its transom-side (tension) face to clear the socket screw heads; the section modulus is that of the notched rectangle (tension face = the notch).
  const gw = POST_RELIEF.widthIn, gd = POST_RELIEF.depthIn;
  const aRect = w * t, aNotch = gw * gd, aNet = aRect - aNotch;
  const yc = (aRect * (t / 2) - aNotch * (t - gd / 2)) / aNet; // centroid from the compression face
  const Inet = (w * t ** 3) / 12 + aRect * (yc - t / 2) ** 2 - ((gw * gd ** 3) / 12 + aNotch * (t - gd / 2 - yc) ** 2);
  const S = Inet / (t - yc); // to the tension face (the notch floor)
  const sigma = M / S;
  // E1 (3c-7): the bearing strip at the mouth and at the foot cannot be longer than the post's real insertion (at a 12 in socket it was assumed 3 in against a 1.7 in insertion).
  const contact = Math.max(0.25, Math.min(lEff, p.handleSocketDepthIn / 4));
  const bearTop = Rtop / (w * contact);
  const pinEnd = Math.max(0, h.zPin - h.zFoot); // post foot to the riding pin hole (wood below the hole)
  const dp = p.handlePinDiameterIn;
  const pinShear = F / (2 * circleA(dp));
  const wall = p.handleSocketWallIn;
  const tubeS = ((h.socketY * h.socketX ** 3 - (h.socketY - 2 * wall) * (h.socketX - 2 * wall) ** 3) / 12) / (h.socketX / 2);
  const tubeSigma = M / tubeS;
  // D-63: the 5/8 in access hole in the rear (flange) wall, opposite each screw, takes that much out of the compression/tension flange; the full mouth moment is taken at it (conservative: the screws are
  // 1.2 in down, where the moment has fallen).
  const holeW = Math.min(SOCKET_ACCESS_HOLE_IN, h.socketY - 2 * wall);
  const tubeI = (h.socketY * h.socketX ** 3 - (h.socketY - 2 * wall) * (h.socketX - 2 * wall) ** 3) / 12;
  const tubeINet = tubeI - holeW * wall * (h.socketX / 2 - wall / 2) ** 2 - (holeW * wall ** 3) / 12;
  const tubeSigmaNet = M / (tubeINet / (h.socketX / 2));
  const bolt = 0.25;
  const boltBear = Rtop / (2 * bolt * ctx.L.transom);
  // Aluminum 6061-T6 tube (plan item 5): allowable = yield / safety factor, for the tube in bending and for bearing on its walls.
  const alAllow = p.handleSocketYieldPsi / p.steelSafetyFactor;
  const wallBoltBear = Rtop / (2 * bolt * wall);
  const wallPinBear = (F / 2) / (dp * wall);
  // The couple's top reaction pulls the socket away from the transom: a 1" fender washer under each nut resists pull-through.
  const washerOd = 1;
  const washerA = (Math.PI / 4) * (washerOd ** 2 - (bolt + 0.03) ** 2);
  const pullThrough = Rtop / washerA;
  const ds: Detail[] = [
    detail('post bending at the socket mouth (net of the relief groove)', sigma, 'psi', al.oakBend, '<='),
    detail('post bearing at the socket mouth and foot', bearTop, 'psi', al.oakPerp, '<='),
    detail('wood below the riding pin hole (end distance, 4 pin diameters)', pinEnd, 'in', 4 * p.handlePinDiameterIn, '>='),
    detail('socket tube bending (6061-T6 aluminum)', tubeSigma, 'psi', alAllow, '<='),
    detail(`socket tube bending net of the ${f(SOCKET_ACCESS_HOLE_IN, 3)}" access hole (full mouth moment)`, tubeSigmaNet, 'psi', alAllow, '<='),
    detail('socket wall bearing at the bolt holes (aluminum)', wallBoltBear, 'psi', alAllow, '<='),
    detail('retaining pin bearing on the aluminum walls', wallPinBear, 'psi', alAllow, '<='),
    detail('bolt washer pull-through on the transom (oak ⊥ grain)', pullThrough, 'psi', al.oakPerp, '<='),
    detail('socket bolts bearing in the transom (2 × ¼")', boltBear, 'psi', al.oakDowel, '<='),
    detail('retaining pin double shear (whole pull)', pinShear, 'psi', sa.shear, '<='),
  ];
  const how = `A ${f(F)} lbf hold-back pull at the grip (${f(gripZ, 1)}" above the ground, D-9) shared by two uprights: ${f(Fp)} lbf each. Each upright is a cantilever from the socket mouth (${f(h.zTop, 1)}") to the grip: M = ${f(Fp)} × ${f(gripZ - h.zTop, 1)} = ${f(M)} lbf·in on a ${f(w, 2)}" × ${f(t, 2)}" post (σ ${f(sigma, 0)} psi). Top reaction ${f(Rtop)} lbf over the ${f(lEff, 1)}" insertion (bearing strip ${f(contact, 2)}", never longer than the insertion; the riding pin hole is ${f(pinEnd, 2)}" above the post foot, ${f(pinEnd / p.handlePinDiameterIn, 1)} pin diameters). Socket tube bending ${f(tubeSigma, 0)} psi (${f(tubeSigmaNet, 0)} psi net of the ${f(SOCKET_ACCESS_HOLE_IN, 3)}" access hole), bolt-hole wall bearing ${f(wallBoltBear, 0)} psi, washer pull-through ${f(pullThrough, 0)} psi on the oak transom, retaining pin ${f(pinShear, 0)} psi in double shear.`;
  const g = governing(ds, how);
  return singleCheck({
    id: 'handle-sockets', label: `Rear push-handle sockets${g.suffix ? ` (${g.suffix})` : ''}`, group: 'Structure', refs: ['D-9', 'D-39'],
    value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, how, details: ds,
  });
}


// ── sweep: the moving flap group vs everything else, released → applied ──────────────────────────────────────

export interface BrakeSweepResult {
  /** Smallest gap (in) between a moving brake part and any other solid over the stroke (the tire and the knee are measured separately). */
  minClearanceIn: number;
  moving: string;
  other: string;
  pose: number;
  /** Pad to the tread, released (nearest point) and applied (in). */
  padGapReleasedIn: number;
  padGapAppliedIn: number;
  /** Flap board and shoe block to the tire (nearest point over the stroke, in), and the lowest point of the moving parts released. */
  boardTireGapIn: number;
  groundMinZ: number;
  /** Least gap between the flap's front face and the knee's rear face over the swing (in). */
  shoulderGapIn: number;
  poses: number;
}

const sweepCache = new Map<string, BrakeSweepResult>();
const RIDER_KEYS = ['riderMassLb', 'riderGoalMassLb', 'riderMinMassLb', 'cargoMassLb'];
const BIG = 99;

export function brakeSweep(ctx: Ctx, steps = 8): BrakeSweepResult {
  const { p } = ctx;
  const g = brakeBundle(ctx).g;
  if (!g.ok) return { minClearanceIn: BIG, moving: '–', other: '–', pose: 0, padGapReleasedIn: BIG, padGapAppliedIn: BIG, boardTireGapIn: BIG, groundMinZ: BIG, shoulderGapIn: BIG, poses: 0 };
  const key = JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => !RIDER_KEYS.includes(k)))) + `|${steps}`;
  const hit = sweepCache.get(key);
  if (hit) return hit;
  const bctx = makeCtx(p, {});
  const fixedBrake = buildBrakeAt(bctx, 0, false).filter((x) => /^brake-(knee|backer)-/.test(x.id));
  const obstacles = [...ctx.parts.filter((x) => !x.payload && x.group !== 'reference' && !/^brake-/.test(x.id) && !/^wheel-R[LR]$/.test(x.id)), ...fixedBrake]
    .flatMap((x) => partOBBs(x).map((o) => ({ id: x.id, o, rad: Math.hypot(...o.half) })));
  const intended = (m: string, o: string) => /^brake-(knee|backer)-/.test(o) && /^brake-(flap|shoe|pad|cord|pivot-block|foot-tread)-/.test(m);
  // 2-D shapes of the flap group in the applied pose
  const b = g.board;
  const tf = b.thick;
  const corner = (s: number, h: number): V2 => [g.P[0] + s * g.u[0] - h * g.v[0], g.P[1] + s * g.u[1] - h * g.v[1]];
  const boardPoly: V2[] = [corner(b.s0, 0), corner(b.s1, 0), corner(b.s1, tf), corner(b.s0, tf)];
  const shoulderLow = corner(g.plan.sShoulder, tf); // the underside corner where the flap's flare starts, just behind the knee's rear face
  const r = g.r;
  let best = { minClearanceIn: BIG, moving: '–', other: '–', pose: 0 };
  let padRel = BIG, padApp = BIG, groundRel = BIG, boardTire = BIG, shoulderGap = BIG;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const moving = buildBrakeAt(bctx, s, true);
    const mob = moving.map((x) => { const o = partOBB(x); return { id: x.id, part: x, o, rad: Math.hypot(...o.half) }; });
    const at = (q: V2) => atPose(g, s, q);
    for (const poly of [boardPoly, g.shoe.outline]) {
      const pp = poly.map(at);
      boardTire = Math.min(boardTire, pointPolyGap(g.O, pp) - r);
    }
    shoulderGap = Math.min(shoulderGap, g.knee.x0 - at(shoulderLow)[0]);
    for (const m of mob) {
      const zmin = worldAABB(m.part).min[2];
      if (i === 0 && /^brake-(flap|shoe|pad)-/.test(m.id)) groundRel = Math.min(groundRel, zmin);
      if (/^brake-pad-/.test(m.id) && m.part.geometry.type === 'extrusion') {
        const gap = padGap(m.part, r);
        if (i === 0) padRel = Math.min(padRel, gap);
        if (i === steps) padApp = Math.min(padApp, gap);
      }
      for (const ob of obstacles) {
        if (intended(m.id, ob.id)) continue;
        const d = Math.hypot(m.o.center[0] - ob.o.center[0], m.o.center[1] - ob.o.center[1], m.o.center[2] - ob.o.center[2]) - m.rad - ob.rad;
        if (d > best.minClearanceIn) continue;
        const clr = -obbOverlap(m.o, ob.o);
        if (clr < best.minClearanceIn) best = { minClearanceIn: clr, moving: m.id, other: ob.id, pose: s };
      }
    }
  }
  const res: BrakeSweepResult = { ...best, padGapReleasedIn: padRel, padGapAppliedIn: padApp, boardTireGapIn: boardTire, groundMinZ: groundRel, shoulderGapIn: shoulderGap, poses: steps + 1 };
  if (sweepCache.size > 12) sweepCache.clear();
  sweepCache.set(key, res);
  return res;
}

/** Radial gap (in) of the pad's tread-side arc to the tread, from its extrusion outline in the world frame (nearest point). */
function padGap(pad: Part, r: number): number {
  if (pad.geometry.type !== 'extrusion') return BIG;
  const m = pad.transform;
  let best = Infinity;
  for (const q of pad.geometry.outline) {
    const x = m[0] * q[0] + m[4] * q[1] + m[12];
    const zz = m[2] * q[0] + m[6] * q[1] + m[14];
    best = Math.min(best, Math.hypot(x, zz - r) - r);
  }
  return best;
}

export function brakeClearance(ctx: Ctx, sweep: BrakeSweepResult = brakeSweep(ctx)): AnalysisCheck {
  const { p, L } = ctx;
  const g = brakeBundle(ctx).g;
  const kneeLow = g.knee.zBot;
  const details: Detail[] = [
    detail('pad to the tread, released (nearest point; the stroke is at the pad center)', sweep.padGapReleasedIn, 'in', 0.5 * p.brakePadGapIn, '>='),
    detail('pad to the tread, applied (touching)', Math.abs(sweep.padGapAppliedIn), 'in', 0.03, '<='),
    detail('flap and shoe block to the tire over the stroke (the nearest point)', sweep.boardTireGapIn, 'in', p.brakeClearanceIn, '>='),
    detail('lowest moving part (flap, shoe block, pad), released, vs minimum ground clearance', sweep.groundMinZ, 'in', p.minGroundClearanceIn, '>='),
    detail('knee bottom (the rail bottom) vs minimum ground clearance', kneeLow, 'in', p.minGroundClearanceIn, '>='),
    detail('flap flare shoulder (where it widens past the tongue) to the knee rear face over the swing', sweep.shoulderGapIn, 'in', 0.03, '>='),
    detail('pivot pin ahead of the tire front (a pin behind it would put the knee in the tire)', g.xh - g.r, 'in', 0.25, '>='),
    detail(`sign zone on the side (x up to ${SIGN_X_MAX_IN} in): the knee starts ahead of it`, g.knee.x0 - SIGN_X_MAX_IN, 'in', 0, '>='),
    detail('chock height under the knee (half an inch to spare)', g.knee.zBot - g.chock.height, 'in', 0.5, '>='),
    detail('wheel chock tangent to the tire ahead of the knee (chock back face clear of the knee face)', g.knee.x0 - g.chock.xBack, 'in', 0, '>='),
  ];
  const capped = sweep.minClearanceIn >= BIG - 1;
  const clearStatus: Status = judge(sweep.minClearanceIn, p.brakeClearanceIn, '>=');
  const hardFail = details.some((d) => d.util > 1);
  const status: Status = hardFail ? worst(clearStatus, 'fail') : clearStatus;
  void L;
  return singleCheck({
    id: 'brake-clear', label: 'Brake mechanism clearance over the stroke', group: 'Braking', refs: ['D-57', 'D-55', 'D-16'],
    value: sweep.minClearanceIn, unit: 'in', limit: p.brakeClearanceIn, sense: '>=', details, status,
    how: `The moving flap group (flap, pivot block, shoe block, pad, return cord) is posed at ${sweep.poses} points from released to applied (the flap turns through ${f(g.theta / RAD, 1)}° about the pin) and tested against every other solid (hull, rails, transom, storage box, push handle, lights, the knee backers and the tire's neighborhood): ${capped ? 'nothing within reach' : `the closest is ${sweep.moving} to ${sweep.other}, ${f(sweep.minClearanceIn, 2)}" at pose ${f(sweep.pose, 2)}`}. The tire and the knee are measured in the vertical plane: the board and shoe block clear the tire by at least ${f(sweep.boardTireGapIn, 2)}" through the swing, the pad hangs ${f(sweep.padGapReleasedIn, 2)}" off the tread at its nearest point released and lands on it applied; the flare shoulder of the flap stays ${f(sweep.shoulderGapIn, 2)}" from the knee's rear face (${f(SHOULDER_CLEAR_IN, 2)}" built in; the tongue itself runs in the knee slot). Ground: the flap group's lowest point is ${f(sweep.groundMinZ, 1)}" off the ground, the knee bottom ${f(kneeLow, 2)}" (limit ≥ ${f(p.minGroundClearanceIn, 1)}"). The knee starts at x = ${f(g.knee.x0, 1)}", clear of the sign zone on the side (to x = ${SIGN_X_MAX_IN}", D-57 item 9). The wheel chocks hang under the knee.`,
  });
}


/** All the braking and handle rows in one list (the call site in index.ts does not change when the brake design does). */
export function brakeChecks(ctx: Ctx): AnalysisCheck[] {
  return [brakeRatio(ctx), brakeForce(ctx), brakeSlow(ctx), brakeTraction(ctx), brakeClearance(ctx), brakeFlap(ctx), brakePivot(ctx), brakeMount(ctx), brakeReturn(ctx), parkHold(ctx), handleSockets(ctx), brakeAbuse(ctx)];
}
