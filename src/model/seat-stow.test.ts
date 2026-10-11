/**
 * Cargo mode, model side (Phase 3c-2, D-53): the seat kit lies flat in the storage box, the bed is flat and derived from the layout, the handlebow is a crowned
 * bent lamination on the same posts, and the cargo block sits on the bed. Numbers are re-derived by hand from the params and the layout.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, type Params } from '../params';
import { buildModel } from './index';
import { bedLengthAtWidth, cargoBed } from './bed';
import { partsOverlap, worldAABB } from './bounds';
import { bowGeometry, bowUnderZ, handleGeometry } from './handle';
import { computeLayout, innerHalfWidth } from './layout';
import { BACK_PAD_THICK_IN, CUSHION_CLEAR_IN } from './seat';
import { applySeatStow, isStowedKitPart, seatStowPlan, studHoles, KNOB_STUD_IN } from './seat-stow';
import { BOX_FILLET_IN, storageGeometry } from './storage';
import { centerOfGravity, totalMass } from './mass';
import type { Part } from './types';

const defaults = defaultParams();
const L = computeLayout(defaults);
const installed = buildModel(defaults, { rider: 'none', cargo: false });
const stowed = buildModel(defaults, { rider: 'none', cargo: false, seat: 'stowed' });
const get = (ps: Part[], id: string) => ps.find((x) => x.id === id)!;
const plan = seatStowPlan(defaults, L, installed);
const g = storageGeometry(defaults, L);
const kit = installed.filter((x) => isStowedKitPart(x.id));

describe('the seat kit (measured from the real parts)', () => {
  it('is the back (stiles, rails, panel, pad), the cushion, two wedges, two knobs and two stud-hole plugs', () => {
    expect(kit.map((x) => x.id).sort()).toEqual([
      'seat-back-pad', 'seat-back-panel', 'seat-back-rail-bottom', 'seat-back-rail-top', 'seat-back-stile-L', 'seat-back-stile-R',
      'seat-cushion', 'seat-knob-L', 'seat-knob-R', 'seat-plug-L', 'seat-plug-R', 'seat-wedge-L', 'seat-wedge-R',
    ]);
  });
  it('measures 16 in head to foot, 16 in across and 0.75 + 1 in thick for the back; 15.625 x 18 x 2 for the cushion', () => {
    expect(plan.applicable).toBe(true);
    // Hand: head to foot = seatBackHeightIn, across = seatBackWidthIn (the pad is as wide as the frame), thickness = frame + pad.
    expect(plan.sizes.back[0]).toBeCloseTo(defaults.seatBackHeightIn, 6);
    expect(plan.sizes.back[1]).toBeCloseTo(defaults.seatBackWidthIn, 6);
    expect(plan.sizes.back[2]).toBeCloseTo(defaults.seatBackThickIn + BACK_PAD_THICK_IN, 6);
    // Cushion: from the rear edge + 3/8" knob clearance to the front edge (seatDepthIn - CUSHION_CLEAR_IN), the seat width, and the cushion thickness.
    expect(plan.sizes.cushion[0]).toBeCloseTo(defaults.seatDepthIn - CUSHION_CLEAR_IN, 6);
    expect(plan.sizes.cushion[1]).toBeCloseTo(defaults.seatWidthIn, 6);
    expect(plan.sizes.cushion[2]).toBeCloseTo(defaults.seatCushionIn, 6);
    expect(plan.sizes.knob[0]).toBe(KNOB_STUD_IN);
    // The wedge lies on its long edge: along x = its height along the back, across = the stile width, up = its depth.
    const wb = worldAABB(get(installed, 'seat-wedge-L'));
    expect(plan.sizes.wedge[0]).toBeCloseTo(wb.max[2] - wb.min[2], 9);
    expect(plan.sizes.wedge[2]).toBeCloseTo(wb.max[0] - wb.min[0], 9);
    expect(plan.sizes.wedge[1]).toBeCloseTo(defaults.seatBackFrameWidthIn, 9);
  });
});

describe('the fit (seat-stow, D-53)', () => {
  it('fits the default box with at least a quarter inch to spare in all three directions', () => {
    expect(plan.fits).toBe(true);
    expect(plan.margin.lengthIn).toBeGreaterThanOrEqual(0.25);
    expect(plan.margin.widthIn).toBeGreaterThanOrEqual(0.25);
    expect(plan.margin.heightIn).toBeGreaterThanOrEqual(0.25);
  });
  it('the needs add up by hand: length = the cushion + the 1 in backers + clearance, or the back + the coaming ledge each end + clearance; width = cushion + two strips + clearance; height = fillet + cushion + back', () => {
    const clear = defaults.seatStowClearIn;
    const ledge = defaults.storageCoamingWidthIn - defaults.panelPlyIn;
    expect(plan.need.lengthIn).toBeCloseTo(Math.max(15.625 + 1 + clear, 16 + 2 * ledge + clear), 6);
    const strip = plan.sizes.wedge[1] + 0.125 + 1 + 0.125; // wedge + gap + knob (1 in) + gap
    expect(plan.need.widthIn).toBeCloseTo(18 + 2 * strip + clear, 6);
    expect(plan.need.heightIn).toBeCloseTo(BOX_FILLET_IN + 1.75 + 2, 6);
  });
  it('the interior is inside the 6 mm walls, and the ceiling is the underside of the lid frame and battens, not the lid panel', () => {
    expect(plan.interior.x0).toBeCloseTo(g.x0 + g.pl, 9);
    expect(plan.interior.x1).toBeCloseTo(g.x1 - g.pl, 9);
    expect(plan.interior.y1).toBeCloseTo(g.hw - g.pl, 9);
    expect(plan.interior.zCeil).toBeCloseTo(g.zTop - g.pl - g.rimT, 9);
    expect(plan.interior.zCeil).toBeLessThan(g.lidUnderZ); // the gasket, the coaming and the lid frame are above
    // The lid battens hang to exactly that height: nothing stowed can touch them.
    const batten = worldAABB(get(installed, 'storage-lid-batten-1'));
    expect(batten.min[2]).toBeCloseTo(plan.interior.zCeil, 6);
  });
  it('does not fit when the box is too short for the 16 in back: the old seat position (12 in) leaves the box 13.4 in long inside', () => {
    const p12 = { ...defaults, seatXIn: 12 } as Params;
    const L12 = computeLayout(p12);
    const q = seatStowPlan(p12, L12, buildModel(p12, { rider: 'none', cargo: false }));
    expect(q.fits).toBe(false);
    expect(q.margin.lengthIn).toBeLessThan(0);
  });
  it('is not applicable when the box is not behind the seat (nothing to stow, nothing moves)', () => {
    const p2 = { ...defaults, storageLocation: 2 } as Params;
    const ps = buildModel(p2, { rider: 'none', cargo: false });
    const q = seatStowPlan(p2, computeLayout(p2), ps);
    expect(q.applicable).toBe(false);
    const st = buildModel(p2, { rider: 'none', cargo: false, seat: 'stowed' });
    expect(get(st, 'seat-cushion').transform).toEqual(get(ps, 'seat-cushion').transform);
  });
});

describe('the stowed view state', () => {
  it('has the same parts and the same mass as the installed view (the kit only moves)', () => {
    expect(stowed.map((x) => x.id)).toEqual(installed.map((x) => x.id));
    expect(totalMass(stowed)).toBeCloseTo(totalMass(installed), 9);
  });
  it('puts every kit piece inside the box (the plugs just outside the end wall) and the back flat: 16 long, 0.75 thick for a stile', () => {
    const hi = plan.interior;
    for (const id of kit.map((x) => x.id)) {
      const b = worldAABB(get(stowed, id));
      if (id.startsWith('seat-plug')) {
        expect(b.min[0], id).toBeGreaterThan(g.x1 - 0.2);
        expect(b.max[0], id).toBeLessThan(g.x1 + 0.7);
        continue;
      }
      expect(b.min[0], `${id} x0`).toBeGreaterThanOrEqual(hi.x0 - 1e-6);
      expect(b.max[0], `${id} x1`).toBeLessThanOrEqual(hi.x1 + 1e-6);
      expect(b.min[1], `${id} y0`).toBeGreaterThanOrEqual(hi.y0 - 1e-6);
      expect(b.max[1], `${id} y1`).toBeLessThanOrEqual(hi.y1 + 1e-6);
      expect(b.min[2], `${id} z0`).toBeGreaterThanOrEqual(hi.zFloor + BOX_FILLET_IN - 1e-6);
      expect(b.max[2], `${id} z1`).toBeLessThanOrEqual(hi.zCeil + 1e-6);
    }
    const st = worldAABB(get(stowed, 'seat-back-stile-L'));
    expect(st.max[0] - st.min[0]).toBeCloseTo(defaults.seatBackHeightIn, 6); // the stile lies along x
    expect(st.max[2] - st.min[2]).toBeCloseTo(defaults.seatBackThickIn, 6); // and is flat
    const pad = worldAABB(get(stowed, 'seat-back-pad'));
    expect(pad.min[2]).toBeCloseTo(st.max[2], 6); // pad up, frame down
    const cu = worldAABB(get(stowed, 'seat-cushion'));
    expect(st.min[2]).toBeCloseTo(cu.max[2], 6); // the back lies on the cushion
    expect(cu.max[2] - cu.min[2]).toBeCloseTo(defaults.seatCushionIn, 6);
    // The cushion stops short of the backers; the back rides above them.
    const backer = worldAABB(get(stowed, 'storage-backer-L'));
    expect(cu.max[0]).toBeLessThanOrEqual(backer.min[0] + 1e-6);
    expect(backer.max[2]).toBeLessThanOrEqual(st.min[2] + 1e-6);
  });
  it('the stowed pieces do not interpenetrate each other, nor the box walls, lid, battens, backers and drains (tolerance 0.05 in)', () => {
    const ps = stowed.filter((x) => isStowedKitPart(x.id) || /^storage-(side|end|coaming|lid|rim|gasket|backer|drain|latch|hinge)/.test(x.id));
    const bad: string[] = [];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      const aKit = isStowedKitPart(a.id), bKit = isStowedKitPart(b.id);
      if (!aKit && !bKit) continue; // box vs box is the hull test's business
      if (a.id.startsWith('seat-plug') || b.id.startsWith('seat-plug')) continue; // threaded into the end wall's insert
      // The back's rails and stiles share the panel groove and the Domino joints (the joinery is not modeled): same-assembly overlaps are the model's convention.
      if (/^seat-back-/.test(a.id) && /^seat-back-/.test(b.id)) continue;
      const d = partsOverlap(a, b);
      if (d > 0.05) bad.push(`${a.id} x ${b.id}: ${d.toFixed(3)}`);
    }
    expect(bad).toEqual([]);
  });
  it('the plugs thread into the inserts: on the stud axes at the fore end of the box', () => {
    const holes = studHoles(defaults, L);
    expect(holes).toHaveLength(2);
    for (const h of holes) {
      expect(h.center[0]).toBeCloseTo(g.x1, 9);
      // Hand: the stud axis leaves the knob height up the back's rear face and runs down the back normal to the end plane.
      const a = (defaults.seatBackAngleDeg * Math.PI) / 180;
      const sup = { c2B: Math.min(defaults.seatBackKnobHeightIn, 99) };
      const zS = L.seat.Pr[2] + Math.cos(a) * sup.c2B, xr = L.seat.Pr[0] - Math.sin(a) * sup.c2B;
      const dist = (xr - g.x1) / Math.cos(a);
      expect(h.center[2]).toBeCloseTo(zS - Math.sin(a) * dist, 9);
      const plug = worldAABB(get(stowed, `seat-plug-${h.tag}`));
      expect((plug.min[1] + plug.max[1]) / 2).toBeCloseTo(h.center[1], 1);
    }
  });
  it('transport configuration: the whole kit but the cushion comes off with the handle (D-9), in the stowed view too', () => {
    const removed = new Set(buildModel(defaults, { removed: true, seat: 'stowed' }).map((x) => x.id));
    for (const x of kit) expect(removed.has(x.id), x.id).toBe(x.id === 'seat-cushion');
  });
  it('applySeatStow is idempotent about the plan: planning from the stowed parts is not needed; the plan from the installed parts is the source of truth', () => {
    const copy = buildModel(defaults, { rider: 'none', cargo: false });
    const q = applySeatStow(defaults, L, copy);
    expect(q.fits).toBe(plan.fits);
    expect(q.items.map((i) => i.label)).toEqual(plan.items.map((i) => i.label));
  });
});

describe('the flat cargo bed (D-53)', () => {
  const bed = cargoBed(defaults, L);
  it('starts at the fore end of the box, ends at the foot stop, and is as wide and tall as the cabin', () => {
    expect(bed.x0).toBeCloseTo(L.storage.x1, 9);
    const stop = worldAABB(get(installed, 'foot-stop'));
    expect(bed.xStop).toBeCloseTo(stop.min[0], 9);
    expect(bed.widthIn).toBeCloseTo(2 * L.hwC, 9);
    expect(bed.heightIn).toBe(defaults.sideHeightIn);
    expect(bed.boxTopIn).toBeCloseTo(L.storage.zTop - L.deckTop, 9);
  });
  it('the area is the floor between the sides over that run: bounded by the rectangles at the widest and the narrowest width', () => {
    const len = bed.xStop - bed.x0;
    expect(bed.areaIn2).toBeLessThan(len * bed.widthIn);
    expect(bed.areaIn2).toBeGreaterThan(len * bed.stopWidthIn);
    // Hand check with a trapezoid rule on the same side curve.
    let a = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const x0 = bed.x0 + (len * i) / n, x1 = bed.x0 + (len * (i + 1)) / n;
      a += ((2 * innerHalfWidth(L, x0) + 2 * innerHalfWidth(L, x1)) / 2) * (x1 - x0);
    }
    expect(bed.areaIn2).toBeCloseTo(a, -1); // within 5 in² of 887
  });
  it('the usable length falls with the load width, and the payload width sets how far forward the load can be piled', () => {
    const l24 = bedLengthAtWidth(L, bed, 24), l20 = bedLengthAtWidth(L, bed, 20), l16 = bedLengthAtWidth(L, bed, 16);
    expect(l24).toBeLessThan(l20);
    expect(l20).toBeLessThan(l16);
    expect(bed.loadLengthIn).toBeCloseTo(l20, 0);
    expect(2 * innerHalfWidth(L, bed.xLoadEnd)).toBeGreaterThanOrEqual(defaults.cargoLoadWidthIn - 1e-6);
  });
  it('nothing of the seat kit stands on the bed: with the seat stowed only the foot stop, its cleats and the grab handles (on the gunwales) are above the deck ahead of the box', () => {
    const intruders = stowed.filter((x) => {
      if (x.payload || x.group === 'reference') return false;
      if (!/^(seat-|foot-stop|storage-backer)/.test(x.id)) return false;
      const b = worldAABB(x);
      return b.max[0] > bed.x0 + 0.6 && b.min[2] < L.deckTop + L.sideH - 1e-9 && b.max[0] < bed.xStop + 2;
    }).map((x) => x.id);
    // The grab handles' doublers stand on the inside of the gunwale at the top of the side (1 in proud, 1.5 in tall); they are not on the floor.
    expect(intruders.filter((id) => !/^(doubler|seat-grip|foot-stop)/.test(id)).sort()).toEqual([]);
    for (const id of intruders.filter((q) => /^foot-stop/.test(q))) expect(worldAABB(get(stowed, id)).min[0], id).toBeGreaterThanOrEqual(bed.xStop - 1e-9); // the foot stop ends the bed
    const grips = stowed.filter((x) => /^(doubler-grip|seat-grip-pad)/.test(x.id));
    for (const x of grips) expect(worldAABB(x).min[2]).toBeGreaterThanOrEqual(L.deckTop + L.sideH - L.railBand - 1e-9);
    // In the installed view the wedges and the back DO stand on the bed.
    expect(worldAABB(get(installed, 'seat-wedge-L')).max[0]).toBeGreaterThan(bed.x0);
  });
  it('the box lid stays under the bottom of the grab-handle doublers where the box reaches them (air >= 1/4 in)', () => {
    const lid = worldAABB(get(installed, 'storage-lid'));
    const doubler = worldAABB(get(installed, 'doubler-grip-L'));
    if (L.storage.x1 > doubler.min[0]) expect(doubler.min[2] - lid.max[2]).toBeGreaterThanOrEqual(0.25 - 1e-9);
  });
});

describe('the cargo block in the stowed view', () => {
  const view = buildModel(defaults, { seat: 'stowed', cargo: true });
  it('is the payload on the bed against the box, no mannequin, at the cargo CG height', () => {
    const c = get(view, 'cargo');
    expect(c.massLb).toBe(defaults.cargoPayloadLb);
    expect(c.payload).toBe(true);
    const b = worldAABB(c);
    expect(b.min[0]).toBeCloseTo(L.storage.x1 + 0.5, 6);
    expect(b.max[0] - b.min[0]).toBeCloseTo(defaults.cargoLoadLengthIn, 6);
    expect(b.max[1] - b.min[1]).toBeCloseTo(defaults.cargoLoadWidthIn, 6);
    expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(L.deckTop + defaults.cargoCgHeightIn, 6);
    expect(view.some((x) => x.id.startsWith('rider-'))).toBe(false);
  });
  it('the installed view keeps the 10 Essentials block in the box and the mannequin', () => {
    const v = buildModel(defaults, { rider: 'operating', cargo: true });
    expect(get(v, 'cargo').massLb).toBe(defaults.cargoMassLb);
    expect(v.some((x) => x.id === 'rider-torso')).toBe(true);
  });
  it('the empty-cart mass and CG are unchanged by showing the payload', () => {
    expect(totalMass(view)).toBeCloseTo(totalMass(stowed), 9);
    expect(centerOfGravity(view)[2]).toBeCloseTo(centerOfGravity(stowed)[2], 9);
  });
});

describe('the handlebow (D-53)', () => {
  const h = handleGeometry(defaults, L);
  const bw = bowGeometry(defaults, L);
  const bar = get(installed, 'handle-bar');
  it('is a circular arc through the two post tops that crowns 3 in above them: R = (y^2 + c^2) / 2c by hand', () => {
    const y = L.hwC - defaults.handleUprightInsetIn;
    const c = defaults.handleBowCrownIn;
    expect(bw.radiusIn).toBeCloseTo((y * y + c * c) / (2 * c), 9);
    expect(bw.zPost).toBe(defaults.rearHandleHeightIn);
    expect(bw.zMid - bw.zPost).toBeCloseTo(c, 9);
    // The arc height at the post is the grip height; at the cart edge it has dropped by R - sqrt(R^2 - e^2) - c below the crown.
    const e = L.hwC + L.side;
    expect(bw.zEnd).toBeCloseTo(bw.zPost + c - (bw.radiusIn - Math.sqrt(bw.radiusIn ** 2 - e * e)), 9);
    expect(bw.postSlopeDeg).toBeCloseTo((Math.asin(y / bw.radiusIn) * 180) / Math.PI, 9);
    expect(h.bow).toEqual(bw);
  });
  it('is a bent lamination (4 plies of 5/16 in) of white oak, 1.25 in square, across the cart, with a mass from its length', () => {
    expect(bar.kind).toBe('bentlam');
    expect(bar.fab).toBe('bentlam');
    expect(bar.material).toBe('white oak');
    expect(bar.geometry.type).toBe('sweep');
    if (bar.geometry.type === 'sweep') {
      expect(bar.geometry.plies).toBe(4);
      expect(bar.geometry.width).toBe(defaults.handleBarDiameterIn);
      expect(bar.geometry.thickness).toBe(defaults.handleBarDiameterIn);
    }
    const lenIn = bw.lengthIn;
    expect(lenIn).toBeGreaterThan(2 * (L.hwC + L.side));
    expect(lenIn).toBeLessThan(2 * (L.hwC + L.side) + 6);
    const vol = lenIn * 1.25 * 1.25;
    expect(bar.massLb).toBeGreaterThan((vol / 1728) * defaults.oakDensityPcf);
    expect(bar.massLb).toBeLessThan(((vol / 1728) * defaults.oakDensityPcf) * 1.15 + 0.2);
    expect(bar.stock!.l).toBeCloseTo(lenIn, 6);
    expect(bar.removable).toBe(true);
  });
  it('the posts are cut to the bow slope and carry it on their tops: the post top is at or below the bow underside at both post edges', () => {
    for (const tag of ['L', 'R']) {
      const post = worldAABB(get(installed, `handle-post-${tag}`));
      const yi = h.yPost - defaults.handlePostWidthIn / 2, yo = h.yPost + defaults.handlePostWidthIn / 2;
      const top = Math.max(bowUnderZ(bw, yi, defaults.handleBarDiameterIn), bowUnderZ(bw, yo, defaults.handleBarDiameterIn));
      expect(post.max[2]).toBeCloseTo(top, 6);
      expect(post.max[2]).toBeLessThan(bw.zPost + bw.crownIn); // under the crown
    }
    // The outer edge of the post is lower than the inner (the bow falls away outboard).
    expect(bowUnderZ(bw, h.yPost + 0.7, 1.25)).toBeLessThan(bowUnderZ(bw, h.yPost - 0.7, 1.25));
  });
  it('keeps the D-39 sockets: the same two aluminum tubes at the same place, the post foot and the pin unchanged', () => {
    expect(h.socketX).toBeCloseTo(1.25, 9);
    expect(h.socketY).toBeCloseTo(1.75, 9);
    const sock = worldAABB(get(installed, 'handle-socket-L'));
    expect(sock.min[2]).toBeCloseTo(L.deckTop + L.sideH - defaults.handleSocketDepthIn, 9);
    const post = worldAABB(get(installed, 'handle-post-L'));
    expect(post.min[2]).toBeCloseTo(h.zFoot, 9);
  });
  it('the brake lever hangs under the crown: it stays under the bow at the middle with room for a hand (more than 4 in)', () => {
    const lever = worldAABB(get(installed, 'brake-lever'));
    expect(bw.zMid - defaults.handleBarDiameterIn / 2 - lever.max[2]).toBeGreaterThan(4);
    // Same x as before: the lever is behind the transom, the bow above the sockets.
    const bb = worldAABB(bar);
    expect(bb.min[0]).toBeLessThan(L.xRear);
  });
  it('crown 0 gives the old straight bar at the grip height', () => {
    const p0 = { ...defaults, handleBowCrownIn: 0 } as Params;
    const b0 = bowGeometry(p0, computeLayout(p0));
    expect(Number.isFinite(b0.radiusIn)).toBe(false);
    expect(b0.postSlopeDeg).toBe(0);
    for (const q of b0.path) expect(q[1]).toBe(defaults.rearHandleHeightIn);
    const ps = buildModel(p0, { rider: 'none', cargo: false });
    expect(worldAABB(get(ps, 'handle-post-L')).max[2]).toBeCloseTo(defaults.rearHandleHeightIn - 1.25 / 2, 9);
  });
});
