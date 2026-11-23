/**
 * D-106: the bow bulkhead cut to the hull as measured, as extra files beside the design ones. The design (bowAsMeasured = 0) keeps the model and the build book; these two files are
 * the same part built with bowAsMeasured on: its Shaper file and a plywood template of it alone (the transom template is unchanged).
 */
import { bowWebAsBuilt, type Params } from '../params';
import { buildModel } from '../model';
import { formDrawings } from './forms';
import { formLaserFile, type LaserFile } from './laser';
import { shaperFiles, type ShaperFile } from './shaper-svg';

export const AS_MEASURED_NOTE = 'Alternate: the bow bulkhead cut to the hull as measured (the web ends, the deck and the Dominos as built). Use it in place of the design bulkhead file; try its template on the hull first.';

export function bowAsMeasuredFiles(p: Params): { shaper: ShaperFile[]; laser: LaserFile[] } {
  const q: Params = { ...p, bowAsMeasured: 1 };
  if (p.bowAsMeasured === 1 || !bowWebAsBuilt(q)) return { shaper: [], laser: [] };
  const parts = buildModel(q);
  const sf = shaperFiles(parts, q).find((f) => f.partIds.includes('bow-bulkhead'));
  const shaper: ShaperFile[] = sf ? [{ ...sf, partNo: `${sf.partNo} (as measured)`, fileName: 'bow-bulkhead-as-measured.svg', alternate: AS_MEASURED_NOTE }] : [];
  const job = formDrawings(parts, q).find((f) => f.id === 'end-templates')?.laser?.[0];
  const items = job?.items.filter((i) => i.shape.id === 'bulkhead-template') ?? [];
  const laser: LaserFile[] = job && items.length
    ? [formLaserFile({ ...job, id: 'bulkhead-template-as-measured', title: 'Bow bulkhead template, as measured', items, notes: [AS_MEASURED_NOTE, ...job.notes] }, 'end-templates')]
    : [];
  return { shaper, laser };
}
