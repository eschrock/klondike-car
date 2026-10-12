import * as THREE from 'three';
import { TileNoise } from './noise';

/**
 * Procedural surface textures, drawn once on canvases (no image files, so the single-file build stays self-contained).
 * Every texture tiles, is cached by key, and is shared by all parts that use the material.
 *
 * Wood textures put the grain along U (horizontal) at WOOD_TILE_IN inches per repeat; see `grainUv.ts` for the mapping.
 */
export const WOOD_TILE_IN = { along: 36, across: 9, end: 6, ply: 0.5 };

let maxAniso = 4;
export function setMaxAnisotropy(n: number): void {
  maxAniso = Math.max(1, Math.min(8, n));
}

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, w: number, h: number, srgb: boolean, draw: (img: ImageData) => void): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  draw(img);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  cache.set(key, t);
  return t;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function put(img: ImageData, i: number, c: RGB): void {
  img.data[i] = Math.max(0, Math.min(255, c[0] * 255));
  img.data[i + 1] = Math.max(0, Math.min(255, c[1] * 255));
  img.data[i + 2] = Math.max(0, Math.min(255, c[2] * 255));
  img.data[i + 3] = 255;
}

export type WoodKind = 'oak' | 'okoume';

/**
 * Face-grain texture pair for a board: the color map and a gray map that serves as both bump and roughness (pores and
 * late-wood bands are a little lower / rougher). Oak is warm and ring-porous with strong cathedral grain lines, pores and
 * a few ray flecks; okoume ply is lighter, pinkish tan with a gentle rotary-veneer stripe.
 */
export function woodTextures(kind: WoodKind): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = kind === 'oak' ? 1024 : 512;
  const H = kind === 'oak' ? 512 : 256;
  const key = `wood:${kind}`;
  const hit = cache.get(key);
  if (hit) return { map: hit, bump: cache.get(key + ':bump')! };
  const oak = kind === 'oak';
  const nWarp = new TileNoise(11, 3, 2);
  const nCath = new TileNoise(12, 2, 3);
  const nFib = new TileNoise(13, oak ? 6 : 4, oak ? 190 : 120);
  const nFib2 = new TileNoise(14, 14, 80);
  const nPore = new TileNoise(15, 110, 300);
  const nRay = new TileNoise(16, 36, 46);
  const nBlot = new TileNoise(17, 4, 3);
  // Round 3 stain (review r2 MUST 1): about 20% deeper than round 2. Oak runs from an early-wood highlight (~#8a5628, with
  // the odd ray fleck brighter) to late wood ~#3a200c; the mean face lands near #6a4020. Okoume runs ~#8a5a36 to #5e3820.
  const light: RGB = oak ? [0.47, 0.29, 0.14] : [0.48, 0.31, 0.19];
  const dark: RGB = oak ? [0.2, 0.11, 0.04] : [0.33, 0.19, 0.11];
  const nLow = new TileNoise(18, 2, 2); // panel-scale tone drift so big faces are not flat (review SHOULD 10)
  // 3c visual round 2 (review SHOULD 3): the stripe period is doubled (oak 10 rings per 9 in, about 0.9 in; okoume 3, about 3 in) and the contrast cut about 30%, so close-ups read as oak, not corduroy.
  const rings = oak ? 10 : 3;
  const CONTRAST = 0.7, PIVOT = 0.35;
  let gray!: ImageData;
  const map = make(key, W, H, true, (img) => {
    // The bump canvas is made in the same pass (it shares every noise lookup).
    gray = new ImageData(W, H);
    for (let y = 0; y < H; y++) {
      const t = y / H;
      for (let x = 0; x < W; x++) {
        const s = x / W;
        const warp = (nWarp.at(s, t) - 0.5) * 2 + (nCath.at(s, t) - 0.5) * 2.2;
        const R = rings * t + warp * (oak ? 1.3 : 0.8);
        const f = R - Math.floor(R);
        const late = Math.pow(smooth(0.35, 1, f), 1.6); // gradual dark band, sharp reset at the next ring
        const early = 1 - smooth(0, 0.4, f);
        const fib = nFib.at(s, t) * 0.65 + nFib2.at(s, t) * 0.35;
        const blot = nBlot.at(s, t) - 0.5;
        let tone: number;
        let pore = 0;
        let ray = 0;
        if (oak) {
          const pv = nPore.at(s, t);
          pore = pv > 0.72 ? ((pv - 0.72) / 0.28) * early : 0;
          const rv = nRay.at(s, t);
          ray = rv > 0.86 ? (rv - 0.86) / 0.14 : 0;
          tone = late * 0.58 + (fib - 0.5) * 0.34 + blot * 0.2 + pore * 0.3 + (nLow.at(s, t) - 0.5) * 0.3;
        } else {
          tone = late * 0.38 + (fib - 0.5) * 0.3 + blot * 0.18 + (nLow.at(s, t) - 0.5) * 0.5;
        }
        tone = PIVOT + (tone - PIVOT) * CONTRAST;
        const col = mix(light, dark, clamp01(tone));
        if (ray) for (let a = 0; a < 3; a++) col[a] = Math.min(1, col[a] + 0.09 * ray);
        const i = (y * W + x) * 4;
        put(img, i, col);
        const g = 0.9 - pore * 0.4 - late * 0.12 + (fib - 0.5) * 0.12;
        gray.data[i] = gray.data[i + 1] = gray.data[i + 2] = Math.max(0, Math.min(255, g * 255));
        gray.data[i + 3] = 255;
      }
    }
  });
  const bump = make(key + ':bump', W, H, false, (img) => img.data.set(gray.data));
  return { map, bump };
}

/** End grain of oak: concentric growth rings and pores, darker than the face. 1 repeat = WOOD_TILE_IN.end inches. */
export function oakEndTexture(): THREE.CanvasTexture {
  return make('oak:end', 256, 256, true, (img) => {
    const n = new TileNoise(21, 4, 4);
    const nP = new TileNoise(22, 90, 90);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const s = x / 256, t = y / 256;
        const d = Math.hypot(s - 0.35, t + 0.6) * 15 + (n.at(s, t) - 0.5) * 1.6;
        const f = d - Math.floor(d);
        const late = Math.pow(smooth(0.3, 1, f), 1.5);
        const pv = nP.at(s, t);
        const pore = pv > 0.75 ? (pv - 0.75) * 4 * (1 - late) : 0;
        const c = mix([0.37, 0.225, 0.1], [0.19, 0.1, 0.04], clamp01(late * 0.8 + pore * 0.5));
        put(img, (y * 256 + x) * 4, c);
      }
    }
  });
}

/** Plywood edge: alternating veneer layers separated by thin dark glue lines. 1 repeat = WOOD_TILE_IN.ply inches (5 plies). */
export function plyEdgeTexture(): THREE.CanvasTexture {
  return make('ply:edge', 64, 160, true, (img) => {
    const n = new TileNoise(31, 8, 5);
    for (let y = 0; y < 160; y++) {
      const layer = Math.floor(y / 32);
      const inLayer = y % 32;
      const tone = 0.93 + ((layer * 7919) % 13) / 13 * 0.12;
      for (let x = 0; x < 64; x++) {
        const glue = inLayer < 2 ? 0.55 : 1;
        const streak = 0.96 + (n.at(x / 64, y / 160) - 0.5) * 0.12;
        const c: RGB = [0.56 * tone * glue * streak, 0.37 * tone * glue * streak, 0.23 * tone * glue * streak];
        put(img, (y * 64 + x) * 4, c);
      }
    }
  });
}

/** Fine pebbled grain for vinyl and rubber (gray bump map). 1 repeat = 8 inches. */
export function pebbleBump(kind: 'vinyl' | 'rubber'): THREE.CanvasTexture {
  return make(`bump:${kind}`, 256, 256, false, (img) => {
    const a = new TileNoise(41, kind === 'vinyl' ? 64 : 48, kind === 'vinyl' ? 64 : 48);
    const b = new TileNoise(42, kind === 'vinyl' ? 128 : 110, kind === 'vinyl' ? 128 : 20);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const v = clamp01(0.45 + (a.at(x / 256, y / 256) - 0.5) * 0.9 + (b.at(x / 256, y / 256) - 0.5) * 0.5);
        const i = (y * 256 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255;
        img.data[i + 3] = 255;
      }
    }
  });
}

/** Single place for the sign wording (Q-5 in DECISIONS.md: "TROOP 455 / WILDERNESS RANGERS", as in the concept renders). */
export const SIGN_LINES = { top: 'TROOP 455', bottom: 'WILDERNESS RANGERS' } as const;

/** Superellipse exponent of the sign outline (2 = ellipse; 2.6 = a fuller "plank oval" like the concept renders). */
export const SIGN_SHAPE_EXP = 2.6;

/** Board shape of the sign: a rounded-oval plank (superellipse) or a rounded rectangle. */
export type SignShape = 'oval' | 'rounded';

/** Corner radius of the 'rounded' shape for a blank of height `h` (and width `w`). */
export const signCornerRadius = (w: number, h: number): number => Math.min(h * 0.3, w / 2);

/**
 * Counter-clockwise outline of a `w` x `h` sign, centered on the origin: a superellipse for 'oval', a rounded rectangle for
 * 'rounded' (corner radius `radius`, default `signCornerRadius`). Shared by the texture and the board geometry.
 */
export function signOutline(w: number, h: number, segs = 120, shape: SignShape = 'oval', radius?: number): [number, number][] {
  const pts: [number, number][] = [];
  if (shape === 'rounded') {
    const r = Math.max(0, Math.min(radius ?? signCornerRadius(w, h), w / 2, h / 2));
    const per = Math.max(4, Math.round(segs / 8)); // segments per corner
    // Corner centers, counter-clockwise starting at the bottom-right corner (angle -90..0 degrees).
    const corners: [number, number, number][] = [[w / 2 - r, -h / 2 + r, -90], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180]];
    for (const [cx, cy, a0] of corners) {
      for (let i = 0; i <= per; i++) {
        const a = ((a0 + (90 * i) / per) * Math.PI) / 180;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    }
    return pts;
  }
  const n = SIGN_SHAPE_EXP;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    pts.push([(w / 2) * Math.sign(c) * Math.abs(c) ** (2 / n), (h / 2) * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return pts;
}

/** Fleur-de-lis (cream), drawn from bezier paths so it needs no font. Mirror-symmetric, 3 petals and a band; centered at (cx, cy), `h` tall. */
function fleurDeLis(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  const u = h / 100;
  ctx.scale(u, u);
  // Unit design box: x -40..40, y -50 (petal tip) .. +50 (tail tip), band at y 8..17.
  const centerPetal = (): void => {
    // Center petal: a pointed lance, widest about a third of the way up.
    ctx.moveTo(0, -50);
    ctx.bezierCurveTo(-5, -38, -17, -26, -15, -10);
    ctx.bezierCurveTo(-14, -2, -8, 6, -6, 9);
    ctx.lineTo(6, 9);
    ctx.bezierCurveTo(8, 6, 14, -2, 15, -10);
    ctx.bezierCurveTo(17, -26, 5, -38, 0, -50);
    ctx.closePath();
  };
  const side = (m: number): void => {
    // Side petal: leaves the band, swings out and up, then rolls over to a point that curls down and inward.
    ctx.moveTo(m * 7, 9);
    ctx.bezierCurveTo(m * 6, -4, m * 14, -12, m * 22, -24);
    ctx.bezierCurveTo(m * 28, -35, m * 45, -35, m * 46, -20);
    ctx.bezierCurveTo(m * 47, -9, m * 41, -2, m * 33, -3);
    ctx.bezierCurveTo(m * 38, -9, m * 37, -18, m * 31, -15);
    ctx.bezierCurveTo(m * 24, -11, m * 27, 1, m * 19, 6);
    ctx.bezierCurveTo(m * 15, 8, m * 11, 9, m * 7, 9);
    ctx.closePath();
  };
  const tail = (): void => {
    // Short tail below the band, with a small leaf either side flicking outward.
    ctx.moveTo(0, 17);
    ctx.bezierCurveTo(-6, 24, -6, 36, 0, 50);
    ctx.bezierCurveTo(6, 36, 6, 24, 0, 17);
    ctx.closePath();
  };
  const leaf = (m: number): void => {
    ctx.moveTo(m * 6, 17);
    ctx.bezierCurveTo(m * 18, 16, m * 30, 24, m * 31, 39);
    ctx.bezierCurveTo(m * 21, 35, m * 12, 31, m * 6, 25);
    ctx.closePath();
  };
  const band = (): void => ctx.roundRect(-21, 7, 42, 11, 3);
  const halo = ctx.strokeStyle; // a thin dark halo around the center petal and band keeps the three petals distinct
  ctx.beginPath();
  side(1); side(-1); tail(); leaf(1); leaf(-1);
  ctx.fill();
  ctx.strokeStyle = SIGN_PAINT_DARK;
  ctx.lineWidth = 3.2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  centerPetal();
  ctx.stroke();
  ctx.fill();
  ctx.beginPath();
  band();
  ctx.stroke();
  ctx.fill();
  ctx.strokeStyle = halo;
  ctx.restore();
}

/** Path of the board outline inset to semi-axes `a`, `b` around (cx, cy) (corner radius `r` for the rounded shape). */
function outlinePath(ctx: CanvasRenderingContext2D, shape: SignShape, cx: number, cy: number, a: number, b: number, r?: number): void {
  const pts = signOutline(2 * a, 2 * b, 240, shape, r);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(cx + x, cy + y) : ctx.moveTo(cx + x, cy + y)));
  ctx.closePath();
}

const SIGN_PAINT: RGB = [47 / 255, 74 / 255, 52 / 255]; // #2f4a34
const SIGN_CREAM = '#e4d6aa';
const SIGN_PAINT_DARK = 'rgba(30, 50, 36, 0.95)';
const SIGN_INK_DARK = 'rgba(12, 24, 16, 0.8)';
const SIGN_FONT = (px: number): string => `800 ${px}px "Rockwell", "Rockwell Extra Bold", "Roboto Slab", "Rockwell Nova", "Bookman Old Style", Georgia, "Times New Roman", serif`;

/**
 * Painted side sign (`shape`: rounded-oval plank by default, or a rounded rectangle): forest-green paint, weathered, with the oak grain showing through and the paint
 * worn thin toward the rim; an inset cream border; "TROOP 455" large (a slight arch), a fleur-de-lis between rules, and
 * "WILDERNESS RANGERS" smaller on a gentle arc. The board itself is cut to the same `signOutline` by `partMesh.ts`,
 * so the canvas only has to cover the face. The layout comes from `aspect` (face length / height) and every size is a
 * fraction of the face height, so it adapts if the sign part changes shape. 2048 px wide, power-of-two canvas (the height
 * is the nearest power of two; the drawing is scaled to keep letters undistorted), mipmapped and anisotropic. System
 * fonts only (no external files), so it works in the single-file build.
 */
export function signTexture(aspect: number, shape: SignShape = 'oval'): THREE.CanvasTexture {
  const A = Math.max(0.4, Math.min(8, Math.round(aspect * 10) / 10));
  const key = `sign:${shape}:${A.toFixed(1)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const Wc = A < 1.2 ? 1024 : 2048; // a near-square sign is small on the sled: half the width is plenty
  const Hl = Wc / A; // logical height (drawing units are canvas pixels along X)
  const Hc = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(Hl)))); // canvas height: nearest power of two
  const sy = Hc / Hl;
  const mk = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement('canvas');
    c.width = Wc;
    c.height = Hc;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    return [c, x];
  };
  const [canvas, ctx] = mk();
  const N = SIGN_SHAPE_EXP;
  const rounded = shape === 'rounded';
  const smoothf = smooth;

  // 1. Bare oak underneath, then the paint pass.
  ctx.drawImage(woodTextures('oak').map.image as CanvasImageSource, 0, 0, 640, 320, 0, 0, Wc, Hc);
  const img = ctx.getImageData(0, 0, Wc, Hc);
  const d = img.data;
  const nLow = new TileNoise(61, 5, 3), nMid = new TileNoise(62, 28, 9), nStreak = new TileNoise(63, 3, 140);
  const nSpeck = new TileNoise(64, 260, 90), nWear = new TileNoise(65, 14, 5), nWear2 = new TileNoise(66, 60, 20);
  const rr = signCornerRadius(Wc, Hl);
  const kx = new Float32Array(Wc), ky = new Float32Array(Hc);
  for (let x = 0; x < Wc; x++) kx[x] = Math.abs(((x + 0.5) / Wc) * 2 - 1) ** N;
  for (let y = 0; y < Hc; y++) ky[y] = Math.abs(((y + 0.5) / Hc) * 2 - 1) ** N;
  for (let y = 0; y < Hc; y++) {
    const t = y / Hc;
    for (let x = 0; x < Wc; x++) {
      const s = x / Wc;
      const i = (y * Wc + x) * 4;
      const wr = d[i] / 255, wg = d[i + 1] / 255, wb = d[i + 2] / 255;
      // 0 well inside the board, 1 at its rim (superellipse level for the oval, distance to the rim for the rounded rectangle).
      let edge: number;
      if (rounded) {
        const px = x + 0.5, py = (y + 0.5) / sy;
        const qx = Math.abs(px - Wc / 2) - (Wc / 2 - rr), qy = Math.abs(py - Hl / 2) - (Hl / 2 - rr);
        const dist = -(Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - rr); // inside distance to the rim
        edge = 1 - smoothf(0, Hl * 0.22, dist);
      } else edge = smoothf(0.5, 1, kx[x] + ky[y]);
      const lum = 0.299 * wr + 0.587 * wg + 0.114 * wb;
      const streak = nStreak.at(s, t);
      const mott = (nLow.at(s, t) - 0.5) * 0.18 + (nMid.at(s, t) - 0.5) * 0.1 + (streak - 0.5) * 0.12 + (nSpeck.at(s, t) - 0.5) * 0.06;
      const shade = (1 + mott) * (1 + (lum - 0.27) * 0.8) * (1 - 0.2 * edge) * (1.05 - 0.14 * t);
      const wear = smoothf(0.6, 0.82, nWear.at(s, t) * 0.5 + nWear2.at(s, t) * 0.22 + (streak - 0.5) * 0.28 + edge * 0.3);
      const a = 1 - 0.74 * wear;
      const bare = 0.9;
      d[i] = Math.min(255, (SIGN_PAINT[0] * shade * a + wr * bare * (1 - a)) * 255);
      d[i + 1] = Math.min(255, (SIGN_PAINT[1] * shade * a + wg * bare * (1 - a)) * 255);
      d[i + 2] = Math.min(255, (SIGN_PAINT[2] * shade * a + wb * bare * (1 - a)) * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // 2. The lettering and border go on an "ink" layer, drawn in undistorted logical units, then distressed.
  const [ink, ictx] = mk();
  ictx.scale(1, sy);
  const cx = Wc / 2, cy = Hl / 2;
  const compact = A < 2.2; // stubby sign: stack the words (TROOP 455 / fleur / WILDERNESS / RANGERS)
  const m1 = Hl * 0.075;
  ictx.strokeStyle = SIGN_CREAM;
  ictx.lineJoin = 'round';
  ictx.lineWidth = Hl * 0.02;
  outlinePath(ictx, shape, cx, cy, cx - m1, cy - m1, rounded ? Math.max(0, rr - m1) : undefined);
  ictx.stroke();
  ictx.lineWidth = Hl * 0.006;
  outlinePath(ictx, shape, cx, cy, cx - m1 - Hl * 0.036, cy - m1 - Hl * 0.036, rounded ? Math.max(0, rr - m1 - Hl * 0.036) : undefined);
  ictx.stroke();

  // Width a line may use at a given height (fraction of the face), inside the border.
  const room = (t: number): number => {
    const margin = 2 * (m1 + Hl * (compact ? 0.05 : 0.1));
    if (rounded) {
      const dy = Math.min(t, 1 - t) * Hl; // distance from the nearest long edge
      const inset = dy < rr ? rr - Math.sqrt(Math.max(0, rr * rr - (rr - dy) ** 2)) : 0;
      return Wc - 2 * inset - margin * (compact ? 1 : 0.85);
    }
    return Wc * (1 - Math.min(1, Math.abs(2 * t - 1) ** N)) ** (1 / N) - margin;
  };
  /** Draws `text` centered at x = cx, baseline-center y `yc`, spaced, along an arc of `sag` (px; + smile, - frown). Fits to `maxW`. */
  const line = (text: string, pxWanted: number, yc: number, spacingEm: number, sag: number, maxW: number): number => {
    const chars = [...text];
    const measure = (px: number): { w: number[]; total: number } => {
      ictx.font = SIGN_FONT(px);
      const w = chars.map((c) => ictx.measureText(c).width);
      return { w, total: w.reduce((p, q) => p + q, 0) + spacingEm * px * (chars.length - 1) };
    };
    let px = pxWanted;
    let m = measure(px);
    if (m.total > maxW) {
      px *= maxW / m.total;
      m = measure(px);
    }
    const R = sag === 0 ? Infinity : ((m.total / 2) ** 2 + sag * sag) / (2 * sag);
    ictx.textAlign = 'center';
    ictx.textBaseline = 'alphabetic';
    ictx.lineJoin = 'round';
    let pos = -m.total / 2;
    const items = chars.map((ch, i) => {
      const mid = pos + m.w[i] / 2;
      pos += m.w[i] + spacingEm * px;
      const ang = Number.isFinite(R) ? mid / R : 0;
      return { ch, x: Number.isFinite(R) ? cx + R * Math.sin(ang) : cx + mid, y: Number.isFinite(R) ? yc + R * (Math.cos(ang) - 1) : yc, ang };
    });
    for (const pass of [0, 1]) {
      for (const it of items) {
        ictx.save();
        ictx.translate(it.x, it.y + 0.35 * px);
        ictx.rotate(-it.ang);
        ictx.font = SIGN_FONT(px);
        if (pass === 0) {
          ictx.strokeStyle = SIGN_INK_DARK;
          ictx.lineWidth = Math.max(2, px * 0.085);
          ictx.strokeText(it.ch, 0, 0);
        } else {
          ictx.fillStyle = SIGN_CREAM;
          ictx.fillText(it.ch, 0, 0);
        }
        ictx.restore();
      }
    }
    return px;
  };

  let fleurY = Hl * 0.55;
  let fleurH = Hl * 0.2;
  if (compact) {
    const words = SIGN_LINES.bottom.split(' ');
    const rows: [string, number, number][] = [[SIGN_LINES.top, 0.255, 0.17], ...words.map((w, i): [string, number, number] => [w, 0.64 + i * (0.4 / words.length) * 0.82, 0.105])];
    for (const [text, yf, pf] of rows) {
      const yc = Hl * yf, px = Hl * pf;
      line(text, px, yc, 0.06, 0, Math.min(room((yc - px * 0.4) / Hl), room((yc + px * 0.4) / Hl)));
    }
    fleurY = Hl * 0.455;
    fleurH = Hl * 0.17;
  } else {
    const yTop = Hl * 0.3;
    const yBot = Hl * 0.775;
    const sagTop = -Hl * 0.025, sagBot = Hl * 0.075;
    const px1 = Hl * 0.29;
    line(SIGN_LINES.top, px1, yTop, 0.07, sagTop, Math.min(room((yTop - px1 * 0.4) / Hl), room((yTop + px1 * 0.4) / Hl)));
    const px2 = Hl * 0.108;
    line(SIGN_LINES.bottom, px2, yBot, 0.1, sagBot, Math.min(room((yBot - sagBot + px2 * 0.4) / Hl), room((yBot + px2 * 0.4) / Hl)) * 0.97);
  }

  // Fleur-de-lis between two tapering rules.
  const fh = fleurH;
  const fy = fleurY;
  ictx.fillStyle = SIGN_CREAM;
  ictx.strokeStyle = SIGN_INK_DARK;
  ictx.lineWidth = Math.max(1.5, Hl * 0.004);
  fleurDeLis(ictx, cx, fy, fh);
  const ruleLen = Math.min(Wc * 0.17, room(0.5) * 0.3);
  for (const m of compact ? [] : [1, -1]) {
    ictx.beginPath();
    ictx.moveTo(cx + m * fh * 0.55, fy);
    ictx.lineTo(cx + m * (fh * 0.55 + ruleLen), fy - Hl * 0.004);
    ictx.lineTo(cx + m * (fh * 0.55 + ruleLen), fy + Hl * 0.004);
    ictx.closePath();
    ictx.fillStyle = SIGN_CREAM;
    ictx.fill();
    ictx.beginPath();
    ictx.arc(cx + m * (fh * 0.55 + ruleLen + Hl * 0.012), fy, Hl * 0.011, 0, Math.PI * 2);
    ictx.fill();
  }

  // Distress the ink: speckled and streaked losses of paint, aligned with the grain.
  const id = ictx.getImageData(0, 0, Wc, Hc);
  const q = id.data;
  const nHole = new TileNoise(71, 300, 100), nHoleS = new TileNoise(72, 4, 150), nTone = new TileNoise(73, 9, 4);
  for (let y = 0; y < Hc; y++) {
    const t = y / Hc;
    for (let x = 0; x < Wc; x++) {
      const i = (y * Wc + x) * 4;
      if (q[i + 3] === 0) continue;
      const s = x / Wc;
      const hole = smoothf(0.7, 0.86, nHole.at(s, t) * 0.6 + nHoleS.at(s, t) * 0.4);
      const tone = 0.9 + (nTone.at(s, t) - 0.5) * 0.2;
      q[i] = q[i] * tone;
      q[i + 1] = q[i + 1] * tone;
      q[i + 2] = q[i + 2] * tone * 0.97;
      q[i + 3] *= 1 - 0.8 * hole;
    }
  }
  ictx.putImageData(id, 0, 0);
  ctx.drawImage(ink, 0, 0);

  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.max(maxAniso, 8);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(key, t);
  return t;
}

/** Soft radial blob (white to transparent) used as a cheap contact shadow under the sled and its wheels. */
export function blobTexture(): THREE.CanvasTexture {
  const hit = cache.get('blob');
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  cache.set('blob', t);
  return t;
}
