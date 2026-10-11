/**
 * Analysis result types. `CheckResult` (src/model/types.ts) is extended locally so the model schema stays untouched.
 */
import type { CheckResult } from '../model/types';

export type Status = CheckResult['status'];
export type LoadKind = 'empty' | 'operating' | 'goal' | 'light';
export type CheckGroup = 'Stability' | 'Steering' | 'Braking' | 'Structure' | 'Mass & transport';
export const CHECK_GROUPS: CheckGroup[] = ['Stability', 'Steering', 'Braking', 'Structure', 'Mass & transport'];

/** One numeric criterion inside a check (e.g. bending, shear, deflection). */
export interface Detail {
  name: string;
  value: number;
  unit: string;
  limit: number;
  sense: '>=' | '<=';
  /** Demand / capacity (1 = at the limit; > 1 fails). */
  util: number;
}

/** The evaluated result for one rider case. */
export interface CaseResult {
  load: LoadKind;
  value: number;
  unit: string;
  limit: number;
  status: Status;
  /** Demand / capacity (1 = at the limit). */
  util: number;
  sense: '>=' | '<=';
}

export interface AnalysisCheck extends CheckResult {
  group: CheckGroup;
  /** Status at the operating rider and at the goal rider, for the summary counts. Equal to `status` for single-case rows. */
  statusOperating: Status;
  statusGoal: Status;
  /** Per-case values, for rows evaluated at both riders. */
  cases?: { operating?: CaseResult; goal?: CaseResult; /** Lightest-rider case (BRIEF §4.1), for rows that get worse with a lighter rider. */ light?: CaseResult };
  /** The case whose result sets the row status (worst status, then highest utilization). */
  governingLoad?: LoadKind;
  /** Highest demand / capacity over the evaluated cases (1 = at the limit). */
  util?: number;
  /** True when the operating case passes but the goal rider fails (status is then 'fail', D-1). */
  goalFlag?: boolean;
  /** All criteria evaluated in the governing case (structure rows). */
  details?: Detail[];
}

const EPS = 1e-9;

/**
 * pass / marginal / fail for a value against a limit. 'marginal' = passes by less than 10% of the limit
 * (or by less than `marginalAbs` when the limit is 0 or a different margin applies).
 */
export function judge(value: number, limit: number, sense: '>=' | '<=', marginalAbs?: number): Status {
  if (!Number.isFinite(value)) return 'fail';
  const ok = sense === '>=' ? value >= limit - EPS : value <= limit + EPS;
  if (!ok) return 'fail';
  const m = marginalAbs ?? Math.abs(limit) * 0.1;
  const comfortable = sense === '>=' ? value >= limit + m : value <= limit - m;
  return comfortable ? 'pass' : 'marginal';
}

/** Demand / capacity ratio. */
export function utilization(value: number, limit: number, sense: '>=' | '<='): number {
  if (sense === '<=') return limit > 0 ? value / limit : value > 0 ? Infinity : 0;
  return value > 0 ? limit / value : Infinity;
}

export const SEVERITY: Record<Status, number> = { info: 0, pass: 1, marginal: 2, fail: 3 };
export const worst = (a: Status, b: Status): Status => (SEVERITY[a] >= SEVERITY[b] ? a : b);

/** Group of each check id, for callers holding plain `CheckResult`s. */
export const GROUP_OF_ID: Record<string, CheckGroup> = {
  'mass-empty': 'Mass & transport', cg: 'Mass & transport', 'truck-fit': 'Mass & transport',
  'tip-straight': 'Stability', 'tip-lock': 'Stability', 'slide-before-tip': 'Stability', 'v-rollover': 'Stability', 'pitch-fwd': 'Stability', 'pitch-rear': 'Stability',
  'turn-radius': 'Steering', 'steer-clear': 'Steering', 'steer-kin': 'Steering', 'steer-lock': 'Steering', 'steer-centering': 'Steering', 'ride-steer-effort': 'Steering',
  'ride-rollover': 'Stability', 'ride-envelope': 'Braking', 'brake-stop': 'Braking', 'brake-emergency': 'Braking', 'brake-heat': 'Braking', 'brake-bias': 'Braking', 'park-hold': 'Braking', 'brake-front': 'Structure', 'hip-cable': 'Structure', 'belt-anchor': 'Structure',
  'spindle-stub': 'Structure', 'spindle-fatigue': 'Structure', 'kingpin-bolt': 'Structure', 'kingpin-bracket': 'Structure', 'wheel-retention': 'Structure',
  'tie-rod': 'Structure', 'drag-link': 'Structure', bellcrank: 'Structure', 'steer-stop-load': 'Structure', 'tongue-tie': 'Structure', 'stick-cable': 'Structure',
  'brake-force': 'Braking', 'brake-traction': 'Braking', 'brake-ratio': 'Braking', 'brake-clear': 'Braking',
  'brake-lever': 'Structure', 'brake-links': 'Structure', 'brake-shaft': 'Structure', 'brake-shoes': 'Structure', 'brake-ratchet': 'Structure', 'handle-sockets': 'Structure',
  'axle-stress': 'Structure', 'beam-front': 'Structure', 'beam-rear': 'Structure', 'bearing-groove': 'Structure', rails: 'Structure', deck: 'Structure',
  tongue: 'Structure',
  // Workstream D (seat, storage, fittings)
  'seat-back': 'Structure', 'seat-grip': 'Structure', 'storage-pack': 'Structure', 'storage-lid-open': 'Structure', 'lash-points': 'Structure', lift: 'Structure', 'foot-stop': 'Structure', 'lash-load': 'Structure',
};
