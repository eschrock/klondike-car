/** Mass, CG and truck-fit rows ("Mass & transport"). Mass is info only (D-21). */
import type { FitResult } from '../truck/fit';
import type { Ctx } from './context';
import { singleCheck } from './dual';
import { f } from './format';
import { staticAxleText } from './stability';
import type { AnalysisCheck } from './types';

export function massEmpty(ctx: Ctx): AnalysisCheck {
  const { p, loads } = ctx;
  const transport = loads.emptyMassLb - loads.removableLb;
  return singleCheck({
    id: 'mass-empty', label: 'Empty mass', group: 'Mass & transport', value: loads.emptyMassLb, unit: 'lb', limit: p.targetMassMaxLb, sense: '<=', info: true, load: 'empty',
    how: `Σ part masses, no rider or cargo = ${f(loads.emptyMassLb)} lb. Reported only (D-21: heavy design first; the ${p.targetMassMinLb}–${p.targetMassMaxLb} lb target belongs to the later lightweight variant). Transport configuration (removables off, D-9): ${f(transport)} lb = ${f(transport / 2)} lb per person for the two-person lift (D-7).`,
    refs: ['D-21', 'D-7', 'D-9'],
  });
}

export function cgCheck(ctx: Ctx): AnalysisCheck {
  const { loads } = ctx;
  const fmt = (c: { cg: number[]; massLb: number }) => `(${f(c.cg[0])}, ${f(c.cg[1], 2)}, ${f(c.cg[2], 2)}) in at ${f(c.massLb)} lb`;
  return singleCheck({
    id: 'cg', label: 'Center of gravity height (operating)', group: 'Mass & transport', value: loads.operating.cg[2], unit: 'in', limit: 0, sense: '<=', info: true, load: 'operating',
    how: `Mass-weighted centroid, x forward of the rear axle / y left / z above ground. Empty ${fmt(loads.empty)}; operating ${fmt(loads.operating)}; goal ${fmt(loads.goal)}. The rider is placed at the D-3 CG (9.5" above the seat, 4" ahead of the H-point). Static axle loads, operating: ${staticAxleText(ctx, loads.operating)}.`,
    refs: ['D-3', 'BRIEF §7'],
  });
}

/** Any fitting case in the 'removed' config; also reports the bridle-off config. */
export function truckFit(fit: FitResult): AnalysisCheck {
  const removed = fit.cases.filter((c) => c.config === 'removed');
  const fitting = removed.filter((c) => c.fits);
  const bridleOff = fit.cases.filter((c) => c.config === 'bridle-off' && c.fits);
  const best = [...fitting].sort((a, b) => b.minClearanceIn - a.minClearanceIn)[0];
  const modes = (cs: typeof removed) => (cs.length ? [...new Set(cs.map((c) => `${c.mode} (${c.orientation})`))].join(', ') : 'none');
  return singleCheck({
    id: 'truck-fit', label: 'Truck fit, transport configuration', group: 'Mass & transport', value: fitting.length, unit: 'cases', limit: 1, sense: '>=',
    status: fitting.length >= 1 ? 'pass' : 'fail', load: 'empty',
    how: `Bounding/collision check against the bed with the tailgate down, removables off: ${fitting.length} of ${removed.length} placements fit (${modes(fitting)})${best ? `; best clearance ${f(best.minClearanceIn, 2)}"` : ''}. Bridle rope off only: ${bridleOff.length ? `fits (${modes(bridleOff)})` : 'does not fit'}. Required clearance ${f(fit.requiredClearanceIn, 2)}".`,
    refs: ['D-8', 'D-9', 'D-23'],
  });
}

export function truckSkipped(): AnalysisCheck {
  return singleCheck({
    id: 'truck-fit', label: 'Truck fit, transport configuration', group: 'Mass & transport', value: 0, unit: 'cases', limit: 1, sense: '>=', info: true, load: 'empty',
    how: 'Not evaluated in this run (truck fit is computed separately by the Truck fit tab).', refs: ['D-8', 'D-9', 'D-23'],
  });
}
