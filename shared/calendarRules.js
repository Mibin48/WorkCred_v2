/**
 * Time ranges in India Standard Time (Asia/Kolkata):
 * morning: 06:00 to 12:00 [06:00, 12:00)
 * afternoon: 12:00 to 17:00 [12:00, 17:00)
 * evening: 17:00 to 21:00 [17:00, 21:00)
 * full: 06:00 to 21:00 [06:00, 21:00)
 * off: never
 */

const DAY_MAP = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Returns India Time parts { year, month, date, hours, minutes, dayName } for a given Date.
 * Asia/Kolkata is UTC+5:30 (330 minutes offset).
 * 
 * @param {Date|string|number} dateTime 
 * @returns {{ dateString: string, hours: number, minutes: number, dayKey: string }}
 */
export function getIndiaTimeParts(dateTime) {
  const d = new Date(dateTime);
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid Date provided to getIndiaTimeParts');
  }

  // Offset in ms for UTC+5:30
  const kolkataOffsetMs = 5.5 * 60 * 60 * 1000;
  const kolkataDate = new Date(d.getTime() + kolkataOffsetMs);

  const year = kolkataDate.getUTCFullYear();
  const month = String(kolkataDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kolkataDate.getUTCDate()).padStart(2, '0');
  const dateString = `${year}-${month}-${day}`;

  const hours = kolkataDate.getUTCHours();
  const minutes = kolkataDate.getUTCMinutes();
  const dayKey = DAY_MAP[kolkataDate.getUTCDay()];

  return { dateString, hours, minutes, dayKey };
}

/**
 * Checks if a time boundary (hours, minutes) fits within a slot definition:
 * morning: 06:00 <= time < 12:00
 * afternoon: 12:00 <= time < 17:00
 * evening: 17:00 <= time < 21:00
 * full: 06:00 <= time < 21:00
 * off: false
 * 
 * @param {string} slot 
 * @param {number} hours 
 * @param {number} minutes 
 * @returns {boolean}
 */
export function isTimeInSlot(slot, hours, minutes) {
  const totalMinutes = hours * 60 + minutes;
  const slotLower = String(slot || '').toLowerCase();

  switch (slotLower) {
    case 'morning':
      // 06:00 (360) to 12:00 (720)
      return totalMinutes >= 360 && totalMinutes < 720;
    case 'afternoon':
      // 12:00 (720) to 17:00 (1020)
      return totalMinutes >= 720 && totalMinutes < 1020;
    case 'evening':
      // 17:00 (1020) to 21:00 (1260)
      return totalMinutes >= 1020 && totalMinutes < 1260;
    case 'full':
      // 06:00 (360) to 21:00 (1260)
      return totalMinutes >= 360 && totalMinutes < 1260;
    case 'off':
    default:
      return false;
  }
}

/**
 * Evaluates whether a worker is available at a given dateTime in India Time.
 * Rules:
 * 1. If date matches any entry in blockedDates, worker is blocked (returns false). Blocked date wins.
 * 2. Look up weekday slot from calendar.weekly (mon, tue, wed, thu, fri, sat, sun).
 * 3. Return true if time falls inside the slot range, false otherwise.
 * 
 * @param {object} calendar 
 * @param {Date|string|number} dateTime 
 * @returns {boolean}
 */
export function isSlotAvailable(calendar, dateTime) {
  if (!calendar || typeof calendar !== 'object') return false;

  const { dateString, hours, minutes, dayKey } = getIndiaTimeParts(dateTime);

  // 1. Check blockedDates (takes priority)
  if (Array.isArray(calendar.blockedDates)) {
    const isBlocked = calendar.blockedDates.some((b) => {
      const bDate = typeof b === 'string' ? b : b?.date;
      return bDate === dateString;
    });
    if (isBlocked) {
      return false;
    }
  }

  // 2. Check weekly pattern
  let slot = 'full'; // Default baseline if unspecified
  if (calendar.weekly && typeof calendar.weekly === 'object') {
    slot = calendar.weekly[dayKey] || 'off';
  }

  return isTimeInSlot(slot, hours, minutes);
}
