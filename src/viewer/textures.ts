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
  const rings = oak ? 20 : 5;
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
          tone = late * 0.58 + (fib - 0.5) * 0.34 + blot * 0.2 + pore * 0.3 + (nLow.at(s, t) - 0.5) * 0.25;
        } else {
          tone = late * 0.38 + (fib - 0.5) * 0.3 + blot * 0.18 + (nLow.at(s, t) - 0.5) * 0.5;
        }
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

/** Single place for the sign wording (Q-5 in DECISIONS.md is still open with Eric, so this may change). */
export const SIGN_LINES = { top: 'TROOP 455', bottom: 'WILDERNESS RANGERS' } as const;

/** Fleur-de-lis glyph (cream), drawn with canvas paths so it needs no font. Centered at (cx, cy), `h` tall. */
function fleurDeLis(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  const u = h / 100;
  ctx.scale(u, u);
  ctx.fillStyle = '#d8c9a3';
  const side = (mirror: number): void => {
    ctx.save();
    ctx.scale(mirror, 1);
    ctx.beginPath();
    // Upper side petal: sweeps out from the band, up around, and curls back in at the tip.
    ctx.moveTo(-4, 6);
    ctx.bezierCurveTo(-36, 14, -50, -12, -38, -34);
    ctx.bezierCurveTo(-34, -28, -30, -26, -27, -20);
    ctx.bezierCurveTo(-36, -6, -20, -2, -4, -16);
    ctx.closePath();
    ctx.fill();
    // Lower leaf under the band.
    ctx.beginPath();
    ctx.moveTo(-6, 20);
    ctx.bezierCurveTo(-24, 22, -32, 34, -26, 44);
    ctx.bezierCurveTo(-18, 38, -10, 34, -4, 26);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  side(1);
  side(-1);
  // Center petal and tail.
  ctx.beginPath();
  ctx.moveTo(0, -54);
  ctx.bezierCurveTo(-17, -34, -15, -10, 0, 8);
  ctx.bezierCurveTo(15, -10, 17, -34, 0, -54);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 20);
  ctx.bezierCurveTo(-7, 28, -6, 38, 0, 48);
  ctx.bezierCurveTo(6, 38, 7, 28, 0, 20);
  ctx.fill();
  // Band.
  ctx.fillRect(-24, 8, 48, 9);
  ctx.restore();
}

/**
 * Painted side sign (review MUST 4): forest-green paint over a trace of wood grain, a cream border, "TROOP 455" over
 * "WILDERNESS RANGERS", and a fleur-de-lis at each end. The canvas aspect matches the sign face so nothing stretches.
 * System fonts only (no external files), so it works in the single-file build.
 */
export function signTexture(aspect: number): THREE.CanvasTexture {
  const key = `sign:${aspect.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = 1536;
  const H = Math.max(128, Math.round(W / aspect));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2f4a34';
  ctx.fillRect(0, 0, W, H);
  // Let a little grain through the paint.
  const grain = woodTextures('oak').map.image as CanvasImageSource;
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.28;
  ctx.drawImage(grain, 0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  // Paint wear: a faint lighter wash along the top.
  const wash = ctx.createLinearGradient(0, 0, 0, H);
  wash.addColorStop(0, 'rgba(255,255,255,0.07)');
  wash.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  // Cream border: an outer line and a thinner inner line.
  const m = H * 0.055;
  ctx.strokeStyle = '#d8c9a3';
  ctx.lineWidth = H * 0.032;
  ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
  ctx.lineWidth = H * 0.012;
  ctx.strokeRect(m * 1.9, m * 1.9, W - 3.8 * m, H - 3.8 * m);
  // Lettering.
  const font = (px: number): string => `900 ${px}px Impact, "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = '#d8c9a3';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fit = (text: string, px: number, maxW: number): number => {
    ctx.font = font(px);
    const w = ctx.measureText(text).width;
    return w > maxW ? px * (maxW / w) : px;
  };
  const cx = W / 2;
  const textW = W * 0.64;
  const px1 = fit(SIGN_LINES.top, H * 0.34, textW);
  const px2 = fit(SIGN_LINES.bottom, H * 0.2, textW);
  ctx.font = font(px1);
  ctx.fillText(SIGN_LINES.top, cx, H * 0.36);
  ctx.font = font(px2);
  ctx.fillText(SIGN_LINES.bottom, cx, H * 0.7);
  // A thin rule between the lines, and a fleur-de-lis at each end.
  ctx.fillRect(cx - textW * 0.42, H * 0.545, textW * 0.84, H * 0.012);
  fleurDeLis(ctx, W * 0.115, H * 0.5, H * 0.6);
  fleurDeLis(ctx, W * 0.885, H * 0.5, H * 0.6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  cache.set(key, t);
  return t;
}

/** Soft radial blob (white to transparent) used as a cheap contact shadow under the cart and its wheels. */
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
