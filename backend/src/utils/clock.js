let fixedTime = null;

export const clock = {
  /**
   * Returns current Date instance.
   * @returns {Date}
   */
  now() {
    return fixedTime ? new Date(fixedTime.getTime()) : new Date();
  },

  /**
   * Returns current epoch milliseconds.
   * @returns {number}
   */
  nowMs() {
    return this.now().getTime();
  },

  /**
   * Returns current ISO string.
   * @returns {string}
   */
  toISOString() {
    return this.now().toISOString();
  },

  /**
   * Freezes clock at a specific time for testing.
   * @param {Date|number|string} time 
   */
  freeze(time) {
    fixedTime = new Date(time);
  },

  /**
   * Advances the frozen clock by specified milliseconds.
   * @param {number} ms 
   */
  advanceMs(ms) {
    if (!fixedTime) {
      fixedTime = new Date();
    }
    fixedTime = new Date(fixedTime.getTime() + ms);
  },

  /**
   * Restores clock to real system time.
   */
  restore() {
    fixedTime = null;
  }
};
