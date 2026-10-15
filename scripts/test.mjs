#!/usr/bin/env node
// Quiet test run: vitest with a hard time limit, printing only the failures and the summary.
//   npm run t                          all tests
//   npm run t -- src/world/districts   one area (any vitest arguments pass through)
//   T_LIMIT=600 npm run t              time limit in seconds (default 300)
// A run that hangs is killed and reported, instead of stalling the session.
import { spawn } from 'node:child_process';

const limit = Number(process.env.T_LIMIT ?? 300);
const child = spawn('npx', ['vitest', 'run', ...process.argv.slice(2)], { env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' } });
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => {
  child.kill('SIGKILL');
  console.log(`TIMED OUT after ${limit}s. Last output:\n${out.split('\n').slice(-25).join('\n')}`);
  process.exit(124);
}, limit * 1000);

child.on('close', (code) => {
  clearTimeout(timer);
  const lines = out.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
  // Failed test names, each failure's first assertion line and its location, then the summary.
  const keep = lines.filter((l) =>
    /^\s*×|FAIL |AssertionError|Error:|expected|❯ .*\.test\.ts:\d+|Snapshot|Test Files|Tests |Duration/.test(l),
  );
  // Each.it tests repeat the same failure per seed: collapse identical lines (seed numbers aside).
  const seen = new Map();
  for (const l of keep) {
    const key = l.replace(/seed \d+/g, 'seed N').replace(/ \d+ms$/, '');
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const shown = [...seen].slice(0, 80).map(([l, n]) => (n > 1 ? `${l}  (×${n})` : l));
  console.log(shown.join('\n') || out.split('\n').slice(-20).join('\n'));
  if (seen.size > 80) console.log(`… ${seen.size - 80} more lines`);
  process.exit(code ?? 1);
});
