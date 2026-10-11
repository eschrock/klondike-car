/**
 * Plain-English wording for the Simple view (D-30). Pure functions of the check values: no numbers are hard-coded here,
 * only the sentence shapes (docs/simple-view-spec.md "Traffic lights" table). No DOM, so it is unit-testable.
 */
import type { Params } from '../params';
import type { FitResult } from '../truck/fit';
import type { AnalysisCheck, Status } from '../analysis/types';
import { SEVERITY } from '../analysis/types';
import { LIGHT_OF_ID, lightOf, type Light, type Limiter, type SafeRange, type SweepResult } from '../analysis/rider-sweep';
import type { CargoCapacity } from '../analysis/cargo-capacity';

export const LIGHT_TITLE: Record<Light, string> = {
  tipping: 'Tipping over', turns: 'Fast turns', hills: 'Hills & braking', steering: 'Steering', strength: 'Strength', truck: 'Fits the truck',
};

/** Where the light sends you in Advanced → Analysis: the first of these rows, by id. */
export const LIGHT_CHECK_IDS: Record<Light, string[]> = {
  tipping: ['tip-straight', 'tip-lock'],
  turns: ['slide-before-tip', 'v-rollover'],
  hills: ['pitch-fwd', 'pitch-rear', 'brake-force', 'brake-traction'],
  steering: ['turn-radius', 'steer-clear', 'steer-kin', 'steer-lock'],
  strength: Object.keys(LIGHT_OF_ID).filter((k) => LIGHT_OF_ID[k] === 'strength'),
  truck: ['truck-fit'],
};

/** How a structure check reads in a sentence, and the event that stresses it (plain words, no part-names a parent has not met). */
const PART: Record<string, { name: string; event?: string }> = {
  'axle-stress': { name: 'an axle' },
  'beam-front': { name: 'the front axle' },
  'beam-rear': { name: 'the rear axle' },
  'bearing-groove': { name: 'an axle' },
  rails: { name: 'the side rails' },
  deck: { name: 'the floor' },
  tongue: { name: 'the pull handle' },
  'seat-back': { name: 'the seat back', event: 'when the rider leans back' },
  'seat-grip': { name: 'the side grab handles' },
  lift: { name: 'the lifting hand-holds', event: 'when two people lift the cart' },
  'foot-stop': { name: 'the foot stop', event: 'in a hard bump' },
  // Phase 3b front end (D-51 to D-56): plain names for the rows the Ackermann cart adds..
  'spindle-stub': { name: 'a front wheel stub', event: 'in a hard bump' },
  'kingpin-bolt': { name: 'a steering pivot bolt', event: 'in a hard bump' },
  'kingpin-bracket': { name: 'a bracket that holds a steering pivot', event: 'in a hard bump' },
  'tie-rod': { name: 'the steering rod' },
  'wheel-retention': { name: 'the front wheel nuts and pins', event: 'in a hard bump' },
  'spindle-fatigue': { name: 'a front wheel stub', event: 'after many bumps' },
  'tongue-tie': { name: 'the rope tie point' },
  bellcrank: { name: 'the steering lever under the nose', event: 'when a front wheel is pushed hard' },
  'drag-link': { name: 'a steering link' },
  'steer-stop-load': { name: 'the steering stops' },
  'wheel-rating': { name: 'a wheel', event: 'in a hard bump' },
  'rear-beam-seat': { name: 'the rear axle seat in the side rails', event: 'in a hard bump' },
  'brake-lever': { name: 'the brake lever', event: 'if it is yanked' },
  'brake-links': { name: 'the brake link', event: 'under a hard pull' },
  'brake-beam': { name: 'the brake beam' },
  'brake-shoes': { name: 'the brake shoes' },
  'park-hold': { name: 'the parking pin' },
  joists: { name: 'the floor crossmembers' },
  'handle-bow': { name: 'the handlebow', event: 'when the handler pulls back' },
};
/**
 * The checks that belong to the new (Phase 3b) front end: the spindle, its bracket and bolt, the tie rod, bellcrank, tongue and links, and the tow-lock stops.
 * Their sizes are placeholders until the real purchased parts are chosen (spec 12), and at the defaults several do not yet pass at the operating rider. While any of these
 * fails, the Simple view says the front end is still being verified (spec 12: keep a one-line note until the rows clear). REMOVE `FRONT_END_NOTE` once they pass.
 */
export const FRONT_END_IDS = new Set([
  'spindle-stub', 'spindle-fatigue', 'kingpin-bolt', 'kingpin-bracket', 'wheel-retention', 'tie-rod', 'drag-link', 'bellcrank', 'steer-stop-load', 'beam-front', 'tongue',
  'tongue-tie',
]);
export const FRONT_END_NOTE = 'The new steering front end (spindle, bracket, rod and link sizes) is still being verified.';
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
  'axle-stress': 'an axle could bend',
  'beam-front': 'an axle could bend',
  'beam-rear': 'an axle could bend',
  'bearing-groove': 'an axle could bend',
  rails: 'the side rails could crack',
  deck: 'the floor could crack',
  tongue: 'the pull handle could crack',
  'seat-back': 'the seat back could break or pull loose when the rider leans back',
  'seat-grip': 'a side grab handle could break when a rider hangs on',
  lift: 'a lifting hand-hold could crack when the cart is carried',
  'foot-stop': 'the foot stop could break or pull loose in a hard bump',
  'spindle-stub': 'a front wheel stub could bend or break in a hard bump',
  'kingpin-bolt': 'a steering pivot bolt could bend or shear in a hard bump',
  'kingpin-bracket': 'a bracket that holds a steering pivot could bend or tear in a hard bump',
  'tie-rod': 'the steering rod could bend when the front wheels are pushed hard',
  'wheel-retention': 'a front wheel could come off in a hard bump',
  'spindle-fatigue': 'a front wheel stub could crack after many bumps',
  'tongue-tie': 'the rope tie point could pull out',
  bellcrank: 'the steering lever under the nose could bend when a front wheel is pushed hard',
  'drag-link': 'a steering link could bend when the front wheels are pushed hard',
  'steer-stop-load': 'a steering stop could shear or pull loose',
  'wheel-rating': 'a wheel could be overloaded in a hard bump',
  'rear-beam-seat': 'the notch that holds the rear axle in the side rails could crush or split in a hard bump',
  'brake-lever': 'the brake lever could bend or pull loose if it is yanked',
  'brake-links': 'the brake link or its pins could bend or shear under a hard pull',
  'brake-beam': 'the brake beam could bend under a hard pull',
  'brake-shoes': 'a brake shoe could wear or crush under a hard pull',
  'park-hold': 'the parking pin could bend and the cart roll away when parked on a steep hill',
  joists: 'a floor crossmember could crack under the seat',
  'handle-bow': 'the handlebow could crack when the handler pulls back',
  'steer-kin': 'the two front wheels do not turn together properly, so the tires would scrub and the steering would feel off',
  'steer-lock': 'the steering stops are not where they should be',
};

/** Rows the Phase 3b design adds (spec 4.2, 5.5, 7): each has a plain name or a failure sentence here, pinned by the simple-text test. */
export const PHASE3B_CHECK_IDS = [
  'spindle-stub', 'kingpin-bolt', 'kingpin-bracket', 'tie-rod', 'wheel-retention', 'spindle-fatigue', 'tongue-tie',
  'brake-lever', 'brake-links', 'brake-beam', 'brake-shoes', 'park-hold', 'steer-kin', 'steer-lock', 'bellcrank', 'drag-link', 'steer-stop-load', 'wheel-rating', 'rear-beam-seat',
] as const;
export function failReason(id: string): string {
  return REASON[id] ?? 'a safety check fails';
}

/** What is closest to its limit, as a short noun phrase ("close to the limit (a front wheel stub in a hard bump)"). */
export function limiterName(id: string): string {
  if (PART[id]) return partText(id);
  switch (id) {
    case 'tip-straight': case 'tip-lock': return 'tipping on a side slope';
    case 'slide-before-tip': case 'v-rollover': return 'a fast, sharp turn';
    case 'pitch-fwd': case 'pitch-rear': return 'hills';
    case 'brake-force': case 'brake-traction': return 'braking on a hill';
    case 'turn-radius': case 'steer-clear': case 'steer-kin': case 'steer-lock': return 'steering';
    default: return 'a safety check';
  }
}

/** One plain next step for the check that limits the rider weight. Static: a pointer to the knob, not a calculation. */
export function limiterAdvice(id: string): string {
  switch (id) {
    case 'tip-straight': case 'tip-lock': case 'slide-before-tip': return 'widen the wheels or lower the floor';
    case 'pitch-rear': case 'pitch-fwd': return 'make the cart longer between the wheels or lower the floor';
    case 'brake-force': case 'brake-traction': return 'ask the builders about a stronger brake';
    case 'steer-kin': case 'steer-lock': return 'ask the builders to re-check the steering linkage';
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
    const status = st(['turn-radius', 'steer-clear', 'steer-kin', 'steer-lock']);
    const circle = feet(2 * val(tr));
    const part1 = tr?.status === 'fail'
      ? `Needs a circle ${circle} ft across to turn around (the limit is ${feet(2 * lim(tr))} ft)`
      : `Needs a circle ${circle} ft across to turn around`;
    const part2 = sc?.status === 'fail' ? 'the wheels hit the cart when steered' : sc?.status === 'marginal' ? 'the wheels only just clear the cart' : 'the wheels clear the cart';
    const kin = ['steer-kin', 'steer-lock'].map((id) => by(checks, id)).find((c) => c?.status === 'fail');
    const part3 = kin ? `; ${failReason(kin.id)}` : '';
    out.steering = { light: 'steering', status, text: `${part1}; ${part2}${part3}.` };
  }

  // Strength: the weakest part. The percentage only appears when it matters (close to the limit or past it).
  {
    const rows = checks.filter((c) => lightOf(c) === 'strength' && c.status !== 'info');
    const w = worstOf(rows);
    const status = rows.length ? st(rows.map((r) => r.id)) : 'info';
    const pct = w ? Math.round((w.util ?? 0) * 100) : 0;
    const text = !w ? 'No strength checks to show.'
      : status === 'fail' ? `The weakest point is ${partText(w.id)}, at ${pct}% of the load this design allows. The design keeps a safety factor in reserve, so this is a shortfall in margin, not a forecast that it will break, but it must be fixed before the cart is built.${FRONT_END_IDS.has(w.id) ? ` ${FRONT_END_NOTE}` : ''}`
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
export type HeadlineSweep = Pick<SweepResult, 'points' | 'safe' | 'green' | 'fromLb' | 'toLb' | 'stepLb'> & { operating: Pick<SweepResult['operating'], 'status' | 'worst'> & { fails?: string[] } };

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
    // The rider's own weight fails the checks. Name the limiter; if only front-end rows fail, say the rest of the cart passes (and that the front end is being verified).
    // Every branch below must read cleanly when NO weight in the swept range is safe (no empty headline, no NaN).
    const worstId = sweep.operating.worst?.id ?? '';
    const fails = sweep.operating.fails ?? [];
    const frontOnly = fails.length > 0 && fails.every((id) => FRONT_END_IDS.has(id));
    const frontLimiter = FRONT_END_IDS.has(worstId);
    const reason = failReason(worstId);
    const text = frontOnly || frontLimiter ? `Not yet shown safe for a ${w} lb rider: ${reason}.` : `Not safe for a ${w} lb rider: ${reason}.`;
    const front = frontOnly ? ` Everything else passes at this weight. ${FRONT_END_NOTE}` : frontLimiter ? ` ${FRONT_END_NOTE}` : '';
    if (greens.length) return { tone: 'fail', ok: false, text, sub: `This cart is comfortably safe for riders ${range(greens[0].lo, greens[0].hi)}.${front}` };
    if (yellows.length) return { tone: 'fail', ok: false, text, sub: `Riders ${range(yellows[0].lo, yellows[0].hi)} would be close to the limit.${front}` };
    const none = `No rider weight from ${fromLb} to ${toLb} lb passes the checks yet. What stops it: ${limiterName(worstId)}.${front}`;
    return { tone: 'fail', ok: false, text, sub: front ? none : `${none} To change that: ${limiterAdvice(worstId)}, or press Reset.` };
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

// ── Cargo mode (D-53): "what can it haul after the race?" Separate from the rider headline, which it never changes. ──

export interface CargoText {
  tone: Tone;
  headline: string;
  /** Plain sentences under the headline, in reading order. */
  lines: string[];
}

const n0 = (x: number) => String(Math.round(x));
const rounded5 = (x: number) => Math.round(x / 5) * 5;

/** Words for the cargo card of the Simple view, from a payload sweep. Pure. */
export function cargoText(c: CargoCapacity): CargoText {
  const cap = c.capacityLb;
  const headline = cap === null ? `Hauls ${c.maxLb} lb or more after the race` : `Hauls up to ${rounded5(cap)} lb after the race`;
  const short = cap !== null && cap < c.payloadLb;
  const tone: Tone = short || c.cargoFailsAtPayload.length > 0 ? 'fail' : c.comfortableLb !== null && c.comfortableLb < c.payloadLb ? 'warn' : 'pass';
  const lines: string[] = [];
  lines.push(`The target is ${c.payloadLb} lb of camp gear, firewood and water with the seat stowed in the storage box (to confirm with Eric). ${tone === 'pass' ? 'Every check holds at that load.' : tone === 'warn' ? 'It holds, but close to a limit.' : `${c.counts.fail} check${c.counts.fail === 1 ? ' fails' : 's fail'} at that load.`}`);
  if (c.limiter && short) lines.push(`What stops it first: ${limiterName(c.limiter.id)}.${c.alwaysFailing.length ? ` ${c.alwaysFailing.length} other check${c.alwaysFailing.length === 1 ? ' fails' : 's fail'} even with nothing on the bed.` : ''}`);
  else if (c.limiter) lines.push(`Closest to its limit as the load grows: ${limiterName(c.limiter.id)}.`);
  if (c.limiterOther && c.capacityOtherLb !== null && c.limiterOther.id !== c.limiter?.id)
    lines.push(`Leaving out the checks that already fail for riders (the front end, still being verified), the next limit is ${limiterName(c.limiterOther.id)}, at about ${rounded5(c.capacityOtherLb)} lb.`);
  const b = c.bed;
  lines.push(`The bed is flat once the seat is in the box: ${n0(b.widthIn)} in wide at the box and ${n0(b.loadWidthIn)} in or wider for ${n0(b.loadLengthIn)} in, ${n0(b.heightIn)} in to the top of the sides, ${n0(b.totalLengthIn)} in long out to the foot stop (narrowing toward the nose). ${c.stow.applicable ? (c.stow.status === 'fail' ? 'The seat back and cushion do NOT fit in the box.' : c.stow.status === 'marginal' ? 'The seat back and cushion fit in the box, but only just.' : 'The seat back and cushion lie flat in the box.') : ''}`.trim());
  if (c.rearTraction !== null && c.rearTraction < 1)
    lines.push(`Parked nose-down on a steep hill with the full load, the rear brake alone holds about ${n0(c.rearTraction * 100)}% of it; the pullers (or a chock) hold the rest.`);
  return { tone, headline, lines };
}
