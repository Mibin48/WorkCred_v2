import express from 'express';
import mongoose from 'mongoose';
import { formatSuccess, AppError } from '../utils/errors.js';
import { Job } from '../models/Job.js';
import { Booking } from '../models/Booking.js';
import { User } from '../models/User.js';
import { clock } from '../utils/clock.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { getLocalityByKey } from '../../../shared/localities.js';
import { calculateHaversineDistance } from '../../../shared/geo.js';
import { formatApproxDistance, validateJobInput, intervalsOverlap, isWindowAvailable, encodeCursor, decodeCursor } from '../../../shared/jobRules.js';
import { generate4DigitCode, encryptCode } from '../../../shared/codesCrypto.js';
import { getFairRateInfo } from './compass.js';
import { eventBus } from '../realtime/eventBus.js';
import { closeFreeNowWindow } from '../services/freeNowService.js';

export function createJobsRouter(config, authMiddleware, idempotencyMiddleware) {
  const router = express.Router();
  const { requireAuth, requireRole } = authMiddleware;
  const idempotency = idempotencyMiddleware ? idempotencyMiddleware.idempotency : (_opts) => (_req, _res, next) => next();

  /**
   * Helper: formats a user's first name plus initial of last name (e.g. "Imran S.")
   */
  function formatDisplayName(fullName) {
    if (!fullName || typeof fullName !== 'string') return 'User';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const first = parts[0];
    const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
    return `${first} ${lastInitial}.`;
  }

  /**
   * POST /jobs
   * Customers only, profileComplete required.
   * Body: { skill, workersNeeded, hours, startAt, offeredRate, description, localityKey?, location? }
   * Limit 20 jobs per customer per India calendar day (429 JOB_LIMIT).
   * Stores searchLocation = locality centroid.
   * Response includes Fair Price hint { label, p25, median, p75, source, isSample }.
   * Never returns exact coordinates.
   */
  router.post('/', requireAuth, requireRole('customer'), idempotency({ required: false }), async (req, res, next) => {
    try {
      const user = req.user;
      if (!user.profileComplete) {
        return next(new AppError('PROFILE_INCOMPLETE', 'Complete your profile before posting jobs', 403));
      }

      // Check daily job limit (20 per India calendar day)
      const now = clock.now();
      const indiaOffsetMs = 5.5 * 60 * 60 * 1000;
      const indiaNow = new Date(now.getTime() + indiaOffsetMs);
      const startOfDayIndia = new Date(Date.UTC(indiaNow.getUTCFullYear(), indiaNow.getUTCMonth(), indiaNow.getUTCDate(), 0, 0, 0) - indiaOffsetMs);
      const endOfDayIndia = new Date(startOfDayIndia.getTime() + 24 * 60 * 60 * 1000);

      const todayJobsCount = await Job.countDocuments({
        customerId: user._id,
        createdAt: { $gte: startOfDayIndia, $lt: endOfDayIndia }
      });

      if (todayJobsCount >= 20) {
        return next(new AppError('JOB_LIMIT', 'Daily job posting limit of 20 jobs reached', 429));
      }

      // Validate job input
      const validation = validateJobInput(req.body, { clock, userLocalityKey: user.localityKey });
      if (!validation.valid) {
        return next(new AppError(validation.code || 'VALIDATION_ERROR', validation.errors.join('; '), 400, validation.errors));
      }

      const input = validation.data;
      const locality = getLocalityByKey(input.localityKey);
      if (!locality) {
        return next(new AppError('INVALID_LOCALITY', `Locality '${input.localityKey}' not found`, 400));
      }

      const searchLocation = {
        type: 'Point',
        coordinates: [locality.lng, locality.lat]
      };

      const jobLocation = input.location
        ? { type: 'Point', coordinates: [input.location.lng, input.location.lat] }
        : searchLocation;

      const job = await Job.create({
        customerId: user._id,
        skill: input.skill,
        workersNeeded: input.workersNeeded,
        hours: input.hours,
        startAt: new Date(input.startAt),
        offeredRate: input.offeredRate,
        description: input.description,
        localityKey: input.localityKey,
        location: jobLocation,
        searchLocation,
        status: 'open',
        acceptedCount: 0,
        isSample: Boolean(user.isSample)
      });

      // Audit log (ids only)
      logAuditEvent('job_created', {
        jobId: job._id.toString(),
        customerId: user._id.toString()
      });

      // Domain event for realtime targeting
      eventBus.publish('job:new', {
        jobId: job._id.toString(),
        skill: job.skill,
        searchLocation: job.searchLocation
      });

      // Fair Price hint
      const fairRateHint = await getFairRateInfo(job.skill, job.localityKey, job.offeredRate);

      const responseData = {
        job: {
          id: job._id.toString(),
          skill: job.skill,
          workersNeeded: job.workersNeeded,
          acceptedCount: job.acceptedCount,
          hours: job.hours,
          startAt: job.startAt.toISOString(),
          offeredRate: job.offeredRate,
          totalPay: job.offeredRate * job.hours,
          description: job.description,
          localityKey: job.localityKey,
          localityName: locality.name,
          status: job.status,
          isSample: Boolean(job.isSample),
          fairRate: fairRateHint
        }
      };

      return res.status(201).json(formatSuccess(responseData, 'Job posted successfully'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /jobs
   * Workers only, profileComplete required.
   * "Jobs near you": status open, startAt in the future, skill in worker's skills,
   * within worker's radiusKm of worker's searchLocation, not already accepted by worker,
   * acceptedCount < workersNeeded.
   * Sort by startAt then _id, cursor pagination.
   */
  router.get('/', requireAuth, requireRole('worker'), async (req, res, next) => {
    try {
      const user = req.user;
      if (!user.profileComplete) {
        return next(new AppError('PROFILE_INCOMPLETE', 'Complete your profile to view jobs', 403));
      }

      const now = clock.now();
      const workerSkills = Array.isArray(user.skills) ? user.skills : [];
      if (workerSkills.length === 0) {
        return res.status(200).json(formatSuccess({ jobs: [], nextCursor: null }, 'Jobs retrieved'));
      }

      // Worker search location
      let workerCoords = user.searchLocation?.coordinates;
      if (!workerCoords || (workerCoords[0] === 0 && workerCoords[1] === 0)) {
        if (user.localityKey) {
          const loc = getLocalityByKey(user.localityKey);
          if (loc) workerCoords = [loc.lng, loc.lat];
        }
      }
      if (!workerCoords || (workerCoords[0] === 0 && workerCoords[1] === 0)) {
        return next(new AppError('SET_AREA', 'Set your locality to view jobs', 400));
      }

      const radiusMeters = ((user.radiusKm || 5) * 1000);

      // Parse pagination
      let limit = 20;
      if (req.query.limit !== undefined) {
        limit = Number.parseInt(req.query.limit, 10);
        if (Number.isNaN(limit) || limit < 1 || limit > 50) {
          return next(new AppError('INVALID_LIMIT', 'Limit must be between 1 and 50', 400, { field: 'limit' }));
        }
      }

      let cursorFilter = null;
      if (req.query.cursor) {
        const decoded = decodeCursor(req.query.cursor);
        if (!decoded || !decoded.id || !decoded.sortVal) {
          return next(new AppError('BAD_CURSOR', 'Invalid or tampered pagination cursor', 400));
        }
        const cursorDate = new Date(decoded.sortVal);
        const cursorId = new mongoose.Types.ObjectId(decoded.id);
        cursorFilter = {
          $or: [
            { startAt: { $gt: cursorDate } },
            { startAt: cursorDate, _id: { $gt: cursorId } }
          ]
        };
      }

      // Find jobs already accepted by this worker
      const myBookings = await Booking.find({ workerId: user._id, jobId: { $ne: null } }).select('jobId').lean();
      const excludedJobIds = myBookings.map(b => b.jobId);

      // $geoNear aggregation on Job.searchLocation
      const pipeline = [
        {
          $geoNear: {
            near: { type: 'Point', coordinates: workerCoords },
            key: 'searchLocation',
            distanceField: 'distMeters',
            maxDistance: radiusMeters,
            spherical: true,
            query: {
              status: 'open',
              startAt: { $gt: now },
              skill: { $in: workerSkills },
              $expr: { $lt: ['$acceptedCount', '$workersNeeded'] },
              _id: { $nin: excludedJobIds }
            }
          }
        }
      ];

      if (cursorFilter) {
        pipeline.push({ $match: cursorFilter });
      }

      pipeline.push({ $sort: { startAt: 1, _id: 1 } });
      pipeline.push({ $limit: limit + 1 });

      // Lookup customer details for displayName
      pipeline.push({
        $lookup: {
          from: 'users',
          localField: 'customerId',
          foreignField: '_id',
          as: 'customerDoc'
        }
      });

      const docs = await Job.aggregate(pipeline);

      const hasMore = docs.length > limit;
      const returnedDocs = hasMore ? docs.slice(0, limit) : docs;

      // Batch compute fairRate hints for distinct (skill, localityKey)
      const fairRateMap = new Map();
      for (const d of returnedDocs) {
        const key = `${d.skill}:${d.localityKey}`;
        if (!fairRateMap.has(key)) {
          fairRateMap.set(key, getFairRateInfo(d.skill, d.localityKey));
        }
      }
      for (const [key, promise] of fairRateMap.entries()) {
        fairRateMap.set(key, await promise);
      }

      const formattedJobs = returnedDocs.map((j) => {
        const customer = (j.customerDoc && j.customerDoc[0]) ? j.customerDoc[0] : null;
        const customerDisplay = customer ? formatDisplayName(customer.name) : 'Customer';
        const loc = getLocalityByKey(j.localityKey);
        const fairHint = fairRateMap.get(`${j.skill}:${j.localityKey}`);
        const fairLabel = fairHint ? (j.offeredRate < fairHint.p25 ? 'low' : (j.offeredRate > fairHint.p75 ? 'high' : 'fair')) : 'fair';

        return {
          id: j._id.toString(),
          skill: j.skill,
          hours: j.hours,
          startAt: j.startAt.toISOString(),
          offeredRate: j.offeredRate,
          totalPay: j.offeredRate * j.hours,
          spotsLeft: j.workersNeeded - j.acceptedCount,
          descriptionExcerpt: j.description,
          approxDistance: formatApproxDistance(j.distMeters),
          localityName: loc ? loc.name : j.localityKey,
          customerDisplay,
          isSample: Boolean(j.isSample),
          fairRate: { label: fairLabel }
        };
      });

      let nextCursor = null;
      if (hasMore && returnedDocs.length > 0) {
        const last = returnedDocs[returnedDocs.length - 1];
        nextCursor = encodeCursor({
          id: last._id.toString(),
          sortVal: last.startAt.toISOString()
        });
      }

      return res.status(200).json(formatSuccess({ jobs: formattedJobs, nextCursor }, 'Jobs retrieved'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /jobs/mine
   * Customers only.
   * Return customer's posted jobs newest first with cursor pagination.
   * Status: open, filled, cancelled, expired (read-time G5).
   * acceptedWorkers [{ id, displayName, bookingId, bookingStatus }]
   */
  router.get('/mine', requireAuth, requireRole('customer'), async (req, res, next) => {
    try {
      const user = req.user;
      const now = clock.now();

      let limit = 20;
      if (req.query.limit !== undefined) {
        limit = Number.parseInt(req.query.limit, 10);
        if (Number.isNaN(limit) || limit < 1 || limit > 50) {
          return next(new AppError('INVALID_LIMIT', 'Limit must be between 1 and 50', 400, { field: 'limit' }));
        }
      }

      let query = { customerId: user._id };
      if (req.query.cursor) {
        const decoded = decodeCursor(req.query.cursor);
        if (!decoded || !decoded.id || !decoded.sortVal) {
          return next(new AppError('BAD_CURSOR', 'Invalid or tampered pagination cursor', 400));
        }
        const cursorCreatedAt = new Date(decoded.sortVal);
        const cursorId = new mongoose.Types.ObjectId(decoded.id);
        query = {
          customerId: user._id,
          $or: [
            { createdAt: { $lt: cursorCreatedAt } },
            { createdAt: cursorCreatedAt, _id: { $lt: cursorId } }
          ]
        };
      }

      const jobs = await Job.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean();

      const hasMore = jobs.length > limit;
      const returnedJobs = hasMore ? jobs.slice(0, limit) : jobs;

      // Populate acceptedWorkers via bookings for these jobs
      const jobIds = returnedJobs.map(j => j._id);
      const bookings = await Booking.find({ jobId: { $in: jobIds } })
        .populate('workerId', 'name')
        .lean();

      const bookingsByJob = new Map();
      for (const b of bookings) {
        const jId = b.jobId.toString();
        if (!bookingsByJob.has(jId)) {
          bookingsByJob.set(jId, []);
        }
        const worker = b.workerId;
        bookingsByJob.get(jId).push({
          id: worker ? worker._id.toString() : b.workerId.toString(),
          displayName: worker ? formatDisplayName(worker.name) : 'Worker',
          bookingId: b._id.toString(),
          bookingStatus: b.status
        });
      }

      const formatted = returnedJobs.map((j) => {
        // G5: Read-time expiry rule
        let computedStatus = j.status;
        if (j.status === 'open' && new Date(j.startAt) <= now) {
          computedStatus = 'expired';
        }

        const loc = getLocalityByKey(j.localityKey);

        return {
          id: j._id.toString(),
          skill: j.skill,
          workersNeeded: j.workersNeeded,
          acceptedCount: j.acceptedCount,
          hours: j.hours,
          startAt: j.startAt.toISOString(),
          offeredRate: j.offeredRate,
          totalPay: j.offeredRate * j.hours,
          description: j.description,
          localityKey: j.localityKey,
          localityName: loc ? loc.name : j.localityKey,
          status: computedStatus,
          isSample: Boolean(j.isSample),
          acceptedWorkers: bookingsByJob.get(j._id.toString()) || []
        };
      });

      let nextCursor = null;
      if (hasMore && returnedJobs.length > 0) {
        const last = returnedJobs[returnedJobs.length - 1];
        nextCursor = encodeCursor({
          id: last._id.toString(),
          sortVal: last.createdAt.toISOString()
        });
      }

      return res.status(200).json(formatSuccess({ jobs: formatted, nextCursor }, 'Customer jobs retrieved'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /jobs/:id/accept
   * Workers only, profileComplete required.
   * Atomic claim (G7) + confirmed booking creation (G6) with AES-256-GCM encrypted codes.
   */
  router.post('/:id/accept', requireAuth, requireRole('worker'), idempotency({ required: false }), async (req, res, next) => {
    try {
      const user = req.user;
      if (!user.profileComplete) {
        return next(new AppError('PROFILE_INCOMPLETE', 'Complete your profile to accept jobs', 403));
      }

      const jobIdStr = req.params.id;
      if (!mongoose.Types.ObjectId.isValid(jobIdStr)) {
        return next(new AppError('NOT_FOUND', 'Job not found', 404));
      }

      const jobId = new mongoose.Types.ObjectId(jobIdStr);
      const job = await Job.findById(jobId);
      if (!job) {
        return next(new AppError('NOT_FOUND', 'Job not found', 404));
      }

      const now = clock.now();

      // Read-time expiry check
      if (job.startAt <= now || job.status === 'expired') {
        return next(new AppError('JOB_EXPIRED', 'Job has already expired', 409));
      }

      if (job.status !== 'open' || job.acceptedCount >= job.workersNeeded) {
        return next(new AppError('JOB_FULL', 'Job is already filled or not open', 409));
      }

      // Worker skill check
      const workerSkills = Array.isArray(user.skills) ? user.skills : [];
      if (!workerSkills.includes(job.skill)) {
        return next(new AppError('SKILL_MISMATCH', 'You do not have the required skill for this job', 403));
      }

      // Worker radius check
      let workerCoords = user.searchLocation?.coordinates;
      if (!workerCoords || (workerCoords[0] === 0 && workerCoords[1] === 0)) {
        if (user.localityKey) {
          const loc = getLocalityByKey(user.localityKey);
          if (loc) workerCoords = [loc.lng, loc.lat];
        }
      }
      if (!workerCoords || (workerCoords[0] === 0 && workerCoords[1] === 0)) {
        return next(new AppError('SET_AREA', 'Set your locality before accepting jobs', 400));
      }

      const jobCoords = job.searchLocation?.coordinates || job.location?.coordinates;
      const distanceMeters = calculateHaversineDistance(workerCoords[1], workerCoords[0], jobCoords[1], jobCoords[0]);
      const maxDistanceMeters = (user.radiusKm || 5) * 1000;
      if (distanceMeters > maxDistanceMeters) {
        return next(new AppError('TOO_FAR', 'Job is outside your service radius', 403));
      }

      // Check worker calendar availability
      if (!isWindowAvailable(user.calendar, job.startAt, job.hours)) {
        return next(new AppError('NOT_AVAILABLE', 'Your calendar indicates you are not available for this job window', 409));
      }

      // Check existing booking overlap
      const startMs = new Date(job.startAt).getTime();
      const endMs = startMs + job.hours * 60 * 60 * 1000;

      const activeBookings = await Booking.find({
        workerId: user._id,
        status: { $in: ['pending', 'confirmed', 'in_progress'] }
      }).lean();

      for (const b of activeBookings) {
        if (b.jobId && b.jobId.toString() === jobIdStr) {
          return next(new AppError('ALREADY_ACCEPTED', 'You have already accepted this job', 409));
        }
        if (intervalsOverlap(job.startAt, job.hours, b.scheduledAt, b.hours)) {
          return next(new AppError('TIME_CLASH', 'This job conflicts with an existing booking schedule', 409));
        }
      }

      // Check if worker already accepted this job (index check)
      const existingJobBooking = await Booking.findOne({ jobId: job._id, workerId: user._id });
      if (existingJobBooking) {
        return next(new AppError('ALREADY_ACCEPTED', 'You have already accepted this job', 409));
      }

      // G7: Atomic slot claim with conditional aggregation / update
      // Increments acceptedCount only when status is open, startAt > now, acceptedCount < workersNeeded
      // Flips status to 'filled' when acceptedCount + 1 === workersNeeded
      const claimResult = await Job.findOneAndUpdate(
        {
          _id: job._id,
          status: 'open',
          startAt: { $gt: now },
          $expr: { $lt: ['$acceptedCount', '$workersNeeded'] }
        },
        [
          {
            $set: {
              acceptedCount: { $add: ['$acceptedCount', 1] },
              status: {
                $cond: {
                  if: { $gte: [{ $add: ['$acceptedCount', 1] }, '$workersNeeded'] },
                  then: 'filled',
                  else: 'open'
                }
              }
            }
          }
        ],
        { new: true }
      );

      if (!claimResult) {
        // Re-read job to determine exact failure cause
        const freshJob = await Job.findById(job._id);
        if (!freshJob || freshJob.startAt <= now) {
          return next(new AppError('JOB_EXPIRED', 'Job has expired', 409));
        }
        return next(new AppError('JOB_FULL', 'Job is already filled', 409));
      }

      // G6: Create booking immediately (status confirmed, source "job")
      // Generate booking _id BEFORE inserting so AAD can use it
      const bookingId = new mongoose.Types.ObjectId();
      const startCode = generate4DigitCode();
      const finishCode = generate4DigitCode();

      const startCodeEnc = encryptCode(startCode, config.CODES_ENC_KEY, bookingId.toString(), 'start');
      const finishCodeEnc = encryptCode(finishCode, config.CODES_ENC_KEY, bookingId.toString(), 'finish');

      try {
        // Re-check overlap after claim to catch parallel accepts by the same worker
        const postClashBookings = await Booking.find({
          workerId: user._id,
          status: { $in: ['pending', 'confirmed', 'in_progress'] }
        }).lean();

        for (const b of postClashBookings) {
          if (intervalsOverlap(job.startAt, job.hours, b.scheduledAt, b.hours)) {
            throw new AppError('TIME_CLASH', 'This job conflicts with an existing booking schedule', 409);
          }
        }

        const booking = await Booking.create({
          _id: bookingId,
          jobId: job._id,
          customerId: job.customerId,
          workerId: user._id,
          skill: job.skill,
          localityKey: job.localityKey,
          agreedRate: job.offeredRate,
          scheduledAt: job.startAt,
          hours: job.hours,
          status: 'confirmed',
          source: 'job',
          locationSnapshot: job.location,
          isSample: Boolean(job.isSample || user.isSample),
          startCodeEnc,
          finishCodeEnc
        });

        // Audit log
        logAuditEvent('job_accepted', {
          jobId: job._id.toString(),
          workerId: user._id.toString(),
          bookingId: booking._id.toString()
        });

        // J4: Worker accepting a job closes their Free Now window
        await closeFreeNowWindow(user._id, 'accepted');

        // Publish booking:created for the customer
        eventBus.publish('booking:created', {
          bookingId: booking._id.toString(),
          customerId: job.customerId.toString()
        });

        // If the job was filled, broadcast job:filled
        if (claimResult.status === 'filled') {
          eventBus.publish('job:filled', {
            jobId: job._id.toString(),
            reason: 'filled',
            skill: job.skill,
            searchLocation: job.searchLocation
          });
        }

        const responseData = {
          bookingId: booking._id.toString(),
          status: 'confirmed',
          scheduledAt: booking.scheduledAt.toISOString(),
          hours: booking.hours,
          agreedRate: booking.agreedRate,
          jobId: job._id.toString()
        };

        return res.status(200).json(formatSuccess(responseData, 'Job accepted successfully'));
      } catch (bookingErr) {
        // Rollback atomic slot claim
        await Job.updateOne(
          { _id: job._id },
          [
            {
              $set: {
                acceptedCount: { $max: [0, { $subtract: ['$acceptedCount', 1] }] },
                status: 'open'
              }
            }
          ]
        );

        if (bookingErr.code === 11000) {
          return next(new AppError('ALREADY_ACCEPTED', 'You have already accepted this job', 409));
        }
        return next(bookingErr);
      }
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /jobs/:id/cancel
   * Customers only, owner only (anyone else, including another customer, gets 404).
   * Allowed when job is open or filled and startAt is in the future.
   * If any booking is in_progress -> 409 JOB_IN_PROGRESS and change nothing.
   * Otherwise sets job status to cancelled and all confirmed or pending bookings to cancelled with cancelledBy "customer".
   * Already cancelled jobs return safe repeat success.
   * Past jobs: 409 JOB_EXPIRED.
   */
  router.post('/:id/cancel', requireAuth, requireRole('customer'), idempotency({ required: false }), async (req, res, next) => {
    try {
      const user = req.user;
      const jobIdStr = req.params.id;

      if (!mongoose.Types.ObjectId.isValid(jobIdStr)) {
        return next(new AppError('NOT_FOUND', 'Job not found', 404));
      }

      const jobId = new mongoose.Types.ObjectId(jobIdStr);
      const job = await Job.findById(jobId);

      // Owner check: if job doesn't exist or customerId does not match caller, return 404
      if (!job || job.customerId.toString() !== user._id.toString()) {
        return next(new AppError('NOT_FOUND', 'Job not found', 404));
      }

      // Safe replay if already cancelled
      if (job.status === 'cancelled') {
        return res.status(200).json(formatSuccess({ id: job._id.toString(), status: 'cancelled' }, 'Job already cancelled'));
      }

      const now = clock.now();
      if (job.startAt <= now) {
        return next(new AppError('JOB_EXPIRED', 'Cannot cancel an expired job', 409));
      }

      // Check if any booking is in_progress
      const inProgressBooking = await Booking.findOne({
        jobId: job._id,
        status: 'in_progress'
      });
      if (inProgressBooking) {
        return next(new AppError('JOB_IN_PROGRESS', 'Cannot cancel a job with active work in progress', 409));
      }

      // Cancel job
      job.status = 'cancelled';
      await job.save();

      // Cancel all confirmed/pending bookings
      await Booking.updateMany(
        {
          jobId: job._id,
          status: { $in: ['confirmed', 'pending'] }
        },
        {
          $set: {
            status: 'cancelled',
            cancelledBy: user._id,
            cancelReason: 'Customer cancelled job'
          }
        }
      );

      // Audit log
      logAuditEvent('job_cancelled', {
        jobId: job._id.toString(),
        customerId: user._id.toString()
      });

      // Broadcast job:filled with reason 'cancelled'
      eventBus.publish('job:filled', {
        jobId: job._id.toString(),
        reason: 'cancelled',
        skill: job.skill,
        searchLocation: job.searchLocation
      });

      // Notify workers of cancelled bookings
      const affectedBookings = await Booking.find({
        jobId: job._id,
        status: 'cancelled'
      }).select('_id workerId');
      for (const b of affectedBookings) {
        eventBus.publish('booking:cancelled', {
          bookingId: b._id.toString(),
          cancelledBy: 'customer',
          otherUserId: b.workerId.toString()
        });
      }

      return res.status(200).json(formatSuccess({ id: job._id.toString(), status: 'cancelled' }, 'Job cancelled successfully'));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
