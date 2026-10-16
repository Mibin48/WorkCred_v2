import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { containsContactInfo } from '../../../../shared/containsContactInfo.js';

describe('shared/containsContactInfo.js', () => {
  describe('Must-Block Test Cases (Positive Examples >= 30)', () => {
    const positiveCases = [
      'Call me on 9876543210',
      'My number is 98765 43210 right now',
      'Contact: 9876-543-210',
      'Reach me at (987) 654-3210',
      'Ring me 98_76_54_32_10',
      'Number is 98.76.54.32.10 call me',
      'Devanagari phone ९८७६५४३२१० call now',
      'Malayalam phone ൯൮൭൬൫൪൩൨൧൦ please call',
      'Spelled out: nine eight four five six seven eight',
      'Call nine eight seven six five four',
      'Contact zero one two three four five six',
      'Send email to ravi@example.com',
      'My email is worker.help@domain.in',
      'Reach out at ravi at gmail dot com',
      'Write to me: ravi [at] yahoo [dot] in',
      'Contact me: ravi(at)outlook(dot)com',
      'Visit https://mywebsite.com for my details',
      'Check http://workerdirect.in/contact',
      'Go to www.directwork.com',
      'Ping me on wa.me/919876543210',
      'Telegram: t.me/ravi_electrician',
      'Shortlink: bit.ly/hire-ravi',
      'Visit my page at electricianravi.com',
      'Look up my site at helperkerala.in',
      'Reach me at myportfolio.org',
      'Check quickplumber.net',
      'See fastcleaner.io',
      'Message on whatsapp 987654',
      'My whatsapp is @ravifixes',
      'Telegram me at @ravi_helper',
      'Find me on insta @ravi_plumbing_works',
      'Contact on instagram 98765'
    ];

    positiveCases.forEach((example, idx) => {
      it(`must block example #${idx + 1}: "${example}"`, () => {
        assert.equal(containsContactInfo(example), true);
      });
    });
  });

  describe('Must-Allow Test Cases (Negative Examples >= 15)', () => {
    const negativeCases = [
      '2 workers for 4 hours',
      'Rs 1,200',
      'Total cost is ₹1,200',
      '3 PM to 6 PM',
      'Scheduled on 12/10/2026',
      'Available on 2026-10-16',
      'Deliver to room 204',
      'Need 3 helpers tomorrow morning',
      'Fixed the 4 switchboards and 2 fans',
      'Work started at 10 AM and finished at 2 PM',
      'Pipe fitting for 2 bathrooms and 1 kitchen',
      'Painting 3 bedrooms and 1 living room',
      'Flat number 402, Sunset Heights',
      'Job duration: 5 hours total',
      'Cleared 5 bags of garden waste'
    ];

    negativeCases.forEach((example, idx) => {
      it(`must allow example #${idx + 1}: "${example}"`, () => {
        assert.equal(containsContactInfo(example), false);
      });
    });
  });
});
