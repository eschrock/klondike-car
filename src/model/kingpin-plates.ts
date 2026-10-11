/**
 * Kingpin steel plates and their bolt groups (Phase 3 round 2, D-43). Plain numbers only; the model builder, the validator and
 * the analysis all read the same plan so they cannot disagree about where the bolts are.
 *
 * The pin runs in a steel sleeve through the front beam. A carrier plate (¼") lies on the beam top and a plate (3/16") under the
 * beam; six ⅜" bolts clamp them through the beam in ONE line along the beam (y), the line that passes through the pin, at the
 * NDS spacing for a load across the grain (5D between rows, l/D ≥ 6). The sleeve spigots into both plates, so the pin's
 * horizontal force reaches the oak only through those bolts. A third plate under the crossbar takes the pin force at the top.
 * Fore-aft cross-bolts through the beam and across the crossbar stitch the loaded slabs against cleavage.
 *
 * Frame: kingpin-relative (x forward, y left) in the neutral pose; z is not needed here.
 */
import { boltSpacing } from '../analysis/nds';
import type { Params } from '../params';

export interface KingpinPlatePlan {
  on: boolean;
  /** Plate bolt diameter. */
  D: number;
  /** y of the plate bolts through the beam, ascending, symmetric about the pin, and their common x offset from the pin (equalizes the distances to the front face and to the rod groove). */
  beamY: number[];
  beamX: number;
  /** x of the plate bolts through the crossbar (all at y = 0), ascending, symmetric about the pin. */
  barX: number[];
  /** Half sizes (x across / y along for the beam plates, x along / y across for the crossbar plate). */
  carrier: { hx: number; hy: number };
  /** The plate under the beam (narrower than the carrier since r3 fittings N-5). */
  under: { hx: number; hy: number };
  bar: { hx: number; hy: number };
  /** y of the fore-aft cross-bolts through the beam (at beam mid depth), x of the cross-bolts across the crossbar. */
  crossBeamY: number[];
  crossBarX: number[];
  /** Radius of the turntable center hole. */
  holeR: number;
}

export function kingpinPlatePlan(p: Params): KingpinPlatePlan {
  const D = p.kingpinPlateBoltDiameterIn;
  const on = p.kingpinThroughBolster === 1; // = kingpinPlatesOn(p); params.ts imports this file, so it takes no runtime import from params
  // Beam: ONE line of bolts along the grain, loaded across it: rows 5D apart for l/D ≥ 6 (rounded up to 1/16"). The first pair sits 1.5 pitches
  // from the pin so that nothing crowds the sleeve; six bolts reach out to the plate edge, which is what gives the stop torque its lever.
  const pitch = Math.ceil(boltSpacing(D, p.axleBeamDepthIn, 'perp').betweenRows * 16) / 16;
  const beamY = [-3.5, -2.5, -1.5, 1.5, 2.5, 3.5].map((k) => k * pitch);
  // x offset so the bolt line is as far from the front face as from the rod groove edge (loaded-edge rule, 4D): front face and groove edge, pin-relative.
  const bore = p.kingpinSleeveOdIn > 0 ? Math.max(p.kingpinSleeveOdIn, p.kingpinDiameterIn) : p.kingpinDiameterIn;
  const frontBeamOffsetIn = (p.kingpinLeadIn + bore / 2 - p.axleDiameterIn / 2) / 2; // = derived(p).frontBeamOffsetIn: the beam is centerd on the rod + pin pair
  const frontFace = frontBeamOffsetIn + p.frontAxleBeamThicknessIn / 2 - p.kingpinLeadIn; // x of the beam front face relative to the pin
  const grooveEdge = -(p.kingpinLeadIn - p.axleDiameterIn / 2); // x of the rod groove's front edge relative to the pin
  const beamX = Math.max(0, (frontFace + grooveEdge) / 2);
  // Crossbar: bolts in a line along the grain, loaded along it: 4D in a row, and clear of the pin hole.
  const holeR = p.kingpinDiameterIn / 2 + 1 / 64;
  const barPitch = Math.max(Math.ceil(boltSpacing(D, 1, 'par').inRow * 16) / 16, Math.ceil((2 * (holeR + D / 2 + 0.2)) * 16) / 16);
  const barX = [-3, -1, 1, 3].map((k) => (k * barPitch) / 2);
  const edge = Math.ceil(2.67 * D * 16) / 16; // plate edge distance beyond a bolt hole (≈ 2.7D)
  const carrier = { hx: Math.max(edge, p.kingpinPlateWidthIn / 2), hy: beamY[beamY.length - 1] + 0.5 };
  const under = { hx: Math.max(edge, p.kingpinUnderPlateWidthIn / 2), hy: carrier.hy };
  const bar = { hx: barX[barX.length - 1] + 0.75, hy: Math.max(edge, 1) };
  const crossBeamY = [-2, -1, 1, 2].map((k) => k * pitch); // between the pin and the first bolt, and between the first two
  const crossBarX = [-1, 1].map((k) => k * barPitch); // midway between the inner and outer plate bolts
  return { on, D, beamY, beamX, barX, carrier, under, bar, crossBeamY, crossBarX, holeR: p.turntableCenterHoleIn / 2 };
}

/**
 * Geometry rules of the plate bolt groups and the stop arms (D-43): these do not depend on the rider, so they are validator errors, not check rows (a row
 * sitting exactly on its minimum would read "marginal" at every weight). Each message carries the numbers.
 */
export function kingpinPlateIssues(p: Params): Array<{ keys: string[]; message: string }> {
  const out: Array<{ keys: string[]; message: string }> = [];
  if (p.kingpinThroughBolster !== 1) return out;
  const kp = kingpinPlatePlan(p);
  const D = p.kingpinPlateBoltDiameterIn;
  const bore = p.kingpinSleeveOdIn > 0 ? Math.max(p.kingpinSleeveOdIn, p.kingpinDiameterIn) : p.kingpinDiameterIn;
  const frontBeamOffsetIn = (p.kingpinLeadIn + bore / 2 - p.axleDiameterIn / 2) / 2;
  const frontFace = frontBeamOffsetIn + p.frontAxleBeamThicknessIn / 2 - p.kingpinLeadIn;
  const grooveEdge = -(p.kingpinLeadIn - p.axleDiameterIn / 2);
  const front = frontFace - kp.beamX, groove = kp.beamX - grooveEdge;
  const spPerp = boltSpacing(D, p.axleBeamDepthIn, 'perp');
  if (front < spPerp.loadedEdge - 1e-9 || groove < spPerp.loadedEdge - 1e-9)
    out.push({ keys: ['kingpinPlateBoltDiameterIn', 'frontAxleBeamThicknessIn', 'kingpinLeadIn'],
      message: `The kingpin plate bolt line sits ${front.toFixed(3)}" from the beam's front face and ${groove.toFixed(3)}" from the rod groove; a ${D}" bolt loaded across the grain needs a loaded edge distance of 4D = ${spPerp.loadedEdge.toFixed(3)}" (NDS 12.5.1). Use a smaller bolt or a thicker front beam.` });
  if (kp.carrier.hy > p.turntableSizeIn / 2 + 1e-9)
    out.push({ keys: ['kingpinPlateBoltDiameterIn', 'turntableSizeIn'], message: `The carrier plate is ${(2 * kp.carrier.hy).toFixed(2)}" long, longer than the ${p.turntableSizeIn}" turntable it stands under.` });
  const first = Math.abs(kp.beamY[3]);
  if (first - bore / 2 - D / 2 < 0.1 - 1e-9)
    out.push({ keys: ['kingpinPlateBoltDiameterIn', 'kingpinSleeveOdIn'], message: `The first plate bolts are only ${(first - bore / 2 - D / 2).toFixed(2)}" from the ${bore}" sleeve; they need ≥ 0.1" of steel-free gap.` });
  if (kp.bar.hy > p.kingpinCrossbarWidthIn / 2 - 0.25 + 1e-9)
    out.push({ keys: ['kingpinCrossbarWidthIn', 'kingpinPlateBoltDiameterIn'], message: `The crossbar plate is ${(2 * kp.bar.hy).toFixed(2)}" wide; it must stay ¼" inside the ${p.kingpinCrossbarWidthIn}" crossbar.` });
  // The riser between the stop arm and the channel web needs a little height (the arm's own fit inside the turntable hole is checked in validateParams, which has the stop plan).
  return out;
}

/** Half width of the stop arm: 1" (2" bar) unless the turntable hole is tight, then as wide as keeps its corner 0.02" inside the hole at the dog's inner face `ra`; never under ½". */
export function stopArmHx(p: Params, ra: number): number {
  const r = p.turntableCenterHoleIn / 2 - 0.02;
  const fit = r > ra ? Math.sqrt(r * r - ra * ra) : 0;
  return Math.max(0.5, Math.min(1.0, fit));
}

/** Arm bar thickness: the param, thinned if needed so ≥ 0.125" is left for the riser between the arm and the channel web. */
export function stopArmThick(p: Params): number {
  return Math.max(0.25, Math.min(p.steerStopBarThickIn, p.turntableThicknessIn + p.sideBearerClearanceIn - 0.125));
}
