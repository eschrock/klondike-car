/**
 * The hollow axle (D-60): 3/4 in OD x 0.120 in wall DOM tube for the rear through axle and the front stub axles (`axleWallIn`; 0 = the old solid 1045 rod).
 * Re-derived by hand: the section, the strengths, the mass, the cotter-pin cross hole (net-section bending, pin bearing, tear-out), the ring bending of the thin wall under the clamp
 * plates, and the three rows that carry them (axle-stress, front-stub, rest-load).
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, resolveParams, validateParams, type Params } from '../params';
import { buildModel } from '../model';
import { worldAABB } from '../model/bounds';
import { makeContext, type Ctx } from './context';
import { axleHoleDetails, axleIsTube, axleSection, axleUltimate, axleWall, axleYield, type AxleLoads } from './axle';
import { circleSection, tubeSection } from './beams';
import { runChecks } from './index';

const defaults = defaultParams();
const solid = { ...defaults, axleWallIn: 0 } as Params;
const mkCtx = (q: Partial<Params> = {}): Ctx => {
  const p = resolveParams({ ...defaults, ...q } as Params);
  return makeContext(p, buildModel(p, { rider: 'goal', cargo: true }), buildModel(p, { rider: 'none', cargo: false, seat: 'stowed' }));
};

describe('the stock and its section', () => {
  it('the default axle is a 3/4 in OD x 0.120 in wall DOM tube, yield 70 ksi / ultimate 80 ksi (verify), cross hole 5/32 in at 3/8 in from the end', () => {
    expect(defaults.axleDiameterIn).toBe(0.75);
    expect(defaults.axleWallIn).toBe(0.12);
    expect(defaults.axleTubeYieldPsi).toBe(70000);
    expect(defaults.axleTubeUltimatePsi).toBe(80000);
    expect(defaults.axleCrossHoleDiaIn).toBe(5 / 32);
    expect(defaults.axleCrossHoleFromEndIn).toBe(0.375);
    expect(axleIsTube(defaults)).toBe(true);
    expect(axleIsTube(solid)).toBe(false);
    expect(axleWall(solid)).toBe(0);
    expect(axleWall({ ...defaults, axleWallIn: 5 } as Params)).toBeCloseTo(0.375, 12); // never more than the radius
  });
  it('tube section by hand: I = pi (d^4 - di^4) / 64 with di = 0.75 - 0.24 = 0.51 in: 0.012211 in4 against the rod 0.015531 (79%); S = I / 0.375 = 0.03257 in3; A = 0.2375 in2 (the rod 0.4418)', () => {
    const di = 0.51;
    const I = (Math.PI * (0.75 ** 4 - di ** 4)) / 64;
    const t = tubeSection(0.75, 0.12);
    expect(t.I).toBeCloseTo(I, 12);
    expect(t.I).toBeCloseTo(0.012211, 6);
    expect(t.S).toBeCloseTo(I / 0.375, 12);
    expect(t.A).toBeCloseTo((Math.PI * (0.75 ** 2 - di ** 2)) / 4, 12);
    expect(t.A).toBeCloseTo(0.2375, 4);
    expect(t.c).toBe(0.375);
    expect(circleSection(0.75).I).toBeCloseTo(0.0155316, 6);
    expect(t.I / circleSection(0.75).I).toBeCloseTo(0.786, 2);
    expect(axleSection(defaults).I).toBeCloseTo(t.I, 12);
    expect(axleSection(solid).I).toBeCloseTo(circleSection(0.75).I, 12);
    expect(tubeSection(0.75, 0.375).I).toBeCloseTo(circleSection(0.75).I, 12); // a wall of the radius is the rod
  });
  it('the tube uses its own strengths; the solid rod keeps the 1045 numbers (70 / 85 ksi)', () => {
    expect(axleYield(defaults)).toBe(defaults.axleTubeYieldPsi);
    expect(axleUltimate(defaults)).toBe(defaults.axleTubeUltimatePsi);
    expect(axleYield(solid)).toBe(defaults.axleYieldPsi);
    expect(axleUltimate(solid)).toBe(defaults.axleUltimatePsi);
    expect(mkCtx().d.axleAllowablePsi).toBeCloseTo(70000 / defaults.steelSafetyFactor, 6);
    expect(mkCtx({ axleTubeYieldPsi: 60000 }).d.axleAllowablePsi).toBeCloseTo(30000, 6); // 1020 DOM at 60 ksi: the allowable follows
  });
});

describe('mass and parts', () => {
  const tube = buildModel(defaults);
  const rod = buildModel(solid);
  const mass = (ps: ReturnType<typeof buildModel>, re: RegExp) => ps.filter((x) => re.test(x.id)).reduce((m, x) => m + x.massLb, 0);
  it('the rear axle (37 in + ends) and the two front stubs weigh 1 - (0.51/0.75)^2 = 53.8% of the rod (46% less): about 3.5 lb saved over the four pieces (the study: 3.55)', () => {
    const k = 1 - (0.51 / 0.75) ** 2; // the tube's share of the rod's mass
    const rearRod = mass(rod, /^axle-R$/), rearTube = mass(tube, /^axle-R$/);
    expect(rearRod).toBeGreaterThan(4.5); // the 3c-5 solid rod: 4.64 lb
    expect(rearTube).toBeCloseTo(rearRod * k, 9);
    const frontRod = mass(rod, /^axle-F[LR]$/), frontTube = mass(tube, /^axle-F[LR]$/);
    expect(frontTube).toBeCloseTo(frontRod * k, 9);
    const saved = rearRod + frontRod - rearTube - frontTube;
    expect(saved).toBeGreaterThan(3.2);
    expect(saved).toBeLessThan(3.7);
  });
  it('the geometry says it is a tube (wall 0.12 in) so the viewer draws it hollow; the outside is the same 3/4 in as the rod, so the bounds, the groove and the wheel bore do not change', () => {
    for (const id of ['axle-R', 'axle-FL', 'axle-FR']) {
      const t = tube.find((x) => x.id === id)!, r = rod.find((x) => x.id === id)!;
      expect(t.geometry).toMatchObject({ type: 'cylinder', radius: 0.375, wall: 0.12 });
      expect((r.geometry as { wall?: number }).wall).toBeUndefined();
      expect(worldAABB(t)).toEqual(worldAABB(r));
    }
  });
  it('the shop notes and the sourcing name the stock: DOM tube, wall, the cross hole and the fit check; the solid rod still says 1045', () => {
    const t = tube.find((x) => x.id === 'axle-R')!;
    expect(t.sourcing?.vendor).toMatch(/DOM \(drawn-over-mandrel\) mild-steel round tube, ASTM A513 Type 5/);
    expect(t.sourcing?.vendor).toMatch(/NOT ordinary ERW/); // eng 3c: ERW is about 45 ksi and takes axle-stress from 0.59 to 0.94
    expect(t.sourcing?.vendor).toMatch(/quarter turn/);
    expect(t.sourcing?.vendor).toMatch(/0\.120" wall/);
    expect(t.sourcing?.vendor).toMatch(/cross hole/);
    expect(t.sourcing?.vendor).toMatch(/70 ksi/);
    expect(t.notes).toMatch(/hollow 3\/4" OD x 0\.120" wall DOM tube/);
    expect(t.notes).toMatch(/rusts inside/);
    expect(tube.find((x) => x.id === 'axle-FL')!.sourcing?.vendor).toMatch(/DOM \(drawn-over-mandrel\) mild-steel round tube/);
    expect(rod.find((x) => x.id === 'axle-R')!.sourcing?.vendor).toMatch(/1045/);
    // the stub-axle rear style gets the same stock
    expect(buildModel({ ...defaults, axleStyle: 1 } as Params).find((x) => x.id === 'axle-RL')!.geometry).toMatchObject({ wall: 0.12 });
  });
});

describe('axle-stress and front-stub rows', () => {
  const ctx = mkCtx();
  const cs = runChecks(defaults, { includeTruck: false });
  const cr = runChecks(solid, { includeTruck: false });
  const row = (rs: ReturnType<typeof runChecks>, id: string) => rs.find((c) => c.id === id)!;
  it('both pass with room at the defaults (axle-stress 0.59, front-stub 0.33 / 0.48 cargo) and the tube is stiffer-limited than the rod by the section ratio', () => {
    for (const id of ['axle-stress', 'front-stub']) {
      expect(row(cs, id).status, id).toBe('pass');
      expect(row(cs, id).util!, id).toBeLessThan(0.7);
      expect(row(cs, id).utilCargo!, id).toBeLessThan(0.7);
    }
    expect(row(cs, 'axle-stress').util!).toBeCloseTo(0.594, 2);
    expect(row(cs, 'front-stub').util!).toBeCloseTo(0.333, 2);
    // bending stress on the same load goes with 1/S: the bending detail of the tube is S_rod / S_tube = 1.27 times the rod's
    const bend = (rs: ReturnType<typeof runChecks>) => row(rs, 'axle-stress').details!.find((d) => /NORMAL 1" rear bump/.test(d.name))!;
    const ratio = circleSection(0.75).S / tubeSection(0.75, 0.12).S;
    expect(bend(cs).value / bend(cr).value).toBeGreaterThan(ratio * 0.9); // the lighter wheels also lower the load a little
    expect(bend(cs).limit).toBeCloseTo(35000, 6);
    expect(bend(cr).limit).toBeCloseTo(35000, 6);
  });
  it('the rows list the cross-hole and ring details and the stock in the how text', () => {
    for (const id of ['axle-stress', 'front-stub']) {
      const d = row(cs, id).details!;
      expect(d.some((q) => /cross hole.*net-section bending/.test(q.name)), id).toBe(true);
      expect(d.some((q) => /pin bearing|bearing on the hole wall/.test(q.name)), id).toBe(true);
      expect(d.some((q) => /tear-out/.test(q.name)), id).toBe(true);
      expect(d.some((q) => /tube wall ring bending/.test(q.name)), id).toBe(true);
      expect(row(cs, id).how, id).toMatch(/DOM tube/);
    }
    expect(row(cs, 'front-stub').details!.find((q) => /NORMAL tube wall ring/.test(q.name))!.name).toMatch(/2 line contacts/);
    expect(row(cs, 'axle-stress').details!.find((q) => /NORMAL tube wall ring/.test(q.name))!.name).toMatch(/1 line contact /);
    // the solid rod has the cross hole rows but no ring row
    expect(row(cr, 'axle-stress').details!.some((q) => /tube wall ring/.test(q.name))).toBe(false);
    expect(row(cr, 'axle-stress').details!.some((q) => /cross hole/.test(q.name))).toBe(true);
  });
  it('the cross hole by hand: net section I - (2/3) dh (r^3 - ri^3) = 0.012211 - 0.003766 = 0.008445 in4; the moment is the wheel force at the hub edge x (1 - 3/8) in', () => {
    const ld: AxleLoads = { Rn: 600, Rh: 900, Tn: 100, Th: 300, stations: 1 };
    const d = axleHoleDetails(ctx, ld, 35000, 64000);
    const dh = 5 / 32, r = 0.375, ri = 0.255;
    const lossI = (2 / 3) * dh * (r ** 3 - ri ** 3);
    expect(lossI).toBeCloseTo(0.003766, 6);
    const iNet = tubeSection(0.75, 0.12).I - lossI;
    expect(iNet).toBeCloseTo(0.008445, 6);
    const byName = (re: RegExp) => d.find((q) => re.test(q.name))!;
    expect(byName(/NORMAL cross hole/).value).toBeCloseTo((600 * 0.625 * 0.375) / iNet, 4);
    expect(byName(/HARD cross hole/).value).toBeCloseTo((900 * 0.625 * 0.375) / iNet, 4);
    expect(byName(/NORMAL cross hole/).limit).toBe(35000);
    expect(byName(/HARD cross hole/).limit).toBe(64000);
    // pin bearing on the two walls: T / (dh x 2 wall); tear-out: T / (2 e 2 wall), e = 3/8 - dh/2 = 0.2969 in against 0.58 x the allowable
    expect(byName(/NORMAL side thrust.*bearing/).value).toBeCloseTo(100 / (dh * 0.24), 4);
    const e = 0.375 - dh / 2;
    expect(byName(/NORMAL side thrust: tear-out/).value).toBeCloseTo(100 / (2 * e * 0.24), 4);
    expect(byName(/NORMAL side thrust: tear-out/).limit).toBeCloseTo(0.58 * 35000, 6);
    expect(byName(/HARD side thrust.*bearing/).value).toBeCloseTo(300 / (dh * 0.24), 4);
    // ring bending of the wall under a clamp line contact: 6 x 0.318 P' rm / t^2 with P' = R / (stations x 1.5 in), rm = (0.75 - 0.12) / 2 = 0.315
    const ring = (R: number, st: number) => (6 * 0.318 * (R / (st * 1.5)) * 0.315) / 0.12 ** 2;
    expect(byName(/NORMAL tube wall ring/).value).toBeCloseTo(ring(600, 1), 4);
    expect(byName(/HARD tube wall ring/).value).toBeCloseTo(ring(900, 1), 4);
    expect(axleHoleDetails(ctx, { ...ld, stations: 2 }, 35000, 64000).find((q) => /NORMAL tube wall ring/.test(q.name))!.value).toBeCloseTo(ring(600, 2), 4);
  });
  it('the cross hole has teeth: a fat hole too near the end fails the tear-out, a 0.18 in wall fails nothing, a 0.03 in wall fails the ring and the bending', () => {
    const big: AxleLoads = { Rn: 600, Rh: 900, Tn: 6000, Th: 9000, stations: 1 };
    const near = mkCtx({ axleCrossHoleDiaIn: 0.25, axleCrossHoleFromEndIn: 0.25 });
    expect(axleHoleDetails(near, big, 35000, 64000).some((q) => q.util > 1)).toBe(true);
    const thin = mkCtx({ axleWallIn: 0.03 });
    const t = axleHoleDetails(thin, { Rn: 600, Rh: 900, Tn: 100, Th: 300, stations: 1 }, 35000, 64000);
    expect(t.find((q) => /NORMAL tube wall ring/.test(q.name))!.util).toBeGreaterThan(1);
    expect(t.find((q) => /NORMAL cross hole/.test(q.name))!.util).toBeGreaterThan(0.9);
    const thick = mkCtx({ axleWallIn: 0.18 });
    expect(axleHoleDetails(thick, { Rn: 600, Rh: 900, Tn: 100, Th: 300, stations: 1 }, 35000, 64000).every((q) => q.util < 0.5)).toBe(true);
  });
  it('a thin wall makes the real rows fail where the 0.12 in wall passes: 0.03 in on the rear axle (ring bending under the plates), a weaker steel (35 ksi) halves the allowable', () => {
    const thin = runChecks({ ...defaults, axleWallIn: 0.03 } as Params, { includeTruck: false });
    expect(row(thin, 'axle-stress').status).toBe('fail');
    const weak = runChecks({ ...defaults, axleTubeYieldPsi: 35000 } as Params, { includeTruck: false });
    expect(row(weak, 'axle-stress').util!).toBeGreaterThan(row(cs, 'axle-stress').util! * 1.15);
  });
  it('the resting-load row bends the same tube: the front and rear stub rows at the static wheel load, the allowable of the tube stock', () => {
    const r = row(cs, 'rest-load').details!;
    const f = r.find((d) => d.name === 'front stub axle bending')!, b = r.find((d) => d.name === 'rear stub axle bending')!;
    expect(f.limit).toBeCloseTo(35000, 6);
    expect(b.limit).toBeCloseTo(35000, 6);
    expect(f.util).toBeLessThan(0.3);
    expect(b.util).toBeLessThan(0.3);
    const rs = row(cr, 'rest-load').details!.find((d) => d.name === 'rear stub axle bending')!;
    expect(b.value / rs.value).toBeGreaterThan(1.2); // the tube bends 27% more on the same load (a little less: the sled is lighter)
    expect(b.value / rs.value).toBeLessThan(1.3);
  });
});

describe('validateParams for the tube, the wheel bore and the cotter-pin hole', () => {
  const issues = (q: Partial<Params>) => validateParams({ ...defaults, ...q } as Params);
  it('defaults are clean; a wall that leaves no bore is an error; wall 0 (the solid rod) is fine', () => {
    expect(issues({}).filter((i) => i.severity !== 'info')).toEqual([]);
    expect(issues({ axleWallIn: 0.34 }).some((i) => i.severity === 'error' && i.keys.includes('axleWallIn'))).toBe(true);
    expect(issues({ axleWallIn: 0 }).filter((i) => i.severity !== 'info')).toEqual([]);
  });
  it('a wheel whose bore is not the axle diameter warns (the listing of the light wheel does not give it: verify)', () => {
    const w = issues({ wheelBoreIn: 0.625 }).filter((i) => i.severity === 'warn' && i.keys.includes('wheelBoreIn'));
    expect(w).toHaveLength(1);
    expect(w[0].message).toMatch(/bearings ride on the axle OD/);
    expect(issues({ axleDiameterIn: 0.625, wheelBoreIn: 0.625 }).filter((i) => i.keys.includes('wheelBoreIn'))).toEqual([]);
  });
  it('a cross hole too near the end, or a collar space under 1/2 in, warns', () => {
    expect(issues({ axleCrossHoleFromEndIn: 0.25 }).some((i) => i.severity === 'warn' && i.keys.includes('axleCrossHoleFromEndIn'))).toBe(true);
    expect(issues({ axleEndExtraIn: 0.75 }).some((i) => i.severity === 'warn' && i.keys.includes('axleCrossHoleFromEndIn'))).toBe(true);
  });
});
