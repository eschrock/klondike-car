import { defaultParams, phase3bDefaults } from '../src/params';
import { buildModel } from '../src/model';
const ID = /^(deck|side-(cabin|nose)|rail-|joist-|transom-front|transom-rear|guard-|scupper-|front-beam-hold-down|shoulder|girder)/;
const sum = (p: any) => { const m = buildModel(p).filter((x) => ID.test(x.id)); const by: Record<string, number> = {}; for (const x of m) { const k = x.id.replace(/-[LR]\b/, '').replace(/-\d+$/, ''); by[k] = (by[k] ?? 0) + x.massLb; } return { total: m.reduce((a, x) => a + x.massLb, 0), by }; };
const a = sum(defaultParams()), b = sum({ ...phase3bDefaults() });
console.log('old hull', a.total.toFixed(2), 'ack hull', b.total.toFixed(2), 'delta', (b.total - a.total).toFixed(2));
const keys = new Set([...Object.keys(a.by), ...Object.keys(b.by)]);
for (const k of [...keys].sort()) console.log(k.padEnd(28), (a.by[k] ?? 0).toFixed(2).padStart(7), (b.by[k] ?? 0).toFixed(2).padStart(7));
