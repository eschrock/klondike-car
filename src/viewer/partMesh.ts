import * as THREE from 'three';
import { localBounds } from '../model/bounds';
import type { Geometry, Mat4, Part, Vec3 } from '../model/types';
import { projectGrainUVs, maxAxis, minAxis, type Axis } from './grainUv';
import { hashString, mulberry32 } from './noise';
import { lookOf, isWood, materialsFor, wheelMaterials, type Look, type SurfaceMats } from './materials';
import { crownFace, roundedBoxMesh, type RawMesh } from './shapes';
import { buildSweepMesh } from './sweep';
import { WOOD_TILE_IN } from './textures';
import { buildWheelGeometry } from './wheel';

export interface BuiltPart {
  geometry: THREE.BufferGeometry;
  material: SurfaceMats;
  look: Look;
  /** Crisp outline of the part's sharp (un-rounded) shape; null for soft or smooth parts. */
  edges: THREE.BufferGeometry | null;
}

const EDGE_ANGLE_DEG = 30;
const wheelCache = new Map<string, THREE.BufferGeometry>();

/** Largest roundover that fits a box: under half of its thinnest dimension. */
export function clampRound(r: number, size: ArrayLike<number>): number {
  return Math.max(0, Math.min(r, Math.min(size[0], size[1], size[2]) * 0.49));
}

function rawToGeometry(m: RawMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3));
  g.setIndex(m.indices);
  return g;
}

/**
 * Extrusion with every outline edge rolled over by `r` while the outer bounds stay exact: the bevel runs from the
 * outline inset by r (bevelOffset = -r) out to the outline, and the straight part is shortened by 2r so the bevels
 * make up the depth.
 */
export function bevelledExtrusion(g: Extract<Geometry, { type: 'extrusion' }>, r: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(g.outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of g.holes ?? []) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const rr = Math.min(r, g.depth * 0.49);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: g.depth - 2 * rr, bevelEnabled: true, bevelThickness: rr, bevelSize: rr, bevelOffset: -rr, bevelSegments: 3, steps: 1,
  });
  geo.translate(0, 0, rr);
  return geo;
}

function plainExtrusion(g: Extract<Geometry, { type: 'extrusion' }>): THREE.BufferGeometry {
  const shape = new THREE.Shape(g.outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of g.holes ?? []) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return new THREE.ExtrudeGeometry(shape, { depth: g.depth, bevelEnabled: false });
}

/** Re-project a (possibly indexed) geometry with grain-aligned UVs and split it into long-grain / end-grain groups. */
function applyGrain(geo: THREE.BufferGeometry, part: Part, look: 'oak' | 'okoume' | 'vinyl', size: ArrayLike<number>, thickness: Axis, grain: Axis): THREE.BufferGeometry {
  const src = geo.index ? geo.toNonIndexed() : geo;
  if (src !== geo) geo.dispose();
  const rnd = mulberry32(hashString(part.id));
  const offset: [number, number] = [rnd(), rnd()];
  const vinyl = look === 'vinyl';
  const r = projectGrainUVs(src.getAttribute('position').array, src.getAttribute('normal').array, {
    grain, mode: vinyl ? 'plain' : look === 'okoume' ? 'ply' : 'solid', thicknessAxis: thickness,
    tile: vinyl ? { along: 8, across: 8, end: 8, ply: 8 } : WOOD_TILE_IN, offset,
  });
  void size;
  src.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(r.normals, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(r.uv, 2));
  const total = r.positions.length / 3;
  if (r.longVerts > 0) out.addGroup(0, r.longVerts, 0);
  if (total > r.longVerts) out.addGroup(r.longVerts, total - r.longVerts, 1);
  return out;
}

/** World-space direction of a local axis under a column-major transform. */
function worldAxis(m: Mat4, a: number): Vec3 {
  return [m[a * 4], m[a * 4 + 1], m[a * 4 + 2]];
}

export function buildPart(part: Part): BuiltPart | null {
  const g = part.geometry;
  const look = lookOf(part);
  const f = part.finish;
  const b = localBounds(g);
  const size: Vec3 = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const grain: Axis = part.grain ? ('xyz'.indexOf(part.grain) as Axis) : maxAxis(g.type === 'extrusion' ? [size[0], size[1], 0] : size);
  let edges: THREE.BufferGeometry | null = null;
  let geometry: THREE.BufferGeometry;
  let material: SurfaceMats = materialsFor(look);

  switch (g.type) {
    case 'box': {
      const soft = look === 'vinyl';
      const thin = minAxis(size);
      if (soft) {
        const t = size[thin];
        const r = Math.min(Math.max(t * 0.3, 0.2), 1.0, t * 0.49);
        const interior = size.map((s, a) => (a === thin ? 1 : Math.max(3, Math.min(15, Math.round(s / 2) | 1)))) as Vec3;
        const raw = roundedBoxMesh(size, r, 6, interior);
        const w = worldAxis(part.transform, thin);
        const sign: 1 | -1 = Math.abs(w[2]) > 0.5 ? (w[2] >= 0 ? 1 : -1) : w[0] >= 0 ? 1 : -1;
        crownFace(raw.positions, size, thin, sign, Math.min(0.55, t * 0.14));
        geometry = rawToGeometry(raw);
        geometry.computeVertexNormals();
        geometry = applyGrain(geometry, part, 'vinyl', size, thin, grain);
        break;
      }
      const r = clampRound(f?.roundoverIn ?? 0, size);
      geometry = r > 0.01 ? rawToGeometry(roundedBoxMesh(size, r, 4)) : new THREE.BoxGeometry(size[0], size[1], size[2]);
      if (isWood(look)) geometry = applyGrain(geometry, part, look, size, thin, grain);
      edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(size[0], size[1], size[2]), 1);
      break;
    }
    case 'cylinder': {
      const c = new THREE.CylinderGeometry(g.radius, g.radius, g.length, 32);
      c.rotateX(Math.PI / 2); // Three cylinders run along Y; ours run along Z.
      if (isWood(look)) {
        const uv = c.getAttribute('uv');
        const rnd = mulberry32(hashString(part.id));
        const [o1, o2] = [rnd(), rnd()];
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getY(i) * g.length) / WOOD_TILE_IN.along + o1, (uv.getX(i) * 2 * Math.PI * g.radius) / WOOD_TILE_IN.across + o2);
        material = [(material as THREE.Material[])[0], (material as THREE.Material[])[1], (material as THREE.Material[])[1]];
      } else if (look === 'rope') {
        const uv = c.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, (uv.getY(i) * g.length) / (g.radius * 5));
      }
      geometry = c;
      if (!f?.surface || look === 'steel') edges = new THREE.EdgesGeometry(c, 40);
      break;
    }
    case 'wheel': {
      const tread = f?.tread ?? 'lug';
      const key = `${g.diameter}|${g.width}|${g.hubDiameter}|${g.hubLength}|${tread}`;
      let w = wheelCache.get(key);
      if (!w) {
        w = buildWheelGeometry(g, tread);
        w.userData.shared = true;
        wheelCache.set(key, w);
      }
      geometry = w;
      const wm = wheelMaterials();
      const rubber = materialsFor('rubber') as THREE.Material;
      material = [rubber, rubber, wm.rim, wm.hub, wm.brass];
      break;
    }
    case 'extrusion': {
      const r = Math.min(f?.roundoverIn ?? 0, g.depth * 0.49);
      geometry = r > 0.01 ? bevelledExtrusion(g, r) : plainExtrusion(g);
      const thick: Axis = 2;
      if (isWood(look)) geometry = applyGrain(geometry, part, look, size, thick, part.grain ? grain : maxAxis([size[0], size[1], 0]));
      if (r > 0.01 || look !== 'other') {
        const sharp = plainExtrusion(g);
        edges = new THREE.EdgesGeometry(sharp, EDGE_ANGLE_DEG);
        sharp.dispose();
      }
      break;
    }
    case 'sweep': {
      const m = buildSweepMesh(g.path, g.width, g.thickness, g.plies);
      if (!m.positions.length) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
      geo.setIndex(m.indices);
      geo.computeVertexNormals(); // faces have their own vertices: smooth along the path, crisp across edges
      const rnd = mulberry32(hashString(part.id));
      const [o1, o2] = [rnd(), rnd()];
      const uv: number[] = [];
      for (let i = 0; i < m.uvs.length; i += 2) uv.push(m.uvs[i] / WOOD_TILE_IN.along + o1, m.uvs[i + 1] / WOOD_TILE_IN.across + o2);
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      if (m.plyLines.length) {
        const lines = new THREE.BufferGeometry();
        lines.setAttribute('position', new THREE.Float32BufferAttribute(m.plyLines, 3));
        geo.userData.plyLines = lines;
      }
      geometry = geo;
      if (isWood(look)) material = (material as THREE.Material[])[0];
      break;
    }
    case 'mesh': {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.positions, 3));
      if (g.indices) geo.setIndex(g.indices);
      geo.computeVertexNormals();
      geometry = geo;
      // Textured looks need UVs: box-map meshes that land on a wood / vinyl material (none do today).
      if (isWood(look) || look === 'vinyl' || look === 'rope') material = materialsFor('other');
      break;
    }
  }
  return { geometry, material, look, edges };
}
