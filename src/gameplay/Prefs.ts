// Player preferences kept between sessions: mute and difficulty. The site shares its origin (and so
// its localStorage) with other pages, so everything lives under one key of our own and nothing
// else is touched. Storage is injected for tests.

export interface Prefs {
  muted: boolean;
  difficulty: string | null; // a difficulty id; null until one is picked
}

export interface PrefStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = 'car-pursuit/prefs';
const OLD_DIFFICULTY_KEY = 'cp-difficulty'; // ours, from before prefs had a key of their own

export function loadPrefs(store: PrefStore | null): Prefs {
  const prefs: Prefs = { muted: false, difficulty: null };
  try {
    const raw = store?.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (typeof saved?.muted === 'boolean') prefs.muted = saved.muted;
    if (typeof saved?.difficulty === 'string') prefs.difficulty = saved.difficulty;
    const old = store?.getItem(OLD_DIFFICULTY_KEY);
    if (store && old !== null && old !== undefined) {
      prefs.difficulty ??= old;
      savePrefs(store, prefs);
      store.removeItem(OLD_DIFFICULTY_KEY);
    }
  } catch {
    // Corrupt or unavailable storage: defaults.
  }
  return prefs;
}

export function savePrefs(store: PrefStore | null, prefs: Prefs): void {
  try {
    store?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Not persisted (private mode, full storage); fine.
  }
}
