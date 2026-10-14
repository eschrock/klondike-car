import { it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { partDrawings } from './part-drawings';
it('feat', () => {
  const p = { ...defaultParams(), kneeMount: 1 } as ReturnType<typeof defaultParams>;
  for (const s of partDrawings(buildModel(p), p)) {
    if (!/brake-tab|brake-knee$|brake-sleeve/.test(s.partNo)) continue;
    console.log('=== ' + s.partNo);
    for (const f of s.features) console.log('  ', f.kind, f.text.slice(0,330), JSON.stringify(f.positions));
  }
});
