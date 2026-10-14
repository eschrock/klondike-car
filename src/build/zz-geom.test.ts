import { it } from 'vitest';
import { defaultParams } from '../params';
import { makeCtx } from '../model/build-utils';
import { brakeGeometry } from '../model/brake-layout';
it('g', () => {
  const p = { ...defaultParams(), kneeMount: 1 } as ReturnType<typeof defaultParams>;
  const c = makeCtx(p); const g = brakeGeometry(c.p, c.L);
  console.log('JSON' + JSON.stringify({ knee: { x0: g.knee.x0, zBot: g.knee.zBot, zTopLeg: g.knee.zTopLeg, legT: g.knee.legT }, rm: g.removable }));
});
