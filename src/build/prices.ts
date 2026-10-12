/**
 * Unit prices for the BOM (Phase 4). One table, next to the part sourcing; nothing else in `src/build` holds a dollar figure.
 *
 * Every entry says where the number comes from. `basis: 'quoted'` is reserved for a number the MODEL carries (`part.sourcing.costUsd`, which
 * the BOM reads directly and marks quoted); every entry in this file is an `estimate`: a realistic 2026 US retail price, rounded, to be
 * replaced by a real quote before ordering. No SKUs are invented: `source` names a kind of vendor, not a catalog number.
 */

export type PriceBasis = 'quoted' | 'estimate';

export interface Price {
  usd: number;
  /** What `usd` is per: 'bf', 'sheet', 'ft', 'ea', 'kit', 'qt', 'fl oz', 'roll'. */
  unit: string;
  source: string;
  basis: PriceBasis;
  note?: string;
}

const est = (usd: number, unit: string, source: string, note?: string): Price => ({ usd, unit, source, basis: 'estimate', ...(note ? { note } : {}) });

// ── Lumber and sheet ──────────────────────────────────────────────────────────

const HARDWOOD = 'Local hardwood dealer (rough, kiln-dried white oak)';
/** White oak, $/board foot on nominal thickness. Thick stock costs more per board foot (scarcer, slower to dry). */
export const OAK_PRICE_PER_BF: Record<string, Price> = {
  '4/4': est(9.5, 'bf', HARDWOOD, 'Select and better, 4/4 rough'),
  '5/4': est(10.5, 'bf', HARDWOOD),
  '6/4': est(11.5, 'bf', HARDWOOD),
  '8/4': est(13, 'bf', HARDWOOD),
  '12/4': est(18, 'bf', HARDWOOD, '12/4 is special-order at many yards'),
  '16/4': est(24, 'bf', HARDWOOD, 'special-order'),
};

const PLY_SUPPLIER = 'Local plywood supplier (marine okoume, full 4 x 8 sheet)';
/** Marine okoume (BS 1088), full 4 x 8 sheet from a local supplier (D-68). */
export const PLYWOOD_PRICE: Record<string, Price> = {
  '4 mm': est(95, 'sheet', PLY_SUPPLIER, '4 x 8 ft x 4 mm; the sides, box, lid and signs'),
  '12 mm': est(170, 'sheet', PLY_SUPPLIER, '4 x 8 ft x 12 mm; the deck and, from its offcut, the seat back'),
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
export const FASTENER_PRICE: Array<{ match: RegExp; price: Price }> = [
  { match: /^Domino DF 500 4x20/, price: est(0.3, 'ea', 'Festool Domino dealer', 'beech, in the 4 x 20 mm size') },
  { match: /^Domino DF 500 5x30/, price: est(0.4, 'ea', 'Festool Domino dealer', 'beech, in the 5 x 30 mm size') },
  { match: /^Domino/, price: est(0.4, 'ea', 'Festool Domino dealer') },
  { match: /screw eye/, price: est(1.25, 'ea', FAST) },
  { match: /Heat-set insert/, price: est(0.35, 'ea', FAST, 'brass heat-set insert for the printed ASA clips') },
  { match: /threaded insert/, price: est(0.95, 'ea', FAST, 'epoxy-in insert') },
  { match: /cap screw 1\/4/, price: est(1.1, 'ea', FAST) },
  { match: /Thumb-knob/, price: est(2.75, 'ea', FAST, 'thumb-knob screw') },
  { match: /\bM[34]\b/, price: est(0.25, 'ea', FAST) },
  { match: /machine screw/, price: est(0.35, 'ea', FAST) },
  { match: /wood screw/, price: est(0.3, 'ea', FAST) },
  { match: /screw/, price: est(0.3, 'ea', FAST) },
  { match: /lock nut 5\/8/, price: est(1.25, 'ea', FAST) },
  { match: /lock nut 3\/8/, price: est(0.6, 'ea', FAST) },
  { match: /lock nut/, price: est(0.4, 'ea', FAST) },
  { match: /fender washer 5\/8/, price: est(0.6, 'ea', FAST) },
  { match: /fender washer 3\/8/, price: est(0.4, 'ea', FAST) },
  { match: /fender washer/, price: est(0.3, 'ea', FAST) },
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
export const EPOXY_KITS: Array<{ id: string; label: string; mixedFlOz: number; price: Price }> = [
  { id: 'quart', label: 'West System 105-A resin + 206-A slow hardener, quart group', mixedFlOz: 38.4, price: est(92, 'kit', EPOXY, '32 fl oz resin + 6.4 fl oz hardener') },
  { id: 'gallon', label: 'West System 105-B resin + 206-B slow hardener, gallon group', mixedFlOz: 153.6, price: est(265, 'kit', EPOXY, '128 fl oz resin + 25.6 fl oz hardener; the pumps are extra') },
];
/** 207 special clear hardener for the two finish coats (the finishing schedule's buy list), per pint. */
export const EPOXY_207_PINT: Price = est(38, 'pt', EPOXY, '207 special clear hardener (non-blushing, clear): the finish coats; the resin is from the kit and the kit hardener covers the glue-ups');
export const EPOXY_PUMPS: Price = est(16, 'pair', EPOXY, 'metering pumps for the gallon and quart cans');
export const FILLERS: Record<string, Price> = {
  silica: est(26, 'ea', EPOXY, 'colloidal silica (406 type), for thickened glue and fillets'),
  microballoons: est(28, 'ea', EPOXY, 'low-density fairing filler (407 type), for fairing the sealed deck'),
};
export const GLASS_TAPE: Price = est(0.6, 'ft', EPOXY, '2" fiberglass tape, cut from a roll');

const FINISH = 'Paint store / marine supplier';
export const FINISH_PRICE: Record<string, Price> = {
  stain: est(18, 'qt', FINISH, 'wipe-on oak stain (or leave natural)'),
  conditioner: est(16, 'qt', FINISH, 'pre-stain conditioner or gel stain for the okoume, which blotches (BRIEF finishing stack)'),
  gelStain: est(20, 'qt', FINISH, 'gel stain for the okoume'),
  varnish: est(42, 'qt', FINISH, 'spar varnish with UV filters'),
  enamel: est(14, 'qt', FINISH, 'black enamel, for the lid legend (a pint is bought)'),
  thinner: est(11, 'qt', FINISH, 'thinner for varnish coat 1 and brush cleaning (a pint is bought)'),
  sandpaper: est(30, 'lot', 'Hardware store', 'discs and sheets, 80 to 320 grit, lump sum'),
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
