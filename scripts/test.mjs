#!/usr/bin/env node
// Quiet test run: vitest with a hard time limit, printing only the failures and the summary.
//   npm run t                          all tests
//   npm run t -- src/world/districts   one area (any vitest arguments pass through)
//   T_LIMIT=600 npm run t              time limit in seconds (default 300)
//   npm run t -- --times [save]        also the slowest files and the CPU seconds, against the saved
//                                      run; `save` makes this run the one to compare with
// A run that hangs is killed and reported, instead of stalling the session. Wall time swings by a
// third with the machine's load; CPU seconds (all workers) hold steady, so compare those.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const limit = Number(process.env.T_LIMIT ?? 300);
let args = process.argv.slice(2);
const times = args.includes('--times');
const save = times && args[args.indexOf('--times') + 1] === 'save';
args = args.filter((a, k) => a !== '--times' && !(save && k === process.argv.slice(2).indexOf('--times') + 1));
const SAVED = resolve(import.meta.dirname, '../node_modules/.cache/test-times.json');
// /usr/bin/time -p counts every worker's CPU (they are all waited for)
const [cmd, ...cmdArgs] = times ? ['/usr/bin/time', '-p', 'npx', 'vitest', 'run', '--reporter=default', ...args] : ['npx', 'vitest', 'run', ...args];
const child = spawn(cmd, cmdArgs, { env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' } });
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
  if (times) report(lines);
  process.exit(code ?? 1);
});

/** Slowest files, CPU and wall seconds; against the saved run when there is one. */
function report(lines) {
  const files = {};
  for (const l of lines) {
    const m = /(src\S+\.test\.ts) \(\d+ tests?[^)]*\) (\d+)ms/.exec(l);
    if (m) files[m[1]] = Number(m[2]);
  }
  const num = (re) => Number(lines.map((l) => re.exec(l)?.[1]).find((v) => v !== undefined) ?? NaN);
  const now = { cpu: num(/^user\s+([\d.]+)/) + num(/^sys\s+([\d.]+)/), wall: num(/^real\s+([\d.]+)/), files };
  const then = existsSync(SAVED) ? JSON.parse(readFileSync(SAVED, 'utf8')) : null;
  const pct = (a, b) => `${b >= a ? '+' : ''}${Math.round(((b - a) / a) * 100)}%`;
  const delta = (a, b) => (a ? ` (${pct(a, b)} vs saved ${a.toFixed(1)})` : '');
  // totals compare only when the same files ran (an area run against the whole suite says nothing)
  const same = then && Object.keys(files).length === Object.keys(then.files).length;
  const total = then && !same ? ` (saved run: ${Object.keys(then.files).length} files, this one ${Object.keys(files).length}: totals not compared)` : '';
  console.log(`\nCPU ${now.cpu.toFixed(1)} s${same ? delta(then.cpu, now.cpu) : ''} · wall ${now.wall.toFixed(1)} s${same ? delta(then.wall, now.wall) : ''}${total}`);
  console.log('slowest files (ms, under load):');
  for (const [f, ms] of Object.entries(files).sort(([, a], [, b]) => b - a).slice(0, 10)) {
    console.log(`  ${String(ms).padStart(6)}  ${f}${then?.files[f] === undefined ? (then ? '  (new)' : '') : `  (${pct(then.files[f], ms)}, saved ${then.files[f]})`}`);
  }
  if (same) {
    const gone = Object.keys(then.files).filter((f) => !(f in files));
    if (gone.length && Object.keys(files).length > gone.length) console.log(`  not run now: ${gone.join(', ')}`);
  }
  if (save) {
    mkdirSync(dirname(SAVED), { recursive: true });
    writeFileSync(SAVED, JSON.stringify(now));
    console.log(`saved as the run to compare with (${SAVED})`);
  }
}
