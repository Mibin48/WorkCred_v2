import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePercentile,
  computeRateDistribution,
  resolveCompassRate,
  SAMPLE_BASELINES,
  hourlyEquivalent,
  fairLabel,
  pickSource
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

  describe('B4 Pure Functions (hourlyEquivalent, fairLabel, pickSource)', () => {
    it('hourlyEquivalent computes hourly if set, else round(daily / 8)', () => {
      assert.equal(hourlyEquivalent(150, 800), 150);
      assert.equal(hourlyEquivalent(0, 800), 100);
      assert.equal(hourlyEquivalent(null, 750), 94); // 750/8 = 93.75 -> 94
      assert.equal(hourlyEquivalent(null, 500), 63); // 500/8 = 62.5 -> 63
      assert.equal(hourlyEquivalent(null, null), 0);
    });

    it('fairLabel boundaries: below p25, equal p25, equal p75, above p75', () => {
      const bounds = { p25: 100, p75: 200 };
      assert.equal(fairLabel(99, bounds), 'low');
      assert.equal(fairLabel(100, bounds), 'fair');
      assert.equal(fairLabel(150, bounds), 'fair');
      assert.equal(fairLabel(200, bounds), 'fair');
      assert.equal(fairLabel(201, bounds), 'high');
    });

    it('pickSource order: locality >= 5, else city >= 5, else baseline', () => {
      const locValid = { p25: 10, median: 20, p75: 30, sampleSize: 5 };
      const locInvalid = { p25: 10, median: 20, p75: 30, sampleSize: 4 };
      const cityValid = { p25: 12, median: 22, p75: 32, sampleSize: 10 };
      const cityInvalid = { p25: 12, median: 22, p75: 32, sampleSize: 3 };
      const baseline = { p25: 15, median: 25, p75: 35 };

      // Locality >= 5 returns locality
      const r1 = pickSource(locValid, cityValid, baseline);
      assert.equal(r1.source, 'locality');
      assert.equal(r1.sampleSize, 5);
      assert.equal(r1.isSample, false);

      // Locality < 5, City >= 5 returns city
      const r2 = pickSource(locInvalid, cityValid, baseline);
      assert.equal(r2.source, 'city');
      assert.equal(r2.sampleSize, 10);
      assert.equal(r2.isSample, false);

      // Both < 5 returns baseline
      const r3 = pickSource(locInvalid, cityInvalid, baseline);
      assert.equal(r3.source, 'baseline');
      assert.equal(r3.sampleSize, 0);
      assert.equal(r3.isSample, true);
      assert.equal(r3.note, 'Based on sample rates for now');
    });
  });
});
