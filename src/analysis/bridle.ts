/**
 * Bridle-tie row (D-56, D-58, D-62): the bridle rope through the bronze sleeve near the tip of the white-oak tongue (pivot.ts; no shackle since D-62), the tongue itself (a bandsawn T set
 * ON EDGE, bolted to the front face of the front axle beam with two carriage bolts) and those bolts. The row id `bridle-eye` is kept. The pull passes rope > sleeve > oak around the
 * hole > stem > head > the two carriage bolts and the head's bearing on the beam face > kingpin (shear, see `kingpin` in front.ts). The ROPE is the documented weak link (its working
 * load limit and its knotted breaking strength are rows here, D-62): this row is the strength of everything between it and the kingpin at the design pull x the overload factor, plus the
 * slack-then-taut SNATCH at the start of a pull (v sqrt(k m): oak may dent, nothing may break).
 *
 * D-58: the first D-56 tongue was a 3/16 in steel plate lying FLAT on the beam; the vertical part of the pull bent it about its thin axis (3.7x over). The oak tongue stands on
 * edge, so that pull bends it about its strong axis.
 */
import { bridleRopeKnot } from '../model/bridle';
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
/** Gravity in in/s2 (lbf to lb s2/in) and the speed conversion. */
const G_IN_S2 = 386.09;
const IN_PER_S_PER_MPH = 17.6;

/** Width of the tongue at x (from its plan outline, model/pivot.ts): twice the largest y where the outline crosses x (D-75: the head's square front face is a vertical edge, the shoulder a fillet). */
export function tongueWidthAt(ctx: Ctx, x: number): number {
  const o = tongueOutline(ctx);
  const xs = o.map((q) => q[0]);
  const xc = Math.min(Math.max(x, Math.min(...xs)), Math.max(...xs));
  let best = 0;
  for (let i = 0; i < o.length; i++) {
    const [x0, y0] = o[i], [x1, y1] = o[(i + 1) % o.length];
    if (xc < Math.min(x0, x1) - 1e-9 || xc > Math.max(x0, x1) + 1e-9) continue;
    // a vertical edge (the head's front face) counts as the narrower end: just past the face the section is the taper's, not the head's
    const y = Math.abs(x1 - x0) < 1e-9 ? Math.min(Math.abs(y0), Math.abs(y1)) : Math.abs(y0 + ((y1 - y0) * (xc - x0)) / (x1 - x0));
    best = Math.max(best, y);
  }
  return 2 * best;
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
 * Tongue stress along x (between the beam's front face and the bridle hole) for a vertical tip force, a horizontal axial force and a lateral force: the worst section.
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
  const SF = p.steelSafetyFactor;
  const rope = bridleRopeKnot(p);
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
    // 1. The rope (D-62): its working load limit against the design pull, and the knotted breaking strength against the tie load (the order-of-failure line below).
    // 2. Bridle hole in the oak: the sleeve bears on the oak (projected area, load along the grain), shear-out of the strip ahead of the hole (two planes, parallel to the grain), net-section tension.
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
    // 5. SNATCH (D-62, eng 3c S-1): the pullers take up the slack and the rope comes taut with a closing speed v: F = v sqrt(k m), k the stiffness of rope and pullers, m the moving mass. Wood to its
    //    MOR x C_M, steel to yield, no safety factors (nothing may BREAK); the oak may dent (sleeve bearing, nut washers), so those two are reported in the text, not as rows.
    const mSlug = c.massLb / G_IN_S2;
    const vSnatch = p.bridleSnatchSpeedMph * IN_PER_S_PER_MPH;
    const Fs = vSnatch * Math.sqrt(p.bridleSnatchStiffLbIn * mSlug);
    const Fsh = Fs * Math.cos(ld.alpha), Fsv = Fs * Math.sin(ld.alpha);
    const bs = tongueBarStress(ctx, Fsv, Fsh, 0);
    const tearS = Fs / (2 * Lc * w), netS = Fs / ((d - hole) * w);
    const TtotS = Fsh + (Fsv * arm) / hb;
    const boltTenS = TtotS / 2 / uncTensileArea(tb);
    const bearS = Fs / (hole * w), washS = TtotS / 2 / washerA;
    const woodSF = p.woodSafetyFactor;
    const ds: Detail[] = [
      detail('rope: design pull against its working load limit (new nylon, 10% of breaking)', p.pullForceLbf, 'lbf', rope.wll, '<='),
      detail('bridle hole: the sleeve bearing on the oak along the grain (dowel bearing)', bear, 'psi', al.oakDowel, '<='),
      detail('bridle hole: edge shear-out (2 planes along the grain)', tear, 'psi', al.oakShear, '<='),
      detail('bridle hole: net-section tension along the grain', net, 'psi', oakTen, '<='),
      detail('tongue stem: vertical-pull bending about the strong axis + axial, straight ahead', b0.sigma, 'psi', al.oakBend, '<='),
      detail('tongue stem: strong-axis + lateral (weak axis) + axial at full lock', b1.sigma, 'psi', al.oakBend, '<='),
      detail('carriage bolts: shear (yaw couple of the lateral pull at full lock)', boltShear, 'psi', boltShearAllow, '<='),
      detail('carriage bolts: tension (the axial pull + the nose-up pry on the head)', boltTen, 'psi', boltTenAllow, '<='),
      detail('carriage bolts: nut washer on the rear face of the axle beam (oak perpendicular)', washBear, 'psi', al.oakPerp, '<='),
      detail('SNATCH: tongue stem bending (MOR x C_M, no safety factor)', bs.sigma, 'psi', al.oakBend * woodSF, '<='),
      detail('SNATCH: bridle hole edge shear-out (no safety factor)', tearS, 'psi', al.oakShear * woodSF, '<='),
      detail('SNATCH: bridle hole net-section tension (no safety factor)', netS, 'psi', oakTen * woodSF, '<='),
      detail('SNATCH: carriage bolts tension (steel yield, no safety factor)', boltTenS, 'psi', p.ss316BoltYieldPsi, '<='),
      detail('SNATCH: the rope at the bowline (knotted breaking strength)', Fs, 'lbf', rope.knotted, '<='),
    ];
    // Order of failure at the tie load: the load at which each oak or steel detail would reach its ULTIMATE (allowable x its safety factor / its stress), against the rope's knotted breaking load.
    const mults = [
      { n: 'tongue stem bending', k: (al.oakBend * woodSF) / b0.sigma },
      { n: 'bridle hole shear-out', k: (al.oakShear * woodSF) / tear },
      { n: 'bridle hole net section', k: (oakTen * woodSF) / net },
      { n: 'carriage bolt tension', k: p.ss316BoltYieldPsi / boltTen },
    ].sort((a, b2) => a.k - b2.k);
    const weakest = mults[0];
    const how = `Tie load: design pull ${f(p.pullForceLbf)} lbf (D-14) x overload factor ${p.bridleTieOverloadFactor} (D-47) = ${f(ld.T)} lbf along the rope from the tie (z = ${f(L.tongue.tieZ, 2)}", x = ${f(L.tongue.holeX, 1)}") to the pullers' hands ${f(p.bridleRopeRunIn)}" ahead at ${f(ld.handsZ)}" (${f(ld.alpha * DEG, 1)} deg above horizontal): ${f(ld.Th)} lbf horizontal, ${f(ld.Tv)} lbf vertical. `
      + `Rope: ${f(p.bridleRopeDiaIn, 3)}" nylon through the sleeve, once round the tongue tip, bowline (D-62, no shackle): rated ${f(rope.rated, 0)} lbf new, ${f(rope.knotted, 0)} lbf at the knot (${f(p.bridleKnotEfficiency * 100, 0)}%), working load limit ${f(rope.wll, 0)} lbf (${f(p.bridleRopeWllFraction * 100, 0)}%) against the ${f(p.pullForceLbf, 0)} lbf design pull. `
      + `Oak around the ${f(hole, 2)}" sleeve (${f(endDist, 2)}" from the tip, ${f(Lc, 2)}" of oak ahead of the hole, the stem ${f(w, 2)}" thick x ${f(d, 2)}" deep): bearing ${f(bear, 0)} psi (dowel ${f(al.oakDowel, 0)}), shear-out ${f(tear, 0)} psi on 2 planes (shear ${f(al.oakShear, 0)}), net-section tension ${f(net, 0)} psi on ${f(d - hole, 2)}" (${f(oakTen, 0)} = ${OAK_TENSION_PAR_OF_BEND} x the bending design stress, assumed). `
      + `Stem as a cantilever from the beam's front face (x = ${f(xb, 2)}"): the vertical ${f(ld.Tv, 0)} lbf acts ${f(L.tongue.holeX - b0.x, 1)}" out from the critical section (x = ${f(b0.x, 1)}", ${f(b0.w, 2)}" wide, strong-axis S = ${f((b0.w * d * d) / 6, 3)} in3): ${f(b0.sv, 0)} psi bending + ${f(b0.sa, 0)} axial = ${f(b0.sigma, 0)} psi straight ahead; at full lock (${f(ld.lock * DEG, 0)} deg, lateral ${f(ld.latLock)} lbf about the weak axis, axial ${f(ld.axialLock)} lbf) ${f(b1.sigma, 0)} psi; allow ${f(al.oakBend, 0)}. The steel plate it replaces lay flat and bent about its thin axis at 3.7x. `
      + `Carriage bolts (2 x ${f(tb, 3)}" 316, ${f(bd, 2)}" either side of the kingpin line, mid depth): the pull tries to pull the head off the beam face: ${f(ld.Th)} lbf axial + the pry of the vertical pull ${f(ld.Tv)} lbf x ${f(arm, 1)}" / ${f(hb, 2)}" = ${f((ld.Tv * arm) / hb)} lbf = ${f(Ttot)} lbf over two bolts, ${f(Tbolt)} lbf each = ${f(boltTen, 0)} psi (allow ${f(boltTenAllow, 0)}); the ${f(TONGUE_NUT_WASHER_OD_IN, 0)}" fender washers on the beam's rear face bear at ${f(washBear, 0)} psi (oak perpendicular ${f(al.oakPerp, 0)}). The lateral pull ${f(ld.latLock)} lbf x ${f(arm, 1)}" = ${f(Mz)} lb.in twists the head: ${f(Fcouple)} lbf per bolt = ${f(boltShear, 0)} psi shear (allow ${f(boltShearAllow, 0)}). `
      + `SNATCH (slack then taut, D-62): F = v sqrt(k m) = ${f(vSnatch, 1)} in/s (${f(p.bridleSnatchSpeedMph, 1)} mph) x sqrt(${f(p.bridleSnatchStiffLbIn, 0)} lb/in x ${f(mSlug, 3)} lb s2/in) = ${f(Fs)} lbf (${f(Fsh)} horizontal, ${f(Fsv)} vertical; a stiff low-stretch rope at about 100 lb/in would be ${f(vSnatch * Math.sqrt(100 * mSlug))} lbf). Against the ULTIMATE strengths with no safety factors: stem ${f(bs.sigma, 0)} psi (MOR ${f(al.oakBend * woodSF, 0)}), shear-out ${f(tearS, 0)}, net section ${f(netS, 0)}, carriage bolts ${f(boltTenS, 0)} psi (yield ${f(p.ss316BoltYieldPsi, 0)}): nothing breaks. The oak may DENT: the sleeve bearing is ${f(bearS, 0)} psi (dowel allowable ${f(al.oakDowel, 0)}, ${f(bearS / al.oakDowel, 2)} x) and the nut washers ${f(washS, 0)} psi (perpendicular allowable ${f(al.oakPerp, 0)}, ${f(washS / al.oakPerp, 2)} x); a dent is acceptable and does not weaken the joint. `
      + `Order of failure (D-62, replaces the D-47 shackle-pin claim): the ROPE is the documented weak link and the part to replace: it is rated ${f(rope.wll, 0)} lbf working load and breaks at the bowline at about ${f(rope.knotted, 0)} lbf. `
      + `At the ${f(ld.T, 0)} lbf tie load the first oak or steel detail to reach its ultimate would be the ${weakest.n}, at about ${f(weakest.k * ld.T, 0)} lbf (${f(weakest.k, 1)} x the tie load; that estimate takes allowable x safety factor, so it is conservative for the wood)`
      + (weakest.k * ld.T >= rope.knotted ? `: the rope lets go first, but only just (the carriage bolts would yield at about the same load); the oak under the nut washers dents long before either. ` : `: that is BELOW the rope's knotted ${f(rope.knotted, 0)} lbf, so a well-tied new rope does NOT go first; choose a weaker rope or strengthen that detail. `)
      + `The pull through the kingpin and its nut is in the kingpin row.`;
    return governing(ds, how);
  };
  return dualCheck({ id: 'bridle-eye', label: 'Bridle tie: rope, oak tongue and carriage bolts (with the start-up snatch)', group: 'Structure', refs: ['D-33', 'D-14', 'D-47', 'D-56', 'D-58', 'D-62'], primary: 'goal', ...evalBoth(ctx, ev, { cargo: false }) });
}

export function bridleChecks(ctx: Ctx): AnalysisCheck[] {
  return [bridleEye(ctx)];
}
