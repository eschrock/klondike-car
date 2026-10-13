/**
 * The pivoting front axle (D-56, Eric): a soapbox / billy-cart style center-pivot axle. One stout oak beam under the bow with a 10 in pneumatic wheel on a bolt-on stub
 * axle at EACH END, wheels outboard of the body so the deck stays low. The beam turns on ONE vertical kingpin bolt (SAE grade 8) at its center, through a UHMW thrust disc
 * into the KING BEAM, an oak crossmember between the rails (frame.ts). Two oak stop tabs under the end joist set the +/-lock. Bolted only: no welding.
 *
 * D-58 (phase 3c-4a): (1) the one-wheel ROLL of the axle is carried by two UHMW slide pads on top of the beam, out at `rollPadRadiusIn`, that slide under the frame rails with a
 * small running gap; the kingpin and the thrust disc only locate and carry the vertical load. (2) The steel tongue plate (it bent about its thin axis) is replaced by a white-oak
 * TONGUE set on edge, a bandsawn T whose head butts the front face of the beam and is bolted through it with two carriage bolts; the stem runs forward under the end joist and the
 * bow to a bronze sleeve for the bridle rope. (3) The disc is 1/2 in thick and lies directly on the beam, which opens a 1/8 in gap above the clamp plates.
 * Everything that turns with the axle is `body: 'front-axle'`.
 */
import { axleGrooveDepthIn } from '../params';
import { STEP, box, cylinder, span, SIDES, type Ctx } from './build-utils';
import { customPart } from './mesh-utils';
import { compose, translation } from './mat4';
import { boltLength, inchesText, screwLength } from './rear-mount';
import { joistId } from './frame';
import { axleSourcing, axleStockNote } from './axle-stock';
import type { Part, Vec2 } from './types';

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
const frac = (x: number) => {
  const w = Math.floor(x + 1e-9);
  let n = Math.round((x - w) * 16), d = 16;
  if (n === 0) return `${w}`;
  while (n % 2 === 0) { n /= 2; d /= 2; }
  return `${w > 0 ? `${w}-` : ''}${n}/${d}`;
};
const UHMW_PCF = 59;

/** Bronze (SAE 841 oilite-class) sleeve bushing density (lb/ft3), for the mass of the bridle sleeve. */
const BRONZE_PCF = 530;

/**
 * Oak tongue outline in plan (x, y), counter-clockwise: the wide head butting the front face of the axle beam, a taper over the same length down to the stem, then the stem to
 * the tip. (The tongue's x, y are the model frame at steer 0; the extrusion runs from z0 up `tongueDepthIn`.)
 */
export function tongueOutline(ctx: Pick<Ctx, 'p' | 'L'>): Vec2[] {
  const { p, L } = ctx;
  const hw = p.tongueHeadWidthIn / 2, bw = p.tongueWidthIn / 2;
  const xb = L.king.x + L.beamF.thick / 2; // the beam's front face
  const xh = xb + p.tongueHeadLenIn;
  const xt = xh + p.tongueHeadLenIn;
  const tip = L.tongue.tipX;
  return [[xb, -hw], [xh, -hw], [xt, -bw], [tip, -bw], [tip, bw], [xt, bw], [xh, hw], [xb, hw]];
}

/** Plan area (in2) of an outline. */
export function outlineArea(o: Vec2[]): number {
  let a2 = 0;
  for (let i = 0; i < o.length; i++) { const [px, py] = o[i], [qx, qy] = o[(i + 1) % o.length]; a2 += px * qy - qx * py; }
  return Math.abs(a2) / 2;
}

export function buildPivot(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const r = L.r;
  const b = L.beamF;
  const rodR = p.axleDiameterIn / 2;
  const kx = L.king.x;
  const kd = p.kingpinDiaIn;
  const steelLb = (volIn3: number) => (volIn3 / 1728) * p.steelDensityPcf;
  const mk = (s: Parameters<typeof customPart>[1]) => customPart(ctx, s);

  // ── Axle beam: oak, the same stack as the rear (underslung, rod in a top groove), pivoting about the kingpin ──
  const beam = box(ctx, {
    id: 'beam-F', partNo: 'beam-F', name: 'Front axle beam (pivots)', group: 'front-end', mat: 'oak', size: [b.thick, b.len, b.depth], center: [b.x, 0, (b.top + b.bot) / 2], grain: 'y',
    body: 'front-axle', fab: 'table-saw', step: STEP.gear,
    notes: `The pivoting front axle beam (D-56): ${f2(b.thick)}" × ${f2(b.depth)}" × ${f2(b.len)}" white oak with the same underslung stack as the rear (top ${f2(b.top)}", bottom ${f2(b.bot)}"). A ${frac(kd)}" hole at its center takes the kingpin; a stub axle is bolted down in a groove in each end. Its top carries the steel tongue plate (and so the thrust washer). It turns about the kingpin, ±${p.steerLockDeg}° between the two steering stops, and passes under the shallower front rails. Face-laminated from stocked boards (D-70): no 12/4 is bought; the blank is glued up from 4/4 layers face to face with epoxy and milled to size BEFORE it is bored, notched and slotted (the cut list gives the layers). Strength is taken as solid oak.`,
  });
  parts.push(beam);

  // ── Stub axles and their clamp plates (as at the rear: rod in a groove, plates and 316 bolts pin it) ──
  const hub = p.hubLengthIn;
  const outer = p.frontTrackIn / 2 + hub / 2 + p.axleEndExtraIn;
  const inner = b.len / 2 - p.frontStubLenIn;
  const plate = { x: p.clampPlateLengthIn, y: p.clampPlateWidthIn, z: p.clampPlateThickIn };
  const legOffset = rodR + p.clampLegGapIn;
  const bd = p.uboltRodDiameterIn;
  const outerW = p.clampPlateOuterWidthIn;
  const stations = [b.len / 2 - 0.25 - outerW / 2, inner + 0.25 + plate.y / 2]; // outer (wider, D-62) and inner station centers
  for (const { s, tag } of SIDES) {
    const rod = cylinder(ctx, {
      id: `axle-F${tag}`, partNo: 'stub-axle-F', name: `Front ${tag === 'L' ? 'left' : 'right'} stub axle`, group: 'front-end',
      center: [b.x, s * (inner + outer) / 2, r], axis: 'y', radius: rodR, wall: p.axleWallIn, length: outer - inner, mat: 'steel', body: 'front-axle', fab: 'drill-tap', step: STEP.gear,
      notes: `Steel stub axle (D-56): a ${frac(p.axleDiameterIn)}" ${p.axleWallIn > 0 ? 'tube' : 'rod'} bolted down in a groove in the top of the beam end over ${f2(p.frontStubLenIn)}" (the clamp plates below), the wheel on the free end with a collar and cotter pin ${f2(p.axleEndExtraIn)}" beyond the hub. ${axleStockNote(p)}`,
      sourcing: { vendor: axleSourcing(p, outer - inner) },
    });
    parts.push(rod);
    let k = 0;
    for (const yst of stations) {
      k++;
      // ONE bridge plate per station (D-62, build 3c M2): across the tube, a bolt each side at +/- legOffset; the tube stands axleProudIn proud of the groove and the plate bears on it.
      const zBase = b.top + p.axleProudIn;
      const wPlate = k === 1 ? outerW : plate.y;
      const sp = span([b.x - plate.x / 2, b.x + plate.x / 2], [s * yst - wPlate / 2, s * yst + wPlate / 2], [zBase, zBase + plate.z]);
      const grip = plate.z + b.depth;
      parts.push(box(ctx, {
        id: `clamp-F${tag}${k}`, partNo: 'axle-clamp', name: `Front ${tag === 'L' ? 'left' : 'right'} axle clamp plate ${k}`, group: 'front-end', mat: 'steel', kind: 'metal', material: '316 stainless flat bar',
        ...sp, body: 'front-axle', fab: 'drill-tap', step: STEP.gear,
        sourcing: { vendor: `McMaster-Carr (316 stainless flat bar ${plate.z}" × ${wPlate}": cut ${plate.x}" pieces, drill 2 × ${f2(bd + 0.03)}" at ${f2(2 * legOffset)}" centers; 2 × 316 hex bolt ${f2(bd)}" × ${inchesText(boltLength(grip, bd))}, nylock nuts, fender washers)` },
        joints: [{ type: 'bolt', to: 'beam-F', count: 2, diaIn: bd, size: `2 × ${f2(bd)}" × ${inchesText(boltLength(grip, bd))} 316 hex bolts, ${f2(2 * legOffset)}" apart, down through the plate and the beam either side of the tube, nylock nuts + fender washers under the beam`, at: [[legOffset, 0, 0], [-legOffset, 0, 0]], note: `the plate bears on the tube (${f2(p.axleProudIn)}" proud of the groove)` }],
        notes: `Clamps the front stub axle in its groove: the same bridge plate and bolts as the rear clamp (D-62). Cut the groove ${f2(axleGrooveDepthIn(p))} in deep so the tube stands ${f2(p.axleProudIn)} in proud; shim the plate ends with tape on the first tightening.`,
      }));
      (beam.joints ??= []).push({ type: 'bolt', to: `clamp-F${tag}${k}`, count: 2, diaIn: bd, size: `2 × ${f2(bd)}" × ${inchesText(boltLength(grip, bd))} 316 hex bolts down through the clamp plate and the beam, nylock nuts + fender washers under the beam`, at: [[legOffset, s * yst, b.depth / 2], [-legOffset, s * yst, b.depth / 2]], note: 'either side of the stub axle; the plate presses the tube into its groove' });
    }
  }

  // ── Thrust disc: UHMW disc lying directly on the axle beam (turns with it), screwed up to the king beam (fixed). The tongue no longer lies under it (D-58). ──
  {
    const od = p.kingThrustOdIn, t = p.kingThrustThickIn;
    const z = b.top + t / 2;
    const vol = Math.PI * ((od / 2) ** 2 - (kd / 2 + 0.03) ** 2) * t;
    parts.push(mk({
      id: 'king-thrust', partNo: 'king-thrust', name: 'Kingpin thrust disc (UHMW)', group: 'front-end', kind: 'purchased', material: 'UHMW polyethylene disc',
      geometry: { type: 'cylinder', radius: od / 2, length: t }, transform: translation(kx, 0, z), massLb: (vol / 1728) * UHMW_PCF, body: 'chassis', fab: 'buy', step: STEP.gear, explode: [0, 0, 0.6],
      sourcing: { vendor: `McMaster-Carr (UHMW-PE sheet ${frac(t)}" thick, cut a ${f2(od)}" disc with a ${f2(kd + 0.06)}" bore; or a bought ${f2(od)}" UHMW thrust washer). Screwed to the underside of the king beam, the axle beam turns under it. Check the bearing pressure at the supplier's PV limit (king-bearing row)` },
      notes: `The thrust bearing (D-56, D-58): the king beam bears down through this ${f2(od)}" × ${frac(t)}" disc onto the TOP of the axle beam, which turns under it. It carries the static front load and the tilt of the tow pull; the one-wheel roll of a bump goes through the roll pads instead. UHMW against oak, no grease needed (wipe off sand). Its top face is the king beam bottom (z ${f2(L.king.bot)}"); the clamp plates on the beam top (to z ${f2(b.top + p.axleProudIn + p.clampPlateThickIn)}") pass under the king beam with ${f2(L.king.bot - b.top - p.axleProudIn - p.clampPlateThickIn)}" to spare.`,
    }));
  }

  // ── Kingpin bolt: grade 8, head and plate washer under the beam, nut in a slot at the top of the king beam ──
  {
    const zHead = b.bot - 0.45;
    const zNutTop = L.king.top - 0.45;
    const len = zNutTop - zHead;
    const boltOrder = `${inchesText(Math.ceil((len + 0.45 + 0.1 + 0.64) * 2 - 1e-9) / 2)} (stock length)`;
    const shank = cylinder(ctx, {
      id: 'kingpin', partNo: 'kingpin', name: 'Kingpin bolt (grade 8)', group: 'front-end', center: [kx, 0, zHead + len / 2], axis: 'z', radius: kd / 2, length: len, mat: 'steel',
      kind: 'purchased', material: 'SAE grade 8 hex bolt, zinc-yellow, with plate washers', body: 'front-axle', fab: 'buy', step: STEP.gear,
      massLb: steelLb(Math.PI * (kd / 2) ** 2 * len) + 0.2,
      sourcing: { vendor: `McMaster-Carr (grade 8 hex bolt ${frac(kd)}" × ${boltOrder} (stack ${f2(len + 0.45)}" = beam ${f2(b.depth)}" + disc ${f2(p.kingThrustThickIn)}" + king beam ${f2(L.king.depth)}" + head washer, nut washer and nylock nut; catalog lengths come in 1/2" steps above 3" and a grade 8 bolt is cut with a cut-off wheel and filed, not a hacksaw), full-thread or ${f2(len - 2.5)}" shank; 2 grade 8 flat washers (one under the head, one under the nut), nylock nut; Loctite on the head washer)` },
      joints: [
        { type: 'bolt', to: 'beam-F', count: 1, diaIn: kd, size: `${frac(kd)}" grade 8 kingpin through the beam, head and plate washer under the beam`, at: [[0, 0, 0]], note: 'the beam turns on the bolt; the head washer clamps the bolt to the beam' },
      ],
      notes: `Kingpin (D-56): one ${frac(kd)}" SAE grade 8 bolt, head down under the axle beam with a plate washer, up through the beam, the UHMW disc and the king beam, nylock nut and washer in the slot at the top of the king beam (snug, then backed off a quarter turn so the axle swings freely). It locates the axle: it carries the pull of the bridle, the sideways loads and the rebound. The vertical load goes through the thrust disc and the roll of a one-wheel bump through the roll pads (D-58), not the bolt.`,
    });
    parts.push(shank);
  }

  // ── Roll pads (D-58): two UHMW slide pads on top of the axle beam, out at rollPadRadiusIn from the kingpin. They slide under the frame rails with a small running gap and catch the roll of a
  //    one-wheel bump (the beam tips, a pad meets the rail), so the kingpin only locates. ──
  for (const { s, tag } of SIDES) {
    const t = p.rollPadThickIn, w = p.rollPadWidthIn, l = p.rollPadLenIn;
    const vol = w * l * t;
    const sc = [-1, 1].map((k) => k * Math.min(0.58, w / 2 - 0.2));
    (beam.joints ??= []).push({ type: 'screw', to: `roll-pad-${tag}`, count: 2, diaIn: 0.19, size: `2 × #10 × ${inchesText(screwLength(t, 0.75))} 316 flat-head screws down through the pad (${frac(t)}") and 3/4 in into the oak beside the stub axle groove`, at: sc.map((x) => [x, s * p.rollPadRadiusIn, b.depth / 2] as [number, number, number]), note: 'the pad lies on the beam top' });
    parts.push(mk({
      id: `roll-pad-${tag}`, partNo: 'roll-pad', name: `Roll pad ${tag} (UHMW)`, group: 'front-end', kind: 'purchased', material: 'UHMW polyethylene',
      geometry: { type: 'box', size: [w, l, t] }, transform: translation(kx, s * p.rollPadRadiusIn, b.top + p.axleProudIn + t / 2), massLb: (vol / 1728) * UHMW_PCF, body: 'front-axle', fab: 'table-saw', step: STEP.gear,
      explode: [0, s * 0.3, 0.8],
      sourcing: { vendor: `McMaster-Carr (UHMW-PE sheet ${frac(t)}" thick, cut ${f2(w)}" × ${f2(l)}"; 2 × #10 × ${inchesText(screwLength(t, 0.75))} 316 flat-head screws into the axle beam beside the stub axle groove; a layer of packing tape under the pad sets the running gap)` },
      joints: [{ type: 'screw', to: 'beam-F', count: 2, diaIn: 0.19, size: `2 × #10 × ${inchesText(screwLength(t, 0.75))} 316 flat-head screws, countersunk, through the pad and 3/4 in into the oak beside the stub axle groove`, at: sc.map((x) => [x, 0, 0] as [number, number, number]), note: 'the pad lies on the axle beam top (and over the flush stub axle); the screws are beside the groove' }],
      notes: `Roll pad (D-58): ${f2(w)}" × ${f2(l)}" × ${frac(t)}" UHMW on the axle beam top, centered ${f2(p.rollPadRadiusIn)}" from the kingpin. The rail bottom is ${f2(L.deckBot - L.railDepthF - L.beamF.top - p.axleProudIn)}" above the top of the axle tube here (beamRailClearIn; the tube stands ${f2(p.axleProudIn)}" proud of the beam top, and the pad's underside is modeled level with the tube top, so shim it ${f2(p.axleProudIn)}" off the beam with packing tape or UHMW offcut), so the pad leaves a running gap of about ${f2(L.deckBot - L.railDepthF - L.beamF.top - p.axleProudIn - t)}" (set with tape or shims, ${f2(p.rollPadGapMinIn)}" to 1/8"). In normal running the pads do not touch; when one wheel hits a bump the axle rolls a fraction of a degree and the pad on the high side meets the rail underside, which carries the roll couple into the hull. UHMW on oak: no grease. Wipe off sand.`,
    }));
  }

  // ── Tongue: white oak set on edge, a bandsawn T. The head butts the front face of the beam and is bolted through it; the stem reaches forward under the end joist and the bow to the bridle sleeve ──
  {
    const outline = tongueOutline(ctx);
    const area = outlineArea(outline);
    const depth = L.tongue.z1 - L.tongue.z0;
    const hw = p.tongueHeadWidthIn;
    const len = L.tongue.tipX - (kx + b.thick / 2);
    const tb = p.tongueBoltDiaIn;
    const boltY = p.tongueBoltOffsetIn;
    const zMid = (L.tongue.z0 + L.tongue.z1) / 2;
    const grip = p.tongueHeadLenIn + b.thick;
    const holeR = p.tongueHoleDiaIn / 2;
    const vol = area * depth - Math.PI * holeR * holeR * p.tongueWidthIn - 2 * Math.PI * ((tb + 0.03) / 2) ** 2 * p.tongueHeadLenIn;
    const surface = 2 * area + depth * outline.reduce((acc, q, k) => { const r = outline[(k + 1) % outline.length]; return acc + Math.hypot(r[0] - q[0], r[1] - q[1]); }, 0);
    const mass = (vol / 1728) * p.oakDensityPcf + (surface / 144) * p.finishLbPerFt2;
    const bl = inchesText(boltLength(grip, tb));
    parts.push(mk({
      id: 'bridle-tongue', partNo: 'bridle-tongue', name: 'Bridle tongue (oak, on edge)', group: 'front-end', kind: 'lumber', material: 'white oak',
      geometry: { type: 'extrusion', outline, depth }, transform: translation(0, 0, L.tongue.z0), massLb: mass, body: 'front-axle',
      fab: 'bandsaw', step: STEP.spindles, explode: [1, 0, 0.1], grain: 'x',
      stock: { t: depth, w: hw, l: len },
      rough: { t: depth + p.millingAllowanceIn, w: hw + p.millingAllowanceIn, l: len + 4 * p.millingAllowanceIn },
      joints: [
        { type: 'bolt', to: 'beam-F', count: 2, diaIn: tb, size: `${f2(tb)}" × ${bl} 316 carriage bolts, fore-aft through the head and the axle beam, nylock nuts + fender washers on the rear face of the beam`, at: [[kx + b.thick / 2 + p.tongueHeadLenIn / 2, boltY, depth / 2], [kx + b.thick / 2 + p.tongueHeadLenIn / 2, -boltY, depth / 2]], note: `one each side of the kingpin, ${f2(boltY)}" off the center line at mid depth (the square necks are sunk into the head)` },
        { type: 'pin', to: 'bridle-sleeve', count: 1, diaIn: p.tongueHoleDiaIn, size: `${f2(p.tongueHoleDiaIn)}" hole across the stem`, at: [[L.tongue.holeX, 0, depth / 2]] },
      ],
      sourcing: { vendor: `White oak 8/4 board (finished ${f2(depth)}" thick, ${f2(hw)}" wide x ${f2(len)}" long), grain along the length: bandsaw the T, ease the edges. Drill ${f2(tb + 0.03)}" fore-aft for the two carriage bolts (2 x ${f2(tb)}" x ${bl} 316, nylock nuts, fender washers) and ${f2(p.tongueHoleDiaIn)}" across the stem for the bridle sleeve` },
      notes: `Bridle tongue (D-58, replaces the steel plate): white oak ${f2(p.tongueWidthIn)}" thick (y) by ${f2(depth)}" deep (z) set ON EDGE, so it bends about its strong axis; the T head (${f2(hw)}" wide, ${f2(p.tongueHeadLenIn)}" long) butts the front face of the axle beam (x ${f2(kx + b.thick / 2)}") and two carriage bolts go through it and the whole beam. Its top is ${f2(L.beamF.top - L.tongue.z1)}" below the top of the beam (the thrust disc and king beam stand just over it) and its bottom is flush with the beam bottom (${f2(L.tongue.z0)}" off the ground). The stem runs forward under the end joist (${f2(L.deckBot - p.crossmemberDepthIn - L.tongue.z1)}" clear) and the bow bulkhead to the tip at x ${f2(L.tongue.tipX)}", ${f2(p.tongueTipEdgeIn)}" beyond the bridle sleeve. Pulling the bridle steers the axle; the tow force goes into the beam through the bolts and the head's bearing on the beam face and on to the kingpin. Unbolts for transport (two nuts).`,
    }));
    // the beam's side of the two tongue bolts
    beam.joints = [...(beam.joints ?? []),
      { type: 'bolt', to: 'bridle-tongue', count: 2, diaIn: tb, size: `${f2(tb)}" × ${bl} 316 carriage bolts through the tongue head and the beam, nylock nuts + fender washers on the rear face`, at: [[0, boltY, 0], [0, -boltY, 0]], note: 'one each side of the kingpin hole' },
      { type: 'bolt', to: 'kingpin', count: 1, diaIn: kd, size: `${frac(kd)}" kingpin hole through the beam center`, at: [[0, 0, 0]] }];

    // Bridle sleeve (D-62): bronze sleeve bearing across the stem, with a fender washer each side, so the rope does not wear the oak. The rope (no shackle) runs through its bore.
    const sl = p.tongueWidthIn + 0.25;
    const sleeveId = p.tongueSleeveBoreIn;
    const svol = Math.PI * (holeR ** 2 - (sleeveId / 2) ** 2) * sl;
    parts.push(mk({
      id: 'bridle-sleeve', partNo: 'bridle-sleeve', name: 'Bridle sleeve (bronze)', group: 'front-end', kind: 'purchased', material: 'bronze sleeve bushing',
      geometry: { type: 'cylinder', radius: holeR, length: sl }, transform: compose([L.tongue.holeX, 0, zMid], { x: Math.PI / 2 }), massLb: (svol / 1728) * BRONZE_PCF + 0.05, body: 'front-axle', fab: 'buy', step: STEP.spindles, explode: [1, 0, 0.3],
      sourcing: { vendor: `McMaster-Carr (oil-embedded bronze sleeve bearing, ${f2(sleeveId)}" ID x ${f2(p.tongueHoleDiaIn)}" OD x ${f2(sl)}" long; 2 fender washers ${f2(1.5)}" OD, one each side, epoxied in the ${f2(p.tongueHoleDiaIn)}" hole)` },
      joints: [{ type: 'pin', to: 'bridle', count: 1, diaIn: p.bridleRopeDiaIn, size: `${f2(p.bridleRopeDiaIn)}" nylon bridle rope through the ${f2(sleeveId)}" bore`, at: [[0, 0, 0]] }, { type: 'pin', to: 'bridle-tongue', count: 1, diaIn: p.tongueHoleDiaIn, size: `${f2(p.tongueHoleDiaIn)}" hole across the stem`, at: [[0, 0, 0]] }],
      notes: `Sleeve (D-58): a ${f2(p.tongueHoleDiaIn)}" bronze sleeve bearing epoxied in the hole across the stem, ${f2(p.tongueTipEdgeIn)}" from the tip. The bridle rope (${f2(p.bridleRopeDiaIn)}" nylon, one strand) runs through its ${f2(sleeveId)}" bore, so the oak is not worn by the rope and the hole does not go oval: ease (flare or radius) both ends of the bore so the rope bears on a round edge. There is no shackle (D-62); the rope is the weak link.`,
    }));
  }

  // ── Steering check chains (D-58): an eye bolt fore-aft through each end of the axle beam (the eye behind the trailing face) and one through the king beam (the eye behind its rear face).
  //    The RIGHT chain goes taut at +lock (the right end of the beam swings forward, away from the anchor behind it), the LEFT at -lock. ──
  {
    const d = p.steerEyeBoltDiaIn;
    const stand = L.chain.stand;
    const [ax, ay, az] = L.chain.anchor;
    const ay0 = Math.abs(ay);
    const eyeMass = 2.2 * d * d + 0.12; // forged shoulder eye bolt with its nut and washers: a 1/2 in x 4 1/2 in one weighs about 0.45 lb, the nut and two washers 0.2 lb
    const chainLbFt = 12.3 * p.steerChainDiaIn ** 2; // lb per ft of short-link chain (1/4 in: 0.77)
    const beamX0 = L.king.x - b.thick / 2 - stand - 0.35, beamX1 = L.king.x + b.thick / 2 + 0.65;
    const ancX0 = L.chain.joistX - L.chain.joistT / 2 - 0.65, ancX1 = ax + 0.35;
    const bEye0 = L.steer.beamEyeAt(0);
    const slack0 = L.chain.lenIn - Math.hypot(L.chain.anchor[0] - bEye0[0], L.chain.anchor[1] - bEye0[1], L.chain.anchor[2] - bEye0[2]);
    const along = (x0: number, x1: number, y: number, z: number) => compose([(x0 + x1) / 2, y, z], { y: Math.PI / 2 });
    for (const { s, tag } of SIDES) {
      const side = tag === 'L' ? 'left' : 'right';
      parts.push(mk({
        id: `steer-eye-${tag}`, partNo: 'steer-eye', name: `Steering chain eye bolt, axle beam ${side}`, group: 'front-end', kind: 'purchased', material: 'forged shoulder eye bolt, galvanized',
        geometry: { type: 'cylinder', radius: d / 2, length: beamX1 - beamX0 }, transform: along(beamX0, beamX1, s * p.steerChainBeamYIn, L.chain.beamZ), massLb: eyeMass, body: 'front-axle', fab: 'buy', step: STEP.gear, explode: [-1, s * 0.4, 0],
        sourcing: { vendor: `McMaster-Carr (forged shoulder-type eye bolt ${frac(d)}" x ${inchesText(beamX1 - beamX0 - 0.35)}, galvanized or 316; ${f2(p.steerEyeWllLb)} lb rated in line; nylock nut + 2" OD fender washer on the front face of the beam)` },
        joints: [{ type: 'bolt', to: 'beam-F', count: 1, diaIn: d, size: `${frac(d)}" shoulder eye bolt fore-aft through the beam, nut and 2" washer on the front face`, at: [[0, 0, 0]], note: `${f2(p.steerChainBeamYIn)}" ${side} of the kingpin, mid depth` }, { type: 'pin', to: `steer-chain-${tag}`, count: 1, size: 'quick link to the chain' }],
        notes: `Beam end of the ${side} steering check chain (D-58): a ${frac(d)}" forged shoulder eye bolt through the axle beam fore-aft at mid depth, ${f2(p.steerChainBeamYIn)}" from the kingpin, below the stub axle rod in its groove, the eye standing ${f2(stand)}" out of the TRAILING face. The 2" washer and nylock nut on the front face spread the chain pull over the oak. Turn the eye in the plane of the chain.`,
      }));
      parts.push(mk({
        id: `steer-anchor-${tag}`, partNo: 'steer-anchor', name: `Steering chain anchor eye bolt, chain joist ${side}`, group: 'front-end', kind: 'purchased', material: 'forged shoulder eye bolt, galvanized',
        geometry: { type: 'cylinder', radius: d / 2, length: ancX1 - ancX0 }, transform: along(ancX0, ancX1, s * ay0, az), massLb: eyeMass, body: 'chassis', fab: 'buy', step: STEP.gear, explode: [-0.5, s * 0.4, -0.5],
        sourcing: { vendor: `McMaster-Carr (forged shoulder-type eye bolt ${frac(d)}" x ${inchesText(ancX1 - ancX0 - 0.35)}, galvanized or 316; ${f2(p.steerEyeWllLb)} lb rated in line; nylock nut + 2" OD fender washer on the rear face of the chain joist, and a 2" washer under the shoulder on its front face)` },
        joints: [{ type: 'bolt', to: joistId(L, L.joistX.indexOf(L.king.x) - 1), count: 1, diaIn: d, size: `${frac(d)}" shoulder eye bolt fore-aft through the chain joist, the shoulder (with a 2" washer) on its front face, nut and 2" washer on the rear face`, at: [[0, 0, 0]], note: `${f2(ay0)}" off the center line` }, { type: 'pin', to: `steer-chain-${tag}`, count: 1, size: 'quick link to the chain', at: [[0, 0, 0]] }],
        notes: `Anchor of the ${side} steering check chain (D-58): a ${frac(d)}" forged shoulder eye bolt fore-aft through the chain joist (${f2(L.chain.joistT)}" thick, x ${f2(L.chain.joistX)}", the crossmember just behind the king beam), ${f2(ay0)}" off the center line, a little below mid depth, the eye standing ${f2(stand)}" out of the FRONT face (x ${f2(ax)}"). The chain pulls it forward and up toward the beam, out of the joist, so the 2" washer and nylock nut on the rear face carry the pull; the joist is glued to the rails at both ends, so the pull goes into the hull as plan bending of the joist and shear into the rails.`,
      }));
      // the chain, drawn straight between the two eye rings at the shown steering angle (in the sled it hangs in a slack bight until it goes taut at the lock)
      const B0 = L.steer.beamEyeAt(s < 0 ? ctx.steerRad : -ctx.steerRad); // the right chain's eye at the shown steering angle; the left chain is its mirror image
      const bx = B0[0], by = s * Math.abs(B0[1]), bz = B0[2];
      const dx = ax - bx, dy = s * ay0 - by, dz = az - bz;
      const dl = Math.hypot(dx, dy, dz);
      const ux: [number, number, number] = [dx / dl, dy / dl, dz / dl];
      const hxy = Math.hypot(ux[0], ux[1]) || 1;
      const uy: [number, number, number] = [-ux[1] / hxy, ux[0] / hxy, 0]; // horizontal, across the chain
      const uz: [number, number, number] = [ux[1] * uy[2] - ux[2] * uy[1], ux[2] * uy[0] - ux[0] * uy[2], ux[0] * uy[1] - ux[1] * uy[0]];
      const cx = (bx + ax) / 2, cy = (by + s * ay0) / 2, cz = (bz + az) / 2;
      parts.push(mk({
        id: `steer-chain-${tag}`, partNo: 'steer-chain', name: `Steering check chain ${side}`, group: 'front-end', kind: 'purchased', material: 'grade 43 chain (or 316 stainless)',
        geometry: { type: 'box', size: [dl, p.steerChainDiaIn * 1.5, p.steerChainDiaIn * 1.5] }, transform: [ux[0], ux[1], ux[2], 0, uy[0], uy[1], uy[2], 0, uz[0], uz[1], uz[2], 0, cx, cy, cz, 1],
        massLb: (chainLbFt * (L.chain.lenIn + 2)) / 12, body: 'chassis', fab: 'buy', step: STEP.spindles, explode: [-0.5, s * 0.5, -0.5],
        joints: [{ type: 'pin', to: `steer-eye-${tag}`, count: 1, size: 'quick link to the beam eye', at: [[-dl / 2, 0, 0]] }, { type: 'pin', to: `steer-anchor-${tag}`, count: 1, size: 'quick link to the anchor eye', at: [[dl / 2, 0, 0]] }],
        sourcing: { vendor: `McMaster-Carr (${frac(p.steerChainDiaIn)}" grade 43 or 316 chain, ${f2(L.chain.lenIn + 2)}" cut, a quick link to each eye; rated ${f2(p.steerChainWllLb)} lb). Length: ${f2(L.chain.lenIn)}" between the eye rings so it goes taut exactly at the ${f2(p.steerLockDeg)}° lock (adjust at the quick link); drawn straight here with the axle straight, in the sled it hangs in a slack bight` },
        notes: `Steering check chain (D-58): from the beam eye (behind the trailing face of the axle beam) back, under the king beam, to the anchor eye (on the front of the chain joist behind the king beam), ${f2(L.chain.lenIn)}" between the eye rings. With the axle straight it hangs ${f2(slack0)}" slack; turning ${tag === 'R' ? 'left' : 'right'} to the ${f2(p.steerLockDeg)}° lock takes up the slack and stops the axle, the other chain slackens. It passes under the king beam (clear of it by the steer-clear row), clear of the tongue, the disc and the clamp plates. Replaces the oak stop blocks (they could not carry the hard-hit torque, D-58).`,
      }));
    }
  }

  // ── Optional steering ropes from the axle ends back to the musher ──
  if (p.steerRopesOn) {
    for (const { s, tag } of SIDES) {
      const y = s * (outer + 0.1);
      const len = p.steerRopeRunIn;
      parts.push(mk({
        id: `steer-rope-${tag}`, partNo: 'steer-rope', name: `Steering rope ${tag}`, group: 'front-end', kind: 'purchased', material: 'rope (polyester braid)',
        geometry: { type: 'box', size: [len, 0.3, 0.3] }, transform: translation(kx - len / 2, y, r), massLb: 0.0075 * len / 12 * 1.2, body: 'front-axle', fab: 'buy', step: STEP.spindles, removable: true, explode: [-1, 0, 0],
        sourcing: { vendor: `1/4" braided polyester rope, ${Math.round(len / 12)} ft, tied to the end of each stub axle collar` },
        notes: 'Optional (steerRopesOn): lets the musher help steer. Hidden in the viewer like the bridle.',
      }));
    }
  }
  return parts;
}
