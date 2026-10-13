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
const KNEE_SIDE_PARTS = ['brake-tab', 'brake-knee-pad', 'brake-pin-B', 'brake-pin-T', 'brake-sleeve-B-knee', 'brake-sleeve-T-tab'];
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
  it('eight new parts per side (tab, pad, two pins, four sleeves); no backer, backing plate or knee bolts; the knee and strap stay', () => {
    const have = ids(pinned);
    for (const t of SIDE_TAGS) {
      for (const n of NEW_PARTS) expect(have.has(`${n}-${t}`), `${n}-${t}`).toBe(true);
      for (const n of ['brake-backer', 'brake-backplate']) expect(have.has(`${n}-${t}`), `${n}-${t}`).toBe(false);
      for (const n of ['brake-knee', 'brake-strap']) expect(have.has(`${n}-${t}`), `${n}-${t}`).toBe(true);
    }
    expect(pinned.length - bolted.length).toBe(2 * (NEW_PARTS.length - 2)); // +16 new, -4 (two backers, two backing plates)
    expect(new Set(pinned.map((x) => x.id)).size).toBe(pinned.length);
    expect(g.mount).toBe('pins');
    const kj = get('brake-knee-L').joints!;
    expect(kj.some((j) => j.type === 'bolt')).toBe(false);
    expect(kj.some((j) => j.type === 'glue' && j.to === 'rail-L')).toBe(false); // the knee is not glued to the hull: it lifts off
    for (const j of get('rail-L').joints!) expect(j.type === 'hole' && j.to === 'brake-knee-L', 'no bolt holes in the rail').toBe(false);
    const rh = get('rail-L').joints!.filter((j) => j.type === 'hole' && /^brake-sleeve/.test(j.to));
    expect(rh).toHaveLength(1);
    expect(rh[0].count).toBe(1); // ONE pin hole instead of four bolt holes
    expect(get('side-rib-L1').joints!.filter((j) => j.type === 'hole' && j.to === 'brake-sleeve-T-hull-L')).toHaveLength(1);
  });
  it('the materials: the tab and pad are oak (grain vertical), the sleeves are stainless tube cut on the bandsaw, the pins are bought ball-lock pins; stainless follows the weather spec', () => {
    for (const w of [0, 1]) {
      const ps = buildModel({ ...pp, weatherSpec: w } as Params);
      const stainless = w === 1 ? '316' : '304';
      for (const t of SIDE_TAGS) {
        for (const n of ['brake-tab', 'brake-knee-pad']) { const x = get(`${n}-${t}`, ps); expect(x.kind).toBe('lumber'); expect(x.grain).toBe('z'); expect(x.material).toMatch(/oak/); }
        for (const n of NEW_PARTS.filter((q) => /sleeve/.test(q))) { const x = get(`${n}-${t}`, ps); expect(x.kind).toBe('metal'); expect(x.fab).toBe('bandsaw'); expect(x.material).toContain(stainless); expect(x.material).toMatch(/1\/2" OD x 3\/8" ID/); }
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
  it('the box rib is widened for the sleeve (1 in at the defaults), the other ribs are not', () => {
    expect(pn.rib.w).toBeCloseTo(pp.brakeSleeveOdIn + 2 * pp.brakePinEdgeIn, 9);
    expect(get('side-rib-L1').massLb).toBeGreaterThan(get('side-rib-L1', bolted).massLb);
    for (const id of ['side-rib-L2', 'side-rib-L3', 'box-tie-L']) expect(get(id).massLb, id).toBeCloseTo(get(id, bolted).massLb, 9);
  });
  it('the web recess is the real one: the tab\'s inboard face is on the web\'s outer face, the pad is exactly that thick, and the knee\'s inboard face is the hull face', () => {
    const web = worldAABB(get('side-L-web'));
    const tab = worldAABB(get('brake-tab-L')), pad = worldAABB(get('brake-knee-pad-L')), knee = worldAABB(get('brake-knee-L'));
    expect(pn.webRecess).toBeCloseTo(L.sideBand, 9);
    expect(pn.webRecess).toBeGreaterThan(0.2);
    expect(pn.webRecess).toBeLessThan(0.22);
    expect(tab.min[1]).toBeCloseTo(web.max[1], 4);
    expect(pad.min[1]).toBeCloseTo(web.max[1], 4);
    expect(pad.max[1]).toBeCloseTo(knee.min[1], 6);
    expect(knee.min[1]).toBeCloseTo(g.y.face, 9);
    expect(pad.max[1] - pad.min[1]).toBeCloseTo(pn.webRecess, 9);
    expect(pad.min[2]).toBeCloseTo(L.railTop + L.chineH, 9); // from the chine top...
    expect(pad.max[2]).toBeCloseTo(g.knee.zTop, 9); // ...to the knee top
    expect(pad.min[0]).toBeCloseTo(g.knee.x0, 9);
    expect(pad.max[0]).toBeCloseTo(g.knee.x1, 9);
  });
  it('the tab: 1 in thick, from the knee\'s rear face back to 1 in behind pin T, 2.4 in tall centered on pin T, grain vertical', () => {
    const tab = worldAABB(get('brake-tab-L'));
    expect(tab.max[0]).toBeCloseTo(g.knee.x0, 9);
    expect(tab.min[0]).toBeCloseTo(pn.T.x - pp.brakeTabEndIn, 9);
    expect(tab.max[1] - tab.min[1]).toBeCloseTo(pp.brakeTabThickIn, 9);
    expect(tab.max[2] - tab.min[2]).toBeCloseTo(pp.brakeTabHeightIn, 9);
    expect((tab.min[2] + tab.max[2]) / 2).toBeCloseTo(pn.T.z, 9);
    expect(pn.tab.glueArea).toBeGreaterThan(0.5);
    expect(pp.brakeTabThickIn).toBe(1);
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
    for (const n of ['brake-tab-L', 'brake-knee-pad-L']) expect((get(n).joints ?? []).some((j) => j.type === 'screw'), n).toBe(false);
  });
});

describe('D-78 overlaps and clearances', () => {
  it('the pins setting adds no unintended overlap (the sleeves and pins lie in the holes of their hosts, the tab, the pad and the knee touch face to face)', () => {
    expect(newClashes(bolted, pinned)).toEqual([]);
    expect(newClashes(buildModel(p0, TRANSPORT_VIEW), buildModel(pp, TRANSPORT_VIEW))).toEqual([]);
  });
  it('at full lock and with the Brakes off, too', () => {
    expect(newClashes(buildModel(p0, { steerDeg: 20 }), buildModel(pp, { steerDeg: 20 }))).toEqual([]);
    expect(newClashes(buildModel(p0, { brakes: false }), buildModel(pp, { brakes: false }))).toEqual([]);
  });
  it('the tab and the pad miss the side sign, the reflector, the D-ring washers, the tire and the flap; the pins miss them, too', () => {
    const tab = worldAABB(get('brake-tab-L')), sign = worldAABB(get('sign-L')), refl = worldAABB(get('reflector-L1')), tire = worldAABB(get('wheel-RL'));
    expect(sign.max[0]).toBeLessThanOrEqual(tab.min[0] - pp.brakeTabClearIn + 1e-9); // the sign stops 0.3 in short of the tab
    expect(refl.min[0]).toBeGreaterThan(tab.max[0]); // the reflector is ahead of the knee
    expect(tire.min[1] - tab.max[1]).toBeGreaterThan(0.2); // the tab is inboard of the tire
    expect(pn.rib.washerBotZ - tab.max[2]).toBeGreaterThanOrEqual(pp.brakeTabClearIn - 1e-9);
    for (const t of ['L', 'R']) for (const n of ['brake-tab', 'brake-knee-pad', 'brake-pin-B', 'brake-pin-T']) for (const o of [`sign-${t}`, `reflector-${t}1`, `lash-${t}1`, `wheel-R${t}`, `brake-flap-${t}`, `brake-pivot-block-${t}`, `brake-shoe-${t}`, `brake-pad-${t}`, `brake-foot-tread-${t}`, `brake-cord-${t}`, `brake-pivot-pin-${t}`, `brake-chock-${t}`])
      expect(partsOverlap(get(`${n}-${t}`), get(o)), `${n}-${t} x ${o}`).toBeLessThanOrEqual(0.0001);
  });
  it('a longer side sign (set to its largest) is still cut back short of the tab', () => {
    const q = { ...pp, signLengthIn: PARAM_DEFS.signLengthIn.max } as Params;
    const ps = buildModel(q);
    const tab = worldAABB(get('brake-tab-L', ps)), sign = worldAABB(get('sign-L', ps));
    expect(sign.max[0]).toBeLessThanOrEqual(tab.min[0] - q.brakeTabClearIn + 1e-9);
    expect(partsOverlap(get('sign-L', ps), get('brake-tab-L', ps))).toBeLessThanOrEqual(0.0001);
  });
  it('through the whole flap stroke (released to applied) the flap group never meets the tab, the pad, the pins, the sleeves or the strap', () => {
    for (let i = 0; i <= 10; i++) {
      const moving = buildBrakeAt(ctx, i / 10, true).filter((x) => /-L$/.test(x.id) && /^brake-(flap|pivot-block|shoe|pad|foot-tread|cord)-/.test(x.id));
      expect(moving.length).toBeGreaterThanOrEqual(5);
      for (const m of moving) for (const n of ['brake-tab-L', 'brake-knee-pad-L', 'brake-pin-B-L', 'brake-pin-T-L', 'brake-sleeve-T-tab-L', 'brake-sleeve-B-knee-L'])
        expect(partsOverlap(m, get(n)), `${m.id} x ${n} @${i / 10}`).toBeLessThanOrEqual(0.0001);
    }
  });
});

describe('D-78 mass', () => {
  /** A real 3/8-16 x 4 in stainless hex bolt (about 0.2 lb), nylock nut (0.03) and narrow washer (0.02): the weight of one knee bolt set. The model's lumped hardware counts a 3/8 in bolt set at less. */
  const REAL_KNEE_BOLT_SET_LB = 0.25;
  const nBolts = 8;
  const boltLb = (ps: Part[]) => fastenerBreakdown(ps)['bolt sets']?.lb ?? 0;
  it('the model\'s own mass change is a small saving (the knee bolts count as light bolt sets in the hardware remainder); with real knee-bolt weights the pins save about 1.6 lb a sled', () => {
    const raw = totalMass(pinned) - totalMass(bolted);
    expect(raw).toBeGreaterThan(-0.5);
    expect(raw).toBeLessThan(0);
    const modelBolts = boltLb(bolted) - boltLb(pinned);
    expect(modelBolts).toBeGreaterThan(0.5); // the 8 knee bolt sets leave the hardware lump
    const adjusted = raw - (nBolts * REAL_KNEE_BOLT_SET_LB - modelBolts);
    expect(adjusted).toBeGreaterThan(-1.6 - 0.5);
    expect(adjusted).toBeLessThan(-1.6 + 0.5);
  });
  it('what leaves and what arrives: the backers and plates leave (about 0.75 lb), the tabs, pads, pins and sleeves arrive (about 1.1 lb)', () => {
    const sum = (ps: Part[], re: RegExp) => ps.filter((x) => re.test(x.id)).reduce((a, x) => a + x.massLb, 0);
    expect(sum(bolted, /^brake-(backer|backplate)-/)).toBeGreaterThan(0.7);
    const arrive = sum(pinned, /^brake-(tab|knee-pad|pin-[BT]|sleeve-)/);
    expect(arrive).toBeGreaterThan(1.0);
    expect(arrive).toBeLessThan(1.4);
    expect(get('brake-pin-B-L').massLb).toBeGreaterThan(0.1);
    expect(get('brake-pin-B-L').massLb).toBeLessThan(0.2);
  });
  it('the removable brake kit weighs about 4.2 lb more with the pins (the knee and strap now come off, and the tab, pad and pins with them)', () => {
    const kit = (ps: Part[]) => totalMass(ps) - totalMass(buildModel(ps === pinned ? pp : p0, { brakes: false }));
    expect(kit(pinned) - kit(bolted)).toBeGreaterThan(3.7);
    expect(kit(pinned) - kit(bolted)).toBeLessThan(4.7);
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
  it('removable flags: with the pins the knee, strap, tab, pad, pins and the knee-side sleeves are removable, the hull sleeves are not; bolted, none of the knee is', () => {
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
    const tall = { ...pp, brakeTabHeightIn: 3.5 } as Params;
    const c = makeCtx(tall);
    expect(brakePinIssues(c.p, c.L).join(' ')).toMatch(/D-ring washers/);
    const high = { ...pp, brakeTopPinClearIn: 2 } as Params;
    const c2 = makeCtx(high);
    expect(brakePinIssues(c2.p, c2.L).length).toBeGreaterThan(0);
    expect(brakePinIssues(makeCtx(p0).p, makeCtx(p0).L)).toEqual([]); // bolted: nothing to check
  });
});
