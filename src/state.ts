import { PARAM_DEFS, defaultParams, sanitizeParam, sanitizeParams, type ParamKey, type Params } from './params';

const KEYS = Object.keys(PARAM_DEFS) as ParamKey[];

function fmt(v: number): string {
  // Trim float noise (0.1+0.2) while keeping 4+ decimals for fine steps.
  return String(Number(v.toFixed(6)));
}

/** Compact `key=value&…` of only the non-default values (no leading '#'). */
export function encodeHash(p: Params): string {
  const parts: string[] = [];
  for (const k of KEYS) {
    if (p[k] !== PARAM_DEFS[k].default) parts.push(`${k}=${fmt(p[k])}`);
  }
  return parts.join('&');
}

/** Parse a hash (with or without '#') back to a full, sanitized Params. Unknown keys/garbage ignored. */
export function decodeHash(hash: string): Params {
  const out = defaultParams();
  const s = hash.replace(/^#/, '');
  if (!s) return out;
  for (const pair of s.split('&')) {
    const i = pair.indexOf('=');
    if (i < 0) continue;
    const key = decodeURIComponent(pair.slice(0, i)) as ParamKey;
    if (!(key in PARAM_DEFS)) continue;
    const raw = pair.slice(i + 1);
    if (raw.trim() === '') continue;
    out[key] = sanitizeParam(key, Number(raw));
  }
  return out;
}

export type Listener = (params: Params, changed: ParamKey[] | 'all') => void;

export interface Store {
  get(): Params;
  set(key: ParamKey, value: number): void;
  reset(): void;
  replace(next: Partial<Params>): void;
  subscribe(fn: Listener): () => void;
}

export interface StoreOptions {
  initial?: Params;
  /** Called after every change with the encoded hash (e.g. to write location.hash). */
  persist?: (hash: string) => void;
}

export function createStore(opts: StoreOptions = {}): Store {
  let params: Params = opts.initial ?? defaultParams();
  const listeners = new Set<Listener>();

  const emit = (changed: ParamKey[] | 'all') => {
    opts.persist?.(encodeHash(params));
    for (const fn of [...listeners]) fn(params, changed);
  };

  return {
    get: () => params,
    set(key, value) {
      const v = sanitizeParam(key, value);
      if (v === params[key]) return;
      params = { ...params, [key]: v };
      emit([key]);
    },
    reset() {
      params = defaultParams();
      emit('all');
    },
    replace(next) {
      params = sanitizeParams(next);
      emit('all');
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const hasWindow = typeof window !== 'undefined' && typeof history !== 'undefined';

/** App-wide store: restored from location.hash, persisted back with replaceState. */
export const store: Store = createStore({
  initial: hasWindow ? decodeHash(window.location.hash) : undefined,
  persist: hasWindow
    ? (hash) => {
        const url = window.location.pathname + window.location.search + (hash ? `#${hash}` : '');
        history.replaceState(null, '', url);
      }
    : undefined,
});

// A pasted/edited link (hash change without reload) replaces the whole design.
if (hasWindow) {
  window.addEventListener('hashchange', () => {
    if (window.location.hash.replace(/^#/, '') !== encodeHash(store.get())) store.replace(decodeHash(window.location.hash));
  });
}
