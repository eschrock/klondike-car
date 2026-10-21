/**
 * Pure helpers for the Build panel (no DOM, no CSS import), so they run headless under vitest.
 * Formatting, the SVG preview transforms, the nesting drawing, the print-view markup and the step-through focus.
 */
import type { Dims, Part } from '../model/types';
import type { NestedSheet } from '../build/nesting';
import type { BuildStep, StepView } from '../build/assembly';
import { HARDENERS, PART_TOKEN_RE, cumulativeParts, cureTimeText, stepParts, type Cure } from '../build/assembly';
import type { PartDims } from '../build/part-drawings';
import type { ShaperFeature } from '../build/shaper-svg';
import type { VerifyCheck, VerifyWhen } from '../build/verify';
import { fracIn, type Cut, type CutList } from '../build/cutlist';
import { finalDimsText, finalFrac, fractionText, nearest32 } from '../build/units';
import type { WeatherCompare } from '../build/bom';

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Formatting ────────────────────────────────────────────────────────────────

/** " · assembly step 4" (or "steps 4, 6"), or '' when the part is in no step. */
export const stepLabel = (steps: number[]): string => (steps.length ? ` · assembly step${steps.length > 1 ? 's' : ''} ${steps.join(', ')}` : '');
export const dims3 = (d: Dims): string => `${fracDim(d.t)} × ${fracDim(d.w)} × ${fracDim(d.l)}`;
/** The three parts of a size for a table cell: each dimension is one unbreakable piece (`21-5/32`), so a long size wraps between the ×. */
export const dimsParts = (d: Dims): string[] => [fracDim(d.t), fracDim(d.w), fracDim(d.l)];

/** A size a tape can read: the nearest 1/32 as a fraction (`21-5/32`), never a decimal. */
export function fracDim(v: number): string {
  return fractionText(nearest32(v), 32);
}

/** `fracDim` with the inch mark: `21-5/32"`. */
export const fracInch = (v: number): string => `${fracDim(v)}"`;

/** A small size (a hole, a dado width, a depth) as a fraction to the nearest 1/64 with the inch mark: 0.197 -> `13/64"`. */
export const fracInch64 = (v: number): string => `${fractionText(Math.round(v * 64) / 64, 64)}"`;

export function usd(v: number, cents = true): string {
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return `${v < 0 ? '-' : ''}$${s}`;
}

export const pct = (v: number, dp = 0): string => `${(v * 100).toFixed(dp)}%`;

/** Names of the two weather specs (D-73) as the UI and the build book say them. */
export const SPEC_NAME: Record<'standard' | 'extreme', string> = { standard: 'Standard', extreme: 'Extreme weather' };
/** "+2.8 lb" / "-2.8 lb" (a real minus sign), one decimal. */
export const lbDelta = (lb: number): string => `${lb < 0 ? '\u2212' : '+'}${Math.abs(lb).toFixed(1)} lb`;
/**
 * The chip beside the weather toggle (D-73): what the OTHER spec costs against the one on screen. On Standard: "Extreme weather adds $812 (-2.8 lb)"; on Extreme: "Standard saves $812 (+2.8 lb)".
 * The mass is the empty sled's, which differs only through the thin sheet (white oak plywood is heavier than okoume).
 */
export function weatherChipText(c: WeatherCompare): string {
  if (!c.computed) return '';
  return c.activeSpec === 'standard'
    ? `Extreme weather adds ${usd(c.deltaUsd)} (${lbDelta(c.deltaLb)})`
    : `Standard saves ${usd(c.deltaUsd)} (${lbDelta(-c.deltaLb)})`;
}
/** The one-line comparison for the build book and the README: both totals, the difference and the mass. */
export function weatherLine(c: WeatherCompare): string {
  if (!c.computed) return '';
  return `Weather spec: ${SPEC_NAME[c.activeSpec]}. Standard ${usd(c.standardUsd)} (${c.thinSheetStandard}); Extreme weather ${usd(c.extremeUsd)} (${c.thinSheetExtreme}); Extreme adds ${usd(c.deltaUsd)} and ${lbDelta(c.deltaLb)} on the empty sled.`;
}

export function bytesLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function hours([lo, hi]: [number, number]): string {
  return lo === hi ? `${lo} h` : `${lo}-${hi} h`;
}

/** `West 206 slow: pot life 20-25 min, clamp 8-10 h, full cure 24 h` (the Build tab and the build book print the same line); the label carries the brand. */
export function cureLine(c: Cure): string {
  return `${HARDENERS[c.hardener].label}: pot life ${c.potMin[0]}-${c.potMin[1]} min, clamp ${hours(c.clampHours)}, full cure ${cureTimeText(c.fullHours)}`;
}

/** Local calendar date as YYYY-MM-DD (the form title blocks and the README show it). */
export function todayISO(d: Date = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

// ── Shaper previews ───────────────────────────────────────────────────────────

/**
 * Inline-preview markup for a full-size SVG: drop the XML prolog, replace the in-unit width and height of the root with
 * `width="100%"` (the viewBox keeps the aspect), clip to the viewBox, and label it for screen readers. The download keeps the original.
 */
export function previewSvg(svg: string, label: string): string {
  const body = svg.replace(/^\s*<\?xml[^?]*\?>\s*/, '');
  return body.replace(/<svg\b[^>]*>/, (root) => {
    const kept = root
      .replace(/\swidth="[^"]*"/, '')
      .replace(/\sheight="[^"]*"/, '')
      .replace(/\soverflow="[^"]*"/, '')
      .replace(/\srole="[^"]*"/, '')
      .replace(/\saria-label="[^"]*"/, '');
    return kept.replace(/<svg\b/, `<svg width="100%" overflow="hidden" role="img" aria-label="${esc(label)}" class="bp-svg"`);
  });
}

/** One-line feature summary: `outline, 1 hand hole, 4 drill marks, 3 pockets`. */
export function featureSummary(features: ShaperFeature[]): string {
  const n = (k: ShaperFeature['kind']) => features.filter((f) => f.kind === k).reduce((a, f) => a + f.count, 0);
  const bits: string[] = [];
  const add = (count: number, one: string, many: string) => { if (count) bits.push(`${count} ${count === 1 ? one : many}`); };
  if (features.some((f) => f.kind === 'outline')) bits.push('outline');
  add(n('hole'), 'hole', 'holes');
  add(n('drill'), 'drill mark', 'drill marks');
  add(n('pocket'), 'pocket', 'pockets');
  add(n('engrave'), 'engraved stroke', 'engraved strokes');
  add(n('guide'), 'guide', 'guides');
  add(n('note'), 'note', 'notes');
  return bits.join(', ');
}

/** The largest cut depth among a file's features, if any carries one. */
export const maxDepth = (features: ShaperFeature[]): number | undefined => {
  const d = features.map((f) => f.depthIn).filter((v): v is number => typeof v === 'number');
  return d.length ? Math.max(...d) : undefined;
};

// ── Nesting drawing ───────────────────────────────────────────────────────────

const pathOf = (pts: [number, number][]): string => 'M' + pts.map((q) => `${q[0].toFixed(3)},${q[1].toFixed(3)}`).join('L') + 'Z';

/** A part name without its trailing parenthetical, for a label on a drawing: `Left side panel (web)` -> `Left side panel`. */
export const shortName = (name: string): string => name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name;

/**
 * A 4 x 8 sheet drawn long side across, to scale (1 unit = 1 in): sheet outline, the true part outlines (holes cut out),
 * a label and a grain arrow per part. Sheet x runs along the 96 in length, y along the 48 in width.
 */
export function sheetSvg(sheet: NestedSheet): string {
  const W = sheet.lengthIn, H = sheet.widthIn;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${W + 2} ${H + 2}" width="100%" class="bp-svg bp-sheet" role="img" aria-label="${esc(`${sheet.label} sheet ${sheet.index}: ${sheet.placements.length} parts, ${sheet.utilizationPct.toFixed(0)}% used`)}">`);
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#fff" stroke="#000" stroke-width="0.4"/>`);
  const o = sheet.offcut.largest;
  if (o.widthIn > 0 && o.heightIn > 0) {
    out.push(`<rect x="${o.x.toFixed(2)}" y="${o.y.toFixed(2)}" width="${o.widthIn.toFixed(2)}" height="${o.heightIn.toFixed(2)}" fill="none" stroke="#0068ff" stroke-width="0.25" stroke-dasharray="1.2 0.8"/>`);
    if (o.widthIn > 20 && o.heightIn > 6) out.push(`<text x="${(o.x + o.widthIn / 2).toFixed(2)}" y="${(o.y + o.heightIn / 2).toFixed(2)}" font-size="2.6" text-anchor="middle" fill="#0050c8" font-family="Helvetica, Arial, sans-serif">offcut ${o.widthIn.toFixed(0)} × ${o.heightIn.toFixed(0)} in</text>`);
  }
  for (const q of sheet.placements) {
    const d = [q.outer, ...q.holes].map((r) => pathOf(r as [number, number][])).join(' ');
    out.push(`<g data-part="${esc(q.partId)}"><title>${esc(`${q.name}, ${finalFrac(q.widthIn)} × ${finalFrac(q.heightIn)}`)}</title>` +
      `<path d="${d}" fill="#d9c7a0" fill-rule="evenodd" stroke="#000" stroke-width="0.25"/>`);
    const cx = q.x + q.widthIn / 2, cy = q.y + q.heightIn / 2;
    if (q.grain) {
      // arrow along the sheet length (grainAlongLength) or width
      const along = q.grainAlongLength !== false;
      const len = Math.min(along ? q.widthIn : q.heightIn, 14) * 0.7;
      const [x0, y0, x1, y1] = along ? [cx - len / 2, cy + 1.6, cx + len / 2, cy + 1.6] : [cx + 1.6, cy - len / 2, cx + 1.6, cy + len / 2];
      if (len > 2) {
        const ah = 0.9;
        const head = along ? `M${x1},${y1}l${-ah},${-ah / 2}v${ah}z` : `M${x1},${y1}l${-ah / 2},${-ah}h${ah}z`;
        out.push(`<path d="M${x0.toFixed(2)},${y0.toFixed(2)}L${x1.toFixed(2)},${y1.toFixed(2)}" stroke="#5b3a00" stroke-width="0.25"/><path d="${head}" fill="#5b3a00"/>`);
      }
    }
    const label = shortName(q.name);
    const fits = q.heightIn >= 3.2 && q.widthIn >= label.length * 1.25;
    if (fits) out.push(`<text x="${cx.toFixed(2)}" y="${(cy - 0.4).toFixed(2)}" font-size="2.4" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" fill="#000">${esc(label)}</text>`);
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('');
}

// ── Print view ────────────────────────────────────────────────────────────────

/** Letter pages for the print view: each tile SVG (already `8.5in x 11in`) in a page div; no scaling anywhere. */
export function tilePagesHtml(pages: string[]): string {
  return pages.map((svg) => `<div class="bp-tile-page">${svg.replace(/^\s*<\?xml[^?]*\?>\s*/, '')}</div>`).join('');
}

// ── Verify checklist ──────────────────────────────────────────────────────────

export const WHEN_ORDER: VerifyWhen[] = ['before ordering', 'before cutting', 'at assembly'];

export function groupByWhen(checks: VerifyCheck[]): { when: VerifyWhen; checks: VerifyCheck[] }[] {
  return WHEN_ORDER.map((when) => ({ when, checks: checks.filter((c) => c.when === when) })).filter((g) => g.checks.length);
}

const CHECK_KEY = 'klondike-build-verify-done';

/** Ticked check ids (per viewer). Never throws: private windows and blocked storage just return an empty set. */
export function loadDone(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Set<string> {
  try {
    const raw = storage?.getItem(CHECK_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveDone(done: Set<string>, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(CHECK_KEY, JSON.stringify([...done]));
  } catch { /* not persisted: the ticks last until the page closes */ }
}

const STEP_CHECK_KEY = 'klondike-build-step-checks';
const STEP_KEY = 'klondike-build-step';

/** The "Check before moving on" ticks of the Assembly steps (per viewer, same rules as `loadDone`). Keys are `stepN|text`. */
export function loadStepChecks(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Set<string> {
  try {
    const raw = storage?.getItem(STEP_CHECK_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveStepChecks(done: Set<string>, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try { storage?.setItem(STEP_CHECK_KEY, JSON.stringify([...done])); } catch { /* not persisted */ }
}

/** The Assembly step on screen, kept for the tab session (a reload or a phone that slept lands on the same step). */
export function loadStep(storage?: Pick<Storage, 'getItem'>): number {
  try {
    const st = storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
    const v = Number(st?.getItem(STEP_KEY));
    return Number.isInteger(v) && v >= 0 ? v : 0;
  } catch {
    return 0;
  }
}

export function saveStep(n: number, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const st = storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
    st?.setItem(STEP_KEY, String(n));
  } catch { /* not persisted */ }
}

function safeStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}

// ── Assembly step-through ─────────────────────────────────────────────────────

/** What the 3D viewer shows for a step. */
export interface StepFocus {
  n: number;
  /** Part ids to draw (earlier steps solid plus this one); null = the whole model (a preparation step with nothing installed yet). */
  visibleIds: string[] | null;
  /** This step's own parts, tinted. */
  highlightIds: string[];
  /** Camera preset requested by the step (mapped to a viewer view by the caller). */
  view: StepView;
  /** True when this is a new step (frame the camera); false for a refresh after a parameter change. */
  reframe: boolean;
  /** "Show in 3D" on a part chip: tint only these parts and (once, while `frame` is true) frame the camera on them. Cleared by the next step. */
  pin?: { ids: string[]; frame: boolean };
}

export function stepFocus(steps: BuildStep[], n: number, reframe: boolean): StepFocus | null {
  const s = steps.find((x) => x.n === n);
  if (!s) return null;
  const visible = cumulativeParts(steps, n);
  // A preparation step highlights the parts it is for (a form's parts) in the finished sled.
  return { n, visibleIds: visible.length ? visible : null, highlightIds: s.partIds.length ? stepParts(steps, n) : (s.forIds ?? []), view: s.view, reframe };
}

/** The viewer camera for a step: every step view, including `under` (hull inverted, for the running gear), is a viewer view. */
export function viewerView(v: StepView): 'iso' | 'top' | 'side' | 'front' | 'under' {
  return v;
}

/** A step index that survives a parameter change: the same step number if it still exists, else the nearest one. */
export function clampStep(steps: BuildStep[], n: number): number {
  if (!steps.length) return 0;
  if (steps.some((s) => s.n === n)) return n;
  return steps.reduce((best, s) => (Math.abs(s.n - n) < Math.abs(best - n) ? s.n : best), steps[0].n);
}

// ── BOM notes: a short lead, the rest behind a fold ───────────────────────────

/** The longest note shown inline (characters). */
export const NOTE_LEAD_MAX = 140;

/**
 * The first clause of a note, for the line shown inline: a "Buy: ..." note up to its first parenthesis (the buy list itself), any other note up to its first sentence end,
 * either capped at `max` characters on a word boundary. `rest` is what the lead leaves out ('' when the lead is the whole note); `cut` says the lead was shortened mid-sentence.
 */
export function noteLead(text: string, max = NOTE_LEAD_MAX): { lead: string; rest: string; cut: boolean } {
  const t = text.replace(/\s+/g, ' ').trim();
  let end = t.length;
  if (/^Buy:/i.test(t)) {
    const paren = t.indexOf(' (');
    if (paren > 0) end = paren;
  } else {
    const m = /[.!?](?=\s+[A-Z(])/.exec(t); // "...per length. Need 6" ends; "0.792" and "5/8" do not
    if (m) end = m.index + 1;
  }
  let lead = t.slice(0, end).trim();
  let cut = false;
  if (lead.length > max) {
    const space = lead.lastIndexOf(' ', max - 1);
    lead = `${lead.slice(0, space > max / 2 ? space : max - 1).replace(/[\s,;:(]+$/, '')}…`;
    cut = true;
  }
  const rest = cut ? t : t.slice(end).trim();
  return { lead, rest, cut };
}

export type UrlSegment = string | { url: string };

/** Split text into plain strings and raw http(s) URLs (trailing punctuation and a closing parenthesis stay in the text). */
export function splitUrls(text: string): UrlSegment[] {
  const out: UrlSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const raw = m[0].replace(/[).,;:!?]+$/, '');
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ url: raw });
    last = m.index + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const VENDOR_HOSTS: ReadonlyArray<[RegExp, string]> = [
  [/thewoodyard\.com$/i, 'The Wood Yard'], [/aircraftspruce\.com$/i, 'Aircraft Spruce'], [/clinelumber\.com$/i, 'Cline Lumber'],
  [/mcmaster\.com$/i, 'McMaster-Carr'], [/fastenal\.com$/i, 'Fastenal'], [/amazon\.com$/i, 'Amazon'], [/westsystem\.com$/i, 'West System'],
];
/** A short vendor name from a link: a known shop's name, else the host without "www.". '' for anything that is not an http(s) URL. */
export function vendorFromUrl(url: string): string {
  let host = '';
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return '';
    host = u.hostname.replace(/^www\./i, '');
  } catch { return ''; }
  return VENDOR_HOSTS.find(([re]) => re.test(host))?.[1] ?? host;
}

/** Two notes that open with the same first sentence say the same thing for the shop (the tail varies with the parts a line is used on). */
export const sameLead = (a: string | undefined, b: string | undefined): boolean => !!a && !!b && noteLead(a, 400).lead === noteLead(b, 400).lead;

/**
 * The material note most lines of a table share, if it is shared enough to print once (at least 3 lines and half of the lines that carry a note). Notes are compared by
 * their first sentence (`sameLead`); the first full note of the winning sentence is returned.
 */
export function sharedNote(notes: (string | undefined)[]): string | undefined {
  const groups: { note: string; n: number }[] = [];
  let withNote = 0;
  for (const n of notes) {
    if (!n) continue;
    withNote++;
    const g = groups.find((x) => sameLead(x.note, n));
    if (g) g.n++; else groups.push({ note: n, n: 1 });
  }
  const best = groups.reduce<{ note: string; n: number } | undefined>((a, g) => (!a || g.n > a.n ? g : a), undefined);
  return best && best.n >= 3 && best.n * 2 >= withNote ? best.note : undefined;
}

/** Buy-list rows of one product (the same name and note, split into containers: "2 qt" + "1 pt") become one row: "2 qt + 1 pt". Order of first appearance is kept. */
export function mergeBuy<T extends { item: string; unit: string; qty: number; note: string }>(lines: T[]): { item: string; note: string; buy: string }[] {
  const out: { item: string; note: string; parts: string[] }[] = [];
  for (const b of lines) {
    const g = out.find((x) => x.item === b.item && x.note === b.note);
    if (g) g.parts.push(`${b.qty} ${b.unit}`); else out.push({ item: b.item, note: b.note, parts: [`${b.qty} ${b.unit}`] });
  }
  return out.map((g) => ({ item: g.item, note: g.note, buy: g.parts.join(' + ') }));
}


// ── Part chips and popovers ───────────────────────────────────────────────────

/** A piece of instruction text: plain words, or a `{{part-id}}` token resolved to the part's label. */
export type TextSeg = string | { part: string; label: string };

/**
 * Split text at its `{{part-id}}` tokens. The label is the part's running-text name (`partLabel`), capitalized at the start of a sentence exactly as
 * `renderInstrText` does, so the chip reads the same as the flat text. An unknown id keeps its id as the label.
 */
export function instrSegments(text: string, labelOf: (id: string) => string | undefined): TextSeg[] {
  const out: TextSeg[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(PART_TOKEN_RE.source, 'g'))) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const name = labelOf(m[1]) ?? m[1];
    const start = at === 0 || /[.!?]\s+$/.test(text.slice(0, at));
    out.push({ part: m[1], label: start ? name[0].toUpperCase() + name.slice(1) : name });
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The cuts that make up one part (a `Cut` covers every identical part in `ids`). */
export const cutsOfPart = (cuts: Cut[], id: string): Cut[] => cuts.filter((c) => c.ids.includes(id));

/** "board 2 of 3", "layer 1 of 3", "resawn strip", "one piece". */
export function pieceWord(c: Pick<Cut, 'piece' | 'index' | 'of' | 'layer' | 'layers'>): string {
  switch (c.piece) {
    case 'board': return c.of > 1 ? `board ${c.index} of ${c.of}` : 'one board';
    case 'layer': return `layer ${c.layer ?? c.index} of ${c.layers ?? c.of}`;
    case 'strip': return 'resawn strip';
    default: return 'one piece';
  }
}

/** Cuts grouped by the board they are sawn from, thinnest first ('4/4' before '8/4'; anything else last). */
export function groupCutsByBoard(cuts: Cut[]): { board: string; cuts: Cut[] }[] {
  const by = new Map<string, Cut[]>();
  for (const c of cuts) (by.get(c.board) ?? by.set(c.board, []).get(c.board)!).push(c);
  const rank = (b: string): number => { const m = /^(\d+)\/4$/.exec(b); return m ? Number(m[1]) : 99; };
  return [...by].map(([board, list]) => ({ board, cuts: list })).sort((a, b) => rank(a.board) - rank(b.board) || a.board.localeCompare(b.board));
}

/** What a part popover shows. Every field is optional text so a part with no cut-list row (a purchased part) still gets a card. */
export interface PartFacts {
  id: string;
  name: string;
  partNo: string;
  /** Identical parts this card stands for (1 when unique). */
  qty: number;
  /** Finished T × W × L, inches, as shop fractions. */
  size: string;
  /** "board 1 of 3: 3/4 × 5-7/8 × 25-1/2 (4/4)" per rough cut; empty for plywood, metal and purchased parts. */
  cuts: string[];
  board: string;
  grain: string;
  features: string[];
  /** Features beyond the first few (the drawing lists them all). */
  moreFeatures: number;
  /** How many to make and whether the pair is mirrored: "make 2: left and right are mirror images". Empty for a single part. */
  make: string;
}

/**
 * What a card says about how many to make, from the part drawing's own note ("MAKE 2: 1 as drawn (...), 1 MIRROR IMAGE (...)"): "make 2: left and right are mirror images", "make 4: 2 as drawn and
 * 2 mirror images", or "make 3, all the same". Never a part key. Empty for a single part.
 */
export function makeLine(qty: number, makeNote = ''): string {
  if (qty <= 1) return '';
  const m = /MAKE (\d+): (\d+) as drawn.*?(\d+) MIRROR IMAGE/.exec(makeNote);
  if (!m) return `make ${qty}, all the same`;
  return +m[2] === 1 && +m[3] === 1 ? `make ${qty}: left and right are mirror images` : `make ${qty}: ${m[2]} as drawn and ${m[3]} mirror images`;
}

export const POPOVER_FEATURES = 4;

/** Identical lines once, with a count in front when there are several: ["a", "a", "b"] -> ["2 × a", "b"]. */
export function tally(lines: string[]): string[] {
  const n = new Map<string, number>();
  for (const l of lines) n.set(l, (n.get(l) ?? 0) + 1);
  return [...n].map(([l, c]) => (c > 1 ? `${c} × ${l}` : l));
}

/**
 * The popover's facts from the cut list (the rough and finished sizes of the actual cuts) and, when it has run, `partDims` (board, grain, features).
 * Oak comes from `finished` and `cuts`; plywood and metal from their own rows; the size falls back to `partDims`.
 */
export function partFacts(part: Pick<Part, 'id' | 'name' | 'partNo'> | undefined, id: string, cut: CutList | undefined, dims: PartDims | undefined, makeNote = ''): PartFacts {
  const fin = cut?.finished.find((f) => f.ids.includes(id));
  const sheet = cut?.sheets.flatMap((g) => g.rows).find((r) => r.ids.includes(id));
  const metal = cut?.metal.find((r) => r.ids.includes(id));
  const mine = cut ? cutsOfPart(cut.cuts, id) : [];
  const size = fin ? fin.finalText : sheet ? finalDimsText(sheet.final) : metal ? `${metal.section}, cut to ${fracIn(metal.cutLengthIn)}` : dims?.size ?? '';
  const feats = dims?.features ?? [];
  return {
    id,
    name: part?.name ?? id,
    partNo: part?.partNo ?? fin?.partNo ?? sheet?.partNo ?? metal?.partNo ?? '',
    qty: fin?.qty ?? sheet?.qty ?? metal?.qty ?? 1,
    size,
    cuts: tally(mine.map((c) => `${pieceWord(c)}: ${c.roughText} (${c.board})`)),
    board: dims?.board ?? (fin ? `${fin.board} white oak` : ''),
    grain: dims?.grain && dims.grain !== 'n/a' ? dims.grain : fin?.grainWord ?? sheet?.grainWord ?? '',
    features: feats.slice(0, POPOVER_FEATURES),
    moreFeatures: Math.max(0, feats.length - POPOVER_FEATURES),
    make: makeLine(fin?.qty ?? sheet?.qty ?? metal?.qty ?? 1, makeNote),
  };
}

/** The step number that installs a part (the first step whose `partIds` has it), or undefined for a part no step installs. */
export const stepOfPart = (steps: Pick<BuildStep, 'n' | 'partIds'>[], id: string): number | undefined => steps.find((s) => s.partIds.includes(id))?.n;

/**
 * "Show in 3D": the step-through focus with one part pinned. The pinned parts are always drawn (a part whose step comes later is added to the visible set), and
 * they replace the step's own highlight until the next step.
 */
export function pinFocus(f: StepFocus, ids: string[], frame: boolean): StepFocus {
  const visible = f.visibleIds ? [...new Set([...f.visibleIds, ...ids])] : null;
  return { ...f, visibleIds: visible, pin: { ids, frame } };
}

/** A drawing file name for a download: `rail-L-drawing.svg`. */
export const drawingDownloadName = (partNo: string, partId: string): string => `${partNo || partId}-${partId}.svg`.replace(/[^A-Za-z0-9._-]+/g, '-');
