/**
 * Shop-fraction display helpers (Eric 2026-10-12: "I do not need 15 21/32 cuts in my rough cut phase").
 * Plain TS. Fractions are written `15-5/8"`, never decimals, except where a caller says so.
 *
 *   ROUGH sizes (what is sawn from the board) round UP to the next 1/8 in: `roughUp8`, `roughFrac`, `roughDimsText`.
 *   FINAL sizes (what the part is milled to) round to the NEAREST 1/32 in for display: `finalFrac`, `finalDimsText`; the exact value stays in a data field.
 */

/** Round `v` UP to a multiple of `step` (a tiny epsilon keeps 16.375 at 16.375 when float noise puts it a hair over). */
export const ceilTo = (v: number, step: number): number => Math.ceil(v / step - 1e-6) * step;
/** Round `v` to the NEAREST multiple of `step`. */
export const nearestTo = (v: number, step: number): number => Math.round(v / step + 1e-9) * step;

/** A rough dimension rounded UP to the next 1/8 in. */
export const roughUp8 = (v: number): number => ceilTo(v, 1 / 8);
/** A dimension rounded to the nearest 1/32 in. */
export const nearest32 = (v: number): number => nearestTo(v, 1 / 32);

/** `15-5/8` (no inch mark) for a value already on the 1/`denom` grid: the fraction reduced, a whole number alone, a bare fraction when under 1. */
export function fractionText(v: number, denom: number): string {
  let n = Math.round(v * denom), d = denom;
  while (n % 2 === 0 && d > 1) { n /= 2; d /= 2; }
  const whole = Math.floor(n / d), rem = n - whole * d;
  if (n === 0) return '0';
  return rem === 0 ? String(whole) : whole ? `${whole}-${rem}/${d}` : `${rem}/${d}`;
}

/** A ROUGH dimension: rounded UP to 1/8 in, as `15-5/8"`. */
export const roughFrac = (v: number): string => `${fractionText(roughUp8(v), 8)}"`;
/** A FINAL dimension: rounded to the nearest 1/32 in, as `15-21/32"` (the exact value is kept in a data field). */
export const finalFrac = (v: number): string => `${fractionText(nearest32(v), 32)}"`;

interface DimsLike { t: number; w: number; l: number }
const TIMES = ' × ';
/** `3/4 × 5-7/8 × 25-1/2` for ROUGH T × W × L (each rounded UP to 1/8; the inch mark is left off, as on a cut sheet). */
export const roughDimsText = (d: DimsLike): string => [d.t, d.w, d.l].map((v) => fractionText(roughUp8(v), 8)).join(TIMES);
/** `5/8 × 16-3/8 × 24` for FINAL T × W × L (each to the nearest 1/32). */
export const finalDimsText = (d: DimsLike): string => [d.t, d.w, d.l].map((v) => fractionText(nearest32(v), 32)).join(TIMES);
