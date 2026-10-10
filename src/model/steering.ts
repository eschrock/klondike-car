/** Steering: turntable, bolster, kingpin, stops, tongue, bridle (D-12, D-14). */
import { DRAWBAR } from '../params';
import { STEP, box, cylinder, span, SIDES, type Ctx } from './build-utils';
import type { Part } from './types';

// ── Block-model placeholders ──
/** Steering stop block (x, y, z); its gap outboard of the bolster end (spec). */
const STOP_SIZE = [1.5, 1.5, 1] as const;
const STOP_GAP_IN = 0.125;
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

  // Side bearers (D-12, critic M5): rub blocks on the beam top beside the turntable plate. They turn with the
  // beam and stand `sideBearerClearanceIn` below the bolster end rails, so roll moment goes bolster -> block -> beam.
  const sb = L.sideBearer;
  for (const { s, tag } of SIDES) {
    parts.push(box(ctx, {
      id: `side-bearer-${tag}`, partNo: 'side-bearer', name: `Side-bearer rub block ${tag}`, group: 'steering', steer: true, mat: 'oak', grain: 'x', step: STEP.steering,
      ...span([L.beamF.x - L.beamF.thick / 2, L.beamF.x + L.beamF.thick / 2], [Math.min(s * sb.y0, s * sb.y1), Math.max(s * sb.y0, s * sb.y1)], [sb.z0, sb.z1]),
      notes: `${p.sideBearerClearanceIn}" running clearance to the bolster end rail; carries roll and pitch moment (D-12).`,
    }));
  }

  // Kingpin: ahead of the axle (D-25), through the solid beam and the turntable centre.
  parts.push(cylinder(ctx, {
    id: 'kingpin', name: 'Kingpin (grade-8 bolt)', group: 'steering', mat: 'steel', kind: 'purchased', fab: 'buy', step: STEP.steering,
    center: [kx, 0, (L.kingpin.z0 + L.kingpin.z1) / 2], axis: 'z', radius: p.kingpinDiameterIn / 2,
    length: L.kingpin.z1 - L.kingpin.z0, notes: 'Mass is the steel shank only; nut and washers are in the hardware allowance. Head is let into the turntable plate.',
  }));

  // Steering stops stand on the beam just outboard of the bolster ends and bear on them at lock.
  for (const { s, tag } of SIDES) {
    const y = s * (bo.halfY + STOP_GAP_IN + STOP_SIZE[1] / 2);
    parts.push(box(ctx, {
      id: `steer-stop-${tag}`, partNo: 'steer-stop', name: `Steering stop ${tag}`, group: 'steering', steer: true, mat: 'oak',
      size: [...STOP_SIZE], center: [L.beamF.x, y, L.beamF.top + STOP_SIZE[2] / 2], step: STEP.steering,
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
