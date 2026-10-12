/**
 * Bridle-tie row (D-56, D-58): the bow shackle through the bronze sleeve near the tip of the white-oak tongue (pivot.ts), the tongue itself (a bandsawn T set ON EDGE, bolted to the
 * front face of the front axle beam with two carriage bolts) and those bolts. The row id `bridle-eye` is kept. The pull passes shackle pin > sleeve > oak around the hole > stem >
 * head > the two carriage bolts and the head's bearing on the beam face > kingpin (shear, see `kingpin` in front.ts). The rope and the shackle pin are the intended weak link of the
 * whole chain (D-47): this row is the strength of everything between them and the kingpin at the design pull x the overload factor.
 *
 * D-58: the first D-56 tongue was a 3/16 in steel plate lying FLAT on the beam; the vertical part of the pull bent it about its thin axis (3.7x over). The oak tongue stands on
 * edge, so that pull bends it about its strong axis.
 */
import { tongueOutline } from '../model/pivot';
import type { Ctx } from './context';
import { dualCheck, detail, governing, type CaseEval } from './dual';
import { DEG } from './geometry';
import { f } from './format';
import type { CaseData } from './loads';
import { evalBoth } from './stability';
import { uncTensileArea } from './nds';
import { allowables } from './structure';
import type { AnalysisCheck, Detail } from './types';

/** Share of the bending design stress that oak takes in tension parallel to the grain (assumed: white oak tension || grain is about 0.7 of its bending strength; 0.5 is used). */
export const OAK_TENSION_PAR_OF_BEND = 0.5;
/** Outside diameter (in) of the fender washer under each tongue-bolt nut, on the rear face of the axle beam. */
export const TONGUE_NUT_WASHER_OD_IN = 2;

/** Width of the tongue at x (from its plan outline, model/pivot.ts). */
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

/**
 * Tongue stress along x (between the beam's front face and the shackle hole) for a vertical tip force, a horizontal axial force and a lateral force: the worst section.
 * The tongue stands on edge: the vertical force bends it about its STRONG axis (S = w d^2 / 6, d the depth), the lateral force about the weak one (S = d w^2 / 6).
 */
export function tongueBarStress(ctx: Ctx, Tv: number, Tax: number, Tlat: number) {
  const { L } = ctx;
  const d = L.tongue.z1 - L.tongue.z0;
  const x0 = L.king.x + L.beamF.thick / 2; // the tongue head butts the beam's front face
  const xh = L.tongue.holeX;
  let best = { x: x0, w: 0, sigma: 0, sv: 0, sh: 0, sa: 0 };
  const xs = Array.from({ length: 201 }, (_, i) => x0 + ((xh - x0) * i) / 200);
  const stemX = x0 + 2 * ctx.p.tongueHeadLenIn; // the end of the taper, where the stem starts: the section there is the narrowest and usually the worst
  if (stemX > x0 && stemX < xh) xs.push(stemX);
  for (const x of xs) {
    const w = tongueWidthAt(ctx, x);
    const arm = xh - x;
    const sv = (Tv * arm) / ((w * d * d) / 6);
    const sh = (Tlat * arm) / ((d * w * w) / 6);
    const sa = Tax / (w * d);
    if (sv + sh + sa > best.sigma) best = { x, w, sigma: sv + sh + sa, sv, sh, sa };
  }
  return best;
}

// ── bridle tie ──────────────────────────────────────────────────────────────────────────────────────────────────

export function bridleEye(ctx: Ctx): AnalysisCheck {
  const { p, L } = ctx;
  const al = allowables(ctx);
  const ld = tieLoad(ctx);
  const w = p.tongueWidthIn;
  const d = L.tongue.z1 - L.tongue.z0;
  const dPin = p.eyeBoltDiameterIn;
  const Apin = (Math.PI * dPin * dPin) / 4;
  const Zpin = (Math.PI * dPin ** 3) / 32;
  const SF = p.steelSafetyFactor;
  const pinAllow = p.eyeBoltYieldPsi / SF;
  const hole = p.tongueHoleDiaIn; // the sleeve's OD = the drilled hole
  const endDist = L.tongue.tipX - L.tongue.holeX; // tip to the hole center
  const Lc = Math.max(0.05, endDist - hole / 2);
  const tb = p.tongueBoltDiaIn;
  const bd = p.tongueBoltOffsetIn; // the carriage bolts' offset from the center line (pivot.ts)
  const xb = L.king.x + L.beamF.thick / 2; // the beam's front face
  const arm = L.tongue.holeX - xb;
  const hb = d / 2; // bolts at mid depth: their height above the bottom edge of the head, the pivot of the nose-up pry
  const washerA = (Math.PI / 4) * (TONGUE_NUT_WASHER_OD_IN ** 2 - (tb + 1 / 16) ** 2);
  const oakTen = al.oakBend * OAK_TENSION_PAR_OF_BEND;
  const ev = (c: CaseData): CaseEval => {
    void c;
    const T = ld.T;
    // 1. Shackle pin: double shear through the clevis and bending over the jaw gap (the tongue sits between the jaws; assume the gap is the tongue plus the washers and 1/4 in).
    const gap = w + 0.25;
    const tauPin = T / (2 * Apin);
    const sigPin = (T * gap) / 4 / Zpin;
    // 2. Shackle hole in the oak: the sleeve bears on the oak (projected area, load along the grain), shear-out of the strip ahead of the hole (two planes, parallel to the grain), net-section tension.
    const bear = T / (hole * w);
    const tear = T / (2 * Lc * w);
    const net = T / ((d - hole) * w);
    // 3. Tongue stem, a cantilever from the beam's front face: bending about the strong axis from the vertical part of the pull, straight ahead and at full lock (lateral part added about the weak axis).
    const b0 = tongueBarStress(ctx, ld.Tv, ld.Th, 0);
    const b1 = tongueBarStress(ctx, ld.Tv, ld.axialLock, ld.latLock);
    // 4. The two carriage bolts: the axial pull and the nose-up pry (the vertical pull and the axial pull at mid depth tip the head about its bottom edge on the beam face) are TENSION;
    //    the lateral pull at full lock twists the head about the kingpin (a couple on the two bolts, 2 bd apart) as shear.
    const Mz = ld.latLock * arm;
    const Fcouple = Mz / (2 * bd);
    const boltShear = Fcouple / ((Math.PI * tb * tb) / 4);
    const boltShearAllow = (0.6 * p.ss316BoltYieldPsi) / SF;
    const Ttot = ld.Th + (ld.Tv * arm) / hb; // total bolt tension (both bolts): the axial pull + the pry
    const Tbolt = Ttot / 2;
    const boltTen = Tbolt / uncTensileArea(tb);
    const boltTenAllow = p.ss316BoltYieldPsi / SF;
    const washBear = Tbolt / washerA;
    const ds: Detail[] = [
      detail('shackle pin: double shear', tauPin, 'psi', 0.577 * pinAllow, '<='),
      detail('shackle pin: bending over the jaw gap', sigPin, 'psi', pinAllow, '<='),
      detail('shackle hole: the sleeve bearing on the oak along the grain (dowel bearing)', bear, 'psi', al.oakDowel, '<='),
      detail('shackle hole: edge shear-out (2 planes along the grain)', tear, 'psi', al.oakShear, '<='),
      detail('shackle hole: net-section tension along the grain', net, 'psi', oakTen, '<='),
      detail('tongue stem: vertical-pull bending about the strong axis + axial, straight ahead', b0.sigma, 'psi', al.oakBend, '<='),
      detail('tongue stem: strong-axis + lateral (weak axis) + axial at full lock', b1.sigma, 'psi', al.oakBend, '<='),
      detail('carriage bolts: shear (yaw couple of the lateral pull at full lock)', boltShear, 'psi', boltShearAllow, '<='),
      detail('carriage bolts: tension (the axial pull + the nose-up pry on the head)', boltTen, 'psi', boltTenAllow, '<='),
      detail('carriage bolts: nut washer on the rear face of the axle beam (oak perpendicular)', washBear, 'psi', al.oakPerp, '<='),
    ];
    const how = `Tie load: design pull ${f(p.pullForceLbf)} lbf (D-14) x overload factor ${p.bridleTieOverloadFactor} (D-47) = ${f(ld.T)} lbf along the rope from the tie (z = ${f(L.tongue.tieZ, 2)}", x = ${f(L.tongue.holeX, 1)}") to the pullers' hands ${f(p.bridleRopeRunIn)}" ahead at ${f(ld.handsZ)}" (${f(ld.alpha * DEG, 1)} deg above horizontal): ${f(ld.Th)} lbf horizontal, ${f(ld.Tv)} lbf vertical. `
      + `Shackle pin ${f(dPin, 3)}" in double shear: ${f(tauPin, 0)} psi (allow ${f(0.577 * pinAllow, 0)} = 0.577 x yield ${f(p.eyeBoltYieldPsi, 0)} / ${SF}); bending over the ${f(gap, 2)}" jaw gap ${f(sigPin, 0)} psi (allow ${f(pinAllow, 0)}). `
      + `Oak around the ${f(hole, 2)}" sleeve (${f(endDist, 2)}" from the tip, ${f(Lc, 2)}" of oak ahead of the hole, the stem ${f(w, 2)}" thick x ${f(d, 2)}" deep): bearing ${f(bear, 0)} psi (dowel ${f(al.oakDowel, 0)}), shear-out ${f(tear, 0)} psi on 2 planes (shear ${f(al.oakShear, 0)}), net-section tension ${f(net, 0)} psi on ${f(d - hole, 2)}" (${f(oakTen, 0)} = ${OAK_TENSION_PAR_OF_BEND} x the bending design stress, assumed). `
      + `Stem as a cantilever from the beam's front face (x = ${f(xb, 2)}"): the vertical ${f(ld.Tv, 0)} lbf acts ${f(L.tongue.holeX - b0.x, 1)}" out from the critical section (x = ${f(b0.x, 1)}", ${f(b0.w, 2)}" wide, strong-axis S = ${f((b0.w * d * d) / 6, 3)} in3): ${f(b0.sv, 0)} psi bending + ${f(b0.sa, 0)} axial = ${f(b0.sigma, 0)} psi straight ahead; at full lock (${f(ld.lock * DEG, 0)} deg, lateral ${f(ld.latLock)} lbf about the weak axis, axial ${f(ld.axialLock)} lbf) ${f(b1.sigma, 0)} psi; allow ${f(al.oakBend, 0)}. The steel plate it replaces lay flat and bent about its thin axis at 3.7x. `
      + `Carriage bolts (2 x ${f(tb, 3)}" 316, ${f(bd, 2)}" either side of the kingpin line, mid depth): the pull tries to pull the head off the beam face: ${f(ld.Th)} lbf axial + the pry of the vertical pull ${f(ld.Tv)} lbf x ${f(arm, 1)}" / ${f(hb, 2)}" = ${f((ld.Tv * arm) / hb)} lbf = ${f(Ttot)} lbf over two bolts, ${f(Tbolt)} lbf each = ${f(boltTen, 0)} psi (allow ${f(boltTenAllow, 0)}); the ${f(TONGUE_NUT_WASHER_OD_IN, 0)}" fender washers on the beam's rear face bear at ${f(washBear, 0)} psi (oak perpendicular ${f(al.oakPerp, 0)}). The lateral pull ${f(ld.latLock)} lbf x ${f(arm, 1)}" = ${f(Mz)} lb.in twists the head: ${f(Fcouple)} lbf per bolt = ${f(boltShear, 0)} psi shear (allow ${f(boltShearAllow, 0)}). `
      + `Order of failure (D-47): the rope and the shackle pin (the shackle's working-load limit must be at least ${f(ld.T)} lbf) are meant to go first, then the tongue bends (oak bends and splits slowly), and the kingpin (kingpin row) is far stronger. The pull through the kingpin and its nut is in the kingpin row.`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'bridle-eye', label: 'Bridle tie: shackle, oak tongue and carriage bolts', group: 'Structure', refs: ['D-33', 'D-14', 'D-47', 'D-56', 'D-58'], primary: 'goal', ...evalBoth(ctx, ev, { cargo: false }) });
}

export function bridleChecks(ctx: Ctx): AnalysisCheck[] {
  return [bridleEye(ctx)];
}
