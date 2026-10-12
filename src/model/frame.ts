/**
 * Frame (D-54): two straight ladder rails flush under the chines, the crossmembers (joists) that carry the deck, and the oak axle hangers that drop from each rail to the
 * rear axle beam. The front pivot (D-56): the rails are only `railDepthF` deep ahead of `railStepX` so the swinging front axle beam passes under them; the KING BEAM is
 * a crossmember between the rails at the kingpin, and the crossmember just behind it is the anchor of the two steering check chains (D-58). (No front hangers: the front beam is not seated in the
 * rails.) Joinery records (Dominos, loose tenons, glue) are added in joinery.ts.
 *
 * Side-to-frame tie (build review M6, D-43): the ladder rails run FLUSH UNDER THE CHINES (outer face at hw + side), not inboard of them, so the
 * chine bears on the rail top and is Domino-tied and epoxied to it every `chineTieSpacingIn`.
 */
import { beamSeat, localPoint, railSection } from './rear-mount';
import { IN3_PER_FT3, STEP, box, span, SIDES, woodMassLb, type Ctx } from './build-utils';
import { customPart } from './mesh-utils';
import { planWallGeometry } from './plan-wall';
import { brakeGeometry } from './brake-layout';
import type { Part, Vec2 } from './types';

/** Part id of the joist at index i of `L.joistX` (the king beam is the one at the kingpin). */
export const joistId = (L: { joistX: number[]; king: { x: number } }, i: number): string => (L.joistX[i] === L.king.x ? 'king-beam' : `joist-${i + 1}`);

/** |y| range of a ladder rail: flush under the chine, outer face at the hull's outer face (D-43). */
export const ladderRailY = (hw: number, side: number, railT: number): [number, number] => [hw + side - railT, hw + side];

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

export function buildFrame(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const jD = p.crossmemberDepthIn;
  const railT = p.railThicknessIn;
  const railD = p.railDepthIn;
  const rearTx = L.xRear + L.transom;
  const fxOf = (v: number) => v;
  void IN3_PER_FT3;
  const [rY0, rY1] = ladderRailY(L.hwC, L.side, railT);
  const seat = beamSeat(p, L);

  // ── Rails: straight oak bars from the rear transom to the end of the flat deck, shallower ahead of the front-axle swath (D-56) ──
  for (const { s, tag } of SIDES) {
    const zb = L.railTop - railD, zbF = L.railTop - L.railDepthF;
    const x0 = rearTx, x1 = L.railEnd, xs = L.railStepX;
    // Relief notch (D-56: the deck is only 8 in up, so the 3 in rail reaches below the rear axle beam top): cut up from the rail bottom where the beam passes under the rail,
    // 1/16 in clear of the beam. (The D-57 step brake needs no notch: its knee bolts to the rail bottom band.)
    const notches: { x0: number; x1: number; z: number }[] = [];
    if (L.beamR.top + 0.0625 > zb) notches.push({ x0: L.beamR.x - L.beamR.thick / 2 - 0.0625, x1: L.beamR.x + L.beamR.thick / 2 + 0.0625, z: L.beamR.top + 0.0625 });
    notches.sort((a, b) => a.x0 - b.x0);
    for (const n of notches) n.x0 = Math.max(n.x0, x0); // a notch cannot start behind the rail's rear end
    for (let i = notches.length - 1; i >= 0; i--) if (notches[i].x1 <= notches[i].x0 + 1e-6) notches.splice(i, 1);
    const bottomEdge: Vec2[] = [[x0, zb], ...notches.flatMap((n): Vec2[] => [[n.x0, zb], [n.x0, n.z], [n.x1, n.z], [n.x1, zb]])];
    const outline: Vec2[] = L.railDepthF < railD - 1e-6
      ? [...bottomEdge, [xs - 1.5, zb], [xs, zbF], [x1, zbF], [x1, L.railTop], [x0, L.railTop]]
      : [...bottomEdge, [x1, zb], [x1, L.railTop], [x0, L.railTop]];
    let a2 = 0, per = 0;
    for (let i = 0; i < outline.length; i++) { const [px, pz] = outline[i], [qx, qz] = outline[(i + 1) % outline.length]; a2 += px * qz - qx * pz; per += Math.hypot(qx - px, qz - pz); }
    const area = Math.abs(a2) / 2;
    const mass = woodMassLb(p, area * railT, 2 * area + per * railT, p.oakDensityPcf);
    const stock = { t: railT, w: railD, l: x1 - x0 };
    const rail = customPart(ctx, {
      id: `rail-${tag}`, partNo: 'rail', name: `Rail ${tag}`, group: 'frame', kind: 'lumber', material: 'white oak',
      geometry: planWallGeometry(outline, railT, (x) => s * ((rY0 + rY1) / 2 - L.turnIn(x))), transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      massLb: mass, fab: 'table-saw', step: STEP.frame, grain: 'x', stock, rough: { t: railT + p.millingAllowanceIn, w: railD + p.millingAllowanceIn, l: stock.l + 4 * p.millingAllowanceIn }, explode: [fxOf(0.6), s * 0.3, -0.6],
    });
    rail.notes = `${f2(railT)}" × ${f2(railD)}" oak bar, straight behind the bow turn-in and ${p.bowTurnInIn > 0 ? `eased in with the hull over the last ${p.bowTurnLenIn}" (${p.bowTurnInIn}" each side at the bulkhead, D-57; cold-bent flat in 2 plies on the same plan form as the chine, the step and notches cut after bending)` : 'straight'}, ${f2(L.railEnd - rearTx)}" long from the rear transom's inner face to the end of the flat deck, outer face flush under the chine so the chine sits on it all the way (D-43). ${L.railDepthF < railD - 1e-6 ? `Ahead of x = ${f2(L.railStepX)}" it steps (45 degree ramp) down to ${f2(L.railDepthF)}" deep so the front axle beam, swinging ±${p.steerLockDeg}° about the kingpin, passes under it with 0.4" to spare (D-56). ` : ''}Its top is flush with the chine bottom AND the deck underside (one deck level, D-52): the deck bonds to the rail top and its edge enters the chine's rabbet. The chine sits on the top of the rail's outer ${L.side}" and is Domino-tied (vertical Dominos) and epoxied to it every ${p.chineTieSpacingIn}". Frame + deck are one glued unit, turned over and lowered into the inverted side assemblies. The rear axle hangers are bolted and glued to its inner face (${seat ? 'axle-hanger-' + tag : 'no hanger'}).`;
    parts.push(rail);
  }

  // ── Rear axle hangers (D-54): the rails stand above the axle beam, so an oak hanger on the inside of each rail carries the beam's seat (the D-48 notch and hold-down angle).
  //    (The front axle is NOT seated in the rails: it pivots under the king beam, D-56.) ──
  const axles = [{ beam: L.beamR, pre: 'axle-hanger', label: 'Rear', beamId: 'beam-R' }] as const;
  const hangerAt = (x: number) => axles.some((a) => Math.abs(x - a.beam.x) < p.axleHangerWidthIn / 2 + L.joistT / 2);
  for (const a of axles) {
    const sa = beamSeat(p, L, a.beam);
    if (!sa) continue;
    const rsa = railSection(p, L, a.beam);
    const hx0 = a.beam.x - p.axleHangerWidthIn / 2, hx1 = a.beam.x + p.axleHangerWidthIn / 2;
    const notchLb = ((sa.x1 - sa.x0) * sa.depth * rsa.t / 1728) * p.oakDensityPcf;
    for (const { s, tag } of SIDES) {
      const yOut = rsa.yOut, yIn = rsa.yIn; // |y| of the hanger's outer face (= the rail's inner face) and its inner face
      const hg = box(ctx, {
        id: `${a.pre}-${tag}`, partNo: a.pre, name: `${a.label} axle hanger ${tag}`, group: 'frame', mat: 'oak', step: STEP.gear, grain: 'z',
        ...span([hx0, hx1], s > 0 ? [yIn, yOut] : [-yOut, -yIn], [rsa.zBot, rsa.zSolidTop]),
      });
      hg.massLb -= notchLb;
      hg.joints = [
        { type: 'dado', to: a.beamId, count: 1, size: `${f2(sa.x1 - sa.x0)}" wide × ${f2(sa.depth)}" deep notch up from the hanger bottom (beam ${f2(a.beam.thick)}" + ${f2(p.beamNotchClearIn)}" each side), ceiling bears on the beam top`, at: [localPoint(hg.transform, [a.beam.x, (yOut + yIn) / 2 * s, sa.zBot + sa.depth / 2])], note: 'the beam passes under the rail and the hanger sits on it; bandsaw + chisel, corners relieved with a 1/4" radius' },
      ];
      hg.notes = `${a.label} axle hanger (D-54): ${f2(p.axleHangerWidthIn)}" × ${f2(rsa.t)}" oak, vertical grain, from the rail top (${f2(rsa.zSolidTop)}") down to ${f2(rsa.zBot)}", glued and bolted to the INSIDE face of the rail. The bottom is notched ${f2(sa.x1 - sa.x0)}" × ${f2(sa.depth)}" so it straddles the axle beam and bears on its top (D-48 seat); ${f2(sa.remain)}" of oak is left above the notch. The 316 hold-down angle lies against its inner face.`;
      parts.push(hg);
    }
  }

  // ── Joists: between the rails, under the deck. A joist that meets a hanger is cut back to the hanger's inner face. The one at the kingpin is the KING BEAM (D-56). ──
  L.joistX.forEach((x, i) => {
    const isKing = x === L.king.x;
    const meetsHanger = hangerAt(x);
    const bkr = brakeGeometry(p, L).backer; // the step brake's oak backers on the rail inner faces (D-57): a joist that meets one is cut back to its inner face
    const meetsBacker = x + L.joistT / 2 > bkr.x0 && x - L.joistT / 2 < bkr.x1;
    const half = rY0 - L.turnIn(x + (x === L.king.x ? L.king.len : L.joistT) / 2) - (meetsHanger ? p.axleHangerThickIn : 0) - (meetsBacker && !meetsHanger ? bkr.t : 0);
    if (isKing) {
      const k = L.king;
      const kb = box(ctx, {
        id: 'king-beam', partNo: 'king-beam', name: 'King beam (kingpin crossmember)', group: 'front-end', mat: 'oak', step: STEP.frame, grain: 'y',
        ...span([k.x - k.len / 2, k.x + k.len / 2], [-half, half], [k.bot, k.top]),
      });
      kb.notes = `The front load path (D-56): an oak crossmember ${f2(k.len)}" fore-aft × ${f2(k.depth)}" deep between the rails at the kingpin, bonded to the deck underside and Domino-tied and epoxied to the rails. The ${f2(p.kingpinDiaIn)}" kingpin bolt is bored through its center; a slot cut from the front face (about ${f2(p.kingpinDiaIn * 1.6)}" wide × ${f2(p.kingpinDiaIn * 1.2)}" tall, just above the thrust disc) captures the nylock nut and its washer so they can swing with the axle. The UHMW thrust disc is screwed to its underside and the top of the axle beam turns under it (D-58); the clamp plates on the beam top pass under the king beam with 1/8 in to spare.`;
      parts.push(kb);
      return;
    }
    const isChain = x === L.chain.joistX && x !== L.king.x;
    const jt = isChain ? L.chain.joistT : L.joistT;
    parts.push(box(ctx, {
      id: joistId(L, i), partNo: isChain ? 'chain-joist' : 'joist', name: `Crossmember ${i + 1}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'y',
      ...span([x - jt / 2, x + jt / 2], [-half, half], [L.deckBot - jD, L.deckBot]),
      ...(x === L.joistX[L.joistX.length - 1] ? { notes: 'The last joist, under the scarf of the deck to the bow bulkhead (D-54, D-57).' } : {}),
      ...(isChain ? { notes: `The chain joist (D-58): ${f2(jt)}" thick (the others are ${f2(L.joistT)}") because the two steering check chains are anchored to it, ${f2(Math.abs(L.chain.anchor[1]))}" either side of the center line, by forged eye bolts through it (the eyes stand out of the front face, the 2" washers and nuts are on the rear face). The chain pull is plan bending toward the rails. ` } : {}),
      ...(meetsHanger || meetsBacker ? { notes: `${meetsHanger ? `Cut back ${f2(p.axleHangerThickIn)}" at each end to clear an axle hanger. ` : ''}${meetsBacker && !meetsHanger ? `Cut back ${f2(bkr.t)}" at each end to clear the brake knee backers (D-57). ` : ''}` } : {}),
    }));
  });

  return parts;
}

