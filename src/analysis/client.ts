/**
 * The page's side of the analysis workers: `call(request)` returns a promise for the engine's answer. The workers are passed in so this file stays free of bundler-specific
 * imports (and testable); when there is none, or one fails to start, its requests run on the page's own thread a tick later, as before the workers existed.
 *
 * Two workers, so a long cargo sweep never holds up the checks of the next design change: one answers `design` and `windows`, the other `sweep` and `cargo`.
 */
import { handle, type Request, type Response } from './engine';

export interface AnalysisClient {
  call<R extends Request>(req: R): Promise<Response<R>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Waiting { req: Request; resolve: (v: any) => void; reject: (e: Error) => void }

const inline = <R extends Request>(req: R) => new Promise<Response<R>>((resolve, reject) => setTimeout(() => handle(req).then(resolve, reject), 0));

function createLane(makeWorker: () => Worker) {
  let worker: Worker | null = null;
  try { worker = makeWorker(); } catch { worker = null; }
  const pending = new Map<number, Waiting>();
  let next = 1;
  if (worker) {
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const w = pending.get(e.data.id);
      if (!w) return;
      pending.delete(e.data.id);
      if (e.data.ok) w.resolve(e.data.result);
      else w.reject(new Error(e.data.error));
    };
    worker.onerror = () => { // the worker could not run (blocked, a bad build): everything waiting, and from here on, runs on the page's thread
      worker = null;
      const waiting = [...pending.values()];
      pending.clear();
      for (const w of waiting) inline(w.req).then(w.resolve, w.reject);
    };
  }
  return <R extends Request>(req: R): Promise<Response<R>> => {
    if (!worker) return inline(req);
    const id = next++;
    return new Promise<Response<R>>((resolve, reject) => {
      pending.set(id, { req, resolve, reject });
      worker!.postMessage({ id, req });
    });
  };
}

export function createAnalysisClient(makeWorker: () => Worker): AnalysisClient {
  const design = createLane(makeWorker);
  const sweeps = createLane(makeWorker);
  return {
    call: (req) => (req.op === 'sweep' || req.op === 'cargo' ? sweeps(req) : design(req)),
  };
}
