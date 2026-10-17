/**
 * backend/src/realtime/eventBus.js – In-process domain event bus.
 *
 * Dispatches domain events AFTER database operations commit.
 * Best-effort delivery: if a subscriber throws, the error is logged
 * and never bubbles up to fail the originating HTTP request.
 */

import { logger } from '../utils/logger.js';

class DomainEventBus {
  constructor() {
    this._listeners = new Map();
  }

  /**
   * Subscribe to a domain event.
   * @param {string} eventName
   * @param {Function} handler
   */
  subscribe(eventName, handler) {
    if (!this._listeners.has(eventName)) {
      this._listeners.set(eventName, new Set());
    }
    this._listeners.get(eventName).add(handler);
  }

  /**
   * Unsubscribe from a domain event.
   * @param {string} eventName
   * @param {Function} handler
   */
  unsubscribe(eventName, handler) {
    const handlers = this._listeners.get(eventName);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this._listeners.delete(eventName);
      }
    }
  }

  /**
   * Publish a domain event.
   * Executes all handlers in microtask/async, catching and logging any errors.
   * @param {string} eventName
   * @param {object} payload
   */
  publish(eventName, payload) {
    const handlers = this._listeners.get(eventName);
    if (!handlers || handlers.size === 0) return;

    for (const handler of Array.from(handlers)) {
      try {
        const result = handler(payload);
        if (result && typeof result.then === 'function') {
          result.catch((err) => {
            logger.error({ err: err.message, eventName }, 'Event bus subscriber async error');
          });
        }
      } catch (err) {
        logger.error({ err: err.message, eventName }, 'Event bus subscriber sync error');
      }
    }
  }

  /**
   * Removes all listeners (used in testing).
   */
  removeAll() {
    this._listeners.clear();
  }
}

export const eventBus = new DomainEventBus();
