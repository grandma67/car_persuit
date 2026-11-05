#!/usr/bin/env node
// Audio start-up with real input (knowledge/AUDIO_LIMITS.md). `check:browser` can't test this: its
// evals run as user gestures, so a context is never blocked and the autoplay warnings never appear.
// Fresh Chrome per case, keys and touches through the debugger protocol, every console message and
// exception collected: any of them fails the case (but Rapier's own, below). Audio level read from an
// analyser on the output. Only Chrome on this machine: the phone case is emulated touch, not Android.
//   npm run check:audio                 all cases on this tree (~1 min)
//   npm run check:audio -- --ref main   the same on a ref (temporary worktree)
// Under a hard limit like any browser run: perl -e 'alarm 200; exec @ARGV' npm run check:audio
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { tempWorktree } from './temp-worktree.mjs';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VITE_PORT = 5198;
const DEBUG_PORT = 6198;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const i = process.argv.indexOf('--ref');
const root = i > 0 ? tempWorktree(process.argv[i + 1]).dir : resolve(import.meta.dirname, '..');
const children = new Set();
process.on('exit', () => children.forEach((c) => c.kill('SIGKILL')));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

// Before the page's scripts: the contexts made and their cost, and each one's output level.
const SPY = `(() => {
  const AC = window.AudioContext, spy = (window.spy = { contexts: [], analysers: [] });
  window.AudioContext = class extends AC {
    constructor(o) { const t = performance.now(); super(o); spy.contexts.push(this); spy.ctorMs = +(performance.now() - t).toFixed(1); }
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest === this.context.destination) { const a = this.context.createAnalyser(); connect.call(this, a); spy.analysers.push(a); }
    return connect.call(this, dest, ...rest);
  };
  spy.level = async () => {
    let peak = 0; const buf = new Float32Array(2048);
    for (let n = 0; n < 12; n++) {
      for (const a of spy.analysers) { a.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); }
      await new Promise((r) => setTimeout(r, 50));
    }
    return +peak.toFixed(4);
  };
  spy.gap = async (ms = 900) => {
    let last = performance.now(), max = 0; const end = last + ms;
    await new Promise((done) => { const t = () => { const x = performance.now(); max = Math.max(max, x - last); last = x; x < end ? requestAnimationFrame(t) : done(); }; requestAnimationFrame(t); });
    return Math.round(max);
  };
})()`;

async function openChrome(mobile) {
  const dir = mkdtempSync(join(tmpdir(), 'cp-audio-'));
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${dir}`, '--window-size=1280,800', '--enable-gpu', '--ignore-gpu-blocklist', 'about:blank'], { stdio: 'ignore' });
  children.add(chrome);
  let target;
  for (let n = 0; n < 80 && !target; n++) {
    await sleep(150);
    try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()).find((t) => t.type === 'page'); } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const waiting = new Map();
  const logs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) waiting.get(m.id)?.(m);
    if (m.method === 'Log.entryAdded' && m.params.entry.level !== 'verbose' && m.params.entry.level !== 'info') logs.push(m.params.entry.text.slice(0, 110));
    if (m.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(m.params.type)) logs.push(String(m.params.args[0]?.value ?? m.params.args[0]?.description).slice(0, 110));
    if (m.method === 'Runtime.exceptionThrown') logs.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`.slice(0, 110));
  };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value; // no userGesture: as a page script
  for (const domain of ['Log', 'Runtime', 'Page']) await send(`${domain}.enable`);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: SPY });
  if (mobile) {
    await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  const key = async (code, k = code, down = 60, vk = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, windowsVirtualKeyCode: vk, ...(k.length === 1 ? { text: k } : {}) });
    await sleep(down);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, windowsVirtualKeyCode: vk });
  };
  const tap = async (x, y) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(40);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const waitFor = async (expr, ms = 30000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await evaluate(expr)) return true;
    return false;
  };
  const close = async () => { ws.close(); chrome.kill('SIGKILL'); children.delete(chrome); await sleep(200); rmSync(dir, { recursive: true, force: true }); };
  return { send, evaluate, key, tap, waitFor, logs, close };
}

const STATE = `spy.contexts[0]?.state ?? 'none'`;
const READY = `!document.querySelector('.splash-continue')?.hidden`;
const DONE = `!!document.querySelector('#splash.done')`;
const START = `document.querySelector('[data-action="start"]')`;
const CENTRE = `(() => { const r = ${START}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;

/** Runs a case: `steps` get the page and a `check` function; returns what they noted. */
async function run(name, { query, mobile = false }, steps) {
  const page = await openChrome(mobile);
  const failures = [];
  const notes = {};
  const check = (ok, what) => ok || failures.push(what);
  try {
    await page.send('Page.navigate', { url: `http://localhost:${VITE_PORT}/?${query}` });
    await steps(page, check, notes);
    check(await page.evaluate('spy.contexts.length') === 1, `${await page.evaluate('spy.contexts.length')} contexts`);
  } catch (e) {
    failures.push(String(e));
  }
  // Rapier's own loader logs this on every load (0.18.2, nothing to pass it; check:browser skips it too).
  const logs = page.logs.filter((l) => !l.includes('deprecated parameters for the initialization function'));
  check(logs.length === 0, `${logs.length} console messages`);
  const res = { name, ok: !failures.length, ...notes, failures, logs: [...new Set(logs)].slice(0, 4), logCount: logs.length };
  await page.close();
  return res;
}

const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--port', String(VITE_PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
children.add(vite);
for (let n = 0; n < 80; n++) {
  await sleep(150);
  try { if ((await fetch(`http://localhost:${VITE_PORT}/`)).ok) break; } catch {}
}

const results = [];
// First visit on a keyboard, as most players start.
results.push(await run('desktop, first visit', { query: 'seed=9' }, async (p, check, n) => {
  check(await p.waitFor(READY), 'no "press any key"');
  n.ctorMs = await p.evaluate('spy.ctorMs');
  check(await p.evaluate(STATE) === 'suspended', `loaded: ${await p.evaluate(STATE)}`);
  n.idleGapMs = await p.evaluate('spy.gap()'); // what the next gap compares with: a player doesn't press at once
  const gap = p.evaluate('spy.gap()');
  await p.key('Space', ' ');
  n.dismissGapMs = await gap;
  check(await p.waitFor(`${STATE} === 'running'`, 2000), `after a key: ${await p.evaluate(STATE)}`);
  n.menuLevel = await p.evaluate('spy.level()');
  check(n.menuLevel > 0, 'menu music silent');
  await p.key('Enter', 'Enter', 60, 13);
  await sleep(600);
  check(await p.evaluate(`${STATE} === 'running'`), 'not running after Start');
}));
// Escape dismisses the splash but is no activation: nothing may start until a key that is one.
results.push(await run('desktop, Escape on the splash', { query: 'seed=9' }, async (p, check, n) => {
  check(await p.waitFor(READY), 'no "press any key"');
  await p.key('Escape', 'Escape');
  await sleep(300);
  check(await p.evaluate(STATE) === 'suspended', `Escape: ${await p.evaluate(STATE)}`);
  await p.key('KeyM', 'm');
  await p.key('KeyM', 'm'); // mute and back: real keys on the menu, the second with sounds built
  check(await p.waitFor(`${STATE} === 'running'`, 2000), `after a key: ${await p.evaluate(STATE)}`);
  n.menuLevel = await p.evaluate('spy.level()');
  check(n.menuLevel > 0, 'menu music silent');
}));
// First visit on a phone: tap to continue (the touch's pointerdown is no activation), tap Start.
results.push(await run('phone, first visit', { query: 'seed=9', mobile: true }, async (p, check, n) => {
  check(await p.waitFor(READY), 'no "tap to continue"');
  check(await p.evaluate(STATE) === 'suspended', `loaded: ${await p.evaluate(STATE)}`);
  n.idleGapMs = await p.evaluate('spy.gap()');
  const dismiss = p.evaluate('spy.gap()');
  await p.tap(200, 450);
  n.dismissGapMs = await dismiss;
  check(await p.waitFor(`${STATE} === 'running'`, 2000), `after a tap: ${await p.evaluate(STATE)}`);
  n.menuLevel = await p.evaluate('spy.level()');
  check(n.menuLevel > 0, 'menu music silent');
  check(await p.waitFor(`!!${START}`, 3000), 'no menu');
  const [x, y] = await p.evaluate(CENTRE);
  await sleep(800); // the splash's fade
  const gap = p.evaluate('spy.gap()');
  await p.tap(x, y);
  n.startGapMs = await gap;
  await sleep(200);
  check(await p.evaluate(`!${START} || ${START}.closest('.screen')?.hidden`), 'Start tap did nothing');
  check(await p.evaluate(`${STATE} === 'running'`), 'not running after Start');
}));
// A reload (no prompt), the game's whole round: Start first, engine, pause, wreck, Retry.
results.push(await run('desktop, reload: Start is the first gesture', { query: 'seed=9&debug' }, async (p, check, n) => {
  check(await p.waitFor(`${DONE} && window.game?.state === 'menu'`), 'no menu');
  check(await p.evaluate(STATE) === 'suspended', `loaded: ${await p.evaluate(STATE)}`);
  n.idleGapMs = await p.evaluate('spy.gap()');
  const gap = p.evaluate('spy.gap()');
  await p.key('Enter', 'Enter', 60, 13);
  n.startGapMs = await gap;
  check(await p.waitFor(`${STATE} === 'running'`, 2000), `after Start: ${await p.evaluate(STATE)}`);
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', text: 'w', windowsVirtualKeyCode: 87 });
  await sleep(500);
  n.engineLevel = await p.evaluate('spy.level()');
  check(n.engineLevel > 0, 'engine silent');
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  await p.evaluate('game.setPaused(true)');
  check(await p.waitFor(`${STATE} === 'suspended'`, 1000), `paused: ${await p.evaluate(STATE)}`);
  await p.evaluate('game.setPaused(false)');
  check(await p.waitFor(`${STATE} === 'running'`, 1000), `unpaused: ${await p.evaluate(STATE)}`);
  await p.evaluate('dbg.police(false); game.applyDamage(0, 1e6)');
  check(await p.waitFor(`!!document.querySelector('[data-action="retry"]')`, 5000), 'no end screen');
  await p.evaluate('window.oldGame = game');
  await p.key('Enter', 'Enter', 60, 13);
  check(await p.waitFor(`window.game !== window.oldGame && ${DONE}`), 'Retry made no new game');
  await sleep(500);
  check(await p.evaluate(`${STATE} === 'running'`), `after Retry: ${await p.evaluate(STATE)}`);
}));
for (const r of results) console.log(JSON.stringify(r));
process.exit(results.every((r) => r.ok) ? 0 : 1);
