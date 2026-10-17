/**
 * backend/src/seed/dataset.js – Definitive sample dataset specification.
 *
 * All sample users, workers, jobs, bookings, availability windows, posts,
 * follows, endorsements, and reports are declared here.
 *
 * Rules:
 * - Deterministic pseudo-randomness for reproducibility (L4).
 * - Relative time offsets to keep "tomorrow" tomorrow regardless of run time (L4).
 * - Fictional names, reserved example.com emails, 90000 00xxx unverified phones (L8).
 * - Captions, comments, notes pass containsContactInfo (L9).
 * - All sample rate numbers are FICTIONAL and labeled so (L9).
 */

import { containsContactInfo } from '../../../shared/containsContactInfo.js';

/**
 * Deterministic pseudo-random number generator (Mulberry32).
 */
export function createRng(seed = 123456789) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sample Workers Definition (12 workers)
 */
export const SAMPLE_WORKERS = [
  {
    key: 'E1',
    name: 'Suresh Menon',
    email: 'suresh.menon.sample@example.com',
    phone: '9000000101',
    mainSkill: 'electrician',
    skills: ['electrician', 'helper'],
    localityKey: 'kakkanad',
    hourlyRate: 140,
    dailyRate: 1100,
    radiusKm: 10,
    bio: 'Certified domestic and commercial electrical technician with 12 years of field experience in Kakkanad.',
    calendar: {
      weekly: { mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'full', sun: 'full' },
      blockedDates: []
    },
    profileComplete: true,
    isSample: true,
    demoNote: 'Experienced electrician with 14 completed jobs, verified Passport chain, hidden records, and endorsements'
  },
  {
    key: 'E2',
    name: 'Manoj Pillai',
    email: 'manoj.pillai.sample@example.com',
    phone: '9000000102',
    mainSkill: 'electrician',
    skills: ['electrician'],
    localityKey: 'kakkanad',
    hourlyRate: 130,
    dailyRate: 1000,
    radiusKm: 8,
    bio: 'Reliable electrician for residential rewiring and maintenance.',
    calendar: {
      weekly: { mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'full', sun: 'full' },
      blockedDates: []
    },
    profileComplete: true,
    isSample: true,
    demoNote: 'Electrician in Kakkanad with 2 confirmed cancellations to test cancellation warnings'
  },
  {
    key: 'P1',
    name: 'Shaji Mathew',
    email: 'shaji.mathew.sample@example.com',
    phone: '9000000103',
    mainSkill: 'plumber',
    skills: ['plumber'],
    localityKey: 'vyttila',
    hourlyRate: 135,
    dailyRate: 1050,
    radiusKm: 9,
    bio: 'Expert sanitary fittings, leak repairs, and overhead tank plumbing.',
    calendar: {
      weekly: { mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'full', sun: 'full' },
      blockedDates: []
    },
    profileComplete: true,
    isSample: true,
    demoNote: 'Plumber with bookings across Vyttila & Kaloor; live 4h Free Now window; far-from-job booking.'
  },
  {
    key: 'P2',
    name: 'Biju K.',
    email: 'biju.k.sample@example.com',
    phone: '9000000104',
    mainSkill: 'plumber',
    skills: ['plumber'],
    localityKey: 'palarivattom',
    hourlyRate: 125,
    dailyRate: 980,
    radiusKm: 7,
    bio: 'Residential pipeline repairs and bathroom fixture installations.',
    calendar: {
      weekly: { mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'full', sun: 'full' },
      blockedDates: []
    },
    profileComplete: true,
    isSample: true,
    demoNote: 'Plumber in Palarivattom for city-level Compass distribution.'
  },
  {
    key: 'H1',
    name: 'Anoop Raj',
    email: 'anoop.raj.sample@example.com',
    phone: '9000000105',
    mainSkill: 'helper',
    skills: ['helper'],
    localityKey: 'edappally',
    hourlyRate: 95,
    dailyRate: 750,
    radiusKm: 10,
    bio: 'Punctual and hardworking helper for loading, unloading, and site assistance.',
    calendar: {
      weekly: { mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'full', sun: 'full' },
      blockedDates: []
    },
    profileComplete: true,
    isSample: true,
    demoNote: 'Top-rated helper; 2 endorsements; live 2h Free Now window; verified work posts.'
  },
  {
    key: 'H2',
    name: 'Sreejith Mohan',
    email: 'sreejith.mohan.sample@example.com',
    phone: '9000000106',
    mainSkill: 'helper',
    skills: ['helper'],
    localityKey: 'edappally',
    hourlyRate: 90,
    dailyRate: 700,
    radiusKm: 8,
    bio: 'Reliable site helper for cleanups, moving, and general yard support.',
    calendar: {
      weekly: { mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'full', sun: 'full' },
      blockedDates: []
    },
    profileComplete: true,
    isSample: true,
    demoNote: 'Helper with 0 completed jobs for empty profile stats testing.'
  },
  {
    key: 'M1',
    name: 'Vijayan Joseph',
    email: 'vijayan.joseph.sample@example.com',
    phone: '9000000107',
    mainSkill: 'mason',
    skills: ['mason'],
    localityKey: 'aluva',
    hourlyRate: 145,
    dailyRate: 1150,
    radiusKm: 10,
    bio: 'Skilled civil mason for brickwork, plastering, and floor tile setting.',
    calendar: {
      weekly: { mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'full', sun: 'full' },
      blockedDates: []
    },
    profileComplete: true,
    isSample: true,
    demoNote: 'Mason with exactly 1 completed job; expired Free Now window; missed appointment.'
  },
  {
    key: 'PA1',
    name: 'Thomas Mathew',
    email: 'thomas.mathew.sample@example.com',
    phone: '9000000108',
    mainSkill: 'painter',
    skills: ['painter'],
    localityKey: 'tripunithura',
    hourlyRate: 120,
    dailyRate: 950,
    radiusKm: 8,
    bio: 'Interior and exterior emulsion painting, putty work, and wood polish.',
    calendar: {
      weekly: { mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'full', sun: 'full' },
      blockedDates: []
    },
    profileComplete: true,
    isSample: true,
    demoNote: 'Painter with blocked calendar today to test BLOCKED_TODAY guard.'
  },
  {
    key: 'C1',
    name: 'Harikrishnan P.',
    email: 'harikrishnan.p.sample@example.com',
    phone: '9000000109',
    mainSkill: 'carpenter',
    skills: ['carpenter'],
    localityKey: 'fort_kochi',
    hourlyRate: 140,
    dailyRate: 1100,
    radiusKm: 7,
    bio: 'Custom furniture assembly, door locks repair, and kitchen woodwork.',
    calendar: {
      weekly: { mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'full', sun: 'full' },
      blockedDates: []
    },
    profileComplete: true,
    isSample: true,
    demoNote: 'Carpenter in Fort Kochi with work post.'
  },
  {
    key: 'V1',
    name: 'Mini Soman',
    email: 'mini.soman.sample@example.com',
    phone: '9000000110',
    mainSkill: 'cook',
    skills: ['cook'],
    localityKey: 'thevara',
    hourlyRate: 115,
    dailyRate: 900,
    radiusKm: 6,
    bio: 'Catering and household traditional Kerala meals preparation.',
    calendar: {
      weekly: { mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'full', sun: 'full' },
      blockedDates: []
    },
    profileComplete: true,
    isSample: true,
    demoNote: 'Cook with 100% private records (visible: false) to test private-history privacy checks.'
  },
  {
    key: 'N1',
    name: 'Naveen Prakash',
    email: 'naveen.prakash.sample@example.com',
    phone: '9000000111',
    mainSkill: 'cleaner',
    skills: ['cleaner'],
    localityKey: 'kakkanad',
    hourlyRate: 90,
    dailyRate: 700,
    radiusKm: 5,
    bio: '',
    calendar: {
      weekly: { mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'full', sun: 'full' },
      blockedDates: []
    },
    profileComplete: true,
    isSample: true,
    demoNote: 'Brand-new cleaner with zero records, no photo, no bio (empty state demo).'
  },
  {
    key: 'D1',
    name: 'Manoj Varghese',
    email: 'manoj.varghese.sample@example.com',
    phone: '9000000112',
    mainSkill: 'driver',
    skills: ['driver'],
    localityKey: 'edappally',
    hourlyRate: 125,
    dailyRate: 1000,
    radiusKm: 10,
    bio: 'Professional driver for local trips and commercial shifting.',
    calendar: {
      weekly: { mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'full', sun: 'full' },
      blockedDates: []
    },
    profileComplete: true,
    isSample: true,
    demoNote: 'Driver in Edappally with work post.'
  }
];

/**
 * Sample Customers Definition (8 customers)
 */
export const SAMPLE_CUSTOMERS = [
  {
    key: 'CUST_BUSY',
    name: 'Rahul Nambiar',
    email: 'rahul.nambiar.sample@example.com',
    phone: '9000000201',
    localityKey: 'kakkanad',
    profileComplete: true,
    isSample: true,
    demoNote: 'Busy customer with bookings in every tab and active jobs'
  },
  {
    key: 'CUST_EMPTY',
    name: 'Deepa Kurian',
    email: 'deepa.kurian.sample@example.com',
    phone: '9000000202',
    localityKey: 'edappally',
    profileComplete: true,
    isSample: true,
    demoNote: 'Customer with zero bookings for empty state verification'
  },
  {
    key: 'CUST_3',
    name: 'Karthik Shenoy',
    email: 'karthik.shenoy.sample@example.com',
    phone: '9000000203',
    localityKey: 'kaloor',
    profileComplete: true,
    isSample: true,
    demoNote: 'Active customer in Kaloor'
  },
  {
    key: 'CUST_4',
    name: 'Anjali Nair',
    email: 'anjali.nair.sample@example.com',
    phone: '9000000204',
    localityKey: 'vyttila',
    profileComplete: true,
    isSample: true,
    demoNote: 'Customer in Vyttila'
  },
  {
    key: 'CUST_5',
    name: 'Mathew Abraham',
    email: 'mathew.abraham.sample@example.com',
    phone: '9000000205',
    localityKey: 'aluva',
    profileComplete: true,
    isSample: true,
    demoNote: 'Customer in Aluva'
  },
  {
    key: 'CUST_6',
    name: 'Neetha George',
    email: 'neetha.george.sample@example.com',
    phone: '9000000206',
    localityKey: 'tripunithura',
    profileComplete: true,
    isSample: true,
    demoNote: 'Customer in Tripunithura'
  },
  {
    key: 'CUST_7',
    name: 'Faisal Mohammed',
    email: 'faisal.mohammed.sample@example.com',
    phone: '9000000207',
    localityKey: 'fort_kochi',
    profileComplete: true,
    isSample: true,
    demoNote: 'Customer in Fort Kochi'
  },
  {
    key: 'INC_CUST',
    name: 'Incomplete Customer',
    email: 'incomplete.customer.sample@example.com',
    phone: '9000000208',
    role: 'customer',
    profileComplete: false,
    isSample: true,
    demoNote: 'Customer with only name and phone for onboarding demos'
  }
];

/**
 * Historical Completed Bookings Schedule (Generates Compass rate coverage & Passport chains)
 *
 * Requirements:
 * - Electrician in Kakkanad: at least 6 completed bookings in last 90 days (locality source).
 *   Plus keep two bookings 85-89 days ago (inside window) and one 91 days ago (outside window) to prove window.
 * - Helper in Edappally: at least 5 completed bookings in last 90 days (locality source).
 * - Plumber: 5 or more across several Kochi localities but under 5 in any single one (city source).
 * - Worker E1 has 14 completed jobs total over last 80-92 days.
 * - Worker H1 has 8 completed jobs in Edappally.
 * - Worker P1 has 5 completed jobs. Worker P2 has 2 completed jobs.
 * - Worker M1 has 1 completed job.
 * - Worker V1 has 3 completed jobs (all will be made visible: false).
 */
export const COMPLETED_BOOKINGS_PLAN = [
  // --- Worker E1 (Electrician in Kakkanad) - 14 completed jobs ---
  // Booking 1: 91 days ago (outside 90-day Compass window, but part of Passport chain)
  { workerKey: 'E1', customerKey: 'CUST_BUSY', skill: 'electrician', daysAgo: 91, hours: 4, rate: 140, rating: 5, comment: 'Initial electrical wiring inspection', maskEmployer: true, visible: true },
  // Booking 2: 88 days ago (inside window)
  { workerKey: 'E1', customerKey: 'CUST_3', skill: 'electrician', daysAgo: 88, hours: 3, rate: 135, rating: 4, comment: 'Switchboard and circuit breakers installed', maskEmployer: true, visible: true },
  // Booking 3: 86 days ago (inside window)
  { workerKey: 'E1', customerKey: 'CUST_4', skill: 'electrician', daysAgo: 86, hours: 2, rate: 145, rating: 5, comment: 'Ceiling fans replacement and earthing check', maskEmployer: false, visible: true }, // employer name shown
  // Bookings 4-14: Spread across last 80 days
  { workerKey: 'E1', customerKey: 'CUST_5', skill: 'electrician', daysAgo: 75, hours: 5, rate: 140, rating: 5, comment: 'Complete 3-phase distribution box rewiring', maskEmployer: true, visible: false }, // hidden entry 1
  { workerKey: 'E1', customerKey: 'CUST_6', skill: 'electrician', daysAgo: 68, hours: 4, rate: 135, rating: 4, comment: 'Inverter wiring and backup line installation', maskEmployer: true, visible: true },
  { workerKey: 'E1', customerKey: 'CUST_7', skill: 'electrician', daysAgo: 60, hours: 3, rate: 145, rating: 5, comment: 'LED lighting and outdoor floodlights setup', maskEmployer: true, visible: false }, // hidden entry 2
  { workerKey: 'E1', customerKey: 'CUST_BUSY', skill: 'electrician', daysAgo: 52, hours: 2, rate: 140, rating: 4, comment: 'Kitchen exhaust and appliance power points', maskEmployer: true, visible: true },
  { workerKey: 'E1', customerKey: 'CUST_3', skill: 'electrician', daysAgo: 45, hours: 4, rate: 130, rating: 3, comment: 'Submersible pump motor electrical check', maskEmployer: true, visible: true }, // rating 3
  { workerKey: 'E1', customerKey: 'CUST_4', skill: 'electrician', daysAgo: 38, hours: 3, rate: 140, rating: 5, comment: 'Generator changeover switch replacement', maskEmployer: false, visible: true }, // employer name shown 2
  { workerKey: 'E1', customerKey: 'CUST_5', skill: 'electrician', daysAgo: 30, hours: 2, rate: 145, rating: 4, comment: 'Bathroom heater wiring and MCB upgrade', maskEmployer: true, visible: true },
  { workerKey: 'E1', customerKey: 'CUST_6', skill: 'electrician', daysAgo: 22, hours: 4, rate: 135, rating: 5, comment: 'Balcony and terrace illumination points', maskEmployer: true, visible: false }, // hidden entry 3
  { workerKey: 'E1', customerKey: 'CUST_7', skill: 'electrician', daysAgo: 15, hours: 3, rate: 140, rating: 5, comment: 'Solar panel inverter connection inspection', maskEmployer: true, visible: true },
  { workerKey: 'E1', customerKey: 'CUST_BUSY', skill: 'electrician', daysAgo: 8, hours: 2, rate: 150, rating: 4, comment: 'Living room chandelier and dimmer switches', maskEmployer: true, visible: true },
  { workerKey: 'E1', customerKey: 'CUST_3', skill: 'electrician', daysAgo: 2, hours: 3, rate: 140, rating: 5, comment: 'Main board neutral fault isolation and repair', maskEmployer: true, visible: true },

  // --- Worker H1 (Helper in Edappally) - 8 completed jobs ---
  { workerKey: 'H1', customerKey: 'CUST_BUSY', skill: 'helper', daysAgo: 70, hours: 6, rate: 95, rating: 5, comment: 'Warehouse cartons loading and arrangement', maskEmployer: true, visible: true },
  { workerKey: 'H1', customerKey: 'CUST_3', skill: 'helper', daysAgo: 58, hours: 4, rate: 90, rating: 5, comment: 'Residential household shifting assistance', maskEmployer: true, visible: true },
  { workerKey: 'H1', customerKey: 'CUST_4', skill: 'helper', daysAgo: 48, hours: 5, rate: 95, rating: 4, comment: 'Tile unloading and floor material handling', maskEmployer: true, visible: true },
  { workerKey: 'H1', customerKey: 'CUST_5', skill: 'helper', daysAgo: 39, hours: 4, rate: 100, rating: 5, comment: 'Garden clearance and waste disposal help', maskEmployer: true, visible: true },
  { workerKey: 'H1', customerKey: 'CUST_6', skill: 'helper', daysAgo: 29, hours: 5, rate: 95, rating: 5, comment: 'Shop renovation shelving and clearing help', maskEmployer: true, visible: true },
  { workerKey: 'H1', customerKey: 'CUST_7', skill: 'helper', daysAgo: 20, hours: 4, rate: 90, rating: 4, comment: 'Truck unloading and inventory stacking', maskEmployer: true, visible: true },
  { workerKey: 'H1', customerKey: 'CUST_BUSY', skill: 'helper', daysAgo: 11, hours: 6, rate: 95, rating: 5, comment: 'Heavy furniture shifting between floors', maskEmployer: true, visible: true },
  { workerKey: 'H1', customerKey: 'CUST_4', skill: 'helper', daysAgo: 3, hours: 4, rate: 100, rating: 5, comment: 'Site clearing and material movement', maskEmployer: true, visible: true },

  // --- Plumbers (Across several localities, under 5 in any single one -> City source) ---
  // P1 in Vyttila (3 jobs in Vyttila, 2 in Kaloor -> Total 5 in city, max 3 in single locality)
  { workerKey: 'P1', customerKey: 'CUST_BUSY', skill: 'plumber', localityKey: 'vyttila', daysAgo: 65, hours: 3, rate: 135, rating: 5, comment: 'Overhead water tank float valve replacement', maskEmployer: true, visible: true },
  { workerKey: 'P1', customerKey: 'CUST_3', skill: 'plumber', localityKey: 'kaloor', daysAgo: 50, hours: 2, rate: 130, rating: 4, comment: 'Kitchen sink pipe blockage clearance', maskEmployer: true, visible: true },
  { workerKey: 'P1', customerKey: 'CUST_4', skill: 'plumber', localityKey: 'vyttila', daysAgo: 35, hours: 4, rate: 140, rating: 5, comment: 'Concealed flush tank repair and fittings', maskEmployer: true, visible: true },
  { workerKey: 'P1', customerKey: 'CUST_5', skill: 'plumber', localityKey: 'kaloor', daysAgo: 21, hours: 3, rate: 135, rating: 5, comment: 'Pressure pump pipeline connection', maskEmployer: true, visible: true },
  { workerKey: 'P1', customerKey: 'CUST_6', skill: 'plumber', localityKey: 'vyttila', daysAgo: 7, hours: 2, rate: 130, rating: 4, comment: 'Bathroom taps and shower mixer repair', maskEmployer: true, visible: true },

  // P2 in Palarivattom (2 jobs)
  { workerKey: 'P2', customerKey: 'CUST_7', skill: 'plumber', localityKey: 'palarivattom', daysAgo: 40, hours: 2, rate: 125, rating: 5, comment: 'Drainage trap cleaning and seal replacement', maskEmployer: true, visible: true },
  { workerKey: 'P2', customerKey: 'CUST_BUSY', skill: 'plumber', localityKey: 'palarivattom', daysAgo: 14, hours: 3, rate: 130, rating: 4, comment: 'Washing machine inlet pipeline plumbing', maskEmployer: true, visible: true },

  // --- Worker M1 (Mason) - Exactly 1 completed job ---
  { workerKey: 'M1', customerKey: 'CUST_BUSY', skill: 'mason', daysAgo: 18, hours: 6, rate: 145, rating: 5, comment: 'Compound wall crack repair and cement plastering', maskEmployer: true, visible: true },

  // --- Worker V1 (Cook) - 3 completed jobs, all 100% private (visible: false) ---
  { workerKey: 'V1', customerKey: 'CUST_BUSY', skill: 'cook', daysAgo: 33, hours: 4, rate: 115, rating: 5, comment: 'Traditional lunch catering for family event', maskEmployer: true, visible: false },
  { workerKey: 'V1', customerKey: 'CUST_3', skill: 'cook', daysAgo: 24, hours: 5, rate: 115, rating: 4, comment: 'Evening dinner preparation and buffet setup', maskEmployer: true, visible: false },
  { workerKey: 'V1', customerKey: 'CUST_4', skill: 'cook', daysAgo: 12, hours: 4, rate: 120, rating: 5, comment: 'Weekend family feast traditional dishes', maskEmployer: true, visible: false }
];

/**
 * Validates the entire dataset statically.
 * Asserts all texts pass containsContactInfo, emails match example.com,
 * phones match 9000000xxx, and rates are within valid ranges.
 */
export function validateDatasetSanity() {
  const errors = [];

  // Check unique emails and phones
  const emails = new Set();
  const phones = new Set();

  const allUsers = [...SAMPLE_WORKERS, ...SAMPLE_CUSTOMERS];

  for (const u of allUsers) {
    if (emails.has(u.email)) errors.push(`Duplicate email: ${u.email}`);
    emails.add(u.email);

    if (phones.has(u.phone)) errors.push(`Duplicate phone: ${u.phone}`);
    phones.add(u.phone);

    if (!u.email.endsWith('.sample@example.com')) {
      errors.push(`Email does not end with .sample@example.com: ${u.email}`);
    }

    if (!/^9000000\d{3}$/.test(u.phone)) {
      errors.push(`Phone does not match 9000000xxx pattern: ${u.phone}`);
    }

    if (u.bio && containsContactInfo(u.bio)) {
      errors.push(`Worker bio contains contact info: ${u.name}`);
    }

    if (u.hourlyRate && (u.hourlyRate < 50 || u.hourlyRate > 100000)) {
      errors.push(`Hourly rate out of range: ${u.name}`);
    }
  }

  // Validate comments in completed bookings
  for (const b of COMPLETED_BOOKINGS_PLAN) {
    if (b.comment && containsContactInfo(b.comment)) {
      errors.push(`Booking comment contains contact info: ${b.comment}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
