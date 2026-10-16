import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSlotAvailable, isTimeInSlot, getIndiaTimeParts } from '../../../../shared/calendarRules.js';

describe('shared/calendarRules.js', () => {
  it('correctly derives India Time (UTC+5:30) date parts', () => {
    // 2026-10-16T12:00:00.000Z -> In India is 17:30 (5:30 PM Friday)
    const utcDate = new Date('2026-10-16T12:00:00.000Z');
    const parts = getIndiaTimeParts(utcDate);

    assert.equal(parts.dateString, '2026-10-16');
    assert.equal(parts.hours, 17);
    assert.equal(parts.minutes, 30);
    assert.equal(parts.dayKey, 'fri');
  });

  it('evaluates exact boundary minutes for slot definitions', () => {
    // morning: 06:00 to 12:00
    assert.equal(isTimeInSlot('morning', 5, 59), false);
    assert.equal(isTimeInSlot('morning', 6, 0), true);
    assert.equal(isTimeInSlot('morning', 11, 59), true);
    assert.equal(isTimeInSlot('morning', 12, 0), false);

    // afternoon: 12:00 to 17:00
    assert.equal(isTimeInSlot('afternoon', 11, 59), false);
    assert.equal(isTimeInSlot('afternoon', 12, 0), true);
    assert.equal(isTimeInSlot('afternoon', 16, 59), true);
    assert.equal(isTimeInSlot('afternoon', 17, 0), false);

    // evening: 17:00 to 21:00
    assert.equal(isTimeInSlot('evening', 16, 59), false);
    assert.equal(isTimeInSlot('evening', 17, 0), true);
    assert.equal(isTimeInSlot('evening', 20, 59), true);
    assert.equal(isTimeInSlot('evening', 21, 0), false);

    // full: 06:00 to 21:00
    assert.equal(isTimeInSlot('full', 5, 59), false);
    assert.equal(isTimeInSlot('full', 6, 0), true);
    assert.equal(isTimeInSlot('full', 20, 59), true);
    assert.equal(isTimeInSlot('full', 21, 0), false);

    // off: never available
    assert.equal(isTimeInSlot('off', 10, 0), false);
    assert.equal(isTimeInSlot('off', 14, 0), false);
  });

  it('blocked dates win over weekly pattern', () => {
    // Friday in India at 10:00 AM (04:30 UTC)
    const testDate = new Date('2026-10-16T04:30:00.000Z');

    const calendarWithBlock = {
      weekly: {
        fri: 'full'
      },
      blockedDates: [
        { date: '2026-10-16', reason: 'Personal holiday' }
      ]
    };

    assert.equal(isSlotAvailable(calendarWithBlock, testDate), false);

    // When date is unblocked, weekly pattern returns true
    const calendarUnblocked = {
      weekly: {
        fri: 'full'
      },
      blockedDates: [
        { date: '2026-10-17', reason: 'Different day' }
      ]
    };

    assert.equal(isSlotAvailable(calendarUnblocked, testDate), true);
  });
});
