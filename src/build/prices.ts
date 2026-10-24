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
 *
 * Cost pass (2026-10-14, D-79 to D-83; docs/price-research/price-research-cost-pass-2026-10.md): the entries marked with `foundCP` / `foundPackCP` are quotes from the second research round, dated
 * `RESEARCH_DATE_COST_PASS`. `basis: 'owned'` is shop stock Eric already has ($0, "from existing shop stock"): the line stays in the BOM so it is not forgotten, but it costs nothing
 * and never counts as an estimate.
 */

import { WEATHER_SPEC, type Params } from '../params';

/** 'owned' = from existing shop stock (D-79): listed at $0, never an estimate. */
export type PriceBasis = 'quoted' | 'estimate' | 'owned';

/**
 * The weather spec the BOM is priced for (D-73, Eric 2026-10-12). STANDARD (the default; garage-kept, used a few times a year, wet at most at a rainy derby): 304 / 18-8 stainless, zinc and
 * galvanized where it lives dry, beech Dominos, Titebond III, exterior spar urethane, a small epoxy kit; priced from docs/price-research/price-research-standard-2026-10.md. EXTREME (stored outside,
 * near salt, or exposed regularly): 316 throughout, beech Dominos epoxied in (D-79), epoxy everywhere, marine varnish, the same U.S. Composites 96 oz epoxy kit (a second kit when the need runs past it); priced from docs/price-research/price-research-2026-10.md.
 * A Standard listing that is the nearest size or kind (not the exact item the model asks for) is priced as an `estimate` with its link and the gap in the note; an exact listing is `quoted`.
 */
export type SpecName = 'standard' | 'extreme';
export const specOf = (p: Pick<Params, 'weatherSpec'>): SpecName => (p.weatherSpec === WEATHER_SPEC.extreme ? 'extreme' : 'standard');

/** The date of the web price research whose prices are `quoted` below (docs/price-research/price-research-2026-10.md). */
export const RESEARCH_DATE = '2026-10-12';
/** The date of the cost-pass price research (docs/price-research/price-research-cost-pass-2026-10.md): the `foundCP(...)` entries. */
export const RESEARCH_DATE_COST_PASS = '2026-10-14';
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
   * `usd` is then the per-unit equivalent (`packUsd / packQty`). A fastener that needs under `BULK_SHARE` of a pack (bom.ts) gets the "you may already have these" note; every packed
   * line is priced by whole packs.
   */
  packQty?: number;
  packUsd?: number;
  /**
   * Also sold by the piece (Bolt Depot sells fasteners singly or by the bag): the single-piece price. The BOM buys whichever is cheaper for the count (`qty x eachUsd` against whole packs),
   * so a small count is priced per piece, in place, and only a count that makes the bag cheaper is priced by the pack.
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
/** A cost-pass quote (2026-10-14): quoted, with its vendor, URL and date in the note. `search`: read via the search tool, not fetched. */
const foundCP = (usd: number, unit: string, source: string, url: string, note: string, search = false): Price =>
  quoted(usd, unit, source, `${note} [${source}, ${RESEARCH_DATE_COST_PASS}${search ? `; ${SEARCH_READ_NOTE}` : ''}]`, url);
/** The same for something sold in packs (or fixed pieces). */
const foundPackCP = (packQty: number, packUsd: number, unit: string, source: string, url: string, note: string, search = false, packLabel?: string): Price =>
  ({ ...foundCP(packUsd / packQty, unit, source, url, note, search), packQty, packUsd, ...(packLabel ? { packLabel } : {}) });
/** Shop stock Eric already owns (D-79): $0, listed so it is not forgotten. `what` says what it is for. It is never an estimate. */
export const OWNED_NOTE = 'from existing shop stock (Eric, 2026-10-14)';
const owned = (unit: string, what: string): Price => ({ usd: 0, unit, source: 'Existing shop stock', basis: 'owned', note: `${OWNED_NOTE}: ${what}` });
/** An alternative that does not meet the spec: says so first. */
const gap = (p: Price, why: string): Price => ({ ...p, specGap: true, note: `SPEC GAP: ${why}. ${p.note ?? ''}`.trim() });
/** The same price with its alternatives (and, optionally, a decision for Eric). */
const withAlts = (p: Price, alternatives: Price[], decision?: string): Price => ({ ...p, alternatives, ...(decision ? { decision } : {}) });
/** An estimate the research did not find a price for: it keeps the estimate and says so. */
const notFound = (p: Price): Price => ({ ...p, note: `${p.note ? `${p.note} - ` : ''}not found in the ${RESEARCH_DATE} research` });

/** The links Eric gave (2026-10-12), and the cost-pass vendors (2026-10-14). */
export const WOODYARD_URL = 'https://www.thewoodyard.com/current-pricing-list/';
export const WOODYARD_PLYWOOD_URL = 'https://www.thewoodyard.com/current-pricing-list/#plywood';
export const AIRCRAFT_SPRUCE_OKOUME_URL = 'https://www.aircraftspruce.com/catalog/wppages/okume.php';
export const PEACH_STATE_LUMBER_URL = 'https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/lumber-pricing-peach-state-lumber-products-ed336ac0.pdf';
export const PEACH_STATE_PLYWOOD_URL = 'https://cdn.hibuwebsites.com/8146c0f71b4c4391ae7a534b644b0c01/files/uploaded/plywood-pricing-peach-state-lumber-products-34754192.pdf';
export const WOOD_VENDORS_URL = 'https://woodvendors.com/white-oak-lumber/';
export const BOULTER_URL = 'https://www.boulterplywood.com/MarinePlywood_4.htm';

// ── Lumber and sheet ──────────────────────────────────────────────────────────

const HARDWOOD = 'Local hardwood dealer (rough, kiln-dried white oak)';
const WOODYARD = 'The Wood Yard (local), current pricing list (Eric, 2026-10-12), plus tax';
const PEACH_STATE = 'Peach State Lumber, Kennesaw GA (about 25 mi NW of Atlanta), FAS white oak, rough, plus tax';
const PEACH_STATE_CHECK = 'The sheet is headed "Hardwoods LEVEL 2" (printed 9/9/2026, "last updated 8/5"): ask whether that is the walk-in retail tier, and whether the boards are kiln dried (the sheet does not say). Call (770) 428-3622';
/**
 * White oak, $/board foot on nominal thickness (D-79). 4/4, 5/4 and 8/4: Peach State Lumber's FAS list [F, 2026-10-14]. 4/4, 5/4 and 8/4 are BOUGHT (`OAK_STOCKED`, D-95); the 6/4 and 12/4 prices
 * show what the face-laminated parts would cost if those boards were bought, and keep the lamination planner's cost comparison honest.
 */
export const OAK_PRICE_PER_BF: Record<string, Price> = {
  '4/4': foundCP(8.25, 'bf', PEACH_STATE, PEACH_STATE_LUMBER_URL, `white oak 4/4 FAS. ${PEACH_STATE_CHECK}`),
  '5/4': foundCP(10, 'bf', PEACH_STATE, PEACH_STATE_LUMBER_URL, `white oak 5/4 FAS (Wood Vendors, 100+ bf, rough kiln dried, delivered extra, $10.20: ${WOOD_VENDORS_URL}). ${PEACH_STATE_CHECK}`),
  '6/4': foundCP(10.5, 'bf', 'Wood Vendors (online, ship-from not stated)', WOOD_VENDORS_URL, '6/4 white oak, 84-100% clear, rough kiln dried, random widths, 100 bf minimum, freight extra. NOT BOUGHT: there is no Atlanta source of 6/4 (Peach State has none), so the 6/4 parts are face-laminated from 4/4 and 5/4. Hickory & Oak (Michigan) lists 6/4 Select & Better at $8.50, freight unknown'),
  '8/4': foundCP(12.5, 'bf', PEACH_STATE, PEACH_STATE_LUMBER_URL, `white oak 8/4 FAS, bought for the solid blocks up to 1-3/4" (D-95; the $15.00 at The Wood Yard is the other Atlanta yard). ${PEACH_STATE_CHECK}`),
  '12/4': quoted(25, 'bf', WOODYARD, 'white oak 12/4: NOT BOUGHT. The four parts that needed it are face-laminated from 4/4; this price only shows what the laminating saves', WOODYARD_URL),
  '16/4': est(32, 'bf', HARDWOOD, 'special-order'),
};

/**
 * Alternative oak prices (quoted, published): The Wood Yard, the other Atlanta yard (Eric, 2026-10-12): 4/4 and 8/4 only, no 5/4 or 6/4. Dearer than Peach State; shown next to the base price.
 * Cline Lumber (Jan 2023) is not used: its list is stale.
 */
export const OAK_ALT_PRICE_PER_BF: Record<string, Price> = {
  '4/4': quoted(10, 'bf', 'The Wood Yard (local)', 'white oak 4/4 (their knotty 4/4 "CG" is $7.50: not for the bent strips or the structural members). Dearer than Peach State, but the yard Eric knows', WOODYARD_URL),
  '8/4': quoted(15, 'bf', 'The Wood Yard (local)', 'white oak 8/4', WOODYARD_URL),
};

/**
 * The oak thicknesses the board plan may buy (D-79). A thickness set false is skipped: its parts move up to the next stocked thickness (milled down) and the resaw strips are re-planned from what is stocked.
 * 4/4, 5/4 and 8/4 are bought (Peach State Lumber, Kennesaw: no 6/4 on its list; 8/4 gives the solid blocks up to 1-3/4" with no glue line, D-95, and the thicker parts are laminated from 4/4, D-70).
 * 12/4 is OFF (D-70): at $25/bf it is the dearest board. 16/4 is off: nothing needs it.
 */
export const OAK_STOCKED: Record<string, boolean> = { '4/4': true, '5/4': true, '6/4': false, '8/4': true, '12/4': false, '16/4': false };
export const isOakStocked = (nominal: string): boolean => OAK_STOCKED[nominal] !== false;

/**
 * Plywood, full 4 x 8 sheets. The key of the THIN sheet is its `ThinSheet.priceKey` (D-80: 'baltic-6mm', 'okoume-6mm', 'white-oak-1/4', 'baltic-3mm'); the 12 mm deck sheet is keyed '12 mm'.
 * The BOM prices the thin-sheet line by the priceKey of the sheet in effect, never by its thickness class.
 */
export const PLYWOOD_PRICE: Record<string, Price> = {
  'baltic-6mm': foundCP(49, 'sheet', 'Peach State Lumber, Kennesaw GA, plus tax', PEACH_STATE_PLYWOOD_URL, '4 x 8 ft x 6 mm (1/4") Baltic birch from the plywood list ("last updated 8/9"; the list gives no ply count and no glue type): the Standard thin sheet (sides, box, lid, signs). Count the plies at an edge (5 expected; the side-web margin assumes 5-ply), measure 6.0 to 6.5 mm, and ask the glue (probably interior, fine garage-kept once sealed). Toledo Plywood lists 4 x 8 BB/BB at $34.95 with exterior glue but delivers only within 80 miles'),
  'okoume-6mm': withAlts(
    foundCP(158.65, 'sheet', 'Aircraft Spruce, Peachtree City GA (will-call), plus tax', AIRCRAFT_SPRUCE_OKOUME_URL, '4 x 8 ft x 6 mm okoume, 5 ply (02-00076): the Extreme thin sheet (sides, box, lid, signs); BS 1088 glue'),
    [foundCP(98, 'sheet', 'Boulter Plywood', BOULTER_URL, '6 mm okoume BS 1088, 5 ply, 4 x 8 ft; freight extra and the page is undated (call 888-958-6237). $145.08 at Boat Builder Central is the next verifiable price')]),
  // A 4 mm okoume sheet (the old D-60 thin sheet; panelPlyIn 0.157): the BOM uses this key when the okoume option is thinner than 6 mm. It failed the side-web row (D-80) but stays a choice.
  'okoume-4mm': foundCP(121.75, 'sheet', 'Aircraft Spruce, Peachtree City GA (will-call), plus tax', AIRCRAFT_SPRUCE_OKOUME_URL, '4 x 8 ft x 4 mm okoume, 3 ply (02-20100); BS 1088 glue. Boulter lists 4 mm at $70', false),
  'white-oak-1/4': withAlts(
    quoted(113, 'sheet', WOODYARD, '4 x 8 ft x 1/4" white oak plywood (about 5.3 mm; interior / Type II glue, fine garage-kept once sealed; MEASURE the sheet); the sides, box, lid and signs if chosen', WOODYARD_PLYWOOD_URL),
    [foundCP(75, 'sheet', 'Peach State Lumber, Kennesaw GA', PEACH_STATE_PLYWOOD_URL, '1/4" B-2 white oak veneer-core plywood, 4 x 8 ft (the veneer grade is lower: look at the face before buying)')]),
  'baltic-3mm': quoted(40, 'sheet', WOODYARD, '5 x 5 ft x 1/8" (3 mm) Baltic birch plywood (exterior glue); the sides, box, lid and signs if chosen. Every part must nest on a 60 x 60 in sheet', WOODYARD_PLYWOOD_URL),
  '12 mm': quoted(90, 'sheet', WOODYARD, '4 x 8 ft x 1/2" marine plywood; the deck and, from its offcut, the seat back. VERIFY the species is okoume: meranti marine ply is about 30% heavier (+3 lb on the deck). May be sourced elsewhere: ask Peach State or Randall Brothers (Atlanta) for 12 mm okoume BS 1088 (Boulter lists it at $150, 9 ply)', WOODYARD_PLYWOOD_URL),
};

// ── Metal stock ($/ft, cut to length) ─────────────────────────────────────────

const METAL = 'McMaster-Carr-class supplier, cut to length';
const SPEEDY = 'Speedy Metals';
const ONLINE_METALS = 'Online Metals';
/**
 * Matched against the cut-list section text, first match wins. A researched bar or tube is bought as the fixed piece the vendor sells (`packQty` in ft, `packLabel`), so the line
 * is the pieces to buy, not feet; an estimate is per foot of cut length.
 */
export const METAL_PRICE_PER_FT: Array<{ match: RegExp; price: Price; /** The Standard spec's 304 price, where the cost-pass research read one (else the 316 price x STD_304_FACTOR, an estimate). */ std?: Price }> = [
  { match: /solid 1045/, price: { ...foundPackCP(5, 34.04, 'ft', SPEEDY, 'https://www.speedymetals.com/p-1651-x.aspx', '5/8" 1045 cold-finished steel round, 60 in fixed length (the cuts need 57 in plus kerfs; the tolerance is +/-3/4 in, so the piece is at least 59-1/4 in). The turned-ground-polished version is $34.36 (p-1620). Ask for the 1045 mill cert (yield 70 ksi or better), NOT hot-rolled A36 and NOT 1018 cold-drawn ($23.46, about 54 ksi)', false, '60 in piece'), decision: 'Axle rod: buy 5/8" 1045 cold-finished or TGP rod (70 ksi or better, 60 in), not 1018 cold-drawn (about 54 ksi, which takes the 200 lb goal axle-stress to about 1.0) and not hot-rolled A36.' } },
  { match: /DOM tube/, price: withAlts(
    { ...packed(5, 45.45, 'ft', SPEEDY, `ESTIMATE: 5/8" OD x 0.120" wall DOM (A513 Type 5, ID 0.385"), 60 in piece; the cuts need 57 in plus kerfs. Speedy Metals does not list 0.120" in 5/8" OD (it lists 0.109" at 45.45 for 60 in, 0.035", 0.049", 0.065" and 0.188"), so this is that 60 in price as a stand-in. Online Metals lists 5/8" x 0.12" x 0.39" ID A513 Type 5 DOM (part 7763) and McMaster-Carr lists it too (1020 DOM, 55 ksi yield, check it against the 70 ksi the model assumes): quote one. DOM only: ask for the A513 Type 5 mill cert [${RESEARCH_DATE}]`), packLabel: '60 in piece' },
    [gap({ ...packed(5, 45.45, 'ft', SPEEDY, `5/8" OD x .407" ID x .109" wall DOM steel round tube (Speedy Metals p-3421, read ${RESEARCH_DATE}; not in the research file, so an estimate until quoted), 60 in length; 36 in is 33.33, 48 in 40.00`), packLabel: '60 in piece' }, '0.109" wall, not 0.120": the rear axle-stress row would be about 1.0 (marginal-to-fail) at the 200 lb goal rider')]) },
  { match: /flat bar 1\/8" x 1-1\/4"/, price: notFound(withAlts(est(7.3, 'ft', METAL, 'ESTIMATE: 316 stainless flat bar 1/8" x 1-1/4" (not read; the 1/8" x 1" is $0.49 an inch at Speedy Metals, and 1-1/4" is 1.25 times that); a 7 in piece cut from a 12 in bar. D-84: 1/8" is the thinnest 316 flat bar sold, which is why the grab-board strip is 1/8" thick'), [
    gap(foundPackCP(1.5, 11.32, 'ft', SPEEDY, 'https://www.speedymetals.com/p-2538-18-x-1-316-stainless-steel-annealed-pickled.aspx', '1/8" x 1" 316 stainless flat, annealed and pickled: $0.49 an inch by the inch (13 in $6.37), 18 in piece $11.32; the strip needs 1-1/4" wide, so this is a stand-in', false, '18 in piece'), 'the bar is 1" wide, not 1-1/4"'),
  ])), std: notFound(withAlts(est(6.2, 'ft', METAL, 'ESTIMATE (Standard spec): 304 stainless flat bar 1/8" x 1-1/4", priced like the 304 1/8" x 1" ($0.41 an inch at Speedy Metals) plus a quarter for the extra width'), [
    gap(foundCP(4.92, 'ft', SPEEDY, 'https://www.speedymetals.com/p-1713-x.aspx', '304 flat bar 1/8" x 1", annealed and pickled, by the inch: $0.41 an inch (13 in $5.33, 12 in $7.40); 1" wide, not 1-1/4"'), 'the bar is 1" wide, not 1-1/4"'),
  ])) },
  { match: /flat bar 1\/8" x 2"/, price: foundCP(11.64, 'ft', SPEEDY, 'https://www.speedymetals.com/p-2540-x.aspx', '316 stainless flat bar 1/8" x 2", annealed and pickled, by the inch: $0.97 an inch (13 in $12.61; fixed 12 in $17.44, 24 in $26.16). The two brake backing plates (2-1/2" each) and the two pivot straps (3-5/16" each) are 11-5/8" of bar plus kerfs. Online Metals 316 12 in is $13.34'),
    std: foundPackCP(13 / 12, 9.23, 'ft', SPEEDY, 'https://www.speedymetals.com/p-1717-x.aspx', '304 stainless flat bar 1/8" x 2", annealed and pickled, by the inch: $0.71 an inch, so 13 in is $9.23 (fixed 12 in $12.74). Online Metals 304 12 in is $8.14 if 12 in is enough', false, '13 in piece') },
  { match: /flat bar 1\/4" x (?:1-3\/4|2)"/, price: foundCP(23.28, 'ft', SPEEDY, 'https://www.speedymetals.com/p-2547-x.aspx', '316 stainless flat bar 1/4" x 2", annealed and pickled, by the inch: $1.94 an inch (15 in $29.10; fixed 12 in $34.86, 24 in $52.29). The model asks for the 2" width when the clamp plates are 1/4 x 2 (D-83); 1-3/4" is not stocked at Speedy (Online Metals 316 1/4 x 1-3/4 12 in is $31.18)'),
    std: foundPackCP(15 / 12, 19.95, 'ft', SPEEDY, 'https://www.speedymetals.com/p-1732-x.aspx', '304 stainless flat bar 1/4" x 2", annealed and pickled, by the inch: $1.33 an inch, so 15 in is $19.95 (fixed 12 in $23.89, 18 in $30.71). Six 2-1/4" plates and five kerfs are 14-1/8", so order 15 in. 1/4 x 1-3/4 exists only at Online Metals (12 in $18.93)', false, '15 in piece') },
  { match: /flat bar 1\/4" x 1-1\/2/, price: foundPack(1, 27.06, 'ft', SPEEDY, 'https://www.speedymetals.com/pc-2546-8259-14-x-1-12-316-stainless-steel-annealed-pickled.aspx', '1/4" x 1-1/2" 316 stainless flat, annealed and pickled, 12 in piece (4 x 2.25 in plus kerf); 18 in is 34.79', false, '12 in piece') },
  { match: /angle/, price: foundPackCP(1, 20.09, 'ft', ONLINE_METALS, 'https://www.onlinemetals.com/buy/x/pid/2162', '1-1/2" x 1-1/2" x 1/8" stainless angle 316/316L (pid 2162), 12 in cut (was $19.83; 24 in is $39.09)', false, '12 in cut'),
    std: foundPackCP(5 / 12, 7.75, 'ft', SPEEDY, 'https://www.speedymetals.com/p-1693-x.aspx', '304 stainless angle 1/8" x 1-1/2" x 1-1/2", annealed and pickled, by the inch: $1.55 an inch, so 5 in is $7.75 (12 in $17.15). Online Metals does not stock 304 in this size', false, '5 in piece') },
  { match: /aluminum|rectangular tube/i, price: foundPackCP(3, 29.24, 'ft', ONLINE_METALS, 'https://www.onlinemetals.com/buy/x/pid/14469', '1" x 1-1/2" x 0.125" 6061-T6 rectangle tube (pid 14469), 36 in piece ($21.39 for 24 in is too short; 48 in $36.54); the stock wall is 0.125", the model says 0.130" (not a stock wall). Speedy Metals lists 6063-T52 at $18.90 for 30 in, which is weaker (about 21 ksi yield against 40): not the same tube', false, '36 in piece') },
];
/** Allowance added to every metal cut for the saw kerf and the squared end (in). */
export const METAL_CUT_ALLOWANCE_IN = 0.25;

// ── Purchased parts, by partNo ────────────────────────────────────────────────

const MCM = 'Catalog supplier (McMaster-Carr class)';
const BOLT_DEPOT = 'Bolt Depot';
const BD_PRODUCT = 'https://boltdepot.com/Product-Details?product=';
const BD_EYE_URL = 'https://boltdepot.com/Forged_eye_bolts_(w__nuts)_Hot_dipped_galvanized_steel_3_8-16';
const BD_EYE_316_URL = 'https://boltdepot.com/Forged_eye_bolts_with_shoulder_(w__nuts)_Stainless_steel_316_3_8-16';
const EYE_DECISION = 'Eye bolts: stock 3/8-16 shoulder eye bolts, 4-1/2" for the axle beam and 2-1/2" for the chain crossmember. Checked against the stack: the beam bolt needs 3.16" under the shoulder (2-1/2" beam + washer + nylock nut + 1.5 threads), so the 4-1/2" is cut to 3-1/4" after fitting (it would stand 1.4" past the nut); the crossmember bolt needs 1.97", so 2-1/2" is cut to 2" (or left, 0.6" of thread). Neither fouls the wheel, the chain or the tongue. The Standard weather spec (garage-kept) uses galvanized; the Extreme spec (stored outside or near salt) uses 316, which is 4x the price (about $200 for four against $46).';
/** The two eye-bolt prices, hot-dip galvanized (Standard base) and 316 (Extreme base): Bolt Depot, forged shoulder eye bolts with nuts, 3/8-16. */
const EYE_GALV = {
  steerEye: found(11.94, 'ea', BOLT_DEPOT, BD_EYE_URL, 'forged shoulder eye bolt with nut, hot-dip galvanized, 3/8-16 x 4-1/2" stock (the stack needs 3.16" under the shoulder, so cut it to 3-1/4" after fitting; Bolt Depot measures from under the shoulder)', true),
  steerAnchor: found(11.1, 'ea', BOLT_DEPOT, BD_EYE_URL, 'forged shoulder eye bolt with nut, hot-dip galvanized, 3/8-16 x 2-1/2" stock (the stack needs 1.97" under the shoulder; optionally cut to 2")', true),
};
const EYE_316 = {
  steerEye: found(50.77, 'ea', BOLT_DEPOT, BD_EYE_316_URL, '316 forged shoulder eye bolt with nut, 3/8-16 x 4-1/2" stock (the stack needs 3.16" under the shoulder, so cut it to 3-1/4" after fitting): 4x the galvanized price', true),
  steerAnchor: found(48.43, 'ea', BOLT_DEPOT, BD_EYE_316_URL, '316 forged shoulder eye bolt with nut, 3/8-16 x 2-1/2" stock (the stack needs 1.97" under the shoulder; optionally cut to 2"): 4x the galvanized price', true),
};
const WHEEL_DECISION = 'Wheel: the Harbor Freight 10" pneumatic with black hub, $9.99, 5/8" bore, 300 lb, about 3 lb; the axles are 5/8" to match. Its hub length is not listed (the model assumes 2-1/4", as on the Uline and Martin wheels): buy one first and measure the hub, the bore and the squash. The steel-hub version is $11.99.';
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
    found(9.99, 'ea', 'Harbor Freight', 'https://www.harborfreight.com/10-inch-x-3-1-2-half-inch-pneumatic-tire-67465.html', 'HAUL-MASTER 10" pneumatic tire with black hub (SKU 67465), 5/8" bore, 300 lb, about 3 lb, 3-1/2" wide, 30 psi; hub length not listed (the model assumes 2-1/4"). VERIFY the hub length, bore and rating on the real wheel'),
    [
      found(11.99, 'ea', 'Harbor Freight', 'https://www.harborfreight.com/heavy-duty-10-inch-groove-tread-tire-40729.html', 'HAUL-MASTER 10" pneumatic tire with steel hub (SKU 40729), 5/8" bore, 300 lb, 3.10 lb shipping; hub length not listed. The sturdier hub, +$2 a wheel (+$8 for four)'),
      gap(found(34, 'ea', 'Uline', 'https://www.uline.com/Product/Detail/H-5454/Casters-and-Wheels/Uline-Flat-Free-Pneumatic-Wheel-300-lb-Capacity-10', 'Uline H-5454 flat-free pneumatic wheel 10 x 3-1/2", 5/8" bore, 2-1/4" steel offset hub (the hub length is listed), 300 lb, 3.41 lb'), 'flat-free: a stiffer tire than the 30 psi pneumatic tire the design assumes, and 0.4 lb a wheel heavier; $24 more a wheel'),
    ], WHEEL_DECISION) },
  { match: /^king-thrust$/, price: found(15.88, 'ea', 'eBay seller (Florida)', 'https://www.ebay.com/itm/143055583417', 'natural UHMW 1/2" sheet, 6" x 12" option (a 3" disc is cut from it); the listing may price one size only', true) },
  { match: /^kingpin$/, price: est(3.85, 'ea', BOLT_DEPOT, 'ESTIMATE: 5/8" kingpin set: 5/8-11 x 4 hex bolt, zinc grade 8 yellow, about $3.10 (not read; the x 6 is $4.14, #678) + 5/8-11 zinc thin nylon-insert lock nut (jam nylock), about $0.60 (not read; the full-height one is $0.56, #2628) + 1 SAE flat washer $0.15 (#4273; none under the nut, D-88) = $3.85. D-88: the bolt is ordered from its stack, 4" (a 6" one hit the deck); the thin nut keeps the slot 3/4" tall') },
  { match: /^roll-pad$/, price: notFound(est(2, 'ea', MCM, 'UHMW 1/4" sheet offcut (no US price found, only an import listing at about $44 before duty)')) },
  { match: /^bridle-sleeve$/, price: foundCP(13.59, 'ea', 'Zoro (Bunting EBCB101612)', 'https://www.zoro.com/bunting-bearings-sleeve-bearing-58-id-1-od-1-12l-ebcb101612/i/G5910390/', 'cast bronze sleeve bearing 5/8" ID x 1" OD x 1-1/2" (plain cast bronze, not the oil-embedded SAE 841 the model names: that size is not priced online, McMaster-Carr hides it; the cast sleeve is fine for a bridle that turns slowly, oil it)', true) },
  // Extreme weather: 316 eye bolts are the base; the galvanized ones are the Standard spec's base (PURCHASED_PRICE_STANDARD) and the cheaper alternative here.
  { match: /^steer-eye$/, price: withAlts(EYE_316.steerEye, [gap(EYE_GALV.steerEye, 'hot-dip galvanized, not 316: right for the Standard weather spec (garage-kept), rusts and stains oak near salt')], EYE_DECISION) },
  { match: /^steer-anchor$/, price: withAlts(EYE_316.steerAnchor, [gap(EYE_GALV.steerAnchor, 'hot-dip galvanized, not 316: right for the Standard weather spec (garage-kept), rusts and stains oak near salt')], EYE_DECISION) },
  { match: /^steer-chain$/, price: found(Math.round(((CHAIN_CUT_IN / 12) * CHAIN_USD_PER_FT + 2 * QUICK_LINK_USD) * 100) / 100, 'ea', 'ACE Industries / Skydog Rigging', 'https://www.aceindustries.com/3-16-nacm-industrial-chain-316l-stainless-steel',
    `3/16" NACM industrial chain 316L at $${CHAIN_USD_PER_FT}/ft (${CHAIN_CUT_IN} in) plus two 3/16" 316 quick links at $${QUICK_LINK_USD} each (Skydog, WLL 800 lb). Grade 43 is not made in 3/16": NACM chain has a looser rating, so check the working load against the 1000 lb target`, true) },
  { match: /^bridle$/, price: found(6.49, 'ea', 'Hamilton Marine', 'https://shop.hamiltonmarine.com/products/commercial-3-strand-nylon-rope--foot-or-reel--42842.html', '11 ft of commercial 3-strand nylon rope, 3/8", at $0.59/ft', true) },
  // Extreme only (D-83): the Standard spec drills epoxy-lined holes instead. The $5.20 estimate was not supported: real nipples run $9 to $13 each.
  { match: /^(scupper|storage-drain)$/, override: true, price: withAlts(
    foundCP(9.12, 'ea', 'Titan Fittings', 'https://titanfittings.com/3-8-hose-x-3-8-npt-male-pipe-rigid-stainless-hose-barb', '3/8" hose x 3/8" NPT male rigid barb, 316 stainless', true),
    [gap(foundCP(12.73, 'ea', 'Nassau National Cable', 'https://nassaunationalcable.com/products/3-8-in-hose-barb-3-8-in-male-npt-304-stainless-steel-hose-nipple-mip-adapt-73952', '3/8" hose barb x 3/8" male NPT, 304 stainless (G.W. Kent 304L $12.95, $10.36 at 10)', true), '304, not 316'),
     est(0, 'ea', 'Drilled hole', 'A drilled 3/8" hole with the bore sealed in epoxy costs nothing: it is what the Standard spec does (D-83). The nipple keeps a hose-barb fitting and a metal-lined outlet')]) },
  { match: /^seat-hinge$/, override: true, price: found(13.545, 'ea', 'Freeport Marine', 'https://www.freeportmarine.com/products/seachoice-2-316-stainless-steel-butt-hinges.oembed', 'Seachoice 33911 2" x 2" 316 stainless butt hinges, $27.09 a pair (one pair is the pack), shown as half each', true) },
  { match: /^storage-gasket/, override: true, price: found(13.185, 'ea', 'Walmart (Trim-Lok)', 'https://www.walmart.com/ip/873339043', 'Trim-Lok X110HT EPDM seal 3/8" x 3/4", 25 ft roll $52.74 (about $2.11/ft); one roll covers all four gasket lines, shown as a quarter each. Check the profile and the length against the lid frame', true) },
  // D-79 research: neoprene 3/8" is sold as sheet (Zoro 70A 6 x 12 in, $15.59 [S]); 6 x 12 in cuts four 3 x 3 in pads, so the two brake pads take one sheet.
  { match: /^brake-pad$/, price: { ...foundPackCP(4, 15.59, 'ea', 'Zoro', 'https://www.zoro.com/i/G7797929/', 'high-strength neoprene sheet 70A, 3/8" x 6" x 12" (cuts four 3" x 3" pads; two are used, the rest is spare); the old $4 a pad was an estimate. SBR 3/8" 12 x 36 is $30.94 at Home Depot', true, '6 x 12 in sheet'), perPart: 1 } },
  // The cords are cut from a roll: whole rolls priced, `perPart` in ft from the model's vendor text (bungee 10.99 in; chock cord 30 in).
  // D-79: the bungee is bought by the foot (a short length, not a 100 ft roll); the stop cord and the wheel-chock cords are paracord from the shop (NOTE_ITEMS 'brake-stop-cord' and the entry below).
  { match: /^brake-cord$/, override: true, price: { ...foundCP(0.19, 'ft', 'Knot & Rope Supply', 'https://www.knotandrope.com/products/1-4-shock-cord-500-spool', '1/4" shock cord, white or black, sold by the foot ($0.19/ft; shipping extra, so batch it with another order; Home Depot T-W Evans 100 ft is $18.60). The 10.99 in bungee is under a foot a side: buy 2 ft for both'), perPart: 10.99 / 12 } },
  { match: /^brake-chock-cord$/, override: true, price: owned('ea', 'paracord for the 30 in wheel-chock cords (a 100 ft roll was priced at $34)') },
  // D-89 (round 2): the brake stop cord is a short paracord down-tie from the flap eye to a low eye on the transom, cut from the troop's paracord.
  { match: /^brake-stop-cord$/, override: true, price: owned('ea', 'paracord for the brake stop cords (3/16 in, about 6 in each with the knots)') },
  { match: /^handle-pin$/, price: est(5, 'ea', MCM, 'clevis pin and lynch pin') },
  { match: /^(lamp-clip|rear-lamp-clip)$/, price: notFound(est(3, 'ea', 'Printed in-house (ASA)', 'about 0.2 lb of filament, no support (no US price for ASA filament found, only UK/EU listings)')) },
  { match: /^front-light$/, override: true, price: withAlts(
    foundCP(41.95, 'ea', 'Bicycle Warehouse', 'https://bicyclewarehouse.com/products/recon-600-led-usb-bike-headlight', 'Giant Recon 600 LED USB headlight (600/300/150 lm, 1600 mAh, 87 g); 600 lm is plenty at walking pace. The clip that holds it is printed to the light: re-measure it'),
    [foundCP(58.95, 'ea', 'Modern Bike', 'https://www.modernbike.com/cygolite-metro-plus-800-rechargeable-headlight', 'Cygolite Metro Plus 800 (800 lm; $73.95 at Bicycle Warehouse), the light the model was first sized for', true)]) },
  { match: /^rear-light$/, override: true, price: withAlts(
    foundCP(21.99, 'ea', 'Bicycle Warehouse', 'https://bicyclewarehouse.com/products/planet-bike-spok-usb-taillight', 'Planet Bike Spok USB tail light (lumens not stated on the page); re-measure the printed clip'),
    [foundCP(44.95, 'ea', 'Cahaba Cycles', 'https://www.cahabacycles.com/products/cygolite-hotshot-pro-200c-usb-light-rear-black', 'Cygolite Hotshot Pro 200C USB rear light (brighter)', true)]) },
  // D-83: the seat pads are Harbor Freight EVA kneeling pads, $7.99 each; the cushion is two pads (edge-glued), the back one.
  { match: /^seat-cushion$/, override: true, price: foundCP(15.98, 'ea', 'Harbor Freight', 'https://www.harborfreight.com/foam-kneeling-pad-56572.html', 'two Foam Kneeling Pads #56572 (EVA, 11 x 18 x 1-1/2 in., about 1 lb each) at $7.99: the cushion is two pads edge-glued, closed-cell so it sheds rain; no vinyl cover. Check the pad size before ordering') },
  { match: /^seat-back-pad$/, override: true, price: foundCP(7.99, 'ea', 'Harbor Freight', 'https://www.harborfreight.com/foam-kneeling-pad-56572.html', 'one Foam Kneeling Pad #56572 (EVA, 11 x 18 x 1-1/2 in.) for the back pad, trimmed to size') },
  // D-83: lash points. Standard = Harbor Freight 1/4 in cargo D-rings, bought by the 2-pack (233 lb working load, 700 lb break); Extreme = 316 (PURCHASED_PRICE below).
  { match: /^lash-point$/, override: true, price: withAlts(
    est(8, 'ea', 'Marine hardware dealer', 'ESTIMATE; no source; rating unverified: a 316 stainless bolt-on D-ring with a 2-hole bracket, about 1-1/4 in ring, for the Extreme spec (D-83). A 316 ring of this kind was not priced in the cost-pass research; Fasteners Plus lists a 1 in 316 bolt-on D-ring at $2.99 with an 800 lb break'),
    [gap(foundCP(2.99, 'ea', 'Fasteners Plus / US Cargo Control', 'https://www.fastenersplus.com/products/1-bolt-on-d-ring-with-mounting-bracket-316-stainless-800-lbs-bs', '1" 316 bolt-on D-ring with bracket, 2-hole, 800 lb break (a 2-5/16" ring with a 6000 lb break is 8.89)', true), 'an 800 lb break is about a 270 lb working load, marginal against 300 lbf')]) },
];
export const PURCHASED_FALLBACK: Price = est(5, 'ea', 'No entry in prices.ts', 'UNPRICED: add the part to PURCHASED_PRICE');

/**
 * Purchased parts whose model cost (`sourcing.costUsd`) stays the price because the research found no price that meets the spec: the note (research result) and the
 * alternatives (spec gaps, shown in the BOM line notes) are added to the line. Matched on partNo.
 */
export interface ModelCostNote { match: RegExp; note: string; alternatives?: Price[]; /** The model's cost has no source behind it: the BOM line is an estimate, not a quote. */ estimate?: boolean }
export const PURCHASED_MODEL_COST_NOTE: ModelCostNote[] = [
  // No source behind these two model costs: estimates until a quote is read.
  { match: /^brake-foot-tread$/, estimate: true, note: 'ESTIMATE, no source: the model\'s $3 a tread for a ribbed rubber stair-tread or neoprene sheet offcut; not in any price research' },
  { match: /^storage-bumper$/, estimate: true, note: 'ESTIMATE, no source: the model\'s $2 a bumper, half of a hardware-store pack of clear 1/2" self-stick rubber bumpers (about $4; check one is about 1/8" tall, the two hinge leaves folded together); not in any price research' },
  { match: /^chain-keeper-cord$/, estimate: true, note: 'ESTIMATE, no source: the model\'s $0.15 a side for about 6" of 1/8" shock cord (a V through the screw eye, knotted to two chain links), cut from a foot bought at a hardware store (about $0.20 to $0.30 a foot; the 1/4" brake bungee cord is too stiff for this); not in any price research. The screw eyes are on the fastener lines' },
  { match: /^flag-tube$/, estimate: true, note: 'ESTIMATE, no source: the model\'s $4 for a 1" schedule 40 PVC tube cut to length (a 10 ft stick of 1" PVC is the usual sale; ask for a cut piece); not in any price research' },
  { match: /^storage-hinge$/, note: `ESTIMATE, model cost: the 2-1/2" x 1-1/2" (open, 3/4" leaves, D-89) 316 hinge was not found in the ${RESEARCH_DATE} research`, alternatives: [
    gap(found(13.545, 'ea', 'Freeport Marine', 'https://www.freeportmarine.com/products/seachoice-2-316-stainless-steel-butt-hinges.oembed', 'Seachoice 33911 2" x 2" 316 butt hinges, $27.09 a pair, shown as half each', true), 'the hinge is 2" x 2" (1" leaves), not 2-1/2" x 1-1/2": its leaf is wider than the 3/4" lid frame end it lies on (D-89)')] },
  { match: /^seat-pin$/, note: `model cost kept: no 3/8" x 1-1/2" detent pin found in the ${RESEARCH_DATE} research (Whitecap S-1024C is $69.99, 304, diameter not stated, likely the wrong part)` },
  { match: /^brake-snap$/, note: 'model cost kept: no 1-1/4" 316 snap hook found', alternatives: [
    gap(found(2.7, 'ea', 'Sailrite', 'https://www.sailrite.com/Fixed-Eye-Snap-Clip-2-Stainless-Steel', 'Fixed Eye Snap Clip 2", 316, 485 lb (Sea-Dog 2-3/8" is 7.14)', true), 'the snap hook is 2", not about 1-1/4"')] },
  { match: /^brake-pivot-pin$/, note: `model cost kept: no 3/8" 316 clevis pin found in the ${RESEARCH_DATE} research` },
  { match: /^brake-pivot-clip$/, note: 'model cost kept: no 316 hitch-pin clip found', alternatives: [
    gap(foundPack(25, 13.43, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Product-Details?product=27209', 'hitch pin clip, 0.093" wire, for 3/8" to 5/8" pins (27209), $0.82 each, 13.43 per 25 (124 per 250)', true), '18-8 stainless, not 316')] },
  { match: /^reflector$/, note: 'model cost kept: no 2" x 1" adhesive prismatic reflector found', alternatives: [
    gap(foundPack(4, 3.95, 'ea', 'Skycraft Surplus', 'https://skycraftsurplus.com/products/optronics-re10arfk-reflector-kit-4-pack.html', 'Optronics RE10ARFK reflector kit, 4 pack (2 red, 2 amber), FMVSS/DOT; a 2-round red/amber set is $11.05 at Walmart', true, 'pack of 4'), 'the reflectors are 3-3/16" x 1-7/16", bigger than 2" x 1", and C2 is not stated')] },
];
export const modelCostNote = (partNo: string, spec: SpecName = 'extreme'): ModelCostNote | undefined =>
  (spec === 'standard' ? PURCHASED_MODEL_COST_NOTE_STANDARD.find((r) => r.match.test(partNo)) : undefined) ?? PURCHASED_MODEL_COST_NOTE.find((r) => r.match.test(partNo));

// ── Fasteners (316 stainless unless noted), matched on the BOM label ──────────

const FAST = 'Fastener supplier (McMaster-Carr / Fastenal class), 316 stainless';
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
/** D-79: the Dominos are beech from the shop, in BOTH specs. Under the Extreme spec they are epoxied in (epoxy everywhere already), so no Sipo packs are bought (Festool makes no Sipo 4x20 anyway). */
const DOMINO_OWNED = owned('ea', 'beech Dominos (Festool DF 500, all sizes), from the shop; under the Extreme spec they are epoxied in, so the exterior Sipo type is not bought');
const DOMINO_OWNED_STANDARD = owned('ea', 'beech Dominos (Festool DF 500, all sizes), from shop stock');
export const FASTENER_PRICE: Array<{ match: RegExp; price: Price }> = [
  { match: /T-nut/i, price: found(0.9, 'ea', 'Albany County Fasteners', 'https://www.albanycountyfasteners.com/t-nuts-316-stainless-steel-14-20-6002-016-032', '316 stainless 4-prong T-nut, 1/4"-20, for the handle socket backers (epoxied in); $0.90 each for 1-99, $0.58 at 100+ (304 is $0.74)', true) },
  { match: /shaft collar/i, price: withAlts(
    foundCP(19.89, 'ea', 'Newegg (sold and shipped by Zoro)', 'https://www.newegg.com/p/0PS-00NR-00036', 'Climax CRC-062-S one-piece 316 stainless set-screw collar, 5/8" bore, 1-1/8" OD x 1/2" ($79.56 for four plus $5.00 shipping listed). The earlier estimate ($33.36) was the 3/4" bore. PartsSource lists the same collar at $26.29'),
    [gap(foundCP(4.52, 'ea', 'Penn Tool Co.', 'https://www.penntoolco.com/87986402', 'Climax C-062 one-piece set-screw collar, 5/8" bore, 1-1/8" OD x 1/2", zinc plated (the Standard weather spec); PartsSource GSC-062-Z zinc is $4.99 [S]'), 'zinc-plated steel, not 316 stainless (about $18 for four against $80): fine garage-kept, rusts in the weather')],
    'Wheel retainer collars (5/8" bore), Extreme weather: buy the 316 Climax CRC-062-S (Newegg/Zoro $19.89, plus shipping). Confirm the stainless grade on the listing (the Climax C-062-S at Walmart, $15.45, is probably 303). The Standard spec uses the zinc-plated collar ($4.52 each at Penn Tool).') },
  { match: /cotter pin/i, price: withAlts(foundPackCP(25, 21.19, 'ea', 'Zoro', 'https://www.zoro.com/i/G3426151/', '316 extended-prong cotter pin 5/32" x 1-1/2" (Zoro Select U55700.015.0150), 25-pack: the only 316 source found (Bolt Depot has no 316 cotter pin); only four are needed, keep the rest'), [
    gap(foundPack(100, 14.95, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Product-Details?product=14570', 'cotter pin 5/32" x 1-1/4" (14570), $0.21 each, 14.95 per 100 (5/32 x 1-3/4 is $0.28, 19.68 per 100)', true), '18-8 stainless, not 316, and 1-1/4" not 1-1/2" long; Bolt Depot has no 316 cotter pin')]) },
  { match: /end plug/i, price: packed(10, 5, 'ea', FAST, 'plastic flanged plug for the DOM tube bore; pack of 10') },
  { match: /button plug/i, price: foundPack(25, 4.55, 'ea', 'DigiKey (Keystone)', 'https://www.digikey.com.mx/en/products/detail/keystone-electronics/8604/317044', 'Keystone 8604 black nylon hole plug, 0.625", about $0.18 each at 25; pack of 25', true) },
  { match: /nylon washer/i, price: withEach(foundPackCP(100, 5.17, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Product-Details?product=15939', 'nylon 6/6 flat washer 1/4" (#15939) under the button head, $0.09 each or 5.17 per 100'), 0.09) },
  { match: /stainless rod/i, price: foundCP(2.275, 'ea', 'Speedy Metals', 'https://www.speedymetals.com/p-2616-x.aspx', '3/8" 316 stainless round, cold finished and annealed, by the inch ($0.91 an inch): 5 in ($4.55) cuts both 2-1/4" pins on the metal bandsaw') },
  // D-79: beech Dominos from the shop in both specs (the Sipo packs and the Sipo 4x20 decision are gone).
  { match: /^Domino/, price: DOMINO_OWNED },
  { match: /screw eye/, price: notFound(est(1.25, 'ea', FAST, '316 #10 screw eye (only long NZ screw eyes and eye nuts turned up)')) },
  { match: /Heat-set insert M3/, price: foundPackCP(50, 5.95, 'ea', 'Adafruit', 'https://www.adafruit.com/product/4255', 'brass heat-set inserts for plastic, M3 x 4 mm, pack of 50 (product 4255; the M3 x 3 mm is out of stock), for the printed ASA clips') },
  { match: /Heat-set insert M4/, price: foundPackCP(50, 11.99, 'ea', 'Prusa (CNC Kitchen design)', 'https://www.prusa3d.com/product/heat-set-inserts-m4-standard-50-pcs/', 'brass heat-set inserts M4 standard, pack of 50: the smallest M4 pack found, for the printed ASA clips') },
  { match: /Heat-set insert/, price: packed(50, 12, 'ea', FAST, 'brass heat-set insert for the printed ASA clips; pack of 50') },
  { match: /threaded insert/, price: notFound(packed(25, 22, 'ea', FAST, '316 epoxy-in insert; pack of 25 (E-Z Lok stainless kit $31.49 at Tractor Supply is titled 10-24; brass 25-pack $13.52 on eBay). The 2026-10-14 research found only #10-32 pronged T-nuts (Bolts and Nuts 18-8, $1.05 each), not a screw-in insert for hardwood; Bolt Depot\'s stainless hardwood insert is #10-24')) },
  { match: /button-head cap screw 1\/4-20/, price: found(1.05, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Socket_button_head_Stainless_steel_316_1_4-20', '316 socket button head cap screw 1/4-20 x 2" (21746), $1.05 each, 34.94 per 50; the x 1-1/4" length was not read separately', true) },
  { match: /Thumb-knob/, price: withAlts(notFound(est(2.75, 'ea', FAST, 'thumb-knob screw #10-32 for the thin-sheet web: no 316 one found (316 thumb screws are not made in #10-32 as far as the research could see)')), [
    gap(foundCP(1.6, 'ea', 'Bolts and Nuts', 'https://boltsandnuts.com/products/10-32x1-18-8-stainless-steel-thumb-screws', '#10-32 x 1" spade thumb screw, 18-8 stainless (3/4" $1.64, 1-1/2" $1.70; no 7/8" anywhere)'), '18-8, not 316, and a spade head rather than a knurled knob'),
     gap(found(2.38, 'ea', 'ichome (RAF)', 'https://ichome.com/product-detail/raf/7109-ss', 'RAF 7109-SS stainless knob screw #10-32 (Zoro 18-8 round thumb screw 3/4" is 5.69)', true), 'the length is 1/2", not the model\'s')]) },
  { match: /\bM[34]\b/, price: packed(100, 9, 'ea', FAST, 'metric socket or pan-head screw; pack of 100') },
  // D-76: the D-ring plate's #8-32 x 2" through-bolt sets (flat-head 316 sets; the 2026-10-14 research read all three at Bolt Depot).
  { match: /machine screw #8-32 x 2"/, price: foundCP(0.28, 'ea', BOLT_DEPOT, `${BD_PRODUCT}16902`, '316 Phillips flat-head machine screw #8-32 x 2" (#16902), $0.28 each (the pan head, #16819, is $0.37)') },
  { match: /fender washer #8/, price: foundCP(0.21, 'ea', BOLT_DEPOT, `${BD_PRODUCT}19564`, '316 fender washer #8 x 3/4" (#19564), $0.21 each') },
  { match: /lock nut #8-32/, price: foundCP(0.16, 'ea', BOLT_DEPOT, `${BD_PRODUCT}16005`, '316 hex nylon-insert lock nut #8-32 (#16005), $0.16 each (Bolts and Nuts $0.20)') },
  { match: /flat-head machine screw #10-32 x 3\/8"/, price: foundCP(0.12, 'ea', BOLT_DEPOT, `${BD_PRODUCT}16938`, '316 Phillips flat-head machine screw #10-32 x 3/8" (#16938), $0.12 each (Bolts and Nuts $0.18)') },
  { match: /machine screw/, price: packed(50, 11, 'ea', FAST, 'pack of 50') },
  // Wood screws: Bolt Depot 316 Phillips flat-head, by the 100 (the lengths the research read; the rest keep their estimate).
  { match: woodScrewLabel(8, '1/2'), price: bdScrew(BD_SCREW_8, 8, '1/2', 22.16, ' ($0.35 each)', 0.35) },
  { match: woodScrewLabel(8, '5/8'), price: bdScrew(BD_SCREW_8, 8, '5/8', 23.91, ' ($0.38 each)', 0.38) },
  { match: woodScrewLabel(8, '1'), price: bdScrew(BD_SCREW_8, 8, '1', 26.98, ' ($0.42 each)', 0.42) },
  { match: woodScrewLabel(8, '1-1/4'), price: bdScrew(BD_SCREW_8, 8, '1-1/4', 33.95, ' ($0.53 each)', 0.53) },
  // D-77: the four pan-head #8 x 1-1/4 screws of each brake pivot strap (8 in all). The research read the flat-head listing only; the pan head is priced the same until quoted.
  // D-91: the rail-to-chine screws are #8 x 2-1/2 TRIM-HEAD (a small head, so a 1/4" counterbore leaves wall at the hull's outside). Not in the research: an estimate, about the flat-head estimate.
  { match: /^316 trim-head wood screw #8 x 2-1\/2"$/, price: notFound(withEach(packed(100, 75, 'ea', FAST, 'ESTIMATE: 316 stainless trim-head wood screw #8 x 2-1/2" (square or Torx drive, about a 7/32" head), for the rail-to-chine tie; quote before ordering (trim heads are sold by deck and siding suppliers in 305 and 316)'), 0.75)) },
  { match: /^316 pan-head wood screw #8 x 1-1\/4"$/, price: notFound(withEach(packed(100, 33.95, 'ea', BOLT_DEPOT, 'ESTIMATE: 316 Phillips pan-head wood screw #8 x 1-1/4" for the brake pivot straps (the strap is not countersunk), priced as the flat-head screw of the same size ($33.95 per 100, $0.53 each); quote the pan head before ordering'), 0.53)) },
  { match: woodScrewLabel(10, '1'), price: bdScrew(BD_SCREW_10, 10, '1', 31.9, ' ($0.45 each)', 0.45) },
  { match: woodScrewLabel(10, '1-1/4'), price: bdScrew(BD_SCREW_10, 10, '1-1/4', 36.71, ' ($0.51 each)', 0.51) },
  { match: woodScrewLabel(10, '2'), price: bdScrew(BD_SCREW_10, 10, '2', 58.76, ' (two snapshots disagreed, $49.87 and $58.76: the higher is used)') },
  { match: woodScrewLabel(6, '3/8'), price: bdScrew(BD_SCREW_6, 6, '3/8', 18.17, ' ($0.25 each)', 0.25) },
  // D-82: the rail-to-chine and rib-knee screws are #8 x 2-1/2. No 316 #8 x 2-1/2 exists (316 stops at #8 x 2, $0.57, prod 16368): an estimate, 1/2" shorter than the design is the nearest real screw.
  { match: woodScrewLabel(8, '2-1/2'), price: notFound(withEach(packed(100, 70, 'ea', BOLT_DEPOT, 'ESTIMATE: 316 Phillips flat-head wood screw #8 x 2-1/2": not made. The nearest real screw is the #8 x 2" at $0.57 each (prod 16368, https://boltdepot.com/Product-Details?product=16368), 1/2" shorter than the design; this is that price plus a little'), 0.7)) },
  { match: /wood screw/, price: notFound(packed(50, 9, 'ea', FAST, `316 wood screw; pack of 50 per length (${NOT_LISTED})`)) },
  { match: /screw/, price: packed(50, 9, 'ea', FAST, 'pack of 50') },
  { match: /lock nut 5\/8/, price: packed(10, 14, 'ea', FAST, 'pack of 10') },
  { match: /lock nut 3\/8/, price: withEach(foundPack(50, 16.15, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Hex_nylon_insert_lock_nuts_Stainless_steel_316', '316 hex nylon-insert lock nut 3/8-16 (16010), $0.48 each or 16.15 per 50 ($0.32 each); pack of 50', true), 0.48) },
  { match: /lock nut 1\/4/, price: withEach(foundPack(100, 16.54, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Hex_nylon_insert_lock_nuts_Stainless_steel_316', '316 hex nylon-insert lock nut 1/4-20 (16008), $0.25 each or 16.54 per 100; pack of 100', true), 0.25) },
  { match: /lock nut/, price: packed(50, 18, 'ea', FAST, 'pack of 50') },
  { match: /narrow flat washer 3\/8/, price: withEach(packed(100, 30, 'ea', FAST, `ESTIMATE: 316 narrow flat washer 3/8" x 7/8" OD, under each brake-knee bolt head (not in the ${RESEARCH_DATE} research; the 3/8" x 1-1/2" fender washer is 0.81 each, a narrow one is about half); pack of 100`), 0.4) },
  { match: /fender washer 5\/8/, price: packed(25, 15, 'ea', FAST, 'pack of 25') },
  { match: /fender washer 3\/8/, price: withEach(foundPack(100, 50.48, 'ea', BOLT_DEPOT, 'https://www.boltdepot.com/Fender_washers_Stainless_steel_316.aspx', '316 fender washer 3/8" x 1-1/2" (16042), $0.81 each or 50.48 per 100; the 2" OD washers of the eye bolts were not searched; pack of 100', true), 0.81) },
  { match: /fender washer 1\/4/, price: withEach(foundPack(100, 27.26, 'ea', BOLT_DEPOT, 'https://www.boltdepot.com/Fender_washers_Stainless_steel_316.aspx', '316 fender washer 1/4" x 1-1/4" (16040), $0.46 each or 27.26 per 100; pack of 100', true), 0.46) },
  { match: /fender washer/, price: packed(100, 20, 'ea', FAST, 'pack of 100') },
  { match: /carriage bolt 3\/8/, price: { ...est(3.99, 'ea', BOLT_DEPOT, 'ESTIMATE: 316 carriage bolt 3/8-16 x 6-1/2". The research read the 6" bolt (18411, $3.68 each, 28.31 per 10); 6-1/2" is that price x 6.5/6 until quoted. 6-1/4" is not a stock length, and the 6" bolt stops 1/16" short of the top of the nylock nut on this stack', 'https://boltdepot.com/Product-Details?product=18411'), decision: CARRIAGE_DECISION } },
  { match: /hex bolt 3\/8-16 x 3-1\/4"/, price: found(1.94, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Hex_bolts_Stainless_steel_316_1_4-20', '316 hex bolt 3/8-16 x 3-1/4" (16136), $1.88 to $1.94 each (two snapshots; the higher is used), 74.65 per 50', true) },
  { match: /hex bolt 1\/4-20 x 2-1\/4"/, price: found(0.71, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Hex_bolts_Stainless_steel_316_1_4-20', '316 hex bolt 1/4-20 x 2-1/4" (16074), $0.71 each, 54.28 per 100', true) },
  { match: /hex bolt 3\/8-16 x 4"/, price: withEach(foundPackCP(50, 90.83, 'ea', BOLT_DEPOT, `${BD_PRODUCT}16139`, '316 hex bolt 3/8-16 x 4" (#16139), $2.36 each or 90.83 per 50 (Bolts and Nuts $4.22)'), 2.36) },
  { match: /hex bolt 1\/4-20 x 2-3\/4"/, price: foundCP(0.93, 'ea', BOLT_DEPOT, `${BD_PRODUCT}16076`, '316 hex bolt 1/4-20 x 2-3/4" (#16076), $0.93 each (Bolts and Nuts $1.41)') },
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
  // D-79: U.S. Composites fumed silica (Aerosil / Cab-O-Sil), a quart by volume. The 635 resin is thin, so every glue joint is thickened with it.
  silica: foundCP(4.6, 'qt', 'U.S. Composites', 'https://uscomposites.com/prices.html', 'Aerosil / Cab-O-Sil fumed silica, 1 quart (by volume; 2.5 qt is $6.95), for thickened glue and fillets. West 406 colloidal silica, 5.5 oz, is $41.82; TotalBoat silica thickener, 1 qt, is $14.99'),
  microballoons: found(40.1, 'ea', 'Fiberglass Supply', 'https://fiberglasssupply.com/epoxy/west-system/?page=5', 'West System 407-5 low-density filler, 4 oz, for fairing the sealed deck (the smallest 407 size; 410-7 Microlight 5 oz is 58.88)'),
};
/** Items that exist only as text in a note or a joint (see `NOTE_ITEMS` in bom.ts). */
export const NOTE_PRICE: Record<string, Price> = {
  // D-83: hook-and-loop for the EVA seat pads: Velcro Industrial 2" x 4 ft, $7.52 [S] (weaker in peel than Dual Lock at $19.99, and wears; fine for a 1 lb pad held in by the cushion shape).
  hookLoop: foundCP(7.52, 'pack', 'Blue Dog Ink', 'https://www.bluedogink.com/velcro-brand-industrial-strength-heavy-duty-fasteners-2-x-4-ft-white-90595.html', 'VELCRO Brand Industrial Strength 2" x 4 ft, white (90595), adhesive back. the seat needs four 12" strips of each half, 4 ft of each (OfficeCrave $8.02; Amazon $6.19 in February 2026)', true),
  // D-83: Band-It iron-on banding, 3/4" x 25 ft, $9.99 [S]; the listing is red oak: look for white oak, or use the red oak (it stains a little differently).
  edgeBanding: foundCP(9.99, 'roll', 'Ace Hardware (Band-It)', 'https://www.acehardware.com/p/5005152', 'Band-It pre-glued red oak edge banding, 3/4" x 25 ft (iron on, flush trim); white oak if the store has it', true),
  // D-79 and D-83: Life-Calk 1030, the 2.8 oz tube. The handle sockets are bedded in thickened epoxy now, so the tube covers the grab-board strips and the gasket splice.
  sealant: foundCP(15.69, 'ea', 'Powerboat Supply', 'https://powerboatsupply.com/boat-supplies-accessories/paint-maintenance/sealant-adhesive/caulks-sealants/boat-life-life-calk-tube-white-1030', 'BoatLIFE Life-Calk 1030 polysulfide marine sealant, 2.8 oz tube (Fisheries $16.42; the 10.6 oz cartridge is $27.00); polyurethane 3M 5200 is not polysulfide', true),
  contactCement: owned('ea', 'contact cement (brake pads and treads), already in the shop'),
  toolPouch: est(30, 'ea', 'Hardware store', 'a small tool pouch with a 3/8" drive ratchet, a 9/16" socket and a 9/16" combination wrench (a basic set; you may already own one)'),
  antiSeize: foundCP(3.97, 'ea', 'Walmart (Permatex 81343)', 'https://www.walmart.com/ip/19868891', 'Permatex anti-seize lubricant, 1 oz tube (Ace $6.99): a small tube for the stainless knee-bolt threads, which gall without it', true),
  // D-79: the troop's paracord (the stop cord of each brake; the chock cords are in PURCHASED_PRICE).
  paracord: owned('ea', 'paracord for the brake stop cords (3/16 in, about 6 in each with the knots)'),
};
/**
 * Glass tape, 2" wide, by the yard (D-79): U.S. Composites 8.7 oz glass cloth tape, $0.70 a yard [F] (50 yd roll $21.75; Fiberglass Supply $0.99 a yard [S]; West 729-10 10 ft roll $14.88).
 * `usd` is per yard and `unit` is 'yd'; the BOM buys whole yards.
 */
export const GLASS_TAPE: Price = foundCP(0.7, 'yd', 'U.S. Composites', 'https://uscomposites.com/prices.html', '8.7 oz glass cloth tape, 2" wide, sold by the yard ($0.70; 20 ft is $4.67). The West 729-10 (9 oz, 10 ft roll) is $14.88');

const FINISH = 'Paint store / marine supplier';
const OAK_TREE = 'Oak Tree Supply';
export const FINISH_PRICE: Record<string, Price> = {
  stain: est(18, 'qt', FINISH, 'wipe-on oak stain (or leave natural)'),
  conditioner: est(16, 'qt', FINISH, 'pre-stain conditioner or gel stain for the okoume, which blotches (DESIGN.md finishing)'),
  gelStain: est(20, 'qt', FINISH, 'gel stain for the okoume'),
  varnish: found(53.99, 'qt', 'TotalBoat', 'https://www.totalboat.com/products/lust-marine-spar-varnish', 'TotalBoat Lust Rapid Recoat marine spar varnish, quart (heavily fortified with UV stabilizers)'),
  // D-83: the lid legend is filled with a black oil-based paint marker, not a half pint of enamel.
  enamel: foundCP(4.9, 'ea', 'Walmart (Sharpie)', 'https://www.walmart.com/ip/seort/5468037669', 'Sharpie oil-based paint marker, fine point, black (Rust-Oleum gloss black half pint is $9.99), for the lid legend grooves', true),
  // D-79: shop stock. The thinner is mineral spirits Eric already has; the sandpaper and the supplies lot (brushes, rollers, cups, gloves) too.
  thinner: owned('pt', 'mineral spirits for the urethane (coat 1 thinning and brush cleaning)'),
  sandpaper: { ...owned('lot', 'sandpaper, the discs and sheets 80 to 320 grit for the finishing schedule'), packQty: 1, packUsd: 0 },
  supplies: owned('lot', 'brushes, foam rollers, mixing cups, gloves, acetone, tack cloth'),
};
/**
 * Researched container prices (the real products), keyed like `FINISH_PRICE`; a container without one is priced as the base per-quart price times `FINISH_CONTAINER_FACTOR`.
 * Conditioner: no pint of the water-based product exists, so the pint line buys the quart.
 */
export const FINISH_CONTAINER_PRICE: Record<string, Partial<Record<'pt' | 'qt' | 'gal', Price>>> = {
  enamel: { pt: FINISH_PRICE.enamel },
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
const BD_FENDER_18_8 = 'https://boltdepot.com/Fender_washers_Stainless_steel_18-8';
/** An 18-8 Bolt Depot fastener sold by the piece and by the bag: quoted, read via search. */
const bd18 = (id: number | string, unit: string, desc: string, each: number, bagQty: number, bagUsd: number, extra = ''): Price =>
  withEach(foundPack(bagQty, bagUsd, unit, BOLT_DEPOT, typeof id === 'string' ? id : `${BD_PRODUCT}${id}`, `${desc}, $${each.toFixed(2)} each by the piece or ${usdPlain(bagUsd)} per ${bagQty}${extra ? `; ${extra}` : ''}`, true), each);
const usdPlain = (v: number): string => `$${v.toFixed(2)}`;
const stdScrewLabel = (gauge: number, len: string): RegExp => new RegExp(String.raw`^18-8 (?:flat-head )?wood screw #${gauge} x ${len.replace('/', String.raw`\/`)}"$`);
const STD_SCREW_NOTE = 'Phillips flat-head 18-8 wood screw';

export const FASTENER_PRICE_STANDARD: Array<{ match: RegExp; price: Price }> = [
  // Wood screws (Bolt Depot, 18-8). The three sizes of D-72 are #8 x 5/8, #8 x 1-1/4 and #6 x 2-1/2.
  { match: stdScrewLabel(8, '5/8'), price: bd18(3958, 'ea', `${STD_SCREW_NOTE} #8 x 5/8" (#3958)`, 0.22, 100, 14.01) },
  { match: stdScrewLabel(8, '1-1/4'), price: bd18(3961, 'ea', `${STD_SCREW_NOTE} #8 x 1-1/4" (#3961)`, 0.29, 100, 18.29, '316 is 0.48 / 34.63 per 100') },
  // D-77: the pan-head #8 x 1-1/4 screws of the two brake pivot straps (8). Bolt Depot sells no pan-head WOOD screw: the Type A self-tapping pan head (coarse thread) works in hardwood with a pilot hole.
  // D-91: the rail-to-chine trim-head screws in 18-8 / 305: an estimate (trim heads run about the price of a flat head of the same size).
  { match: /^18-8 trim-head wood screw #8 x 2-1\/2"$/, price: notFound(withEach(packed(100, 40, 'ea', FAST, 'ESTIMATE: 18-8 (305) stainless trim-head wood screw #8 x 2-1/2" (square or Torx drive, about a 7/32" head), for the rail-to-chine tie; quote before ordering'), 0.4)) },
  { match: /^18-8 pan-head wood screw #8 x 1-1\/4"$/, price: withAlts(foundCP(0.12, 'ea', BOLT_DEPOT, `${BD_PRODUCT}2312`, '18-8 Phillips pan-head self-tapping (Type A) screw #8 x 1-1/4" (#2312), $0.12 each: a sheet-metal screw with a coarse thread, not a true wood screw; drill a pilot hole in the oak'),
    [foundCP(0.29, 'ea', BOLT_DEPOT, `${BD_PRODUCT}3961`, '18-8 Phillips flat-head WOOD screw #8 x 1-1/4" (#3961), $0.29 each: a true wood screw but a flat head (the strap is not countersunk); the slotted round head (#3876) is also $0.29')]) },
  // D-82: no 18-8 #6 x 2-1/2 exists, so the rail-to-chine and rib-knee screws are #8 x 2-1/2, piloted.
  { match: stdScrewLabel(8, '2-1/2'), price: bd18(5416, 'ea', `${STD_SCREW_NOTE} #8 x 2-1/2" (#5416): the rail-to-chine and rib-knee screws; drill a pilot hole (the bearing edge is about 7/16", so a #8 leaves about 1/8" each side)`, 0.6, 100, 39.55, 'a zinc slotted #6 x 2-1/2 ($0.23, #2085) is the only #6 that long, and it is zinc') },
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
  { match: /button-head cap screw 1\/4-20 x 1-1\/2"/, price: foundCP(0.37, 'ea', BOLT_DEPOT, `${BD_PRODUCT}4415`, '18-8 socket button-head cap screw 1/4-20 x 1-1/2" (#4415), $0.37 each') },
  { match: /button-head cap screw 1\/4-20 x 2-1\/2"/, price: foundCP(0.73, 'ea', BOLT_DEPOT, `${BD_PRODUCT}4418`, '18-8 socket button-head cap screw 1/4-20 x 2-1/2" (#4418), $0.73 each (Bolt Depot lists no 2-1/4" or 2-3/4" button head)') },
  { match: /button-head cap screw 1\/4-20 x 3"/, price: foundCP(0.94, 'ea', BOLT_DEPOT, `${BD_PRODUCT}4419`, '18-8 socket button-head cap screw 1/4-20 x 3" (#4419), $0.94 each') },
  { match: /button-head cap screw/, price: notFound(withEach(packed(50, 20, 'ea', FAST_STD, '18-8 socket button-head cap screw'), 0.6)) },
  { match: /carriage bolt 3\/8/, price: { ...withAlts(
    foundCP(4.89, 'ea', BOLT_DEPOT, `${BD_PRODUCT}11937`, '18-8 carriage bolt 3/8-16 x 6-1/2" (#11937), $4.89 each: a special length (the stock 6" is $1.88). The stack needs 6.16", and the 6" bolt stops 1/16" short of the top of the nylock nut'),
    [gap(foundCP(1.88, 'ea', BOLT_DEPOT, `${BD_PRODUCT}954`, '18-8 carriage bolt 3/8-16 x 6" (#954), $1.88 each (72.31 per 50): the stock length'), 'the bolt is 6", not 6-1/2": it stops 1/16" short of the top of the nylock nut on this stack')]), decision: CARRIAGE_DECISION } },
  { match: /hex bolt 1\/4-20 x 1-1\/2"/, price: bd18(132, 'ea', '18-8 hex bolt 1/4-20 x 1-1/2" (#132)', 0.28, 100, 21.6) },
  { match: /hex bolt 1\/4-20 x 2-1\/4"/, price: bd18(8976, 'ea', '18-8 hex bolt 1/4-20 x 2-1/4" (#8976)', 0.43, 100, 32.98, 'a semi-standard length') },
  { match: /hex bolt 1\/4-20 x 2-1\/2"/, price: foundCP(0.47, 'ea', BOLT_DEPOT, `${BD_PRODUCT}134`, '18-8 hex bolt 1/4-20 x 2-1/2" (#134), $0.47 each') },
  { match: /hex bolt 1\/4-20 x 2-3\/4"/, price: foundCP(0.5, 'ea', BOLT_DEPOT, `${BD_PRODUCT}8977`, '18-8 hex bolt 1/4-20 x 2-3/4" (#8977), $0.50 each') },
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
  { match: /narrow flat washer 3\/8/, price: withEach(packed(100, 12, 'ea', FAST_STD, `ESTIMATE (Standard spec): 18-8 narrow flat washer 3/8" x 7/8" OD, under each brake-knee bolt head (not in the Standard research); pack of 100`), 0.15) },
  { match: /fender washer #8/, price: withEach(packed(100, 14, 'ea', FAST_STD, 'ESTIMATE (Standard spec): 18-8 fender washer for #8, 3/4" OD (not in the Standard research); pack of 100'), 0.2) },
  { match: /fender washer 1\/4/, price: bd18(BD_FENDER_18_8, 'ea', '18-8 fender washer 1/4" x 1-1/4"', 0.28, 100, 18.81, '48 by the piece is cheaper than the bag; Home Depot Everbilt 20-pack 5.97 (0 in stock)') },
  { match: /fender washer 3\/8/, price: bd18(BD_FENDER_18_8, 'ea', '18-8 fender washer 3/8" x 1-1/2"', 0.41, 50, 14.51, 'the bag of 50 covers 46; the page listed 0.29 a washer in the bag against 0.41 each') },
  { match: /fender washer/, price: notFound(withEach(packed(100, 20, 'ea', FAST_STD, '18-8 fender washer'), 0.3)) },
  // Pins, collars, eyes, inserts
  { match: /cotter pin/i, price: withAlts(
    bd18(14571, 'ea', '18-8 cotter pin 5/32" x 1-1/2" (#14571)', 0.32, 100, 22.64, 'Bolts and Nuts extended-prong $0.65 each'),
    [gap(bd18(14570, 'ea', '18-8 cotter pin 5/32" x 1-1/4" (#14570)', 0.27, 100, 19.43), 'the pin is 1-1/4" long, not 1-1/2"')]) },
  { match: /shaft collar/i, price: foundCP(4.52, 'ea', 'Penn Tool Co.', 'https://www.penntoolco.com/87986402', 'Climax C-062 one-piece set-screw collar, 5/8" bore, 1-1/8" OD x 1/2", zinc plated: the Standard weather spec (garage-kept). PartsSource GSC-062-Z zinc is $4.99; 316 (Climax CRC-062-S) is $19.89 at Newegg/Zoro (the Extreme spec)') },
  { match: /stainless rod/i, price: est(2.5, 'ea', FAST_STD, 'cut from a 3/8" x 12" 304 rod (about $10): five pins per rod. ESTIMATE, scaled from the 316 estimate; not in the Standard research') },
  { match: /screw eye/, price: withAlts(
    { ...packed(2, 1.57, 'ea', 'Home Depot (Everbilt)', 'ESTIMATE (Standard spec): Everbilt 1/4" x 2" stainless screw eye, 2-piece pack at $1.57 (model 824351; 4 packs for the 8). The size is eye diameter x length, not a #10 shank, and the grade is not stated: check the package for 304 and that the eye takes the brake cord tie'), url: 'https://www.homedepot.com/s/stainless%20steel%20screw%20eye' },
    [withEach({ ...packed(20, 12.82, 'ea', BOLT_DEPOT, 'Bolt Depot 18-8 screw eye, trade size 8 (1/2" I.D., #15513): $1.08 each or 12.82 per 20; the smallest at Bolt Depot, bigger than a #10'), url: `${BD_PRODUCT}15513` }, 1.08),
     gap(foundPack(1, 2.79, 'ea', 'Ace Hardware (National Hardware)', 'https://www.acehardware.com/departments/hardware/screw-eyes/5700620', 'National Hardware stainless 5/8" screw eye, 75 lb, $2.79 each [S] (this listing and 5700554 were not told apart)', true), 'a 5/8" eye, not the #10 size')]) },
  { match: /threaded insert/, price: withAlts(
    withEach({ ...packed(100, 18.71, 'ea', BOLT_DEPOT, 'ESTIMATE (Standard spec): zinc flanged softwood threaded insert, #10-32, Allen drive (#23861), 0.25 each or 18.71 per 100. The research (2026-10-12, and again 2026-10-14) found NO 18-8 or zinc #10-32 screw-in insert for hardwood at a readable price, only pronged T-nuts (Bolts and Nuts zinc #10-32 x 5/16 3-prong T-nut $0.24, hammer-in) and an 18-8 hardwood insert in #8-32 x 3/8" at 4.78 each; this one is a softwood type, 0.512" long (the model asks for 3/8" and 5/16"). Fine in a dry garage; confirm the drill size'), url: `${BD_PRODUCT}23861` }, 0.25),
    [gap(foundPack(25, 88.61, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Threaded_inserts', 'Bolt Depot 18-8 hardwood insert, #8-32 x 0.375", $4.78 each, 88.61 per 25', true), 'a #8-32 thread, not #10-32, and about 20x the price')]) },
  { match: /Thumb-knob screw #10-32 x 1"/, price: withAlts(
    withEach(foundPackCP(100, 16.87, 'ea', BOLT_DEPOT, `${BD_PRODUCT}23990`, 'zinc-plated spade-type thumb screw #10-32 x 1" (#23990): a flat spade head, not a knurled knob; $0.21 each or 16.87 per 100. Zinc is fine garage-kept'), 0.21),
    [gap(foundCP(1.6, 'ea', 'Bolts and Nuts', 'https://boltsandnuts.com/products/10-32x1-18-8-stainless-steel-thumb-screws', '#10-32 x 1" spade thumb screw, 18-8 stainless, $1.60 each (3/4" $1.64, 1-1/2" $1.70)'), 'about 8 times the price, for stainless')]) },
  { match: /Thumb-knob/, price: withAlts(notFound(est(1.75, 'ea', FAST_STD, 'thumb-knob screw #10-32, 18-8 knurled: no exact one found (Home Depot Everbilt #10-32 x 1/2" stainless knurled, 831568, is 3.38 per bag, count not stated); the length is set by the web thickness')), [
    gap(foundPack(100, 16.7, 'ea', BOLT_DEPOT, `${BD_PRODUCT}23989`, 'Bolt Depot thumb screws, spade type, zinc plated steel, #10-32 x 3/4" (#23989), 0.21 each or 16.70 per 100', true), 'zinc spade-type, 3/4", and not a knurled knob')]) },
  // D-79: beech Dominos from the shop (all sizes): $0, kept as a line so they are not forgotten.
  { match: /^Domino/, price: DOMINO_OWNED_STANDARD },
  // Material-free labels that have no 18-8 or zinc twin
  // D-76: the D-ring plate's #8-32 x 2" through-bolt sets. Bolt Depot 18-8: pan head $0.30 (bag of 100 $20.06), washer $0.15 (100 for $9.86), nylock $0.10 (100 for $6.93).
  { match: /machine screw #8-32 x 2"/, price: bd18(1352, 'ea', '18-8 Phillips pan-head machine screw #8-32 x 2" (#1352); the flat head (#1254) is $0.27', 0.3, 100, 20.06) },
  { match: /lock nut #8-32/, price: bd18(2551, 'ea', '18-8 hex nylon-insert lock nut #8-32 (#2551)', 0.1, 100, 6.93) },
  { match: /fender washer #8/, price: bd18(7147, 'ea', '18-8 fender washer #8 x 3/4" (#7147)', 0.15, 100, 9.86) },
  { match: /flat-head machine screw #10-32 x 3\/8"/, price: foundCP(0.13, 'ea', BOLT_DEPOT, `${BD_PRODUCT}1267`, '18-8 Phillips flat-head machine screw #10-32 x 3/8" (#1267), $0.13 each') },
  { match: /^18-8 screw M3 x 8 mm$/, price: foundCP(0.05, 'ea', BOLT_DEPOT, `${BD_PRODUCT}6831`, '18-8 Phillips pan-head machine screw M3 x 0.5 x 8 mm (#6831), $0.05 each') },
  { match: /^18-8 screw M4 x 10 mm$/, price: foundCP(0.08, 'ea', BOLT_DEPOT, `${BD_PRODUCT}5167`, '18-8 Phillips pan-head machine screw M4 x 0.7 x 10 mm (#5167), $0.08 each') },
  { match: /machine screw/, price: withEach(packed(100, 12, 'ea', FAST_STD, '18-8 machine screw; pack of 100 (not in the Standard research)'), 0.2) },
  { match: /\bM[34]\b/, price: withEach(packed(100, 7, 'ea', FAST_STD, '18-8 metric socket or pan-head screw; pack of 100 (not in the Standard research)'), 0.12) },
  { match: /^18-8 /, price: est(1, 'ea', FAST_STD, 'No Standard price in prices.ts for this label: add it to FASTENER_PRICE_STANDARD') },
];

/**
 * Standard-spec prices for purchased parts, by partNo; tried before PURCHASED_PRICE. `describe` replaces the model's part name in the BOM where the name says 316.
 * A part not listed falls through to PURCHASED_PRICE (wheels, rope, cushions, lights...: spec-free items, and the model's own cost).
 */
export interface StdPurchasedEntry extends PurchasedPriceEntry { describe?: string }
export const PURCHASED_PRICE_STANDARD: StdPurchasedEntry[] = [
  { match: /^steer-eye$/, price: withAlts(EYE_GALV.steerEye, [EYE_316.steerEye], EYE_DECISION) },
  { match: /^steer-anchor$/, price: withAlts(EYE_GALV.steerAnchor, [EYE_316.steerAnchor], EYE_DECISION) },
  { match: /^steer-chain$/, override: true, price: found(Math.round(((CHAIN_CUT_IN / 12) * 2.12 + 2 * 1.99) * 100) / 100, 'ea', 'Home Depot (Everbilt) / Ace (Campbell)', 'https://homedepot.com/p/Everbilt-3-16-in-x-1-ft-Grade-30-Zinc-Plated-Steel-Proof-Coil-Twist-Link-Chain-811646/303285928',
    `3/16" Grade 30 zinc proof coil chain at $2.12/ft (${CHAIN_CUT_IN} in; WLL 750 lb; the page showed 0 in stock; KingChain 15 ft tub $15.59, about $1.04/ft) plus two Campbell 3/16" zinc quick links at $1.99 each (Ace Hardware item 52604; WLL 660 lb)`, true), describe: 'Steering check chain (3/16" zinc chain, zinc quick links)' },
  // D-83: the cheap stainless hinge pairs. The stainless grade is not printed on either listing: check the package for 304 (a magnet test: 304 is barely magnetic) before using them on wet oak.
  { match: /^seat-hinge$/, override: true, price: withAlts(
    foundCP(6.495, 'ea', 'Ace Hardware', 'https://www.acehardware.com/departments/hardware/door-hardware/door-hinges/5006016', 'Ace 2" stainless narrow tight-pin hinge, pack of 2 at $12.99, shown as half each. A narrow utility hinge: check its leaf width and screw holes against the three-insert pattern before buying. The grade is not stated: check the package for 304', true),
    [foundCP(11.005, 'ea', 'MarineEngine.com (Sea-Dog)', 'https://www.marineengine.com/boat-accessories/hardware/201582-1', 'Sea-Dog 201582-1 stainless butt hinge 2" x 2", described as 304 stamped stainless, pack of 2 at $22.01, shown as half each (fasteners not included)', true)]) },
  { match: /^storage-hinge$/, override: true, price: withAlts(
    foundCP(2.735, 'ea', 'Home Depot (Everbilt)', 'https://homedepot.com/p/Everbilt-2-1-2-in-Stainless-Steel-Non-Removable-Pin-Narrow-Utility-Hinge-2-Pack-29207/314151807', 'Everbilt 2-1/2" stainless non-removable-pin narrow utility hinge (29207), 2-pack at $5.47, shown as half each. A narrow utility hinge, not a mortise hinge, and the grade is not stated: check the package for 304. D-89: the model asks for 2-1/2" x 1-1/2" open (3/4" leaves), which this narrow hinge is about: check the leaf against the 3/4" lid frame face', true),
    [{ ...est(9.21, 'ea', 'MarineEngine.com (Seachoice)', `Seachoice 34911 butt hinge, leaf 1-5/8" x 2-1/2", described as 304, "fast pin" type, pack of 2 at $18.42, shown as half each (nearest size)`, 'https://www.marineengine.com/boat-accessories/hardware/34911') }]) },
  // D-83: the Frost King EPDM D-profile weatherstrip, one 17 ft roll for all four gasket lines (shown as a quarter each: 2.1725 x 4 = 8.69).
  { match: /^storage-gasket-side$/, override: true, price: foundCP(2.17, 'ea', 'Home Depot (Frost King)', 'https://www.homedepot.com/p/100145681', 'Frost King V25WA white EPDM D-section self-stick weatherseal, 5/16" x 1/4" x 17 ft, $8.69 for the roll; ONE roll covers all four gasket lines (the default lid needs about 70 in, 5-3/4 ft, of the 17 ft: two sides and two ends), shown as a quarter each. A D-section gives less compression than a bulb: check the lid gap', true) },
  { match: /^storage-gasket-end$/, override: true, price: foundCP(2.175, 'ea', 'Home Depot (Frost King)', 'https://www.homedepot.com/p/100145681', 'Frost King V25WA EPDM D-section, the same 17 ft roll as the side gaskets ($8.69 for all four lines, a quarter each)', true) },
  // D-83: Harbor Freight 1/4" cargo D-rings, bought by the 2-pack (3 packs for the six rings): 233 lb working load, 700 lb break, zinc. The cargo straps pull about 79 lbf a ring.
  { match: /^lash-point$/, override: true, price: { ...withAlts(
    foundPackCP(2, 2.99, 'ea', 'Harbor Freight', 'https://www.harborfreight.com/14-in-cargo-d-ring-anchor-2-pack-60319.html', 'HAUL-MASTER 1/4" cargo D-ring anchor, 2-pack #60319, zinc, 233 lb working load / 700 lb break, 0.22 lb a pair; VERIFY the bracket holes take a 1/4-20 bolt (not listed). Under the 300 lbf the spec asked for, over the 79 lbf the straps pull', false, 'pack of 2'),
    [gap(foundCP(3.56, 'ea', 'Need A Trailer Part', 'https://needatrailerpart.com/products/3-8-bolt-on-d-ring-1-hole-2-4k-rated-multipack-of-4-b21-4', '3/8" bolt-on D-ring, 1 hole, forged zinc, 2,400 lb WLL, 4-pack B21-4 $14.24 (+0.75 lb for six)'), '1 hole, 3/8", heavier: rated far above the load')]), perPart: 1 } },
  { match: /^brake-pivot-clip$/, override: true, price: found(0.82, 'ea', BOLT_DEPOT, `${BD_PRODUCT}27209`, '18-8 hitch pin clip, 0.093" wire, for 3/8" to 5/8" pins (#27209), $0.82 each, 13.43 per 25 (124.00 per 250)', true), describe: 'Brake pivot hitch-pin clip (18-8 stainless)' },
  // D-83: the Standard spec drills epoxy-lined holes and has no nipples; this stays only for a model that still has the parts (real 304 nipples are $10 to $13, not $5.20).
  { match: /^(scupper|storage-drain)$/, override: true, price: foundCP(12.73, 'ea', 'Nassau National Cable', 'https://nassaunationalcable.com/products/3-8-in-hose-barb-3-8-in-male-npt-304-stainless-steel-hose-nipple-mip-adapt-73952', '3/8" hose barb x 3/8" male NPT, 304 stainless (G.W. Kent 304L $12.95, $10.36 at 10)', true) },
];
/** Model-cost notes for the Standard spec (the parts whose model cost stays the price). Falls through to PURCHASED_MODEL_COST_NOTE for the spec-free ones. */
export const PURCHASED_MODEL_COST_NOTE_STANDARD: ModelCostNote[] = [
  { match: /^seat-pin$/, note: `model cost kept: no 3/8" x 1-1/2" detent pin found in the ${RESEARCH_DATE} research (Whitecap S-1024C is $69.99, 304, diameter not stated, likely the wrong part)` },
  { match: /^brake-snap$/, note: 'model cost kept: the 304 snap hook found (Hardware Essentials via ihsgonline, $6.24) does not state its size; the Everbilt 13/16 x 3-3/16" stainless fixed-eye snap hook is $13.46 (too big and dear)', alternatives: [
    gap(foundPack(1, 6.24, 'ea', 'ihsgonline (Hardware Essentials)', 'https://ihsgonline.com/products/snap-hook/235445002/', 'Hardware Essentials snap hook, 304 stainless, size not stated', true), 'the size is not stated')] },
  { match: /^brake-pivot-pin$/, note: `model cost kept: the Everbilt 3/8" x 2" zinc-plated universal clevis pin (815438, $3.75) is 2" long and the pin is about 3-1/16" (through the strap, the tongue and 1" into the inboard ear); stainless 3/8 x 2" (70518) is $4.75. No 3-1/16" pin found at retail: cut a 3/8" stainless rod or order a long pin`, alternatives: [
    gap(foundPack(1, 3.75, 'ea', 'Home Depot (Everbilt)', 'https://homedepot.com/p/Everbilt-3-8-in-x-2-in-Zinc-Plated-Universal-Clevis-Pin-815438/204276615', 'Everbilt 3/8" x 2" zinc-plated universal clevis pin (815438)', true), '2" long, not 3-1/16"; zinc-plated')] },
];

// ── Titebond III (Standard) ──
/** D-79: Titebond III is shop stock, $0 (the bottle prices below are what it would cost to restock, and the alternatives of nothing). */
export const TITEBOND_OWNED: Price = owned('fl oz', 'Titebond III Ultimate wood glue');
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
/**
 * `resinShare` = resin share of the mixed volume (5:1 is 5/6, 2:1 is 2/3): the BOM turns the mixed epoxy it needs into resin at the kit's own ratio. `pumps` = the pump set to add when the kit comes without
 * (`pumpsIncluded` false). `anySpec` = the kit is considered for the Extreme spec too (the small 5:1 kits are Standard only).
 */
export interface OtherEpoxyKit { id: string; label: string; resinFlOz: number; mixedFlOz: number; price: Price; pumpsIncluded: boolean; resinShare: number; pumps?: Price; anySpec?: boolean }
export const EPOXY_PUMPS_USC_2TO1: Price = foundCP(8.5, 'set', 'U.S. Composites', 'https://www.uscomposites.com/epoxy.html', 'epoxy pump set (EPX-P31 is the 3:1; the 2:1 set is the same price), 38 mm screw top, for the 635 resin and #556 hardener cans');
export const EPOXY_KITS_SMALL: OtherEpoxyKit[] = [
  // D-79: U.S. Composites 635 THIN epoxy, 2:1 by volume with the #556 hardener (35-40 min pot life): 64 oz resin + 32 oz hardener, 96 oz mixed for $53.45, plus the 2:1 pumps ($8.50). The cheapest per ounce by far.
  // It is a thin, low-viscosity resin: thicken every glue joint and fillet with the fumed silica (bought with it), check blush and the cure schedule on the data sheet, and the price list is dated 2026-08-07. Shipping was not read.
  { id: 'uscomposites-635-2-1', label: 'U.S. Composites 635 thin epoxy kit, 2:1, 64 oz resin + 32 oz hardener (96 oz mixed)', resinFlOz: 64, mixedFlOz: 96, pumpsIncluded: false, resinShare: 2 / 3, pumps: EPOXY_PUMPS_USC_2TO1, anySpec: true,
    price: foundCP(53.45, 'kit', 'U.S. Composites', 'https://uscomposites.com/prices.html', '635 Thin Epoxy 2:1 (hardener #556, 35-40 min): 64 oz resin + 32 oz hardener, 96 oz mixed; the pumps are extra. Price list dated 2026-08-07; shipping not read (epoxy can ship as hazardous freight: batch it with the silica and glass tape, same order). Thin resin: thicken the glue joints') },
  { id: 'mas-5-1', label: 'MAS Epoxies 5:1 Traditional Marine Epoxy kit, 38.4 oz, with pumps', resinFlOz: 32, mixedFlOz: 38.4, pumpsIncluded: true, resinShare: 5 / 6,
    price: found(59.99, 'kit', 'MAS Epoxies', 'https://masepoxies.com/products/5-1-traditional-marine-epoxy-kits', '5:1 Traditional Marine Epoxy Kit, 38.4 oz: 32 fl oz resin + 6.4 fl oz hardener, with 2 quart mixing cups and 2 pumps. The page shows the same $59.99 for the 38.4 oz and the 1.2 gallon sizes, so the 38.4 oz price is likely this figure but not certain') },
  { id: 'totalboat-5-1', label: 'TotalBoat 5:1 Marine Epoxy kit, quart, with pumps', resinFlOz: 32, mixedFlOz: 38.4, pumpsIncluded: true, resinShare: 5 / 6,
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
  const entry = METAL_PRICE_PER_FT.find((r) => r.match.test(section));
  const price = entry?.price ?? null;
  // The price table is researched in 316; the Standard spec buys 304 / 18-8 stainless (its cut-list text says "18-8 (304)" or, in older callers, "316").
  if (!entry || !price || spec !== 'standard' || !/\b(316|304)\b|stainless/i.test(section)) return price;
  if (entry.std) return entry.std;
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  const alts = price.alternatives?.map((a) => ({ ...a, note: a.note ? std304(a.note) : a.note }));
  return { ...price, basis: 'estimate', usd: r2(price.usd * STD_304_FACTOR), ...(price.packUsd ? { packUsd: r2(price.packUsd * STD_304_FACTOR) } : {}),
    note: `ESTIMATE (Standard spec): 304 stainless, ${Math.round(STD_304_FACTOR * 100)} % of the 316 price below, because no 304 stock was researched. ${price.note ? std304(price.note) : ''}`.trim(), ...(alts ? { alternatives: alts } : {}) };
}
