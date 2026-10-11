/**
 * Front-end detail checks (Phase 3 workstream A, D-31…D-34): the steering stops (M1), the kingpin's peak bearing (M2),
 * the pitch-moment path (M3), the kingpin ligaments / crossbar split (M4) and the bridle tie points (M6). Each is evaluated
 * at the operating and the goal rider like the other structure rows (D-2); the `how` strings carry the hand arithmetic.
 */
import { kingpinBoreIn, steerStopPlan } from '../params';
import { BRIDLE_APEX_AHEAD_IN } from '../model/steering';
import { toothThickness, triangularFace } from '../model/stops';
import type { Ctx } from './context';
import { dualCheck, singleCheck, detail, governing, type CaseEval } from './dual';
import { f } from './format';
import type { CaseData } from './loads';
import { evalBoth } from './stability';
import { allowables, frontLoadText, part, strikeCases, tieHalfY, wheelLoads, yawTorque } from './structure';
import type { AnalysisCheck, Detail } from './types';

const STEEL_TENSILE_AREA_FRAC = 0.75; // threaded tensile stress area ≈ 0.75 × the gross shank area (as in roll-bolster-attach)

const boxSize = (ctx: Ctx, id: string): [number, number, number] | null => {
  const x = part(ctx, id);
  return x && x.geometry.type === 'box' ? x.geometry.size : null;
};

// ── M1: steering stops ──────────────────────────────────────────────────────────────────────────────────────────

export function steerStopsCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const plan = steerStopPlan(p);
  const dog = boxSize(ctx, 'steer-stop-L');
  const dogPart = part(ctx, 'steer-stop-L');
  if (!plan.ok || !dog || !dogPart) {
    return singleCheck({
      id: 'steer-stops', label: 'Steering stops', group: 'Structure', value: 0, unit: 'psi', limit: al.oakPerp, sense: '<=', status: 'fail', load: 'goal',
      how: `The steering stops do not fit this design (${plan.why || 'no stop dog in the model'}): see the validator.`, refs: ['D-31'],
    });
  }
  const h = dog[2];
  const ringDepth = L.bolster.z1 - L.bolster.z0;
  const al0 = plan.teeth[0]; // the left-aft tooth; the other three are its mirror / 180° images
  const nb = dogPart.joints?.find((j) => j.type === 'bolt')?.count ?? p.steerStopBoltCount;
  const db = dogPart.joints?.find((j) => j.type === 'bolt')?.diaIn ?? p.steerStopBoltDiameterIn;
  const Ab = (Math.PI * db * db) / 4;
  const At = STEEL_TENSILE_AREA_FRAC * Ab;
  const Dw = p.steerStopWasherDiameterIn;
  const Aw = Math.max(1e-6, (Math.PI / 4) * (Dw * Dw - (db + 1 / 16) ** 2));
  const ev = (c: CaseData): CaseEval => {
    const yaw = yawTorque(ctx, c);
    const share = p.steerStopLoadShare;
    const T1 = share * yaw.T;
    const tri = triangularFace(plan.ra, plan.rb, h, T1);
    const F = tri.F;
    const Fx = F * Math.abs(al0.n.x), Fy = F * Math.abs(al0.n.y);
    const pRail = al0.railLen > 0 ? Fx / (al0.railLen * ringDepth) : Infinity;
    const pBar = al0.barLen > 0 ? Fy / (al0.barLen * ringDepth) : 0;
    const tau = F / (nb * Ab);
    const Tb = (F * (h / 2)) / (plan.W * nb);
    const sT = Tb / At;
    const inter = Math.sqrt((tau / al.fastShear) ** 2 + (sT / al.fastTens) ** 2);
    const pWasher = Tb / Aw;
    const eOak = plan.t / 2 - db / 2;
    const tauShearOut = F / nb / (2 * eOak * h);
    // Net force the stop pair leaves on the kingpin (zero if the two stops share the torque equally): (2·share − 1)·T/r_eff, added to the wheel force H_w.
    const net = (2 * share - 1) * (yaw.T / tri.rEff);
    const Kvec = yaw.Hw + net;
    const Hgov = Math.max(...strikeCases(ctx, c).map((s) => s.H));
    const ds: Detail[] = [
      detail('stop face bearing, peak (triangular), oak ⊥', tri.pMax, 'psi', al.oakPerp, '<='),
      detail('stop block bearing on the bolster rail face (oak ⊥)', pRail, 'psi', al.oakPerp, '<='),
      ...(al0.barLen > 0 ? [detail('stop block bearing on the crossbar side (oak ⊥)', pBar, 'psi', al.oakPerp, '<=')] : []),
      detail('dog hold-down bolt shear', tau, 'psi', al.fastShear, '<='),
      detail('dog bolt shear + tension interaction (ellipse)', inter, '', 1, '<='),
      detail('dog bolt fender washer bearing under the beam (oak ⊥)', pWasher, 'psi', al.oakPerp, '<='),
      detail('dog block shear-out at the bolts (oak, along the grain)', tauShearOut, 'psi', al.oakShear, '<='),
      detail('net kingpin load with the stop pair vs the governing kingpin strike load', Kvec, 'lbf', Hgov, '<='),
    ];
    const tThin = Math.min(toothThickness(plan.a, plan.cb, plan.W, plan.lock, plan.ra), toothThickness(plan.a, plan.cb, plan.W, plan.lock, plan.rb));
    const how = `Yaw torque on the steer body about the kingpin: ${yaw.governing} T = ${f(yaw.T)} lb·in (one-wheel curb strike: H_w = ${f(yaw.Hw)} lbf [V_w ${f(yaw.Vw)} lbf, ${frontLoadText(ctx, wheelLoads(ctx, c))}] × y_w ${f(yaw.yw, 2)}" = ${f(yaw.strike)}; hard rope pull ${p.pullForceLbf} lbf × tie ${f(yaw.yTie, 2)}" = ${f(yaw.rope)}). Two stops close at lock (a 180° couple: dog L on the aft-left block, dog R on the fore-right block, and the mirror at −lock); the stiffer one is allowed ${f(share * 100, 0)}% of T (fit tolerance, the other ${f((1 - share) * 100, 0)}%): T₁ = ${f(T1)} lb·in. Each stop is a flat steel-on-oak face spanning s = ${f(plan.ra, 2)}…${f(plan.rb, 2)}" from the kingpin along its face and ${f(h, 2)}" tall; rigid rotation presses the face in ∝ s (triangular): r_eff = ⅔(s₂³−s₁³)/(s₂²−s₁²) = ${f(tri.rEff, 2)}", F = T₁/r_eff = ${f(F)} lbf, p_max = 3·T₁·s₂/(h(s₂³−s₁³)) = ${f(tri.pMax, 0)} psi (mean ${f(tri.pAvg, 0)}); allowable oak ⊥ ${f(al.oakPerp, 0)} psi (${p.oakCompPerpPsi} × C_M ${p.wetServiceFactorCompPerp} / ${p.woodSafetyFactor}; the stop block's grain runs along the force, so the end-grain allowable is ~${f(p.oakCompParPsi / p.oakCompPerpPsi, 0)}× higher: reserve). The block wedges into the corner: the force splits along the two support normals, F·|n_x| = ${f(Fx)} lbf on the rail face (${f(al0.railLen, 2)}" × ${f(ringDepth, 2)}" = ${f(pRail, 0)} psi) and F·|n_y| = ${f(Fy)} lbf on the crossbar side (${f(al0.barLen, 2)}" × ${f(ringDepth, 2)}" = ${f(pBar, 0)} psi). Dog: ${nb} × ${f(db, 3)}" bolts down through the dog, the plate and the beam: shear F/(n·A) = ${f(F)}/(${nb} × ${f(Ab, 4)}) = ${f(tau, 0)} psi (≤ ${f(al.fastShear, 0)}); the dog tips about its loaded toe (W = ${f(plan.W, 3)}" from the bolt line): ΣT = F·(h/2)/W, T_b = ${f(Tb)} lbf each = ${f(sT, 0)} psi on A_t = 0.75·A (≤ ${f(al.fastTens, 0)}); interaction ${f(inter, 2)}; ${f(Dw, 2)}" fender washer under the beam: ${f(pWasher, 0)} psi (≤ ${f(al.oakPerp, 0)}); shear-out of the ${f(eOak, 3)}" oak between each bolt and the loaded face: (F/n)/(2·e·h) = ${f(tauShearOut, 0)} psi (≤ ${f(al.oakShear, 0)}). Kingpin: the stop pair leaves a net ${f(net)} lbf (= (2·${share} − 1)·T/r_eff), so with H_w = ${f(yaw.Hw)} lbf the pin sees ≤ ${f(Kvec)} lbf against the ${f(Hgov)} lbf of the two-wheel strike that already governs the kingpin row; one stop alone (share 1) would add ${f(yaw.T / tri.rEff)} lbf. Thinnest wood behind the face where the block is trimmed: ${f(tThin, 2)}" (rule ≥ ${p.stopBlockMinIn}"). Not modeled: the dog's toe crush on the plate and pull-through of the lazy-susan holes (verify with the vendor plate).`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'steer-stops', label: 'Steering stops: dogs, stop blocks and hold-down bolts', group: 'Structure', refs: ['D-31', 'D-12', 'A3'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

// ── M2: kingpin peak bearing (rigid pin, linear pressure) ───────────────────────────────────────────────────────

/**
 * A rigid pin held in two members (beam depth D1 below, crossbar depth D2 above, a gap g between them) and loaded so that
 * the net force H crosses from one member into the other. With the same oak stiffness in both and no external moment on the
 * pin, the pressure on the pin is linear within each member and reverses sign inside it. Taking z from the middle of the gap:
 *   zone A (beam):     q(z) = H/D1 + 12·H·a_c·(z − z_A)/Σ,  Σ = D1³ + D2³, a_c = g + (D1 + D2)/2 (the two centroids' distance),
 *   zone B (crossbar): q(z) = −H/D2 + 12·H·a_c·(z − z_B)/Σ,
 * q in lbf per inch of pin length. The peak line load in each member sits at its face toward the gap:
 *   q_A = (H/D1)(1 + 6·a_c·D1²/Σ),  q_B = (H/D2)(1 + 6·a_c·D2²/Σ).
 */
export function rigidPinPeaks(H: number, D1: number, D2: number, g: number) {
  const ac = g + (D1 + D2) / 2;
  const S = D1 ** 3 + D2 ** 3;
  const fA = 1 + (6 * ac * D1 * D1) / S;
  const fB = 1 + (6 * ac * D2 * D2) / S;
  return { ac, S, fA, fB, qA: (H / D1) * fA, qB: (H / D2) * fB };
}

/** Maximum bending moment in the pin under the two linear line loads above (numerical, closes to zero shear and moment at the ends). */
export function rigidPinMoment(H: number, D1: number, D2: number, g: number): { Mmax: number; atZ: number; closure: number } {
  const { ac, S } = rigidPinPeaks(H, D1, D2, g);
  const zA = -(g / 2 + D1 / 2), zB = g / 2 + D2 / 2;
  const z0 = -(g / 2 + D1), z1 = g / 2 + D2;
  const q = (z: number): number => {
    if (z <= -g / 2) return H / D1 + (12 * H * ac * (z - zA)) / S;
    if (z >= g / 2) return -H / D2 + (12 * H * ac * (z - zB)) / S;
    return 0;
  };
  const N = 4000;
  const dz = (z1 - z0) / N;
  let V = 0, M = 0, Mmax = 0, atZ = z0;
  for (let i = 0; i < N; i++) {
    const zm = z0 + (i + 0.5) * dz;
    const Vn = V + q(zm) * dz;
    M += ((V + Vn) / 2) * dz;
    V = Vn;
    if (Math.abs(M) > Mmax) { Mmax = Math.abs(M); atZ = zm; }
  }
  return { Mmax, atZ, closure: Math.abs(M) };
}

export function kingpinPeakCheck(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const cb = L.crossbar;
  if (!cb) {
    return singleCheck({
      id: 'kingpin-peak', label: 'Kingpin peak bearing (rigid pin)', group: 'Structure', value: 0, unit: 'psi', limit: al.oakDowel, sense: '<=', info: true, load: 'goal',
      how: 'No crossbar: the pin is a cantilever over the stack (see kingpin-strike); the two-member rigid-pin model does not apply.', refs: ['D-32'],
    });
  }
  const D1 = L.beamF.depth, D2 = cb.z1 - cb.z0, g = L.turntable.z1 - L.turntable.z0;
  const w = kingpinBoreIn(p), d = p.kingpinDiameterIn;
  const sleeve = p.kingpinSleeveOdIn > 0;
  const zig = (Math.PI * d ** 3) / 32;
  const ev = (c: CaseData): CaseEval => {
    const cases = strikeCases(ctx, c);
    const worst = cases.reduce((a, b) => (b.H > a.H ? b : a), cases[0]);
    const H = Math.max(worst.H, p.pullForceLbf);
    const hName = worst.H >= p.pullForceLbf ? worst.name : 'bridle pull';
    const pk = rigidPinPeaks(H, D1, D2, g);
    const mom = rigidPinMoment(H, D1, D2, g);
    const pBeam = pk.qA / w, pBar = pk.qB / w;
    const avgBeam = H / (w * D1), avgBar = H / (w * D2);
    const pSleeve = Math.max(pk.qA, pk.qB) / d;
    const sigma = mom.Mmax / zig;
    const ds: Detail[] = [
      detail('beam peak bearing, rigid pin (oak, dowel bearing)', pBeam, 'psi', al.oakDowel, '<='),
      detail('crossbar peak bearing, rigid pin (oak, dowel bearing)', pBar, 'psi', al.oakDowel, '<='),
      ...(sleeve ? [detail('pin on steel sleeve peak bearing', pSleeve, 'psi', al.sleeve, '<=')] : []),
      detail('pin bending, rigid-pin line load', sigma, 'psi', al.kpBend, '<='),
    ];
    const how = `Governing horizontal load H = ${f(H)} lbf (${hName}, ${frontLoadText(ctx, wheelLoads(ctx, c))}). The pin is rigid in two oak members, the beam ${f(D1, 2)}" deep below and the crossbar ${f(D2, 2)}" deep above the ${f(g, 3)}" turntable gap, with no external moment on it; H crosses from the beam into the crossbar, so the pressure is linear in each member and reverses sign inside it (centroid distance a_c = g + (D1+D2)/2 = ${f(pk.ac, 3)}", Σ = D1³ + D2³ = ${f(pk.S, 2)}). Peak line load at each member's face toward the gap: q = (H/D)(1 + 6·a_c·D²/Σ): beam ${f(H / D1, 1)} × ${f(pk.fA, 2)} = ${f(pk.qA, 0)} lbf/in, crossbar ${f(H / D2, 1)} × ${f(pk.fB, 2)} = ${f(pk.qB, 0)} lbf/in. On the ${f(w, 3)}" ${sleeve ? 'sleeve OD' : 'bore'} that is ${f(pBeam, 0)} psi in the beam and ${f(pBar, 0)} psi in the crossbar (the average rows in 'kingpin-strike' are ${f(avgBeam, 0)} and ${f(avgBar, 0)} psi: the peak is ${f(pk.fA, 2)}× and ${f(pk.fB, 2)}× the average). The peak is a LOCAL pin-embedment pressure, so it is held to the oak dowel-bearing allowable ${f(al.oakDowel, 0)} psi (${p.oakDowelBearingPsi} × C_M ${p.wetServiceFactorStrength} / ${p.woodSafetyFactor}, D-32), not the area-bearing ${f(al.oakPerp, 0)} psi that governs the average rows; if the owner holds peaks to ${f(al.oakPerp, 0)} psi too, the beam peak is ${f(pBeam / al.oakPerp, 2)}× and the crossbar ${f(pBar / al.oakPerp, 2)}× over, and the fix is a deeper crossbar or a bigger gap.${sleeve ? ` Pin on the sleeve bore: ${f(Math.max(pk.qA, pk.qB), 0)} lbf/in over the ${f(d, 3)}" pin = ${f(pSleeve, 0)} psi (≤ ${f(al.sleeve, 0)} = 0.9·${f(p.sleeveYieldPsi, 0)}/${p.steelSafetyFactor}).` : ''} Pin bending from integrating the two line loads: M_max = ${f(mom.Mmax)} lb·in at z = ${f(mom.atZ, 2)}" from the gap center → σ = M/Z = ${f(sigma, 0)} psi (≤ ${f(al.kpBend, 0)}); the 'kingpin-strike' equal-lever estimate is kept as the conservative bending row. The 3× dynamic factor is stacked on tanφ: a deterministic envelope, neither strictly conservative nor an impact analysis (critic Phase 2 r2 A2).`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'kingpin-peak', label: 'Kingpin peak bearing (rigid pin, beam and crossbar)', group: 'Structure', refs: ['D-32', 'D-12', 'A2'], primary: 'goal',
    ...evalBoth(ctx, ev),
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
  const zBeamMid = (L.beamF.top + L.beamF.bot) / 2;
  const ev = (c: CaseData): CaseEval => {
    const w = wheelLoads(ctx, c);
    const cases = strikeCases(ctx, c);
    const H = Math.max(...cases.map((s) => s.H));
    const V = w.frontAxle * p.dynamicFactor;
    const Mp = H * Math.abs(zAxle - zBeamMid);
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
    const how = `Two pitch moments act on the front steer body about a lateral axis. (1) A strike's horizontal force H = ${f(H)} lbf (two-wheel curb) acts at the axle height ${f(zAxle, 2)}" while the beam bears on the pin near its mid-depth ${f(zBeamMid, 2)}": M_p = H × ${f(Math.abs(zAxle - zBeamMid), 3)}" = ${f(Mp)} lb·in. It is returned as a vertical couple between the FORE and AFT bolster rails (centers ${f(lever, 2)}" apart, the 'fore-aft bearers') through the turntable plate margins, so the lazy-susan bearing ring and the kingpin carry no moment: F = M_p/${f(lever, 2)}" = ${f(Fc)} lbf per rail on ${f(rw, 2)}" × ${f(ts, 1)}" = ${f(Arail, 1)} in² → ${f(pRail, 1)} psi (≤ ${f(al.oakPerp, 0)}). The kingpin only transfers the horizontal force H (rigid-pin peak bearing: 'kingpin-peak'). (2) The turntable load acts on the beam at the pin line, ${f(p.kingpinLeadIn, 2)}" ahead of the axle rod, so the design axle load V = ${f(V)} lbf (${frontLoadText(ctx, w)} × ${p.dynamicFactor}) twists the beam about the rod: M_tr = V × lead = ${f(Mtr)} lb·in. The front U-bolts, legs ${f(legC, 2)}" apart, hold the beam to the rod: per side M_tr/2 = T_leg × ${f(legC, 2)}" → T_leg = ${f(Tleg)} lbf, ${f(sLeg, 0)} psi on A_t = 0.75·A (≤ ${f(al.fastTens, 0)}); the legs' pull is reacted by the ${f(plateY, 2)}" × ${f(L.beamF.thick, 2)}" plate on the beam underside: ${f(pPlate, 1)} psi (≤ ${f(al.oakPerp, 0)}). Not modeled: the stiffness of the lazy-susan plate margins that overhang the 4" beam (ask the vendor for the plate thickness).`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'pitch-path', label: 'Pitch-moment path: bolster rails and front U-bolts', group: 'Structure', refs: ['D-32', 'D-12', 'D-34'], primary: 'goal',
    ...evalBoth(ctx, ev),
  });
}

// ── M4: kingpin ligaments / crossbar split ──────────────────────────────────────────────────────────────────────

export function kingpinSplitCheck(ctx: Ctx): AnalysisCheck {
  const { p, L, d } = ctx;
  const al = allowables(ctx);
  const cb = L.crossbar;
  const bore = kingpinBoreIn(p);
  const rodR = p.axleDiameterIn / 2;
  const D1 = L.beamF.depth;
  const eFront = d.frontBeamLigamentIn;
  const eWeb = p.kingpinLeadIn - rodR - bore / 2;
  const ev = (c: CaseData): CaseEval => {
    const w = wheelLoads(ctx, c);
    const H = Math.max(...strikeCases(ctx, c).map((s) => s.H));
    const Vaxle = w.frontAxle * p.dynamicFactor;
    const Fy = p.tireGroundMu * Vaxle; // sideways skid of both front tires, all of it through the pin
    const tauFront = H / (2 * eFront * D1);
    const tauWeb = p.pullForceLbf / (2 * eWeb * p.axleDiameterIn);
    const ds: Detail[] = [
      detail('beam front ligament shear-out (strike pushes the beam aft against the pin)', tauFront, 'psi', al.oakShear, '<='),
      detail('beam web shear-out between the pin bore and the rod groove (rope pull)', tauWeb, 'psi', al.oakShear, '<='),
    ];
    let crossTxt = ' No crossbar in this configuration.';
    if (cb) {
      const D2 = cb.z1 - cb.z0;
      const eSide = (2 * cb.hw - bore) / 2;
      const eEnd = cb.x1 - L.kx - bore / 2;
      const tauSide = Fy / (2 * eSide * D2);
      const tauEnd = H / (2 * eEnd * D2);
      ds.push(detail('crossbar side ligament shear-out (lateral pin load)', tauSide, 'psi', al.oakShear, '<='));
      ds.push(detail('crossbar end ligament shear-out (fore-aft pin load, along the grain)', tauEnd, 'psi', al.oakShear, '<='));
      crossTxt = ` Crossbar (${f(2 * cb.hw, 2)}" wide, ${f(D2, 2)}" deep, ${f(bore, 3)}" bore): lateral load F_y = μ × V = ${f(p.tireGroundMu, 2)} × ${f(Vaxle)} = ${f(Fy)} lbf pushes the bore wall toward a side ligament of ${f(eSide, 3)}": τ = F_y/(2·e·D) = ${f(tauSide, 0)} psi; fore-aft H = ${f(H)} lbf toward the crossbar end, ligament ${f(eEnd, 2)}" along the grain: τ = H/(2·e·D) = ${f(tauEnd, 0)} psi. The crossbar's edge distance to the bore (e/D_bore = ${f(eSide / bore, 2)}) is far below the 4·D loaded-edge rule for a bolt ⊥ grain, so the side-ligament row is the one to watch: it is a block-shear (plug) estimate, not NDS cleavage, and the lateral load is an envelope.`;
    }
    const how = `Ligament shear-out (block shear): a pin pushing toward a free face shears out the wood between the bore and that face along two planes, τ = F/(2·e·D). Beam (${f(D1, 2)}" deep): the strike H = ${f(H)} lbf pushes the beam aft, so the ${f(eFront, 3)}" front ligament (beam front face to the bore) is loaded: τ = ${f(H)}/(2 × ${f(eFront, 3)} × ${f(D1, 2)}) = ${f(tauFront, 0)} psi; the rope pull ${p.pullForceLbf} lbf loads the web between the bore and the axle-rod groove (${f(eWeb, 3)}" thick, only over the ${f(p.axleDiameterIn, 2)}" groove depth): τ = ${f(tauWeb, 0)} psi.${crossTxt} Allowable shear ${f(al.oakShear, 0)} psi (${p.oakShearPsi} × C_M ${p.wetServiceFactorStrength} / ${p.woodSafetyFactor}).`;
    return governing(ds, how);
  };
  return dualCheck({
    id: 'kingpin-split', label: 'Kingpin ligaments: beam and crossbar split / shear-out', group: 'Structure', refs: ['D-32', 'A2'], primary: 'goal',
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
