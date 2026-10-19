/**
 * XTool S1 laser files (D-86): geometry helpers, the bed-fit rule and the SVG writer. Plain TS, no DOM, no three.js; a leaf module (svg-util only), so `cutlist.ts` and `forms.ts` can use it.
 *
 * The files are full size and in real inches: width and height carry the unit ("59.5in"), and the viewBox is in 96 dpi pixels (1 in = 96 units), the scale XCS and every other importer assumes, so a
 * file imports at its true size whichever reading an importer takes. Colors follow the usual laser convention:
 *   red   #FF0000  cut through (holes and inner loops are listed first, the outline last: cut them in that order)
 *   blue  #0000FF  score / mark (a light pass: station lines, drill marks, lettering). Not cut through.
 * Strokes only, no fills, no text (a laser would engrave a filled glyph); names live in <title> and <desc>.
 */
import type { Vec2 } from '../model/types';
import { bbox, esc, fmt, polyArea } from './svg-util';

/** Widest piece the laser cuts (in): the S1 with the conveyor feeder has an 18.5 in (470 mm) processing width (material up to 21.5 in wide). Eric's figures from the maker's specs: verify on the machine. */
export const LASER_MAX_WIDTH_IN = 18.5;
/** Longest piece / file (in): 118 in with the full extension rails (the basic set is 39 in; a 59-1/2 in web needs more rail). */
export const LASER_MAX_LENGTH_IN = 118;
/** Thickest sheet the laser is trusted to cut through (in): Eric's figure, "1/4 in plywood or similar". 6 mm Baltic birch (0.236) passes; the 12 mm okoume sheets do not. */
export const LASER_MAX_THICKNESS_IN = 0.26;
export const LASER_CUT = '#FF0000';
export const LASER_SCORE = '#0000FF';
/** Space left around and between pieces on a laser sheet (in). */
export const LASER_GAP_IN = 0.25;
/** A band is cut this much under the bed width (in), so the piece clears the bed edge. */
const BAND_SLACK_IN = 0.5;
export const LASER_MARGIN_IN = 0.125;
/** The importer scale: user units (px) per inch. */
const PX = 96;

/** Woods and wood sheets only (a diode laser melts plastics and cannot cut metal). */
const LASERABLE = /oak|ply|birch|okoume|hardboard|mdf|maple|walnut/i;

export interface LaserVerdict {
  ok: boolean;
  /** Plain words for the cut list: "yes", or why not. */
  text: string;
}

const mmOf = (t: number): string => `${+(t * 25.4).toFixed(1)} mm`;

/** Can the S1 cut this flat part? `widthIn` x `heightIn` is its flat pattern; the short side must fit the bed width (the long side runs along the conveyor). */
export function laserVerdict(o: { thicknessIn: number; material: string; widthIn: number; heightIn: number }): LaserVerdict {
  if (!LASERABLE.test(o.material)) return { ok: false, text: 'no: not wood or plywood' };
  if (o.thicknessIn > LASER_MAX_THICKNESS_IN + 1e-6) return { ok: false, text: `no: ${mmOf(o.thicknessIn)} is thicker than the ${fmtFrac(LASER_MAX_THICKNESS_IN, 32)} the laser cuts` };
  const short = Math.min(o.widthIn, o.heightIn), long = Math.max(o.widthIn, o.heightIn);
  if (short > LASER_MAX_WIDTH_IN + 1e-6) return { ok: false, text: `no: ${fmtFrac(short)} wide is wider than the ${fmtFrac(LASER_MAX_WIDTH_IN)} bed` };
  if (long > LASER_MAX_LENGTH_IN + 1e-6) return { ok: false, text: `no: ${fmtFrac(long)} is longer than the ${fmtFrac(LASER_MAX_LENGTH_IN)} feed` };
  return { ok: true, text: 'yes' };
}

/** A shop fraction to 1/8 for verdict text: 12-1/2", 14-3/8". */
function fmtFrac(v: number, den = 8): string {
  const n = Math.round(v * den), whole = Math.floor(n / den);
  let rem = n - whole * den, d = den;
  while (rem && rem % 2 === 0) { rem /= 2; d /= 2; }
  return `${rem === 0 ? `${whole}` : whole ? `${whole}-${rem}/${d}` : `${rem}/${d}`}"`;
}

// ── Shapes ──

/** One flat piece to cut. Coordinates in inches, v up. */
export interface LaserShape {
  id: string;
  label: string;
  /** Outline, cut through. */
  outer: Vec2[];
  /** Inner loops, cut through. */
  holes: Vec2[][];
  /** Round holes, cut through. */
  circles: Array<{ c: Vec2; dia: number }>;
  /** Score lines (open polylines, or closed when the first point repeats). */
  score: Vec2[][];
  /** Score circles (drill marks): a circle and a cross. */
  marks: Array<{ c: Vec2; dia: number }>;
}

export const emptyShape = (id: string, label: string, outer: Vec2[]): LaserShape => ({ id, label, outer, holes: [], circles: [], score: [], marks: [] });

export const shapeBox = (s: LaserShape): { u0: number; v0: number; u1: number; v1: number } => bbox(s.outer);

/** Map every point of a shape (a distance-preserving map, so circles stay circles). */
export function mapShape(s: LaserShape, f: (p: Vec2) => Vec2): LaserShape {
  return {
    ...s,
    outer: s.outer.map(f),
    holes: s.holes.map((h) => h.map(f)),
    circles: s.circles.map((c) => ({ ...c, c: f(c.c) })),
    score: s.score.map((l) => l.map(f)),
    marks: s.marks.map((m) => ({ ...m, c: f(m.c) })),
  };
}

/** Shift a shape so its outline's bounding box starts at (0, 0). */
export function normalizeShape(s: LaserShape): LaserShape {
  const b = shapeBox(s);
  return mapShape(s, ([u, v]) => [u - b.u0, v - b.v0]);
}

/** Turn a shape a quarter turn counter-clockwise (v up), then re-zero it. */
export function rotateShape(s: LaserShape): LaserShape {
  return normalizeShape(mapShape(s, ([u, v]) => [-v, u]));
}

// ── Half-plane clipping (splitting a template into bands that fit the bed) ──

type Axis = 'u' | 'v';
const ax = (p: Vec2, a: Axis): number => (a === 'u' ? p[0] : p[1]);

/** Sutherland-Hodgman: the part of a loop where the `axis` coordinate is >= `at` (keep 'hi') or <= `at` ('lo'). Right for a loop whose clipped result is one piece. */
export function clipLoop(loop: Vec2[], axis: Axis, at: number, keep: 'lo' | 'hi'): Vec2[] {
  const inside = (p: Vec2): boolean => (keep === 'hi' ? ax(p, axis) >= at - 1e-9 : ax(p, axis) <= at + 1e-9);
  const out: Vec2[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (at - ax(a, axis)) / (ax(b, axis) - ax(a, axis));
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

/** The parts of a polyline on one side of the line (each run is its own polyline). */
export function clipLine(line: Vec2[], axis: Axis, at: number, keep: 'lo' | 'hi'): Vec2[][] {
  const inside = (p: Vec2): boolean => (keep === 'hi' ? ax(p, axis) >= at - 1e-9 : ax(p, axis) <= at + 1e-9);
  const runs: Vec2[][] = [];
  let cur: Vec2[] = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[i];
    if (inside(a)) cur.push(a);
    const b = line[i + 1];
    if (b === undefined) break;
    if (inside(a) !== inside(b)) {
      const t = (at - ax(a, axis)) / (ax(b, axis) - ax(a, axis));
      const x: Vec2 = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      if (inside(a)) { cur.push(x); runs.push(cur); cur = []; } else cur = [x];
    }
  }
  if (cur.length > 1) runs.push(cur);
  return runs.filter((r) => r.length > 1);
}

/** One side of a shape cut at `axis = at` (its marks and holes follow; a circle goes with the side its center is on). */
export function clipShape(s: LaserShape, axis: Axis, at: number, keep: 'lo' | 'hi', id: string, label: string): LaserShape {
  const side = (p: Vec2): boolean => (keep === 'hi' ? ax(p, axis) >= at : ax(p, axis) < at);
  return {
    id, label,
    outer: clipLoop(s.outer, axis, at, keep),
    holes: s.holes.filter((h) => side(h[0])),
    circles: s.circles.filter((c) => side(c.c)),
    score: s.score.flatMap((l) => clipLine(l, axis, at, keep)),
    marks: s.marks.filter((m) => side(m.c)),
  };
}

/**
 * A shape taller than the bed, cut across the middle into bands that fit (repeatedly, if need be). Only for templates and forms that lie flat and screwed down: the bands butt on the bench and the
 * seam does not matter. Never for a part (a web in two pieces would not be a web).
 */
export function fitToBed(s: LaserShape): LaserShape[] {
  const b = shapeBox(s);
  if (b.v1 - b.v0 <= LASER_MAX_WIDTH_IN + 1e-9) return [s];
  // The lower band takes all the bed allows, so the leftover sliver packs beside other pieces and the file stays short.
  const cut = b.v0 + LASER_MAX_WIDTH_IN - BAND_SLACK_IN;
  return [
    ...fitToBed(clipShape(s, 'v', cut, 'lo', `${s.id}-lower`, `${s.label}, lower band`)),
    ...fitToBed(clipShape(s, 'v', cut, 'hi', `${s.id}-upper`, `${s.label}, upper band`)),
  ];
}

/** Area of a shape's outline (in squared): for checking that a split loses nothing. */
export const shapeArea = (s: LaserShape): number => Math.abs(polyArea(s.outer));

// ── Layout ──

export interface LaserItem { shape: LaserShape; qty: number }
export interface Placed { shape: LaserShape; x: number; y: number }

/**
 * Shelf layout on a strip no wider than `maxW`: the longest piece first, rows of pieces stacked across the width, a new column started to the right when a row will not fit. Pieces are placed as
 * drawn (never turned: the caller decides the orientation). Returns each piece's lower-left corner (v up) and the extents of the whole layout, margins included.
 */
export function layoutShapes(items: LaserItem[], maxW = LASER_MAX_WIDTH_IN, gap = LASER_GAP_IN, margin = LASER_MARGIN_IN): { placed: Placed[]; widthIn: number; heightIn: number } {
  const copies: LaserShape[] = items.flatMap((it) => Array.from({ length: it.qty }, (_, i) => (it.qty > 1 ? { ...it.shape, id: `${it.shape.id}-${i + 1}`, label: `${it.shape.label} (${i + 1} of ${it.qty})` } : it.shape)));
  const sized = copies.map((s) => { const b = shapeBox(s); return { s, w: b.u1 - b.u0, h: b.v1 - b.v0, b }; }).sort((a, b) => b.w - a.w || b.h - a.h);
  interface Row { y: number; h: number; used: number }
  interface Col { x: number; w: number; rows: Row[]; h: number }
  const cols: Col[] = [];
  const placed: Placed[] = [];
  for (const it of sized) {
    let spot: { col: Col; row: Row } | null = null;
    for (const col of cols) {
      for (const row of col.rows) {
        if (it.h <= row.h + 1e-9 && row.used + gap + it.w <= col.w + 1e-9) { spot = { col, row }; break; }
      }
      if (spot) break;
      if (it.w <= col.w + 1e-9 && col.h + gap + it.h <= maxW + 1e-9) {
        const row: Row = { y: col.h + gap, h: it.h, used: -gap };
        col.rows.push(row); col.h = row.y + row.h;
        spot = { col, row };
        break;
      }
    }
    if (!spot) {
      const col: Col = { x: cols.length ? cols[cols.length - 1].x + cols[cols.length - 1].w + gap : 0, w: it.w, rows: [], h: -gap };
      const row: Row = { y: 0, h: it.h, used: -gap };
      col.rows.push(row); col.h = it.h;
      cols.push(col);
      spot = { col, row };
    }
    const { col, row } = spot;
    const x = col.x + row.used + gap, y = row.y;
    row.used = x - col.x + it.w;
    placed.push({ shape: it.s, x: x - it.b.u0, y: y - it.b.v0 });
  }
  const last = cols[cols.length - 1];
  const length = last ? last.x + last.w : 0;
  const width = Math.max(0, ...cols.map((c) => c.h));
  return { placed, widthIn: length + 2 * margin, heightIn: width + 2 * margin };
}

// ── SVG ──

/** A coordinate in importer pixels (1/96 in), 3 decimals. */
const px = (v: number): string => {
  const s = (Math.round(v * PX * 1000) / 1000).toString();
  return s === '-0' ? '0' : s;
};

export interface LaserDoc {
  title: string;
  desc: string;
  items: LaserItem[];
}

export interface LaserSvg {
  svg: string;
  widthIn: number;
  heightIn: number;
  /** One entry per piece actually laid out: label and size. */
  pieces: Array<{ label: string; widthIn: number; heightIn: number }>;
}

/** The SVG document for a set of pieces (see the file header for the conventions). */
export function laserSvg(doc: LaserDoc): LaserSvg {
  const lay = layoutShapes(doc.items);
  const H = lay.heightIn;
  const m = LASER_MARGIN_IN;
  // piece coordinates (u right, v up) -> sheet px (x right, y down)
  const at = (pl: Placed) => (p: Vec2): [number, number] => [p[0] + pl.x + m, H - (p[1] + pl.y + m)];
  const d = (pts: Vec2[], f: (p: Vec2) => [number, number], closed: boolean): string =>
    pts.map(f).map((q, i) => `${i ? 'L' : 'M'}${px(q[0])},${px(q[1])}`).join('') + (closed ? 'Z' : '');
  const circle = (c: Vec2, dia: number, f: (p: Vec2) => [number, number]): string => {
    const [x, y] = f(c), r = dia / 2;
    return `M${px(x - r)},${px(y)}a${px(r)},${px(r)} 0 1,0 ${px(dia)},0a${px(r)},${px(r)} 0 1,0 ${px(-dia)},0Z`;
  };
  const path = (color: string) => (id: string, dd: string, _label: string): string => `<path id="${esc(id)}" d="${dd}" fill="none" stroke="${color}" stroke-width="1"/>`;
  const scorePath = path(LASER_SCORE), cutPath = path(LASER_CUT);
  const score: string[] = [], inner: string[] = [], outer: string[] = [];
  lay.placed.forEach((pl) => {
    const f = at(pl), s = pl.shape;
    s.score.forEach((l, i) => {
      const closed = l.length > 2 && Math.hypot(l[0][0] - l[l.length - 1][0], l[0][1] - l[l.length - 1][1]) < 1e-6;
      score.push(scorePath(`${s.id}-score-${i + 1}`, d(closed ? l.slice(0, -1) : l, f, closed), `${s.label}: score line`));
    });
    s.marks.forEach((mk, i) => {
      const r = mk.dia / 2 + 0.08;
      score.push(scorePath(`${s.id}-mark-${i + 1}`, circle(mk.c, mk.dia, f) + d([[mk.c[0] - r, mk.c[1]], [mk.c[0] + r, mk.c[1]]], f, false) + d([[mk.c[0], mk.c[1] - r], [mk.c[0], mk.c[1] + r]], f, false), `${s.label}: drill mark (score, not cut)`));
    });
    s.circles.forEach((c, i) => inner.push(cutPath(`${s.id}-hole-${i + 1}`, circle(c.c, c.dia, f), `${s.label}: hole ${fmt(c.dia)} in`)));
    s.holes.forEach((h, i) => inner.push(cutPath(`${s.id}-loop-${i + 1}`, d(h, f, true), `${s.label}: inner cut`)));
    outer.push(cutPath(`${s.id}-outline`, d(s.outer, f, true), `${s.label}: outline`));
  });
  const W = lay.widthIn;
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}in" height="${fmt(H)}in" viewBox="0 0 ${px(W)} ${px(H)}">\n` +
    `<title>${esc(doc.title)}</title>\n<desc>${esc(doc.desc)}</desc>\n` +
    `<g id="score">${score.join('')}</g>\n` +
    `<g id="cut-inside">${inner.join('')}</g>\n` +
    `<g id="cut-outline">${outer.join('')}</g>\n` +
    `</svg>\n`;
  return {
    svg, widthIn: W, heightIn: H,
    pieces: lay.placed.map((pl) => { const b = shapeBox(pl.shape); return { label: pl.shape.label, widthIn: b.u1 - b.u0, heightIn: b.v1 - b.v0 }; }),
  };
}
