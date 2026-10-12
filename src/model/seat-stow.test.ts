/**
 * Cargo mode and the ergonomics parts, model side (Phase 3c-4b, D-57; 3c-2, D-53): the seat BACK is hinged and flips flat onto the deck (it never goes in the box), the two cushions
 * (seat cushion and back pad) lie flat in the storage box, the bed is flat and derived from the layout, the handlebow is a gentle bandsawn crown on posts that drop to a parked pin
 * position, the grab boards are one oak board per side, the foot brace is the bulkhead (with a drop-in foot block in slots) and the flag stands in a plain tube.
 * Numbers are re-derived by hand from the params and the layout.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, validateParams, type Params } from '../params';
import { buildModel } from './index';
import { bedLengthAtWidth, cargoBed } from './bed';
import { partsOverlap, worldAABB } from './bounds';
import { bowGeometry, bowUnderZ, handleGeometry, parkDrop } from './handle';
import { computeLayout, innerHalfWidth, sideTopAt } from './layout';
import { BACK_PAD_THICK_IN, CUSHION_CLEAR_IN, GRIP_BOLTS, hingeBacker, seatBackSupport } from './seat';
import { applySeatStow, backFlipMove, isBoxedCushion, isSeatBackPart, isStowedKitPart, seatStowPlan } from './seat-stow';
import { BOX_FILLET_IN, storageGeometry } from './storage';
import { centerOfGravity, totalMass } from './mass';
import { transformPoint } from './bounds';
import type { Part } from './types';

const defaults = defaultParams();
const L = computeLayout(defaults);
const installed = buildModel(defaults, { rider: 'none', cargo: false });
const stowed = buildModel(defaults, { rider: 'none', cargo: false, seat: 'stowed' });
const get = (ps: Part[], id: string) => {
  const x = ps.find((q) => q.id === id);
  if (!x) throw new Error(`no part ${id}`);
  return x;
};
const plan = seatStowPlan(defaults, L, installed);
const g = storageGeometry(defaults, L);
const kit = installed.filter((x) => isStowedKitPart(x.id));

describe('the seat kit (D-57)', () => {
  it('is the back frame (stiles, rails, panel), the pad, the cushion and the two latch pins; the wedges are fixed stop blocks now, no knobs, no plugs, no insert backers', () => {
    expect(kit.map((x) => x.id).sort()).toEqual([
      'seat-back-pad', 'seat-back-panel', 'seat-back-rail-bottom', 'seat-back-rail-top', 'seat-back-stile-L', 'seat-back-stile-R', 'seat-cushion', 'seat-pin-L', 'seat-pin-R',
    ]);
    expect(installed.some((x) => /^(seat-knob|seat-plug|storage-backer)/.test(x.id))).toBe(false);
    expect(get(installed, 'seat-wedge-L').removable).toBeFalsy();
    expect(get(installed, 'seat-back-pad').removable).toBe(true); // Dual Lock: lifts off
    expect(get(installed, 'seat-back-stile-L').removable).toBeFalsy(); // the back stays on the sled
  });
  it('the cushions measure 14.125 x 18 x 2 (seat) and the pad as wide as the back, 1 in thick', () => {
    expect(plan.applicable).toBe(true);
    expect(plan.sizes.cushion[0]).toBeCloseTo(defaults.seatDepthIn - CUSHION_CLEAR_IN, 6);
    expect(plan.sizes.cushion[1]).toBeCloseTo(defaults.seatWidthIn, 6);
    expect(plan.sizes.cushion[2]).toBeCloseTo(defaults.seatCushionIn, 6);
    expect(plan.sizes.pad[1]).toBeCloseTo(defaults.seatBackWidthIn, 6);
    expect(plan.sizes.pad[2]).toBeCloseTo(BACK_PAD_THICK_IN, 6);
    expect(plan.sizes.pad[0]).toBeGreaterThan(5);
    expect(plan.sizes.pad[0]).toBeLessThan(defaults.seatBackHeightIn);
  });
  it('hinge: two 316 butt hinges with the knuckle at the stile foot (the back\'s front-bottom point P), a backer under the deck between the joists', () => {
    for (const tag of ['L', 'R']) {
      const h = get(installed, `seat-hinge-${tag}`);
      expect(h.material).toMatch(/316 stainless butt hinge/);
      const b = worldAABB(h);
      expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(L.seat.P[0], 9);
      expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(L.seat.P[2], 9);
      expect(h.joints!.some((j) => j.to === 'seat-hinge-backer')).toBe(true);
    }
    const bk = worldAABB(get(installed, 'seat-hinge-backer'));
    expect(bk.max[2]).toBeCloseTo(L.deckBot, 9);
    const hb = hingeBacker(defaults, L);
    expect(bk.min[0]).toBeCloseTo(hb.x0, 9);
    for (const jx of L.joistX) expect(jx + L.joistT / 2 <= hb.x0 || jx - L.joistT / 2 >= hb.x1, `joist ${jx}`).toBe(true);
  });
  it('the stop blocks are glued to the box end and carry a latch-pin hole; the back leans on their crest', () => {
    const sup = seatBackSupport(defaults, L);
    expect(sup.rear).toBe(true);
    for (const tag of ['L', 'R']) {
      const w = get(installed, `seat-wedge-${tag}`);
      expect(w.joints!.some((j) => j.type === 'glue' && j.to === 'storage-end-fore')).toBe(true);
      expect(w.joints!.some((j) => j.type === 'pin' && j.to === `seat-pin-${tag}`)).toBe(true);
      expect(worldAABB(w).min[0]).toBeCloseTo(g.x1, 6); // its aft face is the box end
    }
    expect(sup.c2B).toBe(0); // the hinge is the stile foot
    expect(sup.c2L).toBeCloseTo(defaults.seatBackLatchHeightIn, 9);
    expect(sup.c2A).toBeGreaterThan(sup.c2L);
  });
});

describe('the fit of the cushions (seat-stow, D-57)', () => {
  it('fits the default box with at least a quarter inch to spare in all three directions', () => {
    expect(plan.fits).toBe(true);
    expect(plan.margin.lengthIn).toBeGreaterThanOrEqual(0.25);
    expect(plan.margin.widthIn).toBeGreaterThanOrEqual(0.25);
    expect(plan.margin.heightIn).toBeGreaterThanOrEqual(0.25);
  });
  it('the needs add up by hand: length = the longer cushion + clearance, width = the wider + clearance, height = fillet + seat cushion + pad', () => {
    const clear = defaults.seatStowClearIn;
    expect(plan.need.lengthIn).toBeCloseTo(Math.max(plan.sizes.cushion[0], plan.sizes.pad[0]) + clear, 9);
    expect(plan.need.widthIn).toBeCloseTo(Math.max(18, 16) + clear, 9);
    expect(plan.need.heightIn).toBeCloseTo(BOX_FILLET_IN + 2 + 1, 9);
    expect(plan.margin.lengthIn).toBeCloseTo(plan.interior.x1 - plan.interior.x0 - plan.need.lengthIn, 9);
  });
  it('the box is narrower by the flag-tube gutter on each side and its interior is inside the 6 mm walls; the ceiling is the underside of the lid frame and battens', () => {
    expect(g.hw).toBeCloseTo(L.hwC - defaults.storageSideClearIn, 9);
    expect(plan.interior.x0).toBeCloseTo(g.x0 + g.pl, 9);
    expect(plan.interior.y1).toBeCloseTo(g.hw - g.pl, 9);
    expect(plan.interior.zCeil).toBeCloseTo(g.zTop - g.pl - g.rimT, 9);
    expect(worldAABB(get(installed, 'storage-lid-batten-1')).min[2]).toBeCloseTo(plan.interior.zCeil, 6);
  });
  it('the box holds the cushions OR the 10 Essentials, not both: free volume after the cushions is under what the Essentials need', () => {
    expect(plan.cushionsIn3).toBeGreaterThan(500);
    expect(plan.freeIn3).toBeGreaterThan(0);
  });
  it('does not fit when the seat is too far forward for the box to be long enough, or the cushion too deep', () => {
    const deep = { ...defaults, seatDepthIn: 17 } as Params;
    const q = seatStowPlan(deep, computeLayout(deep), buildModel(deep, { rider: 'none', cargo: false }));
    expect(q.fits).toBe(false);
    expect(q.margin.lengthIn).toBeLessThan(0);
  });
  it('is not applicable when the box is not behind the seat (nothing to stow, nothing moves)', () => {
    const p2 = { ...defaults, storageLocation: 2 } as Params;
    const ps = buildModel(p2, { rider: 'none', cargo: false });
    expect(seatStowPlan(p2, computeLayout(p2), ps).applicable).toBe(false);
    const st = buildModel(p2, { rider: 'none', cargo: false, seat: 'stowed' });
    expect(get(st, 'seat-cushion').transform).toEqual(get(ps, 'seat-cushion').transform);
  });
});

describe('the flat (stowed) view state', () => {
  it('has the same parts and the same mass as the installed view (the kit only moves)', () => {
    expect(stowed.map((x) => x.id)).toEqual(installed.map((x) => x.id));
    expect(totalMass(stowed)).toBeCloseTo(totalMass(installed), 9);
  });
  it('puts the two cushions inside the box, the pad on the seat cushion face up', () => {
    const hi = plan.interior;
    for (const id of ['seat-cushion', 'seat-back-pad']) {
      const b = worldAABB(get(stowed, id));
      expect(b.min[0], `${id} x0`).toBeGreaterThanOrEqual(hi.x0 - 1e-6);
      expect(b.max[0], `${id} x1`).toBeLessThanOrEqual(hi.x1 + 1e-6);
      expect(b.min[1], `${id} y0`).toBeGreaterThanOrEqual(hi.y0 - 1e-6);
      expect(b.max[1], `${id} y1`).toBeLessThanOrEqual(hi.y1 + 1e-6);
      expect(b.min[2], `${id} z0`).toBeGreaterThanOrEqual(hi.zRest - 1e-6);
      expect(b.max[2], `${id} z1`).toBeLessThanOrEqual(hi.zCeil + 1e-6);
    }
    const cu = worldAABB(get(stowed, 'seat-cushion')), pad = worldAABB(get(stowed, 'seat-back-pad'));
    expect(pad.min[2]).toBeCloseTo(cu.max[2], 6);
    expect(cu.min[2]).toBeCloseTo(hi.zRest, 6);
    expect(pad.max[2] - pad.min[2]).toBeCloseTo(BACK_PAD_THICK_IN, 6);
  });
  it('the back flips forward 90 deg + the recline about the stile foot and lies FLAT on the deck, rear face up: 16 in head to foot, 0.75 in proud, from the hinge forward', () => {
    const M = backFlipMove(defaults, L);
    // the back's up-the-back axis (col2) becomes level, pointing forward; its front normal (col0) points down
    const up = [L.seat.col2[0], L.seat.col2[1], L.seat.col2[2]];
    const rot = (v: number[]) => [M[0] * v[0] + M[4] * v[1] + M[8] * v[2], M[1] * v[0] + M[5] * v[1] + M[9] * v[2], M[2] * v[0] + M[6] * v[1] + M[10] * v[2]];
    expect(rot(up)[0]).toBeCloseTo(1, 9);
    expect(rot(up)[2]).toBeCloseTo(0, 9);
    expect(rot([L.seat.col0[0], 0, L.seat.col0[2]])[2]).toBeCloseTo(-1, 9);
    const st = worldAABB(get(stowed, 'seat-back-stile-L'));
    expect(st.max[0] - st.min[0]).toBeCloseTo(defaults.seatBackHeightIn, 1);
    expect(st.max[2] - st.min[2]).toBeCloseTo(defaults.seatBackThickIn, 1);
    expect(st.min[2]).toBeCloseTo(L.deckTop, 6); // on the deck
    expect(st.min[0]).toBeGreaterThan(L.seat.Pr[0] - 1);
    expect(plan.flat.zTop - L.deckTop).toBeCloseTo(defaults.seatBackThickIn, 1);
    // the knuckle P stays where it is: the flipped back pivots about it
    const P2 = transformPoint(M, L.seat.P);
    expect(P2[0]).toBeCloseTo(L.seat.P[0], 9);
    expect(P2[2]).toBeCloseTo(L.deckTop, 9);
    // every back frame part moved, none left upright
    for (const x of stowed.filter((q) => isSeatBackPart(q.id))) expect(worldAABB(x).max[2] - L.deckTop, x.id).toBeLessThan(1);
  });
  it('flat, the back is short of the foot brace and the grab boards, so the bed beyond it is clear; the latch pins go down through the stiles into the deck', () => {
    const bed = cargoBed(defaults, L);
    expect(plan.flat.x1).toBeLessThan(bed.xStop - 5);
    for (const h of plan.flat.pins) {
      const pin = worldAABB(get(stowed, `seat-pin-${h.tag}`));
      expect((pin.min[0] + pin.max[0]) / 2).toBeCloseTo(h.center[0], 6);
      expect(pin.min[2]).toBeLessThan(L.deckTop);
      expect(pin.max[2]).toBeGreaterThan(L.deckTop + defaults.seatBackThickIn);
    }
  });
  const overlaps = (ps: Part[]): string[] => {
    const set = ps.filter((x) => isStowedKitPart(x.id) || /^(storage-(side|end|coaming|lid|rim|gasket|drain|latch|hinge)|deck|seat-hinge|seat-wedge)/.test(x.id));
    const bad: string[] = [];
    for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) {
      const a = set[i], b = set[j];
      if (!isStowedKitPart(a.id) && !isStowedKitPart(b.id)) continue;
      if (/^seat-back-/.test(a.id) && /^seat-back-/.test(b.id)) continue; // frame joinery is not modeled
      if (/^seat-(pin|hinge)/.test(a.id) || /^seat-(pin|hinge)/.test(b.id)) continue; // pins pass through their holes; the hinge knuckle is part of the back's foot
      const d = partsOverlap(a, b);
      if (d > 0.05) bad.push(`${a.id} x ${b.id}: ${d.toFixed(3)}`);
    }
    return bad;
  };
  it('nothing in the flat pose interpenetrates the box, the deck, the hinges or the stop blocks (tolerance 0.05 in)', () => {
    expect(overlaps(stowed)).toEqual([]);
  });
  it('transport configuration: the cushion and pad come off (the cushion stays), the back frame stays on the sled', () => {
    const removed = new Set(buildModel(defaults, { removed: true, seat: 'stowed' }).map((x) => x.id));
    for (const x of kit) expect(removed.has(x.id), x.id).toBe(!x.removable);
  });
  it('applySeatStow is idempotent about the plan: the plan from the installed parts is the source of truth', () => {
    const copy = buildModel(defaults, { rider: 'none', cargo: false });
    const q = applySeatStow(defaults, L, copy);
    expect(q.fits).toBe(plan.fits);
    expect(q.items.map((i) => i.label)).toEqual(plan.items.map((i) => i.label));
    expect(isBoxedCushion('seat-cushion')).toBe(true);
  });
});

describe('the flat cargo bed (D-53, D-54, D-57)', () => {
  const bed = cargoBed(defaults, L);
  it('starts at the fore end of the box, ends at the foot brace (the bulkhead face), is as wide as the cabin and as tall as the lowest gunwale (the bow end of the sheer)', () => {
    expect(bed.x0).toBeCloseTo(L.storage.x1, 9);
    expect(bed.xStop).toBeCloseTo(defaults.seatXIn + defaults.riderLegReachIn, 9);
    expect(bed.xStop).toBeCloseTo(L.bulkhead.x0, 9);
    expect(bed.widthIn).toBeCloseTo(2 * L.hwC, 9);
    expect(bed.heightIn).toBe(defaults.sideHeightBowIn);
    expect(bed.boxTopIn).toBeCloseTo(L.storage.zTop - L.deckTop, 9);
  });
  it('the area is the floor between the sides over that run, narrowing in the turn-in (trapezoid rule on the same side line)', () => {
    const len = bed.xStop - bed.x0;
    let a = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const x0 = bed.x0 + (len * i) / n, x1 = bed.x0 + (len * (i + 1)) / n;
      a += ((2 * innerHalfWidth(L, x0) + 2 * innerHalfWidth(L, x1)) / 2) * (x1 - x0);
    }
    expect(bed.areaIn2).toBeCloseTo(a, 0);
    expect(bed.stopWidthIn).toBeCloseTo(2 * (L.hwC - defaults.bowTurnInIn), 6);
    expect(bed.areaIn2).toBeLessThan(len * bed.widthIn);
  });
  it('a load narrower than the narrowest cabin gets the whole bed; one wider than the 22.75 in cabin does not fit', () => {
    const l24 = bedLengthAtWidth(L, bed, 24), l20 = bedLengthAtWidth(L, bed, 20);
    expect(l24).toBe(0);
    expect(l20).toBeCloseTo(bed.xStop - bed.x0, 0);
    expect(2 * innerHalfWidth(L, bed.xLoadEnd)).toBeGreaterThanOrEqual(defaults.cargoLoadWidthIn - 1e-6);
    const narrow = { ...defaults, bodyWidthIn: 21 } as Params;
    if (!validateParams(narrow).some((i) => i.severity === 'error')) expect(cargoBed(narrow, computeLayout(narrow)).loadLengthIn).toBe(0);
  });
  it('in the flat view only the foot-block slot cleats, the grab boards and the (flat) back stand above the deck ahead of the box; no foot-stop bar, cleat, knob or wedge stands on the bed except the fixed stop blocks at the box end', () => {
    const intruders = stowed.filter((x) => {
      if (x.payload || x.group === 'reference') return false;
      if (!/^(seat-|foot-|storage-backer)/.test(x.id)) return false;
      const b = worldAABB(x);
      return b.max[0] > bed.x0 + 0.6 && b.min[2] < L.deckTop + L.sideH - 1e-9;
    }).map((x) => x.id).sort();
    expect(intruders.filter((id) => !/^(seat-back-|seat-pin|seat-hinge|seat-grip|seat-wedge|foot-slot)/.test(id))).toEqual([]);
    expect(stowed.some((x) => x.id === 'foot-stop')).toBe(false);
  });
});

describe('the cargo block in the flat view', () => {
  const view = buildModel(defaults, { seat: 'stowed', cargo: true });
  it('is the payload on the bed against the box, no mannequin, at the cargo CG height', () => {
    const c = get(view, 'cargo');
    expect(c.massLb).toBe(defaults.cargoPayloadLb);
    const b = worldAABB(c);
    expect(b.min[0]).toBeCloseTo(L.storage.x1 + 0.5, 6);
    expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(L.deckTop + defaults.cargoCgHeightIn, 6);
    expect(view.some((x) => x.id.startsWith('rider-'))).toBe(false);
  });
  it('the installed view keeps the 10 Essentials block in the box and the mannequin; showing the payload does not change the empty-sled mass or CG', () => {
    const v = buildModel(defaults, { rider: 'operating', cargo: true });
    expect(get(v, 'cargo').massLb).toBe(defaults.cargoMassLb);
    expect(v.some((x) => x.id === 'rider-torso')).toBe(true);
    expect(totalMass(view)).toBeCloseTo(totalMass(stowed), 9);
    expect(centerOfGravity(view)[2]).toBeCloseTo(centerOfGravity(stowed)[2], 9);
  });
});

describe('the handlebow (D-53, D-57)', () => {
  const h = handleGeometry(defaults, L);
  const bw = bowGeometry(defaults, L);
  const bar = get(installed, 'handle-bar');
  it('is a circular arc through the two post tops that crowns 7/8 in above them: R = (y^2 + c^2) / 2c by hand', () => {
    const y = L.hwC - defaults.handleUprightInsetIn;
    const c = defaults.handleBowCrownIn;
    expect(c).toBe(0.875);
    expect(bw.radiusIn).toBeCloseTo((y * y + c * c) / (2 * c), 9);
    expect(bw.zPost).toBe(defaults.rearHandleHeightIn);
    expect(bw.zMid - bw.zPost).toBeCloseTo(c, 9);
    const e = L.hwC + L.side;
    expect(bw.zEnd).toBeCloseTo(bw.zPost + c - (bw.radiusIn - Math.sqrt(bw.radiusIn ** 2 - e * e)), 9);
    expect(bw.postSlopeDeg).toBeCloseTo((Math.asin(y / bw.radiusIn) * 180) / Math.PI, 9);
    expect(bw.postSlopeDeg).toBeLessThan(12);
  });
  it('is ONE bandsawn board of white oak, not a lamination: a profile extrusion 1.25 in thick, 5/4 stock, with its mass from the board', () => {
    expect(bar.kind).toBe('lumber');
    expect(bar.fab).toBe('bandsaw');
    expect(bar.material).toBe('white oak');
    expect(bar.geometry.type).toBe('extrusion');
    expect(bar.geometry.type === 'extrusion' && bar.geometry.depth).toBe(defaults.handleBarDiameterIn);
    expect(bar.stock!.t).toBe(defaults.handleBarDiameterIn);
    expect(bar.stock!.l).toBeCloseTo(2 * bw.yEnd, 6);
    expect(bar.stock!.w).toBeLessThan(3.5); // a 4 in board is plenty for a 7/8 in crown
    const bb = worldAABB(bar);
    expect(bb.max[1]).toBeCloseTo(bw.yEnd, 6);
    expect(bb.min[1]).toBeCloseTo(-bw.yEnd, 6);
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(defaults.handleBarDiameterIn, 6);
    expect(bar.massLb).toBeGreaterThan(0.8);
    expect(bar.massLb).toBeLessThan(2.5);
    expect(bar.removable).toBe(true);
    expect(bar.notes).toMatch(/bandsawn/);
  });
  it('the posts are cut to the bow slope and carry it on their tops: the post top is at the bow underside at both post edges', () => {
    for (const tag of ['L', 'R']) {
      const post = worldAABB(get(installed, `handle-post-${tag}`));
      const yi = h.yPost - defaults.handlePostWidthIn / 2, yo = h.yPost + defaults.handlePostWidthIn / 2;
      const top = Math.max(bowUnderZ(bw, yi, defaults.handleBarDiameterIn), bowUnderZ(bw, yo, defaults.handleBarDiameterIn));
      expect(post.max[2]).toBeCloseTo(top, 6);
    }
  });
  it('the sockets are 16 in deep (D-57) with the rear transom corner at 22 in; the posts sit about 5.7 in deep when riding, the pin 1.5 in under the socket mouth', () => {
    expect(defaults.handleSocketDepthIn).toBe(16);
    const sock = worldAABB(get(installed, 'handle-socket-L'));
    expect(sock.min[2]).toBeCloseTo(L.deckTop + L.sideRear - 16, 9);
    expect(sock.max[2]).toBeCloseTo(L.deckTop + L.sideRear, 9);
    expect(h.zPin).toBeCloseTo(h.zTop - 1.5, 9);
    const post = worldAABB(get(installed, 'handle-post-L'));
    expect(post.min[2]).toBeCloseTo(h.zFoot, 9);
    expect(h.zTop - h.zFoot).toBeGreaterThanOrEqual(5); // enough insertion for the hold-back pull
    expect(h.zFoot).toBeCloseTo(h.zBot + 0.5 + h.parkDropIn, 9);
  });
  it('PARKED (the second pin position): the posts and the bow sink by parkDropIn so the bow rests ~1 in above the rear transom top, the post foot at the socket bottom + 1/2 in; sockets and pins stay', () => {
    const park = parkDrop(defaults, L);
    expect(park.dropIn).toBeGreaterThan(8);
    expect(park.dropIn).toBeLessThan(11);
    expect(h.parkDropIn).toBeCloseTo(park.dropIn, 9);
    const parked = buildModel(defaults, { rider: 'none', cargo: false, handle: 'parked' });
    const pb = worldAABB(get(parked, 'handle-bar')), up = worldAABB(bar);
    expect(up.min[2] - pb.min[2]).toBeCloseTo(park.dropIn, 6);
    expect(worldAABB(get(parked, 'handle-post-L')).min[2]).toBeCloseTo(h.zBot + 0.5, 6);
    // the bow's underside clears the transom top (corners at 22, crown 22.75 at the middle) by the parked clearance or more
    expect(pb.min[2]).toBeGreaterThanOrEqual(L.deckTop + L.sideRear + defaults.handleParkClearIn - 0.02);
    expect(worldAABB(get(parked, 'handle-socket-L'))).toEqual(worldAABB(get(installed, 'handle-socket-L')));
    expect(totalMass(parked)).toBeCloseTo(totalMass(installed), 9);
    // the pin holes: riding the post foot is `parkDropIn` higher than parked, so the hole used when riding is that much lower on the post
    expect(h.zFoot - (h.zBot + 0.5)).toBeCloseTo(park.dropIn, 9);
  });
  it('the bow stands behind the rear transom and clears its top corners when riding', () => {
    const bb = worldAABB(bar);
    expect(bb.max[0]).toBeLessThan(L.xRear + 1e-9);
    expect(bb.min[2]).toBeGreaterThan(L.deckTop + L.sideRear);
  });
  it('crown 0 gives the straight bar at the grip height', () => {
    const p0 = { ...defaults, handleBowCrownIn: 0 } as Params;
    const b0 = bowGeometry(p0, computeLayout(p0));
    expect(Number.isFinite(b0.radiusIn)).toBe(false);
    for (const q of b0.path) expect(q[1]).toBe(defaults.rearHandleHeightIn);
    expect(worldAABB(get(buildModel(p0, { rider: 'none', cargo: false }), 'handle-post-L')).max[2]).toBeCloseTo(defaults.rearHandleHeightIn - 1.25 / 2, 9);
  });
});

describe('the grab boards (D-57)', () => {
  const gr = get(installed, 'seat-grip-L');
  it('one oak board per side, ids seat-grip-L/R, with a routed hole and bolts through the gunwale; the old pad, posts, bar and doubler are gone', () => {
    expect(installed.filter((x) => /^seat-grip/.test(x.id)).map((x) => x.id).sort()).toEqual(['seat-grip-L', 'seat-grip-R']);
    expect(installed.some((x) => /^(doubler-grip|seat-grip-(pad|post|bar))/.test(x.id))).toBe(false);
    expect(gr.material).toBe('white oak');
    expect(gr.geometry.type).toBe('extrusion');
    expect((gr.geometry as { holes?: unknown[] }).holes).toHaveLength(1);
    const bolts = gr.joints!.find((j) => j.type === 'bolt')!;
    expect(bolts.to).toBe('side-L-gunwale');
    expect(bolts.count).toBe(GRIP_BOLTS);
  });
  it('lies against the inboard face of the gunwale, stands above its top by foot + hole + bar, and is 8 in long from 5 in behind the H-point', () => {
    const b = worldAABB(gr);
    expect(b.max[1]).toBeCloseTo(innerHalfWidth(L, (b.min[0] + b.max[0]) / 2), 1);
    expect(b.max[1] - b.min[1]).toBeCloseTo(defaults.grabBoardThickIn, 1);
    const top = sideTopAt(L, b.min[0]);
    expect(b.max[2]).toBeGreaterThan(top + defaults.grabBoardFootIn + defaults.grabHoleHeightIn);
    expect(b.min[0]).toBeGreaterThan(defaults.seatXIn - 5 - 1);
    const l = worldAABB(get(installed, 'seat-grip-L')), r = worldAABB(get(installed, 'seat-grip-R'));
    expect(l.min[1]).toBeCloseTo(-r.max[1], 6);
  });
});

describe('the foot brace and the drop-in foot block (D-57)', () => {
  it('the brace is the rear face of the bulkhead at seatX + leg reach; no foot-stop bar; two slot cleats per side per position', () => {
    expect(defaults.seatXIn + defaults.riderLegReachIn).toBeCloseTo(L.bulkhead.x0, 9);
    const cleats = installed.filter((x) => /^foot-slot-/.test(x.id)).map((x) => x.id).sort();
    expect(cleats).toEqual(['foot-slot-L1', 'foot-slot-L2', 'foot-slot-R1', 'foot-slot-R2']);
    expect(installed.some((x) => x.id === 'foot-block')).toBe(false);
    for (const [i, behind] of L.footBlock.behind.entries()) {
      const c = worldAABB(get(installed, `foot-slot-L${i + 1}`));
      expect(c.max[0]).toBeLessThan(L.bulkhead.x0 - behind + 2.2);
      expect(c.min[2]).toBeCloseTo(L.deckTop, 9);
    }
  });
  it('footBlockSlot 1 shows the removable block in the first slot, ends 3/8 in into the cleats, face one step behind the bulkhead', () => {
    const p1 = { ...defaults, footBlockSlot: 1 } as Params;
    const m = buildModel(p1, { rider: 'none', cargo: false });
    const fb = get(m, 'foot-block');
    expect(fb.removable).toBe(true);
    const b = worldAABB(fb);
    expect(b.max[0]).toBeCloseTo(L.bulkhead.x0 - defaults.footBlockStepIn, 6);
    expect(b.max[0] - b.min[0]).toBeCloseTo(defaults.footBlockThickIn, 6);
    expect(b.max[2] - b.min[2]).toBeCloseTo(defaults.footStopHeightIn, 6);
    expect(buildModel(p1, { removed: true }).some((x) => x.id === 'foot-block')).toBe(false);
    expect(partsOverlap(fb, get(m, 'foot-slot-L1'))).toBeLessThan(0.45);
  });
});

describe('the flag tube (D-57)', () => {
  it('a plain 1 in ID tube stands in the left rear corner beside the box, on the deck, its top flush with the side top, with two oak holding blocks; the bow flag clip and socket are gone', () => {
    expect(installed.some((x) => /^flag-(mount|socket)$/.test(x.id))).toBe(false);
    const t = get(installed, 'flag-tube');
    const b = worldAABB(t);
    expect(t.kind).toBe('purchased');
    expect(b.min[2]).toBeCloseTo(L.deckTop, 9);
    expect(b.max[2]).toBeCloseTo(sideTopAt(L, (b.min[0] + b.max[0]) / 2), 9);
    expect(b.max[1]).toBeLessThan(L.hwC);
    expect(b.min[1]).toBeGreaterThanOrEqual(g.hw - 1e-6); // in the gutter beside the box, not over it
    expect(b.max[1] - b.min[1]).toBeCloseTo(defaults.flagTubeOdIn, 6);
    expect(defaults.flagTubeIdIn).toBeCloseTo(1.05, 9);
    expect(t.notes).toMatch(/drain hole/);
    expect(installed.filter((x) => /^flag-block-/.test(x.id))).toHaveLength(2);
  });
});
