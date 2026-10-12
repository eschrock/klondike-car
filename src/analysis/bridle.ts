/**
 * Bridle-tie row (D-56): the bow shackle through the tie hole in the tip of the tongue plate, the tongue plate itself (a 3/16 in A36 flat bar cantilevered from the front axle beam)
 * and its two bolts to the beam. It replaces the eye bolt / backing block / bow curl of the first D-54 pass; the row id `bridle-eye` is kept. The pull passes shackle pin > tie hole >
 * tongue bar > head > kingpin (shear, see `kingpin` in front.ts) and the two tongue bolts > beam. The rope is the intended weak link of the whole chain: this row is the strength of
 * everything between the rope and the kingpin at the design pull x the overload factor (D-47).
 */
import { tongueOutline } from '../model/pivot';
import type { Ctx } from './context';
import { dualCheck, detail, governing, type CaseEval } from './dual';
import { DEG } from './geometry';
import { f } from './format';
import type { CaseData } from './loads';
import { evalBoth } from './stability';
import { uncTensileArea } from './nds';
import type { AnalysisCheck, Detail } from './types';

/** The diameter of the tie hole in the tongue tip (in): a 3/4 in hole takes the 1/2 in shackle bow with room (the part sourcing note says the same). */
export const TIE_HOLE_DIA_IN = 0.75;

/** Width of the tongue plate at x (from its plan outline, model/pivot.ts). */
export function tongueWidthAt(ctx: Ctx, x: number): number {
  const o = tongueOutline(ctx);
  // The outline is symmetric: take the upper-y edges, walking in x.
  const top = o.filter((q) => q[1] > 0).sort((a, b) => a[0] - b[0]);
  if (x <= top[0][0] || x >= top[top.length - 1][0]) return 2 * (x <= top[0][0] ? top[0][1] : top[top.length - 1][1]);
  for (let i = 0; i + 1 < top.length; i++) {
    const [x0, y0] = top[i], [x1, y1] = top[i + 1];
    if (x >= x0 && x <= x1) return 2 * (x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
  }
  return 2 * top[top.length - 1][1];
}

/** Everything about the tie load: the design pull x overload factor, split into its horizontal and vertical parts, and the lateral part when the axle is at full lock. */
export function tieLoad(ctx: Ctx) {
  const { p, L } = ctx;
  const handsZ = Math.max(p.pullerHandHeightIn, p.bridleTieHandHeightMaxIn);
  const alpha = Math.atan2(handsZ - L.tongue.tieZ, p.bridleRopeRunIn);
  const T = p.pullForceLbf * p.bridleTieOverloadFactor;
  const Th = T * Math.cos(alpha), Tv = T * Math.sin(alpha);
  const lock = L.steer.lock;
  return { handsZ, alpha, T, Th, Tv, lock, axialLock: Th * Math.cos(lock), latLock: Th * Math.sin(lock) };
}

/** Tongue bar stress along x (between the beam's front face and the tie hole) for a vertical tip force, a horizontal axial force and a lateral force: the worst section. */
export function tongueBarStress(ctx: Ctx, Tv: number, Tax: number, Tlat: number) {
  const { p, L } = ctx;
  const t = p.tongueThickIn;
  const x0 = L.king.x + L.beamF.thick / 2; // the tongue is supported on the beam up to its front face
  const xh = L.tongue.holeX;
  let best = { x: x0, w: 0, sigma: 0, sv: 0, sh: 0, sa: 0 };
  for (let i = 0; i <= 200; i++) {
    const x = x0 + ((xh - x0) * i) / 200;
    const w = tongueWidthAt(ctx, x);
    // Net of the tie hole only at the hole's own section (the moment there is nil).
    const arm = xh - x;
    const sv = (Tv * arm) / ((w * t * t) / 6);
    const sh = (Tlat * arm) / ((t * w * w) / 6);
    const sa = Tax / (w * t);
    if (sv + sh + sa > best.sigma) best = { x, w, sigma: sv + sh + sa, sv, sh, sa };
  }
  return best;
}

// ── bridle tie ──────────────────────────────────────────────────────────────────────────────────────────────────

export function bridleEye(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const ld = tieLoad(ctx);
  const t = p.tongueThickIn;
  const dPin = p.eyeBoltDiameterIn;
  const Apin = (Math.PI * dPin * dPin) / 4;
  const Zpin = (Math.PI * dPin ** 3) / 32;
  const SF = p.steelSafetyFactor;
  const pinAllow = p.eyeBoltYieldPsi / SF;
  const Fy = p.bracketSteelYieldPsi, Fu = p.bracketSteelUltimatePsi;
  const hole = TIE_HOLE_DIA_IN;
  const endDist = L.tongue.tipX - L.tongue.holeX; // tip to the hole center
  const Lc = endDist - hole / 2;
  const tb = p.tongueBoltDiaIn;
  const bd = Math.max(p.kingThrustOdIn / 2 + tb / 2 + 0.08, 1.4); // the plate bolts' offset from the center line (pivot.ts)
  const arm = L.tongue.holeX - L.king.x; // tie hole ahead of the kingpin
  const frontFace = L.king.x + L.beamF.thick / 2;
  const ev = (c: CaseData): CaseEval => {
    void c;
    const T = ld.T;
    // 1. Shackle pin: double shear through the clevis and bending over the jaw gap (the tongue plate sits between the jaws; assume the gap is the plate plus 1/4 in).
    const gap = t + 0.25;
    const tauPin = T / (2 * Apin);
    const sigPin = (T * gap) / 4 / Zpin;
    // 2. Tie hole: bearing of the pin on the plate (projected area) and shear-out of the edge strip (two planes, AISC style: 0.6 Fu on Lc x t each), net-section tension.
    const bear = T / (dPin * t);
    const bearAllow = (1.8 * Fy) / SF;
    const tear = T / (2 * Lc * t);
    const tearAllow = (0.6 * Fu) / SF;
    const wBar = tongueWidthAt(ctx, L.tongue.holeX);
    const net = T / ((wBar - hole) * t);
    const netAllow = Fy / SF;
    // 3. Tongue bar, cantilevered from the beam's front face: weak-axis bending from the vertical part of the pull, straight ahead and at full lock (lateral part added).
    const b0 = tongueBarStress(ctx, ld.Tv, ld.Th, 0);
    const b1 = tongueBarStress(ctx, ld.Tv, ld.axialLock, ld.latLock);
    const barAllow = Fy / SF;
    // 4. The two tongue bolts: the lateral part of the pull at full lock twists the tongue about the kingpin (a couple on the two bolts, 2 bd apart) plus a third of the axial part (the kingpin and
    //    the two bolts share it); the vertical part lifts the nose and tips the head about its front edge: bolt tension.
    const Mz = ld.latLock * arm;
    const Fcouple = Mz / (2 * bd);
    const Fbolt = Math.hypot(Fcouple, ld.axialLock / 3); // vector-sum bound of the two components
    const boltShear = Fbolt / ((Math.PI * tb * tb) / 4);
    const boltShearAllow = (0.6 * p.ss316BoltYieldPsi) / SF;
    const headFront = L.king.x + Math.max(p.tongueHeadWidthIn / 2, p.kingThrustOdIn / 2 + 0.25);
    const tipArm = L.tongue.holeX - headFront; // tie hole ahead of the head's front edge (the tipping line)
    const leverBolts = headFront - L.king.x; // bolts and kingpin sit on the kingpin line
    const Tb = (ld.Tv * tipArm) / leverBolts / 2; // total lift moment over two bolts (the kingpin takes a share too: ignored, conservative)
    const boltTen = Tb / uncTensileArea(tb);
    const boltTenAllow = p.ss316BoltYieldPsi / SF;
    const ds: Detail[] = [
      detail('shackle pin: double shear', tauPin, 'psi', 0.577 * pinAllow, '<='),
      detail('shackle pin: bending over the jaw gap', sigPin, 'psi', pinAllow, '<='),
      detail('tie hole: bearing of the pin on the A36 plate', bear, 'psi', bearAllow, '<='),
      detail('tie hole: edge shear-out (2 planes)', tear, 'psi', tearAllow, '<='),
      detail('tie hole: net-section tension', net, 'psi', netAllow, '<='),
      detail('tongue bar: vertical-pull bending about the weak axis + axial, straight ahead', b0.sigma, 'psi', barAllow, '<='),
      detail('tongue bar: weak-axis + lateral + axial at full lock', b1.sigma, 'psi', barAllow, '<='),
      detail('tongue bolts: shear (yaw couple of the lateral pull + their share of the axial pull)', boltShear, 'psi', boltShearAllow, '<='),
      detail('tongue bolts: tension (the vertical pull tips the head about its front edge)', boltTen, 'psi', boltTenAllow, '<='),
    ];
    const how = `Tie load: design pull ${f(p.pullForceLbf)} lbf (D-14) x overload factor ${p.bridleTieOverloadFactor} (D-47) = ${f(ld.T)} lbf along the rope from the tie (z = ${f(L.tongue.tieZ, 2)}", x = ${f(L.tongue.holeX, 1)}") to the pullers' hands ${f(p.bridleRopeRunIn)}" ahead at ${f(ld.handsZ)}" (${f(ld.alpha * DEG, 1)} deg above horizontal): ${f(ld.Th)} lbf horizontal, ${f(ld.Tv)} lbf vertical. `
      + `Shackle pin ${f(dPin, 3)}" in double shear: ${f(tauPin, 0)} psi (allow ${f(0.577 * pinAllow, 0)} = 0.577 x yield ${f(p.eyeBoltYieldPsi, 0)} / ${SF}); bending over the ${f(gap, 2)}" jaw gap ${f(sigPin, 0)} psi (allow ${f(pinAllow, 0)}). `
      + `Tie hole (${f(hole, 2)}" in the ${f(t, 4)}" A36 plate, ${f(endDist, 2)}" from the tip: ${f(Lc, 3)}" clear edge): bearing ${f(bear, 0)} psi (allow ${f(bearAllow, 0)} = 1.8 Fy / ${SF}), shear-out ${f(tear, 0)} psi on 2 planes (allow ${f(tearAllow, 0)} = 0.6 Fu / ${SF}), net-section tension ${f(net, 0)} psi on ${f(wBar - hole, 2)}" (allow ${f(netAllow, 0)}). `
      + `Tongue bar as a cantilever from the beam's front face (x = ${f(frontFace, 2)}"; the weak axis is the plate thickness): the vertical ${f(ld.Tv)} lbf acts ${f(L.tongue.holeX - b0.x, 1)}" out from the critical section (x = ${f(b0.x, 1)}", ${f(b0.w, 2)}" wide, S = ${f((b0.w * t * t) / 6, 4)} in3): ${f(b0.sv, 0)} psi bending + ${f(b0.sa, 0)} axial = ${f(b0.sigma, 0)} psi straight ahead; at full lock (${f(ld.lock * DEG, 0)} deg, the lateral ${f(ld.latLock)} lbf and axial ${f(ld.axialLock)} lbf in the bar frame) ${f(b1.sigma, 0)} psi; allow ${f(barAllow, 0)} (yield ${f(Fy, 0)} / ${SF}). A flat bar loaded through its thickness is soft: the plate yields and bends up before anything else lets go (it will not break, and the end joist underside is ${f(L.deckBot - p.crossmemberDepthIn - (L.tongue.z1), 2)}" above it as a stop), and it is a cheap part. `
      + `Tongue bolts (2 x ${f(tb, 3)}" 316, ${f(bd, 2)}" either side of the kingpin): the lateral pull ${f(ld.latLock)} lbf x ${f(arm, 1)}" = ${f(Mz)} lb.in twists the tongue on the beam: ${f(Fcouple)} lbf per bolt as a couple + a third of the axial ${f(ld.axialLock)} lbf = ${f(Fbolt)} lbf = ${f(boltShear, 0)} psi shear (allow ${f(boltShearAllow, 0)}); the vertical pull tips the head about its front edge (${f(tipArm, 1)}" out, bolts ${f(leverBolts, 1)}" back): ${f(Tb)} lbf each in tension = ${f(boltTen, 0)} psi (allow ${f(boltTenAllow, 0)}; the kingpin takes a share, ignored). `
      + `Order of failure (D-47): the rope and the shackle pin (the shackle's working-load limit must be at least ${f(ld.T)} lbf) are meant to go first, then the tongue bar bends, and the kingpin (kingpin row) is far stronger. The pull through the kingpin and its nut is in the kingpin row.`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'bridle-eye', label: 'Bridle tie: shackle, tongue plate and tongue bolts', group: 'Structure', refs: ['D-33', 'D-14', 'D-47', 'D-56'], primary: 'goal', ...evalBoth(ctx, ev, { cargo: false }) });
}

export function bridleChecks(ctx: Ctx): AnalysisCheck[] {
  return [bridleEye(ctx)];
}
