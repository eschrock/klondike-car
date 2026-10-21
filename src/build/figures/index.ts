/**
 * The figures of each assembly step, by step id. Each area keeps its own file (`sides.ts`, `prep.ts`, `hull.ts`, `gear.ts`, `topside.ts`, `tongue.ts`); a step with no entry has no figures.
 * A figure function returns null when the design has nothing to show (no bow turn-in, no such part), and that figure is left out.
 */
import type { FigCtx, FigFn, StepFigure } from './kit';
import { SIDE_FIGURES } from './sides';
import { PREP_FIGURES } from './prep';
import { HULL_FIGURES } from './hull';
import { GEAR_FIGURES } from './gear';
import { TOPSIDE_FIGURES } from './topside';
import { TONGUE_FIGURES } from './tongue';

/**
 * Built on first use, not at load: some figure files read helpers from `assembly.ts`, which imports this file, so the tables may not exist yet while
 * the modules are still loading.
 */
let registry: Record<string, FigFn[]> | undefined;
function figureTable(): Record<string, FigFn[]> {
  if (registry) return registry;
  const r: Record<string, FigFn[]> = {};
  for (const table of [SIDE_FIGURES, PREP_FIGURES, HULL_FIGURES, GEAR_FIGURES, TOPSIDE_FIGURES, TONGUE_FIGURES]) {
    for (const [id, fns] of Object.entries(table)) (r[id] ??= []).push(...fns);
  }
  return (registry = r);
}

/** The figures for step `id`, in order. A figure that throws is a bug in that figure: it is dropped so the step still renders, and the tests catch it. */
export function stepFigures(id: string, c: FigCtx): StepFigure[] {
  const out: StepFigure[] = [];
  for (const fn of figureTable()[id] ?? []) {
    try {
      const f = fn(c);
      if (f) out.push(f);
    } catch (e) {
      if ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITEST) throw e;
    }
  }
  return out;
}

/** The step ids that have figures (for the tests). */
export const figureStepIds = (): string[] => Object.keys(figureTable());
