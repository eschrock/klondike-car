/**
 * Braking checks (D-13, D-24, D-38, D-39): the lever ratio DERIVED from the linkage geometry (`brakeGeometry`), the handle
 * force to hold on the design slope, rear-only traction (info), the mechanism members (lever, links, cross shaft, shoes,
 * ratchet), the push-handle sockets, and a sweep of the linkage over its stroke.
 *
 * Load path (all forces in lbf, moments in lbf·in; every row hand-checkable from its `how` string):
 *   W sinθ / μ_pad = N_hold   total shoe normal force that holds the cart on the design slope (D-13); μ_pad is the LOWER of the
 *                             bonded-lining wet μ and the mud-fouled μ (`holdMu`), so the members are sized for the worst lining
 *   N = λ · N_hold            what the members are checked at (hard pull / jerk, `brakeLoadFactor`)
 *   hand force F_eq = N / ratio, lever moment M_L = F_eq · l_grip, link force F_link = M_L / d_Q,
 *   shaft torque T = F_link · d_S = N · k  (k = moment arm of the shoe force about the shaft, friction included)
 * The critical rolling direction is the one with the larger k (smaller ratio); members are sized with it.
 */
import { BRAKE_TYPE } from '../params';
import { obbOverlap, partOBB, partOBBs, worldAABB, type OBB } from '../model/bounds';
import {
  CRANK_LIGAMENT_IN, HUB_LEN_BARS, PIVOT_SLEEVE_WALL_IN, SLEEVE_WALL_IN, brakeGeometry, buildBrakeAt, handleGeometry, ratchetGeometry,
  type BrakeGeom, type HandleGeom, type RatchetGeom,
} from '../model/brake';
import { makeCtx } from '../model/build-utils';
import { bearingMount } from '../model/rear-mount';
import { mountDetails, mountStatics } from './brake-mount';
import type { Part, Vec3 } from '../model/types';
import type { Ctx } from './context';
import { dualCheck, singleCheck, detail, governing, type CaseEval } from './dual';
import { RAD, contactsAt } from './geometry';
import { scaleLimits } from './front';
import { f } from './format';
import type { CaseData } from './loads';
import { evalBoth, rearNormalNoseDown } from './stability';
import { allowables } from './structure';
import { judge, worst, type AnalysisCheck, type Detail, type Status } from './types';

// ── shared bundle ────────────────────────────────────────────────────────────────────────────────────────────

interface Bundle { g: BrakeGeom; rg: RatchetGeom; h: HandleGeom; drum: boolean }
const bundles = new WeakMap<Ctx, Bundle>();
export function brakeBundle(ctx: Ctx): Bundle {
  let b = bundles.get(ctx);
  if (!b) {
    const g = brakeGeometry(ctx.p, ctx.L);
    b = { g, rg: ratchetGeometry(ctx.p, g, ctx.L), h: handleGeometry(ctx.p, ctx.L), drum: ctx.p.brakeType === BRAKE_TYPE.woodDrum };
    bundles.set(ctx, b);
  }
  return b;
}

/** Lever ratio the analysis uses: the derived (critical-direction) ratio, or the target for the drum variant / a failed linkage. */
export function effectiveBrakeRatio(ctx: Ctx): { ratio: number; derived: boolean } {
  const b = brakeBundle(ctx);
  if (b.drum) return { ratio: ctx.p.brakeLeverRatio, derived: false };
  return { ratio: b.g.ratioCrit, derived: true };
}

/** Friction used to size the hold load: the lower of the design (wet lining) μ and the mud-fouled μ. */
export const holdMu = (p: { brakePadMu: number; brakePadMuFouled: number }): number => Math.min(p.brakePadMu, p.brakePadMuFouled);

const tpiUnf = (d: number): number => (d <= 0.25 ? 28 : d <= 0.375 ? 24 : d <= 0.4375 ? 20 : d <= 0.5 ? 20 : 18);
const tensileArea = (d: number): number => (Math.PI / 4) * (d - 0.9743 / tpiUnf(d)) ** 2;
const circleA = (d: number) => (Math.PI / 4) * d * d;

/** Allowable stresses for A36 flat bar, rod and pins (yield / steel safety factor; shear 0.577; bearing 0.9). */
function steelAllow(ctx: Ctx) {
  const fy = ctx.p.brakeSteelYieldPsi / ctx.p.steelSafetyFactor;
  return { tens: fy, shear: 0.577 * fy, bear: 0.9 * fy, fy: ctx.p.brakeSteelYieldPsi };
}

interface Loads {
  W: number; down: number; nHold: number; lam: number; nTot: number; nShoe: number; feq: number; ml: number; flink: number; tin: number; tShoe: number; rPin: number; kMax: number;
}
function loadsAt(ctx: Ctx, c: CaseData, b: Bundle): Loads {
  const { p } = ctx;
  const th = p.designSlopeDeg * RAD;
  const down = c.massLb * Math.sin(th);
  const nHold = down / holdMu(p);
  const lam = p.brakeLoadFactor;
  const nTot = lam * nHold;
  const ratio = b.g.ratioCrit > 1e-6 ? b.g.ratioCrit : p.brakeLeverRatio;
  const feq = nTot / ratio;
  const ml = feq * b.g.lGrip;
  const flink = b.g.dQ > 1e-6 ? ml / b.g.dQ : 0;
  const tin = flink * b.g.dS;
  return {
    W: c.massLb, down, nHold, lam, nTot, nShoe: nTot / 2, feq, ml, flink, tin, tShoe: tin / 2,
    rPin: (nTot / 2) * Math.sqrt(1 + p.brakePadMu ** 2), kMax: Math.max(b.g.kFwd, b.g.kRev),
  };
}

const na = (id: string, label: string, group: AnalysisCheck['group'], why: string): AnalysisCheck =>
  singleCheck({ id, label, group, value: 0, unit: '', limit: 0, sense: '<=', info: true, how: `Not evaluated: ${why}`, refs: ['D-13', 'D-38'] });

// ── lever ratio, handle force, traction ─────────────────────────────────────────────────────────────────────

export function brakeRatio(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const b = brakeBundle(ctx);
  const g = b.g;
  if (b.drum) return na('brake-ratio', 'Brake mechanical advantage (derived)', 'Braking', `the wooden-drum variant has no linkage geometry; the analysis uses the ${f(p.brakeLeverRatio, 1)}:1 target (D-13).`);
  const lockMu = Math.abs(g.Kt) > 1e-9 ? Math.abs(g.Kn) / Math.abs(g.Kt) : Infinity;
  const servo = g.kFwd > 0 ? g.kRev / g.kFwd : 0;
  const how = `Derived from the linkage geometry, not assumed (D-38). In the vertical x–z plane with the pull applied to the grip: ratio = N_total / F_hand = (l_grip / d_Q) · (d_S / k), where l_grip = ${f(g.lGrip, 2)}" (pivot to grip height ${f(g.gripZ, 1)}"), d_Q = ${f(g.dQ, 2)}" = perpendicular distance of the lever pivot from the link line, d_S = ${f(g.dS, 2)}" = distance of the shaft from the link line (both at the applied pose: lever tail ${f(g.tailIn, 2)}" ${p.brakeLeverTailAuto ? `(SOLVED so the critical ratio = target × ${f(p.brakeRatioHeadroom, 2)} headroom = ${f(p.brakeLeverRatio * p.brakeRatioHeadroom, 2)}:1; it adapts to the wheel size)` : '(manual)'}, crank ${f(g.crankIn, 2)}"${g.crankIn > p.brakeCrankIn + 1e-6 ? ` (lengthened from ${f(p.brakeCrankIn, 2)}": the shortest tail alone cannot reach the ratio on this wheel)` : ''} at ${f(p.brakeCrankAngleDeg, 0)}° released, link ${f(g.linkLen, 2)}" pin to pin, ${g.linkTension ? 'in tension' : 'in compression'}), and k = moment arm of the shoe force about the shaft: the pin is ${f(g.armLen, 2)}" from the shaft, the normal-force arm is |Kn| = ${f(Math.abs(g.Kn), 2)}" and the friction-force arm is |Kt| = ${f(Math.abs(g.Kt), 2)}" (shoe ${f(p.brakeShoeAngleDeg, 0)}° below the axle line behind the tire). Shoe friction μ = ${f(p.brakePadMu, 2)} adds ±μ·Kt: k = |Kn ∓ μKt| = ${f(g.kFwd, 2)}" with the cart rolling FORWARD (friction helps: servo) and ${f(g.kRev, 2)}" rolling BACKWARD (de-servo). Ratio forward ${f(g.ratioFwd, 1)}:1, backward ${f(g.ratioRev, 1)}:1; the smaller one, ${f(g.ratioCrit, 1)}:1 (${g.critical}), is the critical case (the cart parked nose-up wants to roll back) and is what the force check uses. Target ≥ ${f(p.brakeLeverRatio, 1)}:1. Self-lock margin: the shoe locks only if μ ≥ |Kn|/|Kt| = ${f(lockMu, 1)} (design μ ${f(p.brakePadMu, 2)}); the servo gain forward is ${f(servo, 2)}× the backward value. Stroke: ${f(p.brakeShoeTravelIn, 2)}" at the pad takes the lever ${f(g.thetaL / RAD, 1)}° (${f(g.gripTravelIn, 1)}" at the grip).${g.ok ? '' : ` NOT VALID: ${g.why || (g.selfLocking ? 'the shoe is self-locking' : 'no ratio')}.`}`;
  const details: Detail[] = [
    detail('ratio, rolling forward (servo)', g.ratioFwd, ':1', p.brakeLeverRatio, '>='),
    detail('ratio, rolling backward (de-servo, critical)', g.ratioRev, ':1', p.brakeLeverRatio, '>='),
    detail('self-lock margin μ_lock / μ_pad', lockMu / Math.max(1e-9, p.brakePadMu), '×', 2, '>='),
    detail('grip travel, released to applied (hand lever sweep)', g.gripTravelIn, 'in', p.brakeGripTravelMaxIn, '<='),
  ];
  return singleCheck({
    id: 'brake-ratio', label: 'Brake mechanical advantage (derived from geometry)', group: 'Braking', refs: ['D-13', 'D-38'],
    value: g.ok ? g.ratioCrit : 0, unit: ':1', limit: p.brakeLeverRatio, sense: '>=', marginalAbs: 0.5, how: `${how} Grip travel from released to applied: ${f(g.gripTravelIn, 2)}" for the ${f(p.brakeShoeTravelIn, 4)}" shoe stroke at ${f(g.ratioCrit, 1)}:1 (limit ${f(p.brakeGripTravelMaxIn, 2)}", status verify: feel-test the mock-up). Raising the ratio or the stroke raises the travel one for one; the ratio headroom ${f(p.brakeRatioHeadroom, 2)} and the stroke were chosen together (r3 N-8).`, details,
    status: worst(judge(g.ok ? g.ratioCrit : 0, p.brakeLeverRatio, '>=', 0.5), judge(g.gripTravelIn, p.brakeGripTravelMaxIn, '<=')),
  });
}

export function brakeForce(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const th = p.designSlopeDeg * RAD;
  const { ratio, derived } = effectiveBrakeRatio(ctx);
  const b = brakeBundle(ctx);
  const BARE_OAK_MU = 0.25;
  const ev = (c: CaseData): CaseEval => {
    const down = c.massLb * Math.sin(th);
    const eta = ratio * p.brakeEfficiency;
    const muD = p.brakePadMu, muF = p.brakePadMuFouled;
    const Fd = down / muD / eta; // bonded lining, wet
    const Ff = down / muF / eta; // mud / slush fouled lining: the pass/fail case
    const Fbare = down / BARE_OAK_MU / eta;
    const F = Math.max(Fd, Ff);
    const Ffwd = derived && b.g.ratioFwd > 0 ? down / muF / (b.g.ratioFwd * p.brakeEfficiency) : Ff;
    return {
      value: F, unit: 'lbf', limit: p.handleForceLimitLbf, sense: '<=', suffix: Ff >= Fd ? 'mud-fouled lining' : 'wet lining',
      details: [
        detail(`handle force, wet bonded lining μ ${f(muD, 2)}`, Fd, 'lbf', p.handleForceLimitLbf, '<='),
        detail(`handle force, mud / slush-fouled lining μ ${f(muF, 2)} (pass/fail)`, Ff, 'lbf', p.handleForceLimitLbf, '<='),
        detail(`info: bare wet oak μ ${BARE_OAK_MU} (why the lining is specified; not pass/fail)`, Fbare, 'lbf', p.handleForceLimitLbf, '<='),
      ],
      how: `F = W·sinθ / μ / (ratio · η) = ${f(c.massLb)} × sin ${f(p.designSlopeDeg)}° / μ / (${f(ratio, 1)} × ${f(p.brakeEfficiency, 2)}); W·sinθ = ${f(down)} lbf downslope. Wet bonded lining μ ${f(muD, 2)}: ${f(down / muD)} lbf total shoe normal force → ${f(Fd)} lbf at the handle. MUD / SLUSH-FOULED lining μ ${f(muF, 2)} (the shoe sits on the rear-lower tread, the wettest part, D-13, build S10): ${f(down / muF)} lbf shoe normal force → ${f(Ff)} lbf at the handle. The row value is the larger of the two, ${f(F)} lbf, limit ≤ ${p.handleForceLimitLbf} lbf (pass/fail at BOTH μ, not a sensitivity). Bare wet oak (μ ${BARE_OAK_MU}, no lining) would need ${f(Fbare)} lbf: the lining is what makes the brake work in the wet. (Shoe friction acts at the tire radius, 1:1 with ground force, D-13. The ratio ${f(ratio, 1)}:1 is ${derived ? `DERIVED from the lever / crank / shoe geometry (brake-ratio, D-38), taken in the critical ${b.g.critical} rolling direction at the design μ (conservative at the lower fouled μ)` : 'the target (drum variant)'}; it is read as handle force to TOTAL shoe normal force: one lever on a cross shaft drives both shoes, each seeing half the shaft torque.${derived ? ` Rolling forward the shoe is servo-assisted (${f(b.g.ratioFwd, 1)}:1) and the cart needs only ${f(Ffwd)} lbf at the fouled μ.` : ''})`,
    };
  };
  return dualCheck({
    id: 'brake-force', label: 'Brake lever force to hold on the slope', group: 'Braking', refs: ['D-13', 'D-38', 'BRIEF §7'], primary: 'operating',
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
      how: `Parked nose-down on ${f(p.designSlopeDeg)}°, rear wheels only: N_r = W(cosθ·(L−x)/L − sinθ·h/L) = ${f(Nr)} lb; μ_ground·N_r = ${f(p.tireGroundMu, 2)} × ${f(Nr)} = ${f(p.tireGroundMu * Nr)} lbf vs W·sinθ = ${f(down)} lbf → ${f(ratio, 2)}× (${f(wet, 2)}× at wet-leaf μ 0.3). Info only (D-24); parked nose-up N_r is much larger.`,
    };
  };
  return dualCheck({
    id: 'brake-traction', label: 'Rear-only traction, parked nose-down', group: 'Braking', refs: ['D-24'], primary: 'operating',
    ...evalBoth(ctx, ev),
  });
}

// ── members ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Case evaluator that carries the loads text shared by every member check. */
const loadText = (L: Loads, b: Bundle) =>
  `Hold load W·sinθ/μ = ${f(L.W)} × sin θ / μ = ${f(L.nHold)} lbf total shoe normal force; × λ ${f(L.lam, 2)} = N ${f(L.nTot)} lbf (${f(L.nShoe)} per shoe); hand-equivalent F = N / ratio ${f(b.g.ratioCrit, 1)} = ${f(L.feq)} lbf; lever moment M_L = F·l_grip = ${f(L.feq)} × ${f(b.g.lGrip, 2)} = ${f(L.ml)} lbf·in; link force F_link = M_L / d_Q = ${f(L.ml)} / ${f(b.g.dQ, 2)} = ${f(L.flink)} lbf; shaft torque T = F_link·d_S = ${f(L.flink)} × ${f(b.g.dS, 2)} = ${f(L.tin)} lbf·in (= N·k = ${f(L.nTot)} × ${f(L.kMax, 2)}); per shoe ${f(L.tShoe)} lbf·in`;

function members(id: string, label: string, ctx: Ctx, fn: (c: CaseData, L: Loads, b: Bundle) => CaseEval, refs: string[]): AnalysisCheck {
  const b = brakeBundle(ctx);
  if (b.drum) return na(id, label, 'Structure', 'the wooden-drum variant has no linkage geometry yet (band geometry deferred, D-13).');
  const ev = (c: CaseData): CaseEval => fn(c, loadsAt(ctx, c, b), b);
  return dualCheck({ id, label, group: 'Structure', refs, primary: 'goal', ...evalBoth(ctx, ev) });
}

function leverEval(ctx: Ctx, L: Loads, b: Bundle): CaseEval {
  const { p } = ctx;
  const al = allowables(ctx);
  const w = p.brakeLeverWidthIn, h = p.brakeLeverThickIn;
  const pivD = p.brakePivotBoltDiameterIn;
  const sleeveOd = pivD + 2 * PIVOT_SLEEVE_WALL_IN;
  const pinOd = p.brakeClevisPinDiameterIn + SLEEVE_WALL_IN;
  const S = (w * (h ** 3 - sleeveOd ** 3)) / (6 * h);
  const sigma = L.ml / S;
  const tauTail = (1.5 * L.flink) / (w * h);
  const st = [1, -1].map((sg) => mountStatics(p, b.g, L.feq, sg as 1 | -1));
  const R = Math.max(...st.map((x) => Math.hypot(x.Qp[0], x.Qp[1])));
  const bearPivot = R / (sleeveOd * w);
  const bearTail = L.flink / (pinOd * w);
  const sa = steelAllow(ctx);
  const Y = b.g.y;
  const arm = Math.max(0, Y.lever[0] - Y.block[1]) + w / 2;
  const Mpost = R * arm;
  const sigPost = (32 * Mpost) / (Math.PI * pivD ** 3);
  const tauPost = R / circleA(pivD);
  const te = 0.707 * (3 / 16);
  const weldM = Mpost / ((Math.PI * pivD ** 2 * te) / 4);
  const weldV = R / (Math.PI * pivD * te);
  const weld = Math.hypot(weldM, weldV);
  const weldAllow = 0.3 * p.weldFexxPsi;
  const ds: Detail[] = [
    detail('lever bending at the pivot (net of the sleeve bore)', sigma, 'psi', al.oakBend, '<='),
    detail('tail shear parallel to grain', tauTail, 'psi', al.oakShear, '<='),
    detail('tail pin bearing on its sleeve (oak bore)', bearTail, 'psi', al.oakDowel, '<='),
    detail('pivot sleeve bearing (oak bore)', bearPivot, 'psi', al.oakDowel, '<='),
    detail('pivot post bending (cantilever from the plate)', sigPost, 'psi', sa.tens, '<='),
    detail('pivot post shear', tauPost, 'psi', sa.shear, '<='),
    detail('pivot post fillet weld to the plate (ring: moment + shear)', weld, 'psi', weldAllow, '<='),
  ];
  const how = `${loadText(L, b)}. Lever ${f(w, 2)}" (across) × ${f(h, 2)}" (in the plane of the pull), grain along its length, pivot bore sleeve OD ${f(sleeveOd, 2)}" (${f(pivD, 2)}" post + 2 × ${f(PIVOT_SLEEVE_WALL_IN, 3)}" bronze): S_net = w(h³ − d³)/(6h) = ${f(S, 3)} in³; σ = M_L/S = ${f(L.ml)}/${f(S, 3)} = ${f(sigma, 0)} psi (≤ ${f(al.oakBend, 0)}). Tail shear τ = 1.5·F_link/(w·h) = 1.5 × ${f(L.flink)} / ${f(w * h, 2)} = ${f(tauTail, 0)} psi (≤ ${f(al.oakShear, 0)}). Link-pin sleeve OD ${f(pinOd, 2)}": bearing F_link/(OD·w) = ${f(bearTail, 0)} psi. Pivot reaction on the post (vector statics of the closed linkage, the worse rolling direction): ${f(R)} lbf = hand − link force; on the sleeve ${f(bearPivot, 0)} psi (≤ ${f(al.oakDowel, 0)} oak bolt bearing). The post is a CANTILEVER from the bearing plate (round 2 never checked this: a 3/8" bolt there would have bent): M = R × (${f(Math.max(0, Y.lever[0] - Y.block[1]), 2)}" thrust washers + ${f(w / 2, 2)}" half the lever) = ${f(R)} × ${f(arm, 2)} = ${f(Mpost)} lbf·in on a ${f(pivD, 2)}" A36 post: σ = 32M/πd³ = ${f(sigPost, 0)} psi, shear ${f(tauPost, 0)} psi (≤ ${f(sa.tens, 0)} / ${f(sa.shear, 0)}, A36 ${f(p.brakeSteelYieldPsi, 0)}/SF ${p.steelSafetyFactor}); 3/16" fillet ring weld (throat ${f(te, 3)}"): τ = √((M/(πd²t/4))² + (R/(πdt))²) = ${f(weld, 0)} psi (≤ 0.3 F_EXX = ${f(weldAllow, 0)}). The reaction goes on into the plate's bolt group (brake-shaft row).`;
  return governing(ds, how);
}

export function brakeLever(ctx: Ctx): AnalysisCheck {
  return members('brake-lever', 'Brake lever (oak) and pivot', ctx, (_c, L, b) => leverEval(ctx, L, b), ['D-38', 'D-2']);
}

function linksEval(ctx: Ctx, L: Loads, b: Bundle): CaseEval {
  const { p } = ctx;
  const sa = steelAllow(ctx);
  const al = allowables(ctx);
    const dr = p.brakeLinkRodDiameterIn, dp = p.brakeClevisPinDiameterIn;
    const At = tensileArea(dr);
    const rod = L.flink / At;
    const pinShear = L.flink / (2 * circleA(dp));
    const pinBear = L.flink / (dp * Math.max(0.1, b.g.y.crank[1] - b.g.y.crank[0]));
    const crankT = Math.max(0.1, b.g.y.crank[1] - b.g.y.crank[0]);
    // The crank bar is widened to shaft + 2 ligaments at the boss; the shaft bore (drilled and reamed, no keyseat) is taken out of the section.
    const Dsh = p.brakeShaftDiameterIn;
    const crankW = Math.max(p.brakeBarWidthIn, Dsh + 2 * CRANK_LIGAMENT_IN);
    const crankSS = (crankT * (crankW ** 3 - Dsh ** 3)) / (6 * crankW);
    const crankBend = (L.flink * b.g.dS) / crankSS;
    const net = L.flink / ((crankW - dp) * Math.max(0.1, b.g.y.crank[1] - b.g.y.crank[0]));
    const freeLen = Math.max(0.1, b.g.linkLen - 0.9);
    const r = dr / 4;
    const KLr = freeLen / r;
    const E = p.steelMoePsi;
    const Cc = Math.sqrt((2 * Math.PI ** 2 * E) / p.brakeSteelYieldPsi);
    const crit = KLr <= Cc ? p.brakeSteelYieldPsi * (1 - KLr ** 2 / (2 * Cc ** 2)) : (Math.PI ** 2 * E) / KLr ** 2;
    const buckle = (L.flink / circleA(dr)) / (crit / p.steelSafetyFactor);
    const ds: Detail[] = [
      detail(`link rod ${b.g.linkTension ? 'tension' : 'compression'} at the thread (tensile area)`, rod, 'psi', sa.tens, '<='),
      detail('clevis pin double shear', pinShear, 'psi', sa.shear, '<='),
      detail('clevis pin bearing on the crank plate', pinBear, 'psi', sa.bear, '<='),
      detail('crank boss bending at the shaft bore (net of the bore)', crankBend, 'psi', sa.tens, '<='),
      detail('crank bar net section at the pin hole', net, 'psi', sa.tens, '<='),
    ];
    if (!b.g.linkTension) ds.push(detail('link rod buckling (Johnson, pin-ended) demand / allowable', buckle, '×', 1, '<='));
    const how = `${loadText(L, b)}. Link ${f(b.g.linkLen, 2)}" pin to pin, ${f(dr, 3)}" rod (3/8-24 thread, tensile area ${f(At, 4)} in²) carrying ${f(L.flink)} lbf ${b.g.linkTension ? 'in tension' : 'in compression'}: σ = ${f(rod, 0)} psi (≤ ${f(sa.tens, 0)} = A36 ${f(p.brakeSteelYieldPsi, 0)}/SF ${p.steelSafetyFactor}). ${b.g.linkTension ? '' : `Compression: free length ${f(freeLen, 2)}", r = d/4 = ${f(r, 3)}", KL/r = ${f(KLr, 0)} (Johnson limit C_c = ${f(Cc, 0)}), critical stress ${f(crit, 0)} psi; demand ÷ allowable = ${f(buckle, 2)}. `}Clevis pin ${f(dp, 4)}" in double shear τ = F/2A = ${f(L.flink)}/(2 × ${f(circleA(dp), 4)}) = ${f(pinShear, 0)} psi (≤ ${f(sa.shear, 0)}); bearing on the ${f(crankT, 2)}" crank plate F/(d·t) = ${f(pinBear, 0)} psi (≤ ${f(sa.bear, 0)} = 0.9 Fy/SF). Crank plate ${f(crankT, 2)}" thick × ${f(crankW, 2)}" wide at the boss (shaft + 2 × ${f(CRANK_LIGAMENT_IN, 3)}" ligament), shaft hole ${f(Dsh, 2)}" drilled and reamed: S_net = t(w³ − d³)/(6w) = ${f(crankSS, 4)} in³, M = F_link·d_S = ${f(L.flink * b.g.dS)} lbf·in, σ = ${f(crankBend, 0)} psi; net tension at the pin hole F/((w−d)·t) = ${f(net, 0)} psi. Oak lever tail bearing is in brake-lever (oak allowable ${f(al.oakDowel, 0)} psi).`;
    return governing(ds, how);
}

export function brakeLinks(ctx: Ctx): AnalysisCheck {
  return members('brake-links', 'Brake link, clevis pins and crank', ctx, (_c, L, b) => linksEval(ctx, L, b), ['D-38', 'D-2']);
}

function shaftEval(ctx: Ctx, L: Loads, b: Bundle): CaseEval {
  const { p } = ctx;
  const sa = steelAllow(ctx);
    const D = p.brakeShaftDiameterIn;
    const Y = b.g.y;
    const Z = (Math.PI * D ** 3) / 16; // polar section modulus
    // Overhang loads on the left bearing: crank at the link plane, arms at their planes (all in one plane: summed, conservative).
    const supY = Y.block[1];
    const aC = Math.abs(Y.plane - supY);
    const aIn = Math.abs((Y.armIn[0] + Y.armIn[1]) / 2 - supY);
    const aOut = Math.abs((Y.armOut[0] + Y.armOut[1]) / 2 - supY);
    const Fa = L.rPin / 2;
    const Mb = L.flink * aC + Fa * (aIn + aOut);
    const sigma = (32 * Mb) / (Math.PI * D ** 3);
    const Tside = L.tShoe;
    // Cross-drilled for roll pins (no keyseat, build review M10): the diametral hole takes πd³/16 → πd³/16 − d_p·d²/6 in torsion and
    // πd³/32 → πd³/32 − d_p·d²/6 in bending (conservative: the hole is taken at the left bearing, where M is largest).
    const dpin = p.brakeRollPinDiameterIn;
    const Znet = Z - (dpin * D ** 2) / 6;
    const Snet = (Math.PI * D ** 3) / 32 - (dpin * D ** 2) / 6;
    const tauSide = Tside / Znet;
    // At the cross-pin holes the moment is the ALGEBRAIC one: the link pulls the crank one way and the shoes pull the arm collars the other
    // (torque balance about the shaft), so at the crank's holes only the two arm-collar forces lie outboard: M_h = F_a (y_in − y_c + y_out − y_c).
    const yHubIn = Math.abs((Y.hubIn[0] + Y.hubIn[1]) / 2), yHubOut = Math.abs((Y.hubOut[0] + Y.hubOut[1]) / 2), yCrank = Math.abs(Y.plane);
    const Mh = Fa * (yHubIn - yCrank + yHubOut - yCrank);
    const sigmaNet = Mh / Snet;
    const vm = Math.sqrt(sigmaNet ** 2 + 3 * tauSide ** 2);
    const axleAllow = p.brakeShaftYieldPsi / p.steelSafetyFactor;
    // Roll pins: each arm collar carries T_shoe/2 through one diametral pin (two shear planes at radius ≈ d/2): τ = T/(d·A_p); the crank
    // carries T_in through two pins at 90° (each T_in/2).
    const hubLen = HUB_LEN_BARS * p.brakeBarThickIn;
    const pinA = circleA(dpin);
    const pinArm = (L.tShoe / 2) / (D * pinA);
    const pinCrank = (L.tin / 2) / (D * pinA);
    const pinBearShaft = ((L.tin / 2) / D) / (dpin * (D / 2));
    const mount = bearingMount(p, ctx.L, b.g.S, b.g.Q);
    const me = mountDetails(ctx, b.g, mount, L.feq);
    const ds: Detail[] = [
      detail('shaft torsion at a cross-pin hole (one side\'s shoe torque, net section)', tauSide, 'psi', 0.577 * axleAllow, '<='),
      detail('shaft bending + torsion (von Mises) at the crank cross-pin holes, net section', vm, 'psi', axleAllow, '<='),
      detail('arm-collar roll pin double shear', pinArm, 'psi', p.brakeRollPinShearPsi, '<='),
      detail('crank roll pins double shear (two pins at 90°)', pinCrank, 'psi', p.brakeRollPinShearPsi, '<='),
      detail('crank roll pin bearing on the shaft', pinBearShaft, 'psi', sa.bear, '<='),
      ...me.details,
    ];
    const how = `${loadText(L, b)}. Shaft ${f(D, 3)}" (pre-hardened 4140 ground rod, yield ${f(p.brakeShaftYieldPsi, 0)} psi; allowable ${f(axleAllow, 0)} psi = yield / SF ${p.steelSafetyFactor}). The crank is next to the left bearing and the left shoe arms take T_shoe each way, so the shaft carries at most T_shoe = ${f(Tside)} lbf·in. The shaft is cross-drilled ${f(dpin, 3)}" for roll pins (no keyseat, build review M10): net Z = πd³/16 − d_p·d²/6 = ${f(Znet, 4)} in³, τ = T/Z = ${f(tauSide, 0)} psi (≤ 0.577 × ${f(axleAllow, 0)}). Overhang bending at the left bearing: crank force ${f(L.flink)} lbf at ${f(aC, 2)}" + two arm forces R_pin/2 = ${f(Fa)} lbf at ${f(aIn, 2)}" and ${f(aOut, 2)}" (pin resultant R_pin = N_shoe·√(1+μ²) = ${f(L.rPin)} lbf; all summed in one plane, conservative): M = ${f(Mb)} lbf·in (gross σ = 32M/πd³ = ${f(sigma, 0)} psi); gross at the bearing, with every force summed in one direction, that is the conservative case. At the crank cross-pin holes the link force and the shoe forces act in OPPOSITE directions (torque balance), so only the arm-collar forces lie outboard: M_h = F_a·((y_in − y_c) + (y_out − y_c)) = ${f(Fa)} × (${f(yHubIn - yCrank, 2)} + ${f(yHubOut - yCrank, 2)}) = ${f(Mh)} lbf·in; net of the diametral hole S = πd³/32 − d_p·d²/6 = ${f(Snet, 4)} in³, σ = ${f(sigmaNet, 0)} psi; √(σ²+3τ²) = ${f(vm, 0)} psi. Roll pins ${f(dpin, 3)}" (allowable double shear ${f(p.brakeRollPinShearPsi, 0)} psi, heavy-duty spring pin ≈ 41 ksi ultimate ÷ 2): each arm collar (${f(hubLen, 2)}" wide, T_shoe/2 = ${f(L.tShoe / 2)} lbf·in) has one pin, τ = T/(d·A_p) = ${f(L.tShoe / 2)} / (${f(D, 2)} × ${f(pinA, 4)}) = ${f(pinArm, 0)} psi; the crank (T = ${f(L.tin)} lbf·in) has two pins at 90°, τ = ${f(pinCrank, 0)} psi; pin bearing on the shaft ${f(pinBearShaft, 0)} psi (≤ ${f(sa.bear, 0)}). ${me.text} Shaft bending at the bearing is NOT carried by the plates as a moment (the two bearings form the span: the lever rule is in the statics); the plates see the bearing force.`;
    return governing(ds, how);
}

export function brakeShaft(ctx: Ctx): AnalysisCheck {
  return members('brake-shaft', 'Brake cross shaft, keys and bearing mounts', ctx, (_c, L, b) => shaftEval(ctx, L, b), ['D-38', 'D-2']);
}

function shoesEval(ctx: Ctx, L: Loads, b: Bundle): CaseEval {
  const { p } = ctx;
  const sa = steelAllow(ctx);
  const al = allowables(ctx);
    const t = p.brakeBarThickIn, w = p.brakeBarWidthIn;
    const Sbar = (t * w ** 2) / 6;
    const Ma = L.tShoe / 2;
    const sigmaArm = Ma / Sbar;
    const Fa = L.rPin / 2;
    const dpin = p.brakeShoePinDiameterIn;
    const padW = b.g.y.pad[1] - b.g.y.pad[0];
    const Mpin = (L.rPin * padW) / 8; // pad load spread over the pad width, pin simply supported at the two arms
    const sigmaPin = (32 * Mpin) / (Math.PI * dpin ** 3);
    const tauPin = Fa / circleA(dpin);
    const bearArm = Fa / (dpin * t);
    const bearPad = L.rPin / (dpin * padW);
    const h = p.brakeShoeThickIn / 2;
    const rock = p.brakePadMu * h;
    const half = p.brakeShoeLengthIn / 2;
    const pressure = L.nShoe / (p.brakeShoeLengthIn * padW);
    const ds: Detail[] = [
      detail('arm bending at the hub (each of two arms)', sigmaArm, 'psi', sa.tens, '<='),
      detail('pad pin bending (pad load over its width)', sigmaPin, 'psi', sa.tens, '<='),
      detail('pad pin shear (double)', tauPin, 'psi', sa.shear, '<='),
      detail('pin bearing on the arm bar', bearArm, 'psi', sa.bear, '<='),
      detail('pin bearing in the oak pad (steel bushing bore)', bearPad, 'psi', al.oakDowel, '<='),
      detail('pad rock-off: μ·h_pin vs half the pad length', rock, 'in', half, '<='),
    ];
    const how = `${loadText(L, b)}. Per shoe: normal force N = ${f(L.nShoe)} lbf, friction μN = ${f(p.brakePadMu * L.nShoe)} lbf, pin resultant R = N√(1+μ²) = ${f(L.rPin)} lbf split over two arms (${f(Fa)} lbf each). Each arm (${f(t, 2)}" × ${f(w, 2)}" flat bar, ${f(b.g.armLen, 2)}" from the shaft to the pin) carries T_shoe/2 = ${f(Ma)} lbf·in: σ = M/S = ${f(Ma)}/${f(Sbar, 4)} = ${f(sigmaArm, 0)} psi (≤ ${f(sa.tens, 0)}). Pin ${f(dpin, 3)}": pad load R over ${f(padW, 2)}" between the arms, M = R·w/8 = ${f(Mpin)} lbf·in, σ = ${f(sigmaPin, 0)} psi; double shear τ = ${f(tauPin, 0)} psi; bearing on the arm bar ${f(bearArm, 0)} psi and in the oak pad ${f(bearPad, 0)} psi (≤ ${f(al.oakDowel, 0)}). The pad swivels on the pin at mid-thickness (h = ${f(h, 2)}" above the tread), so the contact resultant (normal + friction) is offset μ·h = ${f(rock, 2)}" along the pad; it stays on the pad while μ·h ≤ L/2 = ${f(half, 2)}". Average pad pressure on the tire ${f(pressure, 0)} psi (info).`;
    return governing(ds, how);
}

export function brakeShoes(ctx: Ctx): AnalysisCheck {
  return members('brake-shoes', 'Brake shoe arms, pin and pad', ctx, (_c, L, b) => shoesEval(ctx, L, b), ['D-38', 'D-2']);
}

function ratchetEval(ctx: Ctx, L: Loads, b: Bundle): CaseEval {
  const { p } = ctx;
  const sa = steelAllow(ctx);
  const al = allowables(ctx);
    const rg = b.rg;
    const Ft = L.ml / rg.rTooth;
    const d = p.brakeRatchetToothDepthIn, tp = p.brakeRatchetPlateThickIn, pit = p.brakeRatchetPitchIn;
    const bear = Ft / (d * tp);
    const shear = Ft / (pit * tp);
    const bend = (6 * Ft * d) / (tp * pit ** 2);
    const dpin = p.brakePawlPinDiameterIn;
    const wPawl = Math.min(p.brakeBarWidthIn, 0.75);
    const arm = Math.max(0.2, rg.pawlArm);
    const Spawl = (tp * (wPawl - dpin) ** 2) / 6;
    const pawlBend = (Ft * arm) / Spawl;
    const pinShear = Ft / circleA(dpin);
    const bracketBear = Ft / (2 * 0.25 * ctx.L.transom);
    const spanDeg = p.brakeRatchetSpanDeg;
    const appDeg = b.g.thetaL / RAD;
    const need = p.brakeStrokeReserve * appDeg;
    const ds: Detail[] = [
      detail('tooth face bearing (pawl on tooth)', bear, 'psi', sa.bear, '<='),
      detail('tooth root shear', shear, 'psi', sa.shear, '<='),
      detail('tooth root bending', bend, 'psi', sa.tens, '<='),
      detail('pawl bending (net of the pin hole)', pawlBend, 'psi', sa.tens, '<='),
      detail('pawl pivot screw single shear', pinShear, 'psi', sa.shear, '<='),
      detail('bracket bolts bearing in the transom (oak)', bracketBear, 'psi', al.oakDowel, '<='),
      detail('toothed span covers applied stroke × reserve', spanDeg, '°', need, '>='),
    ];
    const how = `${loadText(L, b)}. The pawl holds the lever moment M_L = ${f(L.ml)} lbf·in at the tooth radius R = ${f(rg.rTooth, 2)}": F_t = M_L/R = ${f(Ft)} lbf (the same load that holds the cart on ${f(p.designSlopeDeg)}° at λ ${f(L.lam, 2)}). Teeth ${f(pit, 3)}" pitch (${rg.nTeeth} teeth over ${f(spanDeg)}°), ${f(d, 3)}" deep, ${f(tp, 3)}" plate: face bearing F/(d·t) = ${f(bear, 0)} psi (≤ ${f(sa.bear, 0)} = 0.9 Fy/SF); root shear F/(pitch·t) = ${f(shear, 0)} psi (≤ ${f(sa.shear, 0)}); root bending 6·F·d/(t·pitch²) = ${f(bend, 0)} psi (≤ ${f(sa.tens, 0)}). Pawl bar ${f(wPawl, 2)}" wide, arm ${f(arm, 2)}" from its ${f(dpin, 3)}" pivot screw: σ = F·a/S_net = ${f(pawlBend, 0)} psi; screw single shear ${f(pinShear, 0)} psi. Bracket bolts (2 × ¼") bearing on the ${f(ctx.L.transom, 2)}" oak transom ${f(bracketBear, 0)} psi (≤ ${f(al.oakDowel, 0)}). Stroke: the applied lever angle is ${f(appDeg, 1)}°; the teeth cover ${f(spanDeg)}° ≥ ${f(p.brakeStrokeReserve, 1)} × ${f(appDeg, 1)}° = ${f(need, 1)}° so wear and tire compression can be taken up before the clevis needs adjusting. Release by lifting the spring-loaded pawl with the thumb tab; one tooth is ${f((pit / rg.rTooth) * b.g.lGrip, 2)}" of grip travel.`;
    return governing(ds, how);
}

export function brakeRatchet(ctx: Ctx): AnalysisCheck {
  return members('brake-ratchet', 'Parking ratchet (teeth, pawl, stroke)', ctx, (_c, L, b) => ratchetEval(ctx, L, b), ['D-39', 'D-38']);
}

// ── lever abuse: a scout hanging on the grip (eng r2 N-8) ─────────────────────────────────────────────────

/**
 * Loads for a hand force `F` at the grip with no reference to the rider: lever moment, link force and shaft torque follow from the statics; the shoes take
 * N = T / k_min (the servo direction, the larger normal force for the same pull).
 */
function loadsFromHand(ctx: Ctx, b: Bundle, F: number): Loads {
  const { p } = ctx;
  const ml = F * b.g.lGrip;
  const flink = b.g.dQ > 1e-6 ? ml / b.g.dQ : 0;
  const tin = flink * b.g.dS;
  const kMin = Math.max(1e-6, Math.min(b.g.kFwd, b.g.kRev));
  const nTot = tin / kMin;
  return { W: 0, down: 0, nHold: 0, lam: 0, nTot, nShoe: nTot / 2, feq: F, ml, flink, tin, tShoe: tin / 2, rPin: (nTot / 2) * Math.sqrt(1 + p.brakePadMu ** 2), kMax: Math.max(b.g.kFwd, b.g.kRev) };
}

export function brakeAbuse(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const b = brakeBundle(ctx);
  if (b.drum) return na('brake-abuse', 'Brake lever abuse (100 lbf at the grip)', 'Structure', 'the wooden-drum variant has no linkage geometry yet.');
  const L = loadsFromHand(ctx, b, p.brakeAbuseLbf);
  const k = p.steelSafetyFactor; // yield-level: the design allowables carry the safety factor, remove it (oak: its design value is already ≥ 2× below the ultimate)
  const parts: Array<[string, CaseEval]> = [
    ['lever', leverEval(ctx, L, b)], ['link/crank', linksEval(ctx, L, b)], ['shaft/mounts', shaftEval(ctx, L, b)], ['shoes', shoesEval(ctx, L, b)], ['ratchet', ratchetEval(ctx, L, b)],
  ];
  const ds: Detail[] = [];
  for (const [name, e] of parts) for (const d of scaleLimits(e.details ?? [], k)) ds.push({ ...d, name: `${name}: ${d.name}` });
  const worstD = ds.reduce((a, c) => (c.util > a.util ? c : a), ds[0]);
  const how = `A ${f(p.brakeAbuseLbf)} lbf pull at the grip (a scout hanging on the lever, ${f(p.brakeAbuseLbf / Math.max(1, p.handleForceLimitLbf), 1)}× the 30 lbf limit; ${f(p.brakeAbuseLbf / 43.3, 1)}× the λ = 2 design hand force at the goal rider): lever moment ${f(L.ml)} lbf·in, link force ${f(L.flink)} lbf, shaft torque ${f(L.tin)} lbf·in, shoe normal force ${f(L.nTot)} lbf (servo direction, k_min). Every lever, link, crank, shaft, pin, shoe and ratchet detail is re-evaluated at that load with its allowable multiplied back to yield level (steel SF ${f(k, 1)} removed; the oak design values are at least that far below the ultimate): the row is the governing detail, "${worstD.name}". The brake may be stiff after this; nothing may yield. The plate bolts, pivot post and weld are in the lever / shaft details.`;
  return singleCheck({
    id: 'brake-abuse', label: `Brake lever abuse, ${f(p.brakeAbuseLbf)} lbf at the grip (yield level)`, group: 'Structure', refs: ['D-38', 'D-48', 'eng r2 N-8'],
    value: worstD.value, unit: worstD.unit, limit: worstD.limit, sense: worstD.sense, how, details: ds,
  });
}

// ── rear push-handle sockets (D-9, D-39) ────────────────────────────────────────────────────────────────────

export function handleSockets(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const h = brakeBundle(ctx).h;
  const al = allowables(ctx);
  const sa = steelAllow(ctx);
  const F = p.handleHoldbackLbf;
  const Fp = F / 2; // per post
  const gripZ = p.rearHandleHeightIn;
  const lEff = Math.max(0.5, h.zTop - h.zFoot); // insertion length: foot to mouth
  const arm = gripZ - h.zFoot;
  const Rtop = (Fp * arm) / lEff;
  const Rbot = Rtop - Fp;
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
  const how = `A ${f(F)} lbf hold-back pull at the grip (${f(gripZ, 1)}" above the ground, D-9) shared by two uprights: ${f(Fp)} lbf each. Each upright is a cantilever from the socket mouth (${f(h.zTop, 1)}") to the grip: M = ${f(Fp)} × ${f(gripZ - h.zTop, 1)} = ${f(M)} lbf·in; ${f(w, 2)}" across × ${f(t, 2)}" fore-aft: S = ${f(S, 3)} in³, σ = ${f(sigma, 0)} psi (≤ ${f(al.oakBend, 0)}). The socket (steel tube, ${f(p.handleSocketDepthIn, 1)}" deep, wall ${f(wall, 3)}") reacts the moment with a couple over the insertion length ${f(lEff, 1)}" (foot ${f(h.zFoot, 1)}" to mouth): R_top = F_p·(grip − foot)/l = ${f(Fp)} × ${f(arm, 1)} / ${f(lEff, 1)} = ${f(Rtop)} lbf, R_foot = ${f(Math.abs(Rbot))} lbf; taking a contact length of depth/4 = ${f(contact, 2)}" at the mouth the post bears ${f(bearTop, 0)} psi (≤ ${f(al.oakPerp, 0)} oak ⊥ grain). Tube bending σ = M/S = ${f(M)}/${f(tubeS, 3)} = ${f(tubeSigma, 0)} psi (≤ ${f(alAllow, 0)} = 6061-T6 yield ${f(p.handleSocketYieldPsi, 0)} / SF ${p.steelSafetyFactor}; the sockets are aluminum, plan item 5); the ${f(bolt, 2)}" bolts and the ${f(dp, 3)}" pin bear on ${f(wall, 3)}" aluminum walls at ${f(wallBoltBear, 0)} and ${f(wallPinBear, 0)} psi; the top reaction ${f(Rtop)} lbf pulls on a ${f(washerOd, 2)}" fender washer (${f(pullThrough, 0)} psi on the oak, ≤ ${f(al.oakPerp, 0)} ⊥ grain); the two ¼" bolts bear on the ${f(ctx.L.transom, 2)}" transom ${f(boltBear, 0)} psi (≤ ${f(al.oakDowel, 0)}). The ${f(dp, 4)}" clevis pin keeps the post from lifting out: even if one pin took the whole ${f(F)} lbf, τ = F/2A = ${f(pinShear, 0)} psi.`;
  const g = governing(ds, how);
  return singleCheck({
    id: 'handle-sockets', label: `Rear push-handle sockets${g.suffix ? ` (${g.suffix})` : ''}`, group: 'Structure', refs: ['D-9', 'D-39'],
    value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, how, details: ds,
  });
}

// ── sweep: the moving linkage vs everything else, released → applied ─────────────────────────────────────────

export interface BrakeSweepResult {
  /** Smallest gap (in) between a moving brake part and any other solid over the stroke (analytic round tire; pads excluded from the tire). */
  minClearanceIn: number;
  moving: string;
  other: string;
  pose: number;
  /** Pad inner surface to the tread, released and applied (in). */
  padGapReleasedIn: number;
  padGapAppliedIn: number;
  /** Lowest point of any moving part over the stroke. */
  groundMinZ: number;
  poses: number;
}

const sweepCache = new Map<string, BrakeSweepResult>();
const RIDER_KEYS = ['riderMassLb', 'riderGoalMassLb', 'riderMinMassLb', 'cargoMassLb'];

const BIG = 99;
const L_GROUP = /^brake-(lever|link|crank$|pawl)/;
const S_GROUP = /^brake-(arm|shoe)/;

/** Distance from point to the solid tire cylinder (axis along y, centre (0, y0, r), radius r, half width). */
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

/** Radial gap (in) of a pad part's inner arc to the tread, from its extrusion outline in the world frame. */
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
  const b = brakeBundle(ctx);
  if (b.drum || !b.g.ok) return { minClearanceIn: BIG, moving: '–', other: '–', pose: 0, padGapReleasedIn: BIG, padGapAppliedIn: BIG, groundMinZ: BIG, poses: 0 };
  const key = JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => !RIDER_KEYS.includes(k)))) + `|${steps}`;
  const hit = sweepCache.get(key);
  if (hit) return hit;
  const r = ctx.L.r;
  const ry = p.rearTrackIn / 2;
  const yIn = ry - p.tireWidthIn / 2, yOut = ry + p.tireWidthIn / 2;
  const bctx = makeCtx(p, {});
  // With a flared gunwale the rear transom and side-web boxes are conservative bounds of the flared outline: the lever (which leans out
  // parallel to the web) and the pawl plate are measured against the real outline instead (analytic, below).
  const flared = ctx.L.flare > 0;
  const FLARE_BOX = /^(transom-rear|side-cabin-[LR]-web)$/;
  const obstacles = ctx.parts
    .filter((x) => !x.payload && x.group !== 'reference' && !/^brake-/.test(x.id) && !/^wheel-R[LR]$/.test(x.id))
    .flatMap((x) => partOBBs(x).map((o) => ({ id: x.id, o, rad: Math.hypot(...o.half) }))); // tight boxes: the S-curve members are not one big box (D-45)
  let best = { minClearanceIn: BIG, moving: '–', other: '–', pose: 0 };
  let padRel = BIG, padApp = BIG, groundMin = BIG;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const moving = buildBrakeAt(bctx, s, true);
    const mob = moving.map((x) => { const o = partOBB(x); return { id: x.id, part: x, o, rad: Math.hypot(...o.half) }; });
    for (const m of mob) {
      groundMin = Math.min(groundMin, worldAABB(m.part).min[2]);
      // vs the rest of the cart
      for (const ob of obstacles) {
        if (flared && FLARE_BOX.test(ob.id) && L_GROUP.test(m.id)) continue;
        const d = Math.hypot(m.o.center[0] - ob.o.center[0], m.o.center[1] - ob.o.center[1], m.o.center[2] - ob.o.center[2]) - m.rad - ob.rad;
        if (d > best.minClearanceIn) continue;
        const clr = -obbOverlap(m.o, ob.o);
        if (clr < best.minClearanceIn) best = { minClearanceIn: clr, moving: m.id, other: ob.id, pose: s };
      }
      // vs the round tires (pads touch by design: their gap is reported separately)
      if (!/^brake-shoe(-lining)?-[LR]$/.test(m.id)) {
        let dmin = Infinity;
        for (const pt of obbSamples(m.o)) dmin = Math.min(dmin, tireDistance(pt, r, yIn, yOut));
        if (dmin < best.minClearanceIn) best = { minClearanceIn: dmin, moving: m.id, other: 'tire', pose: s };
      } else {
        const gap = padGap(m.part, r);
        if (i === 0) padRel = Math.min(padRel, gap);
        if (i === steps) padApp = Math.min(padApp, gap);
      }
    }
    // lever group vs shoe group
    for (const a of mob) {
      if (!L_GROUP.test(a.id)) continue;
      for (const c of mob) {
        if (!S_GROUP.test(c.id)) continue;
        const clr = -obbOverlap(a.o, c.o);
        if (clr < best.minClearanceIn) best = { minClearanceIn: clr, moving: a.id, other: c.id, pose: s };
      }
    }
  }
  if (flared) {
    // Lever inboard face vs the flared hull outline from the deck up to the gunwale top (the lean keeps it parallel to the web).
    const L = ctx.L;
    const zTop = L.deckTop + L.sideH;
    let gap = Infinity;
    for (let z = L.deckBot; z <= zTop + 1e-9; z += 0.25) {
      const t = Math.max(0, Math.min(1, (z - L.web.z0) / Math.max(0.1, L.web.z1 - L.web.z0)));
      const hull = L.hwC + L.side + L.flare * t;
      const lever = b.g.y.lever[0] + Math.tan(b.g.lean) * Math.max(0, z - b.g.kneeZ);
      gap = Math.min(gap, lever - hull);
    }
    // (The ratchet plate hangs behind the transom, inboard of the lever by the pinch gap: its distance to the lever is reported in brake-clear.)
    if (gap < best.minClearanceIn) best = { minClearanceIn: gap, moving: 'brake-lever / pawl plate', other: 'flared hull outline', pose: 0 };
  }
  const res: BrakeSweepResult = { ...best, padGapReleasedIn: padRel, padGapAppliedIn: padApp, groundMinZ: groundMin, poses: steps + 1 };
  if (sweepCache.size > 12) sweepCache.clear();
  sweepCache.set(key, res);
  return res;
}

/** Finger-entrapment criteria (eng review, pinch gaps): a moving-part gap must be under a fingertip (3/16") or wider than the 1/2" band. */
const FINGER_GAP_MAX_IN = 0.1875;
const FINGER_BAND_TOP_IN = 0.5;
const NO_RUB_IN = 0.06;

/** Gaps at the hand lever: to the hull / gunwale, and to the ratchet plate over the plate's height (lever leaning out with a flared gunwale). */
export function leverGaps(ctx: Ctx): { hull: number; plate: number } {
  const b = brakeBundle(ctx);
  const { g, rg } = b;
  const Y = g.y;
  const hull = Y.lever[0] - (ctx.L.hwC + ctx.L.side);
  let plate = Infinity;
  for (let i = 0; i <= 8; i++) {
    const a = rg.a0 + (rg.span * i) / 8;
    for (const rad of [rg.rInner, rg.rTooth]) {
      const z = g.Q[1] + rad * Math.sin(a);
      const lever = Y.lever[0] + Math.tan(g.lean) * Math.max(0, z - g.kneeZ);
      plate = Math.min(plate, lever - Y.quad[1]);
    }
  }
  return { hull, plate };
}

export function brakeClearance(ctx: Ctx, sweep: BrakeSweepResult = brakeSweep(ctx)): AnalysisCheck {
  const { p } = ctx;
  const b = brakeBundle(ctx);
  if (b.drum) return na('brake-clear', 'Brake linkage clearance over the stroke', 'Braking', 'the wooden-drum variant has no linkage geometry yet.');
  const capped = sweep.minClearanceIn >= BIG - 1;
  const gaps = leverGaps(ctx);
  const details: Detail[] = [
    detail('pad gap to the tread, released (= stroke)', sweep.padGapReleasedIn, 'in', p.brakeShoeTravelIn - 0.03, '>='),
    detail('pad gap to the tread, applied (touching)', Math.abs(sweep.padGapAppliedIn), 'in', 0.03, '<='),
    detail('lowest moving part vs minimum ground clearance', sweep.groundMinZ, 'in', p.minGroundClearanceIn, '>='),
    detail('lever to ratchet plate gap: no rub', gaps.plate, 'in', NO_RUB_IN, '>='),
    detail('lever to ratchet plate gap: under a fingertip (3/16")', gaps.plate, 'in', FINGER_GAP_MAX_IN, '<='),
    detail('lever to hull gap: outside the 3/16"–1/2" finger-entrapment band', gaps.hull, 'in', FINGER_BAND_TOP_IN, '>='),
  ];
  const pinchFail = details.slice(3).some((d) => d.util > 1);
  const clearStatus: Status = judge(sweep.minClearanceIn, p.brakeClearanceIn, '>=');
  const status: Status = pinchFail ? worst(clearStatus, 'fail') : clearStatus;
  return singleCheck({
    id: 'brake-clear', label: 'Brake linkage clearance over the stroke', group: 'Braking', refs: ['D-38', 'D-16'],
    value: sweep.minClearanceIn, unit: 'in', limit: p.brakeClearanceIn, sense: '>=', details, status,
    how: `The moving brake parts (lever, link and clevises, crank, pawl, shoe arms, pins, pads and linings) are posed at ${sweep.poses} points from released to applied (lever solved from the closed link at each point) and tested against every other solid (hull, rails, storage box, axle beam, hubs, handle) with oriented-box separation, against the round rear tires by distance to the tire cylinder, and the lever group against the shoe group. ${capped ? `Everything stays > ${BIG}" apart.` : `Minimum clearance ${f(sweep.minClearanceIn, 2)}" between ${sweep.moving} and ${sweep.other} at ${f(sweep.pose * 100, 0)}% of the stroke.`} Limit ≥ ${f(p.brakeClearanceIn, 2)}". The linings sit ${f(sweep.padGapReleasedIn, 2)}" off the tread released (stroke ${f(p.brakeShoeTravelIn, 2)}") and ${f(sweep.padGapAppliedIn, 2)}" applied; the lowest point is ${f(sweep.groundMinZ, 2)}" above the ground (limit ${f(p.minGroundClearanceIn, 2)}"). Pinch points (eng review): the lever slides past the ratchet plate with a ${f(gaps.plate, 3)}" gap (≥ ${NO_RUB_IN}" so it cannot rub, ≤ ${FINGER_GAP_MAX_IN}" so a fingertip cannot enter) and stands ${f(gaps.hull, 3)}" off the hull (≥ ${FINGER_BAND_TOP_IN}", outside the 3/16"–1/2" finger-entrapment band).${pinchFail ? ' PINCH GAP OUT OF RANGE.' : ''}`,
  });
}
