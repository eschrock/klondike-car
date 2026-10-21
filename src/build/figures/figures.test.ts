import { describe, expect, it } from 'vitest';
import { buildModel } from '../../model';
import { defaultParams } from '../../params';
import { PRE_D72 } from '../../test-fixtures';
import type { Part } from '../../model/types';
import { assemblySteps, type BuildStep } from '../assembly';
import { formDrawings } from '../forms';
import { frac } from '../svg-util';
import { figureStepIds } from './index';
import { figureTexts } from './kit';

const std = defaultParams();
const ext = { ...defaultParams(), weatherSpec: 1 };
const old = { ...ext, ...PRE_D72 };
const cases: Array<[string, Part[], BuildStep[]]> = [std, ext, old].map((p, i) => {
  const parts = buildModel(p);
  return [['standard', 'extreme', 'pre-D72 okoume'][i], parts, assemblySteps(parts, p)];
});

const escRe = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('assembly step figures', () => {
  for (const [name, parts, steps] of cases) {
    const ids = parts.filter((x) => /[-\d]/.test(x.id)).map((x) => x.id);
    const idRe = new RegExp(`(?<![\\w{-])(${ids.map(escRe).join('|')})(?![\\w}-])`);
    const figs = steps.flatMap((s) => s.figures.map((f) => ({ s, f })));

    it(`${name}: every registered step id is a real step, and the steps with figures have them`, () => {
      const have = new Set(steps.map((s) => s.id));
      for (const id of figureStepIds()) if (id !== 'brake-knee-off' || have.has(id)) expect(have.has(id), id).toBe(true);
      expect(figs.length).toBeGreaterThan(5);
    });

    it(`${name}: each figure is a titled, captioned SVG with a unique id`, () => {
      const seen = new Set<string>();
      for (const { s, f } of figs) {
        expect(seen.has(f.id), `${s.id}: ${f.id}`).toBe(false);
        seen.add(f.id);
        expect(f.title.length, f.id).toBeGreaterThan(3);
        expect(f.caption.length, f.id).toBeGreaterThan(40);
        expect(f.svg, f.id).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+(\.\d+)? \d+(\.\d+)?"/);
        expect(f.svg, f.id).toMatch(/<title>[^<]+<\/title>/);
        expect(f.svg, f.id).toMatch(/<\/svg>$/);
        expect(f.svg, f.id).not.toMatch(/NaN|undefined|Infinity/);
        expect(figureTexts(f.svg).length, f.id).toBeGreaterThan(2);
      }
    });

    it(`${name}: figure text follows the build-instructions style (no ids, decimals, param names or unresolved step refs)`, () => {
      const texts = (s: BuildStep): Array<[string, string]> => [
        ...(s.why ? [[`${s.id} why`, s.why] as [string, string]] : []),
        ...s.figures.flatMap((f) => [[`${f.id} caption`, f.caption] as [string, string], ...figureTexts(f.svg).map((t) => [f.id, t] as [string, string])]),
      ];
      for (const s of steps) {
        for (const [where, t] of texts(s)) {
          expect(t, `${where}: ${t}`).not.toMatch(/\b[DAQ]-\d+\b/);
          expect(t, `${where}: ${t}`).not.toMatch(/\d\.\d/);
          expect(t, `${where}: ${t}`).not.toMatch(/\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/);
          expect(t, `${where}: ${t}`).not.toMatch(idRe);
          expect(t, `${where}: ${t}`).not.toMatch(/\[\[|\]\]|\{\{/);
          expect(t, `${where}: ${t}`).not.toMatch(/\b(colour|centre|tyre|metre|grey)\b/i);
        }
      }
    });
  }

  const [, parts, steps] = cases[0];
  const side = steps.find((s) => s.id === 'side-forms')!;

  it('the side-forms step says what the forms are for, where they are used, and highlights the sides', () => {
    const inner = steps.find((s) => s.id === 'sides-inner')!.n, outer = steps.find((s) => s.id === 'sides-outer')!.n;
    expect(side.why).toMatch(/Shop jigs, not sled parts/);
    expect(side.why).toContain(`step ${inner}`);
    expect(side.why).toContain(`step ${outer}`);
    expect(side.forIds).toEqual(expect.arrayContaining(['side-L-web', 'side-R-web', 'side-L-gunwale-in', 'side-R-chine']));
    expect(side.partIds).toEqual([]);
    expect(side.figures.map((f) => f.id)).toEqual(['sides-purpose', 'side-form-setup', 'side-two-ramps', 'side-right-side']);
  });

  it('the side-form figures quote the form drawing: cleat count and spacing, ramp rise', () => {
    const form = formDrawings(parts, std).find((d) => d.id === 'side-form')!;
    const dim = (k: string): number => form.dims.find((q) => q.key === k)!.valueIn;
    const setup = figureTexts(side.figures.find((f) => f.id === 'side-form-setup')!.svg).join(' ');
    expect(setup).toContain(`${dim('cleat-count')} cleats`);
    expect(setup).toContain(frac(dim('cleat-spacing'), 16));
    expect(setup).toContain(frac(dim('ramp-rise'), 8));
  });

  it('the cure sections quote the band sizes from the cut stock', () => {
    const cure1 = figureTexts(steps.find((s) => s.id === 'sides-inner')!.figures[0].svg).join(' ');
    const band = parts.find((x) => x.id === 'side-L-chine-in')!.stock!;
    expect(cure1).toContain(`inner chine band, ${frac(band.t, 16)} × ${frac(band.w, 16)}`);
  });
});
