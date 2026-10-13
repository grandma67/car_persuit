import { describe, expect, it } from 'vitest';
import { loadPrefs, savePrefs, type PrefStore } from './Prefs';

function memoryStore(entries: Record<string, string> = {}): PrefStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(entries));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('Prefs', () => {
  it('defaults when nothing is saved or storage is unavailable', () => {
    expect(loadPrefs(memoryStore())).toEqual({ muted: false, difficulty: null });
    expect(loadPrefs(null)).toEqual({ muted: false, difficulty: null });
  });

  it('round-trips under its own key, leaving other keys alone', () => {
    const store = memoryStore({ 'someone-elses-app': 'x' });
    savePrefs(store, { muted: true, difficulty: 'hard' });
    expect(loadPrefs(store)).toEqual({ muted: true, difficulty: 'hard' });
    expect([...store.data.keys()].sort()).toEqual(['car-pursuit/prefs', 'someone-elses-app']);
  });

  it('moves the old difficulty key into the prefs', () => {
    const store = memoryStore({ 'cp-difficulty': 'easy' });
    expect(loadPrefs(store).difficulty).toBe('easy');
    expect(store.data.has('cp-difficulty')).toBe(false);
    expect(loadPrefs(store).difficulty).toBe('easy');
  });

  it('survives corrupt data', () => {
    expect(loadPrefs(memoryStore({ 'car-pursuit/prefs': '{nope' }))).toEqual({ muted: false, difficulty: null });
  });
});
