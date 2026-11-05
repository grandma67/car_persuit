// A compact table of a perf-profile.js result (knowledge/BROWSER_CHECKS.md): ms per system per frame,
// garbage, GPU, calls, memory and budget per phase, and with --vs both sides with Δ%. Used by
// `check:browser --table`; also on a saved result:
//   node scripts/perf-table.mjs <check:browser output .json>   [--rows N]   (default 14 systems)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PHASES = ['idle', 'cruise', 'chase5'];
const fmt = (v) => (v === undefined || v === null ? '–' : typeof v === 'number' ? String(+v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 3)) : String(v));
const pad = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const lpad = (s, n) => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

/** One phase's numbers by row name. */
function rowsOf(phase) {
  if (!phase) return {};
  const out = {
    'FPS': phase.fps,
    'frame gap p99 ms': phase.frameGapP99,
    'garbage MB/s': phase.allocMBperSec,
    'GC/s': phase.gcPerSec,
    'GPU ms': phase.gpuMsPerFrame,
    'calls': phase.render?.calls,
    'triangles k': phase.render?.triangles !== undefined ? phase.render.triangles / 1000 : undefined,
  };
  for (const [k, v] of Object.entries(phase.per ?? {})) out[k] = v.msPerFrame;
  return out;
}

/** The table for one result's `val`, or two (`base` → `current`). */
export function perfTable(base, current = null, { rows = 14 } = {}) {
  const sides = current ? [base, current] : [base];
  if (!sides.every((v) => v && PHASES.some((p) => v[p]))) return null; // not a perf-profile result
  const phases = PHASES.filter((p) => sides.some((v) => v[p]));
  // Systems: the costliest on the first side (cruise, else the first phase), FRAME first.
  const ref = rowsOf(base.cruise ?? base[phases[0]]);
  const systems = Object.entries(base.cruise?.per ?? base[phases[0]].per ?? {})
    .sort((a, b) => b[1].msPerFrame - a[1].msPerFrame)
    .map(([k]) => k)
    .filter((k) => k !== 'FRAME')
    .slice(0, rows);
  const names = ['FRAME', ...systems, 'garbage MB/s', 'GC/s', 'GPU ms', 'calls', 'triangles k', 'FPS', 'frame gap p99 ms'].filter((k) => k in ref || sides.some((v) => phases.some((p) => k in rowsOf(v[p]))));
  const cell = (k, p) => {
    const a = rowsOf(base[p])[k];
    if (!current) return fmt(a);
    const b = rowsOf(current[p])[k];
    const d = typeof a === 'number' && typeof b === 'number' && a !== 0 ? `${b >= a ? '+' : ''}${Math.round(((b - a) / a) * 100)}%` : '';
    return `${pad(`${fmt(a)} → ${fmt(b)}`, 15)} ${lpad(d, 5)}`;
  };
  const w0 = Math.max(...names.map((n) => n.length)) + 2;
  const cells = names.map((k) => phases.map((p) => cell(k, p)));
  const w = Math.max(...phases.map((p) => p.length), ...cells.flat().map((c) => c.length)) + 3;
  const lines = [pad('', w0) + phases.map((p) => pad(p, w)).join('')];
  names.forEach((k, i) => lines.push(pad(k, w0) + cells[i].map((c) => pad(c, w)).join('')));
  // Whole-run facts: stats, budget, memory.
  const fact = (name, get) => {
    const a = get(base);
    const b = current ? get(current) : undefined;
    if (a === undefined && b === undefined) return;
    lines.push(`${name}: ${JSON.stringify(a)}${current ? ` → ${JSON.stringify(b)}` : ''}`);
  };
  fact('stats', (v) => v.stats);
  fact('budget', (v) => v.budget);
  fact('mixedMaterials', (v) => (v.mixedMaterials?.length ? v.mixedMaterials : undefined));
  fact('staleMatrices', (v) => (v.staleMatrices?.length ? v.staleMatrices : undefined));
  fact('memory', (v) => v.memory && { jsHeapMB: v.memory.jsHeapMB, geometryHeapMB: v.memory.geometryHeapMB, geometryMB: v.memory.geometryMB, textureMB: v.memory.textureMB });
  return lines.join('\n');
}

/** Table text for a whole check:browser output (one side or --vs), plus logs and profile tops. */
export function perfReport(out, opts) {
  const vs = out.base && out.current;
  const table = vs ? perfTable(out.base.val, out.current.val, opts) : perfTable(out.val, null, opts);
  if (!table) return null;
  const lines = [vs ? (out.sha === 'same tree' ? `perf-profile: ${out.vs} → --make` : `perf-profile: ${out.vs} (${out.sha}) → working tree`) : 'perf-profile', table];
  for (const [side, r] of vs ? [['base', out.base], ['current', out.current]] : [['', out]]) {
    const tag = side ? `${side} ` : '';
    if (r.logs?.length) lines.push(`${tag}logs: ${r.logs.slice(0, 5).join(' | ')}`);
    if (r.profile) lines.push(`${tag}cpu: ${r.profile.cpuSelfPct.slice(0, 10).join(', ')}`);
    if (r.cityLoadMs !== undefined) lines.push(`${tag}cityLoadMs: ${r.cityLoadMs}`);
  }
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/perf-table.mjs <check:browser output .json> [--rows N]');
    process.exit(1);
  }
  const text = readFileSync(file, 'utf8');
  const out = JSON.parse(text.slice(text.indexOf('{')));
  const i = process.argv.indexOf('--rows');
  const report = perfReport(out, { rows: i > 0 ? Number(process.argv[i + 1]) : 14 });
  if (!report) {
    console.error(`${file}: not a perf-profile.js result`);
    process.exit(1);
  }
  console.log(report);
}
