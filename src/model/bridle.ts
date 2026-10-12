/**
 * The bridle tie (D-56): a bow shackle through the tie hole in the tip of the tongue plate (pivot.ts) and the bridle rope to the pullers. It replaces the bow eye
 * bolt and backing block of the first D-54 pass: the pullers now steer by pulling the tongue, which turns the front axle about the kingpin.
 * Everything here turns with the axle (`body: 'front-axle'`).
 */
import { STEP, type Ctx } from './build-utils';
import { translation } from './mat4';
import { circlePath, customPart, mergeMeshes, pathLength, tubeAlong } from './mesh-utils';
import type { Part, Vec3 } from './types';

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
const frac = (x: number) => {
  const w = Math.floor(x + 1e-9);
  let n = Math.round((x - w) * 16), d = 16;
  if (n === 0) return `${w}`;
  while (n % 2 === 0) { n /= 2; d /= 2; }
  return `${w > 0 ? `${w}-` : ''}${n}/${d}`;
};

/** Where the bridle ties: the tie hole x and the shackle / rope height (z), on the centerline. */
export function bridleTiePoint(ctx: Pick<Ctx, 'L'>): { x: number; z: number } {
  return { x: ctx.L.tongue.holeX, z: ctx.L.tongue.tieZ };
}

export function buildBridle(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const mk = (s: Parameters<typeof customPart>[1]) => customPart(ctx, s);
  const d = p.eyeBoltDiameterIn;
  const tie = bridleTiePoint(ctx);
  // Bow shackle: a ring in the vertical plane along the rope, its lower end through the tie hole in the tongue.
  const ringR = 0.75;
  const ringC: Vec3 = [tie.x + 0.2, 0, tie.z];
  const ring = circlePath(ringC, [0, 1, 0], ringR, 24);
  const em = mergeMeshes(tubeAlong(ring, d / 2, 8, true));
  const vol = Math.PI * (d / 2) ** 2 * pathLength(ring, true);
  parts.push(mk({
    id: 'bridle-eye', partNo: 'bridle-shackle', name: 'Bridle shackle (tongue tie)', group: 'front-end', kind: 'purchased', material: 'galvanized steel bow shackle',
    geometry: { type: 'mesh', positions: em.positions, indices: em.indices }, transform: translation(0, 0, 0), massLb: (vol / 1728) * p.steelDensityPcf + 0.1, body: 'front-axle',
    fab: 'buy', step: STEP.spindles, removable: true, explode: [1, 0, 0.3],
    sourcing: { vendor: `McMaster-Carr or equivalent: ${frac(d)}" screw-pin bow shackle (or a ${frac(d)}" eye bolt with its nut) through the ${frac(0.75)}" tie hole in the tongue tip. THE SHACKLE PIN IS THE INTENDED WEAK LINK of the rope tie (D-47): confirm its working-load limit is at least ${p.pullForceLbf * p.bridleTieOverloadFactor} lbf (bridle-eye row)` },
    joints: [{ type: 'pin', to: 'bridle-tongue', count: 1, diaIn: d, size: `${frac(d)}" shackle pin through the tie hole`, at: [[tie.x, 0, tie.z]] }, { type: 'pin', to: 'bridle', count: 1, size: 'bowline round the shackle bow' }],
    notes: `Bridle shackle (D-56, replaces the bow eye bolt): through the tie hole ${f2(L.tongue.tipX - L.tongue.holeX)}" from the tongue tip, ${f2(tie.z)}" above the ground, on the centerline. The team ties the bridle rope to it.`,
  }));
  const bl = 18;
  parts.push(mk({
    id: 'bridle', name: 'Bridle rope', group: 'front-end', kind: 'purchased', material: 'rope', geometry: { type: 'box', size: [bl, 0.5, 0.5] }, body: 'front-axle',
    transform: translation(tie.x + 0.2 + ringR + bl / 2, 0, tie.z), massLb: 0.5, fab: 'buy', step: STEP.spindles, removable: true, explode: [1, 0, 0],
    sourcing: { vendor: `McMaster-Carr or equivalent: 1/2" braided polyester rope (low stretch), ${Math.round(p.bridleRopeRunIn / 12)} ft pull tails + lead; tied to the shackle with a bowline` },
    joints: [{ type: 'pin', to: 'bridle-eye', count: 1, size: 'bowline to the shackle' }],
    notes: 'Single lead from the tongue tie (hidden in the viewer); the pull tails continue to the pullers (D-27). Pulling it steers the front axle: the tongue turns about the kingpin.',
  }));
  return parts;
}
