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
    expect(m({})).toBeGreaterThan(119.4);
    expect(m({})).toBeLessThan(120.6);
    expect(m({}) - m({ brakes: false })).toBeGreaterThan(3.4);
    expect(m({}) - m({ brakes: false })).toBeLessThan(4.4);
    expect(m({}) - m({ lights: false })).toBeGreaterThan(0.9);
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
