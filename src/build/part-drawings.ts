/**
 * Dimensioned shop drawings (Phase 4, Eric 2026-10-12: "it's not clear where I'm supposed to put cuts"): one SVG per distinct cut, grouped by part number, for every built part
 * that is NOT cut on the Shaper (fab table-saw, bandsaw, bentlam, drill-tap). Plain TS, no three.js, pure functions of `(parts, params)`.
 *
 * Each drawing has a MAIN view (the outline: an extrusion's profile, a bent member's developed side view, a box's most featured face), plus a view of the top or bottom edge and
 * end views where features sit on those faces. A long part is drawn in two or three overlapping rows at a readable scale. Every feature is located by ORDINATES from one stated datum
 * per axis ("from the REAR end", "from the TOP edge"): ticks below and beside the views, a lettered balloon on the feature, and the same numbers in words in the feature table. All
 * lengths are fractions to 1/32", drills to 1/64". Datums and faces are named in plain words (REAR / FRONT end, TOP / BOTTOM edge, INBOARD / OUTBOARD face), never x / y / z.
 *
 * Where the features come from (the same data as the Shaper files, `shaper-svg.ts`):
 *  F1  the main outline's non-rectangular runs (notches, steps, angled or curved ends), read off the outline against its bounding box;
 *  F2  fastener joints (bolt / screw / pin / hole / insert / knob) at their `Joint.at` points, own and inbound (another part's joint that names this one, through the model frame). The
 *      hole axis is a cylinder part through the point if there is one, else the joint text ("fore-aft", "down", "up"), else the face the two parts touch on, else a cylinder part
 *      near the point, else the thickness; text and contact axes snap to the part's own axes;
 *  F3  a through bolt or pin of OTHER parts whose line crosses this part (the knee bolts through the brake backer; no joint records those);
 *  F4  Dominos, loose-tenon mortises and tenons on the face nearest their point, the long side of the mortise along the side both parts are longest on;
 *  F5  notches and dados from the joint text ("2.38" wide × 1.35" deep notch up from the hanger bottom"), a dado for a mate whose END lands on this part, rabbets for a captured panel;
 *  F6  grooves and bores for a steel rod (axle) or tube that lies in the part (no joint records them);
 *  F7  the brake knee's pocket (the knee mesh has no profile; its outline and pocket are read from the brake layout).
 */
import type { Params } from '../params';
import type { Joint, Part, Vec2, Vec3 } from '../model/types';
import { worldAABB, localBounds } from '../model/bounds';
import { brakeGeometry } from '../model/brake';
import { computeLayout } from '../model/layout';
import { flatPattern } from './flat';
import { clearanceDia } from './shaper-svg';
import { crossGrainWords, cutList, discStrip, groupedName, edgeJointUp, grainInWords, isTallBlock, type CutList } from './cutlist';
import { defaultParams } from '../params';
import { finalDimsText } from './units';
import { esc, fmt, frac, hash6, parseInches, pointInPoly } from './svg-util';

// ── Fractions ──

export { frac };
/** A drill size to the nearest 1/64" (fractional drill sets run in 1/64ths). */
export const drill = (v: number): string => frac(v, 64);
const deg = (a: number): string => `${Math.round(a)}°`;
/** Decimal inches in joint text ("0.38"", "1.0625"") rewritten as fractions, so no long decimal reaches a drawing. */
const fracText = (s: string): string => s.replace(/(\d*\.\d+)(\s*(?:"|in\b))/g, (_, n: string, u: string) => `${frac(Number(n)).replace(/"$/, '')}${u}`);

/** "a", "a and b", "a, b and c". */
const listOf = (xs: string[]): string => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** A noun in the plural for a count: "hole" -> "holes", "notch" -> "notches". */
const plural = (noun: string, n: number): string => (n === 1 ? noun : /(ch|sh|s|x)$/.test(noun) ? `${noun}es` : `${noun}s`);
/** Datum words (REAR end, TOP edge, INBOARD face) in lower case, for the structured fields and running text. */
const lcDatum = (t: string): string => t.replace(/\b(REAR|FRONT|LEFT|RIGHT|TOP|BOTTOM|INBOARD|OUTBOARD)\b/g, (m) => m.toLowerCase());
const sentence = (t: string): string => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
/** A part's name in running text: "Rail L" -> "left rail", "Crossmember 2" -> "crossmember 2", "Left chine band (outer)" -> "left chine band (outer)"; other parentheses are dropped. */
function humanName(name: string): string {
  let n = name.replace(/\s*\(([^)]*)\)\s*/g, (_m, inner: string) => (/^(outer|inner)$/i.test(inner) ? ` (${inner.toLowerCase()}) ` : ' ')).replace(/\s+/g, ' ').trim();
  const m = /^(.*\S)\s+([LR])(\d*)$/.exec(n);
  if (m) n = `${m[2] === 'L' ? 'left' : 'right'} ${m[1].charAt(0).toLowerCase()}${m[1].slice(1)}${m[3] ? ` ${m[3]}` : ''}`;
  else n = n.charAt(0).toLowerCase() + n.slice(1);
  return n;
}
/** "#6 × 2-1/2 screws", "1/4\" × 2-1/4 bolts", "3/8\" pin": the fastener of a joint in words, for the purpose clause. */
function fastenerNoun(j: Joint, text: string): string {
  const LEN = String.raw`(\d+-\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)`;
  const g = /#\s*(\d+)(?:-\d+)?/.exec(text);
  if (j.type === 'screw' || (j.type === 'knob' && g)) {
    const m = new RegExp(String.raw`#\s*(\d+)(?:-\d+)?\s*[×x]\s*${LEN}`).exec(text);
    if (j.type === 'knob') return `#${g![1]} thumb-knob screws`;
    return m ? `#${m[1]} × ${fracText(`${m[2]} in`).replace(/ in$/, '')}" screws` : g ? `#${g[1]} screws` : 'screws';
  }
  if (j.type === 'threaded-insert') return 'threaded inserts';
  const d = j.diaIn;
  if (j.type === 'pin') return d ? `${frac(d)} pin` : 'pin';
  if (j.type === 'bolt') {
    const lm = new RegExp(String.raw`(?:^|[\s×x])${LEN}"?\s*[×x]\s*${LEN}\b`).exec(text);
    return `${d ? `${frac(d)} ` : ''}${lm && Math.abs(num(lm[1]) - (d ?? 0)) < 0.02 ? `× ${fracText(`${lm[2]} in`).replace(/ in$/, '')}" ` : ''}bolts`.replace(/^\s+/, '');
  }
  if (j.type === 'hole' && /\bbolts?\b/i.test(text)) return d ? `${frac(d)} bolts` : 'bolts';
  if (j.type === 'hole' && /D-ring (?:plate|bracket)/i.test(text)) return '1/4-20 bolts';
  return j.type === 'hole' ? 'screws' : 'fasteners';
}


// ── Small vector helpers ──
type Ax = 0 | 1 | 2;
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dominant = (a: Vec3): Ax => (Math.abs(a[0]) >= Math.abs(a[1]) && Math.abs(a[0]) >= Math.abs(a[2]) ? 0 : Math.abs(a[1]) >= Math.abs(a[2]) ? 1 : 2);
const unitAx = (k: Ax, s = 1): Vec3 => { const e: Vec3 = [0, 0, 0]; e[k] = s; return e; };
const toModelPt = (m: number[], l: Vec3): Vec3 => [m[0] * l[0] + m[4] * l[1] + m[8] * l[2] + m[12], m[1] * l[0] + m[5] * l[1] + m[9] * l[2] + m[13], m[2] * l[0] + m[6] * l[1] + m[10] * l[2] + m[14]];
const toModelDir = (m: number[], d: Vec3): Vec3 => [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
const toLocalPt = (m: number[], q: Vec3): Vec3 => { const d: Vec3 = [q[0] - m[12], q[1] - m[13], q[2] - m[14]]; return [m[0] * d[0] + m[1] * d[1] + m[2] * d[2], m[4] * d[0] + m[5] * d[1] + m[6] * d[2], m[8] * d[0] + m[9] * d[1] + m[10] * d[2]]; };
const toLocalDir = (m: number[], d: Vec3): Vec3 => [m[0] * d[0] + m[1] * d[1] + m[2] * d[2], m[4] * d[0] + m[5] * d[1] + m[6] * d[2], m[8] * d[0] + m[9] * d[1] + m[10] * d[2]];

// ── The board frame: (u, v, n), u along the main view's horizontal, v up it, n toward the viewer ──

interface Board {
  U: number; V: number; N: number;
  /** Part-local point -> board (u, v, n), each from 0. */
  toBoard: (l: Vec3) => Vec3;
  /** Part-local direction -> board direction. */
  dirToBoard: (d: Vec3) => Vec3;
  /** Model direction of +u, +v, +n. */
  modelDir: [Vec3, Vec3, Vec3];
  /** Main outline in (u, v). */
  main: Vec2[];
  /** A bent member: u is measured along the curve (its developed length). */
  developed: boolean;
  rod?: { dia: number };
}

/**
 * A prism: the outline in local (ia, ib), turned by `theta` in that plane (a tilted rectangle is drawn square), extruded along local `ic` from c0 to c1. The view is true (never
 * mirrored) and seen from above (+Z) for a horizontal face, from behind (-X) for a fore-aft normal, from the right (-Y) for a sideways normal; a vertical view has v up.
 */
function prismBoard(m: number[], outline: Vec2[], ia: Ax, ib: Ax, ic: Ax, c0: number, c1: number, theta = 0): Board {
  const c = Math.cos(theta), s = Math.sin(theta);
  const A: Vec3 = add(unitAx(ia, c), unitAx(ib, s)), B: Vec3 = add(unitAx(ia, -s), unitAx(ib, c)), C = unitAx(ic);
  const rot = outline.map(([x, y]): Vec2 => [x * c + y * s, -x * s + y * c]);
  const lo = [Math.min(...rot.map((q) => q[0])), Math.min(...rot.map((q) => q[1])), c0];
  const hi = [Math.max(...rot.map((q) => q[0])), Math.max(...rot.map((q) => q[1])), c1];
  const vecs = [A, B, C];
  const md = vecs.map((v) => norm(toModelDir(m, v)));
  const dN = md[2], k = dominant(dN);
  const sn = k === 2 ? Math.sign(dN[2]) || 1 : k === 0 ? -(Math.sign(dN[0]) || 1) : -(Math.sign(dN[1]) || 1);
  const nM = scale(dN, sn);
  const ext = [hi[0] - lo[0], hi[1] - lo[1]];
  let iu: 0 | 1, iv: 0 | 1, su: number, sv: number;
  if (k === 2) {
    [iu, iv] = ext[0] >= ext[1] ? [0, 1] : [1, 0];
    const ku = dominant(md[iu]);
    su = ku === 0 ? Math.sign(md[iu][0]) || 1 : ku === 1 ? -(Math.sign(md[iu][1]) || 1) : 1;
    sv = dot(cross(scale(md[iu], su), md[iv]), nM) > 0 ? 1 : -1;
  } else {
    const za = Math.abs(md[0][2]), zb = Math.abs(md[1][2]);
    if (Math.max(za, zb) > 0.3) { iv = za >= zb ? 0 : 1; iu = iv === 0 ? 1 : 0; sv = Math.sign(md[iv][2]) || 1; }
    else { [iu, iv] = ext[0] >= ext[1] ? [0, 1] : [1, 0]; sv = 1; }
    su = dot(cross(md[iu], scale(md[iv], sv)), nM) > 0 ? 1 : -1;
  }
  const idx = [iu, iv, 2], sg = [su, sv, sn];
  const off = idx.map((i, k2) => (sg[k2] > 0 ? lo[i] : -hi[i]));
  const coord = (l: Vec3, i: number): number => dot(l, vecs[i]);
  const toBoard = (l: Vec3): Vec3 => [sg[0] * coord(l, idx[0]) - off[0], sg[1] * coord(l, idx[1]) - off[1], sg[2] * coord(l, idx[2]) - off[2]];
  const dirToBoard = (d: Vec3): Vec3 => [sg[0] * coord(d, idx[0]), sg[1] * coord(d, idx[1]), sg[2] * coord(d, idx[2])];
  const main = rot.map((q): Vec2 => [sg[0] * q[idx[0]] - off[0], sg[1] * q[idx[1]] - off[1]]);
  return {
    U: hi[iu] - lo[iu], V: hi[iv] - lo[iv], N: c1 - c0, toBoard, dirToBoard,
    modelDir: [scale(md[iu], su), scale(md[iv], sv), nM], main: ccw(main), developed: false,
  };
}

const area2 = (o: Vec2[]): number => o.reduce((a, q, i) => { const r = o[(i + 1) % o.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0);
const ccw = (o: Vec2[]): Vec2[] => (area2(o) < 0 ? [...o].reverse() : o);

/** A bent wall member (rail, bands): u = arc length along the plan curve (`flatPattern`), v = height, n = across the thickness, seen from -Y (the right side of the sled). */
function wallBoard(part: Part): Board | null {
  const g = part.geometry;
  const f = flatPattern(part);
  if (!f || g.type !== 'mesh' || !g.profile || !g.thickness) return null;
  const n = g.profile.length, nv = g.positions.length / 3, rim0 = nv - 2 * n, t = g.thickness;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) { const k = 3 * (rim0 + i); pts.push([g.positions[k], g.positions[k + 1] - t / 2]); }
  pts.sort((a, b) => a[0] - b[0]);
  const yc = (x: number): number => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1); }
    return pts[pts.length - 1][1];
  };
  const toBoard = (l: Vec3): Vec3 => { const q = f.toPattern(l); return [q[0], q[1], -(l[1] - yc(l[0])) + t / 2]; };
  return { U: f.widthIn, V: f.heightIn, N: t, toBoard, dirToBoard: (d) => [d[0], d[2], -d[1]], modelDir: [[1, 0, 0], [0, 0, 1], [0, -1, 0]], main: ccw(f.outer), developed: true };
}

// ── Plain words ──

/** The plain word for a model direction on a part: FRONT / REAR / TOP / BOTTOM / INBOARD / OUTBOARD (LEFT / RIGHT for a part on the center line). */
function dirWord(d: Vec3, yCenter: number): string {
  const k = dominant(d);
  if (k === 0) return d[0] > 0 ? 'FRONT' : 'REAR';
  if (k === 2) return d[2] > 0 ? 'TOP' : 'BOTTOM';
  if (Math.abs(yCenter) > 1.5) return d[1] * yCenter > 0 ? 'OUTBOARD' : 'INBOARD';
  return d[1] > 0 ? 'LEFT' : 'RIGHT';
}

interface Words {
  side: [[string, string], [string, string], [string, string]];
  /** A member whose ends are scribed to a curve (a crossmember in the bow taper, cut to its long point): lengths are measured from the CENTER LINE at this u, never from an end. */
  center?: number;
}
/** A length along u in words: from the end at u = 0, or (a scribed member) either side of the center line. */
function alongU(u: number, w: Words): { val: string; datum: string } {
  if (w.center === undefined) return { val: frac(u), datum: `from the ${w.side[0][0]}` };
  const d = u - w.center;
  return Math.abs(d) < 1 / 64 ? { val: '', datum: 'on the center line' } : { val: frac(Math.abs(d)), datum: `${d < 0 ? 'toward the ' + w.side[0][0] : 'toward the ' + w.side[0][1]} from the center line` };
}
/** side[axis][0] = the face at 0, side[axis][1] = the face at the max: "REAR end", "TOP edge", "INBOARD face". */
function wordsOf(b: Board, yCenter: number): Words {
  const ext = [b.U, b.V, b.N];
  const order = [0, 1, 2].sort((a, c) => ext[a] - ext[c]);
  const nounOf = (ax: number): string => {
    const r = order.indexOf(ax);
    if (r === 2) return ext[order[2]] / Math.max(ext[order[1]], 1e-6) >= 1.5 ? 'end' : 'edge';
    if (r === 1) return ext[order[1]] / Math.max(ext[order[0]], 1e-6) >= 1.5 ? 'edge' : 'face';
    return 'face';
  };
  const side = [0, 1, 2].map((ax) => {
    const d = b.modelDir[ax];
    let lo = dirWord(scale(d, -1), yCenter), hi = dirWord(d, yCenter);
    if (lo === hi) { lo = `${lo} (A)`; hi = `${hi} (B)`; }
    return [`${lo} ${nounOf(ax)}`, `${hi} ${nounOf(ax)}`] as [string, string];
  }) as Words['side'];
  return { side };
}

// ── Features ──

export interface DrawingFeature {
  /** Balloon letter on the drawing ('-' for a note). */
  label: string;
  /** The whole table line: the feature type and size, then where it is, then what it is for. */
  text: string;
  kind: 'outline' | 'hole' | 'mortise' | 'dado' | 'groove' | 'notch' | 'slot' | 'tenon' | 'rabbet' | 'note';
  /** Mating part ids this feature serves. */
  to?: string[];
  /** Joint type(s) it comes from ('passing' for a bolt of other parts that crosses this one, 'rod' for an axle groove). */
  joint?: string;
  /** How many instances (holes, mortises). */
  count: number;
  /** The size in plain words, datums in lower case, no count: `2-3/8" wide × 1-3/32" deep`, `1/8" pilot, through, with a 5/16" × 1" counterbore from the bottom edge`. */
  size?: string;
  /**
   * Where it is, in plain words from the stated datums (lower case), one entry per group of instances. Every value is a fraction with an inch mark, then its datum:
   * `3-1/4", 9-1/4" and 16-5/16" from the rear end, 5/8" from the top edge`; a span is `8-5/16" to 10-11/16" from the rear end`; a centered feature says `centered across the thickness`.
   */
  positions?: string[];
  /** The face the feature is cut in or drilled from: `bottom edge`, `inboard face`. */
  face?: string;
  /** What it is for, a short clause with no part ids: `for the #6 × 2-1/2 screws to the chine`. */
  purpose?: string;
  /** The slope in degrees, for a sloped step or a tilted hole. */
  angleDeg?: number;
}

interface HoleF { k: 'hole'; key: string; to: string[]; joint: string; pts: Vec3[]; axis: Vec3; dia: number; blind?: number; entryHi?: boolean; /** "hole" or "counterbore". */ noun: string; /** Drain holes of a side part are measured from the inner face of the rear transom, not from the part's own end: the shift (in) that turns the part's "from the rear end" into that datum (the web's rear end sits in the transom dado, behind the face). */ uShift?: number; /** The size with no count: `1/8" pilot, through`. */ size: string; /** What it is for. */ purpose: string; depthWords?: string; /** The face it enters, in words, when that is not a board face ("sloped face"). */ faceWord?: string; /** A blind hole that starts INSIDE the part (a pocket wall): the board coordinate along its axis where it starts. */ from?: number }
interface RegionF { k: 'region'; key: string; to: string[]; joint: string; kind: DrawingFeature['kind']; boxes: Array<[Vec3, Vec3]>; /** "Domino mortise", "dado", "slot". */ noun: string; /** The size with no count. */ detail: string; purpose?: string; face?: { ax: Ax; hi: boolean } }
interface OutlineF { k: 'outline'; text: string; title: string; marks: Vec2[]; anchor?: Vec2; size?: string; positions?: string[]; face?: string; angleDeg?: number; /** A long list of numbers (curve offsets) that goes in the NOTES block, not the table line. */ extra?: string }
interface NoteF { k: 'note'; text: string; to?: string[]; joint?: string }
type Feat = HoleF | RegionF | OutlineF | NoteF;

const FASTENERS = new Set<Joint['type']>(['bolt', 'screw', 'pin', 'hole', 'threaded-insert', 'knob']);
/** Wood-screw clearance and hardwood pilot drills by gauge (in). */
export const SCREW_CLEAR: Record<number, number> = { 6: 9 / 64, 8: 11 / 64, 10: 13 / 64, 12: 7 / 32 };
export const SCREW_PILOT: Record<number, number> = { 6: 7 / 64, 8: 1 / 8, 10: 9 / 64, 12: 5 / 32 };
/** Festool Domino tenon widths (mm) by thickness: 5x30 is 5 x 19 x 30, 8x50 is 8 x 22 x 50. */
const DOMINO_WIDTH_MM: Record<number, number> = { 4: 17, 5: 19, 6: 20, 8: 22, 10: 24, 12: 28, 14: 28 };
const MM = 1 / 25.4;
const NUM = String.raw`(\d+-\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)`;
const num = (s: string): number => parseInches(s);
/** Default bolt length (in) when the joint text gives none, for the bolts that pass through other parts (F3). */
const DEFAULT_BOLT_IN = 3;

/** The 8 corners (model frame) of a part's local bounds. */
function cornersOf(x: Part): Vec3[] {
  const lb = localBounds(x.geometry);
  const out: Vec3[] = [];
  for (const a of [lb.min[0], lb.max[0]]) for (const b of [lb.min[1], lb.max[1]]) for (const c of [lb.min[2], lb.max[2]]) out.push(toModelPt(x.transform, [a, b, c]));
  return out;
}

/** Model-frame AABB extent of a part along a model direction's dominant axis. */
function mateExtent(mate: Part | undefined, d: Vec3): number {
  if (!mate) return Infinity;
  const b = worldAABB(mate), k = dominant(d);
  return b.max[k] - b.min[k];
}

/** A frame to read contact in: coordinates of a model point and this part's extent per axis, plus each axis' model direction. */
interface CFrame { coord: (q: Vec3) => Vec3; ext: Vec3; dir: [Vec3, Vec3, Vec3] }
function localFrame(part: Part): CFrame {
  const lb = localBounds(part.geometry), m = part.transform;
  return { coord: (q) => { const l = toLocalPt(m, q); return [l[0] - lb.min[0], l[1] - lb.min[1], l[2] - lb.min[2]]; }, ext: [lb.max[0] - lb.min[0], lb.max[1] - lb.min[1], lb.max[2] - lb.min[2]], dir: [0, 1, 2].map((k) => norm(toModelDir(m, unitAx(k as Ax)))) as [Vec3, Vec3, Vec3] };
}
function boardFrame(part: Part, b: Board): CFrame {
  const m = part.transform;
  return { coord: (q) => b.toBoard(toLocalPt(m, q)), ext: [b.U, b.V, b.N], dir: b.modelDir };
}

/** The axis (model, unit) of the face where `part` and `mate` touch: the frame axis of least overlap between the part and the mate's corners. */
function contactAxis(fr: CFrame, mate: Part): Vec3 | null {
  const cs = cornersOf(mate).map(fr.coord);
  let best = -1, bestOv = Infinity;
  for (let k = 0; k < 3; k++) {
    const lo = Math.min(...cs.map((c) => c[k])), hi = Math.max(...cs.map((c) => c[k]));
    const ov = Math.min(fr.ext[k], hi) - Math.max(0, lo);
    if (ov < -0.3) return null;
    if (ov < bestOv) { bestOv = ov; best = k; }
  }
  // the parts must TOUCH on that axis (a face against a face), not just overlap less on it
  return best >= 0 && Math.abs(bestOv) <= 0.12 ? fr.dir[best] : null;
}

/** A cylinder part whose axis passes within `tol` of the model point (and within its length): its axis (model, unit). */
function cylinderNear(parts: Part[], self: Part, q: Vec3, tol: number): Vec3 | null {
  let best: Vec3 | null = null, bd = Infinity;
  for (const c of parts) {
    if (c.id === self.id || c.geometry.type !== 'cylinder') continue;
    const g = c.geometry, m = c.transform;
    const l = toLocalPt(m, q);
    const d = Math.hypot(l[0], l[1]) - g.radius;
    if (d <= tol && Math.abs(l[2]) <= g.length / 2 + tol && d < bd) { bd = d; best = norm(toModelDir(m, [0, 0, 1])); }
  }
  return best;
}

/** "fore-aft" / "down" / "up" in the joint text: the hole's model axis. */
function textAxis(text: string): Vec3 | null {
  const t = text.toLowerCase().replace(/[\d/]+"?\s+from the (top|bottom)\b/g, ' '); // "13/32" from the top" is a distance, not a drilling direction
  if (/fore-aft/.test(t)) return [1, 0, 0];
  if (/across the sled/.test(t)) return [0, 1, 0];
  if (/\b(down|up) (through|from)|straight down|from below|from the top|up from below|vertical/.test(t)) return [0, 0, 1];
  return null;
}

/** The hole axis (model) and whether it is exact (a real cylinder through the point) or approximate (snap it to the part's own axes). */
function holeAxisModel(part: Part, parts: Part[], mate: Part | undefined, atModel: Vec3, text: string, fr: CFrame): { axis: Vec3; exact: boolean; src: 'cylinder' | 'text' | 'contact' | 'near' } | null {
  const cyl = cylinderNear(parts, part, atModel, 0.06);
  if (cyl) return { axis: cyl, exact: true, src: 'cylinder' };
  const ta = textAxis(text);
  if (ta) return { axis: ta, exact: false, src: 'text' };
  if (mate) { const c = contactAxis(fr, mate); if (c) return { axis: c, exact: false, src: 'contact' }; }
  const near = cylinderNear(parts, part, atModel, 0.6);
  if (near) return { axis: near, exact: false, src: 'near' };
  return null;
}

/** A board direction snapped to its dominant axis (always when approximate, within 14 degrees when exact). */
function snapAxis(d: Vec3, exact: boolean): Vec3 {
  const a = norm(d), k = dominant(a);
  return !exact || Math.abs(a[k]) > 0.97 ? unitAx(k, Math.sign(a[k]) || 1) : a;
}

// ── Local solids ──

/** The brake layout for a parameter set, computed once per `Params` object (the layout sweeps the steering geometry: about 25 ms, and every knee lookup asks for it). */
const brakeCache = new WeakMap<Params, ReturnType<typeof brakeGeometry>>();
export function brakeOf(p: Params): ReturnType<typeof brakeGeometry> {
  let b = brakeCache.get(p);
  if (!b) { b = brakeGeometry(p, computeLayout(p)); brakeCache.set(p, b); }
  return b;
}

interface Solid { board: Board; extraNotes: string[]; pocket?: { lo: Vec3; hi: Vec3; detail: string } }

/** Should an extrusion outline be turned before drawing: a tilted outline with no edge square to its bounding box (the brake shoe, the grab-board backing strip)? Returns the angle. */
function tiltOf(outline: Vec2[]): number {
  let aligned = 0, best = 0, bestL = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], c = outline[(i + 1) % outline.length];
    const dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy);
    if (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6) aligned++;
    if (l > bestL) { bestL = l; best = Math.atan2(dy, dx); }
  }
  if (aligned >= 2) return 0;
  // the longest edge horizontal (mod 90 degrees, the smaller turn)
  let t = best % (Math.PI / 2);
  if (t > Math.PI / 4) t -= Math.PI / 2;
  if (t < -Math.PI / 4) t += Math.PI / 2;
  return Math.abs(t) > 0.005 ? t : 0;
}

/** The board for a part, with the box's view normal chosen by `boxAxis` (the local axis most features run along). */
function solidOf(part: Part, p: Params, boxAxis: Ax | null): Solid | null {
  const g = part.geometry, m = part.transform;
  if (g.type === 'extrusion') {
    const th = tiltOf(g.outline);
    return { board: prismBoard(m, g.outline, 0, 1, 2, 0, g.depth, th), extraNotes: th ? [`The outline is drawn turned ${deg((Math.abs(th) * 180) / Math.PI)} so its long edge is level (it sits at that angle on the sled).`] : [] };
  }
  if (g.type === 'box') {
    const s = g.size;
    const ic: Ax = boxAxis ?? ([0, 1, 2].sort((a, b) => s[a] - s[b])[0] as Ax);
    const [ia, ib] = ([0, 1, 2] as Ax[]).filter((i) => i !== ic) as [Ax, Ax];
    const out: Vec2[] = [[-s[ia] / 2, -s[ib] / 2], [s[ia] / 2, -s[ib] / 2], [s[ia] / 2, s[ib] / 2], [-s[ia] / 2, s[ib] / 2]];
    // A crossmember in the bow taper is cut to its long point and scribed to the bent rails (frame.ts): the box is the short point, so say so.
    const longest = Math.max(...s);
    const scribe = part.kind === 'lumber' && part.stock && part.stock.l > longest + 1 / 32
      ? [`Drawn at its short point (${frac(longest)}, the front face). Cut it to the final length above, the long point at the rear face, and scribe each end to its bent rail at the dry fit. The positions below are measured from the center line, so they hold whatever the scribe takes off the ends.`] : [];
    return { board: prismBoard(m, out, ia, ib, ic, -s[ic] / 2, s[ic] / 2), extraNotes: scribe };
  }
  if (g.type === 'cylinder') {
    // A rod: side view, length along u, the diameter up.
    const out: Vec2[] = [[-g.radius, -g.length / 2], [g.radius, -g.length / 2], [g.radius, g.length / 2], [-g.radius, g.length / 2]];
    const b = prismBoard(m, out, 0, 2, 1, -g.radius, g.radius);
    return { board: { ...b, rod: { dia: 2 * g.radius } }, extraNotes: [] };
  }
  if (g.type === 'mesh' && g.profile) {
    const b = wallBoard(part);
    return b ? { board: b, extraNotes: [] } : null;
  }
  if (g.type === 'mesh' && part.partNo === 'brake-knee') {
    // F7: the knee is its (y, z) profile extruded along x (brake.ts builds the mesh from it; the part does not carry the profile, so it is read from the brake layout). D-77: the flap's slot is a
    // POCKET open at the rear face and the outboard side (no outboard ear), between zPocketBot and zPocketTop, with the roof above it and the floor under it.
    const bg = brakeOf(p);
    const wb = worldAABB(part);
    const sgn = wb.min[1] + wb.max[1] >= 0 ? 1 : -1;
    const poly: Vec2[] = (sgn > 0 ? bg.knee.poly : [...bg.knee.poly].reverse().map((q) => [-q[0], q[1]])) as Vec2[];
    const board = prismBoard(m, poly, 1, 2, 0, bg.knee.x0, bg.knee.x1);
    const pv = bg.pivot;
    const ys = [sgn * pv.ySlot[0], sgn * Math.max(pv.ySlot[1], bg.knee.yOut)];
    const corners = [bg.knee.x0, pv.slotEndX].flatMap((x) => ys.flatMap((y) => [pv.zPocketBot, pv.zPocketTop].map((z) => board.toBoard(toLocalPt(m, [x, y, z])))));
    const lo = [0, 1, 2].map((k) => Math.max(0, Math.min(...corners.map((c) => c[k])))) as Vec3, hi = [0, 1, 2].map((k) => Math.min([board.U, board.V, board.N][k], Math.max(...corners.map((c) => c[k])))) as Vec3;
    const layers = bg.knee.layers, front = layers[layers.length - 1];
    const intoFront = Math.max(0, pv.slotEndX - front.x0);
    return {
      board,
      extraNotes: [`Cut the pocket as a notch in the rear and center layers BEFORE the glue-up (bandsaw, chisel the corners square), then recess it ${frac(intoFront)} into the front layer after the glue-up (router or chisel). The roof and floor fingers of the upright rear layer are short grain until the block is glued: handle it with care.`],
      pocket: { lo, hi, detail: `${frac(pv.ySlot[1] - pv.ySlot[0])} wide × ${frac(pv.zPocketTop - pv.zPocketBot)} high × ${frac(pv.slotEndX - bg.knee.x0)} deep, open at the outboard edge` },
    };
  }
  return null;
}

/** The solid of a part drawn with no box-axis vote, remembered per part and parameter set (other parts' bolts and dados ask for it again and again). */
const plainCache = new WeakMap<Part, { p: Params; solid: Solid | null }>();
function plainSolid(part: Part, p: Params): Solid | null {
  const hit = plainCache.get(part);
  if (hit && hit.p === p) return hit.solid;
  const solid = solidOf(part, p, null);
  plainCache.set(part, { p, solid });
  return solid;
}

// ── Joint analysis ──

interface RawJoint { j: Joint; to: string; pts: Vec3[] /* local */; text: string; inbound: boolean }

type Role = 'clear' | 'pilot' | 'exact' | 'insert' | 'eye';

/** The drill size, the kind of hole ("pilot", "clearance", "snug fit"), and what it is for, from a fastener joint. */
function holeDia(j: Joint, text: string, role: Role, mateName: string): { dia: number | null; word: string; purpose: string } {
  const t = text;
  const gauge = /#\s*(\d+)/.exec(t);
  const noun = fastenerNoun(j, t);
  if (role === 'insert') {
    const m = new RegExp(String.raw`blind\s+${NUM}\s*(?:in\b|")?\s*holes?`).exec(t);
    return { dia: m ? num(m[1]) : null, word: m ? 'insert hole' : 'insert hole, drill size per the insert maker', purpose: 'for the threaded inserts' };
  }
  if (role === 'eye') { const g = gauge ? Number(gauge[1]) : 10; return { dia: SCREW_PILOT[g] ?? 9 / 64, word: 'pilot', purpose: `for the #${g} screw eye` }; }
  if (j.type === 'screw' || (j.type === 'knob' && gauge)) {
    const g = gauge ? Number(gauge[1]) : 8;
    const explicitPilot = new RegExp(String.raw`PILOT\s+${NUM}\s*(?:in)?\s+through`, 'i').exec(t);
    const purpose = `for the ${noun} to the ${mateName}`;
    if (role === 'pilot') return { dia: SCREW_PILOT[g] ?? 0.125, word: 'pilot', purpose };
    const clr = new RegExp(String.raw`${NUM}\s*(?:in\s*)?clearance`).exec(t) ?? new RegExp(String.raw`${NUM}"\s*clearance holes?`).exec(t);
    if (clr) return { dia: num(clr[1]), word: 'clearance', purpose };
    return { dia: explicitPilot ? num(explicitPilot[1]) : SCREW_CLEAR[g] ?? 0.2, word: explicitPilot ? 'pilot' : /flat-head/.test(t) ? 'clearance, countersunk' : 'clearance', purpose };
  }
  // a hole joint that names its drill: '11/64" (#8 clearance) through the head ...'
  const clrN = new RegExp(String.raw`${NUM}"\s*\(#\d+ clearance\)`).exec(t);
  if (clrN) return { dia: num(clrN[1]), word: 'clearance', purpose: `for the ${noun} to the ${mateName}` };
  // ... or the thread of a machine bolt: '1/4" (1/4-20 clearance) through the head ...' is the bolt's clearance drill (17/64"), not the 1/4" thread (D-83: the D-ring bracket's bolts)
  const clrT = new RegExp(String.raw`${NUM}"\s*\((\d+\/\d+)-\d+ clearance\)`).exec(t);
  if (clrT) return { dia: clearanceDia({ type: 'bolt', size: '', diaIn: num(clrT[2]) }), word: 'clearance', purpose: `for the ${noun} to the ${mateName}` };
  // the joint names its clearance hole: 'in 13/32 clearance holes' (the brake-knee bolts, one size through the rail, backer, plate and knee); read it, never derive a tighter 25/64
  const named = new RegExp(String.raw`${NUM}"?\s+clearance\s+holes?\b`).exec(t) ?? new RegExp(String.raw`${NUM}"?\s+holes?\s+(?:for|on) the\b`).exec(t);
  if (named && (j.type === 'bolt' || j.type === 'hole')) return { dia: num(named[1]), word: 'clearance', purpose: `for the ${noun} to the ${mateName}` };
  // an explicit hole size: '5/8" kingpin hole', '1" hole across', '3/8" blind hole', '5/8" bore'
  const ex = new RegExp(String.raw`${NUM}"?\s*(?:in\s*)?(?:kingpin\s+)?(?:blind\s+|stopped\s+)?(?:hole|bore)\b`).exec(t);
  const lead = new RegExp(String.raw`${NUM}"\s*(?:×\s*[\d-/]+"?\s*)?(?:(?:316|18-8 \(304\))\s+)?(?:stainless\s+)?(?:forged|eye|hex|carriage|shoulder|clevis|pin|rod)`).exec(t);
  const dia0 = j.diaIn ?? (lead ? num(lead[1]) : undefined);
  if (role === 'exact') {
    const d = ex ? num(ex[1]) : dia0 ?? 0.25;
    return { dia: d, word: 'snug fit', purpose: j.type === 'pin' ? `for the ${frac(dia0 ?? d)} pin` : `for the ${mateName}` };
  }
  if (j.type === 'pin') {
    if (ex && !/pin hole/.test(t)) return { dia: num(ex[1]), word: 'hole', purpose: `for the ${mateName}` };
    const d = dia0 ?? 0.375;
    return { dia: clearanceDia({ type: 'pin', size: '', diaIn: d }), word: 'clearance', purpose: `for the ${frac(d)} pin` };
  }
  if (ex) return { dia: num(ex[1]), word: 'hole', purpose: `for the ${mateName}` };
  const d = dia0 ?? 0.25;
  return { dia: clearanceDia({ type: 'bolt', size: j.size, diaIn: d }), word: 'clearance', purpose: `for the ${noun} to the ${mateName}` };
}

/** Clamp a board point onto the solid's box (joint points sit on a face, sometimes a hair outside it). */
const clampB = (q: Vec3, b: Board): Vec3 => [Math.min(b.U, Math.max(0, q[0])), Math.min(b.V, Math.max(0, q[1])), Math.min(b.N, Math.max(0, q[2]))];
const EXT = (b: Board): Vec3 => [b.U, b.V, b.N];

/** The interval of the solid along board axis `ax` through point q (the outline for u / v, the full thickness for n). */
function throughSpan(b: Board, q: Vec3, ax: Ax): [number, number] {
  if (ax === 2) return [0, b.N];
  const o = b.main, other = ax === 0 ? 1 : 0;
  const xs: number[] = [];
  for (let i = 0; i < o.length; i++) {
    const a = o[i], c = o[(i + 1) % o.length];
    if ((a[other] - q[other]) * (c[other] - q[other]) > 0 || Math.abs(c[other] - a[other]) < 1e-12) continue;
    xs.push(a[ax] + ((c[ax] - a[ax]) * (q[other] - a[other])) / (c[other] - a[other]));
  }
  xs.sort((x, y) => x - y);
  for (let i = 0; i + 1 < xs.length; i += 2) if (q[ax] >= xs[i] - 0.05 && q[ax] <= xs[i + 1] + 0.05) return [xs[i], xs[i + 1]];
  return [0, ax === 0 ? b.U : b.V];
}

/** The outline's whole extent along v at station u (lowest to highest crossing). */
function spanAt(b: Board, u: number): [number, number] {
  const o = b.main, vs: number[] = [];
  for (let i = 0; i < o.length; i++) {
    const a = o[i], c = o[(i + 1) % o.length];
    if ((a[0] - u) * (c[0] - u) > 0 || Math.abs(c[0] - a[0]) < 1e-12) continue;
    vs.push(a[1] + ((c[1] - a[1]) * (u - a[0])) / (c[0] - a[0]));
  }
  return vs.length ? [Math.min(...vs), Math.max(...vs)] : [0, b.V];
}

/** The outline's whole extent along u at height v. */
function hspanAt(b: Board, v: number): [number, number] {
  const o = b.main, us: number[] = [];
  for (let i = 0; i < o.length; i++) {
    const a = o[i], c = o[(i + 1) % o.length];
    if ((a[1] - v) * (c[1] - v) > 0 || Math.abs(c[1] - a[1]) < 1e-12) continue;
    us.push(a[0] + ((c[0] - a[0]) * (v - a[1])) / (c[1] - a[1]));
  }
  return us.length ? [Math.min(...us), Math.max(...us)] : [0, b.U];
}

/** The board face a point lies on (within 0.04"), if any; the outline plane faces measured to the outline. */
function onFace(b: Board, q: Vec3, only: Ax[] = [0, 1, 2]): { ax: Ax; hi: boolean } | null {
  let best: { ax: Ax; hi: boolean } | null = null, bd = 0.04;
  for (const a of only) {
    const sp = a === 2 ? [0, b.N] : throughSpan(b, q, a);
    for (const hi of [false, true]) { const d = Math.abs(q[a] - (hi ? sp[1] : sp[0])); if (d < bd) { bd = d; best = { ax: a, hi }; } }
  }
  return best;
}

/** Inside the solid (board coordinates)? */
const insideB = (b: Board, q: Vec3): boolean => q[2] >= -1e-6 && q[2] <= b.N + 1e-6 && pointInPoly([q[0], q[1]], b.main);

function largestAxis(b: Board): Ax { const e = EXT(b); return (e[0] >= e[1] && e[0] >= e[2] ? 0 : e[1] >= e[2] ? 1 : 2) as Ax; }

function nearestFace(b: Board, q: Vec3, only: Ax[] = [0, 1, 2]): { ax: Ax; hi: boolean } {
  let best = { ax: only[0], hi: false }, bd = Infinity;
  for (const a of only) for (const hi of [false, true]) {
    let d = Math.abs(q[a] - (hi ? EXT(b)[a] : 0));
    // in the outline plane, measure to the outline (a stepped rail's bottom is not at v = 0 everywhere)
    if (a !== 2) { const sp = throughSpan(b, q, a); d = Math.abs(q[a] - (hi ? sp[1] : sp[0])); }
    if (d < bd - 1e-9) { bd = d; best = { ax: a, hi }; }
  }
  return best;
}

interface Analysis { part: Part; board: Board; words: Words; feats: Feat[]; notes: string[]; vref: 0 | 1; /** A part id in running text ("left rail"). */ nameOf: (id: string) => string }

function analyze(part: Part, parts: Part[], p: Params): Analysis | null {
  const byId = new Map(parts.map((x) => [x.id, x]));
  const m = part.transform;
  // Raw joints, own and inbound (local points).
  const raw: RawJoint[] = [];
  for (const j of part.joints ?? []) raw.push({ j, to: j.to, pts: j.at ?? [], text: `${j.size ?? ''} ${j.note ?? ''}`, inbound: false });
  for (const q of parts) {
    if (q.id === part.id) continue;
    for (const j of q.joints ?? []) {
      if (j.to !== part.id || !j.at?.length) continue;
      if (!FASTENERS.has(j.type) && j.type !== 'dado' && j.type !== 'rabbet') continue;
      if (j.cut) continue; // a cut belongs to the part that owns the joint
      if ((part.joints ?? []).some((o) => o.to === q.id && (o.type === j.type || FASTENERS.has(o.type)))) continue; // this part records its own end of it
      raw.push({ j: { ...j, to: q.id }, to: q.id, pts: j.at.map((a) => toLocalPt(m, toModelPt(q.transform, a))), text: `${j.size ?? ''} ${j.note ?? ''}`, inbound: true });
    }
  }
  // The box's view normal: the local axis most hole axes run along (a notch through the thickness votes for the face view).
  let boxAxis: Ax | null = null;
  if (part.geometry.type === 'box') {
    const votes = [0, 0, 0];
    const lf = localFrame(part);
    for (const r of raw) {
      if (!r.pts.length || !FASTENERS.has(r.j.type)) continue;
      const ax = holeAxisModel(part, parts, byId.get(r.to), toModelPt(m, r.pts[0]), r.text, lf);
      if (ax) votes[dominant(toLocalDir(m, ax.axis))] += r.pts.length;
    }
    const s = (part.geometry as { size: Vec3 }).size;
    const thin = [0, 1, 2].sort((a, b) => s[a] - s[b])[0];
    for (const r of raw) if (r.j.type === 'dado' && /notch/.test(r.text)) votes[thin] += 2;
    const best = votes.indexOf(Math.max(...votes));
    boxAxis = Math.max(...votes) > 0 ? (best as Ax) : null;
  }
  const solid = solidOf(part, p, boxAxis);
  if (!solid) return null;
  const b = solid.board;
  const bb = worldAABB(part), yCenter = (bb.min[1] + bb.max[1]) / 2;
  const words = wordsOf(b, yCenter);
  // A box cut longer than it is drawn (a crossmember in the bow taper: listed at its long point, the ends scribed to the rails) is dimensioned from its center line.
  if (part.geometry.type === 'box' && part.kind === 'lumber' && part.stock && part.stock.l > Math.max(...part.geometry.size) + 1 / 32) words.center = b.U / 2;
  const fr = boardFrame(part, b);
  const feats: Feat[] = [];
  const notes: string[] = [...solid.extraNotes];
  const nameOf = (id: string): string => humanName(byId.get(id)?.name ?? id);

  // ── F2: fasteners ──
  for (const r of raw) {
    const j = r.j;
    if (!FASTENERS.has(j.type) || !r.pts.length) continue;
    const mate = byId.get(r.to);
    const am = holeAxisModel(part, parts, mate, toModelPt(m, r.pts[0]), r.text, fr);
    let axis = am ? snapAxis(b.dirToBoard(toLocalDir(m, am.axis)), am.exact) : unitAx(2);
    const pts = r.pts.map((l) => b.toBoard(l));
    const off = pts.filter((q) => q.some((c, i) => c < -0.3 || c > EXT(b)[i] + 0.3));
    if (off.length) notes.push(`The model puts ${off.length} of the ${pts.length} points for the ${nameOf(r.to)} ${frac(Math.max(...off.flatMap((q) => q.map((c, i) => Math.max(-c, c - EXT(b)[i])))))} outside this part; they are drawn at the nearest face.`);
    const cps = pts.map((q) => clampB(q, b));
    // A cut recorded on the joint (counterbore, slot, groove, relief): drawn as its own feature, in the part's own frame.
    if (j.cut && !r.inbound) {
      const c = j.cut;
      if (c.kind === 'counterbore' && c.dia && c.depth) {
        // A point on a sloped face (the hypotenuse of a rib knee) is on the outline but not on the board's bounding face: the bore runs along its screw's axis, entering from the high side.
        const sib = feats.find((q): q is HoleF => q.k === 'hole' && q.to.includes(r.to) && q.noun !== 'counterbore'); // the screw hole the bore is centered on: it gives the axis
        const baseAxis = am ? axis : sib?.axis;
        const sax = baseAxis ? dominant(baseAxis) : 2;
        const onAxis = baseAxis ? onFace(b, cps[0], [sax]) : null;
        const slopedFace = !!onAxis && (onAxis.hi ? cps[0][sax] < EXT(b)[sax] - 0.04 : cps[0][sax] > 0.04);
        const flat = slopedFace ? null : onFace(b, cps[0]);
        const fc = onAxis && slopedFace ? { ax: sax, hi: onAxis.hi } : flat ?? nearestFace(b, cps[0]);
        // Each bore leaves the same oak under its head ("leaving 1/2" of oak"), so on a slope the depths differ: one feature per depth.
        const seat = slopedFace ? new RegExp(String.raw`leaving ${NUM}"`).exec(c.what) : null;
        const depthAt = (q: Vec3): number => { const sp = throughSpan(b, q, fc.ax); return Math.max(1 / 16, sp[1] - sp[0] - num(seat![1])); };
        const groupsBy = new Map<string, Vec3[]>();
        for (const q of cps) { const k = frac(seat ? depthAt(q) : c.depth); groupsBy.set(k, [...(groupsBy.get(k) ?? []), q]); }
        for (const [k, qs] of groupsBy) {
          const d = seat ? depthAt(qs[0]) : c.depth;
          feats.push({ k: 'hole', key: `cbore|${frac(c.dia)}|${k}|${r.to}`, to: [r.to], joint: j.type, pts: qs, axis: unitAx(fc.ax, fc.hi ? -1 : 1), dia: c.dia, blind: d, entryHi: fc.hi, noun: 'counterbore',
            size: `${frac(c.dia)} wide × ${frac(d)} deep, centered on the screw hole`, purpose: `for the ${c.what.replace(/^the\s+/, '')}`, ...(slopedFace ? { faceWord: 'sloped face' } : {}) });
        }
      } else if (c.lo && c.hi) {
        const A = b.toBoard(c.lo), B = b.toBoard(c.hi);
        const lo = [0, 1, 2].map((k) => Math.max(0, Math.min(A[k], B[k]))) as Vec3, hi = [0, 1, 2].map((k) => Math.min(EXT(b)[k], Math.max(A[k], B[k]))) as Vec3;
        const mid: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
        // the cut enters the face its box reaches: the board face nearest the box's middle that the box touches
        const touching = ([0, 1, 2] as Ax[]).flatMap((k) => [{ ax: k, hi: false, d: lo[k] }, { ax: k, hi: true, d: EXT(b)[k] - hi[k] }]).filter((x) => x.d < 0.02).map((x) => ({ ax: x.ax, hi: x.hi }));
        const fc = touching.length ? [...touching].sort((x, y) => hi[x.ax] - lo[x.ax] - (hi[y.ax] - lo[y.ax]))[0] : nearestFace(b, mid); // the face the cut is shallowest through
        const dep = hi[fc.ax] - lo[fc.ax];
        const others = ([0, 1, 2] as Ax[]).filter((k) => k !== fc.ax).map((k) => hi[k] - lo[k]);
        // A flat-bottomed rectangular recess (a plate let into a face) reads as a recess, not a groove: both sides of it are wider than the depth.
        const recess = c.kind === 'relief' && /recess/i.test(r.text);
        const sizeText = c.kind === 'slot' ? `${frac(others[0])} × ${frac(others[1])} opening, ${frac(dep)} deep`
          : recess ? `${frac(Math.min(...others))} × ${frac(Math.max(...others))}, ${frac(dep)} deep, flat bottom`
          : `${frac(Math.min(...others))} wide × ${frac(dep)} deep, ${frac(Math.max(...others))} long`;
        feats.push({ k: 'region', key: `cut|${c.kind}|${r.to}`, to: [r.to], joint: j.type, kind: c.kind === 'slot' ? 'slot' : 'groove', boxes: [[lo, hi]], noun: recess ? 'recess' : c.kind === 'relief' ? 'relief groove' : c.kind, detail: sizeText, purpose: recess ? `for the ${frac(Math.min(...others))} × ${frac(Math.max(...others))} stainless backing plate, set flush` : (c.what || undefined), face: fc });
      }
      continue;
    }
    // Role: does the fastener pass through this part, bite in it, or is it a blind hole / insert / screw eye?
    const t = r.text.toLowerCase();
    let role: Role = 'clear';
    let blind: number | undefined;
    let depthWords: string | undefined;
    const name = `${part.name} ${part.partNo ?? ''}`.toLowerCase();
    const intoWord = /into the ([a-z-]+)/.exec(t)?.[1];
    const throughWord = /through the ([a-z-]+)/.exec(t)?.[1];
    const has = (wd?: string): boolean => !!wd && name.includes(wd.replace(/s$/, ''));
    if (j.type === 'threaded-insert' || /threaded insert|heat-set insert/.test(t)) role = 'insert';
    else if (/screw eye/.test(t)) role = 'eye';
    else if (j.type === 'screw') {
      if (has(intoWord) && !has(throughWord)) role = 'pilot';
      else if (has(throughWord)) role = 'clear';
      else if (j.fit) {
        const span = throughSpan(b, cps[0], dominant(axis));
        const e = span[1] - span[0];
        role = Math.abs(e - j.fit.receivingIn) < Math.abs(e - j.fit.gripIn) ? 'pilot' : 'clear';
      } else role = mate && (mate.kind === 'purchased' || mate.kind === 'metal' || mate.fab === 'buy') ? 'pilot' : 'clear';
      if (role === 'pilot') {
        const dm = /(\d*\.\d+|\d+\/\d+|\d+)"?\s*(?:in\s*)?into the/.exec(t);
        blind = dm ? num(dm[1]) + 0.125 : j.fit ? j.fit.lenIn - j.fit.gripIn + 0.0625 : undefined;
        if (blind === undefined) { const len = new RegExp(String.raw`#\d+\s*[×x]\s*${NUM}`).exec(r.text); if (len) blind = num(len[1]) - 0.0625; }
      }
    } else if (j.type === 'pin' && /epoxied|stopped|snug|blind hole|blind into the inboard ear/.test(t)) role = 'exact';
    else if (j.type === 'hole' && /snug|bore/.test(t)) role = 'exact';
    if (role === 'exact') {
      const dm = new RegExp(String.raw`${NUM}"?\s*(?:in\s*)?deep${part.partNo === 'handle-bar' ? ' in the bow' : /post/.test(name) ? ' in the post' : ''}`).exec(r.text) ?? new RegExp(String.raw`${NUM}"?\s*(?:in\s*)?deep`).exec(r.text);
      if (dm) blind = num(dm[1]);
    }
    if (role === 'insert') { const il = new RegExp(String.raw`[×x]\s*${NUM}"?\s*(?:(?:316|18-8 \(304\)|zinc-plated)\s+)?(?:stainless\s+)?threaded insert`).exec(r.text); if (il) blind = num(il[1]) + 0.0625; }
    // A sign-knob insert whose mouth is at the web's inside face (D-85): the hole starts in the band-strip filler, so the rib itself is bored only the rest of the way.
    if (role === 'insert') { const ir = new RegExp(String.raw`${NUM}"?\s*(?:in\s*)?deep in the rib behind the filler`).exec(r.text); if (ir && /^side-rib-/.test(part.id)) blind = num(ir[1]); }
    if (role === 'eye') depthWords = "as deep as the screw eye's thread";
    // The rib knees' screw pilots are drilled straight up through the member and the deck at the wheel fit (so the deck shows them), not blind.
    if (j.type === 'screw' && role === 'pilot' && /^side-rib-knee-/.test(r.to)) { blind = undefined; depthWords = 'through, drilled up through the member and the deck at the wheel fit'; }
    const bi = new RegExp(String.raw`through the (\w+) ear,?\s*${NUM}"?\s*blind into the (\w+) ear`).exec(r.text);
    if (bi) depthWords = `through the ${bi[1]} ear (and the slot), then ${frac(num(bi[2]))} deep into the ${bi[3]} ear`;
    // A blind hole (insert, epoxied pin, latch hole, screw eye) enters the face its point sits on, unless a real cylinder or the text says otherwise.
    if ((role === 'exact' || role === 'insert' || role === 'eye' || blind !== undefined) && (!am || am.src === 'near' || am.src === 'contact')) {
      const fc = onFace(b, cps[0]) ?? (!am ? nearestFace(b, cps[0]) : null);
      if (fc) axis = unitAx(fc.ax, fc.hi ? -1 : 1);
    }
    // Two points of one joint on the same line along the axis: the axis is wrong; take the face normal across them.
    if (cps.length > 1 && cps.some((q, i) => cps.some((e, k) => k > i && samePerp(e, q, axis) && Math.abs(dot([q[0] - e[0], q[1] - e[1], q[2] - e[2]], axis)) > 0.1))) {
      const d = norm([cps[1][0] - cps[0][0], cps[1][1] - cps[0][1], cps[1][2] - cps[0][2]]);
      const cand = ([0, 1, 2] as Ax[]).filter((k) => Math.abs(d[k]) < 0.5);
      const fc = onFace(b, cps[0], cand);
      axis = unitAx(fc ? fc.ax : cand[0] ?? 2);
    }
    const hd = holeDia(j, r.text, role, nameOf(r.to));
    let { dia, word } = hd;
    // On a drawing shared by the left and right parts the mate's name would be one side's: the D-ring is "its D-ring".
    const purpose = /^lash-/.test(r.to) ? hd.purpose.replace(/ to the .*$/, ' to its D-ring') : hd.purpose;
    const ax = dominant(axis);
    const span = throughSpan(b, cps[0], ax);
    // D-77: the knee's pin hole is BLIND, drilled from the pocket's inboard wall into the inboard ear (the strap carries the other end of the pin): a clearance hole that starts at the wall.
    let from: number | undefined;
    const pocketPin = j.type === 'pin' && /blind into the inboard ear from the pocket/.test(t);
    if (pocketPin) {
      const bm = new RegExp(String.raw`${NUM}"?\s*blind`).exec(t);
      if (bm) blind = num(bm[1]);
      dia = clearanceDia({ type: 'pin', size: '', diaIn: j.diaIn ?? 0.375 }); word = 'blind hole';
      from = cps[0][ax];
    }
    const entryHi = blind !== undefined || depthWords ? Math.abs(cps[0][ax] - span[1]) <= Math.abs(cps[0][ax] - span[0]) : undefined;
    // The joint's own note may give the run ("each hole runs 3" through the head"): say it, so the drawing agrees with the step that gives the depth.
    const runsM = new RegExp(String.raw`\bruns\s+${NUM}"\s*through\b`).exec(r.text);
    const depth = depthWords ? depthWords : blind !== undefined ? `${frac(blind)} deep` : runsM ? `through (${frac(num(runsM[1]))} deep)` : 'through';
    let size = `${dia ? `${drill(dia)} ` : ''}${word}, ${depth}`;
    const cb = new RegExp(String.raw`counterbore the head ${NUM}"?\s*(?:in\s*)?up the \w+ from its (underside|top)\s*\(${NUM}"?\s*(?:in\s*)?bit\)`).exec(r.text);
    let cbore: { dia: number; depth: number } | undefined;
    if (cb && part.partNo === 'rail') { cbore = { dia: num(cb[3]), depth: num(cb[1]) }; size += `, with a ${drill(cbore.dia)} × ${frac(cbore.depth)} counterbore from the ${cb[2] === 'underside' ? words.side[1][0] : words.side[1][1]}`; notes.push(`Plug each counterbore after the screw is in: a ${frac(cbore.dia)} oak plug cut with a plug cutter from offcuts (or a ${frac(cbore.dia)} dowel), glued in and trimmed flush.`); }
    // D-83: the side drain holes are located from ONE datum, the inner face of the rear transom (the web's rear end sits in its dado, the bands start at the face).
    const trFace = byId.get('transom-rear');
    const uShift = /drain hole/.test(t) && /^side-/.test(part.id) && trFace ? worldAABB(part).min[0] - worldAABB(trFace).max[0] : undefined;
    feats.push({ k: 'hole', key: `${size}|${purpose}|${axis.map((c) => Math.round(c * 100)).join(',')}${uShift !== undefined ? '|transom-datum' : ''}`, to: [r.to], joint: j.type, pts: cps, axis, dia: dia ?? 0.19, ...(uShift !== undefined ? { uShift } : {}), ...(blind !== undefined ? { blind } : {}), ...(entryHi !== undefined ? { entryHi } : {}), ...(depthWords ? { depthWords } : {}), ...(from !== undefined ? { from, faceWord: "inboard wall of the pocket" } : {}), noun: 'hole', size, purpose });
    // The push-handle socket's access holes (D-63): the same size as named, in the opposite wall, opposite each screw.
    const acc = new RegExp(String.raw`${NUM}"\s*(?:\([^)]*\)\s*)?ACCESS HOLE in the opposite`).exec(r.text);
    if (acc && part.kind === 'metal') {
      const opp = cps.map((q) => q.map((c, i) => (i === ax ? EXT(b)[i] - c : c)) as Vec3);
      feats.push({ k: 'hole', key: `access|${r.to}`, to: [r.to], joint: j.type, pts: opp, axis, dia: num(acc[1]), blind: 0.125, entryHi: opp[0][ax] > EXT(b)[ax] / 2, depthWords: 'through the opposite wall only', noun: 'access hole', size: `${drill(num(acc[1]))}, through the opposite wall only`, purpose: `for the screw heads and washers (plug it with a ${frac(num(acc[1]))} button plug after assembly)` });
    }
  }

  // ── F3: through bolts and pins of other parts that cross this part ──
  addPassingBolts(part, parts, b, feats, byId, p);

  // ── F4: Dominos, mortises and tenons ──
  for (const r of raw) {
    const j = r.j;
    if (!(j.type === 'domino' || j.type === 'mortise-tenon') || !r.pts.length || r.inbound) continue;
    const mate = byId.get(r.to);
    let thin: number, wide: number, depth: number, noun: string, detail: string;
    if (j.type === 'domino') {
      const dm = /(\d+)\s*[×x]\s*(\d+)/.exec(j.size ?? '');
      const tmm = dm ? Number(dm[1]) : 5, lmm = dm ? Number(dm[2]) : 30;
      thin = tmm * MM; wide = (DOMINO_WIDTH_MM[tmm] ?? tmm * 4) * MM; depth = (lmm / 2) * MM;
      noun = 'Domino mortise'; detail = `${tmm}×${lmm} tenon (DF 500: ${tmm} mm cutter, ${lmm / 2} mm deep, tight width)`;
    } else {
      const mt = new RegExp(String.raw`${NUM}"?\s*[×x]\s*${NUM}"?\s*[×x]\s*${NUM}"?\s*(?:in\s*)?deep`).exec(j.size ?? '');
      if (!mt) { feats.push({ k: 'note', text: `The mortise and tenon to the ${nameOf(r.to)} (${fracText(j.size ?? '')}) is not sized in the model.`, to: [r.to], joint: j.type }); continue; }
      [thin, wide, depth] = [num(mt[1]), num(mt[2]), num(mt[3])];
      noun = 'mortise'; detail = `${frac(thin)} wide × ${frac(wide)} long × ${frac(depth)} deep${/loose tenon/.test(r.text) ? ', for a loose tenon' : ''}`;
    }
    for (const l of r.pts) {
      const q = clampB(b.toBoard(l), b);
      const face = nearestFace(b, q);
      const tenon = j.type === 'mortise-tenon' && !/loose tenon|both parts mortised/.test(r.text) && face.ax === largestAxis(b);
      // Orientation: the long side of the mortise runs along the in-plane board axis that both parts are longest along.
      const inPlane = ([0, 1, 2] as Ax[]).filter((a) => a !== face.ax);
      const score = (a: Ax): number => Math.min(EXT(b)[a], mateExtent(mate, b.modelDir[a]));
      const wa = score(inPlane[0]) >= score(inPlane[1]) ? inPlane[0] : inPlane[1];
      const ta = inPlane[0] === wa ? inPlane[1] : inPlane[0];
      const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0];
      lo[wa] = Math.max(0, q[wa] - wide / 2); hi[wa] = Math.min(EXT(b)[wa], q[wa] + wide / 2);
      lo[ta] = q[ta] - thin / 2; hi[ta] = q[ta] + thin / 2;
      const fv = face.hi ? EXT(b)[face.ax] : 0;
      lo[face.ax] = face.hi ? fv - depth : fv; hi[face.ax] = face.hi ? fv : fv + depth;
      const kind: DrawingFeature['kind'] = tenon ? 'tenon' : 'mortise';
      const nm = tenon ? 'tenon' : noun, dt = tenon ? `${frac(thin)} thick × ${frac(wide)} wide × ${frac(depth)} long, shaped to fit the mortise (the shoulders are ${frac(depth)} back from the end)` : detail;
      const key = `${kind}|${nm}|${dt}|${face.ax}|${face.hi}|${wa}`;
      const ex = feats.find((f): f is RegionF => f.k === 'region' && f.key === key);
      if (ex) { ex.boxes.push([lo, hi]); if (!ex.to.includes(r.to)) ex.to.push(r.to); }
      else feats.push({ k: 'region', key, to: [r.to], joint: j.type, kind, boxes: [[lo, hi]], noun: nm, detail: dt, face });
    }
  }

  // ── F5: notches, dados, rabbets ──
  const atEnd = (q: Vec3, bd: Board): boolean => { const la = largestAxis(bd); return q[la] < 0.05 || q[la] > EXT(bd)[la] - 0.05; };
  for (const r of raw) {
    const j = r.j;
    if (!r.pts.length) continue;
    const t = r.text;
    const q0 = clampB(b.toBoard(r.pts[0]), b);
    if (j.type === 'dado' && !r.inbound) {
      if (/no cut in the/.test(t)) continue;
      const nm = new RegExp(String.raw`${NUM}"?\s*wide\s*[×x]\s*${NUM}"?\s*deep\s+notch`).exec(t);
      if (nm) {
        const w = num(nm[1]), d = num(nm[2]);
        const face = nearestFace(b, q0, [0, 1]);
        const along: Ax = face.ax === 1 ? 0 : 1;
        const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, b.N];
        lo[along] = q0[along] - w / 2; hi[along] = q0[along] + w / 2;
        lo[face.ax] = face.hi ? EXT(b)[face.ax] - d : 0; hi[face.ax] = face.hi ? EXT(b)[face.ax] : d;
        feats.push({ k: 'region', key: `notch|${r.to}`, to: [r.to], joint: j.type, kind: 'notch', boxes: [[lo, hi]], noun: 'notch', detail: `${frac(w)} wide × ${frac(d)} deep, through the thickness`, purpose: `for the ${nameOf(r.to)}`, face });
        continue;
      }
      if (atEnd(q0, b)) continue; // this part's END is let into the mate: the dado is the mate's
    }
    if (j.type === 'dado') {
      // An inbound dado is ours only when the other part's END lands on us.
      if (r.inbound) { const other = byId.get(r.to); const ob = other && plainSolid(other, p); if (!other || !ob || !atEnd(clampB(ob.board.toBoard(toLocalPt(other.transform, toModelPt(m, r.pts[0]))), ob.board), ob.board)) continue; }
      const mate = byId.get(r.to);
      const dd = new RegExp(String.raw`${NUM}"?\s*(?:in\s*)?deep`).exec(t);
      if (!mate || !dd) continue;
      const depth = num(dd[1]);
      const face = nearestFace(b, q0);
      const cs = cornersOf(mate).map((c) => b.toBoard(toLocalPt(m, c)));
      const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0];
      for (const a of [0, 1, 2] as Ax[]) {
        if (a === face.ax) { const fv = face.hi ? EXT(b)[a] : 0; lo[a] = face.hi ? fv - depth : fv; hi[a] = face.hi ? fv : fv + depth; continue; }
        lo[a] = Math.max(0, Math.min(...cs.map((c) => c[a]))); hi[a] = Math.min(EXT(b)[a], Math.max(...cs.map((c) => c[a])));
      }
      if (hi[0] - lo[0] < 0.01 || hi[1] - lo[1] < 0.01 || hi[2] - lo[2] < 0.01) { feats.push({ k: 'note', text: `The ${frac(depth)} dado for the ${nameOf(r.to)} could not be placed from the model.`, to: [r.to], joint: 'dado' }); continue; }
      const key = `dado|${frac(depth)}|${face.ax}|${face.hi}`;
      const ex = feats.find((f): f is RegionF => f.k === 'region' && f.key === key);
      if (ex) { ex.boxes.push([lo, hi]); ex.to.push(r.to); }
      else feats.push({ k: 'region', key, to: [r.to], joint: 'dado', kind: 'dado', boxes: [[lo, hi]], noun: 'dado', detail: `${frac(depth)} deep, as wide as the mating part`, purpose: `for the ${nameOf(r.to)}`, face });
      continue;
    }
    if (j.type === 'rabbet' && r.inbound) {
      const rb = new RegExp(String.raw`${NUM}"?\s*deep\s*[×x]\s*${NUM}`).exec(t);
      if (!rb) continue;
      const d = num(rb[1]), w = num(rb[2]);
      const la = largestAxis(b);
      const others = ([0, 1, 2] as Ax[]).filter((a) => a !== la);
      const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0];
      lo[la] = 0; hi[la] = EXT(b)[la];
      const sizes = [d, w];
      others.forEach((a, i) => { const hiSide = q0[a] > EXT(b)[a] / 2; lo[a] = hiSide ? EXT(b)[a] - sizes[i] : 0; hi[a] = hiSide ? EXT(b)[a] : sizes[i]; });
      const key = `rabbet|${t}`;
      if (!feats.some((f) => f.k === 'region' && f.key === key)) feats.push({ k: 'region', key, to: [r.to], joint: 'rabbet', kind: 'rabbet', boxes: [[lo, hi]], noun: 'rabbet', detail: `${frac(d)} × ${frac(w)}, along the whole length`, purpose: `for the edge of the ${nameOf(r.to)}` });
    }
  }
  if (solid.pocket) feats.push({ k: 'region', key: 'pocket', to: [], joint: 'pocket', kind: 'notch', boxes: [[solid.pocket.lo, solid.pocket.hi]], noun: 'pocket', detail: solid.pocket.detail, purpose: 'for the flap tongue and the pivot block', face: { ax: 2, hi: true } });

  // ── F6: steel rods (axles) and tubes that lie in the part: grooves and bores ──
  const notchBoxes = feats.filter((f): f is RegionF => f.k === 'region' && f.kind === 'notch').flatMap((f) => f.boxes);
  if (part.kind === 'lumber' && (part.geometry.type === 'box' || part.geometry.type === 'extrusion')) {
    const A = worldAABB(part);
    const claimed = new Set(raw.filter((r) => FASTENERS.has(r.j.type)).map((r) => r.to));
    for (const c of parts) {
      if (c.id === part.id || c.geometry.type !== 'cylinder' || claimed.has(c.id) || !(c.kind === 'metal' || /tube/i.test(c.name))) continue;
      const C = worldAABB(c);
      if ([0, 1, 2].some((k) => Math.min(A.max[k], C.max[k]) - Math.max(A.min[k], C.min[k]) < 0.02)) continue;
      const g = c.geometry;
      const axB = b.dirToBoard(toLocalDir(m, norm(toModelDir(c.transform, [0, 0, 1]))));
      const a = dominant(axB);
      if (Math.abs(axB[a]) < 0.97) continue;
      const cen = b.toBoard(toLocalPt(m, toModelPt(c.transform, [0, 0, 0])));
      if (notchBoxes.some(([lo, hi]) => [0, 1, 2].every((k) => k === a || (cen[k] >= lo[k] - 1e-6 && cen[k] <= hi[k] + 1e-6)))) continue; // the rod lies in a notch
      const e0 = b.toBoard(toLocalPt(m, toModelPt(c.transform, [0, 0, -g.length / 2])))[a], e1 = b.toBoard(toLocalPt(m, toModelPt(c.transform, [0, 0, g.length / 2])))[a];
      const s0 = Math.max(0, Math.min(e0, e1)), s1 = Math.min(EXT(b)[a], Math.max(e0, e1));
      const [p1, p2] = ([0, 1, 2] as Ax[]).filter((k) => k !== a);
      const r0 = g.radius, dia = 2 * r0;
      const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0];
      lo[a] = s0; hi[a] = s1;
      const outs = [p1, p2].flatMap((k) => [cen[k] + r0 > EXT(b)[k] + 1e-3 ? { k, hi: true } : null, cen[k] - r0 < -1e-3 ? { k, hi: false } : null]).filter((x): x is { k: Ax; hi: boolean } => !!x);
      for (const k of [p1, p2]) { lo[k] = Math.max(0, cen[k] - r0); hi[k] = Math.min(EXT(b)[k], cen[k] + r0); }
      const what = c.name.toLowerCase().replace(/\s*\([^)]*\)/, '');
      if (outs.length === 1) {
        const o = outs[0];
        const depth = o.hi ? EXT(b)[o.k] - (cen[o.k] - r0) : cen[o.k] + r0;
        const proud = dia - depth;
        const run = s0 < 0.02 && s1 > EXT(b)[a] - 0.02 ? 'end to end' : s0 < 0.02 ? `${frac(s1 - s0)} long from the ${words.side[a][0]}` : s1 > EXT(b)[a] - 0.02 ? `${frac(s1 - s0)} long from the ${words.side[a][1]}` : `${frac(s1 - s0)} long`;
        feats.push({ k: 'region', key: `groove|${c.id}`, to: [c.id], joint: 'rod', kind: 'groove', boxes: [[lo, hi]], noun: /tube/.test(what) ? 'half-round relief groove' : 'groove', detail: `${frac(dia)} wide × ${frac(depth)} deep, ${run}`, purpose: `for the ${frac(dia)} ${humanName(c.name)}${proud > 0.005 ? ` (it stands ${frac(proud)} proud, so the clamp plate bears on it)` : ''}`, face: { ax: o.k, hi: o.hi } });
      } else if (!outs.length) {
        feats.push({ k: 'hole', key: `bore|${c.id}`, to: [c.id], joint: 'rod', pts: [cen.map((v, i) => (i === a ? (s0 + s1) / 2 : v)) as Vec3], axis: unitAx(a), dia: dia + 1 / 64, noun: 'bore', size: `${drill(dia + 1 / 64)}, through`, purpose: `for the ${frac(dia)} ${humanName(c.name)}` });
      }
    }
  }

  // ── F1: outline features (notches, steps, angled and curved ends) ──
  if (part.kind === 'bentlam') {
    notes.push(`Cut as a straight strip ${frac(part.stock?.t ?? b.N)} × ${frac(part.stock?.w ?? b.V)} × ${frac(part.stock?.l ?? b.U)}, left long and trimmed at the dry fit. The view is the band as it sits on the side, drawn along the plan curve (${frac(b.U)}); ${part.geometry.type === 'mesh' && part.geometry.grainFollowsTop ? `the straight strip is longer, ${frac(part.stock?.l ?? b.U)}, because it also follows the sheer: that is its developed length along its centerline` : 'the straight strip is the developed length along it'}.`);
    if (feats.some((f) => f.k !== 'note')) notes.push('Cut the holes and mortises after the side is glued up, with the mating part in place where the joint needs it.');
  } else {
    const ang = part.geometry.type === 'extrusion' ? angleSection(b.main, b) : null;
    // A profile extruded along its grain (the crest strip): the main view is its cross-section, so a sloped side of the outline is a bevel rip along the whole length, not a sloped end.
    const crossSection = !!part.grain && dominant(b.dirToBoard(unitAx({ x: 0, y: 1, z: 2 }[part.grain] as Ax)).map(Math.abs) as Vec3) === 2 && EXT(b)[2] >= Math.max(EXT(b)[0], EXT(b)[1]);
    const outl = ang ? [ang] : outlineFeatures(b.main, b, words, vrefOf(b.main, b));
    if (crossSection) for (const o of outl) if (/^Sloped (edge|end):/.test(o.text)) { o.text = o.text.replace(/^Sloped (edge|end):/, `Bevel rip along the whole ${frac(EXT(b)[2])} length:`); o.title = 'Bevel rip'; }
    feats.push(...outl);
  }
  // D-77: the pivot strap is bought as flat bar: cut and drill only.
  if (part.partNo === 'brake-strap') notes.push('Cut from the flat bar on the metal bandsaw and deburr the cut edges; drill on the drill press. Cut, deburr and drill only. Drill the screw holes first; the knee\'s pin hole is drilled through this pin hole after the strap is screwed on.');
  // D-76: the side ribs, their knees and the box tie spacers.
  if (/^side-rib(-box|-bow|-rear)?$/.test(part.partNo ?? '')) {
    notes.push('A T-shaped rib: a narrow shaft and a head as tall as the gunwale band, the top of the head cut to the sheer (the slope is dimensioned at both ends). The drawn face is the one that faces into the sled; the back face is glued to the bands and the filler.');
    if ((part.joints ?? []).some((q) => q.type === 'hole' && /template/.test(q.note ?? ''))) notes.push('Do not drill the two D-ring holes on the bench: they are drilled at the D-ring and sign step, through the head and the side together, with the D-ring bracket as the template. The positions here check the bracket (measure the real bracket first).');
    if ((part.joints ?? []).some((q) => q.type === 'threaded-insert' && /^sign-/.test(q.to))) notes.push('Do not drill the two sign insert holes on the bench: they are bored from outside, through the web, the band-strip filler and the rib together, at the D-ring and sign step, with the sign as the template. The positions here check them.');
  }
  if (part.partNo === 'box-tie') notes.push('A plain stick that fills the gap between the box rib and the box side. Measure that gap at the dry fit and cut the stick a hair short of it: thickened epoxy takes up the rest. Its top stands 1/8" under the box coaming, so it is never glued to the lid frame.');
  if (part.partNo === 'side-rib-knee') notes.push('A right-triangle knee: the tall leg is glued to the face of the rib and the foot to the deck. Drill the screw holes straight down from the sloped face, with the counterbore first, so the screw head leaves the stated oak under it.');
  if (!b.rod && part.plies && part.plies > 1) notes.push(`${part.plies} strips glued face to face and bent on the form: cut the features after the glue-up and the bend.`);

  // ── Notches through the thickness cut into a box's main outline ──
  if (notchBoxes.length && part.geometry.type === 'box') b.main = notchedRect(b.U, b.V, notchBoxes);

  // Merge identical hole features (same spec and axis) across joints; drop a hole whose points another hole already has.
  const merged: Feat[] = [];
  for (const f of feats) {
    if (f.k === 'hole') {
      const ex = merged.find((g): g is HoleF => g.k === 'hole' && g.key === f.key);
      if (ex) { ex.pts.push(...f.pts.filter((q) => !ex.pts.some((e) => Math.hypot(e[0] - q[0], e[1] - q[1], e[2] - q[2]) < 0.05))); for (const t of f.to) if (!ex.to.includes(t)) ex.to.push(t); continue; }
      const dup = merged.find((g): g is HoleF => g.k === 'hole' && Math.abs(g.dia - f.dia) < 1 / 64 && f.pts.every((q) => g.pts.some((e) => samePerp(e, q, g.axis))));
      if (dup) { for (const t of f.to) if (!dup.to.includes(t)) dup.to.push(t); continue; }
    }
    merged.push(f);
  }
  return { part, board: b, words, feats: merged, notes, vref: vrefOf(b.main, b), nameOf };
}

/** Two hole points on the same axis line (within 0.1" across the axis). */
function samePerp(a: Vec3, c: Vec3, axis: Vec3): boolean {
  const d: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const along = dot(d, axis);
  return Math.hypot(d[0] - axis[0] * along, d[1] - axis[1] * along, d[2] - axis[2] * along) < 0.1;
}

/** F3: a through bolt or pin of another part (q -> j.to) whose line crosses this part gets a hole here (the knee bolts through the backer, the hold-down bolts through the rail). */
function addPassingBolts(part: Part, parts: Part[], b: Board, feats: Feat[], byId: Map<string, Part>, p: Params): void {
  const A = worldAABB(part);
  const m = part.transform;
  const boardOfId = (id: string): Board | null => { const x = byId.get(id); return x ? plainSolid(x, p)?.board ?? null : null; };
  const inside = (x: Part, bd: Board, P: Vec3): boolean => insideB(bd, x.transform ? bd.toBoard(toLocalPt(x.transform, P)) : bd.toBoard(P));
  for (const q of parts) {
    if (q.id === part.id) continue;
    for (const j of q.joints ?? []) {
      if (j.to === part.id || !j.at?.length || !(j.type === 'bolt' || j.type === 'pin')) continue;
      const text = `${j.size ?? ''} ${j.note ?? ''}`;
      if (!/through/.test(text) || /blind|epoxied|stopped/.test(j.size ?? '')) continue;
      const mate = byId.get(j.to);
      const qb = boardOfId(q.id), tb = boardOfId(j.to);
      if (!qb || !tb || !mate) continue;
      // The joint text must name this part ("through this leg and the rail into the BACKER"): a word of its name that the two jointed parts' names do not have.
      const wordsOfName = (n: string): string[] => n.toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z]+/).filter((x) => x.length >= 4);
      const others = new Set([...wordsOfName(q.name), ...wordsOfName(mate.name)]);
      if (!wordsOfName(part.name).some((wd) => !others.has(wd) && new RegExp(String.raw`\b${wd}s?\b`).test(text.toLowerCase()))) continue;
      const lenM = new RegExp(String.raw`[×x]\s*${NUM}"?\s*(?:316|hex|carriage|button|bolt|stainless)`).exec(text);
      const len = lenM ? num(lenM[1]) : DEFAULT_BOLT_IN;
      const fr = boardFrame(q, qb);
      const pts: Vec3[] = [];
      let axisB: Vec3 | null = null;
      for (const a of j.at) {
        const P = toModelPt(q.transform, a);
        const am = holeAxisModel(q, parts, mate, P, text, fr);
        if (!am) continue;
        let D = am.axis;
        if (!am.exact) { const qd = fr.dir; const k = [0, 1, 2].reduce((bk, i) => (Math.abs(dot(qd[i], D)) > Math.abs(dot(qd[bk], D)) ? i : bk), 0); D = scale(qd[k], Math.sign(dot(qd[k], D)) || 1); }
        const H = len + 2;
        const a0 = add(P, scale(D, -H)), a1 = add(P, scale(D, H));
        if ([0, 1, 2].some((k) => Math.max(a0[k], a1[k]) < A.min[k] - 0.05 || Math.min(a0[k], a1[k]) > A.max[k] + 0.05)) continue;
        // The bolt runs through q and j.to, and on by what is left of its length: only that stretch can cross a third part.
        const tq: number[] = [], tt: number[] = [], tp: number[] = [];
        for (let t = -H; t <= H + 1e-9; t += 0.03) {
          const X = add(P, scale(D, t));
          if (inside(q, qb, X)) tq.push(t);
          if (inside(mate, tb, X)) tt.push(t);
          if (insideB(b, b.toBoard(toLocalPt(m, X)))) tp.push(t);
        }
        if (!tq.length || !tt.length || tp.length < 2) continue;
        const u0 = Math.min(tq[0], tt[0]), u1 = Math.max(tq[tq.length - 1], tt[tt.length - 1]);
        const extra = Math.max(0.5, len - (u1 - u0));
        const r0 = u0 - extra, r1 = u1 + extra;
        const tin = tp.filter((t) => t >= r0 && t <= r1);
        if (tin.length < 2 || tin[tin.length - 1] - tin[0] < 0.05) continue;
        pts.push(clampB(b.toBoard(toLocalPt(m, add(P, scale(D, (tin[0] + tin[tin.length - 1]) / 2)))), b));
        axisB = snapAxis(b.dirToBoard(toLocalDir(m, D)), am.exact);
      }
      if (!pts.length || !axisB) continue;
      const d0 = j.diaIn ?? 0.25;
      // A T-nut set in this part takes a hole for its barrel, not a bolt clearance (the push-handle socket screws, D-63).
      const tnut = new RegExp(String.raw`T-NUT set in the (\w+)`, 'i').exec(text);
      const isTnut = !!tnut && part.name.toLowerCase().includes(tnut[1].toLowerCase());
      const namedC = new RegExp(String.raw`${NUM}"?\s+clearance\s+holes?\b`).exec(text);
      const dia = namedC && j.type === 'bolt' && !isTnut ? num(namedC[1]) : isTnut ? d0 + 1 / 16 : j.type === 'pin' ? clearanceDia({ type: 'pin', size: '', diaIn: d0 }) : clearanceDia({ type: 'bolt', size: j.size, diaIn: d0 });
      // This part already records its own hole for that bolt's part (the D-ring bearing plate's 3/16" holes for the lash point's screws): a second set from the screws' crossing, a hair off, is the same holes twice.
      if (feats.some((f) => f.k === 'hole' && f.joint !== 'passing' && f.to.includes(q.id))) continue;
      if (feats.some((f) => f.k === 'hole' && pts.every((q2) => f.pts.some((e) => samePerp(e, q2, f.axis))))) continue; // the same holes, whatever size the other part's text implies (one size a stack: the stack test)
      // a pin of another part that ends in a hole this part already has for it (the seat-back latch pin in the stop block)
      if (j.type === 'pin' && feats.some((f) => f.k === 'hole' && f.to.includes(j.to) && pts.every((q2) => f.pts.some((e) => Math.hypot(e[0] - q2[0], e[1] - q2[1], e[2] - q2[2]) < 1)))) continue; // 1 in: the recorded point is the hole's mouth, the crossing's is mid-way along the pin
      const ofQ = humanName(q.name), ofMate = humanName(mate.name);
      const noun = fastenerNoun(j, text);
      const size = isTnut ? `${drill(dia)} for the T-nut barrel (check it against your T-nut), through` : `${drill(dia)} clearance, through`;
      const purpose = isTnut ? `for the ${frac(d0)} T-nuts the socket screws thread into` : `for the ${noun} through the ${ofQ} and the ${ofMate}`;
      feats.push({ k: 'hole', key: `passing|${q.id}|${j.to}|${j.type}`, to: [q.id, j.to], joint: 'passing', pts, axis: axisB, dia, noun: 'hole', size, purpose });
    }
  }
}

/** The v datum: the straighter of the bottom (v = 0) and top (v = V) edges (the one with more of its length on the bounding box). */
function vrefOf(o: Vec2[], b: Board): 0 | 1 {
  const along = (v: number): number => o.reduce((s, q, i) => { const r = o[(i + 1) % o.length]; return Math.abs(q[1] - v) < 0.01 && Math.abs(r[1] - v) < 0.01 ? s + Math.abs(r[0] - q[0]) : s; }, 0);
  return along(b.V) > along(0) + 0.01 ? 1 : 0;
}

/** A rectangle with axis-aligned notches cut in from its edges (each notch touches one edge). */
function notchedRect(U: number, V: number, boxes: Array<[Vec3, Vec3]>): Vec2[] {
  const out: Vec2[] = [];
  const onEdge = (side: 'b' | 'r' | 't' | 'l') => boxes.filter(([lo, hi]) => (side === 'b' ? lo[1] < 0.01 : side === 't' ? hi[1] > V - 0.01 : side === 'l' ? lo[0] < 0.01 : hi[0] > U - 0.01));
  out.push([0, 0]);
  for (const [lo, hi] of onEdge('b').sort((a, c) => a[0][0] - c[0][0])) out.push([lo[0], 0], [lo[0], hi[1]], [hi[0], hi[1]], [hi[0], 0]);
  out.push([U, 0]);
  for (const [lo, hi] of onEdge('r').sort((a, c) => a[0][1] - c[0][1])) out.push([U, lo[1]], [lo[0], lo[1]], [lo[0], hi[1]], [U, hi[1]]);
  out.push([U, V]);
  for (const [lo, hi] of onEdge('t').sort((a, c) => c[0][0] - a[0][0])) out.push([hi[0], V], [hi[0], lo[1]], [lo[0], lo[1]], [lo[0], V]);
  out.push([0, V]);
  for (const [lo, hi] of onEdge('l').sort((a, c) => c[0][1] - a[0][1])) out.push([0, hi[1]], [hi[0], hi[1]], [hi[0], lo[1]], [0, lo[1]]);
  return out;
}

// ── F1: outline narration ──

/** Drop repeated and collinear points. */
function simplify(o: Vec2[], tol = 0.004): Vec2[] {
  let pts = o.filter((q, i) => Math.hypot(q[0] - o[(i + 1) % o.length][0], q[1] - o[(i + 1) % o.length][1]) > 1e-6);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], q = pts[i], c = pts[(i + 1) % pts.length];
      const l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      const dist = Math.abs((c[0] - a[0]) * (a[1] - q[1]) - (a[0] - q[0]) * (c[1] - a[1])) / l;
      const between = (q[0] - a[0]) * (c[0] - q[0]) + (q[1] - a[1]) * (c[1] - q[1]) >= -1e-9;
      if (dist < tol && between) { pts = pts.filter((_, k) => k !== i); changed = true; break; }
    }
  }
  return pts;
}

type Side = 'v0' | 'v1' | 'u0' | 'u1';
function sidesOf(q: Vec2, b: Board, tol = 0.01): Side[] {
  const s: Side[] = [];
  if (Math.abs(q[1]) < tol) s.push('v0');
  if (Math.abs(q[1] - b.V) < tol) s.push('v1');
  if (Math.abs(q[0]) < tol) s.push('u0');
  if (Math.abs(q[0] - b.U) < tol) s.push('u1');
  return s;
}

/** Position words for a point in the main view: `8-5/16" from the REAR end, 1-3/32" from the TOP edge`. */
function posUV(q: Vec2, b: Board, w: Words, vref: 0 | 1): string {
  return `${uText(q[0], b, w)}, ${vText(q[1], b, w, vref)}`;
}
function uText(u: number, _b: Board, w: Words): string {
  const a = alongU(u, w);
  return a.val ? `${a.val} ${a.datum}` : a.datum;
}
function vText(v: number, b: Board, w: Words, vref: 0 | 1): string {
  return `${frac(vref ? b.V - v : v)} from the ${w.side[1][vref]}`;
}
function nText(n: number, b: Board, w: Words): string {
  return Math.abs(n - b.N / 2) < 0.02 ? 'centered across the thickness' : `${frac(b.N - n)} from the ${w.side[2][1]}`;
}

/** The outline of an angle (a 6-sided L, every edge square): its legs and its thickness. */
function angleSection(outline: Vec2[], b: Board): OutlineF | null {
  const o = simplify(outline);
  if (o.length !== 6) return null;
  const edges = o.map((q, i) => { const r = o[(i + 1) % 6]; return Math.hypot(r[0] - q[0], r[1] - q[1]); });
  if (!o.every((q, i) => { const r = o[(i + 1) % 6]; return Math.abs(r[0] - q[0]) < 0.004 || Math.abs(r[1] - q[1]) < 0.004; })) return null;
  const t = Math.min(...edges);
  const size = `${frac(b.U)} × ${frac(b.V)} legs, ${frac(t)} thick`;
  return { k: 'outline', title: 'Angle section', text: `Angle (L section), ${size}.`, marks: [], size };
}

function outlineFeatures(outline: Vec2[], b: Board, w: Words, vref: 0 | 1): OutlineF[] {
  const o = simplify(outline);
  const n = o.length;
  const sideName = (s: Side): string => (s === 'v0' ? w.side[1][0] : s === 'v1' ? w.side[1][1] : s === 'u0' ? w.side[0][0] : w.side[0][1]);
  const edgeSide = (i: number): Side | null => {
    const a = sidesOf(o[i], b), c = sidesOf(o[(i + 1) % n], b);
    return a.find((s) => c.includes(s)) ?? null;
  };
  const onB = o.map((_, i) => edgeSide(i));
  if (onB.every((x) => x !== null)) return [];
  const start = onB.findIndex((x) => x !== null);
  if (start < 0) return [{ k: 'outline', title: 'Shaped outline', text: 'Shaped outline: no edge is square to the others; cut it to the offsets in the notes.', marks: o.length <= 8 ? o : [], extra: `Offsets of the outline, ${offsets(o, b, w, vref)}.` }];
  const feats: OutlineF[] = [];
  // Walk once around from the first boundary edge, collecting the runs of off-boundary edges.
  let i = (start + 1) % n;
  for (let steps = 0; steps < n; ) {
    if (onB[i] !== null) { i = (i + 1) % n; steps++; continue; }
    const run: Vec2[] = [o[i]];
    const prevSide = onB[(i - 1 + n) % n]!;
    let k = i;
    while (onB[k] === null && run.length <= n) { k = (k + 1) % n; run.push(o[k]); steps++; }
    const nf = narrate(run, prevSide, onB[k]!, b, w, vref, sideName);
    feats.push(nf.anchor ? nf : { ...nf, anchor: midOf(run) });
    i = k;
  }
  return feats;
}

function narrate(run: Vec2[], sa: Side, sb: Side, b: Board, w: Words, vref: 0 | 1, sideName: (s: Side) => string): OutlineF {
  const A = run[0], B = run[run.length - 1];
  const segs = run.length - 1;
  const axisAligned = run.every((q, i) => i === 0 || Math.abs(q[0] - run[i - 1][0]) < 0.004 || Math.abs(q[1] - run[i - 1][1]) < 0.004);
  const marks = run.length <= 8 ? run : [A, B];
  const curve = segs > 6;
  const sideLine = (s: Side): { ax: 0 | 1; val: number } => (s === 'v0' ? { ax: 1, val: 0 } : s === 'v1' ? { ax: 1, val: b.V } : s === 'u0' ? { ax: 0, val: 0 } : { ax: 0, val: b.U });
  /** A line that is too long for the table goes to the notes. */
  const fit = (head: string, tail: string): { text: string; extra?: string } => (head.length + tail.length < MAX_LINE ? { text: `${head} ${tail}`.trim() } : { text: head, extra: tail });
  if (sa === sb) {
    const L = sideLine(sa);
    const al = L.ax === 1 ? 0 : 1;
    const depth = Math.max(...run.map((q) => Math.abs(q[L.ax] - L.val)));
    const a0 = Math.min(A[al], B[al]), a1 = Math.max(A[al], B[al]);
    const span = al === 0 ? `${frac(a0)} to ${frac(a1)} from the ${w.side[0][0]}` : `${frac(vref ? b.V - a1 : a0)} to ${frac(vref ? b.V - a0 : a1)} from the ${w.side[1][vref]}`;
    if (axisAligned && segs === 3) {
      const size = `${frac(a1 - a0)} wide × ${frac(depth)} deep`;
      return { k: 'outline', title: `Notch in the ${sideName(sa)}`, text: `Notch in the ${sideName(sa)}, ${size}. From ${span}. Square shoulders.`, marks, size, positions: [span], face: sideName(sa) };
    }
    if (curve) return { k: 'outline', title: `Curved cut in the ${sideName(sa)}`, text: `Curved cut in the ${sideName(sa)}, up to ${frac(depth)} deep, from ${span}. Cut it to the offsets in the notes.`, marks, size: `up to ${frac(depth)} deep`, positions: [span], face: sideName(sa), extra: `Offsets of the curved cut in the ${sideName(sa)}, ${offsets(run, b, w, vref)}.` };
    const f = fit(`Cut in the ${sideName(sa)}, ${frac(depth)} deep, from ${span}.`, `${sentence(path(run, b, w, vref))}.`);
    return { k: 'outline', title: `Cut in the ${sideName(sa)}`, text: f.text, marks, size: `${frac(depth)} deep`, positions: [span], face: sideName(sa), ...(f.extra ? { extra: f.extra } : {}) };
  }
  const opposite = sa[0] === sb[0];
  if (curve) {
    const arc = fitArc(run);
    // A curve that leaves (or reaches) its side by a straight run across the board (the bridle tongue's square head face): say so, so the table of offsets and this line agree.
    const vFrom = (q: Vec2): string => `${frac(vref ? b.V - q[1] : q[1])}`;
    const shoulder = (p0: Vec2, p1: Vec2, lead: 'starts' | 'ends'): string => `It ${lead} with a straight run at ${frac(p0[0])} from the ${w.side[0][0]}, ${vFrom(p0)} to ${vFrom(p1)} from the ${w.side[1][vref]}. `;
    const shoulders = (Math.abs(run[1][0] - A[0]) < 0.004 ? shoulder(A, run[1], 'starts') : '') + (Math.abs(run[run.length - 2][0] - B[0]) < 0.004 ? shoulder(B, run[run.length - 2], 'ends') : '');
    return { k: 'outline', title: opposite ? 'Curved edge' : 'Curved corner', text: `Curve from the ${sideName(sa)} at ${posUV(A, b, w, vref)} to the ${sideName(sb)} at ${posUV(B, b, w, vref)}${arc ? `: a circular arc, ${frac(arc.r)} radius` : ''}. ${shoulders}Cut it to the offsets in the notes.`, marks, ...(arc ? { size: `${frac(arc.r)} radius` } : {}), positions: [posUV(A, b, w, vref), posUV(B, b, w, vref)], extra: `Offsets of the curve, ${offsets(run, b, w, vref)}.` };
  }
  // A step: the run ends with a stretch parallel to the side it left, running out through the other side (the rail's front step). Walked either way round.
  const parallelTo = (sd: Side, p0: Vec2, p1: Vec2): boolean => (sideLine(sd).ax === 1 ? Math.abs(p0[1] - p1[1]) < 0.004 : Math.abs(p0[0] - p1[0]) < 0.004);
  if (!opposite && segs >= 2) {
    let r = run, s1 = sa, s2 = sb;
    if (!parallelTo(s1, r[r.length - 2], r[r.length - 1]) && parallelTo(s2, r[0], r[1])) { r = [...r].reverse(); [s1, s2] = [s2, s1]; }
    if (parallelTo(s1, r[r.length - 2], r[r.length - 1])) {
      const L1 = sideLine(s1), E = r[r.length - 1], pre = r[r.length - 2];
      const depth = Math.abs(E[L1.ax] - L1.val), len = Math.abs(L1.ax === 1 ? E[0] - pre[0] : E[1] - pre[1]);
      const mid: Vec2 = [(pre[0] + E[0]) / 2, (pre[1] + E[1]) / 2];
      const sp = L1.ax === 1 ? spanAt(b, mid[0]) : hspanAt(b, mid[1]);
      const left = sp[1] - sp[0];
      const size = `the last ${frac(len)} cut ${frac(depth)} back, leaving ${frac(left)}`;
      let shoulder: string, positions: string[], angleDeg: number | undefined;
      if (r.length === 3) {
        const du = Math.abs(r[1][0] - r[0][0]), dv = Math.abs(r[1][1] - r[0][1]);
        if (du < 0.004 || dv < 0.004) { shoulder = `The shoulder is square, at ${posUV(r[1], b, w, vref)}.`; positions = [posUV(r[1], b, w, vref)]; }
        else { angleDeg = Math.round((Math.atan2(dv, du) * 180) / Math.PI); shoulder = `The shoulder slopes at ${angleDeg}°, from ${posUV(r[0], b, w, vref)} to ${posUV(r[1], b, w, vref)}.`; positions = [posUV(r[0], b, w, vref), posUV(r[1], b, w, vref)]; }
      } else { shoulder = `${sentence(path(r, b, w, vref))}.`; positions = r.slice(0, -1).map((q) => posUV(q, b, w, vref)); }
      const f = fit(`Step in the ${sideName(s1)} at the ${sideName(s2)}: ${size}.`, shoulder);
      return { k: 'outline', title: `Step at the ${sideName(s2)}`, text: f.text, marks, anchor: midOf(r), size, positions, face: sideName(s1), ...(angleDeg !== undefined ? { angleDeg } : {}), ...(f.extra ? { extra: f.extra } : {}) };
    }
  }
  if (!opposite && axisAligned && segs === 2) {
    const corner = run[1];
    const size = `${frac(Math.abs(A[0] - B[0]))} along the length × ${frac(Math.abs(A[1] - B[1]))} along the height`;
    return { k: 'outline', title: 'Rabbet', text: `Rabbet at the ${sideName(sa)} / ${sideName(sb)} corner, ${size}. Its inside corner is at ${posUV(corner, b, w, vref)}.`, marks, size, positions: [posUV(corner, b, w, vref)], face: `${sideName(sa)} / ${sideName(sb)} corner` };
  }
  if (opposite && segs === 1) {
    const slope = Math.round((Math.atan2(Math.abs(B[1] - A[1]), Math.abs(B[0] - A[0])) * 180) / Math.PI);
    const size = `a straight cut, ${slope}° from level`;
    return { k: 'outline', title: 'Sloped edge', text: `Sloped ${sa[0] === 'u' ? 'edge' : 'end'}: ${size}, from ${posUV(A, b, w, vref)} to ${posUV(B, b, w, vref)}.`, marks, size, positions: [posUV(A, b, w, vref), posUV(B, b, w, vref)], angleDeg: slope };
  }
  const f = fit(`${opposite ? `Shaped ${sa[0] === 'u' ? 'edge' : 'end'}` : 'Corner cut'} from the ${sideName(sa)} to the ${sideName(sb)}.`, `${sentence(path(run, b, w, vref))}.`);
  return { k: 'outline', title: opposite ? 'Shaped edge' : 'Corner cut', text: f.text, marks, positions: [posUV(A, b, w, vref), posUV(B, b, w, vref)], ...(f.extra ? { extra: f.extra } : {}) };
}

/** The middle of a run: the midpoint of its middle segment (where a balloon points). */
function midOf(run: Vec2[]): Vec2 {
  const i = Math.max(0, Math.floor((run.length - 2) / 2));
  return [(run[i][0] + run[i + 1][0]) / 2, (run[i][1] + run[i + 1][1]) / 2];
}

/** "starts at …; then slopes at 37° to the length …; then runs level …" */
function path(run: Vec2[], b: Board, w: Words, vref: 0 | 1): string {
  const parts: string[] = [`starts at ${posUV(run[0], b, w, vref)}`];
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1], c = run[i];
    const du = c[0] - a[0], dv = c[1] - a[1];
    const toward = (d: number, ax: 0 | 1): string => w.side[ax][d > 0 ? 1 : 0];
    let move: string;
    if (Math.abs(dv) < 0.004) move = `runs level ${frac(Math.abs(du))} toward the ${toward(du, 0)}`;
    else if (Math.abs(du) < 0.004) move = `runs square ${frac(Math.abs(dv))} toward the ${toward(dv, 1)}`;
    else move = `slopes at ${deg((Math.atan2(Math.abs(dv), Math.abs(du)) * 180) / Math.PI)} to the length (${frac(Math.abs(du))} toward the ${toward(du, 0)}, ${frac(Math.abs(dv))} toward the ${toward(dv, 1)})`;
    parts.push(`${move} to ${posUV(c, b, w, vref)}`);
  }
  return parts.join('; then ');
}

/** Offsets of a curve: stations along u from the u datum and the height from the v datum, up to 11 of them. */
function offsets(run: Vec2[], b: Board, w: Words, vref: 0 | 1): string {
  const us = run.map((q) => q[0]);
  const u0 = Math.min(...us), u1 = Math.max(...us);
  const n = Math.min(10, Math.max(4, Math.round((u1 - u0) / 2)));
  const at = (u: number): number => {
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1], c = run[i];
      if ((a[0] - u) * (c[0] - u) <= 0 && Math.abs(c[0] - a[0]) > 1e-9) return a[1] + ((c[1] - a[1]) * (u - a[0])) / (c[0] - a[0]);
    }
    return NaN;
  };
  const rows: string[] = [];
  // a straight run across the board at the first or last station (the tongue's square head face) has two heights there, not one
  const vv = (v: number): string => frac(vref ? b.V - v : v);
  const lead = (u: number): { a: number; c: number } | null => {
    for (let i = 1; i < run.length; i++) if (Math.abs(run[i][0] - u) < 0.004 && Math.abs(run[i - 1][0] - u) < 0.004) return { a: run[i - 1][1], c: run[i][1] };
    return null;
  };
  for (let k = 0; k <= n; k++) {
    const u = u0 + ((u1 - u0) * k) / n; const v = at(u);
    const ld = k === 0 || k === n ? lead(u) : null;
    if (ld) rows.push(`${frac(u)}: ${vv(ld.a)} and ${vv(ld.c)} (a straight run across)`);
    else if (Number.isFinite(v)) rows.push(`${frac(u)}: ${vv(v)}`);
  }
  return `station from the ${w.side[0][0]} : height from the ${w.side[1][vref]} = ${rows.join('; ')}`;
}

/** A circle through the ends and the middle of a polyline, if every vertex is within 1/32" of it. */
function fitArc(run: Vec2[]): { r: number; rise: number } | null {
  const a = run[0], c = run[run.length - 1], m = run[Math.floor(run.length / 2)];
  const d = 2 * (a[0] * (m[1] - c[1]) + m[0] * (c[1] - a[1]) + c[0] * (a[1] - m[1]));
  if (Math.abs(d) < 1e-9) return null;
  const sq = (q: Vec2) => q[0] * q[0] + q[1] * q[1];
  const ux = (sq(a) * (m[1] - c[1]) + sq(m) * (c[1] - a[1]) + sq(c) * (a[1] - m[1])) / d;
  const uy = (sq(a) * (c[0] - m[0]) + sq(m) * (a[0] - c[0]) + sq(c) * (m[0] - a[0])) / d;
  const r = Math.hypot(a[0] - ux, a[1] - uy);
  if (run.some((q) => Math.abs(Math.hypot(q[0] - ux, q[1] - uy) - r) > 1 / 32)) return null;
  const chord = Math.hypot(c[0] - a[0], c[1] - a[1]);
  return { r, rise: r - Math.sqrt(Math.max(0, r * r - (chord * chord) / 4)) };
}

// ── Rendering ──

const INK = '#1a1a1a', DIM = '#0057b8', HID = '#6b6b6b', FEAT = '#b3261e', WOOD = '#f6f1e7', GRAIN = '#a08a5a';
const FONT = 'Helvetica, Arial, sans-serif';
const txt = (x: number, y: number, s: string, size = 0.11, o: { anchor?: string; rot?: number; fill?: string; bold?: boolean } = {}): string =>
  `<text x="${fmt(x)}" y="${fmt(y)}" font-family="${FONT}" font-size="${fmt(size)}" fill="${o.fill ?? INK}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.bold ? ' font-weight="bold"' : ''}${o.rot ? ` transform="rotate(${fmt(o.rot)} ${fmt(x)} ${fmt(y)})"` : ''}>${esc(s)}</text>`;
const line = (a: Vec2, c: Vec2, stroke = INK, w = 0.01, dash = ''): string => `<path d="M${fmt(a[0])},${fmt(a[1])}L${fmt(c[0])},${fmt(c[1])}" stroke="${stroke}" stroke-width="${fmt(w)}" fill="none"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
const polyEl = (pts: Vec2[], stroke = INK, w = 0.014, fill = 'none', dash = ''): string => `<path d="${pts.map((q, i) => `${i ? 'L' : 'M'}${fmt(q[0])},${fmt(q[1])}`).join('')}Z" stroke="${stroke}" stroke-width="${fmt(w)}" fill="${fill}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
const ellipse = (c: Vec2, rx: number, ry: number, stroke = INK, w = 0.01, dash = '', fill = 'none'): string => `<ellipse cx="${fmt(c[0])}" cy="${fmt(c[1])}" rx="${fmt(rx)}" ry="${fmt(ry)}" stroke="${stroke}" stroke-width="${fmt(w)}" fill="${fill}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
const DASH = '0.05 0.035';
const balloon = (c: Vec2, letter: string, r = 0.085): string => ellipse(c, r, r, FEAT, 0.01, '', '#ffffff') + txt(c[0], c[1] + 0.037, letter, 0.105, { anchor: 'middle', fill: FEAT, bold: true });

/** The longest feature line (characters): two lines of the table at the widest wrap. */
const MAX_LINE = 250;
const SCALES = [2, 1, 1 / 2, 1 / 3, 1 / 4, 1 / 6, 1 / 8, 1 / 12, 1 / 16];
/** A scale as a ratio of small whole numbers: 2:1, 1:4, 3:2. */
const scaleText = (s: number): string => {
  for (let d = 1; d <= 16; d++) { const n = s * d; if (Math.abs(n - Math.round(n)) < 1e-6) { const g = gcd(Math.round(n), d); return `${Math.round(n) / g}:${d / g}`; } }
  return s >= 1 ? `${Math.round(s)}:1` : `1:${Math.round(1 / s)}`;
};
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** Scales the thickness views may take when they are drawn at their own scale. */
const N_SCALES = [4, 3, 2, 3 / 2, 1, 3 / 4, 1 / 2, 1 / 3, 1 / 4, 1 / 6, 1 / 8, 1 / 12, 1 / 16];
/** Widest row of views (in) on the sheet. */
const ROW_W_IN = 9.2;

/** Push sorted label positions apart to at least `gap`, then pull them back toward their targets from the far end. */
function spread(targets: number[], gap: number): number[] {
  const out = [...targets];
  for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1] + gap) out[i] = out[i - 1] + gap;
  for (let i = out.length - 2; i >= 0; i--) if (out[i] > out[i + 1] - gap) out[i] = out[i + 1] - gap;
  return out;
}

/** Wrap a line of text to about `chars` characters. */
function wrap(s: string, chars: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of s.split(' ')) {
    if ((cur + ' ' + word).trim().length > chars && cur) { out.push(cur); cur = word; } else cur = (cur + ' ' + word).trim();
  }
  if (cur) out.push(cur);
  return out;
}

export interface PartDrawingSheet {
  partId: string;
  partNo: string;
  partIds: string[];
  qty: number;
  name: string;
  /** "MAKE 2: 1 as drawn (...), 1 MIRROR IMAGE (...)" and similar; empty for a single part. */
  makeNote: string;
  svg: string;
  widthIn: number;
  heightIn: number;
  scale: string;
  features: DrawingFeature[];
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const letterOf = (i: number): string => (i < LETTERS.length ? LETTERS[i] : `${LETTERS[Math.floor(i / LETTERS.length) - 1]}${LETTERS[i % LETTERS.length]}`);

/** The value and datum of one coordinate of a point: `{ val: '3-1/4"', datum: 'from the REAR end' }`; a centered thickness has no value. */
function coordParts(q: Vec3, k: Ax, a: Analysis): { val: string; datum: string } {
  const { board: b, words: w } = a;
  if (k === 0) return alongU(q[0], w);
  if (k === 1) return { val: frac(a.vref ? b.V - q[1] : q[1]), datum: `from the ${w.side[1][a.vref]}` };
  return Math.abs(q[2] - b.N / 2) < 0.02 ? { val: '', datum: 'centered across the thickness' } : { val: frac(b.N - q[2]), datum: `from the ${w.side[2][1]}` };
}

/**
 * The instance positions of a feature, in the two coordinates across its axis, in as few groups as read clearly. A set that is every combination of some stations and some heights is one
 * grid line; otherwise the points are grouped by whichever coordinate they share most: `3", 10-1/8" and 36-3/16" from the REAR end, 3/4" from the TOP edge`.
 */
function placeGroups(pts: Vec3[], ax: Ax, a: Analysis): string[] {
  const ks = ([0, 1, 2] as Ax[]).filter((k) => k !== ax);
  const key = (q: Vec3, k: Ax): string => { const c = coordParts(q, k, a); return c.val ? `${c.val} ${c.datum}` : c.datum; };
  const distinct = (k: Ax): string[] => [...new Set(pts.map((q) => key(q, k)))];
  const [d0, d1] = [distinct(ks[0]), distinct(ks[1])];
  const valsOf = (qs: Vec3[], k: Ax): string[] => [...new Set(qs.map((q) => coordParts(q, k, a).val))].filter(Boolean);
  const datumOf = (q: Vec3, k: Ax): string => coordParts(q, k, a).datum;
  if (pts.length > 2 && d0.length > 1 && d1.length > 1 && d0.length * d1.length === pts.length && coordParts(pts[0], ks[1], a).val) {
    const sorted = (k: Ax): Vec3[] => [...pts].sort((x, y) => x[k] - y[k]);
    return [`${d0.length} columns × ${d1.length} rows: ${listOf(valsOf(sorted(ks[0]), ks[0]))} ${datumOf(pts[0], ks[0])}, ${listOf(valsOf(sorted(ks[1]), ks[1]))} ${datumOf(pts[0], ks[1])}`];
  }
  // group by the second coordinate (listing the first), or the other way round when that makes fewer groups
  const [first, second] = d1.length > d0.length && coordParts(pts[0], ks[0], a).val ? [ks[1], ks[0]] : [ks[0], ks[1]];
  const groups = new Map<string, Vec3[]>();
  for (const q of [...pts].sort((x, y) => x[first] - y[first])) {
    const g = key(q, second);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(q);
  }
  return [...groups.entries()].map(([g, qs]) => {
    const firsts = qs.map((q) => coordParts(q, first, a));
    if (!firsts.some((c) => c.val)) return `${firsts[0].datum}, ${g}`;
    // a point centered on the datum axis has no value: name it, never leave a gap in the list (`2-3/32", centered and 13/32"`)
    return `${listOf(firsts.map((c) => c.val || 'centered'))} ${firsts.find((c) => c.val)!.datum}, ${g}`;
  });
}

/** Where the boxes of a dado, notch, groove or slot lie: one `a to b` span per box on each axis across the face, boxes with the same second span listed together. */
function spanGroups(boxes: Array<[Vec3, Vec3]>, face: { ax: Ax; hi: boolean } | undefined, a: Analysis): string[] {
  const { board: b, words: w } = a;
  const ext = EXT(b);
  const ks = ([0, 1, 2] as Ax[]).filter((k) => !face || k !== face.ax);
  const spanOf = (lo: Vec3, hi: Vec3, k: Ax): { val: string; datum: string } => {
    const sz = hi[k] - lo[k];
    if (sz > ext[k] - 0.02) return { val: k === 0 ? 'the full length' : k === 1 ? 'the full height' : 'through the thickness', datum: '' };
    if (k === 0) return { val: `${frac(lo[0])} to ${frac(hi[0])}`, datum: `from the ${w.side[0][0]}` };
    if (k === 1) return a.vref ? { val: `${frac(ext[1] - hi[1])} to ${frac(ext[1] - lo[1])}`, datum: `from the ${w.side[1][1]}` } : { val: `${frac(lo[1])} to ${frac(hi[1])}`, datum: `from the ${w.side[1][0]}` };
    const c = (lo[2] + hi[2]) / 2;
    return Math.abs(c - ext[2] / 2) < 0.02 ? { val: 'centered across the thickness', datum: '' } : { val: `${frac(ext[2] - hi[2])} to ${frac(ext[2] - lo[2])}`, datum: `from the ${w.side[2][1]}` };
  };
  const word = (x: { val: string; datum: string }): string => (x.datum ? `${x.val} ${x.datum}` : x.val);
  if (ks.length < 2 || boxes.length === 1) return boxes.map(([lo, hi]) => ks.map((k) => word(spanOf(lo, hi, k))).join(', '));
  const groups = new Map<string, Array<{ val: string; datum: string }>>();
  for (const [lo, hi] of boxes) {
    const g = word(spanOf(lo, hi, ks[1]));
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(spanOf(lo, hi, ks[0]));
  }
  return [...groups.entries()].map(([g, xs]) => `${listOf(xs.map((x) => x.val))}${xs[0].datum ? ` ${xs[0].datum}` : ''}, ${g}`);
}

/** The same positions as `x / y` pairs under one heading, for a feature whose points do not line up (the line is shorter than the grouped words). */
function placePairs(pts: Vec3[], ax: Ax, a: Analysis): string {
  const ks = ([0, 1, 2] as Ax[]).filter((k) => k !== ax);
  const sorted = [...pts].sort((x, y) => x[ks[0]] - y[ks[0]]);
  const c0 = coordParts(sorted[0], ks[0], a), c1 = coordParts(sorted[0], ks[1], a);
  // A datum that is not one end (the center line of a scribed member: "toward the LEFT end from the center line") cannot head a column: each point says its own.
  const own = (q: Vec3): string => ks.map((k) => { const c = coordParts(q, k, a); return c.val ? `${c.val} ${c.datum}` : c.datum; }).join(', ');
  const same = sorted.every((q) => coordParts(q, ks[0], a).datum === c0.datum);
  if (same && c0.val && !/^from the /.test(c0.datum) && (!c1.val || /^from the /.test(c1.datum))) // one side of a center line: "toward the LEFT end from the center line / the REAR face: 9-9/32" / 3/8", ..."
    return `${c0.datum} / the ${c1.val ? c1.datum.replace(/^from the /, '') : 'centered across the thickness'}: ${sorted.map((q) => `${coordParts(q, ks[0], a).val} / ${coordParts(q, ks[1], a).val || 'centered'}`).join(', ')}`;
  if (!/^from the /.test(c0.datum) || (c1.val && !/^from the /.test(c1.datum))) return sorted.map(own).join('; ');
  return `from the ${c0.datum.replace(/^from the /, '')} / the ${c1.val ? c1.datum.replace(/^from the /, '') : 'centered across the thickness'}: ${sorted.map((q) => `${coordParts(q, ks[0], a).val} / ${coordParts(q, ks[1], a).val || 'centered'}`).join(', ')}`;
}

/** "for the chine band", "for the crossmembers": what a feature is for, from the parts it serves. */
function purposeFor(ids: string[], a: Analysis): string {
  if (!ids.length) return '';
  const base = (n: string): string => n.replace(/^(left|right) /, '').replace(/ \d+$/, '').replace(/ \((outer|inner)\)$/, '');
  const bases = [...new Set(ids.map((id) => base(a.nameOf(id))))];
  const many = ids.length > bases.length || ids.length > 1;
  return `for the ${listOf(bases.map((n) => (many && bases.length === 1 && !/s$/.test(n) ? plural(n, 2) : n)))}`;
}

interface Mark { u: number; letter?: string }

/**
 * LAYERS block of a cross-laminated part (the brake knee, D-75): an edge view of the stack (layer lines, the grain of each layer) and a face view of what each layer is cut as (its boards,
 * the off-center edge joint), at a small scale. Every size is the cut list's. Null when the part's layers all run the same way. `y0` is the top of the block; `h` is its height.
 */
function layersBlock(part: Part, cl: CutList, x0: number, y0: number, face: string): { svg: string; h: number } | null {
  const row = cl.oak.flatMap((g) => g.rows).find((r) => r.ids.includes(part.id));
  const lps = row?.layerPieces ?? [];
  if (new Set(lps.map((q) => q.grainWord)).size < 2) return null;
  const cuts = cl.cuts.filter((c) => c.piece === 'layer' && c.ids.includes(part.id));
  const layers = lps.map((lp) => {
    const mine = cuts.filter((c) => c.layer === lp.layer).sort((a, b) => a.index - b.index);
    const widths = mine.map((c) => c.rough.w);
    const upright = lp.grainWord === 'upright';
    const across = widths.reduce((a, b) => a + b, 0), along = mine[0]?.rough.l ?? lp.lengthIn;
    // Seen from the rear face: horizontal is across the sled, vertical is up the leg.
    return { n: lp.layer, grain: lp.grainWord ?? '', widths, upright, hz: upright ? across : along, vt: upright ? along : across, t: lp.roughT, same: `${lp.grainWord}|${widths.join()}|${along}` };
  });
  const maxH = Math.max(...layers.map((q) => q.hz)), maxV = Math.max(...layers.map((q) => q.vt));
  const joint = part.stock ? edgeJointUp(part, part.stock.w) : undefined;
  const kinds: typeof layers = [];
  for (const q of layers) if (!kinds.some((z) => z.same === q.same)) kinds.push(q);
  // The edge view and the face views sit side by side: the largest scale at which they all fit across the sheet (8.2" less margins) and the tallest layer fits 4".
  const gapOf = (q: { widths: number[] }): number => (q.widths.length > 1 && joint !== undefined ? 1.55 : 0.6);
  const slotW = (z: { hz: number; widths: number[] }, q: number): number => Math.max(z.hz * q + gapOf(z), 2.35); // a face view's heading ("LAYERS 1 and 3, from the rear face") is about 2.3" wide
  const needW = (q: number): number => maxH * q + 0.45 + kinds.reduce((a, z) => a + slotW(z, q), 0);
  const k = [1 / 3, 1 / 4, 1 / 6, 1 / 8].find((q) => needW(q) <= 7.4 && maxV * q <= 4) ?? 1 / 8;
  const o: string[] = [];
  const top = y0 + 0.3;
  o.push(txt(x0, y0 + 0.12, `LAYERS: how the block is laminated (layer 1 is the ${face}; sketch at ${scaleText(k)}, the layers 2x thicker than that)`, 0.12, { bold: true }));
  const arrow = (a0: Vec2, a1: Vec2): string => {
    const d: Vec2 = [Math.sign(a1[0] - a0[0]), Math.sign(a1[1] - a0[1])];
    return line(a0, a1, GRAIN, 0.012) + line(a1, [a1[0] - d[0] * 0.08 - d[1] * 0.04, a1[1] - d[1] * 0.08 + d[0] * 0.04], GRAIN, 0.012) + line(a1, [a1[0] - d[0] * 0.08 + d[1] * 0.04, a1[1] - d[1] * 0.08 - d[0] * 0.04], GRAIN, 0.012);
  };
  // Edge view (seen from the top end): the layers stacked, rear layer on top, each as wide as it is across the sled.
  const thk = (q: { t: number }): number => q.t * k * 2;
  const eW = maxH * k, ex = x0, cx = ex + eW / 2;
  o.push(txt(ex, top + 0.05, 'EDGE VIEW, from the TOP end', 0.1, { bold: true }));
  let ey = top + 0.18;
  for (const q of layers) {
    const w = q.hz * k, h = thk(q);
    o.push(polyEl([[cx - w / 2, ey], [cx + w / 2, ey], [cx + w / 2, ey + h], [cx - w / 2, ey + h]], INK, 0.014, WOOD));
    o.push(txt(cx - w / 2 + 0.06, ey + h / 2 + 0.035, `${q.n}  ${q.upright ? 'upright' : 'across the sled'}`, 0.095));
    if (q.upright) o.push(ellipse([cx + w / 2 - 0.2, ey + h / 2], 0.07, 0.07, GRAIN, 0.012), ellipse([cx + w / 2 - 0.2, ey + h / 2], 0.015, 0.015, GRAIN, 0.01, '', GRAIN));
    else o.push(arrow([cx + w / 2 - 0.55, ey + h / 2], [cx + w / 2 - 0.1, ey + h / 2]));
    ey += h;
  }
  o.push(txt(ex, ey + 0.17, 'Layer lines are glue lines.', 0.085, { fill: HID }), txt(ex, ey + 0.28, 'The dot is grain running toward you.', 0.085, { fill: HID }));
  const edgeBottom = ey + 0.36;
  // Face views (seen from the rear face): one rectangle per distinct layer.
  let fx = ex + eW + 0.45;
  const mid = top + 0.18 + maxV * k / 2;
  let bottom = edgeBottom;
  for (const q of kinds) {
    const same = layers.filter((z) => z.same === q.same).map((z) => z.n);
    const w = q.hz * k, h = q.vt * k, y1 = mid - h / 2;
    o.push(txt(fx, top + 0.05, `LAYER${same.length > 1 ? 'S' : ''} ${same.join(' and ')}, from the rear face`, 0.1, { bold: true }));
    o.push(polyEl([[fx, y1 + 0.18], [fx + w, y1 + 0.18], [fx + w, y1 + 0.18 + h], [fx, y1 + 0.18 + h]], INK, 0.014, WOOD));
    const yb = y1 + 0.18 + h;
    if (q.upright) o.push(arrow([fx + w / 2, yb - h * 0.2], [fx + w / 2, yb - h * 0.8]), txt(fx + w / 2 + 0.06, yb - h * 0.5, 'grain up the leg', 0.085, { fill: GRAIN }));
    else o.push(arrow([fx + w * 0.2, yb - h * 0.94], [fx + w * 0.8, yb - h * 0.94]), txt(fx + w / 2, yb - h * 0.94 - 0.06, 'grain across the sled', 0.085, { anchor: 'middle', fill: GRAIN }));
    if (q.widths.length > 1) {
      let yy = yb;
      q.widths.forEach((bw, i) => {
        const hh = bw * k;
        if (i > 0) o.push(line([fx, yy], [fx + w, yy], FEAT, 0.014));
        o.push(txt(fx + 0.06, yy - hh / 2 + 0.035, `board ${i + 1}${i === 0 ? ' (bottom edge)' : ' (top)'}: ${frac(bw)} wide`, 0.09, { fill: INK }));
        yy -= hh;
      });
      if (joint !== undefined) {
        const jy = yb - q.widths[0] * k;
        o.push(txt(fx + w + 0.08, jy + 0.035, `edge joint: ${frac(joint)} up from`, 0.09, { fill: FEAT, bold: true }), txt(fx + w + 0.08, jy + 0.14, 'the finished bottom edge', 0.09, { fill: FEAT, bold: true }));
        const fy = yb - Math.max(0, q.widths[0] - joint) * k;
        o.push(line([fx - 0.08, fy], [fx + w + 0.04, fy], DIM, 0.008, DASH), txt(fx - 0.1, fy + 0.03, 'finished bottom edge', 0.075, { anchor: 'end', fill: DIM }));
      }
    } else if (w < 2) o.push(txt(fx, yb + 0.28, `ONE piece, ${frac(q.widths[0])} wide across its grain`, 0.085, { fill: INK })); // too narrow to hold the words: they go under the sizes
    else o.push(txt(fx + 0.06, yb - 0.06, `ONE piece, ${frac(q.widths[0])} wide across its grain`, 0.085, { fill: INK }));
    o.push(txt(fx, yb + 0.15, `${frac(q.hz)} across the sled \u00d7 ${frac(q.vt)} up the leg`, 0.09, { fill: DIM }));
    bottom = Math.max(bottom, yb + (q.widths.length === 1 && w < 2 ? 0.36 : 0.22));
    fx += slotW(q, k);
  }
  return { svg: `<g id="layers">${o.join('')}</g>`, h: bottom - y0 + 0.1 };
}

function renderSheet(a: Analysis, qty: number, makeNote: string, p: Params, cl: CutList, title?: string): { svg: string; W: number; H: number; scale: string; features: DrawingFeature[] } {
  const { part, board: b, words: w } = a;
  const ext = EXT(b);
  const uid = `pd${hash6(part.id)}`;
  const holeAx = (f: HoleF): Ax => dominant(f.axis);
  const oblique = (f: HoleF): boolean => Math.abs(f.axis[holeAx(f)]) < 0.97;
  /** The face a hole is seen from: its entry face, or for a through hole the end of its run that is on the outside of the part (a hole through the head of a T is seen from the head's end). */
  const entryOf = (f: HoleF): boolean => {
    if (f.entryHi !== undefined) return f.entryHi;
    const ax = holeAx(f);
    if (ax === 2) return true;
    const sp = throughSpan(b, f.pts[0], ax);
    const atLo = sp[0] < 0.02, atHi = sp[1] > ext[ax] - 0.02;
    return atHi || !atLo;
  };

  // Views needed besides the main one: the top or bottom edge (looking along v) and the end views (looking along u).
  const need = { top: false, bottom: false, endL: false, endR: false };
  for (const f of a.feats) {
    if (f.k === 'hole' && !oblique(f)) {
      const ax = holeAx(f), hiSide = entryOf(f);
      if (ax === 1) { if (hiSide) need.top = true; else need.bottom = true; }
      if (ax === 0) { if (hiSide) need.endR = true; else need.endL = true; }
    }
    if (f.k === 'region' && f.face) {
      if (f.face.ax === 1) { if (f.face.hi) need.top = true; else need.bottom = true; }
      if (f.face.ax === 0) { if (f.face.hi) need.endR = true; else need.endL = true; }
    }
    if (f.k === 'region' && f.kind === 'rabbet') need.endR = true;
  }
  if (!b.rod && (part.kind === 'lumber' || part.kind === 'bentlam' || part.kind === 'metal')) { if (!need.top && !need.bottom) need.top = true; if (!need.endL && !need.endR) need.endR = true; }

  // Scale and rows: a long part with many features is split into 2 rows (3 if very long) so the scale stays readable.
  const nFeat = a.feats.filter((f) => f.k !== 'note').reduce((s, f) => s + (f.k === 'hole' ? f.pts.length : f.k === 'region' ? f.boxes.length : 1), 0);
  const rowsMax = nFeat > 8 ? (ext[0] > 90 ? 3 : 2) : 1;
  const endsW = (need.endL ? 1 : 0) + (need.endR ? 1 : 0);
  const fit = (maxRows: number): { s: number; rows: number } => {
    for (const k of SCALES) {
      const nW0 = Math.min(Math.max(ext[2] * k, 0.3), 2.4);
      const r = Math.ceil((ext[0] * k) / (ROW_W_IN - endsW * (nW0 + 0.5)) - 1e-9);
      if (r <= maxRows && ext[1] * k <= 3.6) return { s: k, rows: Math.max(1, r) };
    }
    return { s: SCALES[SCALES.length - 1], rows: 1 };
  };
  // One row when it is readable at 1:4 or better; otherwise rows at the largest scale.
  const one = fit(1);
  const { s, rows } = one.s >= 1 / 4 || rowsMax === 1 ? one : fit(rowsMax);
  // The thickness in the edge and end views: enlarged when thin (to 0.3" on paper, at most 4x), shortened when it is the part's long side (2.4" at most).
  const N0 = Math.max(ext[2], 1e-6);
  const nS = N0 * s < 0.2 ? N_SCALES.find((k) => k <= Math.min(0.3 / N0, 4 * s)) ?? s : N0 * s > 4 ? N_SCALES.find((k) => k * N0 <= 3) ?? s : s;
  const nNote = Math.abs(nS - s) > s * 0.01;
  const nW = ext[2] * nS;
  const winLen = ext[0] / rows, OV = rows > 1 ? Math.min(1, winLen * 0.05) : 0;
  const wins = Array.from({ length: rows }, (_, k) => [Math.max(0, k * winLen - OV), Math.min(ext[0], (k + 1) * winLen + OV)] as [number, number]);

  // ── Geometry to draw, in board coordinates, per view ──
  type Op = { kind: 'poly'; pts: Vec2[]; stroke: string; w: number; fill: string; dash: string; clip?: boolean } | { kind: 'ell'; c: Vec2; rx: number; ry: number; stroke: string; dash: string; cross: boolean } | { kind: 'line'; a: Vec2; c: Vec2; stroke: string; w: number; dash: string };
  const ops: Record<'main' | 'top' | 'bottom' | 'endL' | 'endR', Op[]> = { main: [], top: [], bottom: [], endL: [], endR: [] };
  const balloons: Array<{ letter: string; view: keyof typeof ops; at: Vec2 }> = [];
  const uMarks: Mark[] = [{ u: 0 }, { u: ext[0] }];
  const vMarks: number[] = [0, ext[1]];
  const nMarks: Record<'top' | 'bottom', number[]> = { top: [], bottom: [] };
  const feats: DrawingFeature[] = [];
  const P = (pts: Vec2[], stroke: string, wd: number, fill = 'none', dash = ''): Extract<Op, { kind: 'poly' }> => ({ kind: 'poly', pts, stroke, w: wd, fill, dash });

  ops.main.push(P(b.main, INK, 0.018, WOOD));
  const vs = b.main.map((q) => q[1]);
  const v0 = Math.min(...vs), v1 = Math.max(...vs);
  if (need.top) ops.top.push(P([[0, 0], [ext[0], 0], [ext[0], ext[2]], [0, ext[2]]], INK, 0.016, WOOD));
  if (need.bottom) ops.bottom.push(P([[0, 0], [ext[0], 0], [ext[0], ext[2]], [0, ext[2]]], INK, 0.016, WOOD));
  for (const e of ['endL', 'endR'] as const) {
    if (!need[e]) continue;
    ops[e].push(P([[0, v0], [ext[2], v0], [ext[2], v1], [0, v1]], INK, 0.016, WOOD));
    const sp = spanAt(b, e === 'endR' ? ext[0] - 0.01 : 0.01);
    if (sp[1] - sp[0] < v1 - v0 - 0.02) ops[e].push(P([[0, sp[0]], [ext[2], sp[0]], [ext[2], sp[1]], [0, sp[1]]], INK, 0.01, '#e8dcc4'));
  }

  // Grain.
  // A cross-laminated part has no one grain (`Part.grain` is its center layer's): the arrow and the line follow the FACE layers, and the line names the center layer too.
  const lgAxes = layerGrainOf(part);
  const crossLine = lgAxes && lgAxes.length > 1 && !b.rod ? crossGrainLine(part, b, ext) : undefined;
  const grainAx = (lgAxes?.[0] ?? part.grain) && !b.rod ? dominant(b.dirToBoard(unitAx({ x: 0, y: 1, z: 2 }[(lgAxes?.[0] ?? part.grain) as 'x' | 'y' | 'z'] as Ax)).map(Math.abs) as Vec3) : null;
  // The grain word is the cut list's (L is the stock length, W its width), so the drawing and the cut list agree; the view direction and the drawn size follow in brackets.
  const gWord = grainInWords(part);
  const discGrain = b.rod && part.kind === 'lumber' && part.geometry.type === 'cylinder' && part.geometry.length < 2 * part.geometry.radius;
  const grainWords = crossLine ? crossLine : discGrain ? 'across the disc, in its faces (cut from the face of a board)' : grainAx === null ? (part.kind === 'metal' ? 'n/a (metal)' : part.kind === 'purchased' ? 'n/a' : 'not specified')
    : grainAx === 2 && ext[2] >= Math.max(ext[0], ext[1]) ? `along the ${frac(ext[2])} length (the main view is the cross-section)`
    : grainAx === 2 ? `through the thickness (${w.side[2][1]} to ${w.side[2][0]})`
      : `${gWord && !/vertical/.test(gWord) ? gWord : `along the ${grainAx === 0 ? 'length' : 'height'}`} (the ${b.developed && grainAx === 0 ? 'length along the curve' : `${frac(ext[grainAx])} side`}, ${grainAx === 0 ? 'horizontal' : 'vertical'} in the main view)`;

  let li = 0;
  const extraNotes: string[] = [];
  for (const f of a.feats.filter((x): x is OutlineF => x.k === 'outline')) {
    const letter = letterOf(li++);
    feats.push({ label: letter, text: f.text, kind: 'outline', count: 1, ...(f.size ? { size: lcDatum(f.size) } : {}), ...(f.positions ? { positions: f.positions.map(lcDatum) } : {}), ...(f.face ? { face: lcDatum(f.face) } : {}), ...(f.angleDeg !== undefined ? { angleDeg: f.angleDeg } : {}) });
    if (f.extra) extraNotes.push(f.extra);
    for (const q of f.marks) { uMarks.push({ u: q[0] }); vMarks.push(q[1]); ops.main.push({ kind: 'ell', c: q, rx: 0, ry: 0, stroke: FEAT, dash: '', cross: false }); }
    const c: Vec2 = f.anchor ?? (f.marks.length ? [f.marks.reduce((t, q) => t + q[0], 0) / f.marks.length, f.marks.reduce((t, q) => t + q[1], 0) / f.marks.length] : [ext[0] / 2, ext[1] / 2]);
    balloons.push({ letter, view: 'main', at: c });
  }
  const edgeView = (hiSide: boolean): 'top' | 'bottom' | null => (hiSide && need.top ? 'top' : !hiSide && need.bottom ? 'bottom' : need.top ? 'top' : need.bottom ? 'bottom' : null);
  const endView = (hiSide: boolean): 'endL' | 'endR' | null => (hiSide && need.endR ? 'endR' : !hiSide && need.endL ? 'endL' : need.endR ? 'endR' : need.endL ? 'endL' : null);
  for (const f of a.feats) {
    if (f.k === 'hole') {
      const letter = letterOf(li++);
      const ax = holeAx(f), hiSide = entryOf(f);
      const shown = f.uShift !== undefined ? f.pts.map((q): Vec3 => [q[0] + f.uShift!, q[1], q[2]]) : f.pts;
      const fixDatum = (g: string): string => (f.uShift !== undefined ? g.replace(`from the ${w.side[0][0]}`, 'from the inner face of the rear transom') : g);
      let where: string;
      let groups: string[] = [];
      if (oblique(f)) {
        const ang = (Math.atan2(Math.abs(f.axis[1]), Math.abs(f.axis[0])) * 180) / Math.PI;
        groups = f.pts.map((q) => `${uText(q[0], b, w)}, ${vText(q[1], b, w, a.vref)}, ${nText(q[2], b, w)}`);
        where = `Tilted ${deg(ang)} from the ${w.side[1][0]} line, square to the sloped face it enters. Mouth: ${groups.join('; ')}`;
        for (const q of f.pts) {
          const dl = f.blind ?? 1;
          const dir: Vec2 = [f.axis[0], f.axis[1]];
          const tip: Vec2 = [q[0] - dir[0] * dl, q[1] - dir[1] * dl];
          const t2: Vec2 = pointInPoly(tip, b.main) ? tip : [q[0] + dir[0] * dl, q[1] + dir[1] * dl];
          const nx = (-dir[1] * f.dia) / 2, ny = (dir[0] * f.dia) / 2;
          ops.main.push(P([[q[0] + nx, q[1] + ny], [t2[0] + nx, t2[1] + ny], [t2[0] - nx, t2[1] - ny], [q[0] - nx, q[1] - ny]], FEAT, 0.01, 'none', DASH));
          uMarks.push({ u: q[0] }); vMarks.push(q[1]);
        }
        balloons.push({ letter, view: 'main', at: [f.pts[0][0], f.pts[0][1]] });
      } else {
        groups = placeGroups(shown, ax, a).map(fixDatum);
        where = `In the ${f.faceWord ?? w.side[ax][hiSide ? 1 : 0]}: ${groups.join('; ')}`;
        // A round rod has no face, height or thickness to measure from: a cross hole is drilled through the diameter, and its place is the distance from a named end (the nearer end too, when that is the other one).
        if (b.rod && part.geometry.type === 'cylinder' && part.geometry.length < 2 * part.geometry.radius) where = 'Through the center of the disc, square to its faces';
        else if (b.rod) where = `Drilled straight through the rod, across its diameter, at ${listOf(f.pts.map((q) => `${frac(q[0])} from the ${w.side[0][0]}${q[0] > ext[0] / 2 ? ` (${frac(ext[0] - q[0])} from the ${w.side[0][1]})` : ''}`))}`;
        const vName = ax === 2 ? 'main' : ax === 1 ? edgeView(hiSide) : endView(hiSide);
        for (const q of f.pts) {
          if (vName) {
            const c: Vec2 = ax === 2 ? [q[0], q[1]] : ax === 1 ? [q[0], q[2]] : [q[2], q[1]];
            const r = f.dia / 2;
            ops[vName].push({ kind: 'ell', c, rx: r, ry: r, stroke: FEAT, dash: f.blind !== undefined && ((ax === 2 && !hiSide) || f.from !== undefined) ? DASH : '', cross: true });
            if (vName === 'top') nMarks.top.push(q[2]);
            if (vName === 'bottom') nMarks.bottom.push(q[2]);
          }
          if (ax !== 2) {
            // the hole's run seen from the side (hidden), in the main view
            const sp = throughSpan(b, q, ax);
            const e0 = f.from ?? (hiSide ? sp[1] : sp[0]);
            const d0 = f.blind !== undefined ? (hiSide ? e0 - f.blind : e0) : sp[0], d1 = f.blind !== undefined ? (hiSide ? e0 : e0 + f.blind) : sp[1];
            const hw = f.dia / 2;
            ops.main.push(P(ax === 1 ? [[q[0] - hw, d0], [q[0] + hw, d0], [q[0] + hw, d1], [q[0] - hw, d1]] : [[d0, q[1] - hw], [d1, q[1] - hw], [d1, q[1] + hw], [d0, q[1] + hw]], HID, 0.008, 'none', DASH));
          }
          if (ax !== 0) uMarks.push({ u: q[0] });
          if (ax !== 1) vMarks.push(q[1]);
        }
        const q0 = f.pts[0];
        balloons.push(vName ? { letter, view: vName, at: ax === 2 ? [q0[0], q0[1]] : ax === 1 ? [q0[0], q0[2]] : [q0[2], q0[1]] } : { letter, view: 'main', at: [q0[0], q0[1]] });
      }
      const nH = f.pts.length;
      const holeLine = (wh: string): string => `${nH} ${plural(f.noun, nH)}, ${f.size}. ${wh}. ${sentence(f.purpose)}.`;
      let line = holeLine(where);
      if (line.length > MAX_LINE && groups.length > 1 && !oblique(f)) line = holeLine(`In the ${f.faceWord ?? w.side[ax][hiSide ? 1 : 0]}: ${fixDatum(placePairs(shown, ax, a))}`);
      feats.push({ label: letter, text: line, kind: 'hole', to: f.to, joint: f.joint, count: nH, size: lcDatum(f.size), positions: groups.map(lcDatum), face: f.faceWord ? lcDatum(f.faceWord) : oblique(f) ? 'sloped face' : lcDatum(w.side[ax][hiSide ? 1 : 0]), purpose: f.purpose });
    } else if (f.k === 'region') {
      const letter = letterOf(li++);
      const face = f.face;
      for (const [lo, hi] of f.boxes) {
        const vis = hi[2] > ext[2] - 0.01;
        const fillV = vis && f.kind !== 'notch' ? 'rgba(179,38,30,0.14)' : 'none';
        ops.main.push({ ...P([[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]], vis ? FEAT : HID, 0.01, fillV, vis ? '' : DASH), clip: true });
        for (const ev of ['top', 'bottom'] as const) if (need[ev] && (ev === 'top' ? hi[1] > ext[1] - 0.01 || (face?.ax === 1 && face.hi) : lo[1] < 0.01 || (face?.ax === 1 && !face.hi))) ops[ev].push(P([[lo[0], lo[2]], [hi[0], lo[2]], [hi[0], hi[2]], [lo[0], hi[2]]], FEAT, 0.01, 'rgba(179,38,30,0.14)'));
        for (const ev of ['endL', 'endR'] as const) if (need[ev] && (ev === 'endR' ? hi[0] > ext[0] - 0.01 : lo[0] < 0.01)) ops[ev].push(P([[lo[2], lo[1]], [hi[2], lo[1]], [hi[2], hi[1]], [lo[2], hi[1]]], FEAT, 0.01, 'rgba(179,38,30,0.14)'));
        const edges = f.kind === 'notch' || f.kind === 'dado' || f.kind === 'slot' || f.kind === 'groove';
        if (hi[0] - lo[0] < ext[0] - 0.02) { if (edges) uMarks.push({ u: lo[0] }, { u: hi[0] }); else uMarks.push({ u: (lo[0] + hi[0]) / 2 }); }
        if (!face || face.ax !== 1 || f.kind === 'notch' || f.kind === 'slot') { if (edges) vMarks.push(lo[1], hi[1]); else vMarks.push((lo[1] + hi[1]) / 2); }
        if (face?.ax === 1) nMarks[face.hi ? 'top' : 'bottom'].push((lo[2] + hi[2]) / 2);
      }
      const [lo0, hi0] = f.boxes[0];
      const c0: Vec3 = [(lo0[0] + hi0[0]) / 2, (lo0[1] + hi0[1]) / 2, (lo0[2] + hi0[2]) / 2];
      const fv = face && face.ax === 1 ? edgeView(face.hi) : face && face.ax === 0 ? endView(face.hi) : null;
      balloons.push(fv ? { letter, view: fv, at: face!.ax === 1 ? [c0[0], c0[2]] : [c0[2], c0[1]] } : { letter, view: 'main', at: [c0[0], c0[1]] });
      const centered = f.kind === 'mortise' || f.kind === 'tenon';
      const centers = f.boxes.map(([lo, hi]) => [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] as Vec3);
      const pos = centered ? placeGroups(centers, face ? face.ax : 2, a) : spanGroups(f.boxes, face, a);
      const nR = f.boxes.length, faceW = face ? w.side[face.ax][face.hi ? 1 : 0] : '';
      const purpose = f.purpose ?? purposeFor(f.to, a);
      const regionLine = (posText: string): string => `${nR} ${plural(f.noun, nR)}, ${f.detail}. ${faceW ? `In the ${faceW}: ` : ''}${faceW ? posText : sentence(posText)}. ${sentence(purpose)}${purpose ? '.' : ''}`.replace(/\s+\.$/, '').trim();
      let rline = regionLine(pos.join('; '));
      if (rline.length > MAX_LINE && centered && pos.length > 1) rline = regionLine(placePairs(centers, face ? face.ax : 2, a));
      feats.push({ label: letter, text: rline, kind: f.kind, to: f.to, joint: f.joint, count: nR, size: lcDatum(f.detail), positions: pos.map(lcDatum), ...(faceW ? { face: lcDatum(faceW) } : {}), ...(purpose ? { purpose } : {}) });
    }
  }
  for (const f of a.feats) if (f.k === 'note') feats.push({ label: '-', text: f.text, kind: 'note', count: 1, ...(f.to ? { to: f.to } : {}), ...(f.joint ? { joint: f.joint } : {}) });

  // ── Layout (paper inches, y down) ──
  const M = 0.4, ORD_W = 0.95, ORD_H = 0.72, GAP = 0.5, LET = 0.32, ROWGAP = 0.35;
  const mainH = ext[1] * s;
  const xEndL = M;
  const xMain = M + (need.endL ? nW + GAP : 0) + ORD_W;
  const rowW = Math.max(...wins.map(([u0, u1]) => (u1 - u0) * s));
  const xEndR = xMain + rowW + GAP;
  const contentW = Math.max(xEndR + (need.endR ? nW + 0.5 : 0), xMain + rowW + 1.6) + M;
  const W = Math.max(contentW, 8.2);
  const chars = Math.floor((W - 2 * M - 0.3) / (0.52 * 0.105));
  // ── Title block ──
  const dims = [...ext].sort((x, z) => x - z);
  const tallBlock = !!part.stock && isTallBlock(part, part.stock);
  const hl: Array<{ t: string; size: number; bold?: boolean; fill?: string }> = [{ t: title ?? part.name, size: 0.2, bold: true }];
  const hw = (t: string, size: number, o: { bold?: boolean; fill?: string } = {}) => { for (const l of wrap(t, Math.floor(chars * 0.105 / size))) hl.push({ t: l, size, ...o }); };
  hw(`qty ${qty}   scale ${scaleText(s)}${rows > 1 ? ` (in ${rows} rows)` : ''}   final ${b.rod ? `${frac(b.rod.dia)} dia × ${frac(part.geometry.type === 'cylinder' ? part.geometry.length : ext[0])}` : finalText(part, cl, dims)}${b.rod || tallBlock ? '' : ` (T × W × L${b.developed ? ', L along the curve' : ''})`}   ${part.material}`, 0.12);
  hw(`Stock: ${boardText(part, cl)}`, 0.105);
  hw(`Grain: ${grainWords}.`, 0.105, { fill: DIM });
  hw(b.rod ? `Datums: lengths from the ${w.side[0][0]}. Fractions to 1/32", drills to 1/64".` : `Datums: lengths from the ${w.center !== undefined ? 'CENTER LINE (the ends are scribed)' : w.side[0][0]}, heights from the ${w.side[1][a.vref]}, across from the ${w.side[2][1]}. Fractions to 1/32", drills to 1/64".`, 0.105, { fill: DIM });
  if (makeNote) hw(makeNote, 0.12, { bold: true, fill: FEAT });
  const head: string[] = [];
  let hy = M + 0.05;
  for (const l of hl) { hy += l.size * 1.45; head.push(txt(M, hy, l.t, l.size, { bold: l.bold, fill: l.fill })); }
  const titleH = hy - M + 0.1;
  const topBlock = need.top ? 0.42 + nW + 0.2 : 0;
  const botBlock = need.bottom ? 0.3 + nW + 0.15 : 0;
  const rowH = topBlock + LET + mainH + ORD_H + botBlock;
  const yRows0 = M + titleH + 0.15;
  const out: string[] = [];
  const uniq = (vals: number[], tol = 1 / 32): number[] => [...vals].sort((x, z) => x - z).filter((x, i, arr) => i === 0 || x - arr[i - 1] > tol);

  const drawOps = (list: Op[], map: (q: Vec2) => Vec2, sx: number, sy: number): string => list.map((o) => {
    if (o.kind === 'poly') return polyEl(o.pts.map(map), o.stroke, o.w, o.fill, o.dash);
    if (o.kind === 'line') return line(map(o.a), map(o.c), o.stroke, o.w, o.dash);
    const c = map(o.c);
    if (o.rx === 0) return ellipse(c, 0.018, 0.018, o.stroke, 0.008, '', o.stroke);
    const rx = Math.max(0.02, o.rx * sx), ry = Math.max(0.02, o.ry * sy);
    return ellipse(c, rx, ry, o.stroke, 0.012, o.dash) + (o.cross ? line([c[0] - rx - 0.04, c[1]], [c[0] + rx + 0.04, c[1]], o.stroke, 0.006) + line([c[0], c[1] - ry - 0.04], [c[0], c[1] + ry + 0.04], o.stroke, 0.006) : '');
  }).join('');

  wins.forEach(([ua, ub], ri) => {
    const y0 = yRows0 + ri * (rowH + ROWGAP);
    const yTop = y0 + 0.42, yLet = y0 + topBlock, yMain = yLet + LET, yOrd = yMain + mainH + 0.04, yBot = yOrd + ORD_H + 0.3;
    const X = (u: number): number => xMain + (u - ua) * s;
    const mainMap = (q: Vec2): Vec2 => [X(q[0]), yMain + mainH - q[1] * s];
    const topMap = (q: Vec2): Vec2 => [X(q[0]), yTop + q[1] * nS]; // seen from the top: the near (n = N) face is next to the main view, below
    const botMap = (q: Vec2): Vec2 => [X(q[0]), yBot + (ext[2] - q[1]) * nS]; // seen from the bottom: the near face on top
    const inWin = (u: number): boolean => u >= ua - 1e-6 && u <= ub + 1e-6;
    const clip = `${uid}r${ri}`;
    const cx0 = X(ua) - (ua > 0 ? 0 : 0.05), cx1 = X(ub) + (ub < ext[0] ? 0 : 0.05);
    out.push(`<clipPath id="${clip}"><rect x="${fmt(cx0)}" y="${fmt(y0)}" width="${fmt(cx1 - cx0)}" height="${fmt(rowH)}"/></clipPath>`);
    const g: string[] = [];
    const oclip = `${uid}o${ri}`;
    out.push(`<clipPath id="${oclip}"><path d="${b.main.map((q, i) => `${i ? 'L' : 'M'}${fmt(mainMap(q)[0])},${fmt(mainMap(q)[1])}`).join('')}Z"/></clipPath>`);
    g.push(drawOps(ops.main.filter((o) => !(o.kind === 'poly' && o.clip)), mainMap, s, s));
    g.push(`<g clip-path="url(#${oclip})">${drawOps(ops.main.filter((o) => o.kind === 'poly' && o.clip), mainMap, s, s)}</g>`);
    if (need.top) g.push(drawOps(ops.top, topMap, s, nS));
    if (need.bottom) g.push(drawOps(ops.bottom, botMap, s, nS));
    // grain arrow, once per row, mid-window
    if (grainAx !== null && grainAx !== 2) {
      const um = (ua + ub) / 2, c = mainMap([um, ext[1] / 2]);
      const L = Math.min(1.1, (grainAx === 0 ? (ub - ua) * s : mainH) * 0.45);
      const d: Vec2 = grainAx === 0 ? [1, 0] : [0, -1];
      const a0: Vec2 = [c[0] - (d[0] * L) / 2, c[1] - (d[1] * L) / 2], a1: Vec2 = [c[0] + (d[0] * L) / 2, c[1] + (d[1] * L) / 2];
      g.push(line(a0, a1, GRAIN, 0.012), line(a1, [a1[0] - d[0] * 0.08 - d[1] * 0.04, a1[1] - d[1] * 0.08 + d[0] * 0.04], GRAIN, 0.012), line(a1, [a1[0] - d[0] * 0.08 + d[1] * 0.04, a1[1] - d[1] * 0.08 - d[0] * 0.04], GRAIN, 0.012));
      g.push(txt(a0[0], a0[1] - 0.04, 'GRAIN', 0.08, { fill: GRAIN }));
    }
    out.push(`<g clip-path="url(#${clip})">${g.join('')}</g>`);
    // break marks where the row is cut
    if (ua > 0) out.push(line([X(ua), yMain - 0.08], [X(ua), yMain + mainH + 0.08], HID, 0.012, '0.08 0.04'), txt(X(ua) + 0.04, yMain - 0.04, `◂ continued from row ${ri}`, 0.08, { fill: HID }));
    if (ub < ext[0]) out.push(line([X(ub), yMain - 0.08], [X(ub), yMain + mainH + 0.08], HID, 0.012, '0.08 0.04'), txt(X(ub) - 0.04, yMain - 0.04, `continued in row ${ri + 2} ▸`, 0.08, { fill: HID, anchor: 'end' }));
    // view titles
    out.push(txt(xMain, yLet + 0.02, ri === 0 ? `MAIN VIEW, seen from the ${w.side[2][1]}${b.developed ? ' (developed: lengths measured along the bent member)' : ''}` : `MAIN VIEW, row ${ri + 1}`, 0.1, { bold: true }));
    const nWord = nNote ? (nS > s ? ' (thickness enlarged)' : ` (across at ${scaleText(nS)})`) : '';
    if (need.top) out.push(txt(xMain, yTop - 0.24, `seen from the ${w.side[1][1]}${nWord}; across: from the ${w.side[2][1]}`, 0.1, { bold: true }));
    if (need.bottom) out.push(txt(xMain, yBot - 0.07, `seen from the ${w.side[1][0]}${nWord}; across: from the ${w.side[2][1]}`, 0.1, { bold: true }));
    // balloons: main-view ones in a row above the view with leaders, edge-view ones beside their point
    const mb = balloons.filter((q) => q.view === 'main' && inWin(q.at[0])).sort((x, z) => x.at[0] - z.at[0]);
    const bx = spread(mb.map((q) => Math.max(X(ua) + 0.1, X(q.at[0]))), 0.22);
    mb.forEach((q, i) => { const by = yLet + LET * 0.62; out.push(line([bx[i], by + 0.085], mainMap(q.at), FEAT, 0.006), balloon([bx[i], by], q.letter)); });
    for (const ev of ['top', 'bottom'] as const) {
      const eb = balloons.filter((q) => q.view === ev && inWin(q.at[0])).sort((x, z) => x.at[0] - z.at[0]);
      const ex = spread(eb.map((q) => X(q.at[0]) + 0.16), 0.2);
      eb.forEach((q, i) => { const pt = (ev === 'top' ? topMap : botMap)(q.at); const by = ev === 'top' ? yTop - 0.1 : yBot + nW + 0.14; out.push(line([ex[i], by + (ev === 'top' ? 0.085 : -0.085)], pt, FEAT, 0.006), balloon([ex[i], by], q.letter)); });
    }
    // u ordinates (vertical labels, from the u datum)
    // A scribed member's ordinates run both ways from its center line (CL), like its feature table.
    const uVals = uniq([...uMarks.map((m2) => m2.u), ...(w.center !== undefined ? [w.center] : [])].filter((u) => u >= -0.01 && u <= ext[0] + 0.01 && inWin(u)));
    const uPos = spread(uVals.map(X), 0.125);
    out.push(line([X(Math.max(ua, 0)), yOrd + 0.08], [X(Math.min(ub, ext[0])), yOrd + 0.08], DIM, 0.008));
    uVals.forEach((u, i) => {
      const x = X(u);
      out.push(line([x, yMain + mainH + 0.015], [x, yOrd + 0.08], DIM, 0.005), line([x, yOrd + 0.08], [uPos[i], yOrd + 0.18], DIM, 0.005));
      const uLabel = w.center !== undefined ? (Math.abs(u - w.center) < 1 / 64 ? 'CL' : frac(Math.abs(u - w.center))) : u < 1e-6 ? `0 ${w.side[0][0].split(' ')[0]}` : frac(u);
      out.push(txt(uPos[i] + 0.034, yOrd + 0.22, uLabel, 0.095, { rot: 90, fill: DIM }));
    });
    // v ordinates (from the v datum), to the left of the main view
    const vVals = uniq(vMarks.filter((v) => v >= -0.01 && v <= ext[1] + 0.01).map((v) => (a.vref ? ext[1] - v : v)), 1 / 32);
    const vY = (v: number): number => (a.vref ? yMain + v * s : yMain + mainH - v * s);
    const order = [...vVals].sort((x, z) => vY(x) - vY(z));
    const vPos = spread(order.map(vY), 0.12);
    const xo = xMain - 0.08;
    out.push(line([xo, yMain], [xo, yMain + mainH], DIM, 0.008));
    order.forEach((v, i) => {
      out.push(line([xMain - 0.015, vY(v)], [xo, vY(v)], DIM, 0.005), line([xo, vY(v)], [xo - 0.1, vPos[i]], DIM, 0.005));
      out.push(txt(xo - 0.13, vPos[i] + 0.034, v < 1e-6 ? `0 ${w.side[1][a.vref].split(' ')[0]}` : frac(v), 0.095, { anchor: 'end', fill: DIM }));
    });
    // n ordinates in the top / bottom views (from the near face), and the thickness
    for (const ev of ['top', 'bottom'] as const) {
      if (!need[ev]) continue;
      const yv = ev === 'top' ? yTop : yBot;
      const ny = (n: number): number => (ev === 'top' ? yv + n * nS : yv + (ext[2] - n) * nS);
      out.push(line([xo, yv], [xo, yv + nW], DIM, 0.008), txt(xo - 0.5, yv + nW / 2 + 0.034, frac(ext[2]), 0.095, { anchor: 'end', fill: DIM }));
      const vals = uniq(nMarks[ev]).filter((n) => n > 0.01 && n < ext[2] - 0.01);
      const ord = [...vals].sort((x, z) => ny(x) - ny(z));
      const pos = spread(ord.map(ny), 0.11);
      ord.forEach((n, i) => out.push(line([xMain - 0.015, ny(n)], [xo, ny(n)], DIM, 0.005), line([xo, ny(n)], [xo - 0.08, pos[i]], DIM, 0.005), txt(xo - 0.1, pos[i] + 0.03, frac(ext[2] - n), 0.085, { anchor: 'end', fill: DIM })));
    }
    // end views beside the first (left) and the last (right) row
    const endMap = (e: 'endL' | 'endR', yM: number) => (q: Vec2): Vec2 => (e === 'endR' ? [xEndR + (ext[2] - q[0]) * nS, yM + mainH - q[1] * s] : [xEndL + q[0] * nS, yM + mainH - q[1] * s]);
    for (const e of ['endL', 'endR'] as const) {
      if (!need[e] || (e === 'endL' && ri !== 0) || (e === 'endR' && ri !== rows - 1)) continue;
      const mp = endMap(e, yMain);
      const x0 = e === 'endR' ? xEndR : xEndL;
      out.push(drawOps(ops[e], mp, nS, s));
      out.push(txt(x0, yMain - 0.12, `${w.side[0][e === 'endR' ? 1 : 0]}`, 0.095, { bold: true }));
      out.push(line([x0, yMain + mainH + 0.1], [x0 + nW, yMain + mainH + 0.1], DIM, 0.008), txt(x0 + nW / 2, yMain + mainH + 0.24, frac(ext[2]), 0.095, { anchor: 'middle', fill: DIM }));
      const eb = balloons.filter((q) => q.view === e);
      eb.forEach((q, i) => { const pt = mp(q.at); const bp: Vec2 = [x0 + nW + 0.18, yMain + 0.1 + i * 0.22]; out.push(line(bp, pt, FEAT, 0.006), balloon(bp, q.letter)); });
    }
  });

  void p;

  // ── Layers (a cross-laminated part): the stack, each layer's grain, its boards and the glue joint ──
  let ty = yRows0 + rows * (rowH + ROWGAP) + 0.15;
  const lay = layersBlock(part, cl, M, ty, w.side[2][1]);
  if (lay) { out.push(lay.svg); ty += lay.h + 0.1; }

  // ── Feature table ──
  const rowsSvg: string[] = [txt(M, ty, 'FEATURES (letters on the drawing; positions from the datums above)', 0.12, { bold: true })];
  ty += 0.2;
  const disc = b.rod && part.kind === 'lumber' && part.geometry.type === 'cylinder' && part.geometry.length < 2 * part.geometry.radius;
  if (disc && part.geometry.type === 'cylinder') {
    for (const l of wrap(`Make it: plane a strip to the thickness above, then cut each disc with a ${frac(discStrip(1, 2 * part.geometry.radius).sawIn)} hole saw (its plug comes out about ${frac(2 * part.geometry.radius)} across; check it on a scrap), from both faces of the strip. The saw's 1/4" pilot drill makes the center hole.`, chars)) { rowsSvg.push(txt(M + 0.25, ty, l, 0.105)); ty += 0.15; }
    ty += 0.05;
  }
  if (!feats.length) { rowsSvg.push(txt(M + 0.25, ty, b.rod ? 'None: cut to length, square the ends and break the edges (a light chamfer).' : 'None: a plain board, cut to the final size above.', 0.105)); ty += 0.2; }
  for (const f of feats) {
    rowsSvg.push(txt(M, ty, f.label, 0.11, { bold: true, fill: FEAT }));
    for (const l of wrap(f.text, chars)) { rowsSvg.push(txt(M + 0.25, ty, l, 0.105)); ty += 0.15; }
    ty += 0.04;
  }
  const notes = [...a.notes, ...extraNotes];
  if (nNote) notes.push(nS > s ? `The thickness in the edge and end views is drawn at ${scaleText(nS)} (enlarged) so the features in it can be seen.` : `The ${frac(ext[2])} across the edge and end views is drawn at ${scaleText(nS)} (shortened) so the sheet stays small.`);
  if (notes.length) {
    ty += 0.08; rowsSvg.push(txt(M, ty, 'NOTES', 0.12, { bold: true })); ty += 0.19;
    for (const n of notes) for (const l of wrap(n, chars + 4)) { rowsSvg.push(txt(M, ty, l, 0.1)); ty += 0.145; }
  }
  const H = ty + M;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}in" height="${fmt(H)}in" viewBox="0 0 ${fmt(W)} ${fmt(H)}">\n<title>${esc(`${plainName(part.name)} shop drawing`)}</title>\n<rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="#ffffff"/>\n<g id="title">${head.join('')}</g>\n<g id="views">${out.join('')}</g>\n<g id="features">${rowsSvg.join('')}</g>\n</svg>\n`;
  return { svg, W, H, scale: scaleText(s), features: feats };
}

// ── Sizes and boards come from the cut list, never from here ──

const cutListCache = new WeakMap<Part[], { p: Params; cl: CutList }>();
let defaultP: Params | undefined;
/**
 * What a group of identical parts is called on its drawing: the shared name, then what tells the members apart, as in "D-ring bearing plate (box, mid, bow post; left and right)".
 * The qualifiers are the comma-separated words after the first segment of each name (its roles), and the sides.
 */
export function describeGroup(names: readonly string[]): string {
  const base = groupedName(names);
  const roles: string[] = [], sides = new Set<string>();
  for (const n of names) {
    const segs = n.replace(/\s*\([^)]*\)\s*$/, '').split(/,\s*/);
    for (const sg of segs.slice(1)) {
      const t = sg.trim().toLowerCase();
      if (t === 'left' || t === 'right') sides.add(t); else if (t && !roles.includes(t) && !base.toLowerCase().includes(t)) roles.push(t); // a role the shared name already says is not said twice
    }
    const m = /\b(left|right)\b/i.exec(segs[0]) ?? /\s([LR])\d*$/.exec(segs[0]);
    if (m) sides.add(/^l/i.test(m[1]) ? 'left' : 'right');
  }
  const both = sides.size === 2 ? 'left and right' : [...sides].join('');
  const detail = [roles.join(', '), both].filter(Boolean).join('; ');
  return detail ? `${base} (${detail})` : base;
}

/** The cut list of a model, computed once per parts array and parameter set: every rough size and board a drawing prints is read from it (`cuts`, `glueUps`, `finished`). */
export function cutListFor(parts: Part[], p?: Params): CutList {
  const pp = p && typeof p.millingAllowanceIn === 'number' ? p : (defaultP ??= defaultParams());
  const hit = cutListCache.get(parts);
  if (hit && hit.p === pp) return hit.cl;
  const cl = cutList(parts, pp);
  cutListCache.set(parts, { p: pp, cl });
  return cl;
}

/** A part's name for a drawing's header and running text: no parentheses, "Rail L" as "left rail". */
export const plainName = (name: string): string => humanName(name);

/** The final T × W × L the cut list prints for the part (oak), else the stock size, else the drawn extents in ascending order. No inch marks, like the cut list. */
function finalText(part: Part, cl: CutList, ext: number[]): string {
  const fin = cl.finished.find((f) => f.ids.includes(part.id));
  if (fin) return fin.finalText;
  if (part.stock) return finalDimsText(part.stock);
  return ext.map((v) => frac(v).replace(/"$/, '')).join(' × ');
}

/**
 * The grain line of a cross-laminated part (the brake knee), face layers first: "face layers: grain upright; center layer: across the sled (face layers: the 9-1/2" side, vertical in the main view;
 * center layer: the 3-11/16" side, horizontal)". Never one axis for the whole part: `Part.grain` is the center layer's.
 */
function crossGrainLine(part: Part, b: Board, ext: number[]): string | undefined {
  const lg = layerGrainOf(part), words = crossGrainWords(part);
  if (!lg || lg.length < 2 || !words) return undefined;
  const side = (g: 'x' | 'y' | 'z'): string => {
    const k = dominant(b.dirToBoard(unitAx({ x: 0, y: 1, z: 2 }[g] as Ax)).map(Math.abs) as Vec3);
    return k === 2 ? 'through the thickness' : `the ${frac(ext[k])} side, ${k === 0 ? 'horizontal' : 'vertical'} in the main view`;
  };
  return `${part.partNo === 'brake-knee' ? words.replace('grain upright', 'grain up the leg') : words} (face layers: ${side(lg[0])}; center layer: ${side(lg[Math.floor(lg.length / 2)])})`;
}

/** Layers of a cross-laminated part, one entry per layer, when the model says which way each grain runs (`Part.layerGrain`: the local axis per layer, face layer first). */
const layerGrainOf = (part: Part): Array<'x' | 'y' | 'z'> | undefined => {
  const g = (part as Part & { layerGrain?: Array<'x' | 'y' | 'z'> }).layerGrain;
  return Array.isArray(g) && g.length ? g : undefined;
};

/** "1 as 3/4 × 4-3/4 × 6-1/2 from 4/4": the pieces of a part's cuts grouped by size and board, per part. */
function pieceGroups(cuts: CutList['cuts']): Array<{ n: number; text: string; board: string; piece: string }> {
  const out: Array<{ n: number; text: string; board: string; piece: string }> = [];
  for (const c of cuts) {
    const g = out.find((x) => x.text === c.roughText && x.board === c.board && x.piece === c.piece);
    if (g) g.n += 1; else out.push({ n: 1, text: c.roughText, board: c.board, piece: c.piece });
  }
  return out;
}

/**
 * The board the part comes from, in words, read from the cut list: "rough 3/4 × 2 × 21-3/4 (T × W × L), from 4/4 white oak"; "2 strips, each 1/2 × 3-3/8 × 61 rough, resawn from 8/4 ...";
 * "cut 6 pieces ...; glue the 3 layers ...". Rough sizes are the cut list's `roughText` (rounded UP to 1/8), never recomputed.
 */
function boardText(part: Part, cl: CutList): string {
  const st = part.stock;
  if (part.kind === 'metal' || part.kind === 'purchased') {
    if (st && part.geometry.type === 'cylinder') return `${part.material}, ${frac(2 * part.geometry.radius)} dia × ${frac(st.l)}`; // a round rod: a diameter and a length, not a T × W × L
    return st ? `${part.material}, ${frac(st.t)} × ${frac(st.w)} × ${frac(st.l)}` : part.material;
  }
  if (!st) return part.material;
  const cuts = cl.cuts.filter((c) => c.ids.includes(part.id));
  if (!cuts.length) return `${frac(st.t)} × ${frac(st.w)} × ${frac(st.l)}, ${part.material}`;
  const groups = pieceGroups(cuts);
  const wood = part.material;
  if (cuts[0].piece === 'strip') {
    const g = groups[0];
    return cuts.length === 1 ? `1 strip, ${g.text} rough (T × W × L), resawn from ${g.board} ${wood}, planed to ${frac(st.t)}`
      : `${cuts.length} strips, each ${g.text} rough (T × W × L), resawn from ${g.board} ${wood}, planed to ${frac(st.t)} and glued face to face`;
  }
  const glue = cl.glueUps.find((u) => u.ids.includes(part.id));
  if (glue) {
    const list = groups.map((g) => `${g.n} ${g.n === 1 ? 'piece' : 'pieces'} ${g.text} (T × W × L) from ${g.board}`).join(' and ');
    return `cut ${list}; ${glue.note}`;
  }
  const c = cuts[0];
  return `rough ${c.roughText} (T × W × L), from ${c.board} ${wood}`;
}

// ── Public API ──

const FABS = new Set<Part['fab']>(['table-saw', 'bandsaw', 'bentlam', 'drill-tap']);

/** The parts that get a drawing: every built part cut on the table saw, bandsaw, bending form or drill press (the Shaper parts have their own cut files). */
export function drawnParts(parts: Part[], opts: { includeShaper?: boolean } = {}): Part[] {
  return parts.filter((x) => x.group !== 'reference' && !x.payload && (FABS.has(x.fab) || (opts.includeShaper === true && x.fab === 'shaper-origin')));
}

const R32 = (v: number): number => Math.round(v * 32);
/** The drawing's signature: its size and features (positions rounded to 1/32"), with an optional mirror across board axis `flip`. */
function signature(a: Analysis, flip: Ax | null = null): string {
  const e = EXT(a.board);
  const fq = (q: Vec3): Vec3 => (flip === null ? q : (q.map((c, i) => (i === flip ? e[i] - c : c)) as Vec3));
  const box = (lo: Vec3, hi: Vec3): string => { const A = fq(lo), B = fq(hi); return [...A.map((c, i) => Math.min(c, B[i])), ...A.map((c, i) => Math.max(c, B[i]))].map(R32).join(','); };
  const fs = a.feats.map((f) => (f.k === 'hole' ? `h${R32(f.dia)}:${f.pts.map((q) => fq(q).map(R32).join(',')).sort().join(';')}` : f.k === 'region' ? `r${f.kind}:${f.boxes.map(([lo, hi]) => box(lo, hi)).sort().join(';')}` : f.k === 'outline' ? `o${f.marks.map((q) => fq([q[0], q[1], 0]).slice(0, 2).map(R32).join(',')).sort().join(';')}` : `n${f.text}`)).sort();
  const outline = a.board.main.map((q) => fq([q[0], q[1], 0]).slice(0, 2).map(R32).join(',')).sort().join(';');
  return `${e.map(R32).join('x')}|${outline}|${fs.join('|')}`;
}

const isLeft = (id: string): boolean => /-L(\d*|-.*)?$|L\d$/.test(id);

/**
 * One dimensioned drawing per distinct cut, grouped by part number: identical pieces share a drawing (qty N), an L/R pair that differs only by a mirror shares one drawing
 * ("MAKE 2: 1 as drawn, 1 MIRROR IMAGE"), and pieces under one part number that differ (the crossmembers of different lengths) get a drawing each.
 */
export function partDrawings(parts: Part[], p: Params, opts: { includeShaper?: boolean } = {}): PartDrawingSheet[] {
  const list = drawnParts(parts, opts);
  const cl = cutListFor(parts, p);
  const groups = new Map<string, Part[]>();
  for (const x of list) { const k = x.partNo ?? x.id; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(x); }
  const out: PartDrawingSheet[] = [];
  for (const [partNo, members] of groups) {
    const an = members.map((x) => analyze(x, parts, p)).filter((x): x is Analysis => !!x);
    const classes: Array<{ sig: string; mirrors: string[]; items: Analysis[]; mirrored: Analysis[] }> = [];
    for (const a of an) {
      const sig = signature(a);
      const same = classes.find((c) => c.sig === sig);
      if (same) { same.items.push(a); continue; }
      const mir = classes.find((c) => c.mirrors.includes(sig));
      if (mir) { mir.mirrored.push(a); continue; }
      classes.push({ sig, mirrors: ([0, 1, 2] as Ax[]).map((k) => signature(a, k)), items: [a], mirrored: [] });
    }
    for (const c of classes) {
      // Draw the left-hand piece of a pair; the drawn group is the left one.
      let items = c.items, mirrored = c.mirrored;
      if (mirrored.length && !items.some((x) => isLeft(x.part.id)) && mirrored.some((x) => isLeft(x.part.id))) [items, mirrored] = [mirrored, items];
      const lead = items.find((x) => isLeft(x.part.id)) ?? items[0];
      const qty = items.length + mirrored.length;
      const names = (xs: Analysis[]): string => xs.map((x) => plainName(x.part.name)).join(', ');
      const all = [...items, ...mirrored].map((x) => x.part.name);
      const makeNote = mirrored.length
        ? `MAKE ${qty}: ${items.length} as drawn (${names(items)}), ${mirrored.length} MIRROR IMAGE (${names(mirrored)}).`
        : qty > 1 ? `MAKE ${qty} identical: ${describeGroup(all)}.` : '';
      const r = renderSheet(lead, qty, makeNote, p, cl, qty > 1 ? groupedName(all) : undefined);
      out.push({ partId: lead.part.id, partNo, partIds: [...items, ...mirrored].map((x) => x.part.id), qty, name: qty > 1 ? groupedName(all) : lead.part.name, makeNote, svg: r.svg, widthIn: r.W, heightIn: r.H, scale: r.scale, features: r.features });
    }
  }
  return out;
}

export interface PartDims {
  t: string; w: string; l: string;
  /** "3/4" × 3" × 59"" (T × W × L). */
  size: string;
  /** The board in words (rough size and the board it comes from, the lamination, the strips). */
  board: string;
  grain: string;
  /** The key features, one short line each. */
  features: string[];
}

/** The mortise boxes of a part (Dominos, loose-tenon and tenon mortises), in its board frame, one per mortise: for the test that no two mortises in one part meet. */
export function mortiseBoxes(part: Part, parts: Part[], p: Params): Array<{ key: string; lo: Vec3; hi: Vec3 }> {
  const a = analyze(part, parts.includes(part) ? parts : [...parts, part], p);
  if (!a) return [];
  return a.feats.flatMap((f) => (f.k === 'region' && f.kind === 'mortise' ? f.boxes.map(([lo, hi]) => ({ key: f.key, lo, hi })) : []));
}

/** A short summary of a part for a popover: final T × W × L as fractions, the board, the grain and the key features. Pass `parts` and `p` to include inbound, passing-bolt and rod features. */
export function partDims(part: Part, parts: Part[] = [part], p?: Params): PartDims {
  const all = parts.includes(part) ? parts : [...parts, part];
  let a: Analysis | null = null;
  try { a = analyze(part, all, p ?? ({} as Params)); } catch { a = null; }
  const lb = localBounds(part.geometry);
  const e = a ? EXT(a.board) : [lb.max[0] - lb.min[0], lb.max[1] - lb.min[1], lb.max[2] - lb.min[2]];
  const cl = cutListFor(all, p);
  const fin = cl.finished.find((f) => f.ids.includes(part.id));
  const d = fin ? [fin.final.t, fin.final.w, fin.final.l] : part.stock && part.kind !== 'lumber' ? [part.stock.t, part.stock.w, part.stock.l] : [...e].sort((x, z) => x - z);
  const t = frac(d[0]), w = frac(d[1]), l = frac(d[2]);
  const feats = a ? a.feats.map((f) => (f.k === 'hole' ? `${f.pts.length} ${plural(f.noun, f.pts.length)}, ${f.size}` : f.k === 'region' ? `${f.boxes.length} ${plural(f.noun, f.boxes.length)}, ${f.detail}` : f.k === 'outline' ? f.text.split(/(?<=\.) /)[0].replace(/\.$/, '') : f.text)) : [];
  let grain = 'n/a';
  const lgx = layerGrainOf(part);
  if (lgx && lgx.length > 1 && a) grain = crossGrainLine(part, a.board, [...e]) ?? 'n/a';
  else if (part.grain && a) { const k = dominant(a.board.dirToBoard(unitAx({ x: 0, y: 1, z: 2 }[part.grain] as Ax)).map(Math.abs) as Vec3); grain = k === 2 ? 'through the thickness' : `along the ${frac(e[k])}`; }
  const rodSize = part.geometry.type === 'cylinder' ? `${frac(2 * part.geometry.radius)} dia × ${frac(part.geometry.length)}` : undefined;
  const tallSize = part.stock && isTallBlock(part, part.stock) ? `${t} thick × ${w} tall × ${l} across` : undefined;
  return { t, w, l, size: rodSize ?? tallSize ?? `${t} × ${w} × ${l}`, board: boardText(part, cl), grain, features: [...new Set(feats)] };
}
