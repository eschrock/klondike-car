/**
 * Braking and handle checks for the STEP BRAKE (Phase 3c-4b, D-57 item 8; handle D-9/D-39): each number below is re-derived by hand from the params, the derived flap
 * geometry and the model's load cases, independently of the check code, then compared with the check's details. The numbers follow the layout (they are computed from
 * `brakeGeometry` and the model, not typed from a particular deck height).
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeCtx } from '../model/build-utils';
import { brakeGeometry } from '../model/brake';
import { handleGeometry } from '../model/handle';
import { makeContext } from './context';
import { brakeSweep, chockHold, loadsAt, loadsFromFoot, slowing } from './brake';
import { rearNormalNoseDown } from './stability';
import { contactsAt } from './geometry';
import { runChecks, type AnalysisCheck } from './index';

const defaults = defaultParams();
const RAD = Math.PI / 180;
const cs = runChecks(defaults, { includeTruck: false });
const byId = (c: AnalysisCheck[], id: string) => c.find((x) => x.id === id)!;
const det = (c: AnalysisCheck[], id: string, name: string) => byId(c, id).details!.find((d) => d.name.includes(name))!;
const mass = (p: Params, view: Parameters<typeof buildModel>[1]) => buildModel(p, view).reduce((s, x) => s + x.massLb, 0);
const run = (q: Partial<Params>) => runChecks({ ...defaults, ...q } as Params, { includeTruck: false });
const ctxOf = (p: Params) => makeContext(p, buildModel(p, { rider: 'goal', cargo: true }), buildModel(p, { rider: 'none', cargo: false, seat: 'stowed' }));

const g = (() => { const c = makeCtx(defaults); return brakeGeometry(c.p, c.L); })();
const W = mass(defaults, { rider: 'goal', cargo: true });
const W150 = mass(defaults, { rider: 'operating', cargo: true });
const sin15 = Math.sin(defaults.designSlopeDeg * RAD);
const muF = defaults.brakePadMuFouled; // the lower pad μ (0.25): the pass/fail case

/** Raw moment about the hinge pin of a force (fx, fz) at point q: M = rz fx − rx fz (positive raises a point behind the pin). */
const mom = (q: [number, number], f: [number, number]) => (q[1] - g.H[1]) * f[0] - (q[0] - g.H[0]) * f[1];
/** Foot force per foot by hand for a cart of weight w at pad friction mu, both flaps pressed, cart rolling in direction sigma. */
const nHat: [number, number] = [-Math.sin(g.alpha), Math.cos(g.alpha)], tHat: [number, number] = [Math.cos(g.alpha), Math.sin(g.alpha)];
const footByHand = (w: number, mu: number, sigma: 1 | -1) => {
  const nFlap = (w * sin15) / (2 * mu);
  const lever = -mom(g.F, [0, -1]); // moment arm of a unit downward foot force: the horizontal pin-to-foot distance
  const mn = mom(g.C, nHat) , mt = mom(g.C, tHat);
  return (nFlap * (mn + sigma * mu * mt)) / (lever * defaults.brakeEfficiency) + g.bungee.mApp / lever;
};

describe('brake foot-lever ratio and foot force', () => {
  it('brake-ratio is the derived critical-direction ratio, above the ~2:1 target and passes; the stroke, the foot height and the reach to the transom are checked', () => {
    const c = byId(cs, 'brake-ratio');
    expect(c.value).toBeCloseTo(g.ratioCrit, 9);
    expect(c.value).toBeGreaterThan(defaults.brakeLeverRatio);
    expect(c.value).toBeGreaterThan(1.9);
    expect(c.value).toBeLessThan(2.6);
    expect(c.limit).toBe(defaults.brakeLeverRatio);
    expect(c.status).toBe('pass');
    expect(det(cs, 'brake-ratio', 'rolling forward').value).toBeCloseTo(g.ratioFwd, 9);
    expect(det(cs, 'brake-ratio', 'rolling backward').value).toBeCloseTo(g.ratioRev, 9);
    expect(det(cs, 'brake-ratio', 'foot stroke').value).toBeCloseTo(g.footDrop, 9);
    expect(det(cs, 'brake-ratio', 'foot stroke').limit).toBe(defaults.brakeFootStrokeMaxIn);
    expect(det(cs, 'brake-ratio', 'foot area height').limit).toBe(defaults.brakeFootHeightMaxIn);
    expect(det(cs, 'brake-ratio', 'transom face').value).toBeGreaterThan(0);
    expect(c.how).toMatch(/Derived from the flap geometry/);
  });
  it('the ratio is geometry, not an input: moving the pad back or the hinge ahead lowers it until brake-ratio fails (target not met)', () => {
    expect(byId(run({ brakePadAngleDeg: 35 }), 'brake-ratio').value).toBeLessThan(byId(cs, 'brake-ratio').value);
    expect(byId(run({ brakeHingeAheadIn: 4 }), 'brake-ratio').value).toBeLessThan(byId(cs, 'brake-ratio').value);
    expect(byId(run({ brakeLeverRatio: 3 }), 'brake-ratio').status).not.toBe('pass');
    expect(byId(run({ brakeFootStrokeMaxIn: 0.5 }), 'brake-ratio').status).toBe('fail');
  });
  it('hand calc: F = N (m_N ± μ m_T) / (a_F η) + M_B / a_F at BOTH the wet pad μ and the mud-fouled μ (worse rolling direction), for the rider and cargo cases', () => {
    const f = byId(cs, 'brake-force');
    for (const [kind, w] of [['operating', W150], ['goal', W]] as const) {
      const fouled = Math.max(footByHand(w, defaults.brakePadMuFouled, 1), footByHand(w, defaults.brakePadMuFouled, -1));
      const wet = Math.max(footByHand(w, defaults.brakePadMu, 1), footByHand(w, defaults.brakePadMu, -1));
      expect(f.cases![kind]!.value, kind).toBeCloseTo(Math.max(fouled, wet), 6);
      expect(fouled, kind).toBeGreaterThan(wet);
    }
    const wCargo = mass(defaults, { seat: 'stowed', cargo: true });
    const hand = Math.max(footByHand(wCargo, muF, 1), footByHand(wCargo, muF, -1));
    expect(f.cases!.cargo!.value / hand).toBeGreaterThan(0.95);
    expect(f.cases!.cargo!.value / hand).toBeLessThan(1.05);
  });
  it('INFO (Eric, D-58): the 15 degree HOLD force (85 / 98 / 104 lbf per foot against a 90 lbf yardstick) is reported but does not light anything: the step brake is a "just in case" slowing brake and brake-slow is the pass/fail row', () => {
    const f = byId(cs, 'brake-force');
    expect(f.cases!.operating!.limit).toBe(90);
    expect(f.group).toBe('Braking');
    expect(f.cases!.operating!.value).toBeGreaterThan(75);
    expect(f.cases!.operating!.value).toBeLessThan(90);
    expect(f.cases!.goal!.value).toBeGreaterThan(90); // the numbers are unchanged and still shown ...
    expect(f.cases!.cargo!.value).toBeGreaterThan(f.cases!.operating!.value);
    for (const k of ['operating', 'goal', 'cargo'] as const) expect(f.cases![k]!.status, k).toBe('info'); // ... but no case is pass / marginal / fail
    expect(f.status).toBe('info');
    expect(f.label).toMatch(/\(info\)/);
    expect(f.how).toMatch(/one foot on each/);
    expect(f.how).toMatch(/Only the rear wheels brake/);
  });
  it('the foot-force limit and the pad mu still move the numbers (info row): a 30 lbf yardstick or a 120 lbf one never fails; a fouled mu of 0.15 raises the force', () => {
    for (const lim of [30, 120]) {
      const r = byId(run({ brakeFootForceLimitLbf: lim }), 'brake-force');
      expect(r.status).toBe('info');
      for (const k of ['operating', 'goal', 'cargo'] as const) expect(r.cases![k]!.status, `${lim} ${k}`).toBe('info');
    }
    expect(byId(run({ brakePadMuFouled: 0.15 }), 'brake-force').cases!.operating!.value).toBeGreaterThan(byId(cs, 'brake-force').cases!.operating!.value);
  });
  it('brake-traction (info): rear-only locked, parked nose-down: μ_ground N_r / (W sinθ); the front wheels roll free', () => {
    const c = byId(cs, 'brake-traction');
    expect(c.status).toBe('info');
    expect(c.cases!.goal!.value).toBeGreaterThan(0.5);
    expect(c.how).toMatch(/no front brakes/i);
  });
});

describe('brake-slow: the flaps SLOW the loaded cart on 15° and STOP it on gentler grades (D-57)', () => {
  const ctx = ctxOf(defaults);
  const row = byId(cs, 'brake-slow');
  it('hand calc of the steepest grade held at the limit foot force (one foot per flap, fouled pad), re-derived from the moments, and the rear tires\' traction limit alongside (info)', () => {
    const ev = (w: number, cg: [number, number, number], feet = 2) => {
      const lever = g.H[0] - g.F[0];
      const nFlap = Math.min(...[1, -1].map((s) => ((defaults.brakeFootForceLimitLbf * lever - g.bungee.mApp) * defaults.brakeEfficiency) / (mom(g.C, nHat) + s * muF * mom(g.C, tHat))));
      const pad = feet * muF * nFlap;
      const ct = contactsAt(ctx.contact, 0);
      const xfc = (ct.FL[0] + ct.FR[0]) / 2;
      const nr = (a: number) => Math.max(0, rearNormalNoseDown(w, cg[0], cg[2], a, xfc));
      let lo = 0, hi = Math.PI / 4;
      for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (defaults.tireGroundMu * nr(m) >= w * Math.sin(m)) lo = m; else hi = m; }
      return { grade: Math.asin(Math.min(1, pad / w)) / RAD, trac: (lo + hi) / 2 / RAD };
    };
    const op = ctx.loads.operating, goal = ctx.loads.goal;
    expect(row.cases!.operating!.value).toBeCloseTo(ev(op.massLb, op.cg).grade, 4);
    expect(row.cases!.goal!.value).toBeCloseTo(ev(goal.massLb, goal.cg).grade, 4);
    expect(det(cs, 'brake-slow', 'INFO: steepest grade the rear tires').value).toBeCloseTo(ev(op.massLb, op.cg).trac, 4);
    const s = slowing(ctx, op, g, true);
    expect(s.grade).toBeCloseTo(row.cases!.operating!.value, 6);
    expect(slowing(ctx, op, g, false).grade).toBeLessThan(s.grade); // one foot holds less
  });
  it('STOPS on gentler grades: the 150 lb and 200 lb riders are held past the 10° stop grade; it SLOWS on 15°: the flaps take more than half of the downhill pull', () => {
    expect(row.limit).toBe(defaults.brakeStopSlopeDeg);
    for (const k of ['operating', 'goal'] as const) expect(row.cases![k]!.status, k).toBe('pass');
    expect(row.cases!.operating!.value).toBeGreaterThan(defaults.brakeStopSlopeDeg + 2);
    expect(det(cs, 'brake-slow', 'SLOWS').value).toBeGreaterThan(defaults.brakeSlowShareMin);
    expect(row.how).toMatch(/STOPS on gentler grades/);
    expect(row.how).toMatch(/SLOWS/);
  });
  it('the cargo case (200 lb on the bed, no rider) is held past the 10 degree stop grade, and a heavier 250 lb payload is held on a shallower grade; the rear-only traction limit is info, as in brake-traction (D-24)', () => {
    expect(row.cases!.cargo!.value).toBeGreaterThan(defaults.brakeStopSlopeDeg);
    expect(byId(run({ cargoPayloadLb: 250 }), 'brake-slow').cases!.cargo!.value).toBeLessThan(row.cases!.cargo!.value);
    const tr = row.detailsCargo!.find((d) => /INFO: steepest grade the rear tires/.test(d.name))!;
    expect(tr).toBeDefined();
    expect(tr.limit).toBe(0);
    expect(Number.isFinite(tr.value)).toBe(true);
    expect(byId(cs, 'brake-traction').cases!.cargo!.value).toBeLessThan(1); // parked nose-down the rear tires alone hold under half of the cargo cart's pull
  });
  it('a bigger foot limit holds a steeper grade until the traction cap; a lower pad μ holds less', () => {
    expect(byId(run({ brakeFootForceLimitLbf: 60 }), 'brake-slow').cases!.operating!.value).toBeLessThan(row.cases!.operating!.value);
    expect(byId(run({ brakePadMuFouled: 0.15 }), 'brake-slow').cases!.operating!.value).toBeLessThan(row.cases!.operating!.value);
  });
});

describe('brake members (hand calculations at the goal rider, load factor 2)', () => {
  const ctx = ctxOf(defaults);
  const goal = ctx.loads.goal;
  const L = loadsAt(ctx, goal, g);
  const lam = defaults.brakeLoadFactor;
  const muH = Math.min(defaults.brakePadMu, defaults.brakePadMuFouled);
  const lever = g.H[0] - g.F[0];
  it('statics: the pad, friction, bungee and foot forces balance their moments about the pin; the force on the knee is minus the hinge reaction on the flap', () => {
    expect(L.nFlap).toBeCloseTo((lam * goal.massLb * sin15) / (2 * muH), 6);
    const M = mom(g.C, L.fN) + mom(g.C, L.fF) + mom(g.bungee.E, L.fB) + mom(g.F, L.fFoot);
    expect(Math.abs(M)).toBeLessThan(1e-6);
    // pad force is along the tread normal, friction is σ μ N along the forward tangent
    expect(L.fN[0]).toBeCloseTo(nHat[0] * L.nFlap, 9);
    expect(L.fF[1]).toBeCloseTo(tHat[1] * L.sigma * muH * L.nFlap, 9);
    expect(L.foot).toBeCloseTo((L.nFlap * (mom(g.C, nHat) + L.sigma * muH * mom(g.C, tHat)) + g.bungee.mApp) / lever, 6);
    // the knee carries the whole sum: Rk = N n + friction + bungee + foot
    expect(L.Rk[0]).toBeCloseTo(L.fN[0] + L.fF[0] + L.fB[0], 9);
    expect(L.Rk[1]).toBeCloseTo(L.fN[1] + L.fF[1] + L.fB[1] - L.foot, 9);
    expect(L.Rmag).toBeCloseTo(Math.hypot(...L.Rk), 9);
    expect(L.Rk[1]).toBeGreaterThan(0); // the flap pulls the knee UP (the hinge is in tension)
  });
  it('hinge pin double shear and the knee-leaf screw withdrawal follow from that reaction (NDS 1380 G² D L C_M)', () => {
    const pin = L.Rmag / (2 * (Math.PI / 4) * defaults.brakeHingePinDiaIn ** 2);
    expect(det(cs, 'brake-hinge', 'pin double shear').value).toBeCloseTo(pin, 3);
    const pen = defaults.brakeHingeScrewLenIn - 0.1 - 0.1;
    const w1 = 1380 * defaults.oakSpecificGravity ** 2 * defaults.brakeHingeScrewDiaIn * pen * 0.7;
    const dd = det(cs, 'brake-hinge', 'knee leaf screws, withdrawal each');
    expect(dd.limit).toBeCloseTo(w1, 6);
    expect(dd.value).toBeCloseTo(Math.max(0, L.Rk[1]) / defaults.brakeHingeScrewsPerLeaf, 6);
    expect(byId(cs, 'brake-hinge').status).toBe('pass');
  });
  it('flap bending at the pad: M from the foot force and the bungee across the board, σ = M/S against the design oak MOR', () => {
    const v = g.v;
    const sC = (g.C[0] - g.H[0]) * g.u[0] + (g.C[1] - g.H[1]) * g.u[1], sF = (g.F[0] - g.H[0]) * g.u[0] + (g.F[1] - g.H[1]) * g.u[1];
    const sE = (g.bungee.E[0] - g.H[0]) * g.u[0] + (g.bungee.E[1] - g.H[1]) * g.u[1];
    const tF = Math.abs(L.fFoot[1] * v[1]); // the foot force is vertical
    const tB = L.fB[0] * v[0] + L.fB[1] * v[1];
    const M = Math.abs(tF * (sF - sC) - tB * (sE - sC));
    expect(M).toBeGreaterThan(300);
    const S = (defaults.brakeFlapWidthIn * defaults.brakeFlapThickIn ** 2) / 6;
    const d = det(cs, 'brake-flap', 'flap bending').value;
    expect(d).toBeGreaterThan(M / S * 0.95);
    expect(d).toBeLessThan(M / S * 1.3); // plus the small friction eccentricity and axial terms
    expect(det(cs, 'brake-flap', 'pad contact pressure').value).toBeCloseTo(L.nFlap / (defaults.brakePadLengthIn * Math.min(defaults.brakePadWidthIn, defaults.tireWidthIn - 0.3)), 6);
    expect(det(cs, 'brake-flap', 'shoe block screws').value).toBeCloseTo((L.mu * L.nFlap) / 2, 6);
    expect(byId(cs, 'brake-flap').status).toBe('pass');
  });
  it('mount bolts: direct shear + twist about the bolt group, tension from the overturning couple; bearing in the rail and backer; the knee is bolted into the rail, not the side panel', () => {
    const bt = g.bolts;
    expect(bt.count).toBe(4);
    const pts = bt.xs.flatMap((x) => bt.zs.map((z): [number, number] => [x, z]));
    const r2 = pts.map(([x, z]) => (x - bt.cx) ** 2 + (z - bt.cz) ** 2);
    const rel: [number, number] = [g.xh - bt.cx, g.knee.zTop - bt.cz];
    const Mpl = Math.abs(rel[1] * L.Rk[0] - rel[0] * L.Rk[1]);
    const V = L.Rmag / 4 + (Mpl * Math.sqrt(Math.max(...r2))) / r2.reduce((a, b) => a + b, 0);
    const shear = det(cs, 'brake-mount', 'mounting bolt shear, worst bolt').value;
    expect(shear).toBeCloseTo(V / ((Math.PI / 4) * defaults.brakeMountBoltDiaIn ** 2), 3);
    const tComp = Math.min(g.knee.legT, g.rail.t + g.backer.t);
    expect(det(cs, 'brake-mount', 'bolt bearing').value).toBeCloseTo(V / (defaults.brakeMountBoltDiaIn * tComp), 3);
    expect(det(cs, 'brake-mount', 'mounting bolt tension').value).toBeGreaterThan(0);
    expect(byId(cs, 'brake-mount').status).toBe('pass');
    expect(byId(cs, 'brake-mount').group).toBe('Structure');
    expect(byId(cs, 'brake-mount').how).toMatch(/rail/);
    // fewer or smaller bolts take more load per bolt
    expect(det(run({ brakeMountBoltColumns: 1 }), 'brake-mount', 'mounting bolt shear').value).toBeGreaterThan(shear);
  });
  it('the return set: the released bungee torque over the weight torque of the flap group (the stop cord takes the difference), cord and eye loads', () => {
    const r = byId(cs, 'brake-return');
    expect(r.status).toBe('pass');
    const lift = det(cs, 'brake-return', 'bungee torque').value;
    expect(lift).toBeGreaterThanOrEqual(defaults.brakeReturnLiftMargin);
    expect(det(cs, 'brake-return', 'bungee tension').value).toBeCloseTo(g.bungee.tApp, 9);
    expect(det(cs, 'brake-return', 'bungee tension').limit).toBeCloseTo(defaults.brakeCordBreakLbf / defaults.brakeCordSafetyFactor, 9);
    // a weak bungee cannot lift the flap group
    expect(byId(run({ brakeBungeeTensionLbf: 1 }), 'brake-return').status).toBe('fail');
  });
});

describe('brake abuse: a foot stomp on one flap (yield level)', () => {
  it('the pad force follows from the moment balance in the direction that gives the larger force, the checks run at yield level, and the brake survives', () => {
    const ctx = ctxOf(defaults);
    const L = loadsFromFoot(ctx, g, defaults.brakeFootAbuseLbf);
    const lever = g.H[0] - g.F[0];
    const best = [1, -1].map((s) => ((defaults.brakeFootAbuseLbf * lever - g.bungee.mApp) * defaults.brakeEfficiency) / (mom(g.C, nHat) + s * defaults.brakePadMu * mom(g.C, tHat)));
    expect(L.nFlap).toBeCloseTo(Math.max(...best), 6);
    expect(L.Rk[1]).toBeGreaterThan(0);
    const c = byId(cs, 'brake-abuse');
    expect(c.group).toBe('Structure');
    expect(c.status).toBe('pass');
    expect(c.details!.length).toBeGreaterThan(15);
    expect(c.details!.some((d) => /^hinge:/.test(d.name))).toBe(true);
    expect(c.details!.some((d) => /^mount:/.test(d.name))).toBe(true);
    expect(c.how).toMatch(/ONE flap/);
    // a 400 lbf stomp on a flap that is only a 5/4 oak board and four hinge screws no longer survives
    expect(byId(run({ brakeFootAbuseLbf: 300, brakeHingeScrewsPerLeaf: 2 }), 'brake-abuse').status).not.toBe('pass');
  });
});

describe('park-hold: the wheel chocks and the wheels hold the cart on the design slope (D-57)', () => {
  const ctx = ctxOf(defaults);
  const row = byId(cs, 'park-hold');
  it('hand calc of the climb and slide margins for the 150 lb rider, nose-down on 15° with a chock at each rear tire', () => {
    const c = ctx.loads.operating;
    const th = defaults.designSlopeDeg * RAD;
    const ct = contactsAt(ctx.contact, 0);
    const xfc = (ct.FL[0] + ct.FR[0]) / 2;
    const P = c.massLb * Math.sin(th) - defaults.parkRollingResistance * c.massLb * Math.cos(th);
    const Nr = rearNormalNoseDown(c.massLb, c.cg[0], c.cg[2], th, xfc);
    const need = P / 2 / (Nr / 2);
    const psi = defaults.brakeChockAngleDeg * RAD;
    const wC = ctx.parts.find((x) => x.id === 'brake-chock-L')!.massLb;
    const Q = P / 2 / Math.sin(psi);
    const muReq = (P / 2 + wC * Math.sin(th)) / (Q * Math.cos(psi) + wC * Math.cos(th));
    const h = chockHold(ctx, c, defaults.brakeChockMu);
    expect(h.tanNeed).toBeCloseTo(need, 9);
    expect(h.muReq).toBeCloseTo(muReq, 9);
    expect(h.climb).toBeCloseTo(Math.tan(psi) / need, 9);
    expect(h.slide).toBeCloseTo(defaults.brakeChockMu / muReq, 9);
    expect(row.cases!.operating!.value).toBeCloseTo(Math.min(h.climb, h.slide), 6);
    // the slide requirement is essentially tan ψ, independent of the load
    expect(muReq).toBeGreaterThan(Math.tan(psi) * 0.95);
    expect(muReq).toBeLessThan(Math.tan(psi) * 1.15);
  });
  it('the chocks hold the rider cases on dirt or gravel (the design ground μ), with the wedge angle between the climb limit and the slide limit; the cord, bearing and reach are checked', () => {
    expect(row.group).toBe('Braking');
    expect(row.cases!.operating!.status).not.toBe('fail');
    expect(row.cases!.goal!.status).not.toBe('fail');
    expect(det(cs, 'park-hold', 'climb margin').value).toBeGreaterThan(1);
    expect(det(cs, 'park-hold', 'design ground').value).toBeGreaterThan(1);
    expect(det(cs, 'park-hold', 'cord length').value).toBeGreaterThan(1);
    expect(det(cs, 'park-hold', 'chock face bearing').value).toBeLessThan(det(cs, 'park-hold', 'chock face bearing').limit);
    expect(det(cs, 'park-hold', 'cord load if the cart drags').value).toBeLessThan(1);
  });
  it('HONEST REPORT: on wet or fouled ground the chock slides (flagged in the details), and in the cargo case (rear tires unloaded by the forward payload) the wheel climbs the chock: the cargo case is reported (info), not judged', () => {
    expect(det(cs, 'park-hold', 'wet / fouled ground').value).toBeLessThan(1);
    expect(row.cases!.cargo!.value).toBeLessThan(1);
    expect(row.statusCargo).toBe('info');
    expect(row.how).toMatch(/will NOT hold the loaded cart there/);
  });
  it('one chock alone cannot hold the slope (the whole load on one wheel); a shallow ramp lets the wheel climb, a steep ramp slides', () => {
    expect(byId(run({ brakeChockCount: 1 }), 'park-hold').cases!.operating!.value).toBeLessThan(row.cases!.operating!.value);
    expect(byId(run({ brakeChockCount: 1 }), 'park-hold').cases!.operating!.status).toBe('fail');
    expect(byId(run({ brakeChockAngleDeg: 18 }), 'park-hold').cases!.operating!.status).toBe('fail'); // climbs
    expect(byId(run({ brakeChockAngleDeg: 45 }), 'park-hold').cases!.operating!.status).toBe('fail'); // slides
    expect(byId(run({ brakeChockMu: 0.8 }), 'park-hold').cases!.operating!.value).toBeGreaterThanOrEqual(row.cases!.operating!.value);
  });
});

describe('brake clearance over the stroke', () => {
  const ctx = ctxOf(defaults);
  it('the moving flap group clears the hull, rails, transom and the rest over the stroke; the board and shoe clear the tire; the pad lands on the tread; the hinge gap stays open', () => {
    const sw = brakeSweep(ctx);
    const row = byId(cs, 'brake-clear');
    expect(row.status).toBe('pass');
    expect(sw.minClearanceIn).toBeGreaterThanOrEqual(defaults.brakeClearanceIn);
    expect(sw.boardTireGapIn).toBeGreaterThanOrEqual(defaults.brakeClearanceIn);
    expect(sw.padGapReleasedIn).toBeGreaterThan(0.5 * defaults.brakePadGapIn);
    expect(Math.abs(sw.padGapAppliedIn)).toBeLessThan(0.03);
    expect(sw.hingeGapIn).toBeCloseTo(0.125, 3); // the designed gap at the applied pose; it opens as the flap lifts
    expect(sw.groundMinZ).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn);
    expect(det(cs, 'brake-clear', 'knee bottom').value).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn);
    expect(det(cs, 'brake-clear', 'sign zone').value).toBeGreaterThanOrEqual(0);
    expect(sw.poses).toBe(9);
  });
  it('a lower deck takes the knee below the ground clearance and the row fails; a smaller gap setting is checked against the tire', () => {
    expect(byId(run({ minGroundClearanceIn: 5 }), 'brake-clear').status).toBe('fail');
    expect(byId(run({ brakeClearanceIn: 0.4 }), 'brake-clear').status).toBe('fail');
  });
});

describe('rows and groups', () => {
  it('the old drag-bar rows are gone and the new ones exist in their groups; the handle-sockets row is still there and unchanged in kind', () => {
    for (const gone of ['brake-lever', 'brake-links', 'brake-beam', 'brake-shoes']) expect(cs.some((c) => c.id === gone), gone).toBe(false);
    const groups: Record<string, string> = {
      'brake-ratio': 'Braking', 'brake-force': 'Braking', 'brake-slow': 'Braking', 'brake-traction': 'Braking', 'brake-clear': 'Braking', 'park-hold': 'Braking',
      'brake-flap': 'Structure', 'brake-hinge': 'Structure', 'brake-mount': 'Structure', 'brake-return': 'Structure', 'brake-abuse': 'Structure', 'handle-sockets': 'Structure',
    };
    for (const [id, grp] of Object.entries(groups)) expect(byId(cs, id).group, id).toBe(grp);
    const h = handleGeometry(defaults, makeCtx(defaults).L);
    expect(byId(cs, 'handle-sockets').status).toBe('pass');
    expect(byId(cs, 'handle-sockets').how).toMatch(/hold-back pull at the grip/);
    expect(h.zTop).toBeGreaterThan(0);
  });
  it('the member rows carry the cargo case next to the rider cases', () => {
    for (const id of ['brake-force', 'brake-slow', 'brake-flap', 'brake-hinge', 'brake-mount', 'park-hold']) expect(byId(cs, id).cases!.cargo, id).toBeDefined();
  });
  it('every row is finite and its `how` is non-empty', () => {
    for (const id of ['brake-ratio', 'brake-force', 'brake-slow', 'brake-clear', 'brake-flap', 'brake-hinge', 'brake-mount', 'brake-return', 'park-hold', 'brake-abuse']) {
      const c = byId(cs, id);
      expect(Number.isFinite(c.value), id).toBe(true);
      expect(c.how.length, id).toBeGreaterThan(40);
      for (const d of c.details ?? []) expect(Number.isFinite(d.value), `${id}: ${d.name}`).toBe(true);
    }
  });
});
