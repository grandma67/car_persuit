#!/usr/bin/env node
// Run a TypeScript script against the game's source through Vite's SSR loader (no build step, no
// extra dependencies): node scripts/run-ts.mjs scripts/district-stats.ts [args…]. The script's
// default export is called with the remaining arguments.
import { createServer } from 'vite';
import { resolve } from 'node:path';

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/run-ts.mjs <file.ts> [args…]');
  process.exit(1);
}
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
let code = 0;
try {
  const mod = await server.ssrLoadModule(resolve(file));
  // Vite's signal-exit listens for these, and a listener can't run during a long synchronous script,
  // so Ctrl+C would wait for it to finish. Without one, the signal ends the process at once.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGALRM']) process.removeAllListeners(sig);
  await mod.default?.(rest);
} catch (e) {
  console.error(e);
  code = 1;
}
await server.close();
process.exit(code || process.exitCode || 0);
