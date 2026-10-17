import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterWorkersForJob, filterCustomersForRadar } from '../../../src/realtime/recipientFilter.js';

describe('backend/src/realtime/recipientFilter.js unit tests', () => {
  // Kochi centre: lat: 9.9816, lng: 76.2999 (Ernakulam North approx)
  // Kakkanad: lat: 10.0159, lng: 76.3419 (~6 km away)
  // Aluva: lat: 10.1076, lng: 76.3516 (~15 km away)

  const kochiCoords = { lat: 9.9816, lng: 76.2999 };
  const kakkanadCoords = { lat: 10.0159, lng: 76.3419 };
  const aluvaCoords = { lat: 10.1076, lng: 76.3516 };

  const socketA = {
    id: 'sockA',
    cachedData: {
      userId: 'wA',
      role: 'worker',
      skills: ['electrician'],
      radiusKm: 8,
      origin: kochiCoords
    }
  };

  const socketB = {
    id: 'sockB',
    cachedData: {
      userId: 'wB',
      role: 'worker',
      skills: ['plumber'],
      radiusKm: 8,
      origin: kochiCoords
    }
  };

  const socketC = {
    id: 'sockC',
    cachedData: {
      userId: 'wC',
      role: 'worker',
      skills: ['electrician'],
      radiusKm: 2, // too small radius
      origin: aluvaCoords
    }
  };

  const customerD = {
    id: 'custD',
    cachedData: {
      userId: 'cD',
      role: 'customer',
      origin: kochiCoords
    }
  };

  const customerE = {
    id: 'custE',
    cachedData: {
      userId: 'cE',
      role: 'customer',
      origin: aluvaCoords // > 5km
    }
  };

  describe('filterWorkersForJob', () => {
    it('selects worker with matching skill and radius', () => {
      const allSockets = [socketA, socketB, socketC, customerD];
      const matched = filterWorkersForJob(allSockets, 'electrician', kakkanadCoords);

      // Distance Kochi to Kakkanad is ~6 km.
      // SocketA has radius 8 km and skill electrician -> matches!
      // SocketB is plumber -> fails
      // SocketC is in Aluva with radius 2 km -> fails
      // CustomerD is not a worker -> fails
      assert.equal(matched.length, 1);
      assert.equal(matched[0].id, 'sockA');
    });

    it('returns empty array if no worker matches', () => {
      const allSockets = [socketA, socketB, socketC];
      const matched = filterWorkersForJob(allSockets, 'carpenter', kochiCoords);
      assert.equal(matched.length, 0);
    });
  });

  describe('filterCustomersForRadar', () => {
    it('selects customer within 5 km of worker origin', () => {
      const allSockets = [customerD, customerE, socketA];
      const matched = filterCustomersForRadar(allSockets, kochiCoords, 5000);

      // CustomerD is at Kochi coords (distance 0) -> matches
      // CustomerE is in Aluva (~15 km) -> fails
      // SocketA is worker -> fails
      assert.equal(matched.length, 1);
      assert.equal(matched[0].id, 'custD');
    });
  });
});
