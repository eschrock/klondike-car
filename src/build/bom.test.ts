import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { fastenerBreakdown } from '../model/lighting';
import { defaultParams } from '../params';
import { BULK_SHARE, EPOXY_WASTE, NOTE_ITEMS, TOUCH_GROUPS, fastenerMaterialNote, isBulkQty, touchGroupOfPart, THROUGH_STACKS, bom, boltLengthFromStack, jointItems, screwLengthFromStack, shortVendor, uniqueJoints } from './bom';
import { PRE_D72 } from '../test-fixtures';
import { cutList, isBuilt } from './cutlist';
import { finishingSchedule, glueEpoxyFlOz } from './finishing';
import { oakBoardFeet } from './nesting';
import { EPOXY_KITS, EPOXY_PUMPS_300, FASTENER_PRICE, FILLERS, FINISH_CONTAINER_PRICE, FINISH_PRICE, GLASS_TAPE, METAL_PRICE_PER_FT, NOTE_PRICE, OAK_ALT_PRICE_PER_BF, OAK_PRICE_PER_BF, PLYWOOD_PRICE, PURCHASED_PRICE, RESEARCH_DATE, SEARCH_READ_NOTE, type Price } from './prices';

// D-72/D-73: this file's counts and prices are the 4 mm okoume / 4×20 Domino / DOM tube configuration (PRE_D72); the BOM for the white oak plywood and the solid rod follows the weather spec (bom.ts).
const p = { ...defaultParams(), ...PRE_D72, weatherSpec: 1 }; // the EXTREME weather spec (316, Sipo, epoxy everywhere, marine varnish); the Standard spec is tested in weather-spec.test.ts
const parts = buildModel(p);
const b = bom(parts, p);
const cl = cutList(parts, p);
const secLines = (id: string) => b.sections.find((s) => s.id === id)!.lines;
/** Pieces a line stands for: the quantity needed of a pack-priced line, else its quantity. */
const need = (l: { qty: number; needed?: number }): number => l.needed ?? l.qty;
/** Every fastener line wherever it is priced: in place, in the bulk section (by the pack) or in the finishing touches. */
const allFasteners = () => [...secLines('fasteners'), ...secLines('bulk'), ...secLines('touches')];

describe('bom', () => {
  it('totals to a finite positive number, section by section', () => {
    expect(Number.isFinite(b.totalUsd)).toBe(true);
    expect(b.totalUsd).toBeGreaterThan(500);
    expect(b.sections.map((s) => s.id)).toEqual(['lumber', 'plywood', 'metal', 'purchased', 'fasteners', 'consumables', 'bulk', 'touches']);
    expect(b.sections.reduce((a, s) => a + s.subtotalUsd, 0)).toBeCloseTo(b.totalUsd, 1);
    for (const s of b.sections) {
      expect(s.lines.length, s.id).toBeGreaterThan(0);
      expect(s.lines.reduce((a, l) => a + l.extUsd, 0)).toBeCloseTo(s.subtotalUsd, 1);
      for (const l of s.lines) {
        expect(Number.isFinite(l.extUsd), l.key).toBe(true);
        expect(l.extUsd, l.key).toBeCloseTo(l.qty * l.unitUsd, 1);
        expect(l.qty, l.key).toBeGreaterThan(0);
      }
    }
    expect(b.estimateShare).toBeGreaterThan(0);
    expect(b.estimateShare).toBeLessThanOrEqual(1);
    expect(b.unpriced).toEqual([]);
  });

  it('puts every built part in exactly one cut-list or BOM line (the fastener allowance is expanded instead)', () => {
    const where = new Map<string, number>();
    const hit = (id: string) => where.set(id, (where.get(id) ?? 0) + 1);
    cl.oak.forEach((g) => g.rows.forEach((r) => r.ids.forEach(hit)));
    cl.sheets.forEach((g) => g.rows.forEach((r) => r.ids.forEach(hit)));
    cl.metal.forEach((r) => r.ids.forEach(hit));
    // purchased parts are priced in their own section, or in the finishing touches (lights, cushions, reflectors, lash points)
    [...secLines('purchased'), ...secLines('touches')].forEach((l) => l.partIds?.forEach(hit));
    // the side ribs, knees and box ties are oak: they are in the cut list (Lumber), not in the touches
    const built = parts.filter(isBuilt);
    expect(built.length).toBeGreaterThan(150);
    for (const x of built) expect(where.get(x.id), x.id).toBe(1);
    expect(where.has('hardware')).toBe(false);
    expect(where.size).toBe(built.length);
  });

  it('expands fasteners from the joints: counts equal the model breakdown', () => {
    const fb = fastenerBreakdown(parts);
    const n = (k: string): number => fb[k]?.count ?? 0;
    expect(b.jointCounts.screw).toBe(n('screws'));
    expect(b.jointCounts.bolt).toBe(n('bolt sets') + n('machine screw sets') + n('bolts tapped into steel') + n('nuts and washers (itemized bolts)'));
    expect(b.jointCounts['threaded-insert']).toBe(n('inserts'));
    expect(b.jointCounts.knob).toBe(n('thumb knobs'));
    expect(b.jointCounts.domino).toBe(n('Dominos'));
    expect(b.jointCounts.glue).toBe(n('epoxy joints'));
    const lines = allFasteners();
    const sum = (re: RegExp) => lines.filter((l) => re.test(l.key)).reduce((a, l) => a + need(l), 0);
    expect(sum(/^Domino/)).toBe(b.jointCounts.domino);
    // every bolt brings a nut, except the kingpin (nut is in the part)
    expect(sum(/lock nut/) + sum(/T-nut/)).toBeGreaterThanOrEqual(b.jointCounts.bolt - 1); // every bolt gets a lock nut, or a T-nut set in its backer (the handle sockets)
    expect(lines.some((l) => /Domino DF 500 4x20/.test(l.key))).toBe(true);
    expect(lines.some((l) => /Domino DF 500 5x30/.test(l.key))).toBe(true);
  });

  it('marks model costs quoted and table prices estimated', () => {
    const purchased = [...secLines('purchased'), ...secLines('touches')];
    const cushion = purchased.find((l) => l.key === 'seat-cushion')!;
    expect(cushion.basis).toBe('quoted');
    expect(cushion.unitUsd).toBe(parts.find((x) => x.id === 'seat-cushion')!.sourcing!.costUsd);
    // The wheel is a researched, quoted price (Harbor Freight, 2026-10-12, D-71); the roll pads and the bridle sleeve were not found and keep their estimates
    expect(purchased.find((l) => l.key === 'wheel')!.basis).toBe('quoted');
    expect(purchased.find((l) => l.key === 'wheel')!.qty).toBe(4);
    expect(purchased.find((l) => l.key === 'roll-pad')!.basis).toBe('estimate');
    expect(purchased.find((l) => l.key === 'roll-pad')!.notes).toMatch(/not found in the 2026-10-12 research/);
    // Table prices carry their own basis: Eric's vendor quotes (the plywood, 4/4, 8/4, 12/4 oak) and the researched prices are quoted, the rest estimates
    expect(b.sections.find((x) => x.id === 'plywood')!.lines.every((l) => l.basis === 'quoted')).toBe(true);
    const metal = b.sections.find((x) => x.id === 'metal')!.lines;
    expect(metal.filter((l) => l.basis === 'estimate').map((l) => l.key).sort()).toEqual(['316 stainless flat bar 1/16" x 1"', '316 stainless flat bar 1/4" x 1-3/4"', '316 stainless flat bar 1/8" x 2"', '5/8" OD x 0.120" wall DOM tube (ASTM A513 Type 5)']); // no exact 316 bar found; the 1/8 x 2 brake backing-plate bar is not in the research (D-75); no price found for the 5/8 x 0.120 DOM (D-71: the Speedy 0.109 wall price is the stand-in)
    expect(metal.filter((l) => l.basis === 'quoted').length).toBe(3); // the rectangle tube, the angle and the 1/8" x 1" bar of the D-ring bearing plates
    for (const l of b.sections.find((x) => x.id === 'lumber')!.lines) expect(l.basis, l.key).toBe(OAK_PRICE_PER_BF[l.key].basis);
  });

  it('prices the two sheets where Eric found them (4 mm Aircraft Spruce, 12 mm The Wood Yard) and 4/4 to 8/4 oak, no 12/4 (D-70)', () => {
    const ply = b.sections.find((s) => s.id === 'plywood')!.lines;
    expect(ply.map((l) => l.qty)).toEqual([1, 1]);
    expect(ply.map((l) => l.vendor)).toEqual(['Aircraft Spruce', 'The Wood Yard']);
    const lumber = b.sections.find((s) => s.id === 'lumber')!.lines.map((l) => l.key);
    expect(lumber).toEqual(['4/4', '5/4', '6/4', '8/4']); // 12/4 is not stocked: the beams, knees and chocks are face-laminated from 4/4 (D-70)
  });

  it('prices the oak as the whole boards to buy (nesting.ts), not net x 1.3', () => {
    const oak = oakBoardFeet(parts, p);
    const lumber = b.sections.find((s) => s.id === 'lumber')!.lines;
    expect(lumber.map((l) => l.key)).toEqual(oak.thicknesses.map((t) => t.board));
    for (const t of oak.thicknesses) {
      const l = lumber.find((q) => q.key === t.board)!;
      expect(l.qty).toBeCloseTo(t.plannedBf, 2);
      expect(l.unitUsd).toBe(OAK_PRICE_PER_BF[t.board].usd);
      expect(l.notes!).toContain(t.summary[0]);
    }
    expect(lumber.reduce((a, l) => a + l.qty, 0)).toBeCloseTo(oak.thicknesses.reduce((a, t) => a + t.plannedBf, 0), 1);
    expect(b.lumberAllowanceUsd).toBeLessThan(b.sections.find((s) => s.id === 'lumber')!.subtotalUsd); // boards run higher than the allowance
    expect(b.wholeBoardsExtraUsd).toBe(0);
    // a solid bucket under 1 bf is cut from thicker offcuts (nesting.test.ts); the BOM line says so whenever it happens
    for (const c of oak.consolidated) expect(lumber.find((l) => new RegExp(`cut the ${c.from.replace('/', '\\/')} parts`).test(l.notes ?? '')), c.from).toBeTruthy();
  });

  it('takes the finish, the hardeners and the pumps from the finishing buy list, the glue epoxy from finishing.ts, and prices the cheapest resin kits', () => {
    const sched = finishingSchedule(parts, p);
    const cons = b.sections.find((s) => s.id === 'consumables')!.lines;
    // every finish product of the buy list is a BOM line with the same container and quantity
    for (const bl of sched.buy.filter((x) => !/West System/.test(x.item))) {
      const l = cons.find((q) => q.description === `${bl.item}, ${bl.unit}`);
      expect(l, bl.item).toBeTruthy();
      expect(l!.qty).toBe(bl.qty);
      expect(l!.unit).toBe(bl.unit);
    }
    // hardeners by West System number: the pints of the buy list (207 for the coats, 209 for the slow closes)
    const hardeners = sched.buy.filter((x) => /West System/.test(x.item) && /hardener/i.test(x.item));
    for (const no of new Set(hardeners.map((x) => /\b(20\d)\b/.exec(x.item)![1]))) {
      expect(cons.find((l) => l.key === `epoxy-${no}`)?.qty, no).toBe(hardeners.filter((x) => new RegExp(no).test(x.item)).reduce((a, x) => a + x.qt * 2, 0));
    }
    // pumps: West System no longer sells the 301 and 303 sets; one 300 Mini Pump Set does both ratios
    expect(cons.filter((l) => /pumps/.test(l.key)).map((l) => [l.key, l.qty, l.unitUsd])).toEqual([['epoxy-pumps', 1, EPOXY_PUMPS_300.usd]]);
    expect(cons.find((l) => l.key === 'epoxy-pumps')!.description).toMatch(/300 Mini Pump Set/);
    // the glue epoxy is finishing.ts's estimate by joint type plus the waste, and per joint it is well above the old 0.12 fl oz
    expect(b.consumables.glueEpoxyFlOz).toBeCloseTo(glueEpoxyFlOz(parts, undefined, p) * (1 + EPOXY_WASTE), 6); // with `p`: the Extreme spec counts every joint, and the D-70 face laminations
    expect(b.consumables.glueEpoxyFlOz / b.jointCounts.glue).toBeGreaterThan(0.25);
    expect(b.consumables.glueEpoxyFlOz).toBeGreaterThan(40); // the critic's 40-50 fl oz for the glue, fillets and fairing
    const finishFlOz = sched.steps.find((x) => x.id === 'epoxy')!.products.reduce((a, q) => a + q.qtNeeded, 0) * 32;
    expect(b.consumables.finishEpoxyFlOz).toBeCloseTo(finishFlOz, 6);
    expect(b.consumables.closeEpoxyFlOz).toBeCloseTo(sched.closeEpoxyFlOz, 6);
    // resin: 5/6 of everything (105/206 at 5:1); the kits cover it, and no cheaper combination does
    const need = (b.consumables.glueEpoxyFlOz * 5) / 6 + ((b.consumables.finishEpoxyFlOz + b.consumables.closeEpoxyFlOz) * 5) / 6;
    expect(b.consumables.resinFlOz).toBeCloseTo(need, 6);
    const [quart, gallon] = EPOXY_KITS;
    const nQ = cons.filter((l) => l.key === 'epoxy-quart').reduce((a, l) => a + l.qty, 0), nG = cons.filter((l) => l.key === 'epoxy-gallon').reduce((a, l) => a + l.qty, 0);
    expect(nQ * quart.resinFlOz + nG * gallon.resinFlOz).toBeGreaterThanOrEqual(need);
    const paid = nQ * quart.price.usd + nG * gallon.price.usd;
    for (let g = 0; g <= 4; g++) for (let q = 0; q <= 8; q++) if (q * quart.resinFlOz + g * gallon.resinFlOz >= need) expect(g * gallon.price.usd + q * quart.price.usd, `${g} gal + ${q} qt`).toBeGreaterThanOrEqual(paid - 1e-9);
    // a gallon group is cheaper per ounce of resin than the quart group, and than three quart groups
    expect(gallon.price.usd / gallon.resinFlOz).toBeLessThan(quart.price.usd / quart.resinFlOz);
    expect(gallon.price.usd).toBeLessThan(3 * quart.price.usd);
  });

  it('keeps vendor names short and writes a CSV with subtotals and a total', () => {
    const purchased = b.sections.find((s) => s.id === 'purchased')!.lines;
    for (const l of purchased) expect(l.vendor!.length, l.key).toBeLessThanOrEqual(60);
    expect(shortVendor('McMaster-Carr or equivalent: 10" wheel', 'purchased')).toBe('McMaster-Carr');
    expect(b.csv.split('\r\n')[0]).toBe('Section,Item,Description,Qty,Unit,Unit USD,Ext USD,Basis,Vendor,Notes,URL,Group,Needed,Pack size,Packs to buy,Pack USD,Material,Alternatives,Decision');
    expect(b.csv).toContain('Grand total');
    expect(b.csv).toContain(b.totalsText);
    // one subtotal row per section, one per touches group
    expect(b.csv.match(/,Subtotal,/g)!.length).toBe(8);
    expect(b.csv.match(/Subtotal: /g)!.length).toBe(4);
  });

  it('buys exactly the washers the joint names: a narrow flat washer under each knee bolt head, none under the nuts that bear on the backing plate', () => {
    const part = parts.find((x) => x.id === 'brake-knee-L')!;
    const knee = part.joints!.find((q) => q.type === 'bolt' && /narrow flat washer/.test(q.size ?? ''))!;
    const items = jointItems(part, knee, new Map(parts.map((x) => [x.id, x])));
    expect(items.map((i) => `${i.qty} ${i.label}`)).toEqual([`4 316 hex bolt 3/8-16 x 4"`, '4 316 nylon-insert lock nut 3/8-16', '4 316 narrow flat washer 3/8" (7/8" OD)']);
    // a bolt whose washers are all on the nut side gets one per bolt, not two
    const j2 = { type: 'bolt' as const, to: 'x', count: 2, size: '0.25" × 2-3/4 316 hex bolts down through the leg, nylock nuts and fender washers under the beam' };
    expect(jointItems(part, j2).map((i) => `${i.qty} ${i.label}`)).toContain('2 316 fender washer 1/4"');
    // a screw whose heads bear on a plate has no washer
    const j3 = { type: 'bolt' as const, to: 'x', count: 4, size: '#8-32 x 2" 316 machine screw, pan head on the outside bearing plate (no washer), nylock nut inside' };
    expect(jointItems(part, j3).some((i) => /washer/.test(i.label))).toBe(false);
  });

  it('classifies fastener size text', () => {
    const part = parts.find((x) => x.id === 'beam-R')!;
    const j = (type: any, size: string, count = 2) => ({ type, to: 'x', count, size });
    expect(jointItems(part, j('screw', '#10 × 1-1/4 stainless'))[0].label).toBe('316 wood screw #10 x 1-1/4"');
    expect(jointItems(part, j('screw', '#10-32 × 3/8 316 flat-head machine screws'))[0].label).toBe('316 machine screw #10-32 x 3/8"');
    expect(jointItems(part, j('bolt', '2 × 0.38" × 3-1/4 316 hex bolts')).map((i) => i.label)).toEqual([
      '316 hex bolt 3/8-16 x 3-1/4"', '316 nylon-insert lock nut 3/8-16', '316 fender washer 3/8"',
    ]);
    expect(jointItems(part, j('domino', '5×30 (DF 500)'))[0].label).toBe('Domino DF 500 5x30');
    expect(jointItems(part, j('bolt', '5/8" grade 8 kingpin through the beam'))).toEqual([]);
  });

  const fasteners = () => allFasteners();
  const consumables = () => b.sections.find((x) => x.id === 'consumables')!.lines;
  const qtyOf = (lines: typeof b.sections[number]['lines'], re: RegExp): number => lines.filter((l) => re.test(l.key)).reduce((a, l) => a + need(l), 0);

  it('lists what the steps and notes use (build MUST-10): axle retention, hinge screws, handlebow rods, rail screws, plugs, washers, Dual Lock, banding, sealant, cement, batten screws', () => {
    const wheels = parts.filter((x) => /^wheel-/.test(x.id)).length;
    expect(wheels).toBe(4);
    const f = fasteners(), c = [...consumables(), ...secLines('touches')]; // the Dual Lock belongs to the seat comfort touches
    expect(qtyOf(f, /shaft collar/)).toBe(wheels);
    expect(qtyOf(f, /cotter pin 5\/32" x 1-1\/2"/)).toBe(wheels); // the 0.156" cross hole takes a 5/32 pin
    expect(qtyOf(f, /end plug for 5\/8" OD/)).toBe(6); // three axle tubes, two ends each
    expect(qtyOf(f, /machine screw #10-32 x 3\/8"/)).toBe(6); // seat hinge leaves into the six inserts
    expect(qtyOf(f, /stainless rod 3\/8" x 2-1\/4"/)).toBe(2); // handlebow pins
    expect(qtyOf(f, /wood screw #6 x 3-1\/2"/)).toBe(0); // D-72: one rail-to-chine length now
    expect(qtyOf(f, /wood screw #6 x 2-1\/2"/)).toBe(18); // rail to chine, every zone: 4 aft (head counterbored 1 in up the 3 in rail) + 1 forward a side, #6 piloted (round 3: a #8 left 0.11 in a side of the edge); plus the 8 rib-knee screws (D-76: 2 per knee, 4 knees)
    expect(qtyOf(f, /Button plug 5\/8"/)).toBe(4);
    expect(qtyOf(f, /Nylon washer for 1\/4"/)).toBe(4);
    expect(qtyOf(f, /wood screw #6 x 1\/2"/)).toBe(0); // the lid battens use the standard #8 x 5/8 now (D-72: three wood-screw sizes, no fourth)
    expect(qtyOf(f, /wood screw #8 x 5\/8"/)).toBeGreaterThanOrEqual(12 + 6); // 12 batten screws (4 each, 3 battens) plus the hardware-into-thin-stock screws
    expect(qtyOf(c, /^dual-lock$/)).toBeGreaterThanOrEqual(1);
    expect(qtyOf(c, /^edge-banding$/)).toBeGreaterThanOrEqual(1);
    expect(qtyOf(c, /^sealant$/)).toBeGreaterThanOrEqual(1);
    expect(qtyOf(c, /^contact-cement$/)).toBeGreaterThanOrEqual(1);
    for (const l of c.filter((q) => ['dual-lock', 'edge-banding', 'sealant', 'contact-cement'].includes(q.key))) expect(l.notes, l.key).toBeTruthy(); // the note it came from is data (noteRef), not printed
    // the stop blocks' own screw joints carry their screws; the note table does not add them twice
    expect(parts.find((x) => x.id === 'seat-wedge-L')!.joints!.some((j) => j.type === 'screw')).toBe(true);
    expect(NOTE_ITEMS.find((i) => i.key === 'stop-block-screws')!.expand(parts, uniqueJoints(parts))).toBeNull();
  });

  it('cites parts that still exist for every item that lives only in a note', () => {
    const ids = new Set(parts.map((x) => x.id));
    for (const item of NOTE_ITEMS) {
      expect(item.partIds.length, item.key).toBeGreaterThan(0);
      for (const id of item.partIds) expect(ids.has(id), `${item.key} cites ${id}`).toBe(true);
      expect(item.noteRef.length, item.key).toBeGreaterThan(10);
    }
    for (const r of THROUGH_STACKS) for (const side of ['L', 'R']) for (const id of r.also(side)) expect(ids.has(id), id).toBe(true);
    // an item whose cited parts are all gone is dropped, not priced
    const bare = parts.filter((x) => !NOTE_ITEMS.some((i) => i.partIds.includes(x.id)));
    for (const item of NOTE_ITEMS) expect(item.expand(bare, uniqueJoints(bare)), item.key).toBeNull();
  });

  it('gives every screw and bolt line a length, drops the phantom thumb knobs and counts three thrust-disc screws', () => {
    expect(b.unresolved).toEqual([]);
    for (const l of fasteners()) expect(l.key, l.key).not.toMatch(/per joint note/);
    for (const l of fasteners().filter((q) => /^316 .*\b(screw|bolt)\b/.test(q.key) && !/screw eye|set-screw|insert/.test(q.key))) expect(l.key, l.key).toMatch(/ x \d+(?:-\d+\/\d+|\/\d+)?"| x \d+ mm/);
    // 8 thumb knobs (4 a sign); the brake snap hooks are purchased parts, not knob screws
    expect(qtyOf(fasteners(), /^Thumb-knob screw/)).toBe(8);
    expect(b.jointCounts.knob).toBe(8);
    expect(parts.find((x) => x.id === 'brake-snap-L')!.joints!.some((j) => j.type === 'knob')).toBe(false);
    // king beam to thrust disc: 3 screws
    const thrust = parts.find((x) => x.id === 'king-beam')!.joints!.find((j) => j.to === 'king-thrust')!;
    expect(thrust.count).toBe(3);
    expect(jointItems(parts.find((x) => x.id === 'king-beam')!, thrust)[0].qty).toBe(3);
  });

  it('computes a length from the part thicknesses when the joint text has none, rounded up to a stock length', () => {
    const byId = new Map(parts.map((x) => [x.id, x]));
    const strip = (id: string, to: string) => {
      const part = byId.get(id)!;
      const j = part.joints!.find((q) => q.to === to && (q.type === 'bolt' || q.type === 'screw'))!;
      return { part, j: { ...j, size: j.size!.replace(/\d+(?:-\d+\/\d+)?\s+316/, '316').replace(/(?:× |x )\d+(?:-\d+\/\d+)?(?= 316)/g, '').replace(/#(\d+) × [\d-/]+/, '#$1') } };
    };
    // grab board: board + inner band + web + outer band + 1/16 strip + washers and nut: the critic's 1-3/4 in
    const g = strip('seat-grip-L', 'side-L-gunwale-in');
    expect(boltLengthFromStack(g.part, g.j, byId)).toBe(1.75);
    expect(jointItems(g.part, { ...g.j, size: '0.25" 316 button-head cap screws, 3 columns' }, byId)[0].label).toBe('316 button-head cap screw 1/4-20 x 1-3/4"');
    // (the hanger bolts are the hold-down angle's upright bolts, recorded once with their length in the text: no stack fallback needed)
    // roll pad: 1/4 pad + 3/4 bite
    const rp = byId.get('beam-F')!, rj = rp.joints!.find((q) => q.to === 'roll-pad-L')!;
    expect(screwLengthFromStack(rp, rj, byId)).toBe(1);
    expect(jointItems(rp, { ...rj, size: '#10 316 flat-head screws up through the pad' }, byId)[0].label).toBe('316 wood screw #10 x 1"');
    // thrust disc: 1/2 UHMW + 3/4 bite
    const kb = byId.get('king-beam')!, kj = kb.joints!.find((q) => q.to === 'king-thrust')!;
    expect(screwLengthFromStack(kb, kj, byId)).toBe(1.25);
    // a part with no thickness gives no length rather than a wrong one
    expect(boltLengthFromStack(g.part, { ...g.j, to: 'no-such-part' }, byId)).toBe(0);
  });

  it('maps every finishing buy line and supply to a priced BOM line', () => {
    const sched = finishingSchedule(parts, p);
    const cons = consumables();
    expect(b.unpriced).toEqual([]);
    for (const bl of sched.buy) {
      if (/West System 105/.test(bl.item)) continue; // resin: bought as the kits
      const hard = /\b(20[5679])\b/.exec(bl.item)?.[1];
      const l = hard ? cons.find((q) => q.key === `epoxy-${hard}`) : cons.find((q) => q.description === `${bl.item}, ${bl.unit}`);
      expect(l, bl.item).toBeTruthy();
      expect(l!.unitUsd, bl.item).toBeGreaterThan(0);
    }
    // whichever hardeners the buy list names (not a fixed 207/209) are lines of the BOM
    for (const no of new Set(sched.buy.filter((x) => /West System/.test(x.item) && /hardener/i.test(x.item)).map((x) => /\b(20\d)\b/.exec(x.item)![1]))) expect(cons.find((q) => q.key === `epoxy-${no}`), no).toBeTruthy();
    for (const sp of sched.supplies) { const l = cons.find((q) => q.description === sp.item); expect(l, sp.item).toBeTruthy(); expect(l!.qty).toBe(sp.qty); expect(l!.unitUsd).toBeGreaterThan(0); }
  });

  it('reads T-nuts from the handle-socket joint text', () => {
    const sock = parts.find((x) => x.id === 'handle-socket-L')!;
    const j = { type: 'bolt' as const, to: 'transom-rear', count: 2, size: '1/4-20 × 2 316 button-head cap screws, nylon washer under the head, into 1/4-20 T-nuts set in the backer' };
    const labels = jointItems(sock, j).map((i) => i.label);
    expect(labels).toContain('316 T-nut 1/4-20');
    expect(labels.some((l) => /lock nut|fender/.test(l))).toBe(false);
  });
});

describe('finishing touches (Eric, 2026-10-12)', () => {
  const touches = secLines('touches');
  const groupIds = new Set(TOUCH_GROUPS.map((g) => g.id));

  it('puts the lights, seat comfort, reflectors and tie-downs in their own section, after the core ones', () => {
    expect(b.sections[b.sections.length - 1].id).toBe('touches');
    expect(b.sections[b.sections.length - 1].title).toBe('Finishing touches');
    const keys = touches.map((l) => l.key);
    for (const k of ['front-light', 'rear-light', 'lamp-clip', 'rear-lamp-clip', 'seat-cushion', 'seat-back-pad', 'dual-lock', 'reflector', 'lash-point']) expect(keys, k).toContain(k);
    expect(touches.find((l) => l.key === 'reflector')!.qty).toBe(4);
    expect(touches.find((l) => l.key === 'lash-point')!.qty).toBe(6);
    // the lamp-clip inserts and screws and the lash-plate screws follow their parts
    expect(touches.some((l) => /Heat-set insert M4/.test(l.key))).toBe(true);
    expect(touches.some((l) => /screw M3 x 8 mm/.test(l.key))).toBe(true);
    // D-76: the D-ring plates are through-bolted: 4 #8-32 x 2" machine screws and a nylock each, 24 sets, no wood screws; the heads bear on the outside bearing plate, so no washer is bought
    const tie = (re: RegExp) => touches.filter((l) => re.test(l.key) && l.group === 'tie-downs').reduce((a, l) => a + need(l), 0);
    expect(tie(/machine screw #8-32 x 2"/)).toBe(24);
    expect(tie(/fender washer #8/)).toBe(0);
    expect(tie(/lock nut #8-32/)).toBe(24);
    expect(touches.some((l) => /wood screw/.test(l.key) && l.group === 'tie-downs')).toBe(false);
    // the oak ribs, knees and box ties stay in Lumber (bandsawn from offcuts, in the cut list) and the section says so
    expect(touches.some((l) => /side-rib|rib knee|box-tie|doubler/i.test(l.key))).toBe(false);
    expect(b.sections.find((s) => s.id === 'touches')!.notes!.join(' ')).toMatch(/ribs.*Lumber/);
  });

  it('puts every touches line in exactly one of the four groups, and core + bulk + touches = total', () => {
    for (const l of touches) expect(groupIds.has(l.group!), l.key).toBe(true);
    const sec = b.sections.find((s) => s.id === 'touches')!;
    expect(sec.groups!.map((g) => g.id)).toEqual(['lights', 'seat', 'reflectors', 'tie-downs']);
    for (const g of sec.groups!) expect(g.subtotalUsd, g.id).toBeCloseTo(touches.filter((l) => l.group === g.id).reduce((a, l) => a + l.extUsd, 0), 1);
    expect(sec.groups!.reduce((a, g) => a + g.subtotalUsd, 0)).toBeCloseTo(sec.subtotalUsd, 1);
    expect(b.touchesUsd).toBeCloseTo(sec.subtotalUsd, 2);
    const core = b.sections.filter((s) => !['touches', 'bulk'].includes(s.id)).reduce((a, s) => a + s.subtotalUsd, 0);
    expect(b.coreUsd).toBeCloseTo(core, 2);
    expect(b.coreUsd + b.bulkUsd + b.touchesUsd).toBeCloseTo(b.totalUsd, 2);
    expect(b.coreEstimateUsd + b.bulkEstimateUsd + b.touchesEstimateUsd).toBeCloseTo(b.estimateUsd, 2);
    for (const sh of [b.coreEstimateShare, b.bulkEstimateShare, b.touchesEstimateShare]) { expect(sh).toBeGreaterThanOrEqual(0); expect(sh).toBeLessThanOrEqual(1); }
    expect(b.totalsText).toMatch(/^Build \$[\d,.]+ \+ bulk parts \$[\d,.]+ \+ finishing touches \$[\d,.]+ = \$[\d,.]+$/);
  });

  it('keeps every touches part out of the core purchased section', () => {
    const purchased = secLines('purchased');
    for (const l of purchased) expect(touchGroupOfPart(parts.find((x) => x.id === l.partIds![0])), l.key).toBeUndefined();
  });
});

describe('bulk parts (Eric, 2026-10-12)', () => {
  const bulk = secLines('bulk');

  it('prices pack-sold items by the pack, in their own section between the core sections and the touches', () => {
    expect(b.sections.map((s) => s.id).slice(-2)).toEqual(['bulk', 'touches']);
    expect(b.sections.find((s) => s.id === 'bulk')!.title).toBe('Bulk parts (shop stock)');
    expect(bulk.length).toBeGreaterThan(5); // fasteners Bolt Depot sells by the piece are priced per piece, in place, and so are not here
    for (const l of bulk) {
      expect(l.packQty, l.key).toBeGreaterThan(0);
      expect(l.packUsd, l.key).toBeGreaterThan(0);
      expect(l.needed, l.key).toBeGreaterThan(0);
      expect(l.packs, l.key).toBe(Math.ceil(l.needed! / l.packQty! - 1e-9));
      expect(l.qty, l.key).toBe(l.packs);
      expect(l.extUsd, l.key).toBeCloseTo(l.packs! * l.packUsd!, 2);
      expect(l.notes, l.key).toMatch(/already have these in the shop/);
      // the build needs under half a pack, or it is one of the lump-sum items
      expect(l.needed! < BULK_SHARE * l.packQty! || l.packQty === 1, l.key).toBe(true);
    }
    for (const k of [/Domino DF 500 5x30/, /machine screw/, /cotter pin/, /Button plug/, /^sandpaper$/]) expect(bulk.some((l) => k.test(l.key)), String(k)).toBe(true);
  });

  it('leaves bolts and one-at-a-time items where they are', () => {
    const fast = secLines('fasteners');
    expect(fast.some((l) => /hex bolt|carriage bolt|cap screw|shaft collar|Thumb-knob|screw eye|stainless rod/.test(l.key))).toBe(true);
    expect(bulk.some((l) => /hex bolt|carriage bolt|cap screw|shaft collar|Thumb-knob|screw eye|stainless rod/.test(l.key))).toBe(false);
    // a fastener that stays in place needs at least half a pack (and is then priced by whole packs), or has no pack
    for (const l of fast) {
      if (l.packQty === undefined) continue;
      expect(isBulkQty({ usd: l.packUsd! / l.packQty, unit: 'ea', source: '', basis: l.basis, packQty: l.packQty, packUsd: l.packUsd }, l.needed!), l.key).toBe(false);
      expect(l.qty, l.key).toBe(Math.ceil(l.needed! / l.packQty - 1e-9));
      expect(l.extUsd, l.key).toBeCloseTo(l.qty * l.packUsd!, 2);
    }
    // the T-nuts are sold singly now (no pack): they stay in place with the bolts
    expect(fast.some((l) => /T-nut/.test(l.key))).toBe(true);
  });

  it('prices the glass tape by the 10 ft roll: the 15 ft the sled needs is two rolls, in place (over half a roll)', () => {
    const tape = secLines('consumables').find((l) => l.key === 'glass-tape')!;
    expect(tape.packQty).toBe(10);
    expect(tape.needed).toBe(b.consumables.tapeFt);
    expect(tape.qty).toBe(Math.ceil(tape.needed! / 10));
    expect(tape.extUsd).toBeCloseTo(tape.qty * GLASS_TAPE.packUsd!, 2);
    expect(bulk.some((l) => l.key === 'glass-tape')).toBe(false);
  });

  it('uses the pack price: the line costs the packs, not the pieces', () => {
    for (const l of bulk.filter((q) => q.packQty !== 1)) expect(l.extUsd, l.key).toBeGreaterThan((l.needed! * l.unitUsd) / l.packQty! - 1e-9);
    expect(b.bulkUsd).toBeCloseTo(b.sections.find((s) => s.id === 'bulk')!.subtotalUsd, 2);
  });

  it('prices a fastener Bolt Depot sells by the piece per piece, in place, when that is no dearer than the bag (it leaves the bulk section)', () => {
    const screws = allFasteners().filter((l) => /wood screw/.test(l.key) && l.basis === 'quoted'); // the lengths the research read
    expect(screws.length).toBeGreaterThanOrEqual(2);
    for (const l of screws) {
      expect(l.packQty, l.key).toBeUndefined(); // by the piece
      expect(l.unit, l.key).toBe('ea');
      expect(l.section, l.key).not.toBe('Bulk parts (shop stock)');
      expect(l.notes, l.key).toMatch(/Bought by the piece|not found/);
    }
    expect(bulk.some((l) => /fender washer|lock nut/.test(l.key))).toBe(false);
  });
});

describe('exterior material notes (Eric, 2026-10-12)', () => {
  it('states a material requirement on every fastener and metal hardware line', () => {
    const lines = [...secLines('fasteners'), ...secLines('bulk').filter((l) => l.packQty !== 1 && !/glass-tape|sandpaper/.test(l.key)), ...secLines('touches').filter((l) => !/dual-lock/.test(l.key))];
    for (const l of lines.filter((q) => /^(316|Domino|Heat-set|Nylon|Button|Flanged)/.test(q.key))) expect(l.materialNote, l.key).toBeTruthy();
    for (const l of secLines('purchased').filter((q) => /hinge|latch|pin|chain|snap|clip|kingpin|steer|scupper|drain|stay|bridle-sleeve/.test(q.key))) expect(l.materialNote, l.key).toBeTruthy();
    expect(secLines('fasteners').find((l) => /hex bolt 3\/8-16 x 3-1\/4/.test(l.key))!.materialNote).toMatch(/316 stainless REQUIRED.*tannins/);
  });

  it('says Sipo, not beech, on every Domino line and in its price entry', () => {
    const dom = allFasteners().filter((l) => /^Domino/.test(l.key));
    expect(dom.map((l) => l.key).sort()).toEqual(expect.arrayContaining(['Domino DF 500 4x20', 'Domino DF 500 5x30', 'Domino DF 500 8x50']));
    for (const l of dom) {
      expect(l.materialNote, l.key).toMatch(/SIPO.*NOT beech/);
      expect(l.description, l.key).toMatch(/Sipo/);
      expect(l.notes, l.key).toMatch(/SIPO/);
      expect(l.notes, l.key).not.toMatch(/beech\)/); // "beech" only in the NOT sentence
    }
    expect(fastenerMaterialNote('Domino DF 500 5x30')).toMatch(/REQUIRED.*NOT beech/);
  });

  it('sorts a fastener by where it lives', () => {
    expect(fastenerMaterialNote('316 wood screw #8 x 1"', ['rail-L', 'deck'])).toMatch(/316 stainless REQUIRED/);
    expect(fastenerMaterialNote('316 wood screw #6 x 1/2"', ['storage-lid-batten-1', 'storage-lid-batten-2'])).toMatch(/deck screw OK/);
    expect(fastenerMaterialNote('316 machine screw #10-32 x 3/8"', ['seat-hinge-backer-L', 'seat-hinge-L'])).toMatch(/304 or 316/);
    expect(fastenerMaterialNote('316 screw M4 x 10 mm', ['front-light'])).toMatch(/304 or 316/);
    expect(fastenerMaterialNote('Heat-set insert M4')).toMatch(/Brass heat-set insert OK/);
  });
});

describe('links (Eric, 2026-10-12)', () => {
  /** The price research as text (docs/price-research/price-research-2026-10.json): the only source of URLs besides Eric's own three links. */
  const research = Object.values(import.meta.glob('../../docs/price-research/price-research-2026-10.json', { query: '?raw', import: 'default', eager: true }))[0] as string;
  const research2 = Object.values(import.meta.glob('../../docs/price-research/price-research-standard-2026-10.json', { query: '?raw', import: 'default', eager: true }))[0] as string; // the Standard-spec pass (the Penn Tool zinc collar)
  const ERIC_HOSTS = /^https:\/\/(www\.thewoodyard\.com|www\.aircraftspruce\.com|clinelumber\.com)\//;

  it('carries only links Eric gave or the research lists, and invents none', () => {
    expect(research.length).toBeGreaterThan(1000);
    const lines = b.sections.flatMap((s) => s.lines);
    const urls = [...lines.map((l) => l.url), ...lines.flatMap((l) => (l.alternatives ?? []).map((a) => a.url))].filter((u): u is string => !!u);
    expect(urls.length).toBeGreaterThan(40);
    for (const u of urls) expect(ERIC_HOSTS.test(u) || research.includes(u) || research2.includes(u), u).toBe(true);
    const lum = secLines('lumber');
    expect(lum.find((l) => l.key === '4/4')!.url).toBe('https://www.thewoodyard.com/current-pricing-list/');
    expect(lum.find((l) => l.key === '5/4')!.url).toBeUndefined(); // no yard link for the estimated 5/4 and 6/4
    const ply = secLines('plywood');
    expect(ply.find((l) => l.key === '4 mm')!.url).toBe('https://www.aircraftspruce.com/catalog/wppages/okume.php');
    expect(ply.find((l) => l.key === '12 mm')!.url).toBe('https://www.thewoodyard.com/current-pricing-list/#plywood');
    expect(PLYWOOD_PRICE['4 mm'].source).not.toMatch(/okume\.php|aircraftspruce\.com/);
    expect(b.csv).toContain('https://www.thewoodyard.com/current-pricing-list/#plywood');
  });

  /** Every price table entry, flattened: the base prices and their alternatives. */
  const tablePrices = (): Array<{ where: string; price: Price }> => {
    const out: Array<{ where: string; price: Price }> = [];
    const add = (where: string, p: Price | undefined): void => { if (!p) return; out.push({ where, price: p }); (p.alternatives ?? []).forEach((a, i) => add(`${where} alt ${i}`, a)); };
    Object.entries(OAK_PRICE_PER_BF).forEach(([k, v]) => add(`oak ${k}`, v));
    Object.entries(OAK_ALT_PRICE_PER_BF).forEach(([k, v]) => add(`oak alt ${k}`, v));
    Object.entries(PLYWOOD_PRICE).forEach(([k, v]) => add(`ply ${k}`, v));
    METAL_PRICE_PER_FT.forEach((r) => add(`metal ${r.match}`, r.price));
    PURCHASED_PRICE.forEach((r) => add(`purchased ${r.match}`, r.price));
    FASTENER_PRICE.forEach((r) => add(`fastener ${r.match}`, r.price));
    EPOXY_KITS.forEach((k) => add(`kit ${k.id}`, k.price));
    [EPOXY_PUMPS_300, GLASS_TAPE, ...Object.values(FILLERS), ...Object.values(NOTE_PRICE), ...Object.values(FINISH_PRICE)].forEach((p, i) => add(`consumable ${i}`, p));
    Object.entries(FINISH_CONTAINER_PRICE).forEach(([k, m]) => Object.entries(m).forEach(([u, p]) => add(`finish ${k} ${u}`, p)));
    return out;
  };

  it('gives every quoted price in the tables a link and a note; the researched ones carry the date, and those read via search say to confirm', () => {
    const quotedPrices = tablePrices().filter((x) => x.price.basis === 'quoted');
    expect(quotedPrices.length).toBeGreaterThan(60);
    for (const { where, price } of quotedPrices) {
      expect(price.url, where).toMatch(/^https:\/\//);
      if (!/^(oak|ply)/.test(where)) expect(price.note, where).toBeTruthy(); // (Eric's own lumber and plywood quotes carry their notes in the BOM line)
    }
    const researched = quotedPrices.filter((x) => (x.price.note ?? '').includes(RESEARCH_DATE));
    expect(researched.length).toBeGreaterThan(55);
    expect(researched.filter((x) => (x.price.note ?? '').includes(SEARCH_READ_NOTE)).length).toBeGreaterThan(30);
  });

  it('gives every quoted BOM line a link, except the lines the model prices itself (part.sourcing.costUsd)', () => {
    for (const s of b.sections) for (const l of s.lines.filter((q) => q.basis === 'quoted' && !q.url)) {
      const modelPriced = (l.partIds ?? []).length > 0 && l.partIds!.every((id) => parts.find((x) => x.id === id)?.sourcing?.costUsd !== undefined);
      expect(modelPriced, `${s.id}/${l.key}`).toBe(true);
    }
  });
});

describe('price research applied (2026-10-12)', () => {
  const lines = () => b.sections.flatMap((s) => s.lines);
  const line = (key: string | RegExp) => lines().find((l) => (typeof key === 'string' ? l.key === key : key.test(l.key)))!;

  it('prices no 207 or 209 hardener and no 301 or 303 pump set (the schedule uses 206 only; the 300 set does both ratios)', () => {
    for (const l of lines()) expect(`${l.key} ${l.description}`, l.key).not.toMatch(/\b(207|209|301|303)\b/);
    expect(b.unpriced).toEqual([]);
    expect(line('epoxy-pumps').description).toMatch(/300 Mini Pump Set/);
  });

  it('picks the cheapest kit combination that covers the resin, with the gallon group at the Rock West price and Fiberglass Supply as the alternative', () => {
    const gallon = EPOXY_KITS[1].price;
    expect(gallon.usd).toBe(179.99);
    expect(gallon.url).toBe('https://www.rockwestcomposites.com/ws-slow-1-2gal-kit.html');
    expect(gallon.alternatives!.map((a) => [a.source, a.usd])).toEqual([['Fiberglass Supply', 205.8]]);
    const l = line('epoxy-gallon');
    expect(l.alternatives!.length).toBe(1);
    expect(l.notes).toMatch(/Fiberglass Supply \$205\.80/);
    expect(b.consumables.resinFlOz).toBeLessThanOrEqual(EPOXY_KITS[1].resinFlOz); // one gallon group covers the resin
    expect(secLines('consumables').some((q) => q.key === 'epoxy-quart')).toBe(false);
  });

  it('puts the wheel decision and its alternatives on the wheel line: the $9.99 Harbor Freight 5/8" bore wheel (Eric, D-71), the steel hub and the Uline flat-free as alternatives', () => {
    const w = line('wheel');
    expect(w.unitUsd).toBe(9.99);
    expect(w.basis).toBe('quoted');
    expect(w.url).toBe('https://www.harborfreight.com/10-inch-x-3-1-2-half-inch-pneumatic-tire-67465.html');
    expect(w.notes).toMatch(/VERIFY the hub length, bore and rating/);
    expect(w.notes).toMatch(/2026-10-12/);
    const steel = w.alternatives!.find((a) => a.usd === 11.99)!;
    expect(steel.source).toBe('Harbor Freight');
    expect(steel.specGap).toBeUndefined(); // the same kind of wheel with the sturdier hub
    const uline = w.alternatives!.find((a) => /Uline/.test(a.source))!;
    expect(uline.usd).toBe(34);
    expect(uline.specGap).toBe(true);
    expect(w.notes).toMatch(/SPEC GAP: flat-free/);
    expect(w.decision).toMatch(/5\/8"/);
    expect(b.decisions).toContain('wheel');
  });

  it('flags the Domino 4x20 (no Sipo exists) as a decision, with the beech pack as a spec-gap alternative; the 5x30 and 8x50 are the real Sipo packs', () => {
    const d = line('Domino DF 500 4x20');
    expect(d.decision).toMatch(/NO Sipo 4x20 exists: decision needed/);
    expect(d.basis).toBe('estimate'); // no price exists for a Sipo 4x20
    const beech = d.alternatives!.find((a) => /Woodcraft/.test(a.source))!;
    expect(beech.specGap).toBe(true);
    expect(beech.packQty).toBe(450);
    expect(beech.packUsd).toBe(25);
    expect(d.notes).toMatch(/interior type/);
    expect(b.decisions).toContain('Domino DF 500 4x20');
    const d530 = line('Domino DF 500 5x30'), d850 = line('Domino DF 500 8x50');
    expect([d530.packQty, d530.packUsd, d530.basis]).toEqual([300, 57, 'quoted']);
    expect([d850.packQty, d850.packUsd, d850.basis]).toEqual([100, 57, 'quoted']);
    expect(d530.packs).toBe(1);
    expect(d850.packs).toBe(1);
  });

  it('prices the 5/8 in shaft collars (D-71/D-72): a 316 estimate (the research found 316 only in 3/4 in bore, $33.36) with the Penn Tool zinc collar, $4.43, as a spec-gap alternative', () => {
    const c = line(/shaft collar/);
    expect(c.key).toMatch(/5\/8" bore/);
    expect(c.unitUsd).toBe(33.36);
    expect(c.basis).toBe('estimate');
    expect(c.notes).toMatch(/not found in the 2026-10-12 research/);
    expect(c.qty).toBe(4);
    const alt = c.alternatives!.find((a) => a.usd === 4.43)!;
    expect(alt.specGap).toBe(true);
    expect(alt.source).toMatch(/Penn Tool/);
    expect(alt.url).toBe('https://www.penntoolco.com/87986402');
    expect(alt.note).toMatch(/zinc/);
    expect(b.decisions).toContain(c.key);
  });

  it('prices the eye bolts 316 at the nearest stock lengths (the Extreme spec), with galvanized as the cheaper alternative and a decision', () => {
    const eye = line('steer-eye'), anchor = line('steer-anchor');
    expect([eye.unitUsd, anchor.unitUsd]).toEqual([50.77, 48.43]);
    expect(eye.alternatives![0].usd).toBe(11.94);
    expect(anchor.alternatives![0].usd).toBe(11.1);
    expect(eye.decision).toMatch(/stock 3\/8-16 shoulder eye bolts, 4-1\/2" for the axle beam/); // D-72: stock lengths checked against the stack, cut to length
    expect(b.decisions).toEqual(expect.arrayContaining(['steer-eye', 'steer-anchor']));
  });

  it('flags every decision line, each with a decision text', () => {
    expect(b.decisions.length).toBeGreaterThanOrEqual(5);
    for (const k of b.decisions) expect(lines().find((l) => l.key === k)?.decision, k).toBeTruthy();
    for (const l of lines().filter((q) => q.decision)) expect(b.decisions, l.key).toContain(l.key);
  });

  it('shows every alternative in the line notes, spec gaps marked, and never silently substitutes one', () => {
    const withAlts = lines().filter((l) => l.alternatives?.length);
    expect(withAlts.length).toBeGreaterThan(10);
    for (const l of withAlts) {
      expect(l.notes, l.key).toMatch(/Alternatives \(not substituted\)/);
      for (const a of l.alternatives!) {
        expect(l.notes, `${l.key} ${a.source}`).toContain(a.source);
        if (a.specGap) expect(a.note, `${l.key} ${a.source}`).toMatch(/^SPEC GAP:/);
      }
    }
    // the BOM line's own price is never one of its spec-gap alternatives
    for (const l of withAlts) for (const a of l.alternatives!.filter((q) => q.specGap)) expect(l.url === a.url && l.unitUsd === a.usd, `${l.key} base equals a spec-gap alternative`).toBe(false);
    // CSV: the alternatives and the decisions are columns
    expect(b.csv).toContain('SPEC GAP: flat-free');
    expect(b.csv).toContain('NO Sipo 4x20 exists');
  });

  it('prices the screws, washers and nuts by the piece where Bolt Depot sells them singly and cheaper than the bag, and the Dominos by their packs', () => {
    const s8 = line('316 wood screw #8 x 1-1/4"');
    expect([s8.qty, s8.unitUsd, s8.packQty]).toEqual([37, 0.53, undefined]); // D-72: every general-purpose screw is the #8 x 1-1/4 (17 before); 37 x 0.53 = 19.61 is under the $33.95 bag of 100
    expect(s8.extUsd).toBeCloseTo(37 * 0.53, 2);
    // D-77: the two brake pivot straps take 4 PAN-HEAD #8 x 1-1/4 each, a line of their own (the flat-head line stays 37); priced as the flat-head screw until quoted
    const pan = line('316 pan-head wood screw #8 x 1-1/4"');
    expect([pan.qty, pan.unitUsd]).toEqual([8, 0.53]);
    expect(pan.basis).toBe('estimate');
    expect(pan.notes).toMatch(/pan-head/);
    const w = line('316 fender washer 1/4"');
    expect([w.qty, w.unitUsd]).toEqual([32, 0.46]); // 32 x 0.46 = 14.72, under the $27.26 bag of 100 (a nut-side washer only on the hold-down and clamp bolts, whose text puts the washers under the beam)
    const n = line('316 nylon-insert lock nut 1/4-20');
    expect([n.qty, n.unitUsd]).toEqual([20, 0.25]); // 24 before the hanger bolts were counted once
    // a length the research did not read keeps its estimate and says so
    const unread = line('316 wood screw #6 x 2-1/2"');
    expect(unread.basis).toBe('estimate');
    expect(unread.notes).toMatch(/not found in the 2026-10-12 research/);
  });

  it('keeps the model\'s own cost where the research found no qualifying price, and replaces it where it did', () => {
    expect(line('storage-hinge').unitUsd).toBe(14); // model cost kept, the 2" hinge is a spec gap
    expect(line('storage-hinge').notes).toMatch(/not found in the 2026-10-12 research/);
    expect(line('lash-point').unitUsd).toBe(7);
    expect(line('lash-point').alternatives![0].specGap).toBe(true);
    expect(line('seat-hinge').unitUsd).toBeCloseTo(13.545, 3); // Seachoice 316 pair, $27.09
    expect(line('seat-hinge').extUsd).toBeCloseTo(27.09, 2);
    expect(line('front-light').unitUsd).toBe(58.95);
    expect(line('rear-light').unitUsd).toBe(44.95);
  });

  it('buys metal bars and tubes as the fixed pieces the vendors sell', () => {
    const dom = line(/DOM tube/);
    expect([dom.unit, dom.qty, dom.unitUsd, dom.url, dom.basis]).toEqual(['60 in piece', 1, 45.45, undefined, 'estimate']); // D-71: 5/8 x 0.120 is not at Speedy Metals; their 0.109 wall 60 in price stands in (flagged)
    expect(dom.alternatives![0].specGap).toBe(true);
    expect(dom.needed).toBeLessThanOrEqual(5); // the cuts fit the 60 in piece
    const bar = line(/flat bar 1\/16/);
    expect(bar.basis).toBe('estimate');
    expect(bar.alternatives![0].specGap).toBe(true); // the 1/8" bar is thicker
  });
});

describe('bom text for the book', () => {
  const keys = [...new Set(parts.flatMap((x) => [x.id, x.partNo ?? '']).filter((k) => k.includes('-')))].sort((a, z) => z.length - a.length);
  const keyRe = new RegExp(`(?<![\\w/.-])(${keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w/-])`);
  const urls = (t: string): string => t.replace(/https?:\/\/\S+/g, '');

  for (const spec of [0, 1]) {
    it(`has no decision ids, report tags or part keys in any printed text (weather spec ${spec})`, () => {
      const bb = bom(buildModel({ ...p, weatherSpec: spec }), { ...p, weatherSpec: spec });
      const text = [
        ...bb.sections.flatMap((s) => [...(s.notes ?? []), ...s.lines.flatMap((l) => [l.description, l.notes, l.decision, l.materialNote].filter((q): q is string => !!q))]),
        urls(bb.csv),
      ];
      for (const t of text) {
        expect(urls(t), t.slice(0, 80)).not.toMatch(/\b[DAQ]-\d+\b/);
        expect(t, t.slice(0, 80)).not.toMatch(/\bS7\b/);
        expect(urls(t), t.slice(0, 80)).not.toMatch(keyRe);
      }
    });
  }

  it('reads the laminated parts by their names, and keeps the part key out of the CSV item column', () => {
    const lumber = secLines('lumber').map((l) => l.notes ?? '').join(' ');
    expect(lumber).toMatch(/face-laminated parts \(rear axle beam, front axle beam, brake knee, wheel chock: /);
    const items = b.csv.split('\n').slice(1).map((r) => r.split(',')[1]);
    expect(items).not.toContain('king-thrust');
    expect(items).toContain('4/4');
  });
});
