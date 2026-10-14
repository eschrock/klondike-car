/**
 * D-78: the optional removable brake knee (`kneeMount` = removable): two clamped 3/8-16 hex bolts per side into flanged threaded inserts in the hull, tightened with a ratchet from the storage box.
 * The default (bolted) is unchanged and covered by the older tests; this file checks both settings side by side and the removable setting in detail: the parts, the geometry derived from the hull,
 * the overlaps, the mass, the no-fabrication rule, the removable kit and Transport mode, the joints, the ratchet in the box and the validators.
 */
import { describe, expect, it } from 'vitest';
import { buildModel } from '.';
import { KNEE_MOUNT, PARAM_DEFS, defaultParams, validateParams, type Params } from '../params';
import { buildBrakeAt } from './brake';
import { makeCtx } from './build-utils';
import { brakeGeometry, brakeRemovableIssues } from './brake-layout';
import { partsOverlap, transformPoint, worldAABB } from './bounds';
import { fastenerBreakdown } from './lighting';
import { boltLength } from './rear-mount';
import { totalMass } from './mass';
import { noFabViolations } from './no-fab';
import { BRAKE_KIT_RE, TRANSPORT_VIEW, isBrakeKit } from './removable';
import { boxTieGeometry, sideRibStations } from './side-ribs';
import { ESSENTIALS, boxGear, packEssentials, storageInterior } from './storage';
import type { Part, PartGroup } from './types';

const p0 = defaultParams();
const pp = { ...p0, kneeMount: KNEE_MOUNT.removable } as Params;
const bolted = buildModel(p0);
const removable = buildModel(pp);
const ctx = makeCtx(pp);
const g = brakeGeometry(ctx.p, ctx.L);
const rm = g.removable!;
const get = (id: string, ps: Part[] = removable): Part => ps.find((x) => x.id === id)!;
const ids = (ps: Part[]) => new Set(ps.map((x) => x.id));
const SIDE_TAGS = ['L', 'R'] as const;
const KNEE_SIDE_PARTS = ['brake-tab', 'brake-bolt-bottom', 'brake-bolt-top', 'brake-washer-bottom', 'brake-washer-top'];
const HULL_PARTS = ['brake-insert-bottom', 'brake-insert-top'];
const NEW_PARTS = [...KNEE_SIDE_PARTS, ...HULL_PARTS];
const SOLID: PartGroup[] = ['frame', 'body', 'front-end', 'running-gear', 'seat', 'storage', 'brake', 'removable', 'lighting', 'hardware'];

/** Pairs of parts whose boxes overlap by more than the model tests' tolerance. */
function overlapPairs(parts: Part[]): Set<string> {
  const solid = parts.filter((x) => !x.payload && SOLID.includes(x.group));
  const out = new Set<string>();
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) if (partsOverlap(solid[i], solid[j]) > 0.05) out.add([solid[i].id, solid[j].id].sort().join(' x '));
  return out;
}
/** Contacts that are meant: an insert or a bolt lies INSIDE the holes of the parts it goes through (the model's boxes have no holes). */
const HOST: RegExp[] = [
  /^brake-insert-bottom-[LR] x rail-[LR]$/, /^brake-bolt-bottom-[LR] x rail-[LR]$/, /^brake-bolt-bottom-[LR] x brake-knee-[LR]$/, /^brake-bolt-bottom-[LR] x brake-insert-bottom-[LR]$/,
  /^brake-insert-top-[LR] x side-rib-[LR]1$/, /^brake-insert-top-[LR] x side-[LR]-web$/, /^brake-bolt-top-[LR] x side-rib-[LR]1$/, /^brake-bolt-top-[LR] x side-[LR]-web$/,
  /^brake-bolt-top-[LR] x brake-tab-[LR]$/, /^brake-bolt-top-[LR] x brake-insert-top-[LR]$/,
  /^brake-bolt-(bottom|top)-[LR] x brake-washer-(bottom|top)-[LR]$/,
];
const isHost = (k: string) => HOST.some((r) => r.test(k) || r.test(k.split(' x ').reverse().join(' x ')));
const newClashes = (a: Part[], b: Part[]) => {
  const base = overlapPairs(a);
  return [...overlapPairs(b)].filter((k) => !base.has(k) && !isHost(k));
};
const shopText = (x: Part) => [x.notes, x.sourcing?.vendor, ...(x.joints ?? []).flatMap((j) => [j.size, j.note])].filter(Boolean).join(' ');

describe('D-78 the setting', () => {
  it('kneeMount is an options param, default bolted (0), removable is 1 ("Removable knees (two bolts, ratchet)"), with a status, a note and the D-78 reference; every new param has them', () => {
    const d = PARAM_DEFS.kneeMount;
    expect(d.default).toBe(KNEE_MOUNT.bolted);
    expect(KNEE_MOUNT.removable).toBe(1);
    expect(d.options!.map((o) => o.value)).toEqual([0, 1]);
    expect(d.options![1].label).toBe('Removable knees (two bolts, ratchet)');
    expect(d.ref).toContain('D-78');
    for (const k of ['kneeMount', 'brakeBoltClearHoleIn', 'brakeBoltWasherOdIn', 'brakeBoltWasherIdIn', 'brakeBoltWasherThickIn', 'brakeInsertOdIn', 'brakeInsertFlangeOdIn', 'brakeInsertFlangeThickIn', 'brakeInsertMinWoodIn',
      'brakeTabThickIn', 'brakeTabHeightIn', 'brakeTabAboveBoltIn', 'brakeTabEndIn', 'brakeTabClearIn', 'brakeTopBoltClearIn', 'brakeRibBlockWidthIn', 'brakeRibBlockBelowIn', 'brakeKneeTopAboveBoltIn', 'brakeBoltEdgeIn',
      'brakeRatchetLenIn', 'brakeRatchetWidthIn', 'brakeRatchetHeightIn'] as const) {
      expect(PARAM_DEFS[k].status, k).toBeDefined();
      expect(PARAM_DEFS[k].ref, k).toContain('D-78');
    }
    for (const k of ['kneeMount', 'brakeInsertOdIn', 'brakeRibBlockWidthIn', 'brakeBoltClearHoleIn'] as const) expect(PARAM_DEFS[k].note, k).toBeTruthy();
    expect(PARAM_DEFS.brakeTabThickIn.default).toBe(1);
    expect(PARAM_DEFS.brakeRibBlockWidthIn.default).toBe(2);
    expect(PARAM_DEFS.brakeInsertFlangeOdIn.default).toBe(1);
    expect(PARAM_DEFS.brakeBoltClearHoleIn.default).toBe(13 / 32);
    // nothing of the pins design is left
    const keys = Object.keys(PARAM_DEFS);
    expect(keys.filter((k) => /^brake(Pin|Sleeve|TabDomino|Washer|TopPin)|AbovePinIn|PinEdge/.test(k))).toEqual([]);
    expect(PARAM_DEFS.kneeMount.note).not.toMatch(/\bpad\b|ball-lock|sleeve|Domino/i);
  });
  it('the default is the bolted knee: no removable parts, no removable geometry, the four bolts, the backer and the backing plate are all there, and nothing of the knee is removable', () => {
    expect(p0.kneeMount).toBe(0);
    const b0 = brakeGeometry(makeCtx(p0).p, makeCtx(p0).L);
    expect(b0.mount).toBe('bolted');
    expect(b0.removable).toBeUndefined();
    expect(b0.knee.zTopLeg).toBe(b0.knee.zTop);
    const have = ids(bolted);
    for (const t of SIDE_TAGS) {
      for (const n of NEW_PARTS) expect(have.has(`${n}-${t}`), `${n}-${t}`).toBe(false);
      for (const n of ['brake-knee', 'brake-strap', 'brake-backer', 'brake-backplate']) expect(have.has(`${n}-${t}`), `${n}-${t}`).toBe(true);
    }
    expect(get('brake-knee-L', bolted).removable ?? false).toBe(false);
    expect(get('brake-strap-L', bolted).removable ?? false).toBe(false);
    expect(get('rail-L', bolted).joints!.find((j) => j.type === 'hole' && j.to === 'brake-knee-L')!.count).toBe(4);
    expect(buildModel({ ...p0, kneeMount: KNEE_MOUNT.bolted } as Params).map((x) => x.id)).toEqual(bolted.map((x) => x.id));
    expect(boxGear(bolted, p0).tools).toEqual([]);
  });
});

describe('D-78 the parts with the removable knee', () => {
  it('seven new parts per side (tab, two bolts, two washers, two inserts); no backer, backing plate or D-75 knee bolts; the knee and strap stay; no trace of the pin design', () => {
    const have = ids(removable);
    for (const t of SIDE_TAGS) {
      for (const n of NEW_PARTS) expect(have.has(`${n}-${t}`), `${n}-${t}`).toBe(true);
      for (const n of ['brake-backer', 'brake-backplate']) expect(have.has(`${n}-${t}`), `${n}-${t}`).toBe(false);
      for (const n of ['brake-knee', 'brake-strap']) expect(have.has(`${n}-${t}`), `${n}-${t}`).toBe(true);
    }
    expect(removable.length - bolted.length).toBe(2 * NEW_PARTS.length - 4); // +14 new, -4 (two backers, two backing plates)
    expect(new Set(removable.map((x) => x.id)).size).toBe(removable.length);
    expect(removable.filter((x) => /^brake-(sleeve|pin-[BT]|knee-pad|washer-[BT])/.test(x.id))).toEqual([]);
    expect(g.mount).toBe('removable');
    const kj = get('brake-knee-L').joints!;
    expect(kj.some((j) => j.type === 'bolt')).toBe(false);
    expect(kj.some((j) => j.type === 'domino')).toBe(false);
    expect(kj.some((j) => j.type === 'glue' && j.to === 'rail-L')).toBe(false); // the knee is not glued to the hull: it lifts off
    expect(kj.some((j) => j.type === 'glue' && j.to === 'brake-tab-L')).toBe(true); // the tab stays glued to the knee
    expect(kj.some((j) => j.type === 'hole' && j.to === 'brake-bolt-bottom-L' && j.diaIn === 13 / 32)).toBe(true);
    for (const j of get('rail-L').joints!) expect(j.type === 'hole' && j.to === 'brake-knee-L', 'no D-75 bolt holes in the rail').toBe(false);
    const rh = get('rail-L').joints!.filter((j) => j.type === 'hole' && j.to === 'brake-insert-bottom-L');
    expect(rh).toHaveLength(2); // the counterbore for the flange and the pilot hole
    expect(rh.filter((j) => j.cut?.kind === 'counterbore')).toHaveLength(1);
    const ri = get('side-rib-L1').joints!.filter((j) => j.type === 'hole' && j.to === 'brake-insert-top-L');
    expect(ri).toHaveLength(2);
    expect(ri.filter((j) => j.cut?.kind === 'counterbore')).toHaveLength(1);
  });
  it('the materials: the tab is oak (grain vertical); the bolts, washers and inserts are purchased stainless by weather spec (18-8 Standard, 316 Extreme); inserts are not removable', () => {
    for (const w of [0, 1]) {
      const ps = buildModel({ ...pp, weatherSpec: w } as Params);
      const stainless = w === 1 ? '316' : '304';
      for (const t of SIDE_TAGS) {
        const tab = get(`brake-tab-${t}`, ps);
        expect(tab.kind).toBe('lumber'); expect(tab.grain).toBe('z'); expect(tab.material).toMatch(/oak/);
        for (const n of ['brake-bolt-bottom', 'brake-bolt-top', 'brake-washer-bottom', 'brake-washer-top', 'brake-insert-bottom', 'brake-insert-top']) {
          const x = get(`${n}-${t}`, ps);
          expect(x.kind, x.id).toBe('purchased'); expect(x.fab, x.id).toBe('buy'); expect(x.material, x.id).toContain(stainless);
          expect(x.removable ?? false, x.id).toBe(!/insert/.test(n));
        }
        expect(get(`brake-bolt-bottom-${t}`, ps).material).toMatch(/3\/8-16 x 2-3\/4"/);
        expect(get(`brake-bolt-top-${t}`, ps).material).toMatch(/3\/8-16 x 2-1\/2"/);
        expect(get(`brake-insert-top-${t}`, ps).material).toMatch(/flanged threaded insert for wood, 3\/8-16/);
      }
    }
  });
  it('no D-numbers, study names or pin wording in the shop text of the new parts; bottom and top spelled out in names', () => {
    for (const t of SIDE_TAGS) for (const n of NEW_PARTS) {
      const x = get(`${n}-${t}`);
      expect(shopText(x), x.id).not.toMatch(/\bD-\d+|\bstudy\b|ball-lock|\bsleeve/i);
      expect(x.name, x.id).not.toMatch(/\b[BT]\b/);
    }
  });
});

describe('D-78 the geometry is derived from the hull, not typed', () => {
  const L = ctx.L;
  it('bottom bolt: the knee\'s center fore and aft, the rail\'s mid-height, through the knee leg and the rail; 2-3/4 in bolt (2.5 in stack + washer + two threads), insert 1/2 in long', () => {
    const b = rm.bottom;
    expect(b.x).toBeCloseTo((g.knee.x0 + g.knee.x1) / 2, 9);
    expect(b.z).toBeCloseTo((g.rail.zb + g.rail.zt) / 2, 9);
    expect(b.stack).toBeCloseTo(g.rail.t + g.knee.legT, 9);
    expect(b.need).toBeCloseTo(pp.brakeBoltWasherThickIn + b.stack + 2 / 16, 9);
    expect(b.orderLen).toBe(2.75);
    expect(b.tipPast).toBeCloseTo(b.orderLen - pp.brakeBoltWasherThickIn - b.stack, 9);
    expect(b.washer.y0).toBeCloseTo(g.y.face + g.knee.legT, 9); // on the leg's outer face
    expect(b.washer.y1 - b.washer.y0).toBeCloseTo(pp.brakeBoltWasherThickIn, 9);
    expect(b.washer.od).toBe(1);
    expect(b.yTip).toBeCloseTo(g.y.railIn - b.tipPast, 9);
    expect(b.insert.flange).toMatchObject({ y0: g.y.railIn });
    expect(b.insert.flange.y1 - g.y.railIn).toBeCloseTo(pp.brakeInsertFlangeThickIn, 9);
    expect(b.insert.len).toBe(0.5);
    expect(b.insert.woodBeyond).toBeCloseTo(g.rail.t - pp.brakeInsertFlangeThickIn - 0.5, 9);
    expect(b.insert.cboreDia).toBeCloseTo(pp.brakeInsertFlangeOdIn + 1 / 16, 9);
    expect(b.insert.cboreDepth).toBe(b.insert.flangeT);
    expect(b.fromRailRear).toBeCloseTo(b.x - (L.xRear + L.transom), 9);
    expect(b.belowRailTop).toBeCloseTo(L.railTop - b.z, 9);
    const bolt = worldAABB(get('brake-bolt-bottom-L'));
    expect((bolt.min[0] + bolt.max[0]) / 2).toBeCloseTo(b.x, 6);
    expect((bolt.min[2] + bolt.max[2]) / 2).toBeCloseTo(b.z, 6);
    expect(bolt.min[1]).toBeCloseTo(b.yTip, 6);
    expect(bolt.max[1]).toBeCloseTo(b.yHead, 6);
    expect(b.yHead - b.washer.y1).toBeCloseTo(rm.headH, 9);
  });
  it('top bolt: the box rib\'s center line, the box tie spacer top plus the clearance (about 14.5 in), through the tab, web, filler and rib block; 2-1/2 in bolt, insert 3/4 in long; 0.3 in or more under the D-ring washers', () => {
    const st = sideRibStations(ctx.p, L)[0];
    const tie = boxTieGeometry(ctx.p, L, st);
    const t = rm.top;
    expect(st.kind).toBe('box');
    expect(t.x).toBeCloseTo(st.x, 9);
    expect(t.z).toBeCloseTo(tie.z1 + pp.brakeTopBoltClearIn, 9);
    expect(t.z).toBeGreaterThan(14.2);
    expect(t.z).toBeLessThan(14.7);
    expect(rm.rib.tieTopZ).toBeCloseTo(tie.z1, 9);
    expect(t.z - t.insert.cboreDia / 2).toBeGreaterThan(tie.z1); // the counterbore is above the tie spacer
    expect(t.z + t.insert.cboreDia / 2).toBeLessThan(st.top - L.railBand);
    expect(rm.clear.tabTopToWasher).toBeGreaterThanOrEqual(pp.brakeTabClearIn - 1e-9);
    expect(t.stack).toBeCloseTo(pp.brakeTabThickIn + rm.hull.web + rm.hull.filler + rm.hull.rib, 9);
    expect(t.orderLen).toBe(2.5);
    expect(t.insert.member).toBeCloseTo(rm.hull.web + rm.hull.filler + rm.hull.rib, 9);
    expect(t.insert.len).toBe(0.75);
    expect(t.insert.flange.y0).toBeCloseTo(rm.yWebOut - t.insert.member, 9); // the rib's inner face
    expect(t.washer.y0).toBeCloseTo(rm.tab.yOut, 9); // on the tab's outer face
    expect(rm.clear.boltTipToBox).toBeGreaterThan(0.1); // the tip clears the storage box side
    expect(rm.issues).toEqual([]);
    expect(brakeRemovableIssues(ctx.p, L)).toEqual([]);
  });
  it('the box rib is a full-width block (2 in, centered on the top bolt) from 1.5 in below the bolt up to the head; the shaft, the other ribs and the tie are as before', () => {
    expect(rm.rib.w).toBe(pp.sideRibWidthIn);
    expect(rm.rib.blockW).toBeCloseTo(pp.brakeRibBlockWidthIn, 9);
    expect(pp.brakeRibBlockWidthIn).toBe(2);
    expect(rm.rib.blockZ0).toBeCloseTo(rm.top.z - pp.brakeRibBlockBelowIn, 9);
    expect(pp.brakeRibBlockBelowIn).toBe(1.5);
    const rb = worldAABB(get('side-rib-L1'));
    expect(rb.max[0] - rb.min[0]).toBeCloseTo(pp.brakeRibBlockWidthIn, 3);
    const dm = get('side-rib-L1').massLb - get('side-rib-L1', bolted).massLb;
    expect(dm).toBeGreaterThan(0);
    expect(dm).toBeLessThan(0.12);
    for (const id of ['side-rib-L2', 'side-rib-L3', 'box-tie-L']) expect(get(id).massLb, id).toBeCloseTo(get(id, bolted).massLb, 9);
    expect(get('side-rib-L1').notes).toMatch(/wide from 1-1\/2" below the top bolt hole/);
    expect(get('side-rib-L1').notes).toMatch(/up from the rib's foot/);
  });
  it('the web recess is the real one: the tab\'s inboard face is on the web\'s outer face, the knee\'s inboard face is the hull face, 0.21 in outboard of it; there is no pad', () => {
    const web = worldAABB(get('side-L-web'));
    const tab = worldAABB(get('brake-tab-L')), knee = worldAABB(get('brake-knee-L'));
    expect(rm.webRecess).toBeCloseTo(L.sideBand, 9);
    expect(rm.webRecess).toBeGreaterThan(0.2);
    expect(rm.webRecess).toBeLessThan(0.22);
    expect(tab.min[1]).toBeCloseTo(web.max[1], 4);
    expect(knee.min[1] - tab.min[1]).toBeCloseTo(rm.webRecess, 4);
    expect(knee.min[1]).toBeCloseTo(g.y.face, 9);
    expect((rm as unknown as Record<string, unknown>).pad).toBeUndefined();
  });
  it('the tab bears on the web over the box rib block (the rib and filler back the web there)', () => {
    const b = rm.tab.bearing;
    expect(b.x0).toBeCloseTo(rm.tab.x0, 9);
    expect(b.x1).toBeCloseTo(rm.tab.x1, 9);
    expect(b.z0).toBeCloseTo(rm.rib.blockZ0, 9);
    expect(b.z1).toBeCloseTo(rm.tab.z1, 9);
    expect(b.area).toBeGreaterThan(4);
    expect(b.x0).toBeGreaterThanOrEqual(rm.rib.x - rm.rib.blockW / 2 - 1e-9);
    expect(b.x1).toBeLessThanOrEqual(rm.rib.x + rm.rib.blockW / 2 + 1e-9);
  });
  it('the tab: 1 in thick, from the knee\'s rear face back to 1 in behind the top bolt, 1.2 in above it and 4.1 in tall (hanging below the bolt), grain vertical, no Dominos', () => {
    const tab = worldAABB(get('brake-tab-L'));
    expect(tab.max[0]).toBeCloseTo(g.knee.x0, 9);
    expect(tab.min[0]).toBeCloseTo(rm.top.x - pp.brakeTabEndIn, 9);
    expect(tab.max[1] - tab.min[1]).toBeCloseTo(pp.brakeTabThickIn, 9);
    expect(tab.max[2] - tab.min[2]).toBeCloseTo(pp.brakeTabHeightIn, 9);
    expect(tab.max[2]).toBeCloseTo(rm.top.z + pp.brakeTabAboveBoltIn, 9);
    expect(tab.min[2]).toBeGreaterThan(g.knee.zLeg); // stays above the chine band
    expect(get('brake-tab-L').joints!.some((j) => j.type === 'domino' || j.type === 'screw')).toBe(false);
    expect((rm.tab as unknown as Record<string, unknown>).dominos).toBeUndefined();
  });
  it('the glue patch of the tab on the knee\'s rear face is about 2.9 in2 with its center about 1.1 in under the top bolt', () => {
    const ph = rm.tab.patch;
    expect(ph.y0).toBeCloseTo(g.y.face, 9);
    expect(ph.y1).toBeCloseTo(rm.tab.yOut, 9);
    expect(ph.z1).toBeCloseTo(g.knee.zTopLeg, 9);
    expect(ph.z0).toBeCloseTo(rm.tab.z0, 9);
    expect(ph.area).toBeCloseTo((ph.y1 - ph.y0) * (ph.z1 - ph.z0), 9);
    expect(ph.area).toBeGreaterThan(2.7);
    expect(rm.tab.glueArea).toBeCloseTo(ph.area, 9);
    expect(ph.ePin).toBeCloseTo(rm.top.z - ph.zc, 9);
    expect(ph.ePin).toBeLessThan(1.3);
    expect(ph.eTab).toBeCloseTo((rm.tab.z0 + rm.tab.z1) / 2 - ph.zc, 9);
  });
  it('the knee leg stands up to 3/4 in over the top bolt (about 15.2 in) so it backs the washer; the arm and the roof keep their height; 0.2 in or more under the reflector and the D-ring washers', () => {
    expect(rm.top.z + pp.brakeKneeTopAboveBoltIn).toBeCloseTo(g.knee.zTopLeg, 9);
    expect(g.knee.zTopLeg).toBeGreaterThan(15);
    expect(g.knee.zTopLeg).toBeLessThan(15.4);
    expect(g.knee.zTop).toBeLessThan(14.2); // the arm / roof height, unchanged
    const bg = brakeGeometry(makeCtx(p0).p, makeCtx(p0).L);
    expect(g.knee.zTop).toBeCloseTo(bg.knee.zTop, 9);
    const kn = worldAABB(get('brake-knee-L')), refl = worldAABB(get('reflector-L1'));
    expect(kn.max[2]).toBeCloseTo(g.knee.zTopLeg, 6);
    expect(refl.min[2] - kn.max[2]).toBeGreaterThanOrEqual(0.2);
    expect(rm.rib.washerBotZ - kn.max[2]).toBeGreaterThanOrEqual(0.2);
    for (const o of ['reflector-L1', 'lash-L1', 'sign-L', 'wheel-RL']) expect(partsOverlap(get('brake-knee-L'), get(o)), o).toBeLessThanOrEqual(0.0001);
    expect(g.strap.zs).toEqual(bg.strap.zs); // the pocket, strap and screw positions do not move
    expect(g.pivot.zPocketTop).toBeCloseTo(bg.pivot.zPocketTop, 9);
    const geom = get('brake-knee-L').geometry as { boxes: Array<[number[], number[]]> };
    expect(Math.max(...geom.boxes.map(([, hi]) => hi[2]))).toBeCloseTo(g.knee.zTopLeg, 6);
    for (const [lo, hi] of geom.boxes) if (lo[1] >= g.y.face + g.knee.legT - 1e-9) expect(hi[2]).toBeLessThanOrEqual(g.knee.zTop + 1e-9);
  });
});

describe('D-78 overlaps and clearances', () => {
  it('the removable setting adds no unintended overlap (the inserts and bolts lie in the holes of their hosts; the tab and the knee touch face to face), also in Transport mode, at full lock and with the Brakes off', () => {
    expect(newClashes(bolted, removable)).toEqual([]);
    expect(newClashes(buildModel(p0, TRANSPORT_VIEW), buildModel(pp, TRANSPORT_VIEW))).toEqual([]);
    expect(newClashes(buildModel(p0, { steerDeg: 20 }), buildModel(pp, { steerDeg: 20 }))).toEqual([]);
    expect(newClashes(buildModel(p0, { brakes: false }), buildModel(pp, { brakes: false }))).toEqual([]);
  });
  it('the tab, washers and bolts miss the side sign, the reflector, the D-ring washers, the tire and the flap', () => {
    const tab = worldAABB(get('brake-tab-L')), sign = worldAABB(get('sign-L')), refl = worldAABB(get('reflector-L1')), tire = worldAABB(get('wheel-RL'));
    expect(sign.max[0]).toBeLessThanOrEqual(tab.min[0] - pp.brakeTabClearIn + 1e-9);
    expect(refl.min[0]).toBeGreaterThan(tab.max[0]);
    expect(tire.min[1] - tab.max[1]).toBeGreaterThan(0.2);
    expect(rm.rib.washerBotZ - tab.max[2]).toBeGreaterThanOrEqual(pp.brakeTabClearIn - 1e-9);
    for (const t of ['L', 'R']) for (const n of ['brake-tab', 'brake-bolt-bottom', 'brake-bolt-top', 'brake-washer-bottom', 'brake-washer-top']) for (const o of [`sign-${t}`, `reflector-${t}1`, `lash-${t}1`, `wheel-R${t}`, `brake-flap-${t}`, `brake-pivot-block-${t}`, `brake-shoe-${t}`, `brake-pad-${t}`, `brake-foot-tread-${t}`, `brake-cord-${t}`, `brake-pivot-pin-${t}`, `brake-chock-${t}`])
      expect(partsOverlap(get(`${n}-${t}`), get(o)), `${n}-${t} x ${o}`).toBeLessThanOrEqual(0.0001);
  });
  it('a longer side sign (set to its largest) is still cut back short of the tab', () => {
    const q = { ...pp, signLengthIn: PARAM_DEFS.signLengthIn.max } as Params;
    const ps = buildModel(q);
    const tab = worldAABB(get('brake-tab-L', ps)), sign = worldAABB(get('sign-L', ps));
    expect(sign.max[0]).toBeLessThanOrEqual(tab.min[0] - q.brakeTabClearIn + 1e-9);
  });
  it('through the whole flap stroke the flap group never meets the tab, the bolts, the washers, the inserts or the strap', () => {
    for (let i = 0; i <= 10; i++) {
      const moving = buildBrakeAt(ctx, i / 10, true).filter((x) => /-L$/.test(x.id) && /^brake-(flap|pivot-block|shoe|pad|foot-tread|cord)-/.test(x.id));
      expect(moving.length).toBeGreaterThanOrEqual(5);
      for (const m of moving) for (const n of ['brake-tab-L', 'brake-bolt-bottom-L', 'brake-bolt-top-L', 'brake-washer-bottom-L', 'brake-washer-top-L', 'brake-strap-L'])
        expect(partsOverlap(m, get(n)), `${m.id} x ${n} @${i / 10}`).toBeLessThanOrEqual(0.0001);
    }
  });
  it('the bolt tips and the 3 in2 of hull around them clear the joists, the king beam and the storage box', () => {
    for (const j of removable.filter((x) => /^joist-\d+$|^king-beam$|^storage-side-[LR]$/.test(x.id))) for (const n of ['brake-bolt-bottom-L', 'brake-bolt-top-L']) expect(partsOverlap(get(n), j), `${n} x ${j.id}`).toBeLessThanOrEqual(0.0001);
  });
});

describe('D-78 mass', () => {
  /** One knee bolt set of the D-75 knee, itemized from the model's own bolt (length from the stack, stainless density): shank, hex head 9/16 AF x 15/64, nylock nut 9/16 AF x 21/64 less the bore, one 7/8 in OD narrow washer under the head. */
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
  const sum = (ps: Part[], re: RegExp) => ps.filter((x) => re.test(x.id)).reduce((a, x) => a + x.massLb, 0);
  it('the MODEL delta (bolted default masses are unchanged: the 8 D-75 knee bolt sets sit in the hardware lump at the model\'s unit mass) is small', () => {
    const raw = totalMass(removable) - totalMass(bolted);
    expect(raw).toBeGreaterThan(-0.8);
    expect(raw).toBeLessThan(0.4);
    expect(boltLb(bolted) - boltLb(removable)).toBeGreaterThan(0.5); // the 8 bolt sets leave the lump
  });
  it('the REAL-WEIGHT delta swaps the lump\'s 8 D-75 bolt sets for itemized ones and states the saving separately', () => {
    expect(boltLen).toBeGreaterThanOrEqual(3.5);
    expect(realSetLb).toBeGreaterThan(0.15);
    expect(realSetLb).toBeLessThan(0.25);
    const modelBolts = boltLb(bolted) - boltLb(removable);
    const raw = totalMass(removable) - totalMass(bolted);
    const real = raw - (nBolts * realSetLb - modelBolts);
    expect(real).toBeLessThan(raw); // the lump understates the bolts
    expect(real).toBeGreaterThan(-1.6);
    expect(real).toBeLessThan(-0.2);
  });
  it('what leaves and what arrives: the backers and plates leave (about 0.75 lb), the tabs, bolts, washers and inserts arrive (about 1 lb)', () => {
    expect(sum(bolted, /^brake-(backer|backplate)-/)).toBeGreaterThan(0.7);
    const arrive = sum(removable, /^brake-(tab|bolt-|washer-|insert-)/);
    expect(arrive).toBeGreaterThan(0.6);
    expect(arrive).toBeLessThan(1.4);
    expect(get('brake-bolt-bottom-L').massLb).toBeGreaterThan(0.1);
    expect(get('brake-bolt-bottom-L').massLb).toBeLessThan(0.25);
  });
  it('the knee with the leg stood up over the top bolt weighs a little more than the bolted knee', () => {
    const d = get('brake-knee-L').massLb - get('brake-knee-L', bolted).massLb;
    expect(d).toBeGreaterThan(0.05);
    expect(d).toBeLessThan(0.2);
  });
  it('the removable brake kit weighs about 4 lb more (the knee and strap now come off, and the tab, bolts and washers with them)', () => {
    const kit = (ps: Part[]) => totalMass(ps) - totalMass(buildModel(ps === removable ? pp : p0, { brakes: false }));
    expect(kit(removable) - kit(bolted)).toBeGreaterThan(3.5);
    expect(kit(removable) - kit(bolted)).toBeLessThan(5);
  });
  it('the ratchet is a tool in the box, not sled mass: no part, no mass change', () => {
    expect(removable.some((x) => /ratchet/i.test(`${x.id} ${x.name}`))).toBe(false);
  });
});

describe('D-78 the ratchet rides in the storage box', () => {
  it('with the removable knees boxGear lists a ratchet and 9/16 in deep socket pouch (8 x 2 x 2 in); with the bolted knees it lists none', () => {
    const t = boxGear(removable, pp).tools;
    expect(t).toHaveLength(1);
    expect(t[0].dims).toEqual([pp.brakeRatchetLenIn, pp.brakeRatchetWidthIn, pp.brakeRatchetHeightIn]);
    expect(t[0].dims).toEqual([8, 2, 2]);
    expect(t[0].name).toMatch(/Ratchet.*9\/16 in deep socket/);
    expect(boxGear(bolted, p0).tools).toEqual([]);
    expect(boxGear(bolted, pp).tools).toEqual([]); // no knee bolts built: nothing to carry the tool for
    expect(boxGear(removable).tools).toEqual([]); // the params are needed to size it
  });
  it('the packing check places it with the 10 Essentials and the chocks, in race mode (the whole box) and in a cargo-mode layer', () => {
    const gear = boxGear(removable, pp);
    const interior = storageInterior(ctx.p, ctx.L);
    const r = packEssentials(interior, [...ESSENTIALS, ...gear.chocks, ...gear.tools]);
    expect(r.fits).toBe(true);
    expect(r.unplaced).toEqual([]);
    expect(r.placements.some((q) => /Ratchet/.test(q.name))).toBe(true);
    const r0 = packEssentials(interior, [...ESSENTIALS, ...boxGear(bolted, p0).chocks]);
    expect(r.rigidIn3 - r0.rigidIn3).toBeCloseTo(8 * 2 * 2, 6);
    // a layer as thick as the ratchet pouch is enough (cargo mode packs the loose gear in a layer above the stowed seat)
    const layer = packEssentials({ lx: interior.lx, w: interior.w, h: 2.5, capIn3: 0, totalIn3: interior.lx * interior.w * 2.5 }, [...gear.chocks, ...gear.tools]);
    expect(layer.placements.some((q) => /Ratchet/.test(q.name))).toBe(true);
  });
});

describe('D-78 the no-fabrication rule for metal', () => {
  it('no metal part, in either setting and either weather spec, asks for more than buying, cutting or drilling', () => {
    for (const w of [0, 1]) for (const k of [0, 1]) expect(noFabViolations(buildModel({ ...p0, weatherSpec: w, kneeMount: k } as Params)), `weather ${w} knee ${k}`).toEqual([]);
  });
});

describe('D-78 removable: the Brakes toggle and Transport mode', () => {
  it('the kit regex matches the knee-side parts (not the inserts); the knee and strap join the kit only when they are flagged removable', () => {
    for (const t of SIDE_TAGS) {
      for (const n of KNEE_SIDE_PARTS) expect(BRAKE_KIT_RE.test(`${n}-${t}`), `${n}-${t}`).toBe(true);
      for (const n of HULL_PARTS) expect(BRAKE_KIT_RE.test(`${n}-${t}`), `${n}-${t}`).toBe(false);
      for (const n of ['brake-knee', 'brake-strap']) { expect(BRAKE_KIT_RE.test(`${n}-${t}`)).toBe(false); expect(isBrakeKit({ id: `${n}-${t}` })).toBe(false); expect(isBrakeKit({ id: `${n}-${t}`, removable: true })).toBe(true); }
    }
    expect(removable.filter((x) => BRAKE_KIT_RE.test(x.id))).toHaveLength(18 + 2 * KNEE_SIDE_PARTS.length);
    expect(bolted.filter((x) => BRAKE_KIT_RE.test(x.id))).toHaveLength(18);
    expect(isBrakeKit(get('brake-knee-L', bolted))).toBe(false);
    expect(isBrakeKit(get('brake-knee-L'))).toBe(true);
  });
  it('removable flags: the knee, strap, tab, bolts and washers are removable, the inserts are not; bolted, none of the knee is', () => {
    for (const t of SIDE_TAGS) {
      for (const n of ['brake-knee', 'brake-strap', ...KNEE_SIDE_PARTS]) expect(get(`${n}-${t}`).removable, `${n}-${t}`).toBe(true);
      for (const n of HULL_PARTS) expect(get(`${n}-${t}`).removable ?? false, `${n}-${t}`).toBe(false);
      for (const n of ['brake-knee', 'brake-strap', 'brake-backer', 'brake-backplate']) expect(get(`${n}-${t}`, bolted).removable ?? false, `${n}-${t}`).toBe(false);
    }
  });
  it('Brakes off takes the whole kit, the knee and strap included, and leaves the inserts, the chocks and the rest', () => {
    const off = ids(buildModel(pp, { brakes: false }));
    const gone = removable.filter((x) => !off.has(x.id)).map((x) => x.id).sort();
    expect(gone).toEqual(removable.filter((x) => isBrakeKit(x)).map((x) => x.id).sort());
    expect(gone).toContain('brake-knee-L');
    expect(gone).toContain('brake-tab-R');
    for (const t of SIDE_TAGS) for (const n of HULL_PARTS) expect(off.has(`${n}-${t}`)).toBe(true);
    expect(off.has('brake-chock-L')).toBe(true);
  });
  it('Transport mode shows a flush hull: no brake part but the two inserts is left, each flush with the hull face, and nothing sticks out of the rear sides past the hull face but the wheels, the signs and the reflectors', () => {
    const t = buildModel(pp, { rider: 'none', cargo: false, ...TRANSPORT_VIEW });
    const have = ids(t);
    for (const s of SIDE_TAGS) {
      for (const n of ['brake-knee', 'brake-strap', ...KNEE_SIDE_PARTS, 'brake-flap', 'brake-chock']) expect(have.has(`${n}-${s}`), `${n}-${s}`).toBe(false);
      for (const n of HULL_PARTS) expect(have.has(`${n}-${s}`), `${n}-${s}`).toBe(true);
    }
    const face = g.y.face + 0.07;
    for (const x of t.filter((q) => /^brake-/.test(q.id))) { const b = worldAABB(x); expect(Math.max(Math.abs(b.min[1]), Math.abs(b.max[1])), x.id).toBeLessThanOrEqual(face); }
    // the top insert's outer end is inside the hull (the rib), the bottom's inside the rail: nothing but the flange faces show on the inboard side
    expect(worldAABB(get('brake-insert-top-L', t)).max[1]).toBeLessThan(g.y.face);
    const out = t.filter((x) => { const b = worldAABB(x); return b.max[0] > 3 && b.min[0] < 11 && b.max[2] < 40 && Math.max(Math.abs(b.min[1]), Math.abs(b.max[1])) > face; }).map((x) => x.id);
    for (const id of out) expect(id, id).toMatch(/^(wheel-R[LR]|sign-[LR]|reflector-[LR]\d)$/);
    expect(ids(buildModel(p0, { rider: 'none', cargo: false, ...TRANSPORT_VIEW })).has('brake-knee-L')).toBe(true);
  });
  it('the chock cord eye goes with the knee: the chocks are removable already', () => {
    for (const s of SIDE_TAGS) { expect(get(`brake-chock-${s}`).removable).toBe(true); expect(get(`brake-chock-cord-${s}`).removable).toBe(true); }
  });
});

describe('D-78 joints reference real parts with measured locations', () => {
  const have = ids(removable);
  const finite = (v: number[]) => v.every(Number.isFinite);
  it('every joint of every new part names a part that is in the model and carries its location', () => {
    for (const s of SIDE_TAGS) for (const n of NEW_PARTS) {
      const x = get(`${n}-${s}`);
      expect(x.joints?.length ?? 0, x.id).toBeGreaterThan(0);
      for (const j of x.joints!) { expect(have.has(j.to), `${x.id} -> ${j.to}`).toBe(true); expect(j.at?.length ?? 0, `${x.id} -> ${j.to}`).toBeGreaterThan(0); for (const a of j.at!) expect(finite(a)).toBe(true); }
    }
  });
  it('the hosts record the holes and the bolts/inserts record the thread, from both ends', () => {
    for (const s of SIDE_TAGS) {
      expect(get(`rail-${s}`).joints!.some((j) => j.to === `brake-insert-bottom-${s}` && j.cut?.kind === 'counterbore')).toBe(true);
      expect(get(`side-rib-${s}1`).joints!.some((j) => j.to === `brake-insert-top-${s}` && j.cut?.kind === 'counterbore')).toBe(true);
      expect(get(`brake-knee-${s}`).joints!.some((j) => j.to === `brake-bolt-bottom-${s}` && j.type === 'hole')).toBe(true);
      expect(get(`brake-tab-${s}`).joints!.some((j) => j.to === `brake-bolt-top-${s}` && j.type === 'hole')).toBe(true);
      for (const k of ['bottom', 'top']) {
        expect(get(`brake-bolt-${k}-${s}`).joints!.some((j) => j.to === `brake-insert-${k}-${s}`)).toBe(true);
        expect(get(`brake-bolt-${k}-${s}`).joints!.some((j) => j.to === `brake-washer-${k}-${s}`)).toBe(true);
        expect(get(`brake-insert-${k}-${s}`).joints!.some((j) => j.to === `brake-bolt-${k}-${s}`)).toBe(true);
      }
    }
  });
  it('the host hole points land on the bolt axes at the measured places', () => {
    for (const [s, sg] of [['L', 1], ['R', -1]] as const) {
      const pt = (id: string, to: string, kind?: string): number[] => { const j = get(id).joints!.find((q) => q.to === to && q.at && (!kind || q.cut?.kind === kind))!; return transformPoint(get(id).transform, j.at![0]); };
      const rail = pt(`rail-${s}`, `brake-insert-bottom-${s}`, 'counterbore');
      expect(rail[0]).toBeCloseTo(rm.bottom.x, 6); expect(rail[2]).toBeCloseTo(rm.bottom.z, 6); expect(rail[1]).toBeCloseTo(sg * g.y.railIn, 6);
      const rib = pt(`side-rib-${s}1`, `brake-insert-top-${s}`, 'counterbore');
      expect(rib[0]).toBeCloseTo(rm.top.x, 3); expect(rib[2]).toBeCloseTo(rm.top.z, 6); expect(Math.abs(rib[1])).toBeCloseTo(rm.top.insert.flange.y0, 6);
      const knee = pt(`brake-knee-${s}`, `brake-bolt-bottom-${s}`);
      expect(knee[0]).toBeCloseTo(rm.bottom.x, 6); expect(knee[2]).toBeCloseTo(rm.bottom.z, 6); expect(knee[1]).toBeCloseTo(sg * g.y.face, 6);
      const tab = pt(`brake-tab-${s}`, `brake-bolt-top-${s}`);
      expect(tab[0]).toBeCloseTo(rm.top.x, 6); expect(tab[2]).toBeCloseTo(rm.top.z, 6);
      for (const k of ['bottom', 'top']) { const bolt = get(`brake-bolt-${k}-${s}`); const bb = worldAABB(bolt); for (const j of bolt.joints!) { const w = transformPoint(bolt.transform, j.at![0]); for (let a = 0; a < 3; a++) { expect(w[a]).toBeGreaterThanOrEqual(bb.min[a] - 1e-6); expect(w[a]).toBeLessThanOrEqual(bb.max[a] + 1e-6); } } }
    }
  });
  it('the shop text of the hosts gives measured places: distances from the rail\'s rear end and top edge, and from the rib\'s bottom end and gunwale top', () => {
    const rj = get('rail-L').joints!.find((j) => j.to === 'brake-insert-bottom-L')!;
    expect(rj.size).toContain(`${(Math.round(rm.bottom.fromRailRear * 100) / 100).toString()}"`);
    expect(rj.size).toMatch(/rear end/); expect(rj.size).toMatch(/top edge/);
    const bj = get('side-rib-L1').joints!.find((j) => j.to === 'brake-insert-top-L')!;
    expect(bj.size).toMatch(/up from the rib's bottom end/); expect(bj.size).toMatch(/gunwale top/);
  });
});

describe('D-78 the frame has no backer cutback and the hull builds in the other settings', () => {
  it('a joist that meets the bolted backer is cut back for it; with the removable knee there is no backer and no cutback', () => {
    let found = 0;
    for (let sp = 6; sp <= 12; sp += 0.25) {
      const q = { ...p0, crossmemberSpacingIn: sp } as Params;
      const pb = buildModel(q), pk = buildModel({ ...q, kneeMount: KNEE_MOUNT.removable } as Params);
      for (const j of pb.filter((x) => /^joist-\d+$/.test(x.id) && /brake knee backers/.test(x.notes ?? ''))) {
        found++;
        expect(get(j.id, pk).notes ?? '', `${j.id} @${sp}`).not.toMatch(/brake knee backers/);
        const hb = worldAABB(j), hk = worldAABB(get(j.id, pk));
        expect(hk.max[1] - hk.min[1]).toBeGreaterThan(hb.max[1] - hb.min[1] + 0.1);
      }
    }
    expect(found).toBeGreaterThan(0);
  });
  it('with the box under the seat there is no box rib: the knee stays bolted (no removable block, bolted parts) and the validator says so', () => {
    const q = { ...pp, storageLocation: 2 } as Params;
    const c = makeCtx(q);
    const b = brakeGeometry(c.p, c.L);
    expect(b.mount).toBe('bolted');
    expect(b.removable).toBeUndefined();
    expect(brakeRemovableIssues(c.p, c.L).join(' ')).toMatch(/box rib/);
    const ps = buildModel(q);
    expect(ids(ps).has('brake-backer-L')).toBe(true);
    expect(ids(ps).has('brake-tab-L')).toBe(false);
    expect(boxGear(ps, q).tools).toEqual([]);
    expect(validateParams(q).some((i) => i.severity === 'warn' && i.keys.includes('kneeMount'))).toBe(true);
  });
});

describe('D-78 validateParams and the geometry issues', () => {
  it('the removable setting at the defaults is clean (no errors or warnings), as is the bolted default', () => {
    expect(validateParams(pp).filter((i) => i.severity !== 'info')).toEqual([]);
    expect(validateParams(p0).filter((i) => i.severity !== 'info')).toEqual([]);
  });
  it('a clearance hole no bigger than the bolt, a flange that is no flange, a small washer or a tab with no end distance are flagged (only when the knees are removable)', () => {
    expect(validateParams({ ...pp, brakeBoltClearHoleIn: 0.375 } as Params).filter((i) => i.severity === 'error' && i.keys.includes('brakeBoltClearHoleIn'))).toHaveLength(1);
    expect(validateParams({ ...pp, brakeInsertFlangeOdIn: 0.625 } as Params).filter((i) => i.severity === 'error' && i.keys.includes('brakeInsertFlangeOdIn'))).toHaveLength(1);
    expect(validateParams({ ...pp, brakeBoltWasherOdIn: 0.5 } as Params).filter((i) => i.severity === 'warn' && i.keys.includes('brakeBoltWasherOdIn'))).toHaveLength(1);
    expect(validateParams({ ...pp, brakeTabEndIn: 0.4 } as Params).filter((i) => i.severity === 'warn' && i.keys.includes('brakeTabEndIn'))).toHaveLength(1);
    expect(validateParams({ ...p0, brakeBoltClearHoleIn: 0.375 } as Params).filter((i) => i.keys.includes('brakeBoltClearHoleIn'))).toEqual([]);
  });
  it('the hull-dependent checks catch a tab that reaches the D-ring washers, a counterbore down on the tie spacer, and nothing at all when bolted', () => {
    const c = makeCtx({ ...pp, brakeTabAboveBoltIn: 2 } as Params);
    expect(brakeRemovableIssues(c.p, c.L).join(' ')).toMatch(/D-ring washers/);
    const c2 = makeCtx({ ...pp, brakeTopBoltClearIn: 0.5 } as Params);
    expect(brakeRemovableIssues(c2.p, c2.L).join(' ')).toMatch(/box tie spacer/);
    expect(brakeRemovableIssues(makeCtx(p0).p, makeCtx(p0).L)).toEqual([]);
  });
});
