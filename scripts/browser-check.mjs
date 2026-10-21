#!/usr/bin/env node
// Headless browser check: starts the Vite dev server (unless --url is given), opens the game in
// headless Chrome with audio muted, waits for the splash to finish, optionally presses Start, runs
// a JS expression in the page, saves a screenshot, and prints JSON: the expression's value plus any
// console errors/warnings and uncaught exceptions. Needs Google Chrome; no npm dependencies.
//
//   node scripts/browser-check.mjs --query "seed=42&debug" --out /tmp/shot.png \
//     --eval "JSON.stringify({programs: game.renderer.info.programs.length, calls: game.renderer.info.render.calls})"
//
// Several views in one run: the expression can `await shot('name')` to save <out-dir>/name.png at
// that moment (with ?debug, `dbg` frames things for it: see src/core/debugTools.ts):
//
//   node scripts/browser-check.mjs --query "seed=11&debug&oldtown=1" --start 2000 --out-dir /tmp/s \
//     --eval "(async () => { await dbg.gate(0); await shot('gate'); await dbg.view(dbg.find('well')); await shot('square'); return dbg.stats(); })()"
//
// Options:
//   --query    URL query string (add `debug` so `window.game` and `window.dbg` exist)  default "debug"
//   --url      full URL of an already-running server (skips starting Vite)
//   --out      final screenshot path                                    default ./browser-check.png
//   --out-dir  where shot('name') saves                                default the --out file's folder
//   --eval     JS expression (may return a promise), result printed as `val`  default none
//   --eval-file  read the expression from a file instead (no shell quoting)
//   --no-final   skip the screenshot after the expression (when it took its own shots)
//   --start  press Enter to start the mission, then wait this many ms        default off
//   --size   viewport WxH (390x844 for a phone)                               default 1280x800
//   --port   Vite port                                                        default 5199
// A Vite server already listening on --port is reused (start one with `npx vite --port 5199`).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1] === undefined || all[i + 1].startsWith('--') ? 'true' : all[i + 1]]] : pairs), []),
);
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const vitePort = Number(args.port ?? 5199);
const debugPort = vitePort + 1000;
const [w, h] = (args.size ?? '1280x800').split('x').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const vite = spawn('npx', ['vite', '--port', String(vitePort), '--strictPort'], { stdio: 'ignore' });
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
  '--headless=new', '--mute-audio', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cp-chrome-'))}`,
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
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

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
if (args.start) {
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))`);
  await sleep(Number(args.start) || 5000);
}
const expression = args['eval-file'] ? readFileSync(args['eval-file'], 'utf8') : args.eval;
const val = expression ? await evaluate(expression) : undefined;
if (!args['no-final']) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  shots.push(out);
}
// The deprecated-parameters warning from Rapier's init is always there: leave it out.
const quiet = logs.filter((l) => !l.includes('deprecated parameters for the initialization function'));
console.log(JSON.stringify({ url, shots, val, logs: quiet }, null, 2));
ws.close();
cleanup();
process.exit(0);
