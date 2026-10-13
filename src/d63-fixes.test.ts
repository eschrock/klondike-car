/**
 * Phase 3c-8 (D-63): the last buildability fixes (build review round 2, 8/10). Each block pins one fix: the seat-back latch pins (2 in up the panel, blind holes sized from the stop-block outline,
 * hinge/pin backer pads butted to the joist), the 5/8 in socket access holes, the deck side clearance, the glue-up posture, the strip lengths, the sign standoff and knob screws, the crest
 * strip length, the insert depth, the grab-board head backing and the refreshed notes.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, validateParams } from './params';
import { PRE_D72 } from './test-fixtures';
import { buildModel } from './model';
import { computeLayout, sideTopAt } from './model/layout';
import { worldAABB } from './model/bounds';
import { HULL_STEP } from './model/build-utils';
import { GRIP_BACKING_H_IN, GRIP_BACKING_T_IN, HINGE_BACKER_THICK_IN, INSERT_VENEER_MIN_IN, LATCH_HOLE_WALL_MIN_IN, PIN_LEN_IN, PIN_R_IN, gripBackingLen, hingeBacker, latchGeometry, seatBackSupport } from './model/seat';
import { signKnobPlan } from './model/body';
import { makeCtx } from './model/build-utils';
import { SOCKET_ACCESS_HOLE_IN, SOCKET_SCREW_HEAD_IN, SOCKET_SCREW_WASHER_IN } from './model/handle';
import { runChecks } from './analysis';
import { seatBackLoads } from './analysis/seat';
import { makeContext } from './analysis/context';

// D-73: these D-63 numbers (the 0.391 in bearing land, the 7/8 in knob screw, the 0.234 in bands) are for the 4 mm okoume sandwich: PRE_D72
const defaults = { ...defaultParams(), ...PRE_D72 };
const L = computeLayout(defaults);
const parts = buildModel(defaults);
const get = (id: string) => parts.find((x) => x.id === id)!;
const cs = runChecks(defaults, { includeTruck: false });
const row = (id: string) => cs.find((c) => c.id === id)!;

describe('R2-M1: the seat-back latch pins', () => {
  const lg = latchGeometry(defaults, L);
  const sup = seatBackSupport(defaults, L);
  it('the pin stations are 2 in up the panel (owner-approved), not 3', () => {
    expect(defaults.seatBackLatchHeightIn).toBe(2);
    expect(sup.c2L).toBeCloseTo(2, 9);
  });
  it('the upright blind hole is sized from the stop-block outline at that height and leaves at least 1/4 in of oak: it never reaches the 4 mm box end', () => {
    // the block along the pin axis, measured independently from the wedge outline: the axis leaves the panel's rear face at c2L and runs aft (-col0) to the box end at x = xv
    const s = L.seat;
    const x0 = s.Pr[0] + s.col2[0] * sup.c2L, z0 = s.Pr[2] + s.col2[2] * sup.c2L;
    const tAxial = (x0 - sup.xv) / s.col0[0];
    expect(lg.blockIn).toBeCloseTo(tAxial, 9);
    expect(lg.blockIn).toBeGreaterThan(1.4); // 1.53 in at 2 in (it is 1.27 in at the old 3 in, and the 1.5 in hole of 3c-7 ran 0.3 in into the box end)
    expect(lg.upHoleIn).toBeCloseTo(1.0625, 9); // the pin seats 1.028 in into the block (1-1/2 in pin through the 0.472 in panel), plus 0.03 in, up to 1/16
    expect(lg.upHoleIn).toBeGreaterThanOrEqual(PIN_LEN_IN - defaults.seatBackThickIn);
    expect(lg.upLeftIn).toBeGreaterThanOrEqual(LATCH_HOLE_WALL_MIN_IN);
    expect(lg.blockIn - lg.upHoleIn).toBeGreaterThan(0.4);
    expect(z0).toBeGreaterThan(L.deckTop + 1); // the hole is above the floor of the block
    const hole = get('seat-wedge-L').joints!.find((j) => j.type === 'pin')!;
    expect(hole.size).toMatch(/blind hole 1\.0625" deep/);
    expect(hole.size).toMatch(/detent groove/);
  });
  it('the pin model seats its head on the panel face: its tip ends inside the block, short of the box end', () => {
    const pin = worldAABB(get('seat-pin-L'));
    const end = worldAABB(get('storage-end-fore'));
    expect(pin.min[0]).toBeGreaterThan(end.max[0] + 0.2); // tip 0.2+ in short of the box end (x range of the end panel is 6.889..7.046)
    expect(pin.min[0]).toBeGreaterThan(sup.xv + 0.2);
  });
  it('the flat-position pin lands in solid oak: the backer pad is 1 in thick, 3 in across the pin, butted to a joist, with the blind hole short of its bottom', () => {
    const hb = hingeBacker(defaults, L);
    const flatX = L.seat.P[0] + sup.c2L;
    for (const [tag, sg] of [['L', 1], ['R', -1]] as const) {
      const b = worldAABB(get(`seat-hinge-backer-${tag}`));
      expect(b.max[0]).toBeCloseTo(hb.x1, 9);
      expect(b.max[2] - b.min[2]).toBeCloseTo(HINGE_BACKER_THICK_IN, 9);
      // pin to every edge of the pad that is not glued to a joist: at least 4 pin diameters (the pad's back end, and both sides)
      expect(flatX - b.min[0]).toBeGreaterThanOrEqual(8 * PIN_R_IN - 1e-9);
      expect(Math.abs(b.min[1] - sg * sup.stileY)).toBeGreaterThanOrEqual(8 * PIN_R_IN - 1e-9);
      expect(Math.abs(b.max[1] - sg * sup.stileY)).toBeGreaterThanOrEqual(8 * PIN_R_IN - 1e-9);
      expect(flatX).toBeGreaterThan(b.min[0]);
      expect(flatX).toBeLessThan(b.max[0]);
    }
    // the pad ends AT a joist face (butted), and the old 3 in strip's 0.5 in overshoot onto the joist is gone
    const jx = L.joistX.find((x) => Math.abs(x - L.joistT / 2 - hb.x1) < 1e-6);
    expect(jx).toBeDefined();
    expect(lg.flatHoleIn).toBeCloseTo(0.625, 9);
    expect(lg.flatLeftIn).toBeCloseTo(0.375, 9);
    expect(lg.flatLeftIn).toBeGreaterThanOrEqual(LATCH_HOLE_WALL_MIN_IN);
    expect(get('seat-pin-L').material).toMatch(/spring-detent/);
  });
  it('is lighter than the one-piece 3/4 in strip it replaced (two 3 x 3.47 x 1 in pads against one 16.5 x 3 x 0.75 in strip)', () => {
    const m = get('seat-hinge-backer-L').massLb + get('seat-hinge-backer-R').massLb;
    expect(m).toBeLessThan(1.0);
    expect(parts.some((x) => x.id === 'seat-hinge-backer')).toBe(false);
  });
  it('a higher latch height or an upright back never leaves less than 1/4 in of oak behind the hole unless the station is already at its 3/4 in floor', () => {
    for (const lean of [3, 8, 15, 22, 30]) for (const h of [1.5, 2, 3, 4.5, 6]) {
      const p = { ...defaults, seatBackAngleDeg: lean, seatBackLatchHeightIn: h };
      if (validateParams(p).some((i) => i.severity === 'error')) continue;
      const L2 = computeLayout(p);
      const s2 = seatBackSupport(p, L2);
      const g = latchGeometry(p, L2);
      expect(s2.c2L, `lean ${lean} h ${h}`).toBeLessThanOrEqual(h + 1e-9);
      expect(g.upLeftIn >= LATCH_HOLE_WALL_MIN_IN - 1e-9 || s2.c2L <= 0.75 + 1e-9, `lean ${lean} h ${h}: left ${g.upLeftIn.toFixed(2)} at ${s2.c2L}`).toBe(true);
    }
  });
  it('the seat-back row checks the oak left behind both holes, and it still passes (pin tear-out in ply governs at 0.78)', () => {
    const c = row('seat-back');
    expect(c.status).toBe('pass');
    expect(c.details!.some((d) => /oak left behind the upright latch hole/.test(d.name))).toBe(true);
    expect(c.details!.some((d) => /oak left under the flat latch hole/.test(d.name))).toBe(true);
    expect(c.util!).toBeLessThan(0.9);
    expect(c.util!).toBeGreaterThan(0.7);
    const ctx = makeContext(defaults, parts);
    const k = seatBackLoads(ctx, 200);
    expect(k.sup.c2L).toBeCloseTo(2, 9);
  });
});

describe('R2-M2: the handle-socket access holes', () => {
  it('are 5/8 in: the 0.44 in button head and its 0.5 in nylon washer pass with room to spare', () => {
    expect(SOCKET_ACCESS_HOLE_IN).toBeCloseTo(0.625, 9);
    expect(SOCKET_ACCESS_HOLE_IN).toBeGreaterThan(SOCKET_SCREW_WASHER_IN + 0.0625);
    expect(SOCKET_ACCESS_HOLE_IN).toBeGreaterThan(SOCKET_SCREW_HEAD_IN);
    const j = get('handle-socket-L').joints!.find((q) => q.to === 'transom-rear')!;
    expect(j.size).toMatch(/0\.625" \(5\/8 in\) ACCESS HOLE/);
    expect(j.size).toMatch(/button plugs/);
    expect(get('handle-socket-L').notes).toMatch(/enlarged from 3\/8 in/);
    expect(get('handle-socket-L').sourcing!.vendor).toMatch(/button plugs/);
  });
  it('leave 0.44 in of wall each side on the 1.5 in face, and the tube row checks the net section at the hole', () => {
    expect(get('handle-socket-L').notes).toMatch(/Leaves 0\.44" of wall each side/);
    const c = row('handle-sockets');
    const net = c.details!.find((d) => /net of the 0\.625" access hole/.test(d.name))!;
    expect(net).toBeDefined();
    expect(net.util).toBeLessThan(0.3);
    expect(c.status).toBe('pass');
  });
});

describe('R2-M3: the deck side clearance', () => {
  it('the deck is 1/16 in narrower on each side than the gap between the two webs, and still tucks 0.17 in under each inner chine band', () => {
    expect(defaults.deckSideClearIn).toBeCloseTo(0.0625, 9);
    const b = worldAABB(get('deck'));
    const webGap = 2 * (L.hwC + L.sideBand); // between the web faces
    expect(b.max[1] - b.min[1]).toBeCloseTo(webGap - 2 * 0.0625, 6);
    expect(L.deckEdge).toBeCloseTo(L.sideBand - 0.0625, 9);
    expect(L.deckEdge).toBeGreaterThan(0.1);
    // the web's inner face is at hwC + sideBand; the deck stops 1/16 in short of it
    expect(b.max[1]).toBeCloseTo(L.hwC + L.sideBand - 0.0625, 6);
    expect(get('deck').notes).toMatch(/NARROWER on each side/);
    expect(get('deck').notes).toMatch(/thickened epoxy/);
  });
  it('zero clearance reproduces the 3c-7 geometry (23.218 in deck), and a clearance that leaves under 0.1 in of tuck is a warning', () => {
    const p0 = { ...defaults, deckSideClearIn: 0 };
    const b0 = worldAABB(buildModel(p0).find((x) => x.id === 'deck')!);
    expect(b0.max[1] - b0.min[1]).toBeCloseTo(2 * (L.hwC + L.sideBand), 6);
    expect(validateParams({ ...defaults, deckCaptureDepthIn: 0.125 }).some((i) => i.severity === 'warn' && i.keys.includes('deckSideClearIn'))).toBe(true);
    expect(validateParams(defaults).some((i) => i.keys.includes('deckSideClearIn'))).toBe(false);
  });
  it('the rabbet and chine-tie joints still sit on the right faces (the bearing land is outer band + web edge, unchanged by the clearance)', () => {
    const tie = get('side-L-chine').joints!.find((j) => j.to === 'rail-L' && /bearing face/.test(j.size ?? ''))!;
    expect(tie.size).toMatch(/3\/8" bearing face/); // 0.391 in: the outer band + the web edge, as in 3c-7
    const rabbet = get('side-L-chine-in').joints!.find((j) => j.type === 'rabbet')!;
    expect(rabbet.size).toMatch(/3\/16" × 0\.512" gap/); // the deck tucks 0.172 in (3/16 in nominal) under the band
    expect(rabbet.size).toMatch(/cut 1\/16" short of the web on each side/);
  });
});

describe('the glue-up posture and the strip lengths', () => {
  it('the band and web notes carry the posture: flat on a ramp form, cleats along the sheer line, one face per cure (two cures per side), the long S-bend of the taper in the 5 to 7 in web', () => {
    for (const id of ['side-L-web', 'side-L-gunwale', 'side-L-chine-in']) {
      const n = get(id).notes!;
      expect(n, id).toMatch(/GLUE-UP POSTURE/);
      expect(n, id).toMatch(/FLAT on the bench with the S-ramp form/);
      expect(n, id).toMatch(/CLEAT THE SHEER LINE/);
      expect(n, id).toMatch(/TWO CURES PER SIDE/);
      expect(n, id).toMatch(/5 to 7" tall/);
    }
    expect(HULL_STEP.sides).toBe(4.2);
  });
  it('the S-bend really is in a web about 5 in tall (the note is true): the free web, chine bottom to the cap, over the bow taper (D-66)', () => {
    for (const x of [L.taper.x0, (L.taper.x0 + L.taper.x1) / 2, L.taper.x1, L.xSideEnd]) {
      const h = sideTopAt(L, x) - L.webCap - L.chineBot;
      expect(h, `x ${x.toFixed(1)}`).toBeGreaterThan(4);
      expect(h, `x ${x.toFixed(1)}`).toBeLessThan(7); // D-66: the taper starts where the free web is 6.8 in tall and ends where it is 5 in
    }
  });
  it('the gunwale strip note gives the 60.4 in rough length and says a 5 ft board does not make it; the chine note does too', () => {
    const g = get('side-L-gunwale');
    expect(g.rough!.l).toBeCloseTo(60.4, 1);
    expect(g.notes).toMatch(/60\.4" ROUGH/);
    expect(g.notes).toMatch(/5 ft board does NOT make it/);
    expect(g.notes).toMatch(/middle third/);
    expect(get('side-L-chine').notes).toMatch(/5 ft board does NOT make it/);
    expect(get('side-L-chine').notes).toMatch(/59\.3" rough|59\.2" rough/);
  });
  it('HULL_STEP-derived text: the rails are glued 1/2 in long and trimmed at the dry fit; the frame notes say so', () => {
    expect(get('rail-L').notes).toMatch(/1\/2" LONG at both ends/);
    expect(get('deck').notes).toMatch(/trim the rails of the frame unit/);
  });
});

describe('S4: the sign standoff and knob screws', () => {
  const kn = signKnobPlan(makeCtx(defaults));
  it('the knob screw is the longest 1/8 in length that leaves 1/8 in of wood behind its tip, and engages at least 0.2 in of the insert', () => {
    expect(kn.standoffIn).toBeCloseTo(L.side - L.sideBand - defaults.panelPlyIn + GRIP_BACKING_T_IN, 9);
    expect(kn.standoffIn).toBeGreaterThan(0.234);
    expect(kn.lenIn).toBeCloseTo(0.875, 9);
    expect(kn.engagedIn).toBeGreaterThanOrEqual(0.2);
    expect(kn.engagedIn).toBeLessThanOrEqual(kn.insertLenIn);
    expect(kn.tipShortIn).toBeGreaterThanOrEqual(0.125);
    expect(kn.lenIn).toBeCloseTo(kn.stackIn + kn.engagedIn, 9);
  });
  it('the sign joints and notes carry the standoff discs and the 7/8 in screw; the 1 in screw is gone', () => {
    const j = get('sign-L').joints!.find((q) => q.type === 'knob')!;
    expect(j.size).toMatch(/#10-32 × 0\.875 in thumb-knob screw/);
    expect(j.size).toMatch(/standoff disc/);
    expect(get('sign-L').notes).toMatch(/standoff discs/);
    expect(get('sign-backer-L1').notes).toMatch(/0\.875 in long/);
    expect(get('sign-backer-L1').notes).not.toMatch(/1 in long/);
  });
});

describe('S7: the crest strip spans the gap between the blocks', () => {
  it('is 13.5 in long (it was 6.7), end to end with both stop blocks, and held off the lid-hinge leaves', () => {
    const strip = worldAABB(get('seat-crest-strip'));
    const wl = worldAABB(get('seat-wedge-L')), wr = worldAABB(get('seat-wedge-R'));
    expect(strip.max[1] - strip.min[1]).toBeCloseTo(13.5, 6);
    expect(strip.max[1]).toBeCloseTo(wl.min[1], 6);
    expect(strip.min[1]).toBeCloseTo(wr.max[1], 6);
    const hinge = worldAABB(get('storage-hinge-L'));
    expect(strip.min[0]).toBeGreaterThan(hinge.max[0]); // bedded off the leaves, not through them
    expect(get('seat-crest-strip').notes).toMatch(/13\.5" gap|13\.5 in at the defaults/);
    expect(get('seat-back-panel').notes).toMatch(/whole 13\.5 in between the blocks/);
  });
});

describe('S8: the hinge insert holes leave the back veneer', () => {
  it('the blind hole is the panel less 1/8 in rounded down to 1/32 in, with a 5/16 in insert, and the screws are 3/8 in', () => {
    const t = defaults.seatBackThickIn;
    const hole = Math.floor((t - INSERT_VENEER_MIN_IN) * 32) / 32;
    expect(t - hole).toBeGreaterThanOrEqual(INSERT_VENEER_MIN_IN);
    const j = get('seat-back-panel').joints!.find((q) => q.to === 'seat-hinge-L')!;
    expect(j.size).toMatch(/5\/16 316 threaded inserts/);
    expect(j.size).toMatch(/0\.344" deep/);
    expect(j.size).toMatch(/leaving 0\.128" of back veneer/);
    expect(get('seat-hinge-L').joints!.find((q) => q.to === 'seat-back-panel')!.size).toMatch(/#10-32 × 3\/8 316 flat-head/);
  });
});

describe('S9: the grab-board screw heads', () => {
  it('bear on a 1/16 x 1 in 316 backing strip on the outer gunwale band, bedded and drilled with the board; the heads, strip bearing and punching are checked', () => {
    const strip = get('seat-grip-backing-L');
    expect(strip.material).toMatch(/316/);
    expect(strip.kind).toBe('metal');
    const b = worldAABB(strip);
    expect(b.max[1] - b.min[1]).toBeCloseTo(GRIP_BACKING_T_IN, 6);
    expect(b.min[1]).toBeCloseTo(L.hwC + L.side, 3); // the outer face of the outer band
    expect(strip.massLb).toBeGreaterThan(0.05);
    expect(strip.massLb).toBeLessThan(0.15);
    const grip = get('seat-grip-L');
    expect(grip.joints![0].size).toMatch(/button-head cap screws/);
    expect(grip.joints![0].size).toMatch(/backing strip/);
    expect(strip.joints!.some((j) => j.type === 'glue' && j.to === 'side-L-gunwale')).toBe(true);
    const c = row('seat-grip');
    expect(c.status).toBe('pass');
    expect(c.details!.some((d) => /backing strip bearing/.test(d.name))).toBe(true);
    expect(c.details!.some((d) => /punching/.test(d.name))).toBe(true);
    for (const d of c.details!) expect(d.util, d.name).toBeLessThan(0.9);
    expect(gripBackingLen(defaults.grabBoardLengthIn)).toBeGreaterThan(5);
    expect(GRIP_BACKING_H_IN).toBe(1);
  });
  it('the sign hangs 1/16 in proud so it clears the strip, wherever the seat puts the board', () => {
    const s = worldAABB(get('sign-L'));
    expect(s.min[1]).toBeCloseTo(L.hwC + L.side + GRIP_BACKING_T_IN, 6);
  });
});

describe('refreshed notes (no tenons, grooves or old gaps)', () => {
  it('the transom and the bulkhead say butt joints with a fillet and one end at a time', () => {
    const t = get('transom-rear').notes!;
    expect(t).not.toMatch(/GOES ON LAST|chine and gunwale tenons/);
    expect(t).toMatch(/CLOSED FIRST/);
    expect(t).toMatch(/butt against it with an epoxy fillet/);
    const b = get('bow-bulkhead').notes!;
    expect(b).not.toMatch(/rails, chine and gunwale end on it with Dominos/);
    expect(b).toMatch(/band ends of each side butt against it with an epoxy fillet/);
  });
  it('the roll pad gap is 0.10 in (rail 0.35 in over the tube, 1/4 in pad), the doublers and grab boards are on the INNER gunwale band, and the rail does not enter a rabbet', () => {
    expect(get('roll-pad-L').notes).toMatch(/running gap of about 0\.1"/);
    expect(get('roll-pad-L').notes).not.toMatch(/about 0\.15"/);
    expect(get('doubler-lash-L1').joints!.find((j) => j.type === 'glue')!.to).toBe('side-L-gunwale-in');
    expect(get('doubler-lash-L1').joints![0].note).not.toMatch(/web groove/);
    expect(get('seat-grip-L').joints![0].to).toBe('side-L-gunwale-in');
    expect(get('rail-L').notes).not.toMatch(/chine's rabbet/);
    for (const x of parts) expect(`${x.notes ?? ''} ${(x.joints ?? []).map((j) => `${j.size ?? ''} ${j.note ?? ''}`).join(' ')}`, x.id).not.toMatch(/web groove|1\.97" of stack/);
  });
  it('the lamp-clip clearance and the wheel bore are marked VERIFY ON THE REAL PARTS', () => {
    expect(get('lamp-clip').notes).toMatch(/VERIFY ON THE REAL PARTS/);
    expect(get('lamp-clip').notes).toMatch(/1" test slice/);
    expect(get('wheel-RL').notes).toMatch(/VERIFY ON THE REAL PART/);
  });
});
