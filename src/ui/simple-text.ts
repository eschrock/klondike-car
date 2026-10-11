/**
 * Plain-English wording for the Simple view (D-30). Pure functions of the check values: no numbers are hard-coded here,
 * only the sentence shapes (docs/simple-view-spec.md "Traffic lights" table). No DOM, so it is unit-testable.
 */
import type { Params } from '../params';
import type { FitResult } from '../truck/fit';
import type { AnalysisCheck, Status } from '../analysis/types';
import { SEVERITY } from '../analysis/types';
import { LIGHT_OF_ID, lightOf, type Light, type Limiter, type SafeRange, type SweepResult } from '../analysis/rider-sweep';

export const LIGHT_TITLE: Record<Light, string> = {
  tipping: 'Tipping over', turns: 'Fast turns', hills: 'Hills & braking', steering: 'Steering', strength: 'Strength', truck: 'Fits the truck',
};

/** Where the light sends you in Advanced → Analysis: the first of these rows, by id. */
export const LIGHT_CHECK_IDS: Record<Light, string[]> = {
  tipping: ['tip-straight', 'tip-lock'],
  turns: ['slide-before-tip', 'v-rollover'],
  hills: ['pitch-fwd', 'pitch-rear', 'brake-force', 'brake-traction'],
  steering: ['turn-radius', 'steer-clear'],
  strength: Object.keys(LIGHT_OF_ID).filter((k) => LIGHT_OF_ID[k] === 'strength'),
  truck: ['truck-fit'],
};

/** How a structure check reads in a sentence, and the event that stresses it (plain words, no part-names a parent has not met). */
const PART: Record<string, { name: string; event?: string }> = {
  'kingpin-strike': { name: 'the steering pin', event: 'in a curb strike' },
  'roll-side-bearer': { name: 'the front steering plate', event: 'when the cart leans' },
  'roll-kingpin-uplift': { name: 'the steering pin', event: 'when the cart leans' },
  'roll-bolster-attach': { name: 'the front steering plate', event: 'when the cart leans' },
  'axle-stress': { name: 'an axle' },
  'beam-front': { name: 'the front axle' },
  'beam-rear': { name: 'the rear axle' },
  'bearing-groove': { name: 'an axle' },
  rails: { name: 'the side rails' },
  deck: { name: 'the floor' },
  kingpin: { name: 'the steering pin' },
  turntable: { name: 'the steering pivot' },
  tongue: { name: 'the pull handle' },
  'steer-stops': { name: 'the steering stops', event: 'at full turn' },
  'kingpin-peak': { name: 'the steering pin', event: 'in the wood around it' },
  'pitch-path': { name: 'the front steering plate', event: 'under load' },
  'kingpin-split': { name: 'the wood around the steering pin' },
  'steer-stops-bound': { name: 'the steering stops', event: 'if only one of the two catches' },
  'kingpin-plates': { name: 'the steel plates at the steering pin' },
  'kingpin-bolts': { name: 'the bolts that hold the steering pin plates', event: 'in a curb strike' },
  'bridle-tie': { name: 'the rope tie point' },
  'seat-back': { name: 'the seat back', event: 'when the rider leans back' },
  'seat-grip': { name: 'the side grab handles' },
  lift: { name: 'the lifting hand-holds', event: 'when two people lift the cart' },
  'foot-stop': { name: 'the foot stop', event: 'in a curb strike' },
};
const partText = (id: string) => { const q = PART[id]; return q ? (q.event ? `${q.name} ${q.event}` : q.name) : id; };

/** Why a check fails, as it would read after "Above 230 lb: " (no trailing period). */
const REASON: Record<string, string> = {
  'tip-straight': 'it could tip over on a side slope',
  'tip-lock': 'it could tip over on a side slope',
  'slide-before-tip': 'a fast, sharp turn could roll it over instead of skidding',
  'turn-radius': 'the turning circle is too wide',
  'steer-clear': 'the wheels could hit the cart when steering',
  'pitch-fwd': 'braking downhill could tip it nose-first',
  'pitch-rear': 'a hard pull uphill can lift the front wheels',
  'brake-force': 'it takes too hard a squeeze on the brake handle to hold it on a hill',
  'kingpin-strike': 'a hard bump into a curb could bend or break the steering pin (kingpin)',
  turntable: 'the steering pivot (turntable) could be overloaded and fail',
  kingpin: 'the steering pin (kingpin) could be overloaded and fail',
  'roll-kingpin-uplift': 'leaning hard could pull the steering pin out',
  'roll-side-bearer': 'the front steering plate could come loose when the cart leans',
  'roll-bolster-attach': 'the front steering plate could come loose when the cart leans',
  'axle-stress': 'an axle could bend',
  'beam-front': 'an axle could bend',
  'beam-rear': 'an axle could bend',
  'bearing-groove': 'an axle could bend',
  rails: 'the side rails could crack',
  deck: 'the floor could crack',
  tongue: 'the pull handle could crack',
  'steer-stops': 'the steering stops could crush or loosen at full turn',
  'kingpin-peak': 'the wood around the steering pin could crush',
  'pitch-path': 'the front steering plate could dent the beam under it',
  'kingpin-split': 'the wood around the steering pin could split',
  'steer-stops-bound': 'if only one steering stop catches, it could crush or loosen',
  'kingpin-plates': 'a steel plate at the steering pin could bend or tear',
  'kingpin-bolts': 'the bolts that hold the steering pin plates to the wood could pull through or split it',
  'bridle-tie': 'the rope tie point could pull out',
  'seat-back': 'the seat back could break or pull loose when the rider leans back',
  'seat-grip': 'a side grab handle could break when a rider hangs on',
  lift: 'a lifting hand-hold could crack when the cart is carried',
  'foot-stop': 'the foot stop could break or pull loose in a curb strike',
};
export function failReason(id: string): string {
  return REASON[id] ?? 'a safety check fails';
}

/** What is closest to its limit, as a short noun phrase ("close to the limit (the steering pin in a curb strike)"). */
export function limiterName(id: string): string {
  if (PART[id]) return partText(id);
  switch (id) {
    case 'tip-straight': case 'tip-lock': return 'tipping on a side slope';
    case 'slide-before-tip': case 'v-rollover': return 'a fast, sharp turn';
    case 'pitch-fwd': case 'pitch-rear': return 'hills';
    case 'brake-force': case 'brake-traction': return 'braking on a hill';
    case 'turn-radius': case 'steer-clear': return 'steering';
    default: return 'a safety check';
  }
}

/** One plain next step for the check that limits the rider weight. Static: a pointer to the knob, not a calculation. */
export function limiterAdvice(id: string): string {
  switch (id) {
    case 'tip-straight': case 'tip-lock': case 'slide-before-tip': return 'widen the wheels or lower the floor';
    case 'pitch-rear': case 'pitch-fwd': return 'make the cart longer between the wheels or lower the floor';
    case 'brake-force': case 'brake-traction': return 'ask the builders about a stronger brake';
    default: return PART[id] ? `the builders need to strengthen ${PART[id].name}` : 'adjust the cart in the controls below';
  }
}

const val = (c: AnalysisCheck | undefined) => c?.cases?.operating?.value ?? c?.value ?? NaN;
const lim = (c: AnalysisCheck | undefined) => c?.cases?.operating?.limit ?? c?.limit ?? NaN;
const num = (x: number, dp = 0) => (Number.isFinite(x) ? x.toFixed(dp) : '?');
const feet = (inches: number) => num(inches / 12, 1);
const by = (cs: AnalysisCheck[], id: string) => cs.find((c) => c.id === id);
const worstOf = (cs: (AnalysisCheck | undefined)[]): AnalysisCheck | undefined =>
  cs.filter((c): c is AnalysisCheck => !!c && c.status !== 'info').reduce<AnalysisCheck | undefined>(
    (a, b) => (!a || SEVERITY[b.status] > SEVERITY[a.status] || (b.status === a.status && (b.util ?? 0) > (a.util ?? 0)) ? b : a), undefined);

export interface LightText { light: Light; status: Status; text: string }

export interface DesignFacts {
  p: Params;
  /** Checks at the current rider weight (truck fit excluded). */
  checks: AnalysisCheck[];
  fit: FitResult | null;
}

export function lightTexts({ p, checks, fit }: DesignFacts): Record<Light, LightText> {
  const st = (ids: string[]): Status => {
    let s: Status = 'info';
    for (const id of ids) { const c = by(checks, id); if (c && SEVERITY[c.status] > SEVERITY[s]) s = c.status; }
    return s;
  };
  const out = {} as Record<Light, LightText>;

  // Tipping over: the side slope it survives, straight and at full lock (the lower of the two governs).
  {
    const a = by(checks, 'tip-straight'), b = by(checks, 'tip-lock');
    const g = worstOf([a, b]) ?? a;
    const deg = Math.min(val(a), val(b));
    const status = st(['tip-straight', 'tip-lock']);
    const text = status === 'fail'
      ? `Could tip over on a side slope of ${num(Math.floor(deg))}°; it should hold at least ${num(lim(g))}°. (A very steep hill is about 30°.)`
      : status === 'marginal'
        ? `Stays upright on a ${num(Math.floor(deg))}° side slope, even turned all the way, but that is close to the ${num(lim(g))}° it needs. (A very steep hill is about 30°.)`
        : `Stays upright on a ${num(Math.floor(deg))}° side slope, even turned all the way. (A very steep hill is about 30°.)`;
    out.tipping = { light: 'tipping', status, text };
  }

  // Fast turns: skid-before-tip (and the rollover speed, info).
  {
    const s = by(checks, 'slide-before-tip'), v = by(checks, 'v-rollover');
    const status = st(['slide-before-tip']);
    const mph = `about ${num(val(v))} mph at full lock (a brisk jog is about 6 mph)`;
    const text = status === 'fail'
      ? `In a fast, sharp turn it could tip before it skids. Rollover could happen at ${mph}.`
      : status === 'marginal'
        ? `In a fast, sharp turn it skids before it tips, but only just. Rollover would need ${mph}.`
        : `In a fast, sharp turn it skids before it can tip. Rollover would need ${mph}.`;
    void s;
    out.turns = { light: 'turns', status, text };
  }

  // Hills & braking: brake handle force, front lift under a pull, forward pitch.
  {
    const bf = by(checks, 'brake-force'), pr = by(checks, 'pitch-rear'), pf = by(checks, 'pitch-fwd');
    const status = st(['brake-force', 'pitch-rear', 'pitch-fwd']);
    const slope = num(p.designSlopeDeg);
    const parts: string[] = [];
    parts.push(bf?.status === 'fail'
      ? `Holding it on a ${slope}° hill takes ${num(val(bf))} lb on the brake handle (about ${num(lim(bf))} is comfortable).`
      : bf?.status === 'marginal'
        ? `Holds on a ${slope}° hill with ${num(val(bf))} lb on the brake handle, near the ${num(lim(bf))} lb limit.`
        : `Holds on a ${slope}° hill with ${num(val(bf))} lb on the brake handle (up to ${num(lim(bf))} lb is comfortable).`);
    parts.push(pr?.status === 'fail' ? 'A hard pull uphill could lift the front wheels.'
      : pr?.status === 'marginal' ? "The front won't lift when pulled uphill, but with little to spare."
      : "The front won't lift when pulled uphill.");
    if (pf && (pf.status === 'fail' || pf.status === 'marginal'))
      parts.push(pf.status === 'fail' ? 'Braking downhill could tip it nose-first.' : 'Braking downhill is close to tipping it nose-first.');
    out.hills = { light: 'hills', status, text: parts.join(' ') };
  }

  // Steering: the turning circle (diameter = 2 × the curb-to-curb radius) and hull clearance.
  {
    const tr = by(checks, 'turn-radius'), sc = by(checks, 'steer-clear');
    const status = st(['turn-radius', 'steer-clear']);
    const circle = feet(2 * val(tr));
    const part1 = tr?.status === 'fail'
      ? `Needs a circle ${circle} ft across to turn around (the limit is ${feet(2 * lim(tr))} ft)`
      : `Needs a circle ${circle} ft across to turn around`;
    const part2 = sc?.status === 'fail' ? 'the wheels hit the cart when steered' : sc?.status === 'marginal' ? 'the wheels only just clear the cart' : 'the wheels clear the cart';
    out.steering = { light: 'steering', status, text: `${part1}; ${part2}.` };
  }

  // Strength: the weakest part. The percentage only appears when it matters (close to the limit or past it).
  {
    const rows = checks.filter((c) => lightOf(c) === 'strength' && c.status !== 'info');
    const w = worstOf(rows);
    const status = rows.length ? st(rows.map((r) => r.id)) : 'info';
    const pct = w ? Math.round((w.util ?? 0) * 100) : 0;
    const text = !w ? 'No strength checks to show.'
      : status === 'fail' ? `${cap(partText(w.id))} would be past what it can take (${pct}% of its limit).`
      : status === 'marginal' ? `Close to the limit: ${partText(w.id)} (${pct}% of what it can take).`
      : `Every part has a safety margin. Closest to its limit: ${partText(w.id)}.`;
    out.strength = { light: 'strength', status, text };
  }

  // Fits the truck: assembled if possible, otherwise how much has to come off.
  {
    const fits = (cfg: string) => !!fit?.cases.some((c) => c.config === cfg && c.fits);
    const tc = by(checks, 'truck-fit');
    const status: Status = fit ? (fits('removed') || fits('tongue-off') || fits('installed') ? 'pass' : 'fail') : (tc?.status ?? 'info');
    const how = fits('installed') ? ', fully assembled.' : fits('tongue-off') ? ' with the tongue off.' : fits('removed') ? ' with the handle and seat back off.' : '';
    out.truck = {
      light: 'truck', status,
      text: !fit ? 'Truck fit is still being worked out.'
        : status === 'fail' ? 'Does not fit the Tacoma bed with the tailgate down, even with the removable parts off.'
        : `Fits the Tacoma bed with the tailgate down${how}`,
    };
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type Tone = 'pass' | 'warn' | 'fail';
export interface Headline {
  tone: Tone;
  /** Only a green (comfortable) result is `ok`. */
  ok: boolean;
  text: string;
  /** The second tier: what the yellow weights mean, or what would be safe instead. */
  sub?: string;
}

/** The slice of a rider sweep the headline needs (kept narrow so tests can build one by hand). */
export type HeadlineSweep = Pick<SweepResult, 'points' | 'safe' | 'green' | 'fromLb' | 'toLb' | 'stepLb'> & { operating: Pick<SweepResult['operating'], 'status' | 'worst'> };

/** Maximal runs of grid weights whose status matches, widest first. */
function runsOf(points: { w: number; status: Status }[], want: Status): { lo: number; hi: number }[] {
  const out: { lo: number; hi: number }[] = [];
  let cur: { lo: number; hi: number } | null = null;
  for (const pt of points) {
    if (pt.status !== want) { cur = null; continue; }
    if (cur) cur.hi = pt.w; else { cur = { lo: pt.w, hi: pt.w }; out.push(cur); }
  }
  return out.sort((a, b) => b.hi - b.lo - (a.hi - a.lo));
}

const range = (lo: number, hi: number) => (lo === hi ? `${lo} lb` : `${lo}–${hi} lb`);

/**
 * Two tiers (M3). The headline is keyed on the all-green run only ("Comfortably safe for ... "); weights that pass but are
 * close to a limit are named in the subline, never counted as safe. Pure function of a sweep.
 */
export function headline(w: number, sweep: HeadlineSweep): Headline {
  const { points, safe, green, fromLb, toLb } = sweep;
  const greens = runsOf(points, 'pass');
  const yellows = runsOf(points, 'marginal').sort((a, b) => a.lo - b.lo);
  const status = sweep.operating.status;
  if (!safe) {
    const reason = failReason(sweep.operating.worst?.id ?? '');
    const text = `Not safe for a ${w} lb rider: ${reason}.`;
    if (greens.length) return { tone: 'fail', ok: false, text, sub: `This cart is comfortably safe for riders ${range(greens[0].lo, greens[0].hi)}.` };
    if (yellows.length) return { tone: 'fail', ok: false, text, sub: `Riders ${range(yellows[0].lo, yellows[0].hi)} would be close to the limit.` };
    return { tone: 'fail', ok: false, text, sub: 'No rider weight is safe with this cart. Try a wider or lower design, or press Reset.' };
  }
  if (!green || status === 'marginal') {
    // This weight passes, but only just; say so first, then what is comfortable.
    return {
      tone: 'warn', ok: false,
      text: `A ${w} lb rider is close to this cart's limit.`,
      sub: greens.length ? `Comfortably safe for riders ${range(greens[0].lo, greens[0].hi)}.` : undefined,
    };
  }
  const { loLb, hiLb, openLow, openHigh } = green;
  if (openLow && openHigh) return { tone: 'pass', ok: true, text: `Safe for every rider from ${fromLb} to ${toLb} lb` };
  const word = yellows.length ? 'Comfortably safe' : 'Safe';
  const text = openLow ? `${word} for riders up to ${hiLb} lb`
    : openHigh ? `${word} for riders from ${loLb} lb up`
    : `${word} for riders ${loLb}–${hiLb} lb`;
  const sub = yellows.length
    ? `${yellows.map((y) => range(y.lo, y.hi)).join(' and ')} ${yellows.length > 1 || yellows[0].lo !== yellows[0].hi ? 'are' : 'is'} close to the limit.`
    : undefined;
  return { tone: 'pass', ok: true, text, sub };
}

export function limitLine(side: 'below' | 'above', safe: SafeRange | null, limit: Limiter | null): string | null {
  if (!safe || !limit) return null;
  const at = side === 'below' ? safe.loLb : safe.hiLb;
  return `${side === 'below' ? 'Below' : 'Above'} ${at} lb: ${failReason(limit.id)}.`;
}

/** The one-line note for a single weight on the bar (also what a tap on a block shows). */
export function weightNote(w: number, status: Status, worstId: string | undefined): string {
  if (status === 'fail') return `${w} lb: a check fails, because ${failReason(worstId ?? '')}.`;
  if (status === 'marginal') return `${w} lb: close to the limit (${limiterName(worstId ?? '')}).`;
  return `${w} lb: OK.`;
}
