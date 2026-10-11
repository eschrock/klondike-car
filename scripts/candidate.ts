// Evaluate a named candidate configuration: node scripts/run-ts.mjs scripts/candidate.ts
import { defaultParams, validateParams, resolveParams, type Params } from '../src/params';
import { runChecks } from '../src/analysis';
import { buildModel } from '../src/model';
import { totalMass } from '../src/model/mass';

const base: Partial<Params> = {
  drawbar: 0, wheelbaseIn: 44, kingpinDiameterIn: 0.75, kingpinSleeveOdIn: 1.25, kingpinLeadIn: 1.5,
  frontAxleBeamThicknessIn: 4.0, axleYieldPsi: 70000, deckPlyIn: 0.472, crossmemberSpacingIn: 8, brakeLeverRatio: 12,
};
const variants: Record<string, Partial<Params>> = {
  'R0 base': {},
  'R1 lock 37': { steerLockDeg: 37 },
  'R2 lock 36': { steerLockDeg: 36 },
  'R3 pin 5/8': { kingpinDiameterIn: 0.625 },
  'R4 sleeve 1.125': { kingpinSleeveOdIn: 1.125, kingpinLeadIn: 1.4375, frontAxleBeamThicknessIn: 3.875 },
  'R5 boot 0.375': { bootAllowanceIn: 0.375 },
};
for (const [name, v] of Object.entries(variants)) {
  const p = { ...defaultParams(), ...base, ...v } as Params;
  const errs = validateParams(p).filter((i) => i.severity === 'error');
  const r = resolveParams(p);
  const mass = totalMass(buildModel(p, { rider: 'none', cargo: false }));
  const checks = runChecks(p);
  const bad = checks.filter((c) => ['fail', 'marginal'].includes(c.statusOperating ?? '') || ['fail', 'marginal'].includes(c.statusGoal ?? ''));
  console.log(`\n## ${name}: ${errs.length ? 'INVALID: ' + errs.map((e) => e.message).join(' | ') : 'valid'}  mass ${mass.toFixed(1)} lb  nose ${r.noseWidthIn} shoulder ${r.noseTaperStartIn}`);
  for (const c of bad) console.log(`  ${c.id}: op ${c.statusOperating} goal ${c.statusGoal} value ${Number(c.value).toFixed(3)} limit ${c.limit}`);
}
