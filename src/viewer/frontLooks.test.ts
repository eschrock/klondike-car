import { describe, expect, it } from 'vitest';
import type { Part } from '../model/types';
import { tubeAlong } from '../model/mesh-utils';
import { lookOf } from './materials';
import { buildPart } from './partMesh';

const base = { group: 'steering', kind: 'purchased', material: 'steel', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], body: 'chassis', massLb: 1, fab: 'buy', step: 4 } as unknown as Part;
const mesh = (id: string, name: string, material: string): Part => {
  const m = tubeAlong([[0, 0, 0], [5, 0, 0], [10, 2, 0]], 0.0625, 8);
  return { ...base, id, name, material, geometry: { type: 'mesh', positions: m.positions, indices: m.indices } } as unknown as Part;
};

describe('Phase 3b front-end looks (spec 8.1)', () => {
  it('cables are drawn (a cable is not rope) in a bright stainless look', () => {
    const cable = mesh('stick-cable-A', 'Stick cable A', '1/8" 7x19 stainless cable');
    expect(lookOf(cable)).toBe('cable');
    expect(buildPart(cable)).not.toBeNull();
    // A real rope is still not drawn.
    expect(buildPart(mesh('bridle', 'Bridle', '3/8" polyester rope'))).toBeNull();
  });

  it('kart spindles and kingpin bolts are blackened steel; the spindle mesh renders', () => {
    const sp = mesh('spindle-L', 'Kart spindle (left)', 'forged steel spindle');
    expect(lookOf(sp)).toBe('blackened');
    expect(lookOf(mesh('kingpin-bolt-R', 'Kingpin bolt', 'grade 8 steel'))).toBe('blackened');
    const built = buildPart(sp);
    expect(built).not.toBeNull();
    expect(built!.geometry.getAttribute('position').count).toBeGreaterThan(10);
  });

  it('the stick grip is rubber, the lap belt is webbing, the beam tube and tie rod stay steel', () => {
    expect(lookOf(mesh('stick-grip', 'Stick grip', 'rubber grip'))).toBe('rubber');
    expect(lookOf(mesh('lap-belt', 'Lap belt', 'nylon webbing'))).toBe('webbing');
    expect(lookOf(mesh('beam-F', 'Front beam', 'A500 steel tube'))).toBe('steel');
    expect(lookOf(mesh('tie-rod', 'Tie rod', '1/2" threaded steel rod'))).toBe('steel');
    expect(lookOf(mesh('cable-guide-R', 'Cable guide', 'printed ASA'))).not.toBe('cable');
  });
});
