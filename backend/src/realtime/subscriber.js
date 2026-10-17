/**
 * backend/src/realtime/subscriber.js – Realtime domain event subscriber.
 *
 * Listens to in-process domain event bus and translates domain events
 * into targeted Socket.io emissions. Emitting is best-effort.
 */

import { eventBus } from './eventBus.js';
import { getSocketServer } from './socketServer.js';
import { cellFor, roomName, userRoomName } from '../../../shared/areaCells.js';
import { filterWorkersForJob, filterCustomersForRadar } from './recipientFilter.js';
import {
  buildJobNewPayload,
  buildJobFilledPayload,
  buildBookingRequestPayload,
  buildBookingCreatedPayload,
  buildBookingStartedPayload,
  buildBookingCompletedPayload,
  buildBookingCancelledPayload
} from './payloadBuilders.js';
import { logger } from '../utils/logger.js';

let isSubscribed = false;

/**
 * Registers domain event bus subscribers for Socket.io broadcasting.
 */
export function setupRealtimeSubscribers() {
  if (isSubscribed) return;
  isSubscribed = true;

  // 1. job:new
  eventBus.subscribe('job:new', ({ jobId, skill, searchLocation }) => {
    try {
      const io = getSocketServer();
      if (!io || !searchLocation?.coordinates) return;

      const lng = searchLocation.coordinates[0];
      const lat = searchLocation.coordinates[1];
      const { cellX, cellY } = cellFor(lng, lat);
      const coarseRoom = roomName('w', cellX, cellY);

      const socketIds = io.sockets.adapter.rooms.get(coarseRoom);
      if (!socketIds || socketIds.size === 0) return;

      const candidates = [];
      for (const id of socketIds) {
        const sock = io.sockets.sockets.get(id);
        if (sock && !sock.disconnected) candidates.push(sock);
      }

      const matched = filterWorkersForJob(candidates, skill, { lng, lat });
      const payload = buildJobNewPayload(jobId, skill);

      for (const sock of matched) {
        sock.emit('job:new', payload);
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to broadcast job:new event');
    }
  });

  // 2. job:filled
  eventBus.subscribe('job:filled', ({ jobId, reason, skill, searchLocation }) => {
    try {
      const io = getSocketServer();
      if (!io || !searchLocation?.coordinates) return;

      const lng = searchLocation.coordinates[0];
      const lat = searchLocation.coordinates[1];
      const { cellX, cellY } = cellFor(lng, lat);
      const coarseRoom = roomName('w', cellX, cellY);

      const socketIds = io.sockets.adapter.rooms.get(coarseRoom);
      if (!socketIds || socketIds.size === 0) return;

      const candidates = [];
      for (const id of socketIds) {
        const sock = io.sockets.sockets.get(id);
        if (sock && !sock.disconnected) candidates.push(sock);
      }

      const matched = filterWorkersForJob(candidates, skill, { lng, lat });
      const payload = buildJobFilledPayload(jobId, reason);

      for (const sock of matched) {
        sock.emit('job:filled', payload);
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to broadcast job:filled event');
    }
  });

  // 3. radar:worker_free
  eventBus.subscribe('radar:worker_free', ({ payload, workerOrigin }) => {
    try {
      const io = getSocketServer();
      if (!io || !workerOrigin) return;

      const { cellX, cellY } = cellFor(workerOrigin.lng, workerOrigin.lat);
      const coarseRoom = roomName('c', cellX, cellY);

      const socketIds = io.sockets.adapter.rooms.get(coarseRoom);
      if (!socketIds || socketIds.size === 0) return;

      const candidates = [];
      for (const id of socketIds) {
        const sock = io.sockets.sockets.get(id);
        if (sock && !sock.disconnected) candidates.push(sock);
      }

      const matched = filterCustomersForRadar(candidates, workerOrigin, 5000);
      for (const sock of matched) {
        sock.emit('radar:worker_free', payload);
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to broadcast radar:worker_free event');
    }
  });

  // 4. radar:worker_busy
  eventBus.subscribe('radar:worker_busy', ({ payload, workerOrigin }) => {
    try {
      const io = getSocketServer();
      if (!io || !workerOrigin) return;

      const { cellX, cellY } = cellFor(workerOrigin.lng, workerOrigin.lat);
      const coarseRoom = roomName('c', cellX, cellY);

      const socketIds = io.sockets.adapter.rooms.get(coarseRoom);
      if (!socketIds || socketIds.size === 0) return;

      const candidates = [];
      for (const id of socketIds) {
        const sock = io.sockets.sockets.get(id);
        if (sock && !sock.disconnected) candidates.push(sock);
      }

      const matched = filterCustomersForRadar(candidates, workerOrigin, 5000);
      for (const sock of matched) {
        sock.emit('radar:worker_busy', payload);
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to broadcast radar:worker_busy event');
    }
  });

  // 5. booking:request
  eventBus.subscribe('booking:request', ({ bookingId, workerId }) => {
    try {
      const io = getSocketServer();
      if (!io || !workerId) return;
      io.to(userRoomName(workerId)).emit('booking:request', buildBookingRequestPayload(bookingId));
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to broadcast booking:request event');
    }
  });

  // 6. booking:created
  eventBus.subscribe('booking:created', ({ bookingId, customerId }) => {
    try {
      const io = getSocketServer();
      if (!io || !customerId) return;
      io.to(userRoomName(customerId)).emit('booking:created', buildBookingCreatedPayload(bookingId));
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to broadcast booking:created event');
    }
  });

  // 7. booking:started
  eventBus.subscribe('booking:started', ({ bookingId, customerId }) => {
    try {
      const io = getSocketServer();
      if (!io || !customerId) return;
      io.to(userRoomName(customerId)).emit('booking:started', buildBookingStartedPayload(bookingId));
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to broadcast booking:started event');
    }
  });

  // 8. booking:completed
  eventBus.subscribe('booking:completed', ({ bookingId, workerId }) => {
    try {
      const io = getSocketServer();
      if (!io || !workerId) return;
      io.to(userRoomName(workerId)).emit('booking:completed', buildBookingCompletedPayload(bookingId));
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to broadcast booking:completed event');
    }
  });

  // 9. booking:cancelled
  eventBus.subscribe('booking:cancelled', ({ bookingId, cancelledBy, otherUserId }) => {
    try {
      const io = getSocketServer();
      if (!io || !otherUserId) return;
      io.to(userRoomName(otherUserId)).emit('booking:cancelled', buildBookingCancelledPayload(bookingId, cancelledBy));
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to broadcast booking:cancelled event');
    }
  });
}
