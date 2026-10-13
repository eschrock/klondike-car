/**
 * Cargo mode, analysis side (Phase 3c-2, D-53). Each number is re-derived by hand from the params, the layout and the model, not read back from the check code.
 * The cargo case sits next to the rider cases: it adds `cases.cargo` / `statusCargo` and never moves a rider status, a rider util or the rider sweep.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, type Params } from '../params';
import { buildModel } from '../model';
import { cargoBed } from '../model/bed';
import { worldAABB } from '../model/bounds';
import { bowGeometry } from '../model/handle';
import { computeLayout } from '../model/layout';
import { centerOfGravity, totalMass } from '../model/mass';
import { seatStowPlan } from '../model/seat-stow';
import { ESSENTIALS, boxGear, packEssentials, storageInterior } from '../model/storage';
import { makeContext } from './context';
import { runChecks, type AnalysisCheck } from './index';
import { seatFactor } from './bump';
import { cargoCapacity } from './cargo-capacity';
import { grainSlopeFactor, lidLoads, strapLoads } from './cargo';
import { riderSweep } from './rider-sweep';
import { contactsAt, RAD } from './geometry';
import { PRE_D71, PRE_D66 } from '../test-fixtures';

// D-66 changed the tracks, the load-height rule and the bow: this file's hand calculations are the D-58 design (PRE_D66); the D-66 numbers are in d66.test.ts
const defaults = { ...defaultParams(), ...PRE_D71, ...PRE_D66 } as Params;
const L = computeLayout(defaults);
const cs = runChecks(defaults, { includeTruck: false });
const byId = (c: AnalysisCheck[], id: string) => c.find((x) => x.id === id)!;
const det = (c: AnalysisCheck[], id: string, name: string) => byId(c, id).details!.find((d) => d.name.includes(name))!;
const installed = buildModel(defaults, { rider: 'goal', cargo: true });
const stowed = buildModel(defaults, { rider: 'none', cargo: false, seat: 'stowed' });
const ctx = makeContext(defaults, installed, stowed);

describe('the parameter (D-53)', () => {
  it('is 200 lb, locked by Eric (D-58, 2026-10-11), no longer waiting for confirmation', async () => {
    const { PARAM_DEFS } = await import('../params');
    const d = PARAM_DEFS.cargoPayloadLb;
    expect(d.default).toBe(200);
    expect(d.status).toBe('locked');
    expect(d.ref).toMatch(/D-58/);
    expect(d.note).toMatch(/Eric 2026-10-11/);
    expect(d.note).not.toMatch(/onfirm with Eric/);
    expect(PARAM_DEFS.cargoConcentratedLb.status).toBe('assumed');
  });
});

describe('the cargo load cases', () => {
  const [aft, fore] = ctx.loads.cargoCases;
  const bed = cargoBed(defaults, L);
  it('are two placements of the payload on the stowed sled with no rider: mass = stowed empty sled + 200 lb', () => {
    expect(ctx.loads.cargoCases).toHaveLength(2);
    for (const c of [aft, fore]) {
      expect(c.kind).toBe('cargo');
      expect(c.riderLb).toBe(0);
      expect(c.cargoLb).toBe(200);
      expect(c.massLb).toBeCloseTo(totalMass(stowed) + 200, 6);
    }
  });
  it('put the CG at the cargo height and lateral offset: z and y by the mass-weighted mean, x by the placement', () => {
    const m0 = totalMass(stowed), cg0 = centerOfGravity(stowed);
    const M = m0 + 200;
    const cz = L.deckTop + defaults.cargoCgHeightIn;
    expect(aft.cg[2]).toBeCloseTo((m0 * cg0[2] + 200 * cz) / M, 6);
    expect(aft.cg[1]).toBeCloseTo((m0 * cg0[1] + 200 * defaults.cargoCgOffsetYIn) / M, 6);
    const lenC = Math.min(defaults.cargoLoadLengthIn, bed.xLoadEnd - bed.x0);
    expect(aft.cg[0]).toBeCloseTo((m0 * cg0[0] + 200 * (bed.x0 + lenC / 2)) / M, 6);
    expect(fore.cg[0]).toBeCloseTo((m0 * cg0[0] + 200 * (bed.xLoadEnd - lenC / 2)) / M, 6);
    expect(fore.cg[0]).toBeGreaterThan(aft.cg[0]);
  });
  it('the stowed sled is a hair different from the installed one (the seat kit moved into the box), not the same list', () => {
    expect(totalMass(stowed)).toBeCloseTo(ctx.loads.empty.massLb, 6);
    expect(centerOfGravity(stowed)[2]).not.toBeCloseTo(ctx.loads.empty.cg[2], 6);
  });
  it('are absent when the context has no stowed list (the rider sweeps use that fast path)', () => {
    expect(makeContext(defaults, installed).loads.cargoCases).toEqual([]);
  });
});

describe('the rider status never depends on the cargo (the rider headline logic is unchanged)', () => {
  const lo = runChecks({ ...defaults, cargoPayloadLb: 0 }, { includeTruck: false });
  const hi = runChecks({ ...defaults, cargoPayloadLb: 600 }, { includeTruck: false });
  const off = runChecks(defaults, { includeTruck: false, cargo: false });
  it('every rider field of every row is the same at 0 lb, 250 lb, 600 lb and with the cargo case off', () => {
    for (const c of cs) {
      for (const o of [lo, hi, off]) {
        const q = o.find((x) => x.id === c.id);
        if (!q) { expect(o).toBe(off); continue; } // the cargo-only rows do not exist with the cargo case off
        expect(q.status, c.id).toBe(c.status);
        expect(q.statusOperating, c.id).toBe(c.statusOperating);
        expect(q.statusGoal, c.id).toBe(c.statusGoal);
        expect(q.util, c.id).toBe(c.util);
        expect(q.governingLoad, c.id).toBe(c.governingLoad);
        expect(q.cases?.operating, c.id).toEqual(c.cases?.operating);
        expect(q.cases?.goal, c.id).toEqual(c.cases?.goal);
      }
    }
  });
  it('the rider sweep is the same with any payload', () => {
    const a = riderSweep(defaults), b = riderSweep({ ...defaults, cargoPayloadLb: 600 });
    expect(b.safe).toEqual(a.safe);
    expect(b.points.map((p) => p.status)).toEqual(a.points.map((p) => p.status));
  });
  it('rows with the cargo case on carry cases.cargo, statusCargo and utilCargo; the rows without it do not', () => {
    for (const id of ['tip-straight', 'tip-lock', 'wheel-rating', 'axle-stress', 'rails', 'deck', 'joists', 'kingpin', 'king-bearing', 'front-beam', 'front-stub', 'steer-stops', 'king-beam']) {
      const c = byId(cs, id);
      expect(c.cases?.cargo, id).toBeDefined();
      expect(c.statusCargo, id).toBe(c.cases!.cargo!.status);
      expect(c.utilCargo, id).toBeCloseTo(c.cases!.cargo!.util, 9);
    }
    for (const id of ['seat-back', 'seat-grip', 'foot-stop', 'turn-radius', 'bridle-eye', 'steer-clear']) expect(byId(cs, id).cases?.cargo, id).toBeUndefined();
    expect(byId(off, 'wheel-rating').cases?.cargo).toBeUndefined();
  });
});

// (the brake rows with the cargo case, D-55 foot brake, are tested in brake.test.ts)
describe('rear-only traction with the cargo forward (info number quoted by the capacity sweep)', () => {
  it('the front axle of the loaded sled takes more than half the weight when the payload is piled at the nose end: N_r/W = cos(th) (44 - x)/44 - sin(th) h/44 is below 0.3, so mu N_r is under the downhill pull W sin(th)', () => {
    const f = ctx.loads.cargoCases[1];
    const th = defaults.designSlopeDeg * RAD;
    const xfc = ctx.contact.wheelbaseIn; // front contacts on the kingpin line, x = 44 in, with the axle straight
    expect(xfc).toBeCloseTo(44, 9);
    const Nr = f.massLb * (Math.cos(th) * (xfc - f.cg[0]) / xfc - (Math.sin(th) * f.cg[2]) / xfc);
    expect(Nr / f.massLb).toBeLessThan(0.3);
    expect(defaults.tireGroundMu * Nr).toBeLessThan(f.massLb * Math.sin(th)); // rear-only traction ratio below 1: the pullers or a chock hold the rest
  });
});

describe('tipping with the high cargo CG', () => {
  it('lateral tip = atan(d / h) of the 200 lb payload (CG 16.2 in up, 1.95 in left of center) worst over the steering range, hand-derived: aft and fore both pass the 35 degree limit (D-67; it was 40 and marginal); the fore pile (x = 31.3) is the worse', () => {
    const k = byId(cs, 'tip-straight').cases!.cargo!;
    const ct = contactsAt(ctx.contact, 0);
    expect(ct.FL[0]).toBeCloseTo(44, 9);
    // Distance from (x, y) to the side edge through the rear tire (0, +-17.75) and the front tire of the turned axle (44 -+ 17.75 sin s, +-17.75 cos s).
    const rh = defaults.rearTrackIn / 2, fh = defaults.frontTrackIn / 2; // D-58: 32 in rear and 34 1/2 in front track
    const degAt = (c: { cg: number[] }) => {
      let worst = Infinity;
      for (let a = -20; a <= 20; a += 1) {
        const s = (a * Math.PI) / 180;
        const fl = [44 - fh * Math.sin(s), fh * Math.cos(s)], fr = [44 + fh * Math.sin(s), -fh * Math.cos(s)];
        const dl = Math.abs(fl[0] * (c.cg[1] - rh) - (fl[1] - rh) * c.cg[0]) / Math.hypot(fl[0], fl[1] - rh);
        const dr = Math.abs(fr[0] * (c.cg[1] + rh) - (fr[1] + rh) * c.cg[0]) / Math.hypot(fr[0], fr[1] + rh);
        worst = Math.min(worst, (Math.atan2(Math.min(dl, dr), c.cg[2]) * 180) / Math.PI);
      }
      return worst;
    };
    const [aft, fore] = ctx.loads.cargoCases;
    expect(Math.abs(degAt(aft) - degAt(fore))).toBeLessThan(0.5); // D-58: the narrower REAR track makes the aft pile as bad as the fore one (41.7 vs 41.9)
    expect(Math.abs(degAt(fore) - 42.1)).toBeLessThan(0.5); // 44.7 at the old 35.5 in tracks (200 lb; 43.2 at 250 lb); 43.0 at 34 1/2 / 32 in (D-58); 42.1 with the D-60 weight package (the sled is 24 lb lighter, so the payload's high, off-center CG counts for more in the total): 41.9 degrees (hand-derived here) at the D-58 tracks and 12 in rule: D-67 lowered the limit to 35 degrees, so 7 degrees over it, outside the 10% marginal band (below 38.5), a plain pass (it was marginal at the 40 degree limit)
    expect(k.value).toBeCloseTo(Math.min(degAt(aft), degAt(fore)), 6);
    expect(k.value).toBeLessThan(byId(cs, 'tip-straight').cases!.operating!.value); // worse than the rider cases
    expect(k.value).toBeGreaterThan(defaults.tipStraightMinDeg);
    expect(k.limit).toBe(35); // D-67
    expect(k.value).toBeGreaterThan(defaults.tipStraightMinDeg * 1.1); // outside the 10% marginal band
    expect(k.status).toBe('pass');
  });
});

describe('the deck and joists under the cargo', () => {
  const bed = cargoBed(defaults, L);
  const g = seatFactor(ctx, ctx.loads.cargoCases[0]);
  it('deck, uniform load: 200 lb x g over the bed area on a 12 in strip, simply supported on the longest span: M = wL^2/8', () => {
    const q = (200 * g) / bed.areaIn2;
    const span = parseFloat(/largest crossmember span ([\d.]+)/.exec(byId(cs, 'deck').how)![1]);
    const t = defaults.deckPlyIn;
    const M = (q * 12 * span * span) / 8;
    const sigma = M / ((12 * t * t) / 6);
    expect(byId(cs, 'deck').detailsCargo!.find((d) => d.name === 'uniform cargo, bending')!.value).toBeCloseTo(sigma, 0);
    expect(byId(cs, 'deck').statusCargo).toBe('pass');
  });
  it('joists, uniform load: w = q x tributary, M = wL^2/8, sigma = M / S with the measured 0.75 x 1.75 in oak section', () => {
    const joists = installed.filter((x) => /^joist-\d+$/.test(x.id)).sort((a, b) => worldAABB(a).min[0] - worldAABB(b).min[0]);
    const bb = joists.map((x) => worldAABB(x));
    const span = Math.max(...bb.map((b) => b.max[1] - b.min[1]));
    const xs = bb.map((b) => (b.min[0] + b.max[0]) / 2);
    const edges = [L.xRear + L.transom, ...[...xs, L.king.x].sort((a, b) => a - b), L.xFlatEnd]; // the king beam is a support too
    let trib = 0;
    for (let i = 1; i < edges.length - 1; i++) trib = Math.max(trib, (edges[i + 1] - edges[i - 1]) / 2);
    const S = (defaults.crossmemberThickIn * defaults.crossmemberDepthIn ** 2) / 6;
    const q = (200 * g) / bed.areaIn2;
    const M = (q * trib * span * span) / 8;
    expect(byId(cs, 'joists').detailsCargo!.find((d) => d.name === 'uniform cargo, bending')!.value).toBeCloseTo(M / S, 0);
    // Concentrated: 90 lb x g over ceil(12 / trib) joists, point load at the middle: M = PL/4.
    const nc = Math.ceil(defaults.cargoPatchAlongIn / trib);
    const Mc = (((defaults.cargoConcentratedLb * g) / nc) * span) / 4;
    expect(byId(cs, 'joists').detailsCargo!.find((d) => d.name === 'concentrated item, bending')!.value).toBeCloseTo(Mc / S, 0);
    expect(byId(cs, 'joists').statusCargo).toBe('pass');
  });
  it('the joist row also checks the riders (seat load and the standing scout) and passes for them', () => {
    const j = byId(cs, 'joists');
    expect(j.cases!.operating).toBeDefined();
    expect(j.cases!.goal).toBeDefined();
    expect(j.status).toBe('pass');
  });
});

describe('the lid as a table (lid-load)', () => {
  it('is a cargo-only row: no rider status, a cargo status; capacity vs the rated 40 lb', () => {
    const c = byId(cs, 'lid-load');
    expect(c.status).toBe('info');
    expect(c.statusCargo).toBe('pass');
    expect(c.value).toBeGreaterThan(defaults.cargoLidLoadLb);
    expect(c.limit).toBe(defaults.cargoLidLoadLb);
  });
  it('the batten T beam by hand: 3 battens, each takes a third of 40 lb x 3, M = PL/4 on the 24.5 in span, oak and ply stresses from the transformed section', () => {
    const k = lidLoads(ctx, 40)!;
    expect(k.bat).toBe(3);
    expect(k.under).toBe(3);
    expect(k.P).toBeCloseTo((40 * defaults.dynamicFactor) / 3, 9);
    expect(k.M).toBeCloseTo((k.P * k.spanIn) / 4, 9);
    // Transformed section: oak batten b x h, ply flange (12 t wide, but never wider than the bay) of E ratio n = E_ply / E_oak.
    const nPly = (ctx.d.plyMoePsi * defaults.wetServiceFactorStiffness) / ctx.d.oakDesignMoePsi;
    const b = k.bIn, h = k.hIn, bf = Math.min(k.bayIn, 12 * k.plyT), tp = k.plyT;
    const A1 = b * h, A2 = nPly * bf * tp;
    const zNa = (A1 * (h / 2) + A2 * (h + tp / 2)) / (A1 + A2);
    const I = (b * h ** 3) / 12 + A1 * (h / 2 - zNa) ** 2 + nPly * ((bf * tp ** 3) / 12 + bf * tp * (h + tp / 2 - zNa) ** 2);
    expect(k.zNa).toBeCloseTo(zNa, 9);
    expect(k.I).toBeCloseTo(I, 9);
    expect(k.sOak).toBeCloseTo((k.M * zNa) / I, 6);
  });
});

describe('tying the load down (cargo-strap)', () => {
  it('strap tension T = W (g / mu - 1) / (2 n sin 45) by hand: 200 lb, 0.8 g, mu 0.3, 3 straps -> 78.6 lbf, a quarter of a 300 lbf plate', () => {
    const k = strapLoads(ctx);
    expect(k.straps).toBe(3);
    expect(k.hold).toBeCloseTo(200 * (0.8 / 0.3 - 1), 9);
    expect(k.T).toBeCloseTo((200 * (0.8 / 0.3 - 1)) / (2 * 3 * Math.sin(Math.PI / 4)), 9);
    expect(k.T).toBeCloseTo(78.6, 1);
    const c = byId(cs, 'cargo-strap');
    expect(c.statusCargo).toBe('pass');
    expect(c.value).toBeCloseTo(78.6, 1);
    expect(c.limit).toBe(defaults.lashLoadLbf);
  });
  it('the six D-rings stay (D-41): six lash points, 300 lbf working load each', () => {
    expect(installed.filter((x) => x.id.startsWith('lash-') && x.group === 'hardware')).toHaveLength(6);
    expect(defaults.lashLoadLbf).toBe(300);
    expect(byId(cs, 'lash-points').value).toBe(6);
  });
  it('a heavier load needs more tension and eventually fails against the plates', () => {
    const t = (w: number) => strapLoads(makeContext({ ...defaults, cargoPayloadLb: w }, installed, stowed)).T;
    expect(t(500)).toBeCloseTo(2 * t(250), 9);
    expect(t(800)).toBeGreaterThan(defaults.lashLoadLbf);
  });
});

describe('the seat-stow row and the 10 Essentials row', () => {
  it('seat-stow (D-57: the two cushions in the box, the back flipped flat) passes at the defaults with the margins of the plan; fails when the cushion is too deep for the box', () => {
    const c = byId(cs, 'seat-stow');
    const plan = seatStowPlan(defaults, L, installed);
    expect(c.status).toBe('pass');
    expect(det(cs, 'seat-stow', 'fore-aft').value).toBeCloseTo(plan.need.lengthIn, 9);
    expect(det(cs, 'seat-stow', 'across').limit).toBeCloseTo(plan.interior.y1 - plan.interior.y0, 9);
    expect(det(cs, 'seat-stow', 'height').value).toBeCloseTo(plan.need.heightIn, 9);
    expect(c.how).toMatch(/never goes in the box/);
    expect(byId(runChecks({ ...defaults, seatDepthIn: 17.5 }, { includeTruck: false }), 'seat-stow').status).toBe('fail');
  });
  it('the 10 Essentials still pack into the box for race mode (storage-pack), with room', () => {
    const c = byId(cs, 'storage-pack');
    expect(c.status).toBe('pass');
    expect(c.value).toBeLessThan(0.9);
  });
  it('3c-5, D-65, cargo mode: the box also holds the front lamp and clip, the rear tail light and clip and the 2 wheel chocks, in the layer left above the cushions (reported with margins)', () => {
    const gear = boxGear(installed);
    expect(gear.lamp.map((k) => k.name)).toEqual(['Front LED headlight', 'Lamp clip', 'Rear LED tail light', 'Rear lamp clip']);
    expect(gear.chocks).toHaveLength(1);
    expect(gear.chocks[0].qty).toBe(2); // one per rear tire
    const plan = seatStowPlan(defaults, L, installed);
    const tall = Math.max(...[...gear.lamp, ...gear.chocks].map((k) => Math.min(...k.dims!)));
    const g = det(cs, 'seat-stow', 'the tallest of the lamps');
    expect(g.value).toBeCloseTo(tall, 9);
    expect(g.limit).toBeCloseTo(plan.margin.heightIn, 9); // the height above the cushions
    expect(g.util).toBeLessThan(1);
    expect(det(cs, 'seat-stow', 'floor area').util).toBeLessThan(0.5);
    const how = byId(cs, 'seat-stow').how;
    expect(how).toMatch(/front lamp and its clip, the rear tail light and its clip and the 2 wheel chocks/);
    expect(how).toMatch(/leaving [\d.]+" under the lid/);
    // a box too shallow for the layer fails: the chocks are the tallest at 2.5 in
    const shallow = runChecks({ ...defaults, seatDepthIn: 17 }, { includeTruck: false });
    expect(byId(shallow, 'seat-stow').status).not.toBe('pass');
  });
  it('D-65: the two removed brake flaps are an OPTION, listed in the row but not in the default stow (the gear kit and the checked details do not include them)', () => {
    const gear = boxGear(installed);
    expect(gear.flaps).toHaveLength(1);
    expect(gear.flaps[0].qty).toBe(2);
    const [l, w, h] = gear.flaps[0].dims!;
    expect(l).toBeGreaterThan(17); // the Shaper-cut board, about 17.8 in long
    expect(w).toBeCloseTo(defaults.brakeFlapWidthIn, 6);
    expect(h).toBeGreaterThan(defaults.brakeFlapThickIn + defaults.brakePivotBlockIn - 1e-9);
    const how = byId(cs, 'seat-stow').how;
    expect(how).toMatch(/OPTION, not in the default stow \(D-65\): the 2 removed brake flaps/);
    // the default details are the lamps, clips and chocks only: the flaps are not in the height or floor checks
    const tall = Math.max(...[...gear.lamp, ...gear.chocks].map((k) => Math.min(...k.dims!)));
    expect(det(cs, 'seat-stow', 'the tallest of the lamps').value).toBeCloseTo(tall, 9);
  });
  it('3c-5, race mode: the 10 Essentials AND the 2 chocks fit (fill under 0.9, margin reported); the row says what it would do if they did not', () => {
    const c = byId(cs, 'storage-pack');
    const base = packEssentials(storageInterior(defaults, L));
    const withChocks = packEssentials(storageInterior(defaults, L), [...ESSENTIALS, ...boxGear(installed).chocks]);
    expect(c.value).toBeCloseTo(withChocks.fill, 9);
    expect(withChocks.fill).toBeGreaterThan(base.fill); // the chocks take room
    expect(withChocks.fits).toBe(true);
    expect(c.how).toMatch(/2 wheel chocks too/);
    expect(c.how).toMatch(/Margin: \d+ in³ free/);
    // a box 1,500 in³ does not hold them: the row fails and proposes a chock holder instead of a bigger box
    const small = byId(runChecks({ ...defaults, storageVolumeIn3: 1500 }, { includeTruck: false }), 'storage-pack');
    expect(small.status).toBe('fail');
    expect(small.how).toMatch(/chock to the outside|holder/);
  });
});

describe('the handlebow row (D-39 socket loads unchanged)', () => {
  it('bow bending at the middle by hand (D-57, one bandsawn board): M = F L / 4 on the 2 x yPost span, sigma = 6 M / b^3, against the oak design bending (no lamination factor; the grain is level at the middle), and a grain-runout factor at the ends', () => {
    const bw = bowGeometry(defaults, L);
    const F = defaults.handleHoldbackLbf, span = 2 * bw.yPost, b = defaults.handleBarDiameterIn;
    const M = (F * span) / 4;
    expect(det(cs, 'handle-bow', 'middle pulling aft').value).toBeCloseTo((6 * M) / b ** 3, 6);
    expect(det(cs, 'handle-bow', 'middle pulling aft').limit).toBeCloseTo(ctx.d.oakDesignMorPsi, 6);
    // the end: the sawn arc runs the grain out atan(yEnd / sqrt(R^2 - yEnd^2)) (about 12 degrees, 1:4.7): Wood Handbook factor 0.45 at 1:5
    const slope = Math.tan(Math.asin(bw.yEnd / bw.radiusIn));
    expect(grainSlopeFactor(0.2)).toBeCloseTo(0.45, 9);
    expect(grainSlopeFactor(0.1)).toBeCloseTo(0.81, 9);
    expect(grainSlopeFactor(0)).toBe(1);
    expect(det(cs, 'handle-bow', 'overhanging end').limit).toBeCloseTo(ctx.d.oakDesignMorPsi * grainSlopeFactor(slope), 6);
    expect(byId(cs, 'handle-bow').status).toBe('pass');
  });
  // (the handle-sockets row lives in brake.ts with the foot brake rework, D-55: its post bending is tested in brake.test.ts)
});

describe('cargo capacity (the payload sweep)', () => {
  const cap = cargoCapacity(defaults);
  const notBrake = (id: string) => !id.startsWith('brake-') && id !== 'park-hold' && id !== 'handle-sockets'; // the step-brake rows are covered in brake.test.ts (D-57)
  it('D-58: with the roll pads, the oak tongue, the chain stops, the 1 in hangers and the wider clamp plates, the 200 lb cargo passes every row (capacity above the payload); what limits it first is the front axle beam bending (front-beam, 205 lb); no front-end row fails with an empty bed', () => {
    expect(cap.payloadLb).toBe(200);
    expect(cap.capacityLb).not.toBeNull();
    expect(cap.capacityLb!).toBeGreaterThanOrEqual(200);
    expect(cap.limiter).not.toBeNull();
    expect(cap.limiter!.id).toBe('front-beam'); // util 0.99 at 200 lb: the front beam was sized for 200 lb with no added mass (D-58)
    expect(cap.comfortableLb!).toBeGreaterThan(120);
    expect(cap.comfortableLb!).toBeLessThan(cap.capacityLb!);
    const fixed = cap.alwaysFailing.map((r) => r.id).filter(notBrake);
    for (const id of ['king-bearing', 'steer-stops', 'bridle-eye', 'lift', 'steer-clear']) expect(fixed).not.toContain(id);
    expect(cap.alwaysFailing.map((r) => r.id)).not.toContain(cap.limiter!.id);
    expect(cap.statusAtPayload).not.toBe('fail');
    expect(cap.counts.fail).toBe(cap.rows.filter((r) => r.statusAtPayload === 'fail').length);
  });
  it('the limiter flips from not-failing to failing across the capacity (within one 50 lb ladder step)', () => {
    const id = cap.limiter!.id;
    const at = (w: number) => byId(runChecks({ ...defaults, cargoPayloadLb: w }, { includeTruck: false }), id);
    expect(at(Math.max(0, cap.capacityLb! - 25)).statusCargo).not.toBe('fail');
    expect(at(cap.capacityLb! + 30).statusCargo).toBe('fail');
  });
  it('no row fails for the riders at the defaults, so the "other" capacity is the capacity and the front-end rows are not open', () => {
    expect(cap.limiterOther).not.toBeNull();
    for (const id of ['king-bearing', 'steer-stops', 'bridle-eye']) expect(cap.openIds).not.toContain(id);
    expect(cap.capacityOtherLb!).toBeGreaterThanOrEqual(cap.capacityLb!);
    expect(byId(cs, 'rear-beam-seat').statusCargo).not.toBe('fail'); // util 0.91 (marginal) at the 200 lb payload with the 7/8 in hanger
  });
  it('quotes the flat bed and the stow fit, and the rear-only traction when the foot brake rows provide it', () => {
    expect(cap.bed.widthIn).toBeCloseTo(2 * L.hwC, 9);
    expect(cap.stow.fits).toBe(true);
    if (cap.rearTraction !== null) expect(cap.rearTraction).toBeLessThan(1);
  });
  it('is cached by the design and does not depend on the rider masses', () => {
    expect(cargoCapacity({ ...defaults, riderMassLb: 100 })).toBe(cap);
  });
});
