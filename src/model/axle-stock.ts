/**
 * Axle stock text (D-60): the rear through axle and the front stub axles are hollow DOM tube (axleWallIn > 0) or, at 0, the old solid 1045 rod. One place for the
 * sourcing line and the shop note so the rear and front parts say the same thing.
 */
import type { Params } from '../params';
import { frac } from './joinery';

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** The stock a piece of `lengthIn` is cut from. */
export function axleSourcing(p: Params, lengthIn: number): string {
  const d = frac(p.axleDiameterIn);
  const hole = `${p.axleCrossHoleDiaIn.toFixed(3)}"`;
  if (p.axleWallIn > 0)
    return `McMaster-Carr (DOM mild-steel round tube, 1020 or 1026, ${d}" OD x ${p.axleWallIn.toFixed(3)}" wall, cut ${f2(lengthIn)}" long; drill a ${hole} cross hole ${f2(p.axleCrossHoleFromEndIn)}" from each end for the cotter pin; collar and cotter pin). The OD of DOM tube is held to about +-0.005", close enough for the wheel bearings: check the fit with the wheel before ordering the lot. Yield about ${p.axleTubeYieldPsi / 1000} ksi (confirm the cert)`;
  return `McMaster-Carr (${d}" 1045 turned-ground-polished shafting, cut ${f2(lengthIn)}" long; drill a ${hole} cross hole ${f2(p.axleCrossHoleFromEndIn)}" from each end; collar and cotter pin)`;
}

/** A note for the part: the section, the cross holes and the rust care. */
export function axleStockNote(p: Params): string {
  if (p.axleWallIn > 0)
    return `D-60: hollow ${frac(p.axleDiameterIn)}" OD x ${p.axleWallIn.toFixed(3)}" wall DOM tube instead of solid rod (mass about ${Math.round((1 - ((p.axleDiameterIn - 2 * p.axleWallIn) / p.axleDiameterIn) ** 2) * 100)}% less, section modulus ${Math.round((1 - ((p.axleDiameterIn - 2 * p.axleWallIn) / p.axleDiameterIn) ** 4) * 100)}% of the rod's); a ${p.axleCrossHoleDiaIn.toFixed(3)}" cross hole ${f2(p.axleCrossHoleFromEndIn)}" from each end takes the cotter pin (net section, pin bearing and tear-out are checked); mild steel rusts inside: oil or paint the bore and plug or cap the ends.`;
  return `Solid 1045 rod; a ${p.axleCrossHoleDiaIn.toFixed(3)}" cross hole ${f2(p.axleCrossHoleFromEndIn)}" from each end takes the cotter pin.`;
}
