/**
 * SVG helpers shared by the Shaper Origin files (`shaper-svg.ts`) and the full-scale forms and templates (`forms.ts`). Plain TS, no DOM.
 *
 * Shaper Origin conventions (all drawings are in real inches: the viewBox is in inches, so one user unit is one inch):
 *   outside cut  black fill, no stroke               shaper:cutType="outside"
 *   inside cut   white fill, black stroke            shaper:cutType="inside"
 *   pocket       gray fill (#7f7f7f)                 shaper:cutType="pocket"
 *   on-line      stroke only (engraving)             shaper:cutType="online"
 *   guide        blue stroke (#0068ff), no fill      shaper:cutType="guide"
 * Every cut path also carries shaper:cutDepth in inches ("0.492in"). Text and other non-path elements are ignored by Shaper and are for humans.
 */
import type { Vec2 } from '../model/types';

export const NS_SVG = 'http://www.w3.org/2000/svg';
export const NS_SHAPER = 'http://www.shapertools.com/namespaces/shaper';

export type CutType = 'outside' | 'inside' | 'pocket' | 'online' | 'guide';

/** Shaper's fill / stroke colors for each cut type. */
export const CUT_STYLE: Record<CutType, { fill: string; stroke: string }> = {
  outside: { fill: '#000000', stroke: 'none' },
  inside: { fill: '#FFFFFF', stroke: '#000000' },
  pocket: { fill: '#7F7F7F', stroke: 'none' },
  online: { fill: 'none', stroke: '#000000' },
  guide: { fill: 'none', stroke: '#0068FF' },
};

/** Stroke width (in) for drawn strokes. It is cosmetic: Shaper cuts the path, not the stroke. */
export const STROKE_IN = 0.01;

/** A number with at most 4 decimals and no trailing zeros ("-0" becomes "0"). */
export function fmt(n: number): string {
  const s = (Math.round(n * 10000) / 10000).toString();
  return s === '-0' ? '0' : s;
}
export const inches = (n: number): string => `${fmt(n)}in`;

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Maps a drawing point (u right, v up) to SVG user units (x right, y down). */
export type Xf = (p: Vec2) => Vec2;

/** Path data for a polygon (closed) or polyline (open), through `xf`. */
export function polyD(pts: Vec2[], xf: Xf, closed = true): string {
  const q = pts.map(xf);
  return q.map((p, i) => `${i ? 'L' : 'M'}${fmt(p[0])},${fmt(p[1])}`).join('') + (closed ? 'Z' : '');
}

/** Path data for an exact circle (two arcs), through `xf` (the transform must preserve distances, so mirroring is fine). */
export function circleD(c: Vec2, dia: number, xf: Xf): string {
  const r = dia / 2;
  const [x, y] = xf(c);
  return `M${fmt(x - r)},${fmt(y)}a${fmt(r)},${fmt(r)} 0 1,0 ${fmt(dia)},0a${fmt(r)},${fmt(r)} 0 1,0 ${fmt(-dia)},0Z`;
}

export interface PathOpts {
  id?: string;
  cutType: CutType;
  d: string;
  /** Cut depth (in), for outside / inside / pocket / online; a guide's is 0. */
  depthIn?: number;
  dashed?: boolean;
  label?: string;
  /** Extra attributes, already escaped. */
  extra?: string;
}

/** One `<path>` element in Shaper's conventions. */
export function pathEl(o: PathOpts): string {
  const st = CUT_STYLE[o.cutType];
  const w = o.cutType === 'outside' || o.cutType === 'pocket' ? '' : ` stroke-width="${STROKE_IN}"`;
  const dash = o.dashed ? ` stroke-dasharray="0.08 0.06"` : '';
  // Every path carries a depth (a guide's is 0: Shaper does not cut it).
  const depth = ` shaper:cutDepth="${inches(o.depthIn ?? 0)}"`;
  const rule = o.cutType === 'outside' || o.cutType === 'pocket' || o.cutType === 'inside' ? ' fill-rule="evenodd"' : '';
  const id = o.id ? ` id="${esc(o.id)}"` : '';
  const lab = o.label ? `<title>${esc(o.label)}</title>` : '';
  return `<path${id} d="${o.d}" fill="${st.fill}" stroke="${st.stroke}"${w}${dash}${rule} shaper:cutType="${o.cutType}"${depth}${o.extra ? ' ' + o.extra : ''}>${lab}</path>`;
}

/** A guide `<path>` (blue, no fill). */
export const guideEl = (d: string, o: { dashed?: boolean; label?: string; id?: string } = {}): string => pathEl({ cutType: 'guide', d, ...o });

/** A text element (ignored by Shaper). `xf` places the anchor; `size` is the font height in inches. */
export function textEl(p: Vec2, text: string, size = 0.16, o: { anchor?: 'start' | 'middle' | 'end'; fill?: string; rotate?: number; bold?: boolean; guide?: boolean } = {}): string {
  const rot = o.rotate ? ` transform="rotate(${fmt(o.rotate)} ${fmt(p[0])} ${fmt(p[1])})"` : '';
  // `guide`: no fill of its own, so the text takes the stroke-only guide style of the group it sits in (a filled glyph is not a guide).
  const fill = o.guide ? '' : ` fill="${o.fill ?? '#0068FF'}"`;
  return `<text x="${fmt(p[0])}" y="${fmt(p[1])}" font-family="Helvetica, Arial, sans-serif" font-size="${fmt(size)}"${fill} text-anchor="${o.anchor ?? 'start'}"${o.bold ? ' font-weight="bold"' : ''}${rot}>${esc(text)}</text>`;
}

export interface DocOpts {
  widthIn: number;
  heightIn: number;
  /** Top-left of the viewBox (in), default 0, 0. */
  minX?: number;
  minY?: number;
  title: string;
  desc?: string;
  body: string;
}

/** The root `<svg>` with physical size in inches and a matching viewBox (one user unit = one inch). */
export function svgDocument(o: DocOpts): string {
  const w = fmt(o.widthIn), h = fmt(o.heightIn);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="${NS_SVG}" xmlns:shaper="${NS_SHAPER}" width="${w}in" height="${h}in" viewBox="${fmt(o.minX ?? 0)} ${fmt(o.minY ?? 0)} ${w} ${h}" overflow="visible">\n` +
    `<title>${esc(o.title)}</title>\n` +
    (o.desc ? `<desc>${esc(o.desc)}</desc>\n` : '') +
    `${o.body}\n</svg>\n`
  );
}

// ── Geometry helpers ──

export function bbox(pts: Vec2[]): { u0: number; v0: number; u1: number; v1: number } {
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const [u, v] of pts) { u0 = Math.min(u0, u); v0 = Math.min(v0, v); u1 = Math.max(u1, u); v1 = Math.max(v1, v); }
  return { u0, v0, u1, v1 };
}

export function polyArea(o: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < o.length; i++) { const [x0, y0] = o[i], [x1, y1] = o[(i + 1) % o.length]; a += x0 * y1 - x1 * y0; }
  return a / 2;
}

export function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Shortest distance from `p` to the boundary of `poly`. */
export function distToPoly(p: Vec2, poly: Vec2[]): number {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    m = Math.min(m, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  }
  return m;
}

/** A rectangle around the segment a-b, `width` wide (no end extension), as a CCW loop. */
export function rectAlong(a: Vec2, b: Vec2, width: number): Vec2[] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * (width / 2), ny = (dx / l) * (width / 2);
  return [[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]];
}

export const rectLoop = (u0: number, v0: number, u1: number, v1: number): Vec2[] => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

/** A dimension line from a to b (drawing coordinates), offset `off` perpendicular, with ticks and the label centered; returns guide elements. `xf` maps to SVG. */
export function dimensionEls(a: Vec2, b: Vec2, label: string, xf: Xf, off = 0.5, size = 0.18): string {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l, ny = dx / l;
  const a2: Vec2 = [a[0] + nx * off, a[1] + ny * off], b2: Vec2 = [b[0] + nx * off, b[1] + ny * off];
  const ext = off > 0 ? 0.08 : -0.08;
  const tick = (p: Vec2): Vec2[] => [p, [p[0] + nx * (off + ext), p[1] + ny * (off + ext)]];
  const mid: Vec2 = [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2];
  const m = xf([mid[0] + nx * 0.08 * Math.sign(off || 1), mid[1] + ny * 0.08 * Math.sign(off || 1)]);
  const ang = (Math.atan2(-(xf(b)[1] - xf(a)[1]), xf(b)[0] - xf(a)[0]) * 180) / Math.PI;
  const rot = Math.abs(ang) > 90 ? -ang + 180 : -ang; // keep the text upright
  return (
    guideEl(polyD([a2, b2], xf, false), { label: `dimension ${label}` }) +
    guideEl(polyD(tick(a), xf, false)) + guideEl(polyD(tick(b), xf, false)) +
    textEl(m, label, size, { anchor: 'middle', rotate: Math.abs(rot) < 0.5 ? 0 : rot })
  );
}

/** A 1 in x 1 in check square (guide), with a label, at drawing position `at` (lower left). */
export function checkSquareEls(at: Vec2, xf: Xf): string {
  const sq: Vec2[] = [[at[0], at[1]], [at[0] + 1, at[1]], [at[0] + 1, at[1] + 1], [at[0], at[1] + 1]];
  const c = xf([at[0] + 0.5, at[1] + 0.5]);
  return guideEl(polyD(sq, xf), { label: '1 in check square' }) + textEl([c[0], c[1] - 0.02], '1 in', 0.16, { anchor: 'middle' }) + textEl([c[0], c[1] + 0.18], 'CHECK', 0.12, { anchor: 'middle' });
}

// ── Single-stroke capital letters (Hershey-style) ──

/** One glyph: polylines in a unit box (cap height 1, y up) and its advance width. Only the letters needed so far (DO NOT STEP) plus a few more for labels. */
interface Glyph { strokes: Vec2[][]; w: number }

const ellipse = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number): Vec2[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as Vec2; });

export const GLYPHS: Record<string, Glyph> = {
  ' ': { strokes: [], w: 0.55 },
  D: { strokes: [[[0, 0], [0, 1], [0.28, 1], ...ellipse(0.28, 0.5, 0.37, 0.5, Math.PI / 2, -Math.PI / 2, 10).slice(1, -1), [0.28, 0], [0, 0]]], w: 0.75 },
  O: { strokes: [ellipse(0.38, 0.5, 0.38, 0.5, Math.PI / 2, Math.PI / 2 + 2 * Math.PI, 20)], w: 0.8 },
  N: { strokes: [[[0, 0], [0, 1], [0.72, 0], [0.72, 1]]], w: 0.8 },
  T: { strokes: [[[0, 1], [0.7, 1]], [[0.35, 1], [0.35, 0]]], w: 0.75 },
  S: { strokes: [[...ellipse(0.35, 0.74, 0.31, 0.26, Math.PI * 0.2, Math.PI * 1.5, 10), ...ellipse(0.35, 0.26, 0.31, 0.26, Math.PI * 0.5, -Math.PI * 0.8, 10).slice(1)]], w: 0.75 },
  E: { strokes: [[[0.65, 1], [0, 1], [0, 0], [0.65, 0]], [[0, 0.5], [0.5, 0.5]]], w: 0.75 },
  P: { strokes: [[[0, 0], [0, 1], [0.3, 1], ...ellipse(0.3, 0.74, 0.32, 0.26, Math.PI / 2, -Math.PI / 2, 8).slice(1), [0, 0.48]]], w: 0.75 },
  A: { strokes: [[[0, 0], [0.37, 1], [0.74, 0]], [[0.15, 0.35], [0.59, 0.35]]], w: 0.85 },
  R: { strokes: [[[0, 0], [0, 1], [0.3, 1], ...ellipse(0.3, 0.74, 0.32, 0.26, Math.PI / 2, -Math.PI / 2, 8).slice(1), [0, 0.48]], [[0.3, 0.48], [0.68, 0]]], w: 0.8 },
  L: { strokes: [[[0, 1], [0, 0], [0.6, 0]]], w: 0.7 },
  I: { strokes: [[[0.2, 0], [0.2, 1]]], w: 0.4 },
  B: { strokes: [[[0, 0], [0, 1], [0.3, 1], ...ellipse(0.3, 0.76, 0.3, 0.24, Math.PI / 2, -Math.PI / 2, 8).slice(1), [0, 0.52], [0.3, 0.52], ...ellipse(0.32, 0.26, 0.34, 0.26, Math.PI / 2, -Math.PI / 2, 8).slice(1), [0, 0]]], w: 0.8 },
  K: { strokes: [[[0, 0], [0, 1]], [[0.68, 1], [0, 0.4]], [[0.2, 0.58], [0.7, 0]]], w: 0.8 },
};

export interface StrokeText { strokes: Vec2[][]; widthIn: number }

/** Strokes of `text` (capitals and spaces) at cap height `heightIn`, centered on x = 0, y from -h/2 to +h/2 (y up). Unknown characters become spaces. */
export function strokeText(text: string, heightIn: number, gap = 0.28): StrokeText {
  const chars = [...text.toUpperCase()].map((c) => GLYPHS[c] ?? GLYPHS[' ']);
  const total = chars.reduce((s, g, i) => s + g.w + (i ? gap : 0), 0);
  let x = -total / 2;
  const strokes: Vec2[][] = [];
  chars.forEach((g, i) => {
    if (i) x += gap;
    for (const s of g.strokes) strokes.push(s.map(([gx, gy]): Vec2 => [(x + gx) * heightIn, (gy - 0.5) * heightIn]));
    x += g.w;
  });
  return { strokes, widthIn: total * heightIn };
}

// ── Parsing shop text ──

/** A number written as "1/4", "0.197", "3/16" or "1-1/2" (a plain number or a fraction); NaN when it is not one. */
export function parseInches(s: string): number {
  const t = s.trim();
  const mixed = /^(\d+)-(\d+)\/(\d+)$/.exec(t);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return /^\d*\.?\d+$/.test(t) ? Number(t) : NaN;
}

/** Deterministic short hash of a string (FNV-1a, 6 hex digits): a "revision" stamp from the params state, never the wall clock. */
export function hash6(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}
