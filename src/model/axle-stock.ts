/**
 * Axle stock text (D-60, D-71): the rear through axle and the front stub axles are the solid 1045 / CDS rod (axleWallIn = 0, Eric's choice in D-71) or, above 0, hollow DOM tube. One place for the
 * sourcing line and the shop note so the rear and front parts say the same thing.
 */
import type { Params } from '../params';
import { frac } from './joinery';

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** Material text of an axle part: the solid rod says so (the cut list and BOM key on it); a tube keeps the plain steel default. */
export const axleMaterial = (p: Params): { material?: string } => (p.axleWallIn > 0 ? {} : { material: '1045 / CDS steel rod' });

/** The stock a piece of `lengthIn` is cut from. */
export function axleSourcing(p: Params, lengthIn: number): string {
  const d = frac(p.axleDiameterIn);
  const hole = `${p.axleCrossHoleDiaIn.toFixed(3)}"`;
  if (p.axleWallIn > 0)
    return `McMaster-Carr (DOM (drawn-over-mandrel) mild-steel round tube, ASTM A513 Type 5, 1020 or 1026 - NOT ordinary ERW 'mechanical' tube, which is about 45 ksi yield and takes the axle-stress row from 0.92 to about 1.4 (a fail) at 5/8 in; keep the mill cert or the supplier's A513 T5 statement - ${d}" OD x ${p.axleWallIn.toFixed(3)}" wall, cut ${f2(lengthIn)}" long; drill a ${hole} cross hole ${f2(p.axleCrossHoleFromEndIn)}" from each end for the cotter pin; collar and cotter pin). The OD of DOM tube is held to about +-0.005", close enough for the wheel bearings: check the fit with the wheel before ordering the lot. Yield about ${p.axleTubeYieldPsi / 1000} ksi (confirm the cert). Clamp bolts: snug plus a quarter turn, re-check them before each event (the oak creeps); do not over-torque`;
  return `McMaster-Carr (${d}" solid 1045 / CDS steel rod (cut to length): 1045 cold-drawn or turned-ground-polished shafting, yield ${p.axleYieldPsi / 1000} ksi or better per the cert; NOT hot-rolled A36 (36 ksi) and NOT 1018 cold-drawn (about 54 ksi). Cut ${f2(lengthIn)}" long; drill a ${hole} cross hole ${f2(p.axleCrossHoleFromEndIn)}" from each end for the cotter pin; collar and cotter pin)`;
}

/** A note for the part: the section, the cross holes and the rust care. */
export function axleStockNote(p: Params): string {
  if (p.axleWallIn > 0)
    return `D-60: hollow ${frac(p.axleDiameterIn)}" OD x ${p.axleWallIn.toFixed(3)}" wall DOM tube instead of solid rod (mass about ${Math.round((1 - ((p.axleDiameterIn - 2 * p.axleWallIn) / p.axleDiameterIn) ** 2) * 100)}% less, section modulus ${Math.round((1 - ((p.axleDiameterIn - 2 * p.axleWallIn) / p.axleDiameterIn) ** 4) * 100)}% of the rod's); a ${p.axleCrossHoleDiaIn.toFixed(3)}" cross hole ${f2(p.axleCrossHoleFromEndIn)}" from each end takes the cotter pin (net section, pin bearing and tear-out are checked); mild steel rusts inside: oil or paint the bore and plug or cap the ends.`;
  return `D-71: ${frac(p.axleDiameterIn)}" solid 1045 / CDS steel rod, cut to length (no end plugs: it is solid); a ${p.axleCrossHoleDiaIn.toFixed(3)}" cross hole ${f2(p.axleCrossHoleFromEndIn)}" from each end takes the cotter pin. Bare steel rusts: wipe it with oil or paint it, and keep the bearing surface clean.`;
}
