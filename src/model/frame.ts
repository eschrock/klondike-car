/** Frame: ladder rails or hull-beam girders, plus crossmembers/joists (D-17). */
import { FRAME_STYLE } from '../params';
import { STEP, box, span, SIDES, type Ctx } from './build-utils';
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
      // Cabin rail, inboard of the side, top at the deck underside.
      parts.push(box(ctx, {
        id: `rail-cabin-${tag}`, partNo: 'rail-cabin', name: `Cabin rail ${tag}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'x',
        ...span([L.xRear + L.side, L.xs], [s * (L.hwC - railT), s * L.hwC].sort((a, b) => a - b) as [number, number], [L.deckBot - railD, L.deckBot]),
      }));
      // Nose rail: raised with the nose deck; stops short of the turntable swing zone.
      if (L.noseRailEnd - L.xs > 0.5) {
        parts.push(box(ctx, {
          id: `rail-nose-${tag}`, partNo: 'rail-nose', name: `Nose rail ${tag}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'x',
          ...span([L.xs, L.noseRailEnd], [s * (L.hwN - railT), s * L.hwN].sort((a, b) => a - b) as [number, number], [L.noseBot - railD, L.noseBot]),
          notes: 'Ends clear of the swinging turntable corners (D-12); the bolster carries the deck beyond.',
        }));
      }
    } else {
      // Hull-as-beam: the cabin side girder is deepened by railDepth. The nose is not deepened,
      // because the steered axle beam sweeps under it.
      parts.push(box(ctx, {
        id: `girder-cabin-${tag}`, partNo: 'girder-cabin', name: `Cabin side girder ${tag}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'x',
        ...span([L.xRear, L.xs], [s * L.hwC, s * (L.hwC + L.side)].sort((a, b) => a - b) as [number, number], [L.deckBot - railD, L.deckBot]),
      }));
    }
  }

  // Crossmembers / joists, between the rails (ladder) or the side girders (hull).
  const cabinSpan = ladder ? L.hwC - railT : L.hwC;
  const noseSpan = ladder ? L.hwN - railT : L.hwN;
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
