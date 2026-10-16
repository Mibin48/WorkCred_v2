import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isProfileComplete } from '../../../../shared/profileRules.js';

describe('shared/profileRules.js', () => {
  it('evaluates customer profile completeness', () => {
    // Complete customer
    assert.equal(
      isProfileComplete({
        role: 'customer',
        name: 'Anita Roy',
        phone: '9876543210',
        localityKey: 'kakkanad'
      }),
      true
    );

    // Missing localityKey
    assert.equal(
      isProfileComplete({
        role: 'customer',
        name: 'Anita Roy',
        phone: '9876543210',
        localityKey: null
      }),
      false
    );

    // Missing name
    assert.equal(
      isProfileComplete({
        role: 'customer',
        name: ' ',
        phone: '9876543210',
        localityKey: 'kakkanad'
      }),
      false
    );

    // Invalid phone
    assert.equal(
      isProfileComplete({
        role: 'customer',
        name: 'Anita Roy',
        phone: '12345',
        localityKey: 'kakkanad'
      }),
      false
    );
  });

  it('evaluates worker profile completeness across all required field combinations', () => {
    const baseCompleteWorker = {
      role: 'worker',
      name: 'Ramesh Electrician',
      phone: '9876543210',
      localityKey: 'edappally',
      skills: ['electrician'],
      mainSkill: 'electrician',
      hourlyRate: 150,
      dailyRate: 0,
      radiusKm: 5
    };

    assert.equal(isProfileComplete(baseCompleteWorker), true);

    // Works with dailyRate only
    assert.equal(
      isProfileComplete({
        ...baseCompleteWorker,
        hourlyRate: 0,
        dailyRate: 1000
      }),
      true
    );

    // Fails when neither hourlyRate nor dailyRate > 0
    assert.equal(
      isProfileComplete({
        ...baseCompleteWorker,
        hourlyRate: 0,
        dailyRate: 0
      }),
      false
    );

    // Fails when skills empty
    assert.equal(
      isProfileComplete({
        ...baseCompleteWorker,
        skills: []
      }),
      false
    );

    // Fails when mainSkill is not in skills array
    assert.equal(
      isProfileComplete({
        ...baseCompleteWorker,
        skills: ['electrician'],
        mainSkill: 'plumber'
      }),
      false
    );

    // Fails when radiusKm is missing or out of bounds (1 to 10)
    assert.equal(
      isProfileComplete({
        ...baseCompleteWorker,
        radiusKm: null
      }),
      false
    );
    assert.equal(
      isProfileComplete({
        ...baseCompleteWorker,
        radiusKm: 0
      }),
      false
    );
    assert.equal(
      isProfileComplete({
        ...baseCompleteWorker,
        radiusKm: 11
      }),
      false
    );

    // Photo and bio are optional (completeness stays true even without them)
    assert.equal(
      isProfileComplete({
        ...baseCompleteWorker,
        photoUrl: null,
        bio: ''
      }),
      true
    );
  });
});
