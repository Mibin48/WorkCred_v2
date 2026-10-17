/**
 * shared/quotaRules.js – Pure rules for quotas and limits.
 *
 * Enforces:
 * - India calendar day calculation (Asia/Kolkata UTC+5:30) for post quotas.
 * - Daily reset condition at midnight IST.
 * - Caps: 10 posts/day, 100 active posts/worker, 500 follows, 500 saves.
 */

import { getIndiaTimeParts } from './calendarRules.js';

export const QUOTA_CAPS = {
  maxDailyPosts: 10,
  maxActivePosts: 100,
  maxFollows: 500,
  maxSaves: 500
};

/**
 * Returns India dayKey 'YYYY-MM-DD' for a given date or timestamp.
 *
 * @param {Date|number|string} dateTime
 * @returns {string} e.g. '2026-10-17'
 */
export function getIndiaDayKey(dateTime = new Date()) {
  const parts = getIndiaTimeParts(dateTime);
  return parts.dateString;
}

/**
 * Checks whether a worker can create another post under daily and active quotas.
 *
 * @param {object} user Worker user object
 * @param {string} todayKey Current India dayKey
 * @returns {{ allowed: boolean, reason?: 'POST_LIMIT_DAILY' | 'POST_LIMIT_ACTIVE' }}
 */
export function canCreatePost(user, todayKey) {
  const activeCount = user.activePostCount || 0;
  if (activeCount >= QUOTA_CAPS.maxActivePosts) {
    return { allowed: false, reason: 'POST_LIMIT_ACTIVE' };
  }

  const postQuota = user.postQuota || {};
  let currentDayCount = 0;
  if (postQuota.dayKey === todayKey) {
    currentDayCount = postQuota.count || 0;
  }

  if (currentDayCount >= QUOTA_CAPS.maxDailyPosts) {
    return { allowed: false, reason: 'POST_LIMIT_DAILY' };
  }

  return { allowed: true };
}

/**
 * Checks whether a user can follow or save another worker.
 *
 * @param {object} user Caller user document
 * @param {'follow' | 'save'} type
 * @returns {{ allowed: boolean, reason?: 'FOLLOW_LIMIT' | 'SAVE_LIMIT' }}
 */
export function canFollow(user, type) {
  const counts = user.followCounts || {};
  if (type === 'follow') {
    const current = counts.follow || 0;
    if (current >= QUOTA_CAPS.maxFollows) {
      return { allowed: false, reason: 'FOLLOW_LIMIT' };
    }
  } else if (type === 'save') {
    const current = counts.save || 0;
    if (current >= QUOTA_CAPS.maxSaves) {
      return { allowed: false, reason: 'SAVE_LIMIT' };
    }
  }
  return { allowed: true };
}
