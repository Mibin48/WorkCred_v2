import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePhotoUrl, validateProfileUpdateShape, findNearestLocality } from '../../../../shared/profileValidators.js';

describe('shared/profileValidators.js', () => {
  const context = {
    cloudName: 'testcloud',
    nodeEnv: 'test',
    userId: '670f5e128b9c2a1122334455'
  };

  it('validates photoUrl: own user folder passes, others fail', () => {
    // 1. Valid url for own folder
    const validUrl = `https://res.cloudinary.com/testcloud/image/upload/v12345/workcred/test/670f5e128b9c2a1122334455/avatar/photo.jpg`;
    assert.equal(validatePhotoUrl(validUrl, context).valid, true);

    // 2. Empty string allowed (to clear photo)
    assert.equal(validatePhotoUrl('', context).valid, true);
    assert.equal(validatePhotoUrl(null, context).valid, true);

    // 3. Different user's folder fails
    const otherUserUrl = `https://res.cloudinary.com/testcloud/image/upload/v12345/workcred/test/999999999999999999999999/avatar/photo.jpg`;
    assert.equal(validatePhotoUrl(otherUserUrl, context).valid, false);

    // 4. Different cloudName fails
    const otherCloudUrl = `https://res.cloudinary.com/othercloud/image/upload/v12345/workcred/test/670f5e128b9c2a1122334455/avatar/photo.jpg`;
    assert.equal(validatePhotoUrl(otherCloudUrl, context).valid, false);

    // 5. Non-https fails
    const httpUrl = `http://res.cloudinary.com/testcloud/image/upload/v12345/workcred/test/670f5e128b9c2a1122334455/avatar/photo.jpg`;
    assert.equal(validatePhotoUrl(httpUrl, context).valid, false);

    // 6. Query string / fragment fails
    const queryUrl = `${validUrl}?token=abc`;
    assert.equal(validatePhotoUrl(queryUrl, context).valid, false);

    // 7. Non-Cloudinary domain fails
    const externalUrl = `https://malicious.com/image.jpg`;
    assert.equal(validatePhotoUrl(externalUrl, context).valid, false);
  });

  it('validates location bounds and nearest locality fallback', () => {
    // Kakkanad coordinates (~10.0159, 76.3419)
    const nearest = findNearestLocality(10.0160, 76.3420, 25);
    assert.ok(nearest);
    assert.equal(nearest.key, 'kakkanad');

    // Out of India bounds
    const invalidLocResult = validateProfileUpdateShape(
      { location: { lat: 0, lng: 0 } },
      { role: 'customer', _id: '670f5e128b9c2a1122334455' },
      context
    );
    assert.equal(invalidLocResult.valid, false);
    assert.ok(invalidLocResult.errors.some(e => e.includes('India bounds')));
  });

  it('rejects forbidden fields on profile update', () => {
    const forbiddenList = ['email', 'role', 'passwordHash', 'tokenVersion', 'isActive', 'profileComplete'];

    for (const field of forbiddenList) {
      const res = validateProfileUpdateShape(
        { [field]: 'not_allowed' },
        { role: 'worker', _id: '670f5e128b9c2a1122334455' },
        context
      );
      assert.equal(res.valid, false);
      assert.ok(res.errors.some(e => e.includes(`Modifying field '${field}' is not permitted`)));
    }
  });

  it('rejects worker fields when sent by a customer', () => {
    const res = validateProfileUpdateShape(
      { hourlyRate: 200 },
      { role: 'customer', _id: '670f5e128b9c2a1122334455' },
      context
    );
    assert.equal(res.valid, false);
    assert.equal(res.isCustomerSendingWorkerField, true);
  });
});
