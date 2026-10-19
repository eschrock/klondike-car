/**
 * XTool S1 laser files (D-85): one SVG per laser job, full size, for XCS. Plain TS, no three.js. Pure functions of `(parts, params)`.
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

const DESC_HEAD = 'XTool S1 laser file. Full size: width and height are real inches. Red = cut through (in XCS set the inner shapes to cut first), blue = score / mark (not cut through). No fills, no text.';

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
  return [...partFiles(parts, p, shaper), ...formFiles(forms)];
}
