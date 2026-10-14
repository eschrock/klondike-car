/**
 * Running gear: the four wheels (10 in pneumatic, D-54) and the REAR axle (through rod or stubs), axle beam and rod clamps (D-10, D-11, D-15). The front axle, which
 * pivots about a kingpin, is in pivot.ts (D-56); the front wheels turn with it.
 */
import { AXLE_BEAM_POSITION, AXLE_STYLE, axleGrooveDepthIn } from '../params';
import { axleMaterial, axleSourcing, axleStockNote } from './axle-stock';
import { IN3_PER_FT3, STEP, box, cylinder, frac16, span, SIDES, type Ctx, stainless } from './build-utils';
import { translation } from './mat4';
import { beamSeat, boltLength, inchesText, localPoint, railSection } from './rear-mount';
import type { Params } from '../params';
import type { Joint, Mat4, Part, RigidBody, Vec2, Vec3 } from './types';

// ── Block-model placeholders ──
/** Hub outer diameter as a fraction of the wheel diameter, capped (viewer-only detail). */
const HUB_DIA_FRAC = 0.5;
const HUB_DIA_MAX_IN = 6;
/** Stub axle embedment into the beam (spec: hub + end extra + 4). */
const STUB_EMBED_IN = 4;

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
const unitVec = (v: Vec3): Vec3 => { const n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };

/** Nearest 1/32 in as a fraction string (the 5/32" cotter hole). */
const frac32 = (x: number): string => { let n = Math.round(x * 32), d = 32; while (n % 2 === 0 && d > 1) { n /= 2; d /= 2; } return n >= d ? `${Math.floor(n / d)}${n % d ? `-${n % d}/${d}` : ''}` : `${n}/${d}`; };

/**
 * The cotter cross hole near the outboard end of an axle rod (D-60, D-71): the rear through rod and each front stub carry one per wheel. It sits `axleCrossHoleFromEndIn` in from the
 * rod's end, which is `axleEndExtraIn - axleCrossHoleFromEndIn` beyond the hub (the collar and washer lie between), drilled vertically across the rod (its axis in the bending plane: the
 * worst orientation, which the axle-stress row assumes). A cylinder's own axis is its local z, and local z runs toward -y here, so the outboard end of the `s` side is at local z = -s L / 2.
 * `s` is +1 for the left end, -1 for the right; `length` the rod's length; `wheelId` the wheel whose collar the pin holds.
 */
export function cotterHoleJoint(p: Params, s: 1 | -1, length: number, wheelId: string): Joint {
  const from = p.axleCrossHoleFromEndIn;
  const beyondHub = p.axleEndExtraIn - from;
  return {
    type: 'hole', to: wheelId, count: 1, diaIn: p.axleCrossHoleDiaIn,
    size: `${frac32(p.axleCrossHoleDiaIn)}" hole across the rod, drilled vertically, ${frac16(from)}" in from the outboard end (${frac16(beyondHub)}" beyond the hub: room for the collar and washer, ${frac16(p.axleEndExtraIn)}" of rod stands out) for the cotter pin`,
    at: [[0, 0, -s * (length / 2 - from)]],
    note: `the pin keeps the collar on; the hole is ${frac16(from - p.axleCrossHoleDiaIn / 2)}" from the end to its edge (the axle-stress row checks the net section, the pin bearing and the tear-out)`,
  };
}

/** The hold-down angle's bolts (D-48, D-72): the stock lengths of the two beam bolts down through the flat leg and the beam, and of the two rail bolts through the upright leg, the hanger and the rail. */
export function holdDownBolts(p: Params, L: Ctx['L']): { dia: number; beamLenIn: number; railLenIn: number } | null {
  const seat = beamSeat(p, L);
  if (!seat) return null;
  const rs = railSection(p, L), hd = seat.hd;
  return { dia: hd.boltD, beamLenIn: boltLength(hd.t + L.beamR.depth, hd.boltD), railLenIn: boltLength(hd.t + rs.t + rs.railT, hd.boltD) };
}

export function buildRunningGear(ctx: Ctx): Part[] {
  const { p, d, L } = ctx;
  const parts: Part[] = [];
  const r = L.r;
  const rodR = p.axleDiameterIn / 2;

  // Wheels
  // The axle each wheel runs on (its end carries the cotter cross hole, see `cotterHoleJoint`): the through rod or a rear stub; the front stubs.
  const axleOf = (id: 'wheel-RL' | 'wheel-RR' | 'wheel-FL' | 'wheel-FR'): string => (id.startsWith('wheel-F') ? `axle-${id.slice(6)}` : p.axleStyle === AXLE_STYLE.throughRod ? 'axle-R' : `axle-${id.slice(6)}`);
  const wheel = (id: 'wheel-RL' | 'wheel-RR' | 'wheel-FL' | 'wheel-FR', name: string, transform: number[]): Part => ({
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
      bore: p.wheelBoreIn,
    },
    transform,
    joints: [{ type: 'pin', to: axleOf(id), count: 1, size: `collar and cotter pin on the axle end, ${frac16(p.axleEndExtraIn - p.axleCrossHoleFromEndIn)}" beyond the hub (the cotter cross hole is in the axle)`, note: 'purchased wheel: nothing is drilled in it' }],
    body: id as RigidBody,
    massLb: d.wheelMassLb,
    fab: 'buy',
    step: STEP.gear,
    explode: [0, (id.endsWith('L') ? 1 : -1) / Math.hypot(1, 0.25), -0.25 / Math.hypot(1, 0.25)],
    sourcing: {
      vendor: (p.tireType === 0
        ? `Harbor Freight 10" pneumatic tire with black hub, SKU 67465 (https://www.harborfreight.com/10-inch-x-3-1-2-half-inch-pneumatic-tire-67465.html), $9.99 each (D-71; 5/8" bore, 300 lb, about 3 lb, 3-1/2" wide, 30 psi). `
        : `${p.wheelDiameterIn}" flat-free hand-truck wheel, ${p.wheelBoreIn}" bore, ${p.hubLengthIn}" hub length, sealed ball bearings or flanged bushings pressed into the hub. `)
        + `VERIFY the hub length, bore and rating on the real wheel: the model assumes a ${p.wheelBoreIn}" bore (the same as the ${p.axleDiameterIn}" axle), a ${p.hubLengthIn}" hub (the Harbor Freight listing gives none; the Uline H-5454 and the Martin wheel list 2-1/4"), ${p.wheelRatingLb} lb per wheel (wheelRatingLb, status verify; the wheel-rating check uses it) and ${d.wheelMassLb.toFixed(1)} lb (wheelMass10Lb, verify)`,
    },
    notes: `Catalog wheel mass from params (D-11). Hub spec (M11, D-60): ${p.wheelBoreIn}" bore for the ${p.axleDiameterIn}" axle, ${p.hubLengthIn}" hub, sealed ball bearings (or flanged bronze bushings) in the hub; collar + cotter pin on the axle end (${p.axleEndExtraIn}" beyond the hub). VERIFY ON THE REAL PART (build 3c-8, D-71): the bore and the hub length are the pre-order gate. Measure the Harbor Freight hub: its bore with a ${p.axleDiameterIn}" gauge pin or calipers, the hub length, and the squash test, before ordering four; the listing gives no hub length.`,
  });
  const ry = p.rearTrackIn / 2;
  const fy = p.frontTrackIn / 2;
  parts.push(
    wheel('wheel-RL', 'Rear left wheel', translation(0, ry, r)),
    wheel('wheel-RR', 'Rear right wheel', translation(0, -ry, r)),
    wheel('wheel-FL', 'Front left wheel', translation(L.WB, fy, r)),
    wheel('wheel-FR', 'Front right wheel', translation(L.WB, -fy, r)),
  );
  // Rear axle, beam and clamps.
  {
    const ax = { tag: 'R' as const, x: 0, track: p.rearTrackIn, beam: L.beamR };
    const name = 'rear';
    if (p.axleStyle === AXLE_STYLE.throughRod) {
      parts.push(cylinder(ctx, {
        id: `axle-${ax.tag}`, name: `${name} axle (through ${p.axleWallIn > 0 ? 'tube' : 'rod'})`, group: 'running-gear',
        center: [ax.x, 0, r], axis: 'y', radius: rodR, wall: p.axleWallIn, length: ax.track + p.hubLengthIn + 2 * p.axleEndExtraIn,
        mat: 'steel', ...axleMaterial(p), fab: 'drill-tap', step: STEP.gear, notes: `Dead axle, clamped to the beam (D-10). Sits in a groove in the beam. ${axleStockNote(p)}`,
        sourcing: { vendor: axleSourcing(p, ax.track + p.hubLengthIn + 2 * p.axleEndExtraIn) },
        joints: [cotterHoleJoint(p, 1, ax.track + p.hubLengthIn + 2 * p.axleEndExtraIn, 'wheel-RL'), cotterHoleJoint(p, -1, ax.track + p.hubLengthIn + 2 * p.axleEndExtraIn, 'wheel-RR')],
      }));
    } else {
      const stubLen = p.hubLengthIn + p.axleEndExtraIn + STUB_EMBED_IN;
      const outer = ax.track / 2 + p.hubLengthIn / 2 + p.axleEndExtraIn;
      for (const { s, tag } of SIDES) {
        parts.push(cylinder(ctx, {
          id: `axle-${ax.tag}${tag}`, partNo: `stub-axle`, name: `${name} ${tag === 'L' ? 'left' : 'right'} stub axle`,
          group: 'running-gear', center: [ax.x, s * (outer - stubLen / 2), r], axis: 'y',
          radius: rodR, wall: p.axleWallIn, length: stubLen, mat: 'steel', ...axleMaterial(p), fab: 'drill-tap', step: STEP.gear,
          notes: `Embedded ${STUB_EMBED_IN}" into the beam (D-10). ${axleStockNote(p)}`,
          sourcing: { vendor: axleSourcing(p, stubLen) },
          joints: [cotterHoleJoint(p, s, stubLen, `wheel-R${tag}`)],
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
      const yRailMid = rs.yOut - rs.t / 2; // the hanger's mid-plane
      for (const { s, tag } of SIDES) {
        beamRailJoints.push({
          type: 'dado', to: `axle-hanger-${tag}`, count: 1,
          size: `rail notch ${f2(seatInfo.x1 - seatInfo.x0)}" × ${f2(seatInfo.depth)}": the beam top (z ${f2(b.top)}") bears on the notch ceiling; no cut in the beam`,
          at: [[0, s * yRailMid, b.top - (b.top + b.bot) / 2]],
          note: 'the beam passes under the rail; the rail sits on it',
        });
        beamRailJoints.push({
          type: 'bolt', to: `beam-hold-down-${tag}`, count: seatInfo.hd.beamBolts.length, diaIn: seatInfo.hd.boltD,
          size: `${f2(seatInfo.hd.boltD)}" × ${inchesText(boltLength(seatInfo.hd.t + b.depth, seatInfo.hd.boltD))} ${stainless(p)} hex bolts down through the angle's horizontal leg and the beam, nylock nuts and fender washers under the beam`,
          at: seatInfo.hd.beamBolts.map(([x, y]): Vec3 => [x - b.x, s * y, seatInfo.hd.zBeam - (b.top + b.bot) / 2]),
          note: 'either side of the axle rod',
        });
      }
    }
    parts.push(box(ctx, {
      id: `beam-${ax.tag}`, name: `${name} axle beam`, group: 'running-gear', mat: 'oak',
      size: [b.thick, b.len, b.depth], center: [b.x, 0, (b.top + b.bot) / 2], grain: 'y', fab: 'table-saw',
      step: STEP.gear, notes: (p.axleBeamPosition === AXLE_BEAM_POSITION.underslung ? 'Underslung (D-15).' : 'Overslung (D-15).') + ' Face-laminated from stocked boards (D-70): no 12/4 is bought; the blank is glued up from 4/4 layers face to face with epoxy and milled to size BEFORE it is notched, bored and slotted (the cut list gives the layers). Strength is taken as solid oak.',
      ...(seatInfo ? { joints: beamRailJoints } : {}),
    }));
    // Clamps (D-62, build 3c M2): ONE bridge plate per wheel side, across the tube, with a 3/8 in bolt each side at tube center +/- (tube radius + clampLegGapIn) = 0.6875 in for the 5/8 in tube (0.75 in for the D-62 3/4 in tube). The groove is cut
    // axleGrooveDepthIn (0.595 in for the 5/8 in tube, D-71) deep so the tube stands axleProudIn proud and the plate bears on the TUBE; it used to be two 0.8 in plates that floated 0.075 in above the tube.
    const under = p.axleBeamPosition === AXLE_BEAM_POSITION.underslung;
    const plate = { x: p.clampPlateLengthIn, y: p.clampPlateWidthIn, z: p.clampPlateThickIn };
    const legOffset = rodR + p.clampLegGapIn;
    const yEdge = Math.min(b.len / 2 - 0.25, ax.track / 2 - p.tireWidthIn / 2);
    const yc = yEdge - plate.y / 2;
    {
      // REAR clamp plates (build review r2 MUST-4 / S13, eng N-10; D-62): 316 stainless flat bar cut to size (1/4 x 1.75 x 2-1/4 in, D-71), two 3/8 in 316 bolts through the plate and the beam either
      // side of the tube. Real parts with a source and a stock size.
      const zc = under ? r + rodR + plate.z / 2 : r - rodR - plate.z / 2;
      const bd = p.uboltRodDiameterIn;
      for (const { s, tag } of SIDES) {
        const sp = span([ax.x - plate.x / 2, ax.x + plate.x / 2], [s * yc - plate.y / 2, s * yc + plate.y / 2], [zc - plate.z / 2, zc + plate.z / 2]);
        const grip = plate.z + b.depth;
        const part = box(ctx, {
          id: `clamp-${ax.tag}${tag}1`, partNo: 'axle-clamp', name: `${name} ${tag === 'L' ? 'left' : 'right'} axle clamp plate`,
          group: 'running-gear', mat: 'steel', kind: 'metal', material: `${stainless(p)} flat bar`,
          ...sp, fab: 'drill-tap', step: STEP.gear,
          sourcing: { vendor: `McMaster-Carr (${stainless(p)} flat bar ${plate.z}" × ${plate.y}": cut ${plate.x}" pieces on the bandsaw, drill 2 × ${f2(bd + 0.03)}" at ${f2(2 * legOffset)}" centers; 2 × ${stainless(p)} hex bolt ${f2(bd)}" × ${inchesText(boltLength(grip, bd))}, nylock nuts, fender washers). Stainless, not zinc (wet tannin oak, S7). Or a stocked ${stainless(p)} two-hole tube strap for ${p.axleDiameterIn}" OD tube.` },
          joints: [{
            type: 'bolt', to: `beam-${ax.tag}`, count: 2, diaIn: bd, size: `2 × ${f2(bd)}" × ${inchesText(boltLength(grip, bd))} ${stainless(p)} hex bolts, ${f2(2 * legOffset)}" apart, down through the plate and the beam either side of the tube, nylock nuts + fender washers under the beam`,
            at: [[legOffset, 0, 0], [-legOffset, 0, 0]], note: `the plate bears on the tube (it stands ${f2(p.axleProudIn)}" proud of the ${f2(axleGrooveDepthIn(p))}" groove); ${f2(legOffset - bd / 2 - 0.015 - rodR)}" of oak between each bolt hole and the groove wall`,
          }],
          notes: `Clamps the axle tube in its groove (D-10, D-62): ${plate.x}" × ${plate.y}" × ${plate.z}" ${stainless(p)} plate across the tube, two ${f2(bd)}" bolts through the beam (grip ${f2(grip)}") at ${f2(legOffset)}" either side of the tube centerline. Cut the groove ${f2(axleGrooveDepthIn(p))}" deep so the tube stands ${f2(p.axleProudIn)}" proud and the plate bears on it; shim the plate ends with tape on the first tightening and check it does not rock. Snug plus a quarter turn, re-check the nuts before each event (oak creeps; the oak caps the preload at about 800 lbf). The bolts, nuts and washers are in the fastener allowance.`,
        });
        parts.push(part);
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
        id: `beam-hold-down-${tag}`, partNo: 'beam-hold-down', name: `Rear beam hold-down angle ${tag}`, group: 'running-gear', kind: 'metal', material: `${stainless(p)} angle`,
        geometry: { type: 'extrusion', outline: profile, depth: w }, transform: m, body: 'chassis', massLb: mass, fab: 'drill-tap', step: STEP.gear,
        explode: unitVec([0, -s, 0.5]), stock: { t: hd.t, w: hd.leg, l: w },
        sourcing: { vendor: `McMaster-Carr (${stainless(p)} angle ${f2(hd.leg)}" × ${f2(hd.leg)}" × ${f2(hd.t)}": cut ${f2(w)}" long on the bandsaw, drill 2 × ${f2(bd + 0.03)}" in the upright leg and 2 × ${f2(bd + 0.03)}" in the flat leg; 4 × ${stainless(p)} hex bolts ${f2(bd)}", nylock nuts, fender washers)` },
        notes: `Holds the rear axle beam to the axle hanger (D-54, build review r2 MUST-4): the upright leg lies on the hanger's inner face (z ${f2(hd.zBeam)}" to ${f2(hd.zTop)}"), two ${f2(bd)}" bolts through the hanger and the rail (D-72); the flat leg lies on the beam top (it also keeps the rod in its groove), two ${f2(bd)}" bolts down through the beam either side of the rod. Stays clear of the straddling deck crossmembers (${f2(w)}" wide, centered on the beam). Rebound, side load and the rail's tendency to walk off the beam are carried here; the vertical load bears on the notch ceiling instead.`,
        joints: [],
      };
      part.joints!.push({
        type: 'bolt', to: `axle-hanger-${tag}`, count: 2, diaIn: bd, size: `${f2(bd)}" × ${inchesText(boltLength(hd.t + rs.t + rs.railT, bd))} ${stainless(p)} hex bolts through the upright leg, the hanger and the rail, nylock nuts and fender washers on the outside face of the rail (D-72: these are also the hanger's bolts, one bolt at each position)`,
        at: hd.railBolts.map(([x, z]) => localPoint(part.transform, [x, s * (rs.yIn - hd.t / 2), z])),
      });
      part.joints!.push({
        type: 'bolt', to: 'beam-R', count: 2, diaIn: bd, size: `${f2(bd)}" × ${inchesText(boltLength(hd.t + L.beamR.depth, bd))} ${stainless(p)} hex bolts down through the flat leg and the beam`,
        at: hd.beamBolts.map(([x, y]) => localPoint(part.transform, [x, s * y, hd.zBeam + hd.t / 2])),
      });
      parts.push(part);
    }
  }
  return parts;
}
