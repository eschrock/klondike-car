/**
 * Braking checks for the handler's basic rear brake (Phase 3c-1, D-53; the D-13/D-38/D-48 cross-shaft analysis is gone): the lever ratio DERIVED from the
 * lever / link / beam geometry (`brakeGeometry`), the hand force to hold on the design slope, rear-only traction (info), the members (lever and pivot,
 * link and pins, beam, shoes), the parking pin, the push-handle sockets, a lever abuse check and a sweep of the mechanism over its stroke.
 *
 * Load path (all forces in lbf, moments in lbf·in; every row is hand-checkable from its `how` string):
 *   W sinθ / μ_pad = N_hold   total shoe normal force that holds the cart on the design slope; μ_pad is the LOWER of the bonded-lining wet μ and the
 *                             mud-fouled μ (`holdMu`), so the members are sized for the worst lining
 *   N = λ · N_hold            what the members are checked at (hard pull / jerk, `brakeLoadFactor`)
 *   F_beam = N (cos β + μ sin β)   the beam's forward pull (shoes a few degrees below the axle line); F_link = F_beam / u_x (u = link direction)
 *   hand-equivalent F = F_link d_Q / l_grip   (d_Q = pivot-to-link-line distance, l_grip = pivot-to-grip height, applied pose)
 *   pivot reaction R = F (hand, rearward) + F_link (link, rearward) pushed FORWARD by the bracket into the transom
 * Friction acts nearly vertically on the shoes (they sit within a few degrees of the axle line), so there is no servo: forward and reverse ratios differ by
 * a few percent, and the smaller one is critical.
 */
import { obbOverlap, partOBB, partOBBs, worldAABB, type OBB } from '../model/bounds';
import { brakeGeometry, buildBrakeAt, railGeometry, shoeLengthIn, type BrakeGeom } from '../model/brake';
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

/** Allowable stresses: A36 flat bar, plates (yield / steel SF; shear 0.577; bearing 0.9), 316 bolts and pins, 6061-T6 aluminum. */
function allow(ctx: Ctx) {
  const { p } = ctx;
  const fy = p.brakeSteelYieldPsi / p.steelSafetyFactor;
  const fb = p.kingpinCrossBoltYieldPsi / p.steelSafetyFactor;
  const fa = p.brakeAluminumYieldPsi / p.steelSafetyFactor;
  return { steel: fy, steelShear: 0.577 * fy, steelBear: 0.9 * fy, bolt: fb, boltShear: 0.577 * fb, al: fa, alShear: 0.577 * fa, alBear: fa };
}

interface Loads {
  W: number; down: number; nHold: number; lam: number; nTot: number; nShoe: number;
  /** Beam forward pull, link force, hand-equivalent force at the grip, lever moment about the pivot, pivot reaction (vector and magnitude), friction per shoe (vertical). */
  Fc: number; Flink: number; feq: number; ml: number; R: [number, number]; Rmag: number; muN: number;
}

function fromNormal(ctx: Ctx, g: BrakeGeom, nTot: number, W: number, down: number, nHold: number, lam: number): Loads {
  const { p } = ctx;
  const beta = g.bl.beta;
  const Fc = nTot * (Math.cos(beta) + p.brakePadMu * Math.sin(beta));
  const Flink = g.ux > 1e-6 ? Fc / g.ux : 0;
  const ml = Flink * g.dQ;
  const feq = g.lGrip > 1e-6 ? ml / g.lGrip : 0;
  const R: [number, number] = [feq + Flink * g.ux, Flink * ((g.B1[1] - g.T1[1]) / Math.max(1e-9, g.linkLen))];
  return { W, down, nHold, lam, nTot, nShoe: nTot / 2, Fc, Flink, feq, ml, R, Rmag: Math.hypot(R[0], R[1]), muN: (p.brakePadMu * nTot) / 2 };
}

function loadsAt(ctx: Ctx, c: CaseData, g: BrakeGeom): Loads {
  const { p } = ctx;
  const down = c.massLb * Math.sin(p.designSlopeDeg * RAD);
  const nHold = down / holdMu(p);
  return fromNormal(ctx, g, p.brakeLoadFactor * nHold, c.massLb, down, nHold, p.brakeLoadFactor);
}

/** Loads for a hand force `F` at the grip with no reference to the rider (the abuse case): N follows from the beam pull in the direction that gives the larger N. */
function loadsFromHand(ctx: Ctx, g: BrakeGeom, F: number): Loads {
  const { p } = ctx;
  const Flink = g.dQ > 1e-6 ? (F * g.lGrip) / g.dQ : 0;
  const Fc = Flink * g.ux;
  const kMin = Math.max(1e-6, Math.cos(g.bl.beta) - p.brakePadMu * Math.sin(g.bl.beta));
  const nTot = Fc / kMin;
  const R: [number, number] = [F + Flink * g.ux, Flink * ((g.B1[1] - g.T1[1]) / Math.max(1e-9, g.linkLen))];
  return { W: 0, down: 0, nHold: 0, lam: 0, nTot, nShoe: nTot / 2, Fc, Flink, feq: F, ml: F * g.lGrip, R, Rmag: Math.hypot(R[0], R[1]), muN: (p.brakePadMu * nTot) / 2 };
}

const loadText = (L: Loads, g: BrakeGeom) =>
  `Hold load W·sinθ/μ = ${f(L.W)} × sin θ / μ = ${f(L.nHold)} lbf total shoe normal force; × λ ${f(L.lam, 2)} = N ${f(L.nTot)} lbf (${f(L.nShoe)} per shoe); beam pull F_c = N (cos β + μ sin β) = ${f(L.Fc)} lbf; link force F_link = F_c / u_x = ${f(L.Fc)} / ${f(g.ux, 3)} = ${f(L.Flink)} lbf; hand-equivalent F = F_link·d_Q / l_grip = ${f(L.Flink)} × ${f(g.dQ, 2)} / ${f(g.lGrip, 2)} = ${f(L.feq)} lbf; lever moment M_L = ${f(L.ml)} lbf·in; pivot reaction R = ${f(L.Rmag)} lbf (forward, into the transom)`;

// ── lever ratio, handle force, traction ─────────────────────────────────────────────────────────────────────

export function brakeRatio(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const g = brakeBundle(ctx).g;
  const how = `Derived from the lever / link / beam geometry, not assumed (D-53). In the vertical x–z plane with the pull applied to the grip: ratio = N_total / F_hand = (l_grip / d_Q) · u_x / (cos β ± μ sin β), where l_grip = ${f(g.lGrip, 2)}" (pivot to grip height ${f(g.gripZ, 1)}"), d_Q = ${f(g.dQ, 2)}" = perpendicular distance of the lever pivot from the link line at the applied pose (lever tail ${f(g.tailIn, 2)}", link ${f(g.linkLen, 2)}" pin to pin in ${g.linkTension ? 'tension' : 'compression'}, u_x = ${f(g.ux, 3)} its forward cosine), and the shoes sit β = ${f(g.bl.beta / RAD, 1)}° below the axle line, so the friction (μ = ${f(p.brakePadMu, 2)}) adds only ±μ sin β = ${f(p.brakePadMu * Math.sin(g.bl.beta), 3)} to cos β = ${f(Math.cos(g.bl.beta), 3)}. Ratio with the cart rolling forward ${f(g.ratioFwd, 1)}:1, backward ${f(g.ratioRev, 1)}:1; the smaller, ${f(g.ratioCrit, 1)}:1 (${g.critical}), is the critical case and is what the force check uses. Target ≥ ${f(p.brakeLeverRatio, 1)}:1. Stroke: ${f(p.brakeShoeTravelIn, 4)}" at the shoe takes the beam ${f(g.bl.stroke, 3)}", the lever ${f(g.thetaL / RAD, 1)}° (${f(g.gripTravelIn, 1)}" at the grip; limit ${f(p.brakeGripTravelMaxIn, 1)}", status verify: feel-test the mock-up).${g.ok ? '' : ` NOT VALID: ${g.why || 'no ratio'}.`}`;
  const details: Detail[] = [
    detail('ratio, rolling forward', g.ratioFwd, ':1', p.brakeLeverRatio, '>='),
    detail('ratio, rolling backward', g.ratioRev, ':1', p.brakeLeverRatio, '>='),
    detail('grip travel, released to applied (hand lever sweep)', g.gripTravelIn, 'in', p.brakeGripTravelMaxIn, '<='),
  ];
  return singleCheck({
    id: 'brake-ratio', label: 'Brake mechanical advantage (derived from geometry)', group: 'Braking', refs: ['D-53', 'D-13'],
    value: g.ok ? g.ratioCrit : 0, unit: ':1', limit: p.brakeLeverRatio, sense: '>=', marginalAbs: 0.5, how, details,
    status: [judge(g.gripTravelIn, p.brakeGripTravelMaxIn, '<=')].reduce((x, y) => worst(x, y), judge(g.ok ? g.ratioCrit : 0, p.brakeLeverRatio, '>=', 0.5)),
  });
}

export function brakeForce(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const th = p.designSlopeDeg * RAD;
  const g = brakeBundle(ctx).g;
  const ratio = g.ratioCrit > 1e-6 ? g.ratioCrit : p.brakeLeverRatio;
  const BARE_OAK_MU = 0.25;
  const ev = (c: CaseData): CaseEval => {
    const down = c.massLb * Math.sin(th);
    const eta = ratio * p.brakeEfficiency;
    const muD = p.brakePadMu, muF = p.brakePadMuFouled;
    const Fd = down / muD / eta; // bonded lining, wet
    const Ff = down / muF / eta; // mud / slush fouled lining: the pass/fail case
    const Fbare = down / BARE_OAK_MU / eta;
    const F = Math.max(Fd, Ff);
    return {
      value: F, unit: 'lbf', limit: p.handleForceLimitLbf, sense: '<=', suffix: Ff >= Fd ? 'mud-fouled lining' : 'wet lining',
      details: [
        detail(`handle force, wet bonded lining μ ${f(muD, 2)}`, Fd, 'lbf', p.handleForceLimitLbf, '<='),
        detail(`handle force, mud / slush-fouled lining μ ${f(muF, 2)} (pass/fail)`, Ff, 'lbf', p.handleForceLimitLbf, '<='),
        detail(`info: bare wet oak μ ${BARE_OAK_MU} (why the lining is specified; not pass/fail)`, Fbare, 'lbf', p.handleForceLimitLbf, '<='),
      ],
      how: `F = W·sinθ / μ / (ratio · η) = ${f(c.massLb)} × sin ${f(p.designSlopeDeg)}° / μ / (${f(ratio, 1)} × ${f(p.brakeEfficiency, 2)}); W·sinθ = ${f(down)} lbf downslope. Wet bonded lining μ ${f(muD, 2)}: ${f(down / muD)} lbf total shoe normal force → ${f(Fd)} lbf at the grip. MUD / SLUSH-FOULED lining μ ${f(muF, 2)} (the shoes sit on the rear of the tread, the wettest part): ${f(down / muF)} lbf shoe normal force → ${f(Ff)} lbf at the grip. The row value is the larger of the two, ${f(F)} lbf, limit ≤ ${p.handleForceLimitLbf} lbf (pass/fail at BOTH μ). Bare wet oak (μ ${BARE_OAK_MU}, no lining) would need ${f(Fbare)} lbf: the lining is what makes the brake work in the wet. (Shoe friction acts at the tire radius, 1:1 with ground force. The ratio ${f(ratio, 1)}:1 is DERIVED from the geometry (brake-ratio): handle force to TOTAL shoe normal force; one lever pushes one beam that loads both shoes equally.) Only the rear wheels brake (D-53): the front wheels roll.`,
    };
  };
  return dualCheck({
    id: 'brake-force', label: 'Brake lever force to hold on the slope', group: 'Braking', refs: ['D-53', 'D-13', 'BRIEF §7'], primary: 'operating',
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

function leverEval(ctx: Ctx, L: Loads, g: BrakeGeom): CaseEval {
  const { p } = ctx;
  const a = allow(ctx), al = allowables(ctx);
  const w = p.brakeLeverWidthIn, t = p.brakeBarThickIn, plateT = p.brakePlateThickIn;
  const pivD = p.brakePivotBoltDiameterIn, pinD = p.brakeClevisPinDiameterIn;
  const Snet = (t * (w ** 3 - pivD ** 3)) / (6 * w);
  const sigma = L.ml / Snet;
  const tailNet = L.Flink / ((w - pinD) * t);
  const tailBear = L.Flink / (pinD * t);
  const pivShear = L.Rmag / (2 * circleA(pivD));
  const pivBearBar = L.Rmag / (pivD * t);
  const pivBearEar = L.Rmag / (2 * pivD * plateT);
  const earEdge = 0.8 - pivD / 2;
  const earTear = L.Rmag / 2 / (2 * earEdge * plateT);
  const baseArea = (2 * (g.y.ear[1] + 0.5)) * (g.base.z1 - g.base.z0);
  const transomBear = Math.max(0, L.R[0]) / baseArea;
  const bd = p.brakeBracketBoltDiameterIn;
  const boltShear = Math.abs(L.R[1]) / (4 * circleA(bd));
  const ds: Detail[] = [
    detail('lever bar bending at the pivot (net of the bolt hole)', sigma, 'psi', a.al, '<='),
    detail('lever tail net tension at the link pin hole', tailNet, 'psi', a.al, '<='),
    detail('link pin bearing on the lever tail (aluminum)', tailBear, 'psi', a.alBear, '<='),
    detail('pivot bolt double shear (316)', pivShear, 'psi', a.boltShear, '<='),
    detail('pivot bolt bearing on the lever bar (aluminum)', pivBearBar, 'psi', a.alBear, '<='),
    detail('pivot bolt bearing on the two ears (steel)', pivBearEar, 'psi', a.steelBear, '<='),
    detail('ear hole tear-out (steel)', earTear, 'psi', a.steelShear, '<='),
    detail('bracket plate bearing on the transom (oak ⊥ grain)', transomBear, 'psi', al.oakPerp, '<='),
    detail('bracket bolts, vertical shear of the pivot reaction (4 bolts)', boltShear, 'psi', a.boltShear, '<='),
  ];
  const how = `${loadText(L, g)}. Lever bar ${f(w, 2)}" (in the plane) × ${f(t, 2)}" (across), 6061-T6 (allowable ${f(a.al, 0)} psi = ${f(p.brakeAluminumYieldPsi, 0)} / SF ${p.steelSafetyFactor}), pivot bolt ${f(pivD, 3)}": S_net = t(w³ − d³)/(6w) = ${f(Snet, 3)} in³, σ = M_L/S = ${f(L.ml)} / ${f(Snet, 3)} = ${f(sigma, 0)} psi. Tail net tension F_link / ((w − d)·t) = ${f(tailNet, 0)} psi; link-pin bearing F_link/(d·t) = ${f(tailBear, 0)} psi. The pivot reaction R = ${f(L.Rmag)} lbf pushes the bracket FORWARD into the transom (the hand and the link both pull the lever back): double shear on the ${f(pivD, 3)}" bolt ${f(pivShear, 0)} psi, bearing on the bar ${f(pivBearBar, 0)} psi and on the two ${f(plateT, 3)}" ears ${f(pivBearEar, 0)} psi, ear tear-out ${f(earTear, 0)} psi; the ${f(2 * (g.y.ear[1] + 0.5), 2)}" × ${f(g.base.z1 - g.base.z0, 2)}" plate bears on the transom at ${f(transomBear, 0)} psi (oak ⊥ grain allowable ${f(al.oakPerp, 0)}). The transom itself is not checked as a plate here (open item for 3c-3: it is backed by the deck edge and the corner backers).`;
  return governing(ds, how);
}

export function brakeLever(ctx: Ctx): AnalysisCheck {
  return members('brake-lever', 'Brake hand lever, pivot bolt and bracket', ctx, (L, g) => leverEval(ctx, L, g), ['D-53', 'D-2']);
}

function linksEval(ctx: Ctx, L: Loads, g: BrakeGeom): CaseEval {
  const { p } = ctx;
  const a = allow(ctx);
  const t = p.brakeBarThickIn, w = p.brakeBarWidthIn, pinD = p.brakeClevisPinDiameterIn;
  const barA = (w - pinD) * t; // net section of one bar at the pin hole
  const axial = L.Flink / (2 * barA);
  const pinShear = L.Flink / (2 * circleA(pinD)); // each pin: the middle plate (lever tail or clevis tab) pushes the pair of bars, double shear
  const pinBearBars = L.Flink / (2 * pinD * t);
  const tabEdge = 0.5 + 1.5 * pinD - pinD / 2;
  const tabTear = L.Flink / 2 / (tabEdge * t);
  const tabBear = L.Flink / (pinD * t);
  const free = Math.max(0.1, g.linkLen - pinD);
  const r = t / Math.sqrt(12);
  const KLr = free / r;
  const E = p.steelMoePsi;
  const Cc = Math.sqrt((2 * Math.PI ** 2 * E) / p.brakeSteelYieldPsi);
  const crit = KLr <= Cc ? p.brakeSteelYieldPsi * (1 - KLr ** 2 / (2 * Cc ** 2)) : (Math.PI ** 2 * E) / KLr ** 2;
  const buckle = L.Flink / 2 / (w * t) / (crit / p.steelSafetyFactor);
  const footBolts = L.Flink / (2 * circleA(0.25)); // 1/4" bolts take the whole link force as tension/shear: a bound
  const ds: Detail[] = [
    detail('link bars, net section at the pin hole (two bars)', axial, 'psi', a.steel, '<='),
    detail('link pins double shear (316)', pinShear, 'psi', a.boltShear, '<='),
    detail('link pin bearing on the bars (steel)', pinBearBars, 'psi', a.steelBear, '<='),
    detail('clevis tab hole tear-out (steel)', tabTear, 'psi', a.steelShear, '<='),
    detail('clevis tab pin bearing (steel)', tabBear, 'psi', a.steelBear, '<='),
    detail('link bars buckling (Johnson, pin-ended) demand / allowable', buckle, '×', 1, '<='),
    detail('clevis foot bolts (2 × 1/4", the whole link force, a bound)', footBolts, 'psi', a.bolt, '<='),
  ];
  const how = `${loadText(L, g)}. Two ${f(t, 2)}" × ${f(w, 2)}" A36 bars straddle the lever tail and the clevis tab, ${f(g.linkLen, 2)}" pin to pin, carrying ${f(L.Flink)} lbf in compression: net σ = F/(2(w − d)t) = ${f(axial, 0)} psi (≤ ${f(a.steel, 0)}). Pins ${f(pinD, 3)}" in double shear ${f(pinShear, 0)} psi; bearing on the bars ${f(pinBearBars, 0)} psi; clevis tab tear-out ${f(tabTear, 0)} psi and bearing ${f(tabBear, 0)} psi. Buckling: free length ${f(free, 2)}", r = t/√12 = ${f(r, 3)}", KL/r = ${f(KLr, 0)} (Johnson limit C_c = ${f(Cc, 0)}), critical ${f(crit, 0)} psi; demand ÷ allowable = ${f(buckle, 2)}. The clevis foot's two 1/4" through-bolts are a bound: ${f(footBolts, 0)} psi on their shank area.`;
  return governing(ds, how);
}

export function brakeLinks(ctx: Ctx): AnalysisCheck {
  return members('brake-links', 'Brake link bars, pins and clevis tab', ctx, (L, g) => linksEval(ctx, L, g), ['D-53', 'D-2']);
}

function beamEval(ctx: Ctx, L: Loads, g: BrakeGeom): CaseEval {
  const { p } = ctx;
  const a = allow(ctx), al = allowables(ctx);
  const size = p.brakeBeamSizeIn, wall = p.brakeBeamWallIn;
  const ri = size - 2 * wall;
  const S = (size ** 4 - ri ** 4) / (6 * size);
  const Jt = 2 * (size - wall) ** 2 * wall; // thin-wall closed section: 2 A_m t
  const { rail } = railGeometry(p, ctx.L);
  const yR = rail.yOut - rail.t / 2;
  const ry = g.y.shoeC;
  const fcShoe = L.Fc / 2;
  const Mh = fcShoe * ry; // plan bending at the center: the end loads against the center pull
  const MhRail = fcShoe * (ry - yR);
  const Mv = L.muN * (ry - yR); // vertical friction at the shoe, reacted by the rail notch
  const sigCenter = Mh / S;
  const sigRail = (MhRail + Mv) / S;
  const tShoeOff = size / 2 + p.brakeLiningThickIn + p.brakeShoeBackThickIn;
  const tau = (L.muN * tShoeOff) / Jt;
  // Shoe bolt holes and the clevis bolts through the tube walls (crush sleeves): wall bearing.
  const bearWall = L.Flink / (2 * 0.25 * wall) / 2;
  // Keeper strap: the vertical friction pulls the beam DOWN (the rolling direction that drags the tread down): screws in withdrawal, W = 1380 G² D ℓ.
  const G = p.oakSpecificGravity;
  const Dscr = 0.19, pen = 1.2;
  const withdraw = 1380 * G * G * Dscr * pen;
  const screwLoad = L.muN / 4; // 4 screws per keeper, the one-sided reaction
  const keeperT = p.brakeKeeperThickIn;
  const keeperSpan = g.bl.notch.x1 - g.bl.notch.x0;
  const keeperW = rail.t;
  const sigKeeper = ((L.muN * keeperSpan) / 4) / ((keeperW * keeperT ** 2) / 6);
  // Rail notch walls: the beam presses a wall only for lateral scatter; the notch roof carries the upward friction on the tube's top face.
  const roofBear = L.muN / (keeperSpan * rail.t);
  const ds: Detail[] = [
    detail('beam bending at the center (plan, end shoe loads against the center pull)', sigCenter, 'psi', a.al, '<='),
    detail('beam bending at the rail notch (plan + vertical friction, summed)', sigRail, 'psi', a.al, '<='),
    detail('beam torsion from the shoe friction offset', tau, 'psi', a.alShear, '<='),
    detail('tube wall bearing at the clevis bolts (aluminum)', bearWall, 'psi', a.alBear, '<='),
    detail('keeper screws withdrawal from the rail bottom (4 × #10 × 1.2" in oak) demand / capacity', screwLoad / withdraw, '×', 1, '<='),
    detail('keeper strap bending (steel)', sigKeeper, 'psi', a.steel, '<='),
    detail('notch roof bearing from the upward friction (oak ⊥ grain)', roofBear, 'psi', al.oakPerp, '<='),
  ];
  const how = `${loadText(L, g)}. Beam ${f(size, 2)}" square × ${f(wall, 3)}" wall 6061-T6 tube (S = ${f(S, 3)} in³; allowable ${f(a.al, 0)} psi), ${f(2 * g.y.beamHalf, 1)}" long, shoes at ±${f(ry, 2)}", rails at ±${f(yR, 2)}". Each shoe pushes back F_c/2 = ${f(fcShoe)} lbf: M at the center = ${f(fcShoe)} × ${f(ry, 2)} = ${f(Mh)} lbf·in, σ = ${f(sigCenter, 0)} psi. At the rail notch the end loads give ${f(MhRail)} lbf·in plus the vertical friction μN = ${f(L.muN)} lbf over the ${f(ry - yR, 2)}" overhang = ${f(Mv)} lbf·in: σ = ${f(sigRail, 0)} psi (summed, conservative). Torsion from μN acting ${f(tShoeOff, 2)}" off the tube axis: τ = ${f(tau, 0)} psi. Keeper: ${f(screwLoad)} lbf per screw against a withdrawal capacity of ${f(withdraw, 0)} lbf (NDS 1380·G²·D·ℓ, G = ${f(G, 2)}).`;
  return governing(ds, how);
}

export function brakeBeam(ctx: Ctx): AnalysisCheck {
  return members('brake-beam', 'Brake beam, keepers and rail notches', ctx, (L, g) => beamEval(ctx, L, g), ['D-53', 'D-2']);
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
  return members('brake-shoes', 'Brake shoes (lining pressure and back plate)', ctx, (L, g) => shoesEval(ctx, L, g), ['D-53', 'D-56']);
}

// ── parking hold (the hitch pin through the lever and the quadrant ear) ───────────────────────────────────────

export function parkHold(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const th = p.designSlopeDeg * RAD;
  const g = brakeBundle(ctx).g;
  const a = allow(ctx);
  const t = p.brakeBarThickIn, plateT = p.brakePlateThickIn, pinD = p.brakeClevisPinDiameterIn;
  const Rp = g.park.radius;
  const ev = (c: CaseData): CaseEval => {
    // The pin holds the lever against the link reaction. Without the hand, moment about the pivot: F_pin·R_p = F_link·d_Q. Held at the λ = 1 hold load (the pin is
    // set on a quiet cart) and checked at the λ hold as well (a jerk on a parked cart).
    const L1 = { ...loadsAt(ctx, c, g) };
    const nHold1 = L1.nHold;
    const L = fromNormal(ctx, g, nHold1, c.massLb, L1.down, nHold1, 1);
    const Lj = loadsAt(ctx, c, g);
    const Fpin = (Lj.Flink * g.dQ) / Rp;
    const shear = Fpin / circleA(pinD); // single shear plane, between the lever bar and the ear
    const bearBar = Fpin / (pinD * t);
    const bearEar = Fpin / (pinD * plateT);
    const edge = PARK_EDGE_IN - pinD / 2;
    const tear = Fpin / (2 * edge * plateT);
    const ground = (p.tireGroundMu * c.massLb * Math.cos(th)) / Math.max(1e-9, c.massLb * Math.sin(th));
    const lastDeg = (g.park.angles[g.park.angles.length - 1] - g.thetaL) / RAD;
    const ds: Detail[] = [
      detail('parking pin single shear (λ hold)', shear, 'psi', a.boltShear, '<='),
      detail('pin bearing on the lever bar (aluminum)', bearBar, 'psi', a.alBear, '<='),
      detail('pin bearing on the quadrant ear (steel)', bearEar, 'psi', a.steelBear, '<='),
      detail('ear hole tear-out toward the arc edge (steel)', tear, 'psi', a.steelShear, '<='),
      detail('wear take-up: holes past the design hole (≥ 6°)', lastDeg, '°', 6, '>='),
    ];
    return {
      ...governing(ds, `${loadText(Lj, g)}. Parked on ${f(p.designSlopeDeg)}° the brake is held by the hitch pin ${f(Rp, 1)}" from the pivot (a hole in the ear every ${f(p.brakeParkPitchIn, 2)}" along the arc, ${g.park.angles.length} holes, the second is the design applied position at ${f(g.thetaL / RAD, 1)}° and the others take up wear): F_pin = F_link·d_Q / R_p = ${f(Lj.Flink)} × ${f(g.dQ, 2)} / ${f(Rp, 1)} = ${f(Fpin)} lbf at the λ ${f(Lj.lam, 1)} load (${f(L.Flink * g.dQ / Rp)} lbf at the plain hold). Ground friction with the rear wheels locked and the fronts rolling: ${f(ground, 2)}× the downslope pull at μ ${f(p.tireGroundMu, 2)} on a level contact (info; brake-traction has the load transfer).`),
    };
  };
  return dualCheck({ id: 'park-hold', label: 'Parking hold: hitch pin and quadrant ear', group: 'Structure', refs: ['D-53', 'D-39'], primary: 'goal', ...evalBoth(ctx, ev) });
}

/** Distance from a parking hole center to the ear's arc edge (in): the ear band is `PARK_BAND_IN` wide each side of the arc (model/brake.ts). */
const PARK_EDGE_IN = 0.55;

// ── lever abuse: a scout hanging on the grip (eng r2 N-8, simplified at 3c-1) ─────────────────────────────

export function brakeAbuse(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const g = brakeBundle(ctx).g;
  const L = loadsFromHand(ctx, g, p.brakeAbuseLbf);
  const k = p.steelSafetyFactor; // yield-level: the design allowables carry the safety factor, remove it
  const parts: Array<[string, CaseEval]> = [
    ['lever', leverEval(ctx, L, g)], ['link', linksEval(ctx, L, g)], ['beam', beamEval(ctx, L, g)], ['shoes', shoesEval(ctx, L, g)],
  ];
  const ds: Detail[] = [];
  for (const [name, e] of parts) for (const d of scaleLimits(e.details ?? [], k)) ds.push({ ...d, name: `${name}: ${d.name}` });
  const worstD = ds.reduce((a, c) => (c.util > a.util ? c : a), ds[0]);
  const how = `A ${f(p.brakeAbuseLbf)} lbf pull at the grip (a scout hanging on the lever, ${f(p.brakeAbuseLbf / Math.max(1, p.handleForceLimitLbf), 1)}× the 30 lbf limit): lever moment ${f(L.ml)} lbf·in, link force ${f(L.Flink)} lbf, beam pull ${f(L.Fc)} lbf, shoe normal force N = ${f(L.nTot)} lbf total (${f(L.nShoe)} per shoe; the larger-N rolling direction). Every lever, link, beam and shoe criterion is held to yield (the design allowables with the safety factor ${p.steelSafetyFactor} removed): worst "${worstD.name}", ${f(worstD.value, 1)} ${worstD.unit} against ${f(worstD.limit, 1)}. The brake may be bent after this only if the row says so.`;
  return singleCheck({
    id: 'brake-abuse', label: `Brake lever abuse, ${f(p.brakeAbuseLbf)} lbf at the grip (yield level)`, group: 'Structure', refs: ['D-53', 'eng r2 N-8'],
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
  /** Smallest gap (in) between a moving brake part and any other solid over the stroke (the rail notch and the tire are measured separately). */
  minClearanceIn: number;
  moving: string;
  other: string;
  pose: number;
  /** Shoe lining to the tread, released and applied (in). */
  padGapReleasedIn: number;
  padGapAppliedIn: number;
  /** Lowest point of any brake part over the stroke. */
  groundMinZ: number;
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
  if (!g.ok) return { minClearanceIn: BIG, moving: '–', other: '–', pose: 0, padGapReleasedIn: BIG, padGapAppliedIn: BIG, groundMinZ: BIG, poses: 0 };
  const key = JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => !RIDER_KEYS.includes(k)))) + `|${steps}`;
  const hit = sweepCache.get(key);
  if (hit) return hit;
  const r = ctx.L.r;
  const ry = p.rearTrackIn / 2;
  const yIn = ry - p.tireWidthIn / 2, yOut = ry + p.tireWidthIn / 2;
  const bctx = makeCtx(p, {});
  // Intended contacts: the beam rides in the rail notches (measured analytically in brake-clear), the spring hooks on the transom, the parking pin stows in the lever.
  const SKIP = /^(rail-cabin|girder-cabin)-/;
  const obstacles = ctx.parts
    .filter((x) => !x.payload && x.group !== 'reference' && !/^brake-/.test(x.id) && !/^wheel-R[LR]$/.test(x.id))
    .flatMap((x) => partOBBs(x).map((o) => ({ id: x.id, o, rad: Math.hypot(...o.half) })));
  let best = { minClearanceIn: BIG, moving: '–', other: '–', pose: 0 };
  let padRel = BIG, padApp = BIG, groundMin = BIG;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const moving = buildBrakeAt(bctx, s, true).filter((x) => !x.id.startsWith('handle-'));
    const mob = moving.map((x) => { const o = partOBB(x); return { id: x.id, part: x, o, rad: Math.hypot(...o.half) }; });
    for (const m of mob) {
      groundMin = Math.min(groundMin, worldAABB(m.part).min[2]);
      for (const ob of obstacles) {
        if (SKIP.test(ob.id)) continue;
        if (m.id === 'brake-return-spring' && ob.id === 'transom-rear') continue;
        const d = Math.hypot(m.o.center[0] - ob.o.center[0], m.o.center[1] - ob.o.center[1], m.o.center[2] - ob.o.center[2]) - m.rad - ob.rad;
        if (d > best.minClearanceIn) continue;
        const clr = -obbOverlap(m.o, ob.o);
        if (clr < best.minClearanceIn) best = { minClearanceIn: clr, moving: m.id, other: ob.id, pose: s };
      }
      if (!/^brake-shoe-[LR]$/.test(m.id)) {
        let dmin = Infinity;
        for (const pt of obbSamples(m.o)) dmin = Math.min(dmin, tireDistance(pt, r, yIn, yOut));
        if (dmin < best.minClearanceIn) best = { minClearanceIn: dmin, moving: m.id, other: 'tire', pose: s };
      } else {
        const gap = padGap(m.part, r);
        if (i === 0) padRel = Math.min(padRel, gap);
        if (i === steps) padApp = Math.min(padApp, gap);
      }
    }
  }
  const res: BrakeSweepResult = { ...best, padGapReleasedIn: padRel, padGapAppliedIn: padApp, groundMinZ: groundMin, poses: steps + 1 };
  if (sweepCache.size > 12) sweepCache.clear();
  sweepCache.set(key, res);
  return res;
}

export function brakeClearance(ctx: Ctx, sweep: BrakeSweepResult = brakeSweep(ctx)): AnalysisCheck {
  const { p } = ctx;
  const g = brakeBundle(ctx).g;
  const bl = g.bl;
  const wallRear = bl.xRear - bl.notch.x0;
  const wallFront = bl.notch.x1 - (bl.xFront + bl.stroke);
  // Lever bar front edge to the pivot bracket plate over the plate's height at the applied pose (the bar leans back above the pivot, so the gap only grows there).
  let edgeGap = Infinity;
  {
    const lw = p.brakeLeverWidthIn;
    const nF: [number, number] = [Math.cos(g.tilt), Math.sin(g.tilt)];
    const up = (g.gripZ - g.Q[1]) / Math.cos(g.tilt);
    for (let s = -g.tailIn; s <= up; s += 0.1) {
      const q: [number, number] = [g.Q[0] + g.e[0] * s + nF[0] * lw / 2, g.Q[1] + g.e[1] * s + nF[1] * lw / 2];
      const c = Math.cos(g.thetaL), sn = Math.sin(g.thetaL);
      const d: [number, number] = [q[0] - g.Q[0], q[1] - g.Q[1]];
      const pt: [number, number] = [g.Q[0] + d[0] * c - d[1] * sn, g.Q[1] + d[0] * sn + d[1] * c];
      if (pt[1] >= g.base.z0 && pt[1] <= g.base.z1) edgeGap = Math.min(edgeGap, g.base.x0 - pt[0]);
    }
    if (!Number.isFinite(edgeGap)) edgeGap = BIG;
  }
  const capped = sweep.minClearanceIn >= BIG - 1;
  const details: Detail[] = [
    detail('shoe lining gap to the tread, released (= stroke)', sweep.padGapReleasedIn, 'in', p.brakeShoeTravelIn - 0.03, '>='),
    detail('shoe lining gap to the tread, applied (touching)', Math.abs(sweep.padGapAppliedIn), 'in', 0.03, '<='),
    detail('lowest brake part vs minimum ground clearance', sweep.groundMinZ, 'in', p.minGroundClearanceIn, '>='),
    detail('beam to the notch rear wall, released', wallRear, 'in', 0.06, '>='),
    detail('beam to the notch front wall, applied', wallFront, 'in', 0.06, '>='),
    detail('lever bar edge to the bracket plate (outside the 3/16"–1/2" finger band)', edgeGap, 'in', 0.5, '>='),
  ];
  const clearStatus: Status = judge(sweep.minClearanceIn, p.brakeClearanceIn, '>=');
  const pinchFail = details.slice(2).some((d) => d.util > 1);
  const status: Status = pinchFail ? worst(clearStatus, 'fail') : clearStatus;
  return singleCheck({
    id: 'brake-clear', label: 'Brake mechanism clearance over the stroke', group: 'Braking', refs: ['D-53', 'D-16'],
    value: sweep.minClearanceIn, unit: 'in', limit: p.brakeClearanceIn, sense: '>=', details, status,
    how: `The moving brake parts (beam, shoes, clevis, link bars and pins, lever, grip, spring) are posed at ${sweep.poses} points from released to applied (the lever angle solved from the closed link at each point) and tested against every other solid except the rail notch they ride in and the tire the shoes press (hull, transom, storage box, push handle, rear axle beam, wheels): least gap ${capped ? 'more than 99' : f(sweep.minClearanceIn, 2)}" (${sweep.moving} vs ${sweep.other}, at pose ${f(sweep.pose, 2)}); limit ≥ ${f(p.brakeClearanceIn, 2)}". The shoe lining is ${f(sweep.padGapReleasedIn, 2)}" off the tread released and ${f(Math.abs(sweep.padGapAppliedIn), 2)}" applied (stroke ${f(p.brakeShoeTravelIn, 3)}"). Lowest brake part ${f(sweep.groundMinZ, 2)}" (keeper strap bottom; limit ${f(p.minGroundClearanceIn, 1)}"). The beam has ${f(wallRear, 3)}" to the notch rear wall released and ${f(wallFront, 3)}" to the front wall applied. The lever bar stands ${f(p.brakeLeverStandoffIn, 2)}" off the bracket plate, outside the 3/16"–1/2" finger-entrapment band.`,
  });
}
