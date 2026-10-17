import { clock } from '../utils/clock.js';

/**
 * Executes an asynchronous function while moving the global injectable clock
 * to a specific simulated time, and GUARANTEES the clock is restored even
 * if the function throws an error.
 *
 * @template T
 * @param {Date|string|number} targetTime Time to set the clock to
 * @param {() => Promise<T>} fn Async function to execute
 * @returns {Promise<T>} Result of fn
 */
export async function withClock(targetTime, fn) {
  clock.freeze(targetTime);
  try {
    return await fn();
  } finally {
    clock.restore();
  }
}
