/**
 * Cargo mode, analysis side (Phase 3c-2, D-53). Each number is re-derived by hand from the params, the layout and the model, not read back from the check code.
 * The cargo case sits next to the rider cases: it adds `cases.cargo` / `statusCargo` and never moves a rider status, a rider util or the rider sweep.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { buildModel } from '../model';
import { cargoBed } from '../model/bed';
import { worldAABB } from '../model/bounds';
import { bowGeometry } from '../model/handle';
import { computeLayout } from '../model/layout';
import { centerOfGravity, totalMass } from '../model/mass';
import { seatStowPlan } from '../model/seat-stow';
import { makeContext } from './context';
import { runChecks, type AnalysisCheck } from './index';
import { seatFactor } from './bump';
import { cargoCapacity } from './cargo-capacity';
import { lidLoads, strapLoads } from './cargo';
import { riderSweep } from './rider-sweep';
import { RAD } from './geometry';

const defaults = defaultParams();
const L = computeLayout(defaults);
const cs = runChecks(defaults, { includeTruck: false });
const byId = (c: AnalysisCheck[], id: string) => c.find((x) => x.id === id)!;
const det = (c: AnalysisCheck[], id: string, name: string) => byId(c, id).details!.find((d) => d.name.includes(name))!;
const installed = buildModel(defaults, { rider: 'goal', cargo: true, steerDeg: 0 });
const stowed = buildModel(defaults, { rider: 'none', cargo: false, steerDeg: 0, seat: 'stowed' });
const ctx = makeContext(defaults, installed, stowed);

describe('the parameter (D-53)', () => {
  it('is 250 lb, assumed, referenced to D-53, and says to confirm with Eric', async () => {
    const { PARAM_DEFS } = await import('../params');
    const d = PARAM_DEFS.cargoPayloadLb;
    expect(d.default).toBe(250);
    expect(d.status).toBe('assumed');
    expect(d.ref).toBe('D-53');
    expect(d.note).toMatch(/Confirm with Eric/);
    expect(PARAM_DEFS.cargoConcentratedLb.status).toBe('assumed');
  });
});

describe('the cargo load cases', () => {
  const [aft, fore] = ctx.loads.cargoCases;
  const bed = cargoBed(defaults, L);
  it('are two placements of the payload on the stowed cart with no rider: mass = stowed empty cart + 250 lb', () => {
    expect(ctx.loads.cargoCases).toHaveLength(2);
    for (const c of [aft, fore]) {
      expect(c.kind).toBe('cargo');
      expect(c.riderLb).toBe(0);
      expect(c.cargoLb).toBe(250);
      expect(c.massLb).toBeCloseTo(totalMass(stowed) + 250, 6);
    }
  });
  it('put the CG at the cargo height and lateral offset: z and y by the mass-weighted mean, x by the placement', () => {
    const m0 = totalMass(stowed), cg0 = centerOfGravity(stowed);
    const M = m0 + 250;
    const cz = L.deckTop + defaults.cargoCgHeightIn;
    expect(aft.cg[2]).toBeCloseTo((m0 * cg0[2] + 250 * cz) / M, 6);
    expect(aft.cg[1]).toBeCloseTo((m0 * cg0[1] + 250 * defaults.cargoCgOffsetYIn) / M, 6);
    const lenC = Math.min(defaults.cargoLoadLengthIn, bed.xLoadEnd - bed.x0);
    expect(aft.cg[0]).toBeCloseTo((m0 * cg0[0] + 250 * (bed.x0 + lenC / 2)) / M, 6);
    expect(fore.cg[0]).toBeCloseTo((m0 * cg0[0] + 250 * (bed.xLoadEnd - lenC / 2)) / M, 6);
    expect(fore.cg[0]).toBeGreaterThan(aft.cg[0]);
  });
  it('the stowed cart is a hair different from the installed one (the seat kit moved into the box), not the same list', () => {
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
    for (const id of ['tip-straight', 'brake-force', 'wheel-rating', 'axle-stress', 'rails', 'deck', 'joists', 'kingpin-bolt']) {
      const c = byId(cs, id);
      expect(c.cases?.cargo, id).toBeDefined();
      expect(c.statusCargo, id).toBe(c.cases!.cargo!.status);
      expect(c.utilCargo, id).toBeCloseTo(c.cases!.cargo!.util, 9);
    }
    for (const id of ['seat-back', 'seat-grip', 'foot-stop', 'turn-radius']) expect(byId(cs, id).cases?.cargo, id).toBeUndefined();
    expect(byId(off, 'wheel-rating').cases?.cargo).toBeUndefined();
  });
});

describe('brake hold on 15 degrees with the cargo instead of the rider', () => {
  it('handle force = W sin(theta) / mu / (ratio x eta) at the mud-fouled lining with W = the loaded cart, and still under 30 lbf', () => {
    const c = byId(cs, 'brake-force');
    const k = c.cases!.cargo!;
    const W = totalMass(stowed) + 250;
    const ratio = byId(cs, 'brake-ratio').value;
    const F = (W * Math.sin(defaults.designSlopeDeg * RAD)) / defaults.brakePadMuFouled / (ratio * defaults.brakeEfficiency);
    expect(k.value).toBeCloseTo(F, 6);
    expect(k.value).toBeLessThan(defaults.handleForceLimitLbf);
    expect(c.statusCargo).toBe('pass');
  });
  it('the members are loaded by the same loaded-cart weight: the beam stress scales with W against the goal rider case', () => {
    const c = byId(cs, 'brake-beam');
    const Wg = ctx.loads.goal.massLb, Wc = totalMass(stowed) + 250;
    expect(c.cases!.cargo!.value / c.cases!.goal!.value).toBeCloseTo(Wc / Wg, 2);
  });
  it('rear-only traction parked nose-down with the cargo forward is below 1 (info): the pullers or a chock hold the rest', () => {
    const k = byId(cs, 'brake-traction').cases!.cargo!;
    expect(k.value).toBeLessThan(1);
    const th = defaults.designSlopeDeg * RAD;
    const W = fore.massLb;
    const xfc = ctx.contact.wheelbaseIn;
    const Nr = W * (Math.cos(th) * (xfc - fore.cg[0]) / xfc - (Math.sin(th) * fore.cg[2]) / xfc);
    expect(k.value).toBeCloseTo((defaults.tireGroundMu * Nr) / (W * Math.sin(th)), 2);
  });
});
const fore = ctx.loads.cargoCases[1];

describe('tipping with the high cargo CG', () => {
  it('lateral tip = atan(d / h) with the CG at 12 in over the deck and 3 in off center: worse than the rider cases and still above 40 degrees', () => {
    const k = byId(cs, 'tip-straight').cases!.cargo!;
    expect(k.value).toBeLessThan(byId(cs, 'tip-straight').cases!.operating!.value);
    expect(k.value).toBeGreaterThan(defaults.tipStraightMinDeg);
    const c = ctx.loads.cargoCases.reduce((a, b) => (Math.abs(b.cg[1]) > Math.abs(a.cg[1]) ? b : a));
    const half = defaults.rearTrackIn / 2; // the rear wheels (the narrower pair edge)
    const deg = (Math.atan((half - Math.abs(c.cg[1])) / c.cg[2]) * 180) / Math.PI;
    expect(k.value).toBeLessThan(deg + 5); // the polygon edge nearest the CG is the front-rear side line, a bit inside the track
    expect(k.value).toBeGreaterThan(deg - 5);
  });
});

describe('the deck and joists under the cargo', () => {
  const bed = cargoBed(defaults, L);
  const g = seatFactor(ctx, ctx.loads.cargoCases[0]);
  it('deck, uniform load: 250 lb x g over the bed area on a 12 in strip, simply supported on the longest span: M = wL^2/8', () => {
    const q = (250 * g) / bed.areaIn2;
    const span = parseFloat(/largest crossmember span ([\d.]+)/.exec(byId(cs, 'deck').how)![1]);
    const t = defaults.deckPlyIn;
    const M = (q * 12 * span * span) / 8;
    const sigma = M / ((12 * t * t) / 6);
    expect(byId(cs, 'deck').detailsCargo!.find((d) => d.name === 'uniform cargo, bending')!.value).toBeCloseTo(sigma, 0);
    expect(byId(cs, 'deck').statusCargo).toBe('pass');
  });
  it('joists, uniform load: w = q x tributary, M = wL^2/8, sigma = M / S with the measured 0.75 x 1.75 in oak section', () => {
    const joists = installed.filter((x) => x.id.startsWith('joist-cabin-')).sort((a, b) => worldAABB(a).min[0] - worldAABB(b).min[0]);
    const bb = joists.map((x) => worldAABB(x));
    const span = Math.max(...bb.map((b) => b.max[1] - b.min[1]));
    const xs = bb.map((b) => (b.min[0] + b.max[0]) / 2);
    const edges = [L.xRear + L.transom, ...xs, L.xn];
    let trib = 0;
    for (let i = 1; i < edges.length - 1; i++) trib = Math.max(trib, (edges[i + 1] - edges[i - 1]) / 2);
    const S = (defaults.crossmemberThickIn * defaults.crossmemberDepthIn ** 2) / 6;
    const q = (250 * g) / bed.areaIn2;
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
  it('strap tension T = W (g / mu - 1) / (2 n sin 45) by hand: 250 lb, 0.8 g, mu 0.3, 3 straps -> 98.2 lbf, a third of a 300 lbf plate', () => {
    const k = strapLoads(ctx);
    expect(k.straps).toBe(3);
    expect(k.hold).toBeCloseTo(250 * (0.8 / 0.3 - 1), 9);
    expect(k.T).toBeCloseTo((250 * (0.8 / 0.3 - 1)) / (2 * 3 * Math.sin(Math.PI / 4)), 9);
    expect(k.T).toBeCloseTo(98.2, 1);
    const c = byId(cs, 'cargo-strap');
    expect(c.statusCargo).toBe('pass');
    expect(c.value).toBeCloseTo(98.2, 1);
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
  it('seat-stow passes at the defaults with the margins of the plan; fails when the seat is back at 12 in', () => {
    const c = byId(cs, 'seat-stow');
    const plan = seatStowPlan(defaults, L, installed);
    expect(c.status).toBe('pass');
    expect(det(cs, 'seat-stow', 'fore-aft').value).toBeCloseTo(plan.need.lengthIn, 9);
    expect(det(cs, 'seat-stow', 'across').limit).toBeCloseTo(plan.interior.y1 - plan.interior.y0, 9);
    expect(byId(runChecks({ ...defaults, seatXIn: 12 }, { includeTruck: false }), 'seat-stow').status).toBe('fail');
  });
  it('the 10 Essentials still pack into the box for race mode (storage-pack), with room', () => {
    const c = byId(cs, 'storage-pack');
    expect(c.status).toBe('pass');
    expect(c.value).toBeLessThan(0.9);
  });
});

describe('the handlebow row (D-39 socket loads unchanged)', () => {
  it('bow bending at the middle by hand: M = F L / 4 on the 2 x yPost span, sigma = 6 M / b^3, against oak design x the lamination curvature factor', () => {
    const bw = bowGeometry(defaults, L);
    const F = defaults.handleHoldbackLbf, span = 2 * bw.yPost, b = defaults.handleBarDiameterIn;
    const M = (F * span) / 4;
    expect(det(cs, 'handle-bow', 'middle pulling aft').value).toBeCloseTo((6 * M) / b ** 3, 6);
    const t = b / 4;
    const Cc = 1 - 2000 * (t / bw.radiusIn) ** 2;
    expect(det(cs, 'handle-bow', 'middle pulling aft').limit).toBeCloseTo(ctx.d.oakDesignMorPsi * Cc, 6);
    expect(byId(cs, 'handle-bow').status).toBe('pass');
  });
  it('the socket and post rows are what they were: handle-sockets passes, post bending 1,800-ish psi at the 34 in grip', () => {
    const c = byId(cs, 'handle-sockets');
    expect(c.status).toBe('pass');
    expect(det(cs, 'handle-sockets', 'post bending').value).toBeCloseTo((defaults.handleHoldbackLbf / 2) * (defaults.rearHandleHeightIn - (L.deckTop + L.sideH)) / ((defaults.handlePostWidthIn * defaults.handlePostThickIn ** 2) / 6), 0);
  });
});

describe('cargo capacity (the payload sweep)', () => {
  const cap = cargoCapacity(defaults);
  it('reports the capacity, its limiter and the rows that fail even with an empty bed (not cargo-limited)', () => {
    expect(cap.payloadLb).toBe(250);
    expect(cap.capacityLb).not.toBeNull();
    expect(cap.limiter).not.toBeNull();
    expect(cap.alwaysFailing.map((r) => r.id)).toContain('bellcrank'); // load independent: the sideways tongue pull
    expect(cap.alwaysFailing.map((r) => r.id)).not.toContain(cap.limiter!.id);
    expect(cap.statusAtPayload).toBe('fail');
    expect(cap.counts.fail).toBe(cap.rows.filter((r) => r.statusAtPayload === 'fail').length);
  });
  it('the limiter flips from not-failing to failing across the capacity (within one 50 lb ladder step)', () => {
    const id = cap.limiter!.id;
    const at = (w: number) => byId(runChecks({ ...defaults, cargoPayloadLb: w }, { includeTruck: false }), id);
    expect(at(Math.max(0, cap.capacityLb! - 25)).statusCargo).not.toBe('fail');
    expect(at(cap.capacityLb! + 30).statusCargo).toBe('fail');
  });
  it('leaving out the rows that already fail for the riders, the next limit is a different row at a higher load', () => {
    expect(cap.limiterOther).not.toBeNull();
    expect(cap.openIds).toContain('kingpin-bracket');
    expect(cap.capacityOtherLb!).toBeGreaterThan(cap.capacityLb!);
    expect(cap.openIds).not.toContain(cap.limiterOther!.id);
  });
  it('quotes the flat bed and the stow fit, and the rear-only traction', () => {
    expect(cap.bed.widthIn).toBeCloseTo(2 * L.hwC, 9);
    expect(cap.stow.fits).toBe(true);
    expect(cap.rearTraction).toBeLessThan(1);
  });
  it('is cached by the design and does not depend on the rider masses', () => {
    expect(cargoCapacity({ ...defaults, riderMassLb: 100 })).toBe(cap);
  });
});
