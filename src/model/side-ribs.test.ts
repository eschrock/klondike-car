/**
 * D-76 (docs/studies/side-stiffness-study.md, option E with option D at the rear station): three ribs per side, their knees and box ties, and the D-rings on their heads.
 * Stations, the parts, the bolts and screws, and the clearances to everything near them (inside: seat, cushion, box, lid, the seat back flipped flat, grab boards,
 * sign backers, the chocks and lamps in the box; outside: signs, grab-board backing strips, reflectors, scuppers).
 */
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, type Params } from '../params';
import { buildModel } from './index';
import { computeLayout, sideTopAt } from './layout';
import { partsOverlap, worldAABB } from './bounds';
import { storageGeometry } from './storage';
import { boxTieGeometry, kneeScrewDriftLimitIn, kneeScrews, lashBoltLength, ribWasherSpan, sideRibStations, KNEE_MIN_WOOD_IN } from './side-ribs';
import { transformPoint } from './bounds';
import { signPlacement } from './body';
import { screwFitOk } from './rear-mount';
import type { Part } from './types';

const p = defaultParams();
const L = computeLayout(p);
const parts = buildModel(p);
const byId = new Map(parts.map((x) => [x.id, x]));
const get = (id: string) => byId.get(id)!;
const ours = (x: Part) => /^(side-rib|box-tie|lash-)/.test(x.id);

describe('stations (D-76)', () => {
  const st = sideRibStations(p, L);
  it('box rib 4 in behind the box fore end (x = 3.0, under the sign\'s front knobs), mid rib on joist 5 (27.6), bow post on the king beam (44), rear rib 3.25 in ahead of the box aft end (x = -5.5)', () => {
    expect(st.map((s) => s.kind)).toEqual(['box', 'knee', 'knee', 'box']);
    expect(st.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(st[0].x).toBeCloseTo(storageGeometry(p, L).x1 - 4, 9);
    expect(st[0].x).toBeCloseTo(2.96, 1); // D-85
    expect(st[3].x).toBeCloseTo(storageGeometry(p, L).x0 + 3.25, 9);
    expect(st[3].x).toBeCloseTo(-5.5, 1);
    expect(st[1].member).toBe('joist-5');
    expect(st[1].memberX).toBeCloseTo(27.64, 2);
    expect(st[1].x).toBeCloseTo(27.99, 2); // the rib stands 0.35 in ahead of joist 5 so the knee's two screws land on its centerline (the side is turned 10.7 degrees there)
    expect(st[2].member).toBe('king-beam');
    expect(st[2].x).toBe(L.king.x); // the side is square at x = 44 and the king beam is 3 in thick: no shift
  });
  it('the bow station is one number: sideRibFrontXIn 35 moves the post to the chain joist (the verify fallback)', () => {
    const q = { ...p, sideRibFrontXIn: 35 } as Params;
    const s3 = sideRibStations(q, computeLayout(q))[2];
    expect(s3.member).toBe('joist-6');
    expect(s3.x).toBeCloseTo(L.chain.joistX, 9);
    expect(s3.memberT).toBe(p.chainJoistThickIn);
    expect(s3.yIn - p.sideRibDepthIn).toBeGreaterThan(st[2].yIn - p.sideRibDepthIn + 0.5); // the post face moves about 3/4 in outboard (8.4 vs 7.9 in from the center line)
    expect(buildModel(q).some((x) => x.id === 'side-rib-knee-L3' && x.joints!.some((j) => j.to === 'joist-6'))).toBe(true);
  });
  it('the mid rib never lands under the seat cushion (its knee reaches over the deck beside it)', () => {
    for (const mid of [18, 20.2, 24]) {
      const q = { ...p, sideRibMidXIn: mid } as Params;
      const Lq = computeLayout(q);
      expect(sideRibStations(q, Lq)[1].x, `${mid}`).toBeGreaterThan(Lq.seat.xFront + q.sideRibWidthIn / 2);
    }
  });
  it('an under-seat box: the rear rib is a knee rib on a joist clear of the box', () => {
    const q = { ...p, storageLocation: 2 } as Params;
    const Lq = computeLayout(q);
    const s1 = sideRibStations(q, Lq)[0];
    const g = storageGeometry(q, Lq);
    expect(s1.kind).toBe('knee');
    expect(s1.x < g.x0 || s1.x > g.x1).toBe(true);
  });
});

describe('parts (D-76)', () => {
  it('8 ribs, 4 knees, 4 box ties and 8 D-rings; the lash doublers are gone', () => {
    expect(parts.filter((x) => /^side-rib-[LR]\d$/.test(x.id))).toHaveLength(8);
    expect(parts.filter((x) => /^side-rib-knee-/.test(x.id))).toHaveLength(4);
    expect(parts.filter((x) => /^box-tie-/.test(x.id))).toHaveLength(4);
    expect(parts.filter((x) => /^lash-/.test(x.id))).toHaveLength(8);
    expect(parts.some((x) => /^doubler-lash/.test(x.id))).toBe(false);
    for (const x of parts.filter((q) => /^(side-rib|box-tie)/.test(q.id))) {
      expect(x.material, x.id).toBe('white oak');
      expect(x.fab, x.id).toBe('bandsaw');
      expect(x.stock!.t, x.id).toBeCloseTo(0.75, 6); // all from 4/4 offcuts planed to 3/4 in
    }
    expect(get('side-rib-L1').partNo).toBe('side-rib-box');
    expect(get('side-rib-R2').partNo).toBe('side-rib');
    expect(get('side-rib-L3').partNo).toBe('side-rib-bow');
    expect(get('side-rib-L4').partNo).toBe('side-rib-rear');
  });
  it('the head top is flush with the gunwale top and the head is the band tall; the box rib starts at its spacer, the others at the deck', () => {
    for (const tag of ['L', 'R']) for (const st of sideRibStations(p, L)) {
      const b = worldAABB(get(`side-rib-${tag}${st.n}`));
      expect(b.max[2]).toBeGreaterThanOrEqual(st.top - 1e-6);
      expect(b.max[2]).toBeLessThan(st.top + 0.35); // the sheer rises up to 0.33 in over the aft half of the 2 in head (the steeper rear rib, D-85)
      expect(b.min[2]).toBeCloseTo(st.kind === 'box' ? boxTieGeometry(p, L, st).z0 : L.deckTop, 6);
      expect(Math.abs(get(`side-rib-${tag}${st.n}`).transform[13])).toBeCloseTo(st.yIn, 9); // its back on the inner band face at the station (the frame origin)
    }
  });
  it('the box tie fills the gap between the rib and the box side, below the coaming and under the head', () => {
    const st = sideRibStations(p, L)[0];
    const g = storageGeometry(p, L);
    const tg = boxTieGeometry(p, L, st);
    const b = worldAABB(get('box-tie-L'));
    expect(b.min[1]).toBeCloseTo(g.hw, 6);
    expect(b.max[1]).toBeCloseTo(st.yIn - p.sideRibDepthIn, 6);
    expect(b.max[2]).toBeCloseTo(g.zPlyTop - 0.125, 6);
    expect(tg.z1).toBeLessThan(st.top - L.railBand);
    expect(get('box-tie-L').joints!.some((j) => j.type === 'glue' && j.to === 'storage-side-L')).toBe(true);
  });
  it('D-rings (D-83): 2 1/4-20 x 2 in stainless button-head bolts each (washer + sandwich + head + bracket + nylock + 2 threads = 1.94 in), weather-aware', () => {
    const lb = lashBoltLength(p);
    expect(lb.need).toBeCloseTo(0.063 + 0.625 + 0.75 + 0.125 + 0.3125 + 1 / 16, 9);
    expect(lb.len).toBe(2);
    const j = get('lash-L2').joints![0];
    expect(j.type).toBe('bolt');
    expect(j.count).toBe(2);
    expect(j.diaIn).toBeCloseTo(0.25, 9);
    expect(j.size).toMatch(/^1\/4-20 x 2" 18-8 \(304\) stainless button-head bolt/);
    expect(get('lash-L2').material).toMatch(/zinc-plated steel cargo D-ring/);
    expect(get('lash-L2').notes).toMatch(/VERIFY the real bracket/);
    const ext = buildModel({ ...p, weatherSpec: 1 } as Params);
    expect(ext.find((x) => x.id === 'lash-L2')!.joints![0].size).toMatch(/316 stainless/);
    expect(ext.find((x) => x.id === 'lash-L2')!.material).toMatch(/316 stainless cargo D-ring/);
  });
  it('knee screws: 2 standard #8 x 2-1/2 (D-72, D-82: every wood screw is a #8) through the counterbored knee and the deck into the member, within its depth', () => {
    const ks = kneeScrews(p, L);
    expect(ks.fit.gauge).toBe(8);
    expect(ks.fit.lenIn).toBe(2.5);
    expect(screwFitOk(ks.fit)).toBe(true);
    for (const id of ['side-rib-knee-L2', 'side-rib-knee-R3']) {
      const j = get(id).joints!.find((q) => q.type === 'screw')!;
      expect(j.count).toBe(2);
      const mate = get(j.to);
      expect(mate.joints!.some((q) => q.type === 'screw' && q.to === id && q.count === 2), id).toBe(true); // the member records its own end
    }
  });
});

describe('knee screws keep wood to the member (D-76)', () => {
  // Every knee screw, in model coordinates, against the member it goes into: the shank leaves at least 1/8 in of wood to each fore-aft face, and the point is within the member's length.
  const cases: Array<[string, Params]> = [['defaults', p], ['bow post on the chain crossmember', { ...p, sideRibFrontXIn: 35 } as Params], ['mid rib at 24 in', { ...p, sideRibMidXIn: 24 } as Params], ['under-seat box', { ...p, storageLocation: 2 } as Params]];
  for (const [label, q] of cases) {
    it(`${label}: both screws of every knee sit at least 1/8 in of wood from each face of the member`, () => {
      const ps = buildModel(q), by = new Map(ps.map((x) => [x.id, x]));
      const knees = ps.filter((x) => /^side-rib-knee-/.test(x.id));
      expect(knees.length).toBeGreaterThanOrEqual(4);
      for (const k of knees) {
        const j = k.joints!.find((c) => c.type === 'screw')!;
        const mem = by.get(j.to)!;
        const xm = mem.transform[12], t = mem.stock!.t;
        expect(j.at!.length, k.id).toBe(2);
        for (const a of j.at!) {
          const w = transformPoint(k.transform, a);
          const wood = t / 2 - Math.abs(w[0] - xm) - j.diaIn! / 2;
          expect(wood, `${k.id} screw at x ${w[0].toFixed(3)} vs ${mem.id} ${(xm - t / 2).toFixed(3)}..${(xm + t / 2).toFixed(3)}`).toBeGreaterThanOrEqual(KNEE_MIN_WOOD_IN - 1e-9);
        }
        // the member's own end of the joint records the same points, in its top edge
        const mj = mem.joints!.find((c) => c.type === 'screw' && c.to === k.id)!;
        for (const a of mj.at!) expect(Math.abs(transformPoint(mem.transform, a)[0] - xm), mem.id).toBeLessThanOrEqual(kneeScrewDriftLimitIn(t) + 1e-9);
      }
    });
  }
  it('the turned side was the failure: with the rib on the member the same screws would break out (a regression guard on the shift)', () => {
    const st = sideRibStations(p, L)[1];
    const yaw = Math.atan(st.dTurn);
    const ks = kneeScrews(p, L);
    const unshifted = ks.d.map((d) => Math.abs(Math.sin(yaw) * (p.sideRibDepthIn + d)));
    expect(Math.max(...unshifted)).toBeGreaterThan(kneeScrewDriftLimitIn(st.memberT));
  });
});

describe('part names (D-76)', () => {
  it('part names read by role and side', () => {
    expect(get('side-rib-L2').name).toBe('Side rib, mid, left');
    expect(get('side-rib-R3').name).toBe('Side rib, bow post, right');
    expect(get('side-rib-knee-L2').name).toBe('Rib knee, mid, left');
    expect(get('side-rib-knee-R3').name).toBe('Rib knee, bow post, right');
    expect(get('box-tie-R').name).toBe('Box tie spacer, right');
    expect(get('lash-L1').name).toBe('Lash point, box, left');
    expect(new Set(parts.filter((x) => /^side-rib-knee-/.test(x.id)).map((x) => x.name)).size).toBe(4);
  });
});

describe('clearances (D-76)', () => {
  const near = (ps: Part[], re: RegExp) => {
    const bad: string[] = [];
    const mine = ps.filter(ours);
    for (const a of mine) for (const b of ps) {
      if (a === b || !re.test(b.id) || ours(b)) continue;
      const o = partsOverlap(a, b);
      if (o > 0.01) bad.push(`${a.id} x ${b.id}: ${o.toFixed(3)}`);
    }
    return bad;
  };
  const inside = /^(seat-|storage-(?!side-[LR]$)|sign-backer|lamp|rear-lamp|brake-chock|flag-)/;
  it('clear of the seat, the cushion, the box (but the tie on its side), the lid, the grab boards, the sign backers and the flag tube', () => {
    expect(near(parts, inside)).toEqual([]);
    // the tie is glued to the box side and touches nothing else of the box
    expect(partsOverlap(get('box-tie-L'), get('storage-side-L'))).toBeLessThanOrEqual(0.01);
  });
  it('cargo mode: clear of the seat back flipped flat, the cushions and the chocks and lamps stowed in the box', () => {
    const ps = buildModel(p, { seat: 'stowed', chocks: true, lights: true });
    expect(near(ps, inside)).toEqual([]);
  });
  it('outside: the bolt washers stay clear of the signs, the grab-board backing strips, the reflectors and the scuppers', () => {
    const outside = parts.filter((x) => /^(sign-[LR]$|seat-grip-backing|reflector-|scupper-)/.test(x.id));
    for (const st of sideRibStations(p, L)) {
      const [wa, wb] = ribWasherSpan(st);
      const zc = st.top - L.railBand / 2;
      for (const x of outside) {
        const b = worldAABB(x);
        if (b.max[2] < zc - 0.625 || b.min[2] > zc + 0.625) continue; // the washers span the band's middle 1-1/4 in
        const gap = Math.max(b.min[0] - wb, wa - b.max[0]);
        expect(gap, `${x.id} vs the rib ${st.n} washers`).toBeGreaterThanOrEqual(0.25);
      }
    }
    // the rear reflector did not have to move: about 3/8 in clear of the box rib's washers
    expect(worldAABB(get('reflector-L1')).min[0] - ribWasherSpan(sideRibStations(p, L)[0])[1]).toBeGreaterThan(0.3); // D-83: 0.35 clear with the old #8 washers, 0.30 with the 3/4 in 1/4 fender washers 1/8 in farther apart
  });
});

describe('rear rib and the sign (D-85)', () => {
  it('the box rib\'s fender washers clear the level sign\'s top edge, and the rear rib stands clear of the flag tube blocks', () => {
    const sg = signPlacement({ p, L });
    const signTop = sg.zc + sg.height / 2;
    const st = sideRibStations(p, L)[0];
    const [x0, x1] = ribWasherSpan(st);
    const lowest = Math.min(sideTopAt(L, x0 + 0.375), sideTopAt(L, x1 - 0.375)) - L.railBand / 2 - 0.375; // washer center is half a band under the sheer, radius 3/8
    expect(lowest - 0.375 + 0.375 - signTop).toBeGreaterThan(0.05);
    const rear = worldAABB(get('side-rib-L4'));
    expect(worldAABB(get('flag-block-top')).max[0]).toBeLessThan(rear.min[0] - 0.1);
    expect(worldAABB(get('flag-block-bottom')).max[0]).toBeLessThan(rear.min[0] - 0.1);
  });
  it('the sign\'s knobs are in the ribs: two inserts a rib, at the ribs\' own x', () => {
    for (const n of [1, 4]) expect(get(`side-rib-L${n}`).joints!.filter((j) => j.type === 'threaded-insert' && j.to === 'sign-L').reduce((a, j) => a + j.count, 0)).toBe(2);
    expect(parts.some((x) => x.id.startsWith('sign-backer'))).toBe(false);
  });
  it('a short box drops the rear rib rather than overlapping the box rib', () => {
    const q = { ...p, sideRibBoxInsetIn: 6.5, sideRibRearInsetIn: 7 } as Params;
    expect(sideRibStations(q, computeLayout(q)).map((x) => x.n)).toEqual(expect.not.arrayContaining([4]));
  });
});

describe('mass (D-76)', () => {
  it('ribs, knees and ties about 1.8 lb for the sled (D-85: the rear ribs and their ties add about 0.55 lb; the four sign backing strips, about 0.2 lb, are gone)', () => {
    const wood = parts.filter((x) => /^(side-rib|box-tie)/.test(x.id)).reduce((a, x) => a + x.massLb, 0);
    expect(wood).toBeGreaterThan(1.7);
    expect(wood).toBeLessThan(1.85);
  });
});

describe('params (D-76)', () => {
  it('the bow station is a verify item; the doubler param is retired; the D-rings per side are 4 (D-85)', () => {
    expect(PARAM_DEFS.sideRibFrontXIn.status).toBe('verify');
    expect(PARAM_DEFS.sideRibFrontXIn.note).toMatch(/booted rider/);
    expect('lashDoublerThickIn' in PARAM_DEFS).toBe(false);
    expect(p.lashPointsPerSide).toBe(4);
  });
});
