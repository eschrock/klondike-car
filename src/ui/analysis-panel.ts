/**
 * Analysis panel (docs/phase2-spec.md "Analysis panel"): checks grouped Stability / Steering / Braking / Structure /
 * Mass & transport, each row with a status chip, value, limit and load case; click a row for the formula (`how`) and
 * refs. A summary line counts pass / marginal / fail at the operating and the goal rider, and a footnote lists the
 * material properties, factors and sources used (BRIEF §7).
 */
import { derived, type Params } from '../params';
import { CHECK_GROUPS, GROUP_OF_ID, type AnalysisCheck, type CaseResult, type CheckGroup, type Status } from '../analysis/types';
import type { CheckResult } from '../model/types';
import { h } from './dom';
import './analysis-panel.css';

export interface AnalysisPanel {
  update(p: Params, checks: CheckResult[]): void;
}

const CHIP: Record<Status, string> = { pass: 'PASS', marginal: 'MARG', fail: 'FAIL', info: 'INFO' };
const STATUS_WORD: Record<Status, string> = { pass: 'pass', marginal: 'marginal', fail: 'fail', info: 'info' };

type Row = Partial<AnalysisCheck> & CheckResult;

const groupOf = (c: Row): CheckGroup => c.group ?? GROUP_OF_ID[c.id] ?? 'Mass & transport';

/** Format a value with units sensibly for its magnitude. */
export function fmtNumber(v: number, unit: string): string {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  let dp: number;
  if (unit === 'psi' || unit === 'cases') dp = 0;
  else if (unit === 'in') dp = a < 1 ? 3 : 2;
  else if (unit === '°' || unit === 'mph' || unit === 'lb' || unit === 'lbf') dp = a >= 1000 ? 0 : 1;
  else if (unit === '×' || unit === '') dp = 2;
  else dp = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  const s = v.toFixed(dp);
  return a >= 1000 ? Number(s).toLocaleString('en-US', { maximumFractionDigits: 0 }) : s;
}

const unitText = (u: string) => (u === '°' || u === '' || u === '×' ? u : ` ${u}`);
const valueText = (v: number, unit: string) => `${fmtNumber(v, unit)}${unitText(unit)}`;

function limitText(c: { status: Status; limit: number; sense: '>=' | '<='; unit: string }): string {
  const isInfo = c.status === 'info';
  if (isInfo && c.limit === 0) return 'no limit (info)';
  const sym = c.sense === '>=' ? '≥' : '≤';
  return `${isInfo ? 'ref ' : ''}${sym} ${fmtNumber(c.limit, c.unit)}${unitText(c.unit)}`;
}

const LOAD_LABEL = { empty: "empty cart", operating: "operating rider", goal: "goal rider", light: "lightest rider", cargo: "cargo" } as const;

type CaseKey = 'operating' | 'goal' | 'light' | 'cargo';

/** Rider mass shown for each case. */
const riderOf = (p: Params, k: CaseKey) => (k === 'operating' ? p.riderMassLb : k === 'goal' ? p.riderGoalMassLb : k === 'cargo' ? p.cargoPayloadLb : p.riderMinMassLb);
/** Short name of a case's load for the chip: "150 lb" for a rider, "cargo 250 lb" for the payload (D-53). */
const caseWho = (p: Params, k: CaseKey) => (k === 'cargo' ? `cargo ${p.cargoPayloadLb} lb` : `${riderOf(p, k)} lb`);

/** The evaluated cases of a row in display order. */
function caseList(c: Row): [CaseKey, CaseResult][] {
  const out: [CaseKey, CaseResult][] = [];
  for (const k of ['operating', 'goal', 'light', 'cargo'] as CaseKey[]) {
    const r = c.cases?.[k];
    if (r) out.push([k, r]);
  }
  return out;
}

/** The case that sets the row status (worst status, then highest utilization): the value shown beside the chip comes from it (P1). */
function governingCase(c: Row): [CaseKey, CaseResult] | undefined {
  // The row status is the rider's (D-53): the cargo case only governs a row that has no rider case (the cargo-only rows).
  const all = caseList(c);
  const list = all.some(([k]) => k !== 'cargo') ? all.filter(([k]) => k !== 'cargo') : all;
  if (!list.length) return undefined;
  const sev: Record<Status, number> = { info: 0, pass: 1, marginal: 2, fail: 3 };
  return list.reduce((a, b) => (sev[b[1].status] > sev[a[1].status] || (sev[b[1].status] === sev[a[1].status] && b[1].util > a[1].util) ? b : a));
}

const pct = (u: number) => (Number.isFinite(u) ? `${Math.round(u * 100)}%` : '∞');

function counts(rows: Row[], key: 'statusOperating' | 'statusGoal') {
  const n: Record<Status, number> = { pass: 0, marginal: 0, fail: 0, info: 0 };
  for (const r of rows) n[r[key] ?? r.status]++;
  return n;
}

function countsCargo(rows: Row[]) {
  const n: Record<Status, number> = { pass: 0, marginal: 0, fail: 0, info: 0 };
  for (const r of rows) if (r.statusCargo) n[r.statusCargo]++;
  return n;
}

function countSpan(n: number, kind: 'pass' | 'marginal' | 'fail'): HTMLElement {
  return h('span', { class: `ap-count ${n === 0 ? 'zero' : kind}` }, `${n} ${kind}`);
}

const f0 = (x: number) => Math.round(x).toLocaleString('en-US');

function materials(p: Params, isOpen: boolean, onToggle: (o: boolean) => void): HTMLElement {
  const d = derived(p);
  const oakShear = (p.oakShearPsi * p.wetServiceFactorStrength) / p.woodSafetyFactor;
  const oakPerp = (p.oakCompPerpPsi * p.wetServiceFactorCompPerp) / p.woodSafetyFactor;
  const okoume = p.plySpecies === 0;
  const rows = (items: [string, string, string?][]) =>
    h('table', {}, ...items.map(([k, v, src]) => h('tr', {}, h('th', {}, k), h('td', {}, v), h('td', { class: 'src' }, src ?? ''))));
  const det = h('details', { class: 'ap-foot' },
    h('summary', {}, 'Material properties used'),
    h('div', {},
      h('h4', {}, 'White oak (D-4)'),
      rows([
        ['Density', `${p.oakDensityPcf} lb/ft³`, 'USDA FPL-GTR-282 Table 5-3a, 12% MC'],
        ['Bending MOR / MOE', `${f0(p.oakMorPsi)} psi / ${f0(p.oakMoePsi)} psi`, 'same table, clear wood'],
        ['Shear ∥ / comp. ∥ / comp. ⊥', `${f0(p.oakShearPsi)} / ${f0(p.oakCompParPsi)} / ${f0(p.oakCompPerpPsi)} psi`, 'same table'],
        ['Wet-service C_M', `${p.wetServiceFactorStrength} bending / shear, ${p.wetServiceFactorCompPerp} compression ⊥, ${p.wetServiceFactorStiffness} stiffness`, 'NDS wet-service factors (F_c⊥ = 0.67)'],
        ['Design bending', `${f0(d.oakDesignMorPsi)} psi`, `MOR × C_M / SF ${p.woodSafetyFactor}`],
        ['Design shear / comp. ⊥', `${f0(oakShear)} / ${f0(oakPerp)} psi`, `shear × ${p.wetServiceFactorStrength}, ⊥ × ${p.wetServiceFactorCompPerp}, both / SF ${p.woodSafetyFactor}`],
        ['Bolt bearing in oak (dowel)', `${f0((p.oakDowelBearingPsi * p.wetServiceFactorStrength) / p.woodSafetyFactor)} psi design`, `${f0(p.oakDowelBearingPsi)} psi clear × ${p.wetServiceFactorStrength} / SF`],
        ['Design E (deflection)', `${f0(d.oakDesignMoePsi)} psi`, 'MOE × C_M, static load'],
      ]),
      h('h4', {}, `Plywood (D-5): ${okoume ? 'okoume marine' : 'Baltic birch exterior'}`),
      rows([
        ['Density', `${d.plyDensityPcf} lb/ft³`, 'typical published panel values'],
        ['E / MOR (face grain along span)', `${f0(d.plyMoePsi)} / ${f0(okoume ? p.okoumeMorPsi : p.birchMorPsi)} psi`],
        ['Design bending', `${f0(d.plyDesignMorPsi)} psi`, `MOR × C_M / SF ${p.woodSafetyFactor}`],
        ['Design E', `${f0(d.plyMoePsi * p.wetServiceFactorStiffness)} psi`, 'E × C_M'],
      ]),
      h('h4', {}, 'Steel (D-4)'),
      rows([
        ['Axle yield / E', `${f0(p.axleYieldPsi)} / ${f0(p.steelMoePsi)} psi`, p.axleYieldPsi >= 65000 ? '1045 turned-ground-polished shafting (≈ 70+ ksi; confirm vendor cert)' : '1018 CD, yield taken as 50 ksi (book 54)'],
        ['Axle allowable', `${f0(d.axleAllowablePsi)} psi`, `yield / SF ${p.steelSafetyFactor}`],
        ['Grade 8 bolt yield / ultimate', `${f0(p.grade8BoltYieldPsi)} / ${f0(p.grade8BoltUltimatePsi)} psi`, `SAE grade 8; normal hits use yield / SF ${p.steelSafetyFactor}, the hard hit ultimate / ${p.failSafeFactor} (D-50); shear 0.577·yield`],
        ['A36 plate yield / ultimate', `${f0(p.bracketSteelYieldPsi)} / ${f0(p.bracketSteelUltimatePsi)} psi`, 'the tongue plate (D-56); bolted, never welded'],
        ['UHMW thrust washer allowable', `${f0(p.steerBearingAllowPsi)} psi`, 'bearing pressure under the king beam, static; confirm with the supplier (D-56)'],
      ]),
      h('h4', {}, 'Loads and factors (D-1, D-2, D-14)'),
      rows([
        ['Operating / goal rider', `${p.riderMassLb} / ${p.riderGoalMassLb} lb`, `+ ${p.cargoMassLb} lb cargo`],
        ['Cargo mode (D-53)', `${p.cargoPayloadLb} lb on the bed, seat stowed, no rider`, `CG ${p.cargoCgHeightIn}" above the deck, ${p.cargoCgOffsetYIn}" off center; concentrated ${p.cargoConcentratedLb} lb on ${p.cargoPatchAlongIn}" × ${p.cargoPatchAcrossIn}"; worse of two placements`],
        ['Dynamic factor', `× ${p.dynamicFactor}`, 'payload and axle reactions'],
        ['Lightest rider (pitch-back)', `${p.riderMinMassLb} lb`, 'BRIEF §4.1; counts toward the operating status'],
        ['Design pull', `${p.pullForceLbf} lbf`, `at ${p.pullerHandHeightIn}" hand height, ${p.bridleRopeRunIn}" rope run; lift pull ≥ ${p.pitchPullMarginMin}× peak`],
        ['Bump hits (D-50)', `${p.bumpNormalHeightIn}" normal at ${p.bumpSpeedNormalMph} mph (walking), ${p.bumpHardHeightIn}" hard at ${p.bumpSpeedHardMph} mph (jogging)`, `velocity-pulse model, wheel rate ${p.bumpWheelRateLbIn} lb/in; sin β = (r − h)/r`],
        ['Axle tire friction', `H = μ·P_static, arm = tire radius`, 'combined with vertical as a resultant'],
        ['μ tire-ground / pad', `${p.tireGroundMu} / ${p.brakePadMu}`, 'D-16'],
        ['Deflection limit', `L/${p.deflectionLimitRatio}`, 'static load'],
      ]),
    ));
  det.open = isOpen;
  det.addEventListener('toggle', () => onToggle(det.open));
  return det;
}

export function mountAnalysisPanel(host: HTMLElement): AnalysisPanel {
  const root = h('div', { class: 'ap' });
  host.append(root);
  const open = new Set<string>();
  let footOpen = false;

  function renderRow(c: Row, p: Params): HTMLElement {
    const isOpen = open.has(c.id);
    const body = h('div', { class: 'ap-body', id: `ap-body-${c.id}` });
    body.hidden = !isOpen;
    body.append(h('pre', { class: 'ap-how' }, c.how));
    if (c.details?.length) {
      body.append(h('ul', { class: 'ap-details' }, ...c.details.map((d) =>
        h('li', { class: d.util > 1 ? 'over' : '' }, h('span', {}, d.name),
          h('span', {}, `${fmtNumber(d.value, d.unit)}${unitText(d.unit)} ${d.sense === '>=' ? '≥' : '≤'} ${fmtNumber(d.limit, d.unit)} (${Number.isFinite(d.util) ? Math.round(d.util * 100) : '∞'}%)`)))));
    }
    if (c.detailsCargo?.length && c.details !== c.detailsCargo) {
      body.append(h('div', { class: 'ap-refs' }, `Cargo ${p.cargoPayloadLb} lb criteria:`), h('ul', { class: 'ap-details' }, ...c.detailsCargo.map((d) =>
        h('li', { class: d.util > 1 ? 'over' : '' }, h('span', {}, d.name),
          h('span', {}, `${fmtNumber(d.value, d.unit)}${unitText(d.unit)} ${d.sense === '>=' ? '≥' : '≤'} ${fmtNumber(d.limit, d.unit)} (${Number.isFinite(d.util) ? Math.round(d.util * 100) : '∞'}%)`)))));
    }
    if (c.refs?.length) body.append(h('div', { class: 'ap-refs' }, `Refs: ${c.refs.join(', ')}`));

    const list = caseList(c);
    const gov = governingCase(c);
    const caseLine = list.length
      ? h('span', { class: 'ap-load' },
          h('span', { class: 'ap-cases' }, ...list.map(([k, r]) =>
            h('span', { class: `ap-cc ${r.status}${gov && gov[0] === k ? ' gov' : ''}`, title: `${LOAD_LABEL[k]} ${caseWho(p, k)}: ${STATUS_WORD[r.status]}` },
              `${caseWho(p, k)} ${valueText(r.value, r.unit)} `, h('b', {}, CHIP[r.status])))),
          c.goalFlag ? h('span', { class: 'ap-flag' }, 'fails at goal rider only') : '')
      : h('span', { class: 'ap-load' }, c.load ? LOAD_LABEL[c.load] : 'geometry');
    // The value beside the chip is the governing case's (the one that sets the chip); rows without cases show their single value.
    const shown = gov ? { value: gov[1].value, unit: gov[1].unit, limit: gov[1].limit, sense: gov[1].sense, status: c.status === 'info' && gov[0] !== 'cargo' ? 'info' as Status : gov[1].status, util: gov[1].util } : { value: c.value, unit: c.unit, limit: c.limit, sense: c.sense, status: c.status, util: c.util };
    // A cargo-only row has no rider status: its chip shows the cargo result.
    const headStatus: Status = c.status === 'info' && c.statusCargo ? c.statusCargo : c.status;
    const util = shown.status === 'info' || shown.util === undefined ? '' : pct(shown.util);
    const head = h('button', { class: 'ap-head', type: 'button', 'aria-expanded': String(isOpen), 'aria-controls': body.id, 'data-id': c.id },
      h('span', {}, h('span', { class: `ap-chip ${headStatus}`, title: STATUS_WORD[headStatus] }, CHIP[headStatus])),
      h('span', { class: 'ap-name' }, c.label, caseLine),
      h('span', { class: 'ap-val' },
        h('b', {}, valueText(shown.value, shown.unit)),
        h('span', { class: 'ap-limit' }, limitText(shown)),
        gov && list.length > 1 ? h('span', { class: 'ap-limit' }, `governs: ${caseWho(p, gov[0])}`) : '',
        util ? h('span', { class: `ap-util${(shown.util ?? 0) > 1 ? ' over' : ''}` }, `util ${util}`) : ''));
    head.addEventListener('click', () => {
      const now = body.hidden;
      body.hidden = !now;
      head.setAttribute('aria-expanded', String(now));
      if (now) open.add(c.id); else open.delete(c.id);
    });
    return h('div', { class: 'ap-row', 'data-check-id': c.id }, head, body);
  }

  function update(p: Params, checks: CheckResult[]): void {
    const active = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.id : undefined;
    const rows = checks as Row[];
    root.replaceChildren();
    if (!rows.length) {
      root.append(h('p', { class: 'ap-empty' }, 'No checks to show.'));
      return;
    }
    const op = counts(rows, 'statusOperating');
    const go = counts(rows, 'statusGoal');
    const cg = countsCargo(rows);
    root.append(h('div', { class: 'ap-summary', role: 'status' },
      h('div', { class: 'ap-sumrow' }, h('b', {}, `Operating ${p.riderMassLb} lb`), countSpan(op.pass, 'pass'), countSpan(op.marginal, 'marginal'), countSpan(op.fail, 'fail')),
      h('div', { class: 'ap-sumrow' }, h('b', {}, `Goal ${p.riderGoalMassLb} lb`), countSpan(go.pass, 'pass'), countSpan(go.marginal, 'marginal'), countSpan(go.fail, 'fail')),
      h('div', { class: 'ap-sumrow' }, h('b', {}, `Cargo ${p.cargoPayloadLb} lb`), countSpan(cg.pass, 'pass'), countSpan(cg.marginal, 'marginal'), countSpan(cg.fail, 'fail')),
      h('div', { class: 'muted small' }, 'Operating rider must pass everything (D-1); the goal rider is reported and flagged. Cargo (D-53) is the post-race payload with the seat stowed and no rider, shown next to the rider cases; it never sets a row\'s rider status. Info rows are not counted.')));
    const flagged = rows.filter((r) => r.goalFlag);
    if (flagged.length)
      root.append(h('div', { class: 'ap-flags' }, h('strong', {}, `Goal rider (${p.riderGoalMassLb} lb) fails where the operating rider passes:`),
        h('ul', {}, ...flagged.map((r) => h('li', {}, r.label)))));
    for (const grp of CHECK_GROUPS) {
      const inGroup = rows.filter((r) => groupOf(r) === grp);
      if (!inGroup.length) continue;
      const worst = (['fail', 'marginal', 'pass', 'info'] as Status[]).find((s) => inGroup.some((r) => r.status === s)) ?? 'info';
      root.append(h('section', { class: 'ap-group' },
        h('h3', {}, grp, h('span', {}, `${inGroup.length} checks · worst: ${STATUS_WORD[worst]}`)),
        ...inGroup.map((r) => renderRow(r, p))));
    }
    root.append(materials(p, footOpen, (o) => { footOpen = o; }));
    if (active) root.querySelector<HTMLElement>(`[data-id="${active}"]`)?.focus();
  }

  return { update };
}
