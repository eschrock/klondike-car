/**
 * The briefing book: a short, printable HTML handout for the troop committee. What the sled is for, two pictures (ready to roll and
 * packed for the truck), the main features and the cost by BOM section with a total. The build book is for the shop; this is for the
 * people who approve the money, so it carries no part numbers, joinery or design IDs.
 *
 * Plain TS, no DOM: the two pictures come in as image URLs (the app renders them from the 3D viewer). The prose lives in this file; the
 * numbers (prices, weights, sizes) come from the model and the BOM, so the book stays right when the design changes.
 */
import { KNEE_MOUNT, type Params } from '../params';
import type { Part } from '../model/types';
import { totalMass } from '../model/mass';
import { worldAABB } from '../model/bounds';
import { SHIPPING_TAX_PHRASE, type Bom, type BomSection } from './bom';
import { esc, pct, usd } from '../ui/build-helpers';

export interface BriefingImages {
  /** The sled ready to roll (seat up, handlebow up, lights and brakes on). */
  mobile?: string;
  /** The sled packed for the truck (Transport mode). */
  transport?: string;
}

export interface BriefingInput {
  p: Params;
  /** The empty sled as built (no rider or cargo). */
  parts: Part[];
  /** The empty sled in Transport mode. */
  transportParts: Part[];
  bom: Bom;
  images?: BriefingImages;
  /** ISO date (YYYY-MM-DD) for the cover line. */
  date?: string;
  /** The shareable design link. */
  link?: string;
}

/** Share of what the troop buys added as the budget allowance for shipping, tax and price changes. Edit to taste. */
export const BUDGET_ALLOWANCE = 0.15;
/** The BOM sections the builder buys and donates (the wood), and who donates them, as the book says it. */
export const DONATED_SECTIONS: ReadonlyArray<BomSection['id']> = ['lumber', 'plywood'];
export const DONOR = 'Eric';

/** What each BOM section holds, in plain words for the committee. One entry per BOM section id. */
export const SECTION_BLURB: Record<BomSection['id'], string> = {
  lumber: 'White oak boards for the frame, sides, axle beams, seat, grab boards, handlebow and brake flaps. White oak is strong and stands up to wet weather, which is why the sled should last for years.',
  plywood: 'Two 4 × 8 ft sheets: marine plywood for the deck and seat back, and thin birch plywood for the side panels and the storage box.',
  metal: 'Steel rod for the axles, stainless bar and angle for the axle clamps and brake straps, and aluminum tube for the handlebow sockets. Bought as stock and cut and drilled in the shop: no welding.',
  purchased: 'Ready-made parts: four 10" air-filled wheels, the steering pivot and check chains, seat-back hinges and pins, storage-box hinges, latches and gasket, brake pads, the pull rope and a flag holder.',
  fasteners: `Stainless screws, bolts, nuts and washers, threaded inserts for the parts that come off, the axle collars and plugs. The joinery tenons come from ${DONOR}'s shop at no cost.`,
  consumables: `Exterior spar varnish, epoxy, marine sealant and edge banding. Wood glue, sandpaper, brushes and thinner come from ${DONOR}'s shop at no cost.`,
  touches: 'Priced as their own group: a front headlight, a rear red light and reflectors for the night start, seat and back cushions, and tie-down points for hauling gear.',
};

const CSS = `
:root { color-scheme: light; --ink: #1b1b1b; --muted: #5c5c5c; --rule: #c9c4b8; --tint: #f3efe6; --accent: #2f5d3a; }
* { box-sizing: border-box; }
html { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: var(--ink); background: #fff; font-size: 11pt; line-height: 1.45; }
body { margin: 0 auto; max-width: 8.5in; padding: 0.5in 0.6in; }
h1 { font-size: 24pt; margin: 0 0 2pt; line-height: 1.15; }
h2 { font-size: 15pt; margin: 0 0 8pt; padding-bottom: 3pt; border-bottom: 2px solid var(--accent); color: var(--accent); }
h3 { font-size: 12pt; margin: 12pt 0 4pt; }
p { margin: 5pt 0; }
ul { margin: 4pt 0 6pt; padding-left: 18pt; }
li { margin: 2pt 0; }
section { margin-top: 20pt; }
.sub { font-size: 13pt; color: var(--muted); margin: 0 0 4pt; }
.muted { color: var(--muted); }
.small { font-size: 9pt; }
.ask { background: var(--tint); border-left: 4px solid var(--accent); padding: 8pt 12pt; margin: 12pt 0; }
.ask p { margin: 3pt 0; }
.facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6pt; margin: 10pt 0; }
.fact { border: 1px solid var(--rule); border-radius: 4pt; padding: 6pt 8pt; break-inside: avoid; }
.fact b { display: block; font-size: 14pt; }
.fact span { font-size: 9pt; color: var(--muted); }
figure { margin: 8pt 0 12pt; break-inside: avoid; }
figure img { display: block; width: 100%; height: auto; border: 1px solid var(--rule); border-radius: 4pt; background: #f7f6f2; }
figcaption { font-size: 9.5pt; color: var(--muted); margin-top: 3pt; }
.noimg { border: 1px dashed var(--rule); padding: 30pt; text-align: center; color: var(--muted); }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 8pt; font-size: 10pt; }
th, td { border-bottom: 1px solid var(--rule); padding: 5pt 6pt; text-align: left; vertical-align: top; }
th { background: var(--tint); font-weight: 600; border-top: 1px solid var(--rule); }
td.num, th.num { text-align: right; white-space: nowrap; }
td.name { font-weight: 600; white-space: nowrap; }
tr { break-inside: avoid; }
tr.subtotal td { font-weight: 600; text-align: right; color: var(--muted); }
tr.subtotal td.num { color: var(--ink); }
tr.total td { font-weight: 700; border-top: 2px solid var(--ink); }
tr.budget td { font-weight: 700; background: var(--tint); }
@page { size: Letter; margin: 0.6in; }
@media print {
  body { max-width: none; padding: 0; }
  html { font-size: 10pt; }
  section.page { break-before: page; }
  a { color: inherit; text-decoration: none; }
}
`;

/** A length in inches as feet and inches, rounded up to the next inch: 65.75 -> 5' 6". */
function feetInches(v: number): string {
  const inches = Math.ceil(v - 1e-6);
  const ft = Math.floor(inches / 12), rem = inches % 12;
  return ft ? `${ft}' ${rem}"` : `${rem}"`;
}
const roundLb = (v: number): string => String(Math.round(v));

/** Overall size of the sled itself (no rider, cargo, reference figures or the pull rope). */
function overall(parts: Part[]): { l: number; w: number; h: number } {
  const sled = parts.filter((x) => !x.payload && x.group !== 'reference' && x.id !== 'bridle');
  const b = worldAABB(sled);
  return { l: b.max[0] - b.min[0], w: b.max[1] - b.min[1], h: b.max[2] - b.min[2] };
}

function figure(src: string | undefined, alt: string, caption: string): string {
  const img = src && /^(data:image\/|https?:|blob:)/.test(src)
    ? `<img src="${esc(src)}" alt="${esc(alt)}">`
    : `<div class="noimg">${esc(alt)} (picture not available)</div>`;
  return `<figure>${img}<figcaption>${caption}</figcaption></figure>`;
}

export function briefingBookHtml(d: BriefingInput): string {
  const { p, bom } = d;
  const emptyLb = totalMass(d.parts);
  const liftLb = totalMass(d.transportParts);
  const size = overall(d.parts);
  const packed = overall(d.transportParts);
  const donated = bom.sections.filter((s) => DONATED_SECTIONS.includes(s.id));
  const donatedUsd = donated.reduce((a, s) => a + s.subtotalUsd, 0);
  const troopUsd = bom.totalUsd - donatedUsd;
  const budget = Math.ceil((troopUsd * (1 + BUDGET_ALLOWANCE)) / 50) * 50;
  const removableKnees = p.kneeMount === KNEE_MOUNT.removable;
  // The touches that can wait: everything but the lights and reflectors, which the night start needs.
  const canWait = (bom.sections.find((s) => s.id === 'touches')?.groups ?? []).filter((g) => g.id === 'seat' || g.id === 'tie-downs').reduce((a, g) => a + g.subtotalUsd, 0);
  const cmp = bom.weatherCompare;
  // What the Extreme weather version adds to what the troop buys (the wood it changes is donated either way).
  const otherAdds = cmp.computed && bom.spec === 'standard' ? cmp.deltaUsd - DONATED_SECTIONS.reduce((a, id) => a + (cmp.deltaBySection[id] ?? 0), 0) : NaN;

  const out: string[] = [];
  out.push(`<header>
<h1>The Troop 455 Klondike Sled</h1>
<p class="sub">Troop Committee Brief</p>
<p class="muted small">${d.date ? `Prepared ${esc(d.date)} ` : ''} by Eric Schrock and Ashley Peck</p>
</header>`);

  out.push(`<div class="ask">
<p><strong>What we are asking for:</strong> Approval to build a sturdy, reusable wheeled sled for the Klondike Derby, with a troop budget of <strong>${usd(budget, false)}</strong>.</p>
<p class="small">The parts come to ${usd(bom.totalUsd, false)} in all. The lumber and plywood (${usd(donatedUsd, false)}) are donated by ${esc(DONOR)}, so the troop buys ${usd(troopUsd, false)} of parts; the budget adds ${pct(BUDGET_ALLOWANCE)} to that for shipping, sales tax and price changes. The labor and the shop tools are volunteered by ${esc(DONOR)}.</p>
</div>`);

  out.push(`<div class="facts">
<div class="fact"><b>${roundLb(p.riderMassLb)} lb</b><span>rider it is built for (tested to ${roundLb(p.riderGoalMassLb)} lb)</span></div>
<div class="fact"><b>${roundLb(p.cargoPayloadLb)} lb</b><span>of camp gear with the seat folded</span></div>
<div class="fact"><b>${roundLb(emptyLb)} lb</b><span>empty; two people lift about ${roundLb(liftLb / 2)} lb each</span></div>
<div class="fact"><b>${feetInches(size.l)} × ${feetInches(size.w)}</b><span>long by wide, on four 10" air-filled wheels</span></div>
<div class="fact"><b>Pickup bed</b><span>sized for a short bed pickup truck</span></div>
<div class="fact"><b>${usd(troopUsd, false)}</b><span>of parts for the troop to buy; the wood is donated</span></div>
</div>`);

  // ── Purpose ──
  out.push(`<section>
<h2>Why a Klondike sled</h2>
<p>Every winter our scouts take part in the Klondike Derby at Bert Adams Scout Camp. Each patrol pulls a sled from "town" to "town", carrying at least one scout as a rider the whole way, and is graded at each town on accuracy, neatness, the Scout Law and completing the task. The race starts after dark, wheels are allowed between towns, and each team carries its 10 Essentials.</p>
<p>A troop-owned sled gives our scouts something of their own that is safe, easy to pull and good enough to be proud of, and it is built to come back out year after year.</p>
<h3>Built to be reused</h3>
<ul>
<li><strong>Lasts for years.</strong> White oak, marine plywood, stainless hardware and an exterior varnish. Stored in a garage between events, it should need little more than a check-over and a fresh coat of varnish now and then.</li>
<li><strong>Safe for the rider.</strong> A low seat with a back, a hand-hold on each side, a foot brace, brakes the person at the back works with a foot, wheel chocks for parking, and lights and reflectors for the night start. It is built for a ${roundLb(p.riderMassLb)} lb scout and checked to ${roundLb(p.riderGoalMassLb)} lb.</li>
<li><strong>Easy to move.</strong> It rides in a pickup bed. The handlebow, brake flaps and lights come off without tools${removableKnees ? ', the brake brackets unbolt with a ratchet and wrench' : ''}, and two adults can lift it.</li>
</ul>
<h3>More than one event a year</h3>
<p>The same sled works as a general-purpose troop cart wherever we need to move gear or put on a show:</p>
<ul>
<li><strong>Camp hauler.</strong> Fold the seat back flat and it carries about ${roundLb(p.cargoPayloadLb)} lb of firewood, coolers, water or duffels from the parking lot to the campsite. Tie-down points on each side hold the load.</li>
<li><strong>Parades and community events.</strong> Troop 455 signs on both sides, a flag holder and lights make it a ready-made float for a parade, a march, or a town festival.</li>
<li><strong>Service projects and drives.</strong> Food drives, park clean-ups and tree sales: anywhere scouts need to move a load on foot.</li>
<li><strong>Recruiting and displays.</strong> A good-looking, scout-built project to show at a Webelos crossover, a school night or a court of honor.</li>
</ul>
</section>`);

  // ── Pictures ──
  out.push(`<section class="page">
<h2>What it looks like</h2>
${figure(d.images?.mobile, 'The sled ready to roll', `<strong>Ready to roll.</strong> The patrol pulls and steers on a rope tied to the steering tongue at the front; the rider sits low in the seat and holds the hand-holds; a scout at the back pushes on the handlebow and slows the sled with the foot brakes. The storage box behind the seat carries the 10 Essentials. About ${feetInches(size.l)} long, ${feetInches(size.w)} wide over the wheels.`)}
${figure(d.images?.transport, 'The sled packed for the truck', `<strong>Packed for the truck.</strong> The handlebow drops to its low position, the seat back folds flat, and the brake flaps, lights and wheel chocks come off without tools${removableKnees ? '; the brake brackets unbolt with a ratchet and wrench, so nothing sticks out beside the tires' : ''}. About ${feetInches(packed.l)} × ${feetInches(packed.w)} × ${feetInches(packed.h)} high, ${roundLb(liftLb)} lb: two adults lift it into a pickup bed with the tailgate down.`)}
</section>`);

  // ── Cost ──
  const blurb = (s: BomSection): string => (SECTION_BLURB[s.id] ?? '') + (s.id === 'purchased' && removableKnees ? ' Also a ratchet and wrench that stay with the sled for the brake brackets.' : '');
  const row = (s: BomSection): string => `<tr><td class="name">${esc(s.title)}</td><td>${esc(blurb(s))}</td><td class="num">${usd(s.subtotalUsd, false)}</td></tr>`;
  const rows = [
    ...donated.map(row),
    `<tr class="subtotal"><td colspan="2">Lumber and plywood, donated by ${esc(DONOR)}</td><td class="num">${usd(donatedUsd, false)}</td></tr>`,
    ...bom.sections.filter((s) => !DONATED_SECTIONS.includes(s.id)).map(row),
    `<tr class="subtotal"><td colspan="2">Parts the troop buys</td><td class="num">${usd(troopUsd, false)}</td></tr>`,
    `<tr class="total"><td colspan="2">All parts, donated and bought (${esc(SHIPPING_TAX_PHRASE)})</td><td class="num">${usd(bom.totalUsd, false)}</td></tr>`,
    `<tr class="budget"><td colspan="2">Troop budget: the parts the troop buys plus ${pct(BUDGET_ALLOWANCE)} for shipping, tax and price changes</td><td class="num">${usd(budget, false)}</td></tr>`,
  ];
  out.push(`<section class="page">
<h2>What it costs</h2>
<p>The full bill of materials is in the build book. Here it is by group. Prices are 2026 retail, mostly quoted from local yards and online listings; about ${pct(bom.estimateShare)} of the total is still an estimate.</p>
<table><thead><tr><th>Group</th><th>What it covers</th><th class="num">Cost</th></tr></thead><tbody>${rows.join('')}</tbody></table>
<h3>Notes on the cost</h3>
<ul>
<li><strong>Not in the troop budget:</strong> the lumber and plywood (donated), ${esc(DONOR)}'s tools and the labor (volunteered). Shipping and sales tax on the rest are covered by the budget allowance.</li>
${canWait > 0 ? `<li><strong>Room to trim:</strong> the cushions and tie-down points (${usd(canWait, false)}) can wait if needed. The lights and reflectors should be on for the first Derby, since the race starts after dark.</li>` : ''}
${Number.isFinite(otherAdds) && otherAdds > 0 ? `<li><strong>A tougher option:</strong> a version for a sled stored outdoors (marine-grade stainless hardware and epoxy throughout) would add about ${usd(otherAdds, false)} to what the troop buys. We do not think the troop needs it as long as the sled lives in a garage.</li>` : ''}
<li><strong>Running costs:</strong> small. A coat of varnish every few years and the odd tire tube or bolt.</li>
</ul>
</section>`);

  // ── Discussion ──
  out.push(`<section>
<h2>For the committee to discuss</h2>
<ul>
<li>Approve the budget of ${usd(budget, false)}</li>
<li>Where the sled is stored between events (it needs a dry garage or shed, about ${feetInches(size.l)} × ${feetInches(size.w)} of floor).</li>
<li>Who looks after it: a yearly check of the bolts, tires and brakes before the Derby.</li>
<li>Whether scouts can take partt in the build (will be difficult with a tight schedule and complex build, but could have finishing days that are scout-accessible.</li>
<li>Other events where the troop would like to use it.</li>
</ul>
${d.link ? `<p class="muted small">The full design, with a 3D model, safety checks and the build book: <a href="${esc(d.link)}">${esc(d.link.length > 90 ? d.link.slice(0, 87) + '…' : d.link)}</a></p>` : ''}
</section>`);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Klondike sled briefing</title><style>${CSS}</style></head>
<body>
${out.join('\n')}
</body></html>
`;
}
