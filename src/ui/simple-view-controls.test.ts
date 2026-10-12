import { describe, expect, it } from 'vitest';
import { defaultParams, PARAM_DEFS, validateParams, type ParamKey } from '../params';
import { buildModel } from '../model';
import { SCENARIOS } from '../sim/scenarios';
import src from './simple-view.ts?raw';

/**
 * The Simple view's sliders (D-30, D-54) must write real params. `CONTROLS` is private to simple-view.ts (which imports CSS, so it cannot load headless),
 * so this reads the source: every `def: PARAM_DEFS.x` and every store key the controls set must exist in PARAM_DEFS.
 */
const controlsBlock = src.slice(src.indexOf('const CONTROLS: Control[]'), src.indexOf('/** One labeled slider'));
const IDS = ['rider', 'length', 'width', 'wheel', 'floor', 'body'];

describe('Simple view controls map to params', () => {
  it('declares exactly the six controls (rider, length, width, wheel, floor, body); no steering or tongue slider', () => {
    const ids = [...controlsBlock.matchAll(/\bid: '([a-z]+)'/g)].map((m) => m[1]);
    expect(ids).toEqual(IDS);
    expect(controlsBlock).not.toMatch(/steer|tongue|kingpin|ackermann|swivelDeg/i);
  });

  it('every control def and every key it sets is an existing param with a sane range', () => {
    const defs = [...controlsBlock.matchAll(/def: PARAM_DEFS\.(\w+)/g)].map((m) => m[1]);
    const setKeys = [
      ...[...src.matchAll(/(?:setOne|resetOne)\('(\w+)'\)/g)].map((m) => m[1]),
      ...[...controlsBlock.matchAll(/store\.set\('(\w+)'/g)].map((m) => m[1]),
      // The width control replaces the design with both tracks set (D-56): count each key it writes with `: v`.
      ...[...controlsBlock.matchAll(/store\.replace\(\{[^}]*\}\)/g)].flatMap((m) => [...m[0].matchAll(/(\w+TrackIn): v\b/g)].map((k) => k[1])),
    ];
    expect(defs).toHaveLength(IDS.length);
    expect(new Set(defs)).toEqual(new Set(['riderMassLb', 'wheelbaseIn', 'rearTrackIn', 'wheelDiameterIn', 'deckHeightIn', 'bodyWidthIn']));
    for (const k of [...defs, ...setKeys]) {
      const d = PARAM_DEFS[k as ParamKey];
      expect(d, k).toBeDefined();
      expect(d.min, k).toBeLessThan(d.max);
      expect(d.default, k).toBeGreaterThanOrEqual(d.min);
      expect(d.default, k).toBeLessThanOrEqual(d.max);
      expect(d.step, k).toBeGreaterThan(0);
    }
    // The controls get and set the same key.
    expect(new Set(setKeys)).toEqual(new Set(defs));
  });

  it('the width control sets the rear track, and the front track to the same width but never below its default, the steering-clearance minimum (D-58), and resets both', () => {
    const width = controlsBlock.slice(controlsBlock.indexOf("id: 'width'"), controlsBlock.indexOf("id: 'wheel'"));
    expect(width).toMatch(/set: \(store, v\) => store\.replace\(\{ \.\.\.store\.get\(\), frontTrackIn: Math\.max\(v, PARAM_DEFS\.frontTrackIn\.default\), rearTrackIn: v \}\)/);
    expect(width).toMatch(/frontTrackIn: PARAM_DEFS\.frontTrackIn\.default, rearTrackIn: PARAM_DEFS\.rearTrackIn\.default/);
    expect(PARAM_DEFS.frontTrackIn.default).toBeGreaterThanOrEqual(PARAM_DEFS.rearTrackIn.default);
  });

  it('the defaults satisfy the validator with no errors', () => {
    expect(validateParams(defaultParams()).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('each slider default builds a model, and moving a slider to either end builds a model that still has the pivoting front axle, the kingpin and the tongue tie (validator errors are allowed there: they are shown to the user)', () => {
    const p = defaultParams();
    for (const k of ['wheelbaseIn', 'rearTrackIn', 'wheelDiameterIn', 'deckHeightIn', 'bodyWidthIn'] as const) {
      for (const v of [PARAM_DEFS[k].min, PARAM_DEFS[k].max]) {
        const q = { ...p, [k]: v };
        const parts = buildModel(q, {});
        expect(parts.length, `${k}=${v}`).toBeGreaterThan(50);
        for (const id of ['wheel-FL', 'beam-F', 'kingpin', 'king-beam', 'bridle-tongue']) expect(parts.some((x) => x.id === id), `${k}=${v} ${id}`).toBe(true);
        for (const x of parts) {
          expect(Number.isFinite(x.massLb), `${k}=${v} ${x.id}`).toBe(true);
          expect(x.transform.every(Number.isFinite), `${k}=${v} ${x.id}`).toBe(true);
        }
      }
    }
  });

  it('the demo buttons map to scenarios that exist, and none promises a steering lock', () => {
    const demos = [...src.slice(src.indexOf('export const DEMOS'), src.indexOf('/** Numbers the at-a-glance')).matchAll(/\bid: '(\w+)'/g)].map((m) => m[1]);
    expect(demos).toEqual(['tilt', 'turn', 'bump', 'brake']);
    for (const d of demos) expect(SCENARIOS.some((s) => s.id === d), d).toBe(true);
    expect(src.slice(src.indexOf('export const DEMOS'), src.indexOf('/** Numbers the at-a-glance'))).not.toMatch(/full-lock|full lock/i);
  });
});
