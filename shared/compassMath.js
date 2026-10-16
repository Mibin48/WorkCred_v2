export const SAMPLE_BASELINES = {
  helper: { p25: 75, median: 94, p75: 113 },
  electrician: { p25: 100, median: 125, p75: 163 },
  plumber: { p25: 100, median: 125, p75: 156 },
  mason: { p25: 113, median: 144, p75: 175 },
  painter: { p25: 94, median: 119, p75: 150 },
  carpenter: { p25: 106, median: 138, p75: 169 },
  cook: { p25: 88, median: 113, p75: 144 },
  cleaner: { p25: 69, median: 88, p75: 106 },
  driver: { p25: 100, median: 125, p75: 150 },
  vendor: { p25: 75, median: 100, p75: 125 },
  other: { p25: 81, median: 106, p75: 138 }
};

/**
 * Calculates effective hourly rate:
 * hourlyRate if > 0, else round(dailyRate / 8).
 * 
 * @param {number} hourlyRate 
 * @param {number} dailyRate 
 * @returns {number}
 */
export function hourlyEquivalent(hourlyRate, dailyRate) {
  if (typeof hourlyRate === 'number' && hourlyRate > 0) {
    return Math.round(hourlyRate);
  }
  if (typeof dailyRate === 'number' && dailyRate > 0) {
    return Math.round(dailyRate / 8);
  }
  return 0;
}

/**
 * Returns fair price label for a rate given p25 and p75.
 * - 'low' if rate < p25
 * - 'high' if rate > p75
 * - 'fair' if p25 <= rate <= p75
 * 
 * @param {number} rate 
 * @param {{ p25: number, p75: number }} bounds 
 * @returns {'low'|'fair'|'high'}
 */
export function fairLabel(rate, bounds) {
  if (typeof rate !== 'number' || !bounds) return 'fair';
  if (rate < bounds.p25) return 'low';
  if (rate > bounds.p75) return 'high';
  return 'fair';
}

/**
 * Selects source row between locality, city, and sample baseline.
 * Tier 1: locality if sampleSize >= 5
 * Tier 2: city if sampleSize >= 5
 * Tier 3: baseline
 * 
 * @param {object} localityStats 
 * @param {object} cityStats 
 * @param {object} baseline 
 * @returns {{ source: 'locality'|'city'|'baseline', isSample: boolean, data: object }}
 */
export function pickSource(localityStats, cityStats, baseline) {
  if (localityStats && localityStats.sampleSize >= 5) {
    return {
      source: 'locality',
      isSample: false,
      sampleSize: localityStats.sampleSize,
      p25: localityStats.p25,
      median: localityStats.median,
      p75: localityStats.p75,
      data: localityStats
    };
  }
  if (cityStats && cityStats.sampleSize >= 5) {
    return {
      source: 'city',
      isSample: false,
      sampleSize: cityStats.sampleSize,
      p25: cityStats.p25,
      median: cityStats.median,
      p75: cityStats.p75,
      data: cityStats
    };
  }
  return {
    source: 'baseline',
    isSample: true,
    sampleSize: 0,
    note: 'Based on sample rates for now',
    p25: baseline.p25,
    median: baseline.median,
    p75: baseline.p75,
    data: baseline
  };
}

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
 * Resolves Fair Rate Compass guidance using 3-tier fallback.
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
