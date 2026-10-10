/** Storage box (hollow ply shell + oak lid frame, D-19). Mass uses the shell area, not the box volume. */
import { STEP, box, woodMassLb, type Ctx } from './build-utils';
import type { Part } from './types';

// ── Block-model placeholders ──
/** Lid frame strip section (width × thickness). */
const LID_STRIP_W_IN = 1.5;
const LID_STRIP_T_IN = 0.75;

export function buildStorage(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const st = L.storage;
  const lx = Math.max(0.5, st.x1 - st.x0);
  const w = 2 * st.hw;
  const h = Math.max(0.5, st.zTop - st.zBot);
  const pl = p.panelPlyIn;
  // Five-sided shell (open top) of ply; the lid is an oak perimeter frame.
  const shellArea = lx * w + 2 * lx * h + 2 * w * h;
  const lidPerim = 2 * (lx + w);
  const lidVol = lidPerim * LID_STRIP_W_IN * LID_STRIP_T_IN;
  const lidArea = 2 * lidPerim * LID_STRIP_W_IN + lidPerim * LID_STRIP_T_IN;
  const mass =
    woodMassLb(p, shellArea * pl, 2 * shellArea, ctx.d.plyDensityPcf) + woodMassLb(p, lidVol, lidArea, p.oakDensityPcf);
  return [box(ctx, {
    id: 'storage-box', name: 'Storage box', group: 'storage', mat: 'fixed', massLb: mass, kind: 'sheet', material: `${ctx.plyName} + white oak lid frame`,
    fab: 'table-saw', step: STEP.seatStorage, edges: 'captured', stock: { t: pl, w, l: lx }, size: [lx, w, h],
    center: [(st.x0 + st.x1) / 2, 0, (st.zBot + st.zTop) / 2],
    notes: `Hollow: mass from shell area × panel thickness. Interior volume target ${p.storageVolumeIn3} in³ (D-19).`,
  })];
}
