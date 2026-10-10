// Local leaderboard: best time per city + difficulty, and a top-10 of all wins. Stored in the
// browser (the game is a static site, so there's no shared server). Storage is injected for tests.

export interface RunRecord {
  seed: number;
  difficulty: string;
  seconds: number;
  date: string; // ISO date
}

export interface RecordStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = 'cp-records-v1';
const TOP = 10;

export class Records {
  private runs: RunRecord[] = [];

  constructor(private store: RecordStore | null) {
    try {
      const raw = store?.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) this.runs = parsed.filter((r) => typeof r?.seconds === 'number' && typeof r?.seed === 'number');
    } catch {
      this.runs = []; // corrupt or unavailable storage: start fresh
    }
  }

  best(seed: number, difficulty: string): RunRecord | null {
    return this.runs.filter((r) => r.seed === seed && r.difficulty === difficulty).sort((a, b) => a.seconds - b.seconds)[0] ?? null;
  }

  /** Fastest wins overall. */
  top(n = TOP): RunRecord[] {
    return [...this.runs].sort((a, b) => a.seconds - b.seconds).slice(0, n);
  }

  /** Record a win. Returns whether it beat the previous best for this city + difficulty. */
  add(run: RunRecord): { newBest: boolean; rank: number | null } {
    const previous = this.best(run.seed, run.difficulty);
    this.runs.push(run);
    // Keep the best per city+difficulty plus the overall top list; drop the rest.
    const keep = new Set<RunRecord>(this.top(TOP));
    for (const r of this.runs) if (this.best(r.seed, r.difficulty) === r) keep.add(r);
    this.runs = this.runs.filter((r) => keep.has(r));
    try {
      this.store?.setItem(KEY, JSON.stringify(this.runs));
    } catch {
      // Storage full/blocked: the record still counts for this session.
    }
    const rank = this.top(TOP).indexOf(run);
    return { newBest: !previous || run.seconds < previous.seconds, rank: rank >= 0 ? rank + 1 : null };
  }
}
