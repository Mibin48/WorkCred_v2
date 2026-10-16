import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateHaversineDistance, formatApproximateDistance, isValidCoordinate } from '../../../../shared/geo.js';

describe('shared/geo.js', () => {
  it('calculates haversine distance correctly between two known points', () => {
    // Kakkanad (10.0159, 76.3419) to Palarivattom (10.0033, 76.3089) ~3.8 km
    const distanceMeters = calculateHaversineDistance(10.0159, 76.3419, 10.0033, 76.3089);
    assert.ok(distanceMeters > 3500 && distanceMeters < 4200, `Expected ~3.8km, got ${distanceMeters}m`);
  });

  it('formats distance approximations properly', () => {
    assert.equal(formatApproximateDistance(250), 'under 500 m');
    assert.equal(formatApproximateDistance(950), 'about 1 km');
    assert.equal(formatApproximateDistance(2400), 'about 2 km');
    assert.equal(formatApproximateDistance(5100), 'about 5 km');
  });

  it('validates coordinates bounds', () => {
    assert.equal(isValidCoordinate(10.0, 76.0), true);
    assert.equal(isValidCoordinate(91.0, 0), false);
    assert.equal(isValidCoordinate(0, 185.0), false);
    assert.equal(isValidCoordinate('10', '76'), false);
    assert.equal(isValidCoordinate(NaN, 76.0), false);
  });
});
