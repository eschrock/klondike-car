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

/** Inches as a shop fraction to 1/`denom` (default 1/32): 1-3/32", 7/8", 12". Never a decimal. */
export function frac(v: number, denom = 32): string {
  const neg = v < 0;
  const n = Math.round(Math.abs(v) * denom);
  const whole = Math.floor(n / denom);
  let rem = n - whole * denom, d = denom;
  while (rem && rem % 2 === 0) { rem /= 2; d /= 2; }
  const s = rem === 0 ? `${whole}` : whole ? `${whole}-${rem}/${d}` : `${rem}/${d}`;
  return `${neg && n ? '-' : ''}${s}"`;
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Maps a drawing point (u right, v up) to SVG user units (x right, y down). */
export type Xf = (p: Vec2) => Vec2;

/** One piece of a path after arc fitting: a straight line, or a circular arc (SVG flags) to `p`. */
export type PathSeg = { k: 'L'; p: Vec2 } | { k: 'A'; p: Vec2; r: number; large: 0 | 1; sweep: 0 | 1 };

/** Largest turn at one vertex (rad) that can still be part of an arc: a corner of 30 degrees or more stays a corner. */
const ARC_MAX_TURN = Math.PI / 6;

/**
 * Fit circular arcs to a polyline already in output coordinates (x right, y down): every run of 3 or more segments whose vertices lie on one circle within `tol`, turning the same way
 * by less than 30 degrees at each vertex, becomes one arc; everything else stays straight. The model draws its round corners, slots and crowns as fine polylines with their vertices on
 * the true curve, so the arcs are the true curves (a crown, which is a parabola, becomes a few arcs within `tol`). Starts a closed loop at a sharp corner where it has one.
 */
export function fitArcs(q0: Vec2[], closed: boolean, tol = 5e-4): { start: Vec2; segs: PathSeg[] } {
  let q = q0.filter((p, i) => i === 0 || Math.hypot(p[0] - q0[i - 1][0], p[1] - q0[i - 1][1]) > 1e-9);
  if (closed && q.length > 2 && Math.hypot(q[0][0] - q[q.length - 1][0], q[0][1] - q[q.length - 1][1]) < 1e-9) q = q.slice(0, -1);
  const n0 = q.length;
  const turnAt = (pts: Vec2[], k: number): number => {
    const a = pts[k - 1], b = pts[k], c = pts[k + 1];
    const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
    return Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
  };
  if (closed && n0 > 3) {
    // start at the sharpest corner, so no arc is split by the start point
    const ring = (k: number) => q[(k + n0) % n0];
    let best = 0, bestT = -1;
    for (let k = 0; k < n0; k++) { const t = Math.abs(turnAt([ring(k - 1), ring(k), ring(k + 1)], 1)); if (t > bestT) { bestT = t; best = k; } }
    // no sharp corner (a stadium, a slot with round ends): start at the longest edge, a straight side, so no round end is split
    if (bestT < ARC_MAX_TURN) { let len = -1; for (let k = 0; k < n0; k++) { const l = Math.hypot(ring(k + 1)[0] - ring(k)[0], ring(k + 1)[1] - ring(k)[1]); if (l > len) { len = l; best = k; } } }
    q = [...q.slice(best), ...q.slice(0, best)];
  }
  const pts = closed ? [...q, q[0]] : q;
  const N = pts.length;
  const circle = (a: Vec2, b: Vec2, c: Vec2): { c: Vec2; r: number } | null => {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-12) return null;
    const a2 = a[0] * a[0] + a[1] * a[1], b2 = b[0] * b[0] + b[1] * b[1], c2 = c[0] * c[0] + c[1] * c[1];
    const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
    return { c: [cx, cy], r: Math.hypot(a[0] - cx, a[1] - cy) };
  };
  const segs: PathSeg[] = [];
  let i = 0;
  while (i < N - 1) {
    let best = -1, bestFit: { c: Vec2; r: number } | null = null, sign = 0, span = 0, bestSpan = 0;
    for (let j = i + 1; j < N; j++) {
      if (j > i + 1) {
        const t = turnAt(pts, j - 1);
        if (Math.abs(t) >= ARC_MAX_TURN || Math.abs(t) < 1e-9 || (sign && Math.sign(t) !== sign)) break;
        sign = Math.sign(t);
        span += Math.abs(t);
        if (span > 1.5 * Math.PI) break;
      }
      if (j < i + 3) continue;
      const fit = circle(pts[i], pts[(i + j) >> 1], pts[j]);
      if (!fit || fit.r > 1e3) break;
      let ok = true;
      for (let k = i; k <= j && ok; k++) ok = Math.abs(Math.hypot(pts[k][0] - fit.c[0], pts[k][1] - fit.c[1]) - fit.r) <= tol;
      if (!ok) break;
      best = j; bestFit = fit; bestSpan = span;
    }
    if (best > 0 && bestFit) {
      // the arc's own span: the turning between its first and last chords plus half a chord's central angle at each end
      const half = (a: Vec2, b: Vec2) => Math.asin(Math.min(1, Math.hypot(b[0] - a[0], b[1] - a[1]) / (2 * bestFit!.r)));
      const total = bestSpan + half(pts[i], pts[i + 1]) + half(pts[best - 1], pts[best]);
      segs.push({ k: 'A', p: pts[best], r: bestFit.r, large: total > Math.PI ? 1 : 0, sweep: sign > 0 ? 1 : 0 });
      i = best;
    } else {
      segs.push({ k: 'L', p: pts[i + 1] });
      i++;
    }
  }
  // A lone short chord left over between two gentle arcs, or between an arc and the loop's start (the last few points of a crown that no longer fit the arc beside it), takes the
  // neighboring arc's radius when it turns the same gentle way at both ends: otherwise it would be a visible flat on the curve.
  const ends: Vec2[] = [pts[0], ...segs.map((x) => x.p)];
  const turnOf = (a: Vec2, b: Vec2, c: Vec2) => turnAt([a, b, c], 1);
  for (let m = 0; m < segs.length; m++) {
    const sg = segs[m];
    if (sg.k !== 'L') continue;
    const prevA = segs[m - 1]?.k === 'A' ? (segs[m - 1] as Extract<PathSeg, { k: 'A' }>) : null, nextA = segs[m + 1]?.k === 'A' ? (segs[m + 1] as Extract<PathSeg, { k: 'A' }>) : null;
    // the neighbor to borrow from: the flatter one (a crown arc rather than a tight corner)
    const nb = prevA && nextA ? (prevA.r >= nextA.r ? prevA : nextA) : prevA ?? nextA;
    if (!nb) continue;
    const a = ends[m], b = ends[m + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len >= nb.r) continue;
    const before = m > 0 ? ends[m - 1] : closed ? ends[ends.length - 2] : null, after = m + 2 < ends.length ? ends[m + 2] : closed ? ends[1] : null;
    const want = nb.sweep ? 1 : -1;
    // gentle where it meets the arc it borrows from; the other end only has to turn the same way (its neighbor's chord can sit well off that arc's tangent)
    const tB = before ? turnOf(before, a, b) : want * 1e-3, tA = after ? turnOf(a, b, after) : want * 1e-3;
    const [tNb, tOther] = nb === prevA ? [tB, tA] : [tA, tB];
    if (Math.sign(tNb) !== want || Math.abs(tNb) >= ARC_MAX_TURN || Math.sign(tOther) !== want || Math.abs(tOther) >= Math.PI / 2) continue;
    segs[m] = { k: 'A', p: sg.p, r: nb.r, large: 0, sweep: nb.sweep };
  }
  if (closed && segs.length && segs[segs.length - 1].k === 'L') segs.pop(); // the closing line is the Z
  return { start: pts[0], segs };
}

/** Path data with the round parts as true arcs (fitArcs), through `xf` (it must keep distances: a mirror or a flip is fine). `num` formats one coordinate. */
export function arcD(pts: Vec2[], xf: Xf, closed = true, num: (v: number) => string = fmt): string {
  const { start, segs } = fitArcs(pts.map(xf), closed);
  return `M${num(start[0])},${num(start[1])}` + segs.map((s) => (s.k === 'L' ? `L${num(s.p[0])},${num(s.p[1])}` : `A${num(s.r)},${num(s.r)} 0 ${s.large},${s.sweep} ${num(s.p[0])},${num(s.p[1])}`)).join('') + (closed ? 'Z' : '');
}

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

/**
 * Attributes of a group that holds human text: stroke-only blue (a guide's colors), never a filled glyph, never a cut path. Shaper ignores `<text>`; if an importer turned glyphs into paths they would be
 * blue guide strokes. 0.008 in so a screen preview stays readable.
 */
export const ANNOTATION_ATTRS = 'shaper:cutType="guide" fill="none" stroke="#0068FF" stroke-width="0.008"';

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
/** A slot with round ends (a mortise or Domino cut by a round cutter): the box's short side is the diameter of each end. */
export function roundEndSlot(b: { u0: number; v0: number; u1: number; v1: number }, seg = 8): Vec2[] {
  const w = b.u1 - b.u0, h = b.v1 - b.v0, r = Math.min(w, h) / 2;
  const out: Vec2[] = [];
  const arc = (cx: number, cy: number, a0: number) => { for (let k = 0; k <= seg; k++) { const a = a0 + (Math.PI * k) / seg; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  if (h >= w) { arc(b.u0 + r, b.v1 - r, 0); arc(b.u0 + r, b.v0 + r, Math.PI); } // up and down: the top end, then the bottom end
  else { arc(b.u1 - r, b.v0 + r, -Math.PI / 2); arc(b.u0 + r, b.v0 + r, Math.PI / 2); }
  return out;
}


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
    textEl(m, label, size, { anchor: 'middle', rotate: Math.abs(rot) < 0.5 ? 0 : rot, guide: true })
  );
}

/** A 1 in x 1 in check square (guide), with a label, at drawing position `at` (lower left). */
export function checkSquareEls(at: Vec2, xf: Xf): string {
  const sq: Vec2[] = [[at[0], at[1]], [at[0] + 1, at[1]], [at[0] + 1, at[1] + 1], [at[0], at[1] + 1]];
  const c = xf([at[0] + 0.5, at[1] + 0.5]);
  return guideEl(polyD(sq, xf), { label: '1 in check square' }) + textEl([c[0], c[1] - 0.02], '1 in', 0.16, { anchor: 'middle', guide: true }) + textEl([c[0], c[1] + 0.18], 'CHECK', 0.12, { anchor: 'middle', guide: true });
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
