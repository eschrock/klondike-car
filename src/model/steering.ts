/** Steering: turntable, bolster, kingpin, stops, tongue, bridle (D-12, D-14). */
import { DRAWBAR, steerStopPlan } from '../params';
import { IN3_PER_FT3, STEP, box, cylinder, span, SIDES, type Ctx } from './build-utils';
import type { Part } from './types';

// ── Block-model placeholders ──
/** Bridle rope: reach ahead of the tongue tip, section, mass (spec). */
const BRIDLE_LEN_IN = 18;
const BRIDLE_SECTION_IN = 0.5;
const BRIDLE_MASS_LB = 1;

export function buildSteering(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const ts = p.turntableSizeIn;
  const kx = L.kx;

  parts.push(box(ctx, {
    id: 'turntable', name: 'Turntable (lazy susan)', group: 'steering', steer: true, mat: 'fixed', massLb: p.turntableMassLb,
    kind: 'purchased', material: 'steel turntable bearing', fab: 'buy', step: STEP.steering,
    ...span([kx - ts / 2, kx + ts / 2], [-ts / 2, ts / 2], [L.turntable.z0, L.turntable.z1]),
    notes: 'Centred on the kingpin (D-25). Estimate mass; 1000 lb rated (D-12). Its top plate carries the bolster rails.',
  }));

  // Bolster: two oak rails fore and aft of the kingpin plus two end rails, bearing on the turntable top plate.
  // The deck above is carried by the ring; the middle is open for the kingpin head.
  const bo = L.bolster;
  const depthNote = bo.z1 - bo.z0 <= p.bolsterMinDepthIn + 1e-9 ? 'Depth raised to the minimum; see the validator.' : undefined;
  for (const [tag, name, x0, x1] of [['fore', 'Front', bo.x1 - bo.rw, bo.x1], ['aft', 'Rear', bo.x0, bo.x0 + bo.rw]] as const) {
    parts.push(box(ctx, {
      id: `bolster-${tag}`, name: `${name} bolster rail`, group: 'steering', mat: 'oak', grain: 'y', step: STEP.steering,
      ...span([x0, x1], [-bo.halfY, bo.halfY], [bo.z0, bo.z1]), notes: depthNote,
    }));
  }
  for (const { s, tag } of SIDES) {
    parts.push(box(ctx, {
      id: `bolster-end-${tag}`, partNo: 'bolster-end', name: `Bolster end rail ${tag}`, group: 'steering', mat: 'oak', grain: 'x', step: STEP.steering,
      ...span([bo.x0 + bo.rw, bo.x1 - bo.rw], [Math.min(s * (bo.halfY - bo.rw), s * bo.halfY), Math.max(s * (bo.halfY - bo.rw), s * bo.halfY)], [bo.z0, bo.z1]),
      notes: 'Rides over the side-bearer rub block (D-12).',
    }));
  }

  // Side bearers (D-12, critic r2 M5): oak blocks housed in the beam top beside the turntable plate, just ahead of the rod
  // groove, each with a UHMW wear strip. They turn with the beam and stand `sideBearerClearanceIn` below the bolster rails,
  // so roll moment goes bolster rail -> wear strip -> block -> beam (the turntable is not moment-rated).
  const sb = L.sideBearer;
  for (const { s, tag } of SIDES) {
    const yr: [number, number] = [Math.min(s * sb.y0, s * sb.y1), Math.max(s * sb.y0, s * sb.y1)];
    parts.push(box(ctx, {
      id: `side-bearer-${tag}`, partNo: 'side-bearer', name: `Side-bearer block ${tag}`, group: 'steering', steer: true, mat: 'oak', grain: 'z', step: STEP.steering,
      ...span([sb.x0, sb.x1], yr, [sb.z0, sb.z1]),
      notes: `Housed ${p.sideBearerEmbedIn}" into a mortise in the beam top (glued + screwed); carries roll and pitch moment under the bolster rail (D-12).`,
    }));
    const wearVol = (sb.x1 - sb.x0) * (sb.y1 - sb.y0) * p.sideBearerWearIn;
    parts.push(box(ctx, {
      id: `side-bearer-wear-${tag}`, partNo: 'side-bearer-wear', name: `Side-bearer UHMW wear strip ${tag}`, group: 'steering', steer: true, mat: 'fixed',
      massLb: (wearVol / 1728) * p.uhmwDensityPcf, kind: 'purchased', material: 'UHMW-PE strip', fab: 'buy', step: STEP.steering,
      ...span([sb.x0, sb.x1], yr, [sb.z1, sb.zw]),
      notes: `${p.sideBearerClearanceIn}" running clearance to the bolster rail underside (the chassis-side bearer face); screwed to the block.`,
    }));
  }

  // Kingpin: ahead of the axle (D-25), through the solid beam and the turntable centre and, with kingpinThroughBolster (D-12),
  // on up through the oak crossbar let into the bolster, where the nut and washer sit on the crossbar top.
  const cb = L.crossbar;
  parts.push(cylinder(ctx, {
    id: 'kingpin', name: 'Kingpin (grade-8 bolt)', group: 'steering', mat: 'steel', kind: 'purchased', fab: 'buy', step: STEP.steering,
    center: [kx, 0, (L.kingpin.z0 + L.kingpin.z1) / 2], axis: 'z', radius: p.kingpinDiameterIn / 2,
    length: L.kingpin.z1 - L.kingpin.z0,
    notes: cb
      ? 'Mass is the steel shank only; nut and washers are in the hardware allowance. Washer under the beam, nut + washer on the crossbar top (counterbored flush).'
      : 'Mass is the steel shank only; nut and washers are in the hardware allowance. Head is let into the turntable plate.',
  }));

  // Chassis-side kingpin crossbar (D-12): fore-aft oak bar across the bolster opening, ends let into the bolster rails, top flush with them.
  if (cb) {
    parts.push(box(ctx, {
      id: 'kingpin-crossbar', name: 'Kingpin crossbar', group: 'steering', mat: 'oak', grain: 'x', step: STEP.steering,
      ...span([cb.x0, cb.x1], [-cb.hw, cb.hw], [cb.z0, cb.z1]),
      notes: `Ties the kingpin to the chassis (real wagon practice). Ends let ${p.kingpinCrossbarLetInIn}" into the fore and aft bolster rails, top flush; bolted down to the turntable top plate. Clear of the steering stops over the full ±${p.steerLockDeg}° sweep.`,
    }));
  }

  // Steel sleeves (kingpinSleeveOdIn > 0): tube with ID = pin, pressed into the beam bore and the crossbar bore.
  if (p.kingpinSleeveOdIn > 0) {
    const od = p.kingpinSleeveOdIn, id = p.kingpinDiameterIn;
    const tube = (len: number) => (Math.PI / 4) * (od * od - id * id) * len;
    const ends: Array<[string, string, number, number, boolean]> = [['beam', 'beam', L.beamF.bot, L.beamF.top, true]];
    if (cb) ends.push(['bar', 'crossbar', cb.z0, cb.z1, false]);
    for (const [tag, where, z0, z1, steer] of ends) {
      parts.push(cylinder(ctx, {
        id: `kingpin-sleeve-${tag}`, partNo: 'kingpin-sleeve', name: `Kingpin sleeve (${where} bore)`, group: 'steering', steer, mat: 'fixed',
        massLb: (tube(z1 - z0) / IN3_PER_FT3) * p.steelDensityPcf, kind: 'purchased', material: 'steel tube (A36 / 1018)', fab: 'buy', step: STEP.steering,
        center: [kx, 0, (z0 + z1) / 2], axis: 'z', radius: od / 2, length: z1 - z0,
        notes: `${od}" OD × ${id}" ID steel tube, ${(z1 - z0).toFixed(2)}" long, pressed into the ${where} bore; the oak bears on the OD and the pin on the bore. Drawn solid.`,
      }));
    }
  }

  // Steering stops (H1): square oak posts on the turntable plate inside the bolster opening. Each lands flat on the aft
  // bolster rail's inner face exactly at lock (derived analytically in steerStopPlan); the left post stops +steer, the
  // right post (mirror) stops −steer.
  const stop = steerStopPlan(p);
  const stopH = Math.max(0.25, Math.min(p.steerStopHeightIn, bo.z1 - bo.z0 - p.sideBearerClearanceIn));
  for (const { s, tag } of SIDES) {
    parts.push(box(ctx, {
      id: `steer-stop-${tag}`, partNo: 'steer-stop', name: `Steering stop post ${tag}`, group: 'steering', steer: true, mat: 'oak', grain: 'z', step: STEP.steering,
      size: [stop.size, stop.size, stopH], center: [kx + stop.cx, s * stop.cy, bo.z0 + stopH / 2], rot: { z: s * stop.rotZ },
      notes: `Bears flat on the aft bolster rail face at exactly ±${p.steerLockDeg}° of lock; bolted through the turntable plate (D-12).`,
    }));
  }

  // Tongue runs forward from the beam, inside the beam's own height so it never reaches the turntable.
  const tongueDepth = Math.min(p.tongueDepthIn, L.beamF.depth);
  const tongueCz = L.beamF.top - tongueDepth / 2;
  const tongueX0 = L.beamF.x + L.beamF.thick / 2;
  let tipX = tongueX0;
  if (p.drawbar === DRAWBAR.woodTongue) {
    tipX = L.WB + p.tongueLengthIn;
    parts.push(box(ctx, {
      id: 'tongue', name: 'Tongue', group: 'steering', steer: true, mat: 'oak', removable: true, step: STEP.steering, grain: 'x',
      ...span([tongueX0, Math.max(tongueX0 + 1, tipX)], [-p.tongueThickIn / 2, p.tongueThickIn / 2], [tongueCz - tongueDepth / 2, tongueCz + tongueDepth / 2]),
      notes: 'Pins off for transport (D-9). Length is measured from the front axle (overall length, D-23).',
    }));
  }
  parts.push(box(ctx, {
    id: 'bridle', name: 'Bridle rope', group: 'steering', steer: true, mat: 'fixed', massLb: BRIDLE_MASS_LB, kind: 'purchased',
    material: 'rope', fab: 'buy', removable: true, step: STEP.steering,
    ...span([tipX, tipX + BRIDLE_LEN_IN], [-BRIDLE_SECTION_IN / 2, BRIDLE_SECTION_IN / 2], [tongueCz - BRIDLE_SECTION_IN / 2, tongueCz + BRIDLE_SECTION_IN / 2]),
    notes: 'Estimate mass; drawn as a straight bar.',
  }));
  return parts;
}
