import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { localBounds } from '../model/bounds';
import type { Geometry, Mat4, Part, Vec3 } from '../model/types';
import { projectGrainUVs, maxAxis, minAxis, type Axis } from './grainUv';
import { hashString, mulberry32 } from './noise';
import { lookOf, isWood, materialsFor, signMaterials, wheelMaterials, type Look, type SurfaceMats } from './materials';
import { crownDrop, crownFace, roundedBoxMesh, type RawMesh } from './shapes';
import { densify, dashedLoop, insetLoop, mergeTubes, roundedLoop, tubeAlong, type TubeMesh, type Vec2 } from './upholstery';
import { lashPointMesh } from './hardware';
import { buildRoundedSweepMesh, buildSweepMesh } from './sweep';
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


/** Per-part tint jitter for wood: about +/-6% lightness and a hair of hue, from the id hash, carried in vertex colors. */
function tintJitter(id: string): [number, number, number] {
  const rnd = mulberry32(hashString(id) ^ 0x9e3779b9);
  const j = 1 + (rnd() - 0.5) * 0.12;
  return [j * (1 + (rnd() - 0.5) * 0.04), j, j * (1 + (rnd() - 0.5) * 0.08)];
}

/** Gives a geometry a `color` attribute (the wood / vinyl / sign materials read vertex colors): jittered for wood, white otherwise. */
function ensureColors(geo: THREE.BufferGeometry, id: string, wood: boolean): void {
  if (geo.getAttribute('color')) return;
  const n = geo.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  const [r, g, b] = wood ? tintJitter(id) : [1, 1, 1];
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

/** Welt and stitching as one merged tube mesh in local coordinates. */
const WELT_R_IN = 0.15;
const STITCH_R_IN = 0.04;
const STITCH_COLOR = 0x1c1c1e;
const THREAD_DARK = 0x2a2a2d;

interface TrimSpec {
  /** Plan outline of the part (counter-clockwise or clockwise), in the plane coordinates of `at`. */
  outline: Vec2[];
  /** Roundover radius of the pillow edge. */
  round: number;
  /** Height of the crowned top surface at a plan point, for a given offset down from the top (inches). */
  surface: (x: number, y: number, down: number) => number;
  /** Maps (x, y, height) to the part's local frame. */
  at: (x: number, y: number, h: number) => Vec3;
  /** Optional center channel from (x, y0) to (x, y1). */
  channel?: { x: number; y0: number; y1: number };
}

function upholsteryTrims(t: TrimSpec): TubeMesh {
  const list: TubeMesh[] = [];
  const dW = 0.293 * t.round; // the 45-degree point of the roundover sits this far in from the outline and down from the top
  const welt = insetLoop(t.outline, dW).map(([x, y]) => t.at(x, y, t.surface(x, y, dW) + WELT_R_IN * 0.35));
  list.push(tubeAlong(welt, WELT_R_IN, 0xffffff, true, 8));
  const stitchLoop = densify(insetLoop(t.outline, t.round + 0.45).map(([x, y]) => t.at(x, y, t.surface(x, y, 0) - 0.01)), 0.12);
  for (const dash of dashedLoop(stitchLoop, 0.32)) if (dash.length >= 2) list.push(tubeAlong(dash, STITCH_R_IN, STITCH_COLOR, false, 4));
  if (t.channel) {
    const { x, y0, y1 } = t.channel;
    const n = Math.max(2, Math.round((y1 - y0) / 0.5));
    const pts: Vec3[] = [];
    for (let i = 0; i <= n; i++) {
      const y = y0 + ((y1 - y0) * i) / n;
      pts.push(t.at(x, y, t.surface(x, y, 0) - 0.02));
    }
    list.push(tubeAlong(pts, 0.085, THREAD_DARK, false, 6));
  }
  return mergeTubes(list);
}

/** Pillow (non-indexed, with position / normal / uv) plus the trims, as one geometry with a `color` attribute. */
function withTrims(pillow: THREE.BufferGeometry, trims: TubeMesh): THREE.BufferGeometry {
  pillow.clearGroups();
  ensureColors(pillow, '', false);
  const tube = new THREE.BufferGeometry();
  tube.setAttribute('position', new THREE.Float32BufferAttribute(trims.positions, 3));
  tube.setAttribute('normal', new THREE.Float32BufferAttribute(trims.normals, 3));
  tube.setAttribute('color', new THREE.Float32BufferAttribute(trims.colors, 3));
  tube.setIndex(trims.indices);
  const flat = tube.toNonIndexed();
  tube.dispose();
  flat.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((flat.getAttribute('position').count) * 2), 2));
  const out = mergeGeometries([pillow, flat], false)!;
  pillow.dispose();
  flat.dispose();
  return out;
}

/** Soft (upholstered) extrusion, e.g. the seat-back pad: rolled edges, a crowned front face, welt, stitch line and center channel. */
function softExtrusion(g: Extract<Geometry, { type: 'extrusion' }>, part: Part): THREE.BufferGeometry {
  const r = Math.max(0.1, Math.min(0.9, g.depth * 0.45));
  let geo = bevelledExtrusion(g, r);
  const xs = g.outline.map((q) => q[0]), ys = g.outline.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const c: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, g.depth / 2];
  const size: Vec3 = [x1 - x0, y1 - y0, g.depth];
  const crown = Math.min(0.6, g.depth * 0.2);
  geo.translate(-c[0], -c[1], -c[2]);
  crownFace(geo.getAttribute('position').array as unknown as number[], size, 2, 1, crown);
  geo.translate(c[0], c[1], c[2]);
  geo.deleteAttribute('normal');
  geo = toCreasedNormals(geo, (50 * Math.PI) / 180);
  geo = applyGrain(geo, part, 'vinyl', size, 2, 0);
  const trims = upholsteryTrims({
    outline: g.outline as Vec2[], round: r,
    surface: (x, y, down) => g.depth - down - crownDrop(size, 2, g.depth / 2 - down, x - c[0], y - c[1], crown),
    at: (x, y, h) => [x, y, h],
    channel: { x: c[0], y0: y0 + r + 1.2, y1: y1 - r - 1.2 },
  });
  return withTrims(geo, trims);
}

/** World-space direction of a local axis under a column-major transform. */
function worldAxis(m: Mat4, a: number): Vec3 {
  return [m[a * 4], m[a * 4 + 1], m[a * 4 + 2]];
}

export function buildPart(part: Part): BuiltPart | null {
  const g = part.geometry;
  const look = lookOf(part);
  // Owner decision (round 3): rope is not drawn. The part stays in the model (mass, BOM, analysis), only the picture omits it.
  if (look === 'rope') return null;
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
      if (look === 'sign') {
        // Painted sign (review r1 MUST 4): the two big faces carry the painted texture, mapped right-reading as seen from
        // outside on both sides (the right sign is not a mirror image); the thin faces keep the ply-edge look.
        const [ua, va] = ([0, 1, 2] as const).filter((x) => x !== thin);
        const geo = applyGrain(rawToGeometry(roundedBoxMesh(size, Math.min(0.05, size[thin] * 0.3), 3)), part, 'okoume', size, thin, ua);
        const pos = geo.getAttribute('position'), nrm = geo.getAttribute('normal'), uv = geo.getAttribute('uv');
        const w = worldAxis(part.transform, thin)[1];
        const longVerts = geo.groups[0]?.count ?? 0;
        for (let i = 0; i < longVerts; i++) {
          const outward = (nrm.getComponent(i, thin) >= 0 ? 1 : -1) * Math.sign(w || 1); // +1: this face looks toward +Y (left)
          const x = pos.getComponent(i, ua) / size[ua];
          uv.setXY(i, 0.5 + (outward > 0 ? -x : x), 0.5 + pos.getComponent(i, va) / size[va]);
        }
        geometry = geo;
        material = signMaterials(size[ua] / size[va]);
        edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(size[0], size[1], size[2]), 1);
        break;
      }
      if (soft) {
        const t = size[thin];
        const r = Math.min(Math.max(t * 0.45, 0.3), 0.9, t * 0.49);
        const crown = Math.min(0.6, t * 0.18);
        const interior = size.map((s, a) => (a === thin ? 1 : Math.max(3, Math.min(15, Math.round(s / 2) | 1)))) as Vec3;
        const raw = roundedBoxMesh(size, r, 6, interior);
        const w = worldAxis(part.transform, thin);
        const sign: 1 | -1 = Math.abs(w[2]) > 0.5 ? (w[2] >= 0 ? 1 : -1) : w[0] >= 0 ? 1 : -1;
        crownFace(raw.positions, size, thin, sign, crown);
        geometry = rawToGeometry(raw);
        geometry.computeVertexNormals();
        geometry = applyGrain(geometry, part, 'vinyl', size, thin, grain);
        const [u, v] = [(thin + 1) % 3, (thin + 2) % 3];
        const trims = upholsteryTrims({
          outline: roundedLoop(size[u] / 2 - 0.293 * r, size[v] / 2 - 0.293 * r, 0.707 * r), round: r,
          surface: (x, y, down) => (size[thin] / 2 - down - crownDrop(size, thin as 0 | 1 | 2, size[thin] / 2 - down, x, y, crown)),
          at: (x, y, h) => { const p: Vec3 = [0, 0, 0]; p[u] = x; p[v] = y; p[thin] = sign * h; return p; },
        });
        geometry = withTrims(geometry, trims);
        break;
      }
      if (look === 'steel' && part.partNo === 'lash-point' && thin === 2 && maxAxis(size) === 0) {
        // D-ring on a bolt plate drawn inside the box (round 3, review r2 MUST 2); no cube outline.
        geometry = rawToGeometry(lashPointMesh(size));
        break;
      }
      // Hardware gets a small break on every edge (round 3): about 0.05" so brackets and plates are not razor cubes.
      const r = clampRound(f?.roundoverIn ?? (look === 'steel' || look === 'aluminum' ? 0.05 : 0), size);
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
      material = [rubber, wm.lug, wm.rim, wm.hub, wm.brass, wm.bead];
      break;
    }
    case 'extrusion': {
      const r = Math.min(f?.roundoverIn ?? 0, g.depth * 0.49);
      if (look === 'vinyl' && f?.soft) {
        geometry = softExtrusion(g, part);
        break;
      }
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
      // Round 4: the path may lie in plan (hull chine, gunwale, rail, web: local y is up, see the D-45 viewer notes), so nothing
      // here may assume the path rises in z. The mesh is built in local space and the part transform places it. Oak sweeps roll
      // over their long edges by the model's own `finish.roundoverIn` (D-44); both ends are flat end-grain caps (they butt a
      // transom or scarf into the next member). Okoume sweeps (the curved web) show ply edge on the two thin faces.
      const radius = f?.roundoverIn ?? 0;
      const m = radius > 0.01
        ? buildRoundedSweepMesh(g.path, g.width, g.thickness, g.plies, radius)
        : buildSweepMesh(g.path, g.width, g.thickness, g.plies, look === 'okoume');
      if (!m.positions.length) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
      geo.setIndex(m.indices);
      if ('normals' in m) geo.setAttribute('normal', new THREE.Float32BufferAttribute((m as { normals: number[] }).normals, 3));
      else geo.computeVertexNormals(); // faces have their own vertices: smooth along the path, crisp across edges
      const rnd = mulberry32(hashString(part.id));
      const [o1, o2] = [rnd(), rnd()];
      // Edge / end vertices (never shared with the long faces) get the end-grain or ply-edge tile; the rest the long-grain tile.
      const isEdgeVert = new Uint8Array(m.positions.length / 3);
      for (const [start, count] of m.edgeRanges) for (let k = start; k < start + count; k++) isEdgeVert[m.indices[k]] = 1;
      const tile = look === 'okoume' ? WOOD_TILE_IN.ply : WOOD_TILE_IN.end;
      const uv: number[] = [];
      for (let i = 0; i < m.uvs.length; i += 2) {
        if (isEdgeVert[i / 2]) uv.push(m.uvs[i] / tile + o1, m.uvs[i + 1] / tile + o2);
        else uv.push(m.uvs[i] / WOOD_TILE_IN.along + o1, m.uvs[i + 1] / WOOD_TILE_IN.across + o2);
      }
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      if (isWood(look) && m.edgeRanges.length) {
        // Group 0: long grain (everything not in an edge range); group 1: end grain / ply edge. Triangles are re-sorted.
        const edge = new Set<number>();
        for (const [start, count] of m.edgeRanges) for (let k = start; k < start + count; k += 3) edge.add(k);
        const longIdx: number[] = [], edgeIdx: number[] = [];
        for (let k = 0; k < m.indices.length; k += 3) (edge.has(k) ? edgeIdx : longIdx).push(m.indices[k], m.indices[k + 1], m.indices[k + 2]);
        geo.setIndex([...longIdx, ...edgeIdx]);
        geo.addGroup(0, longIdx.length, 0);
        geo.addGroup(longIdx.length, edgeIdx.length, 1);
      }
      if (m.plyLines.length) {
        const lines = new THREE.BufferGeometry();
        lines.setAttribute('position', new THREE.Float32BufferAttribute(m.plyLines, 3));
        geo.userData.plyLines = lines;
      }
      geometry = geo;
      break;
    }
    case 'mesh': {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.positions, 3));
      if (g.indices) geo.setIndex(g.indices);
      geo.computeVertexNormals();
      geometry = geo;
      // Textured looks need UVs: box-map meshes that land on a wood / vinyl material (none do today).
      if (isWood(look) || look === 'vinyl') material = materialsFor('other');
      break;
    }
  }
  if (isWood(look) || look === 'sign') ensureColors(geometry, part.id, true);
  else if (look === 'vinyl') ensureColors(geometry, part.id, false);
  return { geometry, material, look, edges };
}
