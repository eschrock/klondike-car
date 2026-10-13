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
import { KNEE_NUT_FLAT_R_IN, SHOULDER_CLEAR_IN, WITHDRAWAL_WET_CM, dot2, flapHalfWidth, momentY, norm2, pointPolyGap, sub, type KneeLayer } from '../model/brake-layout';
import { SIGN_X_MAX_IN } from '../model/body';
import { makeCtx } from '../model/build-utils';
import { handleGeometry, POST_RELIEF, SOCKET_ACCESS_HOLE_IN, type HandleGeom } from '../model/handle';
import { SCREW_DIA_IN } from '../model/rear-mount';
import type { Part } from '../model/types';
import type { Ctx } from './context';
import { dualCheck, singleCheck, detail, governing, type CaseEval } from './dual';
import { RAD, contactsAt } from './geometry';
import { f } from './format';
import type { CaseData } from './loads';
import { cleavageVr, oakFeAt, sleevedPinFyb, uncTensileArea, woodPinCapacity } from './nds';
import { angleToX, angleToZ, pinGroupForces, pinPull, tabPatch } from './brake-pins';
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
/** The standard #8 x 1-1/4 wood screw of the brake (D-72). */
const BRAKE_SCREW_LEN_IN = 1.25;
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
    id: 'brake-force', label: 'Foot force on each flap to hold on the slope (info)', group: 'Braking', refs: ['D-57', 'D-55', 'D-13'], primary: 'operating',
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
  const padScrewLat = screwLat * (0.164 / 0.19); // #8 against the #10 value (D-72: the shoe, pad and pivot-block screws are all the standard #8 x 1-1/4)
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
    detail('shoe block screws, pad friction in lateral shear (2 x #8, each)', fric / 2, 'lbf', padScrewLat, '<='),
    detail('pad screws, pad friction in lateral shear (2 x #8, each)', fric / 2, 'lbf', padScrewLat, '<='),
  ];
  const how = `${loadText(L, g)}. Oak flap ${f(b.w, 2)}" × ${f(b.thick, 2)}" (full width): the foot (${f(tF)} lbf across the board) acts ${f(sF - sC, 1)}" past the pad, the bungee lifts back ${f(Math.abs(tB), 1)} lbf, so M at the pad = ${f(Mpad)} lbf·in (+ friction ${f(axial)} lbf × ${f(ecc, 2)}" off the center line), S = ${f(S, 3)} in³, σ = ${f(sig, 0)} psi (design ${f(al.oakBend, 0)}); τ = 1.5 V / A = ${f(tau, 0)} psi; foot-end deflection ${f(defl, 3)}" as a ${f(lo, 1)}" overhang (EI ${f(EI, 0)} lbf·in²). Tapered fender (D-65): ${f(g.plan.wTongue, 2)}" tongue at the pivot, S-curved flare to the full width by ${f(g.plan.sFull, 1)}" from the pin; the weakest station (the flap alone, M = pin reaction ${f(Tpin)} lbf × s over S = w(s) t²/6) is ${f(sAt, 1)}" from the pin at ${f(sigTaper, 0)} psi; shear in the tongue ${f(tauTongue, 0)} psi. Pad ${f(g.pad.length, 1)}" × ${f(g.pad.w, 1)}" = ${f(padArea, 1)} in²: ${f(press, 1)} psi (limit ${f(p.brakeLiningMaxPsi, 0)}). The pad friction μN = ${f(fric)} lbf is held by two #10 screws up through the shoe block into the flap (glued too) and two #8 screws through the pad.`;
  return governing(ds, how);
}

export function brakeFlap(ctx: Ctx): AnalysisCheck {
  return members('brake-flap', 'Brake flap, shoe block and pad', ctx, (L, g) => flapEval(ctx, L, g), ['D-57', 'D-2']);
}

// ── D-75: the cross-laminated knee. Each check counts only the layers whose grain suits it (the CLT practice of ignoring the cross layers in bending). ──
/** NDS 5.2.8: radial tension (tension perpendicular to the grain) design value for species other than southern pine = F_v / 3. Used for the cross-grain glue lines of the knee. */
export const CROSS_GRAIN_TENSION_OF_SHEAR = 1 / 3;
/** Rolling shear (shear across the grain in a plane that contains no fibers, the cross layers of CLT) as a share of F_v: the Wood Handbook gives about 18-28 %; 0.25 is used. */
export const ROLLING_SHEAR_OF_SHEAR = 0.25;
/** NDS 12.3.4 end-grain factor C_eg for a dowel-type fastener whose axis runs along the grain. */
export const END_GRAIN_CEG = 0.67;
/** Overlap (in) of the x range [a0, a1] with a layer. */
const overlapX = (q: KneeLayer, a0: number, a1: number) => Math.max(0, Math.min(q.x1, a1) - Math.max(q.x0, a0));
/** The layers whose grain runs along `grain`, with their x ranges clipped to [a0, a1]. */
const layersAlong = (g: BrakeGeom, grain: 'y' | 'z', a0 = g.knee.x0, a1 = g.knee.x1) => g.knee.layers.filter((q) => q.grain === grain).map((q) => ({ x0: Math.max(q.x0, a0), x1: Math.min(q.x1, a1) })).filter((q) => q.x1 > q.x0 + 1e-9);
/** Area-moment data of a set of x ranges of a section `h` deep in the other direction: total thickness, centroid x, I about that centroid (bending that varies along x), c to the farthest fiber. */
function xSection(rs: Array<{ x0: number; x1: number }>, h: number) {
  const t = rs.reduce((s2, q) => s2 + (q.x1 - q.x0), 0);
  if (t <= 1e-9) return { t: 0, xc: 0, I: 0, c: 1, S: 0 };
  const xc = rs.reduce((s2, q) => s2 + (q.x1 - q.x0) * (q.x0 + q.x1) / 2, 0) / t;
  const I = rs.reduce((s2, q) => s2 + h * ((q.x1 - q.x0) ** 3 / 12 + (q.x1 - q.x0) * ((q.x0 + q.x1) / 2 - xc) ** 2), 0);
  const c = Math.max(...rs.map((q) => Math.max(Math.abs(q.x0 - xc), Math.abs(q.x1 - xc))));
  return { t, xc, I, c, S: I / c };
}
/** The grain of the layer at x (the knee's rear layer behind it, the front layer ahead). */
const grainAt = (g: BrakeGeom, x: number): 'y' | 'z' => (g.knee.layers.find((q) => x >= q.x0 - 1e-9 && x <= q.x1 + 1e-9) ?? g.knee.layers[0]).grain;
/** Share of the x range [a0, a1] that lies in layers of `grain`. */
const shareAlong = (g: BrakeGeom, grain: 'y' | 'z', a0: number, a1: number) => g.knee.layers.filter((q) => q.grain === grain).reduce((s2, q) => s2 + overlapX(q, a0, a1), 0) / Math.max(1e-9, a1 - a0);

/** The pin's outboard reaction on the D-77 strap, its split among the strap's screws (elastic screw group: direct share plus the twist about the group's centroid), and the yaw push. */
export function strapLoads(ctx: Ctx, L: Loads, g: BrakeGeom) {
  const { p } = ctx;
  const pv = g.pivot, st = g.strap, wt = g.plan.wTongue, clr = p.brakePivotSlotClearIn;
  const R = L.Rmag;
  // Supports of the pin: the strap's mid-thickness (outboard) and the middle of the blind depth in the inboard ear; the load at the tongue's center.
  const armO = wt / 2 + clr + st.t / 2, armI = wt / 2 + clr + pv.blind / 2;
  const Ro = (R * armI) / (armO + armI), Ri = R - Ro;
  const dir: V2 = R > 1e-9 ? [L.Rk[0] / R, L.Rk[1] / R] : [0, 0];
  const Fo: V2 = [Ro * dir[0], Ro * dir[1]]; // the pin's push on the strap (the force on the knee's outboard support)
  const pts: V2[] = st.zs.flatMap((z) => st.xs.map((x): V2 => [x, z]));
  const n = pts.length;
  const c: V2 = [pts.reduce((m, q) => m + q[0], 0) / n, pts.reduce((m, q) => m + q[1], 0) / n];
  const J = pts.reduce((m, q) => m + (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2, 0);
  const r: V2 = [g.H[0] - c[0], g.H[1] - c[1]];
  const M = r[0] * Fo[1] - r[1] * Fo[0]; // in-plane moment of the pin force about the group's centroid
  const forces = pts.map((q): V2 => [Fo[0] / n - (J > 1e-9 ? (M * (q[1] - c[1])) / J : 0), Fo[1] / n + (J > 1e-9 ? (M * (q[0] - c[0])) / J : 0)]);
  const worstI = forces.reduce((bi, f2, i) => (norm2(f2) > norm2(forces[bi]) ? i : bi), 0);
  // Row resultants (the roof row is the upper z, the floor row the lower one).
  const row = (z: number): V2 => forces.reduce((m, f2, i) => (Math.abs(pts[i][1] - z) < 1e-9 ? [m[0] + f2[0], m[1] + f2[1]] : m), [0, 0] as V2);
  // Yaw: a sideways push F_s on the foot turns the tongue in the pocket about its two contacts (the knee's rear face and the nose): the strap takes P = F_s (x_nose - x_foot) / l at one of them.
  const xNose = g.H[0] + p.brakePivotEndIn, engaged = Math.max(0.25, xNose - g.knee.x0);
  const P = (p.brakeFlapSideLoadLbf * (xNose - g.F[0])) / engaged;
  return { R, Ro, Ri, armO, armI, Fo, pts, c, J, M, forces, worst: forces[worstI], worstPt: pts[worstI], rowTop: row(Math.max(...st.zs)), rowBot: row(Math.min(...st.zs)), P, engaged, xNose };
}

/** NDS-style screw withdrawal strength is `screwWithdrawal`; the pivot checks below are hand-checkable from the layout (pivot block, strap, inboard ear, pin). */
function pivotEval(ctx: Ctx, L: Loads, g: BrakeGeom): CaseEval {
  const { p } = ctx;
  const al = allowables(ctx);
  const a = allow(ctx);
  const pv = g.pivot, pl = g.plan, b = g.board, st = g.strap, kn = g.knee;
  const d = pv.dia;
  const wt = pl.wTongue, clr = p.brakePivotSlotClearIn;
  const S = strapLoads(ctx, L, g);
  const { R, Ro, Ri, armO, armI } = S;
  // Double shear: the pin is loaded at the tongue and held by the strap and the inboard ear, so two planes carry R.
  const shear = R / (2 * circleA(d));
  const Mpin = Math.max(Ro * armO, Ri * armI) - (R / 2) * (wt / 4);
  const Zpin = (Math.PI * d ** 3) / 32;
  const bend = Mpin / Zpin;
  // Oak bearing of the pin (dowel bearing), on the tongue (flap + block, grain along x, the load across it) and on the inboard ear's blind depth.
  // D-75: where the pin crosses an ACROSS ('y') layer it runs along that layer's grain (end-grain dowel bearing): C_eg on the ear's bearing when any of the pin's width lies in such a layer.
  const pinEg = shareAlong(g, 'y', g.H[0] - d / 2, g.H[0] + d / 2) > 1e-6 ? END_GRAIN_CEG : 1;
  const bearT = R / (d * wt), bearI = Ri / (d * pv.blind * pinEg);
  // Tear-out toward the loaded edge: two shear planes either side of the pin, the nearer edge (the load can come either way).
  const eT = Math.min(pv.edgeTongueUp, pv.edgeTongueDown), eE = Math.min(pv.edgeEarUp, pv.edgeEarDown);
  const tearT = R / (2 * eT * wt), tearI = Ri / (2 * eE * pv.blind);
  const tearAllowE = pinEg < 1 ? al.oakShear * ROLLING_SHEAR_OF_SHEAR : al.oakShear;
  const endD = p.brakePivotEndIn;
  // The pivot block takes its share of the pin's load (by thickness) and passes it into the flap through its screws (glue ignored): it pulls up when the pin pushes the flap down.
  const nBS = Math.max(1, Math.round(p.brakePivotBlockScrews));
  const penBS = BRAKE_SCREW_LEN_IN - pl.blockT - 0.1; // the #8 x 1-1/4 block screw (D-72), less 0.1 in of lead at the tip
  const wBS = screwWithdrawal(p, SCREW_DIA_IN[8], penBS);
  const shareBlock = (pl.blockT / (b.thick + pl.blockT)) * R;
  // ── D-77: the stainless STRAP (straight flat bar) on the pocket's open side carries the pin's outboard reaction Ro into its screws in the roof and the floor ──
  const plateAllow = p.brakeBackPlateYieldPsi / p.steelSafetyFactor;
  const hole = st.pinHole;
  const bearS = Ro / (d * st.t); // the pin bearing on the strap's hole
  const eS = Math.min(g.H[0] - st.x0, st.x1 - g.H[0], st.z1 - g.H[1], g.H[1] - st.z0); // pin center to the strap's nearer edge
  const tearS = Ro / (2 * st.t * Math.max(1e-6, eS - hole / 2));
  // The strap spans in z between its screw rows with the pin between them: in-plane bending from the fore-aft component, axial from the vertical one, on the net section at the pin hole.
  const zTopRow = Math.max(...st.zs), zBotRow = Math.min(...st.zs);
  const aUp = zTopRow - g.H[1], aDn = g.H[1] - zBotRow, span = Math.max(1e-6, aUp + aDn);
  const Mip = (Math.abs(S.Fo[0]) * aUp * aDn) / span;
  const Snet = (st.t * (st.w ** 3 - hole ** 3)) / (6 * st.w);
  const Nax = (Math.abs(S.Fo[1]) * Math.max(aUp, aDn)) / span;
  const sigS = Nax / ((st.w - hole) * st.t) + Mip / Snet;
  // Screws: #8 x 1-1/4 (D-72) in the outer layers' grain at their column: lateral (side grain, or C_eg in end grain) and withdrawal (end grain at half the side-grain value, as brake-return).
  const latSide = p.woodScrewLateralLbf * (st.screwDia / 0.19); // #8 against the #10 value (as the flap's pad screws)
  const eg = (x: number) => (grainAt(g, x) === 'y' ? END_GRAIN_CEG : 1);
  const latCap = Math.min(...st.xs.map((x) => latSide * eg(x)));
  const penS = BRAKE_SCREW_LEN_IN - st.t - 0.1;
  const wdCap = Math.min(...st.xs.map((x) => screwWithdrawal(p, st.screwDia, penS) * (grainAt(g, x) === 'y' ? 0.5 : 1)));
  const perCol = st.zs.length; // the yaw push lands at one end of the strap: the nearer column of screws takes it
  const wdLoad = S.P / perCol;
  // The yaw push bends the strap out of its plane between the rows (a band load over the tongue stack's height at mid-span, the full strap width).
  const hStack = pl.blockT + b.thick;
  const Mop = (S.P / 2) * Math.max(0, span / 2 - hStack / 4);
  const sigOp = Mop / ((st.w * st.t ** 2) / 6);
  // ── The roof and the floor carry the screw rows to the inboard ear as cantilevers along y, on the ACROSS layers only (D-77, CLT practice), and the outer layers that hold the screws are
  //    glued to them (glue-line rolling shear). Lever: the pocket's width (the screws sit at the outboard face; conservative, the bridge ahead also holds them). ──
  const lev = kn.yOut - pv.ySlot[0];
  const across = xSection(layersAlong(g, 'y', kn.x0, pv.slotEndX), 1);
  const plateBend = (Fr: V2, h: number) => (across.t > 1e-9 ? (Math.abs(Fr[1]) * lev) / ((across.t * h ** 2) / 6) + (Math.abs(Fr[0]) * lev) / ((h * across.t ** 2) / 6) : Infinity);
  const roofBend = plateBend(S.rowTop, kn.roof), floorBend = plateBend(S.rowBot, kn.floor);
  const glueRoll = norm2(S.worst) / (lev * Math.min(kn.roof, kn.floor));
  const screwEdge = Math.min(kn.roof, kn.floor) / 2 / st.screwDia;
  const screwTear = norm2(S.worst) / (2 * (Math.min(kn.roof, kn.floor) / 2) * Math.max(0.1, penS));
  const ds: Detail[] = [
    detail('pivot pin double shear (316)', shear, 'psi', a.boltShear, '<='),
    detail('pivot pin bending between the strap and the inboard ear (316)', bend, 'psi', a.bolt, '<='),
    detail('oak bearing of the pin on the tongue and block (dowel bearing)', bearT, 'psi', al.oakDowel, '<='),
    detail(`oak bearing on the inboard ear (blind hole depth${pinEg < 1 ? '; end grain of the ACROSS layer, C_eg 0.67' : ''})`, bearI, 'psi', al.oakDowel, '<='),
    detail('tear-out of the tongue toward the nearer edge (oak shear, two planes)', tearT, 'psi', al.oakShear, '<='),
    detail(`tear-out of the inboard ear toward the nearer edge (oak shear, two planes${pinEg < 1 ? '; rolling shear in the ACROSS layer' : ''})`, tearI, 'psi', tearAllowE, '<='),
    detail('edge distance, pin center to the nearer edge of the tongue stack (pin diameters, 1.5 D minimum)', eT / d, '×D', 1.5, '>='),
    detail('edge distance, pin center to the nearer edge of the inboard ear (pin diameters)', eE / d, '×D', 1.5, '>='),
    detail('end distance, pin center past the tongue end and the inboard ear rear face (pin diameters)', endD / d, '×D', 1.5, '>='),
    detail('pivot block screws, withdrawal each at the block share of the pin load (NDS, wet)', shareBlock / nBS, 'lbf', wBS, '<='),
    detail('pivot strap: pin bearing on the hole (stainless strap, D-77)', bearS, 'psi', plateAllow, '<='),
    detail('pivot strap: tear-out from the pin hole to the nearer edge, two planes (stainless strap)', tearS, 'psi', 0.577 * plateAllow, '<='),
    detail('pivot strap: edge distance, pin center to the nearer strap edge (pin diameters)', eS / d, '×D', 1.5, '>='),
    detail('pivot strap: tension + in-plane bending on the net section at the pin hole, spanning the screw rows (stainless strap)', sigS, 'psi', plateAllow, '<='),
    detail('pivot strap: out-of-plane bending from a sideways push on the flap foot (stainless strap, brakeFlapSideLoadLbf)', sigOp, 'psi', plateAllow, '<='),
    detail(`pivot strap screws: lateral, worst screw, direct + twist (#8 x 1-1/4 wood screws${latCap < latSide - 1e-9 ? ', end grain C_eg 0.67' : ', side grain of the UPRIGHT layers'})`, norm2(S.worst), 'lbf', latCap, '<='),
    detail('pivot strap screws: withdrawal from the sideways push, the nearer column (#8 x 1-1/4 wood screws, NDS, wet)', wdLoad, 'lbf', wdCap, '<='),
    detail('pivot strap screws: center to the pocket and to the knee top / underside (screw diameters, NDS 1.5 D minimum; the ACROSS layer glued over them stops a split)', screwEdge, '×D', 1.5, '>='),
    detail('pivot strap screws: tear-out toward the nearer end grain (the pocket or the knee top), two planes along the UPRIGHT layer\'s grain over the thread length (oak shear)', screwTear, 'psi', al.oakShear, '<='),
    detail('knee roof over the pocket: the upper screw row carried to the inboard ear, bending both axes (oak, the ACROSS layer only, D-77)', roofBend, 'psi', al.oakBend, '<='),
    detail('knee floor under the pocket: the lower screw row carried to the inboard ear, bending both axes (oak, the ACROSS layer only, D-77)', floorBend, 'psi', al.oakBend, '<='),
    detail('glue line from the screwed UPRIGHT layer into the ACROSS layer, worst screw (oak rolling shear, D-77)', glueRoll, 'psi', al.oakShear * ROLLING_SHEAR_OF_SHEAR, '<='),
  ];
  const how = `${loadText(L, g)}. D-65 pull-pin pivot, D-77 strap: a ${f(d, 3)}" clevis pin through the stainless strap on the knee's outboard face, the flap tongue (${f(wt, 2)}" wide, flap ${f(b.thick, 2)}" + pivot block ${f(pl.blockT, 2)}", the pocket ${f(clr, 3)}" wider each side) and ${f(pv.blind, 2)}" blind into the inboard ear, held by a hitch-pin clip outboard of the strap. DOUBLE shear: ${f(R)} / (2 × ${f(circleA(d), 4)} in²) = ${f(shear, 0)} psi (allowable ${f(a.boltShear, 0)}). Reactions ${f(Ro)} lbf at the strap and ${f(Ri)} lbf in the inboard ear, at arms ${f(armO, 2)}" and ${f(armI, 2)}" from the tongue's center: M = ${f(Mpin)} lbf·in on Z = π d³/32 = ${f(Zpin, 4)} in³ = ${f(bend, 0)} psi (allowable ${f(a.bolt, 0)}). Bearing: ${f(bearT, 0)} psi on the tongue, ${f(bearI, 0)} psi on the inboard ear${pinEg < 1 ? ' (C_eg 0.67: the pin runs along the ACROSS layer\'s grain)' : ''} (allowable ${f(al.oakDowel, 0)}). Strap ${f(st.t, 3)}" × ${f(st.w, 2)}" × ${f(st.len, 2)}" (allowable ${f(plateAllow, 0)} psi = ${f(p.brakeBackPlateYieldPsi, 0)} / ${f(p.steelSafetyFactor, 1)}): pin bearing ${f(bearS, 0)} psi; tear-out ${f(tearS, 0)} psi over ${f(eS, 2)}" to the nearer edge; the push (${f(S.Fo[0])}, ${f(S.Fo[1])}) lbf spans the screw rows ${f(aUp, 2)}" above and ${f(aDn, 2)}" below the pin: ${f(Mip)} lbf·in in plane on S_net ${f(Snet, 4)} in³ plus ${f(Nax)} lbf axial = ${f(sigS, 0)} psi. ${st.count} #8 × 1-1/4 screws (${st.xs.length} columns at x ${st.xs.map((x) => f(x, 2)).join(', ')}" in the outer layers, rows at z ${st.zs.map((z) => f(z, 2)).join(', ')}"): centroid (${f(S.c[0], 2)}, ${f(S.c[1], 2)}), twist ${f(S.M)} lbf·in, worst screw ${f(norm2(S.worst))} lbf against ${f(latCap)} lbf. Sideways push ${f(p.brakeFlapSideLoadLbf)} lbf at the foot: the tongue (${f(S.engaged, 2)}" in the pocket) pushes the strap out with P = ${f(p.brakeFlapSideLoadLbf)} × ${f(S.xNose - g.F[0], 2)} / ${f(S.engaged, 2)} = ${f(S.P)} lbf: ${f(wdLoad)} lbf withdrawal on each of the nearer column's screws (capacity ${f(wdCap)} lbf with ${f(penS, 2)}" of thread), out-of-plane strap bending ${f(sigOp, 0)} psi. Roof ${f(kn.roof, 2)}" and floor ${f(kn.floor, 2)}" carry their rows ${f(lev, 2)}" to the inboard ear on the ACROSS layer (${f(across.t, 2)}"): ${f(roofBend, 0)} and ${f(floorBend, 0)} psi. The pivot block's ${nBS} #8 × 1-1/4" screws (${f(penBS, 2)}" of thread in the flap, ${f(wBS)} lbf each) carry its ${f(shareBlock)} lbf share if the glue lets go.`;
  return governing(ds, how);
}

export function brakePivot(ctx: Ctx): AnalysisCheck {
  return members('brake-pivot', 'Brake pivot pin, strap and pivot block (pull pin)', ctx, (L, g) => pivotEval(ctx, L, g), ['D-65', 'D-77', 'D-57', 'D-2']);
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
  const dH = bd + 0.0625;
  // D-75 nut side: ONE backing plate under all the nuts (the old fender washers overlapped). Each bolt's pull spreads over its share of the plate (the worst bolt's tension on a quarter of
  // the plate, less its hole); the plate's overhang past the nut flats is a cantilever under that bearing pressure.
  const pl = bt.plate;
  const plateA = (pl.x1 - pl.x0) * (pl.z1 - pl.z0);
  const tribA = (plateA - n * (Math.PI / 4) * dH * dH) / n;
  const pull = T / tribA;
  const halfPitch = Math.max(bt.xs.length > 1 ? (bt.xs[1] - bt.xs[0]) / 2 : 0, bt.zs.length > 1 ? (bt.zs[1] - bt.zs[0]) / 2 : 0);
  const edgeOver = Math.max(bt.xs[0] - pl.x0, pl.x1 - bt.xs[bt.xs.length - 1], bt.zs[0] - pl.z0, pl.z1 - bt.zs[bt.zs.length - 1]);
  const overhang = Math.max(0, Math.max(halfPitch, edgeOver) - KNEE_NUT_FLAT_R_IN);
  const plateBend = (pull * overhang ** 2 / 2) / (pl.t ** 2 / 6);
  const plateAllow = p.brakeBackPlateYieldPsi / p.steelSafetyFactor;
  // D-75 head side: a USS flat washer under each head on the leg's outboard face. Under it the ACROSS layers show END grain (bearing up to F_c parallel), the UPRIGHT layer side grain (F_c perp):
  // the washer's capacity is the sum over the layers it covers (the worst bolt).
  const dW = p.brakeMountWasherOdIn;
  const washerA = (Math.PI / 4) * (dW ** 2 - dH ** 2);
  const fcPar = (p.oakCompParPsi * p.wetServiceFactorStrength) / p.woodSafetyFactor;
  const headCap = Math.min(...bt.xs.map((x) => { const sy = shareAlong(g, 'y', x - dW / 2, x + dW / 2); return washerA * (sy * fcPar + (1 - sy) * al.oakPerp); }));
  const contactA = (k.x1 - k.x0) * lay.chineH;
  const cBear = Cbear / contactA;
  // Knee arm: section just beyond the leg, bending from the force at the pin lever (y_pin − y_s), both axes. D-75: only the ACROSS ('y'-grain) layers carry it.
  const ys = g.y.face + k.legT + 0.1;
  const sec = kneeSection(g, ys);
  const lever = Math.max(0, g.y.wheel - ys);
  const armY = xSection(layersAlong(g, 'y'), sec.h);
  const sigK = armY.t > 1e-9 ? (Math.abs(Rk[1]) * lever) / ((armY.t * sec.h ** 2) / 6) + (Math.abs(Rk[0]) * lever) / armY.S : Infinity;
  const tauK = armY.t > 1e-9 ? (1.5 * Math.abs(Rk[1])) / (armY.t * sec.h) : Infinity;
  // D-75 leg: just above the top bolt row the leg alone carries the pin force into the bolt group; only the UPRIGHT ('z'-grain) layers carry it (in-plane bending about y, the out-of-plane
  // remainder about x after the chine-top contact, and the axial pull).
  const zr = Math.max(...bt.zs);
  const legZ = xSection(layersAlong(g, 'z'), k.legT);
  const Mleg = Math.abs(momentY([g.xh - legZ.xc, g.H[1] - zr], Rk));
  const yLegC = g.y.face + k.legT / 2;
  const MlegOut = Math.abs(Math.abs(Rk[1]) * (g.y.wheel - yLegC) - Cbear * (zc - zr));
  const sigLeg = legZ.t > 1e-9 ? Mleg / legZ.S + MlegOut / ((legZ.t * k.legT ** 2) / 6) + Math.abs(Rk[1]) / (legZ.t * k.legT) : Infinity;
  // D-75 bolt bearing in the leg: a bolt that lies in an ACROSS layer runs along its grain (end-grain dowel bearing, C_eg).
  const legEg = bt.xs.some((x) => grainAt(g, x) === 'y') ? END_GRAIN_CEG : 1;
  const bearLeg = V / (bd * k.legT * legEg);
  const ds: Detail[] = [
    detail('knee arm bending beyond the leg, both axes (oak, the ACROSS layers only, D-75)', sigK, 'psi', al.oakBend, '<='),
    detail('knee arm shear (oak, the ACROSS layers only)', tauK, 'psi', al.oakShear, '<='),
    detail('knee leg just above the top bolt row: in-plane and out-of-plane bending plus the pull (oak, the UPRIGHT layers only, D-75, D-77)', sigLeg, 'psi', al.oakBend, '<='),
    detail('mounting bolt shear, worst bolt, direct + twist (316)', shear, 'psi', a.boltShear, '<='),
    detail('mounting bolt tension from the overturning couple, worst (316)', sigT, 'psi', a.bolt, '<='),
    detail('mounting bolt shear + tension combined (316)', comb, '', 1, '<='),
    detail('bolt bearing in the rail + backer and the knee leg (oak, across the grain)', bear, 'psi', al.oakDowel, '<='),
    detail('bolt tear-out toward the rail edge (oak shear)', tear, 'psi', al.oakShear, '<='),
    detail(`bolt bearing in the knee leg (oak${legEg < 1 ? '; the bolts run along the grain of the ACROSS layers: end-grain dowel bearing, C_eg 0.67, D-75' : ''})`, bearLeg, 'psi', al.oakDowel, '<='),
    detail('nut backing plate bearing on the backer face, the worst bolt on its share of the plate (oak across the grain, D-75)', pull, 'psi', al.oakPerp, '<='),
    detail('nut backing plate bending past the nut flats (304 / 316 plate, D-75)', plateBend, 'psi', plateAllow, '<='),
    detail('head washer bearing on the knee leg, the worst bolt (oak: end grain where it covers an ACROSS layer, side grain on an UPRIGHT one, D-75)', T, 'lbf', headCap, '<='),
    detail('knee leg bearing on the chine / rail face at the top of the couple (oak across the grain)', cBear, 'psi', al.oakPerp, '<='),
  ];
  const how = `${loadText(L, g)}. ${n} × ${f(bd, 3)}" 316 bolts (${bt.xs.length} columns × ${bt.zs.length} rows, centroid x ${f(bt.cx, 2)}", z ${f(bt.cz, 2)}") through the ${f(k.legT, 2)}" knee leg, the ${f(g.rail.t, 2)}" rail and the ${f(g.backer.t, 2)}" backer glued to it. In plane: M = ${f(Mpl)} lbf·in about the bolt group (pin ${f(g.xh - bt.cx, 2)}" ahead of / ${f(g.H[1] - bt.cz, 2)}" above it), twist ${f(twist)} + direct ${f(direct)} = ${f(V)} lbf on the worst bolt (shear ${f(shear, 0)} psi, bearing ${f(bear, 0)} psi on ${f(tComp, 2)}"). Out of plane: the force acts ${f(e, 2)}" outboard of the hull face: M_x = ${f(Mx)} lbf·in pivots on the chine top (z ${f(zc, 2)}") into the ${bt.zs.length} bolt rows (T ${f(Tz)} lbf) and M_z = ${f(Mz)} lbf·in over the columns (T ${f(Tx)} lbf): worst bolt tension ${f(T)} lbf = ${f(sigT, 0)} psi on ${f(At, 4)} in², nut side: one ${f(pl.t, 3)}" × ${f(pl.x1 - pl.x0, 2)}" × ${f(pl.z1 - pl.z0, 2)}" backing plate, ${f(pull, 0)} psi on the worst bolt's ${f(tribA, 2)} in² share, ${f(plateBend, 0)} psi bending over a ${f(overhang, 2)}" overhang past the nut; head side: a ${f(dW, 3)}" washer, ${f(T)} lbf against ${f(headCap)} lbf (end grain of the across layers). D-75 cross-laminated knee: the arm counts only the ACROSS layers (${f(armY.t, 2)}"), the leg only the UPRIGHT layers (${f(legZ.t, 2)}": ${f(Mleg)} lbf·in in plane, ${f(MlegOut)} lbf·in out of plane at the top bolt row, σ ${f(sigLeg, 0)} psi); bolt bearing in the leg ${f(bearLeg, 0)} psi${legEg < 1 ? ' (end grain, C_eg 0.67)' : ''}. Knee arm section just beyond the leg ${f(sec.depth, 2)}" × ${f(sec.h, 2)}": σ ${f(sigK, 0)} psi. The knee bolts into the rail (backed by the glued ${f(g.backer.t, 2)}" doubler), not the 1/4" side panel.`;
  return governing(ds, how);
}

// ── D-78: the removable knee on two sleeved ball-lock pins (kneeMount = pins). Same row id (brake-mount), different truth: no bolts, backer or backing plate. ──
function pinMountEval(ctx: Ctx, L: Loads, g: BrakeGeom): CaseEval {
  const { p } = ctx;
  const al = allowables(ctx), a = allow(ctx);
  const pn = g.pins!, k = g.knee;
  const Rk = L.Rk;
  const sOd = pn.sleeveOd, sId = pn.sleeveId, dP = pn.dia;
  const gp = pinGroupForces(g, Rk);
  const pl = pinPull(p, g, Rk);
  const G = p.oakSpecificGravity;
  const FvP = p.oakNdsShearPsi * p.ndsWetFactorShear * p.brakePinLoadDurationFactor; // NDS lumber Fv' for splitting / tear-out (C_M shear 0.97, C_D of the pin)
  const Fyb = sleevedPinFyb(p.ss316BoltYieldPsi, p.brakeSleeveYieldPsi, sOd, sId, dP);
  const Zpin = (Math.PI * dP ** 3) / 32;
  // ── pin T: the tab (grain up) and the box rib stack (filler + rib, grain up; the 4 mm web is not counted) ──
  const tabT = pn.tab.t, hullT = pn.hull.filler + pn.hull.rib;
  const thT = angleToZ(gp.FT);
  const FeT = oakFeAt(G, sOd, thT);
  const zT = woodPinCapacity(p, { D: sOd, l1: hullT, l2: tabT, Fe1: FeT, Fe2: FeT, Fyb, thetaDeg: thT });
  // ── pin B: the knee leg (the pin lies in the middle ACROSS layer, along its grain: end grain, Fe perpendicular, C_eg) and the rail (grain along x) ──
  const endB = grainAt(g, pn.B.x) === 'y';
  const railT = pn.hull.rail;
  const thKnee = endB ? 90 : angleToZ(gp.FB), thRail = angleToX(gp.FB), thB = Math.max(thKnee, thRail);
  const FeKnee = oakFeAt(G, sOd, thKnee), FeRail = oakFeAt(G, sOd, thRail);
  const cEgB = endB ? END_GRAIN_CEG : 1;
  const zB = woodPinCapacity(p, { D: sOd, l1: k.legT, l2: railT, Fe1: FeKnee, Fe2: FeRail, Fyb, thetaDeg: thB }, cEgB);
  // steel
  const shearPin = Math.max(gp.Tmag, gp.Bmag) / circleA(dP);
  const MpinT = (gp.Tmag * Math.min(tabT, hullT)) / 2, MpinB = (gp.Bmag * Math.min(k.legT, railT)) / 2;
  const bendPin = Math.max(MpinT, MpinB) / Zpin;
  // oak bearing under the sleeve
  const bearT = gp.Tmag / (sOd * Math.min(tabT, hullT));
  const bearRail = gp.Bmag / (sOd * railT);
  const bearKnee = gp.Bmag / (sOd * k.legT * cEgB);
  // axial retention at the ball-lock
  // tab: glue patch on the knee's rear face, bending, tear-out behind the pin
  const tp = tabPatch(g, gp.FT);
  const tabH = pn.tab.z1 - pn.tab.z0;
  const Mtab = Math.abs(gp.FT[1]) * (pn.tab.x1 - pn.T.x);
  const sigTab = Mtab / ((tabT * tabH ** 2) / 6);
  const endT = pn.T.x - pn.tab.x0;
  const vrTab = cleavageVr(FvP, tabT, endT);
  const vrRib = cleavageVr(FvP, hullT, pn.rib.blockW / 2);
  const ribNet = Math.abs(gp.FT[1]) / (hullT * Math.max(1e-6, pn.rib.blockW - sOd));
  // rail: edge distance at B
  const eRail = pn.B.belowRailTop;
  const tearRail = Math.abs(gp.FB[1]) / (2 * Math.max(1e-6, eRail - sOd / 2) * railT);
  const vrRail = cleavageVr(FvP, railT, eRail);
  // thin wall: the sleeve sits in the middle ACROSS layer (hole along its grain) with `wall` of oak either side before the glued UPRIGHT layers
  const layerB = k.layers.find((q) => pn.B.x >= q.x0 - 1e-9 && pn.B.x <= q.x1 + 1e-9) ?? k.layers[0];
  const wall = Math.max(0, ((layerB.x1 - layerB.x0) - sOd) / 2);
  const wallBear = Math.abs(gp.FB[0]) / (sOd * k.legT);
  const eKneeB = Math.max(1e-6, pn.B.z - k.zBot - sOd / 2);
  const plugRoll = Math.abs(gp.FB[1]) / (2 * eKneeB * k.legT);
  // tab on the web: the tab's inboard face lies on the web over the rib block (backed by the rib and the filler, so no free-web bending): the contact at the hinge plus the yaw contact over the bearing area
  const bear = pn.tab.bearing;
  const bearWeb = (pl.cPad + pl.cYaw) / Math.max(1e-6, bear.area);
  // knee arm (as the bolted row) and the leg between pin B and the shoulder
  const ys = g.y.face + k.legT + 0.1;
  const sec = kneeSection(g, ys);
  const lever = Math.max(0, g.y.wheel - ys);
  const armY = xSection(layersAlong(g, 'y'), sec.h);
  const sigK = armY.t > 1e-9 ? (Math.abs(Rk[1]) * lever) / ((armY.t * sec.h ** 2) / 6) + (Math.abs(Rk[0]) * lever) / armY.S : Infinity;
  const tauK = armY.t > 1e-9 ? (1.5 * Math.abs(Rk[1])) / (armY.t * sec.h) : Infinity;
  const legZ = xSection(layersAlong(g, 'z'), k.legT);
  const zSh = k.zLeg; // the shoulder, where the arm joins the leg: from below only pin B acts
  const MlegIn = Math.abs(gp.FB[0]) * (zSh - pn.B.z) + Math.abs(gp.FB[1]) * Math.abs(pn.B.x - legZ.xc);
  const MlegOut = pl.B * (zSh - pn.B.z);
  const sigLeg = legZ.t > 1e-9 ? MlegIn / legZ.S + MlegOut / ((legZ.t * k.legT ** 2) / 6) + Math.abs(gp.FB[1]) / (legZ.t * k.legT) : Infinity;
  const ds: Detail[] = [
    detail(`pin T lateral load vs NDS single-shear capacity Z' (wet, sleeved, tab + box rib; mode ${zT.mode})`, gp.Tmag, 'lbf', zT.Zadj, '<='),
    detail(`pin B lateral load vs NDS single-shear capacity Z' (wet, sleeved, knee leg${endB ? ' end grain, C_eg 0.67' : ''} + rail; mode ${zB.mode})`, gp.Bmag, 'lbf', zB.Zadj, '<='),
    detail('pin steel single shear, worst pin (316 pin alone, the sleeve not counted)', shearPin, 'psi', a.boltShear, '<='),
    detail('pin steel bending, worst pin (316 pin alone: F l/2 over the thinner member, the sleeve not counted)', bendPin, 'psi', a.bolt, '<='),
    detail(`oak bearing under the sleeve at pin T (the ${f(Math.min(tabT, hullT), 2)}" thinner of the tab and the box rib stack)`, bearT, 'psi', al.oakDowel, '<='),
    detail(`oak bearing under the sleeve at pin B in the rail (${f(railT, 2)}")`, bearRail, 'psi', al.oakDowel, '<='),
    detail(`oak bearing under the sleeve at pin B in the knee leg (${f(k.legT, 2)}"${endB ? '; the hole runs along the grain of the ACROSS layer: end-grain dowel bearing, C_eg 0.67' : ''})`, bearKnee, 'psi', al.oakDowel, '<='),
    detail('pin T pull-out at the ball-lock: yaw + sideways push (verify: brakePinRetentionLbf is a placeholder, get the vendor rating)', pl.T, 'lbf', p.brakePinRetentionLbf, '<='),
    detail('pin B pull-out at the ball-lock: prying about the lowest tab contact + yaw + sideways push (verify: brakePinRetentionLbf is a placeholder, get the vendor rating)', pl.B, 'lbf', p.brakePinRetentionLbf, '<='),
    detail(`tab glue patch (the real ${f(tp.A, 2)} in²): pin T force over it vs the rolling-shear / glue limit (as brake-pivot)`, tp.total, 'psi', al.oakShear * ROLLING_SHEAR_OF_SHEAR, '<='),
    detail('tab glue patch, eccentric force (pin above the patch): peak compression on the knee\'s rear face (oak ⊥ grain)', tp.comp, 'psi', al.oakPerp, '<='),
    detail('tab glue patch, eccentric force: peak tension across the glue line (oak cross-grain tension, F_v / 3)', tp.tens, 'psi', al.oakShear * CROSS_GRAIN_TENSION_OF_SHEAR, '<='),
    detail('tab bending between pin T and the glue patch (oak, grain up, full tab height)', sigTab, 'psi', al.oakBend, '<='),
    detail(`tab behind pin T: splitting toward the rear end if the load reverses (NDS 3.4.3.3, ${f(endT, 2)}" = ${f(endT / dP, 1)} pin D = ${f(endT / sOd, 1)} sleeve D)`, Math.abs(gp.FT[0]), 'lbf', vrTab, '<='),
    detail(`box rib at pin T (brake-rib): splitting of the ${f(pn.rib.blockW, 2)}" block toward its edge, ${f(pn.rib.blockW / 2, 2)}" from the pin (NDS 3.4.3.3, filler + rib ${f(hullT, 2)}")`, Math.abs(gp.FT[0]), 'lbf', vrRib, '<='),
    detail('box rib at pin T (brake-rib): z part of the pin force on the shaft net of the sleeve hole (oak along the grain)', ribNet, 'psi', al.oakBend, '<='),
    detail(`pin B in the rail: tear-out toward the loaded edge ${f(eRail, 2)}" away (oak shear, two planes)`, tearRail, 'psi', al.oakShear, '<='),
    detail(`pin B in the rail: splitting toward the edge, ${f(eRail / sOd, 1)} sleeve D from it (NDS 3.4.3.3; the 4 D loaded-edge spacing rule is not met, this stands in for it)`, Math.abs(gp.FB[1]), 'lbf', vrRail, '<='),
    ...(endB ? [
      detail(`pin B thin wall: the sleeve in the ACROSS layer (${f(layerB.x1 - layerB.x0, 2)}") has only ${f(wall, 2)}" of oak each side before the glued UPRIGHT layers; the x part bears through it (oak ⊥ grain)`, wallBear, 'psi', al.oakPerp, '<='),
      detail(`pin B thin wall: the z part into the ACROSS layer's oak below the sleeve (${f(eKneeB, 2)}") and out through its two glue lines (rolling shear)`, plugRoll, 'psi', al.oakShear * ROLLING_SHEAR_OF_SHEAR, '<='),
    ] : []),
    detail(`tab on the web over the rib block: prying + yaw contact over the ${f(bear.area, 1)} in² the rib and filler back (oak ⊥ grain)`, bearWeb, 'psi', al.oakPerp, '<='),
    detail('knee arm bending beyond the leg, both axes (oak, the ACROSS layers only, D-75)', sigK, 'psi', al.oakBend, '<='),
    detail('knee arm shear (oak, the ACROSS layers only)', tauK, 'psi', al.oakShear, '<='),
    detail('knee leg from pin B to the shoulder: in-plane and out-of-plane bending plus the pull (oak, the UPRIGHT layers only, D-75, D-78)', sigLeg, 'psi', al.oakBend, '<='),
  ];
  const mode = (r: { modes: Record<string, number> }) => Object.entries(r.modes).map(([n, v]) => `${n} ${f(v, 0)}`).join(', ');
  const how = `${loadText(L, g)}. D-78 removable knee: NO bolts, backer or backing plate; two ${f(dP, 3)}" ball-lock pins, each in a ${f(sOd, 2)}" × ${f(sId, 3)}" stainless sleeve in every hole: B (x ${f(pn.B.x, 2)}", z ${f(pn.B.z, 2)}") through the knee leg and the ${f(railT, 2)}" rail, T (x ${f(pn.T.x, 2)}", z ${f(pn.T.z, 2)}") through the ${f(tabT, 2)}" tab and the box rib stack (filler + rib ${f(hullT, 2)}"; the ${f(pn.hull.web, 2)}" web is not counted). `
    + `IN PLANE: a rigid knee on the two pins (${f(gp.d, 2)}" apart), elastic group as the bolted row: the load at the pivot (${f(Rk[0])}, ${f(Rk[1])}) lbf has the moment M = ${f(Math.abs(gp.M))} lbf·in about the pins' centroid (${f(gp.c[0], 2)}, ${f(gp.c[1], 2)}), a twist M/d = ${f(Math.abs(gp.twist))} lbf on each pin across the pin line, plus the direct half ${f(gp.directMag)} lbf: pin T takes ${f(gp.Tmag)} lbf (${f(gp.FT[0])}, ${f(gp.FT[1])}), pin B ${f(gp.Bmag)} lbf (${f(gp.FB[0])}, ${f(gp.FB[1])}) on the knee. `
    + `CAPACITY (NDS wood-to-wood single shear, Table 12.3.1A/B; the sleeve is the bearing diameter D = ${f(sOd, 2)}", Fe = ${f(FeT, 0)} psi at pin T = Hankinson of ${f(oakFeAt(G, sOd, 0), 0)} ∥ and ${f(oakFeAt(G, sOd, 90), 0)} ⊥ at ${f(thT, 0)}° to the grain; sleeved-pin F_yb = (${f(p.ss316BoltYieldPsi, 0)} × ${f(dP, 3)}³ + ${f(p.brakeSleeveYieldPsi, 0)} × (${f(sOd, 2)}³ − ${f(sId, 3)}³)) / ${f(sOd, 2)}³ = ${f(Fyb, 0)} psi; wet C_M ${f(p.ndsWetFactorFasteners, 2)}, C_D ${f(p.brakePinLoadDurationFactor, 2)}, no group factor): T with the box rib ${f(hullT, 2)}" and the tab ${f(tabT, 2)}": modes ${mode(zT)} → Z = ${f(zT.Z, 0)} (${zT.mode}), Z' = ${f(zT.Zadj, 0)} lbf, utilization ${f(gp.Tmag / zT.Zadj, 2)}. `
    + `B with the knee leg ${f(k.legT, 2)}" (${endB ? `end grain, load ⊥ grain, Fe ${f(FeKnee, 0)}, C_eg 0.67` : `Fe ${f(FeKnee, 0)}`}) and the rail ${f(railT, 2)}" (Fe ${f(FeRail, 0)} at ${f(thRail, 0)}°; K_θ from ${f(thB, 0)}°): modes ${mode(zB)} → Z = ${f(zB.Z, 0)} (${zB.mode}), Z' = ${f(zB.Zadj, 0)} lbf (${f(zB.Z * zB.adjust / cEgB, 0)} without C_eg), utilization ${f(gp.Bmag / zB.Zadj, 2)}. `
    + `Steel: single shear ${f(shearPin, 0)} psi (allowable ${f(a.boltShear, 0)}), bending ${f(bendPin, 0)} psi (${f(a.bolt, 0)}); oak bearing ${f(bearT, 0)} psi at T, ${f(bearRail, 0)} in the rail, ${f(bearKnee, 0)} in the knee (allowable ${f(al.oakDowel, 0)}). `
    + `AXIAL PULL (the load acts ${f(pl.e, 2)}" outboard of the hull face): prying about the tab's lowest contact on the web (z ${f(pl.zContact, 2)}") M_x = ${f(pl.Mx)} lbf·in / ${f(pl.armB, 2)}" = ${f(pl.pryB)} lbf on B (T is above that contact on the flat tab: none); yaw M_z = ${f(pl.Mz)} lbf·in about ${pl.back ? "the tab's rear edge" : "the knee's front edge"} (x ${f(pl.xHinge, 2)}"), pins pulled in proportion to their distance (${f(pl.dT, 2)}" and ${f(pl.dB, 2)}"): T ${f(pl.yawT)}, B ${f(pl.yawB)} lbf; the ${f(p.brakeFlapSideLoadLbf)} lbf boot push amplified as brake-pivot does is ${f(pl.P)} lbf outward at the strap (x ${f(pl.xs, 2)}"): T ${f(pl.pushT)}, B ${f(pl.pushB)} lbf. Total pull T ${f(pl.T)}, B ${f(pl.B)} lbf against ${f(p.brakePinRetentionLbf, 0)} lbf (brakePinRetentionLbf: a PLACEHOLDER, the ball-lock retention is not published: get the vendor number). `
    + `TAB: glued to the knee's rear face on ${f(tp.A, 2)} in² (${f(tp.h, 2)}" of height); pin T sits ${f(tp.r[1], 2)}" above the patch's middle, so the patch carries ${f(tp.total * tp.A)} lbf with M = ${f(tp.M)} lbf·in on S = ${f(tp.S, 3)} in³: ${f(tp.direct, 0)} psi direct ± ${f(tp.bend, 0)} bending (compression ${f(tp.comp, 0)} ⊥ grain against ${f(al.oakPerp, 0)}; tension ${f(tp.tens, 0)} against ${f(al.oakShear * CROSS_GRAIN_TENSION_OF_SHEAR, 0)}); total force over the area ${f(tp.total, 0)} psi against the glue limit ${f(al.oakShear * ROLLING_SHEAR_OF_SHEAR, 0)} (F_v × ${ROLLING_SHEAR_OF_SHEAR}). Tab bending ${f(sigTab, 0)} psi; behind pin T ${f(endT, 2)}" of oak (${f(endT / dP, 1)} D): splitting V_r = 2/3 F_v' b d_e = 2/3 × ${f(FvP, 0)} × ${f(tabT, 2)} × ${f(endT, 2)} = ${f(vrTab)} lbf against the ${f(Math.abs(gp.FT[0]))} lbf x part (taken either way: the load can reverse). `
    + `BOX RIB at T: a ${f(pn.rib.blockW, 2)}" wide block from ${f(pn.T.z - pn.rib.blockZ0, 2)}" under the pin up (the shaft is ${f(pn.rib.w, 2)}"), ${f((pn.rib.blockW - sOd) / 2, 2)}" of oak each side of the sleeve (${f(pn.rib.blockW / 2 / sOd, 1)} sleeve D to the edge; NDS asks 4 D for a load across the grain toward an edge): V_r = 2/3 × ${f(FvP, 0)} × ${f(hullT, 2)} × ${f(pn.rib.blockW / 2, 2)} = ${f(vrRib)} lbf against ${f(Math.abs(gp.FT[0]))} lbf. `
    + `RAIL at B: ${f(eRail, 2)}" of rail above and below the sleeve (${f(eRail / sOd, 1)} sleeve D; the 4 D loaded-edge rule would need ${f(4 * sOd, 2)}"): tear-out ${f(tearRail, 0)} psi, splitting V_r = ${f(vrRail)} lbf against the ${f(Math.abs(gp.FB[1]))} lbf z part. `
    + (endB ? `PIN B IS THE TIGHTEST KNEE DETAIL: it sits in the middle ACROSS layer (${f(layerB.x1 - layerB.x0, 2)}" thick, hole along its grain, C_eg 0.67), which leaves only ${f(wall, 2)}" of oak between the sleeve and the glued UPRIGHT layers; the x part (${f(Math.abs(gp.FB[0]))} lbf) bears through that wall in compression (${f(wallBear, 0)} psi), the z part (${f(Math.abs(gp.FB[1]))} lbf) goes into ${f(eKneeB, 2)}" of oak below the sleeve and out through two glue lines: ${f(plugRoll, 0)} psi rolling shear. ` : '')
    + `TAB ON THE WEB: the tab lies on the web over the rib block (x ${f(bear.x0, 2)} to ${f(bear.x1, 2)}", z ${f(bear.z0, 2)} to ${f(bear.z1, 2)}", ${f(bear.area, 1)} in², backed by the rib and the filler; the knee leans on it from its lowest contact z ${f(bear.z0, 2)}"): contact ${f(pl.cPad)} lbf prying + ${f(pl.cYaw)} lbf yaw = ${f(bearWeb, 0)} psi against ${f(al.oakPerp, 0)}. `
    + `KNEE: arm beyond the leg ${f(sec.depth, 2)}" × ${f(sec.h, 2)}", ACROSS layers ${f(armY.t, 2)}": σ ${f(sigK, 0)} psi; the leg from B up to the shoulder (z ${f(zSh, 2)}", UPRIGHT layers ${f(legZ.t, 2)}"; the B hole is in the ACROSS layer, so the UPRIGHT layers are not cut): ${f(MlegIn)} lbf·in in plane, ${f(MlegOut)} lbf·in out of plane, ${f(Math.abs(gp.FB[1]))} lbf axial: ${f(sigLeg, 0)} psi.`;
  return governing(ds, how);
}

export function brakeMount(ctx: Ctx): AnalysisCheck {
  if (brakeBundle(ctx).g.mount === 'pins') return members('brake-mount', 'Brake knee on its two quick-release pins (removable, D-78)', ctx, (L, g) => pinMountEval(ctx, L, g), ['D-57', 'D-78', 'D-2']);
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
  const parts: Array<[string, CaseEval]> = [['flap', flapEval(ctx, L, g)], ['pivot', pivotEval(ctx, L, g)], ['mount', g.mount === 'pins' ? pinMountEval(ctx, L, g) : mountEval(ctx, L, g)]];
  const ds: Detail[] = [];
  for (const [name, e] of parts) {
    for (const d of e.details ?? []) {
      const k = /\(316\)|screws|NDS|pin|stainless/.test(d.name) && !/oak/.test(d.name) ? kS : kW;
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
  /** Least gap (in) between the moving flap group and the slotted knee over the stroke: the tongue and block in the slot (it is the slot clearance, D-66). */
  kneeGapIn: number;
  poses: number;
}

const sweepCache = new Map<string, BrakeSweepResult>();
const RIDER_KEYS = ['riderMassLb', 'riderGoalMassLb', 'riderMinMassLb', 'cargoMassLb'];
const BIG = 99;

export function brakeSweep(ctx: Ctx, steps = 8): BrakeSweepResult {
  const { p } = ctx;
  const g = brakeBundle(ctx).g;
  if (!g.ok) return { minClearanceIn: BIG, moving: '–', other: '–', pose: 0, padGapReleasedIn: BIG, padGapAppliedIn: BIG, boardTireGapIn: BIG, groundMinZ: BIG, shoulderGapIn: BIG, kneeGapIn: BIG, poses: 0 };
  const key = JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => !RIDER_KEYS.includes(k)))) + `|${steps}`;
  const hit = sweepCache.get(key);
  if (hit) return hit;
  const bctx = makeCtx(p, {});
  const fixedBrake = buildBrakeAt(bctx, 0, false).filter((x) => /^brake-(knee|backer)-/.test(x.id));
  const obstacles = [...ctx.parts.filter((x) => !x.payload && x.group !== 'reference' && !/^brake-/.test(x.id) && !/^wheel-R[LR]$/.test(x.id)), ...fixedBrake]
    .flatMap((x) => partOBBs(x).map((o) => ({ id: x.id, o, rad: Math.hypot(...o.half) })));
  // D-66: the slotted knee is real geometry now (its slot is open, the tongue and pivot block sit in it), so only the backer (a glued face on the far side of the rail) is exempt; the knee is MEASURED.
  const intended = (m: string, o: string) => /^brake-backer-/.test(o) && /^brake-(flap|shoe|pad|cord|pivot-block|foot-tread)-/.test(m);
  // 2-D shapes of the flap group in the applied pose
  const b = g.board;
  const tf = b.thick;
  const corner = (s: number, h: number): V2 => [g.P[0] + s * g.u[0] - h * g.v[0], g.P[1] + s * g.u[1] - h * g.v[1]];
  const boardPoly: V2[] = [corner(b.s0, 0), corner(b.s1, 0), corner(b.s1, tf), corner(b.s0, tf)];
  const shoulderLow = corner(g.plan.sShoulder, tf); // the underside corner where the flap's flare starts, just behind the knee's rear face
  const r = g.r;
  let best = { minClearanceIn: BIG, moving: '–', other: '–', pose: 0 };
  let padRel = BIG, padApp = BIG, groundRel = BIG, boardTire = BIG, shoulderGap = BIG, kneeGap = BIG;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const moving = buildBrakeAt(bctx, s, true);
    const mob = moving.map((x) => ({ id: x.id, part: x, boxes: partOBBs(x).map((o) => ({ o, rad: Math.hypot(...o.half) })) })); // tight box lists (the flap's plan outline, D-66: the slotted knee is measured, not skipped)
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
        for (const mb of m.boxes) {
          const d = Math.hypot(mb.o.center[0] - ob.o.center[0], mb.o.center[1] - ob.o.center[1], mb.o.center[2] - ob.o.center[2]) - mb.rad - ob.rad;
          const isKnee = /^brake-knee-/.test(ob.id);
          if (d > (isKnee ? kneeGap : best.minClearanceIn)) continue;
          const clr = -obbOverlap(mb.o, ob.o);
          if (isKnee) { kneeGap = Math.min(kneeGap, clr); continue; } // the tongue and block run in the knee's slot: judged against the slot clearance, not the 0.1 in rule
          if (clr < best.minClearanceIn) best = { minClearanceIn: clr, moving: m.id, other: ob.id, pose: s };
        }
      }
    }
  }
  const res: BrakeSweepResult = { ...best, padGapReleasedIn: padRel, padGapAppliedIn: padApp, boardTireGapIn: boardTire, groundMinZ: groundRel, shoulderGapIn: shoulderGap, kneeGapIn: kneeGap, poses: steps + 1 };
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
    detail('tongue and pivot block in the knee slot: least gap to the slot walls and its end over the whole swing (D-66: the slot is real; it is the slot clearance, 1/16 in)', sweep.kneeGapIn, 'in', Math.max(0.02, 0.5 * p.brakePivotSlotClearIn), '>='), // half the slot clearance: it must never close up (a grain of sand is OK, a touch is not)
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
