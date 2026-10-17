/**
 * backend/src/realtime/socketServer.js – Socket.io server and authentication.
 *
 * Implements Requirement 4 & 7:
 *   - Authentication via handshake auth { token } ONLY
 *   - Query string tokens rejected (AUTH_INVALID) and never logged
 *   - Disconnect with AUTH_EXPIRED after token exp + 60s grace period
 *   - Periodic and testable revalidateAll()
 *   - Limits: max 5 sockets/user, max 30 conns/min/IP, max 10 events/min/socket
 *   - Emits "ready" with { serverTime } on connect
 *   - Accept only auth:refresh and rooms:refresh client events
 *   - Coarse room management & cached user metadata
 */

import { Server } from 'socket.io';
import { verifyAccessToken } from '../utils/tokenCrypto.js';
import { User } from '../models/User.js';
import { clock } from '../utils/clock.js';
import { logger } from '../utils/logger.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { getLocalityByKey } from '../../../shared/localities.js';
import { cellFor, ringSizeFromRadius, ringCells, roomName, userRoomName } from '../../../shared/areaCells.js';

let ioInstance = null;
let revalInterval = null;

// IP attempt limiter map: ip -> { count, resetAt }
const ipAttempts = new Map();

/**
 * Resets connection tracking maps (used in tests).
 */
export function resetConnectionLimits() {
  ipAttempts.clear();
}

/**
 * Updates a socket's joined rooms and in-memory cached data from user profile.
 *
 * @param {import('socket.io').Socket} socket
 * @param {object} user
 */
export function updateSocketRoomsAndCache(socket, user) {
  // Leave previous cell rooms
  for (const room of socket.rooms) {
    if (room.startsWith('w:') || room.startsWith('c:')) {
      socket.leave(room);
    }
  }

  const userId = user._id.toString();
  socket.userId = userId;
  socket.userRole = user.role;
  socket.join(userRoomName(userId));

  const role = user.role;
  const skills = Array.isArray(user.skills) ? user.skills : [];
  const radiusKm = user.radiusKm || 5;

  let origin = null;
  if (role === 'worker') {
    let coords = user.searchLocation?.coordinates;
    if (!coords || (coords[0] === 0 && coords[1] === 0)) {
      if (user.localityKey) {
        const loc = getLocalityByKey(user.localityKey);
        if (loc) coords = [loc.lng, loc.lat];
      }
    }
    if (coords && (coords[0] !== 0 || coords[1] !== 0)) {
      origin = { lng: coords[0], lat: coords[1] };
      const { cellX, cellY } = cellFor(origin.lng, origin.lat);
      const rings = Math.min(2, ringSizeFromRadius(radiusKm)); // workers: max 2 rings
      const cells = ringCells(cellX, cellY, rings);
      for (const c of cells) {
        socket.join(roomName('w', c.cellX, c.cellY));
      }
    }
  } else if (role === 'customer') {
    let coords = user.location?.coordinates;
    if (!coords || (coords[0] === 0 && coords[1] === 0)) {
      if (user.localityKey) {
        const loc = getLocalityByKey(user.localityKey);
        if (loc) coords = [loc.lng, loc.lat];
      }
    }
    if (coords && (coords[0] !== 0 || coords[1] !== 0)) {
      origin = { lng: coords[0], lat: coords[1] };
      const { cellX, cellY } = cellFor(origin.lng, origin.lat);
      const rings = 1; // customers: cell + 1 ring
      const cells = ringCells(cellX, cellY, rings);
      for (const c of cells) {
        socket.join(roomName('c', c.cellX, c.cellY));
      }
    }
  }

  socket.cachedData = {
    userId,
    role,
    skills,
    radiusKm,
    origin
  };
}

/**
 * Initializes Socket.io attached to the given HTTP server.
 *
 * @param {import('node:http').Server} httpServer
 * @param {object} config
 * @returns {Server}
 */
export function initSocketServer(httpServer, config) {
  if (ioInstance) {
    return ioInstance;
  }

  const allowedOrigins = config.FRONTEND_ORIGINS || [];

  const io = new Server(httpServer, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 10 * 1024, // 10 KB
    cors: {
      origin: (origin, callback) => {
        return callback(null, true);
      },
      credentials: true
    }
  });

  // Connection Authentication Middleware
  io.use(async (socket, next) => {
    try {
      // 0. Origin verification: reject present but unlisted Origin; absent Origin is allowed
      const originHeader = socket.handshake.headers?.origin;
      if (originHeader && !allowedOrigins.includes(originHeader)) {
        logAuditEvent('socket_rejected', { reason: 'AUTH_INVALID' });
        return next(new Error('AUTH_INVALID'));
      }

      // 1. IP rate limiting: max 30 connection attempts per minute per IP
      const ip = socket.handshake.address || socket.conn?.remoteAddress || 'unknown';
      const nowMs = Date.now();
      let ipRecord = ipAttempts.get(ip);
      if (!ipRecord || nowMs > ipRecord.resetAt) {
        ipRecord = { count: 1, resetAt: nowMs + 60000 };
        ipAttempts.set(ip, ipRecord);
      } else {
        ipRecord.count++;
        if (ipRecord.count > 30) {
          logAuditEvent('socket_rejected', { reason: 'RATE_LIMITED' });
          return next(new Error('RATE_LIMITED'));
        }
      }

      // 2. Reject tokens passed in the URL query string (never log the token)
      const queryToken = socket.handshake.query?.token;
      if (queryToken) {
        logAuditEvent('socket_rejected', { reason: 'AUTH_INVALID' });
        return next(new Error('AUTH_INVALID'));
      }

      // 3. Extract token exclusively from handshake auth
      const token = socket.handshake.auth?.token;
      if (!token || typeof token !== 'string') {
        logAuditEvent('socket_rejected', { reason: 'AUTH_REQUIRED' });
        return next(new Error('AUTH_REQUIRED'));
      }

      // 4. Verify JWT access token
      let payload;
      try {
        payload = await verifyAccessToken(token, config.JWT_ACCESS_SECRET);
      } catch {
        logAuditEvent('socket_rejected', { reason: 'AUTH_INVALID' });
        return next(new Error('AUTH_INVALID'));
      }

      // 6. Verify user in database
      const userId = payload.sub || payload.userId;
      const user = await User.findById(userId);
      if (!user || !user.isActive || user.tokenVersion !== payload.tokenVersion) {
        logAuditEvent('socket_rejected', { reason: 'AUTH_INVALID' });
        return next(new Error('AUTH_INVALID'));
      }

      // 7. Max 5 simultaneous sockets per user
      const userIdStr = user._id.toString();
      let activeCount = 0;
      for (const sock of io.sockets.sockets.values()) {
        if (!sock.disconnected && sock.userId === userIdStr) {
          activeCount++;
        }
      }
      if (activeCount >= 5) {
        logAuditEvent('socket_rejected', { reason: 'TOO_MANY_CONNECTIONS' });
        return next(new Error('TOO_MANY_CONNECTIONS'));
      }

      // Attach session info to socket
      socket.userId = userIdStr;
      socket.tokenExp = payload.exp;
      socket.tokenVersion = payload.tokenVersion;
      socket.userDoc = user;

      return next();
    } catch (err) {
      logAuditEvent('socket_rejected', { reason: 'AUTH_INVALID' });
      return next(new Error('AUTH_INVALID'));
    }
  });

  // Socket Connection Handler
  io.on('connection', (socket) => {
    const user = socket.userDoc;
    delete socket.userDoc;

    updateSocketRoomsAndCache(socket, user);
    logAuditEvent('socket_connected', { userId: socket.userId, socketId: socket.id });

    // Emit ready with serverTime
    socket.emit('ready', { serverTime: clock.now().toISOString() });

    // Client event rate limit tracking: max 10 events / min
    socket.clientEventCount = 0;
    socket.clientEventWindowResetAt = Date.now() + 60000;

    const enforceClientRateLimit = () => {
      const nowMs = Date.now();
      if (nowMs > socket.clientEventWindowResetAt) {
        socket.clientEventCount = 1;
        socket.clientEventWindowResetAt = nowMs + 60000;
        return true;
      }
      socket.clientEventCount++;
      if (socket.clientEventCount > 10) {
        logAuditEvent('socket_disconnected', { socketId: socket.id, userId: socket.userId, reason: 'RATE_LIMITED' });
        socket.emit('error', 'RATE_LIMITED');
        socket.disconnect(true);
        return false;
      }
      return true;
    };

    // Client event: auth:refresh
    socket.on('auth:refresh', async (payload, ack) => {
      if (!enforceClientRateLimit()) return;
      try {
        if (!payload || !payload.token || typeof payload.token !== 'string') {
          if (typeof ack === 'function') ack({ ok: false, code: 'AUTH_INVALID' });
          socket.disconnect(true);
          return;
        }

        const tokenPayload = await verifyAccessToken(payload.token, config.JWT_ACCESS_SECRET);
        const refreshUserId = tokenPayload.sub || tokenPayload.userId;
        if (refreshUserId !== socket.userId) {
          if (typeof ack === 'function') ack({ ok: false, code: 'AUTH_INVALID' });
          socket.disconnect(true);
          return;
        }

        const freshUser = await User.findById(refreshUserId);
        if (!freshUser || !freshUser.isActive || freshUser.tokenVersion !== tokenPayload.tokenVersion) {
          if (typeof ack === 'function') ack({ ok: false, code: 'AUTH_INVALID' });
          socket.disconnect(true);
          return;
        }

        socket.tokenExp = tokenPayload.exp;
        socket.tokenVersion = tokenPayload.tokenVersion;
        if (typeof ack === 'function') ack({ ok: true });
      } catch {
        if (typeof ack === 'function') ack({ ok: false, code: 'AUTH_INVALID' });
        socket.disconnect(true);
      }
    });

    // Client event: rooms:refresh
    socket.on('rooms:refresh', async () => {
      if (!enforceClientRateLimit()) return;
      try {
        const freshUser = await User.findById(socket.userId);
        if (freshUser && freshUser.isActive) {
          updateSocketRoomsAndCache(socket, freshUser);
        }
      } catch {
        // best-effort
      }
    });

    // Intercept all other incoming events: count towards limit, then ignore
    socket.onAny((event) => {
      if (event !== 'auth:refresh' && event !== 'rooms:refresh') {
        enforceClientRateLimit();
      }
    });

    // Disconnect Handler
    socket.on('disconnect', (reason) => {
      logAuditEvent('socket_disconnected', { socketId: socket.id, userId: socket.userId, reason });
    });
  });

  // Setup periodic 60s revalidation interval
  if (!revalInterval) {
    revalInterval = setInterval(() => {
      revalidateAll().catch(() => {});
    }, 60000);
    if (revalInterval.unref) revalInterval.unref();
  }

  ioInstance = io;
  return io;
}

/**
 * Revalidates all active sockets against the database and token expiry.
 * Disconnects sockets of users who are inactive, whose tokenVersion changed,
 * or whose token has expired beyond the 60-second grace period.
 *
 * Expose for tests to call synchronously with fake clock.
 */
export async function revalidateAll() {
  if (!ioInstance) return;

  const now = clock.now();
  const nowSeconds = Math.floor(now.getTime() / 1000);

  const sockets = Array.from(ioInstance.sockets.sockets.values());

  for (const socket of sockets) {
    if (socket.disconnected) continue;

    // Check token expiration (60 second grace period)
    if (socket.tokenExp && nowSeconds > socket.tokenExp + 60) {
      logAuditEvent('socket_disconnected', { socketId: socket.id, userId: socket.userId, reason: 'AUTH_EXPIRED' });
      socket.emit('error', 'AUTH_EXPIRED');
      socket.disconnect(true);
      continue;
    }

    // Check user in database
    try {
      const user = await User.findById(socket.userId);
      if (!user || !user.isActive || user.tokenVersion !== socket.tokenVersion) {
        logAuditEvent('socket_disconnected', { socketId: socket.id, userId: socket.userId, reason: 'AUTH_INVALID' });
        socket.emit('error', 'AUTH_INVALID');
        socket.disconnect(true);
      }
    } catch {
      // skip on db query failure
    }
  }
}

/**
 * Returns current Socket.io server instance.
 * @returns {Server|null}
 */
export function getSocketServer() {
  return ioInstance;
}

/**
 * Closes the Socket.io server and cleans up intervals.
 */
export function closeSocketServer() {
  if (revalInterval) {
    clearInterval(revalInterval);
    revalInterval = null;
  }
  if (ioInstance) {
    ioInstance.close();
    ioInstance = null;
  }
  resetConnectionLimits();
}
