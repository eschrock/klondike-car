/**
 * Step figures: small labeled sketches for the assembly steps (Eric 2026-10-20: "I have no idea what I'm building or why"). Plain TS, no DOM, no three.js.
 *
 * A figure is a self-contained SVG string on a white card (it reads the same in the light and dark themes and on paper), drawn in a fixed pixel
 * space (`FIG_W` wide) and scaled to the panel width. Figures are explanatory, not shop drawings: the dimensioned drawings stay in the Forms and Part
 * drawings sections. Shapes come from the model where it is cheap (the web's flat pattern, the ramp profiles, the plan curve) and are schematic
 * otherwise; every number a figure prints comes from the model, the forms or the params, never typed in. Text follows the build-instructions style:
 * fractions, no decimals, no internal names.
 */
import type { Params } from '../../params';
import type { Part, Vec2 } from '../../model/types';
import type { CutList } from '../cutlist';
import type { FormDrawing } from '../forms';
import type { PartDrawingSheet } from '../part-drawings';
import { esc, fmt } from '../svg-util';

/** One figure of a step. `caption` may use `[[step:id]]` (the step's number in this book), resolved by `assemblySteps`. */
export interface StepFigure {
  id: string;
  title: string;
  caption: string;
  svg: string;
}

/** What a figure may read: the same lazy context the step templates get (`StepCtx` satisfies it). */
export interface FigCtx {
  parts: Part[];
  p: Params;
  by: (id: string) => Part | undefined;
  forms: () => FormDrawing[];
  cut: () => CutList;
  drawings: () => PartDrawingSheet[];
}

export type FigFn = (c: FigCtx) => StepFigure | null;

/** The nominal width of every figure (px); heights vary. */
export const FIG_W = 760;

/** Fill and stroke for each kind of material, so a reader learns one color per material across the whole book. */
export const MAT = {
  oak: { fill: '#e9cf9b', stroke: '#8a6531', label: 'white oak' },
  web: { fill: '#f6ebcd', stroke: '#a3874f', label: 'thin plywood (web)' },
  deck: { fill: '#e8b898', stroke: '#9a5f3c', label: 'deck plywood' },
  mdf: { fill: '#cdc6b8', stroke: '#6a6354', label: 'MDF' },
  hardboard: { fill: '#9a7f60', stroke: '#5a4630', label: 'hardboard' },
  template: { fill: '#f1e3bd', stroke: '#8c7745', label: '1/4" plywood template' },
  bench: { fill: '#e7e3dc', stroke: '#8f8a80', label: 'bench top (sacrificial)' },
  epoxy: { fill: '#f2a900', stroke: '#9a6b00', label: 'epoxy' },
  steel: { fill: '#c5ccd4', stroke: '#47525e', label: 'stainless steel' },
  clamp: { fill: '#dbe7fb', stroke: '#2563eb', label: 'clamp' },
  ghost: { fill: '#f1f1f1', stroke: '#a9a9a9', label: 'already built' },
  rubber: { fill: '#555555', stroke: '#222222', label: 'rubber' },
} as const;
export type MatName = keyof typeof MAT;

/** The accent for "this is the work of this step" (arrows, the new part's outline). */
export const ACCENT = '#d9480f';
export const INK = '#1f2328';
export const MUTED = '#5f6670';
/** Dimension lines and their text. */
export const DIM = '#2b6cb0';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export interface Style {
  fill?: string;
  stroke?: string;
  width?: number;
  dash?: string;
  opacity?: number;
}

export const mat = (m: MatName, extra: Style = {}): Style => ({ fill: MAT[m].fill, stroke: MAT[m].stroke, width: 1.2, ...extra });

function styleAttrs(s: Style): string {
  return [
    `fill="${s.fill ?? 'none'}"`,
    `stroke="${s.stroke ?? 'none'}"`,
    s.stroke ? `stroke-width="${fmt(s.width ?? 1.2)}"` : '',
    s.dash ? `stroke-dasharray="${s.dash}"` : '',
    s.opacity !== undefined ? `opacity="${fmt(s.opacity)}"` : '',
    s.stroke ? 'stroke-linejoin="round" stroke-linecap="round"' : '',
  ].filter(Boolean).join(' ');
}

export interface TextOpts {
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  weight?: 'normal' | 'bold';
  color?: string;
  italic?: boolean;
  /** Line height for multi-line text, as a multiple of the size. */
  lead?: number;
  /** Rotate the text about its anchor point (degrees, clockwise). */
  rotate?: number;
}

const pt = (p: Vec2): string => `${fmt(p[0])},${fmt(p[1])}`;

/** A map from a model or pattern frame (inches, y up) onto a box of the figure (px, y down). */
export interface Frame {
  at: (p: Vec2) => Vec2;
  /** px per inch along x and y. */
  kx: number;
  ky: number;
}

/**
 * Fit the bounds (inches, y up) into the box (px). `exaggerateY` stretches y by that factor over x (a long, low part drawn readable; say so in the
 * caption). `align` puts the drawing at the box's bottom (default) or center when the aspect leaves room.
 */
export function fit(b: { minX: number; minY: number; maxX: number; maxY: number }, box: { x: number; y: number; w: number; h: number }, exaggerateY = 1, align: 'bottom' | 'center' = 'bottom'): Frame {
  const bw = Math.max(1e-9, b.maxX - b.minX), bh = Math.max(1e-9, b.maxY - b.minY);
  const k = Math.min(box.w / bw, box.h / (bh * exaggerateY));
  const kx = k, ky = k * exaggerateY;
  const x0 = box.x + (box.w - bw * kx) / 2;
  const yBase = align === 'bottom' ? box.y + box.h : box.y + (box.h + bh * ky) / 2;
  return { kx, ky, at: ([x, y]) => [x0 + (x - b.minX) * kx, yBase - (y - b.minY) * ky] };
}

export function boundsOf(pts: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY };
}

/** Builds one figure. Coordinates are figure px, y down. */
export class Fig {
  private els: string[] = [];
  constructor(readonly w: number = FIG_W, readonly h: number = 360) {}

  raw(svg: string): this { this.els.push(svg); return this; }

  path(d: string, s: Style): this { this.els.push(`<path d="${d}" ${styleAttrs(s)}/>`); return this; }

  poly(pts: Vec2[], s: Style, closed = true): this {
    if (pts.length < 2) return this;
    return this.path(pts.map((p, i) => `${i ? 'L' : 'M'}${pt(p)}`).join('') + (closed ? 'Z' : ''), s);
  }

  rect(x: number, y: number, w: number, h: number, s: Style, r = 0): this {
    this.els.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(Math.max(0, w))}" height="${fmt(Math.max(0, h))}"${r ? ` rx="${fmt(r)}"` : ''} ${styleAttrs(s)}/>`);
    return this;
  }

  line(a: Vec2, b: Vec2, s: Style = { stroke: INK }): this { return this.poly([a, b], s, false); }

  circle(c: Vec2, r: number, s: Style): this { this.els.push(`<circle cx="${fmt(c[0])}" cy="${fmt(c[1])}" r="${fmt(r)}" ${styleAttrs(s)}/>`); return this; }

  /**
   * An arrow from a to b (an action: bend, press, flip, lower). The head is a drawn triangle, not an SVG marker: markers need `url(#id)`, which the
   * self-contained build book forbids, and their ids would collide between figures on one page.
   */
  arrow(a: Vec2, b: Vec2, color = ACCENT, width = 2.4, curve = 0): this {
    let d = `M${pt(a)}L${pt(b)}`;
    let from: Vec2 = a; // the point the head's direction comes from
    if (curve) {
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const c: Vec2 = [mx - (dy / L) * curve, my + (dx / L) * curve];
      d = `M${pt(a)}Q${pt(c)} ${pt(b)}`;
      from = c;
    }
    const ux0 = b[0] - from[0], uy0 = b[1] - from[1], ul = Math.hypot(ux0, uy0) || 1, ux = ux0 / ul, uy = uy0 / ul;
    const hl = 6 + width * 2, hw = 3 + width;
    const base: Vec2 = [b[0] - ux * hl, b[1] - uy * hl];
    this.els.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${fmt(width)}" stroke-linecap="round"/>`);
    return this.poly([b, [base[0] - uy * hw, base[1] + ux * hw], [base[0] + uy * hw, base[1] - ux * hw]], { fill: color });
  }

  text(at: Vec2, s: string | string[], o: TextOpts = {}): this {
    const lines = Array.isArray(s) ? s : [s];
    const size = o.size ?? 13, lead = (o.lead ?? 1.25) * size;
    const attrs = [
      `x="${fmt(at[0])}" y="${fmt(at[1])}"`,
      `font-family='${FONT}' font-size="${fmt(size)}"`,
      `fill="${o.color ?? INK}"`,
      o.anchor && o.anchor !== 'start' ? `text-anchor="${o.anchor}"` : '',
      o.weight === 'bold' ? 'font-weight="700"' : '',
      o.italic ? 'font-style="italic"' : '',
      o.rotate ? `transform="rotate(${fmt(o.rotate)} ${pt(at)})"` : '',
    ].filter(Boolean).join(' ');
    const spans = lines.map((t, i) => (i === 0 ? esc(t) : `<tspan x="${fmt(at[0])}" dy="${fmt(lead)}">${esc(t)}</tspan>`)).join('');
    this.els.push(`<text ${attrs}>${spans}</text>`);
    return this;
  }

  /**
   * A callout: a dot on the thing, a thin leader, and the text at `at` (lines). The leader ends at the text's near side, so text to the left of
   * the target is right-aligned.
   */
  label(target: Vec2, at: Vec2, s: string | string[], o: TextOpts = {}): this {
    const anchor = o.anchor ?? (at[0] < target[0] - 4 ? 'end' : 'start');
    const size = o.size ?? 13;
    const end: Vec2 = [at[0] + (anchor === 'end' ? 3 : anchor === 'start' ? -3 : 0), at[1] - size * 0.35];
    this.line(target, end, { stroke: MUTED, width: 1 });
    this.circle(target, 2.4, { fill: MUTED });
    return this.text(at, s, { ...o, anchor });
  }

  /**
   * A dimension: a thin line with end ticks between a and b, and its text, offset sideways by `off` px. The text runs along the line unless
   * `flat` is set, when it stays horizontal beside the line's middle (use it for short vertical dimensions).
   */
  dim(a: Vec2, b: Vec2, s: string, off = 0, o: TextOpts & { flat?: boolean } = {}): this {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    const A: Vec2 = [a[0] + nx * off, a[1] + ny * off], B: Vec2 = [b[0] + nx * off, b[1] + ny * off];
    const c = DIM;
    if (off) { this.line(a, A, { stroke: c, width: 0.8, dash: '2 2' }); this.line(b, B, { stroke: c, width: 0.8, dash: '2 2' }); }
    this.line(A, B, { stroke: c, width: 1 });
    for (const P of [A, B]) this.line([P[0] - (dx / L) * 4 - nx * 4, P[1] - (dy / L) * 4 - ny * 4], [P[0] + (dx / L) * 4 + nx * 4, P[1] + (dy / L) * 4 + ny * 4], { stroke: c, width: 1.2 });
    if (o.flat) {
      const m: Vec2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const right = (o.anchor ?? 'start') !== 'end';
      return this.text([m[0] + (right ? 6 : -6), m[1] + 4], s, { size: 12, color: c, ...o, anchor: right ? 'start' : 'end' });
    }
    const mid: Vec2 = [(A[0] + B[0]) / 2 + nx * 8, (A[1] + B[1]) / 2 + ny * 8 + 4];
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    const upright = ang > 90 || ang < -90 ? ang + 180 : ang;
    return this.text(mid, s, { size: 12, anchor: 'middle', color: c, ...o, rotate: Math.abs(upright) < 1 ? undefined : upright });
  }

  /**
   * A C-clamp seen side-on, squeezing the stack between `yTop` and `yBot` (px, yTop above) at x. The frame reaches round the stack from the `from`
   * side (the edge the clamp goes on from). Its screw end is at the top.
   */
  clamp(x: number, yTop: number, yBot: number, from: 'left' | 'right' = 'right', reach = 34): this {
    const s = from === 'right' ? 1 : -1, c = MAT.clamp.stroke;
    const back = x + s * reach;
    this.path(`M${pt([x, yBot + 6])}L${pt([back, yBot + 6])}L${pt([back, yTop - 22])}L${pt([x, yTop - 22])}`, { stroke: c, width: 4 });
    this.rect(x - 7, yBot, 14, 6, mat('clamp'));
    this.line([x, yTop - 22], [x, yTop - 6], { stroke: c, width: 3 });
    this.rect(x - 7, yTop - 6, 14, 6, mat('clamp'));
    this.line([x - 9, yTop - 30], [x + 9, yTop - 30], { stroke: c, width: 3 });
    return this.line([x, yTop - 30], [x, yTop - 22], { stroke: c, width: 3 });
  }

  /** A screw seen side-on, from its head at `a` to its tip at `b` (a flat head when `flat`). */
  screw(a: Vec2, b: Vec2, flat = true, color: string = MAT.steel.stroke): this {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const hw = 5, sw = 1.8;
    const head: Vec2[] = flat
      ? [[a[0] + nx * hw, a[1] + ny * hw], [a[0] - nx * hw, a[1] - ny * hw], [a[0] + ux * 5 - nx * sw, a[1] + uy * 5 - ny * sw], [a[0] + ux * 5 + nx * sw, a[1] + uy * 5 + ny * sw]]
      : [[a[0] + nx * hw - ux * 3, a[1] + ny * hw - uy * 3], [a[0] - nx * hw - ux * 3, a[1] - ny * hw - uy * 3], [a[0] - nx * hw, a[1] - ny * hw], [a[0] + nx * hw, a[1] + ny * hw]];
    this.poly([[a[0] + nx * sw, a[1] + ny * sw], [b[0] - ux * 4 + nx * sw, b[1] - uy * 4 + ny * sw], b, [b[0] - ux * 4 - nx * sw, b[1] - uy * 4 - ny * sw], [a[0] - nx * sw, a[1] - ny * sw]], { fill: MAT.steel.fill, stroke: color, width: 1 });
    return this.poly(head, { fill: MAT.steel.fill, stroke: color, width: 1 });
  }

  /** A bolt seen side-on, head at `a`, through to `b`, with a nut at `b` (washers are drawn by the caller if they matter). */
  bolt(a: Vec2, b: Vec2, color: string = MAT.steel.stroke): this {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const r = 3, hw = 7, ht = 5;
    const box = (c: Vec2, along: number, half: number): Vec2[] => [[c[0] + nx * half, c[1] + ny * half], [c[0] - nx * half, c[1] - ny * half], [c[0] - nx * half + ux * along, c[1] - ny * half + uy * along], [c[0] + nx * half + ux * along, c[1] + ny * half + uy * along]];
    this.poly(box(a, L + 6, r), { fill: MAT.steel.fill, stroke: color, width: 1 });
    this.poly(box([a[0] - ux * ht, a[1] - uy * ht], ht, hw), { fill: MAT.steel.fill, stroke: color, width: 1 });
    return this.poly(box(b, ht, hw), { fill: MAT.steel.fill, stroke: color, width: 1 });
  }

  /** Hatching inside a rectangle (a cut face in a section, or "glue goes here"). */
  hatch(x: number, y: number, w: number, h: number, color = MUTED, gap = 6): this {
    const d: string[] = [];
    for (let c = gap; c < w + h; c += gap) {
      const a: Vec2 = c <= w ? [x + c, y + h] : [x + w, y + h - (c - w)];
      const b: Vec2 = c <= h ? [x, y + h - c] : [x + c - h, y];
      d.push(`M${pt(a)}L${pt(b)}`);
    }
    return this.path(d.join(''), { stroke: color, width: 0.8 });
  }

  /** A numbered disc (the order of actions in the figure). */
  badge(at: Vec2, n: number | string, color = ACCENT): this {
    this.circle(at, 11, { fill: color });
    return this.text([at[0], at[1] + 4.5], String(n), { size: 13, anchor: 'middle', weight: 'bold', color: '#fff' });
  }

  /** The figure's heading, top left (a short "what you are looking at"). */
  heading(s: string, at: Vec2 = [16, 24]): this { return this.text(at, s, { size: 15, weight: 'bold' }); }

  /** A small panel title inside the figure (for a figure of two or three views). */
  sub(at: Vec2, s: string): this { return this.text(at, s, { size: 13, weight: 'bold', color: MUTED }); }

  /** Swatches for the materials shown, along the bottom (or at `at`). */
  legend(items: MatName[], at: Vec2 = [16, this.h - 16]): this {
    let x = at[0];
    for (const m of items) {
      this.rect(x, at[1] - 10, 14, 10, mat(m));
      this.text([x + 19, at[1]], MAT[m].label, { size: 11.5, color: MUTED });
      x += 19 + MAT[m].label.length * 6.3 + 18;
    }
    return this;
  }

  /** "Not to scale" (or a scale note) in the bottom right. */
  note(s = 'Not to scale'): this { return this.text([this.w - 14, this.h - 12], s, { size: 11, anchor: 'end', color: MUTED, italic: true }); }

  /** The SVG document. `title` is its accessible name. */
  svg(title: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(this.w)} ${fmt(this.h)}" width="${fmt(this.w)}" height="${fmt(this.h)}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="100%" height="100%" fill="#ffffff"/>${this.els.join('')}</svg>`;
  }
}

/** Points of a polyline offset along y in figure px (a band drawn just under a line). */
export const shiftY = (pts: Vec2[], dy: number): Vec2[] => pts.map(([x, y]) => [x, y + dy]);

/** A closed band between two polylines (the second reversed). */
export const bandBetween = (a: Vec2[], b: Vec2[]): Vec2[] => [...a, ...[...b].reverse()];

/** All the text a figure shows (its `<text>`/`<tspan>` contents), for the style tests. */
export function figureTexts(svg: string): string[] {
  const out: string[] = [];
  for (const m of svg.matchAll(/<(?:text|tspan)\b[^>]*>([^<]*)/g)) if (m[1].trim()) out.push(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  return out;
}
