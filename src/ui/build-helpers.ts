/**
 * Pure helpers for the Build panel (no DOM, no CSS import), so they run headless under vitest.
 * Formatting, the SVG preview transforms, the nesting drawing, the print-view markup and the step-through focus.
 */
import type { Dims } from '../model/types';
import type { NestedSheet } from '../build/nesting';
import type { BuildStep, StepView } from '../build/assembly';
import { HARDENERS, cumulativeParts, stepParts, type Cure } from '../build/assembly';
import type { ShaperFeature } from '../build/shaper-svg';
import type { VerifyCheck, VerifyWhen } from '../build/verify';
import { fracIn } from '../build/cutlist';

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Formatting ────────────────────────────────────────────────────────────────

/** `1-3/16 × 6 × 24` (sixteenths as fractions, other values as decimals). */
export const dims3 = (d: Dims): string => `${fracIn(d.t)} × ${fracIn(d.w)} × ${fracIn(d.l)}`;

export function usd(v: number, cents = true): string {
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return `${v < 0 ? '-' : ''}$${s}`;
}

export const pct = (v: number, dp = 0): string => `${(v * 100).toFixed(dp)}%`;

export function bytesLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function hours([lo, hi]: [number, number]): string {
  return lo === hi ? `${lo} h` : `${lo}-${hi} h`;
}

/** `West 206 slow: pot life 20-25 min, clamp 8-10 h, full cure 24 h` (the Build tab and the build book print the same line). */
export function cureLine(c: Cure): string {
  return `West ${HARDENERS[c.hardener].label}: pot life ${c.potMin[0]}-${c.potMin[1]} min, clamp ${hours(c.clampHours)}, full cure ${c.fullHours} h`;
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

/**
 * A 4 x 8 sheet drawn long side across, to scale (1 unit = 1 in): sheet outline, the true part outlines (holes cut out),
 * a label and a grain arrow per part. Sheet x runs along the 96 in length, y along the 48 in width.
 */
export function sheetSvg(sheet: NestedSheet): string {
  const W = sheet.lengthIn, H = sheet.widthIn;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${W + 2} ${H + 2}" width="100%" class="bp-svg bp-sheet" role="img" aria-label="${esc(`${sheet.label} sheet ${sheet.index + 1}: ${sheet.placements.length} parts, ${sheet.utilizationPct.toFixed(0)}% used`)}">`);
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#fff" stroke="#000" stroke-width="0.4"/>`);
  const o = sheet.offcut.largest;
  if (o.widthIn > 0 && o.heightIn > 0) {
    out.push(`<rect x="${o.x.toFixed(2)}" y="${o.y.toFixed(2)}" width="${o.widthIn.toFixed(2)}" height="${o.heightIn.toFixed(2)}" fill="none" stroke="#0068ff" stroke-width="0.25" stroke-dasharray="1.2 0.8"/>`);
    if (o.widthIn > 20 && o.heightIn > 6) out.push(`<text x="${(o.x + o.widthIn / 2).toFixed(2)}" y="${(o.y + o.heightIn / 2).toFixed(2)}" font-size="2.6" text-anchor="middle" fill="#0050c8" font-family="Helvetica, Arial, sans-serif">offcut ${o.widthIn.toFixed(0)} × ${o.heightIn.toFixed(0)} in</text>`);
  }
  for (const q of sheet.placements) {
    const d = [q.outer, ...q.holes].map((r) => pathOf(r as [number, number][])).join(' ');
    out.push(`<g data-part="${esc(q.partId)}"><title>${esc(`${q.name} (${q.partId}) ${q.widthIn.toFixed(1)} × ${q.heightIn.toFixed(1)} in`)}</title>` +
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
    const fits = q.heightIn >= 3.2 && q.widthIn >= q.partNo.length * 1.25;
    if (fits) out.push(`<text x="${cx.toFixed(2)}" y="${(cy - 0.4).toFixed(2)}" font-size="2.4" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" fill="#000">${esc(q.partNo)}</text>`);
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
}

export function stepFocus(steps: BuildStep[], n: number, reframe: boolean): StepFocus | null {
  const s = steps.find((x) => x.n === n);
  if (!s) return null;
  const visible = cumulativeParts(steps, n);
  return { n, visibleIds: visible.length ? visible : null, highlightIds: stepParts(steps, n), view: s.view, reframe };
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
