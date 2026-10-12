/**
 * Phase 3c-5: the lamps, reflectors and the brake hinge are drawn as real things inside their part boxes (lights.ts). Headless: the reflector's prism texture needs a canvas, so a
 * tiny stand-in for `document.createElement('canvas')` is installed (the texture only has to exist; the pixels are not read here).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { localBounds } from '../model/bounds';
import { hingeMesh, lampMesh, lightKindOf, reflectorMesh, tailLightMesh, type LightBuild } from './lights';
import { buildPart } from './partMesh';

beforeAll(() => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => undefined), set: () => true });
  (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
});

const parts = buildModel(defaultParams());
const get = (id: string) => parts.find((p) => p.id === id)!;

function within(b: LightBuild, size: [number, number, number], slack = 0.02): void {
  b.geometry.computeBoundingBox();
  const box = b.geometry.boundingBox!;
  for (let a = 0; a < 3; a++) {
    expect(box.min.getComponent(a)).toBeGreaterThanOrEqual(-size[a] / 2 - slack);
    expect(box.max.getComponent(a)).toBeLessThanOrEqual(size[a] / 2 + slack);
  }
  const groups = b.geometry.groups;
  expect(groups.length).toBe(b.materials.length);
  for (const g of groups) expect(g.materialIndex).toBeLessThan(b.materials.length);
}

describe('which parts get a real mesh', () => {
  it('the front lamp, the rear light, the four side reflectors (amber at the front, red at the rear) and the brake hinges', () => {
    expect(lightKindOf(get('front-light'))).toBe('lamp');
    expect(lightKindOf(get('rear-light'))).toBe('taillight');
    for (const tag of ['L', 'R']) {
      expect(lightKindOf(get(`reflector-${tag}1`)), `${tag} rear`).toBe('reflector-red');
      expect(lightKindOf(get(`reflector-${tag}2`)), `${tag} front`).toBe('reflector-amber');
      expect(lightKindOf(get(`brake-hinge-${tag}`))).toBe('hinge');
    }
    expect(lightKindOf(get('deck'))).toBeNull();
  });
});

describe('the meshes stay inside the part boxes', () => {
  const sizeOf = (id: string): [number, number, number] => {
    const b = localBounds(get(id).geometry);
    return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  };
  it('headlight: a housing, a chrome bezel, a glowing lens and the rear bracket', () => {
    const b = lampMesh(sizeOf('front-light'));
    within(b, sizeOf('front-light'));
    expect(b.materials.length).toBe(4);
    const lens = b.materials[2] as THREE.MeshPhysicalMaterial;
    expect(lens.emissiveIntensity).toBeGreaterThan(0.2); // it glows, faintly
    expect(lens.emissiveIntensity).toBeLessThan(1.2);
    const bezel = b.materials[1] as THREE.MeshStandardMaterial;
    expect(bezel.metalness).toBeGreaterThan(0.9); // chrome
  });
  it('the lens end faces forward (+x): the front-most vertices are the lens', () => {
    const size = sizeOf('front-light');
    const b = lampMesh(size);
    b.geometry.computeBoundingBox();
    expect(b.geometry.boundingBox!.max.x).toBeGreaterThan(size[0] / 2 - 0.05);
    expect(b.geometry.boundingBox!.min.x).toBeCloseTo(-size[0] / 2, 1); // the bracket plate sits at the rear
  });
  it('rear light: a red lens facing -x on a small housing', () => {
    const size = sizeOf('rear-light');
    const b = tailLightMesh(size);
    within(b, size);
    const lens = b.materials[1] as THREE.MeshPhysicalMaterial;
    expect(lens.color.r).toBeGreaterThan(lens.color.g * 3);
    expect(lens.emissive.r).toBeGreaterThan(lens.emissive.g * 3);
    expect(lens.emissiveIntensity).toBeLessThan(1);
    b.geometry.computeBoundingBox();
    expect(b.geometry.boundingBox!.min.x).toBeCloseTo(-size[0] / 2, 1);
  });
  it('reflectors: a colored housing and a prismatic face with a clear-coat sheen, on the outside of each side', () => {
    for (const [id, kind] of [['reflector-L1', 'red'], ['reflector-L2', 'amber'], ['reflector-R1', 'red'], ['reflector-R2', 'amber']] as const) {
      const size = sizeOf(id);
      const outward: 1 | -1 = get(id).transform[13] >= 0 ? 1 : -1;
      const b = reflectorMesh(size, kind, outward);
      within(b, size, 0.01);
      const face = b.materials[1] as THREE.MeshPhysicalMaterial;
      expect(face.map).toBeTruthy();
      expect(face.clearcoat).toBeGreaterThan(0.5);
      b.geometry.computeBoundingBox();
      // the face sits on the outward side
      expect(outward > 0 ? b.geometry.boundingBox!.max.y : -b.geometry.boundingBox!.min.y).toBeGreaterThan(size[1] / 2 - 1e-6);
    }
    const red = (reflectorMesh([2, 0.25, 1], 'red', 1).materials[0] as THREE.MeshPhysicalMaterial).color;
    const amber = (reflectorMesh([2, 0.25, 1], 'amber', 1).materials[0] as THREE.MeshPhysicalMaterial).color;
    expect(red.r).toBeGreaterThan(red.g * 3);
    expect(amber.r).toBeGreaterThan(amber.b * 4);
    expect(amber.g).toBeGreaterThan(red.g * 3); // amber has green, red does not
  });
  it('brake hinge: two leaves and a knuckled barrel, with dark screw heads', () => {
    const size = sizeOf('brake-hinge-L');
    const b = hingeMesh(size);
    within(b, size, 0.1); // the barrel is a little thicker than the leaves
    expect(b.materials.length).toBe(2);
  });
});

describe('buildPart uses them', () => {
  it('returns multi-material meshes with no outline for the lamp, the rear light, a reflector and a hinge', () => {
    for (const id of ['front-light', 'rear-light', 'reflector-L1', 'reflector-R2', 'brake-hinge-L']) {
      const built = buildPart(get(id))!;
      expect(Array.isArray(built.material), id).toBe(true);
      expect(built.edges, id).toBeNull();
      expect(built.geometry.getAttribute('position').count, id).toBeGreaterThan(50);
    }
  });
});
