/**
 * D-78: removable brake knees (bolts, ratchet and wrench). Both settings and both weather specs give the same pass/fail and the same numbers in every row, except the brake-mount and
 * brake-abuse rows (the DRY knee adds a wood-to-wood bolt detail that the glued knee never needed; every old detail is unchanged), the cargo stow row (the tool pouch rides in the box in cargo
 * mode only) and the rows that use the carried (Transport) mass, which is lower without the knees. The race packing row is unchanged.
 */
import { describe, expect, it } from 'vitest';
import { KNEE_MOUNT, WEATHER_SPEC, defaultParams, type Params } from '../params';
import { buildModel } from '../model';
import { makeCtx } from '../model/build-utils';
import { VOID_USABLE, boxGear, packEssentials, storageInterior, ESSENTIALS } from '../model/storage';
import { runChecks, type AnalysisCheck } from './index';

const make = (spec: number, knee: number): Params => ({ ...defaultParams(), weatherSpec: spec, kneeMount: knee }) as Params;
const rows = (p: Params) => runChecks(p, { includeTruck: false });
const byId = (c: AnalysisCheck[], id: string) => c.find((x) => x.id === id)!;
/** Rows allowed to differ (see the header). */
const MAY_DIFFER = new Set(['brake-mount', 'brake-abuse', 'seat-stow', 'lift', 'mass-empty']);

describe.each([['Standard', WEATHER_SPEC.standard], ['Extreme', WEATHER_SPEC.extreme]])('D-78 %s spec', (_n, spec) => {
  const a = rows(make(spec, KNEE_MOUNT.fixed)), b = rows(make(spec, KNEE_MOUNT.removable));
  it('has the same rows, with the same status, value, limit and details, apart from the packing, lift and mass rows', () => {
    expect(b.map((x) => x.id)).toEqual(a.map((x) => x.id));
    for (const x of a) {
      const y = byId(b, x.id);
      if (MAY_DIFFER.has(x.id)) continue;
      const strip = (c: AnalysisCheck) => JSON.stringify({ ...c, how: undefined });
      expect(strip(y), x.id).toBe(strip(x));
    }
  });
  it('brake-mount: every old detail is unchanged; the dry knee adds a wood-to-wood bolt detail, judged, that governs the row', () => {
    const x = byId(a, 'brake-mount'), y = byId(b, 'brake-mount');
    const added = y.details!.filter((d) => /^dry knee: bolt lateral capacity, wood to wood/.test(d.name));
    expect(added).toHaveLength(1);
    expect(x.details!.some((d) => /dry knee/.test(d.name))).toBe(false);
    const rest = y.details!.filter((d) => !/^dry knee/.test(d.name));
    expect(JSON.stringify(rest)).toBe(JSON.stringify(x.details));
    // hand check: Z' about 306 lbf (mode II) against the worst bolt about 255 lbf
    expect(added[0].limit).toBeGreaterThan(300);
    expect(added[0].limit).toBeLessThan(312);
    expect(added[0].value).toBeGreaterThan(240);
    expect(added[0].value).toBeLessThan(270);
    expect(added[0].value / added[0].limit).toBeGreaterThan(0.78);
    expect(added[0].value / added[0].limit).toBeLessThan(0.9);
    expect(y.status).toBe(x.status === 'fail' ? 'fail' : y.status);
    expect(y.status).not.toBe('fail');
    expect(y.how).toContain('Removable knees (D-78)');
    expect(y.how).toMatch(/fitted DRY/);
    expect(y.how).not.toMatch(/design clamp/);
    expect(x.how).not.toContain('Removable knees (D-78)');
    expect(byId(b, 'brake-abuse').status).not.toBe('fail');
  });
  it('the empty mass is the same; the carried (Transport) mass is lower by the knees, straps and their bolts', () => {
    expect(byId(b, 'mass-empty').value).toBeCloseTo(byId(a, 'mass-empty').value, 6);
    const tr = (c: AnalysisCheck[]) => Number(/Transport configuration \(removables off, D-9\): ([\d.]+) lb/.exec(byId(c, 'mass-empty').how)![1]);
    expect(tr(a) - tr(b)).toBeGreaterThan(3.0);
    expect(tr(a) - tr(b)).toBeLessThan(3.6);
    expect(byId(b, 'lift').status).toBe(byId(a, 'lift').status);
    expect(byId(b, 'lift').how).toContain('removable knees');
  });
});

describe('D-78 the box packing includes the ratchet pouch', () => {
  const p = make(WEATHER_SPEC.standard, KNEE_MOUNT.removable), q = make(WEATHER_SPEC.standard, KNEE_MOUNT.fixed);
  it('race mode: the box row is unchanged (the pouch rides in cargo mode only, the knees come off at the truck or in the garage)', () => {
    const x = byId(rows(q), 'storage-pack'), y = byId(rows(p), 'storage-pack');
    expect(JSON.stringify(y)).toBe(JSON.stringify(x));
    expect(y.how).not.toMatch(/pouch/i);
    expect(y.status).toBe('pass');
    expect(VOID_USABLE).toBeGreaterThan(0);
    // the packer still places the pouch with the Essentials and the chocks (it fits even if it were carried at the race)
    const c = makeCtx(p);
    const interior = storageInterior(c.p, c.L);
    const gear = boxGear(buildModel(p, { rider: 'goal', cargo: true }), p);
    const r = packEssentials(interior, [...ESSENTIALS, ...gear.chocks, ...gear.tools]);
    expect(r.fits).toBe(true);
    expect(r.unplaced).toEqual([]);
    expect(r.rigidIn3 - packEssentials(interior, [...ESSENTIALS, ...gear.chocks]).rigidIn3).toBeCloseTo(9 * 3 * 2, 6);
  });
  it('cargo mode: the pouch lies in the layer above the cushions with the lamps and the chocks, and the stow still passes', () => {
    const x = byId(rows(q), 'seat-stow'), y = byId(rows(p), 'seat-stow');
    expect(y.status).toBe(x.status);
    expect(y.value).toBe(x.value);
    expect(y.how).toMatch(/Tool pouch \(ratchet, socket, wrench\) 9\.0×3\.0×2\.0"/);
    expect(x.how).not.toMatch(/Tool pouch/);
    const floor = (c: AnalysisCheck) => c.details!.find((d) => /floor area/.test(d.name))!;
    expect(floor(y).value).toBeGreaterThan(floor(x).value);
    expect(floor(y).value).toBeLessThanOrEqual(1);
    expect(y.how).not.toMatch(/NOT placed/);
  });
  it('the pouch is a tool, not sled mass: the loads and the mass rows do not carry it', () => {
    expect(byId(rows(p), 'mass-empty').value).toBeCloseTo(byId(rows(q), 'mass-empty').value, 6);
  });
});
