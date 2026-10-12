/**
 * Unit prices for the BOM (Phase 4). One table, next to the part sourcing; nothing else in `src/build` holds a dollar figure.
 *
 * Every entry says where the number comes from. `basis: 'quoted'` is a real price: one the MODEL carries (`part.sourcing.costUsd`), or one Eric
 * gathered from a named vendor's published list (the `quoted(...)` entries below, with the date and URL). Every other entry is an `estimate`: a realistic
 * 2026 US retail price, rounded, to be replaced by a real quote before ordering. No SKUs are invented: `source` names a vendor or a kind of vendor.
 * `url` is a real link Eric gave (the vendor's price list or product page); it goes to the BOM line, the BOM CSV and the build book. Never invent one.
 */

export type PriceBasis = 'quoted' | 'estimate';

export interface Price {
  usd: number;
  /** What `usd` is per: 'bf', 'sheet', 'ft', 'ea', 'kit', 'qt', 'fl oz', 'roll'. */
  unit: string;
  source: string;
  basis: PriceBasis;
  note?: string;
  /** A real link for this price (Eric's vendor page). Optional: only where we have one. */
  url?: string;
  /**
   * Sold in packs much larger than a sled needs (screws, nuts, washers, inserts, Dominos, tape...): the PACK size and pack price (ESTIMATES now; the price-research pass supplies real pack data).
   * `usd` is then the per-piece equivalent (`packUsd / packQty`), used when the build needs at least half a pack. A line that needs under `BULK_SHARE` of a pack (bom.ts) goes to the
   * 'Bulk parts' section and is priced by whole packs.
   */
  packQty?: number;
  packUsd?: number;
}

const est = (usd: number, unit: string, source: string, note?: string, url?: string): Price => ({ usd, unit, source, basis: 'estimate', ...(note ? { note } : {}), ...(url ? { url } : {}) });
const quoted = (usd: number, unit: string, source: string, note?: string, url?: string): Price => ({ usd, unit, source, basis: 'quoted', ...(note ? { note } : {}), ...(url ? { url } : {}) });

/** An estimated price for something sold in packs: `usd` is the per-piece equivalent of the pack price. */
const packed = (packQty: number, packUsd: number, unit: string, source: string, note?: string): Price => ({ ...est(packUsd / packQty, unit, source, note), packQty, packUsd });

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
/** Matched against the cut-list section text, first match wins. Priced per foot of cut length (suppliers sell metal cut to length by the foot). */
export const METAL_PRICE_PER_FT: Array<{ match: RegExp; price: Price }> = [
  { match: /DOM tube/, price: est(7, 'ft', METAL, '3/4" OD x 0.120" wall DOM (ASTM A513 Type 5); ask for the mill cert') },
  { match: /flat bar 1\/16/, price: est(7, 'ft', METAL, '316 stainless, thin bar') },
  { match: /flat bar/, price: est(30, 'ft', METAL, '316 stainless 1/4" bar') },
  { match: /angle/, price: est(24, 'ft', METAL, '316 stainless 1-1/2" angle') },
  { match: /aluminum|rectangular tube/i, price: est(9, 'ft', METAL, '6061-T6 1" x 1-1/2" x 0.13" wall') },
];
/** Allowance added to every metal cut for the saw kerf and the squared end (in). */
export const METAL_CUT_ALLOWANCE_IN = 0.25;

// ── Purchased parts, by partNo ────────────────────────────────────────────────

const MCM = 'Catalog supplier (McMaster-Carr class)';
/** Estimates for purchased parts whose model `sourcing.costUsd` is absent. A model cost always wins and is marked quoted. Matched on partNo. */
export const PURCHASED_PRICE: Array<{ match: RegExp; price: Price }> = [
  { match: /^wheel$/, price: est(24, 'ea', MCM, '10" pneumatic hand-truck wheel, 0.75" bore; the model rates 300 lb per wheel: read the listing') },
  { match: /^king-thrust$/, price: est(5, 'ea', MCM, 'UHMW 1/2" sheet offcut, cut a 3" disc') },
  { match: /^kingpin$/, price: est(9, 'ea', MCM, '5/8" grade 8 bolt, 2 washers, nylock nut') },
  { match: /^roll-pad$/, price: est(2, 'ea', MCM, 'UHMW 1/4" sheet offcut') },
  { match: /^bridle-sleeve$/, price: est(7, 'ea', MCM, 'oil-embedded bronze sleeve bearing') },
  { match: /^steer-eye$|^steer-anchor$/, price: est(7, 'ea', MCM, '3/8" forged shoulder eye bolt') },
  { match: /^steer-chain$/, price: est(10, 'ea', MCM, '11" of 3/16" chain and two quick links') },
  { match: /^bridle$/, price: est(14, 'ea', MCM, '11 ft of 3/8" nylon three-strand rope') },
  { match: /^scupper$/, price: est(5, 'ea', MCM, '316 drain nipple') },
  { match: /^brake-pad$/, price: est(4, 'ea', MCM, '3" x 3" neoprene or SBR pad') },
  { match: /^brake-cord$/, price: est(3, 'ea', MCM, 'shock cord and stop cord, two screw eyes are in the fasteners') },
  { match: /^brake-chock-cord$/, price: est(2, 'ea', MCM, '30" of 1/4" braided cord') },
  { match: /^handle-pin$/, price: est(5, 'ea', MCM, 'clevis pin and lynch pin') },
  { match: /^(lamp-clip|rear-lamp-clip)$/, price: est(3, 'ea', 'Printed in-house (ASA)', 'about 0.2 lb of filament, no support') },
];
export const PURCHASED_FALLBACK: Price = est(5, 'ea', 'No entry in prices.ts', 'UNPRICED: add the part to PURCHASED_PRICE');

// ── Fasteners (316 stainless unless noted), matched on the BOM label ──────────

const FAST = 'Fastener supplier (McMaster-Carr / Fastenal class), 316 stainless';
const DOMINO_DEALER = 'Festool Domino dealer';
export const FASTENER_PRICE: Array<{ match: RegExp; price: Price }> = [
  { match: /T-nut/i, price: packed(10, 9, 'ea', FAST, '316 prong or weld-style T-nut for the handle-socket backers (epoxied in); pack of 10') },
  { match: /shaft collar/i, price: est(6, 'ea', FAST, '316 set-screw collar, 3/4" bore, for the wheel end of each axle') },
  { match: /cotter pin/i, price: packed(25, 8, 'ea', FAST, '316 cotter pin through the 0.156" axle cross hole; pack of 25') },
  { match: /end plug/i, price: packed(10, 5, 'ea', FAST, 'plastic flanged plug for the DOM tube bore; pack of 10') },
  { match: /button plug/i, price: packed(25, 9, 'ea', FAST, 'black nylon button plug for the 5/8" access holes; pack of 25') },
  { match: /nylon washer/i, price: packed(50, 6, 'ea', FAST, 'nylon washer under the button head; pack of 50') },
  { match: /stainless rod/i, price: est(3, 'ea', FAST, 'cut from a 3/8" x 12" 316 rod (about $12): five pins per rod') },
  { match: /^Domino DF 500 4x20/, price: packed(300, 55, 'ea', DOMINO_DEALER, 'SIPO (sapele) Domino 4 x 20, the exterior type, NOT beech. VERIFY Festool lists a Sipo 4 x 20: if only beech exists, use 5 x 30 Sipo for the chine joints. Pack of 300 (estimate)') },
  { match: /^Domino DF 500 5x30/, price: packed(300, 75, 'ea', DOMINO_DEALER, 'SIPO (sapele) Domino 5 x 30, the exterior type, NOT beech. Pack of 300 (estimate)') },
  { match: /^Domino DF 500 8x50/, price: packed(130, 80, 'ea', DOMINO_DEALER, 'SIPO (sapele) Domino 8 x 50, the exterior type, NOT beech. Pack of 130 (estimate)') },
  { match: /^Domino/, price: packed(100, 50, 'ea', DOMINO_DEALER, 'SIPO (sapele) Domino, the exterior type, NOT beech. Pack of 100 (estimate: check the size)') },
  { match: /screw eye/, price: est(1.25, 'ea', FAST) },
  { match: /Heat-set insert/, price: packed(50, 12, 'ea', FAST, 'brass heat-set insert for the printed ASA clips; pack of 50') },
  { match: /threaded insert/, price: packed(25, 22, 'ea', FAST, '316 epoxy-in insert; pack of 25') },
  { match: /cap screw 1\/4/, price: est(1.1, 'ea', FAST) },
  { match: /Thumb-knob/, price: est(2.75, 'ea', FAST, 'thumb-knob screw') },
  { match: /\bM[34]\b/, price: packed(100, 9, 'ea', FAST, 'metric socket or pan-head screw; pack of 100') },
  { match: /machine screw/, price: packed(50, 11, 'ea', FAST, 'pack of 50') },
  { match: /wood screw/, price: packed(50, 9, 'ea', FAST, '316 wood screw; pack of 50 per length') },
  { match: /screw/, price: packed(50, 9, 'ea', FAST, 'pack of 50') },
  { match: /lock nut 5\/8/, price: packed(10, 14, 'ea', FAST, 'pack of 10') },
  { match: /lock nut 3\/8/, price: packed(50, 26, 'ea', FAST, 'pack of 50') },
  { match: /lock nut/, price: packed(50, 18, 'ea', FAST, 'pack of 50') },
  { match: /fender washer 5\/8/, price: packed(25, 15, 'ea', FAST, 'pack of 25') },
  { match: /fender washer 3\/8/, price: packed(100, 28, 'ea', FAST, 'pack of 100') },
  { match: /fender washer/, price: packed(100, 20, 'ea', FAST, 'pack of 100') },
  { match: /carriage bolt 3\/8/, price: est(3.75, 'ea', FAST, 'long 3/8" carriage bolt') },
  { match: /bolt 3\/8/, price: est(2.5, 'ea', FAST) },
  { match: /bolt 1\/4/, price: est(1.3, 'ea', FAST) },
  { match: /bolt/, price: est(2, 'ea', FAST) },
];
export const FASTENER_FALLBACK: Price = est(1, 'ea', 'No entry in prices.ts', 'UNPRICED: add the fastener to FASTENER_PRICE');

// ── Consumables ───────────────────────────────────────────────────────────────

const EPOXY = 'Marine supplier / local dealer';
/**
 * West System 105 resin with 206 slow hardener (5:1 by volume). Sold as resin plus hardener; priced here as a kit of the pair: the 105-A + 206-A quart group and the 105-B + 206-B gallon group.
 * `mixedFlOz` is the mixed volume the kit makes (resin plus hardener). The gallon group is cheaper per ounce (about $1.7 against $2.4 per mixed fl oz), and three quart groups cost more than one gallon group.
 */
export const EPOXY_KITS: Array<{ id: string; label: string; /** Resin in the kit (fl oz): what the coats and the glue-ups draw on. */ resinFlOz: number; mixedFlOz: number; price: Price }> = [
  { id: 'quart', label: 'West System 105-A resin + 206-A slow hardener, quart group', resinFlOz: 32, mixedFlOz: 38.4, price: est(92, 'kit', EPOXY, '32 fl oz resin + 6.4 fl oz hardener') },
  { id: 'gallon', label: 'West System 105-B resin + 206-B slow hardener, gallon group', resinFlOz: 128, mixedFlOz: 153.6, price: est(265, 'kit', EPOXY, '128 fl oz resin + 25.6 fl oz hardener; the pumps are extra') },
];
/** 207 special clear hardener for the two finish coats (the finishing schedule's buy list), per pint. */
/** Hardeners sold by the pint, by West System number: 205 fast and 206 slow come with the resin kits; 207 and 209 are bought for the coats and the slow closes (3:1 by volume). */
export const EPOXY_HARDENER_PINT: Record<string, Price> = {
  '205': est(34, 'pt', EPOXY, '205 fast hardener (5:1 with 105), for cold-shop glue-ups'),
  '206': est(36, 'pt', EPOXY, '206 slow hardener (5:1 with 105): in the resin kits'),
  '207': est(38, 'pt', EPOXY, '207 special clear hardener (3:1 with 105): the coats'),
  '209': est(40, 'pt', EPOXY, '209 extra slow hardener (3:1 with 105): the transom and bulkhead closes'),
};
/** Pump sets by West System number: 301 is the 5:1 set for 105 with 205/206, 303 the 3:1 set for 105 with 207/209. */
export const EPOXY_PUMP_SET: Record<string, Price> = {
  '301': est(18, 'pair', EPOXY, '301 pump set, 5:1 (105 with 205/206)'),
  '303': est(20, 'pair', EPOXY, '303 pump set, 3:1 (105 with 207/209)'),
};
export const EPOXY_207_PINT: Price = est(38, 'pt', EPOXY, '207 special clear hardener (non-blushing, clear): the finish coats; the resin is from the kit and the kit hardener covers the glue-ups');
export const EPOXY_PUMPS: Price = est(16, 'pair', EPOXY, 'metering pumps for the gallon and quart cans');
export const FILLERS: Record<string, Price> = {
  silica: est(26, 'ea', EPOXY, 'colloidal silica (406 type), for thickened glue and fillets'),
  microballoons: est(28, 'ea', EPOXY, 'low-density fairing filler (407 type), for fairing the sealed deck'),
};
/** Items that exist only as text in a note or a joint (see `NOTE_ITEMS` in bom.ts). */
export const NOTE_PRICE: Record<string, Price> = {
  dualLock: est(18, 'roll', 'Hardware / 3M distributor', '3M Dual Lock reclosable fastener, 1" x 5 ft, adhesive back'),
  edgeBanding: est(14, 'roll', 'Woodworking store', 'pre-glued white oak veneer edge banding, 3/4" wide, 25 ft roll (iron on, flush trim)'),
  sealant: est(22, 'ea', 'Marine supplier', 'polysulfide marine sealant, 10 oz cartridge (bedding aluminum, steel and the gasket splice)'),
  contactCement: est(14, 'ea', 'Hardware store', 'contact cement, pint (brake pads and treads, veneer banding)'),
};
export const GLASS_TAPE: Price = packed(50, 24, 'ft', EPOXY, '2" fiberglass tape; the roll is 50 ft, the sled uses about 15 ft');

const FINISH = 'Paint store / marine supplier';
export const FINISH_PRICE: Record<string, Price> = {
  stain: est(18, 'qt', FINISH, 'wipe-on oak stain (or leave natural)'),
  conditioner: est(16, 'qt', FINISH, 'pre-stain conditioner or gel stain for the okoume, which blotches (BRIEF finishing stack)'),
  gelStain: est(20, 'qt', FINISH, 'gel stain for the okoume'),
  varnish: est(42, 'qt', FINISH, 'spar varnish with UV filters'),
  enamel: est(14, 'qt', FINISH, 'black enamel, for the lid legend (a pint is bought)'),
  thinner: est(11, 'qt', FINISH, 'thinner for varnish coat 1 and brush cleaning (a pint is bought)'),
  sandpaper: { ...est(30, 'lot', 'Hardware store', 'discs and sheets, 80 to 320 grit, lump sum'), packQty: 1, packUsd: 30 },
  supplies: est(35, 'lot', 'Hardware store', 'brushes, foam rollers, mixing cups, gloves, acetone, tack cloth'),
};

/** Price of a container relative to a quart, for the finishing schedule's buy list: a pint costs about 0.6 of a quart, a gallon about 3.2 quarts. */
export const FINISH_CONTAINER_FACTOR: Record<'pt' | 'qt' | 'gal', number> = { pt: 0.6, qt: 1, gal: 3.2 };

/** Reference prices for the sewn parts (the model carries their costs: 55 and 25); kept here so they can be re-priced by area or yardage. */
export const SOFT_GOODS: Record<string, Price> = {
  vinylPerYard: est(22, 'yd', 'Marine fabric supplier', 'marine vinyl, 54" wide'),
  foamPerSheet: est(40, 'ea', 'Foam supplier', '1" closed-cell polyethylene, 24" x 24"'),
};

// ── Lookups ───────────────────────────────────────────────────────────────────

export function purchasedPrice(partNo: string): Price {
  return PURCHASED_PRICE.find((r) => r.match.test(partNo))?.price ?? PURCHASED_FALLBACK;
}
export function fastenerPrice(label: string): Price {
  return FASTENER_PRICE.find((r) => r.match.test(label))?.price ?? FASTENER_FALLBACK;
}
export function metalPrice(section: string): Price | null {
  return METAL_PRICE_PER_FT.find((r) => r.match.test(section))?.price ?? null;
}
