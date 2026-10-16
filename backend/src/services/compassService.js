import { Booking } from '../models/Booking.js';
import { RateStats } from '../models/RateStats.js';
import { computeRateDistribution } from '../../../shared/compassMath.js';
import { getLocalityByKey, LOCALITIES } from '../../../shared/localities.js';

/**
 * Recomputes and upserts rateStats for a given skill and localityKey.
 * Also recomputes the aggregated city row: localityKey = "city:<cityKey>".
 * 
 * Rules (Requirement 3):
 * - Reads COMPLETED bookings in the last 90 days (by finishedAt, using the injectable clock;
 *   a booking finished 91 days ago is excluded, 90 days ago is included).
 * - Computes p25, median, p75 of agreedRate.
 * - Upserts rateStats: { skill, localityKey, cityKey, p25, median, p75, sampleSize, isSeed: false }.
 * - Also recomputes the city row stored as localityKey: "city:<cityKey>" from all localities in that city.
 * 
 * @param {string} skill 
 * @param {string} localityKey 
 * @param {object} clock 
 */
export async function recomputeRateStats(skill, localityKey, clock = { now: () => new Date() }) {
  const locDoc = getLocalityByKey(localityKey);
  const canonicalLocalityKey = locDoc ? locDoc.key : localityKey;
  const cityKey = locDoc ? locDoc.cityKey : 'kochi';
  const localityKeys = Array.from(new Set([localityKey, canonicalLocalityKey]));

  const now = clock.now();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // 1. Recompute for locality
  const localityBookings = await Booking.find({
    skill,
    status: 'completed',
    finishedAt: { $gte: ninetyDaysAgo, $lte: now },
    // Filter bookings associated with jobs in this locality or workers in this locality
    $or: [
      { localityKey: { $in: localityKeys } },
      { 'locationSnapshot.localityKey': { $in: localityKeys } }
    ]
  }).select('agreedRate');

  // Fallback: if booking has jobId, fetch job locality if needed
  let rates = localityBookings.map((b) => b.agreedRate).filter((r) => typeof r === 'number' && r > 0);

  const locDist = computeRateDistribution(rates);
  
  // Upsert for canonical key (and aliased key if different)
  for (const lk of localityKeys) {
    await RateStats.findOneAndUpdate(
      { skill, localityKey: lk },
      {
        $set: {
          cityKey,
          p25: locDist.p25,
          median: locDist.median,
          p75: locDist.p75,
          sampleSize: locDist.count,
          isSeed: false
        }
      },
      { upsert: true, new: true }
    );
  }

  // 2. Recompute for city ("city:<cityKey>")
  // Get all localityKeys in this city
  const cityLocalities = LOCALITIES.filter((l) => l.cityKey === cityKey).map((l) => l.key);
  const cityRowKey = `city:${cityKey}`;

  // Find all rateStats records for this skill across localities in this city
  const allLocalityStats = await RateStats.find({
    skill,
    localityKey: { $in: cityLocalities },
    sampleSize: { $gt: 0 }
  });

  // Query all bookings in the city in the last 90 days
  const cityBookings = await Booking.find({
    skill,
    status: 'completed',
    finishedAt: { $gte: ninetyDaysAgo, $lte: now },
    $or: [
      { localityKey: { $in: cityLocalities } },
      { 'locationSnapshot.localityKey': { $in: cityLocalities } }
    ]
  }).select('agreedRate');

  const cityRates = cityBookings.map((b) => b.agreedRate).filter((r) => typeof r === 'number' && r > 0);
  const cityDist = computeRateDistribution(cityRates);

  await RateStats.findOneAndUpdate(
    { skill, localityKey: cityRowKey },
    {
      $set: {
        cityKey,
        p25: cityDist.p25,
        median: cityDist.median,
        p75: cityDist.p75,
        sampleSize: cityDist.count,
        isSeed: false
      }
    },
    { upsert: true, new: true }
  );

  return {
    locality: { skill, localityKey, ...locDist },
    city: { skill, localityKey: cityRowKey, ...cityDist }
  };
}

