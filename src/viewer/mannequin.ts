/**
 * Rider mannequin and cargo crate (Phase 3c visual round 2, review MUST 1). The model draws the rider as boxes (pelvis, torso, head, thighs, shins, feet) and the
 * cargo as one box; the viewer draws each one INSIDE its box so mass, CG and bounds are untouched:
 *  - head: an ellipsoid; limbs (thigh, shin): capsules along the box's longest axis; torso, pelvis, feet: heavily rounded boxes;
 *  - all of them one dark, translucent navy (a "ghost" that shows the sled through it, never a block that hides the build);
 *  - cargo: a low tan crate with two darker straps and an olive duffel lashed on top (the load's real envelope is tall), opaque so it reads as a thing on the bed.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec3 } from '../model/types';
import { roundedBoxMesh } from './shapes';

export const MANNEQUIN_OPACITY = 0.55;

export type FigureKind = 'head' | 'limb' | 'block' | 'cargo';

/** Which drawing a rider / cargo part gets, from its id. */
export function figureKindOf(id: string): FigureKind {
  if (id === 'cargo') return 'cargo';
  if (id === 'rider-head') return 'head';
  if (/^rider-(thigh|shin)/.test(id)) return 'limb';
  return 'block';
}

let ghost: THREE.Material | undefined;
let crate: THREE.Material | undefined;
let strap: THREE.Material | undefined;
let duffelMat: THREE.Material | undefined;
const SOLID = { side: THREE.DoubleSide } as const;

export function mannequinMaterial(): THREE.Material {
  ghost ??= new THREE.MeshStandardMaterial({ color: 0x22386a, roughness: 0.7, transparent: true, opacity: MANNEQUIN_OPACITY, depthWrite: false, ...SOLID });
  return ghost;
}
function crateMaterials(): THREE.Material[] {
  crate ??= new THREE.MeshStandardMaterial({ color: 0xc4a266, roughness: 0.8, ...SOLID });
  strap ??= new THREE.MeshStandardMaterial({ color: 0x6f5630, roughness: 0.75, ...SOLID });
  duffelMat ??= new THREE.MeshStandardMaterial({ color: 0x6f7552, roughness: 0.9, ...SOLID });
  return [crate, strap, duffelMat];
}

const finish = (g: THREE.BufferGeometry, center: Vec3): THREE.BufferGeometry => {
  g.translate(center[0], center[1], center[2]);
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  return g;
};

function rawToGeometry(m: { positions: number[]; normals: number[]; indices: number[] }): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3));
  g.setIndex(m.indices);
  return g;
}

/** A capsule along local axis `axis` that fills `size` (elliptical across, round caps), centered on `center`. */
export function capsuleGeometry(size: Vec3, axis: 0 | 1 | 2, center: Vec3): THREE.BufferGeometry {
  const a = size[axis];
  const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
  const r0 = Math.max(1e-3, Math.min(size[u], size[v]) / 2);
  const len = Math.max(0, a - 2 * r0);
  const cap = new THREE.CapsuleGeometry(r0, len, 6, 20); // along Y
  const ss: Vec3 = [1, 1, 1];
  ss[0] = size[v] / (2 * r0);
  ss[2] = size[u] / (2 * r0);
  cap.scale(ss[0], 1, ss[2]);
  // Y -> `axis`; the two cross scales go to u and v. A cyclic permutation (y,z,x) keeps it a rotation.
  const pos = cap.getAttribute('position') as THREE.BufferAttribute;
  const nrm = cap.getAttribute('normal') as THREE.BufferAttribute;
  const remap = (attr: THREE.BufferAttribute): void => {
    for (let i = 0; i < attr.count; i++) {
      const x = attr.getX(i), y = attr.getY(i), z = attr.getZ(i);
      const o: Vec3 = [0, 0, 0];
      o[axis] = y; o[u] = z; o[v] = x; // (x, y, z) -> (v, axis, u): cyclic for axis 0, 1, 2 (u = axis + 1, v = axis + 2)
      attr.setXYZ(i, o[0], o[1], o[2]);
    }
  };
  remap(pos);
  remap(nrm);
  return finish(cap, center);
}

/** Geometry (and, for the cargo, two material groups: crate then straps) for one rider / cargo part, inside its local box. */
export function figureGeometry(kind: FigureKind, size: Vec3, center: Vec3): THREE.BufferGeometry {
  const minD = Math.min(size[0], size[1], size[2]);
  switch (kind) {
    case 'head': {
      const s = new THREE.SphereGeometry(1, 24, 16);
      s.scale(size[0] / 2, size[1] / 2, size[2] / 2);
      return finish(s, center);
    }
    case 'limb': {
      const axis = (size[0] >= size[1] && size[0] >= size[2] ? 0 : size[1] >= size[2] ? 1 : 2) as 0 | 1 | 2;
      return capsuleGeometry(size, axis, center);
    }
    case 'block':
      return finish(rawToGeometry(roundedBoxMesh(size, minD * 0.46, 6)), center);
    case 'cargo': {
      // The model's load is a tall strapped envelope (D-53: CG 12 in up), so it is drawn as what a camp load is: a low tan crate on the bed with a duffel lashed on top, both inside the box.
      const [lx, wy, hz] = size;
      const crateH = hz * 0.5, duffH = hz * 0.46;
      const r = Math.min(0.8, crateH * 0.15);
      const body = finish(rawToGeometry(roundedBoxMesh([lx * 0.985, wy * 0.985, crateH * 0.985], r, 4)), [0, 0, -hz / 2 + crateH / 2]);
      const bands: THREE.BufferGeometry[] = [];
      for (const fx of [-0.28, 0.28]) {
        bands.push(finish(rawToGeometry(roundedBoxMesh([Math.min(1.2, lx * 0.12), wy, crateH], 0.12, 2)), [fx * lx, 0, -hz / 2 + crateH / 2]));
      }
      const duffel = capsuleGeometry([lx * 0.8, wy * 0.92, duffH], 1, [0, 0, hz / 2 - duffH / 2]);
      const g = mergeGeometries([body, mergeGeometries(bands, false)!, duffel], true)!;
      g.translate(center[0], center[1], center[2]);
      return g;
    }
  }
}

export function figureMaterial(kind: FigureKind): THREE.Material | THREE.Material[] {
  return kind === 'cargo' ? crateMaterials() : mannequinMaterial();
}
