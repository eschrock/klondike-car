import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, sanitizeParam, validateParams, type ParamKey } from './params';
import { createStore, decodeHash, encodeHash } from './state';
import { buildModel } from './model';
import { centerOfGravity, totalMass } from './model/mass';

const keys = Object.keys(PARAM_DEFS) as ParamKey[];

describe('PARAM_DEFS', () => {
  it.each(keys)('%s has min <= default <= max', (k) => {
    const d = PARAM_DEFS[k];
    expect(d.min).toBeLessThanOrEqual(d.default);
    expect(d.default).toBeLessThanOrEqual(d.max);
  });

  it.each(keys.filter((k) => PARAM_DEFS[k].options))('%s options contain the default', (k) => {
    expect(PARAM_DEFS[k].options!.map((o) => o.value)).toContain(PARAM_DEFS[k].default);
  });
});

describe('validateParams', () => {
  it('defaults are free of errors and warnings', () => {
    expect(validateParams(defaultParams())).toEqual([]);
  });
  it('warns on crossed rider masses (the Simple view sweeps every weight) and rejects an over-wide nose', () => {
    const issues = validateParams({ ...defaultParams(), riderGoalMassLb: 150, riderMassLb: 200, autoNoseGeometry: 0, noseWidthIn: 30 });
    expect(issues.filter((i) => i.severity === 'error').map((i) => i.keys[0])).toContain('noseWidthIn');
    expect(issues.filter((i) => i.severity === 'warn').map((i) => i.keys[0])).toContain('riderGoalMassLb');
  });
  it('flags front tires hitting the nose or cabin shoulder at full lock', () => {
    const issues = validateParams({ ...defaultParams(), autoNoseGeometry: 0, noseWidthIn: 18, noseTaperStartIn: 12 });
    expect(issues.filter((i) => i.message.startsWith('Front tires hit'))).toHaveLength(2);
  });
  it('warns when the cart is too wide for the wheel wells', () => {
    const issues = validateParams({ ...defaultParams(), rearTrackIn: 40 });
    expect(issues.some((i) => i.message.startsWith('Overall width'))).toBe(true);
  });
  it('flags a deck too low for the front axle stack', () => {
    const issues = validateParams({ ...defaultParams(), deckHeightIn: 6, frontDeckRaiseIn: 0 });
    expect(issues.some((i) => i.message.startsWith('Front axle stack'))).toBe(true);
  });
});

describe('sanitizeParam', () => {
  it('clamps to min/max', () => {
    expect(sanitizeParam('wheelbaseIn', 1000)).toBe(PARAM_DEFS.wheelbaseIn.max);
    expect(sanitizeParam('wheelbaseIn', -5)).toBe(PARAM_DEFS.wheelbaseIn.min);
  });
  it('snaps option params to the nearest option', () => {
    expect(sanitizeParam('deckPlyIn', 0.4)).toBe(0.354);
  });
  it('falls back to the default for non-finite input', () => {
    expect(sanitizeParam('riderMassLb', NaN)).toBe(PARAM_DEFS.riderMassLb.default);
  });
});

describe('state hash', () => {
  it('is empty for defaults', () => {
    expect(encodeHash(defaultParams())).toBe('');
  });
  it('round-trips non-default values', () => {
    const s = createStore();
    s.set('wheelbaseIn', 52.5);
    s.set('wheelDiameterIn', 10);
    const hash = encodeHash(s.get());
    expect(hash).toContain('wheelbaseIn=52.5');
    expect(hash).not.toContain('riderMassLb');
    expect(decodeHash('#' + hash)).toEqual(s.get());
  });
  it('sanitizes and ignores junk on decode', () => {
    const p = decodeHash('#wheelbaseIn=9999&bogus=1&riderMassLb=&x');
    expect(p.wheelbaseIn).toBe(PARAM_DEFS.wheelbaseIn.max);
    expect(p.riderMassLb).toBe(PARAM_DEFS.riderMassLb.default);
  });
  it('store notifies, persists, unsubscribes and resets', () => {
    const hashes: string[] = [];
    const s = createStore({ persist: (h) => hashes.push(h) });
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.set('wheelbaseIn', 50);
    s.set('wheelbaseIn', 50); // no-op
    expect(calls).toBe(1);
    off();
    s.set('wheelbaseIn', 51);
    expect(calls).toBe(1);
    s.reset();
    expect(s.get()).toEqual(defaultParams());
    expect(hashes.at(-1)).toBe('');
  });
});

describe('buildModel (block model)', () => {
  const parts = buildModel(defaultParams());
  it('returns 4 wheels and a full part set with finite transforms', () => {
    expect(parts.length).toBeGreaterThan(50);
    expect(parts.filter((p) => p.geometry.type === 'wheel')).toHaveLength(4);
    for (const p of parts) {
      expect(p.transform).toHaveLength(16);
      expect(p.transform.every(Number.isFinite)).toBe(true);
    }
  });
  it('clamps the steer angle to lock', () => {
    const p = { ...defaultParams(), steerLockDeg: 20 };
    const fl = buildModel(p, { steerDeg: 50 }).find((x) => x.id === 'wheel-FL')!;
    // Rz(20°): column 0 = [cos, sin, 0]
    expect(fl.transform[0]).toBeCloseTo(Math.cos((20 * Math.PI) / 180), 6);
    expect(fl.transform[1]).toBeCloseTo(Math.sin((20 * Math.PI) / 180), 6);
  });
  it('mass and CG are sane', () => {
    expect(totalMass(parts)).toBeGreaterThan(20);
    const [x, y, z] = centerOfGravity(parts);
    expect(x).toBeGreaterThan(0);
    expect(Math.abs(y)).toBeLessThan(0.5); // brake lever is one-sided
    expect(z).toBeGreaterThan(0);
  });
});
