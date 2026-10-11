/** Small deterministic helpers for the procedural textures. Pure (no DOM, no three.js) so they run under vitest. */

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string to an unsigned 32-bit int (seeds the per-part grain offset). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Value noise on an nx x ny lattice that wraps, so the texture it feeds tiles seamlessly. s, t are in [0, 1). */
export class TileNoise {
  private readonly v: Float32Array;
  constructor(seed: number, readonly nx: number, readonly ny: number) {
    const r = mulberry32(seed);
    this.v = new Float32Array(nx * ny);
    for (let i = 0; i < this.v.length; i++) this.v[i] = r();
  }
  at(s: number, t: number): number {
    const x = s * this.nx;
    const y = t * this.ny;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    let fx = x - x0;
    let fy = y - y0;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const xa = ((x0 % this.nx) + this.nx) % this.nx;
    const ya = ((y0 % this.ny) + this.ny) % this.ny;
    const xb = (xa + 1) % this.nx;
    const yb = (ya + 1) % this.ny;
    const a = this.v[ya * this.nx + xa];
    const b = this.v[ya * this.nx + xb];
    const c = this.v[yb * this.nx + xa];
    const d = this.v[yb * this.nx + xb];
    return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
  }
}
