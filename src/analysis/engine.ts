/**
 * The slow, pure calculations of a design change (truck fit, summary, the engineering checks, the rider and cargo sweeps, the feasible windows), behind one request/response
 * function. The page runs it in a Web Worker (`analysis.worker.ts`, through `client.ts`) so typing, dragging and orbiting never wait on it; without Worker support the client
 * calls it on the page's own thread. No DOM, no three.js: responses are plain data that survive structured cloning.
 */
import type { Params } from '../params';
import { buildModel, type ViewState } from '../model';
import { checkTruckFit, computeFeasibleWindows, type FitResult, type FitWindows } from '../truck/fit';
import { runChecks } from './index';
import type { AnalysisCheck } from './types';
import { riderSweep, type SweepResult } from './rider-sweep';
import { cargoCapacity, type CargoCapacity } from './cargo-capacity';
import { summaryStats, type SummaryStats } from './summary';

export interface DesignResult {
  fit: FitResult;
  rows: AnalysisCheck[];
  stats: SummaryStats;
}

export interface SweepRange { fromLb: number; toLb: number; stepLb: number }

export type Request =
  | { op: 'design'; p: Params }
  | { op: 'sweep'; p: Params; range: SweepRange }
  | { op: 'cargo'; p: Params }
  | { op: 'windows'; p: Params; run: number };

export interface Responses {
  design: DesignResult;
  sweep: SweepResult;
  cargo: CargoCapacity;
  windows: FitWindows | null;
}
export type Response<R extends Request> = Responses[R['op']];

const fits = new Map<string, FitResult>();
const FIT_CACHE = 4;
const fitFor = (p: Params): FitResult => {
  const key = JSON.stringify(p);
  let f = fits.get(key);
  if (!f) {
    f = checkTruckFit(p, (v) => buildModel(p, v as ViewState));
    fits.set(key, f);
    if (fits.size > FIT_CACHE) fits.delete(fits.keys().next().value as string);
  }
  return f;
};

/** The newest windows request and a counter any other request bumps: a running windows search stops when either moves on. */
let windowsRun = -1;
let epoch = 0;

export async function handle<R extends Request>(req: R): Promise<Response<R>> {
  const out = await run(req);
  return out as Response<R>;
}

async function run(req: Request): Promise<Responses[Request['op']]> {
  switch (req.op) {
    case 'design': {
      epoch++; // the design moved on: a feasible-windows search for the old one is stale
      const fit = fitFor(req.p);
      const stats = summaryStats(req.p, (q, v) => buildModel(q, v));
      return { fit, rows: runChecks(req.p, { fit }), stats };
    }
    case 'sweep':
      return riderSweep(req.p, { fit: fitFor(req.p), ...req.range });
    case 'cargo':
      return cargoCapacity(req.p);
    case 'windows': {
      windowsRun = req.run;
      const mine = epoch;
      return computeFeasibleWindows(req.p, (q, v) => buildModel(q, v as ViewState), () => windowsRun !== req.run || epoch !== mine);
    }
  }
}
