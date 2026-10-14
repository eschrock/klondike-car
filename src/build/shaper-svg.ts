/**
 * Shaper Origin SVG files (Phase 4, output 4): one drawing per `fab: 'shaper-origin'` part number, in Shaper's conventions (see svg-util.ts).
 * Plain TS, no three.js. Pure functions of `(parts, params)`.
 *
 * Joint -> feature rules:
 *  R1  Holes in `FlatPattern.holes` (hand holes, vent holes) are inside cuts; a hole whose largest dimension is under DRILL_BELOW_IN is a drill mark (blue) instead.
 *  R2  bolt / screw / pin / knob joints with `at`: a hole at each point, axis normal to the cut face, when the text says "through" (the default). Diameter: a #N screw gets its clearance
 *      (#10 = 0.2 in), a bolt its standard clearance (1/4 = 0.266 in), a pin `diaIn` + 1/32 (0.375 -> 13/32); an explicit "N/M clearance" in the text wins over all of these (the sign knobs: 7/32 = 0.219). A hole under
 *      DRILL_BELOW_IN is a drill mark; otherwise an inside cut.
 *  R3  Blind holes (threaded inserts, "screws down/up through the X into the tongue" pilots): drill marks with the depth in the label. A pilot hole is drilled through the mating part
 *      clamped in place, so it is a mark, not a cut. A mark on the face opposite the one being cut is dashed ("hidden face").
 *  R4  A clevis pin without "clearance hole" (the brake flap pivot) is a cross hole drilled across the edge in place: a guide line plus a note. A screw eye in an end face is a tick and a note.
 *  R5  A point that lands outside the outline, or nearer an edge than the joint's own "N in or more from every edge" rule, is not trusted: a dashed guide mark plus a note, never a cut.
 *  R6  Dados and mortises on a face (the normal coordinate is in the outer part of the thickness) are pockets of the parsed width and depth. A web's stopped dado follows the web's
 *      end (its lateral station and its z range at the end x, from the web mesh); a deck dado runs the deck's width at that end; a mortise is thin across the rail (model Y). The face
 *      they are on is the face that is cut (the part is drawn from that face, mirrored in u when it is the back of the pattern's plain view).
 *      Two joint-text flags change the pocket shape: a web dado "out through the top edge" is open at the top (the pocket runs out through the rounded corner, no thin wall), and a deck
 *      dado "into the web dados" is extended at each end across the neighboring web dado, so the two make one continuous pocket at the corner.
 *  R7  Edge joints (glue, Domino, scarf, bevel, rabbet, half-lap, dado cut in the mate, anything at mid-thickness) are not Shaper features. Glue footprints of lumber / sheet mates are
 *      dashed guides; the rest become text notes (below the part and in <desc>).
 *  R8  `legend` is engraved as an on-line cut at `legend.depthIn`, single-stroke capitals, its INK centered on the panel (not its advance width), readable from the legend's face.
 *  R9  A captured-edge sheet (the storage lid) is cut at its stock size, tongues included (`FlatPattern.tongueIn`); a dashed guide shows the visible panel.
 *  R10 Nothing is cut deeper than SHAPER_MAX_DEPTH_IN in one pass: a deeper outline or hole (the 1.5 in bow bulkhead) is Shaper-cut to the maximum depth from one face and finished with a
 *      bandsaw and a flush-trim (pattern) bit. The file says so, and the feature is marked `deep`.
 *  R11 Every feature names its bit: 1/4 in for outlines, hand holes and pockets wider than 0.26 in; 1/8 in for narrower pockets (a pocket exactly as wide as the bit has no offset), holes under 3/8 in
 *      and the engraving (a straight bit, on-line).
 *  R12 Human text (title, tags, notes) is never in a cut path: it is stroke-only text in a `<g id="annotations" shaper:cutType="guide">` group below the part, and in <desc>.
 */
import type { Params } from '../params';
import type { Part, Vec2, Vec3 } from '../model/types';
import { worldAABB } from '../model/bounds';
import { flatPattern, type FlatPattern } from './flat';
import {
  ANNOTATION_ATTRS, bbox, circleD, distToPoly, fmt, guideEl, parseInches, pathEl, pointInPoly, polyD, rectAlong, rectLoop, strokeText, svgDocument, textEl, type Xf,
} from './svg-util';

/** Cut this much deeper than the stock so the bit breaks through cleanly (in). */
export const BREAKTHROUGH_IN = 0.02;
/** A hole whose largest dimension is under this (in) is drilled, not routed: a 1/8 in bit cannot cut it cleanly and a drill is exact (in). */
export const DRILL_BELOW_IN = 0.25;
/** Smallest Shaper bit (in): pockets narrower than this cannot be cut. */
export const MIN_BIT_IN = 0.125;
/**
 * Deepest cut (in) the Shaper Origin makes in one pass. A 1/4 in spiral bit is rated about 1 in, so 1.0 is a conservative figure; VERIFY YOUR BIT (a longer bit may reach more). A cut deeper than this
 * (the 1.5 in oak bow bulkhead outline and its hand hole) is made to this depth from one face and finished with a bandsaw and a flush-trim (pattern) bit.
 */
export const SHAPER_MAX_DEPTH_IN = 1.0;
/** The depth (in) written to a cut path for a part of this thickness: through plus the breakthrough, but no deeper than the bit reaches. */
export const shaperCutDepth = (thicknessIn: number): number => Math.min(thicknessIn + BREAKTHROUGH_IN, SHAPER_MAX_DEPTH_IN);
const BIT_SMALL = '1/8 in', BIT_LARGE = '1/4 in';
/** A pocket this narrow or narrower (in) takes the 1/8 in bit: 0.25 is exactly the 1/4 in bit (no offset), 0.197 is narrower than it. */
const POCKET_SMALL_BIT_MAX_IN = 0.26;
/** An inside cut whose narrowest dimension is under this (in) takes the 1/8 in bit (a 1/4 in bit leaves no room to spare in a 0.266 hole). */
const HOLE_SMALL_BIT_MAX_IN = 0.375;
const bitForPocket = (narrowIn: number): string => (narrowIn <= POCKET_SMALL_BIT_MAX_IN ? BIT_SMALL : BIT_LARGE);
const bitForHole = (narrowIn: number): string => (narrowIn < HOLE_SMALL_BIT_MAX_IN ? BIT_SMALL : BIT_LARGE);
/** Extra clearance on a pin hole over the pin diameter (in): 3/8 pin -> 13/32 hole. */
export const PIN_CLEARANCE_IN = 1 / 32;
/** A joint on a face if its normal coordinate is this fraction of the thickness or more away from mid-thickness; nearer is an edge joint. */
const FACE_FRACTION = 0.2;
/** Default margin (in) a hole center must keep from the outline when the joint text gives none. */
const DEFAULT_EDGE_IN = 0.125;
/** A wall thinner than this (in) between a pocket and the outline, or between two pockets, is reported. */
const THIN_WALL_IN = 0.06;
/** Mating-part vertices this near the part's slab (in) take part in a glue footprint. */
const CONTACT_TOL_IN = 0.75;
/** Clearance hole diameters (in) by screw gauge and by bolt size: #N close fit, and the common drill for each bolt diameter. */
const GAUGE_CLEARANCE_IN: Record<string, number> = { '6': 0.15, '8': 0.17, '10': 0.2, '12': 0.22 };
const METRIC_CLEARANCE_IN: Record<string, number> = { '3': 0.13, '4': 0.17 };
const BOLT_CLEARANCE_IN: Record<string, number> = { '0.25': 0.266, '0.3125': 0.332, '0.375': 0.397 };
/** Pilot hole diameters (in) for a wood screw by gauge. */
const GAUGE_PILOT_IN: Record<string, number> = { '6': 0.1, '8': 0.116, '10': 0.14, '12': 0.16 };

export type FeatureKind = 'outline' | 'hole' | 'drill' | 'pocket' | 'engrave' | 'guide' | 'note';

export interface ShaperFeature {
  kind: FeatureKind;
  label: string;
  count: number;
  diaIn?: number;
  depthIn?: number;
  /** The mating part id(s) / joint type the feature comes from. */
  to?: string;
  joint?: string;
  /** Marked as a guide only: the position or the kind of feature is not certain. */
  approx?: boolean;
  /** Pattern coordinates (u, v) of each hole / mark / pocket center. */
  at?: Vec2[];
  /** The bit that cuts it (R11): "1/4 in", "1/8 in", "1/8 in straight bit", or "drill". */
  bit?: string;
  /** Deeper than SHAPER_MAX_DEPTH_IN (R10): cut to the maximum depth from one face, then finished with a bandsaw and a flush-trim bit. `depthIn` is the depth of the Shaper pass. */
  deep?: boolean;
}

export interface ShaperFile {
  partId: string;
  partNo: string;
  /** How many identical parts this file serves. */
  qty: number;
  partIds: string[];
  fileName: string;
  svg: string;
  widthIn: number;
  heightIn: number;
  features: ShaperFeature[];
  /** Plain words for the face to put UP, e.g. "FORWARD (bow-side) face"; `cutFaceMatters` is false when the part has no feature on a face (either face can go up). */
  cutFace: string;
  cutFaceMatters: boolean;
  /** The distinct bits the file calls for, in the order they are used. */
  bits: string[];
  /** The file has a cut deeper than SHAPER_MAX_DEPTH_IN. */
  deepCut: boolean;
}

// ── Internal drawing items (pattern coordinates: u right, v up, before any mirroring) ──
type Item =
  | { k: 'cutHole'; c: Vec2; dia: number }
  | { k: 'cutLoop'; loop: Vec2[] }
  | { k: 'pocket'; loop: Vec2[]; depth: number; label: string; runOut?: boolean; deckRun?: boolean; web?: boolean }
  | { k: 'drill'; c: Vec2; dia: number; onFace?: '+' | '-'; approx?: boolean; label?: string }
  | { k: 'line'; pts: Vec2[]; closed?: boolean; dashed?: boolean; label?: string }
  | { k: 'tag'; at: Vec2; text: string; size?: number };

export interface PartDrawing {
  part: Part;
  f: FlatPattern;
  items: Item[];
  features: ShaperFeature[];
  /** Text notes for the edge joints and everything that is not a Shaper feature. */
  notes: string[];
  /** Drawn from the back of the pattern's plain view: mirror u. */
  mirror: boolean;
  face: '+' | '-';
  engrave?: { strokes: Vec2[][]; depthIn: number; text: string };
  /** Plain words for the cut face (see ShaperFile.cutFace) and whether it matters. */
  cutFace: string;
  cutFaceMatters: boolean;
  deepCut: boolean;
}

// ── Frames ──
const AX: Record<'x' | 'y' | 'z', 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

interface Frame {
  toModel: (l: Vec3) => Vec3;
  toLocal: (m: Vec3) => Vec3;
  modelToPattern: (m: Vec3) => Vec2;
  /** The pattern vector of a model-frame direction. */
  dirToPattern: (d: Vec3) => Vec2;
  /** The face of the pattern's plain (unmirrored) view. */
  plainFace: '+' | '-';
  nIdx: 0 | 1 | 2;
  midN: number;
  thick: number;
  /** The face of a local point by its normal coordinate: null when it is within `FACE_FRACTION` of the middle (an edge joint). */
  faceOf: (l: Vec3) => '+' | '-' | null;
  signedFace: (l: Vec3) => '+' | '-';
  isWall: boolean;
}

function frameOf(part: Part, f: FlatPattern): Frame {
  const m = part.transform;
  const toModel = (l: Vec3): Vec3 => [m[0] * l[0] + m[4] * l[1] + m[8] * l[2] + m[12], m[1] * l[0] + m[5] * l[1] + m[9] * l[2] + m[13], m[2] * l[0] + m[6] * l[1] + m[10] * l[2] + m[14]];
  const toLocal = (q: Vec3): Vec3 => {
    const d = [q[0] - m[12], q[1] - m[13], q[2] - m[14]];
    return [m[0] * d[0] + m[1] * d[1] + m[2] * d[2], m[4] * d[0] + m[5] * d[1] + m[6] * d[2], m[8] * d[0] + m[9] * d[1] + m[10] * d[2]];
  };
  const g = part.geometry;
  const nIdx = AX[f.normalAxis];
  const midN = g.type === 'extrusion' ? g.depth / 2 : 0;
  // Which local axis moves u and which v, and the handedness of (u, v, +normal).
  const h = 0.05;
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const grad = axes.map((a) => {
    const p1 = f.toPattern([a[0] * h, a[1] * h, a[2] * h]), p0 = f.toPattern([-a[0] * h, -a[1] * h, -a[2] * h]);
    return [(p1[0] - p0[0]) / (2 * h), (p1[1] - p0[1]) / (2 * h)] as Vec2;
  });
  const au = [0, 1, 2].reduce((b, i) => (Math.abs(grad[i][0]) > Math.abs(grad[b][0]) ? i : b), 0);
  const av = [0, 1, 2].reduce((b, i) => (Math.abs(grad[i][1]) > Math.abs(grad[b][1]) ? i : b), 0);
  const eu = axes[au].map((x) => x * Math.sign(grad[au][0])), ev = axes[av].map((x) => x * Math.sign(grad[av][1])), en = axes[nIdx];
  const cross = [ev[1] * en[2] - ev[2] * en[1], ev[2] * en[0] - ev[0] * en[2], ev[0] * en[1] - ev[1] * en[0]];
  const handed = eu[0] * cross[0] + eu[1] * cross[1] + eu[2] * cross[2] > 0 ? 1 : -1;
  const modelToPattern = (q: Vec3): Vec2 => f.toPattern(toLocal(q));
  const dirToPattern = (d: Vec3): Vec2 => {
    const ld = toLocal([d[0] + m[12], d[1] + m[13], d[2] + m[14]]);
    return [ld[0] * grad[0][0] + ld[1] * grad[1][0] + ld[2] * grad[2][0], ld[0] * grad[0][1] + ld[1] * grad[1][1] + ld[2] * grad[2][1]];
  };
  const signedFace = (l: Vec3): '+' | '-' => (l[nIdx] - midN >= 0 ? '+' : '-');
  return {
    toModel, toLocal, modelToPattern, dirToPattern, plainFace: handed > 0 ? '+' : '-', nIdx, midN, thick: f.thicknessIn,
    faceOf: (l) => (Math.abs(l[nIdx] - midN) >= FACE_FRACTION * f.thicknessIn ? signedFace(l) : null), signedFace, isWall: part.geometry.type === 'mesh',
  };
}

// ── Text parsing ──
const NUM = String.raw`(\d+-\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)`;

/** "0.197" × 1/4"" -> width and depth. */
function parseDadoSize(size: string): { width: number; depth: number } | null {
  const m = new RegExp(String.raw`^\s*${NUM}\s*"?\s*×\s*${NUM}`).exec(size);
  if (!m) return null;
  const w = parseInches(m[1]), d = parseInches(m[2]);
  return Number.isFinite(w) && Number.isFinite(d) ? { width: w, depth: d } : null;
}

/** "1/4 × 5/8 × 3/8 deep loose tenon" -> thin, wide, depth. */
function parseMortise(size: string): { thin: number; wide: number; depth: number } | null {
  const m = new RegExp(String.raw`${NUM}\s*×\s*${NUM}\s*×\s*${NUM}\s*(?:in\s*)?deep`).exec(size);
  if (!m) return null;
  const v = [m[1], m[2], m[3]].map(parseInches);
  return v.every(Number.isFinite) ? { thin: v[0], wide: v[1], depth: v[2] } : null;
}

function parseDepth(text: string): number | undefined {
  const m = /(\d*\.\d+|\d+\/\d+)"?\s*(?:in\s*)?deep/.exec(text);
  const v = m ? parseInches(m[1]) : NaN;
  return Number.isFinite(v) ? v : undefined;
}

/** The drill size (in) of a blind insert hole from the joint text ("in blind 5/16 in holes 0.344 in deep"), or undefined when the text gives none. */
function insertBore(text: string): number | undefined {
  const m = new RegExp(String.raw`blind\s+${NUM}\s*(?:in\b|")?\s*holes?`).exec(text);
  const v = m ? parseInches(m[1]) : NaN;
  return Number.isFinite(v) ? v : undefined;
}

/** The diameter of a through hole for a fastener joint (rule R2). */
export function clearanceDia(j: { type: string; size?: string; diaIn?: number }): number {
  const text = j.size ?? '';
  if (/\bdrain hole\b/.test(text) && j.diaIn) return j.diaIn; // D-83: a drain is exactly its own size (3/8"), not a bolt clearance
  const clr = new RegExp(String.raw`${NUM}\s*(?:in\s*)?clearance`).exec(text);
  if (clr && Number.isFinite(parseInches(clr[1]))) return parseInches(clr[1]);
  const gauge = /#\s*(\d+)/.exec(text);
  if (gauge && GAUGE_CLEARANCE_IN[gauge[1]]) return GAUGE_CLEARANCE_IN[gauge[1]];
  const met = /\bM(\d)\b/.exec(text);
  if (met && METRIC_CLEARANCE_IN[met[1]]) return METRIC_CLEARANCE_IN[met[1]];
  const d = j.diaIn ?? 0.25;
  if (j.type === 'pin') return d + PIN_CLEARANCE_IN;
  return BOLT_CLEARANCE_IN[String(d)] ?? d + 1 / 64;
}

function pilotDia(j: { size?: string; diaIn?: number }): number {
  const gauge = /#\s*(\d+)/.exec(j.size ?? '');
  return gauge && GAUGE_PILOT_IN[gauge[1]] ? GAUGE_PILOT_IN[gauge[1]] : (j.diaIn ?? 0.19) * 0.75;
}

type FastenerKind = 'through' | 'blind' | 'pilot' | 'cross' | 'endface' | 'none';

function fastenerKind(j: { type: string; size?: string; note?: string }): FastenerKind {
  const text = `${j.size ?? ''} ${j.note ?? ''}`.toLowerCase();
  if (/screw eye/.test(text) && /(aft|front|rear|outer) face of the/.test(text) && !/end face/.test(text)) return 'pilot';
  if (/screw eye|end face/.test(text)) return 'endface';
  if (/snap detent/.test(text)) return 'none';
  if (j.type === 'threaded-insert' || /threaded insert|heat-set insert/.test(text)) return 'blind';
  if (/(down|up) through the .{0,40}?into/.test(text)) return 'pilot';
  if (j.type === 'pin' && /clevis/.test(text) && !/clearance hole/.test(text)) return 'cross';
  return 'through';
}

// ── Mating-part geometry ──
function allModelVertices(mate: Part): Vec3[] {
  const g = mate.geometry, m = mate.transform;
  const tf = (l: Vec3): Vec3 => [m[0] * l[0] + m[4] * l[1] + m[8] * l[2] + m[12], m[1] * l[0] + m[5] * l[1] + m[9] * l[2] + m[13], m[2] * l[0] + m[6] * l[1] + m[10] * l[2] + m[14]];
  if (g.type === 'box') {
    const [sx, sy, sz] = g.size.map((s) => s / 2);
    const out: Vec3[] = [];
    for (const a of [-sx, sx]) for (const b of [-sy, sy]) for (const c of [-sz, sz]) out.push(tf([a, b, c]));
    return out;
  }
  if (g.type === 'extrusion') return g.outline.flatMap(([x, y]): Vec3[] => [tf([x, y, 0]), tf([x, y, g.depth])]);
  if (g.type === 'mesh') {
    const out: Vec3[] = [];
    for (let i = 0; i + 2 < g.positions.length; i += 3) out.push(tf([g.positions[i], g.positions[i + 1], g.positions[i + 2]]));
    return out;
  }
  return [];
}

/** The rectangle (or polygon, for a plan-curved web) where `mate` lies on the face of `part`, in pattern coordinates, or null when it does not touch the pattern. */
function footprint(f: FlatPattern, fr: Frame, mate: Part): Vec2[] | null {
  const g = mate.geometry;
  let pts: Vec2[];
  if (fr.isWall && g.type === 'mesh' && g.profile) {
    // Both are plan-curved walls in the model frame: the mate's (x, z) profile mapped through the web's arc length.
    pts = g.profile.map(([x, z]) => f.toPattern([x, 0, z]));
    return pts;
  }
  const verts = allModelVertices(mate);
  const near: Vec2[] = [];
  for (const v of verts) {
    const l = fr.toLocal(v);
    const n = l[fr.nIdx];
    if (fr.isWall || (n >= -CONTACT_TOL_IN && n <= fr.thick + CONTACT_TOL_IN) || (fr.midN === 0 && Math.abs(n) <= fr.thick / 2 + CONTACT_TOL_IN)) near.push(f.toPattern(l));
  }
  if (near.length < 3) return null;
  const b = bbox(near);
  const u0 = Math.max(0, b.u0), v0 = Math.max(0, b.v0), u1 = Math.min(f.widthIn, b.u1), v1 = Math.min(f.heightIn, b.v1);
  if (u1 - u0 < 0.05 || v1 - v0 < 0.05) return null;
  return rectLoop(u0, v0, u1, v1);
}

// ── Analysis ──
export function analyzeShaperPart(part: Part, all: Part[], p: Params): PartDrawing | null {
  void p;
  const f = flatPattern(part);
  if (!f) return null;
  const fr = frameOf(part, f);
  const byId = new Map(all.map((x) => [x.id, x]));
  const items: Item[] = [];
  const features: ShaperFeature[] = [];
  const notes: string[] = [];
  const W = f.widthIn, H = f.heightIn;
  const deepCut = f.thicknessIn + BREAKTHROUGH_IN > SHAPER_MAX_DEPTH_IN + 1e-9;
  const passDepth = shaperCutDepth(f.thicknessIn);
  const deepWords = `DEEP CUT: ${fmt(f.thicknessIn)} in stock is deeper than a Shaper bit reaches (${fmt(SHAPER_MAX_DEPTH_IN)} in, verify your bit). Shaper-cut to the max depth from one face, then finish with a bandsaw and a flush-trim (pattern) bit`;
  const tongueTxt = f.tongueIn ? `, cut size INCLUDING the ${fmt(f.tongueIn)} in tongue on every side (the rabbets capture it); the visible panel is ${fmt(W - 2 * f.tongueIn)} x ${fmt(H - 2 * f.tongueIn)} in` : '';
  features.push({ kind: 'outline', label: `Outline ${fmt(W)} x ${fmt(H)} in, outside cut${tongueTxt}${deepCut ? `. ${deepWords}` : ''}`, count: 1, depthIn: passDepth, bit: BIT_LARGE, ...(deepCut ? { deep: true } : {}) });
  if (deepCut) notes.push(`Outline: ${deepWords}. The file is cut ${fmt(passDepth)} in deep (stock ${fmt(f.thicknessIn)} in).`);
  if (f.tongueIn) {
    const t = f.tongueIn;
    items.push({ k: 'line', pts: rectLoop(t, t, W - t, H - t), closed: true, dashed: true, label: 'visible panel (inside the rabbets)' });
    notes.push(`The outline is the CUT size: the visible panel is ${fmt(W - 2 * t)} x ${fmt(H - 2 * t)} in and a ${fmt(t)} in tongue on each of the 4 sides goes into the rabbet of the frame (dashed guide = the visible edge).`);
  }

  // R1: through holes of the geometry.
  for (const loop of f.holes) {
    const b = bbox(loop);
    const dim = Math.max(b.u1 - b.u0, b.v1 - b.v0);
    const c: Vec2 = [(b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2];
    if (dim < DRILL_BELOW_IN) items.push({ k: 'drill', c, dia: dim });
    else items.push({ k: 'cutLoop', loop });
  }
  const loopHoles = f.holes.map(bbox);
  const small = loopHoles.filter((b) => Math.max(b.u1 - b.u0, b.v1 - b.v0) < DRILL_BELOW_IN);
  if (small.length) features.push({ kind: 'drill', label: `Through hole, drill (under ${DRILL_BELOW_IN} in)`, count: small.length, diaIn: Math.max(...small.map((b) => Math.max(b.u1 - b.u0, b.v1 - b.v0))), at: small.map((b) => [(b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2] as Vec2), joint: 'geometry', bit: 'drill' });
  const big = loopHoles.filter((b) => Math.max(b.u1 - b.u0, b.v1 - b.v0) >= DRILL_BELOW_IN);
  if (big.length) {
    features.push({ kind: 'hole', label: `Hand hole / slot, inside cut${deepCut ? `. ${deepWords}` : ''}`, count: big.length, depthIn: passDepth, at: big.map((b) => [(b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2] as Vec2), joint: 'geometry', bit: bitForHole(Math.min(...big.map((b) => Math.min(b.u1 - b.u0, b.v1 - b.v0)))), ...(deepCut ? { deep: true } : {}) });
    if (deepCut) notes.push(`Hand hole: ${deepWords} (the hole is cut ${fmt(passDepth)} in deep from the cut face, then opened through from the other face with the flush-trim bit on a template, or by hand).`);
  }

  // A joint point is in the part's own local frame (types.ts); a point that lands off the pattern is reported, never moved.
  const inBox = (q: Vec2) => q[0] >= -0.05 && q[0] <= W + 0.05 && q[1] >= -0.05 && q[1] <= H + 0.05;
  const resolve = (at: Vec3): { uv: Vec2; local: Vec3 } | null => {
    const q = f.toPattern(at);
    return inBox(q) ? { uv: q, local: at } : null;
  };

  const pocketFaces: Array<'+' | '-'> = [];
  const deckRuns: Array<{ item: Extract<Item, { k: 'pocket' }>; feature: ShaperFeature }> = [];
  const edgeGroups = new Map<string, { type: string; size?: string; note?: string; to: string[]; count: number }>();
  const addEdgeNote = (j: { type: string; to: string; count: number; size?: string; note?: string }) => {
    const k = `${j.type}|${j.size ?? ''}|${j.note ?? ''}`;
    const g = edgeGroups.get(k);
    if (g) { g.to.push(j.to); g.count += j.count; } else edgeGroups.set(k, { type: j.type, size: j.size, note: j.note, to: [j.to], count: j.count });
  };

  const holeFeature = (j: { type: string; to: string }, pts: Vec2[], dia: number | undefined, depth: number | undefined, kind: 'hole' | 'drill', label: string, approx = false) => {
    features.push({ kind, label, count: pts.length, ...(dia !== undefined ? { diaIn: dia } : {}), ...(depth !== undefined ? { depthIn: depth } : {}), to: j.to, joint: j.type, at: pts, bit: kind === 'hole' ? bitForHole(dia ?? 0) : 'drill', ...(approx ? { approx } : {}) });
  };

  /** Rule R2-R5 for one fastener joint, given its resolved points (null where a point is off the pattern). */
  const fasten = (j: { type: string; to: string; count: number; size?: string; note?: string; diaIn?: number }, got: Array<{ uv: Vec2; local: Vec3 } | null>, text: string, kindF: FastenerKind): void => {
      const ok = got.filter((x): x is NonNullable<typeof x> => x !== null);
      if (ok.length < got.length) notes.push(`${j.type} to ${j.to}: ${got.length - ok.length} of ${got.length} point(s) fall outside the pattern; not drawn.`);
      if (kindF === 'none') { addEdgeNote(j); return; }
      if (kindF === 'cross') {
        for (const g of ok) {
          items.push({ k: 'line', pts: [[g.uv[0], 0], [g.uv[0], H]], dashed: true, label: 'cross hole' });
          items.push({ k: 'tag', at: [g.uv[0] + 0.1, H * 0.5], text: `cross hole Ø${fmt(clearanceDia(j))}` });
        }
        features.push({ kind: 'guide', label: `Cross hole Ø${fmt(clearanceDia(j))} across the width at u = ${ok.map((g) => fmt(g.uv[0])).join(', ')}; drill in place with the knee clamped (not a Shaper cut)`, count: ok.length, diaIn: clearanceDia(j), to: j.to, joint: j.type, approx: true });
        return;
      }
      if (kindF === 'endface') {
        for (const g of ok) {
          items.push({ k: 'line', pts: [[Math.max(0, g.uv[0] - 0.1), g.uv[1]], [Math.min(W, g.uv[0] + 0.1), g.uv[1]]], label: 'end-face screw eye' });
          items.push({ k: 'tag', at: [g.uv[0] + 0.15, g.uv[1] - 0.05], text: 'screw eye (end face)' });
        }
        features.push({ kind: 'guide', label: `Screw eye pilot in the end face at v = ${ok.map((g) => fmt(g.uv[1])).join(', ')}`, count: ok.length, to: j.to, joint: j.type, approx: true });
        return;
      }
      // A blind insert hole is drilled to the INSERT's installation size, which the joint text gives ("in blind 5/16 in holes 0.344 in deep"); the thread diameter (diaIn) is not a hole size (build review MUST-5).
      const bore = kindF === 'blind' ? insertBore(text) : undefined;
      const dia = kindF === 'pilot' ? pilotDia(j) : kindF === 'blind' ? (bore ?? j.diaIn ?? 0.19) : clearanceDia(j);
      const diaTxt = kindF === 'blind' && bore === undefined ? 'drill size per the insert maker (not in the model)' : `Ø${fmt(dia)}`;
      const depth = kindF === 'through' ? undefined : parseDepth(text);
      // R5: trust the position only if it is inside the outline and clear of the edges by the joint's own margin.
      const mm = /(\d\/\d|[\d.]+)\s*in or more from every edge/.exec(text);
      const margin = mm ? parseInches(mm[1]) : DEFAULT_EDGE_IN;
      const trusted = ok.filter((g) => pointInPoly(g.uv, f.outer) && distToPoly(g.uv, f.outer) >= (kindF === 'through' ? dia / 2 : margin));
      const untrusted = ok.filter((g) => !trusted.includes(g));
      for (const g of untrusted) items.push({ k: 'drill', c: g.uv, dia, approx: true, label: 'position uncertain' });
      if (untrusted.length) {
        notes.push(`${j.type} to ${j.to}: ${untrusted.length} point(s) are nearer an edge than ${fmt(margin)} in or outside the outline in the model; marked as guides only, set them from the mating part.`);
        holeFeature(j, untrusted.map((g) => g.uv), kindF === 'blind' && bore === undefined ? undefined : dia, depth, 'drill', `${kindF === 'blind' ? 'Blind insert hole' : 'Hole'} ${diaTxt}: position not trusted, guide mark only`, true);
      }
      if (!trusted.length) return;
      const uvs = trusted.map((g) => g.uv);
      if (kindF === 'through' && dia >= DRILL_BELOW_IN) {
        for (const c of uvs) items.push({ k: 'cutHole', c, dia });
        holeFeature(j, uvs, dia, undefined, 'hole', `${j.type} hole Ø${fmt(dia)} through, inside cut`);
      } else {
        const blindish = kindF === 'pilot' || kindF === 'blind';
        for (const g of trusted) items.push({ k: 'drill', c: g.uv, dia, ...(blindish ? { onFace: fr.signedFace(g.local) } : {}) });
        // A blind hole carries its depth on the drawing: one label above the row of marks.
        if (blindish && depth !== undefined) {
          const top = trusted.reduce((a, g) => (g.uv[1] > a.uv[1] ? g : a));
          items.push({ k: 'tag', at: [Math.min(...trusted.map((g) => g.uv[0])), top.uv[1] + dia / 2 + 0.22], text: `${kindF === 'blind' ? 'insert hole' : 'pilot'} ${kindF === 'blind' && bore === undefined ? 'drill per insert maker' : `Ø${fmt(dia)}`} x ${fmt(depth)} deep${trusted.length > 1 ? ` (x${trusted.length})` : ''}`, size: 0.11 });
        }
        const what = kindF === 'through' ? `${j.type} hole Ø${fmt(dia)} through, drill` : kindF === 'blind' ? `Blind insert hole ${diaTxt}${depth ? ` x ${fmt(depth)} deep` : ''}, drill with a stop` : `Pilot hole Ø${fmt(dia)}, drill through the mating part`;
        holeFeature(j, uvs, kindF === 'blind' && bore === undefined ? undefined : dia, depth, 'drill', what);
      }
  };

  for (const j of part.joints ?? []) {
    const mate = byId.get(j.to);
    const text = `${j.size ?? ''} ${j.note ?? ''}`;
    const pts = j.at ?? [];
    const kindF = fastenerKind(j);
    const isFastener = ['bolt', 'screw', 'pin', 'knob', 'threaded-insert', 'hole'].includes(j.type);

    // Scupper drains: a glue joint to a nipple (Extreme), or the plain drain hole of the Standard spec (D-83); either is drilled through the glued-up sandwich, after glue-up.
    if ((j.type === 'glue' && /nipple/.test(text) && /\bhole\b/.test(text)) || (j.type === 'hole' && /drain hole/.test(text) && /^side-/.test(part.id))) {
      const m = new RegExp(String.raw`${NUM}"?\s*(?:316\s*)?(?:nipple|drain hole)`).exec(text);
      const dia = j.diaIn ?? (m ? parseInches(m[1]) : 0.375);
      const got = pts.map(resolve).filter((x): x is NonNullable<typeof x> => x !== null);
      for (const g of got) items.push({ k: 'drill', c: g.uv, dia, label: `drain Ø${fmt(dia)} after glue-up` });
      if (got.length) holeFeature(j, got.map((g) => g.uv), dia, undefined, 'drill', `Drain hole Ø${fmt(dia)}, drill through the glued-up sandwich (inner band, web, outer band)`);
      continue;
    }

    if (isFastener && pts.length) {
      fasten(j, pts.map(resolve), text, kindF);
      continue;
    }

    // Face pockets (R6): dados and mortises.
    if ((j.type === 'dado' || j.type === 'mortise-tenon') && pts.length && !fr.isWall) {
      const got = resolve(pts[0]);
      const face = got ? fr.faceOf(got.local) : null;
      if (got && face) {
        const loops = pocketFor(fr, j, mate, got, f.outer);
        if (loops) {
          for (const loop of loops.loops) {
            const pk: Extract<Item, { k: 'pocket' }> = { k: 'pocket', loop, depth: loops.depth, label: `${j.type} for ${j.to}`, ...(loops.runOut ? { runOut: true } : {}), ...(loops.deckRun ? { deckRun: true } : {}), ...(loops.web ? { web: true } : {}) };
            items.push(pk);
            const out = loop.filter((q) => !pointInPoly(q, f.outer));
            const wall = Math.min(...loop.map((q) => distToPoly(q, f.outer)));
            if (loops.runOut) notes.push(`${j.type} for ${j.to}: runs out through the top edge on purpose (open at the top, no thin wall at the rounded corner).`);
            else if (out.length) notes.push(`${j.type} for ${j.to}: ${out.length} corner(s) of the pocket lie outside the outline (it would break through the edge); check it against the model.`);
            else if (wall < THIN_WALL_IN) notes.push(`${j.type} for ${j.to}: the pocket comes within ${fmt(wall)} in of the outline (a wall under ${THIN_WALL_IN} in); check it against the model.`);
          }
          pocketFaces.push(face);
          const narrow = Math.min(...loops.loops.map((l) => Math.min(Math.hypot(l[1][0] - l[0][0], l[1][1] - l[0][1]), Math.hypot(l[2][0] - l[1][0], l[2][1] - l[1][1]))));
          const pkFeature: ShaperFeature = { kind: 'pocket', label: `${j.type === 'dado' ? 'Dado' : 'Mortise'} for ${j.to}: ${loops.desc}`, count: loops.loops.length, depthIn: loops.depth, bit: bitForPocket(narrow), to: j.to, joint: j.type, at: loops.loops.map((l) => { const b = bbox(l); return [(b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2] as Vec2; }) };
          features.push(pkFeature);
          if (loops.deckRun) deckRuns.push({ item: items[items.length - 1] as Extract<Item, { k: 'pocket' }>, feature: pkFeature });
          if (face !== fr.plainFace) { /* the face decides the mirror below */ }
          continue;
        }
        notes.push(`${j.type} to ${j.to}: on the ${face} face but its shape could not be derived; marked as a guide at (${fmt(got.uv[0])}, ${fmt(got.uv[1])}).`);
        items.push({ k: 'tag', at: got.uv, text: `${j.type} ${j.to}` });
        continue;
      }
    }

    // Everything else is an edge joint or a note (R7).
    addEdgeNote(j);
    if (j.type === 'glue' && mate && mate.fab !== 'buy' && mate.kind !== 'purchased') {
      const fp = footprint(f, fr, mate);
      if (fp) items.push({ k: 'line', pts: fp, closed: true, dashed: true, label: `glue ${mate.partNo ?? mate.id}` }, { k: 'tag', at: [bbox(fp).u0 + 0.05, bbox(fp).v0 + 0.1], text: mate.partNo ?? mate.id, size: 0.11 });
    }
  }

  // Fasteners of OTHER parts that pass into this one and that this part's own joints do not record (the push-handle socket bolts and the brake cord eyes in the transom): the point is
  // in the other part's frame, so go through the model frame. Only joints with a size text and a position, and only face-normal holes.
  for (const q of all) {
    if (q.id === part.id) continue;
    for (const j of q.joints ?? []) {
      if (j.to !== part.id || !j.at?.length || !j.size || !['bolt', 'screw', 'pin', 'knob', 'hole'].includes(j.type)) continue;
      if ((part.joints ?? []).some((own) => own.to === q.id && own.type === j.type)) continue;
      const kindF = fastenerKind(j);
      if (kindF === 'none' || kindF === 'cross' || kindF === 'endface') continue;
      const qm = q.transform;
      const toModelQ = (l: Vec3): Vec3 => [qm[0] * l[0] + qm[4] * l[1] + qm[8] * l[2] + qm[12], qm[1] * l[0] + qm[5] * l[1] + qm[9] * l[2] + qm[13], qm[2] * l[0] + qm[6] * l[1] + qm[10] * l[2] + qm[14]];
      const got = j.at.map((a) => { const l = fr.toLocal(toModelQ(a)); const uv = f.toPattern(l); return inBox(uv) ? { uv, local: l } : null; });
      fasten({ ...j, to: q.id }, got, `${j.size ?? ''} ${j.note ?? ''}`, kindF);
    }
  }

  // A deck dado that "runs into the web dados" is extended at each end across the neighboring web dado (same depth, axis-aligned, touching or within a thin wall of it): one continuous pocket.
  for (const dr of deckRuns) {
    const D = bbox(dr.item.loop);
    const alongU = D.u1 - D.u0 >= D.v1 - D.v0;
    let [a0, a1] = alongU ? [D.u0, D.u1] : [D.v0, D.v1];
    const [c0, c1] = alongU ? [D.v0, D.v1] : [D.u0, D.u1];
    let joined = 0;
    for (const w of d_pockets(items)) {
      if (!w.web || Math.abs(w.depth - dr.item.depth) > 1e-6) continue;
      const B = bbox(w.loop);
      const [b0, b1] = alongU ? [B.u0, B.u1] : [B.v0, B.v1];
      const [e0, e1] = alongU ? [B.v0, B.v1] : [B.u0, B.u1];
      if (Math.min(c1, e1) - Math.max(c0, e0) <= 0) continue; // no overlap across
      if (b0 >= a1 - 1e-9 && b0 - a1 < THIN_WALL_IN * 4) { a1 = Math.max(a1, b1); joined++; } else if (b1 <= a0 + 1e-9 && a0 - b1 < THIN_WALL_IN * 4) { a0 = Math.min(a0, b0); joined++; }
    }
    if (joined) {
      dr.item.loop = alongU ? rectLoop(a0, c0, a1, c1) : rectLoop(c0, a0, c1, a1);
      dr.feature.label += `; runs into the web dado at ${joined === 2 ? 'both ends' : 'one end'} (one continuous pocket at the corner)`;
      dr.feature.at = [alongU ? [(a0 + a1) / 2, (c0 + c1) / 2] : [(c0 + c1) / 2, (a0 + a1) / 2]];
    }
  }

  // Thin walls between pockets (axis-aligned rectangles here).
  const pk = d_pockets(items);
  for (let a = 0; a < pk.length; a++) for (let b = a + 1; b < pk.length; b++) {
    const A = bbox(pk[a].loop), B = bbox(pk[b].loop);
    const gu = Math.max(B.u0 - A.u1, A.u0 - B.u1), gv = Math.max(B.v0 - A.v1, A.v0 - B.v1);
    const gap = gu > 0 && gv > 0 ? Math.hypot(gu, gv) : Math.max(gu, gv);
    if (gap > 0 && gap < THIN_WALL_IN) notes.push(`${pk[a].label} and ${pk[b].label}: only ${fmt(gap)} in of wood between the two pockets; check it against the model.`);
  }

  for (const g of edgeGroups.values()) {
    const tos = [...new Set(g.to)];
    notes.push(`${g.type} -> ${tos.length > 3 ? `${tos.slice(0, 3).join(', ')} +${tos.length - 3}` : tos.join(', ')} (x${g.count}): ${g.size ?? ''}${g.note ? ` ${g.note}` : ''}`.trim());
    features.push({ kind: 'note', label: `${g.type}: ${g.size ?? g.note ?? ''}`, count: g.count, to: tos.join(','), joint: g.type });
  }

  // The face being cut: the face most pockets are on, else the legend's face, else the plain view.
  let face: '+' | '-' = fr.plainFace;
  const plus = pocketFaces.filter((x) => x === '+').length, minus = pocketFaces.length - plus;
  if (plus > minus) face = '+'; else if (minus > plus) face = '-';
  else if (part.legend && f.normalAxis === 'z') face = '+';
  const mirror = face !== fr.plainFace;

  // R8: engraving.
  let engrave: PartDrawing['engrave'];
  if (part.legend) {
    const lg = part.legend;
    const st = strokeText(lg.text, lg.letterHeightIn);
    engrave = { strokes: st.strokes, depthIn: lg.depthIn, text: lg.text };
    features.push({ kind: 'engrave', label: `Engrave "${lg.text}" on the ${lg.face} face, ${fmt(lg.letterHeightIn)} in letters, ${fmt(lg.depthIn)} in deep, single-stroke on-line (${lg.process}). Use a 1/8 in straight bit, on the line (a 60 degree V bit makes a 0.035 in hairline at this depth); ${fmt(lg.depthIn)} in is within Origin's depth error of a 4 mm face veneer, so test on an offcut first`, count: st.strokes.length, depthIn: lg.depthIn, bit: '1/8 in straight bit, on-line' });
    if (st.widthIn > W - 1) notes.push(`legend is ${fmt(st.widthIn)} in wide on a ${fmt(W)} in panel: check the fit.`);
  }

  // Centerlines and the grain arrow (guides).
  items.push({ k: 'line', pts: [[W / 2, 0], [W / 2, H]], dashed: true, label: 'centerline' }, { k: 'line', pts: [[0, H / 2], [W, H / 2]], dashed: true, label: 'centerline' });
  if (f.grain) {
    const len = Math.min(3, (f.grain === 'u' ? W : H) * 0.4);
    const a: Vec2 = f.grain === 'u' ? [W / 2 - len / 2, H * 0.25] : [W * 0.25, H / 2 - len / 2];
    const b: Vec2 = f.grain === 'u' ? [a[0] + len, a[1]] : [a[0], a[1] + len];
    const d = f.grain === 'u' ? [1, 0] : [0, 1];
    const h1: Vec2 = [b[0] - 0.12 * d[0] - 0.06 * d[1], b[1] - 0.12 * d[1] - 0.06 * d[0]], h2: Vec2 = [b[0] - 0.12 * d[0] + 0.06 * d[1], b[1] - 0.12 * d[1] + 0.06 * d[0]];
    items.push({ k: 'line', pts: [a, b], label: 'grain' }, { k: 'line', pts: [h1, b, h2], label: 'grain arrow' }, { k: 'tag', at: f.grain === 'u' ? [a[0], a[1] + 0.12] : [a[0] + 0.12, (a[1] + b[1]) / 2], text: `GRAIN along the ${fmt(f.grain === 'u' ? W : H)}"`, size: 0.12 });
  }

  // The face to put UP, in plain words (the part-local "+z face" means nothing at the bench). It matters when a pocket or the legend is on one face.
  const cutFaceMatters = pocketFaces.length > 0 || !!part.legend;
  const facing = facingWords(part, fr, face);
  const cutFace = cutFaceMatters
    ? `${facing} face UP${part.legend ? ' (the engraved face)' : ' (the face with the dados / mortises)'}`
    : `either face can go up (no dado or mortise on a face); the drawing is the ${facing} face`;

  for (const x of features) if (x.bit && x.bit !== 'drill') x.label += ` [bit: ${x.bit}]`;
  return { part, f, items, features, notes, mirror, face, engrave, cutFace, cutFaceMatters, deepCut };
}

/** Plain words for the model-frame direction a face of the part points, e.g. "FORWARD (bow-side)". */
function facingWords(part: Part, fr: Frame, face: '+' | '-'): string {
  const m = part.transform, sgn = face === '+' ? 1 : -1;
  const n = [m[fr.nIdx * 4] * sgn, m[fr.nIdx * 4 + 1] * sgn, m[fr.nIdx * 4 + 2] * sgn];
  const k = [0, 1, 2].reduce((b, i) => (Math.abs(n[i]) > Math.abs(n[b]) ? i : b), 0);
  if (k === 0) return n[0] > 0 ? 'FORWARD (bow-side)' : 'REAR (stern-side)';
  if (k === 2) return n[2] > 0 ? 'TOP' : 'BOTTOM';
  const bb = worldAABB(part), yc = (bb.min[1] + bb.max[1]) / 2;
  if (Math.abs(yc) > 2) return n[1] * yc > 0 ? 'OUTBOARD (hull-outside)' : 'INBOARD (hull-inside)';
  return n[1] > 0 ? 'LEFT-side (+y)' : 'RIGHT-side (-y)';
}

const d_pockets = (items: Item[]): Array<Extract<Item, { k: 'pocket' }>> => items.filter((i): i is Extract<Item, { k: 'pocket' }> => i.k === 'pocket');

interface PocketResult { loops: Vec2[][]; depth: number; desc: string; runOut?: boolean; deckRun?: boolean; web?: boolean }

/** The highest v the outline reaches within u0..u1 (to run a vertical pocket out through the top edge). */
function topOfOutline(outer: Vec2[], u0: number, u1: number): number {
  let top = -Infinity;
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i], b = outer[(i + 1) % outer.length];
    for (const u of [u0, u1]) {
      if ((a[0] - u) * (b[0] - u) > 0 || Math.abs(b[0] - a[0]) < 1e-12) continue;
      top = Math.max(top, a[1] + ((b[1] - a[1]) * (u - a[0])) / (b[0] - a[0]));
    }
  }
  return top;
}

/** The pocket shape for a dado or mortise joint (rule R6), or null when it cannot be derived. */
function pocketFor(fr: Frame, j: { type: string; size?: string }, mate: Part | undefined, got: { uv: Vec2; local: Vec3 }, outer: Vec2[]): PocketResult | null {
  const size = j.size ?? '';
  if (j.type === 'mortise-tenon') {
    const mt = parseMortise(size);
    if (!mt) return null;
    // Thin across the rail (model Y), wide along the other pattern axis.
    const dY = fr.dirToPattern([0, 1, 0]);
    const thinOnU = Math.abs(dY[0]) >= Math.abs(dY[1]);
    const [c0, c1] = got.uv;
    const hu = (thinOnU ? mt.thin : mt.wide) / 2, hv = (thinOnU ? mt.wide : mt.thin) / 2;
    return { loops: [rectLoop(c0 - hu, c1 - hv, c0 + hu, c1 + hv)], depth: mt.depth, desc: `${fmt(mt.thin)} x ${fmt(mt.wide)} x ${fmt(mt.depth)} deep loose-tenon mortise` };
  }
  const dd = parseDadoSize(size);
  if (!dd || !mate) return null;
  const mg = mate.geometry;
  const modelAt = fr.toModel(got.local);
  if (mg.type === 'mesh' && mg.profile) {
    // A web's stopped dado: lateral station of the joint, the web's z range at its end nearest this part, across the dado width.
    const xs = mg.profile.map((q) => q[0]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const xPart = fr.toModel([0, 0, 0])[0];
    const xEnd = Math.abs(xPart - xmax) < Math.abs(xPart - xmin) ? xmax : xmin;
    const zs = mg.profile.filter((q) => Math.abs(q[0] - xEnd) < 1e-6).map((q) => q[1]);
    if (!zs.length) return null;
    const z0 = Math.min(...zs), z1 = Math.max(...zs);
    const a = fr.modelToPattern([modelAt[0], modelAt[1], z0]);
    let b = fr.modelToPattern([modelAt[0], modelAt[1], z1]);
    // "out through the top edge": the dado is open at the top, so it runs 0.03 in past the outline there instead of stopping short of a thin wall at the rounded corner.
    const runOut = /out through the top edge/.test(size) && Math.abs(b[0] - a[0]) < 1e-6 && b[1] > a[1];
    if (runOut) b = [b[0], Math.max(b[1], topOfOutline(outer, b[0] - dd.width / 2, b[0] + dd.width / 2) + 0.03)];
    return { loops: [rectAlong(a, b, dd.width)], depth: dd.depth, web: true, ...(runOut ? { runOut } : {}), desc: `${fmt(dd.width)} wide ${runOut ? 'dado open at the top (runs out through the top edge)' : 'stopped dado'}, ${fmt(Math.hypot(b[0] - a[0], b[1] - a[1]))} long (the ${mate.id} end, z ${fmt(z0)} to ${fmt(z1)})` };
  }
  if (mg.type === 'extrusion') {
    // A deck-type sheet: the dado runs the sheet's width at its end nearest this part.
    const mm = mate.transform;
    const pts = mg.outline.map(([x, y]): Vec3 => [mm[0] * x + mm[4] * y + mm[12], mm[1] * x + mm[5] * y + mm[13], mm[2] * x + mm[6] * y + mm[14]]);
    const xs = pts.map((q) => q[0]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const xPart = fr.toModel([0, 0, 0])[0];
    const xEnd = Math.abs(xPart - xmax) < Math.abs(xPart - xmin) ? xmax : xmin;
    const ys = pts.filter((q) => Math.abs(q[0] - xEnd) < 1e-6).map((q) => q[1]);
    if (!ys.length) return null;
    const a = fr.modelToPattern([modelAt[0], Math.min(...ys), modelAt[2]]), b = fr.modelToPattern([modelAt[0], Math.max(...ys), modelAt[2]]);
    const deckRun = /into the web dado/.test(size);
    return { loops: [rectAlong(a, b, dd.width)], depth: dd.depth, ...(deckRun ? { deckRun } : {}), desc: `${fmt(dd.width)} wide ${deckRun ? 'dado' : 'closed-end dado'} across the ${mate.id} end, ${fmt(Math.hypot(b[0] - a[0], b[1] - a[1]))} long` };
  }
  return null;
}

// ── Rendering ──


/** The SVG body (shapes, no title) for a drawing, in the part's own coordinates. */
export function renderBody(d: PartDrawing): string {
  const { f } = d;
  const W = f.widthIn, H = f.heightIn;
  const xf: Xf = ([u, v]) => [d.mirror ? W - u : u, H - v];
  const depth = shaperCutDepth(f.thicknessIn);
  const out: string[] = [];
  const g0: string[] = [];
  const texts: string[] = [];
  out.push(`<g id="outside">${pathEl({ cutType: 'outside', d: polyD(f.outer, xf), depthIn: depth, label: d.deepCut ? `Outline (DEEP CUT: Shaper-cut ${fmt(depth)} in deep from one face, finish with a bandsaw and a flush-trim bit)` : 'Outline' })}</g>`);
  const pockets = d.items.filter((i): i is Extract<Item, { k: 'pocket' }> => i.k === 'pocket');
  if (pockets.length) out.push(`<g id="pockets">${pockets.map((q) => pathEl({ cutType: 'pocket', d: polyD(q.loop, xf), depthIn: q.depth, label: q.label })).join('')}</g>`);
  const inside = d.items.filter((i) => i.k === 'cutHole' || i.k === 'cutLoop');
  if (inside.length) out.push(`<g id="inside">${inside.map((i) => (i.k === 'cutHole' ? pathEl({ cutType: 'inside', d: circleD(i.c, i.dia, xf), depthIn: depth }) : i.k === 'cutLoop' ? pathEl({ cutType: 'inside', d: polyD(i.loop, xf), depthIn: depth }) : '')).join('')}</g>`);
  if (d.engrave) {
    const e = d.engrave;
    // The ink, not the advance width, is centered on the panel (the last letter's side bearing made the old layout sit 0.1 in left).
    const eb = bbox(e.strokes.flat());
    const cxI = (eb.u0 + eb.u1) / 2, cyI = (eb.v0 + eb.v1) / 2;
    const exf: Xf = ([x, y]) => [W / 2 + (x - cxI), H / 2 - (y - cyI)]; // engraving is laid out in the view (what you see on the face), so it reads correctly
    out.push(`<g id="engrave">${e.strokes.map((s) => pathEl({ cutType: 'online', d: polyD(s, exf, false), depthIn: e.depthIn, label: `engrave ${e.text}` })).join('')}</g>`);
    // On-line paths are black strokes, so they cannot be seen on the black outline: a guide box and a label show where the lettering is.
    g0.push(guideEl(polyD(rectLoop(eb.u0 - 0.15, eb.v0 - 0.15, eb.u1 + 0.15, eb.v1 + 0.15), exf), { dashed: true, label: 'engraving area' }));
    texts.push(textEl(exf([eb.u0 - 0.15, eb.v1 + 0.3]), `ENGRAVE "${e.text}" ${fmt(e.depthIn)} in deep (on-line, black strokes)`, 0.14, { guide: true }));
  }
  const g: string[] = [...g0];
  for (const i of d.items) {
    if (i.k === 'line') g.push(guideEl(polyD(i.pts, xf, !!i.closed), { dashed: i.dashed, label: i.label }));
    else if (i.k === 'drill') {
      const r = i.dia / 2 + 0.08;
      const hidden = i.onFace !== undefined && i.onFace !== d.face;
      g.push(guideEl(circleD(i.c, i.dia, xf), { dashed: hidden || i.approx, label: i.label ?? (hidden ? 'drill (hidden face)' : 'drill') }));
      g.push(guideEl(polyD([[i.c[0] - r, i.c[1]], [i.c[0] + r, i.c[1]]], xf, false)) + guideEl(polyD([[i.c[0], i.c[1] - r], [i.c[0], i.c[1] + r]], xf, false)));
    } else if (i.k === 'tag') {
      const p = xf(i.at);
      texts.push(textEl(p, i.text, i.size ?? 0.13, { guide: true }));
    }
  }
  out.push(`<g id="guides">${g.join('')}</g>`);
  if (texts.length) out.push(`<g id="tags" ${ANNOTATION_ATTRS}>${texts.join('')}</g>`);
  return out.join('\n');
}

/** "grain along the 18.5" length (horizontal in this drawing)": the grain direction in plain words. */
export function grainWords(f: FlatPattern): string {
  if (!f.grain) return 'grain not specified';
  const along = f.grain === 'u' ? f.widthIn : f.heightIn, across = f.grain === 'u' ? f.heightIn : f.widthIn;
  const noun = Math.abs(along - across) < 0.01 ? 'side' : along > across ? 'length' : 'width';
  return `grain along the ${fmt(along)}" ${noun} (${f.grain === 'u' ? 'horizontal' : 'vertical'} in this drawing)`;
}

function titleLines(d: PartDrawing, qty: number): string[] {
  const { part, f } = d;
  const lines = [
    `${part.name}`,
    `partNo ${f.partNo}   qty ${qty}   ${part.material}   ${fmt(f.thicknessIn)} in thick`,
    `${fmt(f.widthIn)} x ${fmt(f.heightIn)} in   ${grainWords(f)}`,
    d.cutFaceMatters ? `Cut with the ${d.cutFace}. Drawing seen from that face.` : `Cut face: ${d.cutFace}.`,
  ];
  if (qty > 1) lines.push(`${qty} identical pieces from this one file: cut ${qty}, do not mirror.`);
  if (f.tongueIn) lines.push(`CUT SIZE: includes the ${fmt(f.tongueIn)} in tongue on every side; visible panel ${fmt(f.widthIn - 2 * f.tongueIn)} x ${fmt(f.heightIn - 2 * f.tongueIn)} in (dashed guide).`);
  if (d.deepCut) lines.push(`DEEP CUT: Shaper-cut ${fmt(shaperCutDepth(f.thicknessIn))} in deep from one face, then bandsaw and flush-trim (pattern) bit.`);
  return lines;
}

/** A complete Shaper SVG for one drawing. */
export function renderDocument(d: PartDrawing, qty: number): string {
  const { f } = d;
  const W = f.widthIn, H = f.heightIn;
  const lines = titleLines(d, qty);
  const size = Math.min(0.22, Math.max(0.09, Math.min(W / 40, H / 16)));
  // The title and the notes sit BELOW the part, outside the cut area (R12): text over the black outline was unreadable and put human text on the part.
  const title = lines.map((l, i) => textEl([0, H + 0.3 + i * size * 1.25], l, size, { bold: i === 0, guide: true })).join('');
  const noteSize = 0.14;
  const y0 = H + 0.3 + lines.length * size * 1.25 + 0.25;
  const noteEls = d.notes.slice(0, 40).map((n, i) => textEl([0, y0 + i * noteSize * 1.35], n.length > 190 ? `${n.slice(0, 187)}...` : n, noteSize, { guide: true })).join('');
  const desc = [
    ...lines, '', 'Features:', ...d.features.map((x) => `- ${x.label}${x.count > 1 ? ` (x${x.count})` : ''}`), '', 'Edge joints and notes (not Shaper features):', ...d.notes, '',
    'The <text> in this file is human annotation only: it is stroke-only text in a group marked as a guide (shaper:cutType="guide"), outside the cut area, and never a cut path.',
  ].join('\n');
  const body = `${renderBody(d)}\n<g id="annotations" ${ANNOTATION_ATTRS}>${title}${noteEls}</g>`;
  return svgDocument({ widthIn: W, heightIn: H, title: `${f.name} (${f.partNo})`, desc, body });
}

/** Strip the text-bearing, qty-dependent parts of a drawing to compare two parts for being the same cut. */
const signature = (d: PartDrawing): string => `${d.mirror}|${renderBody(d)}`;

/** One Shaper file per part number; parts with the same part number whose drawings differ (mirror images) get their own files. */
export function shaperFiles(parts: Part[], p: Params): ShaperFile[] {
  const shaper = parts.filter((x) => x.fab === 'shaper-origin');
  const groups = new Map<string, PartDrawing[]>();
  for (const part of shaper) {
    const d = analyzeShaperPart(part, parts, p);
    if (!d) continue;
    const no = part.partNo ?? part.id;
    if (!groups.has(no)) groups.set(no, []);
    groups.get(no)!.push(d);
  }
  const files: ShaperFile[] = [];
  for (const [partNo, ds] of groups) {
    const classes = new Map<string, PartDrawing[]>();
    for (const d of ds) {
      const k = signature(d);
      if (!classes.has(k)) classes.set(k, []);
      classes.get(k)!.push(d);
    }
    const separate = classes.size > 1;
    for (const members of classes.values()) {
      // One file serves several identical pieces (the L and R webs, signs, grab boards): "the drawing is the inboard face" is true of only one of them, so a file with no face feature says only that either face can go up.
      const d = members.length > 1 && !members[0].cutFaceMatters ? { ...members[0], cutFace: 'either face can go up (nothing is cut on a face)' } : members[0];
      files.push({
        partId: d.part.id, partNo, qty: members.length, partIds: members.map((m) => m.part.id),
        fileName: `${separate ? d.part.id : partNo}.svg`, svg: renderDocument(d, members.length), widthIn: d.f.widthIn, heightIn: d.f.heightIn, features: d.features,
        cutFace: d.cutFace, cutFaceMatters: d.cutFaceMatters, bits: [...new Set(d.features.map((x) => x.bit).filter((b): b is string => !!b))], deepCut: d.deepCut,
      });
    }
  }
  return files;
}
