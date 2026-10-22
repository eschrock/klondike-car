/**
 * XTool S1 laser files (D-86): one SVG per laser job, full size, for XCS. Plain TS, no three.js. Pure functions of `(parts, params)`.
 *
 * Two kinds of job:
 *  - a PART the laser can cut (thin sheet that fits the bed): the Shaper Origin file's outline, round holes and inner loops as cuts, drill marks and lettering as scored marks. Dados and pockets are not
 *    laser work (they stay in the Shaper file) and are named in the notes. A part the laser cannot cut because of its thickness gets no file; one that is only too WIDE still gets a file, marked
 *    `fits: false`, in case the real bed takes it.
 *  - a FORM or TEMPLATE (`forms.ts`): the 1/4 in pieces (templates, patterns), laid out on the bed.
 * The cut list (`cutlist.ts`) carries the same `laserVerdict` per plywood row, so the flag and the files cannot disagree.
 */
import type { Params } from '../params';
import type { Part, Vec2 } from '../model/types';
import { analyzeShaperPart, type ShaperFile } from './shaper-svg';
import type { FormDrawing } from './forms';
import { LASER_MAX_WIDTH_IN, emptyShape, laserSvg, laserVerdict, rotateShape, type LaserItem, type LaserShape, type LaserVerdict } from './laser-svg';
import { frac } from './svg-util';
import { fractionText } from './units';

export interface LaserFile {
  /** `side-web`, `rail-form` ... */
  id: string;
  kind: 'part' | 'form';
  title: string;
  /** `laser/<id>.svg` is the archive path; this is the bare file name. */
  fileName: string;
  material: string;
  thicknessIn: number;
  /** Copies cut from this file (a part's quantity; 1 for a form file, whose pieces carry their own counts). */
  qty: number;
  /** Size of the whole file (in): the long axis runs along the conveyor. */
  widthIn: number;
  heightIn: number;
  pieces: Array<{ label: string; widthIn: number; heightIn: number }>;
  /** Whether the file fits the bed. A form file always does (its pieces are split to fit). */
  fits: boolean;
  verdict: LaserVerdict;
  /** Plain words: what is cut, what is scored, what is left to the Shaper or the drill. */
  notes: string[];
  svg: string;
  /** Part ids a part file serves, or the form drawing id. */
  source: string[];
}

const DESC_HEAD = 'XTool S1 laser file. Full size: width and height are real inches. Red = cut through (in XCS set the inner shapes to cut first), blue = score / mark (not cut through), black = the edge of a sawn blank, to line it up (not output). No fills, no text.';

/** The part files: every Shaper-file part the laser can cut (or could, if the bed were wider). */
function partFiles(parts: Part[], p: Params, shaper: ShaperFile[]): LaserFile[] {
  const out: LaserFile[] = [];
  for (const sf of shaper) {
    const part = parts.find((x) => x.id === sf.partIds[0]);
    const d = part && analyzeShaperPart(part, parts, p);
    if (!part || !d) continue;
    const f = d.f;
    const verdict = laserVerdict({ thicknessIn: f.thicknessIn, material: part.material, widthIn: f.widthIn, heightIn: f.heightIn });
    // Too thick or not wood: no file. Too wide only: a file, flagged.
    if (!verdict.ok && !/wider|longer/.test(verdict.text)) continue;
    const W = f.widthIn, H = f.heightIn;
    // View from the cut face, as the Shaper file is drawn (mirror when it is the back).
    const view = (q: Vec2): Vec2 => [d.mirror ? W - q[0] : q[0], q[1]];
    const notes: string[] = [];
    const circles: Array<{ c: Vec2; dia: number }> = [];
    const holes: Vec2[][] = [];
    const marks: Array<{ c: Vec2; dia: number }> = [];
    const score: Vec2[][] = [];
    let hidden = 0, pockets = 0;
    for (const i of d.items) {
      if (i.k === 'cutHole') circles.push({ c: view(i.c), dia: i.dia });
      else if (i.k === 'cutLoop') holes.push(i.loop.map(view));
      else if (i.k === 'drill') { if (i.onFace !== undefined && i.onFace !== d.face) hidden++; else marks.push({ c: view(i.c), dia: i.dia }); }
      else if (i.k === 'pocket') pockets++;
    }
    if (d.engrave) {
      const e = d.engrave;
      let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
      for (const [u, v] of e.strokes.flat()) { u0 = Math.min(u0, u); v0 = Math.min(v0, v); u1 = Math.max(u1, u); v1 = Math.max(v1, v); }
      const cx = (u0 + u1) / 2, cy = (v0 + v1) / 2;
      for (const s of e.strokes) score.push(s.map(([x, y]): Vec2 => [W / 2 + (x - cx), H / 2 + (y - cy)]));
      notes.push(`Lettering "${e.text}" is scored (a light vector pass); the Shaper file engraves it ${frac(e.depthIn)} deep.`);
    }
    if (marks.length) notes.push(`${marks.length} drill mark${marks.length === 1 ? '' : 's'} scored as a circle and cross (not cut): drill them on the drill press.`);
    if (hidden) notes.push(`${hidden} mark${hidden === 1 ? ' is' : 's are'} on the other face: take ${hidden === 1 ? 'it' : 'them'} from the Shaper file.`);
    if (pockets) notes.push(`${pockets} dado${pockets === 1 ? '' : 'es'} or mortise${pockets === 1 ? '' : 's'} in the Shaper file ${pockets === 1 ? 'is' : 'are'} not laser work: cut ${pockets === 1 ? 'it' : 'them'} on the Shaper or router.`);
    notes.push('Glue-footprint lines and tags are in the Shaper file only.');
    let shape: LaserShape = { ...emptyShape(sf.partNo, part.name, d.f.outer.map(view)), circles, holes, marks, score };
    // The long side runs along the conveyor.
    let turned = false;
    if (H > W) { shape = rotateShape(shape); turned = true; }
    if (turned) notes.push('Turned a quarter turn from the Shaper file so the long side runs along the conveyor; the grain turns with it.');
    const qty = sf.qty;
    const items: LaserItem[] = [{ shape, qty }];
    const doc = laserSvg({ title: `${part.name} (${sf.partNo}), laser`, desc: [DESC_HEAD, `${part.material}, ${f.thicknessIn.toFixed(3)} in thick. Cut ${qty}.`, ...notes].join('\n'), items });
    out.push({
      id: sf.partNo, kind: 'part', title: part.name, fileName: `${sf.partNo}.svg`, material: part.material, thicknessIn: f.thicknessIn, qty,
      widthIn: doc.widthIn, heightIn: doc.heightIn, pieces: doc.pieces, fits: verdict.ok, verdict,
      notes: [...(verdict.ok ? [] : [`${verdict.text}. Cut this part on the Shaper; this file is here in case your bed takes it.`]), ...notes],
      svg: doc.svg, source: sf.partIds,
    });
  }
  return out;
}

/** Spacing of the side-by-side score passes that make a lettering line wider than one laser pass (in). */
const LETTER_PASS_IN = 1 / 64;
/** Each stroke as passes offset to either side of it, LETTER_PASS_IN apart, spanning `lineIn` (one pass when `lineIn` is under two spacings). */
export function widenStrokes(strokes: Vec2[][], lineIn: number): Vec2[][] {
  const m = Math.floor(lineIn / 2 / LETTER_PASS_IN + 1e-9);
  if (m < 1) return strokes;
  const out: Vec2[][] = [];
  for (const s of strokes) {
    const nrm = s.map((_, i): Vec2 => {
      const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      return [-dy / L, dx / L];
    });
    for (let k = -m; k <= m; k++) out.push(s.map((q, i): Vec2 => [q[0] + nrm[i][0] * k * LETTER_PASS_IN, q[1] + nrm[i][1] * k * LETTER_PASS_IN]));
  }
  return out;
}

/**
 * Engrave-only jobs: a rectangle sawn on the table saw that carries lettering (the storage lid's DO NOT STEP). The laser only scores the lettering; the blank's edge is drawn in
 * black, not output, to line the sawn blank up on the bed.
 */
function engraveFiles(parts: Part[], p: Params): LaserFile[] {
  const out: LaserFile[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const no = part.partNo ?? part.id;
    if (part.fab === 'shaper-origin' || !part.legend || seen.has(no)) continue;
    const d = analyzeShaperPart(part, parts, p);
    if (!d?.engrave) continue;
    seen.add(no);
    const f = d.f, e = d.engrave;
    const verdict = laserVerdict({ thicknessIn: 0, material: part.material, widthIn: f.widthIn, heightIn: f.heightIn });
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (const [u, v] of e.strokes.flat()) { u0 = Math.min(u0, u); v0 = Math.min(v0, v); u1 = Math.max(u1, u); v1 = Math.max(v1, v); }
    const cx = (u0 + u1) / 2, cy = (v0 + v1) / 2;
    const lineIn = part.legend?.lineIn ?? 0;
    const score = widenStrokes(e.strokes.map((s) => s.map(([x, y]): Vec2 => [f.widthIn / 2 + (x - cx), f.heightIn / 2 + (y - cy)])), lineIn);
    let shape: LaserShape = { ...emptyShape(no, part.name, d.f.outer.map((q): Vec2 => [d.mirror ? f.widthIn - q[0] : q[0], q[1]])), score, frameOnly: true };
    const passes = Math.max(1, 2 * Math.floor(lineIn / 2 / LETTER_PASS_IN + 1e-9) + 1);
    const notes = [`Lettering "${e.text}" only, centered on the blank: each stroke is ${passes > 1 ? `${passes} score passes ${fractionText(LETTER_PASS_IN, 64)}" apart, side by side, so the filled line is about ${fractionText(lineIn, 64)}" wide and reads from a standing position` : 'one score pass'}. Set the power and passes on an offcut first: the letters must come out dark, just through the face veneer (about ${fractionText(e.depthIn, 64)}" deep).`,
      `The blank is sawn on the table saw: lay it on the bed and line it up to the black outline with the framing preview (set the black layer to not output).`];
    if (f.heightIn > f.widthIn) { shape = rotateShape(shape); notes.push('Turned a quarter turn so the long side runs along the conveyor.'); }
    const doc = laserSvg({ title: `${part.name} (${no}), lettering, laser`, desc: [DESC_HEAD, `${part.material}. Engrave only.`, ...notes].join('\n'), items: [{ shape, qty: 1 }] });
    out.push({
      id: `${no}-lettering`, kind: 'part', title: `${part.name}: lettering`, fileName: `${no}-lettering.svg`, material: part.material, thicknessIn: f.thicknessIn, qty: 1,
      widthIn: doc.widthIn, heightIn: doc.heightIn, pieces: doc.pieces, fits: verdict.ok, verdict, notes, svg: doc.svg, source: [part.id],
    });
  }
  return out;
}

/** The form and template files, from the drawings' laser pieces. */
function formFiles(forms: FormDrawing[]): LaserFile[] {
  const out: LaserFile[] = [];
  for (const fd of forms) for (const l of fd.laser ?? []) {
    const items = l.items;
    const count = items.reduce((n, it) => n + it.qty, 0);
    const doc = laserSvg({ title: `${l.title}, laser`, desc: [DESC_HEAD, `${l.material}, ${l.thicknessIn} in thick. ${count} piece${count === 1 ? '' : 's'}.`, ...l.notes].join('\n'), items });
    out.push({
      id: l.id, kind: 'form', title: l.title, fileName: `${l.id}.svg`, material: l.material, thicknessIn: l.thicknessIn, qty: 1,
      widthIn: doc.widthIn, heightIn: doc.heightIn, pieces: doc.pieces, fits: doc.heightIn - 0.25 <= LASER_MAX_WIDTH_IN + 1e-6,
      verdict: { ok: true, text: 'yes' }, notes: l.notes, svg: doc.svg, source: [fd.id],
    });
  }
  return out;
}

/** Every laser job for the design: parts first, then the forms and templates. */
export function laserFiles(parts: Part[], p: Params, shaper: ShaperFile[], forms: FormDrawing[]): LaserFile[] {
  return [...partFiles(parts, p, shaper), ...engraveFiles(parts, p), ...formFiles(forms)];
}
