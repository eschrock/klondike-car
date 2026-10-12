/**
 * Elementary section and beam formulas (strength of materials). Pure functions, inches / pounds / psi.
 */
export interface Section {
  A: number;
  I: number;
  /** Distance to the extreme fibre. */
  c: number;
  /** Section modulus I / c. */
  S: number;
}

export function rectSection(b: number, h: number): Section {
  const I = (b * h ** 3) / 12;
  return { A: b * h, I, c: h / 2, S: I / (h / 2) };
}

export function circleSection(d: number): Section {
  const I = (Math.PI * d ** 4) / 64;
  return { A: (Math.PI * d * d) / 4, I, c: d / 2, S: I / (d / 2) };
}

/** Round tube of outside diameter d and wall w (w >= d/2 is a solid rod). */
export function tubeSection(d: number, w: number): Section {
  const di = Math.max(0, d - 2 * w);
  const I = (Math.PI * (d ** 4 - di ** 4)) / 64;
  return { A: (Math.PI * (d * d - di * di)) / 4, I, c: d / 2, S: I / (d / 2) };
}

/** Bending stress σ = M·c / I. */
export const bendingStress = (M: number, s: Section): number => (M * s.c) / s.I;

/** Peak shear stress of a rectangle, 1.5·V / A. */
export const rectShear = (V: number, b: number, h: number): number => (1.5 * V) / (b * h);

/** Simply supported span, point load P at midspan: M = PL/4, V = P/2, δ = PL³ / 48EI. */
export function ssPointMid(P: number, L: number, EI: number): { M: number; V: number; defl: number } {
  return { M: (P * L) / 4, V: P / 2, defl: (P * L ** 3) / (48 * EI) };
}

/** Simply supported span, total load W spread uniformly over the whole span: M = WL/8, V = W/2, δ = 5WL³ / 384EI. */
export function ssUdlFull(W: number, L: number, EI: number): { M: number; V: number; defl: number } {
  return { M: (W * L) / 8, V: W / 2, defl: (5 * W * L ** 3) / (384 * EI) };
}

/** Simply supported span, uniformly distributed load of intensity w over length a, centerd. */
export function ssUdlCentered(w: number, a: number, L: number, EI: number): { M: number; V: number; defl: number } {
  const aa = Math.min(a, L);
  return {
    M: ((w * aa) / 8) * (2 * L - aa),
    V: (w * aa) / 2,
    defl: ((w * aa) / (384 * EI)) * (8 * L ** 3 - 4 * L * aa * aa + aa ** 3),
  };
}

/** Cantilever with a tip load P at distance a: M = P·a, δ = P·a³ / 3EI. */
export function cantileverTip(P: number, a: number, EI: number): { M: number; defl: number } {
  return { M: P * a, defl: (P * a ** 3) / (3 * EI) };
}

export interface Layer {
  /** Width (across the bending axis) and vertical extent. */
  b: number;
  z0: number;
  z1: number;
  /** Elastic modulus of the layer. */
  E: number;
  /** Free label, e.g. 'oak' or 'ply'. */
  kind: string;
}

export interface TransformedSection {
  /** Neutral axis height. */
  zNa: number;
  /** Second moment about the neutral axis in units of the reference modulus (I_tr = Σ n·(b h³/12 + A d²)). */
  I: number;
  /** Reference modulus E_ref. */
  Eref: number;
  /** EI of the composite. */
  EI: number;
  /** Per layer: modular ratio n = E / E_ref and the distance from the NA to its extreme fibre. */
  layers: { kind: string; n: number; cMax: number }[];
}

/** Transformed-section properties for a vertical stack of rectangles (bending about the horizontal axis). */
export function transformedSection(layers: Layer[], Eref: number): TransformedSection {
  let sumA = 0, sumAz = 0;
  for (const l of layers) {
    const n = l.E / Eref;
    const a = n * l.b * (l.z1 - l.z0);
    sumA += a;
    sumAz += a * (l.z0 + l.z1) / 2;
  }
  const zNa = sumA > 0 ? sumAz / sumA : 0;
  let I = 0;
  for (const l of layers) {
    const n = l.E / Eref;
    const h = l.z1 - l.z0;
    const d = (l.z0 + l.z1) / 2 - zNa;
    I += n * ((l.b * h ** 3) / 12 + l.b * h * d * d);
  }
  return {
    zNa,
    I,
    Eref,
    EI: Eref * I,
    layers: layers.map((l) => ({ kind: l.kind, n: l.E / Eref, cMax: Math.max(Math.abs(l.z0 - zNa), Math.abs(l.z1 - zNa)) })),
  };
}
