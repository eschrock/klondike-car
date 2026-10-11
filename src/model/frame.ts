/**
 * Frame: ladder rails or hull-beam girders, plus crossmembers/joists (D-17). Joinery records (Dominos, loose tenons, glue) are added in joinery.ts.
 *
 * Side-to-frame tie (build review M6, D-43): the ladder rails run FLUSH UNDER THE CHINES (outer face at hw + side), not inboard of them, so the
 * chine bears on the rail top and is Domino-tied and epoxied to it every `chineTieSpacingIn`; the hull-girder frame already sits under the chine.
 */
import { FRAME_STYLE } from '../params';
import { STEP, box, span, SIDES, type Ctx } from './build-utils';

/** |y| range of a ladder rail: flush under the chine, outer face at the hull's outer face (D-43). */
export const ladderRailY = (hw: number, side: number, railT: number): [number, number] => [hw + side - railT, hw + side];
import type { Part } from './types';

export function buildFrame(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const ladder = p.frameStyle === FRAME_STYLE.ladder;
  const jD = p.crossmemberDepthIn;
  const railT = p.railThicknessIn;
  const railD = p.railDepthIn;

  for (const { s, tag } of SIDES) {
    if (ladder) {
      // Cabin rail: flush under the chine (outer face at the hull's outer face), top at the deck underside; the chine bears on it (D-43).
      const [rc0, rc1] = ladderRailY(L.hwC, L.side, railT);
      parts.push(box(ctx, {
        id: `rail-cabin-${tag}`, partNo: 'rail-cabin', name: `Cabin rail ${tag}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'x',
        ...span([L.xRear + L.transom, L.xs], [s * rc0, s * rc1].sort((a, b) => a - b) as [number, number], [L.deckBot - railD, L.deckBot]),
        notes: `Runs flush under the chine: the chine sits on the top of the rail's outer ${L.side}" and is Domino-tied and epoxied to it every ${p.chineTieSpacingIn}" (side-to-frame tie, D-43); the deck bonds to the rail top. Frame + deck are one glued unit before the sides slide on.`,
      }));
      // Nose rail: raised with the nose deck; stops short of the turntable swing zone.
      if (L.noseRailEnd - L.xs > 0.5) {
        const [rn0, rn1] = ladderRailY(L.hwN, L.side, railT);
        parts.push(box(ctx, {
          id: `rail-nose-${tag}`, partNo: 'rail-nose', name: `Nose rail ${tag}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'x',
          ...span([L.xs, L.noseRailEnd], [s * rn0, s * rn1].sort((a, b) => a - b) as [number, number], [L.noseBot - railD, L.noseBot]),
          notes: 'Runs flush under the nose chine (D-43). Ends clear of the swinging turntable corners (D-12); the bolster carries the deck beyond.',
        }));
      }
    } else {
      // Hull-as-beam: the cabin side girder is deepened by railDepth. The nose is not deepened,
      // because the steered axle beam sweeps under it.
      parts.push(box(ctx, {
        id: `girder-cabin-${tag}`, partNo: 'girder-cabin', name: `Cabin side girder ${tag}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'x',
        ...span([L.xRear + L.transom, L.xs], [s * L.hwC, s * (L.hwC + L.side)].sort((a, b) => a - b) as [number, number], [L.deckBot - railD, L.deckBot]),
        notes: 'Runs from the rear transom face (full-width transom, D-35) to the shoulder; epoxy-laminated under the chine and Domino-tied to it (D-43), joined to the crossmembers with loose tenons (the girder is only the chine thickness).',
      }));
    }
  }

  // Crossmembers / joists, between the rails (ladder) or the side girders (hull).
  const cabinSpan = ladder ? L.hwC + L.side - railT : L.hwC;
  const noseSpan = ladder ? L.hwN + L.side - railT : L.hwN;
  L.cabinJoistX.forEach((x, i) => {
    parts.push(box(ctx, {
      id: `joist-cabin-${i + 1}`, partNo: 'joist-cabin', name: `Cabin crossmember ${i + 1}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'y',
      ...span([x - L.joistT / 2, x + L.joistT / 2], [-cabinSpan, cabinSpan], [L.deckBot - jD, L.deckBot]),
    }));
  });
  L.noseJoistX.forEach((x, i) => {
    parts.push(box(ctx, {
      id: `joist-nose-${i + 1}`, partNo: 'joist-nose', name: `Nose crossmember ${i + 1}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'y',
      ...span([x - L.joistT / 2, x + L.joistT / 2], [-noseSpan, noseSpan], [L.noseBot - jD, L.noseBot]),
    }));
  });
  return parts;
}
