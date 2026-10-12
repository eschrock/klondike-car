/**
 * The pivoting front axle (D-56, Eric): a soapbox / billy-cart style center-pivot axle. One stout oak beam under the bow with a 10 in pneumatic wheel on a bolt-on stub
 * axle at EACH END, wheels outboard of the body so the deck stays low. The beam turns on ONE vertical kingpin bolt (SAE grade 8) at its center, through a steel tongue plate
 * and a large UHMW thrust washer into the KING BEAM, an oak crossmember between the rails (frame.ts). Two oak stop blocks under the end joist set the +/-lock.
 * The tongue plate carries the bridle to the pullers (bridle.ts). Bolted only: no welding. Everything that turns with the axle is `body: 'front-axle'`.
 */
import { STEP, box, cylinder, span, SIDES, type Ctx } from './build-utils';
import { customPart } from './mesh-utils';
import { translation } from './mat4';
import { boltLength, inchesText } from './rear-mount';
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

/** Tongue plate outline in plan (x, y): the wide bearing-plate head on the axle beam, a taper, then the bar out to the tip. */
export function tongueOutline(ctx: Pick<Ctx, 'p' | 'L'>): Vec2[] {
  const { p, L } = ctx;
  const kx = L.king.x;
  const hw = p.tongueHeadWidthIn / 2, bw = p.tongueWidthIn / 2;
  const xh0 = kx - Math.max(hw, p.kingThrustOdIn / 2 + 0.25);
  const xh1 = kx + Math.max(hw, p.kingThrustOdIn / 2 + 0.25);
  const xt = xh1 + 4;
  const tip = L.tongue.tipX;
  return [[xh0, -hw], [xh1, -hw], [xt, -bw], [tip, -bw], [tip, bw], [xt, bw], [xh1, hw], [xh0, hw]];
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
    notes: `The pivoting front axle beam (D-56): ${f2(b.thick)}" × ${f2(b.depth)}" × ${f2(b.len)}" white oak with the same underslung stack as the rear (top ${f2(b.top)}", bottom ${f2(b.bot)}"). A ${frac(kd)}" hole at its center takes the kingpin; a stub axle is bolted down in a groove in each end. Its top carries the steel tongue plate (and so the thrust washer). It turns about the kingpin, ±${p.steerLockDeg}° between the two steering stops, and passes under the shallower front rails.`,
  });
  parts.push(beam);

  // ── Stub axles and their clamp plates (as at the rear: rod in a groove, plates and 316 bolts pin it) ──
  const hub = p.hubLengthIn;
  const outer = p.frontTrackIn / 2 + hub / 2 + p.axleEndExtraIn;
  const inner = b.len / 2 - p.frontStubLenIn;
  const plate = { x: p.clampPlateLengthIn, y: p.clampPlateWidthIn, z: p.clampPlateThickIn };
  const legOffset = rodR + p.clampLegGapIn;
  const bd = p.uboltRodDiameterIn;
  const stations = [b.len / 2 - 0.25 - plate.y / 2, inner + 0.25 + plate.y / 2];
  for (const { s, tag } of SIDES) {
    const rod = cylinder(ctx, {
      id: `axle-F${tag}`, partNo: 'stub-axle-F', name: `Front ${tag === 'L' ? 'left' : 'right'} stub axle`, group: 'front-end',
      center: [b.x, s * (inner + outer) / 2, r], axis: 'y', radius: rodR, length: outer - inner, mat: 'steel', body: 'front-axle', fab: 'drill-tap', step: STEP.gear,
      notes: `Steel stub axle (D-56): a ${frac(p.axleDiameterIn)}" rod bolted down in a groove in the top of the beam end over ${f2(p.frontStubLenIn)}" (the clamp plates below), the wheel on the free end with a collar and cotter pin ${f2(p.axleEndExtraIn)}" beyond the hub.`,
      sourcing: { vendor: `McMaster-Carr (${frac(p.axleDiameterIn)}" 1045 turned-ground-polished shafting, cut ${f2(outer - inner)}" long; same stock as the rear axle; collar and cotter pin)` },
    });
    parts.push(rod);
    let k = 0;
    for (const yst of stations) for (const sx of [1, -1]) {
      k++;
      const sp = span([b.x + sx * legOffset - plate.x / 2, b.x + sx * legOffset + plate.x / 2], [s * yst - plate.y / 2, s * yst + plate.y / 2], [b.top, b.top + plate.z]);
      const grip = plate.z + b.depth;
      parts.push(box(ctx, {
        id: `clamp-F${tag}${k}`, partNo: 'axle-clamp', name: `Front ${tag === 'L' ? 'left' : 'right'} rod clamp plate ${k}`, group: 'front-end', mat: 'steel', kind: 'metal', material: '316 stainless flat bar',
        ...sp, body: 'front-axle', fab: 'drill-tap', step: STEP.gear,
        sourcing: { vendor: `McMaster-Carr (316 stainless flat bar ${plate.z}" × ${plate.y}": cut ${plate.x}" pieces, drill ${f2(bd + 0.03)}"; 316 hex bolt ${f2(bd)}" × ${inchesText(boltLength(grip, bd))}, nylock nut, fender washer)` },
        joints: [{ type: 'bolt', to: 'beam-F', count: 1, diaIn: bd, size: `${f2(bd)}" × ${inchesText(boltLength(grip, bd))} 316 hex bolt down through the plate and the beam, nylock nut + fender washer under the beam`, at: [[0, 0, 0]], note: 'beside the stub axle; the plate edge presses the rod into its groove' }],
        notes: 'Pins the front stub axle in its groove (the same plate and bolt as the rear clamps).',
      }));
      (beam.joints ??= []).push({ type: 'bolt', to: `clamp-F${tag}${k}`, count: 1, diaIn: bd, size: `${f2(bd)}" × ${inchesText(boltLength(grip, bd))} 316 hex bolt down through the clamp plate and the beam, nylock nut + fender washer under the beam`, at: [[sx * legOffset, s * yst, b.depth / 2]], note: 'beside the stub axle; the plate edge presses the rod into its groove' });
    }
  }

  // ── Thrust washer: UHMW disc between the tongue plate (turns with the axle) and the king beam (fixed) ──
  {
    const od = p.kingThrustOdIn, t = p.kingThrustThickIn;
    const z = L.tongue.z1 + t / 2;
    const vol = Math.PI * ((od / 2) ** 2 - (kd / 2 + 0.03) ** 2) * t;
    parts.push(mk({
      id: 'king-thrust', partNo: 'king-thrust', name: 'Kingpin thrust washer (UHMW)', group: 'front-end', kind: 'purchased', material: 'UHMW polyethylene washer',
      geometry: { type: 'cylinder', radius: od / 2, length: t }, transform: translation(kx, 0, z), massLb: (vol / 1728) * UHMW_PCF, body: 'chassis', fab: 'buy', step: STEP.gear, explode: [0, 0, 0.6],
      sourcing: { vendor: `McMaster-Carr (UHMW-PE sheet ${frac(t)}" thick, cut a ${f2(od)}" disc with a ${f2(kd + 0.06)}" bore; or a bought ${f2(od)}" flat UHMW thrust washer). Check the bearing pressure at the supplier's PV limit (steer-bearing row)` },
      notes: `The bearing the whole front load turns on (D-56): the king beam bears down through this ${f2(od)}" washer onto the steel tongue plate that lies on the axle beam. UHMW against steel, no grease needed (wipe off sand).`,
    }));
  }

  // ── Kingpin bolt: grade 8, head and plate washer under the beam, nut in a slot at the top of the king beam ──
  {
    const zHead = b.bot - 0.45;
    const zNutTop = L.king.top - 0.45;
    const len = zNutTop - zHead;
    const shank = cylinder(ctx, {
      id: 'kingpin', partNo: 'kingpin', name: 'Kingpin bolt (grade 8)', group: 'front-end', center: [kx, 0, zHead + len / 2], axis: 'z', radius: kd / 2, length: len, mat: 'steel',
      kind: 'purchased', material: 'SAE grade 8 hex bolt, zinc-yellow, with plate washers', body: 'front-axle', fab: 'buy', step: STEP.gear,
      massLb: steelLb(Math.PI * (kd / 2) ** 2 * len) + 0.2,
      sourcing: { vendor: `McMaster-Carr (grade 8 hex bolt ${frac(kd)}" × ${inchesText(len + 0.45)}, full-thread or ${f2(len - 2.5)}" shank; 2 grade 8 flat washers (one under the head, one under the nut), nylock nut; Loctite on the head washer)` },
      joints: [
        { type: 'bolt', to: 'beam-F', count: 1, diaIn: kd, size: `${frac(kd)}" grade 8 kingpin through the beam, head and plate washer under the beam`, at: [[0, 0, 0]], note: 'the beam turns on the bolt; the head washer clamps the bolt to the beam' },
        { type: 'pin', to: 'bridle-tongue', count: 1, diaIn: kd, size: `${frac(kd)}" kingpin hole`, at: [[0, 0, 0]] },
      ],
      notes: `Kingpin (D-56): one ${frac(kd)}" SAE grade 8 bolt, head down under the axle beam with a plate washer, up through the beam, the tongue plate, the UHMW washer and the king beam, nylock nut and washer in the slot at the top of the king beam (snug, then backed off a quarter turn so the axle swings freely). It carries the pull of the bridle, the sideways loads and the rebound. The vertical load goes through the thrust washer, not the bolt.`,
    });
    parts.push(shank);
  }

  // ── Tongue plate: A36 flat bar on the axle beam, bearing plate under the thrust washer, reaching forward under the deck and the bow to the bridle tie ──
  {
    const outline = tongueOutline(ctx);
    let a2 = 0, per = 0;
    for (let i = 0; i < outline.length; i++) { const [px, py] = outline[i], [qx, qy] = outline[(i + 1) % outline.length]; a2 += px * qy - qx * py; per += Math.hypot(qx - px, qy - py); }
    void per;
    const area = Math.abs(a2) / 2 - Math.PI * ((kd + 0.03) / 2) ** 2 - Math.PI * 0.3125 ** 2 - 2 * Math.PI * ((p.tongueBoltDiaIn + 0.03) / 2) ** 2;
    const len = L.tongue.tipX - (kx - p.tongueHeadWidthIn / 2);
    const boltY = Math.max(p.kingThrustOdIn / 2 + p.tongueBoltDiaIn / 2 + 0.08, 1.4);
    const tb = p.tongueBoltDiaIn;
    const grip = p.tongueThickIn + b.depth;
    parts.push(mk({
      id: 'bridle-tongue', partNo: 'bridle-tongue', name: 'Bridle tongue plate', group: 'front-end', kind: 'metal', material: 'A36 steel flat bar',
      geometry: { type: 'extrusion', outline, depth: p.tongueThickIn }, transform: translation(0, 0, L.tongue.z0), massLb: steelLb(area * p.tongueThickIn), body: 'front-axle',
      fab: 'outsource', step: STEP.spindles, removable: true, explode: [1, 0, 0.1],
      stock: { t: p.tongueThickIn, w: p.tongueHeadWidthIn, l: len },
      sourcing: { vendor: `A36 flat plate ${frac(p.tongueThickIn)}" thick (waterjet or bandsaw from ${f2(p.tongueHeadWidthIn)}" bar, ${f2(len)}" long: the head ${f2(p.tongueHeadWidthIn)}" wide at the kingpin, tapering to a ${f2(p.tongueWidthIn)}" bar); drill ${frac(kd + 0.03)}" for the kingpin, 2 × ${f2(tb + 0.03)}" for the plate bolts, and 3/4" at the tie hole ${f2(L.tongue.tipX - L.tongue.holeX)}" from the tip; paint or galvanize. Bolted, not welded` },
      joints: [
        { type: 'bolt', to: 'beam-F', count: 2, diaIn: tb, size: `${f2(tb)}" × ${inchesText(boltLength(grip, tb))} 316 hex bolts down through the plate and the beam, nylock nuts + fender washers under the beam`, at: [[kx, boltY, p.tongueThickIn / 2], [kx, -boltY, p.tongueThickIn / 2]], note: 'one each side of the kingpin, outside the thrust washer' },
        { type: 'pin', to: 'kingpin', count: 1, diaIn: kd, size: `${frac(kd)}" kingpin hole`, at: [[kx, 0, p.tongueThickIn / 2]] },
        { type: 'pin', to: 'bridle-eye', count: 1, diaIn: p.eyeBoltDiameterIn, size: `${f2(p.eyeBoltDiameterIn)}" shackle pin through the tie hole`, at: [[L.tongue.holeX, 0, p.tongueThickIn / 2]] }, // the plate's local frame is the model frame (extrusion in absolute x, y)
      ],
      notes: `Bridle tongue plate (D-56): ${frac(p.tongueThickIn)}" A36 flat bar, ${f2(len)}" long, lying on top of the axle beam (z ${f2(L.tongue.z0)}" to ${f2(L.tongue.z1)}"). The wide head is the steel bearing face for the UHMW thrust washer and is bolted to the beam by two ${f2(tb)}" bolts outside the washer; the bar runs forward UNDER the deck and the bow to ${f2(p.tongueTieAheadIn)}" past the bow tip, where the bridle shackle goes through the tie hole. Pulling the bridle steers the axle and tows the cart (through the kingpin). Unbolts for transport.`,
    }));
    // the beam's side of the two plate bolts
    beam.joints = [...(beam.joints ?? []), { type: 'bolt', to: 'bridle-tongue', count: 2, diaIn: tb, size: `${f2(tb)}" × ${inchesText(boltLength(grip, tb))} 316 hex bolts down through the plate and the beam, nylock nuts + fender washers under the beam`, at: [[0, boltY, b.depth / 2 - 0.0], [0, -boltY, b.depth / 2]], note: 'one each side of the kingpin, outside the thrust washer' },
      { type: 'bolt', to: 'kingpin', count: 1, diaIn: kd, size: `${frac(kd)}" kingpin hole through the beam centre`, at: [[0, 0, 0]] }];
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
