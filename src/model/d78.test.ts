/**
 * D-78: the optional removable brake knee on quick-release pins (`kneeMount` = pins). Default (bolted) behavior is unchanged and covered by the older tests; this file checks both
 * settings side by side and the pins setting in detail: the parts, the geometry derived from the hull, the overlaps, the mass, the no-fabrication rule, the removable kit and Transport
 * mode, the joints and the validators.
 */
import { describe, expect, it } from 'vitest';
import { buildModel } from '.';
import { KNEE_MOUNT, PARAM_DEFS, defaultParams, validateParams, type Params } from '../params';
import { buildBrakeAt } from './brake';
import { makeCtx } from './build-utils';
import { brakeGeometry, brakePinIssues } from './brake-layout';
import { partsOverlap, transformPoint, worldAABB } from './bounds';
import { fastenerBreakdown } from './lighting';
import { boltLength } from './rear-mount';
import { totalMass } from './mass';
import { noFabViolations } from './no-fab';
import { BRAKE_KIT_RE, TRANSPORT_VIEW, isBrakeKit } from './removable';
import { boxTieGeometry, sideRibStations } from './side-ribs';
import type { Part, PartGroup } from './types';

const p0 = defaultParams();
const pp = { ...p0, kneeMount: KNEE_MOUNT.pins } as Params;
const bolted = buildModel(p0);
const pinned = buildModel(pp);
const ctx = makeCtx(pp);
const g = brakeGeometry(ctx.p, ctx.L);
const pn = g.pins!;
const get = (id: string, ps: Part[] = pinned): Part => ps.find((x) => x.id === id)!;
const ids = (ps: Part[]) => new Set(ps.map((x) => x.id));
const SIDE_TAGS = ['L', 'R'] as const;
const KNEE_SIDE_PARTS = ['brake-tab', 'brake-pin-B', 'brake-pin-T', 'brake-sleeve-B-knee', 'brake-sleeve-T-tab'];
const HULL_SLEEVES = ['brake-sleeve-B-hull', 'brake-sleeve-T-hull'];
const NEW_PARTS = [...KNEE_SIDE_PARTS, ...HULL_SLEEVES];
const SOLID: PartGroup[] = ['frame', 'body', 'front-end', 'running-gear', 'seat', 'storage', 'brake', 'removable', 'lighting', 'hardware'];

/** Pairs of parts whose boxes overlap by more than the model tests' tolerance. */
function overlapPairs(parts: Part[]): Set<string> {
  const solid = parts.filter((x) => !x.payload && SOLID.includes(x.group));
  const out = new Set<string>();
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) if (partsOverlap(solid[i], solid[j]) > 0.05) out.add([solid[i].id, solid[j].id].sort().join(' x '));
  return out;
}
/** Contacts that are meant: a sleeve or a pin lies INSIDE the holes of the parts it goes through (the model's boxes have no holes). */
const HOST: RegExp[] = [
  /^brake-sleeve-B-hull-[LR] x rail-[LR]$/, /^brake-pin-B-[LR] x rail-[LR]$/,
  /^brake-sleeve-T-hull-[LR] x side-[LR]-web$/, /^brake-sleeve-T-hull-[LR] x side-rib-[LR]1$/, /^brake-pin-T-[LR] x side-rib-[LR]1$/, /^brake-pin-T-[LR] x side-[LR]-web$/,
  /^brake-knee-[LR] x brake-sleeve-B-knee-[LR]$/, /^brake-knee-[LR] x brake-pin-B-[LR]$/,
  /^brake-sleeve-T-tab-[LR] x brake-tab-[LR]$/, /^brake-pin-T-[LR] x brake-tab-[LR]$/,
  /^brake-pin-B-[LR] x brake-sleeve-B-(hull|knee)-[LR]$/, /^brake-pin-T-[LR] x brake-sleeve-T-(hull|tab)-[LR]$/,
];
const isHost = (k: string) => HOST.some((r) => r.test(k) || r.test(k.split(' x ').reverse().join(' x ')));
const newClashes = (a: Part[], b: Part[]) => {
  const base = overlapPairs(a);
  return [...overlapPairs(b)].filter((k) => !base.has(k) && !isHost(k));
};

describe('D-78 the setting', () => {
  it('kneeMount is an options param, default bolted (0), pins is 1, with a status, a note and the D-78 reference', () => {
    const d = PARAM_DEFS.kneeMount;
    expect(d.default).toBe(KNEE_MOUNT.bolted);
    expect(d.options!.map((o) => o.value)).toEqual([0, 1]);
    expect(d.ref).toContain('D-78');
    for (const k of ['kneeMount', 'brakeTabThickIn', 'brakeTabHeightIn', 'brakeTabEndIn', 'brakeTabClearIn', 'brakePinDiaIn', 'brakeSleeveOdIn', 'brakeSleeveIdIn', 'brakeTopPinClearIn', 'brakePinEdgeIn', 'brakePinTipIn', 'brakePinHeadIn', 'brakePinHeadLb'] as const) {
      expect(PARAM_DEFS[k].status, k).toBeDefined();
      expect(PARAM_DEFS[k].note, k).toBeTruthy();
      expect(PARAM_DEFS[k].ref, k).toContain('D-78');
    }
    expect(PARAM_DEFS.brakeTabThickIn.default).toBe(1);
    expect(PARAM_DEFS.brakePinDiaIn.default).toBe(0.375);
    expect(PARAM_DEFS.brakeSleeveOdIn.default).toBe(0.5);
  });
  it('the default is the bolted knee: no pin parts, no pin geometry, the four bolts, the backer and the backing plate are all there, and nothing of the knee is removable', () => {
    expect(p0.kneeMount).toBe(0);
    const b0 = brakeGeometry(makeCtx(p0).p, makeCtx(p0).L);
    expect(b0.mount).toBe('bolted');
    expect(b0.pins).toBeUndefined();
    const have = ids(bolted);
    for (const t of SIDE_TAGS) {
      for (const n of NEW_PARTS) expect(have.has(`${n}-${t}`), `${n}-${t}`).toBe(false);
      for (const n of ['brake-knee', 'brake-strap', 'brake-backer', 'brake-backplate']) expect(have.has(`${n}-${t}`), `${n}-${t}`).toBe(true);
    }
    expect(get('brake-knee-L', bolted).removable ?? false).toBe(false);
    expect(get('brake-strap-L', bolted).removable ?? false).toBe(false);
    expect(get('rail-L', bolted).joints!.find((j) => j.type === 'hole' && j.to === 'brake-knee-L')!.count).toBe(4);
    expect(buildModel({ ...p0, kneeMount: KNEE_MOUNT.bolted } as Params).map((x) => x.id)).toEqual(bolted.map((x) => x.id));
  });
});

describe('D-78 the parts with the pins on', () => {
  it('seven new parts per side (tab, two pins, four sleeves); no backer, backing plate or knee bolts; the knee and strap stay', () => {
    const have = ids(pinned);
    for (const t of SIDE_TAGS) {
      for (const n of NEW_PARTS) expect(have.has(`${n}-${t}`), `${n}-${t}`).toBe(true);
      for (const n of ['brake-backer', 'brake-backplate']) expect(have.has(`${n}-${t}`), `${n}-${t}`).toBe(false);
      for (const n of ['brake-knee', 'brake-strap']) expect(have.has(`${n}-${t}`), `${n}-${t}`).toBe(true);
    }
    expect(pinned.length - bolted.length).toBe(2 * (NEW_PARTS.length - 2)); // +14 new, -4 (two backers, two backing plates)
    expect(new Set(pinned.map((x) => x.id)).size).toBe(pinned.length);
    expect(g.mount).toBe('pins');
    const kj = get('brake-knee-L').joints!;
    expect(kj.some((j) => j.type === 'bolt')).toBe(false);
    expect(kj.some((j) => j.type === 'glue' && j.to === 'rail-L')).toBe(false); // the knee is not glued to the hull: it lifts off
    for (const j of get('rail-L').joints!) expect(j.type === 'hole' && j.to === 'brake-knee-L', 'no bolt holes in the rail').toBe(false);
    const rh = get('rail-L').joints!.filter((j) => j.type === 'hole' && /^brake-sleeve/.test(j.to));
    expect(rh.filter((j) => !j.cut)).toHaveLength(1);
    expect(rh.filter((j) => j.cut?.kind === 'counterbore')).toHaveLength(1); // the flange recess in the rail's inner face
    expect(rh[0].count).toBe(1); // ONE pin hole instead of four bolt holes
    expect(get('side-rib-L1').joints!.filter((j) => j.type === 'hole' && j.to === 'brake-sleeve-T-hull-L' && !j.cut)).toHaveLength(1);
    expect(get('side-rib-L1').joints!.filter((j) => j.cut?.kind === 'counterbore' && j.to === 'brake-sleeve-T-hull-L')).toHaveLength(1);
  });
  it('the materials: the tab is oak (grain vertical), the sleeves are stainless tube cut on the bandsaw, the pins are bought ball-lock pins; stainless follows the weather spec', () => {
    for (const w of [0, 1]) {
      const ps = buildModel({ ...pp, weatherSpec: w } as Params);
      const stainless = w === 1 ? '316' : '304';
      for (const t of SIDE_TAGS) {
        for (const n of ['brake-tab']) { const x = get(`${n}-${t}`, ps); expect(x.kind).toBe('lumber'); expect(x.grain).toBe('z'); expect(x.material).toMatch(/oak/); }
        for (const n of NEW_PARTS.filter((q) => /sleeve/.test(q))) { const x = get(`${n}-${t}`, ps); const hull = /hull/.test(n); expect(x.kind).toBe(hull ? 'purchased' : 'metal'); expect(x.fab).toBe(hull ? 'buy' : 'bandsaw'); expect(x.material).toContain(stainless); expect(x.material).toMatch(/1\/2" OD x 3\/8" ID/); if (hull) expect(x.material).toMatch(/flanged bushing.*3\/4" flange/); }
        for (const n of ['brake-pin-B', 'brake-pin-T']) {
          const x = get(`${n}-${t}`, ps);
          expect(x.kind).toBe('purchased'); expect(x.fab).toBe('buy'); expect(x.material).toContain(stainless); expect(x.material).toMatch(/ball-lock/);
          expect(x.sourcing!.vendor).toMatch(w === 1 ? /316 stainless ball-lock quick-release pin must be sourced/ : /17-4 PH/);
          expect(x.notes).toMatch(/17-4 PH/);
        }
      }
    }
  });
  it('no D-numbers or study names in the shop text of the new parts', () => {
    for (const t of SIDE_TAGS) for (const n of NEW_PARTS) {
      const x = get(`${n}-${t}`);
      const text = [x.notes, x.sourcing?.vendor, ...(x.joints ?? []).flatMap((j) => [j.size, j.note])].filter(Boolean).join(' ');
      expect(text, x.id).not.toMatch(/\bD-\d+|\bstudy\b/);
    }
  });
});

describe('D-78 the geometry is derived from the hull, not typed', () => {
  const L = ctx.L;
  it('pin B: the knee\'s center fore and aft, the rail\'s mid-height, through the knee leg and the rail only', () => {
    expect(pn.B.x).toBeCloseTo((g.knee.x0 + g.knee.x1) / 2, 9);
    expect(pn.B.z).toBeCloseTo((g.rail.zb + g.rail.zt) / 2, 9);
    expect(pn.B.grip).toBeCloseTo(g.rail.t + g.knee.legT, 9);
    expect(pn.B.hullSleeve).toMatchObject({ y0: g.y.railIn, y1: g.y.face });
    expect(pn.B.kneeSleeve).toMatchObject({ y0: g.y.face, y1: g.y.face + g.knee.legT });
    expect(pn.B.fromRailRear).toBeCloseTo(pn.B.x - (L.xRear + L.transom), 9);
    expect(pn.B.belowRailTop).toBeCloseTo(L.railTop - pn.B.z, 9);
    // the model agrees: the pin lies on that axis, from outside the knee leg to inside the rail
    const pin = worldAABB(get('brake-pin-B-L'));
    expect((pin.min[0] + pin.max[0]) / 2).toBeCloseTo(pn.B.x, 6);
    expect((pin.min[2] + pin.max[2]) / 2).toBeCloseTo(pn.B.z, 6);
    expect(pin.min[1]).toBeCloseTo(g.y.railIn - pp.brakePinTipIn, 6);
    expect(pin.max[1]).toBeCloseTo(g.y.face + g.knee.legT + pp.brakePinHeadIn, 6);
  });
  it('pin T: the box rib\'s center line, the box tie spacer top plus the clearance (about 14.4 in), inside the rib, 0.3 in or more under the D-ring washers', () => {
    const st = sideRibStations(ctx.p, L)[0];
    const tie = boxTieGeometry(ctx.p, L, st);
    expect(st.kind).toBe('box');
    expect(pn.T.x).toBeCloseTo(st.x, 9);
    expect(pn.T.z).toBeCloseTo(tie.z1 + pp.brakeTopPinClearIn, 9);
    expect(pn.T.z).toBeGreaterThan(14.2);
    expect(pn.T.z).toBeLessThan(14.6);
    expect(pn.rib.tieTopZ).toBeCloseTo(tie.z1, 9);
    expect(pn.T.z - pp.brakeSleeveOdIn / 2).toBeGreaterThan(tie.z1); // the sleeve is above the tie
    expect(pn.T.z + pp.brakeSleeveOdIn / 2).toBeLessThan(st.top - L.railBand); // in the shaft, under the head and its D-ring bolts
    expect(pn.rib.z0).toBeLessThan(pn.T.z - pp.brakeSleeveOdIn / 2);
    expect(pn.rib.z1).toBeGreaterThan(pn.T.z);
    expect(pn.clear.tabTopToWasher).toBeGreaterThanOrEqual(pp.brakeTabClearIn - 1e-9);
    // the grip is the tab + web + filler + rib, and the hull sleeve is the last three
    expect(pn.T.grip).toBeCloseTo(pp.brakeTabThickIn + pn.hull.web + pn.hull.filler + pn.hull.rib, 9);
    expect(pn.T.hullSleeve.len).toBeCloseTo(pn.hull.web + pn.hull.filler + pn.hull.rib, 9);
    expect(pn.T.hullSleeve.y1).toBeCloseTo(pn.yWebOut, 9); // flush with the web's outer face
    expect(pn.clear.ballTipToBox).toBeGreaterThan(0.1); // the balls do not touch the storage box
    expect(pn.issues).toEqual([]);
    expect(brakePinIssues(ctx.p, L)).toEqual([]);
  });
  it('the box rib is a full-width block (the head length, 2 in) from 1.5 in below pin T up to the head, so the sleeve has 3/4 in of oak each side; the shaft, the other ribs and the tie are as before', () => {
    expect(pn.rib.w).toBe(pp.sideRibWidthIn);
    expect(pn.rib.blockW).toBeCloseTo(pp.sideRibHeadLengthIn, 9);
    expect(pn.rib.blockZ0).toBeCloseTo(pn.T.z - pp.brakeRibBlockBelowIn, 9);
    expect((pn.rib.blockW - pp.brakeSleeveOdIn) / 2).toBeGreaterThanOrEqual(0.7);
    const rb = worldAABB(get('side-rib-L1'));
    expect(rb.max[0] - rb.min[0]).toBeCloseTo(pp.sideRibHeadLengthIn, 3);
    expect(get('side-rib-L1').massLb).toBeGreaterThan(get('side-rib-L1', bolted).massLb);
    expect(get('side-rib-L1').massLb - get('side-rib-L1', bolted).massLb).toBeLessThan(0.12);
    for (const id of ['side-rib-L2', 'side-rib-L3', 'box-tie-L']) expect(get(id).massLb, id).toBeCloseTo(get(id, bolted).massLb, 9);
  });
  it('the web recess is the real one: the tab\'s inboard face is on the web\'s outer face, the knee\'s inboard face is the hull face, 0.21 in outboard of it; there is no pad', () => {
    const web = worldAABB(get('side-L-web'));
    const tab = worldAABB(get('brake-tab-L')), knee = worldAABB(get('brake-knee-L'));
    expect(pn.webRecess).toBeCloseTo(L.sideBand, 9);
    expect(pn.webRecess).toBeGreaterThan(0.2);
    expect(pn.webRecess).toBeLessThan(0.22);
    expect(tab.min[1]).toBeCloseTo(web.max[1], 4);
    expect(knee.min[1] - tab.min[1]).toBeCloseTo(pn.webRecess, 4);
    expect(knee.min[1]).toBeCloseTo(g.y.face, 9);
    expect(ids(pinned).has('brake-knee-pad-L')).toBe(false);
    expect((pn as unknown as Record<string, unknown>).pad).toBeUndefined();
  });
  it('the tab bears on the web over the box rib block (the rib and filler back the web there)', () => {
    const b = pn.tab.bearing;
    expect(b.x0).toBeCloseTo(pn.tab.x0, 9); // all of the tab behind the knee is over the rib block (2 in wide, centered on pin T)
    expect(b.x1).toBeCloseTo(pn.tab.x1, 9);
    expect(b.z0).toBeCloseTo(pn.rib.blockZ0, 9);
    expect(b.z1).toBeCloseTo(pn.tab.z1, 9);
    expect(b.area).toBeGreaterThan(4);
    expect(b.x0).toBeGreaterThanOrEqual(pn.rib.x - pn.rib.blockW / 2 - 1e-9);
    expect(b.x1).toBeLessThanOrEqual(pn.rib.x + pn.rib.blockW / 2 + 1e-9);
  });
  it('the tab: 1 in thick, from the knee\'s rear face back to 1 in behind pin T, 1.2 in above pin T and 4.1 in tall (hanging below the pin), grain vertical', () => {
    const tab = worldAABB(get('brake-tab-L'));
    expect(tab.max[0]).toBeCloseTo(g.knee.x0, 9);
    expect(tab.min[0]).toBeCloseTo(pn.T.x - pp.brakeTabEndIn, 9);
    expect(tab.max[1] - tab.min[1]).toBeCloseTo(pp.brakeTabThickIn, 9);
    expect(tab.max[2] - tab.min[2]).toBeCloseTo(pp.brakeTabHeightIn, 9);
    expect(tab.max[2]).toBeCloseTo(pn.T.z + pp.brakeTabAbovePinIn, 9);
    expect(tab.min[2]).toBeGreaterThan(g.knee.zLeg); // stays above the chine band
    expect(pp.brakeTabThickIn).toBe(1);
  });
  it('the glue patch of the tab on the knee\'s rear face is about 2.9 in2 (0.66 with the low knee) with its center about 1.1 in under pin T', () => {
    const ph = pn.tab.patch;
    expect(ph.y0).toBeCloseTo(g.y.face, 9);
    expect(ph.y1).toBeCloseTo(pn.tab.yOut, 9);
    expect(ph.z1).toBeCloseTo(g.knee.zTopLeg, 9); // up to the top of the knee leg
    expect(ph.z0).toBeCloseTo(pn.tab.z0, 9); // down to the tab bottom
    expect(ph.area).toBeCloseTo((ph.y1 - ph.y0) * (ph.z1 - ph.z0), 9);
    expect(ph.area).toBeGreaterThan(2.7);
    expect(pn.tab.glueArea).toBeCloseTo(ph.area, 9);
    expect(ph.zc).toBeCloseTo((ph.z0 + ph.z1) / 2, 9);
    expect(ph.ePin).toBeCloseTo(pn.T.z - ph.zc, 9);
    expect(ph.ePin).toBeLessThan(1.3);
    expect(ph.eTab).toBeCloseTo((pn.tab.z0 + pn.tab.z1) / 2 - ph.zc, 9);
  });
  it('the sleeves: 1/2 in OD, 3/8 in ID, lengths are the members they pass; the hull ones are not removable, the knee ones are', () => {
    for (const t of SIDE_TAGS) {
      const cases: Array<[string, number, boolean]> = [[`brake-sleeve-B-hull-${t}`, pn.B.hullSleeve.len, false], [`brake-sleeve-B-knee-${t}`, pn.B.kneeSleeve.len, true], [`brake-sleeve-T-hull-${t}`, pn.T.hullSleeve.len, false], [`brake-sleeve-T-tab-${t}`, pn.T.kneeSleeve.len, true]];
      for (const [id, len, rem] of cases) {
        const x = get(id);
        expect(x.geometry).toMatchObject({ type: 'cylinder', radius: 0.25 });
        expect((x.geometry as { length: number }).length).toBeCloseTo(len, 9);
        expect((x.geometry as { wall: number }).wall).toBeCloseTo((0.5 - 0.375) / 2, 9);
        expect(x.removable ?? false, id).toBe(rem);
        expect(x.massLb).toBeGreaterThan(0.01);
        expect(x.massLb).toBeLessThan(0.06);
      }
    }
    expect(pn.B.hullSleeve.len).toBe(0.75);
    expect(pn.B.kneeSleeve.len).toBe(1.75);
  });
  it('the existing wood-screw sizes are untouched (the tab is glued, no new screws)', () => {
    for (const n of ['brake-tab-L']) expect((get(n).joints ?? []).some((j) => j.type === 'screw'), n).toBe(false);
  });
});

describe('D-78 overlaps and clearances', () => {
  it('the pins setting adds no unintended overlap (the sleeves and pins lie in the holes of their hosts, the tab and the knee touch face to face)', () => {
    expect(newClashes(bolted, pinned)).toEqual([]);
    expect(newClashes(buildModel(p0, TRANSPORT_VIEW), buildModel(pp, TRANSPORT_VIEW))).toEqual([]);
  });
  it('at full lock and with the Brakes off, too', () => {
    expect(newClashes(buildModel(p0, { steerDeg: 20 }), buildModel(pp, { steerDeg: 20 }))).toEqual([]);
    expect(newClashes(buildModel(p0, { brakes: false }), buildModel(pp, { brakes: false }))).toEqual([]);
  });
  it('the tab misses the side sign, the reflector, the D-ring washers, the tire and the flap; the pins miss them, too', () => {
    const tab = worldAABB(get('brake-tab-L')), sign = worldAABB(get('sign-L')), refl = worldAABB(get('reflector-L1')), tire = worldAABB(get('wheel-RL'));
    expect(sign.max[0]).toBeLessThanOrEqual(tab.min[0] - pp.brakeTabClearIn + 1e-9); // the sign stops 0.3 in short of the tab
    expect(refl.min[0]).toBeGreaterThan(tab.max[0]); // the reflector is ahead of the knee
    expect(tire.min[1] - tab.max[1]).toBeGreaterThan(0.2); // the tab is inboard of the tire
    expect(pn.rib.washerBotZ - tab.max[2]).toBeGreaterThanOrEqual(pp.brakeTabClearIn - 1e-9);
    for (const t of ['L', 'R']) for (const n of ['brake-tab', 'brake-pin-B', 'brake-pin-T']) for (const o of [`sign-${t}`, `reflector-${t}1`, `lash-${t}1`, `wheel-R${t}`, `brake-flap-${t}`, `brake-pivot-block-${t}`, `brake-shoe-${t}`, `brake-pad-${t}`, `brake-foot-tread-${t}`, `brake-cord-${t}`, `brake-pivot-pin-${t}`, `brake-chock-${t}`])
      expect(partsOverlap(get(`${n}-${t}`), get(o)), `${n}-${t} x ${o}`).toBeLessThanOrEqual(0.0001);
  });
  it('a longer side sign (set to its largest) is still cut back short of the tab', () => {
    const q = { ...pp, signLengthIn: PARAM_DEFS.signLengthIn.max } as Params;
    const ps = buildModel(q);
    const tab = worldAABB(get('brake-tab-L', ps)), sign = worldAABB(get('sign-L', ps));
    expect(sign.max[0]).toBeLessThanOrEqual(tab.min[0] - q.brakeTabClearIn + 1e-9);
    expect(partsOverlap(get('sign-L', ps), get('brake-tab-L', ps))).toBeLessThanOrEqual(0.0001);
  });
  it('through the whole flap stroke (released to applied) the flap group never meets the tab, the pins, the sleeves or the strap', () => {
    for (let i = 0; i <= 10; i++) {
      const moving = buildBrakeAt(ctx, i / 10, true).filter((x) => /-L$/.test(x.id) && /^brake-(flap|pivot-block|shoe|pad|foot-tread|cord)-/.test(x.id));
      expect(moving.length).toBeGreaterThanOrEqual(5);
      for (const m of moving) for (const n of ['brake-tab-L', 'brake-pin-B-L', 'brake-pin-T-L', 'brake-sleeve-T-tab-L', 'brake-sleeve-B-knee-L'])
        expect(partsOverlap(m, get(n)), `${m.id} x ${n} @${i / 10}`).toBeLessThanOrEqual(0.0001);
    }
  });
});

describe('D-78 mass', () => {
  /** One knee bolt set, itemized from the model's own bolt (length from the stack, stainless density): shank, hex head 9/16 AF x 15/64, nylock nut 9/16 AF x 21/64 less the bore, one 7/8 in OD narrow washer under the head. */
  const bd = p0.brakeMountBoltDiaIn, rho = p0.steelDensityPcf / 1728;
  const boltLen = boltLength(brakeGeometry(makeCtx(p0).p, makeCtx(p0).L).bolts.grip, bd);
  const hexArea = (af: number) => (Math.sqrt(3) / 2) * af * af;
  const REAL = {
    shank: (Math.PI / 4) * bd * bd * boltLen * rho,
    head: hexArea(9 / 16) * (15 / 64) * rho,
    nut: (hexArea(9 / 16) - (Math.PI / 4) * bd * bd) * (21 / 64) * rho,
    washer: (Math.PI / 4) * (0.875 ** 2 - 0.406 ** 2) * 0.063 * rho,
  };
  const realSetLb = REAL.shank + REAL.head + REAL.nut + REAL.washer;
  const nBolts = 8;
  const boltLb = (ps: Part[]) => fastenerBreakdown(ps)['bolt sets']?.lb ?? 0;
  it('the MODEL delta (bolted default masses are unchanged: the 8 knee bolt sets sit in the hardware lump at the model\'s unit mass) is about zero (slightly heavier)', () => {
    const raw = totalMass(pinned) - totalMass(bolted);
    expect(raw).toBeGreaterThan(-0.2);
    expect(raw).toBeLessThan(0.3); // the pins setting is slightly HEAVIER in the model (the real bolts are not in the lump)
    expect(boltLb(bolted) - boltLb(pinned)).toBeGreaterThan(0.5); // the 8 bolt sets leave the lump
  });
  it('the REAL-WEIGHT delta swaps the lump\'s 8 bolt sets for itemized ones (bolt, head, nylock nut, washer from the stack and the stainless density) and states the saving separately', () => {
    expect(boltLen).toBeGreaterThanOrEqual(3.5); // a stock bolt for the 3.25 in stack
    expect(realSetLb).toBeGreaterThan(0.15);
    expect(realSetLb).toBeLessThan(0.25);
    const modelBolts = boltLb(bolted) - boltLb(pinned);
    const raw = totalMass(pinned) - totalMass(bolted);
    const real = raw - (nBolts * realSetLb - modelBolts);
    expect(real).toBeLessThan(raw); // the lump understates the bolts
    expect(real).toBeGreaterThan(-0.9);
    expect(real).toBeLessThan(-0.2);
  });
  it('what leaves and what arrives: the backers and plates leave (about 0.75 lb), the tabs, pins and sleeves arrive (about 1.2 lb)', () => {
    const sum = (ps: Part[], re: RegExp) => ps.filter((x) => re.test(x.id)).reduce((a, x) => a + x.massLb, 0);
    expect(sum(bolted, /^brake-(backer|backplate)-/)).toBeGreaterThan(0.7);
    const arrive = sum(pinned, /^brake-(tab|pin-[BT]|sleeve-)/);
    expect(arrive).toBeGreaterThan(1.0);
    expect(arrive).toBeLessThan(1.5);
    expect(get('brake-pin-B-L').massLb).toBeGreaterThan(0.1);
    expect(get('brake-pin-B-L').massLb).toBeLessThan(0.2);
  });
  it('the knee with the leg stood up over pin T weighs a little more than the bolted knee (about 0.1 lb)', () => {
    const d = get('brake-knee-L').massLb - get('brake-knee-L', bolted).massLb;
    expect(d).toBeGreaterThan(0.05);
    expect(d).toBeLessThan(0.2);
  });
  it('the removable brake kit weighs about 4.4 lb more with the pins (the knee and strap now come off, and the tab and pins with them)', () => {
    const kit = (ps: Part[]) => totalMass(ps) - totalMass(buildModel(ps === pinned ? pp : p0, { brakes: false }));
    expect(kit(pinned) - kit(bolted)).toBeGreaterThan(3.9);
    expect(kit(pinned) - kit(bolted)).toBeLessThan(5);
  });
});

describe('D-78 the no-fabrication rule for metal', () => {
  it('no metal part, in either setting and either weather spec, asks for more than buying, cutting or drilling', () => {
    for (const w of [0, 1]) for (const k of [0, 1]) expect(noFabViolations(buildModel({ ...p0, weatherSpec: w, kneeMount: k } as Params)), `weather ${w} knee ${k}`).toEqual([]);
  });
});

describe('D-78 removable: the Brakes toggle and Transport mode', () => {
  it('the kit regex matches the new knee-side parts (not the hull sleeves); the knee and strap join the kit only when they are flagged removable', () => {
    for (const t of SIDE_TAGS) {
      for (const n of KNEE_SIDE_PARTS) expect(BRAKE_KIT_RE.test(`${n}-${t}`), `${n}-${t}`).toBe(true);
      for (const n of HULL_SLEEVES) expect(BRAKE_KIT_RE.test(`${n}-${t}`), `${n}-${t}`).toBe(false);
      for (const n of ['brake-knee', 'brake-strap']) { expect(BRAKE_KIT_RE.test(`${n}-${t}`)).toBe(false); expect(isBrakeKit({ id: `${n}-${t}` })).toBe(false); expect(isBrakeKit({ id: `${n}-${t}`, removable: true })).toBe(true); }
    }
    expect(pinned.filter((x) => BRAKE_KIT_RE.test(x.id))).toHaveLength(18 + 2 * KNEE_SIDE_PARTS.length); // the 18 flap parts and 12 more
    expect(bolted.filter((x) => BRAKE_KIT_RE.test(x.id))).toHaveLength(18);
    expect(isBrakeKit(get('brake-knee-L', bolted))).toBe(false);
    expect(isBrakeKit(get('brake-knee-L'))).toBe(true);
  });
  it('removable flags: with the pins the knee, strap, tab, pins and the knee-side sleeves are removable, the hull sleeves are not; bolted, none of the knee is', () => {
    for (const t of SIDE_TAGS) {
      for (const n of ['brake-knee', 'brake-strap', ...KNEE_SIDE_PARTS]) expect(get(`${n}-${t}`).removable, `${n}-${t}`).toBe(true);
      for (const n of HULL_SLEEVES) expect(get(`${n}-${t}`).removable ?? false, `${n}-${t}`).toBe(false);
      for (const n of ['brake-knee', 'brake-strap', 'brake-backer', 'brake-backplate']) expect(get(`${n}-${t}`, bolted).removable ?? false, `${n}-${t}`).toBe(false);
    }
  });
  it('Brakes off takes the whole kit, the knee and strap included, and leaves the hull sleeves, the chocks and the rest', () => {
    const off = ids(buildModel(pp, { brakes: false }));
    const gone = pinned.filter((x) => !off.has(x.id)).map((x) => x.id).sort();
    expect(gone).toEqual(pinned.filter((x) => isBrakeKit(x)).map((x) => x.id).sort());
    expect(gone).toContain('brake-knee-L');
    expect(gone).toContain('brake-tab-R');
    for (const t of SIDE_TAGS) for (const n of HULL_SLEEVES) expect(off.has(`${n}-${t}`)).toBe(true);
    expect(off.has('brake-chock-L')).toBe(true);
  });
  it('Transport mode shows a flush hull: no brake part but the two hull sleeves is left, and nothing sticks out of the rear sides past the hull face but the wheels, the signs and the reflectors', () => {
    const t = buildModel(pp, { rider: 'none', cargo: false, ...TRANSPORT_VIEW });
    const have = ids(t);
    for (const s of SIDE_TAGS) {
      for (const n of ['brake-knee', 'brake-strap', ...KNEE_SIDE_PARTS, 'brake-flap', 'brake-chock']) expect(have.has(`${n}-${s}`), `${n}-${s}`).toBe(false);
      for (const n of HULL_SLEEVES) expect(have.has(`${n}-${s}`), `${n}-${s}`).toBe(true);
    }
    const face = g.y.face + 0.07;
    for (const x of t.filter((q) => /^brake-/.test(q.id))) { const b = worldAABB(x); expect(Math.max(Math.abs(b.min[1]), Math.abs(b.max[1])), x.id).toBeLessThanOrEqual(face); }
    const out = t.filter((x) => { const b = worldAABB(x); return b.max[0] > 3 && b.min[0] < 11 && b.max[2] < 40 && Math.max(Math.abs(b.min[1]), Math.abs(b.max[1])) > face; }).map((x) => x.id);
    for (const id of out) expect(id, id).toMatch(/^(wheel-R[LR]|sign-[LR]|reflector-[LR]\d)$/);
    // bolted, the knee is still there in Transport mode (the old behavior)
    expect(ids(buildModel(p0, { rider: 'none', cargo: false, ...TRANSPORT_VIEW })).has('brake-knee-L')).toBe(true);
  });
  it('the chock cord eye goes with the knee: the chocks are removable already', () => {
    for (const s of SIDE_TAGS) { expect(get(`brake-chock-${s}`).removable).toBe(true); expect(get(`brake-chock-cord-${s}`).removable).toBe(true); }
  });
});

describe('D-78 joints reference real parts with measured locations', () => {
  const have = ids(pinned);
  const finite = (v: number[]) => v.every(Number.isFinite);
  it('every joint of every new part names a part that is in the model and carries its location (pin, hole and glue joints)', () => {
    for (const s of SIDE_TAGS) for (const n of NEW_PARTS) {
      const x = get(`${n}-${s}`);
      expect(x.joints?.length ?? 0, x.id).toBeGreaterThan(0);
      for (const j of x.joints!) { expect(have.has(j.to), `${x.id} -> ${j.to}`).toBe(true); expect(j.at?.length ?? 0, `${x.id} -> ${j.to}`).toBeGreaterThan(0); for (const a of j.at!) expect(finite(a)).toBe(true); }
    }
  });
  it('every sleeve and pin is named from both ends: the hosts record the hole and the sleeves/pins record the pin', () => {
    for (const s of SIDE_TAGS) {
      expect(get(`rail-${s}`).joints!.some((j) => j.to === `brake-sleeve-B-hull-${s}`)).toBe(true);
      expect(get(`side-rib-${s}1`).joints!.some((j) => j.to === `brake-sleeve-T-hull-${s}`)).toBe(true);
      expect(get(`brake-knee-${s}`).joints!.some((j) => j.to === `brake-sleeve-B-knee-${s}`)).toBe(true);
      expect(get(`brake-knee-${s}`).joints!.some((j) => j.to === `brake-pin-B-${s}` && j.type === 'pin')).toBe(true);
      expect(get(`brake-tab-${s}`).joints!.some((j) => j.to === `brake-sleeve-T-tab-${s}`)).toBe(true);
      for (const k of ['B', 'T']) expect(get(`brake-pin-${k}-${s}`).joints!.length).toBe(2);
    }
  });
  it('the host hole points land on the pin axes: the rail\'s on pin B at the rail\'s outer face, the rib\'s on pin T inside the rib, the knee\'s on pin B at the leg\'s inboard face, the tab\'s on pin T', () => {
    for (const [s, sg] of [['L', 1], ['R', -1]] as const) {
      const pt = (id: string, to: string): number[] => { const j = get(id).joints!.find((q) => q.to === to && q.at)!; return transformPoint(get(id).transform, j.at![0]); };
      const rail = pt(`rail-${s}`, `brake-sleeve-B-hull-${s}`);
      expect(rail[0]).toBeCloseTo(pn.B.x, 6); expect(rail[2]).toBeCloseTo(pn.B.z, 6); expect(rail[1]).toBeCloseTo(sg * g.y.face, 6);
      const rib = pt(`side-rib-${s}1`, `brake-sleeve-T-hull-${s}`);
      expect(rib[0]).toBeCloseTo(pn.T.x, 3); expect(rib[2]).toBeCloseTo(pn.T.z, 6);
      expect(Math.abs(rib[1])).toBeGreaterThan(pn.T.hullSleeve.y0); expect(Math.abs(rib[1])).toBeLessThan(pn.T.hullSleeve.y0 + pn.hull.rib);
      const knee = pt(`brake-knee-${s}`, `brake-sleeve-B-knee-${s}`);
      expect(knee[0]).toBeCloseTo(pn.B.x, 6); expect(knee[2]).toBeCloseTo(pn.B.z, 6); expect(knee[1]).toBeCloseTo(sg * g.y.face, 6);
      const tab = pt(`brake-tab-${s}`, `brake-sleeve-T-tab-${s}`);
      expect(tab[0]).toBeCloseTo(pn.T.x, 6); expect(tab[2]).toBeCloseTo(pn.T.z, 6);
      // the pins' own joint points lie on the pin
      for (const k of ['B', 'T']) { const pin = get(`brake-pin-${k}-${s}`); const bb = worldAABB(pin); for (const j of pin.joints!) { const w = transformPoint(pin.transform, j.at![0]); for (let a = 0; a < 3; a++) { expect(w[a]).toBeGreaterThanOrEqual(bb.min[a] - 1e-6); expect(w[a]).toBeLessThanOrEqual(bb.max[a] + 1e-6); } } }
    }
  });
  it('the shop text of the pins\' hosts gives measured places: distances from the rail\'s rear end and top edge, and from the rib\'s bottom end and gunwale top', () => {
    const rj = get('rail-L').joints!.find((j) => j.to === 'brake-sleeve-B-hull-L')!;
    expect(rj.size).toContain(`${(Math.round(pn.B.fromRailRear * 100) / 100).toString()}"`);
    expect(rj.size).toMatch(/rear end/); expect(rj.size).toMatch(/top edge/);
    const bj = get('side-rib-L1').joints!.find((j) => j.to === 'brake-sleeve-T-hull-L')!;
    expect(bj.size).toMatch(/from the rib's bottom end|up from the rib's bottom end/); expect(bj.size).toMatch(/gunwale top/);
  });
});

describe('D-78 the frame has no backer cutback and the hull builds in the other settings', () => {
  it('a joist that meets the bolted backer is cut back for it; with the pins there is no backer and no cutback', () => {
    let found = 0;
    for (let sp = 6; sp <= 12; sp += 0.25) {
      const q = { ...p0, crossmemberSpacingIn: sp } as Params;
      const pb = buildModel(q), pk = buildModel({ ...q, kneeMount: KNEE_MOUNT.pins } as Params);
      for (const j of pb.filter((x) => /^joist-\d+$/.test(x.id) && /brake knee backers/.test(x.notes ?? ''))) {
        found++;
        expect(get(j.id, pk).notes ?? '', `${j.id} @${sp}`).not.toMatch(/brake knee backers/);
        const hb = worldAABB(j), hk = worldAABB(get(j.id, pk));
        expect(hk.max[1] - hk.min[1]).toBeGreaterThan(hb.max[1] - hb.min[1] + 0.1);
      }
    }
    expect(found).toBeGreaterThan(0);
  });
  it('with the box under the seat there is no box rib to pin to: the knee stays bolted (no pins block, bolted parts) and the validator says so', () => {
    const q = { ...pp, storageLocation: 2 } as Params;
    const c = makeCtx(q);
    const b = brakeGeometry(c.p, c.L);
    expect(b.mount).toBe('bolted');
    expect(b.pins).toBeUndefined();
    expect(brakePinIssues(c.p, c.L).join(' ')).toMatch(/box rib/);
    const ps = buildModel(q);
    expect(ids(ps).has('brake-backer-L')).toBe(true);
    expect(ids(ps).has('brake-tab-L')).toBe(false);
    expect(validateParams(q).some((i) => i.severity === 'warn' && i.keys.includes('kneeMount'))).toBe(true);
  });
});

describe('D-78 validateParams and the geometry issues', () => {
  it('the pins setting at the defaults is clean (no errors or warnings), as is the bolted default', () => {
    expect(validateParams(pp).filter((i) => i.severity !== 'info')).toEqual([]);
    expect(validateParams(p0).filter((i) => i.severity !== 'info')).toEqual([]);
  });
  it('a sleeve smaller than the pin, a wall under 1/32 in, a short tab or a tab with no end distance are flagged', () => {
    expect(validateParams({ ...pp, brakeSleeveIdIn: 0.3125 } as Params).filter((i) => i.severity === 'error' && i.keys.includes('brakeSleeveIdIn'))).toHaveLength(1);
    expect(validateParams({ ...pp, brakeSleeveOdIn: 0.4375, brakeSleeveIdIn: 0.4375 } as Params).filter((i) => i.severity === 'error' && i.keys.includes('brakeSleeveOdIn')).length).toBeGreaterThan(0);
    expect(validateParams({ ...pp, brakeTabHeightIn: 0.9 } as Params).filter((i) => i.severity === 'warn' && i.keys.includes('brakeTabHeightIn'))).toHaveLength(1);
    expect(validateParams({ ...pp, brakeTabEndIn: 0.7, brakePinEdgeIn: 0.5 } as Params).filter((i) => i.severity === 'warn' && i.keys.includes('brakeTabEndIn'))).toHaveLength(1);
    expect(validateParams({ ...p0, brakeSleeveIdIn: 0.3125 } as Params).filter((i) => i.keys.includes('brakeSleeveIdIn'))).toEqual([]); // not checked when bolted
  });
  it('the hull-dependent checks catch a tab that reaches the D-ring washers and a pin clear of the rib', () => {
    const tall = { ...pp, brakeTabAbovePinIn: 2 } as Params;
    const c = makeCtx(tall);
    expect(brakePinIssues(c.p, c.L).join(' ')).toMatch(/D-ring washers/);
    const high = { ...pp, brakeTopPinClearIn: 2 } as Params;
    const c2 = makeCtx(high);
    expect(brakePinIssues(c2.p, c2.L).length).toBeGreaterThan(0);
    expect(brakePinIssues(makeCtx(p0).p, makeCtx(p0).L)).toEqual([]); // bolted: nothing to check
  });
});

describe('D-78 round 2: knee leg top, flanged hull bushings, pin grips', () => {
  it('the knee leg stands up to 3/4 in over pin T (about 15.15 in) so it backs the whole top sleeve; the arm and the roof keep their height; 0.2 in or more under the reflector and the washers', () => {
    expect(pn.T.z + pp.brakeKneeTopAbovePinIn).toBeCloseTo(g.knee.zTopLeg, 9);
    expect(g.knee.zTopLeg).toBeGreaterThan(15);
    expect(g.knee.zTopLeg).toBeLessThan(15.3);
    expect(g.knee.zTopLeg).toBeGreaterThan(pn.T.z + pn.sleeveOd / 2 + 0.4); // oak in front of the sleeve to the knee top
    expect(g.knee.zTop).toBeLessThan(14.2); // D-77 arm / roof height, unchanged
    const bg = brakeGeometry(makeCtx(p0).p, makeCtx(p0).L);
    expect(bg.knee.zTopLeg).toBe(bg.knee.zTop); // bolted: one top
    expect(g.knee.zTop).toBeCloseTo(bg.knee.zTop, 9);
    const kn = worldAABB(get('brake-knee-L')), refl = worldAABB(get('reflector-L1'));
    expect(kn.max[2]).toBeCloseTo(g.knee.zTopLeg, 6);
    expect(refl.min[2] - kn.max[2]).toBeGreaterThanOrEqual(0.2);
    expect(pn.rib.washerBotZ - kn.max[2]).toBeGreaterThanOrEqual(0.2);
    for (const o of ['reflector-L1', 'lash-L1', 'sign-L', 'wheel-RL']) expect(partsOverlap(get('brake-knee-L'), get(o)), o).toBeLessThanOrEqual(0.0001);
    // the pocket, strap and screw positions do not move with the leg's step
    expect(g.strap.zs).toEqual(bg.strap.zs);
    expect(g.pivot.zPocketTop).toBeCloseTo(bg.pivot.zPocketTop, 9);
  });
  it('the knee mesh: the step is real geometry (the leg boxes stand to the leg top, the arm boxes to the arm top)', () => {
    const geom = get('brake-knee-L').geometry as { boxes: Array<[number[], number[]]> };
    const tops = geom.boxes.map(([, hi]) => hi[2]);
    expect(Math.max(...tops)).toBeCloseTo(g.knee.zTopLeg, 6);
    for (const [lo, hi] of geom.boxes) if (lo[1] >= g.y.face + g.knee.legT - 1e-9) expect(hi[2]).toBeLessThanOrEqual(g.knee.zTop + 1e-9);
  });
  it('the hull sleeves are flanged bushings: flange on the INBOARD face (rail inner face, rib inner face), recessed flush, with a counterbore joint at a measured place; the model knows the flange mass', () => {
    const f = pn.flange;
    expect(f.od).toBe(pp.brakeSleeveFlangeOdIn);
    expect(f.cboreDia).toBeGreaterThan(f.od);
    expect(f.cboreDepth).toBe(f.t);
    for (const [s, sg] of [['L', 1], ['R', -1]] as const) {
      const rj = get(`rail-${s}`).joints!.find((j) => j.cut?.kind === 'counterbore')!;
      expect(rj.to).toBe(`brake-sleeve-B-hull-${s}`);
      expect(rj.cut!.dia).toBeCloseTo(f.cboreDia, 9);
      expect(rj.cut!.depth).toBeCloseTo(f.cboreDepth, 9);
      expect(rj.at![0][1]).toBeCloseTo(sg * g.y.railIn, 6); // on the inner face
      expect(rj.at![0][0]).toBeCloseTo(pn.B.x, 6);
      const bj = get(`side-rib-${s}1`).joints!.find((j) => j.cut?.kind === 'counterbore')!;
      expect(bj.to).toBe(`brake-sleeve-T-hull-${s}`);
      expect(bj.at![0][2]).toBeCloseTo(pp.sideRibDepthIn, 9); // the rib's inboard face
      const hull = get(`brake-sleeve-T-hull-${s}`);
      const plain = (Math.PI / 4) * (0.25 ** 2 * 4 - 0.375 ** 2) * pn.T.hullSleeve.len * pp.steelDensityPcf / 1728;
      expect(hull.massLb).toBeGreaterThan(plain); // the flange adds
      expect(hull.notes).toMatch(/INBOARD/);
      expect(hull.name).toMatch(/flanged bushing/);
    }
    // the flange is flush, so the pin tips clear the box side and the joists exactly as before
    expect(pn.clear.ballTipToBox).toBeGreaterThan(0.1);
    const rail = worldAABB(get('rail-L'));
    expect(pn.B.yTip).toBeLessThan(rail.max[1]);
    const joists = pinned.filter((x) => /^joist-\d+$|^king-beam$/.test(x.id));
    for (const j of joists) expect(partsOverlap(get('brake-pin-B-L'), j), j.id).toBeLessThanOrEqual(0.0001);
    for (const o of ['storage-side-L']) expect(partsOverlap(get('brake-pin-T-L'), get(o)), o).toBeLessThanOrEqual(0.0001);
  });
  it('the pin grip: the measured stack and the grip to buy (up to the next 1/4 in): bottom 2-1/2 in, top 2-1/4 in', () => {
    expect(pn.B.stack).toBeCloseTo(2.5, 9); expect(pn.B.gripOrder).toBe(2.5);
    expect(pn.T.stack).toBeCloseTo(2.1675, 9); expect(pn.T.gripOrder).toBe(2.25);
    for (const k of [pn.B, pn.T]) { expect(k.gripOrder).toBeGreaterThanOrEqual(k.stack); expect(k.gripOrder - k.stack).toBeLessThan(0.25); expect((k.gripOrder * 4) % 1).toBe(0); }
    expect(get('brake-pin-T-L').material).toMatch(/2-1\/4" usable length/);
    expect(get('brake-pin-B-L').material).toMatch(/2-1\/2" usable length/);
  });
  it('user-visible names spell out bottom and top; the shop text has no stray "pin B" / "pin T" labels', () => {
    for (const t of SIDE_TAGS) for (const n of NEW_PARTS) {
      const x = get(`${n}-${t}`);
      expect(x.name, x.id).not.toMatch(/\b(pin|sleeve) [BT]\b|\b[BT]\b,/);
      expect([x.notes, ...(x.joints ?? []).map((j) => `${j.size} ${j.note}`)].join(' '), x.id).not.toMatch(/\b(pin|sleeve) [BT]\b/);
    }
    expect(get('rail-L').joints!.find((j) => j.to === 'brake-sleeve-B-hull-L')!.size).not.toMatch(/pin B/);
    expect(get('side-rib-L1').notes).toMatch(/wide from 1-1\/2" below the top-pin hole/);
    expect(get('side-rib-L1').notes).toMatch(/up from the rib's foot/);
    expect(PARAM_DEFS.kneeMount.note).not.toMatch(/\bpad\b/);
  });
});
