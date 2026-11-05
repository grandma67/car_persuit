#!/usr/bin/env node
// Cop chase benchmark (knowledge/COPS_DEV.md):
//   npm run cops                       3★, 5★ and ghost 3★ on the working tree, per-city averages
//   npm run cops -- --vs main          the same on a temporary worktree of `main` too, as a table with Δ%
//   npm run cops -- --samples 2        each side averaged over N draws (other traffic and suspect routes
//                                      in the same cities), with the noise: ±% = half the spread between
//                                      this tree's draws. A Δ inside it is noise. N× the CPU, same wall time
//                                      on a machine with the cores (runs are parallel)
//   npm run cops -- --diag hits        one run (3★, or --stars N / --ghost) listing what fast hits were
//                                      (also uturns, recovers)
// Options: --seeds 24 --secs 120 --maxBlocks 12 --stars N --ghost --verbose (per-city lines).
// Each run is scripts/cop-bench.ts through run-ts; all run in parallel (~2 min for a comparison).
import { spawn } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tempWorktree } from './temp-worktree.mjs';

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

const runs = new Set();
process.on('exit', () => runs.forEach((c) => c.kill())); // none outlives this run or its worktree

/** One bench run in `dir` (a checkout); resolves with its stdout. */
function bench(dir, args, stream = false) {
  return new Promise((done, fail) => {
    const child = spawn('node', [join(dir, 'scripts/run-ts.mjs'), join(dir, 'scripts/cop-bench.ts'), ...args], { cwd: dir });
    runs.add(child);
    child.on('close', () => runs.delete(child));
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
const worktree = ref ? tempWorktree(ref) : null;
const refDir = worktree?.dir ?? null;
if (ref) {
  // Today's benchmark against that ref's game code.
  copyFileSync(join(root, 'scripts/cop-bench.ts'), join(refDir, 'scripts/cop-bench.ts'));
  copyFileSync(join(root, 'scripts/run-ts.mjs'), join(refDir, 'scripts/run-ts.mjs'));
}
try {
  const samples = Math.max(1, Number(flag('samples', 1)));
  const draws = [...Array(samples).keys()];
  // Every config × draw of both sides at once; per config, the draws' results in order.
  const side = (dir, verbose) => CONFIGS.map(([, a]) => draws.map((s) => bench(dir, [...a, ...common, ...(s ? [`sample=${s}`] : [])], verbose)));
  const collect = async (runs) => Promise.all(runs.map(async (d) => (await Promise.all(d)).map(result)));
  const nowRuns = side(root, !!flag('verbose') && samples === 1);
  const thenRuns = refDir ? side(refDir, false) : [];
  const nowS = await collect(nowRuns);
  const thenS = await collect(thenRuns);
  const mean = (rs, k) => Math.round((rs.reduce((t, r) => t + r[k], 0) / rs.length) * 10) / 10;
  const keys = Object.keys(nowS[0][0]).filter((k) => k !== 'cities');
  const nowR = nowS.map((rs) => Object.fromEntries(keys.map((k) => [k, mean(rs, k)])));
  const thenR = thenS.map((rs) => Object.fromEntries(keys.map((k) => [k, mean(rs, k)])));
  /** Half the spread between this tree's draws, as % of their mean. */
  const noise = (i, k) => {
    const v = nowS[i].map((r) => r[k]);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return m ? Math.round(((Math.max(...v) - Math.min(...v)) / 2 / m) * 100) : 0;
  };
  console.log(`per-city averages over ${nowS[0][0].cities} cities, ${flag('secs', 120)} s each${samples > 1 ? `, ${samples} draws` : ''}${ref ? `; ${ref} → working tree` : ''}`);
  const cell = (i, k) => {
    const n = samples > 1 ? ` ±${noise(i, k)}%`.padEnd(6) : '';
    if (!refDir) return `${String(nowR[i][k]).padStart(8)}${n}`;
    const a = thenR[i][k];
    const b = nowR[i][k];
    const pct = a ? `${b >= a ? '+' : ''}${Math.round(((b - a) / a) * 100)}%` : '';
    return `${String(a).padStart(7)} → ${String(b).padEnd(7)}${pct.padStart(5)}${n}`;
  };
  const w = (refDir ? 26 : 9) + (samples > 1 ? 6 : 0);
  console.log(''.padEnd(14) + CONFIGS.map(([name]) => name.padStart(w)).join(''));
  for (const k of keys) console.log(k.padEnd(14) + CONFIGS.map((_, i) => cell(i, k).padStart(w)).join(''));
} finally {
  worktree?.remove();
}
