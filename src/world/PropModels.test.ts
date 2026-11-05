import { describe, expect, it } from 'vitest';
import { describeOverlap, propFights } from './zfight';

// Two parts of a prop model sharing a plane, facing the same way, in different colours: they
// z-fight (flicker) wherever they overlap. Parts must enclose each other or keep faces >= 1 cm apart.
// `npm run zfight -- props` lists every overlap.

describe('prop models', () => {
  it('no two parts of a model z-fight', () => {
    const fighting = new Map<string, string>();
    for (const f of propFights()) if (!fighting.has(f.key)) fighting.set(f.key, `${f.key}${f.snowy ? ' (snowy)' : ''}: ${describeOverlap(f.overlap)}`);
    expect([...fighting.values()], 'npm run zfight -- props lists them all').toEqual([]);
  });
});
