/**
 * Front-end detail checks (Phase 3 workstream A, D-31…D-35): the steering stops (M1) and their share-1.0 bounding row, the kingpin steel
 * plates and their NDS bolt groups, cleavage and tear-out (M2, M4), the pitch-moment path (M3) and the bridle tie points (M6). Each is
 * evaluated at the operating and the goal rider like the other structure rows (D-2); the `how` strings carry the hand arithmetic.
 *
 * Round 2 (D-35). The kingpin runs in a steel sleeve through the front beam; a carrier plate on the beam and a plate under it clamp the
 * beam with six bolts in one line, a third plate under the crossbar takes the pin at the top. The oak therefore sees only the bolt
 * groups: per-bolt NDS lateral capacity (src/analysis/nds.ts), row tear-out, edge distances, cleavage with cross-bolts.
 */
import { kingpinBoreIn, steerStopPlan } from '../params';
import { BRIDLE_APEX_AHEAD_IN } from '../model/steering';
import { kingpinPlatePlan } from '../model/kingpin-plates';
import { toothThickness, triangularFace } from '../model/stops';
import type { Ctx } from './context';
import { dualCheck, singleCheck, detail, governing, type CaseEval } from './dual';
import { f } from './format';
import type { CaseData } from './loads';
import { boltSpacing, cleavageVr, feAtAngle, fePerp, feParallel, lateralZ, rowTearOut } from './nds';
import { evalBoth } from './stability';
import { allowables, frontLoadText, part, strikeCases, tieHalfY, wheelLoads, yawTorque } from './structure';
import type { AnalysisCheck, Detail } from './types';

const STEEL_TENSILE_AREA_FRAC = 0.75; // threaded tensile stress area ≈ 0.75 × the gross shank area (as in roll-bolster-attach)
const DEG = 180 / Math.PI;

const boxSize = (ctx: Ctx, id: string): [number, number, number] | null => {
  const x = part(ctx, id);
  return x && x.geometry.type === 'box' ? x.geometry.size : null;
};

// ── Pin statics and the plate model (D-35) ───────────────────────────────────────────────────────────────────────

/**
 * The pin as an overhanging beam: supported at the sleeve's two ends (a apart), loaded by the crossbar plate b above the top support.
 * Reactions R_top = H(1 + b/a) (same direction as H on the pin), R_bot = −H·b/a, and the bending moment is H·b at the top support.
 */
export function pinReactions(H: number, a: number, b: number): { Rtop: number; Rbot: number; M: number } {
  return { Rtop: H * (1 + b / a), Rbot: (-H * b) / a, M: H * b };
}

export interface PlateModel {
  /** Sleeve span a and the load height b above its top (in). */
  a: number;
  b: number;
  beam: { n: number; D: number; ys: number[]; x: number; lm: number; tTop: number; tBot: number; frontDist: number; grooveDist: number; pitch: number; nCross: number; crossD: number; crossWasher: number };
  bar: { n: number; D: number; xs: number[]; lm: number; t: number; pitch: number; endDist: number; edgeDist: number; nCross: number; crossD: number; crossWasher: number };
  /** Plate thicknesses and footprints (in). */
  carrier: { t: number; hx: number; hy: number };
  barPlate: { t: number; hx: number; hy: number };
  holeD: number;
}

/** Everything the plate rows need, read from the model's parts and their structured joints (the analysis reads real fasteners, D-33). */
export function plateModel(ctx: Ctx): PlateModel | null {
  const { p, L } = ctx;
  const kpl = L.kpPlates;
  const car = part(ctx, 'kp-carrier');
  const bar = part(ctx, 'kp-bar-plate');
  const cb = L.crossbar;
  if (!kpl || !car || !bar || !cb) return null;
  const kp = kingpinPlatePlan(p);
  const beamPart = part(ctx, 'beam-F');
  const bj = (car.joints ?? []).filter((j) => j.type === 'bolt' && j.to === 'beam-F');
  const cross = (beamPart?.joints ?? []).find((j) => j.type === 'bolt' && j.to === 'kp-carrier'); // fore-aft cross-bolts through the beam
  const barJ = (bar.joints ?? []).filter((j) => j.type === 'bolt' && j.to === 'kingpin-crossbar');
  const bCross = (part(ctx, 'kingpin-crossbar')?.joints ?? []).find((j) => j.type === 'bolt' && j.to === 'kp-bar-plate' && /cross-bolt/i.test(j.size ?? ''));
  const plate = bj[0];
  const bPlate = barJ[0];
  if (!plate || !bPlate) return null;
  const ys = (plate.at ?? []).map((a) => a[1]);
  const xb = plate.at?.[0]?.[0] ?? 0;
  const D = plate.diaIn ?? kp.D;
  const xs = (bPlate.at ?? []).map((a) => a[0]);
  const rodR = p.axleDiameterIn / 2;
  const frontDist = L.beamF.x + L.beamF.thick / 2 - (L.kx + xb);
  const grooveDist = L.kx + xb - (L.WB + rodR);
  const sortedY = [...ys].sort((u, v) => u - v);
  const pitch = sortedY.length > 1 ? Math.min(...sortedY.slice(1).map((y, i) => y - sortedY[i]).filter((d) => d > 0.01)) : 0;
  const sortedX = [...xs].sort((u, v) => u - v);
  const barPitch = sortedX.length > 1 ? Math.min(...sortedX.slice(1).map((x, i) => x - sortedX[i])) : 0;
  const barBoltD = bPlate.diaIn ?? kp.D;
  const endDist = cb.x1 - L.kx - Math.max(...xs.map(Math.abs));
  // The sleeve spigots into the plates, so its reactions act at the plates' mid-thickness: a = carrier mid − beam-plate mid, b = crossbar-plate mid − carrier mid.
  const kpb = { a: (kpl.carrier.z0 + kpl.carrier.z1) / 2 - (kpl.under.z0 + kpl.under.z1) / 2, b: (kpl.bar.z0 + kpl.bar.z1) / 2 - (kpl.carrier.z0 + kpl.carrier.z1) / 2 };
  const carSize = boxSize(ctx, 'kp-carrier'), barSize = boxSize(ctx, 'kp-bar-plate');
  return {
    a: kpb.a, b: kpb.b,
    beam: {
      n: plate.count, D, ys, x: xb, lm: L.beamF.depth, tTop: kpl.carrier.z1 - kpl.carrier.z0, tBot: kpl.under.z1 - kpl.under.z0, frontDist, grooveDist, pitch,
      nCross: cross?.count ?? 0, crossD: cross?.diaIn ?? p.kingpinCrossBoltDiameterIn, crossWasher: p.kingpinCrossBoltWasherIn,
    },
    bar: {
      n: bPlate.count, D: barBoltD, xs, lm: cb.z1 - cb.z0, t: kpl.bar.z1 - kpl.bar.z0, pitch: barPitch, endDist, edgeDist: cb.hw,
      nCross: bCross?.count ?? 0, crossD: bCross?.diaIn ?? p.kingpinCrossBoltDiameterIn, crossWasher: p.kingpinCrossBoltWasherIn,
    },
    carrier: { t: kpl.carrier.z1 - kpl.carrier.z0, hx: (carSize?.[0] ?? 2 * kp.carrier.hx) / 2, hy: (carSize?.[1] ?? 2 * kp.carrier.hy) / 2 },
    barPlate: { t: kpl.bar.z1 - kpl.bar.z0, hx: (barSize?.[0] ?? 2 * kp.bar.hx) / 2, hy: (barSize?.[1] ?? 2 * kp.bar.hy) / 2 },
    holeD: p.kingpinDiameterIn + 1 / 64,
  };
}

/** NDS adjustment on a lateral design value: C_M (wet) × C_D (impact, ≤ 1.6) × C_g (group). */
export const ndsAdjust = (p: { ndsWetFactorFasteners: number; ndsLoadDurationFactor: number; ndsGroupFactor: number }): number =>
  p.ndsWetFactorFasteners * p.ndsLoadDurationFactor * p.ndsGroupFactor;

/** Adjusted lateral capacity (lbf) of one plate bolt in the oak at angle θ to the grain, steel side plate of thickness ls, oak length lm. */
export function boltCapacity(ctx: Ctx, D: number, lm: number, ls: number, thetaDeg: number): { Zref: number; Z: number; mode: string; Fem: number; Re: number } {
  const { p } = ctx;
  const Fem = feAtAngle(feParallel(p.oakSpecificGravity), fePerp(p.oakSpecificGravity, D), thetaDeg);
  const r = lateralZ({ D, lm, ls, Fem, Fes: p.steelDowelBearingPsi, Fyb: p.kingpinPlateBoltYieldPsi, thetaDeg });
  return { Zref: r.Z, Z: r.Z * ndsAdjust(p), mode: r.mode, Fem, Re: Fem / p.steelDowelBearingPsi };
}

export interface PinLoad { name: string; Hx: number; Hy: number; T: number }

/** Governing pin load cases at one rider case (all horizontal, at the pin): the two-wheel strike, the one-wheel strike with the stop pair, the bridle pull, the lateral skid. */
export function pinLoads(ctx: Ctx, c: CaseData, share?: number): PinLoad[] {
  const { p } = ctx;
  const yaw = yawTorque(ctx, c);
  const cases = strikeCases(ctx, c);
  const Hgov = Math.max(...cases.map((s) => s.H));
  const env = stopEnv(ctx, c, share);
  const net = env ? env.net : 0;
  const w = wheelLoads(ctx, c);
  const Fy = p.tireGroundMu * w.frontAxle * p.dynamicFactor;
  return [
    { name: 'two-wheel strike', Hx: Hgov, Hy: 0, T: 0 },
    { name: 'one-wheel strike + stops', Hx: yaw.Hw + net, Hy: 0, T: yaw.T },
    { name: 'bridle pull', Hx: p.pullForceLbf, Hy: 0, T: yaw.rope },
    { name: 'lateral skid', Hx: 0, Hy: Fy, T: 0 },
  ];
}

// ── Steering stop compliance (D-35) ─────────────────────────────────────────────────────────────────────────────

/** Stiffness of one stop: a bonded urethane pad of area A and thickness t at modulus E, k = E·A/t (lbf/in). */
export const stopStiffness = (E: number, A: number, t: number): number => (E * A) / t;

/**
 * Share of the pair's total force P taken by the stiffer stop when the other closes `mismatch` later: the stiffer stop has compressed
 * δ more, so F1 − F2 = k·δ and F1 + F2 = P, share = F1/P = ½ + k·δ/(2P), at most 1 (the other stop is not touching).
 */
export function stopShare(k: number, mismatch: number, P: number): number {
  if (!(P > 0)) return 0.5;
  return Math.min(1, 0.5 + (k * mismatch) / (2 * P));
}

export interface StopEnv {
  T: number;
  rEff: number;
  /** Total force of the pair P = T/r_eff, the share of the stiffer stop, its force F and the net force the pair leaves on the kingpin. */
  P: number;
  share: number;
  F: number;
  net: number;
  k: number;
  area: number;
  hFace: number;
  len: number;
  tri: ReturnType<typeof triangularFace>;
  plan: ReturnType<typeof steerStopPlan>;
}

/** The stop pair at one rider case. `share` overrides the stiffness-derived share (1 = the bounding case). */
export function stopEnv(ctx: Ctx, c: CaseData, share?: number): StopEnv | null {
  const { p } = ctx;
  const plan = steerStopPlan(p);
  const pad = boxSize(ctx, 'steer-stop-face-L1');
  if (!plan.ok || !pad) return null;
  const yaw = yawTorque(ctx, c);
  const len = pad[1], hFace = pad[2];
  const tri1 = triangularFace(plan.ra, plan.rb, hFace, yaw.T);
  const P = yaw.T / tri1.rEff;
  const area = len * hFace;
  const k = stopStiffness(p.steerStopPadModulusPsi, area, plan.tf);
  const sh = share ?? stopShare(k, p.steerStopFitMismatchIn, P);
  const tri = triangularFace(plan.ra, plan.rb, hFace, sh * yaw.T);
  return { T: yaw.T, rEff: tri1.rEff, P, share: sh, F: sh * P, net: (2 * sh - 1) * P, k, area, hFace, len, tri, plan };
}

// ── M1: steering stops ──────────────────────────────────────────────────────────────────────────────────────────

/** Rows shared by the design stops row and the share-1.0 bounding row; `bound` swaps the allowables for the pad yield / the wood strength. */
function stopDetails(ctx: Ctx, env: StopEnv, bound: boolean): { ds: Detail[]; text: string } {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const { plan, tri, F } = env;
  const ringDepth = L.bolster.z1 - L.bolster.z0;
  const al0 = plan.teeth[0]; // the left-aft tooth; the other three are its mirror / 180° images
  const woodK = bound ? p.woodSafetyFactor : 1;
  const steelK = bound ? p.steelSafetyFactor : 1;
  const Fx = F * Math.abs(al0.n.x), Fy = F * Math.abs(al0.n.y);
  const pRail = al0.railLen > 0 ? Fx / (al0.railLen * ringDepth) : Infinity;
  const pBar = al0.barLen > 0 ? Fy / (al0.barLen * ringDepth) : 0;
  const padLim = bound ? p.steerStopPadYieldPsi : p.steerStopPadAllowPsi;
  const tS = p.steerStopFacePlateIn;
  const hF = env.hFace;
  const sigFl = (3 * tri.pMax * hF * hF) / (tS * tS); // flange as a cantilever from the web under the face pressure: 6·(p·h²/2)/t²
  const riser = boxSize(ctx, 'steer-stop-riser-L');
  const arm = part(ctx, 'steer-stop-arm-L');
  const armSize = boxSize(ctx, 'steer-stop-arm-L');
  const wDog = plan.t; // channel / riser width across x
  const hRiser = riser ? riser[2] : 0;
  const dRiser = riser ? riser[1] : 0.5;
  const Mr = F * hRiser; // the face force acts at web level (the web bears on the top plate under overturning); the riser is a short cantilever
  const sigR = riser ? (6 * Mr) / (dRiser * wDog * wDog) : 0;
  const tauR = riser ? F / (dRiser * wDog) : 0;
  const dScr = p.steerStopScrewDiameterIn;
  const Ascr = (Math.PI * dScr * dScr) / 4;
  const At = STEEL_TENSILE_AREA_FRAC * Ascr;
  const nScr = (arm?.joints?.find((j) => j.type === 'screw' && j.to === 'kp-carrier')?.count) ?? 2;
  const steelAllow = p.kingpinPlateBoltYieldPsi / (p.steelSafetyFactor / steelK); // grade 8 screw: yield / SF
  // The dog is a cantilever from the riser: the face force F at r_eff and the riser at its own radius y_r, so the riser and arm also see a moment about
  // the vertical axis M_z = F·(r_eff − y_r), carried as a couple of y-forces on the two screws of each joint (lever = their spacing).
  const yR = plan.ra - dRiser / 2;
  const Mz = F * Math.max(0, env.rEff - yR);
  const levRiser = 0.6, levArm = 2 * 0.55; // screw spacings across x: riser ±0.3", arm ±0.55"
  const Tris = Mr / levRiser, Tarm = Mr / levArm;
  const vRis = Math.hypot(F / 2, Mz / levRiser), vArm = Math.hypot(F / nScr, Mz / levArm);
  const interRis = Math.sqrt((vRis / Ascr / (0.577 * steelAllow)) ** 2 + (Tris / At / steelAllow) ** 2);
  const interArm = Math.sqrt((vArm / Ascr / (0.577 * steelAllow)) ** 2 + (Tarm / At / steelAllow) ** 2);
  const armLen = armSize ? armSize[1] : 2;
  const toeA = armLen * (p.carrierPlateThickIn + 0.5); // the carrier spreads the toe load over about its own thickness + half the arm thickness
  const pToe = Tarm / toeA;
  const tEng = p.carrierPlateThickIn;
  const bearScr = vArm / (dScr * tEng); // screw bearing on the tapped carrier hole
  const Tg = (Math.PI * dScr * (tEng * 0.75) * 0.5 * (0.577 * p.kingpinPlateYieldPsi)) / (p.steelSafetyFactor / steelK); // thread stripping: ½·π·d·(¾ of the plate engaged)·shear
  const ds: Detail[] = [
    detail(`urethane pad pressure at the stop face, peak (triangular)`, tri.pMax, 'psi', padLim, '<='),
    detail('pad compression strain (δ/t)', F / env.k / plan.tf, '', bound ? 0.5 : 0.3, '<='),
    detail('stop block bearing on the bolster rail face (oak ⊥)', pRail, 'psi', al.oakPerp * woodK, '<='),
    ...(al0.barLen > 0 ? [detail('stop block bearing on the crossbar side (oak ⊥)', pBar, 'psi', al.oakPerp * woodK, '<=')] : []),
    detail('channel flange bending under the pad pressure (steel)', sigFl, 'psi', p.kingpinPlateYieldPsi / (p.steelSafetyFactor / steelK) , '<='),
    ...(riser ? [
      detail('riser bending at its base (force at web level)', sigR, 'psi', p.kingpinPlateYieldPsi / (p.steelSafetyFactor / steelK), '<='),
      detail('riser shear', tauR, 'psi', (0.577 * p.kingpinPlateYieldPsi) / (p.steelSafetyFactor / steelK), '<='),
      detail('riser screws (to the arm): shear incl. the dog\'s vertical-axis moment + tension, ellipse', interRis, '', 1, '<='),
      detail('arm screws (to the carrier): shear incl. the dog\'s vertical-axis moment + tension, ellipse', interArm, '', 1, '<='),
      detail('arm screw thread stripping in the carrier (tapped hole)', Tarm, 'lbf', Tg, '<='),
      detail('arm screw bearing on the carrier hole (steel)', bearScr, 'psi', al.plateBrg * steelK, '<='),
      ...(ctx.L.kpPlates ? [detail('arm toe on the carrier, onto the beam top (oak ⊥)', pToe, 'psi', al.oakPerp * woodK, '<=')] : []),
    ] : []),
  ];
  const text = `Pad: bonded ${f(plan.tf, 3)}" urethane, area ${f(env.area, 2)} in² (${f(env.len, 2)}" × ${f(hF, 2)}"), E ${f(p.steerStopPadModulusPsi, 0)} psi → k = E·A/t = ${f(env.k, 0)} lbf/in. Pair force P = T/r_eff = ${f(env.T)}/${f(env.rEff, 2)} = ${f(env.P)} lbf; the stiffer stop takes F = ${f(F)} lbf (share ${f(env.share, 3)}). Face pressure peak p_max = 3·T₁·s₂/(h(s₂³−s₁³)) = ${f(tri.pMax, 0)} psi (mean ${f(tri.pAvg, 0)}); the wedge splits F into ${f(Fx)} lbf on the rail face (${f(al0.railLen, 2)}" × ${f(ringDepth, 2)}" = ${f(pRail, 0)} psi) and ${f(Fy)} lbf on the crossbar side (${f(al0.barLen, 2)}" × ${f(ringDepth, 2)}" = ${f(pBar, 0)} psi) against oak ⊥ ${f(al.oakPerp * woodK, 0)} psi. Flange as a cantilever under the face pressure: σ = 3·p·h²/t² = ${f(sigFl, 0)} psi. ${riser ? `Riser (${f(wDog, 2)}" × ${f(dRiser, 2)}" × ${f(hRiser, 2)}"): the face force F acts at web level, M = F·${f(hRiser, 2)}" = ${f(Mr)} lb·in, σ = 6M/(d·w²) = ${f(sigR, 0)} psi, τ = F/(d·w) = ${f(tauR, 0)} psi; the dog's cantilever (F at r_eff ${f(env.rEff, 2)}" vs the riser at ${f(yR, 2)}") adds M_z = ${f(Mz)} lb·in; riser screws (${f(levRiser, 1)}" apart) ${f(vRis)} lbf shear + ${f(Tris)} lbf tension (interaction ${f(interRis, 2)}); arm screws (${f(levArm, 1)}" apart) ${f(vArm)} lbf shear + ${f(Tarm)} lbf tension (interaction ${f(interArm, 2)}, thread strip ${f(Tarm)} lbf vs ${f(Tg)}, bearing ${f(bearScr, 0)} psi); toe pressure on the beam top ${f(pToe, 0)} psi.` : ''}`;
  return { ds, text };
}

export function steerStopsCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const dogPart = part(ctx, 'steer-stop-L');
  const plan = steerStopPlan(p);
  if (!plan.ok || !dogPart) {
    return singleCheck({
      id: 'steer-stops', label: 'Steering stops', group: 'Structure', value: 0, unit: 'psi', limit: al.oakPerp, sense: '<=', status: 'fail', load: 'goal',
      how: `The steering stops do not fit this design (${plan.why || 'no stop dog in the model'}): see the validator.`, refs: ['D-31', 'D-35'],
    });
  }
  const ev = (c: CaseData): CaseEval => {
    const env = stopEnv(ctx, c)!;
    const yaw = yawTorque(ctx, c);
    const Hgov = Math.max(...strikeCases(ctx, c).map((s) => s.H));
    const Kvec = yaw.Hw + env.net;
    const { ds, text } = stopDetails(ctx, env, false);
    // The pin itself is checked in kingpin-strike / kingpin-plates / kingpin-bolts at the load pinLoads() gives (it includes this net force). The stop pair
    // only matters to the pin if it makes a WORSE case than the two-wheel strike, so this is a governs / does-not-govern test, not a margin.
    if (Kvec > Hgov) ds.push(detail('net kingpin load with the stop pair exceeds the governing kingpin strike load', Kvec, 'lbf', Hgov, '<='));
    const tThin = Math.min(toothThickness(plan.a, plan.cb, plan.W, plan.lock, plan.ra), toothThickness(plan.a, plan.cb, plan.W, plan.lock, plan.rb));
    const how = `Yaw torque on the steer body about the kingpin: ${yaw.governing} T = ${f(yaw.T)} lb·in (one-wheel curb strike: H_w = ${f(yaw.Hw)} lbf [V_w ${f(yaw.Vw)} lbf, ${frontLoadText(ctx, wheelLoads(ctx, c))}] × y_w ${f(yaw.yw, 2)}" = ${f(yaw.strike)}; hard rope pull ${p.pullForceLbf} lbf × tie ${f(yaw.yTie, 2)}" = ${f(yaw.rope)}). Two stops close at lock (a 180° couple: dog L on the aft-left block, dog R on the fore-right block, and the mirror at −lock). Each dog is a ${f(plan.t, 2)}" steel channel standing on a riser and an arm INSIDE the ${p.turntableCenterHoleIn}" turntable hole (nothing through the ball ring), with a bonded urethane pad on each face; the dog spans s = ${f(plan.ra, 2)}…${f(plan.rb, 2)}" from the kingpin: r_eff = ⅔(s₂³−s₁³)/(s₂²−s₁²) = ${f(env.rEff, 2)}". ${text} Net on the kingpin: (2·share − 1)·P = ${f(env.net)} lbf, so with H_w = ${f(yaw.Hw)} lbf the pin sees ${f(Kvec)} lbf against the ${f(Hgov)} lbf two-wheel strike that already governs; the bounding row 'steer-stops-bound' puts the whole torque on one stop (share 1). Thinnest wood behind the face where the block is trimmed: ${f(tThin, 2)}" (rule ≥ ${p.stopBlockMinIn}"). Stop torque into the carrier and its bolt group: row 'kingpin-bolts'. Not modeled: the channel web touching the top plate under overturning (≈ ${f(env.F * env.hFace / 2 / 0.9)} lbf vertical, a UHMW pad on the web underside is specified); stiffness of the lazy-susan plates.`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'steer-stops', label: 'Steering stops: urethane-faced dogs, risers, stop blocks', group: 'Structure', refs: ['D-31', 'D-35', 'D-12', 'A3'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

/** Raise the limit of every '<=' detail by k (the abuse case is held to strength, not to the design allowable). */
export function scaleLimits(ds: Detail[], k: number): Detail[] {
  return ds.map((d) => (d.sense === '<=' ? detail(d.name, d.value, d.unit, d.limit * k, '<=') : d));
}

/** The bounding case (critic Phase 3 r1 MF-1): one stop closes and the other does not, so the whole torque is on one stop (share 1.0). */
export function steerStopsBoundCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const plan = steerStopPlan(p);
  if (!plan.ok || !part(ctx, 'steer-stop-L')) {
    return singleCheck({ id: 'steer-stops-bound', label: 'Steering stops, bounding case (share 1.0)', group: 'Structure', value: 0, unit: 'psi', limit: al.oakPerp, sense: '<=', status: 'fail', load: 'goal', how: `The steering stops do not fit this design (${plan.why || 'no stop dog in the model'}).`, refs: ['D-35'] });
  }
  const ev = (c: CaseData): CaseEval => {
    const env = stopEnv(ctx, c, 1)!;
    const yaw = yawTorque(ctx, c);
    const { ds, text } = stopDetails(ctx, env, true);
    const bolts = plateModel(ctx);
    let boltTxt = '';
    if (bolts) {
      const load: PinLoad = { name: 'one stop only', Hx: yaw.Hw + env.net, Hy: 0, T: yaw.T };
      const bd = beamBoltDetails(ctx, bolts, load);
      // Abuse case: the plate bolts are held to the NDS value × the wood safety factor and the steel plate rows to their strength (× the steel safety factor).
      for (const d of scaleLimits(bd.details.filter((x) => /carrier end|under end/.test(x.name)), p.woodSafetyFactor)) ds.push(d);
      const pd = plateSteelDetails(ctx, bolts, load);
      for (const d of scaleLimits(pd.details, p.steelSafetyFactor)) ds.push(d);
      boltTxt = ` Kingpin plates and bolts at the same load (${f(load.Hx)} lbf on the pin, T = ${f(yaw.T)} lb·in): ${bd.text}`;
    }
    const how = `One stop takes the whole torque (share 1.0: the other never touches, a fit-up mismatch of P/k = ${f(env.P / env.k, 3)}" or a missing shim): F = P = T/r_eff = ${f(env.T)}/${f(env.rEff, 2)} = ${f(env.P)} lbf, and the net force it leaves on the kingpin is P (no cancellation): ${f(env.net)} lbf + H_w ${f(yaw.Hw)} = ${f(yaw.Hw + env.net)} lbf. This is an ABUSE case, not a design load: the pad is held to its yield ${f(p.steerStopPadYieldPsi, 0)} psi, the oak, the plate bolts (NDS value) and the steel to their allowable × the safety factor (strength, SF 1). ${text}${boltTxt} Why it exists: the 60/40 share of round 1 cannot be built with wood faces (k ≈ 480 kip/in, a 0.005" mismatch closes one stop); the pad (k = ${f(env.k / 1000, 1)} kip/in) is what makes the design share ${f(stopShare(env.k, p.steerStopFitMismatchIn, env.P), 2)}.`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'steer-stops-bound', label: 'Steering stops, bounding case: one stop takes all (share 1.0)', group: 'Structure', refs: ['D-35', 'MF-1'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

// ── Kingpin plates (D-35): steel rows ───────────────────────────────────────────────────────────────────────────

/** The steel-side details at one pin load: pin on the sleeve and the crossbar plate, sleeve spigots, plate hole tear-out and net section, carrier strip bending. */
export function plateSteelDetails(ctx: Ctx, pm: PlateModel, ld: PinLoad): { details: Detail[]; text: string } {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const d = p.kingpinDiameterIn;
  const od = Math.max(p.kingpinSleeveOdIn, d);
  const H = Math.hypot(ld.Hx, ld.Hy);
  const rx = pinReactions(H, pm.a, pm.b);
  const sigPin = rx.M / ((Math.PI * d ** 3) / 32);
  const sleeveBrg = Math.abs(rx.Rtop) / (d * d);
  const barBrg = H / (d * pm.barPlate.t);
  const spigotTop = Math.abs(rx.Rtop) / (od * pm.carrier.t);
  const spigotBot = Math.abs(rx.Rbot) / (od * pm.beam.tBot);
  // Tear-out of the pin hole in the crossbar plate toward its end (pin hole center to the plate end hx), shear on two planes.
  const eEnd = pm.barPlate.hx - pm.holeD / 2;
  const tauBarEnd = ld.Hx / (2 * eEnd * pm.barPlate.t);
  const eSide = pm.barPlate.hy - pm.holeD / 2;
  const tauBarSide = ld.Hy / (2 * eSide * pm.barPlate.t);
  // Carrier strip at the sleeve hole: net section in tension / compression from the pin reaction R_top, shared by the two sides, and its in-plane bending
  // between the hole and the first plate bolt on each side (moment (R/2)·y₁).
  const y1 = Math.min(...pm.beam.ys.map(Math.abs));
  const Rt = Math.hypot(rx.Rtop * (ld.Hx / (H || 1)), rx.Rtop * (ld.Hy / (H || 1)));
  const wNet = 2 * pm.carrier.hx - od;
  const Zc = (pm.carrier.t * wNet * wNet) / 6;
  const sigCar = Zc > 0 ? ((Math.abs(Rt) / 2) * y1) / Zc : Infinity;
  const details: Detail[] = [
    detail('pin bending, overhang H·b at the top of the sleeve', sigPin, 'psi', al.kpBend, '<='),
    detail('pin on the sleeve, peak at the top end (R_top over one pin diameter)', sleeveBrg, 'psi', al.sleeve, '<='),
    detail('pin on the crossbar plate hole (steel on steel)', barBrg, 'psi', al.plateBrg, '<='),
    detail('sleeve spigot bearing in the carrier hole (R_top)', spigotTop, 'psi', al.plateBrg, '<='),
    detail('sleeve spigot bearing in the beam plate hole (R_bot)', spigotBot, 'psi', al.plateBrg, '<='),
    detail('crossbar plate: pin hole tear-out toward the plate end (shear on two planes)', tauBarEnd, 'psi', (0.6 * p.kingpinPlateYieldPsi) / p.steelSafetyFactor, '<='),
    detail('crossbar plate: pin hole tear-out toward the plate side (lateral load)', tauBarSide, 'psi', (0.6 * p.kingpinPlateYieldPsi) / p.steelSafetyFactor, '<='),
    detail('carrier strip in-plane bending at the sleeve hole (net section)', sigCar, 'psi', al.plateTens, '<='),
  ];
  const text = `Pin as an overhanging beam on the sleeve (supports a = ${f(pm.a, 2)}" apart, the crossbar plate b = ${f(pm.b, 2)}" above the top): R_top = H(1 + b/a) = ${f(rx.Rtop)} lbf, R_bot = ${f(rx.Rbot)} lbf, M = H·b = ${f(rx.M)} lb·in → σ = ${f(sigPin, 0)} psi; peak on the sleeve ${f(sleeveBrg, 0)} psi; on the ${f(pm.barPlate.t, 4)}" crossbar plate hole ${f(barBrg, 0)} psi; sleeve spigots ${f(spigotTop, 0)} / ${f(spigotBot, 0)} psi (OD ${f(od, 3)}" × plate thickness ${f(pm.carrier.t, 4)}" / ${f(pm.beam.tBot, 4)}"); plate hole tear-out ${f(tauBarEnd, 0)} / ${f(tauBarSide, 0)} psi; carrier strip net section ${f(wNet, 2)}" wide, σ = (R/2·y₁)/Z = ${f(sigCar, 0)} psi (≤ ${f(al.plateTens, 0)}).`;
  void L;
  return { details, text };
}

export function kingpinPlatesCheck(ctx: Ctx): AnalysisCheck {
  const { p } = ctx;
  const al = allowables(ctx);
  const pm = plateModel(ctx);
  if (!pm) {
    return singleCheck({
      id: 'kingpin-plates', label: 'Kingpin steel plates', group: 'Structure', value: 0, unit: 'psi', limit: al.plateBrg, sense: '<=', info: true, load: 'goal',
      how: 'No crossbar, so no kingpin plates: the pin is a cantilever over the stack and bears on oak (see kingpin-strike and kingpin-peak).', refs: ['D-35'],
    });
  }
  const ev = (c: CaseData): CaseEval => {
    const cases = pinLoads(ctx, c);
    const all = cases.map((ld) => ({ ld, r: plateSteelDetails(ctx, pm, ld) }));
    const merged = mergeCases(all.map((x) => ({ name: x.ld.name, details: x.r.details })));
    const g = all.reduce((a, b) => (b.r.details.reduce((m, d) => Math.max(m, d.util), 0) > a.r.details.reduce((m, d) => Math.max(m, d.util), 0) ? b : a), all[0]);
    const how = `Pin loads (${cases.map((x) => `${x.name}: H_x ${f(x.Hx)}, H_y ${f(x.Hy)}, T ${f(x.T)}`).join('; ')}); each row is the worst over these cases. Governing case ${g.ld.name}. ${g.r.text} The pin touches no oak: the sleeve's reactions go into the plates and the plates' bolt groups carry them into the beam ('kingpin-bolts'); the pin force enters the crossbar through the plate's four bolts. Plate: ${f(pm.carrier.t, 4)}" carrier, ${f(pm.beam.tBot, 4)}" beam plate, ${f(pm.barPlate.t, 4)}" crossbar plate, A36 (${f(p.kingpinPlateYieldPsi, 0)} psi / SF ${p.steelSafetyFactor}); outsourced waterjet / laser.`;
    return governing(merged, how);
  };
  return dualCheck({
    id: 'kingpin-plates', label: 'Kingpin steel plates: pin, sleeve spigots, plate holes', group: 'Structure', refs: ['D-35', 'D-32', 'M2'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

/** Merge per-case detail lists into one list: for each criterion keep the case with the highest utilization (the case is named in the label). */
export function mergeCases(cases: Array<{ name: string; details: Detail[] }>): Detail[] {
  const best = new Map<string, Detail>();
  for (const cs of cases) {
    for (const d of cs.details) {
      const cur = best.get(d.name);
      if (!cur || d.util > cur.util) best.set(d.name, { ...d, name: d.name, _case: cs.name } as Detail & { _case: string });
    }
  }
  return [...best.values()].map((d) => ({ ...d, name: `${d.name} [${(d as Detail & { _case: string })._case}]` }));
}

// ── Kingpin plate bolt groups (D-35): NDS rows ──────────────────────────────────────────────────────────────────

/** Per-bolt NDS check of the beam bolt line at one pin load, plus spacing / edge rules and row tear-out. */
export function beamBoltDetails(ctx: Ctx, pm: PlateModel, ld: PinLoad): { details: Detail[]; text: string } {
  const { p } = ctx;
  const bm = pm.beam;
  const H = Math.hypot(ld.Hx, ld.Hy);
  const rx = pinReactions(H, pm.a, pm.b);
  const ux = H > 0 ? ld.Hx / H : 0, uy = H > 0 ? ld.Hy / H : 0;
  const sumY2 = bm.ys.reduce((m, y) => m + y * y, 0);
  const yMax = Math.max(...bm.ys.map(Math.abs));
  const Ft = sumY2 > 0 ? (ld.T * yMax) / sumY2 : 0; // tangential force on the outermost bolt from the stop torque (the arms deliver it to the carrier)
  const oneEnd = (R: number, t: number, torque: number) => {
    const Fx = Math.abs(R * ux) / bm.n + torque, Fy = Math.abs(R * uy) / bm.n;
    const F = Math.hypot(Fx, Fy);
    const theta = Math.atan2(Fx, Fy) * DEG; // angle between the load and the grain (grain along y)
    const cap = boltCapacity(ctx, bm.D, bm.lm, t, theta);
    return { Fx, Fy, F, theta, cap };
  };
  const top = oneEnd(rx.Rtop, bm.tTop, Ft);
  const bot = oneEnd(rx.Rbot, bm.tBot, 0);
  const sp = boltSpacing(bm.D, bm.lm, 'perp');
  const spPar = boltSpacing(bm.D, bm.lm, 'par');
  const FvP = p.oakNdsShearPsi * p.ndsWetFactorShear * p.ndsLoadDurationFactor;
  // Row tear-out for the load ALONG the grain (all bolts in one row along y): n·F'v·t·s_critical, end distance far beyond the spacing.
  const endAlong = pm.carrier.hy - Math.max(...bm.ys.map(Math.abs)) + 100; // the beam runs on for feet beyond the carrier
  const rt = rowTearOut(bm.n, FvP, bm.lm, endAlong, bm.pitch);
  const Fy = Math.abs(ld.Hy) * (1 + pm.b / pm.a);
  const details: Detail[] = [
    detail('beam plate bolt, carrier end: per-bolt load vs NDS lateral capacity', top.F, 'lbf', top.cap.Z, '<='),
    detail('beam plate bolt, under end: per-bolt load vs NDS lateral capacity', bot.F, 'lbf', bot.cap.Z, '<='),
    detail('beam row tear-out under the lateral load along the grain', Fy, 'lbf', rt.Z, '<='),
  ];
  const text = `Beam bolt line: ${bm.n} × ${f(bm.D, 4)}" at ${f(bm.pitch, 4)}" (≥ 5D = ${f(sp.betweenRows, 3)}" for l/D = ${f(bm.lm / bm.D, 1)}), edges ${f(bm.frontDist, 3)}" to the front face and ${f(bm.grooveDist, 3)}" to the rod groove (≥ 4D = ${f(sp.loadedEdge, 3)}"; these rider-independent distances are validator rules, see validateParams, since a row sitting exactly on its minimum would read marginal at every weight). Pin reaction at the carrier end R_top = ${f(rx.Rtop)} lbf (${f(Math.abs(rx.Rtop) / bm.n)} per bolt) + the stop torque on the outermost bolt T·y_max/Σy² = ${f(ld.T)} × ${f(yMax, 2)} / ${f(sumY2, 1)} = ${f(Ft)} lbf (arms → screws → carrier in its own plane) = ${f(top.F)} lbf at ${f(top.theta, 0)}° to the grain; capacity Z = ${f(top.cap.Zref)} lbf (yield mode ${top.cap.mode}; Fe = ${f(top.cap.Fem, 0)} psi at that angle for G = ${p.oakSpecificGravity}, D = ${f(bm.D, 4)}", plate ${f(bm.tTop, 4)}", Fes ${f(p.steelDowelBearingPsi, 0)}, Fyb ${f(p.kingpinPlateBoltYieldPsi, 0)}) × C_M ${p.ndsWetFactorFasteners} × C_D ${p.ndsLoadDurationFactor} × C_g ${p.ndsGroupFactor} = ${f(top.cap.Z)} lbf. Under end: R_bot ${f(rx.Rbot)} lbf → ${f(bot.F)} lbf per bolt vs ${f(bot.cap.Z)}. Row tear-out along the grain n·F'v·t·s_crit = ${bm.n} × ${f(FvP, 0)} × ${f(bm.lm, 2)} × ${f(rt.sCrit, 3)} = ${f(rt.Z)} lbf (F'v = ${p.oakNdsShearPsi} × ${p.ndsWetFactorShear} × ${p.ndsLoadDurationFactor}); the group is a single row, so group tear-out equals the row value.`;
  void spPar;
  return { details, text };
}

/** Per-bolt NDS check of the crossbar bolt line at one pin load (the pin force enters at the plate end only), edge rules and row tear-out. */
export function barBoltDetails(ctx: Ctx, pm: PlateModel, ld: PinLoad): { details: Detail[]; text: string } {
  const { p } = ctx;
  const br = pm.bar;
  const Fx = Math.abs(ld.Hx) / br.n, Fy = Math.abs(ld.Hy) / br.n;
  const F = Math.hypot(Fx, Fy);
  const theta = Math.atan2(Fy, Fx) * DEG; // angle to the grain (along x)
  const cap = boltCapacity(ctx, br.D, br.lm, br.t, theta);
  const spPar = boltSpacing(br.D, br.lm, 'par');
  const spPerp = boltSpacing(br.D, br.lm, 'perp');
  const FvP = p.oakNdsShearPsi * p.ndsWetFactorShear * p.ndsLoadDurationFactor;
  const rt = rowTearOut(br.n, FvP, br.lm, br.endDist, br.pitch);
  const details: Detail[] = [
    detail('crossbar plate bolt: per-bolt load vs NDS lateral capacity', F, 'lbf', cap.Z, '<='),
    detail('crossbar row tear-out under the load along the grain', Math.abs(ld.Hx), 'lbf', rt.Z, '<='),
  ];
  const text = `Crossbar bolt line: ${br.n} × ${f(br.D, 4)}" at ${f(br.pitch, 3)}" (≥ 4D = ${f(spPar.inRow, 3)}"), ends ${f(br.endDist, 2)}" (≥ 7D = ${f(spPar.loadedEnd, 3)}"), edges ${f(br.edgeDist, 2)}" (≥ 4D = ${f(spPerp.loadedEdge, 3)}"); the pin force enters at the plate end only: ${f(F)} lbf per bolt at ${f(theta, 0)}° to the grain vs Z = ${f(cap.Zref)} lbf (mode ${cap.mode}) × ${f(ndsAdjust(p), 3)} = ${f(cap.Z)} lbf; row tear-out n·F'v·t·s_crit = ${br.n} × ${f(FvP, 0)} × ${f(br.lm, 2)} × ${f(rt.sCrit, 3)} = ${f(rt.Z)} lbf.`;
  return { details, text };
}

export function beamBoltDetailsAll(ctx: Ctx, pm: PlateModel, ld: PinLoad): { details: Detail[]; text: string } {
  const a = beamBoltDetails(ctx, pm, ld);
  const b = barBoltDetails(ctx, pm, ld);
  return { details: [...a.details, ...b.details], text: `${a.text} ${b.text}` };
}

export function kingpinBoltsCheck(ctx: Ctx): AnalysisCheck {
  const al = allowables(ctx);
  const pm = plateModel(ctx);
  if (!pm) {
    return singleCheck({
      id: 'kingpin-bolts', label: 'Kingpin plate bolt groups', group: 'Structure', value: 0, unit: 'lbf', limit: 1, sense: '<=', info: true, load: 'goal',
      how: 'No crossbar, so no kingpin plates: the pin bears on oak directly (see kingpin-strike).', refs: ['D-35'],
    });
  }
  void al;
  const ev = (c: CaseData): CaseEval => {
    const cases = pinLoads(ctx, c);
    const all = cases.map((ld) => ({ ld, r: beamBoltDetailsAll(ctx, pm, ld) }));
    const merged = mergeCases(all.map((x) => ({ name: x.ld.name, details: x.r.details })));
    const gov = all.reduce((a, b) => (Math.max(...b.r.details.map((d) => d.util)) > Math.max(...a.r.details.map((d) => d.util)) ? b : a), all[0]);
    const how = `Pin load cases at this rider (${cases.map((x) => `${x.name}: H_x ${f(x.Hx)} lbf, H_y ${f(x.Hy)} lbf, stop torque ${f(x.T)} lb·in`).join('; ')}); each row is the worst over the cases. Governing: ${gov.ld.name}. ${gov.r.text} NDS: Fe⊥ = 6,100·G^1.45/√D, Fe∥ = 11,200·G (Table 12.3.3), yield modes Im, Is, IIIs, IV (Table 12.3.1A, Rd = 3.2–4·Kθ); the oak sees ONLY these bolts (D-35).`;
    return governing(merged, how);
  };
  return dualCheck({
    id: 'kingpin-bolts', label: 'Kingpin plate bolt groups: NDS lateral capacity, spacing, edges, row tear-out', group: 'Structure', refs: ['D-35', 'D-32', 'MF-3'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

// ── M2: kingpin peak bearing (round 1) → replaced by the plate rows (D-35) ──────────────────────────────────────

/**
 * Round 1 held the oak bore to a rigid-pin peak bearing (5.4× the average, critic MF-3: the 1,700 psi allowable was overstated 22–56%). Round 2 takes the
 * oak out of the pin's load path altogether: the pin runs in a steel sleeve and bears on steel plates, and the oak sees only the plate bolt groups. This row
 * stays as an info row so the Phase 3 check list keeps its id; the rows that carry the work are 'kingpin-plates', 'kingpin-bolts' and 'kingpin-split'.
 */
export function kingpinPeakCheck(ctx: Ctx): AnalysisCheck {
  const al = allowables(ctx);
  return singleCheck({
    id: 'kingpin-peak', label: 'Kingpin peak bearing (round 1, replaced)', group: 'Structure', value: 0, unit: 'psi', limit: al.oakDowel, sense: '<=', info: true, load: 'goal',
    how: ctx.L.kpPlates
      ? 'Replaced in round 2 (D-35): with the kingpin steel plates the pin runs in a steel sleeve and bears on steel, so no oak bears on the pin and the round-1 peak-bearing row (a rigid pin in two oak members, 5.4× the average) has no oak to apply to. The NDS bolt-group rows (kingpin-bolts), the steel rows (kingpin-plates) and the cleavage rows (kingpin-split) carry the pin load instead.'
      : 'No crossbar: the pin is a cantilever over the stack and bears on oak (see kingpin-strike); the two-member rigid-pin model does not apply and the steel plates do not exist.',
    refs: ['D-32', 'D-35'],
  });
}

// ── M3: pitch-moment path ───────────────────────────────────────────────────────────────────────────────────────

export function pitchPathCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const ts = p.turntableSizeIn;
  const rw = L.bolster.rw;
  const uA = part(ctx, 'clamp-FL1');
  const plateY = p.clampPlateWidthIn;
  const legC = uA && uA.geometry.type === 'mesh' ? (() => {
    // c-c distance of the U-bolt legs: the x extent of the mesh minus the rod diameter.
    const xs: number[] = [];
    for (let i = 0; i < uA.geometry.positions.length; i += 3) xs.push(uA.geometry.positions[i]);
    return Math.max(...xs) - Math.min(...xs) - p.uboltRodDiameterIn;
  })() : L.beamF.thick + 2 * p.uboltBeamClearIn + p.uboltRodDiameterIn;
  const rr = p.uboltRodDiameterIn;
  const Aleg = STEEL_TENSILE_AREA_FRAC * ((Math.PI * rr * rr) / 4);
  const zAxle = L.r;
  // The pin force reaches the steer body at the beam plates (R_top above, R_bot below); equivalently H at the crossbar plate's mid height (D-35).
  const zLoad = L.kpPlates ? (L.kpPlates.bar.z0 + L.kpPlates.bar.z1) / 2 : (L.beamF.top + L.beamF.bot) / 2;
  const ev = (c: CaseData): CaseEval => {
    const w = wheelLoads(ctx, c);
    const cases = strikeCases(ctx, c);
    const H = Math.max(...cases.map((s) => s.H));
    const V = w.frontAxle * p.dynamicFactor;
    const Mp = H * Math.abs(zAxle - zLoad);
    const lever = ts - rw; // centers of the fore and aft bolster rails
    const Fc = Mp / lever;
    const Arail = rw * ts;
    const pRail = Fc / Arail;
    const Mtr = V * p.kingpinLeadIn;
    const Tleg = Mtr / 2 / legC; // one U-bolt per side: its two legs form the couple M_side = M_tr / 2
    const sLeg = Tleg / Aleg;
    const beamPlate = plateY * L.beamF.thick;
    const pPlate = (2 * Tleg) / beamPlate;
    const ds: Detail[] = [
      detail('pitch couple on the fore / aft bolster rails (pad pressure on the turntable plate, oak ⊥)', pRail, 'psi', al.oakPerp, '<='),
      detail('front U-bolt leg tension from the trail moment', sLeg, 'psi', al.fastTens, '<='),
      detail('U-bolt plate bearing on the beam underside (oak ⊥)', pPlate, 'psi', al.oakPerp, '<='),
    ];
    const how = `Two pitch moments act on the front steer body about a lateral axis. (1) A strike's horizontal force H = ${f(H)} lbf (two-wheel curb) acts at the axle height ${f(zAxle, 2)}" while the pin reaction acts at ${f(zLoad, 2)}" (${L.kpPlates ? "the crossbar plate's mid height: R_top and R_bot at the sleeve ends are equivalent to H there" : 'the beam mid depth'}): M_p = H × ${f(Math.abs(zAxle - zLoad), 3)}" = ${f(Mp)} lb·in. It is returned as a vertical couple between the FORE and AFT bolster rails (centers ${f(lever, 2)}" apart, the 'fore-aft bearers') through the turntable plate margins, so the lazy-susan bearing ring and the kingpin carry no moment: F = M_p/${f(lever, 2)}" = ${f(Fc)} lbf per rail on ${f(rw, 2)}" × ${f(ts, 1)}" = ${f(Arail, 1)} in² → ${f(pRail, 1)} psi (≤ ${f(al.oakPerp, 0)}). The kingpin only transfers the horizontal force H (rows kingpin-plates / kingpin-bolts). (2) The turntable load acts on the beam at the pin line, ${f(p.kingpinLeadIn, 2)}" ahead of the axle rod, so the design axle load V = ${f(V)} lbf (${frontLoadText(ctx, w)} × ${p.dynamicFactor}) twists the beam about the rod: M_tr = V × lead = ${f(Mtr)} lb·in. The front U-bolts, legs ${f(legC, 2)}" apart, hold the beam to the rod: per side M_tr/2 = T_leg × ${f(legC, 2)}" → T_leg = ${f(Tleg)} lbf, ${f(sLeg, 0)} psi on A_t = 0.75·A (≤ ${f(al.fastTens, 0)}); the legs' pull is reacted by the ${f(plateY, 2)}" × ${f(L.beamF.thick, 2)}" plate on the beam underside: ${f(pPlate, 1)} psi (≤ ${f(al.oakPerp, 0)}). Not modeled: the stiffness of the lazy-susan plate margins that overhang the 4" beam (ask the vendor for the plate thickness); the carrier plate (2" wide) is the only steel the bottom plate stands on.`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'pitch-path', label: 'Pitch-moment path: bolster rails and front U-bolts', group: 'Structure', refs: ['D-32', 'D-12', 'D-34'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

// ── M4: kingpin cleavage (NDS 3.4.3.3) and ligaments ────────────────────────────────────────────────────────────

export function kingpinSplitCheck(ctx: Ctx): AnalysisCheck {
  const { p, L, d } = ctx;
  const al = allowables(ctx);
  const cb = L.crossbar;
  const bore = kingpinBoreIn(p);
  const rodR = p.axleDiameterIn / 2;
  const pm = plateModel(ctx);
  const FvP = p.oakNdsShearPsi * p.ndsWetFactorShear * p.ndsLoadDurationFactor;
  const ev = (c: CaseData): CaseEval => {
    const w = wheelLoads(ctx, c);
    const H = Math.max(...strikeCases(ctx, c).map((s) => s.H));
    const Vaxle = w.frontAxle * p.dynamicFactor;
    const Fy = p.tireGroundMu * Vaxle; // sideways skid of both front tires, all of it through the pin
    const eWeb = p.kingpinLeadIn - rodR - bore / 2;
    const ds: Detail[] = [];
    let txt = '';
    if (pm) {
      const bm = pm.beam, br = pm.bar;
      const rxS = (Hh: number) => pinReactions(Hh, pm.a, pm.b);
      const cases = pinLoads(ctx, c);
      const yPos = bm.ys.filter((y) => y > 0);
      const sumY2 = bm.ys.reduce((m, y) => m + y * y, 0);
      // The front slab ahead of the bolt line is pushed by the carrier-end bolts: the pin reaction R_top plus the stop torque's force on one side of the line.
      const slab = cases.map((ld) => {
        const R = rxS(Math.abs(ld.Hx)).Rtop;
        const Vs = R + (sumY2 > 0 ? (ld.T * yPos.reduce((m, y) => m + y, 0)) / sumY2 : 0);
        return { name: ld.name, V: Vs };
      });
      const gv = slab.reduce((a, b) => (b.V > a.V ? b : a), slab[0]);
      const Vr = cleavageVr(FvP, bm.lm, bm.frontDist);
      const reinforced = bm.nCross > 0;
      const Tcb = (gv.V) / Math.max(1, bm.nCross);
      const Acb = STEEL_TENSILE_AREA_FRAC * ((Math.PI * bm.crossD * bm.crossD) / 4);
      const cbAllow = p.kingpinCrossBoltYieldPsi / p.steelSafetyFactor;
      const Aw = Math.max(1e-6, (Math.PI / 4) * (bm.crossWasher ** 2 - (bm.crossD + 1 / 16) ** 2));
      if (reinforced) {
        ds.push(detail('beam front slab: cross-bolt tension (all of the cleavage shear carried by the stitching)', Tcb / Acb, 'psi', cbAllow, '<='));
        ds.push(detail('beam cross-bolt washer bearing on the oak (⊥)', Tcb / Aw, 'psi', al.oakPerp, '<='));
      } else {
        ds.push(detail('beam front slab cleavage, no cross-bolts (NDS 3.4.3.3: V ≤ ⅔·F\'v·b·d_e)', gv.V, 'lbf', Vr, '<='));
      }
      // Crossbar: lateral pin load across the grain, d_e = the edge distance of the bolt line.
      const Vrb = cleavageVr(FvP, br.lm, br.edgeDist);
      const Tcbb = Fy / Math.max(1, br.nCross);
      const Acbb = STEEL_TENSILE_AREA_FRAC * ((Math.PI * br.crossD * br.crossD) / 4);
      if (br.nCross > 0) {
        ds.push(detail('crossbar cleavage: cross-bolt tension (the lateral load carried by the stitching)', Tcbb / Acbb, 'psi', cbAllow, '<='));
        ds.push(detail('crossbar cross-bolt washer bearing on the oak (⊥)', Tcbb / Aw, 'psi', al.oakPerp, '<='));
      } else {
        ds.push(detail('crossbar cleavage under the lateral load, no cross-bolts (NDS 3.4.3.3)', Fy, 'lbf', Vrb, '<='));
      }
      const tauWeb = p.pullForceLbf / (2 * eWeb * p.axleDiameterIn);
      ds.push(detail('beam web shear-out between the sleeve bore and the rod groove (rope pull, NDS F\'v)', tauWeb, 'psi', FvP, '<='));
      txt = `Cleavage (NDS 3.4.3.3): V_r = ⅔·F'v·b·d_e with F'v = ${p.oakNdsShearPsi} × C_M ${p.ndsWetFactorShear} × C_D ${p.ndsLoadDurationFactor} = ${f(FvP, 0)} psi. Beam front slab: b = ${f(bm.lm, 2)}", d_e = ${f(bm.frontDist, 3)}" from the bolt line to the loaded front face → V_r = ${f(Vr)} lbf; the slab is pushed by the carrier-end bolts with ${f(gv.V)} lbf (${gv.name}: R_top plus the stop torque's force on one side of the line), ${f(gv.V / Vr, 2)}× the unreinforced capacity, so ${bm.nCross} × ${f(bm.crossD, 3)}" 316 stainless fore-aft cross-bolts (${f(bm.crossWasher, 2)}" fender washers) stitch it and are designed to carry ALL of it: ${f(Tcb)} lbf each = ${f(Tcb / Acb, 0)} psi (≤ ${f(cbAllow, 0)} = ${f(p.kingpinCrossBoltYieldPsi, 0)} / SF ${p.steelSafetyFactor}), washers ${f(Tcb / Aw, 0)} psi (≤ ${f(al.oakPerp, 0)}). Crossbar: lateral skid F_y = μ × V = ${f(p.tireGroundMu, 2)} × ${f(Vaxle)} = ${f(Fy)} lbf across the grain, d_e = ${f(br.edgeDist, 2)}", b = ${f(br.lm, 2)}" → V_r = ${f(Vrb)} lbf unreinforced; ${br.nCross} cross-bolts across the width carry ${f(Tcbb)} lbf each. Web between the sleeve bore and the rod groove: rope pull ${p.pullForceLbf} lbf, τ = P/(2·e·groove depth) = ${f(tauWeb, 0)} psi (≤ F'v ${f(FvP, 0)}), e = ${f(eWeb, 3)}". Replaces round 1's clear-wood 850 psi block shear (3–4× unconservative, critic MF-4). Strike H = ${f(H)} lbf.`;
    } else {
      const bore0 = bore;
      const D1 = L.beamF.depth;
      const eFront = d.frontBeamLigamentIn;
      const tauFront = H / (2 * eFront * D1);
      const tauWeb = p.pullForceLbf / (2 * eWeb * p.axleDiameterIn);
      ds.push(detail('beam front ligament shear-out (strike pushes the beam aft against the pin)', tauFront, 'psi', al.oakShear, '<='));
      ds.push(detail('beam web shear-out between the pin bore and the rod groove (rope pull)', tauWeb, 'psi', al.oakShear, '<='));
      txt = `Ligament shear-out (block shear, Phase 1 pin on oak): τ = F/(2·e·D): front ligament ${f(eFront, 3)}": ${f(tauFront, 0)} psi; web ${f(eWeb, 3)}": ${f(tauWeb, 0)} psi (allowable ${f(al.oakShear, 0)}). Bore ${f(bore0, 3)}".`;
      if (cb) {
        const D2 = cb.z1 - cb.z0;
        const eSide = (2 * cb.hw - bore) / 2;
        const eEnd = cb.x1 - L.kx - bore / 2;
        ds.push(detail('crossbar side ligament shear-out (lateral pin load)', Fy / (2 * eSide * D2), 'psi', al.oakShear, '<='));
        ds.push(detail('crossbar end ligament shear-out (fore-aft pin load, along the grain)', H / (2 * eEnd * D2), 'psi', al.oakShear, '<='));
        txt += ` Crossbar side ligament ${f(eSide, 3)}", end ${f(eEnd, 2)}".`;
      }
    }
    return governing(ds, txt);
  };
  return dualCheck({
    id: 'kingpin-split', label: pm ? 'Kingpin cleavage (NDS 3.4.3.3) and cross-bolts' : 'Kingpin ligaments: beam and crossbar split / shear-out', group: 'Structure', refs: ['D-32', 'D-35', 'MF-4'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

// ── M6: bridle tie points ───────────────────────────────────────────────────────────────────────────────────────

export function bridleTieCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const eye = part(ctx, 'eyebolt-L');
  if (!eye) {
    return singleCheck({
      id: 'bridle-tie', label: 'Bridle tie points', group: 'Structure', value: 0, unit: 'psi', limit: al.steel, sense: '<=', info: true, load: 'goal',
      how: 'No rope bridle (the oak tongue carries the pull: see the tongue row).', refs: ['D-33'],
    });
  }
  const d = p.eyeBoltDiameterIn;
  const Ash = (Math.PI * d * d) / 4;
  const At = STEEL_TENSILE_AREA_FRAC * Ash;
  const Z = (Math.PI * d ** 3) / 32;
  const arm = p.eyeBoltEyeOffsetIn;
  const Dw = p.eyeBoltWasherDiameterIn;
  const Aw = Math.max(1e-6, (Math.PI / 4) * (Dw * Dw - (d + 1 / 16) ** 2));
  const eyeX = eye.transform[12], eyeY = Math.abs(eye.transform[13]), eyeZ = eye.transform[14];
  const ringX = L.WB + BRIDLE_APEX_AHEAD_IN;
  const handsX = ringX + p.bridleRopeRunIn;
  const handsZ = Math.max(p.pullerHandHeightIn, p.bridleTieHandHeightMaxIn);
  const dx = handsX - eyeX, dy = -eyeY, dz = handsZ - eyeZ;
  const len = Math.hypot(dx, dy, dz);
  const ux = dx / len, uy = Math.abs(dy) / len, uz = dz / len;
  const T = p.pullForceLbf; // one leg takes the whole design pull (the other is slack when turning)
  const Tax = T * ux;
  const Tperp = T * Math.hypot(uy, uz);
  const yieldPsi = p.eyeBoltYieldPsi;
  const allow = yieldPsi / p.steelSafetyFactor;
  const beamT = L.beamF.thick;
  const ev = (c: CaseData): CaseEval => {
    void c;
    const sT = Tax / At;
    const sB = (Tperp * arm) / Z;
    const sComb = sT + sB;
    const pW = Tax / Aw;
    const pHole = Tperp / (d * beamT);
    const ds: Detail[] = [
      detail('eye bolt shank: axial tension + bending over the eye offset', sComb, 'psi', allow, '<='),
      detail('washer bearing on the beam aft face (oak ⊥)', pW, 'psi', al.oakPerp, '<='),
      detail('shank bearing in the beam hole (oak, dowel bearing ⊥)', pHole, 'psi', al.oakDowel, '<='),
    ];
    const how = `Tie load: the design pull ${f(T)} lbf (D-14) on ONE leg, along the taut rope from the eye (${f(eyeX, 2)}", ±${f(eyeY, 2)}", ${f(eyeZ, 2)}") to the pullers' hands ${f(p.bridleRopeRunIn)}" beyond the ring at ${f(handsZ)}" height (the 30–40" range, evaluated at ${f(handsZ)}"): direction (${f(ux, 3)} fwd, ${f(uy, 3)} inboard, ${f(uz, 3)} up) = ${f(Math.asin(uz) * 180 / Math.PI, 1)}° above horizontal. Axial along the eye bolt (fore-aft): ${f(Tax)} lbf; transverse (lateral + vertical): ${f(Tperp)} lbf bending the ${f(d, 3)}" shank over the ${f(arm, 2)}" eye offset: σ = T_ax/A_t + T_perp·arm/Z = ${f(Tax)}/${f(At, 4)} + ${f(Tperp)}·${f(arm, 2)}/${f(Z, 5)} = ${f(sT, 0)} + ${f(sB, 0)} = ${f(sComb, 0)} psi (≤ ${f(allow, 0)} = yield ${f(yieldPsi, 0)} / ${p.steelSafetyFactor}). Washer on the beam aft face (${f(Dw, 2)}" OD): ${f(Tax)}/${f(Aw, 2)} = ${f(pW, 0)} psi (≤ ${f(al.oakPerp, 0)}); shank bearing in the ${f(beamT, 2)}" beam hole ${f(Tperp)}/(${f(d, 3)} × ${f(beamT, 2)}) = ${f(pHole, 0)} psi (≤ ${f(al.oakDowel, 0)}). The tie sits ${f(p.bridleTieOffsetIn, 2)}" inboard of the U-bolt plate, so the rope load goes into the beam and not into the axle rod (critic Phase 2 r2 A4). The eye is ${f(tieHalfY(ctx) - L.bolster.halfY, 2)}" outboard of the bolster ring. Confirm the bought eye bolt's working-load limit is at least ${f(T)} lbf at its pull angle (the rope-to-tire mock-up is a Phase 3 build task).`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'bridle-tie', label: 'Bridle tie points: eye bolts in the front beam', group: 'Structure', refs: ['D-33', 'D-14', 'A4'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}
