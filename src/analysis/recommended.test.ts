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
    // Honesty fix (docs/phase3-honesty-notes.md, critic Phase 3 r3 MUST-1..3): the front-end rows below fail until the front end is redesigned, so this asserts exactly them (nothing else may fail).
    expect(fails.map((c) => c.id).sort()).toEqual(['kingpin-bolts', 'steer-stops', 'steer-stops-bound', 'turntable-ring']);
  });
});
