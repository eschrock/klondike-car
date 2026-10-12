/**
 * Bill of materials with costs (Phase 4). Plain TS, no three.js; a pure function of (parts, params).
 *
 * Sections: Lumber (the suggested WHOLE oak boards by thickness, from `nesting.ts`: a yard sells boards, not net board feet), Plywood (sheets, from the nest), Metal stock
 * (cut-to-length feet), Purchased parts (by partNo), Fasteners (expanded from the joint list), Consumables (epoxy, fillers, tape, finish, sandpaper). The epoxy and the finish
 * products come from `finishingSchedule` (its buy list, so the BOM and the schedule agree) plus the epoxy for the glue joints.
 * Prices come from `prices.ts`; a number the model carries (`sourcing.costUsd`) is `quoted`, every table price is an `estimate`.
 *
 * Fasteners mirror `fastenerBreakdown` (src/model/lighting.ts): a joint listed on both of its parts counts once, a joint to a part that is
 * not in the configuration is skipped, and the `hardware` mass allowance is replaced by the expanded list. Unlike the mass allowance, the
 * bolts of the axle clamps and hold-downs are listed (their plates are parts, their bolts are not), and only the shank-itemized bolts
 * (steering eye bolts, kingpin) are left out of the bolt lines.
 */
import { localBounds } from '../model/bounds';
import type { Joint, Part } from '../model/types';
import type { Params } from '../params';
import { cutList, fracIn, isBuilt, partKey, toCsv, type CsvCell } from './cutlist';
import { finishingSchedule, glueEpoxyFlOz } from './finishing';
import { nestPlywood, oakBoardFeet } from './nesting';
import {
  EPOXY_HARDENER_PINT, EPOXY_KITS, EPOXY_PUMP_SET, FILLERS, FINISH_CONTAINER_FACTOR, FINISH_PRICE, GLASS_TAPE, METAL_CUT_ALLOWANCE_IN, NOTE_PRICE, OAK_PRICE_PER_BF, PLYWOOD_PRICE,
  fastenerPrice, metalPrice, purchasedPrice, type Price, type PriceBasis,
} from './prices';

// ── Consumable assumptions (all estimates; also in docs/phase4-data-notes.md) ─
/** Mixing, pot and brush waste on top of the glue epoxy of `glueEpoxyFlOz` (finishing.ts: per-joint-type estimates, before waste). The coats' quantities carry their own waste. */
export const EPOXY_WASTE = 0.2;
/** Resin share of the mixed volume: 5:1 for the glue (105 with 205/206), 3:1 for the coats and the closes (105 with 207/209). */
const RESIN_SHARE_GLUE = 5 / 6;
const RESIN_SHARE_COAT = 3 / 4;
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
}

export interface BomSection {
  id: 'lumber' | 'plywood' | 'metal' | 'purchased' | 'fasteners' | 'consumables';
  title: string;
  lines: BomLine[];
  subtotalUsd: number;
  /** The part of the subtotal that is an estimate. */
  estimateUsd: number;
}

export interface FastenerJointCounts { screw: number; bolt: number; 'threaded-insert': number; knob: number; domino: number; glue: number }

export interface Bom {
  sections: BomSection[];
  totalUsd: number;
  estimateUsd: number;
  /** estimateUsd / totalUsd. */
  estimateShare: number;
  /** Joint counts the fastener lines were expanded from (equal to `fastenerBreakdown`'s counts). */
  jointCounts: FastenerJointCounts;
  /** Parts or fasteners with no price in prices.ts (empty at the defaults). */
  unpriced: string[];
  /**
   * `epoxyFlOz` = mixed epoxy the purchase covers: `finishEpoxyFlOz` (the schedule's two seal coats, 3:1) + `closeEpoxyFlOz` (the transom and bulkhead closes, 209, 3:1) + `glueEpoxyFlOz` (the glue joints
   * from `glueEpoxyFlOz()` in finishing.ts plus `EPOXY_WASTE`, 5:1). `resinFlOz` is the resin of that mix. `sealedFt2` is the okoume surface of the schedule.
   */
  consumables: {
    epoxyFlOz: number; finishEpoxyFlOz: number; closeEpoxyFlOz: number; glueEpoxyFlOz: number; resinFlOz: number;
    sealedFt2: number; oakFt2: number; plyFt2: number; glueJoints: number; tapeFt: number;
  };
  /** Fastener lines (screws and bolts) that carry no length: empty when every line is orderable. */
  unresolved: string[];
  /** The lumber section prices the suggested whole boards now, so there is no extra to add: always 0 (kept for older readers of this field). */
  wholeBoardsExtraUsd: number;
  /** What the old pricing (net board feet plus the waste allowance) would have cost, for comparison with the lumber subtotal. */
  lumberAllowanceUsd: number;
  csv: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const money = (v: number): number => Math.round(v * 100) / 100;
const r2 = (v: number): number => Math.round(v * 100) / 100;

function line(section: string, key: string, description: string, qty: number, price: Price, extra: Partial<BomLine> = {}): BomLine {
  return { section, key, description, qty, unit: price.unit, unitUsd: price.usd, extUsd: money(qty * price.usd), basis: price.basis, ...extra };
}
function section(id: BomSection['id'], title: string, lines: BomLine[]): BomSection {
  return {
    id, title, lines,
    subtotalUsd: money(lines.reduce((a, l) => a + l.extUsd, 0)),
    estimateUsd: money(lines.filter((l) => l.basis === 'estimate').reduce((a, l) => a + l.extUsd, 0)),
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
    key: 'dual-lock', section: 'consumables', price: NOTE_PRICE.dualLock, partIds: ['seat-cushion', 'seat-back-pad'], noteRef: 'seat cushion and seat back pad notes: "on Dual Lock strips"',
    expand(built) {
      const pads = byIds(built, ['seat-cushion', 'seat-back-pad']).filter((x) => /dual lock/i.test(ptext(x)));
      if (!pads.length) return null;
      const ft = pads.length * DUAL_LOCK_FT_PER_PART;
      return { items: [{ label: 'Dual Lock reclosable fastener, 1" x 5 ft roll', qty: Math.ceil(ft / 5) }], note: `${ft} ft of 1" strip for ${pads.map((x) => x.id).join(' and ')}, both halves of each pair` };
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
  let lumberAllowanceUsd = 0;
  const lumber: BomLine[] = oak.thicknesses.map((t) => {
    const price = OAK_PRICE_PER_BF[t.board];
    lumberAllowanceUsd += t.allowanceBf * price.usd;
    return line('Lumber', t.board, `White oak ${t.board}, rough, whole boards`, r2(t.purchaseBf), price, {
      notes: `Buy: ${t.summary.join('; ')}. ${r2(t.netBf)} bf net on nominal thickness (${r2(t.allowanceBf)} bf with the ${Math.round(oak.wasteAllowance * 100)}% waste allowance); the boards come to ${r2(t.plannedBf)} bf.`,
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
      vendor: 'Local plywood supplier',
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
    metal.push(line('Metal stock', g.section, g.section, r2(g.ft), price, { vendor: 'McMaster-Carr class', notes: `Cut to length: ${g.cuts.join(', ')}; ${METAL_CUT_ALLOWANCE_IN}" per cut for the kerf and squaring` }));
  }

  // Purchased parts (and printed clips), by partNo
  const purchasedMap = new Map<string, Part[]>();
  for (const x of built.filter((q) => q.kind === 'purchased' || q.kind === 'printed')) {
    const arr = purchasedMap.get(partKey(x)) ?? [];
    arr.push(x);
    purchasedMap.set(partKey(x), arr);
  }
  const purchased: BomLine[] = [];
  for (const [key, group] of purchasedMap) {
    const x = group[0];
    const cost = x.sourcing?.costUsd;
    let price: Price;
    if (cost !== undefined) price = { usd: cost, unit: 'ea', source: 'part.sourcing.costUsd (model)', basis: 'quoted' };
    else { price = purchasedPrice(key); if (price.note?.startsWith('UNPRICED')) unpriced.push(key); }
    const vendorFull = x.sourcing?.vendor ?? '';
    purchased.push(line('Purchased parts', key, x.name, group.length, price, {
      vendor: shortVendor(x.sourcing?.vendor, x.kind),
      notes: clip([vendorFull, price.note && cost === undefined ? `Price: ${price.note}` : ''].filter(Boolean).join(' | '), 320),
      partIds: group.map((q) => q.id),
    }));
  }

  // Fasteners: every unique joint, then the items that exist only in notes (NOTE_ITEMS)
  const byId: PartMap = new Map(built.map((x) => [x.id, x]));
  const jointCounts: FastenerJointCounts = { screw: 0, bolt: 0, 'threaded-insert': 0, knob: 0, domino: 0, glue: 0 };
  const fast = new Map<string, number>();
  const uj = uniqueJoints(parts);
  let tapeJoints = 0;
  for (const { part, joint } of uj) {
    if (joint.type in jointCounts && !(joint.type === 'bolt' && /see the bushing/.test(joint.size ?? ''))) jointCounts[joint.type as keyof FastenerJointCounts] += joint.count;
    if (joint.type === 'glue' && /tape/i.test(`${joint.size ?? ''} ${joint.note ?? ''}`)) tapeJoints += joint.count;
    for (const it of jointItems(part, joint, byId)) fast.set(it.label, (fast.get(it.label) ?? 0) + it.qty);
  }
  const noteLines: BomLine[] = [];
  for (const item of NOTE_ITEMS) {
    const x = item.expand(built, uj);
    if (!x) continue;
    if (item.section === 'fasteners') for (const f of x.items) fast.set(f.label, (fast.get(f.label) ?? 0) + f.qty);
    else noteLines.push(line('Consumables', item.key, x.items[0].label, x.items[0].qty, item.price!, { vendor: item.price!.source, notes: `${x.note} (${item.noteRef})` }));
  }
  const familyOrder = (l: string): number => (/^Domino/.test(l) ? 7 : /insert/i.test(l) ? 4 : /bolt|cap screw/.test(l) ? 1 : /nut/.test(l) ? 2 : /washer/.test(l) ? 3 : /Thumb/.test(l) ? 4 : /collar|cotter|plug|rod/.test(l) ? 6 : 0);
  const fasteners: BomLine[] = [...fast.entries()].sort((a, b) => familyOrder(a[0]) - familyOrder(b[0]) || a[0].localeCompare(b[0])).map(([label, qty]) => {
    const price = fastenerPrice(label);
    if (price.note?.startsWith('UNPRICED')) unpriced.push(label);
    return line('Fasteners', label, label, qty, price, { vendor: /^Domino/.test(label) ? 'Festool dealer' : 'McMaster-Carr / Fastenal' });
  });
  const unresolved = fasteners.map((l) => l.key).filter((k) => /per joint note/.test(k) || (/^316 .*\b(screw|bolt)\b/i.test(k) && !/screw eye|set-screw|insert/i.test(k) && !/ x \d+(?:-\d+\/\d+|\/\d+)?"| x \d+ mm/.test(k)));

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
  const epoxyNote = `${r2(resinFlOz)} fl oz resin: ${r2(glueEpoxyTotal)} fl oz mixed for the glue joints (finishing.ts estimate by joint type, +${Math.round(EPOXY_WASTE * 100)}% waste, 5:1 with the kit's 206), ${r2(finishEpoxyFlOz)} fl oz for the two seal coats and ${r2(closeEpoxyFlOz)} fl oz for the transom and bulkhead closes (3:1; the schedule's buy list: ${buyText}). Cheapest kit combination that covers it.`;
  if (best!.g) consumables.push(line('Consumables', 'epoxy-gallon', gallon.label, best!.g, gallon.price, { vendor: gallon.price.source, notes: epoxyNote }));
  if (best!.q) consumables.push(line('Consumables', 'epoxy-quart', quart.label, best!.q, quart.price, { vendor: quart.price.source, notes: best!.g ? undefined : epoxyNote }));
  // Hardeners of the buy list, by West System number (207 for the coats, 209 for the slow closes); the 205/206 for the glue comes in the resin kits.
  const hardenerLines = sched.buy.filter((x) => /West System/.test(x.item) && /hardener/i.test(x.item));
  for (const hb of hardenerLines) {
    const no = /\b(20[5679])\b/.exec(hb.item)?.[1];
    const price = no ? EPOXY_HARDENER_PINT[no] : undefined;
    if (!no || !price) { unpriced.push(hb.item); continue; }
    const pints = hb.qt * 2;
    const key = `epoxy-${no}`;
    const prev = consumables.find((l) => l.key === key);
    if (prev) { prev.qty += pints; prev.extUsd = money(prev.qty * prev.unitUsd); continue; }
    consumables.push(line('Consumables', key, `West System ${no} ${no === '209' ? 'extra slow' : no === '207' ? 'special clear' : no === '205' ? 'fast' : 'slow'} hardener`, pints, price, { vendor: price.source, notes: `The schedule's buy list: ${hardenerLines.filter((q) => q.item === hb.item).map((q) => `${q.qty} ${q.unit}`).join(' + ')}. 3:1 with the kit's 105 resin.` }));
  }
  // Pumps: the schedule's counted supplies (303 for the 3:1 hardeners); a 301 set meters the 5:1 glue epoxy. Fall back to one of each when the schedule names none.
  const pumpLines = (sched.supplies ?? []).filter((x) => /pump/i.test(x.item));
  for (const sp of pumpLines) {
    const no = /\b(30[0-9])\b/.exec(sp.item)?.[1] ?? '303';
    const price = EPOXY_PUMP_SET[no];
    if (!price) { unpriced.push(sp.item); continue; }
    consumables.push(line('Consumables', `epoxy-pumps-${no}`, sp.item, sp.qty, price, { vendor: price.source, notes: sp.note }));
  }
  if (!pumpLines.some((x) => /301/.test(x.item))) consumables.push(line('Consumables', 'epoxy-pumps-301', 'West System 301 pump set (5:1, for the glue epoxy)', 1, EPOXY_PUMP_SET['301'], { vendor: EPOXY_PUMP_SET['301'].source }));
  if (!pumpLines.some((x) => /303/.test(x.item)) && hardenerLines.length) consumables.push(line('Consumables', 'epoxy-pumps-303', 'West System 303 pump set (3:1, for 207/209)', 1, EPOXY_PUMP_SET['303'], { vendor: EPOXY_PUMP_SET['303'].source }));
  consumables.push(line('Consumables', 'silica', 'Colloidal silica filler (thickened glue, fillets)', 1, FILLERS.silica, { vendor: FILLERS.silica.source }));
  consumables.push(line('Consumables', 'microballoons', 'Low-density fairing filler', 1, FILLERS.microballoons, { vendor: FILLERS.microballoons.source }));
  const tapeFt = Math.ceil(tapeJoints * TAPE_FT_PER_JOINT * (1 + TAPE_WASTE));
  if (tapeFt > 0) consumables.push(line('Consumables', 'glass-tape', 'Fiberglass tape, 2" wide', tapeFt, GLASS_TAPE, { vendor: GLASS_TAPE.source, notes: `${tapeJoints} taped joints x ${TAPE_FT_PER_JOINT} ft, +${Math.round(TAPE_WASTE * 100)}%` }));
  consumables.push(...noteLines);
  // The finish products, container by container, exactly as the schedule's buy list names them.
  const finishKey = (item: string): { key: string; price: Price } | null => {
    if (/West System/.test(item)) return null;
    if (/conditioner/i.test(item)) return { key: 'conditioner', price: FINISH_PRICE.conditioner };
    if (/gel stain/i.test(item)) return { key: 'gel-stain', price: FINISH_PRICE.gelStain };
    if (/stain or dye/i.test(item)) return { key: 'stain', price: FINISH_PRICE.stain };
    if (/thinner/i.test(item)) return { key: 'thinner', price: FINISH_PRICE.thinner };
    if (/varnish/i.test(item)) return { key: 'varnish', price: FINISH_PRICE.varnish };
    if (/enamel|pigment/i.test(item)) return { key: 'enamel', price: FINISH_PRICE.enamel };
    return null;
  };
  for (const bl of sched.buy) {
    const k = finishKey(bl.item);
    if (!k) { if (!/West System/.test(bl.item)) unpriced.push(bl.item); continue; }
    const price: Price = { ...k.price, usd: money(k.price.usd * FINISH_CONTAINER_FACTOR[bl.unit]), unit: bl.unit };
    consumables.push(line('Consumables', `${k.key}-${bl.unit}`, `${bl.item}, ${bl.unit}`, bl.qty, price, { vendor: k.price.source, notes: bl.note }));
  }
  consumables.push(line('Consumables', 'sandpaper', 'Sandpaper, lump sum', 1, FINISH_PRICE.sandpaper, { vendor: FINISH_PRICE.sandpaper.source }));
  consumables.push(line('Consumables', 'supplies', 'Brushes, rollers, cups, gloves, solvent', 1, FINISH_PRICE.supplies, { vendor: FINISH_PRICE.supplies.source }));

  const sections: BomSection[] = [
    section('lumber', 'Lumber', lumber),
    section('plywood', 'Plywood', plywood),
    section('metal', 'Metal stock', metal),
    section('purchased', 'Purchased parts', purchased),
    section('fasteners', 'Fasteners', fasteners),
    section('consumables', 'Consumables', consumables),
  ];
  const totalUsd = money(sections.reduce((a, s) => a + s.subtotalUsd, 0));
  const estimateUsd = money(sections.reduce((a, s) => a + s.estimateUsd, 0));

  const rows: CsvCell[][] = [['Section', 'Item', 'Description', 'Qty', 'Unit', 'Unit USD', 'Ext USD', 'Basis', 'Vendor', 'Notes']];
  for (const s of sections) {
    for (const l of s.lines) rows.push([s.title, l.key, l.description, l.qty, l.unit, l.unitUsd.toFixed(2), l.extUsd.toFixed(2), l.basis, l.vendor, l.notes]);
    rows.push([s.title, '', 'Subtotal', '', '', '', s.subtotalUsd.toFixed(2), '', '', `${s.estimateUsd.toFixed(2)} of it estimated`]);
  }
  rows.push(['Total', '', 'Grand total', '', '', '', totalUsd.toFixed(2), '', '', `${(100 * (totalUsd ? estimateUsd / totalUsd : 0)).toFixed(0)}% estimates`]);

  return {
    sections, totalUsd, estimateUsd, estimateShare: totalUsd ? estimateUsd / totalUsd : 0, jointCounts, unpriced: [...new Set(unpriced)],
    consumables: { epoxyFlOz, finishEpoxyFlOz, closeEpoxyFlOz, glueEpoxyFlOz: glueEpoxyTotal, resinFlOz, sealedFt2, oakFt2, plyFt2, glueJoints, tapeFt }, unresolved, wholeBoardsExtraUsd: 0, lumberAllowanceUsd: money(lumberAllowanceUsd), csv: toCsv(rows),
  };
}

