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
import { axleGrooveDepthIn, WEATHER_SPEC } from '../params';
import { STEP, box, cylinder, roughOf, span, SIDES, type Ctx, stainless, eyeBoltMat } from './build-utils';
import { customPart } from './mesh-utils';
import { compose, translation } from './mat4';
import { boltLength, CARRIAGE_STOCK_IN, EYE_BOLT_STOCK_IN, inchesText, MIN_THREADS_PAST_NUT, pickWoodScrew, SCREW_DIA_IN, screwText, stockBoltFit, washerThick } from './rear-mount';
import { joistId, kingNutSlot } from './frame';
import { axleMaterial, axleSourcing, axleStockNote } from './axle-stock';
import { cotterHoleJoint } from './running-gear';
import { chainKeeper, KEEPER_CORD_LB_PER_IN } from './chain-keeper';
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

/** Head diameter (in) of a round-head carriage bolt of shank `d` (ASME B18.5: 0.844 in max for 3/8 in, about 2.25 d; 2.375 d is used for margin). */
export const carriageHeadDia = (d: number): number => 2.375 * d;
/** Clearance (in) from the carriage-bolt head to the inside corner where the head's square front face turns into the taper (D-75). */
export const TONGUE_SEAT_CLEAR_IN = 1 / 16;
/** Fillet radius (in) at that inside corner, so the shoulder is not a sharp notch in the oak (D-75). */
export const TONGUE_SHOULDER_FILLET_IN = 0.25;

/** Points of a fillet of radius r at polygon corner b (between a and c), from the tangent point on ba to the one on bc. */
function filletPts(a: Vec2, b: Vec2, c: Vec2, r: number, n = 6): Vec2[] {
  const u1 = [a[0] - b[0], a[1] - b[1]], u2 = [c[0] - b[0], c[1] - b[1]];
  const l1 = Math.hypot(u1[0], u1[1]), l2 = Math.hypot(u2[0], u2[1]);
  const e1 = [u1[0] / l1, u1[1] / l1], e2 = [u2[0] / l2, u2[1] / l2];
  const half = Math.acos(Math.max(-1, Math.min(1, e1[0] * e2[0] + e1[1] * e2[1]))) / 2;
  const t = Math.min(r / Math.tan(half), 0.45 * Math.min(l1, l2));
  const rr = t * Math.tan(half);
  const bis = [e1[0] + e2[0], e1[1] + e2[1]], lb = Math.hypot(bis[0], bis[1]);
  const ctr: Vec2 = [b[0] + (bis[0] / lb) * (rr / Math.sin(half)), b[1] + (bis[1] / lb) * (rr / Math.sin(half))];
  const p1: Vec2 = [b[0] + e1[0] * t, b[1] + e1[1] * t], p2: Vec2 = [b[0] + e2[0] * t, b[1] + e2[1] * t];
  let a1 = Math.atan2(p1[1] - ctr[1], p1[0] - ctr[0]), a2 = Math.atan2(p2[1] - ctr[1], p2[0] - ctr[0]);
  while (a2 - a1 > Math.PI) a2 -= 2 * Math.PI;
  while (a1 - a2 > Math.PI) a2 += 2 * Math.PI;
  return Array.from({ length: n + 1 }, (_, i): Vec2 => { const q = a1 + ((a2 - a1) * i) / n; return [ctr[0] + rr * Math.cos(q), ctr[1] + rr * Math.sin(q)]; });
}

/**
 * Oak tongue outline in plan (x, y), counter-clockwise: the wide head butting the front face of the axle beam, then a taper over the same length down to the stem, then the stem to
 * the tip. (The tongue's x, y are the model frame at steer 0; the extrusion runs from z0 up `tongueDepthIn`.)
 * D-75 (readability review MUST-15b): the head's front face is SQUARE from its outer corners in to just inside the carriage-bolt heads (`tongueSeatHalfWidth`), so the bolt holes exit on a
 * flat, square seat `tongueHeadLenIn` from the beam (the old taper started at the head's outer corners, so the holes came out on a 38 degree slope about 4-1/4 in deep and the 6-1/2 in bolt
 * was 3/4 in short). The taper then runs from that seat down to the stem, with a fillet at the inside corner.
 */
export function tongueSeatHalfWidth(p: Pick<Ctx['p'], 'tongueBoltOffsetIn' | 'tongueBoltDiaIn' | 'tongueWidthIn' | 'tongueHeadWidthIn' | 'tongueHeadLenIn'>): number {
  // The flat seat must reach in to the head's inner edge less the clearance (y0); the fillet's tangent point on the face lies t = r / tan(half the corner angle) beyond the corner, so the
  // corner sits t further in (two passes: t depends on the taper slope, which depends on the corner).
  const y0 = p.tongueBoltOffsetIn - carriageHeadDia(p.tongueBoltDiaIn) / 2 - TONGUE_SEAT_CLEAR_IN;
  const bw = p.tongueWidthIn / 2;
  let ys = y0;
  for (let k = 0; k < 3; k++) {
    const slope = Math.atan2(p.tongueHeadLenIn, Math.max(1e-6, ys - bw)); // angle between the face (along y) and the taper
    const half = (Math.PI - slope) / 2;
    ys = y0 - TONGUE_SHOULDER_FILLET_IN / Math.tan(half);
  }
  return Math.min(p.tongueHeadWidthIn / 2, Math.max(bw, ys));
}
export function tongueOutline(ctx: Pick<Ctx, 'p' | 'L'>): Vec2[] {
  const { p, L } = ctx;
  const hw = p.tongueHeadWidthIn / 2, bw = p.tongueWidthIn / 2;
  const xb = L.king.x + L.beamF.thick / 2; // the beam's front face
  const xh = xb + p.tongueHeadLenIn;
  const xt = xh + p.tongueHeadLenIn;
  const tip = L.tongue.tipX;
  const ys = tongueSeatHalfWidth(p);
  if (ys >= hw - 1e-6 || ys <= bw + 1e-6) return [[xb, -hw], [xh, -hw], [xt, -bw], [tip, -bw], [tip, bw], [xt, bw], [xh, hw], [xb, hw]];
  const fR = filletPts([xh, -hw], [xh, -ys], [xt, -bw], TONGUE_SHOULDER_FILLET_IN);
  const fL = filletPts([xt, bw], [xh, ys], [xh, hw], TONGUE_SHOULDER_FILLET_IN);
  return [[xb, -hw], [xh, -hw], ...fR, [xt, -bw], [tip, -bw], [tip, bw], [xt, bw], ...fL, [xh, hw], [xb, hw]];
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
      center: [b.x, s * (inner + outer) / 2, r], axis: 'y', radius: rodR, wall: p.axleWallIn, length: outer - inner, mat: 'steel', ...axleMaterial(p), body: 'front-axle', fab: 'drill-tap', step: STEP.gear,
      notes: `Steel stub axle (D-56): a ${frac(p.axleDiameterIn)}" ${p.axleWallIn > 0 ? 'tube' : 'rod'} bolted down in a groove in the top of the beam end over ${f2(p.frontStubLenIn)}" (the clamp plates below), the wheel on the free end with a collar and cotter pin ${f2(p.axleEndExtraIn)}" beyond the hub. ${axleStockNote(p)}`,
      sourcing: { vendor: axleSourcing(p, outer - inner) },
      joints: [cotterHoleJoint(p, s, outer - inner, `wheel-F${tag}`)],
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
        id: `clamp-F${tag}${k}`, partNo: 'axle-clamp', name: `Front ${tag === 'L' ? 'left' : 'right'} axle clamp plate ${k}`, group: 'front-end', mat: 'steel', kind: 'metal', material: `${stainless(p)} flat bar`,
        ...sp, body: 'front-axle', fab: 'drill-tap', step: STEP.gear,
        sourcing: { vendor: `McMaster-Carr (${stainless(p)} flat bar ${plate.z}" × ${wPlate}": cut ${plate.x}" pieces, drill 2 × ${f2(bd + 0.03)}" at ${f2(2 * legOffset)}" centers; 2 × ${stainless(p)} hex bolt ${f2(bd)}" × ${inchesText(boltLength(grip, bd))}, nylock nuts, fender washers)` },
        joints: [{ type: 'bolt', to: 'beam-F', count: 2, diaIn: bd, size: `2 × ${f2(bd)}" × ${inchesText(boltLength(grip, bd))} ${stainless(p)} hex bolts, ${f2(2 * legOffset)}" apart, down through the plate and the beam either side of the tube, nylock nuts + fender washers under the beam`, at: [[legOffset, 0, 0], [-legOffset, 0, 0]], note: `the plate bears on the tube (${f2(p.axleProudIn)}" proud of the groove)` }],
        notes: `Clamps the front stub axle in its groove: the same bridge plate and bolts as the rear clamp (D-62). Cut the groove ${f2(axleGrooveDepthIn(p))} in deep so the tube stands ${f2(p.axleProudIn)} in proud; shim the plate ends with tape on the first tightening.`,
      }));
      (beam.joints ??= []).push({ type: 'bolt', to: `clamp-F${tag}${k}`, count: 2, diaIn: bd, size: `2 × ${f2(bd)}" × ${inchesText(boltLength(grip, bd))} ${stainless(p)} hex bolts down through the clamp plate and the beam, nylock nuts + fender washers under the beam`, at: [[legOffset, s * yst, b.depth / 2], [-legOffset, s * yst, b.depth / 2]], note: 'either side of the stub axle; the plate presses the tube into its groove' });
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

  // ── Kingpin bolt: grade 8, head and SAE flat washer under the beam, nut in a slot at the top of the king beam ──
  {
    const zHead = b.bot - 0.45;
    // D-88: order the bolt from its own stack. Under the head: the flat washer, the beam, the disc and the king beam up into the nut slot. The tip must stay under the slot ceiling,
    // so the longest stock length (1/2" steps above 3") that fits under it; it must also reach the thin nylock (jam) nut on the slot floor and 1-1/2 threads past it.
    const slot = kingNutSlot(p, L);
    const wHead = washerThick(kd);
    const fitIn = slot.ceil - (b.bot - wHead); // shank room from under the head to the slot ceiling
    const stockIn = Math.floor(fitIn * 2 + 1e-9) / 2;
    const needIn = slot.floor + slot.nutH + MIN_THREADS_PAST_NUT / 11 - (b.bot - wHead);
    const zNutTop = b.bot - wHead + stockIn; // the bolt's tip
    const len = zNutTop - zHead;
    const boltOrder = `${inchesText(stockIn)} (stock length)`;
    const shank = cylinder(ctx, {
      id: 'kingpin', partNo: 'kingpin', name: 'Kingpin bolt (grade 8)', group: 'front-end', center: [kx, 0, zHead + len / 2], axis: 'z', radius: kd / 2, length: len, mat: 'steel',
      kind: 'purchased', material: 'SAE grade 8 hex bolt, zinc-yellow, with an SAE flat washer', body: 'front-axle', fab: 'buy', step: STEP.gear,
      massLb: steelLb(Math.PI * (kd / 2) ** 2 * len) + 0.2,
      sourcing: { vendor: `McMaster-Carr (grade 8 hex bolt ${frac(kd)}" × ${boltOrder} (the longest stock length that stays under the nut slot's ceiling: ${f2(fitIn)}" from under the head to the ceiling = flat washer + beam ${f2(b.depth)}" + disc ${f2(p.kingThrustThickIn)}" + king beam up to the ceiling; it needs ${f2(needIn)}" to reach 1-1/2 threads past the thin nylock (jam) nut on the slot floor; catalog lengths come in 1/2" steps above 3": buy the stock length, it is used as bought (D-77 no-fabrication rule)), full-thread or ${f2(len - 2.5)}" shank; 1 grade 8 flat washer (under the head; the nut sits in its slot with no washer, D-88), 5/8-11 thin nylon-insert lock nut (a nylock jam nut, about 29/64" tall); Loctite on the head washer)` },
      joints: [
        { type: 'bolt', to: 'beam-F', count: 1, diaIn: kd, size: `${frac(kd)}" grade 8 kingpin through the beam, head and SAE flat washer under the beam`, at: [[0, 0, 0]], note: 'the beam turns on the bolt; the head washer clamps the bolt to the beam' },
      ],
      notes: `Kingpin (D-56): one ${frac(kd)}" SAE grade 8 bolt, head down under the axle beam with an SAE flat washer, up through the beam, the UHMW disc and the king beam, thin nylock (jam) nut held by its flats in the slot at the top of the king beam, no washer (D-88): turn the bolt from its head until snug, then back it off a quarter turn so the axle swings freely. It locates the axle: it carries the pull of the bridle, the sideways loads and the rebound. The vertical load goes through the thrust disc and the roll of a one-wheel bump through the roll pads (D-58), not the bolt.`,
    });
    parts.push(shank);
  }

  // ── Roll pads (D-58): two UHMW slide pads on top of the axle beam, out at rollPadRadiusIn from the kingpin. They slide under the frame rails with a small running gap and catch the roll of a
  //    one-wheel bump (the beam tips, a pad meets the rail), so the kingpin only locates. ──
  for (const { s, tag } of SIDES) {
    const t = p.rollPadThickIn, w = p.rollPadWidthIn, l = p.rollPadLenIn;
    const vol = w * l * t;
    const sc = [-1, 1].map((k) => k * Math.min(0.58, w / 2 - 0.2));
    const padFit = pickWoodScrew(8, t, b.depth);
    const padBite = padFit.lenIn - padFit.gripIn;
    (beam.joints ??= []).push({ type: 'screw', to: `roll-pad-${tag}`, count: 2, diaIn: SCREW_DIA_IN[8], fit: padFit, size: `2 × ${screwText(padFit)} ${stainless(p)} flat-head screws down through the pad (${frac(t)}") and ${f2(padBite)} in into the oak beside the stub axle groove`, at: sc.map((x) => [x, s * p.rollPadRadiusIn, b.depth / 2] as [number, number, number]), note: 'the pad lies on the beam top' });
    parts.push(mk({
      id: `roll-pad-${tag}`, partNo: 'roll-pad', name: `Roll pad ${tag} (UHMW)`, group: 'front-end', kind: 'purchased', material: 'UHMW polyethylene',
      geometry: { type: 'box', size: [w, l, t] }, transform: translation(kx, s * p.rollPadRadiusIn, b.top + p.axleProudIn + t / 2), massLb: (vol / 1728) * UHMW_PCF, body: 'front-axle', fab: 'table-saw', step: STEP.gear,
      explode: [0, s * 0.3, 0.8],
      sourcing: { vendor: `McMaster-Carr (UHMW-PE sheet ${frac(t)}" thick, cut ${f2(w)}" × ${f2(l)}"; 2 × ${screwText(padFit)} ${stainless(p)} flat-head screws into the axle beam beside the stub axle groove; a layer of packing tape under the pad sets the running gap)` },
      joints: [{ type: 'screw', to: 'beam-F', count: 2, diaIn: SCREW_DIA_IN[8], fit: padFit, size: `2 × ${screwText(padFit)} ${stainless(p)} flat-head screws, countersunk, through the pad and ${f2(padBite)} in into the oak beside the stub axle groove`, at: sc.map((x) => [x, 0, 0] as [number, number, number]), note: 'the pad lies on the axle beam top (and over the flush stub axle); the screws are beside the groove' }],
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
    // D-72: a stock carriage-bolt length: the head and the beam (5.5 in at the defaults), a washer, the nylock nut and 1.5 threads past it need 6.16 in, so the stock 6-1/2 in (6 in leaves the tip short of the nylon insert).
    const boltFit = stockBoltFit(grip, tb, 1, CARRIAGE_STOCK_IN);
    const bl = inchesText(boltFit.stockIn);
    parts.push(mk({
      id: 'bridle-tongue', partNo: 'bridle-tongue', name: 'Bridle tongue (oak, on edge)', group: 'front-end', kind: 'lumber', material: 'white oak',
      geometry: { type: 'extrusion', outline, depth }, transform: translation(0, 0, L.tongue.z0), massLb: mass, body: 'front-axle',
      fab: 'bandsaw', step: STEP.spindles, explode: [1, 0, 0.1], grain: 'x',
      stock: { t: depth, w: hw, l: len },
      rough: roughOf(p, { t: depth, w: hw, l: len }),
      joints: [
        { type: 'bolt', to: 'beam-F', count: 2, diaIn: tb, size: `${f2(tb)}" × ${bl} ${stainless(p)} carriage bolts, fore-aft through the head and the axle beam, nylock nuts + fender washers on the rear face of the beam`, at: [[kx + b.thick / 2 + p.tongueHeadLenIn / 2, boltY, depth / 2], [kx + b.thick / 2 + p.tongueHeadLenIn / 2, -boltY, depth / 2]], note: `one each side of the kingpin, ${f2(boltY)}" off the center line at mid depth (the square necks are sunk into the head). D-75: each hole runs ${f2(p.tongueHeadLenIn)}" through the head from the beam face and exits on the head's SQUARE front face, so the domed head seats flat (the taper starts ${f2(tongueSeatHalfWidth(p))}" off the center line, inside the ${f2(carriageHeadDia(tb))}" heads, with a ${f2(TONGUE_SHOULDER_FILLET_IN)}" fillet); clamped stack ${f2(grip)}", so the stock ${bl}" bolt leaves ${f2(boltFit.pastNutIn)}" past the nut` },
        { type: 'pin', to: 'bridle-sleeve', count: 1, diaIn: p.tongueHoleDiaIn, size: `${f2(p.tongueHoleDiaIn)}" hole across the stem`, at: [[L.tongue.holeX, 0, depth / 2]] },
      ],
      sourcing: { vendor: `White oak 8/4 board (finished ${f2(depth)}" thick, ${f2(hw)}" wide x ${f2(len)}" long), grain along the length: bandsaw the T, ease the edges. Drill ${f2(tb + 0.03)}" fore-aft for the two carriage bolts (2 x ${f2(tb)}" x ${bl} ${stainless(p)}, nylock nuts, fender washers) and ${f2(p.tongueHoleDiaIn)}" across the stem for the bridle sleeve` },
      notes: `Bridle tongue (D-58, replaces the steel plate): white oak ${f2(p.tongueWidthIn)}" thick (y) by ${f2(depth)}" deep (z) set ON EDGE, so it bends about its strong axis; the T head (${f2(hw)}" wide, ${f2(p.tongueHeadLenIn)}" long, its front face SQUARE out to ${f2(tongueSeatHalfWidth(p))}" off the center line so the carriage-bolt heads seat flat, D-75) butts the front face of the axle beam (x ${f2(kx + b.thick / 2)}") and two carriage bolts go through it and the whole beam. Its top is ${f2(L.beamF.top - L.tongue.z1)}" below the top of the beam (the thrust disc and king beam stand just over it) and its bottom is flush with the beam bottom (${f2(L.tongue.z0)}" off the ground). The stem runs forward under the end crossmember (${f2(L.deckBot - p.crossmemberDepthIn - L.tongue.z1)}" clear) and the bow bulkhead to the tip at x ${f2(L.tongue.tipX)}", ${f2(p.tongueTipEdgeIn)}" beyond the bridle sleeve. Pulling the bridle steers the axle; the tow force goes into the beam through the bolts and the head's bearing on the beam face and on to the kingpin. Unbolts for transport (two nuts).`,
    }));
    // the beam's side of the two tongue bolts
    beam.joints = [...(beam.joints ?? []),
      { type: 'bolt', to: 'bridle-tongue', count: 2, diaIn: tb, size: `${f2(tb)}" × ${bl} ${stainless(p)} carriage bolts through the tongue head and the beam, nylock nuts + fender washers on the rear face`, at: [[0, boltY, 0], [0, -boltY, 0]], note: 'one each side of the kingpin hole' },
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
    const keeper = chainKeeper(p, L); // D-56: the keeper cords that hold the chains' slack up
    const slack0 = L.chain.lenIn - Math.hypot(L.chain.anchor[0] - bEye0[0], L.chain.anchor[1] - bEye0[1], L.chain.anchor[2] - bEye0[2]);
    const along = (x0: number, x1: number, y: number, z: number) => compose([(x0 + x1) / 2, y, z], { y: Math.PI / 2 });
    // D-72: stock shoulder eye bolts (3/8-16, measured under the shoulder). The beam bolt crosses the 2-1/2 in beam, a 2 in fender washer and the nylock nut; the anchor crosses the joist and two washers (one under the shoulder).
    // A stock length that leaves more than 1/2 in of thread past the nut is cut to length after fitting (a hacksaw, a file and cold galvanizing compound).
    const beamEyeFit = stockBoltFit(b.thick, d, 1, EYE_BOLT_STOCK_IN);
    const anchorEyeFit = stockBoltFit(L.chain.joistT, d, 2, EYE_BOLT_STOCK_IN);
    const eyeText = (fit: ReturnType<typeof stockBoltFit>): string => `${inchesText(fit.stockIn)}" stock${fit.cutToIn ? `, cut to ${inchesText(fit.cutToIn)}" under the shoulder after fitting (${f2(fit.pastNutIn)}" of thread would stand past the nut)` : `, ${f2(fit.pastNutIn)}" of thread past the nut`}`;
    for (const { s, tag } of SIDES) {
      const side = tag === 'L' ? 'left' : 'right';
      parts.push(mk({
        id: `steer-eye-${tag}`, partNo: 'steer-eye', name: `Steering chain eye bolt, axle beam ${side}`, group: 'front-end', kind: 'purchased', material: `forged shoulder eye bolt, ${eyeBoltMat(p)}`,
        geometry: { type: 'cylinder', radius: d / 2, length: beamX1 - beamX0 }, transform: along(beamX0, beamX1, s * p.steerChainBeamYIn, L.chain.beamZ), massLb: eyeMass, body: 'front-axle', fab: 'buy', step: STEP.gear, explode: [-1, s * 0.4, 0],
        sourcing: { vendor: `McMaster-Carr (forged shoulder-type eye bolt ${frac(d)}" x ${eyeText(beamEyeFit)}, ${eyeBoltMat(p)}; ${f2(p.steerEyeWllLb)} lb rated in line; nylock nut + 2" OD fender washer on the front face of the beam)` },
        joints: [{ type: 'bolt', to: 'beam-F', count: 1, diaIn: d, size: `${frac(d)}" shoulder eye bolt fore-aft through the beam, nut and 2" washer on the front face`, at: [[0, 0, 0]], note: `${f2(p.steerChainBeamYIn)}" ${side} of the kingpin, mid depth` }, { type: 'pin', to: `steer-chain-${tag}`, count: 1, size: 'quick link to the chain' }],
        notes: `Beam end of the ${side} steering check chain (D-58): a ${frac(d)}" forged shoulder eye bolt through the axle beam fore-aft at mid depth, ${f2(p.steerChainBeamYIn)}" from the kingpin, below the stub axle rod in its groove, the eye standing ${f2(stand)}" out of the TRAILING face. The 2" washer and nylock nut on the front face spread the chain pull over the oak. Turn the eye in the plane of the chain.`,
      }));
      parts.push(mk({
        id: `steer-anchor-${tag}`, partNo: 'steer-anchor', name: `Steering chain anchor eye bolt, chain crossmember ${side}`, group: 'front-end', kind: 'purchased', material: `forged shoulder eye bolt, ${eyeBoltMat(p)}`,
        geometry: { type: 'cylinder', radius: d / 2, length: ancX1 - ancX0 }, transform: along(ancX0, ancX1, s * ay0, az), massLb: eyeMass, body: 'chassis', fab: 'buy', step: STEP.gear, explode: [-0.5, s * 0.4, -0.5],
        sourcing: { vendor: `McMaster-Carr (forged shoulder-type eye bolt ${frac(d)}" x ${eyeText(anchorEyeFit)}, ${eyeBoltMat(p)}; ${f2(p.steerEyeWllLb)} lb rated in line; nylock nut + 2" OD fender washer on the rear face of the chain crossmember, and a 2" washer under the shoulder on its front face)` },
        joints: [{ type: 'bolt', to: joistId(L, L.joistX.indexOf(L.king.x) - 1), count: 1, diaIn: d, size: `${frac(d)}" shoulder eye bolt fore-aft through the chain crossmember, the shoulder (with a 2" washer) on its front face, nut and 2" washer on the rear face`, at: [[0, 0, 0]], note: `${f2(ay0)}" off the center line` }, { type: 'pin', to: `steer-chain-${tag}`, count: 1, size: 'quick link to the chain', at: [[0, 0, 0]] }],
        notes: `Anchor of the ${side} steering check chain (D-58): a ${frac(d)}" forged shoulder eye bolt fore-aft through the chain crossmember (${f2(L.chain.joistT)}" thick, x ${f2(L.chain.joistX)}", the crossmember just behind the king beam), ${f2(ay0)}" off the center line, a little below mid depth, the eye standing ${f2(stand)}" out of the FRONT face (x ${f2(ax)}"). The chain pulls it forward and up toward the beam, out of the crossmember, so the 2" washer and nylock nut on the rear face carry the pull; the crossmember is glued to the rails at both ends, so the pull goes into the hull as plan bending of the crossmember and shear into the rails.`,
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
        id: `steer-chain-${tag}`, partNo: 'steer-chain', name: `Steering check chain ${side}`, group: 'front-end', kind: 'purchased', material: p.weatherSpec === WEATHER_SPEC.extreme ? '316 stainless chain' : 'galvanized grade 43 chain',
        geometry: { type: 'box', size: [dl, p.steerChainDiaIn * 1.5, p.steerChainDiaIn * 1.5] }, transform: [ux[0], ux[1], ux[2], 0, uy[0], uy[1], uy[2], 0, uz[0], uz[1], uz[2], 0, cx, cy, cz, 1],
        massLb: (chainLbFt * (L.chain.lenIn + 2)) / 12, body: 'chassis', fab: 'buy', step: STEP.spindles, explode: [-0.5, s * 0.5, -0.5],
        joints: [{ type: 'pin', to: `steer-eye-${tag}`, count: 1, size: 'quick link to the beam eye', at: [[-dl / 2, 0, 0]] }, { type: 'pin', to: `steer-anchor-${tag}`, count: 1, size: 'quick link to the anchor eye', at: [[dl / 2, 0, 0]] }, { type: 'pin', to: `steer-keeper-${tag}`, count: 2, size: `two links (${f2(keeper.linksFromBeamIn[0])}" and ${f2(keeper.linksFromBeamIn[1])}" from the beam eye ring) take the keeper cord's knots (D-56)`, at: keeper.linksFromBeamIn.map((l) => [-dl / 2 + (l / L.chain.lenIn) * dl, 0, 0] as [number, number, number]) }],
        sourcing: { vendor: `McMaster-Carr (${frac(p.steerChainDiaIn)}" ${p.weatherSpec === WEATHER_SPEC.extreme ? '316 stainless' : 'galvanized grade 43'} chain, ${f2(L.chain.lenIn + 2)}" cut, a quick link to each eye; rated ${f2(p.steerChainWllLb)} lb). Length: ${f2(L.chain.lenIn)}" between the eye rings so it goes taut exactly at the ${f2(p.steerLockDeg)}° lock (adjust at the quick link); drawn straight here with the axle straight, in the sled it hangs in a slack bight` },
        notes: `Steering check chain (D-58): from the beam eye (behind the trailing face of the axle beam) back, under the king beam, to the anchor eye (on the front of the chain crossmember behind the king beam), ${f2(L.chain.lenIn)}" between the eye rings. With the axle straight it hangs ${f2(slack0)}" slack; turning ${tag === 'R' ? 'left' : 'right'} to the ${f2(p.steerLockDeg)}° lock takes up the slack and stops the axle, the other chain slackens. It passes under the king beam (clear of it by the steer-clear row), clear of the tongue, the disc and the clamp plates. Replaces the oak stop blocks (they could not carry the hard-hit torque, D-58). A keeper cord (steer-keeper-${tag}) holds its slack bight up off the ground (D-56).`,
      }));
      // D-56: the keeper cord: one 1/8" shock cord through a screw eye under the deck, its ends knotted to two links of the chain (a V); drawn to those links' shares of the straight chain shown.
      {
        const E: [number, number, number] = [keeper.eye[0], s * Math.abs(keeper.eye[1]), keeper.eye[2]];
        const at = (f: number): [number, number, number] => [bx + dx * f, by + dy * f, bz + dz * f];
        const [P1, P2] = keeper.linksFromBeamIn.map((l) => at(l / L.chain.lenIn));
        const vsub = (u: number[], v: number[]): [number, number, number] => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
        const unit = (u: number[]): [number, number, number] => { const n = Math.hypot(u[0], u[1], u[2]) || 1; return [u[0] / n, u[1] / n, u[2] / n]; };
        const cross = (u: number[], v: number[]): [number, number, number] => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
        // local frame: x along the chord between the two links, y normal to the V's plane, z = x × y; the path (local x, z) runs link, eye, link
        const ex = unit(vsub(P2, P1));
        const nrm = cross(vsub(P1, E), vsub(P2, E));
        const ey = Math.hypot(nrm[0], nrm[1], nrm[2]) > 1e-9 ? unit(nrm) : unit(cross(ex, [0, 0, 1]));
        const ez = cross(ex, ey);
        const path: Vec2[] = [P1, E, P2].map((q) => [dot(vsub(q, E), ex), dot(vsub(q, E), ez)] as Vec2);
        const cordD = 0.125;
        const [n1, n2] = keeper.linksFromBeamIn;
        parts.push(mk({
          id: `steer-keeper-${tag}`, partNo: 'chain-keeper-cord', name: `Steering chain keeper cord ${side}`, group: 'front-end', kind: 'purchased', material: '1/8" shock cord (polyester sheath)',
          geometry: { type: 'sweep', path, width: cordD, thickness: cordD, plies: 1 }, transform: [ex[0], ex[1], ex[2], 0, ey[0], ey[1], ey[2], 0, ez[0], ez[1], ez[2], 0, E[0], E[1], E[2], 1],
          massLb: KEEPER_CORD_LB_PER_IN * keeper.cutIn, body: 'chassis', fab: 'buy', step: STEP.spindles, explode: [0, s * 0.3, 1],
          joints: [
            { type: 'screw', to: 'deck', count: 1, diaIn: SCREW_DIA_IN[10], at: [[0, 0, 0]], size: `#10 ${stainless(p)} screw eye with no more than 3/8" of thread, into the underside of the 12 mm deck (the tip stays inside the deck; not in the deck's Shaper file: set at the fit, ${f2(keeper.eye[0] - (L.chain.joistX + L.chain.joistT / 2))}" ahead of the chain crossmember's front face and ${f2(Math.abs(keeper.eye[1]))}" ${side} of the center line)` },
            { type: 'pin', to: `steer-chain-${tag}`, count: 2, at: [[path[0][0], 0, path[0][1]], [path[2][0], 0, path[2][1]]], size: `the cord's ends knotted through the chain links ${f2(n1)}" and ${f2(n2)}" from the beam eye ring` },
          ],
          sourcing: { vendor: `1/8" shock cord (bungee), ${f2(keeper.cutIn)}" cut a side (${f2(keeper.freeIn)}" between the knots), from a hardware-store foot; one small #10 ${stainless(p)} screw eye a side (3/8" thread)`, costUsd: 0.15 },
          notes: `Keeper cord (D-56): the ${side} steering chain hangs ${f2(slack0)}" slack with the axle straight and up to ${f2(L.chain.lenIn - Math.hypot(L.chain.anchor[0] - L.steer.beamEyeAt(-L.steer.lock)[0], L.chain.anchor[1] - L.steer.beamEyeAt(-L.steer.lock)[1], L.chain.anchor[2] - L.steer.beamEyeAt(-L.steer.lock)[2]))}" at the opposite lock, and its bight hung under the 3" ground clearance. One 1/8" shock cord, ${f2(keeper.cutIn)}" cut (${f2(keeper.freeIn)}" between the knots), runs up through a small screw eye in the underside of the deck, ${f2(keeper.eye[0] - (L.chain.joistX + L.chain.joistT / 2))}" ahead of the chain crossmember and ${f2(Math.abs(keeper.eye[1]))}" off the center line (aft of where the axle beam swings, so the cord never lies over it); one end is knotted to the chain link ${f2(n1)}" from the beam eye ring, the other to the link ${f2(n2)}" from it. With the chain taut at its lock the cord stretches to ${f2(keeper.lockIn)}" (${Math.round(p.steerKeeperStretchAtLock * 100)}%), so the chain still sets the lock. The steer-clear row checks the chain's lowest point over the lock range.`,
        }));
      }
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
