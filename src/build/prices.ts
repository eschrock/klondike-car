/**
 * Unit prices for the BOM (Phase 4). One table, next to the part sourcing; nothing else in `src/build` holds a dollar figure.
 *
 * Every entry says where the number comes from. `basis: 'quoted'` is a real price: one the MODEL carries (`part.sourcing.costUsd`), one Eric gathered from a named vendor's
 * published list, or one from the web price research of 2026-10-12 (docs/price-research/price-research-2026-10.md: the `found(...)` entries, each with its vendor, URL and date). Every other
 * entry is an `estimate`: a realistic 2026 US retail price, rounded, to be replaced by a real quote before ordering. No SKUs are invented: `source` names a vendor or a kind of vendor.
 * `url` is a real link from Eric or from the research (the vendor's price list or product page); it goes to the BOM line, the BOM CSV and the build book. Never invent one.
 *
 * Base versus alternatives (price research, 2026-10-12): the BASE price is always the item the model specifies. A cheaper or different item that does not meet the spec
 * (304 for 316, beech Dominos for Sipo) is an ALTERNATIVE (`Price.alternatives`, `specGap: true`), shown in the BOM line notes and never
 * substituted silently. An item the research did not find keeps its estimate with "not found in the 2026-10-12 research" in the note.
 */

import { WEATHER_SPEC, type Params } from '../params';

export type PriceBasis = 'quoted' | 'estimate';

/**
 * The weather spec the BOM is priced for (D-73, Eric 2026-10-12). STANDARD (the default; garage-kept, used a few times a year, wet at most at a rainy derby): 304 / 18-8 stainless, zinc and
 * galvanized where it lives dry, beech Dominos, Titebond III, exterior spar urethane, a small epoxy kit; priced from docs/price-research/price-research-standard-2026-10.md. EXTREME (stored outside,
 * near salt, or exposed regularly): 316 throughout, Sipo Dominos, epoxy everywhere, marine varnish, the gallon epoxy kit; priced from docs/price-research/price-research-2026-10.md.
 * A Standard listing that is the nearest size or kind (not the exact item the model asks for) is priced as an `estimate` with its link and the gap in the note; an exact listing is `quoted`.
 */
export type SpecName = 'standard' | 'extreme';
export const specOf = (p: Pick<Params, 'weatherSpec'>): SpecName => (p.weatherSpec === WEATHER_SPEC.extreme ? 'extreme' : 'standard');

/** The date of the web price research whose prices are `quoted` below (docs/price-research/price-research-2026-10.md). */
export const RESEARCH_DATE = '2026-10-12';
/** Said on every price the search tool read from a vendor page without the page being fetched. */
export const SEARCH_READ_NOTE = 'price read via search, confirm on the page';

export interface Price {
  usd: number;
  /** What `usd` is per: 'bf', 'sheet', 'ft', 'ea', 'kit', 'qt', 'fl oz', 'roll'. */
  unit: string;
  source: string;
  basis: PriceBasis;
  note?: string;
  /** A real link for this price (Eric's vendor page, or the research). Optional: only where we have one. */
  url?: string;
  /**
   * Sold in packs much larger than a sled needs (screws, nuts, washers, inserts, Dominos, tape...) or in fixed stock pieces (metal bars, tape rolls): the PACK size and pack price.
   * `usd` is then the per-unit equivalent (`packUsd / packQty`). A fastener that needs under `BULK_SHARE` of a pack (bom.ts) goes to the 'Bulk parts' section; every packed
   * line is priced by whole packs.
   */
  packQty?: number;
  packUsd?: number;
  /**
   * Also sold by the piece (Bolt Depot sells fasteners singly or by the bag): the single-piece price. The BOM buys whichever is cheaper for the count (`qty x eachUsd` against whole packs),
   * so a small count is priced per piece, in place, and only a count that makes the bag cheaper goes to the pack / bulk-parts logic.
   */
  eachUsd?: number;
  /** What one pack is called when it is not "pack of N": '60 in piece', '10 ft roll'. */
  packLabel?: string;
  /** A purchased part drawn from a pack of `unit`s (a cord cut from a roll): units used per part. The BOM prices whole packs for the parts it needs. */
  perPart?: number;
  /** An alternative (an ALTERNATIVE price, not the base): it does not meet the model's spec. The note starts "SPEC GAP: ...". */
  specGap?: boolean;
  /** Cheaper or different options for the same item, shown in the BOM line notes. Never silently substituted. */
  alternatives?: Price[];
  /** A decision Eric must make about this item (the BOM flags the line key in `Bom.decisions`). */
  decision?: string;
}

const est = (usd: number, unit: string, source: string, note?: string, url?: string): Price => ({ usd, unit, source, basis: 'estimate', ...(note ? { note } : {}), ...(url ? { url } : {}) });
const quoted = (usd: number, unit: string, source: string, note?: string, url?: string): Price => ({ usd, unit, source, basis: 'quoted', ...(note ? { note } : {}), ...(url ? { url } : {}) });

/** An estimated price for something sold in packs: `usd` is the per-piece equivalent of the pack price. */
const packed = (packQty: number, packUsd: number, unit: string, source: string, note?: string): Price => ({ ...est(packUsd / packQty, unit, source, note), packQty, packUsd });

/** A price from the web research of 2026-10-12: quoted, with its vendor, URL and date in the note. `search`: read via the search tool, not fetched. */
const found = (usd: number, unit: string, source: string, url: string, note: string, search = false): Price =>
  quoted(usd, unit, source, `${note} [${source}, ${RESEARCH_DATE}${search ? `; ${SEARCH_READ_NOTE}` : ''}]`, url);
/** The same for something sold in packs (or fixed pieces): `usd` is per unit, the pack is `packQty` units for `packUsd`. */
const foundPack = (packQty: number, packUsd: number, unit: string, source: string, url: string, note: string, search = false, packLabel?: string): Price =>
  ({ ...found(packUsd / packQty, unit, source, url, note, search), packQty, packUsd, ...(packLabel ? { packLabel } : {}) });
/** The same pack price, also sold by the piece at `each`. */
const withEach = (p: Price, each: number): Price => ({ ...p, eachUsd: each });
/** An alternative that does not meet the spec: says so first. */
const gap = (p: Price, why: string): Price => ({ ...p, specGap: true, note: `SPEC GAP: ${why}. ${p.note ?? ''}`.trim() });
/** The same price with its alternatives (and, optionally, a decision for Eric). */
const withAlts = (p: Price, alternatives: Price[], decision?: string): Price => ({ ...p, alternatives, ...(decision ? { decision } : {}) });
/** An estimate the research did not find a price for: it keeps the estimate and says so. */
const notFound = (p: Price): Price => ({ ...p, note: `${p.note ? `${p.note} - ` : ''}not found in the ${RESEARCH_DATE} research` });

/** The links Eric gave (2026-10-12). */
export const WOODYARD_URL = 'https://www.thewoodyard.com/current-pricing-list/';
export const WOODYARD_PLYWOOD_URL = 'https://www.thewoodyard.com/current-pricing-list/#plywood';
export const AIRCRAFT_SPRUCE_OKOUME_URL = 'https://www.aircraftspruce.com/catalog/wppages/okume.php';
export const CLINE_WHITE_OAK_URL = 'https://clinelumber.com/products/kiln-dried-hardwood/white-oak/';

// ── Lumber and sheet ──────────────────────────────────────────────────────────

const HARDWOOD = 'Local hardwood dealer (rough, kiln-dried white oak)';
const WOODYARD = 'The Wood Yard (local), current pricing list (Eric, 2026-10-12), plus tax';
/** White oak, $/board foot on nominal thickness. Thick stock costs more per board foot (scarcer, slower to dry). 4/4, 8/4 and 12/4: The Wood Yard's list (Eric, 2026-10-12). */
export const OAK_PRICE_PER_BF: Record<string, Price> = {
  '4/4': quoted(10, 'bf', WOODYARD, 'white oak 4/4 (their knotty 4/4 "CG" is $7.50: not for the bent strips or the structural members)', WOODYARD_URL),
  // 5/4 and 6/4 are not on The Wood Yard list: Cline's FAS price x the Wood Yard's premium over Cline on 4/4 and 8/4 (10 / 7.52 = 1.33, 15 / 11.72 = 1.28; about 1.3).
  '5/4': est(11.9, 'bf', HARDWOOD, 'not on The Wood Yard list: a local yard, estimated as Cline FAS $9.17 x 1.3 (the local premium on 4/4 and 8/4)'),
  '6/4': est(14.1, 'bf', HARDWOOD, 'not on The Wood Yard list: a local yard, estimated as Cline FAS $10.82 x 1.3 (the local premium on 4/4 and 8/4)'),
  '8/4': quoted(15, 'bf', WOODYARD, 'white oak 8/4', WOODYARD_URL),
  '12/4': quoted(25, 'bf', WOODYARD, 'white oak 12/4: NOT BOUGHT. The four parts that needed it are face-laminated from 4/4; this price only shows what the laminating saves', WOODYARD_URL),
  '16/4': est(32, 'bf', HARDWOOD, 'special-order'),
};

/**
 * Alternative oak prices (quoted, published): Cline Lumber, FAS kiln-dried white oak, under 100 bf (Eric, 2026-10-12). Much cheaper but far from Atlanta;
 * the BOM shows what the same boards would cost there, next to the base (local) price.
 */
const CLINE = 'Cline Lumber, FAS kiln-dried white oak, under 100 bf (far from Atlanta)';
export const OAK_ALT_PRICE_PER_BF: Record<string, Price> = {
  '4/4': quoted(7.52, 'bf', CLINE, undefined, CLINE_WHITE_OAK_URL),
  '5/4': quoted(9.17, 'bf', CLINE, undefined, CLINE_WHITE_OAK_URL),
  '6/4': quoted(10.82, 'bf', CLINE, undefined, CLINE_WHITE_OAK_URL),
  '8/4': quoted(11.72, 'bf', CLINE, undefined, CLINE_WHITE_OAK_URL),
};

/**
 * The oak thicknesses the board plan may buy. A thickness set false is skipped: its parts move up to the next stocked thickness (milled down) and the
 * resaw strips are re-planned from what is stocked. The Wood Yard lists 4/4, 8/4 and 12/4 only (2026-10-12); 5/4 and 6/4 are left on for the other
 * yards Eric may use (set them false to plan from The Wood Yard alone). 12/4 is OFF (D-70): at $25/bf it is the dearest board, and the only four parts that needed it
 * (the two axle beams, the brake knees, the chocks) are face-laminated from stocked boards instead (`planLamination` in cutlist.ts). 16/4 is off: nothing needs it.
 */
export const OAK_STOCKED: Record<string, boolean> = { '4/4': true, '5/4': true, '6/4': true, '8/4': true, '12/4': false, '16/4': false };
export const isOakStocked = (nominal: string): boolean => OAK_STOCKED[nominal] !== false;

/** Marine plywood, full 4 x 8 sheets (D-68): prices Eric gathered 2026-10-12, plus tax. */
export const PLYWOOD_PRICE: Record<string, Price> = {
  '4 mm': quoted(122, 'sheet', 'Aircraft Spruce, Peachtree City GA (will-call) (Eric, 2026-10-12), plus tax', '4 x 8 ft x 4 mm okoume; the sides, box, lid and signs', AIRCRAFT_SPRUCE_OKOUME_URL),
  // D-73: the other two thin-sheet options. The keys are the sheet class (the thickness in whole mm, `sheetClass` in cutlist.ts): 5 mm = the real 1/4 in white oak plywood, 3 mm = 1/8 in Baltic birch.
  '5 mm': quoted(113, 'sheet', WOODYARD, '4 x 8 ft x 1/4" white oak plywood (about 5.3 mm; interior / Type II glue, fine garage-kept once sealed; MEASURE the sheet); the sides, box, lid and signs under the Standard weather spec', WOODYARD_PLYWOOD_URL),
  '3 mm': quoted(40, 'sheet', WOODYARD, '5 x 5 ft x 1/8" (3 mm) Baltic birch plywood (exterior glue); the sides, box, lid and signs if chosen. Every part must nest on a 60 x 60 in sheet', WOODYARD_PLYWOOD_URL),
  '12 mm': quoted(90, 'sheet', WOODYARD, '4 x 8 ft x 1/2" marine plywood; the deck and, from its offcut, the seat back. VERIFY the species is okoume: meranti marine ply is about 30% heavier (+3 lb on the deck)', WOODYARD_PLYWOOD_URL),
};

// ── Metal stock ($/ft, cut to length) ─────────────────────────────────────────

const METAL = 'McMaster-Carr-class supplier, cut to length';
const SPEEDY = 'Speedy Metals';
const ONLINE_METALS = 'Online Metals';
/**
 * Matched against the cut-list section text, first match wins. A researched bar or tube is bought as the fixed piece the vendor sells (`packQty` in ft, `packLabel`), so the line
 * is the pieces to buy, not feet; an estimate is per foot of cut length.
 */
export const METAL_PRICE_PER_FT: Array<{ match: RegExp; price: Price }> = [
  { match: /solid 1045/, price: { ...packed(5, 40, 'ft', METAL, `ESTIMATE (Eric chose the solid rod): 5/8" solid 1045 / CDS steel rod, cut to length; the cuts need 57 in plus kerfs, so a 60 in piece (about $8 a foot). Not in the ${RESEARCH_DATE} research: quote McMaster-Carr or Online Metals. Ask for 1045 cold-drawn or turned-ground-polished (yield 70 ksi or better on the cert), NOT hot-rolled A36 and NOT 1018 cold-drawn`), packLabel: '60 in piece', decision: 'Axle rod: the price is an estimate. Buy 5/8" 1045 cold-drawn or TGP rod (70 ksi or better, 60 in), not 1018 cold-drawn (about 54 ksi, which takes the 200 lb goal axle-stress to about 1.0) and not hot-rolled A36.' } },
  { match: /DOM tube/, price: withAlts(
    { ...packed(5, 45.45, 'ft', SPEEDY, `ESTIMATE: 5/8" OD x 0.120" wall DOM (A513 Type 5, ID 0.385"), 60 in piece; the cuts need 57 in plus kerfs. Speedy Metals does not list 0.120" in 5/8" OD (it lists 0.109" at 45.45 for 60 in, 0.035", 0.049", 0.065" and 0.188"), so this is that 60 in price as a stand-in. Online Metals lists 5/8" x 0.12" x 0.39" ID A513 Type 5 DOM (part 7763) and McMaster-Carr lists it too (1020 DOM, 55 ksi yield, check it against the 70 ksi the model assumes): quote one. DOM only: ask for the A513 Type 5 mill cert [${RESEARCH_DATE}]`), packLabel: '60 in piece' },
    [gap({ ...packed(5, 45.45, 'ft', SPEEDY, `5/8" OD x .407" ID x .109" wall DOM steel round tube (Speedy Metals p-3421, read ${RESEARCH_DATE}; not in the research file, so an estimate until quoted), 60 in length; 36 in is 33.33, 48 in 40.00`), packLabel: '60 in piece' }, '0.109" wall, not 0.120": the rear axle-stress row would be about 1.0 (marginal-to-fail) at the 200 lb goal rider')]) },
  { match: /flat bar 1\/16/, price: notFound(withAlts(est(7, 'ft', METAL, '316 stainless, thin bar (no 316 1/16" x 1" bar found; the thinnest 316 flat at Speedy Metals is 1/8")'), [
    gap(foundPack(1.5, 11.32, 'ft', SPEEDY, 'https://www.speedymetals.com/p-2538-18-x-1-316-stainless-steel-annealed-pickled.aspx', '1/8" x 1" 316 stainless flat, annealed and pickled, 18 in piece; stiffer and about twice the weight (0.036 lb/in); fine for the grip backing if the screws still fit', false, '18 in piece'), 'the bar is 1/8" thick, not 1/16"'),
  ])) },
  // D-78 (knee on quick-release pins): the four knee-side sleeves are short pieces cut from one 2 ft length of 1/2" OD x 3/8" ID stainless tube (the length covers spares for reaming and test fits).
  { match: /stainless tube 1\/2" OD x 3\/8" ID/, price: { ...packed(2, 16, 'ft', ONLINE_METALS, 'ESTIMATE, not quoted: 1/2" OD x 3/8" ID stainless tube (a 1/16" wall), one 24 in length at about $16: the four knee-side sleeves need under 8 in with the cuts, and the rest is spares for the reaming and the test fits. Not found in the research: quote McMaster-Carr or Online Metals. Order ONE pin first, test-fit it in a reamed piece, and only then order the rest: stock tube runs a few thousandths under a 3/8" pin and is opened with a reamer on the drill press. A bushing bored for a 3/8" pin (about $5 each) is the other way to buy a sleeve'), packLabel: '24 in length' } },
  { match: /flat bar 1\/8" x 2"/, price: { ...packed(1, 15, 'ft', SPEEDY, 'ESTIMATE: 316 stainless 1/8" x 2" flat bar for the two brake backing plates (2-1/2" each) and the two brake pivot straps (3-5/16" each): 11-5/8" of bar in all, so one 12 in piece cuts all four if the kerfs are thin, and the 1/4" a cut the BOM allows asks for a second piece to be safe. Not in the research: Speedy Metals lists 1/8" x 1" 316 flat at 8.81 for 12 in, so this is about double the stock, rounded up. Quote 1/8" x 2" before ordering. The Standard spec buys 304 and takes the 304 factor off this'), packLabel: '12 in piece' } },
  { match: /flat bar 1\/4" x 1-3\/4/, price: notFound(est(30, 'ft', METAL, '316 stainless 1/4" x 1-3/4" bar (not stocked at Speedy Metals; 1/4 x 2 is, price not read, or a ripped 1/4 x 2-1/2): needs a design decision')) },
  { match: /flat bar 1\/4" x 1-1\/2/, price: foundPack(1, 27.06, 'ft', SPEEDY, 'https://www.speedymetals.com/pc-2546-8259-14-x-1-12-316-stainless-steel-annealed-pickled.aspx', '1/4" x 1-1/2" 316 stainless flat, annealed and pickled, 12 in piece (4 x 2.25 in plus kerf); 18 in is 34.79', false, '12 in piece') },
  { match: /angle/, price: foundPack(1, 19.83, 'ft', ONLINE_METALS, 'https://www.onlinemetals.com/en/buy/stainless-steel/1-5-x-1-5-x-0-125-stainless-angle-316-316l/pid/2162', '1-1/2" x 1-1/2" x 1/8" stainless angle 316/316L (pid 2162), 12 in cut; 24 in is 38.61', true, '12 in cut') },
  { match: /aluminum|rectangular tube/i, price: foundPack(4, 36.32, 'ft', ONLINE_METALS, 'https://www.onlinemetals.com/en/buy/aluminum/1-x-1-5-x-0-125-aluminum-rectangle-tube-6061-t6-extruded/pid/14469', '1" x 1-1/2" x 0.125" 6061-T6 rectangle tube (pid 14469), 48 in; the stock wall is 0.125", the model says 0.130" (not a stock wall)', true, '48 in piece') },
];
/** Allowance added to every metal cut for the saw kerf and the squared end (in). */
export const METAL_CUT_ALLOWANCE_IN = 0.25;

// ── Purchased parts, by partNo ────────────────────────────────────────────────

const MCM = 'Catalog supplier (McMaster-Carr class)';
const BOLT_DEPOT = 'Bolt Depot';
const BD_EYE_URL = 'https://boltdepot.com/Forged_eye_bolts_(w__nuts)_Hot_dipped_galvanized_steel_3_8-16';
const BD_EYE_316_URL = 'https://boltdepot.com/Forged_eye_bolts_with_shoulder_(w__nuts)_Stainless_steel_316_3_8-16';
const EYE_DECISION = 'Eye bolts: stock 3/8-16 shoulder eye bolts, 4-1/2" for the axle beam and 2-1/2" for the chain joist. Checked against the stack: the beam bolt needs 3.16" under the shoulder (2-1/2" beam + washer + nylock nut + 1.5 threads), so the 4-1/2" is cut to 3-1/4" after fitting (it would stand 1.4" past the nut); the joist bolt needs 1.97", so 2-1/2" is cut to 2" (or left, 0.6" of thread). Neither fouls the wheel, the chain or the tongue. The Standard weather spec (garage-kept) uses galvanized; the Extreme spec (stored outside or near salt) uses 316, which is 4x the price (about $200 for four against $46).';
/** The two eye-bolt prices, hot-dip galvanized (Standard base) and 316 (Extreme base): Bolt Depot, forged shoulder eye bolts with nuts, 3/8-16. */
const EYE_GALV = {
  steerEye: found(11.94, 'ea', BOLT_DEPOT, BD_EYE_URL, 'forged shoulder eye bolt with nut, hot-dip galvanized, 3/8-16 x 4-1/2" stock (the stack needs 3.16" under the shoulder, so cut it to 3-1/4" after fitting; Bolt Depot measures from under the shoulder)', true),
  steerAnchor: found(11.1, 'ea', BOLT_DEPOT, BD_EYE_URL, 'forged shoulder eye bolt with nut, hot-dip galvanized, 3/8-16 x 2-1/2" stock (the stack needs 1.97" under the shoulder; optionally cut to 2")', true),
};
const EYE_316 = {
  steerEye: found(50.77, 'ea', BOLT_DEPOT, BD_EYE_316_URL, '316 forged shoulder eye bolt with nut, 3/8-16 x 4-1/2" stock (the stack needs 3.16" under the shoulder, so cut it to 3-1/4" after fitting): 4x the galvanized price', true),
  steerAnchor: found(48.43, 'ea', BOLT_DEPOT, BD_EYE_316_URL, '316 forged shoulder eye bolt with nut, 3/8-16 x 2-1/2" stock (the stack needs 1.97" under the shoulder; optionally cut to 2"): 4x the galvanized price', true),
};
const WHEEL_DECISION = 'Wheel (Eric, 2026-10-12): the Harbor Freight 10" pneumatic with black hub, $9.99, 5/8" bore, 300 lb, about 3 lb; the axles are 5/8" to match. Its hub length is not listed (the model assumes 2-1/4", as on the Uline and Martin wheels): buy one first and measure the hub, the bore and the squash. The steel-hub version is $11.99.';
/** Cut length of a steering chain (in), from the model's vendor text: 10.89 in of 3/16" chain, a quick link to each eye. */
const CHAIN_CUT_IN = 10.89;
const CHAIN_USD_PER_FT = 7.37, QUICK_LINK_USD = 5.66;

export interface PurchasedPriceEntry {
  match: RegExp;
  price: Price;
  /** The research price replaces the model's own `sourcing.costUsd` (which is an estimate). Without it a model cost always wins. */
  override?: boolean;
}
/** Prices for purchased parts. A model cost (`sourcing.costUsd`) wins unless the entry says `override` (the research found a real price for exactly that part). Matched on partNo. */
export const PURCHASED_PRICE: PurchasedPriceEntry[] = [
  { match: /^wheel$/, price: withAlts(
    found(9.99, 'ea', 'Harbor Freight', 'https://www.harborfreight.com/10-inch-x-3-1-2-half-inch-pneumatic-tire-67465.html', 'HAUL-MASTER 10" pneumatic tire with black hub (SKU 67465), 5/8" bore, 300 lb, about 3 lb, 3-1/2" wide, 30 psi; hub length not listed (the model assumes 2-1/4"). Eric chose it 2026-10-12. VERIFY the hub length, bore and rating on the real wheel'),
    [
      found(11.99, 'ea', 'Harbor Freight', 'https://www.harborfreight.com/heavy-duty-10-inch-groove-tread-tire-40729.html', 'HAUL-MASTER 10" pneumatic tire with steel hub (SKU 40729), 5/8" bore, 300 lb, 3.10 lb shipping; hub length not listed. The sturdier hub, +$2 a wheel (+$8 for four)'),
      gap(found(34, 'ea', 'Uline', 'https://www.uline.com/Product/Detail/H-5454/Casters-and-Wheels/Uline-Flat-Free-Pneumatic-Wheel-300-lb-Capacity-10', 'Uline H-5454 flat-free pneumatic wheel 10 x 3-1/2", 5/8" bore, 2-1/4" steel offset hub (the hub length is listed), 300 lb, 3.41 lb'), 'flat-free: a stiffer tire than the 30 psi pneumatic the bump rate assumes (bumpWheelRateLbIn), and 0.4 lb a wheel heavier; $24 more a wheel'),
    ], WHEEL_DECISION) },
  { match: /^king-thrust$/, price: found(15.88, 'ea', 'eBay seller (Florida)', 'https://www.ebay.com/itm/143055583417', 'natural UHMW 1/2" sheet, 6" x 12" option (a 3" disc is cut from it); the listing may price one size only', true) },
  { match: /^kingpin$/, price: est(9, 'ea', MCM, '5/8" grade 8 bolt, 2 washers, nylock nut') },
  { match: /^roll-pad$/, price: notFound(est(2, 'ea', MCM, 'UHMW 1/4" sheet offcut (no US price found, only an import listing at about $44 before duty)')) },
  { match: /^bridle-sleeve$/, price: notFound(est(7, 'ea', MCM, 'oil-embedded bronze sleeve bearing, 5/8" ID x 1" OD x 1-1/2" (Symmco SS-2032-8 is 5/8 x 1 but 1/2" long; needs a cut-to-length or a quote)')) },
  // Extreme weather: 316 eye bolts are the base; the galvanized ones are the Standard spec's base (PURCHASED_PRICE_STANDARD) and the cheaper alternative here.
  { match: /^steer-eye$/, price: withAlts(EYE_316.steerEye, [gap(EYE_GALV.steerEye, 'hot-dip galvanized, not 316: right for the Standard weather spec (garage-kept), rusts and stains oak near salt')], EYE_DECISION) },
  { match: /^steer-anchor$/, price: withAlts(EYE_316.steerAnchor, [gap(EYE_GALV.steerAnchor, 'hot-dip galvanized, not 316: right for the Standard weather spec (garage-kept), rusts and stains oak near salt')], EYE_DECISION) },
  { match: /^steer-chain$/, price: found(Math.round(((CHAIN_CUT_IN / 12) * CHAIN_USD_PER_FT + 2 * QUICK_LINK_USD) * 100) / 100, 'ea', 'ACE Industries / Skydog Rigging', 'https://www.aceindustries.com/3-16-nacm-industrial-chain-316l-stainless-steel',
    `3/16" NACM industrial chain 316L at $${CHAIN_USD_PER_FT}/ft (${CHAIN_CUT_IN} in) plus two 3/16" 316 quick links at $${QUICK_LINK_USD} each (Skydog, WLL 800 lb). Grade 43 is not made in 3/16": NACM chain has a looser rating, so check the working load against the 1000 lb target`, true) },
  { match: /^bridle$/, price: found(6.49, 'ea', 'Hamilton Marine', 'https://shop.hamiltonmarine.com/products/commercial-3-strand-nylon-rope--foot-or-reel--42842.html', '11 ft of commercial 3-strand nylon rope, 3/8", at $0.59/ft', true) },
  { match: /^(scupper|storage-drain)$/, override: true, price: found(5.2, 'ea', 'Global Industrial (MSI)', 'https://www.globalindustrial.com/p/38-mpt-x-38-316-stainless-steel-hose-barb-class-150', '3/8" MPT x 3/8" hose barb, 316, Class 150', true) },
  { match: /^seat-hinge$/, override: true, price: found(13.545, 'ea', 'Freeport Marine', 'https://www.freeportmarine.com/products/seachoice-2-316-stainless-steel-butt-hinges.oembed', 'Seachoice 33911 2" x 2" 316 stainless butt hinges, $27.09 a pair (one pair is the pack), shown as half each', true) },
  { match: /^storage-gasket/, override: true, price: found(13.185, 'ea', 'Walmart (Trim-Lok)', 'https://www.walmart.com/ip/873339043', 'Trim-Lok X110HT EPDM seal 3/8" x 3/4", 25 ft roll $52.74 (about $2.11/ft); one roll covers all four gasket lines, shown as a quarter each. Check the profile and the length against the lid frame', true) },
  // D-78: the quick-release pins are an ESTIMATE (nothing quoted): the research found no 3/8" ball-lock pin price in the grade the spec asks for. `override` replaces the model's own $25 so the line says estimate.
  { match: /^brake-pin-[BT]$/, override: true, price: withAlts(est(25, 'ea', MCM, 'ESTIMATE, not quoted: a 3/8" stainless ball-lock quick-release pin with a lanyard, about $25 each (four a sled). Quote it before ordering. Nothing was found for the pull-out rating of the locking balls: ask the vendor'),
    [gap(est(4.5, 'ea', MCM, 'A plain 3/8" clevis pin with a hitch-pin clip (about $4.50 a set, an estimate) at the BOTTOM hole instead of a second ball-lock, ball-lock at the top hole only. Saves about $20 a pin, about $40 to $45 a sled. Slower to take off and refit: the clip is reached from under the deck, the open side of the rail'), 'the bottom pin is not a ball-lock')]) },
  // D-78: the flanged bushings in the hull (one in each rail, one in each web/rib block). An ESTIMATE, not quoted; `override` replaces the model's own $4.
  { match: /^brake-sleeve-[BT]-hull$/, override: true, price: est(4, 'ea', MCM, 'ESTIMATE, not quoted: a stainless flanged sleeve bushing, 1/2" OD x 3/8" ID with a 3/4" flange (the next stock length up, cut to length on the metal bandsaw). Order the bushings after the first pin has been test-fitted; stock ones are a few thousandths under a 3/8" pin and are opened with a reamer, or a bushing already bored for a 3/8" pin can be bought') },
  { match: /^brake-pad$/, price: est(4, 'ea', MCM, '3" x 3" neoprene or SBR pad') },
  // The cords are cut from a roll: whole rolls priced, `perPart` in ft from the model's vendor text (bungee 10.99 in; chock cord 30 in).
  { match: /^brake-cord$/, price: { ...foundPack(100, 18.6, 'ft', 'Home Depot (T-W Evans)', 'https://homedepot.com/p/T-W-Evans-Cordage-1-4-in-x-100-ft-Elastic-Bungee-Shock-Cord-SC-104-100/205327122', '1/4" x 100 ft elastic bungee shock cord for the 10.99 in bungee (the sheath material is not stated; polyester-sheath cord is $42.99 per 100 ft at US Cargo Control). The 3/16" polyester stop cord (8.99 in) was not priced: buy a few feet with it', true, '100 ft roll'), perPart: 10.99 / 12 } },
  { match: /^brake-chock-cord$/, price: { ...foundPack(100, 34, 'ft', 'Valleyrope (eBay)', 'https://www.ebay.com/str/valleyrope', '1/4" x 100 ft double-braid polyester cord for the 30 in chock cords (Home Depot T-W Evans braided utility rope is $9.89 per 100 ft but the fiber is not stated)', true, '100 ft roll'), perPart: 30 / 12 } },
  { match: /^handle-pin$/, price: est(5, 'ea', MCM, 'clevis pin and lynch pin') },
  { match: /^(lamp-clip|rear-lamp-clip)$/, price: notFound(est(3, 'ea', 'Printed in-house (ASA)', 'about 0.2 lb of filament, no support (no US price for ASA filament found, only UK/EU listings)')) },
  { match: /^front-light$/, override: true, price: found(58.95, 'ea', 'Modern Bike', 'https://www.modernbike.com/cygolite-metro-plus-800-rechargeable-headlight', 'Cygolite Metro Plus 800 rechargeable headlight, 800 lm (20% off 73.95); replaces the model\'s $40 estimate', true) },
  { match: /^rear-light$/, override: true, price: found(44.95, 'ea', 'Cahaba Cycles', 'https://www.cahabacycles.com/products/cygolite-hotshot-pro-200c-usb-light-rear-black', 'Cygolite Hotshot Pro 200C USB rear light; replaces the model\'s $20 estimate', true) },
];
export const PURCHASED_FALLBACK: Price = est(5, 'ea', 'No entry in prices.ts', 'UNPRICED: add the part to PURCHASED_PRICE');

/**
 * Purchased parts whose model cost (`sourcing.costUsd`) stays the price because the research found no price that meets the spec: the note (research result) and the
 * alternatives (spec gaps, shown in the BOM line notes) are added to the line. Matched on partNo.
 */
export interface ModelCostNote { match: RegExp; note: string; alternatives?: Price[] }
export const PURCHASED_MODEL_COST_NOTE: ModelCostNote[] = [
  { match: /^storage-hinge$/, note: `model cost kept: the 2-1/2" x 2-3/4" 316 hinge was not found in the ${RESEARCH_DATE} research`, alternatives: [
    gap(found(13.545, 'ea', 'Freeport Marine', 'https://www.freeportmarine.com/products/seachoice-2-316-stainless-steel-butt-hinges.oembed', 'Seachoice 33911 2" x 2" 316 butt hinges, $27.09 a pair, shown as half each', true), 'the hinge is 2" x 2", not 2-1/2" x 2-3/4"; needs a size decision')] },
  { match: /^storage-latch$/, note: `model cost kept: no 316 draw latch with catch found in the ${RESEARCH_DATE} research (only turn-button and toggle latches)` },
  { match: /^storage-lid-stay$/, note: `model cost kept: no 316 friction lid stay found in the ${RESEARCH_DATE} research`, alternatives: [
    gap(found(26.4, 'ea', 'Sugatsune', 'https://www.sugatsune.com/s-s-stay-s-93l', 'Sugatsune S-93L stainless friction lid stay, 66 lb (S-91R is 31.30, 88 lb)', true), '304 stainless, not 316')] },
  { match: /^seat-pin$/, note: `model cost kept: no 3/8" x 1-1/2" detent pin found in the ${RESEARCH_DATE} research (Whitecap S-1024C is $69.99, 304, diameter not stated, likely the wrong part)` },
  { match: /^lash-point$/, note: `model cost kept: no 316 4-hole D-ring bolt plate found in the ${RESEARCH_DATE} research`, alternatives: [
    gap(found(2.99, 'ea', 'Fasteners Plus / US Cargo Control', 'https://www.fastenersplus.com/products/1-bolt-on-d-ring-with-mounting-bracket-316-stainless-800-lbs-bs', '1" 316 bolt-on D-ring with bracket, 2-hole, 800 lb break (a 2-5/16" ring with a 6000 lb break is 8.89)', true), 'a 2-hole 1" ring, not the 4-hole plate; its 800 lb break is about 270 lb working load, marginal against 300 lbf')] },
  { match: /^brake-snap$/, note: 'model cost kept: no 1-1/4" 316 snap hook found', alternatives: [
    gap(found(2.7, 'ea', 'Sailrite', 'https://www.sailrite.com/Fixed-Eye-Snap-Clip-2-Stainless-Steel', 'Fixed Eye Snap Clip 2", 316, 485 lb (Sea-Dog 2-3/8" is 7.14)', true), 'the snap hook is 2", not about 1-1/4"')] },
  { match: /^brake-pivot-pin$/, note: `model cost kept: no 3/8" 316 clevis pin found in the ${RESEARCH_DATE} research` },
  { match: /^brake-pivot-clip$/, note: 'model cost kept: no 316 hitch-pin clip found', alternatives: [
    gap(foundPack(25, 13.43, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Product-Details?product=27209', 'hitch pin clip, 0.093" wire, for 3/8" to 5/8" pins (27209), $0.82 each, 13.43 per 25 (124 per 250)', true), '18-8 stainless, not 316')] },
  { match: /^reflector$/, note: 'model cost kept: no 2" x 1" adhesive prismatic reflector found', alternatives: [
    gap(foundPack(4, 3.95, 'ea', 'Skycraft Surplus', 'https://skycraftsurplus.com/products/optronics-re10arfk-reflector-kit-4-pack.html', 'Optronics RE10ARFK reflector kit, 4 pack (2 red, 2 amber), FMVSS/DOT; a 2-round red/amber set is $11.05 at Walmart', true, 'pack of 4'), 'the reflectors are 3-3/16" x 1-7/16", bigger than 2" x 1", and C2 is not stated')] },
  { match: /^seat-cushion$/, note: `model cost kept: the 1" closed-cell 24 x 24 foam sheet was not found in the ${RESEARCH_DATE} research (Penn-Elcom 1" charcoal Etha plank, 24" x 108", is $58.52, via search); marine vinyl 54" is $12.95/yd (Fabric Guru, via search, confirm on the page)` },
  { match: /^seat-back-pad$/, note: `model cost kept: foam and vinyl were priced for the seat cushion only (${RESEARCH_DATE} research); the foam sheet was not found` },
];
export const modelCostNote = (partNo: string, spec: SpecName = 'extreme'): ModelCostNote | undefined =>
  (spec === 'standard' ? PURCHASED_MODEL_COST_NOTE_STANDARD.find((r) => r.match.test(partNo)) : undefined) ?? PURCHASED_MODEL_COST_NOTE.find((r) => r.match.test(partNo));

// ── Fasteners (316 stainless unless noted), matched on the BOM label ──────────

const FAST = 'Fastener supplier (McMaster-Carr / Fastenal class), 316 stainless';
const DOMINO_DEALER = 'Festool Domino dealer';
const BD_SCREW_8 = 'https://boltdepot.com/Wood_screws_Phillips_flat_head_Stainless_steel_316_8';
const BD_SCREW_10 = 'https://boltdepot.com/Wood_screws_Phillips_flat_head_Stainless_steel_316_10';
const BD_SCREW_6 = 'https://boltdepot.com/Product-Details?product=16354';
/** A Bolt Depot 316 Phillips flat-head wood screw sold singly or by the 100: the pack of 100 is priced. */
const bdScrew = (url: string, gauge: number, len: string, packUsd: number, extra = '', each?: number): Price => {
  const px = foundPack(100, packUsd, 'ea', BOLT_DEPOT, url, `316 Phillips flat-head wood screw #${gauge} x ${len}", pack of 100${extra}`, true);
  return each !== undefined ? withEach(px, each) : px;
};
const woodScrewLabel = (gauge: number, len: string): RegExp => new RegExp(String.raw`^316 (?:flat-head )?wood screw #${gauge} x ${len.replace('/', String.raw`\/`)}"$`);
const NOT_LISTED = 'this length is not in the Bolt Depot listing the research read';
const CARRIAGE_DECISION = 'Carriage bolts: the stack (tongue head 3" + the 2-1/2" beam + washer + nylock nut + 1.5 threads) needs 6.16", so use the stock 6-1/2" (the 6" bolt stops 1/16" short of the top of the nut). Priced from the 6" bolt (18411) plus a little: the 6-1/2" price was not read; quote it.';
const DOMINO_4X20_DECISION = 'NO Sipo 4x20 exists: decision needed (beech 4x20 fully encapsulated in epoxy, or 5x30 Sipo if the joint allows). The chine tie uses 4x20 Dominos (about 18); the model is unchanged. The price shown is the old estimate for a Sipo pack that is not made.';
export const FASTENER_PRICE: Array<{ match: RegExp; price: Price }> = [
  { match: /T-nut/i, price: found(0.9, 'ea', 'Albany County Fasteners', 'https://www.albanycountyfasteners.com/t-nuts-316-stainless-steel-14-20-6002-016-032', '316 stainless 4-prong T-nut, 1/4"-20, for the handle socket backers (epoxied in); $0.90 each for 1-99, $0.58 at 100+ (304 is $0.74)', true) },
  { match: /shaft collar/i, price: withAlts(
    // D-71 / D-72: the wheel bore, and so the collar, is 5/8". The research found a 316 collar only in 3/4" bore ($33.36, MROSupply); the 5/8" one is that price as a stand-in until quoted.
    notFound(est(33.36, 'ea', 'MROSupply', 'ESTIMATE: a 316 stainless one-piece set-screw shaft collar, 5/8" bore (Climax-class, about 1-1/8" OD x 1/2"), for the wheel end of each axle. The research found the 316 collar only in 3/4" bore (Climax Metal CRC-075-S, $33.36 at MROSupply, https://www.mrosupply.com/products/745606/as-markdown/); a 5/8" 316 is assumed to cost the same until quoted', 'https://www.mrosupply.com/products/745606/as-markdown/')),
    [gap(found(4.43, 'ea', 'Penn Tool Co.', 'https://www.penntoolco.com/87986402', 'Climax C-062 one-piece set-screw collar, 5/8" bore, 1-1/8" OD x 1/2", zinc plated (the Standard weather spec); PartsSource GSC-062-Z zinc is $4.99 [S]', true), 'zinc-plated steel, not 316 stainless (about $18 for four against $133): fine garage-kept, rusts in the weather')],
    'Wheel retainer collars (5/8" bore), Extreme weather: the 316 price is an ESTIMATE (the research found 316 only in 3/4" bore, $33.36 each, $133 for four). Quote a 316 5/8" collar before ordering that spec. The Standard spec uses the zinc-plated collar ($4.43 each at Penn Tool, $18 for four).') },
  { match: /cotter pin/i, price: withAlts(notFound(packed(25, 8, 'ea', FAST, '316 cotter pin through the 0.156" axle cross hole; pack of 25')), [
    gap(foundPack(100, 14.95, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Product-Details?product=14570', 'cotter pin 5/32" x 1-1/4" (14570), $0.21 each, 14.95 per 100 (5/32 x 1-3/4 is $0.28, 19.68 per 100)', true), '18-8 stainless, not 316, and 1-1/4" not 1-1/2" long; Bolt Depot has no 316 cotter pin')]) },
  { match: /end plug/i, price: packed(10, 5, 'ea', FAST, 'plastic flanged plug for the DOM tube bore; pack of 10') },
  { match: /button plug/i, price: foundPack(25, 4.55, 'ea', 'DigiKey (Keystone)', 'https://www.digikey.com.mx/en/products/detail/keystone-electronics/8604/317044', 'Keystone 8604 black nylon hole plug, 0.625", about $0.18 each at 25; pack of 25', true) },
  { match: /nylon washer/i, price: packed(50, 6, 'ea', FAST, 'nylon washer under the button head; pack of 50') },
  { match: /stainless rod/i, price: est(3, 'ea', FAST, 'cut from a 3/8" x 12" 316 rod (about $12): five pins per rod') },
  { match: /^Domino DF 500 4x20/, price: withAlts(
    packed(300, 55, 'ea', DOMINO_DEALER, 'NO Sipo 4x20 exists (JMP Wood lists Sipo in 5x30, 8x40 and 8x50 only): an estimate for a SIPO (sapele) 4 x 20 pack that is not made, pack of 300, kept as a placeholder'),
    [
      gap(foundPack(450, 25, 'ea', 'Woodcraft', 'https://www.woodcraft.com/products/festool-dominos-4mm-x-20mm-450-pieces', 'Festool Dominos 4mm x 20mm, 450 pieces (495661), backordered online, special order (JMP Wood also $25.00); fully encapsulated in epoxy only', false), 'beech is the interior type: it swells and rots outdoors'),
      quoted(0, 'ea', 'JMP Wood', `Use SIPO (sapele) 5x30 from the pack already bought for the 5x30 joints: no extra cost, if the chine tie can take the larger Domino [JMP Wood, ${RESEARCH_DATE}]`, 'https://www.jmpwood.com/products/festool-sipo-domino'),
    ], DOMINO_4X20_DECISION) },
  { match: /^Domino DF 500 5x30/, price: foundPack(300, 57, 'ea', 'JMP Wood', 'https://www.jmpwood.com/products/festool-sipo-domino', 'Festool SIPO (sapele) Domino D 5x30/300 MAU (494869), the exterior type, NOT beech; pack of 300 (special-order risk: availability not guaranteed)') },
  { match: /^Domino DF 500 8x50/, price: foundPack(100, 57, 'ea', 'The Power Tool Store', 'https://thepowertoolstore.com/products/festool-494872', 'Festool SIPO (sapele) Domino D 8x50/100 MAU (494872), the exterior type, NOT beech; pack of 100', true) },
  { match: /^Domino/, price: packed(100, 50, 'ea', DOMINO_DEALER, 'SIPO (sapele) Domino, the exterior type, NOT beech. Pack of 100 (estimate: check the size)') },
  { match: /screw eye/, price: notFound(est(1.25, 'ea', FAST, '316 #10 screw eye (only long NZ screw eyes and eye nuts turned up)')) },
  { match: /Heat-set insert/, price: packed(50, 12, 'ea', FAST, 'brass heat-set insert for the printed ASA clips; pack of 50') },
  { match: /threaded insert/, price: notFound(packed(25, 22, 'ea', FAST, '316 epoxy-in insert; pack of 25 (E-Z Lok stainless kit $31.49 at Tractor Supply is titled 10-24; brass 25-pack $13.52 on eBay)')) },
  { match: /button-head cap screw 1\/4-20/, price: found(1.05, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Socket_button_head_Stainless_steel_316_1_4-20', '316 socket button head cap screw 1/4-20 x 2" (21746), $1.05 each, 34.94 per 50; the x 1-1/4" length was not read separately', true) },
  { match: /Thumb-knob/, price: withAlts(notFound(est(2.75, 'ea', FAST, 'thumb-knob screw #10-32, 1" with the 1/4 in white oak web (7/8" with the 4 mm okoume): no exact length found')), [
    gap(found(2.38, 'ea', 'ichome (RAF)', 'https://ichome.com/product-detail/raf/7109-ss', 'RAF 7109-SS stainless knob screw #10-32 (Zoro 18-8 round thumb screw 3/4" is 5.69)', true), 'the length is 1/2", not the model\'s 1" (or 7/8")')]) },
  { match: /\bM[34]\b/, price: packed(100, 9, 'ea', FAST, 'metric socket or pan-head screw; pack of 100') },
  // D-76: the D-ring plate's #8-32 x 2" through-bolt sets (24). No #8-32 machine screw, #8 fender washer or #8-32 nylock was in the research: estimates scaled from the 316 lines above.
  { match: /machine screw #8-32 x 2"/, price: packed(25, 13, 'ea', FAST, `ESTIMATE: 316 pan-head machine screw #8-32 x 2" (not in the ${RESEARCH_DATE} research; the 1/4-20 hex bolts there are 0.71 each); pack of 25`) },
  { match: /fender washer #8/, price: packed(25, 9, 'ea', FAST, `ESTIMATE: 316 fender washer for #8, 3/4" OD (not in the ${RESEARCH_DATE} research; the 1/4" x 1-1/4" is 0.46 each); pack of 25`) },
  { match: /lock nut #8-32/, price: packed(50, 11, 'ea', FAST, `ESTIMATE: 316 nylon-insert lock nut #8-32 (not in the ${RESEARCH_DATE} research; the 1/4-20 is 0.25 each); pack of 50`) },
  { match: /machine screw/, price: packed(50, 11, 'ea', FAST, 'pack of 50') },
  // Wood screws: Bolt Depot 316 Phillips flat-head, by the 100 (the lengths the research read; the rest keep their estimate).
  { match: woodScrewLabel(8, '1/2'), price: bdScrew(BD_SCREW_8, 8, '1/2', 22.16, ' ($0.35 each)', 0.35) },
  { match: woodScrewLabel(8, '5/8'), price: bdScrew(BD_SCREW_8, 8, '5/8', 23.91, ' ($0.38 each)', 0.38) },
  { match: woodScrewLabel(8, '1'), price: bdScrew(BD_SCREW_8, 8, '1', 26.98, ' ($0.42 each)', 0.42) },
  { match: woodScrewLabel(8, '1-1/4'), price: bdScrew(BD_SCREW_8, 8, '1-1/4', 33.95, ' ($0.53 each)', 0.53) },
  // D-77: the four pan-head #8 x 1-1/4 screws of each brake pivot strap (8 in all). The research read the flat-head listing only; the pan head is priced the same until quoted.
  { match: /^316 pan-head wood screw #8 x 1-1\/4"$/, price: notFound(withEach(packed(100, 33.95, 'ea', BOLT_DEPOT, 'ESTIMATE: 316 Phillips pan-head wood screw #8 x 1-1/4" for the brake pivot straps (the strap is not countersunk), priced as the flat-head screw of the same size ($33.95 per 100, $0.53 each); quote the pan head before ordering'), 0.53)) },
  { match: woodScrewLabel(10, '1'), price: bdScrew(BD_SCREW_10, 10, '1', 31.9, ' ($0.45 each)', 0.45) },
  { match: woodScrewLabel(10, '1-1/4'), price: bdScrew(BD_SCREW_10, 10, '1-1/4', 36.71, ' ($0.51 each)', 0.51) },
  { match: woodScrewLabel(10, '2'), price: bdScrew(BD_SCREW_10, 10, '2', 58.76, ' (two snapshots disagreed, $49.87 and $58.76: the higher is used)') },
  { match: woodScrewLabel(6, '3/8'), price: bdScrew(BD_SCREW_6, 6, '3/8', 18.17, ' ($0.25 each)', 0.25) },
  { match: /wood screw/, price: notFound(packed(50, 9, 'ea', FAST, `316 wood screw; pack of 50 per length (${NOT_LISTED})`)) },
  { match: /screw/, price: packed(50, 9, 'ea', FAST, 'pack of 50') },
  { match: /lock nut 5\/8/, price: packed(10, 14, 'ea', FAST, 'pack of 10') },
  { match: /lock nut 3\/8/, price: withEach(foundPack(50, 16.15, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Hex_nylon_insert_lock_nuts_Stainless_steel_316', '316 hex nylon-insert lock nut 3/8-16 (16010), $0.48 each or 16.15 per 50 ($0.32 each); pack of 50', true), 0.48) },
  { match: /lock nut 1\/4/, price: withEach(foundPack(100, 16.54, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Hex_nylon_insert_lock_nuts_Stainless_steel_316', '316 hex nylon-insert lock nut 1/4-20 (16008), $0.25 each or 16.54 per 100; pack of 100', true), 0.25) },
  { match: /lock nut/, price: packed(50, 18, 'ea', FAST, 'pack of 50') },
  { match: /fender washer 5\/8/, price: packed(25, 15, 'ea', FAST, 'pack of 25') },
  { match: /fender washer 3\/8/, price: withEach(foundPack(100, 50.48, 'ea', BOLT_DEPOT, 'https://www.boltdepot.com/Fender_washers_Stainless_steel_316.aspx', '316 fender washer 3/8" x 1-1/2" (16042), $0.81 each or 50.48 per 100; the 2" OD washers of the eye bolts were not searched; pack of 100', true), 0.81) },
  { match: /fender washer 1\/4/, price: withEach(foundPack(100, 27.26, 'ea', BOLT_DEPOT, 'https://www.boltdepot.com/Fender_washers_Stainless_steel_316.aspx', '316 fender washer 1/4" x 1-1/4" (16040), $0.46 each or 27.26 per 100; pack of 100', true), 0.46) },
  { match: /fender washer/, price: packed(100, 20, 'ea', FAST, 'pack of 100') },
  { match: /carriage bolt 3\/8/, price: { ...est(3.99, 'ea', BOLT_DEPOT, 'ESTIMATE: 316 carriage bolt 3/8-16 x 6-1/2". The research read the 6" bolt (18411, $3.68 each, 28.31 per 10); 6-1/2" is that price x 6.5/6 until quoted. 6-1/4" is not a stock length, and the 6" bolt stops 1/16" short of the top of the nylock nut on this stack', 'https://boltdepot.com/Product-Details?product=18411'), decision: CARRIAGE_DECISION } },
  { match: /hex bolt 3\/8-16 x 3-1\/4"/, price: found(1.94, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Hex_bolts_Stainless_steel_316_1_4-20', '316 hex bolt 3/8-16 x 3-1/4" (16136), $1.88 to $1.94 each (two snapshots; the higher is used), 74.65 per 50', true) },
  { match: /hex bolt 1\/4-20 x 2-1\/4"/, price: found(0.71, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Hex_bolts_Stainless_steel_316_1_4-20', '316 hex bolt 1/4-20 x 2-1/4" (16074), $0.71 each, 54.28 per 100', true) },
  { match: /bolt 3\/8/, price: notFound(est(2.5, 'ea', FAST, `${NOT_LISTED}; Bolt Depot lists 3/8-16 x 3-1/4 at $1.94 and x 3-3/4 at $2.25`)) },
  { match: /bolt 1\/4/, price: notFound(est(1.3, 'ea', FAST, `${NOT_LISTED}; Bolt Depot lists 1/4-20 x 2-1/4 at $0.71`)) },
  { match: /bolt/, price: est(2, 'ea', FAST) },
];
export const FASTENER_FALLBACK: Price = est(1, 'ea', 'No entry in prices.ts', 'UNPRICED: add the fastener to FASTENER_PRICE');

// ── Consumables ───────────────────────────────────────────────────────────────

const ROCK_WEST = 'Rock West Composites';
const ROCK_WEST_WEST_URL = 'https://www.rockwestcomposites.com/west-system';
/**
 * West System 105 resin with 206 slow hardener (5:1 by volume). Sold as resin plus hardener; priced here as a kit of the pair: the 105-A + 206-A quart group and the 105-B + 206-B gallon group.
 * `mixedFlOz` is the mixed volume the kit makes (resin plus hardener). The gallon group is much cheaper per ounce, and three quart groups cost more than one gallon group.
 * The gallon group's base is the cheapest credible published kit (Rock West); Fiberglass Supply's price is the alternative. The quart group was not researched (estimate).
 * The gallon kit's contents are as the research gives them: 105-B resin 0.98 gal (125.4 fl oz) and 206-B hardener 0.86 qt (27.5 fl oz).
 */
export const EPOXY_KITS: Array<{ id: string; label: string; /** Resin in the kit (fl oz): what the coats and the glue-ups draw on. */ resinFlOz: number; mixedFlOz: number; price: Price }> = [
  { id: 'quart', label: 'West System 105-A resin + 206-A slow hardener, quart group (1.2 quart kit)', resinFlOz: 32, mixedFlOz: 38.4, price: withAlts(
    found(94.12, 'kit', 'Fiberglass Supply', 'https://fiberglasssupply.com/west-system-105-a-with-206-a-slow-hardener-1-2-quart-kit/', '105-A resin + 206-A slow hardener, 1.2 quart kit (G73-7519): 32 fl oz resin + 6.4 fl oz hardener, no pumps (the 300 Mini Pump Set is extra); fetched, in stock. Other readings of the same kit: 82.35 and 87.97 [S], 82.35 on the manufacturer\'s list [L]'),
    [found(82.35, 'kit', 'West System list price', 'https://fiberglasssupply.com/west-system-105-a-with-206-a-slow-hardener-1-2-quart-kit/', '105-A 51.47 + 206-A 30.88 on the manufacturer\'s comparative list (undated)')]) },
  { id: 'gallon', label: 'West System 105-B resin + 206-B slow hardener, gallon group', resinFlOz: 125.44, mixedFlOz: 152.96, price: withAlts(
    found(179.99, 'kit', ROCK_WEST, 'https://www.rockwestcomposites.com/ws-slow-1-2gal-kit.html', 'WS-SLOW-1.2GAL-KIT: 105-B resin 0.98 gal + 206-B slow hardener 0.86 qt; in stock, ships next business day, the pumps are extra. Rock West also lists the two parts apart at 110.99 + 66.99 (backorder), so the price may lag; epoxy is hazardous freight, call for shipping (801-566-3402)'),
    [found(205.8, 'kit', 'Fiberglass Supply', 'https://fiberglasssupply.com/epoxy/west-system/?page=3', '105-B + 206-B 1.2 gal kit (131.42 + 74.38 apart): the high end of the range, what 2026 list pricing looks like')]) },
];
/**
 * West System 300 Mini Pump Set (Rock West): three pumps (resin, 205/206 hardener, 207/209 hardener), one set does both ratios. The 301 and 303 pump sets are no longer sold, so this
 * replaces both lines. The 207 and 209 hardeners are not bought (the finishing schedule uses 206 only): their sizes are 0.66 pt and 0.33 gal, not the pint the BOM used to price.
 */
export const EPOXY_PUMPS_300: Price = found(28.99, 'set', ROCK_WEST, ROCK_WEST_WEST_URL, 'West System 300 Mini Pump Set, 3 pumps (resin, 205/206 hardener, 207/209 hardener), yellow heads: do not mix with old white-head pumps. Replaces the 301 and 303 sets, which West System no longer sells');
export const FILLERS: Record<string, Price> = {
  silica: found(41.82, 'ea', 'Powerboat Supply', 'https://powerboatsupply.com/boat-supplies-accessories/paint-maintenance/west-system-products/west-system-colloidal-silica-5-5oz-4067', 'West System 406-7 colloidal silica, 5.5 oz, for thickened glue and fillets (Fiberglass Supply also 41.82)'),
  microballoons: found(40.1, 'ea', 'Fiberglass Supply', 'https://fiberglasssupply.com/epoxy/west-system/?page=5', 'West System 407-5 low-density filler, 4 oz, for fairing the sealed deck (the smallest 407 size; 410-7 Microlight 5 oz is 58.88)'),
};
/** Items that exist only as text in a note or a joint (see `NOTE_ITEMS` in bom.ts). */
export const NOTE_PRICE: Record<string, Price> = {
  dualLock: found(19.99, 'roll', 'Walmart', 'https://www.walmart.com/c/kp/3m-lock', '3M Dual Lock SJ3560 clear reclosable fastener, 1" x 6 ft, adhesive back (the black SJ3550 comes in 50 yd industrial rolls at about $850, so the retail cut length is used)', true),
  edgeBanding: est(14, 'roll', 'Woodworking store', 'pre-glued white oak veneer edge banding, 3/4" wide, 25 ft roll (iron on, flush trim)'),
  sealant: found(27, 'ea', 'Flecks Marine', 'https://flecksmarine.com/products/boatlife-life-calk-cartridge-white-1033', 'BoatLIFE Life-Calk 1033 polysulfide marine sealant, 10.6 oz cartridge (bedding aluminum, steel and the gasket splice); polyurethane 3M 5200 is not polysulfide', true),
  contactCement: est(14, 'ea', 'Hardware store', 'contact cement, pint (brake pads and treads, veneer banding)'),
};
/** 729 glass tape, 2" wide, sold in 10 ft rolls: the 15 ft a sled needs is two rolls. */
export const GLASS_TAPE: Price = foundPack(10, 14.88, 'ft', 'Powerboat Supply', 'https://powerboatsupply.com/boat-supplies-accessories/paint-maintenance/west-system-products/west-system-9oz-glass-tape-2-x-10-72910', 'West System 729-10 woven E-glass tape 9 oz, 2" x 10 ft roll (the 50 yd roll is $81.38 on the 2024 list)', true, '10 ft roll');

const FINISH = 'Paint store / marine supplier';
const OAK_TREE = 'Oak Tree Supply';
export const FINISH_PRICE: Record<string, Price> = {
  stain: est(18, 'qt', FINISH, 'wipe-on oak stain (or leave natural)'),
  conditioner: est(16, 'qt', FINISH, 'pre-stain conditioner or gel stain for the okoume, which blotches (DESIGN.md finishing)'),
  gelStain: est(20, 'qt', FINISH, 'gel stain for the okoume'),
  varnish: found(53.99, 'qt', 'TotalBoat', 'https://www.totalboat.com/products/lust-marine-spar-varnish', 'TotalBoat Lust Rapid Recoat marine spar varnish, quart (heavily fortified with UV stabilizers)'),
  enamel: est(14, 'qt', FINISH, 'black enamel, for the lid legend (a pint is bought)'),
  thinner: est(11, 'qt', FINISH, 'thinner for varnish coat 1 and brush cleaning (a pint is bought)'),
  sandpaper: { ...found(26.74, 'lot', 'Home Depot', 'https://www.homedepot.com/p/POWERTEC-5-in-8-Hole-Hook-and-Loop-Sanding-Discs-40-80-120-220-320-Grit-Assortment-100PK-with-Abrasive-Cleaning-Stick-45056N/331796641', 'POWERTEC 5" 8-hole hook-and-loop disc assortment, 100 pack (40/80/120/220/320 grit; the 50-pack is 15.47 to 16.55); the lump sum for discs and sheets, 80 to 320 grit', true), packQty: 1, packUsd: 26.74 },
  supplies: est(35, 'lot', 'Hardware store', 'brushes, foam rollers, mixing cups, gloves, acetone, tack cloth'),
};
/**
 * Researched container prices (the real products), keyed like `FINISH_PRICE`; a container without one is priced as the base per-quart price times `FINISH_CONTAINER_FACTOR`.
 * Conditioner: no pint of the water-based product exists, so the pint line buys the quart.
 */
export const FINISH_CONTAINER_PRICE: Record<string, Partial<Record<'pt' | 'qt' | 'gal', Price>>> = {
  varnish: {
    pt: found(32.99, 'pt', 'TotalBoat', 'https://www.totalboat.com/products/lust-marine-spar-varnish', 'TotalBoat Lust Rapid Recoat marine spar varnish, pint'),
    qt: withAlts(found(53.99, 'qt', 'TotalBoat', 'https://www.totalboat.com/products/lust-marine-spar-varnish', 'TotalBoat Lust Rapid Recoat marine spar varnish, quart (heavily fortified with UV stabilizers)'),
      [foundPack(2, 95.99, 'qt', 'TotalBoat', 'https://www.totalboat.com/products/lust-marine-spar-varnish', 'the 2-quart kit is $95.99, cheaper than two quarts ($107.98)', false, '2-quart kit')]),
    gal: found(139.99, 'gal', 'TotalBoat', 'https://www.totalboat.com/products/lust-marine-spar-varnish', 'TotalBoat Lust Rapid Recoat marine spar varnish, gallon (360-400 ft2 at 3 mil wet); four quarts would be $216'),
  },
  stain: { pt: found(19.6, 'pt', OAK_TREE, 'https://www.oaktreesupply.com/products/gf-water-based-dye', 'General Finishes water-based dye, pint (Woodcraft 20.99, item 148600; dark colors up to 29.95)', true) },
  conditioner: {
    pt: found(16.77, 'pt', 'Walmart / Ace / Alper\'s', 'https://www.walmart.com/ip/Minwax-Pre-Stain-Wood-Conditioner-Clear-1-Pint/17300083', 'Minwax water-based pre-stain wood conditioner: NO pint of the water-based product was found, so the pint line buys the QUART at $16.77 (Walmart sale; $21.99 at Ace or Alper\'s)', true),
    qt: found(16.77, 'qt', 'Walmart / Ace / Alper\'s', 'https://www.walmart.com/ip/Minwax-Pre-Stain-Wood-Conditioner-Clear-1-Pint/17300083', 'Minwax water-based pre-stain wood conditioner, quart (Walmart sale; $21.99 at Ace or Alper\'s)', true),
  },
  gelStain: { pt: found(28, 'pt', OAK_TREE, 'https://www.oaktreesupply.com/collections/general-finishes/type_oil-based-stains', 'General Finishes oil-based gel stain, pint ("from 28" up to 37.95 by color; Woodcraft half pint 20.99)', true) },
};

/** Price of a container relative to a quart, for the finishing schedule's buy list: a pint costs about 0.6 of a quart, a gallon about 3.2 quarts. */
export const FINISH_CONTAINER_FACTOR: Record<'pt' | 'qt' | 'gal', number> = { pt: 0.6, qt: 1, gal: 3.2 };

/**
 * Reference prices for the sewn parts (the model carries their costs: 55 and 25); kept here so they can be re-priced by area or yardage.
 * The foam sheet (1", 24" x 24") was not found: Penn-Elcom's 1" plank, 24" x 108", is the nearest (spec gap).
 */
export const SOFT_GOODS: Record<string, Price> = {
  vinylPerYard: found(12.95, 'yd', 'Fabric Guru', 'https://www.fabricguru.com/marine-vinyl/marine-grade-vinyl-outdoor-upholstery-fabric-navy.html', 'navy marine-grade outdoor upholstery vinyl (the 54" width is not stated; Walmart black 54" is $11.95/yd; Sailrite not retrieved)', true),
  foamPerSheet: notFound(withAlts(est(40, 'ea', 'Foam supplier', '1" closed-cell polyethylene, 24" x 24"'), [
    gap(found(58.52, 'plank', 'Penn-Elcom', 'https://www.penn-elcom.com/us/1in-charcoal-etha-plank-foam-24in-wide-m62925', '1" charcoal Etha plank foam, 24" wide x 108" (sale from 181.52)', true), 'a 24" x 108" plank, not a 24" x 24" sheet')])),
};

// ── The Standard weather spec (garage-kept): 304 / 18-8 stainless, zinc, galvanized, beech Dominos ──────────
// Source: docs/price-research/price-research-standard-2026-10.md (.json). Same rules as above: an exact listing is `quoted` (with its link), the nearest size or kind is an `estimate` that says so,
// a spec-different cheaper item is an alternative. Bolt Depot sells fasteners by the piece AND by the bag: `eachUsd` is the piece price, the bag the pack (the BOM takes the cheaper).

const FAST_STD = 'Fastener supplier (McMaster-Carr / Fastenal class), 18-8 (304) stainless';
const BD_PRODUCT = 'https://boltdepot.com/Product-Details?product=';
const BD_FENDER_18_8 = 'https://boltdepot.com/Fender_washers_Stainless_steel_18-8';
/** An 18-8 Bolt Depot fastener sold by the piece and by the bag: quoted, read via search. */
const bd18 = (id: number | string, unit: string, desc: string, each: number, bagQty: number, bagUsd: number, extra = ''): Price =>
  withEach(foundPack(bagQty, bagUsd, unit, BOLT_DEPOT, typeof id === 'string' ? id : `${BD_PRODUCT}${id}`, `${desc}, $${each.toFixed(2)} each by the piece or ${usdPlain(bagUsd)} per ${bagQty}${extra ? `; ${extra}` : ''}`, true), each);
const usdPlain = (v: number): string => `$${v.toFixed(2)}`;
/** The same, an estimate (the nearest size, or a price the research did not read): says which. */
const bd18est = (id: number | undefined, unit: string, desc: string, each: number, bagQty: number, bagUsd: number, why: string): Price =>
  withEach({ ...packed(bagQty, bagUsd, unit, BOLT_DEPOT, `ESTIMATE (Standard spec): ${desc}; ${why}`), ...(id ? { url: `${BD_PRODUCT}${id}` } : {}) }, each);
const stdScrewLabel = (gauge: number, len: string): RegExp => new RegExp(String.raw`^18-8 (?:flat-head )?wood screw #${gauge} x ${len.replace('/', String.raw`\/`)}"$`);
const STD_SCREW_NOTE = 'Phillips flat-head 18-8 wood screw';

export const FASTENER_PRICE_STANDARD: Array<{ match: RegExp; price: Price }> = [
  // Wood screws (Bolt Depot, 18-8). The three sizes of D-72 are #8 x 5/8, #8 x 1-1/4 and #6 x 2-1/2.
  { match: stdScrewLabel(8, '5/8'), price: bd18(3958, 'ea', `${STD_SCREW_NOTE} #8 x 5/8" (#3958)`, 0.22, 100, 14.01) },
  { match: stdScrewLabel(8, '1-1/4'), price: bd18(3961, 'ea', `${STD_SCREW_NOTE} #8 x 1-1/4" (#3961)`, 0.29, 100, 18.29, '316 is 0.48 / 34.63 per 100') },
  // D-77: the pan-head #8 x 1-1/4 screws of the two brake pivot straps (8): priced as the flat-head screw of the same size until quoted.
  { match: /^18-8 pan-head wood screw #8 x 1-1\/4"$/, price: notFound(withEach(packed(100, 18.29, 'ea', BOLT_DEPOT, 'ESTIMATE (Standard spec): 18-8 Phillips pan-head wood screw #8 x 1-1/4" for the brake pivot straps (the strap is not countersunk), priced as the flat-head screw of the same size (#3961, $18.29 per 100, $0.29 each); quote the pan head before ordering'), 0.29)) },
  { match: stdScrewLabel(6, '2-1/2'), price: notFound(withEach({ ...packed(100, 40, 'ea', BOLT_DEPOT, `ESTIMATE (Standard spec): 18-8 Phillips flat-head wood screw #6 x 2-1/2" (the piloted rail-to-chine screws). The research found no 18-8 #6 above 1-1/2" (Bolt Depot's #6 table stops there; 2-1/2" exists only in other materials); this is 0.40 each by the piece, extrapolated from #6 x 1/2 at 0.12 and #8 x 3" at 0.67 (#9025). A #8 x 2-1/2" is 42.49 per 100 at Zoro [S] (a different gauge: the rails would need a bigger pilot); hand-quote Fastenal, McMaster or Zoro`), url: 'https://boltdepot.com/Wood_screws_Phillips_flat_head_Stainless_steel_18-8_6' }, 0.4)) },
  { match: stdScrewLabel(6, '3/8'), price: bd18(9024, 'ea', `${STD_SCREW_NOTE} #6 x 3/8" (#9024)`, 0.11, 100, 6.64) },
  { match: stdScrewLabel(6, '1/2'), price: bd18(3953, 'ea', `${STD_SCREW_NOTE} #6 x 1/2" (#3953)`, 0.12, 100, 7.41) },
  { match: stdScrewLabel(8, '1/2'), price: bd18(3957, 'ea', `${STD_SCREW_NOTE} #8 x 1/2" (#3957)`, 0.21, 100, 13.18) },
  { match: stdScrewLabel(8, '1'), price: bd18(3960, 'ea', `${STD_SCREW_NOTE} #8 x 1" (#3960)`, 0.27, 100, 17.31) },
  { match: stdScrewLabel(10, '1'), price: bd18(3966, 'ea', `${STD_SCREW_NOTE} #10 x 1" (#3966)`, 0.31, 100, 19.77) },
  { match: stdScrewLabel(10, '1-1/4'), price: bd18(3967, 'ea', `${STD_SCREW_NOTE} #10 x 1-1/4" (#3967)`, 0.35, 100, 22.63) },
  { match: stdScrewLabel(10, '2'), price: bd18(3970, 'ea', `${STD_SCREW_NOTE} #10 x 2" (#3970)`, 0.51, 100, 33.7) },
  { match: /^18-8 (?:flat-head )?wood screw/, price: notFound(withEach(packed(100, 30, 'ea', FAST_STD, '18-8 wood screw, a length the research did not read'), 0.35)) },
  // Bolts (18-8 hex, socket button head, carriage)
  { match: /button-head cap screw 1\/4-20 x 1-1\/4"/, price: bd18(4414, 'ea', '18-8 socket button-head cap screw 1/4-20 x 1-1/4" (#4414)', 0.33, 50, 11.84, '316 was 1.05 each') },
  { match: /button-head cap screw 1\/4-20 x 2"/, price: bd18(4417, 'ea', '18-8 socket button-head cap screw 1/4-20 x 2" (#4417)', 0.56, 50, 20.04, '316 was 1.05 each') },
  { match: /button-head cap screw/, price: notFound(withEach(packed(50, 20, 'ea', FAST_STD, '18-8 socket button-head cap screw'), 0.6)) },
  { match: /carriage bolt 3\/8/, price: { ...bd18est(954, 'ea', '18-8 carriage bolt 3/8-16 x 6-1/2" (stock length)', 2.04, 50, 78, 'the research read the 6" bolt (#954, $1.88 each, 72.31 per 50); 6-1/2" is that price x 6.5/6 until quoted. 6-1/4" is not a stock length, and the 6" bolt stops 1/16" short of the top of the nylock nut on this stack'), decision: CARRIAGE_DECISION } },
  { match: /hex bolt 1\/4-20 x 1-1\/2"/, price: bd18(132, 'ea', '18-8 hex bolt 1/4-20 x 1-1/2" (#132)', 0.28, 100, 21.6) },
  { match: /hex bolt 1\/4-20 x 2-1\/4"/, price: bd18(8976, 'ea', '18-8 hex bolt 1/4-20 x 2-1/4" (#8976)', 0.43, 100, 32.98, 'a semi-standard length') },
  { match: /hex bolt 1\/4-20 x 3"/, price: bd18(135, 'ea', '18-8 hex bolt 1/4-20 x 3" (#135)', 0.53, 100, 40.52, 'a semi-standard length') },
  { match: /hex bolt 3\/8-16 x 3-1\/4"/, price: bd18(8991, 'ea', '18-8 hex bolt 3/8-16 x 3-1/4" (#8991)', 1.19, 50, 45.66, '316 was 1.88-1.94 each') },
  { match: /hex bolt 3\/8-16 x 4"/, price: bd18(166, 'ea', '18-8 hex bolt 3/8-16 x 4" (#166)', 1.37, 50, 52.68) },
  { match: /bolt 3\/8/, price: notFound(withEach(packed(50, 55, 'ea', FAST_STD, '18-8 bolt 3/8-16, a length the research did not read; Bolt Depot lists 3/8-16 x 3-1/4 at $1.19 and x 4 at $1.37'), 1.3)) },
  { match: /bolt 1\/4/, price: notFound(withEach(packed(100, 35, 'ea', FAST_STD, '18-8 bolt 1/4-20, a length the research did not read; Bolt Depot lists 1/4-20 x 2-1/4 at $0.43 and x 3 at $0.53'), 0.4)) },
  { match: /T-nut/i, price: bd18(10484, 'ea', '18-8 T-nut 1/4-20 (#10484), for the handle socket backers (epoxied in)', 0.74, 100, 52.87, 'Albany County Fasteners 304 T-nut also $0.74') },
  // Nuts and washers
  { match: /lock nut 1\/4/, price: bd18(2554, 'ea', '18-8 nylon-insert lock nut 1/4-20 (#2554)', 0.16, 100, 10.36) },
  { match: /lock nut 3\/8/, price: withAlts(
    foundPack(50, 8.66, 'ea', 'Home Depot (Prime-Line)', 'https://homedepot.com/p/Prime-Line-3-8-in-16-Grade-18-8-Stainless-Steel-Nylon-Insert-Lock-Nuts-50-Pack-9075391/310550324', 'Prime-Line 3/8-16 grade 18-8 stainless nylon-insert lock nuts, 50-pack (9075391): 8.66 in one snapshot, 9.27 in another (0.17-0.19 each)', true),
    [bd18(2556, 'ea', 'Bolt Depot 18-8 nylon-insert lock nut 3/8-16 (#2556)', 0.36, 50, 12.07, '26 by the piece is 9.36')]) },
  { match: /fender washer #8/, price: withEach(packed(100, 14, 'ea', FAST_STD, 'ESTIMATE (Standard spec): 18-8 fender washer for #8, 3/4" OD (not in the Standard research); pack of 100'), 0.2) },
  { match: /fender washer 1\/4/, price: bd18(BD_FENDER_18_8, 'ea', '18-8 fender washer 1/4" x 1-1/4"', 0.28, 100, 18.81, '48 by the piece is cheaper than the bag; Home Depot Everbilt 20-pack 5.97 (0 in stock)') },
  { match: /fender washer 3\/8/, price: bd18(BD_FENDER_18_8, 'ea', '18-8 fender washer 3/8" x 1-1/2"', 0.41, 50, 14.51, 'the bag of 50 covers 46; the page listed 0.29 a washer in the bag against 0.41 each') },
  { match: /fender washer/, price: notFound(withEach(packed(100, 20, 'ea', FAST_STD, '18-8 fender washer'), 0.3)) },
  // Pins, collars, eyes, inserts
  { match: /cotter pin/i, price: withAlts(
    withEach(bd18est(14570, 'ea', '18-8 cotter pin 5/32" x 1-1/2"', 0.32, 100, 22.5, 'the research read 5/32" x 1-1/4" at 0.27 / 19.43 per 100 (#14570) and x 1-3/4" at 0.36 / 25.58 (#14572); the 1-1/2" is between'), 0.32),
    [gap(bd18(14570, 'ea', '18-8 cotter pin 5/32" x 1-1/4" (#14570)', 0.27, 100, 19.43), 'the pin is 1-1/4" long, not 1-1/2"')]) },
  { match: /shaft collar/i, price: found(4.43, 'ea', 'Penn Tool Co.', 'https://www.penntoolco.com/87986402', 'Climax C-062 one-piece set-screw collar, 5/8" bore, 1-1/8" OD x 1/2", zinc plated: the Standard weather spec (garage-kept). PartsSource GSC-062-Z zinc is $4.99; 316 is $33.36 (estimate, the Extreme spec)', true) },
  { match: /stainless rod/i, price: est(2.5, 'ea', FAST_STD, 'cut from a 3/8" x 12" 304 rod (about $10): five pins per rod. ESTIMATE, scaled from the 316 estimate; not in the Standard research') },
  { match: /screw eye/, price: withAlts(
    withEach({ ...packed(20, 12.82, 'ea', BOLT_DEPOT, 'ESTIMATE (Standard spec): 18-8 screw eye, nearest size. The research read trade size 8 (1/2" eye) at 1.08 each / 12.82 per 20 (#15513); the model asks for a #10 shank. Size 4 (5/8") is 1.94, size 2 is 2.63. Confirm the shank fits the brake cord tie'), url: `${BD_PRODUCT}15513` }, 1.08),
    [gap(foundPack(1, 2.79, 'ea', 'Ace Hardware (National Hardware)', 'https://www.acehardware.com/departments/hardware/screw-eyes/5700620', 'National Hardware stainless 5/8" screw eye, 75 lb, $2.79 each [S] (this listing and 5700554 were not told apart)', true), 'a 5/8" eye, not the #10 size')]) },
  { match: /threaded insert/, price: withAlts(
    withEach({ ...packed(100, 18.71, 'ea', BOLT_DEPOT, 'ESTIMATE (Standard spec): zinc flanged softwood threaded insert, #10-32, Allen drive (#23861), 0.25 each or 18.71 per 100. The research found NO 18-8 #10-32 insert at a readable price (Bolt Depot has an 18-8 hardwood insert only in #8-32 x 3/8" at 4.78 each); this one is a softwood type, 0.512" long (the model asks for 3/8" and 5/16"). Fine in a dry garage; confirm the drill size'), url: `${BD_PRODUCT}23861` }, 0.25),
    [gap(foundPack(25, 88.61, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Threaded_inserts', 'Bolt Depot 18-8 hardwood insert, #8-32 x 0.375", $4.78 each, 88.61 per 25', true), 'a #8-32 thread, not #10-32, and about 20x the price')]) },
  { match: /Thumb-knob/, price: withAlts(notFound(est(1.75, 'ea', FAST_STD, 'thumb-knob screw #10-32, 18-8 knurled: no exact one found (Home Depot Everbilt #10-32 x 1/2" stainless knurled, 831568, is 3.38 per bag, count not stated); the length is 1" with the 1/4 in white oak plywood web')), [
    gap(foundPack(100, 16.7, 'ea', BOLT_DEPOT, `${BD_PRODUCT}23989`, 'Bolt Depot thumb screws, spade type, zinc plated steel, #10-32 x 3/4" (#23989), 0.21 each or 16.70 per 100', true), 'zinc spade-type, 3/4" not 1", and not a knurled knob')]) },
  { match: /Domino DF 500 4x20/, price: foundPack(450, 25, 'ea', 'Woodcraft', 'https://www.woodcraft.com/products/festool-dominos-4mm-x-20mm-450-pieces', 'Festool BEECH Dominos 4mm x 20mm, 450 pieces (495661), backordered online, special order (The Power Tool Store and JMP Wood also $25.00). Beech is the interior type: fine for a garage-kept sled', false) },
  { match: /Domino DF 500 5x30/, price: foundPack(300, 25, 'ea', 'The Power Tool Store', 'https://thepowertoolstore.com/collections/power-tools/products/festool-494938', 'Festool BEECH Domino D 5x30/300 BU (494938); KJP Select Hardwoods $31.00. The listing shows availability not guaranteed', true) },
  { match: /Domino DF 500 8x50/, price: foundPack(100, 25, 'ea', 'The Power Tool Store', 'https://thepowertoolstore.com/products/festool-494941', 'Festool BEECH Domino D 8x22x50/100 BU (494941); Acetool also $25.00 (ships in 7-14 days)', true) },
  { match: /^Domino/, price: packed(100, 25, 'ea', DOMINO_DEALER, 'BEECH Domino, the interior type: pack of 100 (estimate: check the size)') },
  // Material-free labels that have no 18-8 or zinc twin
  // D-76: the D-ring plate's #8-32 x 2" through-bolt sets (24); not in the Standard research either, so estimates (18-8 is about 40% under 316).
  { match: /machine screw #8-32 x 2"/, price: withEach(packed(100, 22, 'ea', FAST_STD, 'ESTIMATE (Standard spec): 18-8 pan-head machine screw #8-32 x 2" (not in the Standard research); pack of 100'), 0.3) },
  { match: /lock nut #8-32/, price: withEach(packed(100, 9, 'ea', FAST_STD, 'ESTIMATE (Standard spec): 18-8 nylon-insert lock nut #8-32 (not in the Standard research; the 1/4-20 is 0.16 each); pack of 100'), 0.12) },
  { match: /machine screw/, price: withEach(packed(100, 12, 'ea', FAST_STD, '18-8 machine screw; pack of 100 (not in the Standard research)'), 0.2) },
  { match: /\bM[34]\b/, price: withEach(packed(100, 7, 'ea', FAST_STD, '18-8 metric socket or pan-head screw; pack of 100 (not in the Standard research)'), 0.12) },
  { match: /^18-8 /, price: est(1, 'ea', FAST_STD, 'No Standard price in prices.ts for this label: add it to FASTENER_PRICE_STANDARD') },
];

/**
 * Standard-spec prices for purchased parts, by partNo; tried before PURCHASED_PRICE. `describe` replaces the model's part name in the BOM where the name says 316.
 * A part not listed falls through to PURCHASED_PRICE (wheels, rope, cushions, lights...: spec-free items, and the model's own cost).
 */
export interface StdPurchasedEntry extends PurchasedPriceEntry { describe?: string }
const SEAGOING_304 = 'the Standard weather spec: 304 stainless';
export const PURCHASED_PRICE_STANDARD: StdPurchasedEntry[] = [
  { match: /^steer-eye$/, price: withAlts(EYE_GALV.steerEye, [EYE_316.steerEye], EYE_DECISION) },
  { match: /^steer-anchor$/, price: withAlts(EYE_GALV.steerAnchor, [EYE_316.steerAnchor], EYE_DECISION) },
  { match: /^steer-chain$/, override: true, price: found(Math.round(((CHAIN_CUT_IN / 12) * 2.12 + 2 * 1.99) * 100) / 100, 'ea', 'Home Depot (Everbilt) / Ace (Campbell)', 'https://homedepot.com/p/Everbilt-3-16-in-x-1-ft-Grade-30-Zinc-Plated-Steel-Proof-Coil-Twist-Link-Chain-811646/303285928',
    `3/16" Grade 30 zinc proof coil chain at $2.12/ft (${CHAIN_CUT_IN} in; WLL 750 lb; the page showed 0 in stock; KingChain 15 ft tub $15.59, about $1.04/ft) plus two Campbell 3/16" zinc quick links at $1.99 each (Ace Hardware item 52604; WLL 660 lb)`, true), describe: 'Steering check chain (3/16" zinc chain, zinc quick links)' },
  { match: /^seat-hinge$/, override: true, price: found(11.005, 'ea', 'MarineEngine.com (Sea-Dog)', 'https://www.marineengine.com/boat-accessories/hardware/201582-1', `Sea-Dog 201582-1 stainless butt hinge 2" x 2", described as 304 stamped stainless, pack of 2 at $22.01 (fasteners not included), shown as half each; Ace Seachoice 2 x 2 2-pack is $25.99 (grade not stated)`, true) },
  { match: /^storage-hinge$/, override: true, price: { ...est(9.21, 'ea', 'MarineEngine.com (Seachoice)', `ESTIMATE, nearest size (${SEAGOING_304}): Seachoice 34911 butt hinge, leaf 1-5/8" x 2-1/2", described as 304, "fast pin" type, pack of 2 at $18.42, shown as half each. The model asks for 2-1/2" x 2-3/4": not found in stainless. The lid hinge leaf runs 1-1/8" past the box end, so check the size against the lid frame`, 'https://www.marineengine.com/boat-accessories/hardware/34911') } },
  { match: /^storage-latch$/, override: true, price: found(4.895, 'ea', 'Walmart', 'https://www.walmart.com/ip/316545201', '304 stainless draw toggle latch with spring-steel hook, 2-pack at $9.79, shown as half each (the catch comes with it, so the catch is $0); the 2.87" version is $7.69, a zinc-plated 2-set (38 mm) $8.69. Walmart blocks fetching, so the listing ID is the nearest returned', true) },
  { match: /^storage-lid-stay$/, override: true, price: withAlts(found(26.4, 'ea', 'Sugatsune', 'https://www.sugatsune.com/s-s-stay-s-93l', 'Sugatsune S-93L stainless (304) friction lid stay, 66 lb (S-91R is 31.30, 88 lb)', true),
    [gap(foundPack(2, 4.99, 'ea', 'Rockler', 'https://www.rockler.com/6-medium-duty-quiet-action-lid-support', 'Rockler 6" Medium-Duty Quiet Action Lid Support, $4.99 a pair on sale (13.99 regular), friction discs, plated steel', true, 'pair'), 'plated steel, not stainless, and a 6" support (check it against the lid); lid supports do not replace hinges')]) },
  { match: /^lash-point$/, override: true, price: withAlts({ ...est(9.24, 'ea', 'etrailer', `ESTIMATE, nearest listing (${SEAGOING_304.replace('304 stainless', 'zinc')}): etrailer RRING-R6000 bolt-on D-ring, 4-7/8" wide, 2,000 lb, zinc; the hole count is not stated (probably 2) and the model asks for a 4-hole plate at 300 lbf. No zinc 4-hole plate at Harbor Freight, Northern Tool or Tractor Supply came up`, 'https://etrailer.com/Trailer-Tie-Down-Anchors/etrailer/RRING-R6000.html') },
    [gap(est(6.82, 'ea', 'needatrailerpart.com (Brophy)', 'Brophy RR09 1/4" zinc bolt-on D-ring with plastic pan, 1,000 lb SWL, 2 holes, $6.82 to $11.58', 'https://needatrailerpart.com'), '2 holes, not 4')]) },
  { match: /^brake-pivot-clip$/, override: true, price: found(0.82, 'ea', BOLT_DEPOT, `${BD_PRODUCT}27209`, '18-8 hitch pin clip, 0.093" wire, for 3/8" to 5/8" pins (#27209), $0.82 each, 13.43 per 25 (124.00 per 250)', true), describe: 'Brake pivot hitch-pin clip (18-8 stainless)' },
  { match: /^(scupper|storage-drain)$/, override: true, price: { ...est(5.2, 'ea', 'Global Industrial (MSI)', 'ESTIMATE (Standard spec): 3/8" MPT x 3/8" hose barb, priced from the 316 listing (Class 150, $5.20); a 304 barb is not in the Standard research and costs a little less', 'https://www.globalindustrial.com/p/38-mpt-x-38-316-stainless-steel-hose-barb-class-150') } },
];
/** Model-cost notes for the Standard spec (the parts whose model cost stays the price). Falls through to PURCHASED_MODEL_COST_NOTE for the spec-free ones. */
export const PURCHASED_MODEL_COST_NOTE_STANDARD: ModelCostNote[] = [
  { match: /^seat-pin$/, note: `model cost kept: no 3/8" x 1-1/2" detent pin found in the ${RESEARCH_DATE} research (Whitecap S-1024C is $69.99, 304, diameter not stated, likely the wrong part)` },
  { match: /^brake-snap$/, note: 'model cost kept: the 304 snap hook found (Hardware Essentials via ihsgonline, $6.24) does not state its size; the Everbilt 13/16 x 3-3/16" stainless fixed-eye snap hook is $13.46 (too big and dear)', alternatives: [
    gap(foundPack(1, 6.24, 'ea', 'ihsgonline (Hardware Essentials)', 'https://ihsgonline.com/products/snap-hook/235445002/', 'Hardware Essentials snap hook, 304 stainless, size not stated', true), 'the size is not stated')] },
  { match: /^brake-pivot-pin$/, note: `model cost kept: the Everbilt 3/8" x 2" zinc-plated universal clevis pin (815438, $3.75) is 2" long and the pin is about 3-1/16" (through the strap, the tongue and 1" into the inboard ear, D-77); stainless 3/8 x 2" (70518) is $4.75. No 3-1/16" pin found at retail: cut a 3/8" stainless rod or order a long pin`, alternatives: [
    gap(foundPack(1, 3.75, 'ea', 'Home Depot (Everbilt)', 'https://homedepot.com/p/Everbilt-3-8-in-x-2-in-Zinc-Plated-Universal-Clevis-Pin-815438/204276615', 'Everbilt 3/8" x 2" zinc-plated universal clevis pin (815438)', true), '2" long, not 3-1/16"; zinc-plated')] },
];

// ── Titebond III (Standard) ──
export interface GlueBottle { flOz: number; label: string; price: Price }
const TB_URL = 'https://www.rockler.com/titebondtrade-iii-ultimate-wood-glue-optional-sizes';
/** Titebond III Ultimate bottles (Rockler sale prices, 10% off, read via search): the BOM buys the cheapest combination that covers the glue joints. */
export const TITEBOND_BOTTLES: GlueBottle[] = [
  { flOz: 8, label: '8 oz bottle', price: withAlts(found(6.29, 'bottle', 'Rockler', TB_URL, 'Titebond III Ultimate wood glue, 8 oz (#28835), sale price (10% off 6.99); Tractor Supply 7.99, Wurth LAC 7.49', true), []) },
  { flOz: 16, label: '16 oz bottle', price: withAlts(found(8.99, 'bottle', 'Rockler', TB_URL, 'Titebond III Ultimate wood glue, 16 oz (#23921), sale price (10% off 9.99); Home Depot 12-pack 77.98 (6.50 each)', true),
    [found(7.97, 'bottle', 'Walmart', 'https://www.walmart.com/ip/Titebond-III-16-OZ-Ultimate-Wood-Glue-Each/223139290', 'Titebond III Ultimate 16 oz, $7.97 (was 10.00); Walmart blocks fetching and a second Walmart 16 oz listing showed 18.99, so check which seller', true)]) },
  { flOz: 32, label: 'quart bottle', price: found(15.29, 'bottle', 'Rockler', TB_URL, 'Titebond III Ultimate wood glue, quart (#28724), sale price (10% off 16.99); gallon 35.09', true) },
];

// ── Epoxy kits for the Standard spec (the reduced epoxy fits a small kit) ──
export interface OtherEpoxyKit { id: string; label: string; resinFlOz: number; mixedFlOz: number; price: Price; pumpsIncluded: boolean }
export const EPOXY_KITS_SMALL: OtherEpoxyKit[] = [
  { id: 'mas-5-1', label: 'MAS Epoxies 5:1 Traditional Marine Epoxy kit, 38.4 oz, with pumps', resinFlOz: 32, mixedFlOz: 38.4, pumpsIncluded: true,
    price: found(59.99, 'kit', 'MAS Epoxies', 'https://masepoxies.com/products/5-1-traditional-marine-epoxy-kits', '5:1 Traditional Marine Epoxy Kit, 38.4 oz: 32 fl oz resin + 6.4 fl oz hardener, with 2 quart mixing cups and 2 pumps. The page shows the same $59.99 for the 38.4 oz and the 1.2 gallon sizes, so the 38.4 oz price is likely this figure but not certain') },
  { id: 'totalboat-5-1', label: 'TotalBoat 5:1 Marine Epoxy kit, quart, with pumps', resinFlOz: 32, mixedFlOz: 38.4, pumpsIncluded: true,
    price: found(68.99, 'kit', 'TotalBoat', 'https://www.totalboat.com/products/5-1-marine-epoxy-resin-kits', '5:1 Marine Epoxy Resin Kit, quart (fast or slow), with pumps; fetched. The gallon kit without pumps is 154.99') },
];

// ── Spar urethane (Standard topcoat) ──
const URETHANE_QT_URL = 'https://www.walmart.com/ip/Minwax-Helmsman-Spar-Urethane-Indoor-Outdoor-Wood-Finish-Quart-Gloss/17253537';
export const URETHANE_CONTAINER_PRICE: Partial<Record<'pt' | 'qt' | 'gal', Price>> = {
  qt: withAlts(found(22.88, 'qt', 'Walmart', URETHANE_QT_URL, 'Minwax Helmsman Spar Urethane, oil-based, gloss, quart (63200444): about 100 ft² a quart on the can; Lowe\'s 29.98, Ace 31.99; street prices 22-32', true),
    [found(29.98, 'qt', 'Home Depot', 'https://www.homedepot.com/p/Varathane-1-Quart-Clear-Gloss-Oil-Based-Exterior-Spar-Urethane-9241H/100209410', 'Varathane Ultimate oil-based exterior spar urethane, quart (9241H)', true),
     found(29.99, 'qt', 'Ace Hardware', 'https://www.acehardware.com/departments/paint-and-supplies/stains-and-finishes/varnish/1372952', 'Minwax Helmsman WATER-based spar urethane, quart: low odor, less amber, builds thinner', true)]),
  gal: found(59.99, 'gal', 'Ace Hardware', 'https://www.acehardware.com/departments/paint-and-supplies/stains-and-finishes/varnish/11844', 'Minwax Helmsman spar urethane, oil-based, gloss, gallon (13200000): cheaper than three quarts ($68.64); Walmart and Anderson Lumber 67.99', true),
};

/** Standard 304 estimate for a stainless metal-stock price that the research found (or estimated) in 316: 304 is not researched, so 85 % of the 316 price, flagged as an estimate. */
export const STD_304_FACTOR = 0.85;

// ── Lookups ───────────────────────────────────────────────────────────────────

/** The 304 / 18-8 name of a model text that says 316 (the Standard spec's BOM text); the model's own part names still say 316. */
export const std304 = (text: string): string => text.replace(/\b316( stainless)?\b/g, (_m, st) => `304${st ?? ''}`);

export function purchasedEntry(partNo: string, spec: SpecName = 'extreme'): PurchasedPriceEntry | undefined {
  if (spec === 'standard') {
    const std = PURCHASED_PRICE_STANDARD.find((r) => r.match.test(partNo));
    if (std) return std;
  }
  return PURCHASED_PRICE.find((r) => r.match.test(partNo));
}
export function purchasedDescribe(partNo: string, spec: SpecName): string | undefined {
  return spec === 'standard' ? PURCHASED_PRICE_STANDARD.find((r) => r.match.test(partNo))?.describe : undefined;
}
export function purchasedPrice(partNo: string, spec: SpecName = 'extreme'): Price {
  return purchasedEntry(partNo, spec)?.price ?? PURCHASED_FALLBACK;
}
export function fastenerPrice(label: string, spec: SpecName = 'extreme'): Price {
  if (spec === 'standard') {
    const std = FASTENER_PRICE_STANDARD.find((r) => r.match.test(label));
    if (std) return std.price;
  }
  return FASTENER_PRICE.find((r) => r.match.test(label))?.price ?? FASTENER_FALLBACK;
}
/**
 * The metal stock price of a cut-list section. The Standard spec buys 304 where the model says 316 stainless: no 304 stock was researched, so it is the 316 price (researched or estimated)
 * x STD_304_FACTOR, an ESTIMATE that says so. Non-stainless stock (aluminum, steel rod, DOM) is the same in both specs.
 */
export function metalPrice(section: string, spec: SpecName = 'extreme'): Price | null {
  const price = METAL_PRICE_PER_FT.find((r) => r.match.test(section))?.price ?? null;
  if (!price || spec !== 'standard' || !/\b316\b/.test(section)) return price;
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  const alts = price.alternatives?.map((a) => ({ ...a, note: a.note ? std304(a.note) : a.note }));
  return { ...price, basis: 'estimate', usd: r2(price.usd * STD_304_FACTOR), ...(price.packUsd ? { packUsd: r2(price.packUsd * STD_304_FACTOR) } : {}),
    note: `ESTIMATE (Standard spec): 304 stainless, ${Math.round(STD_304_FACTOR * 100)} % of the 316 price below, because no 304 stock was researched. ${price.note ? std304(price.note) : ''}`.trim(), ...(alts ? { alternatives: alts } : {}) };
}
