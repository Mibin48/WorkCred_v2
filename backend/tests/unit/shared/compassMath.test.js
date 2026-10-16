import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePercentile,
  computeRateDistribution,
  resolveCompassRate,
  SAMPLE_BASELINES
} from '../../../../shared/compassMath.js';

describe('shared/compassMath.js', () => {
  it('calculates percentiles correctly using interpolation', () => {
    const data = [500, 600, 700, 800, 900];
    assert.equal(calculatePercentile(data, 50), 700);
    assert.equal(calculatePercentile(data, 0), 500);
    assert.equal(calculatePercentile(data, 100), 900);
  });

  it('computes distribution (p25, median, p75) from numbers', () => {
    const data = [600, 700, 800, 900, 1000];
    const dist = computeRateDistribution(data);
    assert.equal(dist.count, 5);
    assert.equal(dist.median, 800);
    assert.ok(dist.p25 < dist.median && dist.median < dist.p75);
  });

  it('resolves Tier 1 (locality) when locality has >= 5 samples', () => {
    const localitySamples = [700, 750, 800, 850, 900];
    const res = resolveCompassRate({
      skill: 'electrician',
      localitySamples
    });

    assert.equal(res.tier, 'locality');
    assert.equal(res.sampleSize, 5);
    assert.equal(res.disclaimer, null);
    assert.equal(res.median, 800);
  });

  it('falls back to Tier 2 (city) when locality has < 5 samples and city has >= 5', () => {
    const localitySamples = [700, 800]; // Only 2
    const citySamples = [750, 800, 850, 900, 950, 1000]; // 6 samples
    const res = resolveCompassRate({
      skill: 'plumber',
      localitySamples,
      citySamples
    });

    assert.equal(res.tier, 'city');
    assert.equal(res.sampleSize, 6);
    assert.equal(res.disclaimer, null);
  });

  it('falls back to Tier 3 (sample baseline) when both locality and city have < 5 samples', () => {
    const res = resolveCompassRate({
      skill: 'electrician',
      localitySamples: [800],
      citySamples: [850, 900]
    });

    assert.equal(res.tier, 'baseline');
    assert.equal(res.sampleSize, 0);
    assert.equal(res.disclaimer, 'Based on sample rates for now');
    assert.equal(res.median, SAMPLE_BASELINES.electrician.median);
    assert.equal(res.p25, SAMPLE_BASELINES.electrician.p25);
    assert.equal(res.p75, SAMPLE_BASELINES.electrician.p75);
  });
});
