/**
 * Plain-English wording for the Simple view (D-30). Pure functions of the check values: no numbers are hard-coded here,
 * only the sentence shapes (docs/simple-view-spec.md "Traffic lights" table). No DOM, so it is unit-testable.
 */
import type { Params } from '../params';
import type { FitResult } from '../truck/fit';
import type { AnalysisCheck, Status } from '../analysis/types';
import { SEVERITY } from '../analysis/types';
import { LIGHT_OF_ID, lightOf, type Light, type Limiter, type SafeRange } from '../analysis/rider-sweep';

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

/** How a structure check reads in a sentence, and the event that stresses it. */
const PART: Record<string, { name: string; event?: string }> = {
  'kingpin-strike': { name: 'the kingpin', event: 'in a curb strike' },
  'roll-side-bearer': { name: 'the side bearers', event: 'when the cart leans' },
  'roll-kingpin-uplift': { name: 'the kingpin', event: 'when the cart leans' },
  'roll-bolster-attach': { name: 'the bolster fasteners', event: 'when the cart leans' },
  'axle-stress': { name: 'the axle' },
  'beam-front': { name: 'the front axle beam' },
  'beam-rear': { name: 'the rear axle beam' },
  'bearing-groove': { name: 'the wheel bearing groove' },
  rails: { name: 'the side rails' },
  deck: { name: 'the floor' },
  kingpin: { name: 'the kingpin' },
  turntable: { name: 'the turntable' },
  tongue: { name: 'the tongue' },
};
const partText = (id: string) => { const q = PART[id]; return q ? (q.event ? `${q.name} ${q.event}` : q.name) : id; };

/** Why a check fails, as it would read after "Above 230 lb: ". */
const REASON: Record<string, string> = {
  'tip-straight': 'it could tip over on a side slope',
  'tip-lock': 'it could tip over on a side slope when turned',
  'slide-before-tip': 'in a fast, sharp turn it could tip before it skids',
  'turn-radius': 'the turning circle is too wide',
  'steer-clear': 'the wheels could hit the hull when steering',
  'pitch-fwd': 'braking downhill could tip it nose-first',
  'pitch-rear': 'a hard uphill pull can lift the front wheels',
  'kingpin-strike': 'a curb strike could overload the kingpin',
  'roll-kingpin-uplift': 'leaning hard could pull the kingpin out',
  'brake-force': 'holding it on a hill takes too much force on the brake handle',
};
export function failReason(id: string): string {
  if (REASON[id]) return REASON[id];
  const q = PART[id];
  return q ? `${partText(id)} could be overloaded` : `${id} could fail`;
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
    const mph = `about ${num(val(v))} mph at full lock`;
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
        : `Holds on a ${slope}° hill with ${num(val(bf))} lb on the brake handle.`);
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
      ? `Needs a ${circle} ft circle to turn (the limit is ${feet(2 * lim(tr))} ft)`
      : `Turns in a ${circle} ft circle`;
    const part2 = sc?.status === 'fail' ? 'the wheels hit the hull when steered' : sc?.status === 'marginal' ? 'the wheels only just clear the hull' : 'the wheels clear the hull';
    out.steering = { light: 'steering', status, text: `${part1}; ${part2}.` };
  }

  // Strength: the weakest part, as a share of its design limit.
  {
    const rows = checks.filter((c) => lightOf(c) === 'strength' && c.status !== 'info');
    const w = worstOf(rows);
    const status = rows.length ? st(rows.map((r) => r.id)) : 'info';
    const pct = w ? Math.round((w.util ?? 0) * 100) : 0;
    const text = !w ? 'No strength checks to show.'
      : status === 'fail' ? `${cap(partText(w.id))} would be past its design limit (${pct}% of what it can take).`
      : `Every part is at most ${pct}% of its design limit (weakest: ${partText(w.id)}).`;
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

/** "Safe for riders about 70–230 lb" and friends. */
export function headline(w: number, safe: SafeRange | null, lowLimit: Limiter | null, fromLb: number, toLb: number): { ok: boolean; text: string } {
  if (!safe) return { ok: false, text: `Not safe for a ${w} lb rider: ${failReason(lowLimit?.id ?? '')}.` };
  const { loLb, hiLb, openLow, openHigh } = safe;
  if (openLow && openHigh) return { ok: true, text: `Safe for every rider from ${fromLb} to ${toLb} lb` };
  if (openLow) return { ok: true, text: `Safe for riders up to about ${hiLb} lb` };
  if (openHigh) return { ok: true, text: `Safe for riders from about ${loLb} lb up` };
  return { ok: true, text: `Safe for riders about ${loLb}–${hiLb} lb` };
}

export function limitLine(side: 'below' | 'above', safe: SafeRange | null, limit: Limiter | null): string | null {
  if (!safe || !limit) return null;
  const at = side === 'below' ? safe.loLb : safe.hiLb;
  const cap1 = failReason(limit.id);
  return `${side === 'below' ? 'Below' : 'Above'} ${at} lb: ${cap1}`;
}
