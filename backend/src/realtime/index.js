/**
 * backend/src/realtime/index.js – Realtime module entry point.
 */

import { initSocketServer, closeSocketServer, getSocketServer, revalidateAll } from './socketServer.js';
import { setupRealtimeSubscribers } from './subscriber.js';
import { startSweeper, stopSweeper, sweepOnce } from './sweeper.js';
import { eventBus } from './eventBus.js';

/**
 * Initializes realtime Socket.io server, subscribers, and background sweeper.
 *
 * @param {import('node:http').Server} httpServer
 * @param {object} config
 * @returns {{ io: import('socket.io').Server, eventBus: object }}
 */
export function initRealtime(httpServer, config) {
  const io = initSocketServer(httpServer, config);
  setupRealtimeSubscribers();
  startSweeper();
  return { io, eventBus };
}

/**
 * Gracefully terminates all realtime services, sockets, and timers.
 */
export function closeRealtime() {
  stopSweeper();
  closeSocketServer();
}

export {
  initSocketServer,
  closeSocketServer,
  getSocketServer,
  revalidateAll,
  startSweeper,
  stopSweeper,
  sweepOnce,
  eventBus
};
