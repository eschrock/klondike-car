/**
 * NDS helpers (D-35). Every expected value is worked by hand in its comment from the published coefficients (Table 12.3.3: Fe⊥ = 6,100·G^1.45/√D,
 * Fe∥ = 11,200·G; Table 12.3.1A/B yield modes and Rd; Appendix E tear-out; 3.4.3.3 cleavage), not copied from the code.
 */
import { describe, expect, it } from 'vitest';
import { boltSpacing, cleavageVr, feAtAngle, fePerp, feParallel, groupTearOut, kTheta, lateralZ, rdFactors, rowTearOut } from './nds';

describe('dowel bearing strength (NDS Table 12.3.3), white oak G = 0.68', () => {
  it('G^1.45 = exp(1.45 ln 0.68) = exp(−0.55921) = 0.57166; Fe⊥(⅜") = 6,100 × 0.57166 / √0.375 = 3,487.1 / 0.61237 = 5,694 psi', () => {
    expect(fePerp(0.68, 0.375)).toBeCloseTo(5694.5, 0);
  });
  it('Fe⊥(5/16") = 3,487.1 / 0.55902 = 6,238 psi (a smaller bolt bears at a higher stress: the 1/√D term); Fe⊥(¾") = 3,487.1 / 0.86603 = 4,027 psi (critic: the "4,000" of round 1)', () => {
    expect(fePerp(0.68, 0.3125)).toBeCloseTo(6238, 0);
    expect(fePerp(0.68, 0.75)).toBeCloseTo(4026.6, 0);
  });
  it('Fe∥ = 11,200 × 0.68 = 7,616 psi', () => {
    expect(feParallel(0.68)).toBeCloseTo(7616, 6);
  });
  it('Hankinson at 0° and 90° returns the end values; at 45°: 7,616 × 6,237 / (½·7,616 + ½·6,237) = 47,499,000 / 6,926.5 = 6,858 psi', () => {
    const par = 7616, perp = fePerp(0.68, 0.3125);
    expect(feAtAngle(par, perp, 0)).toBeCloseTo(par, 6);
    expect(feAtAngle(par, perp, 90)).toBeCloseTo(perp, 6);
    expect(feAtAngle(par, perp, 45)).toBeCloseTo(6858, 0);
  });
});

describe('yield modes for a bolt through a steel side plate into oak (single shear)', () => {
  it('Kθ = 1 + ¼·θ/90: 1.0 along the grain, 1.25 across; Rd = 4Kθ (Im, Is), 3.6Kθ (II), 3.2Kθ (IIIm, IIIs, IV)', () => {
    expect(kTheta(0)).toBe(1);
    expect(kTheta(90)).toBe(1.25);
    const r = rdFactors(90);
    expect(r.Im).toBeCloseTo(5, 12);
    expect(r.II).toBeCloseTo(4.5, 12);
    expect(r.IIIs).toBeCloseTo(4, 12);
    expect(r.IV).toBeCloseTo(4, 12);
  });
  it('5/16" bolt, oak 2.5", ⅜" plate, load across the grain (θ = 90°), Fem = 6,237, Fes = 87,000, Fyb = 130,000: Im 974.5, Is 2,039, IIIs 534.8, IV 548.3 → Z = 534.8 lbf (mode IIIs)', () => {
    // Re = 6,237/87,000 = 0.07168. Im = 0.3125 × 2.5 × 6,237 / 5 = 974.5. Is = 0.3125 × 0.375 × 87,000 / 5 = 2,039.
    // k3 = −1 + √(2(1.07168)/0.07168 + 2·130,000·2.07168·0.097656/(3·6,237·0.140625)) = −1 + √(29.90 + 19.99) = 6.063;
    // IIIs = 6.063 × 0.3125 × 0.375 × 6,237 / (2.07168 × 4) = 4,431.5 / 8.2867 = 534.8. IV = 0.097656/4 × √(2·6,237·130,000/(3·1.07168)) = 0.024414 × 22,458 = 548.3.
    const z = lateralZ({ D: 0.3125, lm: 2.5, ls: 0.375, Fem: 6237, Fes: 87000, Fyb: 130000, thetaDeg: 90 });
    expect(z.modes.Im).toBeCloseTo(974.5, 0);
    expect(z.modes.Is).toBeCloseTo(2039, 0);
    expect(z.modes.IIIs).toBeCloseTo(534.8, 0);
    expect(z.modes.IV).toBeCloseTo(548.3, 0);
    expect(z.Z).toBeCloseTo(534.8, 0);
    expect(z.mode).toBe('IIIs');
  });
  it('a thinner plate (3/16", the beam plate) lowers IIIs to 418; a weaker bolt (65 ksi stainless) lowers the ⅜" plate case to 469', () => {
    // 3/16": k3 = −1 + √(29.90 + 2·130,000·2.07168·0.097656/(3·6,237·0.035156)) = −1 + √(29.90 + 79.96) = 9.482; IIIs = 9.482 × 0.3125 × 0.1875 × 6,237/8.2867 = 418.1.
    const thin = lateralZ({ D: 0.3125, lm: 2.5, ls: 0.1875, Fem: 6237, Fes: 87000, Fyb: 130000, thetaDeg: 90 });
    expect(thin.Z).toBeCloseTo(418.1, 0);
    // 65 ksi, ⅜" plate: k3 = −1 + √(29.90 + 9.995) = 5.317; IIIs = 5.317 × 0.3125 × 0.375 × 6,237/8.2867 = 468.9 (mode IV 387.7 is lower: Z = 387.7)
    const weak = lateralZ({ D: 0.3125, lm: 2.5, ls: 0.375, Fem: 6237, Fes: 87000, Fyb: 65000, thetaDeg: 90 });
    expect(weak.modes.IIIs).toBeCloseTo(468.9, 0);
    expect(weak.modes.IV).toBeCloseTo(387.7, 0);
    expect(weak.Z).toBeCloseTo(387.7, 0);
    expect(weak.mode).toBe('IV');
  });
});

describe('row / group tear-out (Appendix E), cleavage (3.4.3.3), spacing (12.5.1)', () => {
  it('row tear-out = n·F\'v·t·s_critical with s_critical the lesser of the end distance and half the spacing: 6 × 318 × 2.5 × (1.5625/2) = 3,727 lbf', () => {
    const r = rowTearOut(6, 318, 2.5, 100, 1.5625);
    expect(r.sCrit).toBeCloseTo(0.78125, 9);
    expect(r.Z).toBeCloseTo(3726.6, 1);
    // a short end distance governs: 0.5" end < half of 1.5" spacing
    expect(rowTearOut(4, 318, 1.59, 0.5, 1.5).sCrit).toBeCloseTo(0.5, 9);
  });
  it('the AWC sample: 3 bolts, 1.5" side member, 150 psi, s_critical 2" → 3 × 150 × 1.5 × 2 = 1,350 lbf', () => {
    expect(rowTearOut(3, 150, 1.5, 2, 4).Z).toBeCloseTo(1350, 6); // spacing 4" → half 2" = the sample's s_critical
  });
  it('group tear-out = ½Z_RT1 + ½Z_RT2 + F\'t·A_net: 1,000 + 1,000 → 1,000 + 500 psi × 2 in² = 2,000 lbf', () => {
    expect(groupTearOut(1000, 1000, 500, 2)).toBeCloseTo(2000, 9);
  });
  it('cleavage V_r = ⅔·F\'v·b·d_e: F\'v = 205 × 0.97 × 1.6 = 318.16 psi, b = 2.5", d_e = 1.25" → 662.8 lbf', () => {
    expect(cleavageVr(205 * 0.97 * 1.6, 2.5, 1.25)).toBeCloseTo(662.8, 1);
  });
  it('spacing: 5/16" bolt, l/D = 8 across the grain: rows 5D = 1.5625", in a row 3D = 0.9375", loaded edge 4D = 1.25"; along the grain: row 4D = 1.25", loaded end 7D = 2.1875"; l/D = 4: (5·1.25 + 10·0.3125)/8 = 1.171875"', () => {
    const perp = boltSpacing(0.3125, 2.5, 'perp');
    expect(perp.betweenRows).toBeCloseTo(1.5625, 9);
    expect(perp.inRow).toBeCloseTo(0.9375, 9);
    expect(perp.loadedEdge).toBeCloseTo(1.25, 9);
    const par = boltSpacing(0.3125, 2.5, 'par');
    expect(par.inRow).toBeCloseTo(1.25, 9);
    expect(par.loadedEnd).toBeCloseTo(2.1875, 9);
    expect(boltSpacing(0.3125, 1.25, 'perp').betweenRows).toBeCloseTo(1.171875, 9);
    expect(boltSpacing(0.3125, 0.5, 'perp').betweenRows).toBeCloseTo(0.78125, 9); // l/D = 1.6 ≤ 2: 2.5D
  });
});

describe('countersink reduction (r3 N-2)', () => {
  it('82° flat head, head diameter 1.92·D: depth = 0.46·D / tan 41° = 0.1654" for 5/16"; the effective plate loses half of it (3/8" → 0.2923")', async () => {
    const { countersinkDepth, effectiveSideThickness } = await import('./nds');
    expect(countersinkDepth(0.3125)).toBeCloseTo((0.46 * 0.3125) / Math.tan((41 * Math.PI) / 180), 9);
    expect(countersinkDepth(0.3125)).toBeCloseTo(0.1654, 3);
    expect(effectiveSideThickness(0.375, countersinkDepth(0.3125))).toBeCloseTo(0.375 - 0.0827, 3);
    expect(effectiveSideThickness(0.375, 0)).toBe(0.375);
  });
});
