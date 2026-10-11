import { describe, expect, it } from 'vitest';
import { defaultParams, validateParams, type Params } from '../params';
import { runChecks } from '.';
import { RECOMMENDED } from '../../scripts/recommended';

describe('Phase 2 recommended configuration', () => {
  const p = { ...defaultParams(), ...RECOMMENDED } as Params;
  it('is validator-clean', () => {
    expect(validateParams(p).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('has no failing check at any rider case', () => {
    const fails = runChecks(p).filter((c) => [c.statusOperating, c.statusGoal, c.cases?.light?.status].includes('fail'));
    expect(fails.map((c) => c.id)).toEqual([]);
  });
});
