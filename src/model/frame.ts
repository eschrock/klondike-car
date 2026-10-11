/**
 * Frame: ladder rails or hull-beam girders, plus crossmembers/joists (D-17). Joinery records (Dominos, loose tenons, glue) are added in joinery.ts.
 *
 * Side-to-frame tie (build review M6, D-43): the ladder rails run FLUSH UNDER THE CHINES (outer face at hw + side), not inboard of them, so the
 * chine bears on the rail top and is Domino-tied and epoxied to it every `chineTieSpacingIn`; the hull-girder frame already sits under the chine.
 */
import { FRAME_STYLE } from '../params';
import { STEP, bandPart, box, span, SIDES, type Ctx } from './build-utils';
import { sidePath } from './layout';

/** |y| range of a ladder rail: flush under the chine, outer face at the hull's outer face (D-43). */
export const ladderRailY = (hw: number, side: number, railT: number): [number, number] => [hw + side - railT, hw + side];
import type { Part } from './types';

/**
 * D-45 frame: the cabin rail (or girder) is one bent lamination from the rear transom to x = xn, following the plan S-curve with its outer face
 * flush under the chine; the straight nose rail is scarfed on at xn (both are at the cabin level: the side lines do not step). A full-width
 * shoulder beam under the deck step ties the two rail pairs together (build review MUST-1). Cabin joists in the curve are cut to the rail's inner face.
 */
export function buildFrame(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const ladder = p.frameStyle === FRAME_STYLE.ladder;
  const jD = p.crossmemberDepthIn;
  const railT = p.railThicknessIn;
  const railD = p.railDepthIn;
  const strip = p.hullLamThicknessIn;
  const rearTx = L.xRear + L.transom;
  /** Offset of the member's centerline from the web plane (outward +): the rail's outer face is flush with the chine's. */
  const dRail = ladder ? (L.side - railT) / 2 : 0;

  /** Rail height: the usual depth below the cabin deck, plus the rise to the chine bottom (captured-ply: the nose deck level, D-45). */
  const hRail = railD + (L.railTop - L.deckBot);
  const zRail = L.railTop - hRail / 2;
  const ledge = L.railTop - L.deckBot; // the cabin deck sits on a ledge notched into the rail's inner face (open at the top)
  const ledgeLb = (len: number) => ((len * p.deckCaptureDepthIn * ledge) / 1728) * p.oakDensityPcf;
  /** Offset from the web plane of the member's inner face. */
  const dInner = ladder ? L.side / 2 - railT : -L.side / 2;

  for (const { s, tag } of SIDES) {
    const path = sidePath(L, dRail, rearTx, L.xn);
    if (ladder) {
      parts.push(bandPart(ctx, {
        id: `rail-cabin-${tag}`, partNo: 'rail-cabin', name: `Cabin rail ${tag}`, group: 'frame', mat: 'oak', s, path, t: railT, h: hRail, zc: zRail,
        extraLb: -ledgeLb(L.xn - rearTx),
        plies: Math.max(1, Math.round(railT / strip)), step: STEP.frame, grain: 'x',
        notes: `Bent lamination (${Math.max(1, Math.round(railT / strip))} plies of ${strip}") from the rear transom face along the plan S-curve to x = ${L.xn.toFixed(1)}", outer face flush under the chine (the rail follows the chine, so the chine sits on it all the way, D-43/D-45); inside radius ${(L.hull.minRadius - L.side / 2 - railT / 2 + dRail * 0).toFixed(1)}" vs ${(p.hullLamMinRadiusFactor * strip).toFixed(1)}" limit. The rail's top is flush with the chine bottom, 1" above the cabin deck: the cabin deck edge sits on a ${p.deckCaptureDepthIn}" ledge notched into the rail's inner face (open at the top, so the deck drops in; the ply edge is against oak); above the deck the rail's inner face is relieved flush with the chine's inner face. The chine sits on the top of the rail's outer ${L.side}" and is Domino-tied (vertical Dominos) and epoxied to it every ${p.chineTieSpacingIn}"; the deck bonds to the rail top. Frame + deck are one glued unit, turned over and lowered into the inverted side assemblies. Scarfed (1:8, ${(8 * railT).toFixed(0)}") to the nose rail at x = ${L.xn.toFixed(1)}"; the shoulder beam Dominos into its inner face just behind that.`,
      }));
      if (L.noseRailEnd - L.xn > 0.5) {
        const [rn0, rn1] = ladderRailY(L.hwN, L.side, railT);
        parts.push(box(ctx, {
          id: `rail-nose-${tag}`, partNo: 'rail-nose', name: `Nose rail ${tag}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'x',
          ...span([L.xn, L.noseRailEnd], [s * rn0, s * rn1].sort((a, b) => a - b) as [number, number], [L.deckBot - railD, L.railTop]),
          notes: `Straight continuation of the cabin rail at the SAME height (the side lines do not step, D-45), flush under the nose chine (D-43). Scarfed to the cabin rail at x = ${L.xn.toFixed(1)}". Ends clear of the swinging turntable corners (D-12); beyond it the continuous chine + gunwale + web side beam and the bolster carry the deck.`,
        }));
      }
    } else {
      // Hull-as-beam: the cabin side girder is deepened by railDepth. The nose is not deepened, because the steered axle beam sweeps under it.
      parts.push(bandPart(ctx, {
        id: `girder-cabin-${tag}`, partNo: 'girder-cabin', name: `Cabin side girder ${tag}`, group: 'frame', mat: 'oak', s, path, t: L.side, h: hRail, zc: zRail,
        extraLb: -ledgeLb(L.xn - rearTx),
        plies: Math.max(1, Math.round(L.side / strip)), step: STEP.frame, grain: 'x',
        notes: 'Bent lamination under the chine from the rear transom face to x = xn, following the plan S-curve (D-45); epoxy-laminated under the chine and Domino-tied to it (D-43), joined to the crossmembers with loose tenons (the girder is only the chine thickness).',
      }));
    }
  }

  // Crossmembers / joists, between the rails (ladder) or the side girders (hull). In the S-curve the joist is cut to the member's inner face at its narrowest point.
  const noseSpan = ladder ? L.hwN + L.side - railT : L.hwN;
  const innerAt = (x0: number, x1: number) => Math.min(...sidePath(L, dInner, x0, x1).map((q) => q[1]));
  L.cabinJoistX.forEach((x, i) => {
    const half = innerAt(x - L.joistT / 2, x + L.joistT / 2);
    parts.push(box(ctx, {
      id: `joist-cabin-${i + 1}`, partNo: 'joist-cabin', name: `Cabin crossmember ${i + 1}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'y',
      ...span([x - L.joistT / 2, x + L.joistT / 2], [-half, half], [L.deckBot - jD, L.deckBot]),
      ...(half < L.hwC + (ladder ? L.side - railT : 0) - 1e-6 ? { notes: `In the S-curve: ends cut square to the joist and the rail inner face is ${half.toFixed(2)}" off the centerline here (the length is cut to the narrowest point under the joist; fill the wedge gap with thickened epoxy).` } : {}),
    }));
  });
  L.noseJoistX.forEach((x, i) => {
    parts.push(box(ctx, {
      id: `joist-nose-${i + 1}`, partNo: 'joist-nose', name: `Nose crossmember ${i + 1}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'y',
      ...span([x - L.joistT / 2, x + L.joistT / 2], [-noseSpan, noseSpan], [L.noseBot - jD, L.noseBot]),
    }));
  });
  // Shoulder beam (build review MUST-1, D-45): full width, under the deck step, between the (almost nose-width) rail pairs; the cabin deck butts its
  // rear face (the riser), the nose deck sits on its top. The joint records (joinery.ts) Domino it into both rail pairs.
  if (L.xn - L.xs > 0.2) {
    parts.push(box(ctx, {
      id: 'shoulder-beam', partNo: 'shoulder-beam', name: 'Shoulder beam', group: 'frame', mat: 'oak', step: STEP.frame, grain: 'y',
      ...span([L.xs, L.xn], [-noseSpan, noseSpan], [L.deckBot - jD, L.noseBot]),
      notes: `${L.shoulderBeam}" × ${(2 * noseSpan).toFixed(1)}" × ${(L.noseBot - L.deckBot + jD).toFixed(2)}" oak under the 1" deck step, just behind the end of the S-curve (D-45). Dominoed (vertical, with the frame) into the inner faces of the cabin rails and the nose rails' scarf; its rear face is the visible riser (the cabin deck's banded front edge butts it), its top carries the nose deck and the nose joists. This is the cabin-to-nose load path (MUST-1): rail, beam, rail.`,
    }));
  }
  return parts;
}
