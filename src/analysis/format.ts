/** Number formatting for the `how` strings. */
export function f(x: number, dp = 1): string {
  if (!Number.isFinite(x)) return String(x);
  return x.toFixed(dp);
}

/** Four significant figures without trailing noise. */
export function g(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return '0';
  const ax = Math.abs(x);
  if (ax >= 1000) return x.toFixed(0);
  return String(Number(x.toPrecision(ax >= 100 ? 4 : 3)));
}
