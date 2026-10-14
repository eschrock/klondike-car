/// <reference lib="webworker" />
import { handle, type Request } from './engine';

self.onmessage = async (e: MessageEvent<{ id: number; req: Request }>) => {
  const { id, req } = e.data;
  try {
    self.postMessage({ id, ok: true, result: await handle(req) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
  }
};
