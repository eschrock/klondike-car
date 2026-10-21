import { describe, expect, it } from 'vitest';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { mortiseBoxes } from './part-drawings';

// Round-2 engineering review: the crossmember-8 face mortise in each rail met the bow-bulkhead end mortise. No two mortises in one part may meet.
describe('mortises', () => {
  for (const [name, p] of [['standard', defaultParams()], ['extreme', { ...defaultParams(), weatherSpec: 1 }]] as const) {
    it(`${name}: no two mortises in one part overlap`, () => {
      const parts = buildModel(p);
      const bad: string[] = [];
      for (const x of parts) {
        if (x.group === 'reference' || !(x.joints ?? []).some((j) => j.type === 'domino' || j.type === 'mortise-tenon')) continue;
        let boxes: ReturnType<typeof mortiseBoxes> = [];
        try { boxes = mortiseBoxes(x, parts, p); } catch { continue; }
        for (let i = 0; i < boxes.length; i++) for (let k = i + 1; k < boxes.length; k++) {
          const A = boxes[i], B = boxes[k];
          const ov = [0, 1, 2].every((ax) => Math.min(A.hi[ax], B.hi[ax]) - Math.max(A.lo[ax], B.lo[ax]) > 0.01);
          if (ov) bad.push(`${x.id}: ${A.key} meets ${B.key}`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});
