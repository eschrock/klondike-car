/**
 * Phase 3 workstream A (D-31…D-34): steering stops, bolster fasteners, bridle tie points, front U-bolts, access panel, specs.
 * Hand arithmetic in the titles is worked at the defaults (37° lock, 12" turntable, 1½" bolster rails, 3" crossbar, 1½" × 1¾" dog).
 */
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, resolveParams, steerStopPlan, validateParams, type ParamKey, type Params } from '../params';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { obbOverlap, partOBB, worldAABB } from './bounds';
import { clipHalfPlane, polyArea, toothThickness, triangularFace, type Pt } from './stops';
import { ringBoltLayout, frac } from './steering';
import { circlePath, filletPath, mergeMeshes, pathLength, tubeAlong } from './mesh-utils';

const defaults = defaultParams();
const errorsOf = (p: Params) => validateParams(p).filter((i) => i.severity === 'error');
const RAD = Math.PI / 180;

describe('stops.ts: the stop dogs and blocks fit the bolster opening and land flat at lock', () => {
  const p = resolveParams(defaults);
  const plan = steerStopPlan(p);
  const L = plan.lock;
  it('opening and dog numbers: a = 6 − 1.5 = 4.5", b = 6.0625 − 0.0 → 6.0625", W = 1.5/2 + 0.125 = 0.875"', () => {
    expect(plan.ok).toBe(true);
    expect(plan.a).toBeCloseTo(4.5, 9);
    expect(plan.b).toBeCloseTo(6.0625, 9);
    expect(plan.cb).toBeCloseTo(1.5, 9);
    expect(plan.W).toBeCloseTo(0.875, 9);
    expect(plan.lock).toBeCloseTo(37 * RAD, 9);
  });
  it('the dog is trimmed where the wood behind its face is thinner than 1/2": ra = (cb + sinL (W + t_min))/cosL = 2.914", rb = (a − (W + t_min)·cosL)/sinL = 5.653"', () => {
    const ra = (1.5 + Math.sin(L) * (0.875 + 0.5)) / Math.cos(L);
    const rb = (4.5 - (0.875 + 0.5) * Math.cos(L)) / Math.sin(L);
    expect(plan.ra).toBeCloseTo(ra, 9);
    expect(plan.rb).toBeCloseTo(rb, 9);
    expect(plan.ra).toBeCloseTo(2.914, 3);
    expect(plan.rb).toBeCloseTo(5.653, 3);
    // the thickness function agrees at both ends
    expect(toothThickness(plan.a, plan.cb, plan.W, L, plan.ra)).toBeCloseTo(0.5, 9);
    expect(toothThickness(plan.a, plan.cb, plan.W, L, plan.rb)).toBeCloseTo(0.5, 9);
  });
  it('closed-form triangular face: s 2…4, h 1, M 1000: r_eff = ⅔(64 − 8)/(16 − 4) = 3.111", F = 321.4 lbf, p_max = 3·1000·4/(1·56) = 214.3 psi', () => {
    const t = triangularFace(2, 4, 1, 1000);
    expect(t.rEff).toBeCloseTo(3.1111, 4);
    expect(t.F).toBeCloseTo(321.43, 2);
    expect(t.pMax).toBeCloseTo(214.29, 2);
    expect(t.pAvg).toBeCloseTo(321.43 / 2, 2);
    // a point-contact limit: a very short face has r_eff → s
    expect(triangularFace(3, 3.001, 1, 1).rEff).toBeCloseTo(3, 2);
  });
  it('four teeth, each a convex polygon inside the opening, outside the crossbar, with the dog face plane as its front', () => {
    expect(plan.teeth.map((t) => t.id).sort()).toEqual(['AL', 'AR', 'FL', 'FR']);
    for (const t of plan.teeth) {
      expect(polyArea(t.poly), t.id).toBeGreaterThan(2);
      for (const q of t.poly) {
        expect(Math.abs(q.x), `${t.id} x`).toBeLessThanOrEqual(plan.a + 1e-9);
        expect(Math.abs(q.y), `${t.id} y`).toBeLessThanOrEqual(plan.b + 1e-9);
        expect(Math.abs(q.y), `${t.id} clears the crossbar`).toBeGreaterThanOrEqual(plan.cb - 1e-9);
        // behind the face: n·q ≥ d
        expect(t.n.x * q.x + t.n.y * q.y, `${t.id} behind the face`).toBeGreaterThanOrEqual(t.d - 1e-9);
      }
      for (const q of t.local) expect(q.y, `${t.id} local v`).toBeGreaterThanOrEqual(-1e-9); // the part's OBB lies behind the face
      expect(t.uMax - t.uMin).toBeGreaterThanOrEqual(plan.rb - plan.ra); // the block is at least as long as the dog face
      // convexity: all cross products of consecutive edges have the same sign (counter-clockwise)
      for (let i = 0; i < t.poly.length; i++) {
        const a = t.poly[i], b = t.poly[(i + 1) % t.poly.length], c = t.poly[(i + 2) % t.poly.length];
        expect((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), `${t.id} corner ${i}`).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });
  it('the right-hand blocks are the left-hand ones turned 180° about the kingpin: AL ↔ FR, FL ↔ AR (a couple at either lock)', () => {
    const find = (id: string) => plan.teeth.find((t) => t.id === id)!;
    const area = (id: string) => polyArea(find(id).poly);
    expect(area('AL')).toBeCloseTo(area('FR'), 9);
    expect(area('FL')).toBeCloseTo(area('AR'), 9);
    expect(area('AL')).toBeCloseTo(area('FL'), 9); // and mirror images of each other across x = 0
    expect(find('FR').n.x).toBeCloseTo(-find('AL').n.x, 12);
    expect(find('FR').n.y).toBeCloseTo(-find('AL').n.y, 12);
    expect(find('FR').d).toBeCloseTo(find('AL').d, 12);
    expect(find('FL').n.x).toBeCloseTo(-find('AL').n.x, 12);
  });
  it('clipHalfPlane / polyArea sanity: a 2 × 2 square cut on the diagonal keeps half its area', () => {
    const sq: Pt[] = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    expect(polyArea(sq)).toBeCloseTo(4, 12);
    expect(polyArea(clipHalfPlane(sq, 1, 1, 2))).toBeCloseTo(2, 12);
    expect(clipHalfPlane(sq, 1, 0, 5)).toEqual([]);
  });

  // Brute force: for random valid configurations the swept dog never leaves the opening, never touches the crossbar or a block
  // before lock, and meets its block exactly at lock.
  function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  it('seeded sweep of turntable size, rail width, crossbar width, lock, dog thickness and face plate: every planned design stays inside the opening and touches only at lock', () => {
    const rnd = mulberry32(31);
    const keys: ParamKey[] = ['turntableSizeIn', 'bolsterRailWidthIn', 'kingpinCrossbarWidthIn', 'steerLockDeg', 'steerStopSizeIn', 'steerStopFacePlateIn', 'stopBlockMinIn', 'sideBearerWidthIn'];
    let planned = 0, rejected = 0;
    for (let n = 0; n < 400; n++) {
      const q = { ...defaults, turntableType: 0 } as Params;
      for (const k of keys) {
        const d = PARAM_DEFS[k];
        const v = d.min + rnd() * (d.max - d.min);
        q[k] = Math.min(d.max, Math.max(d.min, Math.round(v / d.step) * d.step));
      }
      const pl = steerStopPlan(resolveParams(q));
      if (!pl.ok) { rejected++; continue; }
      planned++;
      const lk = pl.lock;
      // The dog (left, +y axis): rectangle [−W, W] × [ra, rb]. Sample the sweep.
      const rectAt = (d: number): Pt[] => [[-pl.W, pl.ra], [pl.W, pl.ra], [pl.W, pl.rb], [-pl.W, pl.rb]].map(([x, y]) => ({ x: Math.cos(d) * x - Math.sin(d) * y, y: Math.sin(d) * x + Math.cos(d) * y }));
      for (let i = 0; i <= 120; i++) {
        const d = -lk + (2 * lk * i) / 120;
        for (const c of rectAt(d)) {
          expect(Math.abs(c.x), `x @${d}`).toBeLessThanOrEqual(pl.a - 1 / 32 + 1e-9);
          expect(c.y, `y @${d}`).toBeLessThanOrEqual(pl.b - 1 / 32 + 1e-9);
          expect(c.y, `crossbar @${d}`).toBeGreaterThanOrEqual(pl.cb + 1 / 32 - 1e-9);
        }
      }
      // Face plane at lock: the dog's aft-facing face rotated by +lock lies on the tooth AL face plane n·p = d.
      const al = pl.teeth.find((t) => t.id === 'AL')!;
      for (const y of [pl.ra, (pl.ra + pl.rb) / 2, pl.rb]) {
        const x = -pl.W * Math.cos(lk) - y * Math.sin(lk), yy = -pl.W * Math.sin(lk) + y * Math.cos(lk);
        expect(al.n.x * x + al.n.y * yy, 'face on the plane').toBeCloseTo(al.d, 9);
      }
      // Before lock the face is behind the plane (n·p < d) everywhere along it.
      for (const dd of [0, 0.5 * lk, 0.95 * lk]) {
        for (const y of [pl.ra, pl.rb]) {
          const x = Math.cos(dd) * -pl.W - Math.sin(dd) * y, yy = Math.sin(dd) * -pl.W + Math.cos(dd) * y;
          expect(al.n.x * x + al.n.y * yy, `before lock ${dd}`).toBeLessThan(al.d);
        }
      }
    }
    expect(planned).toBeGreaterThan(60);
    expect(rejected).toBeGreaterThan(20); // the validator has teeth too
  });
});

describe('the steering parts at the defaults', () => {
  const m = buildModel(defaults);
  const byId = (id: string) => m.find((x) => x.id === id)!;
  const L = computeLayout(defaults);
  const plan = steerStopPlan(resolveParams(defaults));
  it('two steel-faced oak dogs (steer body) with a plate on each side, four oak stop blocks (chassis)', () => {
    for (const tag of ['L', 'R']) {
      const dog = byId(`steer-stop-${tag}`);
      expect(dog.body).toBe('steer');
      expect(dog.material).toMatch(/oak/);
      expect(dog.grain).toBe('y');
      expect(dog.geometry.type === 'box' && dog.geometry.size[0]).toBeCloseTo(defaults.steerStopSizeIn, 9);
      expect(dog.geometry.type === 'box' && dog.geometry.size[1]).toBeCloseTo(plan.rb - plan.ra, 9);
      expect(dog.geometry.type === 'box' && dog.geometry.size[2]).toBeCloseTo(Math.min(defaults.steerStopHeightIn, L.bolster.z1 - L.bolster.z0 - defaults.sideBearerClearanceIn), 9);
      for (const n of [1, 2]) {
        const face = byId(`steer-stop-face-${tag}${n}`);
        expect(face.material).toMatch(/steel/);
        expect(face.body).toBe('steer');
        expect(face.massLb).toBeGreaterThan(0.1);
        expect(face.partNo).toBe('steer-stop-face');
      }
    }
    for (const id of ['AL', 'AR', 'FL', 'FR']) {
      const b = byId(`stop-block-${id}`);
      expect(b.body).toBe('chassis');
      expect(b.geometry.type).toBe('extrusion');
      expect(b.material).toMatch(/oak/);
      expect(b.grain).toBe('y'); // along the stop force: an end-grain face
      expect(b.stock).toBeDefined();
      expect(b.massLb).toBeGreaterThan(0.1);
      expect(b.massLb).toBeLessThan(0.3);
      expect(b.joints!.some((j) => j.type === 'glue' && /^bolster-(aft|fore)$/.test(j.to))).toBe(true);
      expect(b.joints!.some((j) => j.to === 'kingpin-crossbar')).toBe(true);
    }
    // the old square posts are gone
    expect(m.some((x) => x.id === 'steer-stop-L' && x.massLb < 0.1)).toBe(false);
  });
  it('the stop blocks are as tall as the bolster ring and flush with its top; the dog stands on the turntable plate and stays 1/16" under the deck', () => {
    const ringTop = L.bolster.z1;
    for (const id of ['AL', 'FL', 'AR', 'FR']) {
      const bb = worldAABB(byId(`stop-block-${id}`));
      expect(bb.min[2]).toBeCloseTo(L.bolster.z0, 9);
      expect(bb.max[2]).toBeCloseTo(ringTop, 9);
    }
    const dog = worldAABB(byId('steer-stop-L'));
    expect(dog.min[2]).toBeCloseTo(L.turntable.z1, 9);
    expect(dog.max[2]).toBeLessThanOrEqual(ringTop - defaults.sideBearerClearanceIn + 1e-9);
  });
  it('the dog bolts down through the plate into the beam: count and diameter are structured joints, with washers under the beam', () => {
    for (const tag of ['L', 'R']) {
      const j = byId(`steer-stop-${tag}`).joints!.find((q) => q.type === 'bolt')!;
      expect(j.to).toBe('beam-F');
      expect(j.count).toBe(defaults.steerStopBoltCount);
      expect(j.diaIn).toBeCloseTo(defaults.steerStopBoltDiameterIn, 9);
      expect(j.at).toHaveLength(j.count);
      expect(j.size).toMatch(/fender washer/);
      // bolt positions lie along the dog and inside it
      const half = (plan.rb - plan.ra) / 2;
      for (const a of j.at!) expect(Math.abs(a[1])).toBeLessThanOrEqual(half);
    }
  });
  it('M7: the bolster fore and aft rails carry the structural through-bolts as joints (count and diameter from the params), none near the crossbar', () => {
    const rails = ['bolster-fore', 'bolster-aft'].map(byId);
    const n = rails.reduce((s, r) => s + r.joints!.filter((j) => j.type === 'bolt' && j.to === 'deck-nose').reduce((q, j) => q + j.count, 0), 0);
    expect(n).toBe(defaults.bolsterFastenerCount);
    for (const r of rails) {
      const j = r.joints!.find((q) => q.type === 'bolt' && q.to === 'deck-nose')!;
      expect(j.diaIn).toBeCloseTo(defaults.bolsterFastenerDiameterIn, 9);
      expect(j.at!.length).toBe(j.count);
      for (const a of j.at!) {
        expect(Math.abs(a[1])).toBeGreaterThanOrEqual(L.crossbar!.hw + 0.9); // clear of the crossbar end let into the rail
        expect(Math.abs(a[1])).toBeLessThanOrEqual(L.bolster.halfY);
      }
    }
    // more bolts means more joints
    for (const cnt of [2, 4, 6, 8]) {
      const lay = ringBoltLayout(cnt, L.bolster, L.crossbar!.hw);
      expect(lay).toHaveLength(cnt);
      expect(lay.filter((b) => b.rail === 'fore').length).toBe(Math.ceil(cnt / 2));
      for (const b of lay) expect(Math.abs(b.y)).toBeLessThanOrEqual(L.bolster.halfY);
    }
    const six = buildModel({ ...defaults, bolsterFastenerCount: 6 });
    expect(['bolster-fore', 'bolster-aft'].reduce((s, id) => s + six.find((x) => x.id === id)!.joints!.filter((j) => j.type === 'bolt').reduce((q, j) => q + j.count, 0), 0)).toBe(6);
  });
  it('M10: a removable access panel over the kingpin nut, flush with the nose deck, screwed into inserts in the crossbar top', () => {
    const ap = L.accessPanel!;
    expect(ap).not.toBeNull();
    const panel = byId('nose-access-panel');
    const bb = worldAABB(panel);
    expect(bb.min[2]).toBeCloseTo(L.bolster.z1, 9); // sits on the crossbar / rail tops
    expect(bb.max[2]).toBeCloseTo(L.noseTop, 9); // flush with the deck
    expect((bb.min[0] + bb.max[0]) / 2).toBeCloseTo(L.kx, 9);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(defaults.accessPanelWidthIn, 9);
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(defaults.accessPanelLengthIn, 9);
    expect(panel.kind).toBe('sheet');
    expect(panel.edges).toBe('edged');
    expect(panel.grain).toBe('x');
    const cb = byId('kingpin-crossbar');
    const ins = cb.joints!.find((j) => j.type === 'threaded-insert')!;
    expect(ins.to).toBe('nose-access-panel');
    expect(ins.count).toBe(4);
    expect(ins.at).toHaveLength(4);
    for (const a of ins.at!) {
      expect(Math.abs(a[1])).toBeLessThanOrEqual(L.crossbar!.hw); // the insert is in the crossbar
      expect(Math.abs(a[0])).toBeLessThanOrEqual((ap.x1 - ap.x0) / 2);
    }
    const scr = panel.joints!.find((j) => j.type === 'threaded-insert')!;
    expect(scr.to).toBe('kingpin-crossbar');
    expect(scr.size).toMatch(/#10-24/);
    // it covers the nut washer and the counterbore
    const washer = Math.max(defaults.kingpinWasherDiameterIn, 2.25 * defaults.kingpinDiameterIn);
    expect(2 * ap.hw).toBeGreaterThanOrEqual(washer + 0.25 - 1e-9);
    // without the crossbar there is no nut to reach and no panel
    expect(buildModel({ ...defaults, kingpinThroughBolster: 0 }).some((x) => x.id === 'nose-access-panel')).toBe(false);
    // validator: a panel wider than the crossbar, or narrower than the washer, is an error
    expect(errorsOf({ ...defaults, accessPanelWidthIn: 3 }).some((i) => i.keys.includes('accessPanelWidthIn'))).toBe(true);
    expect(errorsOf({ ...defaults, accessPanelWidthIn: 2, kingpinWasherDiameterIn: 2 }).some((i) => i.keys.includes('accessPanelWidthIn'))).toBe(true);
    expect(errorsOf(defaults)).toEqual([]);
  });
  it('M6: forged eye bolts through the front beam face, inboard of the U-bolt plates; the rope legs start at the eyes', () => {
    const beam = worldAABB(byId('beam-F'));
    for (const tag of ['L', 'R']) {
      const eye = byId(`eyebolt-${tag}`);
      const leg = byId(`bridle-${tag}`);
      const plate = worldAABB(byId(`clamp-F${tag}2`));
      expect(eye.geometry.type).toBe('mesh');
      expect(eye.body).toBe('steer');
      expect(eye.massLb).toBeGreaterThan(0.1);
      expect(eye.massLb).toBeLessThan(0.5);
      expect(eye.sourcing!.vendor).toMatch(/shoulder eye bolt/);
      const j = eye.joints!.find((q) => q.type === 'bolt')!;
      expect(j.to).toBe('beam-F');
      expect(j.diaIn).toBeCloseTo(defaults.eyeBoltDiameterIn, 9);
      // eye center ahead of the beam front face by the offset, at the beam's mid-depth
      const cx = eye.transform[12], cy = eye.transform[13], cz = eye.transform[14];
      expect(cx - beam.max[0]).toBeCloseTo(defaults.eyeBoltEyeOffsetIn, 9);
      expect(cz).toBeCloseTo((beam.min[2] + beam.max[2]) / 2, 9);
      // inboard of the U-bolt plate by the tie offset
      expect(Math.abs(cy)).toBeCloseTo(Math.min(Math.abs(plate.min[1]), Math.abs(plate.max[1])) - defaults.bridleTieOffsetIn, 6);
      expect(Math.sign(cy)).toBe(tag === 'L' ? 1 : -1);
      // the rope leg's near end is the eye center: the leg runs from there to the ring
      const o = partOBB(leg);
      const half = o.half[0];
      const ends = [-1, 1].map((s) => [o.center[0] + s * o.axes[0][0] * half, o.center[1] + s * o.axes[0][1] * half]);
      const near = ends.reduce((a, b) => (Math.hypot(a[0] - cx, a[1] - cy) < Math.hypot(b[0] - cx, b[1] - cy) ? a : b));
      expect(Math.hypot(near[0] - cx, near[1] - cy)).toBeLessThan(1e-6);
      expect(leg.sourcing!.vendor).toMatch(/polyester/);
      expect(leg.sourcing!.vendor).toMatch(/8 ft/);
    }
    // the oak-tongue configuration has no eye bolts (the tongue is pinned)
    expect(buildModel({ ...defaults, drawbar: 1 }).some((x) => x.id.startsWith('eyebolt'))).toBe(false);
    // a tie too close to the ring is rejected
    expect(errorsOf({ ...defaults, frontTrackIn: 34, bridleTieOffsetIn: 4, clampPlateWidthIn: 3 }).some((i) => i.keys.includes('bridleTieOffsetIn'))).toBe(true);
  });
  it('M11: sleeve and hub specs are recorded (1-1/4" OD × 1/4" wall DOM tube; 3/4" bore hand-truck wheels with ball bearings)', () => {
    const sl = byId('kingpin-sleeve-beam');
    expect(sl.material).toMatch(/1-1\/4" OD × 1\/4" wall DOM/);
    expect(sl.sourcing!.vendor).toMatch(/DOM/);
    expect(sl.sourcing!.vendor).toMatch(/ID 0\.750"/);
    expect(sl.joints!.some((j) => j.to === 'beam-F')).toBe(true);
    expect(byId('kingpin-sleeve-bar').joints!.some((j) => j.to === 'kingpin-crossbar')).toBe(true);
    for (const id of ['wheel-FL', 'wheel-FR', 'wheel-RL', 'wheel-RR']) {
      const w = byId(id);
      expect(w.sourcing!.vendor).toMatch(/0\.75" bore/);
      expect(w.sourcing!.vendor).toMatch(/hand-truck/);
      expect(w.notes).toMatch(/Hub spec \(M11\)/);
      expect(w.notes).toMatch(/ball bearings/);
    }
    expect(byId('kingpin').sourcing!.vendor).toMatch(/grade 8/);
    expect(byId('turntable').sourcing!.vendor).toMatch(/lazy-susan/);
  });
  it('every new part has a unit explode direction, a positive mass and a step', () => {
    const ids = [/^steer-stop/, /^stop-block/, /^eyebolt/, /^nose-access/, /^clamp-F/];
    for (const x of m.filter((q) => ids.some((r) => r.test(q.id)))) {
      expect(Math.hypot(...x.explode!), x.id).toBeCloseTo(1, 6);
      expect(x.massLb, x.id).toBeGreaterThan(0);
      expect(x.step, x.id).toBeGreaterThan(0);
    }
  });
});

describe('mesh builders (U-bolt and eye bolt)', () => {
  it('a rod swept along a path: rod volume matches π r² × length, the mesh is closed with outward normals, and a fillet shortens the path', () => {
    const path: Array<[number, number, number]> = [[0, 0, 0], [0, 0, 5], [4, 0, 5], [4, 0, 0]];
    const filleted = filletPath(path, 0.5, 6);
    expect(pathLength(path)).toBeCloseTo(14, 9);
    expect(pathLength(filleted)).toBeLessThan(14);
    expect(pathLength(filleted)).toBeGreaterThan(12.5);
    const mesh = tubeAlong(filleted, 0.1875, 10);
    expect(mesh.indices.length % 3).toBe(0);
    // signed volume of the (open-ended) tube surface: outward normals give a positive flux of the radial field through the side
    let flux = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => mesh.indices[i + k]).map((v) => [mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2]]);
      const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      const mid = [(a[0] + b[0] + c[0]) / 3 - 2, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3 - 2.5];
      flux += n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2];
    }
    expect(Number.isFinite(flux)).toBe(true);
    // a ring (eye) and a merged mesh
    const ring = circlePath([0, 0, 0], [0, 1, 0], 0.5, 16);
    expect(pathLength(ring, true)).toBeCloseTo(2 * Math.PI * 0.5, 1);
    const merged = mergeMeshes(mesh, tubeAlong(ring, 0.1, 8, true));
    expect(merged.positions.length).toBeGreaterThan(mesh.positions.length);
    expect(Math.max(...merged.indices)).toBe(merged.positions.length / 3 - 1);
  });
  it('the U-bolt part volume matches its rod: mass = π r² L ρ_steel + 0.11 lb of nuts and washers', () => {
    const m = buildModel(defaults);
    const u = m.find((x) => x.id === 'clamp-FL1')!;
    const rr = defaults.uboltRodDiameterIn / 2;
    const rodLb = u.massLb - 0.11;
    const lengthIn = (rodLb / defaults.steelDensityPcf) * 1728 / (Math.PI * rr * rr);
    // inner width + 2 legs of about the bridge height above the leg ends, less the bend shortening
    const b = computeLayout(defaults).beamF;
    const inner = b.thick + 2 * defaults.uboltBeamClearIn;
    const legH = b.top + rr - (b.bot - defaults.clampPlateThickIn - defaults.uboltNutAllowanceIn);
    expect(lengthIn).toBeGreaterThan(inner + 2 * legH - 4 * 2.5 * rr * 2);
    expect(lengthIn).toBeLessThan(inner + 2 * legH + 2 * rr * 4);
  });
  it('fractions print as fabrication sizes', () => {
    expect(frac(0.375)).toBe('3/8');
    expect(frac(0.75)).toBe('3/4');
    expect(frac(1.25)).toBe('1-1/4');
    expect(frac(0.25)).toBe('1/4');
    expect(frac(1)).toBe('1');
  });
});

describe('overlap-free over the sweep for the Phase 3 front end', () => {
  it('no stop dog, plate or block overlaps anything it should not at neutral and at both locks (the shared overlap test also runs the full model)', () => {
    for (const deg of [0, defaults.steerLockDeg, -defaults.steerLockDeg]) {
      const parts = buildModel(defaults, { steerDeg: deg }).filter((x) => !x.payload);
      const mine = parts.filter((x) => /^(steer-stop|stop-block)/.test(x.id));
      for (const a of mine) for (const b of parts) {
        if (a === b) continue;
        const o = obbOverlap(partOBB(a), partOBB(b));
        const intended = (a.id.startsWith('stop-block') && /^(bolster-(fore|aft)|kingpin-crossbar)$/.test(b.id)) || (b.id.startsWith('stop-block') && /^(bolster-(fore|aft)|kingpin-crossbar)$/.test(a.id));
        if (intended) continue;
        expect(o, `${a.id} x ${b.id} @${deg}`).toBeLessThanOrEqual(1e-6);
      }
    }
  });
});
