/**
 * The bridle tie (D-56, D-58, D-62): the bridle rope runs through the bronze sleeve in the oak tongue near its tip (pivot.ts), once round the tip, and is tied with a bowline round
 * its own standing part; the rope goes on to the pullers. There is NO shackle (D-62, eng 3c MUST-2): a catalog screw-pin shackle does not fit the 1-1/4 in tongue and is far stronger than
 * the tie load, so it never was a weak link. The pullers steer by pulling the tongue, which turns the front axle about the kingpin.
 * Everything here turns with the axle (`body: 'front-axle'`).
 */
import { STEP, type Ctx } from './build-utils';
import { translation } from './mat4';
import { customPart } from './mesh-utils';
import type { Part } from './types';

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
const frac = (x: number) => {
  const w = Math.floor(x + 1e-9);
  let n = Math.round((x - w) * 16), d = 16;
  if (n === 0) return `${w}`;
  while (n % 2 === 0) { n /= 2; d /= 2; }
  return `${w > 0 ? `${w}-` : ''}${n}/${d}`;
};

/** Where the bridle ties: the tie hole x and the rope height (z), on the centerline. */
export function bridleTiePoint(ctx: Pick<Ctx, 'L'>): { x: number; z: number } {
  return { x: ctx.L.tongue.holeX, z: ctx.L.tongue.tieZ };
}

/** Linear density of 3/8 in three-strand nylon rope (lb/ft); it goes with the diameter squared. */
const NYLON_LB_PER_FT_AT_3_8 = 0.0237;
/** Rope beyond the pullers' run: the lead from the tongue to where the tails start, and the tails' extra length (in). */
const BRIDLE_EXTRA_IN = 36;

export function bridleRopeKnot(p: Ctx['p']) {
  const d = p.bridleRopeDiaIn;
  const rated = p.bridleRopeBreakLbf;
  return { dia: d, rated, knotted: rated * p.bridleKnotEfficiency, wll: rated * p.bridleRopeWllFraction };
}

export function buildBridle(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const mk = (s: Parameters<typeof customPart>[1]) => customPart(ctx, s);
  const d = p.bridleRopeDiaIn;
  const tie = bridleTiePoint(ctx);
  const rk = bridleRopeKnot(p);
  const bl = 18; // drawn length of the lead (the pull tails continue to the pullers)
  const lenFt = (p.bridleRopeRunIn + BRIDLE_EXTRA_IN) / 12;
  const massLb = NYLON_LB_PER_FT_AT_3_8 * (d / 0.375) ** 2 * lenFt;
  parts.push(mk({
    id: 'bridle', name: 'Bridle rope (nylon)', group: 'front-end', kind: 'purchased', material: 'nylon rope', geometry: { type: 'box', size: [bl, d, d] }, body: 'front-axle',
    transform: translation(L.tongue.tipX + 0.6 + bl / 2, 0, tie.z), massLb, fab: 'buy', step: STEP.spindles, explode: [1, 0, 0],
    sourcing: { vendor: `McMaster-Carr or equivalent: ${frac(d)}" three-strand NYLON rope (rated about ${Math.round(rk.rated)} lbf breaking, verify), ${lenFt.toFixed(0)} ft: ${Math.round(p.bridleRopeRunIn / 12)} ft to the pullers' hands plus the lead and the tails. NOT low-stretch polyester: nylon stretches 15 to 25 percent and absorbs the snatch when the slack comes taut (D-62). Optional: splice in 3 ft of ${frac(d)}" shock cord near the tongue.` },
    joints: [{ type: 'pin', to: 'bridle-sleeve', count: 1, size: 'one strand through the sleeve, once round the tongue tip, bowline round its own standing part' }],
    notes: `Bridle rope (D-62): ${frac(d)}" nylon three-strand. THE ROPE IS THE DOCUMENTED WEAK LINK of the tie: working load limit ${Math.round(rk.wll)} lbf (${Math.round(p.bridleRopeWllFraction * 100)}% of ${Math.round(rk.rated)} lbf), and at the bowline it breaks at about ${Math.round(rk.knotted)} lbf (a bowline keeps about ${Math.round(p.bridleKnotEfficiency * 100)}%); replace it when it is glazed, cut or stiff. Tie: pass the end through the bronze sleeve, once round the tongue tip, and bowline it round the standing part (one strand in the bore, the end whipped); the sleeve bore is eased so the rope bears on a round edge. Single lead from the tongue tie (hidden in the viewer); the pull tails continue to the pullers (D-27). Pulling it steers the front axle: the tongue turns about the kingpin. Nylon is the snatch absorber: bridle-eye checks the slack-then-taut case.`,
  }));
  void f2;
  return parts;
}
