/** Running gear: wheels, axles (through rod or stubs), axle beams and U-bolt clamps (D-10, D-11, D-15). */
import { AXLE_BEAM_POSITION, AXLE_STYLE } from '../params';
import { STEP, box, cylinder, span, SIDES, type Ctx } from './build-utils';
import { multiply, translation } from './mat4';
import type { Part, RigidBody } from './types';

// ── Block-model placeholders ──
/** Hub outer diameter as a fraction of the wheel diameter, capped (viewer-only detail). */
const HUB_DIA_FRAC = 0.5;
const HUB_DIA_MAX_IN = 6;
/** Stub axle embedment into the beam (spec: hub + end extra + 4). */
const STUB_EMBED_IN = 4;
/** U-bolt plate size and fore-aft offset from the beam centreline (placeholders). */
const CLAMP_PLATE = { x: 0.8, y: 1.5, z: 0.375 } as const;
const CLAMP_X_OFFSET_IN = 0.8;
/** U-bolt + plate mass, estimate (spec). */
const CLAMP_MASS_LB = 0.35;

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
      bore: p.axleDiameterIn,
    },
    transform,
    body: id as RigidBody,
    massLb: d.wheelMassLb,
    fab: 'buy',
    step: STEP.gear,
    explode: [0, id.endsWith('L') ? 1 : -1, 0],
    notes: 'Catalog wheel mass from params (D-11).',
  });
  const ry = p.rearTrackIn / 2;
  const fy = p.frontTrackIn / 2;
  parts.push(
    wheel('wheel-RL', 'Rear left wheel', translation(0, ry, r)),
    wheel('wheel-RR', 'Rear right wheel', translation(0, -ry, r)),
    wheel('wheel-FL', 'Front left wheel', multiply(ctx.pivot, translation(L.WB, fy, r))),
    wheel('wheel-FR', 'Front right wheel', multiply(ctx.pivot, translation(L.WB, -fy, r))),
  );

  // Axles + beams + clamps, rear then front
  const axles: Array<{ tag: 'R' | 'F'; x: number; track: number; steer: boolean; beam: typeof L.beamR }> = [
    { tag: 'R', x: 0, track: p.rearTrackIn, steer: false, beam: L.beamR },
    { tag: 'F', x: L.WB, track: p.frontTrackIn, steer: true, beam: L.beamF },
  ];
  for (const ax of axles) {
    const name = ax.tag === 'R' ? 'rear' : 'front';
    if (p.axleStyle === AXLE_STYLE.throughRod) {
      parts.push(cylinder(ctx, {
        id: `axle-${ax.tag}`, name: `${name} axle (through rod)`, group: 'running-gear', steer: ax.steer,
        center: [ax.x, 0, r], axis: 'y', radius: rodR, length: ax.track + p.hubLengthIn + 2 * p.axleEndExtraIn,
        mat: 'steel', fab: 'drill-tap', step: STEP.gear, notes: 'Dead axle, clamped to the beam (D-10). Sits in a groove in the beam.',
      }));
    } else {
      const stubLen = p.hubLengthIn + p.axleEndExtraIn + STUB_EMBED_IN;
      const outer = ax.track / 2 + p.hubLengthIn / 2 + p.axleEndExtraIn;
      for (const { s, tag } of SIDES) {
        parts.push(cylinder(ctx, {
          id: `axle-${ax.tag}${tag}`, partNo: `stub-axle`, name: `${name} ${tag === 'L' ? 'left' : 'right'} stub axle`,
          group: 'running-gear', steer: ax.steer, center: [ax.x, s * (outer - stubLen / 2), r], axis: 'y',
          radius: rodR, length: stubLen, mat: 'steel', fab: 'drill-tap', step: STEP.gear,
          notes: `Embedded ${STUB_EMBED_IN}" into the beam (D-10).`,
        }));
      }
    }
    // Beam
    const b = ax.beam;
    parts.push(box(ctx, {
      id: `beam-${ax.tag}`, name: `${name} axle beam`, group: 'running-gear', steer: ax.steer, mat: 'oak',
      size: [b.thick, b.len, b.depth], center: [ax.x, 0, (b.top + b.bot) / 2], grain: 'y', fab: 'table-saw',
      step: STEP.gear, notes: p.axleBeamPosition === AXLE_BEAM_POSITION.underslung ? 'Underslung (D-15).' : 'Overslung (D-15).',
    }));
    // Clamps: 2 plates per wheel side, on the side of the rod away from the beam.
    const under = p.axleBeamPosition === AXLE_BEAM_POSITION.underslung;
    const yEdge = Math.min(b.len / 2 - 0.25, ax.track / 2 - p.tireWidthIn / 2);
    const yc = yEdge - CLAMP_PLATE.y / 2;
    const zc = under ? b.top + CLAMP_PLATE.z / 2 : b.bot - CLAMP_PLATE.z / 2;
    for (const { s, tag } of SIDES) {
      for (const [i, sx] of [[1, 1], [2, -1]] as const) {
        const sp = span([ax.x + sx * CLAMP_X_OFFSET_IN - CLAMP_PLATE.x / 2, ax.x + sx * CLAMP_X_OFFSET_IN + CLAMP_PLATE.x / 2],
          [s * yc - CLAMP_PLATE.y / 2, s * yc + CLAMP_PLATE.y / 2], [zc - CLAMP_PLATE.z / 2, zc + CLAMP_PLATE.z / 2]);
        parts.push(box(ctx, {
          id: `clamp-${ax.tag}${tag}${i}`, partNo: 'axle-clamp', name: `${name} ${tag === 'L' ? 'left' : 'right'} U-bolt + plate ${i}`,
          group: 'running-gear', steer: ax.steer, mat: 'fixed', massLb: CLAMP_MASS_LB, kind: 'purchased', material: 'zinc steel U-bolt + plate',
          ...sp, fab: 'buy', step: STEP.gear, notes: 'Mass is an estimate.',
        }));
      }
    }
  }
  return parts;
}
