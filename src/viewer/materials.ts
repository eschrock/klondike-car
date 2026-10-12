import * as THREE from 'three';
import type { Part } from '../model/types';
import { mannequinMaterial } from './mannequin';
import { oakEndTexture, pebbleBump, plyEdgeTexture, signTexture, woodTextures, type SignShape } from './textures';

/** What a part looks like. The viewer reads `part.finish.surface` first, then falls back to the material name (D-44). */
export type Surface = 'oak' | 'okoume' | 'vinyl' | 'rubber' | 'steel' | 'aluminum' | 'asa' | 'rope' | 'blackened';
/** 'sign' = painted side sign (review r1 MUST 4); 'mannequin' = rider and cargo; 'jig' = shop aids such as a lamination form. */
export type Look = Surface | 'truck' | 'ground' | 'sign' | 'mannequin' | 'jig' | 'other';

/** Pushes solid surfaces back a hair so the edge lines drawn on top never z-fight. */
const SOLID = { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } as const;

/** Shop aids (jigs, forms): fabricated reference parts, unlike the rider and cargo figures, which are `fab: 'none'`. */
export const isShopAid = (part: Part): boolean => (part.group === 'reference' || part.kind === 'reference') && part.fab !== 'none';

export function lookOf(part: Part): Look {
  if (part.id === 'truck-ground') return 'ground';
  if (part.body === 'truck') return 'truck';
  if (part.group === 'reference' || part.kind === 'reference') return isShopAid(part) ? 'jig' : 'mannequin';
  if (part.partNo === 'sign') return 'sign';
  const f = part.finish?.surface;
  if (f) return f;
  if (part.geometry.type === 'wheel') return 'rubber';
  if (part.kind === 'printed') return 'asa';
  const mat = part.material.toLowerCase();
  if (mat.includes('rope')) return 'rope';
  // D-56 front end: the tongue plate and the kingpin bolt are blackened (powder-coated) steel; the brake lever's grip is oak.
  const tag = `${part.id} ${part.name}`.toLowerCase();
  if (/bridle-tongue|kingpin/.test(tag)) return 'blackened';
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
      // Oiled, satin stain (roughness ~0.6). Vertex colors carry the per-part tint jitter (see `tintJitter` in partMesh).
      const long = new THREE.MeshStandardMaterial({
        color: 0xffffff, map: t.map, bumpMap: t.bump, bumpScale: oak ? 0.6 : 0.3, roughnessMap: t.bump, roughness: oak ? 0.68 : 0.64, vertexColors: true, ...SOLID,
      });
      const end = new THREE.MeshStandardMaterial({
        color: 0xffffff, map: oak ? oakEndTexture() : plyEdgeTexture(), roughness: 0.8, vertexColors: true, ...SOLID,
      });
      m = [long, end];
      break;
    }
    case 'vinyl':
      // Marine vinyl: a lighter near-black, a low pebble bump, sheen. Vertex colors darken the stitching and tint the piping.
      m = new THREE.MeshPhysicalMaterial({
        color: 0x181a1d, roughness: 0.45, bumpMap: pebbleBump('vinyl'), bumpScale: 0.18, vertexColors: true,
        sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x4a5058), clearcoat: 0.2, clearcoatRoughness: 0.4, ...SOLID,
      });
      break;
    case 'rubber':
      m = new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.9, bumpMap: pebbleBump('rubber'), bumpScale: 0.5, ...SOLID });
      break;
    case 'steel':
      // Round 3 (review r2 MUST 2): a believable zinc / stainless steel, not a mirror (a mirror reads as flat gray under a room map).
      m = new THREE.MeshStandardMaterial({ color: 0x7c8288, roughness: 0.35, metalness: 0.9, ...SOLID });
      break;
    case 'blackened':
      // Black-oxide / powder-coated steel: the tongue plate and the kingpin.
      m = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5, metalness: 0.75, ...SOLID });
      break;
    case 'aluminum':
      m = new THREE.MeshStandardMaterial({ color: 0xa9aeb5, roughness: 0.5, metalness: 1, ...SOLID }); // brushed, not mirror-white (3c-5: the handle sockets read as white plates)
      break;
    case 'asa':
      // Printed ASA, round 3: dark charcoal satin plastic (was safety orange, which read as unstained wood; review r2 MUST 1).
      m = new THREE.MeshStandardMaterial({ color: 0x1e1a17, roughness: 0.5, bumpMap: pebbleBump('rubber'), bumpScale: 0.08, ...SOLID }); // 3c round 2: a warm black satin (the clip read as a gray block against the oak)
      break;
    case 'truck':
      m = new THREE.MeshStandardMaterial({ color: 0x8f9bb0, transparent: true, opacity: 0.35, roughness: 0.7, depthWrite: false, side: THREE.DoubleSide });
      break;
    case 'ground':
      m = new THREE.MeshStandardMaterial({ color: 0x7f8a7a, roughness: 1, side: THREE.DoubleSide });
      break;
    case 'mannequin': // rider: a dark translucent navy ghost (3c visual round 2; was solid gray boxes). The cargo crate has its own tan material (mannequin.ts).
      m = mannequinMaterial();
      break;
    case 'jig': // shop aids: neutral gray, clearly a jig (faint fill plus wireframe), never saturated blue
      m = new THREE.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.35, wireframe: true, depthWrite: false });
      break;
    default:
      m = new THREE.MeshStandardMaterial({ color: 0x70757b, roughness: 0.55, ...SOLID });
  }
  cache.set(look, m);
  return m;
}

/** Wheel parts (D-44, round 2): a mid-gray dished rim against a pure black tire, a lighter bead ring and spokes, brass hub caps. */
let wheelSet: { rim: THREE.Material; brass: THREE.Material; hub: THREE.Material; bead: THREE.Material; lug: THREE.Material } | undefined;
export function wheelMaterials(): { rim: THREE.Material; brass: THREE.Material; hub: THREE.Material; bead: THREE.Material; lug: THREE.Material } {
  wheelSet ??= {
    rim: new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.5, metalness: 0.55, ...SOLID }),
    bead: new THREE.MeshStandardMaterial({ color: 0xa4aab2, roughness: 0.32, metalness: 0.95, ...SOLID }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb98f4a, roughness: 0.32, metalness: 1, ...SOLID }),
    hub: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 1, ...SOLID }),
    // Lug tops a touch lighter, like dusty tread.
    lug: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.92, bumpMap: pebbleBump('rubber'), bumpScale: 0.5, ...SOLID }),
  };
  return wheelSet;
}

/**
 * Painted sign face (forest green, cream lettering) at the sign's aspect ratio. Index 1 is the plywood edge for the rim.
 * The texture is keyed by aspect, so dragging the sign length makes new ones: only the four most recent are kept.
 */
const signCache = new Map<string, THREE.Material[]>();
export function signMaterials(aspect: number, shape: SignShape = 'oval'): THREE.Material[] {
  const key = `${shape}:${(Math.round(aspect * 10) / 10).toFixed(1)}`;
  let m = signCache.get(key);
  if (!m) {
    const edge = (materialsFor('okoume') as THREE.Material[])[1];
    m = [new THREE.MeshStandardMaterial({ color: 0xffffff, map: signTexture(aspect, shape), roughness: 0.62, ...SOLID }), edge];
    signCache.set(key, m);
    for (const [k, old] of signCache) {
      if (signCache.size <= 4) break;
      if (k === key) continue;
      (old[0] as THREE.MeshStandardMaterial).map?.dispose();
      old[0].dispose();
      signCache.delete(k);
    }
  }
  return m;
}

/** Ply-edge line material shared by every sweep (bent lamination). */
export const PLY_LINE_MAT = new THREE.LineBasicMaterial({ color: 0x6b4a22, transparent: true, opacity: 0.55 });
/** Red tint for sheet parts that have an exposed ply edge (Advanced only). */
export const EXPOSED_MAT = new THREE.MeshStandardMaterial({ color: 0xe0443a, roughness: 0.75, side: THREE.DoubleSide });
/** Outline pass: dark, low opacity so it keeps the drawing crisp without fighting the textures. */
export const EDGE_MAT = new THREE.LineBasicMaterial({ color: 0x1b1208, transparent: true, opacity: 0.5 }); // D-65: 0.28 was too faint to see the toggle work
