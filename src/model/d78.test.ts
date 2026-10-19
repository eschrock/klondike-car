/**
 * D-78 (Eric): the brake knees are REMOVABLE WITH TOOLS by default (`kneeMount`, 2026-10-19), with knees that stay on (bolted, glued) as the option. The four 3/8" bolts, the backer and the
 * backing plate are the same in both settings; the removable knee is fitted dry (no epoxy against the rail) and comes off with its strap and the flap kit, with a ratchet and wrench.
 */
import { describe, expect, it } from 'vitest';
import { buildModel } from '.';
import { KNEE_MOUNT, PARAM_DEFS, WEATHER_SPEC, defaultParams, type Params } from '../params';
import { brakeGeometry } from './brake-layout';
import { makeCtx } from './build-utils';
import { worldAABB } from './bounds';
import { totalMass } from './mass';
import { BRAKE_KIT_RE, BRAKE_KNEE_RE, TRANSPORT_VIEW, isBrakeKit, isChockKit } from './removable';
import { boxGear, toolPouch } from './storage';
import { noFabViolations } from './no-fab';
import { configParts } from '../truck/fit';
import type { Part } from './types';

const removable: Params = defaultParams();
const fixed: Params = { ...removable, kneeMount: KNEE_MOUNT.fixed };
const empty = { rider: 'none', cargo: false } as const;
const view = (p: Params, v: Parameters<typeof buildModel>[1] = {}) => buildModel(p, { ...empty, ...v });
const ids = (p: Params, v: Parameters<typeof buildModel>[1] = {}) => view(p, v).map((x) => x.id);
const KNEES = ['brake-knee-L', 'brake-knee-R', 'brake-strap-L', 'brake-strap-R'];

describe('D-78 the setting', () => {
  it('defaults to removable knees; the option labels are the ones the Advanced panel shows', () => {
    expect(removable.kneeMount).toBe(KNEE_MOUNT.removable);
    expect(PARAM_DEFS.kneeMount.options!.map((o) => o.label)).toEqual(['Knees stay on (bolted, glued)', 'Removable knees (bolts, ratchet)']);
    expect(PARAM_DEFS.kneeMount.ref).toBe('D-78');
    expect(PARAM_DEFS.kneeMount.note).toBeTruthy();
    for (const k of ['toolPouchLengthIn', 'toolPouchWidthIn', 'toolPouchHeightIn'] as const) expect(PARAM_DEFS[k].status, k).toBe('assumed');
    expect([fixed.toolPouchLengthIn, fixed.toolPouchWidthIn, fixed.toolPouchHeightIn]).toEqual([9, 3, 2]);
  });
});

describe('D-78 the knees are removable only in the removable setting', () => {
  it('the knees and straps are removable parts in removable mode and never in the default', () => {
    for (const id of KNEES) {
      expect(view(fixed).find((x) => x.id === id)!.removable, `${id} fixed`).toBeFalsy();
      expect(view(removable).find((x) => x.id === id)!.removable, `${id} removable`).toBe(true);
    }
    // the backer and backing plate stay on in both settings
    for (const id of ['brake-backer-L', 'brake-backer-R', 'brake-backplate-L', 'brake-backplate-R']) {
      expect(view(removable).find((x) => x.id === id)!.removable, id).toBeFalsy();
    }
  });
  it('the kit helper takes the knees and straps only with the removable setting', () => {
    expect(BRAKE_KNEE_RE.test('brake-knee-L')).toBe(true);
    expect(BRAKE_KIT_RE.test('brake-knee-L')).toBe(false);
    expect(isBrakeKit({ id: 'brake-knee-L' })).toBe(false);
    expect(isBrakeKit({ id: 'brake-knee-L' }, fixed)).toBe(false);
    expect(isBrakeKit({ id: 'brake-knee-L' }, removable)).toBe(true);
    expect(isBrakeKit({ id: 'brake-strap-R' }, removable)).toBe(true);
    expect(isBrakeKit({ id: 'brake-backer-R' }, removable)).toBe(false);
    expect(isChockKit({ id: 'brake-chock-L' })).toBe(true); // the chocks stay a separate toggle
  });
  it('Brakes off and Transport mode drop the knees and straps only in removable mode', () => {
    for (const v of [{ brakes: false }, TRANSPORT_VIEW] as const) {
      for (const id of KNEES) {
        expect(ids(removable, v), `removable ${JSON.stringify(v)} ${id}`).not.toContain(id);
        expect(ids(fixed, v), `fixed ${JSON.stringify(v)} ${id}`).toContain(id);
      }
      for (const id of ['brake-backer-L', 'brake-backplate-R']) expect(ids(removable, v), id).toContain(id);
    }
    // the chocks are their own toggle: Brakes off leaves them (and their cords) on
    expect(ids(removable, { brakes: false })).toContain('brake-chock-L');
    expect(ids(removable, { chocks: false })).toContain('brake-knee-L');
    expect(ids(removable, { chocks: false })).not.toContain('brake-chock-L');
  });
  it('the truck-fit "removed" configuration is the same set as the viewer (knees off in removable mode)', () => {
    const fit = configParts('removed', (v) => buildModel(removable, v as Parameters<typeof buildModel>[1])).map((x) => x.id);
    expect(fit).toEqual(ids(removable, TRANSPORT_VIEW));
    expect(fit).not.toContain('brake-knee-L');
  });
  it('the chock notes say the chock rides with its knee', () => {
    const ps = view(removable);
    const note = (id: string) => ps.find((x) => x.id === id)!.notes ?? '';
    expect(note('brake-chock-L')).toMatch(/rides with its knee/);
    expect(note('brake-chock-cord-L')).toMatch(/travels with its knee/);
    expect(note('brake-chock-cord-L')).not.toMatch(/unclip|clip it back/);
    expect(note('brake-chock-L')).not.toMatch(/unclip/);
    expect(view(fixed).find((x) => x.id === 'brake-chock-L')!.notes).not.toMatch(/rides with its knee/);
  });
});

describe('D-78 dry fit: no epoxy against the rail', () => {
  const glue = (p: Params, id: string) => (view(p).find((x) => x.id === id)!.joints ?? []).filter((j) => j.type === 'glue' && j.to.startsWith('rail-'));
  it('the default knee is glued to the rail; the removable knee has no glue joint to it, but the same four bolts', () => {
    expect(glue(fixed, 'brake-knee-L')).toHaveLength(1);
    expect(glue(removable, 'brake-knee-L')).toHaveLength(0);
    for (const p of [fixed, removable]) {
      const bolt = view(p).find((x) => x.id === 'brake-knee-L')!.joints!.find((j) => j.type === 'bolt')!;
      expect(bolt.count).toBe(4);
      expect(bolt.diaIn).toBe(p.brakeMountBoltDiaIn);
    }
    const notes = view(removable).find((x) => x.id === 'brake-knee-L')!.notes!;
    expect(notes).toMatch(/fitted DRY/);
    expect(notes).toMatch(/seal and finish its inboard face on the bench, and the rail face under it with the underside/);
    expect(notes).not.toMatch(/unclip/);
  });
  it('the backing plate is bedded in thickened epoxy in its recess in removable mode (a glue joint to the backer), so it stays when the bolts come out; the default plate is only drilled', () => {
    const plateGlue = (p: Params) => (view(p).find((x) => x.id === 'brake-backplate-L')!.joints ?? []).filter((j) => j.type === 'glue');
    expect(plateGlue(fixed)).toHaveLength(0);
    expect(plateGlue(removable)).toHaveLength(1);
    expect(plateGlue(removable)[0].to).toBe('brake-backer-L');
    expect(view(removable).find((x) => x.id === 'brake-backplate-L')!.notes).toMatch(/bed the plate in thickened epoxy/);
    // not removable, so it is still on the sled in the Transport view
    expect(ids(removable, TRANSPORT_VIEW)).toContain('brake-backplate-L');
  });
  it('the rail keeps its four bolt holes, and the backer and backing plate are unchanged', () => {
    for (const p of [fixed, removable]) {
      const rail = view(p, TRANSPORT_VIEW).find((x) => x.id === 'rail-L')!;
      expect(rail.joints!.find((j) => j.type === 'hole' && j.to === 'brake-knee-L')!.count).toBe(4);
    }
    const a = view(fixed), b = view(removable);
    for (const id of ['brake-backer-L', 'brake-backplate-L', 'rail-L']) {
      const x = a.find((q) => q.id === id)!, y = b.find((q) => q.id === id)!;
      expect(y.massLb, id).toBe(x.massLb);
      expect(y.geometry, id).toEqual(x.geometry);
    }
  });
  it('nothing about the knee or strap geometry or mass changes', () => {
    const a = view(fixed), b = view(removable);
    for (const id of KNEES) {
      const x = a.find((q) => q.id === id)!, y = b.find((q) => q.id === id)!;
      expect(y.massLb, id).toBe(x.massLb);
      expect(y.transform, id).toEqual(x.transform);
    }
  });
});

describe('D-78 mass', () => {
  it('the tightening param is 35 lbf-in, snug plus a quarter turn', () => {
    expect(fixed.kneeBoltTightenLbIn).toBe(35);
    expect(PARAM_DEFS.kneeBoltTightenLbIn.status).toBe('assumed');
    expect(PARAM_DEFS.kneeBoltTightenLbIn.note).toMatch(/quarter turn/);
  });
  it('the empty sled weighs the same in both settings and both weather specs; the Transport mode drop is bigger by the knees, straps and their bolts', () => {
    for (const spec of [WEATHER_SPEC.standard, WEATHER_SPEC.extreme]) {
      const f = { ...fixed, weatherSpec: spec } as Params, r = { ...removable, weatherSpec: spec } as Params;
      expect(totalMass(view(r))).toBeCloseTo(totalMass(view(f)), 6);
      const dropF = totalMass(view(f)) - totalMass(view(f, TRANSPORT_VIEW));
      const dropR = totalMass(view(r)) - totalMass(view(r, TRANSPORT_VIEW));
      const kneesLb = view(r).filter((x) => KNEES.includes(x.id)).reduce((s, x) => s + x.massLb, 0);
      expect(kneesLb).toBeGreaterThan(3.0);
      expect(kneesLb).toBeLessThan(3.5);
      // the knees and straps, plus the eight bolt sets that leave with them (they live in the fastener allowance, which is recounted from the parts present)
      expect(dropR - dropF).toBeGreaterThan(kneesLb);
      expect(dropR - dropF).toBeLessThan(kneesLb + 1.2);
    }
  });
  it('the bolt sets leave with the knees: the fastener allowance is smaller in Transport mode', () => {
    const hw = (p: Params, v: Parameters<typeof buildModel>[1] = {}) => view(p, v).find((x) => x.id === 'hardware')!.massLb;
    expect(hw(removable)).toBe(hw(fixed));
    expect(hw(removable, TRANSPORT_VIEW)).toBeLessThan(hw(removable) - 0.5);
    expect(hw(fixed, TRANSPORT_VIEW)).toBeGreaterThan(hw(removable, TRANSPORT_VIEW));
  });
});

describe('D-78 nothing stands out beside the tires once the knees are off', () => {
  const g = (() => { const c = makeCtx(removable); return brakeGeometry(c.p, c.L); })();
  const outboard = (parts: Part[]) => parts
    .filter((x) => !x.payload && x.group !== 'reference')
    .filter((x) => { const b = worldAABB(x); return b.max[0] > g.knee.x0 && b.min[0] < g.knee.x1 && b.min[2] < g.knee.zTop && b.max[2] > g.knee.zBot && Math.max(Math.abs(b.min[1]), Math.abs(b.max[1])) > g.y.face + 0.1; })
    .map((x) => x.id);
  it('the default knee window has the knees, straps and flap kit beyond the hull face', () => {
    expect(outboard(view(fixed))).toEqual(expect.arrayContaining(['brake-knee-L', 'brake-strap-R', 'brake-flap-L']));
    expect(outboard(view(fixed, TRANSPORT_VIEW))).toEqual(expect.arrayContaining(['brake-knee-L', 'brake-knee-R']));
  });
  it('in removable mode the Transport view and the Brakes-off view leave nothing past the hull face there', () => {
    expect(outboard(view(removable, TRANSPORT_VIEW))).toEqual([]);
    expect(outboard(view(removable, { brakes: false, chocks: false }))).toEqual([]);
  });
});

describe('D-78 the tool pouch', () => {
  it('is a tool item only in removable mode, from the three params, and never a part of the sled', () => {
    expect(toolPouch(fixed)).toEqual([]);
    expect(boxGear(view(fixed), fixed).tools).toEqual([]);
    const t = boxGear(view(removable), removable).tools;
    expect(t).toHaveLength(1);
    expect(t[0].dims).toEqual([9, 3, 2]);
    expect(t[0].name).toMatch(/ratchet/);
    expect(view(removable).some((x) => /pouch|ratchet/.test(x.id))).toBe(false);
  });
});

describe('D-78 the no-fabrication rule still holds', () => {
  it('no metal fabrication violations in either setting', () => {
    for (const p of [fixed, removable]) expect(noFabViolations(view(p))).toEqual([]);
  });
});
