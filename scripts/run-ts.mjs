// Minimal vite-node substitute (vite-node is not a dependency): node scripts/run-ts.mjs scripts/explore.ts
import { createServer } from 'vite';
const file = process.argv[2];
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', configFile: false, optimizeDeps: { noDiscovery: true } });
try { await server.ssrLoadModule(file); } finally { await server.close(); }
