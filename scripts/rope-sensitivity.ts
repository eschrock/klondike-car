// Rope rig sensitivity for the recommended config: node scripts/run-ts.mjs scripts/rope-sensitivity.ts
import { defaultParams, type Params } from '../src/params';
import { runChecks } from '../src/analysis';
import { RECOMMENDED } from './recommended';

console.log('| Hand height | Rope run | 80 lb | 150 lb | 200 lb |\n|---|---|---|---|---|');
for (const hand of [30, 36, 40]) for (const run of [72, 96, 120]) {
  const p = { ...defaultParams(), ...RECOMMENDED, pullerHandHeightIn: hand, bridleRopeRunIn: run } as Params;
  const c = runChecks(p, { includeTruck: false }).find((x) => x.id === 'pitch-rear') as any;
  const v = (k: string) => `${Number(c.cases?.[k]?.value).toFixed(2)}× ${c.cases?.[k]?.status}`;
  console.log(`| ${hand}" | ${run}" | ${v('light')} | ${v('operating')} | ${v('goal')} |`);
}
