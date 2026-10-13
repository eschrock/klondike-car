/**
 * D-76 (docs/studies/side-stiffness-study.md, option E with option D at the rear station): three ribs per side, their knees and box ties, and the D-rings on their heads.
 * Stations, the parts, the bolts and screws, and the clearances to everything near them (inside: seat, cushion, box, lid, the seat back flipped flat, grab boards,
 * sign backers, the chocks and lamps in the box; outside: signs, grab-board backing strips, reflectors, scuppers).
 */
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, type Params } from '../params';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { partsOverlap, worldAABB } from './bounds';
import { storageGeometry } from './storage';
import { boxTieGeometry, kneeScrews, lashBoltLength, ribWasherSpan, sideRibStations } from './side-ribs';
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
  it('box rib 1.4 in behind the box fore end (x = 5.6), mid rib on joist 5 (27.6), bow post on the king beam (44)', () => {
    expect(st.map((s) => s.kind)).toEqual(['box', 'knee', 'knee']);
    expect(st[0].x).toBeCloseTo(storageGeometry(p, L).x1 - 1.4, 9);
    expect(st[0].x).toBeCloseTo(5.59, 2);
    expect(st[1].member).toBe('joist-5');
    expect(st[1].x).toBeCloseTo(27.64, 2);
    expect(st[2].member).toBe('king-beam');
    expect(st[2].x).toBe(L.king.x);
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
  it('6 ribs, 4 knees, 2 box ties and 6 D-rings; the lash doublers are gone', () => {
    expect(parts.filter((x) => /^side-rib-[LR]\d$/.test(x.id))).toHaveLength(6);
    expect(parts.filter((x) => /^side-rib-knee-/.test(x.id))).toHaveLength(4);
    expect(parts.filter((x) => /^box-tie-/.test(x.id))).toHaveLength(2);
    expect(parts.filter((x) => /^lash-/.test(x.id))).toHaveLength(6);
    expect(parts.some((x) => /^doubler-lash/.test(x.id))).toBe(false);
    for (const x of parts.filter((q) => /^(side-rib|box-tie)/.test(q.id))) {
      expect(x.material, x.id).toBe('white oak');
      expect(x.fab, x.id).toBe('bandsaw');
      expect(x.stock!.t, x.id).toBeCloseTo(0.75, 6); // all from 4/4 offcuts planed to 3/4 in
    }
    expect(get('side-rib-L1').partNo).toBe('side-rib-box');
    expect(get('side-rib-R2').partNo).toBe('side-rib');
    expect(get('side-rib-L3').partNo).toBe('side-rib-bow');
  });
  it('the head top is flush with the gunwale top and the head is the band tall; the box rib starts at its spacer, the others at the deck', () => {
    for (const tag of ['L', 'R']) for (const st of sideRibStations(p, L)) {
      const b = worldAABB(get(`side-rib-${tag}${st.n}`));
      expect(b.max[2]).toBeGreaterThanOrEqual(st.top - 1e-6);
      expect(b.max[2]).toBeLessThan(st.top + 0.3); // the sheer rises up to 0.26 in over the aft half of the 2 in head (14 degrees at the box rib)
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
  it('D-rings: 4 #8-32 x 2 in stainless machine screws each (washer + sandwich + head + plate + nylock + 2 threads = 1.78 in), weather-aware', () => {
    const lb = lashBoltLength(p);
    expect(lb.need).toBeCloseTo(0.05 + 0.625 + 0.75 + 0.125 + 0.172 + 1 / 16, 9);
    expect(lb.len).toBe(2);
    const j = get('lash-L2').joints![0];
    expect(j.type).toBe('bolt');
    expect(j.count).toBe(4);
    expect(j.diaIn).toBeCloseTo(0.164, 9);
    expect(j.size).toMatch(/18-8 \(304\) stainless machine screw/);
    expect(get('lash-L2').material).toMatch(/zinc-plated steel D-ring/);
    const ext = buildModel({ ...p, weatherSpec: 1 } as Params);
    expect(ext.find((x) => x.id === 'lash-L2')!.joints![0].size).toMatch(/316 stainless/);
    expect(ext.find((x) => x.id === 'lash-L2')!.material).toMatch(/316 stainless D-ring/);
  });
  it('knee screws: 2 standard #6 x 2-1/2 (D-72: no new screw size) through the counterbored knee and the deck into the member, within its depth', () => {
    const ks = kneeScrews(p, L);
    expect(ks.fit.gauge).toBe(6);
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
    // the rear reflector did not have to move: 3/8 in clear of the box rib's washers
    expect(worldAABB(get('reflector-L1')).min[0] - ribWasherSpan(sideRibStations(p, L)[0])[1]).toBeGreaterThan(0.35);
  });
});

describe('mass (D-76)', () => {
  it('ribs, knees and ties about 1.2 lb for the sled; the empty sled is 0.96 lb heavier than with the six lash doublers', () => {
    const wood = parts.filter((x) => /^(side-rib|box-tie)/.test(x.id)).reduce((a, x) => a + x.massLb, 0);
    expect(wood).toBeGreaterThan(1.1);
    expect(wood).toBeLessThan(1.25);
  });
});

describe('params (D-76)', () => {
  it('the bow station is a verify item; the doubler param is retired; the D-rings per side stay 3', () => {
    expect(PARAM_DEFS.sideRibFrontXIn.status).toBe('verify');
    expect(PARAM_DEFS.sideRibFrontXIn.note).toMatch(/booted rider/);
    expect('lashDoublerThickIn' in PARAM_DEFS).toBe(false);
    expect(p.lashPointsPerSide).toBe(3);
  });
});
