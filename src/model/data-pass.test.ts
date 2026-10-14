/**
 * Phase 4 data pass (Eric 2026-10-13): what the shop drawings exposed in the model. The rail step angle, one bolt per hold-down position, the cuts the instructions need to locate
 * (king-beam nut slot, handle-post relief groove, backing-strip holes, backer counterbores), the brake pad screws, the sign-backer inserts, the lid frame corners, the developed rail
 * length, and the weather-aware stainless words.
 */
import { describe, expect, it } from 'vitest';
import { buildModel } from '.';
import { computeLayout } from './layout';
import { defaultParams, WEATHER_SPEC } from '../params';
import { toLocal } from './joinery';
import { planLamination } from '../build/cutlist';
import { worldAABB } from './bounds';
import type { Part, Vec3 } from './types';

const p = defaultParams();
const parts = buildModel(p);
const L = computeLayout(p);
const get = (id: string): Part => parts.find((x) => x.id === id)!;
const toModel = (m: number[], l: Vec3): Vec3 => [m[0] * l[0] + m[4] * l[1] + m[8] * l[2] + m[12], m[1] * l[0] + m[5] * l[1] + m[9] * l[2] + m[13], m[2] * l[0] + m[6] * l[1] + m[10] * l[2] + m[14]];

describe('rail step', () => {
  it('is a sloped cut of railStepRunIn over the rise, and the note says that angle (not 45 degrees)', () => {
    const rise = p.railDepthIn - L.railDepthF;
    const deg = Math.round((Math.atan2(rise, p.railStepRunIn) * 180) / Math.PI);
    expect(deg).toBe(37);
    const rail = get('rail-L');
    expect(rail.notes).toContain(`${deg} degree slope`);
    expect(rail.notes).not.toMatch(/45 degree/);
    // the outline really has that run: the bottom edge climbs rise over railStepRunIn, ending at railStepX
    const prof = (rail.geometry as { profile: Array<[number, number]> }).profile;
    const zb = L.railTop - p.railDepthIn;
    const start = prof.find((q) => Math.abs(q[1] - zb) < 1e-6 && Math.abs(q[0] - (L.railStepX - p.railStepRunIn)) < 1e-6);
    expect(start).toBeTruthy();
  });
});

describe('hold-down bolts', () => {
  it('are one set of 2 (leg, hanger and rail), recorded once on the angle, at points that lie in the hanger and the rail', () => {
    for (const tag of ['L', 'R']) {
      const hd = get(`beam-hold-down-${tag}`), hanger = get(`axle-hanger-${tag}`), rail = get(`rail-${tag}`);
      const j = hd.joints!.find((q) => q.type === 'bolt' && q.to === hanger.id)!;
      expect(j.count).toBe(2);
      expect(j.at).toHaveLength(2);
      expect(hanger.joints!.some((q) => q.type === 'bolt'), 'the hanger records no bolt of its own').toBe(false);
      expect(rail.joints!.some((q) => q.type === 'bolt' && q.to === hanger.id)).toBe(false);
      for (const a of j.at!) {
        const w = toModel(hd.transform, a);
        const h = toLocal(hanger.transform, w);
        const sz = (hanger.geometry as { size: Vec3 }).size;
        expect(Math.abs(h[0])).toBeLessThanOrEqual(sz[0] / 2 + 1e-6);
        expect(Math.abs(h[2])).toBeLessThanOrEqual(sz[2] / 2 + 1e-6);
      }
    }
  });
});

describe('cuts the drawings and instructions locate', () => {
  it('the king beam has its nut slot: a box cut in from the front face, centered on the kingpin, under the deck by the nut stand-off', () => {
    const kb = get('king-beam');
    const j = kb.joints!.find((q) => q.cut?.kind === 'slot')!;
    expect(j).toBeTruthy();
    const c = j.cut!;
    const lo = toModel(kb.transform, c.lo!), hi = toModel(kb.transform, c.hi!);
    expect(hi[0]).toBeCloseTo(L.king.x + L.king.len / 2, 6); // open at the front face
    expect(lo[0]).toBeLessThan(L.king.x); // reaches past the bolt
    expect((lo[1] + hi[1]) / 2).toBeCloseTo(0, 6);
    expect(hi[2]).toBeLessThan(L.king.top);
    expect(lo[2]).toBeGreaterThan(L.king.bot);
  });

  it('each handle post has a part number, the relief groove, and both clevis-pin holes on the post', () => {
    for (const tag of ['L', 'R']) {
      const post = get(`handle-post-${tag}`);
      expect(post.partNo).toBe('handle-post');
      const g = post.joints!.find((q) => q.cut?.kind === 'relief')!;
      expect(g.cut!.hi![2]).toBeCloseTo(p.handlePostThickIn, 9); // on the transom-side face
      const pins = post.joints!.filter((q) => q.at && /cross/.test(q.size ?? ''));
      expect(pins.length).toBe(2);
      for (const q of pins) expect(q.at![0][2]).toBeCloseTo(p.handlePostThickIn / 2, 9); // mid-thickness: on the post, not 0.35 in below the pin part
    }
  });

  it('the grab-board backing strip has its screw holes (one per screw) at the screw lines (mid-thickness)', () => {
    const strip = get('seat-grip-backing-L');
    const j = strip.joints!.find((q) => q.type === 'hole')!;
    expect(j.count).toBe(5);
    expect(j.at).toHaveLength(5);
    for (const a of j.at!) expect(a[2]).toBeCloseTo((strip.stock?.t ?? 0.125) / 2, 6);
  });

  it('D-75: the brake backer has a hole for every knee bolt at the knee joint points, and ONE flat-bottomed recess in its inner face for the nut backing plate (no overlapping counterbores)', () => {
    const bk = get('brake-backer-L');
    const knee = get('brake-knee-L').joints!.find((q) => q.type === 'bolt')!;
    const holes = bk.joints!.find((q) => q.type === 'hole' && q.to === 'rail-L')!;
    expect(holes.at).toHaveLength(knee.count);
    expect(bk.joints!.some((q) => q.cut?.kind === 'counterbore')).toBe(false);
    const rec = bk.joints!.find((q) => q.cut?.kind === 'relief')!;
    expect(rec.to).toBe('brake-backplate-L');
    const sz = (bk.geometry as { size: Vec3 }).size;
    expect(Math.abs(rec.cut!.hi![1] - rec.cut!.lo![1])).toBeCloseTo(p.brakeBackerCboreDeepIn, 9);
    expect(Math.max(Math.abs(rec.cut!.lo![1]), Math.abs(rec.cut!.hi![1]))).toBeCloseTo(sz[1] / 2, 6); // it opens on a face of the thin axis
    // every bolt hole lies inside the recess, in the backer's local frame
    for (const a of holes.at!) {
      expect(a[0]).toBeGreaterThan(rec.cut!.lo![0]); expect(a[0]).toBeLessThan(rec.cut!.hi![0]);
      expect(a[2]).toBeGreaterThan(rec.cut!.lo![2]); expect(a[2]).toBeLessThan(rec.cut!.hi![2]);
    }
  });
});

describe('brake shoe', () => {
  it('sets the pad screws 1/2 in off the shoe-to-flap screws', () => {
    for (const tag of ['L', 'R']) {
      const shoe = get(`brake-shoe-${tag}`);
      const sf = shoe.joints!.find((q) => q.type === 'screw' && q.to === `brake-flap-${tag}`)!;
      const sp = shoe.joints!.find((q) => q.type === 'screw' && q.to === `brake-pad-${tag}`)!;
      expect(sf.at).toHaveLength(2);
      expect(sp.at).toHaveLength(2);
      for (const a of sp.at!) {
        const d = Math.min(...sf.at!.map((b) => Math.hypot(a[0] - b[0], a[2] - b[2]))); // across the shoe, ignoring the height between the faces
        expect(d).toBeGreaterThanOrEqual(0.5 - 1e-6);
      }
    }
  });
});

describe('sign backer', () => {
  it('has its insert mouths on its own outboard face (against the web), not 0.58 in outside it', () => {
    for (const tag of ['L', 'R']) for (const n of [1, 2]) {
      const bk = get(`sign-backer-${tag}${n}`);
      const j = bk.joints!.find((q) => q.type === 'threaded-insert')!;
      for (const a of j.at!) {
        const w = toModel(bk.transform, a);
        expect(Math.abs(w[1])).toBeCloseTo(L.hwC + L.sideBand, 6);
      }
    }
  });
});

describe('storage lid frame', () => {
  it('joins its corners with a loose tenon that leaves at least the Domino wall minimum of wood beyond the mortise ends', () => {
    const side = get('storage-rim-side-L');
    for (const j of side.joints!) {
      expect(j.type).toBe('mortise-tenon');
      expect(j.size).toMatch(/loose tenon \(both parts mortised\)/);
      const m = /(\d+)\/(\d+)" of wood left/.exec(j.size!)!;
      expect(Number(m[1]) / Number(m[2])).toBeGreaterThanOrEqual(p.dominoMinWallIn);
      // the mortise sits in the side's inner face, centered on the end piece's width, not at the side's end
      const a = toModel(side.transform, j.at![0]);
      const x0 = Math.min(...parts.filter((q) => /^storage-rim-/.test(q.id)).map((q) => toModel(q.transform, [-(q.geometry as { size: Vec3 }).size[0] / 2, 0, 0])[0]));
      const endDist = Math.min(Math.abs(a[0] - x0), Math.abs(a[0] - (x0 + (side.geometry as { size: Vec3 }).size[0])));
      expect(endDist).toBeCloseTo(p.storageLidRimWidthIn / 2, 6);
    }
  });
});

describe('rail stock', () => {
  it('is as long as the developed centerline, not the x extent', () => {
    const rail = get('rail-L');
    const ext = L.railEnd - (L.xRear + L.transom);
    let dev = 0;
    for (let i = 0; i < 2000; i++) { const xa = L.xRear + L.transom + (ext * i) / 2000, xb = L.xRear + L.transom + (ext * (i + 1)) / 2000; dev += Math.hypot(xb - xa, L.turnIn(xb) - L.turnIn(xa)); }
    expect(rail.stock!.l).toBeGreaterThan(ext);
    expect(rail.stock!.l).toBeCloseTo(dev, 2);
  });
});

describe('weather-aware material words (D-73)', () => {
  const strings = (list: Part[]): Array<[string, string]> => list.flatMap((x) => {
    const f: Array<[string, string | undefined]> = [['name', x.name], ['material', x.material], ['notes', x.notes], ['vendor', x.sourcing?.vendor], ...(x.joints ?? []).flatMap((j, i): Array<[string, string | undefined]> => [[`joint ${i} size`, j.size], [`joint ${i} note`, j.note]])];
    return f.filter((q): q is [string, string] => !!q[1]).map(([k, v]): [string, string] => [`${x.id} ${k}`, v]);
  });

  it('says no "316" anywhere under the Standard spec (nothing in the model genuinely must be 316 there), and says 18-8 (304) instead', () => {
    const std = strings(buildModel({ ...p, weatherSpec: WEATHER_SPEC.standard }));
    const bad = std.filter(([, v]) => /\b316\b/.test(v));
    expect(bad.map(([k, v]) => `${k}: ${v.slice(0, 80)}`)).toEqual([]);
    expect(std.some(([, v]) => /18-8 \(304\) stainless/.test(v))).toBe(true);
    // collars, inserts and D-rings are zinc, the eye bolts and chain galvanized
    expect(get('lash-L1').material).toMatch(/zinc-plated steel cargo D-ring/);
    expect(get('steer-eye-L').material).toMatch(/galvanized/);
    expect(get('steer-chain-L').material).toMatch(/galvanized/);
    expect(get('brake-snap-L').name).toMatch(/304 stainless/);
  });

  it('says 316 and never 18-8 under the Extreme spec', () => {
    const ext = buildModel({ ...p, weatherSpec: WEATHER_SPEC.extreme });
    const all = strings(ext);
    expect(all.filter(([, v]) => /18-8/.test(v)).map(([k]) => k)).toEqual([]);
    expect(all.some(([, v]) => /316 stainless hex bolts|316 hex bolts/.test(v))).toBe(true);
    const byId = (id: string) => ext.find((x) => x.id === id)!;
    expect(byId('beam-hold-down-L').material).toBe('316 stainless angle');
    expect(byId('steer-eye-L').material).toMatch(/316 stainless/);
    expect(byId('steer-chain-L').material).toMatch(/316 stainless chain/);
    expect(byId('lash-L1').material).toMatch(/316 stainless cargo D-ring/);
    expect(byId('brake-snap-L').name).toMatch(/316 stainless/);
  });
});

describe('D-74: laminated parts are 2-1/8 in (3 x 3/4 in of 4/4, less the 1/8 in cleanup)', () => {
  it('has the four params at 2-1/8 in and every laminated part planned as 3 layers of 4/4', () => {
    for (const k of ['axleBeamDepthIn', 'brakeKneeDepthIn', 'brakeChockHeightIn'] as const) expect(p[k], k).toBe(2.125);
    for (const id of ['beam-R', 'beam-F', 'brake-knee-L', 'brake-chock-L']) {
      const x = get(id);
      expect(x.stock!.t, id).toBeCloseTo(2.125, 9);
      const lam = planLamination(x.stock!.t)!;
      expect(lam.layers.map((l) => l.board), id).toEqual(['4/4', '4/4', '4/4']);
      expect(lam.layers.map((l) => l.roughT), id).toEqual([0.75, 0.75, 0.75]);
      expect(lam.text, id).toBe('3 layers: 3 \u00d7 3/4" from 4/4, glue up, then mill the block to 2-1/8"');
    }
  });

  it('carries the new size through the geometry: beam bottoms, the clamp and hold-down bolts, the knee and the chock', () => {
    const beamR = worldAABB(get('beam-R')), beamF = worldAABB(get('beam-F'));
    expect(beamR.max[2] - beamR.min[2]).toBeCloseTo(2.125, 6);
    expect(beamF.max[2] - beamF.min[2]).toBeCloseTo(2.125, 6);
    // the hanger notch still straddles the beam (its width follows the beam's fore-aft width, which stays 2-1/4 in) and bears on its top
    expect(get('axle-hanger-L').notes).toMatch(/notched 2\.38" × 1\.35"/);
    // the hold-down's flat-leg bolt is a stock length shorter through the thinner beam
    expect(get('beam-hold-down-L').joints!.find((q) => q.to === 'beam-R')!.size).toMatch(/^0\.25" × 2-3\/4 /);
    const knee = worldAABB(get('brake-knee-L'));
    expect(knee.max[0] - knee.min[0]).toBeCloseTo(2.125, 6); // fore-aft depth
    const chock = worldAABB(get('brake-chock-L'));
    expect(chock.max[2] - chock.min[2]).toBeCloseTo(2.125, 6);
  });
});
