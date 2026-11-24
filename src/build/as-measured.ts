/**
 * D-106, D-108: the bow bulkhead and the rear transom cut to the hull as measured, as extra files beside the design ones. The design (bowAsMeasured = 0) keeps the model and the build book; these two files are
 * the same part built with bowAsMeasured on: its Shaper file and a plywood template of it alone (the transom template is unchanged).
 */
import { bowWebAsBuilt, rearWebAsBuilt, type Params } from '../params';
import { buildModel } from '../model';
import { formDrawings } from './forms';
import { formLaserFile, type LaserFile } from './laser';
import { shaperFiles, type ShaperFile } from './shaper-svg';

export const AS_MEASURED_NOTE = 'Alternate: the bow bulkhead cut to the hull as measured (the web ends, the deck and the Dominos as built). Use it in place of the design bulkhead file; try its template on the hull first.';
export const REAR_AS_MEASURED_NOTE = 'Alternate: the rear transom cut to the hull as measured (the web ends and the rail Dominos as built, the 5/8" panel as made, reaching lower to cover the Dominos). Use it in place of the design transom file; try its template on the hull first.';

/** One end cut as measured: its Shaper file renamed, and a template of it alone. */
function endFiles(p: Params, q: Params, partId: string, templateId: string, fileName: string, title: string, note: string): { shaper: ShaperFile[]; laser: LaserFile[] } {
  void p;
  const parts = buildModel(q);
  const sf = shaperFiles(parts, q).find((f) => f.partIds.includes(partId));
  const shaper: ShaperFile[] = sf ? [{ ...sf, partNo: `${sf.partNo} (as measured)`, fileName: `${fileName}.svg`, alternate: note }] : [];
  const job = formDrawings(parts, q).find((f) => f.id === 'end-templates')?.laser?.[0];
  const items = job?.items.filter((i) => i.shape.id === templateId) ?? [];
  const laser: LaserFile[] = job && items.length
    ? [formLaserFile({ ...job, id: `${templateId}-as-measured`, title, items, notes: [note, ...job.notes] }, 'end-templates')]
    : [];
  return { shaper, laser };
}

/** D-106, D-108: the bow bulkhead and the rear transom as measured, each when it is measured and not already in the model. */
export function bowAsMeasuredFiles(p: Params): { shaper: ShaperFile[]; laser: LaserFile[] } {
  const out: { shaper: ShaperFile[]; laser: LaserFile[] } = { shaper: [], laser: [] };
  const bow: Params = { ...p, bowAsMeasured: 1 };
  if (p.bowAsMeasured !== 1 && bowWebAsBuilt(bow)) {
    const r = endFiles(p, bow, 'bow-bulkhead', 'bulkhead-template', 'bow-bulkhead-as-measured', 'Bow bulkhead template, as measured', AS_MEASURED_NOTE);
    out.shaper.push(...r.shaper); out.laser.push(...r.laser);
  }
  const rear: Params = { ...p, rearAsMeasured: 1 };
  if (p.rearAsMeasured !== 1 && rearWebAsBuilt(rear)) {
    const r = endFiles(p, rear, 'transom-rear', 'transom-template', 'transom-rear-as-measured', 'Rear transom template, as measured', REAR_AS_MEASURED_NOTE);
    out.shaper.push(...r.shaper); out.laser.push(...r.laser);
  }
  return out;
}
