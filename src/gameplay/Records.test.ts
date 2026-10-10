import { describe, expect, it } from 'vitest';
import { Records, type RecordStore } from './Records';
import { DIFFICULTIES, difficultyById, scaledCopCap } from './difficulty';

const memory = (): RecordStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const run = (seed: number, seconds: number, difficulty = 'normal') => ({ seed, seconds, difficulty, date: '2026-10-10' });

describe('Records', () => {
  it('tracks best time per city and difficulty', () => {
    const r = new Records(memory());
    expect(r.add(run(42, 400)).newBest).toBe(true);
    expect(r.add(run(42, 450)).newBest).toBe(false);
    expect(r.add(run(42, 380)).newBest).toBe(true);
    expect(r.add(run(42, 500, 'hard')).newBest).toBe(true); // separate board per difficulty
    expect(r.best(42, 'normal')!.seconds).toBe(380);
    expect(r.best(7, 'normal')).toBeNull();
  });

  it('persists and reloads', () => {
    const store = memory();
    new Records(store).add(run(1, 300));
    expect(new Records(store).best(1, 'normal')!.seconds).toBe(300);
  });

  it('keeps a top-10 and reports rank', () => {
    const r = new Records(memory());
    for (let i = 0; i < 15; i++) r.add(run(i, 600 - i * 10));
    expect(r.top()).toHaveLength(10);
    expect(r.top()[0].seconds).toBe(460);
    expect(r.add(run(99, 100)).rank).toBe(1);
  });

  it('survives corrupt or missing storage', () => {
    const store = memory();
    store.data.set('cp-records-v1', '{not json');
    expect(new Records(store).top()).toEqual([]);
    const none = new Records(null);
    expect(none.add(run(1, 300)).newBest).toBe(true);
  });
});

describe('difficulty', () => {
  it('scales from easy to hard and defaults to normal', () => {
    const [easy, normal, hard] = DIFFICULTIES;
    expect(easy.timeLimit).toBeGreaterThan(normal.timeLimit);
    expect(hard.damageScale).toBeGreaterThan(normal.damageScale);
    expect(easy.maxHealth).toBeGreaterThan(normal.maxHealth);
    expect(easy.armor).toBeGreaterThan(normal.armor);
    expect(difficultyById('nope').id).toBe('normal');
    expect(scaledCopCap(2, easy)).toBe(2); // round(1.5)
    expect(scaledCopCap(10, hard)).toBe(13);
    expect(scaledCopCap(1, easy)).toBe(1);
  });
});
