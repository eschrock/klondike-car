/**
 * D-106 (Eric, 2026-11-01): the rear transom is 5/8 in (it was 1/2 in) and grew BACKWARD, so its inner face and everything measured from it (deck, rails, sides, box, the rail's hole
 * layout) stayed where the build had already marked and cut them. The 1/2 in design is restored with PRE_D106.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, derived, type Params } from './params';
import { buildModel } from './model';
import { computeLayout } from './model/layout';
import { worldAABB } from './model/bounds';
import { totalMass } from './model/mass';
import { runChecks } from './analysis';
import { PRE_D106 } from './test-fixtures';

const now = defaultParams();
const old = { ...now, ...PRE_D106 } as Params;
const partsNow = buildModel(now);
const partsOld = buildModel(old);
const get = (ps: typeof partsNow, id: string) => ps.find((x) => x.id === id)!;

describe('D-106: the 5/8 in rear transom, grown backward', () => {
  it('is 5/8 in thick, its outer face 10-1/8 in behind the rear axle and its inner face where the 1/2 in one had it (-9-1/2 in)', () => {
    expect(now.transomThicknessIn).toBe(0.625);
    const a = worldAABB(get(partsNow, 'transom-rear'));
    expect(a.min[0]).toBeCloseTo(-10.125, 6);
    expect(a.max[0]).toBeCloseTo(-9.5, 6);
    expect(worldAABB(get(partsOld, 'transom-rear')).max[0]).toBeCloseTo(-9.5, 6);
    expect(computeLayout(now).xRear + computeLayout(now).transom).toBeCloseTo(computeLayout(old).xRear + computeLayout(old).transom, 9);
    expect(derived(now).bodyLengthIn).toBeCloseTo(60.875, 9); // 1/8 in longer overall
  });
  it('leaves the parts measured from the inner face unchanged: deck, rails, side webs, storage box and the rail hole layout', () => {
    for (const id of ['deck', 'rail-L', 'rail-R', 'side-L-web', 'side-R-web', 'side-L-chine', 'side-L-gunwale']) {
      const a = get(partsNow, id), b = get(partsOld, id);
      expect(a.stock, id).toEqual(b.stock);
      expect(worldAABB(a).min[0], id).toBeCloseTo(worldAABB(b).min[0], 6);
    }
    // only the loose tenon to the transom changes: 3/8 in deep in both parts (1/4 in with the 1/2 in transom); every hole, notch and mortise position is the same
    const rest = (ps: typeof partsNow) => get(ps, 'rail-L').joints!.filter((j) => !(j.type === 'mortise-tenon' && j.to === 'transom-rear'));
    expect(rest(partsNow)).toEqual(rest(partsOld));
    const tenon = (ps: typeof partsNow) => get(ps, 'rail-L').joints!.find((j) => j.type === 'mortise-tenon' && j.to === 'transom-rear')!.size;
    expect(tenon(partsNow)).toMatch(/^1\/4 × 13\/16 × 3\/8 deep loose tenon/);
    expect(tenon(partsOld)).toMatch(/^1\/4 × 13\/16 × 1\/4 deep loose tenon/);
    const box = (ps: typeof partsNow) => ps.filter((x) => /^storage-/.test(x.id)).map((x) => [x.id, x.stock]);
    expect(box(partsNow)).toEqual(box(partsOld));
  });
  it('the handle-socket screws are 1/4-20 x 1-1/2 used as bought (they were cut to 1-3/8 for the 1/2 in transom)', () => {
    const sock = (ps: typeof partsNow) => get(ps, 'handle-socket-L').joints!.find((j) => j.to === 'transom-rear')!.size;
    expect(sock(partsNow)).toMatch(/^1\/4-20 × 1-1\/2 (?:316|18-8)/);
    expect(sock(partsOld)).toMatch(/^1\/4-20 × 1-1\/2 \(cut to 1-3\/8"\)/);
  });
  it('adds about 1.3 lb, eases the lift row and fails nothing', () => {
    const m = (p: Params) => totalMass(buildModel(p, { rider: 'none', cargo: false }));
    expect(m(now) - m(old)).toBeCloseTo(1.34, 1);
    const cs = runChecks(now, { includeTruck: false });
    const lift = cs.find((c) => c.id === 'lift')!;
    expect(lift.util!).toBeLessThan(runChecks(old, { includeTruck: false }).find((c) => c.id === 'lift')!.util!);
    expect(cs.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual([]);
  });
});
