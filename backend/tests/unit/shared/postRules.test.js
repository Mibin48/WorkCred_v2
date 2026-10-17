/**
 * backend/tests/unit/shared/postRules.test.js
 *
 * Tests:
 * - Caption limits at 139, 140, 141 characters.
 * - Caption with phone, email, link rejected.
 * - Photo URL rule by folder: own folder passes, other user, other folder, other cloud, http, query strings fail.
 * - Post input validation with workerSkills check.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePhotoUrlByFolder,
  validatePostInput,
  POST_LIMITS
} from '../../../../shared/postRules.js';

describe('shared/postRules.js Unit Tests', () => {
  const context = {
    cloudName: 'testcloud',
    nodeEnv: 'test',
    userId: 'user123',
    folderType: 'posts'
  };

  describe('validatePhotoUrlByFolder', () => {
    it('accepts valid https URL within own user posts folder', () => {
      const validUrl = 'https://res.cloudinary.com/testcloud/image/upload/v12345/workcred/test/user123/posts/my_pic.jpg';
      const result = validatePhotoUrlByFolder(validUrl, context);
      assert.equal(result.valid, true);
      assert.equal(result.sanitizedUrl, validUrl);
    });

    it('accepts valid https URL within own user avatar folder when requested', () => {
      const avatarContext = { ...context, folderType: 'avatar' };
      const validUrl = 'https://res.cloudinary.com/testcloud/image/upload/v12345/workcred/test/user123/avatar/photo.png';
      const result = validatePhotoUrlByFolder(validUrl, avatarContext);
      assert.equal(result.valid, true);
    });

    it('rejects post URL that resides in avatar folder', () => {
      const avatarUrl = 'https://res.cloudinary.com/testcloud/image/upload/v12345/workcred/test/user123/avatar/photo.png';
      const result = validatePhotoUrlByFolder(avatarUrl, context); // folderType is posts
      assert.equal(result.valid, false);
      assert.match(result.error, /posts folder/);
    });

    it('rejects photo URL belonging to another user', () => {
      const otherUserUrl = 'https://res.cloudinary.com/testcloud/image/upload/v12345/workcred/test/user999/posts/pic.jpg';
      const result = validatePhotoUrlByFolder(otherUserUrl, context);
      assert.equal(result.valid, false);
      assert.match(result.error, /posts folder/);
    });

    it('rejects photo URL on different cloud', () => {
      const otherCloudUrl = 'https://res.cloudinary.com/wrongcloud/image/upload/v12345/workcred/test/user123/posts/pic.jpg';
      const result = validatePhotoUrlByFolder(otherCloudUrl, context);
      assert.equal(result.valid, false);
      assert.match(result.error, /cloud testcloud/);
    });

    it('rejects non-https URLs', () => {
      const httpUrl = 'http://res.cloudinary.com/testcloud/image/upload/v12345/workcred/test/user123/posts/pic.jpg';
      const result = validatePhotoUrlByFolder(httpUrl, context);
      assert.equal(result.valid, false);
      assert.match(result.error, /HTTPS/);
    });

    it('rejects query strings and hash fragments', () => {
      const queryUrl = 'https://res.cloudinary.com/testcloud/image/upload/v12345/workcred/test/user123/posts/pic.jpg?w=500';
      const hashUrl = 'https://res.cloudinary.com/testcloud/image/upload/v12345/workcred/test/user123/posts/pic.jpg#frag';
      assert.equal(validatePhotoUrlByFolder(queryUrl, context).valid, false);
      assert.equal(validatePhotoUrlByFolder(hashUrl, context).valid, false);
    });
  });

  describe('validatePostInput caption and skill limits', () => {
    const postContext = {
      workerSkills: ['electrician', 'plumber'],
      cloudName: 'testcloud',
      nodeEnv: 'test',
      userId: 'user123'
    };

    const validAfterUrl = 'https://res.cloudinary.com/testcloud/image/upload/v123/workcred/test/user123/posts/after.jpg';

    it('accepts caption at 139 characters', () => {
      const caption139 = 'a'.repeat(139);
      const res = validatePostInput({
        skill: 'electrician',
        caption: caption139,
        afterUrl: validAfterUrl
      }, postContext);
      assert.equal(res.valid, true);
    });

    it('accepts caption at 140 characters', () => {
      const caption140 = 'a'.repeat(140);
      const res = validatePostInput({
        skill: 'electrician',
        caption: caption140,
        afterUrl: validAfterUrl
      }, postContext);
      assert.equal(res.valid, true);
    });

    it('rejects caption at 141 characters', () => {
      const caption141 = 'a'.repeat(141);
      const res = validatePostInput({
        skill: 'electrician',
        caption: caption141,
        afterUrl: validAfterUrl
      }, postContext);
      assert.equal(res.valid, false);
      assert.match(res.errors[0], /cannot exceed 140 characters/);
    });

    it('rejects caption with contact info: phone number', () => {
      const res = validatePostInput({
        skill: 'electrician',
        caption: 'Call me at 9845012345 for wiring',
        afterUrl: validAfterUrl
      }, postContext);
      assert.equal(res.valid, false);
      assert.match(res.errors[0], /prohibited contact information/);
    });

    it('rejects caption with contact info: email', () => {
      const res = validatePostInput({
        skill: 'electrician',
        caption: 'Email me at worker@test.com',
        afterUrl: validAfterUrl
      }, postContext);
      assert.equal(res.valid, false);
      assert.match(res.errors[0], /prohibited contact information/);
    });

    it('rejects caption with contact info: web link', () => {
      const res = validatePostInput({
        skill: 'electrician',
        caption: 'Visit https://mysite.com for booking',
        afterUrl: validAfterUrl
      }, postContext);
      assert.equal(res.valid, false);
      assert.match(res.errors[0], /prohibited contact information/);
    });

    it('rejects skill not in worker skills', () => {
      const res = validatePostInput({
        skill: 'carpenter',
        caption: 'Built a nice table',
        afterUrl: validAfterUrl
      }, postContext);
      assert.equal(res.valid, false);
      assert.match(res.errors[0], /not in your worker profile skills/);
    });

    it('rejects unknown fields in post body', () => {
      const res = validatePostInput({
        skill: 'electrician',
        caption: 'Wiring done',
        afterUrl: validAfterUrl,
        extraField: 'not_allowed'
      }, postContext);
      assert.equal(res.valid, false);
      assert.match(res.errors[0], /Unknown fields not allowed/);
    });
  });
});
