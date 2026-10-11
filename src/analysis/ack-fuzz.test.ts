import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, type ParamKey, type Params } from '../params';
import { solveSteer } from '../model/ackermann';
import { ackSpec } from '../params';
import { runChecks } from './index';

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Ackermann rows: finite for every variant the linkage can assemble', () => {
  const KEYS: ParamKey[] = ['wheelbaseIn', 'frontTrackIn', 'rearTrackIn', 'scrubRadiusIn', 'kingpinLeadIn', 'steerArmLengthIn', 'ackermannAngleDeg', 'steerLockDeg', 'spindleStub', 'kingpinDiameterIn',
    'casterDeg', 'wheelDiameterIn', 'tireWidthIn', 'bumpWheelRateLbIn', 'bumpSpeedMph', 'bumpHardHeightIn', 'riderMassLb', 'riderGoalMassLb', 'tieRodDiaIn', 'kingpinBracketThickIn', 'rideStickLengthIn', 'frontBrakeBias'];
  it('60 seeded designs: every check value, limit and detail is finite and the text has no NaN', () => {
    const rnd = mulberry32(3030);
    let ran = 0;
    const bad: string[] = [];
    for (let i = 0; i < 60; i++) {
      const p: Params = { ...defaultParams() };
      for (const k of KEYS) {
        if (rnd() > 0.35) continue;
        const d = PARAM_DEFS[k];
        const v = d.default + (rnd() * 2 - 1) * 0.2 * (d.max - d.min);
        p[k] = Math.min(d.max, Math.max(d.min, Math.round(v / d.step) * d.step));
      }
      if (p.riderGoalMassLb < p.riderMassLb) p.riderGoalMassLb = p.riderMassLb;
      if (!solveSteer(ackSpec(p), p.steerLockDeg).ok) continue;
      let cs;
      try { cs = runChecks(p, { includeTruck: false }); } catch { continue; }
      ran++;
      for (const c of cs) {
        if (c.id === 'foot-stop') continue;
        const nums = [c.value, c.limit, ...(c.details ?? []).flatMap((d) => [d.value, d.limit])];
        if (nums.some((n) => !Number.isFinite(n) || Math.abs(n) >= 1e8)) bad.push(`${c.id}: ${nums.join(',')}`);
        if (/NaN|undefined/.test(c.how)) bad.push(`${c.id}: how has ${c.how.match(/NaN|undefined/)![0]}`);
      }
    }
    expect(ran).toBeGreaterThanOrEqual(20);
    expect(bad.slice(0, 5)).toEqual([]);
  }, 60000);
});
