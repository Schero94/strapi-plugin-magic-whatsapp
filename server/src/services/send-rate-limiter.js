'use strict';

const { createHash } = require('node:crypto');

const createSendRateLimiter = ({ limit = 10, windowMs = 60_000, now = Date.now } = {}) => {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1 || typeof now !== 'function') {
    throw new TypeError('A positive send limit, window and clock function are required.');
  }

  const buckets = new Map();
  return {
    consume(adminIdentity) {
      if (adminIdentity === null || adminIdentity === undefined || String(adminIdentity).length === 0) return false;
      const currentTime = now();
      for (const [identity, bucket] of buckets) {
        if (currentTime >= bucket.expiresAt) buckets.delete(identity);
      }

      const key = createHash('sha256').update(String(adminIdentity)).digest('hex');
      const bucket = buckets.get(key);
      if (bucket && currentTime < bucket.expiresAt) {
        if (bucket.count >= limit) return false;
        bucket.count += 1;
        return true;
      }

      buckets.set(key, { count: 1, expiresAt: currentTime + windowMs });
      return true;
    },

    clear() {
      buckets.clear();
    },
  };
};

module.exports = { createSendRateLimiter };
