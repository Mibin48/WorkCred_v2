/**
 * backend/src/services/postService.js – Core service for work posts.
 *
 * Enforces:
 * - Worker only, profileComplete required.
 * - Validation via shared/postRules.js.
 * - Verified job rules: bookingId must belong to caller, be completed, skill match (403 NOT_YOUR_JOB, 409 SKILL_MISMATCH, 409 BOOKING_ALREADY_POSTED).
 * - Race-safe post quotas: 10 per India calendar day (429 POST_LIMIT_DAILY), 100 active (409 POST_LIMIT_ACTIVE).
 * - Author searchLocation and localityKey stored at creation time.
 * - Hard delete by owner with activePostCount decrement.
 */

import mongoose from 'mongoose';
import { Post } from '../models/Post.js';
import { Booking } from '../models/Booking.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/errors.js';
import { clock } from '../utils/clock.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { validatePostInput } from '../../../shared/postRules.js';
import { getIndiaDayKey, QUOTA_CAPS } from '../../../shared/quotaRules.js';
import { getLocalityByKey } from '../../../shared/localities.js';

/**
 * Creates a work post.
 *
 * @param {object} params
 * @param {object} params.body
 * @param {object} params.user Worker document
 * @param {object} params.config
 * @returns {Promise<object>} Created post item
 */
export async function createPost({ body, user, config }) {
  if (user.role !== 'worker') {
    throw new AppError('FORBIDDEN_ROLE', 'Only workers can create work posts', 403);
  }

  if (!user.profileComplete) {
    throw new AppError('PROFILE_INCOMPLETE', 'Complete your profile before creating posts', 403);
  }

  const validationContext = {
    workerSkills: user.skills || [],
    cloudName: config.CLOUDINARY_CLOUD_NAME,
    nodeEnv: config.NODE_ENV,
    userId: user._id.toString()
  };

  const validation = validatePostInput(body, validationContext);
  if (!validation.valid) {
    throw new AppError('VALIDATION_ERROR', validation.errors.join('; '), 400, validation.errors);
  }

  const { skill, caption, afterUrl, beforeUrl, bookingId: rawBookingId } = validation.data;
  const now = clock.now();
  const todayKey = getIndiaDayKey(now);

  // 1. Verify verifiedJob if bookingId is provided
  let verifiedJob = false;
  let bookingObjectId = null;

  if (rawBookingId) {
    if (!mongoose.Types.ObjectId.isValid(rawBookingId)) {
      throw new AppError('NOT_FOUND', 'Booking not found', 404);
    }
    bookingObjectId = new mongoose.Types.ObjectId(rawBookingId);

    const booking = await Booking.findById(bookingObjectId);
    if (!booking) {
      throw new AppError('NOT_FOUND', 'Booking not found', 404);
    }

    if (booking.workerId.toString() !== user._id.toString()) {
      throw new AppError('NOT_YOUR_JOB', 'You cannot link a booking that does not belong to you', 403);
    }

    if (booking.status !== 'completed') {
      throw new AppError('INVALID_STATE', 'Only completed bookings can be linked to a post', 409);
    }

    if (booking.skill !== skill) {
      throw new AppError('SKILL_MISMATCH', `Booking skill '${booking.skill}' does not match post skill '${skill}'`, 409);
    }

    // Check if booking is already linked to another post
    const existingPostWithBooking = await Post.findOne({ bookingId: bookingObjectId });
    if (existingPostWithBooking) {
      throw new AppError('BOOKING_ALREADY_POSTED', 'This completed booking is already linked to an existing post', 409);
    }

    verifiedJob = true;
  }

  // 2. Race-safe quota check and counter increment on User document
  // Active limit: activePostCount < 100
  // Daily limit: 10 per India day. If postQuota.dayKey !== todayKey, reset count to 1. Else count < 10.
  // We perform an atomic conditional update on the User document with up to 5 attempts to handle concurrent day rollover
  let quotaUpdatedUser = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    // Attempt A: same dayKey, count < maxDailyPosts
    quotaUpdatedUser = await User.findOneAndUpdate(
      {
        _id: user._id,
        activePostCount: { $lt: QUOTA_CAPS.maxActivePosts },
        'postQuota.dayKey': todayKey,
        'postQuota.count': { $lt: QUOTA_CAPS.maxDailyPosts }
      },
      {
        $inc: { activePostCount: 1, 'postQuota.count': 1 }
      },
      { new: true }
    );
    if (quotaUpdatedUser) break;

    // Attempt B: different dayKey, reset to todayKey and count: 1
    quotaUpdatedUser = await User.findOneAndUpdate(
      {
        _id: user._id,
        activePostCount: { $lt: QUOTA_CAPS.maxActivePosts },
        'postQuota.dayKey': { $ne: todayKey }
      },
      {
        $inc: { activePostCount: 1 },
        $set: { 'postQuota.dayKey': todayKey, 'postQuota.count': 1 }
      },
      { new: true }
    );
    if (quotaUpdatedUser) break;
  }

  if (!quotaUpdatedUser) {
    // Determine which quota failed to throw exact code
    const freshUser = await User.findById(user._id).select('activePostCount postQuota');
    if ((freshUser?.activePostCount || 0) >= QUOTA_CAPS.maxActivePosts) {
      throw new AppError('POST_LIMIT_ACTIVE', 'You have reached the maximum limit of 100 active posts. Delete old posts to create new ones.', 409);
    }
    throw new AppError('POST_LIMIT_DAILY', 'Daily post limit reached (10 posts per day). Try again tomorrow.', 429);
  }

  // 3. Resolve location: author's searchLocation (locality centroid) and localityKey
  const localityKey = user.localityKey;
  const locDoc = getLocalityByKey(localityKey);
  const locationCoordinates = user.searchLocation?.coordinates || (locDoc ? [locDoc.lng, locDoc.lat] : [0, 0]);

  try {
    const post = await Post.create({
      workerId: user._id,
      skill,
      caption,
      afterUrl,
      beforeUrl: beforeUrl || null,
      bookingId: bookingObjectId,
      verifiedJob,
      localityKey,
      location: {
        type: 'Point',
        coordinates: locationCoordinates
      },
      isSample: Boolean(user.isSample)
    });

    logAuditEvent('post_created', {
      userId: user._id,
      postId: post._id,
      skill,
      verifiedJob
    });

    return formatPostResponse(post, user, { isFollowing: false, isSaved: false, isMine: true });
  } catch (err) {
    // If post insertion failed, roll back the quota increment atomically
    await User.updateOne(
      { _id: user._id },
      {
        $inc: {
          activePostCount: -1,
          'postQuota.count': -1
        }
      }
    );
    throw err;
  }
}

/**
 * Deletes a work post by ID.
 * Owner only. Unknown or non-owner gets identical 404 NOT_FOUND.
 * Decrements activePostCount (never below 0).
 * Safe to repeat.
 *
 * @param {string} postId
 * @param {object} user Worker document
 * @returns {Promise<{ message: string }>}
 */
export async function deletePost(postId, user) {
  if (user.role !== 'worker') {
    throw new AppError('NOT_FOUND', 'Post not found', 404);
  }

  if (!mongoose.Types.ObjectId.isValid(postId)) {
    throw new AppError('NOT_FOUND', 'Post not found', 404);
  }

  const post = await Post.findById(postId);
  if (!post || post.workerId.toString() !== user._id.toString()) {
    throw new AppError('NOT_FOUND', 'Post not found', 404);
  }

  await Post.deleteOne({ _id: post._id });

  // Atomically decrement activePostCount, ensuring it never drops below 0
  await User.updateOne(
    { _id: user._id, activePostCount: { $gt: 0 } },
    { $inc: { activePostCount: -1 } }
  );

  logAuditEvent('post_deleted', {
    userId: user._id,
    postId: post._id
  });

  return { message: 'Post deleted successfully' };
}

/**
 * Formats a single post for API responses.
 * Never leaks bookingId, exact coordinates, phone, or email.
 *
 * @param {object} post Post document
 * @param {object} worker Worker user document
 * @param {object} viewerContext { isFollowing: boolean, isSaved: boolean, isMine: boolean, approxDistance?: object }
 * @returns {object}
 */
export function formatPostResponse(post, worker, viewerContext = {}) {
  const locDoc = post.localityKey ? getLocalityByKey(post.localityKey) : null;

  const item = {
    id: post._id.toString(),
    worker: {
      id: worker._id.toString(),
      name: worker.name,
      photoUrl: worker.photoUrl || null,
      mainSkill: worker.mainSkill || null,
      hasVerifiedHistory: (worker.passportStats?.jobs || 0) > 0
    },
    skill: post.skill,
    caption: post.caption,
    afterUrl: post.afterUrl,
    beforeUrl: post.beforeUrl || null,
    verifiedJob: Boolean(post.verifiedJob),
    isSample: Boolean(post.isSample),
    createdAt: post.createdAt,
    localityName: locDoc ? locDoc.name : null,
    viewer: {
      isFollowing: Boolean(viewerContext.isFollowing),
      isSaved: Boolean(viewerContext.isSaved)
    },
    isMine: Boolean(viewerContext.isMine)
  };

  if (viewerContext.approxDistance) {
    item.approxDistance = viewerContext.approxDistance;
  }

  return item;
}
