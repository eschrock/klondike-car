/**
 * Frame: ladder rails or hull-beam girders, plus crossmembers/joists (D-17). Joinery records (Dominos, loose tenons, glue) are added in joinery.ts.
 *
 * Side-to-frame tie (build review M6, D-43): the ladder rails run FLUSH UNDER THE CHINES (outer face at hw + side), not inboard of them, so the
 * chine bears on the rail top and is Domino-tied and epoxied to it every `chineTieSpacingIn`; the hull-girder frame already sits under the chine.
 */
import { FRAME_STYLE } from '../params';
import { beamLayout } from './brake-layout';
import { beamSeat, boltLength, inchesText, localPoint, railSection } from './rear-mount';
import { IN3_PER_FT3, STEP, bandPart, box, span, SIDES, type Ctx } from './build-utils';
import { sidePath } from './layout';
import { FRONT_RAIL_REMAIN_MIN_IN, frontBeamSeat } from './front-mount';
import { frameMat } from './body';

/** |y| range of a ladder rail: flush under the chine, outer face at the hull's outer face (D-43). */
export const ladderRailY = (hw: number, side: number, railT: number): [number, number] => [hw + side - railT, hw + side];
import type { Mat4, Part, Vec2, Vec3 } from './types';

/**
 * D-45/D-52 frame: the cabin rail (or girder) is one bent lamination from the rear transom to x = xn, following the plan curve with its outer face
 * flush under the chine; the straight nose rail is scarfed on at xn and runs to the front transom, notched for the front beam. One deck level: no step and
 * no shoulder beam. Joists in the curve and in the bow are cut to the rail's inner face.
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
  /** Offset from the web plane of the member's inner face. */
  const dInner = ladder ? L.side / 2 - railT : -L.side / 2;

  // ── Rear end (D-48, D-53): the rail is notched from below for the brake beam (it slides in the notch; a keeper strap under the notch carries it) and for the rear
  // axle beam; the beam is held down by an angle bracket inside each rail. Geometry from brake-layout.ts and rear-mount.ts.
  const bl = beamLayout(p, L.r, railSection(p, L).zBot, railSection(p, L).xEnd);
  const seat = beamSeat(p, L);
  const shaftNotchVol = (bl.notch.x1 - bl.notch.x0) * (bl.notch.top - railSection(p, L).zBot) * railSection(p, L).t;
  const cutLb = ((shaftNotchVol + (seat?.volume ?? 0)) / IN3_PER_FT3) * p.oakDensityPcf;
  const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
  const finishRail = (part: Part, s: 1 | -1, tag: 'L' | 'R'): Part => {
    const notes: string[] = [];
    const rr = railSection(p, L);
    const yMid = s * (rr.yOut - rr.t / 2);
    const joints = (part.joints ??= []);
    {
      const zb = rr.zBot;
      const w = bl.notch.x1 - bl.notch.x0, h = bl.notch.top - zb;
      joints.push({
        type: 'dado', to: 'brake-beam', count: 1, size: `${f2(w)}" wide x ${f2(h)}" high notch up from the rail bottom, x ${f2(bl.notch.x0)} to ${f2(bl.notch.x1)}`,
        at: [localPoint(part.transform, [(bl.notch.x0 + bl.notch.x1) / 2, yMid, zb + h / 2])], note: 'the brake beam slides in the notch (it is the guide); a keeper strap screwed across the notch bottom carries it',
      });
      joints.push({
        type: 'screw', to: `brake-keeper-${tag}`, count: 4, diaIn: 0.19, size: '4 x #10 x 1-1/2" stainless wood screws up into the rail bottom, two each side of the notch',
        at: [bl.notch.x0 - 0.5, bl.notch.x1 + 0.5].flatMap((x) => [yMid - 0.15, yMid + 0.15].map((yy) => localPoint(part.transform, [x, yy, zb]))),
      });
      notes.push(`REAR END (D-53): underside notched ${f2(w)}" wide x ${f2(h)}" high for the brake beam (x ${f2(bl.notch.x0)} to ${f2(bl.notch.x1)}, open at the bottom: a bandsaw cut and a chisel; ${f2(bl.railEndWall)}" of air is left between the beam and the transom, ${f2(rr.zSolidTop - bl.notch.top)}" under the deck ledge). The beam slides ${f2(bl.stroke)}" in it; epoxy-seal the notch walls.`);
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
        extraLb: -cutLb,
        plies: Math.max(1, Math.round(railT / strip)), step: STEP.frame, grain: 'x',
        notes: `Bent lamination (${Math.max(1, Math.round(railT / strip))} plies of ${strip}") from the rear transom face along the plan S-curve to x = ${L.xn.toFixed(1)}", outer face flush under the chine (the rail follows the chine, so the chine sits on it all the way, D-43/D-45); inside radius ${(L.hull.minRadius - L.side / 2 - railT / 2 + dRail * 0).toFixed(1)}" vs ${(p.hullLamMinRadiusFactor * strip).toFixed(1)}" limit. The rail's top is flush with the chine bottom AND the deck underside (one deck level, D-52): no ledge, no relief; the deck bonds to the rail top and its edge enters the chine's rabbet. The chine sits on the top of the rail's outer ${L.side}" and is Domino-tied (vertical Dominos) and epoxied to it every ${p.chineTieSpacingIn}"; the deck bonds to the rail top. Frame + deck are one glued unit, turned over and lowered into the inverted side assemblies. Scarfed (1:8, ${(8 * railT).toFixed(0)}") to the nose rail at x = ${L.xn.toFixed(1)}", in the straight bow run.`,
      }), s, tag));
      if (L.noseRailEnd - L.xn > 0.5) {
        // The nose rail (D-52) follows the straight bow run, outer face flush under the chine, from the scarf at xn to the front transom's inner face.
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
      }
    } else {
      // Hull-as-beam: the cabin side girder is deepened by railDepth. The nose is not deepened, because the steered axle beam sweeps under it.
      parts.push(finishRail(bandPart(ctx, {
        id: `girder-cabin-${tag}`, partNo: 'girder-cabin', name: `Cabin side girder ${tag}`, group: 'frame', mat: 'oak', s, path, t: L.side, h: hRail, zc: zRail,
        extraLb: -cutLb,
        plies: Math.max(1, Math.round(L.side / strip)), step: STEP.frame, grain: 'x',
        notes: 'Bent lamination under the chine from the rear transom face to x = xn, following the plan S-curve (D-45); epoxy-laminated under the chine and Domino-tied to it (D-43), joined to the crossmembers with loose tenons (the girder is only the chine thickness).',
      }), s, tag));
    }
  }

  // Crossmembers / joists, between the rails (ladder) or the side girders (hull). In the S-curve the joist is cut to the member's inner face at its narrowest point.
  const innerAt = (x0: number, x1: number) => Math.min(...sidePath(L, dInner, x0, x1).map((q) => q[1]));
  L.cabinJoistX.forEach((x, i) => {
    const half = innerAt(x - L.joistT / 2, x + L.joistT / 2);
    parts.push(box(ctx, {
      id: `joist-cabin-${i + 1}`, partNo: 'joist-cabin', name: `Cabin crossmember ${i + 1}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'y',
      ...span([x - L.joistT / 2, x + L.joistT / 2], [-half, half], [L.deckBot - jD, L.deckBot]),
      ...(half < L.hwC + (ladder ? L.side - railT : 0) - 1e-6 ? { notes: `In the S-curve: ends cut square to the joist and the rail inner face is ${half.toFixed(2)}" off the centerline here (the length is cut to the narrowest point under the joist; fill the wedge gap with thickened epoxy).` } : {}),
    }));
  });
  // Nose joists (D-52 integration): the center linkage corridor (Layout.front.keepOut.center: the bellcrank, links, tongue ear and hinge clevis stand up to 0.38" under
  // the deck) leaves no room for a joist across the middle, so each nose joist is cut into a left and a right piece from the rail inner face to the nose stringer.
  const ns = L.noseStringers;
  L.noseJoistX.forEach((x, i) => {
    // The bow converges, so a nose joist is cut to the rail's inner face at its narrowest point, like the cabin joists in the curve.
    const half = innerAt(x - L.joistT / 2, x + L.joistT / 2);
    if (half < ns.y1 + 0.5) return;
    for (const { s, tag } of SIDES) {
      parts.push(box(ctx, {
        id: `joist-nose-${i + 1}-${tag}`, partNo: 'joist-nose', name: `Nose crossmember ${i + 1} ${tag}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'y',
        ...span([x - L.joistT / 2, x + L.joistT / 2], [Math.min(s * ns.y1, s * half), Math.max(s * ns.y1, s * half)], [L.deckBot - jD, L.deckBot]),
        notes: `Half of a nose crossmember, from the nose stringer to the rail (the center ${f2(2 * ns.y0)}" is the steering-linkage corridor under the deck, so no joist crosses it). It straddles the front beam (beam-F stands in the joist depth: the joist on each side of it, like the rear beam, D-47). Ends cut square; the bow rail inner face is ${half.toFixed(2)}" off the centerline at the narrow end (fill the wedge gap with thickened epoxy).`,
      }));
    }
  });
  // Nose stringers: fore-aft oak beside the corridor, carrying the deck across the middle where no joist can; in runs either side of the front beam.
  ns.runs.forEach(([xa, xb], k) => {
    if (xb - xa < 1) return;
    for (const { s, tag } of SIDES) {
      parts.push(box(ctx, {
        id: `stringer-nose-${tag}${k + 1}`, partNo: 'stringer-nose', name: `Nose stringer ${tag}${k + 1}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'x',
        ...span([xa, xb], [Math.min(s * ns.y0, s * ns.y1), Math.max(s * ns.y0, s * ns.y1)], [L.deckBot - jD, L.deckBot]),
        notes: `${f2(L.joistT)}" × ${f2(jD)}" oak glued to the deck underside ${f2(ns.y0)}" off the centerline, just outside the steering-linkage corridor (Layout.front.keepOut.center), so the nose deck is carried across the middle by two stringers ${f2(2 * ns.y0 - 0.1)}" apart instead of by joists. The ${k === 0 ? 'rear' : 'front'} run ${k === 0 ? 'ends at the front beam gap' : 'starts at the front beam gap'}; the beam passes between the straddling joists. The nose joist halves butt against its outer face.`,
      }));
    }
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
  return parts;
}
