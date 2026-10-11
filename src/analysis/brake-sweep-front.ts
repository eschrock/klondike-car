/**
 * Front brake sweep (WS-C, D-56): the horn, swing arms, pins, shoes and the exposed housing loop ride on the knuckle, so they are posed with the knuckle's
 * rigid pose (`poseMatrices(ack, solveSteer(ack, d))`) at every steer angle from the outer to the inner tow lock and tested against the fixed chassis
 * solids (hull, rails, beam, brackets, tongue at neutral). The shoe-to-tire gap and the arm-to-tire gap do not change with steering (rigid with the wheel);
 * they are measured once at neutral.
 */
import { partOBB, partOBBs, obbOverlap } from '../model/bounds';
import { lockLimits, poseMatrices, solveSteer } from '../model/ackermann';
import { multiply } from '../model/mat4';
import { housingAnchor, housingStop } from '../model/brake-front';
import type { Part, Vec3 } from '../model/types';
import type { Ctx } from './context';
import { chainOf } from './brake-chain';
import { transformPoint } from '../model/bounds';

export interface FrontSweepResult {
  on: boolean;
  /** Smallest clearance (in) of a front brake part (shoe included) to a chassis solid over the sweep, and the pair. */
  minToHullIn: number;
  moving: string;
  other: string;
  steerDeg: number;
  /** Radial gap of the shoe lining to the tread at neutral, released (in), and the least gap of the arms, horn and pins to the tire. */
  shoeGapIn: number;
  /** Least radial gap over the lining ends (the shoe swivels on its pin to conform, so only the centre gap is the stroke). */
  shoeEndGapIn: number;
  armToTireIn: number;
  /** Housing stop to housing anchor chord: min and max over the sweep (in), and the free length and the bend radius at the shortest chord. */
  chordMinIn: number;
  chordMaxIn: number;
  freeLenIn: number;
  bendRadiusIn: number;
  /** Lowest point of any front brake part at neutral and over the sweep (in). */
  groundMinZ: number;
  poses: number;
}

const BIG = 99;
const FRONT_ID = /^(brake-front-|brake-shoe-arm-F|brake-shoe-pivot-F|brake-shoe-pin-F|brake-shoe-F)/;
const MOVING_ID = /^(brake-front-horn|brake-shoe-arm-F|brake-shoe-pivot-F|brake-shoe-pin-F|brake-shoe-F)/;

function tireDistance(pt: Vec3, c: Vec3, r: number, hw: number): number {
  const dr = Math.hypot(pt[0] - c[0], pt[2] - c[2]) - r;
  const dy = Math.max(Math.abs(pt[1] - c[1]) - hw, 0);
  return Math.hypot(Math.max(dr, 0), dy);
}

function samples(parts: Part[]): Vec3[] {
  const out: Vec3[] = [];
  for (const x of parts) {
    const o = partOBB(x);
    for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 2; k++) {
      const a = i - 1, b = j - 1, c = k - 1;
      out.push([0, 1, 2].map((m) => o.center[m] + o.axes[0][m] * o.half[0] * a + o.axes[1][m] * o.half[1] * b + o.axes[2][m] * o.half[2] * c) as Vec3);
    }
  }
  return out;
}

const cache = new WeakMap<Ctx, FrontSweepResult>();

/** Gap (in) between a moving point set and a tire/wheel part, at neutral. */
export function frontBrakeSweep(ctx: Ctx, stepDeg = 3): FrontSweepResult {
  const hit = cache.get(ctx);
  if (hit) return hit;
  const ch = chainOf(ctx);
  const empty: FrontSweepResult = { on: false, minToHullIn: BIG, moving: '–', other: '–', steerDeg: 0, shoeGapIn: BIG, shoeEndGapIn: BIG, armToTireIn: BIG, chordMinIn: BIG, chordMaxIn: BIG, freeLenIn: 0, bendRadiusIn: BIG, groundMinZ: BIG, poses: 0 };
  if (!ch.frontOn) return empty;
  const { p, L } = ctx;
  const ack = L.front.ack;
  const mine = ctx.parts.filter((x) => FRONT_ID.test(x.id));
  if (mine.length === 0) return empty;
  const obstacles = ctx.parts
    .filter((x) => !x.payload && x.group !== 'reference' && x.body === 'chassis' && !FRONT_ID.test(x.id) && !/^(wheel-|brake-hip|hip-|belt-|lap-belt|seat-|storage-|brake-(lever|link|crank|quadrant|pawl|bearing|shaft|arm|hub|shoe|rail|return|bias|lost))/.test(x.id))
    .flatMap((x) => partOBBs(x).map((o) => ({ id: x.id, o, rad: Math.hypot(...o.half) })));
  const lock = lockLimits(ack, 'tow').innerDeg;
  let best = { d: BIG, moving: '–', other: '–', steerDeg: 0 };
  let groundMin = BIG;
  let chordMin = Infinity, chordMax = -Infinity;
  const nPoses = Math.round((2 * lock) / stepDeg);
  for (let i = 0; i <= nPoses; i++) {
    const d = -lock + i * ((2 * lock) / nPoses);
    const pose = poseMatrices(ack, solveSteer(ack, d));
    for (const sgn of [1, -1] as const) {
      const M = pose[sgn > 0 ? 'steer-L' : 'steer-R'];
      const side = mine.filter((x) => x.body === (sgn > 0 ? 'steer-L' : 'steer-R') && MOVING_ID.test(x.id));
      for (const x of side) {
        const moved: Part = { ...x, transform: multiply(M, x.transform) };
        const o = partOBB(moved);
        const rad = Math.hypot(...o.half);
        for (const ob of obstacles) {
          const dd = Math.hypot(o.center[0] - ob.o.center[0], o.center[1] - ob.o.center[1], o.center[2] - ob.o.center[2]) - rad - ob.rad;
          if (dd > best.d) continue;
          const clr = -obbOverlap(o, ob.o);
          if (clr < best.d) best = { d: clr, moving: x.id, other: ob.id, steerDeg: d };
        }
        groundMin = Math.min(groundMin, partOBB(moved).center[2] - Math.max(...o.half.map((h, m) => Math.abs(o.axes[m][2]) * h)) );
      }
      const A = transformPoint(M, housingStop(ch.fg, sgn));
      const B = housingAnchor(L, sgn);
      const chord = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
      chordMin = Math.min(chordMin, chord);
      chordMax = Math.max(chordMax, chord);
    }
  }
  // Rigid with the wheel: shoe and arm gaps to the tread, measured at neutral.
  const r = L.r, hw = p.tireWidthIn / 2;
  let shoeGap = Infinity, shoeEnd = Infinity, armGap = Infinity;
  for (const sgn of [1, -1] as const) {
    const c = sgn > 0 ? L.front.stub.L : L.front.stub.R;
    const side = mine.filter((x) => x.body === (sgn > 0 ? 'steer-L' : 'steer-R'));
    for (const x of side) {
      if (/^brake-shoe-F[LR]$/.test(x.id) && x.geometry.type === 'extrusion') {
        const m = x.transform;
        const ol = x.geometry.outline;
        const half = ol.length / 2; // outer arc first, then the inner (lining) arc back
        for (let i = half; i < ol.length; i++) {
          const q = ol[i];
          const px = m[0] * q[0] + m[4] * q[1] + m[12];
          const pz = m[2] * q[0] + m[6] * q[1] + m[14];
          const gap = Math.hypot(px - c[0], pz - c[2]) - r;
          shoeEnd = Math.min(shoeEnd, gap);
          if (i === half + Math.floor((ol.length - half) / 2)) shoeGap = Math.min(shoeGap, gap);
        }
      } else if (/^(brake-front-horn|brake-shoe-arm-F|brake-shoe-pivot-F)/.test(x.id)) {
        for (const pt of samples([x])) armGap = Math.min(armGap, tireDistance(pt, c, r, hw));
      }
    }
  }
  const freeLen = 1.15 * chordMax;
  // Circular arc of length freeLen over the chord: sin(phi)/phi = chord / freeLen, R = chord / (2 sin phi); smallest chord is the sharpest bend.
  const ratio = Math.min(0.9999, chordMin / freeLen);
  let lo = 1e-6, hi = Math.PI;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (Math.sin(m) / m > ratio) lo = m; else hi = m; }
  const phi = (lo + hi) / 2;
  const R = chordMin / (2 * Math.sin(phi));
  const res: FrontSweepResult = {
    on: true, minToHullIn: best.d, moving: best.moving, other: best.other, steerDeg: best.steerDeg, shoeGapIn: shoeGap, shoeEndGapIn: shoeEnd, armToTireIn: armGap,
    chordMinIn: chordMin, chordMaxIn: chordMax, freeLenIn: freeLen, bendRadiusIn: R, groundMinZ: groundMin, poses: nPoses + 1,
  };
  cache.set(ctx, res);
  return res;
}
