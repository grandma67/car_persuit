import { describe, expect, it } from 'vitest';
import { buildModels } from './PropSystem';
import { colourTag, coplanarOverlaps, trianglesOf } from '../render/coplanar';

// Two parts of a prop model sharing a plane, facing the same way, in different colours: they
// z-fight (flicker) wherever they overlap. Parts must enclose each other or keep faces >= 1 cm apart.

/** Models allowed to z-fight, each with its reason (none today). A stale key fails too. */
const KNOWN = new Set<string>([]);

const LOOKS = [
  { leaves: 0x3d7a3f, trunk: 0x4a3426, snowy: false },
  { leaves: 0x3d7a3f, trunk: 0x4a3426, snowy: true },
];

describe('prop models', () => {
  it('no two parts of a model z-fight', () => {
    const fighting = new Map<string, string>();
    for (const look of LOOKS) {
      for (const [key, g] of Object.entries(buildModels(look))) {
        const col = g.attributes.color?.array;
        if (!col) continue;
        const o = coplanarOverlaps(trianglesOf(g.attributes.position.array, g.index?.array ?? null, colourTag(col)));
        if (o.length && !fighting.has(key)) {
          const x = o[0];
          fighting.set(key, `${key}: ${x.tags.join(' vs ')} facing (${x.normal.map((v) => v.toFixed(2))}) at (${x.at.map((v) => v.toFixed(3))}), ${(x.area * 1e4).toFixed(1)} cm²${o.length > 1 ? ` (+${o.length - 1} more)` : ''}`);
        }
      }
    }
    expect([...fighting].filter(([k]) => !KNOWN.has(k)).map(([, s]) => s), 'new z-fighting').toEqual([]);
    expect([...KNOWN].filter((k) => !fighting.has(k)), 'fixed: drop from KNOWN').toEqual([]);
  });
});
