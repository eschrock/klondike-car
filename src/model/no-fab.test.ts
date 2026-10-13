import { describe, expect, it } from 'vitest';
import { isMetalPart, noFabViolations } from './no-fab';
import type { Part } from './types';

const part = (o: Partial<Part>): Part => ({ id: 'x', name: 'x', group: 'brake', kind: 'metal', material: '304 stainless flat bar', geometry: { type: 'box', size: [1, 1, 1] }, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], body: 'chassis', massLb: 0.1, fab: 'drill-tap', step: 1, explode: [0, 0, 1], ...o } as Part);

describe('noFabViolations (D-77)', () => {
  it('passes a cut-and-drilled bar and a bought part, and lets a part state the rule in the negative', () => {
    expect(noFabViolations([part({ notes: 'Cut on the metal bandsaw, deburr, drill on the drill press. NO bending, welding, tapping, machining or countersinking; the strap is NOT countersunk.' })])).toEqual([]);
    expect(noFabViolations([part({ kind: 'purchased', fab: 'buy', material: '316 stainless clevis pin', notes: 'buy it' })])).toEqual([]);
  });
  it('flags each forbidden operation and a fab step beyond cut and drill', () => {
    const cases: Array<[Partial<Part>, RegExp]> = [
      [{ notes: 'Weld the tab on.' }, /welding/],
      [{ notes: 'Tap the hole 1/4-20.' }, /tapping/],
      [{ notes: 'Countersink the screw holes.' }, /countersinking/],
      [{ notes: 'Bend it to 90 degrees in a vise.' }, /bending/],
      [{ sourcing: { vendor: 'cut 2-1/2" pieces, file the corners round' } }, /filing/],
      [{ notes: 'round the ends' }, /shaping/],
      [{ notes: 'turn down the end on the lathe' }, /machining/],
      [{ fab: 'cnc' }, /fab 'cnc'/],
      [{ fab: 'outsource' }, /fab 'outsource'/],
    ];
    for (const [o, re] of cases) {
      const v = noFabViolations([part(o)]);
      expect(v.length, JSON.stringify(o)).toBeGreaterThan(0);
      expect(v.map((q) => q.why).join(' '), JSON.stringify(o)).toMatch(re);
    }
  });
  it('only metal parts are judged: oak and rubber may be bent, filed or routed', () => {
    expect(isMetalPart(part({ kind: 'lumber', material: 'white oak' }))).toBe(false);
    expect(isMetalPart(part({ kind: 'purchased', material: 'neoprene rubber sheet' }))).toBe(false);
    expect(noFabViolations([part({ kind: 'lumber', material: 'white oak', fab: 'bentlam', notes: 'bend it on the form' })])).toEqual([]);
  });
});
