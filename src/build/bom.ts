/**
 * Bill of materials with costs (Phase 4). Plain TS, no three.js; a pure function of (parts, params).
 *
 * Sections: Lumber (the suggested WHOLE oak boards by thickness, from `nesting.ts`: a yard sells boards, not net board feet), Plywood (sheets, from the nest), Metal stock
 * (cut-to-length feet), Purchased parts (by partNo), Fasteners (expanded from the joint list), Consumables (epoxy, fillers, tape, finish, sandpaper). The epoxy and the finish
 * products come from `finishingSchedule` (its buy list, so the BOM and the schedule agree) plus the epoxy for the glue joints.
 * Prices come from `prices.ts`; a number the model carries (`sourcing.costUsd`) is `quoted`, and so is every table price from the web price research of 2026-10-12 and 2026-10-14 (with its URL); the rest are
 * `estimate`s. Shop stock Eric already owns (D-79: the Dominos, sandpaper, the supplies lot, Titebond III, mineral spirits, contact cement, paracord) is `owned`: a $0 line that stays visible and is never an estimate. A line's alternatives (cheaper or different items that do not meet the spec, labelled SPEC GAP) are in its notes and in `BomLine.alternatives`; a line that needs a decision from
 * Eric (`BomLine.decision`) is listed in `Bom.decisions`.
 *
 * Fasteners mirror `fastenerBreakdown` (src/model/lighting.ts): a joint listed on both of its parts counts once, a joint to a part that is
 * not in the configuration is skipped, and the `hardware` mass allowance is replaced by the expanded list. Unlike the mass allowance, the
 * bolts of the axle clamps and hold-downs are listed (their plates are parts, their bolts are not), and only the shank-itemized bolts
 * (steering eye bolts, kingpin) are left out of the bolt lines.
 *
 * Finishing touches (Eric, 2026-10-12): the lights, the seat cushions, the reflectors and the lash-point tie-downs are priced as their own section AFTER the core ones, so the
 * cost of the sled can be read with and without them. `touchGroupOfPart` says which parts belong, and every fastener or consumable that exists for one of them (the lamp-clip inserts and
 * screws, the hook-and-loop strips, the lash-plate screws) follows its part.
 *
 * Pack-priced parts: an item sold in packs much larger than the sled needs (screws, nuts, washers, inserts, T-nuts, Dominos, cotter pins, plugs) is priced by the whole PACK in
 * its own section (Fasteners, or the touches for a touches fastener), with a note that the rest may already be in the shop (`isBulkQty`: the build needs under `BULK_SHARE` of the
 * smallest pack). There is no separate bulk section any more (Eric, 2026-10-19: with the cost pass it held one $5 line). Sandpaper is a Consumables line.
 * `Bom.coreUsd + Bom.touchesUsd = Bom.totalUsd`.
 *
 * Every fastener and hardware line carries a `materialNote` (exterior use: what it must be made of, by where it lives).
 */
import { localBounds } from '../model/bounds';
import { buildModel } from '../model';
import { totalMass } from '../model/mass';
import { STD_WOOD_SCREWS } from '../model/rear-mount';
import type { Joint, Part } from '../model/types';
import { WEATHER_SPEC, thinSheet, type Params } from '../params';
import { cutList, fracIn, groupedName, isBuilt, partKey, toCsv, type CsvCell } from './cutlist';
import { ceilTo, fractionText, fractionizeInches, inchMarks } from './units';
import { EPOXY_BUY_RE, finishingSchedule, glueEpoxyFlOz } from './finishing';
import { nestPlywood, oakBoardFeet, type OakPlan } from './nesting';
import {
  EPOXY_KITS, EPOXY_KITS_SMALL, EPOXY_PUMPS_300, FILLERS, FINISH_CONTAINER_FACTOR, FINISH_CONTAINER_PRICE, FINISH_PRICE, GLASS_TAPE, METAL_CUT_ALLOWANCE_IN, NOTE_PRICE, OAK_ALT_PRICE_PER_BF, OAK_PRICE_PER_BF, PLYWOOD_PRICE, RESEARCH_DATE,
  OWNED_NOTE, PURCHASED_FALLBACK, TITEBOND_OWNED, URETHANE_CONTAINER_PRICE, fastenerPrice, metalPrice, modelCostNote, purchasedDescribe, purchasedEntry, specOf, std304, type Price, type PriceBasis, type SpecName,
} from './prices';

// ── Consumable assumptions (all estimates) ─
/** Mixing, pot and brush waste on top of the glue epoxy of `glueEpoxyFlOz` (finishing.ts: per-joint-type estimates, before waste). The coats' quantities carry their own waste. */
export const EPOXY_WASTE = 0.2;
/** Resin share of the mixed volume for the West System groups only (5:1, 105 resin with 206 hardener). The small kits carry their own `resinShare` (U.S. Composites 635 is 2:1, D-79). */
const RESIN_SHARE_GLUE = 5 / 6;
const RESIN_SHARE_COAT = 5 / 6;
/** Glass tape per taped joint (ft), and the waste on top. */
export const TAPE_FT_PER_JOINT = 1.5;
export const TAPE_WASTE = 0.25;
/** A single epoxy kit with less than this share of its mixed volume to spare gets a "plan a second kit or a top-up" note. */
export const EPOXY_THIN_MARGIN = 0.15;
/** Mixed fluid ounces in a quart. */
const FLOZ_PER_QT = 32;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BomLine {
  section: string;
  /** partNo, or a short item key. */
  key: string;
  description: string;
  qty: number;
  unit: string;
  unitUsd: number;
  extUsd: number;
  basis: PriceBasis;
  vendor?: string;
  notes?: string;
  /** Built part ids the line covers (purchased parts). */
  partIds?: string[];
  /** A real link for the item (the price's or the part's `sourcing.url`): the vendor page Eric gave. Never invented. */
  url?: string;
  /** Finishing-touches lines only: which group the line belongs to. */
  group?: TouchGroup;
  /**
   * Priced by the pack (a pack-priced fastener, or a pack-priced line of the touches): `needed` is the quantity the build uses, `packQty` the pack size, `packs` the packs to buy and `packUsd` the cost of one pack.
   * `qty` is then the packs to buy and `unit` says "pack of N", so `extUsd = qty x unitUsd` still holds; `unitUsd` is the pack price.
   */
  needed?: number;
  packQty?: number;
  packs?: number;
  packUsd?: number;
  /** Cheaper or different options for the same item (`Price.alternatives`): spec gaps are flagged, never substituted. Also summarized in `notes`. */
  alternatives?: Price[];
  /** A decision Eric must make about this line (an item that does not exist as specified, a spec change): also in `Bom.decisions`. */
  decision?: string;
  /** What the fastener or hardware must be made of, for exterior use, by where it lives ("316 stainless REQUIRED: ..."). Set on every fastener and metal hardware line. */
  materialNote?: string;
}

/** A pack-priced line gets the "you may already have these" note when the build needs less than this share of the smallest pack. */
export const BULK_SHARE = 0.5;
/** True when `qty` pieces are under `BULK_SHARE` of the price's smallest pack (a price without a pack is never bulk): the line gets the "you may already have these" note. */
export const isBulkQty = (price: Price, qty: number): boolean => !!price.packQty && !!price.packUsd && qty < BULK_SHARE * price.packQty;

/**
 * Why every fastener is 316 stainless in the EXTREME spec, said once (the section note): S7 bars zinc, brass and plated steel from wet white oak, because oak tannins corrode them and stain the wood black. 304 stainless
 * is a possible cost cut where a line says "(304 or 316)"; the Extreme prices here are 316.
 */
export const FASTENER_MATERIAL_NOTE =
  'Exterior use: every fastener is 316 stainless (no zinc, brass or plated steel in wet white oak, because oak tannins corrode them and stain the wood black). ' +
  'The Dominos are beech from the shop, epoxied in (epoxy everywhere under this spec, so the exterior Sipo type is not bought). 304 stainless is a possible cost cut where a line says "304 or 316"; the prices here are for 316 (base prices first).';
/** The same for the STANDARD spec (garage-kept, used a few times a year, wet at most at a rainy derby): 304 / 18-8 stainless, zinc where it never sees the oak, beech Dominos. */
export const FASTENER_MATERIAL_NOTE_STANDARD =
  'Standard weather spec (garage-kept, used a few times a year, wet at most at a rainy derby): the screws, bolts, nuts, washers, T-nuts and pins are 18-8 (304) stainless, which tannins in wet oak will stain a little but not corrode in a garage; the shaft collars and the threaded inserts are zinc-plated; the eye bolts are galvanized. ' +
  'The Dominos are beech (the interior type, fine kept dry). Use 316 for any of it if the sled will live outside or near salt: the weather setting switches the BOM.';

const DECK_OK_PARTS = /^(storage-lid-batten|storage-rim|storage-coaming|seat-wedge|seat-crest|sign-)/;
const SHELTERED_PARTS = /^(storage-|seat-(hinge|back|wedge|crest|pin)|sign-|flag-)/;
/**
 * The material a fastener line must be made of, by label and by the parts it fixes. First match wins. `usedOn` are the ids of the parts of the joints that need the item (empty: unknown, so
 * the strict default applies).
 */
export function fastenerMaterialNote(label: string, usedOn: readonly string[] = [], spec: SpecName = 'extreme'): string {
  const std = spec === 'standard';
  if (/^Domino/.test(label)) return std
    ? 'Festool BEECH Dominos from the shop: the interior type, swells and rots if it stays wet. Fine in a sled kept in a garage and wet at most at a rainy derby; glue them in with Titebond III.'
    : 'Festool BEECH Dominos from the shop, epoxied in: epoxy coats every mortise and tenon under this spec, which keeps the water out. (The exterior Sipo type is not bought.)';
  if (/heat-set insert/i.test(label)) return 'Brass heat-set insert OK: it sits in the printed ASA lamp clip, not in wet oak (brass is barred only from wet oak).';
  if (/nylon washer|button plug|end plug/i.test(label)) return 'Nylon or plastic, UV-stable: no metal involved.';
  if (/\bM[34]\b/.test(label)) return 'Stainless (304 or 316): screws into the brass insert in the printed clip, away from the oak.';
  if (std && /shaft collar/i.test(label)) return 'Zinc-plated steel is right for the Standard spec (garage-kept); it rusts and stains the axle end if the sled lives outside (use the Extreme spec, 316).';
  if (std && /threaded insert/i.test(label)) return 'Zinc insert, epoxied into the oak: fine in a dry garage; use stainless (Extreme spec) near salt.';
  if (/cotter pin|shaft collar|stainless rod/i.test(label)) return std ? '18-8 (304) stainless at the wheel end of the axle or in the handle pins: right for the Standard spec.' : '316 stainless REQUIRED: at the wheel end of the axle or in the handle pins, in slush and road salt; plated steel rusts in a week.';
  const on = usedOn.length ? usedOn : ['?'];
  const ss = std ? '18-8 (304) stainless' : '316 stainless';
  if (/wood screw/i.test(label) && on.every((id) => DECK_OK_PARTS.test(id))) return `Exterior-coated deck screw OK (hidden, epoxy-sealed, wood to wood, lightly loaded); ${ss} is the spec and what the price assumes.`;
  if (on.every((id) => SHELTERED_PARTS.test(id))) return `Stainless (304 or 316): sheltered in the storage box or under the seat; ${std ? '18-8 (304)' : '316'} is the spec and what the price assumes.`;
  return std
    ? '18-8 (304) stainless: right for the Standard spec (garage-kept). Tannins in wet oak stain it black over the years; use 316 (Extreme spec) if the sled lives outside.'
    : '316 stainless REQUIRED: in wet white oak (tannins corrode coated steel and stain the wood black). 304 is a possible cost cut, not priced.';
}

const METAL_SPEC = /stainless|316|steel|bronze|zinc|galvanized|grade \d|hinge|chain|latch|clevis|hitch|snap hook|D-ring/i;
/** The material note of a purchased hardware part (hinges, latches, pins, chain, eye bolts...), from the model's own spec; undefined for rope, foam, rubber, plastic, lights and other non-metal parts. */
export function hardwareMaterialNote(x: Part, spec: SpecName = 'extreme'): string | undefined {
  const m = x.material ?? '';
  if (x.kind !== 'purchased' || !METAL_SPEC.test(m)) return undefined;
  if (spec === 'standard') {
    if (/316|stainless/i.test(m)) return `304 / 18-8 stainless is right for the Standard spec (garage-kept); the model says "${m}" for the Extreme spec, which uses 316.`;
    if (/zinc|galvanized|grade \d|steel/i.test(m)) return `As specified: ${m}. Galvanized or zinc is right for the Standard spec (garage-kept); 316 for the Extreme spec.`;
    return `As specified: ${m}.`;
  }
  if (/316/.test(m)) return `316 stainless REQUIRED (the model spec: ${m}).`;
  if (/stainless/i.test(m)) return `Stainless REQUIRED, 316 for wet oak (the model spec: ${m}).`;
  if (/zinc|galvanized|grade \d|steel/i.test(m)) return `As specified: ${m}. Plated or galvanized steel rusts and stains white oak black; 316 stainless is the default, so check the listing before ordering.`;
  return `As specified: ${m}.`;
}

/** The four groups of the 'Finishing touches' section (Eric, 2026-10-12). */
export type TouchGroup = 'lights' | 'seat' | 'reflectors' | 'tie-downs';
export const TOUCH_GROUPS: ReadonlyArray<{ id: TouchGroup; title: string }> = [
  { id: 'lights', title: 'Lights' },
  { id: 'seat', title: 'Seat comfort' },
  { id: 'reflectors', title: 'Reflectors' },
  { id: 'tie-downs', title: 'Tie-downs' },
];
/** The finishing-touches group of a part, by part number; undefined for every part of the core build. The side ribs, knees and box ties that carry the D-rings are oak cut from the boards (priced in Lumber), but the bolts follow the D-ring plates. */
export function touchGroupOfPart(x: Part | undefined): TouchGroup | undefined {
  switch (x ? partKey(x) : '') {
    case 'front-light': case 'rear-light': case 'lamp-clip': case 'rear-lamp-clip': return 'lights';
    case 'seat-cushion': case 'seat-back-pad': return 'seat';
    case 'reflector': return 'reflectors';
    case 'lash-point': return 'tie-downs';
    default: return undefined;
  }
}
/** Parts bought and priced as a line of their own in the touches section: the side ribs are NOT (they are cut from the oak offcuts and priced in Lumber). */
export const TOUCH_PRICED_PARTS: ReadonlySet<string> = new Set(['front-light', 'rear-light', 'lamp-clip', 'rear-lamp-clip', 'seat-cushion', 'seat-back-pad', 'reflector', 'lash-point']);

/** The Fasteners section note on pack-priced lines and shop stock. */
export const FASTENER_PACK_NOTE = 'Some lines are sold in packs much larger than the sled needs, so they are priced by the whole pack; you may already have these in the shop, so keep the rest for the next project. The Dominos are shop stock you already own: listed at $0 so they are not forgotten.';

/** Id and title of the section that holds the touches. */
export const TOUCHES_SECTION = { id: 'touches', title: 'Finishing touches' } as const;

export interface BomGroupTotal { id: TouchGroup; title: string; subtotalUsd: number; estimateUsd: number }

export interface BomSection {
  id: 'lumber' | 'plywood' | 'metal' | 'purchased' | 'fasteners' | 'consumables' | 'touches';
  title: string;
  lines: BomLine[];
  subtotalUsd: number;
  /** The part of the subtotal that is an estimate. */
  estimateUsd: number;
  /** The touches section: subtotals by group (lights, seat comfort, reflectors, tie-downs); each line carries its `group`. */
  groups?: BomGroupTotal[];
  /** Notes printed under the section (the side ribs are in Lumber). */
  notes?: string[];
}

export interface FastenerJointCounts { screw: number; bolt: number; 'threaded-insert': number; knob: number; domino: number; glue: number }

/** The same design priced under both weather specs (D-73): what the Extreme spec adds. Differences are Extreme minus Standard. */
export interface WeatherCompare {
  /** False on the inner `bom` call that builds the comparison (it carries no comparison of its own). */
  computed: boolean;
  /** The spec the BOM it hangs on was made for. */
  activeSpec: SpecName;
  standardUsd: number;
  extremeUsd: number;
  /** extremeUsd - standardUsd: what Extreme weather adds. */
  deltaUsd: number;
  /** Extreme minus Standard for each section, by section id ('lumber', 'plywood', 'metal', 'purchased', 'fasteners', 'consumables', 'touches'). */
  deltaBySection: Record<string, number>;
  deltaCoreUsd: number;
  deltaTouchesUsd: number;
  /** Empty-sled mass (lb) under each spec, and Extreme minus Standard (the thin sheet is the only part of the weather spec the model reads). */
  standardLb: number;
  extremeLb: number;
  deltaLb: number;
  thinSheetStandard: string;
  thinSheetExtreme: string;
}

export interface Bom {
  /** The weather spec this BOM is priced for. */
  spec: SpecName;
  /** The thin sheet in effect (name from `thinSheet(p)`). */
  thinSheetName: string;
  /** The same design under the other spec (see `bom`): computed on first read; not an enumerable property. */
  readonly weatherCompare: WeatherCompare;
  sections: BomSection[];
  totalUsd: number;
  estimateUsd: number;
  /** estimateUsd / totalUsd. */
  estimateShare: number;
  /** The core sections (lumber to consumables) and the touches section: `coreUsd + touchesUsd = totalUsd`. */
  coreUsd: number;
  touchesUsd: number;
  /** The estimated part of each, and its share (0 to 1) of that subtotal. */
  coreEstimateUsd: number;
  touchesEstimateUsd: number;
  coreEstimateShare: number;
  touchesEstimateShare: number;
  /** "Build $2,100.00 + finishing touches $240.00 = $2,340.00, excluding shipping and tax" */
  totalsText: string;
  /** The vendors on this BOM that ship the order (so freight is extra), in `SHIPPING_VENDORS` order. Empty when none is on the list. */
  shippingVendors: string[];
  /** Why the total is short of the card charge: "Shipping and tax are not in these prices. These orders ship: ..." (no number is invented). */
  shippingNote: string;
  /** Joint counts the fastener lines were expanded from (equal to `fastenerBreakdown`'s counts). */
  jointCounts: FastenerJointCounts;
  /** Parts or fasteners with no price in prices.ts (empty at the defaults). */
  unpriced: string[];
  /**
   * `epoxyFlOz` = mixed epoxy the purchase covers: `finishEpoxyFlOz` (the schedule's one seal coat, 5:1) + `closeEpoxyFlOz` (0 now: the closes are glue joints, 206, inside `glueEpoxyFlOz`) + `glueEpoxyFlOz` (the glue joints
   * from `glueEpoxyFlOz()` in finishing.ts plus `EPOXY_WASTE`, 5:1). `resinFlOz` is the resin of that mix. `sealedFt2` is the plywood surface the Extreme saturation coat covers (0 under the Standard spec, which coats edges, end grain and the deck underside only).
   */
  consumables: {
    epoxyFlOz: number; finishEpoxyFlOz: number; closeEpoxyFlOz: number; glueEpoxyFlOz: number; resinFlOz: number;
    sealedFt2: number; oakFt2: number; plyFt2: number; glueJoints: number; tapeFt: number;
  };
  /** Fastener lines (screws and bolts) that carry no length: empty when every line is orderable. */
  unresolved: string[];
  /** Keys of the lines that need a decision from Eric (the line's `decision` says what): the Domino 4x20, the wheel spec, the shaft collars, the eye bolts, the carriage bolts. */
  decisions: string[];
  /** The lumber section prices the suggested whole boards now, so there is no extra to add: always 0 (kept for older readers of this field). */
  wholeBoardsExtraUsd: number;
  /** What the old pricing (net board feet plus the waste allowance) would have cost, for comparison with the lumber subtotal. */
  lumberAllowanceUsd: number;
  /** The same whole boards at the alternative (`OAK_ALT_PRICE_PER_BF`, The Wood Yard, the other Atlanta yard); thicknesses with no alternative count at the base price. */
  lumberAltUsd: number;
  csv: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const money = (v: number): number => Math.round(v * 100) / 100;
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** "Alternatives: ..." for the notes of a line that needs `count` pieces: each option with its price for these pieces and its spec gap, if any. */
export function alternativesNote(price: Price, count: number): string | undefined {
  if (!price.alternatives?.length) return undefined;
  const parts = price.alternatives.map((a) => {
    const ext = a.packQty && a.packUsd ? Math.max(1, Math.ceil(count / a.packQty - 1e-9)) * a.packUsd : count * a.usd;
    const each = a.packQty && a.packUsd ? `${usdText(a.packUsd)} per ${a.packLabel ?? `pack of ${a.packQty}`}` : `${usdText(a.usd)}/${a.unit}`;
    return `${a.source} ${each} = ${usdText(ext)} for these${a.basis === 'estimate' ? ' (estimate)' : ''}: ${a.note ?? ''}${a.url ? ` ${a.url}` : ''}`.trim();
  });
  return `Alternatives (not substituted): ${parts.join(' | ')}`;
}
/** What a price adds to a line: its alternatives and its decision. */
const priceExtras = (price: Price, count: number): Partial<BomLine> => ({
  ...(price.alternatives?.length ? { alternatives: price.alternatives } : {}),
  ...(price.decision ? { decision: price.decision } : {}),
  ...(alternativesNote(price, count) ? { notes: alternativesNote(price, count) } : {}),
});
/** A part's name in running shop text: no parenthetical, lower case ("brake foot tread L"), never its key. */
const shopName = (x: Part): string => x.name.replace(/\s*\([^)]*\)\s*$/, '').trim().replace(/^([A-Z])([a-z])/, (_m, a: string, b: string) => a.toLowerCase() + b);
const joinNotes = (...n: Array<string | undefined>): string | undefined => n.filter(Boolean).join(' ') || undefined;

function line(section: string, key: string, description: string, qty: number, price: Price, extra: Partial<BomLine> = {}): BomLine {
  const px = priceExtras(price, qty);
  // Shop stock (D-79): the line says so first, once.
  const ownNote = price.basis === 'owned' && !(extra.notes ?? '').includes(OWNED_NOTE) ? price.note : undefined;
  const notes = joinNotes(ownNote, extra.notes, px.notes);
  return { section, key, description, qty, unit: price.unit, unitUsd: price.usd, extUsd: money(qty * price.usd), basis: price.basis, ...(price.url ? { url: price.url } : {}), ...px, ...extra, ...(notes ? { notes } : {}) };
}
function section(id: BomSection['id'], title: string, lines: BomLine[], extra: Partial<BomSection> = {}): BomSection {
  return {
    id, title, lines,
    subtotalUsd: money(lines.reduce((a, l) => a + l.extUsd, 0)),
    estimateUsd: money(lines.filter((l) => l.basis === 'estimate').reduce((a, l) => a + l.extUsd, 0)),
    ...extra,
  };
}

/** "$2,279.80": dollars and cents with a thousands separator (the same format the Build tab prints). */
export const usdText = (v: number): string => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** The text every total carries: shipping and sales tax are not in any price. */
export const SHIPPING_TAX_PHRASE = 'excluding shipping and tax';
/** "Build $X + finishing touches $Y = $Z, excluding shipping and tax". */
export const totalsLine = (core: number, touches: number, total: number): string =>
  `Build ${usdText(core)} + finishing touches ${usdText(touches)} = ${usdText(total)}, ${SHIPPING_TAX_PHRASE}`;
/**
 * Online or mail-order sellers on the BOM whose orders ship (freight is extra, and no shipping figure was read for any of them). Bicycle Warehouse ships unless the lights are bought in
 * its store; the others have no walk-in counter in Atlanta. Local pickups (Peach State Lumber, Harbor Freight, Home Depot, Ace, Rockler) are not listed.
 */
export const SHIPPING_VENDORS: ReadonlyArray<{ match: RegExp; name: string }> = [
  { match: /U\.S\. Composites/, name: 'U.S. Composites' },
  { match: /Speedy Metals/, name: 'Speedy Metals' },
  { match: /Online Metals/, name: 'Online Metals' },
  { match: /Bolt Depot/, name: 'Bolt Depot' },
  { match: /Knot & Rope Supply/, name: 'Knot & Rope Supply' },
  { match: /Bicycle Warehouse/, name: 'Bicycle Warehouse (unless bought in the store)' },
  { match: /Blue Dog Ink/, name: 'Blue Dog Ink' },
];
export const shippingNoteText = (vendors: readonly string[]): string =>
  `Shipping and sales tax are not in any price here (no shipping figure was read, so none is invented).${vendors.length ? ` These orders ship, so freight is extra: ${vendors.join(', ')}. Batch each vendor's items into one order.` : ''}`;

/**
 * A line priced by the pack: `needed` pieces, `ceil(needed / packQty)` packs at `packUsd` each. `qty` carries the packs so `extUsd = qty x unitUsd`; the note says what to do with the rest.
 */
function packLine(section: string, key: string, description: string, needed: number, price: Price, extra: Partial<BomLine> = {}, shop = true): BomLine {
  const packQty = price.packQty!, packUsd = price.packUsd!;
  const packs = Math.max(1, Math.ceil(needed / packQty - 1e-9));
  const unit = price.packLabel ?? (packQty === 1 ? price.unit : `pack of ${packQty}`);
  const own = price.note ? `${price.note}. ` : '';
  const unitWord = price.unit === 'lot' ? 'lot' : price.unit === 'ft' ? 'ft' : 'pcs';
  const sold = price.packLabel ? `sold as a ${price.packLabel}: buy ${packs}` : `sold in packs of ${packQty}: ${packs} pack${packs === 1 ? '' : 's'}`;
  const needText = price.unit === 'ft' ? `${fractionText(ceilTo(needed * 12, 1 / 8), 8)}"` : `${r2(needed)} ${unitWord}`; // a length is said in inches, as a shop fraction rounded up
  const share = `Need ${needText}, ${sold} at ${usdText(packUsd)}.${shop ? ' You may already have these in the shop; keep the rest.' : ''}`;
  const px = priceExtras(price, needed);
  return {
    section, key, description, qty: packs, unit, unitUsd: packUsd, extUsd: money(packs * packUsd), basis: price.basis, ...(price.url ? { url: price.url } : {}),
    needed, packQty, packs, packUsd, ...(px.alternatives ? { alternatives: px.alternatives } : {}), ...(px.decision ? { decision: px.decision } : {}), ...extra, notes: joinNotes(own + share, extra.notes, px.notes),
  };
}

const KNOWN_VENDORS = ['McMaster-Carr', 'Foam Factory', 'Sailrite', 'Hancock Fabrics', 'Fastenal', 'Festool'];
/** A short vendor name from the model's long sourcing text; the full text goes in the notes. */
export function shortVendor(vendor: string | undefined, kind: Part['kind']): string {
  if (kind === 'printed') return 'Printed in-house';
  if (!vendor) return 'Local / online';
  const found = KNOWN_VENDORS.filter((v) => vendor.includes(v));
  if (/Sailrite|Hancock/.test(vendor) && !found.includes('Sailrite')) found.push('Sailrite');
  if (found.length) return found.join(' / ');
  if (/^Generic/.test(vendor)) return 'Generic (online)';
  const head = vendor.split(/[(:;]/)[0].trim();
  return head.length > 40 ? head.slice(0, 40).replace(/\s+\S*$/, '') : head;
}

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);

// ── Fastener expansion ────────────────────────────────────────────────────────

const LEN = String.raw`(\d+(?:-\d+\/\d+|\/\d+|\.\d+)?[½¼¾]?)`;
const DIAS: Array<[number, string, string]> = [[0.25, '1/4', '20'], [0.3125, '5/16', '18'], [0.375, '3/8', '16'], [0.5, '1/2', '13'], [0.625, '5/8', '11']];
const nearestDia = (v: number): [number, string, string] => DIAS.reduce((a, b) => (Math.abs(b[0] - v) < Math.abs(a[0] - v) ? b : a));
const lenText = (s: string): string => {
  if (/^\d*\.\d+$/.test(s)) return fracIn(Number(s));
  return s;
};

/** Lengths (in) a fastener supplier stocks, for the lengths this file computes from part thicknesses. */
export const STOCK_LENGTHS_IN: readonly number[] = [3 / 8, 1 / 2, 5 / 8, 3 / 4, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.5, 4, 5, 6];
export const roundUpStock = (v: number): number => STOCK_LENGTHS_IN.find((l) => l >= v - 1e-6) ?? Math.ceil(v);
export const roundDownStock = (v: number): number => [...STOCK_LENGTHS_IN].reverse().find((l) => l <= v + 1e-6) ?? STOCK_LENGTHS_IN[0];

/** Allowance past the stack for a through bolt: a washer each side, the nylon-insert nut and a thread beyond it (in). */
export const THROUGH_BOLT_ALLOWANCE_IN = 0.4;
/** Thread engagement a wood screw gets in oak at most (in): 3/4 in holds a #8 to #10 well past what the joint loads; a thinner mate is drilled to leave 1/8 in. */
export const SCREW_BITE_IN = 0.75;
/** A hinge leaf is 1/16 in thick (the model's 316 butt hinges), so a machine screw into a hinge insert is one leaf longer than the insert. */
export const HINGE_LEAF_IN = 1 / 16;

/** Parts by id, for the thickness lookups of the length fallback. */
type PartMap = Map<string, Part>;

/** Finished thickness of a part through a joint (in): the thinnest stock dimension (times plies), else the thinnest side of its geometry box. 0 when unknown. */
export function thicknessIn(x: Part | undefined): number {
  if (!x) return 0;
  if (x.stock) return Math.min(x.stock.t, x.stock.w, x.stock.l) * (x.plies ?? 1);
  const b = localBounds(x.geometry);
  return Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
}

/**
 * Parts a through bolt also passes, beyond the two ends of its joint. The joint note lists them and the model gives no length (D-57 grab boards: board, inner band, web,
 * outer band, then the 1/16 in backing strip). Keyed by the part that owns the joint; `{s}` is its L or R. A test checks that each cited id exists.
 */
export const THROUGH_STACKS: Array<{ part: RegExp; also: (side: string) => string[]; note: string }> = [
  { part: /^seat-grip-([LR])$/, also: (s) => [`side-${s}-web`, `side-${s}-gunwale`, `seat-grip-backing-${s}`], note: 'seat-grip joint note: board, inner band, web, outer band and the 1/16" backing strip' },
];

/** Length of a through bolt from the parts it crosses, rounded up to a stock length (in); 0 when a part has no thickness. */
export function boltLengthFromStack(part: Part, j: Joint, byId: PartMap): number {
  const rule = THROUGH_STACKS.find((r) => r.part.test(part.id));
  const m = rule?.part.exec(part.id);
  const ids = [j.to, ...(rule && m ? rule.also(m[1]) : [])];
  const stack = thicknessIn(part) + ids.reduce((a, id) => a + thicknessIn(byId.get(id)), 0);
  const mates = ids.map((id) => byId.get(id));
  if (!thicknessIn(part) || mates.some((q) => !thicknessIn(q))) return 0;
  return roundUpStock(stack + THROUGH_BOLT_ALLOWANCE_IN);
}

/** Length of a wood screw that fixes the thinner part to the thicker one: the thin part plus the bite into the thick one (in); 0 when unknown. */
export function screwLengthFromStack(part: Part, j: Joint, byId: PartMap): number {
  const a = thicknessIn(part), b = thicknessIn(byId.get(j.to));
  if (!a || !b) return 0;
  const thin = Math.min(a, b), thick = Math.max(a, b);
  return roundUpStock(thin + Math.min(SCREW_BITE_IN, Math.max(0.25, thick - 0.125)));
}

/** M4 and M3 screws with no length in their joint text: the clip lip plus the heat-set insert depth (mm). */
const METRIC_SCREW_MM: Record<string, number> = { '3': 8, '4': 10 };

export interface FastenerItem { label: string; qty: number }

const GENERIC_LEN = new RegExp(String.raw`[x×]\s*${LEN}(?:"|\s*in\b)`);

/** What the fasteners are made of, by weather spec: the Standard spec's screws, bolts, nuts, washers, T-nuts and pins are 18-8 (304); its threaded inserts are zinc. The Extreme spec is 316 throughout. */
export interface FastMat { ss: string; insert: string }
export const matOf = (spec: SpecName): FastMat => (spec === 'standard' ? { ss: '18-8', insert: 'zinc' } : { ss: '316', insert: '316' });

/** Items one joint needs. Bolts bring a nut and washers; a bolt whose shank is a separate part (eye bolt, kingpin) brings only what is not in that part. `byId` is for the length fallback. */
export function jointItems(part: Part, j: Joint, byId: PartMap = new Map(), spec: SpecName = 'extreme'): FastenerItem[] {
  const mat = matOf(spec);
  const size = j.size ?? '';
  const n = j.count;
  switch (j.type) {
    case 'domino': {
      const m = /(\d+)\s*[×x]\s*(\d+)/.exec(size);
      const dim = m ? `${m[1]}x${m[2]}` : '(size per joint note)';
      const out: FastenerItem[] = [{ label: /DF\s*500/.test(size) ? `Domino DF 500 ${dim}` : `Domino ${dim}`, qty: n }];
      return out;
    }
    case 'threaded-insert': {
      const m = /M(\d)\b/.exec(size);
      if (/heat-set/i.test(size) && m) return [{ label: `Heat-set insert M${m[1]}`, qty: n }];
      const t = new RegExp(String.raw`#(\d+)-(\d+)\s*[x×]\s*${LEN}`).exec(size);
      return [{ label: t ? `${mat.insert} threaded insert #${t[1]}-${t[2]} x ${lenText(t[3])}"` : `${mat.insert} threaded insert (size per joint note)`, qty: n }];
    }
    case 'knob': {
      // A thumb knob is a #10-32 screw with a size in its text. A `knob` joint without one is not a screw to buy (the brake snap hook was typed this way): nothing to order.
      const t = new RegExp(String.raw`#(\d+)-(\d+)\s*[x×]\s*${LEN}`).exec(size);
      return t ? [{ label: `Thumb-knob screw #${t[1]}-${t[2]} x ${lenText(t[3])}"`, qty: n }] : [];
    }
    case 'screw': return screwItems(part, j, byId, mat);
    case 'bolt': return boltItems(part, j, byId, mat);
    case 'pin': {
      // A stainless rod epoxied into two parts (the handlebow pins) is stock to cut; clevis and hitch pins are purchased parts.
      const r = new RegExp(String.raw`(\d\/\d+)"\s*[×x]\s*${LEN}"?\s*(?:316 )?stainless rod`, 'i').exec(size);
      return r ? [{ label: `${mat.ss} stainless rod ${r[1]}" x ${lenText(r[2])}"`, qty: n }] : [];
    }
    default: return [];
  }
}

function screwItems(part: Part, j: Joint, byId: PartMap, mat: FastMat): FastenerItem[] {
  const size = j.size ?? '';
  const n = j.count;
  if (/screw eye/i.test(size)) { const g = /#(\d+)/.exec(size); return [{ label: `${mat.ss} screw eye ${g ? '#' + g[1] : '(size per joint note)'}`, qty: n }]; }
  const ins = new RegExp(String.raw`#(\d+)-(\d+)\s*[x×]\s*${LEN}`).exec(size);
  if (/insert/i.test(size) && ins) {
    const out: FastenerItem[] = [{ label: `${mat.insert} threaded insert #${ins[1]}-${ins[2]} x ${lenText(ins[3])}"`, qty: n }];
    // The hinge leaves are screwed into these inserts (assembly step: "#10-32 x 3/8 screws to the inserts"): a machine screw one leaf thicker than the insert is long.
    if (/hinge/i.test(`${j.to} ${part.id}`)) out.push({ label: `${mat.ss} flat-head machine screw #${ins[1]}-${ins[2]} x ${fracIn(Math.ceil((Number(eval16(ins[3])) + HINGE_LEAF_IN) * 8 - 1e-6) / 8)}"`, qty: n });
    return out;
  }
  const metric = /\bM(\d)\b(?:\s*[x×]\s*(\d+))?/.exec(size);
  if (metric) return [{ label: `${mat.ss} screw M${metric[1]} x ${metric[2] ?? METRIC_SCREW_MM[metric[1]] ?? '?'} mm`, qty: n }];
  if (ins) return [{ label: `${mat.ss} machine screw #${ins[1]}-${ins[2]} x ${lenText(ins[3])}"`, qty: n }];
  const w = new RegExp(String.raw`#(\d+)\s*[x×]\s*${LEN}`).exec(size);
  // D-77: the pivot strap's screws are PAN-HEAD (the strap is not countersunk): their own line, not the flat-head one.
  // D-91: the rail-to-chine screws are TRIM-HEAD (a small head in a 1/4" counterbore): their own line too.
  // D-89: the lid turn-buttons pivot on a wood screw with a nylon washer under its head.
  if (w) return [{ label: `${mat.ss} ${/pan-head/i.test(size) ? 'pan-head ' : /trim-head/i.test(size) ? 'trim-head ' : ''}wood screw #${w[1]} x ${lenText(w[2])}"`, qty: n }, ...(/nylon washer/i.test(size) ? [{ label: `Nylon washer for #${w[1]} screw`, qty: n }] : [])];
  const g = /#(\d+)/.exec(size);
  if (!g) return [{ label: `${mat.ss} screw (size per joint note)`, qty: n }];
  const gl = GENERIC_LEN.exec(size);
  const len = gl ? Number(eval16(gl[1])) : screwLengthFromStack(part, j, byId);
  return [{ label: `${mat.ss} wood screw #${g[1]} x ${len ? fracIn(len) + '"' : '(length per joint note)'}`, qty: n }];
}

/** `1-3/4`, `7/8`, `0.875`, `2` to a number. */
function eval16(s: string): number {
  const m = /^(?:(\d+)-)?(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[1] ?? 0) + Number(m[2]) / Number(m[3]);
  return Number(s);
}

function boltItems(part: Part, j: Joint, byId: PartMap, mat: FastMat): FastenerItem[] {
  const size = j.size ?? '';
  const n = j.count;
  if (/see the bushing/.test(size)) return [];
  // A numbered machine screw with its own fender washer and nylock (the D-ring plate's four through-bolts, D-76): the screw, one washer under its head (OD in the text), a lock nut.
  const ms = new RegExp(String.raw`#(\d+)-(\d+)\s*[x×]\s*${LEN}"?[^,;]*?machine screw`, 'i').exec(size);
  if (ms) {
    const od = /(\d\/\d+)"\s*fender washer/i.exec(size);
    const noWasher = /\bno washers?\b/i.test(size); // the heads bear on a plate (the D-ring's outside bearing plate): the model says so, so no washer is bought
    return [
      { label: `${mat.ss} machine screw #${ms[1]}-${ms[2]} x ${lenText(ms[3])}"`, qty: n },
      ...(noWasher ? [] : [{ label: `${mat.ss} fender washer #${ms[1]}${od ? ` (${od[1]}" OD)` : ''}`, qty: n }]),
      { label: `${mat.ss} nylon-insert lock nut #${ms[1]}-${ms[2]}`, qty: n },
    ];
  }
  let dia: [number, string, string] | null = null, len: string | undefined;
  let m = new RegExp(String.raw`(\d\/\d+)-(\d+)\s*[x×]\s*${LEN}`).exec(size);
  if (m) { dia = nearestDia(Number(m[1].split('/')[0]) / Number(m[1].split('/')[1])); len = lenText(m[3]); }
  else if ((m = new RegExp(String.raw`(0\.\d+)"\s*[x×]\s*${LEN}`).exec(size))) { dia = nearestDia(Number(m[1])); len = lenText(m[2]); }
  else if ((m = /(\d\/\d+)"/.exec(size))) dia = nearestDia(Number(m[1].split('/')[0]) / Number(m[1].split('/')[1]));
  else if ((m = /(0\.\d+)"/.exec(size))) dia = nearestDia(Number(m[1]));
  else if (j.diaIn) dia = nearestDia(j.diaIn);
  const d = dia ? dia[1] : '1/4';
  const t = dia ? `${dia[1]}-${dia[2]}` : '1/4-20';
  // Bolts into T-nuts set in a backer (the handle sockets) bring a T-nut instead of a lock nut, and no fender washer on the nut side.
  const tnut = /\bT-?nuts?\b/i.test(size);
  const nut: FastenerItem = { label: tnut ? `${mat.ss} T-nut ${t}` : `${mat.ss} nylon-insert lock nut ${t}`, qty: n };
  const washer = (k: number): FastenerItem => ({ label: `${mat.ss} fender washer ${d}"`, qty: k * n });
  if (/eye bolt/i.test(size) || /eye bolt/i.test(part.name)) return [nut, washer(Math.max(1, (size.match(/\bwashers?\b/gi) ?? []).length))]; // one washer per mention: the chain-crossmember bolt has one on each face // the eye bolt itself is the steer-eye / steer-anchor part
  if (/kingpin/i.test(size)) return []; // the kingpin part includes its washers and nut
  if (!len) { // no length in the text: another "x L" in it, else the stack of parts the bolt crosses
    const gl = GENERIC_LEN.exec(size);
    const v = gl ? eval16(gl[1]) : boltLengthFromStack(part, j, byId);
    if (v) len = fracIn(v);
  }
  if (/tapped/.test(size)) return [{ label: `${mat.ss} machine screw ${t}${len ? ` x ${len}"` : ''} (tapped)`, qty: n }];
  const type = /button-head/.test(size) ? 'button-head cap screw' : /carriage/.test(size) ? 'carriage bolt' : 'hex bolt';
  const label = `${mat.ss} ${type} ${t}${len ? ` x ${len}"` : ' (length per joint note)'}`;
  // A nylon washer under the head (handle sockets) replaces one of the two fender washers.
  const nylon = /nylon washer/i.test(size);
  // The joint names its washer: "a 7/8" OD 3/8 narrow flat washer under each head, nylock nuts on the backing plate" (the brake knee bolts). Buy exactly that: one narrow washer per head and
  // none under the nut when the nuts bear on a plate; never the two fender washers a plain bolt gets.
  const narrow = /(\d+\/\d+)"\s*OD\s+(\d+\/\d+)\s+narrow flat washer/i.exec(size);
  if (narrow) {
    const onPlate = /\bnuts?\s+on\s+(?:the\s+|one\s+)?(?:[a-z-]+\s+)*(?:backing|bearing)\s+plate/i.test(size);
    return [{ label, qty: n }, nut, { label: `${mat.ss} narrow flat washer ${narrow[2]}" (${narrow[1]}" OD)`, qty: n }, ...(onPlate ? [] : [{ label: `${mat.ss} narrow flat washer ${narrow[2]}" (${narrow[1]}" OD)`, qty: n }])];
  }
  // "nylock nuts and fender washers under the beam": the washers are on the nut side only, so one per bolt (the head bears on the part itself).
  const nutSideOnly = /\bnylock nuts?\s*(?:and|\+)\s*(?:fender )?washers?\s+(?:under|on)\b/i.test(size);
  const oneWasher = /one washer a bolt/i.test(size); // the D-ring bolts (D-83): a washer under the head only, the nylock bears on the bracket
  const out: FastenerItem[] = [{ label, qty: n }, nut, washer(tnut ? (nylon ? 0 : 1) : type === 'carriage bolt' || nylon || nutSideOnly || oneWasher ? 1 : 2)];
  if (out[2].qty === 0) out.splice(2, 1);
  if (nylon) out.push({ label: `Nylon washer for ${d}" screw`, qty: n });
  if (/button plugs?/i.test(size)) { const bp = /(\d\/\d+)\s*in\b[^,;]*?button plugs?/i.exec(size); out.push({ label: `Button plug ${bp ? bp[1] : '5/8'}" black nylon`, qty: n }); }
  return out;
}

/** Each physical joint once (mirrors `fastenerBreakdown`). */
export function uniqueJoints(parts: Part[]): Array<{ part: Part; joint: Joint }> {
  const live = parts.filter(isBuilt);
  const byId = new Map(live.map((x) => [x.id, x]));
  const out: Array<{ part: Part; joint: Joint }> = [];
  for (const part of live) {
    for (const j of part.joints ?? []) {
      const mate = byId.get(j.to)?.joints?.find((k) => k.to === part.id && k.count === j.count && k.type === j.type);
      if (mate && j.to < part.id) continue; // same joint, listed on the other part
      if (!mate && !byId.has(j.to)) continue; // mate not in this configuration
      out.push({ part, joint: j });
    }
  }
  return out;
}

// ── Items that exist only as text in a note ───────────────────────────────────

export interface NoteItem {
  /** BOM line key (consumables) or a short id. */
  key: string;
  section: 'fasteners' | 'consumables' | 'purchased';
  /** Price of the consumable line (fasteners are priced by label in prices.ts). */
  price?: Price;
  /** Set when the item exists for a finishing-touches group: the line goes to that section instead. */
  touch?: TouchGroup;
  /** Parts whose note or joint text names the item. Each must still exist: a test checks it, so a renamed part cannot silently drop the item. */
  partIds: string[];
  /** Where the text is, for the BOM note. */
  noteRef: string;
  /** What to buy for the built parts of this configuration; null when none of the cited parts is built. */
  expand(built: Part[], joints: Array<{ part: Part; joint: Joint }>, spec?: SpecName): { items: FastenerItem[]; note: string } | null;
}

const byIds = (built: Part[], ids: string[]): Part[] => built.filter((x) => ids.includes(x.id));
const ptext = (x: Part): string => `${x.notes ?? ''} ${x.sourcing?.vendor ?? ''} ${(x.joints ?? []).map((j) => `${j.size ?? ''} ${j.note ?? ''}`).join(' ')}`;
const wheelIds = ['wheel-RL', 'wheel-RR', 'wheel-FL', 'wheel-FR'];
const axleIds = ['axle-R', 'axle-FL', 'axle-FR'];
const COTTER_DIAS: Array<[number, string]> = [[1 / 16, '1/16'], [3 / 32, '3/32'], [1 / 8, '1/8'], [5 / 32, '5/32'], [3 / 16, '3/16']];

/** Hook-and-loop per seat pad part (cushion, back pad): two 12 in strips of EACH half (hook and loop), so 2 ft of each half; the seat (cushion plus back pad) takes four 12 in strips of each half, 4 ft of each. */
export const HOOK_LOOP_FT_PER_PART = 2;
/** Length of each half (hook, loop) in a hook-and-loop pack (ft): Velcro Industrial Strength 2 in x 4 ft (D-83). */
export const HOOK_LOOP_ROLL_FT = 4;
/** Polysulfide used per bedding, oz. */
export const SEALANT_OZ_PER_USE = 1;
/** The tube bought (oz): BoatLIFE Life-Calk 1030, 2.8 oz (D-79; the handle sockets no longer take sealant, so the small tube is enough). */
export const SEALANT_TUBE_OZ = 2.8;
/** Contact-cement uses one pint can covers. */
export const CEMENT_USES_PER_CAN = 8;
/** Edge-banding waste (trimming, corners) and the roll length (ft). */
export const BANDING_WASTE = 0.15;
export const BANDING_ROLL_FT = 25;
/** Removable knees: spare nylon-insert lock nuts for the knee bolts that ride in the box. */
export const KNEE_SPARE_NUTS = 8;

/**
 * The note table. Each entry cites the text it comes from; quantities come from the model (parts present, their sizes), never from the text.
 * Items that live in a JOINT's text (hinge machine screws, handlebow rods, rail-to-chine screws, button plugs, nylon washers) are expanded in `jointItems` instead.
 */
export const NOTE_ITEMS: NoteItem[] = [
  {
    key: 'wheel-retention', section: 'fasteners', partIds: wheelIds, noteRef: 'wheel notes (D-60): "collar + cotter pin on the axle end"; axle notes: 0.156" cross hole',
    expand(built, _joints, spec) {
      const wheels = byIds(built, wheelIds).filter((x) => /collar/i.test(x.notes ?? ''));
      if (!wheels.length) return null;
      const axle = built.find((x) => axleIds.includes(x.id) && x.stock);
      const od = axle?.stock?.t ?? 0.75;
      const hole = Number(/(\d*\.\d+)"\s*cross hole/.exec(axle?.notes ?? '')?.[1] ?? 0.156);
      const cotter = [...COTTER_DIAS].reverse().find(([v]) => v <= hole + 1e-3) ?? COTTER_DIAS[0];
      return {
        items: [
          { label: spec === 'standard' ? `zinc-plated set-screw shaft collar, ${fracIn(od)}" bore` : `316 stainless set-screw shaft collar, ${fracIn(od)}" bore`, qty: wheels.length },
          { label: `${matOf(spec ?? 'extreme').ss} cotter pin ${cotter[1]}" x ${fracIn(roundUpStock(od + 0.75))}"`, qty: wheels.length },
        ],
        note: `${wheels.length} wheels, one collar and one cotter pin each`,
      };
    },
  },
  {
    key: 'axle-plugs', section: 'fasteners', partIds: axleIds, noteRef: 'axle notes (D-60): "oil or paint the bore and plug or cap the ends"',
    expand(built) {
      const axles = byIds(built, axleIds).filter((x) => /plug or cap/i.test(x.notes ?? ''));
      if (!axles.length) return null;
      const od = axles[0].stock?.t ?? 0.75;
      const wall = Number(/(\d*\.\d+)"\s*wall/.exec(ptext(axles[0]))?.[1] ?? 0.12);
      return { items: [{ label: `Flanged plastic end plug for ${fracIn(od)}" OD x ${wall.toFixed(3)}" wall tube`, qty: 2 * axles.length }], note: `${axles.length} axle tubes, two ends each` };
    },
  },
  {
    key: 'stop-block-screws', section: 'fasteners', partIds: ['seat-wedge-L', 'seat-wedge-R'], noteRef: 'seat-wedge glue note: "epoxy to the deck (and screwed from below)"; assembly step "Seat stop blocks and crest strip"',
    expand(built, joints, spec) {
      // Only when the model has no screw joint of its own on the block (then the joint list already carries them).
      const blocks = byIds(built, ['seat-wedge-L', 'seat-wedge-R']).filter((x) => /screwed from below/i.test(ptext(x)) && !joints.some((q) => q.part.id === x.id && q.joint.type === 'screw'));
      const deck = thicknessIn(built.find((x) => x.id === 'deck'));
      if (!blocks.length || !deck) return null;
      return { items: [{ label: `${matOf(spec ?? 'extreme').ss} flat-head wood screw #8 x ${fracIn(roundUpStock(deck + SCREW_BITE_IN))}"`, qty: 2 * blocks.length }], note: `2 per stop block, up through the ${fracIn(deck)}" deck into the block` };
    },
  },
  {
    key: 'lid-batten-screws', section: 'fasteners', partIds: ['storage-lid-batten-1', 'storage-lid-batten-2', 'storage-lid-batten-3'], noteRef: 'batten glue joint note: "epoxy + 4 stainless screws from the top"',
    expand(built, _joints, spec) {
      const lid = built.find((x) => x.id === 'storage-lid');
      let n = 0, t = 0;
      for (const b of built.filter((x) => /^storage-lid-batten-/.test(x.id))) {
        const j = (b.joints ?? []).find((q) => q.to === 'storage-lid' && /(\d+)\s+stainless screws/i.test(`${q.size ?? ''} ${q.note ?? ''}`));
        if (!j) continue;
        n += j.count * Number(/(\d+)\s+stainless screws/i.exec(`${j.size ?? ''} ${j.note ?? ''}`)![1]);
        t = thicknessIn(b);
      }
      if (!n || !lid) return null;
      // D-72: the lid-batten screws are the standard hardware-into-thin-stock size, #8 x 5/8 (the model has three wood-screw sizes and the BOM adds no fourth). From the lid top, countersunk and plugged:
      // through the panel and into the batten; the batten is epoxied too, so the screws only clamp it.
      const s58 = STD_WOOD_SCREWS.find((q) => q.gauge === 8 && Math.abs(q.lenIn - 5 / 8) < 1e-9)!;
      const bite = s58.lenIn - thicknessIn(lid);
      return { items: [{ label: `${matOf(spec ?? 'extreme').ss} wood screw #${s58.gauge} x ${fracIn(s58.lenIn)}"`, qty: n }], note: `${n} screws through the ${fracIn(thicknessIn(lid))}" lid panel into the ${fracIn(t)}" battens (${fracIn(Math.floor(bite * 16) / 16)}" of thread in the batten, which is glued too)` };
    },
  },
  {
    key: 'hook-and-loop', section: 'consumables', touch: 'seat', price: NOTE_PRICE.hookLoop, partIds: ['seat-cushion', 'seat-back-pad'], noteRef: 'seat cushion and seat back pad notes: hook-and-loop strips (D-83: Velcro Industrial 2" x 4 ft)',
    expand(built) {
      // Every built seat pad rides on hook-and-loop strips, whatever its note says today (D-83: 2" Velcro Industrial).
      const pads = byIds(built, ['seat-cushion', 'seat-back-pad']);
      if (!pads.length) return null;
      const ft = pads.length * HOOK_LOOP_FT_PER_PART; // feet of EACH half
      return { items: [{ label: `Velcro Industrial hook-and-loop, 2" x ${HOOK_LOOP_ROLL_FT} ft pack`, qty: Math.ceil(ft / HOOK_LOOP_ROLL_FT) }], note: `${ft} ft of 2" hook and ${ft} ft of 2" loop (${ft} twelve-inch strips of each half) for ${pads.map(shopName).join(' and ')}. Check that the pack holds BOTH a hook strip and a loop strip, each 4 ft; if it is one 4 ft strip of a single half, buy two` };
    },
  },
  {
    key: 'edge-banding', section: 'consumables', price: NOTE_PRICE.edgeBanding, partIds: ['seat-back-panel', 'sign-L', 'sign-R'], noteRef: 'seat-back-panel note: "1/16 in oak veneer banding all round"; sign notes: "all four edges banded with oak"',
    expand(built) {
      const ply = byIds(built, ['seat-back-panel', 'sign-L', 'sign-R']).filter((x) => /banding|banded/i.test(x.notes ?? '') && x.stock);
      if (!ply.length) return null;
      const ft = (ply.reduce((a, x) => a + 2 * (x.stock!.w + x.stock!.l), 0) / 12) * (1 + BANDING_WASTE);
      return { items: [{ label: 'Oak veneer edge banding, 3/4" wide, 25 ft roll', qty: Math.max(1, Math.ceil(ft / BANDING_ROLL_FT)) }], note: `${Math.ceil(ft)} ft of edge (perimeter of the ${[...new Set(ply.map((x) => x.name.replace(/\s+[LR]\d*$/, '').toLowerCase()))].join(', ')}, +${Math.round(BANDING_WASTE * 100)}%)` };
    },
  },
  {
    key: 'sealant', section: 'consumables', price: NOTE_PRICE.sealant, partIds: ['seat-grip-backing-L', 'seat-grip-backing-R', 'storage-gasket-side-L'],
    noteRef: 'grab-board backing joint note: "epoxy or polysulfide sealant"; gasket note: "continuous strip, spliced at a corner". The handle sockets are bedded in thickened epoxy (D-79), not sealant',
    expand(built) {
      const uses = byIds(built, ['seat-grip-backing-L', 'seat-grip-backing-R']).filter((x) => /sealant|polysulfide/i.test(ptext(x)));
      const gasket = built.some((x) => x.id === 'storage-gasket-side-L' && /spliced/i.test(x.notes ?? ''));
      const oz = uses.length * SEALANT_OZ_PER_USE + (gasket ? SEALANT_OZ_PER_USE / 2 : 0);
      if (!oz) return null;
      return { items: [{ label: `Polysulfide marine sealant, ${SEALANT_TUBE_OZ} oz tube`, qty: Math.ceil(oz / SEALANT_TUBE_OZ) }], note: `${Math.ceil(oz)} oz: beds for the ${[...new Set(uses.map((x) => x.name.replace(/\s+[LR]\d*$/, '').toLowerCase()))].join(', ')}${gasket ? ' and the lid gasket splice' : ''} (the handle sockets are bedded in thickened epoxy, not sealant)` };
    },
  },
  {
    key: 'contact-cement', section: 'consumables', price: NOTE_PRICE.contactCement, partIds: ['brake-foot-tread-L', 'brake-foot-tread-R', 'brake-pad-L', 'brake-pad-R'],
    noteRef: 'brake tread and pad notes and joints: "contact cement over the full face"',
    expand(built) {
      const uses = byIds(built, ['brake-foot-tread-L', 'brake-foot-tread-R', 'brake-pad-L', 'brake-pad-R']).filter((x) => /contact cement/i.test(ptext(x)));
      if (!uses.length) return null;
      return { items: [{ label: 'Contact cement, pint', qty: Math.ceil(uses.length / CEMENT_USES_PER_CAN) }], note: `${uses.length} glued faces: ${uses.map(shopName).join(', ')}` };
    },
  },
  {
    key: 'knee-spare-nuts', section: 'fasteners', partIds: ['brake-knee-L', 'brake-knee-R'], noteRef: 'brake knee notes (removable knees): "the four bolts, washers and nuts come off with it"',
    expand(built, _joints, spec) {
      const knees = byIds(built, ['brake-knee-L', 'brake-knee-R']).filter((x) => x.removable);
      if (!knees.length) return null;
      return { items: [{ label: `${matOf(spec ?? 'extreme').ss} nylon-insert lock nut 3/8-16`, qty: KNEE_SPARE_NUTS }], note: `${KNEE_SPARE_NUTS} spare lock nuts for the knee bolts: the nylon wears, so fit new nuts after about five removals` };
    },
  },
  {
    key: 'tool-pouch', section: 'purchased', price: NOTE_PRICE.toolPouch, partIds: ['brake-knee-L', 'brake-knee-R'], noteRef: 'brake knee notes (removable knees): "ratchet and wrench"',
    expand(built) {
      const knees = byIds(built, ['brake-knee-L', 'brake-knee-R']).filter((x) => x.removable);
      if (!knees.length) return null;
      return { items: [{ label: 'TOOL: pouch with a 3/8" drive ratchet, a 9/16" socket and a 9/16" combination wrench', qty: 1 }], note: 'A tool, not part of the sled and not in its weight. It rides in the storage box in cargo mode, so the brake knees can come off at the truck or in the garage. You may already own a set: this is an estimate, not a quote' };
    },
  },
  {
    key: 'anti-seize', section: 'consumables', price: NOTE_PRICE.antiSeize, partIds: ['brake-knee-L', 'brake-knee-R'], noteRef: 'brake knee notes (removable knees): bolts bolted and unbolted again and again',
    expand(built) {
      const knees = byIds(built, ['brake-knee-L', 'brake-knee-R']).filter((x) => x.removable);
      if (!knees.length) return null;
      return { items: [{ label: 'Anti-seize compound for stainless, small tube', qty: 1 }], note: 'A thin smear on the knee bolt threads at every refit: stainless threads gall (seize) when they are run in and out of a nut' };
    },
  },
];

// ── BOM ───────────────────────────────────────────────────────────────────────

/** A view with nothing in it: the empty sled, for the mass of the other weather spec. */
const EMPTY_VIEW = { steerDeg: 0, rider: 'none', cargo: false } as const;

export interface BomOptions {
  /** Skip the other-spec comparison (`Bom.weatherCompare` then says it was not computed): the comparison calls `bom` once for the other spec, and that call sets this so it cannot recurse. */
  noCompare?: boolean;
}

/**
 * The bill of materials for `parts` under the weather spec of `p` (`p.weatherSpec`: Standard by default). `Bom.weatherCompare` (computed on first read, never enumerated) prices the SAME design under the
 * other spec: the same parts, unless the thin sheet follows the weather (white oak plywood vs okoume), in which case the parts are rebuilt for the other spec with `buildModel`.
 */
export function bom(parts: Part[], p: Params, opts: BomOptions = {}): Bom {
  const b = bomForSpec(parts, p);
  let cache: WeatherCompare | undefined;
  Object.defineProperty(b, 'weatherCompare', {
    enumerable: false,
    configurable: true,
    get(): WeatherCompare {
      if (cache) return cache;
      if (opts.noCompare) return (cache = { computed: false, activeSpec: b.spec, standardUsd: b.spec === 'standard' ? b.totalUsd : NaN, extremeUsd: b.spec === 'extreme' ? b.totalUsd : NaN, deltaUsd: 0, deltaBySection: {}, deltaCoreUsd: 0, deltaTouchesUsd: 0, standardLb: NaN, extremeLb: NaN, deltaLb: 0, thinSheetStandard: '', thinSheetExtreme: '' });
      const otherP: Params = { ...p, weatherSpec: b.spec === 'standard' ? WEATHER_SPEC.extreme : WEATHER_SPEC.standard };
      const sameSheet = thinSheet(otherP).key === thinSheet(p).key;
      const otherParts = sameSheet ? parts : buildModel(otherP, EMPTY_VIEW);
      const o = bom(otherParts, otherP, { noCompare: true });
      const std = b.spec === 'standard' ? b : o, ext = b.spec === 'standard' ? o : b;
      const mine = totalMass(parts), theirs = sameSheet ? mine : totalMass(otherParts);
      const stdLb = b.spec === 'standard' ? mine : theirs, extLb = b.spec === 'standard' ? theirs : mine;
      const deltaBySection: Record<string, number> = {};
      for (const sec of ext.sections) deltaBySection[sec.id] = money(sec.subtotalUsd - (std.sections.find((q) => q.id === sec.id)?.subtotalUsd ?? 0));
      return (cache = {
        computed: true, activeSpec: b.spec, standardUsd: std.totalUsd, extremeUsd: ext.totalUsd, deltaUsd: money(ext.totalUsd - std.totalUsd), deltaBySection,
        deltaCoreUsd: money(ext.coreUsd - std.coreUsd), deltaTouchesUsd: money(ext.touchesUsd - std.touchesUsd),
        standardLb: stdLb, extremeLb: extLb, deltaLb: extLb - stdLb, thinSheetStandard: thinSheet({ ...p, weatherSpec: WEATHER_SPEC.standard }).name, thinSheetExtreme: thinSheet({ ...p, weatherSpec: WEATHER_SPEC.extreme }).name,
      });
    },
  });
  return b;
}

/** "rear axle beam, front axle beam, brake pivot knee, wheel chock: 3 layers: 3 x 3/4" from 4/4, glue up, then mill": the laminated parts by their names, each lamination recipe said once. */
function laminatedText(laminated: OakPlan['laminated'], parts: Part[]): string {
  const names: string[] = [];
  const how: string[] = [];
  for (const q of laminated) {
    const x = parts.find((y) => y.id === q.id);
    const mates = laminated.filter((m) => m.partNo === q.partNo).map((m) => parts.find((y) => y.id === m.id)?.name).filter((n): n is string => !!n);
    const shared = mates.length ? groupedName(mates).replace(/\s*\([^)]*\)\s*$/, '') : '';
    const name = x ? shared.replace(/^([A-Z])([a-z])/, (_m, a: string, b: string) => a.toLowerCase() + b) : q.partNo; // one name for the left and right pair
    if (!names.includes(name)) names.push(name);
    if (!how.includes(q.lamination.text)) how.push(q.lamination.text);
  }
  return `${names.join(', ')}: ${how.join('; ')}`;
}

/** Every part id and part number, so running text can be checked for them. */
function shopKeys(parts: Part[]): Set<string> {
  const out = new Set<string>();
  for (const x of parts) { out.add(x.id); out.add(partKey(x)); }
  return new Set([...out].filter((k) => k.includes('-')));
}

/**
 * Shop text for the BOM: a decision id "(D-71; text)" becomes "(text)" and "(D-72)" goes, a bare "D-72" goes, "S7" goes, and a part key ("brake-cord") is written as words ("brake cord").
 * Wording that reads wrongly without its id was fixed where it is written; this is the net under that.
 */
export function shopBomText(t: string, keys: ReadonlySet<string>): string {
  let o = t
    .replace(/\(\s*(?:see\s+)?[DAQ]-\d+[;,]\s*/g, '(')
    .replace(/\s*\(\s*(?:see\s+)?[DAQ]-\d+\s*\)/g, '')
    .replace(/,?\s*\b[DAQ]-\d+\b/g, '')
    .replace(/,?\s*\bS7\b/g, '')
    .replace(/\s*\(\s*[a-z]+(?:[A-Z][a-z0-9]*)+\s*\)/g, ''); // a parameter name in brackets, e.g. (somethingRateLbIn)
  if (keys.size) {
    const re = new RegExp(`(?<![\\w/.-])(${[...keys].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w/-])`, 'g');
    o = o.replace(re, (k) => k.replace(/-/g, ' '));
  }
  // shop fractions, not long decimals ("0.69\"" is 11/16\")
  return fractionizeInches(o.replace(/\s+([.,;)])/g, '$1').replace(/\(\s+/g, '('));
}

function bomForSpec(parts: Part[], p: Params): Bom {
  const spec = specOf(p);
  const std = spec === 'standard';
  const thin = { ...thinSheet(p), name: inchMarks(thinSheet(p).name) };
  const unpriced: string[] = [];
  const built = parts.filter(isBuilt);
  const cl = cutList(parts, p);
  const nest = nestPlywood(parts, p);
  const oak = oakBoardFeet(parts, p);

  // Lumber: the whole boards of the suggested list (nesting.ts), not net x (1 + waste). A thin bucket under about 1 bf is cut from the offcuts of a thicker board (OakPlan.consolidated).
  let lumberAllowanceUsd = 0, lumberAltUsd = 0;
  const lumber: BomLine[] = oak.thicknesses.map((t) => {
    const price = OAK_PRICE_PER_BF[t.board];
    const alt = OAK_ALT_PRICE_PER_BF[t.board];
    lumberAllowanceUsd += t.allowanceBf * price.usd;
    lumberAltUsd += r2(t.purchaseBf) * (alt ?? price).usd;
    return line('Lumber', t.board, `White oak ${t.board}, rough, whole boards`, r2(t.purchaseBf), price, {
      notes: `Buy: ${t.summary.join('; ')}. ${r2(t.netBf)} bf net on nominal thickness (${r2(t.allowanceBf)} bf with the ${Math.round(oak.wasteAllowance * 100)}% waste allowance); the boards come to ${r2(t.plannedBf)} bf.` +
        (alt ? ` Alternative: ${alt.source} $${alt.usd.toFixed(2)}/bf = $${(r2(t.purchaseBf) * alt.usd).toFixed(2)} for these boards (${alt.url}).` : '') +
        (t.layersIn ? ` The face-laminated parts (${laminatedText(oak.laminated, built)}) take their layers from the stocked 4/4 and 5/4 boards, so no thicker board is bought.` : ''),
    });
  });

  // Plywood. The thin sheet is `thinSheet(p)` (D-80: 6 mm Baltic birch by default, 6 mm okoume under the Extreme spec, or white oak ply / 3 mm Baltic by choice) and is priced by its `priceKey`, never by its
  // thickness class; the 12 mm deck is marine okoume (or Baltic if the species is changed).
  const plywood: BomLine[] = [];
  for (const mm of [...new Set(nest.sheets.map((s) => s.thicknessMm))]) {
    const sheets = nest.sheets.filter((s) => s.thicknessMm === mm);
    const label = `${mm} mm`;
    const isThin = sheets.some((s) => s.label === thinSheet(p).name); // the nest labels the sheet with the plain name; `thin.name` has the inch marks
    // The okoume option is priced for its real thickness: 'okoume-6mm' is the 6 mm sheet (D-80); a 4 mm panelPlyIn is the 4 mm sheet.
    const priceKey = isThin ? (thin.priceKey === 'okoume-6mm' && thin.thicknessIn < 0.2 ? 'okoume-4mm' : thin.priceKey) : label;
    const price = PLYWOOD_PRICE[priceKey];
    if (!price) { unpriced.push(`plywood ${priceKey}`); continue; }
    const desc = isThin
      ? `${/plywood/i.test(thin.name) ? thin.name : `${thin.name} plywood`} (${thin.glue} glue), ${thin.sheetWidthIn / 12} x ${thin.sheetLengthIn / 12} ft sheet (the thin sheet: sides, box, lid, signs)`
      : `Marine okoume plywood (BS 1088), ${label}, 4 x 8 ft (the deck and seat back)`;
    plywood.push(line('Plywood', priceKey, desc, sheets.length, price, {
      vendor: price.source.split(/[,(]/)[0].trim(), // the shop itself (Aircraft Spruce, The Wood Yard): the full source and link are on the price
      notes: `${sheets.map((s) => `sheet ${s.index}: ${s.placements.length} parts, ${s.utilizationPct.toFixed(0)}% used`).join('; ')}${isThin && std && /interior/.test(thin.glue) ? `. ${thin.glue} glue is fine kept dry in a garage and sealed; the Extreme spec uses 6 mm okoume (BS 1088)` : ''}`,
    }));
  }

  // Metal stock
  const metalGroups = new Map<string, { section: string; ft: number; cuts: string[] }>();
  for (const r of cl.metal) {
    const g = metalGroups.get(r.section) ?? { section: r.section, ft: 0, cuts: [] };
    g.ft += (r.qty * (r.cutLengthIn + METAL_CUT_ALLOWANCE_IN)) / 12;
    g.cuts.push(`${r.qty} × ${fracIn(r.cutLengthIn)}" (${r.name.toLowerCase()})`);
    metalGroups.set(r.section, g);
  }
  const metal: BomLine[] = [];
  for (const g of metalGroups.values()) {
    const price = metalPrice(g.section, spec);
    if (!price) { unpriced.push(g.section); continue; }
    const extra = { vendor: price.url ? price.source : 'McMaster-Carr class', notes: `Cut to length: ${g.cuts.join(', ')}; allow ${fracIn(METAL_CUT_ALLOWANCE_IN)}" per cut for the kerf and squaring` };
    // The Standard spec buys 304 where the cut list (the model's material text) says 316.
    const name = std ? std304(g.section) : g.section;
    // A researched bar or tube is bought as the fixed piece the vendor sells (packQty in ft); an estimate is per foot of cut length.
    if (price.packQty && price.packUsd) metal.push(packLine('Metal stock', name, name, r2(g.ft), price, extra, false));
    else metal.push(line('Metal stock', name, name, r2(g.ft), price, { ...extra, notes: joinNotes(price.note && `Price: ${price.note}.`, extra.notes) }));
  }

  // Purchased parts (and printed clips), by partNo
  const purchasedMap = new Map<string, Part[]>();
  for (const x of built.filter((q) => q.kind === 'purchased' || q.kind === 'printed')) {
    const arr = purchasedMap.get(partKey(x)) ?? [];
    arr.push(x);
    purchasedMap.set(partKey(x), arr);
  }
  const purchased: BomLine[] = [];
  const touchLines: BomLine[] = [];
  for (const [key, group] of purchasedMap) {
    const x = group[0];
    const tg = TOUCH_PRICED_PARTS.has(key) ? touchGroupOfPart(x) : undefined;
    const cost = x.sourcing?.costUsd;
    const entry = purchasedEntry(key, spec);
    let price: Price;
    let priceNote: string | undefined;
    if (cost !== undefined && !entry?.override) {
      // The model's own cost wins (a quote Eric or the model gave); the research can add a note and spec-gap alternatives to it.
      const mc = modelCostNote(key, spec);
      price = { usd: cost, unit: 'ea', source: 'part.sourcing.costUsd (model)', basis: mc?.estimate ? 'estimate' : 'quoted', ...(mc?.alternatives ? { alternatives: mc.alternatives } : {}) };
      priceNote = mc ? (mc.note.includes(RESEARCH_DATE) || mc.estimate || !/^model cost kept/.test(mc.note) ? mc.note : `${mc.note} (${RESEARCH_DATE} research)`) : undefined;
    } else {
      price = entry?.price ?? PURCHASED_FALLBACK;
      priceNote = price.note;
      if (cost !== undefined) priceNote = `${priceNote ?? ''} Replaces the model's $${cost} estimate.`.trim();
      if (price.note?.startsWith('UNPRICED')) unpriced.push(key);
    }
    const url = x.sourcing?.url ?? price.url;
    const vendor = price.url ? price.source : shortVendor(x.sourcing?.vendor, x.kind);
    const vendorFull = x.sourcing?.vendor ?? '';
    const extra: Partial<BomLine> = {
      vendor,
      notes: [clip(vendorFull, 200), priceNote ? `Price: ${priceNote}` : ''].filter(Boolean).join(' | '),
      partIds: group.map((q) => q.id),
      ...(url ? { url } : {}),
      ...(tg ? { group: tg } : {}),
      ...(hardwareMaterialNote(x, spec) ? { materialNote: hardwareMaterialNote(x, spec) } : {}),
    };
    const groupName = groupedName(group.map((q) => q.name));
    const name = purchasedDescribe(key, spec) ?? (std ? std304(groupName) : groupName);
    const dest = tg ? touchLines : purchased, destTitle = tg ? TOUCHES_SECTION.title : 'Purchased parts';
    // A part cut from a roll or a pack (a cord) or sold in packs (D-rings by the 2-pack, a neoprene sheet): the whole packs to buy, not a price per part.
    if (price.packQty && price.packUsd && price.perPart) dest.push(packLine(destTitle, key, name, group.length * price.perPart, price, extra, false));
    // A part cut from stock sold by the foot (the shock cord): whole units to buy, at the unit price.
    else if (price.perPart) dest.push(line(destTitle, key, name, Math.ceil(group.length * price.perPart - 1e-9), price, extra));
    else dest.push(line(destTitle, key, name, group.length, price, extra));
  }

  // Fasteners: every unique joint, then the items that exist only in notes (NOTE_ITEMS)
  const byId: PartMap = new Map(built.map((x) => [x.id, x]));
  const jointCounts: FastenerJointCounts = { screw: 0, bolt: 0, 'threaded-insert': 0, knob: 0, domino: 0, glue: 0 };
  const fast = new Map<string, number>();
  const touchFast = new Map<string, { label: string; group: TouchGroup; qty: number }>();
  /** Ids of the parts each fastener label fixes (the joint's part and its mate): where it lives decides the material note. */
  const fastOn = new Map<string, Set<string>>();
  const noteOn = (label: string, ids: readonly string[]): void => { const set = fastOn.get(label) ?? new Set<string>(); ids.forEach((i) => set.add(i)); fastOn.set(label, set); };
  const uj = uniqueJoints(parts);
  let tapeJoints = 0;
  for (const { part, joint } of uj) {
    if (joint.type in jointCounts && !(joint.type === 'bolt' && /see the bushing/.test(joint.size ?? ''))) jointCounts[joint.type as keyof FastenerJointCounts] += joint.count;
    if (joint.type === 'glue' && /tape/i.test(`${joint.size ?? ''} ${joint.note ?? ''}`)) tapeJoints += joint.count;
    // A fastener that exists for a finishing touch (the lamp-clip inserts and screws, the lash-plate screws) goes to the touches section with its part.
    const tg = touchGroupOfPart(part) ?? touchGroupOfPart(byId.get(joint.to));
    for (const it of jointItems(part, joint, byId, spec)) {
      noteOn(it.label, [part.id, joint.to]);
      if (tg) { const k = `${tg}|${it.label}`; const prev = touchFast.get(k); touchFast.set(k, { label: it.label, group: tg, qty: (prev?.qty ?? 0) + it.qty }); }
      else fast.set(it.label, (fast.get(it.label) ?? 0) + it.qty);
    }
  }
  const noteLines: BomLine[] = [];
  for (const item of NOTE_ITEMS) {
    const x = item.expand(built, uj, spec);
    if (!x) continue;
    if (item.section === 'fasteners') for (const f of x.items) { fast.set(f.label, (fast.get(f.label) ?? 0) + f.qty); noteOn(f.label, item.partIds); }
    else if (item.touch) touchLines.push(line(TOUCHES_SECTION.title, item.key, x.items[0].label, x.items[0].qty, item.price!, { vendor: item.price!.source, notes: joinNotes(item.price!.url ? `Price: ${item.price!.note}.` : undefined, x.note), group: item.touch }));
    else if (item.section === 'purchased') purchased.push(line('Purchased parts', item.key, x.items[0].label, x.items[0].qty, item.price!, { vendor: item.price!.source, notes: joinNotes(item.price!.url ? `Price: ${item.price!.note}.` : undefined, x.note) }));
    else noteLines.push(line('Consumables', item.key, x.items[0].label, x.items[0].qty, item.price!, { vendor: item.price!.source, notes: joinNotes(item.price!.url ? `Price: ${item.price!.note}.` : undefined, x.note) }));
  }
  const familyOrder = (l: string): number => (/^Domino/.test(l) ? 7 : /insert/i.test(l) ? 4 : /bolt|cap screw/.test(l) ? 1 : /nut/.test(l) ? 2 : /washer/.test(l) ? 3 : /Thumb/.test(l) ? 4 : /collar|cotter|plug|rod/.test(l) ? 6 : 0);
  /**
   * One fastener line, in Fasteners (or the touches section for a touches fastener). An item Bolt Depot sells by the piece (`Price.eachUsd`) is priced per piece when that is no
   * dearer than the whole packs; otherwise by the whole pack, with the "you may already have these" note when the build needs under half a pack.
   */
  const fastenerLine = (label: string, qty: number, group?: TouchGroup): BomLine => {
    const price = fastenerPrice(label, spec);
    if (price.note?.startsWith('UNPRICED')) unpriced.push(label);
    const isDomino = /^Domino/.test(label);
    const description = isDomino ? `${label}, beech Domino (shop stock${std ? '' : ', epoxied in'})` : label;
    const extra: Partial<BomLine> = { vendor: price.url ? price.source : isDomino ? 'Festool dealer' : 'McMaster-Carr / Fastenal', materialNote: fastenerMaterialNote(label, [...(fastOn.get(label) ?? [])], spec), ...(group ? { group } : {}) };
    const sectionTitle = group ? TOUCHES_SECTION.title : 'Fasteners';
    // Shop stock (D-79): a $0 line, so it is listed and not bought.
    if (price.basis === 'owned') return line(sectionTitle, label, description, qty, price, extra);
    const packCost = price.packQty && price.packUsd ? Math.max(1, Math.ceil(qty / price.packQty - 1e-9)) * price.packUsd : Infinity;
    if (price.eachUsd !== undefined && qty * price.eachUsd <= packCost + 1e-9) {
      const { packQty: _q, packUsd: _u, packLabel: _l, ...rest } = price;
      const single: Price = { ...rest, usd: price.eachUsd, note: `${price.note ?? ''} Bought by the piece: ${qty} x ${usdText(price.eachUsd)}${packCost < Infinity ? ` against ${usdText(packCost)} for the bag` : ''}.`.trim() };
      return line(sectionTitle, label, description, qty, single, { ...extra, notes: single.note });
    }
    if (isBulkQty(price, qty)) return packLine(sectionTitle, label, description, qty, price, extra);
    // Sold in packs and the build needs half a pack or more: still whole packs (the real purchase), in place.
    if (price.packQty && price.packUsd) return packLine(sectionTitle, label, description, qty, price, extra, false);
    return line(sectionTitle, label, description, qty, price, { ...extra, ...(price.note ? { notes: price.note } : {}) });
  };
  const fastenerLines: BomLine[] = [...fast.entries()].sort((a, b) => familyOrder(a[0]) - familyOrder(b[0]) || a[0].localeCompare(b[0])).map(([label, qty]) => fastenerLine(label, qty));
  // A listing note that quotes "N by the piece is $X" for the quantity the default build needs (26 nuts) is restated for the quantity this build needs (removable knees add spares).
  for (const l of fastenerLines) {
    const restate = (t: string): string => t.replace(/\b(\d+) by the piece is (\d+\.\d+)/, (m, n0: string, t0: string) => (Number(n0) === (l.needed ?? l.qty) ? m : `${l.needed ?? l.qty} by the piece is ${(Math.round((Number(t0) / Number(n0)) * (l.needed ?? l.qty) * 100) / 100).toFixed(2)}`));
    if (l.notes) l.notes = restate(l.notes);
    if (l.alternatives) l.alternatives = l.alternatives.map((a) => (a.note ? { ...a, note: restate(a.note) } : a));
  }
  const fasteners: BomLine[] = fastenerLines;
  const touchFasteners: BomLine[] = [];
  for (const { label, group, qty } of [...touchFast.values()].sort((a, b) => familyOrder(a.label) - familyOrder(b.label) || a.label.localeCompare(b.label))) {
    touchFasteners.push(fastenerLine(label, qty, group));
  }
  touchLines.push(...touchFasteners);
  const unresolved = [...fastenerLines, ...touchFasteners].map((l) => l.key).filter((k) => /per joint note/.test(k) || (/^(?:316|18-8) .*\b(screw|bolt)\b/i.test(k) && !/screw eye|set-screw|insert/i.test(k) && !/ x \d+(?:-\d+\/\d+|\/\d+)?"| x \d+ mm/.test(k)));

  // Consumables. The coats' epoxy, the closes, the hardeners, the pumps and the finish products are the finishing schedule's buy list (so the BOM and the schedule agree);
  // the glue joints add their own epoxy (finishing.ts `glueEpoxyFlOz`, 5:1 with the kit's 206): all of them under the Extreme spec, only the ones that earn it under the Standard spec (the rest is Titebond III).
  const sched = finishingSchedule(parts, p);
  const plyFt2 = sched.areas.plyFt2, sealedFt2 = std ? 0 : plyFt2, oakFt2 = sched.areas.oakFt2;
  const glueJoints = jointCounts.glue;
  const epoxyStep = sched.steps.find((x) => x.id === 'epoxy');
  const finishEpoxyFlOz = (epoxyStep?.products ?? []).reduce((a, q) => a + q.qtNeeded, 0) * FLOZ_PER_QT;
  const closeEpoxyFlOz = sched.closeEpoxyFlOz ?? 0;
  const glueEpoxyTotal = glueEpoxyFlOz(parts, undefined, p) * (1 + EPOXY_WASTE);
  const epoxyFlOz = finishEpoxyFlOz + closeEpoxyFlOz + glueEpoxyTotal;
  const resinFlOz = glueEpoxyTotal * RESIN_SHARE_GLUE + (finishEpoxyFlOz + closeEpoxyFlOz) * RESIN_SHARE_COAT;

  // The cheapest way to cover the epoxy. West System: a gallon group is cheaper per ounce than quart groups, and three quarts can cost more than one gallon; the West kits come without pumps,
  // so the 300 Mini Pump Set is part of their cost. The small kits (D-79) are the U.S. Composites 635 thin epoxy 2:1 (96 oz mixed, pumps extra; considered for both specs) and, for the Standard spec only,
  // the 5:1 kits that come WITH pumps (MAS Epoxies 38.4 oz, TotalBoat quart). Each brand is a family (kits are not mixed across brands) and mixes at its own ratio, so the resin it needs is the mixed epoxy times
  // its resin share (5/6 for 5:1, 2/3 for 2:1); the cheapest family is bought and the others are shown as alternatives with their totals.
  const [quart, gallon] = [EPOXY_KITS[0], EPOXY_KITS[1]];
  let best: { q: number; g: number; usd: number } | null = null;
  for (let g = 0; g <= Math.ceil(resinFlOz / gallon.resinFlOz); g++) {
    const left = resinFlOz - g * gallon.resinFlOz;
    const q = left <= 0 ? 0 : Math.ceil(left / quart.resinFlOz);
    const usd = g * gallon.price.usd + q * quart.price.usd;
    if (!best || usd < best.usd - 1e-9 || (Math.abs(usd - best.usd) < 1e-9 && g + q < best.g + best.q)) best = { q, g, usd };
  }
  const westTotal = best!.usd + EPOXY_PUMPS_300.usd;
  const smallKits = EPOXY_KITS_SMALL.filter((k) => std || k.anySpec).map((k) => {
    const resinNeed = epoxyFlOz * k.resinShare;
    const n = Math.max(1, Math.ceil(resinNeed / k.resinFlOz - 1e-9));
    return { kit: k, n, resinNeed, usd: money(n * k.price.usd + (k.pumpsIncluded ? 0 : k.pumps?.usd ?? 0)) };
  });
  const cheapSmall = [...smallKits].sort((a, c) => a.usd - c.usd)[0];
  const useSmall = !!cheapSmall && cheapSmall.usd < westTotal - 1e-9;
  const ratioText = (k: { resinShare: number }): string => (k.resinShare > 0.7 ? '5:1' : '2:1');
  const familyAlts = (chosen: string): Price[] => [
    ...(chosen !== 'west' ? [{ ...quart.price, usd: money(westTotal), unit: 'total', packQty: undefined, packUsd: undefined, alternatives: undefined, source: 'West System', note: `${[best!.g ? `${best!.g} gallon group` : '', best!.q ? `${best!.q} quart group (1.2 quart kit)` : ''].filter(Boolean).join(' + ')} plus the 300 Mini Pump Set ${usdText(EPOXY_PUMPS_300.usd)} (the West kits come without pumps)` } as Price] : []),
    ...smallKits.filter((k) => k.kit.id !== chosen).map(({ kit, n, usd }) => ({ ...kit.price, usd, unit: 'total', packQty: undefined, packUsd: undefined, alternatives: undefined, note: `${n} x ${kit.label} (${n} kit${n === 1 ? '' : 's'}, ${kit.pumpsIncluded ? 'pumps included' : `plus ${usdText(kit.pumps?.usd ?? 0)} pumps`})` } as Price)),
  ];
  /** "Alternatives (not substituted): ..." for the kit families that cost more (`usd` of each is the family's whole cost for this epoxy). */
  const kitAltsNote = (alts: Price[]): string | undefined =>
    alts.length ? `Alternatives (not substituted): ${alts.map((a) => `${a.source} ${usdText(a.usd)} in all (${a.note ?? ''})${a.url ? ` ${a.url}` : ''}`).join(' | ')}` : undefined;
  const consumables: BomLine[] = [];
  const buyText = sched.buy.filter((x) => /West System/.test(x.item) || EPOXY_BUY_RE.test(x.item)).map((x) => `${x.qty} ${x.unit} ${x.item.replace('West System ', '')}`).join(', ');
  const epoxyNoteFor = (resinText: string, ratio: string): string => `${resinText} fl oz resin: ${Math.ceil(glueEpoxyTotal)} fl oz mixed for the glue joints that use epoxy (estimated by joint type, +${Math.round(EPOXY_WASTE * 100)}% waste, mixed at the kit's ${ratio}), ${Math.ceil(finishEpoxyFlOz)} fl oz for the ${std ? 'edge, end-grain and deck-underside coat' : 'one seal coat'} (the transom and bulkhead closes are glue joints, in the first figure; the schedule's quantities are mixed volume, so they hold for any kit${buyText ? `: ${buyText}` : ''}). Cheapest kit combination that covers it.`;
  if (useSmall) {
    const over = cheapSmall.resinNeed - (cheapSmall.n - 1) * cheapSmall.kit.resinFlOz;
    let epoxyNote = epoxyNoteFor(String(Math.ceil(cheapSmall.resinNeed)), ratioText(cheapSmall.kit));
    if (cheapSmall.n > 1 && over <= 0.2 * cheapSmall.kit.resinFlOz) epoxyNote += ` The need is only ${Math.ceil(over)} fl oz of resin past ${cheapSmall.n - 1} kit${cheapSmall.n === 2 ? '' : 's'} (the estimates carry ${Math.round(EPOXY_WASTE * 100)}% waste on the joints and 15% on the coat): ${cheapSmall.n - 1} kit${cheapSmall.n === 2 ? '' : 's'} may do if you mix tight.`;
    // A single kit with a thin margin: the estimates are rough, so say to plan a second kit or a top-up (the extra-kit note above only fires when more than one kit is bought).
    const capacity = cheapSmall.n * cheapSmall.kit.mixedFlOz, spare = (capacity - epoxyFlOz) / capacity;
    if (spare < EPOXY_THIN_MARGIN) epoxyNote += ` Thin margin: the need is about ${Math.ceil(epoxyFlOz)} fl oz mixed from ${capacity} fl oz of kit (${Math.max(0, Math.round(spare * 100))}% to spare). Plan a second kit, or a quart of epoxy as a top-up (keep each batch to one brand and ratio), before the glue-up starts.`;
    consumables.push(line('Consumables', `epoxy-${cheapSmall.kit.id}`, cheapSmall.kit.label, cheapSmall.n, cheapSmall.kit.price, { vendor: cheapSmall.kit.price.source, notes: joinNotes(`Price: ${cheapSmall.kit.price.note}.`, epoxyNote, kitAltsNote(familyAlts(cheapSmall.kit.id))), alternatives: familyAlts(cheapSmall.kit.id) }));
    if (!cheapSmall.kit.pumpsIncluded && cheapSmall.kit.pumps) consumables.push(line('Consumables', 'epoxy-pumps', `Pump set for the ${cheapSmall.kit.label.split(',')[0]}`, 1, cheapSmall.kit.pumps, { vendor: cheapSmall.kit.pumps.source, notes: `Price: ${cheapSmall.kit.pumps.note}.` }));
  } else {
    const epoxyNote = epoxyNoteFor(String(Math.ceil(resinFlOz)), '5:1 (105 resin with 206 slow hardener)');
    const alts = familyAlts('west');
    if (best!.g) consumables.push(line('Consumables', 'epoxy-gallon', gallon.label, best!.g, gallon.price, { vendor: gallon.price.source, notes: joinNotes(`Price: ${gallon.price.note}.`, epoxyNote, kitAltsNote(alts)), ...(alts.length ? { alternatives: alts } : {}) }));
    if (best!.q) consumables.push(line('Consumables', 'epoxy-quart', quart.label, best!.q, quart.price, { vendor: quart.price.source, notes: joinNotes(`Price: ${quart.price.note}.`, best!.g ? undefined : epoxyNote, best!.g ? undefined : kitAltsNote(alts)), ...(!best!.g && alts.length ? { alternatives: alts } : {}) }));
  }
  // Hardeners: 205/206 come in the resin kits (the schedule uses 206 only, so its buy list names none). 207 and 209 are not bought (their sizes are 0.66 pt and 0.33 gal, not the pint
  // the BOM once priced): a schedule that asks for one is flagged unpriced rather than priced at a size that does not exist.
  for (const hb of sched.buy.filter((x) => /West System/.test(x.item) && /hardener/i.test(x.item))) if (/\b20[79]\b/.test(hb.item)) unpriced.push(hb.item);
  // Pumps: West System no longer sells the 301 and 303 sets; the 300 Mini Pump Set (resin, 205/206 and 207/209 pumps) does both ratios, one set for the sled. The small 5:1 kits include their pumps.
  if (!useSmall) consumables.push(line('Consumables', 'epoxy-pumps', 'West System 300 Mini Pump Set (three pumps: resin and both hardener ratios; one set does both)', 1, EPOXY_PUMPS_300, { vendor: EPOXY_PUMPS_300.source, notes: `Price: ${EPOXY_PUMPS_300.note}.` }));
  // Titebond III (Standard): shop stock (D-79), $0, kept as a line. The quantity is the glue joints that are not epoxy (+waste).
  if (std && sched.glue.titebondJoints > 0) {
    const need = sched.glue.titebondFlOz;
    consumables.push(line('Consumables', 'titebond', 'Titebond III Ultimate wood glue', Math.ceil(need), TITEBOND_OWNED, { vendor: TITEBOND_OWNED.source,
      notes: `${sched.glue.titebondJoints} glue joints (the Dominos, dados, tenons and general glue joints), about ${Math.ceil(need)} fl oz with the ${Math.round(EPOXY_WASTE * 100)}% waste (0.4 of the epoxy estimate for the same joints: one thin coat, no filler). Epoxy is kept for the bent laminations, the face laminations, the deck, the fillets and the thickened bedding. Check the bottle in the shop holds that much.` }));
  }
  consumables.push(line('Consumables', 'silica', 'Fumed silica filler (thickened glue, fillets)', 1, FILLERS.silica, { vendor: FILLERS.silica.source, notes: `Price: ${FILLERS.silica.note}.` }));
  // Microballoons fair the epoxy-sealed deck top: the Standard spec does not seal it (the deck top is urethaned), so it does not buy them.
  if (!std) consumables.push(line('Consumables', 'microballoons', 'Low-density fairing filler', 1, FILLERS.microballoons, { vendor: FILLERS.microballoons.source, notes: `Price: ${FILLERS.microballoons.note}.` }));
  const tapeFt = Math.ceil(tapeJoints * TAPE_FT_PER_JOINT * (1 + TAPE_WASTE));
  if (tapeFt > 0) {
    // Sold by the yard (D-79): whole yards.
    const tapeYd = Math.ceil(tapeFt / 3 - 1e-9);
    consumables.push(line('Consumables', 'glass-tape', 'Fiberglass tape, 2" wide, by the yard', tapeYd, GLASS_TAPE, { vendor: GLASS_TAPE.source, notes: joinNotes(`Price: ${GLASS_TAPE.note}.`, `${tapeJoints} taped joints x ${TAPE_FT_PER_JOINT} ft, +${Math.round(TAPE_WASTE * 100)}%: ${tapeFt} ft, ${tapeYd} yd`) }));
  }
  consumables.push(...noteLines);
  // The finish products, container by container, exactly as the schedule's buy list names them.
  const finishKey = (item: string): { key: string; table: string; price: Price } | null => {
    if (/West System/.test(item) || EPOXY_BUY_RE.test(item)) return null; // the epoxy is priced as a kit above
    if (/conditioner/i.test(item)) return { key: 'conditioner', table: 'conditioner', price: FINISH_PRICE.conditioner };
    if (/gel stain/i.test(item)) return { key: 'gel-stain', table: 'gelStain', price: FINISH_PRICE.gelStain };
    if (/stain or dye/i.test(item)) return { key: 'stain', table: 'stain', price: FINISH_PRICE.stain };
    if (/thinner/i.test(item)) return { key: 'thinner', table: 'thinner', price: FINISH_PRICE.thinner };
    if (/urethane/i.test(item)) return { key: 'urethane', table: 'urethane', price: URETHANE_CONTAINER_PRICE.qt! };
    if (/varnish/i.test(item)) return { key: 'varnish', table: 'varnish', price: FINISH_PRICE.varnish };
    if (/paint marker|enamel|pigment/i.test(item)) return { key: 'paint-marker', table: 'enamel', price: FINISH_PRICE.enamel };
    return null;
  };
  for (const bl of sched.buy) {
    const k = finishKey(bl.item);
    if (!k) { if (!/West System/.test(bl.item) && !EPOXY_BUY_RE.test(bl.item)) unpriced.push(bl.item); continue; }
    // The real container price where the research found one, else the base per-quart price scaled by the container size.
    const price: Price = (k.table === 'urethane' ? URETHANE_CONTAINER_PRICE[bl.unit] : FINISH_CONTAINER_PRICE[k.table]?.[bl.unit]) ?? { ...k.price, usd: money(k.price.usd * FINISH_CONTAINER_FACTOR[bl.unit]), unit: bl.unit };
    // The paint marker is bought as a marker, not by the pint (the schedule counts it as a half pint of fill).
    const desc = k.key === 'paint-marker' ? bl.item : `${bl.item}, ${bl.unit}`;
    consumables.push(line('Consumables', k.key === 'paint-marker' ? 'paint-marker' : `${k.key}-${bl.unit}`, desc, bl.qty, price, { vendor: price.source, notes: joinNotes(price.url ? `Price: ${price.note}.` : undefined, bl.note) }));
  }
  // Sandpaper and the supplies lot are shop stock (D-79): $0 lines so they are not forgotten.
  consumables.push(line('Consumables', 'sandpaper', 'Sandpaper, lump sum', 1, FINISH_PRICE.sandpaper, { vendor: FINISH_PRICE.sandpaper.source }));
  consumables.push(line('Consumables', 'supplies', 'Brushes, rollers, cups, gloves, solvent', 1, FINISH_PRICE.supplies, { vendor: FINISH_PRICE.supplies.source }));

  // Finishing touches, after the core sections: by group (lights, seat comfort, reflectors, tie-downs), the groups in a fixed order.
  const touchOrder = (l: BomLine): number => TOUCH_GROUPS.findIndex((g) => g.id === l.group);
  touchLines.sort((a, b) => touchOrder(a) - touchOrder(b));
  const touches = section(TOUCHES_SECTION.id, TOUCHES_SECTION.title, touchLines, {
    groups: TOUCH_GROUPS.map((g) => {
      const ls = touchLines.filter((l) => l.group === g.id);
      return { id: g.id, title: g.title, subtotalUsd: money(ls.reduce((a, l) => a + l.extUsd, 0)), estimateUsd: money(ls.filter((l) => l.basis === 'estimate').reduce((a, l) => a + l.extUsd, 0)) };
    }),
    notes: [
      `The ${built.filter((x) => /^side-rib/.test(partKey(x)) || partKey(x) === 'box-tie').length} oak side ribs, knees and box ties that carry the D-rings are bandsawn from 4/4 offcuts and priced in Lumber; the D-ring plates' bolts, washers and nuts are listed here.`,
    ],
  });
  const core: BomSection[] = [
    section('lumber', 'Lumber', lumber),
    section('plywood', 'Plywood', plywood),
    section('metal', 'Metal stock', metal),
    section('purchased', 'Purchased parts', purchased),
    section('fasteners', 'Fasteners', fasteners, { notes: [std ? FASTENER_MATERIAL_NOTE_STANDARD : FASTENER_MATERIAL_NOTE, FASTENER_PACK_NOTE] }),
    section('consumables', 'Consumables', consumables),
  ];
  const sections: BomSection[] = [...core, touches];
  // Safety net: the BOM is printed in the book, so no decision id (D-71), report tag (S7) or part key (brake-knee) may be left in its running text (some of it comes from the model's own part notes).
  const keyWords = shopKeys(parts);
  for (const sec of sections) {
    for (const l of sec.lines) {
      l.description = shopBomText(l.description, keyWords);
      if (l.vendor) l.vendor = shopBomText(l.vendor, keyWords);
      if (l.notes) l.notes = shopBomText(l.notes, keyWords);
      if (l.decision) l.decision = shopBomText(l.decision, keyWords);
      if (l.materialNote) l.materialNote = shopBomText(l.materialNote, keyWords);
    }
    if (sec.notes) sec.notes = sec.notes.map((n) => shopBomText(n, keyWords));
  }
  const coreUsd = money(core.reduce((a, s) => a + s.subtotalUsd, 0));
  const coreEstimateUsd = money(core.reduce((a, s) => a + s.estimateUsd, 0));
  const touchesUsd = touches.subtotalUsd, touchesEstimateUsd = touches.estimateUsd;
  const totalUsd = money(coreUsd + touchesUsd);
  const estimateUsd = money(coreEstimateUsd + touchesEstimateUsd);
  const totalsText = totalsLine(coreUsd, touchesUsd, totalUsd);
  const lineVendors = sections.flatMap((x) => x.lines).map((l) => l.vendor ?? '');
  const shippingVendors = SHIPPING_VENDORS.filter((v) => lineVendors.some((x) => v.match.test(x))).map((v) => v.name);
  const shippingNote = shippingNoteText(shippingVendors);

  // Lines that need a decision from Eric (the Domino 4x20, the wheel spec, the shaft collars, the eye bolts...), in the order of the sections.
  const decisions = [...new Set(sections.flatMap((x) => x.lines).filter((l) => l.decision).map((l) => l.key))];
  const altText = (l: BomLine): string | undefined => l.alternatives?.map((a) => `${a.specGap ? 'SPEC GAP: ' : ''}${a.source} ${a.packUsd ?? a.usd.toFixed(2)}${a.packQty ? ` per ${a.packLabel ?? `pack of ${a.packQty}`}` : `/${a.unit}`}${a.url ? ` ${a.url}` : ''}`).join(' | ');
  const rows: CsvCell[][] = [['Section', 'Item', 'Description', 'Qty', 'Unit', 'Unit USD', 'Ext USD', 'Basis', 'Vendor', 'Notes', 'URL', 'Group', 'Needed', 'Pack size', 'Packs to buy', 'Pack USD', 'Material', 'Alternatives', 'Decision']];
  for (const s of sections) {
    for (const l of s.lines) rows.push([s.title, keyWords.has(l.key) ? '' : l.key, l.description, l.qty, l.unit, l.unitUsd.toFixed(2), l.extUsd.toFixed(2), l.basis, l.vendor, l.notes, l.url, l.group ? TOUCH_GROUPS.find((g) => g.id === l.group)!.title : undefined, l.needed, l.packQty, l.packs, l.packUsd?.toFixed(2), l.materialNote, altText(l), l.decision]);
    for (const g of s.groups ?? []) rows.push([s.title, '', `Subtotal: ${g.title}`, '', '', '', g.subtotalUsd.toFixed(2), '', '', `${g.estimateUsd.toFixed(2)} of it estimated`, '', g.title]);
    rows.push([s.title, '', 'Subtotal', '', '', '', s.subtotalUsd.toFixed(2), '', '', `${s.estimateUsd.toFixed(2)} of it estimated${s.notes?.length ? `. ${s.notes.join(' ')}` : ''}`]);
  }
  const share = (e: number, t: number): number => (t ? e / t : 0);
  rows.push(['Total', '', 'Build (core sections)', '', '', '', coreUsd.toFixed(2), '', '', `${(100 * share(coreEstimateUsd, coreUsd)).toFixed(0)}% estimates`]);
  rows.push(['Total', '', 'Finishing touches', '', '', '', touchesUsd.toFixed(2), '', '', `${(100 * share(touchesEstimateUsd, touchesUsd)).toFixed(0)}% estimates`]);
  rows.push(['Total', '', 'Grand total', '', '', '', totalUsd.toFixed(2), '', '', `${totalsText}; ${(100 * share(estimateUsd, totalUsd)).toFixed(0)}% estimates`]);
  rows.push(['Total', '', 'Shipping and tax', '', '', '', '', '', '', shippingNote]);
  rows.push(['Total', '', 'Weather spec', '', '', '', '', '', '', `${std ? 'Standard (garage-kept)' : 'Extreme weather (stored outside, near salt)'}; thin sheet: ${thin.name}`]);

  return {
    spec, thinSheetName: thin.name, sections, totalUsd, estimateUsd, estimateShare: share(estimateUsd, totalUsd), coreUsd, touchesUsd, coreEstimateUsd, touchesEstimateUsd,
    coreEstimateShare: share(coreEstimateUsd, coreUsd), touchesEstimateShare: share(touchesEstimateUsd, touchesUsd), totalsText, shippingVendors, shippingNote, jointCounts, unpriced: [...new Set(unpriced)], decisions,
    consumables: { epoxyFlOz, finishEpoxyFlOz, closeEpoxyFlOz, glueEpoxyFlOz: glueEpoxyTotal, resinFlOz, sealedFt2, oakFt2, plyFt2, glueJoints, tapeFt }, unresolved, wholeBoardsExtraUsd: 0, lumberAllowanceUsd: money(lumberAllowanceUsd), lumberAltUsd: money(lumberAltUsd), csv: toCsv(rows),
  } as Bom; // `weatherCompare` is added by `bom` (a lazy getter)
}

