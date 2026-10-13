import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildModel } from '../model';
import { defaultParams } from '../params';
import { buildPackage } from './package';
const OUT = process.env.SNAP_OUT!;
it('snap', () => {
  for (const w of [0, 1]) {
    const p = { ...defaultParams(), weatherSpec: w, kneeMount: Number(process.env.SNAP_KNEE ?? 0) } as ReturnType<typeof defaultParams>;
    const pkg = buildPackage(buildModel(p), p, { date: '2026-10-12', link: 'x' });
    const d = pkg.data;
    const put = (n: string, t: string | Uint8Array) => { const f = join(OUT, `w${w}`, n); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
    for (const f of pkg.files) put(f.name, f.data);
    put('json/steps.json', JSON.stringify(d.steps, null, 1));
    put('json/verify.json', JSON.stringify(d.verify, null, 1));
    put('json/bom.json', JSON.stringify(d.bom, null, 1));
    put('json/cutlist.json', JSON.stringify(d.cutList, null, 1));
    put('json/finishing.json', JSON.stringify(d.finishing, null, 1));
    put('json/oak.json', JSON.stringify(d.oak, null, 1));
  }
}, 600000);
