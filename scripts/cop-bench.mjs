#!/usr/bin/env node
// Cop chase benchmark (knowledge/COPS_DEV.md):
//   npm run cops                       3★, 5★ and ghost 3★ on the working tree, per-city averages
//   npm run cops -- --vs main          the same on a temporary worktree of `main` too, as a table with Δ%
//   npm run cops -- --diag hits        one run (3★, or --stars N / --ghost) listing what fast hits were
//                                      (also uturns, recovers)
// Options: --seeds 24 --secs 120 --maxBlocks 12 --stars N --ghost --verbose (per-city lines).
// Each run is scripts/cop-bench.ts through run-ts; all run in parallel (~2 min for a comparison).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, symlinkSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next === undefined || next.startsWith('--') ? true : next;
};
const common = ['seeds', 'secs', 'maxBlocks'].flatMap((k) => (flag(k) ? [`${k}=${flag(k)}`] : []));
if (flag('verbose')) common.push('verbose');

/** One bench run in `dir` (a checkout); resolves with its stdout. */
function bench(dir, args, stream = false) {
  return new Promise((done, fail) => {
    const child = spawn('node', [join(dir, 'scripts/run-ts.mjs'), join(dir, 'scripts/cop-bench.ts'), ...args], { cwd: dir });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      if (stream) process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      const s = String(d);
      if (!/deprecated parameters|Port \d+ is already in use/.test(s)) process.stderr.write(s);
    });
    child.on('close', (code) => (code === 0 ? done(out) : fail(new Error(`cop-bench ${args.join(' ')} exited ${code}`))));
  });
}
const result = (out) => JSON.parse(out.split('RESULT ')[1]);

if (flag('diag')) {
  const args = [`stars=${flag('stars', 3)}`, `diag=${flag('diag')}`, ...common];
  if (flag('ghost')) args.push('ghost');
  await bench(root, args, true);
  process.exit(0);
}

const CONFIGS = [
  ['3★', ['stars=3']],
  ['5★', ['stars=5']],
  ['ghost 3★', ['stars=3', 'ghost']],
];
const ref = flag('vs');
let refDir = null;
if (ref) {
  refDir = mkdtempSync(join(tmpdir(), 'cop-bench-'));
  execFileSync('git', ['worktree', 'add', '--detach', '-q', refDir, ref], { cwd: root });
  symlinkSync(join(root, 'node_modules'), join(refDir, 'node_modules'));
  // Today's benchmark against that ref's game code.
  copyFileSync(join(root, 'scripts/cop-bench.ts'), join(refDir, 'scripts/cop-bench.ts'));
  if (!existsSync(join(refDir, 'scripts/run-ts.mjs'))) copyFileSync(join(root, 'scripts/run-ts.mjs'), join(refDir, 'scripts/run-ts.mjs'));
}
try {
  const now = CONFIGS.map(([, a]) => bench(root, [...a, ...common], !!flag('verbose')));
  const then = refDir ? CONFIGS.map(([, a]) => bench(refDir, [...a, ...common])) : [];
  const nowR = (await Promise.all(now)).map(result);
  const thenR = (await Promise.all(then)).map(result);
  console.log(`per-city averages over ${nowR[0].cities} cities, ${flag('secs', 120)} s each${ref ? `; ${ref} → working tree` : ''}`);
  const keys = Object.keys(nowR[0]).filter((k) => k !== 'cities');
  const cell = (i, k) => {
    if (!refDir) return String(nowR[i][k]).padStart(8);
    const a = thenR[i][k];
    const b = nowR[i][k];
    const pct = a ? `${b >= a ? '+' : ''}${Math.round(((b - a) / a) * 100)}%` : '';
    return `${String(a).padStart(7)} → ${String(b).padEnd(7)}${pct.padStart(5)}`;
  };
  const w = refDir ? 26 : 9;
  console.log(''.padEnd(14) + CONFIGS.map(([name]) => name.padStart(w)).join(''));
  for (const k of keys) console.log(k.padEnd(14) + CONFIGS.map((_, i) => cell(i, k).padStart(w)).join(''));
} finally {
  if (refDir) {
    execFileSync('git', ['worktree', 'remove', '--force', refDir], { cwd: root });
    rmSync(refDir, { recursive: true, force: true });
  }
}
