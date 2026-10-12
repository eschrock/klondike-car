import type { Vec3 } from '../model/types';
import { roundedBoxMesh, type RawMesh } from './shapes';
import { tubeAlong } from './upholstery';

/** Appends `src` to `dst`, shifted by `at`. */
function append(dst: RawMesh, src: RawMesh, at: Vec3): void {
  const base = dst.positions.length / 3;
  for (let i = 0; i < src.positions.length; i += 3) dst.positions.push(src.positions[i] + at[0], src.positions[i + 1] + at[1], src.positions[i + 2] + at[2]);
  dst.normals.push(...src.normals);
  for (const k of src.indices) dst.indices.push(base + k);
}

/**
 * A lash point drawn inside the part's bounding box (round 3, review r2 MUST 2): a 4-hole bolt plate on the bottom of the box
 * (long axis X, plate normal Z), four screw heads, a small bracket, and a stainless D-ring (a squared oval whose flat bottom
 * is held by the bracket) standing up above the plate. Everything stays within `size`, centered on the origin (box convention).
 */
export function lashPointMesh(size: Vec3): RawMesh {
  const [L, W, H] = size;
  const out: RawMesh = { positions: [], normals: [], indices: [] };
  const plateT = Math.min(0.125, H * 0.2);
  const zPlateTop = -H / 2 + plateT;
  append(out, roundedBoxMesh([L, W, plateT], Math.min(0.05, plateT * 0.45), 4), [0, 0, -H / 2 + plateT / 2]);
  // Screw heads at the four corners (low domes, drawn as tiny rounded blocks).
  const sx = L / 2 - 0.2, sy = W / 2 - 0.17, hh = Math.min(0.06, plateT * 0.5);
  for (const x of [-sx, sx]) for (const y of [-sy, sy]) append(out, roundedBoxMesh([0.15, 0.15, hh], 0.04, 2), [x, y, zPlateTop + hh / 2 - 0.005]);
  // Bracket (the lug that holds the ring).
  const bh = Math.min(0.2, H * 0.28);
  append(out, roundedBoxMesh([Math.min(0.6, L * 0.4), Math.min(0.32, W * 0.36), bh], 0.06, 3), [0, 0, zPlateTop + bh / 2 - 0.005]);
  // D-ring: a squircle (|x/a|^n + |z/b|^n = 1), tall above its flat-ish bottom bar.
  const rt = Math.min(0.075, H * 0.1);
  const a = Math.min(L * 0.36, L / 2 - rt - 0.02);
  const zBar = zPlateTop + bh * 0.8; // the bottom bar sits in the bracket
  const hl = 0.09;
  const zc = zBar + hl;
  const hu = H / 2 - rt - zc;
  const N = 40;
  const pts: Vec3[] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const k = 2 / 3; // squircle exponent 3
    pts.push([a * Math.sign(c) * Math.abs(c) ** k, 0, zc + (s >= 0 ? hu : hl) * Math.sign(s) * Math.abs(s) ** k]);
  }
  const ring = tubeAlong(pts, rt, 0xffffff, true, 8);
  append(out, { positions: ring.positions, normals: ring.normals, indices: ring.indices }, [0, 0, 0]);
  return out;
}

/**
 * Rubber foot tread on a brake flap (3c visual round 2): a thin base sheet with raised grip ribs across it (ribs run along y, spaced along x), all inside `size`
 * (x along the flap, y across, z up), centered on the origin.
 */
export function treadMesh(size: Vec3): RawMesh {
  const [L, W, T] = size;
  const out: RawMesh = { positions: [], normals: [], indices: [] };
  const tb = T * 0.55, rh = T - tb;
  append(out, roundedBoxMesh([L, W, tb], Math.min(0.04, tb * 0.4), 3), [0, 0, -T / 2 + tb / 2]);
  const pitch = 0.5, rw = 0.16;
  const n = Math.max(1, Math.floor((L - 0.3) / pitch));
  for (let i = 0; i < n; i++) {
    const x = -((n - 1) * pitch) / 2 + i * pitch;
    append(out, roundedBoxMesh([rw, W - 0.2, rh + 0.02], Math.min(0.04, rh * 0.45), 2), [x, 0, -T / 2 + tb + rh / 2 - 0.01]);
  }
  return out;
}

/** Bounding box of a raw mesh as [min, max] (for tests). */
export function rawBounds(m: RawMesh): [Vec3, Vec3] {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], m.positions[i + a]); hi[a] = Math.max(hi[a], m.positions[i + a]); }
  return [lo, hi];
}
