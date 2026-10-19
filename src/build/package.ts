/**
 * Phase 4 package: every build output for one design, computed lazily and cached (`BuildData`), plus the file list
 * for "Download all" (`buildPackage`). Plain TS, no DOM and no three.js, so it runs under vitest.
 *
 * Everything is a pure function of `(parts, params)`; the only clock is the `date` the caller passes (shown in the
 * form title blocks and the README). The params hash is the same revision stamp the form drawings print.
 */
import type { Part } from '../model/types';
import type { Params } from '../params';
import { cutList, stepMapOf, type CutList } from './cutlist';
import { nestPlywood, oakBoardFeet, type NestResult, type OakPlan } from './nesting';
import { bom, type Bom } from './bom';
import { SHAPER_MAX_DEPTH_IN, shaperFiles, type ShaperFile } from './shaper-svg';
import { laserFiles, type LaserFile } from './laser';
import { LASER_CUT, LASER_MAX_LENGTH_IN, LASER_MAX_THICKNESS_IN, LASER_MAX_WIDTH_IN, LASER_SCORE } from './laser-svg';
import { formDrawings, tileForLetter, type FormDrawing } from './forms';
import { lampClipStls } from './stl';
import { assemblySteps, type BuildStep } from './assembly';
import { partDrawings, type PartDrawingSheet } from './part-drawings';
import { finishingSchedule, type FinishSchedule } from './finishing';
import { verifyChecklist, type VerifyCheck } from './verify';
import { frac, hash6 } from './svg-util';
import { zipStore } from './zip';
import { buildBookHtml } from './build-book';
import { SPEC_NAME, sheetSvg, weatherLine } from '../ui/build-helpers';

export interface PackageFile {
  /** Path in the archive and the download name. */
  name: string;
  mime: string;
  data: string | Uint8Array;
}

export interface PackageOptions {
  /** ISO date (YYYY-MM-DD) shown in the form title blocks and the README. */
  date?: string;
  /** The shareable design link, quoted in the README. */
  link?: string;
}

export interface FormTiles {
  id: string;
  title: string;
  /** One SVG document per Letter page, in reading order (A1, A2, ...). */
  pages: string[];
}

export interface StlFile {
  partId: string;
  fileName: string;
  stl: Uint8Array;
}

export const SVG_MIME = 'image/svg+xml';
export const CSV_MIME = 'text/csv';
export const TEXT_MIME = 'text/plain';
export const STL_MIME = 'model/stl';
export const HTML_MIME = 'text/html';

/** The Shaper Origin conventions (Eric's answer 1). One copy, used by the README and the Shaper section legend. */
export const SHAPER_CONVENTIONS: { swatch: 'outside' | 'inside' | 'pocket' | 'guide'; name: string; meaning: string }[] = [
  { swatch: 'outside', name: 'Black fill', meaning: 'outside cut (the part outline; the bit stays outside the line)' },
  { swatch: 'inside', name: 'White fill, black stroke', meaning: 'inside cut (holes and hand holes; the bit stays inside the line)' },
  { swatch: 'pocket', name: 'Gray fill', meaning: 'pocket (dado, mortise or recess to the stated depth)' },
  { swatch: 'guide', name: 'Blue stroke', meaning: 'guide line (not cut: drill marks, glue footprints, edge notes)' },
];

/** Notes Eric needs next to the Shaper files (also in the README). */
export const SHAPER_NOTES: string[] = [
  'Every path carries shaper:cutDepth in inches (part thickness plus a breakthrough allowance of about 1/50 in for outside and inside cuts).',
  'Drill marks are blue circles and crosses, not cuts: drill them by hand or on the drill press. A dashed mark is on the face you are NOT cutting.',
  'Edge joints (rabbets, edge dados, bevels, glue faces) are notes under each drawing and in the file description; they are not cut by the Shaper.',
  'Each file is drawn as seen from the face you cut, and says which face goes UP (the bow bulkhead: REAR face up, so its drawing is the mirror image of the part seen from the front; the shared left/right files: either face, do not mirror).',
  'Every pocket, hole and engraving names its bit in the file and the book: 1/8 in straight bit for the narrow web dados, mortises and 17/64 in holes and for the on-line lettering, 1/4 in for the wide deck dados and the 13/32 in holes. Use a bit no wider than the feature.',
  `DEEP CUT parts (the bow bulkhead, the thickest solid): the stock is deeper than a Shaper bit reaches, so the file cuts the outline and hand hole ${SHAPER_MAX_DEPTH_IN} in deep from one face (verify YOUR bit's flute length), then you bandsaw the rest and finish with a flush-trim (pattern) bit riding the wall the Shaper cut.`,
  'All text in these files (titles, tags, notes, dimension labels) is annotation only: stroke-only blue text inside a group marked as a guide, outside the cut area, never a cut path. Origin should ignore it; if it shows glyph outlines they are guides, not cuts. Before the first real cut, import transom-rear.svg once and confirm that only the outline, dados, mortises and holes show as cuts.',
  'VERIFY the insert drill: the six blind insert holes in the seat-back panel are drawn at 5/16 in (assumed) by 11/32 in deep. Check the insert maker\'s drill chart for the exact bit and depth, and test in a scrap of 12 mm okoume, before drilling the panel.',
  'Check the 1:1 scale before cutting: a file is exactly as large as its part (width and height in inches).',
];

/** The XTool S1 file conventions (D-86). One copy, used by the README, the Laser section and the build book. */
export const LASER_CONVENTIONS: { color: string; name: string; meaning: string }[] = [
  { color: LASER_CUT, name: 'Red stroke', meaning: 'cut through (holes and inner loops first, the outline last)' },
  { color: LASER_SCORE, name: 'Blue stroke', meaning: 'score or mark: a light pass for station lines, drill marks and lettering; not cut through' },
];

/** Notes Eric needs next to the laser files (also in the README). */
export const LASER_NOTES: string[] = [
  "Every file is full size and in real inches: its width and height are its true size, and the pieces are laid out along the conveyor (the long side is the X axis). Import it in XCS and check the size XCS shows against the file's size in the list before cutting.",
  `Limits used to flag the cut list and to decide which files exist: pieces up to ${frac(LASER_MAX_WIDTH_IN)} wide and ${frac(LASER_MAX_LENGTH_IN)} long (the S1 conveyor's processing area; the basic 39 in rail set is too short for the 59-1/2 in web and rail patterns, so fit the extension rails) and ${frac(LASER_MAX_THICKNESS_IN)} thick (the machine holds material to 0.55 in, but 1/4 in is the cut-through figure used here). Both are constants in laser-svg.ts: VERIFY them on your machine, change them if they are wrong, and the flags and files follow.`,
  'Give the red strokes your cut setting for the sheet (test it on a scrap of the same plywood first) and the blue strokes a light score setting. In XCS set the inner shapes to cut before the outline (the files list them first, but XCS orders its own paths), so a piece cannot shift as it drops free.',
  'The outlines are drawn exactly as the part is, with no kerf offset. A diode kerf is a fraction of a millimeter; the templates need about 1/32 in, so none is allowed for. Check the first template against the printed drawing.',
  'Templates are cut in 1/4 in Baltic birch plywood rather than hardboard. A piece wider than the bed would be cut in bands that butt on the bench.',
  'Where the laser can only do part of a job (dados, mortises, blind holes, glue-footprint lines) the file notes say so: the Shaper file still has those.',
];

/** Lazy, cached outputs of one design. Each getter computes on first use. `timings` records the milliseconds of each stage that ran. */
export class BuildData {
  readonly timings: Record<string, number> = {};
  private cache = new Map<string, unknown>();
  /** Short hash of the params (same stamp as the form title blocks). */
  readonly revision: string;

  constructor(readonly parts: Part[], readonly p: Params, readonly opts: PackageOptions = {}) {
    this.revision = hash6(JSON.stringify(p));
  }

  private memo<T>(key: string, f: () => T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const t0 = performance.now();
    const v = f();
    this.timings[key] = performance.now() - t0;
    this.cache.set(key, v);
    return v;
  }

  get verify(): VerifyCheck[] { return this.memo('verify', () => verifyChecklist(this.parts, this.p)); }
  /** The cut list with the ASSEMBLY step numbers joined in (`assemblySteps` imports `cutlist.ts`, so the join is here). */
  get cutList(): CutList { return this.memo('cutList', () => cutList(this.parts, this.p, stepMapOf(this.steps))); }
  get nest(): NestResult { return this.memo('nest', () => nestPlywood(this.parts, this.p)); }
  get oak(): OakPlan { return this.memo('oak', () => oakBoardFeet(this.parts, this.p)); }
  get bom(): Bom { return this.memo('bom', () => bom(this.parts, this.p)); }
  get shaper(): ShaperFile[] { return this.memo('shaper', () => shaperFiles(this.parts, this.p)); }
  get laser(): LaserFile[] { return this.memo('laser', () => laserFiles(this.parts, this.p, this.shaper, this.forms)); }
  get forms(): FormDrawing[] { return this.memo('forms', () => formDrawings(this.parts, this.p, { date: this.opts.date })); }
  /** Letter tiles of every form drawing. */
  get tiles(): FormTiles[] {
    return this.memo('tiles', () => this.forms.map((f) => ({ id: f.id, title: f.title, pages: tileForLetter(f.svg, f.widthIn, f.heightIn) })));
  }
  get stls(): StlFile[] {
    return this.memo('stls', () => lampClipStls(this.parts).map((s) => ({ partId: s.part.id, fileName: s.fileName, stl: s.stl })));
  }
  /** One dimensioned drawing per distinct cut (`part-drawings.ts`). The slowest input (a few tenths of a second to seconds): computed on first use only, by the Drawings section, a part popover or the zip. */
  get partDrawings(): PartDrawingSheet[] { return this.memo('partDrawings', () => partDrawings(this.parts, this.p)); }
  get steps(): BuildStep[] { return this.memo('steps', () => assemblySteps(this.parts, this.p)); }
  get finishing(): FinishSchedule { return this.memo('finishing', () => finishingSchedule(this.parts, this.p)); }

  /**
   * `cutlist.csv`: the same three stages as the cut list on screen (the cuts by board, the glue-ups, the finished parts), with the resaw plan, the plywood and the metal,
   * each table under a `# title` line. Every size is a shop fraction.
   */
  get cutlistCsv(): string {
    const c = this.cutList.csv;
    const block = (title: string, csv: string) => `# ${title}\n${csv.replace(/\s+$/, '')}\n`;
    return [
      block('1. Cuts: saw these from the boards (rough sizes round up to 1/8 in)', c.cuts),
      ...(this.cutList.resaw.length ? [block('Resawing the strips: rip the lanes first, then resaw each lane', c.resaw)] : []),
      block('2. Glue-ups', c.glueUps),
      block('3. Finished parts: mill to these sizes', c.finished),
      block('Plywood', c.sheets),
      block('Metal stock', c.metal),
    ].join('\n');
  }

  get files(): PackageFile[] {
    return this.memo('files', () => {
      const files: PackageFile[] = [];
      for (const s of this.shaper) files.push({ name: `shaper/${s.fileName}`, mime: SVG_MIME, data: s.svg });
      for (const f of this.forms) files.push({ name: `forms/${f.fileName}`, mime: SVG_MIME, data: f.svg });
      for (const l of this.laser) files.push({ name: `laser/${l.fileName}`, mime: SVG_MIME, data: l.svg });
      for (const sh of this.partDrawings) files.push({ name: drawingFileName(sh), mime: SVG_MIME, data: sh.svg });
      for (const t of this.tiles) t.pages.forEach((svg, i) => files.push({ name: `forms/tiled/${t.id}-${tileLabel(i, t.pages.length, svg)}.svg`, mime: SVG_MIME, data: svg }));
      for (const s of this.stls) files.push({ name: `stl/${s.fileName}`, mime: STL_MIME, data: s.stl });
      for (const sh of this.nest.sheets) files.push({ name: `nesting/${sh.thicknessMm}mm-sheet-${sh.index}.svg`, mime: SVG_MIME, data: nestingSvgFile(sh) });
      files.push({ name: 'build-book.html', mime: HTML_MIME, data: buildBookHtml(this) });
      files.push({ name: 'cutlist.csv', mime: CSV_MIME, data: this.cutlistCsv });
      files.push({ name: 'bom.csv', mime: CSV_MIME, data: this.bom.csv });
      files.push({ name: 'README.txt', mime: TEXT_MIME, data: readme(this, files.map((f) => f.name)) });
      return files;
    });
  }
}

/** `drawings/<part no>-<part id>.svg`: the lead part's id keeps two drawings under one part number apart. */
export function drawingFileName(sheet: Pick<PartDrawingSheet, 'partNo' | 'partId'>): string {
  const safe = (t: string): string => t.replace(/[^A-Za-z0-9._-]+/g, '-');
  return `drawings/${safe(sheet.partNo)}-${safe(sheet.partId)}.svg`;
}

/** One nesting sheet as a standalone SVG file (the Build tab's drawing, sized to the window when opened). */
function nestingSvgFile(sheet: Parameters<typeof sheetSvg>[0]): string {
  const css = '<style>.bp-svg{background:#fff}</style>';
  return `<?xml version="1.0" encoding="UTF-8"?>\n${sheetSvg(sheet).replace(/^(<svg\b[^>]*>)/, `$1${css}`)}`;
}

/** Page label (A1, A2, ...) read back from the tile's own title, falling back to the page number. */
function tileLabel(i: number, _n: number, svg: string): string {
  const m = /<title>[^<]* page ([A-Z]+\d+)<\/title>/.exec(svg);
  return m ? m[1] : String(i + 1);
}

function readme(d: BuildData, others: string[]): string {
  const lines: string[] = [];
  lines.push('Troop 455 Klondike Derby sled: build package');
  lines.push('============================================');
  lines.push(`Generated: ${d.opts.date ?? '(date not given)'}`);
  lines.push(`Design revision: ${d.revision} (a code made from every design number; the form title blocks print the same stamp)`);
  lines.push(`Weather spec: ${SPEC_NAME[d.bom.spec]} (${d.bom.spec === 'standard' ? 'garage-kept: 304 / 18-8 fasteners, beech Dominos, Titebond III, epoxy only where it earns it, clear spar urethane, no stain' : 'stored outside or near salt: 316, beech Dominos epoxied in, epoxy everywhere, marine varnish'}). Thin sheet: ${d.bom.thinSheetName}.`);
  const wl = weatherLine(d.bom.weatherCompare);
  if (wl) lines.push(wl);
  if (d.opts.link) lines.push(`Design link: ${d.opts.link}`);
  lines.push('');
  lines.push('Every file here was generated from the design on screen at that moment. If you change a number, download again.');
  lines.push('');
  lines.push('Shaper Origin conventions (SVG only)');
  lines.push('------------------------------------');
  for (const c of SHAPER_CONVENTIONS) lines.push(`  ${c.name}: ${c.meaning}`);
  for (const n of SHAPER_NOTES) lines.push(`  - ${n}`);
  lines.push('');
  lines.push('XTool S1 laser files (laser/*.svg, SVG only, full size)');
  lines.push('-------------------------------------------------------');
  for (const c of LASER_CONVENTIONS) lines.push(`  ${c.name}: ${c.meaning}`);
  for (const n of LASER_NOTES) lines.push(`  - ${n}`);
  for (const f of d.laser) lines.push(`  laser/${f.fileName}: ${f.title}${f.fits ? '' : ` (${f.verdict.text})`}`);
  lines.push('');
  lines.push('Printing the full-size forms');
  lines.push('----------------------------');
  lines.push('  forms/*.svg are full size (1:1). forms/tiled/*.svg are Letter pages (A1, A2, ... row letter then column number) with');
  lines.push('  1/2 in overlap and corner crosses: print at 100% (no "fit to page") and measure the 1 in check square on every page.');
  lines.push('  A page with only guide lines or labels (no cut outline and no drill mark) is left out, so the labels can skip a number; the neighbors named on each page are the ones that were printed.');
  lines.push('');
  lines.push('Part drawings');
  lines.push('-------------');
  lines.push('  drawings/*.svg is one dimensioned drawing per distinct cut (identical pieces share a drawing; a left/right pair that differs only by a mirror shares one, marked MAKE 2).');
  lines.push('  Balloon letters on a drawing match its feature list. They are for making and checking a part by hand; the Shaper files (shaper/) are the ones the router reads.');
  lines.push('');
  lines.push('Build book');
  lines.push('----------');
  lines.push('  build-book.html is the whole build on paper: the verify checklist, the cut list, the board shopping list, the plywood nesting drawings, the BOM, the assembly');
  lines.push('  steps, the finishing schedule and the Shaper file index. Open it in a browser and print it (Letter, scale 100%) or save it as a PDF.');
  lines.push('');
  lines.push('Files');
  lines.push('-----');
  for (const n of [...others, 'README.txt']) lines.push(`  ${n}`);
  lines.push('');
  return lines.join('\n');
}

export interface BuildPackage {
  data: BuildData;
  files: PackageFile[];
  /** Total milliseconds each stage took (first computation only). */
  timings: Record<string, number>;
}

/** Build every output and the file list. */
export function buildPackage(parts: Part[], p: Params, opts: PackageOptions = {}): BuildPackage {
  return packageOf(new BuildData(parts, p, opts));
}

/** Force every stage of `data` and return the package view. */
export function packageOf(data: BuildData): BuildPackage {
  for (const stage of [data.verify, data.cutList, data.nest, data.oak, data.bom, data.steps, data.finishing]) void stage;
  const files = data.files;
  return { data, files, timings: data.timings };
}

/** The archive for "Download all (zip)". The date stamps the entries when it parses as YYYY-MM-DD. */
export function zipPackage(data: BuildData): Uint8Array {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.opts.date ?? '');
  return zipStore(data.files.map((f) => ({ name: f.name, data: f.data })), m ? { date: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) } : {});
}

/** `klondike-sled-build-<revision>.zip` */
export const zipName = (data: BuildData): string => `klondike-sled-build-${data.revision}.zip`;
