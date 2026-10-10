import { describe, expect, it } from 'vitest';
import { bendingStress, cantileverTip, circleSection, rectSection, rectShear, ssPointMid, ssUdlCentered, transformedSection } from './beams';

/** Round to 3 significant figures. */
const s3 = (x: number) => Number(x.toPrecision(3));

describe('hand-calculated beam cases (3 significant figures)', () => {
  // 2" x 4" oak-ish member on its 4" depth, 100" simply supported span, 1000 lb at midspan, E = 1.5e6 psi.
  const sec = rectSection(2, 4);
  it('rectangular section properties', () => {
    expect(s3(sec.I)).toBe(10.7); // 2·4³/12 = 10.667
    expect(s3(sec.S)).toBe(5.33);
    expect(sec.A).toBe(8);
  });
  it('simply supported beam, point load at midspan: M, V, σ, τ, δ', () => {
    const r = ssPointMid(1000, 100, 1.5e6 * sec.I);
    expect(r.M).toBe(25000); // PL/4
    expect(r.V).toBe(500);
    expect(s3(bendingStress(r.M, sec))).toBe(4690); // 25000 / 5.333
    expect(s3(rectShear(r.V, 2, 4))).toBe(93.8); // 1.5·500/8
    expect(s3(r.defl)).toBe(1.3); // 1000·100³ / (48 · 1.5e6 · 10.667) = 1.302
  });
  it('full-length UDL equals wL²/8 and 5wL⁴/384EI', () => {
    const r = ssUdlCentered(10, 100, 100, 1e9);
    expect(r.M).toBeCloseTo(12500, 6);
    expect(r.defl).toBeCloseTo((5 * 10 * 100 ** 4) / (384 * 1e9), 9);
  });
  it('centred partial UDL: 200 lb over 4" on a 12" span', () => {
    // M = (w a / 8)(2L − a) with w = 50 lb/in: 50·4/8 · 20 = 500 lb·in
    expect(ssUdlCentered(50, 4, 12, 1e6).M).toBeCloseTo(500, 9);
  });
});

describe('hand-calculated axle cantilever', () => {
  // 3/4" steel rod, 300 lb at the hub, 2" outboard of the clamp plate edge, E = 29e6.
  const sec = circleSection(0.75);
  it('section: I = πd⁴/64, c = d/2', () => {
    expect(s3(sec.I)).toBe(0.0155);
    expect(sec.c).toBe(0.375);
  });
  it('σ = M·c/I and tip deflection P·a³/3EI', () => {
    const r = cantileverTip(300, 2, 29e6 * sec.I);
    expect(r.M).toBe(600);
    expect(s3(bendingStress(r.M, sec))).toBe(14500); // 600 · 0.375 / 0.015531 = 14,487
    expect(s3(r.defl)).toBe(0.00178); // 2400 / (3 · 29e6 · 0.015531)
  });
});

describe('transformed I-section', () => {
  // Oak flanges 2" wide x 1" (z 0–1 and 4–5), ply web 0.5" x 3" (z 1–4) at half the oak stiffness.
  const t = transformedSection(
    [
      { b: 2, z0: 0, z1: 1, E: 1e6, kind: 'oak' },
      { b: 0.5, z0: 1, z1: 4, E: 0.5e6, kind: 'ply' },
      { b: 2, z0: 4, z1: 5, E: 1e6, kind: 'oak' },
    ],
    1e6,
  );
  it('neutral axis on the symmetry line', () => expect(t.zNa).toBeCloseTo(2.5, 12));
  it('I_tr = 2·(2·1³/12 + 2·1·2²) + 0.5·(0.5·3³/12) = 16.9 in⁴ (oak units)', () => {
    expect(s3(t.I)).toBe(16.9);
    expect(s3(t.EI)).toBe(16.9e6);
  });
  it('modular ratios and extreme fibres', () => {
    expect(t.layers.map((l) => l.n)).toEqual([1, 0.5, 1]);
    expect(t.layers[0].cMax).toBeCloseTo(2.5, 12);
    expect(t.layers[1].cMax).toBeCloseTo(1.5, 12);
  });
  it('a single-material stack reduces to the rectangle', () => {
    const r = transformedSection([{ b: 2, z0: 0, z1: 4, E: 1e6, kind: 'oak' }], 1e6);
    expect(r.I).toBeCloseTo(rectSection(2, 4).I, 12);
  });
});
