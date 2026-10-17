import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import {
  User,
  RefreshToken,
  Job,
  Booking,
  PassportEntry,
  Availability,
  RateStats,
  Post,
  Follow,
  Endorsement,
  Report,
  IdempotencyKey
} from '../../src/models/index.js';

describe('backend/tests/integration/models.integration.test.js (In-Memory MongoDB)', () => {
  let mongoServer;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri() + 'workcred_integration';
    await mongoose.connect(uri, { autoIndex: true });

    // Ensure all model indexes are built in the memory database
    await Promise.all([
      User.init(),
      RefreshToken.init(),
      Job.init(),
      Booking.init(),
      PassportEntry.init(),
      Availability.init(),
      RateStats.init(),
      Post.init(),
      Follow.init(),
      Endorsement.init(),
      Report.init(),
      IdempotencyKey.init()
    ]);
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it('verifies User schema: duplicate email is rejected, while duplicate phone is allowed', async () => {
    const user1 = new User({
      email: 'unique1@example.com',
      phone: '9876543210',
      role: 'customer',
      name: 'Customer One',
      passwordHash: 'dummyScryptHash1'
    });
    await user1.save();

    // Duplicate email must throw duplicate key error (code 11000)
    const duplicateEmailUser = new User({
      email: 'unique1@example.com',
      phone: '9123456789',
      role: 'worker',
      name: 'Worker With Same Email',
      passwordHash: 'dummyScryptHash2'
    });

    await assert.rejects(async () => {
      await duplicateEmailUser.save();
    }, (err) => {
      assert.equal(err.code, 11000);
      return true;
    });

    // Duplicate phone with DIFFERENT email must be allowed per Decision B and F1
    const duplicatePhoneUser = new User({
      email: 'unique2@example.com',
      phone: '9876543210', // Same phone as user1!
      role: 'worker',
      name: 'Worker With Same Phone',
      passwordHash: 'dummyScryptHash3'
    });

    const saved = await duplicatePhoneUser.save();
    assert.equal(saved.email, 'unique2@example.com');
    assert.equal(saved.phone, '9876543210');
  });

  it('verifies User role immutability', async () => {
    const user = await User.findOne({ email: 'unique1@example.com' });
    user.role = 'worker'; // Attempt to change role

    // In Mongoose, immutable fields discard updates or throw
    await user.save();
    const reloaded = await User.findOne({ email: 'unique1@example.com' });
    assert.equal(reloaded.role, 'customer'); // Role remained unchanged!
  });

  it('verifies RefreshToken collection has unique tokenHash and TTL index', async () => {
    const indexes = await RefreshToken.collection.indexes();
    const tokenHashIndex = indexes.find(i => i.key.tokenHash === 1);
    const ttlIndex = indexes.find(i => i.key.expiresAt === 1);

    assert.ok(tokenHashIndex, 'Expected tokenHash index');
    assert.equal(tokenHashIndex.unique, true);

    assert.ok(ttlIndex, 'Expected TTL index on expiresAt');
    assert.equal(ttlIndex.expireAfterSeconds, 0);
  });

  it('verifies PassportEntry collection enforces immutability except visible and maskEmployerName', async () => {
    const entry = new PassportEntry({
      workerId: new mongoose.Types.ObjectId(),
      bookingId: new mongoose.Types.ObjectId(),
      recordId: 'REC12345',
      seq: 1,
      skill: 'electrician',
      date: new Date('2026-10-16'),
      hours: 4,
      rating: 5,
      comment: 'Initial comment',
      employerName: 'Real Employer',
      employerDisplay: { name: 'Real Employer', masked: 'R*** E.' },
      maskEmployerName: true,
      visible: true,
      prevHash: '0'.repeat(64),
      hash: 'abc123hash'
    });
    await entry.save();

    // Changing visible and maskEmployerName is allowed
    await PassportEntry.updateOne({ _id: entry._id }, { $set: { visible: false, maskEmployerName: false } });
    const updated = await PassportEntry.findById(entry._id);
    assert.equal(updated.visible, false);
    assert.equal(updated.maskEmployerName, false);

    // Attempting to change rating or hours must be blocked by pre-update hook
    await assert.rejects(async () => {
      await PassportEntry.updateOne({ _id: entry._id }, { $set: { rating: 1 } });
    }, /Cannot update immutable field "rating"/);

    await assert.rejects(async () => {
      await PassportEntry.updateOne({ _id: entry._id }, { $set: { hours: 10 } });
    }, /Cannot update immutable field "hours"/);
  });

  it('verifies 2dsphere indexes on geo collections (Job, Availability, Post)', async () => {
    const jobIndexes = await Job.collection.indexes();
    const availIndexes = await Availability.collection.indexes();
    const postIndexes = await Post.collection.indexes();

    assert.ok(jobIndexes.some(i => i.key.location === '2dsphere'));
    assert.ok(availIndexes.some(i => i.key.location === '2dsphere'));
    assert.ok(postIndexes.some(i => i.key.location === '2dsphere'));
  });

  it('verifies 24-hour TTL index on IdempotencyKey', async () => {
    const keyIndexes = await IdempotencyKey.collection.indexes();
    const ttlIndex = keyIndexes.find(i => i.key.createdAt === 1);
    assert.ok(ttlIndex, 'Expected TTL index on IdempotencyKey.createdAt');
    assert.equal(ttlIndex.expireAfterSeconds, 86400);
  });
});
