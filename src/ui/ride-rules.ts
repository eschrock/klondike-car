/**
 * Ride-mode rules for the Simple view's "Riding it downhill" card (spec 6, D-51, D-55). Pure functions of the params: no DOM, no
 * global state, so the table and the wording are unit-tested and every number follows `PARAM_DEFS` (change `rideMuGo8` and the table changes).
 *
 * Table rule: the camp-measured friction is multiplied by `rideMuDerate` (the 10 mph derate) to the usable friction, which is compared with the
 * required usable friction for a GO: `rideMuGo8` up to `rideGoSlopeDeg`, `rideMuGo10` up to `rideMaxSlopeDeg`. Slopes above the maximum are WALK.
 * A cell below its GO value is CAUTION (the caution speed with a handler) while the cart can still be stopped inside `rideStopMaxFt` at the
 * caution speed on that slope with full braking (`a = g (mu cos θ - sin θ)`, plus the reaction time); otherwise it is WALK.
 */
import type { Params } from '../params';

export type RideVerdict = 'go' | 'caution' | 'walk';

export interface RideCell {
  /** Measured (camp test) friction, before the derate. */
  measuredMu: number;
  /** measured x rideMuDerate */
  usableMu: number;
  verdict: RideVerdict;
}
export interface RideRow {
  slopeDeg: number;
  /** Usable friction needed for a GO on this slope; null above the maximum slope. */
  requiredMu: number | null;
  cells: RideCell[];
}

export interface RideRules {
  title: string;
  lead: string;
  table: { columns: number[]; rows: RideRow[]; caption: string };
  speedRule: string;
  cautionRule: string;
  daylightRule: string;
  gearRule: string;
  spotterRule: string;
  walkRule: string;
  campTest: { title: string; intro: string; steps: string[]; note: string };
  /** The short rules, in reading order (what a parent sees first). */
  rules: string[];
}

const G_FT_S2 = 32.174;
const MPH_FT_S = 1.46667;

/** The measured-friction columns of the table (the camp test reads between 0.3 on wet clay and 0.7 on dry dirt). */
export const RIDE_MU_COLUMNS = [0.3, 0.4, 0.5, 0.6, 0.7];

/** Stop distance (ft) from `mph` on a downhill `slopeDeg` with usable friction `mu`, including the reaction time at the starting speed; Infinity when it cannot stop. */
export function rideStopFt(p: Params, mph: number, slopeDeg: number, mu: number): number {
  const th = (slopeDeg * Math.PI) / 180;
  const a = G_FT_S2 * (mu * Math.cos(th) - Math.sin(th));
  if (a <= 0) return Infinity;
  const v = mph * MPH_FT_S;
  return v * p.rideReactionS + (v * v) / (2 * a);
}

/** Required usable friction for a GO on a slope (null when the slope is above the steepest ridable one). */
export function requiredMuFor(p: Params, slopeDeg: number): number | null {
  if (slopeDeg > p.rideMaxSlopeDeg + 1e-9) return null;
  return slopeDeg <= p.rideGoSlopeDeg + 1e-9 ? p.rideMuGo8 : p.rideMuGo10;
}

export function rideVerdict(p: Params, slopeDeg: number, measuredMu: number): RideVerdict {
  const usable = measuredMu * p.rideMuDerate;
  const need = requiredMuFor(p, slopeDeg);
  if (need === null) return 'walk';
  if (usable + 1e-9 >= need) return 'go';
  return rideStopFt(p, p.rideCautionSpeedMph, slopeDeg, usable) <= p.rideStopMaxFt ? 'caution' : 'walk';
}

const n = (v: number, dp = 0) => String(Number(v.toFixed(dp)));

export function rideRules(p: Params, opts: { cartLb?: number } = {}): RideRules {
  const slopes = [...new Set([5, p.rideGoSlopeDeg, p.rideMaxSlopeDeg])].sort((a, b) => a - b);
  const rows: RideRow[] = slopes.map((s) => ({
    slopeDeg: s,
    requiredMu: requiredMuFor(p, s),
    cells: RIDE_MU_COLUMNS.map((m) => ({ measuredMu: m, usableMu: m * p.rideMuDerate, verdict: rideVerdict(p, s, m) })),
  }));
  const speed = n(p.rideSpeedMph), caution = n(p.rideCautionSpeedMph), maxSlope = n(p.rideMaxSlopeDeg), step = n(p.bumpNormalHeightIn, 2);
  const cartLb = Math.round(opts.cartLb ?? 169);
  const derate = n(p.rideMuDerate, 2);
  const speedRule = `Up to ${speed} mph on smooth, signed runs.`;
  const cautionRule = `${caution} mph, with an adult walking alongside, wherever the table says CAUTION or the run has steps of ${step} inch or more.`;
  const daylightRule = 'Daylight only. Ride mode is off for the 7 pm race; the race runs in tow mode.';
  const gearRule = 'Lap belt fastened and a helmet on, every ride. No belt or no helmet means no ride.';
  const spotterRule = 'An adult spotter at the bottom of the run.';
  const walkRule = `Steeper than ${maxSlope}° (about ${n(Math.tan((p.rideMaxSlopeDeg * Math.PI) / 180) * 100)}% grade), walk it down: the rider is off and the handler is on the brake.`;
  const need = (s: number) => requiredMuFor(p, s);
  return {
    title: 'Riding it downhill',
    lead: `The cart can be steered from the seat with a hip stick, but only on gentle, dry-ish slopes up to ${maxSlope}°. The table says what each run needs; measure the run first (the camp test below).`,
    table: {
      columns: RIDE_MU_COLUMNS,
      rows,
      caption: `Measured friction (camp test) by slope. Each value is already multiplied by ${derate} for ${speed} mph. GO needs ${n(need(p.rideGoSlopeDeg) ?? 0, 2)} usable friction up to ${n(p.rideGoSlopeDeg)}° and ${n(need(p.rideMaxSlopeDeg) ?? 0, 2)} up to ${maxSlope}°.`,
    },
    speedRule,
    cautionRule,
    daylightRule,
    gearRule,
    spotterRule,
    walkRule,
    campTest: {
      title: 'Camp friction test',
      intro: 'One adult, one minute, at the top, middle and bottom of each run. Repeat after rain.',
      steps: [
        'Lock or strap all four wheels so none can turn.',
        `Drag the empty cart (${cartLb} lb, or its actual weight) at a steady walk with a hand scale on a rope. Measured friction = scale reading ÷ cart weight.`,
        `Usable friction = measured × ${derate}. Find the slope row and the nearest measured column in the table.`,
        'Slope check: lock the wheels and let the empty cart go from rest. If it slides on a slope θ, friction is below tan θ (it holds a 15° slope only when friction is above 0.27).',
        'Mark each run with the result and the date.',
      ],
      note: 'The table is the worst case with the brake bias at either end of its range, so a GO has margin.',
    },
    rules: [speedRule, cautionRule, daylightRule, gearRule, spotterRule, walkRule],
  };
}

/** The sentence for the Hills & braking light, from the `brake-stop` row (value in feet at the envelope slope), or null when that row is absent. */
export function hillStopSentence(p: Params, stopFt: number | undefined): string | null {
  if (stopFt === undefined || !Number.isFinite(stopFt)) return null;
  const deg = n(p.rideGoSlopeDeg);
  return `On ${/^(8|11|18)/.test(deg) ? 'an' : 'a'} ${deg}° hill at ${n(p.rideSpeedMph)} mph it stops in about ${n(stopFt)} ft.`;
}
