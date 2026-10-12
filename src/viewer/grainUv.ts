/**
 * Grain-aligned UVs for wood (D-44). Pure arrays in, arrays out (no three.js), so it runs headless.
 *
 * Input is a non-indexed triangle soup. Each triangle is projected along its dominant normal axis (box mapping) so a
 * board's long faces get the grain running along the part's `grain` axis with no stretching, and the end faces (normal
 * along the grain, or any non-face edge of a ply sheet) get an end-grain / ply-edge mapping instead. Triangles come back
 * reordered: long-grain triangles first, then edge triangles, so the caller can make two geometry groups.
 */
export type Axis = 0 | 1 | 2;

export interface GrainUvOptions {
  /** Local axis the grain runs along. */
  grain: Axis;
  /**
   * 'solid': faces perpendicular to the grain are end grain. 'ply': only the two big faces (normal along
   * `thicknessAxis`) are veneer; every other face is a ply edge. 'plain': no end faces (e.g. vinyl), just box mapping.
   */
  mode: 'solid' | 'ply' | 'plain';
  thicknessAxis?: Axis;
  /** Inches covered by one texture repeat: along the grain, across it, and on end / edge faces. */
  tile: { along: number; across: number; end: number; ply: number };
  /** Per-part offset in tile units (seeded by the part id so neighbors differ). */
  offset: [number, number];
}

export interface GrainUvResult {
  positions: Float32Array;
  normals: Float32Array;
  uv: Float32Array;
  /** Vertex count of the long-grain range; the rest is end / edge. */
  longVerts: number;
}

export function projectGrainUVs(
  pos: ArrayLike<number>,
  nrm: ArrayLike<number>,
  o: GrainUvOptions,
): GrainUvResult {
  const tris = pos.length / 9;
  const edge = new Uint8Array(tris);
  const axisOf = new Uint8Array(tris);
  let nEdge = 0;
  for (let t = 0; t < tris; t++) {
    const n = [0, 0, 0];
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) n[a] += nrm[t * 9 + k * 3 + a];
    let ax: Axis = 0;
    if (Math.abs(n[1]) > Math.abs(n[ax])) ax = 1;
    if (Math.abs(n[2]) > Math.abs(n[ax])) ax = 2;
    axisOf[t] = ax;
    const isEdge = o.mode === 'solid' ? ax === o.grain : o.mode === 'ply' ? ax !== (o.thicknessAxis ?? 2) : false;
    edge[t] = isEdge ? 1 : 0;
    if (isEdge) nEdge++;
  }
  const out: GrainUvResult = {
    positions: new Float32Array(pos.length),
    normals: new Float32Array(nrm.length),
    uv: new Float32Array(tris * 6),
    longVerts: (tris - nEdge) * 3,
  };
  let iLong = 0;
  let iEdge = tris - nEdge;
  for (let t = 0; t < tris; t++) {
    const dst = edge[t] ? iEdge++ : iLong++;
    const ax = axisOf[t];
    for (let k = 0; k < 3; k++) {
      for (let a = 0; a < 3; a++) {
        out.positions[dst * 9 + k * 3 + a] = pos[t * 9 + k * 3 + a];
        out.normals[dst * 9 + k * 3 + a] = nrm[t * 9 + k * 3 + a];
      }
      const p = (a: number): number => pos[t * 9 + k * 3 + a];
      let u: number, v: number;
      if (!edge[t]) {
        // Long face: u along the grain, v across it. When the normal is the grain axis (plain mode), fall back to any axis.
        const along = ax === o.grain ? (ax + 1) % 3 : o.grain;
        const across = 3 - ax - along;
        u = p(along) / o.tile.along + o.offset[0];
        v = p(across) / o.tile.across + o.offset[1] + ax * 0.37;
      } else if (o.mode === 'ply') {
        const th = o.thicknessAxis ?? 2;
        const other = 3 - ax - th;
        u = p(other) / o.tile.end + o.offset[0];
        v = p(th) / o.tile.ply;
      } else {
        const a = (ax + 1) % 3;
        const b = (ax + 2) % 3;
        u = p(a) / o.tile.end + o.offset[0];
        v = p(b) / o.tile.end + o.offset[1];
      }
      out.uv[dst * 6 + k * 2] = u;
      out.uv[dst * 6 + k * 2 + 1] = v;
    }
  }
  return out;
}

/** Axis with the smallest / largest extent of a size or bounds triple. */
export function minAxis(size: ArrayLike<number>): Axis {
  return (size[0] <= size[1] && size[0] <= size[2] ? 0 : size[1] <= size[2] ? 1 : 2) as Axis;
}
export function maxAxis(size: ArrayLike<number>): Axis {
  return (size[0] >= size[1] && size[0] >= size[2] ? 0 : size[1] >= size[2] ? 1 : 2) as Axis;
}

/**
 * Grain axis used for DISPLAY (3c visual round 2). The model's `grain` is a cut-list note and is sometimes ambiguous for the picture (the bow bulkhead says y on a board that is 21 in
 * wide and 7 in tall; the handle posts say z, the thickness axis of their extrusion). The stripes must run along the board's long axis, so: keep the model's axis only when it is
 * (nearly, within 15%) the longest; otherwise use the longest. `planar` (extrusions: outline in x and y, thickness along z) never picks z.
 */
export function displayGrainAxis(modelGrain: Axis | undefined, size: ArrayLike<number>, planar: boolean): Axis {
  const dims = planar ? [size[0], size[1], -1] : [size[0], size[1], size[2]];
  const longest = maxAxis(dims);
  if (modelGrain !== undefined && dims[modelGrain] >= dims[longest] * 0.85) return modelGrain;
  return longest;
}
