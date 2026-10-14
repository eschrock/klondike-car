import { describe, expect, it } from 'vitest';
import { defaultParams } from '../params';
import { createAnalysisClient } from './client';
import { handle } from './engine';

describe('analysis engine (the work the page hands to its worker)', () => {
  const p = defaultParams();
  it('answers a design request with plain, cloneable data', async () => {
    const r = await handle({ op: 'design', p });
    expect(r.rows.length).toBeGreaterThan(20);
    expect(r.fit.cases.length).toBe(8);
    expect(r.stats.cases).toHaveLength(3);
    expect(r.stats.emptyLb).toBeGreaterThan(r.stats.transportLb);
    expect(() => structuredClone(r)).not.toThrow();
  });
  it('answers the sweep and the cargo requests', async () => {
    const s = await handle({ op: 'sweep', p, range: { fromLb: 50, toLb: 250, stepLb: 10 } });
    expect(s.points).toHaveLength(21);
    expect(() => structuredClone(s)).not.toThrow();
    const c = await handle({ op: 'cargo', p });
    expect(c.capacityLb === null || c.capacityLb > 0).toBe(true);
    expect(() => structuredClone(c)).not.toThrow();
  }, 60000);
  it('the client falls back to the page thread when no worker can start', async () => {
    const client = createAnalysisClient(() => { throw new Error('no workers here'); });
    const r = await client.call({ op: 'design', p });
    expect(r.rows.length).toBeGreaterThan(20);
  });
});
