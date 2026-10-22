/**
 * The steering check chains' keeper cords (D-56). Each check chain is only taut at its own lock; elsewhere it hangs in a slack bight (2.7" of slack straight ahead, 4.8" at
 * the opposite lock), which hung about 2" off the ground straight ahead and 1.3" at the opposite lock, under the 3" ground-clearance rule. A short 1/8" shock cord runs
 * through a small screw eye in the underside of the deck, its two ends knotted to two links of the chain (a V), and lifts the bight; it stretches so the chain still reaches
 * its full length and sets the lock. (One end on one link left the long piece toward the anchor sagging to about 3.2" at the opposite lock; the V holds both pieces up.)
 *
 * This module is the one source for the keeper's geometry (the eye, the tied link, the cord's free and cut lengths) and for how the chain hangs with and without it:
 * each piece of chain between the eye rings and the tied links is a uniform chain hanging between its two ends (a catenary), the tied links sit where the cord's pull, the
 * chain's weight and the chain's length balance. Described for the RIGHT chain (y < 0, taut at +lock); the left is its mirror. Plain math, no three.js.
 */
import type { Params } from '../params';
import type { Layout } from './layout';
import type { Part, Vec3 } from './types';

/** The keeper eye's ring center below the deck underside (a small screw eye, 3/8" of thread into the 12 mm deck). */
export const KEEPER_EYE_DROP_IN = 0.3;
/** Cord taken up by each knot (one at the eye, one at the link), for the cut length. */
export const KEEPER_KNOT_IN = 1;
/** 1/8" shock cord, about 0.005 lb a foot. */
export const KEEPER_CORD_LB_PER_IN = 0.0004;

type V = Vec3;
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V): number => Math.hypot(a[0], a[1], a[2]);

export interface ChainKeeper {
  /** The screw eye's ring center (right chain). */
  eye: V;
  /** The two tied links' distances along the chain from the beam eye ring (in): the near one and the far one. */
  linksFromBeamIn: [number, number];
  /** The cord from one tied link, through the eye, to the other, with the chain taut at its lock (the cord at its longest). */
  lockIn: number;
  /** The cord's free length between its knots, and the length to cut (with the two knots). */
  freeIn: number;
  cutIn: number;
}

/** Where the keeper goes and how long its cord is: one cord through the screw eye, its two ends knotted to two links of the chain (a V). */
export function chainKeeper(p: Params, L: Layout): ChainKeeper {
  const A = L.chain.anchor as V, B = L.steer.beamEyeAt(L.steer.lock) as V;
  const eye: V = [L.chain.joistX + L.chain.joistT / 2 + p.steerKeeperAheadIn, -(Math.abs(A[1]) + p.steerChainBeamYIn) / 2, L.deckBot - KEEPER_EYE_DROP_IN];
  const fr: [number, number] = [p.steerKeeperLinkFrac, Math.max(p.steerKeeperLinkFrac + 0.05, p.steerKeeperFarLinkFrac)];
  const lockIn = fr.reduce((m, f) => m + norm(sub(add(B, mul(sub(A, B), f)), eye)), 0);
  const freeIn = lockIn / (1 + p.steerKeeperStretchAtLock);
  return { eye, linksFromBeamIn: [fr[0] * L.chain.lenIn, fr[1] * L.chain.lenIn], lockIn, freeIn, cutIn: freeIn + 2 * KEEPER_KNOT_IN };
}

/** Lowest z of a uniform chain `len` long hanging between P and Q (its ends at P and Q; a taut chain's lowest point is its lower end). */
export function catenaryLowZ(P: V, Q: V, len: number): number {
  const h = Math.hypot(P[0] - Q[0], P[1] - Q[1]), v = Q[2] - P[2];
  if (h < 1e-6) return Math.min(P[2], Q[2]) - Math.max(0, len - Math.abs(v)) / 2; // hanging straight down in a doubled loop
  const target = Math.sqrt(Math.max(0, len * len - v * v));
  if (target <= h + 1e-9) return Math.min(P[2], Q[2]);
  // z = k cosh((x - x0) / k) + C through both ends with arc length len: sqrt(len^2 - v^2) = 2k sinh(h / 2k)
  let lo = 1e-4, hi = 1e5;
  for (let i = 0; i < 100; i++) { const m = Math.sqrt(lo * hi); if (2 * m * Math.sinh(h / (2 * m)) > target) lo = m; else hi = m; }
  const k = Math.sqrt(lo * hi);
  const x0 = h / 2 - k * Math.atanh(Math.max(-0.999999, Math.min(0.999999, v / len)));
  const C = P[2] - k * Math.cosh(-x0 / k);
  return x0 > 0 && x0 < h ? k + C : Math.min(P[2], Q[2]);
}

export interface ChainHang {
  /** The two tied links (right chain; empty with no keeper), the cord's stretch (length over free length, less 1; 0 when slack or with no keeper) and pull (lbf), and the lowest z of the chain. */
  links: V[];
  stretch: number;
  pullLbf: number;
  lowZ: number;
}

/** Weight of the chain between its eye rings (lb), from the same lb-per-foot as the part. */
export const chainWeightLb = (p: Params, L: Layout): number => ((12.3 * p.steerChainDiaIn ** 2) / 12) * L.chain.lenIn;

/**
 * How the RIGHT chain hangs at steering angle `a` (rad), with the keeper or without. With it, the two tied links are found by minimizing the cord's stretch energy (the cord
 * slides through the eye, so its pull is the same in both legs) plus the work of the chain's weight (a third of it taken at each link, the rest at the two eye rings), with
 * each piece of chain no longer than it is (projected gradient steps). Each piece then hangs as a catenary between its ends.
 */
export function chainHang(p: Params, L: Layout, a: number, keeper = true): ChainHang {
  const A = L.chain.anchor as V, B = L.steer.beamEyeAt(a) as V, len = L.chain.lenIn;
  if (!keeper) return { links: [], stretch: 0, pullLbf: 0, lowZ: catenaryLowZ(A, B, len) };
  const kp = chainKeeper(p, L);
  const [l1, l2] = kp.linksFromBeamIn;
  const seg = [l1, l2 - l1, len - l2];
  const k = p.steerKeeperCordLbf / kp.freeIn; // lbf per inch of stretch
  const w = chainWeightLb(p, L) / 3;
  const project = (M1: V, M2: V): [V, V] => {
    for (let i = 0; i < 60; i++) {
      let r = sub(M1, B), n = norm(r);
      if (n > seg[0]) M1 = add(B, mul(r, seg[0] / n));
      r = sub(M2, A); n = norm(r);
      if (n > seg[2]) M2 = add(A, mul(r, seg[2] / n));
      r = sub(M2, M1); n = norm(r);
      if (n > seg[1]) { const u = mul(r, 1 / n), half = (n - seg[1]) / 2; M1 = add(M1, mul(u, half)); M2 = sub(M2, mul(u, half)); }
    }
    return [M1, M2];
  };
  let [M1, M2] = project(add(B, mul(sub(A, B), l1 / len)), add(B, mul(sub(A, B), l2 / len)));
  const step = 0.2 / Math.max(k, 1e-6);
  for (let it = 0; it < 1500; it++) {
    const r1 = sub(M1, kp.eye), r2 = sub(M2, kp.eye), n1 = norm(r1), n2 = norm(r2);
    const T = n1 + n2 > kp.freeIn ? k * (n1 + n2 - kp.freeIn) : 0;
    const g1: V = add(mul(r1, T / Math.max(n1, 1e-9)), [0, 0, w]), g2: V = add(mul(r2, T / Math.max(n2, 1e-9)), [0, 0, w]);
    const [N1, N2] = project(sub(M1, mul(g1, step)), sub(M2, mul(g2, step)));
    const moved = norm(sub(N1, M1)) + norm(sub(N2, M2));
    M1 = N1; M2 = N2;
    if (moved < 1e-7) break;
  }
  const cord = norm(sub(M1, kp.eye)) + norm(sub(M2, kp.eye));
  const stretch = Math.max(0, cord / kp.freeIn - 1);
  return {
    links: [M1, M2], stretch, pullLbf: p.steerKeeperCordLbf * stretch,
    lowZ: Math.min(catenaryLowZ(B, M1, seg[0]), catenaryLowZ(M1, M2, seg[1]), catenaryLowZ(M2, A, seg[2])),
  };
}

export interface ChainSweep { lowZ: number; atDeg: number; maxStretch: number; maxPullLbf: number }
const sweepCache = new Map<string, ChainSweep>();

/** The chain's lowest point and the cord's largest stretch over the whole lock range (1 degree steps; the left chain is the mirror, so one chain covers both). */
export function chainSweep(p: Params, L: Layout, keeper = true): ChainSweep {
  const key = [keeper, p.steerLockDeg, p.steerChainDiaIn, p.steerChainBeamYIn, p.steerChainAnchorYIn, p.steerKeeperAheadIn, p.steerKeeperLinkFrac, p.steerKeeperFarLinkFrac, p.steerKeeperStretchAtLock, p.steerKeeperCordLbf, L.chain.lenIn, L.chain.anchor.join(','), L.deckBot, L.chain.beamZ].join('|');
  const hit = sweepCache.get(key);
  if (hit) return hit;
  const lock = L.steer.lock;
  let out: ChainSweep = { lowZ: Infinity, atDeg: 0, maxStretch: 0, maxPullLbf: 0 };
  const n = Math.max(2, Math.round((2 * lock * 180) / Math.PI)); // 1 degree steps, both ends included
  for (let i = 0; i <= n; i++) {
    const a = -lock + (2 * lock * i) / n;
    const h = chainHang(p, L, a, keeper);
    if (h.lowZ < out.lowZ) out = { ...out, lowZ: h.lowZ, atDeg: (a * 180) / Math.PI };
    out.maxStretch = Math.max(out.maxStretch, h.stretch);
    out.maxPullLbf = Math.max(out.maxPullLbf, h.pullLbf);
  }
  if (sweepCache.size > 40) sweepCache.clear();
  sweepCache.set(key, out);
  return out;
}

/** The deck's own end of the keeper eyes (D-56): a pilot for each screw eye in its underside, set at the fit (not in the deck's Shaper file). Call once after `applyJoinery`. */
export function addKeeperDeckJoints(p: Params, L: Layout, parts: Part[]): void {
  const deck = parts.find((x) => x.id === 'deck');
  if (!deck) return;
  const eye = chainKeeper(p, L).eye, m = deck.transform;
  for (const [tag, s] of [['L', 1], ['R', -1]] as const) {
    if (!parts.some((x) => x.id === `steer-keeper-${tag}`)) continue;
    // the deck transform is a pure translation (its local z = 0 is the underside)
    (deck.joints ??= []).push({ type: 'hole', to: `steer-keeper-${tag}`, count: 1, at: [[eye[0] - m[12], s * Math.abs(eye[1]) - m[13], L.deckBot - m[14]]], size: 'a 3/32" pilot, 3/8" deep, in the underside for the steering chain keeper\'s screw eye (not in the deck\'s Shaper file: set at the fit)' });
  }
}
