/**
 * Plain-English wording for the Simple view (D-30). Pure functions of the check values: no numbers are hard-coded here,
 * only the sentence shapes (docs/simple-view-spec.md "Traffic lights" table). No DOM, so it is unit-testable.
 */
import { steerGeometry, type Params } from '../params';
import type { FitResult } from '../truck/fit';
import type { AnalysisCheck, Status } from '../analysis/types';
import { SEVERITY } from '../analysis/types';
import { LIGHT_OF_ID, lightOf, type Light, type Limiter, type SafeRange, type SweepResult } from '../analysis/rider-sweep';
import type { CargoCapacity, CargoRowTrend } from '../analysis/cargo-capacity';

export const LIGHT_TITLE: Record<Light, string> = {
  tipping: 'Tipping over', turns: 'Fast turns', hills: 'Hills & braking', steering: 'Steering', strength: 'Strength', truck: 'Fits the truck',
};

/** Where the light sends you in Advanced → Analysis: the first of these rows, by id. */
export const LIGHT_CHECK_IDS: Record<Light, string[]> = {
  tipping: ['tip-straight'],
  turns: ['slide-before-tip', 'v-rollover'],
  hills: ['pitch-fwd', 'pitch-rear', 'brake-slow', 'brake-traction'],
  steering: ['turn-radius', 'steer-clear'],
  strength: Object.keys(LIGHT_OF_ID).filter((k) => LIGHT_OF_ID[k] === 'strength'),
  truck: ['truck-fit'],
};

/** How a structure check reads in a sentence, and the event that stresses it (plain words, no part-names a parent has not met). */
const PART: Record<string, { name: string; event?: string }> = {
  'axle-stress': { name: 'an axle' },
  'beam-rear': { name: 'the rear axle' },
  'bearing-groove': { name: 'an axle' },
  rails: { name: 'the side rails' },
  deck: { name: 'the floor' },
  'seat-back': { name: 'the seat back', event: 'when the rider leans back' },
  'seat-grip': { name: 'the side grab boards' },
  lift: { name: 'the lifting hand-holds', event: 'when two people lift the sled' },
  'foot-stop': { name: 'the foot brace (the bow bulkhead)', event: 'in a hard bump' },
  // The pivoting front axle (D-56), in words a parent knows: the pivot is "the bolt the front axle turns on", the tongue plate is "the pull arm".
  'bridle-eye': { name: 'the rope tied to the pull arm', event: 'under a hard pull or a yank' },
  'side-web': { name: 'the thin side panels', event: 'if someone leans on them or kicks them' },
  kingpin: { name: 'the bolt the front axle pivots on', event: 'when the sled is pulled hard' },
  'king-bearing': { name: 'the plastic washer the front axle turns on' },
  'front-beam': { name: 'the front axle', event: 'in a hard bump' },
  'front-stub': { name: 'a front wheel stub', event: 'in a hard bump' },
  'steer-stops': { name: 'the steering stops', event: 'when the front axle swings to the end' },
  'king-beam': { name: 'the crossbar that holds the pivot bolt' },
  'wheel-rating': { name: 'a rear wheel', event: 'in a hard bump' },
  'rear-beam-seat': { name: 'the rear axle seat in the side rails', event: 'in a hard bump' },
  'brake-flap': { name: 'a brake flap', event: 'if it is stomped' },
  'brake-pivot': { name: 'a brake flap pivot pin', event: 'under a hard stomp' },
  'brake-mount': { name: 'the mount that holds a brake flap to the side rail', event: 'under a hard stomp' },
  'brake-return': { name: 'the cord that lifts a brake flap' },
  'park-hold': { name: 'the wheel chocks' },
  joists: { name: 'the floor crossmembers' },
  'handle-bow': { name: 'the handlebow', event: 'when the handler pulls back' },
};
/** The rows of the pivoting front end (D-56): the pivot bolt, its washer and crossbar, the axle, the stubs, the stops and the rope tie. */
export const FRONT_END_IDS = new Set(['bridle-eye', 'kingpin', 'king-bearing', 'front-beam', 'front-stub', 'steer-stops', 'king-beam']);
const partText = (id: string) => { const q = PART[id]; return q ? (q.event ? `${q.name} ${q.event}` : q.name) : id; };

/** Why a check fails, as it would read after "Above 230 lb: " (no trailing period). */
const REASON: Record<string, string> = {
  'tip-straight': 'it could tip over on a side slope',
  'slide-before-tip': 'a fast, sharp turn could roll it over instead of skidding',
  'turn-radius': 'the turning circle is too wide',
  'pitch-fwd': 'braking downhill could tip it nose-first',
  'pitch-rear': 'a hard pull uphill can lift the front wheels',
  'brake-force': 'it takes a hard push on each brake flap to hold it on a steep hill (chock a wheel or hold it)',
  'brake-slow': 'the brake flaps would not even slow it on a hill of the usual steepness',
  'axle-stress': 'an axle could bend',
  'beam-rear': 'an axle could bend',
  'bearing-groove': 'an axle could bend',
  rails: 'the side rails could crack',
  deck: 'the floor could crack',
  'seat-back': 'the seat back could break or pull loose when the rider leans back',
  'seat-grip': 'a side grab board could break or pull off when a rider hangs on',
  lift: 'a lifting hand-hold could crack when the sled is carried',
  'foot-stop': 'the foot brace could break or pull off the bow in a hard bump',
  'bridle-eye': 'the rope or the pull arm it ties to could break or tear out under a hard pull',
  kingpin: 'the bolt the front axle pivots on could bend or shear when the sled is pulled hard or hits a bump',
  'king-bearing': 'the plastic washer the front axle turns on could be crushed by the weight',
  'front-beam': 'the front axle could bend or crack in a hard bump',
  'front-stub': 'a front wheel stub could bend in a hard bump',
  'steer-stops': 'a steering stop could crack or pull loose when the front axle swings to the end',
  'king-beam': 'the crossbar that holds the pivot bolt could crack or crush',
  'steer-clear': 'a front tire could rub the body when turned all the way',
  'wheel-rating': 'a rear wheel could be overloaded in a hard bump',
  'rear-beam-seat': 'the notch that holds the rear axle in the side rails could crush or split in a hard bump',
  'brake-flap': 'a brake flap could bend or split if it is stomped',
  'brake-pivot': 'a brake flap pivot pin or its wood could give way under a hard stomp',
  'brake-mount': 'the mount that holds a brake flap to the side rail could crack or pull loose under a hard stomp',
  'brake-return': 'the cord that lifts a brake flap could slip or pull out, and the flap would drag on the tire',
  'park-hold': 'the wheel chocks could slip or be climbed and the sled roll away when parked on a steep hill',
  joists: 'a floor crossmember could crack under the seat',
  'handle-bow': 'the handlebow could crack when the handler pulls back',
  'side-web': 'a thin side panel could crack if someone leans on it or kicks it, or if the cargo shoves against it',
};

/** Rows the D-56 pivoting front end and the D-57 step brake add: each has a plain name or a failure sentence here, pinned by the simple-text test. */
export const PHASE3B_CHECK_IDS = [
  'bridle-eye', 'kingpin', 'king-bearing', 'front-beam', 'front-stub', 'steer-stops', 'king-beam', 'steer-clear',
  'brake-flap', 'brake-pivot', 'brake-mount', 'brake-return', 'park-hold', 'wheel-rating', 'rear-beam-seat',
] as const;
export function failReason(id: string): string {
  return REASON[id] ?? 'a safety check fails';
}

/** What is closest to its limit, as a short noun phrase ("close to the limit (a front wheel stub in a hard bump)"). */
export function limiterName(id: string): string {
  if (PART[id]) return partText(id);
  switch (id) {
    case 'tip-straight': return 'tipping on a side slope';
    case 'slide-before-tip': case 'v-rollover': return 'a fast, sharp turn';
    case 'pitch-fwd': case 'pitch-rear': return 'hills';
    case 'brake-force': case 'brake-slow': case 'brake-traction': return 'braking on a hill';
    case 'turn-radius': return 'turning';
    case 'steer-clear': return 'a front tire rubbing the body when turned';
    default: return 'a safety check';
  }
}

/** One plain next step for the check that limits the rider weight. Static: a pointer to the knob, not a calculation. */
export function limiterAdvice(id: string): string {
  switch (id) {
    case 'tip-straight': case 'slide-before-tip': return 'widen the wheels or lower the floor';
    case 'pitch-rear': case 'pitch-fwd': return 'make the sled longer between the wheels or lower the floor';
    case 'brake-force': case 'brake-slow': case 'brake-traction': case 'park-hold': return 'ask the builders about a stronger brake';
    case 'turn-radius': return 'make the sled shorter between the wheels';
    case 'steer-clear': return 'make the body narrower or the wheels farther apart';
    default: return PART[id] ? `the builders need to strengthen ${PART[id].name}` : 'adjust the sled in the controls below';
  }
}

const val = (c: AnalysisCheck | undefined) => c?.cases?.operating?.value ?? c?.value ?? NaN;
const lim = (c: AnalysisCheck | undefined) => c?.cases?.operating?.limit ?? c?.limit ?? NaN;
const num = (x: number, dp = 0) => (Number.isFinite(x) ? x.toFixed(dp) : '?');
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

  // Tipping over: the side slope it survives with the front axle straight. If a turned-axle row ('tip-lock') exists, the lower of the two governs.
  {
    const a = by(checks, 'tip-straight'), b = by(checks, 'tip-lock') ?? a;
    const g = worstOf([a, b]) ?? a;
    const deg = Math.min(val(a), val(b));
    const status = st(['tip-straight', 'tip-lock']);
    const text = status === 'fail'
      ? `Could tip over on a side slope of ${num(Math.floor(deg))}°; it should hold at least ${num(lim(g))}°. (A very steep hill is about 30°.)`
      : status === 'marginal'
        ? `Stays upright on a ${num(Math.floor(deg))}° side slope, but that is close to the ${num(lim(g))}° it needs. (A very steep hill is about 30°.)`
        : `Stays upright on a ${num(Math.floor(deg))}° side slope. (A very steep hill is about 30°.)`;
    out.tipping = { light: 'tipping', status, text };
  }

  // Fast turns: skid-before-tip (and the rollover speed, info).
  {
    const s = by(checks, 'slide-before-tip'), v = by(checks, 'v-rollover');
    const status = st(['slide-before-tip']);
    const mph = `about ${num(val(v))} mph in a wide turn (a brisk jog is about 6 mph)`;
    const text = status === 'fail'
      ? `In a fast, sharp turn it could tip before it skids. Rollover could happen at ${mph}.`
      : status === 'marginal'
        ? `In a fast, sharp turn it skids before it tips, but only just. Rollover would need ${mph}.`
        : `In a fast, sharp turn it skids before it can tip. Rollover would need ${mph}.`;
    void s;
    out.turns = { light: 'turns', status, text };
  }

  // Hills & braking: foot force on the brake flaps, front lift under a pull, forward pitch.
  {
    const bs = by(checks, 'brake-slow'), pr = by(checks, 'pitch-rear'), pf = by(checks, 'pitch-fwd');
    const status = st(['brake-slow', 'pitch-rear', 'pitch-fwd']);
    const slope = num(p.designSlopeDeg);
    const parts: string[] = [];
    // D-58 (Eric): the step-brake flaps are a just-in-case SLOWING brake. The row that counts is brake-slow (the steepest grade the flaps hold, both feet at the comfortable force);
    // the foot force to hold on the ${slope} degree hill (brake-force) is only information. Holding on a steep hill is the chock's job, or a person holding the sled.
    parts.push(bs?.status === 'fail'
      ? `The brake flaps would slow the loaded sled on hills up to only ${num(val(bs))}° (about ${num(lim(bs))}° is wanted); on steeper hills chock a wheel or have someone hold it.`
      : bs?.status === 'marginal'
        ? `The brake flaps slow the loaded sled on hills up to ${num(val(bs))}°, close to the ${num(lim(bs))}° wanted; on steeper hills chock a wheel or have someone hold it.`
        : `The brake flaps slow the loaded sled on hills up to ${num(val(bs))}°; on steep hills (like the ${slope}° design hill) chock a wheel or have someone hold it.`);
    parts.push(pr?.status === 'fail' ? 'A hard pull uphill could lift the front wheels.'
      : pr?.status === 'marginal' ? "The front won't lift when pulled uphill, but with little to spare."
      : "The front won't lift when pulled uphill.");
    if (pf && (pf.status === 'fail' || pf.status === 'marginal'))
      parts.push(pf.status === 'fail' ? 'Braking downhill could tip it nose-first.' : 'Braking downhill is close to tipping it nose-first.');
    out.hills = { light: 'hills', status, text: parts.join(' ') };
  }

  // Steering (D-56): the front axle pivots on one big bolt and turns about `steerLockDeg` each way; the turning circle is twice the radius of the rear axle's path at full turn
  // (the same number the Analysis turn-radius row reports, taken from the geometry so it reads even before that row is built). Plus whether the tires clear the body.
  {
    const sc = by(checks, 'steer-clear');
    const status = st(['steer-clear']);
    const circleFt = (2 * steerGeometry(p).centerRadiusIn) / 12;
    const lead = `The front axle pivots on one big bolt and turns about ${num(Math.abs(p.steerLockDeg))}° each way; the turning circle is about ${num(circleFt)} ft across.`;
    const clear = sc?.status === 'fail' ? ' At full turn a front tire would rub the body.'
      : sc?.status === 'marginal' ? ' The front tires only just clear the body at full turn.'
      : sc ? ' The front tires clear the body at full turn.' : '';
    out.steering = { light: 'steering', status, text: lead + clear };
  }

  // Strength: the weakest part. The percentage only appears when it matters (close to the limit or past it).
  {
    const rows = checks.filter((c) => lightOf(c) === 'strength' && c.status !== 'info');
    const w = worstOf(rows);
    const status = rows.length ? st(rows.map((r) => r.id)) : 'info';
    const pct = w ? Math.round((w.util ?? 0) * 100) : 0;
    const text = !w ? 'No strength checks to show.'
      : status === 'fail' ? `The weakest point is ${partText(w.id)}, at ${pct}% of the load this design allows. The design keeps a safety factor in reserve, so this is a shortfall in margin, not a forecast that it will break, but it must be fixed before the sled is built.`
      : status === 'marginal' ? `Close to the limit: ${partText(w.id)} (${pct}% of what it can take).`
      : `Every part has a safety margin. Closest to its limit: ${partText(w.id)}.`;
    out.strength = { light: 'strength', status, text };
  }

  // Fits the truck: assembled if possible, otherwise how much has to come off.
  {
    const fits = (cfg: string) => !!fit?.cases.some((c) => c.config === cfg && c.fits);
    const tc = by(checks, 'truck-fit');
    const status: Status = fit ? (fits('removed') || fits('installed') ? 'pass' : 'fail') : (tc?.status ?? 'info');
    const how = fits('installed') ? ', fully assembled.' : fits('removed') ? ' in Transport mode (brake flaps and lights off, handle parked, seat back flat).' : '';
    out.truck = {
      light: 'truck', status,
      text: !fit ? 'Truck fit is still being worked out.'
        : status === 'fail' ? 'Does not fit the Tacoma bed with the tailgate down, even in Transport mode.'
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
    // The rider's own weight fails the checks. Name the limiter; when every failing row is a front-end row, say the rest of the sled passes.
    // Every branch below must read cleanly when NO weight in the swept range is safe (no empty headline, no NaN).
    const worstId = sweep.operating.worst?.id ?? '';
    const fails = sweep.operating.fails ?? [];
    const frontOnly = fails.length > 0 && fails.every((id) => FRONT_END_IDS.has(id));
    const text = `Not safe for a ${w} lb rider: ${failReason(worstId)}.`;
    const rest = frontOnly ? ' Everything else passes at this weight.' : '';
    if (greens.length) return { tone: 'fail', ok: false, text, sub: `This sled is comfortably safe for riders ${range(greens[0].lo, greens[0].hi)}.${rest}` };
    if (yellows.length) return { tone: 'fail', ok: false, text, sub: `Riders ${range(yellows[0].lo, yellows[0].hi)} would be close to the limit.${rest}` };
    const none = `No rider weight from ${fromLb} to ${toLb} lb passes the checks yet. What stops it: ${limiterName(worstId)}.${rest}`;
    return { tone: 'fail', ok: false, text, sub: `${none} To change that: ${limiterAdvice(worstId)}, or press Reset.` };
  }
  if (!green || status === 'marginal') {
    // This weight passes, but only just; say so first, then what is comfortable.
    return {
      tone: 'warn', ok: false,
      text: `A ${w} lb rider is close to this sled's limit.`,
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

// ── Resting weight (D-58, Eric): an adult sitting still or stepping in, no bump. One number for the at-a-glance strip. ──

export interface RestingText {
  status: Status;
  /** "Holds a 220 lb adult sitting or stepping in." */
  text: string;
  /** The weight the sled holds this way, rounded down to 10 lb, or null when the row is missing. */
  maxLb: number | null;
  /** Said once, plainly: the storage lid is not meant to be stood on. */
  note: string;
}

/** The "rest-load" row in words: the most an adult can weigh to sit or step in anywhere (not on the storage lid, which says DO NOT STEP). Pure. */
export function restingText(checks: readonly AnalysisCheck[], targetLb: number): RestingText {
  const note = 'Not the storage lid: it is engraved DO NOT STEP.';
  const r = checks.find((c) => c.id === 'rest-load');
  const d = r?.details?.find((x) => /^the resting weight the sled holds/.test(x.name));
  if (!r || !d) return { status: 'info', text: '', maxLb: null, note };
  const maxLb = Math.floor(d.limit / 10) * 10;
  const status: Status = d.limit >= targetLb ? r.status === 'marginal' ? 'marginal' : 'pass' : 'fail';
  return { status, text: `Holds a ${maxLb} lb adult sitting or stepping in.`, maxLb, note };
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

/** One plain caution for a cargo row that is within 10% of its limit at the target payload (the headline stays green, D-65). */
function cautionText(r: CargoRowTrend, c: CargoCapacity): string {
  switch (r.id) {
    case 'tip-straight':
      return `At ${c.payloadLb} lb a tall load is close to tipping: keep heavy items low, with the center of weight within about ${n0(c.heightRule?.designIn ?? 10)} in of the deck.`;
    case 'slide-before-tip':
      return `At ${c.payloadLb} lb a fast, sharp turn is close to rolling it: keep heavy items low and turn gently.`;
    default:
      return `At ${c.payloadLb} lb ${limiterName(r.id)} is close to its limit (${n0(r.utilAtPayload * 100)}% of what it can take).`;
  }
}

/** Words for the cargo card of the Simple view, from a payload sweep. Pure. */
export function cargoText(c: CargoCapacity): CargoText {
  const cap = c.capacityLb;
  const headline = cap === null ? `Hauls ${c.maxLb} lb or more after the race` : `Hauls up to ${rounded5(cap)} lb after the race`;
  const short = cap !== null && cap < c.payloadLb;
  // D-65 (Eric): green when the capacity covers the target and nothing fails at it. Rows that are merely close to their limit at the target become a plain caution line under the headline,
  // not a yellow headline (it read as a capacity problem although 270 lb is more than the 200 lb target). Amber only when the capacity is below the target, red when a row fails at it.
  const failsAtTarget = c.counts.fail > 0 || c.cargoFailsAtPayload.length > 0;
  const tone: Tone = failsAtTarget ? 'fail' : short ? 'warn' : 'pass';
  const lines: string[] = [];
  if (!failsAtTarget) for (const r of c.rows.filter((q) => q.statusAtPayload === 'marginal' && !q.fixed)) lines.push(cautionText(r, c));
  lines.push(`The target is ${c.payloadLb} lb of camp gear, firewood and water with the seat back flipped flat and the cushions in the storage box. ${tone === 'pass' ? 'Nothing fails at that load.' : tone === 'warn' ? `The capacity is below that load.` : `${c.counts.fail} check${c.counts.fail === 1 ? ' fails' : 's fail'} at that load.`}`);
  if (c.limiter && short) lines.push(`What stops it first: ${limiterName(c.limiter.id)}.${c.alwaysFailing.length ? ` ${c.alwaysFailing.length} other check${c.alwaysFailing.length === 1 ? ' fails' : 's fail'} even with nothing on the bed.` : ''}`);
  else if (c.limiter) lines.push(`Closest to its limit as the load grows: ${limiterName(c.limiter.id)}.`);
  if (c.limiterOther && c.capacityOtherLb !== null && c.limiterOther.id !== c.limiter?.id)
    lines.push(`Leaving out the checks that already fail for riders (the front end), the next limit is ${limiterName(c.limiterOther.id)}, at about ${rounded5(c.capacityOtherLb)} lb.`);
  const b = c.bed;
  lines.push(`The bed is flat once the seat back is flipped down and the cushions are in the box: ${n0(b.widthIn)} in wide all the way, ${n0(b.totalLengthIn)} in long out to the foot brace, and ${n0(b.heightIn)} in to the top of the sides at the low (bow) end (the sides rise toward the back). ${c.stow.applicable ? (c.stow.status === 'fail' ? 'The two cushions do NOT fit in the box.' : c.stow.status === 'marginal' ? 'The two cushions fit in the box, but only just.' : 'The two cushions lie flat in the box.') : ''}`.trim());
  if (c.heightRule)
    {
      const { designIn, tipLimitIn, slideLimitIn } = c.heightRule;
      // Name whichever limit comes first as the load gets taller (D-67: the slide-before-tip height is now the lower one).
      const why = slideLimitIn <= tipLimitIn
        ? `above about ${n0(slideLimitIn)} in a sharp turn can tip it instead of skidding, and about ${n0(tipLimitIn)} in is the tipping limit itself.`
        : `it reaches the tipping limit at about ${n0(tipLimitIn)} in, and above about ${n0(slideLimitIn)} in a sharp turn can tip it instead of skidding.`;
      lines.push(`Load-height rule: heavy things low, on the floor, strapped down. Keep the middle of the load under ${n0(designIn)} in above the floor; ${why}`);
    }
  if (c.rearTraction !== null && c.rearTraction < 1)
    lines.push(`Parked nose-down on a steep hill with the full load, the rear brake flaps alone hold about ${n0(c.rearTraction * 100)}% of it; the pullers (or a chock) hold the rest.`);
  return { tone, headline, lines };
}
