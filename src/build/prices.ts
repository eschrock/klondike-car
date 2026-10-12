/**
 * Unit prices for the BOM (Phase 4). One table, next to the part sourcing; nothing else in `src/build` holds a dollar figure.
 *
 * Every entry says where the number comes from. `basis: 'quoted'` is a real price: one the MODEL carries (`part.sourcing.costUsd`), one Eric gathered from a named vendor's
 * published list, or one from the web price research of 2026-10-12 (docs/price-research-2026-10.md: the `found(...)` entries, each with its vendor, URL and date). Every other
 * entry is an `estimate`: a realistic 2026 US retail price, rounded, to be replaced by a real quote before ordering. No SKUs are invented: `source` names a vendor or a kind of vendor.
 * `url` is a real link from Eric or from the research (the vendor's price list or product page); it goes to the BOM line, the BOM CSV and the build book. Never invent one.
 *
 * Base versus alternatives (price research, 2026-10-12): the BASE price is always the item the model specifies. A cheaper or different item that does not meet the spec
 * (5/8" wheel bore on a 3/4" axle, 304 for 316, beech Dominos for Sipo) is an ALTERNATIVE (`Price.alternatives`, `specGap: true`), shown in the BOM line notes and never
 * substituted silently. An item the research did not find keeps its estimate with "not found in the 2026-10-12 research" in the note.
 */

export type PriceBasis = 'quoted' | 'estimate';

/** The date of the web price research whose prices are `quoted` below (docs/price-research-2026-10.md). */
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
  '12/4': quoted(25, 'bf', WOODYARD, 'white oak 12/4: NOT BOUGHT (D-70). The four parts that needed it are face-laminated from 4/4; this price only shows what the laminating saves', WOODYARD_URL),
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
  { match: /DOM tube/, price: foundPack(5, 45.45, 'ft', SPEEDY, 'https://speedymetals.com/p-3432-34-od-x-120-wall-dom-steel-tube.aspx', '3/4" OD x .510" ID x .120" wall DOM steel round tube, 60 in length; the cuts need 57.1 in plus kerfs. DOM only: ask for the A513 Type 5 mill cert; 36 in is 33.33, 48 in 40.00', false, '60 in piece') },
  { match: /flat bar 1\/16/, price: notFound(withAlts(est(7, 'ft', METAL, '316 stainless, thin bar (no 316 1/16" x 1" bar found; the thinnest 316 flat at Speedy Metals is 1/8")'), [
    gap(foundPack(1.5, 11.32, 'ft', SPEEDY, 'https://www.speedymetals.com/p-2538-18-x-1-316-stainless-steel-annealed-pickled.aspx', '1/8" x 1" 316 stainless flat, annealed and pickled, 18 in piece; stiffer and about twice the weight (0.036 lb/in); fine for the grip backing if the screws still fit', false, '18 in piece'), 'the bar is 1/8" thick, not 1/16"'),
  ])) },
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
const EYE_DECISION = 'Eye bolts: the model says 3/8" x 3-7/8" and 2-5/8", which are not stock lengths. Priced at the nearest stock lengths, 4-1/2" (steer-eye) and 2-1/2" (steer-anchor); check that 2-1/2" still passes through the 1.25" chain joist with its washer and nut, and that 4-1/2" clears the axle beam. Galvanized is the base (the model says "galvanized or 316"); 316 is 4x the price (about $200 for four against $46): choose galvanized (dry sled) or 316 (wet).';
const WHEEL_DECISION = 'Wheel spec: almost every 10" hand-truck wheel is 5/8" bore, not the 3/4" the axle needs. The base is the only 3/4"-bore pneumatic found (Access Casters 10DHTPW-53, hub 2-3/4" against the model\'s 2.28", about 5 lb against 2.8 lb): confirm the bore, hub and weight with the seller. McMaster 8353T33 (350 lb, 2-1/4" hub, 5/8" or 3/4" bore) is the closest spec but its price is hidden: check it on mcmaster.com. Or redesign for 5/8" axles and the $9.99 Harbor Freight wheel. Measure one real wheel first.';
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
    found(29.6, 'ea', 'Access Casters (eBay)', 'https://www.ebay.com/itm/123713319921', 'Access Casters 10DHTPW-53 pneumatic hand-truck wheel, 10" x 2-3/4", 3/4" ball bearings, 350 lb listed, about 5 lb shipping weight, listing last updated June 2023; the only priced 3/4"-bore pneumatic found. Differs from the model: hub 2-3/4" (model 2.28") and about 5 lb (model 2.8 lb); confirm the bore with the seller', true),
    [
      gap(found(9.99, 'ea', 'Harbor Freight', 'https://www.harborfreight.com/10-inch-x-3-1-2-half-inch-pneumatic-tire-67465.html', 'HAUL-MASTER 10" pneumatic tire with black hub (SKU 67465), 300 lb, 3 lb, 3-1/2" wide, hub length not listed'), '5/8" bore needs 5/8" axles, a design change (the axle is 3/4")'),
      gap(found(17.99, 'ea', 'Tractor Supply / Ace', 'https://tractorsupply.com/tsc/product/martin-wheel-410-350-4-10-in-stud-tread-hand-truck-wheel-2-1-4-x-5-8-in-offset-hub', 'Martin Wheel 410/350-4 10" sawtooth hand-truck wheel, 2-1/4" offset hub (the right hub length), 300 lb, tube type', true), '5/8" bore, not 3/4"'),
    ], WHEEL_DECISION) },
  { match: /^king-thrust$/, price: found(15.88, 'ea', 'eBay seller (Florida)', 'https://www.ebay.com/itm/143055583417', 'natural UHMW 1/2" sheet, 6" x 12" option (a 3" disc is cut from it); the listing may price one size only', true) },
  { match: /^kingpin$/, price: est(9, 'ea', MCM, '5/8" grade 8 bolt, 2 washers, nylock nut') },
  { match: /^roll-pad$/, price: notFound(est(2, 'ea', MCM, 'UHMW 1/4" sheet offcut (no US price found, only an import listing at about $44 before duty)')) },
  { match: /^bridle-sleeve$/, price: notFound(est(7, 'ea', MCM, 'oil-embedded bronze sleeve bearing, 5/8" ID x 1" OD x 1-1/2" (Symmco SS-2032-8 is 5/8 x 1 but 1/2" long; needs a cut-to-length or a quote)')) },
  { match: /^steer-eye$/, price: withAlts(
    found(11.94, 'ea', BOLT_DEPOT, BD_EYE_URL, 'forged shoulder eye bolt with nut, hot-dip galvanized, 3/8-16 x 4-1/2" (the model says 3-7/8", not a stock length; Bolt Depot measures from under the shoulder)', true),
    [found(50.77, 'ea', BOLT_DEPOT, BD_EYE_316_URL, '316 forged shoulder eye bolt with nut, 3/8-16 x 4-1/2": 4x the galvanized price', true)], EYE_DECISION) },
  { match: /^steer-anchor$/, price: withAlts(
    found(11.1, 'ea', BOLT_DEPOT, BD_EYE_URL, 'forged shoulder eye bolt with nut, hot-dip galvanized, 3/8-16 x 2-1/2" (the model says 2-5/8", not a stock length)', true),
    [found(48.43, 'ea', BOLT_DEPOT, BD_EYE_316_URL, '316 forged shoulder eye bolt with nut, 3/8-16 x 2-1/2": 4x the galvanized price', true)], EYE_DECISION) },
  { match: /^steer-chain$/, price: found(Math.round(((CHAIN_CUT_IN / 12) * CHAIN_USD_PER_FT + 2 * QUICK_LINK_USD) * 100) / 100, 'ea', 'ACE Industries / Skydog Rigging', 'https://www.aceindustries.com/3-16-nacm-industrial-chain-316l-stainless-steel',
    `3/16" NACM industrial chain 316L at $${CHAIN_USD_PER_FT}/ft (${CHAIN_CUT_IN} in) plus two 3/16" 316 quick links at $${QUICK_LINK_USD} each (Skydog, WLL 800 lb). Grade 43 is not made in 3/16": NACM chain has a looser rating, so check the working load against the 1000 lb target`, true) },
  { match: /^bridle$/, price: found(6.49, 'ea', 'Hamilton Marine', 'https://shop.hamiltonmarine.com/products/commercial-3-strand-nylon-rope--foot-or-reel--42842.html', '11 ft of commercial 3-strand nylon rope, 3/8", at $0.59/ft', true) },
  { match: /^(scupper|storage-drain)$/, override: true, price: found(5.2, 'ea', 'Global Industrial (MSI)', 'https://www.globalindustrial.com/p/38-mpt-x-38-316-stainless-steel-hose-barb-class-150', '3/8" MPT x 3/8" hose barb, 316, Class 150', true) },
  { match: /^seat-hinge$/, override: true, price: found(13.545, 'ea', 'Freeport Marine', 'https://www.freeportmarine.com/products/seachoice-2-316-stainless-steel-butt-hinges.oembed', 'Seachoice 33911 2" x 2" 316 stainless butt hinges, $27.09 a pair (one pair is the pack), shown as half each', true) },
  { match: /^storage-gasket/, override: true, price: found(13.185, 'ea', 'Walmart (Trim-Lok)', 'https://www.walmart.com/ip/873339043', 'Trim-Lok X110HT EPDM seal 3/8" x 3/4", 25 ft roll $52.74 (about $2.11/ft); one roll covers all four gasket lines, shown as a quarter each. Check the profile and the length against the lid frame', true) },
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
export const modelCostNote = (partNo: string): ModelCostNote | undefined => PURCHASED_MODEL_COST_NOTE.find((r) => r.match.test(partNo));

// ── Fasteners (316 stainless unless noted), matched on the BOM label ──────────

const FAST = 'Fastener supplier (McMaster-Carr / Fastenal class), 316 stainless';
const DOMINO_DEALER = 'Festool Domino dealer';
const BD_SCREW_8 = 'https://boltdepot.com/Wood_screws_Phillips_flat_head_Stainless_steel_316_8';
const BD_SCREW_10 = 'https://boltdepot.com/Wood_screws_Phillips_flat_head_Stainless_steel_316_10';
const BD_SCREW_6 = 'https://boltdepot.com/Product-Details?product=16354';
/** A Bolt Depot 316 Phillips flat-head wood screw sold singly or by the 100: the pack of 100 is priced. */
const bdScrew = (url: string, gauge: number, len: string, packUsd: number, extra = ''): Price => foundPack(100, packUsd, 'ea', BOLT_DEPOT, url, `316 Phillips flat-head wood screw #${gauge} x ${len}", pack of 100${extra}`, true);
const woodScrewLabel = (gauge: number, len: string): RegExp => new RegExp(String.raw`^316 (?:flat-head )?wood screw #${gauge} x ${len.replace('/', String.raw`\/`)}"$`);
const NOT_LISTED = 'this length is not in the Bolt Depot listing the research read';
const CARRIAGE_DECISION = 'Carriage bolts: the model length 6-1/4" is not a stock length. Priced as 6" (18411); 6-1/2" is the other choice. Check that 6" still clears the nut and washer stack.';
const DOMINO_4X20_DECISION = 'NO Sipo 4x20 exists: decision needed (beech 4x20 fully encapsulated in epoxy, or 5x30 Sipo if the joint allows). The chine tie uses 4x20 Dominos (about 18); the model is unchanged. The price shown is the old estimate for a Sipo pack that is not made.';
export const FASTENER_PRICE: Array<{ match: RegExp; price: Price }> = [
  { match: /T-nut/i, price: found(0.9, 'ea', 'Albany County Fasteners', 'https://www.albanycountyfasteners.com/t-nuts-316-stainless-steel-14-20-6002-016-032', '316 stainless 4-prong T-nut, 1/4"-20, for the handle-socket backers (epoxied in); $0.90 each for 1-99, $0.58 at 100+ (304 is $0.74)', true) },
  { match: /shaft collar/i, price: withAlts(
    found(33.36, 'ea', 'MROSupply', 'https://www.mrosupply.com/products/745606/as-markdown/', 'Climax Metal CRC-075-S one-piece set-screw shaft collar, 316 stainless, 3/4" bore, 1-1/4" OD x 9/16", for the wheel end of each axle', true),
    [gap(est(4.3, 'ea', 'Dultmeier', `set-screw collar, 3/4" bore, $4.30 [Dultmeier, ${RESEARCH_DATE}; ${SEARCH_READ_NOTE}; no separate URL recorded, so shown as an estimate]; an eBay 4-pack was $21.95, grade unstated`), '304 stainless, not 316 (about $17 for four against $133)')],
    'Wheel retainer collars: 316 at $33.36 each ($133 for four) or 304 at $4.30 (about $17 for four). The model and the exterior-material rule say 316; 304 or zinc is the cost cut. Choose.') },
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
  { match: /Thumb-knob/, price: withAlts(notFound(est(2.75, 'ea', FAST, 'thumb-knob screw #10-32 x 7/8" (no exact length found)')), [
    gap(found(2.38, 'ea', 'ichome (RAF)', 'https://ichome.com/product-detail/raf/7109-ss', 'RAF 7109-SS stainless knob screw #10-32 (Zoro 18-8 round thumb screw 3/4" is 5.69)', true), 'the length is 1/2", not 7/8"')]) },
  { match: /\bM[34]\b/, price: packed(100, 9, 'ea', FAST, 'metric socket or pan-head screw; pack of 100') },
  { match: /machine screw/, price: packed(50, 11, 'ea', FAST, 'pack of 50') },
  // Wood screws: Bolt Depot 316 Phillips flat-head, by the 100 (the lengths the research read; the rest keep their estimate).
  { match: woodScrewLabel(8, '1/2'), price: bdScrew(BD_SCREW_8, 8, '1/2', 22.16, ' ($0.35 each)') },
  { match: woodScrewLabel(8, '5/8'), price: bdScrew(BD_SCREW_8, 8, '5/8', 23.91, ' ($0.38 each)') },
  { match: woodScrewLabel(8, '1'), price: bdScrew(BD_SCREW_8, 8, '1', 26.98, ' ($0.42 each)') },
  { match: woodScrewLabel(8, '1-1/4'), price: bdScrew(BD_SCREW_8, 8, '1-1/4', 33.95, ' ($0.53 each)') },
  { match: woodScrewLabel(10, '1'), price: bdScrew(BD_SCREW_10, 10, '1', 31.9, ' ($0.45 each)') },
  { match: woodScrewLabel(10, '1-1/4'), price: bdScrew(BD_SCREW_10, 10, '1-1/4', 36.71, ' ($0.51 each)') },
  { match: woodScrewLabel(10, '2'), price: bdScrew(BD_SCREW_10, 10, '2', 58.76, ' (two snapshots disagreed, $49.87 and $58.76: the higher is used)') },
  { match: woodScrewLabel(6, '3/8'), price: bdScrew(BD_SCREW_6, 6, '3/8', 18.17, ' ($0.25 each)') },
  { match: /wood screw/, price: notFound(packed(50, 9, 'ea', FAST, `316 wood screw; pack of 50 per length (${NOT_LISTED})`)) },
  { match: /screw/, price: packed(50, 9, 'ea', FAST, 'pack of 50') },
  { match: /lock nut 5\/8/, price: packed(10, 14, 'ea', FAST, 'pack of 10') },
  { match: /lock nut 3\/8/, price: foundPack(50, 16.15, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Hex_nylon_insert_lock_nuts_Stainless_steel_316', '316 hex nylon-insert lock nut 3/8-16 (16010), $0.48 each or 16.15 per 50 ($0.32 each); pack of 50', true) },
  { match: /lock nut 1\/4/, price: foundPack(100, 16.54, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Hex_nylon_insert_lock_nuts_Stainless_steel_316', '316 hex nylon-insert lock nut 1/4-20 (16008), $0.25 each or 16.54 per 100; pack of 100', true) },
  { match: /lock nut/, price: packed(50, 18, 'ea', FAST, 'pack of 50') },
  { match: /fender washer 5\/8/, price: packed(25, 15, 'ea', FAST, 'pack of 25') },
  { match: /fender washer 3\/8/, price: foundPack(100, 50.48, 'ea', BOLT_DEPOT, 'https://www.boltdepot.com/Fender_washers_Stainless_steel_316.aspx', '316 fender washer 3/8" x 1-1/2" (16042), $0.81 each or 50.48 per 100; the 2" OD washers of the eye bolts were not searched; pack of 100', true) },
  { match: /fender washer 1\/4/, price: foundPack(100, 27.26, 'ea', BOLT_DEPOT, 'https://www.boltdepot.com/Fender_washers_Stainless_steel_316.aspx', '316 fender washer 1/4" x 1-1/4" (16040), $0.46 each or 27.26 per 100; pack of 100', true) },
  { match: /fender washer/, price: packed(100, 20, 'ea', FAST, 'pack of 100') },
  { match: /carriage bolt 3\/8/, price: { ...found(3.68, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Product-Details?product=18411', '316 carriage bolt 3/8-16 x 6" (18411), $3.68 each, 28.31 per 10; 6-1/4" is not a stock length: the nearest are 6" and 6-1/2" (hex 16346)', true), decision: CARRIAGE_DECISION } },
  { match: /hex bolt 3\/8-16 x 3-1\/4"/, price: found(1.94, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Hex_bolts_Stainless_steel_316_1_4-20', '316 hex bolt 3/8-16 x 3-1/4" (16136), $1.88 to $1.94 each (two snapshots; the higher is used), 74.65 per 50', true) },
  { match: /hex bolt 1\/4-20 x 2-1\/4"/, price: found(0.71, 'ea', BOLT_DEPOT, 'https://boltdepot.com/Hex_bolts_Stainless_steel_316_1_4-20', '316 hex bolt 1/4-20 x 2-1/4" (16074), $0.71 each, 54.28 per 100', true) },
  { match: /bolt 3\/8/, price: notFound(est(2.5, 'ea', FAST, `${NOT_LISTED}; Bolt Depot lists 3/8-16 x 3-1/4 at $1.94 and x 3-3/4 at $2.25`)) },
  { match: /bolt 1\/4/, price: notFound(est(1.3, 'ea', FAST, `${NOT_LISTED}; Bolt Depot lists 1/4-20 x 2-1/4 at $0.71`)) },
  { match: /bolt/, price: est(2, 'ea', FAST) },
];
export const FASTENER_FALLBACK: Price = est(1, 'ea', 'No entry in prices.ts', 'UNPRICED: add the fastener to FASTENER_PRICE');

// ── Consumables ───────────────────────────────────────────────────────────────

const EPOXY = 'Marine supplier / local dealer';
const ROCK_WEST = 'Rock West Composites';
const ROCK_WEST_WEST_URL = 'https://www.rockwestcomposites.com/west-system';
/**
 * West System 105 resin with 206 slow hardener (5:1 by volume). Sold as resin plus hardener; priced here as a kit of the pair: the 105-A + 206-A quart group and the 105-B + 206-B gallon group.
 * `mixedFlOz` is the mixed volume the kit makes (resin plus hardener). The gallon group is much cheaper per ounce, and three quart groups cost more than one gallon group.
 * The gallon group's base is the cheapest credible published kit (Rock West); Fiberglass Supply's price is the alternative. The quart group was not researched (estimate).
 * The gallon kit's contents are as the research gives them: 105-B resin 0.98 gal (125.4 fl oz) and 206-B hardener 0.86 qt (27.5 fl oz).
 */
export const EPOXY_KITS: Array<{ id: string; label: string; /** Resin in the kit (fl oz): what the coats and the glue-ups draw on. */ resinFlOz: number; mixedFlOz: number; price: Price }> = [
  { id: 'quart', label: 'West System 105-A resin + 206-A slow hardener, quart group', resinFlOz: 32, mixedFlOz: 38.4, price: est(92, 'kit', EPOXY, '32 fl oz resin + 6.4 fl oz hardener (the quart group was not researched)') },
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
  conditioner: est(16, 'qt', FINISH, 'pre-stain conditioner or gel stain for the okoume, which blotches (BRIEF finishing stack)'),
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

// ── Lookups ───────────────────────────────────────────────────────────────────

export function purchasedEntry(partNo: string): PurchasedPriceEntry | undefined {
  return PURCHASED_PRICE.find((r) => r.match.test(partNo));
}
export function purchasedPrice(partNo: string): Price {
  return purchasedEntry(partNo)?.price ?? PURCHASED_FALLBACK;
}
export function fastenerPrice(label: string): Price {
  return FASTENER_PRICE.find((r) => r.match.test(label))?.price ?? FASTENER_FALLBACK;
}
export function metalPrice(section: string): Price | null {
  return METAL_PRICE_PER_FT.find((r) => r.match.test(section))?.price ?? null;
}
