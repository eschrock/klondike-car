/**
 * Braking checks for the handler's FOOT brake (Phase 3c-3, D-55; it replaced the D-53 hand lever): the foot-lever ratio DERIVED from the pedal geometry
 * (`brakeGeometry`, model/brake-layout.ts), the FOOT force to hold the loaded cart on the design slope, rear-only traction (info), the members (pedal bar and arms, pivot
 * and bracket, shoe beam, shoes), the parking latch, the push-handle sockets, a foot-stomp abuse check and a sweep of the mechanism over its stroke.
 *
 * Load path (all forces in lbf, moments in lbf·in; every row is hand-checkable from its `how` string):
 *   W sinθ / μ = N_hold      total shoe normal force that holds the cart on the design slope; μ is the LOWER of the bonded-lining wet μ and the mud-fouled μ (`holdMu`)
 *   N = λ · N_hold           what the members are checked at (hard stomp / jerk on a parked cart, `brakeLoadFactor`)
 *   Each arm: the shoe force at the tread contact C, a vertical distance d below the pivot P, F_s = N_s (−cos β − σμ sin β, −sin β + σμ cos β) (σ = +1 cart rolling
 *   forward); moment about P = N_s d (cos β + σμ sin β) clockwise. The foot at the bar, a_app behind P, balances it: F_foot = (N d (cos β + σμ sin β) + F_spring a_app) / a_app,
 *   divided by the pivot efficiency for the force row. Rolling forward is the critical direction (the friction adds to the normal force's moment).
 *   Pivot reaction R = −(F_s + F_foot/2 + F_spring) on each arm; the bracket tongue carries R into four bolts in the rail.
 * Friction acts nearly vertically on the shoes (they sit within a few degrees of the axle line) and the pivot is directly above the contact, so there is no servo effect.
 */
import { obbOverlap, partOBB, partOBBs, worldAABB, type OBB } from '../model/bounds';
import { atPose, brakeGeometry, buildBrakeAt, shoeLengthIn, type BrakeGeom, type V2 } from '../model/brake';
import { HOOK_STANDOFF_IN, HOOK_TOOTH_IN, convexGap, polyXAt, polyZAt, rectPts, rot2 } from '../model/brake-layout';
import { makeCtx } from '../model/build-utils';
import { handleGeometry, type HandleGeom } from '../model/handle';
import type { Part, Vec3 } from '../model/types';
import type { Ctx } from './context';
import { dualCheck, singleCheck, detail, governing, type CaseEval } from './dual';
import { RAD, contactsAt } from './geometry';
import { f } from './format';
import type { CaseData } from './loads';
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

/** Friction used to size the hold load: the lower of the design (wet lining) μ and the mud-fouled μ. */
export const holdMu = (p: { brakePadMu: number; brakePadMuFouled: number }): number => Math.min(p.brakePadMu, p.brakePadMuFouled);

const circleA = (d: number) => (Math.PI / 4) * d * d;
const subV = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const len2 = (a: V2) => Math.hypot(a[0], a[1]);

/** Allowable stresses: A36 plate (yield / steel SF; shear 0.577; bearing 0.9), 316 bolts and pins, 6061-T6 aluminum. */
function allow(ctx: Ctx) {
  const { p } = ctx;
  const fy = p.brakeSteelYieldPsi / p.steelSafetyFactor;
  const fb = p.ss316BoltYieldPsi / p.steelSafetyFactor;
  const fa = p.brakeAluminumYieldPsi / p.steelSafetyFactor;
  return { steel: fy, steelShear: 0.577 * fy, steelBear: 0.9 * fy, bolt: fb, boltShear: 0.577 * fb, al: fa, alShear: 0.577 * fa, alBear: fa };
}

// ── load chain ──────────────────────────────────────────────────────────────────────────────────────────────

/** Loads on the mechanism for a total shoe normal force `nTot` and rolling direction σ (+1 forward). Forces are per ARM unless noted. */
interface Loads {
  /** Cart mass, the downslope pull, the hold normal force (total), the load factor, the normal force used (total) and per shoe. */
  W: number; down: number; nHold: number; lam: number; nTot: number; nShoe: number;
  /** Friction μ in the chain and the rolling direction. */
  mu: number; sigma: 1 | -1;
  /** Clockwise shoe moment about the pivot (per arm), spring moment (per arm), total foot force at the bar (both feet/arms), per-arm foot force. */
  mShoe: number; mSpring: number; foot: number; footArm: number;
  /** Shoe force on the arm (x, z), spring force on the arm (x, z), pivot reaction on the arm (x, z) and its magnitude. */
  Fs: V2; Fsp: V2; R: V2; Rmag: number;
  /** Vertical friction per shoe. */
  muN: number;
}

/** The chain for one rolling direction. `foot` overrides the foot force (abuse); otherwise it follows from the moment balance. */
function chain(ctx: Ctx, g: BrakeGeom, nTot: number, mu: number, sigma: 1 | -1, base: { W: number; down: number; nHold: number; lam: number }): Loads {
  const { p } = ctx;
  const Ns = nTot / 2;
  const cb = Math.cos(g.beta), sb = Math.sin(g.beta);
  const Fs: V2 = [Ns * (-cb - sigma * mu * sb), Ns * (-sb + sigma * mu * cb)];
  const mShoe = Ns * g.d * (cb + sigma * mu * sb);
  const sp = g.spring;
  const Aapp = atPose(g, 1, sp.a);
  const u = subV(sp.e, Aapp);
  const un = len2(u) || 1;
  const Fsp: V2 = [(sp.fApp * u[0]) / un, (sp.fApp * u[1]) / un];
  const mSpring = (p.brakeSpringForceLbf * g.aApp) / 2;
  const footArm = (mShoe + mSpring) / g.aApp;
  const R: V2 = [-(Fs[0] + Fsp[0]), -(Fs[1] + Fsp[1] - footArm)];
  return { ...base, nTot, nShoe: Ns, mu, sigma, mShoe, mSpring, foot: 2 * footArm, footArm, Fs, Fsp, R, Rmag: len2(R), muN: mu * Ns };
}

/** Member loads at the hold load × λ: the worse of the two rolling directions (larger pivot reaction), the foot force from the forward direction. */
function loadsAt(ctx: Ctx, c: CaseData, g: BrakeGeom): Loads {
  const { p } = ctx;
  const down = c.massLb * Math.sin(p.designSlopeDeg * RAD);
  const mu = holdMu(p);
  const nHold = down / mu;
  const base = { W: c.massLb, down, nHold, lam: p.brakeLoadFactor };
  const a = chain(ctx, g, p.brakeLoadFactor * nHold, mu, 1, base);
  const b = chain(ctx, g, p.brakeLoadFactor * nHold, mu, -1, base);
  const pick = b.Rmag > a.Rmag ? b : a;
  return { ...pick, foot: a.foot, footArm: a.footArm, mShoe: a.mShoe };
}

/** Loads for a foot force `F` on the bar with no reference to the rider (the abuse stomp): N follows from the moment balance in the direction that gives the larger N. */
function loadsFromFoot(ctx: Ctx, g: BrakeGeom, F: number): Loads {
  const { p } = ctx;
  const mu = p.brakePadMu;
  const cb = Math.cos(g.beta), sb = Math.sin(g.beta);
  const mSpring = (p.brakeSpringForceLbf * g.aApp) / 2;
  // F/2 per arm balances N_s d (cos β − μ sin β) + spring (σ = −1: the larger N)
  const nShoe = Math.max(0, ((F / 2) * g.aApp - mSpring) / (g.d * Math.max(1e-6, cb - mu * sb)));
  const l = chain(ctx, g, 2 * nShoe, mu, -1, { W: 0, down: 0, nHold: 0, lam: 0 });
  return { ...l, foot: F, footArm: F / 2 };
}

const loadText = (L: Loads, g: BrakeGeom) => L.lam === 0
  ? `Stomp F = ${f(L.foot)} lbf on the bar (${f(L.footArm)} per arm, ${f(g.aApp, 2)}" behind the pivot) with the tire pushing back: N = ${f(L.nTot)} lbf total (${f(L.nShoe)} per shoe); shoe moment about each pivot N_s d (cos β − μ sin β) = ${f(L.mShoe)} lbf·in; pivot reaction R = ${f(L.Rmag)} lbf per arm`
  : `Hold load W·sinθ/μ = ${f(L.W)} × sin θ / ${f(L.mu, 2)} = ${f(L.nHold)} lbf total shoe normal force; × λ ${f(L.lam, 2)} = N ${f(L.nTot)} lbf (${f(L.nShoe)} per shoe); shoe moment about each pivot N_s d (cos β ${L.sigma > 0 ? '+' : '−'} μ sin β) = ${f(L.nShoe)} × ${f(g.d, 2)} × ${f(Math.cos(g.beta) + L.sigma * L.mu * Math.sin(g.beta), 3)} = ${f(L.mShoe)} lbf·in; foot force on the bar F = (2 M + F_spring a) / a = ${f(L.foot)} lbf (${f(L.footArm)} per arm, ${f(g.aApp, 2)}" behind the pivot); pivot reaction R = ${f(L.Rmag)} lbf per arm`;

// ── foot-lever ratio, foot force, traction ──────────────────────────────────────────────────────────────────

export function brakeRatio(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const g = brakeBundle(ctx).g;
  const how = `Derived from the pedal geometry, not assumed (D-55). Each swing arm pivots on a bolt d = ${f(g.d, 2)}" directly above its shoe contact; the oak bar passes through the arm a_app = ${f(g.aApp, 2)}" behind the pivot at the applied pose (reach ${f(g.reach, 2)}" released, turned through ${f(g.thetaApp / RAD, 1)}°). Taking moments about the pivot, ratio = N_total / F_foot = a_app / (d (cos β ± μ sin β)) = ${f(g.aApp, 2)} / (${f(g.d, 2)} × (cos ${f(g.beta / RAD, 0)}° ± ${f(p.brakePadMu, 2)} sin ${f(g.beta / RAD, 0)}° = ${f(Math.cos(g.beta) + p.brakePadMu * Math.sin(g.beta), 3)} rolling forward, ${f(Math.cos(g.beta) - p.brakePadMu * Math.sin(g.beta), 3)} backward)). Rolling forward ${f(g.ratioFwd, 1)}:1, backward ${f(g.ratioRev, 1)}:1; the smaller, ${f(g.ratioCrit, 1)}:1 (${g.critical}), is the critical case and is what the force check uses. Target ≥ ${f(p.brakeLeverRatio, 1)}:1. Stroke: ${f(p.brakeShoeTravelIn, 3)}" at the shoe swings the arms ${f(g.thetaApp / RAD, 1)}°, which drops the bar ${f(g.barDrop, 2)}" (limit ${f(p.brakePedalTravelMaxIn, 1)}", status verify: feel-test the mock-up).${g.ok ? '' : ` NOT VALID: ${g.why || 'no ratio'}.`}`;
  const details: Detail[] = [
    detail('ratio, rolling forward', g.ratioFwd, ':1', p.brakeLeverRatio, '>='),
    detail('ratio, rolling backward', g.ratioRev, ':1', p.brakeLeverRatio, '>='),
    detail('pedal travel, released to applied (bar drop)', g.barDrop, 'in', p.brakePedalTravelMaxIn, '<='),
  ];
  return singleCheck({
    id: 'brake-ratio', label: 'Brake foot-lever advantage (derived from geometry)', group: 'Braking', refs: ['D-55', 'D-53'],
    value: g.ok ? g.ratioCrit : 0, unit: ':1', limit: p.brakeLeverRatio, sense: '>=', marginalAbs: 0.5, how, details,
    status: [judge(g.barDrop, p.brakePedalTravelMaxIn, '<=')].reduce((x, y) => worst(x, y), judge(g.ok ? g.ratioCrit : 0, p.brakeLeverRatio, '>=', 0.5)),
  });
}

/** Foot force (lbf) to hold a downslope pull `down` at lining friction `mu`, cart rolling forward, with the pivot efficiency. */
export function footForce(ctx: Ctx, g: BrakeGeom, down: number, mu: number): number {
  const { p } = ctx;
  const nTot = down / mu;
  const k = Math.cos(g.beta) + mu * Math.sin(g.beta);
  return (nTot * g.d * k) / g.aApp / p.brakeEfficiency + p.brakeSpringForceLbf;
}

export function brakeForce(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const th = p.designSlopeDeg * RAD;
  const g = brakeBundle(ctx).g;
  const ev = (c: CaseData): CaseEval => {
    const down = c.massLb * Math.sin(th);
    const muD = p.brakePadMu, muF = p.brakePadMuFouled;
    const Fd = footForce(ctx, g, down, muD); // bonded lining, wet
    const Ff = footForce(ctx, g, down, muF); // mud / slush fouled lining: the pass/fail case
    const F = Math.max(Fd, Ff);
    const lim = p.brakeFootForceLimitLbf;
    return {
      value: F, unit: 'lbf', limit: lim, sense: '<=', suffix: Ff >= Fd ? 'mud-fouled lining' : 'wet lining',
      details: [
        detail(`foot force, wet bonded lining μ ${f(muD, 2)}`, Fd, 'lbf', lim, '<='),
        detail(`foot force, mud / slush-fouled lining μ ${f(muF, 2)} (pass/fail)`, Ff, 'lbf', lim, '<='),
      ],
      how: `F = N d (cos β + μ sin β) / (a_app η) + F_spring, N = W·sinθ / μ = ${f(c.massLb)} × sin ${f(p.designSlopeDeg)}° / μ; W·sinθ = ${f(down)} lbf downslope. Geometry: d = ${f(g.d, 2)}", a_app = ${f(g.aApp, 2)}" (ratio ${f(g.ratioCrit, 1)}:1 before friction and efficiency, brake-ratio), η = ${f(p.brakeEfficiency, 2)}, spring ${f(p.brakeSpringForceLbf, 0)} lbf at the pedal. Wet bonded lining μ ${f(muD, 2)}: ${f(down / muD)} lbf total shoe normal force → ${f(Fd)} lbf under the foot. MUD / SLUSH-FOULED lining μ ${f(muF, 2)} (the shoes sit on the rear of the tread, the wettest part): ${f(down / muF)} lbf shoe normal force → ${f(Ff)} lbf. The row value is the larger of the two, ${f(F)} lbf, limit ≤ ${f(lim, 0)} lbf (pass/fail at BOTH μ; D-55: a foot, not a hand). The latch then holds the bar down (park-hold). Only the rear wheels brake (D-53): the front wheels roll.`,
    };
  };
  return dualCheck({
    id: 'brake-force', label: 'Foot force on the pedal to hold on the slope', group: 'Braking', refs: ['D-55', 'D-53', 'D-13', 'BRIEF §7'], primary: 'operating',
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
      how: `Parked nose-down on ${f(p.designSlopeDeg)}°, rear wheels only locked: N_r = W(cosθ·(L−x)/L − sinθ·h/L) = ${f(Nr)} lb; μ_ground·N_r = ${f(p.tireGroundMu, 2)} × ${f(Nr)} = ${f(p.tireGroundMu * Nr)} lbf vs W·sinθ = ${f(down)} lbf → ${f(ratio, 2)}× (${f(wet, 2)}× at wet-leaf μ 0.3). Info only (D-24); parked nose-up N_r is much larger. There are no front brakes (D-53): the pullers hold the tongue.`,
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

/** Net section of a plate of thickness t from z0 to z1 with a hole/slot from h0 to h1 (all z): area, second moment about its own centroid, centroid, extreme fiber distance. */
function netSection(z0: number, z1: number, h0: number, h1: number, t: number) {
  const segs: Array<[number, number]> = [];
  const lo = Math.max(z0, Math.min(z1, h0)), hi = Math.max(z0, Math.min(z1, h1));
  if (lo - z0 > 1e-9) segs.push([z0, lo]);
  if (z1 - hi > 1e-9) segs.push([hi, z1]);
  const A = segs.reduce((s, [a, b]) => s + t * (b - a), 0);
  const ybar = segs.reduce((s, [a, b]) => s + t * (b - a) * ((a + b) / 2), 0) / Math.max(1e-9, A);
  const I = segs.reduce((s, [a, b]) => s + (t * (b - a) ** 3) / 12 + t * (b - a) * ((a + b) / 2 - ybar) ** 2, 0);
  const c = Math.max(z1 - ybar, ybar - z0);
  return { A, I, ybar, c, S: I / Math.max(1e-9, c) };
}

function pedalEval(ctx: Ctx, L: Loads, g: BrakeGeom): CaseEval {
  const { p } = ctx;
  const a = allow(ctx), al = allowables(ctx);
  const t = p.brakePlateThickIn;
  const F = L.foot;
  const yA = (g.y.arm[0] + g.y.arm[1]) / 2;
  const span = 2 * yA;
  const wB = g.bar.w, hB = g.bar.h;
  // Oak bar: simply supported on the two arm slots, the foot at the middle.
  const Mbar = (F * span) / 4;
  const Sbar = (wB * hB ** 2) / 6;
  const sigBar = Mbar / Sbar;
  const tauBar = (1.5 * (F / 2)) / (wB * hB);
  const bearBar = L.footArm / (wB * t);
  // Arm plate: pedal reaction F/2 at the bar; the section at the pivot (hole), at the beam slot, and the slot web.
  const sec = (x: number, h0: number, h1: number) => {
    const zz = polyZAt(g.arm.outline, x);
    return zz ? netSection(zz[0], zz[1], h0, h1, t) : null;
  };
  // At the pivot section the pivot reaction R acts at the hole: the moment of everything behind it about P is zero, so the net section there carries R as tension/shear.
  const piv = sec(g.P[0], g.P[1] - g.arm.holeR, g.P[1] + g.arm.holeR);
  const sigPiv = piv ? L.Rmag / piv.A : Infinity;
  // Beam slot section: the bar reaction F/2 is (a_app minus the slot's offset from the pivot) behind it; the shoe thrust passes through the slot as axial load.
  const xs = g.beam.c[0];
  const slotLo = g.beam.c[1] - (g.beam.h + 0.0625) / 2, slotHi = g.beam.c[1] + (g.beam.h + 0.0625) / 2;
  const sl = sec(xs, slotLo, slotHi);
  const armLever = Math.max(0, g.aApp - (g.P[0] - xs));
  const sigSlot = sl ? (L.footArm * armLever * sl.c) / sl.I + L.nShoe / sl.A : Infinity;
  const edge = 0.8 - (p.brakePivotBoltDiameterIn / 2 + 0.02);
  const pivBear = L.Rmag / (p.brakePivotBoltDiameterIn * t);
  const tear = L.Rmag / (2 * edge * t);
  const ds: Detail[] = [
    detail('pedal bar bending at the foot (oak, between the arms)', sigBar, 'psi', al.oakBend, '<='),
    detail('pedal bar shear (oak)', tauBar, 'psi', al.oakShear, '<='),
    detail('pedal bar bearing across the grain on the arm slot edge (oak)', bearBar, 'psi', al.oakPerp, '<='),
    detail('swing arm tension through the pivot hole, net of the hole (A36)', sigPiv, 'psi', a.steel, '<='),
    detail('swing arm bending at the shoe beam slot, net of the slot (A36)', sigSlot, 'psi', a.steel, '<='),
    detail('pivot hole bearing on the bolt (A36)', pivBear, 'psi', a.steelBear, '<='),
    detail('pivot hole tear-out toward the arm front edge (A36)', tear, 'psi', a.steelShear, '<='),
  ];
  const how = `${loadText(L, g)}. Oak bar ${f(wB, 2)}" × ${f(hB, 2)}" on a ${f(span, 1)}" span between the arm slots: M = F L / 4 = ${f(F)} × ${f(span, 1)} / 4 = ${f(Mbar)} lbf·in, S = ${f(Sbar, 3)} in³, σ = ${f(sigBar, 0)} psi (design ${f(al.oakBend, 0)}); τ = 1.5 V / A = ${f(tauBar, 0)} psi; ${f(L.footArm)} lbf per slot bears across the grain on ${f(wB * t, 2)} in² of arm plate edge = ${f(bearBar, 0)} psi (oak ⊥ ${f(al.oakPerp, 0)}). Arm plate ${f(t, 3)}" A36: the bar's ${f(L.footArm)} lbf at ${f(g.aApp, 2)}" bends the section at the beam slot (${sl ? f(sl.S, 3) : '–'} in³ net of the slot, with the ${f(L.nShoe)} lbf shoe thrust axial: σ ${f(sigSlot, 0)} psi) while the pivot section just carries the reaction R (net area ${piv ? f(piv.A, 3) : '–'} in², σ ${f(sigPiv, 0)} psi); the pivot hole bears ${f(pivBear, 0)} psi on the ${f(p.brakePivotBoltDiameterIn, 3)}" bolt, tear-out ${f(tear, 0)} psi over ${f(edge, 2)}" of edge.`;
  return governing(ds, how);
}

export function brakePedal(ctx: Ctx): AnalysisCheck {
  return members('brake-lever', 'Brake pedal bar and swing arms', ctx, (L, g) => pedalEval(ctx, L, g), ['D-55', 'D-2']);
}

function pivotEval(ctx: Ctx, L: Loads, g: BrakeGeom): CaseEval {
  const { p } = ctx;
  const a = allow(ctx), al = allowables(ctx);
  const t = p.brakePlateThickIn;
  const pd = p.brakePivotBoltDiameterIn, bd = p.brakeBracketBoltDiameterIn;
  const R = L.Rmag;
  const Rx = Math.abs(L.R[0]), Rz = Math.abs(L.R[1]);
  const shear = R / circleA(pd); // one shear plane between the tongue and the arm
  const gap = g.y.arm[0] - g.y.tongue[1];
  const Mb = (R * (t + gap)) / 2;
  const sigBolt = Mb / ((Math.PI * pd ** 3) / 32);
  const bearT = R / (pd * t);
  const tgw = g.tongue.outline;
  const rearEdge = polyXAt(tgw, g.P[1]);
  const edgeT = rearEdge ? Math.max(0.05, g.P[0] - rearEdge[0] - g.arm.holeR) : 0.05;
  const tearT = R / (2 * edgeT * t);
  // Tongue neck: the thrust runs along it in tension at about pivot height; the worst vertical section between the beam flange and the boss, with the bending from the offset of the pivot from the section's middle.
  const tg = g.tongue;
  let sigNeck = 0, hNeck = Infinity;
  for (let k = 0; k <= 10; k++) {
    const x = tg.neck.x0 + 0.05 + ((tg.neck.x1 - 0.1 - tg.neck.x0 - 0.05) * k) / 10;
    const zz = polyZAt(tg.outline, x);
    if (!zz) continue;
    const h = zz[1] - zz[0];
    hNeck = Math.min(hNeck, h);
    const e = Math.abs(g.P[1] - (zz[0] + zz[1]) / 2);
    sigNeck = Math.max(sigNeck, Rx / (t * h) + (6 * Rx * e) / (t * h * h) + Rz / (t * h));
  }
  // Flange bolts: two vertical bolts through the beam in front of the rod. The thrust acts along the tongue plane, off their centroid in plan: direct share plus the plan couple.
  const fl = tg.flange;
  const yb = fl.bolts.map((b) => b[1]);
  const yBar = yb.reduce((x, y) => x + y, 0) / yb.length;
  const yPlane = (g.y.tongue[0] + g.y.tongue[1]) / 2;
  const sumDy2 = yb.reduce((x, y) => x + (y - yBar) ** 2, 0);
  const fb = yb.map((y) => Rx / yb.length + (sumDy2 > 1e-9 ? (Rx * (yBar - yPlane) * (yBar - y)) / sumDy2 : 0));
  const fMax = Math.max(...fb.map(Math.abs));
  const boltShear = fMax / circleA(bd);
  const boltTen = (Rz / yb.length) / 0.0775; // 3/8-16 tensile area 0.0775 in²; vertical share of the reaction (and the flange sits on the beam, so this is also a bound)
  const edgeD = (fl.bolts[0][0] - (tg.beam.x - tg.beam.thick / 2)) / bd; // end distance to the rear face of the beam, the way the bolts push
  const edgeRed = Math.min(1, edgeD / 4); // NDS: under 4 bolt diameters of end distance the bearing capacity falls in proportion
  const bearBeam = fMax / (bd * tg.beam.depth) / edgeRed;
  const bearFlange = fMax / (bd * t);
  // Beam: the thrust enters the beam at the rod clamp near the wheel and leaves through the flange bolts (a plan couple), and the rod bears sideways on its groove.
  const yHub = tg.beam.halfLen - 0.6;
  const Mbeam = L.nShoe * Math.max(0, yHub - yBar);
  const Sbeam = (tg.beam.depth * (tg.beam.thick - bd) ** 2) / 6;
  const sigBeam = Mbeam / Sbeam;
  const lGroove = Math.max(0.5, tg.beam.halfLen - yBar);
  const bearGroove = L.nShoe / (p.axleDiameterIn * lGroove);
  const ds: Detail[] = [
    detail('pivot bolt single shear (316)', shear, 'psi', a.boltShear, '<='),
    detail('pivot bolt bending across the plate gap (316)', sigBolt, 'psi', a.bolt, '<='),
    detail('pivot bolt bearing on the bracket tongue (A36)', bearT, 'psi', a.steelBear, '<='),
    detail('pivot hole tear-out toward the tongue rear edge (A36)', tearT, 'psi', a.steelShear, '<='),
    detail('bracket neck tension plus bending, worst section (A36)', sigNeck, 'psi', a.steel, '<='),
    detail('flange bolts shear, worse of two (316)', boltShear, 'psi', a.boltShear, '<='),
    detail('flange bolts tension from the vertical reaction (316)', boltTen, 'psi', a.bolt, '<='),
    detail('flange bolt bearing in the oak axle beam, across the grain (reduced if the end distance is under 4 D)', bearBeam, 'psi', al.oakDowel, '<='),
    detail('flange bolt bearing on the flange (A36)', bearFlange, 'psi', a.steelBear, '<='),
    detail('axle beam plan bending from the thrust couple, net of one bolt hole (oak)', sigBeam, 'psi', al.oakBend, '<='),
    detail('axle rod bearing sideways on the beam groove wall (oak ⊥ grain)', bearGroove, 'psi', al.oakPerp, '<='),
  ];
  const how = `${loadText(L, g)}. The pivot reaction R = (${f(L.R[0])}, ${f(L.R[1])}) lbf acts on the ${f(pd, 3)}" 316 bolt in single shear (${f(shear, 0)} psi) with a ${f(gap, 3)}" gap between the plates (bending ${f(sigBolt, 0)} psi) and bears ${f(bearT, 0)} psi on the ${f(t, 3)}" tongue. The thrust is carried back along the bracket neck (${f(hNeck, 2)}" deep at its thinnest: ${f(sigNeck, 0)} psi with the bending from its offset from the pivot) to a flange lying on the top of the rear axle beam; two ${f(bd, 3)}" 316 bolts pass down through the flange and the beam in front of the rod (${f(Math.abs(fl.bolts[1][1] - fl.bolts[0][1]), 2)}" apart across the cart, the thrust line ${f(yBar - yPlane, 2)}" off their centroid): worst bolt ${f(fMax)} lbf = ${f(boltShear, 0)} psi shear, ${f(bearBeam, 0)} psi bearing across the grain of the ${f(tg.beam.depth, 2)}" deep oak beam (${f(al.oakDowel, 0)} design), end distance ${f(edgeD, 1)} D to the beam's rear face. The load is a CLOSED LOOP in the axle (shoe, tire, hub, rod, beam, bracket, arm): the rod pushes sideways on the beam groove with ${f(L.nShoe)} lbf over ${f(lGroove, 1)}" (${f(bearGroove, 0)} psi, oak ⊥ ${f(al.oakPerp, 0)}), and the couple between the rod clamp and the bolts (${f(Mbeam)} lbf·in) bends the beam ${f(sigBeam, 0)} psi in plan, so the rails, hangers and hold-down angles carry none of it. (The beam's vertical bending at the two bolt holes is a note for beam-rear: the holes are ${f(yBar, 1)}" from center, outboard of the hangers.)`;
  return governing(ds, how);
}

export function brakePivot(ctx: Ctx): AnalysisCheck {
  return members('brake-links', 'Brake pivot bolts, brackets and axle beam bolts', ctx, (L, g) => pivotEval(ctx, L, g), ['D-55', 'D-2']);
}

function beamEval(ctx: Ctx, L: Loads, g: BrakeGeom): CaseEval {
  const { p } = ctx;
  const a = allow(ctx);
  const b = g.beam;
  const wall = b.wall;
  const t = p.brakePlateThickIn;
  // Plan bending: the beam is a continuous beam over the two arm slots with each shoe thrust N_s at the overhang (arm to shoe = lever).
  const yArm = (g.y.arm[0] + g.y.arm[1]) / 2;
  const lever = g.y.shoeC - yArm;
  const Mplan = L.nShoe * lever;
  const Sz = (b.h * b.w ** 3 - (b.h - 2 * wall) * (b.w - 2 * wall) ** 3) / (6 * b.w); // bending about z: depth b.w is the strong way
  const Sy = (b.w * b.h ** 3 - (b.w - 2 * wall) * (b.h - 2 * wall) ** 3) / (6 * b.h); // vertical bending (friction)
  const Mv = L.muN * lever;
  const sigPlan = Mplan / Sz;
  const sigVert = Mv / Sy;
  const sigSum = sigPlan + sigVert;
  const eccX = b.w / 2 + (g.rBack - g.r) * Math.cos(g.beta); // friction acts at the tread, ahead of the beam axis by half the depth plus the shoe thickness
  const T = L.muN * eccX;
  const Am = (b.w - wall) * (b.h - wall);
  const tau = T / (2 * Am * wall);
  const slotBear = L.nShoe / (t * b.h);
  const bolt = 0.25;
  const shoeBoltShear = L.muN / circleA(bolt);
  const ds: Detail[] = [
    detail('beam plan bending between the arm and the shoe, plan + vertical friction summed (6061-T6)', sigSum, 'psi', a.al, '<='),
    detail('beam torsion from the shoe friction offset (6061-T6)', tau, 'psi', a.alShear, '<='),
    detail('beam wall bearing on the arm slot edge (6061-T6)', slotBear, 'psi', a.alBear, '<='),
    detail('shoe bolt shear from the vertical friction (316)', shoeBoltShear, 'psi', a.boltShear, '<='),
  ];
  const how = `${loadText(L, g)}. Shoe beam ${f(b.w, 2)}" deep × ${f(b.h, 2)}" × ${f(wall, 3)}" wall 6061-T6 tube (S about the vertical axis = ${f(Sz, 3)} in³, about the horizontal ${f(Sy, 3)} in³; allowable ${f(a.al, 0)} psi), ${f(2 * g.y.beamHalf, 1)}" long, resting in the arm slots at ±${f(yArm, 2)}" with the shoe thrust N_s = ${f(L.nShoe)} lbf at ±${f(g.y.shoeC, 2)}": a continuous beam, M = N_s × ${f(lever, 2)}" = ${f(Mplan)} lbf·in in plan (σ ${f(sigPlan, 0)} psi), constant between the arms, plus the vertical friction μN = ${f(L.muN)} lbf over the same overhang (${f(Mv)} lbf·in, σ ${f(sigVert, 0)} psi): sum ${f(sigSum, 0)} psi. Torsion from the friction ${f(eccX, 2)}" off the tube axis: ${f(tau, 0)} psi. The thrust bears ${f(slotBear, 0)} psi on the ${f(t, 3)}" arm edge.`;
  return governing(ds, how);
}

export function brakeBeam(ctx: Ctx): AnalysisCheck {
  return members('brake-beam', 'Brake shoe beam and slots', ctx, (L, g) => beamEval(ctx, L, g), ['D-55', 'D-2']);
}

function shoesEval(ctx: Ctx, L: Loads, g: BrakeGeom): CaseEval {
  const { p } = ctx;
  const a = allow(ctx);
  const len = shoeLengthIn(p);
  const wd = g.y.pad[1] - g.y.pad[0];
  const area = len * wd;
  const pressure = L.nShoe / area;
  const bt = p.brakeShoeBackThickIn;
  // The back plate spans the 1/4" mounting bolt between the beam wall (a point support) and the lining face: bending of a strip len long under a central line load of N.
  const Sback = (wd * bt ** 2) / 6;
  const sigBack = (L.nShoe * len) / 4 / Sback;
  const ds: Detail[] = [
    detail('lining contact pressure', pressure, 'psi', p.brakeLiningMaxPsi, '<='),
    detail('steel back plate bending between the lining and the center bolt', sigBack, 'psi', a.steel * 2, '<='),
  ];
  const how = `${loadText(L, g)}. Per shoe N = ${f(L.nShoe)} lbf on ${f(len, 2)}" × ${f(wd, 2)}" of lining = ${f(area, 1)} in²: ${f(pressure, 1)} psi (limit ${f(p.brakeLiningMaxPsi, 0)}). The ${f(bt, 3)}" steel back is a purchased lined shoe; bent as a strip between the beam wall and the lining under the whole N it sees ${f(sigBack, 0)} psi (allowable doubled: the shoe is a hardened-back part).`;
  return governing(ds, how);
}

export function brakeShoes(ctx: Ctx): AnalysisCheck {
  return members('brake-shoes', 'Brake shoes (lining pressure and back plate)', ctx, (L, g) => shoesEval(ctx, L, g), ['D-55', 'D-56']);
}

// ── parking latch (hook on the transom over a stud on the toe guard) ─────────────────────────────────────────

export function parkHold(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const th = p.designSlopeDeg * RAD;
  const g = brakeBundle(ctx).g;
  const a = allow(ctx), al = allowables(ctx);
  const t = p.brakePlateThickIn, tg = p.brakeGuardThickIn;
  const hk = g.hook, st = g.stud;
  const bd = p.brakeBracketBoltDiameterIn;
  const ds0 = p.brakeLatchPinDiameterIn;
  const hookMid = (hk.x0 + hk.x1) / 2;
  const lL = g.P[0] - hookMid; // lever of the latch force about the pivots (the tooth sits at the hook's mid-plane)
  const stemX = atPose(g, 1, [st.x0, st.c[1]])[0];
  const cant = Math.max(0.1, Math.abs(hookMid - stemX)); // stud cantilever from the guard face to the tooth mid-plane
  const ev = (c: CaseData): CaseEval => {
    const mu = holdMu(p);
    const down = c.massLb * Math.sin(th);
    const nHold = down / mu;
    // The latch holds the bar down against the shoe moment (rolling forward, the larger) and the springs.
    const kF = Math.cos(g.beta) + mu * Math.sin(g.beta);
    const mTot = (n: number) => n * g.d * kF + p.brakeSpringForceLbf * g.aApp;
    const F1 = mTot(nHold) / lL;
    const FL = mTot(p.brakeLoadFactor * nHold) / lL;
    const hookNet = FL / (t * (1 - (0.4 + 0.04)));
    const toothReach = Math.max(0.05, st.y - 1 / 2);
    const toothSection = (t * HOOK_TOOTH_IN ** 2) / 6;
    const sigTooth = (FL * toothReach) / toothSection;
    const tauTooth = FL / (t * HOOK_TOOTH_IN);
    const bearTooth = FL / (ds0 * t);
    const S = (Math.PI * ds0 ** 3) / 32;
    const sigStud = (FL * cant) / S;
    const tauStud = FL / circleA(ds0);
    const bearGuard = FL / (ds0 * tg);
    const bendBolt = (FL * (HOOK_STANDOFF_IN + t / 2)) / ((Math.PI * bd ** 3) / 32);
    const shearBolt = FL / circleA(bd);
    const bearTransom = FL / (bd * ctx.L.transom);
    const edgeTransom = (hk.bolt[1] - (ctx.L.deckTop - p.crossmemberDepthIn));
    const tearTransom = FL / (2 * edgeTransom * ctx.L.transom);
    const yA = (g.y.arm[0] + g.y.arm[1]) / 2;
    const Mbar = (FL * 2 * yA) / 4;
    const sigBar = Mbar / ((g.bar.w * g.bar.h ** 2) / 6);
    const peel = (FL * cant) / 0.5 / 4; // tension per guard bolt: the stud moment over the 0.5" lap, shared by four bolts
    const tenBolt = peel / (0.032);
    const ground = (p.tireGroundMu * c.massLb * Math.cos(th)) / Math.max(1e-9, c.massLb * Math.sin(th));
    const ds: Detail[] = [
      detail('hook strap tension at the bolt hole (net section, A36)', hookNet, 'psi', a.steel, '<='),
      detail('hook tooth bending (A36)', sigTooth, 'psi', a.steel, '<='),
      detail('hook tooth shear (A36)', tauTooth, 'psi', a.steelShear, '<='),
      detail('stud bearing on the tooth (A36)', bearTooth, 'psi', a.steelBear, '<='),
      detail('stud bending, cantilever from the toe guard (316)', sigStud, 'psi', a.bolt, '<='),
      detail('stud shear (316)', tauStud, 'psi', a.boltShear, '<='),
      detail('stud bearing in the toe guard plate (aluminum)', bearGuard, 'psi', a.alBear, '<='),
      detail('guard bolts, tension from the stud moment (316, 1/4-20)', tenBolt, 'psi', a.bolt, '<='),
      detail('hook bolt bending across the spacer (316)', bendBolt, 'psi', a.bolt, '<='),
      detail('hook bolt shear (316)', shearBolt, 'psi', a.boltShear, '<='),
      detail('hook bolt bearing in the oak transom', bearTransom, 'psi', al.oakDowel, '<='),
      detail('hook bolt tear-out toward the transom lower edge (oak shear)', tearTransom, 'psi', al.oakShear, '<='),
      detail('pedal bar bending under the latch pull (oak)', sigBar, 'psi', al.oakBend, '<='),
    ];
    return {
      ...governing(ds, `Parked on ${f(p.designSlopeDeg)}° with the lining at its worst μ ${f(mu, 2)}: N = W·sinθ/μ = ${f(c.massLb)} × sin θ / ${f(mu, 2)} = ${f(nHold)} lbf total shoe normal force. The shoes and the two springs turn the arms with a moment M = N d (cos β + μ sin β) + F_spring a_app = ${f(nHold)} × ${f(g.d, 2)} × ${f(kF, 3)} + ${f(p.brakeSpringForceLbf, 0)} × ${f(g.aApp, 2)} = ${f(mTot(nHold))} lbf·in (rolling forward, the larger direction), which the hook must hold with a pull at the stud ${f(lL, 2)}" behind the pivots: F = ${f(F1)} lbf at the plain hold, ${f(FL)} lbf at the λ ${f(p.brakeLoadFactor, 1)} load (a jerk on a parked cart). The strap hangs plumb from a ${f(bd, 3)}" bolt in the lower edge of the transom (${f(edgeTransom, 1)}" up from the edge) with a ${f(HOOK_STANDOFF_IN, 2)}" spacer; the tooth sits ${f(0.02, 2)}" over the ${f(ds0, 3)}" stud, which cantilevers ${f(cant, 2)}" from the ${f(tg, 3)}" guard plate; the pull is ${f(st.y, 2)}" off the strap line, so the strap hangs at ${f(Math.atan2(st.y, hk.length) / RAD, 1)}° and the tooth takes it as a ${f(toothReach, 2)}" cantilever. Ground friction with the rear wheels locked and the fronts rolling: ${f(ground, 2)}× the downslope pull at μ ${f(p.tireGroundMu, 2)} on a level contact (info; brake-traction has the load transfer). To release, kick the strap sideways (-y): the tooth swings clear of the stud and the springs lift the bar.`),
    };
  };
  return dualCheck({ id: 'park-hold', label: 'Parking hold: latch hook, stud and guard', group: 'Structure', refs: ['D-55', 'D-39'], primary: 'goal', ...evalBoth(ctx, ev) });
}

// ── foot stomp abuse (a scout jumping on the bar) ────────────────────────────────────────────────────────────

export function brakeAbuse(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const g = brakeBundle(ctx).g;
  const L = loadsFromFoot(ctx, g, p.brakeFootAbuseLbf);
  const k = p.steelSafetyFactor; // yield-level: the design allowables carry the safety factor, remove it
  const parts: Array<[string, CaseEval]> = [
    ['pedal', pedalEval(ctx, L, g)], ['pivot', pivotEval(ctx, L, g)], ['beam', beamEval(ctx, L, g)], ['shoes', shoesEval(ctx, L, g)],
  ];
  const ds: Detail[] = [];
  for (const [name, e] of parts) for (const d of scaleLimits(e.details ?? [], k)) ds.push({ ...d, name: `${name}: ${d.name}` });
  const worstD = ds.reduce((a, c) => (c.util > a.util ? c : a), ds[0]);
  const how = `A ${f(p.brakeFootAbuseLbf)} lbf stomp on the middle of the bar (a scout jumping on it, ${f(p.brakeFootAbuseLbf / Math.max(1, p.brakeFootForceLimitLbf), 1)}× the ${f(p.brakeFootForceLimitLbf, 0)} lbf limit) with the tire pushing back: the shoes see N = (F a_app − spring) / (d (cos β − μ sin β)) = ${f(L.nTot)} lbf total (${f(L.nShoe)} per shoe; the larger-N rolling direction), pivot reaction ${f(L.Rmag)} lbf per arm. Every pedal, arm, pivot, bracket, rail bolt, beam and shoe criterion is held to yield (the design allowables with the safety factor ${p.steelSafetyFactor} removed): worst "${worstD.name}", ${f(worstD.value, 1)} ${worstD.unit} against ${f(worstD.limit, 1)}. The brake may be bent after this only if the row says so. (The latch is not loaded by a stomp: the foot is on the bar.)`;
  return singleCheck({
    id: 'brake-abuse', label: `Brake pedal abuse, ${f(p.brakeFootAbuseLbf)} lbf stomp (yield level)`, group: 'Structure', refs: ['D-55', 'eng r2 N-8'],
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
  const S = (w * t ** 2) / 6;
  const sigma = M / S;
  const contact = Math.max(0.25, p.handleSocketDepthIn / 4);
  const bearTop = Rtop / (w * contact);
  const dp = p.handlePinDiameterIn;
  const pinShear = F / (2 * circleA(dp));
  const wall = p.handleSocketWallIn;
  const tubeS = ((h.socketY * h.socketX ** 3 - (h.socketY - 2 * wall) * (h.socketX - 2 * wall) ** 3) / 12) / (h.socketX / 2);
  const tubeSigma = M / tubeS;
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
    detail('post bending at the socket mouth', sigma, 'psi', al.oakBend, '<='),
    detail('post bearing at the socket mouth and foot', bearTop, 'psi', al.oakPerp, '<='),
    detail('socket tube bending (6061-T6 aluminum)', tubeSigma, 'psi', alAllow, '<='),
    detail('socket wall bearing at the bolt holes (aluminum)', wallBoltBear, 'psi', alAllow, '<='),
    detail('retaining pin bearing on the aluminum walls', wallPinBear, 'psi', alAllow, '<='),
    detail('bolt washer pull-through on the transom (oak ⊥ grain)', pullThrough, 'psi', al.oakPerp, '<='),
    detail('socket bolts bearing in the transom (2 × ¼")', boltBear, 'psi', al.oakDowel, '<='),
    detail('retaining pin double shear (whole pull)', pinShear, 'psi', sa.shear, '<='),
  ];
  const how = `A ${f(F)} lbf hold-back pull at the grip (${f(gripZ, 1)}" above the ground, D-9) shared by two uprights: ${f(Fp)} lbf each. Each upright is a cantilever from the socket mouth (${f(h.zTop, 1)}") to the grip: M = ${f(Fp)} × ${f(gripZ - h.zTop, 1)} = ${f(M)} lbf·in on a ${f(w, 2)}" × ${f(t, 2)}" post (σ ${f(sigma, 0)} psi). Top reaction ${f(Rtop)} lbf over the ${f(lEff, 1)}" insertion. Socket tube bending ${f(tubeSigma, 0)} psi, bolt-hole wall bearing ${f(wallBoltBear, 0)} psi, washer pull-through ${f(pullThrough, 0)} psi on the oak transom, retaining pin ${f(pinShear, 0)} psi in double shear.`;
  const g = governing(ds, how);
  return singleCheck({
    id: 'handle-sockets', label: `Rear push-handle sockets${g.suffix ? ` (${g.suffix})` : ''}`, group: 'Structure', refs: ['D-9', 'D-39'],
    value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, how, details: ds,
  });
}

// ── sweep: the moving mechanism vs everything else, released → applied ───────────────────────────────────────

export interface BrakeSweepResult {
  /** Smallest gap (in) between a moving brake part and any other solid over the stroke (the tire is measured separately). */
  minClearanceIn: number;
  moving: string;
  other: string;
  pose: number;
  /** Shoe lining to the tread, released and applied (in). */
  padGapReleasedIn: number;
  padGapAppliedIn: number;
  /** Lowest point of any moving brake part released (pose 0) and applied (pose 1), and the lowest edge of the swing arms and pedal bar released. */
  groundMinZ: number;
  groundAppliedZ: number;
  armMinZ: number;
  /** Least distance from the toe guard to the tire over the stroke, and the lowest edge of the arms released. */
  guardTireGapIn: number;
  poses: number;
}

const sweepCache = new Map<string, BrakeSweepResult>();
const RIDER_KEYS = ['riderMassLb', 'riderGoalMassLb', 'riderMinMassLb', 'cargoMassLb'];
const BIG = 99;

/** Distance from point to the solid tire cylinder (axis along y, center (0, y0, r), radius r, half width). */
function tireDistance(pt: Vec3, r: number, yIn: number, yOut: number): number {
  const dr = Math.hypot(pt[0], pt[2] - r) - r;
  const dy = Math.max(yIn - Math.abs(pt[1]), Math.abs(pt[1]) - yOut, 0);
  return Math.hypot(Math.max(dr, 0), dy);
}

function obbSamples(o: OBB, n = 4): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) for (let k = 0; k <= n; k++) {
    const a = (i / n) * 2 - 1, b = (j / n) * 2 - 1, c = (k / n) * 2 - 1;
    out.push([
      o.center[0] + o.axes[0][0] * o.half[0] * a + o.axes[1][0] * o.half[1] * b + o.axes[2][0] * o.half[2] * c,
      o.center[1] + o.axes[0][1] * o.half[0] * a + o.axes[1][1] * o.half[1] * b + o.axes[2][1] * o.half[2] * c,
      o.center[2] + o.axes[0][2] * o.half[0] * a + o.axes[1][2] * o.half[1] * b + o.axes[2][2] * o.half[2] * c,
    ]);
  }
  return out;
}

/** Radial gap (in) of a shoe part's inner arc to the tread, from its extrusion outline in the world frame. */
function padGap(pad: Part, r: number): number {
  if (pad.geometry.type !== 'extrusion') return BIG;
  const m = pad.transform;
  let best = Infinity;
  for (const q of pad.geometry.outline) {
    for (const z of [0, pad.geometry.depth]) {
      const x = m[0] * q[0] + m[4] * q[1] + m[8] * z + m[12];
      const zz = m[2] * q[0] + m[6] * q[1] + m[10] * z + m[14];
      best = Math.min(best, Math.hypot(x, zz - r) - r);
    }
  }
  return best;
}

export function brakeSweep(ctx: Ctx, steps = 8): BrakeSweepResult {
  const { p } = ctx;
  const g = brakeBundle(ctx).g;
  if (!g.ok) return { minClearanceIn: BIG, moving: '–', other: '–', pose: 0, padGapReleasedIn: BIG, padGapAppliedIn: BIG, groundMinZ: BIG, groundAppliedZ: BIG, armMinZ: BIG, guardTireGapIn: BIG, poses: 0 };
  const key = JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => !RIDER_KEYS.includes(k)))) + `|${steps}`;
  const hit = sweepCache.get(key);
  if (hit) return hit;
  const r = ctx.L.r;
  const ry = p.rearTrackIn / 2;
  const yIn = ry - p.tireWidthIn / 2, yOut = ry + p.tireWidthIn / 2;
  const bctx = makeCtx(p, {});
  // Everything else on the cart, plus the brake's own fixed parts (brackets, pivot bolts, stop pins, the latch hook and bolt): the arms ride 1/16" off the bracket tongues on
  // purpose and the arm edge rests on the stop pin, so the arms are not tested against those, nor the stud against the hook it engages.
  const fixedBrake = buildBrakeAt(bctx, 0, false).filter((x) => /^brake-(bracket|pivot-bolt|stop-pin|latch-hook|latch-bolt)/.test(x.id));
  const obstacles = [...ctx.parts.filter((x) => !x.payload && x.group !== 'reference' && !/^brake-/.test(x.id) && !/^wheel-R[LR]$/.test(x.id)), ...fixedBrake]
    .flatMap((x) => partOBBs(x).map((o) => ({ id: x.id, o, rad: Math.hypot(...o.half) })));
  // The shoe beam crosses the plane of the bracket tongue (it passes through the arm slot beside it): measured exactly in that plane instead of with the slab boxes.
  const beamRect = (s: number): V2[] => rectPts(g.beam.c, g.beam.w, g.beam.h).map((q) => rot2(q, g.P, s * g.thetaApp));
  let beamTongue = BIG;
  const intended = (m: string, o: string) =>
    (/^brake-arm-/.test(m) && /^brake-(bracket|pivot-bolt|stop-pin)/.test(o)) || (m === 'brake-latch-stud' && /^brake-latch-(hook|bolt)$/.test(o)) || (/^brake-return-spring/.test(m) && /^rail-/.test(o));
  let best = { minClearanceIn: BIG, moving: '–', other: '–', pose: 0 };
  let padRel = BIG, padApp = BIG, groundRel = BIG, groundApp = BIG, guardTire = BIG, armRel = BIG;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const moving = buildBrakeAt(bctx, s, true).filter((x) => !x.id.startsWith('handle-'));
    const mob = moving.map((x) => { const o = partOBB(x); return { id: x.id, part: x, o, rad: Math.hypot(...o.half) }; });
    beamTongue = Math.min(beamTongue, convexGap(beamRect(s), g.tongue.outline));
    for (const m of mob) {
      const zmin = worldAABB(m.part).min[2];
      if (i === 0) { groundRel = Math.min(groundRel, zmin); if (/^brake-(arm|pedal)/.test(m.id)) armRel = Math.min(armRel, zmin); }
      if (i === steps) groundApp = Math.min(groundApp, zmin);
      for (const ob of obstacles) {
        if (intended(m.id, ob.id) || (m.id === 'brake-beam' && /^brake-bracket-/.test(ob.id))) continue;
        const d = Math.hypot(m.o.center[0] - ob.o.center[0], m.o.center[1] - ob.o.center[1], m.o.center[2] - ob.o.center[2]) - m.rad - ob.rad;
        if (d > best.minClearanceIn) continue;
        const clr = -obbOverlap(m.o, ob.o);
        if (clr < best.minClearanceIn) best = { minClearanceIn: clr, moving: m.id, other: ob.id, pose: s };
      }
      if (!/^brake-shoe-[LR]$/.test(m.id)) {
        let dmin = Infinity;
        for (const pt of obbSamples(m.o)) dmin = Math.min(dmin, tireDistance(pt, r, yIn, yOut));
        if (m.id === 'brake-guard' || m.id === 'brake-pedal') guardTire = Math.min(guardTire, dmin);
        if (dmin < best.minClearanceIn) best = { minClearanceIn: dmin, moving: m.id, other: 'tire', pose: s };
      } else {
        const gap = padGap(m.part, r);
        if (i === 0) padRel = Math.min(padRel, gap);
        if (i === steps) padApp = Math.min(padApp, gap);
      }
    }
  }
  if (beamTongue < best.minClearanceIn) best = { minClearanceIn: beamTongue, moving: 'brake-beam', other: 'brake-bracket-L/R', pose: 0 };
  const res: BrakeSweepResult = { ...best, padGapReleasedIn: padRel, padGapAppliedIn: padApp, groundMinZ: groundRel, groundAppliedZ: groundApp, armMinZ: armRel, guardTireGapIn: guardTire, poses: steps + 1 };
  if (sweepCache.size > 12) sweepCache.clear();
  sweepCache.set(key, res);
  return res;
}

export function brakeClearance(ctx: Ctx, sweep: BrakeSweepResult = brakeSweep(ctx)): AnalysisCheck {
  const { p } = ctx;
  const g = brakeBundle(ctx).g;
  const hk = g.hook, st = g.stud;
  // Stud vs hook tooth (released: the stud must clear above the tooth) and stud tip vs transom face.
  const studBottomRel = st.c[1] - st.r;
  const toothTop = hk.zTooth + HOOK_TOOTH_IN;
  const studAboveTooth = studBottomRel - toothTop;
  const tipToTransom = ctx.L.xRear - st.tipRel;
  // Spring lift: released spring torque (both) against the weight torque of the swinging parts about the pivots.
  const bctx = makeCtx(p, {});
  const mov = buildBrakeAt(bctx, 0, true).filter((x) => !x.id.startsWith('handle-'));
  let wTorque = 0;
  for (const x of mov) {
    const cg = x.cgIn ? x.cgIn[0] : partOBB(x).center[0];
    wTorque += x.massLb * (g.P[0] - cg);
  }
  const sTorque = 2 * g.spring.fRel * g.spring.leverRel;
  const lift = wTorque > 1e-6 ? sTorque / wTorque : 99;
  const capped = sweep.minClearanceIn >= BIG - 1;
  // The flange lies on the beam top between the hanger (inboard) and the rod clamp plates (outboard).
  const clampInner = Math.min(g.tongue.beam.halfLen - 0.25, p.rearTrackIn / 2 - p.tireWidthIn / 2) - p.clampPlateWidthIn;
  const flangeClearClamp = clampInner - g.tongue.flange.y1;
  const hangerOuter = ctx.L.hwC + ctx.L.side - p.railThicknessIn;
  const flangeClearHanger = g.tongue.flange.y0 - hangerOuter;
  const details: Detail[] = [
    detail('shoe lining gap to the tread, released (the nearest corner; the stroke at the shoe center)', sweep.padGapReleasedIn, 'in', 0.75 * p.brakeShoeTravelIn, '>='),
    detail('shoe lining gap to the tread, applied (touching)', Math.abs(sweep.padGapAppliedIn), 'in', 0.03, '<='),
    detail('lowest brake part, released, vs minimum ground clearance', sweep.groundMinZ, 'in', p.minGroundClearanceIn, '>='),
    detail('swing arm and pedal lowest edge, released, vs the pedal ground clearance', sweep.armMinZ, 'in', p.brakeBarClearIn - 0.04, '>='),
    detail('lowest brake part, parked (latched down), vs parked clearance', sweep.groundAppliedZ, 'in', p.brakeParkedClearIn, '>='),
    detail('toe guard height above the pedal bar', p.brakeToeGuardHeightIn, 'in', p.brakeToeGuardMinIn, '>='),
    detail('open gap, toe guard to tire (foot-pinch limit)', sweep.guardTireGapIn, 'in', p.brakeFootGapMinIn, '>='),
    detail('latch stud above the hook tooth, released', studAboveTooth, 'in', 0.25, '>='),
    detail('latch stud tip to the transom face, released', tipToTransom, 'in', 0.06, '>='),
    detail('return spring torque over the weight torque of the swinging parts (released)', lift, '×', 1, '>='),
    detail('bracket flange clear of the rod clamp plates on the axle beam', flangeClearClamp, 'in', 0.1, '>='),
    detail('bracket flange clear of the axle hanger (its |y| start over the hanger outer face)', flangeClearHanger, 'in', 0.05, '>='),
    detail('latch stud length', st.len, 'in', 3.5, '<='),
  ];
  const clearStatus: Status = judge(sweep.minClearanceIn, p.brakeClearanceIn, '>=');
  const hardFail = details.slice(2).some((d) => d.util > 1);
  const status: Status = hardFail ? worst(clearStatus, 'fail') : clearStatus;
  return singleCheck({
    id: 'brake-clear', label: 'Brake mechanism clearance over the stroke', group: 'Braking', refs: ['D-55', 'D-53', 'D-16'],
    value: sweep.minClearanceIn, unit: 'in', limit: p.brakeClearanceIn, sense: '>=', details, status,
    how: `The moving brake parts (pedal bar, toe guard, swing arms, shoe beam, shoes, latch stud, springs) are posed at ${sweep.poses} points from released to applied (the arms turn through ${f(g.thetaApp / RAD, 1)}°) and tested against every other solid (hull, transom, rails, storage box, push handle, rear axle beam, wheels): least gap ${capped ? 'more than 99' : f(sweep.minClearanceIn, 2)}" (${sweep.moving} vs ${sweep.other}, at pose ${f(sweep.pose, 2)}); limit ≥ ${f(p.brakeClearanceIn, 2)}". The shoe lining is ${f(sweep.padGapReleasedIn, 2)}" off the tread released and ${f(Math.abs(sweep.padGapAppliedIn), 2)}" applied (stroke ${f(p.brakeShoeTravelIn, 3)}"). Ground clearance: lowest part ${f(sweep.groundMinZ, 2)}" released (the arm edge under the bar; limit ${f(p.minGroundClearanceIn, 1)}" and the pedal ${f(p.brakeBarClearIn, 2)}"), ${f(sweep.groundAppliedZ, 2)}" parked. The oak bar's front-lower edge is cut up ${f(p.brakeBarKickIn, 2)}" so it rides over roots. FOOT SAFETY: a ${f(p.brakeToeGuardHeightIn, 1)}" aluminum plate stands on the front of the bar (a boot toe needs ≥ ${f(p.brakeToeGuardMinIn, 1)}"), and the open space in front of it to the tire is never less than ${f(sweep.guardTireGapIn, 1)}" (≥ ${f(p.brakeFootGapMinIn, 1)}": a boot cannot wedge in it); nothing moves toward the foot from the sides: the arms swing in their own plane outside the body. The latch stud clears ${f(studAboveTooth, 2)}" above the tooth released and the hook swings ${f(hk.swing, 2)}" aside as the stud passes. The springs give ${f(lift, 1)}× the torque needed to lift the swinging parts.`,
  });
}

/** All the braking and handle rows in one list (the call site in index.ts does not change when the brake design does). */
export function brakeChecks(ctx: Ctx): AnalysisCheck[] {
  return [brakeRatio(ctx), brakeForce(ctx), brakeTraction(ctx), brakeClearance(ctx), brakePedal(ctx), brakePivot(ctx), brakeBeam(ctx), brakeShoes(ctx), parkHold(ctx), handleSockets(ctx), brakeAbuse(ctx)];
}
