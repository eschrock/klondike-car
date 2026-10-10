/**
 * Storage box (D-19): a ply tray (bottom, 2 sides, 2 ends), a ply lid, and an oak rim under the lid that the walls
 * end on. Built from real panels so the cut list and mass are honest (critic M3); interior volume is set in layout.ts.
 */
import { STEP, box, span, type Ctx } from './build-utils';
import type { Part } from './types';

export function buildStorage(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const st = L.storage;
  const pl = p.panelPlyIn;
  const rimW = p.storageLidRimWidthIn;
  const rimT = p.storageLidRimThickIn;
  const x0 = st.x0, x1 = Math.max(st.x0 + 0.5, st.x1);
  const hw = st.hw;
  const zTop = Math.max(st.zBot + 3 * pl + rimT, st.zTop);
  const zWallTop = zTop - pl - rimT;
  const common = { group: 'storage', step: STEP.seatStorage } as const;
  const parts: Part[] = [];

  parts.push(box(ctx, { ...common, id: 'storage-bottom', name: 'Storage box bottom', mat: 'ply', edges: 'captured',
    ...span([x0, x1], [-hw, hw], [st.zBot, st.zBot + pl]),
    notes: `Interior volume target ${p.storageVolumeIn3} in³ (D-19).` }));
  for (const [tag, y] of [['L', hw - pl / 2], ['R', -(hw - pl / 2)]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-side-${tag}`, partNo: 'storage-side', name: `Storage box side ${tag}`, mat: 'ply', edges: 'captured',
      ...span([x0, x1], [y - pl / 2, y + pl / 2], [st.zBot + pl, zWallTop]) }));
  }
  for (const [tag, xa, xb] of [['aft', x0, x0 + pl], ['fore', x1 - pl, x1]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-end-${tag}`, partNo: 'storage-end', name: `Storage box ${tag} end`, mat: 'ply', edges: 'captured',
      ...span([xa, xb], [-(hw - pl), hw - pl], [st.zBot + pl, zWallTop]) }));
  }
  parts.push(box(ctx, { ...common, id: 'storage-lid', name: 'Storage lid panel', mat: 'ply', edges: 'edged',
    ...span([x0, x1], [-hw, hw], [zTop - pl, zTop]), notes: 'Ply lid; the oak rim under it seals the edge and gives the walls a seat.' }));
  // Oak rim under the lid, flush with the outside of the walls.
  const rz: [number, number] = [zTop - pl - rimT, zTop - pl];
  for (const [tag, y] of [['L', hw - rimW / 2], ['R', -(hw - rimW / 2)]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-rim-side-${tag}`, partNo: 'storage-rim-side', name: `Storage lid rim side ${tag}`, mat: 'oak', grain: 'x',
      ...span([x0, x1], [y - rimW / 2, y + rimW / 2], rz) }));
  }
  for (const [tag, xa, xb] of [['aft', x0, x0 + rimW], ['fore', x1 - rimW, x1]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-rim-end-${tag}`, partNo: 'storage-rim-end', name: `Storage lid rim ${tag} end`, mat: 'oak', grain: 'y',
      ...span([xa, xb], [-(hw - rimW), hw - rimW], rz) }));
  }
  return parts;
}
