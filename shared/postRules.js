/**
 * shared/postRules.js – Pure validation rules for work posts.
 *
 * Enforces:
 * - Skill validation against VALID_SKILLS and worker's personal skills.
 * - Caption length (max 140 chars NFC trimmed), non-empty, and contact info blocking.
 * - Strict Cloudinary URL validation parameterised by expected folder.
 */

import { VALID_SKILLS } from './profileRules.js';
import { containsContactInfo } from './containsContactInfo.js';

export const POST_LIMITS = {
  maxCaptionLength: 140,
  maxDailyPostsPerWorker: 10,
  maxActivePostsPerWorker: 100
};

/**
 * Validates a photo URL strictly bound to Cloudinary cloudName, NODE_ENV,
 * userId folder, and subfolder (e.g. 'avatar' or 'posts').
 *
 * @param {string} photoUrl
 * @param {object} context { cloudName, nodeEnv, userId, folderType: 'avatar' | 'posts' }
 * @returns {{ valid: boolean, error?: string, sanitizedUrl?: string }}
 */
export function validatePhotoUrlByFolder(photoUrl, context = {}) {
  if (photoUrl === '' || photoUrl === null) {
    return { valid: true, sanitizedUrl: null };
  }

  if (typeof photoUrl !== 'string') {
    return { valid: false, error: 'photoUrl must be a string' };
  }

  // Reject query strings or fragments
  if (photoUrl.includes('?') || photoUrl.includes('#')) {
    return { valid: false, error: 'photoUrl must not contain query parameters or fragments' };
  }

  const { cloudName, nodeEnv, userId, folderType = 'avatar' } = context;
  if (!cloudName || !nodeEnv || !userId) {
    return { valid: false, error: 'Server upload configuration missing' };
  }

  try {
    const url = new URL(photoUrl);
    if (url.protocol !== 'https:') {
      return { valid: false, error: 'photoUrl must use HTTPS' };
    }
    if (url.hostname !== 'res.cloudinary.com') {
      return { valid: false, error: 'photoUrl must be hosted on res.cloudinary.com' };
    }

    const expectedPrefix = `/${cloudName}/image/upload/`;
    if (!url.pathname.startsWith(expectedPrefix)) {
      return { valid: false, error: `photoUrl must point to cloud ${cloudName}` };
    }

    const expectedFolder = `workcred/${nodeEnv}/${userId}/${folderType}/`;
    if (!url.pathname.includes(expectedFolder)) {
      return { valid: false, error: `photoUrl must reside inside your own user's ${folderType} folder` };
    }

    return { valid: true, sanitizedUrl: photoUrl.trim() };
  } catch {
    return { valid: false, error: 'photoUrl is not a valid URL' };
  }
}

/**
 * Validates inputs for creating a work post (POST /posts).
 *
 * @param {object} body
 * @param {object} context { workerSkills: string[], cloudName: string, nodeEnv: string, userId: string }
 * @returns {{ valid: boolean, errors: string[], data?: object, unknownFields?: string[] }}
 */
export function validatePostInput(body, context = {}) {
  const errors = [];
  const allowedKeys = new Set(['skill', 'caption', 'afterUrl', 'beforeUrl', 'bookingId']);

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  const unknownFields = Object.keys(body).filter((k) => !allowedKeys.has(k));
  if (unknownFields.length > 0) {
    return {
      valid: false,
      errors: [`Unknown fields not allowed: ${unknownFields.join(', ')}`],
      unknownFields
    };
  }

  // 1. Skill
  let skill = null;
  if (!body.skill || typeof body.skill !== 'string') {
    errors.push('skill is required');
  } else {
    skill = body.skill.trim().toLowerCase();
    if (!VALID_SKILLS.includes(skill)) {
      errors.push(`skill '${body.skill}' is not a recognized skill`);
    } else if (Array.isArray(context.workerSkills) && !context.workerSkills.includes(skill)) {
      errors.push(`skill '${skill}' is not in your worker profile skills`);
    }
  }

  // 2. Caption
  let caption = null;
  if (body.caption === undefined || body.caption === null || typeof body.caption !== 'string') {
    errors.push('caption is required and must be a string');
  } else {
    caption = body.caption.trim().normalize('NFC');
    if (caption.length === 0) {
      errors.push('caption cannot be empty');
    } else if (caption.length > POST_LIMITS.maxCaptionLength) {
      errors.push(`caption cannot exceed ${POST_LIMITS.maxCaptionLength} characters`);
    } else if (containsContactInfo(caption)) {
      errors.push('caption contains prohibited contact information (phone, email, social handle, or link)');
    }
  }

  // 3. afterUrl (required)
  let afterUrl = null;
  if (!body.afterUrl || typeof body.afterUrl !== 'string') {
    errors.push('afterUrl is required');
  } else {
    const afterCheck = validatePhotoUrlByFolder(body.afterUrl, {
      cloudName: context.cloudName,
      nodeEnv: context.nodeEnv,
      userId: context.userId,
      folderType: 'posts'
    });
    if (!afterCheck.valid) {
      errors.push(`afterUrl invalid: ${afterCheck.error}`);
    } else {
      afterUrl = afterCheck.sanitizedUrl;
    }
  }

  // 4. beforeUrl (optional)
  let beforeUrl = null;
  if (body.beforeUrl !== undefined && body.beforeUrl !== null && body.beforeUrl !== '') {
    if (typeof body.beforeUrl !== 'string') {
      errors.push('beforeUrl must be a string');
    } else {
      const beforeCheck = validatePhotoUrlByFolder(body.beforeUrl, {
        cloudName: context.cloudName,
        nodeEnv: context.nodeEnv,
        userId: context.userId,
        folderType: 'posts'
      });
      if (!beforeCheck.valid) {
        errors.push(`beforeUrl invalid: ${beforeCheck.error}`);
      } else {
        beforeUrl = beforeCheck.sanitizedUrl;
      }
    }
  }

  // 5. bookingId (optional)
  let bookingId = null;
  if (body.bookingId !== undefined && body.bookingId !== null && body.bookingId !== '') {
    if (typeof body.bookingId !== 'string') {
      errors.push('bookingId must be a string');
    } else {
      bookingId = body.bookingId.trim();
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: {
      skill,
      caption,
      afterUrl,
      beforeUrl,
      bookingId
    }
  };
}
