// Which side of the road the whole city drives on. Right almost everywhere; on rare seeds the
// city is English and drives on the left.

export type DriveSide = 'right' | 'left';

/**
 * +1 driving on the right, -1 on the left. Multiplies "the driver's right" into "the driver's
 * kerb side": the lane offset, where signs stand, the stop line's half of the road, the tight
 * (near-side) turn and who gives way to whom all mirror with it.
 */
export type Keep = 1 | -1;
export const keepOf = (side: DriveSide): Keep => (side === 'left' ? -1 : 1);
