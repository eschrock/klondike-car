/**
 * The numbers the Summary table above the right panel shows (mass and center of gravity for the empty, operating and goal cases, the empty mass by part group and the
 * Transport-mode mass). Pure TypeScript; runs in the analysis worker so the page never waits on the four model builds it needs.
 */
import type { Params } from '../params';
import { centerOfGravity, totalMass } from '../model/mass';
import { TRANSPORT_VIEW } from '../model/removable';
import type { Part, PartGroup, Vec3 } from '../model/types';
import type { ViewState } from '../model';

/** Empty mass per part group, heaviest first (payload and reference parts excluded). */
export function massByGroup(parts: Part[]): { group: PartGroup; massLb: number }[] {
  const m = new Map<PartGroup, number>();
  for (const p of parts) if (!p.payload && p.group !== 'reference') m.set(p.group, (m.get(p.group) ?? 0) + p.massLb);
  return [...m.entries()].map(([group, massLb]) => ({ group, massLb })).sort((a, b) => b.massLb - a.massLb);
}

export interface SummaryStats {
  /** Empty, operating rider + cargo (150 lb must pass, D-1), goal rider + cargo (200 lb). */
  cases: { massLb: number; cog: Vec3 }[];
  groups: { group: PartGroup; massLb: number }[];
  /** Mass in Transport mode, no rider (removables off): the two-person lift (D-7, D-9). */
  transportLb: number;
  emptyLb: number;
}

export function summaryStats(p: Params, build: (p: Params, v: ViewState) => Part[]): SummaryStats {
  const empty = build(p, { steerDeg: 0, rider: 'none', cargo: false });
  const loads = [
    { parts: empty, payload: false },
    { parts: build(p, { steerDeg: 0, rider: 'operating', cargo: true }), payload: true },
    { parts: build(p, { steerDeg: 0, rider: 'goal', cargo: true }), payload: true },
  ];
  const transport = build(p, { steerDeg: 0, rider: 'none', cargo: false, ...TRANSPORT_VIEW });
  return {
    cases: loads.map((c) => ({ massLb: totalMass(c.parts, { includePayload: c.payload }), cog: centerOfGravity(c.parts, { includePayload: c.payload }) })),
    groups: massByGroup(empty),
    transportLb: totalMass(transport),
    emptyLb: totalMass(empty),
  };
}
