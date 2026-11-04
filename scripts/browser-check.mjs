#!/usr/bin/env node
// Headless browser check (knowledge/BROWSER_CHECKS.md): starts Vite on --port unless one is up or
// --url is given, opens the game in headless Chrome (muted, gc() exposed), waits for the splash,
// optionally loads a city and presses Start, runs an expression in the page as a user gesture, and
// prints JSON: `url`, `shots`, the expression's `val`, console errors/warnings and exceptions (`logs`).
// The expression may `await shot('name')` any number of times (saves <out-dir>/name.png).
//
//   node scripts/browser-check.mjs --query "seed=11&debug&oldtown=1" --start 2000 --out-dir /tmp/s \
//     --no-final --eval "(async () => { await dbg.gate(0); await shot('gate'); return dbg.stats(); })()"
//
//   --query      URL query (`debug` gives window.game and window.dbg)               default "debug"
//   --url        full URL of a running server (skips Vite)
//   --root       folder to start Vite in (--vs passes its worktree)                 default here
//   --port       Vite port (Chrome's debugger: port + 1000)                         default 5199
//   --eval       JS expression (may return a promise); --eval-file reads it from a file
//   --out        final screenshot                                                   default ./browser-check.png
//   --out-dir    where shot('name') saves                                           default --out's folder
//   --no-final   no screenshot after the expression
//   --city f     a params file (npm run city -- make/dump), loaded with dbg.loadCity before --start
//   --make "w…"  npm run city -- make <words> into a temp file, loaded as --city
//   --start ms   press Enter to start the mission, then wait ms                     default off
//   --size WxH   viewport (390x844: a phone)                                        default 1280x800
//   --throttle N CPU slowdown during the expression (4: a mid-range phone's CPU)
//   --profile f  CPU + heap sampling profiles around the expression, saved to f; prints the top self
//                time and self bytes per `function url:line` (`profile`)
//   --table      a perf-profile.js result as a compact table (with --vs: both sides, Δ%) instead of
//                the JSON, which goes to --json (default <out-dir>/result.json); other evals print JSON
//   --json f     also save the full output JSON to f
//   --wait-lock s  another run holds this port: wait up to s seconds for it (default 900), then give up
//   --vs ref     the same run on that ref first (worktree in the temp dir, kept for next time; its own
//                Vite on port + 100), then here, one after the other; prints { vs, sha, base, current },
//                shots in <out-dir>/base and /current, --profile per side. Delete old worktrees with
//                `git worktree remove`.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { perfReport } from './perf-table.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1] === undefined || all[i + 1].startsWith('--') ? 'true' : all[i + 1]]] : pairs), []),
);
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const vitePort = Number(args.port ?? 5199);
const debugPort = vitePort + 1000;
const [w, h] = (args.size ?? '1280x800').split('x').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One run at a time per port: two runs share Vite's port and Chrome's debugger port and trade pages
// (shots from one city land in the other's folder). A second run waits for the first (lock file with
// its pid in the temp dir; a dead pid's lock is taken over), up to --wait-lock s (default 900).
const lock = join(tmpdir(), `car-pursuit-check-${vitePort}.lock`);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
for (let waited = 0, said = false; ; waited += 2) {
  try {
    writeFileSync(lock, String(process.pid), { flag: 'wx' });
    break;
  } catch {
    const pid = Number(readFileSync(lock, 'utf8'));
    if (!pid || !alive(pid)) {
      rmSync(lock, { force: true });
      continue;
    }
    if (waited >= Number(args['wait-lock'] ?? 900)) {
      process.stderr.write(`port ${vitePort} still busy with run pid ${pid} after ${waited} s: giving up\n`);
      process.exit(1);
    }
    if (!said) process.stderr.write(`port ${vitePort} busy (browser check pid ${pid}): waiting for it…\n`);
    said = true;
    await sleep(2000);
  }
}
process.on('exit', () => {
  try {
    if (readFileSync(lock, 'utf8') === String(process.pid)) rmSync(lock, { force: true });
  } catch {}
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
/** JSON with objects broken into lines `depth` levels down and anything deeper on one line (fewer lines to read). */
const print = (v, depth, pad = '') =>
  depth && v && typeof v === 'object' && !Array.isArray(v)
    ? `{\n${Object.entries(v).map(([k, x]) => `${pad}  ${JSON.stringify(k)}: ${print(x, depth - 1, `${pad}  `)}`).join(',\n')}\n${pad}}`
    : JSON.stringify(v);
if (args.make) {
  args.city = join(mkdtempSync(join(tmpdir(), 'cp-city-')), 'city.json');
  const made = execFileSync('node', ['scripts/run-ts.mjs', 'scripts/city.ts', 'make', ...args.make.split(/\s+/), '--out', args.city], { encoding: 'utf8' });
  process.stderr.write(made);
}

// --vs: run this same check on a ref (in a worktree, its own Vite), then here, and print both.
if (args.vs) {
  const sha = execFileSync('git', ['rev-parse', '--short', args.vs], { encoding: 'utf8' }).trim();
  const tree = join(tmpdir(), `cp-vs-${sha}`);
  if (!existsSync(tree)) {
    execFileSync('git', ['worktree', 'add', '--detach', tree, sha], { stdio: 'ignore' });
    symlinkSync(resolve('node_modules'), join(tree, 'node_modules'));
  }
  const basePort = vitePort + 100;
  try {
    await fetch(`http://localhost:${basePort}/`);
    console.error(`--vs: port ${basePort} is taken (a server from another tree?): stop it first`);
    process.exit(1);
  } catch {}
  const outDir = args['out-dir'] ?? dirname(args.out ?? 'browser-check.png');
  const pass = Object.entries(args).flatMap(([k, v]) =>
    ['vs', 'make', 'port', 'out', 'out-dir', 'root', 'profile', 'table', 'json'].includes(k) ? [] : [`--${k}`, ...(v === 'true' ? [] : [k === 'eval-file' || k === 'city' ? resolve(v) : v])],
  );
  const run = (side, extra) => {
    const dir = join(outDir, side);
    const profile = args.profile ? ['--profile', resolve(args.profile).replace(/(\.json)?$/, `.${side}.json`)] : [];
    const text = execFileSync('node', [process.argv[1], ...pass, ...profile, '--out-dir', dir, '--out', join(dir, 'final.png'), ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28 });
    return JSON.parse(text);
  };
  const base = run('base', ['--port', String(basePort), '--root', tree]);
  const current = run('current', ['--port', String(vitePort)]);
  finish({ vs: args.vs, sha, base, current }, 3, outDir);
  process.exit(0);
}

/** Print the result: JSON, or with --table a perf-profile table (the JSON saved beside it). */
function finish(result, depth, outDir) {
  const json = print(result, depth);
  const file = args.json ?? (args.table ? join(outDir, 'result.json') : null);
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, json);
  }
  const report = args.table ? perfReport(result) : null;
  if (args.table && !report) process.stderr.write('--table: not a perf-profile.js result, printing the JSON\n');
  console.log(report ? `${report}\nfull result: ${file}` : json);
}

const children = [];
const cleanup = () => children.forEach((c) => c.kill());
process.on('exit', cleanup);

const up = async () => {
  try {
    return (await fetch(`http://localhost:${vitePort}/`)).ok;
  } catch {
    return false;
  }
};
let url = args.url;
if (!url && (await up())) url = `http://localhost:${vitePort}/?${args.query ?? 'debug'}`; // reuse a running server
if (!url) {
  const vite = spawn('npx', ['vite', '--port', String(vitePort), '--strictPort'], { stdio: 'ignore', cwd: args.root ?? process.cwd() });
  children.push(vite);
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      if ((await fetch(`http://localhost:${vitePort}/`)).ok) break;
    } catch {}
  }
  url = `http://localhost:${vitePort}/?${args.query ?? 'debug'}`;
}

const chrome = spawn(CHROME, [
  '--headless=new', '--mute-audio', '--js-flags=--expose-gc', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cp-chrome-'))}`,
  `--window-size=${w},${h}`, '--enable-gpu', '--ignore-gpu-blocklist',
  '--ignore-certificate-errors', // `npm run dev:https` serves a self-signed certificate
  'about:blank',
], { stdio: 'ignore' });
children.push(chrome);

let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(250);
  try {
    target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === 'page');
  } catch {}
}
if (!target) throw new Error('Chrome did not start');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
  if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) {
    logs.push(`${d.params.type}: ${d.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  }
  if (d.method === 'Runtime.bindingCalled' && d.params.name === '__shot') takeShot(d.params.payload);
  if (d.method === 'Runtime.exceptionThrown') logs.push(`exception: ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })).result?.result?.value;

const out = args.out ?? 'browser-check.png';
const outDir = args['out-dir'] ?? dirname(out);
mkdirSync(outDir, { recursive: true });
const shots = [];
// shot('name') in the page: screenshot now, then resolve the page's promise.
async function takeShot(name) {
  const file = join(outDir, `${String(name).replace(/[^\w.-]/g, '_')}.png`);
  const img = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(img.result.data, 'base64'));
  shots.push(file);
  await send('Runtime.evaluate', { expression: 'window.__shotDone && window.__shotDone()' });
}

await send('Runtime.enable');
await send('Page.enable');
await send('Runtime.addBinding', { name: '__shot' });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: 'window.shot = (name) => new Promise((done) => { window.__shotDone = done; window.__shot(String(name)); });',
});
await send('Page.navigate', { url });
// Ready once the splash has gone (with ?debug it skips the "press any key" step).
for (let i = 0; i < 150; i++) {
  await sleep(400);
  if (await evaluate(`!!document.querySelector('#splash.done') || !document.querySelector('#splash')`)) break;
}
await sleep(1000);
// --city: the page built its URL seed first; the file's city replaces it in place (no URL flag).
// Timed until the next Game has drawn two frames: `cityLoadMs` (the first load of a look in a fresh
// page compiles its shaders cold; a reload of it in the same page is warm, see cold-load.js).
let cityLoadMs;
if (args.city) {
  const t0 = Date.now();
  const loaded = await send('Runtime.evaluate', {
    expression: `(async () => { await dbg.loadCity(${JSON.stringify(readFileSync(args.city, 'utf8'))}); const r = window.game.renderer.info.render, f = r.frame; while (window.game.renderer.info.render.frame < f + 2) await new Promise((d) => setTimeout(d, 5)); })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  cityLoadMs = Date.now() - t0;
  if (loaded.result?.exceptionDetails) {
    console.error(`--city ${args.city}: ${loaded.result.exceptionDetails.exception?.description ?? loaded.result.exceptionDetails.text}`);
    ws.close();
    cleanup();
    process.exit(1);
  }
  await sleep(1000);
}
if (args.start) {
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))`);
  await sleep(Number(args.start) || 5000);
}
const expression = args['eval-file'] ? readFileSync(args['eval-file'], 'utf8') : args.eval;
if (args.throttle) await send('Emulation.setCPUThrottlingRate', { rate: Number(args.throttle) });
if (args.profile) {
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 200 });
  await send('Profiler.start');
  await send('HeapProfiler.enable');
  await send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
}
let val;
if (expression) {
  const r = (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })).result;
  val = r?.result?.value;
  const ex = r?.exceptionDetails;
  if (ex) logs.push(`eval threw: ${ex.exception?.description ?? ex.text}`);
}
let profile;
if (args.profile) {
  const cpu = (await send('Profiler.stop')).result.profile;
  const heap = (await send('HeapProfiler.stopSampling')).result.profile;
  const site = (f) => `${f.functionName || '(anon)'} ${f.url.replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`;
  const top = (m, n, scale, unit) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v * scale).toFixed(1)}${unit} ${k}`);
  const self = new Map();
  const hits = cpu.nodes.reduce((t, n) => t + (n.hitCount ?? 0), 0) || 1;
  for (const n of cpu.nodes) self.set(site(n.callFrame), (self.get(site(n.callFrame)) ?? 0) + (n.hitCount ?? 0));
  const bytes = new Map();
  const walk = (n) => (bytes.set(site(n.callFrame), (bytes.get(site(n.callFrame)) ?? 0) + n.selfSize), n.children.forEach(walk));
  walk(heap.head);
  const totalMB = [...bytes.values()].reduce((a, b) => a + b, 0) / 1e6;
  profile = { file: args.profile, cpuSelfPct: top(self, 30, 100 / hits, '%'), heapTotalMB: +totalMB.toFixed(1), heapSelfMB: top(bytes, 30, 1e-6, 'MB') };
  writeFileSync(args.profile, JSON.stringify({ cpu, heap }));
}
if (args.throttle) await send('Emulation.setCPUThrottlingRate', { rate: 1 });
if (!args['no-final']) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  shots.push(out);
}
// The deprecated-parameters warning from Rapier's init is always there: leave it out.
const quiet = logs.filter((l) => !l.includes('deprecated parameters for the initialization function'));
finish({ url, shots, val, logs: quiet, ...(cityLoadMs !== undefined ? { cityLoadMs } : {}), ...(profile ? { profile } : {}) }, 2, args['out-dir'] ?? dirname(out));
ws.close();
cleanup();
process.exit(0);
