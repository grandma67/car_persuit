// A temporary git worktree of a ref, with node_modules linked, for the `--vs` of `npm run hash`,
// `npm run cops` and `npm run check:browser`. It goes when the process ends: normally, on an error or
// on a signal (Ctrl+C). Nothing can run on a SIGKILL, so the name carries the owner's pid and every
// new one first removes those whose owner is gone.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const PREFIX = 'cp-worktree-';
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });

function removeTree(dir) {
  try {
    git('worktree', 'remove', '--force', dir);
  } catch {} // never registered, or already gone
  rmSync(dir, { recursive: true, force: true });
  try {
    git('worktree', 'prune');
  } catch {}
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

/** The worktrees of runs that were killed outright. */
function sweep() {
  const paths = git('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9));
  for (const dir of paths) {
    const owner = basename(dir).startsWith(PREFIX) ? Number(basename(dir).slice(PREFIX.length).split('-')[0]) : 0;
    if (owner && owner !== process.pid && !alive(owner)) removeTree(dir);
  }
}

const trees = new Set();
const removeAll = () => {
  for (const dir of trees) removeTree(dir);
  trees.clear();
};
// A signal's default ends the process without 'exit'; with a handler, exit runs. A blocking
// execFileSync delays the handler until that child ends: Ctrl+C reaches the child too, so at once.
const SIGNALS = [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1], ['SIGALRM', 14]].map(([sig, n]) => [sig, () => process.exit(128 + n)]);
function hook(on) {
  for (const [sig, handler] of SIGNALS) on ? process.on(sig, handler) : process.off(sig, handler);
}
process.on('exit', removeAll);

/** A worktree of `ref` that lasts as long as this process; returns its folder and how to drop it early. */
export function tempWorktree(ref) {
  if (!trees.size) hook(true);
  sweep();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `${PREFIX}${process.pid}-`)));
  trees.add(dir); // before `git worktree add`, so a Ctrl+C during it is covered
  git('worktree', 'add', '--detach', '-q', dir, ref);
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
  return {
    dir,
    remove() {
      trees.delete(dir);
      removeTree(dir);
      if (!trees.size) hook(false); // nothing left to clean: a signal may end the process plainly again
    },
  };
}
