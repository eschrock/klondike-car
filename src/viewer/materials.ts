import * as THREE from 'three';
import type { Part } from '../model/types';
import { oakEndTexture, pebbleBump, plyEdgeTexture, ropeTexture, woodTextures } from './textures';

/** What a part looks like. The viewer reads `part.finish.surface` first, then falls back to the material name (D-44). */
export type Surface = 'oak' | 'okoume' | 'vinyl' | 'rubber' | 'steel' | 'aluminum' | 'asa' | 'rope';
export type Look = Surface | 'truck' | 'ground' | 'reference' | 'other';

/** Pushes solid surfaces back a hair so the edge lines drawn on top never z-fight. */
const SOLID = { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } as const;

export function lookOf(part: Part): Look {
  if (part.id === 'truck-ground') return 'ground';
  if (part.body === 'truck') return 'truck';
  if (part.group === 'reference' || part.kind === 'reference') return 'reference';
  const f = part.finish?.surface;
  if (f) return f;
  if (part.geometry.type === 'wheel') return 'rubber';
  if (part.kind === 'printed') return 'asa';
  const mat = part.material.toLowerCase();
  if (mat.includes('rope')) return 'rope';
  if (mat.includes('oak')) return 'oak';
  if (mat.includes('vinyl') || mat.includes('foam') || part.finish?.soft) return 'vinyl';
  if (mat.includes('ply') || part.kind === 'sheet') return 'okoume';
  if (mat.includes('alumin')) return 'aluminum';
  if (part.kind === 'metal' || part.group === 'hardware' || mat.includes('steel')) return 'steel';
  return 'other';
}

export const isWood = (l: Look): l is 'oak' | 'okoume' => l === 'oak' || l === 'okoume';

export type SurfaceMats = THREE.Material | THREE.Material[];
const cache = new Map<string, SurfaceMats>();

/** Material(s) for a look: wood is [long grain, end grain / ply edge], everything else is one material. */
export function materialsFor(look: Look): SurfaceMats {
  let m = cache.get(look);
  if (m) return m;
  switch (look) {
    case 'oak':
    case 'okoume': {
      const t = woodTextures(look);
      const oak = look === 'oak';
      const long = new THREE.MeshStandardMaterial({
        color: 0xffffff, map: t.map, bumpMap: t.bump, bumpScale: oak ? 0.8 : 0.4, roughnessMap: t.bump, roughness: oak ? 0.95 : 0.9, ...SOLID,
      });
      const end = new THREE.MeshStandardMaterial({
        color: 0xffffff, map: oak ? oakEndTexture() : plyEdgeTexture(), roughness: 0.95, ...SOLID,
      });
      m = [long, end];
      break;
    }
    case 'vinyl':
      m = new THREE.MeshPhysicalMaterial({
        color: 0x0f1012, roughness: 0.55, bumpMap: pebbleBump('vinyl'), bumpScale: 0.7,
        sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x30343c), clearcoat: 0.12, clearcoatRoughness: 0.55, ...SOLID,
      });
      break;
    case 'rubber':
      m = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.92, bumpMap: pebbleBump('rubber'), bumpScale: 0.5, ...SOLID });
      break;
    case 'steel':
      m = new THREE.MeshStandardMaterial({ color: 0xa4aab2, roughness: 0.38, metalness: 1, ...SOLID });
      break;
    case 'aluminum':
      m = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.42, metalness: 1, ...SOLID });
      break;
    case 'asa':
      m = new THREE.MeshStandardMaterial({ color: 0xf26a1b, roughness: 0.5, ...SOLID });
      break;
    case 'rope':
      m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: ropeTexture(), roughness: 0.95, ...SOLID });
      break;
    case 'truck':
      m = new THREE.MeshStandardMaterial({ color: 0x8f9bb0, transparent: true, opacity: 0.35, roughness: 0.7, depthWrite: false, side: THREE.DoubleSide });
      break;
    case 'ground':
      m = new THREE.MeshStandardMaterial({ color: 0x7f8a7a, roughness: 1, side: THREE.DoubleSide });
      break;
    case 'reference':
      m = new THREE.MeshStandardMaterial({ color: 0x4d8dff, transparent: true, opacity: 0.25, roughness: 0.6, depthWrite: false, side: THREE.DoubleSide });
      break;
    default:
      m = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.6, ...SOLID });
  }
  cache.set(look, m);
  return m;
}

/** Wheel parts (D-44): charcoal rim and brass hub cap (rubber comes from `materialsFor('rubber')`). */
let rim: THREE.Material | undefined;
let brass: THREE.Material | undefined;
let hubSteel: THREE.Material | undefined;
export function wheelMaterials(): { rim: THREE.Material; brass: THREE.Material; hub: THREE.Material } {
  rim ??= new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.45, metalness: 0.7, ...SOLID });
  brass ??= new THREE.MeshStandardMaterial({ color: 0xb98f4a, roughness: 0.32, metalness: 1, ...SOLID });
  hubSteel ??= new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 1, ...SOLID });
  return { rim, brass, hub: hubSteel };
}

/** Ply-edge line material shared by every sweep (bent lamination). */
export const PLY_LINE_MAT = new THREE.LineBasicMaterial({ color: 0x6b4a22, transparent: true, opacity: 0.55 });
/** Red tint for sheet parts that have an exposed ply edge (Advanced only). */
export const EXPOSED_MAT = new THREE.MeshStandardMaterial({ color: 0xe0443a, roughness: 0.75, side: THREE.DoubleSide });
/** Outline pass: dark, low opacity so it keeps the drawing crisp without fighting the textures. */
export const EDGE_MAT = new THREE.LineBasicMaterial({ color: 0x1b1208, transparent: true, opacity: 0.28 });
