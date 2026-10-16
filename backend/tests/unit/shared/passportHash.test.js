import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computePassportHash, GENESIS_PREV_HASH } from '../../../../shared/passportHash.js';

describe('shared/passportHash.js', () => {
  const referenceVector = {
    prevHash: GENESIS_PREV_HASH,
    seq: 1,
    bookingId: '670f5e128b9c2a1122334455',
    skill: 'electrician',
    date: '2026-10-16',
    hours: 3.5,
    rating: 5,
    comment: 'Great work fixing the distribution board.',
    employerName: 'Ramesh Kumar'
  };

  const expectedHash = '98ac98ecd2d07703d180823047245583f3c073ff47de9054327404aa45fafcbd';

  it('matches the exact reference test vector published in docs/SECURITY_SPEC.md', () => {
    const hash = computePassportHash(referenceVector);
    assert.equal(hash, expectedHash);
  });

  it('altering any data field produces a completely different hash', () => {
    const alteredSkill = computePassportHash({ ...referenceVector, skill: 'plumber' });
    assert.notEqual(alteredSkill, expectedHash);

    const alteredHours = computePassportHash({ ...referenceVector, hours: 3.55 });
    assert.notEqual(alteredHours, expectedHash);

    const alteredRating = computePassportHash({ ...referenceVector, rating: 4 });
    assert.notEqual(alteredRating, expectedHash);

    const alteredComment = computePassportHash({ ...referenceVector, comment: 'Different comment' });
    assert.notEqual(alteredComment, expectedHash);

    const alteredEmployer = computePassportHash({ ...referenceVector, employerName: 'Suresh Kumar' });
    assert.notEqual(alteredEmployer, expectedHash);

    const alteredSeq = computePassportHash({ ...referenceVector, seq: 2 });
    assert.notEqual(alteredSeq, expectedHash);
  });

  it('toggling visible or masking flags does not alter the hash because they are not part of canonical input', () => {
    // Both entries have identical canonical fields
    const entryWithPrivacyFlagsOn = {
      ...referenceVector,
      visible: true,
      maskEmployerName: true
    };
    const entryWithPrivacyFlagsOff = {
      ...referenceVector,
      visible: false,
      maskEmployerName: false
    };

    const hash1 = computePassportHash(entryWithPrivacyFlagsOn);
    const hash2 = computePassportHash(entryWithPrivacyFlagsOff);

    assert.equal(hash1, expectedHash);
    assert.equal(hash2, expectedHash);
    assert.equal(hash1, hash2);
  });
});
