/**
 * Frame: ladder rails or hull-beam girders, plus crossmembers/joists (D-17). Joinery records (Dominos, loose tenons, glue) are added in joinery.ts.
 *
 * Side-to-frame tie (build review M6, D-43): the ladder rails run FLUSH UNDER THE CHINES (outer face at hw + side), not inboard of them, so the
 * chine bears on the rail top and is Domino-tied and epoxied to it every `chineTieSpacingIn`; the hull-girder frame already sits under the chine.
 */
import { BRAKE_TYPE, FRAME_STYLE } from '../params';
import { shaftCenter } from './brake';
import { bearingMount, beamSeat, boltLength, inchesText, localPoint, railSection } from './rear-mount';
import { IN3_PER_FT3, STEP, bandPart, box, span, SIDES, type Ctx } from './build-utils';
import { sidePath } from './layout';
import { FRONT_RAIL_REMAIN_MIN_IN, frontBeamSeat } from './front-mount';
import { frameMat } from './body';

/** |y| range of a ladder rail: flush under the chine, outer face at the hull's outer face (D-43). */
export const ladderRailY = (hw: number, side: number, railT: number): [number, number] => [hw + side - railT, hw + side];
import type { Mat4, Part, Vec2, Vec3 } from './types';

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

  // ── Rear end (build review r2 MUST-3 and MUST-4, D-48): the rail is notched from below for the brake shaft and for the rear axle beam; the brake bearing
  // plates bolt to its outside forward of the shaft notch; the beam is held down by an angle bracket inside each rail. All geometry from rear-mount.ts.
  const tread = p.brakeType === BRAKE_TYPE.tireTread;
  const S = shaftCenter(p, L.r);
  const mount = tread ? bearingMount(p, L, S, [S[0] - p.brakeLeverPivotBehindShaftIn, p.brakeLeverPivotZIn]) : null;
  const seat = beamSeat(p, L);
  const shaftNotchVol = mount ? (mount.notch.x1 - mount.notch.x0) * (mount.notch.top - mount.rail.zBot) * mount.rail.t : 0;
  const cutLb = ((shaftNotchVol + (seat?.volume ?? 0)) / IN3_PER_FT3) * p.oakDensityPcf;
  const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
  const finishRail = (part: Part, s: 1 | -1, tag: 'L' | 'R'): Part => {
    const notes: string[] = [];
    const rr = railSection(p, L);
    const yMid = s * (rr.yOut - rr.t / 2);
    const joints = (part.joints ??= []);
    if (mount) {
      const bolt = p.brakeBearingBoltDiameterIn;
      joints.push({
        type: 'bolt', to: `brake-bearing-plate-${tag}`, count: mount.bolts.length, diaIn: bolt,
        size: `${f2(bolt)}" × ${inchesText(boltLength(p.brakePlateThickIn + mount.rail.t + mount.doubler.t, bolt))} 316 hex bolts, nylock nuts and 1-1/2" fender washers on the inside face`,
        at: mount.bolts.map(([x, z]) => localPoint(part.transform, [x, yMid, z])),
        note: `${mount.xCols.length} columns × 2 rows at ${f2(p.brakeBearingBoltSpacingIn)}" × ${f2(p.brakeBearingBoltRowGapIn)}", first column ${f2(mount.dist.end)}" from the rail end, lower row ${f2(mount.dist.bottom)}" above the rail bottom, upper row ${f2(mount.dist.top)}" below the deck ledge`,
      });
      const w = mount.notch.x1 - mount.notch.x0, h = mount.notch.top - mount.rail.zBot;
      joints.push({
        type: 'dado', to: 'brake-shaft', count: 1, size: `${f2(w)}" wide × ${f2(h)}" high notch up from the rail bottom, x ${f2(mount.notch.x0)} to ${f2(mount.notch.x1)}`,
        at: [localPoint(part.transform, [S[0], yMid, mount.rail.zBot + h / 2])], note: 'the cross shaft passes through the notch; the bearing is in the plate outside the rail, so there is no hole in the rail',
      });
      notes.push(`REAR END (D-48): underside notched ${f2(w)}" wide × ${f2(h)}" high for the brake shaft (x ${f2(mount.notch.x0)} to ${f2(mount.notch.x1)}, open at the bottom: a bandsaw cut and a chisel); the ${mount.bolts.length} bearing-plate bolts go through the SOLID rail forward of it (${f2(mount.dist.end)}" from the end, ${f2(mount.dist.bottom)}" above the bottom).`);
    }
    if (seat) {
      const hd = seat.hd;
      joints.push({
        type: 'dado', to: 'beam-R', count: 1, size: `${f2(seat.x1 - seat.x0)}" wide × ${f2(seat.depth)}" deep notch in the rail underside (beam ${f2(L.beamR.thick)}" + ${f2(p.beamNotchClearIn)}" each side), ceiling bears on the beam top`,
        at: [localPoint(part.transform, [L.beamR.x, yMid, seat.zBot + seat.depth / 2])], note: `${f2(seat.remain)}" of the ${f2(seat.remain + seat.depth)}" rail is left above the notch; router or bandsaw + chisel, corners relieved with a 1/4" radius`,
      });
      const bd = hd.boltD;
      joints.push({
        type: 'bolt', to: `beam-hold-down-${tag}`, count: 2, diaIn: bd, size: `${f2(bd)}" × ${inchesText(boltLength(hd.t + rr.t, bd))} 316 hex bolts through the angle's upright leg and the rail, nylock nuts and fender washers on the OUTSIDE face`,
        at: hd.railBolts.map(([x, z]) => localPoint(part.transform, [x, yMid, z])),
      });
      notes.push(`REAR AXLE SEAT (D-48): underside notched ${f2(seat.x1 - seat.x0)}" wide × ${f2(seat.depth)}" deep so the rail bears on the top of the rear axle beam (the rail bottom is ${f2(seat.depth)}" below the beam top); ${f2(seat.remain)}" of rail remains over the notch. Held down by the 316 angle bracket inside the rail (beam-hold-down-${tag}).`);
    }
    if (notes.length) part.notes = `${part.notes ?? ''} ${notes.join(' ')}`.trim();
    return part;
  };

  for (const { s, tag } of SIDES) {
    const path = sidePath(L, dRail, rearTx, L.xn);
    if (ladder) {
      parts.push(finishRail(bandPart(ctx, {
        id: `rail-cabin-${tag}`, partNo: 'rail-cabin', name: `Cabin rail ${tag}`, group: 'frame', mat: 'oak', s, path, t: railT, h: hRail, zc: zRail,
        extraLb: -ledgeLb(L.xn - rearTx) - cutLb,
        plies: Math.max(1, Math.round(railT / strip)), step: STEP.frame, grain: 'x',
        notes: `Bent lamination (${Math.max(1, Math.round(railT / strip))} plies of ${strip}") from the rear transom face along the plan S-curve to x = ${L.xn.toFixed(1)}", outer face flush under the chine (the rail follows the chine, so the chine sits on it all the way, D-43/D-45); inside radius ${(L.hull.minRadius - L.side / 2 - railT / 2 + dRail * 0).toFixed(1)}" vs ${(p.hullLamMinRadiusFactor * strip).toFixed(1)}" limit. ${L.ackHull ? `The rail's top is flush with the chine bottom AND the deck underside (one deck level, D-52): no ledge, no relief; the deck bonds to the rail top and its edge enters the chine's rabbet. ` : `The rail's top is flush with the chine bottom, 1" above the cabin deck: the cabin deck edge sits on a ${p.deckCaptureDepthIn}" ledge notched into the rail's inner face (open at the top, so the deck drops in; the ply edge is against oak); above the deck the rail's inner face is relieved flush with the chine's inner face. `}The chine sits on the top of the rail's outer ${L.side}" and is Domino-tied (vertical Dominos) and epoxied to it every ${p.chineTieSpacingIn}"; the deck bonds to the rail top. Frame + deck are one glued unit, turned over and lowered into the inverted side assemblies. Scarfed (1:8, ${(8 * railT).toFixed(0)}") to the nose rail at x = ${L.xn.toFixed(1)}"${L.ackHull ? ', in the straight bow run' : '; the shoulder beam Dominos into its inner face just behind that'}.`,
      }), s, tag));
      if (L.ackHull && L.noseRailEnd - L.xn > 0.5) {
        // Ackermann hull (D-52): the nose rail follows the straight bow run, outer face flush under the chine, from the scarf at xn to the front transom's inner face.
        const a = s * L.bowHeading;
        const run = sidePath(L, dRail, L.xn, L.noseRailEnd);
        const P0 = run[0], P1 = run[run.length - 1];
        const runLen0 = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
        const runLen = runLen0 - (railT / 2) * Math.abs(Math.sin(a)); // the square end pokes past the transom face at the heading: trimmed (cut at the bevel in the shop)
        const kf = runLen / runLen0 / 2;
        const seatF = frontBeamSeat(p, L);
        const cutF = seatF ? (seatF.volume / IN3_PER_FT3) * p.oakDensityPcf : 0;
        const deg = ((Math.abs(L.bowHeading) * 180) / Math.PI).toFixed(1);
        const rail = box(ctx, {
          id: `rail-nose-${tag}`, partNo: 'rail-nose', name: `Nose rail ${tag}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'x',
          size: [runLen, railT, hRail], center: [P0[0] + (P1[0] - P0[0]) * kf, s * (P0[1] + (P1[1] - P0[1]) * kf), zRail], rot: { z: a },
        });
        rail.massLb -= cutF;
        rail.notes = `Straight bow rail at the SAME height as the cabin rail (the side lines do not step), ${runLen.toFixed(1)}" long, set at ${deg}° to the axis to follow the chine (D-52); outer face flush under the nose chine (D-43). Scarfed (1:8, ${(8 * railT).toFixed(0)}") to the bent cabin rail at x = ${L.xn.toFixed(1)}" in the straight run. Runs to the front transom's inner face, notched from below for the front beam (below).`;
        if (seatF) {
          const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
          const joints = (rail.joints ??= []);
          const bd = seatF.hd.boltD;
          joints.push({
            type: 'dado', to: 'beam-F', count: 1, size: `${f2(seatF.x1 - seatF.x0)}" wide × ${f2(seatF.depth)}" deep notch up from the rail bottom (beam ${f2(L.front.beam.thick)}" + ${f2(p.beamNotchClearIn)}" each side), ceiling bears on the beam top`,
            note: `${f2(seatF.remain)}" of the ${f2(seatF.railH)}" rail is left above the notch (floor ${f2(FRONT_RAIL_REMAIN_MIN_IN)}"); bandsaw + chisel, corners relieved with a 1/4" radius. The beam passes under the rail; no cut in the beam.`,
          });
          joints.push({
            type: 'bolt', to: `front-beam-hold-down-${tag}`, count: 2, diaIn: bd, size: `${f2(bd)}" × ${inchesText(boltLength(seatF.hd.t + seatF.railT, bd))} 316 hex bolts through the angle's upright leg and the rail, nylock nuts and fender washers on the OUTSIDE face`,
          });
          rail.notes += ` FRONT BEAM SEAT (D-52): underside notched ${f2(seatF.x1 - seatF.x0)}" wide × ${f2(seatF.depth)}" deep so the rail bears on the top of the front beam; ${f2(seatF.remain)}" of rail remains over the notch${seatF.ok ? '' : ' (BELOW the 1" floor)'}. Held down by the 316 angle bracket inside the rail (front-beam-hold-down-${tag}).`;
        }
        parts.push(rail);
      } else if (L.noseRailEnd - L.xn > 0.5) {
        const [rn0, rn1] = ladderRailY(L.hwN, L.side, railT);
        parts.push(box(ctx, {
          id: `rail-nose-${tag}`, partNo: 'rail-nose', name: `Nose rail ${tag}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'x',
          ...span([L.xn, L.noseRailEnd], [s * rn0, s * rn1].sort((a, b) => a - b) as [number, number], [L.deckBot - railD, L.railTop]),
          notes: `Straight continuation of the cabin rail at the SAME height (the side lines do not step, D-45), flush under the nose chine (D-43). Scarfed to the cabin rail at x = ${L.xn.toFixed(1)}". Ends clear of the swinging turntable corners (D-12); beyond it the continuous chine + gunwale + web side beam and the bolster carry the deck.`,
        }));
      }
    } else {
      // Hull-as-beam: the cabin side girder is deepened by railDepth. The nose is not deepened, because the steered axle beam sweeps under it.
      parts.push(finishRail(bandPart(ctx, {
        id: `girder-cabin-${tag}`, partNo: 'girder-cabin', name: `Cabin side girder ${tag}`, group: 'frame', mat: 'oak', s, path, t: L.side, h: hRail, zc: zRail,
        extraLb: -ledgeLb(L.xn - rearTx) - cutLb,
        plies: Math.max(1, Math.round(L.side / strip)), step: STEP.frame, grain: 'x',
        notes: 'Bent lamination under the chine from the rear transom face to x = xn, following the plan S-curve (D-45); epoxy-laminated under the chine and Domino-tied to it (D-43), joined to the crossmembers with loose tenons (the girder is only the chine thickness).',
      }), s, tag));
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
    // Ackermann hull: the bow converges, so a nose joist is cut to the rail's inner face at its narrowest point, like the cabin joists in the curve.
    const half = L.ackHull ? innerAt(x - L.joistT / 2, x + L.joistT / 2) : noseSpan;
    parts.push(box(ctx, {
      id: `joist-nose-${i + 1}`, partNo: 'joist-nose', name: `Nose crossmember ${i + 1}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'y',
      ...span([x - L.joistT / 2, x + L.joistT / 2], [-half, half], [L.noseBot - jD, L.noseBot]),
      ...(L.ackHull ? { notes: `Straddles the front beam (beam-F stands in the joist depth: the joist on each side of it, like the rear beam, D-47). Ends cut square; the bow rail inner face is ${half.toFixed(2)}" off the centerline at the narrow end (fill the wedge gap with thickened epoxy).` } : {}),
    }));
  });
  // Hold-down angles for the front beam (D-52, the D-48 pattern): 316 angle inside each nose rail, upright leg bolted through the rail, flat leg down through the beam.
  const seatF = frontBeamSeat(p, L);
  if (seatF) {
    const hd = seatF.hd;
    const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
    for (const { s, tag } of SIDES) {
      const a = s * L.bowHeading; // heading of this rail
      const tdir: Vec3 = [Math.cos(a), Math.sin(a), 0];
      const nOut: Vec3 = [s * -Math.sin(a), s * Math.cos(a), 0]; // outward normal of the rail
      const ezl: Vec3 = [s * tdir[0], s * tdir[1], 0]; // extrusion direction (right-handed with nOut x up)
      const pin: Vec3 = [L.front.beam.x, s * seatF.yIn, 0]; // on the rail's inner face, under the beam centerline
      const origin: Vec3 = [pin[0] - (hd.w / 2) * ezl[0], pin[1] - (hd.w / 2) * ezl[1], 0];
      const m: Mat4 = frameMat(nOut, [0, 0, 1], ezl, origin);
      // Section (u outward from the rail's inner face, z): flat leg on the beam top reaching inboard `leg`, upright leg against the rail face.
      const profile: Vec2[] = [[-hd.leg, hd.zBeam], [0, hd.zBeam], [0, hd.zTop], [-hd.t, hd.zTop], [-hd.t, hd.zBeam + hd.t], [-hd.leg, hd.zBeam + hd.t]];
      const area = hd.t * (2 * hd.leg - hd.t);
      const mass = ((area * hd.w) / IN3_PER_FT3) * p.steelDensityPcf;
      const bd = hd.boltD;
      const modelOf = (u: number, v: number, z: number): Vec3 => [pin[0] + ezl[0] * u + nOut[0] * v, pin[1] + ezl[1] * u + nOut[1] * v, z];
      const part: Part = {
        id: `front-beam-hold-down-${tag}`, partNo: 'front-beam-hold-down', name: `Front beam hold-down angle ${tag}`, group: 'frame', kind: 'metal', material: '316 stainless angle',
        geometry: { type: 'extrusion', outline: profile, depth: hd.w }, transform: m, body: 'chassis', massLb: mass, fab: 'drill-tap', step: STEP.gear,
        explode: [0, -s * 0.8, 0.5], stock: { t: hd.t, w: hd.leg, l: hd.w },
        sourcing: { vendor: `McMaster-Carr (316 stainless angle ${f2(hd.leg)}" × ${f2(hd.leg)}" × ${f2(hd.t)}": cut ${f2(hd.w)}" long on the bandsaw, drill 2 × ${f2(bd + 0.03)}" in the upright leg and 2 × ${f2(bd + 0.03)}" in the flat leg; 4 × 316 hex bolts ${f2(bd)}", nylock nuts, fender washers)` },
        notes: `Holds the front beam to the nose rail (D-52): the upright leg lies on the rail's inner face (z ${f2(hd.zBeam)}" to ${f2(hd.zTop)}", under the deck), two ${f2(bd)}" bolts through the rail; the flat leg lies on the beam top, two ${f2(bd)}" bolts down through both walls of the tube. Stays clear of the straddling deck joists. Rebound and side load are carried here; the vertical load bears on the notch ceiling.`,
        joints: [],
      };
      part.joints!.push({
        type: 'bolt', to: `rail-nose-${tag}`, count: 2, diaIn: bd, size: `${f2(bd)}" × ${inchesText(boltLength(hd.t + seatF.railT, bd))} 316 hex bolts through the upright leg and the rail`,
        at: hd.railBolts.map(([u, z]) => localPoint(m, modelOf(u, -hd.t / 2, z))),
      });
      part.joints!.push({
        type: 'bolt', to: 'beam-F', count: 2, diaIn: bd, size: `${f2(bd)}" × ${inchesText(boltLength(hd.t + L.front.beam.depth, bd))} 316 hex bolts down through the flat leg and both walls of the tube`,
        at: hd.beamBolts.map(([u, v]) => localPoint(m, modelOf(u, -v, hd.zBeam + hd.t / 2))),
      });
      parts.push(part);
    }
  }
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
