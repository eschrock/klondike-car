/**
 * One drill size a fastener stack: every part a through bolt passes (the two it joins, the parts it crosses, and the parts whose own hole joints sit on the same holes) shows the SAME clearance
 * diameter in its part drawing and its Shaper file, so a bolt never meets a tighter hole halfway through the stack (D-84: the grab-board stack had 17/64, 9/32 and 19/64 in one line).
 */
import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { localBounds, transformPoint } from '../model/bounds';
import type { Joint, Part, Vec3 } from '../model/types';
import { defaultParams, KNEE_MOUNT, WEATHER_SPEC, type Params } from '../params';
import { partDrawings } from './part-drawings';
import { shaperFiles } from './shaper-svg';

const CASES: Array<[string, Params]> = [
  ['default', defaultParams()],
  ['extreme', { ...defaultParams(), weatherSpec: WEATHER_SPEC.extreme }],
  ['fixed knees', { ...defaultParams(), kneeMount: KNEE_MOUNT.fixed }],
];
/** Holes that are not a bolt clearance by design: pilots, inserts, T-nut barrels, counterbores, snug bores, blind holes. */
const NOT_CLEARANCE = /pilot|insert|t-nut|counterbore|snug|\bbore\b|blind|screw eye|knob/i;
const frac = (t: string): number => {
  const m = /^(?:(\d+)-)?(\d+)\/(\d+)|^(\d*\.?\d+)/.exec(t.trim());
  if (!m) return NaN;
  return m[4] ? Number(m[4]) : (m[1] ? Number(m[1]) : 0) + Number(m[2]) / Number(m[3]);
};
const world = (x: Part, j: Joint): Vec3[] => (j.at ?? []).map((a) => transformPoint(x.transform, a));
/** The bolt's line: through each of its points along the owner's thinnest local axis (a through bolt crosses a board or a plate square to its face). */
function boltAxis(x: Part): Vec3 {
  const b = localBounds(x.geometry);
  const k = [0, 1, 2].sort((u, v) => b.max[u] - b.min[u] - (b.max[v] - b.min[v]))[0];
  const m = x.transform, d: Vec3 = [m[4 * k], m[4 * k + 1], m[4 * k + 2]];
  const n = Math.hypot(...d) || 1;
  return [d[0] / n, d[1] / n, d[2] / n];
}
/** A point on one of the lines (within 1/16 of it, and within 4 in along it). */
const onLines = (q: Vec3, pts: Vec3[], ax: Vec3): boolean => pts.some((P) => {
  const d = [q[0] - P[0], q[1] - P[1], q[2] - P[2]], t = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2];
  return Math.abs(t) < 4 && Math.hypot(d[0] - t * ax[0], d[1] - t * ax[1], d[2] - t * ax[2]) < 1 / 16;
});

describe('one clearance size through every bolt stack', () => {
  for (const [tag, p] of CASES) {
    it(`${tag}: the part drawings and the Shaper files of every part in a bolt's stack agree on its hole diameter`, () => {
      const parts = buildModel(p);
      const sheets = partDrawings(parts, p, { includeShaper: true });
      const files = shaperFiles(parts, p);
      const bad: string[] = [];
      let stacks = 0;
      for (const x of parts) for (const j of x.joints ?? []) {
        if (j.type !== 'bolt' || !j.at?.length) continue;
        const pts = world(x, j);
        const stack = new Set([x.id, j.to]);
        // the parts the bolt crosses (a drawing's passing hole for this pair) and the parts whose own bolt or hole joints sit on these holes
        for (const s of sheets) if (s.features.some((f) => f.joint === 'passing' && (f.to ?? []).includes(x.id) && (f.to ?? []).includes(j.to))) s.partIds.forEach((id) => stack.add(id));
        const ax = boltAxis(x);
        for (const q of parts) for (const k of q.joints ?? []) {
          if ((k.type !== 'bolt' && k.type !== 'hole') || !k.at?.length) continue;
          if (world(q, k).some((w) => onLines(w, pts, ax))) { stack.add(q.id); stack.add(k.to); }
        }
        const dias: Array<[string, number]> = [];
        for (const id of stack) {
          for (const f of sheets.find((s) => s.partIds.includes(id))?.features ?? []) {
            if (f.kind !== 'hole' || !/clearance/.test(f.size ?? '') || NOT_CLEARANCE.test(f.size ?? '') || !(f.to ?? []).some((t) => t !== id && stack.has(t))) continue;
            dias.push([`${id} drawing`, frac(f.size ?? '')]);
          }
          for (const f of files.find((q) => q.partIds.includes(id))?.features ?? []) {
            if ((f.kind !== 'hole' && f.kind !== 'drill') || f.approx || !f.diaIn || !f.to || f.to === id || !stack.has(f.to) || NOT_CLEARANCE.test(f.label)) continue;
            dias.push([`${id} Shaper file`, f.diaIn]);
          }
        }
        if (!dias.length) continue;
        stacks += 1;
        const d0 = dias[0][1];
        if (dias.some(([, d]) => Math.abs(d - d0) > 1 / 128)) bad.push(`${x.id} -> ${j.to}: ${dias.map(([w, d]) => `${w} ${d.toFixed(4)}`).join(', ')}`);
      }
      expect(stacks).toBeGreaterThan(10);
      expect([...new Set(bad)]).toEqual([]);
    });
  }
});
