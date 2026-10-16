export const SAMPLE_BASELINES = {
  helper: { p25: 600, median: 750, p75: 900 },
  electrician: { p25: 800, median: 1000, p75: 1300 },
  plumber: { p25: 800, median: 1000, p75: 1250 },
  mason: { p25: 900, median: 1150, p75: 1400 },
  painter: { p25: 750, median: 950, p75: 1200 },
  carpenter: { p25: 850, median: 1100, p75: 1350 },
  cook: { p25: 700, median: 900, p75: 1150 },
  cleaner: { p25: 550, median: 700, p75: 850 },
  driver: { p25: 800, median: 1000, p75: 1200 },
  vendor: { p25: 600, median: 800, p75: 1000 },
  other: { p25: 650, median: 850, p75: 1100 }
};

/**
 * Calculates percentile from an array of numbers using linear interpolation.
 * @param {number[]} numbers Sorted array of numbers
 * @param {number} percentile Number between 0 and 100
 * @returns {number}
 */
export function calculatePercentile(numbers, percentile) {
  if (!numbers || numbers.length === 0) return 0;
  if (numbers.length === 1) return numbers[0];

  const sorted = [...numbers].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) {
    return sorted[lower];
  }

  return Math.round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

/**
 * Computes p25, median, and p75 distributions from an array of numeric rates.
 * @param {number[]} rates 
 * @returns {{ p25: number, median: number, p75: number, count: number }}
 */
export function computeRateDistribution(rates) {
  if (!rates || rates.length === 0) {
    return { p25: 0, median: 0, p75: 0, count: 0 };
  }
  const valid = rates.filter(r => typeof r === 'number' && !Number.isNaN(r) && r > 0);
  if (valid.length === 0) {
    return { p25: 0, median: 0, p75: 0, count: 0 };
  }

  return {
    p25: calculatePercentile(valid, 25),
    median: calculatePercentile(valid, 50),
    p75: calculatePercentile(valid, 75),
    count: valid.length
  };
}

/**
 * Resolves Fair Rate Compass guidance using 3-tier fallback (Decision E5, COMP-2):
 * 1. Locality samples (if >= 5 samples)
 * 2. City samples (if >= 5 samples)
 * 3. Sample baseline data (disclaimer: "Based on sample rates for now")
 *
 * @param {{
 *   skill: string,
 *   localitySamples?: number[],
 *   citySamples?: number[]
 * }} query
 * @returns {{
 *   p25: number,
 *   median: number,
 *   p75: number,
 *   tier: 'locality' | 'city' | 'baseline',
 *   sampleSize: number,
 *   disclaimer: string | null
 * }}
 */
export function resolveCompassRate(query) {
  const { skill, localitySamples = [], citySamples = [] } = query;
  const normalizedSkill = String(skill || 'other').toLowerCase();

  // Tier 1: Locality
  if (localitySamples && localitySamples.length >= 5) {
    const dist = computeRateDistribution(localitySamples);
    return {
      p25: dist.p25,
      median: dist.median,
      p75: dist.p75,
      tier: 'locality',
      sampleSize: dist.count,
      disclaimer: null
    };
  }

  // Tier 2: City
  if (citySamples && citySamples.length >= 5) {
    const dist = computeRateDistribution(citySamples);
    return {
      p25: dist.p25,
      median: dist.median,
      p75: dist.p75,
      tier: 'city',
      sampleSize: dist.count,
      disclaimer: null
    };
  }

  // Tier 3: Sample Baseline
  const baseline = SAMPLE_BASELINES[normalizedSkill] || SAMPLE_BASELINES.other;
  return {
    p25: baseline.p25,
    median: baseline.median,
    p75: baseline.p75,
    tier: 'baseline',
    sampleSize: 0,
    disclaimer: 'Based on sample rates for now'
  };
}
