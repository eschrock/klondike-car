/**
 * The D-57 body: the sheer (a concave sweep from the low bow up to the tall rear), the plan turn-in toward the bow (plan-curved chine, gunwale, web, rails and deck), the shaped oak
 * bow bulkhead with its lift hand-hold (it replaced the D-54 bow curl), the rear transom with its lift slot, the scuppers and the signs. Expected numbers are re-derived from the
 * params, not read back from the builder.
 */
import { describe, expect, it } from 'vitest';
import { bowBulkhead, bowTurnInAt, defaultParams, sideHeightAt, thinSheet, validateParams, type Params } from '../params';
import { buildModel } from './index';
import { computeLayout, innerHalfWidth, outerHalfWidth, sideHeightAtX, sideSlopeAt, sideTopAt, webTopAt } from './layout';
import { bowHold, bulkheadOutline, liftBarStressPsi, liftSlot, scupperSites, signPlacement, SIGN_X_MAX_IN } from './body';
import { makeCtx } from './build-utils';
import { brakeGeometry } from './brake-layout';
import { worldAABB } from './bounds';
import type { Part, Vec2 } from './types';

const defaults = defaultParams();
const L = computeLayout(defaults);
const parts = buildModel(defaults);
const get = (ps: Part[], id: string) => {
  const x = ps.find((q) => q.id === id);
  if (!x) throw new Error(`no part ${id}`);
  return x;
};
const outlineOf = (x: Part): Vec2[] => {
  if (x.geometry.type !== 'extrusion') throw new Error(`${x.id} is not an extrusion`);
  return x.geometry.outline;
};
const errorsOf = (p: Params) => validateParams(p).filter((i) => i.severity === 'error');
/** Errors that name one of the D-57 body params (the front end and brake have their own tests). */
const ownErrors = (p: Params) => errorsOf(p).filter((i) => i.keys.some((k) => /^(side|sheer|bow|rail|lift|foot|seat|rider|storage|body|handle|flag|grab)/.test(k)));
/** Vertices of a plan-wall mesh part (model frame). */
const verts = (x: Part): Array<[number, number, number]> => {
  if (x.geometry.type !== 'mesh') throw new Error(`${x.id} is not a mesh`);
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < x.geometry.positions.length; i += 3) out.push([x.geometry.positions[i], x.geometry.positions[i + 1], x.geometry.positions[i + 2]]);
  return out;
};
/** Top edge of a plan wall as (x, z), highest vertex at each x. */
const topEdge = (x: Part): Vec2[] => {
  const m = new Map<string, Vec2>();
  for (const [vx, , vz] of verts(x)) { const k = vx.toFixed(6); const q = m.get(k); if (!q) m.set(k, [vx, vz]); else q[1] = Math.max(q[1], vz); }
  return [...m.values()].sort((a, b) => a[0] - b[0]);
};
/** Outer-face y (|y| max) of a wall at x. */
const outerYAt = (x: Part, at: number): number => {
  let best = 0, bd = Infinity;
  for (const [vx, vy] of verts(x)) if (Math.abs(vx - at) < bd - 1e-9 || (Math.abs(Math.abs(vx - at) - bd) < 1e-9 && Math.abs(vy) > best)) { bd = Math.abs(vx - at); best = Math.abs(vy); }
  return best;
};

// The same numbers by hand, from the defaults: rear transom outer face x = -10, 1/2 in thick (D-60); bow tip at 44 + 6.75 = 50.75, bulkhead 1.5 in thick (D-60) so the flat deck ends at 49.25.
const xRear = -defaults.rearOverhangIn;
const xSideStart = xRear + defaults.transomThicknessIn; // -9.25
const xTip = defaults.wheelbaseIn + defaults.frontOverhangIn; // 50.75
const xFlatEnd = xTip - defaults.bowBulkheadThickIn; // 49.25
const xSideEnd = xFlatEnd;
const hw = defaults.bodyWidthIn / 2 - defaults.sideThicknessIn; // inside half width 11.375

describe('layout numbers (D-54, D-57)', () => {
  it('the hand-derived flat deck end, side end and tip match the layout; the bulkhead is the last 1.5 in (D-60)', () => {
    expect(L.xRear).toBe(xRear);
    expect(L.xSideStart).toBeCloseTo(xSideStart, 12);
    expect(L.xFront).toBeCloseTo(xTip, 12);
    expect(L.xFlatEnd).toBeCloseTo(xFlatEnd, 9);
    expect(L.xSideEnd).toBeCloseTo(xSideEnd, 9);
    expect(bowBulkhead(defaults)).toEqual({ thick: 1.5, xTip: 50.75, xFlatEnd: 49.25 });
    expect(L.bulkhead.x0).toBe(49.25);
    expect(L.bulkhead.x1).toBe(50.75);
    expect(L.hwC).toBeCloseTo(hw, 12);
    expect(L.deckTop).toBe(8); // D-56
    expect(L.sideRear).toBe(14);
    expect(L.sideH).toBe(4);
    expect(L.sideTop).toBe(22);
  });
});

const RAD = Math.PI / 180;
describe('the plan taper (D-57, D-66)', () => {
  const T = L.taper;
  const turn = (defaults.bodyWidthIn - defaults.bowWidthIn) / 2; // 2.75 in a side: 18.5 in outside at the bow
  it('is 0 behind the taper start (x = 20), the full 2.75 in from its derived end (x1) to the bulkhead face, half of it half way, and smooth (zero slope AND zero curvature at both ends)', () => {
    expect(T.x0).toBe(defaults.bowTaperStartIn);
    expect(bowTurnInAt(defaults, 0)).toBe(0);
    expect(bowTurnInAt(defaults, T.x0)).toBe(0);
    expect(bowTurnInAt(defaults, T.x1)).toBeCloseTo(turn, 12);
    expect(bowTurnInAt(defaults, 49.25)).toBeCloseTo(turn, 12);
    expect(bowTurnInAt(defaults, (T.x0 + T.x1) / 2)).toBeCloseTo(turn / 2, 12);
    expect(bowTurnInAt(defaults, 60)).toBeCloseTo(turn, 12); // clamped beyond the face
    expect(bowTurnInAt(defaults, T.x0 + 0.01) - bowTurnInAt(defaults, T.x0)).toBeLessThan(1e-8);
    expect(L.turnIn(40)).toBe(bowTurnInAt(defaults, 40));
    expect(innerHalfWidth(L, 15)).toBeCloseTo(hw, 12);
    expect(innerHalfWidth(L, 49.25)).toBeCloseTo(hw - turn, 12);
    expect(outerHalfWidth(L, 49.25)).toBeCloseTo(12 - turn, 12);
    expect(outerHalfWidth(L, 49.25) * 2).toBeCloseTo(defaults.bowWidthIn, 12);
  });
  it('the taper is gradual: it starts around mid-cabin and takes about 22 in; the steepest the side ever turns is about 13 degrees; the tightest bend radius is 31 in against the 9.4 in cold-bend limit of a 0.234 in band', () => {
    expect(T.x0).toBeGreaterThanOrEqual(20);
    expect(T.x1 - T.x0).toBeGreaterThan(20);
    let maxSlope = 0;
    for (let x = T.x0; x <= T.x1; x += 0.05) maxSlope = Math.max(maxSlope, Math.abs(bowTurnInAt(defaults, x + 0.05) - bowTurnInAt(defaults, x)) / 0.05);
    expect(Math.atan(maxSlope) / RAD).toBeLessThan(14);
    expect(T.minRadiusIn).toBeGreaterThan(30);
    expect(T.minRadiusIn).toBeGreaterThan(defaults.hullLamMinRadiusFactor * L.sideBand);
    // the numeric curvature agrees with the closed form turn x 10/sqrt(3) / length^2
    let kMax = 0;
    for (let x = T.x0 + 0.5; x < T.x1 - 0.5; x += 0.1) kMax = Math.max(kMax, Math.abs(bowTurnInAt(defaults, x + 0.1) - 2 * bowTurnInAt(defaults, x) + bowTurnInAt(defaults, x - 0.1)) / 0.01);
    expect(1 / kMax).toBeCloseTo(T.minRadiusIn, 0);
  });
  it('the chine, gunwale, web and rail of both sides follow it: outer face at 12 in behind x = 20 and 9.25 in (18.5 in outside) at the bulkhead, mirrored exactly', () => {
    for (const [tag, sg] of [['L', 1], ['R', -1]] as const) {
      for (const [part, thick] of [['side-chine', L.side], ['side-gunwale', L.side], ['rail', defaults.railThicknessIn]] as const) {
        const id = part === 'rail' ? `rail-${tag}` : `side-${tag}-${part.slice(5)}`;
        const x = get(parts, id);
        for (const at of [0, 20, 30, 38, 48.9]) expect(Math.abs(outerYAt(x, at) - (12 - bowTurnInAt(defaults, at))), `${id} @ ${at}`).toBeLessThan(0.11); // nearest vertex, up to 0.75 in away on the curve
        const b = worldAABB(x);
        expect(sg > 0 ? b.max[1] : -b.min[1], id).toBeCloseTo(12, 6);
        void thick;
      }
      const web = get(parts, `side-${tag}-web`);
      const wb = verts(web).filter(([vx]) => Math.abs(vx - (49.25 + defaults.deckCaptureDepthIn)) < 0.01); // the web's front end is in the bulkhead dado (round 2)
      expect(wb.length).toBeGreaterThan(2);
      const ys = wb.map(([, vy]) => Math.abs(vy));
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(thinSheet(defaults).thicknessIn, 6);
      expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(hw + L.side / 2 - turn, 6);
    }
    const a = worldAABB(get(parts, 'side-L-gunwale')), b = worldAABB(get(parts, 'side-R-gunwale'));
    expect(a.min[1]).toBeCloseTo(-b.max[1], 9);
    expect(a.max[0]).toBeCloseTo(b.max[0], 12);
  });
  it('the deck outline follows the turn-in (square at the rear, narrower at the front, one sheet inside 4 x 8) and ends in the bulkhead dado', () => {
    const d = get(parts, 'deck');
    const o = outlineOf(d);
    const dd = defaults.deckCaptureDepthIn;
    for (const q of o) expect(Math.abs(q[1]), `x=${q[0].toFixed(2)}`).toBeCloseTo(hw + L.deckEdge - bowTurnInAt(defaults, Math.min(q[0], xFlatEnd)), 9);
    const b = worldAABB(d);
    expect(b.min[0]).toBeCloseTo(xSideStart - dd, 9);
    expect(b.max[0]).toBeCloseTo(xFlatEnd + dd, 9);
    expect(b.max[0] - b.min[0]).toBeLessThanOrEqual(96);
    expect(b.max[1] - b.min[1]).toBeLessThanOrEqual(48);
    expect(d.edges).toBe('captured');
  });
  it('with no taper (a 24 in bow) the sides are parallel again and every width is the full 24 in', () => {
    const p = { ...defaults, bowWidthIn: 24 };
    const m = buildModel(p);
    for (const at of [0, 30, 48.9]) expect(outerYAt(get(m, 'side-L-gunwale'), at)).toBeCloseTo(12, 6);
    expect(computeLayout(p).bulkhead.halfW).toBe(12);
  });
  it('the chine is a constant 1.5 in band at deck level and the rail runs to the bulkhead face; both ends are exact', () => {
    const c = worldAABB(get(parts, 'side-L-chine'));
    expect(c.min[0]).toBeCloseTo(xSideStart, 9);
    expect(c.max[0]).toBeCloseTo(xSideEnd, 9);
    expect(c.min[2]).toBeCloseTo(L.deckBot, 9);
    expect(c.max[2] - c.min[2]).toBeCloseTo(defaults.railBandIn, 9);
    const r = worldAABB(get(parts, 'rail-L'));
    expect(r.min[0]).toBeCloseTo(xSideStart, 9);
    expect(r.max[0]).toBeCloseTo(xFlatEnd, 9);
    expect(r.max[2]).toBeCloseTo(L.deckBot, 9);
  });
});

describe('the sheer (D-57)', () => {
  const sheer = (s: number) => ({ ...defaults, sheerCurveIn: s });
  const u = (x: number) => (x - xSideStart) / (xSideEnd - xSideStart);
  const hAt = (x: number, s = 2.5) => 14 + (4 - 14) * u(x) - 4 * s * u(x) * (1 - u(x));

  it('the gunwale top follows 14 in at the rear transom down to 4 in at the bulkhead, sagging 2.5 in below the straight line at mid-length', () => {
    for (const tag of ['L', 'R']) {
      const top = topEdge(get(parts, `side-${tag}-gunwale`));
      expect(top.length).toBeGreaterThan(20);
      expect(top[0][0]).toBeCloseTo(xSideStart, 9);
      expect(top[top.length - 1][0]).toBeCloseTo(xSideEnd, 9);
      for (const [x, z] of top) expect(z - L.deckTop, `${tag} x=${x.toFixed(2)}`).toBeCloseTo(hAt(x), 9);
      expect(top[0][1] - L.deckTop).toBeCloseTo(14, 9);
      expect(top[top.length - 1][1] - L.deckTop).toBeCloseTo(4, 9);
    }
    const mid = xSideStart + (xSideEnd - xSideStart) / 2;
    expect(sideHeightAtX(L, mid)).toBeCloseTo(9 - 2.5, 9); // 9 in on the straight line, 2.5 in lower
  });
  it('it is concave: the slope is shallow at the bow (level with the default sag) and twice the straight-line slope at the rear', () => {
    const run = xSideEnd - xSideStart;
    expect(sideSlopeAt(L, xSideEnd - 0.2)).toBeCloseTo(0, 1);
    expect(sideSlopeAt(L, xSideStart + 0.2)).toBeCloseTo(Math.atan(20 / run), 1);
    // monotone: the sheer never rises toward the bow
    let prev = Infinity;
    for (let x = xSideStart; x <= xSideEnd; x += 1) { const h = sideHeightAtX(L, x); expect(h).toBeLessThanOrEqual(prev + 1e-9); prev = h; }
    // second difference positive = concave up
    for (const x of [0, 15, 30]) expect(sideHeightAtX(L, x - 1) - 2 * sideHeightAtX(L, x) + sideHeightAtX(L, x + 1)).toBeGreaterThan(0);
  });
  it('is the same curve in the layout helpers and in params.sideHeightAt; the web (full height, D-62) stops sideWebCapIn under the gunwale top', () => {
    for (const x of [-9.25, -3, 0, 10, 25, 40, 49]) {
      expect(sideHeightAtX(L, x), `${x}`).toBeCloseTo(hAt(x), 9);
      expect(sideTopAt(L, x)).toBeCloseTo(L.deckTop + hAt(x), 9);
      expect(sideHeightAt(defaults, x, xSideStart, xSideEnd)).toBeCloseTo(hAt(x), 9);
      expect(webTopAt(L, x)).toBeCloseTo(L.deckTop + hAt(x) - defaults.railBandIn, 9);
    }
    for (const tag of ['L', 'R']) {
      const gun = topEdge(get(parts, `side-${tag}-gunwale`));
      const web = topEdge(get(parts, `side-${tag}-web`));
      let n = 0;
      for (const [x, z] of web) {
        if (x < xSideStart || x > xSideEnd + 1e-9) continue;
        n++;
        expect(z, `${tag} web top x=${x.toFixed(2)}`).toBeCloseTo(L.deckTop + hAt(x) - defaults.sideWebCapIn, 9);
      }
      expect(n).toBeGreaterThan(20);
      expect(gun.length).toBeGreaterThan(20);
      expect(get(parts, `side-${tag}-web`).edges).toBe('captured');
    }
  });
  it('sheerCurveIn 0 is the straight D-54 line; a larger value sags more by exactly 4 * sag * u * (1 - u)', () => {
    for (const s of [0, 1, 4]) {
      const p = sheer(s);
      const Lp = computeLayout(p);
      for (const x of [-5, 10, 30]) expect(sideHeightAtX(Lp, x), `${s} ${x}`).toBeCloseTo(14 - 10 * u(x) - 4 * s * u(x) * (1 - u(x)), 9);
      for (const tag of ['L', 'R']) for (const [x, z] of topEdge(get(buildModel(p), `side-${tag}-gunwale`))) expect(z - Lp.deckTop).toBeCloseTo(14 - 10 * u(x) - 4 * s * u(x) * (1 - u(x)), 9);
    }
  });
  it('the rear transom is as tall as the rear side (14 in above the deck at its corners, a crown more at the middle)', () => {
    const t = worldAABB(get(parts, 'transom-rear'));
    expect(t.max[2]).toBeCloseTo(L.deckTop + 14 + defaults.transomCrownIn, 9);
    expect(liftSlot(makeCtx(defaults)).transomTop).toBeCloseTo(L.deckTop + 14, 9);
    expect(topEdge(get(parts, 'side-L-gunwale'))[0][1]).toBeCloseTo(L.deckTop + 14, 9);
  });
  it('lowering or raising the two heights moves the profile (sideHeightBowIn 5, sideHeightRearIn 12)', () => {
    const p = { ...defaults, sideHeightBowIn: 5, sideHeightRearIn: 12, handleSocketDepthIn: 18 }; // a 12 in rear side sinks the parked handle 11.8 in: the 14 in socket would leave 1.7 in (E1, handleInsertion)
    expect(ownErrors(p)).toEqual([]);
    const top = topEdge(get(buildModel(p), 'side-L-gunwale'));
    expect(top[0][1] - defaults.deckHeightIn).toBeCloseTo(12, 9);
    expect(top[top.length - 1][1] - defaults.deckHeightIn).toBeCloseTo(5, 9);
  });
});

describe('the bow bulkhead and its hand-hold (D-57)', () => {
  const b = get(parts, 'bow-bulkhead');
  const o = bulkheadOutline(makeCtx(defaults));
  it('replaces the bow curl and the foot-stop bar: no bow-curl, foot-stop or foot-stop-cleat part exists', () => {
    expect(parts.some((x) => /^(bow-curl|foot-stop)/.test(x.id))).toBe(false);
    expect(b.material).toBe('white oak');
    expect(b.group).toBe('body');
  });
  it('is 1.5 in thick (D-60; was 1.75) from the end of the flat deck to the bow tip, as wide as the narrowed hull, aligned with the sides (D-69): bottom at the bottom of the stepped front rail, corners 4 in over the deck (the side top at the bow), crown 7/8 in higher (the handlebow crown)', () => {
    const bb = worldAABB(b);
    expect(bb.min[0]).toBeCloseTo(49.25, 9);
    expect(bb.max[0]).toBeCloseTo(50.75, 9);
    expect(bb.max[1]).toBeCloseTo(9.25, 9);
    expect(bb.min[1]).toBeCloseTo(-9.25, 9);
    expect(bb.max[2]).toBeCloseTo(L.deckTop + 4.875, 9);
    expect(bb.min[2]).toBeCloseTo(L.bulkhead.bot, 9);
    // D-69: bottom = the bottom of the sides (the deck underside, deckTop - ply), corners = the side top at the bow, crown peaks handleBowCrownIn above the corners
    expect(L.bulkhead.bot).toBeCloseTo(L.deckBot - L.railDepthF, 12);
    for (const tag of ['L', 'R']) {
      const side = worldAABB(get(parts, `side-${tag}-chine`));
      const gun = get(parts, `side-${tag}-gunwale`);
      expect(side.min[2], 'side bottom (chine)').toBeCloseTo(L.deckBot, 9);
      expect(side.min[2] - L.bulkhead.bot, 'the bulkhead reaches the rail bottom below the chine').toBeCloseTo(L.railDepthF, 9);
      expect(topEdge(gun).slice(-1)[0][1], 'side top at the bow').toBeCloseTo(L.bulkhead.zCorner, 9);
    }
    expect(L.bulkhead.zCorner).toBeCloseTo(L.deckTop + defaults.sideHeightBowIn, 12);
    // the lowered bulkhead clears everything that swings or runs under the bow (the tongue is fixed in z, so its gap holds through the whole steering sweep): a 1/4 in running gap at least
    const tongue = worldAABB(get(parts, 'bridle-tongue'));
    expect(L.bulkhead.bot - tongue.max[2]).toBeGreaterThanOrEqual(0.25);
    // 3c-5: the bulkhead's crown is the handlebow's crown (the same param), so the two echo each other
    expect(L.bulkhead.zCenter - L.bulkhead.zCorner).toBeCloseTo(defaults.handleBowCrownIn, 12);
    const c2 = makeCtx({ ...defaults, handleBowCrownIn: 1.5 });
    expect(c2.L.bulkhead.zCenter - c2.L.bulkhead.zCorner).toBeCloseTo(1.5, 12);
    expect(c2.L.bulkhead.zCorner).toBeCloseTo(L.bulkhead.zCorner, 12); // the crown moves only the peak
    expect(o.halfW).toBeCloseTo(9.25, 12);
    // the sides end exactly at its rear face (the gunwale's top at the face is the corner height)
    expect(topEdge(get(parts, 'side-L-gunwale')).slice(-1)[0][1] - L.deckTop).toBeCloseTo(4, 9);
    for (const tag of ['L', 'R']) expect(worldAABB(get(parts, `side-${tag}-gunwale`)).max[0]).toBeCloseTo(49.25, 9);
  });
  it('has the lift hand-hold (D-69): a 4.5 x 1.25 in stadium on the centerline under the crown with 3/4 in of oak above it, so 2.875 in of hand room over the deck; the layout publishes it for the lift row', () => {
    const hole = (b.geometry as { holes?: Vec2[][] }).holes![0];
    const ys = hole.map((q) => q[0]), zs = hole.map((q) => q[1]);
    expect(Math.min(...ys)).toBeCloseTo(-2.25, 9);
    expect(Math.max(...ys)).toBeCloseTo(2.25, 9);
    expect(Math.min(...zs)).toBeCloseTo(L.deckTop + 2.875, 9);
    expect(Math.max(...zs)).toBeCloseTo(L.deckTop + 2.875 + 1.25, 9);
    expect(L.hold).toMatchObject({ x0: 49.25, x1: 50.75, halfLen: 2.25 });
    expect(L.hold.zBot).toBeCloseTo(L.deckTop + 2.875, 9);
    expect(L.hold.zTop).toBeCloseTo(L.bulkhead.zCenter - defaults.liftBarMinIn, 9);
    expect(L.hold.zBot - L.deckTop).toBeGreaterThanOrEqual(defaults.bowHoldMinClearIn);
    const hs = bowHold(makeCtx(defaults));
    expect(hs.barIn).toBeCloseTo(defaults.liftBarMinIn, 9); // 3/4 in of oak above it at the center
    expect(hs.thickIn).toBe(1.5);
    expect(liftBarStressPsi(hs, 100)).toBeGreaterThan(0);
  });
  it('is glued to the deck edge in a dado and to the rail ends, chine, gunwale and web ends; the front lamp clip plugs its hand-hold', () => {
    const to = new Set((b.joints ?? []).map((j) => j.to));
    for (const id of ['deck', 'rail-L', 'rail-R', 'side-L-chine', 'side-R-gunwale', 'side-L-web']) expect(to.has(id), id).toBe(true);
    expect(get(parts, 'lamp-clip').joints!.some((j) => j.to === 'bow-bulkhead')).toBe(true);
    expect(parts.some((x) => x.id === 'lantern-mount')).toBe(false); // the bracket over the bulkhead top is gone (3c-5)
    expect(b.notes).toMatch(/foot brace/);
    expect(b.notes).toMatch(/hand-hold/);
  });
});

describe('rear transom and lift slot', () => {
  const ctx = makeCtx(defaults);
  const rs = liftSlot(ctx);
  const t = get(parts, 'transom-rear');
  const hole = (t.geometry as { holes?: Vec2[][] }).holes![0];
  it('the slot is a 4.5 x 1.25 in stadium centered on the centerline, clear of the rear box (1/4 in over its top) and at least 3 in above the deck, with 3/4 in of oak above it', () => {
    // the default rear storage box abuts the transom, so the slot sits above the box top; with the storage under the seat it is 3 in above the deck
    expect(L.storage.zTop).toBeGreaterThan(L.deckTop + defaults.liftSlotClearIn);
    expect(rs.zBot).toBeCloseTo(L.storage.zTop + 0.25, 9);
    const under = liftSlot(makeCtx({ ...defaults, storageLocation: 2 }));
    expect(under.zBot).toBeCloseTo(L.deckTop + defaults.liftSlotClearIn, 9);
    expect(rs.zTop - rs.zBot).toBeCloseTo(defaults.liftSlotHeightIn, 9);
    expect(rs.lengthIn).toBe(defaults.liftSlotLengthIn);
    expect(rs.zBot - L.deckTop).toBeGreaterThanOrEqual(3);
    const ys = hole.map((q) => q[0]), zs = hole.map((q) => q[1]);
    expect(Math.min(...ys)).toBeCloseTo(-defaults.liftSlotLengthIn / 2, 9);
    expect(Math.max(...ys)).toBeCloseTo(defaults.liftSlotLengthIn / 2, 9);
    expect(Math.min(...zs)).toBeCloseTo(rs.zBot, 9);
    expect(Math.max(...zs)).toBeCloseTo(rs.zTop, 9);
    // oak above the slot at the slot's ends and the middle, along the crowned top
    const top = Math.max(...outlineOf(t).map((q) => q[1]));
    expect(top - rs.zTop).toBeGreaterThanOrEqual(defaults.liftBarMinIn);
    expect(rs.barIn).toBe(defaults.liftBarMinIn);
    expect(rs.thickIn).toBe(defaults.transomThicknessIn);
    expect(liftBarStressPsi(rs, 100)).toBeGreaterThan(0);
    expect(liftBarStressPsi(rs, 200)).toBeCloseTo(2 * liftBarStressPsi(rs, 100), 9);
  });
  it('the transom is 3/4 in oak, full width over the side ends, from the joist bottom to 14 in above the deck; four 1/4 in vent holes', () => {
    expect(t.material).toBe('white oak');
    const b = worldAABB(t);
    expect(b.min[0]).toBeCloseTo(xRear, 9);
    expect(b.max[0]).toBeCloseTo(xSideStart, 9);
    expect(b.max[1]).toBeCloseTo(12, 9);
    expect(b.min[1]).toBeCloseTo(-12, 9);
    expect((t.geometry as { holes?: Vec2[][] }).holes).toHaveLength(5); // slot + four vents
    expect(t.massLb).toBeGreaterThan(5);
  });
  it('a taller rear side pushes the transom up with it; a short one is lifted over the slot so the oak rule holds (D-37)', () => {
    const tall = liftSlot(makeCtx({ ...defaults, sideHeightRearIn: 20 }));
    expect(tall.transomTop).toBeCloseTo(L.deckTop + 20, 9);
    const short = liftSlot(makeCtx({ ...defaults, sideHeightRearIn: 8 }));
    expect(short.transomTop).toBeCloseTo(short.zTop + defaults.liftBarMinIn, 9);
    expect(short.transomTop).toBeGreaterThan(L.deckTop + 8);
  });
});

describe('scuppers', () => {
  const ctx = makeCtx(defaults);
  const sites = scupperSites(ctx);
  it('four drains: two at the rear and two at the bow, through the chines at deck level, a hair above the deck surface', () => {
    expect(sites.map((s) => s.zone)).toEqual(['rear', 'bow']);
    const ids = parts.filter((x) => x.id.startsWith('scupper-')).map((x) => x.id).sort();
    expect(ids).toEqual(['scupper-bow-L', 'scupper-bow-R', 'scupper-rear-L', 'scupper-rear-R']);
    const rearX = xSideStart + Math.max(0.5, defaults.scupperDiaIn / 2 + 0.1) * 0.75;
    const rear = worldAABB(get(parts, 'scupper-rear-L')), bow = worldAABB(get(parts, 'scupper-bow-L'));
    const cx = (b: { min: number[]; max: number[] }) => (b.min[0] + b.max[0]) / 2;
    expect(cx(rear)).toBeCloseTo(rearX, 9); // in the rear corner, just ahead of the rear transom
    expect(cx(bow)).toBeCloseTo(xFlatEnd - 1, 9); // just behind the bow bulkhead
    expect(cx(rear) - xSideStart).toBeLessThan(1);
    for (const id of ['scupper-rear-L', 'scupper-bow-L', 'scupper-rear-R', 'scupper-bow-R']) {
      const b = worldAABB(get(parts, id));
      expect((b.min[2] + b.max[2]) / 2, id).toBeCloseTo(L.deckTop + 0.05 + defaults.scupperDiaIn / 2, 9);
      expect(b.min[2], id).toBeGreaterThan(L.deckTop); // hole bottom above the deck surface: standing water drains out
      // across the chine: from inside the inner face to 1/4 in beyond the outer face
      expect(Math.abs(b.max[1] - b.min[1])).toBeCloseTo(L.side + 0.25, 9);
    }
    expect(worldAABB(get(parts, 'scupper-rear-R')).max[1]).toBeLessThan(0);
    expect(worldAABB(get(parts, 'scupper-rear-L')).min[1]).toBeGreaterThan(0);
  });
  it('are inside the chines in height (deck level) and ahead of / behind the rails\' ends', () => {
    const chine = worldAABB(get(parts, 'side-L-chine'));
    for (const id of ['scupper-rear-L', 'scupper-bow-L']) {
      const b = worldAABB(get(parts, id));
      expect(b.max[2]).toBeLessThan(chine.max[2]);
      expect(b.min[0]).toBeGreaterThan(chine.min[0]);
      expect(b.max[0]).toBeLessThan(chine.max[0]);
    }
    // the bow drains sit in the narrowed hull (turn-in), through its chine
    const bow = worldAABB(get(parts, 'scupper-bow-L'));
    expect(bow.max[1]).toBeCloseTo(L.hwC - bowTurnInAt(defaults, 48) + L.side + 0.25, 1);
  });
});

describe('signs (D-57): the Troop 455 sign is back on the tall rear part of each side', () => {
  const sp = signPlacement(makeCtx(defaults));
  it('on by default: two ply blanks banded in oak, outside the side stack, hung on thumb-knob screws; NOT removable (D-65: they stay on for transport)', () => {
    expect(defaults.showSideSigns).toBe(1);
    const signs = parts.filter((x) => /^sign/.test(x.id));
    expect(signs.filter((x) => !/backer/.test(x.id)).map((x) => x.id).sort()).toEqual(['sign-L', 'sign-R']);
    expect(signs.filter((x) => /backer/.test(x.id)).map((x) => x.id).sort()).toEqual(['sign-backer-L1', 'sign-backer-L2', 'sign-backer-R1', 'sign-backer-R2']); // D-62: oak backing strips inside the 4 mm web
    for (const x of signs.filter((q) => /backer/.test(q.id))) { expect(x.group).toBe('body'); expect(x.material).toBe('white oak'); expect(x.removable).toBeFalsy(); }
    for (const s of signs.filter((x) => !/backer/.test(x.id))) {
      expect(s.removable).toBeFalsy(); // Eric, D-65: taking the signs off for the truck "seems excessive"
      expect(s.group).toBe('body');
      expect(s.notes).toMatch(/STAYS ON for transport/);
      expect(s.massLb).toBeGreaterThan(0);
      expect(s.edges).toBe('edged');
      expect(s.notes).not.toMatch(/PROVISIONAL/);
      expect(s.joints!.some((j) => j.type === 'knob')).toBe(true);
    }
    expect(buildModel(defaults, { removed: true }).filter((x) => /^sign-[LR]$/.test(x.id))).toHaveLength(2); // D-65: the signs are on in Transport mode
    expect(buildModel(defaults, { removed: true }).filter((x) => /^sign-backer/.test(x.id))).toHaveLength(4); // the backing strips are glued in the side and stay
    expect(buildModel({ ...defaults, showSideSigns: 0 }).some((x) => /^sign/.test(x.id))).toBe(false);
  });
  it('is 15 x 6 in at most, starts just ahead of the transom, stops at x = 6 (clear of the wheel brake mount), is LEVEL (3c-5, not tilted to the sheer) and stays under the gunwale line at its forward end and over the chine', () => {
    expect(sp.length).toBeLessThanOrEqual(defaults.signLengthIn);
    const b = worldAABB(get(parts, 'sign-L'));
    expect(b.min[0]).toBeGreaterThanOrEqual(xSideStart - 1e-6);
    expect(b.max[0]).toBeLessThanOrEqual(SIGN_X_MAX_IN + 1e-6);
    expect(sp.slope).toBe(0); // level: the box is not turned
    expect(b.max[2] - b.min[2]).toBeCloseTo(sp.height, 9);
    expect(b.max[0] - b.min[0]).toBeCloseTo(sp.length, 9);
    const w = worldAABB(get(parts, 'side-L-web'));
    expect(b.min[1]).toBeGreaterThanOrEqual(12 - 1e-6); // outside the chine / gunwale outer face (12 in)
    expect(b.max[1]).toBeLessThan(12 + 2 * thinSheet(defaults).thicknessIn);
    void w;
    expect(b.min[2]).toBeGreaterThan(L.deckTop);
    for (const x of [b.min[0] + 0.3, (b.min[0] + b.max[0]) / 2, b.max[0] - 0.3]) expect(b.max[2], `x=${x}`).toBeLessThanOrEqual(sideTopAt(L, x) - 0.5);
    expect(sp.height).toBeLessThanOrEqual(defaults.signHeightIn);
    expect(sp.length / sp.height).toBeGreaterThan(2.2); // wide enough that the words do not stack (signTexture)
  });
  it('mirrors on the right side and nothing else in the body changes mass because of it, except the fastener remainder', () => {
    const l = worldAABB(get(parts, 'sign-L')), r = worldAABB(get(parts, 'sign-R'));
    expect(l.min[1]).toBeCloseTo(-r.max[1], 9);
    expect(l.min[0]).toBeCloseTo(r.min[0], 9);
    const m = buildModel({ ...defaults, showSideSigns: 0 });
    for (const x of m.filter((q) => q.id !== 'hardware')) expect(get(parts, x.id).massLb, x.id).toBeCloseTo(x.massLb, 9);
    expect(parts.length).toBe(m.length + 2 + 4); // the two signs and their four oak backing strips
  });
});

describe('what is gone with the old hull, the Ackermann front end and the swivel casters', () => {
  it('no part id starts with side-cabin, side-nose, rail-cabin, rail-nose, guard-, transom-front, tongue, kp-, spindle, caster-, tip-swivel, bow-block, front-hanger- (or any other removed steering part)', () => {
    const gone = /^(side-cabin|side-nose|rail-cabin|rail-nose|guard-|transom-front|tongue|kp-|spindle|tie-rod|drag-link|bellcrank|steer-(?!rope-|eye-|anchor-|chain-)|stringer|girder|front-beam|turntable|bolster|eyebolt-|caster-|tip-swivel|bow-block|front-hanger-)/;
    expect(parts.filter((x) => gone.test(x.id)).map((x) => x.id)).toEqual([]);
    for (const v of [{ steerDeg: 15 }, { removed: true }, { rider: 'goal' as const }]) expect(buildModel(defaults, v).filter((x) => gone.test(x.id)).map((x) => x.id)).toEqual([]);
  });
  it('the front end is the pivoting soapbox axle (D-56): beam-F, its stubs and clamps, the kingpin, king beam, thrust washer, tongue, stops and bridle are present', () => {
    for (const id of ['beam-F', 'axle-FL', 'axle-FR', 'clamp-FL1', 'clamp-FR2', 'kingpin', 'king-beam', 'king-thrust', 'bridle-tongue', 'bridle-sleeve', 'roll-pad-L', 'steer-eye-L', 'steer-anchor-L', 'steer-chain-L', 'steer-chain-R', 'bridle']) expect(parts.some((x) => x.id === id), id).toBe(true);
  });
  it('each side is a sandwich (D-61, D-62): one web with an oak band on each face at the chine and at the gunwale, ids side-L-* and side-R-* (the outer bands keep the plain ids)', () => {
    expect(parts.filter((x) => x.id.startsWith('side-') && !x.id.startsWith('side-rib-')).map((x) => x.id).sort()).toEqual(
      ['side-L-chine', 'side-L-chine-in', 'side-L-gunwale', 'side-L-gunwale-in', 'side-L-web', 'side-R-chine', 'side-R-chine-in', 'side-R-gunwale', 'side-R-gunwale-in', 'side-R-web'],
    );
    expect(parts.filter((x) => x.id.startsWith('rail-')).map((x) => x.id).sort()).toEqual(['rail-L', 'rail-R']);
    expect(parts.filter((x) => x.id.startsWith('transom-')).map((x) => x.id).sort()).toEqual(['transom-backer-L', 'transom-backer-R', 'transom-rear']);
    expect(parts.filter((x) => x.id.startsWith('bow-')).map((x) => x.id)).toEqual(['bow-bulkhead']);
  });
  it('the structural side height the checks read is the lowest section (the bow end)', () => {
    expect(L.sideH).toBe(defaults.sideHeightBowIn);
    expect(L.sideRear).toBe(defaults.sideHeightRearIn);
    expect(L.sideH).toBeLessThan(L.sideRear);
  });
});

describe('the sign clears the brake flap (3c-5)', () => {
  const ctx = makeCtx(defaults);
  const sp = signPlacement(ctx);
  it('its bottom edge is above the top of the rear brake flap wherever the two overlap in x, so the side view shows the whole board; the aspect keeps the artwork on two lines', () => {
    const bg = brakeGeometry(defaults, L);
    const b = worldAABB(get(parts, 'sign-L'));
    const slope = bg.u[1] / bg.u[0];
    const flapAt = (x: number) => bg.H[1] + (Math.min(x, bg.H[0]) - bg.H[0]) * slope;
    expect(b.min[2]).toBeGreaterThan(flapAt(b.max[0]));
    expect(sp.length / sp.height).toBeGreaterThanOrEqual(2.2 - 1e-9);
    expect(sp.height).toBeGreaterThan(4); // big enough to read
    expect(sp.length).toBeGreaterThan(10);
    // it never reaches the brake hinge, the knee or the reflector
    expect(b.max[0]).toBeLessThanOrEqual(SIGN_X_MAX_IN + 1e-9);
  });
});
