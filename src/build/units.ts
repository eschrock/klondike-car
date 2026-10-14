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

/**
 * Shop fractions for a running text: every decimal inch ("0.69\"", "10.87\"", "stack 4.82\"") becomes a fraction to the nearest 1/32 in ("11/16\"", "10-7/8\"", "4-13/16\""), or to the nearest 1/16 in
 * when 1/32 is more than 0.008 in off (never 64ths). A length of cord, chain or bungee ("a 10.89 in bungee", "10.87\" cut", "8.99 in") is a cut: it rounds UP to 1/8 in ("10-7/8\"", "9\"").
 * Only a decimal followed directly by the inch mark or " in" is touched: "$2.12/ft", "0 in stock" and part numbers are left alone.
 */
export function fractionizeInches(text: string): string {
  const up8 = (v: number): string => `${fractionText(ceilTo(v, 1 / 8), 8)}"`;
  return text
    .replace(/(?<![\d.\/-])(\d*\.\d+)"(?=\s+(?:cut|long)\b)/g, (_m, num: string) => up8(Number(num)))
    .replace(/(?<![\d.\/-])(\d*\.\d+) in\b(?!\s+(?:stock|the (?:shop|box)))/g, (_m, num: string) => up8(Number(num)))
    .replace(/(?<![\d.\/-])(\d*\.\d+)"/g, (m, num: string) => {
      const v = Number(num);
      let d = 32, n = Math.round(v * d);
      if (Math.abs(v - n / d) > 0.008) { d = 16; n = Math.round(v * d); }
      return n === 0 ? m : `${fractionText(n / d, d)}"`;
    });
}

/** "1/4 in white oak plywood" as the shop writes it: `1/4" white oak plywood` (a fraction followed by "in" takes the inch mark). */
export const inchMarks = (text: string): string => text.replace(/(\d+\/\d+|\d+(?:\.\d+)?) in\b/g, '$1"');
