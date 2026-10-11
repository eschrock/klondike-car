// Print the full check table for the recommended configuration (Markdown) and its share-link hash.
import { defaultParams, type Params } from '../src/params';
import { runChecks } from '../src/analysis';
import { buildModel } from '../src/model';
import { totalMass, centerOfGravity } from '../src/model/mass';
import { checkTruckFit } from '../src/truck/fit';
import { encodeHash } from '../src/state';
import { RECOMMENDED } from './recommended';

const p = { ...defaultParams(), ...RECOMMENDED } as Params;
const b = (v: object) => buildModel(p, v);
const m = (v: object) => totalMass(b(v), { includePayload: true });
const cg = (v: object) => centerOfGravity(b(v), { includePayload: true }).map((x) => x.toFixed(1)).join(', ');
console.log(`Hash: #${encodeHash(p)}\n`);
console.log(`| Case | Mass lb | CG (x, y, z) in |\n|---|---|---|`);
console.log(`| Empty | ${m({ rider: 'none', cargo: false }).toFixed(1)} | ${cg({ rider: 'none', cargo: false })} |`);
console.log(`| Transport (removables off) | ${m({ rider: 'none', cargo: false, removed: true }).toFixed(1)} | ${cg({ rider: 'none', cargo: false, removed: true })} |`);
console.log(`| + 150 lb rider + cargo | ${m({ rider: 'operating', cargo: true }).toFixed(1)} | ${cg({ rider: 'operating', cargo: true })} |`);
console.log(`| + 200 lb rider + cargo | ${m({ rider: 'goal', cargo: true }).toFixed(1)} | ${cg({ rider: 'goal', cargo: true })} |\n`);
const fmt = (v: unknown) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : String(v));
console.log(`| Check | Value (governing) | Limit | 150 lb | 200 lb | 80 lb |\n|---|---|---|---|---|---|`);
for (const c of runChecks(p) as any[]) {
  const lim = c.limit ? `${c.sense ?? ''} ${fmt(c.limit)} ${c.unit}` : 'info';
  console.log(`| ${c.label} | ${fmt(c.value)} ${c.unit} | ${lim} | ${c.statusOperating ?? c.status} | ${c.statusGoal ?? ''} | ${c.cases?.light?.status ?? ''} |`);
}
const fit = checkTruckFit(p, (v) => buildModel(p, v as object));
console.log(`\nTruck fit:`);
for (const c of fit.cases as any[]) console.log(`- ${c.mode} / ${c.orientation} / ${c.config}: ${c.fits ? 'fits' : 'no'} (min gap ${c.minClearanceIn?.toFixed(2)}")`);
