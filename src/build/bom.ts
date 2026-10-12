/**
 * Bill of materials with costs (Phase 4). Plain TS, no three.js; a pure function of (parts, params).
 *
 * Sections: Lumber (the suggested WHOLE oak boards by thickness, from `nesting.ts`: a yard sells boards, not net board feet), Plywood (sheets, from the nest), Metal stock
 * (cut-to-length feet), Purchased parts (by partNo), Fasteners (expanded from the joint list), Consumables (epoxy, fillers, tape, finish, sandpaper). The epoxy and the finish
 * products come from `finishingSchedule` (its buy list, so the BOM and the schedule agree) plus the epoxy for the glue joints.
 * Prices come from `prices.ts`; a number the model carries (`sourcing.costUsd`) is `quoted`, and so is every table price from the web price research of 2026-10-12 (with its URL); the rest are
 * `estimate`s. A line's alternatives (cheaper or different items that do not meet the spec, labelled SPEC GAP) are in its notes and in `BomLine.alternatives`; a line that needs a decision from
 * Eric (`BomLine.decision`) is listed in `Bom.decisions`.
 *
 * Fasteners mirror `fastenerBreakdown` (src/model/lighting.ts): a joint listed on both of its parts counts once, a joint to a part that is
 * not in the configuration is skipped, and the `hardware` mass allowance is replaced by the expanded list. Unlike the mass allowance, the
 * bolts of the axle clamps and hold-downs are listed (their plates are parts, their bolts are not), and only the shank-itemized bolts
 * (steering eye bolts, kingpin) are left out of the bolt lines.
 *
 * Finishing touches (Eric, 2026-10-12): the lights, the seat cushions, the reflectors and the lash-point tie-downs are priced as their own section AFTER the core ones, so the
 * cost of the sled can be read with and without them. `touchGroupOfPart` says which parts belong, and every fastener or consumable that exists for one of them (the lamp-clip inserts and
 * screws, the Dual Lock, the lash-plate screws) follows its part.
 *
 * Bulk parts (Eric, 2026-10-12): an item sold in packs much larger than the sled needs (screws, nuts, washers, inserts, T-nuts, Dominos, glass tape, sandpaper, cotter pins, plugs)
 * is priced by the PACK in its own section, even when it is used in the core build: "I would keep the rest and use them in my shop (and might already have them)". The rule is
 * `isBulkQty`: the build needs under `BULK_SHARE` of the smallest pack (`Price.packQty`), plus the explicit `BULK_ALWAYS` list. Bolts and anything bought one at a time stay in place.
 * Finishing-touches lines keep their own section whatever their pack size (so dropping the lights drops their cost), priced by the pack too.
 * `Bom.coreUsd + Bom.bulkUsd + Bom.touchesUsd = Bom.totalUsd`.
 *
 * Every fastener and hardware line carries a `materialNote` (exterior use: what it must be made of, by where it lives).
 */
import { localBounds } from '../model/bounds';
import type { Joint, Part } from '../model/types';
import type { Params } from '../params';
import { cutList, fracIn, isBuilt, partKey, toCsv, type CsvCell } from './cutlist';
import { finishingSchedule, glueEpoxyFlOz } from './finishing';
import { nestPlywood, oakBoardFeet } from './nesting';
import {
  EPOXY_KITS, EPOXY_PUMPS_300, FILLERS, FINISH_CONTAINER_FACTOR, FINISH_CONTAINER_PRICE, FINISH_PRICE, GLASS_TAPE, METAL_CUT_ALLOWANCE_IN, NOTE_PRICE, OAK_ALT_PRICE_PER_BF, OAK_PRICE_PER_BF, PLYWOOD_PRICE, RESEARCH_DATE,
  PURCHASED_FALLBACK, fastenerPrice, metalPrice, modelCostNote, purchasedEntry, type Price, type PriceBasis,
} from './prices';

// ── Consumable assumptions (all estimates; also in docs/phase4-data-notes.md) ─
/** Mixing, pot and brush waste on top of the glue epoxy of `glueEpoxyFlOz` (finishing.ts: per-joint-type estimates, before waste). The coats' quantities carry their own waste. */
export const EPOXY_WASTE = 0.2;
/** Resin share of the mixed volume: 5:1 for everything (105 with 206: the glue, the seal coat and the closes). */
const RESIN_SHARE_GLUE = 5 / 6;
const RESIN_SHARE_COAT = 5 / 6;
/** Glass tape per taped joint (ft), and the waste on top. */
export const TAPE_FT_PER_JOINT = 1.5;
export const TAPE_WASTE = 0.25;
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
   * Priced by the pack (Bulk parts section, or a pack-priced line of the touches): `needed` is the quantity the build uses, `packQty` the pack size, `packs` the packs to buy and `packUsd` the cost of one pack.
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

/** A line is bulk when the build needs less than this share of the smallest pack. */
export const BULK_SHARE = 0.5;
/** Priced by the pack whatever the share (the lump-sum items): keys of the consumable lines. */
export const BULK_ALWAYS: ReadonlySet<string> = new Set(['sandpaper']);
/** True when `qty` pieces are under `BULK_SHARE` of the price's smallest pack (a price without a pack is never bulk). */
export const isBulkQty = (price: Price, qty: number): boolean => !!price.packQty && !!price.packUsd && qty < BULK_SHARE * price.packQty;

/**
 * Why every fastener is 316 stainless, said once (the section note): S7 bars zinc, brass and plated steel from wet white oak, because oak tannins corrode them and stain the wood black. 304 stainless
 * is a possible cost cut where a line says "(304 or 316)"; the prices here are 316.
 */
export const FASTENER_MATERIAL_NOTE =
  'Exterior use: every fastener is 316 stainless (S7: no zinc, brass or plated steel in wet white oak, because oak tannins corrode them and stain the wood black). ' +
  'The Dominos are Festool Sipo (sapele), the exterior hardwood type, never beech (interior only). 304 stainless is a possible cost cut where a line says "304 or 316"; the prices here are for 316 (base prices first).';

const DECK_OK_PARTS = /^(storage-lid-batten|storage-rim|storage-coaming|seat-wedge|seat-crest|sign-)/;
const SHELTERED_PARTS = /^(storage-|seat-(hinge|back|wedge|crest|pin)|sign-|flag-)/;
/**
 * The material a fastener line must be made of, by label and by the parts it fixes. First match wins. `usedOn` are the ids of the parts of the joints that need the item (empty: unknown, so
 * the strict default applies).
 */
export function fastenerMaterialNote(label: string, usedOn: readonly string[] = []): string {
  if (/^Domino/.test(label)) return 'Festool SIPO (sapele) Dominos REQUIRED: the exterior/hardwood type. NOT beech: beech is interior only and swells and rots when it gets wet. Epoxy them in.';
  if (/heat-set insert/i.test(label)) return 'Brass heat-set insert OK: it sits in the printed ASA lamp clip, not in wet oak (brass is barred only from wet oak, S7).';
  if (/nylon washer|button plug|end plug/i.test(label)) return 'Nylon or plastic, UV-stable: no metal involved.';
  if (/\bM[34]\b/.test(label)) return 'Stainless (304 or 316): screws into the brass insert in the printed clip, away from the oak.';
  if (/cotter pin|shaft collar|stainless rod/i.test(label)) return '316 stainless REQUIRED: at the wheel end of the axle or in the handle pins, in slush and road salt; plated steel rusts in a week.';
  const on = usedOn.length ? usedOn : ['?'];
  if (/wood screw/i.test(label) && on.every((id) => DECK_OK_PARTS.test(id))) return 'Exterior-coated deck screw OK (hidden, epoxy-sealed, wood to wood, lightly loaded); 316 stainless is the model spec and what the price assumes.';
  if (on.every((id) => SHELTERED_PARTS.test(id))) return 'Stainless (304 or 316): sheltered in the storage box or under the seat; 316 is the model spec and what the price assumes.';
  return '316 stainless REQUIRED: in wet white oak (tannins corrode coated steel and stain the wood black). 304 is a possible cost cut, not priced.';
}

const METAL_SPEC = /stainless|316|steel|bronze|zinc|galvanized|grade \d|hinge|chain|latch|clevis|hitch|snap hook|D-ring/i;
/** The material note of a purchased hardware part (hinges, latches, pins, chain, eye bolts...), from the model's own spec; undefined for rope, foam, rubber, plastic, lights and other non-metal parts. */
export function hardwareMaterialNote(x: Part): string | undefined {
  const m = x.material ?? '';
  if (x.kind !== 'purchased' || !METAL_SPEC.test(m)) return undefined;
  if (/316/.test(m)) return `316 stainless REQUIRED (the model spec: ${m}).`;
  if (/stainless/i.test(m)) return `Stainless REQUIRED, 316 for wet oak (the model spec: ${m}).`;
  if (/zinc|galvanized|grade \d|steel/i.test(m)) return `As specified: ${m}. Plated or galvanized steel rusts and stains white oak black; 316 stainless is the model default (S7), so check the listing before ordering.`;
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
/** The finishing-touches group of a part, by part number; undefined for every part of the core build. The lash doublers are oak cut from the boards (priced in Lumber), but their screws follow the lash plates. */
export function touchGroupOfPart(x: Part | undefined): TouchGroup | undefined {
  switch (x ? partKey(x) : '') {
    case 'front-light': case 'rear-light': case 'lamp-clip': case 'rear-lamp-clip': return 'lights';
    case 'seat-cushion': case 'seat-back-pad': return 'seat';
    case 'reflector': return 'reflectors';
    case 'lash-point': case 'doubler-lash': return 'tie-downs';
    default: return undefined;
  }
}
/** Parts bought and priced as a line of their own in the touches section: the lash doublers are NOT (they are cut from the oak boards and priced in Lumber). */
export const TOUCH_PRICED_PARTS: ReadonlySet<string> = new Set(['front-light', 'rear-light', 'lamp-clip', 'rear-lamp-clip', 'seat-cushion', 'seat-back-pad', 'reflector', 'lash-point']);

/** Id and title of the section that holds the touches, and of the section for pack-priced shop stock. */
export const TOUCHES_SECTION = { id: 'touches', title: 'Finishing touches' } as const;
export const BULK_SECTION = { id: 'bulk', title: 'Bulk parts (shop stock)' } as const;

export interface BomGroupTotal { id: TouchGroup; title: string; subtotalUsd: number; estimateUsd: number }

export interface BomSection {
  id: 'lumber' | 'plywood' | 'metal' | 'purchased' | 'fasteners' | 'consumables' | 'bulk' | 'touches';
  title: string;
  lines: BomLine[];
  subtotalUsd: number;
  /** The part of the subtotal that is an estimate. */
  estimateUsd: number;
  /** The touches section: subtotals by group (lights, seat comfort, reflectors, tie-downs); each line carries its `group`. */
  groups?: BomGroupTotal[];
  /** Notes printed under the section (the lash doublers are in Lumber). */
  notes?: string[];
}

export interface FastenerJointCounts { screw: number; bolt: number; 'threaded-insert': number; knob: number; domino: number; glue: number }

export interface Bom {
  sections: BomSection[];
  totalUsd: number;
  estimateUsd: number;
  /** estimateUsd / totalUsd. */
  estimateShare: number;
  /** The core sections (lumber to consumables), the bulk-parts section and the touches section: `coreUsd + bulkUsd + touchesUsd = totalUsd`. */
  coreUsd: number;
  bulkUsd: number;
  touchesUsd: number;
  /** The estimated part of each, and its share (0 to 1) of that subtotal. */
  coreEstimateUsd: number;
  bulkEstimateUsd: number;
  touchesEstimateUsd: number;
  coreEstimateShare: number;
  bulkEstimateShare: number;
  touchesEstimateShare: number;
  /** "Build $2,100.00 + bulk parts $190.00 + finishing touches $240.00 = $2,530.00" */
  totalsText: string;
  /** Joint counts the fastener lines were expanded from (equal to `fastenerBreakdown`'s counts). */
  jointCounts: FastenerJointCounts;
  /** Parts or fasteners with no price in prices.ts (empty at the defaults). */
  unpriced: string[];
  /**
   * `epoxyFlOz` = mixed epoxy the purchase covers: `finishEpoxyFlOz` (the schedule's one seal coat, 5:1) + `closeEpoxyFlOz` (0 now: the closes are glue joints, 206, inside `glueEpoxyFlOz`) + `glueEpoxyFlOz` (the glue joints
   * from `glueEpoxyFlOz()` in finishing.ts plus `EPOXY_WASTE`, 5:1). `resinFlOz` is the resin of that mix. `sealedFt2` is the okoume surface of the schedule.
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
  /** The same whole boards at the alternative (far, cheaper) published prices (`OAK_ALT_PRICE_PER_BF`, Cline Lumber); thicknesses with no alternative count at the base price. */
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
const joinNotes = (...n: Array<string | undefined>): string | undefined => n.filter(Boolean).join(' ') || undefined;

function line(section: string, key: string, description: string, qty: number, price: Price, extra: Partial<BomLine> = {}): BomLine {
  const px = priceExtras(price, qty);
  const notes = joinNotes(extra.notes, px.notes);
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
/** "Build $X + bulk parts $B + finishing touches $Y = $Z". */
export const totalsLine = (core: number, bulk: number, touches: number, total: number): string => `Build ${usdText(core)} + bulk parts ${usdText(bulk)} + finishing touches ${usdText(touches)} = ${usdText(total)}`;

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
  const share = `Need ${r2(needed)} ${unitWord}, ${sold} at ${usdText(packUsd)}.${shop ? ' You may already have these in the shop; keep the rest.' : ''}`;
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

/** Items one joint needs. Bolts bring a nut and washers; a bolt whose shank is a separate part (eye bolt, kingpin) brings only what is not in that part. `byId` is for the length fallback. */
export function jointItems(part: Part, j: Joint, byId: PartMap = new Map()): FastenerItem[] {
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
      return [{ label: t ? `316 threaded insert #${t[1]}-${t[2]} x ${lenText(t[3])}"` : '316 threaded insert (size per joint note)', qty: n }];
    }
    case 'knob': {
      // A thumb knob is a #10-32 screw with a size in its text. A `knob` joint without one is not a screw to buy (the brake snap hook was typed this way): nothing to order.
      const t = new RegExp(String.raw`#(\d+)-(\d+)\s*[x×]\s*${LEN}`).exec(size);
      return t ? [{ label: `Thumb-knob screw #${t[1]}-${t[2]} x ${lenText(t[3])}"`, qty: n }] : [];
    }
    case 'screw': return screwItems(part, j, byId);
    case 'bolt': return boltItems(part, j, byId);
    case 'pin': {
      // A stainless rod epoxied into two parts (the handlebow pins) is stock to cut; clevis and hitch pins are purchased parts.
      const r = new RegExp(String.raw`(\d\/\d+)"\s*[×x]\s*${LEN}"?\s*(?:316 )?stainless rod`, 'i').exec(size);
      return r ? [{ label: `316 stainless rod ${r[1]}" x ${lenText(r[2])}"`, qty: n }] : [];
    }
    default: return [];
  }
}

function screwItems(part: Part, j: Joint, byId: PartMap): FastenerItem[] {
  const size = j.size ?? '';
  const n = j.count;
  if (/screw eye/i.test(size)) { const g = /#(\d+)/.exec(size); return [{ label: `316 screw eye ${g ? '#' + g[1] : '(size per joint note)'}`, qty: n }]; }
  const ins = new RegExp(String.raw`#(\d+)-(\d+)\s*[x×]\s*${LEN}`).exec(size);
  if (/insert/i.test(size) && ins) {
    const out: FastenerItem[] = [{ label: `316 threaded insert #${ins[1]}-${ins[2]} x ${lenText(ins[3])}"`, qty: n }];
    // The hinge leaves are screwed into these inserts (assembly step: "#10-32 x 3/8 screws to the inserts"): a machine screw one leaf thicker than the insert is long.
    if (/hinge/i.test(`${j.to} ${part.id}`)) out.push({ label: `316 flat-head machine screw #${ins[1]}-${ins[2]} x ${fracIn(Math.ceil((Number(eval16(ins[3])) + HINGE_LEAF_IN) * 8 - 1e-6) / 8)}"`, qty: n });
    return out;
  }
  const metric = /\bM(\d)\b(?:\s*[x×]\s*(\d+))?/.exec(size);
  if (metric) return [{ label: `316 screw M${metric[1]} x ${metric[2] ?? METRIC_SCREW_MM[metric[1]] ?? '?'} mm`, qty: n }];
  if (ins) return [{ label: `316 machine screw #${ins[1]}-${ins[2]} x ${lenText(ins[3])}"`, qty: n }];
  const w = new RegExp(String.raw`#(\d+)\s*[x×]\s*${LEN}`).exec(size);
  if (w) return [{ label: `316 wood screw #${w[1]} x ${lenText(w[2])}"`, qty: n }];
  const g = /#(\d+)/.exec(size);
  if (!g) return [{ label: '316 screw (size per joint note)', qty: n }];
  const gl = GENERIC_LEN.exec(size);
  const len = gl ? Number(eval16(gl[1])) : screwLengthFromStack(part, j, byId);
  return [{ label: `316 wood screw #${g[1]} x ${len ? fracIn(len) + '"' : '(length per joint note)'}`, qty: n }];
}

/** `1-3/4`, `7/8`, `0.875`, `2` to a number. */
function eval16(s: string): number {
  const m = /^(?:(\d+)-)?(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[1] ?? 0) + Number(m[2]) / Number(m[3]);
  return Number(s);
}

function boltItems(part: Part, j: Joint, byId: PartMap): FastenerItem[] {
  const size = j.size ?? '';
  const n = j.count;
  if (/see the bushing/.test(size)) return [];
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
  const nut: FastenerItem = { label: tnut ? `316 T-nut ${t}` : `316 nylon-insert lock nut ${t}`, qty: n };
  const washer = (k: number): FastenerItem => ({ label: `316 fender washer ${d}"`, qty: k * n });
  if (/eye bolt/i.test(size) || /eye bolt/i.test(part.name)) return [nut, washer(1)]; // the eye bolt itself is the steer-eye / steer-anchor part
  if (/kingpin/i.test(size)) return []; // the kingpin part includes its washers and nut
  if (!len) { // no length in the text: another "x L" in it, else the stack of parts the bolt crosses
    const gl = GENERIC_LEN.exec(size);
    const v = gl ? eval16(gl[1]) : boltLengthFromStack(part, j, byId);
    if (v) len = fracIn(v);
  }
  if (/tapped/.test(size)) return [{ label: `316 machine screw ${t}${len ? ` x ${len}"` : ''} (tapped)`, qty: n }];
  const type = /button-head/.test(size) ? 'button-head cap screw' : /carriage/.test(size) ? 'carriage bolt' : 'hex bolt';
  const label = `316 ${type} ${t}${len ? ` x ${len}"` : ' (length per joint note)'}`;
  // A nylon washer under the head (handle sockets) replaces one of the two fender washers.
  const nylon = /nylon washer/i.test(size);
  const out: FastenerItem[] = [{ label, qty: n }, nut, washer(tnut ? (nylon ? 0 : 1) : type === 'carriage bolt' || nylon ? 1 : 2)];
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
  section: 'fasteners' | 'consumables';
  /** Price of the consumable line (fasteners are priced by label in prices.ts). */
  price?: Price;
  /** Set when the item exists for a finishing-touches group: the line goes to that section instead. */
  touch?: TouchGroup;
  /** Parts whose note or joint text names the item. Each must still exist: a test checks it, so a renamed part cannot silently drop the item. */
  partIds: string[];
  /** Where the text is, for the BOM note. */
  noteRef: string;
  /** What to buy for the built parts of this configuration; null when none of the cited parts is built. */
  expand(built: Part[], joints: Array<{ part: Part; joint: Joint }>): { items: FastenerItem[]; note: string } | null;
}

const byIds = (built: Part[], ids: string[]): Part[] => built.filter((x) => ids.includes(x.id));
const ptext = (x: Part): string => `${x.notes ?? ''} ${x.sourcing?.vendor ?? ''} ${(x.joints ?? []).map((j) => `${j.size ?? ''} ${j.note ?? ''}`).join(' ')}`;
const wheelIds = ['wheel-RL', 'wheel-RR', 'wheel-FL', 'wheel-FR'];
const axleIds = ['axle-R', 'axle-FL', 'axle-FR'];
const COTTER_DIAS: Array<[number, string]> = [[1 / 16, '1/16'], [3 / 32, '3/32'], [1 / 8, '1/8'], [5 / 32, '5/32'], [3 / 16, '3/16']];

/** Dual Lock strip per pad/cushion and its mate: 3 ft of 1 in strip (both halves of the pair). */
export const DUAL_LOCK_FT_PER_PART = 3;
/** Length of a Dual Lock roll (ft): the 3M SJ3560 retail roll of the research is 1 in x 6 ft. */
export const DUAL_LOCK_ROLL_FT = 6;
/** Polysulfide used per bedding, oz of a 10 oz cartridge. */
export const SEALANT_OZ_PER_USE = 1;
/** Contact-cement uses one pint can covers. */
export const CEMENT_USES_PER_CAN = 8;
/** Edge-banding waste (trimming, corners) and the roll length (ft). */
export const BANDING_WASTE = 0.15;
export const BANDING_ROLL_FT = 25;

/**
 * The note table. Each entry cites the text it comes from; quantities come from the model (parts present, their sizes), never from the text.
 * Items that live in a JOINT's text (hinge machine screws, handlebow rods, rail-to-chine screws, button plugs, nylon washers) are expanded in `jointItems` instead.
 */
export const NOTE_ITEMS: NoteItem[] = [
  {
    key: 'wheel-retention', section: 'fasteners', partIds: wheelIds, noteRef: 'wheel notes (D-60): "collar + cotter pin on the axle end"; axle notes: 0.156" cross hole',
    expand(built) {
      const wheels = byIds(built, wheelIds).filter((x) => /collar/i.test(x.notes ?? ''));
      if (!wheels.length) return null;
      const axle = built.find((x) => axleIds.includes(x.id) && x.stock);
      const od = axle?.stock?.t ?? 0.75;
      const hole = Number(/(\d*\.\d+)"\s*cross hole/.exec(axle?.notes ?? '')?.[1] ?? 0.156);
      const cotter = [...COTTER_DIAS].reverse().find(([v]) => v <= hole + 1e-3) ?? COTTER_DIAS[0];
      return {
        items: [
          { label: `316 stainless set-screw shaft collar, ${fracIn(od)}" bore`, qty: wheels.length },
          { label: `316 cotter pin ${cotter[1]}" x ${fracIn(roundUpStock(od + 0.75))}"`, qty: wheels.length },
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
    expand(built, joints) {
      // Only when the model has no screw joint of its own on the block (then the joint list already carries them).
      const blocks = byIds(built, ['seat-wedge-L', 'seat-wedge-R']).filter((x) => /screwed from below/i.test(ptext(x)) && !joints.some((q) => q.part.id === x.id && q.joint.type === 'screw'));
      const deck = thicknessIn(built.find((x) => x.id === 'deck'));
      if (!blocks.length || !deck) return null;
      return { items: [{ label: `316 flat-head wood screw #8 x ${fracIn(roundUpStock(deck + SCREW_BITE_IN))}"`, qty: 2 * blocks.length }], note: `2 per stop block, up through the ${fracIn(deck)}" deck into the block` };
    },
  },
  {
    key: 'lid-batten-screws', section: 'fasteners', partIds: ['storage-lid-batten-1', 'storage-lid-batten-2', 'storage-lid-batten-3'], noteRef: 'batten glue joint note: "epoxy + 4 stainless screws from the top"',
    expand(built) {
      const lid = built.find((x) => x.id === 'storage-lid');
      let n = 0, t = 0;
      for (const b of built.filter((x) => /^storage-lid-batten-/.test(x.id))) {
        const j = (b.joints ?? []).find((q) => q.to === 'storage-lid' && /(\d+)\s+stainless screws/i.test(`${q.size ?? ''} ${q.note ?? ''}`));
        if (!j) continue;
        n += j.count * Number(/(\d+)\s+stainless screws/i.exec(`${j.size ?? ''} ${j.note ?? ''}`)![1]);
        t = thicknessIn(b);
      }
      if (!n || !lid) return null;
      // From the lid top, countersunk and filled: through the panel and not out of the batten (1/16 in short of the batten's far face).
      return { items: [{ label: `316 flat-head wood screw #6 x ${fracIn(roundDownStock(thicknessIn(lid) + t - 1 / 16))}"`, qty: n }], note: `${n} screws through the ${fracIn(thicknessIn(lid))}" lid panel into the ${fracIn(t)}" battens` };
    },
  },
  {
    key: 'dual-lock', section: 'consumables', touch: 'seat', price: NOTE_PRICE.dualLock, partIds: ['seat-cushion', 'seat-back-pad'], noteRef: 'seat cushion and seat back pad notes: "on Dual Lock strips"',
    expand(built) {
      const pads = byIds(built, ['seat-cushion', 'seat-back-pad']).filter((x) => /dual lock/i.test(ptext(x)));
      if (!pads.length) return null;
      const ft = pads.length * DUAL_LOCK_FT_PER_PART;
      return { items: [{ label: `Dual Lock reclosable fastener, 1" x ${DUAL_LOCK_ROLL_FT} ft roll`, qty: Math.ceil(ft / DUAL_LOCK_ROLL_FT) }], note: `${ft} ft of 1" strip for ${pads.map((x) => x.id).join(' and ')}, both halves of each pair` };
    },
  },
  {
    key: 'edge-banding', section: 'consumables', price: NOTE_PRICE.edgeBanding, partIds: ['seat-back-panel', 'sign-L', 'sign-R'], noteRef: 'seat-back-panel note: "1/16 in oak veneer banding all round"; sign notes: "all four edges banded with oak"',
    expand(built) {
      const ply = byIds(built, ['seat-back-panel', 'sign-L', 'sign-R']).filter((x) => /banding|banded/i.test(x.notes ?? '') && x.stock);
      if (!ply.length) return null;
      const ft = (ply.reduce((a, x) => a + 2 * (x.stock!.w + x.stock!.l), 0) / 12) * (1 + BANDING_WASTE);
      return { items: [{ label: 'Oak veneer edge banding, 3/4" wide, 25 ft roll', qty: Math.max(1, Math.ceil(ft / BANDING_ROLL_FT)) }], note: `${r2(ft)} ft of edge (perimeter of ${ply.map((x) => x.id).join(', ')}, +${Math.round(BANDING_WASTE * 100)}%)` };
    },
  },
  {
    key: 'sealant', section: 'consumables', price: NOTE_PRICE.sealant, partIds: ['seat-grip-backing-L', 'seat-grip-backing-R', 'handle-socket-L', 'handle-socket-R', 'storage-gasket-side-L'],
    noteRef: 'grab-board backing joint note: "epoxy or polysulfide sealant"; handle-socket note: "bedded in epoxy / sealant"; gasket note: "continuous strip, spliced at a corner"',
    expand(built) {
      const uses = byIds(built, ['seat-grip-backing-L', 'seat-grip-backing-R', 'handle-socket-L', 'handle-socket-R']).filter((x) => /sealant|polysulfide/i.test(ptext(x)));
      const gasket = built.some((x) => x.id === 'storage-gasket-side-L' && /spliced/i.test(x.notes ?? ''));
      const oz = uses.length * SEALANT_OZ_PER_USE + (gasket ? SEALANT_OZ_PER_USE / 2 : 0);
      if (!oz) return null;
      return { items: [{ label: 'Polysulfide marine sealant, 10 oz cartridge', qty: Math.ceil(oz / 10) }], note: `${r2(oz)} oz: beds for ${uses.map((x) => x.id).join(', ')}${gasket ? ' and the lid gasket splice' : ''}` };
    },
  },
  {
    key: 'contact-cement', section: 'consumables', price: NOTE_PRICE.contactCement, partIds: ['brake-foot-tread-L', 'brake-foot-tread-R', 'brake-pad-L', 'brake-pad-R'],
    noteRef: 'brake tread and pad notes and joints: "contact cement over the full face"',
    expand(built) {
      const uses = byIds(built, ['brake-foot-tread-L', 'brake-foot-tread-R', 'brake-pad-L', 'brake-pad-R']).filter((x) => /contact cement/i.test(ptext(x)));
      if (!uses.length) return null;
      return { items: [{ label: 'Contact cement, pint', qty: Math.ceil(uses.length / CEMENT_USES_PER_CAN) }], note: `${uses.length} glued faces: ${uses.map((x) => x.id).join(', ')}` };
    },
  },
];

// ── BOM ───────────────────────────────────────────────────────────────────────

export function bom(parts: Part[], p: Params): Bom {
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
        (t.layersIn ? ` The face-laminated parts (D-70: ${oak.laminated.map((q) => `${q.partNo} ${q.lamination.text}`).filter((v, i, a) => a.indexOf(v) === i).join('; ')}) take their layers from the stocked boards, so no 12/4 is bought.` : ''),
    });
  });

  // Plywood
  const plywood: BomLine[] = [];
  for (const mm of [...new Set(nest.sheets.map((s) => s.thicknessMm))]) {
    const sheets = nest.sheets.filter((s) => s.thicknessMm === mm);
    const label = `${mm} mm`;
    const price = PLYWOOD_PRICE[label];
    if (!price) { unpriced.push(`plywood ${label}`); continue; }
    plywood.push(line('Plywood', label, `Marine okoume plywood (BS 1088), ${label}, 4 x 8 ft`, sheets.length, price, {
      vendor: price.source.split(/[,(]/)[0].trim(), // the shop itself (Aircraft Spruce, The Wood Yard): the full source and link are on the price
      notes: `${sheets.map((s) => `sheet ${s.index}: ${s.placements.length} parts, ${s.utilizationPct.toFixed(0)}% used`).join('; ')}`,
    }));
  }

  // Metal stock
  const metalGroups = new Map<string, { section: string; ft: number; cuts: string[] }>();
  for (const r of cl.metal) {
    const g = metalGroups.get(r.section) ?? { section: r.section, ft: 0, cuts: [] };
    g.ft += (r.qty * (r.cutLengthIn + METAL_CUT_ALLOWANCE_IN)) / 12;
    g.cuts.push(`${r.qty} x ${Math.round(r.cutLengthIn * 100) / 100}" (${r.partNo})`);
    metalGroups.set(r.section, g);
  }
  const metal: BomLine[] = [];
  for (const g of metalGroups.values()) {
    const price = metalPrice(g.section);
    if (!price) { unpriced.push(g.section); continue; }
    const extra = { vendor: price.url ? price.source : 'McMaster-Carr class', notes: `Cut to length: ${g.cuts.join(', ')}; ${METAL_CUT_ALLOWANCE_IN}" per cut for the kerf and squaring` };
    // A researched bar or tube is bought as the fixed piece the vendor sells (packQty in ft); an estimate is per foot of cut length.
    if (price.packQty && price.packUsd) metal.push(packLine('Metal stock', g.section, g.section, r2(g.ft), price, extra, false));
    else metal.push(line('Metal stock', g.section, g.section, r2(g.ft), price, { ...extra, notes: joinNotes(price.note && `Price: ${price.note}.`, extra.notes) }));
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
    const entry = purchasedEntry(key);
    let price: Price;
    let priceNote: string | undefined;
    if (cost !== undefined && !entry?.override) {
      // The model's own cost wins (a quote Eric or the model gave); the research can add a note and spec-gap alternatives to it.
      const mc = modelCostNote(key);
      price = { usd: cost, unit: 'ea', source: 'part.sourcing.costUsd (model)', basis: 'quoted', ...(mc?.alternatives ? { alternatives: mc.alternatives } : {}) };
      priceNote = mc ? (mc.note.includes(RESEARCH_DATE) ? mc.note : `${mc.note} (${RESEARCH_DATE} research)`) : undefined;
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
      ...(hardwareMaterialNote(x) ? { materialNote: hardwareMaterialNote(x) } : {}),
    };
    // A part cut from a roll or a pack (a cord): the whole packs to buy, not a price per part.
    if (price.packQty && price.packUsd && price.perPart) purchased.push(packLine('Purchased parts', key, x.name, group.length * price.perPart, price, extra, false));
    else (tg ? touchLines : purchased).push(line(tg ? TOUCHES_SECTION.title : 'Purchased parts', key, x.name, group.length, price, extra));
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
    for (const it of jointItems(part, joint, byId)) {
      noteOn(it.label, [part.id, joint.to]);
      if (tg) { const k = `${tg}|${it.label}`; const prev = touchFast.get(k); touchFast.set(k, { label: it.label, group: tg, qty: (prev?.qty ?? 0) + it.qty }); }
      else fast.set(it.label, (fast.get(it.label) ?? 0) + it.qty);
    }
  }
  const noteLines: BomLine[] = [];
  for (const item of NOTE_ITEMS) {
    const x = item.expand(built, uj);
    if (!x) continue;
    if (item.section === 'fasteners') for (const f of x.items) { fast.set(f.label, (fast.get(f.label) ?? 0) + f.qty); noteOn(f.label, item.partIds); }
    else if (item.touch) touchLines.push(line(TOUCHES_SECTION.title, item.key, x.items[0].label, x.items[0].qty, item.price!, { vendor: item.price!.source, notes: joinNotes(item.price!.url ? `Price: ${item.price!.note}.` : undefined, `${x.note} (${item.noteRef})`), group: item.touch }));
    else noteLines.push(line('Consumables', item.key, x.items[0].label, x.items[0].qty, item.price!, { vendor: item.price!.source, notes: joinNotes(item.price!.url ? `Price: ${item.price!.note}.` : undefined, `${x.note} (${item.noteRef})`) }));
  }
  const familyOrder = (l: string): number => (/^Domino/.test(l) ? 7 : /insert/i.test(l) ? 4 : /bolt|cap screw/.test(l) ? 1 : /nut/.test(l) ? 2 : /washer/.test(l) ? 3 : /Thumb/.test(l) ? 4 : /collar|cotter|plug|rod/.test(l) ? 6 : 0);
  const bulkLines: BomLine[] = [];
  /** One fastener line: pack-priced when the build needs under half a pack (bulk section, or the touches section for a touches fastener), else priced per piece in place. */
  const fastenerLine = (label: string, qty: number, group?: TouchGroup): BomLine => {
    const price = fastenerPrice(label);
    if (price.note?.startsWith('UNPRICED')) unpriced.push(label);
    const description = /^Domino/.test(label) ? `${label}, Sipo (sapele) exterior Domino, not beech` : label;
    const extra: Partial<BomLine> = { vendor: price.url ? price.source : /^Domino/.test(label) ? 'Festool dealer' : 'McMaster-Carr / Fastenal', materialNote: fastenerMaterialNote(label, [...(fastOn.get(label) ?? [])]), ...(group ? { group } : {}) };
    const sectionTitle = group ? TOUCHES_SECTION.title : 'Fasteners';
    if (isBulkQty(price, qty)) return packLine(group ? sectionTitle : BULK_SECTION.title, label, description, qty, price, extra);
    // Sold in packs and the build needs half a pack or more: still whole packs (the real purchase), in place.
    if (price.packQty && price.packUsd) return packLine(sectionTitle, label, description, qty, price, extra, false);
    return line(sectionTitle, label, description, qty, price, { ...extra, ...(price.note ? { notes: price.note } : {}) });
  };
  const fastenerLines: BomLine[] = [...fast.entries()].sort((a, b) => familyOrder(a[0]) - familyOrder(b[0]) || a[0].localeCompare(b[0])).map(([label, qty]) => fastenerLine(label, qty));
  const fasteners: BomLine[] = fastenerLines.filter((l) => l.section === 'Fasteners');
  bulkLines.push(...fastenerLines.filter((l) => l.section !== 'Fasteners'));
  const touchFasteners: BomLine[] = [];
  for (const { label, group, qty } of [...touchFast.values()].sort((a, b) => familyOrder(a.label) - familyOrder(b.label) || a.label.localeCompare(b.label))) {
    touchFasteners.push(fastenerLine(label, qty, group));
  }
  touchLines.push(...touchFasteners);
  const unresolved = [...fastenerLines, ...touchFasteners].map((l) => l.key).filter((k) => /per joint note/.test(k) || (/^316 .*\b(screw|bolt)\b/i.test(k) && !/screw eye|set-screw|insert/i.test(k) && !/ x \d+(?:-\d+\/\d+|\/\d+)?"| x \d+ mm/.test(k)));

  // Consumables. The coats' epoxy, the closes, the hardeners, the pumps and the finish products are the finishing schedule's buy list (so the BOM and the schedule agree);
  // the glue joints add their own epoxy (finishing.ts `glueEpoxyFlOz`, 5:1 with the kit's 206).
  const sched = finishingSchedule(parts, p);
  const sealedFt2 = sched.areas.okoumeFt2, plyFt2 = sched.areas.okoumeFt2, oakFt2 = sched.areas.oakFt2;
  const glueJoints = jointCounts.glue;
  const epoxyStep = sched.steps.find((x) => x.id === 'epoxy');
  const finishEpoxyFlOz = (epoxyStep?.products ?? []).reduce((a, q) => a + q.qtNeeded, 0) * FLOZ_PER_QT;
  const closeEpoxyFlOz = sched.closeEpoxyFlOz ?? 0;
  const glueEpoxyTotal = glueEpoxyFlOz(parts) * (1 + EPOXY_WASTE);
  const epoxyFlOz = finishEpoxyFlOz + closeEpoxyFlOz + glueEpoxyTotal;
  const resinFlOz = glueEpoxyTotal * RESIN_SHARE_GLUE + (finishEpoxyFlOz + closeEpoxyFlOz) * RESIN_SHARE_COAT;

  // The cheapest combination of resin kits that covers the resin (a gallon group is cheaper per ounce than quart groups, and three quarts can cost more than one gallon).
  const [quart, gallon] = [EPOXY_KITS[0], EPOXY_KITS[1]];
  let best: { q: number; g: number; usd: number } | null = null;
  for (let g = 0; g <= Math.ceil(resinFlOz / gallon.resinFlOz); g++) {
    const left = resinFlOz - g * gallon.resinFlOz;
    const q = left <= 0 ? 0 : Math.ceil(left / quart.resinFlOz);
    const usd = g * gallon.price.usd + q * quart.price.usd;
    if (!best || usd < best.usd - 1e-9 || (Math.abs(usd - best.usd) < 1e-9 && g + q < best.g + best.q)) best = { q, g, usd };
  }
  const consumables: BomLine[] = [];
  const buyText = sched.buy.filter((x) => /West System/.test(x.item)).map((x) => `${x.qty} ${x.unit} ${x.item.replace('West System ', '')}`).join(', ');
  const epoxyNote = `${r2(resinFlOz)} fl oz resin: ${r2(glueEpoxyTotal)} fl oz mixed for the glue joints (estimated by joint type, +${Math.round(EPOXY_WASTE * 100)}% waste, 5:1 with the kit's 206), ${r2(finishEpoxyFlOz)} fl oz for the one seal coat (the transom and bulkhead closes are glue joints, in the first figure; the schedule's buy list: ${buyText}). Cheapest kit combination that covers it.`;
  if (best!.g) consumables.push(line('Consumables', 'epoxy-gallon', gallon.label, best!.g, gallon.price, { vendor: gallon.price.source, notes: joinNotes(`Price: ${gallon.price.note}.`, epoxyNote) }));
  if (best!.q) consumables.push(line('Consumables', 'epoxy-quart', quart.label, best!.q, quart.price, { vendor: quart.price.source, notes: joinNotes(`Price: ${quart.price.note}.`, best!.g ? undefined : epoxyNote) }));
  // Hardeners: 205/206 come in the resin kits (the schedule uses 206 only, so its buy list names none). 207 and 209 are not bought (their sizes are 0.66 pt and 0.33 gal, not the pint
  // the BOM once priced): a schedule that asks for one is flagged unpriced rather than priced at a size that does not exist.
  for (const hb of sched.buy.filter((x) => /West System/.test(x.item) && /hardener/i.test(x.item))) if (/\b20[79]\b/.test(hb.item)) unpriced.push(hb.item);
  // Pumps: West System no longer sells the 301 and 303 sets; the 300 Mini Pump Set (resin, 205/206 and 207/209 pumps) does both ratios, one set for the sled.
  consumables.push(line('Consumables', 'epoxy-pumps', 'West System 300 Mini Pump Set (three pumps: resin and both hardener ratios; one set does both)', 1, EPOXY_PUMPS_300, { vendor: EPOXY_PUMPS_300.source, notes: `Price: ${EPOXY_PUMPS_300.note}.` }));
  consumables.push(line('Consumables', 'silica', 'Colloidal silica filler (thickened glue, fillets)', 1, FILLERS.silica, { vendor: FILLERS.silica.source, notes: `Price: ${FILLERS.silica.note}.` }));
  consumables.push(line('Consumables', 'microballoons', 'Low-density fairing filler', 1, FILLERS.microballoons, { vendor: FILLERS.microballoons.source, notes: `Price: ${FILLERS.microballoons.note}.` }));
  const tapeFt = Math.ceil(tapeJoints * TAPE_FT_PER_JOINT * (1 + TAPE_WASTE));
  if (tapeFt > 0) {
    const tapeExtra = { vendor: GLASS_TAPE.source, notes: `${tapeJoints} taped joints x ${TAPE_FT_PER_JOINT} ft, +${Math.round(TAPE_WASTE * 100)}%` };
    // Sold in 10 ft rolls: whole rolls either way (shop stock when the build needs under half a roll).
    if (isBulkQty(GLASS_TAPE, tapeFt)) bulkLines.push(packLine(BULK_SECTION.title, 'glass-tape', 'Fiberglass tape, 2" wide', tapeFt, GLASS_TAPE, tapeExtra));
    else consumables.push(packLine('Consumables', 'glass-tape', 'Fiberglass tape, 2" wide', tapeFt, GLASS_TAPE, tapeExtra, false));
  }
  consumables.push(...noteLines);
  // The finish products, container by container, exactly as the schedule's buy list names them.
  const finishKey = (item: string): { key: string; table: string; price: Price } | null => {
    if (/West System/.test(item)) return null;
    if (/conditioner/i.test(item)) return { key: 'conditioner', table: 'conditioner', price: FINISH_PRICE.conditioner };
    if (/gel stain/i.test(item)) return { key: 'gel-stain', table: 'gelStain', price: FINISH_PRICE.gelStain };
    if (/stain or dye/i.test(item)) return { key: 'stain', table: 'stain', price: FINISH_PRICE.stain };
    if (/thinner/i.test(item)) return { key: 'thinner', table: 'thinner', price: FINISH_PRICE.thinner };
    if (/varnish/i.test(item)) return { key: 'varnish', table: 'varnish', price: FINISH_PRICE.varnish };
    if (/enamel|pigment/i.test(item)) return { key: 'enamel', table: 'enamel', price: FINISH_PRICE.enamel };
    return null;
  };
  for (const bl of sched.buy) {
    const k = finishKey(bl.item);
    if (!k) { if (!/West System/.test(bl.item)) unpriced.push(bl.item); continue; }
    // The real container price where the research found one, else the base per-quart price scaled by the container size.
    const price: Price = FINISH_CONTAINER_PRICE[k.table]?.[bl.unit] ?? { ...k.price, usd: money(k.price.usd * FINISH_CONTAINER_FACTOR[bl.unit]), unit: bl.unit };
    consumables.push(line('Consumables', `${k.key}-${bl.unit}`, `${bl.item}, ${bl.unit}`, bl.qty, price, { vendor: price.source, notes: joinNotes(price.url ? `Price: ${price.note}.` : undefined, bl.note) }));
  }
  if (BULK_ALWAYS.has('sandpaper')) bulkLines.push(packLine(BULK_SECTION.title, 'sandpaper', 'Sandpaper, lump sum', 1, FINISH_PRICE.sandpaper, { vendor: FINISH_PRICE.sandpaper.source }));
  else consumables.push(line('Consumables', 'sandpaper', 'Sandpaper, lump sum', 1, FINISH_PRICE.sandpaper, { vendor: FINISH_PRICE.sandpaper.source }));
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
      `The ${built.filter((x) => partKey(x) === 'doubler-lash').length} oak lash doublers (doubler-lash) are cut from the oak boards and priced in Lumber; the lash plates' screws are listed here.`,
    ],
  });
  const core: BomSection[] = [
    section('lumber', 'Lumber', lumber),
    section('plywood', 'Plywood', plywood),
    section('metal', 'Metal stock', metal),
    section('purchased', 'Purchased parts', purchased),
    section('fasteners', 'Fasteners', fasteners, { notes: [FASTENER_MATERIAL_NOTE] }),
    section('consumables', 'Consumables', consumables),
  ];
  const bulk = section(BULK_SECTION.id, BULK_SECTION.title, bulkLines, {
    notes: [
      'Sold in packs much larger than the sled needs, so each line is priced by the whole pack. You may already have these in the shop; keep the rest for the next project. Packs and prices are from the 2026-10-12 price research where a line shows a vendor link; the rest are estimates. Material requirements per line are in the Material column; the reason is in the Fasteners note.',
    ],
  });
  const sections: BomSection[] = [...core, bulk, touches];
  const coreUsd = money(core.reduce((a, s) => a + s.subtotalUsd, 0));
  const coreEstimateUsd = money(core.reduce((a, s) => a + s.estimateUsd, 0));
  const bulkUsd = bulk.subtotalUsd, bulkEstimateUsd = bulk.estimateUsd;
  const touchesUsd = touches.subtotalUsd, touchesEstimateUsd = touches.estimateUsd;
  const totalUsd = money(coreUsd + bulkUsd + touchesUsd);
  const estimateUsd = money(coreEstimateUsd + bulkEstimateUsd + touchesEstimateUsd);
  const totalsText = totalsLine(coreUsd, bulkUsd, touchesUsd, totalUsd);

  // Lines that need a decision from Eric (the Domino 4x20, the wheel spec, the shaft collars, the eye bolts...), in the order of the sections.
  const decisions = [...new Set(sections.flatMap((x) => x.lines).filter((l) => l.decision).map((l) => l.key))];
  const altText = (l: BomLine): string | undefined => l.alternatives?.map((a) => `${a.specGap ? 'SPEC GAP: ' : ''}${a.source} ${a.packUsd ?? a.usd.toFixed(2)}${a.packQty ? ` per ${a.packLabel ?? `pack of ${a.packQty}`}` : `/${a.unit}`}${a.url ? ` ${a.url}` : ''}`).join(' | ');
  const rows: CsvCell[][] = [['Section', 'Item', 'Description', 'Qty', 'Unit', 'Unit USD', 'Ext USD', 'Basis', 'Vendor', 'Notes', 'URL', 'Group', 'Needed', 'Pack size', 'Packs to buy', 'Pack USD', 'Material', 'Alternatives', 'Decision']];
  for (const s of sections) {
    for (const l of s.lines) rows.push([s.title, l.key, l.description, l.qty, l.unit, l.unitUsd.toFixed(2), l.extUsd.toFixed(2), l.basis, l.vendor, l.notes, l.url, l.group ? TOUCH_GROUPS.find((g) => g.id === l.group)!.title : undefined, l.needed, l.packQty, l.packs, l.packUsd?.toFixed(2), l.materialNote, altText(l), l.decision]);
    for (const g of s.groups ?? []) rows.push([s.title, '', `Subtotal: ${g.title}`, '', '', '', g.subtotalUsd.toFixed(2), '', '', `${g.estimateUsd.toFixed(2)} of it estimated`, '', g.title]);
    rows.push([s.title, '', 'Subtotal', '', '', '', s.subtotalUsd.toFixed(2), '', '', `${s.estimateUsd.toFixed(2)} of it estimated${s.notes?.length ? `. ${s.notes.join(' ')}` : ''}`]);
  }
  const share = (e: number, t: number): number => (t ? e / t : 0);
  rows.push(['Total', '', 'Build (core sections)', '', '', '', coreUsd.toFixed(2), '', '', `${(100 * share(coreEstimateUsd, coreUsd)).toFixed(0)}% estimates`]);
  rows.push(['Total', '', 'Bulk parts (shop stock)', '', '', '', bulkUsd.toFixed(2), '', '', `${(100 * share(bulkEstimateUsd, bulkUsd)).toFixed(0)}% estimates`]);
  rows.push(['Total', '', 'Finishing touches', '', '', '', touchesUsd.toFixed(2), '', '', `${(100 * share(touchesEstimateUsd, touchesUsd)).toFixed(0)}% estimates`]);
  rows.push(['Total', '', 'Grand total', '', '', '', totalUsd.toFixed(2), '', '', `${totalsText}; ${(100 * share(estimateUsd, totalUsd)).toFixed(0)}% estimates`]);

  return {
    sections, totalUsd, estimateUsd, estimateShare: share(estimateUsd, totalUsd), coreUsd, bulkUsd, touchesUsd, coreEstimateUsd, bulkEstimateUsd, touchesEstimateUsd,
    coreEstimateShare: share(coreEstimateUsd, coreUsd), bulkEstimateShare: share(bulkEstimateUsd, bulkUsd), touchesEstimateShare: share(touchesEstimateUsd, touchesUsd), totalsText, jointCounts, unpriced: [...new Set(unpriced)], decisions,
    consumables: { epoxyFlOz, finishEpoxyFlOz, closeEpoxyFlOz, glueEpoxyFlOz: glueEpoxyTotal, resinFlOz, sealedFt2, oakFt2, plyFt2, glueJoints, tapeFt }, unresolved, wholeBoardsExtraUsd: 0, lumberAllowanceUsd: money(lumberAllowanceUsd), lumberAltUsd: money(lumberAltUsd), csv: toCsv(rows),
  };
}

