import { describe, expect, it } from 'vitest';
import { MARK_LIFT } from './SkidMarks';
import { FLOOR_LIFT, GLADE_LIFT, TRACK_LIFT } from './districts/Forest';
import { LINE_LIFT, STRIPE_LIFT } from './ParkPieces';
import { RIM_LIFT } from './ShallowWater';

describe('SkidMarks', () => {
  // The marks test depth without writing it: a ground overlay drawn at or over their height hides
  // them (they vanished in the Forest, under its floor at 0.07 and its tracks at 0.11).
  it('lays marks over every ground overlay', () => {
    const overlays = { FLOOR_LIFT, GLADE_LIFT, TRACK_LIFT, LINE_LIFT, STRIPE_LIFT, RIM_LIFT };
    for (const [name, lift] of Object.entries(overlays)) expect(MARK_LIFT, name).toBeGreaterThan(lift + 0.01);
  });
});
