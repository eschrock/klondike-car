/**
 * Moving and removable parts swept through their travel (D-93). The static overlap tests only see each part where it is drawn; these move the storage lid
 * through its whole swing (seat back upright and flat), turn the lid turn-buttons about their pivot screws, and check what the transport configuration keeps on. Clearances
 * are measured with `partsClearance` (tight boxes), never the bounding-box gap.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { partsClearance, transformPoint, worldAABB } from './bounds';
import { lidOpenAngleDeg, storageGeometry } from './storage';
import { flatPinHoles } from './seat-stow';
import { multiply, rotationY, rotationZ, translation } from './mat4';
import { offForTransport, TRANSPORT_VIEW } from './removable';
import type { Mat4, Part, PartGroup, Vec2 } from './types';

const defaults = defaultParams();
const L = computeLayout(defaults);
const g = storageGeometry(defaults, L);
/** Running clearance a moving part must keep from everything it passes (in). */
const RUN_IN = 1 / 16;
const SOLID: PartGroup[] = ['frame', 'body', 'front-end', 'running-gear', 'seat', 'storage', 'brake', 'removable', 'lighting', 'hardware'];
const solids = (ps: Part[]) => ps.filter((x) => !x.payload && SOLID.includes(x.group));
const moved = (x: Part, m: Mat4): Part => ({ ...x, transform: multiply(m, x.transform) });
const isLid = (id: string) => /^storage-(lid|rim-|lid-batten-)/.test(id);
/** The hinge pin: over the gasket gap between the lid and the fixed strip, a leaf above the lid top (D-89). */
const PIN = [(g.lidX1 + g.xh) / 2, g.zTop + 1 / 16] as const;
/** Opening the lid by `deg` about the pin: its aft end rises and swings forward. */
const lidPose = (deg: number): Mat4 => multiply(translation(PIN[0], 0, PIN[1]), multiply(rotationY((deg * Math.PI) / 180), translation(-PIN[0], 0, -PIN[1])));

/** A turn-button's pivot (world) and the button turned by `deg` about it (+ = toward +y at its free end). */
function buttonPivot(btn: Part): [number, number] {
  const j = btn.joints!.find((q) => q.type === 'screw')!;
  const w = transformPoint(btn.transform, j.at![0]);
  return [w[0], w[1]];
}
const turnAbout = (c: [number, number], deg: number): Mat4 => multiply(translation(c[0], c[1], 0), multiply(rotationZ((deg * Math.PI) / 180), translation(-c[0], -c[1], 0)));
/** The button's plan outline in the world, turned by `deg` about its pivot. */
function buttonPlan(btn: Part, deg: number): Vec2[] {
  if (btn.geometry.type !== 'extrusion') throw new Error('the turn-button is a profile extrusion');
  const m = multiply(turnAbout(buttonPivot(btn), deg), btn.transform);
  return btn.geometry.outline.map((q) => { const w = transformPoint(m, [q[0], q[1], 0]); return [w[0], w[1]] as Vec2; });
}

/** Sweep the lid from 0.5 deg to `toDeg` and return the tightest clearance to each fixed part (the turn-buttons turned across first). */
function lidSweep(parts: Part[], toDeg: number, skip: (id: string, deg: number) => boolean) {
  const set = solids(parts).map((x) => (/^storage-turn-button-/.test(x.id) ? moved(x, turnAbout(buttonPivot(x), 90)) : x));
  const lid = set.filter((x) => isLid(x.id)), fixed = set.filter((x) => !isLid(x.id) && !/^storage-hinge-/.test(x.id)); // the hinges are the pivot itself
  const worst = new Map<string, { c: number; deg: number }>();
  for (let deg = 0.5; deg <= toDeg + 1e-9; deg += 0.5) {
    const pose = lidPose(deg);
    for (const a of lid) {
      const am = moved(a, pose);
      for (const b of fixed) {
        if (skip(b.id, deg)) continue;
        const c = partsClearance(am, b);
        const k = `${a.id} x ${b.id}`;
        if (!worst.has(k) || c < worst.get(k)!.c) worst.set(k, { c, deg });
      }
    }
  }
  return worst;
}
const tight = (w: Map<string, { c: number; deg: number }>) => [...w].filter(([, v]) => v.c < RUN_IN).map(([k, v]) => `${k}: ${v.c.toFixed(3)}" at ${v.deg} deg`);

describe('storage lid swing in 3D (D-89, D-93)', () => {
  // The lid seals on its gaskets: soft bulb strips it presses when shut and leaves slowly near the hinge (the fore one is on the strip's face, a gasket's width from the pin),
  // so they are not obstacles. At the end of the swing it lies on the strip's bumpers (seat back flat) or leans on the seat back (1/8" off it, lidOpenAngleDeg).
  const shutContact = (id: string, _deg: number) => /^storage-gasket-/.test(id);
  it('the lid frame stands storageLidAftGapIn off the box\'s aft face (the transom backers and turn-button blocks), and the aft gasket moved in with it, under the aft rail', () => {
    const parts = buildModel(defaults);
    const get = (id: string) => worldAABB(parts.find((x) => x.id === id)!);
    expect(get('storage-rim-end-aft').min[0]).toBeCloseTo(g.x0 + defaults.storageLidAftGapIn, 9);
    expect(get('storage-rim-side-L').min[0]).toBeCloseTo(g.lidX0, 9);
    for (const id of ['transom-backer-L1', 'storage-turn-block-L']) expect(get('storage-rim-end-aft').min[0] - get(id).max[0], id).toBeGreaterThanOrEqual(defaults.storageLidAftGapIn - 1e-9);
    const gk = get('storage-gasket-end-aft'), rim = get('storage-rim-end-aft'), coam = get('storage-coaming-end-aft');
    expect(gk.min[0]).toBeGreaterThanOrEqual(rim.min[0] - 1e-9); // under the aft rail
    expect(gk.max[0]).toBeLessThanOrEqual(rim.max[0] + 1e-9);
    expect(gk.max[0]).toBeLessThanOrEqual(coam.max[0] + 1e-9); // still on the coaming
  });
  it('seat back upright: from shut to its rest on the back, the lid keeps 1/16" from every fixed part (the backers, the turn-button blocks and the buttons turned across, the flag tube and its block, the ribs and D-rings, the strip, the back)', () => {
    const open = lidOpenAngleDeg(defaults, L);
    expect(open).toBeGreaterThan(90);
    expect(tight(lidSweep(buildModel(defaults), open, shutContact))).toEqual([]);
  });
  it('seat back flat: the lid folds right over to 180 deg and keeps 1/16" from everything until it lands on the bumpers', () => {
    const w = lidSweep(buildModel(defaults, { seat: 'stowed' }), 180, (id, deg) => shutContact(id, deg) || (deg >= 178 && /^storage-bumper-/.test(id)));
    expect(tight(w)).toEqual([]);
    // and it does land on them (within a hair), not on the hinges
    const parts = solids(buildModel(defaults, { seat: 'stowed' }));
    const flat = parts.filter((x) => isLid(x.id)).map((x) => moved(x, lidPose(180)));
    const bumper = parts.find((x) => x.id === 'storage-bumper-L')!;
    expect(Math.min(...flat.map((x) => partsClearance(x, bumper)))).toBeLessThan(0.01);
  });
  it('the flag tube block stands at least 1/8" off the lid\'s swing', () => {
    const w = lidSweep(buildModel(defaults), lidOpenAngleDeg(defaults, L), () => false);
    const flag = [...w].filter(([k]) => / x flag-(block-top|tube)$/.test(k)).map(([, v]) => v.c);
    expect(flag.length).toBeGreaterThan(0);
    expect(Math.min(...flag)).toBeGreaterThanOrEqual(0.125);
  });
});

describe('lid turn-buttons turning (D-89, D-93)', () => {
  const parts = buildModel(defaults);
  const transom = parts.find((x) => x.id === 'transom-rear')!;
  const xTransom = worldAABB(transom).max[0]; // its inner face
  const lidAft = worldAABB(parts.find((x) => x.id === 'storage-rim-end-aft')!).min[0];
  it.each(['L', 'R'])('button %s: 5/8" wide, its aft end rounded about the pivot; it keeps 1/16" off the transom at every angle both ways, and turned across it clears the lid', (tag) => {
    const btn = parts.find((x) => x.id === `storage-turn-button-${tag}`)!;
    const bb = worldAABB(btn);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(0.625, 9);
    const [px, py] = buttonPivot(btn);
    const r = 0.3125;
    // every outline point aft of the pivot is on the half circle about it
    for (const q of buttonPlan(btn, 0).filter((q) => q[0] < px - 1e-9)) expect(Math.hypot(q[0] - px, q[1] - py)).toBeCloseTo(r, 6);
    for (let deg = -90; deg <= 90; deg += 1) {
      const plan = buttonPlan(btn, deg);
      expect(Math.min(...plan.map((q) => q[0])) - xTransom, `${deg} deg`).toBeGreaterThanOrEqual(RUN_IN - 1e-9);
    }
    for (const deg of [-90, 90]) expect(lidAft - Math.max(...buttonPlan(btn, deg).map((q) => q[0])), `${deg} deg`).toBeGreaterThanOrEqual(RUN_IN);
    // turned along the sled it still reaches at least 3/8" over the lid frame's aft rail
    expect(bb.max[0] - lidAft).toBeGreaterThanOrEqual(0.375 - 1e-9);
  });
  it('nothing else stands in the button\'s turning circle at its height (the transom is checked exactly above)', () => {
    for (const tag of ['L', 'R']) {
      const btn = parts.find((x) => x.id === `storage-turn-button-${tag}`)!;
      const bb = worldAABB(btn), [px, py] = buttonPivot(btn);
      const R = Math.max(...buttonPlan(btn, 0).map((q) => Math.hypot(q[0] - px, q[1] - py)));
      const hits = solids(parts).filter((x) => {
        if (x.id === btn.id || x.id === 'transom-rear') return false;
        const b = worldAABB(x);
        if (Math.min(b.max[2], bb.max[2]) - Math.max(b.min[2], bb.min[2]) <= 0.01) return false; // not at the button's height (the block and the lid are under it)
        const dx = Math.max(b.min[0] - px, 0, px - b.max[0]), dy = Math.max(b.min[1] - py, 0, py - b.max[1]);
        return Math.hypot(dx, dy) < R + RUN_IN;
      });
      expect(hits.map((x) => x.id), tag).toEqual([]);
    }
  });
});

describe('transport configuration keeps the seat-back latch pins (D-93)', () => {
  it('the pins are quick-release (removable) but stay in for the truck, through the flat back into the deck; the transport mass counts them', () => {
    const t = buildModel(defaults, TRANSPORT_VIEW);
    const holes = flatPinHoles(defaults, L);
    for (const tag of ['L', 'R'] as const) {
      const pin = t.find((x) => x.id === `seat-pin-${tag}`);
      expect(pin, tag).toBeDefined();
      expect(pin!.removable).toBe(true);
      expect(offForTransport(pin!)).toBe(false);
      const b = worldAABB(pin!), h = holes.find((q) => q.tag === tag)!;
      expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(h.center[0], 6);
      expect(b.min[2]).toBeLessThan(L.deckTop); // down into the deck
    }
    // everything else that is removable is off
    expect(t.some((x) => x.removable && offForTransport(x))).toBe(false);
    expect(t.some((x) => x.id === 'seat-back-pad')).toBe(false);
  });
});
