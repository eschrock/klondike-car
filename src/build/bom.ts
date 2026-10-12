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
import type { Joint, Part } from '../model/types';
import type { Params } from '../params';
import { cutList, fracIn, isBuilt, partKey, toCsv, type CsvCell } from './cutlist';
import { finishingSchedule } from './finishing';
import { nestPlywood, oakBoardFeet } from './nesting';
import {
  EPOXY_207_PINT, EPOXY_KITS, EPOXY_PUMPS, FILLERS, FINISH_CONTAINER_FACTOR, FINISH_PRICE, GLASS_TAPE, METAL_CUT_ALLOWANCE_IN, OAK_PRICE_PER_BF, PLYWOOD_PRICE,
  fastenerPrice, metalPrice, purchasedPrice, type Price, type PriceBasis,
} from './prices';

// ── Consumable assumptions (all estimates; also in docs/phase4-data-notes.md) ─
/** Mixed epoxy per glued joint (thickened glue, fillet, squeeze-out), fl oz. The seal coats and the finish come from `finishingSchedule`. */
export const EPOXY_FLOZ_PER_GLUE_JOINT = 0.12;
/** Mixing, pot and brush waste on top of the glue epoxy (the schedule's own quantities carry their waste). */
export const EPOXY_WASTE = 0.2;
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
  /** `epoxyFlOz` = mixed epoxy bought for (`finishEpoxyFlOz`: the schedule's two seal coats) + (`glueEpoxyFlOz`: the glue joints). `sealedFt2` is the okoume surface of the schedule. */
  consumables: { epoxyFlOz: number; finishEpoxyFlOz: number; glueEpoxyFlOz: number; sealedFt2: number; oakFt2: number; plyFt2: number; glueJoints: number; tapeFt: number };
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

export interface FastenerItem { label: string; qty: number }

/** Items one joint needs. Bolts bring a nut and washers; a bolt whose shank is a separate part (eye bolt, kingpin) brings only what is not in that part. */
export function jointItems(part: Part, j: Joint): FastenerItem[] {
  const size = j.size ?? '';
  const n = j.count;
  switch (j.type) {
    case 'domino': {
      const m = /(\d+)\s*[×x]\s*(\d+)/.exec(size);
      const dim = m ? `${m[1]}x${m[2]}` : '(size per joint note)';
      return [{ label: /DF\s*500/.test(size) ? `Domino DF 500 ${dim}` : `Domino ${dim}`, qty: n }];
    }
    case 'threaded-insert': {
      const m = /M(\d)\b/.exec(size);
      if (/heat-set/i.test(size) && m) return [{ label: `Heat-set insert M${m[1]}`, qty: n }];
      const t = new RegExp(String.raw`#(\d+)-(\d+)\s*[x×]\s*${LEN}`).exec(size);
      return [{ label: t ? `316 threaded insert #${t[1]}-${t[2]} x ${lenText(t[3])}"` : '316 threaded insert (size per joint note)', qty: n }];
    }
    case 'knob': {
      const t = new RegExp(String.raw`#(\d+)-(\d+)\s*[x×]\s*${LEN}`).exec(size);
      return [{ label: t ? `Thumb-knob screw #${t[1]}-${t[2]} x ${lenText(t[3])}"` : 'Thumb-knob screw (size per joint note)', qty: n }];
    }
    case 'screw': return [{ label: screwLabel(size), qty: n }];
    case 'bolt': return boltItems(part, j);
    default: return [];
  }
}

function screwLabel(size: string): string {
  if (/screw eye/i.test(size)) { const g = /#(\d+)/.exec(size); return `316 screw eye ${g ? '#' + g[1] : '(size per joint note)'}`; }
  const ins = new RegExp(String.raw`#(\d+)-(\d+)\s*[x×]\s*${LEN}`).exec(size);
  if (/insert/i.test(size) && ins) return `316 threaded insert #${ins[1]}-${ins[2]} x ${lenText(ins[3])}"`;
  const metric = /\bM(\d)\b(?:\s*[x×]\s*(\d+))?/.exec(size);
  if (metric) return `316 screw M${metric[1]}${metric[2] ? ` x ${metric[2]} mm` : ''}`;
  if (ins) return `316 machine screw #${ins[1]}-${ins[2]} x ${lenText(ins[3])}"`;
  const w = new RegExp(String.raw`#(\d+)\s*[x×]\s*${LEN}`).exec(size);
  if (w) return `316 wood screw #${w[1]} x ${lenText(w[2])}"`;
  const g = /#(\d+)/.exec(size);
  return g ? `316 wood screw #${g[1]} (length per joint note)` : '316 screw (size per joint note)';
}

function boltItems(part: Part, j: Joint): FastenerItem[] {
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
  const nut: FastenerItem = { label: `316 nylon-insert lock nut ${t}`, qty: n };
  const washer = (k: number): FastenerItem => ({ label: `316 fender washer ${d}"`, qty: k * n });
  if (/eye bolt/i.test(size) || /eye bolt/i.test(part.name)) return [nut, washer(1)]; // the eye bolt itself is the steer-eye / steer-anchor part
  if (/kingpin/i.test(size)) return []; // the kingpin part includes its washers and nut
  if (/tapped/.test(size)) return [{ label: `316 machine screw ${t}${len ? ` x ${len}"` : ''} (tapped)`, qty: n }];
  const type = /button-head/.test(size) ? 'button-head cap screw' : /carriage/.test(size) ? 'carriage bolt' : 'hex bolt';
  const label = `316 ${type} ${t}${len ? ` x ${len}"` : ' (length per joint note)'}`;
  return [{ label, qty: n }, nut, washer(type === 'carriage bolt' ? 1 : 2)];
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

  // Fasteners
  const jointCounts: FastenerJointCounts = { screw: 0, bolt: 0, 'threaded-insert': 0, knob: 0, domino: 0, glue: 0 };
  const fast = new Map<string, number>();
  const uj = uniqueJoints(parts);
  let tapeJoints = 0;
  for (const { part, joint } of uj) {
    if (joint.type in jointCounts && !(joint.type === 'bolt' && /see the bushing/.test(joint.size ?? ''))) jointCounts[joint.type as keyof FastenerJointCounts] += joint.count;
    if (joint.type === 'glue' && /tape/i.test(`${joint.size ?? ''} ${joint.note ?? ''}`)) tapeJoints += joint.count;
    for (const it of jointItems(part, joint)) fast.set(it.label, (fast.get(it.label) ?? 0) + it.qty);
  }
  const familyOrder = (l: string): number => (/^Domino/.test(l) ? 5 : /insert/i.test(l) ? 4 : /bolt|cap screw/.test(l) ? 1 : /nut/.test(l) ? 2 : /washer/.test(l) ? 3 : /Thumb/.test(l) ? 4 : 0);
  const fasteners: BomLine[] = [...fast.entries()].sort((a, b) => familyOrder(a[0]) - familyOrder(b[0]) || a[0].localeCompare(b[0])).map(([label, qty]) => {
    const price = fastenerPrice(label);
    if (price.note?.startsWith('UNPRICED')) unpriced.push(label);
    return line('Fasteners', label, label, qty, price, { vendor: /^Domino/.test(label) ? 'Festool dealer' : 'McMaster-Carr / Fastenal' });
  });

  // Consumables. The epoxy and the finish products are the finishing schedule's buy list (so the BOM and the schedule agree); the glue joints add their own epoxy.
  const sched = finishingSchedule(parts, p);
  const sealedFt2 = sched.areas.okoumeFt2, plyFt2 = sched.areas.okoumeFt2, oakFt2 = sched.areas.oakFt2;
  const glueJoints = jointCounts.glue;
  const epoxyStep = sched.steps.find((x) => x.id === 'epoxy');
  const finishEpoxyFlOz = (epoxyStep?.products ?? []).reduce((a, q) => a + q.qtNeeded, 0) * FLOZ_PER_QT;
  const glueEpoxyFlOz = glueJoints * EPOXY_FLOZ_PER_GLUE_JOINT * (1 + EPOXY_WASTE);
  const epoxyFlOz = finishEpoxyFlOz + glueEpoxyFlOz;

  // The cheapest combination of kits that covers the epoxy (a gallon group is cheaper per ounce than quart groups, and three quarts can cost more than one gallon).
  const [quart, gallon] = [EPOXY_KITS[0], EPOXY_KITS[1]];
  let best: { q: number; g: number; usd: number } | null = null;
  for (let g = 0; g <= Math.ceil(epoxyFlOz / gallon.mixedFlOz); g++) {
    const left = epoxyFlOz - g * gallon.mixedFlOz;
    const q = left <= 0 ? 0 : Math.ceil(left / quart.mixedFlOz);
    const usd = g * gallon.price.usd + q * quart.price.usd;
    if (!best || usd < best.usd - 1e-9 || (Math.abs(usd - best.usd) < 1e-9 && g + q < best.g + best.q)) best = { q, g, usd };
  }
  const consumables: BomLine[] = [];
  const buyText = sched.buy.filter((x) => /West System/.test(x.item)).map((x) => `${x.qty} ${x.unit} ${x.item.replace('West System ', '')}`).join(', ');
  const epoxyNote = `${r2(epoxyFlOz)} fl oz mixed: ${r2(finishEpoxyFlOz)} fl oz for the finishing schedule's two seal coats (its buy list: ${buyText}) + ${r2(glueEpoxyFlOz)} fl oz for ${glueJoints} glue joints x ${EPOXY_FLOZ_PER_GLUE_JOINT} fl oz, +${Math.round(EPOXY_WASTE * 100)}% waste. Cheapest kit combination that covers it.`;
  if (best!.g) consumables.push(line('Consumables', 'epoxy-gallon', gallon.label, best!.g, gallon.price, { vendor: gallon.price.source, notes: epoxyNote }));
  if (best!.q) consumables.push(line('Consumables', 'epoxy-quart', quart.label, best!.q, quart.price, { vendor: quart.price.source, notes: best!.g ? undefined : epoxyNote }));
  if (best!.g) consumables.push(line('Consumables', 'epoxy-pumps', 'Epoxy metering pumps', 1, EPOXY_PUMPS, { vendor: EPOXY_PUMPS.source }));
  const hardener207 = sched.buy.filter((x) => /207/.test(x.item));
  const h207Pt = hardener207.reduce((a, x) => a + x.qt * 2, 0);
  if (h207Pt > 0) consumables.push(line('Consumables', 'epoxy-207', 'West System 207 special clear hardener (finish coats)', h207Pt, EPOXY_207_PINT, { vendor: EPOXY_207_PINT.source, notes: `The schedule's buy list: ${hardener207.map((x) => `${x.qty} ${x.unit}`).join(' + ')}. Mix it with the kit's 105 resin for the two finish coats; the kit's 206 covers the glue-ups.` }));
  consumables.push(line('Consumables', 'silica', 'Colloidal silica filler (thickened glue, fillets)', 1, FILLERS.silica, { vendor: FILLERS.silica.source }));
  consumables.push(line('Consumables', 'microballoons', 'Low-density fairing filler', 1, FILLERS.microballoons, { vendor: FILLERS.microballoons.source }));
  const tapeFt = Math.ceil(tapeJoints * TAPE_FT_PER_JOINT * (1 + TAPE_WASTE));
  if (tapeFt > 0) consumables.push(line('Consumables', 'glass-tape', 'Fiberglass tape, 2" wide', tapeFt, GLASS_TAPE, { vendor: GLASS_TAPE.source, notes: `${tapeJoints} taped joints x ${TAPE_FT_PER_JOINT} ft, +${Math.round(TAPE_WASTE * 100)}%` }));
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
    consumables: { epoxyFlOz, finishEpoxyFlOz, glueEpoxyFlOz, sealedFt2, oakFt2, plyFt2, glueJoints, tapeFt }, wholeBoardsExtraUsd: 0, lumberAllowanceUsd: money(lumberAllowanceUsd), csv: toCsv(rows),
  };
}

