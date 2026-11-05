import { describe, expect, it } from 'vitest';
import { generateCity } from '../CityGenerator';
import { alone } from '../paramsTesting';
import { joinRunDressing, nightProps, type RunDressing } from './runtime';
import type { StreetProp } from '../StreetProps';

describe('joinRunDressing', () => {
  const make = () => {
    const c = generateCity(11, undefined, { force: alone('swamp') });
    const q = c.districts[0];
    const bench: StreetProp = { kind: 'bench', x: q.bounds.x, z: q.bounds.z, yaw: 0 };
    const lantern: StreetProp = { kind: 'jackOLantern', x: q.bounds.x + 2, z: q.bounds.z, yaw: 0 };
    const night: RunDressing = { props: [lantern] };
    q.dressing.extra = { ...q.dressing.extra, byClimate: { desert: { props: [bench] } }, night, nightProps: [lantern] };
    return { c, bench, lantern };
  };

  it("adds a climate's props to the city on that climate's runs only", () => {
    const desert = make();
    joinRunDressing(desert.c, { night: false, climate: 'desert' });
    expect(desert.c.streetProps).toContain(desert.bench);
    const temperate = make();
    joinRunDressing(temperate.c, { night: false, climate: 'temperate' });
    expect(temperate.c.streetProps).not.toContain(temperate.bench);
  });

  it("adds a night's props once (through nightProps), not again", () => {
    const { c, lantern } = make();
    c.streetProps.push(...nightProps(c));
    joinRunDressing(c, { night: true, climate: 'temperate' });
    expect(c.streetProps.filter((p) => p === lantern)).toHaveLength(1);
  });
});
