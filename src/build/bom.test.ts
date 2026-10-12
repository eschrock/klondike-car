import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { fastenerBreakdown } from '../model/lighting';
import { defaultParams } from '../params';
import { EPOXY_WASTE, NOTE_ITEMS, THROUGH_STACKS, bom, boltLengthFromStack, jointItems, roundUpStock, screwLengthFromStack, shortVendor, uniqueJoints } from './bom';
import { cutList, isBuilt } from './cutlist';
import { finishingSchedule, glueEpoxyFlOz } from './finishing';
import { oakBoardFeet } from './nesting';
import { EPOXY_KITS, OAK_PRICE_PER_BF } from './prices';

const p = defaultParams();
const parts = buildModel(p);
const b = bom(parts, p);
const cl = cutList(parts, p);

describe('bom', () => {
  it('totals to a finite positive number, section by section', () => {
    expect(Number.isFinite(b.totalUsd)).toBe(true);
    expect(b.totalUsd).toBeGreaterThan(500);
    expect(b.sections.map((s) => s.id)).toEqual(['lumber', 'plywood', 'metal', 'purchased', 'fasteners', 'consumables']);
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
    b.sections.find((s) => s.id === 'purchased')!.lines.forEach((l) => l.partIds!.forEach(hit));
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
    expect(b.jointCounts.bolt).toBe(n('bolt sets') + n('bolts tapped into steel') + n('nuts and washers (itemized bolts)'));
    expect(b.jointCounts['threaded-insert']).toBe(n('inserts'));
    expect(b.jointCounts.knob).toBe(n('thumb knobs'));
    expect(b.jointCounts.domino).toBe(n('Dominos'));
    expect(b.jointCounts.glue).toBe(n('epoxy joints'));
    const lines = b.sections.find((s) => s.id === 'fasteners')!.lines;
    const sum = (re: RegExp) => lines.filter((l) => re.test(l.key)).reduce((a, l) => a + l.qty, 0);
    expect(sum(/^Domino/)).toBe(b.jointCounts.domino);
    // every bolt brings a nut, except the kingpin (nut is in the part)
    expect(sum(/lock nut/) + sum(/T-nut/)).toBeGreaterThanOrEqual(b.jointCounts.bolt - 1); // every bolt gets a lock nut, or a T-nut set in its backer (the handle sockets)
    expect(lines.some((l) => /Domino DF 500 4x20/.test(l.key))).toBe(true);
    expect(lines.some((l) => /Domino DF 500 5x30/.test(l.key))).toBe(true);
  });

  it('marks model costs quoted and table prices estimated', () => {
    const purchased = b.sections.find((s) => s.id === 'purchased')!.lines;
    const cushion = purchased.find((l) => l.key === 'seat-cushion')!;
    expect(cushion.basis).toBe('quoted');
    expect(cushion.unitUsd).toBe(parts.find((x) => x.id === 'seat-cushion')!.sourcing!.costUsd);
    expect(purchased.find((l) => l.key === 'wheel')!.basis).toBe('estimate');
    expect(purchased.find((l) => l.key === 'wheel')!.qty).toBe(4);
    for (const s of ['lumber', 'plywood', 'metal'] as const) expect(b.sections.find((x) => x.id === s)!.lines.every((l) => l.basis === 'estimate')).toBe(true);
  });

  it('prices two sheets from a local supplier and 4/4 to 12/4 oak', () => {
    const ply = b.sections.find((s) => s.id === 'plywood')!.lines;
    expect(ply.map((l) => l.qty)).toEqual([1, 1]);
    expect(JSON.stringify(b)).not.toMatch(/Aircraft Spruce/);
    const lumber = b.sections.find((s) => s.id === 'lumber')!.lines.map((l) => l.key);
    expect(lumber).toEqual(['4/4', '5/4', '6/4', '8/4', '12/4']);
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
    expect(hardeners.some((x) => /209/.test(x.item)), '209 is on the buy list').toBe(true);
    for (const no of new Set(hardeners.map((x) => /\b(20\d)\b/.exec(x.item)![1]))) {
      expect(cons.find((l) => l.key === `epoxy-${no}`)?.qty, no).toBe(hardeners.filter((x) => new RegExp(no).test(x.item)).reduce((a, x) => a + x.qt * 2, 0));
    }
    // pumps: the schedule's counted supplies, plus a 5:1 set for the glue epoxy
    for (const sp of sched.supplies.filter((x) => /pump/i.test(x.item))) expect(cons.find((l) => l.description === sp.item)?.qty, sp.item).toBe(sp.qty);
    expect(cons.some((l) => /^epoxy-pumps-301/.test(l.key))).toBe(true);
    // the glue epoxy is finishing.ts's estimate by joint type plus the waste, and per joint it is well above the old 0.12 fl oz
    expect(b.consumables.glueEpoxyFlOz).toBeCloseTo(glueEpoxyFlOz(parts) * (1 + EPOXY_WASTE), 6);
    expect(b.consumables.glueEpoxyFlOz / b.jointCounts.glue).toBeGreaterThan(0.25);
    expect(b.consumables.glueEpoxyFlOz).toBeGreaterThan(40); // the critic's 40-50 fl oz for the glue, fillets and fairing
    const finishFlOz = sched.steps.find((x) => x.id === 'epoxy')!.products.reduce((a, q) => a + q.qtNeeded, 0) * 32;
    expect(b.consumables.finishEpoxyFlOz).toBeCloseTo(finishFlOz, 6);
    expect(b.consumables.closeEpoxyFlOz).toBeCloseTo(sched.closeEpoxyFlOz, 6);
    // resin: 5/6 of the glue mix, 3/4 of the 3:1 mixes; the kits cover it, and no cheaper combination does
    const need = (b.consumables.glueEpoxyFlOz * 5) / 6 + ((b.consumables.finishEpoxyFlOz + b.consumables.closeEpoxyFlOz) * 3) / 4;
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
    expect(b.csv.split('\r\n')[0]).toBe('Section,Item,Description,Qty,Unit,Unit USD,Ext USD,Basis,Vendor,Notes');
    expect(b.csv).toContain('Grand total');
    expect(b.csv.match(/Subtotal/g)!.length).toBe(6);
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

  const fasteners = () => b.sections.find((x) => x.id === 'fasteners')!.lines;
  const consumables = () => b.sections.find((x) => x.id === 'consumables')!.lines;
  const qtyOf = (lines: typeof b.sections[number]['lines'], re: RegExp): number => lines.filter((l) => re.test(l.key)).reduce((a, l) => a + l.qty, 0);

  it('lists what the steps and notes use (build MUST-10): axle retention, hinge screws, handlebow rods, rail screws, plugs, washers, Dual Lock, banding, sealant, cement, batten screws', () => {
    const wheels = parts.filter((x) => /^wheel-/.test(x.id)).length;
    expect(wheels).toBe(4);
    const f = fasteners(), c = consumables();
    expect(qtyOf(f, /shaft collar/)).toBe(wheels);
    expect(qtyOf(f, /cotter pin 5\/32" x 1-1\/2"/)).toBe(wheels); // the 0.156" cross hole takes a 5/32 pin
    expect(qtyOf(f, /end plug for 3\/4" OD/)).toBe(6); // three axle tubes, two ends each
    expect(qtyOf(f, /machine screw #10-32 x 3\/8"/)).toBe(6); // seat hinge leaves into the six inserts
    expect(qtyOf(f, /stainless rod 3\/8" x 2-1\/4"/)).toBe(2); // handlebow pins
    expect(qtyOf(f, /wood screw #6 x 3-1\/2"/)).toBe(8); // rail to chine, aft zone (3 in rail): 4 a side, #6 piloted (round 3: a #8 left 0.11 in a side of the 3/8 in edge)
    expect(qtyOf(f, /wood screw #6 x 2-1\/2"/)).toBe(2); // rail to chine, forward zone (1.8 in rail): 1 a side
    expect(qtyOf(f, /Button plug 5\/8"/)).toBe(4);
    expect(qtyOf(f, /Nylon washer for 1\/4"/)).toBe(4);
    expect(qtyOf(f, /wood screw #6 x 1\/2"/)).toBe(12); // lid battens, 4 each
    expect(qtyOf(c, /^dual-lock$/)).toBeGreaterThanOrEqual(1);
    expect(qtyOf(c, /^edge-banding$/)).toBeGreaterThanOrEqual(1);
    expect(qtyOf(c, /^sealant$/)).toBeGreaterThanOrEqual(1);
    expect(qtyOf(c, /^contact-cement$/)).toBeGreaterThanOrEqual(1);
    for (const l of c.filter((q) => ['dual-lock', 'edge-banding', 'sealant', 'contact-cement'].includes(q.key))) expect(l.notes, l.key).toMatch(/\(.+\)$/); // cites its note
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
    // hanger bolts: hanger + rail + allowance
    const h = strip('axle-hanger-L', 'rail-L');
    expect(boltLengthFromStack(h.part, h.j, byId)).toBe(roundUpStock(0.875 + 0.75 + 0.4));
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
    expect(cons.find((q) => q.key === 'epoxy-209')).toBeTruthy();
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
