/**
 * Running gear: the four wheels and the REAR axle (through rod or stubs), axle beam and rod clamps (D-10, D-11, D-15). The front axle is the Ackermann front end in
 * front-end.ts (spindles on a steel beam, D-53); the front wheels ride on the knuckle poses.
 */
import { AXLE_BEAM_POSITION, AXLE_STYLE } from '../params';
import { IN3_PER_FT3, STEP, box, cylinder, span, SIDES, type Ctx } from './build-utils';
import { multiply, translation } from './mat4';
import { beamSeat, boltLength, inchesText, localPoint, railSection } from './rear-mount';
import type { Mat4, Part, RigidBody, Vec2, Vec3 } from './types';

// ── Block-model placeholders ──
/** Hub outer diameter as a fraction of the wheel diameter, capped (viewer-only detail). */
const HUB_DIA_FRAC = 0.5;
const HUB_DIA_MAX_IN = 6;
/** Stub axle embedment into the beam (spec: hub + end extra + 4). */
const STUB_EMBED_IN = 4;

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
const unitVec = (v: Vec3): Vec3 => { const n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };

export function buildRunningGear(ctx: Ctx): Part[] {
  const { p, d, L } = ctx;
  const parts: Part[] = [];
  const r = L.r;
  const rodR = p.axleDiameterIn / 2;

  // Wheels
  const wheel = (id: 'wheel-FL' | 'wheel-FR' | 'wheel-RL' | 'wheel-RR', name: string, transform: number[]): Part => ({
    id,
    partNo: 'wheel',
    name,
    group: 'running-gear',
    kind: 'purchased',
    material: p.tireType === 0 ? 'pneumatic tire + hub' : 'flat-free tire + hub',
    geometry: {
      type: 'wheel',
      diameter: p.wheelDiameterIn,
      width: p.tireWidthIn,
      hubDiameter: Math.min(p.wheelDiameterIn * HUB_DIA_FRAC, HUB_DIA_MAX_IN),
      hubLength: p.hubLengthIn,
      bore: id.startsWith('wheel-F') ? (p.spindleStub === 0 ? 17 : 25) / 25.4 : p.axleDiameterIn,
    },
    transform,
    body: id as RigidBody,
    massLb: d.wheelMassLb,
    fab: 'buy',
    step: STEP.gear,
    explode: [0, (id.endsWith('L') ? 1 : -1) / Math.hypot(1, 0.25), -0.25 / Math.hypot(1, 0.25)],
    sourcing: {
      vendor: `McMaster-Carr or equivalent: ${p.wheelDiameterIn}" ${p.tireType === 0 ? 'pneumatic' : 'flat-free'} hand-truck wheel, ${p.axleDiameterIn}" bore, ${p.hubLengthIn}" hub length, sealed ball bearings or flanged bushings pressed into the hub (confirm the bore is ${p.axleDiameterIn}" and the hub length ${p.hubLengthIn}"; D-34). READ THE LOAD RATING OFF THE LISTING: the model assumes ${p.wheelRatingLb} lb per wheel (wheelRatingLb, status verify; the wheel-rating check uses it)`,
    },
    notes: `Catalog wheel mass from params (D-11). Hub spec (M11): ${p.axleDiameterIn}" bore for the ${p.axleDiameterIn}" axle, ${p.hubLengthIn}" hub, sealed ball bearings (or flanged bronze bushings) in the hub; collar + cotter pin on the axle end (${p.axleEndExtraIn}" beyond the hub).`,
  });
  const ry = p.rearTrackIn / 2;
  const fy = p.frontTrackIn / 2;
  parts.push(
    wheel('wheel-RL', 'Rear left wheel', translation(0, ry, r)),
    wheel('wheel-RR', 'Rear right wheel', translation(0, -ry, r)),
    wheel('wheel-FL', 'Front left wheel', multiply(ctx.pose['steer-L'], translation(L.WB, fy, r))),
    wheel('wheel-FR', 'Front right wheel', multiply(ctx.pose['steer-R'], translation(L.WB, -fy, r))),
  );

  // Rear axle, beam and clamps.
  {
    const ax = { tag: 'R' as const, x: 0, track: p.rearTrackIn, beam: L.beamR };
    const name = 'rear';
    if (p.axleStyle === AXLE_STYLE.throughRod) {
      parts.push(cylinder(ctx, {
        id: `axle-${ax.tag}`, name: `${name} axle (through rod)`, group: 'running-gear',
        center: [ax.x, 0, r], axis: 'y', radius: rodR, length: ax.track + p.hubLengthIn + 2 * p.axleEndExtraIn,
        mat: 'steel', fab: 'drill-tap', step: STEP.gear, notes: 'Dead axle, clamped to the beam (D-10). Sits in a groove in the beam.',
      }));
    } else {
      const stubLen = p.hubLengthIn + p.axleEndExtraIn + STUB_EMBED_IN;
      const outer = ax.track / 2 + p.hubLengthIn / 2 + p.axleEndExtraIn;
      for (const { s, tag } of SIDES) {
        parts.push(cylinder(ctx, {
          id: `axle-${ax.tag}${tag}`, partNo: `stub-axle`, name: `${name} ${tag === 'L' ? 'left' : 'right'} stub axle`,
          group: 'running-gear', center: [ax.x, s * (outer - stubLen / 2), r], axis: 'y',
          radius: rodR, length: stubLen, mat: 'steel', fab: 'drill-tap', step: STEP.gear,
          notes: `Embedded ${STUB_EMBED_IN}" into the beam (D-10).`,
        }));
      }
    }
    // Beam
    const b = ax.beam;
    // Rear beam (build review r2 MUST-4, D-48): the rails are notched to bear on its top (see frame.ts) and a 316 angle inside each rail holds it down.
    const seatInfo = beamSeat(p, L);
    const beamRailJoints: Part['joints'] = [];
    if (seatInfo) {
      const rs = railSection(p, L);
      const yRailMid = rs.yOut - rs.t / 2;
      for (const { s, tag } of SIDES) {
        beamRailJoints.push({
          type: 'dado', to: rs.ladder ? `rail-cabin-${tag}` : `girder-cabin-${tag}`, count: 1,
          size: `rail notch ${f2(seatInfo.x1 - seatInfo.x0)}" × ${f2(seatInfo.depth)}": the beam top (z ${f2(b.top)}") bears on the notch ceiling; no cut in the beam`,
          at: [[0, s * yRailMid, b.top - (b.top + b.bot) / 2]],
          note: 'the beam passes under the rail; the rail sits on it',
        });
        beamRailJoints.push({
          type: 'bolt', to: `beam-hold-down-${tag}`, count: seatInfo.hd.beamBolts.length, diaIn: seatInfo.hd.boltD,
          size: `${f2(seatInfo.hd.boltD)}" × ${inchesText(boltLength(seatInfo.hd.t + b.depth, seatInfo.hd.boltD))} 316 hex bolts down through the angle's horizontal leg and the beam, nylock nuts and fender washers under the beam`,
          at: seatInfo.hd.beamBolts.map(([x, y]): Vec3 => [x - b.x, s * y, seatInfo.hd.zBeam - (b.top + b.bot) / 2]),
          note: 'either side of the axle rod',
        });
      }
    }
    parts.push(box(ctx, {
      id: `beam-${ax.tag}`, name: `${name} axle beam`, group: 'running-gear', mat: 'oak',
      size: [b.thick, b.len, b.depth], center: [b.x, 0, (b.top + b.bot) / 2], grain: 'y', fab: 'table-saw',
      step: STEP.gear, notes: (p.axleBeamPosition === AXLE_BEAM_POSITION.underslung ? 'Underslung (D-15).' : 'Overslung (D-15).'),
      ...(seatInfo ? { joints: beamRailJoints } : {}),
    }));
    // Clamps: 2 plates per wheel side (one per bolt), straddling the rod: at rod x ± (rod radius + leg gap).
    const under = p.axleBeamPosition === AXLE_BEAM_POSITION.underslung;
    const plate = { x: p.clampPlateLengthIn, y: p.clampPlateWidthIn, z: p.clampPlateThickIn };
    const legOffset = rodR + p.clampLegGapIn;
    const yEdge = Math.min(b.len / 2 - 0.25, ax.track / 2 - p.tireWidthIn / 2);
    const yc = yEdge - plate.y / 2;
    {
      // REAR clamp plates (build review r2 MUST-4 / S13, eng N-10): 316 stainless flat bar cut to size (0.8" × 1.5" × 3/8"), one 3/8" 316 bolt through each plate and the
      // beam beside the rod; the two plates per wheel side pin the rod in its groove. Real parts with a source and a stock size instead of the old "mass is an estimate" boxes.
      const zc = under ? b.top + plate.z / 2 : b.bot - plate.z / 2;
      const bd = p.uboltRodDiameterIn;
      for (const { s, tag } of SIDES) {
        for (const [i, sx] of [[1, 1], [2, -1]] as const) {
          const sp = span([ax.x + sx * legOffset - plate.x / 2, ax.x + sx * legOffset + plate.x / 2],
            [s * yc - plate.y / 2, s * yc + plate.y / 2], [zc - plate.z / 2, zc + plate.z / 2]);
          const grip = plate.z + b.depth;
          const part = box(ctx, {
            id: `clamp-${ax.tag}${tag}${i}`, partNo: 'axle-clamp', name: `${name} ${tag === 'L' ? 'left' : 'right'} rod clamp plate ${i}`,
            group: 'running-gear', mat: 'steel', kind: 'metal', material: '316 stainless flat bar',
            ...sp, fab: 'drill-tap', step: STEP.gear,
            sourcing: { vendor: `McMaster-Carr (316 stainless flat bar ${plate.z}" × ${plate.y}": cut ${plate.x}" pieces on the bandsaw, drill ${f2(bd + 0.03)}"; 316 hex bolt ${f2(bd)}" × ${inchesText(boltLength(grip, bd))}, nylock nut, fender washer). 316, not zinc (wet tannin oak, S7)` },
            joints: [{
              type: 'bolt', to: `beam-${ax.tag}`, count: 1, diaIn: bd, size: `${f2(bd)}" × ${inchesText(boltLength(grip, bd))} 316 hex bolt down through the plate and the beam, nylock nut + fender washer under the beam`,
              at: [[0, 0, 0]], note: 'beside the axle rod; the plate edge presses the rod shoulder into its groove',
            }],
            notes: `Pins the axle rod in its groove (D-10): ${plate.x}" × ${plate.y}" × ${plate.z}" 316 stainless plate with one ${f2(bd)}" bolt through the beam (grip ${f2(grip)}"). Its mass is now the real plate; the bolt, nut and washer are in the fastener allowance.`,
          });
          parts.push(part);
        }
      }
    }
  }
  // Hold-down angles for the rear beam (MUST-4): 316 angle inside each rail; the upright leg is bolted through the rail, the horizontal leg through the beam.
  const seat = beamSeat(p, L);
  if (seat) {
    const hd = seat.hd;
    const rs = railSection(p, L);
    const w = hd.x1 - hd.x0;
    const bd = hd.boltD;
    for (const { s, tag } of SIDES) {
      // Section in (u = |y| of the point, z); local x = s·model Y offset, local y = z, local z = ±model X (the extrusion runs along the beam's fore-aft width).
      const profile: Vec2[] = [[hd.yFree, hd.zBeam], [hd.yRail, hd.zBeam], [hd.yRail, hd.zTop], [hd.yRail - hd.t, hd.zTop], [hd.yRail - hd.t, hd.zBeam + hd.t], [hd.yFree, hd.zBeam + hd.t]];
      const ox = s > 0 ? hd.x0 : hd.x1;
      const m: Mat4 = [0, s, 0, 0, 0, 0, 1, 0, s, 0, 0, 0, ox, 0, 0, 1];
      const area = hd.t * (2 * hd.leg - hd.t);
      const mass = ((area * w) / IN3_PER_FT3) * p.steelDensityPcf;
      const part: Part = {
        id: `beam-hold-down-${tag}`, partNo: 'beam-hold-down', name: `Rear beam hold-down angle ${tag}`, group: 'running-gear', kind: 'metal', material: '316 stainless angle',
        geometry: { type: 'extrusion', outline: profile, depth: w }, transform: m, body: 'chassis', massLb: mass, fab: 'drill-tap', step: STEP.gear,
        explode: unitVec([0, -s, 0.5]), stock: { t: hd.t, w: hd.leg, l: w },
        sourcing: { vendor: `McMaster-Carr (316 stainless angle ${f2(hd.leg)}" × ${f2(hd.leg)}" × ${f2(hd.t)}": cut ${f2(w)}" long on the bandsaw, drill 2 × ${f2(bd + 0.03)}" in the upright leg and 2 × ${f2(bd + 0.03)}" in the flat leg; 4 × 316 hex bolts ${f2(bd)}", nylock nuts, fender washers)` },
        notes: `Holds the rear axle beam to the ${rs.ladder ? 'rail' : 'girder'} (build review r2 MUST-4): the upright leg lies on the rail's inner face (z ${f2(hd.zBeam)}" to ${f2(hd.zTop)}"), two ${f2(bd)}" bolts through the rail; the flat leg lies on the beam top (it also keeps the rod in its groove), two ${f2(bd)}" bolts down through the beam either side of the rod. Stays clear of the straddling deck joists (${f2(w)}" wide, centered on the beam). Rebound, side load and the rail's tendency to walk off the beam are carried here; the vertical load bears on the notch ceiling instead.`,
        joints: [],
      };
      part.joints!.push({
        type: 'bolt', to: rs.ladder ? `rail-cabin-${tag}` : `girder-cabin-${tag}`, count: 2, diaIn: bd, size: `${f2(bd)}" × ${inchesText(boltLength(hd.t + rs.t, bd))} 316 hex bolts through the upright leg and the rail`,
        at: hd.railBolts.map(([x, z]) => localPoint(part.transform, [x, s * (rs.yIn - hd.t / 2), z])),
      });
      part.joints!.push({
        type: 'bolt', to: 'beam-R', count: 2, diaIn: bd, size: `${f2(bd)}" × ${inchesText(boltLength(hd.t + L.beamR.depth, bd))} 316 hex bolts down through the flat leg and the beam`,
        at: hd.beamBolts.map(([x, y]) => localPoint(part.transform, [x, s * y, hd.zBeam + hd.t / 2])),
      });
      parts.push(part);
    }
  }
  return parts;
}
