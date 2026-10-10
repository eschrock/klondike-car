/** Steering: turntable, bolster, kingpin, stops, tongue, bridle (D-12, D-14). */
import { DRAWBAR } from '../params';
import { STEP, box, cylinder, span, SIDES, type Ctx } from './build-utils';
import { BOLSTER_MIN_DEPTH_IN } from './layout';
import type { Part } from './types';

// ── Block-model placeholders ──
/** Turntable mass: purchased lazy-susan, estimate (spec). */
const TURNTABLE_MASS_LB = 3.5;
/** Steering stop block (x, y, z) and its offset from the turntable edge (spec). */
const STOP_SIZE = [1.5, 1.5, 1] as const;
const STOP_OFFSET_IN = 1;
/** Tongue cross-section y × z (spec: 1 × 2.5). */
const TONGUE_Y_IN = 1;
const TONGUE_Z_IN = 2.5;
/** Bridle rope: reach ahead of the tongue tip, section, mass (spec). */
const BRIDLE_LEN_IN = 18;
const BRIDLE_SECTION_IN = 0.5;
const BRIDLE_MASS_LB = 1;

export function buildSteering(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const ts = p.turntableSizeIn;
  const WB = L.WB;

  parts.push(box(ctx, {
    id: 'turntable', name: 'Turntable (lazy susan)', group: 'steering', steer: true, mat: 'fixed', massLb: TURNTABLE_MASS_LB,
    kind: 'purchased', material: 'steel turntable bearing', fab: 'buy', step: STEP.steering,
    ...span([WB - ts / 2, WB + ts / 2], [-ts / 2, ts / 2], [L.turntable.z0, L.turntable.z1]),
    notes: 'Estimate mass; 1000 lb rated (D-12). Fixed plate belongs to the bolster in reality.',
  }));

  const bo = L.bolster;
  parts.push(box(ctx, {
    id: 'bolster', name: 'Front bolster', group: 'steering', mat: 'oak', grain: 'y', step: STEP.steering,
    ...span([bo.x0, bo.x1], [-L.hwN, L.hwN], [bo.z0, bo.z1]),
    notes: bo.z1 - bo.z0 <= BOLSTER_MIN_DEPTH_IN + 1e-9 ? 'Depth raised to the 3/4" minimum; see the validator warning.' : undefined,
  }));

  parts.push(cylinder(ctx, {
    id: 'kingpin', name: 'Kingpin (grade-8 bolt)', group: 'steering', mat: 'steel', kind: 'purchased', fab: 'buy', step: STEP.steering,
    center: [WB, 0, (L.kingpin.z0 + L.kingpin.z1) / 2], axis: 'z', radius: p.kingpinDiameterIn / 2,
    length: L.kingpin.z1 - L.kingpin.z0, notes: 'Mass is the steel shank only; nut and washers are in the hardware allowance.',
  }));

  for (const { s, tag } of SIDES) {
    const y = s * (ts / 2 + STOP_OFFSET_IN);
    parts.push(box(ctx, {
      id: `steer-stop-${tag}`, partNo: 'steer-stop', name: `Steering stop ${tag}`, group: 'steering', steer: true, mat: 'oak',
      size: [...STOP_SIZE], center: [WB, y, L.beamF.top + STOP_SIZE[2] / 2], step: STEP.steering,
    }));
  }

  const beamCz = (L.beamF.top + L.beamF.bot) / 2;
  const tongueX0 = WB + p.axleBeamThicknessIn / 2;
  let tipX = tongueX0;
  if (p.drawbar === DRAWBAR.woodTongue) {
    tipX = WB + p.tongueLengthIn;
    parts.push(box(ctx, {
      id: 'tongue', name: 'Tongue', group: 'steering', steer: true, mat: 'oak', removable: true, step: STEP.steering, grain: 'x',
      ...span([tongueX0, Math.max(tongueX0 + 1, tipX)], [-TONGUE_Y_IN / 2, TONGUE_Y_IN / 2], [beamCz - TONGUE_Z_IN / 2, beamCz + TONGUE_Z_IN / 2]),
      notes: 'Pins off for transport (D-9).',
    }));
  }
  parts.push(box(ctx, {
    id: 'bridle', name: 'Bridle rope', group: 'steering', steer: true, mat: 'fixed', massLb: BRIDLE_MASS_LB, kind: 'purchased',
    material: 'rope', fab: 'buy', removable: true, step: STEP.steering,
    ...span([tipX, tipX + BRIDLE_LEN_IN], [-BRIDLE_SECTION_IN / 2, BRIDLE_SECTION_IN / 2], [beamCz - BRIDLE_SECTION_IN / 2, beamCz + BRIDLE_SECTION_IN / 2]),
    notes: 'Estimate mass; drawn as a straight bar.',
  }));
  return parts;
}
