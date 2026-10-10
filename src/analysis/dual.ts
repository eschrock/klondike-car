/**
 * Evaluate a check at the operating and goal rider and combine (spec "Load cases"): operating is the pass/fail
 * case (D-1); if the goal rider fails while operating passes, the row is 'fail' with a goal-rider flag in `how`.
 */
import type { AnalysisCheck, CaseResult, CheckGroup, Detail, LoadKind, Status } from './types';
import { SEVERITY, judge, utilization, worst } from './types';

export interface CaseEval {
  value: number;
  unit: string;
  limit: number;
  sense: '>=' | '<=';
  how: string;
  /** Suffix for the label naming the governing criterion. */
  suffix?: string;
  details?: Detail[];
  /** Override the margin that counts as 'marginal' (default 10% of |limit|). */
  marginalAbs?: number;
  /** Report only (no pass/fail). */
  info?: boolean;
}

export interface DualSpec {
  id: string;
  label: string;
  group: CheckGroup;
  refs?: string[];
  /** The case shown in the row (stability: operating; structure: goal, per D-2). */
  primary: 'operating' | 'goal';
  operating: CaseEval;
  goal: CaseEval;
  operatingLabel: string;
  goalLabel: string;
  /** Optional lightest-rider case. It counts toward the operating status (the 80–150 lb envelope must pass, D-1). */
  light?: CaseEval;
  lightLabel?: string;
}

const statusOf = (e: CaseEval): Status => (e.info ? 'info' : judge(e.value, e.limit, e.sense, e.marginalAbs));

const toCase = (load: LoadKind, e: CaseEval, status: Status): CaseResult => ({
  load, value: e.value, unit: e.unit, limit: e.limit, status, sense: e.sense, util: utilization(e.value, e.limit, e.sense),
});

export function dualCheck(s: DualSpec): AnalysisCheck {
  const sOp = statusOf(s.operating);
  const sLight = s.light ? statusOf(s.light) : undefined;
  const so: Status = sLight ? worst(sOp, sLight) : sOp;
  const sg = statusOf(s.goal);
  const prim = s.primary === 'goal' ? s.goal : s.operating;
  const info = so === 'info' && sg === 'info';
  const status: Status = info ? 'info' : worst(so, sg);
  const goalFlag = !info && so !== 'fail' && sg === 'fail';
  const lines: string[] = [];
  const order: ['operating' | 'goal' | 'light', CaseEval, string][] = s.primary === 'goal'
    ? [['goal', s.goal, s.goalLabel], ['operating', s.operating, s.operatingLabel]]
    : [['operating', s.operating, s.operatingLabel], ['goal', s.goal, s.goalLabel]];
  if (s.light) order.push(['light', s.light, s.lightLabel ?? 'Lightest rider']);
  for (const [, e, lab] of order) lines.push(`${lab}: ${e.how}`);
  if (goalFlag) lines.push(`GOAL RIDER FLAG: passes at the ${s.operatingLabel.toLowerCase()} but fails at the ${s.goalLabel.toLowerCase()} (D-1: flagged, not designed around).`);
  const cases: AnalysisCheck['cases'] = { operating: toCase('operating', s.operating, sOp), goal: toCase('goal', s.goal, sg) };
  if (s.light && sLight) cases.light = toCase('light', s.light, sLight);
  // Governing case: worst status, then highest utilisation (info rows: the primary case).
  let gov: CaseResult = cases[s.primary]!;
  if (!info) {
    for (const r of Object.values(cases)) {
      if (!r) continue;
      if (SEVERITY[r.status] > SEVERITY[gov.status] || (SEVERITY[r.status] === SEVERITY[gov.status] && r.util > gov.util)) gov = r;
    }
  }
  const util = Math.max(...Object.values(cases).map((r) => (r ? r.util : 0)));
  return {
    id: s.id,
    label: s.label + (prim.suffix ? ` (${prim.suffix})` : ''),
    group: s.group,
    value: prim.value,
    unit: prim.unit,
    limit: prim.limit,
    sense: prim.sense,
    status,
    load: s.primary,
    how: lines.join('\n'),
    refs: s.refs,
    statusOperating: so,
    statusGoal: sg,
    cases,
    governingLoad: gov.load,
    util,
    goalFlag,
    details: prim.details,
  };
}

/** Pick the criterion with the highest utilisation and turn the list into a CaseEval. */
export function governing(details: Detail[], how: string): CaseEval {
  const g = details.reduce((a, b) => (b.util > a.util ? b : a), details[0]);
  return { value: g.value, unit: g.unit, limit: g.limit, sense: g.sense, how, suffix: g.name, details };
}

export const detail = (name: string, value: number, unit: string, limit: number, sense: '>=' | '<='): Detail => ({
  name, value, unit, limit, sense, util: utilization(value, limit, sense),
});

/** A single-case check (geometry-only or info rows). */
export interface SingleSpec {
  id: string;
  label: string;
  group: CheckGroup;
  value: number;
  unit: string;
  limit: number;
  sense: '>=' | '<=';
  how: string;
  refs?: string[];
  load?: Exclude<LoadKind, 'light'>;
  info?: boolean;
  marginalAbs?: number;
  /** Explicit status (e.g. pass/fail rows with no margin band). */
  status?: Status;
  details?: Detail[];
}

export function singleCheck(c: SingleSpec): AnalysisCheck {
  const { info, marginalAbs, status: forced, ...rest } = c;
  const status: Status = info ? 'info' : forced ?? judge(c.value, c.limit, c.sense, marginalAbs);
  return { ...rest, status, statusOperating: status, statusGoal: status, util: info ? undefined : utilization(c.value, c.limit, c.sense) };
}
