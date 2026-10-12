/**
 * The axle stock (D-60): a hollow DOM tube (`axleWallIn` > 0) or, at 0, a solid 1045 rod. One home for its section, its strengths and the rows that exist because it is a tube
 * with a cross hole at each end: the net section and the pin bearing at the cotter-pin hole, and the ring bearing of the thin wall under a clamp plate. Used by the rear axle,
 * the front stub and the resting-load rows.
 */
import type { Params } from '../params';
import { circleSection, tubeSection, type Section } from './beams';
import type { Ctx } from './context';
import { detail } from './dual';
import { f } from './format';
import type { Detail } from './types';

/** Wall thickness actually used (0 = solid, never more than the radius). */
export const axleWall = (p: Params): number => Math.min(Math.max(0, p.axleWallIn), p.axleDiameterIn / 2);
export const axleIsTube = (p: Params): boolean => axleWall(p) > 0;
/** Bending section of the axle: the tube, or the rod when the wall is 0. */
export const axleSection = (p: Params): Section => (axleIsTube(p) ? tubeSection(p.axleDiameterIn, axleWall(p)) : circleSection(p.axleDiameterIn));
/** Yield and ultimate strength of the stock in use. */
export const axleYield = (p: Params): number => (axleIsTube(p) ? p.axleTubeYieldPsi : p.axleYieldPsi);
export const axleUltimate = (p: Params): number => (axleIsTube(p) ? p.axleTubeUltimatePsi : p.axleUltimatePsi);
/** A short label for the row text. */
export const axleWhat = (p: Params): string => (axleIsTube(p) ? `${p.axleDiameterIn}" x ${axleWall(p).toFixed(3)}" wall DOM tube` : `${p.axleDiameterIn}" solid rod`);

/** Material the cross hole passes through, in the load direction (two walls of a tube, or the whole diameter of a rod), in. */
const holeThrough = (p: Params): number => (axleIsTube(p) ? 2 * axleWall(p) : p.axleDiameterIn);
/** Second moment of the material a cross hole of diameter dh removes with its axis in the bending plane (the worst orientation: it takes the extreme fibers), in^4. */
const holeLossI = (p: Params): number => {
  const r = p.axleDiameterIn / 2, ri = r - axleWall(p);
  return (2 / 3) * p.axleCrossHoleDiaIn * (r ** 3 - (axleIsTube(p) ? ri ** 3 : 0));
};

export interface AxleLoads {
  /** Resultant wheel force on the axle (V and H), normal 1 in bump and hard 2 in hit, lbf. */
  Rn: number;
  Rh: number;
  /** Side thrust on the collar and cotter pin (a skid: mu x the wheel's vertical force), normal and hard, lbf. */
  Tn: number;
  Th: number;
  /** Clamp stations that share the wheel force as line contacts along the axle: 1 at the rear, 2 at a front stub. */
  stations: number;
}

/**
 * Rows for the cross hole and the thin wall, appended to the axle's bending rows (normal against yield / SF, hard against ultimate / fail-safe factor):
 *  - the cotter-pin cross hole, which sits outboard of the wheel where the bending moment of a load at the hub is zero; the worst case is taken instead: the whole wheel force at the
 *    outboard edge of the hub, so the moment at the hole is R x (end extra - the hole's distance from the end), on the net section with the hole in the extreme fibers;
 *  - the pin's bearing on the hole wall and the tear-out of the end under the side thrust;
 *  - for a tube: the ring (ovalizing) bending of the wall under the line contact of a clamp plate, a ring under a diametral line load: M = 0.318 P' r, sigma = 6M / t^2.
 */
export function axleHoleDetails(ctx: Ctx, ld: AxleLoads, allowN: number, allowH: number): Detail[] {
  const { p } = ctx;
  const sec = axleSection(p);
  const iNet = Math.max(1e-6, sec.I - holeLossI(p));
  const arm = Math.max(0, p.axleEndExtraIn - p.axleCrossHoleFromEndIn);
  const bendN = (ld.Rn * arm * sec.c) / iNet, bendH = (ld.Rh * arm * sec.c) / iNet;
  const through = holeThrough(p);
  const bear = (T: number) => T / (p.axleCrossHoleDiaIn * through);
  const edge = Math.max(0.01, p.axleCrossHoleFromEndIn - p.axleCrossHoleDiaIn / 2);
  const tear = (T: number) => T / (2 * edge * through);
  const out: Detail[] = [
    detail(`NORMAL cross hole (cotter pin) ${f(p.axleCrossHoleDiaIn, 3)}": net-section bending, wheel force at the hub edge (yield / SF)`, bendN, 'psi', allowN, '<='),
    detail('HARD cross hole: net-section bending (ultimate / fail-safe factor)', bendH, 'psi', allowH, '<='),
    detail(`NORMAL side thrust ${f(ld.Tn)} lbf on the pin: bearing on the hole wall (yield / SF)`, bear(ld.Tn), 'psi', allowN, '<='),
    detail(`NORMAL side thrust: tear-out of the ${f(edge, 3)}" end distance (shear, 0.58 x yield / SF)`, tear(ld.Tn), 'psi', 0.58 * allowN, '<='),
    detail(`HARD side thrust ${f(ld.Th)} lbf: pin bearing (ultimate / fail-safe factor)`, bear(ld.Th), 'psi', allowH, '<='),
    detail('HARD side thrust: tear-out of the end (0.58 x ultimate / fail-safe factor)', tear(ld.Th), 'psi', 0.58 * allowH, '<='),
  ];
  if (axleIsTube(p)) {
    const w = axleWall(p), rm = (p.axleDiameterIn - w) / 2;
    const line = (R: number) => R / (ld.stations * p.clampPlateWidthIn); // lbf per inch of axle length under the plates
    const ring = (R: number) => (6 * 0.318 * line(R) * rm) / (w * w);
    out.push(
      detail(`NORMAL tube wall ring bending under the clamp plates (${ld.stations} line contact${ld.stations > 1 ? 's' : ''} of ${f(p.clampPlateWidthIn, 2)}"; yield / SF)`, ring(ld.Rn), 'psi', allowN, '<='),
      detail('HARD tube wall ring bending under the clamp plates (ultimate / fail-safe factor)', ring(ld.Rh), 'psi', allowH, '<='),
    );
  }
  return out;
}

/** The text that goes into the axle rows' explanation. */
export function axleHoleText(ctx: Ctx, ld: AxleLoads): string {
  const { p } = ctx;
  const arm = Math.max(0, p.axleEndExtraIn - p.axleCrossHoleFromEndIn);
  return `Stock (D-60): ${axleWhat(p)}, yield ${f(axleYield(p), 0)} / ultimate ${f(axleUltimate(p), 0)} psi. Cross hole ${f(p.axleCrossHoleDiaIn, 3)}" ${f(p.axleCrossHoleFromEndIn, 2)}" from the end for the cotter pin: the moment there (wheel force ${f(ld.Rn)} lbf at the hub's outboard edge, arm ${f(arm, 2)}") acts on the net section; side thrust mu x V = ${f(ld.Tn)} lbf (hard ${f(ld.Th)}) bears on the pin and tears out the end.${axleIsTube(p) ? ` The thin wall also takes the clamp plates' line contact as ring bending (${ld.stations} x ${f(p.clampPlateWidthIn, 2)}" long).` : ''}`;
}
