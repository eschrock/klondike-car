/**
 * D-65: the removable kits and Transport mode. The viewer's Brakes / Lights / Wheel chocks toggles and its Transport mode, and the truck-fit 'removed' configuration, all read the same
 * model options, so the picture and the fit agree. The signs and the oak tongue are NOT removable (Eric).
 */
import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { buildModel } from './index';
import { configParts } from '../truck/fit';
import { BRAKE_KIT_RE, TRANSPORT_VIEW, isBrakeKit, isChockKit, isLightKit } from './removable';
import { totalMass } from './mass';

const p = defaultParams();
const ids = (v: Parameters<typeof buildModel>[1]) => buildModel(p, { rider: 'none', cargo: false, ...v }).map((x) => x.id);
const all = ids({});

describe('kits', () => {
  it('the brake kit is the flap, pivot block, pin, clip, shoe block, pad, foot tread, cord and snap hook on each side (18 parts), never the knees, backers or chocks', () => {
    const kit = all.filter((id) => BRAKE_KIT_RE.test(id));
    expect(kit).toHaveLength(18);
    expect(kit.some((id) => /knee|backer|chock/.test(id))).toBe(false);
    expect(all.filter((id) => isChockKit({ id }))).toHaveLength(4); // two chocks and their two cords
    expect(all.filter((id) => isLightKit({ id })).sort()).toEqual(['front-light', 'lamp-clip', 'rear-lamp-clip', 'rear-light']);
    expect(isBrakeKit({ id: 'brake-knee-L' })).toBe(false);
  });
  it('Brakes off hides exactly the brake kit; Lights off exactly the four lights; chocks off exactly the chocks; each is independent of the others', () => {
    const noBrakes = ids({ brakes: false });
    expect(all.filter((id) => !noBrakes.includes(id)).sort()).toEqual(all.filter((id) => BRAKE_KIT_RE.test(id)).sort());
    const noLights = ids({ lights: false });
    expect(all.filter((id) => !noLights.includes(id)).sort()).toEqual(['front-light', 'lamp-clip', 'rear-lamp-clip', 'rear-light']);
    const noChocks = ids({ chocks: false });
    expect(all.filter((id) => !noChocks.includes(id)).every((id) => /^brake-chock/.test(id))).toBe(true);
    expect(all.filter((id) => !noChocks.includes(id))).toHaveLength(4);
  });
  it('the sled is lighter without the brake kit (the flaps, pins, cords: about 3.9 lb with their fasteners) and without the lights', () => {
    const m = (v: Parameters<typeof buildModel>[1]) => totalMass(buildModel(p, { rider: 'none', cargo: false, ...v }));
    expect(m({})).toBeGreaterThan(119.5); // D-76: 120.2 lb (the side ribs); D-74: 119.2 lb (2-1/8 in laminated parts) // D-66: 115.5 lb (119.9 before: the narrower bow, the shorter front beam and king beam, the narrower tracks); D-72/D-73: 120.7 lb with the solid rod (+1.9) and the 1/4 in white oak sides, box and lid (+2.8)
    expect(m({})).toBeLessThan(121.5); // D-77: 121.09 lb (the pivot straps and the knee roofs)
    expect(m({}) - m({ brakes: false })).toBeGreaterThan(3.4);
    expect(m({}) - m({ brakes: false })).toBeLessThan(4.4);
    expect(m({}) - m({ lights: false })).toBeGreaterThan(0.9);
  });
});

describe('kits with the knee on quick-release pins (D-78; the full set is in d78.test.ts)', () => {
  const pp = { ...p, kneeMount: 1 } as typeof p;
  const pinIds = (v: Parameters<typeof buildModel>[1]) => buildModel(pp, { rider: 'none', cargo: false, ...v }).map((x) => x.id);
  it('the knee, strap, tab, pad, both pins and the knee-side sleeves join the brake kit (34 parts); the hull sleeves and the chocks do not', () => {
    const parts = buildModel(pp, { rider: 'none', cargo: false });
    const kit = parts.filter((x) => isBrakeKit(x)).map((x) => x.id);
    expect(kit).toHaveLength(34);
    for (const id of ['brake-knee-L', 'brake-strap-R', 'brake-tab-L', 'brake-knee-pad-R', 'brake-pin-B-L', 'brake-pin-T-R', 'brake-sleeve-B-knee-L', 'brake-sleeve-T-tab-R']) expect(kit, id).toContain(id);
    for (const id of ['brake-sleeve-B-hull-L', 'brake-sleeve-T-hull-R', 'brake-chock-L']) expect(kit, id).not.toContain(id);
  });
  it('Brakes off and Transport mode then show a hull with no knee: only the two sleeves per side remain of the mount', () => {
    for (const v of [{ brakes: false }, TRANSPORT_VIEW]) {
      const t = pinIds(v);
      for (const id of ['brake-knee-L', 'brake-knee-R', 'brake-strap-L', 'brake-tab-L', 'brake-pin-T-R']) expect(t, `${JSON.stringify(v)} ${id}`).not.toContain(id);
      for (const id of ['brake-sleeve-B-hull-L', 'brake-sleeve-T-hull-R']) expect(t, `${JSON.stringify(v)} ${id}`).toContain(id);
    }
  });
});

describe('Transport mode', () => {
  it('is TRANSPORT_VIEW: removed, handle parked, seat flat; the truck-fit "removed" configuration builds exactly the same parts as the viewer', () => {
    expect(TRANSPORT_VIEW).toEqual({ removed: true, handle: 'parked', seat: 'stowed' });
    const fit = configParts('removed', (v) => buildModel(p, v as Parameters<typeof buildModel>[1])).map((x) => x.id);
    expect(fit).toEqual(ids(TRANSPORT_VIEW));
  });
  it('takes off the flap kit, the chocks, the lights and the seat pad; keeps the signs, the tongue, the sleeve, the rope, the handle (parked), the knees and the backers', () => {
    const t = ids(TRANSPORT_VIEW);
    for (const id of all.filter((q) => BRAKE_KIT_RE.test(q) || isChockKit({ id: q }) || isLightKit({ id: q }))) expect(t, id).not.toContain(id);
    expect(t).not.toContain('seat-back-pad');
    for (const id of ['sign-L', 'sign-R', 'bridle-tongue', 'bridle-sleeve', 'bridle', 'handle-bar', 'handle-post-L', 'brake-knee-L', 'brake-backer-R']) expect(t, id).toContain(id);
    const parts = buildModel(p, { rider: 'none', cargo: false, ...TRANSPORT_VIEW });
    const bar = parts.find((x) => x.id === 'handle-bar')!;
    const up = buildModel(p, { rider: 'none', cargo: false }).find((x) => x.id === 'handle-bar')!;
    expect(bar.transform[14]).toBeLessThan(up.transform[14]); // parked: lower than at the riding pin position
  });
  it('the signs and the tongue are never removed, in any view', () => {
    for (const v of [{ removed: true }, { brakes: false, lights: false, chocks: false }, TRANSPORT_VIEW, { removed: true, seat: 'stowed' as const }]) {
      const t = ids(v);
      for (const id of ['sign-L', 'sign-R', 'bridle-tongue', 'bridle-sleeve']) expect(t, `${JSON.stringify(v)} ${id}`).toContain(id);
    }
  });
});
