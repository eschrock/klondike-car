/**
 * D-77 (Eric approved, 2026-10-13): the brake knee's thin outboard ear is gone. The slot is a POCKET open at the rear and the outboard side with oak above and below it, a straight
 * stainless STRAP is screwed across the open side and carries the pin's outboard end (double shear kept, the flap still pulls off), and the knee is laminated UPRIGHT / ACROSS / UPRIGHT.
 */
import { describe, expect, it } from 'vitest';
import { buildModel } from '.';
import { KNEE_MOUNT, defaultParams, type Params } from '../params';
import { makeCtx, stainless } from './build-utils';
import { brakeGeometry, PIN_STICKOUT_IN, PIVOT_HOLE_CLEAR_IN } from './brake-layout';
import { buildBrakeAt } from './brake';
import { worldAABB, partsOverlap } from './bounds';
import { METAL_FABS, noFabViolations } from './no-fab';
import { runChecks } from '../analysis/index';
import type { Mat4, Part, Vec3 } from './types';

// The glued knees (the D-78 option): the strap stays on and the glued-knee brake-mount row; the removable knees (the default) are tested in d78.test.ts.
const p: Params = { ...defaultParams(), kneeMount: KNEE_MOUNT.fixed };
const parts = buildModel(p);
const get = (id: string, ps: Part[] = parts): Part => ps.find((x) => x.id === id)!;
const ctx = makeCtx(p);
const g = brakeGeometry(ctx.p, ctx.L);
const toWorld = (m: Mat4, v: Vec3): Vec3 => [0, 1, 2].map((k) => m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k]) as Vec3;
const cs = runChecks(p, { includeTruck: false });
const row = (id: string) => cs.find((c) => c.id === id)!;

describe('D-77 the pivot strap replaces the outboard ear', () => {
  it('a straight stainless flat bar on each knee: Standard 304, Extreme 316, cut and drilled only, not removable', () => {
    for (const w of [0, 1]) {
      const q = { ...p, weatherSpec: w } as Params;
      const ps = buildModel(q);
      for (const tag of ['L', 'R']) {
        const st = get(`brake-strap-${tag}`, ps);
        expect(st.kind).toBe('metal');
        expect(METAL_FABS.has(st.fab)).toBe(true);
        expect(st.material).toContain(stainless(q));
        expect(st.material).toMatch(/flat bar 1\/8" x 2"/);
        expect(st.removable ?? false).toBe(false);
        expect(st.notes).toMatch(/cut on the metal bandsaw, deburr, drill on the drill press/);
      }
    }
    expect(g.strap.t).toBe(p.brakeStrapThickIn);
    expect(g.strap.w).toBe(p.brakeStrapWidthIn);
    expect(g.strap.pinHole).toBeCloseTo(p.brakePivotPinDiaIn + PIVOT_HOLE_CLEAR_IN, 9); // 13/32 in
    expect(g.strap.y0).toBeCloseTo(g.knee.yOut, 9); // on the knee's outboard face
    expect(g.strap.x0).toBeCloseTo(g.knee.x0, 9); // flush with the knee's rear face, the 2 in bar inside the knee's 2-1/8 in depth
    expect(g.strap.x1).toBeLessThanOrEqual(g.knee.x1);
  });
  it('the pin goes through the strap, the tongue and blind into the inboard ear (double shear), the clip outboard of the strap', () => {
    const pin = worldAABB(get('brake-pivot-pin-L'));
    expect(pin.max[1]).toBeCloseTo(g.strap.y1 + PIN_STICKOUT_IN, 6);
    expect(pin.min[1]).toBeCloseTo(g.pivot.ySlot[0] - g.pivot.blind, 6);
    const clip = worldAABB(get('brake-pivot-clip-L'));
    expect(clip.min[1]).toBeGreaterThan(g.strap.y1);
    // the pin hole is inside the strap with 1.5 pin diameters of metal to its nearer edge
    const e = Math.min(g.H[0] - g.strap.x0, g.strap.x1 - g.H[0], g.strap.z1 - g.H[1], g.H[1] - g.strap.z0);
    expect(e / p.brakePivotPinDiaIn).toBeGreaterThanOrEqual(1.5);
    for (const id of ['brake-flap-L', 'brake-pivot-block-L', 'brake-pivot-pin-L', 'brake-pivot-clip-L']) expect(get(id).removable, id).toBe(true); // D-65: pull the pin, the flap comes off
  });
  it('four #8 x 1-1/4 screws (D-72) in the SIDE grain of the two UPRIGHT layers, one row in the roof over the pocket and one in the floor under it, 3/8 in from the pocket', () => {
    const st = get('brake-strap-L'), kn = get('brake-knee-L');
    const j = st.joints!.find((q) => q.type === 'screw')!;
    expect(j.count).toBe(4);
    expect(j.fit).toMatchObject({ gauge: 8, lenIn: 1.25 });
    expect(j.size).toMatch(/PAN-HEAD/);
    for (const x of g.strap.xs) expect(g.knee.layers.find((q) => x > q.x0 && x < q.x1)!.grain).toBe('z');
    expect(Math.max(...g.strap.zs)).toBeCloseTo(g.pivot.zPocketTop + p.brakeKneeRoofIn / 2, 9);
    expect(Math.min(...g.strap.zs)).toBeCloseTo(g.pivot.zPocketBot - p.brakeKneeFloorIn / 2, 9);
    // the strap's screw points and the knee's pilot points agree in the world
    const sw = j.at!.map((a) => toWorld(st.transform, a));
    const kw = kn.joints!.find((q) => q.type === 'screw' && q.to === st.id)!.at!.map((a) => toWorld(kn.transform, a));
    for (let i = 0; i < 4; i++) { expect(sw[i][0]).toBeCloseTo(kw[i][0], 6); expect(sw[i][2]).toBeCloseTo(kw[i][2], 6); }
  });
  it('the strap lies on the knee and never touches the flap group over the swing; nothing of the knee stands outboard of the pocket', () => {
    const c = makeCtx(p);
    expect(partsOverlap(get('brake-strap-L'), get('brake-knee-L'))).toBeLessThanOrEqual(0.01);
    for (let i = 0; i <= 10; i++) for (const m of buildBrakeAt(c, i / 10, true).filter((x) => /^brake-(flap|pivot-block)-L$/.test(x.id))) expect(partsOverlap(m, get('brake-strap-L')), `${m.id} ${i}`).toBeLessThan(0);
    expect(worldAABB(get('brake-knee-L')).max[1]).toBeCloseTo(g.pivot.ySlot[1], 6);
  });
});

describe('D-77 the brake-pivot row checks the strap', () => {
  it('the strap, its screws, the roof and the floor are in the row and it passes; the old ear checks are gone; brake-mount passes lower than D-75', () => {
    const pv = row('brake-pivot');
    for (const re of [/pivot strap: pin bearing/, /pivot strap: tear-out/, /pivot strap: tension \+ in-plane bending/, /pivot strap: out-of-plane bending/, /pivot strap screws: lateral/, /pivot strap screws: withdrawal/, /knee roof over the pocket/, /knee floor under the pocket/])
      expect(pv.details!.some((d) => re.test(d.name)), String(re)).toBe(true);
    expect(pv.details!.some((d) => /outboard ear|islands|bridge ahead/.test(d.name))).toBe(false);
    expect(pv.status).toBe('pass');
    expect(pv.util!).toBeLessThan(0.787); // the D-75 governor (the ear's layer islands) is gone
    expect(row('brake-mount').util!).toBeLessThan(0.72);
    expect(row('brake-abuse').status).toBe('pass');
  });
  it('the sideways-push case scales with brakeFlapSideLoadLbf: twice the push, twice the screw withdrawal', () => {
    const wd = (q: Params) => runChecks(q, { includeTruck: false }).find((c) => c.id === 'brake-pivot')!.details!.find((d) => /screws: withdrawal/.test(d.name))!.value;
    expect(wd({ ...p, brakeFlapSideLoadLbf: 20 } as Params)).toBeCloseTo(2 * wd(p), 6);
  });
});

describe('D-77 the no-fabrication rule holds for every metal part', () => {
  it('no metal part, in either weather spec, asks for bending, welding, tapping, machining, countersinking, filing or a fab step beyond cut and drill', () => {
    for (const w of [0, 1]) expect(noFabViolations(buildModel({ ...p, weatherSpec: w } as Params))).toEqual([]);
  });
});
